import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderJxrReference } from './converter.mjs';

// Share reference renders across thumbnails, crops, and full-size links. Serialize
// them so a long file list cannot launch dozens of floating-point decoders at once.
export class HdrReferenceCache {
  constructor(previews) {
    this.previews = previews;
    this.keys = new Map();
    this.pending = new Map();
    this.tail = Promise.resolve();
  }

  async get(inputPath, thumbnail = false) {
    const stat = await fs.stat(inputPath);
    const key = JSON.stringify([inputPath, stat.size, stat.mtimeMs, thumbnail]);
    const cached = this.previews.get(this.keys.get(key));
    if (cached) return cached;
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.pending.size >= 64) throw new Error('HDR preview queue is full. Retry after current previews finish.');
    const task = this.tail.catch(() => {}).then(async () => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-hdr-reference-'));
      try {
        const output = path.join(directory, 'reference.png');
        await renderJxrReference(inputPath, output, { thumbnail, timeout: 120_000 });
        const data = await fs.readFile(output);
        const url = this.previews.put(data, 'image/png');
        this.keys.delete(key);
        this.keys.set(key, url.split('/').at(-1));
        while (this.keys.size > 64) this.keys.delete(this.keys.keys().next().value);
        return { data, mimeType: 'image/png' };
      } finally {
        await fs.rm(directory, { recursive: true, force: true });
      }
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    this.tail = task;
    return task;
  }
}
