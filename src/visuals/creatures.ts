import { Canvas, type Ramp } from './bosses/raster';
import { attackCurve, type BossArt, type Pose } from './bosses/rig';

export type CreatureBody =
  | 'humanoid' | 'construct' | 'wolf' | 'cat' | 'boar' | 'rabbit'
  | 'spider' | 'crab' | 'bat' | 'fairy' | 'slime' | 'spirit'
  | 'worm' | 'reptile' | 'hydra' | 'toad' | 'plant' | 'egg'
  | 'eye' | 'relic' | 'wheel' | 'insect';
export type CreatureDetail = 'none' | 'bow' | 'staff' | 'spear' | 'horns' | 'crown' | 'spikes' | 'mane';
export interface CreatureLook {
  body: CreatureBody;
  color: number;
  accent?: number;
  detail?: CreatureDetail;
  heads?: number;
}

const INK = 0x20232b;
const BONE = 0xe9dfbd;
const METAL = 0x9aa9b4;
const TAU = Math.PI * 2;

function palette(color: number): Ramp {
  const red = (color >> 16) & 255;
  const green = (color >> 8) & 255;
  const blue = color & 255;
  const shade = (factor: number, lift: number): number =>
    (Math.min(255, Math.round(red * factor + lift)) << 16) |
    (Math.min(255, Math.round(green * factor + lift)) << 8) |
    Math.min(255, Math.round(blue * factor + lift));
  return [shade(0.48, 5), shade(0.76, 0), color, shade(0.85, 36)];
}

export function creatureArt(look: CreatureLook): BossArt {
  return {
    w: 64, h: 64, ground: 58, ink: INK, ember: look.accent ?? BONE,
    frames: { idle: 8, walk: 8, attack: 6, hurt: 3, death: 7 },
    rate: { idle: 7, walk: 12, attack: 15, hurt: 15, death: 12 },
    draw: (canvas, pose) => drawCreature(canvas, pose, look),
  };
}

function drawCreature(canvas: Canvas, pose: Pose, look: CreatureLook): void {
  const skin = palette(look.color);
  const accent = look.accent ?? 0xdccb80;
  const trim = palette(accent);
  const detail = look.detail ?? 'none';
  const looping = pose.anim === 'idle' || pose.anim === 'walk';
  const cycle = looping ? (pose.t % 1) * TAU : 0;
  const walking = pose.anim === 'walk';
  const gait = walking ? Math.sin(cycle) : 0;
  const breathe = looping ? Math.round(Math.sin(cycle)) : 0;
  const { wind, hit } = pose.anim === 'attack' ? attackCurve(pose.t) : { wind: 0, hit: 0 };
  const recoil = pose.anim === 'hurt' ? Math.round(2 * (1 - pose.t)) : 0;
  const lunge = Math.round(wind * 2 - hit * 5) + recoil;
  const center = 32 + lunge;
  const floor = 57;
  const bob = walking ? -Math.round(Math.abs(gait)) : -Math.max(0, breathe);
  const eye = (horizontal: number, vertical: number): void => {
    canvas.rect(horizontal, vertical, 3, 2, INK);
    canvas.dot(horizontal, vertical, accent);
  };
  const limb = (horizontal: number, top: number, stride: number, ramp: Ramp = skin): void => {
    const foot = horizontal + Math.round(stride);
    const lift = walking ? Math.max(0, Math.round(stride * 0.5)) : 0;
    canvas.line(horizontal, top, foot, floor - lift - 1, ramp[1], 3);
    canvas.rect(foot - 2, floor - lift - 1, 4, 2, ramp[0]);
  };
  const horn = (horizontal: number, vertical: number, direction: number): void => {
    canvas.poly([[horizontal - 2, vertical + 2], [horizontal + direction * 3, vertical - 5], [horizontal + 2, vertical + 2]], [BONE]);
  };

  if (look.body === 'humanoid' || look.body === 'construct') {
    const stone = look.body === 'construct';
    const width = stone ? 8 : 5;
    const waist = floor - 10 + bob;
    limb(center + 4, waist, -gait * 3);
    limb(center - 4, waist, gait * 3);
    canvas.poly([[center - width, waist - 12], [center + width, waist - 12], [center + width + 1, waist], [center - width, waist + 1]], skin);
    canvas.rect(center - width + 1, waist - 11, 3, 8, skin[3]);
    canvas.rect(center - width, waist - 1, width * 2, 2, trim[0]);
    canvas.ellipse(center - 1, waist - 17, stone ? 6 : 5, 5, skin);
    eye(center - 5, waist - 18);
    canvas.line(center + width, waist - 10, center + width + 2 + gait, waist - 2, skin[1], stone ? 5 : 3);
    const hand = center - width - 3 - Math.round(hit * 4);
    canvas.line(center - width, waist - 10, hand, waist - 4 - Math.round(hit * 4), skin[2], stone ? 5 : 3);
    if (stone) {
      canvas.rect(center - 2, waist - 9, 4, 4, trim[1]);
      canvas.rect(center - 1, waist - 9, 2, 2, accent);
      canvas.line(center + 2, waist - 20, center + 4, waist - 16, skin[0]);
    }
    if (detail === 'bow') {
      canvas.line(hand, waist - 15, hand - 4, waist - 7, trim[2]);
      canvas.line(hand - 4, waist - 7, hand, waist + 1, trim[2]);
      canvas.line(hand, waist - 15, hand + Math.round(wind * 3), waist - 7, BONE);
      canvas.line(hand + Math.round(wind * 3), waist - 7, hand, waist + 1, BONE);
      canvas.line(hand - 7, waist - 7, hand + 2, waist - 7, METAL);
    } else if (detail === 'staff' || detail === 'spear') {
      canvas.line(hand, floor - 1, hand, waist - 22, trim[1], 2);
      if (detail === 'staff') canvas.ellipse(hand, waist - 24, 3, 3, trim);
      else canvas.poly([[hand - 2, waist - 22], [hand, waist - 29], [hand + 2, waist - 22]], [METAL, BONE]);
    } else if (detail === 'horns') {
      horn(center - 5, waist - 21, -1);
      horn(center + 3, waist - 21, 1);
    } else if (detail === 'crown') {
      canvas.rect(center - 5, waist - 23, 9, 2, accent);
      for (const offset of [-5, -1, 3]) canvas.rect(center + offset, waist - 26, 2, 3, accent);
    }
    return;
  }

  if (['wolf', 'cat', 'boar', 'rabbit', 'reptile'].includes(look.body)) {
    const rabbit = look.body === 'rabbit';
    const reptile = look.body === 'reptile';
    const boar = look.body === 'boar';
    const top = floor - (rabbit ? 9 : reptile ? 8 : 13) + bob;
    const rear = center + (rabbit ? 4 : 7);
    const front = center - (rabbit ? 4 : 7);
    limb(rear + 1, top + 2, gait * 3, [skin[0], skin[0], skin[1], skin[2]]);
    limb(front + 2, top + 2, -gait * 3, [skin[0], skin[0], skin[1], skin[2]]);
    canvas.tube([[rear, top, 3], [center + 13, top - 2, 2], [center + 17, top - 6 + breathe, 1]], skin);
    canvas.ellipse(center, top, rabbit ? 8 : 12, boar ? 8 : 6, skin);
    limb(rear - 1, top + 3, -gait * 3);
    limb(front - 2, top + 3, gait * 3);
    if (detail === 'mane') canvas.ellipse(front - 2, top - 4, 8, 9, trim);
    canvas.ellipse(front - 4, top - 4, boar ? 6 : 5, 5, skin);
    canvas.ellipse(front - (reptile ? 10 : 7), top - 2, reptile ? 7 : 4, 3, skin);
    canvas.dot(front - (reptile ? 16 : 10), top - 3, INK);
    eye(front - 7, top - 6);
    if (!reptile) {
      canvas.poly([[front - 7, top - 7], [front - 5, top - (rabbit ? 22 : 13)], [front - 2, top - 7]], skin);
      if (rabbit) {
        canvas.poly([[front - 1, top - 7], [front + 2 + breathe, top - 21], [front + 3, top - 6]], skin);
        canvas.line(front - 5, top - 11, front - 5, top - 17, accent);
        canvas.ellipse(rear + 4, top - 2, 3, 3, [BONE]);
      }
    }
    if (boar) horn(front - 7, top + 1, -1);
    if (detail === 'spikes' || reptile) {
      for (const offset of [-3, 2, 7]) canvas.poly([[center + offset - 2, top - 5], [center + offset, top - 10], [center + offset + 2, top - 5]], trim);
    }
    return;
  }

  if (look.body === 'spider' || look.body === 'crab') {
    const crab = look.body === 'crab';
    const top = floor - 8 + bob;
    for (const side of [-1, 1]) {
      for (let leg = 0; leg < 4; leg++) {
        const stride = walking ? Math.round(Math.sin(cycle + leg * Math.PI / 2) * 2) : 0;
        const root = center + side * 5;
        const joint = center + side * (10 + leg);
        const tip = center + side * (12 + leg) + stride;
        canvas.line(root, top - 3 + leg * 2, joint, top - 5 + leg * 2, skin[1], 2);
        canvas.line(joint, top - 5 + leg * 2, tip, floor - 1 - (leg % 2), skin[2]);
      }
    }
    canvas.ellipse(center + 3, top - 2, crab ? 9 : 8, crab ? 5 : 7, skin);
    canvas.ellipse(center - 6, top + 1, 5, 4, skin);
    eye(center - 9, top);
    canvas.dot(center - 5, top - 1, accent);
    if (crab) {
      for (const side of [-1, 1]) {
        const claw = center + side * 13;
        canvas.line(center + side * 6, top, claw, top - 7 - hit * 3, skin[2], 2);
        canvas.ellipse(claw, top - 9 - hit * 3, 4, 4, trim);
        canvas.line(claw, top - 13 - hit * 3, claw, top - 9 - hit * 3, INK);
      }
    } else {
      canvas.line(center - 9, top + 3, center - 11 - hit * 2, top + 6, BONE);
      canvas.line(center - 5, top + 3, center - 6, top + 6, BONE);
      canvas.rect(center + 2, top - 5, 3, 3, accent);
    }
    return;
  }

  if (look.body === 'bat' || look.body === 'fairy' || look.body === 'insect') {
    const fairy = look.body !== 'bat';
    const top = floor - 18 + breathe;
    const flap = looping ? Math.round(Math.sin(cycle) * 7) : Math.round(hit * 5);
    for (const side of [-1, 1]) {
      const wing = center + side * 18;
      canvas.poly([[center + side * 2, top - 3], [wing, top - 9 + flap], [center + side * 13, top + 4 + flap], [center + side * 9, top + 1 + flap], [center + side * 5, top + 7]], fairy ? trim : skin);
      canvas.line(center + side * 3, top - 2, wing, top - 9 + flap, fairy ? BONE : skin[3]);
    }
    canvas.ellipse(center, top + 1, 4, 7, skin);
    canvas.ellipse(center - 1, top - 6, 4, 4, skin);
    if (!fairy) {
      horn(center - 4, top - 9, -1);
      horn(center + 2, top - 9, 1);
    }
    eye(center - 4, top - 7);
    canvas.line(center - 2, top + 5, center - 4, top + 11, skin[1]);
    if (look.body === 'insect') {
      for (const offset of [0, 3, 6]) canvas.rect(center - 3, top + offset, 6, 1, INK);
      canvas.line(center - 3, top - 9, center - 7, top - 13, skin[3]);
      canvas.line(center, top - 9, center + 3, top - 13, skin[3]);
    }
    return;
  }

  if (look.body === 'eye') {
    const top = floor - 19 + breathe;
    for (const offset of [-6, 0, 6]) {
      canvas.tube([[center + offset, top + 4, 2], [center + offset + breathe, top + 11, 1.5], [center + offset - 3, top + 15, 0.7]], skin);
    }
    canvas.ellipse(center, top, 10, 8, skin);
    canvas.ellipse(center - 2, top, 7, 5, [BONE]);
    canvas.ellipse(center - 4, top, 3, 4, trim);
    canvas.rect(center - 5, top - 3, 2, 6, INK);
    canvas.dot(center - 5, top - 2, 0xffffff);
    return;
  }

  if (look.body === 'relic' || look.body === 'wheel') {
    const top = floor - 15 + breathe;
    if (look.body === 'wheel') {
      canvas.ellipse(center, top, 11, 11, skin);
      canvas.ellipse(center, top, 7, 7, [INK]);
      for (let spoke = 0; spoke < 3; spoke++) {
        const angle = spoke * TAU / 3 + (looping ? cycle : hit * Math.PI);
        canvas.line(center, top, center + Math.cos(angle) * 9, top + Math.sin(angle) * 9, skin[3], 2);
      }
      canvas.ellipse(center, top, 3, 3, trim);
    } else {
      canvas.poly([[center, top - 17], [center + 7, top - 10], [center + 6, floor - 4], [center - 7, floor - 4], [center - 8, top - 10]], skin);
      canvas.line(center, top - 14, center, floor - 6, skin[3]);
      canvas.rect(center - 10, floor - 3, 20, 3, skin[1]);
      canvas.poly([[center - 1, top - 8], [center + 3, top - 3], [center - 1, top + 2], [center - 5, top - 3]], trim);
      canvas.dot(center - 1, top - 3, BONE);
    }
    return;
  }

  if (look.body === 'slime' || look.body === 'toad' || look.body === 'egg') {
    const egg = look.body === 'egg';
    const toad = look.body === 'toad';
    const squash = looping ? breathe : Math.round(wind * 2 - hit * 2);
    const radius = egg ? 7 : 11 + squash;
    const height = egg ? 10 : 8 - squash;
    if (toad) {
      canvas.ellipse(center + 9, floor - 3, 6, 4, skin);
      canvas.rect(center - 11, floor - 2, 6, 2, skin[1]);
    }
    canvas.ellipse(center, floor - height, radius, height, skin);
    if (egg) {
      canvas.dot(center - 3, floor - 12, accent);
      canvas.rect(center + 2, floor - 8, 2, 3, accent);
    } else {
      if (toad) canvas.ellipse(center - 6, floor - height * 2 + 2, 4, 3, skin);
      eye(center - 7, floor - height - 2);
      canvas.dot(center - 1, floor - height - 2, INK);
      canvas.line(center - 7, floor - height + 3, center, floor - height + 3, skin[0]);
      canvas.rect(center - 5, floor - height * 2 + 3, 4, 2, skin[3]);
      if (toad && hit > 0.2) canvas.line(center - 9, floor - height + 2, center - 22, floor - height + 2, accent, 2);
    }
    return;
  }

  if (look.body === 'worm' || look.body === 'hydra') {
    const hydra = look.body === 'hydra';
    canvas.ellipse(center + 4, floor - 4, 12, 4, skin);
    const count = hydra ? Math.max(3, Math.min(6, look.heads ?? 3)) : 1;
    for (let head = count - 1; head >= 0; head--) {
      const offset = hydra ? head * 4 - (count - 1) * 2 : 0;
      const sway = looping ? Math.round(Math.sin(cycle + head * 0.6) - Math.sin(head * 0.6)) : 0;
      const headX = center - 6 + offset + sway;
      const headY = floor - (hydra ? 21 + (head % 3) * 9 : 17) - Math.round(hit * 2);
      canvas.tube([[center + offset, floor - 5, 4], [center + offset + 3, floor - 15, 3], [headX, headY, 2.5]], skin);
      canvas.ellipse(headX - 2, headY, 5, 3, skin);
      eye(headX - 5, headY - 1);
      if (hydra) horn(headX + 1, headY - 2, 1);
      canvas.dot(headX - 5, headY + 2, BONE);
    }
    return;
  }

  if (look.body === 'plant') {
    for (const side of [-1, 1]) {
      canvas.line(center, floor, center + side * 10, floor - 1, skin[1], 2);
      canvas.poly([[center, floor - 12], [center + side * 12, floor - 20 + breathe], [center + side * 9, floor - 10]], skin);
    }
    canvas.line(center, floor, center + breathe, floor - 21, skin[2], 3);
    canvas.ellipse(center + breathe, floor - 23, 7, 6, trim);
    eye(center - 4 + breathe, floor - 24);
    if (detail === 'spikes') for (const offset of [-5, 0, 5]) horn(center + offset, floor - 28, offset < 0 ? -1 : 1);
    return;
  }

  const float = floor - 16 + breathe;
  canvas.poly([[center - 7, float - 3], [center + 7, float - 3], [center + 9, float + 10], [center + 3, float + 7], [center, float + 12], [center - 4, float + 8], [center - 9, float + 10]], skin);
  canvas.ellipse(center - 1, float - 6, 7, 7, skin);
  canvas.ellipse(center - 3, float - 6, 4, 3, [skin[0]]);
  eye(center - 6, float - 7);
  canvas.line(center - 7, float - 1, center - 12 - hit * 3, float + 4 + breathe, skin[2], 2);
  canvas.line(center + 6, float - 1, center + 11, float + 4 - breathe, skin[1], 2);
  if (detail === 'crown') {
    canvas.rect(center - 6, float - 13, 10, 2, accent);
    for (const offset of [-6, -2, 2]) canvas.rect(center + offset, float - 16, 2, 3, accent);
  }
  if (detail === 'staff') {
    canvas.line(center - 12, floor - 1, center - 12, float - 15, trim[1]);
    canvas.ellipse(center - 12, float - 16, 3, 3, trim);
  }
}