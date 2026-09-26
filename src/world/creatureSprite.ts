// Authored creature art, shared by the arena and the walkable world under the
// same texture and animation keys, so either scene can load it first. Kinds
// without a sheet of their own wear the tinted mage.

import Phaser from 'phaser';
import zombieAttackSheetUrl from '../Sprites/Zombie/Zombie_Default_Attack1 (1).png';
import zombieDeathSheetUrl from '../Sprites/Zombie/Zombie_Default_Dead (1).png';
import zombieHurtSheetUrl from '../Sprites/Zombie/Zombie_Default_Hurt (1).png';
import zombieIdleSheetUrl from '../Sprites/Zombie/Zombie_Default_Idle (1).png';
import zombieWalkSheetUrl from '../Sprites/Zombie/Zombie_Default_Walk (1).png';
import skeletonAttackSheetUrl from '../Sprites/Skeleton/Skeleton_Default_Attack_Unarmed (2).png';
import skeletonHurtSheetUrl from '../Sprites/Skeleton/Skeleton_Default_Hurt (2).png';
import skeletonIdleSheetUrl from '../Sprites/Skeleton/Skeleton_Default_Idle_Unarmed (1).png';
import skeletonWalkSheetUrl from '../Sprites/Skeleton/MP_Skeleton_Default_Walk_Unarmed (2).png';
import ghostSheetUrl from '../Sprites/Wisp/ghost.png';
import defenderSheetUrl from '../Sprites/Defender/knight-Sheet_greyfx.png';
import reaperIdleSheetUrl from '../Sprites/Reaper/wraith_original_idle_sheet.png';
import reaperWalkSheetUrl from '../Sprites/Reaper/wraith_original_walk_sheet.png';
import reaperAttackSheetUrl from '../Sprites/Reaper/wraith_original_attack_sheet.png';
import reaperHitSheetUrl from '../Sprites/Reaper/wraith_original_hit_sheet.png';
import reaperDeathSheetUrl from '../Sprites/Reaper/wraith_original_death_sheet.png';

export type CreatureSpriteKind = 'zombie' | 'skeleton' | 'wisp' | 'defender' | 'reaper';

/** Creature frames carry more empty margin than the mage's, so they are drawn this much taller. */
export const CREATURE_FRAME_RATIO = 4.5 / 2.8;

interface CreatureAnimSet {
  key: string;
  url: string;
  end: number;
  frameRate: number;
  repeat: number;
  frameWidth?: number;
  frameHeight?: number;
}

interface SheetFrameAnimSet {
  key: string;
  frames: number[];
  frameRate: number;
  repeat: number;
}

const CREATURE_ANIM_SETS: CreatureAnimSet[] = [
  { key: 'enemy-zombie-idle', url: zombieIdleSheetUrl, end: 5, frameRate: 6, repeat: -1 },
  { key: 'enemy-zombie-walk', url: zombieWalkSheetUrl, end: 5, frameRate: 10, repeat: -1 },
  { key: 'enemy-zombie-attack', url: zombieAttackSheetUrl, end: 5, frameRate: 14, repeat: 0 },
  { key: 'enemy-zombie-hurt', url: zombieHurtSheetUrl, end: 5, frameRate: 16, repeat: 0 },
  { key: 'enemy-zombie-death', url: zombieDeathSheetUrl, end: 5, frameRate: 16, repeat: 0 },
  { key: 'enemy-skeleton-idle', url: skeletonIdleSheetUrl, end: 5, frameRate: 6, repeat: -1 },
  { key: 'enemy-skeleton-walk', url: skeletonWalkSheetUrl, end: 5, frameRate: 10, repeat: -1 },
  { key: 'enemy-skeleton-attack', url: skeletonAttackSheetUrl, end: 5, frameRate: 14, repeat: 0 },
  { key: 'enemy-skeleton-hurt', url: skeletonHurtSheetUrl, end: 1, frameRate: 14, repeat: 0 },
  {
    key: 'enemy-reaper-idle',
    url: reaperIdleSheetUrl,
    end: 23,
    frameRate: 10,
    repeat: -1,
    frameWidth: 26,
    frameHeight: 24,
  },
  {
    key: 'enemy-reaper-walk',
    url: reaperWalkSheetUrl,
    end: 11,
    frameRate: 10,
    repeat: -1,
    frameWidth: 26,
    frameHeight: 24,
  },
  {
    key: 'enemy-reaper-attack',
    url: reaperAttackSheetUrl,
    end: 5,
    frameRate: 10,
    repeat: 0,
    frameWidth: 26,
    frameHeight: 24,
  },
  {
    key: 'enemy-reaper-hurt',
    url: reaperHitSheetUrl,
    end: 3,
    frameRate: 10,
    repeat: 0,
    frameWidth: 26,
    frameHeight: 24,
  },
  {
    key: 'enemy-reaper-death',
    url: reaperDeathSheetUrl,
    end: 7,
    frameRate: 10,
    repeat: 0,
    frameWidth: 26,
    frameHeight: 24,
  },
];

const WISP_SHEET = 'enemy-wisp-sheet';
const DEFENDER_SHEET = 'enemy-defender-sheet';

// ghost.png is a labelled 12x5 grid. Body/effect frames begin at column 2;
// columns 0-1 contain labels and the trailing columns are transparent padding.
const WISP_ANIM_SETS: SheetFrameAnimSet[] = [
  {
    key: 'enemy-wisp-attack',
    frames: [2, 3, 4, 5, 6, 7, 8, 14, 15, 16, 17, 18, 19, 20],
    frameRate: 14,
    repeat: 0,
  },
  { key: 'enemy-wisp-fx', frames: [26, 27, 28, 29, 30, 31], frameRate: 16, repeat: 0 },
  { key: 'enemy-wisp-walk', frames: [38, 39, 40, 41, 42, 43], frameRate: 10, repeat: -1 },
  { key: 'enemy-wisp-idle', frames: [50, 51, 52, 53, 54, 55], frameRate: 6, repeat: -1 },
];

const DEFENDER_ANIM_SETS: SheetFrameAnimSet[] = [
  { key: 'enemy-defender-idle', frames: [0, 1, 2, 3, 4, 5], frameRate: 6, repeat: -1 },
  {
    key: 'enemy-defender-walk',
    frames: [6, 7, 8, 9, 10, 11, 12, 13, 24, 25, 26, 27],
    frameRate: 10,
    repeat: -1,
  },
  {
    key: 'enemy-defender-attack',
    frames: [14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
    frameRate: 14,
    repeat: 0,
  },
  { key: 'enemy-defender-hurt', frames: [34, 35, 36], frameRate: 12, repeat: 0 },
];

/** The sheet an enemy kind wears, or null for one drawn as the tinted mage. */
export function creatureSpriteFor(enemyKind: string | null | undefined): CreatureSpriteKind | null {
  if (enemyKind === 'zombie' || enemyKind === 'acidZombie') return 'zombie';
  if (enemyKind === 'skeleton' || enemyKind === 'wisp' || enemyKind === 'defender' || enemyKind === 'reaper') {
    return enemyKind;
  }
  return null;
}

/** The wisp and defender sheets face right; the rest face left. */
export const creatureFacesRight = (kind: CreatureSpriteKind): boolean => kind === 'wisp' || kind === 'defender';

/** The texture a creature's sprite is made on before its first animation plays. */
export const creatureTexture = (kind: CreatureSpriteKind): string =>
  kind === 'wisp' ? WISP_SHEET : kind === 'defender' ? DEFENDER_SHEET : `enemy-${kind}-idle`;

export function preloadCreatureSprites(scene: Phaser.Scene): void {
  const sheet = (key: string, url: string, frameWidth: number, frameHeight: number): void => {
    if (!scene.textures.exists(key)) scene.load.spritesheet(key, url, { frameWidth, frameHeight });
  };
  for (const set of CREATURE_ANIM_SETS) sheet(set.key, set.url, set.frameWidth ?? 64, set.frameHeight ?? 64);
  sheet(WISP_SHEET, ghostSheetUrl, 32, 32);
  sheet(DEFENDER_SHEET, defenderSheetUrl, 90, 90);
}

export function createCreatureAnims(scene: Phaser.Scene): void {
  for (const set of CREATURE_ANIM_SETS) {
    if (scene.anims.exists(set.key)) continue;
    scene.anims.create({
      key: set.key,
      frames: scene.anims.generateFrameNumbers(set.key, { start: 0, end: set.end }),
      frameRate: set.frameRate,
      repeat: set.repeat,
    });
  }
  const fromSheet = (sheet: string, sets: SheetFrameAnimSet[]): void => {
    for (const set of sets) {
      if (scene.anims.exists(set.key)) continue;
      scene.anims.create({
        key: set.key,
        frames: set.frames.map((frame) => ({ key: sheet, frame })),
        frameRate: set.frameRate,
        repeat: set.repeat,
      });
    }
  };
  fromSheet(WISP_SHEET, WISP_ANIM_SETS);
  fromSheet(DEFENDER_SHEET, DEFENDER_ANIM_SETS);
}
