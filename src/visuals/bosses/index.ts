// The bloodmoon bosses in Phaser: each painted boss's frames are painted once,
// the first time its fight starts, into one strip texture per animation; a boss
// drawn from authored sheets (see ./authored) has its strips loaded with the
// scene. Either way they go under the `enemy-<kind>-<anim>` keys the arena uses
// for every creature.

import type Phaser from 'phaser';
import { bufferTexture } from '../../world/localeRender';
import { BOSS_ART } from './art';
import { AUTHORED_BOSSES, authoredIdleSpecial, type AuthoredBoss } from './authored';
import { BOSS_ANIMS, GROUND, renderStrip, type BossAnim } from './rig';
import lillithIdleUrl from '../../Sprites/ShadeQueen/idle.png';
import lillithInspectUrl from '../../Sprites/ShadeQueen/idle_inspect.png';
import lillithWalkUrl from '../../Sprites/ShadeQueen/walk.png';
import lillithAttackUrl from '../../Sprites/ShadeQueen/attack.png';
import lillithStabUrl from '../../Sprites/ShadeQueen/stab.png';
import lillithComboUrl from '../../Sprites/ShadeQueen/combo.png';
import lillithHurtUrl from '../../Sprites/ShadeQueen/hurt.png';
import lillithDeathUrl from '../../Sprites/ShadeQueen/death.png';
import lillithTauntUrl from '../../Sprites/ShadeQueen/taunt.png';
import lillithChantUrl from '../../Sprites/ShadeQueen/chant.png';

/** Screen pixels to one boss art pixel in the arena, unless the art says otherwise. */
export const BOSS_PIXEL = 2;

export type BossSpriteKind = `boss-${string}`;

export const bossSpriteKind = (id: string): BossSpriteKind => `boss-${id}`;
/** Whether a boss has authored sheets; the rest are drawn as the tinted mage. */
export const hasBossSprites = (id: string): boolean => !!AUTHORED_BOSSES[id] || id === 'rock';
export const bossAnimKey = (id: string, anim: BossAnim): string => `enemy-boss-${id}-${anim}`;
const stripKey = (id: string, strip: string): string => `enemy-boss-${id}-${strip}`;

/** Where each authored boss's strips are, by boss and strip. */
const AUTHORED_URLS: Record<string, Record<string, string>> = {
  lillith: {
    idle: lillithIdleUrl,
    idle_inspect: lillithInspectUrl,
    walk: lillithWalkUrl,
    attack: lillithAttackUrl,
    stab: lillithStabUrl,
    combo: lillithComboUrl,
    hurt: lillithHurtUrl,
    death: lillithDeathUrl,
    taunt: lillithTauntUrl,
    chant: lillithChantUrl,
  },
};

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
  const authored = AUTHORED_BOSSES[id];
  if (authored) return { frameW: authored.w, frameH: authored.h, originY: authored.ground / authored.h, pixel: authored.pixel };
  const art = BOSS_ART[id];
  return { frameW: art.w, frameH: art.h, originY: (art.ground ?? GROUND) / art.h, pixel: art.pixel ?? BOSS_PIXEL };
}

/** Queue every authored boss's strips with the scene's loader. */
export function preloadBossSheets(scene: Phaser.Scene): void {
  for (const [id, urls] of Object.entries(AUTHORED_URLS)) {
    const boss = AUTHORED_BOSSES[id];
    for (const [strip, url] of Object.entries(urls)) {
      const key = stripKey(id, strip);
      if (!scene.textures.exists(key)) scene.load.spritesheet(key, url, { frameWidth: boss.w, frameHeight: boss.h });
    }
  }
}

export function ensureBossSprites(scene: Phaser.Scene, id: string): BossSheet {
  const authored = AUTHORED_BOSSES[id];
  if (authored) {
    ensureAuthoredSprites(scene, id, authored);
    return bossSheet(id);
  }
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

/** An authored boss's animation strips; idle specials are chosen per sprite. */
function ensureAuthoredSprites(scene: Phaser.Scene, id: string, boss: AuthoredBoss): void {
  const strip = (name: string) =>
    Array.from({ length: boss.strips[name].frames }, (_, frame) => ({ key: stripKey(id, name), frame }));
  for (const [name, { rate }] of Object.entries(boss.strips)) {
    const key = stripKey(id, name);
    if (scene.anims.exists(key) || !scene.textures.exists(key)) continue;
    scene.anims.create({ key, frames: strip(name), frameRate: rate, repeat: name === 'idle' || name === 'walk' ? -1 : 0 });
  }
}

export function bossIsIdleSpecial(id: string, key: string | undefined): key is string {
  const special = AUTHORED_BOSSES[id]?.special;
  return !!special && (key === stripKey(id, special.strip) || (!!special.alternate && key === stripKey(id, special.alternate.strip)));
}

export function bindBossIdleSpecial(sprite: Phaser.GameObjects.Sprite, id: string): void {
  const special = AUTHORED_BOSSES[id]?.special;
  if (!special) return;
  const idle = bossAnimKey(id, 'idle');
  let loops = 0;
  sprite.on('animationstart', (animation: Phaser.Animations.Animation) => {
    if (animation.key !== idle) loops = 0;
  });
  sprite.on('animationrepeat', (animation: Phaser.Animations.Animation) => {
    if (animation.key !== idle || ++loops < special.every) return;
    loops = 0;
    const strip = authoredIdleSpecial(id, Math.random());
    if (strip && sprite.scene.anims.exists(stripKey(id, strip))) sprite.play(stripKey(id, strip));
  });
  sprite.on('animationcomplete', (animation: Phaser.Animations.Animation) => {
    if (bossIsIdleSpecial(id, animation.key)) sprite.play(idle);
  });
}

/** The animations a boss strikes with, taken in turn. */
export function bossAttackKeys(id: string): string[] {
  const authored = AUTHORED_BOSSES[id];
  return authored ? authored.attacks.map((name) => stripKey(id, name)) : [bossAnimKey(id, 'attack')];
}

/** A boss's own spell animation, and how far into it the spell takes effect. */
export function bossCast(id: string): { key: string; peakMs: number } | null {
  const boss = AUTHORED_BOSSES[id];
  if (!boss?.cast) return null;
  return { key: stripKey(id, boss.cast.strip), peakMs: (1000 * boss.cast.peak) / boss.strips[boss.cast.strip].rate };
}
