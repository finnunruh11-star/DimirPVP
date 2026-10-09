import { FIELD } from '../config/constants';
import type { GameState } from '../core/GameState';
import type { Mage } from '../core/Mage';
import { dist, type Vec2 } from '../core/utils';

export interface MoayArena {
  remaining: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MOAY_AOE_RADIUS = Math.hypot(FIELD.w, FIELD.h) * Math.sqrt(0.1);

export function moayArena(remaining: number): MoayArena {
  const scale = Math.sqrt(remaining / 100);
  const w = FIELD.w * scale;
  const h = FIELD.h * scale;
  return { remaining, x: FIELD.x + (FIELD.w - w) / 2, y: FIELD.y + (FIELD.h - h) / 2, w, h };
}

export function clampToMoayArena(arena: MoayArena | undefined, point: Vec2, radius = 0): Vec2 {
  if (!arena) return point;
  const insetX = Math.min(radius + 1, arena.w / 2);
  const insetY = Math.min(radius + 1, arena.h / 2);
  return {
    x: Math.max(arena.x + insetX, Math.min(arena.x + arena.w - insetX, point.x)),
    y: Math.max(arena.y + insetY, Math.min(arena.y + arena.h - insetY, point.y)),
  };
}

export function moayTurnStart(game: GameState, boss: Mage): void {
  if (!boss.alive || boss.enemyKind !== 'moay') return;
  boss.moayTurns += 1;
  if (boss.moayTurns <= 2) {
    boss.actions = { move: 0, main: 0, bonus: 0 };
    game.log(`${boss.name} waits (${boss.moayTurns}/2).`);
    return;
  }
  const remaining = game.moayArena?.remaining ?? 100;
  if (remaining <= 10) return;
  const arena = game.moayArena = moayArena(Math.max(10, remaining - 20));
  const centre = { x: arena.x + arena.w / 2, y: arena.y + arena.h / 2 };
  const units = game.mages.filter((m) => m.alive && m.summonShoulder == null)
    .sort((first, second) => dist(first.pos, centre) - dist(second.pos, centre));
  for (const unit of units) {
    const bounded = clampToMoayArena(arena, unit.pos, unit.bodyRadius());
    if (dist(bounded, unit.pos) < 0.01) continue;
    const dx = unit.x - centre.x;
    const dy = unit.y - centre.y;
    const share = Math.min(1,
      (arena.w / 2 - Math.min(unit.bodyRadius() + 2, arena.w / 2)) / Math.max(0.01, Math.abs(dx)),
      (arena.h / 2 - Math.min(unit.bodyRadius() + 2, arena.h / 2)) / Math.max(0.01, Math.abs(dy)));
    const desired = { x: centre.x + dx * share, y: centre.y + dy * share };
    const landing = game.nearestFreePosition(unit, desired);
    unit.x = landing.x;
    unit.y = landing.y;
  }
  game.updateAttachedScarabs();
  game.refreshSandFooting();
  game.log(`${boss.name} closes the stone walls: ${arena.remaining}% of the arena remains.`);
}

export function moayTargets(game: GameState, boss: Mage, centre: Vec2): Mage[] {
  return game.livingEnemiesOf(boss).filter((m) =>
    dist(centre, m.pos) <= MOAY_AOE_RADIUS && !game.isPhasedOut(m) && !game.wallBetween(centre, m.pos));
}