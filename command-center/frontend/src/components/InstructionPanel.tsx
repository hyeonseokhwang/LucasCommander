import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

interface SessionInfo {
  id: string;
  name: string;
  running: boolean;
  color: string;
}

export function InstructionPanel() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedWorker, setSelectedWorker] = useState('');
  const [instruction, setInstruction] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const data = await api.sessions();
      setSessions(data.filter((s: any) => s.id !== 'commander'));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 10000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const runningSessions = sessions.filter(s => s.running);

  const handleSend = async () => {
    if (!selectedWorker || !instruction.trim()) return;

    setSending(true);
    setResult(null);
    try {
      const res = await api.instruct(selectedWorker, instruction.trim());
      setResult({ type: 'success', message: `Instruction delivered to ${selectedWorker} (${res.file})` });
      setInstruction('');
    } catch (err: any) {
      setResult({ type: 'error', message: err.message });
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSend();
    }
  };

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/60 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-700/30 flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-400">
          <path d="M22 2L11 13" />
          <path d="M22 2L15 22L11 13L2 9L22 2Z" />
        </svg>
        <h3 className="text-sm font-semibold text-slate-200">Commander Instruction Panel</h3>
      </div>

      <div className="p-4 space-y-3">
        {/* Worker Selection */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 block">
            Target Worker
          </label>
          <select
            value={selectedWorker}
            onChange={e => setSelectedWorker(e.target.value)}
            className="w-full text-sm bg-slate-900 text-slate-200 rounded-md px-3 py-2 border border-slate-700 focus:outline-none focus:border-blue-500 transition-colors"
          >
            <option value="">Select a worker...</option>
            {sessions.map(s => (
              <option key={s.id} value={s.id} disabled={!s.running}>
                {s.name} {s.running ? '(running)' : '(stopped)'}
              </option>
            ))}
          </select>
          {runningSessions.length === 0 && (
            <div className="text-[10px] text-amber-400 mt-1">No running workers available</div>
          )}
        </div>

        {/* Instruction Text */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 block">
            Instruction
          </label>
          <textarea
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter instruction for the worker..."
            rows={4}
            className="w-full text-sm bg-slate-900 text-slate-200 rounded-md px-3 py-2 border border-slate-700 focus:outline-none focus:border-blue-500 transition-colors resize-y placeholder-slate-600"
          />
          <div className="text-[9px] text-slate-600 mt-0.5">Ctrl+Enter to send</div>
        </div>

        {/* Send Button */}
        <button
          onClick={handleSend}
          disabled={sending || !selectedWorker || !instruction.trim()}
          className="w-full py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-md transition-colors"
        >
          {sending ? 'Sending...' : 'Send Instruction'}
        </button>

        {/* Result Feedback */}
        {result && (
          <div className={`text-xs p-2 rounded-md ${
            result.type === 'success'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-red-500/10 text-red-400 border border-red-500/20'
          }`}>
            {result.message}
          </div>
        )}
      </div>
    </div>
  );
}
