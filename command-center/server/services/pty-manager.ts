import os from 'os';
import * as pty from 'node-pty';
import { outputLogger } from './output-logger.js';
import { sessionState } from './session-state.js';

export interface TerminalSession {
  id: string;
  name: string;
  pty: pty.IPty;
  cwd: string;
  command: string;
  pid: number;
  createdAt: Date;
  status: 'running' | 'stopped';
}

class PtyManager {
  private sessions: Map<string, TerminalSession> = new Map();

  spawn(id: string, name: string, cwd: string, command: string = 'claude'): TerminalSession {
    if (this.sessions.has(id)) {
      const existing = this.sessions.get(id)!;
      if (existing.status === 'running') {
        throw new Error(`Session ${id} is already running`);
      }
      this.sessions.delete(id);
    }

    const shell = os.platform() === 'win32' ? 'cmd.exe' : 'bash';

    // Clean env: remove CLAUDECODE to prevent nested session detection
    const cleanEnv: Record<string, string> = {};
    for (const [key, val] of Object.entries(process.env)) {
      if (val !== undefined && !key.startsWith('CLAUDECODE')) {
        cleanEnv[key] = val;
      }
    }
    cleanEnv.FORCE_COLOR = '1';

    // On Windows, use /K to set UTF-8 codepage at cmd.exe startup (before any input)
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
        // --dangerously-skip-permissions: bypass all y/n prompts
        // Note: do NOT use 'cls' — it wipes the xterm buffer and destroys replayed content
        const fullCommand = command === 'claude'
          ? 'claude --dangerously-skip-permissions'
          : command;
        ptyProcess.write(fullCommand + '\r');
      }, 1200);
    }

    const session: TerminalSession = {
      id,
      name,
      pty: ptyProcess,
      cwd,
      command,
      pid: ptyProcess.pid,
      createdAt: new Date(),
      status: 'running',
    };

    this.sessions.set(id, session);

    // Output logging — buffer in memory + write to file
    outputLogger.startSession(id);
    ptyProcess.onData((data: string) => {
      outputLogger.write(id, data);
    });

    // Handle unexpected PTY exit
    ptyProcess.onExit(({ exitCode }) => {
      console.log(`[PTY] Session "${name}" (${id}) exited with code ${exitCode}`);
      const sess = this.sessions.get(id);
      if (sess) {
        sess.status = 'stopped';
        outputLogger.stopSession(id);
        sessionState.sessionStopped(id);
      }
    });

    // Persist running state
    sessionState.sessionStarted({
      id, name, cwd, command,
      spawnedAt: new Date().toISOString(),
    });

    console.log(`[PTY] Spawned session "${name}" (${id}) in ${cwd}, PID: ${ptyProcess.pid}`);
    return session;
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
      console.log(`[PTY] Killing session "${session.name}" (${id}), PID: ${session.pid}`);
      session.pty.kill();
      session.status = 'stopped';
      this.sessions.delete(id);

      outputLogger.stopSession(id);
      sessionState.sessionStopped(id);

      // Clear ring buffer after delay (in case of quick respawn)
      setTimeout(() => {
        if (!this.sessions.has(id)) {
          outputLogger.clearBuffer(id);
        }
      }, 5000);
    }
  }

  get(id: string): TerminalSession | undefined {
    return this.sessions.get(id);
  }

  list(): Array<Omit<TerminalSession, 'pty'>> {
    return Array.from(this.sessions.values()).map(({ pty: _pty, ...rest }) => rest);
  }

  isRunning(id: string): boolean {
    const session = this.sessions.get(id);
    return session?.status === 'running' || false;
  }
}

export const ptyManager = new PtyManager();
