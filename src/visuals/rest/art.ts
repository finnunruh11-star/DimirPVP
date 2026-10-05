// The inn room a night's rest is played in, as pixel art: the room (with the
// window's glass left clear so a sky can show through), the traveller asleep in
// bed and sitting up again, the candle's flame and smoke, and the little things
// dreams are made of. Pure: no Phaser, so every frame can be checked headless.

import { ball, blade, limb, plate, puffs, rod } from '../bosses/parts';
import { Canvas, ease, hash2, lerp, span, TAU, type Pt } from '../bosses/raster';
import { ramp } from '../bosses/rig';

export const ROOM_W = 200;
export const ROOM_H = 120;
/** The window's glass, left clear. */
export const PANE = { x: 22, y: 22, w: 32, h: 28 } as const;
/** The candle's wick; the flame stands on it. */
export const WICK: Pt = [50, 67];
/** The sleeper's head on the pillow, where Zs and dreams rise from. */
export const SLEEPER_HEAD: Pt = [88, 64];

export type SleeperAnim = 'sleep' | 'wake' | 'start';
export const SLEEPER_FRAMES: Record<SleeperAnim, number> = { sleep: 8, wake: 8, start: 6 };
export const FLAME_FRAMES = 4;
export const SMOKE_FRAMES = 6;

export type DreamId = 'sheep' | 'coins' | 'feast' | 'sword' | 'castle' | 'star' | 'bloodmoon';
export const DREAMS: readonly DreamId[] = ['sheep', 'coins', 'feast', 'sword', 'castle', 'star', 'bloodmoon'];

const WALL = ramp('#150d08', '#23160e', '#342116', '#46301f', '#5c4029');
const BEAM = ramp('#0e0805', '#1d120a', '#2e1d10', '#432b18');
const FLOOR = ramp('#0d0906', '#1a110b', '#291b11', '#3a2718', '#4c3421');
const WOOD = ramp('#1a0e06', '#36200f', '#553318', '#774a24', '#9c6532', '#c08448');
const LINEN = ramp('#2e2c34', '#5a5866', '#8d8b9a', '#bdbbc8', '#e4e2ec', '#fbfaff');
const QUILT = ramp('#0b1330', '#16275a', '#253f88', '#3a5db4', '#5f86d8', '#94b4f0');
const PATCH = ramp('#2a0a0c', '#521418', '#7e2126', '#a83436', '#cf5a50');
const SKIN = ramp('#3a2620', '#6e4c3e', '#a8806a', '#d8b498', '#f6dcc4');
const CAP = ramp('#1c0a2c', '#361454', '#5a2484', '#8440b4', '#b070e0', '#d8a8ff');
const HAIR = ramp('#1a0f08', '#3a2412', '#5e3c1e', '#86592c');
const BRASS = ramp('#2a1706', '#583410', '#95601e', '#cf9738', '#f5cd6a', '#fff2c4');
const WAX = ramp('#5a5040', '#958a70', '#cfc4a4', '#efe6cc', '#fffaf0');
const GOLD = ramp('#3a2606', '#76510f', '#b98422', '#e8bb4a', '#fde79a', '#fffbe6');
const STEEL = ramp('#1e2028', '#3c414f', '#666d80', '#9aa2b6', '#d0d6e4', '#ffffff');
const STONE = ramp('#26262e', '#43434e', '#65656f', '#8a8a94', '#b4b4bc');
const ORB = ramp('#06122e', '#16509a', '#2c86d0', '#6cc4f4', '#d4f4ff');
const FLAME = ramp('#5a1004', '#b3300a', '#f06a14', '#ffb43a', '#fff0a0', '#ffffff');
const SMOKE = ramp('#2a2a30', '#4a4a52', '#6e6e78', '#9696a0');
const MOON = ramp('#6a6a78', '#a4a4b4', '#d4d4e0', '#f0f0f8', '#ffffff');
const SUN = ramp('#b35a10', '#e8901e', '#ffc040', '#ffe27a', '#fff6c8');
const CLOUD = ramp('#8a8ea8', '#b8bcd4', '#dcdfee', '#f2f3fa', '#ffffff');
const ROAST = ramp('#3a1a08', '#6e3712', '#a8611e', '#d9952e', '#f6c96a');
const BLOOD = ramp('#2a0404', '#5a0a0a', '#8e1414', '#c62a1e', '#f05a3a', '#ffb09a');
const LEAF = ramp('#14280e', '#24421a', '#3c6e3a', '#5e9a4e');
const SKY_DAY = ramp('#3a6ea8', '#5a8ec8', '#7aa6d8', '#a8c8ec');
const INK = 0x07050a;

/** A rectangle in one ramp, brightness from `shade`. */
function box(c: Canvas, x: number, y: number, w: number, h: number, r: readonly number[], shade: number | ((x: number, y: number) => number)): void {
  c.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], r, shade);
}

// ---------------------------------------------------------------------------
//  THE ROOM
// ---------------------------------------------------------------------------

export function renderRoom(): Canvas {
  const c = new Canvas(ROOM_W, ROOM_H);
  // Back wall: upright boards of uneven tone, darker under the ceiling, a knot here and there.
  for (let i = 0; i * 10 < ROOM_W; i++) {
    const x = i * 10;
    const tone = 0.34 + hash2(i, 1) * 0.18;
    box(c, x, 0, 10, 96, WALL, (_px, py) => tone + (py / 96) * 0.16 - (py < 16 ? (16 - py) * 0.012 : 0));
    c.line(x, 0, x, 95, WALL[0]);
    if (hash2(i, 2) > 0.45) c.ellipse(x + 3 + hash2(i, 3) * 4, 30 + hash2(i, 4) * 50, 1.4, 1, WALL, { shade: -0.3 });
  }
  box(c, 0, 0, ROOM_W, 8, BEAM, (_x, y) => 0.55 - y * 0.05);
  c.line(0, 8, ROOM_W - 1, 8, BEAM[0]);
  box(c, 0, 91, ROOM_W, 5, WOOD, (_x, y) => (y === 91 ? 0.5 : 0.28));
  // The floor, in boards running away from the eye.
  for (let row = 0; row < 4; row++) {
    const y = 96 + row * 6;
    box(c, 0, y, ROOM_W, 6, FLOOR, (x) => 0.5 - row * 0.06 + (hash2(Math.floor((x + row * 17) / 34), row) - 0.5) * 0.12);
    c.line(0, y, ROOM_W - 1, y, FLOOR[0]);
    for (let x = (row * 23) % 34; x < ROOM_W; x += 34) c.line(x, y, x, y + 5, FLOOR[0]);
  }

  // The window: a frame, the glass left clear, a cross of glazing bars, a sill.
  c.layer((part) => {
    box(part, 18, 18, 40, 36, WOOD, (_x, y) => 0.58 - (y - 18) * 0.006);
    box(part, 15, 53, 46, 4, WOOD, (_x, y) => (y === 53 ? 0.8 : 0.5));
  }, null, 0.5);
  c.px.rect(PANE.x, PANE.y, PANE.w, PANE.h, -1);
  box(c, 37, PANE.y, 2, PANE.h, WOOD, 0.46);
  box(c, PANE.x, 35, PANE.w, 2, WOOD, 0.46);
  // Red curtains either side, on a brass rod.
  for (const [x0, x1] of [[9, 21], [55, 67]] as const) {
    c.layer((part) => box(part, x0, 14, x1 - x0, 48, PATCH, (x, y) => 0.5 + Math.sin((x - x0) * 1.3) * 0.2 - (y - 14) * 0.004), null, 0.5);
    c.layer((part) => part.ellipse((x0 + x1) / 2, 46, (x1 - x0) / 2 + 0.5, 2.2, BRASS, { shade: -0.1 }), null, 0.5);
  }
  rod(c, [[7, 13, 1.1], [69, 13, 1.1]], BRASS);
  ball(c, 7, 13, 1.8, 1.8, BRASS);
  ball(c, 69, 13, 1.8, 1.8, BRASS);

  // A little painting: green hills under a summer sky.
  c.layer((part) => {
    box(part, 102, 26, 26, 20, WOOD, 0.62);
    box(part, 104, 28, 22, 16, SKY_DAY, (_x, y) => 0.85 - (y - 28) * 0.04);
    part.ellipse(120, 32, 2, 2, SUN, { flat: true, shade: 0.3 });
    for (let x = 104; x < 126; x++) {
      const hill = 4 + Math.sin((x - 104) * 0.35) * 2 + Math.max(0, Math.sin((x - 112) * 0.3)) * 2;
      for (let y = Math.round(44 - hill); y < 44; y++) part.dot(x, y, LEAF[y < 44 - hill + 1.5 ? 3 : 2]);
    }
  }, null, 0.5);

  // The rug under the bed.
  c.layer((part) => {
    box(part, 58, 101, 122, 6, PATCH, (x) => 0.48 + ((x >> 2) % 2) * 0.06);
    part.line(58, 102, 179, 102, GOLD[3]);
    part.line(58, 105, 179, 105, GOLD[3]);
    for (let x = 58; x < 180; x += 2) part.dot(x, 107, GOLD[2]);
  }, null, 0.5);

  // A stool by the bed with the candle on it.
  for (const [x0, x1] of [[43, 41], [50, 50], [57, 59]] as const) rod(c, [[x0, 82, 1.1], [x1, 100, 1.1]], WOOD, -0.1);
  c.layer((part) => part.ellipse(50, 81, 10, 2.6, WOOD, { shade: 0.1 }), null, 0.5);
  c.layer((part) => {
    part.ellipse(50, 79.5, 5, 1.6, BRASS);
    part.ellipse(56, 78.6, 1.4, 1.2, BRASS, { shade: -0.1 });
  }, null, 0.5);
  c.layer((part) => {
    box(part, 48, 68, 4, 11, WAX, (x) => 0.78 - (x - 48) * 0.1);
    part.dot(48, 71, WAX[4]);
    part.dot(51, 73, WAX[2]);
  }, null, 0.5);
  c.dot(WICK[0], WICK[1], INK);

  // The bed, head to the left: shadow, legs, head- and footboard, rail, mattress and pillow.
  c.ellipse(118, 101, 58, 3, FLOOR, { flat: true, shade: -0.5 });
  rod(c, [[69, 90, 1.6], [69, 100, 1.6]], WOOD, -0.1);
  rod(c, [[165, 90, 1.6], [165, 100, 1.6]], WOOD, -0.1);
  plate(c, [[64, 100], [64, 58], [66, 55], [69, 55], [71, 58], [71, 100]], WOOD, 0.62, 0.004);
  ball(c, 67.5, 53, 2.6, 2.4, WOOD, 0.1);
  plate(c, [[162, 100], [162, 71], [164, 69], [166, 69], [168, 71], [168, 100]], WOOD, 0.6, 0.004);
  ball(c, 165, 67.5, 2.3, 2.2, WOOD, 0.1);
  c.layer((part) => {
    box(part, 72, 76, 90, 11, LINEN, (x, y) => 0.6 - (y - 76) * 0.02 + ((x - 72) % 7 === 0 ? -0.1 : 0));
  }, null, 0.5);
  c.layer((part) => {
    box(part, 66, 86, 102, 5, WOOD, (_x, y) => (y === 86 ? 0.72 : 0.46));
  }, null, 0.5);
  ball(c, 83, 72, 11, 5, LINEN, 0.08);

  // The traveller's own hat on the footboard, and the staff against the wall.
  c.layer((part) => {
    part.poly([[159, 66], [173, 66], [169, 59], [174, 50], [166, 57]], CAP, (x) => 0.64 - (x - 159) * 0.012);
    part.ellipse(166, 66.6, 7.5, 1.8, CAP, { shade: -0.12 });
    part.line(160, 64, 171, 64, GOLD[3]);
  }, null, 0.5);
  rod(c, [[184, 99, 1.2], [180, 36, 1.2]], WOOD);
  c.layer((part) => part.ellipse(180, 37, 1.8, 1.2, BRASS), null, 0.5);
  ball(c, 179.6, 32, 3.2, 3.2, ORB, 0.1);
  return c;
}

// ---------------------------------------------------------------------------
//  THE SLEEPER
// ---------------------------------------------------------------------------

export function renderSleeper(anim: SleeperAnim, f: number): Canvas {
  const c = new Canvas(ROOM_W, ROOM_H);
  const n = SLEEPER_FRAMES[anim];
  if (anim === 'sleep') lying(c, Math.sin((f / n) * TAU));
  else sitting(c, anim, n > 1 ? f / (n - 1) : 1);
  c.edge(null, 0.45);
  return c;
}

/** Patchwork: blue squares, alternately lighter, with a few red ones stitched in. */
function quilt(c: Canvas, outline: readonly Pt[]): void {
  c.layer((part) => {
    part.poly(outline, QUILT, (x, y) => 0.58 - (y - 70) * 0.012 + ((Math.floor((x - 93) / 8) + Math.floor((y - 64) / 7)) % 2 ? 0.07 : -0.05));
    for (const [px, py] of [[104, 78], [128, 80], [150, 77]] as const) {
      box(part, px, py, 7, 6, PATCH, 0.62);
      for (let k = 0; k < 7; k += 2) {
        part.dot(px + k, py, LINEN[2]);
        part.dot(px + k, py + 5, LINEN[2]);
      }
    }
  }, null, 0.5);
}

/** Flat on the back under the quilt, head on the pillow, cap trailing off it; `breath` lifts the chest. */
function lying(c: Canvas, breath: number): void {
  const b = (breath + 1) / 2;
  const hx = 88;
  const hy = 67.5 - b * 0.4;
  // The nightcap's tail flops over the pillow's edge, a pompom at its tip.
  rod(c, [[84, hy - 1, 3.4], [80, hy + 0.5, 2.6], [77, hy + 4, 1.8], [75.5, hy + 8, 1.1]], CAP, 0.05);
  ball(c, 75, hy + 9.5, 1.9, 1.9, LINEN, 0.2);
  ball(c, hx, hy, 5.2, 4.8, SKIN, 0.05);
  c.layer((part) => {
    part.poly([[82.5, hy - 3], [86, hy - 5.2], [88.5, hy - 5.4], [86.5, hy - 1], [84, hy + 3.5], [82, hy + 2]], CAP, 0.62);
    part.tube([[88, hy - 5, 1.1], [85.2, hy + 3.6, 1.1]], LINEN, { shade: 0.15 });
  }, null, 0.5);
  for (const [x, y] of [[88.8, hy - 4.6], [89.6, hy - 4]] as const) c.dot(x, y, HAIR[2]);
  // Face turned up: the closed eye, the nose, a sleepy mouth, a flush on the cheek.
  c.line(89, hy - 1.5, 91, hy - 1.5, SKIN[0]);
  c.dot(92.6, hy - 2.6, SKIN[4]);
  c.dot(92.2, hy + 1.2, SKIN[0]);
  c.dot(90.4, hy + 0.8, PATCH[4]);
  // The quilt, pulled up to the chin; the chest rises and falls under it.
  const lift = b * 1.2;
  quilt(c, [
    [93, 71.5], [99, 69.5 - lift], [106, 68.6 - lift], [114, 70 - lift * 0.4], [124, 71.2], [136, 69.6], [146, 71], [154, 70.4],
    [159, 67.6], [162, 71], [163, 88], [150, 89], [134, 88], [118, 89], [102, 88], [93, 89], [92, 77],
  ]);
  rod(c, [[93.5, 71.2, 1.3], [104, 69.4 - lift, 1.3], [112, 70 - lift * 0.4, 1.2]], LINEN, 0.15);
  ball(c, 105, 69.2 - lift, 1.7, 1.5, SKIN, 0.05);
}

/** Sitting up out of the quilt: 'wake' stretches and yawns, 'start' jolts up in fright and turns to the window. */
function sitting(c: Canvas, anim: 'wake' | 'start', t: number): void {
  const start = anim === 'start';
  const up = start ? ease.out(span(t, 0, 0.35)) : ease.inOut(span(t, 0, 0.45));
  const lean = start ? -0.28 * span(t, 0.3, 0.55) + 0.14 * span(t, 0.55, 1) : 0;
  const stretch = start ? 0 : span(t, 0.45, 0.72) - span(t, 0.86, 1) * 0.7;
  const turned = start && t > 0.55;
  const hip: Pt = [112, 77];
  const flat = Math.atan2(67.5 - hip[1], 88 - hip[0]);
  const angle = lerp(flat, -Math.PI / 2 + lean, up);
  const dir: Pt = [Math.cos(angle), Math.sin(angle)];
  const fwd: Pt = turned ? [-1, 0] : [-dir[1], dir[0]];
  const at = (from: Pt, along: number, ahead = 0): Pt => [from[0] + dir[0] * along + fwd[0] * ahead, from[1] + dir[1] * along + fwd[1] * ahead];
  const neck = at(hip, 17);
  const head = at(hip, 23);
  // The far arm, then the body in its nightshirt. Stretching, the near hand goes up behind the head.
  const reach = (side: number): Pt => start
    ? at(head, -1, 3.5 + side)
    : [lerp(hip[0] + 7 + side, head[0] - side * 2.4, stretch), lerp(hip[1] - 3, head[1] - 11, stretch)];
  const farHand = limb(c, at(neck, -1.5, -1), reach(-1.5), [7, 7], [1.9, 1.6, 1.5], LINEN, start ? 1 : -1, -0.2);
  ball(c, farHand[0], farHand[1], 1.5, 1.5, SKIN, -0.1);
  rod(c, [[hip[0], hip[1], 6], [neck[0], neck[1], 5]], LINEN, 0.05);
  // The quilt has slid to the lap.
  quilt(c, [
    [100, 76], [106, 72.5], [114, 72], [124, 71.6], [136, 69.8], [146, 71], [154, 70.4],
    [159, 67.6], [162, 71], [163, 88], [150, 89], [134, 88], [118, 89], [102, 88], [98, 89], [97, 80],
  ]);
  // Head and cap: the tail hangs down the back, or flies straight up with the fright.
  ball(c, head[0], head[1], 5.2, 4.8, SKIN, 0.05);
  const fly = start ? span(t, 0.05, 0.3) * (1 - span(t, 0.6, 1) * 0.5) : 0;
  const base = at(head, 3.6, -0.5);
  const tail: Pt[] = [
    base,
    at(base, lerp(1.5, 4, fly), lerp(-3, -1.5, fly)),
    at(base, lerp(-1, 7, fly), lerp(-5.5, -2.5, fly)),
    at(base, lerp(-4.5, 10, fly), lerp(-6.5, -3, fly)),
  ];
  rod(c, tail.map(([x, y], i) => [x, y, [3.3, 2.6, 1.8, 1.1][i]] as const), CAP, 0.05);
  const tip = tail[tail.length - 1];
  ball(c, tip[0] + (tip[0] - tail[2][0]) * 0.4, tip[1] + (tip[1] - tail[2][1]) * 0.4, 1.9, 1.9, LINEN, 0.2);
  c.layer((part) => part.tube([[...at(head, 3, -3.4), 1.1] as const, [...at(head, 3, 3.4), 1.1] as const], LINEN, { shade: 0.15 }), null, 0.5);
  // The face: eyes shut, then open; wide with fright; a yawn at the top of the stretch.
  const eye = at(head, 0.6, 2.4);
  if (start && t > 0.12) {
    c.rect(eye[0] - 0.5, eye[1] - 1, 2, 2, LINEN[5]);
    c.dot(eye[0] + (turned ? -0.5 : 0.5), eye[1] - 0.2, INK);
  } else if (t > 0.3) {
    c.dot(eye[0], eye[1], INK);
  } else {
    c.line(eye[0] - 1, eye[1], eye[0] + 1, eye[1], SKIN[0]);
  }
  const nose = at(head, -0.2, 5.1);
  c.dot(nose[0], nose[1], SKIN[4]);
  const mouth = at(head, -2.4, 3.2);
  if (stretch > 0.5 || (start && t > 0.2)) c.ellipse(mouth[0], mouth[1], 1.2, 1.4, PATCH, { flat: true, shade: -0.6 });
  else c.dot(mouth[0], mouth[1], SKIN[0]);
  if (start && t > 0.5) {
    const drop = at(head, 4.5, -4);
    c.ellipse(drop[0], drop[1], 0.9, 1.3, ORB, { shade: 0.3 });
  }
  // The near arm.
  const nearHand = limb(c, at(neck, -1, 1), reach(1.5), [7, 7], [2, 1.7, 1.6], LINEN, start ? -1 : 1, 0);
  ball(c, nearHand[0], nearHand[1], 1.6, 1.6, SKIN, 0.05);
}

// ---------------------------------------------------------------------------
//  THE CANDLE, THE SKY, THE Zs
// ---------------------------------------------------------------------------

export function renderFlame(f: number): Canvas {
  const c = new Canvas(9, 14);
  const sway = [0, 1, 0, -1][f % 4];
  const reach = [2, 1, 3, 2][f % 4];
  c.poly([[1.6, 10], [4.5 + sway, reach], [7.4, 10]], FLAME, (x, y) => 0.55 + (y / 14) * 0.2 - Math.abs(x - 4.5) * 0.1);
  c.ellipse(4.5, 10.5, 3, 3, FLAME, { shade: 0.1 });
  c.ellipse(4.5, 10.6, 1.4, 2.1, FLAME, { flat: true, shade: 0.5 });
  return c;
}

export function renderSmoke(f: number): Canvas {
  const c = new Canvas(14, 26);
  puffs(c, [7, 23], f / SMOKE_FRAMES, 3, SMOKE, 20, 2);
  return c;
}

export function renderMoon(): Canvas {
  const c = new Canvas(10, 10);
  c.ellipse(5, 5, 4.2, 4.2, MOON, { shade: 0.15 });
  for (const [x, y] of [[4, 4], [6, 6], [5, 3], [3, 6]] as const) c.dot(x, y, MOON[1]);
  return c;
}

export function renderSun(): Canvas {
  const c = new Canvas(14, 14);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    c.dot(7 + Math.cos(a) * 6, 7 + Math.sin(a) * 6, SUN[4]);
  }
  c.ellipse(7, 7, 4.4, 4.4, SUN, { shade: 0.2 });
  return c;
}

export function renderZ(big: boolean): Canvas {
  const n = big ? 7 : 5;
  const c = new Canvas(n + 2, n + 2);
  const color = 0xe4ecff;
  for (let i = 0; i < n; i++) {
    c.dot(1 + i, 1, color);
    c.dot(1 + i, n, color);
    c.dot(n - i, 1 + i, color);
  }
  c.edge(0x141a36);
  return c;
}

// ---------------------------------------------------------------------------
//  DREAMS
// ---------------------------------------------------------------------------

export const BUBBLE_W = 66;
export const BUBBLE_H = 42;

/** The cloud a dream plays in. */
export function renderBubble(): Canvas {
  const c = new Canvas(BUBBLE_W, BUBBLE_H);
  c.layer((part) => {
    for (const [x, y, rx, ry] of [[18, 23, 13, 10], [33, 16, 15, 11], [48, 21, 13, 10], [32, 29, 19, 8], [55, 28, 8, 7], [11, 29, 8, 6]] as const) {
      part.ellipse(x, y, rx, ry, CLOUD, { shade: 0.32 });
    }
  }, 0x3a3e58);
  return c;
}

/** One of the thought bubbles that lead up to the dream, smallest first. */
export function renderDot(size: number): Canvas {
  const r = 1 + size;
  const c = new Canvas(r * 2 + 3, r * 2 + 3);
  c.ellipse(r + 1.5, r + 1.5, r, r, CLOUD, { shade: 0.3 });
  c.edge(0x3a3e58);
  return c;
}

export const DREAM_W = 24;
export const DREAM_H = 18;

export function renderDream(id: DreamId): Canvas {
  const c = new Canvas(DREAM_W, DREAM_H);
  switch (id) {
    case 'sheep':
      for (const [x, y] of [[9, 15], [11, 15], [15, 15], [17, 15]] as const) c.line(x, y - 4, x, y, SMOKE[0]);
      c.layer((part) => {
        for (const [x, y, r] of [[13, 9, 4.5], [9, 8, 3.2], [17, 8, 3.2], [13, 6, 3.4], [11, 11, 3], [16, 11, 3]] as const) part.ellipse(x, y, r, r * 0.85, CLOUD, { shade: 0.25 });
      }, null, 0.5);
      ball(c, 5.5, 8.5, 2.6, 2.2, SMOKE, -0.1);
      c.dot(4.6, 8, LINEN[5]);
      c.dot(7, 6.4, SMOKE[1]);
      break;
    case 'coins':
      for (const y of [14, 12, 10, 8]) c.layer((part) => part.ellipse(9, y, 6, 2, GOLD, { shade: 0.05 }), null, 0.5);
      ball(c, 17, 10, 4, 5, GOLD, 0.1);
      c.line(17, 8, 17, 12, GOLD[1]);
      for (const [x, y] of [[4, 3], [21, 3], [13, 2]] as const) {
        c.dot(x, y, GOLD[5]);
        c.dot(x - 1, y, GOLD[3]);
        c.dot(x + 1, y, GOLD[3]);
        c.dot(x, y - 1, GOLD[3]);
        c.dot(x, y + 1, GOLD[3]);
      }
      break;
    case 'feast':
      rod(c, [[14, 11, 1.4], [20, 15, 1.2]], LINEN, 0.2);
      ball(c, 20.6, 14.2, 1.5, 1.5, LINEN, 0.2);
      ball(c, 19.6, 16, 1.5, 1.5, LINEN, 0.15);
      ball(c, 10, 8, 7, 5.5, ROAST, 0.05, -0.5);
      c.dot(8, 5, ROAST[4]);
      c.dot(11, 5, ROAST[4]);
      for (const [x, y] of [[6, 3], [9, 1], [12, 2]] as const) c.line(x, y, x + 1, y - 1, SMOKE[3]);
      break;
    case 'sword':
      blade(c, [7, 13], -Math.PI / 4, 15, 3, STEEL, { guard: GOLD, guardWidth: 3.5 });
      rod(c, [[7, 13, 1], [3.5, 16.5, 1]], ROAST, -0.1);
      ball(c, 3, 17, 1.4, 1.4, GOLD, 0.1);
      break;
    case 'castle':
      c.layer((part) => {
        box(part, 7, 7, 10, 11, STONE, (x) => 0.66 - (x - 7) * 0.03);
        for (const x of [7, 10, 13, 16]) box(part, x, 4, 2, 3, STONE, 0.6);
        box(part, 3, 11, 5, 7, STONE, 0.5);
        box(part, 16, 11, 5, 7, STONE, 0.42);
        box(part, 10, 13, 4, 5, WOOD, 0.3);
        box(part, 11, 9, 2, 2, WOOD, 0.1);
      }, null, 0.5);
      c.line(12, 0, 12, 4, WOOD[2]);
      c.poly([[12.5, 0], [17, 1.2], [12.5, 2.6]], PATCH, 0.7);
      break;
    case 'star':
      c.layer((part) => {
        const points: Pt[] = [];
        for (let k = 0; k < 10; k++) {
          const a = -Math.PI / 2 + (k / 10) * TAU;
          const r = k % 2 ? 3.4 : 8;
          points.push([12 + Math.cos(a) * r, 9.5 + Math.sin(a) * r]);
        }
        part.poly(points, GOLD, (x, y) => 0.8 - (x - 12) * 0.03 - (y - 9) * 0.03);
      }, null, 0.5);
      for (const [x, y] of [[3, 3], [21, 15], [20, 2]] as const) c.dot(x, y, GOLD[5]);
      break;
    case 'bloodmoon':
      ball(c, 12, 9, 7.5, 7.5, BLOOD, 0.1);
      for (const [x, y, r] of [[9, 7, 1.6], [14, 12, 1.3], [15, 6, 1]] as const) c.ellipse(x, y, r, r, BLOOD, { flat: true, shade: -0.35 });
      break;
  }
  return c;
}

export const FENCE_W = 14;
export const FENCE_H = 9;

/** The fence the dreamed sheep jump. */
export function renderFence(): Canvas {
  const c = new Canvas(FENCE_W, FENCE_H);
  c.layer((part) => {
    box(part, 2, 0, 2, 9, WOOD, 0.62);
    box(part, 10, 0, 2, 9, WOOD, 0.58);
    box(part, 0, 2, 14, 2, WOOD, 0.7);
    box(part, 0, 5, 14, 2, WOOD, 0.6);
  }, null, 0.5);
  return c;
}
