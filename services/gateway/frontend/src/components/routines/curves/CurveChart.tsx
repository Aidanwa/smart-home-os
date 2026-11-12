import { useMemo, useRef, useState } from 'react';
import type { CurvePreview } from './types';

// Two series on one 0–100 % axis. Colours: the dataviz palette's dark-mode categorical slots
// (orange, blue), validated against the app's near-black surface (CVD ΔE 26.8, contrast ≥ 3:1).
const WARMTH = '#d95926';
const BRIGHTNESS = '#3987e5';
const W = 340, H = 150, L = 30, R = 8, T = 8, B = 22;
const x = (minute: number) => L + (minute / 1440) * (W - L - R);
const y = (pct: number) => T + (1 - pct / 100) * (H - T - B);

/** Minutes after local midnight of an ISO time, in the home timezone. */
function localMinute(iso: string, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: timezone })
    .formatToParts(new Date(iso));
  const part = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  return part('hour') * 60 + part('minute');
}

function clock(minute: number): string {
  const h = Math.floor(minute / 60) % 24, m = minute % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** One path per run of non-null values (a channel no point sets draws nothing). */
function path(samples: CurvePreview['samples'], key: 'warmth' | 'brightness'): string {
  let d = '', pen = false;
  for (const s of samples) {
    const v = s[key];
    if (v === null) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${x(s.minute).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** Today's warmth and brightness across the day, with sun times and now. Drag or hover to read. */
export function CurveChart({ preview }: { preview: CurvePreview }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);  // index into samples
  const tz = preview.timezone;
  const nowMinute = useMemo(() => localMinute(new Date().toISOString(), tz), [tz]);
  const hasWarmth = preview.samples.some(s => s.warmth !== null);
  const hasBrightness = preview.samples.some(s => s.brightness !== null);

  const pick = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const minute = ((clientX - box.left) / box.width * W - L) / (W - L - R) * 1440;
    const i = Math.round(Math.min(1440, Math.max(0, minute)) / 15);
    setHover(Math.min(preview.samples.length - 1, Math.max(0, i)));
  };
  const h = hover !== null ? preview.samples[hover] : null;

  return (
    <figure className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-400" aria-hidden>
        {hasWarmth && <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: WARMTH }} />Warmth</span>}
        {hasBrightness && <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: BRIGHTNESS }} />Brightness</span>}
        <span className="ml-auto tabular-nums text-neutral-300 min-h-4">
          {h ? `${clock(h.minute)}: ${[h.warmth !== null && `${Math.round(h.warmth)}% warm`, h.brightness !== null && `${Math.round(h.brightness)}% bright`].filter(Boolean).join(', ')}` : ''}
        </span>
      </div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto touch-none select-none"
        role="img" aria-label="Warmth and brightness through today"
        onPointerMove={e => pick(e.clientX)} onPointerDown={e => pick(e.clientX)} onPointerLeave={() => setHover(null)}>
        {[0, 50, 100].map(p => (
          <g key={p}>
            <line x1={L} x2={W - R} y1={y(p)} y2={y(p)} stroke="#262626" strokeWidth={1} />
            <text x={L - 4} y={y(p) + 3} textAnchor="end" fontSize={9} fill="#737373">{p}%</text>
          </g>
        ))}
        {[0, 360, 720, 1080, 1440].map(m => (
          <text key={m} x={x(m)} y={H - 6} textAnchor={m === 0 ? 'start' : m === 1440 ? 'end' : 'middle'} fontSize={9} fill="#737373">
            {m === 720 ? 'noon' : m === 1440 || m === 0 ? '12 AM' : m === 360 ? '6 AM' : '6 PM'}
          </text>
        ))}
        {(['sunrise', 'sunset'] as const).map(ev => preview.sun[ev] && (
          <g key={ev}>
            <line x1={x(localMinute(preview.sun[ev]!, tz))} x2={x(localMinute(preview.sun[ev]!, tz))} y1={T} y2={H - B}
              stroke="#525252" strokeWidth={1} strokeDasharray="2 3" />
            <text x={x(localMinute(preview.sun[ev]!, tz))} y={T + 8} textAnchor="middle" fontSize={8} fill="#a3a3a3"
              paintOrder="stroke" stroke="#0a0a0a" strokeWidth={3}>{ev}</text>
          </g>
        ))}
        <line x1={x(nowMinute)} x2={x(nowMinute)} y1={T} y2={H - B} stroke="#a3a3a3" strokeWidth={1} />
        {hasWarmth && <path d={path(preview.samples, 'warmth')} fill="none" stroke={WARMTH} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {hasBrightness && <path d={path(preview.samples, 'brightness')} fill="none" stroke={BRIGHTNESS} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {h && (
          <g>
            <line x1={x(h.minute)} x2={x(h.minute)} y1={T} y2={H - B} stroke="#e5e5e5" strokeWidth={1} />
            {h.warmth !== null && <circle cx={x(h.minute)} cy={y(h.warmth)} r={4} fill={WARMTH} stroke="#0a0a0a" strokeWidth={2} />}
            {h.brightness !== null && <circle cx={x(h.minute)} cy={y(h.brightness)} r={4} fill={BRIGHTNESS} stroke="#0a0a0a" strokeWidth={2} />}
          </g>
        )}
      </svg>
      <figcaption className="sr-only">
        Now {Math.round(preview.now.warmth ?? 0)}% warm and {Math.round(preview.now.brightness ?? 0)}% bright. The points below list every value.
      </figcaption>
    </figure>
  );
}
