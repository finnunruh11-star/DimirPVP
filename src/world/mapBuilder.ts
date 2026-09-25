// A small drafting table for authored maps: fill rectangles, draw lines and
// sprinkle decoration with a fixed hash, then hand the rows to a LocaleDef.
// Authoring with coordinates keeps big maps readable and diffable.

import { cellHash } from './kenney';

export class MapBuilder {
  private readonly rows: string[][];

  constructor(readonly w: number, readonly h: number, fill = '.') {
    this.rows = Array.from({ length: h }, () => Array.from({ length: w }, () => fill));
  }

  get(x: number, y: number): string {
    return this.rows[y]?.[x] ?? '';
  }

  set(x: number, y: number, ch: string): this {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.rows[y][x] = ch;
    return this;
  }

  fill(x: number, y: number, w: number, h: number, ch: string): this {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, ch);
    return this;
  }

  /** One-tile outline of a rectangle. */
  ring(x: number, y: number, w: number, h: number, ch: string): this {
    for (let xx = x; xx < x + w; xx++) this.set(xx, y, ch).set(xx, y + h - 1, ch);
    for (let yy = y; yy < y + h; yy++) this.set(x, yy, ch).set(x + w - 1, yy, ch);
    return this;
  }

  /** Paste literal rows with their top-left at x, y; spaces are skipped. */
  paste(x: number, y: number, rows: readonly string[]): this {
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) if (row[dx] !== ' ') this.set(x + dx, y + dy, row[dx]);
    });
    return this;
  }

  /**
   * Sprinkle `chars` over cells currently holding `on`, at `density` (0-1).
   * Deterministic: the same salt always lays the same pattern.
   */
  scatter(x: number, y: number, w: number, h: number, chars: string, density: number, salt: number, on = '.'): this {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      if (this.get(xx, yy) !== on) continue;
      const roll = cellHash(xx, yy, salt);
      if ((roll % 1000) / 1000 >= density) continue;
      this.set(xx, yy, chars[(roll >>> 10) % chars.length]);
    }
    return this;
  }

  /** Put `ch` on every other cell along a horizontal or vertical run. */
  dotted(x: number, y: number, length: number, ch: string, vertical = false, step = 2, on = '.'): this {
    for (let i = 0; i < length; i++) {
      if (i % step) continue;
      const xx = vertical ? x : x + i;
      const yy = vertical ? y + i : y;
      if (this.get(xx, yy) === on) this.set(xx, yy, ch);
    }
    return this;
  }

  /** Clear scattered decoration (anything but ground, paths, water and walls) from a rectangle. */
  clearDecor(x: number, y: number, w: number, h: number, ground = '.'): this {
    const keep = '.,=:#;_~oHILJKMXWF';
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      if (!keep.includes(this.get(xx, yy))) this.set(xx, yy, ground);
    }
    return this;
  }

  build(): string[] {
    return this.rows.map((row) => row.join(''));
  }
}
