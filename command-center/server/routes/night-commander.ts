import { Router } from 'express';
import { nightCommander } from '../services/night-commander.js';

export const nightCommanderRouter = Router();

// GET /api/night-commander/status
nightCommanderRouter.get('/status', (_req, res) => {
  res.json(nightCommander.getStatus());
});

// GET /api/night-commander/digest
nightCommanderRouter.get('/digest', (_req, res) => {
  const digest = nightCommander.getLatestDigest();
  if (!digest) {
    res.json({ digest: null, message: 'No digest generated yet' });
    return;
  }
  res.json({ digest });
});

// POST /api/night-commander/start
nightCommanderRouter.post('/start', (_req, res) => {
  nightCommander.start();
  res.json({ status: 'started', state: nightCommander.getStatus() });
});

// POST /api/night-commander/stop
nightCommanderRouter.post('/stop', (_req, res) => {
  nightCommander.stop();
  res.json({ status: 'stopped', state: nightCommander.getStatus() });
});
