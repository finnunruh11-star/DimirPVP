// The White Desert's weather. Sandstorms come and go on a schedule fixed by the
// run's seed, roughly every other day for five to ten hours. By day the sun
// wears down anyone crossing the desert without a stillsuit, twice as hard in
// a storm. Pure: no Phaser, no Math.random.

import { getItem } from '../../core/Items';
import type { Mage } from '../../core/Mage';
import { isNight } from './clock';
import { withParty } from './economy';
import { stepDice, type ExplorationRun } from './run';
import { regionAt, type WorldMap } from './world';

/** Seeds the storm schedule well away from the steps trips and searches use. */
const STORM_STEP = 7_000_000;
/** Share of days that bring a storm. */
export const STORM_CHANCE = 0.5;
/** HP the sun takes each hour in the desert by day, and in a storm. */
export const HEAT_PER_HOUR = 1;
export const STORM_HEAT = 2;
/** A storm makes the going this much slower and more dangerous. */
export const STORM_TIME = 1.35;
export const STORM_DANGER = 1.25;
/** Packs see this share of their usual sight through blowing sand. */
export const STORM_SIGHT = 0.6;

export interface StormWindow {
  /** Hours since the run began (day 1, 00:00). */
  start: number;
  hours: number;
}

/** Hours since the run began, `offset` hours from now. */
export function absoluteHour(run: ExplorationRun, offset = 0): number {
  return (run.day - 1) * 24 + run.hour + offset;
}

/** The storm that starts on `day`, if that day has one. */
export function stormOnDay(run: ExplorationRun, day: number): StormWindow | null {
  if (day < 1) return null;
  const dice = stepDice(run, STORM_STEP + day);
  if (dice.float() >= STORM_CHANCE) return null;
  const start = (day - 1) * 24 + dice.float() * 24;
  return { start, hours: 4 + dice.die(6) };
}

/** The storm raging at absolute hour `abs`, if any. Storms can run past midnight. */
export function stormAt(run: ExplorationRun, abs: number): StormWindow | null {
  const day = Math.floor(abs / 24) + 1;
  for (const d of [day, day - 1]) {
    const storm = stormOnDay(run, d);
    if (storm && abs >= storm.start && abs < storm.start + storm.hours) return storm;
  }
  return null;
}

export function isSandstorm(run: ExplorationRun, offset = 0): boolean {
  return stormAt(run, absoluteHour(run, offset)) != null;
}

/** Hours until the storm now raging dies down; 0 when the air is still. */
export function stormHoursLeft(run: ExplorationRun): number {
  const abs = absoluteHour(run);
  const storm = stormAt(run, abs);
  return storm ? storm.start + storm.hours - abs : 0;
}

export function inDesert(world: WorldMap, x: number, y: number): boolean {
  return regionAt(world, x, y) === 'white';
}

/** Whether a mage wears something that keeps the sun off. */
export function heatProof(mage: Mage): boolean {
  return [mage.head, mage.torso, mage.boots, ...mage.accessories].some((id) => !!id && !!getItem(id).heatProof);
}

/** Heat (HP) from `hours` spent on a tile, starting at absolute hour `abs`. */
export function heatFor(world: WorldMap, run: ExplorationRun, x: number, y: number, hours: number, abs: number): number {
  if (hours <= 0 || !inDesert(world, x, y)) return 0;
  if (isNight(((abs % 24) + 24) % 24)) return 0;
  return hours * (stormAt(run, abs) ? STORM_HEAT : HEAT_PER_HOUR);
}

/**
 * Take whole points of heat off every party member without a stillsuit.
 * Nobody drops below 1 HP. Returns the most any one of them lost.
 */
export function applyHeat(run: ExplorationRun, amount: number): number {
  const whole = Math.floor(amount);
  if (whole <= 0) return 0;
  return withParty(run, (_leader, party) => {
    let lost = 0;
    for (const mage of party) {
      if (heatProof(mage)) continue;
      const before = mage.hp;
      mage.hp = Math.max(1, mage.hp - whole);
      lost = Math.max(lost, before - mage.hp);
    }
    return lost;
  });
}

/** Whether every party member is covered against the sun. */
export function partyHeatProof(party: readonly Mage[]): boolean {
  return party.length > 0 && party.every(heatProof);
}
