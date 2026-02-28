import { useState, useEffect, useCallback } from 'react';
import { TerminalPanel } from './TerminalPanel';
import type { ActiveSession } from '../types';

interface Props {
  sessions: ActiveSession[];
  onClose: (id: string) => void;
}

export function TerminalTabs({ sessions, onClose }: Props) {
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [connectionStatuses, setConnectionStatuses] = useState<Record<string, boolean>>({});

  // Auto-select first tab if current active is gone
  useEffect(() => {
    if (sessions.length === 0) {
      setActiveTabId(null);
      return;
    }
    if (!activeTabId || !sessions.find(s => s.id === activeTabId)) {
      setActiveTabId(sessions[0].id);
    }
  }, [sessions, activeTabId]);

  // Keyboard shortcuts: Alt+Left/Right for tab switching, Alt+1~9 for direct select
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey || sessions.length === 0) return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        setActiveTabId(prev => {
          const idx = sessions.findIndex(s => s.id === prev);
          if (idx === -1) return sessions[0].id;
          const next = e.key === 'ArrowRight'
            ? (idx + 1) % sessions.length
            : (idx - 1 + sessions.length) % sessions.length;
          return sessions[next].id;
        });
      }

      // Alt+1 ~ Alt+9
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9 && num <= sessions.length) {
        e.preventDefault();
        setActiveTabId(sessions[num - 1].id);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sessions]);

  const handleConnectionChange = useCallback((id: string, connected: boolean) => {
    setConnectionStatuses(prev => {
      if (prev[id] === connected) return prev; // bail if unchanged — prevent re-render
      return { ...prev, [id]: connected };
    });
  }, []);

  if (sessions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        No active sessions. Start a worker from the sidebar.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Terminal area — all terminals stacked, only active visible */}
      <div className="flex-1 relative min-h-0">
        {sessions.map(session => (
          <div
            key={session.id}
            className="absolute inset-0"
            style={{
              visibility: session.id === activeTabId ? 'visible' : 'hidden',
              zIndex: session.id === activeTabId ? 1 : 0,
              pointerEvents: session.id === activeTabId ? 'auto' : 'none',
            }}
          >
            <TerminalPanel
              sessionId={session.id}
              sessionName={session.name}
              sessionColor={session.color}
              onClose={() => onClose(session.id)}
              isVisible={session.id === activeTabId}
              headerMode="tab"
              onConnectionChange={(c) => handleConnectionChange(session.id, c)}
            />
          </div>
        ))}
      </div>

      {/* Tab Bar */}
      <div className="shrink-0 flex items-center gap-0.5 px-2 py-1.5 bg-slate-900 border-t border-slate-700/50 overflow-x-auto">
        {sessions.map((session, idx) => {
          const isActive = session.id === activeTabId;
          const isConnected = connectionStatuses[session.id] ?? false;

          return (
            <button
              key={session.id}
              onClick={() => setActiveTabId(session.id)}
              className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors shrink-0 ${
                isActive
                  ? 'bg-slate-700 text-slate-100 font-medium'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
              title={`${session.name} (Alt+${idx + 1})`}
            >
              {/* Session color dot */}
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: session.color }}
              />
              {/* Connection status dot */}
              <div
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  isConnected ? 'bg-emerald-400' : 'bg-red-400'
                }`}
              />
              {/* Name */}
              <span className="truncate max-w-[120px]">{session.name}</span>
              {/* Keyboard hint */}
              {idx < 9 && (
                <span className="text-[9px] text-slate-600 ml-0.5">{idx + 1}</span>
              )}
              {/* Close button */}
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(session.id);
                }}
                className="ml-1 text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                title="Close session"
              >
                &#x2715;
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
