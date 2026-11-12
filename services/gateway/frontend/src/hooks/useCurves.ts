import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Curve, CurvePoint, CurvePreview, CurveSpec, LightCurveStatus } from '../components/routines/curves/types';

async function detail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.detail === 'string') return body.detail;
    if (Array.isArray(body?.detail) && body.detail[0]?.msg) return body.detail[0].msg;
  } catch { /* not JSON */ }
  return `The hub answered with error ${res.status}.`;
}

/** The day curves and their editing calls. Errors come back as strings (null = ok). */
export function useCurves() {
  const [curves, setCurves] = useState<Curve[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/curves');
      if (res.ok) setCurves(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async (id: string | null, spec: CurveSpec): Promise<string | null> => {
    const res = await fetch(id ? `/api/curves/${id}` : '/api/curves', {
      method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec),
    }).catch(() => null);
    if (!res) return 'Can’t reach the hub.';
    if (!res.ok) return detail(res);
    await refresh();
    window.dispatchEvent(new CustomEvent('onCurveUpdate'));
    return null;
  };

  const remove = async (id: string): Promise<string | null> => {
    const res = await fetch(`/api/curves/${id}`, { method: 'DELETE' }).catch(() => null);
    if (!res) return 'Can’t reach the hub.';
    if (!res.ok) return detail(res);
    await refresh();
    window.dispatchEvent(new CustomEvent('onCurveUpdate'));
    return null;
  };

  return { curves, loading, refresh, save, remove };
}

export async function previewCurve(points: CurvePoint[]): Promise<CurvePreview | string> {
  const res = await fetch('/api/curves/preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ points }),
  }).catch(() => null);
  if (!res) return 'Can’t reach the hub.';
  return res.ok ? res.json() : detail(res);
}

/** Which lights follow a curve, and whether each is paused. One shared store for every card:
 *  fetched while anything uses it, again on `curve_update` pushes (re-dispatched by useDevices as
 *  onCurveUpdate) and reconnects, and once a minute for the targets. */
let statusSnapshot: Record<string, LightCurveStatus> = {};
const statusListeners = new Set<() => void>();
let statusTimer: ReturnType<typeof setInterval> | null = null;

function loadStatus() {
  fetch('/api/curves/status')
    .then(res => (res.ok ? res.json() : null))
    .then(d => {
      if (!d) return;
      statusSnapshot = d.lights ?? {};
      statusListeners.forEach(l => l());
    })
    .catch(() => {});
}

function subscribeStatus(listener: () => void) {
  statusListeners.add(listener);
  if (statusListeners.size === 1) {
    loadStatus();
    statusTimer = setInterval(loadStatus, 60_000);
    window.addEventListener('onCurveUpdate', loadStatus);
    window.addEventListener('onRealtimeReconnect', loadStatus);
  }
  return () => {
    statusListeners.delete(listener);
    if (statusListeners.size === 0) {
      if (statusTimer) clearInterval(statusTimer);
      window.removeEventListener('onCurveUpdate', loadStatus);
      window.removeEventListener('onRealtimeReconnect', loadStatus);
    }
  };
}

export function useCurveStatus(): Record<string, LightCurveStatus> {
  return useSyncExternalStore(subscribeStatus, () => statusSnapshot);
}

export async function setLightCurve(ieee: string, curveId: string | null): Promise<string | null> {
  const res = await fetch(`/api/curves/lights/${encodeURIComponent(ieee)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ curve_id: curveId }),
  }).catch(() => null);
  if (!res) return 'Can’t reach the hub.';
  if (!res.ok) return detail(res);
  window.dispatchEvent(new CustomEvent('onCurveUpdate'));
  return null;
}

export async function resumeLightCurve(ieee: string): Promise<string | null> {
  const res = await fetch(`/api/curves/lights/${encodeURIComponent(ieee)}/resume`, { method: 'POST' }).catch(() => null);
  if (!res) return 'Can’t reach the hub.';
  if (!res.ok) return detail(res);
  window.dispatchEvent(new CustomEvent('onCurveUpdate'));
  return null;
}
