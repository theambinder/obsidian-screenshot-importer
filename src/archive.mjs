import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertInside, ensureDir, formatBytes, pathExists, readJson, uniquePath, writeJson } from './utils.mjs';
import { pathComponent, runLogPath, assertRealInside } from './paths.mjs';

export function archiveRoot(config) {
  return path.join(config.screenshotsRoot, config.archiveDirName);
}

export async function summarizeArchive(config, cache) {
  const root = archiveRoot(config);
  const stats = await statsForPath(root, cache);
  return {
    path: root,
    exists: await pathExists(root),
    fileCount: stats.fileCount,
    folderCount: stats.folderCount,
    bytes: stats.bytes,
    size: formatBytes(stats.bytes),
  };
}

export async function summarizeRunArchive(config, runId, cache) {
  const runDir = archiveRunPath(config, runId);
  const stats = await statsForPath(runDir, cache);
  return {
    path: runDir,
    exists: await pathExists(runDir),
    fileCount: stats.fileCount,
    folderCount: stats.folderCount,
    bytes: stats.bytes,
    size: formatBytes(stats.bytes),
  };
}

export async function summarizeArchivePath(target, cache) {
  const stats = await statsForPath(target, cache);
  return {
    path: target,
    exists: await pathExists(target),
    fileCount: stats.fileCount,
    folderCount: stats.folderCount,
    bytes: stats.bytes,
    size: formatBytes(stats.bytes),
  };
}

export async function trashArchive(config) {
  const root = archiveRoot(config);
  assertInside(config.screenshotsRoot, root, 'archive root');
  await assertRealInside(config.screenshotsRoot, root);
  if (!(await pathExists(root))) {
    return emptyTrashResult(root);
  }

  const entries = await fs.readdir(root);
  const targets = entries
    .filter((entry) => entry !== '.DS_Store')
    .map((entry) => path.join(root, entry));
  const result = await trashTargets(root, targets);
  await markArchiveTargetsTrashed(config, targets, result);
  return result;
}

export async function trashRunArchive(config, runId) {
  const runDir = archiveRunPath(config, runId);
  assertInside(archiveRoot(config), runDir, 'archive run');
  await assertRealInside(config.screenshotsRoot, runDir);
  const run = await readRun(config, runId);
  if (run?.rollback?.status) throw new Error(`Complete rollback before trashing this run: ${runId}`);
  if (!(await pathExists(runDir))) {
    return emptyTrashResult(runDir);
  }
  const result = await trashTargets(runDir, [runDir]);
  await markRunTrashed(config, runId, result);
  return result;
}

export async function trashRunItemArchive(config, runId, sourceFolderName) {
  const runDir = archiveRunPath(config, runId);
  assertInside(archiveRoot(config), runDir, 'archive run');

  const run = await readRun(config, runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (run.rollback?.status === 'done') throw new Error(`Run was already rollbacked: ${runId}`);

  const item = findRunItem(run, sourceFolderName);
  if (!item) throw new Error(`Run item not found: ${sourceFolderName}`);
  if (item.rollback?.status) throw new Error(`Rollback must be completed before trashing: ${sourceFolderName}`);
  const archived = findArchivedFolder(run, sourceFolderName);
  if (!archived) return emptyTrashResult(runDir);

  const archivedPath = archived.archivedPath;
  assertInside(runDir, archivedPath, 'archive item');
  await assertRealInside(config.screenshotsRoot, archivedPath);
  if (!(await pathExists(archivedPath))) {
    return emptyTrashResult(archivedPath);
  }
  const result = await trashTargets(archivedPath, [archivedPath]);
  await markRunItemTrashed(config, runId, sourceFolderName, result);
  await removeEmptyDir(runDir);
  return result;
}

export async function ensureArchiveRoot(config) {
  const root = archiveRoot(config);
  await ensureDir(root);
  return root;
}

async function trashTargets(basePath, targets) {
  if (targets.length === 0) return emptyTrashResult(basePath);
  let total = { fileCount: 0, folderCount: 0, bytes: 0 };
  for (const target of targets) {
    const stats = await statsForPath(target);
    total = {
      fileCount: total.fileCount + stats.fileCount,
      folderCount: total.folderCount + stats.folderCount,
      bytes: total.bytes + stats.bytes,
    };
  }

  const trashPaths = [];
  for (const target of targets) {
    trashPaths.push(await moveToMacTrash(target));
  }
  const finishedAt = new Date().toISOString();

  return {
    path: basePath,
    trashedPaths: targets,
    trashPaths,
    finishedAt,
    fileCount: total.fileCount,
    folderCount: total.folderCount,
    bytes: total.bytes,
    size: formatBytes(total.bytes),
  };
}

async function statsForPath(target, cache) {
  if (cache?.has(target)) return cache.get(target);
  const stats = await readStats(target, cache);
  cache?.set(target, stats);
  return stats;
}

async function readStats(target, cache) {
  let rootStat;
  try {
    rootStat = await fs.lstat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return { fileCount: 0, folderCount: 0, bytes: 0 };
    throw error;
  }

  if (rootStat.isFile()) {
    return { fileCount: 1, folderCount: 0, bytes: rootStat.size };
  }
  if (!rootStat.isDirectory()) {
    return { fileCount: 0, folderCount: 0, bytes: 0 };
  }

  const total = { fileCount: 0, folderCount: 1, bytes: 0 };
  const entries = await fs.readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    const child = path.join(target, entry.name);
    const stats = await statsForPath(child, cache);
    total.fileCount += stats.fileCount;
    total.folderCount += stats.folderCount;
    total.bytes += stats.bytes;
  }
  return total;
}

async function moveToMacTrash(target) {
  const trashRoot = path.join(os.homedir(), '.Trash');
  await ensureDir(trashRoot);
  const destination = await uniquePath(path.join(trashRoot, path.basename(target)), 'increment');
  if (!destination) throw new Error(`Could not find Trash destination for ${target}`);
  await fs.rename(target, destination);
  return destination;
}

function archiveRunPath(config, runId) {
  const value = pathComponent(runId, 'run ID');
  return path.join(archiveRoot(config), value);
}

async function readRun(config, runId) {
  return readJson(runLogPath(config, runId), null);
}

async function writeRun(config, run) {
  await writeJson(runLogPath(config, run.runId), run);
}

async function markArchiveTargetsTrashed(config, targets, result) {
  for (const [index, target] of targets.entries()) {
    const runId = path.basename(target);
    const run = await readRun(config, runId);
    if (!run || run.rollback?.status) continue;
    await markRunTrashed(config, runId, {
      ...result,
      trashedPaths: [target],
      trashPaths: result.trashPaths[index] ? [result.trashPaths[index]] : [],
    });
  }
}

async function markRunTrashed(config, runId, result) {
  if (!result.finishedAt) return;
  const run = await readRun(config, runId);
  if (!run || run.rollback?.status) return;

  run.archiveTrash = trashLog(result);
  for (const item of run.items || []) {
    if (item.rollback?.status) continue;
    item.archiveTrash = trashLog(result);
  }
  await writeRun(config, run);
}

async function markRunItemTrashed(config, runId, sourceFolderName, result) {
  if (!result.finishedAt) return;
  const run = await readRun(config, runId);
  if (!run || run.rollback?.status) return;
  const item = findRunItem(run, sourceFolderName);
  if (!item || item.rollback?.status) return;

  item.archiveTrash = trashLog(result);
  await writeRun(config, run);
}

function trashLog(result) {
  return {
    status: 'done',
    finishedAt: result.finishedAt,
    fileCount: result.fileCount,
    folderCount: result.folderCount,
    bytes: result.bytes,
    trashedPaths: result.trashedPaths,
    trashPaths: result.trashPaths,
  };
}

async function removeEmptyDir(target) {
  try {
    await fs.rmdir(target);
  } catch {
    // Non-empty or already removed run folders are fine.
  }
}

function findRunItem(run, sourceFolderName) {
  return (run.items || []).find((candidate) => candidate.sourceFolderName === sourceFolderName) || null;
}

function findArchivedFolder(run, sourceFolderName) {
  const item = findRunItem(run, sourceFolderName);
  if (item?.archivedTo) {
    const archived = (run.archivedFolders || []).find((candidate) => candidate.archivedPath === item.archivedTo);
    if (archived) return archived;
  }
  return (run.archivedFolders || []).find((candidate) => candidate.sourceFolderName === sourceFolderName) || null;
}

function emptyTrashResult(target) {
  return {
    path: target,
    trashedPaths: [],
    trashPaths: [],
    finishedAt: null,
    fileCount: 0,
    folderCount: 0,
    bytes: 0,
    size: formatBytes(0),
  };
}
