import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from './config.mjs';
import { loadAppSettings, saveAppSettings } from './appSettings.mjs';
import { resolveParallelImages } from './conversionBatch.mjs';
import { APP_VERSION } from './version.mjs';
import { ensureArchiveRoot, trashArchive, trashRunArchive, trashRunItemArchive } from './archive.mjs';
import { scanMedia } from './mediaIndex.mjs';
import { inferMode, outputExtensionForFormat, parseSourceName, suggestNotes } from './matcher.mjs';
import { loadRules, rememberRule } from './rules.mjs';
import { listRuns, rollbackRun, rollbackRunItem } from './rollback.mjs';
import { scanScreenshotFolders } from './screenshotScanner.mjs';
import { ImportJob } from './runner.mjs';
import { RollbackJob } from './rollbackJob.mjs';
import { convertImage, normalizeConversionSettings } from './converter.mjs';
import { PreviewCache } from './previewCache.mjs';
import { pathComponent, sourceFolderPath as checkedSourceFolderPath, assertRealInside } from './paths.mjs';
import { assertInside, commandVersion, formatBytes, IMAGE_EXTENSIONS, naturalCompare, pathExists, readJson, runCommand } from './utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(__dirname, '../public');
export function createAppServer(config = resolveConfig(), { updater = null } = {}) {
const jobs = new Map();
const previews = new PreviewCache();
let mutationActive = false;
let activeJobId = null;
let pendingWrites = 0;
let stopping = false;
const exclusivePaths = new Set(['/api/run', '/api/rollback', '/api/rollback-item', '/api/archive/clear', '/api/archive/clear-run', '/api/archive/clear-item', '/api/updates/download']);

function sendJson(res, value, status = 200) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, value, status = 200, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type });
  res.end(value);
}

async function readBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw Object.assign(new Error('Request body is too large'), { status: 413 });
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/updates/state' && req.method === 'GET') {
    sendJson(res, { supported: Boolean(updater), ...updater?.state });
    return;
  }
  if (url.pathname === '/api/updates/check' && req.method === 'POST') {
    if (!updater) throw Object.assign(new Error('Updates are available in the macOS application'), { status: 400 });
    sendJson(res, await updater.check());
    return;
  }
  if (url.pathname === '/api/updates/download' && req.method === 'POST') {
    if (!updater) throw Object.assign(new Error('Updates are available in the macOS application'), { status: 400 });
    const { tag } = await readBody(req);
    // Validate before transferring the exclusive lock to a detached download.
    if (!updater.releases.some((release) => release.tag === tag && release.newer && release.asset)) {
      throw Object.assign(new Error('No verified compatible update is available'), { status: 400 });
    }
    updater.download(tag).catch(() => {}).finally(() => { mutationActive = false; });
    sendJson(res, { started: true });
    return true;
  }
  if (url.pathname === '/api/health') {
    sendJson(res, {
      ok: true,
      version: APP_VERSION,
      config: { ...publicConfig(), attachmentsTemplate: (await loadAppSettings(config)).imageFolderTemplate },
      tools: {
        cwebp: await commandVersion('cwebp', ['-version']),
        ffmpeg: await commandVersion('ffmpeg', ['-version']),
      },
    });
    return;
  }

  if (url.pathname === '/api/settings') {
    if (req.method === 'GET') {
      const settings = await loadAppSettings(config);
      sendJson(res, { ...settings, appVersion: APP_VERSION, resolvedParallelImages: resolveParallelImages(settings.parallelImages), autoParallelImages: resolveParallelImages(0) });
      return;
    }
    if (req.method === 'POST') {
      const payload = await readBody(req);
      sendJson(res, await saveAppSettings(config, payload));
      return;
    }
  }

  if (url.pathname === '/api/scan') {
    const [notes, folders, rules, settings] = await Promise.all([
      scanMedia(config),
      scanScreenshotFolders(config),
      loadRules(config),
      loadAppSettings(config),
    ]);

    const rows = folders.map((folder) => {
      const parsed = parseSourceName(folder.name);
      const match = suggestNotes(parsed, notes, rules);
      const savedMode = settings.noteModes[match.selected?.path];
      const mode = savedMode || inferMode(match.selected, parsed);
      const detectedEpisode = { season: parsed.season, episode: parsed.episode };
      if (mode === 'episode' && parsed.season == null) parsed.season = 1;
      return {
        ...folder,
        parsed,
        detectedEpisode,
        mode,
        modeReason: savedMode ? 'Saved mode for this note' : parsed.mode === 'episode' ? `Detected: ${parsed.pattern}` : 'No episode pattern detected in the folder name',
        selectedNotePath: match.selected?.path || '',
        selectedNoteLabel: match.selected?.label || '',
        confidence: match.confidence,
        matchReason: match.reason,
        suggestions: match.suggestions.map((entry) => ({
          path: entry.note.path,
          label: entry.note.label,
          score: entry.score,
          reason: entry.reason,
        })),
      };
    });

    sendJson(res, {
      config: { ...publicConfig(), attachmentsTemplate: settings.imageFolderTemplate },
      notes,
      folders: rows,
      screenshotsSummary: summarizeScreenshotFolders(folders),
    });
    return;
  }

  if (url.pathname === '/api/run' && req.method === 'POST') {
    const payload = await readBody(req);
    const settings = await loadAppSettings(config);
    if (payload.parallelImages == null) payload.parallelImages = settings.parallelImages;
    const job = new ImportJob({ ...config, attachmentsTemplate: settings.imageFolderTemplate }, payload);
    job.kind = 'import';
    startJob(job);
    sendJson(res, { jobId: job.id });
    return true;
  }

  if (url.pathname === '/api/active-job' && req.method === 'GET') {
    sendJson(res, { job: activeJobId ? { ...jobs.get(activeJobId).progress(), kind: jobs.get(activeJobId).kind } : null });
    return;
  }

  function startJob(job) {
    jobs.set(job.id, job);
    for (const [id, previous] of jobs) {
      if (jobs.size <= 100) break;
      if (['done', 'partial', 'error'].includes(previous.status)) jobs.delete(id);
    }
    mutationActive = true;
    activeJobId = job.id;
    queueMicrotask(() => {
      job.run().catch((error) => {
        job.status = 'error';
        job.error = error.stack || error.message;
      }).finally(() => { mutationActive = false; activeJobId = null; });
    });
  }

  const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (jobMatch) {
    const job = jobs.get(jobMatch[1]);
    if (!job) {
      sendJson(res, { error: 'Job not found' }, 404);
      return;
    }
    sendJson(res, { ...job.progress(), kind: job.kind });
    return;
  }

  if (url.pathname === '/api/runs') {
    const limit = Number(url.searchParams.get('limit') || 50);
    sendJson(res, await listRuns(config, { limit }));
    return;
  }

  if (url.pathname === '/api/open-archive' && req.method === 'POST') {
    const root = await ensureArchiveRoot(config);
    await runCommand('open', [root]);
    sendJson(res, { ok: true });
    return;
  }

  if (url.pathname === '/api/open-run-archive' && req.method === 'POST') {
    const payload = await readBody(req);
    if (!payload.runId) {
      sendJson(res, { error: 'runId is required' }, 400);
      return;
    }
    const archiveRoot = path.join(config.screenshotsRoot, config.archiveDirName);
    const runDir = path.join(archiveRoot, pathComponent(payload.runId, 'run ID'));
    await openExistingPath(res, archiveRoot, runDir, 'archive run');
    return;
  }

  if (url.pathname === '/api/open-item-archive' && req.method === 'POST') {
    const payload = await readBody(req);
    const runId = pathComponent(payload.runId, 'run ID');
    const sourceFolderName = payload.sourceFolderName || '';
    if (!runId || !sourceFolderName) {
      sendJson(res, { error: 'runId and sourceFolderName are required' }, 400);
      return;
    }
    const runPath = path.join(config.runsDir, `${runId}.json`);
    assertInside(config.runsDir, runPath, 'run log');
    const run = await readJson(runPath, null);
    if (!run) {
      sendJson(res, { error: 'Run not found' }, 404);
      return;
    }

    const runDir = path.join(config.screenshotsRoot, config.archiveDirName, runId);
    const archived = findArchivedFolder(run, sourceFolderName);
    if (!archived) {
      sendJson(res, { error: 'Archive folder not found' }, 404);
      return;
    }
    await openExistingPath(res, runDir, archived.archivedPath, 'archive item');
    return;
  }

  if (url.pathname === '/api/archive/clear' && req.method === 'POST') {
    sendJson(res, await trashArchive(config));
    return;
  }

  if (url.pathname === '/api/archive/clear-run' && req.method === 'POST') {
    const payload = await readBody(req);
    sendJson(res, await trashRunArchive(config, payload.runId));
    return;
  }

  if (url.pathname === '/api/archive/clear-item' && req.method === 'POST') {
    const payload = await readBody(req);
    sendJson(res, await trashRunItemArchive(config, payload.runId, payload.sourceFolderName));
    return;
  }

  if (url.pathname === '/api/rollback' && req.method === 'POST') {
    const payload = await readBody(req);
    if (payload.background) {
      const job = new RollbackJob(config, { runId: payload.runId });
      startJob(job);
      sendJson(res, { jobId: job.id });
      return true;
    }
    const result = await rollbackRun(config, payload.runId);
    sendJson(res, result);
    return;
  }

  if (url.pathname === '/api/rollback-item' && req.method === 'POST') {
    const payload = await readBody(req);
    // A missing folder must never turn an item request into a full-run rollback.
    pathComponent(payload.sourceFolderName, 'source folder');
    if (payload.background) {
      const job = new RollbackJob(config, payload);
      startJob(job);
      sendJson(res, { jobId: job.id });
      return true;
    }
    const result = await rollbackRunItem(config, payload.runId, payload.sourceFolderName);
    sendJson(res, result);
    return;
  }

  if (url.pathname === '/api/rules/remember' && req.method === 'POST') {
    const payload = await readBody(req);
    await rememberRule(config, payload.sourceTitle, {
      notePath: payload.notePath,
      mode: payload.mode,
      season: payload.season,
    });
    sendJson(res, { ok: true });
    return;
  }

  if (url.pathname === '/api/open-source-folder' && req.method === 'POST') {
    const payload = await readBody(req);
    const folderPath = path.join(config.screenshotsRoot, payload.folder || '');
    assertInside(config.screenshotsRoot, folderPath, 'source folder');
    if (!(await pathExists(folderPath))) {
      sendJson(res, { error: 'Source folder not found' }, 404);
      return;
    }
    await runCommand('open', [folderPath]);
    sendJson(res, { ok: true });
    return;
  }

  if (url.pathname === '/api/source-files' && req.method === 'POST') {
    const payload = await readBody(req);
    const folderPath = sourceFolderPath(payload.folder || '');
    await assertRealInside(config.screenshotsRoot, folderPath);
    if (!(await pathExists(folderPath))) {
      sendJson(res, { error: 'Source folder not found' }, 404);
      return;
    }

    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext)) continue;
      const filePath = sourceImagePath(payload.folder || '', entry.name);
      const stat = await fs.stat(filePath);
      files.push({
        name: entry.name,
        bytes: stat.size,
        size: formatBytes(stat.size),
        mtimeMs: stat.mtimeMs,
        url: sourceImageUrl(payload.folder || '', entry.name),
      });
    }
    files.sort((a, b) => naturalCompare(a.name, b.name));
    sendJson(res, { folder: payload.folder || '', files });
    return;
  }

  if (url.pathname === '/api/preview-conversion' && req.method === 'POST') {
    const payload = await readBody(req);
    const inputPath = sourceImagePath(payload.folder || '', payload.file || '');
    await assertRealInside(config.screenshotsRoot, inputPath);
    if (!(await pathExists(inputPath))) {
      sendJson(res, { error: 'Source image not found' }, 404);
      return;
    }

    const conversion = normalizeConversionSettings(payload.conversion || {});
    const outputExt = outputExtensionForFormat(conversion.format, payload.file || '');
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iina-preview-'));
    const outputPath = path.join(tempDir, `preview${outputExt}`);
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', abort);
    try {
      await convertImage(inputPath, outputPath, conversion, { signal: controller.signal });
      const [inputStat, outputStat] = await Promise.all([
        fs.stat(inputPath),
        fs.stat(outputPath),
      ]);
      const outputData = await fs.readFile(outputPath);
      sendJson(res, {
        folder: payload.folder || '',
        file: payload.file || '',
        conversion,
        sourceBytes: inputStat.size,
        outputBytes: outputStat.size,
        outputSize: formatBytes(outputStat.size),
        mimeType: mimeTypeForPath(outputPath),
        url: previews.put(outputData, mimeTypeForPath(outputPath)),
      });
    } finally {
      res.off('close', abort);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
    return;
  }

  if (url.pathname === '/api/preview-quality-suggestion' && req.method === 'POST') {
    const payload = await readBody(req);
    const inputPath = sourceImagePath(payload.folder || '', payload.file || '');
    await assertRealInside(config.screenshotsRoot, inputPath);
    if (!(await pathExists(inputPath))) {
      sendJson(res, { error: 'Source image not found' }, 404);
      return;
    }

    const conversion = normalizeConversionSettings(payload.conversion || {});
    if (!qualitySuggestionSupported(conversion.format)) {
      sendJson(res, {
        suggestedQuality: null,
        candidates: [],
        reason: 'Quality suggestion is available for webp and jpg only',
      });
      return;
    }

    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', abort);
    try {
      sendJson(res, await suggestPreviewQuality(inputPath, payload.file || '', conversion, controller.signal));
    } finally {
      res.off('close', abort);
    }
    return;
  }

  if (url.pathname.startsWith('/api/preview-image/') && req.method === 'GET') {
    const preview = previews.get(url.pathname.slice('/api/preview-image/'.length));
    if (!preview) {
      sendText(res, 'Preview expired. Reopen the preview to generate it again.', 404);
      return;
    }
    res.writeHead(200, { 'content-type': preview.mimeType, 'content-length': preview.data.length, 'cache-control': 'no-store' });
    res.end(preview.data);
    return;
  }

  if (url.pathname === '/api/source-image') {
    const folder = url.searchParams.get('folder') || '';
    const file = url.searchParams.get('file') || '';
    const imagePath = sourceImagePath(folder, file);
    await assertRealInside(config.screenshotsRoot, imagePath);
    const data = await fs.readFile(imagePath);
    res.writeHead(200, { 'content-type': mimeTypeForPath(imagePath), 'cache-control': 'no-store' });
    res.end(data);
    return;
  }

  sendJson(res, { error: 'Not found' }, 404);
}

function publicConfig() {
  return {
    screenshotsRoot: config.screenshotsRoot,
    vaultRoot: config.vaultRoot,
    mediaRoot: config.mediaRoot,
    mediaDirs: config.mediaDirs,
    attachmentsTemplate: config.attachmentsTemplate,
    archiveDirName: config.archiveDirName,
  };
}

function sourceFolderPath(folder) {
  return checkedSourceFolderPath(config, folder);
}

function sourceImagePath(folder, file) {
  pathComponent(file, 'image filename');
  const folderPath = sourceFolderPath(folder);
  const imagePath = path.join(folderPath, file);
  assertInside(folderPath, imagePath, 'source image');
  if (!IMAGE_EXTENSIONS.has(path.extname(imagePath).toLowerCase())) {
    throw new Error(`Unsupported source image: ${file}`);
  }
  return imagePath;
}

function sourceImageUrl(folder, file) {
  const params = new URLSearchParams({ folder, file });
  return `/api/source-image?${params.toString()}`;
}

function mimeTypeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.tif' || ext === '.tiff') return 'image/tiff';
  if (ext === '.bmp') return 'image/bmp';
  return 'application/octet-stream';
}

function qualitySuggestionSupported(format) {
  return format === 'webp' || format === 'jpg';
}

async function suggestPreviewQuality(inputPath, fileName, conversion, signal) {
  const sourceStat = await fs.stat(inputPath);
  const qualities = [95, 90, 85, 80, 75, 70, 65, 60, 55, 50];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iina-quality-'));
  try {
    const candidates = [];
    for (const quality of qualities) {
      signal?.throwIfAborted();
      const candidateConversion = normalizeConversionSettings({ ...conversion, quality });
      const outputExt = outputExtensionForFormat(candidateConversion.format, fileName);
      const outputPath = path.join(tempDir, `q${quality}${outputExt}`);
      await convertImage(inputPath, outputPath, candidateConversion, { signal });
      const outputStat = await fs.stat(outputPath);
      candidates.push({
        quality,
        outputBytes: outputStat.size,
        reductionPercent: reductionPercent(sourceStat.size, outputStat.size),
      });
    }

    const suggested = pickQualityElbow(candidates, sourceStat.size);
    return {
      suggestedQuality: suggested.quality,
      outputBytes: suggested.outputBytes,
      sourceBytes: sourceStat.size,
      reductionPercent: suggested.reductionPercent,
      candidates,
      reason: suggested.reason,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function pickQualityElbow(candidates, sourceBytes) {
  const sorted = [...candidates].sort((a, b) => b.quality - a.quality);
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index];
    const next = sorted[index + 1];
    const extraBytes = Math.max(0, current.outputBytes - next.outputBytes);
    const extraSourcePercent = sourceBytes ? (extraBytes / sourceBytes) * 100 : 0;
    const extraOutputPercent = current.outputBytes ? (extraBytes / current.outputBytes) * 100 : 0;
    const alreadyCompressed = current.reductionPercent >= 75;
    const diminishing = extraSourcePercent < 2.5 || extraOutputPercent < 7;
    if (alreadyCompressed && diminishing) {
      return {
        ...current,
        reason: `Next lower step saves ${formatBytes(extraBytes)} more`,
      };
    }
  }

  const fallback = sorted.find((candidate) => candidate.quality <= 75) || sorted.at(-1);
  return {
    ...fallback,
    reason: 'Fallback quality on the tested size curve',
  };
}

function reductionPercent(sourceBytes, outputBytes) {
  const source = Number(sourceBytes) || 0;
  const output = Number(outputBytes) || 0;
  if (!source || !output) return 0;
  return Math.round(((source - output) / source) * 100);
}

async function openExistingPath(res, root, target, label) {
  assertInside(root, target, label);
  if (!(await pathExists(target))) {
    sendJson(res, { error: 'Path not found' }, 404);
    return;
  }
  await runCommand('open', [target]);
  sendJson(res, { ok: true });
}

function findArchivedFolder(run, sourceFolderName) {
  return (run.archivedFolders || []).find((candidate) => candidate.sourceFolderName === sourceFolderName) || null;
}

function summarizeScreenshotFolders(folders) {
  const folderCount = folders.length;
  const imageCount = folders.reduce((sum, folder) => sum + (Number(folder.imageCount) || 0), 0);
  const bytes = folders.reduce((sum, folder) => sum + (Number(folder.totalBytes) || 0), 0);
  return {
    folderCount,
    imageCount,
    bytes,
    size: formatBytes(bytes),
  };
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = path.join(publicRoot, requested);
  assertInside(publicRoot, filePath, 'static file');
  let data;
  try {
    data = await fs.readFile(filePath);
  } catch {
    sendText(res, 'Not found', 404);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
  }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  let ownsMutation = false;
  let ownsWrite = false;
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
        || (req.headers.origin && req.headers.origin !== url.origin)) {
      sendJson(res, { error: 'Only same-origin local requests are allowed' }, 403);
      return;
    }
    if (req.method === 'POST' && !String(req.headers['content-type']).startsWith('application/json')) {
      sendJson(res, { error: 'Expected application/json' }, 415);
      return;
    }
    if (req.method === 'POST') {
      if (stopping) {
        sendJson(res, { error: 'The application is shutting down' }, 503);
        return;
      }
      pendingWrites += 1;
      ownsWrite = true;
    }
    if (req.method === 'POST' && exclusivePaths.has(url.pathname)) {
      if (mutationActive) {
        sendJson(res, { error: 'Another import, rollback, or archive operation is running' }, 409);
        return;
      }
      mutationActive = true;
      ownsMutation = true;
    }
    if (url.pathname.startsWith('/api/')) {
      const detached = await handleApi(req, res, url);
      if (detached === true) ownsMutation = false;
    } else {
      await serveStatic(req, res, url);
    }
  } catch (error) {
    if (!res.destroyed && !res.headersSent) sendJson(res, { error: error.message }, error.status || 500);
  } finally {
    if (ownsMutation) mutationActive = false;
    if (ownsWrite) pendingWrites -= 1;
  }
});
server.isBusy = () => mutationActive || pendingWrites > 0;
server.prepareShutdown = () => { stopping = true; };
server.prepareUpdate = () => {
  if (stopping || server.isBusy()) throw new Error('Wait for the current operation to finish before installing an update');
  if (!updater?.downloaded) throw new Error('Download and verify an update before installing it');
  stopping = true;
  return updater.downloaded;
};
server.cancelUpdate = () => { stopping = false; };
return server;
}
