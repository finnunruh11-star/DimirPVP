// How long the tunnels of the Mines are. The maze is dug on a grid, but its
// columns and rows stand unevenly apart: each gap between two neighbouring grid
// lines has its own length, from a third of a standard tunnel to twice one. The
// grid only stretches and never folds, so every passage keeps its neighbours and
// no two tunnels can cross: the maze, its rules and its saves stay as they were;
// only the distances (and the time they take to walk) change.
// Pure: no Phaser, no RNG state.

import { MINE_DIRECTION_VECTOR, type MineDirection, type MineMazeState } from './mineMaze';

/** The shortest and the longest tunnel, in standard tunnels. */
export const MINE_TUNNEL_SHORTEST = 1 / 3;
export const MINE_TUNNEL_LONGEST = 2;
/** Hours to walk a standard tunnel: ten of them take half an hour. */
export const MINE_TUNNEL_HOURS = 0.05;

export type MineAxis = 'x' | 'y';
type Layout = Pick<MineMazeState, 'layoutSeed'>;

/** A well-mixed hash of (seed, axis, index) as a fraction in [0, 1). */
function mix(seed: number, axis: MineAxis, index: number): number {
  let h = (seed ^ Math.imul(axis === 'x' ? 0x27d4eb2f : 0x165667b1, index + 0x9e37)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

/**
 * The gap between grid lines `index` and `index + 1`, in standard tunnels: half
 * of them shorter than a standard tunnel, half longer. Without a seed, every gap
 * is a standard tunnel.
 */
export function mineGap(seed: number | undefined, axis: MineAxis, index: number): number {
  if (seed === undefined) return 1;
  const u = mix(seed, axis, index);
  return u < 0.5
    ? MINE_TUNNEL_SHORTEST + (1 - MINE_TUNNEL_SHORTEST) * (u / 0.5)
    : 1 + (MINE_TUNNEL_LONGEST - 1) * ((u - 0.5) / 0.5);
}

/** Where grid line `index` lies along an axis, in standard tunnels from line 0. */
export function mineLine(seed: number | undefined, axis: MineAxis, index: number): number {
  let at = 0;
  for (let i = 0; i < index; i++) at += mineGap(seed, axis, i);
  for (let i = index; i < 0; i++) at -= mineGap(seed, axis, i);
  return at;
}

/** Where junction (mapX, mapY) lies once the grid is stretched, in standard tunnels. */
export function mineNodePoint(maze: Layout, mapX: number, mapY: number): { x: number; y: number } {
  return { x: mineLine(maze.layoutSeed, 'x', mapX), y: mineLine(maze.layoutSeed, 'y', mapY) };
}

/**
 * How long the tunnel out of (mapX, mapY) towards `direction` is, against a
 * standard tunnel of its kind (a diagonal against a standard diagonal): always
 * between a third and twice. The same from either end.
 */
export function mineTunnelLength(maze: Layout, from: { mapX: number; mapY: number }, direction: MineDirection): number {
  const vector = MINE_DIRECTION_VECTOR[direction];
  const seed = maze.layoutSeed;
  const across = vector.x ? mineGap(seed, 'x', vector.x > 0 ? from.mapX : from.mapX - 1) : 0;
  const down = vector.y ? mineGap(seed, 'y', vector.y > 0 ? from.mapY : from.mapY - 1) : 0;
  return vector.x && vector.y ? Math.hypot(across, down) / Math.SQRT2 : across + down;
}

/** Hours to walk that tunnel, to the whole minute: 1 to 6 minutes. */
export function mineTunnelHours(maze: Layout, from: { mapX: number; mapY: number }, direction: MineDirection): number {
  return Math.max(1, Math.round(mineTunnelLength(maze, from, direction) * MINE_TUNNEL_HOURS * 60)) / 60;
}
