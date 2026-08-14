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

export const FX_TWEEN = {
  conjureGather: { duration: 200, ease: 'Quad.Out' },
  conjureShard: { duration: 220, ease: 'Quad.In' },
  healGlow: { duration: 620, ease: 'Sine.Out' },
  healSparkle: { duration: 520, ease: 'Sine.Out', stagger: 40 },
  burst: { duration: 360, ease: 'Cubic.Out' },
  lightningLifetime: 250,
  quarterTurn: { duration: 240, hold: 80, ease: 'Cubic.InOut' },
  twistMarker: { duration: 420, ease: 'Cubic.Out' },
  twistRune: { duration: 460, ease: 'Cubic.Out' },
} as const;
