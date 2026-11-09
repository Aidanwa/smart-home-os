// src/components/agent/ToolCallChip.tsx
import { useState } from 'react';
import { Wrench, ChevronDown, ChevronUp, Check, Loader2, X } from 'lucide-react';

interface ToolCallChipProps {
  name: string;
  args?: string;
  status?: 'pending' | 'completed';
  /** Only meaningful once completed; undefined means the agent didn't say (older history). */
  ok?: boolean;
  error?: string | null;
}

type Args = Record<string, unknown>;

function parseArgs(args?: string): Args | null {
  if (!args) return null;
  try {
    const v = JSON.parse(args);
    return v && typeof v === 'object' ? (v as Args) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** "on, 60%" from a device state change. */
function describeState(state: Args): string {
  const parts: string[] = [];
  if (typeof state.state === 'string') parts.push(state.state.toLowerCase());
  if (typeof state.brightness === 'number') parts.push(`${Math.round((state.brightness / 254) * 100)}%`);
  if (state.color_temp !== undefined) parts.push('colour temperature');
  if (state.color !== undefined) parts.push('colour');
  const other = Object.keys(state).filter(k => !['state', 'brightness', 'color_temp', 'color', 'transition'].includes(k));
  parts.push(...other.map(k => k.replace(/_/g, ' ')));
  return parts.join(', ');
}

const listNames = (names: string[]) =>
  names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;

/** A plain-language line for what the assistant did. Falls back to the tool's name. */
function describeToolCall(name: string, rawArgs?: string): string {
  const a = parseArgs(rawArgs) ?? {};
  switch (name) {
    case 'set_device_state': {
      const cmds = Array.isArray(a.commands) ? (a.commands as Args[]) : [];
      if (cmds.length === 0) return 'Changed a device';
      const descs = cmds.map(c => describeState((c.state as Args) ?? {}));
      const names = cmds.map(c => str(c.device) || 'a device');
      if (descs.every(d => d === descs[0])) return `Set ${listNames(names)}${descs[0] ? ` → ${descs[0]}` : ''}`;
      return `Changed ${listNames(names)}`;
    }
    case 'update_memory': {
      const ops = Array.isArray(a.operations) ? (a.operations as Args[]) : [];
      if (ops.length === 1 && ops[0].op === 'add' && str(ops[0].content)) return `Remembered “${str(ops[0].content)}”`;
      if (ops.length === 1 && ops[0].op === 'remove') return 'Forgot a saved fact';
      if (ops.length === 1 && ops[0].op === 'update') return 'Updated a saved fact';
      return 'Updated what it remembers';
    }
    case 'get_weather': return 'Checked the weather';
    case 'rt_format': return 'Looked up the routine format';
    case 'rt_list': return 'Listed routines';
    case 'rt_save': {
      const routine = parseArgs(str(a.routine));
      const title = str(routine?.name);
      return `${a.id ? 'Updated' : 'Created'} routine${title ? ` “${title}”` : ''}`;
    }
    case 'rt_enable': return a.enabled ? 'Turned a routine on' : 'Turned a routine off';
    case 'rt_run': return 'Ran a routine';
    case 'rt_delete': return a.confirmed ? 'Deleted a routine' : 'Checked before deleting a routine';
    case 'spot_play': {
      const what = str(a.q) ? `“${str(a.q)}”` : 'music';
      return `Played ${what}${str(a.dev) ? ` on ${str(a.dev)}` : ''}`;
    }
    case 'spot_ctrl': {
      const dev = str(a.dev);
      switch (a.cmd) {
        case 'pause': return 'Paused music';
        case 'resume': return 'Resumed music';
        case 'next': return 'Skipped to the next track';
        case 'previous': return 'Went back a track';
        case 'volume': return typeof a.vol === 'number' ? `Set the volume to ${a.vol}%` : 'Changed the volume';
        case 'shuffle': return a.shuf ? 'Turned shuffle on' : 'Turned shuffle off';
        case 'repeat': return 'Changed repeat';
        case 'transfer': return `Moved music${dev ? ` to ${dev}` : ''}`;
        default: return 'Controlled Spotify';
      }
    }
    case 'spot_info': return 'Checked what’s playing';
    case 'spot_search': return str(a.q) ? `Searched Spotify for “${str(a.q)}”` : 'Searched Spotify';
    case 'spot_queue': return 'Added a track to the queue';
    case 'spot_search_playlist': return str(a.query) ? `Looked for the playlist “${str(a.query)}”` : 'Looked for a playlist';
    default: return name.replace(/_/g, ' ').replace(/^\w/, l => l.toUpperCase());
  }
}

export function ToolCallChip({ name, args, status = 'completed', ok, error }: ToolCallChipProps) {
  const [expanded, setExpanded] = useState(false);
  const failed = status === 'completed' && ok === false;
  const label = describeToolCall(name, args);
  const parsed = parseArgs(args);
  const details = parsed ? JSON.stringify(parsed, null, 2) : args;

  return (
    <div className="w-full max-w-[85%] my-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className={`inline-flex max-w-full items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors text-xs text-left ${
          status === 'pending'
            ? 'bg-amber-950/30 border-amber-900/50 hover:bg-amber-950/50 text-amber-200/80'
            : failed
              ? 'bg-red-950/30 border-red-900/50 hover:bg-red-950/50 text-red-200/90'
              : 'bg-neutral-800/50 border-neutral-700/50 hover:bg-neutral-800 text-neutral-300'
        }`}
      >
        <Wrench size={14} className={`shrink-0 ${status === 'pending' ? 'text-amber-500' : failed ? 'text-red-400' : 'text-blue-400'}`} />
        <span className="truncate">{label}</span>
        {status === 'pending' ? (
          <Loader2 size={14} className="shrink-0 text-amber-500 animate-spin" aria-label="Working" />
        ) : failed ? (
          <X size={14} className="shrink-0 text-red-400" aria-label="Failed" />
        ) : (
          <Check size={14} className="shrink-0 text-green-500" aria-label="Done" />
        )}
        {expanded ? <ChevronUp size={14} className="shrink-0" /> : <ChevronDown size={14} className="shrink-0" />}
      </button>
      {failed && error && <p className="mt-1 ml-1 text-xs text-red-300/80">{error}</p>}

      {expanded && (
        <div className="mt-2 p-3 rounded-lg bg-neutral-950 border border-neutral-800 font-mono text-[11px] text-neutral-400 overflow-x-auto">
          <div className="mb-1 text-neutral-500">{name}</div>
          {details ? <pre className="whitespace-pre-wrap break-words">{details}</pre> : <span>No details.</span>}
        </div>
      )}
    </div>
  );
}
