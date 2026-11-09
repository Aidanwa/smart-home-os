import { useState, useEffect } from 'react';

export type HealthLevel = 'checking' | 'ok' | 'warn' | 'down';

export interface SystemHealth {
  level: HealthLevel;
  /** Short heading, e.g. "Everything is working". */
  title: string;
  /** One line per problem, in plain language. Empty when all is well. */
  problems: string[];
}

const CHECKING: SystemHealth = { level: 'checking', title: 'Checking…', problems: [] };

/** Polls GET /api/system/status every 30 s (and when the page wakes up). */
export function useSystemHealth(): SystemHealth {
  const [health, setHealth] = useState<SystemHealth>(CHECKING);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      let next: SystemHealth;
      try {
        const res = await fetch('/api/system/status');
        if (res.status === 401) return; // AuthContext logs out
        if (!res.ok) throw new Error(String(res.status));
        const s: { zigbee: string; agent: string } = await res.json();
        const problems: string[] = [];
        if (s.zigbee === 'no_response') problems.push('Zigbee isn’t answering, so devices won’t respond. Zigbee2MQTT or the MQTT broker on the Pi may be down; restarting the Pi usually fixes it.');
        if (s.zigbee === 'unhealthy') problems.push('Zigbee2MQTT is running but reports a problem. Devices may not respond.');
        if (s.agent !== 'ok') problems.push('The assistant isn’t reachable. Right after an update it takes about a minute to start; otherwise it may have crashed. Devices and routines still work.');
        next = problems.length === 0
          ? { level: 'ok', title: 'Everything is working', problems }
          : { level: s.zigbee === 'ok' ? 'warn' : 'down', title: s.zigbee === 'ok' ? 'Assistant unavailable' : 'Devices not responding', problems };
      } catch {
        next = { level: 'down', title: 'Can’t reach the hub', problems: ['Check your Wi-Fi and that Tailscale is connected. If it still fails, the Pi may be off or restarting.'] };
      }
      if (!cancelled) setHealth(next);
    };

    check();
    const interval = setInterval(check, 30000);
    const onWake = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('online', check);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('online', check);
    };
  }, []);

  return health;
}
