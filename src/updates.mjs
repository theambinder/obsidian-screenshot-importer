import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { APP_VERSION } from './version.mjs';

export const REPOSITORY = 'theambinder/obsidian-screenshot-importer';
const apiRoot = `https://api.github.com/repos/${REPOSITORY}`;
const downloadRoot = `https://github.com/${REPOSITORY}/releases/download/`;
const maximumArchiveBytes = 250 * 1024 * 1024;

export function compareVersions(a, b) {
  const parse = (value) => {
    const match = String(value).match(/^v?(\d+)\.(\d+)\.(\d+)$/);
    if (!match) throw new Error('Unsupported release version');
    const parts = match.slice(1).map(Number);
    if (parts.some((part) => !Number.isSafeInteger(part))) throw new Error('Unsupported release version');
    return parts;
  };
  const left = parse(a), right = parse(b);
  for (let i = 0; i < 3; i += 1) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}

export function normalizeReleases(rows, currentVersion = APP_VERSION) {
  if (!Array.isArray(rows)) throw new Error('Invalid GitHub release response');
  return rows.filter((row) => row && !row.draft && !row.prerelease && /^v?\d+\.\d+\.\d+$/.test(row.tag_name))
    .map((row) => {
      const version = row.tag_name.replace(/^v/, '');
      const name = `Obsidian-Screenshot-Importer-${version}-Apple-Silicon.zip`;
      const asset = row.assets?.find((item) => item.name === name && item.state === 'uploaded');
      const url = `${downloadRoot}${encodeURIComponent(row.tag_name)}/${name}`;
      const available = asset && asset.browser_download_url === url
        && Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= maximumArchiveBytes
        && /^sha256:[a-f0-9]{64}$/.test(asset.digest || '');
      return {
        tag: row.tag_name, version, name: String(row.name || row.tag_name).slice(0, 300),
        publishedAt: row.published_at, notes: String(row.body || 'No release notes.').slice(0, 50000),
        url: `https://github.com/${REPOSITORY}/releases/tag/${encodeURIComponent(row.tag_name)}`,
        newer: compareVersions(version, currentVersion) > 0,
        asset: available ? { name, url, bytes: asset.size, digest: asset.digest.slice(7) } : null,
      };
    }).sort((a, b) => compareVersions(b.version, a.version));
}

function trustedDownload(url) {
  const parsed = new URL(url);
  return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port
    && ((parsed.host === 'github.com' && parsed.href.startsWith(downloadRoot))
      || ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(parsed.host));
}

async function githubResponse(url, { fetchImpl, signal, download = false }) {
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    if (download ? !trustedDownload(url) : !String(url).startsWith(`${apiRoot}/releases`)) throw new Error('Untrusted update URL');
    const response = await fetchImpl(url, {
      redirect: 'manual', signal,
      headers: { 'user-agent': `Obsidian-Screenshot-Importer/${APP_VERSION}`, accept: download ? 'application/octet-stream' : 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('Missing update redirect');
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(response.status === 403 || response.status === 429
        ? 'GitHub update requests are temporarily rate-limited. Try again later.' : `GitHub returned HTTP ${response.status}`);
    }
    return response;
  }
  throw new Error('Too many update redirects');
}

export class UpdateManager {
  constructor(root, { fetchImpl = fetch, currentVersion = APP_VERSION } = {}) {
    this.root = root;
    this.fetchImpl = fetchImpl;
    this.currentVersion = currentVersion;
    this.releases = [];
    this.checkedAt = null;
    this.checking = null;
    this.downloading = false;
    this.downloaded = null;
    this.state = { status: 'idle', bytes: 0, totalBytes: 0, percent: 0 };
  }

  async check() {
    if (this.checking) return this.checking;
    this.checking = this.fetchReleases().finally(() => { this.checking = null; });
    return this.checking;
  }

  async fetchReleases() {
    const signal = AbortSignal.timeout(20000);
    const rows = [];
    // Bound both response size and pagination; update checks never scan repository files.
    for (let page = 1; page <= 5; page += 1) {
      const response = await githubResponse(`${apiRoot}/releases?per_page=100&page=${page}`, { fetchImpl: this.fetchImpl, signal });
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 5 * 1024 * 1024) throw new Error('GitHub release response is too large');
        chunks.push(chunk);
      }
      const batch = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!Array.isArray(batch)) throw new Error('Invalid GitHub release response');
      rows.push(...batch);
      if (batch.length < 100) break;
    }
    this.releases = normalizeReleases(rows, this.currentVersion);
    this.checkedAt = new Date().toISOString();
    return { currentVersion: this.currentVersion, checkedAt: this.checkedAt, releases: this.releases };
  }

  async download(tag) {
    if (this.downloading) throw new Error('An update download is already running');
    const release = this.releases.find((item) => item.tag === tag);
    if (!release?.newer || !release.asset) throw new Error('No verified compatible update is available');
    this.downloading = true;
    this.downloaded = null;
    this.state = { status: 'downloading', tag, version: release.version, bytes: 0, totalBytes: release.asset.bytes, percent: 0 };
    let folder;
    try {
      await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
      // Remove only updater-owned previous downloads, never shared history or image folders.
      for (const entry of await fs.readdir(this.root)) {
        if (/^download-[0-9a-f-]{36}$/.test(entry)) await fs.rm(path.join(this.root, entry), { recursive: true, force: true });
      }
      folder = path.join(this.root, `download-${randomUUID()}`);
      await fs.mkdir(folder, { mode: 0o700 });
      const archive = path.join(folder, release.asset.name);
      const response = await githubResponse(release.asset.url, { fetchImpl: this.fetchImpl, signal: AbortSignal.timeout(10 * 60 * 1000), download: true });
      const handle = await fs.open(`${archive}.part`, 'wx', 0o600);
      const hash = createHash('sha256');
      try {
        for await (const chunk of response.body) {
          this.state.bytes += chunk.length;
          if (this.state.bytes > release.asset.bytes) throw new Error('Update archive exceeds its expected size');
          hash.update(chunk);
          await handle.writeFile(chunk);
          this.state.percent = Math.min(99, Math.floor(this.state.bytes / release.asset.bytes * 100));
        }
      } finally { await handle.close(); }
      if (this.state.bytes !== release.asset.bytes || hash.digest('hex') !== release.asset.digest) throw new Error('Update checksum or size does not match GitHub');
      await fs.rename(`${archive}.part`, archive);
      this.downloaded = { archive, version: release.version, digest: release.asset.digest };
      this.state = { ...this.state, status: 'downloaded', percent: 100 };
      return this.state;
    } catch (error) {
      this.state = { ...this.state, status: 'error', error: error.message };
      if (folder) await fs.rm(folder, { recursive: true, force: true });
      throw error;
    } finally { this.downloading = false; }
  }
}
