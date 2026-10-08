import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.bmp']);
export const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.mov', '.avi', '.m4v', '.webm']);

export function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

export function vaultRelative(config, absolutePath) {
  return toPosixPath(path.relative(config.vaultRoot, absolutePath));
}

export function fromVaultRelative(config, relativePath) {
  return path.join(config.vaultRoot, relativePath);
}

export function stripMdExtension(filename) {
  return filename.replace(/\.md$/i, '');
}

export function stripKnownVideoExtension(name) {
  const ext = path.extname(name);
  return VIDEO_EXTENSIONS.has(ext.toLowerCase()) ? name.slice(0, -ext.length) : name;
}

export function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[._]+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(value) {
  const ignored = new Set([
    'a', 'an', 'and', 'the', 'of', 'to', 'in', 'on', 'no', 'tv',
    'bdrip', 'webrip', 'web', 'webdl', 'dl', 'bluray', 'x264', 'x265',
    'h264', 'h265', 'hevc', 'avc', 'aac', 'flac', 'dv', 'hdr', 'amzn',
    'rutracker', 'rgzsrutracker', '1080p', '2160p', '720p', '480p',
  ]);
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length > 1 && !ignored.has(token) && !/^\d{3,4}p$/.test(token));
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(target) {
  await fs.mkdir(target, { recursive: true });
}

export async function readJson(target, fallback) {
  try {
    return JSON.parse(await fs.readFile(target, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function writeJson(target, value) {
  await atomicWriteFile(target, `${JSON.stringify(value, null, 2)}\n`);
}

export async function atomicWriteFile(target, value, { preserveCreationTime = false } = {}) {
  const original = preserveCreationTime && process.platform === 'darwin'
    ? await fs.lstat(target, { bigint: true }) : null;
  if (original && !original.isFile()) throw new Error(`Expected an existing regular file: ${target}`);
  await ensureDir(path.dirname(target));
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, value, { flag: 'wx', mode: original ? 0o600 : 0o666 });
    if (original) {
      // Set and verify birthtime before publishing, never repair it after rename.
      await runCommand(await creationTimeHelper(), [target, temporary]);
      await fs.chmod(temporary, Number(original.mode & 0o777n));
      const preserved = await fs.stat(temporary, { bigint: true });
      if (preserved.birthtimeNs !== original.birthtimeNs) {
        throw new Error(`Could not preserve creation time; original file kept: ${target}`);
      }
      const current = await fs.lstat(target, { bigint: true });
      if (['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].some((key) => current[key] !== original[key])) {
        throw new Error(`File changed while saving; retry: ${target}`);
      }
    }
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function creationTimeHelper() {
  const candidates = [
    new URL('../../bin/preserve-creation-time', import.meta.url),
    new URL('../build/bin/preserve-creation-time', import.meta.url),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate, fs.constants.X_OK);
      return fileURLToPath(candidate);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error('Creation-time helper is missing. Reinstall the app, or run npm run build:native when using source files.');
}

export async function fileHash(target) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(target)) hash.update(chunk);
  return hash.digest('hex');
}

export async function listFilesRecursive(root) {
  const results = [];
  async function walk(current) {
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name === '.DS_Store') continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }
  await walk(root);
  return results;
}

export function assertInside(parent, child, label = 'path') {
  const parentResolved = path.resolve(parent);
  const childResolved = path.resolve(child);
  const relative = path.relative(parentResolved, childResolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} is outside allowed root: ${child}`);
  }
}

export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`${command} exited with code ${code}: ${stderr || stdout}`);
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
  });
}

export async function commandVersion(command, args = ['--version']) {
  try {
    const result = await runCommand(command, args);
    return (result.stdout || result.stderr).split('\n')[0].trim();
  } catch {
    return null;
  }
}

export async function uniquePath(target, policy = 'increment') {
  if (policy === 'overwrite') return target;
  if (!(await pathExists(target))) return target;
  if (policy === 'skip' || policy === 'reuse') return null;

  const dir = path.dirname(target);
  const ext = path.extname(target);
  const base = path.basename(target, ext);
  for (let index = 1; index < 10000; index += 1) {
    const candidate = path.join(dir, `${base}-${index}${ext}`);
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error(`Could not find available filename for ${target}`);
}

export function makeRunId(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function obsidianOpenUri(absolutePath, heading = '') {
  const withHeading = heading ? `${absolutePath}#${heading}` : absolutePath;
  return `obsidian://open?path=${encodeURIComponent(withHeading)}`;
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
