import { useCallback, useEffect, useState } from 'react';
import type { Routine, RoutineRun, RoutineSpec } from '../components/routines/types';
import { formatApiError } from '../components/routines/types';

export interface PreviewResult {
  next_fires: string[];
  warnings: string[];
}

async function call(url: string, init?: RequestInit): Promise<{ ok: boolean; data: unknown; error: string | null }> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    return { ok: res.ok, data, error: res.ok ? null : formatApiError(data, `Request failed (${res.status})`) };
  } catch {
    return { ok: false, data: null, error: 'Network error' };
  }
}

/** Routines list + mutations. Refreshes when the gateway pushes a routine_run event over /api/ws. */
export function useRoutines() {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [timezone, setTimezone] = useState('UTC');
  const [schedulerActive, setSchedulerActive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(({ ok, data, error }: Awaited<ReturnType<typeof call>>) => {
    if (ok && data) {
      const d = data as { routines: Routine[]; timezone: string; scheduler_active: boolean };
      setRoutines(d.routines);
      setTimezone(d.timezone);
      setSchedulerActive(d.scheduler_active);
      setError(null);
    } else {
      setError(error);
    }
    setLoading(false);
  }, []);

  const refresh = useCallback(() => call('/api/routines').then(apply), [apply]);

  useEffect(() => {
    call('/api/routines').then(apply);
    const onRun = () => refresh();
    window.addEventListener('onRoutineRun', onRun);
    return () => window.removeEventListener('onRoutineRun', onRun);
  }, [apply, refresh]);

  const save = async (spec: RoutineSpec, id?: string) => {
    const res = await call(id ? `/api/routines/${id}` : '/api/routines', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(spec),
    });
    if (res.ok) await refresh();
    return res.error;
  };

  const remove = async (id: string) => {
    const res = await call(`/api/routines/${id}`, { method: 'DELETE' });
    if (res.ok) await refresh();
    return res.error;
  };

  const setEnabled = async (id: string, enabled: boolean) => {
    setRoutines(prev => prev.map(r => (r.id === id ? { ...r, enabled } : r)));  // optimistic
    const res = await call(`/api/routines/${id}/enabled`, { method: 'POST', body: JSON.stringify({ enabled }) });
    await refresh();
    return res.error;
  };

  const runNow = async (id: string) => (await call(`/api/routines/${id}/run`, { method: 'POST' })).error;

  const fetchRuns = async (id: string): Promise<RoutineRun[]> => {
    const res = await call(`/api/routines/${id}/runs?limit=30`);
    return res.ok ? (res.data as RoutineRun[]) : [];
  };

  const preview = async (spec: RoutineSpec): Promise<{ result: PreviewResult | null; error: string | null }> => {
    const res = await call('/api/routines/preview', { method: 'POST', body: JSON.stringify(spec) });
    return { result: res.ok ? (res.data as PreviewResult) : null, error: res.error };
  };

  return { routines, timezone, schedulerActive, loading, error, refresh, save, remove, setEnabled, runNow, fetchRuns, preview };
}
