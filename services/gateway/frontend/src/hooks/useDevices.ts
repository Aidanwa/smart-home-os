import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { openReconnectingSocket } from '../lib/reconnectingSocket';
import { request, withPending } from '../lib/api';
import { toast } from 'sonner';

export interface DeviceState {
  state?: string;
  brightness?: number;
  color_temp?: number;
  temperature?: number;
  humidity?: number;
  [key: string]: any;
}

/** 'lost' = was connected (or never managed to connect) and is retrying; states may be stale. */
export type RealtimeStatus = 'connecting' | 'open' | 'lost';

export function useDevices() {
  const { authenticatedFetch } = useAuth();
  const [devices, setDevices] = useState<Record<string, DeviceState>>({});
  const [realtime, setRealtime] = useState<RealtimeStatus>('connecting');
  // The first device list: Home shows placeholders while 'loading' and a retry on 'error'.
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');

  // Snapshot of the digital twin. Replaces local state so devices removed while we were
  // disconnected disappear too.
  const loadDevices = useCallback(() => {
    authenticatedFetch('/api/devices')
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(data => {
        if (data.devices) setDevices(data.devices);
        setLoadState('ready');
      })
      .catch((err) => {
        console.error(err);
        // Keep showing what we had after a failed resync; only the first load shows an error.
        setLoadState(prev => (prev === 'ready' ? 'ready' : 'error'));
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 1. Initial REST fetch, in parallel with the socket for a fast first paint
  useEffect(() => { loadDevices(); }, [loadDevices]);

  // 2. Real-time event pipe; reconnects on its own (see lib/reconnectingSocket)
  useEffect(() => {
    const sock = openReconnectingSocket('/api/ws', {
      onOpen: (reconnected) => {
        setRealtime('open');
        if (reconnected) {
          // Updates sent while we were away are gone: resync, and tell the other live views.
          loadDevices();
          window.dispatchEvent(new CustomEvent('onRealtimeReconnect'));
        }
      },
      onClose: () => setRealtime('lost'),
      onMessage: (raw) => handleMessage(JSON.parse(raw)),
    });

    function handleMessage(data: { type: string; device: string; state?: DeviceState; groups?: unknown; friendly_name?: string; ok?: boolean; error?: string | null }) {
      if (data.type === 'device_update') {
        setDevices(prev => ({
          ...prev,
          [data.device]: { ...prev[data.device], ...data.state }
        }));
      }
      if (data.type === 'groups_update') {
        window.dispatchEvent(new CustomEvent('onGroupsUpdate', { 
          detail: data.groups 
        }));
      }
      if (data.type === 'curve_update') {
        window.dispatchEvent(new CustomEvent('onCurveUpdate', { detail: data }));
      }
      if (data.type === 'routine_run') {
        window.dispatchEvent(new CustomEvent('onRoutineRun', { detail: data }));
      }
      if (data.type === 'presence_update') {
        window.dispatchEvent(new CustomEvent('onPresenceUpdate', { detail: data }));
      }
      if (data.type === 'ota_result') {
        const label = data.friendly_name ?? data.device;
        if (data.ok) toast.success(`${label} is up to date`, { description: 'The firmware update finished.' });
        else toast.error(`Firmware update for ${label} failed`, { description: data.error ?? undefined, duration: 15000 });
      }
      if (data.type === 'device_delete') {
        setDevices(prev => {
          const newDevices = { ...prev };
          delete newDevices[data.device];
          return newDevices;
        });
      }
    }

    return () => sock.close();
  }, [loadDevices]);

  // 3. Hardware Write Action
  // We use useCallback so this function reference is stable if passed to deeply nested cards
  // Failures show a toast (lib/api), and the card shows it's busy while the device answers.
  const sendCommand = useCallback((name: string, payload: Record<string, any>, what?: string) =>
    withPending(name, () => request(what ?? `change ${name}`, () =>
      authenticatedFetch(`/api/devices/${encodeURIComponent(name)}/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }))),
  []); // eslint-disable-line react-hooks/exhaustive-deps

  // Helper for simple toggles
  const toggleDevice = useCallback((name: string, currentState: string | undefined) => {
    const newState = currentState === 'ON' ? 'OFF' : 'ON';
    return sendCommand(name, { state: newState }, `turn ${newState === 'ON' ? 'on' : 'off'} ${name}`);
  }, [sendCommand]);

  // permit join control
  const permitJoin = useCallback((value: boolean, time: number = 254) =>
    request(value ? 'start pairing mode' : 'stop pairing mode', () =>
      authenticatedFetch('/api/bridge/permit_join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, time }),
      })),
  []); // eslint-disable-line react-hooks/exhaustive-deps

  const renameDevice = useCallback(async (old_name: string, new_name: string) => {
    const ok = await request(`rename ${old_name}`, () =>
      authenticatedFetch(`/api/device/${encodeURIComponent(old_name)}/rename`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_name }),
      }));
    if (ok) toast.success(`Renamed to ${new_name}`);
    return ok;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const deleteDevice = useCallback(async (deviceId: string, label?: string) => {
    const ok = await request(`remove ${label ?? deviceId}`, () =>
      authenticatedFetch(`/api/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' }));
    if (ok) toast.success(`Removed ${label ?? 'the device'}`);
    return ok;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    devices,
    loadState,
    reloadDevices: () => { setLoadState('loading'); loadDevices(); },
    realtime,
    sendCommand,
    toggleDevice,
    renameDevice,
    permitJoin,
    deleteDevice
  };

}