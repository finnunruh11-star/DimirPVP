// =============================================================================
//  SPELL VISUALS
// -----------------------------------------------------------------------------
//  Every cast animation the scene can play: beams, projectiles, novas, conjures,
//  slashes and the rest. Lifted out of GameScene so the animations can be read
//  and tuned without scrolling past the turn flow.
//
//  Presentation only: none of these touch GameState, and each resolves its
//  Promise even under reduced motion so a caller's await-chain never hangs.
// =============================================================================

import Phaser from 'phaser';
import { COLORS, FIELD, MAGE_BODY_RADIUS as MAGE_RADIUS, RANGE_UNIT } from '../config/constants';
import { FX_TWEEN } from '../effects/FxPresets';
import type { SpellVisual } from '../spells/Spell';
import { dist, type Vec2 } from '../core/utils';
import { MENU_COLOR } from '../ui/cabinet/theme';

export class SpellVfx {
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly reducedMotion: () => boolean,
    private readonly combatSpeed: () => number
  ) {}
  beam(from: Vec2, to: Vec2, visual: SpellVisual): Promise<void> {
    const distance = dist(from, to);
    if (distance < 3) return this.burst(to, visual.color, 24, visual.speed ?? 1);

    return new Promise((resolve) => {
      const speed = Math.max(0.25, visual.speed ?? 1);
      const thickness = Phaser.Math.Clamp(visual.size ?? 6, 3, 16);
      const unit = { x: (to.x - from.x) / distance, y: (to.y - from.y) / distance };
      const perpendicular = { x: -unit.y, y: unit.x };
      const start = {
        x: from.x + unit.x * (MAGE_RADIUS * 0.55),
        y: from.y + unit.y * (MAGE_RADIUS * 0.55),
      };
      const end = {
        x: to.x - unit.x * Math.min(5, thickness * 0.5),
        y: to.y - unit.y * Math.min(5, thickness * 0.5),
      };
      const length = Math.max(1, dist(start, end));
      const segments = Phaser.Math.Clamp(Math.ceil(length / 18), 14, 52);
      const duration = this.reducedMotion()
        ? 120
        : Phaser.Math.Clamp(FX_TWEEN.beam.duration / speed, 230, 520);
      const seed = (
        from.x * 0.017 +
        from.y * 0.029 +
        to.x * 0.041 +
        to.y * 0.053 +
        (visual.color & 0xfff) * 0.001
      ) % (Math.PI * 2);
      const curveBias = Math.sin(seed * 2.31) * Math.min(22, length * 0.045);
      const graphics = this.scene.add
        .graphics()
        .setDepth(31)
        .setBlendMode(Phaser.BlendModes.ADD);
      const state = { life: 0 };
      let impactStarted = false;

      const pointAt = (amount: number, phase: number, lane = 0): Vec2 => {
        const envelope = Math.sin(Math.PI * amount);
        const broadCurve = envelope * curveBias;
        const primaryWave = Math.sin(amount * Math.PI * 4 + phase + seed) * thickness * 0.62;
        const secondaryWave = Math.sin(amount * Math.PI * 9 - phase * 1.37 + seed * 0.7) * thickness * 0.24;
        const laneMotion = lane * thickness * (
          0.68 + 0.16 * Math.sin(amount * Math.PI * 6 + phase * 0.73 + seed)
        );
        const offset = envelope * (broadCurve + primaryWave + secondaryWave + laneMotion);
        return {
          x: Phaser.Math.Linear(start.x, end.x, amount) + perpendicular.x * offset,
          y: Phaser.Math.Linear(start.y, end.y, amount) + perpendicular.y * offset,
        };
      };

      const buildPath = (reveal: number, phase: number, lane = 0): Vec2[] => {
        if (reveal <= 0) return [start];
        const count = Math.max(1, Math.floor(segments * reveal));
        const points: Vec2[] = [];
        for (let index = 0; index <= count; index++) {
          points.push(pointAt(Math.min(reveal, index / segments), phase, lane));
        }
        const finalAmount = Math.min(1, reveal);
        const lastAmount = count / segments;
        if (lastAmount < finalAmount) points.push(pointAt(finalAmount, phase, lane));
        return points;
      };

      const strokePath = (points: readonly Vec2[], width: number, color: number, alpha: number): void => {
        if (points.length < 2 || alpha <= 0) return;
        graphics.lineStyle(Math.max(1, width), color, Phaser.Math.Clamp(alpha, 0, 1));
        graphics.beginPath();
        graphics.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index++) {
          graphics.lineTo(points[index].x, points[index].y);
        }
        graphics.strokePath();
      };

      const render = (): void => {
        if (!graphics.active) return;
        const life = state.life;
        const reveal = Phaser.Math.Clamp(life / 0.27, 0, 1);
        const attack = Phaser.Math.Clamp(life / 0.1, 0, 1);
        const decay = life < 0.62 ? 1 : Phaser.Math.Clamp(1 - (life - 0.62) / 0.38, 0, 1);
        const opacity = attack * decay;
        const phase = this.reducedMotion() ? seed : seed + life * Math.PI * 11;
        const breathing = 0.9 + Math.sin(life * Math.PI * 18 + seed) * 0.1;
        const centre = buildPath(reveal, phase);

        graphics.clear();
        strokePath(centre, thickness * 5.2 * breathing, visual.color, 0.1 * opacity);
        strokePath(centre, thickness * 2.5 * breathing, visual.color, 0.54 * opacity);
        strokePath(centre, thickness * 1.12, visual.color, 0.96 * opacity);
        strokePath(centre, thickness * 0.36, 0xffffff, 0.98 * opacity);

        if (!this.reducedMotion()) {
          const upper = buildPath(reveal, phase + 0.9, 1);
          const lower = buildPath(reveal, phase - 1.1, -1);
          strokePath(upper, thickness * 0.34, visual.color, 0.44 * opacity);
          strokePath(upper, thickness * 0.12, 0xffffff, 0.58 * opacity);
          strokePath(lower, thickness * 0.3, visual.color, 0.36 * opacity);

          for (let index = 0; index < 4; index++) {
            const knotAmount = (life * 2.15 + index * 0.247) % 1;
            if (knotAmount > reveal) continue;
            const knot = pointAt(knotAmount, phase, index % 2 ? 0.28 : -0.28);
            const knotRadius = thickness * (0.32 + (index % 3) * 0.08);
            graphics.fillStyle(visual.color, 0.45 * opacity).fillCircle(knot.x, knot.y, knotRadius * 2.2);
            graphics.fillStyle(0xffffff, 0.82 * opacity).fillCircle(knot.x, knot.y, knotRadius);
          }

          for (let index = 0; index < 6; index++) {
            const sparkAmount = Phaser.Math.Clamp(reveal * ((index + 1) / 7), 0, 1);
            const spark = pointAt(sparkAmount, phase + index * 0.83);
            const scatter = Math.sin(phase * 1.7 + index * 2.41) * thickness * (2.1 + index * 0.08);
            const sparkX = spark.x + perpendicular.x * scatter;
            const sparkY = spark.y + perpendicular.y * scatter;
            graphics.fillStyle(index % 2 ? visual.color : 0xffffff, 0.42 * opacity)
              .fillCircle(sparkX, sparkY, Math.max(1, thickness * 0.15));
          }
        }

        const sourcePulse = thickness * (1.7 + attack * 0.9);
        graphics.fillStyle(visual.color, 0.18 * opacity).fillCircle(start.x, start.y, sourcePulse * 1.7);
        graphics.lineStyle(Math.max(1, thickness * 0.22), 0xffffff, 0.74 * opacity)
          .strokeCircle(start.x, start.y, sourcePulse);

        if (reveal > 0.72) {
          const impact = Phaser.Math.Clamp((reveal - 0.72) / 0.28, 0, 1);
          const impactRadius = thickness * (1.4 + impact * 2.8);
          graphics.fillStyle(visual.color, 0.22 * opacity).fillCircle(end.x, end.y, impactRadius * 1.5);
          graphics.lineStyle(Math.max(1, thickness * 0.26), 0xffffff, (1 - impact * 0.45) * opacity)
            .strokeCircle(end.x, end.y, impactRadius);
        }

        if (!impactStarted && reveal >= 1) {
          impactStarted = true;
          void this.burst(to, visual.color, Math.max(20, thickness * 3.1), speed * 1.45);
        }
      };

      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, finish);
        this.scene.tweens.killTweensOf(state);
        if (graphics.active) graphics.destroy();
        resolve();
      };
      this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, finish);
      render();
      this.scene.tweens.add({
        targets: state,
        life: 1,
        duration,
        ease: FX_TWEEN.beam.ease,
        onUpdate: render,
        onComplete: finish,
      });
    });
  }

  drainParticles(from: Vec2, to: Vec2): Promise<void> {
    const distance = dist(from, to);
    if (distance < 3) return Promise.resolve();

    return new Promise((resolve) => {
      const count = this.reducedMotion() ? 12 : 34;
      const duration = this.reducedMotion() ? 220 : Phaser.Math.Clamp(distance * 1.55, 460, 760);
      const midpointY = (from.y + to.y) * 0.5;
      const arcHeight = this.reducedMotion() ? 28 : Phaser.Math.Clamp(distance * 0.3, 58, 138);
      const upwardRoom = Math.max(18, midpointY - FIELD.y - 16);
      const downwardRoom = Math.max(18, FIELD.y + FIELD.h - midpointY - 16);
      const colors = [0x153d29, 0x1e5636, 0x2b6f42, 0x3f8752];
      const particles: { root: Phaser.GameObjects.Container; progress: { value: number } }[] = [];
      let remaining = count;
      let settled = false;

      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, finish);
        for (const particle of particles) {
          this.scene.tweens.killTweensOf(particle.progress);
          if (particle.root.active) particle.root.destroy(true);
        }
        resolve();
      };
      this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, finish);

      for (let index = 0; index < count; index++) {
        const phase = index * 2.39996;
        const sourceSpread = 5 + (index % 7) * 1.8;
        const start = {
          x: from.x + Math.cos(phase) * sourceSpread,
          y: from.y + Math.sin(phase) * sourceSpread,
        };
        const radius = 2.6 + (index % 4) * 0.55;
        const root = this.scene.add.container(start.x, start.y).setDepth(32);
        const halo = this.scene.add
          .circle(0, 0, radius * 2.25, 0x4c9d61, 0.2)
          .setBlendMode(Phaser.BlendModes.ADD);
        const ball = this.scene.add
          .circle(0, 0, radius, colors[index % colors.length], 0.98)
          .setStrokeStyle(1, 0x8fc99b, 0.82);
        const glint = this.scene.add.circle(-radius * 0.28, -radius * 0.28, Math.max(0.8, radius * 0.26), 0xc5e3bd, 0.78);
        root.add([halo, ball, glint]);
        root.setAlpha(0);
        const progress = { value: 0 };
        particles.push({ root, progress });
        const laneDirection = index % 2 === 0 ? -1 : 1;
        const laneRoom = laneDirection < 0 ? upwardRoom : downwardRoom;
        const laneArc = Math.min(arcHeight * (0.78 + (index % 6) * 0.065), laneRoom);
        const sidewaysDrift = ((index % 7) - 3) * 1.8;
        this.scene.tweens.add({
          targets: progress,
          value: 1,
          delay: index * (this.reducedMotion() ? 7 : 14),
          duration: duration + (index % 5) * 24,
          ease: 'Sine.In',
          onUpdate: () => {
            const amount = progress.value;
            const parabola = 4 * amount * (1 - amount);
            const fadeIn = Phaser.Math.Clamp(amount / 0.08, 0, 1);
            const fadeOut = Phaser.Math.Clamp((1 - amount) / 0.1, 0, 1);
            root
              .setPosition(
                Phaser.Math.Linear(start.x, to.x, amount) + sidewaysDrift * parabola,
                Phaser.Math.Linear(start.y, to.y, amount) + laneDirection * laneArc * parabola
              )
              .setAlpha(fadeIn * fadeOut)
              .setScale(0.82 + Math.sin(Math.PI * amount) * 0.28 - amount * 0.24);
          },
          onComplete: () => {
            if (root.active) root.destroy(true);
            remaining -= 1;
            if (remaining === 0) finish();
          },
        });
      }
    });
  }

  /** Implode at a departure point and bloom at an arrival point. */
  blink(from: Vec2, to: Vec2, color: number): void {
    if (dist(from, to) < 2) return;
    this.blinkGate(from, color, 'out');
    this.blinkGate(to, color, 'in');
  }

  blinkGate(at: Vec2, color: number, phase: 'out' | 'in'): void {
    const leaving = phase === 'out';
    const duration = this.reducedMotion() ? 120 : leaving ? 200 : 270;
    const parts: Phaser.GameObjects.GameObject[] = [];
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, finish);
      for (const part of parts) {
        this.scene.tweens.killTweensOf(part);
        if (part.active) part.destroy();
      }
    };
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, finish);

    const ring = this.scene.add
      .circle(at.x, at.y, MAGE_RADIUS * (leaving ? 1.6 : 0.4))
      .setStrokeStyle(3, color, 0.9)
      .setDepth(30.5)
      .setBlendMode(Phaser.BlendModes.ADD);
    const core = this.scene.add
      .circle(at.x, at.y, MAGE_RADIUS * 0.55, color, leaving ? 0.45 : 0.7)
      .setDepth(30.4)
      .setBlendMode(Phaser.BlendModes.ADD);
    parts.push(ring, core);
    this.scene.tweens.add({
      targets: ring,
      scale: leaving ? 0.15 : 3.1,
      alpha: 0,
      duration,
      ease: leaving ? 'Cubic.In' : 'Cubic.Out',
    });
    this.scene.tweens.add({
      targets: core,
      scale: leaving ? 0.1 : 1.9,
      alpha: 0,
      duration: duration * 0.85,
      ease: 'Sine.Out',
    });

    const shardCount = this.reducedMotion() ? 0 : 8;
    for (let index = 0; index < shardCount; index++) {
      const angle = (Math.PI * 2 * index) / shardCount + (leaving ? 0.35 : 0);
      const near = MAGE_RADIUS * 0.35;
      const far = MAGE_RADIUS * 2.1;
      const shard = this.scene.add
        .rectangle(
          at.x + Math.cos(angle) * (leaving ? far : near),
          at.y + Math.sin(angle) * (leaving ? far : near),
          11,
          2.6,
          color,
          0.95
        )
        .setRotation(angle)
        .setDepth(30.6)
        .setBlendMode(Phaser.BlendModes.ADD);
      parts.push(shard);
      this.scene.tweens.add({
        targets: shard,
        x: at.x + Math.cos(angle) * (leaving ? near : far),
        y: at.y + Math.sin(angle) * (leaving ? near : far),
        alpha: 0,
        duration,
        ease: leaving ? 'Cubic.In' : 'Cubic.Out',
      });
    }
    this.scene.time.delayedCall(duration + 40, finish);
  }

  boomerang(
    from: Vec2,
    to: Vec2,
    color: number,
    size: number,
    speed: number
  ): Promise<void> {
    const distance = dist(from, to);
    if (distance < 3) return Promise.resolve();

    return new Promise((resolve) => {
      const unit = { x: (to.x - from.x) / distance, y: (to.y - from.y) / distance };
      const perpendicular = { x: -unit.y, y: unit.x };
      const arc = this.reducedMotion() ? 0 : Math.min(74, Math.max(24, distance * 0.16));
      const duration = this.reducedMotion()
        ? 110
        : Phaser.Math.Clamp((distance / (760 * Math.max(0.25, speed))) * 1000, 220, 620);
      const root = this.scene.add.container(from.x, from.y).setDepth(32);
      const glow = this.scene.add
        .circle(0, 0, size * 1.15, color, 0.2)
        .setBlendMode(Phaser.BlendModes.ADD);
      const shard = this.scene.add
        .polygon(
          0,
          0,
          [
            -size * 1.35, 0,
            -size * 0.2, -size * 0.55,
            size * 1.4, 0,
            -size * 0.2, size * 0.55,
          ],
          color,
          1
        )
        .setStrokeStyle(Math.max(1, size * 0.14), 0xf4eaff, 0.92);
      const core = this.scene.add
        .circle(size * 0.15, 0, Math.max(1.5, size * 0.18), 0xffffff, 0.9)
        .setBlendMode(Phaser.BlendModes.ADD);
      root.add([glow, shard, core]);

      const progress = { value: 0 };
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, finish);
        this.scene.tweens.killTweensOf(progress);
        if (root.active) root.destroy(true);
        resolve();
      };
      this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, finish);
      this.scene.tweens.add({
        targets: progress,
        value: 1,
        duration,
        ease: 'Sine.InOut',
        onUpdate: () => {
          const amount = progress.value;
          const lift = Math.sin(Math.PI * amount) * arc;
          root
            .setPosition(
              Phaser.Math.Linear(from.x, to.x, amount) + perpendicular.x * lift,
              Phaser.Math.Linear(from.y, to.y, amount) + perpendicular.y * lift
            )
            .setRotation(Math.atan2(unit.y, unit.x) + amount * Math.PI * 7);
          glow.setAlpha(0.14 + Math.sin(amount * Math.PI * 6) * 0.08);
        },
        onComplete: finish,
      });
    });
  }

  summonPuff(at: Vec2, size: number): Promise<void> {
    const key = 'fx-summon-smoke';
    if (!this.scene.anims.exists(key)) return Promise.resolve();
    return new Promise((resolve) => {
      const sprite = this.scene.add
        .sprite(at.x, at.y, key, 0)
        .setDepth(10)
        .setDisplaySize(size, size);
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, finish);
        if (sprite.active) sprite.destroy();
        resolve();
      };
      this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, finish);
      sprite.play(key);
      sprite.once('animationcomplete', finish);
    });
  }

  projectile(from: Vec2, to: Vec2, visual: SpellVisual): Promise<void> {
    const distance = dist(from, to);
    if (distance < 3) return this.burst(to, visual.color, 28, visual.speed ?? 1);

    return new Promise((resolve) => {
      const speed = Math.max(0.25, visual.speed ?? 1);
      const radius = Phaser.Math.Clamp(visual.size ?? 10, 5, 18);
      const unit = { x: (to.x - from.x) / distance, y: (to.y - from.y) / distance };
      const start = {
        x: from.x + unit.x * (MAGE_RADIUS * 0.65),
        y: from.y + unit.y * (MAGE_RADIUS * 0.65),
      };
      const end = { x: to.x - unit.x * 4, y: to.y - unit.y * 4 };
      const arc = this.reducedMotion() ? 0 : Math.min(28, distance * 0.065);
      const duration = this.reducedMotion()
        ? 90
        : Phaser.Math.Clamp(
          (distance / (FX_TWEEN.projectile.pixelsPerSecond * speed)) * 1000,
          FX_TWEEN.projectile.minDuration,
          FX_TWEEN.projectile.maxDuration,
        );

      const root = this.scene.add.container(start.x, start.y).setDepth(31);
      const tail = this.scene.add
        .rectangle(-radius * 0.8, 0, radius * 3.4, radius * 1.25, visual.color, 0.24)
        .setOrigin(1, 0.5)
        .setBlendMode(Phaser.BlendModes.ADD);
      const innerTail = this.scene.add
        .rectangle(-radius * 0.35, 0, radius * 2.25, Math.max(2, radius * 0.42), 0xffffff, 0.58)
        .setOrigin(1, 0.5)
        .setBlendMode(Phaser.BlendModes.ADD);
      const aura = this.scene.add
        .circle(0, 0, radius * 1.6, visual.color, 0.24)
        .setBlendMode(Phaser.BlendModes.ADD);
      const body = this.scene.add.circle(0, 0, radius, visual.color, 0.96);
      const core = this.scene.add
        .circle(-radius * 0.12, -radius * 0.12, Math.max(2, radius * 0.38), 0xffffff, 0.92)
        .setBlendMode(Phaser.BlendModes.ADD);
      root.add([tail, innerTail, aura, body, core]);
      root.setScale(this.reducedMotion() ? 1 : 0.72);

      const progress = { value: 0 };
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, finish);
        this.scene.tweens.killTweensOf(root);
        this.scene.tweens.killTweensOf(aura);
        this.scene.tweens.killTweensOf(progress);
        if (root.active) root.destroy(true);
        resolve();
      };
      this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, finish);

      if (!this.reducedMotion()) {
        this.scene.tweens.add({
          targets: root,
          scale: 1,
          duration: Math.min(130, duration * 0.4),
          ease: 'Back.Out',
        });
        this.scene.tweens.add({
          targets: aura,
          scale: 1.28,
          alpha: 0.12,
          duration: 90,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.InOut',
        });
      }

      this.scene.tweens.add({
        targets: progress,
        value: 1,
        duration,
        ease: FX_TWEEN.projectile.ease,
        onUpdate: () => {
          const amount = progress.value;
          const x = Phaser.Math.Linear(start.x, end.x, amount);
          const y = Phaser.Math.Linear(start.y, end.y, amount) - Math.sin(Math.PI * amount) * arc;
          const tangentX = end.x - start.x;
          const tangentY = end.y - start.y - Math.cos(Math.PI * amount) * Math.PI * arc;
          root.setPosition(x, y).setRotation(Math.atan2(tangentY, tangentX));
        },
        onComplete: () => {
          this.scene.tweens.killTweensOf(aura);
          if (root.active) root.destroy(true);
          void this.burst(to, visual.color, Math.max(26, radius * 3.1), speed).then(finish);
        },
      });
    });
  }

  /** A conjured attack that simply erupts on the target — no projectile travel. */
  conjure(at: Vec2, v: SpellVisual): Promise<void> {
    return new Promise((resolve) => {
      const speed = v.speed ?? 1;
      const size = v.size ?? 26;
      // A quick gathering flash, then a sharp shockwave at the target.
      const spark = this.scene.add.circle(at.x, at.y, size * 0.4, 0xffffff, 0.9).setDepth(31);
      this.scene.tweens.add({
        targets: spark,
        scale: { from: 0.2, to: 1.6 },
        alpha: { from: 0.9, to: 0 },
        duration: FX_TWEEN.conjureGather.duration / speed,
        ease: FX_TWEEN.conjureGather.ease,
        onComplete: () => spark.destroy(),
      });
      // A few jagged shards stabbing inward.
      for (let i = 0; i < 6; i++) {
        const ang = (Math.PI * 2 * i) / 6;
        const r0 = size * 1.8;
        const shard = this.scene.add
          .circle(at.x + Math.cos(ang) * r0, at.y + Math.sin(ang) * r0, size * 0.22, v.color, 1)
          .setDepth(31);
        this.scene.tweens.add({
          targets: shard,
          x: at.x,
          y: at.y,
          alpha: { from: 1, to: 0.2 },
          duration: FX_TWEEN.conjureShard.duration / speed,
          ease: FX_TWEEN.conjureShard.ease,
          onComplete: () => shard.destroy(),
        });
      }
      this.burst(at, v.color, size * 2.2, speed).then(resolve);
    });
  }

  /** A positive glow with rising sparkles on the target (heals / buffs / team). */
  heal(at: Vec2, v: SpellVisual): Promise<void> {
    return new Promise((resolve) => {
      const speed = v.speed ?? 1;
      const size = v.size ?? 30;
      // A soft glow that swells and fades around the target.
      const glow = this.scene.add.circle(at.x, at.y, size, v.color, 0.5).setDepth(29);
      glow.setStrokeStyle(3, 0xffffff, 0.8);
      this.scene.tweens.add({
        targets: glow,
        scale: { from: 0.4, to: 1.5 },
        alpha: { from: 0.6, to: 0 },
        duration: FX_TWEEN.healGlow.duration / speed,
        ease: FX_TWEEN.healGlow.ease,
        onComplete: () => glow.destroy(),
      });
      // Rising sparkles.
      for (let i = 0; i < 8; i++) {
        const dx = (i / 7 - 0.5) * size * 2;
        const sparkle = this.scene.add
          .circle(at.x + dx, at.y + size * 0.6, 3, 0xffffff, 1)
          .setDepth(31);
        this.scene.tweens.add({
          targets: sparkle,
          y: at.y - size * 1.2,
          alpha: { from: 1, to: 0 },
          duration: FX_TWEEN.healSparkle.duration / speed,
          delay: (i * FX_TWEEN.healSparkle.stagger) / speed,
          ease: FX_TWEEN.healSparkle.ease,
          onComplete: () => sparkle.destroy(),
        });
      }
      this.scene.time.delayedCall((FX_TWEEN.healGlow.duration + 20) / speed, resolve);
    });
  }

  burst(at: Vec2, color: number, reach: number, speed: number): Promise<void> {
    return new Promise((resolve) => {
      const ring = this.scene.add.circle(at.x, at.y, Math.max(8, reach), color, 0.2).setDepth(31);
      ring.setStrokeStyle(3, color, 1);
      ring.setScale(0.15);
      ring.setAlpha(0.95);
      this.scene.tweens.add({
        targets: ring,
        scale: 1,
        alpha: 0,
        duration: FX_TWEEN.burst.duration / (speed || 1),
        ease: FX_TWEEN.burst.ease,
        onComplete: () => {
          ring.destroy();
          resolve();
        },
      });
    });
  }

  nova(at: Vec2, v: SpellVisual): Promise<void> {
    return this.burst(at, v.color, v.size ?? 55, v.speed ?? 1);
  }

  quarterTurn(clockwise: boolean): void {
    const camera = this.scene.cameras.main;
    this.scene.tweens.add({
      targets: camera,
      rotation: clockwise ? Math.PI / 2 : -Math.PI / 2,
      duration: FX_TWEEN.quarterTurn.duration / this.combatSpeed(),
      yoyo: true,
      hold: FX_TWEEN.quarterTurn.hold / this.combatSpeed(),
      ease: FX_TWEEN.quarterTurn.ease,
    });
  }

  twistRune(pivot: Vec2, radius: number, clockwise: boolean): void {
    const ring = this.scene.add.circle(pivot.x, pivot.y, radius, 0xb8c878, 0.08).setDepth(30);
    ring.setStrokeStyle(4, 0xdfffa8, 0.9);
    const marker = this.scene.add.circle(pivot.x + radius, pivot.y, 7, 0xffffff, 1).setDepth(31);
    const progress = { angle: 0 };
    this.scene.tweens.add({
      targets: progress,
      angle: clockwise ? -Math.PI / 2 : Math.PI / 2,
      duration: FX_TWEEN.twistMarker.duration / this.combatSpeed(),
      ease: FX_TWEEN.twistMarker.ease,
      onUpdate: () => {
        marker.setPosition(
          pivot.x + Math.cos(progress.angle) * radius,
          pivot.y + Math.sin(progress.angle) * radius
        );
      },
      onComplete: () => marker.destroy(),
    });
    this.scene.tweens.add({
      targets: ring,
      scale: { from: 0.25, to: 1 },
      alpha: { from: 0.9, to: 0 },
      duration: FX_TWEEN.twistRune.duration / this.combatSpeed(),
      ease: FX_TWEEN.twistRune.ease,
      onComplete: () => ring.destroy(),
    });
  }

  /**
   * Play a one-shot fx sprite sheet at a location, for ground-targeted spells.
   *  - `apexAtFrom`: anchor the sprite's apex at the caster and extend it toward
   *    `at` (used for cones — the sheet faces left, so its apex is the right edge).
   *  - `aim`: rotate a point-centred sheet to face the cast direction.
   *  - `lengthPx`: the on-field size (cone length / blast diameter) in pixels.
   */
  spriteAt(
    key: string,
    at: Vec2,
    opts: { from?: Vec2; apexAtFrom?: boolean; aim?: boolean; lengthPx: number }
  ): Promise<void> {
    return new Promise((resolve) => {
      if (!this.scene.anims.exists(key)) {
        resolve();
        return;
      }
      const spr = this.scene.add.sprite(at.x, at.y, key).setDepth(9);
      const frameW = spr.width || 1;
      const frameH = spr.height || 1;
      if (opts.apexAtFrom && opts.from) {
        // Cone: apex at the caster, body fanning out toward the aimed point.
        spr.setOrigin(1, 0.5);
        spr.setPosition(opts.from.x, opts.from.y);
        spr.setScale(opts.lengthPx / frameW);
        const ang = Math.atan2(at.y - opts.from.y, at.x - opts.from.x);
        spr.setRotation(ang - Math.PI); // the sheet's cone faces left by default
      } else {
        spr.setOrigin(0.5, 0.5);
        spr.setScale(opts.lengthPx / frameH);
        if (opts.aim && opts.from) {
          const ang = Math.atan2(at.y - opts.from.y, at.x - opts.from.x);
          spr.setRotation(ang - Math.PI);
        }
      }
      spr.play(key);
      spr.once('animationcomplete', () => {
        spr.destroy();
        resolve();
      });
    });
  }

  /**
   * Play a one-shot slash animation (from the Pixel Art Slashes library) centred
   * at `at`, rotated to `angle` (the sheets face right by default), and scaled so
   * its width spans `sizePx`. Used to dress up melee strikes and the Cleave sweep.
   */
  slash(animKey: string, at: Vec2, angle: number, sizePx: number): Promise<void> {
    return new Promise((resolve) => {
      const firstFrame = `${animKey}-0`;
      if (!this.scene.anims.exists(animKey) || !this.scene.textures.exists(firstFrame)) {
        resolve();
        return;
      }
      const spr = this.scene.add.sprite(at.x, at.y, firstFrame).setDepth(32);
      const frameW = spr.width || 1;
      spr.setOrigin(0.5, 0.5);
      spr.setScale(sizePx / frameW);
      spr.setRotation(angle);
      spr.play(animKey);
      spr.once('animationcomplete', () => {
        spr.destroy();
        resolve();
      });
    });
  }

  /**
   * Paint the shatter cone stretched to fill a reality wedge barrier: the sheet's
   * apex is pinned to `apex` and its body is scaled non-uniformly so its length
   * matches `range` and its far-edge width matches the wedge's arc (`halfAngle`).
   * The sheet's cone faces left by default, so we rotate it to open toward `angle`.
   */
  wedge(apex: Vec2, angle: number, halfAngle: number, range: number): void {
    const key = 'fx-shatter';
    if (!this.scene.anims.exists(key)) return;
    const spr = this.scene.add.sprite(apex.x, apex.y, key).setDepth(9);
    const frameW = spr.width || 1;
    const frameH = spr.height || 1;
    spr.setOrigin(1, 0.5); // apex sits at the sheet's right edge
    spr.setRotation(angle - Math.PI); // the sheet's cone faces left by default
    const farWidth = 2 * range * Math.tan(halfAngle);
    spr.setScale(range / frameW, Math.max(farWidth, 1) / frameH);
    spr.play(key);
    spr.once('animationcomplete', () => spr.destroy());
  }

}

