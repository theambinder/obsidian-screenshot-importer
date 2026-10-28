import { randomUUID } from 'node:crypto';

export class PreviewCache {
  constructor({ maxBytes = 128 * 1024 * 1024, maxEntries = 32, ttlMs = 60 * 60 * 1000 } = {}) {
    this.entries = new Map();
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.bytes = 0;
  }

  prune(now = Date.now()) {
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) this.remove(id);
    }
  }

  remove(id) {
    this.bytes -= this.entries.get(id)?.bytes || 0;
    this.entries.delete(id);
  }

  put(data, mimeType, variants = {}) {
    const bytes = data.length + Object.values(variants).reduce((sum, variant) => sum + variant.data.length, 0);
    if (bytes > this.maxBytes) throw new Error('Preview exceeds the cache size limit');
    this.prune();
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
      this.remove(this.entries.keys().next().value);
    }
    const id = randomUUID();
    this.entries.set(id, { data, mimeType, variants, bytes, expiresAt: Date.now() + this.ttlMs });
    this.bytes += bytes;
    return `/api/preview-image/${id}`;
  }

  get(id) {
    this.prune();
    return this.entries.get(id);
  }
}
