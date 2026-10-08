import { readJson, writeJson } from './utils.mjs';
import { normalizeParallelImages } from './conversionBatch.mjs';
import { normalizeTheme } from '../public/theme.js';

const DEFAULT_QUALITY_BY_MEDIA_DIR = {
  Anime: 50,
  Movies: 90,
  Series: 90,
  Cartoons: 90,
  Games: 90,
  Manga: 90,
  Comics: 90,
};

export async function loadAppSettings(config) {
  const stored = await readJson(config.settingsPath, {});
  return normalizeAppSettings(config, stored);
}

export async function saveAppSettings(config, input = {}) {
  const stored = await readJson(config.settingsPath, {});
  const settings = normalizeAppSettings(config, { ...stored, ...input });
  await writeJson(config.settingsPath, settings);
  return settings;
}

function normalizeAppSettings(config, input = {}) {
  const qualityDefaults = {};
  const inputQualityDefaults = input.qualityDefaults || {};
  for (const mediaDir of config.mediaDirs) {
    qualityDefaults[mediaDir] = clampQuality(
      inputQualityDefaults[mediaDir],
      DEFAULT_QUALITY_BY_MEDIA_DIR[mediaDir] || 90,
    );
  }

  return {
    version: 1,
    mediaDirs: config.mediaDirs,
    qualityDefaults,
    parallelImages: normalizeParallelImages(input.parallelImages),
    theme: normalizeTheme(input.theme),
  };
}

function clampQuality(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(100, Math.round(number)));
}
