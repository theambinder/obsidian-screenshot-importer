// Disposable native-window fixture; never points at real screenshots or notes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from '../src/utils.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const withDuplicates = process.argv.includes('--duplicates');
const withNavigation = process.argv.includes('--navigation');
const fixtureName = withNavigation ? 'desktop-navigation-fixture' : withDuplicates ? 'desktop-duplicates-fixture' : 'desktop-ui-fixture';
const root = path.join(projectRoot, 'build', fixtureName);
const locations = {
  screenshotsRoot: path.join(root, 'Screenshots'),
  vaultRoot: path.join(root, 'Vault'),
  mediaRoot: path.join(root, 'Vault/Media'),
  dataDir: path.join(root, 'data'),
};
for (const directory of Object.values(locations)) await fs.mkdir(directory, { recursive: true });
await fs.mkdir(path.join(locations.mediaRoot, 'Series'), { recursive: true });
await fs.writeFile(path.join(locations.mediaRoot, 'Series/Portable Test.md'), '# Portable Test\n\nFixture personal notes.\n');
const folder = path.join(locations.screenshotsRoot, 'Portable.Test.S01E01');
await fs.mkdir(folder, { recursive: true });
await runCommand('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=1', '-frames:v', '1', path.join(folder, 'test.00-01-02.1.png')]);
if (withDuplicates) {
  // Select the first pair for a compact dialog, or all folders to test scrolling.
  for (let episode = 1; episode <= 12; episode += 1) {
    for (const release of ['[Release A]', '[Release B]']) {
      const duplicate = path.join(locations.screenshotsRoot, `Portable.Test.S01E${String(episode).padStart(2, '0')} ${release}`);
      await fs.mkdir(duplicate, { recursive: true });
      await fs.copyFile(path.join(folder, 'test.00-01-02.1.png'), path.join(duplicate, 'test.00-01-02.1.png'));
    }
  }
}
if (withNavigation) {
  for (let episode = 2; episode <= 60; episode += 1) {
    const source = path.join(locations.screenshotsRoot, `Portable.Test.S01E${String(episode).padStart(2, '0')}`);
    await fs.mkdir(source, { recursive: true });
    await fs.copyFile(path.join(folder, 'test.00-01-02.1.png'), path.join(source, 'test.00-01-02.1.png'));
  }
  const runsDir = path.join(locations.dataDir, 'runs');
  await fs.mkdir(runsDir, { recursive: true });
  // Simulated completed rollbacks create a long, non-actionable History list.
  for (let index = 1; index <= 40; index += 1) {
    const date = new Date(Date.UTC(2026, 0, index)).toISOString();
    const runId = date.replace(/[:.]/g, '-');
    const rollback = { status: 'done', finishedAt: date };
    await fs.writeFile(path.join(runsDir, `${runId}.json`), JSON.stringify({
      runId, startedAt: date, finishedAt: date, status: 'done', rollback,
      items: [{
        sourceFolderName: `Navigation Test ${index}`, notePath: 'Media/Series/Portable Test.md',
        mode: 'episode', season: 1, episode: index, status: 'done', rollback,
        sourceFileCount: 5, sourceBytes: 5000000, outputBytes: 500000,
      }],
      generatedFiles: [],
    }, null, 2));
  }
}
await fs.writeFile(path.join(root, 'locations.json'), JSON.stringify(locations, null, 2));
console.log(root);
