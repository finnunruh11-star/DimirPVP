// On foot around one spot of the map. The travel map is how the party gets about;
// from any tile of it the travellers can set out on foot across the country round
// them, each free to go their own way. Walking costs no time here. What they do
// does, on each traveller's own count, and the party's clock follows whoever has
// spent the most: the others lose the difference. Pure: no Phaser.

import type { MageClass } from '../../core/Classes';
import type { Cell } from '../../world/pathfind';
import { advanceHours } from './clock';
import type { AreaState, ExplorationRun } from './run';
import { WORLD_H, WORLD_W } from './world';

/** World tiles either side of the tile the party set out from. */
export const AREA_RADIUS = 2;

/** Hours each thing done on foot costs whoever does it. */
export const AREA_HOURS = {
  fight: 1,
  pickup: 0.5,
  search: 1,
} as const;

/** The world tiles an area spans, first and last across and down, inclusive. */
export interface AreaBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function areaBounds(center: Cell, radius: number = AREA_RADIUS): AreaBounds {
  return {
    x0: Math.max(0, center.x - radius),
    y0: Math.max(0, center.y - radius),
    x1: Math.min(WORLD_W - 1, center.x + radius),
    y1: Math.min(WORLD_H - 1, center.y + radius),
  };
}

/** The tiles an area on foot covers, at its own size. */
export function areaBoundsOf(area: AreaState): AreaBounds {
  return areaBounds(area.tile, area.radius ?? AREA_RADIUS);
}

export function inAreaBounds(bounds: AreaBounds, tile: Cell): boolean {
  return tile.x >= bounds.x0 && tile.x <= bounds.x1 && tile.y >= bounds.y0 && tile.y <= bounds.y1;
}

/** Set out on foot from the tile the party stands on. */
export function enterArea(run: ExplorationRun): AreaState {
  const area: AreaState = { tile: { ...run.pos }, spent: {} };
  run.area = area;
  return area;
}

/** Back to the map, on the tile the party set out from. Returns the hours the party spent. */
export function leaveArea(run: ExplorationRun): number {
  const area = run.area;
  if (!area) return 0;
  run.pos = { ...area.tile };
  run.area = null;
  return areaHours(area);
}

/** Hours the party has spent here: as long as its slowest traveller. */
export function areaHours(area: AreaState): number {
  return Math.max(0, ...Object.values(area.spent).map((hours) => hours ?? 0));
}

/** Who has spent the most time here, and how much. */
export function areaLead(area: AreaState): { member: MageClass; hours: number } | null {
  let lead: { member: MageClass; hours: number } | null = null;
  for (const [member, hours] of Object.entries(area.spent) as [MageClass, number | undefined][]) {
    if (hours && (!lead || hours > lead.hours)) lead = { member, hours };
  }
  return lead;
}

/**
 * `members` spent `hours` on something. The clock only moves on as far as the
 * slowest traveller has now got ahead of it. Returns the midnights that passed.
 */
export function spendAreaTime(run: ExplorationRun, members: readonly MageClass[], hours: number): number {
  const area = run.area;
  if (!area || hours <= 0 || members.length === 0) return 0;
  const before = areaHours(area);
  for (const member of new Set(members)) area.spent[member] = (area.spent[member] ?? 0) + hours;
  return advanceHours(run, areaHours(area) - before);
}
