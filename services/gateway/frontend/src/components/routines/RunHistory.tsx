import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { RoutineRun, RunStep } from './types';
import { STATUS_STYLE, formatInTz } from './types';

interface Props {
  routineId: string;
  timezone: string;
  fetchRuns: (id: string) => Promise<RoutineRun[]>;
}

const TRIGGER_LABEL: Record<string, string> = { time: 'Scheduled', sun: 'Sun', device: 'Device', manual: 'Run now' };

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
      {runs.map(run => {
        const expanded = open === run.id;
        const duration = run.finished_at
          ? Math.max(0, Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000))
          : null;
        return (
          <li key={run.id} className="bg-neutral-900 border border-neutral-800 rounded-xl">
            <button type="button" className="w-full flex items-center gap-2 p-3 text-left" onClick={() => setOpen(expanded ? null : run.id)}>
              {expanded ? <ChevronDown size={16} className="text-neutral-500 shrink-0" /> : <ChevronRight size={16} className="text-neutral-500 shrink-0" />}
              <span className={`px-2 py-0.5 rounded-md border text-[11px] font-medium shrink-0 ${STATUS_STYLE[run.status]}`}>{run.status}</span>
              <span className="text-sm text-neutral-300 truncate">
                {TRIGGER_LABEL[run.trigger_type] ?? run.trigger_type} · {formatInTz(run.scheduled_for ?? run.started_at, timezone)}
              </span>
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
                {run.error && <p className="text-red-400 whitespace-pre-line">{run.error}</p>}
                {run.steps.map((s, i) => <StepRow key={`${s.id}-${i}`} step={s} />)}
              </div>
            )}
          </li>
        );
      })}
    </ul>
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
        {step.ms != null && step.type !== 'delay' && <p className="text-neutral-600">{step.ms} ms</p>}
      </div>
    </div>
  );
}
