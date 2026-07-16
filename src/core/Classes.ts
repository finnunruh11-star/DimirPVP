// =============================================================================
//  MAGE CLASSES
// -----------------------------------------------------------------------------
//  Every mage picks one of three classes at draft time. Your class is a second
//  axis of identity alongside your colour:
//    - Objects  — focuses on items, armour, weapons and inert objects. Its class
//                 spells conjure or enchant equipment / weapons.
//    - Life     — focuses on living beings: enemies, allies and summons. Its
//                 class spells call forth summons.
//    - Hexcraft — focuses on raw magic, field-spells and auras. Its class spells
//                 produce wonky effects or lay down a field-spell.
//
//  The class does two things (see the systems that read it):
//    1. It picks WHICH second colour-ability you get (your primary colour still
//       decides the pair — the class swaps out the second slot). See
//       {@link getColorAbilitiesFor} in spells/colorAbilities.ts.
//    2. It aligns "class spells" — word spells made of only nouns or only verbs
//       (see {@link isClassSpell} in core/Words.ts) resolve their effect toward
//       your class. See the {@link byClass} dispatcher in effects/effects.ts.
//
//  This module is intentionally light: it only defines the class taxonomy and
//  presentation. The behavioural hooks live next to the systems they touch.
// =============================================================================

export type MageClass = 'objects' | 'life' | 'hexcraft';

/** All classes in canonical display order. */
export const MAGE_CLASSES: MageClass[] = ['objects', 'life', 'hexcraft'];

/** The class a mage defaults to when none was chosen (e.g. legacy AI seats). */
export const DEFAULT_MAGE_CLASS: MageClass = 'objects';

export interface MageClassDef {
  id: MageClass;
  label: string;
  /** One-line focus, shown in the draft UI. */
  focus: string;
  /** How this class aligns its class-spell effects. */
  blurb: string;
  /** Accent colour for UI (hex). */
  color: number;
}

export const MAGE_CLASS_DEFS: Record<MageClass, MageClassDef> = {
  objects: {
    id: 'objects',
    label: 'Objects',
    focus: 'Items · armour · weapons',
    blurb: 'Class spells conjure or enchant equipment and weapons.',
    color: 0xd9b25a,
  },
  life: {
    id: 'life',
    label: 'Life',
    focus: 'Beings · allies · summons',
    blurb: 'Class spells call forth summons.',
    color: 0x7fd18a,
  },
  hexcraft: {
    id: 'hexcraft',
    label: 'Hexcraft',
    focus: 'Magic · field-spells · auras',
    blurb: 'Class spells make wonky effects or lay down a field-spell.',
    color: 0xb98bff,
  },
};

/** Look up a class definition, defaulting to the fallback class. */
export function mageClassDef(cls: MageClass | null | undefined): MageClassDef {
  return MAGE_CLASS_DEFS[cls ?? DEFAULT_MAGE_CLASS];
}

/** Narrow an untrusted string (e.g. a network payload) to a valid class. */
export function toMageClass(value: unknown): MageClass {
  return value === 'objects' || value === 'life' || value === 'hexcraft'
    ? value
    : DEFAULT_MAGE_CLASS;
}
