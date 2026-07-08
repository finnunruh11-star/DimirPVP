import type { WordId } from '../core/Words';
import { comboKey, WORDS } from '../core/Words';
import type { Spell } from './Spell';
import type { ItemSet } from '../core/Items';

// =============================================================================
//  SPELL REGISTRY
// -----------------------------------------------------------------------------
//  Spells are keyed by their (order-independent) word combination. Selecting a
//  set of words in-game looks up the matching spell here. To add a spell, call
//  registerSpell({...}) (see sampleSpells.ts for examples).
// =============================================================================

const registry = new Map<string, Spell>();

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
  const full: Spell = { ...spell, id } as Spell;
  registry.set(comboKey(spell.words), full);
  return full;
}

/** Look up the spell for a given set of selected words, if any exists. */
export function getSpell(words: WordId[]): Spell | undefined {
  const s = registry.get(comboKey(words));
  return s && spellActive(s) ? s : undefined;
}

export function hasSpell(words: WordId[]): boolean {
  return getSpell(words) !== undefined;
}

export function allSpells(): Spell[] {
  return [...registry.values()].filter(spellActive);
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
