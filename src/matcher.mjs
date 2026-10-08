import path from 'node:path';
import { findRule } from './rules.mjs';
import { parseEpisodeNumber } from '../public/episodeSelection.js';
import { naturalCompare, normalizeText, stripKnownVideoExtension, tokenize } from './utils.mjs';

const SOURCE_NOISE_PATTERNS = [
  /\b(?:BDRip|WEBRip|WEB-DL|BluRay|DVDRip|HDTVRip|HDR|DV|AVC|HEVC|H\.?264|H\.?265|x264|x265|AAC|AC3|FLAC|AMZN|CR)\b/gi,
  /\b\d{3,4}p\b/gi,
  /\b\d{3,4}x\d{3,4}\b/gi,
  /\b(?:hi10p|10bit|8bit|proper|repack)\b/gi,
];

export function parseSourceName(folderName) {
  const withoutVideoExt = stripKnownVideoExtension(folderName);
  const compact = withoutVideoExt.replace(/\s+/g, ' ').trim();
  const parsed = {
    original: folderName,
    base: compact,
    titleGuess: compact,
    season: null,
    episode: null,
    mode: 'screenshots',
    pattern: 'none',
  };

  const applyEpisode = (season, episode, pattern, titleEndIndex, source = compact) => {
    parsed.season = Number(season);
    parsed.episode = Number(episode);
    parsed.mode = 'episode';
    parsed.pattern = pattern;
    parsed.titleGuess = source.slice(0, Math.max(0, titleEndIndex)).trim();
  };

  let match = compact.match(/\bS(\d{1,2})\s*E(\d{1,3})\b/i);
  if (match) {
    applyEpisode(match[1], match[2], 'SxxEyy', match.index);
    return finalizeParsed(parsed);
  }

  match = compact.match(/\bSeason[ ._-]*(\d{1,2})(?:[ ._-]+(?:Episode|Ep)[ ._-]*|\s*[-:]\s*)(\d{1,3})\b/i);
  if (match) {
    applyEpisode(match[1], match[2], 'Season - episode', match.index);
    return finalizeParsed(parsed);
  }

  match = compact.match(/\b(\d{1,2})x(\d{1,3})\b/i);
  if (match) {
    applyEpisode(match[1], match[2], 'season x episode', match.index);
    return finalizeParsed(parsed);
  }

  match = compact.match(/\b(?:Episode|Ep)[ ._-]*(\d{1,3})\b/i);
  if (match) {
    const season = compact.slice(0, match.index).match(/\b(?:Season[ ._-]*|S)(\d{1,2})\b/i);
    applyEpisode(season?.[1] ?? 1, match[1], 'named episode', season?.index ?? match.index);
    return finalizeParsed(parsed);
  }

  match = compact.match(/\(S(\d{1,2})\).*?[-_.\s]+(\d{1,3})(?=[^\d]|$)/i);
  if (match) {
    applyEpisode(match[1], match[2], '(Sxx) - episode', match.index);
    return finalizeParsed(parsed);
  }

  match = compact.match(/\bTV[-_.\s]*(\d{1,2}).*?[-_.\s]+(\d{1,3})(?=[^\d]|$)/i);
  if (match) {
    applyEpisode(match[1], match[2], 'TV-season - episode', match.index);
    return finalizeParsed(parsed);
  }

  match = compact.match(/\bS(\d{1,2}).*?[-_.\s]+(\d{1,3})(?=[^\d]|$)/i);
  if (match && Number(match[2]) <= 200) {
    applyEpisode(match[1], match[2], 'Sseason - episode', match.index);
    return finalizeParsed(parsed);
  }

  match = compact.match(/\bOVA\s*(\d{1,3})\b/i);
  if (match) {
    applyEpisode(1, match[1], 'OVA episode', match.index);
    return finalizeParsed(parsed);
  }

  const dashEpisode = [...compact.matchAll(/\s[-–]\s*(\d{1,3})(?=[\s.[_-]|$)/g)].pop();
  if (dashEpisode && Number(dashEpisode[1]) <= 200) {
    applyEpisode(1, dashEpisode[1], 'dash episode', dashEpisode.index);
    return finalizeParsed(parsed);
  }

  match = compact.match(/(?:^|[\s._-])(\d{1,3})(?=[\s._-]*(?:BDRip|WEBRip|WEB-DL|DVDRip|HDTVRip|$))/i);
  if (match && Number(match[1]) <= 200) {
    applyEpisode(1, match[1], 'loose episode number', match.index);
    return finalizeParsed(parsed);
  }

  parsed.titleGuess = compact;
  return finalizeParsed(parsed);
}

function finalizeParsed(parsed) {
  let title = parsed.titleGuess;
  title = title.replace(/^\[[^\]]+\]\s*/g, '');
  title = title.replace(/\([^)]*(?:S\d{1,2}|\d{4})[^)]*\)/gi, ' ');
  title = title.replace(/\[[^\]]*\]/g, ' ');
  title = title.replace(/\bTV[-_.\s]*\d{1,2}\b/gi, ' ');
  title = title.replace(/\bS\d{1,2}\b/gi, ' ');
  for (const pattern of SOURCE_NOISE_PATTERNS) title = title.replace(pattern, ' ');
  title = title.replace(/\b(?:19|20)\d{2}\b/g, ' ');
  title = title.replace(/[._]+/g, ' ');
  title = title.replace(/\s+/g, ' ').trim();
  parsed.titleGuess = title || stripKnownVideoExtension(parsed.original);
  parsed.normalizedTitle = normalizeText(parsed.titleGuess);
  return parsed;
}

function diceCoefficient(a, b) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return left === right ? 1 : 0;
  const bigrams = new Map();
  for (let i = 0; i < left.length - 1; i += 1) {
    const pair = left.slice(i, i + 2);
    bigrams.set(pair, (bigrams.get(pair) || 0) + 1);
  }
  let intersection = 0;
  for (let i = 0; i < right.length - 1; i += 1) {
    const pair = right.slice(i, i + 2);
    const count = bigrams.get(pair) || 0;
    if (count > 0) {
      bigrams.set(pair, count - 1);
      intersection += 1;
    }
  }
  return (2 * intersection) / (left.length + right.length - 2);
}

function scoreName(sourceTitle, candidateName) {
  const sourceNormalized = normalizeText(sourceTitle);
  const candidateNormalized = normalizeText(candidateName);
  if (!sourceNormalized || !candidateNormalized) return 0;
  if (sourceNormalized === candidateNormalized) return 1;
  if (candidateNormalized.includes(sourceNormalized)) return 0.92;
  if (sourceNormalized.includes(candidateNormalized)) return 0.84;

  const sourceTokens = new Set(tokenize(sourceTitle));
  const candidateTokens = new Set(tokenize(candidateName));
  if (sourceTokens.size === 0 || candidateTokens.size === 0) return diceCoefficient(sourceTitle, candidateName) * 0.55;
  let overlap = 0;
  let longestShared = 0;
  for (const token of sourceTokens) {
    if (candidateTokens.has(token)) {
      overlap += 1;
      longestShared = Math.max(longestShared, token.length);
    }
  }
  const sourceCoverage = overlap / sourceTokens.size;
  const candidateCoverage = overlap / candidateTokens.size;
  const dice = diceCoefficient(sourceTitle, candidateName);
  const baseScore = (sourceCoverage * 0.62) + (candidateCoverage * 0.23) + (dice * 0.15);
  if (longestShared >= 5 && sourceCoverage >= 0.5) return Math.max(baseScore, 0.58);
  return baseScore;
}

export function suggestNotes(parsed, notes, rules) {
  const rule = findRule(rules, parsed.titleGuess);
  if (rule) {
    const note = notes.find((candidate) => candidate.path === rule.notePath);
    if (note) {
      return {
        selected: note,
        confidence: 1,
        reason: 'saved rule',
        rule,
        suggestions: [{ note, score: 1, reason: 'saved rule' }],
      };
    }
  }

  const suggestions = notes
    .map((note) => {
      const best = Math.max(...note.searchNames.map((name) => scoreName(parsed.titleGuess, name)));
      return { note, score: best, reason: 'fuzzy' };
    })
    .filter((entry) => entry.score > 0.18)
    .sort((a, b) => b.score - a.score || naturalCompare(a.note.label, b.note.label))
    .slice(0, 8);

  const ambiguous = suggestions.length > 1 && suggestions[0].score - suggestions[1].score < 0.05;
  const selected = !ambiguous && suggestions[0]?.score >= 0.55 ? suggestions[0].note : null;
  return {
    selected,
    confidence: suggestions[0]?.score || 0,
    reason: ambiguous ? 'ambiguous' : selected ? 'auto' : 'needs review',
    rule: null,
    suggestions,
  };
}

export function inferMode(note, parsed) {
  if (parsed.mode === 'episode') return 'episode';
  if (!note) return parsed.mode;
  if (['Series', 'Anime', 'Cartoons'].includes(note.mediaDir) && parseEpisodeNumber(parsed.episode) !== null) return 'episode';
  return 'screenshots';
}

export function targetHeadingForSelection(selection) {
  if (selection.mode === 'episode') return `S${Number(selection.season)}E${Number(selection.episode)}`;
  return 'Скриншоты';
}

export function outputExtensionForFormat(format, inputName) {
  if (format === 'original') return path.extname(inputName).toLowerCase();
  if (format === 'jpg') return '.jpg';
  if (format === 'png') return '.png';
  return '.webp';
}
