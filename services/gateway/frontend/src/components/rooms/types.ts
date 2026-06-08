export interface LogicalZone {
  id: string;
  name: string;
  floor_level: number;
  width: number;
  height: number;
  pos_x: number;
  pos_y: number;
  color?: string;
}

export interface RoomsViewProps {
  devices: Record<string, any>;
}