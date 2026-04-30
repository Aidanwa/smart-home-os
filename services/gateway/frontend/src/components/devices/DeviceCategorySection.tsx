import { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { DeviceRenderer } from './DeviceRenderer';
import type { DeviceState } from '../../hooks/useDevices';

export interface DeviceSection {
  id: string;
  title: string | null;
  icon?: React.ReactNode;
  devices: Array<{ name: string; state: DeviceState }>;
}

interface Props extends DeviceSection {
  sendCommand: (name: string, payload: any) => void;
  toggleDevice: (name: string, currentState?: string) => void;
  renameDevice: (oldName: string, newName: string) => void;
}

export function DeviceCategorySection({ id, title, icon, devices, sendCommand, toggleDevice, renameDevice }: Props) {
  // 1. Create a unique storage key for this specific category (e.g., "section-expanded-lights")
  const storageKey = `section-expanded-${id}`;

  // 2. Initialize state lazily from localStorage. Defaults to true if no saved preference exists.
  const [isExpanded, setIsExpanded] = useState(() => {
    const savedState = localStorage.getItem(storageKey);
    return savedState !== null ? savedState === 'true' : true;
  });

  // 3. Sync the state back to localStorage whenever the user toggles it
  useEffect(() => {
    localStorage.setItem(storageKey, isExpanded.toString());
  }, [isExpanded, storageKey]);

  if (devices.length === 0) return null;

  return (
    <div className="mb-8">
      {title && (
        <div 
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 mb-4 text-neutral-400 cursor-pointer hover:text-neutral-200 transition-colors group select-none"
        >
          {icon}
          <h2 className="text-sm font-semibold uppercase tracking-wider">{title}</h2>
          <div className="h-px bg-neutral-800 flex-1 ml-4 transition-colors group-hover:bg-neutral-700" />
          <ChevronDown 
            size={18} 
            className={`transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'}`} 
          />
        </div>
      )}
      
      {(!title || isExpanded) && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {devices.map((device) => (
            <DeviceRenderer 
              key={device.name} 
              name={device.state.friendly_name}
              state={device.state}
              sendCommand={sendCommand}
              toggleDevice={toggleDevice}
              renameDevice={renameDevice}
            />
          ))}
        </div>
      )}
    </div>
  );
}