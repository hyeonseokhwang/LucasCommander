import { useState, useCallback, useEffect } from 'react';
import { TerminalGrid } from './components/TerminalGrid';
import { SessionManager } from './components/SessionManager';
import { SystemMonitor } from './components/SystemMonitor';
import { CoordinationView } from './components/CoordinationView';
import { ReportLog } from './components/ReportLog';
import { ApprovalBanner } from './components/ApprovalBanner';
import { TerminalPanel } from './components/TerminalPanel';
import { TerminalTabs } from './components/TerminalTabs';
import { WorkerStatusDashboard } from './components/WorkerStatusDashboard';
import { InstructionPanel } from './components/InstructionPanel';
import { ReportTimeline } from './components/ReportTimeline';
import type { ActiveSession } from './types';
import { api } from './lib/api';

// Pop-out mode: ?popout=sessionId&name=...&color=...
function getPopoutParams(): { sessionId: string; name: string; color: string } | null {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('popout');
  if (!sessionId) return null;
  return {
    sessionId,
    name: params.get('name') || sessionId,
    color: params.get('color') || '#60a5fa',
  };
}

function PopoutView({ sessionId, name, color }: { sessionId: string; name: string; color: string }) {
  return (
    <div className="h-screen bg-slate-950">
      <TerminalPanel
        sessionId={sessionId}
        sessionName={name}
        sessionColor={color}
        onClose={() => window.close()}
      />
    </div>
  );
}

type ViewMode = 'terminals' | 'tabs' | 'dashboard';

export default function App() {
  // Check for popout mode
  const popout = getPopoutParams();
  if (popout) {
    return <PopoutView {...popout} />;
  }

  return <MainApp />;
}

function MainApp() {
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('terminals');

  const refreshSessions = useCallback(() => {
    api.sessions().then((configs: any[]) => {
      const running = configs
        .filter((c: any) => c.running)
        .map((c: any) => ({ id: c.id, name: c.name, color: c.color }));
      setActiveSessions(running);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

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

        {/* View Mode Tabs */}
        <div className="flex items-center gap-1 ml-4 bg-slate-800 rounded-lg p-0.5">
          <button
            onClick={() => setViewMode('terminals')}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
              viewMode === 'terminals'
                ? 'bg-slate-700 text-slate-200 font-medium'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            Terminals
          </button>
          <button
            onClick={() => setViewMode('tabs')}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
              viewMode === 'tabs'
                ? 'bg-emerald-600/80 text-white font-medium'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            Fullscreen
          </button>
          <button
            onClick={() => setViewMode('dashboard')}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
              viewMode === 'dashboard'
                ? 'bg-blue-600/80 text-white font-medium'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            Dashboard
          </button>
        </div>

        <div className="flex-1" />
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>{activeSessions.length} active</span>
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        </div>
      </header>

      {/* Approval Banner */}
      <ApprovalBanner onWorkersCreated={refreshSessions} />

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

        {/* Main Content Area */}
        {viewMode === 'terminals' ? (
          <TerminalGrid
            sessions={activeSessions}
            onClose={handleClose}
          />
        ) : viewMode === 'tabs' ? (
          <TerminalTabs
            sessions={activeSessions}
            onClose={handleClose}
          />
        ) : (
          <DashboardView />
        )}
      </div>
    </div>
  );
}

function DashboardView() {
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Top: Worker Status Cards */}
      <div className="flex-1 min-h-0 overflow-auto">
        <WorkerStatusDashboard />
      </div>

      {/* Bottom: Instruction Panel + Timeline */}
      <div className="shrink-0 border-t border-slate-800 bg-slate-900/30">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-4 max-h-[400px]">
          {/* Instruction Panel - 1 col */}
          <div className="lg:col-span-1">
            <InstructionPanel />
          </div>
          {/* Report Timeline - 2 cols */}
          <div className="lg:col-span-2 max-h-[380px]">
            <ReportTimeline />
          </div>
        </div>
      </div>
    </div>
  );
}
