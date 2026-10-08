import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveConfig } from '../src/config.mjs';
import { ImportJob } from '../src/runner.mjs';
import { rollbackRun, rollbackRunItem, listRuns } from '../src/rollback.mjs';
import { PreviewCache } from '../src/previewCache.mjs';
import { createAppServer } from '../src/server.mjs';
import { insertScreenshotLinks, parseHeadings } from '../src/markdown.mjs';
import { convertImage } from '../src/converter.mjs';
import { pathExists, runCommand, commandVersion } from '../src/utils.mjs';
import { rememberRule, loadRules } from '../src/rules.mjs';
import { parseSourceName, suggestNotes } from '../src/matcher.mjs';

test('bundled icons are served as SVG images without external or script dependencies', async (t) => {
  const f = await fixture(t);
  const server = createAppServer(f.config);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  for (const name of ['folder', 'undo-2', 'refresh-cw', 'obsidian']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/icons/${name}.svg`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/svg+xml');
    const svg = await response.text();
    assert.match(svg, /^<svg\b/);
    assert.doesNotMatch(svg, /<script|<foreignObject|(?:href|src)=["']https?:/i);
  }
});

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iina-audit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = resolveConfig({
    port: 0,
    vaultRoot: path.join(root, 'Vault'),
    mediaRoot: path.join(root, 'Vault', 'Media'),
    screenshotsRoot: path.join(root, 'Screenshots'),
    dataDir: path.join(root, 'data'),
  });
  const notePath = path.join(config.mediaRoot, 'Series', 'Show.md');
  await fs.mkdir(path.dirname(notePath), { recursive: true });
  await fs.writeFile(notePath, '# Show\n\nMy thoughts\n');
  async function source(name, contents = 'image') {
    const folder = path.join(config.screenshotsRoot, name);
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, 'shot.png'), contents);
    return folder;
  }
  const selection = (name, episode = 1) => ({ sourceFolderName: name, notePath: 'Media/Series/Show.md', mode: 'episode', season: 1, episode });
  async function run(items, conversion = { format: 'original' }) {
    const job = new ImportJob(config, { items, conversion });
    await job.run();
    return job;
  }
  return { root, config, notePath, source, selection, run };
}

for (const existingHeading of [false, true]) {
  test(`duplicate E0 folders share ${existingHeading ? 'an existing padded' : 'one new'} heading and remain individually rollbackable`, async (t) => {
    const f = await fixture(t);
    const before = `# Show\n\n### Season 3\n${existingHeading ? '\n#### S3E00 Recap\nKeep these thoughts.\n' : ''}\n#### S3E1\nNext episode notes.\n`;
    await fs.writeFile(f.notePath, before);
    for (const name of ['A', 'B', 'C']) await f.source(name, name);
    const select = (name, episode) => ({ ...f.selection(name, episode), season: 3 });
    const job = await f.run([select('C', 1), select('B', '00'), select('A', 0)]);
    assert.equal(job.status, 'done', job.error);
    assert.deepEqual(job.log.items.map((item) => item.episode), [0, 0, 1]);
    const content = await fs.readFile(f.notePath, 'utf8');
    const headings = parseHeadings(content);
    const zero = headings.filter((heading) => /^S3E0+(?:$|\s)/.test(heading.text));
    assert.equal(zero.length, 1);
    assert.equal(zero[0].text, existingHeading ? 'S3E00 Recap' : 'S3E0');
    const next = headings.find((heading) => heading.text === 'S3E1');
    assert.ok(zero[0].offset < next.offset);
    const section = content.slice(zero[0].offset, next.offset);
    for (const item of job.log.items.slice(0, 2)) assert.ok(section.includes(item.insertedLinks[0]));
    if (existingHeading) assert.match(section, /Keep these thoughts/);
    const history = (await listRuns(f.config)).runs[0];
    assert.equal(history.items.filter((item) => item.episode === 0).length, 2);
    assert.equal(history.targets.filter((target) => target.episode === 0).length, 1);
    for (const item of history.items.filter((item) => item.episode === 0)) {
      assert.match(decodeURIComponent(item.noteUri), /S3E0/);
      assert.match(item.label, /S3E0/);
    }
    assert.equal((await rollbackRunItem(f.config, job.id, 'A')).status, 'done');
    const after = await fs.readFile(f.notePath, 'utf8');
    assert.ok(!after.includes(job.log.items[0].insertedLinks[0]));
    assert.ok(after.includes(job.log.items[1].insertedLinks[0]));
    assert.ok(after.includes(job.log.items[2].insertedLinks[0]));
    assert.equal((await rollbackRun(f.config, job.id)).status, 'done');
    for (const name of ['A', 'B', 'C']) assert.equal(await fs.readFile(path.join(f.config.screenshotsRoot, name, 'shot.png'), 'utf8'), name);
  });
}

test('runner rejects missing or invalid episode numbers before touching notes or originals', async (t) => {
  const f = await fixture(t);
  const source = await f.source('Invalid');
  const before = await fs.readFile(f.notePath, 'utf8');
  for (const episode of [null, undefined, '', ' ', -1, 0.5, '0.5', 'abc', false, []]) {
    const job = await f.run([{ ...f.selection('Invalid'), episode }]);
    assert.equal(job.status, 'error');
    assert.match(job.error, /Invalid episode/);
    assert.equal(await fs.readFile(f.notePath, 'utf8'), before);
    assert.equal(await pathExists(path.join(source, 'shot.png')), true);
    assert.equal(job.log.generatedFiles.length, 0);
  }
});

test('import, per-folder rollback, and run rollback preserve note creation time', { skip: process.platform !== 'darwin' }, async (t) => {
  const f = await fixture(t);
  const frontmatter = '---\ncreated: 2020-01-02\n---\n';
  await fs.writeFile(f.notePath, `${frontmatter}# Show\n\nMy thoughts\n`);
  await fs.utimes(f.notePath, new Date('2020-01-02T03:04:05Z'), new Date('2020-01-02T03:04:05Z'));
  const before = await fs.stat(f.notePath, { bigint: true });
  for (const name of ['First', 'Second']) await f.source(name);
  const job = await f.run([f.selection('First', 1), f.selection('Second', 2)]);
  assert.equal(job.status, 'done', JSON.stringify(job.log.items));
  const imported = await fs.stat(f.notePath, { bigint: true });
  assert.equal(imported.birthtimeNs, before.birthtimeNs);
  assert.ok(imported.mtimeNs > before.mtimeNs);
  assert.ok((await fs.readFile(f.notePath, 'utf8')).startsWith(frontmatter));
  assert.equal((await rollbackRunItem(f.config, job.id, 'First')).status, 'done');
  const partial = await fs.stat(f.notePath, { bigint: true });
  assert.equal(partial.birthtimeNs, before.birthtimeNs);
  assert.ok(partial.mtimeNs > imported.mtimeNs);
  assert.equal((await rollbackRun(f.config, job.id)).status, 'done');
  const rolledBack = await fs.stat(f.notePath, { bigint: true });
  assert.equal(rolledBack.birthtimeNs, before.birthtimeNs);
  assert.ok(rolledBack.mtimeNs > partial.mtimeNs);
  assert.ok((await fs.readFile(f.notePath, 'utf8')).startsWith(frontmatter));
});

test('rollback preserves later notes, later imports, and is idempotent', async (t) => {
  const f = await fixture(t);
  await f.source('First');
  const first = await f.run([f.selection('First')]);
  assert.equal(first.status, 'done');
  await fs.appendFile(f.notePath, '\nNew personal thoughts\n');
  await f.source('Second');
  const second = await f.run([f.selection('Second', 2)]);
  const result = await rollbackRun(f.config, first.id);
  assert.equal(result.status, 'done');
  const content = await fs.readFile(f.notePath, 'utf8');
  assert.match(content, /New personal thoughts/);
  assert.ok(content.includes(second.id));
  assert.ok(!content.includes(first.id));
  await fs.appendFile(f.notePath, '\nAfter rollback\n');
  await rollbackRun(f.config, first.id);
  assert.match(await fs.readFile(f.notePath, 'utf8'), /After rollback/);
  const listed = await listRuns(f.config);
  assert.equal(listed.runs.find((run) => run.runId === first.id).items[0].status, 'rollback:done');
});

test('overwrite rollback restores original attachment bytes', async (t) => {
  const f = await fixture(t);
  await f.source('Source', 'new bytes');
  const target = path.join(f.config.vaultRoot, 'All Notes/Attachments/Show/shot.png');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, 'existing attachment');
  const job = await f.run([f.selection('Source')], { format: 'original', conflictPolicy: 'overwrite' });
  assert.equal(await fs.readFile(target, 'utf8'), 'new bytes');
  assert.equal((await rollbackRun(f.config, job.id)).status, 'done');
  assert.equal(await fs.readFile(target, 'utf8'), 'existing attachment');
});

test('rollback keeps changed attachments and reports partial, allowing a retry', async (t) => {
  const f = await fixture(t);
  await f.source('Source');
  const job = await f.run([f.selection('Source')]);
  const target = path.join(f.config.vaultRoot, job.log.generatedFiles[0]);
  await fs.writeFile(target, 'edited later');
  const result = await rollbackRun(f.config, job.id);
  assert.equal(result.status, 'partial');
  assert.equal(await fs.readFile(target, 'utf8'), 'edited later');
  assert.equal((await listRuns(f.config)).runs[0].canRollback, true);
});

test('rollback checks missing and conflicting sources before editing the note', async (t) => {
  const f = await fixture(t);
  const original = await f.source('Source');
  const job = await f.run([f.selection('Source')]);
  const before = await fs.readFile(f.notePath, 'utf8');
  const archived = job.log.items[0].archivedTo;
  await f.source('Source', 'new source');
  assert.equal((await rollbackRunItem(f.config, job.id, 'Source')).status, 'partial');
  assert.equal(await fs.readFile(f.notePath, 'utf8'), before);
  assert.equal(await pathExists(archived), true);
  await fs.rm(original, { recursive: true });
  await fs.rm(archived, { recursive: true });
  assert.equal((await rollbackRunItem(f.config, job.id, 'Source')).status, 'partial');
  assert.equal(await fs.readFile(f.notePath, 'utf8'), before);
});

test('rollback retains attachments referenced by other notes', async (t) => {
  const f = await fixture(t);
  await f.source('Source');
  const job = await f.run([f.selection('Source')]);
  const rel = job.log.generatedFiles[0];
  await fs.writeFile(path.join(path.dirname(f.notePath), 'Other.md'), `![[${rel}]]`);
  assert.equal((await rollbackRun(f.config, job.id)).status, 'done');
  assert.equal(await pathExists(path.join(f.config.vaultRoot, rel)), true);
});

test('retrying partial rollback skips attachments already restored', async (t) => {
  const f = await fixture(t);
  const folder = await f.source('Source');
  await fs.writeFile(path.join(folder, 'second.png'), 'second');
  const target = path.join(f.config.vaultRoot, 'All Notes/Attachments/Show/shot.png');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, 'original');
  const job = await f.run([f.selection('Source')], { format: 'original', conflictPolicy: 'overwrite' });
  const second = path.join(path.dirname(target), 'second.png');
  await fs.writeFile(second, 'edited');
  assert.equal((await rollbackRunItem(f.config, job.id, 'Source')).status, 'partial');
  assert.equal(await fs.readFile(target, 'utf8'), 'original');
  await fs.writeFile(second, 'second');
  assert.equal((await rollbackRunItem(f.config, job.id, 'Source')).status, 'done');
  assert.equal(await fs.readFile(target, 'utf8'), 'original');
});

test('full rollback continues with remaining items after a folder was trashed', async (t) => {
  const f = await fixture(t);
  await f.source('A');
  await f.source('B');
  const job = await f.run([f.selection('A'), f.selection('B', 2)]);
  const item = job.log.items[0];
  item.archiveTrash = { status: 'done', finishedAt: new Date().toISOString() };
  await fs.rm(item.archivedTo, { recursive: true });
  await fs.writeFile(path.join(f.config.runsDir, `${job.id}.json`), JSON.stringify(job.log));
  const before = await fs.readFile(f.notePath, 'utf8');
  assert.equal((await rollbackRun(f.config, job.id)).status, 'done');
  const after = await fs.readFile(f.notePath, 'utf8');
  assert.ok(before.includes('source="A"'));
  assert.ok(after.includes('source="A"'));
  assert.ok(!after.includes('source="B"'));
  const history = (await listRuns(f.config)).runs[0];
  assert.equal(history.items[0].status, 'trash:done');
  assert.equal(history.items[1].status, 'rollback:done');
});

test('failed folders produce a partial run and remain recoverable in history', async (t) => {
  const f = await fixture(t);
  await f.source('Good');
  await f.source('Missing note');
  const job = await f.run([f.selection('Good'), { ...f.selection('Missing note'), notePath: 'Media/Series/Missing.md' }]);
  assert.equal(job.status, 'partial');
  const runs = await listRuns(f.config);
  assert.equal(runs.runs[0].status, 'partial');
  assert.equal(runs.runs[0].items.filter((item) => item.status === 'error').length, 1);
});

test('rejects notes outside allowed categories, source traversal, and note symlinks', async (t) => {
  const f = await fixture(t);
  await f.source('Source');
  const disallowed = await f.run([{ ...f.selection('Source'), notePath: 'Media/Private.md' }]);
  assert.equal(disallowed.status, 'error');
  const traversal = await f.run([f.selection('../data')]);
  assert.equal(traversal.status, 'error');
  await assert.rejects(rollbackRun(f.config, '../settings'), /Invalid run ID/);
  const outside = path.join(f.root, 'outside.md');
  await fs.writeFile(outside, 'must remain unchanged');
  await fs.unlink(f.notePath);
  await fs.symlink(outside, f.notePath);
  const symlink = await f.run([f.selection('Source')]);
  assert.equal(symlink.status, 'error');
  assert.equal(await fs.readFile(outside, 'utf8'), 'must remain unchanged');
});

test('Markdown insertion ignores episode headings inside fenced examples and frontmatter', () => {
  const original = '---\n# metadata\n---\n```md\n#### S1E1\n```\n### Season 1\n#### S1E1\nReal text\n';
  const result = insertScreenshotLinks(original, { mode: 'episode', season: 1, episode: 1 }, ['![[shot.webp]]']);
  assert.ok(result.content.indexOf('![[shot.webp]]') > result.content.indexOf('Real text'));
});

test('concurrent mapping updates do not lose rules', async (t) => {
  const f = await fixture(t);
  await Promise.all(['Alpha', 'Bravo', 'Charlie'].map((name) => rememberRule(f.config, name, { notePath: 'Media/Series/Show.md' })));
  assert.equal((await loadRules(f.config)).rules.length, 3);
});

test('ambiguous titles require a manual choice instead of selecting the first category', () => {
  const notes = ['Games', 'Series'].map((mediaDir) => ({
    path: `Media/${mediaDir}/The Last of Us.md`,
    label: `[${mediaDir[0]}] The Last of Us`,
    searchNames: ['The Last of Us'],
  }));
  const match = suggestNotes(parseSourceName('The.Last.of.Us.S01E01.mkv'), notes, { rules: [] });
  assert.equal(match.selected, null);
  assert.equal(match.reason, 'ambiguous');
  assert.equal(match.suggestions.length, 2);
});

test('preview cache bounds memory, expires entries, and uses normal URLs', () => {
  const cache = new PreviewCache({ maxBytes: 6, maxEntries: 2, ttlMs: 1000 });
  const first = cache.put(Buffer.from('abc'), 'image/png').split('/').at(-1);
  const second = cache.put(Buffer.from('def'), 'image/webp').split('/').at(-1);
  const thirdUrl = cache.put(Buffer.from('ghi'), 'image/webp');
  assert.match(thirdUrl, /^\/api\/preview-image\//);
  assert.equal(cache.get(first), undefined);
  assert.equal(cache.get(second).data.toString(), 'def');
  assert.equal(cache.bytes, 6);
  cache.prune(Date.now() + 1001);
  assert.equal(cache.bytes, 0);
});

test('preview endpoint serves converted image bytes via a navigable HTTP URL', async (t) => {
  if (!await commandVersion('cwebp', ['-version']) || !await commandVersion('ffmpeg', ['-version'])) return t.skip('Install cwebp and ffmpeg for image integration tests');
  const f = await fixture(t);
  const folder = await f.source('Preview');
  await runCommand('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=1', '-frames:v', '1', path.join(folder, 'shot.png')]);
  const server = createAppServer(f.config);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/preview-conversion`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder: 'Preview', file: 'shot.png', conversion: { format: 'webp', quality: 50 } }) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.dataUrl, undefined);
  const image = await fetch(base + result.url);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/webp');
  const data = Buffer.from(await image.arrayBuffer());
  assert.equal(data.length, result.outputBytes);
  assert.equal(data.toString('ascii', 8, 12), 'WEBP');
  const blocked = await fetch(`${base}/api/archive/clear`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://unrelated.example' }, body: '{}' });
  assert.equal(blocked.status, 403);
  const runBody = JSON.stringify({ items: [f.selection('Preview')], conversion: { format: 'original' } });
  const responses = await Promise.all([1, 2].map(() => fetch(`${base}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: runBody })));
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  const { jobId } = await responses.find((r) => r.status === 200).json();
  let job;
  for (let i = 0; i < 100; i++) {
    job = await (await fetch(`${base}/api/jobs/${jobId}`)).json();
    if (['done', 'partial', 'error'].includes(job.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(job.status, 'done');
});

test('failed conversion does not truncate an existing output', async (t) => {
  if (!await commandVersion('cwebp', ['-version'])) return t.skip('Install cwebp for conversion test');
  const f = await fixture(t);
  const folder = await f.source('Broken', 'not an image');
  const output = path.join(f.root, 'existing.webp');
  await fs.writeFile(output, 'keep existing bytes');
  await assert.rejects(convertImage(path.join(folder, 'shot.png'), output, { format: 'webp', quality: 90, effort: 6 }));
  assert.equal(await fs.readFile(output, 'utf8'), 'keep existing bytes');
});
