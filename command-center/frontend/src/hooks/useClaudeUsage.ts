import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import type { ClaudeUsageData } from '../types';

const BASE_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:9000'
  : window.location.origin;

export function useClaudeUsage() {
  const [usage, setUsage] = useState<ClaudeUsageData | null>(null);

  useEffect(() => {
    const socket = io(`${BASE_URL}/monitor`, {
      transports: ['websocket'],
      reconnection: true,
    });

    socket.on('claude-usage', (data: ClaudeUsageData) => {
      setUsage(data);
    });

    return () => { socket.disconnect(); };
  }, []);

  return usage;
}
