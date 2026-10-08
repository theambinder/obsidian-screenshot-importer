// Isolated browser smoke-test fixture. Never reads or writes the user's vault.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppServer } from '../src/server.mjs';
import { resolveConfig } from '../src/config.mjs';
import { runCommand } from '../src/utils.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iina-preview-browser-'));
const config = resolveConfig({
  port: Number(process.env.IINA_IMPORTER_PORT || 3788),
  vaultRoot: path.join(root, 'Vault'),
  mediaRoot: path.join(root, 'Vault', 'Media'),
  screenshotsRoot: path.join(root, 'Screenshots'),
  dataDir: path.join(root, 'data'),
});
await fs.mkdir(path.join(config.mediaRoot, 'Series'), { recursive: true });
await fs.writeFile(path.join(config.mediaRoot, 'Series', 'Show.md'), '# Show\n');
const folder = path.join(config.screenshotsRoot, 'Show.S01E01.mkv');
await fs.mkdir(folder, { recursive: true });
await runCommand('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=1', '-frames:v', '1', path.join(folder, 'Show.00-01-02.1.png')]);
for (const [mediaDir, name] of [['Movies', 'Arrival'], ['Games', 'Show']]) {
  await fs.mkdir(path.join(config.mediaRoot, mediaDir), { recursive: true });
  await fs.writeFile(path.join(config.mediaRoot, mediaDir, `${name}.md`), `# ${name}\n`);
}
for (const name of ['Show.S01E02.mkv', 'Show.S02E10.mkv', 'Arrival (2016)', 'Unmatched source']) {
  const destination = path.join(config.screenshotsRoot, name);
  await fs.mkdir(destination, { recursive: true });
  await fs.copyFile(path.join(folder, 'Show.00-01-02.1.png'), path.join(destination, `${name}.png`));
}
const server = createAppServer(config);
server.listen(config.port, '127.0.0.1', () => console.log(`Fixture: http://127.0.0.1:${config.port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
  process.exit(0);
});
