import type { Namespace } from 'socket.io';
import { systemMonitor } from '../services/system-monitor.js';
import { claudeUsageMonitor } from '../services/claude-usage-monitor.js';

export function setupMonitorNamespace(nsp: Namespace) {
  // Set broadcaster to push to all clients
  systemMonitor.setBroadcaster((data) => {
    nsp.emit('metrics', data);
  });

  // Claude usage broadcaster
  claudeUsageMonitor.setBroadcaster((data) => {
    nsp.emit('claude-usage', data);
  });

  nsp.on('connection', (socket) => {
    // Send latest snapshot immediately on connect
    if (systemMonitor.latest) {
      socket.emit('metrics', systemMonitor.latest);
    }
    if (claudeUsageMonitor.latest) {
      socket.emit('claude-usage', claudeUsageMonitor.latest);
    }
  });
}
