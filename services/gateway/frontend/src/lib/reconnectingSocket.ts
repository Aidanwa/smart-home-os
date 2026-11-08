// A WebSocket that reconnects with backoff and notices dead connections.
//
// Browsers don't surface protocol pings, and a socket that died while a phone slept or the
// network changed can stay "OPEN" indefinitely. The gateway sends KEEPALIVE every 25 s on quiet
// sockets (WS_KEEPALIVE_* in services/gateway/api/routes.py); if nothing at all arrives for
// STALE_MS we drop the socket and reconnect. Waking the page or coming back online re-checks
// immediately instead of waiting out the backoff.

export const KEEPALIVE = '{"type":"ping"}';
const STALE_MS = 60_000;
const WATCHDOG_MS = 10_000;
const MAX_BACKOFF_MS = 30_000;

export interface ReconnectingSocketOptions {
  onMessage: (data: string) => void;
  /** Every successful (re)connect. `reconnected` is false only for the first one. */
  onOpen?: (reconnected: boolean) => void;
  /** The socket went away (or a connect attempt failed). */
  onClose?: (code: number) => void;
  /** Return false to stop retrying after this close code (e.g. auth refused). Default: always retry. */
  shouldRetry?: (code: number) => boolean;
}

export interface ReconnectingSocket {
  /** Sends if connected; returns false otherwise. */
  send: (data: string) => boolean;
  /** Reconnect now (resets the backoff), e.g. after the user fixes something. */
  retry: () => void;
  /** Stop for good. */
  close: () => void;
}

export function openReconnectingSocket(path: string, opts: ReconnectingSocketOptions): ReconnectingSocket {
  const url = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}${path}`;
  let ws: WebSocket | null = null;
  let stopped = false;
  let everOpened = false;
  let attempt = 0;
  let lastSeen = Date.now();
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const clearRetry = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };

  // Detach and close the current socket; its own onclose never runs, so this is the one place
  // a "closed" is reported and a retry scheduled.
  const drop = (code: number, retry: boolean) => {
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try { ws.close(); } catch { /* already closing */ }
      ws = null;
    }
    opts.onClose?.(code);
    if (!stopped && retry) schedule();
  };

  const schedule = () => {
    clearRetry();
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt) * (0.8 + Math.random() * 0.4);
    attempt++;
    retryTimer = setTimeout(connect, delay);
  };

  function connect() {
    clearRetry();
    if (stopped) return;
    const sock = new WebSocket(url);
    ws = sock;
    sock.onopen = () => {
      attempt = 0;
      lastSeen = Date.now();
      opts.onOpen?.(everOpened);
      everOpened = true;
    };
    sock.onmessage = (e) => {
      lastSeen = Date.now();
      if (e.data === KEEPALIVE) return;
      opts.onMessage(e.data);
    };
    sock.onclose = (e) => {
      drop(e.code, opts.shouldRetry?.(e.code) ?? true);
    };
  }

  const isStale = () => Date.now() - lastSeen > STALE_MS;

  const watchdog = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN && isStale()) drop(4000, true);
  }, WATCHDOG_MS);

  // Phone woke up / network came back: don't wait for the watchdog or the backoff timer.
  const recheck = () => {
    if (stopped || document.visibilityState === 'hidden') return;
    if (ws?.readyState === WebSocket.OPEN) {
      if (isStale()) drop(4000, true);
      return;
    }
    if (retryTimer) {  // waiting out a backoff: try now instead
      attempt = 0;
      connect();
    }
  };
  document.addEventListener('visibilitychange', recheck);
  window.addEventListener('online', recheck);

  connect();

  return {
    send: (data) => {
      if (ws?.readyState !== WebSocket.OPEN) return false;
      ws.send(data);
      return true;
    },
    retry: () => {
      if (stopped || ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;
      attempt = 0;
      connect();
    },
    close: () => {
      stopped = true;
      clearRetry();
      clearInterval(watchdog);
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('online', recheck);
      if (ws) {
        ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
        // Closing a CONNECTING socket logs a console warning; let it open, then close it.
        if (ws.readyState === WebSocket.CONNECTING) {
          const s = ws;
          s.onopen = () => s.close();
        } else {
          ws.close();
        }
        ws = null;
      }
    },
  };
}
