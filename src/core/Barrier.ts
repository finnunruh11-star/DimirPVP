import type { Vec2 } from './utils';

/**
 * A wedge-shaped "reality break" zone placed by Reality+Shatter. While it exists
 * no mage may move into it: a mage that runs in stops at its edge and is rooted,
 * and a mage dashing in stops at its edge (their dash/spell ends). It blocks
 * everyone, including the caster.
 */
export interface BarrierZone {
  id: number;
  /** Apex of the wedge (the caster's position at cast time). */
  x: number;
  y: number;
  /** Direction the wedge points, in radians. */
  angle: number;
  /** Half of the wedge's total arc, in radians (e.g. 45° total → ~0.3927). */
  halfAngle: number;
  /** Wedge length in pixels. */
  range: number;
  /** Team that created the zone (cosmetic only — it blocks everyone). */
  owner: 1 | 2;
  /** Rounds remaining before the zone collapses. */
  ttl: number;
}

/** Is `p` inside the wedge `b`? */
export function barrierContains(b: BarrierZone, p: Vec2): boolean {
  const dx = p.x - b.x;
  const dy = p.y - b.y;
  const d = Math.hypot(dx, dy);
  if (d === 0 || d > b.range) return false;
  const ang = Math.atan2(dy, dx);
  let diff = Math.abs(ang - b.angle);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  return diff <= b.halfAngle;
}
