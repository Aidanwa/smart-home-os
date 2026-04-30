import { Thermometer } from 'lucide-react';
import { BaseDeviceCard } from './BaseDeviceCard';

export function EnvironmentSensorCard({ name, state, renameDevice, deleteDevice }: any) {
  // Handle temperature conversions safely
  const temperature = state.temperature_units === "fahrenheit" 
    ? Math.round((state.temperature * (9/5) + 32)) 
    : state.temperature;

  // Use humidity as the subtitle if available, otherwise just "Sensor"
  const hasHumidity = state.humidity !== undefined;
  const subtitle = hasHumidity ? `${state.humidity}% Humidity` : 'Temperature Sensor';

  return (
    <BaseDeviceCard
      name={name}
      state={state}
      icon={<Thermometer size={22} strokeWidth={2.5} />}
      iconColorClass="bg-orange-500/10 text-orange-400"
      subtitle={subtitle}
      renameDevice={renameDevice}
      deleteDevice={deleteDevice}
      // Note: No onToggle provided!
    >
      {/* Primary Data: Renders beautifully centered in the middle row */}
      {state.temperature !== undefined && (
        <div className="flex items-baseline gap-1 text-neutral-200">
          <span className="text-4xl font-light tracking-tight">{temperature}</span>
          <span className="text-sm font-medium text-neutral-500">
            °{state.temperature_units === 'fahrenheit' ? 'F' : 'C'}
          </span>
        </div>
      )}
    </BaseDeviceCard>
  );
}