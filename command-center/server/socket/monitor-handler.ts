import type { Namespace } from 'socket.io';
import { systemMonitor } from '../services/system-monitor.js';

export function setupMonitorNamespace(nsp: Namespace) {
  // Set broadcaster to push to all clients
  systemMonitor.setBroadcaster((data) => {
    nsp.emit('metrics', data);
  });

  nsp.on('connection', (socket) => {
    // Send latest snapshot immediately on connect
    if (systemMonitor.latest) {
      socket.emit('metrics', systemMonitor.latest);
    }
  });
}
