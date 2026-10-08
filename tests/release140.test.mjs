import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveConfig } from '../src/config.mjs';
import { loadAppSettings, saveAppSettings } from '../src/appSettings.mjs';
import { normalizeImageFolderTemplate } from '../src/imageFolder.mjs';
import { parseSourceName } from '../src/matcher.mjs';
import { ImportJob } from '../src/runner.mjs';
import { rollbackRun } from '../src/rollback.mjs';
import { createAppServer } from '../src/server.mjs';
import { sortFolders, setNoteFoldersMode } from '../public/folderTable.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'importer-140-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = resolveConfig({
    vaultRoot: path.join(root, 'Vault'), mediaRoot: path.join(root, 'Vault/Media'),
    screenshotsRoot: path.join(root, 'Screenshots'), dataDir: path.join(root, 'data'), port: 0,
  });
  await fs.mkdir(path.join(config.mediaRoot, 'Series'), { recursive: true });
  await fs.mkdir(config.screenshotsRoot, { recursive: true });
  await fs.writeFile(path.join(config.mediaRoot, 'Series/Show.md'), '# Show\n\nKeep my thoughts.\n');
  const notePath = 'Media/Series/Show.md';
  const item = (name) => ({ sourceFolderName: name, notePath, mode: 'screenshots' });
  async function source(name, count = 1) {
    const folder = path.join(config.screenshotsRoot, name);
    await fs.mkdir(folder, { recursive: true });
    for (let n = 0; n < count; n++) await fs.writeFile(path.join(folder, `shot-${n}.png`), `fixture ${n}`);
  }
  const server = createAppServer(config);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (url) => (await fetch(base + url)).json();
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { root, config, notePath, item, source, server, get, post };
}

test('group mode uses exact notes, preserves manual numbers and E0, and leaves unknown episodes blank', () => {
  const row = (note, season, episode) => ({ selectedNotePath: note, mode: 'screenshots', parsed: { season, episode } });
  const a = row('Series/Show.md', 3, 0);
  const b = row('Series/Show.md', null, null);
  b.detectedEpisode = { season: 2, episode: 8 };
  const c = row('Series/Show.md', null, null);
  const other = row('Games/Show.md', 5, 5);
  const unmatched = row('', null, null);
  const rows = [a, b, c, other, unmatched];
  assert.equal(setNoteFoldersMode(rows, a, 'episode').length, 3);
  assert.deepEqual(rows.map((r) => [r.mode, r.parsed.season, r.parsed.episode]), [
    ['episode', 3, 0], ['episode', 2, 8], ['episode', 1, null], ['screenshots', 5, 5], ['screenshots', null, null],
  ]);
  setNoteFoldersMode(rows, a, 'screenshots');
  assert.equal(b.mode, 'screenshots');
  setNoteFoldersMode(rows, a, 'episode');
  assert.equal(a.parsed.episode, 0);
  setNoteFoldersMode(rows, unmatched, 'episode');
  assert.equal(other.mode, 'screenshots');
});

test('folder size sorting is numeric, stable, reversible, and leaves scan order unchanged', () => {
  const rows = [{ totalBytes: 10000 }, { totalBytes: 90 }, { totalBytes: 10000 }, {}];
  assert.deepEqual(sortFolders(rows, { key: 'size', direction: 'asc' }), [rows[1], rows[0], rows[2], rows[3]]);
  assert.deepEqual(sortFolders(rows, { key: 'size', direction: 'desc' }), [rows[0], rows[2], rows[1], rows[3]]);
  assert.deepEqual(sortFolders(rows, null), rows);
});

test('recognizes Season, named episodes, x notation, and zero without treating movie years as episodes', () => {
  for (const [name, season, episode] of [
    ['One Punch Man Season 3 - 12.mkv', 3, 12], ['Show Season 3 Episode 00.mkv', 3, 0],
    ['Show.2x08.mkv', 2, 8], ['Show S02 Ep08.mkv', 2, 8], ['Show Episode 9.mkv', 1, 9],
  ]) {
    const parsed = parseSourceName(name);
    assert.equal(parsed.season, season, name);
    assert.equal(parsed.episode, episode, name);
  }
  assert.equal(parseSourceName('Movie.2025.2160p.mkv').mode, 'screenshots');
});

test('image folders and per-note modes persist, remain scoped, and rejected paths do not overwrite settings', async (t) => {
  const f = await fixture(t);
  assert.equal((await loadAppSettings(f.config)).imageFolderTemplate, f.config.attachmentsTemplate);
  await saveAppSettings(f.config, {
    imageFolderTemplate: 'Images/{notename}/',
    noteModes: { [f.notePath]: 'episode', 'Private/Secrets.md': 'episode', '../Escape.md': 'episode' },
  });
  await saveAppSettings(f.config, { theme: 'dark' });
  const saved = await loadAppSettings(f.config);
  assert.deepEqual(saved.noteModes, { [f.notePath]: 'episode' });
  assert.equal(saved.imageFolderTemplate, 'Images/{notename}');
  for (const invalid of ['/tmp', '../Images', 'Images/../x', 'C:\\Images', 'Images/{unknown}', '', 'Images//x']) {
    assert.throws(() => normalizeImageFolderTemplate(invalid));
    const response = await f.post('/api/settings', { imageFolderTemplate: invalid });
    assert.equal(response.status, 400, invalid);
    assert.deepEqual(await loadAppSettings(f.config), saved);
  }
  await f.source('Show (unrecognized episode)');
  const scan = await f.get('/api/scan');
  assert.equal(scan.folders[0].selectedNotePath, f.notePath);
  assert.equal(scan.folders[0].mode, 'episode');
  assert.equal(scan.folders[0].parsed.episode, null);
  assert.equal(scan.folders[0].parsed.season, 1);
  assert.equal(scan.config.attachmentsTemplate, 'Images/{notename}');
});

async function finished(f, jobId) {
  const snapshots = [];
  for (let n = 0; n < 2000; n++) {
    const job = await f.get(`/api/jobs/${jobId}`);
    snapshots.push(job);
    if (['done', 'partial', 'error'].includes(job.status)) return { job, snapshots };
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Job did not finish');
}

test('API imports to the saved destination and async rollback stays discoverable and exclusive until finished', async (t) => {
  const f = await fixture(t);
  await f.source('Show', 180);
  await saveAppSettings(f.config, { imageFolderTemplate: 'Images/{notename}' });
  const start = await f.post('/api/run', { items: [f.item('Show')], conversion: { format: 'original' } });
  const importId = (await start.json()).jobId;
  const imported = (await finished(f, importId)).job;
  assert.equal(imported.status, 'done', imported.error);
  assert.ok(imported.log.generatedFiles.every((file) => file.startsWith('Images/Show/')));
  const before = await fs.stat(path.join(f.config.mediaRoot, 'Series/Show.md'), { bigint: true });
  const response = await f.post('/api/rollback', { runId: importId, background: true });
  const { jobId } = await response.json();
  assert.ok(jobId.startsWith('rollback-'));
  assert.equal(f.server.isBusy(), true);
  // A new page can discover the current operation without knowing its job ID.
  const active = (await f.get('/api/active-job')).job;
  assert.equal(active.id, jobId);
  assert.equal(active.kind, 'rollback');
  assert.equal(active.runId, importId);
  for (const url of ['/api/rollback', '/api/rollback-item', '/api/archive/clear', '/api/run']) {
    assert.equal((await f.post(url, { runId: importId, sourceFolderName: 'Show', background: true })).status, 409, url);
  }
  const { job, snapshots } = await finished(f, jobId);
  assert.equal(job.status, 'done', JSON.stringify(job.result));
  assert.equal(job.percent, 100);
  assert.equal(job.totalFiles, 182);
  assert.equal(job.doneFiles, 182);
  assert.ok(snapshots.some((snapshot) => snapshot.doneFiles > 0 && snapshot.doneFiles < snapshot.totalFiles));
  assert.ok(snapshots.every((snapshot, i) => i === 0 || snapshot.doneFiles >= snapshots[i - 1].doneFiles));
  assert.equal((await f.get('/api/active-job')).job, null);
  assert.equal(f.server.isBusy(), false);
  assert.equal((await fs.readdir(path.join(f.config.screenshotsRoot, 'Show'))).length, 180);
  assert.equal((await fs.readdir(path.join(f.config.vaultRoot, 'Images/Show'))).length, 0);
  const after = await fs.stat(path.join(f.config.mediaRoot, 'Series/Show.md'), { bigint: true });
  if (process.platform === 'darwin') assert.equal(after.birthtimeNs, before.birthtimeNs);
  assert.match(await fs.readFile(path.join(f.config.mediaRoot, 'Series/Show.md'), 'utf8'), /Keep my thoughts/);
  // A failed start must release the mutation lock instead of wedging the service.
  const failed = await f.post('/api/rollback', { runId: 'missing-run', background: true });
  const failure = (await finished(f, (await failed.json()).jobId)).job;
  assert.equal(failure.status, 'error');
  assert.equal(f.server.isBusy(), false);
});

test('rollback reports phases and checkpoints, including skipped and failed folders', async (t) => {
  const f = await fixture(t);
  await f.source('A', 2);
  await f.source('B', 2);
  const imported = new ImportJob(f.config, { items: [f.item('A'), f.item('B')], conversion: { format: 'original' } });
  await imported.run();
  assert.equal(imported.status, 'done');
  const first = await f.post('/api/rollback-item', { runId: imported.id, sourceFolderName: 'A', background: true });
  assert.equal((await finished(f, (await first.json()).jobId)).job.status, 'done');
  await f.source('B'); // A conflict must keep this note block and archived source intact.
  const events = [];
  const result = await rollbackRun(f.config, imported.id, { onProgress: (event) => events.push(event) });
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.skippedFolders, ['A']);
  assert.equal(events.at(-1).doneFiles, events.at(-1).totalFiles);
  assert.ok(events.some((event) => /checking references/.test(event.current)));
  assert.ok(events.some((event) => /processed B/.test(event.current)));
});

test('invalid item rollback requests never start a full-run rollback and release the lock', async (t) => {
  const f = await fixture(t);
  await f.source('A');
  const imported = new ImportJob(f.config, { items: [f.item('A')], conversion: { format: 'original' } });
  await imported.run();
  assert.equal(imported.status, 'done');
  const before = await fs.readFile(path.join(f.config.mediaRoot, 'Series/Show.md'), 'utf8');
  for (const sourceFolderName of [undefined, null, '', false, '../A', 'A/B']) {
    const response = await f.post('/api/rollback-item', { runId: imported.id, sourceFolderName, background: true });
    assert.equal(response.ok, false);
    assert.equal(f.server.isBusy(), false);
    assert.equal((await f.get('/api/active-job')).job, null);
    assert.equal(await fs.readFile(path.join(f.config.mediaRoot, 'Series/Show.md'), 'utf8'), before);
    assert.equal((await f.get('/api/runs')).runs[0].status, 'done');
  }
  const valid = await f.post('/api/rollback-item', { runId: imported.id, sourceFolderName: 'A', background: true });
  assert.equal((await finished(f, (await valid.json()).jobId)).job.status, 'done');
});
