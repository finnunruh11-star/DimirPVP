import type { StackItem } from '../core/Stack';

type ActionVisual = NonNullable<StackItem['actionVisual']>;

export type ActionFxPreset =
  | { kind: 'burst'; color: number; reach: number; speed: number }
  | { kind: 'lightning' }
  | { kind: 'lightningImpact' };

export const ACTION_FX_PRESETS: Record<ActionVisual, ActionFxPreset> = {
  fire: { kind: 'burst', color: 0xff7138, reach: 48, speed: 1.8 },
  shatter: { kind: 'burst', color: 0xc5b89b, reach: 46, speed: 1.6 },
  shadow: { kind: 'burst', color: 0x5f4a86, reach: 50, speed: 1.8 },
  lightning: { kind: 'lightning' },
  lightningImpact: { kind: 'lightningImpact' },
  heal: { kind: 'burst', color: 0x7ce5a5, reach: 42, speed: 1.5 },
  corrosive: { kind: 'burst', color: 0x86b94c, reach: 54, speed: 1.8 },
  wake: { kind: 'burst', color: 0xe3b85d, reach: 64, speed: 2 },
};

export const FX_MOTION = {
  move: { duration: 1000, ease: 'Sine.InOut' },
  dash: { duration: 333, ease: 'Sine.Out' },
  pull: { duration: 550, ease: 'Sine.In' },
} as const;

/**
 * A basic weapon strike, shaped as one motion: coil away from the target, drive
 * through it, then settle. The poses are the held weapon's rotation (radians,
 * mirrored by facing), vertical lift and reach out from the grip.
 */
export const MELEE_SWING = {
  coilPx: 7,
  /** How far the body may actually travel into the blow. */
  lungePx: 26,
  coil: { ms: 135, ease: 'Sine.Out', pose: { rot: -0.85, lift: -3, reach: -6 } },
  strike: { ms: 85, ease: 'Quad.In', pose: { rot: 1.78, lift: 7, reach: 10 } },
  recover: { ms: 250, ease: 'Sine.Out', pose: { rot: 0.38, lift: 0, reach: 0 } },
  /** Beat held after contact before the damage is allowed to land. */
  contactMs: 70,
  /** Blade ghosts dropped through the strike arc. */
  trail: { count: 3, alpha: 0.42, fadeMs: 170 },
} as const;

/** A bow shot: draw the stave, loose, and let the shaft carry the distance. */
export const BOW_SHOT = {
  draw: { ms: 190, ease: 'Sine.Out', pose: { rot: -0.34, lift: -2, reach: -7 } },
  loose: { ms: 70, ease: 'Quad.Out', pose: { rot: 0.16, lift: 1, reach: 3 } },
  recover: { ms: 260, ease: 'Sine.Out', pose: { rot: 0.38, lift: 0, reach: 0 } },
  arrow: { pixelsPerSecond: 940, minMs: 120, maxMs: 460, arcPx: 16 },
} as const;

export const FX_TWEEN = {
  projectile: {
    pixelsPerSecond: 760,
    minDuration: 170,
    maxDuration: 620,
    ease: 'Sine.InOut',
  },
  beam: { duration: 360, ease: 'Sine.Out' },
  conjureGather: { duration: 200, ease: 'Quad.Out' },
  conjureShard: { duration: 220, ease: 'Quad.In' },
  healGlow: { duration: 620, ease: 'Sine.Out' },
  healSparkle: { duration: 520, ease: 'Sine.Out', stagger: 40 },
  burst: { duration: 360, ease: 'Cubic.Out' },
  quarterTurn: { duration: 240, hold: 80, ease: 'Cubic.InOut' },
  twistMarker: { duration: 420, ease: 'Cubic.Out' },
  twistRune: { duration: 460, ease: 'Cubic.Out' },
} as const;

export type ImpactWeight = 'heavy' | 'seismic';

/**
 * Camera shake is rationed so it keeps meaning something. Lightning keeps its
 * own, louder shake inside LightningFxDirector; every other spell has to be
 * listed here by word combination to earn one. Shatter Mind is deliberately
 * absent — only the reality-breaking and cage/area Shatter combos qualify.
 */
export const SPELL_IMPACT_WEIGHT: Record<string, ImpactWeight> = {
  'reality+shatter': 'seismic',
  'reality+shatter+twist': 'seismic',
  'mind+reality+shatter': 'heavy',
  'bind+shadow+shatter': 'heavy',
  'mind+shadow+shatter': 'heavy',
};

export const IMPACT_FX = {
  /** Fraction of a target's max pool a single hit must take to read as heavy. */
  heavySeverity: 0.2,
  /** White-out on the struck sprite, in ms. */
  flash: { duration: 64, critDuration: 104, color: 0xfff4e2 },
  /**
   * Brief global slowdown on the biggest hits. `time.timeScale` is left alone
   * so the restore timer cannot slow itself down.
   */
  hitstop: { scale: 0.16, duration: 70, critDuration: 115, killDuration: 210 },
  shake: {
    heavy: { duration: 150, intensity: 0.0022 },
    seismic: { duration: 250, intensity: 0.0044 },
  },
  /** Lens push on the heaviest blows. Kept small: it rides on top of the shake. */
  punch: { zoom: 1.01, duration: 90 },
} as const;
