import { useState } from 'react';
import { History, Pencil, Play, Plus, Workflow } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { DeviceState } from '../../hooks/useDevices';
import { useGroups } from '../../hooks/useGroups';
import { useDeviceAttributes, useRoutines, useTempUnit } from '../../hooks/useRoutines';
import { RoutineEditor } from './RoutineEditor';
import { RunHistory } from './RunHistory';
import type { Routine, RoutineSpec } from './types';
import { STATUS_STYLE, emptyRoutine, formatInTz, relativeTime, summarizeRoutine } from './types';

const sheetClass = 'bg-neutral-950 border-l-neutral-800 text-neutral-200 overflow-y-auto overflow-x-hidden data-[side=right]:w-full data-[side=right]:sm:max-w-lg p-4 sm:p-6 gap-4';

type Panel = { kind: 'edit'; routine: Routine | null } | { kind: 'history'; routine: Routine } | null;

function toSpec(r: Routine): RoutineSpec {
  const { name, description, enabled, mode, grace_minutes, triggers, conditions, actions } = r;
  return { name, description, enabled, mode, grace_minutes, triggers, conditions, actions };
}

export function RoutinesView({ devices }: { devices: Record<string, DeviceState> }) {
  const { routines, timezone, schedulerActive, loading, error, save, remove, setEnabled, runNow, fetchRuns, preview } = useRoutines();
  const { groups } = useGroups();
  const attributes = useDeviceAttributes();
  const [tempUnit, setTempUnit] = useTempUnit();
  const ctx = { attributes, tempUnit };
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<{ id: string; text: string; bad: boolean } | null>(null);

  const flash = (id: string, text: string, bad: boolean) => {
    setNotice({ id, text, bad });
    setTimeout(() => setNotice(n => (n?.id === id && n.text === text ? null : n)), 4000);
  };

  const handleRun = async (r: Routine) => {
    const err = await runNow(r.id);
    flash(r.id, err ?? 'Started', !!err);
  };

  const editing = panel?.kind === 'edit' ? panel.routine : null;

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-10 animate-in fade-in duration-500">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-tight">Routines</h1>
          <p className="text-xs text-neutral-500 mt-1">Times are in {timezone}.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
        <div className="flex bg-neutral-900/50 p-1 rounded-xl border border-neutral-800" role="group" aria-label="Temperature unit">
          {(['F', 'C'] as const).map(u => (
            <button key={u} type="button" onClick={() => setTempUnit(u)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium ${tempUnit === u ? 'bg-neutral-700 text-white' : 'text-neutral-500'}`}>°{u}</button>
          ))}
        </div>
        <button type="button" onClick={() => setPanel({ kind: 'edit', routine: null })}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white shrink-0">
          <Plus size={16} /> New
        </button>
        </div>
      </header>

      {!schedulerActive && (
        <div className="mb-4 p-3 text-xs bg-amber-950/40 border border-amber-900 text-amber-300 rounded-lg">
          The scheduler isn't running on this gateway, so routines won't fire. Check the gateway logs.
        </div>
      )}
      {error && <div className="mb-4 p-3 text-xs bg-red-950/50 border border-red-900 text-red-400 rounded-lg">{error}</div>}

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : routines.length === 0 ? (
        <div className="py-20 text-center text-neutral-500">
          <Workflow className="mx-auto mb-4 opacity-50" size={48} />
          <h2 className="text-lg font-medium text-neutral-300">No routines yet</h2>
          <p className="text-xs mt-1 max-w-xs mx-auto leading-relaxed">Make lights and plugs change on their own: on a schedule, at sunset, or when a sensor or button reports something.</p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {routines.map(r => (
            <article key={r.id} className={`bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-3 ${r.enabled ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-medium text-neutral-100 truncate">{r.name}</h2>
                  <p className="text-xs text-neutral-400 mt-0.5">{summarizeRoutine(r, ctx)}</p>
                </div>
                <button type="button" role="switch" aria-checked={r.enabled} aria-label={r.enabled ? 'Disable' : 'Enable'}
                  onClick={() => setEnabled(r.id, !r.enabled)}
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${r.enabled ? 'bg-blue-600' : 'bg-neutral-700'}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${r.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                {r.running ? (
                  <span className={`px-2 py-0.5 rounded-md border font-medium ${STATUS_STYLE.running}`}>running</span>
                ) : r.last_run_status ? (
                  <span className={`px-2 py-0.5 rounded-md border font-medium ${STATUS_STYLE[r.last_run_status]}`}>
                    {r.last_run_status} · {relativeTime(r.last_run_at)}
                  </span>
                ) : (
                  <span className="text-neutral-500">Never run</span>
                )}
                {r.enabled && r.next_fire_at && <span className="text-neutral-500">Next: {formatInTz(r.next_fire_at, timezone)}</span>}
              </div>

              {notice?.id === r.id && <p className={`text-xs ${notice.bad ? 'text-red-400' : 'text-green-400'}`}>{notice.text}</p>}

              <div className="flex gap-2">
                <button type="button" onClick={() => handleRun(r)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-200">
                  <Play size={14} /> Run now
                </button>
                <button type="button" onClick={() => setPanel({ kind: 'history', routine: r })} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-200">
                  <History size={14} /> History
                </button>
                <button type="button" onClick={() => setPanel({ kind: 'edit', routine: r })} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-200 ml-auto">
                  <Pencil size={14} /> Edit
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Sheet open={panel !== null} onOpenChange={open => !open && setPanel(null)}>
        <SheetContent className={sheetClass}>
          {panel?.kind === 'edit' && (
            <>
              <SheetHeader className="text-left p-0 pr-8">
                <SheetTitle className="text-neutral-100">{editing ? 'Edit routine' : 'New routine'}</SheetTitle>
                <SheetDescription className="text-xs text-neutral-500">{editing ? `Created by ${editing.owner_username ?? 'unknown'}` : 'Runs on the hub, even when no one has the app open.'}</SheetDescription>
              </SheetHeader>
              <RoutineEditor
                key={editing?.id ?? 'new'}
                initial={editing ? toSpec(editing) : emptyRoutine()}
                isNew={!editing}
                devices={devices}
                groups={groups}
                attributes={attributes}
                tempUnit={tempUnit}
                timezone={timezone}
                preview={preview}
                onSave={async spec => {
                  const err = await save(spec, editing?.id);
                  if (!err) setPanel(null);
                  return err;
                }}
                onDelete={editing ? async () => { await remove(editing.id); setPanel(null); } : undefined}
                onCancel={() => setPanel(null)}
              />
            </>
          )}
          {panel?.kind === 'history' && (
            <>
              <SheetHeader className="text-left p-0 pr-8">
                <SheetTitle className="text-neutral-100">{panel.routine.name}</SheetTitle>
                <SheetDescription className="text-xs text-neutral-500">Recent runs, newest first. Tap a run to see each step.</SheetDescription>
              </SheetHeader>
              <RunHistory routineId={panel.routine.id} timezone={timezone} fetchRuns={fetchRuns} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
