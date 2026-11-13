import { useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';

/** Home / away per person (core/presence.py on the hub). `home` is null for someone who has never
 *  reported (no Arrive/Leave Shortcut yet); they don't count towards the household summary. */
export interface PersonPresence {
  user_id: string;
  username: string;
  home: boolean | null;
  since: string | null;
  source: string | null;
}

export interface HouseholdPresence {
  anyone_home: boolean | null;
  everyone_home: boolean | null;
  anyone_since: string | null;
  everyone_since: string | null;
  tracked: number;
}

export interface PresenceSnapshot { people: PersonPresence[]; household: HouseholdPresence | null }

/** Everyone's presence, kept live by the hub's presence_update events (re-dispatched by useDevices
 *  as `onPresenceUpdate`) and refetched after a realtime reconnect. */
export function usePresence() {
  const [data, setData] = useState<PresenceSnapshot | null>(null);

  const fetchSnapshot = useCallback(async (): Promise<PresenceSnapshot | null> => {
    try {
      const res = await fetch('/api/presence');
      return res.ok ? await res.json() as PresenceSnapshot : null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => fetchSnapshot().then(d => { if (d && !cancelled) setData(d); });
    load();
    window.addEventListener('onPresenceUpdate', load);
    window.addEventListener('onRealtimeReconnect', load);
    return () => {
      cancelled = true;
      window.removeEventListener('onPresenceUpdate', load);
      window.removeEventListener('onRealtimeReconnect', load);
    };
  }, [fetchSnapshot]);

  /** Set someone home or away by hand (the realtime event refreshes everyone's view). */
  const setHome = useCallback(async (userId: string, home: boolean) => {
    const ok = await request(`mark them ${home ? 'home' : 'away'}`, () => fetch(`/api/presence/${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: home ? 'home' : 'away', source: 'app' }),
    }));
    if (ok) fetchSnapshot().then(d => d && setData(d));
    return ok;
  }, [fetchSnapshot]);

  /** Stop counting someone towards "anyone / everyone home". */
  const stopTracking = useCallback(async (userId: string) => {
    const ok = await request('stop tracking them', () => fetch(`/api/presence/${userId}`, { method: 'DELETE' }));
    if (ok) fetchSnapshot().then(d => d && setData(d));
    return ok;
  }, [fetchSnapshot]);

  return { data, setHome, stopTracking };
}
