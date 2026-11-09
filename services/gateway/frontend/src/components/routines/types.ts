import { miredDeltaToWarmth, miredRange, miredToWarmth, warmthDeltaToMired, warmthToMired } from '../../lib/colorTemp';
// Mirrors services/gateway/scheduler/schema.py. Keep the two in sync.

export type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export const DAYS: Day[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const WEEKDAYS: Day[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
export const WEEKEND: Day[] = ['sat', 'sun'];

export interface TimeTrigger {
  id: string;
  type: 'time';
  at: string;          // "HH:MM", home timezone
  days: Day[] | null;  // null = every day
}

export interface SunTrigger {
  id: string;
  type: 'sun';
  event: 'sunrise' | 'sunset';
  offset_min: number;  // negative = before
  days: Day[] | null;
}

export type Scalar = boolean | number | string;
export type TriggerOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'changes';
export type ConditionOp = Exclude<TriggerOp, 'changes'>;
export const NUMERIC_OPS: TriggerOp[] = ['gt', 'gte', 'lt', 'lte'];
export const EVENT_ATTRIBUTES = ['action'];  // remote buttons: every report counts

export interface DeviceTrigger {
  id: string;
  type: 'device';
  device: string;      // IEEE
  attribute: string;
  op: TriggerOp;
  value: Scalar | null;    // device-native units (°C for temperature)
  rearm: number | null;    // hysteresis margin, numeric ops only
  for_s: number | null;
  cooldown_s: number;
  fire_on_start: boolean;  // also fire if already true when saved / when the hub starts
}

export type Trigger = TimeTrigger | SunTrigger | DeviceTrigger;

export type LeafCondition =
  | { type: 'time_window'; after: string; before: string }
  | { type: 'days'; days: Day[] }
  | { type: 'device'; device: string; attribute: string; op: ConditionOp; value: Scalar }
  | { type: 'sun'; state: 'up' | 'down' };

/** The routine's list is AND; an 'any' group inside it is OR. */
export type Condition = LeafCondition | { type: 'any'; conditions: LeafCondition[] };

export type ConditionMode = 'all' | 'any';

/** The editor shows a flat list plus an All/Any toggle. 'Any' is stored as one 'any' group.
 *  Other shapes (e.g. written by the agent later) aren't editable here and are left untouched. */
export function splitConditions(cs: Condition[]): { mode: ConditionMode; leaves: LeafCondition[]; editable: boolean } {
  if (cs.length === 1 && cs[0].type === 'any') return { mode: 'any', leaves: cs[0].conditions, editable: true };
  if (cs.every(c => c.type !== 'any')) return { mode: 'all', leaves: cs as LeafCondition[], editable: true };
  return { mode: 'all', leaves: [], editable: false };
}

export function joinConditions(mode: ConditionMode, leaves: LeafCondition[]): Condition[] {
  return mode === 'any' && leaves.length ? [{ type: 'any', conditions: leaves }] : leaves;
}

/** What a device reports (from /api/routines/attributes): Z2M exposes metadata. */
export interface AttributeInfo {
  property: string;
  type: 'binary' | 'numeric' | 'enum' | 'text' | string;
  unit?: string;
  values?: string[];
  value_on?: Scalar;
  value_off?: Scalar;
  value_min?: number;
  value_max?: number;
}
export type AttributeMap = Record<string, { friendly_name: string; properties: AttributeInfo[]; current: Record<string, unknown> }>;

export interface SetPayload {
  state?: 'ON' | 'OFF' | 'TOGGLE' | null;
  brightness?: number | null;  // 0-254
  color_temp?: number | null;  // mireds 150-500
  transition?: number | null;  // seconds
}

export type Action =
  | { id: string; type: 'device'; device: string; set: SetPayload; stop_on_error: boolean }
  | { id: string; type: 'group'; group: number; set: SetPayload; stop_on_error: boolean }
  | { id: string; type: 'delay'; seconds: number; stop_on_error: boolean }
  | {
      id: string; type: 'fade'; device: string | null; group: number | null;
      to_brightness: number; from_brightness: number | null;      // 0-254; 0 = fade to off
      to_color_temp: number | null; from_color_temp: number | null;  // mireds
      duration_s: number; method: 'native' | 'stepped'; wait: boolean; stop_on_error: boolean;
    }
  | {
      id: string; type: 'spotify_play'; speaker: string; uri: string; title: string | null;
      volume: number | null; ramp_to: number | null; ramp_s: number | null; shuffle: boolean | null; stop_on_error: boolean;
    }
  | {
      id: string; type: 'spotify_ctrl'; cmd: 'pause' | 'resume' | 'next' | 'previous' | 'volume';
      speaker: string | null; volume: number | null; stop_on_error: boolean;
    }
  | { id: string; type: 'agent'; prompt: string; stop_on_error: boolean };

export const AGENT_RUNS_PER_HOUR = 2;  // mirrors scheduler/schema.py

export const ACTION_LABEL: Record<Action['type'], string> = {
  device: 'Device', group: 'Group', delay: 'Wait', fade: 'Fade', spotify_play: 'Play music', spotify_ctrl: 'Music control',
  agent: 'Ask the agent',
};


export interface MusicResult {
  kind: 'playlist' | 'album' | 'artist' | 'track';
  name: string;
  subtitle: string;
  uri: string;
}

export interface RoutineSpec {
  name: string;
  description: string | null;
  enabled: boolean;
  mode: 'single' | 'restart';
  grace_minutes: number;
  triggers: Trigger[];
  conditions: Condition[];
  actions: Action[];
}

export interface Routine extends RoutineSpec {
  id: string;
  owner_user_id: string;
  owner_username: string | null;
  last_run_at: string | null;
  last_run_status: RunStatus | null;
  next_fire_at: string | null;
  running: boolean;
  created_at: string;
  updated_at: string;
}

export type RunStatus =
  | 'running' | 'success' | 'partial' | 'failed' | 'skipped' | 'missed' | 'cancelled' | 'interrupted';

export interface RunStep {
  id: string;
  type: string;
  status: 'ok' | 'partial' | 'failed' | 'skipped' | 'cancelled' | 'running';
  started_at?: string;
  ms?: number;
  detail?: Record<string, unknown>;
  error?: string;
}

export interface RoutineRun {
  id: string;
  trigger_id: string | null;
  trigger_type: string;
  scheduled_for: string | null;
  started_at: string;
  finished_at: string | null;
  status: RunStatus;
  late_seconds: number | null;
  trigger_detail: Record<string, unknown>;
  steps: RunStep[];
  error: string | null;
}

export const STATUS_STYLE: Record<RunStatus, string> = {
  running: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  success: 'bg-green-500/10 text-green-400 border-green-500/30',
  partial: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  failed: 'bg-red-500/10 text-red-400 border-red-500/30',
  missed: 'bg-red-500/10 text-red-400 border-red-500/30',
  skipped: 'bg-neutral-800 text-neutral-400 border-neutral-700',
  cancelled: 'bg-neutral-800 text-neutral-400 border-neutral-700',
  interrupted: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
};

export function emptyRoutine(): RoutineSpec {
  return {
    name: '',
    description: null,
    enabled: true,
    mode: 'single',
    grace_minutes: 5,
    triggers: [{ id: 't1', type: 'time', at: '07:00', days: null }],
    conditions: [],
    actions: [],
  };
}

/** Next free short id like "a3" for a list of items. */
export function nextId(prefix: string, items: { id: string }[]): string {
  const used = items.map(i => parseInt(i.id.replace(/^\D+/, ''), 10)).filter(n => !isNaN(n));
  return `${prefix}${(used.length ? Math.max(...used) : 0) + 1}`;
}

const sameDays = (a: Day[], b: Day[]) => a.length === b.length && a.every(d => b.includes(d));

export function describeDays(days: Day[] | null): string {
  if (!days || days.length === 7) return 'Every day';
  if (sameDays(days, WEEKDAYS)) return 'Weekdays';
  if (sameDays(days, WEEKEND)) return 'Weekends';
  return days.map(d => d[0].toUpperCase() + d.slice(1)).join(', ');
}

// ---------------------------------------------------------------- display units
// Values are stored device-native and converted only for display:
// - Z2M always reports °C. With the °F preference, the editor shows/accepts °F and stores °C.
// - Colour temperature is mired, shown as warmth: % of that bulb's range (lib/colorTemp).

export type TempUnit = 'F' | 'C';
/** What the conversions need to know about a reading (its AttributeInfo). */
export type UnitInfo = Pick<AttributeInfo, 'unit' | 'value_min' | 'value_max'> | undefined;
const isCelsius = (info: UnitInfo) => info?.unit === '°C';
const isMired = (info: UnitInfo) => info?.unit === 'mired';
const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;

export const displayUnit = (info: UnitInfo, pref: TempUnit) =>
  isMired(info) ? '% warm' : isCelsius(info) && pref === 'F' ? '°F' : info?.unit ?? '';
export const toDisplay = (v: number, info: UnitInfo, pref: TempUnit) =>
  isMired(info) ? miredToWarmth(v, miredRange(info)) : isCelsius(info) && pref === 'F' ? round(v * 9 / 5 + 32, 1) : v;
export const fromDisplay = (v: number, info: UnitInfo, pref: TempUnit) =>
  isMired(info) ? warmthToMired(v, miredRange(info)) : isCelsius(info) && pref === 'F' ? round((v - 32) * 5 / 9, 2) : v;
// Margins are differences, so no 32° offset.
export const deltaToDisplay = (v: number, info: UnitInfo, pref: TempUnit) =>
  isMired(info) ? miredDeltaToWarmth(v, miredRange(info)) : isCelsius(info) && pref === 'F' ? round(v * 9 / 5, 1) : v;
export const deltaFromDisplay = (v: number, info: UnitInfo, pref: TempUnit) =>
  isMired(info) ? warmthDeltaToMired(v, miredRange(info)) : isCelsius(info) && pref === 'F' ? round(v * 5 / 9, 2) : v;

// ---------------------------------------------------------------- summaries

export const OP_TEXT: Record<TriggerOp, string> = {
  eq: 'is', ne: 'is not', gt: 'above', gte: 'at least', lt: 'below', lte: 'at most', changes: 'changes',
};

export interface DescribeCtx {
  attributes: AttributeMap;
  tempUnit: TempUnit;
}

export function formatValue(value: Scalar | null, info: UnitInfo, pref: TempUnit): string {
  if (value === null) return '';
  if (typeof value === 'number') {
    const u = displayUnit(info, pref);
    return `${toDisplay(value, info, pref)}${u ? (u.startsWith('%') ? u : ' ' + u) : ''}`;
  }
  return String(value);
}

function describeDeviceRef(device: string, attribute: string, op: TriggerOp, value: Scalar | null, ctx?: DescribeCtx) {
  const dev = ctx?.attributes[device];
  const name = dev?.friendly_name ?? device;
  const info = dev?.properties.find(p => p.property === attribute);
  if (EVENT_ATTRIBUTES.includes(attribute)) {
    return op === 'changes' ? `${name} button pressed` : `${name} ${String(value)}`;
  }
  return `${name} ${attribute} ${OP_TEXT[op]}${op === 'changes' ? '' : ' ' + formatValue(value, info, ctx?.tempUnit ?? 'F')}`;
}

export function describeTrigger(t: Trigger, ctx?: DescribeCtx): string {
  if (t.type === 'time') return `${describeDays(t.days)} ${t.at}`;
  if (t.type === 'sun') {
    const off = t.offset_min ? ` ${t.offset_min > 0 ? '+' : '−'}${Math.abs(t.offset_min)}m` : '';
    const days = t.days ? ` (${describeDays(t.days)})` : '';
    return `${t.event === 'sunrise' ? 'Sunrise' : 'Sunset'}${off}${days}`;
  }
  const held = t.for_s ? ` for ${t.for_s % 60 === 0 ? `${t.for_s / 60} min` : `${t.for_s}s`}` : '';
  return `When ${describeDeviceRef(t.device, t.attribute, t.op, t.value, ctx)}${held}`;
}

export function summarizeRoutine(r: RoutineSpec, ctx?: DescribeCtx): string {
  const when = r.triggers.length ? r.triggers.map(t => describeTrigger(t, ctx)).join(' · ') : 'Manual only';
  const { mode, leaves } = splitConditions(r.conditions);
  const n = leaves.length || r.conditions.length;
  const ifs = n ? ` · ${n} condition${n === 1 ? '' : 's'}${mode === 'any' && n > 1 ? ' (any)' : ''}` : '';
  return `${when}${ifs} · ${r.actions.length} action${r.actions.length === 1 ? '' : 's'}`;
}

export function formatInTz(iso: string | null, tz: string, withDate = true): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    weekday: withDate ? 'short' : undefined,
    month: withDate ? 'short' : undefined,
    day: withDate ? 'numeric' : undefined,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** FastAPI errors: a string, or a 422 list of {loc, msg}. */
export function formatApiError(body: unknown, fallback: string): string {
  const detail = (body as { detail?: unknown })?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e: { loc?: (string | number)[]; msg?: string }) => {
        const where = (e.loc ?? []).filter(p => p !== 'body').join(' › ');
        return where ? `${where}: ${e.msg}` : e.msg;
      })
      .join('\n');
  }
  return fallback;
}
