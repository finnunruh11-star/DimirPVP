// The player's mage outside of combat: the same 16px idle and run frames the
// arena uses, under the same texture and animation keys, so either scene can
// load them first.

import Phaser from 'phaser';

const globFrames = (g: Record<string, unknown>): string[] =>
  Object.keys(g)
    .sort()
    .map((k) => g[k] as string);

const SETS = [
  {
    key: 'mage-idle',
    frames: globFrames(import.meta.glob('../Sprites/Idle/*.png', { eager: true, import: 'default' })),
    frameRate: 8,
  },
  {
    key: 'mage-run',
    frames: globFrames(import.meta.glob('../Sprites/Run/*.png', { eager: true, import: 'default' })),
    frameRate: 14,
  },
];

export const MAGE_IDLE = 'mage-idle';
export const MAGE_RUN = 'mage-run';

export function preloadMageFrames(scene: Phaser.Scene): void {
  for (const set of SETS) {
    set.frames.forEach((url, i) => {
      const key = `${set.key}-${i}`;
      if (!scene.textures.exists(key)) scene.load.image(key, url);
    });
  }
}

export function createMageAnims(scene: Phaser.Scene): void {
  for (const set of SETS) {
    if (scene.anims.exists(set.key)) continue;
    scene.anims.create({
      key: set.key,
      frames: set.frames.map((_, i) => ({ key: `${set.key}-${i}` })),
      frameRate: set.frameRate,
      repeat: -1,
    });
  }
}

export const MAGE_FIRST_FRAME = `${MAGE_IDLE}-0`;
