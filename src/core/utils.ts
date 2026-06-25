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
