// A mine room as seen from its doorway: a timber frame in front, the chamber
// beyond in one-point perspective, and whatever it holds. Lit, it is the room
// with the party's lamp in it; dark, it is the room from the threshold, where
// only edges catch the light and the things that glint give themselves away.
// Pure (no Phaser): the views copy the pixels into textures, and a plain script
// can render every room to look at.

import type { MineOreKind } from '../pve/mineMaze';
import { mix, PixelBuffer } from '../world/pixels';

export const CHAMBER_W = 290;
export const CHAMBER_H = 116;
export const VEIN_W = 36;
export const VEIN_H = 24;

export type ChamberContent = 'empty' | 'enemies' | 'treasure' | 'ore' | 'shop';
export type VeinState = 'intact' | 'mined' | 'collapsed';

export interface ChamberSpec {
  content: ChamberContent;
  /** The party stands inside with its lamp; otherwise it looks in from the dark threshold. */
  lit: boolean;
  /** Dealt with: the fight won, the chest opened. */
  resolved: boolean;
  /** Varies the rock, the props and where things sit (the maze node id). */
  seed: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EyeSpot {
  x: number;
  y: number;
  /** Pixels between the two eyes: nearer creatures have wider-set, bigger eyes. */
  gap: number;
  size: 1 | 2;
}

export interface ChamberLayout {
  /** Where up to three ore veins sit, in the order they are filled. */
  veins: Rect[];
  /** Pairs of eyes in the dark, as many as the seed gives (two to four). */
  eyes: EyeSpot[];
  /** The chest's lock, or the shop's lamp: the point that glints. */
  glint: { x: number; y: number };
}

// ---------------------------------------------------------------------------
//  GEOMETRY
// ---------------------------------------------------------------------------

const OPEN = { x0: 16, x1: 274, y0: 12 };
const BACK = { x0: 80, x1: 210, y0: 28, y1: 78 };

const Region = { Frame: 0, Ceiling: 1, Left: 2, Right: 3, Back: 4, Floor: 5, Prop: 6, Lamp: 7, Void: 8 } as const;
type Region = (typeof Region)[keyof typeof Region];

function hash(seed: number, x: number, y: number): number {
  let h = (seed * 374761393 + x * 668265263 + y * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise, 0..1. */
function noise(seed: number, x: number, y: number, scale: number): number {
  const fx = x / scale;
  const fy = y / scale;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash(seed, ix, iy);
  const b = hash(seed, ix + 1, iy);
  const c = hash(seed, ix, iy + 1);
  const d = hash(seed, ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

const fbm = (seed: number, x: number, y: number): number =>
  noise(seed, x, y, 9) * 0.6 + noise(seed + 7, x, y, 4) * 0.3 + noise(seed + 13, x, y, 2) * 0.1;

function ceilingEdge(seed: number, x: number): number {
  const base = x < BACK.x0 ? OPEN.y0 + ((x - OPEN.x0) * (BACK.y0 - OPEN.y0)) / (BACK.x0 - OPEN.x0)
    : x > BACK.x1 ? BACK.y0 - ((x - BACK.x1) * (BACK.y0 - OPEN.y0)) / (OPEN.x1 - BACK.x1)
    : BACK.y0;
  return base + (noise(seed + 31, x, 0, 6) - 0.5) * 6;
}

function floorEdge(seed: number, x: number): number {
  const base = x < BACK.x0 ? BACK.y1 + ((BACK.x0 - x) * (CHAMBER_H - BACK.y1)) / (BACK.x0 - OPEN.x0)
    : x > BACK.x1 ? BACK.y1 + ((x - BACK.x1) * (CHAMBER_H - BACK.y1)) / (OPEN.x1 - BACK.x1)
    : BACK.y1;
  return base + (noise(seed + 37, x, 0, 7) - 0.5) * 4;
}

function sideEdge(seed: number, y: number, left: boolean): number {
  return (left ? BACK.x0 : BACK.x1) + (noise(seed + (left ? 41 : 43), 0, y, 6) - 0.5) * 6;
}

function regionAt(seed: number, x: number, y: number): Region {
  if (x < OPEN.x0 || x >= OPEN.x1 || y < OPEN.y0) return Region.Frame;
  if (y < ceilingEdge(seed, x)) return Region.Ceiling;
  if (y > floorEdge(seed, x)) return Region.Floor;
  if (x < sideEdge(seed, y, true)) return Region.Left;
  if (x > sideEdge(seed, y, false)) return Region.Right;
  return Region.Back;
}

export function chamberLayout(seed: number): ChamberLayout {
  const pick = (salt: number): number => hash(seed, salt, 991);
  const pairs: EyeSpot[] = [
    { x: 116, y: 60, gap: 6, size: 2 },
    { x: 170, y: 55, gap: 6, size: 2 },
    { x: 143, y: 47, gap: 4, size: 1 },
    { x: 206, y: 68, gap: 7, size: 2 },
    { x: 86, y: 71, gap: 7, size: 2 },
    { x: 192, y: 45, gap: 4, size: 1 },
  ];
  const count = 2 + Math.floor(pick(1) * 3);
  const start = Math.floor(pick(2) * pairs.length);
  const eyes = Array.from({ length: count }, (_, i) => pairs[(start + i * 2) % pairs.length]);
  const jitter = (base: number, salt: number, span: number): number => Math.round(base + (pick(salt) - 0.5) * span);
  return {
    veins: [
      { x: jitter(127, 3, 12), y: jitter(38, 4, 6), w: VEIN_W, h: VEIN_H },
      { x: jitter(222, 5, 6), y: jitter(52, 6, 8), w: VEIN_W, h: VEIN_H },
      { x: jitter(30, 7, 6), y: jitter(52, 8, 8), w: VEIN_W, h: VEIN_H },
    ],
    eyes,
    glint: { x: 145, y: 89 },
  };
}

// ---------------------------------------------------------------------------
//  LIGHT
// ---------------------------------------------------------------------------

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const STEPS = 7;

/** How much of the lamp reaches (x, y): the party's own light, from just below the frame's middle. */
function lampAt(lit: boolean, x: number, y: number): number {
  if (lit) {
    const d2 = ((x - 145) * 0.78) ** 2 + ((y - 128) * 1.15) ** 2;
    return 0.13 + 1.02 * Math.exp(-d2 / (2 * 80 * 80));
  }
  // From the threshold the lamp barely reaches past the doorway; the rest is a cold dimness.
  const d2 = ((x - 145) * 0.75) ** 2 + ((y - 146) * 1.25) ** 2;
  return 0.16 + 0.5 * Math.exp(-d2 / (2 * 46 * 46));
}

/** A warm lamp on the shop's counter, which lights its corner of the room even from outside. */
function shopLamp(spec: ChamberSpec, x: number, y: number): number {
  if (spec.content !== 'shop') return 0;
  const d2 = (x - 145) ** 2 + ((y - 60) * 1.3) ** 2;
  return 0.75 * Math.exp(-d2 / (2 * 26 * 26));
}

/** Colour `c` lit to `light`, dithered into a few bands, warm in lamplight and cold in the dark. */
function shadeColor(c: number, light: number, lit: boolean, x: number, y: number): number {
  const dither = BAYER[(y & 3) * 4 + (x & 3)] / 16;
  const q = Math.min(1.25, Math.max(0, Math.floor(light * STEPS + dither) / STEPS));
  const warm = lit ? [1.06, 0.95, 0.8] : [0.8, 0.88, 1.08];
  const ch = (shift: number, k: number): number => Math.min(255, Math.round(((c >> shift) & 255) * q * warm[k]));
  return (ch(16, 0) << 16) | (ch(8, 1) << 8) | ch(0, 2);
}

// ---------------------------------------------------------------------------
//  THE ROOM
// ---------------------------------------------------------------------------

const ROCK_DARK = 0x352e29;
const ROCK_LIGHT = 0x6f6356;
const FLOOR_DARK = 0x332c26;
const FLOOR_LIGHT = 0x5c5146;
const TIMBER = 0x7c5432;
const TIMBER_DARK = 0x4a301c;
const TIMBER_LIGHT = 0x9c6c42;
const IRON = 0x666a72;
const BONE = 0xd8cdb0;
const GOLD = 0xe0b448;

const FACING: Record<Region, number> = {
  [Region.Frame]: 1,
  [Region.Ceiling]: 0.5,
  [Region.Left]: 0.74,
  [Region.Right]: 0.74,
  [Region.Back]: 0.92,
  [Region.Floor]: 0.9,
  [Region.Prop]: 1,
  [Region.Lamp]: 1,
  [Region.Void]: 0,
};

/** Nearest and second-nearest feature points of a jittered grid: stones and the cracks between them. */
function worley(seed: number, x: number, y: number, cell: number, squash: number): { d1: number; d2: number; id: number; ox: number; oy: number } {
  const fx = x / cell;
  const fy = (y * squash) / cell;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  let d1 = Infinity;
  let d2 = Infinity;
  let id = 0;
  let ox = 0;
  let oy = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i + 0.15 + hash(seed, ix + i, iy + j) * 0.7;
      const cy = iy + j + 0.15 + hash(seed + 1, ix + i, iy + j) * 0.7;
      const d = Math.hypot(fx - cx, fy - cy);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = (ix + i) * 7919 + (iy + j) * 104729;
        ox = fx - cx;
        oy = fy - cy;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return { d1: d1 * cell, d2: d2 * cell, id, ox, oy };
}

const STONE: Record<number, { cell: number; squash: number; seed: number }> = {
  [Region.Ceiling]: { cell: 12, squash: 1.4, seed: 101 },
  [Region.Left]: { cell: 11, squash: 0.8, seed: 103 },
  [Region.Right]: { cell: 11, squash: 0.8, seed: 107 },
  [Region.Back]: { cell: 9, squash: 1.15, seed: 109 },
  [Region.Floor]: { cell: 12, squash: 2.4, seed: 113 },
};

interface Canvas {
  color: Int32Array;
  region: Uint8Array;
}

function propRect(cv: Canvas, x: number, y: number, w: number, h: number, color: number, region: Region = Region.Prop): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
    if (xx < 0 || yy < 0 || xx >= CHAMBER_W || yy >= CHAMBER_H) continue;
    cv.color[yy * CHAMBER_W + xx] = color;
    cv.region[yy * CHAMBER_W + xx] = region;
  }
}

function propLine(cv: Canvas, x0: number, y0: number, x1: number, y1: number, color: number, region: Region = Region.Prop): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / steps);
    const y = Math.round(y0 + ((y1 - y0) * i) / steps);
    propRect(cv, x, y, 1, 1, color, region);
  }
}

function propDisc(cv: Canvas, cx: number, cy: number, r: number, color: number, region: Region = Region.Prop): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.3) propRect(cv, x, y, 1, 1, color, region);
    }
  }
}

function paintRock(cv: Canvas, seed: number): void {
  for (let y = 0; y < CHAMBER_H; y++) {
    for (let x = 0; x < CHAMBER_W; x++) {
      const region = regionAt(seed, x, y);
      const i = y * CHAMBER_W + x;
      cv.region[i] = region;
      if (region === Region.Frame) continue;
      // Stones: each its own shade, lit on the side toward the lamp, dark in the cracks.
      const stone = STONE[region];
      const w = worley(seed + stone.seed, x, y, stone.cell, stone.squash);
      const own = hash(seed, w.id, 77);
      const n = fbm(seed, x, y);
      let t = 0.3 + own * 0.35 + (n - 0.5) * 0.3;
      const gap = w.d2 - w.d1;
      if (gap < 1.1) t -= 0.32;
      else if (gap < 2.4) t += w.oy < -0.1 || w.ox < -0.2 ? 0.16 : -0.1;
      if (region === Region.Floor) {
        if (hash(seed + 3, x, y) > 0.95) t += 0.2;
        cv.color[i] = mix(FLOOR_DARK, FLOOR_LIGHT, Math.max(0, Math.min(1, t)));
      } else {
        cv.color[i] = mix(ROCK_DARK, ROCK_LIGHT, Math.max(0, Math.min(1, t)));
      }
    }
  }
  // Seams where the walls meet: the corners of the room.
  for (let y = 1; y < CHAMBER_H - 1; y++) {
    for (let x = 1; x < CHAMBER_W - 1; x++) {
      const i = y * CHAMBER_W + x;
      const here = cv.region[i];
      if (here === Region.Frame) continue;
      const right = cv.region[i + 1];
      const below = cv.region[i + CHAMBER_W];
      if ((right !== here && right !== Region.Frame) || (below !== here && below !== Region.Frame)) {
        cv.color[i] = mix(cv.color[i], 0x000000, 0.45);
      }
    }
  }
  // Stalactites off the ceiling's edge, stalagmites along the foot of the walls.
  for (let k = 0; k < 18; k++) {
    const x = Math.round(OPEN.x0 + 6 + hash(seed, k, 5) * (OPEN.x1 - OPEN.x0 - 12));
    const top = Math.round(ceilingEdge(seed, x)) - 1;
    const length = 3 + Math.floor(hash(seed, k, 6) * (x > BACK.x0 && x < BACK.x1 ? 6 : 11));
    for (let j = 0; j < length; j++) {
      const half = Math.max(0, Math.round(1.6 * (1 - j / length)));
      for (let dx = -half; dx <= half; dx++) propRect(cv, x + dx, top + j, 1, 1, mix(ROCK_DARK, ROCK_LIGHT, 0.55 - j * 0.03 + dx * 0.08), Region.Ceiling);
    }
  }
  for (let k = 0; k < 8; k++) {
    const left = k % 2 === 0;
    const y = Math.round(BACK.y1 + 8 + hash(seed, k, 9) * 26);
    const edge = Math.round(left ? OPEN.x0 + ((CHAMBER_H - y) * (BACK.x0 - OPEN.x0)) / (CHAMBER_H - BACK.y1) : OPEN.x1 - ((CHAMBER_H - y) * (OPEN.x1 - BACK.x1)) / (CHAMBER_H - BACK.y1));
    const height = 3 + Math.floor(hash(seed, k, 10) * 6);
    for (let j = 0; j < height; j++) {
      const half = Math.round(2.2 * (j / height));
      for (let dx = -half; dx <= half; dx++) propRect(cv, edge + dx + (left ? 3 : -3), y - height + j, 1, 1, mix(ROCK_DARK, ROCK_LIGHT, 0.5 + dx * 0.06), Region.Floor);
    }
  }
}

function paintRails(cv: Canvas): void {
  const sleepers = [81, 84, 88, 93, 100, 109];
  for (const y of sleepers) {
    const t = (y - 79) / (CHAMBER_H - 79);
    const left = Math.round(139 - t * 23) - 2;
    const right = Math.round(151 + t * 23) + 2;
    const thick = y > 95 ? 2 : 1;
    propRect(cv, left, y, right - left + 1, thick, TIMBER_DARK);
  }
  propLine(cv, 139, 79, 116, 115, IRON);
  propLine(cv, 151, 79, 174, 115, IRON);
  propLine(cv, 140, 79, 117, 115, 0x8a8e96);
  propLine(cv, 152, 79, 175, 115, 0x8a8e96);
}

function paintCart(cv: Canvas, seed: number): void {
  const x = 204 + Math.floor(hash(seed, 21, 1) * 10);
  const y = 88;
  // Tipped on its side by the wall: a box and a wheel in the air.
  for (let j = 0; j < 14; j++) {
    const inset = Math.round(j * 0.25);
    propRect(cv, x + inset, y + j, 30 - inset * 2, 1, j < 2 ? 0x8a6a4a : j % 5 === 0 ? IRON : 0x6a4c30);
  }
  propRect(cv, x, y, 30, 1, IRON);
  propDisc(cv, x + 7, y + 16, 3, 0x2a2826);
  propDisc(cv, x + 7, y + 16, 1, IRON);
  propDisc(cv, x + 23, y + 16, 3, 0x2a2826);
  propDisc(cv, x + 23, y + 16, 1, IRON);
  // Spilled rock.
  for (let k = 0; k < 9; k++) {
    propDisc(cv, x - 4 - hash(seed, k, 22) * 16, y + 12 + hash(seed, k, 23) * 8, 1 + hash(seed, k, 24) * 1.6, mix(ROCK_DARK, ROCK_LIGHT, 0.4 + hash(seed, k, 25) * 0.4));
  }
}

function paintRubble(cv: Canvas, seed: number): void {
  for (let k = 0; k < 14; k++) {
    const left = k % 2 === 0;
    const x = left ? 40 + hash(seed, k, 31) * 50 : 196 + hash(seed, k, 31) * 50;
    const y = 92 + hash(seed, k, 32) * 18;
    propDisc(cv, x, y, 1 + hash(seed, k, 33) * 2.2, mix(ROCK_DARK, ROCK_LIGHT, 0.35 + hash(seed, k, 34) * 0.4));
  }
}

function paintChest(cv: Canvas, open: boolean): void {
  const x = 132;
  const y = 90;
  if (open) {
    // The lid stands up behind; the inside is bare.
    propRect(cv, x - 1, y - 12, 29, 8, 0x5a3c22);
    propRect(cv, x, y - 11, 27, 6, 0x3a2614);
    propRect(cv, x + 1, y - 4, 25, 5, 0x1a120c);
  } else {
    propRect(cv, x - 1, y - 6, 29, 6, TIMBER_LIGHT);
    propRect(cv, x - 1, y - 6, 29, 1, 0xb88454);
    propRect(cv, x - 1, y - 1, 29, 1, TIMBER_DARK);
  }
  propRect(cv, x, y, 27, 14, TIMBER);
  propRect(cv, x, y + 13, 27, 1, TIMBER_DARK);
  for (const bx of [x + 4, x + 21]) propRect(cv, bx, open ? y : y - 6, 2, open ? 14 : 20, IRON);
  propRect(cv, x, y + 5, 27, 1, TIMBER_DARK);
  if (!open) {
    propRect(cv, x + 12, y - 2, 3, 5, GOLD);
    propRect(cv, x + 13, y + 1, 1, 1, 0x2a1c10);
  }
}

function paintRemains(cv: Canvas, seed: number): void {
  // A skull, ribs and long bones, a snapped spear, dark stains.
  for (let k = 0; k < 4; k++) {
    const cx = 104 + hash(seed, k, 41) * 84;
    const cy = 94 + hash(seed, k, 42) * 14;
    const rx = 3 + hash(seed, k, 43) * 5;
    for (let y = Math.floor(cy - 2); y <= Math.ceil(cy + 2); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        if (((x - cx) / rx) ** 2 + ((y - cy) / 1.8) ** 2 <= 1) propRect(cv, x, y, 1, 1, 0x3a1e18, Region.Floor);
      }
    }
  }
  const sx = 112 + Math.floor(hash(seed, 1, 44) * 20);
  propDisc(cv, sx, 98, 2.6, BONE);
  propRect(cv, sx - 1, 98, 1, 1, 0x1a120c);
  propRect(cv, sx + 1, 98, 1, 1, 0x1a120c);
  propRect(cv, sx - 1, 100, 3, 1, 0xb0a588);
  for (let k = 0; k < 5; k++) {
    const x = 150 + hash(seed, k, 45) * 40;
    const y = 96 + hash(seed, k, 46) * 12;
    const len = 4 + hash(seed, k, 47) * 5;
    propLine(cv, Math.round(x), Math.round(y), Math.round(x + len), Math.round(y - len * 0.3), BONE);
  }
  propLine(cv, 176, 104, 196, 92, TIMBER);
  propLine(cv, 196, 92, 199, 89, IRON);
}

function paintShop(cv: Canvas): void {
  // A plank counter at the back with a lamp on it, crates to one side.
  propRect(cv, 112, 70, 66, 4, TIMBER_LIGHT);
  propRect(cv, 114, 74, 62, 12, TIMBER);
  for (let x = 118; x < 174; x += 9) propRect(cv, x, 74, 1, 12, TIMBER_DARK);
  propRect(cv, 142, 60, 7, 9, 0x3a3a40);
  propRect(cv, 143, 61, 5, 7, 0xffc04a, Region.Lamp);
  propRect(cv, 144, 58, 3, 2, 0x3a3a40);
  for (const [x, y, s] of [[86, 84, 12], [96, 90, 10], [84, 94, 9]] as const) {
    propRect(cv, x, y, s, s, TIMBER);
    propRect(cv, x, y, s, 1, TIMBER_LIGHT);
    propLine(cv, x, y, x + s - 1, y + s - 1, TIMBER_DARK);
  }
}

function paintFrame(px: PixelBuffer, seed: number): void {
  // The timber set in the doorway the party stands in: two posts and a cap.
  for (let y = 0; y < CHAMBER_H; y++) {
    for (let x = 0; x < CHAMBER_W; x++) {
      const post = x < OPEN.x0 || x >= OPEN.x1;
      const cap = y < OPEN.y0;
      if (!post && !cap) continue;
      const grain = noise(seed + 51, cap ? x : x * 3, cap ? y * 3 : y, 5);
      let c = mix(TIMBER_DARK, TIMBER_LIGHT, 0.25 + grain * 0.6);
      const edge = post ? (x === OPEN.x0 - 1 || x === OPEN.x1 || x === 0 || x === CHAMBER_W - 1) : y === OPEN.y0 - 1 || y === 0;
      if (edge) c = TIMBER_DARK;
      if (post && (x === 3 || x === CHAMBER_W - 4) && y % 29 === 14) c = 0x9a9ea6;
      if (cap && y === 5 && x % 37 === 18) c = 0x9a9ea6;
      // Lamplight from below on the posts, dimmer toward the cap.
      const light = 0.42 + 0.5 * (y / CHAMBER_H);
      px.set(x, y, shadeColor(c, light, true, x, y));
    }
  }
  // The shadow the cap throws on the rock just inside.
  for (let x = OPEN.x0; x < OPEN.x1; x++) {
    for (let y = OPEN.y0; y < OPEN.y0 + 2; y++) px.set(x, y, mix(px.get(x, y) < 0 ? 0 : px.get(x, y), 0x000000, 0.6));
  }
}

/** The room behind the doorway, everything but its ore and the eyes in it. */
export function paintChamber(spec: ChamberSpec): PixelBuffer {
  const { seed, lit, content } = spec;
  const cv: Canvas = { color: new Int32Array(CHAMBER_W * CHAMBER_H), region: new Uint8Array(CHAMBER_W * CHAMBER_H) };
  paintRock(cv, seed);
  if (content === 'ore' || content === 'empty') paintRails(cv);
  if (content === 'empty') {
    paintCart(cv, seed);
    paintRubble(cv, seed);
  }
  if (content === 'treasure') paintChest(cv, spec.resolved);
  if (content === 'enemies' && spec.resolved) paintRemains(cv, seed);
  if (content === 'enemies' && !spec.resolved) paintRubble(cv, seed + 1);
  if (content === 'shop') paintShop(cv);

  const px = new PixelBuffer(CHAMBER_W, CHAMBER_H);
  for (let y = 0; y < CHAMBER_H; y++) {
    for (let x = 0; x < CHAMBER_W; x++) {
      const i = y * CHAMBER_W + x;
      const region = cv.region[i] as Region;
      if (region === Region.Frame) continue;
      if (region === Region.Lamp) {
        px.set(x, y, cv.color[i]);
        continue;
      }
      let light = lampAt(lit, x, y) * FACING[region] + shopLamp(spec, x, y);
      // From the dark threshold a thing's edges catch what little light there is.
      if (!lit && region === Region.Prop) {
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const nx = x + dx;
          const ny = y + dy;
          return nx >= 0 && ny >= 0 && nx < CHAMBER_W && ny < CHAMBER_H && cv.region[ny * CHAMBER_W + nx] !== Region.Prop;
        });
        if (edge) light = Math.max(light, 0.32);
      }
      px.set(x, y, shadeColor(cv.color[i], light, lit, x, y));
    }
  }
  paintFrame(px, seed);
  return px;
}

// ---------------------------------------------------------------------------
//  ORE
// ---------------------------------------------------------------------------

interface OreLook {
  base: number;
  light: number;
  dark: number;
  /** Specks that catch the light. */
  shine: number;
  /** Copper's green bloom, iron's rust. */
  stain?: number;
}

const ORE_LOOK: Record<MineOreKind, OreLook> = {
  coal: { base: 0x3a3a46, light: 0x7a7a94, dark: 0x18181e, shine: 0xd8e2ff },
  copper: { base: 0xc06a32, light: 0xf0a060, dark: 0x6e3a1a, shine: 0xffd0a0, stain: 0x4aa888 },
  iron: { base: 0x8a5a44, light: 0xb88a70, dark: 0x4a2e22, shine: 0xe0e4ea, stain: 0xa04a2a },
  gold: { base: 0xd8a830, light: 0xffe070, dark: 0x8a6418, shine: 0xfff8d0 },
};

interface Nugget {
  cx: number;
  cy: number;
  points: [number, number][];
}

const veinSeed = (seed: number, slot: number): number => seed * 7 + slot * 131;

/** A vein's nuggets: angular lumps strung along a seam through the rock, the same every time for a seed. */
function veinNuggets(seed: number): Nugget[] {
  const nuggets: Nugget[] = [];
  const count = 5 + Math.floor(hash(seed, 1, 61) * 3);
  const tilt = (hash(seed, 2, 61) - 0.5) * 0.7;
  for (let k = 0; k < count; k++) {
    const along = (k / (count - 1)) * 2 - 1;
    const cx = VEIN_W / 2 + along * 12 + (hash(seed, k, 62) - 0.5) * 4;
    const cy = VEIN_H / 2 + along * 12 * tilt + (hash(seed, k, 63) - 0.5) * 6;
    const r = (Math.abs(along) < 0.35 ? 3.6 : 2.4) + hash(seed, k, 64) * 1.4;
    const turn = hash(seed, k, 65) * Math.PI;
    const points = Array.from({ length: 5 }, (_, j): [number, number] => {
      const a = turn + (j / 5) * Math.PI * 2;
      const rr = r * (0.75 + hash(seed, k * 7 + j, 66) * 0.45);
      return [cx + Math.cos(a) * rr * 1.2, cy + Math.sin(a) * rr];
    });
    nuggets.push({ cx, cy, points });
  }
  return nuggets;
}

function insidePolygon(points: readonly [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Points on the vein in `slot` (inside its box) that glint, for the views to sparkle. */
export function veinGlints(spec: ChamberSpec, slot: number): { x: number; y: number }[] {
  return veinNuggets(veinSeed(spec.seed, slot))
    .filter((_, k) => k % 2 === 0)
    .map((n) => ({ x: Math.round(n.cx - 1), y: Math.round(n.cy - 1) }));
}

/**
 * One vein, lit to match the chamber where it sits at `at`: intact ore, the hole
 * a mined vein leaves, or the rubble of one that came down.
 */
export function paintVein(ore: MineOreKind, state: VeinState, spec: ChamberSpec, at: { x: number; y: number }, slot: number): PixelBuffer {
  const look = ORE_LOOK[ore];
  const seed = veinSeed(spec.seed, slot);
  const px = new PixelBuffer(VEIN_W, VEIN_H);
  const nuggets = veinNuggets(seed);
  const lightOf = (x: number, y: number): number => lampAt(spec.lit, at.x + x, at.y + y) * 0.92;
  const nuggetAt = (x: number, y: number): number => nuggets.findIndex((n) => insidePolygon(n.points, x + 0.5, y + 0.5));
  const seamOf = (x: number, y: number): number => {
    const mx = (x + 0.5 - VEIN_W / 2) / 17;
    const my = (y + 0.5 - VEIN_H / 2) / 10;
    return mx * mx + my * my + (noise(seed, x, y, 3) - 0.5) * 0.45;
  };
  for (let y = 0; y < VEIN_H; y++) {
    for (let x = 0; x < VEIN_W; x++) {
      const gx = at.x + x;
      const gy = at.y + y;
      const seam = seamOf(x, y);
      const set = (color: number, light: number): void => px.set(x, y, shadeColor(color, light, spec.lit, gx, gy));
      if (state === 'collapsed') {
        // A heap of fallen rock where the ore was; scarred rock round it.
        const heap = Math.hypot((x + 0.5 - VEIN_W / 2) / 1.7, y + 0.5 - VEIN_H * 0.66) < 8.5 + hash(seed, x, y) * 2;
        if (heap) {
          const lump = hash(seed + 5, x >> 1, y >> 1);
          const top = hash(seed + 5, x >> 1, (y - 1) >> 1) !== lump && y % 2 === 0;
          set(mix(ROCK_DARK, ROCK_LIGHT, 0.25 + lump * 0.5 + (top ? 0.2 : 0)), lightOf(x, y));
        } else if (seam < 1) {
          set(mix(ROCK_DARK, 0x000000, 0.35), lightOf(x, y));
        }
        continue;
      }
      if (seam >= 1) continue;
      const k = nuggetAt(x, y);
      if (state === 'mined') {
        // The hole the ore came out of: dark inside, rough at the rim, a fleck left behind.
        const inner = seam < 0.55;
        const fleck = k >= 0 && hash(seed, x, y) > 0.88;
        set(fleck ? look.dark : inner ? 0x120e0b : mix(ROCK_DARK, 0x000000, 0.2), lightOf(x, y) * (inner ? 0.5 : 0.85));
        continue;
      }
      if (k < 0) {
        // The seam itself: darker rock, stained by the ore it carries.
        const stained = look.stain != null && hash(seed + 9, x, y) > 0.86;
        set(stained ? mix(ROCK_DARK, look.stain!, 0.6) : mix(ROCK_DARK, look.dark, 0.3), lightOf(x, y) * 0.9);
        continue;
      }
      const n = nuggets[k];
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => nuggetAt(x + dx, y + dy) !== k);
      const facing = x + 0.5 - n.cx + (y + 0.5 - n.cy);
      let color = edge ? look.dark : facing < -1.2 ? look.light : facing > 1.2 ? mix(look.base, look.dark, 0.5) : look.base;
      let light = lightOf(x, y);
      if (!spec.lit) {
        // From the dark, only an ore's rims show, faintly, in its own colour.
        light = edge ? Math.max(light, 0.55) : Math.max(light, 0.18);
        if (edge) color = look.light;
      }
      set(color, light);
    }
  }
  if (state === 'intact') {
    for (const g of veinGlints(spec, slot)) px.set(g.x, g.y, look.shine);
  }
  return px;
}
