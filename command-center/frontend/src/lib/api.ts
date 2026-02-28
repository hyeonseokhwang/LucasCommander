const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export const api = {
  health: () => request<{ status: string; activeSessions: number }>('/health'),
  sessions: () => request<any[]>('/sessions'),
  activeSessions: () => request<any[]>('/sessions/active'),
  spawn: (id: string) => request<any>(`/sessions/${id}/spawn`, { method: 'POST' }),
  kill: (id: string) => request<any>(`/sessions/${id}/kill`, { method: 'POST' }),
  reports: () => request<any>('/reports'),
  report: (worker: string, report: string, needsUserDecision = false) =>
    request<any>('/report', {
      method: 'POST',
      body: JSON.stringify({ worker, report, needsUserDecision }),
    }),
  instruct: (worker: string, instruction: string) =>
    request<any>('/instruct', {
      method: 'POST',
      body: JSON.stringify({ worker, instruction }),
    }),

  // Dynamic workers
  createWorker: (opts: { mission?: string; targetProject?: string; autoSpawn?: boolean }) =>
    request<any>('/workers', { method: 'POST', body: JSON.stringify(opts) }),
  deleteWorker: (id: string) =>
    request<any>(`/workers/${id}`, { method: 'DELETE', body: JSON.stringify({ archive: true }) }),
  listWorkers: () => request<any[]>('/workers'),
  workerRequests: () => request<any[]>('/workers/requests'),
  approveRequest: (requestId: string) =>
    request<any>(`/workers/requests/${requestId}/approve`, { method: 'POST' }),
  denyRequest: (requestId: string) =>
    request<any>(`/workers/requests/${requestId}/deny`, { method: 'POST' }),
};
