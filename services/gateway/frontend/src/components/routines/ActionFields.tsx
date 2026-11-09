import { useEffect, useState } from 'react';
import type { GroupInfo } from '../../hooks/useGroups';
import { searchMusic, useSpotifyDevices } from '../../hooks/useRoutines';
import type { Action, MusicResult, SetPayload } from './types';
import { AGENT_RUNS_PER_HOUR } from './types';
import { type MiredRange, miredToWarmth, unionRange, warmthToMired } from '../../lib/colorTemp';
import { NumberField } from './NumberField';
import { chip, input } from './styles';

export interface ActionFieldsProps {
  action: Action;
  onChange: (a: Action) => void;
  deviceOptions: { ieee: string; name: string; hasColorTemp: boolean; hasBrightness: boolean; range: MiredRange }[];
  groups: GroupInfo[];
}

/** A group's warmth scale spans all its members' ranges. */
function groupRange(group: GroupInfo | undefined, deviceOptions: ActionFieldsProps['deviceOptions']): MiredRange {
  const members = new Set(group?.members.map(m => m.ieee_address));
  return unionRange(deviceOptions.filter(d => d.hasColorTemp && members.has(d.ieee)).map(d => d.range));
}

export function ActionFields({ action, onChange, deviceOptions, groups }: ActionFieldsProps) {
  if (action.type === 'delay') return <DelayFields action={action} onChange={onChange} />;
  if (action.type === 'spotify_play') return <MusicFields action={action} onChange={onChange} />;
  if (action.type === 'spotify_ctrl') return <MusicCtrlFields action={action} onChange={onChange} />;
  if (action.type === 'agent') return <AgentFields action={action} onChange={onChange} />;
  if (action.type === 'notify') return <NotifyFields action={action} onChange={onChange} />;
  if (action.type === 'fade') {
    const targets = [
      ...deviceOptions.filter(d => d.hasBrightness).map(d => ({ value: `d:${d.ieee}`, label: d.name, range: d.range })),
      ...groups.map(g => ({ value: `g:${g.id}`, label: `${g.friendly_name} (group)`, range: groupRange(g, deviceOptions) })),
    ];
    return <FadeFields action={action} onChange={onChange} targets={targets} />;
  }

  const selectedDevice = action.type === 'device' ? deviceOptions.find(d => d.ieee === action.device) : undefined;
  const showColorTemp = action.type === 'group' || !!selectedDevice?.hasColorTemp;
  const range = action.type === 'device'
    ? selectedDevice?.range
    : groupRange(groups.find(g => g.id === action.group), deviceOptions);

  return (
    <>
      {action.type === 'device' ? (
        <select className={input} value={action.device} onChange={e => onChange({ ...action, device: e.target.value })}>
          {!selectedDevice && <option value={action.device}>{action.device ? `Missing device (${action.device})` : 'Pick a device'}</option>}
          {deviceOptions.map(d => <option key={d.ieee} value={d.ieee}>{d.name}</option>)}
        </select>
      ) : (
        <select className={input} value={action.group} onChange={e => onChange({ ...action, group: parseInt(e.target.value) })}>
          {!groups.some(g => g.id === action.group) && <option value={action.group}>{groups.length ? `Missing group (${action.group})` : 'No groups exist'}</option>}
          {groups.map(g => <option key={g.id} value={g.id}>{g.friendly_name}</option>)}
        </select>
      )}
      <PayloadFields value={action.set} showColorTemp={showColorTemp} range={range} onChange={set => onChange({ ...action, set })} />
      <label className="flex items-center gap-2 min-h-10 text-xs text-neutral-500">
        <input type="checkbox" className="size-5 shrink-0 accent-blue-500" checked={action.stop_on_error} onChange={e => onChange({ ...action, stop_on_error: e.target.checked })} />
        Stop the routine if this fails
      </label>
    </>
  );
}

type DelayAction = Extract<Action, { type: 'delay' }>;

/** The unit is the user's choice, kept locally: deriving it from the value made "120 seconds"
 *  flip to "2 minutes" mid-typing. It starts as the largest unit that divides the value. */
function DelayFields({ action, onChange }: { action: DelayAction; onChange: (a: Action) => void }) {
  const [unit, setUnit] = useState(() => (action.seconds % 3600 === 0 ? 3600 : action.seconds % 60 === 0 ? 60 : 1));
  const maxInUnit = 43200 / unit;
  return (
    <div className="flex gap-2">
      <NumberField min={1 / unit} max={maxInUnit} className={input} value={Math.round((action.seconds / unit) * 100) / 100}
        onChange={n => onChange({ ...action, seconds: Math.max(1, Math.min(43200, Math.round(n * unit))) })} />
      <select className={`${input} w-32`} value={unit} onChange={e => {
        const next = parseInt(e.target.value);
        setUnit(next);
        // keep the number, change what it means: "5 minutes" -> "5 hours"
        onChange({ ...action, seconds: Math.max(1, Math.min(43200, Math.round((action.seconds / unit) * next))) });
      }}>
        <option value={1}>seconds</option>
        <option value={60}>minutes</option>
        <option value={3600}>hours</option>
      </select>
    </div>
  );
}

function PayloadFields({ value, onChange, showColorTemp, range }: { value: SetPayload; onChange: (v: SetPayload) => void; showColorTemp: boolean; range?: MiredRange }) {
  const set = (k: keyof SetPayload, v: SetPayload[keyof SetPayload]) => {
    const next = { ...value, [k]: v };
    if (v === null || v === undefined) delete next[k];
    onChange(next);
  };
  const pct = value.brightness != null ? Math.round((value.brightness / 254) * 100) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {([['ON', 'On'], ['OFF', 'Off'], ['TOGGLE', 'Toggle'], [null, 'Leave as is']] as const).map(([v, text]) => (
          <button key={text} type="button" className={chip((value.state ?? null) === v)} onClick={() => set('state', v)}>{text}</button>
        ))}
      </div>
      <OptionalNumber label="Brightness (%)" value={pct} min={1} max={100} defaultValue={100}
        onChange={v => set('brightness', v == null ? null : Math.round((v / 100) * 254))} />
      {showColorTemp && (
        <OptionalNumber label="Warmth (%, 0 coolest – 100 warmest)" min={0} max={100} defaultValue={75}
          value={value.color_temp != null && range ? miredToWarmth(value.color_temp, range) : null}
          onChange={v => set('color_temp', v == null || !range ? null : warmthToMired(v, range))} />
      )}
      <OptionalNumber label="Transition (seconds)" value={value.transition ?? null} min={0} max={3600} defaultValue={2}
        onChange={v => set('transition', v)} />
    </div>
  );
}

function OptionalNumber({ label: text, value, min, max, defaultValue, onChange }: {
  label: string; value: number | null; min: number; max: number; defaultValue: number; onChange: (v: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-2 min-h-10 text-xs text-neutral-400 flex-1">
        <input type="checkbox" className="size-5 shrink-0 accent-blue-500" checked={value != null} onChange={e => onChange(e.target.checked ? defaultValue : null)} />
        {text}
      </label>
      {value != null && (
        <NumberField min={min} max={max} className={`${input} w-24`} value={value} onChange={onChange} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ fade

type FadeAction = Extract<Action, { type: 'fade' }>;
export interface FadeTargetOption { value: string; label: string; range: MiredRange }  // "d:<ieee>" or "g:<id>"

export function FadeFields({ action, onChange, targets }: { action: FadeAction; onChange: (a: Action) => void; targets: FadeTargetOption[] }) {
  const current = action.device !== null ? `d:${action.device}` : `g:${action.group}`;
  const pct = (b: number) => Math.round((b / 254) * 100);
  const toBright = (p: number) => Math.round((p / 100) * 254);
  const range = targets.find(t => t.value === current)?.range ?? unionRange([]);
  const warm = (m: number) => miredToWarmth(m, range);
  const toMired = (p: number) => warmthToMired(p, range);
  const [unit, setUnit] = useState(() => (action.duration_s % 60 === 0 ? 60 : 1));

  return (
    <div className="space-y-3">
      <select className={input} value={current} onChange={e => {
        const kind = e.target.value.slice(0, 1);
        const id = e.target.value.slice(2);
        onChange({ ...action, device: kind === 'd' ? id : null, group: kind === 'g' ? parseInt(id) : null });
      }}>
        {!targets.some(t => t.value === current) && <option value={current}>Missing light ({current.slice(2)})</option>}
        {targets.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-neutral-400 mb-1">To brightness (%)</label>
          <NumberField integer min={0} max={100} className={input} value={pct(action.to_brightness)}
            onChange={p => onChange({ ...action, to_brightness: toBright(p) })} />
          {action.to_brightness === 0 && <p className="text-xs text-neutral-500 mt-1">0 fades to off.</p>}
        </div>
        <div>
          <label className="block text-xs text-neutral-400 mb-1">Over</label>
          <div className="flex gap-2">
            <NumberField min={1 / unit} max={6000 / unit} className={input} value={Math.round((action.duration_s / unit) * 100) / 100}
              onChange={n => onChange({ ...action, duration_s: Math.max(1, Math.min(6000, Math.round(n * unit))) })} />
            <select className={`${input} w-24`} value={unit} onChange={e => {
              const next = parseInt(e.target.value);
              setUnit(next);
              onChange({ ...action, duration_s: Math.max(1, Math.min(6000, Math.round((action.duration_s / unit) * next))) });
            }}>
              <option value={1}>sec</option>
              <option value={60}>min</option>
            </select>
          </div>
        </div>
      </div>

      <OptionalNumber label="Start from brightness (%)" value={action.from_brightness !== null ? pct(action.from_brightness) : null}
        min={1} max={100} defaultValue={1}
        onChange={v => onChange({ ...action, from_brightness: v === null ? null : Math.max(1, toBright(v)) })} />
      <p className="text-xs text-neutral-600 -mt-2">Otherwise it starts where the light is now (or at 1% if it is off).</p>

      <label className="flex items-center gap-2 min-h-10 text-xs text-neutral-400">
        <input type="checkbox" className="size-5 shrink-0 accent-blue-500" checked={action.to_color_temp !== null}
          onChange={e => onChange({ ...action, to_color_temp: e.target.checked ? toMired(25) : null, from_color_temp: e.target.checked ? action.from_color_temp : null })} />
        Also fade the white tone
      </label>
      {action.to_color_temp !== null && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-neutral-400 mb-1">From warmth (%, optional)</label>
            <NumberField integer min={0} max={100} className={input}
              value={action.from_color_temp !== null ? warm(action.from_color_temp) : null}
              onChange={p => onChange({ ...action, from_color_temp: toMired(p) })} />
          </div>
          <div>
            <label className="block text-xs text-neutral-400 mb-1">To warmth (%)</label>
            <NumberField integer min={0} max={100} className={input} value={warm(action.to_color_temp)}
              onChange={p => onChange({ ...action, to_color_temp: toMired(p) })} />
          </div>
          <p className="col-span-2 text-xs text-neutral-600">0% is the light's coolest white, 100% its warmest (candle-like).</p>
        </div>
      )}

      <select className={input} value={action.method} onChange={e => onChange({ ...action, method: e.target.value as FadeAction['method'] })}>
        <option value="native">Smooth: the bulb does the fade (recommended)</option>
        <option value="stepped">Stepped: small steps; stops if someone changes the light</option>
      </select>
      <label className="flex items-center gap-2 min-h-10 text-xs text-neutral-400">
        <input type="checkbox" className="size-5 shrink-0 accent-blue-500" checked={action.wait} onChange={e => onChange({ ...action, wait: e.target.checked })} />
        Wait for the fade to finish before the next action
      </label>
    </div>
  );
}

// ------------------------------------------------------------------ Spotify

type PlayAction = Extract<Action, { type: 'spotify_play' }>;
type CtrlAction = Extract<Action, { type: 'spotify_ctrl' }>;

function SpeakerSelect({ value, onChange, allowAny }: { value: string | null; onChange: (v: string | null) => void; allowAny?: boolean }) {
  const { names, error, loading } = useSpotifyDevices();
  if (error && !names.length) {
    return (
      <div className="space-y-1">
        <input className={input} value={value ?? ''} placeholder="Speaker name" onChange={e => onChange(e.target.value || (allowAny ? null : ''))} />
        <p className="text-xs text-amber-400">Couldn't list speakers: {error}</p>
      </div>
    );
  }
  return (
    <select className={input} value={value ?? ''} onChange={e => onChange(e.target.value || null)}>
      {allowAny && <option value="">Whatever is playing</option>}
      {value && !names.includes(value) && <option value={value}>{loading ? value : `${value} (not available now)`}</option>}
      {names.map(n => <option key={n} value={n}>{n}</option>)}
    </select>
  );
}

function MusicPicker({ action, onChange }: { action: PlayAction; onChange: (a: Action) => void }) {
  const [picking, setPicking] = useState(!action.uri);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ q: string; results: MusicResult[]; error: string | null } | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const handle = setTimeout(() => searchMusic(q).then(r => setFound({ q, ...r })), 400);
    return () => clearTimeout(handle);
  }, [query]);

  if (!picking && action.uri) {
    return (
      <div className="flex items-center justify-between gap-2 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm text-neutral-200 truncate">{action.title ?? action.uri}</p>
          <p className="text-xs text-neutral-500 truncate">{action.uri.split(':')[1]}</p>
        </div>
        <button type="button" className="text-xs text-blue-400 shrink-0 min-h-10 px-2 -mr-2" onClick={() => setPicking(true)}>Change</button>
      </div>
    );
  }
  const shown = found && found.q === query.trim() ? found : null;
  return (
    <div className="space-y-2">
      <input className={input} value={query} placeholder="Search your playlists, albums, artists, songs" onChange={e => setQuery(e.target.value)} />
      {shown?.error && <p className="text-xs text-red-400">{shown.error}</p>}
      {shown && !shown.error && shown.results.length === 0 && <p className="text-xs text-neutral-500">Nothing found.</p>}
      {shown && shown.results.length > 0 && (
        <ul className="max-h-64 overflow-y-auto rounded-lg border border-neutral-800 divide-y divide-neutral-800">
          {shown.results.map(r => (
            <li key={r.uri}>
              <button type="button" className="w-full text-left px-3 py-3 hover:bg-neutral-800/60"
                onClick={() => { onChange({ ...action, uri: r.uri, title: r.name }); setPicking(false); setQuery(''); }}>
                <p className="text-sm text-neutral-200 truncate">{r.name}</p>
                <p className="text-xs text-neutral-500 truncate">{r.subtitle}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
      {action.uri && <button type="button" className="text-xs text-neutral-500 min-h-10" onClick={() => setPicking(false)}>Keep {action.title ?? 'current choice'}</button>}
    </div>
  );
}

export function MusicFields({ action, onChange }: { action: PlayAction; onChange: (a: Action) => void }) {
  const ramping = action.ramp_to !== null;
  return (
    <div className="space-y-3">
      <MusicPicker action={action} onChange={onChange} />
      <div>
        <label className="block text-xs text-neutral-400 mb-1">On speaker</label>
        <SpeakerSelect value={action.speaker} onChange={v => onChange({ ...action, speaker: v ?? '' })} />
      </div>
      <OptionalNumber label="Volume (%)" value={action.volume} min={0} max={100} defaultValue={30}
        onChange={volume => onChange({ ...action, volume, ...(volume === null ? { ramp_to: null, ramp_s: null } : {}) })} />
      <label className="flex items-center gap-2 min-h-10 text-xs text-neutral-400">
        <input type="checkbox" className="size-5 shrink-0 accent-blue-500" checked={ramping} onChange={e => onChange(e.target.checked
          ? { ...action, volume: action.volume ?? 10, ramp_to: 40, ramp_s: 600 }
          : { ...action, ramp_to: null, ramp_s: null })} />
        Then gradually change the volume
      </label>
      {ramping && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
          to
          <NumberField integer min={0} max={100} className={`${input} w-20`} value={action.ramp_to}
            onChange={ramp_to => onChange({ ...action, ramp_to })} />
          % over
          <NumberField min={0.5} max={120} className={`${input} w-20`} value={action.ramp_s !== null ? Math.round((action.ramp_s / 60) * 10) / 10 : null}
            onChange={m => onChange({ ...action, ramp_s: Math.max(30, Math.min(7200, Math.round(m * 60))) })} />
          minutes
          <p className="w-full text-neutral-600">Stops early if you change the volume yourself or playback stops.</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-neutral-400 mr-1">Shuffle</span>
        {([[null, 'Leave as is'], [true, 'On'], [false, 'Off']] as const).map(([v, text]) => (
          <button key={text} type="button" className={chip(action.shuffle === v)} onClick={() => onChange({ ...action, shuffle: v })}>{text}</button>
        ))}
      </div>
    </div>
  );
}

export function MusicCtrlFields({ action, onChange }: { action: CtrlAction; onChange: (a: Action) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select className={input} value={action.cmd} onChange={e => {
          const cmd = e.target.value as CtrlAction['cmd'];
          onChange({ ...action, cmd, volume: cmd === 'volume' ? action.volume ?? 30 : null });
        }}>
          <option value="pause">Pause</option>
          <option value="resume">Resume</option>
          <option value="next">Next track</option>
          <option value="previous">Previous track</option>
          <option value="volume">Set volume</option>
        </select>
        <SpeakerSelect value={action.speaker} allowAny onChange={speaker => onChange({ ...action, speaker })} />
      </div>
      {action.cmd === 'volume' && (
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <NumberField integer min={0} max={100} className={`${input} w-20`} value={action.volume} onChange={volume => onChange({ ...action, volume })} />
          %
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ ask the agent

type AgentAction = Extract<Action, { type: 'agent' }>;

export function AgentFields({ action, onChange }: { action: AgentAction; onChange: (a: Action) => void }) {
  return (
    <div className="space-y-2">
      <textarea className={`${input} min-h-24`} maxLength={1000} value={action.prompt}
        placeholder="e.g. Pick calm music that suits today's weather and play it on Bedroom Speakers."
        onChange={e => onChange({ ...action, prompt: e.target.value })} />
      <div>
        <p className="text-xs text-neutral-400 mb-1.5">Send its reply as a notification</p>
        <div className="flex flex-wrap gap-2">
          {([[null, 'No'], ['owner', 'To the owner'], ['everyone', 'To everyone']] as const).map(([to, text]) => (
            <button key={text} type="button" className={chip((action.notify ?? null) === to)} onClick={() => onChange({ ...action, notify: to })}>
              {text}
            </button>
          ))}
        </div>
        {action.notify && (
          <p className="text-xs text-neutral-500 mt-1.5">The agent is told its reply goes to a phone, so it keeps it short. Tapping the notification opens this routine’s history.</p>
        )}
      </div>
      <p className="text-xs text-amber-400/90">
        Uses the AI: costs tokens and can do things a little differently each time. Runs at most {AGENT_RUNS_PER_HOUR}× per hour for this routine;
        extra triggers skip this step. Its reply and everything it did show in History.
      </p>
      <label className="flex items-center gap-2 min-h-10 text-xs text-neutral-500">
        <input type="checkbox" className="size-5 shrink-0 accent-blue-500" checked={action.stop_on_error} onChange={e => onChange({ ...action, stop_on_error: e.target.checked })} />
        Stop the routine if this fails
      </label>
    </div>
  );
}

// ------------------------------------------------------------------ notify

type NotifyAction = Extract<Action, { type: 'notify' }>;

export function NotifyFields({ action, onChange }: { action: NotifyAction; onChange: (a: Action) => void }) {
  return (
    <div className="space-y-2">
      <input className={input} maxLength={100} value={action.title ?? ''} placeholder="Title (blank = the routine's name)"
        onChange={e => onChange({ ...action, title: e.target.value || null })} />
      <textarea className={`${input} min-h-20`} maxLength={300} value={action.message}
        placeholder="e.g. The front door has been open for 10 minutes."
        onChange={e => onChange({ ...action, message: e.target.value })} />
      <div className="flex gap-2">
        {(['owner', 'everyone'] as const).map(to => (
          <button key={to} type="button" className={chip(action.to === to)} onClick={() => onChange({ ...action, to })}>
            {to === 'owner' ? 'Just the owner' : 'Everyone'}
          </button>
        ))}
      </div>
      <p className="text-xs text-neutral-500">
        Sent to the phones that turned notifications on in Settings → Notifications.
        {action.to === 'owner' ? ' The owner is whoever created the routine.' : ''}
      </p>
      <label className="flex items-center gap-2 min-h-10 text-xs text-neutral-500">
        <input type="checkbox" className="size-5 shrink-0 accent-blue-500" checked={action.stop_on_error} onChange={e => onChange({ ...action, stop_on_error: e.target.checked })} />
        Stop the routine if this fails
      </label>
    </div>
  );
}
