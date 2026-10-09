import { MELEE_RANGE } from '../config/constants';
import type { GameState } from '../core/GameState';
import type { Mage } from '../core/Mage';
import { dist, type Vec2 } from '../core/utils';
import { moayTargets } from '../pve/moay';
import type { AIDecision } from './SimpleAI';
import { closeIn, foesOf, nearestTo } from './tactics';

export function chooseMoayAction(game: GameState, self: Mage): AIDecision {
  if (self.moayTurns <= 2 || self.actions.main <= 0) return { type: 'end' };
  const foes = foesOf(game, self);
  const players = foes.filter((m) => !m.isSummon);
  const prey = nearestTo(self.pos, players.length ? players : foes);
  if (!prey) return { type: 'end' };
  const reach = self.intrinsicMeleeReach ?? MELEE_RANGE;
  let pick: { point: Vec2; target: Mage; score: number } | undefined;
  for (const target of players.length ? players : foes) {
    if (!game.canStrikeAirborne(self, target)) continue;
    const points = [self.pos];
    if (self.actions.move > 0) {
      const stand = Math.max(self.bodyRadius() + target.bodyRadius() + 2, reach - 8);
      for (let angle = 0; angle < 32; angle++) {
        const theta = angle * Math.PI * 2 / 32;
        const desired = { x: target.x + Math.cos(theta) * stand, y: target.y + Math.sin(theta) * stand };
        const bounded = game.clampToBarriers(self.pos, desired, self.bodyRadius()).dest;
        const point = game.clampToMages(self, self.pos, bounded);
        if (dist(point, self.pos) <= self.moveRange() && dist(point, self.pos) > 2 &&
          game.mages.every((other) => !other.alive || other === self ||
            dist(point, other.pos) >= self.bodyRadius() + other.bodyRadius() + 0.1)) points.push(point);
      }
    }
    for (const point of points) {
      if (dist(point, target.pos) > reach || game.wallBetween(point, target.pos)) continue;
      const hits = moayTargets(game, self, target.pos).filter((m) => !m.isSummon).length;
      const score = hits * 10_000 - dist(self.pos, target.pos) * 10 - dist(self.pos, point);
      if (!pick || score > pick.score) pick = { point, target, score };
    }
  }
  if (pick) return dist(pick.point, self.pos) > 2
    ? { type: 'move', point: pick.point }
    : { type: 'melee', target: pick.target };
  if (self.actions.move <= 0) return { type: 'end' };
  const advance = closeIn(self, prey);
  if (advance.type !== 'move') return advance;
  const bounded = game.clampToBarriers(self.pos, advance.point, self.bodyRadius()).dest;
  const point = game.clampToMages(self, self.pos, bounded);
  return dist(point, self.pos) > 2 ? { type: 'move', point } : { type: 'end' };
}