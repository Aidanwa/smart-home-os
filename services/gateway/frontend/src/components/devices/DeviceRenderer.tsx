import type { DeviceState } from '../../hooks/useDevices';
import { SmartPlugCard } from './SmartPlugCard';
import { ColorLightCard } from './ColorLightCard';
import { EnvironmentSensorCard } from './EnvironmentSensorCard';
import { BasicSwitchCard } from './BasicSwitchCard';

interface Props {
  name: string;
  state: DeviceState;
  sendCommand: (name: string, payload: any) => void;
  toggleDevice: (name: string, currentState?: string) => void;
}

export function DeviceRenderer({ name, state, sendCommand, toggleDevice }: Props) {
  // 1. Determine Device Capabilities based on the payload schema
  const hasColorTemp = state.color_temp !== undefined;
  const hasBrightness = state.brightness !== undefined;
  const isEnergyMonitor = state.power !== undefined || state.energy !== undefined;
  const isEnvironmentSensor = state.temperature !== undefined || state.humidity !== undefined;
  
  // 2. Route to the specialized component
  if (isEnvironmentSensor) {
    return <EnvironmentSensorCard name={name} state={state} />;
  }

  if (hasColorTemp || hasBrightness) {
    return (
      <ColorLightCard 
        name={name} 
        state={state} 
        sendCommand={sendCommand} 
        toggleDevice={toggleDevice} 
      />
    );
  }

  if (isEnergyMonitor) {
    return (
      <SmartPlugCard 
        name={name} 
        state={state} 
        toggleDevice={toggleDevice} 
      />
    );
  }

  // Fallback to a basic on/off switch for generic relays
  return (
    <BasicSwitchCard 
      name={name} 
      state={state} 
      toggleDevice={toggleDevice} 
    />
  );
}