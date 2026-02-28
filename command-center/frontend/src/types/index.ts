export interface SessionConfig {
  id: string;
  name: string;
  cwd: string;
  command: string;
  autoStart: boolean;
  color: string;
  running?: boolean;
  pid?: number;
  type?: 'commander' | 'static' | 'dynamic';
  mission?: string;
  targetProject?: string;
}

export interface ActiveSession {
  id: string;
  name: string;
  color: string;
}

export interface WorkerRequest {
  requestId: string;
  type: 'create' | 'cleanup';
  reason: string;
  count: number;
  missions: string[];
  targetProject?: string;
  status: 'pending' | 'approved' | 'denied';
  requestedAt: string;
  createdWorkers?: string[];
}

export interface SystemMetrics {
  cpu: { percent: number; cores: number; threads: number };
  ram: { usedGb: number; totalGb: number; percent: number };
  gpu: { name: string; utilPercent: number; memUsedMb: number; memTotalMb: number; tempC: number };
  ollama: { running: boolean; modelsCount: number; loadedModels: string[] };
  timestamp: string;
}

export interface ClaudeUsageWindow {
  utilization: number;
  resetsAt: string;
}

export interface ClaudeUsageData {
  fiveHour: ClaudeUsageWindow;
  sevenDay: ClaudeUsageWindow;
  sevenDayOpus: ClaudeUsageWindow | null;
  sevenDaySonnet: ClaudeUsageWindow | null;
  subscriptionType: string;
  rateLimitTier: string;
  timestamp: string;
  error: string | null;
}
