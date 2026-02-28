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
};
