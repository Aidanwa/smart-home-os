import { Stage, Layer } from 'react-konva';

import { GhostRoom } from './GhostRoom';
import { ResizableRoom } from './ResizableRoom';

import type { LogicalZone, DevicePlacement } from '../types';

interface FloorStageProps {
  width: number;
  height: number;

  zones: LogicalZone[];
  baseFloorZones: LogicalZone[];

  selectedZoneId: string | null;

  onSelectZone: (id: string | null) => void;

  onDragEnd: (
    zoneId: string,
    xFt: number,
    yFt: number
  ) => void;

  onTransformEnd: (
    zoneId: string,
    xFt: number,
    yFt: number,
    wFt: number,
    hFt: number
  ) => void;

  onEditZone: (
    zone: LogicalZone,
    pos: { x: number; y: number }
  ) => void;

  devices: Record<string, any>;
  placements: DevicePlacement[];
  updateDevicePlacement: (ieee_address: string, zone_id: string | null, pos_x: number, pos_y: number) => void;
  onDeviceClick: (ieee_address: string) => void;
}

export function FloorStage({
  width,
  height,
  zones,
  baseFloorZones,
  selectedZoneId,
  onSelectZone,
  onDragEnd,
  onTransformEnd,
  onEditZone,
  devices,
  placements,
  updateDevicePlacement,
  onDeviceClick,
}: FloorStageProps) {
  return (
    <Stage
      width={width}
      height={height}
      onClick={(e) => {
        if (e.target === e.target.getStage()) {
          onSelectZone(null);
        }
      }}
    >
      <Layer>
        {baseFloorZones.map((zone) => (
          <GhostRoom
            key={`ghost-${zone.id}`}
            zone={zone}
          />
        ))}

        {zones.map((zone) => {

          const roomPlacements = placements.filter(p => p.zone_id === zone.id);

          return <ResizableRoom
            key={zone.id}
            zone={zone}
            roomPlacements={roomPlacements}
            devices={devices}
            updateDevicePlacement={updateDevicePlacement}
            isSelected={zone.id === selectedZoneId}
            onSelect={() =>
              onSelectZone(
                selectedZoneId === zone.id
                  ? null
                  : zone.id
              )
            }
            onDragEnd={(xFt, yFt) =>
              onDragEnd(zone.id, xFt, yFt)
            }
            onTransformEnd={(
              xFt,
              yFt,
              wFt,
              hFt
            ) =>
              onTransformEnd(
                zone.id,
                xFt,
                yFt,
                wFt,
                hFt
              )
            }
            onDoubleClick={(z, pos) =>
              onEditZone(z, pos)
            }
            onDeviceClick={onDeviceClick}
          />
        }
        )}
      </Layer>
    </Stage>
  );
}