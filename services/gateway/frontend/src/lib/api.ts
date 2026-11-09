import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';

/** Pull a readable message out of a failed response (FastAPI puts it in `detail`). */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const d = body?.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d) && d[0]?.msg) return d[0].msg;  // 422 validation errors
  } catch { /* not JSON */ }
  if (res.status === 504) return 'The device didn’t answer in time. It may be offline.';
  return `The hub answered with error ${res.status}.`;
}

/**
 * Run a request and tell the user if it fails. `what` completes the sentence
 * "Couldn't …", e.g. "turn on Lamp". Returns true on success.
 */
export async function request(what: string, run: () => Promise<Response>): Promise<boolean> {
  try {
    const res = await run();
    if (res.ok) return true;
    if (res.status === 401) return false;  // AuthContext logs out; no toast needed
    toast.error(`Couldn’t ${what}`, { description: await errorMessage(res) });
  } catch {
    toast.error(`Couldn’t ${what}`, { description: 'Can’t reach the hub. Check your connection.' });
  }
  return false;
}

// Devices with a command in flight, so cards can show they're working on it.
const pending = new Map<string, number>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());

export async function withPending<T>(name: string, run: () => Promise<T>): Promise<T> {
  pending.set(name, (pending.get(name) ?? 0) + 1);
  notify();
  try {
    return await run();
  } finally {
    const n = (pending.get(name) ?? 1) - 1;
    if (n > 0) pending.set(name, n); else pending.delete(name);
    notify();
  }
}

export function usePending(name: string): boolean {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => pending.has(name),
  );
}
