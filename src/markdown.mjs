function lineStartOffsets(content) {
  const offsets = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\n') offsets.push(index + 1);
  }
  return offsets;
}

export function parseHeadings(content) {
  const offsets = lineStartOffsets(content);
  const lines = content.split(/\n/);
  const headings = [];
  let fence = null;
  let frontmatter = lines[0]?.replace(/\r$/, '') === '---';
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/\r$/, '');
    if (frontmatter) {
      if (index > 0 && /^(---|\.\.\.)$/.test(line)) frontmatter = false;
      continue;
    }
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && !line.slice(fenceMatch[0].length).trim()) fence = null;
      continue;
    }
    if (fence) continue;
    const match = line.match(/^(#{1,6})\s*(.*?)\s*#*\s*$/);
    if (!match) continue;
    headings.push({
      line: index,
      offset: offsets[index],
      level: match[1].length,
      text: match[2].trim(),
      raw: line,
    });
  }
  return headings;
}

function sectionEndOffset(content, headings, headingIndex) {
  const heading = headings[headingIndex];
  for (let index = headingIndex + 1; index < headings.length; index += 1) {
    if (headings[index].level <= heading.level) return headings[index].offset;
  }
  return content.length;
}

function normalizeEpisodeHeading(text) {
  return text.toUpperCase().replace(/\s+/g, '');
}

function episodeHeadingPattern(season, episode) {
  return new RegExp(`^S0*${Number(season)}E0*${Number(episode)}(?:$|\\s|[-:._])`, 'i');
}

function findEpisodeHeading(headings, season, episode) {
  const startsWithTarget = episodeHeadingPattern(season, episode);
  return headings.findIndex((heading) => startsWithTarget.test(heading.text.trim()));
}

function findScreenshotsHeading(headings) {
  return headings.findIndex((heading) => heading.text.trim().toLowerCase() === 'скриншоты');
}

function findSeasonHeading(headings, season) {
  const pattern = seasonHeadingPattern(season);
  return headings.findIndex((heading) => pattern.test(heading.text.trim()));
}

function seasonHeadingPattern(season) {
  return new RegExp(`^(Season|Сезон)\\s+0*${Number(season)}\\b`, 'i');
}

function parseSeasonHeading(text) {
  const match = text.trim().match(/^(?:Season|Сезон)\s+0*(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function parseEpisodeHeading(text) {
  const match = text.trim().match(/^S0*(\d+)E0*(\d+)(?:$|\s|[-:._])/i);
  return match ? { season: Number(match[1]), episode: Number(match[2]) } : null;
}

function ensureBlockSpacing(block) {
  return `\n${block.trim()}\n`;
}

function insertAt(content, offset, block) {
  const before = content.slice(0, offset).replace(/[ \t]+$/g, '');
  const after = content.slice(offset).replace(/^\n+/, '');
  const prefix = before.endsWith('\n\n') || before.length === 0 ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const suffix = after.length === 0 ? '\n' : '\n\n';
  return `${before}${prefix}${block.trim()}${suffix}${after}`;
}

function makeMarkedBlock(runId, sourceName, links) {
  const safeSource = sourceName.replace(/"/g, '&quot;');
  return [
    `<!-- iina-screenshot-importer:start run=${runId} source="${safeSource}" -->`,
    ...links,
    `<!-- iina-screenshot-importer:end run=${runId} -->`,
  ].join('\n');
}

function removeExistingLinks(content, links) {
  return links.filter((link) => !content.includes(link));
}

export function insertScreenshotLinks(content, selection, links, options = {}) {
  const runId = options.runId || 'dry-run';
  const sourceName = options.sourceName || selection.sourceFolderName || 'unknown';
  const dedupe = options.dedupeLinks !== false;
  const newLinks = dedupe ? removeExistingLinks(content, links) : links;
  if (newLinks.length === 0) {
    return { content, insertedLinks: [], heading: null, createdHeading: false };
  }

  const block = makeMarkedBlock(runId, sourceName, newLinks);
  const headings = parseHeadings(content);

  if (selection.mode === 'episode') {
    const headingIndex = findEpisodeHeading(headings, selection.season, selection.episode);
    if (headingIndex !== -1) {
      const offset = sectionEndOffset(content, headings, headingIndex);
      return {
        content: insertAt(content, offset, block),
        insertedLinks: newLinks,
        heading: `S${Number(selection.season)}E${Number(selection.episode)}`,
        createdHeading: false,
      };
    }

    const seasonIndex = findSeasonHeading(headings, selection.season);
    if (seasonIndex !== -1) {
      const seasonHeading = headings[seasonIndex];
      const episodeLevel = Math.min(seasonHeading.level + 1, 6);
      const offset = orderedEpisodeInsertOffset(content, headings, seasonIndex, selection.season, selection.episode);
      const episodeHeading = `${'#'.repeat(episodeLevel)} S${Number(selection.season)}E${Number(selection.episode)}`;
      return {
        content: insertAt(content, offset, `${episodeHeading}\n${ensureBlockSpacing(block).trim()}`),
        insertedLinks: newLinks,
        heading: `S${Number(selection.season)}E${Number(selection.episode)}`,
        createdHeading: true,
      };
    }

    const seasonLevel = inferSeasonLevel(headings, selection.season);
    const episodeLevel = Math.min(seasonLevel + 1, 6);
    const section = [
      `${'#'.repeat(seasonLevel)} Season ${Number(selection.season)}`,
      `${'#'.repeat(episodeLevel)} S${Number(selection.season)}E${Number(selection.episode)}`,
      block,
    ].join('\n');
    const offset = orderedSeasonInsertOffset(content, headings, selection.season);
    return {
      content: insertAt(content, offset, section),
      insertedLinks: newLinks,
      heading: `S${Number(selection.season)}E${Number(selection.episode)}`,
      createdHeading: true,
    };
  }

  const screenshotsIndex = findScreenshotsHeading(headings);
  if (screenshotsIndex !== -1) {
    const offset = sectionEndOffset(content, headings, screenshotsIndex);
    return {
      content: insertAt(content, offset, block),
      insertedLinks: newLinks,
      heading: 'Скриншоты',
      createdHeading: false,
    };
  }

  return {
    content: insertAt(content, content.length, `### Скриншоты\n${block}`),
    insertedLinks: newLinks,
    heading: 'Скриншоты',
    createdHeading: true,
  };
}

export function removeScreenshotBlock(content, runId, sourceName) {
  const safeSource = sourceName.replace(/"/g, '&quot;');
  const start = `<!-- iina-screenshot-importer:start run=${runId} source="${safeSource}" -->`;
  const end = `<!-- iina-screenshot-importer:end run=${runId} -->`;
  const startIndex = content.indexOf(start);
  if (startIndex === -1) return { content, removed: false };
  const endIndex = content.indexOf(end, startIndex);
  if (endIndex === -1) return { content, removed: false };

  let removeStart = startIndex;
  while (removeStart > 0 && content[removeStart - 1] === '\n') removeStart -= 1;
  const removeEnd = endIndex + end.length;
  const nextContent = `${content.slice(0, removeStart)}${content.slice(removeEnd)}`;
  return { content: nextContent, removed: true };
}

function orderedEpisodeInsertOffset(content, headings, seasonIndex, season, episode) {
  const seasonHeading = headings[seasonIndex];
  const seasonEnd = sectionEndOffset(content, headings, seasonIndex);
  for (let index = seasonIndex + 1; index < headings.length; index += 1) {
    const heading = headings[index];
    if (heading.offset >= seasonEnd) break;
    if (heading.level <= seasonHeading.level) break;
    const parsed = parseEpisodeHeading(heading.text);
    if (parsed && parsed.season === Number(season) && parsed.episode > Number(episode)) {
      return heading.offset;
    }
  }
  return seasonEnd;
}

function orderedSeasonInsertOffset(content, headings, season) {
  for (const heading of headings) {
    const parsedSeason = parseSeasonHeading(heading.text);
    if (parsedSeason && parsedSeason > Number(season)) return heading.offset;
  }
  return content.length;
}

function inferSeasonLevel(headings, season) {
  const previousSeason = headings
    .filter((heading) => {
      const parsed = parseSeasonHeading(heading.text);
      return parsed && parsed < Number(season);
    })
    .sort((a, b) => parseSeasonHeading(b.text) - parseSeasonHeading(a.text))[0];
  if (previousSeason) return previousSeason.level;

  const seasonHeading = headings.find((heading) => seasonHeadingPattern(season).test(heading.text.trim()));
  if (seasonHeading) return seasonHeading.level;

  const anySeason = headings.find((heading) => parseSeasonHeading(heading.text));
  if (anySeason) return anySeason.level;

  const episode = headings.find((heading) => /^S0*\d+E0*\d+(?:$|\s|[-:._])/i.test(heading.text.trim()));
  if (episode) return Math.max(1, episode.level - 1);
  return 3;
}
