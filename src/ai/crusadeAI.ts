import { RANGE_UNIT } from '../config/constants';
import type { GameState } from '../core/GameState';
import type { Mage } from '../core/Mage';
import { dist, stepTowards, type Vec2 } from '../core/utils';
import { crusadeBallistaCanFire, crusadeCrew, isCrusadeBuilding, isCrusadeKind } from '../pve/crusade';
import type { CrusadeAction } from '../pve/crusadeCombat';
import type { AIDecision } from './SimpleAI';
import { best, clearPath, closeIn, closestGap, foesOf, inField, nearestTo, reachOf, strikeSpot } from './tactics';

const U = RANGE_UNIT;

function work(choice: CrusadeAction): AIDecision {
  return { type: 'crusade-action', choice };
}

function approach(self: Mage, target: Mage): AIDecision {
  if (self.actions.move <= 0) return { type: 'end' };
  const gap = Math.max(0, dist(self.pos, target.pos) - 1.8 * U);
  return gap > 2 ? { type: 'move', point: inField(stepTowards(self.pos, target.pos, Math.min(self.moveRange(), gap))) } : { type: 'end' };
}

export function chooseCrusadeAction(game: GameState, self: Mage): AIDecision {
  if (!self.alive || self.inert) return { type: 'end' };
  const allies = game.mages.filter((m) => m.alive && m.team === self.team && isCrusadeKind(m.enemyKind));
  const foes = foesOf(game, self);
  const players = foes.filter((m) => !m.isSummon);
  const prey = nearestTo(self.pos, players.length ? players : foes);
  if (self.enemyKind === 'crusadeHelper') return helperTurn(game, self, allies);
  if (self.enemyKind === 'crusadePriest') return priestTurn(game, self, allies, players.length ? players : foes);
  if (!prey) return { type: 'end' };
  if (self.enemyKind === 'crusadeBallista') {
    self.crusade!.manned = crusadeCrew(game.mages, self).length > 0;
    if (self.actions.main > 0 && crusadeBallistaCanFire(game.mages, self) && game.canMelee(self, prey)) return { type: 'melee', target: prey };
    if (self.actions.move > 0 && self.crusade!.manned && dist(self.pos, prey.pos) > reachOf(self)) return closeIn(self, prey);
    return { type: 'end' };
  }
  if (self.actions.main > 0 && game.canMelee(self, prey)) return { type: 'melee', target: prey };
  if (self.actions.move <= 0) return { type: 'end' };
  const protectedAlly = nearestTo(prey.pos, allies.filter((m) => m.enemyKind === 'crusadePriest' || m.enemyKind === 'crusadeBallista'));
  if (protectedAlly && (dist(prey.pos, protectedAlly.pos) <= 12 * U || game.rng.chance(0.6))) {
    const gap = dist(protectedAlly.pos, prey.pos);
    const point = inField(stepTowards(protectedAlly.pos, prey.pos, Math.min(2 * U, gap / 2)));
    if (dist(self.pos, point) > 8) return { type: 'move', point: inField(stepTowards(self.pos, point, self.moveRange())) };
    return { type: 'end' };
  }
  if (self.actions.main > 0) {
    const spot = strikeSpot(self, prey, foes, allies.filter((m) => m !== self));
    return spot ? { type: 'move', point: spot.point } : closeIn(self, prey);
  }
  return { type: 'end' };
}

function priestTurn(game: GameState, self: Mage, allies: Mage[], foes: Mage[]): AIDecision {
  if (self.actions.main <= 0 || !foes.length) return { type: 'end' };
  const state = self.crusade!;
  if (state.plannedTurn !== game.turnSeq || !game.mages[state.riteTarget ?? -1]?.alive) {
    const wounded = allies.filter((m) => m !== self && !isCrusadeBuilding(m) && m.enemyKind !== 'crusadeHelper'
      && m.hp < m.maxHp && dist(self.pos, m.pos) <= 14 * U);
    const mend = wounded.length > 0 && game.rng.chance(0.55);
    const target = mend ? best(wounded, (m) => (m.maxHp - m.hp) / m.maxHp) : nearestTo(self.pos, foes)!;
    state.plannedTurn = game.turnSeq;
    state.riteTarget = game.mages.indexOf(target);
    state.riteHeal = mend;
  }
  const target = game.mages[state.riteTarget!];
  const range = state.riteHeal ? 10 * U : reachOf(self);
  if (self.actions.move > 0) {
    const blockers = game.mages.filter((m) => m.alive && m !== self);
    let selected: Vec2 | undefined;
    let score = -Infinity;
    for (let angleIndex = 0; angleIndex < 48; angleIndex++) {
      const angle = angleIndex * Math.PI * 2 / 48;
      for (const fraction of [1, 0.66, 0.33]) {
        const point = inField({ x: self.x + Math.cos(angle) * self.moveRange() * fraction,
          y: self.y + Math.sin(angle) * self.moveRange() * fraction });
        if (dist(point, target.pos) > range - 2 || !clearPath(self.pos, point, self, blockers)) continue;
        const value = closestGap(point, foes) + dist(point, target.pos) * 0.05;
        if (value > score) { score = value; selected = point; }
      }
    }
    const here = closestGap(self.pos, foes) + dist(self.pos, target.pos) * 0.05;
    if (selected && (score > here + 3 || dist(self.pos, target.pos) > range)) return { type: 'move', point: selected };
    if (dist(self.pos, target.pos) > range) return { type: 'move', point: inField(stepTowards(self.pos, target.pos,
      Math.min(self.moveRange(), dist(self.pos, target.pos) - range + 4))) };
  }
  if (state.riteHeal && dist(self.pos, target.pos) <= range) return work({ kind: 'priest-heal', target });
  return !state.riteHeal && game.canMelee(self, target) ? { type: 'melee', target } : { type: 'end' };
}

function helperTurn(game: GameState, self: Mage, allies: Mage[]): AIDecision {
  if (self.actions.main <= 0) return { type: 'end' };
  const camps = allies.filter((m) => m.enemyKind === 'crusadeCamp');
  if (!camps.length) {
    self.crusade!.manning = undefined;
    const victims = game.mages.filter((m) => m.alive && m !== self && dist(self.pos, m.pos) <= 2 * U);
    if (victims.length && game.rng.chance(0.25)) return work({ kind: 'panic', target: game.rng.pick(victims) });
    if (self.actions.move <= 0) return { type: 'end' };
    const angle = game.rng.float() * Math.PI * 2;
    return { type: 'move', point: inField({ x: self.x + Math.cos(angle) * self.moveRange(), y: self.y + Math.sin(angle) * self.moveRange() }) };
  }
  const ballistae = allies.filter((m) => m.enemyKind === 'crusadeBallista');
  const wounded = allies.filter((m) => m !== self && m.enemyKind !== 'crusadeHelper' && m.hp < m.maxHp);
  const supply = self.crusade!.supply;
  if (supply === 'bandages') {
    const target = nearestTo(self.pos, wounded);
    if (!target) return { type: 'end' };
    return dist(self.pos, target.pos) <= 2 * U ? work({ kind: 'bandage', target }) : approach(self, target);
  }
  if (supply === 'load') {
    const target = nearestTo(self.pos, ballistae.filter((m) => !m.crusade?.loaded))
      ?? nearestTo(self.pos, ballistae.filter((m) => crusadeCrew(game.mages, m).length === 0))
      ?? nearestTo(self.pos, ballistae);
    if (!target) return { type: 'end' };
    if (dist(self.pos, target.pos) > 2 * U) return approach(self, target);
    if (!target.crusade!.loaded) return work({ kind: 'load', target });
    if (self.crusade!.manning !== game.mages.indexOf(target)) return work({ kind: 'man', target });
    return { type: 'end' };
  }
  const uncrewed = nearestTo(self.pos, ballistae.filter((m) => m.crusade?.loaded && crusadeCrew(game.mages, m).length === 0));
  if (uncrewed) return dist(self.pos, uncrewed.pos) <= 2 * U ? work({ kind: 'man', target: uncrewed }) : approach(self, uncrewed);
  const station = game.mages[self.crusade!.manning ?? -1];
  if (station?.alive && dist(self.pos, station.pos) <= 2 * U && crusadeCrew(game.mages, station).length <= 1) return { type: 'end' };
  const waiting = allies.some((m) => m.enemyKind === 'crusadeHelper' && m.crusade?.supply === 'load'
    && ballistae.every((b) => b.crusade?.loaded));
  const bandages = wounded.length > 0 && (!ballistae.length || game.rng.chance(waiting ? 0.85 : 0.45));
  const camp = nearestTo(self.pos, camps)!;
  return dist(self.pos, camp.pos) <= 2 * U ? work({ kind: 'stock', target: camp, supply: bandages ? 'bandages' : 'load' }) : approach(self, camp);
}