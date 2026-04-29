import { Power, ToggleRight, ToggleLeft } from 'lucide-react';
import type { DeviceState } from '../../hooks/useDevices';

interface Props {
  name: string;
  state: DeviceState;
  toggleDevice: (name: string, currentState?: string) => void;
}

export function BasicSwitchCard({ name, state, toggleDevice }: Props) {
  const isOn = state.state === 'ON';

  return (
    <div className={`p-5 rounded-2xl border transition-all duration-300 flex flex-col justify-between min-h-[140px] ${
      isOn ? 'bg-neutral-800/80 border-neutral-700 shadow-lg shadow-black/20' : 'bg-neutral-900/30 border-neutral-800/50'
    }`}>
      <div className="flex justify-between items-start mb-4">
        <div className={`p-2.5 rounded-full transition-colors ${isOn ? 'bg-green-500/10 text-green-400' : 'bg-neutral-800 text-neutral-500'}`}>
          {/* Using Toggle icon to represent a generic switch */}
          {isOn ? <ToggleRight size={22} strokeWidth={2.5} /> : <ToggleLeft size={22} strokeWidth={2.5} />}
        </div>
        <button 
          onClick={() => toggleDevice(name, state.state)}
          className={`p-2.5 rounded-full transition-all active:scale-95 ${isOn ? 'bg-neutral-700 hover:bg-neutral-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-400'}`}
        >
          <Power size={18} strokeWidth={2.5} />
        </button>
      </div>
      
      <div>
        <h3 className="font-medium text-lg tracking-tight truncate">{name}</h3>
        <p className="text-sm text-neutral-400 mt-1">
          {isOn ? 'On' : 'Offline / Off'}
        </p>
      </div>
    </div>
  );
}