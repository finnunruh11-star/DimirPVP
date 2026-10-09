// Exploration run state. No `Math.random` anywhere: every roll derives from the
// run's seed plus the step that triggered it, so a reload reproduces it exactly.

import type { MageClass } from '../../core/Classes';
import { Dice } from '../../core/Dice';
import { emptyHexLore, type HexLore } from '../../core/hexcraft/lore';
import type { Scenario } from '../../core/Scenario';
import type { MineMazeState } from '../mineMaze';
import { START_HOUR } from './clock';
import { packExplored, revealTiles, unpackExplored } from './explored';
import type { EncounterSite } from './site';
import { placeById, START_PLACE } from './world';

export const EXPLORATION_VERSION = 7;

/** A fresh run's purse: five silver per traveller. */
export const START_PURSE = 0.5;

export type BountyKind = 'slay' | 'gather' | 'deliver';

export interface ActiveBounty {
  id: string;
  /** The guild that posted it; rewards are claimed there (deliveries: at `target`). */
  town: string;
  kind: BountyKind;
  /** slay: enemy family id; gather: item id; deliver: destination town id. */
  target: string;
  count: number;
  progress: number;
  rewardGold: number;
  rewardXp: number;
  label: string;
}

/** Where the party stands inside a walkable place (a town, the wilds, the open world). */
export interface LocaleState {
  id: string;
  x: number;
  y: number;
}

/** The walk since the last stop on the travel map (see journey.ts). */
export interface RoadState {
  tiles: number;
  /** Summed hazard of those tiles: a fight comes with chance 1 - e^-danger. */
  danger: number;
  /** The same for finds. */
  luck: number;
}

export interface ExplorationMineState {
  cycle: number;
  maze: MineMazeState;
  /** Junctions on the party's map. Without a Minemap only this visit's. */
  known: number[];
}

/** Out on foot around one spot of the map (see area.ts). */
export interface AreaState {
  /** The world tile the party set out from, and comes back to. */
  tile: { x: number; y: number };
  /** Hours each member has spent on what they did here. */
  spent: Partial<Record<MageClass, number>>;
  /** World tiles either side of `tile` the walk covers; the usual area when absent. */
  radius?: number;
  /** Something spotted from the road that the party walked over to (see site.ts). */
  site?: EncounterSite;
}

export interface ExplorationRun {
  version: number;
  seed: number;
  /** Trips and searches made so far. Seeds each roll, so a reload replays the same road. */
  steps: number;
  /** The world tile the party stands on. */
  pos: { x: number; y: number };
  /** Hours into the current day, 0 <= hour < 24. */
  hour: number;
  /** Walked world tiles, packed (see explored.ts). */
  explored: string;
  /** Searches made, one `x,y:day` key each; every search of a tile today makes the next harder. */
  searched: string[];
  gold: number;
  /** The party, stored as a one-scene Scenario so it round-trips through JSON. */
  party: Scenario;
  /** Summons following the party from fight to fight until it enters a town (see coop.ts). */
  summons: Scenario | null;
  /** The party is still choosing classes, words and weapons in Kerusai. */
  creating: boolean;
  /** Secrets uncovered, wilds mapped, bosses felled. */
  flags: string[];
  /** Places the party has reached. */
  visited: string[];
  level: number;
  xp: number;
  /** The most levels any member still has to choose rewards for. */
  pendingLevels: number;
  /** The level each member has chosen rewards up to; absent means level 1. */
  levelsTaken: Partial<Record<MageClass, number>>;
  /** Turns over at midnight; shops restock and wild packs return. */
  day: number;
  /** The last town entered; a beaten party wakes up there. */
  lastTown: string;
  bounties: ActiveBounty[];
  /** Bounty ids already taken, so a board never re-offers them. */
  bountiesTaken: string[];
  /** Shop stock slots bought, keyed `shop:day:slot`. */
  purchases: string[];
  locale: LocaleState | null;
  /** Discovered chunks of the wilds, keyed `wildId:cx,cy`. */
  wildsSeen: string[];
  /** Wild enemy groups beaten, with the day they fell. */
  groupsBeaten: Record<string, number>;
  /** On foot around a spot of the map; null on the map and inside places. */
  area: AreaState | null;
  road: RoadState;
  /** Exploration Mines alone: the excavated layout until the next bloodmoon. */
  mines: ExplorationMineState | null;
  /** Bloodmoons the party has fought through (see bloodmoon.ts). */
  bloodmoons: number;
  /** Things crafted so far; seeds each bench roll, so no two crafts roll alike. */
  crafts: number;
  /** The runes the party has learned and the example sheets it has bought. */
  hexLore: HexLore;
}

export function createRun(seed: number, party: Scenario, options: { creating?: boolean } = {}): ExplorationRun {
  const start = placeById(START_PLACE)!;
  const explored = unpackExplored('');
  revealTiles(explored, [start], 4);
  return {
    version: EXPLORATION_VERSION,
    seed: seed >>> 0,
    steps: 0,
    pos: { x: start.x, y: start.y },
    hour: START_HOUR,
    explored: packExplored(explored),
    searched: [],
    gold: Math.round(START_PURSE * Math.max(1, party.entities.length) * 10) / 10,
    party,
    summons: null,
    creating: options.creating ?? false,
    flags: [],
    visited: [START_PLACE],
    level: 1,
    xp: 0,
    pendingLevels: 0,
    levelsTaken: {},
    day: 1,
    lastTown: START_PLACE,
    bounties: [],
    bountiesTaken: [],
    purchases: [],
    locale: null,
    wildsSeen: [],
    groupsBeaten: {},
    area: null,
    road: { tiles: 0, danger: 0, luck: 0 },
    mines: null,
    bloodmoons: 0,
    crafts: 0,
    hexLore: emptyHexLore(),
  };
}

/**
 * Fold a seed and a step into one deterministic value. Deriving a fresh Dice per
 * roll beats carrying PRNG state through a save file.
 */
function mix(seed: number, step: number): number {
  let h = (seed ^ Math.imul(step + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** The dice for one numbered step of a run. Same run, same step, same rolls. */
export function stepDice(run: ExplorationRun, step: number): Dice {
  return new Dice(mix(run.seed, step));
}

export function hasFlag(run: ExplorationRun, id: string): boolean {
  return run.flags.includes(id);
}
