import { useEffect, useState } from 'react';
import type { GroupInfo } from '../../hooks/useGroups';
import { searchMusic, useSpotifyDevices } from '../../hooks/useRoutines';
import type { Action, MusicResult, SetPayload } from './types';
import { kelvinToMired, miredToKelvin } from './types';
import { NumberField } from './NumberField';
import { chip, input } from './styles';

export interface ActionFieldsProps {
  action: Action;
  onChange: (a: Action) => void;
  deviceOptions: { ieee: string; name: string; hasColorTemp: boolean; hasBrightness: boolean }[];
  groups: GroupInfo[];
}

export function ActionFields({ action, onChange, deviceOptions, groups }: ActionFieldsProps) {
  if (action.type === 'delay') return <DelayFields action={action} onChange={onChange} />;
  if (action.type === 'spotify_play') return <MusicFields action={action} onChange={onChange} />;
  if (action.type === 'spotify_ctrl') return <MusicCtrlFields action={action} onChange={onChange} />;
  if (action.type === 'fade') {
    const targets = [
      ...deviceOptions.filter(d => d.hasBrightness).map(d => ({ value: `d:${d.ieee}`, label: d.name })),
      ...groups.map(g => ({ value: `g:${g.id}`, label: `${g.friendly_name} (group)` })),
    ];
    return <FadeFields action={action} onChange={onChange} targets={targets} />;
  }

  const selectedDevice = action.type === 'device' ? deviceOptions.find(d => d.ieee === action.device) : undefined;
  const showColorTemp = action.type === 'group' || !!selectedDevice?.hasColorTemp;

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
      <PayloadFields value={action.set} showColorTemp={showColorTemp} onChange={set => onChange({ ...action, set })} />
      <label className="flex items-center gap-2 text-xs text-neutral-500">
        <input type="checkbox" checked={action.stop_on_error} onChange={e => onChange({ ...action, stop_on_error: e.target.checked })} />
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

function PayloadFields({ value, onChange, showColorTemp }: { value: SetPayload; onChange: (v: SetPayload) => void; showColorTemp: boolean }) {
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
        <OptionalNumber label="Colour temperature (mired, 150 cool – 500 warm)" value={value.color_temp ?? null} min={150} max={500} defaultValue={370}
          onChange={v => set('color_temp', v)} />
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
      <label className="flex items-center gap-2 text-xs text-neutral-400 flex-1">
        <input type="checkbox" checked={value != null} onChange={e => onChange(e.target.checked ? defaultValue : null)} />
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
export interface FadeTargetOption { value: string; label: string }  // "d:<ieee>" or "g:<id>"

export function FadeFields({ action, onChange, targets }: { action: FadeAction; onChange: (a: Action) => void; targets: FadeTargetOption[] }) {
  const current = action.device !== null ? `d:${action.device}` : `g:${action.group}`;
  const pct = (b: number) => Math.round((b / 254) * 100);
  const toBright = (p: number) => Math.round((p / 100) * 254);
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

      <label className="flex items-center gap-2 text-xs text-neutral-400">
        <input type="checkbox" checked={action.to_color_temp !== null}
          onChange={e => onChange({ ...action, to_color_temp: e.target.checked ? kelvinToMired(4000) : null, from_color_temp: e.target.checked ? action.from_color_temp : null })} />
        Also fade the white tone
      </label>
      {action.to_color_temp !== null && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-neutral-400 mb-1">From (K, optional)</label>
            <NumberField integer min={2000} max={6500} className={input}
              value={action.from_color_temp !== null ? miredToKelvin(action.from_color_temp) : null}
              onChange={k => onChange({ ...action, from_color_temp: kelvinToMired(k) })} />
          </div>
          <div>
            <label className="block text-xs text-neutral-400 mb-1">To (K)</label>
            <NumberField integer min={2000} max={6500} className={input} value={miredToKelvin(action.to_color_temp)}
              onChange={k => onChange({ ...action, to_color_temp: kelvinToMired(k) })} />
          </div>
          <p className="col-span-2 text-xs text-neutral-600">2200 K is candle-warm, 2700 K warm white, 4000 K neutral, 6500 K daylight.</p>
        </div>
      )}

      <select className={input} value={action.method} onChange={e => onChange({ ...action, method: e.target.value as FadeAction['method'] })}>
        <option value="native">Smooth: the bulb does the fade (recommended)</option>
        <option value="stepped">Stepped: small steps; stops if someone changes the light</option>
      </select>
      <label className="flex items-center gap-2 text-xs text-neutral-400">
        <input type="checkbox" checked={action.wait} onChange={e => onChange({ ...action, wait: e.target.checked })} />
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
        <button type="button" className="text-xs text-blue-400 shrink-0" onClick={() => setPicking(true)}>Change</button>
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
              <button type="button" className="w-full text-left px-3 py-2 hover:bg-neutral-800/60"
                onClick={() => { onChange({ ...action, uri: r.uri, title: r.name }); setPicking(false); setQuery(''); }}>
                <p className="text-sm text-neutral-200 truncate">{r.name}</p>
                <p className="text-xs text-neutral-500 truncate">{r.subtitle}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
      {action.uri && <button type="button" className="text-xs text-neutral-500" onClick={() => setPicking(false)}>Keep {action.title ?? 'current choice'}</button>}
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
      <label className="flex items-center gap-2 text-xs text-neutral-400">
        <input type="checkbox" checked={ramping} onChange={e => onChange(e.target.checked
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
