import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteFile, runCommand } from '../src/utils.mjs';

const macOS = { skip: process.platform !== 'darwin' };
const helper = fileURLToPath(new URL('../build/bin/preserve-creation-time', import.meta.url));

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iina-file-metadata-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const note = path.join(root, '- Note [2020] \u0421\u0435\u0440\u0438\u0430\u043b.md');
  await fs.writeFile(note, '# Original note\n', { mode: 0o600 });
  // macOS moves birthtime back when mtime is set earlier, then keeps it on edits.
  await fs.utimes(note, new Date('2020-01-02T03:04:05Z'), new Date('2020-01-02T03:04:05Z'));
  await fs.utimes(note, new Date('2021-02-03T04:05:06Z'), new Date('2021-02-03T04:05:06Z'));
  const original = await fs.stat(note, { bigint: true });
  assert.ok(original.birthtimeNs < original.mtimeNs);
  return { root, note, original };
}

test('atomic note writes retain exact creation time and permissions, with a new mtime', macOS, async (t) => {
  const f = await fixture(t);
  const writeFile = fs.writeFile;
  t.mock.method(fs, 'writeFile', async (file, ...args) => {
    await writeFile(file, ...args);
    if (String(file).endsWith('.tmp')) assert.equal((await fs.stat(file)).mode & 0o077, 0);
  });
  for (const value of ['# New note\n\n![[screenshot.webp]]\n', '# Shorter\n']) {
    const startedAt = BigInt(Date.now()) * 1_000_000n;
    await atomicWriteFile(f.note, value, { preserveCreationTime: true });
    const current = await fs.stat(f.note, { bigint: true });
    assert.equal(current.birthtimeNs, f.original.birthtimeNs);
    assert.equal(current.mode & 0o777n, 0o600n);
    assert.ok(current.mtimeNs >= startedAt);
    assert.notEqual(current.ino, f.original.ino, 'Keep atomic replacement, not an in-place rewrite');
    assert.equal(await fs.readFile(f.note, 'utf8'), value);
    assert.deepEqual(await fs.readdir(f.root), [path.basename(f.note)]);
  }
});

test('atomic note writes abort if the creation-time helper is unavailable', macOS, async (t) => {
  const f = await fixture(t);
  const access = fs.access;
  t.mock.method(fs, 'access', async (file, ...args) => {
    if (String(file).endsWith('/preserve-creation-time')) throw Object.assign(new Error('missing helper'), { code: 'ENOENT' });
    return access(file, ...args);
  });
  await assert.rejects(atomicWriteFile(f.note, 'Changed', { preserveCreationTime: true }), /helper is missing/);
  assert.equal(await fs.readFile(f.note, 'utf8'), '# Original note\n');
  assert.equal((await fs.stat(f.note, { bigint: true })).ino, f.original.ino);
  assert.deepEqual(await fs.readdir(f.root), [path.basename(f.note)]);
});

test('failed birthtime verification keeps the original and removes the temporary file', macOS, async (t) => {
  const f = await fixture(t);
  const stat = fs.stat;
  t.mock.method(fs, 'stat', async (file, ...args) => {
    const result = await stat(file, ...args);
    if (String(file).endsWith('.tmp')) result.birthtimeNs += 1n;
    return result;
  });
  await assert.rejects(atomicWriteFile(f.note, 'Changed', { preserveCreationTime: true }), /Could not preserve creation time/);
  assert.equal(await fs.readFile(f.note, 'utf8'), '# Original note\n');
  const after = await fs.stat(f.note, { bigint: true });
  assert.equal(after.ino, f.original.ino);
  assert.equal(after.birthtimeNs, f.original.birthtimeNs);
  assert.equal(after.mtimeNs, f.original.mtimeNs);
  assert.deepEqual(await fs.readdir(f.root), [path.basename(f.note)]);
});

test('a native helper error leaves the original note intact', { skip: process.platform !== 'darwin' || process.getuid?.() === 0 }, async (t) => {
  const f = await fixture(t);
  const writeFile = fs.writeFile;
  t.mock.method(fs, 'writeFile', async (file, ...args) => {
    await writeFile(file, ...args);
    if (String(file).endsWith('.tmp')) await fs.chmod(file, 0o400);
  });
  await assert.rejects(atomicWriteFile(f.note, 'Changed', { preserveCreationTime: true }), /Open metadata replacement/);
  assert.equal(await fs.readFile(f.note, 'utf8'), '# Original note\n');
  const after = await fs.stat(f.note, { bigint: true });
  assert.equal(after.ino, f.original.ino);
  assert.equal(after.birthtimeNs, f.original.birthtimeNs);
  assert.equal(after.mtimeNs, f.original.mtimeNs);
  assert.deepEqual(await fs.readdir(f.root), [path.basename(f.note)]);
});

test('a note edited during metadata preservation is not replaced', macOS, async (t) => {
  const f = await fixture(t);
  const stat = fs.stat;
  t.mock.method(fs, 'stat', async (file, ...args) => {
    if (String(file).endsWith('.tmp')) await fs.appendFile(f.note, 'User edit\n');
    return stat(file, ...args);
  });
  await assert.rejects(atomicWriteFile(f.note, 'Changed', { preserveCreationTime: true }), /File changed while saving/);
  assert.equal(await fs.readFile(f.note, 'utf8'), '# Original note\nUser edit\n');
  assert.equal((await fs.stat(f.note, { bigint: true })).birthtimeNs, f.original.birthtimeNs);
  assert.deepEqual(await fs.readdir(f.root), [path.basename(f.note)]);
});

test('a note removed or replaced with a symlink is not recreated or followed', macOS, async (t) => {
  const f = await fixture(t);
  const missing = path.join(f.root, 'Missing.md');
  await assert.rejects(atomicWriteFile(missing, 'Changed', { preserveCreationTime: true }), { code: 'ENOENT' });
  await fs.symlink(f.note, missing);
  await assert.rejects(atomicWriteFile(missing, 'Changed', { preserveCreationTime: true }), /regular file/);
  assert.equal(await fs.readFile(f.note, 'utf8'), '# Original note\n');
});

test('native helper preserves nanosecond birthtime without touching modification time or contents', macOS, async (t) => {
  const f = await fixture(t);
  const target = path.join(f.root, 'Replacement.md');
  await fs.writeFile(target, 'Replacement');
  // Use the fresh nanosecond timestamp too, not just a whole-second old date.
  const fresh = path.join(f.root, 'Fresh.md');
  await fs.writeFile(fresh, 'Source');
  const sourceStat = await fs.stat(fresh, { bigint: true });
  const before = await fs.stat(target, { bigint: true });
  await runCommand(helper, [fresh, target]);
  const after = await fs.stat(target, { bigint: true });
  assert.equal(after.birthtimeNs, sourceStat.birthtimeNs);
  assert.equal(after.mtimeNs, before.mtimeNs);
  assert.equal(await fs.readFile(target, 'utf8'), 'Replacement');
  assert.equal(await fs.readFile(fresh, 'utf8'), 'Source');
});

test('native helper refuses missing files, symlinks, and the same inode', macOS, async (t) => {
  const f = await fixture(t);
  const target = path.join(f.root, 'Replacement.md');
  const link = path.join(f.root, 'Link.md');
  await fs.writeFile(target, 'Replacement');
  await fs.symlink(f.note, link);
  for (const args of [[f.note, f.note], [link, target], [f.note, link], [f.note, `${target}.missing`], [f.root, target]]) {
    await assert.rejects(runCommand(helper, args));
  }
  assert.equal(await fs.readFile(f.note, 'utf8'), '# Original note\n');
  assert.equal(await fs.readFile(target, 'utf8'), 'Replacement');
});
