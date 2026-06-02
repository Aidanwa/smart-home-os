import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

export type HealthStatus = 'healthy' | 'unhealthy' | 'mqtt is unhealthy' | 'checking' | 'smart home os is unhealthy';

export function useSystemHealth() {
  const { authenticatedFetch } = useAuth();
  const [status, setStatus] = useState<HealthStatus>('checking');

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await authenticatedFetch('/api/bridge/health', {});
        if (res.status ===200) {
          setStatus('healthy');
        } else if (res.status === 502){
          setStatus('smart home os is unhealthy');
        } else {
          setStatus('mqtt is unhealthy');
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

