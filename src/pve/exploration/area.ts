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

const EPSILON = 1e-6;

/** Hours `member` has spent here. */
export const memberHours = (area: AreaState, member: MageClass): number => area.spent[member] ?? 0;

/** Everyone in `members` has spent the same time here: only then may the party move on. */
export function areaInStep(area: AreaState, members: readonly MageClass[]): boolean {
  const hours = members.map((member) => memberHours(area, member));
  return hours.every((value) => Math.abs(value - hours[0]) < EPSILON);
}

/** Hours `member` is behind whoever has spent the most here (0 for the one in front). */
export function hoursBehind(area: AreaState, member: MageClass): number {
  return Math.max(0, areaHours(area) - memberHours(area, member));
}

/**
 * `member` does nothing for a while: catches up with whoever is furthest ahead,
 * or, being in front already, lets `step` hours go by. Returns the hours waited
 * and the midnights that passed.
 */
export function waitInArea(run: ExplorationRun, member: MageClass, step = 0.5): { hours: number; days: number } {
  const area = run.area;
  if (!area) return { hours: 0, days: 0 };
  const behind = hoursBehind(area, member);
  const hours = behind > EPSILON ? behind : step;
  return { hours, days: spendAreaTime(run, [member], hours) };
}

/**
 * `members` rest together for `hours`. The rest starts once the last of them has
 * sat down (the latest of their times), so they all get up at the same time:
 * `until`, on the area's count. Returns it and the midnights that passed.
 */
export function restTogether(run: ExplorationRun, members: readonly MageClass[], hours: number): { until: number; days: number } {
  const area = run.area;
  if (!area || members.length === 0) return { until: 0, days: 0 };
  const before = areaHours(area);
  const until = Math.max(...members.map((member) => memberHours(area, member))) + hours;
  for (const member of members) area.spent[member] = until;
  return { until, days: advanceHours(run, areaHours(area) - before) };
}

/** A rest that lasts until `until` is over once one of `others` has lived that far (at once, if nobody kept going). */
export function restOver(area: AreaState, others: readonly MageClass[], until: number): boolean {
  return others.length === 0 || Math.max(...others.map((member) => memberHours(area, member))) >= until - EPSILON;
}

/** "30m" or "1:30h". */
export function gapLabel(hours: number): string {
  const minutes = Math.round(Math.abs(hours) * 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}h`;
}
