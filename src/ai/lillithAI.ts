// How Lillith Belvus and her copies fight. She picks a player and stays on them,
// turning only when another player has dealt and mended far more than her prey
// since her last turn, and never strikes the one she holds. She walks up to
// strike from the side least crowded by her own and out of the others' reach;
// with her prey beyond her stride she strikes whoever is in reach instead. Her
// copies fight just the same; her orbs do nothing. Deterministic.

import { RANGE_UNIT } from '../config/constants';
import type { GameState } from '../core/GameState';
import type { Mage } from '../core/Mage';
import { dist } from '../core/utils';
import { lillithOutweighs } from '../pve/lillith';
import type { AIDecision } from './SimpleAI';
import { best, closeIn, foesOf, nearestTo, reachOf, strikeSpot } from './tactics';

const U = RANGE_UNIT;

function output(game: GameState, m: Mage): number {
  return game.lillithOutput.get(m) ?? 0;
}

/** Whom she is after: her last prey, unless another player now puts out far more. */
export function lillithPrey(game: GameState, self: Mage): Mage | undefined {
  const state = self.lillith ?? self.lillithCopy;
  const open = foesOf(game, self).filter((f) => !f.lillithBound);
  const players = open.filter((f) => !f.isSummon);
  const pool = players.length ? players : open;
  if (!pool.length) return undefined;
  const loudest = best(pool, (f) => output(game, f) * 1000 - dist(self.pos, f.pos) / U);
  let prey = state?.prey && pool.includes(state.prey) ? state.prey : undefined;
  if (!prey) prey = output(game, loudest) > 0 ? loudest : nearestTo(self.pos, pool)!;
  else if (prey !== loudest && lillithOutweighs(output(game, loudest), output(game, prey))) prey = loudest;
  if (state) state.prey = prey;
  return prey;
}

export function chooseLillithAction(game: GameState, self: Mage): AIDecision {
  if (self.inert) return { type: 'end' };
  const prey = lillithPrey(game, self);
  const acts = self.actions;
  if (!prey || acts.main <= 0) return { type: 'end' };
  if (game.canMelee(self, prey)) return { type: 'melee', target: prey };
  const foes = foesOf(game, self);
  const band = game.mages.filter((m) => m.alive && m !== self && m.team === self.team && !m.inert);
  if (acts.move > 0 && game.canStrikeAirborne(self, prey) && dist(self.pos, prey.pos) - reachOf(self) <= self.moveRange()) {
    const spot = strikeSpot(self, prey, foes, band);
    if (spot) return { type: 'move', point: spot.point };
  }
  const near = foes.filter((f) => !f.lillithBound && game.canMelee(self, f));
  if (near.length) return { type: 'melee', target: best(near, (f) => output(game, f) * 1000 - dist(self.pos, f.pos) / U) };
  if (acts.move > 0) return closeIn(self, prey);
  return { type: 'end' };
}
