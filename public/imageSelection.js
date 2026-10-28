export function isJxr(name) {
  return /\.jxr$/i.test(name);
}

export function normalizeDuplicateMode(value) {
  return ['jxr', 'png', 'both'].includes(value) ? value : 'jxr';
}

function pairKey(name) {
  return name.replace(/\.(jxr|png)$/i, '').normalize('NFC').toLowerCase();
}

export function duplicatePairs(names) {
  const groups = new Map();
  for (const name of names) {
    if (!/\.(jxr|png)$/i.test(name)) continue;
    const key = pairKey(name);
    if (!groups.has(key)) groups.set(key, { jxr: [], png: [] });
    groups.get(key)[isJxr(name) ? 'jxr' : 'png'].push(name);
  }
  return [...groups.values()].filter((group) => group.jxr.length && group.png.length);
}

export function selectImageNames(names, mode = 'jxr') {
  const policy = normalizeDuplicateMode(mode);
  const excluded = new Set(duplicatePairs(names).flatMap((pair) => policy === 'both' ? [] : pair[policy === 'jxr' ? 'png' : 'jxr']));
  return names.filter((name) => !excluded.has(name));
}

export function qualityToCrf(value) {
  const number = Number(value);
  const quality = Math.max(1, Math.min(100, Number.isFinite(number) ? Math.round(number) : 90));
  return quality >= 40
    ? Math.round((100 - quality) * 16 / 60)
    : Math.round(16 + (40 - quality) * 47 / 39);
}

export function effectiveFormat(name, format) {
  return isJxr(name) ? 'avif' : format;
}

export function outputImageName(name, format, selectedNames = []) {
  const ext = name.slice(name.lastIndexOf('.'));
  const target = effectiveFormat(name, format);
  if (target === 'original') return name;
  // Both originals must survive even with reuse/skip/overwrite and an AVIF default.
  const sdr = target === 'avif' && /\.png$/i.test(name)
    && selectedNames.some((other) => isJxr(other) && pairKey(other) === pairKey(name));
  return `${name.slice(0, -ext.length)}${sdr ? '.sdr' : ''}.${target}`;
}
