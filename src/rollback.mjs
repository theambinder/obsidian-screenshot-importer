import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, fromVaultRelative, obsidianOpenUri, pathExists, readJson, writeJson, atomicWriteFile, fileHash, listFilesRecursive } from './utils.mjs';
import { runLogPath, mediaNotePath, sourceFolderPath, assertRealInside } from './paths.mjs';
import { summarizeArchive, summarizeArchivePath, summarizeRunArchive } from './archive.mjs';
import { removeScreenshotBlock } from './markdown.mjs';
import { hasEpisodeNumbers } from '../public/episodeSelection.js';

export async function listRuns(config, options = {}) {
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 50));
  await ensureDir(config.runsDir);
  const entries = await fs.readdir(config.runsDir, { withFileTypes: true });
  const logs = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      const run = await readJson(path.join(config.runsDir, entry.name), null);
      if (run) logs.push(run);
    }
  }
  logs.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  const archiveCache = new Map();
  const runs = [];
  for (const run of logs.slice(0, limit)) {
    if (run) {
      const items = await summarizeRunItems(config, run, archiveCache);
      const archive = await summarizeRunArchive(config, run.runId, archiveCache);
      const status = runStatus(run, items);
      const sourceMissingCount = items.filter((item) => item.archiveState === 'missing').length;
      runs.push({
        runId: run.runId,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        rollbackFinishedAt: rollbackFinishedAt(run, items),
        trashFinishedAt: trashFinishedAt(run, items),
        status,
        itemCount: run.items?.length || 0,
        generatedCount: run.generatedFiles?.length || 0,
        sourceBytes: sumItems(run, 'sourceBytes'),
        outputBytes: sumItems(run, 'outputBytes'),
        sourceMissingCount,
        canRollback: runCanRollback(status, items),
        rollbackUnavailableReason: null,
        archive,
        targets: summarizeRunTargets(config, run),
        items,
      });
    }
  }
  runs.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  return {
    runs: runs.slice(0, limit),
    total: logs.length,
    limit,
    archive: await summarizeArchive(config, archiveCache),
  };
}

export async function rollbackRun(config, runId) {
  const runPath = runLogPath(config, runId);
  const run = await readJson(runPath, null);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (run.runId !== runId) throw new Error('Run ID does not match its log');
  if (run.rollback?.status === 'done') return run.rollback;

  const result = {
    status: 'running',
    startedAt: new Date().toISOString(),
    restoredNotes: [],
    deletedFiles: [],
    restoredFiles: [],
    retainedFiles: [],
    returnedFolders: [],
    skippedFolders: [],
    restoredRules: [],
    removedArchiveRunDir: false,
    errors: [],
  };
  const references = await noteReferences(config);
  // Undo newest items first: several folders can target the same note or attachment.
  for (const item of [...(run.items || [])].reverse()) {
    if (itemRollbackFinishedAt(item) || item.archiveTrash?.status || runArchiveTrashFinishedAt(run)) {
      result.skippedFolders.push(item.sourceFolderName);
      continue;
    }
    const itemResult = await rollbackItem(config, run, item, references);
    result.deletedFiles.push(...itemResult.deletedFiles);
    result.restoredFiles.push(...itemResult.restoredFiles);
    result.retainedFiles.push(...itemResult.retainedFiles);
    result.errors.push(...itemResult.errors);
    if (itemResult.removedMarkdownBlock) result.restoredNotes.push(item.notePath);
    if (itemResult.returnedFolder) result.returnedFolders.push(item.sourceFolderName);
    await writeJson(runPath, run);
  }

  try {
    const archiveRunDir = path.join(config.screenshotsRoot, config.archiveDirName, runId);
    if (await pathExists(archiveRunDir)) {
      await fs.rmdir(archiveRunDir);
      result.removedArchiveRunDir = true;
    }
  } catch (error) {
    if (!['ENOTEMPTY', 'ENOENT', 'EEXIST'].includes(error.code)) result.errors.push({ type: 'archiveRunDir', path: runId, error: error.message });
  }

  result.finishedAt = new Date().toISOString();
  result.status = result.errors.length ? 'partial' : 'done';
  run.rollback = result;
  await writeJson(runPath, run);
  return result;
}

export async function rollbackRunItem(config, runId, sourceFolderName) {
  const runPath = runLogPath(config, runId);
  const run = await readJson(runPath, null);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (run.runId !== runId) throw new Error('Run ID does not match its log');

  const item = (run.items || []).find((candidate) => candidate.sourceFolderName === sourceFolderName);
  if (!item) throw new Error(`Run item not found: ${sourceFolderName}`);
  if (run.rollback?.status === 'done' || item.rollback?.status === 'done') return item.rollback || run.rollback;
  if (item.archiveTrash?.status) throw new Error(`Run item source archive was moved to Trash: ${sourceFolderName}`);

  const result = await rollbackItem(config, run, item, await noteReferences(config));
  await writeJson(runPath, run);
  return result;
}

async function noteReferences(config) {
  const references = new Map();
  for (const category of config.mediaDirs) {
    for (const note of await listFilesRecursive(path.join(config.mediaRoot, category))) {
      if (note.toLowerCase().endsWith('.md')) references.set(note, await fs.readFile(note, 'utf8'));
    }
  }
  return references;
}

async function rollbackItem(config, run, item, references) {
  const { runId } = run;
  const { sourceFolderName } = item;

  const result = {
    status: 'running',
    startedAt: new Date().toISOString(),
    sourceFolderName,
    removedMarkdownBlock: Boolean(item.rollback?.removedMarkdownBlock),
    deletedFiles: [...(item.rollback?.deletedFiles || [])],
    restoredFiles: [...(item.rollback?.restoredFiles || [])],
    retainedFiles: [...(item.rollback?.retainedFiles || [])],
    returnedFolder: null,
    errors: [],
  };

  const archived = findArchivedFolder(run, item);
  const checkpoint = async () => {
    item.rollback = result;
    await writeJson(runLogPath(config, runId), run);
  };
  try {
    if (archived) {
      const runDir = path.join(config.screenshotsRoot, config.archiveDirName, runId);
      await assertRealInside(runDir, archived.archivedPath);
      const original = sourceFolderPath(config, sourceFolderName);
      if (original !== archived.originalPath) throw new Error('Unexpected original source path');
      await assertRealInside(config.screenshotsRoot, original);
      const archiveExists = await pathExists(archived.archivedPath);
      const originalExists = await pathExists(original);
      if (archiveExists && originalExists) throw new Error('Source folder already exists; move it aside before rollback');
      if (!archiveExists && !originalExists) throw new Error('Source archive is missing; rollback was not applied');
    }
    if (item.notePath) {
      const notePath = mediaNotePath(config, item.notePath);
      await assertRealInside(config.mediaRoot, notePath);
      if (await pathExists(notePath)) {
        const before = await fs.readFile(notePath, 'utf8');
        const removal = removeScreenshotBlock(before, runId, sourceFolderName);
        if (removal.removed) {
          if (await fs.readFile(notePath, 'utf8') !== before) throw new Error('Note changed during rollback; retry');
          await atomicWriteFile(notePath, removal.content, { preserveCreationTime: true });
          references.set(notePath, removal.content);
          result.removedMarkdownBlock = true;
          await checkpoint();
        }
      }
    }
  } catch (error) {
    result.errors.push({ type: 'markdown', path: item.notePath, error: error.message });
    result.finishedAt = new Date().toISOString();
    result.status = 'partial';
    item.rollback = result;
    return result;
  }

  for (const generated of item.generatedFiles || []) {
    if (result.deletedFiles.includes(generated) || result.restoredFiles.includes(generated) || result.retainedFiles.includes(generated)) continue;
    try {
      const filePath = fromVaultRelative(config, generated);
      await assertRealInside(config.vaultRoot, filePath);
      const replacement = (item.replacedFiles || []).find((entry) => entry.path === generated);
      if (replacement) await assertRealInside(path.join(config.backupsDir, runId), replacement.backupPath);
      if (await pathExists(filePath)) {
        if (item.outputHashes?.[generated] && await fileHash(filePath) !== item.outputHashes[generated]) {
          throw new Error('Attachment changed after import; kept the current file');
        }
        if (!replacement && [...references.values()].some((content) => content.includes(path.basename(generated)))) {
          result.retainedFiles.push(generated);
          await checkpoint();
          continue;
        }
        if (!replacement) {
          await fs.unlink(filePath);
          result.deletedFiles.push(generated);
        }
      }
      if (replacement) {
        await atomicWriteFile(filePath, await fs.readFile(replacement.backupPath));
        result.restoredFiles.push(generated);
      }
      await checkpoint();
    } catch (error) {
      result.errors.push({ type: 'generatedFile', path: generated, error: error.message });
    }
  }

  if (archived) {
    try {
      if (await pathExists(archived.archivedPath)) {
        if (await pathExists(archived.originalPath)) {
          throw new Error('Source folder already exists; archive was kept');
        } else {
          await ensureDir(path.dirname(archived.originalPath));
          await fs.rename(archived.archivedPath, archived.originalPath);
          result.returnedFolder = archived.originalPath;
        }
      } else if (await pathExists(archived.originalPath)) {
        result.returnedFolder = archived.originalPath;
      } else {
        throw new Error(`Archive missing: ${archived.archivedPath}`);
      }
    } catch (error) {
      result.errors.push({ type: 'archivedFolder', path: sourceFolderName, error: error.message });
    }
  }

  try {
    const archiveRunDir = path.join(config.screenshotsRoot, config.archiveDirName, runId);
    if (await pathExists(archiveRunDir)) {
      await fs.rmdir(archiveRunDir);
    }
  } catch {
    // Folder is not empty while other items remain archived. That is expected.
  }

  result.finishedAt = new Date().toISOString();
  result.status = result.errors.length ? 'partial' : 'done';
  item.rollback = result;
  return result;
}

function summarizeRunTargets(config, run) {
  const seen = new Set();
  const targets = [];
  for (const item of run.items || []) {
    const noteName = item.noteName || basenameWithoutMd(item.notePath || '');
    const label = item.targetLabel || formatTargetLabel(noteName, item);
    const key = `${item.notePath}:${item.mode}:${item.season}:${item.episode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({
      label,
      noteName,
      notePath: item.notePath,
      noteUri: noteUriForItem(config, item),
      mode: item.mode,
      season: item.season ?? null,
      episode: item.episode ?? null,
      sourceFolderName: item.sourceFolderName,
    });
  }
  return targets;
}

async function summarizeRunItems(config, run, archiveCache) {
  const summaries = [];
  for (const item of run.items || []) {
    const noteName = item.noteName || basenameWithoutMd(item.notePath || '');
    const archive = await archiveStateForItem(run, item, archiveCache);
    const itemTrashed = itemIsTrashed(item, archive);
    summaries.push({
      sourceFolderName: item.sourceFolderName,
      notePath: item.notePath,
      noteUri: noteUriForItem(config, item),
      noteName,
      label: item.targetLabel || formatTargetLabel(noteName, item),
      mode: item.mode,
      season: item.season ?? null,
      episode: item.episode ?? null,
      status: itemStatus(item, archive),
      rollbackFinishedAt: item.rollback?.finishedAt || null,
      trashFinishedAt: item.archiveTrash?.finishedAt || null,
      sourceFileCount: item.sourceFileCount || item.insertedLinks?.length || item.generatedFiles?.length || 0,
      outputFileCount: item.outputFileCount || item.generatedFiles?.length || 0,
      insertedCount: item.insertedLinks?.length || 0,
      sourceBytes: item.sourceBytes || 0,
      outputBytes: item.outputBytes || 0,
      generatedCount: item.generatedFiles?.length || 0,
      archivedTo: item.archivedTo || null,
      archiveState: archive.state,
      archive: archive.summary,
      canRollback: item.rollback?.status !== 'done' && !itemTrashed && archive.canRollback,
      rollbackUnavailableReason: null,
      error: item.error || null,
    });
  }
  return summaries;
}

function sumItems(run, key) {
  return (run.items || []).reduce((sum, item) => sum + (Number(item[key]) || 0), 0);
}

function runStatus(run, items) {
  const commonStatus = commonItemStatus(items);
  if (commonStatus && statusKind(commonStatus) !== 'done') return commonStatus;
  if (run.rollback?.status === 'partial') return 'rollback:partial';
  if (runIsTrashed(run, items)) return 'trash:done';
  if (run.rollback?.status === 'done' && !(run.items || []).some((item) => item.rollback || item.archiveTrash)) return 'rollback:done';
  return run.status || (items.some((item) => item.status === 'error') ? 'partial' : 'done');
}

function itemStatus(item, archive) {
  if (item.rollback?.status) return `rollback:${item.rollback.status}`;
  if (itemIsTrashed(item, archive)) return 'trash:done';
  return item.status || 'done';
}

function runIsTrashed(run, items) {
  if (runArchiveTrashFinishedAt(run)) return true;
  return allItemsHaveKind(items, 'trash');
}

function itemIsTrashed(item, archive) {
  return Boolean(item.archiveTrash?.status) || archive.state === 'missing';
}

function trashFinishedAt(run, items) {
  if (runArchiveTrashFinishedAt(run)) return runArchiveTrashFinishedAt(run);
  if (allItemsHaveKind(items, 'trash')) return latestItemTrashFinishedAt(items);
  return null;
}

function runArchiveTrashFinishedAt(run) {
  return run.archiveTrash?.finishedAt || null;
}

function rollbackFinishedAt(run, items) {
  if (run.rollback?.finishedAt) return run.rollback.finishedAt;
  if (allItemsHaveKind(items, 'rollback')) return latestItemRollbackFinishedAt(items);
  return null;
}

function runCanRollback(status, items) {
  if (status === 'rollback:done' || status === 'trash:done') return false;
  return (items || []).some((item) => item.status !== 'rollback:done' && statusKind(item.status) !== 'trash' && item.canRollback !== false);
}

function itemRollbackFinishedAt(item) {
  return item?.rollback?.status === 'done' ? item.rollback.finishedAt || true : null;
}

function latestItemTrashFinishedAt(items) {
  const dates = (items || [])
    .map((item) => item.trashFinishedAt)
    .filter(Boolean)
    .sort();
  return dates.at(-1) || null;
}

function latestItemRollbackFinishedAt(items) {
  const dates = (items || [])
    .map((item) => item.rollbackFinishedAt)
    .filter(Boolean)
    .sort();
  return dates.at(-1) || null;
}

function commonItemStatus(items) {
  if (!items?.length) return null;
  const kinds = items.map((item) => statusKind(item.status));
  const firstKind = kinds[0];
  if (!kinds.every((kind) => kind === firstKind)) return null;
  if (firstKind === 'done') return 'done';

  const statuses = items.map((item) => String(item.status || 'done'));
  const firstStatus = statuses[0];
  if (statuses.every((status) => status === firstStatus)) return firstStatus;
  return firstKind === 'partial' ? 'rollback:partial' : `${firstKind}:done`;
}

function allItemsHaveKind(items, kind) {
  return Boolean(items?.length) && items.every((item) => statusKind(item.status) === kind);
}

function statusKind(status) {
  const value = String(status || 'done');
  if (value === 'rollback:partial' || value === 'rollback:running') return 'partial';
  if (value.startsWith('rollback:')) return 'rollback';
  if (value.startsWith('trash:')) return 'trash';
  return 'done';
}

function findArchivedFolder(run, item) {
  if (item.archivedTo) {
    const archived = (run.archivedFolders || []).find((candidate) => candidate.archivedPath === item.archivedTo);
    if (archived) return archived;
  }
  return (run.archivedFolders || []).find((candidate) => candidate.sourceFolderName === item.sourceFolderName) || null;
}

async function archiveStateForItem(run, item, archiveCache) {
  const archived = findArchivedFolder(run, item);
  if (!archived) {
    return {
      state: 'unknown',
      summary: emptyArchiveSummary(null),
      canRollback: true,
      reason: null,
    };
  }

  const [archivedExists, originalExists] = await Promise.all([
    pathExists(archived.archivedPath),
    pathExists(archived.originalPath),
  ]);

  if (archivedExists) {
    return {
      state: 'archived',
      summary: await summarizeArchivePath(archived.archivedPath, archiveCache),
      canRollback: true,
      reason: null,
    };
  }
  if (originalExists) {
    return {
      state: 'restored',
      summary: emptyArchiveSummary(archived.archivedPath),
      canRollback: true,
      reason: null,
    };
  }
  return {
    state: 'missing',
    summary: emptyArchiveSummary(archived.archivedPath),
    canRollback: false,
    reason: 'Source folder was deleted from _archive',
  };
}

function emptyArchiveSummary(target) {
  return {
    path: target,
    exists: false,
    fileCount: 0,
    folderCount: 0,
    bytes: 0,
    size: '0 B',
  };
}

function noteUriForItem(config, item) {
  if (!item.notePath) return null;
  return obsidianOpenUri(fromVaultRelative(config, item.notePath), headingForItem(item));
}

function headingForItem(item) {
  if (item.mode === 'episode' && hasEpisodeNumbers(item)) {
    return `S${Number(item.season)}E${Number(item.episode)}`;
  }
  return 'Скриншоты';
}

function basenameWithoutMd(notePath) {
  return path.basename(notePath, '.md');
}

function formatTargetLabel(noteName, item) {
  if (!noteName) return item.sourceFolderName || 'Unknown target';
  if (item.mode === 'episode' && hasEpisodeNumbers(item)) {
    return `${noteName} · S${Number(item.season)}E${Number(item.episode)}`;
  }
  return `${noteName} · Work`;
}
