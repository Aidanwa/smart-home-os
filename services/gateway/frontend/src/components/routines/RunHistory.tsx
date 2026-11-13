import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { RoutineRun, RunStep } from './types';
import { STATUS_STYLE, formatInTz } from './types';

interface Props {
  routineId: string;
  timezone: string;
  fetchRuns: (id: string) => Promise<RoutineRun[]>;
}

const TRIGGER_LABEL: Record<string, string> = { time: 'Scheduled', sun: 'Sun', device: 'Device', room: 'Room', presence: 'Arrive/leave', manual: 'Run now', routine: 'Called' };

export function RunHistory({ routineId, timezone, fetchRuns }: Props) {
  const [runs, setRuns] = useState<RoutineRun[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => fetchRuns(routineId).then(setRuns), [routineId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
    const onRun = (e: Event) => {
      if ((e as CustomEvent).detail?.routine_id === routineId) load();
    };
    window.addEventListener('onRoutineRun', onRun);
    return () => window.removeEventListener('onRoutineRun', onRun);
  }, [load, routineId]);

  if (runs === null) return <p className="text-sm text-neutral-500">Loading…</p>;
  if (runs.length === 0) return <p className="text-sm text-neutral-500">No runs yet.</p>;

  return (
    <ul className="space-y-2">
      {runs.map(run => (
        <RunItem key={run.id} run={run} timezone={timezone} expanded={open === run.id} onToggle={() => setOpen(open === run.id ? null : run.id)} />
      ))}
    </ul>
  );
}

/** One run: status, trigger and time; expands to show why and each step.
 *  `title` (the routine's name) and `timeOnly` are for the Activity page. */
export function RunItem({ run, timezone, expanded, onToggle, title, timeOnly, footer }: {
  run: RoutineRun; timezone: string; expanded: boolean; onToggle: () => void;
  title?: string; timeOnly?: boolean; footer?: ReactNode;
}) {
  const duration = run.finished_at
    ? Math.max(0, Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000))
    : null;
  const when = formatInTz(run.scheduled_for ?? run.started_at, timezone, !timeOnly);
  const trigger = TRIGGER_LABEL[run.trigger_type] ?? run.trigger_type;
  return (
    <li className={`bg-neutral-900 border border-neutral-800 rounded-xl ${run.status === 'skipped' ? 'opacity-70' : ''}`}>
      <button type="button" aria-expanded={expanded} className="w-full flex items-center gap-2 p-3 text-left min-h-11" onClick={onToggle}>
        {expanded ? <ChevronDown size={16} className="text-neutral-500 shrink-0" /> : <ChevronRight size={16} className="text-neutral-500 shrink-0" />}
        <span className={`px-2 py-0.5 rounded-md border text-[11px] font-medium shrink-0 ${STATUS_STYLE[run.status]}`}>{run.status}</span>
        {title ? (
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-neutral-200 truncate">{title}</span>
            <span className="block text-xs text-neutral-500 truncate">{trigger} · {when}</span>
          </span>
        ) : (
          <span className="text-sm text-neutral-300 truncate">{trigger} · {when}</span>
        )}
        {duration !== null && <span className="ml-auto text-xs text-neutral-500 shrink-0">{duration}s</span>}
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2 text-xs">
          {run.late_seconds ? <p className="text-amber-400">Started {run.late_seconds}s late.</p> : null}
          {typeof run.trigger_detail?.reason === 'string' && <p className="text-neutral-400">{run.trigger_detail.reason}</p>}
          {typeof run.trigger_detail?.attribute === 'string' && (
            <p className="text-neutral-400">
              Triggered by {String(run.trigger_detail.device)} {String(run.trigger_detail.attribute)} = {String(run.trigger_detail.value)}
              {typeof run.trigger_detail.held_s === 'number' ? ` (held ${Math.round(run.trigger_detail.held_s / 60)} min)` : ''}
            </p>
          )}
          {typeof run.trigger_detail?.room === 'string' && (
            <p className="text-neutral-400">
              {String(run.trigger_detail.room)} became {run.trigger_detail.occupied ? 'occupied' : 'empty'}
              {typeof run.trigger_detail.held_s === 'number' ? ` (for ${Math.round(run.trigger_detail.held_s / 60)} min)` : ''}
            </p>
          )}
          {typeof run.trigger_detail?.presence === 'string' && (
            <p className="text-neutral-400">
              {String(run.trigger_detail.presence)}
              {typeof run.trigger_detail.held_s === 'number' ? ` (for ${Math.round(run.trigger_detail.held_s / 60)} min)` : ''}
            </p>
          )}
          {typeof run.trigger_detail?.called_by === 'string' && <p className="text-neutral-400">Started by the routine {run.trigger_detail.called_by}</p>}
          {run.error && <p className="text-red-400 whitespace-pre-line">{run.error}</p>}
          {run.steps.map((s, i) => <StepRow key={`${s.id}-${i}`} step={s} />)}
          {footer}
        </div>
      )}
    </li>
  );
}

const STEP_STYLE: Record<RunStep['status'], string> = {
  ok: 'text-green-400', partial: 'text-amber-400', failed: 'text-red-400', running: 'text-blue-400', skipped: 'text-neutral-500', cancelled: 'text-neutral-500',
};

function StepRow({ step }: { step: RunStep }) {
  const d = step.detail ?? {};
  const target = (d.device ?? d.group) as string | undefined;
  const what =
    step.type === 'delay' ? `Wait ${d.seconds ?? ''}s`
    : step.type === 'fade' ? `Fade ${String(d.target ?? '')} to ${Math.round(Number(d.to_brightness ?? 0) / 2.54)}% over ${Math.round(Number(d.duration_s ?? 0) / 60 * 10) / 10} min (${String(d.method ?? '')})`
    : step.type === 'spotify_play' ? `Play ${String(d.playing ?? '')} on ${String(d.speaker ?? '')}`
    : step.type === 'spotify_ctrl' ? `${String(d.cmd ?? '')} on ${String(d.speaker ?? '')}`
    : step.type === 'agent' ? 'Ask the agent'
    : step.type === 'routine' ? `Run ${String(d.routine ?? 'routine')}${d.wait ? ' and wait' : ''}${typeof d.outcome === 'string' ? `: ${d.outcome}` : ''}`
    : step.type === 'notify' ? `Notify ${d.to === 'everyone' ? 'everyone' : 'owner'}: ${String(d.title ?? '')}${typeof d.devices === 'number' ? ` (${d.sent ?? 0} of ${d.devices} device${d.devices === 1 ? '' : 's'})` : ''}`
    : `${target ?? step.type}${d.sent ? ` → ${Object.entries(d.sent as Record<string, unknown>).map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}`;
  const notes = ['message', 'ramp', 'ramp_stopped', 'stopped_early', 'note']
    .filter(k => typeof d[k] === 'string')
    .map(k => (k === 'ramp_stopped' ? `Ramp stopped: ${d[k]}` : k === 'stopped_early' ? `Stopped early: ${d[k]}` : String(d[k])));
  return (
    <div className="flex gap-2 border-t border-neutral-800 pt-2">
      <span className={`w-16 shrink-0 font-medium ${STEP_STYLE[step.status]}`}>{step.status}</span>
      <div className="min-w-0">
        <p className="text-neutral-300 break-words">{step.id}: {what}</p>
        {step.error && <p className="text-red-400 break-words">{step.error}</p>}
        {typeof d.reason === 'string' && <p className="text-neutral-500">{d.reason}</p>}
        {Array.isArray(d.did_not_follow) && <p className="text-amber-400 break-words">Didn't follow: {d.did_not_follow.join(', ')}</p>}
        {notes.map(n => <p key={n} className="text-neutral-500 break-words">{n}</p>)}
        {typeof d.reply === 'string' && d.reply && <p className="text-neutral-300 break-words whitespace-pre-line">“{d.reply}”</p>}
        {typeof d.notify_error === 'string' && <p className="text-amber-400 break-words">Notification: {d.notify_error}</p>}
        {!!d.notified && typeof d.notify_error !== 'string' && (() => {
          const n = d.notified as { to: string; sent: number; devices: number };
          return <p className="text-neutral-500">Sent as a notification to {n.to === 'everyone' ? 'everyone' : 'the owner'} ({n.sent} of {n.devices} device{n.devices === 1 ? '' : 's'})</p>;
        })()}
        {Array.isArray(d.tool_calls) && (d.tool_calls as { name: string; ok: boolean | null; error?: string; arguments?: unknown }[]).map((c, i) => (
          <p key={i} className={`break-words ${c.ok === false ? 'text-red-400' : 'text-neutral-500'}`}>
            {c.ok === false ? '✗' : '✓'} {c.name} {c.arguments ? JSON.stringify(c.arguments).slice(0, 160) : ''}{c.error ? ` — ${c.error}` : ''}
          </p>
        ))}
        {step.ms != null && step.type !== 'delay' && <p className="text-neutral-600">{step.ms} ms</p>}
      </div>
    </div>
  );
}
