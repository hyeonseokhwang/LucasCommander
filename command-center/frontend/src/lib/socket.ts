import { io, Socket } from 'socket.io-client';

const BASE_URL = window.location.hostname === 'localhost'
  ? `http://localhost:9000`
  : window.location.origin;

export function createTerminalSocket(): Socket {
  return io(`${BASE_URL}/terminal`, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
}

export function createCoordinationSocket(): Socket {
  return io(`${BASE_URL}/coordination`, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
}
