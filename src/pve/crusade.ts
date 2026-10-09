import type { Dice } from '../core/Dice';
import type { Mage } from '../core/Mage';
import { RANGE_UNIT } from '../config/constants';
import { dist } from '../core/utils';

export const CRUSADE_HEALTH_MULTIPLIER = 2 / 3;
export const CRUSADE_HP = {
  crusadeSoldier: 30 * CRUSADE_HEALTH_MULTIPLIER,
  crusadePriest: 10 * CRUSADE_HEALTH_MULTIPLIER,
  crusadeBallista: 20 * CRUSADE_HEALTH_MULTIPLIER,
  crusadeCamp: 40 * CRUSADE_HEALTH_MULTIPLIER,
  crusadeHelper: 4 * CRUSADE_HEALTH_MULTIPLIER,
} as const;

export type CrusadeKind = keyof typeof CRUSADE_HP;
export type CrusadeSupply = 'bandages' | 'load';
export interface CrusadeState {
  supply?: CrusadeSupply;
  loaded?: boolean;
  manning?: number;
  firedTurn?: number;
  plannedTurn?: number;
  riteTarget?: number;
  riteHeal?: boolean;
  manned?: boolean;
}

export const CRUSADE_COST: Record<CrusadeKind, number> = {
  crusadeSoldier: 3.5, crusadePriest: 2.5, crusadeBallista: 2.5,
  crusadeCamp: 3, crusadeHelper: 0.5,
};

export function isCrusadeKind(kind: unknown): kind is CrusadeKind {
  return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(CRUSADE_HP, kind);
}

export function crusadeRoster(players: number, rng: Pick<Dice, 'die'>): { counts: Record<CrusadeKind, number>; points: number } {
  const n = Math.max(1, Math.floor(players));
  const counts: Record<CrusadeKind, number> = {
    crusadeSoldier: n >= 3 ? 2 + Math.floor((n - 3) / 2) : 1,
    crusadePriest: 1,
    crusadeHelper: n >= 2 ? 2 + Math.max(0, n - 3) : 1,
    crusadeCamp: 1,
    crusadeBallista: 1,
  };
  const points = 7 + rng.die(5);
  let remaining = points * 2;
  while (remaining > 0) {
    const pool = (Object.keys(counts) as CrusadeKind[]).filter((kind) => CRUSADE_COST[kind] * 2 <= remaining);
    const weighted = pool.flatMap((kind) => Array.from({ length:
      kind === 'crusadeSoldier' || kind === 'crusadePriest' ? 4 : 1 + points - 8,
    }, () => kind));
    const kind = weighted[rng.die(weighted.length) - 1];
    counts[kind]++;
    remaining -= CRUSADE_COST[kind] * 2;
  }
  return { counts, points };
}

export function crusadeHelperHealth(players: number): number {
  return CRUSADE_HP.crusadeHelper * (1 + 0.75 * Math.max(0, Math.floor(players) - 1)) / 2.5;
}

export function isCrusadeBuilding(m: Mage): boolean {
  return m.enemyKind === 'crusadeCamp' || m.enemyKind === 'crusadeBallista';
}

export function isCrusadeFighter(m: Mage): boolean {
  return m.enemyKind === 'crusadeSoldier' || m.enemyKind === 'crusadePriest';
}

export function crusadeCrew(units: readonly Mage[], ballista: Mage): Mage[] {
  return units.filter((m) => m.alive && m.team === ballista.team && m.enemyKind === 'crusadeHelper'
    && m.crusade?.manning === units.indexOf(ballista) && dist(m.pos, ballista.pos) <= 2 * RANGE_UNIT);
}

export function crusadeBallistaCanFire(units: readonly Mage[], ballista: Mage): boolean {
  return !!ballista.crusade?.loaded && ballista.distMovedThisTurn === 0
    && crusadeCrew(units, ballista).length > 0;
}

export function betweenCrusadeLine(point: Mage, from: Mage, to: Mage, halfWidth: number): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  if (!length) return false;
  const share = ((point.x - from.x) * dx + (point.y - from.y) * dy) / length;
  return share > 0 && share < 1 && Math.hypot(point.x - from.x - dx * share, point.y - from.y - dy * share) <= halfWidth;
}

export function crusadeLabel(units: readonly Mage[], mage: Mage): string {
  if (mage.enemyKind === 'crusadeHelper') return mage.crusade?.supply
    ? `CARRYING ${mage.crusade.supply.toUpperCase()}` : mage.crusade?.manning != null ? 'MANNING' : '';
  if (mage.enemyKind === 'crusadeBallista') return `${mage.crusade?.loaded ? 'LOADED' : 'EMPTY'} / ${crusadeCrew(units, mage).length ? 'MANNED' : 'UNMANNED'}`;
  return '';
}