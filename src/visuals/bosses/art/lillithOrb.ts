// Lillith Belvus's Binding Orb as 32x32 pixel art (see ../pixel): a dark orb
// over its own shadow, chained to the ground, a heart beating in it. Lillith
// herself wears authored sheets (see ../authored).

import type { BossAnim, BossArt } from '../rig';
import type { Canvas, Pt } from '../raster';
import { bar, inked, key, put, sprite, type Palette, type Sprite } from '../pixel';

const SIZE = 32;
const FLOOR = 31;
const INK = 0x0d0812;

const PAL: Palette = {
  k: INK,
  G: 0x7a4aa6, g: 0x55307a, h: 0x351d50, H: 0x200f33,
  T: 0xd2a8ff, t: 0x9a6fd0,
  E: 0xffffff,
  C: 0xff86e0, c: 0xb04aa0,
};
const S = (rows: readonly string[], anchor: readonly [number, number] = [0, 0]): Sprite => sprite(rows, PAL, anchor);

const FRAMES: Record<BossAnim, number> = { idle: 12, walk: 6, attack: 8, hurt: 4, death: 10 };

const ORB = S([
  '...hhhhh...',
  '..hgggggh..',
  '.hgGGGGggh.',
  'hgGTTGGGggh',
  'hgGTGGGGggh',
  'hgGGGGGGggh',
  'hgGGGGGGggh',
  'hggGGGGGggh',
  '.hggGGGggh.',
  '..hgggggh..',
  '...hhhhh...',
]);
const CORE = [S(['.c.', 'cCc', '.c.'], [1, 1]), S(['.C.', 'CEC', '.C.'], [1, 1])];
const SHADOW = S(['.HHHHHHH.', 'HHHHHHHHH']);
/** Twelve stops round the rune ring's ellipse, one a frame. */
const RING: readonly Pt[] = Array.from({ length: 12 }, (_, i) => [Math.round(-8 * Math.cos((i / 12) * Math.PI * 2)), Math.round(2 * Math.sin((i / 12) * Math.PI * 2))] as Pt);

interface OrbPose {
  bob: number;
  spin: number;
  hot: 0 | 1;
  flare: number;
  crack: boolean;
}

function orbFigure(c: Canvas, q: OrbPose): void {
  put(c, SHADOW, 12, FLOOR - 2);
  const top: Pt = [11, 7 + q.bob];
  const centre: Pt = [top[0] + 5, top[1] + 5];
  // Chains down to the ground.
  for (const x of [13, 19]) {
    for (let y = top[1] + 10; y < FLOOR - 2; y++) c.px.set(x + ((y >> 1) % 2 ? 0 : x < 16 ? -1 : 1), y, (y >> 1) % 2 ? PAL.t : PAL.h);
  }
  const dots = [q.spin % 12, (q.spin + 6) % 12].map((i) => RING[i]);
  const rune = (d: Pt): void => c.px.set(centre[0] + d[0], centre[1] + 4 + d[1], PAL.T);
  for (const d of dots) if (d[1] < 0) rune(d);
  inked(c, INK, (p) => put(p, ORB, ...top));
  put(c, CORE[q.hot], ...centre);
  if (q.crack) {
    bar(c, centre[0] + 1, top[1] + 1, centre[0] - 1, centre[1] - 2, INK);
    bar(c, centre[0] + 2, centre[1] + 2, centre[0] + 1, centre[1] + 4, INK);
  }
  for (const d of dots) if (d[1] >= 0) rune(d);
  if (q.flare) {
    const r = q.flare + 6;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [-0.7, -0.7], [0.7, -0.7]] as const) {
      const x = Math.round(centre[0] + dx * r);
      const y = Math.round(centre[1] + dy * r);
      bar(c, x, y, Math.round(x + dx * 2), Math.round(y + dy * 2), q.flare > 2 ? PAL.C : PAL.E);
    }
  }
}

const ORB_IDLE: OrbPose[] = Array.from({ length: 12 }, (_, f) => ({
  bob: [0, 0, -1, -1, -1, 0, 0, 0, 1, 1, 1, 0][f],
  spin: f,
  hot: (f % 6 < 3 ? 1 : 0) as 0 | 1,
  flare: 0,
  crack: false,
}));

export const lillithOrb: BossArt = {
  w: SIZE,
  h: SIZE,
  pixel: 3,
  ground: FLOOR,
  outlined: true,
  flash: 0xffffff,
  frames: FRAMES,
  rate: { idle: 7, walk: 7, attack: 12, hurt: 10, death: 10 },
  ink: INK,
  ember: 0xd2a8ff,
  draw(c, p) {
    if (p.anim === 'idle' || p.anim === 'walk') return orbFigure(c, ORB_IDLE[p.f % ORB_IDLE.length]);
    if (p.anim === 'attack') return orbFigure(c, { bob: key([0, -1, -2, -2, -1, 0, 0, 0], p.f), spin: p.f, hot: 1, flare: key([0, 0, 1, 2, 3, 0, 0, 0], p.f), crack: false });
    if (p.anim === 'hurt') return orbFigure(c, { bob: key([1, 1, 0, 0], p.f), spin: 0, hot: 0, flare: 0, crack: true });
    return orbFigure(c, { bob: Math.min(2, p.f), spin: 0, hot: 0, flare: 0, crack: true });
  },
};
