import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { config } from './config.js';
import { apiRouter } from './routes/api.js';
import { setupTerminalNamespace } from './socket/terminal-handler.js';
import { setupMonitorNamespace } from './socket/monitor-handler.js';
import { setupCoordinationNamespace } from './socket/coordination-handler.js';
import { systemMonitor } from './services/system-monitor.js';
import { coordinationParser } from './services/coordination-parser.js';

const app = express();
const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e6,
});

app.use(cors());
app.use(express.json());
app.use('/api', apiRouter);

// Setup socket.io namespaces
setupTerminalNamespace(io.of('/terminal'));
setupMonitorNamespace(io.of('/monitor'));
setupCoordinationNamespace(io.of('/coordination'));

// Start background services
systemMonitor.startPolling(config.monitorInterval);
coordinationParser.startWatching();

// Serve frontend static files (production build)
if (fs.existsSync(config.frontendDist)) {
  app.use(express.static(config.frontendDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(config.frontendDist, 'index.html'));
  });
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
