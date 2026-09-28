// How Baral's side fights. Baral goes for whichever player has the least health
// and, when he cannot reach them this turn, or has already struck, gets away
// behind his works. His drakes go for the closest player. Artifacts do nothing
// at all. Deterministic: every peer decides the same.

import { RANGE_UNIT } from '../config/constants';
import type { GameState } from '../core/GameState';
import type { Mage } from '../core/Mage';
import { dist, type Vec2 } from '../core/utils';
import type { AIDecision } from './SimpleAI';
import { best, clearPath, closeIn, closestGap, foesOf, inField, nearestTo, reachOf, segmentGap, strikeSpot } from './tactics';

const U = RANGE_UNIT;
const TAU = Math.PI * 2;

export function chooseBaralAction(game: GameState, self: Mage): AIDecision {
  if (self.inert) return { type: 'end' };
  return self.enemyKind === 'baralDrake' ? drakeTurn(game, self) : baralTurn(game, self);
}

/** The player with the least health; the nearer of two alike. */
export function baralPrey(game: GameState, self: Mage): Mage | undefined {
  const foes = foesOf(game, self);
  const players = foes.filter((f) => !f.isSummon);
  const pool = players.length ? players : foes;
  return pool.length ? best(pool, (f) => -f.hp * 1000 - dist(self.pos, f.pos) / U) : undefined;
}

function baralTurn(game: GameState, self: Mage): AIDecision {
  const foes = foesOf(game, self);
  const acts = self.actions;
  if (!foes.length) return { type: 'end' };
  const prey = baralPrey(game, self)!;
  if (acts.main > 0) {
    if (game.canMelee(self, prey)) return { type: 'melee', target: prey };
    if (acts.move > 0 && game.canStrikeAirborne(self, prey) && dist(self.pos, prey.pos) - reachOf(self) <= self.moveRange()) {
      const spot = strikeSpot(self, prey, foes, []);
      if (spot) return { type: 'move', point: spot.point };
    }
  }
  if (acts.move <= 0) return { type: 'end' };
  const spot = hideSpot(game, self, foes);
  return spot ? { type: 'move', point: spot } : { type: 'end' };
}

/** As far from the party as the walk allows, the more foes with one of his works in their way the better. */
export function hideSpot(game: GameState, self: Mage, foes: readonly Mage[]): Vec2 | null {
  const budget = self.moveRange();
  const cover = game.mages.filter((m) => m.alive && m !== self && m.team === self.team);
  const score = (spot: Vec2): number => {
    const screened = foes.filter((f) =>
      cover.some((c) => dist(c.pos, f.pos) < dist(spot, f.pos) && segmentGap(c.pos, f.pos, spot) < c.bodyRadius() + self.bodyRadius())
    ).length;
    return closestGap(spot, foes) / U + screened * 2;
  };
  const here = score(self.pos);
  let found: { point: Vec2; score: number } | null = null;
  for (let k = 0; k < 32; k++) {
    for (const share of [1, 0.66, 0.33]) {
      const a = (k / 32) * TAU;
      const point = inField({ x: self.x + Math.cos(a) * budget * share, y: self.y + Math.sin(a) * budget * share });
      if (!clearPath(self.pos, point, self, foes)) continue;
      const value = score(point);
      if (!found || value > found.score) found = { point, score: value };
    }
  }
  return found && found.score > here + 0.25 && dist(found.point, self.pos) >= 8 ? found.point : null;
}

function drakeTurn(game: GameState, self: Mage): AIDecision {
  const foes = foesOf(game, self);
  const acts = self.actions;
  const players = foes.filter((f) => !f.isSummon);
  const prey = nearestTo(self.pos, players.length ? players : foes);
  if (!prey) return { type: 'end' };
  if (acts.main > 0 && game.canMelee(self, prey)) return { type: 'melee', target: prey };
  if (acts.move <= 0 || acts.main <= 0) return { type: 'end' };
  const spot = game.canStrikeAirborne(self, prey) ? strikeSpot(self, prey, foes, []) : null;
  return spot ? { type: 'move', point: spot.point } : closeIn(self, prey);
}
