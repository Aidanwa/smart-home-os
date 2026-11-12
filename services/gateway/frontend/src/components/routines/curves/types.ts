// Mirrors services/gateway/curves/schema.py. Keep both in sync.

export type CurveWhen =
  | { type: 'time'; at: string }  // "HH:MM"
  | { type: 'sun'; event: 'sunrise' | 'noon' | 'sunset'; offset_min: number };

export interface CurvePoint {
  id: string;
  when: CurveWhen;
  warmth: number | null;      // % of each bulb's own range, 0 coolest – 100 warmest
  brightness: number | null;  // %, 1–100
}

export interface Curve {
  id: string;
  name: string;
  enabled: boolean;
  points: CurvePoint[];
  members: string[];  // IEEE addresses
}

export type CurveSpec = Omit<Curve, 'id'>;

export interface CurvePreview {
  timezone: string;
  samples: { minute: number; warmth: number | null; brightness: number | null }[];
  sun: Partial<Record<'sunrise' | 'noon' | 'sunset', string>>;
  now: { warmth: number | null; brightness: number | null };
  next: Partial<Record<'warmth' | 'brightness', { at: string; value: number }>>;
  warnings: string[];
}

/** GET /api/curves/status: one entry per light that follows a curve. */
export interface LightCurveStatus {
  curve_id: string;
  curve_name: string;
  enabled: boolean;
  paused: { since: string; reason: 'set' | 'external' } | null;
  target: { warmth: number | null; brightness: number | null };
  next: CurvePreview['next'];
}

const SUN_LABEL = { sunrise: 'Sunrise', noon: 'Midday', sunset: 'Sunset' } as const;

export function whenLabel(w: CurveWhen): string {
  if (w.type === 'time') return w.at;
  if (!w.offset_min) return SUN_LABEL[w.event];
  const m = Math.abs(w.offset_min);
  const amount = m % 60 === 0 ? `${m / 60} h` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  return `${amount} ${w.offset_min < 0 ? 'before' : 'after'} ${SUN_LABEL[w.event].toLowerCase()}`;
}

export const newPointId = () => `p${Math.random().toString(36).slice(2, 8)}`;

/** The starting curve: cool by midday, warm from sunset, dim late; held warm and dim overnight. */
export function defaultCurve(): CurveSpec {
  return {
    name: 'Day curve',
    enabled: true,
    members: [],
    points: [
      { id: 'p1', when: { type: 'time', at: '05:30' }, warmth: 100, brightness: 40 },
      { id: 'p2', when: { type: 'sun', event: 'sunrise', offset_min: 0 }, warmth: 30, brightness: 100 },
      { id: 'p3', when: { type: 'sun', event: 'noon', offset_min: 0 }, warmth: 0, brightness: null },
      { id: 'p4', when: { type: 'sun', event: 'sunset', offset_min: 0 }, warmth: 70, brightness: 100 },
      { id: 'p5', when: { type: 'time', at: '21:30' }, warmth: 100, brightness: null },
      { id: 'p6', when: { type: 'time', at: '23:00' }, warmth: null, brightness: 40 },
    ],
  };
}

/** "21:30" in the home's timezone, from an ISO time. */
export function homeTime(iso: string, timezone: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: timezone });
  } catch {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}
