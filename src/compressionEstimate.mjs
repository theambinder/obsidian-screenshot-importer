import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { convertImage, normalizeConversionSettings, conversionForImage } from './converter.mjs';
import { imageInfo } from './imageInfo.mjs';
import { selectImageNames, effectiveFormat, outputImageName, normalizeDuplicateMode } from '../public/imageSelection.js';
import { targetDimensions } from '../public/conversionProfile.js';

function groupKey(name, conversion) {
  return `${path.extname(name).toLowerCase()}:${effectiveFormat(name, conversion.format)}`;
}

export function estimateSamples(files, conversion) {
  const groups = new Map();
  for (const file of files) {
    const key = groupKey(file.name, conversion);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  }
  const samples = [...groups.values()].slice(0, 2).map((group) => group[0]);
  if (samples.length === 1 && files.length > 1) samples.push(files[Math.floor(files.length / 2)]);
  return samples;
}

// Only one background estimate encodes at a time, independently of Run's workers.
export class CompressionEstimator {
  constructor({ encode = convertImage, inspect = imageInfo, maxEntries = 128 } = {}) {
    this.encode = encode;
    this.inspect = inspect;
    this.maxEntries = maxEntries;
    this.cache = new Map();
    this.samples = new Map();
    this.controllers = new Set();
    this.tail = Promise.resolve();
  }

  cancelAll() {
    for (const controller of this.controllers) controller.abort();
  }

  sampleKey(inputPath, version, conversion) {
    const settings = conversionForImage(inputPath, conversion);
    return JSON.stringify([inputPath, version.size, version.mtimeMs, settings.format, settings.quality, settings.effort, settings.resolution]);
  }

  remember(inputPath, version, conversion, bytes, dimensions) {
    const key = this.sampleKey(inputPath, version, conversion);
    if (this.samples.size >= 256) this.samples.delete(this.samples.keys().next().value);
    this.samples.set(key, { bytes, dimensions });
  }

  async estimate(folderPath, files, input, duplicateMode, { signal } = {}) {
    const conversion = normalizeConversionSettings(input);
    const mode = normalizeDuplicateMode(duplicateMode);
    const key = createHash('sha256').update(JSON.stringify([folderPath, files.map((file) => [file.name, file.bytes, file.mtimeMs]), conversion, mode])).digest('hex');
    const cached = () => {
      const entry = this.cache.get(key);
      return entry && Date.now() - entry.time < 30 * 60_000 ? { ...entry.value, cached: true } : null;
    };
    signal?.throwIfAborted();
    if (cached()) return cached();
    if (this.controllers.size >= 32) throw new Error('Estimate queue is full');
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    this.controllers.add(controller);
    const task = this.tail.catch(() => {}).then(async () => {
      combined.throwIfAborted();
      if (cached()) return cached();
      const value = await this.calculate(folderPath, files, conversion, mode, combined);
      combined.throwIfAborted();
      if (this.cache.size >= this.maxEntries) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, { time: Date.now(), value });
      return value;
    }).finally(() => this.controllers.delete(controller));
    this.tail = task;
    return task;
  }

  async calculate(folderPath, files, conversion, mode, signal) {
    const included = new Set(selectImageNames(files.map((file) => file.name), mode));
    const selected = files.filter((file) => included.has(file.name));
    if (!selected.length) throw new Error('No images selected');
    const samples = estimateSamples(selected, conversion);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-estimate-'));
    try {
      const measured = new Map();
      const ratios = new Map();
      let encodedSamples = 0;
      for (const file of samples) {
        signal.throwIfAborted();
        const input = path.join(folderPath, file.name);
        const version = { size: file.bytes, mtimeMs: file.mtimeMs };
        const cachedSample = this.samples.get(this.sampleKey(input, version, conversion));
        const dimensions = cachedSample?.dimensions || await this.inspect(input, { signal });
        const copy = effectiveFormat(file.name, conversion.format) === 'original';
        let bytes = cachedSample?.bytes ?? file.bytes;
        if (!copy && !cachedSample) {
          const output = path.join(directory, outputImageName(file.name, conversion.format, [...included]));
          await this.encode(input, output, conversion, { signal });
          bytes = (await fs.stat(output)).size;
          encodedSamples++;
        }
        this.remember(input, version, conversion, bytes, dimensions);
        const current = await fs.stat(input);
        if (current.size !== file.bytes || current.mtimeMs !== file.mtimeMs) throw new Error('Source changed during estimation; refresh the folder');
        measured.set(file.name, { bytes, dimensions, outputDimensions: targetDimensions(dimensions, copy ? 'original' : conversion.resolution) });
        const key = groupKey(file.name, conversion);
        const ratio = ratios.get(key) || { source: 0, output: 0 };
        ratio.source += file.bytes; ratio.output += bytes;
        ratios.set(key, ratio);
      }
      const total = [...ratios.values()].reduce((sum, item) => ({ source: sum.source + item.source, output: sum.output + item.output }), { source: 0, output: 0 });
      const estimates = files.map((file) => {
        const exact = measured.get(file.name);
        const copy = effectiveFormat(file.name, conversion.format) === 'original';
        const ratio = ratios.get(groupKey(file.name, conversion)) || total;
        return { name: file.name, included: included.has(file.name), exact: Boolean(exact) || copy,
          estimatedBytes: !included.has(file.name) ? null : exact?.bytes ?? (copy ? file.bytes : Math.max(1, Math.round(file.bytes * ratio.output / Math.max(1, ratio.source)))) };
      });
      const first = measured.values().next().value;
      return { sourceBytes: files.reduce((sum, file) => sum + file.bytes, 0),
        selectedSourceBytes: selected.reduce((sum, file) => sum + file.bytes, 0),
        selectedCount: selected.length, estimatedBytes: estimates.reduce((sum, file) => sum + (file.estimatedBytes || 0), 0),
        sampleCount: samples.length, encodedSamples, sourceDimensions: first.dimensions,
        outputDimensions: first.outputDimensions,
        mixedDimensions: [...measured.values()].some((sample) => sample.dimensions.width !== first.dimensions.width || sample.dimensions.height !== first.dimensions.height),
        files: estimates, cached: false };
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
}
