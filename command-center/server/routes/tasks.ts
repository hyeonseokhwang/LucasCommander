import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { ptyClient } from '../services/pty-client.js';

export const tasksRouter = Router();

// ===== Types =====

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  assignedTo: string | null;
  assignedAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  createdBy: string;           // 'commander' | 'night-commander' | 'ui' | worker id
  targetProject?: string;
  tags: string[];
  result?: string;             // completion result or failure reason
  parentTaskId?: string;       // for subtasks
}

interface TaskQueue {
  version: number;
  lastUpdated: string;
  tasks: Task[];
  completedTasks: Task[];
  stats: {
    totalCreated: number;
    totalCompleted: number;
    totalFailed: number;
    totalCancelled: number;
  };
}

// ===== Persistence =====

const TASK_QUEUE_FILE = path.join(config.dataDir, 'task-queue.json');

function loadQueue(): TaskQueue {
  try {
    const data = fs.readFileSync(TASK_QUEUE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {
      version: 1,
      lastUpdated: new Date().toISOString(),
      tasks: [],
      completedTasks: [],
      stats: { totalCreated: 0, totalCompleted: 0, totalFailed: 0, totalCancelled: 0 },
    };
  }
}

function saveQueue(queue: TaskQueue): void {
  queue.lastUpdated = new Date().toISOString();
  const dir = path.dirname(TASK_QUEUE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TASK_QUEUE_FILE, JSON.stringify(queue, null, 2), 'utf-8');
}

// ===== API Routes =====

// GET /api/tasks — list all tasks (optionally filter by status, assignedTo, priority)
tasksRouter.get('/', (req, res) => {
  const queue = loadQueue();
  let tasks = [...queue.tasks];

  const { status, assignedTo, priority, includeCompleted } = req.query;

  if (status) {
    tasks = tasks.filter(t => t.status === status);
  }
  if (assignedTo) {
    tasks = tasks.filter(t => t.assignedTo === assignedTo);
  }
  if (priority) {
    tasks = tasks.filter(t => t.priority === priority);
  }

  const result: any = {
    tasks,
    stats: queue.stats,
    lastUpdated: queue.lastUpdated,
  };

  if (includeCompleted === 'true') {
    result.completedTasks = queue.completedTasks.slice(-50); // last 50
  }

  res.json(result);
});

// GET /api/tasks/pending — get unassigned pending tasks (for auto-assignment)
tasksRouter.get('/pending', (_req, res) => {
  const queue = loadQueue();
  const pending = queue.tasks
    .filter(t => t.status === 'pending' && !t.assignedTo)
    .sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  res.json(pending);
});

// POST /api/tasks — create a new task
tasksRouter.post('/', (req, res) => {
  const { title, description, priority, createdBy, targetProject, tags, parentTaskId } = req.body;

  if (!title) {
    res.status(400).json({ error: 'title is required' });
    return;
  }

  const queue = loadQueue();
  const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();

  const task: Task = {
    id,
    title,
    description: description || '',
    priority: priority || 'normal',
    status: 'pending',
    assignedTo: null,
    assignedAt: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    createdBy: createdBy || 'ui',
    targetProject: targetProject || undefined,
    tags: tags || [],
    parentTaskId: parentTaskId || undefined,
  };

  queue.tasks.push(task);
  queue.stats.totalCreated++;
  saveQueue(queue);

  res.status(201).json(task);
});

// PATCH /api/tasks/:id — update a task (status, priority, description, result)
tasksRouter.patch('/:id', (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  const queue = loadQueue();
  const task = queue.tasks.find(t => t.id === id);

  if (!task) {
    res.status(404).json({ error: `Task "${id}" not found` });
    return;
  }

  const now = new Date().toISOString();

  if (updates.status) task.status = updates.status;
  if (updates.priority) task.priority = updates.priority;
  if (updates.description !== undefined) task.description = updates.description;
  if (updates.title) task.title = updates.title;
  if (updates.result !== undefined) task.result = updates.result;
  if (updates.tags) task.tags = updates.tags;
  task.updatedAt = now;

  // Move to completedTasks if terminal status
  if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
    task.completedAt = now;
    queue.tasks = queue.tasks.filter(t => t.id !== id);
    queue.completedTasks.push(task);

    // Keep only last 200 completed tasks
    if (queue.completedTasks.length > 200) {
      queue.completedTasks = queue.completedTasks.slice(-200);
    }

    if (task.status === 'completed') queue.stats.totalCompleted++;
    if (task.status === 'failed') queue.stats.totalFailed++;
    if (task.status === 'cancelled') queue.stats.totalCancelled++;
  }

  saveQueue(queue);
  res.json(task);
});

// POST /api/tasks/:id/assign — assign a task to a worker
tasksRouter.post('/:id/assign', (req, res) => {
  const { id } = req.params;
  const { workerId, sendInstruction } = req.body;

  if (!workerId) {
    res.status(400).json({ error: 'workerId is required' });
    return;
  }

  const queue = loadQueue();
  const task = queue.tasks.find(t => t.id === id);

  if (!task) {
    res.status(404).json({ error: `Task "${id}" not found` });
    return;
  }

  if (task.status !== 'pending') {
    res.status(409).json({ error: `Task is already ${task.status}` });
    return;
  }

  const now = new Date().toISOString();
  task.assignedTo = workerId;
  task.assignedAt = now;
  task.status = 'assigned';
  task.updatedAt = now;
  saveQueue(queue);

  // Optionally send instruction to the worker via inbox
  if (sendInstruction !== false) {
    const instruction = [
      `## 태스크 배정: ${task.title}`,
      '',
      `- Task ID: ${task.id}`,
      `- Priority: ${task.priority}`,
      task.targetProject ? `- Target: ${task.targetProject}` : '',
      '',
      task.description,
      '',
      '완료 후 보고해라. report에 task ID를 포함해라.',
    ].filter(Boolean).join('\n');

    const inboxDir = path.join(config.coordinationDir, 'inbox');
    if (!fs.existsSync(inboxDir)) fs.mkdirSync(inboxDir, { recursive: true });
    const msgId = Date.now();
    const msgFile = `instruct-${workerId}-${msgId}.md`;
    const msgPath = path.join(inboxDir, msgFile);
    const fileContent = `# Instruction from Commander\n> ${now}\n> To: ${workerId}\n\n${instruction}`;
    fs.writeFileSync(msgPath, fileContent, 'utf-8');

    // Inject ASCII notification into worker PTY
    if (ptyClient.isRunning(workerId)) {
      const notification = `[COMMANDER INSTRUCTION] Read file: .coordination/inbox/${msgFile}`;
      ptyClient.write(workerId, notification);
      setTimeout(() => ptyClient.write(workerId, '\r'), 50);
    }
  }

  res.json({ task, instructionSent: sendInstruction !== false });
});

// ===== Exported helpers for night-commander =====

export function getIdleWorkers(): string[] {
  const queue = loadQueue();
  const busyWorkers = new Set(
    queue.tasks.filter(t => t.status === 'assigned' || t.status === 'in_progress').map(t => t.assignedTo)
  );

  const active = ptyClient.list();
  return active
    .filter(s => s.id !== 'commander' && s.status === 'running' && !busyWorkers.has(s.id))
    .map(s => s.id);
}

export function getPendingTasks(): Task[] {
  const queue = loadQueue();
  return queue.tasks
    .filter(t => t.status === 'pending' && !t.assignedTo)
    .sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
}

export function assignTaskInternal(taskId: string, workerId: string): Task | null {
  const queue = loadQueue();
  const task = queue.tasks.find(t => t.id === taskId);
  if (!task || task.status !== 'pending') return null;

  const now = new Date().toISOString();
  task.assignedTo = workerId;
  task.assignedAt = now;
  task.status = 'assigned';
  task.updatedAt = now;
  saveQueue(queue);

  // Send instruction via inbox
  const instruction = [
    `## 태스크 배정: ${task.title}`,
    '',
    `- Task ID: ${task.id}`,
    `- Priority: ${task.priority}`,
    task.targetProject ? `- Target: ${task.targetProject}` : '',
    '',
    task.description,
    '',
    '완료 후 보고해라. report에 task ID를 포함해라.',
  ].filter(Boolean).join('\n');

  const inboxDir = path.join(config.coordinationDir, 'inbox');
  if (!fs.existsSync(inboxDir)) fs.mkdirSync(inboxDir, { recursive: true });
  const msgId = Date.now();
  const msgFile = `instruct-${workerId}-${msgId}.md`;
  const msgPath = path.join(inboxDir, msgFile);
  fs.writeFileSync(msgPath, `# Instruction from Commander\n> ${now}\n> To: ${workerId}\n\n${instruction}`, 'utf-8');

  if (ptyClient.isRunning(workerId)) {
    const notification = `[COMMANDER INSTRUCTION] Read file: .coordination/inbox/${msgFile}`;
    ptyClient.write(workerId, notification);
    setTimeout(() => ptyClient.write(workerId, '\r'), 50);
  }

  return task;
}

export function createTaskInternal(title: string, description: string, options: {
  priority?: Task['priority'];
  createdBy?: string;
  targetProject?: string;
  tags?: string[];
} = {}): Task {
  const queue = loadQueue();
  const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();

  const task: Task = {
    id,
    title,
    description,
    priority: options.priority || 'normal',
    status: 'pending',
    assignedTo: null,
    assignedAt: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    createdBy: options.createdBy || 'night-commander',
    targetProject: options.targetProject,
    tags: options.tags || [],
  };

  queue.tasks.push(task);
  queue.stats.totalCreated++;
  saveQueue(queue);

  return task;
}
