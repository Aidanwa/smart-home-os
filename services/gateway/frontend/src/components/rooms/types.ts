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
  /** Switch a device by name (View mode taps). */
  toggleDevice: (name: string, currentState?: string) => unknown;
}

export interface DevicePlacement {
  ieee_address: string;
  zone_id: string | null;
  pos_x: number;
  pos_y: number;
  pos_z: number;
}