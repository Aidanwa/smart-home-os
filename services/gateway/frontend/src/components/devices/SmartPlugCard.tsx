import { Power, Zap, Activity } from 'lucide-react';
import type { DeviceState } from '../../hooks/useDevices';

export function SmartPlugCard({ name, state, toggleDevice }: any) {
  const isOn = state.state === 'ON';

  return (
    <div className={`p-5 rounded-2xl border transition-all duration-300 flex flex-col justify-between min-h-[160px] ${
      isOn ? 'bg-neutral-800/80 border-neutral-700 shadow-lg shadow-black/20' : 'bg-neutral-900/30 border-neutral-800/50'
    }`}>
      <div className="flex justify-between items-start mb-4">
        <div className={`p-2.5 rounded-full transition-colors ${isOn ? 'bg-blue-500/10 text-blue-400' : 'bg-neutral-800 text-neutral-500'}`}>
          <Zap size={22} strokeWidth={2.5} />
        </div>
        <button 
          onClick={() => toggleDevice(name, state.state)}
          className={`p-2.5 rounded-full transition-all active:scale-95 ${isOn ? 'bg-neutral-700 hover:bg-neutral-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-400'}`}
        >
          <Power size={18} strokeWidth={2.5} />
        </button>
      </div>
      
      <div>
        <h3 className="font-medium text-lg tracking-tight truncate mb-3">{name}</h3>
        
        {/* Telemetry Data */}
        <div className="flex items-center gap-3 text-xs">
          {state.power !== undefined && (
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md ${isOn && state.power > 0 ? 'bg-neutral-950/50 text-blue-300' : 'text-neutral-500'}`}>
              <Activity size={12} />
              <span className="font-medium">{state.power} W</span>
            </div>
          )}
          {state.energy !== undefined && (
            <div className="text-neutral-500 font-medium">
              {state.energy} kWh
            </div>
          )}
        </div>
      </div>
    </div>
  );
}