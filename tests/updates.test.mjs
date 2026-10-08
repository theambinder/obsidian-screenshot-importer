import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { UpdateManager, REPOSITORY, compareVersions, normalizeReleases } from '../src/updates.mjs';
import { createAppServer } from '../src/server.mjs';
import { resolveConfig } from '../src/config.mjs';

const exec = promisify(execFile);
const content = Buffer.from('disposable verified update');
const digest = createHash('sha256').update(content).digest('hex');
const repository = `https://github.com/${REPOSITORY}`;
function release(version = '1.6.0') {
  const name = `Obsidian-Screenshot-Importer-${version}-Apple-Silicon.zip`;
  return { tag_name: `v${version}`, name: `Version ${version}`, body: '<script>unsafe()</script>\n- Changes',
    published_at: '2026-10-08T12:00:00Z', draft: false, prerelease: false,
    assets: [{ name, state: 'uploaded', browser_download_url: `${repository}/releases/download/v${version}/${name}`, size: content.length, digest: `sha256:${digest}` }] };
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian update '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
const jsonResponse = (value) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
const fakeFetch = async (url) => String(url).startsWith('https://api.github.com/') ? jsonResponse([release()]) : new Response(content);

test('update versions compare numeric components, not text, and reject nonstable/unsafe values', () => {
  assert.equal(compareVersions('1.10.0', 'v1.9.9'), 1);
  assert.equal(compareVersions('2.0.0', '1.999.999'), 1);
  assert.equal(compareVersions('v1.5.0', '1.5.0'), 0);
  assert.equal(compareVersions('1.4.9', '1.5.0'), -1);
  for (const value of ['1.6.0-beta', '1.5', 'latest', '999999999999999999999.0.0']) assert.throws(() => compareVersions(value, '1.5.0'));
});

test('update list excludes prereleases/drafts and sorts stable versions, retaining plain-text notes', () => {
  const rows = normalizeReleases([release('1.5.0'), { ...release(), draft: true }, { ...release(), prerelease: true },
    { ...release(), tag_name: 'v2.0.0-beta' }, release('1.10.0'), release('1.9.0')], '1.5.0');
  assert.deepEqual(rows.map((row) => row.version), ['1.10.0', '1.9.0', '1.5.0']);
  assert.equal(rows[2].newer, false);
  assert.equal(rows[0].notes, '<script>unsafe()</script>\n- Changes');
  assert.equal(rows[0].asset.digest, digest);
});

test('missing digests, wrong repositories, unknown filenames, and oversized assets are not installable', () => {
  for (const change of [{ digest: null }, { browser_download_url: 'https://example.com/file.zip' },
    { name: 'Other.zip' }, { size: 251 * 1024 * 1024 }, { size: 0 }, { size: 1.5 }]) {
    const row = release();
    Object.assign(row.assets[0], change);
    assert.equal(normalizeReleases([row], '1.5.0')[0].asset, null);
  }
});

test('updates make no requests on construction and share concurrent checks without transmitting local paths', async (t) => {
  const calls = [];
  const manager = new UpdateManager(await fixture(t), { currentVersion: '1.5.0', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    await new Promise((resolve) => setTimeout(resolve, 10));
    return jsonResponse([release()]);
  } });
  assert.equal(calls.length, 0);
  const [a, b] = await Promise.all([manager.check(), manager.check()]);
  assert.deepEqual(a, b);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/api.github.com\/repos\/theambinder\/obsidian-screenshot-importer\/releases\?/);
  assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[0].options.headers.authorization, undefined);
});

test('successful downloads verify exact bytes and digest, and clean only previous updater downloads', async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'history-do-not-touch.json'), 'history');
  await fs.mkdir(path.join(root, 'download-00000000-0000-0000-0000-000000000000'));
  const manager = new UpdateManager(root, { currentVersion: '1.5.0', fetchImpl: fakeFetch });
  await manager.check();
  await manager.download('v1.6.0');
  assert.equal(manager.state.status, 'downloaded');
  assert.equal(manager.state.percent, 100);
  assert.deepEqual(await fs.readFile(manager.downloaded.archive), content);
  assert.equal(await fs.readFile(path.join(root, 'history-do-not-touch.json'), 'utf8'), 'history');
  assert.equal((await fs.readdir(root)).filter((name) => name.startsWith('download-')).length, 1);
});

test('failed or incomplete downloads delete partial files, expose an error, and can be retried', async (t) => {
  for (const bytes of [Buffer.from('wrong checksum same length'), content.subarray(0, 4), Buffer.concat([content, content])]) {
    const root = await fixture(t);
    const manager = new UpdateManager(root, { currentVersion: '1.5.0', fetchImpl: async (url) => String(url).includes('api.github.com') ? jsonResponse([release()]) : new Response(bytes) });
    await manager.check();
    await assert.rejects(manager.download('v1.6.0'), /checksum|size/);
    assert.equal(manager.downloading, false);
    assert.equal(manager.downloaded, null);
    assert.equal(manager.state.status, 'error');
    assert.deepEqual(await fs.readdir(root), []);
    manager.fetchImpl = fakeFetch;
    await manager.download('v1.6.0');
    assert.equal(manager.state.status, 'downloaded');
  }
});

test('untrusted and HTTP redirect targets are rejected before any request reaches them', async (t) => {
  for (const location of ['http://github.com/file', 'https://evil.example/update', 'https://github.com/other/repo/update']) {
    const calls = [];
    const manager = new UpdateManager(await fixture(t), { currentVersion: '1.5.0', fetchImpl: async (url) => {
      calls.push(url);
      return String(url).includes('api.github.com') ? jsonResponse([release()]) : new Response(null, { status: 302, headers: { location } });
    } });
    await manager.check();
    await assert.rejects(manager.download('v1.6.0'), /Untrusted/);
    assert.equal(calls.length, 2);
  }
});

test('allowed GitHub CDN redirects preserve checksum checks; downgrade and arbitrary tags are refused', async (t) => {
  const manager = new UpdateManager(await fixture(t), { currentVersion: '1.5.0', fetchImpl: async (url) => {
    if (String(url).includes('api.github.com')) return jsonResponse([release(), release('1.4.1')]);
    if (String(url).startsWith('https://github.com/')) return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/example' } });
    return new Response(content);
  } });
  await manager.check();
  for (const tag of ['v1.4.1', '../../file', 'latest']) await assert.rejects(manager.download(tag), /No verified/);
  await manager.download('v1.6.0');
  assert.equal(manager.state.status, 'downloaded');
});

test('rate limits and malformed GitHub responses fail clearly without destroying existing release data', async (t) => {
  const manager = new UpdateManager(await fixture(t), { currentVersion: '1.5.0', fetchImpl: fakeFetch });
  await manager.check();
  manager.fetchImpl = async () => new Response(null, { status: 403 });
  await assert.rejects(manager.check(), /rate-limited/);
  assert.equal(manager.releases.length, 1);
  manager.fetchImpl = async () => jsonResponse({ wrong: true });
  await assert.rejects(manager.check(), /Invalid/);
  assert.equal(manager.checking, null);
});

test('download lock excludes mutations and install reservations, then releases after verified completion', async (t) => {
  const root = await fixture(t);
  let releaseDownload;
  const pause = new Promise((resolve) => { releaseDownload = resolve; });
  const updater = new UpdateManager(path.join(root, 'updates'), { currentVersion: '1.5.0', fetchImpl: async (url) => {
    if (String(url).includes('api.github.com')) return jsonResponse([release()]);
    await pause;
    return new Response(content);
  } });
  const config = resolveConfig({ dataDir: path.join(root, 'data'), screenshotsRoot: path.join(root, 'Screenshots'), vaultRoot: path.join(root, 'Vault'), mediaRoot: path.join(root, 'Vault/Media') });
  const server = createAppServer(config, { updater });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, data = {}) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  assert.throws(() => server.prepareUpdate(), /Download/);
  await post('/api/updates/check');
  assert.equal((await post('/api/updates/download', { tag: 'missing' })).status, 400);
  assert.equal(server.isBusy(), false);
  assert.equal((await post('/api/updates/download', { tag: 'v1.6.0' })).status, 200);
  assert.equal(server.isBusy(), true);
  for (const url of ['/api/updates/download', '/api/run', '/api/rollback', '/api/rollback-item', '/api/archive/clear']) assert.equal((await post(url)).status, 409);
  assert.throws(() => server.prepareUpdate(), /Wait/);
  assert.equal((await fetch(base + '/api/updates/state')).status, 200);
  releaseDownload();
  for (let i = 0; i < 100 && server.isBusy(); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(server.isBusy(), false);
  assert.equal(server.prepareUpdate().digest, digest);
  assert.equal((await post('/api/settings')).status, 503);
  server.cancelUpdate();
  assert.equal((await post('/api/settings')).status, 200);
});

test('native update validation checks archive/bundle/version/signature and never mutates the installed fixture', { timeout: 30000 }, async (t) => {
  if (process.platform !== 'darwin') return t.skip('macOS native helper');
  const helper = path.resolve('dist/Obsidian Screenshot Importer.app/Contents/Resources/bin/update-installer');
  await fs.access(helper);
  const root = await fixture(t);
  const old = path.join(root, 'Installed.app'), incoming = path.join(root, 'Release/Obsidian Screenshot Importer.app');
  await fs.mkdir(old);
  await fs.writeFile(path.join(old, 'untouched'), 'old application');
  await fs.mkdir(path.join(incoming, 'Contents/MacOS'), { recursive: true });
  await fs.copyFile(path.resolve('build/bin/preserve-creation-time'), path.join(incoming, 'Contents/MacOS/ObsidianScreenshotImporter'));
  const info = { CFBundleIdentifier: 'local.ambinder.obsidian-screenshot-automation.desktop', CFBundleExecutable: 'ObsidianScreenshotImporter', CFBundleShortVersionString: '1.6.0', CFBundlePackageType: 'APPL' };
  await fs.writeFile(path.join(root, 'info.json'), JSON.stringify(info));
  await exec('/usr/bin/plutil', ['-convert', 'xml1', '-o', path.join(incoming, 'Contents/Info.plist'), path.join(root, 'info.json')]);
  await exec('/usr/bin/codesign', ['--force', '--sign', '-', incoming]);
  const archive = path.join(root, 'release.zip');
  await exec('/usr/bin/ditto', ['-c', '-k', '--keepParent', path.join(root, 'Release'), archive]);
  const hash = createHash('sha256').update(await fs.readFile(archive)).digest('hex');
  const args = [String(process.pid), old, archive, '1.6.0', hash, root, 'validate-only'];
  const result = await exec(helper, args);
  assert.equal(JSON.parse(result.stdout).type, 'validated');
  assert.equal(await fs.readFile(path.join(old, 'untouched'), 'utf8'), 'old application');
  assert.equal((await fs.readdir(root)).some((name) => name.startsWith('.obsidian-importer-update')), false);
  for (const change of [{ index: 3, value: '1.7.0', error: /identity or version/ }, { index: 4, value: '0'.repeat(64), error: /checksum/ }]) {
    const bad = [...args]; bad[change.index] = change.value;
    await assert.rejects(exec(helper, bad), (error) => { assert.match(error.stdout, change.error); return true; });
  }
  await fs.writeFile(path.join(incoming, 'Contents/extra.txt'), 'invalidates signature');
  await exec('/usr/bin/ditto', ['-c', '-k', '--keepParent', path.join(root, 'Release'), archive]);
  args[4] = createHash('sha256').update(await fs.readFile(archive)).digest('hex');
  await assert.rejects(exec(helper, args), (error) => { assert.match(error.stdout, /unsealed|signature|modified|resource/i); return true; });
  await fs.symlink(old, path.join(incoming, 'Contents/escape'));
  await exec('/usr/bin/ditto', ['-c', '-k', '--keepParent', path.join(root, 'Release'), archive]);
  args[4] = createHash('sha256').update(await fs.readFile(archive)).digest('hex');
  await assert.rejects(exec(helper, args), (error) => { assert.match(error.stdout, /Symbolic/); return true; });
  assert.equal(await fs.readFile(path.join(old, 'untouched'), 'utf8'), 'old application');
});
