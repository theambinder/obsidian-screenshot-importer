import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ensureDir, runCommand } from './utils.mjs';
import { isJxr, effectiveFormat, qualityToCrf } from '../public/imageSelection.js';
import { normalizeResolution, targetDimensions, jpegQuantizer } from '../public/conversionProfile.js';
import { imageInfo } from './imageInfo.mjs';

export function normalizeConversionSettings(input = {}) {
  if (input.format && !['webp', 'jpg', 'png', 'avif', 'original'].includes(input.format)) throw new Error('Unsupported conversion format');
  if (input.conflictPolicy && !['increment', 'reuse', 'skip', 'overwrite'].includes(input.conflictPolicy)) throw new Error('Unsupported filename conflict policy');
  return {
    format: input.format || 'webp',
    quality: clampNumber(input.quality, 1, 100, 90),
    effort: clampNumber(input.effort, 0, 6, 6),
    conflictPolicy: input.conflictPolicy || 'increment',
    resolution: normalizeResolution(input.resolution),
  };
}

export function conversionForImage(inputPath, settings) {
  const conversion = normalizeConversionSettings(settings);
  conversion.format = effectiveFormat(inputPath, conversion.format);
  if (conversion.format === 'original') conversion.resolution = 'original';
  if (conversion.format === 'avif') conversion.crf = qualityToCrf(conversion.quality);
  if (isJxr(inputPath)) conversion.hdr = true;
  return conversion;
}

const HDR_TRANSFORM = 'zscale=pin=bt709:tin=linear:min=gbr:rin=full:p=bt2020:t=smpte2084:r=full:npl=80';

async function jxrDecoderPath() {
  for (const url of [new URL('../../bin/jxr-decode', import.meta.url), new URL('../build/bin/jxr-decode', import.meta.url)]) {
    try { await fs.access(url, fs.constants.X_OK); return fileURLToPath(url); } catch { /* Try the source build next. */ }
  }
  throw new Error('The bundled HDR JXR decoder is missing. Reinstall the application.');
}

export async function withConversionSource(inputPath, callback, options = {}) {
  if (!isJxr(inputPath)) return callback(null);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-jxr-'));
  try {
    const rawPath = path.join(directory, 'linear.raw');
    const { stdout } = await runCommand(await jxrDecoderPath(), [inputPath, rawPath], { ...options, timeout: options.timeout ?? 120_000 });
    const metadata = JSON.parse(stdout);
    if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height) || metadata.pixelFormat !== 'gbrpf32le') {
      throw new Error('Invalid HDR decoder metadata');
    }
    return await callback({ ...metadata, rawPath });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function hdrInputArgs(decoded) {
  return ['-f', 'rawvideo', '-pixel_format', 'gbrpf32le', '-video_size', `${decoded.width}x${decoded.height}`, '-i', decoded.rawPath];
}

// Lossless 16-bit PQ reference for viewers that cannot decode the original JXR.
export async function renderJxrReference(inputPath, outputPath, options = {}) {
  return withConversionSource(inputPath, (decoded) => {
    const view = options.view || (options.thumbnail ? 'thumbnail' : 'original');
    const limit = view === 'thumbnail' ? 256 : view === 'overview' ? 1600 : null;
    const scale = limit ? Math.min(1, limit / Math.max(decoded.width, decoded.height)) : 1;
    const crop = Math.min(512, decoded.width, decoded.height);
    return runCommand('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', ...hdrInputArgs(decoded), '-frames:v', '1',
    '-filter_threads', '1', '-vf', `${view === 'crop' ? `crop=${crop}:${crop}:floor((iw-ow)/2):floor((ih-oh)/2),` : ''}${HDR_TRANSFORM}:m=gbr${limit ? `:w=${Math.max(1, Math.round(decoded.width * scale))}:h=${Math.max(1, Math.round(decoded.height * scale))}` : ''},format=gbrp16le,format=rgb48be`,
    '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'rgb', '-color_range', 'pc',
    '-threads', '1', '-compression_level', view === 'original' ? '6' : '1', outputPath,
  ], options);
  }, options);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

export async function convertImage(inputPath, outputPath, settings, options = {}) {
  await ensureDir(path.dirname(outputPath));
  const temporary = path.join(path.dirname(outputPath), `.${randomUUID()}${path.extname(outputPath)}`);
  try {
    await encodeImage(inputPath, temporary, conversionForImage(inputPath, settings), options);
    options.signal?.throwIfAborted();
    await fs.rename(temporary, outputPath);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function publishStagedImage(stagedPath, outputPath) {
  const temporary = path.join(path.dirname(outputPath), `.${randomUUID()}${path.extname(outputPath)}`);
  try {
    // APFS can clone the encoded bytes; other filesystems fall back to a normal copy.
    await fs.copyFile(stagedPath, temporary, fs.constants.COPYFILE_FICLONE);
    await fs.rename(temporary, outputPath);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function encodeImage(inputPath, outputPath, settings, options) {
  await ensureDir(path.dirname(outputPath));
  if (settings.format === 'avif') {
    const encode = async (decoded) => {
      const hdr = Boolean(decoded);
      const size = settings.resolution === 'original' ? null : targetDimensions(decoded || await imageInfo(inputPath, options), settings.resolution);
      const color = hdr ? ['bt2020', 'smpte2084', 'bt2020nc'] : ['bt709', 'iec61966-2-1', 'bt709'];
      return runCommand('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        ...(hdr ? hdrInputArgs(decoded) : ['-i', inputPath]), '-frames:v', '1',
        '-vf', hdr ? `${HDR_TRANSFORM}${size ? `:w=${size.width}:h=${size.height}:filter=lanczos` : ''}:m=bt2020nc:dither=error_diffusion,format=yuv444p10le`
          : `scale=${size ? `w=${size.width}:h=${size.height}:flags=lanczos:` : ''}out_color_matrix=bt709:out_range=full,format=yuv444p10le,setparams=range=full:color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709`,
        '-c:v', 'libaom-av1', '-usage', 'allintra', '-still-picture', '1',
        '-cpu-used', '6', '-threads', '2', '-row-mt', '1',
        '-crf', String(settings.crf), '-b:v', '0',
        ...(settings.crf === 0 ? ['-aom-params', 'lossless=1'] : []),
        '-color_primaries', color[0], '-color_trc', color[1], '-colorspace', color[2], '-color_range', 'pc',
        '-bsf:v', `av1_metadata=color_primaries=${hdr ? 9 : 1}:transfer_characteristics=${hdr ? 16 : 13}:matrix_coefficients=${hdr ? 9 : 1}:color_range=1`,
        '-f', 'avif', outputPath,
      ], options);
    };
    if (options.decodedSource) return encode(options.decodedSource);
    return withConversionSource(inputPath, encode, options);
  }
  if (settings.format === 'original') {
    await fs.copyFile(inputPath, outputPath);
    return;
  }

  const sourceInfo = settings.resolution !== 'original' || settings.format === 'webp' ? await imageInfo(inputPath, options) : null;
  const size = settings.resolution === 'original' ? null : targetDimensions(sourceInfo, settings.resolution);
  const resizeArgs = size ? ['-vf', `scale=${size.width}:${size.height}:flags=lanczos`] : [];

  if (settings.format === 'webp') {
    // cwebp does not apply EXIF orientation; normalize it before resizing.
    const orientedPath = sourceInfo?.orientation ? `${outputPath}.oriented.png` : null;
    try {
      if (orientedPath) await runCommand('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath,
        '-frames:v', '1', ...resizeArgs, orientedPath], options);
      await runCommand('cwebp', [
        '-q', String(settings.quality),
        '-m', String(settings.effort),
        '-mt',
        '-quiet',
        ...(size && !orientedPath ? ['-resize', String(size.width), String(size.height)] : []),
        orientedPath || inputPath,
        '-o',
        outputPath,
      ], options);
    } finally {
      if (orientedPath) await fs.rm(orientedPath, { force: true });
    }
    return;
  }

  if (settings.format === 'jpg') {
    const qv = jpegQuantizer(settings.quality);
    await runCommand('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', inputPath,
      '-frames:v', '1',
      ...resizeArgs,
      '-q:v', String(qv),
      outputPath,
    ], options);
    return;
  }

  if (settings.format === 'png') {
    await runCommand('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', inputPath,
      '-frames:v', '1',
      ...resizeArgs,
      '-compression_level', '9',
      outputPath,
    ], options);
    return;
  }

  throw new Error(`Unsupported conversion format: ${settings.format}`);
}
