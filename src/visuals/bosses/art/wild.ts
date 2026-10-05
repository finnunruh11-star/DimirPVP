// Folk of the roadside scenes, painted like the bloodmoon's units: a maned lion,
// a leaner lioness and a dwarven guard with his hammer. All face left and stand
// on a small frame drawn at two screen pixels to the art pixel.

import { attackCurve, DEFAULT_FRAMES, DEFAULT_RATE, ramp, recoil, type BossArt, type Pose } from '../rig';
import { ease, lerp, span, TAU, type Canvas, type Pt } from '../raster';
import { ball, eye, limb, plate, rod } from '../parts';

const FUR = ramp('#2e1c0c', '#5e3c16', '#8f6326', '#c38d3e', '#e0b264', '#f5d994');
const PALE = ramp('#6a5030', '#a88a5a', '#d8bd88', '#f2dfb2', '#fff4d8');
const MANE = ramp('#1c0c04', '#40200a', '#6a3812', '#94541e', '#b8742e', '#d69a4c');
const MOUTH = ramp('#1a0404', '#4a0c0c', '#7a1a16');
const NOSE = 0x2a1410;
const FANG = 0xfff6e0;

const W = 92;
const H = 64;
const FLOOR = 58;

interface CatPose {
  bob: number;
  lean: number;
  step: number;
  lift: number;
  /** The near forepaw raised (wind-up) and swept forward (the blow). */
  raise: number;
  swipe: number;
  jaw: number;
  tail: number;
  head: number;
}

function catPose(p: Pose): CatPose {
  const cyc = p.t * TAU;
  const rest = { bob: 0, lean: 0, step: 0, lift: 0, raise: 0, swipe: 0, jaw: 0, tail: 0, head: 0 };
  if (p.anim === 'idle') return { ...rest, bob: Math.sin(cyc) * 0.8, tail: Math.sin(cyc) * 1.4, head: Math.sin(cyc) * 0.6, jaw: p.f === 5 ? 0.35 : 0 };
  if (p.anim === 'walk') return { ...rest, bob: -Math.abs(Math.sin(cyc)) * 1.6, lean: -1, step: Math.sin(cyc), lift: Math.max(0, Math.cos(cyc)), tail: Math.sin(cyc + 1) * 2, head: Math.sin(cyc * 2) * 0.8 };
  if (p.anim === 'attack') {
    const { wind, hit } = attackCurve(p.t);
    return { ...rest, bob: wind * 4 - hit * 3, lean: 6 * wind - 16 * hit, raise: wind * (1 - hit), swipe: hit, jaw: Math.max(wind * 0.4, hit), tail: wind * 3 - hit, head: wind * 2 - hit * 2 };
  }
  const k = recoil(p);
  const slump = p.anim === 'death' ? ease.inOut(span(p.t, 0, 0.5)) : 0;
  return { ...rest, bob: slump * 16, lean: 7 * k, jaw: 0.5 * k, tail: -k * 2, head: 3 * k + slump * 8 };
}

/** One big cat, `s` times the size of the lion drawn at 1. */
function drawCat(c: Canvas, p: Pose, male: boolean, s: number): void {
  c.rim = { color: 0xffd890, strength: 0.35 };
  const q = catPose(p);
  const cx = 48 + q.lean * s;
  const legH = 30 * s;
  const cy = FLOOR - legH - 8 * s + q.bob * s;
  const half = 30 * s;
  const front = cx - half + 7 * s;
  const hind = cx + half - 7 * s;
  const stride = 6 * s * q.step;
  const lift = 5 * s * q.lift;
  const foot = FLOOR - 1;

  // The far legs, in the body's shade.
  limb(c, [front + 4 * s, cy + 4 * s], [front + 3 * s + stride, foot - (q.step < 0 ? lift : 0)], [17 * s, 17 * s], [5 * s, 4 * s, 3.2 * s], FUR, 1, -0.28);
  limb(c, [hind + 3 * s, cy + 2 * s], [hind + 5 * s - stride, foot - (q.step > 0 ? lift : 0)], [19 * s, 19 * s], [7 * s, 4.5 * s, 3.2 * s], FUR, -1, -0.28);

  // The tail, low and swinging, with its dark tuft.
  const tw = q.tail * s;
  const tail: Pt[] = [
    [cx + half, cy - 3 * s],
    [cx + half + 12 * s, cy - 1 * s + tw * 0.5],
    [cx + half + 19 * s, cy + 8 * s + tw],
    [cx + half + 21 * s, cy + 18 * s + tw * 1.5],
  ];
  rod(c, tail.map(([x, y], i) => [x, y, (3.2 - i * 0.5) * s] as const), FUR, -0.05);
  const [tx, ty] = tail[tail.length - 1];
  ball(c, tx, ty + 2 * s, 3 * s, 4 * s, MANE, 0.05);

  // The body: a long, deep chest and a paler belly.
  c.layer((part) => {
    part.ellipse(cx, cy, half + 4 * s, 12.5 * s, FUR, { rot: 0.03 });
    part.ellipse(cx - 3 * s, cy + 7 * s, half - 5 * s, 5.5 * s, PALE, { shade: -0.12 });
  }, null, 0.5);
  ball(c, hind + 1 * s, cy - 1 * s, 12 * s, 12 * s, FUR, 0.04);

  // The near hind leg, then the near foreleg: planted, or raised and swiping.
  limb(c, [hind, cy + 3 * s], [hind - stride, foot - (q.step > 0 ? 0 : lift)], [19 * s, 19 * s], [8 * s, 5 * s, 3.6 * s], FUR, -1, 0);
  const pawRest: Pt = [front + stride, foot - (q.step < 0 ? 0 : lift)];
  const paw: Pt = [
    pawRest[0] - (6 * q.raise + 14 * q.swipe) * s,
    pawRest[1] - (22 * q.raise + 4 * q.swipe * (1 - q.swipe)) * s,
  ];
  const pawAt = limb(c, [front + 1 * s, cy + 4 * s], paw, [17 * s, 17 * s], [6 * s, 4.5 * s, 3.6 * s], FUR, 1, 0);
  ball(c, pawAt[0] - 1 * s, pawAt[1] - 0.5 * s, 3.6 * s, 2.4 * s, FUR, 0.1);
  if (q.raise > 0.3 || q.swipe > 0.1) {
    for (let k = 0; k < 3; k++) c.dot(pawAt[0] - 4 * s, pawAt[1] - 2 * s + k * 1.5 * s, FANG);
  }

  // The head, carried low in front of the shoulders.
  const hx = front - 6 * s;
  const hy = cy - 9 * s + q.head * s;
  if (male) {
    // The mane: a shaggy dark ruff round the head and down the chest.
    const mx = hx + 7 * s;
    const my = hy + 4 * s;
    const spikes = 18;
    for (let k = 0; k < spikes; k++) {
      const a = (k / spikes) * TAU + (p.anim === 'walk' ? Math.sin(p.t * TAU) * 0.05 : 0);
      const r = (k % 2 ? 20 : 24) * s;
      const tip: Pt = [mx + Math.cos(a) * r, my + Math.sin(a) * r * 1.1];
      const l: Pt = [mx + Math.cos(a - 0.26) * 14 * s, my + Math.sin(a - 0.26) * 15 * s];
      const rr: Pt = [mx + Math.cos(a + 0.26) * 14 * s, my + Math.sin(a + 0.26) * 15 * s];
      plate(c, [l, tip, rr], MANE, 0.42 + (k % 3) * 0.06, 0.004);
    }
    ball(c, mx, my, 16 * s, 18 * s, MANE, 0.02);
  } else {
    rod(c, [[front + 3 * s, cy - 4 * s, 7 * s], [hx + 3 * s, hy + 3 * s, 6 * s]], FUR);
  }
  ball(c, hx + (male ? 3 : 4) * s, hy - 8 * s, 2.8 * s, 3 * s, FUR, male ? -0.2 : 0);
  ball(c, hx, hy, 10.5 * s, 9.5 * s, FUR, 0.08);
  c.layer((part) => {
    // The lower jaw drops open around its hinge.
    const drop = q.jaw * 5 * s;
    part.poly([[hx - 2 * s, hy + 4 * s], [hx - 13 * s, hy + 4 * s + drop * 0.6], [hx - 12 * s, hy + 7 * s + drop], [hx - 2 * s, hy + 8 * s]], PALE, 0.45);
    if (q.jaw > 0.3) {
      part.poly([[hx - 3 * s, hy + 4 * s], [hx - 13 * s, hy + 3.5 * s], [hx - 12 * s, hy + 4 * s + drop * 0.7]], MOUTH, 0.5);
      part.dot(hx - 11 * s, hy + 4 * s, FANG);
      part.dot(hx - 11 * s, hy + 3 * s + drop * 0.7, FANG);
    }
    // The muzzle and the nose on its tip.
    part.ellipse(hx - 8 * s, hy + 2 * s, 6.5 * s, 4.2 * s, PALE, { shade: 0.05 });
  }, null, 0.5);
  c.rect(hx - 15 * s, hy - 0.5 * s, 2.5 * s, 2 * s, NOSE);
  c.line(hx - 9 * s, hy - 5.5 * s, hx - 3 * s, hy - 4 * s, FUR[0]);
  eye(c, hx - 6 * s, hy - 3.5 * s, 0xfff0a0, 0xc88a20, 1);
}

const lionArt = (male: boolean, s: number, ember: number): BossArt => ({
  w: W,
  h: H,
  pixel: 2,
  ground: FLOOR,
  frames: DEFAULT_FRAMES,
  rate: { ...DEFAULT_RATE, idle: 6 },
  ink: 0x120804,
  ember,
  draw: (c, p) => drawCat(c, p, male, s),
});

export const lion = lionArt(true, 0.62, 0xffb040);
export const lioness = lionArt(false, 0.54, 0xffd070);

// ---------------------------------------------------------------------------
//  THE DWARVEN GUARD
// ---------------------------------------------------------------------------

const STEEL = ramp('#1e2028', '#3c414f', '#666d80', '#9aa2b6', '#d0d6e4', '#f4f6fa');
const MAIL = ramp('#23262e', '#40444f', '#5f6572', '#858c99', '#b0b6c2');
const SKIN = ramp('#4a2a1c', '#7a4a32', '#a86c4c', '#cf9370', '#ecb898');
const BEARD = ramp('#2a1406', '#5a2c0e', '#8a4a1a', '#b86e2c', '#dc9a4e');
const LEATHER = ramp('#1e140c', '#3a2818', '#5c4028', '#80603c', '#a8825a');
const HAFT = ramp('#2a1a0c', '#4e3218', '#74502a', '#9a7040');
const BRASS = 0xe0b04a;

/** Where his hands hold the haft and which way the hammer head points from them. */
function dwarfPose(p: Pose): { bob: number; lean: number; step: number; hand: Pt; angle: number } {
  const cyc = p.t * TAU;
  const rest = -Math.PI / 2 - 0.35;
  if (p.anim === 'idle') return { bob: Math.sin(cyc) * 0.6, lean: 0, step: 0, hand: [-8, -17], angle: rest + Math.sin(cyc) * 0.04 };
  if (p.anim === 'walk') return { bob: -Math.abs(Math.sin(cyc)) * 1.2, lean: -1, step: Math.sin(cyc) * 3, hand: [-8, -18], angle: rest + Math.sin(cyc) * 0.08 };
  if (p.anim === 'attack') {
    const { wind, hit } = attackCurve(p.t);
    const swing = ease.out(span(p.t, 0.4, 0.55));
    const back = lerp(rest, -0.5, wind);
    return {
      bob: wind * -1 + hit * 1.5,
      lean: 2 * wind - 4 * hit,
      step: 0,
      hand: [lerp(-8, -2, wind) - hit * 8, lerp(-17, -30, wind) + hit * 14],
      angle: p.t < 0.4 ? back : lerp(-0.5, -Math.PI * 1.08, swing) + (p.t > 0.6 ? lerp(0, rest + Math.PI * 1.08, span(p.t, 0.6, 1)) : 0),
    };
  }
  const k = recoil(p);
  const slump = p.anim === 'death' ? ease.inOut(span(p.t, 0, 0.5)) : 0;
  return { bob: slump * 6, lean: 4 * k, step: 0, hand: [-6, -15 + slump * 6], angle: rest + 0.5 * k + slump };
}

export const dwarfGuard: BossArt = {
  w: 76,
  h: H,
  pixel: 2,
  ground: FLOOR,
  frames: DEFAULT_FRAMES,
  rate: { ...DEFAULT_RATE, idle: 6 },
  ink: 0x0c0806,
  ember: 0xffc860,
  draw(c, p) {
    c.rim = { color: 0xffe0a0, strength: 0.3 };
    const q = dwarfPose(p);
    const x = 46 + q.lean;
    const g = FLOOR + q.bob;
    const hand: Pt = [x + q.hand[0], g + q.hand[1]];
    // Short legs in leather, heavy boots.
    limb(c, [x + 3, g - 14], [x + 4 - q.step, FLOOR - 1], [7, 7], [3.2, 2.8, 2.6], LEATHER, -1, -0.22);
    limb(c, [x - 3, g - 14], [x - 4 + q.step, FLOOR - 1], [7, 7], [3.4, 3, 2.8], LEATHER, -1, 0);
    for (const fx of [x + 4 - q.step, x - 4 + q.step]) plate(c, [[fx - 5, FLOOR], [fx - 5, FLOOR - 3], [fx + 3, FLOOR - 4], [fx + 3, FLOOR]], LEATHER, 0.5);
    // The far arm reaches round to the haft.
    limb(c, [x + 5, g - 27], [hand[0] + 2, hand[1] + 1], [7, 7], [2.6, 2.2, 2.2], MAIL, 1, -0.25);
    // A barrel of mail, belted with brass.
    ball(c, x, g - 22, 9.5, 10, MAIL, 0.02);
    c.layer((part) => {
      part.rect(x - 9, g - 17, 18, 3, LEATHER[2]);
      part.rect(x - 2, g - 17, 3, 3, BRASS);
    }, null, 0.5);
    // The head, the beard over the chest, and the iron cap.
    ball(c, x - 1, g - 35, 6, 6, SKIN, 0.05);
    c.layer((part) => {
      part.poly([[x - 7, g - 36], [x + 3, g - 35], [x + 3, g - 26], [x - 2, g - 19], [x - 9, g - 25]], BEARD, (px, py) => 0.62 - (py - (g - 36)) * 0.012 + (px - x) * 0.01);
      part.line(x - 5, g - 28, x - 5, g - 21, BEARD[1]);
      part.line(x - 1, g - 28, x - 1, g - 21, BEARD[1]);
    }, null, 0.5);
    ball(c, x - 7, g - 34, 2.2, 1.8, SKIN, 0.1);
    c.layer((part) => {
      part.ellipse(x, g - 39, 7, 5, STEEL);
      part.rect(x - 8, g - 38, 16, 2, STEEL[1]);
      part.rect(x - 1, g - 44, 2, 5, STEEL[3]);
    }, null, 0.5);
    c.rect(x - 6, g - 36, 2, 1, 0x0c0806);
    // The hammer: an iron head on a stout haft, and the near arm on it.
    const dx = Math.cos(q.angle);
    const dy = Math.sin(q.angle);
    const head: Pt = [hand[0] + dx * 16, hand[1] + dy * 16];
    rod(c, [[hand[0] - dx * 4, hand[1] - dy * 4, 1.3], [head[0], head[1], 1.3]], HAFT);
    const nx = -dy;
    const ny = dx;
    const corner = (a: number, b: number): Pt => [head[0] + nx * a + dx * b, head[1] + ny * a + dy * b];
    plate(c, [corner(-5, -2.5), corner(5, -2.5), corner(5, 2.5), corner(-5, 2.5)], STEEL, 0.62, 0.02);
    limb(c, [x - 4, g - 28], hand, [7, 7], [2.8, 2.4, 2.4], MAIL, -1, 0);
    ball(c, hand[0], hand[1], 2, 2, LEATHER, 0.1);
  },
};

export const WILD: Record<string, BossArt> = { lion, lioness, 'dwarf-guard': dwarfGuard };
