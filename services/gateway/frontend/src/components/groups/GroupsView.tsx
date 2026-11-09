import { useState } from 'react';
import { Plus, Trash2, Settings2, X, Pencil, Check, Layers, Power, Sun, Loader2, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription, ConfirmDialog } from '../ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../ui/sheet';
import { useGroups } from '../../hooks/useGroups';
import type { GroupInfo } from '../../hooks/useGroups';
import type { DeviceState } from '../../hooks/useDevices';
import { DeviceRenderer } from '../devices/DeviceRenderer';
import { LightSlider } from '../devices/ColorLightCard';

interface Props {
  devices: Record<string, DeviceState>;
  sendCommand: (name: string, payload: any) => void;
  toggleDevice: (name: string, currentState?: string) => void;
  renameDevice: (oldName: string, newName: string) => void;
  deleteDevice: (name: string, label?: string) => void;
}

type Member = [key: string, state: DeviceState];

function membersOf(group: GroupInfo, devices: Record<string, DeviceState>): Member[] {
  return Object.entries(devices)
    .filter(([name, state]) => state.ieee_address
      ? group.members.some(m => m.ieee_address === state.ieee_address)
      : group.members.some(m => m.name === name))
    .sort(([a, sa], [b, sb]) => (sa.friendly_name ?? a).localeCompare(sb.friendly_name ?? b));
}

/** On/off and brightness of a group, worked out from its members' last reported state. */
function groupState(members: Member[]) {
  const switchable = members.filter(([, s]) => s.state === 'ON' || s.state === 'OFF');
  const on = switchable.filter(([, s]) => s.state === 'ON');
  const dimmable = members.filter(([, s]) => typeof s.brightness === 'number');
  const lit = on.filter(([, s]) => typeof s.brightness === 'number');
  const brightness = lit.length
    ? Math.max(1, Math.round(lit.reduce((sum, [, s]) => sum + (s.brightness as number), 0) / lit.length / 254 * 100))
    : null;
  const summary = switchable.length === 0
    ? (members.length ? `${members.length} device${members.length === 1 ? '' : 's'}` : 'No devices')
    : on.length === 0 ? 'All off'
    : on.length === switchable.length ? `All on${brightness ? ` · ${brightness}%` : ''}`
    : `${on.length} of ${switchable.length} on${brightness ? ` · ${brightness}%` : ''}`;
  return { anyOn: on.length > 0, canSwitch: switchable.length > 0, canDim: dimmable.length > 0, brightness, summary };
}

/** Group brightness, sent to the whole group when you let go. Follows the members otherwise. */
function GroupBrightness({ name, value, onCommit }: { name: string; value: number; onCommit: (pct: number) => void }) {
  const [v, setV] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) { setSeen(value); setV(value); }  // follow the bulbs when they change elsewhere
  return (
    // Keep slider taps from opening the group.
    <div onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      <LightSlider
        label={`${name} brightness`}
        icon={<Sun size={14} />}
        value={v} min={1} max={100} step={1}
        track="bg-gradient-to-r from-neutral-800 to-white"
        onChange={setV}
        onCommit={onCommit}
        valueText={`${v}%`}
      />
    </div>
  );
}

function PowerButton({ name, on, busy, onClick, size = 'md' }: { name: string; on: boolean; busy: boolean; onClick: () => void; size?: 'md' | 'lg' }) {
  return (
    <button
      type="button"
      aria-label={on ? `Turn off ${name}` : `Turn on ${name}`}
      aria-pressed={on}
      disabled={busy}
      onClick={e => { e.stopPropagation(); onClick(); }}
      className={`${size === 'lg' ? 'size-12' : 'size-11'} shrink-0 flex items-center justify-center rounded-full border transition-colors disabled:cursor-wait ${
        on ? 'bg-yellow-500/15 border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/25' : 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:bg-neutral-700 hover:text-white'
      }`}
    >
      {busy ? <Loader2 size={18} className="animate-spin" /> : <Power size={18} />}
    </button>
  );
}

export function GroupsView({ devices, sendCommand, toggleDevice, renameDevice, deleteDevice }: Props) {
  const { groups, createGroup, deleteGroup, addDeviceToGroup, removeDeviceFromGroup, sendGroupCommand, renameGroup } = useGroups();

  const [newGroupName, setNewGroupName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [openGroup, setOpenGroup] = useState<number | null>(null);  // the detail sheet, by group id
  const [managing, setManaging] = useState(false);                    // add/remove devices, over the sheet
  const [editingName, setEditingName] = useState(false);
  const [editNameDraft, setEditNameDraft] = useState('');
  const [groupToDelete, setGroupToDelete] = useState<string | null>(null);
  // Requests in flight, keyed by what they act on, so buttons can't be tapped twice.
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const track = async (key: string, run: () => Promise<unknown>) => {
    if (busy.has(key)) return;
    setBusy(prev => new Set(prev).add(key));
    try { await run(); } finally {
      setBusy(prev => { const next = new Set(prev); next.delete(key); return next; });
    }
  };

  const visibleGroups = groups.filter(g => !g.friendly_name.includes('default_bind'));
  // Looked up by id each render, so the sheet follows renames and membership changes.
  const current = openGroup !== null ? visibleGroups.find(g => g.id === openGroup) ?? null : null;

  const handleCreateGroup = () => {
    if (newGroupName.trim()) {
      createGroup(newGroupName.trim());
      setNewGroupName('');
      setIsCreating(false);
    }
  };

  const setPower = (group: string, on: boolean) =>
    track(`set:${group}`, () => sendGroupCommand(group, { state: on ? 'ON' : 'OFF' }, `turn ${on ? 'on' : 'off'} ${group}`));
  const setBrightness = (group: string, pct: number) =>
    sendGroupCommand(group, { brightness: Math.round(pct / 100 * 254) }, `dim ${group}`);

  const submitRename = async () => {
    const name = editNameDraft.trim();
    setEditingName(false);
    if (current && name && name !== current.friendly_name) {
      await renameGroup(current.friendly_name, name);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 overflow-x-hidden max-w-full pb-10">

      {/* Header & Create Group */}
      <div className="flex justify-between items-center gap-3 bg-neutral-900/50 p-4 rounded-2xl border border-neutral-800 shadow-sm">
        <div className="min-w-0">
          <h2 className="text-lg font-medium text-white">Groups</h2>
          <p className="text-sm text-neutral-400">Control multiple devices together</p>
        </div>
        {!isCreating ? (
          <button
            onClick={() => setIsCreating(true)}
            title="Create a group"
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 min-h-10 rounded-xl text-sm font-medium transition-colors shrink-0"
          >
            <Plus size={16} /> <span className="hidden sm:inline">New group</span><span className="sr-only sm:hidden">New group</span>
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="e.g. Living Room"
              aria-label="New group name"
              className="bg-neutral-950 border border-neutral-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500 text-white w-32 sm:w-auto"
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateGroup(); if (e.key === 'Escape') setIsCreating(false); }}
            />
            <button onClick={handleCreateGroup} className="bg-blue-600 hover:bg-blue-500 px-3 min-h-10 rounded-xl text-sm font-medium text-white transition-colors">Save</button>
            <button onClick={() => setIsCreating(false)} className="bg-neutral-800 hover:bg-neutral-700 px-3 min-h-10 rounded-xl text-sm font-medium text-white transition-colors">Cancel</button>
          </div>
        )}
      </div>

      {/* Group cards: tap to see every device in the group */}
      {visibleGroups.length === 0 ? (
        <div className="p-8 text-center bg-neutral-900/20 border border-dashed border-neutral-800 rounded-2xl text-neutral-500 text-sm">
          No groups yet. Tap <strong className="text-neutral-300">New group</strong> to make one.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleGroups.map(group => {
            const members = membersOf(group, devices);
            const g = groupState(members);
            const name = group.friendly_name;
            return (
              <div
                key={group.id}
                role="button"
                tabIndex={0}
                aria-label={`${name}: ${g.summary}. Open the group`}
                onClick={() => setOpenGroup(group.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenGroup(group.id); } }}
                className={`relative p-4 rounded-2xl border cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                  g.anyOn ? 'bg-neutral-900 border-neutral-700' : 'bg-neutral-900/40 border-neutral-800 hover:bg-neutral-900/70'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`size-11 shrink-0 rounded-xl flex items-center justify-center ${g.anyOn ? 'bg-yellow-500/10 text-yellow-500' : 'bg-neutral-800 text-neutral-500'}`}>
                    <Layers size={20} strokeWidth={2.5} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-neutral-100 truncate">{name}</p>
                    <p className="text-xs text-neutral-400 truncate">{g.summary}</p>
                  </div>
                  {g.canSwitch
                    ? <PowerButton name={name} on={g.anyOn} busy={busy.has(`set:${name}`)} onClick={() => setPower(name, !g.anyOn)} />
                    : <ChevronRight size={18} className="text-neutral-600" aria-hidden />}
                </div>
                {g.anyOn && g.canDim && g.brightness !== null && (
                  <div className="mt-3">
                    <GroupBrightness name={name} value={g.brightness} onCommit={pct => setBrightness(name, pct)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Group detail: every device in the group, with the group's own controls on top.
          A Sheet (not a Dialog) so a device's settings drawer can open on top of it. */}
      <Sheet open={!!current} onOpenChange={o => { if (!o) { setOpenGroup(null); setEditingName(false); } }}>
        <SheetContent
          // Escape while renaming cancels the rename instead of closing the group.
          onEscapeKeyDown={e => { if (editingName) { e.preventDefault(); setEditingName(false); } }}
          className="bg-neutral-950 border-l-neutral-800 text-neutral-200 overflow-y-auto overflow-x-hidden data-[side=right]:w-full data-[side=right]:sm:max-w-2xl p-0 gap-0">
          {current && (() => {
            const members = membersOf(current, devices);
            const g = groupState(members);
            const name = current.friendly_name;
            return (<>
              <SheetHeader className="p-4 pr-14 border-b border-neutral-800 gap-3 text-left">
                <SheetDescription className="text-xs uppercase tracking-wider text-neutral-500">Group</SheetDescription>
                {editingName ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={editNameDraft}
                      aria-label="Group name"
                      onChange={(e) => setEditNameDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') submitRename(); }}
                      className="min-w-0 flex-1 bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-1 text-xl font-medium focus:outline-none focus:border-blue-500 text-neutral-100"
                    />
                    <button onClick={submitRename} aria-label="Save name" className="size-10 flex items-center justify-center rounded-lg text-green-400 hover:bg-green-500/10"><Check size={18} /></button>
                    <button onClick={() => setEditingName(false)} aria-label="Cancel rename" className="size-10 flex items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800"><X size={18} /></button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 min-w-0">
                    <SheetTitle className="text-xl font-medium text-white truncate">{name}</SheetTitle>
                    <button onClick={() => { setEditNameDraft(name); setEditingName(true); }} aria-label="Rename group" className="size-10 shrink-0 flex items-center justify-center rounded-lg text-neutral-500 hover:text-white hover:bg-neutral-800"><Pencil size={16} /></button>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  {g.canSwitch && <PowerButton size="lg" name={name} on={g.anyOn} busy={busy.has(`set:${name}`)} onClick={() => setPower(name, !g.anyOn)} />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-neutral-200">{g.summary}</p>
                    {g.canSwitch && <p className="text-xs text-neutral-500">{g.anyOn ? 'Tap to turn everything off' : 'Tap to turn everything on'}</p>}
                  </div>
                </div>
                {g.anyOn && g.canDim && g.brightness !== null && (
                  <GroupBrightness name={name} value={g.brightness} onCommit={pct => setBrightness(name, pct)} />
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => setManaging(true)} className="flex items-center gap-1.5 px-3 min-h-10 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-sm font-medium text-neutral-200">
                    <Settings2 size={16} /> Add or remove devices
                  </button>
                  <button onClick={() => setGroupToDelete(name)} className="flex items-center gap-1.5 px-3 min-h-10 rounded-lg text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10">
                    <Trash2 size={16} /> Delete group
                  </button>
                </div>
              </SheetHeader>

              <div className="p-4">
                {members.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {members.map(([key, state]) => (
                      <DeviceRenderer key={key} name={state.friendly_name} state={state} sendCommand={sendCommand} toggleDevice={toggleDevice} renameDevice={renameDevice} deleteDevice={deleteDevice} />
                    ))}
                  </div>
                ) : (
                  <div className="p-8 text-center bg-neutral-900/20 border border-dashed border-neutral-800 rounded-2xl text-neutral-500 text-sm space-y-3">
                    <p>No devices in this group yet.</p>
                    <button onClick={() => setManaging(true)} className="inline-flex items-center gap-1.5 px-3 min-h-10 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-sm font-medium text-neutral-200">
                      <Plus size={16} /> Add devices
                    </button>
                  </div>
                )}
              </div>
            </>);
          })()}
        </SheetContent>
      </Sheet>

      {/* Add or remove devices */}
      <Dialog open={!!current && managing} onOpenChange={o => !o && setManaging(false)}>
        <DialogContent className="p-0 flex flex-col">
          {current && (<>
            <div className="p-4 pr-14 border-b border-neutral-800">
              <DialogTitle className="truncate">{current.friendly_name}</DialogTitle>
              <DialogDescription>Add or remove devices.</DialogDescription>
            </div>
            <div className="p-4 max-h-[60vh] overflow-y-auto overflow-x-hidden space-y-2 rounded-b-2xl">
              {Object.entries(devices)
                .filter(([key]) => key !== 'bridge')
                .sort(([a, sa], [b, sb]) => (sa.friendly_name ?? a).localeCompare(sb.friendly_name ?? b))
                .map(([deviceName, state]) => {
                const target = state.ieee_address || state.friendly_name;
                const working = busy.has(`member:${target}`);
                const isInGroup = state.ieee_address
                  ? current.members.some(m => m.ieee_address === state.ieee_address)
                  : current.members.some(m => m.name === deviceName);

                return (
                  <div key={deviceName} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-neutral-950/50 border border-neutral-800/50">
                    <span className="text-sm font-medium text-neutral-200 truncate">{state.friendly_name}</span>
                    <button
                      disabled={working}
                      onClick={() => {
                        const group = current.friendly_name;
                        const label = state.friendly_name ?? deviceName;
                        track(`member:${target}`, () => isInGroup
                          ? removeDeviceFromGroup(group, target, label)
                          : addDeviceToGroup(group, target, label));
                      }}
                      className={`min-w-[4.5rem] min-h-10 shrink-0 disabled:opacity-60 disabled:cursor-wait px-3 rounded-lg text-xs font-medium transition-colors ${
                        isInGroup ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'
                      }`}
                    >
                      {working ? (isInGroup ? 'Removing…' : 'Adding…') : isInGroup ? 'Remove' : 'Add'}
                    </button>
                  </div>
                );
              })}
            </div>
          </>)}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!groupToDelete}
        onOpenChange={o => !o && setGroupToDelete(null)}
        title="Delete group?"
        description={<>Delete the group <strong className="text-white">{groupToDelete}</strong>? The devices in it aren’t affected.</>}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (groupToDelete) {
            deleteGroup(groupToDelete);
            setOpenGroup(null);
            setGroupToDelete(null);
          }
        }}
      />
    </div>
  );
}
