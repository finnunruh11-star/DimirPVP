// Baral, Artificer of Nope: the second bloodmoon's blue boss. He opens with an
// Artifact of Denial and a drake per player and keeps building them while he
// hunts the weakest of the party. An artifact charges on every party action and,
// armed, stifles the next one. Pure: no Phaser.

import type { Mage } from '../core/Mage';

/** Baral's hp mark (scales with the party): below it he runs faster, at or below it he builds two drakes. */
export const BARAL_HP_MARK = 20;
/** Baral's sanity mark, the same as his hp mark but for mill. */
export const BARAL_SANITY_MARK = 15;
/** His speed in cm once below either mark. */
export const BARAL_FAST_MOVE_UNITS = 30;
/** How far he dashes, unseen, at his first wound. */
export const BARAL_WOUND_DASH_UNITS = 10;
/** How far from Baral an artifact may be set down. */
export const DENIAL_SPAWN_RADIUS_UNITS = 20;
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

/** Whether Baral is below either of his marks. */
export function baralBelowMarks(m: Mage): boolean {
  return !!m.baral && (m.hp < m.baral.hpMark || m.sanity < BARAL_SANITY_MARK);
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
