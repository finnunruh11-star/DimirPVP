// The Feared "Hrrrk Snazzlegob" and his band: the numbers their rites and
// their minds work by. Pure.

import { RANGE_UNIT } from '../config/constants';
import type { Mage } from '../core/Mage';

/** Hit points a shaman's mending restores. */
export const GOBLIN_MEND_HP = 3;
/** Each mending hastens its goblin by this share of its pace. */
export const GOBLIN_HASTE = 0.5;
/** Each hex slows its victim by this share of its pace. */
export const GOBLIN_HEX = 0.25;
/** Hastes and hexes last the bearer's next two turns (statuses tick at turn start). */
export const GOBLIN_RITE_TURNS = 3;
/** How far a shaman's mending and hexes reach. */
export const GOBLIN_RITE_RANGE = 20 * RANGE_UNIT;
/** Raiders keep within this of a shaman unless a foe is in reach. */
export const GOBLIN_SHAMAN_LEASH = 22 * RANGE_UNIT;
/** At or below this share of its health the chief falls back to be mended. */
export const GOBLIN_CHIEF_RETREAT = 0.4;

export const isGoblin = (m: Mage): boolean =>
  m.enemyKind === 'goblinChief' || m.enemyKind === 'goblinRaider' || m.enemyKind === 'goblinShaman';
