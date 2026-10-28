export function newTabNoteUri(uri) {
  const url = new URL(uri);
  if (url.protocol !== 'obsidian:' || url.hostname !== 'open') throw new Error('Invalid Obsidian note URI');
  url.searchParams.set('paneType', 'tab');
  url.search = url.searchParams.toString().replace(/\+/g, '%20');
  return url.href;
}
