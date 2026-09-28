// Every boss's art by boss id, and the art of the units some bosses bring (by unit art id).

import type { BossId } from '../../../pve/exploration/bloodmoon';
import type { BossArt } from '../rig';
import { TIER1, UNITS1 } from './tier1';
import { TIER2, UNITS2 } from './tier2';
import { TIER3 } from './tier3';

export const BOSS_ART: Record<BossId, BossArt> & Record<string, BossArt> = { ...TIER1, ...TIER2, ...TIER3, ...UNITS1, ...UNITS2 } as Record<BossId, BossArt>;

/** The art ids of units that fight under a boss. */
export const UNIT_ART_IDS: readonly string[] = [...Object.keys(UNITS1), ...Object.keys(UNITS2)];
