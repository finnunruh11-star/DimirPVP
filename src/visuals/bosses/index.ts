// The bloodmoon bosses in Phaser: each boss's frames are painted once, the
// first time its fight starts, into one strip texture per animation, under the
// same `enemy-<kind>-<anim>` keys the arena uses for every creature.

import type Phaser from 'phaser';
import { bufferTexture } from '../../world/localeRender';
import { BOSS_ART } from './art';
import { BOSS_ANIMS, GROUND, renderStrip, type BossAnim } from './rig';

/** Screen pixels to one boss art pixel in the arena, unless the art says otherwise. */
export const BOSS_PIXEL = 2;

export type BossSpriteKind = `boss-${string}`;

export const bossSpriteKind = (id: string): BossSpriteKind => `boss-${id}`;
export const bossAnimKey = (id: string, anim: BossAnim): string => `enemy-boss-${id}-${anim}`;

export interface BossSheet {
  frameW: number;
  frameH: number;
  /** Where the feet stand, as a fraction of the frame height. */
  originY: number;
  /** Screen pixels to one art pixel in the arena. */
  pixel: number;
}

/** A boss's art, or a unit of one's (a goblin raider): by art id. */
export function bossSheet(id: string): BossSheet {
  const art = BOSS_ART[id];
  return { frameW: art.w, frameH: art.h, originY: GROUND / art.h, pixel: art.pixel ?? BOSS_PIXEL };
}

export function ensureBossSprites(scene: Phaser.Scene, id: string): BossSheet {
  const art = BOSS_ART[id];
  for (const anim of BOSS_ANIMS) {
    const key = bossAnimKey(id, anim);
    if (!scene.textures.exists(key)) bufferTexture(scene, key, renderStrip(art, anim), art.w);
    if (scene.anims.exists(key)) continue;
    scene.anims.create({
      key,
      frames: Array.from({ length: art.frames[anim] }, (_, frame) => ({ key, frame })),
      frameRate: art.rate[anim],
      repeat: anim === 'idle' || anim === 'walk' ? -1 : 0,
    });
  }
  return bossSheet(id);
}
