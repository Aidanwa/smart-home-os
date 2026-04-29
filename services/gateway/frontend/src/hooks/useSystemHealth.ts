import { useState, useEffect } from 'react';

export type HealthStatus = 'healthy' | 'unhealthy' | 'checking';

export function useSystemHealth() {
  const [status, setStatus] = useState<HealthStatus>('checking');

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch('/api/bridge/health', { 
            headers: { 'X-API-Key': '8tA2A5XDOmoObaeAPJsTiopbrXAcdKfMtrlke6M3NlI' } 
        });
        if (res.ok) {
          setStatus('healthy');
        } else {
          setStatus('unhealthy');
        }
      } catch (e) {
        setStatus('unhealthy');
      }
    };

    checkHealth();
    // Poll every 30 seconds
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  return status;
}