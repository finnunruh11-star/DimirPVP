// The first bloodmoon's bosses. Every figure faces left, towards the party.

import { attackCurve, DEFAULT_FRAMES, DEFAULT_RATE, FRAME_H, GROUND, ramp, recoil, type BossArt, type Pose } from '../rig';
import { Canvas, ease, hash2, lit, noise2, span, TAU, type Pt } from '../raster';
import { ball, cloth, eye, limb, plate, rod } from '../parts';
import { goblinChief, goblinRaider, goblins, goblinShaman } from './goblins';

// ---------------------------------------------------------------------------
//  ANGY BIG ROCK
// ---------------------------------------------------------------------------

const STONE = ramp('#121110', '#27231e', '#3e3830', '#5b5347', '#817765', '#aea38b');
const MOSS = ramp('#0b190a', '#162d13', '#244a1c', '#376e2a', '#5b9a40');
const EYE = 0xff9a2e;
const EYE_CORE = 0xfff0b8;

/** A lump of stone: faceted, cracked and mossed on top. Texture rides with the lump. */
function boulder(c: Canvas, cx: number, cy: number, rx: number, ry: number, seed: number, opts: { moss?: number; shade?: number } = {}): void {
  const reach = Math.max(rx, ry) + 2;
  for (let y = Math.floor(cy - reach); y <= Math.ceil(cy + reach); y++) {
    for (let x = Math.floor(cx - reach); x <= Math.ceil(cx + reach); x++) {
      const u = (x + 0.5 - cx) / rx;
      const v = (y + 0.5 - cy) / ry;
      // A lumpy, slightly squared rim: the outline wanders with the angle.
      const angle = Math.atan2(v, u);
      const rim = 1 + (noise2(Math.cos(angle) * 1.6 + 9, Math.sin(angle) * 1.6 + seed, seed) - 0.5) * 0.2;
      const square = (Math.abs(u) ** 3 + Math.abs(v) ** 3) ** (1 / 3);
      const d = (Math.hypot(u, v) * 0.55 + square * 0.45) / rim;
      if (d > 1) continue;
      const nz = Math.sqrt(Math.max(0, 1 - d * d));
      const lx = x - cx;
      const ly = y - cy;
      // Facets: broad planes of one brightness, as if chiselled.
      const facet = (Math.floor(noise2(lx / 9 + seed, ly / 9, seed) * 4) / 4 - 0.4) * 0.22;
      const light = lit(u / rim, v / rim, nz) + facet + (opts.shade ?? 0);
      const crack = Math.abs(noise2(lx / 11, ly / 11, seed + 5) - 0.5) < 0.022 && d < 0.93;
      const mossy = (opts.moss ?? 0) > 0 && v < 0.05 && noise2(lx / 5, ly / 4, seed + 3) > 1.02 - (opts.moss ?? 0) + v * 0.9;
      if (crack) {
        c.px.set(x, y, STONE[1]);
        continue;
      }
      const color = mossy ? c.pick(MOSS, light + 0.08, x, y, 0.3) : c.pick(STONE, light, x, y, 0.3);
      c.px.set(x, y, c.rimmed(color, u, v, nz));
    }
  }
}

function rockPose(p: Pose): {
  bob: number; lean: number; squash: number; fistF: Pt; fistB: Pt; stepF: number; stepB: number; brow: number; sink: number; glow: number;
} {
  const breath = Math.sin(p.t * TAU);
  const pose = { bob: 0, lean: 0, squash: 0, fistF: [30, 94] as Pt, fistB: [110, 88] as Pt, stepF: 0, stepB: 0, brow: 1, sink: 0, glow: 0.5 + breath * 0.5 };
  if (p.anim === 'idle') {
    pose.bob = breath * 0.9;
    pose.squash = breath * 0.7;
    pose.fistF = [30, 94 + breath * 0.8];
    pose.fistB = [110, 88 - breath * 0.6];
  } else if (p.anim === 'walk') {
    const step = Math.sin(p.t * TAU);
    pose.bob = -Math.abs(Math.cos(p.t * TAU)) * 2.2;
    pose.lean = -2;
    pose.stepF = step * 4;
    pose.stepB = -step * 4;
    pose.fistF = [30 - step * 5, 92 - Math.max(0, step) * 3];
    pose.fistB = [110 + step * 5, 87 - Math.max(0, -step) * 3];
  } else if (p.anim === 'attack') {
    const { wind, hit } = attackCurve(p.t);
    pose.lean = -9 * hit + 4 * wind;
    pose.bob = -5 * wind + 3 * hit;
    pose.squash = -1.5 * wind + 2 * hit;
    pose.fistF = [30 + wind * 18 - hit * 12, 94 - wind * 64 + hit * 4];
    pose.fistB = [110 - wind * 34 - hit * 50, 88 - wind * 64 + hit * 10];
    pose.brow = 1.5;
    pose.glow = 0.5 + wind * 0.5;
  } else {
    const k = recoil(p);
    const slump = p.anim === 'death' ? ease.inOut(span(p.t, 0, 0.6)) : 0;
    pose.lean = 5 * k;
    pose.bob = -2 * k + slump * 3;
    pose.sink = slump * 3;
    pose.squash = slump;
    pose.brow = 0.3;
    pose.fistF = [34 + 4 * k, 95 + slump * 5];
    pose.fistB = [113 + 3 * k, 89 + slump * 6];
    pose.glow = p.anim === 'death' ? 1 - slump : 0.2;
  }
  return pose;
}

function pebbles(c: Canvas, p: Pose, cx: number, cy: number, front: boolean): void {
  if (p.anim === 'death' && p.t > 0.4) return;
  const spin = p.anim === 'attack' ? p.t * TAU * 1.5 : p.t * TAU;
  for (let k = 0; k < 3; k++) {
    const a = spin + (k * TAU) / 3;
    if ((Math.sin(a) > 0) !== front) continue;
    const x = cx + Math.cos(a) * 50;
    const y = cy - 16 + Math.sin(a) * 12 + Math.sin(a * 2 + k) * 2;
    c.layer((part) => boulder(part, x, y, 3.2 + (k % 2), 2.8 + (k % 2), 40 + k, { shade: front ? 0 : -0.15 }), null, 0.5);
  }
}

/** A stone arm: shoulder, forearm and a fist too big for it, each its own boulder. */
function stoneArm(c: Canvas, shoulder: Pt, fist: Pt, seed: number, shade: number): void {
  const ex = (shoulder[0] + fist[0]) / 2 + (fist[0] < shoulder[0] ? 3 : -3);
  const ey = (shoulder[1] + fist[1]) / 2 + 4;
  c.layer((part) => boulder(part, shoulder[0], shoulder[1], 11, 10, seed, { moss: 0.32, shade }), null, 0.55);
  c.layer((part) => boulder(part, ex, ey, 8, 8, seed + 1, { shade: shade - 0.04 }), null, 0.55);
  c.layer((part) => boulder(part, fist[0], fist[1], 12, 11, seed + 2, { moss: 0.15, shade }), null, 0.5);
}

export const rock: BossArt = {
  w: 136,
  h: FRAME_H,
  frames: DEFAULT_FRAMES,
  rate: { ...DEFAULT_RATE, idle: 7, walk: 8 },
  ink: 0x0a0907,
  ember: 0x9cd064,
  draw(c, p) {
    c.rim = { color: 0xd8503a, strength: 0.55 };
    const q = rockPose(p);
    const cx = 72 + q.lean;
    const cy = 70 + q.bob + q.sink;
    pebbles(c, p, cx, cy - 6, false);
    // The far arm and leg first, pushed back into shade.
    stoneArm(c, [cx + 26, cy - 10], q.fistB, 21, -0.2);
    c.layer((part) => boulder(part, cx + 14 + q.stepB, GROUND - 7, 12, 8, 31, { shade: -0.14 }), null, 0.55);
    c.layer((part) => boulder(part, cx + 4, cy + 4, 33 - q.squash * 0.4, 27 + q.squash, 7, { moss: 0.4 }), null, 0.5);
    c.layer((part) => boulder(part, cx - 12 + q.stepF, GROUND - 7, 13, 8, 33), null, 0.55);
    // The head juts forward off the top of the body.
    const hx = cx - 13 + q.lean * 0.3;
    const hy = cy - 24 + q.squash * 0.5;
    c.layer((part) => boulder(part, hx, hy, 19, 15, 11, { moss: 0.45, shade: 0.04 }), null, 0.5);
    const glow = q.glow;
    const hot = glow > 0.55 ? EYE_CORE : EYE;
    const eyes: [number, number, number][] = [[hx - 12, hy - 1, 7], [hx + 1, hy - 3, 5]];
    for (const [x, y, w] of eyes) {
      c.rect(x - 1, y - 1, w + 2, 5, STONE[0]);
      c.rect(x, y, w, 3, EYE);
      c.rect(x + 1, y + 1, w - 2, 1, hot);
    }
    // A heavy brow slab, low in the middle: angy.
    const lift = (1 - q.brow) * 3;
    c.layer((part) => part.poly([
      [hx - 17, hy - 8 - lift], [hx - 4, hy - 1 - lift * 0.4], [hx + 8, hy - 7 - lift], [hx + 8, hy - 11 - lift], [hx - 4, hy - 6 - lift * 0.4], [hx - 16, hy - 12 - lift],
    ], STONE, (x, y) => 0.62 - (y - hy + 12) * 0.05), null, 0.6);
    // A jagged mouth, lit from inside when it is angriest.
    const my = hy + 8;
    const mouth: Pt[] = [[hx - 14, my], [hx - 10, my - 3], [hx - 6, my + 1], [hx - 2, my - 3], [hx + 2, my + 1], [hx + 5, my - 2]];
    for (let i = 0; i < mouth.length - 1; i++) c.line(mouth[i][0], mouth[i][1], mouth[i + 1][0], mouth[i + 1][1], STONE[0], 2);
    if (glow > 0.35) for (let i = 1; i < mouth.length - 1; i++) c.dot(mouth[i][0], mouth[i][1] + (i % 2 ? 1 : -1), i % 2 ? EYE : 0xc85a20);
    // The near arm in front of everything.
    stoneArm(c, [cx - 22, cy - 2], q.fistF, 23, 0);
    pebbles(c, p, cx, cy - 6, true);
    if (p.anim === 'attack') {
      const impact = span(p.t, 0.5, 0.8);
      if (impact > 0 && impact < 1) {
        for (let k = 0; k < 9; k++) {
          const a = Math.PI + (k / 8) * Math.PI * 0.9 + 0.1;
          const d = 6 + impact * (16 + hash2(k, 3) * 12);
          const x = q.fistF[0] + Math.cos(a) * d;
          const y = GROUND - 2 + Math.sin(a) * d * 0.7 + impact * impact * 12;
          c.rect(x, y, 2 + (k % 2), 2, STONE[3 + (k % 2)]);
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------
//  THE FEARED "HRRRK SNAZZLEGOB" AND HIS BAND: drawn in the toon style, see ./goblins
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
//  EVIL MINION OF MINOR VILLAINY
// ---------------------------------------------------------------------------

const CAPE = ramp('#07040c', '#140a22', '#241238', '#381c55', '#552b7a');
const LINING = ramp('#2a0718', '#520d2c', '#86183f', '#b92b52', '#e25a74');
const PALE = ramp('#1d1624', '#3b2e47', '#5e4d6c', '#86739a', '#b9a8c9', '#e3d8ee');
const SUIT = ramp('#07060a', '#141119', '#231d2c', '#372d44', '#51425f');
const GOLD = ramp('#2e1d05', '#664210', '#a8701c', '#e0a838', '#ffe08a', '#fff6d2');
const BOMB = ramp('#060608', '#131419', '#23252d', '#3b3f4c', '#6c7285');
const BONE = ramp('#3b3325', '#786c54', '#b6a987', '#ebe1c2');

export const minion: BossArt = {
  w: 120,
  h: FRAME_H,
  frames: DEFAULT_FRAMES,
  rate: { ...DEFAULT_RATE, idle: 9 },
  ink: 0x050308,
  ember: 0xb46cff,
  draw(c, p) {
    c.rim = { color: 0xe04858, strength: 0.5 };
    const cyc = p.t * TAU;
    let bob = Math.sin(cyc) * 1.2;
    let lean = 0;
    let bombHand: Pt = [34, 84];
    let twirl: Pt = [44, 70];
    let flare = 0;
    let bomb: Pt | null = null;
    let boom = 0;
    let step = 0;
    let grin = 1;
    if (p.anim === 'walk') {
      bob = -Math.abs(Math.sin(cyc)) * 3;
      step = Math.sin(cyc) * 4;
      lean = -2;
      bombHand = [36, 82 + Math.sin(cyc) * 2];
      twirl = [46, 72];
      flare = 0.4;
    } else if (p.anim === 'attack') {
      const { wind, hit } = attackCurve(p.t);
      lean = 3 * wind - 5 * hit;
      bombHand = [48 + wind * 20 - hit * 26, 82 - wind * 34 + hit * 14];
      flare = wind * 0.8 + hit;
      grin = 1.4;
      const fly = span(p.t, 0.45, 0.8);
      if (fly > 0 && fly < 1) bomb = [bombHand[0] - fly * 34, 52 - Math.sin(fly * Math.PI) * 18 + fly * 30];
      boom = span(p.t, 0.8, 1);
    } else if (p.anim === 'hurt' || p.anim === 'death') {
      const k = recoil(p);
      lean = 5 * k;
      grin = 0;
      bombHand = [38, 88];
      twirl = [52, 78];
    } else {
      twirl = [44 + Math.cos(cyc * 2) * 1.5, 70 + Math.sin(cyc * 2) * 1.5];
    }
    const x = 60 + lean;
    const y = GROUND + bob;
    // The cape behind, sweeping right and flaring when it moves.
    c.layer((part) => cloth(part, [[x - 6, y - 50], [x + 6, y - 50], [x + 16, y - 48]], [48, 47, 44], CAPE, { phase: cyc, sway: 10 + flare * 8, spread: 18 + flare * 10, ripple: 2 }), null, 0.5);
    c.layer((part) => cloth(part, [[x + 2, y - 48], [x + 12, y - 46]], [40, 36], LINING, { phase: cyc + 1, sway: 12 + flare * 8, spread: 8, ripple: 1.5, shade: -0.1 }), null, 0.5);
    // Spindly legs in pointed shoes.
    for (const [lx, dir] of [[x + 4 - step, 1], [x - 4 + step, -1]] as const) {
      rod(c, [[lx, y - 22, 2.2], [lx - dir * 0.5, y - 3, 1.6]], SUIT, dir > 0 ? -0.12 : 0);
      c.layer((part) => part.poly([[lx - 1, y - 4], [lx + 3, y - 4], [lx + 2, y], [lx - 7, y], [lx - 8, y - 3]], SUIT, 0.5), null, 0.5);
    }
    // A pear of a body in a black suit with a gold-buttoned front.
    ball(c, x, y - 32, 12, 14, SUIT);
    c.layer((part) => part.poly([[x - 5, y - 44], [x + 1, y - 44], [x + 2, y - 22], [x - 6, y - 24]], LINING, 0.5), null, 0.5);
    for (let k = 0; k < 3; k++) c.dot(x - 2, y - 40 + k * 6, GOLD[4]);
    // High collar points either side of the head.
    plate(c, [[x - 12, y - 46], [x - 16, y - 66], [x - 5, y - 50]], CAPE, 0.55);
    plate(c, [[x + 8, y - 48], [x + 16, y - 70], [x + 13, y - 46]], CAPE, 0.4);
    // The head: pale, pointed chin, a sly grin and a curled moustache.
    const hx = x - 3;
    const hy = y - 58;
    c.layer((part) => {
      part.ellipse(hx, hy, 10, 9.5, PALE);
      part.poly([[hx - 8, hy + 3], [hx + 5, hy + 6], [hx - 6, hy + 14]], PALE, 0.45);
    }, null, 0.5);
    eye(c, hx - 6, hy - 2, 0xfff27a, 0xd89a1a, 2);
    eye(c, hx + 1, hy - 2, 0xfff27a, 0xd89a1a, 2);
    c.line(hx - 9, hy - 7, hx - 3, hy - 4, PALE[0], 2);
    c.line(hx + 4, hy - 7, hx - 1, hy - 4, PALE[0], 2);
    const my = hy + 5;
    for (let k = 0; k <= 8; k++) {
      const mx = hx - 8 + k * 1.6;
      const dip = Math.sin((k / 8) * Math.PI) * 2.2 * grin;
      c.dot(mx, my + dip, PALE[0]);
      if (grin > 0 && k % 2 === 1 && k < 8) c.dot(mx, my + dip - 1, BONE[3]);
    }
    for (const side of [-1, 1]) {
      c.line(hx - 3, my - 2, hx - 3 + side * 5, my - 1, SUIT[0], 1);
      c.dot(hx - 3 + side * 6, my - 2, SUIT[0]);
      c.dot(hx - 3 + side * 6, my - 3, SUIT[0]);
    }
    // A small top hat, jauntily tilted.
    c.layer((part) => {
      part.ellipse(hx + 1, hy - 9, 9, 2.4, SUIT, { rot: -0.18 });
      part.poly([[hx - 4, hy - 10], [hx + 5, hy - 12], [hx + 7, hy - 24], [hx - 3, hy - 22]], SUIT, 0.55);
      part.poly([[hx - 4, hy - 13], [hx + 6, hy - 15], [hx + 6, hy - 17], [hx - 4, hy - 15]], LINING, 0.6);
    }, null, 0.5);
    // The far hand twirls the moustache; the near one holds a lit bomb.
    limb(c, [x + 6, y - 42], twirl, [9, 9], [2.2, 1.8, 2], PALE, 1, -0.15);
    const hand = limb(c, [x - 8, y - 42], bombHand, [9, 9], [2.3, 1.9, 2.1], PALE, -1, 0);
    const held = bomb ?? (p.anim === 'attack' && p.t >= 0.45 ? null : [hand[0] - 2, hand[1] - 5] as Pt);
    if (held) {
      ball(c, held[0], held[1], 5, 5, BOMB);
      c.dot(held[0] - 2, held[1] - 2, BOMB[4]);
      const fuse: Pt = [held[0] + 2, held[1] - 6];
      c.line(held[0] + 1, held[1] - 4, fuse[0], fuse[1], GOLD[1]);
      const spark = (p.f % 2) ? GOLD[5] : 0xff7a2a;
      c.dot(fuse[0], fuse[1] - 1, spark);
      c.dot(fuse[0] + (p.f % 3) - 1, fuse[1] - 2, GOLD[4]);
    }
    if (boom > 0 && boom < 1) {
      const bx = 16;
      const by = 86;
      const r = 4 + boom * 12;
      c.ellipse(bx, by, r, r * 0.8, [0x3a1206, 0x9a3a10, 0xf08a2a, 0xffd870, 0xfff6d0], { shade: 0.3 - boom * 0.6 });
    }
  },
};

// ---------------------------------------------------------------------------
//  ZARGARG DER AUSGEDACHTE: a made-up thing, and it knows it
// ---------------------------------------------------------------------------

const INK_BLUE = ramp('#060a22', '#0d1a4a', '#16307c', '#2552b4', '#4a86e0', '#9cc8ff');
const IDEA = ramp('#0a3a5a', '#1a7ab0', '#46c0f0', '#b4f0ff', '#ffffff');
const STAR = 0xfff2a8;

export const zargarg: BossArt = {
  w: 124,
  h: FRAME_H,
  frames: DEFAULT_FRAMES,
  rate: { ...DEFAULT_RATE, idle: 8 },
  ink: 0x030618,
  ember: 0x9cc8ff,
  draw(c, p) {
    c.rim = { color: 0xe05070, strength: 0.4 };
    const cyc = p.t * TAU;
    let hover = Math.sin(cyc) * 3;
    let lean = 0;
    let reach: Pt = [30, 58];
    let idea = 1;
    let blink = p.anim === 'idle' && p.f === 5;
    let shards = 0;
    if (p.anim === 'walk') {
      lean = -4;
      hover = Math.sin(cyc) * 2 - 2;
      reach = [32, 60];
    } else if (p.anim === 'attack') {
      const { wind, hit } = attackCurve(p.t);
      lean = 3 * wind - 6 * hit;
      reach = [36 + wind * 10 - hit * 16, 56 - wind * 12 + hit * 6];
      idea = 1 + wind * 0.7 + hit * 0.4;
      shards = span(p.t, 0.45, 0.9);
    } else if (p.anim === 'hurt' || p.anim === 'death') {
      const k = recoil(p);
      lean = 6 * k;
      reach = [40, 66];
      idea = p.anim === 'death' ? Math.max(0, 1 - p.t * 2) : 0.8;
      blink = p.f % 2 === 0;
    }
    const x = 66 + lean;
    const base = GROUND - 8 + hover;
    // A robe that frays into scribbles where feet should be. The scribbles boil frame to frame.
    for (let k = 0; k < 6; k++) {
      const sx = x - 14 + k * 6;
      let px = sx;
      let py = base - 6;
      for (let i = 0; i < 5; i++) {
        const nx = sx + Math.sin(i * 1.7 + k + p.f * 0.9) * 3;
        const ny = py + 3;
        c.line(px, py, nx, ny, INK_BLUE[3 + ((i + k) % 2)]);
        px = nx;
        py = ny;
      }
    }
    c.layer((part) => {
      cloth(part, [[x - 10, base - 58], [x - 2, base - 60], [x + 8, base - 58]], [52, 54, 52], INK_BLUE, { phase: cyc + p.f * 0.4, sway: -2 - lean * 0.3, spread: 26, ripple: 2.2, folds: 2.5 });
      for (let k = 0; k < 14; k++) {
        const sx = x - 14 + ((k * 37) % 28);
        const sy = base - 52 + ((k * 23) % 44);
        if ((k + p.f) % 4 !== 0) part.dot(sx, sy, k % 3 ? INK_BLUE[5] : STAR);
      }
    }, null, 0.5);
    // Far arm raised, conjuring nothing much.
    limb(c, [x + 6, base - 54], [x + 16, base - 70 + Math.sin(cyc) * 2], [11, 11], [2.4, 1.9, 2], INK_BLUE, 1, -0.18);
    // A big round head with one enormous eye.
    const hx = x - 3;
    const hy = base - 66;
    ball(c, hx, hy, 12, 11.5, INK_BLUE, 0.05);
    for (let k = 0; k < 4; k++) {
      const bx = hx - 7 + k * 4;
      c.line(bx, hy + 7, bx - 1 + Math.sin(k + p.f) * 1.5, hy + 15 + (k % 2) * 2, INK_BLUE[4]);
    }
    if (blink) {
      c.line(hx - 9, hy - 1, hx + 1, hy - 1, INK_BLUE[5], 2);
    } else {
      c.layer((part) => {
        part.ellipse(hx - 4, hy - 1, 6.5, 5.5, [0x8aa0c8, 0xc8d6ee, 0xf2f6ff, 0xffffff]);
        part.ellipse(hx - 7, hy - 1, 3, 3.2, IDEA);
        part.rect(hx - 8, hy - 2, 2, 2, 0x04081a);
        part.dot(hx - 6, hy - 3, 0xffffff);
      }, INK_BLUE[0], 0.5);
    }
    // The hat: tall, starry, and bent over at the tip.
    c.layer((part) => {
      part.ellipse(hx + 1, hy - 10, 15, 3.2, INK_BLUE, { rot: -0.08 });
      const tip: Pt = [hx + 14 + Math.sin(cyc) * 2, hy - 44];
      part.poly([[hx - 9, hy - 11], [hx + 11, hy - 12], [hx + 6, hy - 30], [tip[0], tip[1]], [hx - 1, hy - 32]], INK_BLUE, (px, py) => 0.62 - (px - hx) * 0.02 - (hy - py) * 0.004);
      for (const [sx, sy] of [[hx - 2, hy - 18], [hx + 5, hy - 25], [hx + 1, hy - 34], [hx + 9, hy - 37]] as const) {
        part.dot(sx, sy, STAR);
        if ((p.f + sx) % 3 === 0) {
          part.dot(sx - 1, sy, STAR);
          part.dot(sx + 1, sy, STAR);
          part.dot(sx, sy - 1, STAR);
          part.dot(sx, sy + 1, STAR);
        }
      }
    }, null, 0.5);
    // Near arm, and above its palm the impossible triangle it thought up.
    const palm = limb(c, [x - 8, base - 54], reach, [12, 12], [2.5, 2, 2.2], INK_BLUE, -1, 0);
    if (idea > 0) {
      const tx = palm[0] - 2;
      const ty = palm[1] - 14;
      const r = 8 * idea;
      const turn = p.t * TAU / 3 + (p.anim === 'attack' ? p.t * 2 : 0);
      const corners = [0, 1, 2].map((i) => [tx + Math.cos(turn + (i * TAU) / 3 - Math.PI / 2) * r, ty + Math.sin(turn + (i * TAU) / 3 - Math.PI / 2) * r] as Pt);
      c.layer((part) => {
        for (let i = 0; i < 3; i++) {
          const a = corners[i];
          const b = corners[(i + 1) % 3];
          const cc = corners[(i + 2) % 3];
          // Each bar runs past its corner a little, over the next and under the last.
          const ax = a[0] + (a[0] - cc[0]) * 0.18;
          const ay = a[1] + (a[1] - cc[1]) * 0.18;
          part.line(ax, ay, b[0], b[1], IDEA[2 + i % 3], 3);
          part.line(ax, ay, b[0], b[1], IDEA[4 - (i % 2)], 1);
        }
      }, IDEA[0], 0.4);
    }
    if (shards > 0 && shards < 1) {
      for (let k = 0; k < 8; k++) {
        const a = Math.PI + (k - 3.5) * 0.16;
        const d = 10 + shards * 50 + (k % 3) * 4;
        const sx = palm[0] + Math.cos(a) * d;
        const sy = palm[1] - 12 + Math.sin(a) * d * 0.6;
        c.line(sx, sy, sx + 4, sy + (k % 2 ? 1 : -1), IDEA[3 + (k % 2)], 2);
      }
    }
  },
};

export const TIER1: Record<string, BossArt> = { goblins, minion, rock, zargarg };

export const UNITS1: Record<string, BossArt> = {
  'goblin-chief': goblinChief,
  'goblin-raider': goblinRaider,
  'goblin-shaman': goblinShaman,
};
