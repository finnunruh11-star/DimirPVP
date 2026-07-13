// =============================================================================
//  COLOR IDENTITY
// -----------------------------------------------------------------------------
//  Every word belongs to a color (black / blue / none). A loadout's composition
//  decides a *primary* and (optionally) a *secondary* color, each of which
//  grants tiered passives:
//    - A color's PRIMARY tier is active whenever you have that color at all
//      (as your primary OR your secondary).
//    - A color's SECONDARY tier is active only when it is your SECONDARY color.
//  So: your primary color grants only its primary tier, while your secondary
//  color grants both its primary AND secondary tiers.
// =============================================================================

import type { WordId } from './Words';
import { comboKey } from './Words';

export type WordColor = 'black' | 'blue' | 'white' | 'none';
export type ColorName = 'black' | 'blue' | 'white';

/** Which color each word belongs to. */
export const WORD_COLOR: Record<WordId, WordColor> = {
  shadow: 'black',
  corrode: 'black',
  curse: 'black',
  drain: 'black',
  mind: 'blue',
  bind: 'blue',
  veil: 'blue',
  reality: 'blue',
  pierce: 'none',
  shatter: 'none',
  twist: 'none',
  order: 'white',
  slash: 'none',
};

/**
 * Optional per-spell base mana override, keyed by the spell's combo key (sorted
 * words joined with '+', e.g. `comboKey(['shatter','mind'])` → "mind+shatter").
 * By default spells cost purely by word count (see `defaultSpellMana`): one-word
 * spells are free, two-word spells cost ~2, and three-word spells cost ~9. Add
 * an entry here only to nudge a specific combo off that baseline.
 */
export const SPELL_MANA: Record<string, number> = {};

/**
 * How "potent" each word feels, used to price two-word spells (4-6 mana).
 * Strong words (curse, drain, order, ...) push a combo toward 6; weak words
 * (veil, mind, shatter, ...) keep it near 4. 2 = strong, 1 = medium, 0 = weak.
 */
const WORD_POTENCY: Record<WordId, number> = {
  // Strong: heavy hitters / reality-benders.
  curse: 2,
  drain: 2,
  order: 2,
  shadow: 2,
  reality: 2,
  // Medium: solid utility / damage.
  corrode: 1,
  bind: 1,
  twist: 1,
  pierce: 1,
  slash: 1,
  // Weak: cheap, low-impact words.
  veil: 0,
  mind: 0,
  shatter: 0,
};

/**
 * Base mana cost by word count: 1-word free, 3-word ~9. Two-word spells cost
 * 4-6 mana scaled by the combined potency of their two words (strong words like
 * curse/drain/order cost more than weak ones like veil/mind/shatter).
 */
function defaultSpellMana(words: WordId[]): number {
  if (words.length <= 1) return 0;
  if (words.length === 2) {
    const potency = (WORD_POTENCY[words[0]] ?? 1) + (WORD_POTENCY[words[1]] ?? 1);
    return 4 + Math.min(2, Math.round(potency / 2));
  }
  return 9;
}

export interface ColorProfile {
  /** The color you have the most words of (ties broken by first colored word). */
  primary: ColorName | null;
  /** The other color, if you have at least one word of it. */
  secondary: ColorName | null;
  /**
   * The BOON booleans below are true whenever you have that colour *at all*
   * (as primary OR secondary) — they gate the always-on passives ("boons").
   * Which colour SPELLS you get, and how you generate colour-charges, keys off
   * `primary` directly (see Mage.regen / getColorAbilitiesFor).
   */
  /** Blue boon active (you have blue at all): +2 int, +1 word charges, spell reactions. */
  bluePrimaryTier: boolean;
  /** Blue is your secondary colour: colour spells cost no mana and 1 less charge. */
  blueSecondaryTier: boolean;
  /** Black boon active (you have black at all): +1 weapon damage, +2 word mana. */
  blackPrimaryTier: boolean;
  /** Black is your secondary colour: colour spells +25%, cost HP, can cast early. */
  blackSecondaryTier: boolean;
  /** White boon active (you have white at all): -2 word mana, weapon reactions. */
  whitePrimaryTier: boolean;
  /** White is your secondary colour: colour spells heal caster + nearest ally. */
  whiteSecondaryTier: boolean;
}

/** Work out a mage's color identity from its loadout. */
export function computeColorProfile(loadout: WordId[]): ColorProfile {
  const counts: Record<ColorName, number> = { black: 0, blue: 0, white: 0 };
  for (const w of loadout) {
    const c = WORD_COLOR[w];
    if (c === 'black' || c === 'blue' || c === 'white') counts[c] += 1;
  }

  // First appearance of each color, used to break count ties deterministically.
  const firstSeen: Record<ColorName, number> = { black: 999, blue: 999, white: 999 };
  loadout.forEach((w, i) => {
    const c = WORD_COLOR[w];
    if ((c === 'black' || c === 'blue' || c === 'white') && firstSeen[c] === 999) {
      firstSeen[c] = i;
    }
  });

  // Rank colors present by count (desc), breaking ties by earliest appearance.
  const ranked = (['black', 'blue', 'white'] as ColorName[])
    .filter((c) => counts[c] > 0)
    .sort((a, b) => counts[b] - counts[a] || firstSeen[a] - firstSeen[b]);

  const primary: ColorName | null = ranked[0] ?? null;
  // A single-colour mage counts that colour as BOTH primary and secondary, so
  // it gains the secondary-tier effects too (you are "never colourless").
  const secondary: ColorName | null = ranked[1] ?? ranked[0] ?? null;

  const has = (c: ColorName): boolean => primary === c || secondary === c;
  return {
    primary,
    secondary,
    bluePrimaryTier: has('blue'),
    blueSecondaryTier: secondary === 'blue',
    blackPrimaryTier: has('black'),
    blackSecondaryTier: secondary === 'black',
    whitePrimaryTier: has('white'),
    whiteSecondaryTier: secondary === 'white',
  };
}

/**
 * Mana cost of a word-combo spell for a given color profile.
 *  - Base cost is by word count (1-word free, 2-word ~4-6, 3-word ~9), unless
 *    the combo has an explicit SPELL_MANA override.
 *  - Black boon: +2 mana on every word spell (black hits harder but costs more).
 *  - White boon: -2 mana on every word spell (min 0). A "gen"-style black+white
 *    loadout nets back to the baseline.
 * Blue's identity never touches word-spell mana (its discounts are on colour
 * spells / charges, handled elsewhere).
 */
export function wordSpellMana(words: WordId[], profile: ColorProfile): number {
  let total = SPELL_MANA[comboKey(words)] ?? defaultSpellMana(words);
  if (profile.blackPrimaryTier) total += 2;
  if (profile.whitePrimaryTier) total -= 2;
  return Math.max(0, total);
}
