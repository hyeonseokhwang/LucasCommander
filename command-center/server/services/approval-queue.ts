import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { workerLifecycle } from './worker-lifecycle.js';
import { ptyClient } from './pty-client.js';
import type { Namespace } from 'socket.io';

export interface WorkerRequest {
  requestId: string;
  type: 'create' | 'cleanup';
  reason: string;
  count: number;
  missions: string[];
  targetProject?: string;
  status: 'pending' | 'approved' | 'denied';
  requestedAt: string;
  resolvedAt?: string;
  createdWorkers?: string[];
}

class ApprovalQueue {
  private requests: WorkerRequest[] = [];
  private coordinationNsp: Namespace | null = null;

  constructor() {
    this.load();
  }

  setNamespace(nsp: Namespace): void {
    this.coordinationNsp = nsp;
  }

  private load(): void {
    try {
      const data = fs.readFileSync(config.workerRequestsFile, 'utf-8');
      this.requests = JSON.parse(data);
    } catch {
      this.requests = [];
    }
  }

  private save(): void {
    const dir = path.dirname(config.workerRequestsFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(config.workerRequestsFile, JSON.stringify(this.requests, null, 2), 'utf-8');
  }

  addRequest(req: Omit<WorkerRequest, 'requestId' | 'status' | 'requestedAt'>): WorkerRequest {
    const request: WorkerRequest = {
      ...req,
      requestId: `wr-${Date.now()}`,
      status: 'pending',
      requestedAt: new Date().toISOString(),
    };
    this.requests.push(request);
    this.save();

    // Push to frontend
    if (this.coordinationNsp) {
      this.coordinationNsp.emit('worker-request', request);
    }

    console.log(`[ApprovalQueue] New request ${request.requestId}: ${request.reason}`);
    return request;
  }

  async approve(requestId: string): Promise<WorkerRequest> {
    const req = this.requests.find(r => r.requestId === requestId);
    if (!req) throw new Error(`Request "${requestId}" not found`);
    if (req.status !== 'pending') throw new Error(`Request already ${req.status}`);

    if (req.type === 'cleanup') {
      // Cleanup: delete/archive workers listed in missions
      const deletedWorkers: string[] = [];
      for (const workerId of req.missions) {
        try {
          await workerLifecycle.delete(workerId, { archive: true });
          deletedWorkers.push(workerId);
        } catch (err: any) {
          console.error(`[ApprovalQueue] Failed to delete ${workerId}: ${err.message}`);
        }
      }

      req.status = 'approved';
      req.resolvedAt = new Date().toISOString();
      req.createdWorkers = deletedWorkers; // reuse field to track affected workers
      this.save();

      // Notify Commander via PTY
      const commanderId = 'commander';
      if (ptyClient.isRunning(commanderId)) {
        const msg = `[WORKER CLEANUP APPROVED] Workers deleted: ${deletedWorkers.join(', ')}.`;
        ptyClient.write(commanderId, msg);
        setTimeout(() => ptyClient.write(commanderId, '\r'), 50);
      }

      // Push to frontend
      if (this.coordinationNsp) {
        this.coordinationNsp.emit('worker-request-resolved', req);
      }

      console.log(`[ApprovalQueue] Approved cleanup ${requestId}: deleted ${deletedWorkers.join(', ')}`);
      return req;
    }

    // Create: spawn new workers (graceful partial — don't throw on individual failure)
    const createdWorkers: string[] = [];

    for (let i = 0; i < req.count; i++) {
      const mission = req.missions[i] || undefined;
      try {
        const result = await workerLifecycle.create({
          mission,
          targetProject: req.targetProject,
          autoSpawn: true,
          requestedBy: 'commander',
        });
        createdWorkers.push(result.id);
      } catch (err: any) {
        console.error(`[ApprovalQueue] Failed to create worker ${i + 1}/${req.count}: ${err.message}`);
      }
    }

    req.status = 'approved';
    req.resolvedAt = new Date().toISOString();
    req.createdWorkers = createdWorkers;
    this.save();

    // Notify Commander via PTY
    const commanderId = 'commander';
    if (ptyClient.isRunning(commanderId)) {
      const msg = `[WORKER REQUEST APPROVED] Workers created: ${createdWorkers.join(', ')}. Missions assigned via inbox.`;
      ptyClient.write(commanderId, msg);
      setTimeout(() => ptyClient.write(commanderId, '\r'), 50);
    }

    // Push to frontend
    if (this.coordinationNsp) {
      this.coordinationNsp.emit('worker-request-resolved', req);
    }

    console.log(`[ApprovalQueue] Approved ${requestId}: created ${createdWorkers.join(', ')}`);
    return req;
  }

  async deny(requestId: string): Promise<WorkerRequest> {
    const req = this.requests.find(r => r.requestId === requestId);
    if (!req) throw new Error(`Request "${requestId}" not found`);
    if (req.status !== 'pending') throw new Error(`Request already ${req.status}`);

    req.status = 'denied';
    req.resolvedAt = new Date().toISOString();
    this.save();

    // Notify Commander via PTY
    const commanderId = 'commander';
    if (ptyClient.isRunning(commanderId)) {
      const msg = `[WORKER REQUEST DENIED] requestId: ${requestId}. User denied the request.`;
      ptyClient.write(commanderId, msg);
      setTimeout(() => ptyClient.write(commanderId, '\r'), 50);
    }

    if (this.coordinationNsp) {
      this.coordinationNsp.emit('worker-request-resolved', req);
    }

    console.log(`[ApprovalQueue] Denied ${requestId}`);
    return req;
  }

  getPending(): WorkerRequest[] {
    return this.requests.filter(r => r.status === 'pending');
  }

  getAll(): WorkerRequest[] {
    return this.requests;
  }

  getById(requestId: string): WorkerRequest | undefined {
    return this.requests.find(r => r.requestId === requestId);
  }
}

export const approvalQueue = new ApprovalQueue();
