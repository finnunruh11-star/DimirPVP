import Phaser from 'phaser';
import type { Vec2 } from '../core/utils';

/**
 * Pooled one-shot particle bursts. Presentation only: every value here is
 * either authored or derived from `Math.random`, never from `gs.rng`.
 */

export type ParticleShape = 'mote' | 'shard' | 'spark' | 'ring' | 'smoke';

const TEXTURE_KEYS: Record<ParticleShape, string> = {
  mote: 'fx-particle-mote',
  shard: 'fx-particle-shard',
  spark: 'fx-particle-spark',
  ring: 'fx-particle-ring',
  smoke: 'fx-particle-smoke',
};

/** Base pixel size each shape is drawn at, used to normalise `size` requests. */
const TEXTURE_SIZE: Record<ParticleShape, number> = {
  mote: 32,
  shard: 16,
  spark: 40,
  ring: 48,
  smoke: 64,
};

export interface BurstOptions {
  color: number;
  /** Particles emitted. Scaled down under reduced motion. */
  count: number;
  /** Peak outward speed in px/s; each particle draws from 35-100% of it. */
  speed: number;
  lifespan: number;
  shape?: ParticleShape;
  /** Diameter of the largest particle, in px. */
  size?: number;
  /** Degrees. Omit for a full circle. */
  angle?: { min: number; max: number };
  gravityY?: number;
  /** Additive blending, for anything that should read as light. */
  glow?: boolean;
  /** Radius the emission points are jittered over. */
  spread?: number;
  depth?: number;
  /** Spin shards as they fly. */
  tumble?: boolean;
  /** Fraction of speed shed per second, so thrown matter decelerates. */
  drag?: number;
  /** Point the sprite along its own travel, for streaks. */
  alignToTravel?: boolean;
  /** Seconds of jitter on when each particle appears. */
  stagger?: number;
  /** Peak opacity; smoke and grit should not start at full strength. */
  alpha?: number;
}

function canvasTexture(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): void {
  if (scene.textures.exists(key)) return;
  const texture = scene.textures.createCanvas(key, width, height);
  const ctx = texture?.getContext();
  if (!texture || !ctx) return;
  draw(ctx, width, height);
  texture.refresh();
}

/**
 * Draw the particle textures once per scene. These are canvas gradients rather
 * than stacked shapes: a real alpha falloff is the difference between a glowing
 * mote and a flat disc.
 */
function ensureTextures(scene: Phaser.Scene): void {
  canvasTexture(scene, TEXTURE_KEYS.mote, TEXTURE_SIZE.mote, TEXTURE_SIZE.mote, (ctx, w) => {
    const mid = w / 2;
    const grad = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.28, 'rgba(255,255,255,0.92)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.38)');
    grad.addColorStop(0.8, 'rgba(255,255,255,0.1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, w);
  });

  canvasTexture(scene, TEXTURE_KEYS.smoke, TEXTURE_SIZE.smoke, TEXTURE_SIZE.smoke, (ctx, w) => {
    const mid = w / 2;
    const grad = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
    grad.addColorStop(0, 'rgba(255,255,255,0.5)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.26)');
    grad.addColorStop(0.75, 'rgba(255,255,255,0.08)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, w);
    // Bite holes out so the puff has structure instead of reading as fog.
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.6;
      const r = mid * (0.3 + (i % 3) * 0.16);
      const cx = mid + Math.cos(a) * r;
      const cy = mid + Math.sin(a) * r;
      const hole = ctx.createRadialGradient(cx, cy, 0, cx, cy, mid * 0.3);
      hole.addColorStop(0, 'rgba(0,0,0,0.55)');
      hole.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = hole;
      ctx.fillRect(0, 0, w, w);
    }
    ctx.globalCompositeOperation = 'source-over';
  });

  // A streak that is bright and hard at the head and fades off the tail.
  canvasTexture(scene, TEXTURE_KEYS.spark, TEXTURE_SIZE.spark, 10, (ctx, w, h) => {
    const mid = h / 2;
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    grad.addColorStop(0.85, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0.85)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w * 0.7, mid - 3);
    ctx.lineTo(w, mid);
    ctx.lineTo(w * 0.7, mid + 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.beginPath();
    ctx.arc(w - 2.5, mid, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });

  // Chips stay hard-edged; a lit face and a shaded face give them a read.
  canvasTexture(scene, TEXTURE_KEYS.shard, TEXTURE_SIZE.shard, TEXTURE_SIZE.shard, (ctx, w) => {
    const mid = w / 2;
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.beginPath();
    ctx.moveTo(mid, 0);
    ctx.lineTo(w, mid * 0.78);
    ctx.lineTo(mid * 0.74, w);
    ctx.lineTo(0, mid * 1.12);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.beginPath();
    ctx.moveTo(mid, 0);
    ctx.lineTo(w, mid * 0.78);
    ctx.lineTo(mid * 0.74, w);
    ctx.closePath();
    ctx.fill();
  });

  canvasTexture(scene, TEXTURE_KEYS.ring, TEXTURE_SIZE.ring, TEXTURE_SIZE.ring, (ctx, w) => {
    const mid = w / 2;
    const grad = ctx.createRadialGradient(mid, mid, mid * 0.6, mid, mid, mid);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.62, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.82, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, w);
  });
}

/**
 * Phaser has no per-particle drag, so bleed velocity off each frame. Matter
 * that decelerates reads as thrown; matter at constant speed reads as a
 * screensaver.
 */
class DragProcessor extends Phaser.GameObjects.Particles.ParticleProcessor {
  constructor(private readonly keep: number) {
    super(0, 0, true);
  }

  update(particle: Phaser.GameObjects.Particles.Particle, delta: number): void {
    const damp = Math.pow(this.keep, delta / 1000);
    particle.velocityX *= damp;
    particle.velocityY *= damp;
  }
}

export class ParticleFx {
  private readonly emitters = new Set<Phaser.GameObjects.Particles.ParticleEmitter>();
  private readonly timers = new Set<Phaser.Time.TimerEvent>();
  private combatSpeed = 1;
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly reducedMotion: () => boolean,
  ) {
    ensureTextures(scene);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  /** Fire a one-shot burst that tears itself down once the last particle dies. */
  burst(at: Vec2, options: BurstOptions): void {
    if (this.destroyed) return;
    const reduced = this.reducedMotion();
    const shape = options.shape ?? 'mote';
    const count = Math.max(1, Math.round(options.count * (reduced ? 0.4 : 1)));
    const authored = options.lifespan * (reduced ? 0.45 : 1);
    // Emitters run on raw scene delta, so fast-forward has to be applied here.
    const lifespan = Math.round(authored / this.combatSpeed);
    const size = options.size ?? TEXTURE_SIZE[shape];
    const scale = size / TEXTURE_SIZE[shape];
    const speed = options.speed * (reduced ? 0.5 : 1) * this.combatSpeed;
    const spread = options.spread ?? 0;
    const emitAngle = options.angle ?? { min: 0, max: 360 };
    const staggerMs = ((options.stagger ?? 0) * 1000) / this.combatSpeed;
    const peak = options.alpha ?? 0.95;

    const config: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig = {
      lifespan: { min: lifespan * 0.62, max: lifespan },
      speed: { min: speed * 0.35, max: speed },
      angle: emitAngle,
      // Ease both curves so particles thin and fade instead of popping out.
      scale: { start: scale, end: shape === 'ring' ? scale * 2.1 : 0, ease: 'Quad.Out' },
      alpha: { start: peak, end: 0, ease: 'Quad.In' },
      rotate: options.alignToTravel
        ? emitAngle
        : options.tumble
          ? { min: -220, max: 220 }
          : 0,
      gravityY: (options.gravityY ?? 0) * this.combatSpeed * this.combatSpeed,
      tint: options.color,
      blendMode: options.glow ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL,
      emitting: false,
    };
    if (staggerMs > 0) config.delay = { min: 0, max: staggerMs };
    if (spread > 0) {
      config.emitZone = {
        type: 'random',
        source: new Phaser.Geom.Circle(0, 0, spread),
        quantity: count,
      };
    }

    const emitter = this.scene.add.particles(at.x, at.y, TEXTURE_KEYS[shape], config);
    emitter.setDepth(options.depth ?? 9.5);
    if (options.drag != null) {
      emitter.addParticleProcessor(new DragProcessor(Phaser.Math.Clamp(1 - options.drag, 0.001, 1)));
    }
    emitter.explode(count);
    this.emitters.add(emitter);

    // Emitters have no "all particles finished" event, so retire them on a timer.
    const retireAfter = authored + (options.stagger ?? 0) * 1000 + 140;
    const timer = this.scene.time.delayedCall(retireAfter, () => {
      this.timers.delete(timer);
      this.emitters.delete(emitter);
      if (emitter.active) emitter.destroy();
    });
    this.timers.add(timer);
  }

  /** Keep bursts in step with the 4x combat-speed toggle. */
  setCombatSpeed(speed: number): void {
    this.combatSpeed = Math.max(0.01, speed);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    for (const timer of this.timers) timer.remove();
    this.timers.clear();
    for (const emitter of this.emitters) {
      if (emitter.active) emitter.destroy();
    }
    this.emitters.clear();
  }
}
