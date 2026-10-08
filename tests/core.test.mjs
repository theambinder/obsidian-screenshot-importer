import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseSourceName, suggestNotes } from '../src/matcher.mjs';
import { insertScreenshotLinks, removeScreenshotBlock } from '../src/markdown.mjs';
import { listRuns, rollbackRun } from '../src/rollback.mjs';
import { loadAppSettings, saveAppSettings } from '../src/appSettings.mjs';

test('parses common episode filename formats', () => {
  const cases = [
    ['Spider.Noir.2026.S01E03.Double.Cross._BW_.mkv', 'Spider Noir', 1, 3],
    ['[ReinForce] Dan Da Dan (S02) (2025) - 08 [BDRip 1080p x264 FLAC].mkv', 'Dan Da Dan', 2, 8],
    ['GTO - 05 [DVDRip 960x720 x264 AC3].mkv', 'GTO', 1, 5],
    ['Serial_Experiments_Lain_02_BDRip_hi10p_1080p.mkv', 'Serial Experiments Lain', 1, 2],
    ['One Punch Man S2 - 10 [Soer & MezIdA] [720p WEBRip].mkv', 'One Punch Man', 2, 10],
    ['[DeadLine] One-Punch Man TV3 - 09 [Soer] [1080p].mkv', 'One-Punch Man', 3, 9],
    ['Kaijuu 8 Gou TV-2 - 11 [1080p CR WEB-DL AVC AAC].mkv', 'Kaijuu 8 Gou', 2, 11],
    ['One-Punch.Man.S03E00.mkv', 'One-Punch Man', 3, 0],
    ['[DeadLine] One-Punch Man TV3 - 00 [1080p].mkv', 'One-Punch Man', 3, 0],
    ['One-Punch Man (S03) - 00 [BDRip 1080p].mkv', 'One-Punch Man', 3, 0],
    ['Show_00_BDRip.mkv', 'Show', 1, 0],
  ];

  for (const [input, title, season, episode] of cases) {
    const parsed = parseSourceName(input);
    assert.equal(parsed.titleGuess, title, input);
    assert.equal(parsed.season, season, input);
    assert.equal(parsed.episode, episode, input);
    assert.equal(parsed.mode, 'episode', input);
  }
});

test('does not treat movie year as episode', () => {
  const parsed = parseSourceName('Good.Luck.Have.Fun.Dont.Die.2025.2160p.WEB-DL.DV.HDR.H.265.mkv');
  assert.equal(parsed.mode, 'screenshots');
  assert.equal(parsed.season, null);
  assert.equal(parsed.episode, null);
  assert.equal(parsed.titleGuess, 'Good Luck Have Fun Dont Die');
});

test('suggests notes by token overlap', () => {
  const notes = [
    note('Anime/Frieren. Beyond Journey\'s End (2024).md', 'Frieren. Beyond Journey\'s End (2024)', 'Anime', ['Провожающая в последний путь Фрирен']),
    note('Anime/Delicious in Dungeon (2024).md', 'Delicious in Dungeon (2024)', 'Anime', ['Подземелье вкусностей']),
  ];
  const parsed = parseSourceName('Sousou no Frieren 09.mkv');
  const result = suggestNotes(parsed, notes, { rules: [] });
  assert.equal(result.selected.path, 'Anime/Frieren. Beyond Journey\'s End (2024).md');
});

test('inserts episode links before the next sibling heading', () => {
  const original = [
    '---',
    'tags:',
    '  - media/anime',
    '---',
    '### Season 1',
    '#### S1E1',
    'Мой текст.',
    '#### S1E2',
    'Следующая серия.',
  ].join('\n');

  const result = insertScreenshotLinks(original, {
    mode: 'episode',
    season: 1,
    episode: 1,
    sourceFolderName: 'GTO - 01.mkv',
  }, ['![[All Notes/Attachments/GTO/file.webp]]'], {
    runId: 'test-run',
  });

  assert.match(result.content, /Мой текст\.\n\n<!-- iina-screenshot-importer:start run=test-run source="GTO - 01\.mkv" -->/);
  assert.match(result.content, /!\[\[All Notes\/Attachments\/GTO\/file.webp\]\]\n<!-- iina-screenshot-importer:end run=test-run -->\n\n#### S1E2/);
});

test('creates missing episode heading inside existing season', () => {
  const original = [
    '### Season 2',
    '#### S2E1',
    'Text',
    '### Notes',
    'Other',
  ].join('\n');

  const result = insertScreenshotLinks(original, {
    mode: 'episode',
    season: 2,
    episode: 6,
    sourceFolderName: 'Show.S02E06.mkv',
  }, ['![[img.webp]]'], { runId: 'run' });

  assert.match(result.content, /#### S2E6\n<!-- iina-screenshot-importer:start run=run source="Show\.S02E06\.mkv" -->/);
  assert.match(result.content, /<!-- iina-screenshot-importer:end run=run -->\n\n### Notes/);
});

test('uses episode heading that starts with SxEy and has a comment', () => {
  const original = [
    '### Season 2',
    '#### S2E10 Герой пошел гулять',
    'Existing note.',
    '#### S2E11',
    'Next.',
  ].join('\n');

  const result = insertScreenshotLinks(original, {
    mode: 'episode',
    season: 2,
    episode: 10,
    sourceFolderName: 'Show.S02E10.mkv',
  }, ['![[shot.webp]]'], { runId: 'comment-heading' });

  assert.match(result.content, /#### S2E10 Герой пошел гулять\nExisting note\.\n\n<!-- iina-screenshot-importer:start run=comment-heading source="Show\.S02E10\.mkv" -->/);
  assert.doesNotMatch(result.content, /\n#### S2E10\n/);
});

test('matches zero-padded episode headings', () => {
  const original = [
    '### Season 2',
    '#### S2E09 Zero padded',
    'Existing note.',
    '#### S2E10 Next',
  ].join('\n');

  const result = insertScreenshotLinks(original, {
    mode: 'episode',
    season: 2,
    episode: 9,
    sourceFolderName: 'Show.S02E09.mkv',
  }, ['![[shot.webp]]'], { runId: 'zero-pad' });

  assert.match(result.content, /#### S2E09 Zero padded\nExisting note\.\n\n<!-- iina-screenshot-importer:start run=zero-pad source="Show\.S02E09\.mkv" -->/);
  assert.doesNotMatch(result.content, /\n#### S2E9\n/);
});

test('creates missing episode in numeric order within season', () => {
  const original = [
    '### Season 2',
    '#### S2E8',
    'Eight.',
    '#### S2E10',
    'Ten.',
  ].join('\n');

  const result = insertScreenshotLinks(original, {
    mode: 'episode',
    season: 2,
    episode: 9,
    sourceFolderName: 'Show.S02E09.mkv',
  }, ['![[nine.webp]]'], { runId: 'ordered' });

  assert.match(result.content, /#### S2E8\nEight\.\n\n#### S2E9\n<!-- iina-screenshot-importer:start run=ordered source="Show\.S02E09\.mkv" -->/);
  assert.match(result.content, /<!-- iina-screenshot-importer:end run=ordered -->\n\n#### S2E10\nTen\./);
});

test('creates missing season using previous season heading level', () => {
  const original = [
    '## Season 1',
    '### S1E1',
    'One.',
  ].join('\n');

  const result = insertScreenshotLinks(original, {
    mode: 'episode',
    season: 2,
    episode: 1,
    sourceFolderName: 'Show.S02E01.mkv',
  }, ['![[s2e1.webp]]'], { runId: 'new-season' });

  assert.match(result.content, /\n## Season 2\n### S2E1\n<!-- iina-screenshot-importer:start run=new-season source="Show\.S02E01\.mkv" -->/);
});

test('inserts movie links into screenshots section without deleting text', () => {
  const original = [
    '# Movie',
    '### Мысли',
    'Text',
    '### Скриншоты',
    'Старый комментарий',
    '### Links',
  ].join('\n');

  const result = insertScreenshotLinks(original, {
    mode: 'screenshots',
    sourceFolderName: 'Movie.mkv',
  }, ['![[shot.webp]]'], { runId: 'movie-run' });

  assert.match(result.content, /Старый комментарий\n\n<!-- iina-screenshot-importer:start run=movie-run source="Movie\.mkv" -->/);
  assert.match(result.content, /!\[\[shot.webp\]\]\n<!-- iina-screenshot-importer:end run=movie-run -->\n\n### Links/);
});

test('removes only the marker block for a single source folder', () => {
  const content = [
    '#### S1E1',
    '<!-- iina-screenshot-importer:start run=run-1 source="A.mkv" -->',
    '![[a.webp]]',
    '<!-- iina-screenshot-importer:end run=run-1 -->',
    '',
    '<!-- iina-screenshot-importer:start run=run-1 source="B.mkv" -->',
    '![[b.webp]]',
    '<!-- iina-screenshot-importer:end run=run-1 -->',
  ].join('\n');

  const result = removeScreenshotBlock(content, 'run-1', 'A.mkv');
  assert.equal(result.removed, true);
  assert.doesNotMatch(result.content, /a\.webp/);
  assert.match(result.content, /b\.webp/);
});

test('reports trashed run and item statuses from the run log', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iina-history-'));
  const screenshotsRoot = path.join(root, 'Screenshots');
  const runsDir = path.join(root, 'data', 'runs');
  const runId = 'trash-run';
  const finishedAt = '2026-06-14T01:23:45.000Z';
  await fs.mkdir(runsDir, { recursive: true });
  await fs.writeFile(path.join(runsDir, `${runId}.json`), JSON.stringify({
    runId,
    startedAt: '2026-06-14T01:00:00.000Z',
    finishedAt: '2026-06-14T01:10:00.000Z',
    generatedFiles: ['All Notes/Attachments/Movie/shot.webp'],
    archivedFolders: [{
      sourceFolderName: 'Movie.mkv',
      originalPath: path.join(screenshotsRoot, 'Movie.mkv'),
      archivedPath: path.join(screenshotsRoot, '_archive', runId, 'Movie.mkv'),
    }],
    archiveTrash: {
      status: 'done',
      finishedAt,
      fileCount: 1,
      folderCount: 2,
      bytes: 1024,
    },
    items: [{
      sourceFolderName: 'Movie.mkv',
      notePath: 'Media/Movies/Movie.md',
      noteName: 'Movie',
      mode: 'screenshots',
      sourceFileCount: 1,
      sourceBytes: 2048,
      outputBytes: 1024,
      archivedTo: path.join(screenshotsRoot, '_archive', runId, 'Movie.mkv'),
      archiveTrash: {
        status: 'done',
        finishedAt,
        fileCount: 1,
        folderCount: 1,
        bytes: 1024,
      },
    }],
  }, null, 2));

  const result = await listRuns({
    screenshotsRoot,
    archiveDirName: '_archive',
    runsDir,
    vaultRoot: root,
  });

  assert.equal(result.runs[0].status, 'trash:done');
  assert.equal(result.runs[0].trashFinishedAt, finishedAt);
  assert.equal(result.runs[0].canRollback, false);
  assert.equal(result.runs[0].items[0].status, 'trash:done');
  assert.equal(result.runs[0].items[0].trashFinishedAt, finishedAt);
});

test('promotes run status when all items are rollbacked', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iina-runs-rollback-'));
  const screenshotsRoot = path.join(root, 'Screenshots');
  const runsDir = path.join(root, 'data', 'runs');
  const runId = 'rollback-items-run';
  const firstFinishedAt = '2026-06-14T02:00:00.000Z';
  const secondFinishedAt = '2026-06-14T02:05:00.000Z';
  await fs.mkdir(runsDir, { recursive: true });
  await fs.mkdir(path.join(screenshotsRoot, 'A.mkv'), { recursive: true });
  await fs.mkdir(path.join(screenshotsRoot, 'B.mkv'), { recursive: true });
  await fs.writeFile(path.join(runsDir, `${runId}.json`), JSON.stringify({
    runId,
    startedAt: '2026-06-14T01:00:00.000Z',
    finishedAt: '2026-06-14T01:10:00.000Z',
    generatedFiles: ['All Notes/Attachments/Show/a.webp', 'All Notes/Attachments/Show/b.webp'],
    archivedFolders: [
      {
        sourceFolderName: 'A.mkv',
        originalPath: path.join(screenshotsRoot, 'A.mkv'),
        archivedPath: path.join(screenshotsRoot, '_archive', runId, 'A.mkv'),
      },
      {
        sourceFolderName: 'B.mkv',
        originalPath: path.join(screenshotsRoot, 'B.mkv'),
        archivedPath: path.join(screenshotsRoot, '_archive', runId, 'B.mkv'),
      },
    ],
    items: [
      {
        sourceFolderName: 'A.mkv',
        notePath: 'Media/Series/Show.md',
        noteName: 'Show',
        mode: 'episode',
        season: 1,
        episode: 1,
        sourceFileCount: 1,
        sourceBytes: 2048,
        outputBytes: 1024,
        archivedTo: path.join(screenshotsRoot, '_archive', runId, 'A.mkv'),
        rollback: {
          status: 'done',
          finishedAt: firstFinishedAt,
        },
      },
      {
        sourceFolderName: 'B.mkv',
        notePath: 'Media/Series/Show.md',
        noteName: 'Show',
        mode: 'episode',
        season: 1,
        episode: 2,
        sourceFileCount: 1,
        sourceBytes: 4096,
        outputBytes: 1024,
        archivedTo: path.join(screenshotsRoot, '_archive', runId, 'B.mkv'),
        rollback: {
          status: 'done',
          finishedAt: secondFinishedAt,
        },
      },
    ],
  }, null, 2));

  const result = await listRuns({
    screenshotsRoot,
    archiveDirName: '_archive',
    runsDir,
    vaultRoot: root,
  });

  assert.equal(result.runs[0].status, 'rollback:done');
  assert.equal(result.runs[0].rollbackFinishedAt, secondFinishedAt);
  assert.equal(result.runs[0].canRollback, false);
  assert.equal(result.runs[0].items[0].status, 'rollback:done');
  assert.equal(result.runs[0].items[1].status, 'rollback:done');
});

test('allows run rollback when only some items were already rollbacked', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iina-runs-mixed-rollback-'));
  const screenshotsRoot = path.join(root, 'Screenshots');
  const runsDir = path.join(root, 'data', 'runs');
  const backupsDir = path.join(root, 'data', 'backups');
  const runId = 'mixed-rollback-run';
  const noteRel = 'Media/Series/Show.md';
  const backupPath = path.join(backupsDir, runId, noteRel);
  const notePath = path.join(root, noteRel);
  const generatedRel = 'All Notes/Attachments/Show/b.webp';
  const generatedPath = path.join(root, generatedRel);
  const activeArchivePath = path.join(screenshotsRoot, '_archive', runId, 'B.mkv');
  const activeOriginalPath = path.join(screenshotsRoot, 'B.mkv');

  await fs.mkdir(runsDir, { recursive: true });
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await fs.mkdir(path.dirname(notePath), { recursive: true });
  await fs.mkdir(path.dirname(generatedPath), { recursive: true });
  await fs.mkdir(activeArchivePath, { recursive: true });
  await fs.writeFile(backupPath, 'Original note');
  await fs.writeFile(notePath, insertScreenshotLinks('Original note', {
    mode: 'episode', season: 1, episode: 2, sourceFolderName: 'B.mkv',
  }, [`![[${generatedRel}]]`], { runId }).content + '\nLater thoughts\n');
  await fs.writeFile(generatedPath, 'generated');
  await fs.writeFile(path.join(activeArchivePath, 'shot.png'), 'source');
  await fs.writeFile(path.join(runsDir, `${runId}.json`), JSON.stringify({
    runId,
    startedAt: '2026-06-14T01:00:00.000Z',
    finishedAt: '2026-06-14T01:10:00.000Z',
    notes: [{ path: noteRel, backupPath }],
    generatedFiles: [generatedRel],
    archivedFolders: [
      {
        sourceFolderName: 'A.mkv',
        originalPath: path.join(screenshotsRoot, 'A.mkv'),
        archivedPath: path.join(screenshotsRoot, '_archive', runId, 'A.mkv'),
      },
      {
        sourceFolderName: 'B.mkv',
        originalPath: activeOriginalPath,
        archivedPath: activeArchivePath,
      },
    ],
    items: [
      {
        sourceFolderName: 'A.mkv',
        notePath: noteRel,
        noteName: 'Show',
        mode: 'episode',
        season: 1,
        episode: 1,
        sourceFileCount: 1,
        sourceBytes: 2048,
        outputBytes: 1024,
        archivedTo: path.join(screenshotsRoot, '_archive', runId, 'A.mkv'),
        rollback: {
          status: 'done',
          finishedAt: '2026-06-14T02:00:00.000Z',
        },
      },
      {
        sourceFolderName: 'B.mkv',
        notePath: noteRel,
        noteName: 'Show',
        mode: 'episode',
        season: 1,
        episode: 2,
        sourceFileCount: 1,
        sourceBytes: 4096,
        outputBytes: 1024,
        generatedFiles: [generatedRel],
        archivedTo: activeArchivePath,
      },
    ],
  }, null, 2));

  const before = await listRuns({
    screenshotsRoot,
    archiveDirName: '_archive',
    runsDir,
    vaultRoot: root,
  });

  assert.equal(before.runs[0].status, 'done');
  assert.equal(before.runs[0].sourceMissingCount, 1);
  assert.equal(before.runs[0].canRollback, true);

  const rollback = await rollbackRun({
    screenshotsRoot,
    archiveDirName: '_archive',
    runsDir,
    vaultRoot: root,
    mediaRoot: path.join(root, 'Media'),
    mediaDirs: ['Series'],
    backupsDir,
    rulesPath: path.join(root, 'data', 'rules.json'),
  }, runId);

  assert.equal(rollback.status, 'done');
  assert.deepEqual(rollback.skippedFolders, ['A.mkv']);
  assert.deepEqual(rollback.returnedFolders, ['B.mkv']);
  const afterNote = await fs.readFile(notePath, 'utf8');
  assert.match(afterNote, /Original note/);
  assert.match(afterNote, /Later thoughts/);
  assert.doesNotMatch(afterNote, /b\.webp/);
  await assert.rejects(fs.stat(generatedPath), { code: 'ENOENT' });
  assert.equal((await fs.stat(activeOriginalPath)).isDirectory(), true);
});

test('loads configurable quality defaults by media category', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iina-settings-'));
  const config = {
    mediaDirs: ['Anime', 'Movies', 'Series', 'Games', 'Manga'],
    settingsPath: path.join(root, 'settings.json'),
  };

  const defaults = await loadAppSettings(config);
  assert.equal(defaults.qualityDefaults.Anime, 50);
  assert.equal(defaults.qualityDefaults.Movies, 90);
  assert.equal(defaults.qualityDefaults.Series, 90);
  assert.equal(defaults.qualityDefaults.Games, 90);
  assert.equal(defaults.qualityDefaults.Manga, 90);

  const saved = await saveAppSettings(config, {
    qualityDefaults: {
      Anime: 62,
      Movies: 88,
      Series: 101,
      Games: 0,
    },
  });
  assert.equal(saved.qualityDefaults.Anime, 62);
  assert.equal(saved.qualityDefaults.Movies, 88);
  assert.equal(saved.qualityDefaults.Series, 100);
  assert.equal(saved.qualityDefaults.Games, 1);
  assert.equal(saved.qualityDefaults.Manga, 90);
});

function note(path, noteName, mediaDir, aliases = []) {
  return {
    path,
    noteName,
    mediaDir,
    label: `[${mediaDir[0]}] ${noteName}`,
    searchNames: [noteName, ...aliases],
  };
}
