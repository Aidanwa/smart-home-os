import { Thermometer, BatteryFull, BatteryMedium, BatteryLow, Wifi } from 'lucide-react';

export function EnvironmentSensorCard({ name, state }: any) {
  // Determine battery icon based on level
  const BatteryIcon = state.battery > 70 ? BatteryFull : state.battery > 20 ? BatteryMedium : BatteryLow;
  const batteryColor = state.battery > 20 ? 'text-green-500' : 'text-red-500';
  const Temperature = state.temperature_units === "fahrenheit" ? Math.round((state.temperature * (9/5) + 32)) : state.temperature;;

  return (
    <div className="p-5 rounded-2xl border bg-neutral-900/40 border-neutral-800/50 flex flex-col justify-between min-h-[160px] hover:bg-neutral-800/40 transition-colors">
      <div className="flex justify-between items-start mb-4">
        <h3 className="font-medium text-lg tracking-tight truncate pr-4">{name}</h3>
        
        {/* Device Health Metrics */}
        <div className="flex flex-col gap-1.5 items-end">
          {state.battery !== undefined && (
             <div className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-neutral-400">
               <span className={batteryColor}>{state.battery}%</span>
               <BatteryIcon size={12} className={batteryColor} />
             </div>
          )}
          {state.linkquality !== undefined && (
             <div className="flex items-center gap-1 text-[10px] font-medium text-neutral-500">
               <span>{state.linkquality} LQI</span>
               <Wifi size={10} />
             </div>
          )}
        </div>
      </div>
      
      {/* Primary Telemetry */}
      <div className="flex flex-col gap-2 mt-auto">
        {state.temperature !== undefined && (
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-orange-500/10 text-orange-400">
              <Thermometer size={20} />
            </div>
            <div className="flex items-baseline gap-1 text-neutral-200">
              <span className="text-3xl font-light tracking-tight">{Temperature}</span>
              <span className="text-sm font-medium text-neutral-500">
                °{state.temperature_units === 'fahrenheit' ? 'F' : 'C'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}