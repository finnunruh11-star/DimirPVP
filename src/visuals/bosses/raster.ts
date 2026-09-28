// A small procedural pixel-art rasteriser for the bloodmoon bosses. Shapes are
// lit as solids (spheres, tubes, tilted planes) from the upper left, stepped
// into hand-picked colour ramps with a light ordered dither at each step, and
// every part can be drawn on a layer of its own so it gets a dark edge where it
// overlaps what is behind it. Pure: no Phaser, so frames can be checked headless.

import { mix, PixelBuffer } from '../../world/pixels';

/** Dark to light. */
export type Ramp = readonly number[];
export type Pt = readonly [number, number];
/** x, y and radius along a tube. */
export type Knot = readonly [number, number, number];

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const LX = -0.5;
const LY = -0.72;
const LZ = 0.48;
const LN = Math.hypot(LX, LY, LZ);
const L = [LX / LN, LY / LN, LZ / LN] as const;

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const TAU = Math.PI * 2;

/** Brightness of a surface with normal (nx, ny, nz). */
export function lit(nx: number, ny: number, nz: number, ambient = 0.16): number {
  const d = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
  return clamp01(ambient + (1 - ambient) * d + 0.22 * d ** 10);
}

export function lighten(color: number, t: number): number {
  return mix(color, 0xffffff, t);
}

export function darken(color: number, t: number): number {
  return mix(color, 0x000000, t);
}

/** A deterministic 0..1 hash of a lattice point. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise, 0..1. */
export function noise2(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}

export function rotate(x: number, y: number, cx: number, cy: number, angle: number): [number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

/** Ease helpers for poses: 0..1 in, 0..1 out. */
export const ease = {
  inOut: (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  out: (t: number): number => 1 - (1 - t) ** 3,
  in: (t: number): number => t * t * t,
  back: (t: number): number => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2,
};

/** Where `t` sits inside [a, b], clamped to 0..1. */
export const span = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a));

export type ShadeFn = (x: number, y: number) => number;

export class Canvas {
  readonly px: PixelBuffer;
  /** Light from behind and to the right (the bloodmoon), caught on the far edges of lit shapes. */
  rim: { color: number; strength: number } | null = null;

  constructor(readonly w: number, readonly h: number) {
    this.px = new PixelBuffer(w, h);
  }

  /** Lay the rim light over a lit colour whose surface faces (nx, ny, nz). */
  rimmed(color: number, nx: number, ny: number, nz: number): number {
    const rim = this.rim;
    if (!rim) return color;
    const k = clamp01((nx * 0.85 + ny * 0.15 - nz * 0.9 - 0.12) * 2.4) * rim.strength;
    return k > 0.08 ? mix(color, rim.color, Math.min(0.85, k)) : color;
  }

  /** The ramp colour for brightness `v` at pixel (x, y), dithered where it falls between two steps. */
  pick(ramp: Ramp, v: number, x: number, y: number, dither = 0.55): number {
    const n = ramp.length;
    const t = clamp01(v) * (n - 1);
    const base = Math.floor(t);
    const frac = t - base;
    const threshold = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
    const index = frac > 0.5 + (threshold - 0.5) * dither ? base + 1 : base;
    return ramp[Math.min(n - 1, index)];
  }

  dot(x: number, y: number, color: number): void {
    this.px.set(Math.round(x), Math.round(y), color);
  }

  rect(x: number, y: number, w: number, h: number, color: number): void {
    this.px.rect(Math.round(x), Math.round(y), Math.round(w), Math.round(h), color);
  }

  line(x0: number, y0: number, x1: number, y1: number, color: number, width = 1): void {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.5));
    const r = (width - 1) / 2;
    for (let i = 0; i <= steps; i++) {
      const x = lerp(x0, x1, i / steps);
      const y = lerp(y0, y1, i / steps);
      if (r <= 0) this.dot(x, y, color);
      else this.px.rect(Math.round(x - r), Math.round(y - r), Math.round(width), Math.round(width), color);
    }
  }

  /** A shaded ellipse, lit as a squashed sphere; `rot` turns it about its centre. */
  ellipse(cx: number, cy: number, rx: number, ry: number, ramp: Ramp, opts: { rot?: number; shade?: number; flat?: boolean } = {}): void {
    const rot = opts.rot ?? 0;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const reach = Math.max(rx, ry) + 1;
    for (let y = Math.floor(cy - reach); y <= Math.ceil(cy + reach); y++) {
      for (let x = Math.floor(cx - reach); x <= Math.ceil(cx + reach); x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const u = (dx * c + dy * s) / rx;
        const v = (-dx * s + dy * c) / ry;
        const d2 = u * u + v * v;
        if (d2 > 1) continue;
        const nx = u * c - v * s;
        const ny = u * s + v * c;
        const nz = Math.sqrt(1 - d2);
        const light = opts.flat ? 0.5 : lit(nx, ny, nz);
        this.px.set(x, y, this.rimmed(this.pick(ramp, light + (opts.shade ?? 0), x, y), nx, ny, nz));
      }
    }
  }

  /** A shaded tube through `knots`, each with its own radius: limbs, necks, tails, horns. */
  tube(knots: readonly Knot[], ramp: Ramp, opts: { shade?: number; flatten?: number } = {}): void {
    if (knots.length === 1) {
      const [x, y, r] = knots[0];
      this.ellipse(x, y, r, r, ramp, { shade: opts.shade });
      return;
    }
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y, r] of knots) {
      x0 = Math.min(x0, x - r - 1);
      y0 = Math.min(y0, y - r - 1);
      x1 = Math.max(x1, x + r + 1);
      y1 = Math.max(y1, y + r + 1);
    }
    const flatten = opts.flatten ?? 1;
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        let best = Infinity;
        let bx = 0;
        let by = 0;
        let br = 1;
        for (let i = 0; i < knots.length - 1; i++) {
          const [ax, ay, ar] = knots[i];
          const [cx, cy, cr] = knots[i + 1];
          const ex = cx - ax;
          const ey = cy - ay;
          const len2 = ex * ex + ey * ey || 1;
          const t = clamp01(((px - ax) * ex + (py - ay) * ey) / len2);
          const qx = ax + ex * t;
          const qy = ay + ey * t;
          const r = lerp(ar, cr, t);
          const d = Math.hypot(px - qx, py - qy) - r;
          if (d < best) {
            best = d;
            bx = qx;
            by = qy;
            br = r;
          }
        }
        if (best > 0) continue;
        const nx = (px - bx) / Math.max(0.5, br);
        const ny = (py - by) / Math.max(0.5, br);
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * flatten;
        this.px.set(x, y, this.rimmed(this.pick(ramp, lit(nx, ny, nz) + (opts.shade ?? 0), x, y), nx, ny, nz));
      }
    }
  }

  /** A filled polygon; `shade` is a flat brightness or one per pixel. */
  poly(points: readonly Pt[], ramp: Ramp, shade: number | ShadeFn = 0.55): void {
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const [, y] of points) {
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      const sy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [ax, ay] = points[i];
        const [bx, by] = points[(i + 1) % points.length];
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil(xs[k] - 0.5); x <= Math.floor(xs[k + 1] - 0.5); x++) {
          const v = typeof shade === 'number' ? shade : shade(x, y);
          this.px.set(x, y, this.pick(ramp, v, x, y));
        }
      }
    }
  }

  /** Draw `paint` on a layer of its own, edge it, and lay it over what is here. */
  layer(paint: (c: Canvas) => void, edge: number | null = null, inner = 0.55): void {
    const part = new Canvas(this.w, this.h);
    part.rim = this.rim;
    paint(part);
    part.edge(edge, inner);
    this.px.stamp(part.px, 0, 0);
  }

  /**
   * Edge the drawn shape: each empty pixel beside it takes `ink`, or with no ink
   * a darkened copy of its neighbour (a selective outline, softer inside a figure).
   */
  edge(ink: number | null, inner = 0.55): void {
    const { w, h, data } = this.px;
    const out: [number, number][] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[y * w + x] >= 0) continue;
        let near = -1;
        if (x > 0 && data[y * w + x - 1] >= 0) near = data[y * w + x - 1];
        else if (x < w - 1 && data[y * w + x + 1] >= 0) near = data[y * w + x + 1];
        else if (y > 0 && data[(y - 1) * w + x] >= 0) near = data[(y - 1) * w + x];
        else if (y < h - 1 && data[(y + 1) * w + x] >= 0) near = data[(y + 1) * w + x];
        if (near >= 0) out.push([y * w + x, ink ?? darken(near, inner)]);
      }
    }
    for (const [index, color] of out) data[index] = color;
  }

  /** Recolour every drawn pixel. */
  map(fn: (color: number, x: number, y: number) => number): void {
    const { w, data } = this.px;
    for (let i = 0; i < data.length; i++) if (data[i] >= 0) data[i] = fn(data[i], i % w, Math.floor(i / w));
  }

  /** Crumble away `amount` (0..1) of the figure, highest pixels first when `rising`; edges left behind glow `ember`. */
  dissolve(amount: number, seed: number, ember: number, rising = true): void {
    if (amount <= 0) return;
    const { w, h, data } = this.px;
    let top = h;
    let bottom = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] < 0) continue;
      const y = Math.floor(i / w);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    const height = Math.max(1, bottom - top);
    const gone = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      if (data[i] < 0) continue;
      const x = i % w;
      const y = Math.floor(i / w);
      const bias = rising ? (bottom - y) / height : (y - top) / height;
      const n = hash2(x, y, seed) * 0.45 + noise2(x / 5, y / 5, seed) * 0.55;
      if (n * 0.6 + bias * 0.4 < amount * 1.05) gone[i] = 1;
    }
    for (let i = 0; i < data.length; i++) {
      if (!gone[i]) continue;
      data[i] = -1;
    }
    for (let i = 0; i < data.length; i++) {
      if (data[i] < 0) continue;
      const x = i % w;
      const y = Math.floor(i / w);
      const open = (x > 0 && gone[i - 1]) || (x < w - 1 && gone[i + 1]) || (y > 0 && gone[i - w]) || (y < h - 1 && gone[i + w]);
      if (open && hash2(x, y, seed + 7) < 0.7) data[i] = ember;
    }
  }

  /** Stamp another canvas on this one, shifted. */
  paste(src: Canvas, dx = 0, dy = 0): void {
    this.px.stamp(src.px, Math.round(dx), Math.round(dy));
  }
}

/** Frames laid out left to right in one buffer. */
export function strip(frames: readonly Canvas[]): PixelBuffer {
  const w = frames[0]?.w ?? 1;
  const h = frames[0]?.h ?? 1;
  const out = new PixelBuffer(w * Math.max(1, frames.length), h);
  frames.forEach((frame, index) => out.stamp(frame.px, index * w, 0));
  return out;
}
