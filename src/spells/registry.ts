import type { WordId } from '../core/Words';
import { comboKey, isClassSpell, spellDisplayName, WORDS } from '../core/Words';
import type { Spell } from './Spell';
import type { ItemSet } from '../core/Items';
import type { MageClass } from '../core/Classes';
import { DEFAULT_MAGE_CLASS, MAGE_CLASSES } from '../core/Classes';

// =============================================================================
//  SPELL REGISTRY
// -----------------------------------------------------------------------------
//  Spells are keyed by their (order-independent) word combination. Selecting a
//  set of words in-game looks up the matching spell here. To add a spell, call
//  registerSpell({...}) (see sampleSpells.ts for examples).
// =============================================================================

const registry = new Map<string, Spell>();

/**
 * Class spells (see {@link isClassSpell}) resolve to a DIFFERENT spell per mage
 * class: not only the effect body but the whole definition (targeting, range,
 * action type, description, visual) may differ between Objects / Life / Hexcraft
 * for the very same word combination. Each class-spell combo therefore stores a
 * full {@link Spell} per class here, keyed by the (order-independent) combo key.
 * The active variant is chosen at lookup time from the caster's class.
 */
const classRegistry = new Map<string, Partial<Record<MageClass, Spell>>>();

/**
 * Which spell sets are active this match. Mirrors {@link setActiveItemSets} and
 * is always set to the same value (both are driven by config.itemSets at match
 * start) so that the item and spell Finn's-toggle stay in sync.
 */
let ACTIVE_SPELL_SETS: Set<ItemSet> = new Set<ItemSet>(['original']);

/** Choose which spell sets are castable. Empty selection falls back to 'original'. */
export function setActiveSpellSets(sets: Partial<Record<ItemSet, boolean>>): void {
  const next = new Set<ItemSet>();
  if (sets.original) next.add('original');
  if (sets.finns) next.add('finns');
  if (sets.dlc) next.add('dlc');
  if (next.size === 0) next.add('original');
  ACTIVE_SPELL_SETS = next;
}

function spellActive(s: Spell): boolean {
  return ACTIVE_SPELL_SETS.has(s.set ?? 'original');
}

export function registerSpell(spell: Omit<Spell, 'id'> & { id?: string }): Spell {
  const id = spell.id ?? comboKey(spell.words);
  const full: Spell = {
    ...spell,
    codename: spell.name,
    name: spellDisplayName(spell.words),
    dc: isClassSpell(spell.words) ? classSpellDc(spell.words, spell.dc) : spell.dc,
    id,
  } as Spell;
  registry.set(comboKey(spell.words), full);
  return full;
}

/** Per-class body for one class-spell combo: everything a {@link Spell} has bar
 *  the shared `words`/`id` (those are derived from the combo + class). */
export type ClassSpellVariant = Omit<Spell, 'id' | 'words'>;

/** Class spells are deliberately easier to resolve than ordinary combinations. */
function classSpellDc(words: WordId[], dc: number | undefined): number | undefined {
  if (dc == null) return undefined;
  if (words.length === 2) return 5;
  if (words.length === 3) return Math.max(9, Math.min(13, dc - 2));
  return dc;
}

function buildClassSpell(words: WordId[], cls: MageClass, variant: ClassSpellVariant): Spell {
  const key = comboKey(words);
  return {
    ...variant,
    codename: variant.name,
    name: spellDisplayName(words),
    dc: classSpellDc(words, variant.dc),
    words,
    id: `${key}@${cls}`,
  } as Spell;
}

/**
 * Register a class spell: one word combination whose resolved definition depends
 * on the caster's {@link MageClass}. Provide a full variant per class. Each
 * variant becomes its own {@link Spell} with id `"<combo>@<class>"` so serialized
 * actions (e.g. Mind Bind replays) round-trip to the exact class variant.
 */
export function registerClassSpell(def: {
  words: WordId[];
  variants: Record<MageClass, ClassSpellVariant>;
}): Record<MageClass, Spell> {
  const key = comboKey(def.words);
  const built = {} as Record<MageClass, Spell>;
  for (const cls of MAGE_CLASSES) {
    const v = def.variants[cls];
    built[cls] = buildClassSpell(def.words, cls, v);
  }
  classRegistry.set(key, built);
  return built;
}

/**
 * Override one combination for selected classes. Classes without an override
 * keep the ordinary registered spell, or remain uncastable when none exists.
 * This supports deliberate mixed-grammar exceptions without weakening the
 * noun/verb class-spell rule for every other combination.
 */
export function registerClassSpellVariants(def: {
  words: WordId[];
  variants: Partial<Record<MageClass, ClassSpellVariant>>;
}): Partial<Record<MageClass, Spell>> {
  const key = comboKey(def.words);
  const built = classRegistry.get(key) ?? {};
  for (const cls of MAGE_CLASSES) {
    const variant = def.variants[cls];
    if (variant) built[cls] = buildClassSpell(def.words, cls, variant);
  }
  classRegistry.set(key, built);
  return built;
}

/** True if every word belongs to the same noun/verb class-spell category. */
export function isClassSpellCombo(words: WordId[]): boolean {
  return isClassSpell(words);
}

/**
 * Look up the spell for a given set of selected words, if any exists. For class
 * spells the caster's {@link MageClass} selects which variant resolves; passing
 * none falls back to the default class (used by class-agnostic callers).
 */
export function getSpell(
  words: WordId[],
  mageClass: MageClass = DEFAULT_MAGE_CLASS
): Spell | undefined {
  const key = comboKey(words);
  const variants = classRegistry.get(key);
  const variant = variants?.[mageClass];
  if (variant) return spellActive(variant) ? variant : undefined;
  const s = registry.get(key);
  return s && spellActive(s) ? s : undefined;
}

export function hasSpell(words: WordId[], mageClass: MageClass = DEFAULT_MAGE_CLASS): boolean {
  return getSpell(words, mageClass) !== undefined;
}

/** Resolve any spell (normal OR any class variant) by its stable id. */
export function spellById(id: string): Spell | undefined {
  const normal = [...registry.values()].find((s) => s.id === id);
  if (normal) return normal;
  for (const variants of classRegistry.values()) {
    for (const cls of MAGE_CLASSES) {
      if (variants[cls]?.id === id) return variants[cls];
    }
  }
  return undefined;
}

/**
 * Every active spell, with class spells resolved to the given class's variant
 * (one entry per class-spell combo). Callers that operate on a specific mage
 * should pass that mage's class so class spells surface correctly.
 */
export function allSpells(mageClass: MageClass = DEFAULT_MAGE_CLASS): Spell[] {
  const resolved = new Map<string, Spell>();
  for (const spell of registry.values()) {
    if (spellActive(spell)) resolved.set(comboKey(spell.words), spell);
  }
  for (const [key, variants] of classRegistry) {
    const variant = variants[mageClass];
    if (!variant) continue;
    if (spellActive(variant)) resolved.set(key, variant);
    else resolved.delete(key);
  }
  return [...resolved.values()];
}

/** All reaction-capable spells castable from a given loadout. */
export function reactionSpellsFor(
  loadout: WordId[],
  mageClass: MageClass = DEFAULT_MAGE_CLASS
): Spell[] {
  const set = new Set(loadout);
  const castable = allSpells(mageClass).filter((s) => s.words.every((w) => set.has(w)));
  // Having any reaction-granting word (Mind / Veil / Bind) lets you respond with
  // ANY spell you can cast. Without one, only spells explicitly flagged react.
  const grantsReaction = loadout.some((w) => WORDS[w].grantsReaction);
  return grantsReaction ? castable : castable.filter((s) => s.reaction);
}
