/**
 * PtyClient — web server's interface to the PTY Daemon.
 * Connects via TCP JSON Lines to localhost:9100.
 *
 * API is designed to match the old ptyManager interface so callers need minimal changes:
 *   - isRunning(), list(), get() — synchronous (from local cache)
 *   - spawn(), kill() — async (RPC to daemon)
 *   - write(), resize() — fire-and-forget
 *   - getBuffer() — async (RPC to daemon)
 *   - subscribe()/unsubscribe() — manage daemon output streaming
 *   - onOutput()/onExit() — register event callbacks
 */
import net from 'net';
import { EventEmitter } from 'events';
import type { SessionInfo, DaemonRequest, DaemonResponse, DaemonEvent } from '../daemon/protocol.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 9100;
const RECONNECT_INTERVAL = 2000;

type OutputListener = (sessionId: string, data: string) => void;
type ExitListener = (sessionId: string, exitCode: number) => void;

class PtyClient extends EventEmitter {
  private host: string;
  private port: number;
  private socket: net.Socket | null = null;
  private lineBuffer = '';
  private seqCounter = 0;
  private pendingRequests = new Map<number, { resolve: (resp: DaemonResponse) => void; timer: ReturnType<typeof setTimeout> }>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;
  private intentionalClose = false;

  // Local cache — rebuilt on connect via `list` RPC
  private sessionCache = new Map<string, SessionInfo>();

  // Event listeners
  private outputListeners: OutputListener[] = [];
  private exitListeners: ExitListener[] = [];

  constructor(host?: string, port?: number) {
    super();
    this.host = host || DEFAULT_HOST;
    this.port = port || DEFAULT_PORT;
  }

  // ===== Connection =====

  async connect(): Promise<void> {
    this.intentionalClose = false;
    return new Promise((resolve) => {
      this.doConnect(resolve);
    });
  }

  private doConnect(onFirstConnect?: () => void): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
    }

    const socket = new net.Socket();
    this.socket = socket;

    socket.connect(this.port, this.host, async () => {
      console.log(`[PtyClient] Connected to daemon at ${this.host}:${this.port}`);
      this.connected = true;
      this.lineBuffer = '';

      // Rebuild local cache
      try {
        await this.rebuildCache();
      } catch (err: any) {
        console.error(`[PtyClient] Failed to rebuild cache: ${err.message}`);
      }

      this.emit('connected');
      if (onFirstConnect) {
        onFirstConnect();
        onFirstConnect = undefined;
      }
    });

    socket.on('data', (chunk) => {
      this.lineBuffer += chunk.toString();
      let idx: number;
      while ((idx = this.lineBuffer.indexOf('\n')) !== -1) {
        const line = this.lineBuffer.slice(0, idx).trim();
        this.lineBuffer = this.lineBuffer.slice(idx + 1);
        if (line) this.handleMessage(line);
      }
    });

    socket.on('close', () => {
      this.connected = false;
      console.log(`[PtyClient] Disconnected from daemon`);

      // Reject all pending requests
      for (const [seq, pending] of this.pendingRequests) {
        clearTimeout(pending.timer);
        pending.resolve({ seq, ok: false, error: 'Connection lost' });
      }
      this.pendingRequests.clear();

      this.emit('disconnected');

      // Auto-reconnect
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }

      // Resolve first connect even on failure so server can start
      if (onFirstConnect) {
        onFirstConnect();
        onFirstConnect = undefined;
      }
    });

    socket.on('error', (err) => {
      // Suppress ECONNREFUSED noise during reconnect attempts
      if ((err as any).code !== 'ECONNREFUSED') {
        console.error(`[PtyClient] Socket error: ${err.message}`);
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.intentionalClose && !this.connected) {
        console.log(`[PtyClient] Attempting reconnect to daemon...`);
        this.doConnect();
      }
    }, RECONNECT_INTERVAL);
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ===== Message handling =====

  private handleMessage(line: string): void {
    try {
      const msg = JSON.parse(line);

      // Check if it's a response (has seq)
      if (typeof msg.seq === 'number' && msg.ok !== undefined) {
        const pending = this.pendingRequests.get(msg.seq);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(msg.seq);
          pending.resolve(msg as DaemonResponse);
        }
        return;
      }

      // It's an event
      const event = msg as DaemonEvent;
      switch (event.event) {
        case 'output':
          for (const cb of this.outputListeners) {
            cb(event.sessionId, event.data);
          }
          break;

        case 'exit':
          for (const cb of this.exitListeners) {
            cb(event.sessionId, event.exitCode);
          }
          // Update cache
          this.sessionCache.delete(event.sessionId);
          break;

        case 'sessionStarted':
          this.sessionCache.set(event.session.id, event.session);
          this.emit('sessionStarted', event.session);
          break;

        case 'sessionStopped':
          this.sessionCache.delete(event.id);
          this.emit('sessionStopped', event.id);
          break;
      }
    } catch (err: any) {
      console.error(`[PtyClient] Failed to parse message: ${err.message}`);
    }
  }

  // ===== RPC =====

  private sendRequest(req: Record<string, any>): Promise<DaemonResponse> {
    return new Promise((resolve) => {
      if (!this.socket || !this.connected) {
        resolve({ seq: 0, ok: false, error: 'Not connected to daemon' });
        return;
      }

      const seq = ++this.seqCounter;
      const fullReq = { ...req, seq } as DaemonRequest;

      const timer = setTimeout(() => {
        this.pendingRequests.delete(seq);
        resolve({ seq, ok: false, error: 'Request timeout (10s)' });
      }, 10000);

      this.pendingRequests.set(seq, { resolve, timer });

      try {
        this.socket.write(JSON.stringify(fullReq) + '\n');
      } catch (err: any) {
        clearTimeout(timer);
        this.pendingRequests.delete(seq);
        resolve({ seq, ok: false, error: err.message });
      }
    });
  }

  /** Fire-and-forget: send without waiting for response */
  private sendFireAndForget(req: Record<string, any>): void {
    if (!this.socket || !this.connected) return;
    const seq = ++this.seqCounter;
    const fullReq = { ...req, seq } as DaemonRequest;
    try {
      this.socket.write(JSON.stringify(fullReq) + '\n');
    } catch { /* ignore */ }
  }

  private async rebuildCache(): Promise<void> {
    const resp = await this.sendRequest({ cmd: 'list' });
    if (resp.ok && Array.isArray(resp.data)) {
      this.sessionCache.clear();
      for (const info of resp.data as SessionInfo[]) {
        this.sessionCache.set(info.id, info);
      }
      console.log(`[PtyClient] Cache rebuilt: ${this.sessionCache.size} session(s)`);
    }
  }

  // ===== Public API (matches old ptyManager interface) =====

  /** Async — RPC to daemon */
  async spawn(id: string, name: string, cwd: string, command: string = 'claude'): Promise<SessionInfo> {
    const resp = await this.sendRequest({ cmd: 'spawn', id, name, cwd, command });
    if (!resp.ok) throw new Error(resp.error || 'spawn failed');
    const info = resp.data as SessionInfo;
    this.sessionCache.set(id, info);
    return info;
  }

  /** Async — RPC to daemon */
  async kill(id: string): Promise<void> {
    const resp = await this.sendRequest({ cmd: 'kill', id });
    if (!resp.ok) throw new Error(resp.error || 'kill failed');
    this.sessionCache.delete(id);
  }

  /** Fire-and-forget */
  write(id: string, data: string): void {
    this.sendFireAndForget({ cmd: 'write', id, data });
  }

  /** Fire-and-forget */
  resize(id: string, cols: number, rows: number): void {
    this.sendFireAndForget({ cmd: 'resize', id, cols, rows });
  }

  /** Sync — from local cache */
  get(id: string): SessionInfo | undefined {
    return this.sessionCache.get(id);
  }

  /** Sync — from local cache */
  list(): SessionInfo[] {
    return Array.from(this.sessionCache.values());
  }

  /** Sync — from local cache */
  isRunning(id: string): boolean {
    const cached = this.sessionCache.get(id);
    return cached?.status === 'running' || false;
  }

  /** Async — RPC to daemon (buffer data can be large) */
  async getBuffer(id: string): Promise<string> {
    const resp = await this.sendRequest({ cmd: 'getBuffer', id });
    if (!resp.ok) return '';
    return resp.data?.data || '';
  }

  /** Tell daemon to start streaming output for this session */
  subscribe(sessionId: string): void {
    this.sendFireAndForget({ cmd: 'subscribe', sessionId });
  }

  /** Tell daemon to stop streaming output for this session */
  unsubscribe(sessionId: string): void {
    this.sendFireAndForget({ cmd: 'unsubscribe', sessionId });
  }

  /** Register output event listener */
  onOutput(cb: OutputListener): void {
    this.outputListeners.push(cb);
  }

  /** Remove output event listener */
  offOutput(cb: OutputListener): void {
    const idx = this.outputListeners.indexOf(cb);
    if (idx !== -1) this.outputListeners.splice(idx, 1);
  }

  /** Register exit event listener */
  onExit(cb: ExitListener): void {
    this.exitListeners.push(cb);
  }

  /** Remove exit event listener */
  offExit(cb: ExitListener): void {
    const idx = this.exitListeners.indexOf(cb);
    if (idx !== -1) this.exitListeners.splice(idx, 1);
  }
}

export const ptyClient = new PtyClient();
