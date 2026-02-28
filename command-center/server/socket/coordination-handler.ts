import type { Namespace } from 'socket.io';
import { coordinationParser } from '../services/coordination-parser.js';
import { approvalQueue } from '../services/approval-queue.js';
import { inboxWatcher } from '../services/inbox-watcher.js';

export function setupCoordinationNamespace(nsp: Namespace) {
  // Give approval queue access to this namespace for real-time events
  approvalQueue.setNamespace(nsp);

  // Set onChange to push to all clients
  coordinationParser.setOnChange((state) => {
    nsp.emit('update', state);
  });

  // Real-time inbox notifications
  inboxWatcher.onMessage((msg) => {
    nsp.emit('inbox-message', msg);
  });

  nsp.on('connection', (socket) => {
    // Send current state immediately on connect
    const state = coordinationParser.getState();
    if (state) {
      socket.emit('update', state);
    }

    // Send pending worker requests on connect
    const pending = approvalQueue.getPending();
    if (pending.length > 0) {
      for (const req of pending) {
        socket.emit('worker-request', req);
      }
    }
  });
}
