// =============================================================================
//  CHARACTER STATS
// -----------------------------------------------------------------------------
//  After picking words, both duellists are shown the *same* shared assortment
//  of six dice rolls and each assigns one roll to each of six stats. The dice
//  are produced from the match's shared RNG so every peer sees identical values
//  in online play. All rolls are capped at 12 except the single d20.
// =============================================================================

import type { Dice } from './Dice';

export type StatKey = 'strength' | 'dex' | 'int' | 'mana' | 'hp' | 'luck';

/** Fixed slot order: an assignment is a permutation of die indices in this order. */
export const STAT_ORDER: StatKey[] = ['strength', 'dex', 'int', 'mana', 'hp', 'luck'];

export interface StatDef {
  key: StatKey;
  name: string;
  /** One-line, flavourless description of what the stat does. */
  blurb: string;
}

export const STAT_DEFS: StatDef[] = [
  { key: 'strength', name: 'Strength', blurb: 'Basic (melee) attacks deal +value damage.' },
  { key: 'dex', name: 'Dexterity', blurb: 'Move range increases by value%.' },
  { key: 'int', name: 'Intellect', blurb: 'Spell DCs drop by 1 per point.' },
  { key: 'mana', name: 'Mana', blurb: 'Max and starting mana increase by value.' },
  { key: 'hp', name: 'Vitality', blurb: 'Maximum health increases by value.' },
  { key: 'luck', name: 'Luck', blurb: 'A once-per-duel pool spent to nudge a spell roll up to its DC.' },
];

export interface DieResult {
  /** The dice spec that was rolled, e.g. "2d6" or "1d20". */
  spec: string;
  /** The (capped) rolled value assigned to a stat. */
  value: number;
}

/** Rolls in this pool are capped at {@link STAT_CAP}; the d20 is added separately. */
const CAPPED_POOL = ['2d3', '3d2', '1d6', '2d4', '1d8', '2d5', '1d10', '2d6', '3d3', '1d12'];
const STAT_CAP = 12;
const DIE_COUNT = 6;

/**
 * Build the shared six-die assortment: one uncapped d20 plus five dice drawn
 * from {@link CAPPED_POOL}, shuffled so the d20 lands in a random slot. Every
 * draw uses the supplied (seeded) RNG so all peers produce identical results.
 */
export function rollStatAssortment(rng: Dice): DieResult[] {
  const specs: string[] = ['1d20'];
  while (specs.length < DIE_COUNT) specs.push(rng.pick(CAPPED_POOL));
  // Fisher–Yates shuffle via the seeded RNG.
  for (let i = specs.length - 1; i > 0; i--) {
    const j = rng.die(i + 1) - 1;
    [specs[i], specs[j]] = [specs[j], specs[i]];
  }
  return specs.map((spec) => {
    const r = rng.roll(spec);
    const value = spec === '1d20' ? r.total : Math.min(STAT_CAP, r.total);
    return { spec, value };
  });
}

/**
 * Swamprun assortment: one d8 per stat (no d20). Same six-slot layout as the
 * duel assortment so the assignment overlay works unchanged, but every die is a
 * flat 1d8. Uses the seeded RNG so all peers roll identically.
 */
export function rollSwamprunStatDice(rng: Dice): DieResult[] {
  return STAT_ORDER.map(() => {
    const value = rng.roll('1d8').total;
    return { spec: '1d8', value };
  });
}

/** True when `order` is a valid permutation of die indices [0..DIE_COUNT-1]. */
export function isValidAssignment(order: unknown): order is number[] {
  if (!Array.isArray(order) || order.length !== DIE_COUNT) return false;
  const seen = new Set<number>();
  for (const v of order) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= DIE_COUNT) return false;
    if (seen.has(v)) return false;
    seen.add(v);
  }
  return true;
}

/** The identity assignment (stat i gets die i), used as a safe fallback. */
export function defaultAssignment(): number[] {
  return STAT_ORDER.map((_, i) => i);
}

/**
 * A simple AI allocation: hand the biggest dice to the stats the AI values most.
 * Deterministic (no RNG) so it stays in lockstep across peers.
 */
export function aiAssignment(dice: DieResult[]): number[] {
  const priority: StatKey[] = ['hp', 'strength', 'int', 'mana', 'dex', 'luck'];
  const byValueDesc = dice
    .map((d, i) => ({ i, value: d.value }))
    .sort((a, b) => b.value - a.value || a.i - b.i)
    .map((d) => d.i);
  const order = defaultAssignment();
  priority.forEach((stat, rank) => {
    order[STAT_ORDER.indexOf(stat)] = byValueDesc[rank];
  });
  return order;
}
