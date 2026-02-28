/**
 * IPC protocol types for PTY Daemon <-> Web Server communication.
 * Transport: TCP JSON Lines on localhost:9100
 */

// ===== Session info shared between daemon and web server =====

export interface SessionInfo {
  id: string;
  name: string;
  cwd: string;
  command: string;
  pid: number;
  status: 'running' | 'stopped';
  createdAt: string;
}

// ===== Request: Web Server -> Daemon =====

export type DaemonRequest =
  | { seq: number; cmd: 'spawn'; id: string; name: string; cwd: string; command: string }
  | { seq: number; cmd: 'kill'; id: string }
  | { seq: number; cmd: 'write'; id: string; data: string }
  | { seq: number; cmd: 'resize'; id: string; cols: number; rows: number }
  | { seq: number; cmd: 'list' }
  | { seq: number; cmd: 'get'; id: string }
  | { seq: number; cmd: 'isRunning'; id: string }
  | { seq: number; cmd: 'getBuffer'; id: string }
  | { seq: number; cmd: 'subscribe'; sessionId: string }
  | { seq: number; cmd: 'unsubscribe'; sessionId: string };

// ===== Response: Daemon -> Web Server (correlated by seq) =====

export interface DaemonResponse {
  seq: number;
  ok: boolean;
  data?: any;
  error?: string;
}

// ===== Push Events: Daemon -> Web Server (no seq, type-based) =====

export type DaemonEvent =
  | { event: 'output'; sessionId: string; data: string }
  | { event: 'exit'; sessionId: string; exitCode: number }
  | { event: 'sessionStarted'; session: SessionInfo }
  | { event: 'sessionStopped'; id: string };
