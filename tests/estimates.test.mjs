import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { targetDimensions, normalizeResolution, compressionDescription } from '../public/conversionProfile.js';
import { CompressionEstimator, estimateSamples } from '../src/compressionEstimate.mjs';
import { imageInfo } from '../src/imageInfo.mjs';
import { convertImage } from '../src/converter.mjs';
import { scanScreenshotFolders } from '../src/screenshotScanner.mjs';
import { createAppServer } from '../src/server.mjs';
import { loadAppSettings, saveAppSettings } from '../src/appSettings.mjs';
import { resolveConfig } from '../src/config.mjs';
import { ImportJob } from '../src/runner.mjs';
import { rollbackRun } from '../src/rollback.mjs';
import { runCommand, pathExists } from '../src/utils.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'dist/Obsidian Screenshot Importer.app/Contents/Resources/bin');
process.env.PATH = `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`;

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-estimate-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const config = resolveConfig({ screenshotsRoot: path.join(directory, 'Screenshots'), vaultRoot: path.join(directory, 'Vault'), mediaRoot: path.join(directory, 'Vault/Media'), dataDir: path.join(directory, 'data') });
  const source = path.join(config.screenshotsRoot, 'Show');
  const note = path.join(config.mediaRoot, 'Series/Show.md');
  await fs.mkdir(source, { recursive: true }); await fs.mkdir(path.dirname(note), { recursive: true });
  await fs.writeFile(note, '# Show\n\nPersonal thoughts.\n');
  const item = { sourceFolderName: 'Show', notePath: 'Media/Series/Show.md', mode: 'episode', season: 1, episode: 1, quality: 40, resolution: '720' };
  return { directory, config, source, note, item };
}

async function listing(directory) {
  const entries = await fs.readdir(directory);
  const files = [];
  for (const name of entries) {
    const stat = await fs.stat(path.join(directory, name));
    files.push({ name, bytes: stat.size, mtimeMs: stat.mtimeMs });
  }
  return files;
}

test('resolution presets fit landscape, portrait, and ultrawide images without distortion or upscaling', () => {
  assert.deepEqual(targetDimensions({ width: 3840, height: 2160 }, '1080'), { width: 1920, height: 1080 });
  assert.deepEqual(targetDimensions({ width: 2160, height: 3840 }, '720'), { width: 720, height: 1280 });
  assert.deepEqual(targetDimensions({ width: 3440, height: 1440 }, '1080'), { width: 1920, height: 804 });
  assert.deepEqual(targetDimensions({ width: 3140, height: 2200 }, '1080'), { width: 1541, height: 1080 });
  assert.deepEqual(targetDimensions({ width: 640, height: 360 }, '1080'), { width: 640, height: 360 });
  assert.deepEqual(targetDimensions({ width: 3840, height: 2160 }, 'original'), { width: 3840, height: 2160 });
  assert.throws(() => normalizeResolution('999'), /Unsupported/);
  assert.equal(normalizeResolution(undefined), '1080');
});

test('quality tooltips describe the actual encoder rather than implying the scales are equivalent', () => {
  assert.match(compressionDescription('capture.jxr', { format: 'webp', quality: 40 }), /CRF 16[\s\S]*10-bit[\s\S]*HDR/);
  assert.match(compressionDescription('capture.png', { format: 'webp', quality: 50, effort: 4 }), /Effort 4/);
  assert.match(compressionDescription('capture.png', { format: 'jpg', quality: 90 }), /q:v 5/);
  assert.match(compressionDescription('capture.png', { format: 'png', quality: 1 }), /lossless[\s\S]*does not affect/);
  assert.match(compressionDescription('capture.png', { format: 'original', quality: 1 }), /byte-for-byte/);
});

test('1080p is the default while explicitly saved Original and smaller presets are preserved', async (t) => {
  const f = await fixture(t);
  assert.equal((await loadAppSettings(f.config)).resolution, '1080');
  await saveAppSettings(f.config, { resolution: 'original' });
  assert.equal((await loadAppSettings(f.config)).resolution, 'original');
  await saveAppSettings(f.config, { resolution: '720' });
  assert.equal((await loadAppSettings(f.config)).resolution, '720');
});

test('default scan order uses directory Date Modified, not the newest image date', async (t) => {
  const f = await fixture(t);
  for (const [name, folderDate, imageDate] of [['A', '2024-01-01', '2030-01-01'], ['B', '2025-01-01', '2020-01-01']]) {
    const folder = path.join(f.config.screenshotsRoot, name); await fs.mkdir(folder);
    const image = path.join(folder, 'image.png'); await fs.writeFile(image, 'fixture');
    await fs.utimes(image, new Date(imageDate), new Date(imageDate));
    await fs.utimes(folder, new Date(folderDate), new Date(folderDate));
  }
  const folders = await scanScreenshotFolders(f.config);
  assert.deepEqual(folders.map((folder) => folder.name), ['B', 'A']);
  assert.equal(folders[0].modifiedMs, Date.parse('2025-01-01'));
  assert.equal(folders[0].latestMtimeMs, Date.parse('2020-01-01'));
});

test('estimates encode at most two samples, cache results, and invalidate for settings and source changes', async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 20; index++) await fs.writeFile(path.join(f.source, `${String(index).padStart(2, '0')}.png`), Buffer.alloc(1000));
  let encodes = 0;
  const scratch = new Set();
  const estimator = new CompressionEstimator({ inspect: async () => ({ width: 3840, height: 2160 }),
    encode: async (_, output, settings) => { encodes++; scratch.add(path.dirname(output)); await fs.writeFile(output, Buffer.alloc(settings.quality)); } });
  const first = await estimator.estimate(f.source, await listing(f.source), { quality: 40, resolution: '1080' });
  assert.equal(first.sampleCount, 2); assert.equal(first.estimatedBytes, 800); assert.equal(encodes, 2);
  assert.deepEqual(first.outputDimensions, { width: 1920, height: 1080 });
  assert.equal((await estimator.estimate(f.source, await listing(f.source), { quality: 40, resolution: '1080' })).cached, true);
  assert.equal(encodes, 2);
  await estimator.estimate(f.source, await listing(f.source), { quality: 50, resolution: '1080' });
  assert.equal(encodes, 4);
  await estimator.estimate(f.source, await listing(f.source), { quality: 50, resolution: '720' });
  assert.equal(encodes, 6);
  await fs.writeFile(path.join(f.source, '00.png'), Buffer.alloc(1200));
  await estimator.estimate(f.source, await listing(f.source), { quality: 40, resolution: '1080' });
  assert.equal(encodes, 7, 'Unchanged middle sample is reused');
  for (const folder of scratch) assert.equal(await pathExists(folder), false);
  assert.equal((await fs.readdir(f.source)).length, 20);
});

test('pair estimates sample HDR/SDR separately and omit only actual unselected counterparts', async (t) => {
  const f = await fixture(t);
  for (const name of ['capture.jxr', 'capture.png', 'unpaired.png']) await fs.writeFile(path.join(f.source, name), Buffer.alloc(1000));
  const conversion = { format: 'webp', quality: 40 };
  assert.deepEqual(estimateSamples(await listing(f.source), conversion).map((file) => file.name), ['capture.jxr', 'capture.png']);
  const estimator = new CompressionEstimator({ inspect: async () => ({ width: 3840, height: 2160 }),
    encode: async (input, output) => fs.writeFile(output, Buffer.alloc(input.endsWith('.jxr') ? 100 : 300)) });
  const data = await estimator.estimate(f.source, await listing(f.source), conversion, 'both');
  assert.equal(data.estimatedBytes, 700);
  const hdr = await estimator.estimate(f.source, await listing(f.source), conversion, 'jxr');
  assert.equal(hdr.estimatedBytes, 400);
  assert.equal(hdr.files.find((file) => file.name === 'capture.png').included, false);
});

test('estimator cancels active work, drains its queue, and removes temporary files', async (t) => {
  const f = await fixture(t); await fs.writeFile(path.join(f.source, 'capture.png'), Buffer.alloc(100));
  let started; const ready = new Promise((resolve) => { started = resolve; }); let scratch;
  const estimator = new CompressionEstimator({ inspect: async () => ({ width: 1920, height: 1080 }), encode: async (_, output, settings, { signal }) => {
    scratch = path.dirname(output); started();
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  const task = estimator.estimate(f.source, await listing(f.source), {});
  const rejected = assert.rejects(task, /abort/i); await ready; estimator.cancelAll(); await rejected;
  assert.equal(await pathExists(scratch), false); assert.equal(estimator.controllers.size, 0);
});

test('copy estimates do not encode and cannot imply a resize happened', async (t) => {
  const f = await fixture(t); await fs.writeFile(path.join(f.source, 'capture.png'), Buffer.alloc(100));
  const estimator = new CompressionEstimator({ inspect: async () => ({ width: 3840, height: 2160 }), encode: async () => assert.fail('Copy must not encode') });
  const data = await estimator.estimate(f.source, await listing(f.source), { format: 'original', resolution: '720' });
  assert.equal(data.estimatedBytes, 100); assert.equal(data.encodedSamples, 0);
  assert.deepEqual(data.outputDimensions, data.sourceDimensions);
});

for (const format of ['webp', 'jpg', 'png', 'avif', 'original']) {
  test(`${format} conversion respects resolution and leaves the source unchanged`, async (t) => {
    const f = await fixture(t);
    const source = path.join(root, 'tests/fixtures/hdr-1080.png');
    const before = await fs.readFile(source);
    const output = path.join(f.directory, `output.${format === 'original' ? 'png' : format}`);
    await convertImage(source, output, { format, quality: 40, resolution: '720' });
    assert.deepEqual(await imageInfo(output), format === 'original' ? { width: 1920, height: 1080 } : { width: 1280, height: 720 });
    assert.deepEqual(await fs.readFile(source), before);
  });
}

test('HDR resize stays 10-bit PQ/BT2020, embeds resized output, and rolls back both originals', async (t) => {
  const f = await fixture(t);
  for (const ext of ['jxr', 'png']) await fs.copyFile(path.join(root, `tests/fixtures/hdr-1080.${ext}`), path.join(f.source, `capture.${ext}`));
  const job = new ImportJob(f.config, { items: [f.item], conversion: { format: 'webp' } }); await job.run();
  assert.equal(job.status, 'done', JSON.stringify(job.results));
  const output = path.join(f.config.vaultRoot, job.log.generatedFiles[0]);
  assert.deepEqual(await imageInfo(output), { width: 1280, height: 720 });
  const data = await fs.readFile(output), nclx = data.indexOf(Buffer.from('nclx')) + 4;
  assert.deepEqual([data.readUInt16BE(nclx), data.readUInt16BE(nclx + 2), data.readUInt16BE(nclx + 4)], [9, 16, 9]);
  const { stderr } = await runCommand(path.join(bin, 'ffmpeg'), ['-hide_banner', '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-y', path.join(f.directory, 'decoded.yuv')]);
  assert.match(stderr, /yuv444p10le/);
  assert.equal(job.log.items[0].conversion.resolution, '720');
  assert.equal((await rollbackRun(f.config, job.id)).status, 'done');
  assert.deepEqual((await fs.readdir(f.source)).sort(), ['capture.jxr', 'capture.png']);
});

test('EXIF-rotated photos resize in display orientation without stretching the raw pixel matrix', async (t) => {
  const f = await fixture(t);
  const source = path.join(f.source, 'rotated.jpg');
  await convertImage(path.join(root, 'tests/fixtures/hdr-1080.png'), source, { format: 'jpg', quality: 95, resolution: 'original' });
  const jpeg = await fs.readFile(source);
  const tiff = Buffer.alloc(26); tiff.write('II'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8); tiff.writeUInt16LE(0x112, 10); tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14); tiff.writeUInt16LE(6, 18);
  const exif = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
  const marker = Buffer.from([0xff, 0xe1, 0, 0]); marker.writeUInt16BE(exif.length + 2, 2);
  await fs.writeFile(source, Buffer.concat([jpeg.subarray(0, 2), marker, exif, jpeg.subarray(2)]));
  assert.deepEqual(await imageInfo(source), { width: 1080, height: 1920, orientation: 6 });
  const output = path.join(f.directory, 'rotated.webp');
  await convertImage(source, output, { format: 'webp', quality: 90, resolution: '720' });
  assert.deepEqual(await imageInfo(output), { width: 720, height: 1280 });
  const rawPath = path.join(f.directory, 'pixels.raw');
  await runCommand(path.join(bin, 'ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', '-i', output, '-pix_fmt', 'rgb24', '-f', 'rawvideo', rawPath]);
  const raw = await fs.readFile(rawPath);
  assert.ok(raw[0] < 30);
  assert.ok(raw[(1280 - 1) * 720 * 3] > 200, 'Horizontal source gradient must rotate to a vertical gradient');
});

test('estimate API returns per-image predictions, preview dimensions, and reuses completed preview samples', async (t) => {
  const f = await fixture(t); await fs.copyFile(path.join(root, 'tests/fixtures/hdr-1080.png'), path.join(f.source, 'capture.png'));
  const server = createAppServer(f.config);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (route, body) => { const response = await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data; };
  const conversion = { format: 'webp', quality: 40, resolution: '720' };
  const preview = await post('/api/preview-conversion', { folder: 'Show', file: 'capture.png', conversion });
  assert.deepEqual(preview.outputDimensions, { width: 1280, height: 720 });
  const estimate = await post('/api/estimate-folder', { folder: 'Show', conversion });
  assert.equal(estimate.encodedSamples, 0);
  assert.equal(estimate.estimatedBytes, preview.outputBytes);
  assert.equal(estimate.files[0].exact, true);
  const crossOrigin = await fetch(base + '/api/estimate-folder', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.com' }, body: '{}' });
  assert.equal(crossOrigin.status, 403);
});
