import { useState, useEffect } from 'react';
import { createCoordinationSocket } from '../lib/socket';
import { api } from '../lib/api';
import type { WorkerRequest } from '../types';

interface Props {
  onWorkersCreated?: () => void;
}

export function ApprovalBanner({ onWorkersCreated }: Props) {
  const [requests, setRequests] = useState<WorkerRequest[]>([]);
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    const socket = createCoordinationSocket();

    socket.on('worker-request', (req: WorkerRequest) => {
      setRequests(prev => {
        if (prev.find(r => r.requestId === req.requestId)) return prev;
        return [...prev, req];
      });
    });

    socket.on('worker-request-resolved', (req: WorkerRequest) => {
      setRequests(prev => prev.filter(r => r.requestId !== req.requestId));
    });

    // Fetch existing pending on mount
    api.workerRequests().then((all: WorkerRequest[]) => {
      setRequests(all.filter(r => r.status === 'pending'));
    }).catch(() => {});

    return () => { socket.disconnect(); };
  }, []);

  const handleApprove = async (requestId: string) => {
    setLoading(requestId);
    try {
      await api.approveRequest(requestId);
      setRequests(prev => prev.filter(r => r.requestId !== requestId));
      onWorkersCreated?.();
    } catch { /* ignore */ }
    setLoading(null);
  };

  const handleDeny = async (requestId: string) => {
    setLoading(requestId);
    try {
      await api.denyRequest(requestId);
      setRequests(prev => prev.filter(r => r.requestId !== requestId));
    } catch { /* ignore */ }
    setLoading(null);
  };

  if (requests.length === 0) return null;

  return (
    <div className="px-4 py-2 space-y-2">
      {requests.map(req => (
        <div
          key={req.requestId}
          className="flex items-start gap-3 p-3 rounded-lg bg-amber-900/30 border border-amber-600/40"
        >
          <div className="shrink-0 text-amber-400 text-lg mt-0.5">!</div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-amber-200">
              Commander requests {req.count} worker{req.count > 1 ? 's' : ''}
            </div>
            <div className="text-xs text-amber-300/70 mt-0.5">{req.reason}</div>
            {req.missions.length > 0 && (
              <div className="mt-1 space-y-0.5">
                {req.missions.map((m, i) => (
                  <div key={i} className="text-[10px] text-slate-400 truncate">
                    {i + 1}. {m}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={() => handleApprove(req.requestId)}
              disabled={loading === req.requestId}
              className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 rounded text-white transition-colors disabled:opacity-50"
            >
              {loading === req.requestId ? '...' : 'Approve'}
            </button>
            <button
              onClick={() => handleDeny(req.requestId)}
              disabled={loading === req.requestId}
              className="px-3 py-1.5 text-xs bg-red-600/80 hover:bg-red-500 rounded text-white transition-colors disabled:opacity-50"
            >
              Deny
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
