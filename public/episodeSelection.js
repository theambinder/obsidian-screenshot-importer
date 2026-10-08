function parseNumber(value, minimum) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum ? number : null;
}

export const parseSeasonNumber = (value) => parseNumber(value, 1);
export const parseEpisodeNumber = (value) => parseNumber(value, 0);

export function hasEpisodeNumbers(item) {
  return parseSeasonNumber(item.season) !== null && parseEpisodeNumber(item.episode) !== null;
}

export function findDuplicateEpisodes(items) {
  const groups = new Map();
  for (const item of items) {
    if (item.enabled === false || item.mode !== 'episode' || !item.notePath || !hasEpisodeNumbers(item)) continue;
    const season = parseSeasonNumber(item.season);
    const episode = parseEpisodeNumber(item.episode);
    const key = JSON.stringify([item.notePath, season, episode]);
    if (!groups.has(key)) groups.set(key, { notePath: item.notePath, season, episode, sourceFolderNames: [] });
    groups.get(key).sourceFolderNames.push(item.sourceFolderName);
  }
  return [...groups.values()].filter((group) => group.sourceFolderNames.length > 1);
}
