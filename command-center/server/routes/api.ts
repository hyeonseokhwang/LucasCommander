import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { ptyManager } from '../services/pty-manager.js';
import { config } from '../config.js';
import { workerLifecycle } from '../services/worker-lifecycle.js';
import { approvalQueue } from '../services/approval-queue.js';
import { outputLogger } from '../services/output-logger.js';
import { claudeUsageMonitor } from '../services/claude-usage-monitor.js';

export const apiRouter = Router();

// Inbox directory for UTF-8 file-based messaging (avoids PTY encoding issues on Windows)
const inboxDir = path.join(config.coordinationDir, 'inbox');
if (!fs.existsSync(inboxDir)) fs.mkdirSync(inboxDir, { recursive: true });

interface SessionConfig {
  id: string;
  name: string;
  cwd: string;
  command: string;
  autoStart: boolean;
  color: string;
}

function loadSessionConfigs(): SessionConfig[] {
  try {
    const data = fs.readFileSync(config.sessionsFile, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// Health check
apiRouter.get('/health', (_req, res) => {
  const active = ptyManager.list();
  res.json({
    status: 'ok',
    activeSessions: active.length,
    uptime: process.uptime(),
  });
});

// Debug: check replay buffer sizes
apiRouter.get('/debug/buffers', (_req, res) => {
  const active = ptyManager.list();
  const buffers = active.map(s => ({
    id: s.id,
    name: s.name,
    bufferSize: outputLogger.getBuffer(s.id).length,
    bufferPreview: outputLogger.getBuffer(s.id).slice(0, 200),
  }));
  res.json(buffers);
});

// List session configs
apiRouter.get('/sessions', (_req, res) => {
  const configs = loadSessionConfigs();
  const active = ptyManager.list();
  const activeIds = new Set(active.map(s => s.id));

  const sessions = configs.map(c => ({
    ...c,
    running: activeIds.has(c.id),
    pid: active.find(a => a.id === c.id)?.pid,
  }));

  res.json(sessions);
});

// List active sessions
apiRouter.get('/sessions/active', (_req, res) => {
  res.json(ptyManager.list());
});

// Spawn a session
apiRouter.post('/sessions/:id/spawn', (req, res) => {
  const { id } = req.params;
  const configs = loadSessionConfigs();
  const sessionConfig = configs.find(c => c.id === id);

  if (!sessionConfig) {
    res.status(404).json({ error: `Session config "${id}" not found` });
    return;
  }

  if (ptyManager.isRunning(id)) {
    res.status(409).json({ error: `Session "${id}" is already running` });
    return;
  }

  // Verify cwd exists
  if (!fs.existsSync(sessionConfig.cwd)) {
    res.status(400).json({ error: `Working directory "${sessionConfig.cwd}" does not exist` });
    return;
  }

  try {
    const session = ptyManager.spawn(
      id,
      sessionConfig.name,
      sessionConfig.cwd,
      sessionConfig.command || 'claude'
    );

    res.json({
      id: session.id,
      name: session.name,
      pid: session.pid,
      cwd: session.cwd,
      status: session.status,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Kill a session
apiRouter.post('/sessions/:id/kill', (req, res) => {
  const { id } = req.params;

  if (!ptyManager.isRunning(id)) {
    res.status(404).json({ error: `Session "${id}" is not running` });
    return;
  }

  ptyManager.kill(id);
  res.json({ id, status: 'killed' });
});

// Worker report → Commander prompt injection (file-based for Korean encoding safety)
apiRouter.post('/report', (req, res) => {
  const { worker, report, needsUserDecision, type, payload } = req.body;
  if (!worker || !report) {
    res.status(400).json({ error: 'worker and report are required' });
    return;
  }

  // Handle worker-request type from Commander
  if (type === 'worker-request' && payload) {
    const request = approvalQueue.addRequest({
      type: 'create',
      reason: report,
      count: payload.count || 1,
      missions: payload.missions || [],
      targetProject: payload.targetProject,
    });
    res.json({ status: 'pending_approval', requestId: request.requestId });
    return;
  }

  // Handle worker-cleanup type from Commander
  if (type === 'worker-cleanup' && payload?.workerId) {
    const request = approvalQueue.addRequest({
      type: 'cleanup',
      reason: report,
      count: 1,
      missions: [payload.workerId],
    });
    res.json({ status: 'pending_approval', requestId: request.requestId });
    return;
  }

  // Save report to UTF-8 file (guaranteed encoding)
  const msgId = Date.now();
  const msgFile = `report-${worker}-${msgId}.md`;
  const msgPath = path.join(inboxDir, msgFile);
  const fileContent = [
    `# Report from ${worker}`,
    `> ${new Date().toISOString()}`,
    needsUserDecision ? '> **USER DECISION NEEDED**' : '',
    '',
    report,
  ].filter(Boolean).join('\n');
  fs.writeFileSync(msgPath, fileContent, 'utf-8');

  // Find commander session
  const commanderId = 'commander';
  if (!ptyManager.isRunning(commanderId)) {
    const reportLog = {
      timestamp: new Date().toISOString(),
      worker,
      report,
      needsUserDecision: needsUserDecision || false,
      delivered: false,
      file: msgFile,
    };
    pendingReports.push(reportLog);
    res.json({ status: 'queued', message: 'Commander not running. Report queued.', file: msgFile });
    return;
  }

  // Inject ASCII-only notification into commander PTY (no Korean through PTY)
  const prefix = needsUserDecision ? '[ALERT - USER DECISION NEEDED]' : '[WORKER REPORT]';
  const inboxRelPath = `.coordination/inbox/${msgFile}`;
  const notification = `${prefix} from ${worker}. Read file: ${inboxRelPath}`;
  ptyManager.write(commanderId, notification);
  setTimeout(() => ptyManager.write(commanderId, '\r'), 50);

  logReport(worker, report, needsUserDecision, msgFile);

  res.json({ status: 'delivered', message: 'Report sent to Commander.', file: msgFile });
});

// Commander sends instruction to a worker (file-based for Korean encoding safety)
apiRouter.post('/instruct', (req, res) => {
  const { worker, instruction } = req.body;
  if (!worker || !instruction) {
    res.status(400).json({ error: 'worker and instruction are required' });
    return;
  }

  if (!ptyManager.isRunning(worker)) {
    res.status(404).json({ error: `Worker "${worker}" is not running` });
    return;
  }

  // Save instruction to UTF-8 file (guaranteed encoding)
  const msgId = Date.now();
  const msgFile = `instruct-${worker}-${msgId}.md`;
  const msgPath = path.join(inboxDir, msgFile);
  const fileContent = [
    `# Instruction from Commander`,
    `> ${new Date().toISOString()}`,
    `> To: ${worker}`,
    '',
    instruction,
  ].join('\n');
  fs.writeFileSync(msgPath, fileContent, 'utf-8');

  // Inject ASCII-only notification into worker PTY (no Korean through PTY)
  const inboxRelPath = `.coordination/inbox/${msgFile}`;
  const notification = `[COMMANDER INSTRUCTION] Read file: ${inboxRelPath}`;
  ptyManager.write(worker, notification);
  setTimeout(() => ptyManager.write(worker, '\r'), 50);

  logInstruction(worker, instruction, msgFile);

  res.json({ status: 'delivered', message: `Instruction sent to ${worker}.`, file: msgFile });
});

// Get report/instruction history
apiRouter.get('/reports', (_req, res) => {
  res.json({ pending: pendingReports, history: reportHistory });
});

// Read a specific inbox message by filename
apiRouter.get('/messages/:filename', (req, res) => {
  const { filename } = req.params;
  // Sanitize: only allow alphanumeric, dash, dot
  if (!/^[\w\-\.]+$/.test(filename)) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }
  const msgPath = path.join(inboxDir, filename);
  if (!fs.existsSync(msgPath)) {
    res.status(404).json({ error: 'Message not found' });
    return;
  }
  const content = fs.readFileSync(msgPath, 'utf-8');
  res.type('text/plain; charset=utf-8').send(content);
});

// Claude usage monitoring
apiRouter.get('/claude-usage', (_req, res) => {
  if (claudeUsageMonitor.latest) {
    res.json(claudeUsageMonitor.latest);
  } else {
    res.json({ error: 'No usage data yet. Monitor may still be initializing.' });
  }
});

// Force refresh Claude usage
apiRouter.post('/claude-usage/refresh', async (_req, res) => {
  await claudeUsageMonitor.poll();
  res.json(claudeUsageMonitor.latest);
});

// Pending reports queue & history
const pendingReports: any[] = [];
const reportHistory: any[] = [];

function logReport(worker: string, report: string, needsUserDecision: boolean, file?: string) {
  const entry = {
    type: 'report',
    timestamp: new Date().toISOString(),
    worker,
    report,
    needsUserDecision,
    file: file || null,
  };
  reportHistory.push(entry);

  // Persist to file
  const logDir = path.join(config.coordinationDir, 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(
    path.join(logDir, 'reports.jsonl'),
    JSON.stringify(entry) + '\n',
    'utf-8'
  );
}

function logInstruction(worker: string, instruction: string, file?: string) {
  const entry = {
    type: 'instruction',
    timestamp: new Date().toISOString(),
    worker,
    instruction,
    file: file || null,
  };
  reportHistory.push(entry);

  const logDir = path.join(config.coordinationDir, 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(
    path.join(logDir, 'reports.jsonl'),
    JSON.stringify(entry) + '\n',
    'utf-8'
  );
}

// Add a new session config
apiRouter.post('/sessions', (req, res) => {
  const { id, name, cwd, command, color } = req.body;
  if (!id || !name || !cwd) {
    res.status(400).json({ error: 'id, name, and cwd are required' });
    return;
  }

  const configs = loadSessionConfigs();
  if (configs.find(c => c.id === id)) {
    res.status(409).json({ error: `Session "${id}" already exists` });
    return;
  }

  const newConfig: SessionConfig = {
    id,
    name,
    cwd,
    command: command || 'claude',
    autoStart: false,
    color: color || '#94a3b8',
  };

  configs.push(newConfig);
  fs.writeFileSync(config.sessionsFile, JSON.stringify(configs, null, 2));
  res.status(201).json(newConfig);
});

// ===== Dynamic Worker Management =====

// Create a new dynamic worker
apiRouter.post('/workers', async (req, res) => {
  const { mission, targetProject, autoSpawn } = req.body;
  try {
    const result = await workerLifecycle.create({
      mission,
      targetProject,
      autoSpawn: autoSpawn ?? true,
      requestedBy: 'ui',
    });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Delete a worker
apiRouter.delete('/workers/:id', async (req, res) => {
  const { id } = req.params;
  const { archive } = req.body || {};
  try {
    await workerLifecycle.delete(id, { archive: archive ?? true });
    res.json({ id, status: 'deleted' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// List all workers with status
apiRouter.get('/workers', (_req, res) => {
  res.json(workerLifecycle.list());
});

// Get pending worker requests
apiRouter.get('/workers/requests', (_req, res) => {
  res.json(approvalQueue.getAll());
});

// Approve a worker request
apiRouter.post('/workers/requests/:requestId/approve', async (req, res) => {
  try {
    const result = await approvalQueue.approve(req.params.requestId);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Deny a worker request
apiRouter.post('/workers/requests/:requestId/deny', async (req, res) => {
  try {
    const result = await approvalQueue.deny(req.params.requestId);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
