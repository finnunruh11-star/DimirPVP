export interface Vec2 {
  x: number;
  y: number;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Move `from` towards `to`, but never further than `maxDist`. */
export function stepTowards(from: Vec2, to: Vec2, maxDist: number): Vec2 {
  const d = dist(from, to);
  if (d <= maxDist || d === 0) return { x: to.x, y: to.y };
  const t = maxDist / d;
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/** Earliest normalized point (0..1) where a segment touches a circle. */
export function segmentCircleFirstIntersection(
  start: Vec2,
  end: Vec2,
  center: Vec2,
  radius: number
): number | null {
  const sx = start.x - center.x;
  const sy = start.y - center.y;
  if (sx * sx + sy * sy <= radius * radius) return 0;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const a = dx * dx + dy * dy;
  if (a <= Number.EPSILON) return null;
  const b = 2 * (sx * dx + sy * dy);
  const c = sx * sx + sy * sy - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const first = (-b - root) / (2 * a);
  const second = (-b + root) / (2 * a);
  if (first >= 0 && first <= 1) return first;
  if (second >= 0 && second <= 1) return second;
  return null;
}

export function segmentIntersectsCircle(
  start: Vec2,
  end: Vec2,
  center: Vec2,
  radius: number
): boolean {
  return segmentCircleFirstIntersection(start, end, center, radius) != null;
}
