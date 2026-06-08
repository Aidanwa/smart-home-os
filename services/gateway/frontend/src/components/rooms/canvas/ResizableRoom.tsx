import { useEffect, useRef, useState } from 'react';
import { Group, Rect, Text, Transformer } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type Konva from 'konva';

import {
  GRID_PX,
  ftToPx,
  pxToFt,
} from '../constants';

import type { LogicalZone } from '../types';

export function ResizableRoom({ zone, isSelected, onSelect, onDragEnd, onTransformEnd, onDoubleClick }: { zone: LogicalZone; isSelected: boolean; onSelect: () => void; onDragEnd: (x: number, y: number) => void; onTransformEnd: (x: number, y: number, w: number, h: number) => void; onDoubleClick: (zone: LogicalZone, nodePos: { x: number; y: number }) => void; }) {
  const groupRef = useRef<Konva.Group>(null);
  const transformerRef = useRef<Konva.Transformer>(null);

  // Local state for LIVE 60fps updates while dragging/resizing
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

  const handleDragMove = (e: KonvaEventObject<DragEvent>) => {
    setLivePos({ x: pxToFt(e.target.x()), y: pxToFt(e.target.y()) });
  };

  const handleTransform = () => {
    const node = groupRef.current;
    if (!node) return;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1); node.scaleY(1);
    
    const newWidthFt = pxToFt(ftToPx(liveSize.w) * scaleX);
    const newHeightFt = pxToFt(ftToPx(liveSize.h) * scaleY);
    
    setLiveSize({ w: newWidthFt, h: newHeightFt });
    setLivePos({ x: pxToFt(node.x()), y: pxToFt(node.y()) });
  };

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
        onClick={onSelect}
        onTap={onSelect}
        dragBoundFunc={(pos) => ({
          x: Math.round(pos.x / GRID_PX) * GRID_PX,
          y: Math.round(pos.y / GRID_PX) * GRID_PX,
        })}
        onDragMove={handleDragMove}
        onDragEnd={e => onDragEnd(pxToFt(e.target.x()), pxToFt(e.target.y()))}
        onTransform={handleTransform}
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
        <Rect width={pxWidth} height={pxHeight} fill={isSelected ? `${roomColor}80` : `${roomColor}40`} stroke={isSelected ? '#ffffff' : roomColor} strokeWidth={isSelected ? 2 : 1.5} cornerRadius={8} shadowColor="black" shadowBlur={isSelected ? 20 : 10} shadowOpacity={isSelected ? 0.3 : 0.15} />
        <Text text={zone.name} fontSize={16} fontFamily="sans-serif" fontStyle="600" fill={isSelected ? '#ffffff' : '#d4d4d8'} align="center" verticalAlign="middle" width={pxWidth} height={pxHeight} padding={0} />
        {isSelected && <Text text={`${liveSize.w}' × ${liveSize.h}'`} fontSize={12} fontFamily="monospace" fill="#a1a1aa" y={pxHeight - 20} align="center" width={pxWidth} />}
      </Group>

      {isSelected && (
        <Transformer
          ref={transformerRef} rotateEnabled={false} flipEnabled={false} keepRatio={false}
          boundBoxFunc={(_oldBox, newBox) => {
            const minPx = ftToPx(2); // Reduced minimum size
            let snappedWidth = Math.round(newBox.width / GRID_PX) * GRID_PX;
            let snappedHeight = Math.round(newBox.height / GRID_PX) * GRID_PX;
            
            return {
              ...newBox,
              width: Math.max(minPx, snappedWidth),
              height: Math.max(minPx, snappedHeight),
            };
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