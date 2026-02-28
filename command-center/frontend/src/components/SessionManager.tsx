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
  const [showCreate, setShowCreate] = useState(false);
  const [newMission, setNewMission] = useState('');
  const [newProject, setNewProject] = useState('');

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
  }, [fetchConfigs, activeSessions]);

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

  const handleCreateWorker = async () => {
    setError(null);
    setLoading('creating');
    try {
      const result = await api.createWorker({
        mission: newMission || undefined,
        targetProject: newProject || undefined,
        autoSpawn: true,
      });
      onSessionSpawned({
        id: result.id,
        name: result.name,
        color: result.color,
      });
      setShowCreate(false);
      setNewMission('');
      setNewProject('');
      fetchConfigs();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(null);
    }
  };

  const handleDeleteWorker = async (id: string) => {
    setLoading(id);
    setError(null);
    try {
      await api.deleteWorker(id);
      onSessionKilled(id);
      fetchConfigs();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Sessions
        </h2>
        <button
          onClick={() => setShowCreate(v => !v)}
          className="text-[10px] px-1.5 py-0.5 bg-blue-600/60 hover:bg-blue-500 rounded text-white transition-colors"
        >
          + Worker
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-400/10 rounded px-2 py-1 mb-2">
          {error}
        </div>
      )}

      {showCreate && (
        <div className="mb-3 p-2 rounded-lg bg-blue-900/20 border border-blue-700/30 space-y-2">
          <input
            type="text"
            value={newMission}
            onChange={e => setNewMission(e.target.value)}
            placeholder="Mission (optional)"
            className="w-full text-xs bg-slate-800 text-slate-200 rounded px-2 py-1 border border-slate-700 focus:outline-none focus:border-blue-500"
          />
          <select
            value={newProject}
            onChange={e => setNewProject(e.target.value)}
            className="w-full text-xs bg-slate-800 text-slate-200 rounded px-2 py-1 border border-slate-700 focus:outline-none focus:border-blue-500"
          >
            <option value="">Target Project (optional)</option>
            <option value="dashboard">Dashboard (:7777)</option>
            <option value="scheduler">Scheduler (:7778)</option>
            <option value="command-center">Command Center (:9000)</option>
            <option value="benchmarker">Benchmarker</option>
          </select>
          <div className="flex gap-1">
            <button
              onClick={handleCreateWorker}
              disabled={loading === 'creating'}
              className="flex-1 text-xs py-1 bg-emerald-600/80 hover:bg-emerald-500 rounded text-white transition-colors disabled:opacity-50"
            >
              {loading === 'creating' ? '...' : 'Create & Start'}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-2 text-xs py-1 bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {configs.map(config => {
          const isActive = activeIds.has(config.id);
          const isLoading = loading === config.id;
          const isDynamic = config.type === 'dynamic';

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
                <div className="flex items-center gap-1">
                  <span className="text-sm font-medium text-slate-200 truncate">
                    {config.name}
                  </span>
                  {isDynamic && (
                    <span className="text-[9px] px-1 py-0.5 bg-blue-600/30 text-blue-300 rounded">
                      dynamic
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  {config.mission || config.cwd}
                </div>
              </div>
              <div className="flex items-center gap-1">
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
                {isDynamic && (
                  <button
                    onClick={() => handleDeleteWorker(config.id)}
                    disabled={isLoading}
                    className="px-1.5 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors min-h-[32px]"
                    title="Delete worker"
                  >
                    &times;
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
