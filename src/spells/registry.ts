import type { WordId } from '../core/Words';
import { comboKey, WORDS } from '../core/Words';
import type { Spell } from './Spell';

// =============================================================================
//  SPELL REGISTRY
// -----------------------------------------------------------------------------
//  Spells are keyed by their (order-independent) word combination. Selecting a
//  set of words in-game looks up the matching spell here. To add a spell, call
//  registerSpell({...}) (see sampleSpells.ts for examples).
// =============================================================================

const registry = new Map<string, Spell>();

export function registerSpell(spell: Omit<Spell, 'id'> & { id?: string }): Spell {
  const id = spell.id ?? comboKey(spell.words);
  const full: Spell = { ...spell, id } as Spell;
  registry.set(comboKey(spell.words), full);
  return full;
}

/** Look up the spell for a given set of selected words, if any exists. */
export function getSpell(words: WordId[]): Spell | undefined {
  return registry.get(comboKey(words));
}

export function hasSpell(words: WordId[]): boolean {
  return registry.has(comboKey(words));
}

export function allSpells(): Spell[] {
  return [...registry.values()];
}

/** All reaction-capable spells castable from a given loadout. */
export function reactionSpellsFor(loadout: WordId[]): Spell[] {
  const set = new Set(loadout);
  const castable = allSpells().filter((s) => s.words.every((w) => set.has(w)));
  // Having any reaction-granting word (Mind / Veil / Bind) lets you respond with
  // ANY spell you can cast. Without one, only spells explicitly flagged react.
  const grantsReaction = loadout.some((w) => WORDS[w].grantsReaction);
  return grantsReaction ? castable : castable.filter((s) => s.reaction);
}
