import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveParallelImages, prepareImages } from '../src/conversionBatch.mjs';
import { ImportJob } from '../src/runner.mjs';
import { rollbackRun } from '../src/rollback.mjs';
import { resolveConfig } from '../src/config.mjs';
import { loadAppSettings, saveAppSettings } from '../src/appSettings.mjs';
import { APP_VERSION } from '../src/version.mjs';
import { pathExists, commandVersion, runCommand, fileHash } from '../src/utils.mjs';

const settings = { format: 'webp', quality: 90, effort: 6, conflictPolicy: 'increment' };

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iina-performance-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = resolveConfig({ screenshotsRoot: path.join(root, 'Screenshots'), vaultRoot: path.join(root, 'Vault'), mediaRoot: path.join(root, 'Vault/Media'), dataDir: path.join(root, 'data') });
  const source = path.join(config.screenshotsRoot, 'Show');
  const note = path.join(config.mediaRoot, 'Series/Show.md');
  const output = path.join(config.vaultRoot, 'All Notes/Attachments/Show');
  for (const directory of [source, path.dirname(note), output]) await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(note, '# Show\n\nKeep my personal notes.\n');
  return { root, config, source, note, output, item: { sourceFolderName: 'Show', notePath: 'Media/Series/Show.md', mode: 'episode', season: 1, episode: 1 } };
}

async function requireEncoders(t) {
  if (await commandVersion('cwebp', ['-version']) && await commandVersion('ffmpeg', ['-version'])) return true;
  t.skip('Image tests require cwebp and ffmpeg');
  return false;
}

async function sourceImages(f) {
  const image = path.join(f.source, 'a.png');
  await runCommand('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=128x72:rate=1', '-frames:v', '1', image]);
  for (const name of ['a.jpg', 'b.png', 'c.png']) await fs.copyFile(image, path.join(f.source, name));
  return ['a.jpg', 'a.png', 'b.png', 'c.png'];
}

test('worker limits adapt conservatively and never exceed four', () => {
  assert.equal(resolveParallelImages(0, 8, 8 * 1024 ** 3), 2);
  assert.equal(resolveParallelImages(0, 14, 48 * 1024 ** 3), 4);
  assert.equal(resolveParallelImages(0, 4, 4 * 1024 ** 3), 1);
  assert.equal(resolveParallelImages(1, 14, 48 * 1024 ** 3), 1);
  assert.equal(resolveParallelImages(999, 14, 48 * 1024 ** 3), 4);
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
});

test('parallel preference persists and old category-only saves retain it', async (t) => {
  const f = await fixture(t);
  assert.equal((await loadAppSettings(f.config)).parallelImages, 0);
  await saveAppSettings(f.config, { parallelImages: 2 });
  await saveAppSettings(f.config, { qualityDefaults: { Anime: 55 } });
  const saved = await loadAppSettings(f.config);
  assert.equal(saved.parallelImages, 2);
  assert.equal(saved.qualityDefaults.Anime, 55);
});

for (const policy of ['increment', 'overwrite', 'reuse', 'skip']) {
  test(`parallel ${policy} matches sequential bytes/order and remains rollbackable`, async (t) => {
    if (!await requireEncoders(t)) return;
    let reference;
    for (const parallelImages of [1, 4]) {
      const f = await fixture(t);
      const images = await sourceImages(f);
      const existing = path.join(f.output, 'a.webp');
      await fs.writeFile(existing, 'existing attachment');
      const job = new ImportJob(f.config, { items: [f.item], conversion: { ...settings, conflictPolicy: policy }, parallelImages });
      await job.run();
      assert.equal(job.status, 'done', JSON.stringify(job.results));
      const outputs = [];
      for (const name of await fs.readdir(f.output)) outputs.push([name, await fileHash(path.join(f.output, name))]);
      const note = await fs.readFile(f.note, 'utf8');
      const result = { outputs, links: note.match(/!\[\[[^\]]+\]\]/g), generated: job.log.generatedFiles };
      if (!reference) reference = result;
      else assert.deepEqual(result, reference);
      assert.equal((await rollbackRun(f.config, job.id)).status, 'done');
      assert.equal(await fs.readFile(existing, 'utf8'), 'existing attachment');
      assert.deepEqual((await fs.readdir(f.source)).sort(), images);
      assert.match(await fs.readFile(f.note, 'utf8'), /Keep my personal notes/);
      assert.deepEqual(await fs.readdir(f.output), ['a.webp']);
    }
  });
}

test('parallel encoder failure keeps originals and does not insert a partial note', async (t) => {
  if (!await requireEncoders(t)) return;
  const f = await fixture(t);
  await sourceImages(f);
  await fs.writeFile(path.join(f.source, 'b.png'), 'broken image');
  const before = await fs.readFile(f.note, 'utf8');
  const job = new ImportJob(f.config, { items: [f.item], conversion: settings, parallelImages: 4 });
  await job.run();
  assert.equal(job.status, 'error');
  assert.equal(await fs.readFile(f.note, 'utf8'), before);
  assert.equal((await fs.readdir(f.source)).length, 4);
  assert.equal(job.log.items[0].archivedTo, null);
  assert.equal((await rollbackRun(f.config, job.id)).status, 'done');
  assert.deepEqual(await fs.readdir(f.output), []);
});

test('early exit from a prepared batch drains workers and removes scratch images', async (t) => {
  if (!await requireEncoders(t)) return;
  const f = await fixture(t);
  const images = await sourceImages(f);
  let directory;
  for await (const prepared of prepareImages(f.source, images, f.output, settings, 4)) {
    directory = path.dirname(prepared.stagedPath);
    assert.equal((await fs.readdir(directory)).length, 4);
    break;
  }
  assert.equal(await pathExists(directory), false);
  assert.deepEqual(await fs.readdir(f.output), []);
});
