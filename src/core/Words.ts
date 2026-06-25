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
  | 'drain';

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
    charges: 3,
    color: 0x6ad1ff,
    blurb: 'Control and BDSM.',
  },
  shadow: {
    id: 'shadow',
    label: 'Shadow',
    grantsReaction: false,
    charges: 3,
    color: 0x8a6bff,
    blurb: 'Hello darkness my old friend.',
  },
  veil: {
    id: 'veil',
    label: 'Veil',
    grantsReaction: true,
    charges: 3,
    color: 0xb98bff,
    blurb: 'Invisibility.',
  },
  mind: {
    id: 'mind',
    label: 'Mind',
    grantsReaction: true,
    charges: 3,
    color: 0xff8be0,
    blurb: 'Targets the Mind',
  },
  shatter: {
    id: 'shatter',
    label: 'Shatter',
    grantsReaction: false,
    charges: 3,
    color: 0xffd166,
    blurb: 'Blunt damage cone.',
  },
  corrode: {
    id: 'corrode',
    label: 'Corrode',
    grantsReaction: false,
    charges: 3,
    color: 0x9be870,
    blurb: 'Corrosive attack.',
  },
  curse: {
    id: 'curse',
    label: 'Curse',
    grantsReaction: false,
    charges: 3,
    color: 0xff9f6b,
    blurb: 'DoTs and debuffs.',
  },
  pierce: {
    id: 'pierce',
    label: 'Pierce',
    grantsReaction: false,
    charges: 3,
    color: 0xfffbe0,
    blurb: 'Dashes and precision',
  },
  // --- Secret words (NAD easter-egg loadout only; hidden from the menu grid) ---
  twist: {
    id: 'twist',
    label: 'Twist',
    grantsReaction: true,
    charges: 3,
    color: 0x66ffd1,
    blurb: 'YOU SPIN ME RIGHT ROUND.',
  },
  reality: {
    id: 'reality',
    label: 'Reality',
    grantsReaction: false,
    charges: 3,
    color: 0xff5599,
    blurb: 'Bends the rules of the duel.',
  },
  drain: {
    id: 'drain',
    label: 'Drain',
    grantsReaction: false,
    charges: 3,
    color: 0x57d6a0,
    blurb: 'Corrosive lifesteal.',
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
