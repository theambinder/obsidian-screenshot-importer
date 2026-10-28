export function noteModeInfo(note, parsed = {}) {
  if (note?.modeHint) return { mode: note.modeHint, reason: note.modeHintReason };
  if (note?.mediaDir === 'Series') return { mode: 'episode', reason: 'Note category: Series' };
  if (note && ['Movies', 'Games', 'Manga', 'Comics'].includes(note.mediaDir)) {
    return { mode: 'screenshots', reason: `Note category: ${note.mediaDir}` };
  }
  return parsed.mode === 'episode'
    ? { mode: 'episode', reason: `Detected: ${parsed.pattern}` }
    : { mode: 'screenshots', reason: 'No episode pattern or series note type detected' };
}
