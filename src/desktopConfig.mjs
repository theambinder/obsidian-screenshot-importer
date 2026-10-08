import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveConfig } from './config.mjs';
import { pathExists } from './utils.mjs';

export function desktopSupportRoot() {
  return process.env.OBSIDIAN_SCREENSHOTS_SUPPORT
    || path.join(os.homedir(), 'Library/Application Support/Obsidian Screenshot Automation');
}

export async function loadDesktopConfig(profilePath, { home = os.homedir(), supportRoot = desktopSupportRoot() } = {}) {
  const legacyData = path.join(home, 'Documents/Private/Projects/iina-obsidian-screenshot-importer/data');
  const vaultRoot = path.join(home, 'Library/Mobile Documents/iCloud~md~obsidian/Documents/ambinder');
  let saved = {};
  try {
    saved = JSON.parse(await fs.readFile(profilePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Cannot read locations file: ${profilePath}: ${error.message}`);
  }
  const locations = {
    screenshotsRoot: path.join(home, 'Documents/Private/Pictures/Screenshots'),
    vaultRoot,
    mediaRoot: path.join(vaultRoot, 'Bases/Databases/Media'),
    dataDir: await pathExists(legacyData) ? legacyData : path.join(supportRoot, 'data'),
  };
  for (const key of Object.keys(locations)) {
    if (saved[key] === undefined) continue;
    if (typeof saved[key] !== 'string' || !path.isAbsolute(saved[key])) {
      throw new Error(`Location ${key} must be an absolute path`);
    }
    locations[key] = path.resolve(saved[key]);
  }
  if (saved.vaultRoot && !saved.mediaRoot) locations.mediaRoot = path.join(locations.vaultRoot, 'Bases/Databases/Media');
  const mediaRelative = path.relative(locations.vaultRoot, locations.mediaRoot);
  if (mediaRelative === '..' || mediaRelative.startsWith(`..${path.sep}`) || path.isAbsolute(mediaRelative)) {
    throw new Error('Media must be a folder inside the Obsidian vault');
  }
  return resolveConfig({ ...locations, port: 0 });
}
