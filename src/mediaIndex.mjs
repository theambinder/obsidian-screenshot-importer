import fs from 'node:fs/promises';
import path from 'node:path';
import { listFilesRecursive, normalizeText, stripMdExtension, toPosixPath, vaultRelative } from './utils.mjs';

function parseFrontmatter(content) {
  if (!content.startsWith('---')) return {};
  const end = content.indexOf('\n---', 3);
  if (end === -1) return {};
  const raw = content.slice(3, end).split(/\r?\n/);
  const result = {};
  let currentKey = null;

  for (const line of raw) {
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      const value = keyMatch[2].trim();
      if (value) {
        result[currentKey] = stripYamlScalar(value);
      } else {
        result[currentKey] = [];
      }
      continue;
    }

    const listMatch = line.match(/^\s*-\s*(.*)$/);
    if (listMatch && currentKey) {
      if (!Array.isArray(result[currentKey])) result[currentKey] = [];
      result[currentKey].push(stripYamlScalar(listMatch[1].trim()));
    }
  }

  return result;
}

function stripYamlScalar(value) {
  return value
    .replace(/^['"]|['"]$/g, '')
    .replace(/^\[\[(.*)\]\]$/, '$1')
    .trim();
}

function collectSearchNames(noteName, frontmatter) {
  const names = new Set([noteName]);
  for (const key of ['alias', 'title']) {
    const value = frontmatter[key];
    if (typeof value === 'string' && value.trim()) names.add(value.trim());
  }
  const aliases = frontmatter.aliases;
  if (Array.isArray(aliases)) {
    for (const alias of aliases) {
      if (alias) names.add(String(alias).trim());
    }
  } else if (typeof aliases === 'string' && aliases.trim()) {
    names.add(aliases.trim());
  }
  return [...names];
}

export async function scanMedia(config) {
  const notes = [];
  for (const mediaDir of config.mediaDirs) {
    const root = path.join(config.mediaRoot, mediaDir);
    const files = await listFilesRecursive(root);
    for (const filePath of files) {
      if (!filePath.toLowerCase().endsWith('.md')) continue;
      const content = await fs.readFile(filePath, 'utf8');
      const noteName = stripMdExtension(path.basename(filePath));
      const frontmatter = parseFrontmatter(content);
      const searchNames = collectSearchNames(noteName, frontmatter);
      const relativePath = vaultRelative(config, filePath);
      notes.push({
        id: relativePath,
        path: relativePath,
        absolutePath: filePath,
        noteName,
        mediaDir,
        prefix: mediaDir[0].toUpperCase(),
        label: `[${mediaDir[0].toUpperCase()}] ${noteName}`,
        searchNames,
        normalizedNames: searchNames.map(normalizeText),
        aliases: searchNames.filter((name) => name !== noteName),
        obsidianUri: `obsidian://open?path=${encodeURIComponent(filePath)}`,
      });
    }
  }

  notes.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  return notes.map((note) => ({ ...note, path: toPosixPath(note.path) }));
}
