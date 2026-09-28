// Renders the bloodmoon bosses' frames to PNG sheets for a look outside the
// game: `npx tsx scripts/boss-preview.ts [bossId ...]`. Writes to the system
// temp folder and prints where.

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { BOSS_ART } from '../src/visuals/bosses/art';
import { BOSS_ANIMS, renderAnim } from '../src/visuals/bosses/rig';

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(new Uint8Array(out.subarray(4, 8 + data.length))), 8 + data.length);
  return out;
}

/** RGB rows (3 bytes a pixel) to a PNG file. */
function png(w: number, h: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(rgb.subarray(y * w * 3, (y + 1) * w * 3)).copy(raw, y * (w * 3 + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

const SCALE = Number(process.env.SCALE ?? 3);
const out = join(tmpdir(), 'dimir-boss-preview');
mkdirSync(out, { recursive: true });
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(BOSS_ART);

// CONTACT=1: one idle frame of every boss in a row, on one sheet.
if (process.env.CONTACT) {
  const frames = ids.map((id) => renderAnim(BOSS_ART[id as keyof typeof BOSS_ART], 'idle')[0]);
  const w = frames.reduce((sum, frame) => sum + frame.w, 0) * SCALE;
  const h = Math.max(...frames.map((frame) => frame.h)) * SCALE;
  const rgb = new Uint8Array(w * h * 3);
  let left = 0;
  for (const frame of frames) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < frame.w * SCALE; x++) {
        const c = frame.px.get(Math.floor(x / SCALE), Math.floor(y / SCALE));
        const color = c >= 0 ? c : 0x2c2f38;
        const i = (y * w + left + x) * 3;
        rgb[i] = (color >> 16) & 255;
        rgb[i + 1] = (color >> 8) & 255;
        rgb[i + 2] = color & 255;
      }
    }
    left += frame.w * SCALE;
  }
  const file = join(out, 'contact.png');
  writeFileSync(file, png(w, h, rgb));
  console.log(file);
  process.exit(0);
}

for (const id of ids) {
  const art = BOSS_ART[id as keyof typeof BOSS_ART];
  if (!art) continue;
  const rows = BOSS_ANIMS.map((anim) => renderAnim(art, anim));
  const cols = Math.max(...rows.map((row) => row.length));
  const w = art.w * cols * SCALE;
  const h = art.h * rows.length * SCALE;
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = Math.floor(x / SCALE);
      const fy = Math.floor(y / SCALE);
      const row = Math.floor(fy / art.h);
      const col = Math.floor(fx / art.w);
      const frame = rows[row][col];
      // A dusk-toned field, checked per frame, so edges and silhouettes read.
      let color = ((row + col) % 2 ? 0x3b3f4a : 0x464b57);
      if (frame) {
        const c = frame.px.get(fx % art.w, fy % art.h);
        if (c >= 0) color = c;
      } else color = 0x202228;
      const i = (y * w + x) * 3;
      rgb[i] = (color >> 16) & 255;
      rgb[i + 1] = (color >> 8) & 255;
      rgb[i + 2] = color & 255;
    }
  }
  const file = join(out, `${id}.png`);
  writeFileSync(file, png(w, h, rgb));
  console.log(file);
}
