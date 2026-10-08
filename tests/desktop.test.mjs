import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { loadDesktopConfig } from '../src/desktopConfig.mjs';
import { createAppServer } from '../src/server.mjs';
import { resolveConfig } from '../src/config.mjs';
import { APP_VERSION } from '../src/version.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resources = path.join(projectRoot, 'dist/Obsidian Screenshot Automation.app/Contents/Resources');
const portableNode = path.join(resources, 'bin/node');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portable screenshots '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const locations = {
    screenshotsRoot: path.join(root, 'Screenshots'),
    vaultRoot: path.join(root, 'Vault'),
    mediaRoot: path.join(root, 'Vault/Media'),
    dataDir: path.join(root, 'History'),
  };
  const profile = path.join(root, 'locations.json');
  for (const directory of Object.values(locations)) await fs.mkdir(directory, { recursive: true });
  await fs.mkdir(path.join(locations.mediaRoot, 'Series'));
  await fs.writeFile(path.join(locations.mediaRoot, 'Series/Show.md'), '# Show\n\nPersonal notes\n');
  await fs.writeFile(profile, JSON.stringify(locations));
  return { root, locations, profile };
}

function bitmap(width = 256, height = 144) {
  const stride = Math.ceil(width * 3 / 4) * 4;
  const image = Buffer.alloc(54 + stride * height);
  image.write('BM');
  image.writeUInt32LE(image.length, 2);
  image.writeUInt32LE(54, 10);
  image.writeUInt32LE(40, 14);
  image.writeInt32LE(width, 18);
  image.writeInt32LE(height, 22);
  image.writeUInt16LE(1, 26);
  image.writeUInt16LE(24, 28);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = 54 + y * stride + x * 3;
      image[offset] = (x * 3 + y) % 256;
      image[offset + 1] = (y * 3) % 256;
      image[offset + 2] = (x + y * 2) % 256;
    }
  }
  return image;
}

function startDesktop(t, f, useBundle = true) {
  const child = spawn(useBundle ? portableNode : process.execPath, [useBundle
    ? path.join(resources, 'app/src/desktop.mjs') : path.join(projectRoot, 'src/desktop.mjs')], {
    cwd: f.root,
    env: {
      HOME: os.homedir(), TMPDIR: os.tmpdir(),
      PATH: `${path.join(resources, 'bin')}:/usr/bin:/bin:/usr/sbin:/sbin`,
      OBSIDIAN_SCREENSHOTS_PROFILE: f.profile,
      OBSIDIAN_SCREENSHOTS_SUPPORT: path.join(f.root, 'App Support'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const messages = [];
  let stderr = '';
  child.stderr.on('data', (data) => { stderr += data; });
  readline.createInterface({ input: child.stdout }).on('line', (line) => messages.push(JSON.parse(line)));
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode !== null) return;
    child.stdin.end();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000).unref())]);
    if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
  });
  async function message(type) {
    for (let index = 0; index < 400; index += 1) {
      const found = messages.find((item) => item.type === type);
      if (found) return found;
      if (child.exitCode !== null) throw new Error(`Desktop exited: ${stderr}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`No ${type} message: ${stderr}`);
  }
  return { child, messages, exited, message };
}

test('desktop discovers old data without moving it, then respects local locations', async (t) => {
  const f = await fixture(t);
  const home = path.join(f.root, 'Home');
  const supportRoot = path.join(f.root, 'Support');
  const profile = path.join(home, 'missing.json');
  const fresh = await loadDesktopConfig(profile, { home, supportRoot });
  assert.equal(fresh.dataDir, path.join(supportRoot, 'data'));
  assert.equal(fresh.port, 0);
  const legacy = path.join(home, 'Documents/Private/Projects/iina-obsidian-screenshot-importer/data');
  await fs.mkdir(legacy, { recursive: true });
  assert.equal((await loadDesktopConfig(profile, { home, supportRoot })).dataDir, legacy);
  const custom = await loadDesktopConfig(f.profile, { home, supportRoot });
  assert.equal(custom.dataDir, f.locations.dataDir);
  assert.equal(custom.runsDir, path.join(f.locations.dataDir, 'runs'));
});

test('desktop refuses corrupt, relative, and out-of-vault locations', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.profile, '{broken');
  await assert.rejects(loadDesktopConfig(f.profile), /Cannot read locations/);
  await fs.writeFile(f.profile, JSON.stringify({ screenshotsRoot: 'relative' }));
  await assert.rejects(loadDesktopConfig(f.profile), /absolute/);
  await fs.writeFile(f.profile, JSON.stringify({ ...f.locations, mediaRoot: f.root }));
  await assert.rejects(loadDesktopConfig(f.profile), /inside/);
});

test('shutdown refuses new writes but allows reads', async (t) => {
  const f = await fixture(t);
  const server = createAppServer(resolveConfig(f.locations));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  assert.equal(server.isBusy(), false);
  server.prepareShutdown();
  const base = `http://127.0.0.1:${server.address().port}`;
  const blocked = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(blocked.status, 503);
  assert.equal((await fetch(`${base}/api/settings`)).status, 200);
});

test('desktop pipe lifecycle and same-data local lock', async (t) => {
  const f = await fixture(t);
  const first = startDesktop(t, f, false);
  const ready = await first.message('ready');
  assert.equal((await fetch(`${ready.url}/api/settings`)).status, 200);
  const duplicate = startDesktop(t, f, false);
  assert.match((await duplicate.message('error')).message, /Another instance/);
  assert.equal((await duplicate.exited)[0], 1);
  first.child.stdin.end();
  assert.equal((await first.exited)[0], 0);
  await assert.rejects(fetch(ready.url));
  const next = startDesktop(t, f, false);
  await next.message('ready');
  next.child.stdin.write('{"type":"shutdown"}\n');
  assert.equal((await next.exited)[0], 0);
});

test('portable bundle converts all formats and finishes an import before shutdown', { timeout: 60000 }, async (t) => {
  try { await fs.access(portableNode); } catch { return t.skip('Build the portable app first'); }
  const f = await fixture(t);
  const notePath = path.join(f.locations.mediaRoot, 'Series/Show.md');
  await fs.utimes(notePath, new Date('2020-01-02T03:04:05Z'), new Date('2020-01-02T03:04:05Z'));
  const noteBefore = await fs.stat(notePath, { bigint: true });
  const folder = path.join(f.locations.screenshotsRoot, 'Show.S01E01');
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, 'shot.bmp'), bitmap(1024, 576));
  await promisify(execFile)(path.join(resources, 'bin/ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(folder, 'shot.bmp'), '-frames:v', '1', path.join(folder, 'shot.png')]);
  await fs.unlink(path.join(folder, 'shot.bmp'));
  const desktop = startDesktop(t, f);
  const { url } = await desktop.message('ready');
  const health = await (await fetch(`${url}/api/health`)).json();
  assert.equal(health.version, APP_VERSION, 'Rebuild the portable app before testing a new version');
  const { stdout: bundleVersion } = await promisify(execFile)('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(resources, '../Info.plist')]);
  assert.equal(bundleVersion.trim(), APP_VERSION);
  const appSettings = await (await fetch(`${url}/api/settings`)).json();
  assert.equal(appSettings.appVersion, APP_VERSION);
  assert.ok(appSettings.resolvedParallelImages >= 1 && appSettings.resolvedParallelImages <= 4);
  await fetch(`${url}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parallelImages: 2 }) });
  const savedSettings = await (await fetch(`${url}/api/settings`)).json();
  assert.equal(savedSettings.resolvedParallelImages, 2);
  assert.equal(savedSettings.autoParallelImages, appSettings.autoParallelImages);
  assert.match(health.tools.cwebp, /1\.6\.0/);
  assert.match(health.tools.ffmpeg, /7\.1\.5/);
  for (const format of ['webp', 'jpg', 'png', 'original']) {
    const response = await fetch(`${url}/api/preview-conversion`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ folder: 'Show.S01E01', file: 'shot.png', conversion: { format, quality: 80, effort: 3 } }),
    });
    const preview = await response.json();
    assert.equal(response.status, 200, JSON.stringify(preview));
    assert.ok(preview.outputBytes > 0);
    const image = await fetch(`${url}${preview.url}`);
    assert.equal(image.status, 200);
    assert.equal((await image.arrayBuffer()).byteLength, preview.outputBytes);
  }
  const source = await fs.readFile(path.join(folder, 'shot.png'));
  for (let n = 1; n <= 6; n += 1) await fs.writeFile(path.join(folder, `shot${n}.png`), source);
  const run = await fetch(`${url}/api/run`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: [{ sourceFolderName: 'Show.S01E01', notePath: 'Media/Series/Show.md', mode: 'episode', season: 1, episode: 1 }], conversion: { format: 'webp', quality: 75, effort: 6 } }),
  });
  assert.equal(run.status, 200);
  const { jobId } = await run.json();
  desktop.child.stdin.write('{"type":"shutdown"}\n');
  assert.equal((await desktop.message('stopping')).busy, true);
  assert.equal((await desktop.exited)[0], 0);
  const log = JSON.parse(await fs.readFile(path.join(f.locations.dataDir, 'runs', `${jobId}.json`)));
  assert.equal(log.status, 'done');
  assert.equal(log.generatedFiles.length, 7);
  const noteImported = await fs.stat(notePath, { bigint: true });
  assert.equal(noteImported.birthtimeNs, noteBefore.birthtimeNs);
  assert.ok(noteImported.mtimeNs > noteBefore.mtimeNs);
  const restarted = startDesktop(t, f);
  const second = await restarted.message('ready');
  const rollback = await fetch(`${second.url}/api/rollback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId: jobId }) });
  assert.equal((await rollback.json()).status, 'done');
  const noteRolledBack = await fs.stat(notePath, { bigint: true });
  assert.equal(noteRolledBack.birthtimeNs, noteBefore.birthtimeNs);
  assert.ok(noteRolledBack.mtimeNs > noteImported.mtimeNs);
  assert.equal((await fs.readdir(folder)).length, 7);
  assert.match(await fs.readFile(path.join(f.locations.mediaRoot, 'Series/Show.md'), 'utf8'), /Personal notes/);
  restarted.child.stdin.end();
  assert.equal((await restarted.exited)[0], 0);

  // Simulate the host disappearing: neither stdin nor stdout has a parent now.
  const orphan = startDesktop(t, f);
  const third = await orphan.message('ready');
  const lastRun = await fetch(`${third.url}/api/run`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: [{ sourceFolderName: 'Show.S01E01', notePath: 'Media/Series/Show.md', mode: 'episode', season: 1, episode: 1 }], conversion: { format: 'webp', quality: 75, effort: 6 } }),
  });
  const lastJob = await lastRun.json();
  orphan.child.stdout.destroy();
  orphan.child.stdin.end();
  assert.equal((await orphan.exited)[0], 0);
  const orphanLog = JSON.parse(await fs.readFile(path.join(f.locations.dataDir, 'runs', `${lastJob.jobId}.json`)));
  assert.equal(orphanLog.status, 'done');
});
