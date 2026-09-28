// How a boss's frames are made: each boss draws itself for a pose (which
// animation, how far through it), and the rig turns poses into frames: the
// silhouette is edged in ink, the first hurt frame flashes, and death crumbles
// the last pose away into embers. Pure: no Phaser.

import { Canvas, lighten, span, strip, type Ramp } from './raster';
import type { PixelBuffer } from '../../world/pixels';

export type BossAnim = 'idle' | 'walk' | 'attack' | 'hurt' | 'death';
export const BOSS_ANIMS: readonly BossAnim[] = ['idle', 'walk', 'attack', 'hurt', 'death'];

export interface Pose {
  anim: BossAnim;
  /** 0..1 through the animation; loops never reach 1. */
  t: number;
  f: number;
  n: number;
}

export interface BossArt {
  w: number;
  h: number;
  /** Screen pixels to one art pixel in the arena; the default suits a boss. */
  pixel?: number;
  frames: Record<BossAnim, number>;
  rate: Record<BossAnim, number>;
  ink: number;
  /** What the edges glow as the boss crumbles. */
  ember: number;
  draw(c: Canvas, pose: Pose): void;
}

/** Every boss frame is this tall, feet on GROUND (nine tenths down, as the arena anchors creatures). */
export const FRAME_H = 120;
export const GROUND = 108;

export const DEFAULT_FRAMES: Record<BossAnim, number> = { idle: 8, walk: 8, attack: 10, hurt: 4, death: 12 };
export const DEFAULT_RATE: Record<BossAnim, number> = { idle: 8, walk: 10, attack: 14, hurt: 14, death: 12 };

const LOOPS: ReadonlySet<BossAnim> = new Set(['idle', 'walk']);

export function renderAnim(art: BossArt, anim: BossAnim): Canvas[] {
  const n = art.frames[anim];
  const frames: Canvas[] = [];
  for (let f = 0; f < n; f++) {
    const t = LOOPS.has(anim) ? f / n : n > 1 ? f / (n - 1) : 0;
    const c = new Canvas(art.w, art.h);
    art.draw(c, { anim, t, f, n });
    if (anim === 'death') c.dissolve(span(t, 0.22, 0.96), 9173, art.ember);
    c.edge(art.ink);
    if (anim === 'hurt' && f === 0) c.map((color) => lighten(color, 0.62));
    frames.push(c);
  }
  return frames;
}

export function renderStrip(art: BossArt, anim: BossAnim): PixelBuffer {
  return strip(renderAnim(art, anim));
}

/** Attack timing shared by every boss: a wind-up, the blow, and the recovery. */
export function attackCurve(t: number): { wind: number; hit: number } {
  const wind = t < 0.38 ? easeInOut(t / 0.38) : 1 - easeOut(span(t, 0.38, 0.5));
  const hit = t < 0.4 ? 0 : t < 0.52 ? easeOut(span(t, 0.4, 0.52)) : 1 - easeInOut(span(t, 0.6, 1));
  return { wind, hit };
}

/** How far a hurt boss is knocked back (1 on the blow, easing to 0). */
export function recoil(pose: Pose): number {
  if (pose.anim === 'death') return 1;
  return pose.anim === 'hurt' ? 1 - easeInOut(pose.t) : 0;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** A ramp from hex strings, dark to light. */
export function ramp(...colors: string[]): Ramp {
  return colors.map((color) => parseInt(color.replace('#', ''), 16));
}
