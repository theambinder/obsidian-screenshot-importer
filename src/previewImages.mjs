import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { nativeHelperPath } from './imageInfo.mjs';
import { runCommand } from './utils.mjs';
import { renderJxrReference } from './converter.mjs';
import { isJxr } from '../public/imageSelection.js';

export const PREVIEW_VIEWS = new Set(['thumbnail', 'overview', 'crop']);

export async function renderPreviewImage(input, output, view, { signal, hdr = false, cropSize = 512 } = {}) {
  if (!PREVIEW_VIEWS.has(view)) throw new Error('Unsupported preview view');
  if (!Number.isInteger(cropSize) || cropSize < 1 || cropSize > 512) throw new Error('Invalid preview crop size');
  signal?.throwIfAborted();
  if (isJxr(input)) return renderJxrReference(input, output, { signal, view, timeout: 120_000 });
  if (!hdr) {
    try {
      return await runCommand(await nativeHelperPath('image-preview'), [input, output, view, String(cropSize)], { signal, timeout: 30_000 });
    } catch (error) {
      signal?.throwIfAborted();
      // Older ImageIO versions may not support WebP/AVIF; use the bundled decoder.
      if (error.code !== 1) throw error;
    }
  }
  const filter = view === 'crop'
    ? `crop=w='min(${cropSize},min(iw,ih))':h='min(${cropSize},min(iw,ih))':x='floor((iw-ow)/2)':y='floor((ih-oh)/2)'`
    : `scale=w='min(${view === 'thumbnail' ? 256 : 1600},iw)':h='min(${view === 'thumbnail' ? 256 : 1600},ih)':force_original_aspect_ratio=decrease`;
  await runCommand('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-threads', '1', '-i', input,
    '-frames:v', '1', '-filter_threads', '1', '-vf', hdr
      ? `${filter},zscale=pin=bt2020:tin=smpte2084:min=bt2020nc:rin=full:p=bt2020:t=smpte2084:m=gbr:r=full,format=gbrp16le,format=rgb48be`
      : filter,
    ...(hdr ? ['-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'rgb', '-color_range', 'pc'] : []),
    '-threads', '1', '-compression_level', '1', output], { signal, timeout: 60_000 });
}

export class PreviewImages {
  constructor(queue, { maxBytes = 64 * 1024 * 1024, maxEntries = 256, render = renderPreviewImage } = {}) {
    this.queue = queue;
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
    this.render = render;
    this.entries = new Map();
    this.bytes = 0;
  }

  async get(input, view, { signal } = {}) {
    const stat = await fs.stat(input);
    const key = JSON.stringify([input, stat.size, stat.mtimeMs, view]);
    signal?.throwIfAborted();
    const cached = () => {
      const value = this.entries.get(key);
      if (value) { this.entries.delete(key); this.entries.set(key, value); }
      return value;
    };
    if (cached()) return cached();
    return this.queue.run(async (workSignal) => {
      if (cached()) return cached();
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-image-preview-'));
      try {
        const output = path.join(directory, 'image.png');
        await this.render(input, output, view, { signal: workSignal });
        const data = await fs.readFile(output);
        workSignal.throwIfAborted();
        const result = { data, mimeType: 'image/png' };
        if (data.length <= this.maxBytes) {
          while (this.entries.size >= this.maxEntries || this.bytes + data.length > this.maxBytes) {
            const oldest = this.entries.keys().next().value;
            this.bytes -= this.entries.get(oldest).data.length;
            this.entries.delete(oldest);
          }
          this.entries.set(key, result);
          this.bytes += data.length;
        }
        return result;
      } finally { await fs.rm(directory, { recursive: true, force: true }); }
    }, { signal, priority: view === 'thumbnail' ? 10 : 40 });
  }
}
