import { Zap, Activity } from 'lucide-react';
import { BaseDeviceCard } from './BaseDeviceCard';

export function SmartPlugCard({ name, state, toggleDevice, renameDevice, deleteDevice }: any) {
  const isOn = state.state === 'ON';

  // Build the sleek subtitle with the icon
  const subtitle = (
    <span className="flex items-center gap-1">
      {isOn ? 'On' : 'Off'}
      {isOn && state.power !== undefined && (
        <>
          <span className="text-neutral-600 mx-0.5">•</span>
          <Activity size={12} className="text-blue-400" />
          <span>{state.power} W</span>
        </>
      )}
    </span>
  );

  return (
    <BaseDeviceCard
      name={name}
      state={state}
      icon={<Zap size={22} strokeWidth={2.5} />}
      iconColorClass={isOn ? 'bg-blue-500/10 text-blue-400' : 'bg-neutral-800 text-neutral-500'}
      subtitle={subtitle}
      onToggle={() => toggleDevice(name, state.state)}
      deleteDevice={deleteDevice}
      // Send the Total Energy metric to the Side Drawer
      advancedConfig={
        state.energy !== undefined ? (
          <div className="p-4 bg-neutral-900/50 border border-neutral-800/50 rounded-xl flex justify-between items-center text-sm mt-2">
            <span className="text-neutral-400">Total Energy Usage</span>
            <span className="font-medium text-neutral-200">{state.energy} kWh</span>
          </div>
        ) : null
      }
      renameDevice={renameDevice}
    />
  );
}