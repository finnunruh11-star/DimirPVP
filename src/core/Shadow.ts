import type { Vec2 } from './utils';

/**
 * A pool of shadow placed on the field by the Shadow word. While it exists it:
 *  - extends the caster's spell reach (cast from / bounce through the shadow),
 *  - empowers damage when a mage stands inside it.
 */
export interface ShadowZone {
  id: number;
  x: number;
  y: number;
  radius: number;
  /** Team that conjured the shadow (only its owner casts through it). */
  owner: 1 | 2;
  /** Rounds remaining before the shadow fades. */
  ttl: number;
}

export function shadowCenter(s: ShadowZone): Vec2 {
  return { x: s.x, y: s.y };
}
