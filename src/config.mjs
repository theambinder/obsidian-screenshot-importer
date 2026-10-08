import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..');

const home = os.homedir();
const vaultRoot = process.env.OBSIDIAN_VAULT_ROOT
  || path.join(home, 'Library/Mobile Documents/iCloud~md~obsidian/Documents/ambinder');

export const DEFAULT_CONFIG = {
  port: Number(process.env.OBSIDIAN_SCREENSHOTS_PORT || process.env.IINA_IMPORTER_PORT || 3787),
  screenshotsRoot: process.env.OBSIDIAN_SCREENSHOTS_ROOT || path.join(home, 'Documents/Private/Pictures/Screenshots'),
  vaultRoot,
  mediaRoot: process.env.OBSIDIAN_MEDIA_ROOT || path.join(vaultRoot, 'Bases/Databases/Media'),
  mediaDirs: ['Anime', 'Movies', 'Series', 'Cartoons', 'Games', 'Manga', 'Comics'],
  attachmentsTemplate: 'All Notes/Attachments/{notename}',
  archiveDirName: '_archive',
  dataDir: process.env.OBSIDIAN_SCREENSHOTS_DATA_DIR || path.join(PROJECT_ROOT, 'data'),
};

export function resolveConfig(overrides = {}) {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  config.runsDir = path.join(config.dataDir, 'runs');
  config.backupsDir = path.join(config.dataDir, 'backups');
  config.rulesPath = path.join(config.dataDir, 'rules.json');
  config.settingsPath = path.join(config.dataDir, 'settings.json');
  return config;
}
