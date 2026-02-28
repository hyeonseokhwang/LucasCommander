import { useState, useCallback } from 'react';
import { TerminalGrid } from './components/TerminalGrid';
import { SessionManager } from './components/SessionManager';
import { SystemMonitor } from './components/SystemMonitor';
import { CoordinationView } from './components/CoordinationView';
import { ReportLog } from './components/ReportLog';
import type { ActiveSession } from './types';
import { api } from './lib/api';

export default function App() {
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleSessionSpawned = useCallback((session: ActiveSession) => {
    setActiveSessions(prev => {
      if (prev.find(s => s.id === session.id)) return prev;
      return [...prev, session];
    });
  }, []);

  const handleSessionKilled = useCallback((id: string) => {
    setActiveSessions(prev => prev.filter(s => s.id !== id));
  }, []);

  const handleClose = useCallback(async (id: string) => {
    try {
      await api.kill(id);
    } catch {
      // ignore
    }
    setActiveSessions(prev => prev.filter(s => s.id !== id));
  }, []);

  return (
    <div className="h-screen flex flex-col bg-slate-950">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-2 bg-slate-900 border-b border-slate-800 shrink-0">
        <button
          onClick={() => setSidebarOpen(v => !v)}
          className="text-slate-400 hover:text-slate-200 transition-colors"
          title="Toggle sidebar"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </button>
        <h1 className="text-sm font-bold text-slate-200 tracking-wide">
          LUCAS COMMAND CENTER
        </h1>
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>{activeSessions.length} active</span>
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        </div>
      </header>

      {/* Main */}
      <div className="flex-1 flex min-h-0">
        {/* Sidebar */}
        {sidebarOpen && (
          <aside className="w-64 shrink-0 bg-slate-900/50 border-r border-slate-800 overflow-y-auto">
            <SessionManager
              activeSessions={activeSessions}
              onSessionSpawned={handleSessionSpawned}
              onSessionKilled={handleSessionKilled}
            />
            <div className="border-t border-slate-800">
              <SystemMonitor />
            </div>
            <div className="border-t border-slate-800">
              <CoordinationView />
            </div>
            <div className="border-t border-slate-800">
              <ReportLog />
            </div>
          </aside>
        )}

        {/* Terminal Grid */}
        <TerminalGrid
          sessions={activeSessions}
          onClose={handleClose}
        />
      </div>
    </div>
  );
}
