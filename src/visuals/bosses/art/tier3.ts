// The third bloodmoon's bosses (and every one after). Every figure faces left.

import { attackCurve, DEFAULT_FRAMES, DEFAULT_RATE, FRAME_H, GROUND, ramp, recoil, type BossArt, type Pose } from '../rig';
import { Canvas, ease, lerp, rotate, span, TAU, type Pt, type Ramp } from '../raster';
import { ball, blade, cloth, eye, limb, plate, puffs, ring, rod } from '../parts';
import { lillithOrb } from './lillithOrb';

// ---------------------------------------------------------------------------
//  PLANETAR
// ---------------------------------------------------------------------------

const EMERALD = ramp('#061a0c', '#0e3418', '#1a5a26', '#2c8a38', '#4fbc4e', '#a4ec84');
const FEATHER = ramp('#4a4c5e', '#7c7f96', '#adb1c8', '#d8dcec', '#f4f6ff', '#ffffff');
const AURUM = ramp('#3a2606', '#7a5410', '#bf8a1e', '#ecc04a', '#fff0a0', '#fffbe8');
const VERDANT = ramp('#0a3a24', '#1a7a4a', '#46c884', '#9affc8', '#e8fff4', '#ffffff');
const ROBE = ramp('#4a4a42', '#7c7a6e', '#b2af9e', '#dddac8', '#f8f6ec');

/** A feathered wing from `root`; `open` fans it, `far` sinks it into shade. */
function featherWing(c: Canvas, root: Pt, lift: number, open: number, far: boolean): void {
  const shade = far ? -0.26 : 0;
  const rows: { count: number; len: number; width: number; from: number; to: number; reach: number }[] = [
    { count: 7, len: 25, width: 3.8, from: -1.5, to: 0.35, reach: 30 },
    { count: 6, len: 16, width: 3.3, from: -1.4, to: 0.15, reach: 20 },
    { count: 5, len: 10, width: 3, from: -1.25, to: -0.05, reach: 10 },
  ];
  c.layer((part) => {
    for (const row of rows) {
      for (let k = 0; k < row.count; k++) {
        const t = k / (row.count - 1);
        const a = lerp(row.from, row.to, t) * open - lift;
        const bx = root[0] + Math.cos(a) * row.reach * 0.55;
        const by = root[1] + Math.sin(a) * row.reach * 0.55;
        const tipA = a + 0.35;
        const len = row.len * (0.75 + 0.25 * Math.sin(t * Math.PI));
        part.ellipse(bx + Math.cos(tipA) * len * 0.5, by + Math.sin(tipA) * len * 0.5, len * 0.55, row.width, FEATHER, { rot: tipA, shade: shade - t * 0.06 });
      }
    }
  }, null, 0.45);
}

export const planetar: BossArt = {
  w: 164,
  h: FRAME_H,
  frames: DEFAULT_FRAMES,
  rate: { ...DEFAULT_RATE, idle: 7 },
  ink: 0x040a06,
  ember: 0x9affc8,
  draw(c, p) {
    c.rim = { color: 0xe06050, strength: 0.4 };
    const cyc = p.t * TAU;
    let hover = Math.sin(cyc) * 2.5;
    let flap = Math.sin(cyc) * 0.16;
    let lean = 0;
    let grip: Pt = [70, 64];
    let swordA = -2.25;
    let arc = 0;
    let glow = 0.5 + Math.sin(cyc) * 0.2;
    if (p.anim === 'walk') {
      lean = -3;
      flap = Math.sin(cyc) * 0.3;
      hover = Math.sin(cyc) * 3 - 2;
    } else if (p.anim === 'attack') {
      const { wind, hit } = attackCurve(p.t);
      lean = 4 * wind - 8 * hit;
      flap = -0.35 * wind + 0.3 * hit;
      grip = [70 + wind * 14 - hit * 16, 64 - wind * 30 + hit * 12];
      swordA = lerp(lerp(-2.25, -1.3, ease.inOut(span(p.t, 0, 0.38))), -3.7, ease.out(span(p.t, 0.4, 0.52)));
      if (p.t > 0.62) swordA = lerp(-3.7, -2.25, ease.inOut(span(p.t, 0.62, 1)));
      arc = span(p.t, 0.4, 0.62);
      glow = 0.5 + wind * 0.5;
    } else if (p.anim === 'hurt' || p.anim === 'death') {
      const k = recoil(p);
      lean = 6 * k;
      flap = 0.25 * k;
      hover = p.anim === 'death' ? ease.inOut(span(p.t, 0, 0.5)) * -8 : 0;
      glow = 0.2;
    }
    const x = 80 + lean;
    const g = GROUND - 6 + hover;
    // Light pooled on the ground under it.
    for (const [rx, ry] of ring(x, GROUND - 1, 18, 2.5, 18, cyc)) c.dot(rx, ry, VERDANT[2 + ((rx | 0) % 2)]);
    featherWing(c, [x + 12, g - 60], flap + 0.12, 0.95, true);
    featherWing(c, [x + 6, g - 58], flap, 1, false);
    // Halo.
    for (const [hx, hy] of ring(x - 4, g - 88, 12, 3.5, 22, cyc * 0.4)) c.rect(hx, hy, 2, 1, hy < g - 88 ? AURUM[4] : AURUM[2]);
    // Legs, hanging as it hovers.
    limb(c, [x + 4, g - 34], [x + 8, g - 4], [15, 15], [4.5, 3.6, 3], EMERALD, 1, -0.16);
    limb(c, [x - 3, g - 34], [x - 6, g - 2], [15, 15], [4.8, 3.8, 3.2], EMERALD, 1, 0);
    for (const fx of [x + 8, x - 6]) plate(c, [[fx - 3, g - 12], [fx + 3, g - 12], [fx + 2, g - 4], [fx - 3, g - 4]], AURUM, 0.6);
    // A pale skirt under a golden cuirass.
    c.layer((part) => cloth(part, [[x - 10, g - 38], [x, g - 39], [x + 10, g - 38]], [16, 18, 16], ROBE, { phase: cyc, sway: 2, spread: 8, ripple: 1.2 }), null, 0.5);
    c.layer((part) => {
      part.ellipse(x, g - 52, 13, 15, AURUM);
      part.line(x - 9, g - 50, x + 9, g - 50, AURUM[1]);
      part.line(x, g - 64, x, g - 40, AURUM[1]);
      part.ellipse(x, g - 56, 3, 3, VERDANT, { shade: glow - 0.5 });
    }, null, 0.5);
    ball(c, x + 11, g - 64, 7, 5.5, AURUM, -0.12);
    // A stern bald head with eyes of pure light and a golden circlet.
    const hx = x - 3;
    const hy = g - 76;
    ball(c, hx, hy, 8, 9, EMERALD, 0.05);
    c.layer((part) => part.rect(hx - 8, hy - 5, 16, 2, AURUM[3]), null, 0.5);
    c.line(hx - 7, hy - 2, hx - 2, hy - 1, EMERALD[0]);
    eye(c, hx - 5, hy, 0xffffff, VERDANT[3], 1);
    eye(c, hx - 1, hy, 0xffffff, VERDANT[3], 1);
    c.line(hx - 6, hy + 5, hx - 2, hy + 5, EMERALD[1]);
    // The near shoulder, then both hands on a greatsword of green light.
    ball(c, x - 11, g - 63, 7, 5.5, AURUM);
    const hands = limb(c, [x - 11, g - 62], grip, [14, 14], [4, 3.2, 3], EMERALD, -1, 0);
    limb(c, [x + 8, g - 62], [hands[0] + 5, hands[1] + 2], [15, 15], [3.6, 3, 2.8], EMERALD, -1, -0.12);
    rod(c, [[hands[0] - Math.cos(swordA) * 6, hands[1] - Math.sin(swordA) * 6, 1.6], [hands[0], hands[1], 1.6]], AURUM);
    blade(c, hands, swordA, 50, 6, VERDANT, { guard: AURUM, guardWidth: 7, glow: glow - 0.5 });
    if (arc > 0 && arc < 1) {
      for (let k = 0; k < 24; k++) {
        const a = lerp(-1.3, -3.7, (k / 23) * arc);
        const r = 54 + (k % 3);
        c.rect(hands[0] + Math.cos(a) * r, hands[1] + Math.sin(a) * r, 2, 2, k % 2 ? VERDANT[4] : VERDANT[5]);
      }
    }
  },
};

// ---------------------------------------------------------------------------
//  MINI SELGA: summoners, two of them
// ---------------------------------------------------------------------------

const VESTMENT = ramp('#4a453e', '#7e776a', '#b3ac99', '#dcd6c3', '#f7f3e6', '#ffffff');
const TRIM = ramp('#4a3208', '#8a6414', '#cf9a2c', '#f5cf6a', '#fff4c4');
const HAIR = ramp('#4a1a2e', '#86304e', '#c05a78', '#ec94ac', '#ffd0dc');
const SKIN = ramp('#3e2a26', '#74524a', '#aa8272', '#d8b09c', '#f4d6c4');
const TOME = ramp('#1e0e06', '#3e2010', '#643a1c', '#8c5a2e');
const PAGE = ramp('#8a8068', '#c8bea2', '#efe7d0', '#fffaec');
const SPIRIT = ramp('#6a7aa8', '#a8b8e4', '#dce6ff', '#ffffff');

function summoner(c: Canvas, x: number, g: number, s: number, cyc: number, raise: number, shade: number, blink: boolean): Pt {
  const S = (v: number): number => v * s;
  // The robe, a bell hemmed in gold.
  c.layer((part) => {
    cloth(part, [[x - S(6), g - S(34)], [x, g - S(35)], [x + S(6), g - S(34)]], [S(33), S(34), S(33)], VESTMENT, { phase: cyc, sway: S(1), spread: S(12), ripple: S(0.8), shade });
    part.rect(x - S(12), g - S(2), S(24), S(2), TRIM[3]);
  }, null, 0.5);
  // The book floats in front, pages turning.
  const book: Pt = [x - S(13), g - S(28) - S(raise * 8) + Math.sin(cyc) * S(1.5)];
  c.layer((part) => {
    part.poly([[book[0] - S(8), book[1] + S(1)], [book[0], book[1] + S(3)], [book[0] + S(8), book[1] + S(1)], [book[0] + S(8), book[1] + S(4)], [book[0], book[1] + S(6)], [book[0] - S(8), book[1] + S(4)]], TOME, 0.5 + shade);
    part.poly([[book[0] - S(7), book[1] - S(1)], [book[0], book[1] + S(1)], [book[0], book[1] + S(4)], [book[0] - S(7), book[1] + S(2)]], PAGE, 0.62 + shade);
    part.poly([[book[0] + S(7), book[1] - S(1)], [book[0], book[1] + S(1)], [book[0], book[1] + S(4)], [book[0] + S(7), book[1] + S(2)]], PAGE, 0.5 + shade);
    for (let k = 0; k < 3; k++) part.dot(book[0] - S(5) + k * S(2), book[1] + S(1) + (k % 2), TRIM[4]);
  }, null, 0.5);
  // Arms out to the book.
  limb(c, [x - S(4), g - S(30)], [book[0] + S(3), book[1] + S(4)], [S(6), S(6)], [S(2), S(1.7), S(1.6)], VESTMENT, -1, shade);
  // Head: a big hood, pink hair escaping it, a small face.
  const hx = x - S(2);
  const hy = g - S(42);
  c.layer((part) => {
    part.ellipse(hx + S(1), hy, S(9), S(9), VESTMENT, { shade });
    part.poly([[hx + S(4), hy - S(7)], [hx + S(14), hy - S(12)], [hx + S(8), hy - S(2)]], VESTMENT, 0.5 + shade);
  }, null, 0.5);
  c.layer((part) => {
    part.ellipse(hx - S(3), hy + S(1), S(5.5), S(6), SKIN, { shade });
    part.poly([[hx - S(8), hy - S(4)], [hx + S(1), hy - S(7)], [hx + S(3), hy - S(2)], [hx - S(2), hy - S(3)], [hx - S(6), hy]], HAIR, 0.55 + shade);
  }, null, 0.5);
  if (blink) c.line(hx - S(6), hy + S(1), hx - S(4), hy + S(1), SKIN[0]);
  else eye(c, Math.round(hx - S(5)), Math.round(hy + S(1)), TRIM[4], 0x4a2a60, 1);
  c.dot(hx - S(1), hy + S(1), SKIN[0]);
  return book;
}

function spirit(c: Canvas, at: Pt, flap: number): void {
  c.layer((part) => {
    part.ellipse(at[0], at[1], 3, 2.6, SPIRIT);
    part.poly([[at[0] + 1, at[1] - 1], [at[0] + 6, at[1] - 4 - flap * 2], [at[0] + 4, at[1] + 1]], SPIRIT, 0.6);
    part.poly([[at[0] + 2, at[1] + 1], [at[0] + 8, at[1] + 2], [at[0] + 3, at[1] + 3]], SPIRIT, 0.45);
    part.dot(at[0] - 1, at[1] - 1, 0x2a3a6a);
  }, null, 0.4);
}

export const selga: BossArt = {
  w: 128,
  h: FRAME_H,
  frames: DEFAULT_FRAMES,
  rate: { ...DEFAULT_RATE, idle: 9 },
  ink: 0x0a0806,
  ember: 0xfff4c4,
  draw(c, p) {
    c.rim = { color: 0xe06058, strength: 0.4 };
    const cyc = p.t * TAU;
    let raise = 0;
    let lean = 0;
    let dive = 0;
    let bob = 0;
    if (p.anim === 'walk') {
      bob = -Math.abs(Math.sin(cyc)) * 2;
      lean = -1;
    } else if (p.anim === 'attack') {
      const { wind, hit } = attackCurve(p.t);
      raise = wind + hit * 0.5;
      lean = -3 * hit;
      dive = span(p.t, 0.4, 0.85);
    } else if (p.anim === 'hurt' || p.anim === 'death') {
      lean = 4 * recoil(p);
    }
    // The summoning circle turns under them, brighter as they call.
    const glow: Ramp = raise > 0.4 ? [TRIM[3], TRIM[4], 0xffffff] : [TRIM[1], TRIM[2], TRIM[3]];
    for (const [rx, ry] of ring(64 + lean, GROUND - 1, 40, 5, 40, cyc * 0.5)) c.dot(rx, ry, glow[1]);
    for (const [rx, ry] of ring(64 + lean, GROUND - 1, 30, 3.6, 8, -cyc)) {
      c.dot(rx, ry, glow[2]);
      c.dot(rx + 1, ry, glow[0]);
    }
    const blink = p.anim === 'idle' && (p.f === 3 || p.f === 7);
    summoner(c, 86 + lean, GROUND + bob, 0.92, cyc + 1.3, raise, -0.12, p.f === 3 && p.anim === 'idle');
    // Their familiars circle them, then dive at the party.
    for (let k = 0; k < 3; k++) {
      const a = cyc + (k * TAU) / 3;
      const home: Pt = [64 + lean + Math.cos(a) * 44, GROUND - 58 + Math.sin(a) * 10 + Math.sin(a * 3) * 2];
      const at: Pt = dive > 0 ? [lerp(home[0], 6 + k * 6, ease.in(dive)), lerp(home[1], GROUND - 30 + k * 6, ease.in(dive))] : home;
      if (dive <= 0 && Math.sin(a) < 0) spirit(c, at, Math.sin(cyc * 4 + k));
    }
    const book = summoner(c, 48 + lean, GROUND + bob, 1.08, cyc, raise, 0, blink && p.f === 7);
    for (let k = 0; k < 3; k++) {
      const a = cyc + (k * TAU) / 3;
      const home: Pt = [64 + lean + Math.cos(a) * 44, GROUND - 58 + Math.sin(a) * 10 + Math.sin(a * 3) * 2];
      const at: Pt = dive > 0 ? [lerp(home[0], 6 + k * 6, ease.in(dive)), lerp(home[1], GROUND - 30 + k * 6, ease.in(dive))] : home;
      if (dive > 0 || Math.sin(a) >= 0) spirit(c, at, Math.sin(cyc * 4 + k));
      if (dive > 0.2) for (let j = 1; j <= 3; j++) c.dot(at[0] + j * 4, at[1] - j * 0.5, SPIRIT[1 + (j % 2)]);
    }
    if (raise > 0.3) {
      for (let k = 0; k < 5; k++) {
        const [sx, sy] = rotate(book[0], book[1] - 8 - raise * 4, book[0], book[1], (k - 2) * 0.35);
        c.dot(sx, sy, TRIM[4]);
      }
    }
  },
};

// ---------------------------------------------------------------------------
//  LILLITH BELVUS, THE NICE AND FRIENDLY: authored sheets, see ../authored;
//  her orb is 32x32 pixel art, see ./lillithOrb
// ---------------------------------------------------------------------------

export const TIER3: Record<string, BossArt> = { planetar, selga };

export const UNITS3: Record<string, BossArt> = {
  'lillith-orb': lillithOrb,
};
