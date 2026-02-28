import type { Namespace, Socket } from 'socket.io';
import { ptyManager } from '../services/pty-manager.js';
import { outputLogger } from '../services/output-logger.js';

export function setupTerminalNamespace(nsp: Namespace) {
  // Shared: one PTY output/exit listener per session, ref-counted by attached sockets
  const ptyListeners = new Map<string, { dispose: () => void; count: number }>();

  nsp.on('connection', (socket: Socket) => {
    console.log(`[Terminal] Client connected: ${socket.id}`);

    const attachedSessions = new Set<string>();

    socket.on('attach', (payload: string | { sessionId: string; requestReplay?: boolean; cols?: number; rows?: number }) => {
      const sessionId = typeof payload === 'string' ? payload : payload.sessionId;
      const requestReplay = typeof payload === 'object' ? payload.requestReplay ?? true : false;
      const cols = typeof payload === 'object' ? payload.cols : undefined;
      const rows = typeof payload === 'object' ? payload.rows : undefined;

      const session = ptyManager.get(sessionId);
      if (!session) {
        socket.emit('error', { message: `Session "${sessionId}" not found` });
        return;
      }

      socket.join(`term:${sessionId}`);
      attachedSessions.add(sessionId);
      console.log(`[Terminal] ${socket.id} attached to session "${sessionId}" (replay: ${requestReplay})`);

      // Resize PTY to match client terminal before replay
      if (cols && rows) {
        ptyManager.resize(sessionId, cols, rows);
      }

      // Send buffered output BEFORE registering live listener
      if (requestReplay) {
        const buffered = outputLogger.getBuffer(sessionId);
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
      }

      // Register ONE shared PTY listener per session (ref-counted)
      const existing = ptyListeners.get(sessionId);
      if (existing) {
        existing.count++;
        console.log(`[Terminal] Reusing PTY listener for "${sessionId}" (refCount: ${existing.count})`);
      } else {
        const onData = session.pty.onData((data: string) => {
          nsp.to(`term:${sessionId}`).emit('output', { sessionId, data });
        });

        const onExit = session.pty.onExit(({ exitCode }) => {
          nsp.to(`term:${sessionId}`).emit('exit', { sessionId, exitCode });
          console.log(`[Terminal] Session "${sessionId}" exited with code ${exitCode}`);
        });

        ptyListeners.set(sessionId, {
          dispose: () => { onData.dispose(); onExit.dispose(); },
          count: 1,
        });
        console.log(`[Terminal] Registered new PTY listener for "${sessionId}"`);
      }
    });

    // Client sends keyboard input
    socket.on('input', ({ sessionId, data }: { sessionId: string; data: string }) => {
      ptyManager.write(sessionId, data);
    });

    // Client resizes terminal
    socket.on('resize', ({ sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
      ptyManager.resize(sessionId, cols, rows);
    });

    // Quick action: approve (y)
    socket.on('approve', ({ sessionId }: { sessionId: string }) => {
      ptyManager.write(sessionId, 'y');
      setTimeout(() => ptyManager.write(sessionId, '\r'), 50);
    });

    // Quick action: reject (n)
    socket.on('reject', ({ sessionId }: { sessionId: string }) => {
      ptyManager.write(sessionId, 'n');
      setTimeout(() => ptyManager.write(sessionId, '\r'), 50);
    });

    // Send a prompt string
    socket.on('sendPrompt', ({ sessionId, prompt }: { sessionId: string; prompt: string }) => {
      ptyManager.write(sessionId, prompt);
      setTimeout(() => ptyManager.write(sessionId, '\r'), 50);
    });

    socket.on('disconnect', () => {
      console.log(`[Terminal] Client disconnected: ${socket.id}`);
      // Decrement ref counts and clean up shared listeners when last client leaves
      for (const sid of attachedSessions) {
        const entry = ptyListeners.get(sid);
        if (entry) {
          entry.count--;
          if (entry.count <= 0) {
            entry.dispose();
            ptyListeners.delete(sid);
            console.log(`[Terminal] Disposed PTY listener for "${sid}" (no more clients)`);
          }
        }
      }
    });
  });
}
