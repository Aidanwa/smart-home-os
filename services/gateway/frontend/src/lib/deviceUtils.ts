import type { DeviceState } from '../hooks/useDevices';

export type DeviceCategory = 'Lights' | 'Smart Plugs' | 'Presence' | 'Sensors' | 'Remotes' | 'Switches' | 'Other';

/** What a device is, judged from the fields it reports. Both the Home sections and the card
 *  renderer use this, so a device can't be listed as one thing and drawn as another. */
export type DeviceKind = 'light' | 'plug' | 'climate' | 'presence' | 'sensor' | 'remote' | 'switch' | 'other';

/** Event-style sensor readings, in the order a card shows them. */
export const SENSOR_FIELDS = ['contact', 'water_leak', 'smoke', 'vibration'] as const;

/** Is someone there? mmWave sensors report `presence`, PIR motion sensors `occupancy`. */
export function isPresenceSensor(state: DeviceState): boolean {
  return state.presence !== undefined || state.occupancy !== undefined;
}

export function getDeviceKind(state: DeviceState): DeviceKind {
  if (state.brightness !== undefined || state.color_temp !== undefined) return 'light';
  if (typeof state.state === 'string' && (state.power !== undefined || state.energy !== undefined)) return 'plug';
  if (typeof state.state === 'string') return 'switch';
  if (isPresenceSensor(state)) return 'presence';
  if (SENSOR_FIELDS.some((f) => state[f] !== undefined)) return 'sensor';
  if (state.temperature !== undefined || state.humidity !== undefined) return 'climate';
  if ('action' in state) return 'remote';
  return 'other';
}

const CATEGORY: Record<DeviceKind, DeviceCategory> = {
  light: 'Lights',
  plug: 'Smart Plugs',
  switch: 'Switches',
  presence: 'Presence',
  sensor: 'Sensors',
  climate: 'Sensors',
  remote: 'Remotes',
  other: 'Other',
};

export function getDeviceCategory(state: DeviceState): DeviceCategory {
  return CATEGORY[getDeviceKind(state)];
}

/** Battery-powered devices that need attention soon. */
export function isBatteryLow(state: DeviceState): boolean {
  return state.battery_low === true || (typeof state.battery === 'number' && state.battery <= 15);
}

/** A sensor's temperature as shown on cards. Z2M always reports °C; the app shows °F (as the
 *  routine editor does) unless the device itself is set to show Celsius. */
export function formatTemperature(state: DeviceState): { value: number; unit: 'F' | 'C' } | null {
  if (typeof state.temperature !== 'number') return null;
  return state.temperature_units === 'celsius'
    ? { value: state.temperature, unit: 'C' }
    : { value: Math.round(state.temperature * 9 / 5 + 32), unit: 'F' };
}
