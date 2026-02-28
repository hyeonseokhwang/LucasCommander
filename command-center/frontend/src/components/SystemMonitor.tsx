import { useSystemMonitor } from '../hooks/useSystemMonitor';
import { useClaudeUsage } from '../hooks/useClaudeUsage';

function formatResetTime(resetsAt: string): string {
  if (!resetsAt) return '';
  const reset = new Date(resetsAt);
  const now = new Date();
  const diffMs = reset.getTime() - now.getTime();
  if (diffMs <= 0) return 'resetting...';
  const hours = Math.floor(diffMs / 3_600_000);
  const mins = Math.floor((diffMs % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function usageBarColor(utilization: number): string {
  if (utilization >= 80) return 'bg-red-500';
  if (utilization >= 50) return 'bg-amber-500';
  return 'bg-emerald-500';
}

export function SystemMonitor() {
  const metrics = useSystemMonitor();
  const claudeUsage = useClaudeUsage();

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

      {/* Claude Usage */}
      {claudeUsage && !claudeUsage.error && (
        <>
          <div className="border-t border-slate-800 my-3" />
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Claude Usage
          </h2>
          <div className="space-y-2">
            <MetricBar
              label="5h Window"
              detail={`${claudeUsage.fiveHour.utilization}% | ${formatResetTime(claudeUsage.fiveHour.resetsAt)}`}
              percent={claudeUsage.fiveHour.utilization}
              color={usageBarColor(claudeUsage.fiveHour.utilization)}
            />
            <MetricBar
              label="7d Window"
              detail={`${claudeUsage.sevenDay.utilization}% | ${formatResetTime(claudeUsage.sevenDay.resetsAt)}`}
              percent={claudeUsage.sevenDay.utilization}
              color={usageBarColor(claudeUsage.sevenDay.utilization)}
            />
            {claudeUsage.sevenDayOpus && (
              <MetricBar
                label="7d Opus"
                detail={`${claudeUsage.sevenDayOpus.utilization}%`}
                percent={claudeUsage.sevenDayOpus.utilization}
                color={usageBarColor(claudeUsage.sevenDayOpus.utilization)}
              />
            )}
            {claudeUsage.sevenDaySonnet && claudeUsage.sevenDaySonnet.utilization > 0 && (
              <MetricBar
                label="7d Sonnet"
                detail={`${claudeUsage.sevenDaySonnet.utilization}%`}
                percent={claudeUsage.sevenDaySonnet.utilization}
                color={usageBarColor(claudeUsage.sevenDaySonnet.utilization)}
              />
            )}
            <div className="text-[10px] text-slate-500">
              {claudeUsage.subscriptionType} | {claudeUsage.rateLimitTier.replace('default_claude_', '')}
            </div>
          </div>
        </>
      )}
      {claudeUsage?.error && (
        <>
          <div className="border-t border-slate-800 my-3" />
          <div className="text-[10px] text-red-400">
            Claude Usage: {claudeUsage.error}
          </div>
        </>
      )}
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
