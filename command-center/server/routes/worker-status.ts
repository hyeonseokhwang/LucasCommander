import { Router } from 'express';
import { coordinationParser } from '../services/coordination-parser.js';

export const workerStatusRouter = Router();

// Get detailed worker status data (enhanced coordination state)
workerStatusRouter.get('/details', (_req, res) => {
  const state = coordinationParser.getState();
  if (!state) {
    res.json({ workers: [], lastParsed: null });
    return;
  }
  res.json({
    workers: state.workers,
    lastParsed: state.lastParsed,
  });
});

// Get MASTER.md raw content + parsed metadata
workerStatusRouter.get('/master-doc', (_req, res) => {
  const state = coordinationParser.getState();
  if (!state) {
    res.json({ rawContent: '', lastUpdated: '', sessionTable: [], phases: [], prohibitions: [] });
    return;
  }
  res.json({
    rawContent: state.master.rawContent,
    lastUpdated: state.master.lastUpdated,
    sessionCount: state.master.sessionCount,
    sessionTable: state.master.sessionTable,
    phases: state.master.phases,
    prohibitions: state.master.prohibitions,
  });
});
