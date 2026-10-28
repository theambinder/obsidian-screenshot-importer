import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { duplicatePairs, selectImageNames, outputImageName, qualityToCrf } from '../public/imageSelection.js';
import { convertImage, conversionForImage, renderJxrReference, withConversionSource } from '../src/converter.mjs';
import { resolveConfig } from '../src/config.mjs';
import { ImportJob } from '../src/runner.mjs';
import { rollbackRun } from '../src/rollback.mjs';
import { trashRunArchive } from '../src/archive.mjs';
import { loadAppSettings, saveAppSettings } from '../src/appSettings.mjs';
import { scanScreenshotFolders } from '../src/screenshotScanner.mjs';
import { createAppServer } from '../src/server.mjs';
import { runCommand, fileHash, pathExists } from '../src/utils.mjs';
import { APP_VERSION } from '../src/version.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resources = path.join(root, 'dist/Obsidian Screenshot Importer.app/Contents/Resources');
const bundledFfmpeg = path.join(resources, 'bin/ffmpeg');
const buildFfmpeg = path.join(root, 'build/vendor/ffmpeg-7.1.5/ffmpeg');
const ffmpeg = await pathExists(bundledFfmpeg) && await fs.readFile(path.join(resources, 'app/package.json'), 'utf8').then((text) => JSON.parse(text).version) === APP_VERSION
  ? bundledFfmpeg : buildFfmpeg;
process.env.PATH = `${path.dirname(ffmpeg)}:${path.join(root, 'build/vendor/libwebp-1.6.0-mac-arm64/bin')}:/usr/bin:/bin:/usr/sbin:/sbin`;

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-hdr-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const config = resolveConfig({ screenshotsRoot: path.join(directory, 'Screenshots'), vaultRoot: path.join(directory, 'Vault'), mediaRoot: path.join(directory, 'Vault/Media'), dataDir: path.join(directory, 'data') });
  const source = path.join(config.screenshotsRoot, 'HDR Game');
  const note = path.join(config.mediaRoot, 'Games/HDR Game.md');
  await fs.mkdir(source, { recursive: true });
  await fs.mkdir(path.dirname(note), { recursive: true });
  await fs.writeFile(note, '# HDR Game\n\nOriginal thoughts.\n');
  for (const extension of ['jxr', 'png']) await fs.copyFile(path.join(root, `tests/fixtures/hdr-scrgb.${extension}`), path.join(source, `capture.${extension}`));
  const item = { sourceFolderName: 'HDR Game', notePath: 'Media/Games/HDR Game.md', mode: 'screenshots', quality: 40 };
  return { directory, config, source, note, item };
}

function nclx(data) {
  const offset = data.indexOf(Buffer.from('nclx')) + 4;
  assert.ok(offset > 3, 'AVIF contains nclx color information');
  return [data.readUInt16BE(offset), data.readUInt16BE(offset + 2), data.readUInt16BE(offset + 4), data[offset + 6] >>> 7];
}

test('AVIF quality maps monotonically across the complete CRF range with Q40 = CRF16', () => {
  assert.equal(qualityToCrf(1), 63);
  assert.equal(qualityToCrf(40), 16);
  assert.equal(qualityToCrf(100), 0);
  for (let q = 2; q <= 100; q++) assert.ok(qualityToCrf(q) <= qualityToCrf(q - 1));
  assert.deepEqual(conversionForImage('capture.jxr', { format: 'original', quality: 40 }), { format: 'avif', quality: 40, crf: 16, effort: 6, conflictPolicy: 'increment', hdr: true });
});

test('pair policy filters only actual same-name counterparts, keeping unrelated and unpaired images', () => {
  const names = ['A.JXR', 'a.png', 'b.PNG', 'c.jxr', 'A.jpg', 'other.tiff'];
  assert.equal(duplicatePairs(names).length, 1);
  assert.deepEqual(selectImageNames(names), ['A.JXR', 'b.PNG', 'c.jxr', 'A.jpg', 'other.tiff']);
  assert.deepEqual(selectImageNames(names, 'png'), ['a.png', 'b.PNG', 'c.jxr', 'A.jpg', 'other.tiff']);
  assert.deepEqual(selectImageNames(names, 'both'), names);
  assert.equal(outputImageName('a.png', 'avif', names), 'a.sdr.avif');
  assert.equal(outputImageName('A.JXR', 'avif', names), 'A.avif');
  assert.equal(outputImageName('a.png', 'webp', names), 'a.webp');
});

test('pair default persists without resetting existing category or path preferences', async (t) => {
  const f = await fixture(t);
  assert.equal((await loadAppSettings(f.config)).duplicateMode, 'jxr');
  await saveAppSettings(f.config, { duplicateMode: 'both', qualityDefaults: { Games: 40 } });
  await saveAppSettings(f.config, { theme: 'dark' });
  const saved = await loadAppSettings(f.config);
  assert.equal(saved.duplicateMode, 'both');
  assert.equal(saved.qualityDefaults.Games, 40);
  const [folder] = await scanScreenshotFolders(f.config);
  assert.equal(folder.imageCount, 2);
});

test('native JXR decoding preserves linear values above SDR white and cleans scratch files', async () => {
  let scratch;
  await withConversionSource(path.join(root, 'tests/fixtures/hdr-scrgb.jxr'), async (decoded) => {
    scratch = decoded.rawPath;
    assert.equal(decoded.width, 64);
    assert.equal(decoded.height, 48);
    const raw = await fs.readFile(scratch);
    assert.equal(raw.length, 64 * 48 * 12);
    assert.equal(raw.readFloatLE(0), 0.25);
    assert.equal(raw.readFloatLE(63 * 4), 12.5);
  });
  assert.equal(await pathExists(scratch), false);
});

test('HDR AVIF has real AV1 bytes, PQ/BT2020 tags, and unclipped highlights; reference PNG has cICP', async (t) => {
  const f = await fixture(t);
  const output = path.join(f.directory, 'hdr.avif');
  await convertImage(path.join(f.source, 'capture.jxr'), output, { format: 'webp', quality: 40 });
  const data = await fs.readFile(output);
  assert.equal(data.toString('ascii', 4, 12), 'ftypavif');
  assert.deepEqual(nclx(data), [9, 16, 9, 1]);
  const raw = path.join(f.directory, 'decoded.raw');
  await runCommand(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', output,
    '-vf', 'zscale=pin=bt2020:tin=smpte2084:min=bt2020nc:rin=full:p=bt709:t=linear:m=gbr:r=full:npl=80,format=gbrpf32le',
    '-f', 'rawvideo', raw]);
  const linear = await fs.readFile(raw);
  let peak = 0;
  for (let offset = 0; offset < linear.length; offset += 4) peak = Math.max(peak, linear.readFloatLE(offset));
  assert.ok(peak > 12 && peak < 13, `Expected 1000-nit highlights, not clipped SDR: ${peak * 80} nits`);
  for (const thumbnail of [false, true]) {
    const reference = path.join(f.directory, `reference-${thumbnail}.png`);
    await renderJxrReference(path.join(f.source, 'capture.jxr'), reference, { thumbnail });
    const png = await fs.readFile(reference);
    const cicp = png.indexOf(Buffer.from('cICP'));
    assert.ok(cicp > 0);
    assert.deepEqual([...png.subarray(cicp + 4, cicp + 8)], [9, 16, 0, 1]);
    assert.equal(png[24], 16, 'Reference keeps 16-bit precision');
  }
});

for (const policy of ['jxr', 'png', 'both']) {
  test(`${policy} imports only selected images but archives and rolls back both originals`, async (t) => {
    const f = await fixture(t);
    const before = await fs.readFile(f.note, 'utf8');
    const hashes = await Promise.all(['jxr', 'png'].map((ext) => fileHash(path.join(f.source, `capture.${ext}`))));
    const job = new ImportJob(f.config, { items: [{ ...f.item, duplicateMode: policy }], parallelImages: 2, conversion: { format: 'avif', quality: 40 } });
    await job.run();
    assert.equal(job.status, 'done', JSON.stringify(job.results));
    assert.equal(job.totalFiles, policy === 'both' ? 2 : 1);
    assert.equal(job.doneFiles, job.totalFiles);
    const log = job.log.items[0];
    assert.equal(log.sourceFileCount, 2);
    assert.equal(log.processedFileCount, job.totalFiles);
    assert.equal(log.outputFileCount, job.totalFiles);
    assert.deepEqual((await fs.readdir(log.archivedTo)).sort(), ['capture.jxr', 'capture.png']);
    if (policy === 'both') assert.deepEqual(log.generatedFiles.map((name) => path.basename(name)).sort(), ['capture.avif', 'capture.sdr.avif']);
    assert.equal((await rollbackRun(f.config, job.id)).status, 'done');
    const restored = await fs.readFile(f.note, 'utf8');
    assert.ok(restored.startsWith(before));
    assert.doesNotMatch(restored, /!\[\[/);
    assert.deepEqual(await Promise.all(['jxr', 'png'].map((ext) => fileHash(path.join(f.source, `capture.${ext}`)))), hashes);
  });
}

test('Trash includes unconverted PNG counterparts, without touching imported AVIF or notes', async (t) => {
  const f = await fixture(t);
  // Redirect Trash for this fixture only; no access to the real macOS Trash.
  t.mock.method(os, 'homedir', () => f.directory);
  const job = new ImportJob(f.config, { items: [f.item], conversion: { format: 'webp', quality: 40 } });
  await job.run();
  assert.equal(job.status, 'done', JSON.stringify(job.results));
  const note = await fs.readFile(f.note, 'utf8');
  const trash = await trashRunArchive(f.config, job.id);
  assert.equal(trash.fileCount, 2);
  assert.deepEqual((await fs.readdir(path.join(trash.trashPaths[0], f.item.sourceFolderName))).sort(), ['capture.jxr', 'capture.png']);
  assert.equal(await fs.readFile(f.note, 'utf8'), note);
  assert.equal(await pathExists(path.join(f.config.vaultRoot, job.log.generatedFiles[0])), true);
});

test('invalid JXR preserves both originals and existing note/output on encoding failure', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.source, 'capture.jxr'), 'invalid jxr');
  const before = await fs.readFile(f.note, 'utf8');
  const job = new ImportJob(f.config, { items: [f.item], conversion: { format: 'webp', quality: 40 } });
  await job.run();
  assert.equal(job.status, 'error');
  assert.equal(await fs.readFile(f.note, 'utf8'), before);
  assert.deepEqual((await fs.readdir(f.source)).sort(), ['capture.jxr', 'capture.png']);
  assert.equal(job.log.items[0].archivedTo, null);
});

for (const conflictPolicy of ['reuse', 'skip', 'overwrite']) {
  test(`Both keeps HDR and SDR outputs distinct under ${conflictPolicy}`, async (t) => {
    const f = await fixture(t);
    const output = path.join(f.config.vaultRoot, 'All Notes/Attachments/HDR Game');
    await fs.mkdir(output, { recursive: true });
    const existing = path.join(output, 'capture.avif');
    await fs.writeFile(existing, 'existing attachment');
    const job = new ImportJob(f.config, { items: [{ ...f.item, duplicateMode: 'both' }], parallelImages: 2, conversion: { format: 'avif', quality: 40, conflictPolicy } });
    await job.run();
    assert.equal(job.status, 'done', JSON.stringify(job.results));
    assert.deepEqual((await fs.readdir(output)).sort(), ['capture.avif', 'capture.sdr.avif']);
    const sdr = await fs.readFile(path.join(output, 'capture.sdr.avif'));
    assert.deepEqual(nclx(sdr), [1, 13, 1, 1]);
    assert.equal((await rollbackRun(f.config, job.id)).status, 'done');
    assert.equal(await fs.readFile(existing, 'utf8'), 'existing attachment');
  });
}

test('HDR source/thumbnail links render PNG references; preview links serve real AVIF with CRF', async (t) => {
  const f = await fixture(t);
  const server = createAppServer(f.config);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (route, body) => {
    const response = await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data;
  };
  const listing = await post('/api/source-files', { folder: f.item.sourceFolderName });
  const jxr = listing.files.find((file) => file.hdr);
  for (const url of [jxr.url, jxr.thumbnailUrl, jxr.url]) {
    const response = await fetch(base + url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    const data = Buffer.from(await response.arrayBuffer());
    assert.equal(data.toString('ascii', 1, 4), 'PNG');
  }
  const preview = await post('/api/preview-conversion', { folder: f.item.sourceFolderName, file: jxr.name, conversion: { format: 'webp', quality: 40 } });
  assert.equal(preview.conversion.crf, 16);
  assert.equal(preview.conversion.hdr, true);
  const image = await fetch(base + preview.url);
  assert.equal(image.headers.get('content-type'), 'image/avif');
  assert.equal((await image.arrayBuffer()).byteLength, preview.outputBytes);
  const suggestion = await post('/api/preview-quality-suggestion', { folder: f.item.sourceFolderName, file: jxr.name, conversion: { quality: 40 } });
  assert.ok(suggestion.candidates.some((candidate) => candidate.quality === 40 && candidate.crf === 16));
});
