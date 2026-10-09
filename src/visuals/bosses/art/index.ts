// Every painted boss's art by boss id, and the art of the units some bosses bring
// (by unit art id). Bosses drawn from authored sheets are in ../authored instead.

import type { BossId } from '../../../pve/exploration/bloodmoon';
import type { BossArt } from '../rig';
import { TIER1, UNITS1 } from './tier1';
import { TIER2, UNITS2 } from './tier2';
import { TIER3, UNITS3 } from './tier3';
import { WILD } from './wild';
import { creatureArt } from '../../creatures';
import { ENEMY_LOOKS } from '../../creatureLooks';
import { moay } from './moay';

export const BOSS_ART: Record<BossId, BossArt> & Record<string, BossArt> = { ...TIER1, ...TIER2, ...TIER3, ...UNITS1, ...UNITS2, ...UNITS3, ...WILD } as Record<BossId, BossArt>;
BOSS_ART.rock = moay;

for (const [artId, kind] of Object.entries({
	goblins: 'goblinChief',
	'goblin-chief': 'goblinChief',
	'goblin-raider': 'goblinRaider',
	'goblin-shaman': 'goblinShaman',
} as const)) {
	BOSS_ART[artId] = creatureArt(ENEMY_LOOKS[kind]!);
}

/** The art ids of units that fight under a boss, or turn up in a roadside scene. */
export const UNIT_ART_IDS: readonly string[] = [...Object.keys(UNITS1), ...Object.keys(UNITS2), ...Object.keys(UNITS3), ...Object.keys(WILD)];
