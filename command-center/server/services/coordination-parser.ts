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
  scope: string;
  stack: string;
  port: string;
  completedSections: string[];
  reportItems: string[];
  statusSummary: string;
}

export interface CoordinationState {
  master: {
    lastUpdated: string;
    sessionCount: number;
    phases: WorkerTask[];
    prohibitions: string[];
    rawContent: string;
    sessionTable: { name: string; role: string; status: string; code: string }[];
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
      let masterData = { lastUpdated: '', sessionCount: 0, phases: [] as WorkerTask[], prohibitions: [] as string[], rawContent: '', sessionTable: [] as { name: string; role: string; status: string; code: string }[] };

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
        master: { lastUpdated: '', sessionCount: 0, phases: [], prohibitions: [], rawContent: '', sessionTable: [] },
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
    const updateMatch = content.match(/마지막 업데이트:\s*(.+)/) || content.match(/Last updated:\s*(.+)/);
    const lastUpdated = updateMatch ? updateMatch[1].trim() : '';

    // Extract scope (담당 범위)
    const scopeMatch = content.match(/## 담당 범위\n([\s\S]*?)(?=\n---|\n## )/);
    const scope = scopeMatch ? scopeMatch[1].replace(/^- /gm, '').trim().split('\n')[0] : '';

    // Extract stack
    const stackMatch = content.match(/스택:\s*(.+)/);
    const stack = stackMatch ? stackMatch[1].trim() : '';

    // Extract port
    const portMatch = content.match(/\| HTTP \| ([^\|]+)/) || content.match(/\| API 서버 \| ([^\|]+)/);
    const port = portMatch ? portMatch[1].trim() : '';

    // Extract completed section titles
    const completedSections: string[] = [];
    const completedRegex = /### \d+\.\s+(.+)/g;
    while ((match = completedRegex.exec(content)) !== null) {
      completedSections.push(match[1].trim());
    }

    // Extract report items (보고)
    const reportItems: string[] = [];
    const reportSection = content.match(/### 보고\n([\s\S]*?)(?=\n### |\n---|\n## |$)/);
    if (reportSection) {
      const items = reportSection[1].match(/\d+\.\s+\*\*[^*]+\*\*[^\n]*/g);
      if (items) reportItems.push(...items.map(l => l.replace(/^\d+\.\s*/, '').trim()));
    }

    // Extract requests (요청)
    const requestSection = content.match(/## 사령탑에[^\n]*\n([\s\S]*?)(?=\n## |\n---|\z)/);
    if (requestSection) {
      const numbered = requestSection[1].match(/\d+\.\s\*\*[^*]+\*\*/g);
      if (numbered) requests.push(...numbered.map(l => l.replace(/^\d+\.\s*/, '').replace(/\*\*/g, '')));
    }
    // Also try "### 요청" subsection
    const reqSubSection = content.match(/### 요청[^\n]*\n([\s\S]*?)(?=\n### |\n---|\n## |$)/);
    if (reqSubSection) {
      const items = reqSubSection[1].match(/\d+\.\s+\*\*[^*]+\*\*[^\n]*/g);
      if (items) {
        for (const item of items) {
          const cleaned = item.replace(/^\d+\.\s*/, '').replace(/\*\*/g, '').trim();
          if (!requests.includes(cleaned)) requests.push(cleaned);
        }
      }
    }

    // Status summary: derive from content
    let statusSummary = '대기 중';
    if (content.includes('대기 중')) statusSummary = '대기 중';
    if (content.includes('진행중') || content.includes('진행 중')) statusSummary = '작업 중';
    if (content.includes('블록') || content.includes('차단')) statusSummary = '블로커 있음';
    // Check for explicit status line
    const statusLine = content.match(/- \*\*(대기 중|작업 중|블로커)[^*]*\*\*/);
    if (statusLine) statusSummary = statusLine[0].replace(/\*\*/g, '').replace(/^- /, '');

    return { filename, name, lastUpdated, tasks, requests, scope, stack, port, completedSections, reportItems, statusSummary };
  }

  private parseMaster(content: string) {
    let lastUpdated = '';
    const phases: WorkerTask[] = [];
    const prohibitions: string[] = [];
    const sessionTable: { name: string; role: string; status: string; code: string }[] = [];

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

    // Parse session table rows
    const tableRegex = /\| \*\*([^*]+)\*\* \|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/g;
    while ((match = tableRegex.exec(content)) !== null) {
      sessionTable.push({
        name: match[1].trim(),
        role: match[2].trim(),
        code: match[4].trim(),
        status: match[5].trim(),
      });
    }
    const sessionCount = sessionTable.length;

    return { lastUpdated, sessionCount, phases, prohibitions, rawContent: content, sessionTable };
  }

  getState(): CoordinationState | null {
    return this.state;
  }
}

export const coordinationParser = new CoordinationParser('G:\\Lucas-Initiative\\.coordination');
