import { useState, useRef, useCallback, useEffect } from 'react';
import { Rnd } from 'react-rnd';
import { TerminalPanel } from './TerminalPanel';
import type { ActiveSession } from '../types';

interface Props {
  sessions: ActiveSession[];
  onClose: (id: string) => void;
}

interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  maximized: boolean;
  zIndex: number;
  prevBounds?: { x: number; y: number; width: number; height: number };
}

export function TerminalGrid({ sessions, onClose }: Props) {
  const [windows, setWindows] = useState<Record<string, WindowState>>({});
  const [topZ, setTopZ] = useState(10);
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate tiled position for a session
  const calcTiledPos = useCallback((index: number, total: number, cw: number, ch: number) => {
    const cols = total <= 1 ? 1 : total <= 2 ? 2 : total <= 6 ? 3 : 4;
    const rows = Math.ceil(total / cols);
    const gap = 4;
    const w = Math.floor((cw - gap * (cols + 1)) / cols);
    const h = Math.floor((ch - gap * (rows + 1)) / rows);
    const col = index % cols;
    const row = Math.floor(index / cols);
    return {
      x: gap + col * (w + gap),
      y: gap + row * (h + gap),
      width: w,
      height: h,
    };
  }, []);

  // Initialize/update window states when sessions change
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (cw === 0 || ch === 0) return;

    setWindows(prev => {
      const next = { ...prev };
      // Remove windows for sessions that no longer exist
      for (const id of Object.keys(next)) {
        if (!sessions.find(s => s.id === id)) delete next[id];
      }
      // Add new sessions
      const visibleCount = sessions.length;
      sessions.forEach((s, i) => {
        if (!next[s.id]) {
          const pos = calcTiledPos(i, visibleCount, cw, ch);
          next[s.id] = { ...pos, minimized: false, maximized: false, zIndex: 10 + i };
        }
      });
      return next;
    });
  }, [sessions, calcTiledPos]);

  const bringToFront = useCallback((id: string) => {
    setTopZ(z => {
      const newZ = z + 1;
      setWindows(prev => ({ ...prev, [id]: { ...prev[id], zIndex: newZ } }));
      return newZ;
    });
  }, []);

  const handleMinimize = useCallback((id: string) => {
    setWindows(prev => ({
      ...prev,
      [id]: { ...prev[id], minimized: true, maximized: false },
    }));
  }, []);

  const handleRestore = useCallback((id: string) => {
    bringToFront(id);
    setWindows(prev => ({
      ...prev,
      [id]: { ...prev[id], minimized: false },
    }));
  }, [bringToFront]);

  const handleMaximize = useCallback((id: string) => {
    const container = containerRef.current;
    if (!container) return;
    bringToFront(id);
    setWindows(prev => {
      const win = prev[id];
      if (win.maximized) {
        // Restore
        return {
          ...prev,
          [id]: {
            ...win,
            maximized: false,
            ...(win.prevBounds || {}),
            prevBounds: undefined,
          },
        };
      }
      // Maximize
      return {
        ...prev,
        [id]: {
          ...win,
          maximized: true,
          prevBounds: { x: win.x, y: win.y, width: win.width, height: win.height },
          x: 0, y: 0,
          width: container.clientWidth,
          height: container.clientHeight,
        },
      };
    });
  }, [bringToFront]);

  const handlePopout = useCallback((sessionId: string, sessionName: string, sessionColor: string) => {
    const url = `${window.location.origin}?popout=${sessionId}&name=${encodeURIComponent(sessionName)}&color=${encodeURIComponent(sessionColor)}`;
    window.open(url, `terminal-${sessionId}`, 'width=900,height=600,menubar=no,toolbar=no');
  }, []);

  const handleTileAll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const visible = sessions.filter(s => !windows[s.id]?.minimized);
    setWindows(prev => {
      const next = { ...prev };
      visible.forEach((s, i) => {
        const pos = calcTiledPos(i, visible.length, cw, ch);
        next[s.id] = { ...next[s.id], ...pos, minimized: false, maximized: false, prevBounds: undefined };
      });
      return next;
    });
  }, [sessions, windows, calcTiledPos]);

  const minimizedSessions = sessions.filter(s => windows[s.id]?.minimized);

  if (sessions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500">
        <div className="text-center">
          <div className="text-4xl mb-4">{'>'}_</div>
          <p className="text-lg">No active terminals</p>
          <p className="text-sm mt-1">Spawn a session from the sidebar</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Window area */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden bg-slate-950">
        {sessions.map(session => {
          const win = windows[session.id];
          if (!win || win.minimized) return null;

          return (
            <Rnd
              key={session.id}
              position={{ x: win.x, y: win.y }}
              size={{ width: win.width, height: win.height }}
              minWidth={300}
              minHeight={200}
              bounds="parent"
              dragHandleClassName="window-drag-handle"
              style={{ zIndex: win.zIndex }}
              disableDragging={win.maximized}
              enableResizing={!win.maximized}
              onDragStart={() => bringToFront(session.id)}
              onDragStop={(_e, d) => {
                setWindows(prev => ({
                  ...prev,
                  [session.id]: { ...prev[session.id], x: d.x, y: d.y },
                }));
              }}
              onResizeStop={(_e, _dir, ref, _delta, pos) => {
                setWindows(prev => ({
                  ...prev,
                  [session.id]: {
                    ...prev[session.id],
                    width: parseInt(ref.style.width),
                    height: parseInt(ref.style.height),
                    x: pos.x,
                    y: pos.y,
                  },
                }));
              }}
              onMouseDown={() => bringToFront(session.id)}
            >
              <TerminalPanel
                sessionId={session.id}
                sessionName={session.name}
                sessionColor={session.color}
                onClose={() => onClose(session.id)}
                onMinimize={() => handleMinimize(session.id)}
                onMaximize={() => handleMaximize(session.id)}
                onPopout={() => handlePopout(session.id, session.name, session.color)}
                isMaximized={win.maximized}
              />
            </Rnd>
          );
        })}
      </div>

      {/* Taskbar */}
      {(minimizedSessions.length > 0 || sessions.length > 1) && (
        <div className="shrink-0 flex items-center gap-1 px-2 py-1 bg-slate-900 border-t border-slate-800">
          <button
            onClick={handleTileAll}
            className="px-2 py-0.5 text-[10px] text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 rounded transition-colors"
            title="Tile all windows"
          >
            Tile
          </button>
          <div className="w-px h-4 bg-slate-700 mx-1" />
          {minimizedSessions.map(s => (
            <button
              key={s.id}
              onClick={() => handleRestore(s.id)}
              className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 rounded transition-colors"
            >
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.color }} />
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
