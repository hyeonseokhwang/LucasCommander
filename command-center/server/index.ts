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
import { outputLogger } from './services/output-logger.js';
import { sessionState } from './services/session-state.js';
import { ptyManager } from './services/pty-manager.js';
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

// --- Auto-recovery: restore previously running sessions ---
function autoRecover() {
  const toRecover = sessionState.loadState();
  if (toRecover.length > 0) {
    console.log(`[Recovery] Restoring ${toRecover.length} previously running sessions...`);
    for (const sess of toRecover) {
      try {
        if (!fs.existsSync(sess.cwd)) {
          console.log(`[Recovery] Skipping "${sess.id}" - cwd missing: ${sess.cwd}`);
          continue;
        }
        ptyManager.spawn(sess.id, sess.name, sess.cwd, sess.command);
        console.log(`[Recovery] Restored "${sess.name}" (${sess.id})`);
      } catch (err: any) {
        console.error(`[Recovery] Failed "${sess.id}": ${err.message}`);
      }
    }
  } else {
    // First boot: check autoStart in sessions.json
    try {
      const configs = JSON.parse(fs.readFileSync(config.sessionsFile, 'utf-8'));
      for (const cfg of configs) {
        if (cfg.autoStart && fs.existsSync(cfg.cwd)) {
          try {
            ptyManager.spawn(cfg.id, cfg.name, cfg.cwd, cfg.command || 'claude');
            console.log(`[AutoStart] Spawned "${cfg.name}"`);
          } catch (err: any) {
            console.error(`[AutoStart] Failed "${cfg.id}": ${err.message}`);
          }
        }
      }
    } catch { /* no sessions.json or parse error */ }
  }
}

// --- Graceful shutdown ---
function gracefulShutdown(signal: string) {
  console.log(`\n[Shutdown] ${signal} received, saving state...`);
  sessionState.shutdown();
  outputLogger.shutdown();
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

httpServer.listen(config.port, config.host, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║   Lucas Command Center                   ║');
  console.log(`  ║   http://localhost:${config.port}                  ║`);
  console.log('  ║   Ready for session orchestration         ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');

  autoRecover();
});
