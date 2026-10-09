// Every painted boss's art by boss id, and the art of the units some bosses bring
// (by unit art id). Bosses drawn from authored sheets are in ../authored instead.

import type { BossId } from '../../../pve/exploration/bloodmoon';
import { ramp, type BossArt } from '../rig';
import { TIER1, UNITS1 } from './tier1';
import { TIER2, UNITS2 } from './tier2';
import { TIER3, UNITS3 } from './tier3';
import { WILD } from './wild';
import { creatureArt } from '../../creatures';
import { ENEMY_LOOKS } from '../../creatureLooks';
import { moay } from './moay';

export const BOSS_ART: Record<BossId, BossArt> & Record<string, BossArt> = { ...TIER1, ...TIER2, ...TIER3, ...UNITS1, ...UNITS2, ...UNITS3, ...WILD } as Record<BossId, BossArt>;
BOSS_ART.rock = moay;
for (const kind of ['crusadeSoldier', 'crusadePriest', 'crusadeHelper'] as const) {
	BOSS_ART[kind] = { ...creatureArt(ENEMY_LOOKS[kind]!), pixel: 1.5 };
}
for (const kind of ['crusadeCamp', 'crusadeBallista'] as const) {
	BOSS_ART[kind] = {
		...creatureArt(ENEMY_LOOKS[kind]!), pixel: 1.5,
		draw(canvas, pose) {
			const cloth = ramp('#615d50', '#96917b', '#d9d3b9', '#f6f2dc');
			const wood = ramp('#403529', '#776348', '#b5a073', '#d9c792');
			const recoil = pose.anim === 'attack' ? Math.sin(pose.t * Math.PI) * 3 : 0;
			const fall = pose.anim === 'death' ? pose.t * 12 : 0;
			if (kind === 'crusadeCamp') {
				canvas.poly([[6, 58], [32, 18 + fall], [58, 58]], cloth);
				canvas.poly([[32, 18 + fall], [32, 58], [58, 58]], cloth, 0.35);
				canvas.poly([[23, 58], [32, 33 + fall], [41, 58]], wood, 0.1);
				canvas.line(32, 18 + fall, 4, 58, 0x6d624b);
				canvas.line(32, 18 + fall, 60, 58, 0x6d624b);
				canvas.line(44, 39, 44, 50, 0xe0b450, 3);
				canvas.line(39, 43, 49, 43, 0xe0b450, 3);
				canvas.rect(46, 51, 12, 7, 0x79684c);
				canvas.rect(47, 52, 10, 2, 0xf0e8d0);
			} else {
				canvas.ellipse(18, 52, 6, 6, wood);
				canvas.ellipse(47, 52, 6, 6, wood);
				canvas.rect(14, 45 + fall, 38, 4, 0xa18b60);
				canvas.rect(30 + recoil, 24 + fall, 5, 26, 0xc5b17c);
				canvas.line(8, 30 + fall, 31 + recoil, 20 + fall, 0xdac58a, 4);
				canvas.line(31 + recoil, 20 + fall, 55, 30 + fall, 0xbda36a, 4);
				canvas.line(8, 30 + fall, 55, 30 + fall, 0xf3e8ba);
				canvas.line(32 + recoil, 14 + fall, 32 + recoil, 39 + fall, 0xffe8a1, 2);
				canvas.poly([[28 + recoil, 19 + fall], [32 + recoil, 12 + fall], [36 + recoil, 19 + fall]], cloth);
				canvas.rect(18, 53, 1, 2, 0xeedeb3);
				canvas.rect(47, 53, 1, 2, 0xeedeb3);
			}
		},
	};
}

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
