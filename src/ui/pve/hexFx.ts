// The living look of each rune on the drawing table: how its lines glow and
// move, the motes they shed, and the burst it makes as it takes shape.

import Phaser from 'phaser';
import type { Facet } from '../../core/hexcraft/runes';
import type { Vec2 } from '../../core/utils';
import { GLOW } from '../../visuals/glowTextures';

type Graphics = Phaser.GameObjects.Graphics;

const TAU = Math.PI * 2;

export const HEXFX = {
  streak: 'hexfx-streak',
  cross: 'hexfx-cross',
  bubble: 'hexfx-bubble',
  shard: 'hexfx-shard',
  star: 'hexfx-star',
  flake: 'hexfx-flake',
} as const;

export type MoteTexture = keyof typeof HEXFX | 'soft';
const TEXTURE_SIZE: Record<MoteTexture, number> = { soft: 128, streak: 32, cross: 12, bubble: 12, shard: 12, star: 12, flake: 6 };
export const textureKey = (texture: MoteTexture): string => (texture === 'soft' ? GLOW.soft : HEXFX[texture]);

function paint(scene: Phaser.Scene, key: string, width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): void {
  if (scene.textures.exists(key)) return;
  const texture = scene.textures.createCanvas(key, width, height);
  const ctx = texture?.getContext();
  if (!texture || !ctx) return;
  draw(ctx);
  texture.refresh();
  texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
}

/** Small white mote shapes, tinted per rune. */
export function ensureHexFxTextures(scene: Phaser.Scene): void {
  paint(scene, HEXFX.streak, 32, 6, (ctx) => {
    const along = ctx.createLinearGradient(0, 0, 32, 0);
    along.addColorStop(0, 'rgba(255,255,255,0)');
    along.addColorStop(0.8, 'rgba(255,255,255,1)');
    along.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = along;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(0, 1, 32, 4);
    ctx.globalAlpha = 1;
    ctx.fillRect(0, 2, 32, 2);
  });
  paint(scene, HEXFX.cross, 12, 12, (ctx) => {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(4, 0, 4, 12);
    ctx.fillRect(0, 4, 12, 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(5, 1, 2, 10);
    ctx.fillRect(1, 5, 10, 2);
  });
  paint(scene, HEXFX.bubble, 12, 12, (ctx) => {
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(6, 6, 4.4, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(3.5, 3.5, 1.6, 1.6);
  });
  paint(scene, HEXFX.shard, 12, 12, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(9, 6);
    ctx.lineTo(6, 12);
    ctx.lineTo(3, 6);
    ctx.closePath();
    ctx.fill();
  });
  paint(scene, HEXFX.star, 12, 12, (ctx) => {
    const halo = ctx.createRadialGradient(6, 6, 0, 6, 6, 6);
    halo.addColorStop(0, 'rgba(255,255,255,0.8)');
    halo.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, 12, 12);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(7, 5);
    ctx.lineTo(12, 6);
    ctx.lineTo(7, 7);
    ctx.lineTo(6, 12);
    ctx.lineTo(5, 7);
    ctx.lineTo(0, 6);
    ctx.lineTo(5, 5);
    ctx.closePath();
    ctx.fill();
  });
  paint(scene, HEXFX.flake, 6, 6, (ctx) => {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(1, 0);
    ctx.lineTo(6, 2);
    ctx.lineTo(4, 6);
    ctx.lineTo(0, 4);
    ctx.closePath();
    ctx.fill();
  });
}

export function mix(a: number, b: number, t: number): number {
  const channel = (shift: number): number => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t) << shift;
  return channel(16) | channel(8) | channel(0);
}

const frac = (x: number): number => x - Math.floor(x);
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
/** A steady pseudo-random number in [0, 1) for a pair of inputs. */
export const hash = (a: number, b: number): number => frac(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453);
export const easeOut = (p: number): number => 1 - (1 - p) ** 3;
const easeIn = (p: number): number => p ** 3;

// -----------------------------------------------------------------------------
//  STYLES
// -----------------------------------------------------------------------------

export type BurstKind =
  | 'tap' | 'blast' | 'gust' | 'vortex' | 'bloom' | 'ripple' | 'splash' | 'arc'
  | 'smoke' | 'spin' | 'quake' | 'crack' | 'lock' | 'radiance' | 'ward' | 'glimmer';

/** Motes a rune's lines keep shedding. Sizes are in px. */
export interface MoteSpec {
  texture: MoteTexture;
  tints: number[];
  /** Milliseconds between motes. */
  every: number;
  life: number;
  speed: [number, number];
  angle: [number, number];
  gravity: number;
  size: [number, number];
  alpha: number;
  /** Drawn toward the middle of the grid. */
  toCentre?: boolean;
  spin?: boolean;
}

export interface FxStyle {
  glow: number;
  core: number;
  width: number;
  /** Slow swell of the light, 0-1, at `rate` radians a second. */
  breathe: number;
  rate: number;
  /** Fire-like stutter of the light, 0-1. */
  flicker: number;
  /** A wave running across the line, in px. */
  wave: number;
  waveLen: number;
  waveSpeed: number;
  /** Lightning-like jitter, in px. */
  jag: number;
  /** Beads of light running along each line. */
  flow: number;
  flowSpeed: number;
  flowSize: number;
  flowColor: number;
  /** Beads run toward the middle of the grid instead of out of it. */
  inward: boolean;
  /** Rings rising out of the grid (1) or closing into it (-1). */
  ring: number;
  ringRate: number;
  /** Sparks circling the grid; a spiral draws them in. */
  orbit: number;
  orbitSpeed: number;
  orbitRadius: number;
  spiral: boolean;
  heartbeat: boolean;
  motes: MoteSpec | null;
  /** How the rune announces itself once it takes shape. */
  burst: BurstKind;
}

function style(glow: number, extra: Partial<FxStyle> = {}): FxStyle {
  return {
    glow,
    core: mix(glow, 0xffffff, 0.55),
    width: 2.5,
    breathe: 0.22,
    rate: 2.2,
    flicker: 0,
    wave: 0,
    waveLen: 26,
    waveSpeed: 6,
    jag: 0,
    flow: 1,
    flowSpeed: 0.6,
    flowSize: 2.2,
    flowColor: mix(glow, 0xffffff, 0.6),
    inward: false,
    ring: 0,
    ringRate: 0.5,
    orbit: 0,
    orbitSpeed: 1.6,
    orbitRadius: 52,
    spiral: false,
    heartbeat: false,
    motes: null,
    burst: 'glimmer',
    ...extra,
  };
}

const rise = (texture: MoteTexture, tints: number[], extra: Partial<MoteSpec> = {}): MoteSpec => ({
  texture, tints, every: 120, life: 1400, speed: [8, 24], angle: [-110, -70], gravity: -12, size: [6, 1], alpha: 0.85, ...extra,
});
const fall = (texture: MoteTexture, tints: number[], extra: Partial<MoteSpec> = {}): MoteSpec => ({
  texture, tints, every: 160, life: 1100, speed: [0, 8], angle: [80, 100], gravity: 120, size: [4, 2], alpha: 0.9, ...extra,
});
const scatter = (texture: MoteTexture, tints: number[], extra: Partial<MoteSpec> = {}): MoteSpec => ({
  texture, tints, every: 120, life: 700, speed: [20, 60], angle: [0, 360], gravity: 0, size: [4, 0], alpha: 0.9, ...extra,
});
const gather = (tints: number[], extra: Partial<MoteSpec> = {}): MoteSpec => ({
  ...scatter('soft', tints), toCentre: true, every: 80, life: 900, size: [4, 1], ...extra,
});
const streaks = (tints: number[], extra: Partial<MoteSpec> = {}): MoteSpec => ({
  texture: 'streak', tints, every: 120, life: 550, speed: [100, 180], angle: [-6, 6], gravity: 0, size: [20, 8], alpha: 0.75, ...extra,
});

const TEAL = 0x7ec8b4;
const LILAC = 0xc0a0f0;
const glint = scatter('star', [LILAC, 0xffffff], { speed: [0, 6], every: 260, life: 900, size: [6, 0] });

export const FX: Record<Facet, FxStyle> = {
  heal: style(0x7fe0a0, {
    breathe: 0.35, rate: 2, flow: 2, flowSpeed: 0.45, flowSize: 2.4, ring: 1, ringRate: 0.35,
    motes: rise('cross', [0x7fe0a0, 0xd8ffe4], { every: 150, size: [7, 3] }), burst: 'bloom',
  }),
  blight: style(0xa04ab8, {
    core: 0x1e0626, width: 3, flicker: 0.15, flowColor: 0xd070ff, flowSpeed: 0.3,
    motes: fall('soft', [0xa04ab8, 0x6a1a88], { size: [5, 2], every: 120 }), burst: 'splash',
  }),
  regen: style(0x9ce08a, {
    heartbeat: true, flow: 2, flowSpeed: 0.35,
    motes: rise('soft', [0x9ce08a, 0xe8ffd0], { every: 170, size: [5, 1] }), burst: 'bloom',
  }),
  wither: style(0x9a8a6a, {
    core: 0x3a3020, width: 3, flicker: 0.1, breathe: 0.15, flow: 0,
    motes: fall('flake', [0x9a8a6a, 0x6a5a44, 0xc8b890], { speed: [2, 10], angle: [60, 120], gravity: 30, every: 120, life: 1800, size: [4, 3], spin: true }),
    burst: 'splash',
  }),
  dot: style(0xd0405a, {
    core: 0xffc8d0, flowSpeed: 0.25,
    motes: fall('soft', [0xd0405a, 0x8a1020], { gravity: 170, speed: [0, 6], every: 210, size: [4, 3], life: 900 }), burst: 'splash',
  }),
  burst: style(0xff5a2a, {
    core: 0xffe0a0, flicker: 0.5, jag: 2, ring: 1, ringRate: 1.1,
    motes: rise('soft', [0xff5a2a, 0xffc040], { speed: [20, 60], angle: [-130, -50], gravity: -30, every: 60, size: [4, 0], life: 800 }),
    burst: 'blast',
  }),
  wind: style(0xbfe6ff, {
    core: 0xffffff, wave: 3.5, waveLen: 22, waveSpeed: 10, flow: 3, flowSpeed: 1.4, flowSize: 1.6,
    motes: streaks([0xbfe6ff, 0xffffff]), burst: 'gust',
  }),
  cyclone: style(0x6fb0f0, {
    wave: 2, waveSpeed: 12, flow: 2, flowSpeed: 1, inward: true, orbit: 5, orbitSpeed: 3.2, orbitRadius: 62, spiral: true,
    motes: gather([0x6fb0f0, 0xd0e8ff]), burst: 'vortex',
  }),
  corrosive: style(0x9be870, {
    core: 0xe8ffc0, flicker: 0.12, wave: 1, waveSpeed: 3, flowSpeed: 0.3,
    motes: rise('bubble', [0x9be870, 0xd8ff90], { speed: [6, 18], every: 130, size: [5, 9], life: 1200, alpha: 0.8 }), burst: 'splash',
  }),
  purify: style(0xe6fff2, {
    core: 0xffffff, breathe: 0.4, rate: 3, flow: 2, flowSpeed: 0.5,
    motes: scatter('star', [0xffffff, 0xc8fff0], { speed: [0, 8], gravity: -6, every: 90, life: 1000, size: [8, 0] }), burst: 'bloom',
  }),
  light: style(0xf3e9a0, {
    core: 0xffffff, width: 3, breathe: 0.45, rate: 3.2, flow: 2, flowSpeed: 0.7, ring: 1, ringRate: 0.6,
    motes: rise('star', [0xfff4c0, 0xffffff], { every: 80, size: [9, 0], speed: [4, 14] }), burst: 'radiance',
  }),
  shadow: style(0x7a5ac8, {
    core: 0x140a24, width: 3, breathe: 0.3, rate: 1.2, wave: 2, waveSpeed: 2.5, waveLen: 34, flow: 0,
    motes: rise('soft', [0x4a2a80, 0x2a1850], { size: [10, 20], alpha: 0.55, speed: [4, 12], life: 1800, every: 110 }), burst: 'smoke',
  }),
  mist: style(0xb0c8d8, {
    core: 0xf0f8ff, breathe: 0.35, rate: 1, wave: 1.5, waveSpeed: 2, waveLen: 40, flow: 0,
    motes: rise('soft', [0xb0c8d8, 0xe8f0f8], { size: [12, 24], alpha: 0.4, speed: [2, 8], life: 2200, every: 120 }), burst: 'smoke',
  }),
  fire: style(0xff6a2a, {
    core: 0xfff0b0, flicker: 0.5, wave: 1, waveSpeed: 9,
    motes: rise('soft', [0xff6a2a, 0xffc040, 0xff3010], { speed: [20, 55], gravity: -50, every: 50, life: 800, size: [5, 0] }), burst: 'blast',
  }),
  frost: style(0x9fdcff, {
    core: 0xffffff, breathe: 0.2, rate: 1.4, flowSpeed: 0.2,
    motes: fall('flake', [0x9fdcff, 0xffffff], { speed: [2, 10], gravity: 30, every: 140, life: 1800, size: [5, 3], spin: true }), burst: 'crack',
  }),
  shatter: style(0xd8c8a8, {
    core: 0xfff8e8, width: 3.5, jag: 1.8,
    motes: scatter('shard', [0xd8c8a8, 0x8a7a5a], { speed: [30, 90], gravity: 200, every: 160, life: 700, spin: true }), burst: 'quake',
  }),
  pierce: style(0xe8e8f0, {
    core: 0xffffff, width: 2, flow: 3, flowSpeed: 2.6, flowSize: 1.6,
    motes: streaks([0xe8e8f0, 0xffffff], { speed: [200, 280], every: 130, life: 320, size: [18, 3] }), burst: 'crack',
  }),
  water: style(0x4aa0e0, {
    core: 0xd0f0ff, wave: 3, waveLen: 30, waveSpeed: 4, flow: 2, flowSpeed: 0.8,
    motes: fall('bubble', [0x4aa0e0, 0xa0d8ff], { speed: [0, 10], gravity: 60, every: 150, life: 1100, size: [4, 6] }), burst: 'splash',
  }),
  mind: style(0xd080e0, {
    core: 0xffe0ff, breathe: 0.4, rate: 2.6, orbit: 3, orbitSpeed: 1.8, orbitRadius: 50,
    motes: gather([0xd080e0, 0xffc8ff]), burst: 'ripple',
  }),
  malform: style(0x80b070, {
    core: 0xe0ffd0, wave: 2.5, waveLen: 14, waveSpeed: 3, flicker: 0.15,
    motes: rise('bubble', [0x80b070, 0x506a40], { speed: [4, 14], every: 140, life: 1300, size: [6, 10], alpha: 0.75 }), burst: 'splash',
  }),
  edge: style(0xc04050, {
    core: 0xffe0e4, width: 2, jag: 0.8, flow: 2, flowSpeed: 2,
    motes: fall('soft', [0xc04050, 0x801020], { gravity: 200, speed: [0, 6], every: 200, size: [3, 2], life: 800 }), burst: 'crack',
  }),
  void: style(0x6040a0, {
    core: 0x0a0414, width: 3.5, breathe: 0.45, rate: 0.9, ring: -1, ringRate: 0.5, flow: 0,
    motes: gather([0x6040a0, 0x20103a]), burst: 'vortex',
  }),
  lance: style(0xfff0a0, {
    core: 0xffffff, width: 3, flow: 4, flowSpeed: 3, flowSize: 1.8,
    motes: streaks([0xfff0a0, 0xffffff], { speed: [220, 320], every: 100, life: 300, size: [24, 4] }), burst: 'radiance',
  }),
  ricochet: style(0xd0d0ff, {
    core: 0xffffff, jag: 1.4, flow: 2, flowSpeed: 2.2,
    motes: scatter('soft', [0xd0d0ff, 0xffffff], { speed: [60, 140], every: 140, life: 360, size: [3, 0] }), burst: 'arc',
  }),
  blink: style(0xb8a8ff, {
    core: 0xffffff, flicker: 0.35, flow: 0,
    motes: scatter('star', [0xb8a8ff, 0xffffff], { speed: [0, 4], every: 180, life: 500, size: [7, 0] }), burst: 'glimmer',
  }),
  swap: style(0x9a88e8, {
    orbit: 2, orbitSpeed: 2.4, orbitRadius: 50, flow: 2, flowSpeed: 1.2,
    motes: scatter('star', [0x9a88e8, 0xffffff], { speed: [0, 6], every: 200, life: 600, size: [6, 0] }), burst: 'spin',
  }),
  infuse: style(0x5a9aff, {
    core: 0xe0f0ff, flow: 3, flowSpeed: 0.8, inward: true,
    motes: gather([0x5a9aff, 0xc0e0ff]), burst: 'bloom',
  }),
  manaburn: style(0x3a5ad0, {
    core: 0xc0d0ff, flicker: 0.4, jag: 1,
    motes: rise('soft', [0x3a5ad0, 0x8aa0ff], { speed: [16, 40], gravity: -30, every: 80, life: 700, size: [4, 0] }), burst: 'blast',
  }),
  mark: style(0xff6060, {
    core: 0xffe0e0, ring: -1, ringRate: 0.7, flow: 0, burst: 'lock',
  }),
  silence: style(0xc0c0d0, {
    core: 0xffffff, breathe: 0.1, flow: 0,
    motes: fall('soft', [0xc0c0d0, 0x8a8a9a], { gravity: 20, speed: [0, 4], every: 260, life: 1600, size: [4, 2] }), burst: 'lock',
  }),
  might: style(0xffa040, {
    core: 0xfff0d0, width: 3.5, heartbeat: true, flow: 2,
    motes: rise('soft', [0xffa040, 0xffe0a0], { every: 120, size: [6, 1] }), burst: 'radiance',
  }),
  feeble: style(0x8a7a6a, {
    core: 0xd0c8b8, breathe: 0.15, rate: 0.7, flowSpeed: 0.15,
    motes: fall('soft', [0x8a7a6a, 0x5a4a3a], { gravity: 40, every: 220, life: 1400, size: [4, 2] }), burst: 'smoke',
  }),
  twist: style(0xc8d878, {
    orbit: 3, orbitSpeed: 2.6, orbitRadius: 54, flow: 2, flowSpeed: 0.9,
    motes: scatter('soft', [0xc8d878, 0xffffc0], { speed: [10, 24], every: 140, life: 900 }), burst: 'spin',
  }),
  anchor: style(0xb89a6a, {
    core: 0xffe8c0, width: 3.5, breathe: 0.3, rate: 1.1, flow: 0,
    motes: fall('shard', [0xb89a6a, 0x7a6040], { gravity: 220, speed: [0, 4], every: 230, size: [6, 5], spin: true }), burst: 'quake',
  }),
  missile: style(0xb98bff, {
    core: 0xffffff, jag: 1.5, flow: 3, flowSpeed: 2.4, flowSize: 2,
    motes: scatter('soft', [0xb98bff, 0xffffff], { speed: [30, 80], every: 120, life: 420, size: [3, 0] }), burst: 'arc',
  }),
  siphon: style(0xe0405a, {
    core: 0xffd0d8, flow: 3, flowSpeed: 1.1, inward: true, flowColor: 0xff8090,
    motes: gather([0xe0405a, 0xff9aa8]), burst: 'vortex',
  }),
  explosion: style(0xff8a2f, {
    core: 0xfff0b0, flicker: 0.45, jag: 1, ring: 1, ringRate: 0.9,
    motes: rise('soft', [0xff8a2f, 0xffd060, 0xff4020], { speed: [16, 50], gravity: -40, every: 50, life: 900, size: [5, 0] }), burst: 'blast',
  }),
  implosion: style(0xa86aff, {
    core: 0xf0e0ff, ring: -1, ringRate: 0.8, flow: 2, flowSpeed: 1.2, inward: true,
    motes: gather([0xa86aff, 0xe0c8ff], { every: 60, life: 700 }), burst: 'vortex',
  }),
  barrier: style(0x8ad1ff, {
    core: 0xe8f8ff, width: 3, breathe: 0.3, rate: 1.6, ring: 1, ringRate: 0.4, flowSpeed: 0.4,
    motes: scatter('shard', [0x8ad1ff, 0xffffff], { speed: [0, 6], every: 160, life: 1100, size: [5, 0], alpha: 0.7 }), burst: 'ward',
  }),
  breach: style(0xe0803a, {
    core: 0xfff0d0, jag: 2.6, flicker: 0.25,
    motes: scatter('shard', [0xe0803a, 0xffc080], { speed: [20, 60], gravity: 120, every: 150, life: 700, spin: true }), burst: 'crack',
  }),
  accelerate: style(0xffd166, {
    core: 0xffffff, flow: 4, flowSpeed: 2.2, flowSize: 1.8, wave: 1.5, waveSpeed: 16,
    motes: streaks([0xffd166, 0xffffff], { speed: [160, 240], every: 110, life: 380, size: [16, 5] }), burst: 'gust',
  }),
  slow: style(0x6a8ad8, {
    core: 0xd8e4ff, breathe: 0.25, rate: 0.8, wave: 2.5, waveSpeed: 1.6, waveLen: 40, flowSpeed: 0.12, flowSize: 2.6,
    motes: fall('soft', [0x6a8ad8, 0xa8c0ff], { speed: [2, 6], gravity: 10, every: 220, life: 2200, size: [5, 3] }), burst: 'smoke',
  }),
  single: style(TEAL, { flow: 2, flowSpeed: 0.8, burst: 'lock' }),
  self: style(TEAL, { flow: 2, flowSpeed: 0.8, inward: true, burst: 'lock' }),
  aoe: style(TEAL, { ring: 1, ringRate: 0.7, burst: 'ripple' }),
  nova: style(TEAL, { ring: 1, ringRate: 1, flow: 2, burst: 'ripple' }),
  multi: style(TEAL, { jag: 0.8, flow: 3, flowSpeed: 1.2, burst: 'lock' }),
  chain: style(TEAL, { jag: 1.6, flow: 2, flowSpeed: 2, burst: 'arc' }),
  battlefield: style(TEAL, { ring: 1, ringRate: 0.4, flow: 2, burst: 'ripple' }),
  seeker: style(TEAL, { orbit: 1, orbitSpeed: 2, orbitRadius: 58, burst: 'lock' }),
  environment: style(TEAL, { flow: 0, motes: fall('soft', [TEAL, 0x5a8a7a], { gravity: 40, every: 200, life: 1300 }), burst: 'quake' }),
  aura: style(TEAL, { orbit: 4, orbitSpeed: 1.2, ring: 1, ringRate: 0.5, burst: 'ripple' }),
  bigger: style(LILAC, { ring: 1, ringRate: 0.6, motes: glint, burst: 'ripple' }),
  smaller: style(LILAC, { ring: -1, ringRate: 0.6, motes: glint, burst: 'glimmer' }),
  rangeUp: style(LILAC, { flow: 2, flowSpeed: 1.5, wave: 1.5, waveSpeed: 8, motes: glint, burst: 'gust' }),
  rangeDown: style(LILAC, { flowSpeed: 0.2, motes: glint, burst: 'quake' }),
  allies: style(LILAC, { breathe: 0.35, flow: 2, motes: rise('cross', [LILAC, 0x9ce0b0], { every: 200 }), burst: 'bloom' }),
  enemies: style(LILAC, { jag: 1.2, motes: scatter('shard', [LILAC, 0xe0803a], { every: 200, spin: true }), burst: 'crack' }),
};

/** Lines that read as no rune yet. */
export const RAW_FX = style(0xcfc6e6, { core: 0xffffff, breathe: 0.1, flicker: 0.2, flow: 0 });
/** A struck seal: a burning wick from the eye to the grid. */
export const SEAL_FX = style(0xff5a74, { core: 0xffd6dd, flicker: 0.4, jag: 1.2, flow: 1, flowSpeed: 1, flowColor: 0xffb070 });
/** A coupling chain. */
export const CHAIN_FX = style(0xe8c872, { core: 0xfff1c0, flow: 0, breathe: 0.15 });

// -----------------------------------------------------------------------------
//  DRAWING THE LIVING LINES
// -----------------------------------------------------------------------------

/** One drawn line on the table. Beads run from `a` to `b`, or back when `reverse`. */
export interface Seg {
  a: Vec2;
  b: Vec2;
  len: number;
  salt: number;
  reverse: boolean;
  key: string;
}

/** How bright the rune burns this instant. */
export function strengthOf(fx: FxStyle, t: number, seed: number, reduced: boolean): number {
  if (reduced) return 1;
  let s = 1 - fx.breathe * (0.5 + 0.5 * Math.sin(t * fx.rate + seed));
  if (fx.heartbeat) {
    const ph = frac(t / 1.15 + seed);
    s = 0.6 + 0.8 * (Math.exp(-(((ph - 0.08) / 0.045) ** 2)) + 0.65 * Math.exp(-(((ph - 0.26) / 0.045) ** 2)));
  }
  if (fx.flicker) s *= 1 - fx.flicker * hash(Math.floor(t * 18), seed);
  return s;
}

/** A point `u` of the way along a line, bent by its wave and jitter; the ends stay pinned to their pegs. */
function pointOn(seg: Seg, u: number, fx: FxStyle, t: number, seed: number, still: boolean): Vec2 {
  const dx = seg.b.x - seg.a.x;
  const dy = seg.b.y - seg.a.y;
  let off = 0;
  if (!still) {
    const pin = Math.sin(Math.PI * u);
    if (fx.wave) off += fx.wave * pin * Math.sin(((u * seg.len) / fx.waveLen) * TAU - t * fx.waveSpeed + seed);
    if (fx.jag) off += fx.jag * pin * (hash(Math.floor(t * 14) + seg.salt, Math.round(u * 10) + seed) * 2 - 1);
  }
  return { x: seg.a.x + dx * u - (dy / seg.len) * off, y: seg.a.y + dy * u + (dx / seg.len) * off };
}

export function drawLines(glow: Graphics, core: Graphics, segs: readonly Seg[], fx: FxStyle, t: number, seed: number, strength: number, reduced: boolean): void {
  const bends = !reduced && (fx.wave > 0 || fx.jag > 0);
  for (const seg of segs) {
    const points = bends ? Array.from({ length: 11 }, (_, i) => pointOn(seg, i / 10, fx, t, seed, false)) : [seg.a, seg.b];
    glow.lineStyle(16, fx.glow, 0.1 * strength).strokePoints(points);
    glow.lineStyle(7, fx.glow, 0.3 * strength).strokePoints(points);
    core.lineStyle(fx.width, fx.core, Math.min(1, 0.45 + 0.6 * strength)).strokePoints(points);
    if (reduced || !fx.flow) continue;
    for (let k = 0; k < fx.flow; k++) {
      const run = frac(t * fx.flowSpeed * (60 / seg.len) + k / fx.flow + seg.salt * 0.37);
      const u = seg.reverse ? 1 - run : run;
      const at = pointOn(seg, u, fx, t, seed, !bends);
      const fade = Math.sin(Math.PI * u);
      glow.fillStyle(fx.flowColor, 0.45 * fade * strength).fillCircle(at.x, at.y, fx.flowSize * 2.4);
      core.fillStyle(mix(fx.flowColor, 0xffffff, 0.5), 0.9 * fade).fillCircle(at.x, at.y, fx.flowSize);
    }
  }
}

/** Rings and circling sparks around a grid's middle. */
export function drawAura(glow: Graphics, fx: FxStyle, centre: Vec2, t: number, seed: number, strength: number): void {
  if (fx.ring) {
    for (const offset of [0, 0.5]) {
      const ph = frac(t * fx.ringRate + offset + seed * 0.1);
      const r = fx.ring > 0 ? 16 + ph * 58 : 74 - ph * 58;
      glow.lineStyle(2, fx.glow, Math.sin(Math.PI * ph) * 0.4 * strength).strokeCircle(centre.x, centre.y, r);
    }
  }
  for (let k = 0; k < fx.orbit; k++) {
    const angle = t * fx.orbitSpeed + (k / fx.orbit) * TAU + seed;
    const ph = fx.spiral ? frac(t * 0.5 + k / fx.orbit) : 0;
    const r = fx.spiral ? fx.orbitRadius * (1 - ph) + 6 : fx.orbitRadius;
    const alpha = fx.spiral ? Math.sin(Math.PI * ph) : 1;
    for (let j = 0; j < 6; j++) {
      const back = angle - j * 0.13 * Math.sign(fx.orbitSpeed);
      const rj = fx.spiral ? r + j * 1.6 : r;
      glow.fillStyle(fx.glow, 0.7 * alpha * (1 - j / 6) * strength).fillCircle(centre.x + Math.cos(back) * rj, centre.y + Math.sin(back) * rj, 3.6 - j * 0.45);
    }
  }
}

/** A crooked bolt from `from` to `to`, its kinks fixed by `key`. */
function jagged(from: Vec2, to: Vec2, jitter: number, steps: number, key: number): Vec2[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const u = i / steps;
    const off = (hash(key, i) * 2 - 1) * jitter * Math.sin(Math.PI * u);
    return { x: from.x + dx * u - (dy / len) * off, y: from.y + dy * u + (dx / len) * off };
  });
}

export const BURST_TIME: Record<BurstKind, number> = {
  tap: 240, blast: 700, gust: 650, vortex: 850, bloom: 950, ripple: 950, splash: 700, arc: 450,
  smoke: 1000, spin: 750, quake: 650, crack: 700, lock: 700, radiance: 950, ward: 850, glimmer: 750,
};

/** One frame of a burst `p` of the way through, drawn additively around `c`. */
export function drawBurst(g: Graphics, kind: BurstKind, c: Vec2, color: number, p: number, t: number, seed: number): void {
  const fade = 1 - p;
  const e = easeOut(p);
  const ring = (r: number, width: number, alpha: number, tint = color): void => {
    if (alpha > 0.01 && r > 0) g.lineStyle(width, tint, Math.min(1, alpha)).strokeCircle(c.x, c.y, r);
  };
  const polar = (angle: number, r: number): Vec2 => ({ x: c.x + Math.cos(angle) * r, y: c.y + Math.sin(angle) * r });
  const line = (from: Vec2, to: Vec2, width: number, alpha: number, tint = color): void => {
    g.lineStyle(width, tint, Math.min(1, alpha)).lineBetween(from.x, from.y, to.x, to.y);
  };
  switch (kind) {
    case 'tap':
      ring(4 + 12 * e, 2, fade * 0.9);
      return;
    case 'blast':
      if (p < 0.25) g.fillStyle(0xffffff, (1 - p / 0.25) * 0.55).fillCircle(c.x, c.y, 14 + 60 * p);
      ring(12 + 110 * e, 1 + 6 * fade, fade);
      ring(8 + 70 * easeOut(Math.min(1, p * 1.4)), 3, fade * 0.8, 0xffe0a0);
      return;
    case 'gust':
      for (let i = 0; i < 12; i++) {
        const a = hash(i, seed) * TAU + p * 0.8;
        const r = 10 + 130 * e;
        line(polar(a, r), polar(a + 0.12, r + 8 + 26 * fade), 2, fade);
      }
      ring(14 + 90 * e, 1.5, fade * 0.5);
      return;
    case 'vortex':
      ring(4 + 100 * (1 - easeIn(p)), 2, Math.sin(Math.PI * p) * 0.8);
      for (let arm = 0; arm < 3; arm++) {
        for (let j = 0; j < 12; j++) {
          const at = polar((arm * TAU) / 3 + j * 0.32 + p * 6, (1 - p) * 95 * (1 - j / 14) + 3);
          g.fillStyle(color, (1 - j / 12) * (1 - p * 0.5)).fillCircle(at.x, at.y, 2.6 * (1 - j / 13));
        }
      }
      return;
    case 'bloom':
    case 'ripple': {
      const reach = kind === 'bloom' ? 90 : 120;
      for (let k = 0; k < 3; k++) {
        const q = clamp01((p - k * 0.18) / 0.64);
        if (q > 0 && q < 1) ring(10 + reach * easeOut(q), kind === 'bloom' ? 3 : 1.5, (1 - q) * 0.75);
      }
      if (kind === 'bloom') {
        for (let i = 0; i < 6; i++) {
          const tip = polar((i * TAU) / 6 + p * 1.2, 18 + 50 * e);
          g.fillStyle(color, fade * 0.6).fillCircle(tip.x, tip.y, 4 * fade + 1);
        }
      }
      return;
    }
    case 'splash':
      ring(10 + 64 * e, 3, fade * 0.8);
      ring(6 + 30 * e, 1.5, fade * 0.6, 0xffffff);
      return;
    case 'arc': {
      const flick = Math.floor(t * 16);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + hash(i, seed) * 0.8;
        const bolt = jagged(c, polar(a, 70 + 25 * hash(i, flick)), 9, 6, flick * 7 + i);
        g.lineStyle(3, color, fade * 0.5).strokePoints(bolt);
        g.lineStyle(1.2, 0xffffff, fade).strokePoints(bolt);
      }
      return;
    }
    case 'smoke':
      ring(20 + 70 * e, 6, fade * 0.25);
      ring(12 + 40 * e, 2, fade * 0.4);
      return;
    case 'spin':
      for (let k = 0; k < 3; k++) {
        const outer = (k * TAU) / 3 + p * TAU * 1.5 + seed;
        g.lineStyle(4, color, fade).beginPath();
        g.arc(c.x, c.y, 58 - 20 * p, outer, outer + 1.2);
        g.strokePath();
        const inner = (k * TAU) / 3 - p * TAU * 2;
        g.lineStyle(2, 0xffffff, fade * 0.7).beginPath();
        g.arc(c.x, c.y, 32, inner, inner + 0.8);
        g.strokePath();
      }
      return;
    case 'quake': {
      const w = 40 + 170 * e;
      g.lineStyle(3, color, fade).strokeEllipse(c.x, c.y + 44, w, w * 0.28);
      g.lineStyle(1.5, color, fade * 0.6).strokeEllipse(c.x, c.y + 44, w * 0.6, w * 0.17);
      return;
    }
    case 'crack':
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + hash(i, seed) * 0.9;
        const bolt = jagged(c, polar(a, 20 + 70 * e * (0.6 + 0.4 * hash(i + 9, seed))), 7, 6, seed * 31 + i);
        g.lineStyle(3, color, Math.min(1, fade * 1.6) * 0.6).strokePoints(bolt);
        g.lineStyle(1.2, 0xffffff, Math.min(1, fade * 1.6)).strokePoints(bolt);
      }
      return;
    case 'lock': {
      const r = 92 - 58 * e;
      const turn = (1 - e) * 0.9;
      const alpha = p < 0.75 ? 1 : (1 - p) / 0.25;
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + (k * Math.PI) / 2 + turn;
        const corner = polar(a, r);
        for (const side of [-1, 1]) {
          const arm = a + Math.PI + (side * Math.PI) / 4;
          line(corner, { x: corner.x + Math.cos(arm) * 13, y: corner.y + Math.sin(arm) * 13 }, 2.5, alpha);
        }
      }
      if (p > 0.6) ring(26 + (50 * (p - 0.6)) / 0.4, 2, (1 - p) / 0.4);
      return;
    }
    case 'radiance':
      for (let i = 0; i < 10; i++) {
        const a = (i * TAU) / 10 + p * 0.6;
        line(polar(a, 16 + 10 * e), polar(a, 24 + 80 * e), 2, fade);
      }
      ring(20 + 60 * e, 2, fade * 0.7, 0xffffff);
      return;
    case 'ward': {
      const shell = (r: number): Vec2[] => Array.from({ length: 7 }, (_, i) => polar((i * TAU) / 6 + Math.PI / 6, r));
      g.lineStyle(3, color, fade).strokePoints(shell(18 + 74 * e));
      g.lineStyle(1.5, 0xffffff, fade * 0.5).strokePoints(shell((18 + 74 * e) * 0.6));
      return;
    }
    case 'glimmer':
      ring(40, 1.5, fade * 0.7);
      for (let i = 0; i < 8; i++) {
        const at = polar((i * TAU) / 8 + p * TAU * 0.5, 40);
        g.fillStyle(color, fade).fillCircle(at.x, at.y, 2.5);
      }
      return;
  }
}

/** The motes a burst throws out once. */
export interface MoteBurst {
  texture: MoteTexture;
  count: number;
  speed: [number, number];
  angle: [number, number];
  gravity: number;
  life: number;
  size: [number, number];
  /** Born on a ring this wide and drawn to the middle. */
  inward?: number;
  /** Born this far below the middle (dust thrown off the ground). */
  low?: number;
  spin?: boolean;
  extra?: number[];
}

export const BURST_MOTES: Partial<Record<BurstKind, MoteBurst>> = {
  blast: { texture: 'soft', count: 46, speed: [120, 340], angle: [0, 360], gravity: 160, life: 900, size: [6, 0], extra: [0xffd060] },
  gust: { texture: 'soft', count: 22, speed: [180, 320], angle: [0, 360], gravity: 0, life: 450, size: [4, 0] },
  vortex: { texture: 'soft', count: 36, speed: [0, 0], angle: [0, 360], gravity: 0, life: 700, size: [5, 1], inward: 95 },
  bloom: { texture: 'soft', count: 20, speed: [20, 60], angle: [-125, -55], gravity: -20, life: 1200, size: [7, 0] },
  ripple: { texture: 'soft', count: 18, speed: [60, 120], angle: [0, 360], gravity: 0, life: 800, size: [4, 0] },
  splash: { texture: 'soft', count: 28, speed: [80, 210], angle: [-160, -20], gravity: 520, life: 850, size: [5, 2] },
  arc: { texture: 'soft', count: 22, speed: [100, 260], angle: [0, 360], gravity: 0, life: 350, size: [3, 0] },
  smoke: { texture: 'soft', count: 14, speed: [10, 40], angle: [0, 360], gravity: -10, life: 1200, size: [14, 34] },
  spin: { texture: 'soft', count: 16, speed: [30, 80], angle: [0, 360], gravity: 0, life: 700, size: [4, 0] },
  quake: { texture: 'soft', count: 22, speed: [40, 130], angle: [-165, -15], gravity: 320, life: 800, size: [5, 2], low: 40 },
  crack: { texture: 'shard', count: 16, speed: [80, 220], angle: [0, 360], gravity: 360, life: 800, size: [7, 4], spin: true },
  lock: { texture: 'soft', count: 10, speed: [40, 90], angle: [0, 360], gravity: 0, life: 500, size: [3, 0] },
  radiance: { texture: 'star', count: 24, speed: [30, 130], angle: [0, 360], gravity: 0, life: 900, size: [10, 0] },
  ward: { texture: 'shard', count: 18, speed: [20, 70], angle: [0, 360], gravity: 0, life: 900, size: [6, 0] },
  glimmer: { texture: 'star', count: 14, speed: [10, 50], angle: [0, 360], gravity: 0, life: 800, size: [8, 0] },
};

const scaleOf = (texture: MoteTexture, size: [number, number]): { start: number; end: number } => ({
  start: size[0] / TEXTURE_SIZE[texture],
  end: size[1] / TEXTURE_SIZE[texture],
});

/** A spot anywhere along these lines, longer lines more often. */
export function alongLines(segs: readonly Seg[]): Phaser.Types.GameObjects.Particles.RandomZoneSource {
  const total = segs.reduce((sum, seg) => sum + seg.len, 0);
  return {
    getRandomPoint: (point) => {
      let pick = Math.random() * total;
      const seg = segs.find((entry) => (pick -= entry.len) <= 0) ?? segs[segs.length - 1];
      const u = Math.random();
      point.x = seg.a.x + (seg.b.x - seg.a.x) * u;
      point.y = seg.a.y + (seg.b.y - seg.a.y) * u;
    },
  };
}

/** An emitter that keeps shedding a rune's motes from its lines. */
export function moteEmitterConfig(
  spec: MoteSpec,
  source: Phaser.Types.GameObjects.Particles.RandomZoneSource,
  centre: Vec2,
  reduced: boolean,
): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig {
  return {
    lifespan: { min: spec.life * 0.6, max: spec.life },
    speed: { min: spec.speed[0], max: spec.speed[1] },
    angle: { min: spec.angle[0], max: spec.angle[1] },
    gravityY: spec.gravity,
    scale: scaleOf(spec.texture, spec.size),
    alpha: { start: spec.alpha, end: 0, ease: 'Quad.In' },
    rotate: spec.spin ? { min: 0, max: 360 } : 0,
    tint: spec.tints,
    blendMode: Phaser.BlendModes.ADD,
    frequency: spec.every * (reduced ? 3 : 1),
    quantity: 1,
    emitZone: { type: 'random', source: source },
    ...(spec.toCentre ? { moveToX: centre.x, moveToY: centre.y } : {}),
  };
}

/** A one-off emitter for a burst of motes. */
export function burstEmitterConfig(spec: MoteBurst, tints: number[]): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig {
  return {
    lifespan: { min: spec.life * 0.55, max: spec.life },
    speed: { min: spec.speed[0], max: spec.speed[1] },
    angle: { min: spec.angle[0], max: spec.angle[1] },
    gravityY: spec.gravity,
    scale: { ...scaleOf(spec.texture, spec.size), ease: 'Quad.Out' },
    alpha: { start: 1, end: 0, ease: 'Quad.In' },
    rotate: spec.spin ? { min: 0, max: 360 } : 0,
    tint: [...tints, ...(spec.extra ?? [])],
    blendMode: Phaser.BlendModes.ADD,
    emitting: false,
    ...(spec.inward
      ? { emitZone: { type: 'edge', source: new Phaser.Geom.Circle(0, 0, spec.inward), quantity: spec.count }, moveToX: 0, moveToY: 0 }
      : {}),
  };
}
