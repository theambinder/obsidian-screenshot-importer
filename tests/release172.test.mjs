import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { formatBytes } from '../public/formatBytes.js';
import { formatBytes as backendFormatBytes } from '../src/utils.mjs';
import { setNoteFoldersFormat, setNoteFoldersMode } from '../public/folderTable.js';
import { noteModeInfo } from '../public/mediaMode.js';
import { parseSourceName } from '../src/matcher.mjs';
import { scanMedia } from '../src/mediaIndex.mjs';
import { resolveConfig } from '../src/config.mjs';
import { createAppServer } from '../src/server.mjs';
import { saveAppSettings } from '../src/appSettings.mjs';
import { ImportJob } from '../src/runner.mjs';
import { rollbackRun } from '../src/rollback.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'importer-172-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = resolveConfig({ screenshotsRoot: path.join(root, 'Screenshots'), vaultRoot: path.join(root, 'Vault'), mediaRoot: path.join(root, 'Vault/Media'), dataDir: path.join(root, 'data') });
  await fs.mkdir(path.join(config.mediaRoot, 'Anime'), { recursive: true });
  await fs.mkdir(config.screenshotsRoot, { recursive: true });
  return { root, config };
}

test('frontend and backend display decimal Finder-compatible units without changing byte totals', () => {
  for (const [bytes, expected] of [[0, '0 B'], [999, '999 B'], [1000, '1.0 KB'], [1e6, '1.0 MB'], [1e9, '1.0 GB'], [3803933501, '3.8 GB']]) {
    assert.equal(formatBytes(bytes), expected);
    assert.equal(backendFormatBytes(bytes), expected);
  }
});

test('applying Format to a Note group is explicit, exact-path scoped, and preserves other row settings', () => {
  const rows = ['Anime/Show.md', 'Anime/Show.md', 'Games/Show.md', ''].map((selectedNotePath) => ({ selectedNotePath, formatOverride: 'png', quality: 40, duplicateMode: 'jxr' }));
  assert.equal(setNoteFoldersFormat(rows, rows[0], 'webp'), 2);
  assert.deepEqual(rows.map((row) => row.formatOverride), ['webp', 'webp', 'png', 'png']);
  assert.ok(rows.every((row) => row.quality === 40 && row.duplicateMode === 'jxr'));
  assert.equal(setNoteFoldersFormat(rows, rows[3], 'avif'), 0);
  assert.equal(setNoteFoldersFormat(rows, rows[0], 'invalid'), 0);
});

test('loose episodes before bracketed technical labels fill S1E23 and retain a clean matching title', () => {
  const parsed = parseSourceName('[Winter] Example Show 23 [BDrip 1280x720 x264 Vorbis].mkv');
  assert.equal(parsed.titleGuess, 'Example Show');
  assert.deepEqual([parsed.mode, parsed.season, parsed.episode], ['episode', 1, 23]);
  const row = { selectedNotePath: 'Anime/Show.md', mode: 'screenshots', parsed: { ...parsed, season: null, episode: null }, detectedEpisode: parsed };
  setNoteFoldersMode([row], row, 'episode');
  assert.deepEqual([row.parsed.season, row.parsed.episode], [1, 23]);
  for (const name of ['Movie 2025 [BDrip 1280x720].mkv', 'Movie [BDrip 1280x720 x264].mkv']) assert.equal(parseSourceName(name).episode, null);
});

test('note classification precedes filename detection while unclassified animation remains conservative', () => {
  const parsed = parseSourceName('Show S01E23.mkv');
  assert.equal(noteModeInfo({ mediaDir: 'Anime', modeHint: 'screenshots' }, parsed).mode, 'screenshots');
  assert.equal(noteModeInfo({ mediaDir: 'Anime', modeHint: 'episode' }, {}).mode, 'episode');
  assert.equal(noteModeInfo({ mediaDir: 'Series' }, {}).mode, 'episode');
  assert.equal(noteModeInfo({ mediaDir: 'Games' }, parsed).mode, 'screenshots');
  assert.equal(noteModeInfo({ mediaDir: 'Anime' }, {}).mode, 'screenshots');
  assert.equal(noteModeInfo(null, parsed).mode, 'episode');
});

test('the Media index classifies series/work tags and type fields without exposing full frontmatter', async (t) => {
  const { config } = await fixture(t);
  for (const [name, metadata] of [
    ['Block Series', 'tags:\n  - media/anime/series'], ['Inline Series', 'tags: ["media/anime/series", "media/tags/visual"]'],
    ['Type Series', 'type: "TV Series"'], ['Animated Movie', 'tags:\n  - media/anime/movie'],
  ]) await fs.writeFile(path.join(config.mediaRoot, `Anime/${name}.md`), `---\n${metadata}\n---\n# ${name}\n`);
  const notes = await scanMedia(config);
  assert.equal(notes.length, 4);
  for (const note of notes) {
    assert.equal(note.modeHint, note.noteName === 'Animated Movie' ? 'screenshots' : 'episode');
    assert.equal(note.tags, undefined);
  }
});

test('scan uses note metadata and per-folder numbers, with saved manual mode taking priority', async (t) => {
  const { config } = await fixture(t);
  const notePath = 'Media/Anime/Crystal Show.md';
  await fs.writeFile(path.join(config.vaultRoot, notePath), '---\ntags:\n  - media/anime/series\n---\n# Crystal Show\n');
  const sourceName = '[Winter] Crystal Show 23 [BDrip 1280x720 x264 Vorbis].mkv';
  for (const name of [sourceName, 'Crystal Show bonus']) {
    const folder = path.join(config.screenshotsRoot, name);
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, 'shot.png'), 'fixture');
  }
  const server = createAppServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const scan = async () => (await (await fetch(`http://127.0.0.1:${server.address().port}/api/scan`)).json()).folders;
  const rows = await scan();
  const episode = rows.find((row) => row.name === sourceName);
  assert.deepEqual([episode.selectedNotePath, episode.mode, episode.parsed.season, episode.parsed.episode], [notePath, 'episode', 1, 23]);
  assert.match(episode.modeReason, /Note type/);
  assert.equal(rows.find((row) => row.name === 'Crystal Show bonus').parsed.episode, null);
  await saveAppSettings(config, { noteModes: { [notePath]: 'screenshots' } });
  assert.ok((await scan()).every((row) => row.mode === 'screenshots'));
  await saveAppSettings(config, { noteModes: { [notePath]: 'episode' } });
  const restored = (await scan()).find((row) => row.name === sourceName);
  assert.deepEqual([restored.parsed.season, restored.parsed.episode], [1, 23]);
});

test('Run results include a heading-specific Obsidian URI and stable run ID for report navigation', async (t) => {
  const { config } = await fixture(t);
  const notePath = 'Media/Anime/Show.md';
  const note = path.join(config.vaultRoot, notePath);
  await fs.writeFile(note, '# Show\n');
  const folder = path.join(config.screenshotsRoot, 'Show 23');
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, 'shot.png'), 'fixture');
  const job = new ImportJob(config, { items: [{ sourceFolderName: 'Show 23', notePath, mode: 'episode', season: 1, episode: 23 }], conversion: { format: 'original' } });
  await job.run();
  assert.equal(job.status, 'done', JSON.stringify(job.results));
  assert.equal(job.log.runId, job.id);
  assert.ok(job.results[0].noteUri.startsWith('obsidian://open?'));
  assert.ok(decodeURIComponent(job.results[0].noteUri).includes('#S1E23'));
  assert.equal((await rollbackRun(config, job.id)).status, 'done');
});
