// Exploration run state. No `Math.random` anywhere: every roll derives from the
// run's seed plus the step that triggered it, so a reload reproduces it exactly.

import { Dice } from '../../core/Dice';
import type { Scenario } from '../../core/Scenario';
import { START_HOUR } from './clock';
import { packExplored, revealTiles, unpackExplored } from './explored';
import { placeById, START_PLACE } from './world';

export const EXPLORATION_VERSION = 4;

/** How the world is crossed: planned trips on the map, or on foot like the wilds. */
export type MapStyle = 'travel' | 'open';

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

/** Where the party stands inside a walkable place (town, forest glade, wilds). */
export interface LocaleState {
  id: string;
  x: number;
  y: number;
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
  /** Tiles already searched, keyed `x,y:day`, so an area yields once a day. */
  searched: string[];
  gold: number;
  /** The party, stored as a one-scene Scenario so it round-trips through JSON. */
  party: Scenario;
  /** Secrets uncovered, wilds mapped, bosses felled. */
  flags: string[];
  /** Places the party has reached. */
  visited: string[];
  level: number;
  xp: number;
  /** Levels earned outside a fight whose rewards are still to be chosen. */
  pendingLevels: number;
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
  forest: { depth: number; deepest: number };
  /** Discovered chunks of the wilds, keyed `wildId:cx,cy`. */
  wildsSeen: string[];
  /** Wild enemy groups beaten, with the day they fell. */
  groupsBeaten: Record<string, number>;
  mapStyle: MapStyle;
}

export function createRun(seed: number, party: Scenario): ExplorationRun {
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
    gold: 0,
    party,
    flags: [],
    visited: [START_PLACE],
    level: 1,
    xp: 0,
    pendingLevels: 0,
    day: 1,
    lastTown: START_PLACE,
    bounties: [],
    bountiesTaken: [],
    purchases: [],
    locale: null,
    forest: { depth: 0, deepest: 0 },
    wildsSeen: [],
    groupsBeaten: {},
    mapStyle: 'travel',
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
