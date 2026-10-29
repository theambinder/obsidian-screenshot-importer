import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, readJson, writeJson } from './utils.mjs';

// Called only after acquiring the desktop data lock. Never replay media mutations.
export async function recoverInterruptedImports(config) {
  await ensureDir(config.runsDir);
  const recovered = [];
  for (const entry of await fs.readdir(config.runsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const runPath = path.join(config.runsDir, entry.name);
    const run = await readJson(runPath, null);
    if (!run || run.finishedAt || !['queued', 'running'].includes(run.status)) continue;
    if (`${run.runId}.json` !== entry.name) throw new Error('Run ID does not match its recovery journal');
    const message = 'Import interrupted. Originals and recorded changes were kept; inspect History and rollback before retrying affected folders.';
    run.status = 'interrupted';
    run.error = message;
    run.recoveredAt = new Date().toISOString();
    for (const item of run.items || []) {
      if (item.status !== 'running') continue;
      item.status = 'interrupted';
      item.error = message;
    }
    await writeJson(runPath, run);
    recovered.push(run.runId);
  }
  return recovered;
}
