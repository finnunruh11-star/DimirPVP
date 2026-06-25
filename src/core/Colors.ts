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

export type WordColor = 'black' | 'blue' | 'none';
export type ColorName = 'black' | 'blue';

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
};

/**
 * Per-spell base mana cost, keyed by the spell's combo key (sorted words joined
 * with '+', e.g. `comboKey(['shatter','mind'])` → "mind+shatter"). Lesser spells
 * cost ~3-5; two-word spells ~6-11; the strongest three-word spells up to 15.
 * Black-flavoured combos tend to cost more (but hit harder). Spells without an
 * entry fall back to a length-based default (see DEFAULT_SPELL_MANA).
 */
export const SPELL_MANA: Record<string, number> = {
  // Single-word
  pierce: 3,
  veil: 3,
  shatter: 4,
  mind: 4,
  bind: 4,
  twist: 4,
  shadow: 5,
  corrode: 5,
  curse: 5,
  drain: 5,
  // Two-word
  'mind+veil': 6,
  'bind+pierce': 6,
  'pierce+veil': 6,
  'bind+shatter': 6,
  'shatter+veil': 6,
  'bind+mind': 7,
  'mind+pierce': 7,
  'shadow+veil': 7,
  'pierce+shatter': 7,
  'mind+shatter': 8,
  'bind+shadow': 8,
  'pierce+shadow': 8,
  'curse+pierce': 8,
  'shadow+shatter': 8,
  'mind+shadow': 8,
  'corrode+mind': 9,
  'curse+mind': 9,
  'corrode+shatter': 9,
  'curse+shatter': 9,
  'curse+shadow': 10,
  'mind+reality': 10,
  'reality+shatter': 10,
  'corrode+curse': 11,
  'corrode+shadow': 11,
  'curse+drain': 11,
  'drain+shadow': 11,
  // Three-word
  'mind+pierce+veil': 9,
  'mind+reality+shatter': 14,
  'corrode+curse+drain': 15,
};

/** Fallback mana cost when a combo has no explicit SPELL_MANA entry. */
function defaultSpellMana(words: WordId[]): number {
  if (words.length <= 1) return 4;
  if (words.length === 2) return 8;
  return 12;
}

export interface ColorProfile {
  /** The color you have the most words of (ties broken by first colored word). */
  primary: ColorName | null;
  /** The other color, if you have at least one word of it. */
  secondary: ColorName | null;
  /** Blue primary-tier effects active (you have blue at all). */
  bluePrimaryTier: boolean;
  /** Blue secondary-tier effects active (blue is your secondary color). */
  blueSecondaryTier: boolean;
  /** Black primary-tier effects active (you have black at all). */
  blackPrimaryTier: boolean;
  /** Black secondary-tier effects active (black is your secondary color). */
  blackSecondaryTier: boolean;
}

/** Work out a mage's color identity from its loadout. */
export function computeColorProfile(loadout: WordId[]): ColorProfile {
  let black = 0;
  let blue = 0;
  for (const w of loadout) {
    const c = WORD_COLOR[w];
    if (c === 'black') black += 1;
    else if (c === 'blue') blue += 1;
  }

  let primary: ColorName | null = null;
  let secondary: ColorName | null = null;
  if (black === 0 && blue === 0) {
    primary = null;
  } else if (black > blue) {
    primary = 'black';
    secondary = blue > 0 ? 'blue' : null;
  } else if (blue > black) {
    primary = 'blue';
    secondary = black > 0 ? 'black' : null;
  } else {
    // Equal counts (both > 0): the first colored word in the loadout decides.
    const first = loadout.find((w) => WORD_COLOR[w] !== 'none');
    primary = (first ? WORD_COLOR[first] : 'blue') as ColorName;
    secondary = primary === 'black' ? 'blue' : 'black';
  }

  const has = (c: ColorName): boolean => primary === c || secondary === c;
  return {
    primary,
    secondary,
    bluePrimaryTier: has('blue'),
    blueSecondaryTier: secondary === 'blue',
    blackPrimaryTier: has('black'),
    blackSecondaryTier: secondary === 'black',
  };
}

/**
 * Mana cost of a word-combo spell for a given color profile.
 *  - Base cost is the spell's own SPELL_MANA entry (length-based default if none).
 *  - Blue secondary: a one-word spell costs no mana.
 *  - Black primary: +2 mana on each spell.
 */
export function wordSpellMana(words: WordId[], profile: ColorProfile): number {
  if (profile.blueSecondaryTier && words.length === 1) return 0;
  let total = SPELL_MANA[comboKey(words)] ?? defaultSpellMana(words);
  if (profile.blackPrimaryTier) total += 2;
  return total;
}
