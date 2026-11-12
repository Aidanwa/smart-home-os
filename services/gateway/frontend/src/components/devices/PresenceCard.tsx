import { Activity, PersonStanding } from 'lucide-react';
import type { DeviceState } from '../../hooks/useDevices';
import { formatTemperature } from '../../lib/deviceUtils';
import { BaseDeviceCard } from './BaseDeviceCard';

interface Props {
  name: string;
  state: DeviceState;
  sendCommand: (name: string, payload: Record<string, unknown>) => void;
  renameDevice: (oldName: string, newName: string) => void;
  deleteDevice: (name: string, label?: string) => void;
}

/** Presence (mmWave, e.g. Aqara FP300) and motion (PIR) sensors. `presence` is the sensor's own
 *  verdict, so it stays true while someone sits still; `occupancy` is a PIR's recent motion. */
export function PresenceCard({ name, state, sendCommand, renameDevice, deleteDevice }: Props) {
  const radar = state.presence !== undefined;
  const here = radar ? state.presence === true : state.occupancy === true;
  const temp = formatTemperature(state);

  const details: string[] = [];
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

const formatDelay = (s: number) => (s < 60 ? `${s} s` : s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`);

/** The drawer's settings. Each shows only once Z2M has read it from the sensor (it's in the state). */
function PresenceSettings({ name, state, sendCommand }: Pick<Props, 'name' | 'state' | 'sendCommand'>) {
  const set = (payload: Record<string, unknown>) => sendCommand(name, payload);
  const delay = typeof state.absence_delay_timer === 'number' ? state.absence_delay_timer : null;
  const delays = delay !== null && !DELAYS.includes(delay) ? [...DELAYS, delay].sort((a, b) => a - b) : DELAYS;
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
      <Row key="delay" label="Clear after" hint="How long the room must be empty before it reports Clear.">
        <select
          value={delay}
          onChange={e => set({ absence_delay_timer: Number(e.target.value) })}
          aria-label="Clear after"
          className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 min-h-9 text-sm text-neutral-200"
        >
          {delays.map(s => <option key={s} value={s}>{formatDelay(s)}</option>)}
        </select>
      </Row>
    ),
  ].filter(Boolean);
  if (!rows.length) return null;

  return (
    <div className="space-y-4">
      {rows}
      {state.battery !== undefined && (
        <p className="text-xs text-neutral-500">
          This sensor sleeps to save its battery, so a change can take a while to reach it.
          If one doesn’t stick, press the sensor’s button once and try again.
        </p>
      )}
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
