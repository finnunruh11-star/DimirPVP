import Phaser from 'phaser';

export const SWAMP_TILESET_KEY = 'arena-swamp-tiles';
export const SWAMP_TILESET_FRAME = {
  width: 16,
  height: 16,
  spacing: 1,
} as const;
export const SWAMP_MIST_KEY = 'arena-swamp-mist';
export const SWAMP_MIST_FRAME = {
  width: 64,
  height: 64,
  end: 20,
  frameRate: 15,
} as const;

interface ArenaRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface MistPlacement {
  x: number;
  y: number;
  scale: number;
  alpha: number;
  duration: number;
  drift: number;
  start: number;
  foreground?: boolean;
}

const TILE_SCALE = 3;
const MUD_FRAME = 6;
const MUD_VARIANT_FRAME = 63;
const MUD_TINT = 0x293845;
const MUD_VARIANT_TINT = 0x19262d;
const MIST_MIN_DRIFT_PX_PER_SECOND = 30;
/** Mist is scenery, never information — one knob to keep it under the play layer. */
const MIST_ALPHA_SCALE = 0.5;

export class SwampArenaView {
  private readonly root: Phaser.GameObjects.Container;
  private readonly foreground: Phaser.GameObjects.Container;
  private readonly rootMaskShape: Phaser.GameObjects.Graphics;
  private readonly foregroundMaskShape: Phaser.GameObjects.Graphics;
  private readonly mistSprites: Phaser.GameObjects.Sprite[] = [];
  private readonly mistTweens: Phaser.Tweens.Tween[] = [];
  private combatSpeed = 1;
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly field: ArenaRect,
    private readonly reducedMotion: boolean,
  ) {
    this.root = scene.add.container(0, 0).setDepth(0);
    this.foreground = scene.add.container(0, 0).setDepth(5.6);
    this.rootMaskShape = this.applyFieldMask(this.root);
    this.foregroundMaskShape = this.applyFieldMask(this.foreground);
    this.build();
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    for (const tween of this.mistTweens) tween.remove();
    for (const mist of this.mistSprites) this.scene.tweens.killTweensOf(mist);
    if (this.root.active) this.root.destroy(true);
    if (this.foreground.active) this.foreground.destroy(true);
    if (this.rootMaskShape.active) this.rootMaskShape.destroy();
    if (this.foregroundMaskShape.active) this.foregroundMaskShape.destroy();
  }

  private build(): void {
    const floor = this.scene.add
      .tileSprite(this.field.x, this.field.y, this.field.w, this.field.h, SWAMP_TILESET_KEY, MUD_FRAME)
      .setOrigin(0)
      .setTileScale(TILE_SCALE)
      .setTint(MUD_TINT);
    const mudVariation = this.scene.add
      .tileSprite(this.field.x, this.field.y, this.field.w, this.field.h, SWAMP_TILESET_KEY, MUD_VARIANT_FRAME)
      .setOrigin(0)
      .setTileScale(TILE_SCALE)
      .setTilePosition(19, 11)
      .setTint(MUD_VARIANT_TINT)
      .setAlpha(0.38);
    this.root.add([floor, mudVariation]);

    this.addMist();

    const overlay = this.scene.add.graphics();
    overlay.lineStyle(1, 0xb3c2a6, 0.075);
    for (let x = this.field.x + 60; x < this.field.x + this.field.w; x += 60) {
      overlay.lineBetween(x, this.field.y, x, this.field.y + this.field.h);
    }
    for (let y = this.field.y + 60; y < this.field.y + this.field.h; y += 60) {
      overlay.lineBetween(this.field.x, y, this.field.x + this.field.w, y);
    }

    const centerX = this.field.x + this.field.w / 2;
    const centerY = this.field.y + this.field.h / 2;
    overlay.lineStyle(2, 0xb8aa78, 0.24).strokeCircle(centerX, centerY, 58);
    overlay.lineStyle(1, 0x8da287, 0.22).strokeCircle(centerX, centerY, 82);
    overlay.lineStyle(4, 0x261d16, 1).strokeRect(this.field.x, this.field.y, this.field.w, this.field.h);
    overlay.lineStyle(1, 0x9a7d46, 0.72)
      .strokeRect(this.field.x + 5, this.field.y + 5, this.field.w - 10, this.field.h - 10);
    this.root.add(overlay);
  }

  private addMist(): void {
    this.scene.textures.get(SWAMP_MIST_KEY).setFilter(Phaser.Textures.FilterMode.LINEAR);
    const placements: readonly MistPlacement[] = [
      { x: 0.28, y: 0.42, scale: 18, alpha: 0.045, duration: 38000, drift: 110, start: 11 },
      { x: 0.74, y: 0.6, scale: 18.5, alpha: 0.05, duration: 42000, drift: -120, start: 17 },
      { x: 0, y: 0.16, scale: 7.8, alpha: 0.15, duration: 22000, drift: 180, start: 4 },
      { x: 0.28, y: 0.2, scale: 8.2, alpha: 0.13, duration: 27000, drift: -170, start: 10 },
      { x: 0.57, y: 0.15, scale: 7.6, alpha: 0.14, duration: 24000, drift: 190, start: 15 },
      { x: 0.86, y: 0.21, scale: 8.4, alpha: 0.13, duration: 29000, drift: -200, start: 7 },
      { x: 0.1, y: 0.5, scale: 8.5, alpha: 0.14, duration: 26000, drift: -190, start: 12 },
      { x: 0.4, y: 0.53, scale: 8, alpha: 0.16, duration: 30000, drift: 210, start: 2 },
      { x: 0.7, y: 0.48, scale: 8.8, alpha: 0.13, duration: 28000, drift: -220, start: 18 },
      { x: 1, y: 0.54, scale: 8.1, alpha: 0.15, duration: 25000, drift: 180, start: 6 },
      { x: 0, y: 0.83, scale: 8.4, alpha: 0.14, duration: 29000, drift: 210, start: 13 },
      { x: 0.31, y: 0.79, scale: 8, alpha: 0.15, duration: 25000, drift: -180, start: 5 },
      { x: 0.63, y: 0.85, scale: 8.7, alpha: 0.13, duration: 31000, drift: 230, start: 16 },
      { x: 0.94, y: 0.8, scale: 8.2, alpha: 0.14, duration: 27000, drift: -210, start: 9 },
      { x: 0.12, y: 0.87, scale: 8.2, alpha: 0.035, duration: 28000, drift: 170, start: 6, foreground: true },
      { x: 0.5, y: 0.84, scale: 8.8, alpha: 0.04, duration: 32000, drift: -190, start: 13, foreground: true },
      { x: 0.88, y: 0.88, scale: 8.4, alpha: 0.035, duration: 30000, drift: 180, start: 3, foreground: true },
    ];
    for (const placement of placements) {
      const mist = this.scene.add
        .sprite(
          this.field.x + this.field.w * placement.x,
          this.field.y + this.field.h * placement.y,
          SWAMP_MIST_KEY,
          placement.start,
        )
        .setScale(placement.scale, placement.scale * 0.32)
        .setAlpha(placement.alpha * MIST_ALPHA_SCALE)
        .setTint(0x707977);
      (placement.foreground ? this.foreground : this.root).add(mist);
      this.mistSprites.push(mist);
      if (this.reducedMotion) continue;
      mist.play({ key: SWAMP_MIST_KEY, startFrame: placement.start });
      const minimumDrift = (placement.duration / 1000) * MIST_MIN_DRIFT_PX_PER_SECOND;
      const drift = Math.sign(placement.drift) * Math.max(Math.abs(placement.drift), minimumDrift);
      this.mistTweens.push(
        this.scene.tweens.add({
          targets: mist,
          x: mist.x + drift,
          duration: placement.duration,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.InOut',
        })
      );
    }
    this.setCombatSpeed(this.combatSpeed);
  }

  /**
   * Fast-forwarding combat must not fast-forward the weather: counter-scale the
   * mist so it keeps drifting and billowing at its ambient real-time pace.
   */
  setCombatSpeed(speed: number): void {
    this.combatSpeed = Math.max(0.01, speed);
    const inverse = 1 / this.combatSpeed;
    for (const mist of this.mistSprites) mist.anims.timeScale = inverse;
    for (const tween of this.mistTweens) tween.timeScale = inverse;
  }

  private applyFieldMask(target: Phaser.GameObjects.Container): Phaser.GameObjects.Graphics {
    const shape = this.scene.add.graphics().setVisible(false);
    shape.fillStyle(0xffffff).fillRect(this.field.x, this.field.y, this.field.w, this.field.h);
    target.setMask(shape.createGeometryMask());
    return shape;
  }
}