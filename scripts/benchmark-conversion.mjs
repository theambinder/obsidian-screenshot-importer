// Read-only source samples; every import/archive/write happens in a disposable vault.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { ImportJob } from '../src/runner.mjs';
import { resolveConfig } from '../src/config.mjs';
import { fileHash } from '../src/utils.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { ImportJob: LegacyJob } = await import('../build/performance-baseline/src/runner.mjs');
const screenshotRoot = process.argv[2];
if (!screenshotRoot) throw new Error('Usage: node scripts/benchmark-conversion.mjs /path/to/Screenshots');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'iina-benchmark-'));
const folders = await fs.readdir(screenshotRoot);
const samples = [
  { category: 'Anime', pattern: /^Dr_Stone_Science_Future_\[04\]/, quality: 50 },
  { category: 'Series', pattern: /^Avatar\.The\.Last\.Airbender\.S02E01\.2160p/, quality: 90 },
];
const results = [];
let referenceHashes;
try {
  for (const sample of samples) {
    const name = folders.find((folder) => sample.pattern.test(folder));
    if (!name) throw new Error(`No matching sample for ${sample.category}`);
    const directory = path.join(screenshotRoot, name);
    const names = (await fs.readdir(directory)).filter((file) => /\.png$/i.test(file)).sort().slice(0, 6);
    sample.files = [];
    for (const [index, name] of names.entries()) {
      const original = path.join(directory, name);
      const cached = path.join(temporary, `${sample.category}-${index}.png`);
      await fs.copyFile(original, cached, fs.constants.COPYFILE_FICLONE);
      const data = await fs.readFile(cached);
      sample.files.push({ original, cached, hash: createHash('sha256').update(data).digest('hex'), bytes: data.length, width: data.readUInt32BE(16), height: data.readUInt32BE(20) });
    }
  }
  for (let repeat = 1; repeat <= 2; repeat += 1) {
    for (const mode of ['legacy', '1', '2', '4']) {
      const runRoot = path.join(temporary, `${repeat}-${mode}`);
      const config = resolveConfig({ screenshotsRoot: path.join(runRoot, 'Screenshots'), vaultRoot: path.join(runRoot, 'Vault'), mediaRoot: path.join(runRoot, 'Vault/Media'), dataDir: path.join(runRoot, 'data') });
      const items = [];
      for (const sample of samples) {
        const source = path.join(config.screenshotsRoot, sample.category);
        const note = path.join(config.mediaRoot, sample.category, `${sample.category}.md`);
        await fs.mkdir(source, { recursive: true });
        await fs.mkdir(path.dirname(note), { recursive: true });
        await fs.writeFile(note, '# Benchmark\n');
        for (const [index, file] of sample.files.entries()) await fs.copyFile(file.cached, path.join(source, `${index}.png`), fs.constants.COPYFILE_FICLONE);
        items.push({ sourceFolderName: sample.category, notePath: `Media/${sample.category}/${sample.category}.md`, mode: 'episode', season: 1, episode: 1, quality: sample.quality });
      }
      const Job = mode === 'legacy' ? LegacyJob : ImportJob;
      const job = new Job(config, { items, parallelImages: Number(mode), conversion: { format: 'webp', quality: 90, effort: 6 } });
      const start = performance.now();
      await job.run();
      const seconds = (performance.now() - start) / 1000;
      if (job.status !== 'done') throw new Error(JSON.stringify(job.results));
      const hashes = {};
      for (const rel of job.log.generatedFiles) hashes[rel] = await fileHash(path.join(config.vaultRoot, rel));
      if (!referenceHashes) referenceHashes = JSON.stringify(hashes);
      if (JSON.stringify(hashes) !== referenceHashes) throw new Error('Output bytes differ between modes');
      const result = { repeat, mode, seconds: Number(seconds.toFixed(3)), files: job.doneFiles, bytes: job.results.reduce((sum, item) => sum + item.outputBytes, 0) };
      results.push(result);
      console.log(JSON.stringify(result));
      await fs.rm(runRoot, { recursive: true, force: true });
    }
  }
  for (const sample of samples) {
    for (const file of sample.files) {
      if (await fileHash(file.original) !== file.hash) throw new Error('A source changed during the benchmark');
    }
  }
  const report = { cpuCount: os.availableParallelism(), memoryGB: os.totalmem() / 1024 ** 3,
    samples: samples.map((sample) => ({ category: sample.category, quality: sample.quality, images: sample.files.map(({ bytes, width, height }) => ({ bytes, width, height })) })),
    results, identicalOutputHashes: true, sourceHashesUnchanged: true };
  await fs.writeFile(path.join(root, 'build/conversion-benchmark.json'), JSON.stringify(report, null, 2));
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
