import { useState } from 'react';
import { Activity, Lightbulb, PersonStanding, ScanSearch } from 'lucide-react';
import { toast } from 'sonner';
import type { DeviceState } from '../../hooks/useDevices';
import { formatTemperature } from '../../lib/deviceUtils';
import { sinceText, useNow } from '../../hooks/useNow';
import { BaseDeviceCard } from './BaseDeviceCard';
import { PresenceLightsDialog } from './PresenceLightsDialog';
import { ConfirmDialog } from '../ui/dialog';

type Send = (name: string, payload: Record<string, unknown>) => unknown;

interface Props {
  name: string;
  state: DeviceState;
  sendCommand: Send;
  renameDevice: (oldName: string, newName: string) => void;
  deleteDevice: (name: string, label?: string) => void;
}

/** Presence (mmWave, e.g. Aqara FP300) and motion (PIR) sensors. `presence` is the sensor's own
 *  verdict, so it stays true while someone sits still; `occupancy` is a PIR's recent motion.
 *  `presence_changed_at` is added by the gateway when the reading flips. */
export function PresenceCard({ name, state, sendCommand, renameDevice, deleteDevice }: Props) {
  const now = useNow();
  const radar = state.presence !== undefined;
  const here = radar ? state.presence === true : state.occupancy === true;
  const temp = formatTemperature(state);
  const since = sinceText(state.presence_changed_at, now);

  const details: string[] = [];
  if (since) details.push(since === 'just now' ? 'just now' : `for ${since}`);
  if (radar && here && typeof state.target_distance === 'number' && state.target_distance > 0) {
    details.push(`${Math.max(1, Math.round(state.target_distance * 3.281))} ft away`);
  }
  if (typeof state.illuminance === 'number') details.push(`${Math.round(state.illuminance)} lx`);
  if (temp) details.push(`${Math.round(temp.value)}°${temp.unit}`);
  if (typeof state.humidity === 'number') details.push(`${Math.round(state.humidity)}%`);

  return (
    <BaseDeviceCard
      name={name}
      state={state}
      active={here}
      icon={radar ? <PersonStanding size={22} strokeWidth={2.5} /> : <Activity size={22} strokeWidth={2.5} />}
      iconColorClass={here ? 'bg-emerald-500/15 text-emerald-400' : 'bg-neutral-800 text-neutral-500'}
      subtitle={details.length ? details.join(' • ') : undefined}
      advancedConfig={<PresenceSettings name={name} state={state} sendCommand={sendCommand} />}
      renameDevice={renameDevice}
      deleteDevice={deleteDevice}
    >
      <span className={`text-3xl font-light tracking-tight ${here ? 'text-emerald-300' : 'text-neutral-400'}`}>
        {radar ? (here ? 'Occupied' : 'Clear') : (here ? 'Motion' : 'No motion')}
      </span>
    </BaseDeviceCard>
  );
}

const DETECTION = [['both', 'Radar + motion'], ['mmwave', 'Radar'], ['pir', 'Motion']] as const;
const SENSITIVITY = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] as const;
const DELAYS = [10, 30, 60, 120, 300];
// Detection distance: the FP300 splits 0–6 m into 24 slices of 0.25 m (a bitmask, nearest first).
const SLICE_M = 0.25;
const SLICES = 24;
const DISTANCES_M = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6];

const formatDelay = (s: number) => (s < 60 ? `${s} s` : s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`);
const feet = (m: number) => `${Math.round(m * 3.281)} ft`;
/** Metres covered when the mask is "everything up to N slices"; null for any other (custom) pattern. */
function rangeMetres(mask: number): number | null {
  for (let n = 1; n <= SLICES; n++) if (mask === 2 ** n - 1) return n * SLICE_M;
  return null;
}

/** The drawer's settings. Each shows only once Z2M has read it from the sensor (it's in the state). */
function PresenceSettings({ name, state, sendCommand }: Pick<Props, 'name' | 'state' | 'sendCommand'>) {
  const [lightsOpen, setLightsOpen] = useState(false);
  const [confirmLearn, setConfirmLearn] = useState(false);
  const set = (payload: Record<string, unknown>) => Promise.resolve(sendCommand(name, payload));
  const delay = typeof state.absence_delay_timer === 'number' ? state.absence_delay_timer : null;
  const delays = delay !== null && !DELAYS.includes(delay) ? [...DELAYS, delay].sort((a, b) => a - b) : DELAYS;
  const range = typeof state.detection_range === 'number' ? state.detection_range : null;
  const rangeM = range === null ? null : rangeMetres(range);
  const motionOnly = state.presence_detection_options === 'pir';
  // Spatial learning exists on Aqara's radar sensors; detection_range marks the FP300 family.
  const canLearn = state.presence !== undefined && range !== null;

  const rows = [
    state.presence_detection_options !== undefined && (
      <Row key="detect" label="Detect with" hint="Radar notices people sitting still; motion only notices movement.">
        <Choice options={DETECTION} value={state.presence_detection_options} onPick={v => set({ presence_detection_options: v })} />
      </Row>
    ),
    state.motion_sensitivity !== undefined && (
      <Row key="sens" label="Sensitivity">
        <Choice options={SENSITIVITY} value={state.motion_sensitivity} onPick={v => set({ motion_sensitivity: v })} />
      </Row>
    ),
    delay !== null && (
      <Row key="delay" label="Clear after" hint="How long the room must be empty before the sensor reports Clear.">
        <Select label="Clear after" value={delay} onChange={v => set({ absence_delay_timer: v })}
          options={delays.map(s => [s, formatDelay(s)])} />
      </Row>
    ),
    range !== null && (
      <Row key="range" label="Detect up to"
        hint={motionOnly ? 'Applies to the radar, which is off in Motion mode.' : 'Ignore people further away than this, e.g. walking past in the hallway.'}>
        <Select label="Detect up to" value={rangeM ?? -1}
          onChange={m => set({ detection_range: 2 ** Math.round(m / SLICE_M) - 1 })}
          options={[
            ...(rangeM === null ? [[-1, 'Custom (set elsewhere)'] as [number, string]] : []),
            ...DISTANCES_M.map(m => [m, m === 6 ? `${feet(m)} (full range)` : feet(m)] as [number, string]),
          ]} />
      </Row>
    ),
    state.led_disabled_night !== undefined && (
      <label key="led" className="flex items-center justify-between gap-3 min-h-11 cursor-pointer">
        <span className="text-sm text-neutral-300">Turn off the LED at night</span>
        <input type="checkbox" className="size-5 shrink-0 accent-blue-500" checked={!!state.led_disabled_night}
          onChange={e => set({ led_disabled_night: e.target.checked })} />
      </label>
    ),
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <button type="button" onClick={() => setLightsOpen(true)}
        className="w-full flex items-center gap-3 p-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-left hover:bg-emerald-500/15 transition-colors">
        <Lightbulb size={18} className="text-emerald-400 shrink-0" />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-emerald-200">Lights follow presence</span>
          <span className="block text-xs text-emerald-200/60">On when someone comes in, off once it’s empty</span>
        </span>
      </button>

      {rows}

      {canLearn && (
        <Row label="Learn the empty room" hint="Teaches the radar what the room looks like empty (fans, curtains), so it stops seeing ghosts.">
          <button type="button" onClick={() => setConfirmLearn(true)}
            className="flex items-center gap-2 px-3 min-h-10 rounded-lg text-sm bg-neutral-900 border border-neutral-800 text-neutral-300 hover:border-neutral-600">
            <ScanSearch size={16} /> Start learning
          </button>
        </Row>
      )}

      {state.battery !== undefined && rows.length > 0 && (
        <p className="text-xs text-neutral-500">
          This sensor sleeps to save its battery, so a change can take a while to reach it.
          If one doesn’t stick, press the sensor’s button once and try again.
        </p>
      )}

      <PresenceLightsDialog open={lightsOpen} onOpenChange={setLightsOpen} sensorName={name} state={state} />
      <ConfirmDialog
        open={confirmLearn}
        onOpenChange={setConfirmLearn}
        title="Learn the empty room?"
        description="Leave the room empty and still for about a minute after you start. Anyone moving in it while it learns will confuse it."
        confirmLabel="Start"
        onConfirm={async () => {
          if (await set({ spatial_learning: 'Start Learning' })) {
            toast.success(`${name} is learning the room`, { description: 'Keep the room empty for about a minute.' });
          }
        }}
      />
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm text-neutral-300">{label}</div>
      {children}
      {hint && <p className="text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: number; onChange: (v: number) => void; options: Array<[number, string]>;
}) {
  return (
    <select value={value} onChange={e => onChange(Number(e.target.value))} aria-label={label}
      className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 min-h-10 text-sm text-neutral-200">
      {options.map(([v, text]) => <option key={v} value={v} disabled={v === -1}>{text}</option>)}
    </select>
  );
}

function Choice({ options, value, onPick }: {
  options: ReadonlyArray<readonly [string, string]>; value: unknown; onPick: (v: string) => void;
}) {
  return (
    <div className="flex bg-neutral-900/50 p-1 rounded-xl border border-neutral-800" role="group">
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => { if (value !== v) onPick(v); }}
          className={`flex-1 px-2 min-h-9 rounded-lg text-sm font-medium ${value === v ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:text-neutral-200'}`}>
          {text}
        </button>
      ))}
    </div>
  );
}
