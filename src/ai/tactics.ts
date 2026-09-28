// Moves shared by the bosses' own AIs: who is a foe, how far a blow reaches,
// where to stand to land one. Deterministic: ties keep the earliest entry.

import { FIELD, MELEE_RANGE, RANGE_UNIT } from '../config/constants';
import type { GameState } from '../core/GameState';
import type { Mage } from '../core/Mage';
import { dist, stepTowards, type Vec2 } from '../core/utils';
import type { AIDecision } from './SimpleAI';

const U = RANGE_UNIT;
const TAU = Math.PI * 2;
const MARGIN = 26;

export function foesOf(game: GameState, self: Mage): Mage[] {
  return game.livingEnemiesOf(self).filter((m) => !game.isUntargetable(m, self));
}

export function reachOf(m: Mage): number {
  return m.activeWeapon()?.rangePx ?? m.intrinsicMeleeReach ?? MELEE_RANGE;
}

/** The most one blow of `m`'s can do. */
export function maxHit(m: Mage): number {
  const spec = m.intrinsicMelee?.spec ?? '0';
  const dice = /^(\d+)d(\d+)([+-]\d+)?$/.exec(spec);
  const raw = dice ? Number(dice[1]) * Number(dice[2]) + Number(dice[3] ?? 0) : Number(spec) || 0;
  return Math.round(raw * m.damageScale);
}

/** The highest scoring entry; ties keep the earliest, so every peer picks the same. */
export function best<T>(list: readonly T[], score: (entry: T) => number): T {
  let top = list[0];
  let topScore = score(top);
  for (let i = 1; i < list.length; i++) {
    const value = score(list[i]);
    if (value > topScore) {
      top = list[i];
      topScore = value;
    }
  }
  return top;
}

export function nearestTo(at: Vec2, list: readonly Mage[]): Mage | undefined {
  return list.length ? best(list, (m) => -dist(at, m.pos)) : undefined;
}

export function closestGap(at: Vec2, list: readonly Mage[]): number {
  return list.reduce((gap, m) => Math.min(gap, dist(at, m.pos)), Infinity);
}

export function inField(p: Vec2, margin = MARGIN): Vec2 {
  return {
    x: Math.min(FIELD.x + FIELD.w - margin, Math.max(FIELD.x + margin, p.x)),
    y: Math.min(FIELD.y + FIELD.h - margin, Math.max(FIELD.y + margin, p.y)),
  };
}

export function segmentGap(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** A straight walk from `a` to `b` that no foe's body stands across. */
export function clearPath(a: Vec2, b: Vec2, self: Mage, blockers: readonly Mage[]): boolean {
  return blockers.every((m) => segmentGap(m.pos, a, b) >= self.bodyRadius() + m.bodyRadius() - 2);
}

/**
 * The best foe to walk up to and strike this turn, and where to stand: within
 * reach, round the side the rest of the band is not already on, and out of the
 * reach of the target's friends. `haste` weighs how much the walk counts against it.
 */
export function bestStrikeMove(game: GameState, self: Mage, foes: readonly Mage[], band: readonly Mage[], worth: (f: Mage) => number, haste: number): AIDecision | null {
  if (self.actions.move <= 0) return null;
  let pick: { point: Vec2; score: number } | null = null;
  for (const f of foes) {
    if (!game.canStrikeAirborne(self, f) || dist(self.pos, f.pos) - reachOf(self) > self.moveRange()) continue;
    const spot = strikeSpot(self, f, foes, band);
    if (!spot) continue;
    const score = worth(f) - (dist(self.pos, spot.point) / U) * haste + spot.score;
    if (!pick || score > pick.score) pick = { point: spot.point, score };
  }
  return pick ? { type: 'move', point: pick.point } : null;
}

export function strikeSpot(self: Mage, target: Mage, foes: readonly Mage[], band: readonly Mage[]): { point: Vec2; score: number } | null {
  const reach = reachOf(self);
  const budget = self.moveRange();
  const stand = Math.max(self.bodyRadius() + target.bodyRadius() + 4, Math.min(reach - 8, reach * 0.8));
  let found: { point: Vec2; score: number } | null = null;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU;
    const point = inField({ x: target.x + Math.cos(a) * stand, y: target.y + Math.sin(a) * stand });
    if (dist(point, target.pos) > reach - 2) continue;
    const travel = dist(self.pos, point);
    if (travel > budget - 1) continue;
    if (!clearPath(self.pos, point, self, foes.filter((f) => f !== target)) || segmentGap(target.pos, self.pos, point) < self.bodyRadius() + target.bodyRadius() - 2) continue;
    const crowd = band.reduce((sum, m) => sum + Math.max(0, 2.5 * U - dist(point, m.pos)), 0) / U;
    const exposure = foes.filter((f) => f !== target && dist(point, f.pos) <= reachOf(f) + 6).length;
    const score = -travel / U - crowd * 1.5 - exposure * 2;
    if (!found || score > found.score) found = { point, score };
  }
  return found;
}

/** Walk straight at `target`, stopping just short of reach. */
export function closeIn(self: Mage, target: Mage): AIDecision {
  const gap = dist(self.pos, target.pos) - (reachOf(self) - 6);
  if (gap <= 6) return { type: 'end' };
  return { type: 'move', point: inField(stepTowards(self.pos, target.pos, Math.min(self.moveRange(), gap))) };
}
