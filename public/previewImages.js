export function createPreviewImageLoader({ fetchImage = fetch, createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL } = {}) {
  const images = new Map();
  function clear(image) {
    const record = images.get(image);
    if (record) {
      record.controller.abort();
      if (record.objectUrl) revokeUrl(record.objectUrl);
      images.delete(image);
    }
    image.removeAttribute('src');
  }
  async function load(image, url) {
    if (images.get(image)?.url === url) return;
    clear(image);
    const record = { url, controller: new AbortController(), objectUrl: null };
    images.set(image, record);
    try {
      const response = await fetchImage(url, { signal: record.controller.signal });
      if (!response.ok) throw new Error('Preview unavailable');
      const blob = await response.blob();
      if (record.controller.signal.aborted || images.get(image) !== record) return;
      record.objectUrl = createUrl(blob);
      image.src = record.objectUrl;
    } catch (error) {
      if (!record.controller.signal.aborted) image.title = error.message;
    }
  }
  return { load, clear, clearAll() { for (const image of images.keys()) clear(image); } };
}
