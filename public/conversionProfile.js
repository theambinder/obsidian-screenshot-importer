import { effectiveFormat, qualityToCrf } from './imageSelection.js';

export const RESOLUTIONS = ['original', '720', '1080', '1440', '2160'];

export function normalizeResolution(value) {
  if (value == null || value === '') return '1080';
  if (!RESOLUTIONS.includes(String(value))) throw new Error('Unsupported output resolution');
  return String(value);
}

export function targetDimensions(source, resolution = '1080') {
  const preset = normalizeResolution(resolution);
  const { width, height } = source;
  if (preset === 'original') return { width, height };
  const short = Number(preset), long = Math.round(short * 16 / 9);
  const scale = Math.min(1, (width >= height ? long : short) / width, (width >= height ? short : long) / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function jpegQuantizer(quality) {
  return Math.max(2, Math.min(31, Math.round(31 - (quality / 100) * 29)));
}

export function compressionDescription(name, settings) {
  const format = effectiveFormat(name, settings.format || 'webp');
  const quality = Number(settings.quality) || 90;
  let details;
  if (format === 'avif') details = `AVIF · Quality ${quality} · CRF ${qualityToCrf(quality)}\nAV1 · 10-bit · 4:4:4 · CPU-used 6\n${/\.jxr$/i.test(name) ? 'HDR · BT.2020 / PQ · scRGB white 80 nits' : 'SDR · BT.709 / sRGB'}`;
  else if (format === 'webp') details = `WebP · lossy · Quality ${quality}\nEffort ${settings.effort ?? 6} / 6 · multithreaded`;
  else if (format === 'jpg') details = `JPEG · lossy · Quality ${quality}\nFFmpeg q:v ${jpegQuantizer(quality)} (lower preserves more detail)`;
  else if (format === 'png') details = 'PNG · lossless encoding · compression level 9\nQuality does not affect PNG encoding';
  else return 'Original · byte-for-byte copy\nQuality and Resolution do not re-encode this file';
  const resolution = normalizeResolution(settings.resolution);
  return `${details}\nResolution: ${resolution === 'original' ? 'Original' : `${resolution}p maximum`} · preserve aspect ratio · never upscale`;
}
