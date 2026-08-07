import { MELEE_RANGE, RANGE_UNIT } from '../config/constants';
import { dmg, type DamageClass, type DamageType } from '../core/Damage';
import type { GameState } from '../core/GameState';
import type { Mage } from '../core/Mage';
import type { StackItem } from '../core/Stack';
import { dist, segmentCircleFirstIntersection, stepTowards, type Vec2 } from '../core/utils';
import { applyDebuff, applyStun, dealDamage, heal, rollDice } from '../effects/effects';
import { mineAbilityPower } from './minerun';

export type MineActionId =
  | 'rockling-launch'
  | 'bat-shriek'
  | 'golem-wake'
  | 'golem-roll'
  | 'earth-volley'
  | 'elite-lightning'
  | 'shield-slam'
  | 'magma-crash'
  | 'sentinel-repair'
  | 'magma-repair'
  | 'fire-bolt'
  | 'fire-lance'
  | 'magma-lance'
  | 'magma-eruption'
  | 'dragon-bite'
  | 'red-breath'
  | 'black-breath';

export interface MineActionChoice {
  id: MineActionId;
  target?: Mage;
  point?: Vec2;
}

type MineActionCost = 'main' | 'bonus';

interface MineActionDef {
  id: MineActionId;
  label: string;
  cost: MineActionCost;
  hostile: boolean;
  visual: NonNullable<StackItem['actionVisual']>;
  cooldown?: (source: Mage) => number;
  available: (source: Mage) => boolean;
  canCommit?: (source: Mage) => boolean;
  isStillValid: (game: GameState, source: Mage, choice: MineActionChoice) => boolean;
  resolve: (game: GameState, source: Mage, choice: MineActionChoice) => void | Promise<void>;
}

const mineKind = (source: Mage): string => source.mine?.kind ?? '';
const level = (source: Mage): number => source.mine?.level ?? 1;
const power = (source: Mage): number => mineAbilityPower(level(source));
const isSentinel = (mage: Mage): boolean =>
  mage.mine?.kind === 'sentinel' || mage.mine?.kind === 'magma-sentinel';
const cooldownKey = (id: MineActionId): string => `mine:${id}`;

function enemyInRange(game: GameState, source: Mage, target: Mage | undefined, range: number, min = 0): boolean {
  return !!(
    target?.alive &&
    target.team !== source.team &&
    !game.isUntargetable(target, source) &&
    dist(source.pos, target.pos) >= min &&
    dist(source.pos, target.pos) <= range + target.bodyRadius()
  );
}

function allyInRange(source: Mage, target: Mage | undefined, range: number): boolean {
  return !!(
    target?.alive &&
    target !== source &&
    target.team === source.team &&
    dist(source.pos, target.pos) <= range + target.bodyRadius()
  );
}

/** True when an unmoved Rockling's exact Launch path ends in target contact. */
export function canRocklingLaunchHit(game: GameState, source: Mage, target: Mage | undefined): boolean {
  if (
    source.movedThisTurn ||
    mineKind(source) !== 'rockling' ||
    !enemyInRange(game, source, target, 8 * RANGE_UNIT)
  ) return false;
  const destination = stepTowards(source.pos, target!.pos, 8 * RANGE_UNIT);
  const landing = game.leapDestination(source, destination);
  return dist(landing, target!.pos) <= source.bodyRadius() + target!.bodyRadius() + 0.5;
}

function rolledDamage(
  game: GameState,
  source: Mage,
  target: Mage,
  spec: string,
  bonus: number,
  type: DamageType,
  damageClass: DamageClass,
  label: string,
  opts: { canMiss?: boolean; aoe?: boolean; trueDamage?: boolean } = {}
): number {
  const ctx = game.effectContext(source, target, null);
  const amount = rollDice(ctx, spec, label) + bonus;
  return dealDamage(ctx, target, dmg(amount, type, damageClass), opts);
}

const ACTIONS: Record<MineActionId, MineActionDef> = {
  'rockling-launch': {
    id: 'rockling-launch',
    label: 'Rockling Launch',
    cost: 'main',
    hostile: true,
    visual: 'shatter',
    available: (source) => mineKind(source) === 'rockling',
    canCommit: (source) => !source.movedThisTurn,
    isStillValid: (game, source, choice) => canRocklingLaunchHit(game, source, choice.target),
    resolve: (game, source, choice) => {
      const target = choice.target!;
      game.leapMove(source, stepTowards(source.pos, target.pos, 8 * RANGE_UNIT));
      const contactDistance = source.bodyRadius() + target.bodyRadius();
      if (!source.alive || !target.alive || dist(source.pos, target.pos) > contactDistance + 0.5) {
        game.log(`${source.name} lands short and remains intact.`);
        return;
      }
      rolledDamage(game, source, target, '1d4', 0, 'shatter', 'physical', 'Rockling impact');
      game.vfxSink?.shatterBurst?.(source.pos, 78);
      game.defeatMage(source, source, `${source.name} breaks apart on impact.`);
    },
  },
  'bat-shriek': {
    id: 'bat-shriek',
    label: 'Shriek',
    cost: 'main',
    hostile: true,
    visual: 'shadow',
    cooldown: () => 3,
    available: (source) => mineKind(source) === 'cavern-bat',
    isStillValid: (game, source, choice) =>
      enemyInRange(game, source, choice.target, (level(source) >= 6 ? 5 : 4) * RANGE_UNIT),
    resolve: (game, source) => {
      const radius = (level(source) >= 6 ? 5 : 4) * RANGE_UNIT;
      const spec = level(source) >= 6 ? '1d4' : '1d3';
      for (const target of game.magesInRadius(source.pos, radius, source)) {
        if (target.team === source.team) continue;
        rolledDamage(game, source, target, spec, 0, 'shadow', 'sanity', 'Cavern Shriek', {
          canMiss: false,
          aoe: true,
        });
        if (target.alive) {
          applyDebuff(game.effectContext(source, target, null), target, {
            name: 'Disoriented',
            key: 'debuff:mine-disoriented',
            duration: 2,
            mods: { damageDealt: -1, moveRange: -RANGE_UNIT },
          });
        }
      }
    },
  },
  'golem-wake': {
    id: 'golem-wake',
    label: 'Wake',
    cost: 'main',
    hostile: false,
    visual: 'wake',
    available: (source) => mineKind(source) === 'golem' && source.mine?.golemState === 'waking',
    isStillValid: (_game, source) => source.alive && source.mine?.golemState === 'waking',
    resolve: (_game, source) => {
      if (!source.mine) return;
      source.mine.golemState = 'awake';
      source.cannotAttack = false;
      source.actions = { move: 0, main: 0, bonus: 0 };
    },
  },
  'golem-roll': {
    id: 'golem-roll',
    label: 'Stone Roll',
    cost: 'main',
    hostile: true,
    visual: 'shatter',
    available: (source) => mineKind(source) === 'golem' && source.mine?.golemState === 'awake',
    isStillValid: (game, source, choice) =>
      enemyInRange(game, source, choice.target, Infinity, 6 * RANGE_UNIT),
    resolve: (game, source, choice) => {
      const destination = stepTowards(source.pos, choice.target!.pos, 12 * RANGE_UNIT);
      let hit: Mage | null = null;
      let first = Infinity;
      for (const candidate of game.livingEnemiesOf(source)) {
        if (candidate.isAirborne()) continue;
        const t = segmentCircleFirstIntersection(
          source.pos,
          destination,
          candidate.pos,
          source.bodyRadius() + candidate.bodyRadius()
        );
        if (t != null && t < first) {
          first = t;
          hit = candidate;
        }
      }
      const stop = hit
        ? {
            x: source.x + (destination.x - source.x) * first,
            y: source.y + (destination.y - source.y) * first,
          }
        : destination;
      game.leapMove(source, stop);
      if (hit?.alive) {
        rolledDamage(game, source, hit, '2d6+2', power(source), 'shatter', 'physical', 'Stone Roll');
      }
    },
  },
  'earth-volley': {
    id: 'earth-volley',
    label: 'Hurl Stones',
    cost: 'main',
    hostile: true,
    visual: 'shatter',
    available: (source) => mineKind(source) === 'earth-elemental',
    canCommit: (source) => (source.mine?.stones ?? 0) > 0,
    isStillValid: (game, source, choice) =>
      enemyInRange(game, source, choice.target, (level(source) >= 6 ? 18 : 15) * RANGE_UNIT),
    resolve: (game, source, choice) => {
      const target = choice.target!;
      const stones = source.mine?.stones ?? 0;
      let hits = 0;
      for (let i = 0; i < stones; i++) if (game.rng.die(3) === 3) hits += 1;
      if (source.mine) source.mine.stones = 0;
      game.log(`${source.name} hurls ${stones} stones; ${hits} find their mark.`);
      for (let hit = 0; hit < hits && target.alive; hit++) {
        rolledDamage(game, source, target, '1d6', 0, 'shatter', 'physical', 'Stone hit');
      }
    },
  },
  'elite-lightning': {
    id: 'elite-lightning',
    label: 'Mine Lightning',
    cost: 'bonus',
    hostile: true,
    visual: 'lightning',
    available: (source) => mineKind(source) === 'elite-kobold',
    canCommit: (source) => (source.mine?.charges ?? 0) >= 6,
    isStillValid: (game, source, choice) => enemyInRange(game, source, choice.target, 15 * RANGE_UNIT),
    resolve: async (game, source, choice) => {
      const target = choice.target!;
      const ctx = game.effectContext(source, target, null);
      const first = rollDice(ctx, '2d6', 'Mine Lightning');
      const bonus = first < 6 ? rollDice(ctx, '1d6', 'Lightning surge') : 0;
      dealDamage(ctx, target, dmg(first + bonus, 'typeless', 'physical'), {
        canMiss: false,
        trueDamage: true,
      });
    },
  },
  'shield-slam': {
    id: 'shield-slam',
    label: 'Shield Slam',
    cost: 'main',
    hostile: true,
    visual: 'shatter',
    cooldown: (source) => level(source) >= 6 ? 2 : 3,
    available: (source) => mineKind(source) === 'sentinel' && source.mine?.role === 'tank',
    isStillValid: (game, source, choice) => enemyInRange(game, source, choice.target, 2.5 * RANGE_UNIT),
    resolve: (game, source, choice) => {
      const target = choice.target!;
      rolledDamage(game, source, target, '1d8', power(source), 'shatter', 'physical', 'Shield Slam');
      if (target.alive) applyStun(game.effectContext(source, target, null), target, { duration: 2, type: 'main' });
    },
  },
  'magma-crash': {
    id: 'magma-crash',
    label: 'Magma Crash',
    cost: 'main',
    hostile: true,
    visual: 'fire',
    cooldown: () => 2,
    available: (source) => mineKind(source) === 'magma-sentinel' && source.mine?.role === 'tank',
    isStillValid: (game, source, choice) => enemyInRange(game, source, choice.target, 2.5 * RANGE_UNIT),
    resolve: (game, source, choice) => {
      const primary = choice.target!;
      const targets = game.magesInRadius(primary.pos, 2 * RANGE_UNIT).filter((target) => target.team !== source.team);
      for (const target of targets) {
        rolledDamage(game, source, target, '2d6', power(source), 'shatter', 'physical', 'Magma Crash', {
          canMiss: false,
          aoe: target !== primary,
        });
        if (target.alive) game.applySentinelFireStacks(target, level(source) >= 6 ? 2 : 1, source);
      }
      if (primary.alive) applyStun(game.effectContext(source, primary, null), primary, { duration: 2, type: 'main' });
    },
  },
  'sentinel-repair': {
    id: 'sentinel-repair',
    label: 'Repair',
    cost: 'main',
    hostile: false,
    visual: 'heal',
    cooldown: () => 2,
    available: (source) => mineKind(source) === 'sentinel' && source.mine?.role === 'healer',
    canCommit: (source) => source.hp > 0,
    isStillValid: (_game, source, choice) =>
      allyInRange(source, choice.target, 10 * RANGE_UNIT) && isSentinel(choice.target!),
    resolve: (game, source, choice) => {
      const target = choice.target!;
      const ctx = game.effectContext(source, target, null);
      heal(ctx, target, rollDice(ctx, '2d4', 'Repair') + power(source));
    },
  },
  'magma-repair': {
    id: 'magma-repair',
    label: 'Magma Restoration',
    cost: 'main',
    hostile: false,
    visual: 'heal',
    cooldown: () => 3,
    available: (source) => mineKind(source) === 'magma-sentinel' && source.mine?.role === 'healer',
    isStillValid: (_game, source, choice) =>
      allyInRange(source, choice.target, 8 * RANGE_UNIT) && isSentinel(choice.target!),
    resolve: (game, source) => {
      const allies = game.mages
        .filter(
          (target) =>
            target !== source &&
            target.alive &&
            target.team === source.team &&
            isSentinel(target) &&
            dist(source.pos, target.pos) <= 8 * RANGE_UNIT + target.bodyRadius()
        )
        .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || game.mages.indexOf(a) - game.mages.indexOf(b));
      for (const target of allies) {
        const ctx = game.effectContext(source, target, null);
        heal(ctx, target, rollDice(ctx, '2d6', 'Magma Restoration') + power(source));
      }
      const mostWounded = allies[0];
      if (mostWounded) {
        const index = mostWounded.statuses.findIndex((status) => status.kind === 'stun' || status.kind === 'debuff');
        if (index >= 0) {
          const [removed] = mostWounded.statuses.splice(index, 1);
          game.log(`${source.name} purges ${removed.name} from ${mostWounded.name}.`);
        }
      }
    },
  },
  'fire-bolt': {
    id: 'fire-bolt',
    label: 'Fire Bolt',
    cost: 'main',
    hostile: true,
    visual: 'fire',
    available: (source) => isSentinel(source) && source.mine?.role === 'healer',
    isStillValid: (game, source, choice) => enemyInRange(game, source, choice.target, 12 * RANGE_UNIT),
    resolve: (game, source, choice) => {
      const target = choice.target!;
      const magma = mineKind(source) === 'magma-sentinel';
      rolledDamage(game, source, target, magma ? '2d6' : '1d6', power(source), 'fire', 'physical', 'Fire Bolt');
      if (magma && target.alive) game.applySentinelFireStacks(target, 1, source);
    },
  },
  'fire-lance': {
    id: 'fire-lance',
    label: 'Fire Lance',
    cost: 'main',
    hostile: true,
    visual: 'fire',
    available: (source) => mineKind(source) === 'sentinel' && source.mine?.role === 'dps',
    isStillValid: (game, source, choice) => enemyInRange(game, source, choice.target, 15 * RANGE_UNIT),
    resolve: (game, source, choice) => {
      const target = choice.target!;
      const dealt = rolledDamage(game, source, target, '2d6', power(source), 'fire', 'physical', 'Fire Lance');
      if (level(source) < 6 || dealt <= 0) return;
      const second = game.livingEnemiesOf(source)
        .filter((candidate) => candidate !== target && dist(candidate.pos, target.pos) <= 3 * RANGE_UNIT)
        .sort((a, b) => dist(a.pos, target.pos) - dist(b.pos, target.pos) || game.mages.indexOf(a) - game.mages.indexOf(b))[0];
      if (second) {
        dealDamage(
          game.effectContext(source, second, null),
          second,
          dmg(Math.max(1, Math.floor(dealt / 2)), 'fire', 'physical'),
          { canMiss: false }
        );
      }
    },
  },
  'magma-lance': {
    id: 'magma-lance',
    label: 'Magma Lance',
    cost: 'main',
    hostile: true,
    visual: 'fire',
    available: (source) => mineKind(source) === 'magma-sentinel' && source.mine?.role === 'dps',
    isStillValid: (game, source, choice) => enemyInRange(game, source, choice.target, 15 * RANGE_UNIT),
    resolve: (game, source, choice) => {
      const target = choice.target!;
      rolledDamage(game, source, target, '3d6', power(source), 'fire', 'physical', 'Magma Lance');
      if (target.alive) game.applySentinelFireStacks(target, level(source) >= 6 ? 2 : 1, source);
    },
  },
  'magma-eruption': {
    id: 'magma-eruption',
    label: 'Eruption',
    cost: 'main',
    hostile: true,
    visual: 'fire',
    cooldown: () => 2,
    available: (source) => mineKind(source) === 'magma-sentinel' && source.mine?.role === 'dps',
    isStillValid: (game, source, choice) => enemyInRange(game, source, choice.target, 12 * RANGE_UNIT),
    resolve: (game, source, choice) => {
      const targets = game.magesInRadius(choice.target!.pos, 2 * RANGE_UNIT)
        .filter((target) => target.team !== source.team);
      for (const target of targets) {
        rolledDamage(game, source, target, '2d6', power(source), 'fire', 'physical', 'Eruption', {
          canMiss: false,
          aoe: true,
        });
        if (target.alive) game.applySentinelFireStacks(target, level(source) >= 6 ? 2 : 1, source);
      }
    },
  },
  'dragon-bite': {
    id: 'dragon-bite',
    label: 'Dragon Bite',
    cost: 'main',
    hostile: true,
    visual: 'shatter',
    cooldown: () => 2,
    available: (source) => mineKind(source) === 'red-dragonborn' || mineKind(source) === 'black-dragonborn',
    isStillValid: (game, source, choice) => enemyInRange(game, source, choice.target, 2.5 * RANGE_UNIT),
    resolve: (game, source, choice) => {
      rolledDamage(game, source, choice.target!, '2d8', power(source), 'pierce', 'physical', 'Dragon Bite');
    },
  },
  'red-breath': {
    id: 'red-breath',
    label: 'Red Breath',
    cost: 'main',
    hostile: true,
    visual: 'fire',
    cooldown: (source) => level(source) >= 9 ? 2 : 3,
    available: (source) => mineKind(source) === 'red-dragonborn' && level(source) >= 3,
    isStillValid: (game, source, choice) => enemyInRange(game, source, choice.target, 15 * RANGE_UNIT),
    resolve: (game, source, choice) => {
      const degrees = level(source) >= 6 ? 90 : 70;
      const targets = game.magesInCone(source.pos, choice.target!.pos, 15 * RANGE_UNIT, degrees, source)
        .filter((target) => target.team !== source.team);
      for (const target of targets) {
        rolledDamage(game, source, target, '3d6', 0, 'fire', 'physical', 'Red Breath', {
          canMiss: false,
          aoe: true,
        });
      }
    },
  },
  'black-breath': {
    id: 'black-breath',
    label: 'Black Breath',
    cost: 'main',
    hostile: true,
    visual: 'corrosive',
    cooldown: (source) => level(source) >= 9 ? 2 : 3,
    available: (source) => mineKind(source) === 'black-dragonborn' && level(source) >= 3,
    isStillValid: (game, source, choice) =>
      enemyInRange(game, source, choice.target, 8 * RANGE_UNIT) &&
      !!choice.point &&
      dist(source.pos, choice.point) <= 8 * RANGE_UNIT,
    resolve: (game, source, choice) => {
      game.addCorrosionPool(
        choice.point!,
        source,
        (level(source) >= 6 ? 4 : 3) * RANGE_UNIT,
        level(source) >= 6 ? 4 : 3
      );
    },
  },
};

export function canUseMineAction(game: GameState, source: Mage, choice: MineActionChoice): boolean {
  const def = ACTIONS[choice.id];
  if (!source.alive || !source.mine || !def.available(source)) return false;
  if (source.actions[def.cost] <= 0) return false;
  if (source.isAbilityBanned(cooldownKey(def.id))) return false;
  if ((source.mine.cooldowns[def.id] ?? 0) > 0) return false;
  if (def.canCommit && !def.canCommit(source)) return false;
  return def.isStillValid(game, source, choice);
}

/** Spend action-specific resources at declaration time, before reactions. */
export function commitMineAction(source: Mage, choice: MineActionChoice): MineActionCost {
  const def = ACTIONS[choice.id];
  if (choice.id === 'elite-lightning' && source.mine) {
    source.mine.charges = Math.max(0, (source.mine.charges ?? 0) - 6);
  }
  const cooldown = def.cooldown?.(source) ?? 0;
  if (source.mine && cooldown > 0) source.mine.cooldowns[def.id] = cooldown;
  return def.cost;
}

export function makeMineActionItem(
  game: GameState,
  source: Mage,
  choice: MineActionChoice
): StackItem {
  const def = ACTIONS[choice.id];
  return game.makeActionItem({
    source,
    target: choice.target,
    targetPoint: choice.point,
    label: def.label,
    description: `${source.name} uses ${def.label}.`,
    hostileAttack: def.hostile,
    actionVisual: def.visual,
    needleBan: { kind: 'ability', key: cooldownKey(def.id), label: def.label },
    isStillValid: (state) => def.isStillValid(state, source, choice),
    resolve: (state) => def.resolve(state, source, choice),
  });
}