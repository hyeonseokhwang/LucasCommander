import fs from 'fs';
import path from 'path';

interface WorkerTask {
  text: string;
  done: boolean;
}

interface WorkerStatus {
  filename: string;
  name: string;
  lastUpdated: string;
  tasks: WorkerTask[];
  requests: string[];
}

export interface CoordinationState {
  master: {
    lastUpdated: string;
    sessionCount: number;
    phases: WorkerTask[];
    prohibitions: string[];
  };
  workers: WorkerStatus[];
  lastParsed: string;
}

class CoordinationParser {
  private dir: string;
  private watcher: fs.FSWatcher | null = null;
  private state: CoordinationState | null = null;
  private onChange: ((state: CoordinationState) => void) | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dir: string) {
    this.dir = dir;
  }

  setOnChange(fn: (state: CoordinationState) => void) {
    this.onChange = fn;
  }

  startWatching() {
    if (!fs.existsSync(this.dir)) {
      console.log(`[Coordination] Directory not found: ${this.dir}`);
      return;
    }

    this.parse();

    this.watcher = fs.watch(this.dir, (_eventType, filename) => {
      if (filename?.endsWith('.md')) {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.parse(), 500);
      }
    });

    console.log(`[Coordination] Watching ${this.dir}`);
  }

  stop() {
    this.watcher?.close();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  parse(): CoordinationState {
    try {
      const files = fs.readdirSync(this.dir).filter(f => f.endsWith('.md'));
      const workers: WorkerStatus[] = [];
      let masterData = { lastUpdated: '', sessionCount: 0, phases: [] as WorkerTask[], prohibitions: [] as string[] };

      for (const file of files) {
        const content = fs.readFileSync(path.join(this.dir, file), 'utf-8');

        if (file === 'MASTER.md') {
          masterData = this.parseMaster(content);
        } else if (file.startsWith('worker-')) {
          workers.push(this.parseWorkerFile(file, content));
        }
      }

      this.state = {
        master: masterData,
        workers,
        lastParsed: new Date().toISOString(),
      };

      if (this.onChange) this.onChange(this.state);
      return this.state;
    } catch (err) {
      console.error('[Coordination] Parse error:', err);
      return this.state || {
        master: { lastUpdated: '', sessionCount: 0, phases: [], prohibitions: [] },
        workers: [],
        lastParsed: new Date().toISOString(),
      };
    }
  }

  private parseWorkerFile(filename: string, content: string): WorkerStatus {
    const tasks: WorkerTask[] = [];
    const requests: string[] = [];
    const name = filename.replace('.md', '').replace('worker-', '');

    // Extract tasks (checkboxes)
    const taskRegex = /- \[([ x])\] (.+)/g;
    let match;
    while ((match = taskRegex.exec(content)) !== null) {
      tasks.push({ text: match[2].trim(), done: match[1] === 'x' });
    }

    // Extract last updated
    const updateMatch = content.match(/마지막 업데이트:\s*(.+)/);
    const lastUpdated = updateMatch ? updateMatch[1].trim() : '';

    // Extract requests
    const requestSection = content.match(/## 사령탑에[^\n]*\n([\s\S]*?)(?=\n## |\n---|\z)/);
    if (requestSection) {
      const numbered = requestSection[1].match(/\d+\.\s\*\*[^*]+\*\*/g);
      if (numbered) requests.push(...numbered.map(l => l.replace(/^\d+\.\s*/, '').replace(/\*\*/g, '')));
    }

    return { filename, name, lastUpdated, tasks, requests };
  }

  private parseMaster(content: string) {
    let lastUpdated = '';
    const phases: WorkerTask[] = [];
    const prohibitions: string[] = [];

    const updateMatch = content.match(/마지막 업데이트:\s*(.+)/);
    if (updateMatch) lastUpdated = updateMatch[1].trim();

    // Extract phases
    const phaseRegex = /- \[([ x진행중대기]*)?\] (.+)/g;
    let match;
    while ((match = phaseRegex.exec(content)) !== null) {
      const status = match[1]?.trim() || '';
      phases.push({
        text: match[2].trim(),
        done: status === 'x',
      });
    }

    // Extract prohibitions
    const prohibSection = content.match(/## 금지사항[\s\S]*?(?=\n## |\z)/);
    if (prohibSection) {
      const lines = prohibSection[0].split('\n').filter(l => /^\d+\./.test(l.trim()));
      prohibitions.push(...lines.map(l => l.replace(/^\d+\.\s*/, '').trim()));
    }

    // Count sessions from table
    const sessionRows = content.match(/\| \*\*.*?\*\* \|/g);
    const sessionCount = sessionRows ? sessionRows.length : 0;

    return { lastUpdated, sessionCount, phases, prohibitions };
  }

  getState(): CoordinationState | null {
    return this.state;
  }
}

export const coordinationParser = new CoordinationParser('G:\\Lucas-Initiative\\.coordination');
