import type { DeviceState } from '../hooks/useDevices';

export type DeviceCategory = 'Lights' | 'Smart Plugs' | 'Sensors' | 'Switches' | 'Other';

export function getDeviceCategory(state: DeviceState): DeviceCategory {
  if (state.brightness !== undefined || state.color_temp !== undefined) return 'Lights';
  if (state.power !== undefined || state.energy !== undefined) return 'Smart Plugs';
  if (state.temperature !== undefined || state.humidity !== undefined) return 'Sensors';
  if (state.state !== undefined) return 'Switches';
  return 'Other';
}