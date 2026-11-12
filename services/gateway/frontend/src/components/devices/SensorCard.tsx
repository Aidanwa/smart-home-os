import { DoorClosed, DoorOpen, Droplets, Flame, Activity, Thermometer, ShieldAlert } from 'lucide-react';
import type { DeviceState } from '../../hooks/useDevices';
import { formatTemperature } from '../../lib/deviceUtils';
import { BaseDeviceCard } from './BaseDeviceCard';

interface Props {
  name: string;
  state: DeviceState;
  renameDevice: (oldName: string, newName: string) => void;
  deleteDevice: (name: string, label?: string) => void;
}

interface Reading {
  text: string;
  alert: boolean;  // the "something is happening" state, drawn in a warning colour
  icon: React.ReactNode;
}

/** The headline reading of an event sensor. Z2M's `contact: true` means closed. */
function primaryReading(s: DeviceState): Reading | null {
  if (s.water_leak !== undefined) return { text: s.water_leak ? 'Leak!' : 'Dry', alert: !!s.water_leak, icon: <Droplets size={22} strokeWidth={2.5} /> };
  if (s.smoke !== undefined) return { text: s.smoke ? 'Smoke!' : 'Clear', alert: !!s.smoke, icon: <Flame size={22} strokeWidth={2.5} /> };
  if (s.contact !== undefined) return s.contact
    ? { text: 'Closed', alert: false, icon: <DoorClosed size={22} strokeWidth={2.5} /> }
    : { text: 'Open', alert: true, icon: <DoorOpen size={22} strokeWidth={2.5} /> };
  if (s.vibration !== undefined) return { text: s.vibration ? 'Vibration' : 'Still', alert: !!s.vibration, icon: <Activity size={22} strokeWidth={2.5} /> };
  return null;
}

export function SensorCard({ name, state, renameDevice, deleteDevice }: Props) {
  const reading = primaryReading(state);
  const temp = formatTemperature(state);

  const details: string[] = [];
  if (reading && temp) details.push(`${temp.value}°${temp.unit}`);
  if (state.humidity !== undefined) details.push(`${state.humidity}% humidity`);
  if (state.tamper) details.push('Tampered');

  return (
    <BaseDeviceCard
      name={name}
      state={state}
      icon={reading?.icon ?? <Thermometer size={22} strokeWidth={2.5} />}
      iconColorClass={reading?.alert ? 'bg-amber-500/15 text-amber-400' : 'bg-orange-500/10 text-orange-400'}
      subtitle={details.length ? (
        <span className="flex items-center gap-1">
          {state.tamper && <ShieldAlert size={12} className="text-red-400" />}
          {details.join(' • ')}
        </span>
      ) : undefined}
      renameDevice={renameDevice}
      deleteDevice={deleteDevice}
    >
      {reading ? (
        <span className={`text-3xl font-light tracking-tight ${reading.alert ? 'text-amber-300' : 'text-neutral-200'}`}>
          {reading.text}
        </span>
      ) : temp ? (
        <div className="flex items-baseline gap-1 text-neutral-200">
          <span className="text-4xl font-light tracking-tight">{temp.value}</span>
          <span className="text-sm font-medium text-neutral-500">°{temp.unit}</span>
        </div>
      ) : null}
    </BaseDeviceCard>
  );
}
