import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import type { SystemMetrics } from '../types';

const BASE_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:9000'
  : window.location.origin;

export function useSystemMonitor() {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);

  useEffect(() => {
    const socket = io(`${BASE_URL}/monitor`, {
      transports: ['websocket'],
      reconnection: true,
    });

    socket.on('metrics', (data: SystemMetrics) => {
      setMetrics(data);
    });

    return () => { socket.disconnect(); };
  }, []);

  return metrics;
}
