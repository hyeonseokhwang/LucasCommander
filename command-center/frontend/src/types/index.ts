export interface SessionConfig {
  id: string;
  name: string;
  cwd: string;
  command: string;
  autoStart: boolean;
  color: string;
  running?: boolean;
  pid?: number;
}

export interface ActiveSession {
  id: string;
  name: string;
  color: string;
}

export interface SystemMetrics {
  cpu: { percent: number; cores: number; threads: number };
  ram: { usedGb: number; totalGb: number; percent: number };
  gpu: { name: string; utilPercent: number; memUsedMb: number; memTotalMb: number; tempC: number };
  ollama: { running: boolean; modelsCount: number; loadedModels: string[] };
  timestamp: string;
}
