import type { WordId } from '../core/Words';
import type { EffectContext } from '../effects/effects';

export type ActionType = 'main' | 'bonus';
export type Targeting = 'none' | 'self' | 'enemy' | 'ally' | 'point';

/**
 * Declarative spell animation. Pick a preset and tweak its look. The scene plays
 * it automatically when the spell resolves (caster → target / point).
 *
 *  - 'projectile' : a travelling orb that bursts on arrival.
 *  - 'beam'       : an instant line from caster to target.
 *  - 'burst'      : an expanding ring at the target / point.
 *  - 'nova'       : an expanding ring centred on the caster (good for self buffs).
 */
export type VfxPreset = 'projectile' | 'beam' | 'burst' | 'nova';

export interface SpellVisual {
  preset: VfxPreset;
  /** Hex colour, e.g. 0xff8be0. */
  color: number;
  /** Projectile radius / beam thickness / ring reach (px). Default ~10. */
  size?: number;
  /** Animation speed multiplier. 1 = normal, 2 = twice as fast. Default 1. */
  speed?: number;
}

export interface Spell {
  /** Stable id; by convention the sorted combo key, e.g. "pierce+shatter". */
  id: string;
  name: string;
  /** The 1-3 words that compose this spell. */
  words: WordId[];
  actionType: ActionType;
  /** Cast range in pixels. 0 = self only. */
  range: number;
  /**
   * Optional minimum cast range in pixels. The target / aimed point must be at
   * least this far away. Set equal to `range` for an exact-distance spell.
   */
  minRange?: number;
  /**
   * Extra reach (px) granted only when the enemy target stands inside one of
   * the caster's own shadow zones. Used by Shadow Corrode to strike from afar.
   */
  bonusRangeInOwnShadow?: number;
  targeting: Targeting;
  description: string;

  /**
   * Difficulty class. On resolution the caster rolls 1d20; if the result is
   * below `dc` the spell fizzles. More complex spells use a higher DC. Omit for
   * effects that never fail (movement, melee).
   */
  dc?: number;

  /**
   * Optional area-of-effect footprint, used both for targeting previews and by
   * the cone/area effect helpers. `range` is reused as the cone length.
   */
  aoe?: {
    kind: 'cone' | 'circle';
    /** Circle radius, or (for cones) the sweep length, in pixels. */
    radius: number;
    /** Total arc of a cone in degrees. */
    degrees?: number;
  };

  /** Whether this spell may be cast as a reaction (outside your turn). */
  reaction?: boolean;
  /**
   * If true, when cast as a reaction it counters (removes) the stack item it
   * is responding to, should that item still be on the stack at resolution.
   */
  counters?: boolean;

  /** Optional visual played when the spell resolves. */
  visual?: SpellVisual;

  /**
   * The actual effect. Use the effect helpers in effects/effects.ts here. May be
   * async: a spell can `await ctx.requestPoint?.(...)` / `ctx.requestEnemy?.(...)`
   * to gather extra targets mid-resolution without granting a fresh reaction.
   */
  cast(ctx: EffectContext): void | Promise<void>;
}
