// Ambushes in the open world. Each world tile the party walks onto rolls once
// for something that has caught its scent: a pack that turns up at the edge of
// sight already hunting. Seeded by tile, day and hour, so walking back and forth
// or reloading changes nothing. Pure: no Phaser.

import { Dice } from '../../core/Dice';
import type { Cell } from '../../world/pathfind';
import { isNight } from './clock';
import { hashString } from './economy';
import { describeSpawns, hasMonsters, packPace, rollEncounter, spawnTint } from './encounters';
import type { WildPack } from './locales';
import type { ExplorationRun } from './run';
import { createWorld, depthAt, PLACES, REGIONS, regionAt, TERRAIN, terrainAt } from './world';

/** Chance per world tile in plain country by day, before region and terrain danger. */
export const AMBUSH_BASE = 0.07;
export const AMBUSH_NIGHT = 1.4;
export const AMBUSH_SNEAK = 0.45;
export const AMBUSH_VEIL = 0.3;
/** Nothing lies in wait this close to a town, in world tiles. */
export const AMBUSH_PEACE = 4;
/** An ambush never runs slower than this share of the party's walking pace. */
export const AMBUSH_PACE = 1.15;

export interface AmbushCover {
  sneaking: boolean;
  veiled: boolean;
}

/** Chance that stepping onto world tile `tile` draws an ambush. */
export function ambushChance(run: ExplorationRun, tile: Cell, cover: AmbushCover): number {
  const world = createWorld();
  if (PLACES.some((p) => p.x === tile.x && p.y === tile.y)) return 0;
  if (PLACES.some((p) => p.kind === 'city' && Math.max(Math.abs(p.x - tile.x), Math.abs(p.y - tile.y)) <= AMBUSH_PEACE)) return 0;
  const terrain = TERRAIN[terrainAt(world, tile.x, tile.y)];
  if (!Number.isFinite(terrain.time)) return 0;
  const zone = regionAt(world, tile.x, tile.y);
  // Where nothing lives yet, only its robbers lie in wait.
  const trouble = hasMonsters(zone) ? 1 : REGIONS[zone].robbery;
  let chance = AMBUSH_BASE * REGIONS[zone].danger * terrain.danger * trouble;
  if (isNight(run.hour)) chance *= AMBUSH_NIGHT;
  if (cover.sneaking) chance *= AMBUSH_SNEAK;
  if (cover.veiled) chance *= AMBUSH_VEIL;
  return Math.min(0.5, chance);
}

/**
 * The pack that finds the party on `tile`, if one does. `walkSpeed` is the
 * party's full pace in tiles per second; the pack hunts at least a little faster.
 * The caller places it; x and y are left at 0.
 */
export function rollAmbush(run: ExplorationRun, tile: Cell, cover: AmbushCover, walkSpeed: number): WildPack | null {
  const chance = ambushChance(run, tile, cover);
  if (chance <= 0) return null;
  const hour = Math.floor(run.hour);
  const dice = new Dice((hashString(`amb:${tile.x},${tile.y}:${run.day}:${hour}`) ^ run.seed) >>> 0);
  if (dice.float() >= chance) return null;
  const world = createWorld();
  const zone = regionAt(world, tile.x, tile.y);
  const kind = hasMonsters(zone) && dice.float() >= REGIONS[zone].robbery ? 'monsters' : 'robbery';
  const depth = depthAt(world, tile.x, tile.y);
  const spawns = rollEncounter(zone, kind, depth, dice);
  return {
    id: `once:amb:${tile.x},${tile.y}:${run.day}:${hour}`,
    x: 0,
    y: 0,
    sight: zone === 'white' ? 8 : 7,
    depth,
    spawns,
    label: `${describeSpawns(spawns)} on your trail`,
    tint: spawnTint(spawns),
    zone,
    pace: Math.max(packPace(spawns), walkSpeed * AMBUSH_PACE),
    hunting: true,
  };
}
