// The travel map walked in legs. Every LEG_TILES tiles the party stops for a
// beat: a fight, a find, a roadside event, something sighted off the way, or a
// short rest. Danger and luck build up tile by tile and carry over between
// trips, so a string of short hops meets the same road as one long walk. Pure
// and seeded.

import type { Dice } from '../../core/Dice';
import { getItem, type ItemId } from '../../core/Items';
import type { Cell } from '../../world/pathfind';
import { describeSpawns, rollEncounter, type EncounterKind, type EncounterSpawn } from './encounters';
import { ROAD_EVENTS } from './events';
import { HERBS } from './finds';
import { stepDice, type ExplorationRun, type RoadState } from './run';
import { TRAVEL_MODES, type TravelMode, type TripStep } from './travel';
import {
  depthAt,
  isPassable,
  nearTown,
  placeAt,
  REGIONS,
  regionAt,
  TERRAIN,
  terrainAt,
  type RegionId,
  type Terrain,
  type WorldMap,
} from './world';

/** Tiles walked between one stop and the next. */
export const LEG_TILES = 6;
/** Chance a stop turns up something off the way, at a sprint by day. */
const SIGHT_CHANCE = 0.3;
/** By night the party spots less, and not as far. */
const NIGHT_SIGHT = 0.65;
const SIGHT_NEAR = 2;
const SIGHT_FAR = 5;
const NIGHT_FAR = 3;
/** Share of plain finds that are things rather than roadside events. */
const LOOT_SHARE = 0.6;

export type SightingKind = 'herbs' | 'pack' | 'cache' | 'event';

export interface Sighting {
  kind: SightingKind;
  cell: Cell;
  zone: RegionId;
  depth: number;
  title: string;
  /** Where it lies from the party, e.g. "4 tiles north-east". */
  bearing: string;
  text: string;
  herb?: ItemId;
  spawns?: EncounterSpawn[];
  eventId?: string;
  /** What a cache is called, for the find it gives. */
  site?: string;
}

export type Beat =
  | { kind: 'fight'; encounter: EncounterKind; zone: RegionId; depth: number }
  | { kind: 'loot' | 'event'; zone: RegionId; depth: number }
  | { kind: 'sighting'; sighting: Sighting }
  | { kind: 'rest' };

/** Events that sit somewhere the party can walk up to, rather than on top of it. */
const SIGHTED_EVENTS: ReadonlySet<string> = new Set([
  'carter', 'shrine', 'wounded', 'camp', 'caravan', 'mire-lights', 'ash-vent', 'bones',
  'rockslide', 'wreck', 'nets', 'hermit', 'mirage', 'buried-ruin', 'pilgrims',
]);

const CACHE_SITES: Record<RegionId, readonly string[]> = {
  capitol: ['Burnt farmstead', 'Fallen watchtower'],
  forest: ['Old hunting lodge', "Woodcutter's hut"],
  red: ['Collapsed shaft', 'Ruined smelter'],
  black: ['Sunken chapel', 'Drowned cottage'],
  lake: ['Wrecked boathouse', "Fisher's shack"],
  white: ['Half-buried ruin', 'Dead caravan'],
};

/** How readily herbs grow on each kind of ground. */
const HERB_GROUND: Partial<Record<Terrain, number>> = {
  forest: 1.5, swamp: 1.3, plains: 1, hills: 0.8, ford: 0.7, sand: 0.5, flats: 0.4, road: 0.3, dunes: 0.25,
};

const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];

const DIRS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export const emptyRoad = (): RoadState => ({ tiles: 0, danger: 0, luck: 0 });

const hazard = (chance: number): number => (chance > 0 ? -Math.log(1 - Math.min(0.95, chance)) : 0);

/** Count one walked tile toward the next stop. True when the stop is due. */
export function walkStep(run: ExplorationRun, step: TripStep): boolean {
  run.road.tiles += 1;
  run.road.danger += hazard(step.enemy);
  run.road.luck += hazard(step.find);
  return run.road.tiles >= LEG_TILES;
}

/** Indices into a trip of `tiles` steps where its stops fall, the arrival itself excepted. */
export function stopsAlong(run: ExplorationRun, tiles: number): number[] {
  const out: number[] = [];
  for (let at = LEG_TILES - Math.min(run.road.tiles, LEG_TILES - 1); at < tiles; at += LEG_TILES) out.push(at - 1);
  return out;
}

/** "4 tiles north-east". */
export function bearingFrom(from: Cell, to: Cell): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const tiles = Math.max(1, Math.round(Math.hypot(dx, dy)));
  const octant = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
  return `${tiles} tile${tiles === 1 ? '' : 's'} ${COMPASS[octant]}`;
}

/**
 * The stop at the end of a leg, rolled where `step` ends. Clears the leg and
 * seeds a fresh roll. `ahead` is the rest of the route: nothing is sighted on it.
 */
export function rollBeat(world: WorldMap, run: ExplorationRun, step: TripStep, mode: TravelMode, ahead: readonly Cell[]): Beat {
  const road = run.road;
  run.road = emptyRoad();
  run.steps += 1;
  const dice = stepDice(run, run.steps * 7 + 2);
  const { cell, zone, depth } = step;
  if (!nearTown(cell.x, cell.y) && dice.float() < 1 - Math.exp(-road.danger)) {
    return { kind: 'fight', encounter: dice.float() < REGIONS[zone].robbery ? 'robbery' : 'monsters', zone, depth };
  }
  const sight = SIGHT_CHANCE * Math.sqrt(TRAVEL_MODES[mode].finds) * (step.night ? NIGHT_SIGHT : 1);
  if (dice.float() < sight) {
    const sighting = findSighting(world, step, ahead, dice);
    if (sighting) return { kind: 'sighting', sighting };
  }
  if (dice.float() < 1 - Math.exp(-road.luck)) return { kind: dice.float() < LOOT_SHARE ? 'loot' : 'event', zone, depth };
  return { kind: 'rest' };
}

/** Something a short walk off the way: a herb patch, a pack, a ruin or a roadside scene. */
export function findSighting(world: WorldMap, step: TripStep, ahead: readonly Cell[], dice: Dice): Sighting | null {
  const spots = reachableSpots(world, step.cell, step.night ? NIGHT_FAR : SIGHT_FAR, ahead);
  if (spots.length === 0) return null;
  const cell = dice.pick(spots);
  const zone = regionAt(world, cell.x, cell.y);
  const depth = Math.min(10, depthAt(world, cell.x, cell.y) + (step.night ? 1 : 0));
  const base = { cell, zone, depth, bearing: bearingFrom(step.cell, cell) };
  const kind = pickKind(zone, terrainAt(world, cell.x, cell.y), nearTown(cell.x, cell.y), step.night, dice);
  if (kind === 'pack') {
    const spawns = rollEncounter(zone, 'monsters', depth, dice);
    return { ...base, kind, spawns, title: describeSpawns(spawns).toUpperCase(), text: 'They have not seen you: you would strike first.' };
  }
  if (kind === 'cache') {
    const site = dice.pick(CACHE_SITES[zone]);
    return { ...base, kind, site, title: site.toUpperCase(), text: 'Unsearched. It may hold supplies, stones or lost kit.' };
  }
  if (kind === 'event') {
    const fits = ROAD_EVENTS.filter((event) => SIGHTED_EVENTS.has(event.id) && (!event.zones || event.zones.includes(zone)));
    if (fits.length) {
      const event = dice.pick(fits);
      return { ...base, kind, eventId: event.id, title: event.title, text: event.text };
    }
  }
  const herb = dice.pick(HERBS[zone]);
  const name = getItem(herb).name;
  return { ...base, kind: 'herbs', herb, title: name.toUpperCase(), text: `${name} grows there: gather two to four.` };
}

function pickKind(zone: RegionId, terrain: Terrain, safe: boolean, night: boolean, dice: Dice): SightingKind {
  const weights: [SightingKind, number][] = [
    ['pack', safe ? 0 : REGIONS[zone].danger * TERRAIN[terrain].danger * (night ? 1.4 : 1)],
    ['herbs', HERB_GROUND[terrain] ?? 0.3],
    ['cache', zone === 'white' ? 0.8 : 0.45],
    ['event', 0.55],
  ];
  let roll = dice.float() * weights.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [kind, weight] of weights) {
    if (weight <= 0) continue;
    roll -= weight;
    if (roll <= 0) return kind;
  }
  return 'herbs';
}

/** Open ground a few tiles off, reached on foot within a short walk and off the route ahead. */
function reachableSpots(world: WorldMap, from: Cell, far: number, ahead: readonly Cell[]): Cell[] {
  const index = (x: number, y: number): number => y * world.w + x;
  const skip = new Set(ahead.map((cell) => index(cell.x, cell.y)));
  const moves = new Map<number, number>([[index(from.x, from.y), 0]]);
  const queue: Cell[] = [from];
  const spots: Cell[] = [];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const walked = moves.get(index(cur.x, cur.y)) ?? 0;
    const distance = Math.hypot(cur.x - from.x, cur.y - from.y);
    if (distance >= SIGHT_NEAR && distance <= far + 0.5 && !placeAt(cur.x, cur.y) && !skip.has(index(cur.x, cur.y))) spots.push(cur);
    if (walked >= far + 2) continue;
    for (const [dx, dy] of DIRS) {
      const x = cur.x + dx;
      const y = cur.y + dy;
      if (!isPassable(world, x, y) || moves.has(index(x, y))) continue;
      if (dx && dy && (!isPassable(world, cur.x + dx, cur.y) || !isPassable(world, cur.x, cur.y + dy))) continue;
      moves.set(index(x, y), walked + 1);
      queue.push({ x, y });
    }
  }
  return spots;
}
