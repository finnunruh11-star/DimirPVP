// Withdrawing from a fight. A body pressed against the edge of the field can
// spend a turn slipping away; the border it leaves by decides where it comes out
// on the far side, which is what makes running in a chosen direction meaningful.

import { FIELD, RANGE_UNIT } from '../config/constants';
import type { Vec2 } from './utils';

export type FleeEdge = 'north' | 'south' | 'east' | 'west';

/** How close to a border a body must stand before it can slip off the field. */
export const FLEE_EDGE_MARGIN = RANGE_UNIT * 2;

export const FLEE_EDGE_LABEL: Record<FleeEdge, string> = {
  north: 'north',
  south: 'south',
  east: 'east',
  west: 'west',
};

/** Which border a body is pressed against, or null if it stands in the open. */
export function fleeEdgeAt(at: Vec2): FleeEdge | null {
  const gaps: { edge: FleeEdge; gap: number }[] = [
    { edge: 'west', gap: at.x - FIELD.x },
    { edge: 'east', gap: FIELD.x + FIELD.w - at.x },
    { edge: 'north', gap: at.y - FIELD.y },
    { edge: 'south', gap: FIELD.y + FIELD.h - at.y },
  ];
  const nearest = gaps.reduce((best, candidate) => (candidate.gap < best.gap ? candidate : best));
  return nearest.gap <= FLEE_EDGE_MARGIN ? nearest.edge : null;
}
