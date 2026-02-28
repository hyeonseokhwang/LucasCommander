import { useState, useEffect, useCallback } from 'react';
import { useCoordination } from '../hooks/useCoordination';
import { api } from '../lib/api';

interface WorkerTask {
  text: string;
  done: boolean;
}

interface WorkerData {
  filename: string;
  name: string;
  lastUpdated: string;
  tasks: WorkerTask[];
  requests: string[];
  scope: string;
  stack: string;
  port: string;
  completedSections: string[];
  reportItems: string[];
  statusSummary: string;
}

interface SessionInfo {
  id: string;
  name: string;
  running: boolean;
  pid?: number;
  color: string;
  cwd: string;
  type?: string;
  mission?: string;
}

interface ReportEntry {
  type: 'report' | 'instruction';
  timestamp: string;
  worker: string;
  report?: string;
  instruction?: string;
}

function getStatusColor(status: string): string {
  if (status.includes('블로커') || status.includes('차단')) return 'text-red-400';
  if (status.includes('작업') || status.includes('진행')) return 'text-emerald-400';
  return 'text-yellow-400';
}

function getStatusBg(status: string): string {
  if (status.includes('블로커') || status.includes('차단')) return 'border-red-500/30 bg-red-500/5';
  if (status.includes('작업') || status.includes('진행')) return 'border-emerald-500/30 bg-emerald-500/5';
  return 'border-yellow-500/30 bg-yellow-500/5';
}

function getStatusDot(status: string): string {
  if (status.includes('블로커') || status.includes('차단')) return 'bg-red-400';
  if (status.includes('작업') || status.includes('진행')) return 'bg-emerald-400';
  return 'bg-yellow-400';
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function WorkerCard({ worker, session, lastReport }: {
  worker: WorkerData;
  session?: SessionInfo;
  lastReport?: ReportEntry;
}) {
  const doneTasks = worker.tasks.filter(t => t.done).length;
  const totalTasks = worker.tasks.length;
  const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const isRunning = session?.running ?? false;

  return (
    <div className={`rounded-lg border overflow-hidden transition-all ${
      isRunning
        ? 'border-slate-700/50 bg-slate-800/60'
        : 'border-slate-700/30 bg-slate-800/30 opacity-75'
    }`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-700/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Running indicator */}
          <div className="relative">
            <div
              className={`w-2.5 h-2.5 rounded-full ${isRunning ? 'bg-emerald-400' : 'bg-slate-600'}`}
              style={session?.color ? { backgroundColor: isRunning ? undefined : session.color, opacity: isRunning ? undefined : 0.4 } : {}}
            />
            {isRunning && (
              <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping opacity-30" />
            )}
          </div>
          <h3 className="text-sm font-semibold text-slate-200 capitalize">
            {worker.name}
          </h3>
          {worker.port && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400 font-mono">
              :{worker.port}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Running/Stopped badge */}
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
            isRunning
              ? 'bg-emerald-500/20 text-emerald-400'
              : 'bg-slate-700/50 text-slate-500'
          }`}>
            {isRunning ? 'RUNNING' : 'STOPPED'}
          </span>
          {worker.statusSummary && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${getStatusBg(worker.statusSummary)} ${getStatusColor(worker.statusSummary)}`}>
              {worker.statusSummary}
            </span>
          )}
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* PID & Session Info */}
        <div className="flex items-center gap-4 text-[11px]">
          {session?.pid && (
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">PID</span>
              <span className="font-mono text-slate-300 bg-slate-700/50 px-1.5 py-0.5 rounded">{session.pid}</span>
            </div>
          )}
          {session?.cwd && (
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-slate-500 shrink-0">Dir</span>
              <span className="text-slate-400 truncate font-mono text-[10px]">{session.cwd}</span>
            </div>
          )}
        </div>

        {/* Scope */}
        {worker.scope && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Scope</div>
            <div className="text-xs text-slate-300">{worker.scope}</div>
            {worker.stack && (
              <div className="text-[10px] text-slate-500 mt-0.5">{worker.stack}</div>
            )}
          </div>
        )}

        {/* Progress Bar */}
        {totalTasks > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Tasks</span>
              <span className="text-[10px] text-slate-400">{doneTasks}/{totalTasks} ({progress}%)</span>
            </div>
            <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Current Tasks (incomplete only) */}
        {worker.tasks.filter(t => !t.done).length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">In Progress</div>
            <div className="space-y-1">
              {worker.tasks.filter(t => !t.done).slice(0, 5).map((t, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-yellow-400 mt-0.5 shrink-0">&#9675;</span>
                  <span className="text-slate-300">{t.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recently Completed */}
        {worker.tasks.filter(t => t.done).length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
              Completed ({worker.tasks.filter(t => t.done).length})
            </div>
            <div className="space-y-1">
              {worker.tasks.filter(t => t.done).slice(-3).map((t, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-emerald-400 mt-0.5 shrink-0">&#10003;</span>
                  <span className="text-slate-500 line-through">{t.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Completed Sections (major features) */}
        {worker.completedSections.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
              Completed Features ({worker.completedSections.length})
            </div>
            <div className="flex flex-wrap gap-1">
              {worker.completedSections.slice(0, 6).map((s, i) => (
                <span
                  key={i}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                >
                  {s.length > 30 ? s.substring(0, 30) + '...' : s}
                </span>
              ))}
              {worker.completedSections.length > 6 && (
                <span className="text-[10px] px-1.5 py-0.5 text-slate-500">
                  +{worker.completedSections.length - 6} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Reports */}
        {worker.reportItems.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Reports</div>
            <div className="space-y-1">
              {worker.reportItems.slice(0, 3).map((r, i) => (
                <div key={i} className="text-[11px] text-blue-300">
                  {r.replace(/\*\*/g, '').length > 80
                    ? r.replace(/\*\*/g, '').substring(0, 80) + '...'
                    : r.replace(/\*\*/g, '')}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Requests */}
        {worker.requests.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-orange-400/70 mb-1.5">
              Requests ({worker.requests.length})
            </div>
            <div className="space-y-1">
              {worker.requests.slice(0, 3).map((r, i) => (
                <div key={i} className="text-[11px] text-orange-300 flex items-start gap-1.5">
                  <span className="text-orange-400 shrink-0">!</span>
                  <span>{r.length > 60 ? r.substring(0, 60) + '...' : r}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Last Report Time + Last Updated */}
        <div className="pt-2 border-t border-slate-700/30 space-y-1">
          {lastReport && (
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-600">Last report</span>
              <span className="text-[10px] text-blue-400/70" title={new Date(lastReport.timestamp).toLocaleString('ko-KR')}>
                {relativeTime(lastReport.timestamp)}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-600">Status updated</span>
            <span className="text-[10px] text-slate-500">{worker.lastUpdated || 'N/A'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function WorkerStatusDashboard() {
  const state = useCoordination();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [reportHistory, setReportHistory] = useState<ReportEntry[]>([]);

  const fetchSessions = useCallback(async () => {
    try {
      const data = await api.sessions();
      setSessions(data);
    } catch {
      // ignore
    }
  }, []);

  const fetchReports = useCallback(async () => {
    try {
      const data = await api.reports();
      setReportHistory(data.history || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    fetchReports();
    const si = setInterval(fetchSessions, 5000);
    const ri = setInterval(fetchReports, 5000);
    return () => { clearInterval(si); clearInterval(ri); };
  }, [fetchSessions, fetchReports]);

  if (!state) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500">
        <div className="text-center">
          <div className="text-2xl mb-3 animate-pulse">...</div>
          <p className="text-sm">Loading worker status...</p>
        </div>
      </div>
    );
  }

  const workers = state.workers as WorkerData[];

  // Build session lookup by worker name
  const sessionMap = new Map<string, SessionInfo>();
  for (const s of sessions) {
    sessionMap.set(s.id, s);
    // Also map by name pattern (e.g. "worker-dashboard" -> "Worker-Dashboard")
    const normalizedName = s.name?.toLowerCase().replace(/[\s_-]+/g, '-');
    if (normalizedName) sessionMap.set(normalizedName, s);
  }

  // Build last report lookup by worker name
  const lastReportMap = new Map<string, ReportEntry>();
  for (const r of reportHistory) {
    const existing = lastReportMap.get(r.worker);
    if (!existing || new Date(r.timestamp) > new Date(existing.timestamp)) {
      lastReportMap.set(r.worker, r);
    }
  }

  // Match workers with sessions
  function findSession(worker: WorkerData): SessionInfo | undefined {
    // Try exact match on worker name variations
    const name = worker.name.toLowerCase().replace(/[\s_-]+/g, '-');
    if (sessionMap.has(name)) return sessionMap.get(name);
    // Try matching by filename pattern (e.g. "worker-dashboard.md" -> "worker-dashboard")
    const fromFilename = worker.filename?.replace('.md', '').replace('worker-', '');
    if (fromFilename) {
      const key = `worker-${fromFilename}`;
      if (sessionMap.has(key)) return sessionMap.get(key);
    }
    return undefined;
  }

  function findLastReport(worker: WorkerData): ReportEntry | undefined {
    const name = worker.name.toLowerCase().replace(/[\s_-]+/g, '-');
    if (lastReportMap.has(name)) return lastReportMap.get(name);
    const fromFilename = worker.filename?.replace('.md', '');
    if (fromFilename && lastReportMap.has(fromFilename)) return lastReportMap.get(fromFilename);
    return undefined;
  }

  if (workers.length === 0 && sessions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500">
        <div className="text-center">
          <p className="text-lg mb-1">No workers found</p>
          <p className="text-sm">Worker status files will appear when workers are active</p>
        </div>
      </div>
    );
  }

  // Summary stats
  const totalTasks = workers.reduce((sum, w) => sum + w.tasks.length, 0);
  const doneTasks = workers.reduce((sum, w) => sum + w.tasks.filter(t => t.done).length, 0);
  const runningSessions = sessions.filter(s => s.running).length;
  const stoppedSessions = sessions.filter(s => !s.running).length;
  const activeWorkers = workers.filter(w =>
    w.statusSummary.includes('작업') || w.statusSummary.includes('진행')
  ).length;
  const blockedWorkers = workers.filter(w =>
    w.statusSummary.includes('블로커') || w.statusSummary.includes('차단')
  ).length;

  return (
    <div className="flex-1 overflow-auto p-4">
      {/* Header Stats */}
      <div className="mb-4 grid grid-cols-5 gap-3">
        <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-3 text-center">
          <div className="text-2xl font-bold text-slate-200">{workers.length}</div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Workers</div>
        </div>
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-center">
          <div className="text-2xl font-bold text-emerald-400">{runningSessions}</div>
          <div className="text-[10px] uppercase tracking-wider text-emerald-500/70">Running</div>
        </div>
        <div className="rounded-lg border border-slate-600/30 bg-slate-800/40 p-3 text-center">
          <div className="text-2xl font-bold text-slate-400">{stoppedSessions}</div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Stopped</div>
        </div>
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-center">
          <div className="text-2xl font-bold text-red-400">{blockedWorkers}</div>
          <div className="text-[10px] uppercase tracking-wider text-red-500/70">Blocked</div>
        </div>
        <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-3 text-center">
          <div className="text-2xl font-bold text-slate-200">
            {doneTasks}<span className="text-sm text-slate-500">/{totalTasks}</span>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Tasks Done</div>
        </div>
      </div>

      {/* Worker Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {workers.map(worker => (
          <WorkerCard
            key={worker.filename}
            worker={worker}
            session={findSession(worker)}
            lastReport={findLastReport(worker)}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="mt-4 text-center text-[10px] text-slate-600">
        Last parsed: {new Date(state.lastParsed).toLocaleTimeString('ko-KR')}
      </div>
    </div>
  );
}
