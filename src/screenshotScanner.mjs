import fs from 'node:fs/promises';
import path from 'node:path';
import { formatBytes, IMAGE_EXTENSIONS, naturalCompare } from './utils.mjs';

export async function scanScreenshotFolders(config) {
  let entries = [];
  try {
    entries = await fs.readdir(config.screenshotsRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const folders = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === config.archiveDirName || entry.name.startsWith('.')) continue;
    const folderPath = path.join(config.screenshotsRoot, entry.name);
    const files = await fs.readdir(folderPath, { withFileTypes: true });
    const images = [];
    let totalBytes = 0;
    let latestMtimeMs = 0;

    for (const file of files) {
      if (!file.isFile()) continue;
      const ext = path.extname(file.name).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext)) continue;
      const fullPath = path.join(folderPath, file.name);
      const stat = await fs.stat(fullPath);
      totalBytes += stat.size;
      latestMtimeMs = Math.max(latestMtimeMs, stat.mtimeMs);
      images.push({
        name: file.name,
        ext,
        bytes: stat.size,
        size: formatBytes(stat.size),
        mtimeMs: stat.mtimeMs,
      });
    }

    if (images.length === 0) continue;
    images.sort((a, b) => naturalCompare(a.name, b.name));
    folders.push({
      name: entry.name,
      path: folderPath,
      imageCount: images.length,
      totalBytes,
      totalSize: formatBytes(totalBytes),
      latestMtimeMs,
      firstImage: images[0]?.name || null,
      images,
    });
  }

  folders.sort((a, b) => b.latestMtimeMs - a.latestMtimeMs || naturalCompare(a.name, b.name));
  return folders;
}
