import { useCallback, useEffect, useState } from 'react';
import { BellOff, BellRing, Loader2, Send, Smartphone, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext';
import { request } from '../../lib/api';

/** Web push to this device (core/push.py on the hub; shown by public/sw.js). On iPhone it only
 *  works in the app added to the Home Screen (iOS 16.4+), and the permission prompt has to come
 *  from a tap, which is why it's a button and never asked on its own. */

interface Device { id: string; endpoint: string; label: string | null; created_at: string | null; last_ok_at: string | null }

const ALERTS = [
  { key: 'notify_failed', title: 'A routine failed', hint: 'None of its steps worked, or a step set to stop the routine failed.' },
  { key: 'notify_missed', title: 'A routine didn’t run', hint: 'The hub was down or busy at its scheduled time.' },
  { key: 'notify_partial', title: 'A routine only partly worked', hint: 'Some steps failed, e.g. one bulb didn’t answer. Can be chatty.' },
] as const;
type AlertKey = typeof ALERTS[number]['key'];

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Mac') && navigator.maxTouchPoints > 1);

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1) ? 'iPad'
    : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const app = window.matchMedia('(display-mode: standalone)').matches ? 'app'
    : /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  return `${device} (${app})`;
}

function keyToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = (b64url + '='.repeat((4 - (b64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** The service worker registration, or null if there isn't one (dev server, unsupported browser). */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

function since(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function NotificationSettings() {
  const { authenticatedFetch } = useAuth();
  const [hubReady, setHubReady] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [thisEndpoint, setThisEndpoint] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Record<AlertKey, boolean>>({ notify_failed: false, notify_missed: false, notify_partial: false });
  const [busy, setBusy] = useState<'enable' | 'disable' | 'test' | null>(null);

  // Fetch everything, then apply it (kept apart so the mount effect only sets state in a callback).
  const fetchAll = useCallback(async () => {
    try {
      const [key, subs, p] = await Promise.all([
        authenticatedFetch('/api/push/key'),
        authenticatedFetch('/api/push/subscriptions'),
        authenticatedFetch('/api/platform/preferences'),
      ]);
      const ui = p.ok ? (await p.json()).ui_settings ?? {} : null;
      const reg = await registration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      return { hubReady: key.ok, devices: subs.ok ? await subs.json() as Device[] : null, ui, endpoint: sub?.endpoint ?? null };
    } catch {
      toast.error('Couldn’t load notification settings', { description: 'Can’t reach the hub. Check your connection.' });
      return null;
    }
  }, [authenticatedFetch]);

  const apply = (d: Awaited<ReturnType<typeof fetchAll>>) => {
    if (!d) return;
    setHubReady(d.hubReady);
    if (d.devices) setDevices(d.devices);
    if (d.ui) setPrefs({ notify_failed: !!d.ui.notify_failed, notify_missed: !!d.ui.notify_missed, notify_partial: !!d.ui.notify_partial });
    setThisEndpoint(d.endpoint);
  };
  const load = () => fetchAll().then(apply);

  useEffect(() => {
    let cancelled = false;
    fetchAll().then(d => { if (!cancelled) apply(d); });
    return () => { cancelled = true; };
  }, [fetchAll]); // eslint-disable-line react-hooks/exhaustive-deps -- apply only calls setters

  const thisDevice = devices.find(d => d.endpoint === thisEndpoint);

  const enable = async () => {
    setBusy('enable');
    try {
      const reg = await registration();
      if (!reg) throw new Error('This page has no service worker. Open the installed app (or reload) and try again.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        throw new Error(isIos()
          ? 'Notifications are blocked. Allow them in the iPhone’s Settings → Notifications → Home.'
          : 'Notifications are blocked for this site. Allow them in the browser’s site settings.');
      }
      const keyRes = await authenticatedFetch('/api/push/key');
      if (!keyRes.ok) throw new Error('Notifications aren’t set up on the hub yet.');
      const { public_key } = await keyRes.json();
      const sub = (await reg.pushManager.getSubscription())
        ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(public_key) });
      const json = sub.toJSON();
      const ok = await request('turn on notifications', () => authenticatedFetch('/api/push/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, label: deviceLabel() }),
      }));
      if (ok) toast.success('Notifications are on for this device', { description: 'Send a test to check it works.' });
    } catch (e) {
      toast.error('Couldn’t turn on notifications', { description: e instanceof Error ? e.message : String(e) });
    }
    setBusy(null);
    load();
  };

  const remove = async (d: Device) => {
    const isThis = d.endpoint === thisEndpoint;
    if (isThis) setBusy('disable');
    const ok = await request('turn off notifications', () => authenticatedFetch(`/api/push/subscriptions/${d.id}`, { method: 'DELETE' }));
    if (ok && isThis) {
      try { await (await (await registration())?.pushManager.getSubscription())?.unsubscribe(); } catch { /* already gone */ }
    }
    if (ok) toast.success(isThis ? 'Notifications are off for this device' : `Removed ${d.label ?? 'that device'}`);
    setBusy(null);
    load();
  };

  const sendTest = async () => {
    setBusy('test');
    const res = await request('send a test notification', () => authenticatedFetch('/api/push/test', { method: 'POST' }));
    setBusy(null);
    if (res) toast.success('Test sent', { description: 'It should arrive in a few seconds.' });
    load();
  };

  const setAlert = async (key: AlertKey, on: boolean) => {
    setPrefs(p => ({ ...p, [key]: on }));
    const ok = await request('save the setting', () => authenticatedFetch('/api/platform/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ui_settings: { [key]: on } }),
    }));
    if (!ok) setPrefs(p => ({ ...p, [key]: !on }));
  };

  const card = 'bg-neutral-900/40 border border-neutral-800 p-6 rounded-xl space-y-4';
  const btn = 'flex items-center justify-center gap-1.5 text-sm px-4 min-h-11 rounded-lg font-medium transition-colors shrink-0 disabled:opacity-50';

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* This device */}
      <section className={card}>
        <div>
          <h2 className="text-base font-medium text-neutral-200">This device</h2>
          <p className="text-xs text-neutral-500 mt-1 leading-relaxed">Alerts and routine messages arrive as notifications, even when the app is closed.</p>
        </div>
        {!supported() ? (
          <p className="text-sm text-amber-300/90 leading-relaxed">
            {isIos()
              ? 'On iPhone, notifications only work in the installed app. In Safari, tap Share → Add to Home Screen, then open Home from its icon and come back here.'
              : 'This browser doesn’t support notifications.'}
          </p>
        ) : hubReady === false ? (
          <p className="text-sm text-amber-300/90">Notifications aren’t set up on the hub yet (it has no push key).</p>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0 text-sm">
              {thisDevice
                ? <><BellRing size={18} className="text-green-400 shrink-0" /><span className="text-neutral-200">On</span></>
                : <><BellOff size={18} className="text-neutral-500 shrink-0" /><span className="text-neutral-400">Off</span></>}
            </div>
            <div className="flex gap-2">
              {thisDevice ? (
                <>
                  <button type="button" onClick={sendTest} disabled={busy !== null}
                    className={`${btn} bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-200`}>
                    {busy === 'test' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send test
                  </button>
                  <button type="button" onClick={() => remove(thisDevice)} disabled={busy !== null}
                    className={`${btn} bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-300`}>
                    {busy === 'disable' && <Loader2 size={15} className="animate-spin" />} Turn off
                  </button>
                </>
              ) : (
                <button type="button" onClick={enable} disabled={busy !== null || hubReady === null}
                  className={`${btn} bg-blue-600 hover:bg-blue-500 text-white`}>
                  {busy === 'enable' ? <Loader2 size={15} className="animate-spin" /> : <BellRing size={15} />} Turn on notifications
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* What to be told about */}
      <section className={card}>
        <div>
          <h2 className="text-base font-medium text-neutral-200">Routine problems</h2>
          <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
            For routines you created. Each routine alerts at most once an hour for the same problem. A routine’s own Notify steps are sent regardless.
          </p>
        </div>
        <div className="divide-y divide-neutral-800">
          {ALERTS.map(a => (
            <div key={a.key} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-neutral-200">{a.title}</p>
                <p className="text-xs text-neutral-500">{a.hint}</p>
              </div>
              <button type="button" role="switch" aria-checked={prefs[a.key]} aria-label={a.title} onClick={() => setAlert(a.key, !prefs[a.key])}
                className="h-11 px-1.5 flex items-center shrink-0">
                <span className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${prefs[a.key] ? 'bg-blue-600' : 'bg-neutral-700'}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${prefs[a.key] ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </span>
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Every device of this user */}
      {devices.length > 0 && (
        <section className={card}>
          <h2 className="text-base font-medium text-neutral-200">Your devices</h2>
          <ul className="space-y-2">
            {devices.map(d => (
              <li key={d.id} className="flex items-center gap-3 p-3 bg-neutral-950 border border-neutral-800/80 rounded-xl">
                <Smartphone size={18} className="text-neutral-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-neutral-200 truncate">{d.label ?? 'Device'}{d.endpoint === thisEndpoint ? ' · this one' : ''}</p>
                  <p className="text-xs text-neutral-500">Added {since(d.created_at)} · last delivered {since(d.last_ok_at)}</p>
                </div>
                <button type="button" onClick={() => remove(d)} disabled={busy !== null} aria-label={`Remove ${d.label ?? 'device'}`}
                  className="size-11 flex items-center justify-center rounded-lg text-neutral-500 hover:text-red-400 hover:bg-neutral-800/60 shrink-0">
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
