// The second bloodmoon's bosses. Every figure faces left, towards the party.

import { attackCurve, DEFAULT_FRAMES, DEFAULT_RATE, FRAME_H, GROUND, ramp, recoil, type BossArt, type Pose } from '../rig';
import { Canvas, ease, hash2, lerp, rotate, span, TAU, type Knot, type Pt } from '../raster';
import { ball, blade, cloth, eye, limb, plate, puffs, ring, rod } from '../parts';

// ---------------------------------------------------------------------------
//  BIG ANGY DRAGON
// ---------------------------------------------------------------------------

const SCALE = ramp('#170406', '#360910', '#63121a', '#9a2020', '#cf3d24', '#f57b3a');
const BELLY = ramp('#3a1a08', '#6e3712', '#a8611e', '#d9952e', '#f6c96a');
const MEMBRANE = ramp('#16050a', '#330a12', '#56121a', '#7c1e1e', '#a8382a');
const HORN = ramp('#2a2218', '#5a4a34', '#8f7b58', '#c8b58c', '#f1e6c6');
const FLAME = ramp('#5a1004', '#b3300a', '#f06a14', '#ffb43a', '#fff0a0', '#ffffff');
const SMOKE = ramp('#1a1616', '#322c2b', '#4e4745', '#6f6966');

function dragonPose(p: Pose): { bob: number; lean: number; neck: number; jaw: number; wing: number; tail: number; breath: number; fire: number; step: number } {
  const cyc = p.t * TAU;
  if (p.anim === 'idle') return { bob: Math.sin(cyc) * 1.2, lean: 0, neck: Math.sin(cyc) * 1.5, jaw: 0.1, wing: Math.sin(cyc) * 0.18, tail: Math.sin(cyc), breath: Math.sin(cyc), fire: 0, step: 0 };
  if (p.anim === 'walk') return { bob: -Math.abs(Math.sin(cyc)) * 2.5, lean: -2, neck: Math.sin(cyc * 2) * 1.2, jaw: 0.1, wing: Math.sin(cyc) * 0.1 - 0.05, tail: Math.sin(cyc + 1) * 1.4, breath: 0, fire: 0, step: Math.sin(cyc) * 5 };
  if (p.anim === 'attack') {
    const { wind, hit } = attackCurve(p.t);
    return { bob: -2 * wind, lean: 5 * wind - 7 * hit, neck: 8 * wind - 10 * hit, jaw: 0.2 + hit * 0.8, wing: -0.35 * wind + 0.25 * hit, tail: wind * 2 - hit, breath: wind, fire: span(p.t, 0.42, 0.56) * (1 - span(p.t, 0.78, 0.98)), step: 0 };
  }
  const k = recoil(p);
  const slump = p.anim === 'death' ? ease.inOut(span(p.t, 0, 0.55)) : 0;
  return { bob: slump * 12, lean: 6 * k, neck: 6 * k + slump * 14, jaw: 0.5 * k, wing: 0.3 * k - slump * 0.5, tail: -k, breath: 0, fire: 0, step: 0 };
}

/** One wing, rooted at `shoulder` and turned by `flap`; `far` wings sit in shade. */
function wing(c: Canvas, shoulder: Pt, flap: number, far: boolean): void {
  const R = (x: number, y: number): Pt => rotate(shoulder[0] + x, shoulder[1] + y, shoulder[0], shoulder[1], flap);
  const shade = far ? -0.28 : 0;
  const wrist = R(24, -34);
  const tips = [R(58, -48), R(70, -20), R(64, 4), R(46, 16)];
  const root = R(26, 12);
  c.layer((part) => {
    // Membrane between the fingers, scalloped between each tip.
    const edge: Pt[] = [shoulder, wrist];
    for (let i = 0; i < tips.length; i++) {
      edge.push(tips[i]);
      const next = i + 1 < tips.length ? tips[i + 1] : root;
      const mid: Pt = [(tips[i][0] + next[0]) / 2, (tips[i][1] + next[1]) / 2];
      const inward: Pt = [lerp(mid[0], wrist[0], 0.22), lerp(mid[1], wrist[1], 0.22)];
      edge.push(inward);
    }
    edge.push(root);
    part.poly(edge, MEMBRANE, (x, y) => 0.5 + shade - Math.hypot(x - wrist[0], y - wrist[1]) * 0.006 + ((x + y) % 7 === 0 ? -0.05 : 0));
    // Bones: the arm to the wrist, and a finger to each tip.
    part.tube([[shoulder[0], shoulder[1], 4], [wrist[0], wrist[1], 3]], SCALE, { shade });
    for (const tip of tips) part.tube([[wrist[0], wrist[1], 2.2], [tip[0], tip[1], 0.9]], SCALE, { shade: shade - 0.05 });
    part.poly([[wrist[0] - 2, wrist[1]], [wrist[0] - 7, wrist[1] - 6], [wrist[0] + 1, wrist[1] - 3]], HORN, 0.6 + shade);
  }, null, 0.5);
}

export const dragon: BossArt = {
  w: 212,
  h: FRAME_H,
  frames: DEFAULT_FRAMES,
  rate: { ...DEFAULT_RATE, idle: 7 },
  ink: 0x0a0204,
  ember: 0xffa040,
  draw(c, p) {
    c.rim = { color: 0xff6040, strength: 0.5 };
    const q = dragonPose(p);
    const cx = 128 + q.lean;
    const cy = 72 + q.bob;
    // The far wing and far legs, in the body's shadow.
    wing(c, [cx - 4, cy - 16], -0.1 + q.wing * 0.8, true);
    limb(c, [cx + 24, cy + 8], [cx + 30 - q.step, GROUND - 2], [14, 16], [9, 6, 4.5], SCALE, 1, -0.25);
    limb(c, [cx - 18, cy + 12], [cx - 14 + q.step, GROUND - 2], [12, 12], [6, 4.5, 3.5], SCALE, 1, -0.25);
    // The tail sweeps out behind, spined along the top.
    const sway = q.tail;
    const tail: Knot[] = [
      [cx + 26, cy + 6, 11],
      [cx + 44, cy + 14 + sway, 9],
      [cx + 60, cy + 12 + sway * 2, 7],
      [cx + 72, cy + 2 + sway * 3, 5],
      [cx + 74, cy - 10 + sway * 3.5, 3],
    ];
    rod(c, tail, SCALE);
    for (let i = 1; i < tail.length; i++) {
      const [x, y, r] = tail[i];
      c.layer((part) => part.poly([[x - 3, y - r + 1], [x + 1, y - r - 5], [x + 3, y - r + 1]], HORN, 0.6), null, 0.5);
    }
    const end = tail[tail.length - 1];
    plate(c, [[end[0] - 1, end[1] + 2], [end[0] + 7, end[1] - 6], [end[0] + 1, end[1] - 12], [end[0] - 5, end[1] - 5]], SCALE, 0.7);
    // The body: a heavy barrel, chest high, belly plates underneath.
    c.layer((part) => {
      part.ellipse(cx, cy, 31, 20 + q.breath * 0.8, SCALE, { rot: -0.14 });
      part.ellipse(cx - 6, cy + 9, 22, 9, BELLY, { rot: -0.14 });
      for (let k = -3; k <= 3; k++) {
        const bx = cx - 6 + k * 6;
        part.line(bx - 1, cy + 3 + k * 0.7, bx + 1, cy + 16 + k * 0.7, BELLY[1]);
      }
    }, null, 0.5);
    // The near hind leg and the foreleg with its claws.
    limb(c, [cx + 18, cy + 4], [cx + 22 + q.step, GROUND - 2], [15, 16], [11, 7, 5], SCALE, 1, 0);
    limb(c, [cx - 22, cy + 8], [cx - 26 - q.step, GROUND - 2], [12, 13], [7, 5, 4], SCALE, 1, 0);
    for (const fx of [cx + 22 + q.step, cx - 26 - q.step]) {
      for (let k = 0; k < 3; k++) c.layer((part) => part.poly([[fx - 6 + k * 3, GROUND - 3], [fx - 9 + k * 3, GROUND + 1], [fx - 4 + k * 3, GROUND - 1]], HORN, 0.7), null, 0.5);
    }
    // The neck coils up and forward to the head.
    const n = q.neck;
    const neck: Knot[] = [
      [cx - 22, cy - 6, 12],
      [cx - 36 + n * 0.4, cy - 18 + n * 0.3, 9.5],
      [cx - 47 + n * 0.8, cy - 28 + n * 0.6, 8],
      [cx - 59 + n, cy - 34 + n * 0.9, 7],
    ];
    rod(c, neck, SCALE, 0.02);
    for (let i = 0; i < neck.length; i++) {
      const [x, y, r] = neck[i];
      c.layer((part) => part.poly([[x - 2, y - r + 1], [x + 3, y - r - 5], [x + 4, y - r + 2]], HORN, 0.65), null, 0.5);
    }
    // The head: horned, brow down, jaw hinged, an ember of an eye.
    const [hx0, hy0] = neck[neck.length - 1];
    const hx = hx0 - 6;
    const hy = hy0 - 2;
    const jaw = q.jaw;
    c.layer((part) => {
      part.tube([[hx + 6, hy - 6, 2.4], [hx + 16, hy - 14, 1.8], [hx + 24, hy - 16, 0.8]], HORN);
      part.tube([[hx + 2, hy - 7, 2], [hx + 10, hy - 18, 1.4], [hx + 14, hy - 24, 0.6]], HORN, { shade: -0.15 });
    }, null, 0.5);
    c.layer((part) => {
      // The lower jaw drops open around its hinge.
      const hinge: Pt = [hx + 4, hy + 2];
      const a = jaw * 0.55;
      const J = (x: number, y: number): Pt => rotate(hinge[0] + x, hinge[1] + y, hinge[0], hinge[1], -a);
      part.poly([J(0, -1), J(-20, 1), J(-19, 4), J(-2, 5)], SCALE, 0.4);
      if (jaw > 0.25) {
        part.poly([[hx - 15, hy + 1], J(-18, 1), J(-3, 1), [hx + 2, hy + 1]], [0x1a0206, 0x4a0810, 0x7a1414], 0.4);
        for (let k = 0; k < 4; k++) {
          const [tx, ty] = J(-16 + k * 4, 0);
          part.dot(tx, ty - 1, HORN[4]);
        }
      }
    }, null, 0.5);
    c.layer((part) => {
      part.ellipse(hx, hy - 2, 11, 8, SCALE, { rot: 0.1 });
      part.poly([[hx - 6, hy - 7], [hx - 22, hy - 3], [hx - 23, hy + 1], [hx - 4, hy + 3]], SCALE, (x) => 0.64 + (x - hx) * 0.004);
      part.dot(hx - 21, hy - 3, SCALE[0]);
      part.dot(hx - 20, hy - 3, SCALE[0]);
      for (let k = 0; k < 4; k++) part.dot(hx - 18 + k * 4, hy + 2, HORN[4]);
    }, null, 0.5);
    // The angy brow, low over a burning eye.
    c.line(hx - 9, hy - 9, hx + 1, hy - 5, SCALE[0], 2);
    eye(c, hx - 5, hy - 5, 0xfff4a0, 0xff9a1a, 2);
    if (p.anim === 'idle' || p.anim === 'walk') puffs(c, [hx - 23, hy - 5], p.t, 2, SMOKE, 10, -6);
    // The near wing rides high over the back.
    wing(c, [cx + 2, cy - 18], q.wing, false);
    // Fire, when it breathes: a widening, flickering tongue.
    if (q.fire > 0.02) {
      const mouth: Pt = [hx - 22, hy + 2];
      const reach = 56 * q.fire;
      for (let k = 0; k < 16; k++) {
        const d = (k / 15) * reach;
        const wob = Math.sin(k * 1.9 + p.f * 2.3) * (2 + d * 0.08);
        const r = 2.5 + d * 0.13;
        c.ellipse(mouth[0] - d, mouth[1] + d * 0.12 + wob, r * 1.2, r, FLAME, { shade: 0.35 - (k / 15) * 0.45 });
      }
      c.ellipse(mouth[0] - 2, mouth[1], 4, 3, FLAME, { shade: 0.5 });
    } else if (q.breath > 0.2 && p.anim === 'attack') {
      c.ellipse(hx - 12, hy + 1, 3 + q.breath * 2, 2, FLAME, { shade: 0.2 });
    }
  },
};

// ---------------------------------------------------------------------------
//  CRUSADE
// ---------------------------------------------------------------------------

const STEEL = ramp('#1e2028', '#3c414f', '#666d80', '#9aa2b6', '#d0d6e4', '#ffffff');
const GILT = ramp('#3a2606', '#76510f', '#b98422', '#e8bb4a', '#fde79a', '#fffbe6');
const LINEN = ramp('#4a453c', '#7c7568', '#aea796', '#d9d3c1', '#f7f3e8', '#ffffff');
const CROSS_RED = ramp('#3a0808', '#6e1212', '#a61e1e', '#d8342c');

export const crusade: BossArt = {
  w: 136,
  h: FRAME_H,
  frames: DEFAULT_FRAMES,
  rate: DEFAULT_RATE,
  ink: 0x0a0a10,
  ember: 0xfde79a,
  draw(c, p) {
    c.rim = { color: 0xe05a48, strength: 0.4 };
    const cyc = p.t * TAU;
    let bob = Math.sin(cyc) * 0.8;
    let lean = 0;
    let hand: Pt = [44, 74];
    let swordA = Math.PI / 2 + 0.25;
    let step = 0;
    let slash = 0;
    let bannerSway = Math.sin(cyc);
    if (p.anim === 'walk') {
      bob = -Math.abs(Math.sin(cyc)) * 2;
      step = Math.sin(cyc) * 5;
      lean = -1;
      hand = [44 - step * 0.3, 74];
    } else if (p.anim === 'attack') {
      const { wind, hit } = attackCurve(p.t);
      lean = 3 * wind - 7 * hit;
      hand = [44 + wind * 22 - hit * 16, 74 - wind * 50 + hit * 8];
      swordA = lerp(lerp(Math.PI / 2 + 0.25, -Math.PI / 2 - 0.6, ease.inOut(span(p.t, 0, 0.38))), Math.PI - 0.35, ease.out(span(p.t, 0.4, 0.52)));
      if (p.t > 0.62) swordA = lerp(Math.PI - 0.35, Math.PI / 2 + 0.25, ease.inOut(span(p.t, 0.62, 1)));
      slash = span(p.t, 0.4, 0.62);
      bannerSway = 1 + wind;
    } else if (p.anim === 'hurt' || p.anim === 'death') {
      const k = recoil(p);
      lean = 5 * k;
      hand = [48, 80];
      swordA = Math.PI / 2 + 0.6;
    }
    const x = 64 + lean;
    const g = GROUND + bob;
    // Halo behind the helm.
    const halo = ring(x - 2, g - 76, 11, 3.2, 20, cyc * 0.5);
    for (const [hx, hy] of halo) c.rect(hx, hy, 2, 1, hy < g - 76 ? GILT[4] : GILT[2]);
    // Banner on its pole, in the far hand.
    const poleX = x + 18;
    rod(c, [[poleX, g - 2, 1.4], [poleX + 1, g - 98, 1.4]], GILT, -0.1);
    c.layer((part) => {
      cloth(part, [[poleX + 1, g - 94], [poleX + 12, g - 94], [poleX + 24, g - 93]], [34, 38, 42], LINEN, { phase: cyc + 0.5, sway: 4 + bannerSway * 3, spread: 10, ripple: 2.5, folds: 2 });
      part.rect(poleX + 8, g - 88, 4, 26, CROSS_RED[2]);
      part.rect(poleX + 2, g - 80, 16, 4, CROSS_RED[2]);
    }, null, 0.5);
    ball(c, poleX + 1, g - 100, 2.4, 2.4, GILT);
    // Cape behind: white outside, red lining.
    c.layer((part) => cloth(part, [[x - 6, g - 66], [x + 6, g - 66], [x + 12, g - 64]], [58, 58, 56], LINEN, { phase: cyc, sway: 8, spread: 14, ripple: 1.8, shade: -0.12 }), null, 0.5);
    // Legs in plate.
    limb(c, [x + 4, g - 36], [x + 7 - step, GROUND - 2], [17, 17], [4.5, 3.8, 3.4], STEEL, 1, -0.16);
    limb(c, [x - 4, g - 36], [x - 7 + step, GROUND - 2], [17, 17], [4.8, 4, 3.6], STEEL, 1, 0);
    for (const fx of [x + 7 - step, x - 7 + step]) plate(c, [[fx - 7, GROUND], [fx - 6, GROUND - 4], [fx + 3, GROUND - 5], [fx + 3, GROUND]], STEEL, 0.55);
    // Breastplate and the tabard over it with its cross.
    ball(c, x, g - 52, 12, 15, STEEL);
    c.layer((part) => {
      cloth(part, [[x - 9, g - 58], [x, g - 59], [x + 8, g - 58]], [30, 32, 30], LINEN, { phase: cyc * 0.5, sway: 1, spread: 4, ripple: 0.8, folds: 1.5 });
      part.rect(x - 2, g - 54, 4, 20, CROSS_RED[2]);
      part.rect(x - 7, g - 49, 14, 4, CROSS_RED[2]);
    }, null, 0.5);
    c.layer((part) => part.rect(x - 11, g - 40, 22, 3, GILT[3]), null, 0.5);
    // Pauldrons and the great helm with its cross-shaped slit.
    ball(c, x + 9, g - 62, 7, 5.5, STEEL, -0.1);
    c.layer((part) => {
      part.ellipse(x - 2, g - 76, 8.5, 10, STEEL);
      part.rect(x - 10, g - 84, 17, 3, STEEL[2]);
      part.rect(x - 10, g - 77, 11, 2, 0x06060a);
      part.rect(x - 6, g - 82, 2, 12, 0x06060a);
      part.dot(x - 8, g - 77, GILT[4]);
      part.rect(x - 1, g - 90, 2, 6, GILT[3]);
      part.rect(x - 3, g - 88, 6, 2, GILT[3]);
    }, null, 0.5);
    ball(c, x - 9, g - 61, 7.5, 6, STEEL);
    // The sword arm and the longsword.
    const grip = limb(c, [x - 9, g - 60], hand, [13, 13], [3.6, 3, 3], STEEL, -1, 0);
    blade(c, grip, swordA, 34, 4, STEEL, { guard: GILT, guardWidth: 5 });
    if (slash > 0 && slash < 1) {
      for (let k = 0; k < 18; k++) {
        const a = lerp(-Math.PI / 2 - 0.6, Math.PI - 0.35, (k / 17) * slash) ;
        const r = 36 + (k % 3);
        c.dot(x - 9 + Math.cos(a) * r, g - 60 + Math.sin(a) * r, k > 14 * slash ? GILT[5] : GILT[4]);
      }
    }
  },
};

// ---------------------------------------------------------------------------
//  BARAL, ARTIFICER OF NOPE
// ---------------------------------------------------------------------------

const COAT = ramp('#081226', '#10244a', '#1a3b78', '#2a5caa', '#4f88d4', '#9cc4ff');
const BRASS = ramp('#2a1706', '#583410', '#95601e', '#cf9738', '#f5cd6a', '#fff2c4');
const FACE = ramp('#3a2620', '#6e4c3e', '#a8806a', '#d8b498', '#f6dcc4');
const ZAP = ramp('#0a4a6a', '#1aa0d8', '#7ae8ff', '#e6fdff', '#ffffff');
const DARK = ramp('#07080b', '#12141a', '#1f2330', '#323848', '#4c5468');

function gear(c: Canvas, x: number, y: number, r: number, teeth: number, turn: number, shade = 0): void {
  c.layer((part) => {
    for (let k = 0; k < teeth; k++) {
      const a = turn + (k / teeth) * TAU;
      part.rect(x + Math.cos(a) * (r + 1) - 1, y + Math.sin(a) * (r + 1) - 1, 2, 2, BRASS[3]);
    }
    part.ellipse(x, y, r, r, BRASS, { shade });
    part.ellipse(x, y, r * 0.35, r * 0.35, BRASS, { shade: shade - 0.35 });
  }, null, 0.5);
}

function bolt(c: Canvas, from: Pt, to: Pt, seed: number): void {
  let last = from;
  const steps = 7;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const jitter = i < steps ? (hash2(i, seed) - 0.5) * 10 : 0;
    const next: Pt = [lerp(from[0], to[0], t), lerp(from[1], to[1], t) + jitter];
    c.line(last[0], last[1], next[0], next[1], ZAP[2], 3);
    c.line(last[0], last[1], next[0], next[1], ZAP[4], 1);
    last = next;
  }
}

export const baral: BossArt = {
  w: 132,
  h: FRAME_H,
  frames: DEFAULT_FRAMES,
  rate: DEFAULT_RATE,
  ink: 0x05070c,
  ember: 0x7ae8ff,
  draw(c, p) {
    c.rim = { color: 0xe05848, strength: 0.4 };
    const cyc = p.t * TAU;
    // Stiff: the whole figure moves as one plank.
    let tilt = Math.sin(cyc) * 0.012;
    let lean = 0;
    let staff: Pt = [40, 70];
    let zap = 0;
    let step = 0;
    let bob = 0;
    if (p.anim === 'walk') {
      step = Math.sin(cyc) * 4;
      bob = -Math.abs(Math.sin(cyc)) * 1.5;
      tilt = -0.04;
    } else if (p.anim === 'attack') {
      const { wind, hit } = attackCurve(p.t);
      lean = 2 * wind - 4 * hit;
      staff = [40 + wind * 6 - hit * 6, 70 - wind * 22 + hit * 4];
      zap = span(p.t, 0.42, 0.9);
    } else if (p.anim === 'hurt' || p.anim === 'death') {
      const k = recoil(p);
      lean = 4 * k;
      tilt = 0.08 * k;
    }
    const x = 64 + lean;
    const g = GROUND + bob;
    const T = (px: number, py: number): Pt => rotate(px, py, x, g, tilt);
    // The drone circles him; behind first when it is on the far side.
    const orbit = cyc + (p.anim === 'attack' ? p.t * 3 : 0);
    const droneAt: Pt = [x + Math.cos(orbit) * 34, g - 78 + Math.sin(orbit) * 6];
    const droneFront = Math.sin(orbit) > 0;
    const drone = (): void => {
      ball(c, droneAt[0], droneAt[1], 4.5, 4, BRASS);
      eye(c, droneAt[0] - 2, droneAt[1], ZAP[4], ZAP[2], 1);
      const pa = p.f * 1.3;
      c.line(droneAt[0] - Math.cos(pa) * 6, droneAt[1] - 6, droneAt[0] + Math.cos(pa) * 6, droneAt[1] - 6, BRASS[4]);
      c.dot(droneAt[0], droneAt[1] - 5, BRASS[2]);
    };
    if (!droneFront) drone();
    // The boiler on his back, a coil crackling on top.
    const [bx, by] = T(x + 13, g - 58);
    rod(c, [[bx, by + 10, 7], [bx, by - 12, 7]], BRASS, -0.08);
    for (let k = 0; k < 4; k++) c.layer((part) => part.ellipse(bx, by - 16 - k * 3, 4 - k * 0.6, 1.6, [0x5a2a10, 0x9a4a1a, 0xd8742a, 0xffb060]), null, 0.5);
    if (p.f % 2 === 0 || zap > 0) bolt(c, [bx, by - 28], [bx + 8 + (p.f % 3) * 3, by - 36], p.f + 11);
    puffs(c, [bx + 6, by - 14], p.t, 2, [0x4a5060, 0x7a8294, 0xb0b8c8], 12, 3);
    // Long legs and brass-capped boots.
    for (const [lx, sh, dir] of [[x + 3 - step, -0.16, 1], [x - 4 + step, 0, -1]] as const) {
      const hip = T(lx, g - 38);
      rod(c, [[hip[0], hip[1], 2.6], [lx - dir * 0.5, GROUND - 4, 2.2]], DARK, sh);
      plate(c, [[lx - 6, GROUND], [lx - 5, GROUND - 5], [lx + 3, GROUND - 6], [lx + 3, GROUND]], BRASS, 0.55 + sh);
    }
    // The coat: long, buttoned, stiff as a board.
    c.layer((part) => {
      const top = [T(x - 9, g - 70), T(x, g - 71), T(x + 9, g - 70)];
      cloth(part, top, [40, 42, 46], COAT, { phase: cyc * 0.3, sway: 2, spread: 6, ripple: 0.6, folds: 2 });
      for (let k = 0; k < 4; k++) {
        const [px, py] = T(x - 4, g - 64 + k * 7);
        part.dot(px, py, BRASS[4]);
      }
    }, null, 0.5);
    // A far arm with a wrench.
    const wrench = limb(c, T(x + 7, g - 66), T(x + 16, g - 44), [11, 11], [2.8, 2.4, 2.2], COAT, -1, -0.18);
    rod(c, [[wrench[0], wrench[1], 1.2], [wrench[0] + 4, wrench[1] + 10, 1.2]], DARK, -0.1);
    c.layer((part) => part.poly([[wrench[0] + 2, wrench[1] + 10], [wrench[0] + 8, wrench[1] + 10], [wrench[0] + 7, wrench[1] + 15], [wrench[0] + 5, wrench[1] + 12], [wrench[0] + 3, wrench[1] + 15]], DARK, 0.6), null, 0.5);
    // Head: long face, a white moustache, a monocle that glows.
    const [hx, hy] = T(x - 2, g - 74);
    ball(c, hx, hy, 6.5, 8.5, FACE);
    c.layer((part) => part.poly([[hx - 9, hy + 3], [hx - 3, hy + 1], [hx + 3, hy + 3], [hx - 2, hy + 5], [hx - 8, hy + 6]], LINEN, 0.7), null, 0.5);
    c.layer((part) => {
      for (const [ax, ay] of ring(hx - 4, hy - 2, 3, 3, 10, 0)) part.dot(ax, ay, BRASS[4]);
      part.rect(hx - 5, hy - 3, 2, 2, ZAP[3]);
    }, null, 0.4);
    c.dot(hx + 1, hy - 2, DARK[0]);
    // The top hat, gear on the band and goggles up.
    c.layer((part) => {
      part.ellipse(hx, hy - 8, 10, 2.4, DARK);
      part.poly([[hx - 7, hy - 9], [hx + 7, hy - 9], [hx + 7, hy - 26], [hx - 7, hy - 26]], DARK, (px) => 0.62 - (px - hx) * 0.04);
      part.ellipse(hx, hy - 26, 7, 1.8, DARK, { shade: 0.1 });
      part.rect(hx - 7, hy - 15, 14, 3, BRASS[2]);
    }, null, 0.5);
    gear(c, hx + 4, hy - 18, 3.5, 8, p.t * TAU * 0.5, 0);
    for (const gx of [hx - 5, hx + 1]) c.layer((part) => {
      part.ellipse(gx, hy - 13, 2.6, 2.6, BRASS);
      part.rect(gx - 1, hy - 14, 2, 2, ZAP[2]);
    }, null, 0.5);
    // The clockwork arm, holding a staff capped with a crackling orb.
    const [sx, sy] = T(x - 8, g - 66);
    const { joint, tip } = { joint: [lerp(sx, staff[0], 0.5) + 3, lerp(sy, staff[1], 0.5) + 3] as Pt, tip: staff };
    rod(c, [[sx, sy, 3.4], [joint[0], joint[1], 2.8]], BRASS);
    rod(c, [[joint[0], joint[1], 2.8], [tip[0], tip[1], 2.4]], BRASS, -0.05);
    gear(c, joint[0], joint[1], 2.6, 6, -p.t * TAU, 0);
    rod(c, [[tip[0] + 2, tip[1] + 22, 1.3], [tip[0] - 2, tip[1] - 16, 1.3]], DARK);
    const orb: Pt = [tip[0] - 2, tip[1] - 19];
    ball(c, orb[0], orb[1], 4, 4, ZAP, 0.2);
    if (p.f % 2 === 1) bolt(c, [orb[0], orb[1]], [orb[0] - 6, orb[1] - 7], p.f + 3);
    if (droneFront) drone();
    if (zap > 0 && zap < 1) {
      bolt(c, orb, [2, orb[1] + 10 + Math.sin(p.f * 2) * 6], p.f * 7 + 1);
      bolt(c, orb, [6, orb[1] - 8], p.f * 5 + 2);
    }
  },
};

export const TIER2: Record<string, BossArt> = { dragon, crusade, baral };

// ---------------------------------------------------------------------------
//  BARAL'S WORKS: THE ARTIFACT OF DENIAL AND THE DRAKE
// ---------------------------------------------------------------------------

const CRYSTAL = ramp('#06122e', '#0c2a5c', '#16509a', '#2c86d0', '#6cc4f4', '#d4f4ff');
const STONE = ramp('#0d0e12', '#1c1e26', '#2e313c', '#474b58', '#666b7a');

/** A crystal that hangs over a brass-bound plinth, the rune of refusal burning in it. */
export const denialArtifact: BossArt = {
  w: 56,
  h: FRAME_H,
  pixel: 1.5,
  frames: DEFAULT_FRAMES,
  rate: { ...DEFAULT_RATE, idle: 7 },
  ink: 0x04060c,
  ember: 0x7ae8ff,
  draw(c, p) {
    c.rim = { color: 0x7ae8ff, strength: 0.35 };
    const cyc = p.t * TAU;
    let bob = Math.sin(cyc) * 1.5;
    let tilt = 0;
    let flare = 0.35 + Math.sin(cyc * 2) * 0.15;
    if (p.anim === 'attack') {
      const { wind, hit } = attackCurve(p.t);
      bob -= wind * 3;
      flare = Math.min(1, 0.4 + wind * 0.4 + hit);
    } else if (p.anim === 'hurt' || p.anim === 'death') {
      const k = recoil(p);
      tilt = 0.12 * k;
      flare = 0.15;
      if (p.anim === 'death') bob += ease.inOut(span(p.t, 0, 0.4)) * 10;
    }
    const x = 28;
    const cy = GROUND - 40 + bob;
    const T = (px: number, py: number): Pt => rotate(px, py, x, cy, tilt);
    // The plinth, squat stone bound in brass.
    plate(c, [[x - 13, GROUND], [x - 11, GROUND - 7], [x + 11, GROUND - 7], [x + 13, GROUND]], STONE, 0.55);
    c.layer((part) => part.rect(x - 12, GROUND - 8, 24, 2, BRASS[3]), null, 0.5);
    for (const bx of [x - 8, x, x + 8]) c.dot(bx, GROUND - 4, BRASS[4]);
    // The glow it casts on its plinth.
    for (let k = -6; k <= 6; k++) c.dot(x + k * 1.4, GROUND - 9, flare > 0.6 ? CRYSTAL[5] : CRYSTAL[4]);
    // Brass rings circle it: the far half behind the crystal, the near half in front.
    const spin = cyc * (p.anim === 'attack' ? 2 : 1);
    const orbit = ring(x, cy + 2, 17, 4, 26, spin);
    for (const [ox, oy] of orbit) if (oy < cy + 2) c.rect(ox, oy, 2, 1, BRASS[2]);
    // The crystal: a long diamond, lit from the upper left, facets split down the middle.
    const top = T(x, cy - 24);
    const left = T(x - 10, cy - 2);
    const right = T(x + 10, cy - 2);
    const bottom = T(x, cy + 18);
    const middle = T(x + 1, cy - 2);
    c.layer((part) => {
      part.poly([top, left, bottom, middle], CRYSTAL, (px, py) => 0.72 - (py - cy) * 0.006 + (px < x - 5 ? 0.06 : 0));
      part.poly([top, middle, bottom, right], CRYSTAL, (px, py) => 0.44 - (py - cy) * 0.006 - (px - x) * 0.01);
    }, null, 0.5);
    c.line(top[0], top[1], middle[0], middle[1], CRYSTAL[5]);
    c.line(top[0] - 1, top[1] + 4, left[0] + 2, left[1], CRYSTAL[4]);
    // The rune of refusal: a ring struck through.
    const [rx, ry] = T(x, cy - 3);
    const rune = flare > 0.7 ? 0xffffff : CRYSTAL[5];
    for (const [ax, ay] of ring(rx, ry, 4.5, 4.5, 16, 0)) c.dot(ax, ay, rune);
    c.line(rx - 3, ry + 3, rx + 3, ry - 3, rune);
    if (flare > 0.55) for (const [ax, ay] of ring(rx, ry, 6, 6, 12, spin)) c.dot(ax, ay, CRYSTAL[4]);
    for (const [ox, oy] of orbit) if (oy >= cy + 2) c.rect(ox, oy, 2, 1, BRASS[4]);
    // Stifling: refusal sparks out in every direction.
    if (p.anim === 'attack' && flare > 0.8) {
      const reach = 10 + span(p.t, 0.4, 0.8) * 14;
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * TAU + p.t;
        c.line(rx + Math.cos(a) * (reach - 4), ry + Math.sin(a) * (reach - 4), rx + Math.cos(a) * reach, ry + Math.sin(a) * reach, ZAP[3 + (k % 2)]);
      }
    }
    // Hurt, it cracks.
    if (p.anim === 'hurt' || p.anim === 'death') {
      c.line(rx - 2, ry - 12, rx + 3, ry - 4, CRYSTAL[0]);
      c.line(rx + 3, ry - 4, rx - 1, ry + 6, CRYSTAL[0]);
    }
  },
};

/** A little clockwork drake: brass plates, a wound key in its back, glass eyes that glow blue. */
export const baralDrake: BossArt = {
  w: 84,
  h: FRAME_H,
  pixel: 1.5,
  frames: DEFAULT_FRAMES,
  rate: { ...DEFAULT_RATE, idle: 10, walk: 12 },
  ink: 0x0a0602,
  ember: 0xf5cd6a,
  draw(c, p) {
    c.rim = { color: 0x7ae8ff, strength: 0.3 };
    const cyc = p.t * TAU;
    let bob = Math.abs(Math.sin(cyc * 2)) * 0.8;
    let lean = 0;
    let flap = Math.sin(cyc * 2) * 0.25;
    let step = 0;
    let jaw = 0;
    let spark = 0;
    if (p.anim === 'walk') {
      bob = Math.abs(Math.sin(cyc)) * 1.6;
      step = Math.sin(cyc) * 3.5;
      flap = Math.sin(cyc * 2) * 0.15 - 0.1;
      lean = -1;
    } else if (p.anim === 'attack') {
      const { wind, hit } = attackCurve(p.t);
      lean = 3 * wind - 8 * hit;
      bob = wind * 2;
      flap = -0.5 * wind + 0.35 * hit;
      jaw = Math.max(wind * 0.6, hit);
      spark = span(p.t, 0.42, 0.7) * (1 - span(p.t, 0.75, 0.95));
    } else if (p.anim === 'hurt' || p.anim === 'death') {
      const k = recoil(p);
      lean = 4 * k;
      flap = 0.4 * k;
      jaw = 0.4 * k;
    }
    const x = 48 + lean;
    const g = GROUND - bob;
    // The tail, ending in a little gear.
    rod(c, [[x + 10, g - 20, 3.2], [x + 19, g - 18 + Math.sin(cyc) * 1.2, 2.2], [x + 26, g - 23 + Math.sin(cyc + 1) * 1.8, 1.4]], BRASS, -0.05);
    gear(c, x + 27, g - 24 + Math.sin(cyc + 1) * 1.8, 2.4, 6, cyc, 0);
    // The far wing, in shade behind the body.
    const wingAt: Pt = [x + 3, g - 27];
    const drakeWing = (turn: number, shade: number): void => {
      const R = (dx: number, dy: number): Pt => rotate(wingAt[0] + dx, wingAt[1] + dy, wingAt[0], wingAt[1], turn);
      c.layer((part) => {
        part.poly([wingAt, R(10, -14), R(18, -12), R(16, -4), R(9, 1)], COAT, 0.52 + shade);
        part.line(wingAt[0], wingAt[1], R(10, -14)[0], R(10, -14)[1], BRASS[3]);
        part.line(R(10, -14)[0], R(10, -14)[1], R(18, -12)[0], R(18, -12)[1], BRASS[3]);
        part.line(wingAt[0], wingAt[1], R(16, -4)[0], R(16, -4)[1], BRASS[2]);
      }, null, 0.5);
    };
    drakeWing(-0.2 + flap * 0.8, -0.25);
    // Legs: far pair in shade, then the near pair, brass-footed.
    limb(c, [x + 6, g - 18], [x + 8 - step, GROUND - 1], [9, 9], [2.4, 2, 1.8], DARK, -1, -0.1);
    limb(c, [x - 6, g - 18], [x - 8 + step, GROUND - 1], [9, 9], [2.4, 2, 1.8], DARK, 1, -0.1);
    // The body: a riveted brass barrel.
    ball(c, x, g - 21, 12, 7.5, BRASS, 0, -0.08);
    c.layer((part) => {
      part.ellipse(x - 1, g - 17, 8, 3, BRASS, { shade: -0.15 });
      for (let k = -2; k <= 2; k++) part.dot(x + k * 4, g - 25 + Math.abs(k) * 0.6, BRASS[5]);
    }, null, 0.5);
    // The wind-up key in its back turns as it goes.
    const keyTurn = Math.cos(cyc * 2);
    rod(c, [[x + 4, g - 28, 1], [x + 4, g - 33, 1]], DARK);
    c.layer((part) => {
      part.ellipse(x + 4 - 3 * Math.abs(keyTurn), g - 35, 2.6 * Math.abs(keyTurn) + 0.6, 2, BRASS);
      part.ellipse(x + 4 + 3 * Math.abs(keyTurn), g - 35, 2.6 * Math.abs(keyTurn) + 0.6, 2, BRASS);
    }, null, 0.5);
    limb(c, [x + 5, g - 16], [x + 5 + step, GROUND - 1], [9, 9], [2.6, 2.2, 2], BRASS, -1, 0);
    limb(c, [x - 7, g - 16], [x - 7 - step, GROUND - 1], [9, 9], [2.6, 2.2, 2], BRASS, 1, 0);
    for (const fx of [x + 5 + step, x - 7 - step]) c.layer((part) => part.rect(fx - 3, GROUND - 2, 5, 2, BRASS[2]), null, 0.5);
    // Neck and head, jaw hinged, a blue glass eye.
    const hx = x - 16;
    const hy = g - 31;
    rod(c, [[x - 8, g - 24, 3.6], [x - 12, g - 28, 3], [hx + 2, hy + 1, 2.8]], BRASS, 0.02);
    c.layer((part) => {
      const a = jaw * 0.5;
      const J = (dx: number, dy: number): Pt => rotate(hx + 1 + dx, hy + 2 + dy, hx + 1, hy + 2, -a);
      part.poly([J(0, 0), J(-11, 1), J(-10, 3), J(-1, 3)], BRASS, 0.4);
    }, null, 0.5);
    ball(c, hx, hy, 6, 4.5, BRASS, 0.05);
    c.layer((part) => {
      part.poly([[hx - 3, hy - 3], [hx - 13, hy - 1], [hx - 13, hy + 2], [hx - 2, hy + 2]], BRASS, (px) => 0.66 + (px - hx) * 0.006);
      part.poly([[hx + 2, hy - 3], [hx + 7, hy - 9], [hx + 5, hy - 2]], BRASS, 0.7);
    }, null, 0.5);
    eye(c, hx - 3, hy - 1, ZAP[4], ZAP[2], 1);
    c.dot(hx - 12, hy, DARK[1]);
    // The near wing over the back.
    drakeWing(flap, 0);
    // The bite: a crackle of blue between the jaws.
    if (spark > 0.05) bolt(c, [hx - 12, hy + 2], [hx - 22 - spark * 6, hy + 4], p.f * 3 + 5);
  },
};

export const UNITS2: Record<string, BossArt> = {
  'denial-artifact': denialArtifact,
  'baral-drake': baralDrake,
};
