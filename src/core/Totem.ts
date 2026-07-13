import type { Vec2 } from './utils';

/**
 * A persistent ground hazard (placed by Corrode + Curse). Each round it damages
 * and slows enemy mages standing within its aura, then ages by one until it
 * crumbles.
 */
export interface Totem {
  id: number;
  x: number;
  y: number;
  radius: number;
  owner: number;
  /** Index (in game.mages) of the mage that placed it — lifesteal heals THEM. */
  ownerIndex?: number;
  ttl: number;
  /** Dice spec rolled for each victim each turn (e.g. "1d3"). */
  damageSpec: string;
  /** Fractional move-speed reduction applied to victims (0..1). */
  slow: number;
  /** If true, the owner heals for the damage the aura deals (Drain + Curse). */
  lifesteal?: boolean;
}

export function totemCenter(t: Totem): Vec2 {
  return { x: t.x, y: t.y };
}
