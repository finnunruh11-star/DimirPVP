import type { Vec2 } from './utils';

/**
 * A "reality break" zone that blocks movement. While it exists no mage may move
 * into it: a mage that runs in stops at its edge and is rooted, and a mage
 * dashing in stops at its edge (their dash/spell ends). It blocks everyone,
 * including the caster.
 *
 * Two shapes share this structure:
 *  - 'wedge' : a cone fanning out from an apex (Reality Shatter).
 *  - 'rect'  : a thin rectangular wall centred on a point (blue Wall ability).
 */
export interface BarrierZone {
  id: number;
  /** Geometry of the zone. */
  shape: 'wedge' | 'rect';
  /** Wedge apex, or rectangle centre. */
  x: number;
  y: number;
  /** Wedge facing, or rectangle orientation, in radians. */
  angle: number;
  /** Wedge: half its total arc, in radians. Ignored for rectangles. */
  halfAngle: number;
  /** Wedge: cone length. Rectangle: full length along `angle`. In pixels. */
  range: number;
  /** Rectangle: thickness across `angle`, in pixels. Ignored for wedges. */
  thickness: number;
  /** Team that created the zone (cosmetic only — it blocks everyone). */
  owner: 1 | 2;
  /** Rounds remaining before the zone collapses. */
  ttl: number;
}

/** Is `p` inside the barrier `b`? */
export function barrierContains(b: BarrierZone, p: Vec2): boolean {
  const dx = p.x - b.x;
  const dy = p.y - b.y;
  if (b.shape === 'rect') {
    // Transform the point into the rectangle's local frame and test the half
    // extents along each axis.
    const cos = Math.cos(b.angle);
    const sin = Math.sin(b.angle);
    const along = dx * cos + dy * sin;
    const across = -dx * sin + dy * cos;
    return Math.abs(along) <= b.range / 2 && Math.abs(across) <= b.thickness / 2;
  }
  const d = Math.hypot(dx, dy);
  if (d === 0 || d > b.range) return false;
  const ang = Math.atan2(dy, dx);
  let diff = Math.abs(ang - b.angle);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  return diff <= b.halfAngle;
}
