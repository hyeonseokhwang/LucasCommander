import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export interface InboxMessage {
  type: 'report' | 'instruction';
  filename: string;
  worker: string;
  timestamp: string;
  content: string;
  needsUserDecision: boolean;
}

type InboxListener = (msg: InboxMessage) => void;

class InboxWatcher {
  private inboxDir: string;
  private watcher: fs.FSWatcher | null = null;
  private knownFiles = new Set<string>();
  private listeners: InboxListener[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.inboxDir = path.join(config.coordinationDir, 'inbox');
  }

  onMessage(fn: InboxListener) {
    this.listeners.push(fn);
  }

  private emit(msg: InboxMessage) {
    for (const fn of this.listeners) {
      try { fn(msg); } catch (err) {
        console.error('[InboxWatcher] Listener error:', err);
      }
    }
  }

  startWatching() {
    if (!fs.existsSync(this.inboxDir)) {
      fs.mkdirSync(this.inboxDir, { recursive: true });
    }

    // Snapshot existing files so we only emit for NEW ones
    try {
      const existing = fs.readdirSync(this.inboxDir).filter(f => f.endsWith('.md'));
      for (const f of existing) {
        this.knownFiles.add(f);
      }
    } catch { /* ignore */ }

    this.watcher = fs.watch(this.inboxDir, (_event, filename) => {
      if (!filename || !filename.endsWith('.md')) return;
      if (this.knownFiles.has(filename)) return;

      // Debounce slightly to ensure file write is complete
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.processNewFile(filename), 200);
    });

    console.log(`[InboxWatcher] Watching ${this.inboxDir}`);
  }

  private processNewFile(filename: string) {
    if (this.knownFiles.has(filename)) return;
    this.knownFiles.add(filename);

    const filePath = path.join(this.inboxDir, filename);
    if (!fs.existsSync(filePath)) return;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const msg = this.parseInboxFile(filename, content);
      if (msg) {
        console.log(`[InboxWatcher] New ${msg.type}: ${filename} from ${msg.worker}`);
        this.emit(msg);
      }
    } catch (err) {
      console.error(`[InboxWatcher] Error reading ${filename}:`, err);
    }
  }

  private parseInboxFile(filename: string, content: string): InboxMessage | null {
    const isReport = filename.startsWith('report-');
    const isInstruct = filename.startsWith('instruct-');
    if (!isReport && !isInstruct) return null;

    // Extract worker name from filename: report-worker-5-12345.md or instruct-worker-5-12345.md
    const parts = filename.replace('.md', '').split('-');
    // Pattern: type-worker-N-timestamp  or type-worker-name-timestamp
    let worker = '';
    if (parts.length >= 3) {
      // Skip first part (report/instruct), take middle parts, skip last (timestamp)
      worker = parts.slice(1, -1).join('-');
    }

    // Extract timestamp from file content
    const tsMatch = content.match(/>\s*(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)/);
    const timestamp = tsMatch ? tsMatch[1] : new Date().toISOString();

    const needsUserDecision = content.includes('USER DECISION NEEDED');

    return {
      type: isReport ? 'report' : 'instruction',
      filename,
      worker,
      timestamp,
      content: content.split('\n').slice(3).join('\n').trim(), // Skip header lines
      needsUserDecision,
    };
  }

  stop() {
    this.watcher?.close();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }
}

export const inboxWatcher = new InboxWatcher();
