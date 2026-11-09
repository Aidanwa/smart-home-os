import { useEffect, useState } from 'react';

/**
 * Colour temperature, platform-wide: stored and sent in mired (what Zigbee2MQTT speaks), shown
 * to people as "warmth": a percentage of that bulb's own range, 0% = its coolest white and
 * 100% = its warmest. Warmth rises with mired, so "above/below" comparisons keep their meaning.
 */
export interface MiredRange { min: number; max: number }

/** For devices/groups whose range we don't know: the routine schema's limits. */
export const FALLBACK_MIRED: MiredRange = { min: 150, max: 500 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function miredRange(info?: { value_min?: number; value_max?: number } | null): MiredRange {
  const min = info?.value_min, max = info?.value_max;
  return typeof min === 'number' && typeof max === 'number' && max > min ? { min, max } : FALLBACK_MIRED;
}

/** Widest range across several devices (a group). */
export function unionRange(ranges: MiredRange[]): MiredRange {
  if (!ranges.length) return FALLBACK_MIRED;
  return { min: Math.min(...ranges.map(r => r.min)), max: Math.max(...ranges.map(r => r.max)) };
}

export const miredToWarmth = (m: number, r: MiredRange) =>
  clamp(Math.round(((m - r.min) / (r.max - r.min)) * 100), 0, 100);
export const warmthToMired = (pct: number, r: MiredRange) =>
  Math.round(r.min + (clamp(pct, 0, 100) / 100) * (r.max - r.min));

/** A difference in mired as a difference in warmth points (for re-arm margins). */
export const miredDeltaToWarmth = (d: number, r: MiredRange) => Math.round((d / (r.max - r.min)) * 1000) / 10;
export const warmthDeltaToMired = (d: number, r: MiredRange) => Math.max(1, Math.round((d / 100) * (r.max - r.min)));

// Each device's range, keyed by IEEE address, from Z2M's exposes (via the gateway). Fetched once
// per page load and shared by every card.
let cache: Promise<Record<string, MiredRange>> | null = null;

function loadRanges(): Promise<Record<string, MiredRange>> {
  cache ??= fetch('/api/routines/attributes')
    .then(res => (res.ok ? res.json() : {}))
    .then((data: Record<string, { properties?: { property: string; value_min?: number; value_max?: number }[] }>) => {
      const out: Record<string, MiredRange> = {};
      for (const [ieee, d] of Object.entries(data ?? {})) {
        const ct = d.properties?.find(p => p.property === 'color_temp');
        if (ct) out[ieee] = miredRange(ct);
      }
      return out;
    })
    .catch(() => { cache = null; return {}; });
  return cache;
}

export function useMiredRange(ieee: string | undefined): MiredRange {
  const [ranges, setRanges] = useState<Record<string, MiredRange> | null>(null);
  useEffect(() => { let live = true; loadRanges().then(r => live && setRanges(r)); return () => { live = false; }; }, []);
  return (ieee && ranges?.[ieee]) || FALLBACK_MIRED;
}
