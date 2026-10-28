import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runCommand } from './utils.mjs';
import { isJxr } from '../public/imageSelection.js';

const cache = new Map();

export async function nativeHelperPath(name) {
  for (const url of [new URL(`../../bin/${name}`, import.meta.url), new URL(`../build/bin/${name}`, import.meta.url)]) {
    try { await fs.access(url, fs.constants.X_OK); return fileURLToPath(url); } catch { /* Try the source build next. */ }
  }
  throw new Error(`The bundled ${name} helper is missing. Reinstall the application.`);
}

export async function imageInfo(inputPath, options = {}) {
  const stat = await fs.stat(inputPath);
  const key = JSON.stringify([inputPath, stat.size, stat.mtimeMs]);
  if (cache.has(key)) return cache.get(key);
  const hdr = isJxr(inputPath);
  const { stdout } = await runCommand(await nativeHelperPath(hdr ? 'jxr-decode' : 'image-info'), hdr ? ['--info', inputPath] : [inputPath], { signal: options.signal, timeout: 15_000 });
  const { width, height, orientation = 1 } = JSON.parse(stdout);
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) throw new Error('Invalid image dimensions');
  const info = { width, height, ...(orientation !== 1 ? { orientation } : {}) };
  if (cache.size >= 512) cache.delete(cache.keys().next().value);
  cache.set(key, info);
  return info;
}
