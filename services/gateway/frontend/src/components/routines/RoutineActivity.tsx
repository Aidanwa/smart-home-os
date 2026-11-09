import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Clock, History, Loader2, Sunrise, Sunset } from 'lucide-react';
import type { RoutineRun, Trigger } from './types';
import { formatInTz } from './types';
import { RunItem } from './RunHistory';

type ActivityRun = RoutineRun & { routine_id: string; routine_name: string };
interface Fire { routine_id: string; name: string; at: string; trigger: Trigger; has_conditions: boolean }

const PAGE = 50;
const UPCOMING_PREVIEW = 8;

/** "Today", "Tomorrow", "Yesterday" or "Wed, Nov 12", in the home timezone. */
function dayLabel(iso: string, tz: string): string {
  const key = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);  // YYYY-MM-DD
  const day = key(new Date(iso));
  const now = new Date();
  const offset = (n: number) => key(new Date(now.getTime() + n * 86400000));
  if (day === offset(0)) return 'Today';
  if (day === offset(1)) return 'Tomorrow';
  if (day === offset(-1)) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso));
}

function byDay<T>(items: T[], iso: (t: T) => string, tz: string): [string, T[]][] {
  const out: [string, T[]][] = [];
  for (const it of items) {
    const label = dayLabel(iso(it), tz);
    if (out.length && out[out.length - 1][0] === label) out[out.length - 1][1].push(it);
    else out.push([label, [it]]);
  }
  return out;
}

function triggerText(t: Trigger): { icon: React.ReactNode; text: string } {
  if (t.type === 'sun') {
    const off = t.offset_min ? ` ${t.offset_min > 0 ? '+' : '−'}${Math.abs(t.offset_min)} min` : '';
    return { icon: t.event === 'sunrise' ? <Sunrise size={14} /> : <Sunset size={14} />, text: `${t.event === 'sunrise' ? 'Sunrise' : 'Sunset'}${off}` };
  }
  return { icon: <Clock size={14} />, text: 'Scheduled' };
}

/** Everything the routines did (newest first, a page at a time as you scroll) and what's coming up. */
export function RoutineActivity({ timezone, onOpenRoutine }: { timezone: string; onOpenRoutine: (id: string) => void }) {
  const [filter, setFilter] = useState<'all' | 'problems'>('all');
  const [runs, setRuns] = useState<ActivityRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fires, setFires] = useState<Fire[] | null>(null);
  const [showAllFires, setShowAllFires] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const busy = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);

  const fetchPage = useCallback(async (before?: string) => {
    const q = new URLSearchParams({ limit: String(PAGE) });
    if (before) q.set('before', before);
    if (filter === 'problems') q.set('problems', 'true');
    const res = await fetch(`/api/routines/activity?${q}`);
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return (await res.json()) as ActivityRun[];
  }, [filter]);

  // First page (again when the filter changes).
  useEffect(() => {
    let cancelled = false;
    busy.current = true;
    fetchPage().then(page => {
      if (cancelled) return;
      setRuns(page); setMore(page.length === PAGE); setError(null);
    }).catch(() => { if (!cancelled) setError('Couldn’t load the activity.'); })
      .finally(() => { if (!cancelled) { setLoading(false); busy.current = false; } });
    return () => { cancelled = true; };
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (busy.current || !more || runs.length === 0) return;
    busy.current = true;
    setLoading(true);
    try {
      const page = await fetchPage(runs[runs.length - 1].started_at);
      setRuns(prev => {
        const seen = new Set(prev.map(r => r.id));
        return [...prev, ...page.filter(r => !seen.has(r.id))];
      });
      setMore(page.length === PAGE);
    } catch {
      setError('Couldn’t load more.');
    } finally {
      setLoading(false);
      busy.current = false;
    }
  }, [fetchPage, more, runs]);

  // Scrolling near the end loads the next page.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(entries => { if (entries[0].isIntersecting) loadMore(); }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  const loadUpcoming = useCallback(() => {
    fetch('/api/routines/upcoming?days=7').then(r => (r.ok ? r.json() : null)).then(d => setFires(d ? d.fires : []), () => setFires([]));
  }, []);
  useEffect(() => { loadUpcoming(); }, [loadUpcoming]);

  // A run started or finished somewhere: refresh the newest page and what's coming up.
  useEffect(() => {
    const onRun = () => {
      fetchPage().then(page => setRuns(prev => {
        const fresh = new Map(page.map(r => [r.id, r]));
        const rest = prev.filter(r => !fresh.has(r.id));
        return [...page, ...rest].sort((a, b) => b.started_at.localeCompare(a.started_at));
      })).catch(() => {});
      loadUpcoming();
    };
    window.addEventListener('onRoutineRun', onRun);
    window.addEventListener('onRealtimeReconnect', onRun);
    return () => { window.removeEventListener('onRoutineRun', onRun); window.removeEventListener('onRealtimeReconnect', onRun); };
  }, [fetchPage, loadUpcoming]);

  const shownFires = fires && (showAllFires ? fires : fires.slice(0, UPCOMING_PREVIEW));
  const fireDays = useMemo(() => byDay(shownFires ?? [], f => f.at, timezone), [shownFires, timezone]);
  const runDays = useMemo(() => byDay(runs, r => r.started_at, timezone), [runs, timezone]);

  const heading = (icon: React.ReactNode, text: string) => (
    <h2 className="flex items-center gap-2 mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
      {icon}<span>{text}</span><span className="h-px flex-1 bg-neutral-800 ml-2" />
    </h2>
  );
  const dayHeading = (label: string) => <h3 className="sticky top-0 z-10 -mx-1 px-1 py-1.5 bg-neutral-950/95 backdrop-blur text-sm font-medium text-neutral-300">{label}</h3>;

  return (
    <div className="space-y-8">
      {/* Coming up */}
      <section aria-label="Coming up">
        {heading(<CalendarClock size={16} />, 'Coming up (next 7 days)')}
        {fires === null ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : fires.length === 0 ? (
          <p className="text-sm text-neutral-500">Nothing scheduled. Routines that run on a sensor or button aren’t listed here, since they run whenever it reports.</p>
        ) : (
          <div className="space-y-3">
            {fireDays.map(([label, list]) => (
              <div key={label}>
                {dayHeading(label)}
                <ul className="space-y-1.5">
                  {list.map(f => {
                    const t = triggerText(f.trigger);
                    return (
                      <li key={`${f.routine_id}-${f.trigger.id}-${f.at}`}>
                        <button type="button" onClick={() => onOpenRoutine(f.routine_id)}
                          className="w-full min-h-11 flex items-center gap-3 px-3 py-2 rounded-xl bg-neutral-900/60 border border-neutral-800 hover:bg-neutral-900 text-left">
                          <span className="w-16 shrink-0 text-sm tabular-nums text-neutral-200">{formatInTz(f.at, timezone, false)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-neutral-200 truncate">{f.name}</span>
                            <span className="flex items-center gap-1 text-xs text-neutral-500">
                              {t.icon}{t.text}{f.has_conditions ? ' · if its conditions allow' : ''}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {fires.length > UPCOMING_PREVIEW && (
              <button type="button" onClick={() => setShowAllFires(s => !s)} className="min-h-10 px-3 rounded-lg text-sm text-neutral-300 hover:bg-neutral-900">
                {showAllFires ? 'Show fewer' : `Show all ${fires.length}`}
              </button>
            )}
          </div>
        )}
      </section>

      {/* History */}
      <section aria-label="History">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-400"><History size={16} /> History</h2>
          <div className="flex bg-neutral-900/50 p-1 rounded-xl border border-neutral-800" role="group" aria-label="Show">
            {(['all', 'problems'] as const).map(f => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => { if (f !== filter) { setFilter(f); setRuns([]); setMore(true); setLoading(true); } }}
                className={`px-3 min-h-9 rounded-lg text-sm font-medium ${filter === f ? 'bg-neutral-700 text-white' : 'text-neutral-400'}`}>
                {f === 'all' ? 'Everything' : 'Problems'}
              </button>
            ))}
          </div>
        </div>

        {runs.length === 0 && !loading ? (
          <p className="text-sm text-neutral-500">{error ?? (filter === 'problems' ? 'No problems in the last 30 days.' : 'No runs yet.')}</p>
        ) : (
          <div className="space-y-3">
            {runDays.map(([label, list]) => (
              <div key={label}>
                {dayHeading(label)}
                <ul className="space-y-1.5">
                  {list.map(run => (
                    <RunItem key={run.id} run={run} timezone={timezone} timeOnly title={run.routine_name}
                      expanded={open === run.id} onToggle={() => setOpen(open === run.id ? null : run.id)}
                      footer={
                        <button type="button" onClick={() => onOpenRoutine(run.routine_id)} className="min-h-10 px-3 -mx-1 rounded-lg text-sm text-blue-400 hover:bg-neutral-800">
                          Open {run.routine_name}
                        </button>
                      } />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <div ref={sentinel} />
        {loading && <p className="flex items-center gap-2 py-4 text-sm text-neutral-500"><Loader2 size={16} className="animate-spin" /> Loading…</p>}
        {!loading && error && runs.length > 0 && (
          <button type="button" onClick={loadMore} className="mt-3 min-h-10 px-3 rounded-lg text-sm text-neutral-300 bg-neutral-900 border border-neutral-800">{error} Try again</button>
        )}
        {!loading && !more && runs.length > 0 && (
          <p className="py-4 text-center text-xs text-neutral-600">That’s everything. Runs are kept for 30 days (skipped ones for 2).</p>
        )}
      </section>
    </div>
  );
}
