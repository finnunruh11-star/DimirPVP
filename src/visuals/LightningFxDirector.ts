import Phaser from 'phaser';
import type { Vec2 } from '../core/utils';
import { dist } from '../core/utils';

const BOLT_TEXTURE_KEY = 'fx-lightning';
const BOLT_ANIMATION_KEY = 'fx-lightning-loop';

export const LIGHTNING_FX_SHEETS = {
  charge: {
    key: 'fx-lightning-charge',
    frameWidth: 64,
    frameHeight: 64,
    end: 7,
    frameRate: 30,
  },
  impact: {
    key: 'fx-lightning-impact',
    frameWidth: 64,
    frameHeight: 64,
    end: 8,
    frameRate: 32,
  },
  strike: {
    key: 'fx-lightning-strike',
    frameWidth: 128,
    frameHeight: 128,
    end: 6,
    frameRate: 28,
  },
} as const;

type LightningSheet = (typeof LIGHTNING_FX_SHEETS)[keyof typeof LIGHTNING_FX_SHEETS];

interface StrikeOptions {
  charge: boolean;
  feedback: boolean;
  anticipation: boolean;
}

export function registerLightningFxAnimations(scene: Phaser.Scene): void {
  for (const sheet of Object.values(LIGHTNING_FX_SHEETS)) {
    if (scene.anims.exists(sheet.key)) continue;
    scene.anims.create({
      key: sheet.key,
      frames: scene.anims.generateFrameNumbers(sheet.key, { start: 0, end: sheet.end }),
      frameRate: sheet.frameRate,
      repeat: 0,
    });
  }
  if (scene.anims.exists(BOLT_ANIMATION_KEY)) return;
  scene.anims.create({
    key: BOLT_ANIMATION_KEY,
    frames: scene.anims.generateFrameNumbers(BOLT_TEXTURE_KEY, { start: 0, end: 3 }),
    frameRate: 18,
    repeat: -1,
  });
}

export class LightningFxDirector {
  private readonly active = new Set<Phaser.GameObjects.GameObject>();
  private readonly timers = new Set<Phaser.Time.TimerEvent>();
  private readonly pending = new Set<() => void>();
  private trail: Phaser.GameObjects.Sprite[] = [];
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly reducedMotion: () => boolean,
  ) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  bolt(from: Vec2, to: Vec2, color = 0xa8dcff, thickness = 1): Promise<void> {
    if (dist(from, to) < 3) return this.nova(from, color, thickness);
    return this.playStrike(from, to, color, thickness, {
      charge: true,
      feedback: true,
      anticipation: true,
    });
  }

  nova(at: Vec2, color: number, thickness = 1): Promise<void> {
    const radius = 34 + thickness * 7;
    const directions = [
      -Math.PI * 0.12,
      Math.PI * 0.38,
      Math.PI * 0.88,
      Math.PI * 1.38,
    ];
    return Promise.all(directions.map((angle, index) => this.playStrike(
      at,
      {
        x: at.x + Math.cos(angle) * radius * (index % 2 ? 0.82 : 1),
        y: at.y + Math.sin(angle) * radius * (index % 2 ? 0.82 : 1),
      },
      color,
      Math.max(0.55, thickness * 0.72),
      { charge: index === 0, feedback: index === 0, anticipation: true },
    ))).then(() => undefined);
  }

  /** Rip a bolt along one dash path; resolves as the mover lands. */
  dashStreak(from: Vec2, to: Vec2, color: number, duration: number, thickness = 1): Promise<void> {
    if (this.destroyed || dist(from, to) < 3) return Promise.resolve();
    const reduced = this.reducedMotion();
    return new Promise((resolve) => {
      this.createAnimatedSprite(LIGHTNING_FX_SHEETS.charge, from, 54 + thickness * 12, color, 31.3);
      const layers = [
        this.createBoltLayer(from, to, 30.9, {
          color,
          alpha: 0.4,
          thickness: thickness * 2.7,
          startFrame: 1,
        }),
        this.createBoltLayer(from, to, 31.1, {
          color: 0xfff2d2,
          alpha: 0.98,
          thickness: thickness * 0.72,
          startFrame: 0,
        }),
      ];
      this.createAnimatedSprite(LIGHTNING_FX_SHEETS.impact, to, 72 + thickness * 16, color, 31.5);
      this.createResidue(to, color, 66 + thickness * 14);

      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.pending.delete(finish);
        for (const layer of layers) this.release(layer);
        resolve();
      };
      this.pending.add(finish);

      if (reduced) {
        this.schedule(110, finish);
        return;
      }
      this.scene.cameras.main.shake(100, 0.0018);
      this.scene.tweens.add({ targets: layers, alpha: 0, duration, ease: 'Expo.Out' });
      this.schedule(duration + 40, finish);
    });
  }

  /** Punch a lightning impact through a body the trail has caught. */
  impact(at: Vec2, color: number, size = 86): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    const reduced = this.reducedMotion();
    return new Promise((resolve) => {
      this.createAnimatedSprite(LIGHTNING_FX_SHEETS.strike, at, size * 1.3, color, 31.35);
      this.createAnimatedSprite(LIGHTNING_FX_SHEETS.impact, at, size, color, 31.5);
      this.createResidue(at, color, size);

      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.pending.delete(finish);
        resolve();
      };
      this.pending.add(finish);

      if (!reduced) this.scene.cameras.main.shake(120, 0.0028);
      this.schedule(reduced ? 120 : 250, finish);
    });
  }

  /** The caster slamming into their own trail: a heavy, self-inflicted blast. */
  crash(at: Vec2, color: number): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    const reduced = this.reducedMotion();
    return new Promise((resolve) => {
      this.createAnimatedSprite(LIGHTNING_FX_SHEETS.strike, at, 158, color, 31.4);
      this.createAnimatedSprite(LIGHTNING_FX_SHEETS.impact, at, 110, color, 31.6);
      this.createResidue(at, color, 118);

      const sparks: Phaser.GameObjects.Sprite[] = [];
      for (let index = 0; index < 7; index++) {
        const angle = (Math.PI * 2 * index) / 7 + 0.42;
        const reach = 36 + (index % 3) * 14;
        sparks.push(this.createBoltLayer(
          at,
          { x: at.x + Math.cos(angle) * reach, y: at.y + Math.sin(angle) * reach },
          31.25,
          {
            color: index % 2 === 0 ? color : 0xfff0cc,
            alpha: 0.92,
            thickness: 0.62,
            startFrame: index % 4,
          },
        ));
      }
      const ring = this.track(this.scene.add
        .circle(at.x, at.y, 18)
        .setStrokeStyle(3, color, 0.95)
        .setDepth(31.45)
        .setBlendMode(Phaser.BlendModes.ADD));

      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.pending.delete(finish);
        for (const spark of sparks) this.release(spark);
        this.release(ring);
        resolve();
      };
      this.pending.add(finish);

      if (reduced) {
        this.schedule(170, finish);
        return;
      }
      this.scene.cameras.main.flash(130, 255, 104, 46, false);
      this.scene.cameras.main.shake(300, 0.0062);
      this.scene.tweens.add({ targets: ring, scale: 5.6, alpha: 0, duration: 430, ease: 'Cubic.Out' });
      this.scene.tweens.add({ targets: sparks, alpha: 0, duration: 360, delay: 60, ease: 'Sine.Out' });
      this.schedule(470, finish);
    });
  }

  setTrail(segments: readonly { from: Vec2; to: Vec2 }[]): void {
    this.clearTrail();
    if (this.destroyed) return;
    const newest = segments.length - 1;
    this.trail = segments.flatMap((segment, index) => [
      this.createBoltLayer(segment.from, segment.to, 7.4, {
        color: 0xff4c15,
        alpha: index === newest ? 0.46 : 0.3,
        thickness: index === newest ? 2.8 : 2.1,
        startFrame: index % 4,
      }),
      this.createBoltLayer(segment.from, segment.to, 7.5, {
        color: index === newest ? 0xffe0b0 : 0xff9a3c,
        alpha: index === newest ? 0.98 : 0.76,
        thickness: index === newest ? 0.98 : 0.72,
        startFrame: index % 4,
      }),
    ]);
  }

  clearTrail(): void {
    for (const sprite of this.trail) this.release(sprite);
    this.trail = [];
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    for (const timer of this.timers) timer.remove(false);
    this.timers.clear();
    for (const finish of [...this.pending]) finish();
    this.pending.clear();
    this.clearTrail();
    for (const object of [...this.active]) this.release(object);
    this.active.clear();
  }

  private playStrike(
    from: Vec2,
    to: Vec2,
    color: number,
    thickness: number,
    options: StrikeOptions,
  ): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    const reduced = this.reducedMotion();
    if (options.charge) {
      this.createAnimatedSprite(
        LIGHTNING_FX_SHEETS.charge,
        from,
        56 + thickness * 14,
        color,
        31.3,
      );
    }

    return new Promise((resolve) => {
      const layers: Phaser.GameObjects.Sprite[] = [];
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.pending.delete(finish);
        for (const layer of layers) this.release(layer);
        resolve();
      };
      this.pending.add(finish);

      const launch = (): void => {
        if (this.destroyed) {
          finish();
          return;
        }
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const inverseLength = 1 / Math.max(1, Math.hypot(dx, dy));
        const perpendicular = { x: -dy * inverseLength, y: dx * inverseLength };
        const offset = Math.min(4, Math.max(1.5, thickness * 1.4));
        layers.push(
          this.createBoltLayer(from, to, 30, {
            color,
            alpha: 0.3,
            thickness: thickness * 1.9,
            startFrame: 1,
          }),
          this.createBoltLayer(from, to, 31, {
            color,
            alpha: 0.96,
            thickness,
            startFrame: 0,
          }),
          this.createBoltLayer(
            { x: from.x + perpendicular.x * offset, y: from.y + perpendicular.y * offset },
            { x: to.x - perpendicular.x * offset, y: to.y - perpendicular.y * offset },
            31.2,
            {
              color: 0xffffff,
              alpha: 0.72,
              thickness: Math.max(0.42, thickness * 0.48),
              startFrame: 2,
            },
          ),
        );

        this.createAnimatedSprite(
          LIGHTNING_FX_SHEETS.strike,
          to,
          122 + thickness * 18,
          color,
          31.35,
        );
        this.createAnimatedSprite(
          LIGHTNING_FX_SHEETS.impact,
          to,
          78 + thickness * 18,
          color,
          31.5,
        );
        this.createResidue(to, color, 72 + thickness * 15);

        if (options.feedback && !reduced) {
          this.scene.cameras.main.flash(65, 150, 205, 255, false);
          this.scene.cameras.main.shake(95, 0.0014);
        }

        if (!reduced) {
          layers.forEach((layer, index) => {
            this.scene.tweens.add({
              targets: layer,
              alpha: { from: layer.alpha * 0.28, to: layer.alpha },
              scaleY: layer.scaleY * (index === 0 ? 1.14 : 0.92),
              duration: 48 + index * 15,
              yoyo: true,
              repeat: 2,
              ease: 'Sine.InOut',
            });
          });
        }
        this.schedule(reduced ? 120 : 285, finish);
      };

      if (reduced || !options.anticipation) launch();
      else this.schedule(72, launch);
    });
  }

  private createBoltLayer(
    from: Vec2,
    to: Vec2,
    depth: number,
    options: { color: number; alpha: number; thickness: number; startFrame: number },
  ): Phaser.GameObjects.Sprite {
    const length = Math.max(1, dist(from, to));
    const sprite = this.track(this.scene.add
      .sprite((from.x + to.x) / 2, (from.y + to.y) / 2, BOLT_TEXTURE_KEY, 0)
      .setDepth(depth)
      .setRotation(Math.atan2(to.y - from.y, to.x - from.x))
      .setScale(length / 210, 0.5 * options.thickness)
      .setAlpha(options.alpha)
      .setTint(options.color)
      .setBlendMode(Phaser.BlendModes.ADD));
    sprite.play({ key: BOLT_ANIMATION_KEY, startFrame: options.startFrame });
    return sprite;
  }

  private createAnimatedSprite(
    sheet: LightningSheet,
    at: Vec2,
    size: number,
    color: number,
    depth: number,
  ): void {
    if (this.destroyed || !this.scene.anims.exists(sheet.key)) return;
    const sprite = this.track(this.scene.add
      .sprite(at.x, at.y, sheet.key, 0)
      .setDepth(depth)
      .setDisplaySize(size, size)
      .setTint(color)
      .setBlendMode(Phaser.BlendModes.ADD));
    if (this.reducedMotion()) {
      sprite.setFrame(Math.min(2, sheet.end));
      this.schedule(150, () => this.release(sprite));
      return;
    }
    sprite.play(sheet.key);
    sprite.once('animationcomplete', () => this.release(sprite));
  }

  private createResidue(at: Vec2, color: number, size: number): void {
    const sheet = LIGHTNING_FX_SHEETS.impact;
    const residue = this.track(this.scene.add
      .image(at.x, at.y, sheet.key, Math.max(0, sheet.end - 1))
      .setDepth(8.4)
      .setDisplaySize(size, size)
      .setTint(color)
      .setAlpha(0.2)
      .setBlendMode(Phaser.BlendModes.ADD));
    if (this.reducedMotion()) {
      this.schedule(260, () => this.release(residue));
      return;
    }
    this.scene.tweens.add({
      targets: residue,
      alpha: 0,
      scale: 1.22,
      delay: 140,
      duration: 680,
      ease: 'Sine.Out',
      onComplete: () => this.release(residue),
    });
  }

  private schedule(delay: number, callback: () => void): void {
    if (this.destroyed) return;
    let timer: Phaser.Time.TimerEvent;
    timer = this.scene.time.delayedCall(delay, () => {
      this.timers.delete(timer);
      callback();
    });
    this.timers.add(timer);
  }

  private track<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.active.add(object);
    return object;
  }

  private release(object: Phaser.GameObjects.GameObject): void {
    if (!this.active.delete(object)) return;
    this.scene.tweens.killTweensOf(object);
    if (object.active) object.destroy();
  }
}