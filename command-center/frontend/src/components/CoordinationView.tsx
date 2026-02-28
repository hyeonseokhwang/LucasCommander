import { useCoordination } from '../hooks/useCoordination';

export function CoordinationView() {
  const state = useCoordination();

  if (!state) {
    return (
      <div className="p-3">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Coordination
        </h2>
        <div className="text-xs text-slate-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-3">
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
        Coordination
      </h2>

      {/* Master status */}
      <div className="mb-3 p-2 rounded bg-slate-800/50 border border-slate-700/30">
        <div className="text-xs font-medium text-amber-400 mb-1">MASTER</div>
        <div className="text-[10px] text-slate-500">
          Updated: {state.master.lastUpdated || 'N/A'}
        </div>
        {state.master.phases.length > 0 && (
          <div className="mt-1.5 space-y-0.5">
            {state.master.phases.slice(0, 5).map((p, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px]">
                <span className={p.done ? 'text-emerald-400' : 'text-slate-500'}>
                  {p.done ? '[x]' : '[ ]'}
                </span>
                <span className={`truncate ${p.done ? 'text-slate-500 line-through' : 'text-slate-300'}`}>
                  {p.text}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Workers */}
      {state.workers.map(worker => (
        <div
          key={worker.filename}
          className="mb-2 p-2 rounded bg-slate-800/50 border border-slate-700/30"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-blue-400 capitalize">
              {worker.name}
            </span>
            <span className="text-[10px] text-slate-600">
              {worker.tasks.filter(t => t.done).length}/{worker.tasks.length}
            </span>
          </div>
          <div className="text-[10px] text-slate-500 mb-1">
            {worker.lastUpdated || 'No update'}
          </div>

          {/* Tasks */}
          {worker.tasks.length > 0 && (
            <div className="space-y-0.5 mt-1">
              {worker.tasks.slice(-4).map((t, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[11px]">
                  <span className={t.done ? 'text-emerald-400' : 'text-yellow-400'}>
                    {t.done ? '[x]' : '[ ]'}
                  </span>
                  <span className={`truncate ${t.done ? 'text-slate-500' : 'text-slate-300'}`}>
                    {t.text}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Requests */}
          {worker.requests.length > 0 && (
            <div className="mt-1.5 pt-1 border-t border-slate-700/30">
              <div className="text-[10px] text-orange-400 mb-0.5">Requests:</div>
              {worker.requests.slice(0, 2).map((r, i) => (
                <div key={i} className="text-[10px] text-slate-400 truncate">
                  {r}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
