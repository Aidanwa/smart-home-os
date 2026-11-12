import { useEffect, useState } from 'react';

/** The current time, refreshed every `everyMs` (default 30 s), for "for 25 min" style labels. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

/** How long since an ISO time: "just now", "25 min", "3 h 10 min", "2 days". Null if unknown. */
export function sinceText(iso: string | undefined | null, now: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const m = Math.max(0, Math.floor((now - t) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
  return `${Math.floor(m / 1440)} days`;
}
