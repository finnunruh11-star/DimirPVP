// Hand-pixelled parts for the 32x32 bosses: parts are typed in as rows of
// characters, placed at whole pixels, turned only by quarter turns, and each
// drawn on a layer of its own so it gets an ink outline where it overlaps what
// is behind it. Nothing is ever resampled, so every pixel stays square. Pure.

import { Canvas } from './raster';

export type Palette = Readonly<Record<string, number>>;

export interface Sprite {
  w: number;
  h: number;
  /** Row-major colours, -1 for empty. */
  px: Int32Array;
  /** The pixel that lands on the point it is placed at (a grip, a neck). */
  ax: number;
  ay: number;
}

/** A sprite from rows of characters; characters missing from the palette are empty. */
export function sprite(rows: readonly string[], pal: Palette, anchor: readonly [number, number] = [0, 0]): Sprite {
  const h = rows.length;
  const w = Math.max(...rows.map((row) => row.length));
  const px = new Int32Array(w * h).fill(-1);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = pal[row[x]];
      if (color != null) px[y * w + x] = color;
    }
  });
  return { w, h, px, ax: anchor[0], ay: anchor[1] };
}

/** Mirrored left to right. */
export function mirror(s: Sprite): Sprite {
  const px = new Int32Array(s.w * s.h);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) px[y * s.w + (s.w - 1 - x)] = s.px[y * s.w + x];
  return { w: s.w, h: s.h, px, ax: s.w - 1 - s.ax, ay: s.ay };
}

/** Turned clockwise by `quarters` quarter turns (negative turns the other way). */
export function turn(s: Sprite, quarters: number): Sprite {
  let out = s;
  for (let k = 0; k < (((quarters % 4) + 4) % 4); k++) {
    const src = out;
    const px = new Int32Array(src.w * src.h);
    // Clockwise: (x, y) -> (h - 1 - y, x).
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) px[x * src.h + (src.h - 1 - y)] = src.px[y * src.w + x];
    out = { w: src.h, h: src.w, px, ax: src.h - 1 - src.ay, ay: src.ax };
  }
  return out;
}

/** Stamp a sprite so its anchor lands on (x, y). */
export function put(c: Canvas, s: Sprite, x: number, y: number): void {
  const ox = Math.round(x) - s.ax;
  const oy = Math.round(y) - s.ay;
  for (let yy = 0; yy < s.h; yy++) {
    for (let xx = 0; xx < s.w; xx++) {
      const color = s.px[yy * s.w + xx];
      if (color >= 0) c.px.set(ox + xx, oy + yy, color);
    }
  }
}

/** Draw on a layer of its own, outlined in `ink`, over what is here. */
export function inked(c: Canvas, ink: number, paint: (part: Canvas) => void): void {
  c.layer(paint, ink);
}

/** A straight run of pixels between two whole-pixel points, `width` pixels thick. */
export function bar(c: Canvas, x0: number, y0: number, x1: number, y1: number, color: number, width = 1): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const ex = Math.round(x1);
  const ey = Math.round(y1);
  const dx = Math.abs(ex - x);
  const dy = -Math.abs(ey - y);
  const sx = x < ex ? 1 : -1;
  const sy = y < ey ? 1 : -1;
  let err = dx + dy;
  const lo = -Math.floor((width - 1) / 2);
  for (;;) {
    for (let oy = 0; oy < width; oy++) for (let ox = 0; ox < width; ox++) c.px.set(x + lo + ox, y + lo + oy, color);
    if (x === ex && y === ey) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** A finished figure turned by quarter turns about (px, py), for bodies that fall over. */
export function turnCanvas(src: Canvas, quarters: number, px: number, py: number): Canvas {
  const out = new Canvas(src.w, src.h);
  const q = ((quarters % 4) + 4) % 4;
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const color = src.px.get(x, y);
      if (color < 0) continue;
      const dx = x - px;
      const dy = y - py;
      const [rx, ry] = q === 1 ? [-dy, dx] : q === 2 ? [-dx, -dy] : q === 3 ? [dy, -dx] : [dx, dy];
      out.px.set(px + rx, py + ry, color);
    }
  }
  return out;
}

/** Frame `f` of a keyed table: holds the last key past the end. */
export function key<T>(table: readonly T[], f: number): T {
  return table[Math.min(table.length - 1, Math.max(0, f))];
}
