import { DeviceRenderer } from './DeviceRenderer';
import type { DeviceState } from '../../hooks/useDevices';

export interface DeviceSection {
  id: string;
  title: string | null;
  icon?: React.ReactNode;
  devices: Array<{ name: string; state: DeviceState }>;
}

// Add this interface to extend DeviceSection with the functions
interface Props extends DeviceSection {
  sendCommand: (name: string, payload: any) => void;
  toggleDevice: (name: string, currentState?: string) => void;
  renameDevice: (oldName: string, newName: string) => void;
}

export function DeviceCategorySection({ title, icon, devices, sendCommand, toggleDevice, renameDevice }: Props) {
  if (devices.length === 0) return null;

  return (
    <div className="mb-8">
      {title && (
        <div className="flex items-center gap-2 mb-4 text-neutral-400">
          {icon}
          <h2 className="text-sm font-semibold uppercase tracking-wider">{title}</h2>
          <div className="h-px bg-neutral-800 flex-1 ml-4" />
        </div>
      )}
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {devices.map((device) => (
          <DeviceRenderer 
            key={device.name} 
            name={device.name} 
            state={device.state}
            sendCommand={sendCommand}
            toggleDevice={toggleDevice}
            renameDevice={renameDevice}
          />
        ))}
      </div>
    </div>
  );
}