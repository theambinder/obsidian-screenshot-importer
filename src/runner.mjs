import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mediaNotePath, sourceFolderPath, assertRealInside } from './paths.mjs';
import { normalizeConversionSettings, publishStagedImage } from './converter.mjs';
import { prepareImages, resolveParallelImages } from './conversionBatch.mjs';
import { APP_VERSION } from './version.mjs';
import { parseSeasonNumber, parseEpisodeNumber } from '../public/episodeSelection.js';
import { parseSourceName, targetHeadingForSelection } from './matcher.mjs';
import { selectImageNames, normalizeDuplicateMode, outputImageName } from '../public/imageSelection.js';
import { insertScreenshotLinks } from './markdown.mjs';
import { rememberRule } from './rules.mjs';
import {
  assertInside,
  ensureDir,
  fromVaultRelative,
  makeRunId,
  naturalCompare,
  obsidianOpenUri,
  pathExists,
  toPosixPath,
  uniquePath,
  vaultRelative,
  writeJson,
  IMAGE_EXTENSIONS,
  atomicWriteFile,
  fileHash,
} from './utils.mjs';

export class ImportJob {
  constructor(config, payload) {
    this.config = config;
    this.id = `${makeRunId()}-${randomUUID().slice(0, 8)}`;
    this.payload = payload;
    this.workers = resolveParallelImages(payload.parallelImages);
    this.startedAt = new Date().toISOString();
    this.finishedAt = null;
    this.status = 'queued';
    this.error = null;
    this.totalFiles = 0;
    this.doneFiles = 0;
    this.current = '';
    this.results = [];
    this.stopRequested = false;
    this.log = {
      version: 1,
      appVersion: APP_VERSION,
      runId: this.id,
      startedAt: this.startedAt,
      finishedAt: null,
      settings: normalizeConversionSettings(payload.conversion || {}),
      parallelImages: this.workers,
      notes: [],
      generatedFiles: [],
      archivedFolders: [],
      items: [],
    };
  }

  progress() {
    const elapsedMs = Date.now() - Date.parse(this.startedAt);
    const rate = this.doneFiles > 0 ? elapsedMs / this.doneFiles : 0;
    const remainingFiles = Math.max(0, this.totalFiles - this.doneFiles);
    return {
      id: this.id,
      status: this.status,
      error: this.error,
      totalFiles: this.totalFiles,
      doneFiles: this.doneFiles,
      percent: this.totalFiles ? Math.round((this.doneFiles / this.totalFiles) * 100) : 0,
      etaSeconds: rate ? Math.round((rate * remainingFiles) / 1000) : null,
      current: this.current,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      results: this.results,
      stopRequested: this.stopRequested,
      remainingFolders: Math.max(0, (this.log.plannedFolders?.length || 0) - this.log.items.length),
      log: ['done', 'partial', 'error', 'stopped'].includes(this.status) ? this.log : null,
    };
  }

  requestStop() {
    if (!['queued', 'running'].includes(this.status)) return false;
    this.stopRequested = true;
    this.log.stopRequestedAt ||= new Date().toISOString();
    return true;
  }

  async run() {
    this.status = 'running';
    try {
      const selections = sortSelections((this.payload.items || []).filter((item) => item.enabled !== false));
      const sources = new Set();
      for (const selection of selections) {
        validateSelection(selection);
        this.notePath(selection);
        if (sources.has(selection.sourceFolderName)) throw new Error('Duplicate source folder in run');
        sources.add(selection.sourceFolderName);
      }
      this.log.plannedFolders = selections.map((selection) => selection.sourceFolderName);
      await this.checkpoint();
      this.totalFiles = await this.countFiles(selections);
      for (const selection of selections) {
        if (this.stopRequested) break;
        await this.processSelection(selection);
      }
      const errors = this.log.items.filter((item) => item.status === 'error').length;
      const stopped = this.stopRequested && this.log.items.length < selections.length;
      this.status = stopped ? 'stopped' : errors ? (errors === this.log.items.length ? 'error' : 'partial') : 'done';
      if (errors) this.error = `${errors} folder(s) failed. See the run results.`;
    } catch (error) {
      this.status = 'error';
      this.error = error.stack || error.message;
    } finally {
      this.finishedAt = new Date().toISOString();
      this.log.finishedAt = this.finishedAt;
      await this.checkpoint();
    }
  }

  async checkpoint() {
    this.log.status = this.status;
    this.log.error = this.error;
    await writeJson(path.join(this.config.runsDir, `${this.id}.json`), this.log);
  }

  async countFiles(selections) {
    let count = 0;
    for (const selection of selections) {
      const folderPath = this.sourceFolderPath(selection.sourceFolderName);
      const files = await listImageFiles(folderPath);
      count += selectImageNames(files, selection.duplicateMode ?? this.payload.duplicateMode).length;
    }
    return count;
  }

  sourceFolderPath(sourceFolderName) {
    return sourceFolderPath(this.config, sourceFolderName);
  }

  notePath(selection) {
    if (!selection.notePath) throw new Error(`No note selected for ${selection.sourceFolderName}`);
    return mediaNotePath(this.config, selection.notePath);
  }

  async processSelection(selection) {
    const itemLog = {
      sourceFolderName: selection.sourceFolderName,
      notePath: selection.notePath,
      noteName: selection.notePath ? path.basename(selection.notePath, '.md') : null,
      mode: selection.mode,
      season: selection.mode === 'episode' ? parseSeasonNumber(selection.season) : null,
      episode: selection.mode === 'episode' ? parseEpisodeNumber(selection.episode) : null,
      targetLabel: null,
      status: 'running',
      sourceBytes: 0,
      outputBytes: 0,
      sourceFileCount: 0,
      processedFileCount: 0,
      skippedDuplicateCount: 0,
      duplicateMode: normalizeDuplicateMode(selection.duplicateMode ?? this.payload.duplicateMode),
      outputFileCount: 0,
      generatedFiles: [],
      outputHashes: {},
      replacedFiles: [],
      insertedLinks: [],
      archivedTo: null,
      conversion: null,
      ruleChange: null,
      error: null,
    };
    this.log.items.push(itemLog);

    try {
      validateSelection(selection);
      const sourceFolderPath = this.sourceFolderPath(selection.sourceFolderName);
      const notePath = this.notePath(selection);
      await assertRealInside(this.config.screenshotsRoot, sourceFolderPath);
      await assertRealInside(this.config.mediaRoot, notePath);
      if (!(await pathExists(notePath))) {
        throw new Error(`Note does not exist: ${selection.notePath}`);
      }

      const sourceImages = await listImageFiles(sourceFolderPath);
      const selectedImages = selectImageNames(sourceImages, itemLog.duplicateMode);
      const sourceVersions = new Map();
      for (const image of sourceImages) {
        const inputPath = path.join(sourceFolderPath, image);
        const stat = await fs.stat(inputPath);
        sourceVersions.set(inputPath, { path: inputPath, size: stat.size, mtimeMs: stat.mtimeMs });
        itemLog.sourceBytes += stat.size;
      }
      itemLog.sourceFileCount = sourceImages.length;
      itemLog.processedFileCount = selectedImages.length;
      itemLog.skippedDuplicateCount = sourceImages.length - selectedImages.length;
      const conversion = conversionForSelection(this.payload.conversion || {}, selection);
      itemLog.conversion = conversion;
      const noteName = path.basename(notePath, '.md');
      itemLog.noteName = noteName;
      itemLog.targetLabel = targetLabel(noteName, selection);
      const attachmentRelDir = applyAttachmentTemplate(this.config.attachmentsTemplate, noteName);
      const attachmentAbsDir = path.join(this.config.vaultRoot, attachmentRelDir);
      assertInside(this.config.vaultRoot, attachmentAbsDir, 'attachment folder');
      await assertRealInside(this.config.vaultRoot, attachmentAbsDir);
      await ensureDir(attachmentAbsDir);

      const links = [];
      this.current = `Converting ${selection.sourceFolderName}`;
      for await (const { image, inputStat, stagedPath } of prepareImages(sourceFolderPath, selectedImages, attachmentAbsDir, conversion, this.workers)) {
        this.current = `${selection.sourceFolderName} / ${image}`;
        const inputPath = path.join(sourceFolderPath, image);
        const snapshot = sourceVersions.get(inputPath);
        if (inputStat.size !== snapshot.size || inputStat.mtimeMs !== snapshot.mtimeMs) throw new Error('Source image changed during import');
        const outputName = outputImageName(image, conversion.format, selectedImages);
        const requestedOutputPath = path.join(attachmentAbsDir, outputName);
        const outputPath = await uniquePath(requestedOutputPath, conversion.conflictPolicy);

        if (!outputPath && conversion.conflictPolicy === 'reuse') {
          const existingStat = await fs.stat(requestedOutputPath);
          itemLog.outputBytes += existingStat.size;
          itemLog.outputFileCount += 1;
          const existingRel = toPosixPath(vaultRelative(this.config, requestedOutputPath));
          links.push(`![[${existingRel}]]`);
          this.doneFiles += 1;
          continue;
        }

        if (!outputPath && conversion.conflictPolicy === 'skip') {
          this.doneFiles += 1;
          continue;
        }

        if (!stagedPath) throw new Error('Existing attachment changed during import; retry this folder');

        await assertRealInside(this.config.vaultRoot, outputPath);
        const rel = vaultRelative(this.config, outputPath);
        const posixRel = toPosixPath(rel);
        if (conversion.conflictPolicy === 'overwrite' && await pathExists(outputPath) && !itemLog.generatedFiles.includes(posixRel)) {
          const backupPath = path.join(this.config.backupsDir, this.id, 'attachments', posixRel);
          await ensureDir(path.dirname(backupPath));
          await fs.copyFile(outputPath, backupPath);
          itemLog.replacedFiles.push({ path: posixRel, backupPath, originalHash: await fileHash(backupPath) });
        }
        if (!itemLog.generatedFiles.includes(posixRel)) itemLog.generatedFiles.push(posixRel);
        if (!this.log.generatedFiles.includes(posixRel)) this.log.generatedFiles.push(posixRel);
        // Persist the intended bytes before publication, including sequential/copy jobs.
        itemLog.outputHashes[posixRel] = await fileHash(stagedPath);
        await this.checkpoint();
        await publishStagedImage(stagedPath, outputPath);
        const outputStat = await fs.stat(outputPath);
        itemLog.outputBytes += outputStat.size;
        itemLog.outputFileCount += 1;
        const link = `![[${posixRel}]]`;
        links.push(link);
        this.doneFiles += 1;
        await this.checkpoint();
      }

      if (links.length === 0) {
        throw new Error('No links produced for this folder');
      }

      if (JSON.stringify(await listImageFiles(sourceFolderPath)) !== JSON.stringify(sourceImages)) {
        throw new Error('Source folder changed during import; originals were kept for a retry');
      }
      for (const source of sourceVersions.values()) {
        const current = await fs.stat(source.path);
        if (current.size !== source.size || current.mtimeMs !== source.mtimeMs) throw new Error('Source image changed during import');
      }

      const before = await fs.readFile(notePath, 'utf8');
      await this.backupNoteOnce(notePath, before);
      const insertion = insertScreenshotLinks(before, selection, links, {
        runId: this.id,
        sourceName: selection.sourceFolderName,
        dedupeLinks: true,
      });
      itemLog.insertedLinks = insertion.insertedLinks;
      itemLog.heading = insertion.heading;
      itemLog.createdHeading = insertion.createdHeading;
      await this.checkpoint();
      if (await fs.readFile(notePath, 'utf8') !== before) throw new Error('Note changed during import; retry this folder');
      await atomicWriteFile(notePath, insertion.content, { preserveCreationTime: true });

      const archivedTo = await this.archiveSourceFolder(sourceFolderPath, selection.sourceFolderName);
      itemLog.archivedTo = archivedTo;

      const parsed = parseSourceName(selection.sourceFolderName);
      itemLog.ruleChange = await rememberRule(this.config, parsed.titleGuess, {
        notePath: selection.notePath,
        mode: selection.mode,
        season: selection.season,
      });

      itemLog.status = 'done';
      this.results.push({
        sourceFolderName: selection.sourceFolderName,
        notePath: selection.notePath,
        noteName,
        noteUri: obsidianOpenUri(notePath, targetHeadingForSelection(selection)),
        heading: itemLog.heading,
        targetLabel: itemLog.targetLabel,
        generatedFiles: itemLog.generatedFiles,
        insertedCount: itemLog.insertedLinks.length,
        sourceBytes: itemLog.sourceBytes,
        outputBytes: itemLog.outputBytes,
        sourceFileCount: itemLog.sourceFileCount,
        processedFileCount: itemLog.processedFileCount,
        skippedDuplicateCount: itemLog.skippedDuplicateCount,
        outputFileCount: itemLog.outputFileCount,
        archivedTo,
        status: 'done',
      });
    } catch (error) {
      itemLog.status = 'error';
      itemLog.error = error.stack || error.message;
      this.results.push({
        sourceFolderName: selection.sourceFolderName,
        notePath: selection.notePath,
        status: 'error',
        error: error.message,
      });
    } finally {
      await this.checkpoint();
    }
  }

  async backupNoteOnce(notePath, content) {
    const relative = vaultRelative(this.config, notePath);
    if (this.log.notes.some((entry) => entry.path === relative)) return;
    const backupPath = path.join(this.config.backupsDir, this.id, relative);
    await ensureDir(path.dirname(backupPath));
    await fs.writeFile(backupPath, content, 'utf8');
    this.log.notes.push({
      path: relative,
      backupPath,
    });
  }

  async archiveSourceFolder(sourceFolderPath, sourceFolderName) {
    const archiveRoot = path.join(this.config.screenshotsRoot, this.config.archiveDirName, this.id);
    await assertRealInside(this.config.screenshotsRoot, archiveRoot);
    await ensureDir(archiveRoot);
    let archivePath = path.join(archiveRoot, sourceFolderName);
    let index = 1;
    while (await pathExists(archivePath)) {
      archivePath = path.join(archiveRoot, `${sourceFolderName}-${index}`);
      index += 1;
    }
    this.log.archivedFolders.push({
      sourceFolderName,
      originalPath: sourceFolderPath,
      archivedPath: archivePath,
    });
    await this.checkpoint();
    await fs.rename(sourceFolderPath, archivePath);
    return archivePath;
  }
}

function validateSelection(selection) {
  if (selection.duplicateMode != null && !['jxr', 'png', 'both'].includes(selection.duplicateMode)) throw new Error('Invalid JXR / PNG pair selection');
  if (!selection.sourceFolderName) throw new Error('Missing source folder');
  if (!selection.notePath) throw new Error(`Missing note for ${selection.sourceFolderName}`);
  if (!['episode', 'screenshots'].includes(selection.mode)) throw new Error('Invalid mode');
  if (selection.quality != null) {
    const quality = Number(selection.quality);
    if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
      throw new Error(`Invalid quality for ${selection.sourceFolderName}`);
    }
  }
  if (selection.mode === 'episode') {
    if (parseSeasonNumber(selection.season) === null) throw new Error(`Invalid season for ${selection.sourceFolderName}`);
    if (parseEpisodeNumber(selection.episode) === null) throw new Error(`Invalid episode for ${selection.sourceFolderName}`);
  }
}

function conversionForSelection(baseConversion, selection) {
  const input = { ...baseConversion };
  if (selection.quality != null && selection.quality !== '') input.quality = selection.quality;
  for (const key of ['resolution', 'format', 'effort']) if (selection[key] != null) input[key] = selection[key];
  return normalizeConversionSettings(input);
}

async function listImageFiles(folderPath) {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort(naturalCompare);
}

function applyAttachmentTemplate(template, noteName) {
  return toPosixPath(template.replaceAll('{notename}', noteName).replaceAll('{noteName}', noteName)).replace(/^\/+/, '').replace(/\/+$/, '');
}

function targetLabel(noteName, selection) {
  if (selection.mode === 'episode') {
    return `${noteName} · S${Number(selection.season)}E${Number(selection.episode)}`;
  }
  return `${noteName} · Work`;
}

function sortSelections(selections) {
  return [...selections].sort((a, b) => {
    const noteCompare = String(a.notePath || '').localeCompare(String(b.notePath || ''), undefined, { sensitivity: 'base' });
    if (noteCompare !== 0) return noteCompare;
    const modeCompare = String(a.mode || '').localeCompare(String(b.mode || ''), undefined, { sensitivity: 'base' });
    if (modeCompare !== 0) return modeCompare;
    const seasonCompare = (Number(a.season) || 0) - (Number(b.season) || 0);
    if (seasonCompare !== 0) return seasonCompare;
    const episodeCompare = (Number(a.episode) || 0) - (Number(b.episode) || 0);
    if (episodeCompare !== 0) return episodeCompare;
    return naturalCompare(a.sourceFolderName || '', b.sourceFolderName || '');
  });
}
