import { useEffect, useState, useRef } from 'react';
import { Lightbulb, Power } from 'lucide-react';

interface DeviceState {
  state?: string;
  brightness?: number;
  [key: string]: any;
}

export default function App() {
  const [devices, setDevices] = useState<Record<string, DeviceState>>({});
  const wsRef = useRef<WebSocket | null>(null);

  // 1. Initial Fetch
  useEffect(() => {
    fetch('/api/devices', { headers: { 'X-API-Key': '8tA2A5XDOmoObaeAPJsTiopbrXAcdKfMtrlke6M3NlI' } }) // Adjust auth as needed
      .then(res => res.json())
      .then(data => {
        if (data.devices) setDevices(data.devices);
      })
      .catch(console.error);
  }, []);

  // 2. Real-Time WebSocket Connection
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

    // Smarter cleanup function for React StrictMode
    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      } else if (ws.readyState === WebSocket.CONNECTING) {
        // If React unmounts us before the connection finishes,
        // wait for it to open, THEN gracefully close it.
        // This entirely eliminates the browser warning!
        ws.onopen = () => ws.close();
      }
    };
  }, []);

  // 3. Hardware Write Action
  const toggleDevice = async (name: string, currentState: string) => {
    // Optimistic UI update could go here
    const newState = currentState === 'ON' ? 'OFF' : 'ON';
    
    await fetch(`/api/devices/${name}/set`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-API-Key': '8tA2A5XDOmoObaeAPJsTiopbrXAcdKfMtrlke6M3NlI' // Adjust based on your API auth dependency
      },
      body: JSON.stringify({ state: newState })
    });
    // We don't manually update state here. The WebSocket will confirm the physical
    // hardware changed and update the UI automatically!
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-8">
      <h1 className="text-3xl font-light mb-8 tracking-tight">Smart Home OS</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Object.entries(devices).map(([name, state]) => {
            const isOn = state.state === 'ON';
            
            return (
              <div 
                key={name} 
                className={`p-6 rounded-2xl border transition-all duration-300 ${
                  isOn ? 'bg-neutral-800 border-neutral-700' : 'bg-neutral-900/50 border-neutral-800'
                }`}
              >
                <div className="flex justify-between items-start mb-4">
                  <div className={`p-2 rounded-full ${isOn ? 'bg-yellow-500/20 text-yellow-400' : 'bg-neutral-800 text-neutral-500'}`}>
                    <Lightbulb size={24} />
                  </div>
                  <button 
                    onClick={() => toggleDevice(name, state.state || 'OFF')}
                    className="p-2 hover:bg-neutral-700 rounded-full transition-colors"
                  >
                    <Power size={20} className={isOn ? 'text-white' : 'text-neutral-600'} />
                  </button>
                </div>
                
                <h3 className="font-medium text-lg truncate">{name}</h3>
                <p className="text-sm text-neutral-400 mt-1">
                  {isOn && state.brightness ? `Brightness: ${Math.round((state.brightness/254)*100)}%` : 'Offline / Off'}
                </p>
              </div>
            )
        })}
      </div>
    </div>
  );
}