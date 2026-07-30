import { RANGE_UNIT } from '../config/constants';
import type { GameState } from '../core/GameState';
import type { Mage } from '../core/Mage';
import { dist } from '../core/utils';
import { canUseMineAction, type MineActionChoice } from './mineActions';

export type MineAIDecision =
  | { type: 'mine-action'; choice: MineActionChoice }
  | { type: 'end' }
  | null;

function chooseTied<T>(game: GameState, entries: T[], score: (entry: T) => number): T | null {
  if (entries.length === 0) return null;
  let best = -Infinity;
  const tied: T[] = [];
  for (const entry of entries) {
    const value = score(entry);
    if (value > best) {
      best = value;
      tied.length = 0;
      tied.push(entry);
    } else if (value === best) {
      tied.push(entry);
    }
  }
  return tied.length === 1 ? tied[0] : game.rng.pick(tied);
}

function tryAction(game: GameState, source: Mage, choice: MineActionChoice): MineAIDecision {
  return canUseMineAction(game, source, choice) ? { type: 'mine-action', choice } : null;
}

/** Pick one authored Mine action; null intentionally falls through to generic AI. */
export function chooseMineAction(game: GameState, source: Mage): MineAIDecision {
  const mine = source.mine;
  if (!mine) return null;
  if (mine.kind === 'golem' && mine.golemState === 'dormant') return { type: 'end' };
  if (mine.kind === 'golem' && mine.golemState === 'waking') {
    return tryAction(game, source, { id: 'golem-wake' }) ?? { type: 'end' };
  }

  const enemies = game.livingEnemiesOf(source).filter((target) => !target.isInvisible());
  if (enemies.length === 0) return { type: 'end' };
  const nearest = chooseTied(
    game,
    enemies,
    (target) => -Math.round(dist(source.pos, target.pos) * 1000)
  )!;

  if (mine.kind === 'rockling') {
    return tryAction(game, source, { id: 'rockling-launch', target: nearest });
  }

  if (mine.kind === 'cavern-bat') {
    const radius = (mine.level >= 6 ? 5 : 4) * RANGE_UNIT;
    const inShriek = enemies.filter((target) => dist(source.pos, target.pos) <= radius + target.bodyRadius());
    const primary = chooseTied(game, inShriek, (target) => -target.sanity) ?? nearest;
    return tryAction(game, source, { id: 'bat-shriek', target: primary });
  }

  if (mine.kind === 'elite-kobold') {
    const lightningTargets = enemies.filter(
      (target) => dist(source.pos, target.pos) <= 15 * RANGE_UNIT + target.bodyRadius()
    );
    const target = chooseTied(game, lightningTargets, (candidate) => -candidate.hp);
    if (target) {
      const lightning = tryAction(game, source, { id: 'elite-lightning', target });
      if (lightning) return lightning;
    }
    return null;
  }

  if (mine.kind === 'golem') {
    const rollTargets = enemies.filter((target) => dist(source.pos, target.pos) >= 6 * RANGE_UNIT);
    const target = chooseTied(game, rollTargets, (candidate) => -dist(source.pos, candidate.pos));
    if (target) return tryAction(game, source, { id: 'golem-roll', target });
    return null;
  }

  if (mine.kind === 'earth-elemental') {
    if ((mine.stones ?? 0) <= 0) return null;
    const range = (mine.level >= 6 ? 18 : 15) * RANGE_UNIT;
    const targets = enemies.filter((target) => dist(source.pos, target.pos) <= range + target.bodyRadius());
    const target = chooseTied(game, targets, (candidate) => -candidate.hp);
    return target ? tryAction(game, source, { id: 'earth-volley', target }) : null;
  }

  if (mine.kind === 'sentinel' || mine.kind === 'magma-sentinel') {
    const magma = mine.kind === 'magma-sentinel';
    if (mine.role === 'tank') {
      return tryAction(game, source, {
        id: magma ? 'magma-crash' : 'shield-slam',
        target: nearest,
      });
    }
    if (mine.role === 'healer') {
      const allies = game.mages.filter(
        (target) =>
          target !== source &&
          target.alive &&
          target.team === source.team &&
          (target.mine?.kind === 'sentinel' || target.mine?.kind === 'magma-sentinel') &&
          dist(source.pos, target.pos) <= (magma ? 8 : 10) * RANGE_UNIT + target.bodyRadius() &&
          (target.hp < target.maxHp || target.statuses.some((status) => status.kind === 'stun' || status.kind === 'debuff'))
      );
      const wounded = chooseTied(game, allies, (target) => -Math.round((target.hp / target.maxHp) * 1000));
      if (wounded) {
        const repair = tryAction(game, source, {
          id: magma ? 'magma-repair' : 'sentinel-repair',
          target: wounded,
        });
        if (repair) return repair;
      }
      return tryAction(game, source, { id: 'fire-bolt', target: nearest });
    }
    if (mine.role === 'dps') {
      if (magma) {
        const centers = enemies.filter(
          (target) => dist(source.pos, target.pos) <= 12 * RANGE_UNIT + target.bodyRadius()
        );
        const center = chooseTied(
          game,
          centers,
          (candidate) => enemies.filter((target) => dist(target.pos, candidate.pos) <= 2 * RANGE_UNIT).length
        );
        if (center) {
          const caught = enemies.filter((target) => dist(target.pos, center.pos) <= 2 * RANGE_UNIT).length;
          if (caught >= 2) {
            const eruption = tryAction(game, source, { id: 'magma-eruption', target: center });
            if (eruption) return eruption;
          }
        }
        return tryAction(game, source, { id: 'magma-lance', target: nearest });
      }
      return tryAction(game, source, { id: 'fire-lance', target: nearest });
    }
  }

  if (mine.kind === 'red-dragonborn' || mine.kind === 'black-dragonborn') {
    if (mine.level >= 3) {
      if (mine.kind === 'red-dragonborn') {
        const centers = enemies.filter(
          (target) => dist(source.pos, target.pos) <= 15 * RANGE_UNIT + target.bodyRadius()
        );
        const degrees = mine.level >= 6 ? 90 : 70;
        const aim = chooseTied(
          game,
          centers,
          (candidate) => game.magesInCone(source.pos, candidate.pos, 15 * RANGE_UNIT, degrees, source)
            .filter((target) => target.team !== source.team).length
        );
        if (aim) {
          const caught = game.magesInCone(source.pos, aim.pos, 15 * RANGE_UNIT, degrees, source)
            .filter((target) => target.team !== source.team).length;
          if (caught >= 2) {
            const breath = tryAction(game, source, { id: 'red-breath', target: aim });
            if (breath) return breath;
          }
        }
      } else {
        const radius = (mine.level >= 6 ? 4 : 3) * RANGE_UNIT;
        const centers = enemies.filter(
          (target) => dist(source.pos, target.pos) <= 8 * RANGE_UNIT + target.bodyRadius()
        );
        const aim = chooseTied(
          game,
          centers,
          (candidate) => enemies.filter((target) => dist(target.pos, candidate.pos) <= radius).length
        );
        if (aim) {
          const caught = enemies.filter((target) => dist(target.pos, aim.pos) <= radius).length;
          if (caught >= 2) {
            const breath = tryAction(game, source, {
              id: 'black-breath',
              target: aim,
              point: aim.pos,
            });
            if (breath) return breath;
          }
        }
      }
    }
    const bite = tryAction(game, source, { id: 'dragon-bite', target: nearest });
    if (bite) return bite;
    return null;
  }

  return null;
}