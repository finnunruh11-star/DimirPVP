// Baral, Artificer of Nope: the second bloodmoon's blue boss. He opens with an
// Artifact of Denial per player and keeps building them and drakes while he
// hunts the weakest of the party. An artifact charges on every party action and,
// armed, stifles the next one. Pure: no Phaser.

import type { Mage } from '../core/Mage';

/** Baral's hp and sanity mark: at or below it he builds two drakes, not one. Hp scales with the party. */
export const BARAL_MARK = 10;
/** A drake falls apart after this many of its own turns. */
export const DRAKE_LIFESPAN = 3;
/** What an artifact takes for being moved. */
export const DENIAL_RELOCATION_DAMAGE = 5;
/** The mill a stifled actor takes, once per action. */
export const DENIAL_STIFLE_MILL = 1;

/** Charges that arm an artifact: 4 alone, 3 for two to four players, 2 for five or more. */
export function denialThreshold(players: number): number {
  const n = Math.max(1, Math.floor(players));
  return n <= 1 ? 4 : n >= 5 ? 2 : 3;
}

/** The opening artifacts' charges: 3, 2, 1, 0, and round again. */
export function denialStartCharges(count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => 3 - (i % 4));
}

export function isBaralUnit(m: Mage): boolean {
  return m.enemyKind === 'baral' || m.enemyKind === 'baralDrake' || m.enemyKind === 'denialArtifact';
}

export function denialArmed(m: Mage): boolean {
  return m.alive && !!m.denial && m.denial.charges >= m.denial.threshold;
}

/** The charge line shown under an artifact, for everyone to read. */
export function denialLabel(m: Mage): string {
  const d = m.denial;
  if (!d) return '';
  const lit = Math.min(d.charges, d.threshold);
  return `${'\u25A0'.repeat(lit)}${'\u25A1'.repeat(d.threshold - lit)} ${lit}/${d.threshold}${lit >= d.threshold ? ' ARMED' : ''}`;
}
