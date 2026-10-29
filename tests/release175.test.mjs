import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveConfig } from '../src/config.mjs';
import { ImportJob } from '../src/runner.mjs';
import { rollbackRun, listRuns } from '../src/rollback.mjs';
import { recoverInterruptedImports } from '../src/importRecovery.mjs';
import { createAppServer } from '../src/server.mjs';
import { pathExists, fileHash, writeJson } from '../src/utils.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'importer-175-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = resolveConfig({ screenshotsRoot: path.join(root, 'Screenshots'), vaultRoot: path.join(root, 'Vault'), mediaRoot: path.join(root, 'Vault/Media'), dataDir: path.join(root, 'data') });
  const note = path.join(config.mediaRoot, 'Series/Show.md');
  await fs.mkdir(path.dirname(note), { recursive: true });
  const before = '# Show\n\nKeep personal notes.\n';
  await fs.writeFile(note, before);
  const items = [];
  for (const name of ['A', 'B']) {
    const source = path.join(config.screenshotsRoot, name);
    await fs.mkdir(source, { recursive: true });
    for (let n = 0; n < 3; n++) await fs.writeFile(path.join(source, `${name}-${n}.png`), `${name} original ${n}`);
    items.push({ sourceFolderName: name, notePath: 'Media/Series/Show.md', mode: 'screenshots' });
  }
  return { config, note, before, items, payload: { items, conversion: { format: 'original' }, parallelImages: 1 } };
}

test('Stop finishes the current complete folder and leaves later folders untouched and rollbackable', async (t) => {
  const f = await fixture(t);
  class StopMidFolder extends ImportJob {
    async checkpoint() {
      await super.checkpoint();
      if (this.log.items[0]?.outputFileCount === 1) this.requestStop();
    }
  }
  const job = new StopMidFolder(f.config, f.payload);
  await job.run();
  assert.equal(job.status, 'stopped');
  assert.equal(job.log.items.length, 1);
  assert.equal(job.log.items[0].status, 'done');
  assert.equal(job.log.items[0].generatedFiles.length, 3);
  assert.equal(job.progress().remainingFolders, 1);
  assert.equal(job.progress().doneFiles, 3);
  assert.equal(job.progress().totalFiles, 6);
  assert.ok(job.log.stopRequestedAt);
  assert.ok(job.log.finishedAt);
  for (const file of job.log.items[0].generatedFiles) assert.equal(await fileHash(path.join(f.config.vaultRoot, file)), job.log.items[0].outputHashes[file]);
  assert.equal(await pathExists(path.join(f.config.screenshotsRoot, 'A')), false);
  assert.equal((await fs.readdir(path.join(f.config.screenshotsRoot, 'B'))).length, 3);
  const history = await listRuns(f.config);
  assert.equal(history.runs[0].status, 'stopped');
  assert.equal(history.runs[0].canRollback, true);
  assert.equal((await rollbackRun(f.config, job.id)).status, 'done');
  assert.equal((await fs.readdir(path.join(f.config.screenshotsRoot, 'A'))).length, 3);
  assert.match(await fs.readFile(f.note, 'utf8'), /Keep personal notes/);
});

test('Stop before work touches no folders, and Stop during the last folder still completes normally', async (t) => {
  const f = await fixture(t);
  const empty = new ImportJob(f.config, f.payload);
  assert.equal(empty.requestStop(), true);
  await empty.run();
  assert.equal(empty.status, 'stopped');
  assert.equal(empty.log.items.length, 0);
  assert.equal(empty.progress().remainingFolders, 2);
  assert.equal(await fs.readFile(f.note, 'utf8'), f.before);
  class StopLast extends ImportJob {
    async checkpoint() { await super.checkpoint(); if (this.doneFiles) this.requestStop(); }
  }
  const last = new StopLast(f.config, { ...f.payload, items: [f.items[0]] });
  await last.run();
  assert.equal(last.status, 'done');
  assert.equal(last.requestStop(), false);
  assert.equal(last.progress().remainingFolders, 0);
});

test('Stop API is idempotent, exclusive, discoverable, and finalizes its journal before releasing the lock', async (t) => {
  const f = await fixture(t);
  const original = ImportJob.prototype.checkpoint;
  let release, reached;
  const gate = new Promise((resolve) => { release = resolve; });
  const waiting = new Promise((resolve) => { reached = resolve; });
  ImportJob.prototype.checkpoint = async function () {
    await original.call(this);
    if (this.log.items[0]?.outputFileCount === 1) { reached(); await gate; }
  };
  t.after(() => { release(); ImportJob.prototype.checkpoint = original; });
  const server = createAppServer(f.config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, payload) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const get = async (url) => (await fetch(base + url)).json();
  const { jobId } = await (await post('/api/run', f.payload)).json();
  await waiting;
  for (let n = 0; n < 2; n++) assert.equal((await post(`/api/jobs/${jobId}/stop`, {})).status, 200);
  assert.equal((await get('/api/active-job')).job.stopRequested, true);
  assert.equal((await post('/api/run', f.payload)).status, 409);
  assert.equal((await post('/api/rollback', { runId: jobId, background: true })).status, 409);
  assert.equal((await post('/api/jobs/other/stop', {})).status, 409);
  release();
  let job;
  for (let n = 0; n < 500; n++) {
    job = await get(`/api/jobs/${jobId}`);
    if (job.status === 'stopped') break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(job.status, 'stopped');
  assert.equal(server.isBusy(), false);
  const journal = JSON.parse(await fs.readFile(path.join(f.config.runsDir, `${jobId}.json`)));
  assert.equal(journal.status, 'stopped');
  assert.ok(journal.finishedAt);
  assert.equal((await post(`/api/jobs/${jobId}/stop`, {})).status, 409);
  assert.equal((await post('/api/rollback', { runId: jobId })).status, 200);
});

test('startup recovery marks only unfinished imports, preserves journal evidence, and is idempotent', async (t) => {
  const f = await fixture(t);
  const run = { runId: 'interrupted-test', status: 'running', finishedAt: null,
    items: [{ sourceFolderName: 'A', status: 'done' }, { sourceFolderName: 'B', status: 'running', outputHashes: { 'Images/a.png': 'hash' } }],
    archivedFolders: [{ sourceFolderName: 'A', archivedPath: 'evidence' }] };
  await writeJson(path.join(f.config.runsDir, 'interrupted-test.json'), run);
  await writeJson(path.join(f.config.runsDir, 'done.json'), { runId: 'done', status: 'done', finishedAt: '2026-01-01' });
  await writeJson(path.join(f.config.runsDir, 'stopped.json'), { runId: 'stopped', status: 'stopped', finishedAt: '2026-01-01' });
  assert.deepEqual(await recoverInterruptedImports(f.config), ['interrupted-test']);
  const recovered = JSON.parse(await fs.readFile(path.join(f.config.runsDir, 'interrupted-test.json')));
  assert.equal(recovered.status, 'interrupted');
  assert.equal(recovered.items[0].status, 'done');
  assert.equal(recovered.items[1].status, 'interrupted');
  assert.deepEqual(recovered.items[1].outputHashes, run.items[1].outputHashes);
  assert.deepEqual(recovered.archivedFolders, run.archivedFolders);
  assert.equal(recovered.finishedAt, null, 'Do not invent a successful completion time');
  assert.deepEqual(await recoverInterruptedImports(f.config), []);
  assert.equal(await fs.readFile(f.note, 'utf8'), f.before);
});
