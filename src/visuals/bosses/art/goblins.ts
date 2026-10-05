// Hrrrk Snazzlegob's band as 32x32 pixel art: a wiry raider with a spiked club,
// an old shaman on a skull staff, and the chief himself, pot-bellied, crowned,
// with a cleaver. Parts are hand-pixelled (see ../pixel) and only ever moved by
// whole pixels or turned by quarter turns, so the pixels stay square and a part
// looks the same in every frame. Poses are keyed frame by frame: the head moves
// a frame after the body and the ears a frame after the head, every attack and
// hurt starts and ends on the idle pose. Every figure faces left.

import type { BossArt, BossAnim, Pose } from '../rig';
import { Canvas, type Pt } from '../raster';
import { bar, inked, key, mirror, put, sprite, turn, turnCanvas, type Palette, type Sprite } from '../pixel';

const SIZE = 32;
/** The ink row under the soles. */
const FLOOR = 31;
const INK = 0x17110c;

const NEAR: Palette = {
  k: INK,
  L: 0xa3d65e, G: 0x6da93f, g: 0x467b2b, q: 0x2c5020,
  y: 0xffe45c, w: 0xf3ebcf, m: 0x6b1d1d, t: 0xe0666a, p: 0xc9786a,
  N: 0x95623a, n: 0x643f22, j: 0x442a16,
  R: 0xc7402f, r: 0x86261c, x: 0x561812,
  D: 0x9c6b3b, d: 0x684322, e: 0x46291a,
  B: 0xefe4c4, b: 0xb5a67e, c: 0x7c6f52,
  I: 0xa9b3c1, i: 0x68707f, s: 0xeef3fa, v: 0x454b57,
  O: 0xf6ce4f, o: 0xb3801f,
  F: 0xb4a38c, f: 0x76695b, u: 0x4d443a,
  H: 0xb4ff9a, h: 0x3cc45a, z: 0x1f7a34,
};
/** The same materials a step darker, for the far arm, leg and ear. */
const FAR: Palette = {
  ...NEAR,
  L: NEAR.G, G: NEAR.g, g: NEAR.q, N: NEAR.n, n: NEAR.j, R: NEAR.r, r: NEAR.x,
  D: NEAR.d, d: NEAR.e, B: NEAR.b, b: NEAR.c, I: NEAR.i, i: NEAR.v, F: NEAR.f, f: NEAR.u,
};
const SKIN = NEAR.G;
const FAR_SKIN = FAR.G;
const OLD: Palette = { ...NEAR, L: 0x9cc26a, G: 0x6f9447, g: 0x4b6a31, q: 0x304722 };
const OLD_FAR: Palette = { ...OLD, L: OLD.G, G: OLD.g, g: OLD.q, N: NEAR.n, n: NEAR.j };

const S = (rows: readonly string[], anchor: readonly [number, number] = [0, 0], pal: Palette = NEAR): Sprite => sprite(rows, pal, anchor);

// ---------------------------------------------------------------------------
//  Faces: eyes are a brow row over two eye rows; mouths sit under the nose.
// ---------------------------------------------------------------------------

type Eyes = 'open' | 'blink' | 'ouch' | 'dead' | 'glow' | 'blaze';
type Mouth = 'grin' | 'yell' | 'ouch' | 'dead' | 'shut' | 'chant';

const EYE: Record<Eyes, [Sprite, Sprite]> = {
  open: [S(['kk', 'yy', 'ky']), S(['kk', 'yy', 'ky'])],
  blink: [S(['..', 'kk', '..']), S(['..', 'kk', '..'])],
  ouch: [S(['k.', '.k', 'k.']), S(['.k', 'k.', '.k'])],
  dead: [S(['k.k', '.k.', 'k.k']), S(['k.k', '.k.', 'k.k'])],
  glow: [S(['kk', 'hH', 'hh']), S(['kk', 'hH', 'hh'])],
  blaze: [S(['kk', 'HH', 'Hh']), S(['kk', 'HH', 'Hh'])],
};

const MOUTH: Record<Mouth, Sprite> = {
  grin: S(['kkkkkk', 'kwwwwk', '.kkkk.']),
  yell: S(['kkkkkk', 'kwmmwk', '.kmmk.']),
  ouch: S(['.kkkk.', 'kmmmmk', '.kkkk.']),
  dead: S(['kkkkkk', '..kttk', '...tt.']),
  shut: S(['.kkkk.', '..w...']),
  chant: S(['.kkk.', '.kmk.', '..k..']),
};

// The chief's jaw juts: two tusks stand up out of every mouth.
const CHIEF_MOUTH: Record<Mouth, Sprite> = {
  grin: S(['w......w', 'wkkkkkkw', '.kwwwwk.']),
  yell: S(['w......w', 'wkkkkkkw', 'kmmmmmmk', '.kwwwwk.']),
  ouch: S(['w......w', 'wkkkkkkw', '.kmmmmk.', '..kkkk..']),
  dead: S(['........', '.kkkkkk.', '....kttk', '.....tt.']),
  shut: S(['w......w', 'wkkkkkkw']),
  chant: S(['w......w', 'wkkkkkkw', '..kmmk..']),
};

// ---------------------------------------------------------------------------
//  Heads, noses, ears
// ---------------------------------------------------------------------------

const HEAD = S([
  '....GGGGG....',
  '..GLLGGGGGg..',
  '.GLGGGGGGGgg.',
  '.LGGGGGGGGGgg',
  'GGGGGGGGGGGgg',
  'GGGGGGGGGGggg',
  'GGGGGGGGGGggg',
  '.GGGGGGGGGGgg',
  '.GGGGGGGGGGg.',
  '..GGGGGGGGgg.',
  '....GGGGGgg..',
]);
const OLD_HEAD = sprite([
  '....GGGGG....',
  '..GLLGGGGGg..',
  '.GLGGGGGGGgg.',
  '.LGGGGGGGGGgg',
  'GGGGGGGGGGGgg',
  'GGGGGGGGGGggg',
  'GGGGGGGGGGggg',
  '.GGGGGGGGGGgg',
  '.GGGGGGGGGGg.',
  '..GGGGGGGGgg.',
  '....GGGGGgg..',
], OLD, [0, 0]);
const CHIEF_HEAD = S([
  '....LLLGGGG...',
  '..LLGGGGGGGGg.',
  '.LGGGGGGGGGGgg',
  '.GGGGGGGGGGGgg',
  'GGGGGGGGGGGGgg',
  'GGGGGGGGGGGggg',
  'GGGGGGGGGGGGgg',
  'GGGGGGGGGGGGgg',
  'GGGGGGGGGGGGgg',
  '.GGGGGGGGGGGg.',
  '..GGGGGGGGggg.',
  '....gggggggg..',
]);

const NOSE = S(['...GGG', '.GGGGg', 'GGGgg.', 'gg....']);
const OLD_NOSE = sprite(['...GGG', '.GGGGg', 'GGGgg.', 'Gg....', 'g.....'], OLD);
const CHIEF_NOSE = S(['...GGG', '.GGGGg', 'GGGGgg', '.gggg.']);

/** The near ear, rooted on its lower left, tip up; then drooping. */
const EAR_ROWS: [string[], string[]] = [
  ['.....L', '....GG', '...GpG', '..GppG', '.GGpg.', 'GGgg..'],
  ['......', '......L', '....GGG', '..GppG', '.GGpg.', 'GGgg..'],
];
const earSet = (pal: Palette, farPal: Palette): { near: [Sprite, Sprite]; far: [Sprite, Sprite] } => ({
  near: [sprite(EAR_ROWS[0], pal, [0, 5]), sprite(EAR_ROWS[1], pal, [0, 5])],
  far: [mirror(sprite(EAR_ROWS[0], farPal, [0, 5])), mirror(sprite(EAR_ROWS[1], farPal, [0, 5]))],
});
const EARS = earSet(NEAR, FAR);
// The shaman's ears hang with age: his "up" is everyone else's droop.
const OLD_EARS_BASE = earSet(OLD, OLD_FAR);
const OLD_EARS = {
  near: [OLD_EARS_BASE.near[1], sprite(['........', '........', 'GGGGppG.', 'GGggggGg', '......gg'], OLD, [0, 2])] as [Sprite, Sprite],
  far: [OLD_EARS_BASE.far[1], mirror(sprite(['........', '........', 'GGGGppG.', 'GGggggGg', '......gg'], OLD_FAR, [0, 2]))] as [Sprite, Sprite],
};

// ---------------------------------------------------------------------------
//  Bodies
// ---------------------------------------------------------------------------

const RAIDER_TORSO = S([
  '.NNNNNn.',
  'NNNNNNnn',
  'NNNNNNnn',
  'jjjOjjjj',
  'NNNNNNnn',
  'NnNNnNNn',
  '.n.nn.n.',
]);
const SHAMAN_ROBE = S([
  '..NNNNNn.',
  '.NBNBNBnn',
  'NNNbNbNNn',
  'NNNNNNNnn',
  'NNDDNNNnn',
  'NNDDNNnnn',
  'NNNNNNNnn',
  'NNNNNNnnn',
  '.NNNNNNnn',
  '.nNnNnNn.',
]);
const CHIEF_TORSO = S([
  '..FFFFFFFFf.',
  '.FFFFFFFFFff',
  'FFfGGGGGGfff',
  'GLLGGGGGGGgg',
  'LLGGGGGGGGgg',
  'LGGGGGGGGGgg',
  'GGGGGGGGGGg.',
  '.jjjjOOjjjj.',
  '..RRRRRRrr..',
  '..RRrRRrr...',
]);

const FOOT: [Sprite, Sprite] = [S(['..GG', 'GGGg'], [2, 0], FAR), S(['..GG', 'GGGg'], [2, 0])];
const OLD_FOOT: [Sprite, Sprite] = [sprite(['..GG', 'GGGg'], OLD_FAR, [2, 0]), sprite(['..GG', 'GGGg'], OLD, [2, 0])];
const CHIEF_FOOT: [Sprite, Sprite] = [S(['..GGG', 'GGGGg'], [2, 0], FAR), S(['..GGG', 'GGGGg'], [2, 0])];
const HAND: [Sprite, Sprite] = [S(['GG', 'Gg'], [0, 0], FAR), S(['GG', 'Gg'])];
const OLD_HAND: [Sprite, Sprite] = [sprite(['GG', 'Gg'], OLD_FAR), sprite(['GG', 'Gg'], OLD)];
const CHIEF_HAND: [Sprite, Sprite] = [S(['GGG', 'GGg', 'ggg'], [1, 1], FAR), S(['GGG', 'GGg', 'ggg'], [1, 1])];

// ---------------------------------------------------------------------------
//  Gear: each drawn upright and at 45 degrees; the other angles are quarter turns.
// ---------------------------------------------------------------------------

type Gear = 'up' | 'back' | 'diag' | 'fwd' | 'low' | 'none';

function gearSet(up: Sprite, diag: Sprite): Record<Exclude<Gear, 'none'>, Sprite> {
  return { up, back: mirror(diag), diag, fwd: turn(up, -1), low: turn(diag, -1) };
}

const CLUB = gearSet(
  S(['.B.B.', 'BDDDB', 'DDDDd', 'BDDdB', '.DDd.', '..Dd.', '..Dd.', '..Dd.', '..Dd.', '..Dd.', '..nn.', '..nn.'], [2, 10]),
  S(['.B.B.......', 'BDDDB......', '.DDDdB.....', 'BDDdd......', '...dDd.....', '....dDd....', '.....dDd...', '......dDd..', '.......dD..', '........nn.', '.........nn'], [8, 9]),
);
const CLEAVER = gearSet(
  S(['.sIIIi', 'sIIIIi', 'sIIIIi', 'sIIkIi', 'sIIIIi', 'sIIIIi', 'sIIIIi', '.iiiii', '....Dd', '....Dd', '....Dd', '....nn'], [4, 10]),
  S(['..ss......', '.sIIs.....', 'sIIIIs....', '.sIIIIi...', '..IIkIIi..', '...IIIIi..', '....iIi...', '.....iDd..', '......Dd..', '.......nn.'], [7, 8]),
);
const SKULL = S(['.BBB.', 'BBBBb', 'BkBkb', 'bBBBb', '.bwb.']);
const SKULL_LIT = S(['.BBB.', 'BBBBb', 'BHBHb', 'bBBBb', '.bwb.']);

// ---------------------------------------------------------------------------
//  Poses
// ---------------------------------------------------------------------------

interface GobPose {
  /** Body offset from rest (x back, y down) and the head's lag on top of it. */
  bx: number;
  by: number;
  hx: number;
  hy: number;
  ear: 0 | 1;
  eyes: Eyes;
  mouth: Mouth;
  /** Hands, from their rest place; they move with the body. */
  nh: Pt;
  fh: Pt;
  /** Feet: along the ground from rest, and lift. */
  nf: Pt;
  ff: Pt;
  gear: Gear;
  /** Cape or staff sway, glow and the like, per figure. */
  sway: number;
  glow: number;
}

const REST: GobPose = { bx: 0, by: 0, hx: 0, hy: 0, ear: 0, eyes: 'open', mouth: 'grin', nh: [0, 0], fh: [0, 0], nf: [0, 0], ff: [0, 0], gear: 'up', sway: 0, glow: 0 };
type Key = Partial<GobPose>;

interface Spec {
  head: Sprite;
  headAt: Pt;
  eyes: [Pt, Pt];
  nose: Sprite;
  noseAt: Pt;
  mouths: Record<Mouth, Sprite>;
  mouthAt: Pt;
  ears: { near: [Sprite, Sprite]; far: [Sprite, Sprite] };
  earAt: [Pt, Pt];
  torso: Sprite;
  torsoAt: Pt;
  shoulders: [Pt, Pt];
  hips: [Pt, Pt];
  /** Rest ankles along the ground (far, near). */
  ankles: [number, number];
  hands: [Pt, Pt];
  feet: [Sprite, Sprite];
  handSprites: [Sprite, Sprite];
  skin: [number, number];
  arm: number;
  leg: number;
  /** Legs are hidden under a robe: only the feet show, in front of it. */
  robed?: boolean;
  gear: Record<Exclude<Gear, 'none'>, Sprite> | null;
  behind?(c: Canvas, q: GobPose, at: (p: Pt) => Pt): void;
  hat?(c: Canvas, q: GobPose, head: Pt): void;
  held?(c: Canvas, q: GobPose, hand: Pt, at: (p: Pt) => Pt): void;
  front?(c: Canvas, q: GobPose, hand: Pt, head: Pt): void;
}

const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];

/** One goblin, `ox` pixels along; without `armed` he has dropped what he carried. */
function goblin(c: Canvas, s: Spec, q: GobPose, ox: number, armed = true): void {
  const at = (p: Pt): Pt => [p[0] + q.bx + ox, p[1] + q.by];
  const head: Pt = [s.headAt[0] + q.bx + q.hx + ox, s.headAt[1] + q.by + q.hy];
  const rel = (p: Pt): Pt => [head[0] + p[0], head[1] + p[1]];
  const farHand = add(at(s.hands[0]), q.fh);
  const nearHand = add(at(s.hands[1]), q.nh);
  const leg = (side: 0 | 1): void => {
    const lift = (side ? q.nf : q.ff)[1];
    const ankle: Pt = [s.ankles[side] + (side ? q.nf : q.ff)[0] + ox, FLOOR - 3 - lift];
    inked(c, INK, (p) => {
      if (!s.robed) bar(p, ...at(s.hips[side]), ankle[0], ankle[1], s.skin[side], s.leg);
      put(p, s.feet[side], ankle[0], ankle[1] + 1);
    });
  };

  s.behind?.(c, q, at);
  inked(c, INK, (p) => put(p, s.ears.far[q.ear], ...rel(s.earAt[0])));
  inked(c, INK, (p) => {
    bar(p, ...at(s.shoulders[0]), ...farHand, s.skin[0], s.arm);
    put(p, s.handSprites[0], ...farHand);
  });
  if (!s.robed) leg(0);
  inked(c, INK, (p) => put(p, s.torso, ...at(s.torsoAt)));
  if (s.robed) leg(0);
  leg(1);
  inked(c, INK, (p) => put(p, s.head, ...head));
  inked(c, INK, (p) => put(p, s.nose, ...rel(s.noseAt)));
  put(c, EYE[q.eyes][0], ...rel(s.eyes[0]));
  put(c, EYE[q.eyes][1], ...rel(s.eyes[1]));
  put(c, s.mouths[q.mouth], ...rel(s.mouthAt));
  s.hat?.(c, q, head);
  inked(c, INK, (p) => put(p, s.ears.near[q.ear], ...rel(s.earAt[1])));
  if (armed) {
    if (s.gear && q.gear !== 'none') inked(c, INK, (p) => put(p, s.gear![q.gear as Exclude<Gear, 'none'>], ...nearHand));
    s.held?.(c, q, nearHand, at);
  }
  inked(c, INK, (p) => {
    bar(p, ...at(s.shoulders[1]), ...nearHand, s.skin[1], s.arm);
    put(p, s.handSprites[1], ...nearHand);
  });
  if (armed) s.front?.(c, q, nearHand, head);
}

/** Lay a finished upright figure on its back, head to the right, on the floor `lift` pixels up. */
function lay(c: Canvas, figure: Canvas, centre: number, lift: number): void {
  const turned = turnCanvas(figure, 1, SIZE / 2, SIZE / 2);
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

/** A loop of keys, read from frame `f`. */
const loop = (keys: readonly Key[], f: number): GobPose => ({ ...REST, ...keys[((f % keys.length) + keys.length) % keys.length] });

/** Keys that all share `base`. */
const under = (base: Key, keys: readonly Key[]): Key[] => keys.map((k) => ({ ...base, ...k }));

interface Moves {
  idle: readonly Key[];
  walk: readonly Key[];
  attack: readonly Key[];
  hurt: readonly Key[];
  /** Upright death frames; after these he lies down. */
  fall: readonly Key[];
  /** The pose he lies in. */
  limp: Key;
  /** Lift of the body in each lying frame (a bounce, then still). */
  settle: readonly number[];
  /** Where the middle of the lying body comes to rest. */
  lieX?: number;
  /** Where his gear lands, and how it lies. */
  dropped?(c: Canvas, ox: number): void;
}

function frame(c: Canvas, s: Spec, m: Moves, p: Pose, ox: number, phase = 0): void {
  if (p.anim === 'idle') return goblin(c, s, loop(m.idle, p.f + phase), ox);
  if (p.anim === 'walk') return goblin(c, s, loop(m.walk, p.f + phase), ox);
  if (p.anim === 'attack') return goblin(c, s, { ...REST, ...key(m.attack, p.f) }, ox);
  if (p.anim === 'hurt') return goblin(c, s, { ...REST, ...key(m.hurt, p.f) }, ox);
  if (p.f < m.fall.length) {
    goblin(c, s, { ...REST, ...m.fall[p.f] }, ox, p.f < 2);
    if (p.f >= 2) m.dropped?.(c, ox);
    return;
  }
  m.dropped?.(c, ox);
  const body = new Canvas(SIZE, SIZE);
  goblin(body, s, { ...REST, ...m.limp }, 0, false);
  lay(c, body, (m.lieX ?? SIZE / 2 + 2) + ox, key(m.settle, p.f - m.fall.length));
}

export const GOBLIN_FRAMES: Record<BossAnim, number> = { idle: 12, walk: 6, attack: 8, hurt: 4, death: 10 };

function unit(s: Spec, m: Moves, rate: Record<BossAnim, number>, ember: number): BossArt {
  return {
    w: SIZE,
    h: SIZE,
    pixel: 3,
    ground: FLOOR,
    outlined: true,
    crumble: false,
    flash: 0xffffff,
    frames: GOBLIN_FRAMES,
    rate,
    ink: INK,
    ember,
    draw(c, p) {
      frame(c, s, m, p, 0);
    },
  };
}

// ---------------------------------------------------------------------------
//  THE RAIDER: bouncing on his toes, club up.
// ---------------------------------------------------------------------------

const RAIDER: Spec = {
  head: HEAD,
  headAt: [7, 8],
  eyes: [[2, 3], [7, 3]],
  nose: NOSE,
  noseAt: [-3, 5],
  mouths: MOUTH,
  mouthAt: [4, 8],
  ears: EARS,
  earAt: [[1, 5], [12, 5]],
  torso: RAIDER_TORSO,
  torsoAt: [12, 19],
  shoulders: [[13, 20], [19, 20]],
  hips: [[14, 25], [17, 25]],
  ankles: [13, 18],
  hands: [[11, 24], [21, 25]],
  feet: FOOT,
  handSprites: HAND,
  skin: [FAR_SKIN, SKIN],
  arm: 2,
  leg: 2,
  gear: CLUB,
  hat(c, q, head) {
    // A red scarf under the chin, its tails trailing a frame behind the head.
    inked(c, INK, (p) => {
      bar(p, head[0] + 3, head[1] + 11, head[0] + 10, head[1] + 11, NEAR.R);
      bar(p, head[0] + 4, head[1] + 12, head[0] + 9, head[1] + 12, NEAR.r);
      const tail = q.sway;
      bar(p, head[0] + 11, head[1] + 11, head[0] + 14, head[1] + 12 + tail, NEAR.R);
      bar(p, head[0] + 11, head[1] + 12, head[0] + 13, head[1] + 14 + tail, NEAR.r);
    });
  },
};

const RAIDER_MOVES: Moves = {
  // Breathing: the body sinks a pixel, the head a frame later, the ears and scarf a frame after that.
  idle: under({ gear: 'back' }, [
    { ear: 1, sway: 1 }, {}, { by: 1, hy: -1 }, { by: 1 }, { by: 1, ear: 1, sway: 1 }, { hy: 1, ear: 1, sway: 1 },
    { ear: 1, sway: 1 }, {}, { by: 1, hy: -1 }, { by: 1, eyes: 'blink' }, { by: 1, ear: 1, sway: 1 }, { hy: 1, ear: 1, sway: 1 },
  ]),
  walk: under({ gear: 'back', bx: -1, hx: -1 }, [
    { hy: -1, nf: [-3, 0], ff: [3, 0], fh: [-1, 0], nh: [1, 0], sway: 1 },
    { by: -1, hy: 1, nf: [-1, 0], ff: [1, 1], fh: [0, 0], nh: [0, 0], sway: 1 },
    { by: -1, nf: [1, 0], ff: [-1, 1], fh: [1, 0], nh: [-1, 0], ear: 1, sway: 2 },
    { hy: -1, nf: [3, 0], ff: [-3, 0], fh: [1, 0], nh: [-1, 0], sway: 1 },
    { by: -1, hy: 1, nf: [1, 1], ff: [-1, 0], fh: [0, 0], nh: [0, 0], sway: 1 },
    { by: -1, nf: [-1, 1], ff: [1, 0], fh: [-1, 0], nh: [1, 0], ear: 1, sway: 2 },
  ]),
  // Club back, up over the head, down in 45 degree steps, and back up to the shoulder.
  attack: [
    { gear: 'back' },
    { bx: 1, by: 1, gear: 'back', nh: [1, -3], fh: [-1, -1], ear: 1, mouth: 'shut', sway: 1 },
    { bx: 1, by: -1, gear: 'up', nh: [-2, -6], fh: [-1, -1], nf: [-1, 0], mouth: 'yell', ear: 1, sway: 1 },
    { bx: -2, by: -1, hx: -1, gear: 'diag', nh: [-6, -4], fh: [0, 0], nf: [-2, 1], mouth: 'yell', sway: 0 },
    { bx: -3, by: 1, hx: -1, gear: 'low', nh: [-5, 0], fh: [2, -1], nf: [-3, 0], mouth: 'yell', ear: 1, sway: 2 },
    { bx: -3, by: 1, hy: 1, gear: 'low', nh: [-5, 0], fh: [2, -1], nf: [-3, 0], mouth: 'grin', ear: 1, sway: 2 },
    { bx: -2, gear: 'diag', nh: [-4, -2], fh: [1, 0], nf: [-2, 0], ear: 1, sway: 1 },
    { bx: -1, gear: 'up', nh: [-1, -3], nf: [-1, 0], sway: 1 },
  ],
  hurt: [
    { gear: 'back', bx: 2, hx: 1, hy: -1, eyes: 'ouch', mouth: 'ouch', ear: 1, fh: [-2, -3], nh: [1, -2], sway: 2 },
    { gear: 'back', bx: 2, hx: 1, eyes: 'ouch', mouth: 'ouch', ear: 1, fh: [-2, -2], nh: [1, -1], sway: 2 },
    { gear: 'back', bx: 1, eyes: 'blink', mouth: 'shut', ear: 1, fh: [-1, -1], sway: 1 },
    { gear: 'back', ear: 1, sway: 1 },
  ],
  fall: [
    { gear: 'back', bx: 2, hx: 1, hy: -1, eyes: 'ouch', mouth: 'ouch', ear: 1, fh: [-2, -3], nh: [1, -2], sway: 2 },
    { gear: 'back', bx: 3, by: -1, hx: 1, hy: -1, eyes: 'ouch', mouth: 'ouch', ear: 1, fh: [-2, -4], nh: [1, -4], nf: [1, 1], sway: 2 },
    { bx: 3, by: 3, hx: 1, eyes: 'dead', mouth: 'dead', ear: 1, fh: [-2, -2], nh: [0, -2], nf: [-3, 1], ff: [-1, 0], sway: 1 },
  ],
  limp: { eyes: 'dead', mouth: 'dead', ear: 1, fh: [-1, 1], nh: [0, 1], sway: 1 },
  settle: [1, 0, 0, 0, 0, 0, 0],
  dropped(c, ox) {
    inked(c, INK, (p) => put(p, CLUB.fwd, 9 + ox, FLOOR - 3));
  },
};

// ---------------------------------------------------------------------------
//  THE SHAMAN: bent over his staff, muttering; green motes rise off the skull.
// ---------------------------------------------------------------------------

const SHAMAN: Spec = {
  head: OLD_HEAD,
  headAt: [7, 10],
  eyes: [[2, 3], [7, 3]],
  nose: OLD_NOSE,
  noseAt: [-3, 5],
  mouths: MOUTH,
  mouthAt: [4, 8],
  ears: OLD_EARS,
  earAt: [[1, 5], [12, 5]],
  torso: SHAMAN_ROBE,
  torsoAt: [11, 20],
  shoulders: [[13, 21], [18, 21]],
  hips: [[14, 28], [17, 28]],
  ankles: [13, 18],
  hands: [[10, 24], [23, 23]],
  feet: OLD_FOOT,
  handSprites: OLD_HAND,
  skin: [OLD_FAR.G, OLD.G],
  arm: 2,
  leg: 2,
  robed: true,
  gear: null,
  hat(c, q, head) {
    // A wisp of beard, and a crest of feathers that lags his nods.
    inked(c, INK, (p) => put(p, S(['BBBB', '.BBb', '..b.']), head[0] + 4, head[1] + 10));
    inked(c, INK, (p) => {
      const lag = q.sway >= 2 ? 1 : 0;
      bar(p, head[0] + 6, head[1], head[0] + 8 + lag, head[1] - 4, NEAR.R, 2);
      bar(p, head[0] + 9, head[1] + 1, head[0] + 12 + lag, head[1] - 2, NEAR.B, 2);
    });
  },
  held(c, q, hand) {
    const top = hand[1] - 10;
    inked(c, INK, (p) => {
      bar(p, hand[0], FLOOR - 1, hand[0], top + 4, NEAR.D);
      put(p, q.glow > 0 ? SKULL_LIT : SKULL, hand[0] - 2, top);
    });
  },
  front(c, q, hand) {
    const top = hand[1] - 10;
    const cx = hand[0];
    const cy = top + 2;
    // Casting: a ring of hex sparks opens round the skull.
    if (q.glow >= 2) {
      const r = q.glow;
      const color = q.glow > 4 ? NEAR.h : NEAR.H;
      for (const [dx, dy] of [[-r, 0], [r, 0], [0, -r], [0, r], [-r + 1, -r + 1], [r - 1, -r + 1], [-r + 1, r - 1], [r - 1, r - 1]] as const) {
        c.px.set(cx + dx, cy + dy, color);
      }
    }
    // Idle: two motes climb one pixel a frame off the skull.
    if (q.glow === 0 || q.glow === 1) {
      const rise = q.sway;
      c.px.set(cx - 2, cy - 3 - rise, NEAR.H);
      c.px.set(cx + 2, cy - 5 - ((rise + 2) % 4), NEAR.h);
    }
  },
};

const SHAMAN_MOVES: Moves = {
  idle: under({ eyes: 'glow', mouth: 'shut' }, [
    { sway: 0 }, { sway: 1 }, { hy: 1, sway: 2, mouth: 'chant' }, { by: 1, hy: 1, sway: 3, mouth: 'chant' }, { by: 1, hy: 1, sway: 0, ear: 1 }, { by: 1, sway: 1, ear: 1 },
    { sway: 2, ear: 1 }, { sway: 3 }, { hy: 1, sway: 0, mouth: 'chant' }, { by: 1, hy: 1, sway: 1, mouth: 'chant', eyes: 'blink' }, { by: 1, hy: 1, sway: 2, ear: 1 }, { by: 1, sway: 3, ear: 1 },
  ]),
  walk: under({ eyes: 'glow', mouth: 'shut', glow: 1 }, [
    { nf: [-2, 0], ff: [2, 0], nh: [-2, 0], hy: 1, ear: 1, sway: 1 },
    { by: -1, nf: [-1, 0], ff: [1, 1], nh: [-1, 0], sway: 1 },
    { by: -1, nf: [1, 0], ff: [-1, 1], nh: [0, 0], sway: 0 },
    { nf: [2, 0], ff: [-2, 0], nh: [1, 0], hy: 1, ear: 1, sway: 0 },
    { by: -1, nf: [1, 1], ff: [-1, 0], nh: [0, 0], sway: 1 },
    { by: -1, nf: [-1, 1], ff: [1, 0], nh: [-1, 0], sway: 1 },
  ]),
  attack: [
    { eyes: 'glow', mouth: 'shut' },
    { by: 1, nh: [0, -1], fh: [-1, -3], eyes: 'glow', mouth: 'chant', glow: 1, sway: 1 },
    { by: -1, hy: -1, nh: [0, -3], fh: [-2, -6], eyes: 'blaze', mouth: 'chant', glow: 2, sway: 2 },
    { by: -1, hy: -1, nh: [0, -4], fh: [-2, -7], eyes: 'blaze', mouth: 'yell', glow: 3, sway: 2 },
    { by: -1, nh: [0, -4], fh: [-2, -7], eyes: 'blaze', mouth: 'yell', glow: 4, sway: 1 },
    { nh: [0, -3], fh: [-2, -5], eyes: 'blaze', mouth: 'chant', glow: 5, sway: 1 },
    { nh: [0, -1], fh: [-1, -2], eyes: 'glow', mouth: 'chant', glow: 1, sway: 0 },
    { eyes: 'glow', mouth: 'shut', ear: 1 },
  ],
  hurt: [
    { bx: 2, hx: 1, hy: -1, eyes: 'ouch', mouth: 'ouch', fh: [-1, -3], nh: [1, 0], ear: 1, sway: 2 },
    { bx: 2, hx: 1, eyes: 'ouch', mouth: 'ouch', fh: [-1, -2], nh: [1, 0], ear: 1, sway: 2 },
    { bx: 1, eyes: 'blink', mouth: 'shut', ear: 1, sway: 1 },
    { eyes: 'glow', mouth: 'shut', ear: 1 },
  ],
  fall: [
    { bx: 2, hx: 1, hy: -1, eyes: 'ouch', mouth: 'ouch', fh: [-1, -3], nh: [1, 0], ear: 1, sway: 2 },
    { bx: 2, by: -1, hx: 1, hy: -1, eyes: 'ouch', mouth: 'ouch', fh: [-2, -4], nh: [1, -2], ear: 1, sway: 3 },
    { bx: 3, by: 3, hx: 1, eyes: 'dead', mouth: 'dead', fh: [-2, -2], nh: [0, -1], nf: [-3, 1], ff: [-1, 0], ear: 1, sway: 1 },
  ],
  limp: { eyes: 'dead', mouth: 'dead', ear: 1, fh: [0, 1], nh: [-1, 1], sway: 1 },
  settle: [1, 0, 0, 0, 0, 0, 0],
  dropped(c, ox) {
    inked(c, INK, (p) => {
      bar(p, 4 + ox, FLOOR - 1, 16 + ox, FLOOR - 1, NEAR.D);
      put(p, turn(SKULL, -1), 1 + ox, FLOOR - 5);
    });
  },
};

// ---------------------------------------------------------------------------
//  THE CHIEF: a big breath in, a big breath out, the cleaver on his shoulder.
// ---------------------------------------------------------------------------

const CAPE: Sprite[] = [
  S(['RRRRRr.', 'RRRRRrr', 'RRRRrrr', 'RRRRrrr', 'RRRRrrr', 'RRRrrrr', 'RRRrrrr', 'RRrrrrr', 'RRrrrr.', 'Rr.rrr.', 'r...r..']),
  S(['RRRRRr.', 'RRRRRrr', 'RRRRrrr', 'RRRRrrr', 'RRRRrrr', 'RRRrrrr', 'RRRrrrrr', 'RRrrrrrr', '.RRrrrr.', '.Rr.rrr.', '..r..r..']),
  S(['RRRRRr.', 'RRRRRrr', 'RRRRrrr', 'RRRRrrr', 'RRRRrrrr', 'RRRrrrrr', 'RRRrrrrr', 'RRrrrrrr', '.RRrrrrr', '..Rr.rrr', '...r..r.']),
];
const CROWN = S(['I..s..I..s', 'Is.Is.Is.I', 'IIOIIIOIII', 'iiiiiiiiii']);

const CHIEF: Spec = {
  head: CHIEF_HEAD,
  headAt: [4, 5],
  eyes: [[2, 3], [7, 3]],
  nose: CHIEF_NOSE,
  noseAt: [-3, 5],
  mouths: CHIEF_MOUTH,
  mouthAt: [3, 7],
  ears: EARS,
  earAt: [[1, 5], [13, 5]],
  torso: CHIEF_TORSO,
  torsoAt: [9, 16],
  shoulders: [[11, 18], [20, 18]],
  hips: [[12, 25], [18, 25]],
  ankles: [12, 19],
  hands: [[9, 23], [22, 22]],
  feet: CHIEF_FOOT,
  handSprites: CHIEF_HAND,
  skin: [FAR_SKIN, SKIN],
  arm: 3,
  leg: 3,
  gear: CLEAVER,
  behind(c, q, at) {
    inked(c, INK, (p) => put(p, CAPE[Math.min(2, q.sway)], ...at([17, 17])));
  },
  hat(c, q, head) {
    // Knocked out, his crown is on the floor (see his `dropped`).
    if (q.eyes !== 'dead') inked(c, INK, (p) => put(p, CROWN, head[0] + 2, head[1] - 3));
    c.px.set(head[0] + 13, head[1] + 8, NEAR.O);
    c.px.set(head[0] + 13, head[1] + 9, NEAR.o);
  },
};

const CHIEF_MOVES: Moves = {
  idle: [
    { gear: 'back' }, { gear: 'back' }, { gear: 'back', by: 1, sway: 1 }, { gear: 'back', by: 1, hy: 1, sway: 1 }, { gear: 'back', by: 1, hy: 1, ear: 1, sway: 2 }, { gear: 'back', hy: 1, ear: 1, sway: 1 },
    { gear: 'back', ear: 1 }, { gear: 'back' }, { gear: 'back', by: 1, sway: 1 }, { gear: 'back', by: 1, hy: 1, sway: 1, eyes: 'blink' }, { gear: 'back', by: 1, hy: 1, ear: 1, sway: 2 }, { gear: 'back', hy: 1, ear: 1, sway: 1 },
  ],
  walk: under({ gear: 'back' }, [
    { bx: -1, hy: 1, nf: [-3, 0], ff: [3, 0], fh: [-1, 0], ear: 1, sway: 2 },
    { bx: -1, by: -1, hy: 1, nf: [-1, 0], ff: [1, 1], fh: [0, 0], ear: 1, sway: 1 },
    { bx: -1, by: -1, nf: [1, 0], ff: [-1, 1], fh: [1, 0], sway: 1 },
    { bx: -1, hy: 1, nf: [3, 0], ff: [-3, 0], fh: [1, 0], ear: 1, sway: 2 },
    { bx: -1, by: -1, hy: 1, nf: [1, 1], ff: [-1, 0], fh: [0, 0], ear: 1, sway: 1 },
    { bx: -1, by: -1, nf: [-1, 1], ff: [1, 0], fh: [-1, 0], sway: 1 },
  ]),
  attack: [
    { gear: 'back' },
    { bx: 1, by: -1, gear: 'up', nh: [-1, -6], fh: [0, -2], mouth: 'shut', sway: 1 },
    { bx: 2, by: -1, hx: 1, gear: 'up', nh: [-1, -8], fh: [1, -3], mouth: 'shut', ear: 1, sway: 2 },
    { bx: -1, hx: -1, gear: 'diag', nh: [-8, -4], fh: [1, 0], nf: [-2, 0], mouth: 'yell', sway: 1 },
    { bx: -3, by: 1, hx: -1, hy: 1, gear: 'fwd', nh: [-8, 2], fh: [2, -1], nf: [-3, 0], mouth: 'yell', ear: 1, sway: 0 },
    { bx: -3, by: 1, hy: 1, gear: 'fwd', nh: [-8, 2], fh: [2, -1], nf: [-3, 0], mouth: 'yell', ear: 1, sway: 0 },
    { bx: -2, gear: 'diag', nh: [-7, -3], fh: [1, 0], nf: [-2, 0], ear: 1, sway: 1 },
    { bx: -1, gear: 'back', nf: [-1, 0], ear: 1, sway: 2 },
  ],
  hurt: [
    { gear: 'back', bx: 2, hx: 1, hy: -1, eyes: 'ouch', mouth: 'ouch', ear: 1, fh: [-2, -3], sway: 0 },
    { gear: 'back', bx: 2, hx: 1, eyes: 'ouch', mouth: 'ouch', ear: 1, fh: [-2, -2], sway: 0 },
    { gear: 'back', bx: 1, eyes: 'blink', mouth: 'shut', ear: 1, fh: [-1, -1], sway: 1 },
    { gear: 'back', ear: 1, sway: 1 },
  ],
  fall: [
    { gear: 'back', bx: 2, hx: 1, hy: -1, eyes: 'ouch', mouth: 'ouch', ear: 1, fh: [-2, -3], sway: 0 },
    { gear: 'back', bx: 3, by: -1, hx: 1, hy: -1, eyes: 'ouch', mouth: 'ouch', ear: 1, fh: [-3, -4], nh: [0, -3], nf: [1, 1], sway: 0 },
    { bx: 3, by: 3, hx: 1, eyes: 'dead', mouth: 'dead', ear: 1, fh: [-2, -2], nh: [-2, 2], nf: [-3, 1], ff: [-1, 0], sway: 1 },
  ],
  limp: { eyes: 'dead', mouth: 'dead', ear: 1, fh: [0, 1], nh: [-3, 3], sway: 1 },
  settle: [1, 0, 0, 0, 0, 0, 0],
  lieX: 19,
  dropped(c, ox) {
    inked(c, INK, (p) => put(p, turn(CLEAVER.up, 2), 4 + ox, FLOOR - 10));
    inked(c, INK, (p) => put(p, CROWN, 22 + ox, FLOOR - 4));
  },
};

export const goblinRaider = unit(RAIDER, RAIDER_MOVES, { idle: 9, walk: 11, attack: 14, hurt: 10, death: 10 }, 0xff6a3a);
export const goblinShaman = unit(SHAMAN, SHAMAN_MOVES, { idle: 6, walk: 8, attack: 12, hurt: 10, death: 10 }, 0x7cf07a);
export const goblinChief = unit(CHIEF, CHIEF_MOVES, { idle: 8, walk: 9, attack: 13, hurt: 10, death: 10 }, 0xff6a3a);

/** The whole band at once, for the Vs. screen: a raider, a shaman, and Snazzlegob in front. */
export const goblins: BossArt = {
  w: SIZE * 2 + 16,
  h: SIZE,
  pixel: 3,
  ground: FLOOR,
  outlined: true,
  crumble: false,
  flash: 0xffffff,
  frames: GOBLIN_FRAMES,
  rate: { idle: 8, walk: 10, attack: 13, hurt: 10, death: 10 },
  ink: INK,
  ember: 0xff6a3a,
  draw(c, p) {
    frame(c, RAIDER, RAIDER_MOVES, p, 1, 4);
    frame(c, SHAMAN, SHAMAN_MOVES, p, 47, 7);
    frame(c, CHIEF, CHIEF_MOVES, p, 24);
  },
};
