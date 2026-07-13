import type { Vec2 } from './utils';
import type { Mage } from './Mage';

/**
 * A "scarab" summon (Curse + Drain + Corrode). Scarabs are small mobile minions
 * that chase the nearest enemy, attach, bite for a little damage, then crawl
 * back to their owner to heal them before flying out again. They have their own
 * health and sanity and can be destroyed by area effects.
 */
export type ScarabState = 'seeking' | 'attached' | 'returning' | 'resting';

export interface Scarab {
  id: number;
  x: number;
  y: number;
  /** The team that summoned the scarab and is healed when it returns. */
  owner: number;
  /** Index (in game.mages) of the summoning mage — the one healed on return. */
  ownerIndex?: number;
  hp: number;
  maxHp: number;
  sanity: number;
  maxSanity: number;
  state: ScarabState;
  /** The enemy this scarab is currently locked onto (seek / attached), if any. */
  target: Mage | null;
}

export function scarabPos(s: Scarab): Vec2 {
  return { x: s.x, y: s.y };
}

export function scarabAlive(s: Scarab): boolean {
  return s.hp > 0 && s.sanity > 0;
}

/**
 * Whether a scarab is currently in the open (flying to a foe or back home) and
 * so may be targeted / damaged. While latched on a foe (`attached`) or perched
 * on its summoner (`resting`) it rides along and cannot be hit.
 */
export function scarabFlying(s: Scarab): boolean {
  return s.state === 'seeking' || s.state === 'returning';
}
