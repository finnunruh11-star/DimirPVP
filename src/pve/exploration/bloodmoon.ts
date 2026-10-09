// The bloodmoon. It rises at the midnight that begins day 5, and every ten days
// after, and brings a boss the party must fight where it stands. The first
// bloodmoon draws its boss from the first pool, the second from the second, and
// every later one from the third. Pure: no Phaser.

import type { ExplorationCombat } from '../../config/MatchConfig';
import { Dice } from '../../core/Dice';
import { crusadeRoster } from '../crusade';
import type { ItemId } from '../../core/Items';
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

/** Which day of the bloodmoon's cycle `day` is: 1 on the day after one rose (or the first day of all). */
export function cycleDay(day: number): number {
  const cycle = bloodmoonCycle(day);
  const start = cycle === 0 ? 1 : FIRST_BLOODMOON + (cycle - 1) * BLOODMOON_EVERY;
  return day - start + 1;
}

const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth'];

/** "The Second Day", and on the day the bloodmoon rises that night, "The Final Day". */
export function cycleDayTitle(day: number): string {
  if (bloodmoonOmen(day).tonight) return 'The Final Day';
  const n = cycleDay(day);
  return `The ${ORDINALS[n - 1] ?? `${n}th`} Day`;
}

export type BossId =
  | 'goblins' | 'rock'
  | 'crusade' | 'baral'
  | 'lillith';

export type BossColor = 'red' | 'black' | 'green' | 'blue' | 'white';

/** What a bloodmoon boss leaves behind (1d3 of them): a moonshard of its colour, for the god-tier wands. */
export const MOONSHARD: Record<BossColor, ItemId> = {
  white: 'moonshardWhite',
  blue: 'moonshardBlue',
  black: 'moonshardBlack',
  red: 'moonshardRed',
  green: 'moonshardGreen',
};

export interface BossDef {
  id: BossId;
  name: string;
  color: BossColor;
  /** Which bloodmoon's pool it belongs to. */
  tier: 1 | 2 | 3;
}

export const BOSSES: Record<BossId, BossDef> = {
  goblins: { id: 'goblins', name: 'The Feared "Hrrrk Snazzlegob"', color: 'red', tier: 1 },
  rock: { id: 'rock', name: 'G Moay, the hard-headed', color: 'green', tier: 1 },
  crusade: { id: 'crusade', name: 'The Crusading Crusaders', color: 'white', tier: 2 },
  baral: { id: 'baral', name: 'Baral, Artificer of Nope', color: 'blue', tier: 2 },
  lillith: { id: 'lillith', name: 'Lillith Belvus, the Nice and Friendly', color: 'black', tier: 3 },
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
export function bossRoster(id: BossId, players: number, rng = new Dice(0)): BossUnit[] {
  if (id === 'crusade') {
    const { counts } = crusadeRoster(players, rng);
    return (Object.keys(counts) as (keyof typeof counts)[]).map((kind) => ({ kind, art: kind, count: counts[kind], leader: kind === 'crusadeSoldier' }));
  }
  if (id === 'goblins') {
    const band = goblinBand(players);
    return [
      { kind: 'goblinChief', art: 'goblin-chief', count: 1, leader: true },
      { kind: 'goblinRaider', art: 'goblin-raider', count: band.raiders },
      { kind: 'goblinShaman', art: 'goblin-shaman', count: band.shamans },
    ];
  }
  if (id === 'baral') {
    const n = Math.max(1, Math.floor(players));
    return [
      { kind: 'baral', art: 'baral', count: 1, leader: true },
      { kind: 'denialArtifact', art: 'denial-artifact', count: n },
      { kind: 'baralDrake', art: 'baral-drake', count: n },
    ];
  }
  if (id === 'lillith') return [
    { kind: 'lillith', art: 'lillith', count: 1, leader: true },
    { kind: 'skeleton', art: 'skeleton', count: Math.max(1, Math.floor(players)) },
  ];
  if (id === 'rock') return [{ kind: 'moay', art: 'rock', count: 1, leader: true }];
  return [{ kind: BOSS_STAND_IN, art: id, count: 1, leader: true }];
}

/** Whether a boss's damage grows with the party too; a band that grows in number does not, nor Baral or Lillith, whose damage was not written to. */
export function bossDamageScales(id: BossId): boolean {
  return id !== 'goblins' && id !== 'baral' && id !== 'lillith' && id !== 'rock' && id !== 'crusade';
}

export function bossPool(cycle: number): BossId[] {
  const tier = Math.min(3, Math.max(1, cycle));
  return BOSS_IDS.filter((id) => BOSSES[id].tier === tier);
}

/** The boss of the `cycle`th bloodmoon of the run with `seed`. */
export function bloodmoonBoss(seed: number, cycle: number): BossId {
  return new Dice((hashString(`bloodmoon:${cycle}`) ^ seed) >>> 0).pick(bossPool(cycle));
}

/** Each extra player adds +30% damage and +75% health; Lillith's written health is for three players. */
export function bossScaling(players: number, id?: BossId): { damage: number; health: number } {
  const extra = Math.max(0, Math.floor(players) - 1);
  const round = (value: number): number => Math.round(value * 100) / 100;
  return { damage: round(1 + 0.3 * extra), health: id === 'crusade' ? 1 : round((1 + 0.75 * extra) / (id === 'lillith' ? 2.5 : 1)) };
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

/** How much of `hours` can pass before the bloodmoon rises: all of it if it does not, none once it has. */
export function hoursBeforeBloodmoon(run: ExplorationRun, hours: number): number {
  if (bloodmoonDue(run)) return 0;
  return Math.max(0, Math.min(hours, hoursToBloodmoon(run.day, run.hour)));
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
