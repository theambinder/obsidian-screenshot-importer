export function normalizeTheme(value) {
  return ['system', 'light', 'dark'].includes(value) ? value : 'system';
}

export function resolveTheme(preference, systemDark) {
  const theme = normalizeTheme(preference);
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}
