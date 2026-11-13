import { House, Plane } from 'lucide-react';
import { usePresence } from '../../hooks/usePresence';
import { relativeTime } from '../routines/types';

/** Who's home, under the Home tab's greeting. Hidden until someone's phone reports home/away. */
export function PresenceChip({ userId }: { userId?: string }) {
  const { data } = usePresence();
  const tracked = (data?.people ?? []).filter(p => p.home !== null);
  if (tracked.length === 0) return null;

  const me = tracked.find(p => p.user_id === userId);
  const others = tracked.filter(p => p.user_id !== userId);
  const pill = (home: boolean) =>
    `inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${home ? 'bg-emerald-500/15 text-emerald-300' : 'bg-neutral-800 text-neutral-400'}`;

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Who's home">
      {me && (
        <span className={pill(!!me.home)} title={me.since ? `Since ${new Date(me.since).toLocaleString()}` : undefined}>
          {me.home ? <House size={12} /> : <Plane size={12} />}
          {me.home ? 'You’re home' : 'You’re away'}{me.since ? ` · ${relativeTime(me.since)}` : ''}
        </span>
      )}
      {others.map(p => (
        <span key={p.user_id} className={pill(!!p.home)} title={p.since ? `Since ${new Date(p.since).toLocaleString()}` : undefined}>
          {p.home ? <House size={12} /> : <Plane size={12} />}
          {p.username} {p.home ? 'home' : 'away'}
        </span>
      ))}
    </div>
  );
}
