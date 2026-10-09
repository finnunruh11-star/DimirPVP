// Builds Lillith Belvus's arena strips from the authored shade_queen sheets:
// `npx tsx scripts/shade-queen-sheets.ts`. Each strip is turned to face left
// like every boss, centred on her feet, padded so they sit nine tenths down,
// and trimmed of the frames where she is already back in her idle stance. The
// taunt's speech is laid back on unmirrored so it still reads.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { AUTHORED_BOSSES } from '../src/visuals/bosses/authored';

const SOURCE = 'shade_queen';
const OUT = join('src', 'Sprites', 'ShadeQueen');
const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Which source animation and which of its frames each strip keeps. */
const STRIPS: Record<string, { from: string; frames: number[]; text?: string }> = {
  idle: { from: 'idle', frames: range(0, 19) },
  idle_inspect: { from: 'idle_inspect', frames: range(0, 23) },
  walk: { from: 'run', frames: range(0, 13) },
  // Swing and stab: the wind-up and the blow whole, the slow return at every other frame.
  attack: { from: 'attack1', frames: [...range(0, 10), 11, 13, 15, 17, 19] },
  stab: { from: 'attack2', frames: [...range(0, 10), 11, 13, 15, 17, 19] },
  // Combo: all three blows, then the held crouch and the return thinned out.
  combo: { from: 'attack3', frames: [...range(0, 13), 15, 18, 20, 22, 24, 26] },
  hurt: { from: 'hurt', frames: range(0, 10) },
  death: { from: 'death', frames: range(0, 29) },
  taunt: { from: 'taunt_notext', text: 'taunt', frames: range(0, 51) },
  chant: { from: 'magic_eclipse', frames: range(0, 36) },
};

interface Img {
  w: number;
  h: number;
  rgba: Uint8Array;
}

function decode(file: string): Img {
  const buf = readFileSync(file);
  let pos = 8;
  let w = 0;
  let h = 0;
  let type = 0;
  let palette: Uint8Array | null = null;
  let alpha: Uint8Array | null = null;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      type = data[9];
      if (data[8] !== 8 || data[12] !== 0) throw new Error(`${file}: only 8-bit, non-interlaced PNGs`);
    } else if (kind === 'PLTE') palette = new Uint8Array(data);
    else if (kind === 'tRNS') alpha = new Uint8Array(data);
    else if (kind === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error(`${file}: colour type ${type}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = new Uint8Array(w * h * channels);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      let v = raw[y * (stride + 1) + 1 + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 255;
    }
  }
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (type === 6) rgba.set(out.subarray(o, o + 4), o);
    else if (type === 2) rgba.set([...out.subarray(i * 3, i * 3 + 3), 255], o);
    else if (type === 3) rgba.set([...palette!.subarray(out[i] * 3, out[i] * 3 + 3), alpha && out[i] < alpha.length ? alpha[out[i]] : 255], o);
    else if (type === 4) rgba.set([out[i * 2], out[i * 2], out[i * 2], out[i * 2 + 1]], o);
    else rgba.set([out[i], out[i], out[i], 255], o);
  }
  return { w, h, rgba };
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  let c = 0xffffffff;
  for (const b of out.subarray(4, 8 + data.length)) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  out.writeUInt32BE((c ^ 0xffffffff) >>> 0, 8 + data.length);
  return out;
}

function encode(img: Img): Buffer {
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) Buffer.from(img.rgba.subarray(y * img.w * 4, (y + 1) * img.w * 4)).copy(raw, y * (img.w * 4 + 1) + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(img.w, 0);
  header.writeUInt32BE(img.h, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))]);
}

const meta = JSON.parse(readFileSync(join(SOURCE, 'shade_queen.json'), 'utf8'));
const [fw, fh]: [number, number] = meta.frame_size;
const [anchorX, ground]: [number, number] = meta.origin_hint;
const art = AUTHORED_BOSSES.lillith;
if (meta.facing !== 'right' || ground !== art.ground) throw new Error('The sheets no longer match the registry');
const shift = art.w / 2 + anchorX;

const sheets = new Map<string, Img>();
const sheet = (name: string): Img => {
  if (!sheets.has(name)) sheets.set(name, decode(join(SOURCE, meta.animations[name].sheet)));
  return sheets.get(name)!;
};

/** Where pixel (x, y) of frame `index` of a source sheet starts in its RGBA data. */
function frameOf(name: string, index: number): (x: number, y: number) => number {
  const img = sheet(name);
  const cols = Math.floor(img.w / fw);
  const ox = (index % cols) * fw;
  const oy = Math.floor(index / cols) * fh;
  return (x, y) => ((oy + y) * img.w + ox + x) * 4;
}

mkdirSync(OUT, { recursive: true });
for (const [strip, spec] of Object.entries(STRIPS)) {
  const want = art.strips[strip];
  if (!want || want.frames !== spec.frames.length) throw new Error(`${strip}: the registry expects ${want?.frames} frames`);
  const body = sheet(spec.from);
  const said = spec.text ? sheet(spec.text) : null;
  const cols = Math.min(art.columns, spec.frames.length);
  const rows = Math.ceil(spec.frames.length / art.columns);
  const out: Img = { w: cols * art.w, h: rows * art.h, rgba: new Uint8Array(cols * art.w * rows * art.h * 4) };
  // The speech, where it differs from the plain taunt, keeps its place above her head but reads left to right.
  let textX0 = fw;
  let textX1 = -1;
  if (said) {
    for (const f of spec.frames) {
      const at = frameOf(spec.text!, f);
      for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
        const i = at(x, y);
        if (said.rgba.subarray(i, i + 4).some((v, k) => v !== body.rgba[i + k])) {
          textX0 = Math.min(textX0, x);
          textX1 = Math.max(textX1, x);
        }
      }
    }
  }
  const textShift = shift - textX1 - textX0;
  spec.frames.forEach((f, n) => {
    const at = frameOf(spec.from, f);
    const left = (n % art.columns) * art.w;
    const top = Math.floor(n / art.columns) * art.h;
    const put = (x: number, y: number, src: Uint8Array, i: number): void => {
      if (x < 0 || x >= art.w || y < 0 || y >= art.h) throw new Error(`${strip} frame ${f} spills out at ${x},${y}`);
      out.rgba.set(src.subarray(i, i + 4), ((top + y) * out.w + left + x) * 4);
    };
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      const i = at(x, y);
      if (body.rgba[i + 3] > 0) put(shift - x, y, body.rgba, i);
    }
    if (!said) return;
    for (let y = 0; y < fh; y++) for (let x = textX0; x <= textX1; x++) {
      const i = at(x, y);
      if (said.rgba.subarray(i, i + 4).some((v, k) => v !== body.rgba[i + k])) put(x + textShift, y, said.rgba, i);
    }
  });
  const file = join(OUT, `${strip}.png`);
  writeFileSync(file, encode(out));
  console.log(`${file}: ${spec.frames.length} of ${meta.animations[spec.from].frames} frames`);
}
