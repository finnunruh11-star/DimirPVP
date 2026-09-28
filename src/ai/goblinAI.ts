// How Snazzlegob's band fights. The chief is clever but cannot resist a swing,
// and falls back to his shamans when badly hurt. Raiders gang up on one foe,
// come at it from the sides, guard the shamans, and keep near them unless a foe
// is in reach. Shamans keep as far from the party as their rites allow, mend
// whoever is hurt and hex whoever is not. With the chief dead the rest run for
// the nearest edge. Deterministic: every peer decides the same.

import { FIELD, RANGE_UNIT } from '../config/constants';
import { fleeEdgeAt } from '../core/Flee';
import type { GameState } from '../core/GameState';
import type { Mage } from '../core/Mage';
import { dist, stepTowards, type Vec2 } from '../core/utils';
import { GOBLIN_CHIEF_RETREAT, GOBLIN_MEND_HP, GOBLIN_RITE_RANGE, GOBLIN_SHAMAN_LEASH, isGoblin } from '../pve/goblins';
import type { AIDecision } from './SimpleAI';
import { best, bestStrikeMove, clearPath, closeIn, closestGap, foesOf, inField, maxHit, nearestTo, reachOf } from './tactics';

const U = RANGE_UNIT;
const TAU = Math.PI * 2;

export function chooseGoblinAction(game: GameState, self: Mage): AIDecision {
  if (self.enemyKind === 'goblinChief') return chiefTurn(game, self);
  const chief = game.mages.find((m) => m.enemyKind === 'goblinChief' && m.team === self.team && m.alive);
  if (!chief) return fleeTurn(game, self);
  return self.enemyKind === 'goblinShaman' ? shamanTurn(game, self, chief) : raiderTurn(game, self, chief);
}

// ---------------------------------------------------------------------------
//  THE CHIEF
// ---------------------------------------------------------------------------

function chiefTurn(game: GameState, self: Mage): AIDecision {
  const foes = foesOf(game, self);
  const acts = self.actions;
  if (!foes.length) return { type: 'end' };
  const band = bandOf(game, self).filter((m) => m !== self);
  const shamans = band.filter((m) => m.enemyKind === 'goblinShaman');
  const hit = maxHit(self);
  const worth = (f: Mage): number => (f.hp <= hit ? 100 : 0) + Math.max(0, 30 - f.hp) - (f.isSummon ? 10 : 0);
  // Given a blow, he takes it: the killing one first, then the weakest.
  if (acts.main > 0) {
    const inReach = foes.filter((f) => game.canMelee(self, f));
    if (inReach.length) return { type: 'melee', target: best(inReach, worth) };
    const move = bestStrikeMove(game, self, foes, band, worth, 1);
    if (move) return move;
  }
  if (acts.move <= 0) return { type: 'end' };
  // Badly hurt with nothing to hit, or already struck: back to the shamans to be mended.
  if (self.hp <= self.maxHp * GOBLIN_CHIEF_RETREAT && shamans.length) {
    const spot = fallBack(self, nearestTo(self.pos, shamans)!, foes);
    return spot ? { type: 'move', point: spot } : { type: 'end' };
  }
  if (acts.main <= 0) return { type: 'end' };
  const target = best(foes, (f) => worth(f) - dist(self.pos, f.pos) / U);
  return closeIn(self, target);
}

// ---------------------------------------------------------------------------
//  RAIDERS
// ---------------------------------------------------------------------------

function raiderTurn(game: GameState, self: Mage, chief: Mage): AIDecision {
  const foes = foesOf(game, self);
  const acts = self.actions;
  if (!foes.length) return { type: 'end' };
  const band = bandOf(game, self).filter((m) => m !== self);
  const shamans = band.filter((m) => m.enemyKind === 'goblinShaman');
  const hit = maxHit(self);
  // Whoever is at the shamans' throats, and whoever the chief is fighting.
  const guard = threatTo(shamans, foes, 6 * U);
  const focus = nearestTo(chief.pos, foes);
  const worth = (f: Mage): number =>
    (f.hp <= hit ? 60 : 0) + (f === guard ? 45 : 0) + (f === focus ? 20 : 0) + Math.max(0, 25 - f.hp) - (f.isSummon ? 8 : 0);
  if (acts.main > 0) {
    const inReach = foes.filter((f) => game.canMelee(self, f));
    if (inReach.length) return { type: 'melee', target: best(inReach, worth) };
    const move = bestStrikeMove(game, self, foes, band, worth, 2);
    if (move) return move;
  }
  if (acts.move <= 0 || acts.main <= 0) return { type: 'end' };
  // Nothing in reach this turn: screen the shamans a stride short of the foe, and never stray from them.
  const anchor = nearestTo(self.pos, shamans) ?? chief;
  const threat = guard ?? nearestTo(anchor.pos, foes)!;
  const hold = Math.min(dist(anchor.pos, threat.pos), reachOf(self) + self.moveRange() * 0.9);
  let want = stepTowards(threat.pos, anchor.pos, hold);
  if (shamans.length && dist(want, anchor.pos) > GOBLIN_SHAMAN_LEASH) want = stepTowards(anchor.pos, want, GOBLIN_SHAMAN_LEASH);
  const point = inField(stepTowards(self.pos, want, self.moveRange()));
  return dist(point, self.pos) < 6 ? { type: 'end' } : { type: 'move', point };
}

// ---------------------------------------------------------------------------
//  SHAMANS
// ---------------------------------------------------------------------------

function shamanTurn(game: GameState, self: Mage, chief: Mage): AIDecision {
  const foes = foesOf(game, self);
  const acts = self.actions;
  const band = bandOf(game, self);
  if (acts.main > 0) {
    const reach = GOBLIN_RITE_RANGE + (acts.move > 0 ? self.moveRange() : 0);
    // A goblin is hurt: mend it. The chief counts for more.
    const hurt = band.filter((g) => g.hp < g.maxHp && dist(self.pos, g.pos) <= reach);
    if (hurt.length) {
      const mend = best(hurt, (g) => Math.min(GOBLIN_MEND_HP, g.maxHp - g.hp) * (g === chief ? 1.6 : 1) + (1 - g.hp / g.maxHp) * 2);
      return riteOn(self, mend, 'goblin-heal');
    }
    // Nobody hurt: hex whoever is nearest the chief, the least hexed first.
    const hexable = foes.filter((f) => dist(self.pos, f.pos) <= reach);
    if (hexable.length) {
      const hex = best(hexable, (f) => -dist(f.pos, chief.pos) / U - hexStacks(f) * 3 - (f.isSummon ? 2 : 0));
      return riteOn(self, hex, 'goblin-hex');
    }
  }
  if (acts.move > 0 && foes.length) {
    const spot = keepAway(self, band, foes);
    if (spot && dist(spot, self.pos) >= 8) return { type: 'move', point: spot };
  }
  return { type: 'end' };
}

function riteOn(self: Mage, target: Mage, type: 'goblin-heal' | 'goblin-hex'): AIDecision {
  const gap = dist(self.pos, target.pos);
  if (gap <= GOBLIN_RITE_RANGE) return { type, target };
  const point = inField(stepTowards(self.pos, target.pos, Math.min(self.moveRange(), gap - GOBLIN_RITE_RANGE + 8)));
  return { type: 'move', point };
}

/** As far from every foe as this turn's walk allows, with the band still inside the rites' reach. */
function keepAway(self: Mage, band: readonly Mage[], foes: readonly Mage[]): Vec2 | null {
  const budget = self.moveRange();
  const others = band.filter((g) => g !== self);
  const score = (spot: Vec2): number => {
    const outOfReach = others.filter((g) => dist(spot, g.pos) > GOBLIN_RITE_RANGE - U).length;
    return closestGap(spot, foes) / U - outOfReach * 6;
  };
  let bestSpot: Vec2 = self.pos;
  let bestScore = score(self.pos);
  for (let k = 0; k < 24; k++) {
    for (const share of [1, 0.5]) {
      const a = (k / 24) * TAU;
      const spot = inField({ x: self.x + Math.cos(a) * budget * share, y: self.y + Math.sin(a) * budget * share });
      if (!clearPath(self.pos, spot, self, foes)) continue;
      const value = score(spot);
      if (value > bestScore + 0.05) {
        bestScore = value;
        bestSpot = spot;
      }
    }
  }
  return bestSpot === self.pos ? null : bestSpot;
}

function hexStacks(m: Mage): number {
  return m.statuses.filter((s) => s.key.startsWith('goblin-hex:')).length;
}

// ---------------------------------------------------------------------------
//  THE ROUT
// ---------------------------------------------------------------------------

function fleeTurn(game: GameState, self: Mage): AIDecision {
  const acts = self.actions;
  if (fleeEdgeAt(self.pos)) return acts.main > 0 || acts.move > 0 ? { type: 'goblin-escape' } : { type: 'end' };
  if (acts.move <= 0) return { type: 'end' };
  const foes = foesOf(game, self);
  const { x, y } = self.pos;
  const exits: Vec2[] = [
    { x: FIELD.x + 4, y },
    { x: FIELD.x + FIELD.w - 4, y },
    { x, y: FIELD.y + 4 },
    { x, y: FIELD.y + FIELD.h - 4 },
  ];
  // The nearest way out that does not lead through the party.
  const exit = best(exits, (e) => -dist(self.pos, e) / U + Math.min(8 * U, closestGap(e, foes)) / U * 0.6 - (clearPath(self.pos, e, self, foes) ? 0 : 10));
  return { type: 'move', point: inField(stepTowards(self.pos, exit, self.moveRange()), 4) };
}

// ---------------------------------------------------------------------------
//  SHARED
// ---------------------------------------------------------------------------

function bandOf(game: GameState, self: Mage): Mage[] {
  return game.mages.filter((m) => m.alive && m.team === self.team && isGoblin(m));
}

/** The foe nearest any of `guarded` within `radius`, if one is that close. */
function threatTo(guarded: readonly Mage[], foes: readonly Mage[], radius: number): Mage | undefined {
  let found: Mage | undefined;
  let gap = radius;
  for (const g of guarded) {
    for (const f of foes) {
      const d = dist(g.pos, f.pos);
      if (d <= gap) {
        gap = d;
        found = f;
      }
    }
  }
  return found;
}

/** Back beside a shaman, as far from the party as the walk allows. */
function fallBack(self: Mage, shaman: Mage, foes: readonly Mage[]): Vec2 | null {
  const budget = self.moveRange();
  let found: { point: Vec2; score: number } | null = null;
  for (let k = 0; k < 24; k++) {
    for (const share of [1, 0.6, 0.3]) {
      const a = (k / 24) * TAU;
      const point = inField({ x: self.x + Math.cos(a) * budget * share, y: self.y + Math.sin(a) * budget * share });
      if (!clearPath(self.pos, point, self, foes)) continue;
      const score = closestGap(point, foes) / U - (Math.max(0, dist(point, shaman.pos) - 3 * U) / U) * 1.5;
      if (!found || score > found.score) found = { point, score };
    }
  }
  return found && dist(found.point, self.pos) >= 8 ? found.point : null;
}
