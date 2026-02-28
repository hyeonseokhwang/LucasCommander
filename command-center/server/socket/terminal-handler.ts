import type { Namespace, Socket } from 'socket.io';
import { ptyManager } from '../services/pty-manager.js';

export function setupTerminalNamespace(nsp: Namespace) {
  nsp.on('connection', (socket: Socket) => {
    console.log(`[Terminal] Client connected: ${socket.id}`);

    const cleanups: Array<{ dispose: () => void }> = [];

    socket.on('attach', (sessionId: string) => {
      const session = ptyManager.get(sessionId);
      if (!session) {
        socket.emit('error', { message: `Session "${sessionId}" not found` });
        return;
      }

      socket.join(`term:${sessionId}`);
      console.log(`[Terminal] ${socket.id} attached to session "${sessionId}"`);

      // Pipe PTY output -> browser
      const onData = session.pty.onData((data: string) => {
        nsp.to(`term:${sessionId}`).emit('output', { sessionId, data });
      });
      cleanups.push(onData);

      // Pipe PTY exit -> browser
      const onExit = session.pty.onExit(({ exitCode }) => {
        nsp.to(`term:${sessionId}`).emit('exit', { sessionId, exitCode });
        console.log(`[Terminal] Session "${sessionId}" exited with code ${exitCode}`);
      });
      cleanups.push(onExit);
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
      cleanups.forEach(c => c.dispose());
    });
  });
}
