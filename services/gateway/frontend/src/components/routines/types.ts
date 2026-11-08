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

export interface SetPayload {
  state?: 'ON' | 'OFF' | 'TOGGLE' | null;
  brightness?: number | null;  // 0-254
  color_temp?: number | null;  // mireds 150-500
  transition?: number | null;  // seconds
}

export type Action =
  | { id: string; type: 'device'; device: string; set: SetPayload; stop_on_error: boolean }
  | { id: string; type: 'group'; group: number; set: SetPayload; stop_on_error: boolean }
  | { id: string; type: 'delay'; seconds: number; stop_on_error: boolean };

export interface RoutineSpec {
  name: string;
  description: string | null;
  enabled: boolean;
  mode: 'single' | 'restart';
  grace_minutes: number;
  triggers: TimeTrigger[];
  conditions: unknown[];
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
  status: 'ok' | 'failed' | 'skipped' | 'cancelled';
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

export function summarizeRoutine(r: RoutineSpec): string {
  const when = r.triggers.length
    ? r.triggers.map(t => `${describeDays(t.days)} ${t.at}`).join(' · ')
    : 'Manual only';
  return `${when} · ${r.actions.length} action${r.actions.length === 1 ? '' : 's'}`;
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
