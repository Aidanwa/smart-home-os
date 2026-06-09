// src/components/rooms/canvas/ResizableRoom.tsx
import { useEffect, useRef, useState } from 'react';
import { Group, Rect, Text, Transformer, Circle, Path } from 'react-konva';
import type Konva from 'konva';

import { GRID_PX, ftToPx, pxToFt } from '../constants';
import type { LogicalZone, DevicePlacement } from '../types';

// Lucide paths translated for native Konva rendering
const DEVICE_PATHS = {
  light: "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.9 1.3 1.5 1.5 2.5 M9 18h6 M10 22h4 M9 18c0 1.1.9 2 2 2h2a2 2 0 0 0 2-2",
  plug: "M12 22v-5 M9 8V2 M15 8V2 M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z",
  temp: "M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z",
  radio: "M4.9 19.1C1 15.2 1 8.8 4.9 4.9 M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5 M13.8 13.8 12 12 M22 12h-4 M18 9l-3 3 M18 15l-3-3"
};

const getDeviceVisuals = (device: any) => {
  const name = device.friendly_name?.toLowerCase() || '';
  if (name.includes('light') || name.includes('lamp') || device.brightness !== undefined) return { path: DEVICE_PATHS.light, color: "#fbbf24" };
  if (name.includes('plug') || name.includes('outlet') || device.power !== undefined) return { path: DEVICE_PATHS.plug, color: "#34d399" };
  if (name.includes('temp') || name.includes('sensor')) return { path: DEVICE_PATHS.temp, color: "#60a5fa" };
  return { path: DEVICE_PATHS.radio, color: "#a1a1aa" };
};

export function ResizableRoom({ 
  zone, 
  isSelected, 
  roomPlacements, 
  devices,
  updateDevicePlacement,
  onSelect, 
  onDragEnd, 
  onTransformEnd, 
  onDoubleClick,
  onDeviceClick
}: { 
  zone: LogicalZone; 
  isSelected: boolean; 
  roomPlacements: DevicePlacement[];
  devices: Record<string, any>;
  updateDevicePlacement: (ieee_address: string, zone_id: string | null, pos_x: number, pos_y: number) => void;
  onSelect: () => void; 
  onDragEnd: (x: number, y: number) => void; 
  onTransformEnd: (x: number, y: number, w: number, h: number) => void; 
  onDoubleClick: (zone: LogicalZone, nodePos: { x: number; y: number }) => void; 
  onDeviceClick: (ieee_address: string) => void;
}) {
  const groupRef = useRef<Konva.Group>(null);
  const transformerRef = useRef<Konva.Transformer>(null);

  const [liveSize, setLiveSize] = useState({ w: zone.width, h: zone.height });
  const [livePos, setLivePos] = useState({ x: zone.pos_x, y: zone.pos_y });

  useEffect(() => {
    setLiveSize({ w: zone.width, h: zone.height });
    setLivePos({ x: zone.pos_x, y: zone.pos_y });
  }, [zone.width, zone.height, zone.pos_x, zone.pos_y]);

  useEffect(() => {
    if (isSelected && transformerRef.current && groupRef.current) {
      transformerRef.current.nodes([groupRef.current]);
      transformerRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  const pxWidth = ftToPx(liveSize.w);
  const pxHeight = ftToPx(liveSize.h);
  const roomColor = zone.color || '#64748b';

  return (
    <>
      <Group
        ref={groupRef}
        x={ftToPx(livePos.x)}
        y={ftToPx(livePos.y)}
        draggable
        onClick={(e) => { if (e.target === e.currentTarget || e.target.name() === 'room-bg') onSelect(); }}
        onTap={(e) => { if (e.target === e.currentTarget || e.target.name() === 'room-bg') onSelect(); }}
        // STRICT ROOM BOUNDARIES
        dragBoundFunc={(pos) => {
          const stage = groupRef.current?.getStage();
          if (!stage) return pos;
          let x = Math.round(pos.x / GRID_PX) * GRID_PX;
          let y = Math.round(pos.y / GRID_PX) * GRID_PX;
          x = Math.max(0, Math.min(stage.width() - pxWidth, x));
          y = Math.max(0, Math.min(stage.height() - pxHeight, y));
          return { x, y };
        }}
        onDragMove={(e) => {
          if (e.target !== groupRef.current) return;
          setLivePos({ x: pxToFt(e.target.x()), y: pxToFt(e.target.y()) });
        }}
        onDragEnd={(e) => {
          if (e.target !== groupRef.current) return;
          onDragEnd(pxToFt(e.target.x()), pxToFt(e.target.y()));
        }}
        onTransform={() => {
          const node = groupRef.current;
          if (!node) return;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          node.scaleX(1); node.scaleY(1);
          setLiveSize({ w: pxToFt(ftToPx(liveSize.w) * scaleX), h: pxToFt(ftToPx(liveSize.h) * scaleY) });
          setLivePos({ x: pxToFt(node.x()), y: pxToFt(node.y()) });
        }}
        onTransformEnd={() => onTransformEnd(livePos.x, livePos.y, liveSize.w, liveSize.h)}
        onDblClick={() => {
          const node = groupRef.current;
          if (!node) return;
          const stage = node.getStage();
          if (!stage) return;
          const container = stage.container().getBoundingClientRect();
          const abs = node.getAbsolutePosition();
          onDoubleClick(zone, { x: container.left + abs.x, y: container.top + abs.y });
        }}
      >
        <Rect name="room-bg" width={pxWidth} height={pxHeight} fill={isSelected ? `${roomColor}80` : `${roomColor}40`} stroke={isSelected ? '#ffffff' : roomColor} strokeWidth={isSelected ? 2 : 1.5} cornerRadius={8} shadowColor="black" shadowBlur={isSelected ? 20 : 10} shadowOpacity={isSelected ? 0.3 : 0.15} />
        <Text name="room-bg" text={zone.name} fontSize={16} fontFamily="sans-serif" fontStyle="600" fill={isSelected ? '#ffffff' : '#d4d4d8'} align="center" verticalAlign="middle" width={pxWidth} height={pxHeight} padding={0} listening={false} />

        {/* DEVICES */}
        {roomPlacements.map((placement) => {
          const device = devices[placement.ieee_address];
          if (!device) return null;

          const deviceX = (placement.pos_x / 100) * pxWidth;
          const deviceY = (placement.pos_y / 100) * pxHeight;
          const visuals = getDeviceVisuals(device);

          return (
            <Group
              key={placement.ieee_address}
              x={deviceX}
              y={deviceY}
              draggable
              // EVENT ISOLATION
              onClick={(e) => { e.cancelBubble = true; onDeviceClick(placement.ieee_address); }}
              onTap={(e) => { e.cancelBubble = true; onDeviceClick(placement.ieee_address); }}
              // STRICT DEVICE BOUNDARIES
              dragBoundFunc={function(this: Konva.Node, pos) {
                const parent = this.getParent();
                if (!parent) return pos;
                const transform = parent.getAbsoluteTransform().copy().invert();
                const localPos = transform.point(pos);
                localPos.x = Math.max(0, Math.min(pxWidth, localPos.x));
                localPos.y = Math.max(0, Math.min(pxHeight, localPos.y));
                return parent.getAbsoluteTransform().point(localPos);
              }}
              onDragEnd={(e) => {
                e.cancelBubble = true;
                const node = e.target;
                let percentX = (node.x() / pxWidth) * 100;
                let percentY = (node.y() / pxHeight) * 100;
                
                if (percentX < 4) percentX = 0;
                if (percentX > 96) percentX = 100;
                if (percentY < 4) percentY = 0;
                if (percentY > 96) percentY = 100;
            
                percentX = Math.max(0, Math.min(100, percentX));
                percentY = Math.max(0, Math.min(100, percentY));

                node.x((percentX / 100) * pxWidth);
                node.y((percentY / 100) * pxHeight);
                updateDevicePlacement(placement.ieee_address, zone.id, percentX, percentY);
              }}
            >
              <Circle radius={14} fill="#1e293b" stroke="#475569" strokeWidth={2} shadowColor="black" shadowBlur={5} shadowOpacity={0.5} />
              <Path data={visuals.path} fill="transparent" stroke={visuals.color} strokeWidth={2.5} strokeLineCap="round" strokeLineJoin="round" scale={{x: 0.6, y: 0.6}} x={-7} y={-7} listening={false} />
              {/* TRUNCATED TEXT */}
              <Text 
                text={device.friendly_name} 
                fontSize={10} 
                fill="#f8fafc" 
                align="center"
                width={70} 
                x={-35} 
                y={18} 
                ellipsis={true} 
                wrap="none" 
                listening={false} 
              />
            </Group>
          );
        })}
      </Group>

      {isSelected && (
        <Transformer
          ref={transformerRef} rotateEnabled={false} flipEnabled={false} keepRatio={false}
          boundBoxFunc={(_oldBox, newBox) => {
            const minPx = ftToPx(2); 
            let snappedWidth = Math.round(newBox.width / GRID_PX) * GRID_PX;
            let snappedHeight = Math.round(newBox.height / GRID_PX) * GRID_PX;
            return { ...newBox, width: Math.max(minPx, snappedWidth), height: Math.max(minPx, snappedHeight) };
          }}
          anchorStyleFunc={(anchor) => {
            const name = anchor.name();
            if (['top-center', 'bottom-center', 'middle-left', 'middle-right'].includes(name)) anchor.visible(false);
            anchor.fill('#ffffff'); anchor.stroke(roomColor); anchor.strokeWidth(2); anchor.cornerRadius(4); anchor.size({ width: 10, height: 10 });
          }}
        />
      )}
    </>
  );
}