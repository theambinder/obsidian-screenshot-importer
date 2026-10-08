// Native host protocol: newline-delimited JSON over private stdin/stdout pipes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import readline from 'node:readline';
import { createAppServer } from './server.mjs';
import { desktopSupportRoot, loadDesktopConfig } from './desktopConfig.mjs';

const supportRoot = desktopSupportRoot();
const profilePath = process.env.OBSIDIAN_SCREENSHOTS_PROFILE || path.join(supportRoot, 'locations.json');
const notify = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
// If the native host crashes, its output pipe closes before the import finishes.
process.stdout.on('error', (error) => { if (error.code !== 'EPIPE') console.error(error.message); });
let releaseLock = async () => {};
let server;
let shutdownRequested = false;

async function shutdown() {
  if (shutdownRequested) return;
  shutdownRequested = true;
  server?.prepareShutdown();
  notify({ type: 'stopping', busy: server?.isBusy() || false });
  while (server?.isBusy()) await new Promise((resolve) => setTimeout(resolve, 200));
  if (server?.listening) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await releaseLock();
  process.exit(0);
}

async function acquireLock(dataDir) {
  await fs.mkdir(dataDir, { recursive: true });
  const identity = createHash('sha256').update(await fs.realpath(dataDir)).digest('hex');
  const locksRoot = path.join(supportRoot, 'locks');
  await fs.mkdir(locksRoot, { recursive: true });
  const lockPath = path.join(locksRoot, `${identity}.json`);
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, token })); }
      finally { await handle.close(); }
      return async () => {
        const current = JSON.parse(await fs.readFile(lockPath, 'utf8'));
        if (current.token === token) await fs.unlink(lockPath);
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const current = JSON.parse(await fs.readFile(lockPath, 'utf8'));
      if (!Number.isInteger(current.pid) || current.pid < 1) throw new Error(`Invalid lock: ${lockPath}`);
      try { process.kill(current.pid, 0); }
      catch (probeError) {
        if (probeError.code !== 'ESRCH') throw probeError;
        await fs.unlink(lockPath);
        continue;
      }
      throw new Error('Another instance is already using this history folder. Close it before opening this copy.');
    }
  }
  throw new Error('Cannot acquire the history folder lock');
}

try {
  const config = await loadDesktopConfig(profilePath);
  releaseLock = await acquireLock(config.dataDir);
  server = createAppServer(config);
  const input = readline.createInterface({ input: process.stdin });
  input.on('line', (line) => {
    try {
      const message = JSON.parse(line);
      if (message.type === 'shutdown') shutdown().catch(fail);
      else if (message.type === 'status') notify({ type: 'status', busy: server.isBusy() });
    } catch (error) { console.error(error.message); }
  });
  input.on('close', () => shutdown().catch(fail));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown().catch(fail));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  notify({ type: 'ready', url: `http://127.0.0.1:${server.address().port}`, config, profilePath });
} catch (error) {
  await fail(error);
}

async function fail(error) {
  console.error(error.stack || error.message);
  notify({ type: 'error', message: error.message });
  await releaseLock().catch(() => {});
  process.exit(1);
}
