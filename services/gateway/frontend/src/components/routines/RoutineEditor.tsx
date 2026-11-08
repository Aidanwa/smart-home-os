import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Clock, Plus, Trash2 } from 'lucide-react';
import type { DeviceState } from '../../hooks/useDevices';
import type { GroupInfo } from '../../hooks/useGroups';
import type { PreviewResult } from '../../hooks/useRoutines';
import type { Action, AttributeMap, ConditionMode, LeafCondition, RoutineSpec, TempUnit, Trigger } from './types';
import { ACTION_LABEL, formatInTz, joinConditions, nextId, splitConditions } from './types';
import { ActionFields } from './ActionFields';
import { NumberField } from './NumberField';
import { TriggerRow } from './TriggerFields';
import { ConditionRow } from './ConditionFields';
import { newAction, newCondition, newTrigger } from './fieldLogic';
import { card, iconBtn, input, label } from './styles';

interface Props {
  initial: RoutineSpec;
  isNew: boolean;
  devices: Record<string, DeviceState>;
  groups: GroupInfo[];
  attributes: AttributeMap;
  tempUnit: TempUnit;
  timezone: string;
  preview: (spec: RoutineSpec) => Promise<{ result: PreviewResult | null; error: string | null }>;
  onSave: (spec: RoutineSpec) => Promise<string | null>;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
}

const addBtn = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-neutral-900 border border-neutral-800 text-neutral-300 hover:border-neutral-600';

export function RoutineEditor({ initial, isNew, devices, groups, attributes, tempUnit, timezone, preview, onSave, onDelete, onCancel }: Props) {
  const [spec, setSpec] = useState<RoutineSpec>(initial);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pv, setPv] = useState<{ result: PreviewResult | null; error: string | null }>({ result: null, error: null });

  // Controllable devices (anything reporting an on/off state), sorted by name.
  const deviceOptions = useMemo(
    () =>
      Object.entries(devices)
        .filter(([, d]) => typeof d.state === 'string')
        .map(([ieee, d]) => ({ ieee, name: (d.friendly_name as string) || ieee, hasColorTemp: d.color_temp !== undefined, hasBrightness: d.brightness !== undefined }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [devices],
  );

  // Live validation + next fire times, debounced. Only meaningful once there's a name and an action.
  const previewable = spec.name.trim().length > 0 && spec.actions.length > 0
    && !spec.actions.some(a => (a.type === 'spotify_play' && !a.uri) || (a.type === 'agent' && !a.prompt.trim()));
  useEffect(() => {
    if (!previewable) return;
    const handle = setTimeout(() => preview(spec).then(setPv), 400);
    return () => clearTimeout(handle);
  }, [spec]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (p: Partial<RoutineSpec>) => setSpec(s => ({ ...s, ...p }));
  const setAt = <T,>(list: T[], i: number, v: T) => list.map((x, j) => (j === i ? v : x));
  const without = <T,>(list: T[], i: number) => list.filter((_, j) => j !== i);
  const moveAction = (i: number, dir: -1 | 1) => {
    const next = [...spec.actions];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    patch({ actions: next });
  };

  const addAction = (type: Action['type']) => {
    const light = deviceOptions.find(d => d.hasBrightness)?.ieee ?? null;
    const a = newAction(type, nextId('a', spec.actions), deviceOptions[0]?.ieee ?? '', light, groups[0]?.id ?? null);
    patch({ actions: [...spec.actions, a] });
  };
  const missingMusic = spec.actions.some(a => a.type === 'spotify_play' && !a.uri);
  const emptyPrompt = spec.actions.some(a => a.type === 'agent' && !a.prompt.trim());

  const handleSave = async () => {
    setSaving(true);
    setSaveError(await onSave(spec));
    setSaving(false);
  };

  const cond = splitConditions(spec.conditions);
  const setConditions = (mode: ConditionMode, leaves: LeafCondition[]) => patch({ conditions: joinConditions(mode, leaves) });

  const canSave = previewable && !saving;
  const ctx = { attributes, tempUnit };

  return (
    <div className="flex flex-col gap-6 pb-6">
      <div>
        <label className={label}>Name</label>
        <input className={input} value={spec.name} placeholder="e.g. Weekday wake-up" maxLength={100}
          onChange={e => patch({ name: e.target.value })} />
      </div>

      {/* WHEN */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-200">When</h3>
          {spec.triggers.length > 1 && <p className="text-xs text-neutral-500">Any one of these starts it.</p>}
        </div>
        {spec.triggers.map((t, i) => (
          <TriggerRow key={t.id} trigger={t} ctx={ctx}
            onChange={nt => patch({ triggers: setAt<Trigger>(spec.triggers, i, nt) })}
            onRemove={() => patch({ triggers: without(spec.triggers, i) })} />
        ))}
        {spec.triggers.length === 0 && (
          <p className="text-xs text-neutral-500">Nothing starts it automatically: it only runs when you press Run now.</p>
        )}
        <div className="flex flex-wrap gap-2">
          {([['time', 'Time'], ['sun', 'Sunrise/sunset'], ['device', 'Device or sensor']] as const).map(([type, text]) => (
            <button key={type} type="button" className={addBtn}
              onClick={() => patch({ triggers: [...spec.triggers, newTrigger(type, nextId('t', spec.triggers), attributes)] })}>
              <Plus size={14} /> {text}
            </button>
          ))}
        </div>
      </section>

      {/* ONLY IF */}
      <section className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-neutral-200">Only if</h3>
            <p className="text-xs text-neutral-500">
              {cond.leaves.length === 0 ? 'Optional. Checked each time it starts (Run now skips them).'
                : cond.leaves.length === 1 ? 'This must be true when it starts.'
                : cond.mode === 'any' ? 'At least one of these must be true when it starts.'
                : 'All of these must be true when it starts.'}
            </p>
          </div>
          {cond.editable && cond.leaves.length > 1 && (
            <div className="flex bg-neutral-900/50 p-1 rounded-xl border border-neutral-800 shrink-0" role="group" aria-label="Match all or any">
              {([['all', 'All'], ['any', 'Any']] as const).map(([m, text]) => (
                <button key={m} type="button" onClick={() => setConditions(m, cond.leaves)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium ${cond.mode === m ? 'bg-neutral-700 text-white' : 'text-neutral-500'}`}>{text}</button>
              ))}
            </div>
          )}
        </div>
        {!cond.editable && (
          <p className="text-xs text-amber-400">These conditions were set up outside the editor (nested groups) and are kept as they are.</p>
        )}
        {cond.leaves.map((c, i) => (
          <div key={i} className="space-y-3">
            {i > 0 && <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 text-center">{cond.mode === 'any' ? 'or' : 'and'}</p>}
            <ConditionRow condition={c} attributes={attributes} tempUnit={tempUnit}
              onChange={nc => setConditions(cond.mode, setAt<LeafCondition>(cond.leaves, i, nc))}
              onRemove={() => setConditions(cond.mode, without(cond.leaves, i))} />
          </div>
        ))}
        {cond.editable && <div className="flex flex-wrap gap-2">
          {([['time_window', 'Between times'], ['days', 'Days'], ['sun', 'Dark / light'], ['device', 'Device reading']] as const).map(([type, text]) => (
            <button key={type} type="button" className={addBtn}
              onClick={() => setConditions(cond.mode, [...cond.leaves, newCondition(type, attributes)])}>
              <Plus size={14} /> {text}
            </button>
          ))}
        </div>}
      </section>

      {/* DO */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-neutral-200">Do</h3>
        {spec.actions.map((a, i) => (
          <div key={a.id} className={card}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-wider text-neutral-500">
                {i + 1}. {ACTION_LABEL[a.type]}
              </span>
              <div className="flex items-center gap-1">
                <button type="button" className={iconBtn} disabled={i === 0} onClick={() => moveAction(i, -1)} aria-label="Move up"><ArrowUp size={16} /></button>
                <button type="button" className={iconBtn} disabled={i === spec.actions.length - 1} onClick={() => moveAction(i, 1)} aria-label="Move down"><ArrowDown size={16} /></button>
                <button type="button" className={`${iconBtn} hover:text-red-400`} onClick={() => patch({ actions: without(spec.actions, i) })} aria-label="Remove"><Trash2 size={16} /></button>
              </div>
            </div>
            <ActionFields action={a} onChange={na => patch({ actions: setAt<Action>(spec.actions, i, na) })} deviceOptions={deviceOptions} groups={groups} />
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          {(['device', 'group', 'fade', 'delay', 'spotify_play', 'spotify_ctrl', 'agent'] as const).map(t => (
            <button key={t} type="button" onClick={() => addAction(t)} className={addBtn}>
              <Plus size={14} /> {ACTION_LABEL[t]}
            </button>
          ))}
        </div>
      </section>

      {/* ADVANCED */}
      <details>
        <summary className="text-sm text-neutral-400 cursor-pointer select-none">Advanced</summary>
        <div className="mt-3 space-y-4">
          <div>
            <label className={label}>If it triggers while already running</label>
            <select className={input} value={spec.mode} onChange={e => patch({ mode: e.target.value as RoutineSpec['mode'] })}>
              <option value="single">Ignore the new trigger (single)</option>
              <option value="restart">Cancel and start over (restart)</option>
            </select>
            <p className="text-xs text-neutral-500 mt-1">Restart suits motion lights: each new trigger restarts the "wait, then off" timer.</p>
          </div>
          <div>
            <label className={label}>Catch-up window (minutes)</label>
            <NumberField integer min={0} max={1440} className={input} value={spec.grace_minutes}
              onChange={grace_minutes => patch({ grace_minutes })} />
            <p className="text-xs text-neutral-500 mt-1">If the hub was down at a scheduled time, still run when it's back, up to this late. Runs up to 30 seconds late always go ahead, even at 0.</p>
          </div>
        </div>
      </details>

      {/* PREVIEW */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3 text-xs space-y-1.5">
        {missingMusic ? (
          <p className="text-amber-400">Pick some music for the Play music action.</p>
        ) : emptyPrompt ? (
          <p className="text-amber-400">Write an instruction for the Ask the agent action.</p>
        ) : !previewable ? (
          <p className="text-neutral-500">Add a name and at least one action to see when it will run.</p>
        ) : pv.error ? (
          <p className="text-red-400 whitespace-pre-line">{pv.error}</p>
        ) : pv.result ? (
          <>
            <p className="text-neutral-400 flex items-center gap-1.5"><Clock size={13} />
              {pv.result.next_fires.length
                ? <>Next: {pv.result.next_fires.slice(0, 3).map(f => formatInTz(f, timezone)).join(' · ')}</>
                : !spec.enabled ? 'Disabled: no scheduled runs'
                : spec.triggers.some(t => t.type === 'device') ? 'Runs when the device reading matches'
                : 'No scheduled runs'}
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
