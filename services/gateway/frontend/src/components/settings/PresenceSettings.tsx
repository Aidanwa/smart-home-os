import { useState } from 'react';
import { Check, Copy, House, Plane } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../context/AuthContext';
import { usePresence, type PersonPresence } from '../../hooks/usePresence';
import { ConfirmDialog } from '../ui/dialog';

/** Home / away per person (core/presence.py). Phones report it with iPhone Shortcuts automations
 *  (Arrive / Leave home) calling POST /api/presence/me with an API token; see docs/iphone-shortcuts.md. */

const SOURCE_LABEL: Record<string, string> = { shortcut: 'phone', wifi: 'home Wi-Fi', app: 'set by hand' };

function since(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Couldn’t copy', { description: 'Select the text and copy it by hand.' });
    }
  };
  return (
    <div className="space-y-1">
      <p className="text-xs text-neutral-500">{label}</p>
      <div className="flex gap-2 items-center">
        <code className="flex-1 min-w-0 break-all select-all text-xs text-neutral-200 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2.5">{value}</code>
        <button type="button" onClick={copy} aria-label={`Copy ${label}`}
          className="size-11 shrink-0 flex items-center justify-center rounded-lg bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-200">
          {copied ? <Check size={15} className="text-green-400" /> : <Copy size={15} />}
        </button>
      </div>
    </div>
  );
}

export function PresenceSettings() {
  const { user } = useAuth();
  const { data, setHome, stopTracking } = usePresence();
  const [busy, setBusy] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState<PersonPresence | null>(null);
  const url = `${window.location.origin}/api/presence/me`;

  const mark = async (p: PersonPresence, home: boolean) => {
    setBusy(p.user_id);
    if (await setHome(p.user_id, home)) toast.success(`${p.user_id === user?.id ? 'You’re' : `${p.username} is`} marked ${home ? 'home' : 'away'}`);
    setBusy(null);
  };

  // Throwing keeps the confirm dialog open after a failure (the toast says why).
  const forget = async () => {
    if (!forgetting) return;
    if (!(await stopTracking(forgetting.user_id))) throw new Error('not removed');
    toast.success(`${forgetting.username} no longer counts towards who’s home`);
  };

  const card = 'bg-neutral-900/40 border border-neutral-800 p-6 rounded-xl space-y-4';
  const btn = 'flex items-center justify-center gap-1.5 text-sm px-3 min-h-11 rounded-lg font-medium transition-colors shrink-0 disabled:opacity-50';
  const household = data?.household;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <section className={card}>
        <div>
          <h2 className="text-base font-medium text-neutral-200">Who’s home</h2>
          <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
            Each phone reports home or away. Routines can start when someone arrives or the last person leaves, or check whether anyone’s home.
            Only people whose phone reports count towards “anyone” and “everyone”.
          </p>
        </div>
        {household && household.anyone_home !== null && (
          <p className="text-sm text-neutral-300">
            {household.everyone_home ? 'Everyone is home.' : household.anyone_home ? 'Someone is home.' : 'Nobody is home.'}
            {household.anyone_since && <span className="text-neutral-500"> Since {since(household.anyone_home && !household.everyone_home ? household.everyone_since : household.anyone_since)}.</span>}
          </p>
        )}
        {data === null ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : (
          <ul className="space-y-2">
            {data.people.map(p => (
              <li key={p.user_id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 bg-neutral-950 border border-neutral-800/80 rounded-xl">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {p.home === null ? <House size={18} className="text-neutral-600 shrink-0" />
                    : p.home ? <House size={18} className="text-emerald-400 shrink-0" /> : <Plane size={18} className="text-neutral-400 shrink-0" />}
                  <div className="min-w-0">
                    <p className="text-sm text-neutral-200 truncate">{p.username}{p.user_id === user?.id ? ' · you' : ''}</p>
                    <p className="text-xs text-neutral-500 truncate">
                      {p.home === null ? 'Not set up' : `${p.home ? 'Home' : 'Away'} since ${since(p.since)}${p.source ? ` · ${SOURCE_LABEL[p.source] ?? p.source}` : ''}`}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" disabled={busy !== null || p.home === true} onClick={() => mark(p, true)}
                    className={`${btn} bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-200`}>Home</button>
                  <button type="button" disabled={busy !== null || p.home === false} onClick={() => mark(p, false)}
                    className={`${btn} bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-200`}>Away</button>
                  {p.home !== null && (
                    <button type="button" disabled={busy !== null} onClick={() => setForgetting(p)}
                      className={`${btn} text-neutral-500 hover:text-red-400 hover:bg-neutral-800/60`}>Stop tracking</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-neutral-600">Marking someone by hand is for when a phone is dead or left behind; their phone takes over again on its next report.</p>
      </section>

      <section className={card}>
        <div>
          <h2 className="text-base font-medium text-neutral-200">Set up your iPhone</h2>
          <p className="text-xs text-neutral-500 mt-1 leading-relaxed">Two automations in the Shortcuts app. Tailscale must be on (always-on VPN).</p>
        </div>
        <ol className="list-decimal pl-5 space-y-2 text-sm text-neutral-300 leading-relaxed">
          <li>Make an API token in Settings → Connections (one token can serve all your Shortcuts).</li>
          <li>Shortcuts → Automation → <span className="text-neutral-100">Arrive</span> → pick your home, then <span className="text-neutral-100">Run Immediately</span>.</li>
          <li>Add <span className="text-neutral-100">Get Contents of URL</span>: the URL below, method POST, header <code className="text-xs">Authorization</code> = <code className="text-xs">Bearer shos_…</code>, JSON body <code className="text-xs">state</code> = <code className="text-xs">home</code>.</li>
          <li>Do the same with <span className="text-neutral-100">Leave</span> and <code className="text-xs">state</code> = <code className="text-xs">away</code>.</li>
          <li>Optional: <span className="text-neutral-100">Wi-Fi</span> → joins your home network → the “home” request, in case the location one is late. (Not for leaving: phones drop Wi-Fi when they sleep.)</li>
        </ol>
        <CopyField label="URL" value={url} />
        <p className="text-xs text-neutral-600">Test it: run the automation by hand and watch your status above change.</p>
      </section>

      <ConfirmDialog
        open={forgetting !== null}
        onOpenChange={o => { if (!o) setForgetting(null); }}
        title={`Stop tracking ${forgetting?.username ?? ''}?`}
        description="They won’t count towards “anyone” or “everyone” home until their phone reports again. Turn off their Shortcuts too, or the next report brings them back."
        confirmLabel="Stop tracking"
        busyLabel="Removing…"
        destructive
        onConfirm={forget}
      />
    </div>
  );
}
