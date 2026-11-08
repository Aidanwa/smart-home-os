import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { openReconnectingSocket } from '../lib/reconnectingSocket';

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

  // Snapshot of the digital twin. Replaces local state so devices removed while we were
  // disconnected disappear too.
  const loadDevices = useCallback(() => {
    authenticatedFetch('/api/devices')
      .then(res => res.json())
      .then(data => {
        if (data.devices) setDevices(data.devices);
      })
      .catch(console.error);
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

    function handleMessage(data: { type: string; device: string; state?: DeviceState; groups?: unknown }) {
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
      if (data.type === 'routine_run') {
        window.dispatchEvent(new CustomEvent('onRoutineRun', { detail: data }));
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
  const sendCommand = useCallback(async (name: string, payload: Record<string, any>) => {
    await authenticatedFetch(`/api/devices/${name}/set`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
  }, []);

  // Helper for simple toggles
  const toggleDevice = useCallback((name: string, currentState: string | undefined) => {
    const newState = currentState === 'ON' ? 'OFF' : 'ON';
    sendCommand(name, { state: newState });
  }, [sendCommand]);

  // permit join control
  const permitJoin = useCallback(async (value: boolean, time: number = 254) => {
    try {
      await authenticatedFetch('/api/bridge/permit_join', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value, time })
      });
    } catch (e) {
      console.error("Failed to set permit join", e);
    }
  }, []);

  const renameDevice = useCallback(async (old_name: string, new_name: string) => {
    await authenticatedFetch(`/api/device/${old_name}/rename`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json'},
        body: JSON.stringify({ new_name })
    });
  }, []);

  const deleteDevice = useCallback(async (deviceId: string) => {
    try {
      await authenticatedFetch(`/api/devices/${deviceId}`, {
        method: 'DELETE',
        headers: { 
          'Content-Type': 'application/json' 
        }
      });
    } catch (e) {
      console.error(`Failed to delete device ${deviceId}`, e);
    }
  }, []);

  return {
    devices,
    realtime,
    sendCommand,
    toggleDevice,
    renameDevice,
    permitJoin,
    deleteDevice
  };

}