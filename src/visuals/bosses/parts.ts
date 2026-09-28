// Body parts the bosses are assembled from: two-bone limbs posed by where the
// hand or foot should be, cloth that ripples along its hem, blades with a lit
// edge, glowing eyes. Pure: no Phaser.

import { Canvas, clamp01, lerp, lit, TAU, type Knot, type Pt, type Ramp } from './raster';

/** Where the elbow (or knee) sits for a limb from `root` reaching for `tip`; `bend` picks the side. */
export function ik(root: Pt, tip: Pt, upper: number, lower: number, bend: 1 | -1): { joint: Pt; tip: Pt } {
  const dx = tip[0] - root[0];
  const dy = tip[1] - root[1];
  const reach = Math.min(upper + lower - 0.01, Math.max(Math.abs(upper - lower) + 0.01, Math.hypot(dx, dy)));
  const angle = Math.atan2(dy, dx);
  const cos = Math.max(-1, Math.min(1, (upper * upper + reach * reach - lower * lower) / (2 * upper * reach)));
  const a = angle + bend * Math.acos(cos);
  const joint: Pt = [root[0] + Math.cos(a) * upper, root[1] + Math.sin(a) * upper];
  return { joint, tip: [root[0] + Math.cos(angle) * reach, root[1] + Math.sin(angle) * reach] };
}

/** A two-bone limb as one tube, on a layer of its own. */
export function limb(c: Canvas, root: Pt, tip: Pt, lengths: [number, number], radii: [number, number, number], skin: Ramp, bend: 1 | -1, shade = 0): Pt {
  const { joint, tip: end } = ik(root, tip, lengths[0], lengths[1], bend);
  c.layer((part) => part.tube([[root[0], root[1], radii[0]], [joint[0], joint[1], radii[1]], [end[0], end[1], radii[2]]], skin, { shade }), null, 0.5);
  return end;
}

/**
 * Cloth hanging from a top edge: `top` runs left to right, the hem is `length`
 * below it and ripples with `phase`; `sway` pushes the hem sideways.
 */
export function cloth(c: Canvas, top: readonly Pt[], length: number | readonly number[], ramp: Ramp, opts: { phase?: number; sway?: number; ripple?: number; folds?: number; shade?: number; spread?: number } = {}): void {
  const phase = opts.phase ?? 0;
  const sway = opts.sway ?? 0;
  const ripple = opts.ripple ?? 1.5;
  const lengths = typeof length === 'number' ? top.map(() => length) : length;
  const spread = opts.spread ?? 0;
  const hem: Pt[] = top.map(([x, y], i) => {
    const t = top.length > 1 ? i / (top.length - 1) : 0;
    const wave = Math.sin(phase + t * 5.2) * ripple;
    return [x + sway + (t - 0.5) * spread + Math.cos(phase * 0.7 + t * 3) * ripple * 0.4, y + lengths[i] + wave];
  });
  const points: Pt[] = [...top, ...[...hem].reverse()];
  const x0 = Math.min(...points.map((p) => p[0]));
  const x1 = Math.max(...points.map((p) => p[0]));
  const y0 = Math.min(...points.map((p) => p[1]));
  const y1 = Math.max(...points.map((p) => p[1]));
  const folds = opts.folds ?? 3;
  c.poly(points, ramp, (x, y) => {
    const u = (x - x0) / Math.max(1, x1 - x0);
    const v = (y - y0) / Math.max(1, y1 - y0);
    const fold = Math.sin(u * folds * TAU + phase * 0.5 + v * 1.4) * 0.16;
    return 0.66 - u * 0.24 - v * 0.2 + fold + (opts.shade ?? 0);
  });
}

/** A straight blade from `hilt` along `angle`, lit along its spine, with a crossguard. */
export function blade(c: Canvas, hilt: Pt, angle: number, length: number, width: number, steel: Ramp, opts: { guard?: Ramp; guardWidth?: number; curve?: number; glow?: number } = {}): void {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const nx = -dy;
  const ny = dx;
  const curve = opts.curve ?? 0;
  const steps = 8;
  const spineA: Pt[] = [];
  const spineB: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const w = width * (t < 0.82 ? 1 : lerp(1, 0.05, (t - 0.82) / 0.18)) * 0.5;
    const bow = curve * Math.sin(t * Math.PI) * length * 0.12;
    const x = hilt[0] + dx * length * t + nx * bow;
    const y = hilt[1] + dy * length * t + ny * bow;
    spineA.push([x + nx * w, y + ny * w]);
    spineB.push([x - nx * w, y - ny * w]);
  }
  c.layer((part) => {
    part.poly([...spineA, ...[...spineB].reverse()], steel, (x, y) => {
      const side = (x - hilt[0]) * nx + (y - hilt[1]) * ny;
      return 0.55 + (side < 0 ? 0.3 : -0.12) + (opts.glow ?? 0);
    });
    if (opts.guard) {
      const gw = opts.guardWidth ?? width * 2.2;
      part.tube([[hilt[0] + nx * gw, hilt[1] + ny * gw, 1.3], [hilt[0] - nx * gw, hilt[1] - ny * gw, 1.3]], opts.guard);
    }
  }, null, 0.45);
}

/** A glowing eye: a bright core with a softer ring round it. */
export function eye(c: Canvas, x: number, y: number, core: number, ring: number, size = 1): void {
  if (size >= 2) {
    c.rect(x - 1, y, size + 2, size, ring);
    c.rect(x, y - 1, size, size + 2, ring);
  } else {
    c.dot(x - 1, y, ring);
    c.dot(x + 1, y, ring);
  }
  c.rect(x, y, size, size, core);
}

/** A ring of `count` points round an ellipse, turned by `phase`: halos, summoning circles, orbits. */
export function ring(cx: number, cy: number, rx: number, ry: number, count: number, phase: number): Pt[] {
  return Array.from({ length: count }, (_, i) => {
    const a = phase + (i / count) * TAU;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry] as Pt;
  });
}

/** A lit sphere with its own edge, the commonest part of all. */
export function ball(c: Canvas, x: number, y: number, rx: number, ry: number, ramp: Ramp, shade = 0, rot = 0): void {
  c.layer((part) => part.ellipse(x, y, rx, ry, ramp, { shade, rot }), null, 0.5);
}

/** A tube with its own edge. */
export function rod(c: Canvas, knots: readonly Knot[], ramp: Ramp, shade = 0): void {
  c.layer((part) => part.tube(knots, ramp, { shade }), null, 0.5);
}

/** A flat shape with its own edge; brighter at the top. */
export function plate(c: Canvas, points: readonly Pt[], ramp: Ramp, base = 0.6, fall = 0.012): void {
  const y0 = Math.min(...points.map((p) => p[1]));
  c.layer((part) => part.poly(points, ramp, (_x, y) => base - (y - y0) * fall), null, 0.5);
}

/** Puffs of smoke or steam drifting up from `at` over the course of `t`. */
export function puffs(c: Canvas, at: Pt, t: number, count: number, ramp: Ramp, rise = 14, drift = -4): void {
  for (let k = 0; k < count; k++) {
    const life = (t + k / count) % 1;
    const r = 1.5 + life * 3.2;
    const x = at[0] + drift * life + Math.sin(life * 6 + k) * 1.5;
    const y = at[1] - rise * life;
    if (life > 0.85) continue;
    c.ellipse(x, y, r, r * 0.85, ramp, { shade: -life * 0.3 });
  }
}

export { lit };
