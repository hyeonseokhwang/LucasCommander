import fs from 'fs';
import https from 'https';
import path from 'path';
import os from 'os';

export interface ClaudeUsageWindow {
  utilization: number;
  resetsAt: string;
}

export interface ClaudeUsageSnapshot {
  fiveHour: ClaudeUsageWindow;
  sevenDay: ClaudeUsageWindow;
  sevenDayOpus: ClaudeUsageWindow | null;
  sevenDaySonnet: ClaudeUsageWindow | null;
  subscriptionType: string;
  rateLimitTier: string;
  timestamp: string;
  error: string | null;
}

const CREDENTIALS_PATH = path.join(os.homedir(), '.claude', '.credentials.json');
const USAGE_API_URL = 'https://api.anthropic.com/api/oauth/usage';

class ClaudeUsageMonitor {
  private interval: ReturnType<typeof setInterval> | null = null;
  private broadcaster: ((data: ClaudeUsageSnapshot) => void) | null = null;
  latest: ClaudeUsageSnapshot | null = null;

  setBroadcaster(fn: (data: ClaudeUsageSnapshot) => void) {
    this.broadcaster = fn;
  }

  startPolling(intervalMs: number = 180_000) {
    this.poll();
    this.interval = setInterval(() => this.poll(), intervalMs);
    console.log(`[ClaudeUsage] Polling every ${intervalMs / 1000}s`);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async poll() {
    const snapshot = await this.fetchUsage();
    this.latest = snapshot;
    if (this.broadcaster) this.broadcaster(snapshot);
  }

  private readToken(): { accessToken: string; subscriptionType: string; rateLimitTier: string } | null {
    try {
      const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
      const creds = JSON.parse(raw);
      const oauth = creds.claudeAiOauth;
      if (!oauth?.accessToken) return null;
      return {
        accessToken: oauth.accessToken,
        subscriptionType: oauth.subscriptionType || 'unknown',
        rateLimitTier: oauth.rateLimitTier || 'unknown',
      };
    } catch {
      return null;
    }
  }

  private parseWindow(raw: any): ClaudeUsageWindow | null {
    if (!raw || raw.utilization == null) return null;
    return {
      utilization: raw.utilization,
      resetsAt: raw.resets_at || '',
    };
  }

  private async fetchUsage(): Promise<ClaudeUsageSnapshot> {
    const token = this.readToken();
    if (!token) {
      return this.errorSnapshot('Credentials not found');
    }

    try {
      const data = await this.httpsGet(USAGE_API_URL, {
        'Authorization': `Bearer ${token.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
      });

      return {
        fiveHour: this.parseWindow(data.five_hour) || { utilization: 0, resetsAt: '' },
        sevenDay: this.parseWindow(data.seven_day) || { utilization: 0, resetsAt: '' },
        sevenDayOpus: this.parseWindow(data.seven_day_opus),
        sevenDaySonnet: this.parseWindow(data.seven_day_sonnet),
        subscriptionType: token.subscriptionType,
        rateLimitTier: token.rateLimitTier,
        timestamp: new Date().toISOString(),
        error: null,
      };
    } catch (err: any) {
      return this.errorSnapshot(err.message || 'API request failed');
    }
  }

  private errorSnapshot(error: string): ClaudeUsageSnapshot {
    return {
      fiveHour: { utilization: 0, resetsAt: '' },
      sevenDay: { utilization: 0, resetsAt: '' },
      sevenDayOpus: null,
      sevenDaySonnet: null,
      subscriptionType: 'unknown',
      rateLimitTier: 'unknown',
      timestamp: new Date().toISOString(),
      error,
    };
  }

  private httpsGet(url: string, headers: Record<string, string>): Promise<any> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const req = https.get(
        {
          hostname: parsedUrl.hostname,
          path: parsedUrl.pathname,
          headers,
          timeout: 10_000,
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
              return;
            }
            try {
              resolve(JSON.parse(body));
            } catch {
              reject(new Error('Invalid JSON response'));
            }
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }
}

export const claudeUsageMonitor = new ClaudeUsageMonitor();
