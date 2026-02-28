import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export interface PersistedSession {
  id: string;
  name: string;
  cwd: string;
  command: string;
  status: 'running' | 'stopped';
  spawnedAt: string;
}

interface RuntimeState {
  version: number;
  savedAt: string;
  sessions: PersistedSession[];
}

class SessionStateManager {
  private currentSessions = new Map<string, PersistedSession>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor() {
    const dir = path.dirname(config.runtimeStateFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  sessionStarted(info: Omit<PersistedSession, 'status'>): void {
    this.currentSessions.set(info.id, { ...info, status: 'running' });
    this.scheduleSave();
  }

  sessionStopped(sessionId: string): void {
    this.currentSessions.delete(sessionId);
    this.scheduleSave();
  }

  loadState(): PersistedSession[] {
    try {
      const data = fs.readFileSync(config.runtimeStateFile, 'utf-8');
      const state: RuntimeState = JSON.parse(data);
      return state.sessions.filter(s => s.status === 'running');
    } catch {
      return [];
    }
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.dirty) {
        this.saveNow();
        this.dirty = false;
      }
    }, 500);
  }

  saveNow(): void {
    const state: RuntimeState = {
      version: 1,
      savedAt: new Date().toISOString(),
      sessions: Array.from(this.currentSessions.values()),
    };
    fs.writeFileSync(config.runtimeStateFile, JSON.stringify(state, null, 2), 'utf-8');
  }

  shutdown(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveNow();
  }
}

export const sessionState = new SessionStateManager();
