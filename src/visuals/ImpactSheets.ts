import Phaser from 'phaser';
import type { Vec2 } from '../core/utils';

import directionalImpact001Url from '../../spritesheet/Impacts/directional_impact_001/directional_impact_001_large_blue/spritesheet.png';
import directionalImpact002Url from '../../spritesheet/Impacts/directional_impact_002/directional_impact_002_large_white/spritesheet.png';
import directionalImpact003Url from '../../spritesheet/Impacts/directional_impact_003/directional_impact_003_large_violet/spritesheet.png';
import symmetricalImpact001Url from '../../spritesheet/Impacts/symmetrical_impact_001/symmetrical_impact_001_large_yellow/spritesheet.png';
import symmetricalImpact002Url from '../../spritesheet/Impacts/symmetrical_impact_002/symmetrical_impact_002_large_blue/spritesheet.png';
import symmetricalImpact003Url from '../../spritesheet/Impacts/symmetrical_impact_003/symmetrical_impact_003_large_yellow/spritesheet.png';
import symmetricalImpact004Url from '../../spritesheet/Impacts/symmetrical_impact_004/symmetrical_impact_004_large_yellow/spritesheet.png';
import symmetricalImpact006Url from '../../spritesheet/Impacts/symmetrical_impact_006/symmetrical_impact_006_large_yellow/spritesheet.png';
import burstSplatter001Url from '../../spritesheet/Splatters/burst_splatter_001/burst_splatter_001_large_red/spritesheet.png';
import burstSplatter003Url from '../../spritesheet/Splatters/burst_splatter_003/burst_splatter_003_large_green/spritesheet.png';
import directionalSplatter001Url from '../../spritesheet/Splatters/directional_splatter_001/directional_splatter_001_large_red/spritesheet.png';

/** Quarter turn; the sheets whose art sprays upward need this added to the heading. */
const UP = Math.PI / 2;

export interface ImpactSheetDef {
  url: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  frameRate: number;
  /**
   * Radians added to the blow's heading so the art points along it. Omitted on
   * symmetrical sheets, which are never rotated.
   */
  facing?: number;
}

export const IMPACT_SHEETS = {
  'impact-spray': {
    url: directionalImpact001Url,
    frameWidth: 64,
    frameHeight: 64,
    frames: 7,
    frameRate: 30,
    facing: 0,
  },
  'impact-crash': {
    url: directionalImpact002Url,
    frameWidth: 140,
    frameHeight: 50,
    frames: 7,
    frameRate: 28,
    facing: UP,
  },
  'impact-crown': {
    url: directionalImpact003Url,
    frameWidth: 80,
    frameHeight: 80,
    frames: 6,
    frameRate: 26,
    facing: UP,
  },
  'impact-gash': {
    url: directionalSplatter001Url,
    frameWidth: 64,
    frameHeight: 64,
    frames: 8,
    frameRate: 30,
    facing: UP,
  },
  'impact-star': {
    url: symmetricalImpact001Url,
    frameWidth: 96,
    frameHeight: 96,
    frames: 7,
    frameRate: 28,
  },
  'impact-frost': {
    url: symmetricalImpact002Url,
    frameWidth: 96,
    frameHeight: 96,
    frames: 10,
    frameRate: 30,
  },
  'impact-bloom': {
    url: symmetricalImpact003Url,
    frameWidth: 96,
    frameHeight: 96,
    frames: 7,
    frameRate: 26,
  },
  'impact-shards': {
    url: symmetricalImpact004Url,
    frameWidth: 96,
    frameHeight: 96,
    frames: 8,
    frameRate: 28,
  },
  'impact-cataclysm': {
    url: symmetricalImpact006Url,
    frameWidth: 160,
    frameHeight: 160,
    frames: 8,
    frameRate: 24,
  },
  'impact-splatter': {
    url: burstSplatter001Url,
    frameWidth: 64,
    frameHeight: 64,
    frames: 10,
    frameRate: 30,
  },
  'impact-rot': {
    url: burstSplatter003Url,
    frameWidth: 96,
    frameHeight: 96,
    frames: 8,
    frameRate: 26,
  },
} as const satisfies Record<string, ImpactSheetDef>;

export type ImpactSheetKey = keyof typeof IMPACT_SHEETS;

export function preloadImpactSheets(scene: Phaser.Scene): void {
  for (const [key, sheet] of Object.entries(IMPACT_SHEETS)) {
    scene.load.spritesheet(key, sheet.url, {
      frameWidth: sheet.frameWidth,
      frameHeight: sheet.frameHeight,
    });
  }
}

export function registerImpactAnimations(scene: Phaser.Scene): void {
  for (const [key, sheet] of Object.entries(IMPACT_SHEETS)) {
    if (scene.anims.exists(key) || !scene.textures.exists(key)) continue;
    scene.anims.create({
      key,
      frames: scene.anims.generateFrameNumbers(key, { start: 0, end: sheet.frames - 1 }),
      frameRate: sheet.frameRate,
      repeat: 0,
    });
  }
}

export interface HeroImpactOptions {
  color: number;
  /** Longest side the sheet is scaled to, in px. */
  size: number;
  /** Blow heading in radians; ignored by symmetrical sheets. */
  angle?: number;
  alpha?: number;
  depth?: number;
  glow?: boolean;
  /** Frozen on a mid frame instead of played, for reduced motion. */
  still?: boolean;
}

/**
 * Plays the authored impact animations. Every sheet is drawn in near-white so
 * a flat tint carries the damage type without washing the art out.
 */
export class ImpactSheetPlayer {
  private readonly active = new Set<Phaser.GameObjects.Sprite>();
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    registerImpactAnimations(scene);
  }

  play(key: ImpactSheetKey, at: Vec2, options: HeroImpactOptions): void {
    if (this.destroyed || !this.scene.anims.exists(key)) return;
    const sheet: ImpactSheetDef = IMPACT_SHEETS[key];
    const sprite = this.scene.add.sprite(at.x, at.y, key, 0);
    const longest = Math.max(sheet.frameWidth, sheet.frameHeight);
    sprite.setOrigin(0.5, 0.5);
    sprite.setScale(options.size / longest);
    sprite.setTint(options.color);
    sprite.setAlpha(options.alpha ?? 1);
    sprite.setDepth(options.depth ?? 9.7);
    if (options.glow) sprite.setBlendMode(Phaser.BlendModes.ADD);
    if (sheet.facing != null && options.angle != null) {
      sprite.setRotation(options.angle + sheet.facing);
    }
    this.active.add(sprite);

    const finish = (): void => {
      if (!this.active.delete(sprite)) return;
      if (sprite.active) sprite.destroy();
    };

    if (options.still) {
      sprite.setFrame(Math.floor(sheet.frames / 2));
      this.scene.tweens.add({
        targets: sprite,
        alpha: 0,
        delay: 90,
        duration: 130,
        onComplete: finish,
      });
      return;
    }
    sprite.play(key);
    sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, finish);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    for (const sprite of this.active) {
      this.scene.tweens.killTweensOf(sprite);
      if (sprite.active) sprite.destroy();
    }
    this.active.clear();
  }
}
