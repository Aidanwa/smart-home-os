import { useEffect, useState } from 'react';
import { Lightbulb, Sun, Thermometer } from 'lucide-react';
import { Slider as SliderPrimitive } from 'radix-ui';
import type { DeviceState } from '../../hooks/useDevices';
import { miredToWarmth, useMiredRange, warmthToMired } from '../../lib/colorTemp';
import { BaseDeviceCard } from './BaseDeviceCard';

interface Props {
  name: string;
  state: DeviceState;
  sendCommand: (name: string, payload: Record<string, unknown>) => void;
  toggleDevice: (name: string, currentState?: string) => void;
  renameDevice: (oldName: string, newName: string) => void;
  deleteDevice: (name: string, label?: string) => void;
}

/** A slider with a big touch target that sends only when you let go (or on each key press). */
export function LightSlider({ label, icon, value, min, max, step, track, onChange, onCommit, valueText, shown }: {
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
  /** What the label beside the slider shows; defaults to valueText. */
  shown?: string;
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
      <span className="text-xs tabular-nums text-neutral-400 w-10 text-right shrink-0">{shown ?? valueText}</span>
    </div>
  );
}

export function ColorLightCard({ name, state, sendCommand, toggleDevice, renameDevice, deleteDevice }: Props) {
  const isOn = state.state === 'ON';

  const serverBrightness = state.brightness ? Math.max(1, Math.round((state.brightness / 254) * 100)) : 0;
  // Colour temperature as warmth, a percentage of this bulb's own range (lib/colorTemp).
  const range = useMiredRange(state.ieee_address);
  const serverWarmth = typeof state.color_temp === 'number' ? miredToWarmth(state.color_temp, range) : 50;
  const [brightness, setBrightness] = useState(serverBrightness);
  const [warmth, setWarmth] = useState(serverWarmth);

  // Follow the bulb when it changes elsewhere (other device, routine, wall switch).
  useEffect(() => setBrightness(serverBrightness), [serverBrightness]);
  useEffect(() => setWarmth(serverWarmth), [serverWarmth]);

  const subtitle = isOn ? `On • ${brightness}%` : 'Off';

  return (
    <BaseDeviceCard
      name={name}
      state={state}
      icon={<Lightbulb size={22} strokeWidth={2.5} />}
      iconColorClass={isOn ? 'bg-yellow-500/10 text-yellow-500' : 'bg-neutral-800 text-neutral-500'}
      subtitle={subtitle}
      onToggle={() => toggleDevice(name, state.state)}
      advancedConfig={state.color_temp !== undefined ? (
        // Zigbee "execute if off": the bulb stores warmth changes sent while it's off (a sunset
        // routine) and comes on with them. Z2M keeps the setting in the state as color_options.
        <label className="flex items-start justify-between gap-3 p-3 rounded-xl border border-neutral-800/50 bg-neutral-900/50 cursor-pointer">
          <span className="min-w-0">
            <span className="block text-sm text-neutral-200">Remember warmth while off</span>
            <span className="block text-xs text-neutral-500 mt-0.5">
              Warmth changes made while the light is off, like a sunset routine’s, are used when it next turns on.
              Brightness can’t be stored this way: setting it turns the light on.
            </span>
          </span>
          <input type="checkbox" className="size-5 shrink-0 mt-0.5 accent-blue-500"
            checked={state.color_options?.execute_if_off === true}
            onChange={e => sendCommand(name, { color_options: { execute_if_off: e.target.checked } })} />
        </label>
      ) : undefined}
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
              label={`${name} warmth`}
              icon={<Thermometer size={14} />}
              value={warmth}
              min={0}
              max={100}
              step={1}
              track="bg-gradient-to-r from-[#8cb8ff] via-white to-[#ffb347]"
              onChange={setWarmth}
              onCommit={(v) => sendCommand(name, { color_temp: warmthToMired(v, range) })}
              valueText={`${warmth}% warm`}
              shown={`${warmth}%`}
            />
          )}
        </div>
      )}
    </BaseDeviceCard>
  );
}
