import type { WordId } from '../core/Words';
import type { EffectContext } from '../effects/effects';

export type ActionType = 'main' | 'bonus';
export type Targeting = 'none' | 'self' | 'enemy' | 'ally' | 'point' | 'any';

/**
 * Declarative spell animation. Pick a preset and tweak its look. The scene plays
 * it automatically when the spell resolves (caster → target / point).
 *
 *  - 'projectile' : a travelling orb that bursts on arrival.
 *  - 'beam'       : an instant line from caster to target.
 *  - 'burst'      : an expanding ring at the target / point.
 *  - 'nova'       : an expanding ring centred on the caster (good for self buffs).
 *  - 'conjure'    : an attack that simply erupts on the target (no projectile travel).
 *  - 'heal'       : a positive glow with rising sparkles on the target (buffs/heals).
 */
export type VfxPreset = 'projectile' | 'beam' | 'burst' | 'nova' | 'conjure' | 'heal';

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
   * Suppress the automatic natural-20 critical for this spell. Class-spell rule:
   * only Objects-class variants may crit; Life and Hexcraft variants set this so
   * a natural 20 grants success but never doubles their potency.
   */
  noCrit?: boolean;

  /**
   * Suppress the automatic ground cast-sprite (the poison/shatter sheet painted
   * where a point spell lands). Set on spells whose cast leaves a persistent
   * object (e.g. a totem) rather than an instant elemental splash.
   */
  noCastSprite?: boolean;

  /**
   * A point spell that is aimed with TWO clicks (both chosen before the DC roll):
   * the two points define a cone's edges. Used by Reality Shatter.
   */
  twoPointAim?: boolean;

  /**
   * Which toggleable catalogue this spell belongs to. The start screen lets
   * players enable/disable whole sets before a duel; only spells whose set is
   * active are offered in the combo grid. Untagged spells default to 'original'.
   *   - original: the base Dimir catalogue.
   *   - finns:    Finn's Additions (extra sidegrade spells, coupled to the item toggle).
   *   - dlc:      reserved for future DLC spells.
   */
  set?: import('../core/Items').ItemSet;

  /**
   * If set, this point-targeted spell/ability places a rotatable rectangular
   * wall the caster positions within `range` and rotates with H while aiming.
   * The chosen orientation is read from the caster's `wallAngle`.
   */
  rotatableWall?: { length: number; thickness: number };

  /**
   * The actual effect. Use the effect helpers in effects/effects.ts here. May be
   * async: a spell can `await ctx.requestPoint?.(...)` / `ctx.requestEnemy?.(...)`
   * to gather extra targets mid-resolution without granting a fresh reaction.
   */
  cast(ctx: EffectContext): void | Promise<void>;
}
