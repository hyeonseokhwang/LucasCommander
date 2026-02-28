import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { config } from './config.js';
import { apiRouter } from './routes/api.js';
import { workerStatusRouter } from './routes/worker-status.js';
import { nightCommanderRouter } from './routes/night-commander.js';
import { tasksRouter } from './routes/tasks.js';
import { policyRouter } from './routes/policy.js';
import { setupTerminalNamespace } from './socket/terminal-handler.js';
import { setupMonitorNamespace } from './socket/monitor-handler.js';
import { setupCoordinationNamespace } from './socket/coordination-handler.js';
import { systemMonitor } from './services/system-monitor.js';
import { claudeUsageMonitor } from './services/claude-usage-monitor.js';
import { coordinationParser } from './services/coordination-parser.js';
import { ptyClient } from './services/pty-client.js';
import { telegramNotifier } from './services/telegram-notifier.js';

const app = express();
const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e6,
});

app.use(cors());
app.use(express.json());
app.use('/api', apiRouter);
app.use('/api/worker-status', workerStatusRouter);
app.use('/api/night-commander', nightCommanderRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/policy', policyRouter);

// Setup socket.io namespaces
setupTerminalNamespace(io.of('/terminal'));
setupMonitorNamespace(io.of('/monitor'));
setupCoordinationNamespace(io.of('/coordination'));

// Start background services
systemMonitor.startPolling(config.monitorInterval);
claudeUsageMonitor.startPolling(180_000); // 3 minutes
coordinationParser.startWatching();

// Serve frontend static files (production build)
if (fs.existsSync(config.frontendDist)) {
  app.use(express.static(config.frontendDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(config.frontendDist, 'index.html'));
  });
}

// --- Graceful shutdown ---
function gracefulShutdown(signal: string) {
  console.log(`\n[Shutdown] ${signal} received`);
  ptyClient.disconnect();
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// --- Start: connect to daemon then listen ---
async function start() {
  // Connect to PTY Daemon (auto-reconnects if daemon isn't up yet)
  await ptyClient.connect();

  if (ptyClient.isConnected()) {
    console.log(`[Server] Connected to PTY Daemon at ${config.daemonHost}:${config.daemonPort}`);
  } else {
    console.log(`[Server] PTY Daemon not available — will auto-reconnect when it starts`);
  }

  httpServer.listen(config.port, config.host, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════╗');
    console.log('  ║   Lucas Command Center                   ║');
    console.log(`  ║   http://localhost:${config.port}                  ║`);
    console.log('  ║   Ready for session orchestration         ║');
    console.log('  ╚══════════════════════════════════════════╝');
    console.log('');
  });
}

start().catch((err) => {
  console.error('[Server] Failed to start:', err);
  process.exit(1);
});
