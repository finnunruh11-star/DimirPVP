// How a summon carries out the standing order its owner shouted. Deterministic,
// so every online peer walks and strikes the same way.

import type { GameState } from '../core/GameState';
import type { Mage } from '../core/Mage';
import { dist, stepTowards, type Vec2 } from '../core/utils';
import type { AIDecision } from './SimpleAI';
import { closeIn, closestGap, foesOf, inField, nearestTo, strikeSpot } from './tactics';

const END: AIDecision = { type: 'end' };
const TAU = Math.PI * 2;

/** The foe a summon's order points it at, if any still stands. */
export function summonOrderTarget(game: GameState, summon: Mage): Mage | undefined {
  const order = summon.summonOrder;
  if (order?.kind === 'attack') {
    const target = game.mages[order.targetIndex ?? -1];
    return target?.alive && target.team !== summon.team ? target : undefined;
  }
  if (order?.kind === 'anyone') return nearestTo(summon.pos, foesOf(game, summon));
  return undefined;
}

/** The next step of a summon's standing order, or 'end' once it has done what it can. */
export function summonOrderDecision(game: GameState, summon: Mage, owner: Mage): AIDecision {
  switch (summon.summonOrder?.kind) {
    case 'return':
      return returnTo(summon, owner);
    case 'flee':
      return fleeFrom(game, summon);
    case 'attack':
    case 'anyone': {
      const target = summonOrderTarget(game, summon);
      return target ? strike(game, summon, target) : END;
    }
    default:
      return END;
  }
}

function returnTo(summon: Mage, owner: Mage): AIDecision {
  if (summon.actions.move <= 0 || !owner.alive) return END;
  const gap = dist(summon.pos, owner.pos) - (summon.bodyRadius() + owner.bodyRadius() + 6);
  if (gap <= 6) return END;
  return { type: 'move', point: stepTowards(summon.pos, owner.pos, Math.min(summon.moveRange(), gap)) };
}

/** Walk to the reachable spot whose nearest foe is farthest away. */
function fleeFrom(game: GameState, summon: Mage): AIDecision {
  if (summon.actions.move <= 0) return END;
  const foes = game.livingEnemiesOf(summon);
  if (foes.length === 0) return END;
  const range = summon.moveRange();
  let best: { point: Vec2; gap: number } = { point: summon.pos, gap: closestGap(summon.pos, foes) };
  let moved = false;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * TAU;
    for (const share of [1, 0.66, 0.33]) {
      const point = inField({ x: summon.x + Math.cos(a) * range * share, y: summon.y + Math.sin(a) * range * share });
      const gap = closestGap(point, foes);
      if (gap > best.gap + 0.5) {
        best = { point, gap };
        moved = true;
      }
    }
  }
  return moved ? { type: 'move', point: best.point } : END;
}

function strike(game: GameState, summon: Mage, target: Mage): AIDecision {
  const inReach = game.canMelee(summon, target);
  const cost = summon.attackIsBonusAction() ? 'bonus' : 'main';
  if (inReach && summon.actions[cost] > 0) return { type: 'melee', target };
  if (inReach || summon.actions.move <= 0) return END;
  const spot = strikeSpot(summon, target, foesOf(game, summon), game.alliesOf(summon));
  return spot ? { type: 'move', point: spot.point } : closeIn(summon, target);
}
