import { useCallback, useMemo, useRef, useState } from 'react';
import { ArrowLeft, History, Plus, Workflow } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { DeviceState } from '../../hooks/useDevices';
import { useGroups } from '../../hooks/useGroups';
import { useDeviceAttributes, useRoutines } from '../../hooks/useRoutines';
import { RoutineEditor } from './RoutineEditor';
import { RunHistory } from './RunHistory';
import { RoutineList } from './RoutineList';
import { RoutineActivity } from './RoutineActivity';
import type { Routine, RoutineSpec, TempUnit } from './types';
import { emptyRoutine } from './types';
import { ConfirmDialog } from '../ui/dialog';

const sheetClass = 'bg-neutral-950 border-l-neutral-800 text-neutral-200 overflow-y-auto overflow-x-hidden data-[side=right]:w-full data-[side=right]:sm:max-w-lg p-4 sm:p-6 gap-4';

type Panel = { kind: 'edit'; routine: Routine | null } | { kind: 'history'; routine: Routine } | null;

function toSpec(r: Routine): RoutineSpec {
  const { name, description, enabled, mode, grace_minutes, triggers, conditions, actions } = r;
  return { name, description, enabled, mode, grace_minutes, triggers, conditions, actions };
}

export function RoutinesView({ devices }: { devices: Record<string, DeviceState> }) {
  const { routines, timezone, schedulerActive, loading, error, save, remove, setEnabled, runNow, duplicate, setReviewed, fetchRuns, preview } = useRoutines();
  const [view, setView] = useState<'list' | 'activity'>('list');
  const { groups } = useGroups();
  const attributes = useDeviceAttributes();
  const tempUnit: TempUnit = 'F';  // temperatures are always shown/entered in °F (stored as °C, Z2M native)
  const ctx = useMemo(() => ({ attributes, tempUnit }), [attributes]);
  const [panel, setPanel] = useState<Panel>(null);
  // Closing the editor by swiping, tapping outside or Escape asks first if there are unsaved edits.
  // (Cancel, Save and Delete close it directly.)
  const editorDirty = useRef(false);
  const setEditorDirty = useCallback((d: boolean) => { editorDirty.current = d; }, []);
  const closePanel = () => { editorDirty.current = false; setPanel(null); };
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const requestClose = () => {
    if (editorDirty.current) setConfirmDiscard(true);
    else closePanel();
  };
  const handleRun = async (r: Routine) => {
    const err = await runNow(r.id);
    if (err) toast.error(`Couldn’t run ${r.name}`, { description: err });
    else toast.success(`Started ${r.name}`);
  };

  const handleDuplicate = async (r: Routine) => {
    const { routine, error: err } = await duplicate(r.id);
    if (routine) setPanel({ kind: 'edit', routine });  // the copy starts disabled; open it to adjust
    else toast.error(`Couldn’t duplicate ${r.name}`, { description: err ?? undefined });
  };

  const handleReviewed = async (r: Routine) => {
    const err = await setReviewed(r.id, true);
    if (err) toast.error(`Couldn’t mark ${r.name} as reviewed`, { description: err });
    else toast.success(`${r.name} marked as reviewed`, {
      description: 'It comes back here if a later run has a problem.',
      action: { label: 'Undo', onClick: () => { setReviewed(r.id, false); } },
    });
  };

  const openRoutine = (id: string) => {
    const r = routines.find(x => x.id === id);
    if (r) setPanel({ kind: 'edit', routine: r });
    else toast.error('That routine no longer exists');
  };

  const editing = panel?.kind === 'edit' ? panel.routine : null;

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-10 animate-in fade-in duration-500">
      <header className="mb-6 flex items-center justify-between gap-4">
        {view === 'list' ? (
          <h1 className="text-2xl font-medium tracking-tight">Routines</h1>
        ) : (
          <div className="flex items-center gap-1 min-w-0 -ml-2">
            <button type="button" onClick={() => setView('list')} aria-label="Back to routines"
              className="size-11 shrink-0 flex items-center justify-center rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-900">
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-2xl font-medium tracking-tight truncate">Activity</h1>
          </div>
        )}
        <div className="flex items-center gap-2 shrink-0">
        {view === 'list' && (
          <button type="button" onClick={() => setView('activity')}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-200 shrink-0">
            <History size={16} /> Activity
          </button>
        )}
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
        <div className="space-y-2" aria-busy="true" aria-label="Loading routines">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-20 rounded-xl bg-neutral-900/60 border border-neutral-800/60 animate-pulse" />)}
        </div>
      ) : view === 'activity' ? (
        <RoutineActivity timezone={timezone} onOpenRoutine={openRoutine} />
      ) : routines.length === 0 ? (
        <div className="py-20 text-center text-neutral-500">
          <Workflow className="mx-auto mb-4 opacity-50" size={48} />
          <h2 className="text-lg font-medium text-neutral-300">No routines yet</h2>
          <p className="text-xs mt-1 max-w-xs mx-auto leading-relaxed">Make lights and plugs change on their own: on a schedule, at sunset, or when a sensor or button reports something.</p>
        </div>
      ) : (
        <RoutineList routines={routines} timezone={timezone} groups={groups} ctx={ctx}
          onOpen={r => setPanel({ kind: 'edit', routine: r })}
          onHistory={r => setPanel({ kind: 'history', routine: r })}
          onRun={handleRun}
          onDuplicate={handleDuplicate}
          onReviewed={handleReviewed}
          onToggle={async r => {
            const err = await setEnabled(r.id, !r.enabled);
            if (err) toast.error(`Couldn’t turn ${r.enabled ? 'off' : 'on'} ${r.name}`, { description: err });
          }} />
      )}

      <Sheet open={panel !== null} onOpenChange={open => !open && requestClose()}>
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
                  if (!err) closePanel();
                  return err;
                }}
                onDelete={editing ? async () => {
                  const err = await remove(editing.id);
                  if (err) {
                    toast.error(`Couldn’t delete ${editing.name}`, { description: err });
                    throw new Error(err);  // keeps the confirm open
                  }
                  toast.success(`Deleted ${editing.name}`);
                  closePanel();
                } : undefined}
                onCancel={closePanel}
                onDirtyChange={setEditorDirty}
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
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard your changes?"
        description="Your edits to this routine haven’t been saved."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={closePanel}
      />
    </div>
  );
}
