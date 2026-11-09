import { Popover as PopoverPrimitive } from 'radix-ui';
import type { HealthLevel, SystemHealth } from '../../hooks/useSystemHealth';

const DOT: Record<HealthLevel, { ping: string; dot: string; label: string; badge: string }> = {
  ok: { ping: 'bg-green-400', dot: 'bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.8)]', label: 'OK', badge: 'bg-green-500/10 text-green-400' },
  checking: { ping: 'bg-yellow-400', dot: 'bg-yellow-500 shadow-[0_0_12px_rgba(234,179,8,0.8)]', label: 'Checking', badge: 'bg-yellow-500/10 text-yellow-400' },
  warn: { ping: 'bg-amber-400', dot: 'bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.8)]', label: 'Partly down', badge: 'bg-amber-500/10 text-amber-400' },
  down: { ping: 'bg-red-400', dot: 'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.8)]', label: 'Down', badge: 'bg-red-500/10 text-red-400' },
};

export function HealthDot({ level }: { level: HealthLevel }) {
  const c = DOT[level];
  return (
    <span className="relative flex size-2.5">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${c.ping}`} />
      <span className={`relative inline-flex rounded-full size-2.5 ${c.dot}`} />
    </span>
  );
}

/** What the status panel says; shared by the desktop sidebar (hover) and the phone header (tap). */
export function HealthDetails({ health }: { health: SystemHealth }) {
  const c = DOT[health.level];
  return (
    <>
      <h3 className="text-sm font-medium border-b border-neutral-800 pb-1.5 mb-2 flex items-center justify-between gap-3">
        <span>{health.title}</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase font-bold tracking-wider shrink-0 ${c.badge}`}>{c.label}</span>
      </h3>
      {health.problems.length === 0 ? (
        <p className="text-xs text-neutral-400 leading-relaxed">
          {health.level === 'checking' ? 'Checking the hub…' : 'The hub, Zigbee and the assistant are all up.'}
        </p>
      ) : (
        <ul className="space-y-2 text-xs text-neutral-400 leading-relaxed">
          {health.problems.map(p => <li key={p}>{p}</li>)}
        </ul>
      )}
    </>
  );
}

/** Phone header: a tappable status dot that opens the same panel. */
export function HealthButton({ health }: { health: SystemHealth }) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger
        aria-label={`Hub status: ${health.title}`}
        className="flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-neutral-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      >
        <HealthDot level={health.level} />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          collisionPadding={16}
          className="z-50 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-neutral-800 bg-neutral-900/95 p-4 text-left text-neutral-200 shadow-2xl backdrop-blur-md outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          <HealthDetails health={health} />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
