import { ErrorBoundary } from '../ErrorBoundary';
import type { DeviceState } from '../../hooks/useDevices';
import { getDeviceKind } from '../../lib/deviceUtils';
import { SmartPlugCard } from './SmartPlugCard';
import { ColorLightCard } from './ColorLightCard';
import { SensorCard } from './SensorCard';
import { RemoteCard } from './RemoteCard';
import { BasicSwitchCard } from './BasicSwitchCard';
import { BaseDeviceCard } from './BaseDeviceCard';
import { Box } from 'lucide-react';

interface Props {
  name: string;
  state: DeviceState;
  sendCommand: (name: string, payload: Record<string, unknown>) => void;
  toggleDevice: (name: string, currentState?: string) => void;
  renameDevice: (oldName: string, newName: string) => void;
  deleteDevice: (name: string, label?: string) => void;
}

/** One card per device, each in its own error boundary: a device reporting data a card
 *  can't handle breaks only that card. A new state report gives it another try. */
export function DeviceRenderer(props: Props) {
  return (
    <ErrorBoundary variant="card" label={`card ${props.name}`} resetKey={props.state}>
      <DeviceCard {...props} />
    </ErrorBoundary>
  );
}

/** Picks a card by `getDeviceKind`, the same rule the Home sections group by. */
function DeviceCard({ name, state, sendCommand, toggleDevice, renameDevice, deleteDevice }: Props) {
  const manage = { name, state, renameDevice, deleteDevice };
  switch (getDeviceKind(state)) {
    case 'light':
      return <ColorLightCard {...manage} sendCommand={sendCommand} toggleDevice={toggleDevice} />;
    case 'plug':
      return <SmartPlugCard {...manage} toggleDevice={toggleDevice} />;
    case 'switch':
      return <BasicSwitchCard {...manage} toggleDevice={toggleDevice} />;
    case 'sensor':
    case 'climate':
      return <SensorCard {...manage} />;
    case 'remote':
      return <RemoteCard {...manage} />;
    default:
      // Nothing we know how to show or control: no fake power button.
      return <BaseDeviceCard {...manage} icon={<Box size={22} strokeWidth={2.5} />} subtitle="No controls" />;
  }
}
