import { useEffect, useMemo, useState } from 'react';
import { Plus, Sun, Thermometer, Trash2, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import type { DeviceState } from '../../../hooks/useDevices';
import { previewCurve, useCurves } from '../../../hooks/useCurves';
import { getDeviceKind } from '../../../lib/deviceUtils';
import { ConfirmDialog } from '../../ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../../ui/sheet';
import { NumberField } from '../NumberField';
import { card, iconBtn, input, label } from '../styles';
import type { Curve, CurvePoint, CurvePreview, CurveSpec, CurveWhen } from './types';
import { defaultCurve, homeTime, newPointId, whenLabel } from './types';

const sheetClass = 'bg-neutral-950 border-l-neutral-800 text-neutral-200 overflow-y-auto overflow-x-hidden data-[side=right]:w-full data-[side=right]:sm:max-w-lg p-4 sm:p-6 gap-4';

/** Lights that can follow a curve: anything with warmth or brightness (not plugs). */
function curveLights(devices: Record<string, DeviceState>) {
  return Object.entries(devices)
    .filter(([, st]) => getDeviceKind(st) === 'light' && (st.color_temp !== undefined || st.brightness !== undefined))
    .map(([ieee, st]) => ({ ieee, name: (st.friendly_name as string) || ieee }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function nowText(p: { warmth: number | null; brightness: number | null }) {
  const parts = [];
  if (p.warmth !== null) parts.push(`${Math.round(p.warmth)}% warm`);
  if (p.brightness !== null) parts.push(`${Math.round(p.brightness)}% bright`);
  return parts.join(' · ');
}

// ------------------------------------------------------------------ list

export function CurvesView({ devices, timezone, editing, setEditing }: {
  devices: Record<string, DeviceState>;
  timezone: string;
  editing: Curve | 'new' | null;
  setEditing: (c: Curve | 'new' | null) => void;
}) {
  const { curves, loading, save, remove } = useCurves();
  const [previews, setPreviews] = useState<Record<string, CurvePreview>>({});
  const names = useMemo(() => Object.fromEntries(curveLights(devices).map(l => [l.ieee, l.name])), [devices]);

  useEffect(() => {
    let live = true;
    Promise.all(curves.map(async c => [c.id, await previewCurve(c.points)] as const)).then(rows => {
      if (live) setPreviews(Object.fromEntries(rows.filter(([, p]) => typeof p !== 'string')) as Record<string, CurvePreview>);
    });
    return () => { live = false; };
  }, [curves]);

  const toggle = async (c: Curve) => {
    const { id, ...spec } = c;
    const err = await save(id, { ...spec, enabled: !c.enabled });
    if (err) toast.error(`Couldn’t ${c.enabled ? 'turn off' : 'turn on'} ${c.name}`, { description: err });
  };

  if (loading) {
    return <div className="h-24 rounded-xl bg-neutral-900/60 border border-neutral-800/60 animate-pulse" aria-busy="true" />;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-400 leading-relaxed">
        Lights following a curve change warmth on their own through the day, even while they’re off, so they come on right.
        Changing a light by hand (or from a routine) pauses its curve until the light is turned off.
      </p>
      {curves.length === 0 ? (
        <div className="py-12 text-center text-neutral-500">
          <TrendingUp className="mx-auto mb-4 opacity-50" size={44} />
          <h2 className="text-lg font-medium text-neutral-300">No day curves yet</h2>
          <button type="button" onClick={() => setEditing('new')}
            className="mt-4 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white">
            Start from the suggested curve
          </button>
        </div>
      ) : curves.map(c => {
        const p = previews[c.id];
        return (
          <div key={c.id} className="flex items-stretch gap-2 rounded-xl border border-neutral-800 bg-neutral-900/60">
            <button type="button" onClick={() => setEditing(c)} className="flex-1 min-w-0 text-left p-4">
              <div className="font-medium text-neutral-100 truncate">{c.name}</div>
              <div className="text-xs text-neutral-500 mt-1">
                {c.members.length === 0 ? 'No lights follow it yet'
                  : c.members.map(m => names[m] ?? m).join(', ')}
              </div>
              {p && c.enabled && (
                <div className="text-xs text-neutral-400 mt-1.5">
                  Now {nowText(p.now)}
                  {p.next.warmth && ` · ${Math.round(p.next.warmth.value)}% warm by ${homeTime(p.next.warmth.at, timezone)}`}
                </div>
              )}
            </button>
            <label className="flex items-center px-4 border-l border-neutral-800 cursor-pointer">
              <span className="sr-only">{c.enabled ? `Turn off ${c.name}` : `Turn on ${c.name}`}</span>
              <input type="checkbox" className="size-5 accent-blue-500" checked={c.enabled} onChange={() => toggle(c)} />
            </label>
          </div>
        );
      })}

      <Sheet open={editing !== null} onOpenChange={open => !open && setEditing(null)}>
        <SheetContent className={sheetClass}>
          {editing !== null && (
            <CurveEditor key={editing === 'new' ? 'new' : editing.id} curve={editing === 'new' ? null : editing}
              curves={curves} devices={devices} timezone={timezone}
              onSave={async spec => {
                const err = await save(editing === 'new' ? null : editing.id, spec);
                if (err) { toast.error('Couldn’t save the curve', { description: err }); return; }
                toast.success(`Saved ${spec.name}`);
                setEditing(null);
              }}
              onDelete={editing === 'new' ? undefined : async () => {
                const err = await remove(editing.id);
                if (err) { toast.error('Couldn’t delete the curve', { description: err }); throw new Error(err); }
                setEditing(null);
              }}
              onCancel={() => setEditing(null)} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ------------------------------------------------------------------ editor

function WhenFields({ when, onChange }: { when: CurveWhen; onChange: (w: CurveWhen) => void }) {
  const kind = when.type === 'time' ? 'time' : when.event;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className={`${input} w-auto`} aria-label="When" value={kind}
        onChange={e => onChange(e.target.value === 'time'
          ? { type: 'time', at: '21:00' }
          : { type: 'sun', event: e.target.value as 'sunrise' | 'noon' | 'sunset', offset_min: when.type === 'sun' ? when.offset_min : 0 })}>
        <option value="time">At a time</option>
        <option value="sunrise">Sunrise</option>
        <option value="noon">Midday (sun highest)</option>
        <option value="sunset">Sunset</option>
      </select>
      {when.type === 'time' ? (
        <input type="time" className={`${input} w-32`} aria-label="Time" value={when.at} required
          onChange={e => e.target.value && onChange({ ...when, at: e.target.value.slice(0, 5) })} />
      ) : (
        <span className="flex items-center gap-1.5 text-sm text-neutral-400">
          <NumberField value={Math.abs(when.offset_min)} min={0} max={360} integer ariaLabel="Minutes before or after"
            className={`${input} w-16 text-right`} onChange={v => onChange({ ...when, offset_min: when.offset_min < 0 ? -v : v })} />
          <span>min</span>
          <select className={`${input} w-auto`} aria-label="Before or after" value={when.offset_min < 0 ? 'before' : 'after'}
            onChange={e => onChange({ ...when, offset_min: (e.target.value === 'before' ? -1 : 1) * Math.abs(when.offset_min) })}>
            <option value="after">after</option>
            <option value="before">before</option>
          </select>
        </span>
      )}
    </div>
  );
}

function PercentField({ icon, text, value, min, onChange }: {
  icon: React.ReactNode; text: string; value: number | null; min: number; onChange: (v: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-2 min-h-11">
      <label className="flex items-center gap-2 text-sm text-neutral-300 cursor-pointer">
        <input type="checkbox" className="size-5 accent-blue-500" checked={value !== null}
          onChange={e => onChange(e.target.checked ? (text === 'Warmth' ? 50 : 100) : null)} />
        <span className="text-neutral-500" aria-hidden>{icon}</span>
        {text}
      </label>
      {value !== null ? (
        <span className="flex items-center gap-1 ml-auto">
          <NumberField value={value} min={min} max={100} integer ariaLabel={`${text} %`}
            className={`${input} w-16 text-right`} onChange={onChange} />
          <span className="text-sm text-neutral-500">%</span>
        </span>
      ) : (
        <span className="ml-auto text-xs text-neutral-600">not set here</span>
      )}
    </div>
  );
}

function CurveEditor({ curve, curves, devices, timezone, onSave, onDelete, onCancel }: {
  curve: Curve | null;
  curves: Curve[];
  devices: Record<string, DeviceState>;
  timezone: string;
  onSave: (spec: CurveSpec) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
}) {
  const [spec, setSpec] = useState<CurveSpec>(() => {
    if (!curve) return defaultCurve();
    const { id: _id, ...rest } = curve;  // eslint-disable-line @typescript-eslint/no-unused-vars
    return rest;
  });
  const [preview, setPreview] = useState<CurvePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const lights = useMemo(() => curveLights(devices), [devices]);
  const otherCurveOf = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of curves) if (c.id !== curve?.id) for (const m of c.members) out[m] = c.name;
    return out;
  }, [curves, curve]);

  // Preview (sun times, value now) follows the edits, debounced.
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const p = await previewCurve(spec.points);
      if (!live) return;
      if (typeof p === 'string') { setPreviewError(p); setPreview(null); } else { setPreviewError(null); setPreview(p); }
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [spec.points]);

  // Points in the order they happen today (sun points placed by today's sun times).
  const ordered = useMemo(() => {
    const minuteOf = (p: CurvePoint) => {
      if (p.when.type === 'time') { const [h, m] = p.when.at.split(':').map(Number); return h * 60 + m; }
      const iso = preview?.sun[p.when.event];
      if (!iso) return { sunrise: 420, noon: 720, sunset: 1080 }[p.when.event] + p.when.offset_min;
      const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: timezone })
        .formatToParts(new Date(iso));
      const part = (t: string) => Number(parts.find(x => x.type === t)?.value ?? 0);
      return part('hour') * 60 + part('minute') + p.when.offset_min;
    };
    return [...spec.points].sort((a, b) => minuteOf(a) - minuteOf(b));
  }, [spec.points, preview, timezone]);

  const setPoint = (id: string, patch: Partial<CurvePoint>) =>
    setSpec(s => ({ ...s, points: s.points.map(p => (p.id === id ? { ...p, ...patch } : p)) }));
  const removePoint = (id: string) => setSpec(s => ({ ...s, points: s.points.filter(p => p.id !== id) }));
  const addPoint = () => setSpec(s => ({ ...s, points: [...s.points, { id: newPointId(), when: { type: 'time', at: '12:00' }, warmth: 50, brightness: null }] }));
  const toggleMember = (ieee: string) => setSpec(s => ({
    ...s, members: s.members.includes(ieee) ? s.members.filter(m => m !== ieee) : [...s.members, ieee],
  }));

  const emptyPoint = spec.points.some(p => p.warmth === null && p.brightness === null);
  const canSave = spec.name.trim() !== '' && spec.points.length > 0 && !emptyPoint && !saving;

  return (
    <div className="flex flex-col gap-5">
      <SheetHeader className="text-left p-0 pr-8">
        <SheetTitle className="text-neutral-100">{curve ? 'Edit day curve' : 'New day curve'}</SheetTitle>
        <SheetDescription className="text-xs text-neutral-500">
          Set warmth and brightness at a few times of day; in between, lights change gradually. Add a point to hold a value.
        </SheetDescription>
      </SheetHeader>

      <div>
        <label className={label} htmlFor="curve-name">Name</label>
        <input id="curve-name" className={input} value={spec.name} maxLength={100}
          onChange={e => setSpec(s => ({ ...s, name: e.target.value }))} />
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 text-sm">
        {preview ? (
          <>
            <div className="text-neutral-200">Now: {nowText(preview.now) || 'nothing set'}</div>
            {(preview.next.warmth || preview.next.brightness) && (
              <div className="text-xs text-neutral-500 mt-1">
                {[preview.next.warmth && `${Math.round(preview.next.warmth.value)}% warm by ${homeTime(preview.next.warmth.at, timezone)}`,
                  preview.next.brightness && `${Math.round(preview.next.brightness.value)}% bright by ${homeTime(preview.next.brightness.at, timezone)}`]
                  .filter(Boolean).join(' · ')}
              </div>
            )}
            {(preview.sun.sunrise || preview.sun.sunset) && (
              <div className="text-xs text-neutral-600 mt-1">
                Today: sunrise {preview.sun.sunrise && homeTime(preview.sun.sunrise, timezone)}
                {preview.sun.noon && `, midday ${homeTime(preview.sun.noon, timezone)}`}
                , sunset {preview.sun.sunset && homeTime(preview.sun.sunset, timezone)}
              </div>
            )}
            {preview.warnings.map(w => <div key={w} className="text-xs text-amber-400 mt-1">{w}</div>)}
          </>
        ) : (
          <div className="text-xs text-neutral-500">{previewError ?? 'Working out today’s values…'}</div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-neutral-300">Points</h3>
        {ordered.map(p => (
          <div key={p.id} className={card}>
            <div className="flex items-start justify-between gap-2">
              <WhenFields when={p.when} onChange={when => setPoint(p.id, { when })} />
              <button type="button" className={iconBtn} aria-label={`Remove the ${whenLabel(p.when)} point`}
                disabled={spec.points.length <= 1} onClick={() => removePoint(p.id)}>
                <Trash2 size={16} />
              </button>
            </div>
            <PercentField icon={<Thermometer size={14} />} text="Warmth" value={p.warmth} min={0}
              onChange={warmth => setPoint(p.id, { warmth })} />
            <PercentField icon={<Sun size={14} />} text="Brightness" value={p.brightness} min={1}
              onChange={brightness => setPoint(p.id, { brightness })} />
            {p.warmth === null && p.brightness === null && (
              <p className="text-xs text-amber-400">Set warmth, brightness or both, or remove this point.</p>
            )}
          </div>
        ))}
        <button type="button" onClick={addPoint} disabled={spec.points.length >= 24}
          className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 min-h-11">
          <Plus size={16} /> Add a point
        </button>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-neutral-300">Lights that follow it</h3>
        {lights.length === 0 && <p className="text-xs text-neutral-500">No lights with warmth or brightness.</p>}
        <div className="rounded-xl border border-neutral-800 divide-y divide-neutral-800">
          {lights.map(l => (
            <label key={l.ieee} className="flex items-center gap-3 px-3 min-h-11 cursor-pointer">
              <input type="checkbox" className="size-5 accent-blue-500" checked={spec.members.includes(l.ieee)}
                onChange={() => toggleMember(l.ieee)} />
              <span className="flex-1 min-w-0 text-sm text-neutral-200 [overflow-wrap:anywhere]">{l.name}</span>
              {otherCurveOf[l.ieee] && (
                <span className="text-xs text-neutral-500 shrink-0">
                  {spec.members.includes(l.ieee) ? `moves from ${otherCurveOf[l.ieee]}` : `on ${otherCurveOf[l.ieee]}`}
                </span>
              )}
            </label>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-3 min-h-11 cursor-pointer">
        <input type="checkbox" className="size-5 accent-blue-500" checked={spec.enabled}
          onChange={e => setSpec(s => ({ ...s, enabled: e.target.checked }))} />
        <span className="text-sm text-neutral-200">On</span>
      </label>

      <div className="flex flex-wrap gap-2 pt-2">
        <button type="button" disabled={!canSave}
          onClick={async () => { setSaving(true); try { await onSave({ ...spec, name: spec.name.trim() }); } finally { setSaving(false); } }}
          className="flex-1 min-h-11 rounded-xl px-4 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel}
          className="flex-1 min-h-11 rounded-xl px-4 text-sm font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-200">
          Cancel
        </button>
        {onDelete && (
          <button type="button" onClick={() => setConfirmDelete(true)}
            className="basis-full min-h-11 rounded-xl px-4 text-sm font-medium bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20">
            Delete curve
          </button>
        )}
      </div>

      {onDelete && (
        <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title="Delete this curve?"
          description={<>Lights following <strong className="text-white">{spec.name}</strong> stay as they are and stop changing on their own.</>}
          confirmLabel="Delete" destructive onConfirm={onDelete} />
      )}
    </div>
  );
}
