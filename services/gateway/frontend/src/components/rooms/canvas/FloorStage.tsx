import { Stage, Layer } from 'react-konva';
import { useState, useEffect, useRef } from 'react';
import { Maximize2 } from 'lucide-react';

import { GhostRoom } from './GhostRoom';
import { ResizableRoom } from './ResizableRoom';
import type { LogicalZone, DevicePlacement } from '../types';
import { ftToPx } from '../constants';

const FIT_PAD = 24;
/** Camera that fits these rooms in the stage. `maxScale` 1 never zooms past 100% (the floor view). */
function fitCamera(rooms: LogicalZone[], width: number, height: number, maxScale: number) {
  const minX = Math.min(...rooms.map(z => ftToPx(z.pos_x)));
  const minY = Math.min(...rooms.map(z => ftToPx(z.pos_y)));
  const maxX = Math.max(...rooms.map(z => ftToPx(z.pos_x + z.width)));
  const maxY = Math.max(...rooms.map(z => ftToPx(z.pos_y + z.height)));
  const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
  const scale = Math.min(maxScale, (width - 2 * FIT_PAD) / bw, (height - 2 * FIT_PAD) / bh);
  return { scale, x: (width - bw * scale) / 2 - minX * scale, y: (height - bh * scale) / 2 - minY * scale };
}

interface FloorStageProps {
  // ... (keep your existing props interface exactly as is)
  width: number;
  height: number;
  zones: LogicalZone[];
  baseFloorZones: LogicalZone[];
  selectedZoneId: string | null;
  onSelectZone: (id: string | null) => void;
  onDragEnd: (zoneId: string, xFt: number, yFt: number) => void;
  onTransformEnd: (zoneId: string, xFt: number, yFt: number, wFt: number, hFt: number) => void;
  onEditZone: (zone: LogicalZone, pos: { x: number; y: number }) => void;
  devices: Record<string, any>;
  placements: DevicePlacement[];
  updateDevicePlacement: (ieee_address: string, zone_id: string | null, pos_x: number, pos_y: number) => void;
  onDeviceClick: (ieee_address: string) => void;
  /** Edit mode: the selected room can be moved and resized. Otherwise the plan only pans. */
  editable: boolean;
}

export function FloorStage(props: FloorStageProps) {
  const { width, height } = props;

  // --- 1. NEW: Camera State ---
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [stageScale, setStageScale] = useState(1);
  const [hasInitialized, setHasInitialized] = useState(false);
  const stageRef = useRef<any>(null);

  // --- 2. Fit the rooms to the screen once, when the real size is known ---
  // (Shrinks to fit on phones; never zooms in past 100% on big screens.)
  useEffect(() => {
    if (width <= 0 || height <= 0 || hasInitialized) return;
    const all = [...props.zones, ...props.baseFloorZones];
    if (all.length) {
      const cam = fitCamera(all, width, height, 1);
      setStageScale(cam.scale);
      setStagePos({ x: cam.x, y: cam.y });
    }
    setHasInitialized(true);
  }, [width, height, hasInitialized, props.zones, props.baseFloorZones]);

  // View mode: tapping a room zooms to it, so its devices are big and their names readable
  // on a phone. Tapping it again, empty space or "Whole floor" zooms back out.
  const [zoomedState, setZoomedZoneId] = useState<string | null>(null);
  // Edit mode keeps the camera where it is but forgets which room was zoomed.
  const zoomedZoneId = props.editable ? null : zoomedState;
  const flyTo = (cam: { scale: number; x: number; y: number }) => {
    const stage = stageRef.current;
    const done = () => { setStageScale(cam.scale); setStagePos({ x: cam.x, y: cam.y }); };
    if (!stage) return done();
    stage.to({ x: cam.x, y: cam.y, scaleX: cam.scale, scaleY: cam.scale, duration: 0.25, onFinish: done });
  };
  const zoomOut = () => {
    setZoomedZoneId(null);
    const all = [...props.zones, ...props.baseFloorZones];
    if (all.length) flyTo(fitCamera(all, width, height, 1));
  };
  const zoomToRoom = (zone: LogicalZone) => {
    if (zoomedZoneId === zone.id) return zoomOut();
    setZoomedZoneId(zone.id);
    flyTo(fitCamera([zone], width, height, 3));
  };

  // --- 3. NEW: Desktop Wheel Zoom ---
  const handleWheel = (e: any) => {
    e.evt.preventDefault();
    const scaleBy = 1.1;
    const stage = e.target.getStage();
    const oldScale = stage.scaleX();

    const mousePointTo = {
      x: stage.getPointerPosition().x / oldScale - stage.x() / oldScale,
      y: stage.getPointerPosition().y / oldScale - stage.y() / oldScale,
    };

    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;

    // Prevent zooming too far in or out
    if (newScale < 0.1 || newScale > 5) return;

    setStageScale(newScale);
    setStagePos({
      x: -(mousePointTo.x - stage.getPointerPosition().x / newScale) * newScale,
      y: -(mousePointTo.y - stage.getPointerPosition().y / newScale) * newScale,
    });
  };

  // --- 4. NEW: Mobile Pinch-to-Zoom ---
  const lastDist = useRef<number>(0);

  const handleTouchMove = (e: any) => {
    e.evt.preventDefault();
    const touch1 = e.evt.touches[0];
    const touch2 = e.evt.touches[1];

    // If two fingers are detected, calculate distance for zoom
    if (touch1 && touch2) {
      const stage = e.target.getStage();

      const p1 = { x: touch1.clientX, y: touch1.clientY };
      const p2 = { x: touch2.clientX, y: touch2.clientY };
      const dist = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

      if (!lastDist.current) {
        lastDist.current = dist;
      }

      // Calculate center point of pinch
      const center = {
        x: (p1.x + p2.x) / 2,
        y: (p1.y + p2.y) / 2,
      };

      const pointTo = {
        x: (center.x - stage.x()) / stage.scaleX(),
        y: (center.y - stage.y()) / stage.scaleX(),
      };

      const scale = stage.scaleX() * (dist / lastDist.current);

      if (scale >= 0.1 && scale <= 5) {
        setStageScale(scale);
        setStagePos({
          x: center.x - pointTo.x * scale,
          y: center.y - pointTo.y * scale,
        });
      }

      lastDist.current = dist;
    }
  };

  const handleTouchEnd = () => {
    lastDist.current = 0;
  };

  return (
    <>
    <Stage
      ref={stageRef}
      width={width}
      height={height}

      // --- 5. NEW: State Bindings & Panning ---
      x={stagePos.x}
      y={stagePos.y}
      scaleX={stageScale}
      scaleY={stageScale}
      draggable // Enables dragging the background!

      onWheel={handleWheel}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}

      onDragEnd={(e) => {
        // Ensure we only save the drag position if we dragged the stage, not a room
        if (e.target === e.target.getStage()) {
          setStagePos({ x: e.target.x(), y: e.target.y() });
        }
      }}
      // -----------------------------------------

      onClick={(e) => {
        if (e.target === e.target.getStage()) {
          props.onSelectZone(null);
          if (zoomedZoneId) zoomOut();
        }
      }}
      onTap={(e) => { // Added onTap specifically for Mobile deselect
        if (e.target === e.target.getStage()) {
          props.onSelectZone(null);
          if (zoomedZoneId) zoomOut();
        }
      }}
    >
      <Layer>
        {props.baseFloorZones.map((zone) => (
          <GhostRoom
            key={`ghost-${zone.id}`}
            zone={zone}
          />
        ))}

        {props.zones.map((zone) => {
          const roomPlacements = props.placements.filter(p => p.zone_id === zone.id);

          return (
            <ResizableRoom
              key={zone.id}
              zone={zone}
              roomPlacements={roomPlacements}
              devices={props.devices}
              updateDevicePlacement={props.updateDevicePlacement}
              isSelected={props.editable && zone.id === props.selectedZoneId}
              editable={props.editable}
              onDeviceClick={props.onDeviceClick}
              stageScale={stageScale}
              onSelect={() => {
                if (!props.editable) return zoomToRoom(zone);
                // Selecting only happens in edit mode. Tapping the selected room keeps it selected
                // (tap empty space to deselect), so a tap before a drag doesn't drop the selection.
                if (props.editable && props.selectedZoneId !== zone.id) props.onSelectZone(zone.id);
              }}
              onDragEnd={(xFt, yFt) => props.onDragEnd(zone.id, xFt, yFt)}
              onTransformEnd={(xFt, yFt, wFt, hFt) =>
                props.onTransformEnd(zone.id, xFt, yFt, wFt, hFt)
              }
              onDoubleClick={(z, pos) => props.onEditZone(z, pos)}
            />
          );
        })}
      </Layer>
    </Stage>
    {zoomedZoneId && (
      <button type="button" onClick={zoomOut}
        className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-3 min-h-10 rounded-full bg-neutral-900/90 border border-neutral-700 text-xs font-medium text-neutral-200 hover:bg-neutral-800 shadow-lg">
        <Maximize2 size={14} /> Whole floor
      </button>
    )}
    </>
  );
}