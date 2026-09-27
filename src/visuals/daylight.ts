// The colour of the hour: the sky the time wheel paints and the light laid over
// the travel map. Presentation only; the rules' own day and night are in clock.ts.

type ColorKey = readonly [hour: number, color: number];
type ShadeKey = readonly [hour: number, color: number, alpha: number];
type LevelKey = readonly [hour: number, level: number];

const SKY: readonly ColorKey[] = [
  [0, 0x070a1c], [3.5, 0x0b1030], [4.75, 0x221a48], [5.5, 0x5e3262], [6.1, 0xd9774a],
  [7, 0xf2b75e], [9, 0xf8d77a], [12, 0xffe68c], [15.5, 0xf8d472], [17.5, 0xf0a050],
  [18.6, 0xd96a3e], [19.4, 0x8e3a4e], [20, 0x3d2352], [21, 0x141436], [24, 0x070a1c],
];

/** Warm at dawn and dusk, clear by day, deep blue by night. */
const SHADE: readonly ShadeKey[] = [
  [0, 0x0a1030, 0.46], [4.6, 0x0a1030, 0.46], [5.4, 0x2a2050, 0.38], [6.1, 0x8a4a62, 0.24],
  [7, 0xffb070, 0.1], [8.2, 0xffd090, 0], [16.2, 0xffc070, 0], [17.4, 0xffa050, 0.1],
  [18.6, 0xff7040, 0.18], [19.4, 0x8a3a5a, 0.28], [20.2, 0x2a2050, 0.38], [21, 0x0a1030, 0.46],
  [24, 0x0a1030, 0.46],
];

const DARK: readonly LevelKey[] = [[0, 1], [4.6, 1], [6.4, 0], [18.4, 0], [20.6, 1], [24, 1]];

const wrap = (hour: number): number => ((hour % 24) + 24) % 24;

/** The two keys either side of `hour` and how far along it is between them. */
function around<K extends readonly [number, ...number[]]>(keys: readonly K[], hour: number): [K, K, number] {
  const h = wrap(hour);
  for (let i = 1; i < keys.length; i++) {
    if (h <= keys[i][0]) {
      const span = keys[i][0] - keys[i - 1][0];
      return [keys[i - 1], keys[i], span > 0 ? (h - keys[i - 1][0]) / span : 0];
    }
  }
  const last = keys[keys.length - 1];
  return [last, last, 0];
}

export function mixColor(a: number, b: number, t: number): number {
  const channel = (shift: number): number => {
    const from = (a >> shift) & 255;
    return Math.round(from + (((b >> shift) & 255) - from) * t) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}

export function cssColor(color: number, alpha = 1): string {
  return `rgba(${(color >> 16) & 255},${(color >> 8) & 255},${color & 255},${alpha})`;
}

export function skyColor(hour: number): number {
  const [a, b, t] = around(SKY, hour);
  return mixColor(a[1], b[1], t);
}

export function mapShade(hour: number): { color: number; alpha: number } {
  const [a, b, t] = around(SHADE, hour);
  return { color: mixColor(a[1], b[1], t), alpha: a[2] + (b[2] - a[2]) * t };
}

/** 0 by full day, 1 by full night, easing through dawn and dusk. */
export function darkness(hour: number): number {
  const [a, b, t] = around(DARK, hour);
  return a[1] + (b[1] - a[1]) * t;
}
