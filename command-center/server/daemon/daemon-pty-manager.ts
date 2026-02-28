/**
 * PTY session manager that runs inside the daemon process.
 * Combines: pty-manager + output-logger + session-state functionality.
 */
import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as pty from 'node-pty';
import { RingBuffer } from './ring-buffer.js';
import type { SessionInfo } from './protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Config — matches command-center/server/config.ts defaults
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '..', '..', 'data');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const RUNTIME_STATE_FILE = path.join(DATA_DIR, 'runtime-state.json');
const RING_BUFFER_MAX = 256 * 1024; // 256KB per session
const AGENTS_DIR = process.env.AGENTS_DIR || 'G:\\Lucas-Initiative\\agents';
const SESSIONS_FILE = process.env.SESSIONS_FILE || path.resolve(__dirname, '..', '..', 'sessions.json');

export interface DaemonSession {
  id: string;
  name: string;
  cwd: string;
  command: string;
  pty: pty.IPty;
  pid: number;
  createdAt: Date;
  status: 'running' | 'stopped';
  buffer: RingBuffer;
  logStream: fs.WriteStream | null;
}

type OutputCallback = (sessionId: string, data: string) => void;
type ExitCallback = (sessionId: string, exitCode: number) => void;

class DaemonPtyManager {
  private sessions = new Map<string, DaemonSession>();
  private onOutputCallbacks: OutputCallback[] = [];
  private onExitCallbacks: ExitCallback[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor() {
    // Ensure directories
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  }

  /** Register a callback for PTY output (daemon pushes to subscribed clients) */
  onOutput(cb: OutputCallback): void {
    this.onOutputCallbacks.push(cb);
  }

  /** Register a callback for PTY exit */
  onExit(cb: ExitCallback): void {
    this.onExitCallbacks.push(cb);
  }

  spawn(id: string, name: string, cwd: string, command: string = 'claude'): SessionInfo {
    if (this.sessions.has(id)) {
      const existing = this.sessions.get(id)!;
      if (existing.status === 'running') {
        throw new Error(`Session ${id} is already running`);
      }
      this.sessions.delete(id);
    }

    const shell = os.platform() === 'win32' ? 'cmd.exe' : 'bash';

    // Clean env
    const cleanEnv: Record<string, string> = {};
    for (const [key, val] of Object.entries(process.env)) {
      if (val !== undefined && !key.startsWith('CLAUDECODE')) {
        cleanEnv[key] = val;
      }
    }
    cleanEnv.FORCE_COLOR = '1';

    const shellArgs = os.platform() === 'win32' ? ['/K', 'chcp 65001'] : [];

    const ptyProcess = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: cleanEnv,
    });

    if (command) {
      setTimeout(() => {
        const fullCommand = command === 'claude'
          ? 'claude --dangerously-skip-permissions'
          : command;
        ptyProcess.write(fullCommand + '\r');
      }, 1200);
    }

    // Ring buffer — pre-fill from log file if available
    const buffer = new RingBuffer(RING_BUFFER_MAX);
    const logPath = path.join(LOGS_DIR, `${id}.log`);
    if (fs.existsSync(logPath)) {
      try {
        const stats = fs.statSync(logPath);
        const readSize = Math.min(stats.size, RING_BUFFER_MAX);
        const fd = fs.openSync(logPath, 'r');
        const buf = Buffer.alloc(readSize);
        fs.readSync(fd, buf, 0, readSize, Math.max(0, stats.size - readSize));
        fs.closeSync(fd);
        buffer.push(buf.toString('utf-8'));
        console.log(`[DaemonPTY] Pre-filled buffer for "${id}" from log (${readSize} bytes)`);
      } catch { /* ignore */ }
    }

    // Log file — rotate if > 50MB
    if (fs.existsSync(logPath)) {
      try {
        const stats = fs.statSync(logPath);
        if (stats.size > 50 * 1024 * 1024) {
          const rotated = `${logPath}.1`;
          if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
          fs.renameSync(logPath, rotated);
        }
      } catch { /* ignore */ }
    }

    const logStream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf-8' });
    logStream.write(`\n--- SESSION START ${new Date().toISOString()} ---\n`);

    const session: DaemonSession = {
      id,
      name,
      pty: ptyProcess,
      cwd,
      command,
      pid: ptyProcess.pid,
      createdAt: new Date(),
      status: 'running',
      buffer,
      logStream,
    };

    this.sessions.set(id, session);

    // Wire output
    ptyProcess.onData((data: string) => {
      buffer.push(data);
      logStream.write(data);
      for (const cb of this.onOutputCallbacks) {
        cb(id, data);
      }
    });

    // Wire exit
    ptyProcess.onExit(({ exitCode }) => {
      console.log(`[DaemonPTY] Session "${name}" (${id}) exited with code ${exitCode}`);
      const sess = this.sessions.get(id);
      if (sess) {
        sess.status = 'stopped';
        if (sess.logStream) {
          sess.logStream.write(`\n--- SESSION END ${new Date().toISOString()} ---\n`);
          sess.logStream.end();
          sess.logStream = null;
        }
        this.scheduleSave();
      }
      for (const cb of this.onExitCallbacks) {
        cb(id, exitCode);
      }
    });

    this.scheduleSave();

    console.log(`[DaemonPTY] Spawned "${name}" (${id}) in ${cwd}, PID: ${ptyProcess.pid}`);

    const info = this.toSessionInfo(session);

    // Notify sessionStarted
    for (const cb of this.onExitCallbacks) {
      // We'll use a separate mechanism for sessionStarted — handled in daemon index.ts
    }

    return info;
  }

  write(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (session && session.status === 'running') {
      session.pty.write(data);
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (session && session.status === 'running') {
      session.pty.resize(cols, rows);
    }
  }

  kill(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      console.log(`[DaemonPTY] Killing "${session.name}" (${id}), PID: ${session.pid}`);
      session.pty.kill();
      session.status = 'stopped';

      if (session.logStream) {
        session.logStream.write(`\n--- SESSION END ${new Date().toISOString()} ---\n`);
        session.logStream.end();
        session.logStream = null;
      }

      this.sessions.delete(id);
      this.scheduleSave();

      // Clear ring buffer after delay (in case of quick respawn)
      setTimeout(() => {
        if (!this.sessions.has(id)) {
          session.buffer.clear();
        }
      }, 5000);
    }
  }

  get(id: string): SessionInfo | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    return this.toSessionInfo(session);
  }

  list(): SessionInfo[] {
    return Array.from(this.sessions.values()).map(s => this.toSessionInfo(s));
  }

  isRunning(id: string): boolean {
    const session = this.sessions.get(id);
    return session?.status === 'running' || false;
  }

  getBuffer(id: string): string {
    return this.sessions.get(id)?.buffer.getAll() || '';
  }

  /** Auto-recover sessions from runtime-state.json */
  autoRecover(): void {
    let toRecover: Array<{ id: string; name: string; cwd: string; command: string }> = [];

    try {
      const data = fs.readFileSync(RUNTIME_STATE_FILE, 'utf-8');
      const state = JSON.parse(data);
      toRecover = (state.sessions || []).filter((s: any) => s.status === 'running');
    } catch {
      // No state file — try first boot from sessions.json
      try {
        const configs = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
        toRecover = configs.filter((c: any) => c.autoStart && fs.existsSync(c.cwd));
      } catch { /* no sessions.json */ }
    }

    if (toRecover.length === 0) return;

    console.log(`[DaemonPTY] Recovering ${toRecover.length} sessions...`);
    for (const sess of toRecover) {
      try {
        if (!fs.existsSync(sess.cwd)) {
          console.log(`[DaemonPTY] Skipping "${sess.id}" — cwd missing: ${sess.cwd}`);
          continue;
        }
        this.spawn(sess.id, sess.name, sess.cwd, sess.command || 'claude');
        console.log(`[DaemonPTY] Recovered "${sess.name}" (${sess.id})`);
      } catch (err: any) {
        console.error(`[DaemonPTY] Failed to recover "${sess.id}": ${err.message}`);
      }
    }
  }

  /** Save runtime state to disk (debounced) */
  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.dirty) {
        this.saveNow();
        this.dirty = false;
      }
    }, 500);
  }

  private saveNow(): void {
    const state = {
      version: 1,
      savedAt: new Date().toISOString(),
      sessions: Array.from(this.sessions.values()).map(s => ({
        id: s.id,
        name: s.name,
        cwd: s.cwd,
        command: s.command,
        spawnedAt: s.createdAt.toISOString(),
        status: s.status,
      })),
    };
    try {
      fs.writeFileSync(RUNTIME_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err: any) {
      console.error(`[DaemonPTY] Failed to save state: ${err.message}`);
    }
  }

  shutdown(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveNow();

    // Close all log streams
    for (const session of this.sessions.values()) {
      if (session.logStream) {
        session.logStream.write(`\n--- DAEMON SHUTDOWN ${new Date().toISOString()} ---\n`);
        session.logStream.end();
        session.logStream = null;
      }
    }
  }

  private toSessionInfo(s: DaemonSession): SessionInfo {
    return {
      id: s.id,
      name: s.name,
      cwd: s.cwd,
      command: s.command,
      pid: s.pid,
      status: s.status,
      createdAt: s.createdAt.toISOString(),
    };
  }
}

export const daemonPtyManager = new DaemonPtyManager();
