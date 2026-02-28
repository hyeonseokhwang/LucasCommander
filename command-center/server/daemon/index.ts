/**
 * PTY Daemon — long-lived process that manages node-pty sessions.
 * Communicates with the web server via TCP JSON Lines on port 9100.
 *
 * Usage:  npx tsx server/daemon/index.ts
 *   (do NOT use tsx watch — this process must survive code changes)
 */
import net from 'net';
import { daemonPtyManager } from './daemon-pty-manager.js';
import type { DaemonRequest, DaemonResponse, DaemonEvent } from './protocol.js';

const PORT = parseInt(process.env.DAEMON_PORT || '9100');
const HOST = '127.0.0.1';

// Track connected web-server clients and their subscriptions
interface ClientState {
  socket: net.Socket;
  subscriptions: Set<string>; // session IDs this client wants output for
  lineBuffer: string;         // partial JSON Line accumulator
}

const clients = new Map<net.Socket, ClientState>();

// ===== Helpers =====

function sendJson(socket: net.Socket, obj: DaemonResponse | DaemonEvent): void {
  try {
    socket.write(JSON.stringify(obj) + '\n');
  } catch { /* client disconnected */ }
}

function broadcast(event: DaemonEvent, filter?: (client: ClientState) => boolean): void {
  for (const client of clients.values()) {
    if (!filter || filter(client)) {
      sendJson(client.socket, event);
    }
  }
}

// ===== Wire daemon events =====

// Push PTY output to subscribed clients
daemonPtyManager.onOutput((sessionId, data) => {
  broadcast(
    { event: 'output', sessionId, data },
    (c) => c.subscriptions.has(sessionId),
  );
});

// Push PTY exit to all clients
daemonPtyManager.onExit((sessionId, exitCode) => {
  broadcast({ event: 'exit', sessionId, exitCode });
  broadcast({ event: 'sessionStopped', id: sessionId });
});

// ===== Request handler =====

async function handleRequest(client: ClientState, req: DaemonRequest): Promise<DaemonResponse> {
  const { seq } = req;

  try {
    switch (req.cmd) {
      case 'spawn': {
        const info = daemonPtyManager.spawn(req.id, req.name, req.cwd, req.command);
        // Notify all clients about new session
        broadcast({ event: 'sessionStarted', session: info });
        return { seq, ok: true, data: info };
      }

      case 'kill': {
        daemonPtyManager.kill(req.id);
        return { seq, ok: true, data: { killed: true } };
      }

      case 'write': {
        daemonPtyManager.write(req.id, req.data);
        return { seq, ok: true };
      }

      case 'resize': {
        daemonPtyManager.resize(req.id, req.cols, req.rows);
        return { seq, ok: true };
      }

      case 'list': {
        return { seq, ok: true, data: daemonPtyManager.list() };
      }

      case 'get': {
        return { seq, ok: true, data: daemonPtyManager.get(req.id) };
      }

      case 'isRunning': {
        return { seq, ok: true, data: { running: daemonPtyManager.isRunning(req.id) } };
      }

      case 'getBuffer': {
        return { seq, ok: true, data: { data: daemonPtyManager.getBuffer(req.id) } };
      }

      case 'subscribe': {
        client.subscriptions.add(req.sessionId);
        return { seq, ok: true };
      }

      case 'unsubscribe': {
        client.subscriptions.delete(req.sessionId);
        return { seq, ok: true };
      }

      default:
        return { seq, ok: false, error: `Unknown command: ${(req as any).cmd}` };
    }
  } catch (err: any) {
    return { seq, ok: false, error: err.message };
  }
}

// ===== TCP Server =====

const server = net.createServer((socket) => {
  console.log(`[Daemon] Client connected from ${socket.remoteAddress}:${socket.remotePort}`);

  const client: ClientState = {
    socket,
    subscriptions: new Set(),
    lineBuffer: '',
  };
  clients.set(socket, client);

  socket.on('data', (chunk) => {
    client.lineBuffer += chunk.toString();

    // Process complete lines (JSON Lines protocol)
    let newlineIdx: number;
    while ((newlineIdx = client.lineBuffer.indexOf('\n')) !== -1) {
      const line = client.lineBuffer.slice(0, newlineIdx).trim();
      client.lineBuffer = client.lineBuffer.slice(newlineIdx + 1);

      if (!line) continue;

      try {
        const req: DaemonRequest = JSON.parse(line);
        // Fire-and-forget for write/resize (no need to await)
        if (req.cmd === 'write' || req.cmd === 'resize') {
          handleRequest(client, req); // intentionally not awaited
        } else {
          handleRequest(client, req).then((resp) => {
            sendJson(socket, resp);
          });
        }
      } catch (err: any) {
        console.error(`[Daemon] Invalid JSON from client: ${err.message}`);
      }
    }
  });

  socket.on('close', () => {
    console.log(`[Daemon] Client disconnected`);
    clients.delete(socket);
  });

  socket.on('error', (err) => {
    console.error(`[Daemon] Socket error: ${err.message}`);
    clients.delete(socket);
  });
});

// ===== Startup =====

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║   Lucas PTY Daemon                       ║');
  console.log(`  ║   TCP ${HOST}:${PORT}                    ║`);
  console.log('  ║   Long-lived process — do NOT tsx watch   ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');

  // Auto-recover previous sessions
  daemonPtyManager.autoRecover();
});

// ===== Graceful shutdown =====

function gracefulShutdown(signal: string) {
  console.log(`\n[Daemon] ${signal} received, saving state...`);
  daemonPtyManager.shutdown();

  // Close TCP server
  server.close();

  // Close client sockets
  for (const client of clients.values()) {
    client.socket.destroy();
  }

  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
