import fs from 'node:fs/promises';
import path from 'node:path';
import { assertInside } from './utils.mjs';

export function pathComponent(value, label = 'name') {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[/\\\u0000]/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

export function runLogPath(config, runId) {
  return path.join(config.runsDir, `${pathComponent(runId, 'run ID')}.json`);
}

export function sourceFolderPath(config, folder) {
  pathComponent(folder, 'source folder');
  if (folder === config.archiveDirName || folder.startsWith('.')) throw new Error('Invalid source folder');
  return path.join(config.screenshotsRoot, folder);
}

export function mediaNotePath(config, relativePath) {
  if (typeof relativePath !== 'string' || path.extname(relativePath).toLowerCase() !== '.md') {
    throw new Error('Expected a Markdown media note');
  }
  const target = path.resolve(config.vaultRoot, relativePath);
  assertInside(config.mediaRoot, target, 'note');
  const category = path.relative(config.mediaRoot, target).split(path.sep)[0];
  if (!config.mediaDirs.includes(category)) throw new Error(`Note category is not allowed: ${category}`);
  return target;
}

// Resolve existing ancestors too, so a missing output beneath a symlink cannot escape its root.
export async function assertRealInside(root, target) {
  assertInside(root, target);
  async function resolveExisting(value) {
    try {
      return await fs.realpath(value);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return path.join(await resolveExisting(path.dirname(value)), path.basename(value));
    }
  }
  assertInside(await resolveExisting(root), await resolveExisting(target));
}
