import { Canvas } from './bosses/raster';
import type { BossArt, Pose } from './bosses/rig';
import { CREATURE_GEAR, CREATURE_PIXELS } from './creaturePixels';
import { mix } from '../world/pixels';

export type CreatureBody = keyof typeof CREATURE_PIXELS;
export type CreatureDetail = 'none' | 'bow' | 'staff' | 'spear' | 'club' | 'horns' | 'crown' | 'spikes' | 'mane';
export interface CreatureLook {
  body: CreatureBody;
  color: number;
  accent?: number;
  detail?: CreatureDetail;
  heads?: number;
}

interface JointPose {
  lift: number;
  lean: number;
  head: number;
  nearArm: number;
  farArm: number;
  elbow: number;
  stride: number;
  reach: number;
  wing: number;
}
type Point = readonly [number, number];
type Pixel = { horizontal: number; vertical: number; color: number };
type Transform = { source: Point; target: Point; angle: number };

const INK = 0x20232b;
const BONE = 0xe6dbb5;
const BIPEDS = new Set<CreatureBody>(['humanoid', 'goblin', 'kobold', 'construct']);
const FLYERS = new Set<CreatureBody>(['bat', 'fairy', 'insect', 'eye', 'spirit']);
const BREATH = [0, 1, 2, 1, -1, -2, -1, 0];
const SWAY = [0, 0.08, 0.13, 0.08, 0, -0.09, -0.13, -0.06];
const STRIDE = [0, 1, 2, 1, 0, -1, -2, -1];
const FLAP = [0, -0.22, -0.42, -0.18, 0.22, 0.5, 0.3, 0.12];

export function creaturePose(pose: Pose): JointPose {
  const loop = pose.anim === 'idle' || pose.anim === 'walk';
  const frame = loop ? Math.floor((pose.t % 1) * 8) : pose.f;
  const rest: JointPose = { lift: 0, lean: 0, head: 0, nearArm: 0, farArm: 0, elbow: 0, stride: 0, reach: 0, wing: 0 };
  if (loop) {
    const walking = pose.anim === 'walk';
    return {
      lift: BREATH[frame], lean: SWAY[frame] * 0.45,
      head: BREATH[(frame + 7) % 8] - BREATH[7],
      nearArm: SWAY[frame] * (walking ? 4 : 2), farArm: -SWAY[frame] * (walking ? 4 : 1.6),
      elbow: SWAY[(frame + 7) % 8] - SWAY[7], stride: walking ? STRIDE[frame] : SWAY[frame] * 4,
      reach: 0, wing: FLAP[frame],
    };
  }
  if (pose.anim === 'attack') {
    return {
      lift: [0, 1, 2, -1, -2, 0, 1, 0][frame],
      lean: [0, 0.08, 0.18, -0.1, -0.24, -0.15, -0.05, 0][frame],
      head: [0, 0, 1, 1, -1, -1, 0, 0][frame],
      nearArm: [0, 0.4, 1.15, 0.5, -1.15, -1.4, -0.45, 0][frame],
      farArm: [0, -0.15, -0.4, 0.2, 0.5, 0.3, 0.1, 0][frame],
      elbow: [0, -0.15, -0.35, -0.4, -0.2, 0.05, 0.15, 0][frame],
      stride: [0, -0.5, -1, 1, 2, 1, 0.5, 0][frame],
      reach: [0, 1, 2, -1, -3, -2, -1, 0][frame],
      wing: [0, -0.2, -0.4, 0.2, 0.5, 0.25, 0.1, 0][frame],
    };
  }
  if (pose.anim === 'hurt') return { ...rest, reach: [2, 1, 0][frame], lean: [0.15, 0.07, 0][frame], nearArm: [0.3, 0.15, 0][frame] };
  return { ...rest, lift: [0, 1, 2, 3, 3, 3, 3][frame], lean: [0, 0.08, 0.16, 0.24, 0.3, 0.3, 0.3][frame] };
}

export function creatureArt(look: CreatureLook): BossArt {
  return {
    w: 64, h: 64, ground: 58, ink: INK, ember: look.accent ?? BONE, outlined: true,
    frames: { idle: 8, walk: 8, attack: 8, hurt: 3, death: 7 },
    rate: { idle: 9, walk: 12, attack: 16, hurt: 15, death: 12 },
    draw: (canvas, pose) => drawCreature(canvas, pose, look),
  };
}

function mapPoint(point: Point, transform: Transform): Point {
  const cosine = Math.cos(transform.angle);
  const sine = Math.sin(transform.angle);
  const horizontal = point[0] - transform.source[0];
  const vertical = point[1] - transform.source[1];
  return [transform.target[0] + horizontal * cosine - vertical * sine, transform.target[1] + horizontal * sine + vertical * cosine];
}

function paint(canvas: Canvas, pixels: Pixel[], transform: Transform): void {
  if (!pixels.length) return;
  const source = new Map(pixels.map(pixel => [`${pixel.horizontal},${pixel.vertical}`, pixel.color]));
  const corners = pixels.map(pixel => mapPoint([pixel.horizontal, pixel.vertical], transform));
  const left = Math.floor(Math.min(...corners.map(point => point[0]))) - 1;
  const top = Math.floor(Math.min(...corners.map(point => point[1]))) - 1;
  const right = Math.ceil(Math.max(...corners.map(point => point[0]))) + 1;
  const bottom = Math.ceil(Math.max(...corners.map(point => point[1]))) + 1;
  const inverse = { source: transform.target, target: transform.source, angle: -transform.angle };
  for (let vertical = top; vertical <= bottom; vertical++) {
    for (let horizontal = left; horizontal <= right; horizontal++) {
      const sample = mapPoint([horizontal, vertical], inverse);
      const color = source.get(`${Math.round(sample[0])},${Math.round(sample[1])}`);
      if (color != null) canvas.dot(horizontal, vertical, color);
    }
  }
}

function drawCreature(canvas: Canvas, pose: Pose, look: CreatureLook): void {
  const rows = CREATURE_PIXELS[look.body];
  const joint = creaturePose(pose);
  const colors: Record<string, number> = {
    k: INK, H: mix(look.color, 0xe5e7c5, 0.36), s: look.color,
    d: mix(look.color, 0x263539, 0.55), B: 0x92765b, b: 0x55493f,
    g: look.accent ?? 0xc9ad6b, I: 0xaab7bf, i: 0x667883, w: BONE, e: 0xefb957,
  };
  const width = Math.max(...rows.map(row => row.length));
  const left = Math.floor((64 - width) / 2) + joint.reach;
  const top = 57 - rows.length - (FLYERS.has(look.body) ? 6 : 0);
  const biped = BIPEDS.has(look.body);
  const hip: Point = [width / 2, rows.length - 7];
  const body: Transform = { source: hip, target: [left + hip[0], top + hip[1] + joint.lift], angle: joint.lean };
  const pixels: Pixel[] = [];
  rows.forEach((row, vertical) => {
    for (let horizontal = 0; horizontal < row.length; horizontal++) {
      let color = colors[row[horizontal]];
      if (color == null) continue;
      if (pose.anim === 'idle' && pose.f === 6 && row[horizontal] === 'e') color = INK;
      pixels.push({ horizontal, vertical, color });
    }
  });

  const stamp = (art: readonly string[], at: Point, angle = 0, anchor: Point = [0, 0]): void => {
    const part: Pixel[] = [];
    art.forEach((row, vertical) => {
      for (let horizontal = 0; horizontal < row.length; horizontal++) {
        const color = colors[row[horizontal]];
        if (color != null) part.push({ horizontal, vertical, color });
      }
    });
    paint(canvas, part, { source: anchor, target: at, angle });
  };

  if (look.body === 'hydra') {
    const count = Math.max(3, Math.min(6, look.heads ?? 3));
    for (let head = count - 1; head >= 0; head--) {
      const neckX = 24 + head * 4 + joint.reach;
      const lag = pose.anim === 'idle' || pose.anim === 'walk' ? BREATH[(Math.floor((pose.t % 1) * 8) + head) % 8] - BREATH[head] : joint.head;
      const headY = 17 + (head % 3) * 7 + lag;
      for (let vertical = headY + 4; vertical < 47; vertical++) stamp(['kHsddk'], [neckX - (vertical < headY + 9 ? 1 : 0), vertical]);
      stamp(CREATURE_GEAR.head, [neckX - 6, headY - 4], joint.lean);
    }
  }

  if (biped) {
    const shoulderY = look.body === 'construct' ? 9 : 14;
    const elbowY = shoulderY + 4;
    const wristY = shoulderY + 7;
    const armEnd = rows.length - 8;
    const nearX = look.body === 'construct' ? 4 : 6;
    const farX = look.body === 'construct' ? width - 5 : width - 8;
    const armSide = (pixel: Pixel): number => {
      if (pixel.vertical < shoulderY || pixel.vertical > armEnd) return 0;
      if (Math.abs(pixel.horizontal - nearX) <= 2) return -1;
      if (Math.abs(pixel.horizontal - farX) <= 2) return 1;
      return 0;
    };
    const limbs = (side: number): Point => {
      const shoulder: Point = [side < 0 ? nearX : farX, shoulderY];
      const projectedShoulder = mapPoint(shoulder, body);
      const shoulderAt: Point = [projectedShoulder[0], projectedShoulder[1] - (side > 0 ? 1 : 0)];
      const angle = joint.lean + (side < 0 ? joint.nearArm : joint.farArm);
      const upper = { source: shoulder, target: shoulderAt, angle };
      const elbow: Point = [shoulder[0], elbowY];
      const lower = { source: elbow, target: mapPoint(elbow, upper), angle: angle + joint.elbow * (side < 0 ? 1 : -1) };
      const arm = pixels.filter(pixel => armSide(pixel) === side)
        .map(pixel => side > 0 && pixel.color !== INK ? { ...pixel, color: mix(pixel.color, INK, 0.18) } : pixel);
      paint(canvas, arm.filter(pixel => pixel.vertical < elbowY), upper);
      paint(canvas, arm.filter(pixel => pixel.vertical >= elbowY), lower);
      return mapPoint([shoulder[0], wristY], lower);
    };
    limbs(1);
    for (const side of [1, -1]) {
      const legX = hip[0] + side * 3;
      const leg = pixels.filter(pixel => pixel.vertical >= rows.length - 7 && (pixel.horizontal < hip[0] ? -1 : 1) === side);
      const angle = joint.stride * side * 0.1;
      paint(canvas, leg, { source: [legX, rows.length - 7], target: [left + legX, top + rows.length - 7 + Math.min(1, joint.lift) - (side > 0 ? 1 : 0)], angle });
    }
    paint(canvas, pixels.filter(pixel => pixel.vertical >= 12 && pixel.vertical < rows.length - 7 && armSide(pixel) === 0), body);
    stamp(['ssdd', 'ssdd', 'ssdd', 'ssdd', 'ssdd'], mapPoint([hip[0] - 2, 10 + Math.min(0, joint.head)], body), body.angle);
    const headAt = mapPoint([hip[0], 12], body);
    const head = { source: [hip[0], 12] as Point, target: [headAt[0], headAt[1] + joint.head] as Point, angle: joint.lean * -0.4 };
    paint(canvas, pixels.filter(pixel => pixel.vertical < 12), head);
    const detail = look.detail ?? 'none';
    if (detail === 'crown') stamp(CREATURE_GEAR.crown, mapPoint([9, -3], head), head.angle);
    if (detail === 'horns' && look.body !== 'kobold') stamp(CREATURE_GEAR.horns, mapPoint([7, -3], head), head.angle);
    const hand = limbs(-1);
    const weapon = detail === 'bow' || detail === 'staff' || detail === 'spear' || detail === 'club' ? detail
      : look.body === 'construct' ? null : detail === 'crown' ? 'cleaver' : 'dagger';
    if (weapon) {
      const gear = CREATURE_GEAR[weapon];
      const angle = joint.lean + joint.nearArm + joint.elbow;
      stamp(gear, hand, angle, [weapon === 'bow' ? 5 : 3, weapon === 'bow' ? 5 : gear.length - 3]);
      stamp(['Hssk', 'ssdk'], [hand[0] - 1, hand[1]]);
    }
  } else {
    const winged = look.body === 'bat' || look.body === 'fairy' || look.body === 'insect';
    const swimming = look.body === 'slime' || look.body === 'worm' || look.body === 'spirit' || look.body === 'eye';
    for (const side of [-1, 0, 1]) {
      const part = pixels.filter(pixel => {
        const region = pixel.horizontal < width * 0.32 ? -1 : pixel.horizontal > width * 0.68 ? 1 : 0;
        return region === side;
      });
      const pivot: Point = [side < 0 ? width * 0.32 : side > 0 ? width * 0.68 : hip[0], winged ? rows.length / 2 : rows.length - 5];
      const at = mapPoint(pivot, body);
      const angle = joint.lean + (winged ? joint.wing * side : joint.stride * side * 0.08 + joint.nearArm * side * 0.1);
      paint(canvas, part, { source: pivot, target: [at[0], at[1] + (swimming ? joint.head * side * 0.5 : 0)], angle });
    }
    const detail = look.detail ?? 'none';
    if (detail === 'mane') stamp(CREATURE_GEAR.mane, mapPoint([3, 2], body), joint.lean);
    if (detail === 'spikes') stamp(CREATURE_GEAR.spikes, mapPoint([10, -1], body), joint.lean);
    if (detail === 'staff') stamp(CREATURE_GEAR.staff, mapPoint([0, 5], body), joint.nearArm, [2, 0]);
    if (detail === 'crown') stamp(CREATURE_GEAR.crown, mapPoint([9, -3], body), joint.lean);
  }
}
