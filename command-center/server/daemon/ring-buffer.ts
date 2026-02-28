/**
 * Fixed-capacity ring buffer for terminal output.
 * Keeps the most recent N bytes of output in memory.
 */
export class RingBuffer {
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
