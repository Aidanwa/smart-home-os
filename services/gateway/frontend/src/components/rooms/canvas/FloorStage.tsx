import { Stage, Layer } from 'react-konva';
import { useState, useEffect, useRef } from 'react'; // ADDED HOOKS

import { GhostRoom } from './GhostRoom';
import { ResizableRoom } from './ResizableRoom';
import type { LogicalZone, DevicePlacement } from '../types';

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
}

export function FloorStage(props: FloorStageProps) {
  const { width, height } = props;

  // --- 1. NEW: Camera State ---
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [stageScale, setStageScale] = useState(1);
  const [hasInitialized, setHasInitialized] = useState(false);
  const stageRef = useRef<any>(null);

  // --- 2. NEW: Auto-Fit on mount for mobile ---
  useEffect(() => {
    if (width > 0 && height > 0 && !hasInitialized) {
      if (width < 768) {
        const fitScale = width / 1200; 
        setStageScale(fitScale);
        // Center the scaled map roughly on screen
        setStagePos({ x: width * 0.05, y: height * 0.1 });
      }
      setHasInitialized(true);
    }
  }, [width, height, hasInitialized]);

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
        }
      }}
      onTap={(e) => { // Added onTap specifically for Mobile deselect
        if (e.target === e.target.getStage()) {
          props.onSelectZone(null);
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
              isSelected={zone.id === props.selectedZoneId}
              
              // ADD THIS LINE:
              onDeviceClick={props.onDeviceClick} 
              
              onSelect={() =>
                props.onSelectZone(props.selectedZoneId === zone.id ? null : zone.id)
              }
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
  );
}