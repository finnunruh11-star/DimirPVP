// Exploration run state and the single funnel every change to it passes through.
//
// Two rules keep this mode ready for multiplayer without paying for it yet:
//   1. Nothing mutates a run except `applyExplorationCommand`. Relaying those
//      commands is all lockstep will need.
//   2. No `Math.random`. Every roll derives from the run's seed plus the step
//      that triggered it, so a reload — or a second peer — reproduces it exactly.

import { Dice } from '../../core/Dice';
import type { Scenario } from '../../core/Scenario';
import {
  canTravel,
  createWorld,
  nodeAt,
  rollPathEncounter,
  START_NODE,
  type PathEncounter,
  type WorldMap,
  type WorldNode,
} from './world';

export const EXPLORATION_VERSION = 1;

export interface ExplorationRun {
  version: number;
  seed: number;
  /** Travels taken so far. Seeds each roll, so a reload replays the same road. */
  steps: number;
  nodeId: string;
  gold: number;
  /** The party, stored as a one-scene Scenario so it round-trips through JSON. */
  party: Scenario;
  /** Secrets uncovered, wilds mapped, bosses felled. */
  flags: string[];
  visited: string[];
}

export type ExplorationCommand =
  | { t: 'travel'; to: string }
  | { t: 'enter' }
  | { t: 'flag'; id: string }
  | { t: 'spend'; gold: number }
  | { t: 'earn'; gold: number };

/** What travelling produced, for the scene to act on. */
export interface TravelOutcome {
  node: WorldNode;
  encounter: PathEncounter;
  /** Enemy strength for this fight, when there is one. */
  depth: number;
}

export function createRun(seed: number, party: Scenario): ExplorationRun {
  return {
    version: EXPLORATION_VERSION,
    seed: seed >>> 0,
    steps: 0,
    nodeId: START_NODE,
    gold: 0,
    party,
    flags: [],
    visited: [START_NODE],
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

export function currentNode(run: ExplorationRun, world: WorldMap = createWorld()): WorldNode {
  return nodeAt(world, run.nodeId);
}

export function hasFlag(run: ExplorationRun, id: string): boolean {
  return run.flags.includes(id);
}

/**
 * The only way a run changes. Returns a travel outcome when the command moved
 * the party onto a road that had something waiting on it.
 */
export function applyExplorationCommand(
  run: ExplorationRun,
  cmd: ExplorationCommand,
  world: WorldMap = createWorld(),
): TravelOutcome | null {
  switch (cmd.t) {
    case 'travel': {
      if (!canTravel(world, run.nodeId, cmd.to)) return null;
      const node = nodeAt(world, cmd.to);
      run.steps += 1;
      run.nodeId = node.id;
      if (!run.visited.includes(node.id)) run.visited.push(node.id);
      // Only roads are dangerous to walk; everywhere else is arrived at safely.
      const encounter: PathEncounter =
        node.kind === 'path' ? rollPathEncounter(stepDice(run, run.steps).float()) : 'nothing';
      return { node, encounter, depth: node.depth };
    }
    case 'flag':
      if (!run.flags.includes(cmd.id)) run.flags.push(cmd.id);
      return null;
    case 'spend':
      run.gold = Math.max(0, run.gold - Math.max(0, cmd.gold));
      return null;
    case 'earn':
      run.gold += Math.max(0, cmd.gold);
      return null;
    case 'enter':
      return null;
  }
}

/**
 * Where a fight on a road spits you out when you break off. Running back the way
 * you came returns you to the last node; running on skips the encounter and puts
 * you through. Any other border leaves you where you stood.
 */
export function fleeDestination(
  run: ExplorationRun,
  cameFrom: string | null,
  edge: 'north' | 'south' | 'east' | 'west',
  world: WorldMap = createWorld(),
): string {
  const node = nodeAt(world, run.nodeId);
  if (node.kind !== 'path') return run.nodeId;
  if (edge === 'west') return cameFrom && canTravel(world, node.id, cameFrom) ? cameFrom : run.nodeId;
  if (edge === 'east') {
    const onward = node.links.find((id) => id !== cameFrom);
    return onward ?? run.nodeId;
  }
  return run.nodeId;
}
