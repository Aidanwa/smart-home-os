import { useEffect, useState } from 'react';

import {
  Eye,
  ListPlus,
  LucideHome,
  Pencil,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';

import { FloorStage } from './canvas/FloorStage';
import { AddRoomModal } from './modals/AddRoomModal';
import { DeleteRoomModal } from './modals/DeleteRoomModal';
import { RemoveDeviceModal } from './modals/RemoveDeviceModal';
import { DevicePanel, DeviceSheet } from './sidebar/DevicePanel';

import { FloorSwitcher } from './canvas/FloorSwitcher';
import { InlineEditPopover } from './modals/InlineEditPopover';

import { formatFloorName } from './constants';

import { useRoomLayout } from './hooks/useRoomLayout';

import type {
  LogicalZone,
  RoomsViewProps,
} from './types';

export function RoomsView({
  devices: _devices,
  toggleDevice,
}: RoomsViewProps) {
  const {
    currentFloor,
    setCurrentFloor,

    homeConfig,
    checkingHome,

    zones,
    baseFloorZones,

    placements,
    updateDevicePlacement,

    isLoading,
    isDirty,
    isSaving,

    createRoom,
    deleteRoom,
    updateRoom,

    saveAll,

    handleDragEnd,
    handleTransformEnd,
  } = useRoomLayout();

  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  // View: the plan only pans and zooms, so a phone can't move rooms by accident.
  // Edit: tap a room to select it, then drag, resize, rename (double-tap) or place devices.
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const isEditMode = mode === 'edit';
  const [showDeviceSheet, setShowDeviceSheet] = useState(false);
  const switchMode = (next: 'view' | 'edit') => {
    setMode(next);
    setSelectedZoneId(null);
    setEditing(null);
  };
  const [zoneToDelete, setZoneToDelete] = useState<LogicalZone | null>(null);
  const [deviceToRemove, setDeviceToRemove] = useState<{ ieee_address: string, name: string, room: string } | null>(null);

  const [editing, setEditing] = useState<{
    zone: LogicalZone;
    anchorPos: {
      x: number;
      y: number;
    };
  } | null>(null);

  //
  // Stage sizing
  //
  // A callback ref (state, not useRef): the canvas div only mounts after the home
  // check finishes, so an effect that ran once on first render never saw it.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  const [stageSize, setStageSize] =
    useState({ width: 0, height: 0 });  // 0 until measured; the stage waits for it

  useEffect(() => {
    if (!container) return;
    const observer =
      new ResizeObserver((entries) => {
        const entry = entries[0];

        if (!entry) return;

        setStageSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      });

    observer.observe(container);
    return () => observer.disconnect();
  }, [container]);

  //
  // Clear selection when floor changes
  //
  useEffect(() => {
    setSelectedZoneId(null);
    setEditing(null);
  }, [currentFloor]);

  const selectedZone = zones.find(
    (z) => z.id === selectedZoneId
  );

  const handleDeviceClick = (ieee_address: string) => {
    if (!selectedZoneId) return;  // the list says to pick a room first
    updateDevicePlacement(ieee_address, selectedZoneId, 50.00, 50.00);
  };

  const handleCanvasDeviceClick = (ieee_address: string) => {
    const device = _devices[ieee_address];
    if (!isEditMode) {
      // View mode is the remote control: tap a light or plug to switch it.
      if (device && typeof device.state === 'string') toggleDevice(device.friendly_name ?? ieee_address, device.state);
      return;
    }
    const placement = placements.find(p => p.ieee_address === ieee_address);
    const zone = zones.find(z => z.id === placement?.zone_id);
    if (device && zone) {
      setDeviceToRemove({ ieee_address, name: device.friendly_name, room: zone.name });
    }
  };

  const confirmDeviceRemoval = () => {
  if (deviceToRemove) {
    // Setting zone_id to null throws it back to the sidebar!
    updateDevicePlacement(deviceToRemove.ieee_address, null, 50, 50);
    setDeviceToRemove(null);
  }
};

  const confirmDelete = async () => {
    if (!zoneToDelete) return;

    await deleteRoom(zoneToDelete.id, zoneToDelete.name);  // throws on failure: the dialog stays open

    if (selectedZoneId === zoneToDelete.id) {
      setSelectedZoneId(null);
    }

    setZoneToDelete(null);
  };

  const handleEditCommit = async (
    id: string,
    name: string,
    color: string
  ) => {
    await updateRoom(id, {
      name,
      color,
    });

    setEditing(null);
  };

  //
  // Loading state
  //
  if (checkingHome) {
    return (
      <div className="w-full h-full bg-neutral-950 flex items-center justify-center">
        <span className="text-neutral-500 text-sm animate-pulse">
          Loading…
        </span>
      </div>
    );
  }

  // Missing home config
  if (!homeConfig) {
    return (
      <div className="w-full h-full bg-neutral-950 flex flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-xl text-neutral-400">
          <LucideHome />
        </div>

        <h3 className="text-neutral-200 font-semibold text-base">
          Set up your home first
        </h3>

        <p className="text-neutral-500 text-sm max-w-sm leading-relaxed">
          Add your home profile in Settings → Home
          (floors and basement) to start
          drawing rooms.
        </p>
      </div>
    );
  }

  return (
    // 1. Outer Container: flex-col (Toolbar on top, Content below)
    <div className="w-full h-full bg-neutral-950 flex flex-col overflow-hidden">

      {/* 2. Toolbar (Full Width Across the Top) */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 shrink-0 bg-neutral-950 z-10 shadow-sm">
        <div className="flex flex-col">
          <h1 className="text-neutral-100 font-medium tracking-tight leading-tight">
            {formatFloorName(currentFloor)}
          </h1>
          <span className="text-neutral-500 text-xs leading-none">
            {isLoading
              ? 'Loading…'
              : isSaving ? 'Saving…'
              : isDirty ? 'Unsaved changes'
              : `${zones.length} room${zones.length !== 1 ? 's' : ''}`}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isEditMode && selectedZone && (
            <button
              onClick={() => setZoneToDelete(selectedZone)}
              aria-label={`Delete ${selectedZone.name}`}
              className="flex items-center gap-1.5 px-2.5 h-8 rounded text-red-400 hover:bg-red-950/40 hover:text-red-300 text-xs font-medium transition-colors border border-transparent hover:border-red-900/50"
            >
              <Trash2 size={14} />
              <span className="hidden sm:inline">Delete</span>
            </button>
          )}

          {isDirty && (
            <button
              onClick={saveAll}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 h-8 rounded bg-emerald-600/20 text-emerald-400 text-xs font-medium disabled:opacity-50 transition-colors"
            >
              <Save size={14} />
              {isSaving ? 'Saving…' : 'Save now'}
            </button>
          )}

          {isEditMode && (
            <button
              onClick={() => setShowDeviceSheet(true)}
              className="md:hidden flex items-center gap-1.5 px-2.5 h-8 rounded border border-neutral-700 text-neutral-200 text-xs font-medium hover:bg-neutral-800 transition-colors"
            >
              <ListPlus size={14} />
              Devices
            </button>
          )}

          {isEditMode && (
            <button
              onClick={() => setShowAddModal(true)}
              aria-label="Add room"
              className="flex items-center gap-1.5 px-2.5 h-8 rounded bg-white text-neutral-900 text-xs font-medium hover:bg-neutral-200 transition-colors shadow-sm"
            >
              <Plus size={14} strokeWidth={2.5} />
              <span className="hidden sm:inline">Add Room</span>
            </button>
          )}

          <div className="flex bg-neutral-900 p-0.5 rounded-lg border border-neutral-800" role="group" aria-label="Mode">
            <button onClick={() => switchMode('view')} aria-pressed={!isEditMode}
              className={`flex items-center gap-1 px-2.5 h-7 rounded-md text-xs font-medium ${!isEditMode ? 'bg-neutral-700 text-white' : 'text-neutral-400'}`}>
              <Eye size={13} /> View
            </button>
            <button onClick={() => switchMode('edit')} aria-pressed={isEditMode}
              className={`flex items-center gap-1 px-2.5 h-7 rounded-md text-xs font-medium ${isEditMode ? 'bg-neutral-700 text-white' : 'text-neutral-400'}`}>
              <Pencil size={13} /> Edit
            </button>
          </div>
        </div>
      </div>

      {/* 3. Main Content Split: flex-row (Canvas Left, Sidebar Right) */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">

        {/* Canvas Area */}
        <div ref={setContainer} className="flex-1 min-h-0 relative overflow-hidden bg-neutral-950"
          style={{ backgroundImage: 'radial-gradient(circle, #262626 1px, transparent 1px)', backgroundSize: '20px 20px' }}>

          <FloorSwitcher
            floor={currentFloor}
            minFloor={homeConfig.bottom_floor}
            maxFloor={homeConfig.top_floor}
            onChange={setCurrentFloor}
          />

          {isLoading || stageSize.width === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-neutral-500 text-sm animate-pulse">
                Loading rooms…
              </span>
            </div>
          ) : (
            <FloorStage
              key={currentFloor}  // re-fit the view when switching floors
              editable={isEditMode}
              width={stageSize.width}
              height={stageSize.height}
              zones={zones}
              baseFloorZones={baseFloorZones}
              selectedZoneId={selectedZoneId}
              onSelectZone={setSelectedZoneId}
              onDragEnd={handleDragEnd}
              onTransformEnd={handleTransformEnd}
              onEditZone={(zone, pos) => setEditing({ zone, anchorPos: pos })}
              devices={_devices}
              placements={placements}
              updateDevicePlacement={updateDevicePlacement}
              onDeviceClick={handleCanvasDeviceClick}
            />
          )}

          {editing && (
            <InlineEditPopover
              zone={editing.zone}
              anchorPos={editing.anchorPos}
              onCommit={handleEditCommit}
              onCancel={() => setEditing(null)}
            />
          )}

          {(isEditMode || zones.length > 0) && (
            <div className="absolute bottom-3 left-3 px-3 py-1.5 rounded-2xl bg-neutral-900/90 border border-neutral-800 text-[11px] text-neutral-400 pointer-events-none w-max max-w-[calc(100%-7rem)]">
              {!isEditMode ? (zones.length ? 'Tap a light or plug to switch it, a room to zoom in' : 'Tap a light or plug to switch it')
                : selectedZone ? 'Drag to move · corners to resize · double-tap to rename' : 'Tap a room to edit it'}
            </div>
          )}

          {!isLoading && zones.length === 0 && baseFloorZones.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
              <div className="w-16 h-16 rounded-full border-2 border-dashed border-neutral-800 flex items-center justify-center text-neutral-700 bg-neutral-950/50">
                <Plus size={24} />
              </div>
              <span className="text-neutral-500 text-sm bg-neutral-950/50 px-2 rounded">
                {isEditMode ? 'No rooms on this floor yet. Tap + to add one.' : 'No rooms on this floor yet. Tap Edit to add one.'}
              </span>
            </div>
          )}
        </div>

        {/* Desktop sidebar (edit mode). Phones use the bottom sheet below. */}
        {isEditMode && (
          <DevicePanel devices={_devices} placements={placements} zones={zones}
            selectedZone={selectedZone ?? null} onPlace={handleDeviceClick} />
        )}
      </div>

      <DeviceSheet open={isEditMode && showDeviceSheet} onOpenChange={setShowDeviceSheet}
        devices={_devices} placements={placements} zones={zones}
        selectedZone={selectedZone ?? null} onPlace={handleDeviceClick} />

      {/* Modals */}
      {showAddModal && <AddRoomModal floorLabel={formatFloorName(currentFloor)} onClose={() => setShowAddModal(false)} onCreate={createRoom} />}
      {zoneToDelete && <DeleteRoomModal roomName={zoneToDelete.name} onClose={() => setZoneToDelete(null)} onConfirm={confirmDelete} />}
      {deviceToRemove && (<RemoveDeviceModal deviceName={deviceToRemove.name} roomName={deviceToRemove.room} onClose={() => setDeviceToRemove(null)} onConfirm={confirmDeviceRemoval} />)}
    </div>
  );
}