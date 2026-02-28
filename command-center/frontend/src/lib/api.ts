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
};
