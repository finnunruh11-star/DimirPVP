// Getting about on the world map. A route runs across terrain tiles; the travel
// mode sets how long it takes and what the road throws at you on the way.
// Every tile rolls for trouble and for finds, so risk grows with distance.
// Pure and seeded from the run.

import { findWeightedPath, type Cell } from '../../world/pathfind';
import { isNight } from './clock';
import { absoluteHour, inDesert, stormAt, STORM_DANGER, STORM_TIME } from './desert';
import { hasMonsters, troubleIn } from './encounters';
import { isExplored, packExplored, revealTiles, unpackExplored } from './explored';
import { stepDice, type ExplorationRun } from './run';
import {
  depthAt,
  isPassable,
  MIN_TERRAIN_TIME,
  nearTown,
  placeAt,
  REGIONS,
  regionAt,
  TERRAIN,
  terrainAt,
  type RegionId,
  type WorldMap,
} from './world';

export type TravelMode = 'sprint' | 'sneak' | 'explore' | 'fast';

export interface ModeRule {
  label: string;
  blurb: string;
  /** Multipliers on time, enemy chance and find chance. */
  time: number;
  enemies: number;
  finds: number;
  /** Tiles either side of the route that count as explored afterwards. */
  reveal: number;
}

export const TRAVEL_MODES: Record<TravelMode, ModeRule> = {
  sprint: { label: 'Sprint', blurb: 'Balanced pace, risk and finds.', time: 1, enemies: 1, finds: 1, reveal: 1 },
  sneak: { label: 'Sneak', blurb: 'Far fewer fights but slower. Best at night.', time: 1.6, enemies: 0.45, finds: 0.7, reveal: 1 },
  explore: { label: 'Explore', blurb: 'Much slower and riskier, but far more finds.', time: 2.5, enemies: 1.5, finds: 3, reveal: 3 },
  fast: { label: 'Fast travel', blurb: 'A route you know: one roll for trouble, no finds.', time: 0.8, enemies: 1, finds: 0, reveal: 0 },
};

export const TRAVEL_ORDER: readonly TravelMode[] = ['sprint', 'sneak', 'explore', 'fast'];

export const HOURS_PER_TILE = 0.25;
/** Tiles walked between one stop and the next (see journey.ts). */
export const LEG_TILES = 4;
/** Chances per tile at a sprint over explored open country by day. */
const TILE_ENEMY = 0.31;
const TILE_FIND = 0.03;
const UNEXPLORED_TIME = 1.5;
const UNEXPLORED_DANGER = 1.5;
const UNEXPLORED_FINDS = 1.25;
const NIGHT_DANGER = 1.4;
const NIGHT_SNEAK = 0.8;
/** One roll for a whole fast-travel trip, at roughly a league's worth of risk. */
const FAST_ROLL = 0.16;
const MAX_CHANCE = 0.9;

/** A tile's chance as a share of the risk a leg builds up: summed over a leg, 1 - exp(-sum) is the stop's chance. */
export const legHazard = (chance: number): number => (chance > 0 ? -Math.log(1 - Math.min(0.95, chance)) : 0);

export type StopKind = 'robbery' | 'monsters' | 'loot' | 'event';

export interface TripStep {
  cell: Cell;
  hours: number;
  known: boolean;
  enemy: number;
  find: number;
  zone: RegionId;
  depth: number;
  night: boolean;
  /** Crossed in a sandstorm: the tile counts as unknown whatever the map says. */
  storm: boolean;
}

export interface TripPlan {
  mode: TravelMode;
  steps: TripStep[];
  hours: number;
  /** Share of the route already walked, 0..1. */
  known: number;
  allowed: boolean;
  reason?: string;
  /** Expected fights and finds, for the preview. */
  fights: number;
  finds: number;
  storm: boolean;
}

export interface TripStop {
  /** Index into the plan's steps where it happens. */
  index: number;
  kind: StopKind;
  zone: RegionId;
  depth: number;
}

const tileKnown = (mask: Uint8Array, cell: Cell): boolean => isExplored(mask, cell.x, cell.y);

/** Cheapest route from `from` (the party, by default) to `to`; unexplored ground counts as slower. */
export function findRoute(world: WorldMap, run: ExplorationRun, to: Cell, from: Cell = run.pos): Cell[] | null {
  const mask = unpackExplored(run.explored);
  const cost = (x: number, y: number): number =>
    isPassable(world, x, y) ? TERRAIN[terrainAt(world, x, y)].time * (isExplored(mask, x, y) ? 1 : UNEXPLORED_TIME) : Infinity;
  return findWeightedPath(world.w, world.h, cost, from, to, world.w * world.h * 2, MIN_TERRAIN_TIME);
}

/** Risk of trouble on one tile before the travel mode and the hour are applied. */
function tileDanger(world: WorldMap, cell: Cell, known: boolean): number {
  if (nearTown(cell.x, cell.y)) return 0;
  const terrain = TERRAIN[terrainAt(world, cell.x, cell.y)].danger;
  return terrain * REGIONS[regionAt(world, cell.x, cell.y)].danger * (known ? 1 : UNEXPLORED_DANGER);
}

export function planTrip(
  world: WorldMap,
  run: ExplorationRun,
  route: readonly Cell[],
  mode: TravelMode,
  from: Cell = run.pos,
): TripPlan {
  const rule = TRAVEL_MODES[mode];
  const mask = unpackExplored(run.explored);
  const steps: TripStep[] = [];
  let prev: Cell = from;
  let clock = run.hour;
  let elapsed = 0;
  for (const cell of route) {
    const abs = absoluteHour(run, elapsed);
    const storm = inDesert(world, cell.x, cell.y) && stormAt(run, abs) != null;
    const known = tileKnown(mask, cell) && !storm;
    const diagonal = cell.x !== prev.x && cell.y !== prev.y ? Math.SQRT2 : 1;
    const hours = HOURS_PER_TILE * TERRAIN[terrainAt(world, cell.x, cell.y)].time * diagonal
      * (known ? 1 : UNEXPLORED_TIME) * rule.time * (storm ? STORM_TIME : 1);
    elapsed += hours;
    clock = (clock + hours) % 24;
    const night = isNight(clock);
    const nightFactor = night ? (mode === 'sneak' ? NIGHT_SNEAK : NIGHT_DANGER) : 1;
    const danger = tileDanger(world, cell, known) * (storm ? STORM_DANGER : 1);
    steps.push({
      cell,
      hours,
      known,
      enemy: Math.min(MAX_CHANCE, TILE_ENEMY * danger * rule.enemies * nightFactor),
      find: Math.min(MAX_CHANCE, TILE_FIND * rule.finds * (known ? 1 : UNEXPLORED_FINDS)),
      zone: regionAt(world, cell.x, cell.y),
      depth: Math.min(10, depthAt(world, cell.x, cell.y) + (night ? 1 : 0)),
      night,
      storm,
    });
    prev = cell;
  }

  const knownTiles = steps.filter((step) => step.known).length;
  const plan: TripPlan = {
    mode,
    steps,
    hours: steps.reduce((sum, step) => sum + step.hours, 0),
    known: steps.length ? knownTiles / steps.length : 1,
    allowed: steps.length > 0,
    reason: steps.length ? undefined : 'You are already here.',
    fights: 0,
    finds: 0,
    storm: steps.some((step) => step.storm),
  };
  if (mode === 'fast') {
    if (knownTiles < steps.length) {
      plan.allowed = false;
      plan.reason = plan.storm ? 'A sandstorm hides the way.' : `You only know ${Math.round(plan.known * 100)}% of this route.`;
    }
    const risky = steps.filter((step) => step.enemy > 0);
    const mean = risky.length ? risky.reduce((sum, step) => sum + step.enemy, 0) / risky.length : 0;
    const chance = Math.min(MAX_CHANCE, mean ? (FAST_ROLL * mean) / TILE_ENEMY : 0);
    for (const step of steps) {
      step.enemy = 0;
      step.find = 0;
    }
    const middle = steps[Math.floor(steps.length / 2)];
    if (middle) middle.enemy = chance;
    plan.fights = chance;
    return plan;
  }
  // As walked: the danger of every leg is rolled once at its stop, and the walk goes on after a fight.
  let danger = run.road.danger;
  let walked = run.road.tiles;
  steps.forEach((step, index) => {
    danger += legHazard(step.enemy);
    plan.finds += step.find;
    walked += 1;
    if (walked < LEG_TILES) return;
    const home = index === steps.length - 1 && placeAt(step.cell.x, step.cell.y)?.kind === 'city';
    if (home) return;
    if (!nearTown(step.cell.x, step.cell.y)) {
      plan.fights += (1 - Math.exp(-danger)) * (hasMonsters(step.zone) ? 1 : REGIONS[step.zone].robbery);
    }
    danger = 0;
    walked = 0;
  });
  return plan;
}

/**
 * What happens along a trip, in order. A fight ends the list: the party stops
 * where it was caught. Call after advancing `run.steps` so each trip rolls anew.
 */
export function rollTrip(run: ExplorationRun, plan: TripPlan): TripStop[] {
  const dice = stepDice(run, run.steps * 7 + 1);
  const stops: TripStop[] = [];
  for (let index = 0; index < plan.steps.length; index++) {
    const step = plan.steps[index];
    if (step.enemy > 0 && dice.float() < step.enemy) {
      const kind = troubleIn(step.zone, dice.float() < REGIONS[step.zone].robbery);
      if (kind) {
        stops.push({ index, kind, zone: step.zone, depth: step.depth });
        break;
      }
    }
    if (step.find > 0 && dice.float() < step.find) {
      stops.push({ index, kind: dice.float() < 0.6 ? 'loot' : 'event', zone: step.zone, depth: step.depth });
    }
  }
  return stops;
}

/** Walked tiles along the way count as explored, and a little either side. */
export function exploreAlong(run: ExplorationRun, cells: readonly Cell[], radius: number): number {
  const mask = unpackExplored(run.explored);
  const fresh = revealTiles(mask, cells, radius);
  if (fresh) run.explored = packExplored(mask);
  return fresh;
}

/** A word for the preview: how many fights the trip is likely to bring. */
export function dangerWord(fights: number): string {
  if (fights < 0.1) return 'safe';
  if (fights < 0.6) return 'low';
  if (fights < 1.5) return 'moderate';
  return 'high';
}

export function findsWord(finds: number): string {
  if (finds < 0.05) return 'none';
  if (finds < 0.5) return 'few';
  if (finds < 1.5) return 'some';
  return 'many';
}
