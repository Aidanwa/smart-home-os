import { useEffect, useState } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { DeviceState } from '../../hooks/useDevices';
import { request } from '../../lib/api';
import { NumberField } from '../routines/NumberField';

/** One entry of GET /api/devices/{id}/settings (gateway core/device_settings.py, from Z2M's exposes). */
interface SettingItem {
  property: string;
  type: 'binary' | 'enum' | 'numeric' | 'text' | string;
  kind: 'setting' | 'detail';
  label?: string;
  description?: string;
  unit?: string;
  values?: string[];
  value_on?: unknown;
  value_off?: unknown;
  value_min?: number;
  value_max?: number;
  value_step?: number;
  access?: number;  // Z2M bits: 1 in the state, 2 settable, 4 readable on demand
  value?: unknown;
}

interface SettingsResponse {
  battery_powered: boolean;
  settings: SettingItem[];
  details: SettingItem[];
}

const humanize = (s: string) => {
  const t = s.replace(/_/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

// The app shows °F everywhere (CLAUDE.md "Units"). A °C setting is either a temperature or a
// difference (a reporting threshold, a calibration offset), which converts without the +32.
const isDelta = (p: string) => /threshold|calibration|offset|hysteresis|delta/.test(p);
const toShown = (item: SettingItem, v: number) =>
  item.unit === '°C' ? Math.round((isDelta(item.property) ? v * 1.8 : v * 1.8 + 32) * 10) / 10 : v;
const fromShown = (item: SettingItem, v: number) =>
  item.unit === '°C' ? Math.round((isDelta(item.property) ? v / 1.8 : (v - 32) / 1.8) * 100) / 100 : v;
const shownUnit = (item: SettingItem) =>
  item.unit === '°C' ? '°F' : item.unit === 'sec' ? 's' : item.unit;

function shownValue(item: SettingItem, v: unknown): string {
  if (v === undefined || v === null || v === '') return 'Unknown';
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  if (typeof v === 'number') return `${toShown(item, v)}${shownUnit(item) ? ` ${shownUnit(item)}` : ''}`;
  return typeof v === 'string' ? humanize(v) : JSON.stringify(v);
}

const inputClass = 'bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-1.5 text-sm text-neutral-100 focus:outline-none focus:border-blue-500';

function SettingControl({ item, value, busy, save }: {
  item: SettingItem; value: unknown; busy: boolean; save: (v: unknown) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const [text, setText] = useState<string | null>(null);
  const label = item.label || humanize(item.property);

  if (item.type === 'binary') {
    const on = item.value_on ?? true;
    const off = item.value_off ?? false;
    return (
      <input type="checkbox" aria-label={label} disabled={busy} className="size-5 shrink-0 accent-blue-500"
        checked={value === on} onChange={e => save(e.target.checked ? on : off)} />
    );
  }
  if (item.type === 'enum') {
    const known = typeof value === 'string' && item.values?.includes(value);
    return (
      <select aria-label={label} disabled={busy} className={`${inputClass} w-full`}
        value={known ? String(value) : ''} onChange={e => save(e.target.value)}>
        {!known && <option value="" disabled>Unknown</option>}
        {item.values?.map(v => <option key={v} value={v}>{humanize(v)}</option>)}
      </select>
    );
  }
  if (item.type === 'numeric') {
    const current = typeof value === 'number' ? toShown(item, value) : null;
    const lo = item.value_min !== undefined ? toShown(item, item.value_min) : undefined;
    const hi = item.value_max !== undefined ? toShown(item, item.value_max) : undefined;
    const commit = () => {
      if (draft !== null && draft !== current) save(fromShown(item, draft));
      setDraft(null);
    };
    return (
      // NumberField reports each valid keystroke; the setting is sent once, when you leave the box.
      <span className="flex items-center gap-1.5 shrink-0"
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLElement).blur(); }}>
        <NumberField value={draft ?? current} onChange={setDraft} min={lo} max={hi}
          integer={item.value_step === undefined || Number.isInteger(item.value_step)}
          allowNegative={(lo ?? 0) < 0} ariaLabel={label}
          className={`${inputClass} w-20 text-right tabular-nums ${busy ? 'opacity-60' : ''}`} />
        {shownUnit(item) && <span className="text-xs text-neutral-500">{shownUnit(item)}</span>}
      </span>
    );
  }
  if (item.type === 'text') {
    const current = typeof value === 'string' ? value : '';
    const commit = () => {
      if (text !== null && text !== current) save(text);
      setText(null);
    };
    return (
      <input aria-label={label} disabled={busy} className={`${inputClass} w-full`} value={text ?? current}
        onChange={e => setText(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLElement).blur(); }} />
    );
  }
  return <span className="text-sm text-neutral-400">{shownValue(item, value)}</span>;
}

/**
 * The drawer's collapsible "All settings": every setting the device exposes (Z2M), plus a
 * collapsible "Details" list of its read-only values. `handled` names the settings the card's
 * own controls already show; they're left out here while the device reports a value for them
 * (until then the card hides its control, so this is the only place to set it).
 */
export function AllSettings({ deviceId, name, state, isOpen, handled = [] }: {
  deviceId: string;
  name: string;
  state: DeviceState;
  isOpen: boolean;
  handled?: string[];
}) {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const url = `/api/devices/${encodeURIComponent(deviceId)}/settings`;

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch(url)
      .then(res => (res.ok ? res.json() : null))
      .then((d: SettingsResponse | null) => { if (!cancelled) setData(d); })
      .catch(err => console.error(err));
    return () => { cancelled = true; };
  }, [isOpen, url]);

  if (!data || (data.settings.length === 0 && data.details.length === 0)) return null;

  // Live updates arrive in `state`; the fetched value covers fields the initial device list drops.
  const valueOf = (i: SettingItem) => (state[i.property] !== undefined ? state[i.property] : i.value);
  const settings = data.settings.filter(i => !(handled.includes(i.property) && state[i.property] !== undefined));
  const unknownReadable = [...settings, ...data.details]
    .filter(i => (i.access ?? 0) & 4 && (valueOf(i) === undefined || valueOf(i) === null))
    .map(i => i.property);

  const save = async (item: SettingItem, value: unknown) => {
    setBusy(item.property);
    const label = item.label || humanize(item.property);
    const ok = await request(`change ${label} on ${name}`, () =>
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property: item.property, value }) }));
    setBusy(null);
    if (ok) setData(d => d && {
      ...d, settings: d.settings.map(s => (s.property === item.property ? { ...s, value } : s)),
    });
  };

  const readUnknown = async () => {
    const ok = await request(`ask ${name} for its settings`, () =>
      fetch(`${url}/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: unknownReadable }) }));
    if (ok) toast.success('Asked the device', { description: 'Values appear here as it answers.' });
  };

  return (
    <div className="space-y-3">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full flex items-center justify-between text-sm font-medium text-neutral-400 hover:text-neutral-200">
        <span>All settings <span className="text-neutral-600">({settings.length})</span></span>
        <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-3">
          {data.battery_powered && (
            <p className="text-xs text-neutral-500 bg-neutral-900/50 border border-neutral-800/50 rounded-xl p-3">
              This device runs on battery and sleeps most of the time. Press its button to wake it just before changing a setting.
            </p>
          )}
          {settings.length > 0 && (
            <div className="bg-neutral-900/50 rounded-xl border border-neutral-800/50 divide-y divide-neutral-800/50">
              {settings.map(item => (
                // Lists and text get their own line under the label: long option names otherwise
                // squeeze the label into a one-word column on a phone.
                <div key={item.property} className={`flex gap-3 px-3 py-2.5 ${item.type === 'enum' || item.type === 'text'
                  ? 'flex-col' : 'items-center justify-between'}`}>
                  <div className="min-w-0">
                    <div className="text-sm text-neutral-200 [overflow-wrap:anywhere]">{item.label || humanize(item.property)}</div>
                    {item.description && <div className="text-xs text-neutral-500 mt-0.5">{item.description}</div>}
                  </div>
                  <SettingControl item={item} value={valueOf(item)} busy={busy === item.property}
                    save={v => save(item, v)} />
                </div>
              ))}
            </div>
          )}
          {unknownReadable.length > 0 && (
            <button onClick={readUnknown}
              className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300">
              <RefreshCw size={12} /> Read unknown values from the device
            </button>
          )}
          {data.details.length > 0 && (
            <div className="space-y-2">
              <button onClick={() => setDetailsOpen(o => !o)} aria-expanded={detailsOpen}
                className="w-full flex items-center justify-between text-xs font-medium text-neutral-500 hover:text-neutral-300">
                <span>Details <span className="text-neutral-600">({data.details.length})</span></span>
                <ChevronDown size={14} className={`transition-transform ${detailsOpen ? 'rotate-180' : ''}`} />
              </button>
              {detailsOpen && (
                <div className="bg-neutral-900/50 rounded-xl border border-neutral-800/50 divide-y divide-neutral-800/50">
                  {data.details.map(item => (
                    <div key={item.property} className="flex items-start justify-between gap-3 px-3 py-2">
                      <span className="text-xs text-neutral-500 min-w-0 [overflow-wrap:anywhere]">{item.label || humanize(item.property)}</span>
                      <span className="text-sm text-neutral-300 text-right shrink-0">{shownValue(item, valueOf(item))}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
