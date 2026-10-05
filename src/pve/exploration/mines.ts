import { Dice } from '../../core/Dice';
import { createMineMaze, parseMineMaze, type MineDirection, type MineMazeState } from '../mineMaze';
import { advanceHours } from './clock';
import { bloodmoonCycle } from './bloodmoon';
import type { ExplorationMineState, ExplorationRun } from './run';

/** Each bloodmoon reshapes the Mines. */
export function mineCycle(day: number): number {
  return bloodmoonCycle(day);
}

export function mineSeed(seed: number, cycle: number, node = 0, direction = ''): number {
  let value = (seed ^ Math.imul(cycle + 1, 0x9e3779b1) ^ Math.imul(node + 1, 0x85ebca6b)) >>> 0;
  for (let index = 0; index < direction.length; index++) value = Math.imul(value ^ direction.charCodeAt(index), 16777619) >>> 0;
  return value;
}

/**
 * Generate a new cycle or return the old mined-out layout, always at the entrance.
 * The layout stays until the bloodmoon; the party's map of it only with a Minemap
 * (`remember`): otherwise each visit starts from the entrance alone.
 */
export function enterMines(run: ExplorationRun, remember = false): MineMazeState {
  const cycle = mineCycle(run.day);
  if (!run.mines || run.mines.cycle !== cycle) {
    run.mines = { cycle, maze: createMineMaze(new Dice(mineSeed(run.seed, cycle)), { shops: false }), known: [0] };
  } else if (!remember) {
    run.mines.known = [0];
  }
  // Mines dug before tunnels varied in length take this cycle's lengths now.
  run.mines.maze.layoutSeed ??= mineSeed(run.seed, cycle, 0, 'layout');
  run.mines.maze.currentNodeId = 0;
  run.mines.maze.arrivedVia = undefined;
  return run.mines.maze;
}

/** The party has walked to junction `id`: it goes on the map. */
export function markMineKnown(run: ExplorationRun, id: number): void {
  if (run.mines && !run.mines.known.includes(id)) run.mines.known.push(id);
}

export function minePassageDice(run: ExplorationRun, node: number, direction: MineDirection): Dice {
  return new Dice(mineSeed(run.seed, run.mines?.cycle ?? mineCycle(run.day), node, direction));
}

/** The maze collapses if time spent under it carries the party into a new bloodmoon cycle. */
export function spendMineHours(run: ExplorationRun, hours: number): boolean {
  const before = mineCycle(run.day);
  advanceHours(run, hours);
  return mineCycle(run.day) !== before;
}

export function parseExplorationMines(value: unknown): ExplorationMineState | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (typeof data.cycle !== 'number' || !Number.isInteger(data.cycle) || data.cycle < 0 || data.cycle > 50_000) return null;
  const maze = parseMineMaze(data.maze);
  if (!maze) return null;
  // Saves from before the Minemap knew every junction they had dug out.
  const ids = Object.keys(maze.nodes).map(Number);
  const known = Array.isArray(data.known)
    ? [...new Set(data.known.filter((id): id is number => typeof id === 'number' && ids.includes(id)))]
    : ids;
  if (!known.includes(0)) known.unshift(0);
  return { cycle: data.cycle, maze, known };
}