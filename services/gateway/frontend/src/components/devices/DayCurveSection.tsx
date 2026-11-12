import { useState } from 'react';
import { toast } from 'sonner';
import { resumeLightCurve, setLightCurve, useCurves, useCurveStatus } from '../../hooks/useCurves';
import { homeTime } from '../routines/curves/types';

/** A light's "Day curve" block in its drawer: which curve it follows, what it wants now, and the
 *  pause (with Resume) after someone changed the light by hand. */
export function DayCurveSection({ ieee, name }: { ieee: string; name: string }) {
  const { curves, loading } = useCurves();
  const status = useCurveStatus()[ieee];
  const [busy, setBusy] = useState(false);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const pick = async (curveId: string) => {
    setBusy(true);
    const err = await setLightCurve(ieee, curveId || null);
    setBusy(false);
    if (err) toast.error(`Couldn’t change ${name}’s day curve`, { description: err });
  };
  const resume = async () => {
    setBusy(true);
    const err = await resumeLightCurve(ieee);
    setBusy(false);
    if (err) toast.error(`Couldn’t resume ${name}’s day curve`, { description: err });
  };

  if (loading) return null;
  const t = status?.target;
  const now = t ? [t.warmth !== null && `${t.warmth}% warm`, t.brightness !== null && `${t.brightness}% bright`].filter(Boolean).join(', ') : '';
  const nextParts = status ? [
    status.next.warmth && `${Math.round(status.next.warmth.value)}% warm by ${homeTime(status.next.warmth.at, tz)}`,
    status.next.brightness && `${Math.round(status.next.brightness.value)}% bright by ${homeTime(status.next.brightness.at, tz)}`,
  ].filter(Boolean) : [];
  return (
    <div className="p-3 rounded-xl border border-neutral-800/50 bg-neutral-900/50 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-neutral-200">Day curve</span>
        {curves.length > 0 ? (
          <select aria-label="Day curve" disabled={busy} value={status?.curve_id ?? ''} onChange={e => pick(e.target.value)}
            className="bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-1.5 text-sm text-neutral-100 max-w-[60%]">
            <option value="">None</option>
            {curves.map(c => <option key={c.id} value={c.id}>{c.name}{c.enabled ? '' : ' (off)'}</option>)}
          </select>
        ) : (
          <a href="#routines/curves" className="text-xs text-blue-400">Make one in Routines → Curves</a>
        )}
      </div>
      {status && !status.enabled && <p className="text-xs text-neutral-500">That curve is turned off.</p>}
      {status?.enabled && !status.paused && now && (
        <p className="text-xs text-neutral-500">
          Now {now}{nextParts.length > 0 ? `; ${nextParts.join(', ')}` : ''}.
          Warmth changes even while the light is off; brightness while it’s on.
        </p>
      )}
      {status?.enabled && status.paused && (
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs text-amber-300/90">
            Paused: {status.paused.reason === 'external' ? 'changed outside the app' : 'changed by hand or a routine'} at{' '}
            {homeTime(status.paused.since, tz)}. It follows the curve again once the light is turned off.
          </p>
          <button type="button" onClick={resume} disabled={busy}
            className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-200">
            Resume now
          </button>
        </div>
      )}
    </div>
  );
}
