import { useEffect, useState } from 'react';
import { Lightbulb, Sun, Thermometer } from 'lucide-react';
import { Slider as SliderPrimitive } from 'radix-ui';
import type { DeviceState } from '../../hooks/useDevices';
import { kelvinToMired, miredToKelvin } from '../../lib/deviceUtils';
import { BaseDeviceCard } from './BaseDeviceCard';

// Colour temperature range most bulbs accept (≈455–154 mired).
const K_MIN = 2200;
const K_MAX = 6500;

interface Props {
  name: string;
  state: DeviceState;
  sendCommand: (name: string, payload: Record<string, unknown>) => void;
  toggleDevice: (name: string, currentState?: string) => void;
  renameDevice: (oldName: string, newName: string) => void;
  deleteDevice: (name: string, label?: string) => void;
}

/** A slider with a big touch target that sends only when you let go (or on each key press). */
function LightSlider({ label, icon, value, min, max, step, track, onChange, onCommit, valueText }: {
  label: string;
  icon: React.ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  track: string;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
  valueText: string;
}) {
  return (
    <div data-control className="flex items-center gap-3 w-full">
      <span className="text-neutral-500 shrink-0" aria-hidden>{icon}</span>
      <SliderPrimitive.Root
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
        onValueCommit={([v]) => onCommit(v)}
        className="relative flex flex-1 h-8 items-center touch-none select-none cursor-pointer"
      >
        <SliderPrimitive.Track className={`relative h-2 grow rounded-full border border-neutral-700/50 ${track}`} />
        <SliderPrimitive.Thumb
          aria-label={label}
          aria-valuetext={valueText}
          className="block size-5 rounded-full bg-white border-2 border-neutral-800 shadow-md outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        />
      </SliderPrimitive.Root>
      <span className="text-xs tabular-nums text-neutral-400 w-12 text-right shrink-0">{valueText}</span>
    </div>
  );
}

export function ColorLightCard({ name, state, sendCommand, toggleDevice, renameDevice, deleteDevice }: Props) {
  const isOn = state.state === 'ON';

  const serverBrightness = state.brightness ? Math.max(1, Math.round((state.brightness / 254) * 100)) : 0;
  const serverKelvin = state.color_temp ? Math.min(K_MAX, Math.max(K_MIN, miredToKelvin(state.color_temp))) : 2700;
  const [brightness, setBrightness] = useState(serverBrightness);
  const [kelvin, setKelvin] = useState(serverKelvin);

  // Follow the bulb when it changes elsewhere (other device, routine, wall switch).
  useEffect(() => setBrightness(serverBrightness), [serverBrightness]);
  useEffect(() => setKelvin(serverKelvin), [serverKelvin]);

  const subtitle = isOn ? `On • ${brightness}%` : 'Off';

  return (
    <BaseDeviceCard
      name={name}
      state={state}
      icon={<Lightbulb size={22} strokeWidth={2.5} />}
      iconColorClass={isOn ? 'bg-yellow-500/10 text-yellow-500' : 'bg-neutral-800 text-neutral-500'}
      subtitle={subtitle}
      onToggle={() => toggleDevice(name, state.state)}
      renameDevice={renameDevice}
      deleteDevice={deleteDevice}
    >
      {isOn && (
        <div className="w-full flex flex-col gap-1">
          {state.brightness !== undefined && (
            <LightSlider
              label={`${name} brightness`}
              icon={<Sun size={14} />}
              value={brightness}
              min={1}
              max={100}
              step={1}
              track="bg-gradient-to-r from-neutral-800 to-white"
              onChange={setBrightness}
              onCommit={(v) => sendCommand(name, { brightness: Math.round((v / 100) * 254) })}
              valueText={`${brightness}%`}
            />
          )}
          {state.color_temp !== undefined && (
            <LightSlider
              label={`${name} colour temperature`}
              icon={<Thermometer size={14} />}
              value={kelvin}
              min={K_MIN}
              max={K_MAX}
              step={100}
              track="bg-gradient-to-r from-[#ffb347] via-white to-[#8cb8ff]"
              onChange={setKelvin}
              onCommit={(v) => sendCommand(name, { color_temp: kelvinToMired(v) })}
              valueText={`${kelvin} K`}
            />
          )}
        </div>
      )}
    </BaseDeviceCard>
  );
}
