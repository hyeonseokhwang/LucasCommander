import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

interface WorkerTask {
  text: string;
  done: boolean;
}

interface WorkerStatus {
  filename: string;
  name: string;
  lastUpdated: string;
  tasks: WorkerTask[];
  requests: string[];
}

export interface CoordinationState {
  master: {
    lastUpdated: string;
    sessionCount: number;
    phases: WorkerTask[];
    prohibitions: string[];
  };
  workers: WorkerStatus[];
  lastParsed: string;
}

const BASE_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:9000'
  : window.location.origin;

export function useCoordination() {
  const [state, setState] = useState<CoordinationState | null>(null);

  useEffect(() => {
    const socket = io(`${BASE_URL}/coordination`, {
      transports: ['websocket'],
      reconnection: true,
    });

    socket.on('update', (data: CoordinationState) => {
      setState(data);
    });

    return () => { socket.disconnect(); };
  }, []);

  return state;
}
