import { FIELD, RANGE_UNIT } from '../config/constants';
import { dmg } from '../core/Damage';
import type { GameState } from '../core/GameState';
import { Mage } from '../core/Mage';
import { dist } from '../core/utils';
import { dealDamage, heal } from '../effects/effects';
import { applyEnemyTraits } from './swamprun';
import { betweenCrusadeLine, crusadeBallistaCanFire, crusadeHelperHealth, isCrusadeBuilding, isCrusadeFighter, isCrusadeKind, type CrusadeSupply } from './crusade';

export type CrusadeAction =
  | { kind: 'priest-heal'; target: Mage }
  | { kind: 'stock'; target: Mage; supply: CrusadeSupply }
  | { kind: 'load' | 'bandage' | 'man' | 'panic'; target: Mage };

export function crusadeGuard(game: GameState, source: Mage, target: Mage): Mage | undefined {
  if (source.team === target.team || !isCrusadeKind(target.enemyKind)) return undefined;
  const guards = game.mages.filter((m) => m.alive && m.team === target.team && m.enemyKind === 'crusadeSoldier'
    && m.reactionAvailable && (m === target || betweenCrusadeLine(m, source, target, m.bodyRadius() + RANGE_UNIT / 2)));
  const guard = guards.sort((a, b) => dist(source.pos, a.pos) - dist(source.pos, b.pos))[0];
  if (!guard || game.rng.chance(0.1)) return undefined;
  guard.reactionAvailable = false;
  guard.reactedThisCycle = true;
  game.log(`${guard.name} blocks${guard === target ? '' : ` for ${target.name}`}: 33% reduction.`);
  return guard;
}

export function routeCrusade(game: GameState, team: number): boolean {
  if (!game.mages.some((m) => m.team === team && isCrusadeFighter(m))) return false;
  if (game.mages.some((m) => m.team === team && m.alive && isCrusadeFighter(m))) return false;
  const fleeing = game.mages.filter((m) => m.alive && m.team === team && isCrusadeKind(m.enemyKind));
  for (const m of fleeing) m.withdrawn = true;
  game.pendingCrusadeHelpers = game.pendingCrusadeHelpers.filter((entry) => entry.team !== team);
  if (fleeing.length) game.log('All Soldiers and Priests have fallen. The remaining Crusaders flee.');
  return true;
}

export function crusadeDeath(game: GameState, target: Mage, source: Mage): boolean {
  if (!isCrusadeKind(target.enemyKind)) return false;
  if (target.enemyKind === 'crusadeHelper') {
    game.log(`${target.name} dies looking heartbroken. No damage or kill rewards are granted.`);
    game.vfxSink?.combatFeedback?.(target, { kind: 'blocked', label: 'I wanted to go home...' });
    const mill = game.rng.roll('1d2-1').total;
    if (mill > 0 && source.alive) dealDamage(game.effectContext(target, source, null), source, dmg(mill, 'sanity'), { canMiss: false });
    if (game.mages.some((m) => m.alive && m.team === target.team && m.enemyKind === 'crusadeCamp')) {
      game.pendingCrusadeHelpers.push({ team: target.team, afterTurn: game.turnSeq });
    }
  }
  routeCrusade(game, target.team);
  return target.enemyKind === 'crusadeHelper';
}

export function spawnCrusadeHelpers(game: GameState): Mage[] {
  const pending = game.pendingCrusadeHelpers;
  game.pendingCrusadeHelpers = [];
  const spawned: Mage[] = [];
  for (const entry of pending) {
    if (entry.afterTurn > game.turnSeq) {
      game.pendingCrusadeHelpers.push(entry);
      continue;
    }
    const camps = game.mages.filter((m) => m.alive && m.team === entry.team && m.enemyKind === 'crusadeCamp');
    if (!camps.length || routeCrusade(game, entry.team)) continue;
    const camp = game.rng.pick(camps);
    for (let index = 0; index < 2; index++) {
      const radius = camp.bodyRadius() + 24;
      let point = { x: camp.x, y: camp.y };
      for (let attempt = 0; attempt < 32; attempt++) {
        const angle = game.rng.float() * Math.PI * 2;
        const gap = radius + Math.floor(attempt / 8) * RANGE_UNIT;
        point = { x: Math.max(FIELD.x + 24, Math.min(FIELD.x + FIELD.w - 24, camp.x + Math.cos(angle) * gap)),
          y: Math.max(FIELD.y + 24, Math.min(FIELD.y + FIELD.h - 24, camp.y + Math.sin(angle) * gap)) };
        if (game.mages.every((m) => !m.alive || dist(m.pos, point) >= m.bodyRadius() + 18)) break;
      }
      const helper = new Mage({ name: 'Helper', isAI: true, team: entry.team, position: point, loadout: [] });
      applyEnemyTraits(helper, 'crusadeHelper', game.rng);
      const players = game.mages.filter((m) => m.team !== entry.team && !m.isSummon && !m.enemyKind && !m.mine && m.sceneSide !== 'escort').length;
      helper.hp = helper.maxHp = crusadeHelperHealth(players);
      game.addMage(helper);
      game.grantExtraTurn(helper);
      spawned.push(helper);
    }
    game.log(`Two more ${camp.name}'s "Neatly treated Helpers" appear and act immediately.`);
  }
  return spawned;
}

export function canCrusadeAction(game: GameState, actor: Mage, action: CrusadeAction): boolean {
  const target = action.target;
  if (!actor.alive || !target.alive || actor.actions.main <= 0) return false;
  if (action.kind === 'panic') return actor.enemyKind === 'crusadeHelper' && target !== actor
    && dist(actor.pos, target.pos) <= RANGE_UNIT * 2
    && !game.mages.some((m) => m.alive && m.team === actor.team && m.enemyKind === 'crusadeCamp');
  if (actor.team !== target.team) return false;
  if (action.kind === 'priest-heal') return actor.enemyKind === 'crusadePriest' && actor !== target
    && !isCrusadeBuilding(target) && target.enemyKind !== 'crusadeHelper' && dist(actor.pos, target.pos) <= 10 * RANGE_UNIT;
  if (actor.enemyKind !== 'crusadeHelper' || dist(actor.pos, target.pos) > 2 * RANGE_UNIT) return false;
  if (action.kind === 'stock') return target.enemyKind === 'crusadeCamp' && !actor.crusade?.supply;
  if (action.kind === 'load') return target.enemyKind === 'crusadeBallista' && !target.crusade?.loaded && actor.crusade?.supply === 'load';
  if (action.kind === 'bandage') return target !== actor && target.enemyKind !== 'crusadeHelper' && actor.crusade?.supply === 'bandages';
  return target.enemyKind === 'crusadeBallista';
}

export function resolveCrusadeAction(game: GameState, actor: Mage, action: CrusadeAction): boolean {
  if (!canCrusadeAction(game, actor, action)) return false;
  const target = action.target;
  actor.crusade ??= {};
  if (action.kind === 'priest-heal') heal(game.effectContext(actor, target, null), target, game.showRoll('1d3', 'Saintly Mending', target).total);
  else if (action.kind === 'stock') {
    actor.crusade.supply = action.supply;
    actor.crusade.manning = undefined;
    game.log(`${actor.name} takes ${action.supply} from ${target.name}.`);
  } else if (action.kind === 'load') {
    target.crusade!.loaded = true;
    actor.crusade.supply = undefined;
    actor.crusade.manning = game.mages.indexOf(target);
    game.log(`${actor.name} loads ${target.name}.`);
  } else if (action.kind === 'bandage') {
    actor.crusade.supply = undefined;
    actor.crusade.manning = undefined;
    heal(game.effectContext(actor, target, null), target, game.showRoll('2d6', 'Helper Bandages', target).total);
  } else if (action.kind === 'man') {
    actor.crusade.manning = game.mages.indexOf(target);
    game.log(`${actor.name} mans ${target.name}.`);
  } else {
    game.log(`${actor.name}: "No more orders!"`);
    dealDamage(game.effectContext(actor, target, null), target, dmg(1, 'typeless'), { canMiss: false, trueDamage: true });
  }
  actor.actions.main = 0;
  if (action.kind !== 'priest-heal') actor.actions = { move: 0, main: 0, bonus: 0 };
  return true;
}

export function fireCrusadeBallista(game: GameState, ballista: Mage, target: Mage): boolean {
  if (!crusadeBallistaCanFire(game.mages, ballista) || !game.canMelee(ballista, target)) return false;
  ballista.crusade!.loaded = false;
  ballista.crusade!.firedTurn = game.turnSeq;
  ballista.actions.main = 0;
  game.log(`${ballista.name} fires a bolt of Light at ${target.name}.`);
  for (const ally of game.mages) {
    if (ally.alive && ally.team === ballista.team && ally !== ballista && isCrusadeKind(ally.enemyKind)
      && ally.enemyKind !== 'crusadeHelper' && betweenCrusadeLine(ally, ballista, target, RANGE_UNIT)) {
      heal(game.effectContext(ballista, ally, null), ally, game.showRoll('1d6', 'Balista Light', ally).total);
    }
  }
  dealDamage(game.effectContext(ballista, target, null), target, dmg(game.showRoll('2d6', 'Balista of Light', target).total, 'light'));
  return true;
}