import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureDir, runCommand } from './utils.mjs';

export function normalizeConversionSettings(input = {}) {
  if (input.format && !['webp', 'jpg', 'png', 'original'].includes(input.format)) throw new Error('Unsupported conversion format');
  if (input.conflictPolicy && !['increment', 'reuse', 'skip', 'overwrite'].includes(input.conflictPolicy)) throw new Error('Unsupported filename conflict policy');
  return {
    format: input.format || 'webp',
    quality: clampNumber(input.quality, 1, 100, 90),
    effort: clampNumber(input.effort, 0, 6, 6),
    conflictPolicy: input.conflictPolicy || 'increment',
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

export async function convertImage(inputPath, outputPath, settings, options = {}) {
  await ensureDir(path.dirname(outputPath));
  const temporary = path.join(path.dirname(outputPath), `.${randomUUID()}${path.extname(outputPath)}`);
  try {
    await encodeImage(inputPath, temporary, settings, options);
    options.signal?.throwIfAborted();
    await fs.rename(temporary, outputPath);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function publishStagedImage(stagedPath, outputPath) {
  const temporary = path.join(path.dirname(outputPath), `.${randomUUID()}${path.extname(outputPath)}`);
  try {
    // APFS can clone the encoded bytes; other filesystems fall back to a normal copy.
    await fs.copyFile(stagedPath, temporary, fs.constants.COPYFILE_FICLONE);
    await fs.rename(temporary, outputPath);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function encodeImage(inputPath, outputPath, settings, options) {
  await ensureDir(path.dirname(outputPath));
  if (settings.format === 'original') {
    await fs.copyFile(inputPath, outputPath);
    return;
  }

  if (settings.format === 'webp') {
    await runCommand('cwebp', [
      '-q', String(settings.quality),
      '-m', String(settings.effort),
      '-mt',
      '-quiet',
      inputPath,
      '-o',
      outputPath,
    ], options);
    return;
  }

  if (settings.format === 'jpg') {
    const qv = Math.max(2, Math.min(31, Math.round(31 - (settings.quality / 100) * 29)));
    await runCommand('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', inputPath,
      '-frames:v', '1',
      '-q:v', String(qv),
      outputPath,
    ], options);
    return;
  }

  if (settings.format === 'png') {
    await runCommand('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', inputPath,
      '-frames:v', '1',
      '-compression_level', '9',
      outputPath,
    ], options);
    return;
  }

  throw new Error(`Unsupported conversion format: ${settings.format}`);
}
