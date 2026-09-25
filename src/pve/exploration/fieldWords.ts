// Words spoken outside a fight. Veil hides you from roaming packs, Bind slows
// them, Mind makes one forget you, Shadow steps you through the dark and Heal
// mends the party. Offensive words open a fight as an ambush instead. Each use
// costs one charge of the word, restored by rest as in combat. Pure: no Phaser.

import { RANGE_UNIT } from '../../config/constants';
import type { WordId } from '../../core/Words';

export type FieldEffect = 'veil' | 'bind' | 'mind' | 'shadow' | 'heal' | 'ambush';

export interface FieldRule {
  effect: FieldEffect;
  /** Reach in tiles; 0 works on yourself. Ambush reach comes from the spell. */
  range: number;
  /** How long the effect lasts, in milliseconds (0 = at once). */
  ms: number;
}

export const FIELD_RULES: Partial<Record<WordId, FieldRule>> = {
  veil: { effect: 'veil', range: 0, ms: 30_000 },
  bind: { effect: 'bind', range: 6, ms: 15_000 },
  mind: { effect: 'mind', range: 8, ms: 20_000 },
  shadow: { effect: 'shadow', range: 5, ms: 0 },
  heal: { effect: 'heal', range: 0, ms: 0 },
};

/** Words whose plain spell can open a fight from hiding. */
export const AMBUSH_WORDS: ReadonlySet<WordId> = new Set<WordId>([
  'shatter', 'pierce', 'corrode', 'curse', 'fire', 'lightning', 'drain', 'death', 'desecrate', 'sand',
]);

/** A pack's sight while you are veiled, as a share of its usual sight. */
export const VEIL_SIGHT = 0.35;
/** A pack's sight while you sneak, and your pace while you do. */
export const SNEAK_SIGHT = 0.4;
export const SNEAK_SPEED = 0.5;
/** A bound pack's speed, as a share of its usual speed. */
export const BIND_SPEED = 0.35;
/** No ambush reaches further than this, in tiles. */
export const AMBUSH_MAX_TILES = 10;
/** A melee ambush needs you this close, in tiles. */
export const MELEE_AMBUSH_TILES = 2;

export interface FieldWord {
  word: WordId;
  effect: FieldEffect;
  /** Reach in tiles (0 = yourself). */
  range: number;
}

/**
 * The leader's words that do something outside a fight, in loadout order.
 * `ambushReach` gives the reach (px) of the word's plain spell for this mage,
 * or null when it has no such spell.
 */
export function fieldWordsFor(loadout: readonly WordId[], ambushReach: (word: WordId) => number | null): FieldWord[] {
  const words: FieldWord[] = [];
  for (const word of loadout) {
    const rule = FIELD_RULES[word];
    if (rule) {
      words.push({ word, effect: rule.effect, range: rule.range });
      continue;
    }
    if (!AMBUSH_WORDS.has(word)) continue;
    const reach = ambushReach(word);
    if (reach == null || reach <= 0) continue;
    words.push({ word, effect: 'ambush', range: reachTiles(reach) });
  }
  return words;
}

/** Combat reach in pixels, as tiles on a walkable map. */
export function reachTiles(px: number): number {
  return Math.max(1, Math.min(AMBUSH_MAX_TILES, px / RANGE_UNIT));
}

/** Hit points a field Heal restores: 1d6 plus Intellect. */
export function fieldHealAmount(d6: number, intellect: number): number {
  return Math.max(1, d6 + Math.max(0, intellect));
}
