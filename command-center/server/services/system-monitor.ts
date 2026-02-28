import os from 'os';
import { execSync } from 'child_process';
import http from 'http';

export interface OllamaModelDetail {
  name: string;
  size: number;        // bytes
  sizeVram: number;    // bytes loaded in VRAM
  family: string;
  parameterSize: string;
  quantization: string;
  expiresAt: string;
}

export interface ServiceHealth {
  name: string;
  port: number;
  url: string;
  status: 'up' | 'down' | 'unknown';
  responseTimeMs: number;
}

export interface SystemSnapshot {
  cpu: { percent: number; cores: number; threads: number };
  ram: { usedGb: number; totalGb: number; percent: number };
  gpu: { name: string; utilPercent: number; memUsedMb: number; memTotalMb: number; tempC: number; powerW: number };
  ollama: { running: boolean; modelsCount: number; loadedModels: string[]; loadedModelDetails: OllamaModelDetail[] };
  services: ServiceHealth[];
  timestamp: string;
}

const SERVICES_TO_CHECK: { name: string; port: number; path: string }[] = [
  { name: 'Dashboard', port: 7777, path: '/' },
  { name: 'Scheduler', port: 7778, path: '/' },
  { name: 'Homepage', port: 3000, path: '/' },
  { name: '관자재', port: 3001, path: '/' },
];

class SystemMonitor {
  private interval: ReturnType<typeof setInterval> | null = null;
  private broadcaster: ((data: SystemSnapshot) => void) | null = null;
  latest: SystemSnapshot | null = null;

  // For CPU delta measurement
  private prevCpuTimes: { idle: number; total: number } | null = null;

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
    const [ollama, services] = await Promise.all([
      this.getOllama(),
      this.checkServices(),
    ]);
    return {
      cpu: this.getCpu(),
      ram: this.getRam(),
      gpu: this.getGpu(),
      ollama,
      services,
      timestamp: new Date().toISOString(),
    };
  }

  private getCpu() {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
      idle += cpu.times.idle;
      total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
    }

    let percent = 0;
    if (this.prevCpuTimes) {
      const idleDelta = idle - this.prevCpuTimes.idle;
      const totalDelta = total - this.prevCpuTimes.total;
      if (totalDelta > 0) {
        percent = Math.round((1 - idleDelta / totalDelta) * 100);
      }
    }
    this.prevCpuTimes = { idle, total };

    return {
      percent,
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

  private async getOllama(): Promise<SystemSnapshot['ollama']> {
    try {
      const [tags, ps] = await Promise.all([
        this.httpGet('http://localhost:11434/api/tags'),
        this.httpGet('http://localhost:11434/api/ps'),
      ]);

      const loadedModelDetails: OllamaModelDetail[] = (ps.models || []).map((m: any) => ({
        name: m.name || '',
        size: m.size || 0,
        sizeVram: m.size_vram || 0,
        family: m.details?.family || '',
        parameterSize: m.details?.parameter_size || '',
        quantization: m.details?.quantization_level || '',
        expiresAt: m.expires_at || '',
      }));

      return {
        running: true,
        modelsCount: tags.models?.length || 0,
        loadedModels: (ps.models || []).map((m: any) => m.name),
        loadedModelDetails,
      };
    } catch {
      return { running: false, modelsCount: 0, loadedModels: [], loadedModelDetails: [] };
    }
  }

  private async checkServices(): Promise<ServiceHealth[]> {
    const checks = SERVICES_TO_CHECK.map(svc => this.checkService(svc));
    return Promise.all(checks);
  }

  private checkService(svc: { name: string; port: number; path: string }): Promise<ServiceHealth> {
    return new Promise(resolve => {
      const start = Date.now();
      const url = `http://localhost:${svc.port}${svc.path}`;

      const req = http.get(url, { timeout: 2000 }, (res) => {
        const responseTimeMs = Date.now() - start;
        // Any response (even 404) means service is up
        res.resume(); // drain
        resolve({
          name: svc.name,
          port: svc.port,
          url,
          status: 'up',
          responseTimeMs,
        });
      });

      req.on('error', () => {
        resolve({
          name: svc.name,
          port: svc.port,
          url,
          status: 'down',
          responseTimeMs: Date.now() - start,
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          name: svc.name,
          port: svc.port,
          url,
          status: 'down',
          responseTimeMs: Date.now() - start,
        });
      });
    });
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
