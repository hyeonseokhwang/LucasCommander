import { useSystemMonitor } from '../hooks/useSystemMonitor';

export function SystemMonitor() {
  const metrics = useSystemMonitor();

  if (!metrics) {
    return (
      <div className="p-3">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          System
        </h2>
        <div className="text-xs text-slate-500">Connecting...</div>
      </div>
    );
  }

  const gpuMemPercent = metrics.gpu.memTotalMb
    ? Math.round((metrics.gpu.memUsedMb / metrics.gpu.memTotalMb) * 100)
    : 0;

  return (
    <div className="p-3">
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
        System
      </h2>
      <div className="space-y-2">
        {/* GPU */}
        <MetricBar
          label="GPU"
          detail={`${metrics.gpu.memUsedMb}/${metrics.gpu.memTotalMb}MB | ${metrics.gpu.tempC}C`}
          percent={gpuMemPercent}
          color="bg-purple-500"
        />

        {/* RAM */}
        <MetricBar
          label="RAM"
          detail={`${metrics.ram.usedGb}/${metrics.ram.totalGb}GB`}
          percent={metrics.ram.percent}
          color="bg-blue-500"
        />

        {/* Ollama */}
        <div className="flex items-center gap-2 text-xs">
          <div className={`w-2 h-2 rounded-full ${metrics.ollama.running ? 'bg-emerald-400' : 'bg-red-400'}`} />
          <span className="text-slate-300">Ollama</span>
          <span className="text-slate-500 ml-auto">{metrics.ollama.modelsCount} models</span>
        </div>
        {metrics.ollama.loadedModels.length > 0 && (
          <div className="text-[10px] text-slate-500 pl-4">
            Loaded: {metrics.ollama.loadedModels.join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}

function MetricBar({ label, detail, percent, color }: {
  label: string;
  detail: string;
  percent: number;
  color: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-slate-300">{label}</span>
        <span className="text-slate-500">{detail}</span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
}
