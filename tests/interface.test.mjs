import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { nextFolderSort, sortFolders, setNoteFoldersEnabled, selectFolderRange } from '../public/folderTable.js';
import { normalizeTheme, resolveTheme } from '../public/theme.js';
import { loadAppSettings, saveAppSettings } from '../src/appSettings.mjs';
import { parseSeasonNumber, parseEpisodeNumber, hasEpisodeNumbers, findDuplicateEpisodes } from '../public/episodeSelection.js';

test('episode zero is valid but blank, missing, negative, fractional, and nonnumeric values are not', () => {
  for (const value of [0, '0', '00', ' 00 ']) assert.equal(parseEpisodeNumber(value), 0);
  assert.equal(parseEpisodeNumber('09'), 9);
  for (const value of ['', ' ', null, undefined, -1, 0.5, NaN, Infinity, '1e2', '0.0', 'abc', false, [], {}]) {
    assert.equal(parseEpisodeNumber(value), null, String(value));
  }
  assert.equal(parseSeasonNumber('03'), 3);
  assert.equal(parseSeasonNumber(0), null);
  assert.equal(hasEpisodeNumbers({ season: 3, episode: 0 }), true);
  assert.equal(hasEpisodeNumbers({ season: 3, episode: '' }), false);
});

test('duplicate episodes use exact note paths and normalized numbers, including E0 and E00', () => {
  const item = { mode: 'episode', notePath: 'Anime/Show.md', season: 3, episode: 0 };
  const duplicates = findDuplicateEpisodes([
    { ...item, sourceFolderName: 'A' },
    { ...item, sourceFolderName: 'B', season: '03', episode: '00' },
    { ...item, sourceFolderName: 'Other note', notePath: 'Series/Show.md' },
    { ...item, sourceFolderName: 'Other season', season: 2 },
    { ...item, sourceFolderName: 'Other episode', episode: 1 },
    { ...item, sourceFolderName: 'Unselected', enabled: false },
    { ...item, sourceFolderName: 'Work', mode: 'screenshots' },
    { ...item, sourceFolderName: 'Blank', episode: '' },
    { ...item, sourceFolderName: 'Missing note', notePath: '' },
  ]);
  assert.deepEqual(duplicates, [{ notePath: item.notePath, season: 3, episode: 0, sourceFolderNames: ['A', 'B'] }]);
  assert.deepEqual(findDuplicateEpisodes([{ ...item, sourceFolderName: 'Only one' }]), []);
});

test('duplicate detection lists every repeated episode group', () => {
  const items = [0, 1, 0, 1, 2].map((episode, i) => ({
    sourceFolderName: String(i), notePath: 'Anime/Show.md', mode: 'episode', season: 3, episode,
  }));
  assert.deepEqual(findDuplicateEpisodes(items).map((group) => [group.episode, group.sourceFolderNames]), [[0, ['0', '2']], [1, ['1', '3']]]);
});

const notes = [
  { path: 'Series/Show.md', noteName: 'Show' },
  { path: 'Games/Show.md', noteName: 'Show' },
  { path: 'Movies/Arrival.md', noteName: 'Arrival' },
];
function folders() {
  return [
    { name: 'Show - 10', selectedNotePath: notes[0].path, mode: 'episode', parsed: { season: 2, episode: 10 } },
    { name: 'Show - 2', selectedNotePath: notes[0].path, mode: 'episode', parsed: { season: '01', episode: '02' } },
    { name: 'Unknown', selectedNotePath: '', mode: 'episode', parsed: { season: null, episode: null } },
    { name: 'Show game', selectedNotePath: notes[1].path, mode: 'screenshots', parsed: { season: 9, episode: 99 } },
    { name: 'Arrival', selectedNotePath: notes[2].path, mode: 'screenshots', parsed: {} },
    { name: 'Another unknown', selectedNotePath: '', mode: 'screenshots', parsed: {} },
  ].map((folder) => ({ ...folder, enabled: false }));
}

test('group selection uses the exact note path, preserves unrelated selections, and is idempotent', () => {
  const rows = folders();
  rows[4].enabled = true;
  setNoteFoldersEnabled(rows, rows[0], true);
  setNoteFoldersEnabled(rows, rows[0], true);
  assert.deepEqual(rows.map((row) => row.enabled), [true, true, false, false, true, false]);
  setNoteFoldersEnabled(rows, rows[2], true);
  assert.deepEqual(rows.map((row) => row.enabled), [true, true, false, false, true, false]);
});

test('clearing a note group preserves other categories and unrelated selected folders', () => {
  const rows = folders();
  rows[3].enabled = true;
  rows[4].enabled = true;
  setNoteFoldersEnabled(rows, rows[0], true);
  setNoteFoldersEnabled(rows, rows[1], false);
  assert.deepEqual(rows.map((row) => row.enabled), [false, false, false, true, true, false]);
  setNoteFoldersEnabled(rows, rows[2], false);
  assert.deepEqual(rows.map((row) => row.enabled), [false, false, false, true, true, false]);
});

test('partially selected groups follow the clicked row state before the two clicks', () => {
  const rows = folders();
  for (const initial of [true, false]) {
    rows[0].enabled = initial;
    rows[1].enabled = !initial;
    const groupEnabled = !rows[0].enabled;
    selectFolderRange(rows, 0, null, !rows[0].enabled);
    selectFolderRange(rows, 0, null, !rows[0].enabled);
    setNoteFoldersEnabled(rows, rows[0], groupEnabled);
    assert.deepEqual(rows.slice(0, 2).map((row) => row.enabled), [!initial, !initial]);
  }
});

test('sort controls cycle ascending, descending, reset; changing columns starts ascending', () => {
  const asc = nextFolderSort(null, 'source');
  const desc = nextFolderSort(asc, 'source');
  assert.deepEqual(asc, { key: 'source', direction: 'asc' });
  assert.deepEqual(desc, { key: 'source', direction: 'desc' });
  assert.equal(nextFolderSort(desc, 'source'), null);
  assert.deepEqual(nextFolderSort(desc, 'note'), { key: 'note', direction: 'asc' });
  assert.equal(nextFolderSort(desc, 'unknown'), null);
});

test('source sorting is natural and resetting restores the unmodified scan order', () => {
  const rows = folders();
  const original = [...rows];
  const sorted = sortFolders(rows, { key: 'source', direction: 'asc' }, notes);
  assert.ok(sorted.indexOf(rows[1]) < sorted.indexOf(rows[0]));
  assert.deepEqual(rows, original);
  assert.deepEqual(sortFolders(rows, null), original);
  assert.equal(sorted.find((row) => row.name === rows[0].name), rows[0]);
});

test('note sorting uses titles and leaves unmatched folders last in both directions', () => {
  const rows = folders();
  for (const direction of ['asc', 'desc']) {
    const sorted = sortFolders(rows, { key: 'note', direction }, notes);
    assert.deepEqual(sorted.slice(-2), [rows[2], rows[5]]);
    assert.equal(sorted[direction === 'asc' ? 0 : 3], rows[4]);
  }
});

test('season and episode sort numerically, ignoring stale numbers on Work rows', () => {
  const rows = folders();
  for (const key of ['season', 'episode']) {
    const asc = sortFolders(rows, { key, direction: 'asc' });
    const desc = sortFolders(rows, { key, direction: 'desc' });
    assert.deepEqual(asc, [rows[1], rows[0], ...rows.slice(2)]);
    assert.deepEqual(desc, rows);
  }
});

test('episode sorting places E0 before E1, distinguishing it from empty and Work values', () => {
  const rows = [1, null, 0, '00', '', 9].map((episode, i) => ({
    name: String(i), mode: i === 5 ? 'screenshots' : 'episode', parsed: { episode },
  }));
  assert.deepEqual(sortFolders(rows, { key: 'episode', direction: 'asc' }).map((row) => row.name), ['2', '3', '0', '1', '4', '5']);
  assert.deepEqual(sortFolders(rows, { key: 'episode', direction: 'desc' }).map((row) => row.name), ['0', '2', '3', '1', '4', '5']);
});

test('Shift selection follows visible sorted order in either direction, without changing unrelated rows', () => {
  const rows = folders();
  const visible = sortFolders(rows, { key: 'source', direction: 'asc' });
  selectFolderRange(visible, 1, null, true);
  selectFolderRange(visible, 4, 1, true);
  assert.deepEqual(visible.map((row) => row.enabled), [false, true, true, true, true, false]);
  selectFolderRange(visible, 2, 4, false);
  assert.deepEqual(visible.map((row) => row.enabled), [false, true, false, false, false, false]);
  assert.equal(rows.filter((row) => row.enabled).length, 1);
});

test('System follows OS appearance and manual choices ignore system changes', () => {
  assert.equal(normalizeTheme('invalid'), 'system');
  assert.equal(resolveTheme(undefined, true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
});

test('theme defaults to System, persists, validates, and survives other settings saves', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iina-theme-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = { mediaDirs: ['Anime', 'Series'], settingsPath: path.join(root, 'settings.json') };
  assert.equal((await loadAppSettings(config)).theme, 'system');
  await saveAppSettings(config, { theme: 'dark' });
  await saveAppSettings(config, { qualityDefaults: { Anime: 62 }, parallelImages: 2 });
  assert.equal((await loadAppSettings(config)).theme, 'dark');
  const light = await saveAppSettings(config, { theme: 'light' });
  assert.equal(light.qualityDefaults.Anime, 62);
  assert.equal(light.parallelImages, 2);
  assert.equal(light.theme, 'light');
  assert.equal((await saveAppSettings(config, { theme: 'invalid' })).theme, 'system');
});
