import type { Mage } from '../core/Mage';
import type { WordId } from '../core/Words';
import { isClassSpellCombo } from './registry';
import type { Spell } from './Spell';

/**
 * The number `source` must reach on the d20 to cast `spell` (before luck). With a
 * modifier attached the combo is never a class spell, so it pays the full DC.
 */
export function spellCastDc(spell: Spell, source: Mage, modifiers: readonly WordId[] = []): number {
  // A word alone never paid the combination surcharge.
  const classCast = spell.words.length === 1 || (isClassSpellCombo(spell.words) && modifiers.length === 0);
  const baseDc = (classCast ? spell.dc : spell.nonClassDc ?? spell.dc) ?? 0;
  const surcharge = classCast ? 0 : 3 + (baseDc <= 14 ? 2 : 0);
  return baseDc + surcharge - (source.profile.bluePrimaryTier ? 2 : 0) - source.dcReduction();
}

/** Chance (0-1) that one cast reaches `dc`: every face, with Focus, luck and the Gambler's Curse. */
export function castChance(dc: number, opts: { luck: number; focused: boolean; face?: (n: number) => number }): number {
  let hits = 0;
  for (let n = 1; n <= 20; n++) {
    if ((opts.face ? opts.face(n) : n) + Math.max(0, opts.luck) >= dc) hits++;
  }
  const once = hits / 20;
  return opts.focused ? 1 - (1 - once) ** 2 : once;
}

/** The odds `source` casts `spell` right now; null for spells that roll nothing. */
export function spellCastOdds(
  spell: Spell,
  source: Mage,
  modifiers: readonly WordId[] = []
): { dc: number; chance: number } | null {
  if (!spell.dc) return null;
  const dc = spellCastDc(spell, source, modifiers);
  return {
    dc,
    chance: castChance(dc, {
      luck: source.luck,
      focused: source.focusNextSpell,
      face: (n) => source.gambledD20(n),
    }),
  };
}

/** "DC 12 · 55%" for a readout; "no roll" when nothing is rolled. */
export function castOddsLabel(spell: Spell, source: Mage, modifiers: readonly WordId[] = []): string {
  const odds = spellCastOdds(spell, source, modifiers);
  if (!odds) return 'no roll';
  return `DC ${odds.dc} · ${Math.round(odds.chance * 100)}%`;
}
