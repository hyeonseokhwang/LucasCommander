import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import type { SessionConfig, ActiveSession } from '../types';

interface Props {
  activeSessions: ActiveSession[];
  onSessionSpawned: (session: ActiveSession) => void;
  onSessionKilled: (id: string) => void;
}

export function SessionManager({ activeSessions, onSessionSpawned, onSessionKilled }: Props) {
  const [configs, setConfigs] = useState<SessionConfig[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeIds = new Set(activeSessions.map(s => s.id));

  const fetchConfigs = useCallback(async () => {
    try {
      const data = await api.sessions();
      setConfigs(data);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  const handleSpawn = async (config: SessionConfig) => {
    setLoading(config.id);
    setError(null);
    try {
      await api.spawn(config.id);
      onSessionSpawned({
        id: config.id,
        name: config.name,
        color: config.color,
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(null);
    }
  };

  const handleKill = async (id: string) => {
    setLoading(id);
    setError(null);
    try {
      await api.kill(id);
      onSessionKilled(id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="p-3">
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
        Sessions
      </h2>

      {error && (
        <div className="text-xs text-red-400 bg-red-400/10 rounded px-2 py-1 mb-2">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {configs.map(config => {
          const isActive = activeIds.has(config.id);
          const isLoading = loading === config.id;

          return (
            <div
              key={config.id}
              className="flex items-center gap-2 p-2 rounded-lg bg-slate-800/50 border border-slate-700/30"
            >
              <div
                className={`w-2.5 h-2.5 rounded-full shrink-0 ${isActive ? 'animate-pulse' : 'opacity-40'}`}
                style={{ backgroundColor: config.color }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-200 truncate">
                  {config.name}
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  {config.cwd}
                </div>
              </div>
              {isActive ? (
                <button
                  onClick={() => handleKill(config.id)}
                  disabled={isLoading}
                  className="px-2 py-1 text-xs bg-red-600/80 hover:bg-red-500 rounded text-white transition-colors disabled:opacity-50 min-h-[32px]"
                >
                  {isLoading ? '...' : 'Stop'}
                </button>
              ) : (
                <button
                  onClick={() => handleSpawn(config)}
                  disabled={isLoading}
                  className="px-2 py-1 text-xs bg-emerald-600/80 hover:bg-emerald-500 rounded text-white transition-colors disabled:opacity-50 min-h-[32px]"
                >
                  {isLoading ? '...' : 'Start'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
