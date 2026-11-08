import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Clock, Plus, Trash2 } from 'lucide-react';
import type { DeviceState } from '../../hooks/useDevices';
import type { GroupInfo } from '../../hooks/useGroups';
import type { PreviewResult } from '../../hooks/useRoutines';
import type { Action, Day, RoutineSpec, SetPayload, TimeTrigger } from './types';
import { DAYS, WEEKDAYS, WEEKEND, describeDays, formatInTz, nextId } from './types';

const input = 'w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500 outline-none text-neutral-200';
const label = 'block text-xs font-medium text-neutral-400 mb-1';
const card = 'bg-neutral-900 border border-neutral-800 rounded-xl p-3 space-y-3';
const chip = (on: boolean) =>
  `px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${on ? 'bg-blue-500/15 border-blue-500/40 text-blue-300' : 'bg-neutral-950 border-neutral-800 text-neutral-500'}`;

interface Props {
  initial: RoutineSpec;
  isNew: boolean;
  devices: Record<string, DeviceState>;
  groups: GroupInfo[];
  timezone: string;
  preview: (spec: RoutineSpec) => Promise<{ result: PreviewResult | null; error: string | null }>;
  onSave: (spec: RoutineSpec) => Promise<string | null>;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
}

export function RoutineEditor({ initial, isNew, devices, groups, timezone, preview, onSave, onDelete, onCancel }: Props) {
  const [spec, setSpec] = useState<RoutineSpec>(initial);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pv, setPv] = useState<{ result: PreviewResult | null; error: string | null }>({ result: null, error: null });

  // Controllable devices (anything reporting an on/off state), sorted by name.
  const deviceOptions = useMemo(
    () =>
      Object.entries(devices)
        .filter(([, d]) => typeof d.state === 'string')
        .map(([ieee, d]) => ({ ieee, name: (d.friendly_name as string) || ieee, hasColorTemp: d.color_temp !== undefined }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [devices],
  );

  // Live validation + next fire times, debounced. Only meaningful once there's a name and an action.
  const previewable = spec.name.trim().length > 0 && spec.actions.length > 0;
  useEffect(() => {
    if (!previewable) return;
    const handle = setTimeout(() => preview(spec).then(setPv), 400);
    return () => clearTimeout(handle);
  }, [spec]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (p: Partial<RoutineSpec>) => setSpec(s => ({ ...s, ...p }));
  const setTrigger = (i: number, t: TimeTrigger) => patch({ triggers: spec.triggers.map((x, j) => (j === i ? t : x)) });
  const setAction = (i: number, a: Action) => patch({ actions: spec.actions.map((x, j) => (j === i ? a : x)) });
  const moveAction = (i: number, dir: -1 | 1) => {
    const next = [...spec.actions];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    patch({ actions: next });
  };

  const addAction = (type: Action['type']) => {
    const id = nextId('a', spec.actions);
    const a: Action =
      type === 'device' ? { id, type, device: deviceOptions[0]?.ieee ?? '', set: { state: 'ON' }, stop_on_error: false }
      : type === 'group' ? { id, type, group: groups[0]?.id ?? 0, set: { state: 'ON' }, stop_on_error: false }
      : { id, type, seconds: 60, stop_on_error: false };
    patch({ actions: [...spec.actions, a] });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(await onSave(spec));
    setSaving(false);
  };

  const canSave = spec.name.trim().length > 0 && spec.actions.length > 0 && !saving;

  return (
    <div className="flex flex-col gap-6 pb-6">
      <div>
        <label className={label}>Name</label>
        <input className={input} value={spec.name} placeholder="e.g. Weekday wake-up" maxLength={100}
          onChange={e => patch({ name: e.target.value })} />
      </div>

      {/* WHEN */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-neutral-200">When</h3>
        {spec.triggers.map((t, i) => (
          <TriggerRow key={t.id} trigger={t} onChange={nt => setTrigger(i, nt)}
            onRemove={() => patch({ triggers: spec.triggers.filter((_, j) => j !== i) })} />
        ))}
        {spec.triggers.length === 0 && (
          <p className="text-xs text-neutral-500">No schedule: this routine only runs when you press Run now.</p>
        )}
        <button type="button" className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300"
          onClick={() => patch({ triggers: [...spec.triggers, { id: nextId('t', spec.triggers), type: 'time', at: '07:00', days: null }] })}>
          <Plus size={16} /> Add a time
        </button>
      </section>

      {/* DO */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-neutral-200">Do</h3>
        {spec.actions.map((a, i) => (
          <div key={a.id} className={card}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-wider text-neutral-500">
                {i + 1}. {a.type === 'device' ? 'Device' : a.type === 'group' ? 'Group' : 'Wait'}
              </span>
              <div className="flex items-center gap-1 text-neutral-500">
                <button type="button" className="p-1.5 hover:text-neutral-200 disabled:opacity-30" disabled={i === 0} onClick={() => moveAction(i, -1)} aria-label="Move up"><ArrowUp size={16} /></button>
                <button type="button" className="p-1.5 hover:text-neutral-200 disabled:opacity-30" disabled={i === spec.actions.length - 1} onClick={() => moveAction(i, 1)} aria-label="Move down"><ArrowDown size={16} /></button>
                <button type="button" className="p-1.5 hover:text-red-400" onClick={() => patch({ actions: spec.actions.filter((_, j) => j !== i) })} aria-label="Remove"><Trash2 size={16} /></button>
              </div>
            </div>
            <ActionFields action={a} onChange={na => setAction(i, na)} deviceOptions={deviceOptions} groups={groups} />
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          {(['device', 'group', 'delay'] as const).map(t => (
            <button key={t} type="button" onClick={() => addAction(t)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-neutral-900 border border-neutral-800 text-neutral-300 hover:border-neutral-600">
              <Plus size={14} /> {t === 'device' ? 'Device' : t === 'group' ? 'Group' : 'Wait'}
            </button>
          ))}
        </div>
      </section>

      {/* ADVANCED */}
      <details className="group">
        <summary className="text-sm text-neutral-400 cursor-pointer select-none">Advanced</summary>
        <div className="mt-3 space-y-4">
          <div>
            <label className={label}>If it triggers while already running</label>
            <select className={input} value={spec.mode} onChange={e => patch({ mode: e.target.value as RoutineSpec['mode'] })}>
              <option value="single">Ignore the new trigger (single)</option>
              <option value="restart">Cancel and start over (restart)</option>
            </select>
          </div>
          <div>
            <label className={label}>Catch-up window (minutes)</label>
            <input type="number" min={0} max={1440} className={input} value={spec.grace_minutes}
              onChange={e => patch({ grace_minutes: Math.max(0, Math.min(1440, parseInt(e.target.value) || 0)) })} />
            <p className="text-xs text-neutral-500 mt-1">If the hub was down at the scheduled time, still run when it's back, up to this late. Runs up to 30 seconds late always go ahead, even at 0.</p>
          </div>
        </div>
      </details>

      {/* PREVIEW */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3 text-xs space-y-1.5">
        {!previewable ? (
          <p className="text-neutral-500">Add a name and at least one action to see when it will run.</p>
        ) : pv.error ? (
          <p className="text-red-400 whitespace-pre-line">{pv.error}</p>
        ) : pv.result ? (
          <>
            <p className="text-neutral-400 flex items-center gap-1.5"><Clock size={13} />
              {pv.result.next_fires.length
                ? <>Next: {pv.result.next_fires.slice(0, 3).map(f => formatInTz(f, timezone)).join(' · ')}</>
                : spec.enabled ? 'No scheduled runs' : 'Disabled: no scheduled runs'}
            </p>
            {pv.result.warnings.map(w => <p key={w} className="text-amber-400">{w}</p>)}
          </>
        ) : (
          <p className="text-neutral-500">Checking…</p>
        )}
        <p className="text-neutral-600">Times are in {timezone}.</p>
      </div>

      {saveError && <div className="p-3 text-xs bg-red-950/50 border border-red-900 text-red-400 rounded-lg whitespace-pre-line">{saveError}</div>}

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!canSave} onClick={handleSave}
          className="flex-1 min-w-32 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40">
          {saving ? 'Saving…' : isNew ? 'Create routine' : 'Save changes'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm text-neutral-300 bg-neutral-900 border border-neutral-800">Cancel</button>
        {onDelete && (
          <button type="button" onClick={() => window.confirm(`Delete "${initial.name}"? Its run history goes too.`) && onDelete()}
            className="px-4 py-2 rounded-lg text-sm text-red-400 bg-red-500/10 border border-red-500/20">Delete</button>
        )}
      </div>
    </div>
  );
}

function TriggerRow({ trigger, onChange, onRemove }: { trigger: TimeTrigger; onChange: (t: TimeTrigger) => void; onRemove: () => void }) {
  const days = trigger.days ?? DAYS;
  const toggleDay = (d: Day) => {
    const next = days.includes(d) ? days.filter(x => x !== d) : DAYS.filter(x => x === d || days.includes(x));
    if (next.length === 0) return;  // at least one day
    onChange({ ...trigger, days: next.length === 7 ? null : next });
  };
  const preset = (p: Day[] | null) => onChange({ ...trigger, days: p });

  return (
    <div className={card}>
      <div className="flex items-center gap-2">
        <input type="time" className={`${input} w-32`} value={trigger.at} required
          onChange={e => e.target.value && onChange({ ...trigger, at: e.target.value.slice(0, 5) })} />
        <span className="text-xs text-neutral-500 flex-1">{describeDays(trigger.days)}</span>
        <button type="button" className="p-1.5 text-neutral-500 hover:text-red-400" onClick={onRemove} aria-label="Remove time"><Trash2 size={16} /></button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {DAYS.map(d => (
          <button key={d} type="button" className={chip(days.includes(d))} onClick={() => toggleDay(d)}>
            {d[0].toUpperCase() + d.slice(1, 3)}
          </button>
        ))}
      </div>
      <div className="flex gap-3 text-xs text-neutral-500">
        <button type="button" className="hover:text-neutral-300" onClick={() => preset(null)}>Every day</button>
        <button type="button" className="hover:text-neutral-300" onClick={() => preset(WEEKDAYS)}>Weekdays</button>
        <button type="button" className="hover:text-neutral-300" onClick={() => preset(WEEKEND)}>Weekends</button>
      </div>
    </div>
  );
}

interface ActionFieldsProps {
  action: Action;
  onChange: (a: Action) => void;
  deviceOptions: { ieee: string; name: string; hasColorTemp: boolean }[];
  groups: GroupInfo[];
}

function ActionFields({ action, onChange, deviceOptions, groups }: ActionFieldsProps) {
  const stopToggle = (
    <label className="flex items-center gap-2 text-xs text-neutral-500">
      <input type="checkbox" checked={action.stop_on_error} onChange={e => onChange({ ...action, stop_on_error: e.target.checked })} />
      Stop the routine if this fails
    </label>
  );

  if (action.type === 'delay') {
    const unit = action.seconds % 3600 === 0 ? 3600 : action.seconds % 60 === 0 ? 60 : 1;
    return (
      <>
        <div className="flex gap-2">
          <input type="number" min={1} className={input} value={action.seconds / unit}
            onChange={e => onChange({ ...action, seconds: Math.max(1, Math.min(43200, (parseFloat(e.target.value) || 1) * unit)) })} />
          <select className={`${input} w-32`} value={unit}
            onChange={e => onChange({ ...action, seconds: Math.min(43200, (action.seconds / unit) * parseInt(e.target.value)) })}>
            <option value={1}>seconds</option>
            <option value={60}>minutes</option>
            <option value={3600}>hours</option>
          </select>
        </div>
      </>
    );
  }

  const selectedDevice = action.type === 'device' ? deviceOptions.find(d => d.ieee === action.device) : undefined;
  const showColorTemp = action.type === 'group' || !!selectedDevice?.hasColorTemp;

  return (
    <>
      {action.type === 'device' ? (
        <select className={input} value={action.device} onChange={e => onChange({ ...action, device: e.target.value })}>
          {!selectedDevice && <option value={action.device}>{action.device ? `Missing device (${action.device})` : 'Pick a device'}</option>}
          {deviceOptions.map(d => <option key={d.ieee} value={d.ieee}>{d.name}</option>)}
        </select>
      ) : (
        <select className={input} value={action.group} onChange={e => onChange({ ...action, group: parseInt(e.target.value) })}>
          {!groups.some(g => g.id === action.group) && <option value={action.group}>{groups.length ? `Missing group (${action.group})` : 'No groups exist'}</option>}
          {groups.map(g => <option key={g.id} value={g.id}>{g.friendly_name}</option>)}
        </select>
      )}
      <PayloadFields value={action.set} showColorTemp={showColorTemp} onChange={set => onChange({ ...action, set })} />
      {stopToggle}
    </>
  );
}

function PayloadFields({ value, onChange, showColorTemp }: { value: SetPayload; onChange: (v: SetPayload) => void; showColorTemp: boolean }) {
  const set = (k: keyof SetPayload, v: SetPayload[keyof SetPayload]) => {
    const next = { ...value, [k]: v };
    if (v === null || v === undefined) delete next[k];
    onChange(next);
  };
  const pct = value.brightness != null ? Math.round((value.brightness / 254) * 100) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {([['ON', 'On'], ['OFF', 'Off'], ['TOGGLE', 'Toggle'], [null, 'Leave as is']] as const).map(([v, text]) => (
          <button key={text} type="button" className={chip((value.state ?? null) === v)} onClick={() => set('state', v)}>{text}</button>
        ))}
      </div>
      <OptionalNumber label="Brightness (%)" value={pct} min={1} max={100} defaultValue={100}
        onChange={v => set('brightness', v == null ? null : Math.round((v / 100) * 254))} />
      {showColorTemp && (
        <OptionalNumber label="Colour temperature (mired, 150 cool – 500 warm)" value={value.color_temp ?? null} min={150} max={500} defaultValue={370}
          onChange={v => set('color_temp', v)} />
      )}
      <OptionalNumber label="Transition (seconds)" value={value.transition ?? null} min={0} max={3600} defaultValue={2}
        onChange={v => set('transition', v)} />
    </div>
  );
}

function OptionalNumber({ label: text, value, min, max, defaultValue, onChange }: {
  label: string; value: number | null; min: number; max: number; defaultValue: number; onChange: (v: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-2 text-xs text-neutral-400 flex-1">
        <input type="checkbox" checked={value != null} onChange={e => onChange(e.target.checked ? defaultValue : null)} />
        {text}
      </label>
      {value != null && (
        <input type="number" min={min} max={max} className={`${input} w-24`} value={value}
          onChange={e => onChange(Math.max(min, Math.min(max, parseFloat(e.target.value) || min)))} />
      )}
    </div>
  );
}
