import { useState, useEffect, useRef, useCallback } from 'react';

export interface DeviceState {
  state?: string;
  brightness?: number;
  color_temp?: number;
  temperature?: number;
  humidity?: number;
  [key: string]: any;
}

export function useDevices() {
  const [devices, setDevices] = useState<Record<string, DeviceState>>({});
  const wsRef = useRef<WebSocket | null>(null);

  // 1. Initial REST Fetch (Read Replica)
  useEffect(() => {
    fetch('/api/devices', { headers: { 'X-API-Key': '8tA2A5XDOmoObaeAPJsTiopbrXAcdKfMtrlke6M3NlI' } })
      .then(res => res.json())
      .then(data => {
        if (data.devices) setDevices(data.devices);
      })
      .catch(console.error);
  }, []);

  // 2. Real-Time WebSocket Connection (Event Pipe)
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/ws`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'device_update') {
        setDevices(prev => ({
          ...prev,
          [data.device]: { ...prev[data.device], ...data.state }
        }));
      }
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      } else if (ws.readyState === WebSocket.CONNECTING) {
        ws.onopen = () => ws.close();
      }
    };
  }, []);

  // 3. Hardware Write Action
  // We use useCallback so this function reference is stable if passed to deeply nested cards
  const sendCommand = useCallback(async (name: string, payload: Record<string, any>) => {
    await fetch(`/api/devices/${name}/set`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-API-Key': '8tA2A5XDOmoObaeAPJsTiopbrXAcdKfMtrlke6M3NlI'
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
      await fetch('/api/bridge/permit_join', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-API-Key': '8tA2A5XDOmoObaeAPJsTiopbrXAcdKfMtrlke6M3NlI'
        },
        body: JSON.stringify({ value, time })
      });
    } catch (e) {
      console.error("Failed to set permit join", e);
    }
  }, []);

  const renameDevice = useCallback(async (old_name: string, new_name: string) => {
    await fetch(`/api/device/${old_name}/rename`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': '8tA2A5XDOmoObaeAPJsTiopbrXAcdKfMtrlke6M3NlI' },
        body: JSON.stringify({ new_name })
    });
  }, []);

  return {
    devices,
    sendCommand,
    toggleDevice,
    renameDevice,
    permitJoin,
  };

}