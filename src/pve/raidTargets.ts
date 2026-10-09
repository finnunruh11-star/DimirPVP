// What a Raid can be fought against: the swamp's three raid bosses, and every
// bloodmoon boss with all it brings, for testing them without waiting for a
// bloodmoon. Pure: no Phaser.

import { BOSS_IDS, BOSSES, bossRoster, type BossId } from './exploration/bloodmoon';
import { ENEMY_DEFS, RAID_BOSS_KINDS, type RaidBossKind } from './swamprun';

export type RaidTarget = RaidBossKind | BossId;

export const RAID_TARGETS: readonly RaidTarget[] = [...RAID_BOSS_KINDS, ...BOSS_IDS];

export function isRaidTarget(value: unknown): value is RaidTarget {
  return RAID_TARGETS.includes(value as RaidTarget);
}

export function isBloodmoonRaid(target: RaidTarget): target is BossId {
  return (BOSS_IDS as readonly string[]).includes(target);
}

export function raidTargetName(target: RaidTarget): string {
  return isBloodmoonRaid(target) ? BOSSES[target].name : ENEMY_DEFS[target].name;
}

/** The encounter power the raid is counted as: its leader's. */
export function raidTargetPower(target: RaidTarget): number {
  if (!isBloodmoonRaid(target)) return ENEMY_DEFS[target].power;
  const leader = bossRoster(target, 1).find((unit) => unit.leader) ?? bossRoster(target, 1)[0];
  return ENEMY_DEFS[leader.kind].power;
}
