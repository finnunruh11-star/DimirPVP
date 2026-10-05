// Baral, Artificer of Nope, and what he builds, as 32x32 pixel art (see
// ../pixel): a stiff old inventor in a blue tailcoat and a stovepipe hat, a
// boiler on his back and a lightning rod in his fist; a wind-up brass drake;
// and the crystal Artifact of Denial. Parts move by whole pixels only, keyed
// frame by frame, and every attack and hurt starts and ends on the idle pose.
// Every figure faces left.

import type { BossAnim, BossArt, Pose } from '../rig';
import { Canvas, type Pt } from '../raster';
import { bar, inked, key, mirror, put, sprite, turn, turnCanvas, type Palette, type Sprite } from '../pixel';

const SIZE = 32;
const FLOOR = 31;
const INK = 0x0c0e14;

const PAL: Palette = {
  k: INK,
  Q: 0x6d9ce2, C: 0x3a6ec4, c: 0x264a8a, q: 0x1a3262,
  X: 0x4a4e5e, K: 0x2a2d38, x: 0x1a1c24,
  S: 0xf2cdae, s: 0xc99b7c,
  W: 0xf6f6f2, w: 0xbfc3cc,
  Y: 0xfff0b0, A: 0xe3aa3f, a: 0xa06c1e, b: 0x6a4410,
  E: 0xffffff, Z: 0x7ae8ff, z: 0x2aa0d8,
  V: 0xdfe4ec, v: 0xa7afbd,
  R: 0xd84a3a,
};
const FAR: Palette = { ...PAL, Q: PAL.C, C: PAL.c, c: PAL.q, X: PAL.K, K: PAL.x, A: PAL.a, a: PAL.b, W: PAL.w };
const S = (rows: readonly string[], anchor: readonly [number, number] = [0, 0], pal: Palette = PAL): Sprite => sprite(rows, pal, anchor);

const FRAMES: Record<BossAnim, number> = { idle: 12, walk: 6, attack: 8, hurt: 4, death: 10 };

/** Lay a finished upright figure on its side, top to the right, resting on the floor. */
function lay(c: Canvas, figure: Canvas, centre: number, lift: number, quarters = 1): void {
  const turned = turnCanvas(figure, quarters, SIZE / 2, SIZE / 2);
  let x0 = SIZE;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (turned.px.get(x, y) < 0) continue;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  c.paste(turned, centre - Math.round((x0 + x1) / 2), FLOOR - y1 - lift);
}

function art(draw: (c: Canvas, p: Pose) => void, rate: Record<BossAnim, number>, ember: number): BossArt {
  return { w: SIZE, h: SIZE, pixel: 3, ground: FLOOR, outlined: true, crumble: false, flash: 0xffffff, frames: FRAMES, rate, ink: INK, ember, draw };
}

/** A crisp zig-zag of lightning through whole-pixel points. */
function zap(c: Canvas, points: readonly Pt[]): void {
  for (let i = 1; i < points.length; i++) bar(c, ...points[i - 1], ...points[i], PAL.Z, 2);
  for (let i = 1; i < points.length; i++) bar(c, ...points[i - 1], ...points[i], PAL.E);
}

// ---------------------------------------------------------------------------
//  BARAL
// ---------------------------------------------------------------------------

const FACE = S([
  '..SSSSSS..',
  '.SSSSSSSs.',
  'SSSSSSSSss',
  'SSSSSSSSss',
  'SSSSSSSSss',
  'SSSSSSSSss',
  '.SSSSSSSs.',
  '.SSSSSSSs.',
  '..SSSSSs..',
  '...ssss...',
]);
const NOSE = S(['..SS', 'SSSs', '..s.']);
const MOUSTACHE = S(['W.........W', 'WWWWW.WWWWW', '.wWWw.wWWw.']);
const HAT = S([
  '...XKKKKKx..',
  '...XKKKKKx..',
  '...XKKKKKx..',
  '...XKKKKKx..',
  '...aAAYAAa..',
  '...XKKKKKx..',
  '.XKKKKKKKKKx',
  '..xxxxxxxxx.',
]);
const MONOCLE = S(['.AA.', 'AZZA', 'AZzA', '.AA.']);
const MONOCLE_GLINT = S(['.AA.', 'AEZA', 'AZzA', '.AA.']);
const COAT = S([
  '..QCCCCc..',
  '.QCCWCCcc.',
  'QCCCWCCccc',
  'QCCAWACccc',
  'QCCCCCCccc',
  'QCCACCCccc',
  'QCCCCCCccc',
  'QCCACCCccc',
  'QCCCCCCccc',
  'QCCCCCccc.',
  'QCCCCCccc.',
  '.CCc.Ccc..',
]);
const TAILS = [
  S(['Ccc', 'Cccc', 'Cccc', 'Ccccc', 'Cccc.', 'Cc.c.']),
  S(['Ccc', 'Cccc', 'Ccccc', 'Ccccc', '.Cccc', '.Cc.c']),
];
const BOILER = S(['.aAa.', 'aAYAa', 'aAAAa', 'akZka', 'aAAAa', 'aAAAa', 'aAAAa', 'aAAAa', '.aaa.']);
const BOOT: [Sprite, Sprite] = [S(['..KK', 'AKKK'], [2, 0], FAR), S(['..KK', 'AKKK'], [2, 0])];
const GLOVE: [Sprite, Sprite] = [S(['WW', 'Ww'], [0, 0], FAR), S(['WW', 'Ww'])];
const WAG = S(['W.', 'WW', 'Ww']);
const ORB = S(['.Z.', 'ZEZ', '.Z.']);
const ORB_HOT = S(['.ZZ.', 'ZEEZ', 'ZEEZ', '.ZZ.']);

type BEyes = 'open' | 'blink' | 'wide' | 'dead';

interface BaralPose {
  bx: number;
  by: number;
  hx: number;
  hy: number;
  /** The hat's own lag, or its jump off the head. */
  hatx: number;
  haty: number;
  eyes: BEyes;
  /** Mouth open under the moustache. */
  open: boolean;
  /** The monocle: 0 in, 1 glinting, 2 popped out. */
  mono: 0 | 1 | 2;
  /** Hands from rest, feet along the ground and lift. */
  fh: Pt;
  nh: Pt;
  ff: Pt;
  nf: Pt;
  /** The near hand wags a finger. */
  wag: boolean;
  /** Staff tip: 0 upright, 1 tipped at the foe. */
  aim: 0 | 1;
  orb: 0 | 1;
  bolt: 0 | 1 | 2;
  tail: 0 | 1;
  steam: number;
  spark: boolean;
}

const REST: BaralPose = {
  bx: 0, by: 0, hx: 0, hy: 0, hatx: 0, haty: 0, eyes: 'open', open: false, mono: 0,
  fh: [0, 0], nh: [0, 0], ff: [0, 0], nf: [0, 0], wag: false, aim: 0, orb: 0, bolt: 0, tail: 0, steam: 0, spark: false,
};
type BKey = Partial<BaralPose>;

function baralFigure(c: Canvas, q: BaralPose, armed = true, hatted = true): void {
  const at = (p: Pt): Pt => [p[0] + q.bx, p[1] + q.by];
  const head: Pt = [10 + q.bx + q.hx, 7 + q.by + q.hy];
  const farHand: Pt = [8 + q.bx + q.fh[0], 21 + q.by + q.fh[1]];
  const nearHand: Pt = [18 + q.bx + q.nh[0], 22 + q.by + q.nh[1]];

  // The boiler on his back, its coil, and the steam it lets off.
  const boiler = at([20, 14]);
  inked(c, INK, (p) => put(p, BOILER, ...boiler));
  inked(c, INK, (p) => {
    bar(p, boiler[0] + 2, boiler[1] - 1, boiler[0] + 2, boiler[1] - 3, PAL.a);
    bar(p, boiler[0] + 1, boiler[1] - 3, boiler[0] + 3, boiler[1] - 3, PAL.A);
  });
  if (q.spark) {
    c.px.set(boiler[0] + 1, boiler[1] - 5, PAL.Z);
    c.px.set(boiler[0] + 3, boiler[1] - 6, PAL.E);
    c.px.set(boiler[0] + 4, boiler[1] - 5, PAL.Z);
  }
  for (const [k, dx] of [[0, 4], [3, 6]] as const) {
    const life = (q.steam + k) % 6;
    if (life > 4) continue;
    const puff = life < 2 ? S(['V']) : S(['VV', 'Vv']);
    put(c, puff, boiler[0] + dx + (life >> 1), boiler[1] - 1 - life * 2);
  }
  inked(c, INK, (p) => put(p, TAILS[q.tail], ...at([19, 22])));

  // The staff in the far hand: upright and planted, or tipped at the foe.
  if (armed) {
    inked(c, INK, (p) => {
      if (q.aim) {
        bar(p, farHand[0] + 3, farHand[1] + 4, farHand[0] - 3, farHand[1] - 3, PAL.a);
        put(p, q.orb ? ORB_HOT : ORB, farHand[0] - 5 - (q.orb ? 1 : 0) + 1, farHand[1] - 5 - (q.orb ? 1 : 0) + 1);
      } else {
        bar(p, farHand[0], FLOOR - 1, farHand[0], farHand[1] - 9, PAL.a);
        put(p, q.orb ? ORB_HOT : ORB, farHand[0] - (q.orb ? 1 : 1), farHand[1] - 12);
      }
    });
  }
  inked(c, INK, (p) => {
    bar(p, ...at([12, 17]), ...farHand, FAR.C, 2);
    put(p, GLOVE[0], ...farHand);
  });

  // Stiff legs and brass-toed boots.
  for (const side of [0, 1] as const) {
    const foot = side ? q.nf : q.ff;
    const ankle: Pt = [(side ? 18 : 14) + foot[0], FLOOR - 3 - foot[1]];
    inked(c, INK, (p) => {
      bar(p, ...at(side ? [17, 26] : [14, 26]), ...ankle, side ? PAL.K : PAL.x, 2);
      put(p, BOOT[side], ankle[0], ankle[1] + 1);
    });
  }
  inked(c, INK, (p) => put(p, COAT, ...at([11, 16])));

  // Head: a long face, bushy brows, a monocle, and a moustache that owns the room.
  inked(c, INK, (p) => put(p, FACE, ...head));
  inked(c, INK, (p) => put(p, NOSE, head[0] - 2, head[1] + 4));
  const eye = (x: number, y: number): void => {
    if (q.eyes === 'blink') bar(c, x, y, x + 1, y, INK);
    else if (q.eyes === 'dead') {
      c.px.set(x, y - 1, INK);
      c.px.set(x + 1, y, INK);
      c.px.set(x, y + 1, INK);
      c.px.set(x + 2, y - 1, INK);
      c.px.set(x + 2, y + 1, INK);
    } else if (q.eyes === 'wide') {
      put(c, S(['WW', 'Wk']), x, y - 1);
    } else put(c, S(['Wk']), x, y);
  };
  eye(head[0] + 1, head[1] + 4);
  bar(c, head[0] + 1, head[1] + 2 - (q.eyes === 'wide' ? 1 : 0), head[0] + 3, head[1] + 2, PAL.W, 1);
  if (q.mono === 2) {
    eye(head[0] + 5, head[1] + 4);
    bar(c, head[0] + 7, head[1] + 6, head[0] + 8, head[1] + 10, PAL.a);
    inked(c, INK, (p) => put(p, MONOCLE, head[0] + 7, head[1] + 10));
  } else {
    inked(c, INK, (p) => put(p, q.mono ? MONOCLE_GLINT : MONOCLE, head[0] + 5, head[1] + 2));
  }
  bar(c, head[0] + 5, head[1] + 1, head[0] + 8, head[1] + 1, PAL.W);
  if (q.open) put(c, S(['kk', 'kR']), head[0] + 3, head[1] + 8);
  inked(c, INK, (p) => put(p, MOUSTACHE, head[0] - 1, head[1] + 6 + (q.open ? -1 : 0)));
  if (hatted) inked(c, INK, (p) => put(p, HAT, head[0] - 2 + q.hatx, head[1] - 6 + q.haty));

  // The near arm: at his side, or up wagging a finger.
  inked(c, INK, (p) => {
    bar(p, ...at([19, 17]), ...nearHand, PAL.C, 2);
    put(p, q.wag ? WAG : GLOVE[1], nearHand[0], nearHand[1] - (q.wag ? 1 : 0));
  });

  // Nope: the orb crackles, a plus and then a cross of sparks.
  if (armed && q.bolt) {
    const o: Pt = [farHand[0] - 3, farHand[1] - 3];
    const rays: readonly Pt[] = q.bolt === 1 ? [[-1, 0], [1, 0], [0, -1], [0, 1]] : [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [dx, dy] of rays) {
      bar(c, o[0] + dx * 3, o[1] + dy * 3, o[0] + dx * 4, o[1] + dy * 4, PAL.Z);
      c.px.set(o[0] + dx * 5, o[1] + dy * 5, PAL.E);
    }
  }
}

const idleKeys: BKey[] = [
  {}, { spark: true }, { wag: true, nh: [-3, -4] }, { wag: true, nh: [-4, -4] }, { wag: true, nh: [-3, -4], spark: true }, { wag: true, nh: [-4, -4] },
  { nh: [-1, -2] }, { spark: true }, { eyes: 'blink' }, { hy: 1, hatx: 0 }, { hy: 1, haty: 1, mono: 1, spark: true }, { mono: 1 },
];
const IDLE = idleKeys.map((k, f): BKey => ({ ...k, steam: f % 6 }));
const WALK = ([
  { nf: [-3, 0], ff: [3, 0], fh: [-1, 0], haty: 1, tail: 1 },
  { by: -1, nf: [-1, 0], ff: [1, 1], fh: [0, 0], tail: 1 },
  { by: -1, nf: [1, 0], ff: [-1, 1], fh: [1, 0], haty: -1, tail: 0 },
  { nf: [3, 0], ff: [-3, 0], fh: [1, 0], haty: 1, tail: 1 },
  { by: -1, nf: [1, 1], ff: [-1, 0], fh: [0, 0], tail: 1 },
  { by: -1, nf: [-1, 1], ff: [1, 0], fh: [-1, 0], haty: -1, tail: 0 },
] satisfies BKey[]).map((k, f): BKey => ({ ...k, steam: f }));
const ATTACK: BKey[] = [
  {},
  { bx: 1, fh: [1, -2], orb: 1, hy: 1, spark: true, steam: 1 },
  { fh: [0, -2], aim: 1, orb: 1, open: true, eyes: 'wide', hatx: 1, steam: 2 },
  { fh: [0, -2], aim: 1, orb: 1, open: true, eyes: 'wide', bolt: 1, spark: true, steam: 3 },
  { fh: [0, -2], aim: 1, orb: 1, open: true, bolt: 2, steam: 4 },
  { fh: [0, -2], aim: 1, open: true, steam: 5 },
  { fh: [0, -1], mono: 1, steam: 0 },
  { steam: 1 },
];
const HURT: BKey[] = [
  { bx: 2, hx: 1, haty: -2, hatx: 1, eyes: 'wide', open: true, mono: 2, fh: [1, -1], nh: [1, -2], tail: 1 },
  { bx: 2, hx: 1, haty: -2, hatx: 1, eyes: 'wide', open: true, mono: 2, fh: [1, -1], nh: [1, -2], tail: 1 },
  { bx: 1, haty: -1, eyes: 'blink', mono: 2, tail: 1 },
  { mono: 1 },
];
const FALL: BKey[] = [
  { bx: 2, hx: 1, haty: -2, hatx: 1, eyes: 'wide', open: true, mono: 2, fh: [1, -1], nh: [1, -2], tail: 1 },
  { bx: 2, by: -1, hx: 1, haty: -5, hatx: 3, eyes: 'wide', open: true, mono: 2, fh: [1, -2], nh: [2, -3], spark: true, tail: 1 },
];
const LIMP: BKey = { eyes: 'dead', mono: 2, open: true };

export const baral: BossArt = art((c, p) => {
  if (p.anim === 'idle') return baralFigure(c, { ...REST, ...IDLE[p.f % IDLE.length] });
  if (p.anim === 'walk') return baralFigure(c, { ...REST, ...WALK[p.f % WALK.length] });
  if (p.anim === 'attack') return baralFigure(c, { ...REST, ...key(ATTACK, p.f) });
  if (p.anim === 'hurt') return baralFigure(c, { ...REST, ...key(HURT, p.f) });
  if (p.f < FALL.length) return baralFigure(c, { ...REST, ...FALL[p.f] });
  // Stiff to the last: he goes over like a plank. The hat lands by his feet, the rod beside him.
  const since = p.f - FALL.length;
  inked(c, INK, (q) => bar(q, 2, FLOOR - 1, 14, FLOOR - 3, PAL.a));
  inked(c, INK, (q) => put(q, ORB, 0, FLOOR - 5));
  const body = new Canvas(SIZE, SIZE);
  baralFigure(body, { ...REST, ...LIMP, steam: since, spark: since < 3 }, false, false);
  lay(c, body, 17, key([2, 0, 1, 0, 0, 0, 0, 0], since));
  inked(c, INK, (q) => put(q, HAT, 1 + Math.min(3, since), FLOOR - 8 - key([6, 2, 0], since)));
}, { idle: 8, walk: 9, attack: 12, hurt: 10, death: 10 }, 0x7ae8ff);

// ---------------------------------------------------------------------------
//  THE DRAKE: a wind-up brass lizard with a blue glass eye
// ---------------------------------------------------------------------------

const DRAKE_BODY = S([
  '..aAAAAa..',
  '.aAYAAAAa.',
  'aAAAAAAAAa',
  'aAaAAaAAAa',
  'aAAAAAAAAa',
  '.aaaaaaaa.',
]);
const DRAKE_HEAD = S([
  '...aAAa.',
  '..aAAAAa',
  'aAAZEAAa',
  'AAAzZAAa',
  'aaaAAAa.',
]);
const DRAKE_BLINK = S([
  '...aAAa.',
  '..aAAAAa',
  'aAAaaAAa',
  'AAAAAAAa',
  'aaaAAAa.',
]);
const DRAKE_X = S([
  '...aAAa.',
  '..akAkAa',
  'aAAAkAAa',
  'AAAkAkAa',
  'aaaAAAa.',
]);
const JAW = S(['aAAAa', '.aaa.']);
const WING = [
  S(['....CQ', '..CCQ.', 'CCCc..', '.cc...']),
  S(['......', 'CCCQQ.', '.CCccQ', '..cc..']),
];
const KEY = [S(['aA.Aa', 'aAAAa']), S(['.A.', '.A.'])];

interface DrakePose {
  bx: number;
  by: number;
  hx: number;
  hy: number;
  jaw: number;
  eye: 'open' | 'blink' | 'dead';
  wing: 0 | 1;
  key: 0 | 1;
  step: number;
  tail: number;
  spark: boolean;
}
const DRAKE_REST: DrakePose = { bx: 0, by: 0, hx: 0, hy: 0, jaw: 0, eye: 'open', wing: 0, key: 0, step: 0, tail: 0, spark: false };

function drakeFigure(c: Canvas, q: DrakePose, keyed = true): void {
  const at = (p: Pt): Pt => [p[0] + q.bx, p[1] + q.by];
  const head: Pt = [7 + q.bx + q.hx, 16 + q.by + q.hy];
  // Tail with a little gear on the end.
  inked(c, INK, (p) => {
    const root = at([22, 24]);
    bar(p, ...root, root[0] + 4, root[1] - 2 + q.tail, PAL.a, 2);
    put(p, S(['.A.', 'AaA', '.A.']), root[0] + 4, root[1] - 4 + q.tail);
  });
  inked(c, INK, (p) => put(p, mirror(WING[q.wing]), ...at([17, 16])));
  // Far legs, body, near legs.
  const leg = (hip: Pt, dx: number, color: number): void => inked(c, INK, (p) => {
    const foot: Pt = [hip[0] + q.bx + dx, FLOOR - 1];
    bar(p, ...at(hip), foot[0], foot[1] - 1, color, 2);
    bar(p, foot[0] - 1, foot[1], foot[0] + 1, foot[1], color);
  });
  leg([15, 26], q.step, PAL.b);
  leg([21, 26], -q.step, PAL.b);
  inked(c, INK, (p) => put(p, DRAKE_BODY, ...at([13, 21])));
  if (keyed) {
    inked(c, INK, (p) => {
      const k = at([21, 20]);
      bar(p, k[0], k[1], k[0], k[1] - 1, PAL.a);
      put(p, KEY[q.key], k[0] - (q.key ? 1 : 2), k[1] - 3);
    });
  }
  leg([14, 26], -q.step, PAL.a);
  leg([20, 26], q.step, PAL.a);
  // Neck, jaw, head.
  inked(c, INK, (p) => bar(p, ...at([15, 22]), head[0] + 6, head[1] + 3, PAL.A, 3));
  inked(c, INK, (p) => put(p, JAW, head[0] + 1, head[1] + 4 + q.jaw));
  inked(c, INK, (p) => put(p, q.eye === 'dead' ? DRAKE_X : q.eye === 'blink' ? DRAKE_BLINK : DRAKE_HEAD, ...head));
  inked(c, INK, (p) => put(p, WING[q.wing], ...at([15, 16])));
  if (q.spark) {
    const m: Pt = [head[0] - 2, head[1] + 4];
    zap(c, [[m[0] + 1, m[1]], [m[0] - 1, m[1] - 1], [m[0] - 2, m[1] + 1], [m[0] - 4, m[1]]]);
  }
}

const DRAKE_IDLE: Partial<DrakePose>[] = [
  { wing: 0, key: 0 }, { wing: 1, key: 0, hy: 1 }, { wing: 0, key: 1, by: 1, hy: 0 }, { wing: 1, key: 1, by: 1, tail: 1 }, { wing: 0, key: 0, tail: 1 }, { wing: 1, key: 0, hy: 1 },
  { wing: 0, key: 1 }, { wing: 1, key: 1, hy: 1 }, { wing: 0, key: 0, by: 1, eye: 'blink' }, { wing: 1, key: 0, by: 1, tail: 1 }, { wing: 0, key: 1, tail: 1 }, { wing: 1, key: 1, hy: 1 },
];
const DRAKE_WALK: Partial<DrakePose>[] = [
  { step: -2, wing: 0, key: 0 }, { step: -1, by: -1, wing: 1, key: 1, hy: 1 }, { step: 1, by: -1, wing: 0, key: 0, tail: 1 },
  { step: 2, wing: 1, key: 1 }, { step: 1, by: -1, wing: 0, key: 0, hy: 1 }, { step: -1, by: -1, wing: 1, key: 1, tail: 1 },
];
const DRAKE_ATTACK: Partial<DrakePose>[] = [
  {},
  { bx: 2, by: 1, hx: 1, jaw: 1, wing: 1 },
  { bx: 2, by: 1, hx: 1, jaw: 2, wing: 1, tail: 1 },
  { bx: -3, by: -1, hx: -1, jaw: 2, wing: 0, step: -1 },
  { bx: -4, hx: -1, jaw: 0, spark: true, wing: 1, step: -2 },
  { bx: -4, jaw: 0, spark: true, wing: 0, step: -2 },
  { bx: -2, jaw: 1, wing: 1, step: -1 },
  { bx: -1, wing: 0 },
];
const DRAKE_HURT: Partial<DrakePose>[] = [
  { bx: 2, hx: 1, hy: -1, jaw: 2, eye: 'blink', wing: 1, key: 1 },
  { bx: 2, hx: 1, jaw: 1, eye: 'blink', wing: 1, key: 1 },
  { bx: 1, wing: 0 },
  {},
];

export const baralDrake: BossArt = art((c, p) => {
  if (p.anim === 'idle') return drakeFigure(c, { ...DRAKE_REST, ...DRAKE_IDLE[p.f % DRAKE_IDLE.length] });
  if (p.anim === 'walk') return drakeFigure(c, { ...DRAKE_REST, ...DRAKE_WALK[p.f % DRAKE_WALK.length] });
  if (p.anim === 'attack') return drakeFigure(c, { ...DRAKE_REST, ...key(DRAKE_ATTACK, p.f) });
  if (p.anim === 'hurt') return drakeFigure(c, { ...DRAKE_REST, ...key(DRAKE_HURT, p.f) });
  // Death: jolted, then over on its back, legs up; the key springs off and lands beside it.
  if (p.f < 2) return drakeFigure(c, { ...DRAKE_REST, ...DRAKE_HURT[0], by: -p.f });
  const since = p.f - 2;
  const body = new Canvas(SIZE, SIZE);
  drakeFigure(body, { ...DRAKE_REST, eye: 'dead', jaw: 1, spark: since < 2 }, false);
  lay(c, body, 15, key([2, 0, 1, 0], since), 2);
  inked(c, INK, (q) => put(q, KEY[since % 2 && since < 5 ? 1 : 0], 24, FLOOR - 2 - key([7, 9, 6, 2, 0], since)));
}, { idle: 10, walk: 12, attack: 14, hurt: 10, death: 10 }, 0xf5cd6a);

// ---------------------------------------------------------------------------
//  THE ARTIFACT OF DENIAL: a crystal over a plinth, a refusal rune burning in it
// ---------------------------------------------------------------------------

const CRYSTAL_PAL: Palette = { ...PAL, L: 0xd4f4ff, M: 0x6cc4f4, N: 0x2c86d0, O: 0x16509a, P: 0x0c2a5c, G: 0x474b58, g: 0x2e313c, H: 0x666b7a };
const CRYSTAL = sprite([
  '....L....',
  '...LMN...',
  '..LMMNO..',
  '..LMMNO..',
  '.LMMMNOO.',
  '.LMMMNOO.',
  'LMMMMNOOO',
  'LMMMMNOOO',
  '.MMMMNOO.',
  '.MMMMNOO.',
  '..MMMNO..',
  '..MMNNO..',
  '...MNO...',
  '....N....',
], CRYSTAL_PAL);
const PLINTH = sprite([
  '.AAAAAAAAAAAA.',
  'HHGGGGGGGGGGgg',
  'HGGAGGGAGGGAgg',
  'HGGGGGGGGGGGgg',
], CRYSTAL_PAL);
const RUNE = [S(['.EE.', 'E.EE', 'EE.E', '.EE.']), sprite(['.LL.', 'L.LL', 'LL.L', '.LL.'], CRYSTAL_PAL)];
/** The crystal's two halves once it splits. */
const HALVES = [
  sprite(['..L', '.LM', 'LMM', 'LMM', 'LMM', 'LMM', 'MMM', '.MM', '..M'], CRYSTAL_PAL),
  sprite(['N..', 'NO.', 'NOO', 'NOO', 'NOO', 'NOO', 'NOO', 'NO.', 'N..'], CRYSTAL_PAL),
];
/** Twelve stops round the ring's ellipse, one a frame. */
const ORBIT: readonly Pt[] = Array.from({ length: 12 }, (_, i) => [Math.round(-9 * Math.cos((i / 12) * Math.PI * 2)), Math.round(3 * Math.sin((i / 12) * Math.PI * 2))] as Pt);

interface CrystalPose {
  bob: number;
  spin: number;
  rune: 0 | 1;
  flare: number;
  crack: boolean;
}

function artifactFigure(c: Canvas, q: CrystalPose): void {
  inked(c, INK, (p) => put(p, PLINTH, 9, FLOOR - 4));
  const top: Pt = [11, 9 + q.bob];
  const centre: Pt = [top[0] + 4, top[1] + 7];
  const dots = [q.spin % 12, (q.spin + 6) % 12].map((i) => ORBIT[i]);
  const brass = (d: Pt): void => {
    c.px.set(centre[0] + d[0], centre[1] + 3 + d[1], PAL.A);
    c.px.set(centre[0] + d[0] + 1, centre[1] + 3 + d[1], PAL.a);
  };
  for (const d of dots) if (d[1] < 0) brass(d);
  inked(c, INK, (p) => put(p, CRYSTAL, ...top));
  put(c, RUNE[q.rune], centre[0] - 2, centre[1] - 2);
  if (q.crack) {
    bar(c, centre[0] + 1, top[1] + 2, centre[0] - 1, centre[1] - 2, INK);
    bar(c, centre[0] + 2, centre[1] + 2, centre[0] + 1, centre[1] + 5, INK);
  }
  for (const d of dots) if (d[1] >= 0) brass(d);
  // A glow on the plinth, and refusal sparking out when it flares.
  const glow = FLOOR - 5;
  for (let x = 12; x <= 20; x += 2) c.px.set(x, glow, q.rune ? PAL.Z : PAL.z);
  if (q.flare) {
    const r = q.flare + 7;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]] as const) {
      const x = Math.round(centre[0] + dx * r);
      const y = Math.round(centre[1] + dy * r);
      bar(c, x, y, Math.round(x + dx * 2), Math.round(y + dy * 2), q.flare > 2 ? PAL.Z : PAL.E);
    }
  }
}

const ART_IDLE: CrystalPose[] = Array.from({ length: 12 }, (_, f) => ({
  bob: [0, 0, -1, -1, -1, 0][f % 6],
  spin: f,
  rune: (f % 6 < 3 ? 0 : 1) as 0 | 1,
  flare: 0,
  crack: false,
}));

export const denialArtifact: BossArt = art((c, p) => {
  if (p.anim === 'idle' || p.anim === 'walk') return artifactFigure(c, ART_IDLE[p.f % ART_IDLE.length]);
  if (p.anim === 'attack') {
    return artifactFigure(c, { bob: key([0, -1, -2, -2, -2, -1, 0, 0], p.f), spin: p.f, rune: p.f > 0 && p.f < 6 ? 0 : 1, flare: key([0, 0, 1, 2, 3, 0, 0, 0], p.f), crack: false });
  }
  if (p.anim === 'hurt') return artifactFigure(c, { bob: key([1, 1, 0, 0], p.f), spin: 0, rune: 1, flare: 0, crack: true });
  // Death: the crystal drops onto the plinth and splits in two.
  if (p.f < 3) return artifactFigure(c, { bob: [1, 3, 6][p.f], spin: 0, rune: 1, flare: 0, crack: true });
  inked(c, INK, (q) => put(q, PLINTH, 9, FLOOR - 4));
  const spread = Math.min(3, p.f - 2);
  inked(c, INK, (q) => put(q, turn(HALVES[0], -1), 5 - spread, FLOOR - 9 + Math.min(4, spread)));
  inked(c, INK, (q) => put(q, turn(HALVES[1], 1), 17 + spread, FLOOR - 9 + Math.min(4, spread)));
  if (p.f < 6) for (const [x, y] of [[14, 18], [18, 16], [12, 15], [20, 19]] as const) c.px.set(x + (x < 16 ? -spread : spread), y - spread, CRYSTAL_PAL.L);
}, { idle: 7, walk: 7, attack: 12, hurt: 10, death: 10 }, 0x7ae8ff);
