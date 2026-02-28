import type { Namespace } from 'socket.io';
import { coordinationParser } from '../services/coordination-parser.js';

export function setupCoordinationNamespace(nsp: Namespace) {
  // Set onChange to push to all clients
  coordinationParser.setOnChange((state) => {
    nsp.emit('update', state);
  });

  nsp.on('connection', (socket) => {
    // Send current state immediately on connect
    const state = coordinationParser.getState();
    if (state) {
      socket.emit('update', state);
    }
  });
}
