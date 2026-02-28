import os from 'os';
import { execSync } from 'child_process';
import http from 'http';

export interface SystemSnapshot {
  cpu: { percent: number; cores: number; threads: number };
  ram: { usedGb: number; totalGb: number; percent: number };
  gpu: { name: string; utilPercent: number; memUsedMb: number; memTotalMb: number; tempC: number; powerW: number };
  ollama: { running: boolean; modelsCount: number; loadedModels: string[] };
  timestamp: string;
}

class SystemMonitor {
  private interval: ReturnType<typeof setInterval> | null = null;
  private broadcaster: ((data: SystemSnapshot) => void) | null = null;
  latest: SystemSnapshot | null = null;

  setBroadcaster(fn: (data: SystemSnapshot) => void) {
    this.broadcaster = fn;
  }

  startPolling(intervalMs: number = 3000) {
    // Immediate first poll
    this.poll();
    this.interval = setInterval(() => this.poll(), intervalMs);
    console.log(`[Monitor] Polling every ${intervalMs}ms`);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async poll() {
    const snapshot = await this.getSnapshot();
    this.latest = snapshot;
    if (this.broadcaster) this.broadcaster(snapshot);
  }

  async getSnapshot(): Promise<SystemSnapshot> {
    const [ollama] = await Promise.all([this.getOllama()]);
    return {
      cpu: this.getCpu(),
      ram: this.getRam(),
      gpu: this.getGpu(),
      ollama,
      timestamp: new Date().toISOString(),
    };
  }

  private getCpu() {
    const cpus = os.cpus();
    return {
      percent: 0, // Accurate CPU % requires delta measurement; placeholder
      cores: Math.floor(cpus.length / 2),
      threads: cpus.length,
    };
  }

  private getRam() {
    const totalGb = +(os.totalmem() / (1024 ** 3)).toFixed(1);
    const freeGb = +(os.freemem() / (1024 ** 3)).toFixed(1);
    const usedGb = +(totalGb - freeGb).toFixed(1);
    return {
      usedGb,
      totalGb,
      percent: Math.round((usedGb / totalGb) * 100),
    };
  }

  private getGpu() {
    try {
      const result = execSync(
        'nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits',
        { timeout: 5000, encoding: 'utf-8' }
      );
      const parts = result.trim().split(',').map(s => s.trim());
      return {
        name: parts[0] || 'Unknown',
        utilPercent: parseInt(parts[1]) || 0,
        memUsedMb: parseInt(parts[2]) || 0,
        memTotalMb: parseInt(parts[3]) || 0,
        tempC: parseInt(parts[4]) || 0,
        powerW: parseFloat(parts[5]) || 0,
      };
    } catch {
      return { name: 'N/A', utilPercent: 0, memUsedMb: 0, memTotalMb: 0, tempC: 0, powerW: 0 };
    }
  }

  private async getOllama(): Promise<{ running: boolean; modelsCount: number; loadedModels: string[] }> {
    try {
      const [tags, ps] = await Promise.all([
        this.httpGet('http://localhost:11434/api/tags'),
        this.httpGet('http://localhost:11434/api/ps'),
      ]);
      return {
        running: true,
        modelsCount: tags.models?.length || 0,
        loadedModels: (ps.models || []).map((m: any) => m.name),
      };
    } catch {
      return { running: false, modelsCount: 0, loadedModels: [] };
    }
  }

  private httpGet(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const req = http.get(url, { timeout: 3000 }, (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('Invalid JSON')); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
  }
}

export const systemMonitor = new SystemMonitor();
