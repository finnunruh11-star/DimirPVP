// A tiny pure pixel canvas. Buildings, props and people are painted into one of
// these and only then copied into a Phaser texture, so the art can be built and
// checked in a plain test without a browser.

export type Palette = Readonly<Record<string, number>>;

export class PixelBuffer {
  readonly data: Int32Array;

  constructor(readonly w: number, readonly h: number) {
    this.data = new Int32Array(w * h).fill(-1);
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): number {
    return this.inside(x, y) ? this.data[y * this.w + x] : -1;
  }

  set(x: number, y: number, color: number): void {
    if (this.inside(x, y)) this.data[(y | 0) * this.w + (x | 0)] = color;
  }

  rect(x: number, y: number, w: number, h: number, color: number): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, color);
  }

  hline(x: number, y: number, w: number, color: number): void {
    this.rect(x, y, w, 1, color);
  }

  vline(x: number, y: number, h: number, color: number): void {
    this.rect(x, y, 1, h, color);
  }

  /** Outline a rectangle one pixel thick. */
  frame(x: number, y: number, w: number, h: number, color: number): void {
    this.hline(x, y, w, color);
    this.hline(x, y + h - 1, w, color);
    this.vline(x, y, h, color);
    this.vline(x + w - 1, y, h, color);
  }

  /** Paint ASCII rows; characters missing from the palette are transparent. */
  blit(rows: readonly string[], palette: Palette, x: number, y: number, flipX = false): void {
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) {
        const color = palette[row[dx]];
        if (color == null) continue;
        this.set(flipX ? x + row.length - 1 - dx : x + dx, y + dy, color);
      }
    });
  }

  /** Copy another buffer on top of this one. */
  stamp(src: PixelBuffer, x: number, y: number): void {
    for (let yy = 0; yy < src.h; yy++) {
      for (let xx = 0; xx < src.w; xx++) {
        const c = src.data[yy * src.w + xx];
        if (c >= 0) this.set(x + xx, y + yy, c);
      }
    }
  }

  /** Recolour every pixel matching `from`. */
  replace(from: number, to: number): void {
    for (let i = 0; i < this.data.length; i++) if (this.data[i] === from) this.data[i] = to;
  }

  /** Surround opaque pixels with a one-pixel line where they meet transparency. */
  outline(color: number): void {
    const edge: number[] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y) >= 0) continue;
        if (this.get(x - 1, y) >= 0 || this.get(x + 1, y) >= 0 || this.get(x, y - 1) >= 0 || this.get(x, y + 1) >= 0) {
          edge.push(y * this.w + x);
        }
      }
    }
    for (const i of edge) this.data[i] = color;
  }
}

/** Mix two colours; `t` = 0 keeps `a`, 1 gives `b`. */
export function mix(a: number, b: number, t: number): number {
  const ch = (shift: number): number =>
    Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t) & 255;
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export const shade = (c: number, t: number): number => mix(c, 0x000000, t);
export const tint = (c: number, t: number): number => mix(c, 0xffffff, t);

/** A shaded material: three tones from one base colour. */
export interface Tones {
  base: number;
  dark: number;
  light: number;
  deep: number;
}

export function tones(base: number): Tones {
  return { base, dark: shade(base, 0.28), light: tint(base, 0.22), deep: shade(base, 0.5) };
}
