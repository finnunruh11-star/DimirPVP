// The eight words of power. Add new words here to extend the game — every other
// system (loadout UI, spell registry, AI) reads from this single source of truth.

export type WordId =
  | 'bind'
  | 'shadow'
  | 'veil'
  | 'mind'
  | 'shatter'
  | 'corrode'
  | 'curse'
  | 'pierce'
  | 'twist'
  | 'reality'
  | 'drain'
  | 'heal'
  | 'sand'
  | 'death'
  | 'fire'
  | 'lightning'
  | 'subtle'
  | 'delay'
  | 'channel'
  | 'stop';

export interface WordDef {
  id: WordId;
  label: string;
  /** Words that grant a reaction (usable outside your own turn). */
  grantsReaction: boolean;
  /** Charges available when this word is in your loadout. */
  charges: number;
  color: number;
  blurb: string;
}

export const WORDS: Record<WordId, WordDef> = {
  bind: {
    id: 'bind',
    label: 'Bind',
    grantsReaction: true,
    charges: 4,
    color: 0x6ad1ff,
    blurb: 'Roots, stuns and movement control.',
  },
  shadow: {
    id: 'shadow',
    label: 'Shadow',
    grantsReaction: false,
    charges: 4,
    color: 0x8a6bff,
    blurb: 'Shadow pools, shadow damage and casting reach through them.',
  },
  veil: {
    id: 'veil',
    label: 'Veil',
    grantsReaction: true,
    charges: 4,
    color: 0xb98bff,
    blurb: 'Invisibility and untargetability.',
  },
  mind: {
    id: 'mind',
    label: 'Mind',
    grantsReaction: true,
    charges: 4,
    color: 0xff8be0,
    blurb: 'Sanity damage and mental control.',
  },
  shatter: {
    id: 'shatter',
    label: 'Shatter',
    grantsReaction: false,
    charges: 4,
    color: 0xffd166,
    blurb: 'Shatter damage in cones and areas.',
  },
  corrode: {
    id: 'corrode',
    label: 'Corrode',
    grantsReaction: false,
    charges: 4,
    color: 0x9be870,
    blurb: 'Corrosive damage.',
  },
  curse: {
    id: 'curse',
    label: 'Curse',
    grantsReaction: false,
    charges: 4,
    color: 0xff9f6b,
    blurb: 'Damage over time and debuffs.',
  },
  pierce: {
    id: 'pierce',
    label: 'Pierce',
    grantsReaction: false,
    charges: 4,
    color: 0xfffbe0,
    blurb: 'Pierce damage, dashes and single-target precision.',
  },
  // --- Secret words (NAD easter-egg loadout only; hidden from the menu grid) ---
  twist: {
    id: 'twist',
    label: 'Twist',
    grantsReaction: true,
    charges: 4,
    color: 0x66ffd1,
    blurb: 'Rotates units and the battlefield.',
  },
  reality: {
    id: 'reality',
    label: 'Reality',
    grantsReaction: false,
    charges: 4,
    color: 0xff5599,
    blurb: 'Alters turn order, targeting rules and the battlefield itself.',
  },
  drain: {
    id: 'drain',
    label: 'Drain',
    grantsReaction: false,
    charges: 4,
    color: 0x57d6a0,
    blurb: 'Corrosive damage that heals you for the amount dealt.',
  },
  death: {
    id: 'death',
    label: 'Death',
    grantsReaction: false,
    charges: 4,
    color: 0xb9c0cc,
    blurb: 'Reap stacks and execution thresholds.',
  },
  fire: {
    id: 'fire',
    label: 'Fire',
    grantsReaction: false,
    charges: 4,
    color: 0xff5a36,
    blurb: 'Stacking Fire status that spreads and detonates.',
  },
  lightning: {
    id: 'lightning',
    label: 'Lightning',
    grantsReaction: false,
    charges: 4,
    color: 0xffe45c,
    blurb: 'Chains and dashes scaled by the cast roll, with self-risk.',
  },
  stop: {
    id: 'stop',
    label: 'Stop',
    grantsReaction: true,
    charges: 4,
    color: 0x9ee7ff,
    blurb: 'Companion reaction that cancels any action.',
  },
  // --- Modifiers (granted to every mage; free of the loadout limit) ---
  subtle: {
    id: 'subtle',
    label: 'Subtle',
    grantsReaction: false,
    charges: 4,
    color: 0x8fa3b8,
    blurb: 'Modifier: the spell cannot be reacted to, at 80% power.',
  },
  delay: {
    id: 'delay',
    label: 'Delay',
    grantsReaction: true,
    charges: 4,
    color: 0x7fd8c0,
    blurb: 'Modifier: hold the spell until your next turn. Also a reaction spell that delays a stacked action.',
  },
  channel: {
    id: 'channel',
    label: 'Channel',
    grantsReaction: false,
    charges: 4,
    color: 0xffc98a,
    blurb: 'Modifier: lose the rest of your turn, release the spell next turn at 150% power.',
  },
  // --- Secret words (GEN easter-egg loadout only; hidden from the menu grid) ---
  heal: {
    id: 'heal',
    label: 'Heal',
    grantsReaction: false,
    charges: 4,
    color: 0xf3ecd2,
    blurb: 'White word. Restores health.',
  },
  sand: {
    id: 'sand',
    label: 'Sand',
    grantsReaction: false,
    charges: 4,
    color: 0xe8c98a,
    blurb: 'White word. Corrosive grit, and it leaves sand behind. Far stronger where sand already lies.',
  },
};

/** Stable display order for menus. */
export const WORD_ORDER: WordId[] = [
  'bind',
  'shadow',
  'veil',
  'mind',
  'shatter',
  'corrode',
  'curse',
  'pierce',
];

export const REACTION_WORDS: WordId[] = WORD_ORDER.filter((w) => WORDS[w].grantsReaction);

/** A canonical, order-independent key for a combination of words. */
export function comboKey(words: WordId[]): string {
  return [...words].sort().join('+');
}

/** Player-facing spell name: always the words themselves, in authored order. */
export function spellDisplayName(words: WordId[]): string {
  return words.map((word) => WORDS[word].label).join(' ');
}

// =============================================================================
//  WORD GRAMMAR  (nouns / verbs)
// -----------------------------------------------------------------------------
//  Words carry a grammatical kind used by the class system. A "class spell" is a
//  word-combo made of ONLY nouns or ONLY verbs; such spells
//  align their effect toward the caster's class. See {@link isClassSpell} and
//  the {@link MageClass} system (core/Classes.ts).
// =============================================================================

export type WordKind = 'noun' | 'verb' | 'modifier' | 'other';

export const WORD_KIND: Record<WordId, WordKind> = {
  // Verbs — an action.
  curse: 'verb',
  corrode: 'verb',
  drain: 'verb',
  pierce: 'verb',
  veil: 'verb',
  bind: 'verb',
  shatter: 'verb',
  twist: 'verb',
  heal: 'verb',
  sand: 'verb',
  // Nouns — a thing.
  lightning: 'noun',
  mind: 'noun',
  fire: 'noun',
  death: 'noun',
  shadow: 'noun',
  reality: 'noun',
  // Modifiers attach to another spell rather than forming one.
  subtle: 'modifier',
  delay: 'modifier',
  channel: 'modifier',
  // Stop is not part of either class-spell category.
  stop: 'other',
};

/** Modifier words every mage knows; they never count against the loadout limit. */
export const MODIFIER_WORDS: WordId[] = ['subtle', 'delay', 'channel'];

/**
 * Every word the menu grid offers: the standard eight first, then the words the
 * easter eggs used to gate. The presets still exist, but as a quick way to fill
 * a rack rather than the only route to these words — a touch player has no
 * keyboard to type them with.
 */
export const ALL_GRID_WORDS: WordId[] = [
  ...WORD_ORDER,
  ...(Object.keys(WORDS) as WordId[]).filter(
    (word) => !WORD_ORDER.includes(word) && WORD_KIND[word] !== 'modifier',
  ),
];

export function isModifierWord(word: WordId): boolean {
  return WORD_KIND[word] === 'modifier';
}

/** Split a selection into the spell's own words and the modifiers attached to it. */
export function splitModifiers(words: readonly WordId[]): {
  base: WordId[];
  modifiers: WordId[];
} {
  return {
    base: words.filter((word) => !isModifierWord(word)),
    modifiers: words.filter((word) => isModifierWord(word)),
  };
}

/**
 * Whether a word-combo is a "class spell": every word shares one grammatical
 * kind — all nouns or all verbs. Such spells resolve
 * their effect toward the caster's class. Mixed noun/verb combos (e.g. Shadow
 * Bind) are ordinary spells.
 */
export function isClassSpell(words: WordId[]): boolean {
  if (words.length === 0) return false;
  const allNouns = words.every((w) => WORD_KIND[w] === 'noun');
  const allVerbs = words.every((w) => WORD_KIND[w] === 'verb');
  return allNouns || allVerbs;
}
