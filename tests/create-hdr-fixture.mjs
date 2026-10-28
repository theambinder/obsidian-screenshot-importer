// Generates synthetic scRGB test data only; no screenshots or vault data are used.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runCommand } from '../src/utils.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.resolve(process.argv[2] || path.join(root, 'tests/fixtures'));
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-hdr-fixture-'));
try {
  const width = 64, height = 48;
  const tags = [[256, 4, 1, width], [257, 4, 1, height], [258, 3, 4, 0],
    [259, 3, 1, 1], [262, 3, 1, 2], [273, 4, 1, 0], [277, 3, 1, 4],
    [278, 4, 1, height], [279, 4, 1, width * height * 8], [284, 3, 1, 1],
    [338, 3, 1, 2], [339, 3, 4, 0]];
  const extra = 8 + 2 + tags.length * 12 + 4;
  const pixels = extra + 16;
  tags.find(([tag]) => tag === 258)[3] = extra;
  tags.find(([tag]) => tag === 339)[3] = extra + 8;
  tags.find(([tag]) => tag === 273)[3] = pixels;
  const tiff = Buffer.alloc(pixels + width * height * 8);
  tiff.write('II'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(tags.length, 8);
  tags.forEach(([tag, type, count, value], index) => {
    const offset = 10 + index * 12;
    tiff.writeUInt16LE(tag, offset); tiff.writeUInt16LE(type, offset + 2);
    tiff.writeUInt32LE(count, offset + 4); tiff.writeUInt32LE(value, offset + 8);
  });
  for (let channel = 0; channel < 4; channel++) {
    tiff.writeUInt16LE(16, extra + channel * 2);
    tiff.writeUInt16LE(3, extra + 8 + channel * 2);
  }
  const levels = [0x3400, 0x3800, 0x3c00, 0x4400, 0x4a40]; // 0.25, 0.5, 1, 4, 12.5 (1000 nits).
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x;
    for (let channel = 0; channel < 3; channel++) {
      tiff.writeUInt16LE(levels[Math.min(4, Math.floor(x / 13))], pixels + index * 8 + channel * 2);
      rgb[index * 3 + channel] = Math.round(x / (width - 1) * 255);
    }
    tiff.writeUInt16LE(0x3c00, pixels + index * 8 + 6);
  }
  const input = path.join(scratch, 'synthetic.tif');
  await fs.writeFile(input, tiff);
  await fs.writeFile(path.join(scratch, 'sdr.raw'), rgb);
  await fs.mkdir(destination, { recursive: true });
  await runCommand(path.join(root, 'build/vendor/jxrlib-f7521879862b9085318e814c6157490dd9dbbdb4/build/JxrEncApp'),
    ['-i', input, '-o', path.join(destination, 'hdr-scrgb.jxr'), '-c', '25', '-q', '1']);
  await runCommand(path.join(root, 'build/vendor/ffmpeg-7.1.5/ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', `${width}x${height}`, '-i', path.join(scratch, 'sdr.raw'),
    '-frames:v', '1', path.join(destination, 'hdr-scrgb.png')]);
  console.log(destination);
} finally {
  await fs.rm(scratch, { recursive: true, force: true });
}
