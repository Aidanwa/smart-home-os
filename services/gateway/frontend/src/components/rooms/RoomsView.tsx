import { useEffect, useState, useRef, useCallback } from 'react';
import { Stage, Layer, Rect, Text, Group, Transformer } from 'react-konva';
import type Konva from 'konva';

// ─── Types ───────────────────────────────────────────────────────────────────

interface LogicalZone {
  id: string;
  name: string;
  floor_level: number;
  width: number;
  height: number;
  pos_x: number;
  pos_y: number;
}

interface RoomsViewProps {
  devices: Record<string, any>;
}

// ─── Add Room Modal ───────────────────────────────────────────────────────────

function AddRoomModal({
  floorLevel,
  onClose,
  onCreate,
}: {
  floorLevel: number;
  onClose: () => void;
  onCreate: (name: string, width: number, height: number) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [width, setWidth] = useState(200);
  const [height, setHeight] = useState(150);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Room name is required.'); return; }
    setIsSubmitting(true);
    setError('');
    try {
      await onCreate(name.trim(), width, height);
      onClose();
    } catch (e: any) {
      setError(e.message ?? 'Failed to create room.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl p-6 w-80 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-semibold text-base">
            Add Room — Floor {floorLevel}
          </h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-white transition-colors text-xl leading-none">×</button>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-neutral-400 text-xs uppercase tracking-wider">Name</span>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              placeholder="e.g. Living Room"
              autoFocus
              className="bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2 text-white text-sm placeholder-neutral-500 focus:outline-none focus:border-neutral-400"
            />
          </label>

          <div className="flex gap-3">
            <label className="flex flex-col gap-1 flex-1">
              <span className="text-neutral-400 text-xs uppercase tracking-wider">Width (px)</span>
              <input
                type="number"
                value={width}
                onChange={e => setWidth(Math.max(80, Number(e.target.value)))}
                min={80}
                className="bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-neutral-400"
              />
            </label>
            <label className="flex flex-col gap-1 flex-1">
              <span className="text-neutral-400 text-xs uppercase tracking-wider">Height (px)</span>
              <input
                type="number"
                value={height}
                onChange={e => setHeight(Math.max(60, Number(e.target.value)))}
                min={60}
                className="bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-neutral-400"
              />
            </label>
          </div>

          <div className="flex items-center justify-center bg-neutral-800 rounded-lg p-3 h-24">
            <div
              className="border border-zinc-500 rounded bg-zinc-700/40 flex items-center justify-center"
              style={{ width: Math.min(width, 200) * 0.45, height: Math.min(height, 150) * 0.45 }}
            >
              <span className="text-neutral-400 text-xs">{name || 'Room'}</span>
            </div>
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-neutral-600 text-neutral-300 text-sm hover:bg-neutral-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex-1 px-4 py-2 rounded-lg bg-white text-neutral-900 text-sm font-medium hover:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? 'Creating…' : 'Create Room'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Elevator Floor Switcher ──────────────────────────────────────────────────
// Mimics an elevator panel: current floor in the centre, ▲ / ▼ to travel.

function FloorSwitcher({
  floor,
  maxFloor,
  minFloor,
  onChange,
}: {
  floor: number;
  maxFloor: number;
  minFloor: number;
  onChange: (f: number) => void;
}) {
  const canUp = floor < maxFloor;
  const canDown = floor > minFloor;

  return (
    <div className="flex flex-col items-center select-none" style={{ gap: 0 }}>
      {/* Up arrow */}
      <button
        disabled={!canUp}
        onClick={() => canUp && onChange(floor + 1)}
        aria-label="Floor up"
        className={[
          'w-7 h-6 flex items-center justify-center rounded-t-md border-x border-t transition-colors',
          canUp
            ? 'border-neutral-600 text-neutral-300 hover:bg-neutral-700 hover:text-white active:bg-neutral-600'
            : 'border-neutral-800 text-neutral-700 cursor-not-allowed',
        ].join(' ')}
      >
        {/* Solid up triangle */}
        <svg width="10" height="7" viewBox="0 0 10 7" fill="currentColor">
          <polygon points="5,0 10,7 0,7" />
        </svg>
      </button>

      {/* Floor display */}
      <div className="w-7 h-7 flex items-center justify-center border border-neutral-600 bg-neutral-800 text-white text-xs font-mono font-semibold leading-none">
        {floor}
      </div>

      {/* Down arrow */}
      <button
        disabled={!canDown}
        onClick={() => canDown && onChange(floor - 1)}
        aria-label="Floor down"
        className={[
          'w-7 h-6 flex items-center justify-center rounded-b-md border-x border-b transition-colors',
          canDown
            ? 'border-neutral-600 text-neutral-300 hover:bg-neutral-700 hover:text-white active:bg-neutral-600'
            : 'border-neutral-800 text-neutral-700 cursor-not-allowed',
        ].join(' ')}
      >
        {/* Solid down triangle */}
        <svg width="10" height="7" viewBox="0 0 10 7" fill="currentColor">
          <polygon points="5,7 10,0 0,0" />
        </svg>
      </button>
    </div>
  );
}

// ─── Resizable Room ───────────────────────────────────────────────────────────
// Wraps a single zone Group + Transformer. Kept as its own component so each
// room owns its ref and the transformer stays isolated per room.

function ResizableRoom({
  zone,
  isSelected,
  onSelect,
  onDragEnd,
  onTransformEnd,
  onDoubleClick,
}: {
  zone: LogicalZone;
  isSelected: boolean;
  onSelect: () => void;
  onDragEnd: (x: number, y: number) => void;
  onTransformEnd: (x: number, y: number, width: number, height: number) => void;
  onDoubleClick: (zone: LogicalZone, nodePos: { x: number; y: number }) => void;
}) {
  const groupRef = useRef<Konva.Group>(null);
  const transformerRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (isSelected && transformerRef.current && groupRef.current) {
      transformerRef.current.nodes([groupRef.current]);
      transformerRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  const handleTransformEnd = () => {
    const node = groupRef.current;
    if (!node) return;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    // Reset scale and bake into width/height
    node.scaleX(1);
    node.scaleY(1);
    const newWidth = Math.max(80, Math.round(zone.width * scaleX));
    const newHeight = Math.max(60, Math.round(zone.height * scaleY));
    onTransformEnd(Math.round(node.x()), Math.round(node.y()), newWidth, newHeight);
  };

  return (
    <>
      <Group
        ref={groupRef}
        x={zone.pos_x}
        y={zone.pos_y}
        draggable
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={e => onDragEnd(Math.round(e.target.x()), Math.round(e.target.y()))}
        onTransformEnd={handleTransformEnd}
        onDblClick={() => {
          // Pass the absolute canvas position of this group's top-left
          const node = groupRef.current;
          if (!node) return;
          const stage = node.getStage();
          if (!stage) return;
          const container = stage.container().getBoundingClientRect();
          const abs = node.getAbsolutePosition();
          onDoubleClick(zone, {
            x: container.left + abs.x,
            y: container.top + abs.y,
          });
        }}
      >
        <Rect
          width={zone.width}
          height={zone.height}
          fill={isSelected ? 'rgba(55, 65, 81, 0.75)' : 'rgba(38, 38, 38, 0.6)'}
          stroke={isSelected ? '#6b7280' : '#3f3f46'}
          strokeWidth={isSelected ? 2 : 1.5}
          cornerRadius={8}
          shadowColor="black"
          shadowBlur={isSelected ? 20 : 10}
          shadowOpacity={isSelected ? 0.4 : 0.2}
        />
        <Text
          text={zone.name}
          fontSize={14}
          fontFamily="sans-serif"
          fill={isSelected ? '#e5e7eb' : '#a3a3a3'}
          padding={12}
          align="center"
          width={zone.width}
        />
        {isSelected && (
          <Text
            text={`${zone.width} × ${zone.height}`}
            fontSize={10}
            fontFamily="monospace"
            fill="#6b7280"
            y={zone.height - 22}
            align="center"
            width={zone.width}
          />
        )}
      </Group>

      {isSelected && (
        <Transformer
          ref={transformerRef}
          rotateEnabled={false}
          flipEnabled={false}
          keepRatio={false}
          boundBoxFunc={(_oldBox, newBox) => ({
            ...newBox,
            width: Math.max(80, newBox.width),
            height: Math.max(60, newBox.height),
          })}
          anchorStyleFunc={(anchor) => {
            // Hide the mid-edge anchors — only corners for resize
            const name = anchor.name();
            if (['top-center', 'bottom-center', 'middle-left', 'middle-right'].includes(name)) {
              anchor.visible(false);
            }
            anchor.fill('#e5e7eb');
            anchor.stroke('#6b7280');
            anchor.strokeWidth(1);
            anchor.cornerRadius(2);
          }}
        />
      )}
    </>
  );
}

// ─── Inline Rename Input ──────────────────────────────────────────────────────
// A DOM <input> absolutely positioned over the canvas, so we get native text editing.

function InlineRenameInput({
  zone,
  anchorPos,
  onCommit,
  onCancel,
}: {
  zone: LogicalZone;
  anchorPos: { x: number; y: number };
  onCommit: (id: string, name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(zone.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const commit = async () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== zone.name) {
      await onCommit(zone.id, trimmed);
    } else {
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onCancel();
      }}
      onBlur={commit}
      style={{
        position: 'fixed',
        left: anchorPos.x + zone.width / 2 - 80,
        top: anchorPos.y + 8,
        width: Math.max(160, zone.width * 0.7),
        zIndex: 100,
      }}
      className="bg-neutral-800 border border-neutral-500 rounded px-2 py-1 text-white text-sm text-center focus:outline-none focus:border-neutral-300 shadow-xl"
    />
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const MIN_FLOOR = 1;
const MAX_FLOOR = 5;

export function RoomsView({ devices: _devices }: RoomsViewProps) {
  const [zones, setZones] = useState<LogicalZone[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentFloor, setCurrentFloor] = useState(1);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 1200, height: 800 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Inline rename state
  const [renaming, setRenaming] = useState<{
    zone: LogicalZone;
    anchorPos: { x: number; y: number };
  } | null>(null);

  // ── Responsive canvas ──
  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // ── Fetch zones whenever floor changes ──
  useEffect(() => {
    setIsLoading(true);
    setSelectedZoneId(null);
    setRenaming(null);
    const fetchZones = async () => {
      try {
        const res = await fetch(`/api/zones?floor_level=${currentFloor}`);
        if (res.ok) setZones(await res.json());
        else setZones([]);
      } catch (err) {
        console.error('Failed to load floorplan:', err);
        setZones([]);
      } finally {
        setIsLoading(false);
      }
    };
    fetchZones();
  }, [currentFloor]);

  // ── Drag end ──
  const handleDragEnd = useCallback((zoneId: string, x: number, y: number) => {
    setZones(prev => prev.map(z => z.id === zoneId ? { ...z, pos_x: x, pos_y: y } : z));
    setIsDirty(true);
  }, []);

  // ── Resize end ──
  const handleTransformEnd = useCallback((zoneId: string, x: number, y: number, w: number, h: number) => {
    setZones(prev => prev.map(z =>
      z.id === zoneId ? { ...z, pos_x: x, pos_y: y, width: w, height: h } : z
    ));
    setIsDirty(true);
  }, []);

  // ── Save all ──
  const handleSaveAll = useCallback(async () => {
    setIsSaving(true);
    try {
      await Promise.all(
        zones.map(z =>
          fetch(`/api/zones/${z.id}/layout`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ width: z.width, height: z.height, pos_x: z.pos_x, pos_y: z.pos_y }),
          })
        )
      );
      setIsDirty(false);
    } finally {
      setIsSaving(false);
    }
  }, [zones]);

  // ── Create room ──
  const handleCreateRoom = async (name: string, width: number, height: number) => {
    const res = await fetch('/api/zones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, floor_level: currentFloor, width, height, pos_x: 40, pos_y: 40 }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail ?? 'Creation failed');
    }
    const zone = await res.json();
    setZones(prev => [...prev, zone]);
  };

  // ── Delete room ──
  const handleDeleteSelected = async () => {
    if (!selectedZoneId) return;
    if (!confirm('Delete this room? This cannot be undone.')) return;
    await fetch(`/api/zones/${selectedZoneId}`, { method: 'DELETE' });
    setZones(prev => prev.filter(z => z.id !== selectedZoneId));
    setSelectedZoneId(null);
  };

  // ── Inline rename: open ──
  const handleDoubleClick = useCallback((zone: LogicalZone, anchorPos: { x: number; y: number }) => {
    setRenaming({ zone, anchorPos });
  }, []);

  // ── Inline rename: commit ──
  const handleRenameCommit = async (id: string, newName: string) => {
    // Optimistic
    setZones(prev => prev.map(z => z.id === id ? { ...z, name: newName } : z));
    setRenaming(null);
    // Persist
    await fetch(`/api/zones/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
  };

  const selectedZone = zones.find(z => z.id === selectedZoneId);

  return (
    <div className="w-full h-full bg-neutral-950 flex flex-col">

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800 shrink-0 gap-4">

        {/* Left: Elevator floor switcher + room count */}
        <div className="flex items-center gap-3">
          <FloorSwitcher
            floor={currentFloor}
            minFloor={MIN_FLOOR}
            maxFloor={MAX_FLOOR}
            onChange={f => { setCurrentFloor(f); setIsDirty(false); }}
          />
          <div className="flex flex-col">
            <span className="text-neutral-300 text-xs font-medium leading-tight">
              Floor {currentFloor}
            </span>
            <span className="text-neutral-600 text-xs leading-tight">
              {isLoading ? '—' : `${zones.length} room${zones.length !== 1 ? 's' : ''}`}
            </span>
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2">
          {selectedZoneId && (
            <button
              onClick={handleDeleteSelected}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-red-400 border border-red-900/50 hover:bg-red-950/40 text-xs transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete "{selectedZone?.name}"
            </button>
          )}

          {isDirty && (
            <button
              onClick={handleSaveAll}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium disabled:opacity-50 transition-colors"
            >
              {isSaving ? 'Saving…' : '↑ Save Layout'}
            </button>
          )}

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-neutral-900 text-xs font-medium hover:bg-neutral-200 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            Add Room
          </button>
        </div>
      </div>

      {/* ── Canvas ── */}
      <div ref={containerRef} className="flex-1 overflow-hidden relative">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-neutral-500 text-sm animate-pulse">Loading spatial data…</span>
          </div>
        ) : (
          <Stage
            width={stageSize.width}
            height={stageSize.height}
            onClick={e => { if (e.target === e.target.getStage()) setSelectedZoneId(null); }}
          >
            <Layer>
              {zones.map(zone => (
                <ResizableRoom
                  key={zone.id}
                  zone={zone}
                  isSelected={zone.id === selectedZoneId}
                  onSelect={() => setSelectedZoneId(prev => prev === zone.id ? null : zone.id)}
                  onDragEnd={(x, y) => handleDragEnd(zone.id, x, y)}
                  onTransformEnd={(x, y, w, h) => handleTransformEnd(zone.id, x, y, w, h)}
                  onDoubleClick={handleDoubleClick}
                />
              ))}
            </Layer>
          </Stage>
        )}

        {/* Inline rename input — rendered in DOM so we get a real cursor/keyboard */}
        {renaming && (
          <InlineRenameInput
            zone={renaming.zone}
            anchorPos={renaming.anchorPos}
            onCommit={handleRenameCommit}
            onCancel={() => setRenaming(null)}
          />
        )}

        {/* Hint when canvas is empty */}
        {!isLoading && zones.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
            <span className="text-neutral-700 text-sm">No rooms on Floor {currentFloor}</span>
            <span className="text-neutral-800 text-xs">Use "Add Room" to place one</span>
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {showAddModal && (
        <AddRoomModal
          floorLevel={currentFloor}
          onClose={() => setShowAddModal(false)}
          onCreate={handleCreateRoom}
        />
      )}
    </div>
  );
}