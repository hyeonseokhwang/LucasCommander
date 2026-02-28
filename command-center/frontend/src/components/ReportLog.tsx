import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

interface ReportEntry {
  type: 'report' | 'instruction';
  timestamp: string;
  worker: string;
  report?: string;
  instruction?: string;
  needsUserDecision?: boolean;
}

export function ReportLog() {
  const [history, setHistory] = useState<ReportEntry[]>([]);
  const [pending, setPending] = useState<any[]>([]);

  const refresh = useCallback(async () => {
    try {
      const data = await api.reports();
      setHistory(data.history || []);
      setPending(data.pending || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const recent = [...history].reverse().slice(0, 10);

  return (
    <div className="p-3">
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
        Reports
        {pending.length > 0 && (
          <span className="ml-2 px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded text-[10px]">
            {pending.length} queued
          </span>
        )}
      </h2>

      {recent.length === 0 ? (
        <div className="text-xs text-slate-500">No reports yet</div>
      ) : (
        <div className="space-y-1.5">
          {recent.map((entry, i) => (
            <div
              key={i}
              className={`p-1.5 rounded text-[11px] border ${
                entry.needsUserDecision
                  ? 'border-amber-500/30 bg-amber-500/5'
                  : entry.type === 'report'
                    ? 'border-blue-500/20 bg-blue-500/5'
                    : 'border-emerald-500/20 bg-emerald-500/5'
              }`}
            >
              <div className="flex items-center gap-1 mb-0.5">
                <span className={`font-medium ${
                  entry.type === 'report' ? 'text-blue-400' : 'text-emerald-400'
                }`}>
                  {entry.type === 'report' ? 'RPT' : 'CMD'}
                </span>
                <span className="text-slate-400">{entry.worker}</span>
                {entry.needsUserDecision && (
                  <span className="text-amber-400 ml-auto">NEEDS USER</span>
                )}
              </div>
              <div className="text-slate-300 truncate">
                {entry.report || entry.instruction || ''}
              </div>
              <div className="text-[9px] text-slate-600 mt-0.5">
                {new Date(entry.timestamp).toLocaleTimeString('ko-KR')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
