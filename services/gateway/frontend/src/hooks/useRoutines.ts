import { useCallback, useEffect, useState } from 'react';
import type { AttributeMap, MusicResult, Routine, RoutineRun, RoutineSpec } from '../components/routines/types';
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
    window.addEventListener('onRealtimeReconnect', onRun);  // runs finished while disconnected
    return () => {
      window.removeEventListener('onRoutineRun', onRun);
      window.removeEventListener('onRealtimeReconnect', onRun);
    };
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

  const duplicate = async (id: string): Promise<{ routine: Routine | null; error: string | null }> => {
    const res = await call(`/api/routines/${id}/duplicate`, { method: 'POST' });
    if (res.ok) await refresh();
    return { routine: res.ok ? (res.data as Routine) : null, error: res.error };
  };

  const fetchRuns = async (id: string): Promise<RoutineRun[]> => {
    const res = await call(`/api/routines/${id}/runs?limit=30`);
    return res.ok ? (res.data as RoutineRun[]) : [];
  };

  const preview = async (spec: RoutineSpec): Promise<{ result: PreviewResult | null; error: string | null }> => {
    const res = await call('/api/routines/preview', { method: 'POST', body: JSON.stringify(spec) });
    return { result: res.ok ? (res.data as PreviewResult) : null, error: res.error };
  };

  return { routines, timezone, schedulerActive, loading, error, refresh, save, remove, setEnabled, runNow, duplicate, fetchRuns, preview };
}

/** What every device reports (types, units, allowed values), for trigger/condition pickers. */
export function useDeviceAttributes() {
  const [attributes, setAttributes] = useState<AttributeMap>({});
  useEffect(() => {
    call('/api/routines/attributes').then(res => res.ok && setAttributes(res.data as AttributeMap));
  }, []);
  return attributes;
}

/** Count of failed/partial/missed/interrupted runs since this user last looked at Routines.
 *  While the tab is open, everything counts as seen. */
export function useRoutineAlerts(onRoutinesTab: boolean) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const sync = () =>
      call(onRoutinesTab ? '/api/routines/alerts/seen' : '/api/routines/alerts', onRoutinesTab ? { method: 'POST' } : undefined)
        .then(res => res.ok && setCount((res.data as { count: number }).count));
    sync();
    window.addEventListener('onRoutineRun', sync);
    return () => window.removeEventListener('onRoutineRun', sync);
  }, [onRoutinesTab]);
  return count;
}

/** Speakers on the user's Spotify account. */
export function useSpotifyDevices() {
  const [state, setState] = useState<{ names: string[]; error: string | null; loading: boolean }>({ names: [], error: null, loading: true });
  useEffect(() => {
    call('/api/routines/spotify/devices').then(res =>
      setState({
        names: res.ok ? (res.data as { name: string }[]).map(d => d.name) : [],
        error: res.ok ? null : res.error,
        loading: false,
      }));
  }, []);
  return state;
}

export async function searchMusic(q: string): Promise<{ results: MusicResult[]; error: string | null }> {
  const res = await call(`/api/routines/spotify/search?q=${encodeURIComponent(q)}`);
  return { results: res.ok ? (res.data as MusicResult[]) : [], error: res.error };
}
