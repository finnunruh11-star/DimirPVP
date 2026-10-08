// A party of one to three travellers in one run. Members are told apart by
// class: a party never holds two mages of the same class. Fallen members stay
// in the roster at 0 HP until the next night at an inn. Pure: no Phaser.

import type { MageClass } from '../../core/Classes';
import type { Mage } from '../../core/Mage';
import type { Scenario } from '../../core/Scenario';
import { addXp } from '../progression';
import { swamprunPartyScale } from '../swamprun';
import { capturePartySnapshot, restoreParty } from './party';
import type { ExplorationRun } from './run';

/** One traveller per class. */
export const MAX_PARTY = 3;

export function memberOf(party: readonly Mage[], member: MageClass | null | undefined): Mage | undefined {
  return member ? party.find((mage) => mage.mageClass === member) : undefined;
}

/** Who acts when nobody in particular does: the first member still standing. */
export function leadMember(party: readonly Mage[]): Mage | undefined {
  return party.find((mage) => mage.alive) ?? party[0];
}

export function livingMembers(party: readonly Mage[]): Mage[] {
  return party.filter((mage) => mage.alive);
}

export function partySize(run: ExplorationRun): number {
  return Math.max(1, run.party.entities.length);
}

/** Enemy and XP pressure of a party this size: +75% per extra member, as in Swamprun. */
export function partyScale(size: number): number {
  return swamprunPartyScale(Math.max(1, size));
}

/** Everyone levels together, so a bigger party needs proportionally more XP per level. */
export function partyXpScale(run: ExplorationRun): number {
  return partyScale(partySize(run));
}

/** Bank XP on the shared track until a completed long rest. */
export function addRunXp(run: ExplorationRun, amount: number): number {
  const gained = addXp(run, amount);
  syncPendingLevels(run);
  return gained;
}

/** The level `member` has chosen its rewards up to. */
export function levelTaken(run: ExplorationRun, member: MageClass): number {
  return Math.min(run.level, run.levelsTaken[member] ?? 1);
}

export function levelsOwed(run: ExplorationRun, member: MageClass): number {
  return Math.max(0, run.level - levelTaken(run, member));
}

/** Record that `member` has chosen its rewards for `level`. */
export function takeLevel(run: ExplorationRun, member: MageClass, level: number): void {
  run.levelsTaken[member] = Math.max(levelTaken(run, member), Math.min(run.level, level));
  syncPendingLevels(run);
}

export function syncPendingLevels(run: ExplorationRun): void {
  run.pendingLevels = Math.max(0, ...run.party.entities.map((entity) => levelsOwed(run, entity.mageClass)));
}

/** Back from the dead at an inn: 1 HP, 1 sanity, no mana and every word spent. */
export function respawnFallen(mage: Mage): void {
  mage.resetForNewCombat();
  mage.hp = 1;
  mage.sanity = 1;
  mage.mana = 0;
  for (const word of Object.keys(mage.charges)) mage.charges[word] = 0;
}

/** The members who can take part in a fight. */
export function fightingParty(snapshot: Scenario): Scenario {
  return capturePartySnapshot(livingMembers(restoreParty(snapshot)));
}

/**
 * The roster after a fight: each fighter as it came out, stored in the roster's
 * order, and everyone who sat it out untouched. A fighter who fell stays at 0 HP.
 */
export function mergeFightParty(before: Scenario, fighters: readonly Mage[]): Scenario {
  const party = restoreParty(before).map((member) => {
    const fighter = memberOf(fighters, member.mageClass);
    if (!fighter) return member;
    if (!fighter.alive) fighter.hp = 0;
    return fighter;
  });
  return capturePartySnapshot(party);
}

/** Whether every member has a class of its own. */
export function classesUnique(snapshot: Scenario): boolean {
  const classes = snapshot.entities.map((entity) => entity.mageClass);
  return new Set(classes).size === classes.length;
}
