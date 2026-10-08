import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { convertImage } from './converter.mjs';
import { outputExtensionForFormat } from './matcher.mjs';
import { pathExists } from './utils.mjs';

export function normalizeParallelImages(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= 4 ? count : 0;
}

export function resolveParallelImages(value, cpuCount = os.availableParallelism(), memoryBytes = os.totalmem()) {
  const requested = normalizeParallelImages(value);
  if (requested) return requested;
  if (memoryBytes < 8 * 1024 ** 3) return 1;
  return Math.max(1, Math.min(4, Math.floor(cpuCount / 3)));
}

// Only encoding runs concurrently. The caller publishes files and journals in order.
export async function* prepareImages(sourceDir, images, outputDir, settings, workers) {
  const width = settings.format === 'original' ? 1 : Math.min(workers, images.length);
  if (width <= 1) {
    for (const image of images) {
      yield { image, inputStat: await fs.stat(path.join(sourceDir, image)), stagedPath: null };
    }
    return;
  }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'iina-batch-'));
  try {
    for (let offset = 0; offset < images.length; offset += width) {
      const batch = images.slice(offset, offset + width);
      // Drain the whole batch on errors before cleaning up or starting another folder.
      const prepared = await Promise.allSettled(batch.map(async (image, index) => {
        const inputPath = path.join(sourceDir, image);
        const inputStat = await fs.stat(inputPath);
        const extension = outputExtensionForFormat(settings.format, image);
        const requested = path.join(outputDir, `${path.basename(image, path.extname(image))}${extension}`);
        if (['skip', 'reuse'].includes(settings.conflictPolicy) && await pathExists(requested)) {
          return { image, inputStat, stagedPath: null };
        }
        const stagedPath = path.join(temporary, `${offset + index}${extension}`);
        await convertImage(inputPath, stagedPath, settings);
        return { image, inputStat, stagedPath };
      }));
      for (const result of prepared) {
        if (result.status === 'rejected') throw result.reason;
        yield result.value;
        if (result.value.stagedPath) await fs.rm(result.value.stagedPath, { force: true });
      }
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
