import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { createTerminalSocket } from '../lib/socket';
import type { Socket } from 'socket.io-client';

interface UseTerminalOptions {
  sessionId: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  fontSize?: number;
}

export function useTerminal({ sessionId, containerRef, fontSize = 14 }: UseTerminalOptions) {
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontSize,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      theme: {
        background: '#0f172a',
        foreground: '#e2e8f0',
        cursor: '#60a5fa',
        selectionBackground: '#334155',
        black: '#1e293b',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#f1f5f9',
        brightBlack: '#475569',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#f8fafc',
      },
      cursorBlink: true,
      scrollback: 5000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(container);

    // Delay fit to ensure container is rendered
    requestAnimationFrame(() => fitAddon.fit());

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Socket connection
    const socket = createTerminalSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      term.reset();
      // Fit first, then attach with current dimensions so PTY can resize before replay
      fitAddon.fit();
      socket.emit('attach', {
        sessionId,
        requestReplay: true,
        cols: term.cols,
        rows: term.rows,
      });
    });

    socket.on('replay', ({ data }: { sessionId: string; data: string }) => {
      term.write(data);
    });

    socket.on('output', ({ data }: { sessionId: string; data: string }) => {
      term.write(data);
    });

    socket.on('exit', ({ exitCode }: { sessionId: string; exitCode: number }) => {
      term.write(`\r\n\x1b[31m[Process exited with code ${exitCode}]\x1b[0m\r\n`);
    });

    socket.on('disconnect', () => setConnected(false));

    // Terminal input -> socket
    term.onData((data: string) => {
      socket.emit('input', { sessionId, data });
    });

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (socket.connected) {
        socket.emit('resize', { sessionId, cols: term.cols, rows: term.rows });
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      socket.disconnect();
      term.dispose();
    };
  }, [sessionId, fontSize]);

  // Simulate keyboard input through the same path as direct typing
  const simulateInput = useCallback((text: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('input', { sessionId, data: text });
  }, [sessionId]);

  const sendApprove = useCallback(() => {
    simulateInput('y');
    setTimeout(() => simulateInput('\r'), 30);
  }, [simulateInput]);

  const sendReject = useCallback(() => {
    simulateInput('n');
    setTimeout(() => simulateInput('\r'), 30);
  }, [simulateInput]);

  const sendPrompt = useCallback((prompt: string) => {
    simulateInput(prompt);
    setTimeout(() => simulateInput('\r'), 50);
  }, [simulateInput]);

  return { connected, sendApprove, sendReject, sendPrompt, termRef };
}
