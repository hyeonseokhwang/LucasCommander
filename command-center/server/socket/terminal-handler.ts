import type { Namespace, Socket } from 'socket.io';
import { ptyClient } from '../services/pty-client.js';

export function setupTerminalNamespace(nsp: Namespace) {
  // Ref-counted daemon subscriptions: track how many sockets are watching each session
  const subscriptionRefs = new Map<string, number>();

  // Global output/exit listeners (registered once on the ptyClient)
  let listenersRegistered = false;

  function ensureListeners() {
    if (listenersRegistered) return;
    listenersRegistered = true;

    ptyClient.onOutput((sessionId, data) => {
      nsp.to(`term:${sessionId}`).emit('output', { sessionId, data });
    });

    ptyClient.onExit((sessionId, exitCode) => {
      nsp.to(`term:${sessionId}`).emit('exit', { sessionId, exitCode });
      console.log(`[Terminal] Session "${sessionId}" exited with code ${exitCode}`);
    });
  }

  nsp.on('connection', (socket: Socket) => {
    console.log(`[Terminal] Client connected: ${socket.id}`);
    ensureListeners();

    const attachedSessions = new Set<string>();

    socket.on('attach', async (payload: string | { sessionId: string; requestReplay?: boolean; cols?: number; rows?: number }) => {
      const sessionId = typeof payload === 'string' ? payload : payload.sessionId;
      const requestReplay = typeof payload === 'object' ? payload.requestReplay ?? true : false;
      const cols = typeof payload === 'object' ? payload.cols : undefined;
      const rows = typeof payload === 'object' ? payload.rows : undefined;

      const session = ptyClient.get(sessionId);
      if (!session) {
        socket.emit('error', { message: `Session "${sessionId}" not found` });
        return;
      }

      socket.join(`term:${sessionId}`);
      attachedSessions.add(sessionId);
      console.log(`[Terminal] ${socket.id} attached to session "${sessionId}" (replay: ${requestReplay})`);

      // Resize PTY to match client terminal before replay
      if (cols && rows) {
        ptyClient.resize(sessionId, cols, rows);
      }

      // Send buffered output BEFORE live data starts flowing
      if (requestReplay) {
        try {
          const buffered = await ptyClient.getBuffer(sessionId);
          console.log(`[Terminal] Replay for "${sessionId}": buffer=${buffered.length} bytes`);
          if (buffered.length > 0) {
            const CHUNK = 64 * 1024;
            if (buffered.length <= CHUNK) {
              socket.emit('replay', { sessionId, data: buffered });
            } else {
              for (let i = 0; i < buffered.length; i += CHUNK) {
                socket.emit('replay', { sessionId, data: buffered.slice(i, i + CHUNK) });
              }
            }
            console.log(`[Terminal] Sent replay for "${sessionId}": ${buffered.length} bytes in ${Math.ceil(buffered.length / CHUNK)} chunk(s)`);
          }
        } catch (err: any) {
          console.error(`[Terminal] Replay failed for "${sessionId}": ${err.message}`);
        }
      }

      // Subscribe to daemon output for this session (ref-counted)
      const refCount = subscriptionRefs.get(sessionId) || 0;
      if (refCount === 0) {
        ptyClient.subscribe(sessionId);
        console.log(`[Terminal] Subscribed to daemon output for "${sessionId}"`);
      }
      subscriptionRefs.set(sessionId, refCount + 1);
    });

    // Client sends keyboard input
    socket.on('input', ({ sessionId, data }: { sessionId: string; data: string }) => {
      ptyClient.write(sessionId, data);
    });

    // Client resizes terminal
    socket.on('resize', ({ sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
      ptyClient.resize(sessionId, cols, rows);
    });

    // Quick action: approve (y)
    socket.on('approve', ({ sessionId }: { sessionId: string }) => {
      ptyClient.write(sessionId, 'y');
      setTimeout(() => ptyClient.write(sessionId, '\r'), 50);
    });

    // Quick action: reject (n)
    socket.on('reject', ({ sessionId }: { sessionId: string }) => {
      ptyClient.write(sessionId, 'n');
      setTimeout(() => ptyClient.write(sessionId, '\r'), 50);
    });

    // Send a prompt string
    socket.on('sendPrompt', ({ sessionId, prompt }: { sessionId: string; prompt: string }) => {
      ptyClient.write(sessionId, prompt);
      setTimeout(() => ptyClient.write(sessionId, '\r'), 50);
    });

    socket.on('disconnect', () => {
      console.log(`[Terminal] Client disconnected: ${socket.id}`);
      // Decrement ref counts and unsubscribe when no more clients
      for (const sid of attachedSessions) {
        const count = (subscriptionRefs.get(sid) || 0) - 1;
        if (count <= 0) {
          subscriptionRefs.delete(sid);
          ptyClient.unsubscribe(sid);
          console.log(`[Terminal] Unsubscribed from daemon output for "${sid}" (no more clients)`);
        } else {
          subscriptionRefs.set(sid, count);
        }
      }
    });
  });
}
