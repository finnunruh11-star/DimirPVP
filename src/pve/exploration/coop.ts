// A party of one to three travellers in one run. Members are told apart by
// class: a party never holds two mages of the same class. Fallen members stay
// in the roster at 0 HP until the next night at an inn. Pure: no Phaser.

import type { MageClass } from '../../core/Classes';
import type { Mage } from '../../core/Mage';
import type { Scenario, ScenarioEntity } from '../../core/Scenario';
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

/** Enemy pressure of a party this size, as in Swamprun. */
export function partyScale(size: number): number {
  return swamprunPartyScale(Math.max(1, size));
}

/** Everyone levels together, so a bigger party needs proportionally more XP per level. */
export function partyXpScale(run: ExplorationRun): number {
  return 1 + Math.max(0, partySize(run) - 1) * 0.75;
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

/**
 * The summons still standing by a living party member when a fight ends, stored
 * after their owners so the next fight can bring them back. Null when there are none.
 */
export function captureSummons(mages: readonly Mage[]): Scenario | null {
  const owners: Mage[] = [];
  const summons: Mage[] = [];
  for (const summon of mages) {
    if (!summon.isSummon || !summon.alive) continue;
    const owner = mages[summon.summonOwnerIndex ?? -1];
    if (!owner?.alive || owner.isSummon || owner.team !== 1 || owner.sceneSide) continue;
    if (!owners.includes(owner)) owners.push(owner);
    summons.push(summon);
  }
  if (summons.length === 0) return null;
  const snapshot = capturePartySnapshot([...owners, ...summons]);
  summons.forEach((summon, i) => {
    const entity = snapshot.entities[owners.length + i];
    const ownerIndex = owners.indexOf(mages[summon.summonOwnerIndex!]);
    entity.links = {};
    entity.summon = {
      ...entity.summon,
      ownerIndex,
      attachedToIndex: summon.attachedToIndex === summon.summonOwnerIndex ? ownerIndex : undefined,
      order: undefined,
    };
  });
  return snapshot;
}

/** The fighting party with each stored summon back beside its owner; summons of an owner not fighting stay behind. */
export function withSummons(party: Scenario, summons: Scenario | null): Scenario {
  if (!summons) return party;
  const extra: ScenarioEntity[] = [];
  for (const entity of summons.entities) {
    const ownerIndex = entity.summon?.ownerIndex;
    const owner = ownerIndex == null ? undefined : summons.entities[ownerIndex];
    if (!entity.summon || !owner || owner.summon) continue;
    const at = party.entities.findIndex((member) => !member.summon && member.mageClass === owner.mageClass);
    if (at < 0) continue;
    const home = party.entities[at];
    extra.push({
      ...entity,
      team: home.team,
      x: home.x,
      y: home.y,
      links: {},
      summon: {
        ...entity.summon,
        ownerIndex: at,
        attachedToIndex: entity.summon.attachedToIndex === ownerIndex ? at : undefined,
        order: undefined,
      },
    });
  }
  if (extra.length === 0) return party;
  return {
    ...party,
    entities: [...party.entities, ...extra],
    turn: { ...party.turn, rolls: [...party.turn.rolls, ...extra.map(() => 0)] },
  };
}
