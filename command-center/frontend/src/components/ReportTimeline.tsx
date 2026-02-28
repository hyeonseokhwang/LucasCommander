import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

interface TimelineEntry {
  type: 'report' | 'instruction';
  timestamp: string;
  worker: string;
  report?: string;
  instruction?: string;
  needsUserDecision?: boolean;
  file?: string;
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
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

function TimelineItem({ entry, expanded, onToggle }: { entry: TimelineEntry; expanded: boolean; onToggle: () => void }) {
  const isReport = entry.type === 'report';
  const content = entry.report || entry.instruction || '';

  return (
    <div className="relative pl-6">
      {/* Timeline dot */}
      <div className={`absolute left-0 top-2 w-3 h-3 rounded-full border-2 ${
        entry.needsUserDecision
          ? 'bg-amber-400 border-amber-500'
          : isReport
            ? 'bg-blue-400 border-blue-500'
            : 'bg-emerald-400 border-emerald-500'
      }`} />

      {/* Timeline line (vertical) */}
      <div className="absolute left-[5px] top-5 bottom-0 w-0.5 bg-slate-700/50" />

      {/* Content card */}
      <div
        className={`mb-3 p-3 rounded-lg border cursor-pointer transition-colors ${
          entry.needsUserDecision
            ? 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10'
            : isReport
              ? 'border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/10'
              : 'border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10'
        }`}
        onClick={onToggle}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
              isReport
                ? 'bg-blue-500/20 text-blue-400'
                : 'bg-emerald-500/20 text-emerald-400'
            }`}>
              {isReport ? 'RPT' : 'CMD'}
            </span>
            <span className="text-xs font-medium text-slate-300">{entry.worker}</span>
            {entry.needsUserDecision && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">
                NEEDS DECISION
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500" title={new Date(entry.timestamp).toLocaleString('ko-KR')}>
              {relativeTime(entry.timestamp)}
            </span>
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className={`text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </div>

        {/* Preview / Full content */}
        <div className={`text-xs text-slate-300 ${expanded ? '' : 'line-clamp-2'}`}>
          {content}
        </div>

        {/* Expanded footer */}
        {expanded && (
          <div className="mt-2 pt-2 border-t border-slate-700/30 flex items-center justify-between">
            <span className="text-[9px] text-slate-600">
              {formatDate(entry.timestamp)} {formatTime(entry.timestamp)}
            </span>
            {entry.file && (
              <span className="text-[9px] text-slate-600 font-mono">
                {entry.file}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ReportTimeline() {
  const [history, setHistory] = useState<TimelineEntry[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'report' | 'instruction'>('all');

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

  // Sort newest first
  const sorted = [...history]
    .reverse()
    .filter(e => filter === 'all' || e.type === filter);

  const reportCount = history.filter(e => e.type === 'report').length;
  const instructionCount = history.filter(e => e.type === 'instruction').length;

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/60 overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-700/30">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <h3 className="text-sm font-semibold text-slate-200">Report / Instruction Timeline</h3>
          </div>
          {pending.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded">
              {pending.length} queued
            </span>
          )}
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-1">
          <button
            onClick={() => setFilter('all')}
            className={`text-[10px] px-2 py-1 rounded transition-colors ${
              filter === 'all' ? 'bg-slate-700 text-slate-200' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            All ({history.length})
          </button>
          <button
            onClick={() => setFilter('report')}
            className={`text-[10px] px-2 py-1 rounded transition-colors ${
              filter === 'report' ? 'bg-blue-500/20 text-blue-400' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Reports ({reportCount})
          </button>
          <button
            onClick={() => setFilter('instruction')}
            className={`text-[10px] px-2 py-1 rounded transition-colors ${
              filter === 'instruction' ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Instructions ({instructionCount})
          </button>
        </div>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto p-4">
        {sorted.length === 0 ? (
          <div className="text-center text-sm text-slate-500 py-8">
            No {filter === 'all' ? 'entries' : filter + 's'} yet
          </div>
        ) : (
          <div>
            {sorted.map((entry, i) => (
              <TimelineItem
                key={`${entry.timestamp}-${i}`}
                entry={entry}
                expanded={expandedIdx === i}
                onToggle={() => setExpandedIdx(expandedIdx === i ? null : i)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
