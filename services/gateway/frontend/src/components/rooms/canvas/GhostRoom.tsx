import { Group, Rect } from 'react-konva';
import { ftToPx } from '../constants';
import type { LogicalZone } from '../types';

export function GhostRoom({ zone }: { zone: LogicalZone }) {
  const pxWidth = ftToPx(zone.width);
  const pxHeight = ftToPx(zone.height);
  return (
    <Group x={ftToPx(zone.pos_x)} y={ftToPx(zone.pos_y)} listening={false}>
      <Rect width={pxWidth} height={pxHeight} fill="transparent" stroke="#52525b" strokeWidth={1.5} dash={[6, 6]} cornerRadius={8} />
      {/* Ghost text intentionally removed to keep the outline clean */}
    </Group>
  );
}