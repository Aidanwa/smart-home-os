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

export interface DevicePlacement {
  ieee_address: string;
  zone_id: string | null;
  pos_x: number;
  pos_y: number;
  pos_z: number;
}