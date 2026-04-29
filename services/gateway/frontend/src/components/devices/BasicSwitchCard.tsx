import { ToggleRight, ToggleLeft } from 'lucide-react';
import type { DeviceState } from '../../hooks/useDevices';
import { BaseDeviceCard } from './BaseDeviceCard';

interface Props {
  name: string;
  state: DeviceState;
  toggleDevice: (name: string, currentState?: string) => void;
  renameDevice: (oldName: string, newName: string) => void;
}

export function BasicSwitchCard({ name, state, toggleDevice, renameDevice }: Props) {
  const isOn = state.state === 'ON';

  return (
    <BaseDeviceCard
      name={name}
      state={state}
      icon={isOn ? <ToggleRight size={22} strokeWidth={2.5} /> : <ToggleLeft size={22} strokeWidth={2.5} />}
      iconColorClass={isOn ? 'bg-green-500/10 text-green-400' : 'bg-neutral-800 text-neutral-500'}
      subtitle={isOn ? 'On' : 'Off'}
      onToggle={() => toggleDevice(name, state.state)}
      renameDevice={renameDevice}
    />
  );
}