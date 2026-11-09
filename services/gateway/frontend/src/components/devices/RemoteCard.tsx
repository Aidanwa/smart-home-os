import { useState } from 'react';
import { Gamepad2 } from 'lucide-react';
import type { DeviceState } from '../../hooks/useDevices';
import { BaseDeviceCard } from './BaseDeviceCard';

interface Props {
  name: string;
  state: DeviceState;
  renameDevice: (oldName: string, newName: string) => void;
  deleteDevice: (name: string, label?: string) => void;
}

/** "brightness_move_up" -> "Brightness move up" */
const readable = (a: string) => a.charAt(0).toUpperCase() + a.slice(1).replace(/_/g, ' ');

/** Remotes and buttons: nothing to switch, so show the last button pressed.
 *  Z2M clears `action` to "" right after each press, so remember the last non-empty one. */
export function RemoteCard({ name, state, renameDevice, deleteDevice }: Props) {
  const current = typeof state.action === 'string' && state.action ? state.action : null;
  const [last, setLast] = useState(current);
  if (current && current !== last) setLast(current);  // adjust during render, not in an effect
  return (
    <BaseDeviceCard
      name={name}
      state={state}
      icon={<Gamepad2 size={22} strokeWidth={2.5} />}
      iconColorClass="bg-purple-500/10 text-purple-400"
      subtitle={last ? `Last press: ${readable(last)}` : 'Remote'}
      renameDevice={renameDevice}
      deleteDevice={deleteDevice}
    />
  );
}
