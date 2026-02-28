import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: parseInt(process.env.PORT || '9000'),
  host: '0.0.0.0',
  coordinationDir: process.env.COORDINATION_DIR || 'G:\\Lucas-Initiative\\.coordination',
  sessionsFile: path.join(__dirname, '..', 'sessions.json'),
  frontendDist: path.join(__dirname, '..', 'frontend', 'dist'),
  monitorInterval: 3000,
  coordinationDebounce: 500,

  // Persistence
  dataDir: path.join(__dirname, '..', 'data'),
  logsDir: path.join(__dirname, '..', 'data', 'logs'),
  runtimeStateFile: path.join(__dirname, '..', 'data', 'runtime-state.json'),
  ringBufferMaxBytes: 256 * 1024, // 256KB per session

  // Worker pool
  maxWorkers: 12,
  agentsDir: 'G:\\Lucas-Initiative\\agents',
  agentsArchiveDir: 'G:\\Lucas-Initiative\\agents\\_archive',
  workerRequestsFile: path.join(__dirname, '..', 'data', 'worker-requests.json'),
};
