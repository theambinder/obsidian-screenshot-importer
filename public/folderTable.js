import { parseSeasonNumber, parseEpisodeNumber } from './episodeSelection.js';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const sortKeys = new Set(['source', 'size', 'note', 'season', 'episode']);

export function nextFolderSort(current, key) {
  if (!sortKeys.has(key)) return null;
  if (current?.key !== key) return { key, direction: 'asc' };
  return current.direction === 'asc' ? { key, direction: 'desc' } : null;
}

export function sortFolders(folders, sort, notes = []) {
  if (!sortKeys.has(sort?.key)) return [...folders];
  const noteNames = new Map(notes.map((note) => [note.path, note.noteName || note.label]));
  const value = (folder) => {
    if (sort.key === 'source') return folder.name;
    if (sort.key === 'size') return Number.isFinite(folder.totalBytes) ? folder.totalBytes : null;
    if (sort.key === 'note') return folder.selectedNotePath
      ? noteNames.get(folder.selectedNotePath) || folder.selectedNoteLabel || folder.selectedNotePath
      : null;
    if (folder.mode !== 'episode') return null;
    return sort.key === 'season' ? parseSeasonNumber(folder.parsed?.season) : parseEpisodeNumber(folder.parsed?.episode);
  };
  return [...folders].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    // Missing notes and Work rows stay last in either direction.
    if (left == null || right == null) return (left == null) - (right == null);
    const order = typeof left === 'number' ? left - right : collator.compare(left, right);
    return sort.direction === 'desc' ? -order : order;
  });
}

export function setNoteFoldersEnabled(folders, source, enabled) {
  if (!source.selectedNotePath) return;
  for (const folder of folders) {
    if (folder.selectedNotePath === source.selectedNotePath) folder.enabled = enabled;
  }
}

export function setNoteFoldersMode(folders, source, mode) {
  const group = source.selectedNotePath
    ? folders.filter((folder) => folder.selectedNotePath === source.selectedNotePath)
    : [source];
  for (const folder of group) {
    folder.mode = mode;
    if (mode !== 'episode') continue;
    const detected = folder.detectedEpisode || folder.parsed;
    folder.parsed.season = parseSeasonNumber(folder.parsed.season) ?? parseSeasonNumber(detected?.season) ?? 1;
    folder.parsed.episode = parseEpisodeNumber(folder.parsed.episode) ?? parseEpisodeNumber(detected?.episode);
  }
  return group;
}

export function selectFolderRange(folders, index, anchor, enabled) {
  const start = anchor == null ? index : Math.min(index, anchor);
  const end = anchor == null ? index : Math.max(index, anchor);
  for (let i = start; i <= end; i += 1) folders[i].enabled = enabled;
}
