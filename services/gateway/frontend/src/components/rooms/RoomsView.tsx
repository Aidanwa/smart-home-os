import { useEffect, useRef, useState } from 'react';

import {
  LucideHome,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';

import { FloorStage } from './canvas/FloorStage';
import { AddRoomModal } from './modals/AddRoomModal';
import { DeleteRoomModal } from './modals/DeleteRoomModal';

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
}: RoomsViewProps) {
  const {
    currentFloor,
    setCurrentFloor,

    homeConfig,
    checkingHome,

    zones,
    baseFloorZones,

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

  //
  // UI state only
  //
  const [selectedZoneId, setSelectedZoneId] =
    useState<string | null>(null);

  const [showAddModal, setShowAddModal] =
    useState(false);

  const [zoneToDelete, setZoneToDelete] =
    useState<LogicalZone | null>(null);

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
  const containerRef =
    useRef<HTMLDivElement>(null);

  const [stageSize, setStageSize] =
    useState({
      width: 1200,
      height: 800,
    });

  useEffect(() => {
    const observer =
      new ResizeObserver((entries) => {
        const entry = entries[0];

        if (!entry) return;

        setStageSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

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

  const confirmDelete = async () => {
    if (!zoneToDelete) return;

    await deleteRoom(zoneToDelete.id);

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
          Checking structural configuration
          context…
        </span>
      </div>
    );
  }

  //
  // Missing home config
  //
  if (!homeConfig) {
    return (
      <div className="w-full h-full bg-neutral-950 flex flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-xl text-neutral-400">
          <LucideHome />
        </div>

        <h3 className="text-neutral-200 font-semibold text-base">
          Home Context Not Initialized
        </h3>

        <p className="text-neutral-500 text-sm max-w-sm leading-relaxed">
          You must create and save a baseline
          profile in Home Settings before
          designing room layout.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-neutral-950 flex overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden relative border-r border-neutral-800">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 shrink-0 bg-neutral-950 z-10 shadow-sm">
          <div className="flex flex-col">
            <h1 className="text-neutral-100 font-medium tracking-tight leading-tight">
              {formatFloorName(currentFloor)}
            </h1>

            <span className="text-neutral-500 text-xs leading-none">
              {isLoading
                ? 'Loading...'
                : `${zones.length} room${
                    zones.length !== 1
                      ? 's'
                      : ''
                  }`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {selectedZone && (
              <button
                onClick={() =>
                  setZoneToDelete(
                    selectedZone
                  )
                }
                className="flex items-center gap-1.5 px-3 h-8 rounded text-red-400 hover:bg-red-950/40 hover:text-red-300 text-xs font-medium transition-colors border border-transparent hover:border-red-900/50"
              >
                <Trash2 size={14} />
                Delete
              </button>
            )}

            {isDirty && (
              <button
                onClick={saveAll}
                disabled={isSaving}
                className="flex items-center gap-1.5 px-3 h-8 rounded bg-emerald-600/20 text-emerald-400 text-xs font-medium disabled:opacity-50 transition-colors"
              >
                <Save size={14} />

                {isSaving
                  ? 'Saving…'
                  : 'Autosaving soon...'}
              </button>
            )}

            <button
              onClick={() =>
                setShowAddModal(true)
              }
              className="flex items-center gap-1.5 px-3 h-8 rounded bg-white text-neutral-900 text-xs font-medium hover:bg-neutral-200 transition-colors shadow-sm"
            >
              <Plus
                size={14}
                strokeWidth={2.5}
              />
              Add Room
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden bg-neutral-950"
          style={{
            backgroundImage:
              'radial-gradient(circle, #262626 1px, transparent 1px)',
            backgroundSize:
              '20px 20px',
            backgroundPosition:
              '0 0',
          }}
        >
          <FloorSwitcher
            floor={currentFloor}
            minFloor={
              homeConfig.bottom_floor
            }
            maxFloor={
              homeConfig.top_floor
            }
            onChange={setCurrentFloor}
          />

          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-neutral-500 text-sm animate-pulse">
                Loading spatial data…
              </span>
            </div>
          ) : (
            <FloorStage
              width={stageSize.width}
              height={stageSize.height}
              zones={zones}
              baseFloorZones={
                baseFloorZones
              }
              selectedZoneId={
                selectedZoneId
              }
              onSelectZone={
                setSelectedZoneId
              }
              onDragEnd={
                handleDragEnd
              }
              onTransformEnd={
                handleTransformEnd
              }
              onEditZone={(
                zone,
                pos
              ) =>
                setEditing({
                  zone,
                  anchorPos: pos,
                })
              }
            />
          )}

          {editing && (
            <InlineEditPopover
              zone={editing.zone}
              anchorPos={
                editing.anchorPos
              }
              onCommit={
                handleEditCommit
              }
              onCancel={() =>
                setEditing(null)
              }
            />
          )}

          {!isLoading &&
            zones.length === 0 &&
            baseFloorZones.length ===
              0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
                <div className="w-16 h-16 rounded-full border-2 border-dashed border-neutral-800 flex items-center justify-center text-neutral-700 bg-neutral-950/50">
                  <Plus size={24} />
                </div>

                <span className="text-neutral-500 text-sm bg-neutral-950/50 px-2 rounded">
                  No rooms plotted.
                  Click "Add Room" to
                  begin.
                </span>
              </div>
            )}
        </div>
      </div>

      {/* Future sidebar */}
      {/* <UnmappedDevices /> */}

      {showAddModal && (
        <AddRoomModal
          floorLevel={
            currentFloor
          }
          onClose={() =>
            setShowAddModal(false)
          }
          onCreate={createRoom}
        />
      )}

      {zoneToDelete && (
        <DeleteRoomModal
          roomName={
            zoneToDelete.name
          }
          onClose={() =>
            setZoneToDelete(null)
          }
          onConfirm={
            confirmDelete
          }
        />
      )}
    </div>
  );
}