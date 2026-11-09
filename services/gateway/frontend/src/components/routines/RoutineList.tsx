import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Clock, Copy, DoorOpen, Hand, History, MapPinOff, MoreHorizontal, Play, PowerOff, Radio, Search, Sunrise, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { GroupInfo } from '../../hooks/useGroups';
import { useRoomIndex } from '../../hooks/useRoomIndex';
import { formatFloorName } from '../rooms/constants';
import type { DescribeCtx, Routine, RunStatus } from './types';
import { STATUS_STYLE, formatInTz, relativeTime, summarizeRoutine } from './types';

type GroupBy = 'when' | 'room' | 'none';
type SortBy = 'next' | 'name' | 'last';

/** A remembered choice (per device; harmless if storage is unavailable). */
function useStored<T extends string>(key: string, options: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try { const v = localStorage.getItem(key); return options.includes(v as T) ? (v as T) : fallback; } catch { return fallback; }
  });
  const set = (v: T) => { setValue(v); try { localStorage.setItem(key, v); } catch { /* private mode */ } };
  return [value, set] as const;
}

const PROBLEM: RunStatus[] = ['failed', 'partial', 'missed', 'interrupted'];
const needsAttention = (r: Routine) => r.enabled && !r.running && !r.reviewed && !!r.last_run_status && PROBLEM.includes(r.last_run_status);

const WHEN_SECTIONS: { key: string; title: string; icon: ReactNode }[] = [
  { key: 'time', title: 'Schedule', icon: <Clock size={16} /> },
  { key: 'sun', title: 'Sunrise & sunset', icon: <Sunrise size={16} /> },
  { key: 'device', title: 'Sensors & buttons', icon: <Radio size={16} /> },
  { key: 'manual', title: 'Manual only', icon: <Hand size={16} /> },
];

interface Section { key: string; title: string; icon?: ReactNode; routines: Routine[]; tone?: 'attention' | 'off'; defaultOpen?: boolean }

interface Props {
  routines: Routine[];
  timezone: string;
  groups: GroupInfo[];
  ctx: DescribeCtx;
  onOpen: (r: Routine) => void;
  onHistory: (r: Routine) => void;
  onRun: (r: Routine) => void;
  onDuplicate: (r: Routine) => void;
  onToggle: (r: Routine) => void;
  onReviewed: (r: Routine) => void;
}

export function RoutineList({ routines, timezone, groups, ctx, onOpen, onHistory, onRun, onDuplicate, onToggle, onReviewed }: Props) {
  const [groupBy, setGroupBy] = useStored<GroupBy>('routines.group', ['when', 'room', 'none'], 'when');
  const [sortBy, setSortBy] = useStored<SortBy>('routines.sort', ['next', 'name', 'last'], 'next');
  const [query, setQuery] = useState('');
  const roomIndex = useRoomIndex(groupBy === 'room');

  // Collapsed sections, remembered. "Off" starts collapsed.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('routines.collapsed') ?? '') ?? {}; } catch { return {}; }
  });
  const isOpen = (s: Section) => (s.key in collapsed ? !collapsed[s.key] : s.defaultOpen !== false);
  const toggleSection = (s: Section) => {
    const next = { ...collapsed, [s.key]: isOpen(s) };
    setCollapsed(next);
    try { localStorage.setItem('routines.collapsed', JSON.stringify(next)); } catch { /* private mode */ }
  };

  const summaries = useMemo(() => new Map(routines.map(r => [r.id, summarizeRoutine(r, ctx)])), [routines, ctx]);

  const sections = useMemo((): Section[] => {
    const q = query.trim().toLowerCase();
    const matches = (r: Routine) => !q || [r.name, r.description ?? '', summaries.get(r.id) ?? ''].some(t => t.toLowerCase().includes(q));
    const sorted = routines.filter(matches).sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'last') return (b.last_run_at ?? '').localeCompare(a.last_run_at ?? '') || a.name.localeCompare(b.name);
      // Next run first; routines with no next run (device-triggered, manual) after, by name.
      if (a.next_fire_at && b.next_fire_at) return a.next_fire_at.localeCompare(b.next_fire_at);
      if (a.next_fire_at || b.next_fire_at) return a.next_fire_at ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const attention = sorted.filter(needsAttention);
    const off = sorted.filter(r => !r.enabled);
    const rest = sorted.filter(r => r.enabled && !needsAttention(r));
    const out: Section[] = [];
    if (attention.length) out.push({ key: 'attention', title: 'Needs attention', icon: <AlertTriangle size={16} />, routines: attention, tone: 'attention' });

    if (groupBy === 'none') {
      out.push({ key: 'all', title: '', routines: rest });
    } else if (groupBy === 'when') {
      for (const s of WHEN_SECTIONS) {
        // A routine with several kinds of trigger goes under its first one.
        out.push({ ...s, routines: rest.filter(r => (r.triggers[0]?.type ?? 'manual') === s.key) });
      }
    } else if (roomIndex) {
      const memberIeees = new Map(groups.map(g => [g.id, g.members.map(m => m.ieee_address)]));
      const roomsOf = (r: Routine) => {
        const ieees = new Set<string>();
        for (const a of r.actions) {
          if ((a.type === 'device' || a.type === 'fade') && a.device) ieees.add(a.device);
          if ((a.type === 'group' || a.type === 'fade') && a.group != null) memberIeees.get(a.group)?.forEach(i => ieees.add(i));
        }
        // Nothing controlled (music, "ask the agent"): place it by the devices that trigger it.
        if (ieees.size === 0) r.triggers.forEach(t => { if (t.type === 'device') ieees.add(t.device); });
        return new Set([...ieees].map(i => roomIndex.roomOf[i]).filter(Boolean));
      };
      const multiFloor = new Set(roomIndex.rooms.map(r => r.floor)).size > 1;
      const byRoom = new Map<string, Routine[]>();
      const several: Routine[] = [];
      const none: Routine[] = [];
      for (const r of rest) {
        const rooms = roomsOf(r);
        if (rooms.size === 1) { const id = [...rooms][0]; byRoom.set(id, [...(byRoom.get(id) ?? []), r]); }
        else if (rooms.size > 1) several.push(r);
        else none.push(r);
      }
      for (const room of roomIndex.rooms) {
        out.push({ key: `room-${room.id}`, title: multiFloor ? `${room.name} · ${formatFloorName(room.floor)}` : room.name, icon: <DoorOpen size={16} />, routines: byRoom.get(room.id) ?? [] });
      }
      out.push({ key: 'room-several', title: 'Several rooms', icon: <DoorOpen size={16} />, routines: several });
      out.push({ key: 'room-none', title: 'No room', icon: <MapPinOff size={16} />, routines: none });
    }

    if (off.length) out.push({ key: 'off', title: 'Off', icon: <PowerOff size={16} />, routines: off, tone: 'off', defaultOpen: false });
    return out.filter(s => s.routines.length > 0);
  }, [routines, query, sortBy, groupBy, roomIndex, groups, summaries]);

  const nextUp = useMemo(() => routines
    .filter(r => r.enabled && r.next_fire_at)
    .sort((a, b) => a.next_fire_at!.localeCompare(b.next_fire_at!))[0], [routines]);

  const shown = sections.reduce((n, s) => n + s.routines.length, 0);
  const waitingForRooms = groupBy === 'room' && !roomIndex;

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <label className="relative flex-1 flex items-center">
          <Search size={16} className="absolute left-3 text-neutral-500 pointer-events-none" />
          <span className="sr-only">Search routines</span>
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search routines"
            className="w-full h-11 pl-9 pr-9 rounded-xl bg-neutral-900 border border-neutral-800 text-base sm:text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-neutral-600 [&::-webkit-search-cancel-button]:hidden" />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-1.5 p-2 text-neutral-500 hover:text-neutral-200">
              <X size={16} />
            </button>
          )}
        </label>
        <div className="flex gap-2">
          <Select label="Group routines" value={groupBy} onChange={v => setGroupBy(v as GroupBy)}
            options={[['when', 'Group: When it runs'], ['room', 'Group: Room'], ['none', 'No grouping']]} />
          <Select label="Sort routines" value={sortBy} onChange={v => setSortBy(v as SortBy)}
            options={[['next', 'Sort: Next run'], ['name', 'Sort: Name'], ['last', 'Sort: Last run']]} />
        </div>
      </div>

      {nextUp && !query && (
        <p className="text-sm text-neutral-400">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mr-2">Next up</span>
          <button type="button" onClick={() => onOpen(nextUp)} className="text-neutral-200 hover:underline">{nextUp.name}</button>
          <span className="text-neutral-500"> · {formatInTz(nextUp.next_fire_at, timezone)}</span>
        </p>
      )}

      {waitingForRooms ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading routines">
          {[0, 1, 2].map(i => <div key={i} className="h-20 rounded-xl bg-neutral-900/60 border border-neutral-800/60 animate-pulse" />)}
        </div>
      ) : shown === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-500">No routines match “{query}”.</p>
      ) : (
        sections.map(s => {
          const open = !!query || isOpen(s);  // searching shows every match
          return (
            <section key={s.key} aria-label={s.title || 'Routines'}>
              {s.title && (
                <button type="button" onClick={() => toggleSection(s)} aria-expanded={open}
                  className={`w-full flex items-center gap-2 mb-2 py-1 text-xs font-semibold uppercase tracking-wider ${s.tone === 'attention' ? 'text-amber-400' : 'text-neutral-400 hover:text-neutral-200'}`}>
                  {s.icon}
                  <span>{s.title} ({s.routines.length})</span>
                  <span className="h-px flex-1 bg-neutral-800 ml-2" />
                  <ChevronDown size={16} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
                </button>
              )}
              {open && (
                <div className={`grid grid-cols-1 gap-2 lg:grid-cols-2 ${s.tone === 'off' ? 'opacity-70' : ''}`}>
                  {s.routines.map(r => (
                    <RoutineRow key={r.id} r={r} summary={summaries.get(r.id) ?? ''} timezone={timezone} attention={s.tone === 'attention'}
                      onOpen={() => onOpen(r)} onHistory={() => onHistory(r)} onRun={() => onRun(r)} onDuplicate={() => onDuplicate(r)} onToggle={() => onToggle(r)} onReviewed={() => onReviewed(r)} />
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="relative flex-1 sm:flex-none flex items-center">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="appearance-none w-full h-11 pl-3 pr-8 rounded-xl bg-neutral-900 border border-neutral-800 text-sm font-medium text-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
      <ChevronDown size={16} className="absolute right-2.5 text-neutral-500 pointer-events-none" />
    </label>
  );
}

function RoutineRow({ r, summary, timezone, attention, onOpen, onHistory, onRun, onDuplicate, onToggle, onReviewed }: {
  r: Routine; summary: string; timezone: string; attention: boolean;
  onOpen: () => void; onHistory: () => void; onRun: () => void; onDuplicate: () => void; onToggle: () => void; onReviewed: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [menuOpen]);

  return (
    <article className={`relative min-w-0 flex flex-col rounded-xl border bg-neutral-900 ${attention ? 'border-amber-900/70' : 'border-neutral-800'}`}>
    <div className="flex items-stretch min-w-0">
      {/* The body opens the editor */}
      <button type="button" onClick={onOpen} className="flex-1 min-w-0 text-left p-3 pr-2 rounded-l-xl hover:bg-neutral-800/40">
        <h3 className="font-medium text-neutral-100 truncate">{r.name}</h3>
        <p className="text-xs text-neutral-400 mt-0.5 line-clamp-2">{summary}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-xs">
          {r.enabled && r.next_fire_at && <span className="text-neutral-400">Next {formatInTz(r.next_fire_at, timezone)}</span>}
          {r.running ? (
            <span className={`px-1.5 py-0.5 rounded-md border font-medium ${STATUS_STYLE.running}`}>running</span>
          ) : r.last_run_status ? (
            <span className={`px-1.5 py-0.5 rounded-md border font-medium ${STATUS_STYLE[r.last_run_status]}`}>{r.last_run_status} · {relativeTime(r.last_run_at)}</span>
          ) : (
            <span className="text-neutral-500">Never run</span>
          )}
        </div>
      </button>

      {/* Controls: 44px targets */}
      <div className="flex flex-col items-end justify-between py-1.5 pr-1.5 shrink-0">
        <button type="button" role="switch" aria-checked={r.enabled} aria-label={`${r.name}: ${r.enabled ? 'on' : 'off'}`} onClick={onToggle}
          className="h-11 px-1.5 flex items-center">
          <span className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${r.enabled ? 'bg-blue-600' : 'bg-neutral-700'}`}>
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${r.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </span>
        </button>
        <div className="flex items-center">
          <button type="button" onClick={onRun} aria-label={`Run ${r.name} now`} title="Run now"
            className="size-11 flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800">
            <Play size={18} />
          </button>
          <div ref={menuRef} className="relative">
            <button type="button" onClick={() => setMenuOpen(o => !o)} aria-label={`More for ${r.name}`} aria-haspopup="menu" aria-expanded={menuOpen}
              className="size-11 flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800">
              <MoreHorizontal size={18} />
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 bottom-full mb-1 z-20 w-40 py-1 rounded-xl bg-neutral-900 border border-neutral-700 shadow-xl">
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onHistory(); }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-neutral-200 hover:bg-neutral-800"><History size={15} /> History</button>
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onDuplicate(); }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-neutral-200 hover:bg-neutral-800"><Copy size={15} /> Duplicate</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
      {/* Needs attention: look at what went wrong, then say you've seen it. */}
      {attention && (
        <div className="flex border-t border-amber-900/40">
          <button type="button" onClick={onHistory}
            className="flex-1 min-h-11 flex items-center justify-center gap-1.5 text-sm text-neutral-300 hover:bg-neutral-800/50 rounded-bl-xl">
            <History size={15} /> What happened
          </button>
          <button type="button" onClick={onReviewed} aria-label={`Mark ${r.name} as reviewed`}
            className="flex-1 min-h-11 flex items-center justify-center gap-1.5 text-sm font-medium text-amber-300 hover:bg-amber-500/10 border-l border-amber-900/40 rounded-br-xl">
            <Check size={15} /> Reviewed
          </button>
        </div>
      )}
    </article>
  );
}
