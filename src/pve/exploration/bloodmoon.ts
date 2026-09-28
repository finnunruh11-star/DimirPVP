// The bloodmoon. It rises at the midnight that begins day 5, and every ten days
// after, and brings a boss the party must fight where it stands. The first
// bloodmoon draws its boss from the first pool, the second from the second, and
// every later one from the third. Pure: no Phaser.

import type { ExplorationCombat } from '../../config/MatchConfig';
import { Dice } from '../../core/Dice';
import type { EnemyKind } from '../swamprun';
import { hashString } from './economy';
import type { EncounterZone } from './encounters';
import type { ExplorationRun, LocaleState } from './run';

export const FIRST_BLOODMOON = 5;
export const BLOODMOON_EVERY = 10;

/** Bloodmoons risen by the start of `day`. */
export function bloodmoonCycle(day: number): number {
  return day < FIRST_BLOODMOON ? 0 : 1 + Math.floor((day - FIRST_BLOODMOON) / BLOODMOON_EVERY);
}

/** The day whose first midnight brings the next bloodmoon. */
export function nextBloodmoonDay(day: number): number {
  return FIRST_BLOODMOON + bloodmoonCycle(day) * BLOODMOON_EVERY;
}

/** Hours from `hour` on `day` until the next bloodmoon rises. */
export function hoursToBloodmoon(day: number, hour: number): number {
  return (nextBloodmoonDay(day) - day) * 24 - hour;
}

export interface BloodmoonOmen {
  /** Days left, today included: 1 means it rises tonight. */
  daysLeft: number;
  tonight: boolean;
}

export function bloodmoonOmen(day: number): BloodmoonOmen {
  const daysLeft = nextBloodmoonDay(day) - day;
  return { daysLeft, tonight: daysLeft <= 1 };
}

export function omenLabel(omen: BloodmoonOmen): string {
  return omen.tonight ? 'The bloodmoon rises tonight' : `Bloodmoon in ${omen.daysLeft} days`;
}

export type BossId =
  | 'goblins' | 'minion' | 'rock' | 'zargarg'
  | 'dragon' | 'crusade' | 'baral'
  | 'trickster' | 'planetar' | 'selga';

export type BossColor = 'red' | 'black' | 'green' | 'blue' | 'white';

export interface BossDef {
  id: BossId;
  name: string;
  color: BossColor;
  /** Which bloodmoon's pool it belongs to. */
  tier: 1 | 2 | 3;
}

export const BOSSES: Record<BossId, BossDef> = {
  goblins: { id: 'goblins', name: 'The Feared "Hrrrk Snazzlegob"', color: 'red', tier: 1 },
  minion: { id: 'minion', name: 'Evil Minion of Minor Villainy', color: 'black', tier: 1 },
  rock: { id: 'rock', name: 'Angy Big Rock', color: 'green', tier: 1 },
  zargarg: { id: 'zargarg', name: 'Zargarg der Ausgedachte', color: 'blue', tier: 1 },
  dragon: { id: 'dragon', name: 'Big Angy Dragon', color: 'red', tier: 2 },
  crusade: { id: 'crusade', name: 'Crusade', color: 'white', tier: 2 },
  baral: { id: 'baral', name: 'Baral, Artificer of Nope', color: 'blue', tier: 2 },
  trickster: { id: 'trickster', name: 'Evil Fighter of Evil Tricks', color: 'black', tier: 3 },
  planetar: { id: 'planetar', name: 'Planetar', color: 'green', tier: 3 },
  selga: { id: 'selga', name: 'Mini Selga', color: 'white', tier: 3 },
};

export const BOSS_IDS = Object.keys(BOSSES) as BossId[];

/** Stands in for every boss until the bosses themselves are written. */
export const BOSS_STAND_IN: EnemyKind = 'zombie';

/** Snazzlegob's band: shamans and raiders by the number of players; past four, one more of each per player. */
export function goblinBand(players: number): { shamans: number; raiders: number } {
  const n = Math.max(1, Math.floor(players));
  if (n <= 4) return [{ shamans: 1, raiders: 1 }, { shamans: 2, raiders: 2 }, { shamans: 2, raiders: 4 }, { shamans: 3, raiders: 5 }][n - 1];
  return { shamans: 3 + (n - 4), raiders: 5 + (n - 4) };
}

export interface BossUnit {
  kind: EnemyKind;
  /** The painted art it wears (see visuals/bosses). */
  art: string;
  count: number;
  /** The one whose fall is the boss's fall. */
  leader?: boolean;
}

/** Who takes the field for boss `id` against `players`. Unwritten bosses are one stand-in in the boss's shape. */
export function bossRoster(id: BossId, players: number): BossUnit[] {
  if (id === 'goblins') {
    const band = goblinBand(players);
    return [
      { kind: 'goblinChief', art: 'goblin-chief', count: 1, leader: true },
      { kind: 'goblinRaider', art: 'goblin-raider', count: band.raiders },
      { kind: 'goblinShaman', art: 'goblin-shaman', count: band.shamans },
    ];
  }
  if (id === 'baral') {
    return [
      { kind: 'baral', art: 'baral', count: 1, leader: true },
      { kind: 'denialArtifact', art: 'denial-artifact', count: Math.max(1, Math.floor(players)) },
    ];
  }
  return [{ kind: BOSS_STAND_IN, art: id, count: 1, leader: true }];
}

/** Whether a boss's damage grows with the party too; a band that grows in number does not, nor Baral, whose damage was not written to. */
export function bossDamageScales(id: BossId): boolean {
  return id !== 'goblins' && id !== 'baral';
}

export function bossPool(cycle: number): BossId[] {
  const tier = Math.min(3, Math.max(1, cycle));
  return BOSS_IDS.filter((id) => BOSSES[id].tier === tier);
}

/** The boss of the `cycle`th bloodmoon of the run with `seed`. */
export function bloodmoonBoss(seed: number, cycle: number): BossId {
  return new Dice((hashString(`bloodmoon:${cycle}`) ^ seed) >>> 0).pick(bossPool(cycle));
}

/** One player meets the boss as written; each extra player adds +30% damage and +75% health. */
export function bossScaling(players: number): { damage: number; health: number } {
  const extra = Math.max(0, Math.floor(players) - 1);
  const round = (value: number): number => Math.round(value * 100) / 100;
  return { damage: round(1 + 0.3 * extra), health: round(1 + 0.75 * extra) };
}

export interface BossFight {
  id: BossId;
  /** Which bloodmoon brought it. */
  cycle: number;
}

/** A bloodmoon has risen that the party has not yet fought through. */
export function bloodmoonDue(run: ExplorationRun): boolean {
  return bloodmoonCycle(run.day) > run.bloodmoons;
}

export function bloodmoonFight(run: ExplorationRun): BossFight | null {
  if (!bloodmoonDue(run)) return null;
  const cycle = bloodmoonCycle(run.day);
  return { id: bloodmoonBoss(run.seed, cycle), cycle };
}

/** The fight a risen bloodmoon starts. There is no running from it. */
export function bloodmoonCombat(run: ExplorationRun, fight: BossFight, zone: EncounterZone, returnTo?: LocaleState): ExplorationCombat {
  return {
    run,
    encounter: 'monsters',
    depth: 1,
    cameFrom: null,
    zone,
    returnTo,
    label: `The bloodmoon rises. ${BOSSES[fight.id].name} attacks.`,
    boss: fight,
  };
}

const NUMERALS: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];

export function roman(value: number): string {
  let rest = Math.max(1, Math.min(39, Math.floor(value)));
  let out = '';
  for (const [size, glyph] of NUMERALS) {
    while (rest >= size) {
      out += glyph;
      rest -= size;
    }
  }
  return out;
}

/** A boss fight as sent to guests or stored, read as hostile input. */
export function parseBossFight(value: unknown): BossFight | undefined {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const id = BOSS_IDS.find((entry) => entry === raw?.id);
  const cycle = raw?.cycle;
  if (!id || typeof cycle !== 'number' || !Number.isInteger(cycle) || cycle < 1 || cycle > 10_000) return undefined;
  return { id, cycle };
}
