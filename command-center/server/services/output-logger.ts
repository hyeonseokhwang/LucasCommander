import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

class RingBuffer {
  private chunks: string[] = [];
  private totalSize = 0;
  private readonly maxSize: number;

  constructor(maxSizeBytes: number) {
    this.maxSize = maxSizeBytes;
  }

  push(data: string): void {
    this.chunks.push(data);
    this.totalSize += data.length;
    while (this.totalSize > this.maxSize && this.chunks.length > 1) {
      const removed = this.chunks.shift()!;
      this.totalSize -= removed.length;
    }
  }

  getAll(): string {
    return this.chunks.join('');
  }

  clear(): void {
    this.chunks = [];
    this.totalSize = 0;
  }
}

class OutputLogger {
  private buffers = new Map<string, RingBuffer>();
  private streams = new Map<string, fs.WriteStream>();

  constructor() {
    if (!fs.existsSync(config.logsDir)) {
      fs.mkdirSync(config.logsDir, { recursive: true });
    }
  }

  startSession(sessionId: string): void {
    // Ring buffer — pre-fill from log file if available (survives server restart)
    if (!this.buffers.has(sessionId)) {
      const buf = new RingBuffer(config.ringBufferMaxBytes);
      const logPath = path.join(config.logsDir, `${sessionId}.log`);
      if (fs.existsSync(logPath)) {
        try {
          const stats = fs.statSync(logPath);
          const readSize = Math.min(stats.size, config.ringBufferMaxBytes);
          const fd = fs.openSync(logPath, 'r');
          const buffer = Buffer.alloc(readSize);
          fs.readSync(fd, buffer, 0, readSize, Math.max(0, stats.size - readSize));
          fs.closeSync(fd);
          buf.push(buffer.toString('utf-8'));
          console.log(`[OutputLogger] Pre-filled buffer for "${sessionId}" from log (${readSize} bytes)`);
        } catch { /* ignore pre-fill errors */ }
      }
      this.buffers.set(sessionId, buf);
    }

    // Log file — rotate if > 50MB
    const logPath = path.join(config.logsDir, `${sessionId}.log`);
    if (fs.existsSync(logPath)) {
      try {
        const stats = fs.statSync(logPath);
        if (stats.size > 50 * 1024 * 1024) {
          const rotated = `${logPath}.1`;
          if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
          fs.renameSync(logPath, rotated);
        }
      } catch { /* ignore rotation errors */ }
    }

    const stream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf-8' });
    stream.write(`\n--- SESSION START ${new Date().toISOString()} ---\n`);
    this.streams.set(sessionId, stream);
  }

  write(sessionId: string, data: string): void {
    this.buffers.get(sessionId)?.push(data);
    this.streams.get(sessionId)?.write(data);
  }

  getBuffer(sessionId: string): string {
    return this.buffers.get(sessionId)?.getAll() || '';
  }

  stopSession(sessionId: string): void {
    const stream = this.streams.get(sessionId);
    if (stream) {
      stream.write(`\n--- SESSION END ${new Date().toISOString()} ---\n`);
      stream.end();
      this.streams.delete(sessionId);
    }
    // Keep ring buffer alive for quick reconnect
  }

  clearBuffer(sessionId: string): void {
    this.buffers.delete(sessionId);
  }

  shutdown(): void {
    for (const stream of this.streams.values()) {
      stream.end();
    }
    this.streams.clear();
  }
}

export const outputLogger = new OutputLogger();
