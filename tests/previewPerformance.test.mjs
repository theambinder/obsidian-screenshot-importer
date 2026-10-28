import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PreviewWorkQueue } from '../src/previewWork.mjs';
import { PreviewImages, renderPreviewImage } from '../src/previewImages.mjs';
import { PreviewCache } from '../src/previewCache.mjs';
import { createPreviewImageLoader } from '../public/previewImages.js';
import { newTabNoteUri } from '../public/obsidianUri.js';
import { obsidianOpenUri } from '../src/utils.mjs';
import { resolveConfig } from '../src/config.mjs';
import { createAppServer } from '../src/server.mjs';
import { ImportJob } from '../src/runner.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.PATH = `${path.join(project, 'dist/Obsidian Screenshot Importer.app/Contents/Resources/bin')}:/usr/bin:/bin:/usr/sbin:/sbin`;
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const dimensions = (png) => [png.readUInt32BE(16), png.readUInt32BE(20)];

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-173-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('preview work is serialized and foreground conversions precede queued background work', async () => {
  const queue = new PreviewWorkQueue(), gate = deferred(), order = [];
  const first = queue.run(async () => { order.push('active'); await gate.promise; });
  const low = queue.run(async () => { order.push('estimate'); }, { priority: -10 });
  const high = queue.run(async () => { order.push('conversion'); }, { priority: 60 });
  gate.resolve();
  await Promise.all([first, low, high]);
  assert.deepEqual(order, ['active', 'conversion', 'estimate']);
});

test('closing cancels active and queued preview work, and later requests still work', async () => {
  const queue = new PreviewWorkQueue(), started = deferred();
  const active = assert.rejects(queue.run((signal) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    started.resolve();
  })), /abort/i);
  const pending = assert.rejects(queue.run(() => { assert.fail('Cancelled task must not run'); }), /abort/i);
  await started.promise;
  queue.cancelAll();
  await Promise.all([active, pending]);
  assert.equal(await queue.run(() => 42), 42);
});

test('image proxies cache versions, enforce byte limits, and remove scratch files', async (t) => {
  const directory = await fixture(t), input = path.join(directory, 'source.png'), scratch = [];
  await fs.writeFile(input, 'source');
  let renders = 0;
  const cache = new PreviewImages(new PreviewWorkQueue(), { maxBytes: 10, render: async (_, output) => {
    renders++; scratch.push(path.dirname(output)); await fs.writeFile(output, Buffer.alloc(8));
  } });
  await cache.get(input, 'thumbnail'); await cache.get(input, 'thumbnail');
  assert.equal(renders, 1);
  await fs.writeFile(input, 'changed source');
  await cache.get(input, 'thumbnail');
  assert.equal(renders, 2);
  assert.equal(cache.bytes, 8); assert.equal(cache.entries.size, 1);
  for (const location of scratch) await assert.rejects(fs.stat(location), { code: 'ENOENT' });
});

test('aborted image renders clean temporary files without publishing partial cache entries', async (t) => {
  const directory = await fixture(t), input = path.join(directory, 'source.png'), started = deferred();
  await fs.writeFile(input, 'source');
  let scratch;
  const queue = new PreviewWorkQueue();
  const cache = new PreviewImages(queue, { render: async (_, output, __, { signal }) => {
    scratch = path.dirname(output); await fs.writeFile(output, 'partial'); started.resolve();
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  const request = assert.rejects(cache.get(input, 'overview'), /abort/i);
  await started.promise; queue.cancelAll(); await request;
  assert.equal(cache.entries.size, 0);
  await assert.rejects(fs.stat(scratch), { code: 'ENOENT' });
});

test('native previews bound overview/thumbnail dimensions and keep center crops unscaled', async (t) => {
  const directory = await fixture(t), source = path.join(project, 'tests/fixtures/hdr-1080.png');
  const before = await fs.readFile(source);
  for (const [view, expected] of [['thumbnail', [256, 144]], ['overview', [1600, 900]], ['crop', [512, 512]]]) {
    const output = path.join(directory, `${view}.png`);
    await renderPreviewImage(source, output, view);
    const data = await fs.readFile(output);
    assert.deepEqual(dimensions(data), expected);
    if (view !== 'crop') assert.ok(data.length < before.length);
  }
  assert.deepEqual(await fs.readFile(source), before);
});

test('preview-cache eviction accounts for full-resolution files and display variants together', () => {
  const cache = new PreviewCache({ maxBytes: 6 });
  const url = cache.put(Buffer.alloc(3), 'image/webp', { overview: { data: Buffer.alloc(2), mimeType: 'image/png' } });
  assert.equal(cache.bytes, 5);
  assert.equal(cache.get(url.split('/').at(-1)).variants.overview.data.length, 2);
  cache.put(Buffer.alloc(2), 'image/png');
  assert.equal(cache.bytes, 2);
  assert.equal(cache.get(url.split('/').at(-1)), undefined);
});

test('browser image loading aborts detached images and releases every object URL', async () => {
  const pending = [], revoked = [];
  const image = { src: '', removeAttribute() { this.src = ''; } };
  const loader = createPreviewImageLoader({
    fetchImage: (url, { signal }) => new Promise((resolve, reject) => {
      pending.push({ url, signal, resolve });
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }), createUrl: () => 'blob:bounded-proxy', revokeUrl: (url) => revoked.push(url),
  });
  const stale = loader.load(image, 'old');
  const current = loader.load(image, 'new');
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve({ ok: true, blob: async () => new Blob(['small']) });
  await Promise.all([stale, current]);
  assert.equal(image.src, 'blob:bounded-proxy');
  loader.clearAll();
  assert.equal(image.src, '');
  assert.deepEqual(revoked, ['blob:bounded-proxy']);
});

test('new-tab Obsidian URIs preserve headings/encoded paths and upgrade old history links', () => {
  const target = '/Vault/Notes/A + B.md#S3E0';
  const generated = obsidianOpenUri('/Vault/Notes/A + B.md', 'S3E0');
  for (const uri of [generated, `obsidian://open?path=${encodeURIComponent(target)}`, generated.replace('tab', 'split')]) {
    const result = newTabNoteUri(uri), parsed = new URL(result);
    assert.equal(parsed.searchParams.get('path'), target);
    assert.equal(parsed.searchParams.get('paneType'), 'tab');
    assert.equal(result.includes('+'), false);
  }
  assert.throws(() => newTabNoteUri('https://example.com/'), /Invalid/);
});

test('source/converted API display proxies are bounded while full-resolution links retain exact bytes', async (t) => {
  const directory = await fixture(t);
  const config = resolveConfig({ screenshotsRoot: path.join(directory, 'Screenshots'), vaultRoot: path.join(directory, 'Vault'), mediaRoot: path.join(directory, 'Vault/Media'), dataDir: path.join(directory, 'data') });
  const source = path.join(config.screenshotsRoot, 'Large Images');
  await fs.mkdir(source, { recursive: true });
  const original = await fs.readFile(path.join(project, 'tests/fixtures/hdr-1080.png'));
  await fs.writeFile(path.join(source, 'capture.png'), original);
  const server = createAppServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.prepareShutdown(); server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (route, body) => {
    const response = await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data;
  };
  const { files: [file] } = await post('/api/source-files', { folder: 'Large Images' });
  for (const [url, expected] of [[file.thumbnailUrl, [256, 144]], [file.displayUrl, [1600, 900]], [file.cropUrl, [512, 512]]]) {
    const response = await fetch(base + url);
    assert.equal(response.status, 200);
    assert.deepEqual(dimensions(Buffer.from(await response.arrayBuffer())), expected);
  }
  assert.deepEqual(Buffer.from(await (await fetch(base + file.url)).arrayBuffer()), original);
  const preview = await post('/api/preview-conversion', { folder: 'Large Images', file: 'capture.png', conversion: { format: 'webp', resolution: '720', quality: 40 } });
  const encoded = Buffer.from(await (await fetch(base + preview.url)).arrayBuffer());
  assert.equal(encoded.length, preview.outputBytes);
  assert.equal(encoded.toString('ascii', 8, 12), 'WEBP');
  assert.deepEqual(dimensions(Buffer.from(await (await fetch(base + preview.displayUrl)).arrayBuffer())), [1280, 720]);
  assert.deepEqual(dimensions(Buffer.from(await (await fetch(base + preview.cropUrl)).arrayBuffer())), [341, 341]);
  assert.equal((await fetch(base + file.url + '&view=invalid')).status, 400);
  assert.equal((await fetch(base + preview.url + '?view=__proto__')).status, 400);
});

test('HDR source and converted display proxies retain 16-bit PQ/BT2020 metadata', async (t) => {
  const directory = await fixture(t);
  const config = resolveConfig({ screenshotsRoot: path.join(directory, 'Screenshots'), vaultRoot: path.join(directory, 'Vault'), mediaRoot: path.join(directory, 'Vault/Media'), dataDir: path.join(directory, 'data') });
  const source = path.join(config.screenshotsRoot, 'HDR Test');
  await fs.mkdir(source, { recursive: true });
  await fs.copyFile(path.join(project, 'tests/fixtures/hdr-1080.jxr'), path.join(source, 'capture.jxr'));
  const server = createAppServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.prepareShutdown(); server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + '/api/preview-conversion', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder: 'HDR Test', file: 'capture.jxr', conversion: { quality: 40, resolution: '720' } }) });
  const preview = await response.json();
  assert.equal(response.status, 200, JSON.stringify(preview));
  for (const url of ['/api/source-image?folder=HDR+Test&file=capture.jxr&view=overview', '/api/source-image?folder=HDR+Test&file=capture.jxr&view=crop', preview.displayUrl, preview.cropUrl]) {
    const image = await fetch(base + url);
    assert.equal(image.status, 200);
    const png = Buffer.from(await image.arrayBuffer()), cicp = png.indexOf(Buffer.from('cICP'));
    assert.equal(png[24], 16);
    assert.ok(cicp > 0);
    assert.deepEqual([...png.subarray(cicp + 4, cicp + 8)], [9, 16, 0, 1]);
    assert.ok(dimensions(png).every((value) => value > 0 && value <= 1600));
  }
});

test('terminal job status stays hidden until the final journal write releases the mutation lock', async (t) => {
  const directory = await fixture(t);
  const config = resolveConfig({ screenshotsRoot: path.join(directory, 'Screenshots'), vaultRoot: path.join(directory, 'Vault'), mediaRoot: path.join(directory, 'Vault/Media'), dataDir: path.join(directory, 'data') });
  await fs.mkdir(path.join(config.mediaRoot, 'Series'), { recursive: true });
  await fs.writeFile(path.join(config.mediaRoot, 'Series/Show.md'), '# Show\n');
  await fs.mkdir(path.join(config.screenshotsRoot, 'Show'), { recursive: true });
  await fs.writeFile(path.join(config.screenshotsRoot, 'Show/image.png'), 'disposable fixture');
  const entered = deferred(), release = deferred();
  const checkpoint = ImportJob.prototype.checkpoint;
  ImportJob.prototype.checkpoint = async function () {
    if (['done', 'partial', 'error'].includes(this.status)) { entered.resolve(); await release.promise; }
    return checkpoint.call(this);
  };
  t.after(() => { release.resolve(); ImportJob.prototype.checkpoint = checkpoint; });
  const server = createAppServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.prepareShutdown(); server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body) => fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const started = await post('/api/run', { items: [{ sourceFolderName: 'Show', notePath: 'Media/Series/Show.md', mode: 'episode', season: 1, episode: 1 }], conversion: { format: 'original' } });
  const { jobId } = await started.json();
  await entered.promise;
  assert.equal((await (await fetch(base + `/api/jobs/${jobId}`)).json()).status, 'running');
  assert.equal((await (await fetch(base + '/api/active-job')).json()).job.status, 'running');
  assert.equal((await post('/api/rollback', { runId: jobId, background: true })).status, 409);
  release.resolve();
  for (let attempt = 0; attempt < 100; attempt++) {
    const snapshot = await (await fetch(base + `/api/jobs/${jobId}`)).json();
    if (snapshot.status === 'done') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(server.isBusy(), false);
  const rollback = await post('/api/rollback', { runId: jobId, background: true });
  assert.equal(rollback.status, 200);
  const rollbackId = (await rollback.json()).jobId;
  for (let attempt = 0; attempt < 100; attempt++) {
    const snapshot = await (await fetch(base + `/api/jobs/${rollbackId}`)).json();
    if (snapshot.status === 'done') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(server.isBusy(), false);
});
