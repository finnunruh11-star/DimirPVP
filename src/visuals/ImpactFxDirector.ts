import Phaser from 'phaser';
import type { DamageType } from '../core/Damage';
import type { Vec2 } from '../core/utils';
import type { CombatFeedback } from '../effects/effects';
import { IMPACT_FX, type ImpactWeight } from '../effects/FxPresets';
import { DAMAGE_COLORS } from './CombatFeedbackLayer';
import { ImpactSheetPlayer, type ImpactSheetKey } from './ImpactSheets';
import type { BurstOptions, ParticleFx } from './ParticleFx';

export interface ImpactRequest {
  at: Vec2;
  feedback: CombatFeedback;
  /** Share of the target's max pool this hit took, 0-1. */
  severity: number;
  /** Direction the blow travelled, in radians, for directional art and debris. */
  angle?: number;
  /** Earned from the spell's word combination; the only source of shake. */
  weight?: ImpactWeight;
  /** Sprite to white out, when the target has one on screen. */
  sprite?: Phaser.GameObjects.Sprite;
}

type Scatter = Omit<BurstOptions, 'color'> & { color?: number };

interface Recipe {
  /** Authored animation played at the point of contact. */
  hero: ImpactSheetKey;
  heroSize: number;
  heroGlow?: boolean;
  /** Bright primary scatter. */
  scatter: Scatter;
  /** Optional second pass: grit, embers or smoke under the bright layer. */
  secondary?: Scatter;
}

/**
 * How each damage type reads. The hero sheet carries the silhouette; the
 * scatter carries the force, because only the scatter knows how hard the blow
 * landed and which way it came from.
 */
const DAMAGE_RECIPES: Record<DamageType, Recipe> = {
  pierce: {
    hero: 'impact-spray',
    heroSize: 96,
    heroGlow: true,
    scatter: {
      count: 10, speed: 340, lifespan: 300, shape: 'spark', size: 22,
      glow: true, drag: 0.9, alignToTravel: true,
    },
  },
  slashing: {
    hero: 'impact-gash',
    heroSize: 104,
    scatter: {
      count: 13, speed: 380, lifespan: 320, shape: 'spark', size: 26,
      glow: true, drag: 0.88, alignToTravel: true, stagger: 0.03,
    },
    secondary: {
      count: 7, speed: 150, lifespan: 620, shape: 'mote', size: 9,
      gravityY: 420, drag: 0.5,
    },
  },
  shatter: {
    hero: 'impact-crash',
    heroSize: 132,
    scatter: {
      count: 16, speed: 280, lifespan: 560, shape: 'shard', size: 13,
      gravityY: 780, tumble: true, drag: 0.55, stagger: 0.04,
    },
    secondary: {
      count: 6, speed: 90, lifespan: 900, shape: 'smoke', size: 54,
      alpha: 0.34, drag: 0.9, spread: 14,
    },
  },
  shadow: {
    hero: 'impact-shards',
    heroSize: 108,
    scatter: {
      count: 15, speed: 165, lifespan: 620, shape: 'mote', size: 17,
      gravityY: -80, spread: 12, drag: 0.75, stagger: 0.05,
    },
    secondary: {
      count: 5, speed: 70, lifespan: 860, shape: 'smoke', size: 60,
      alpha: 0.3, gravityY: -40, drag: 0.85,
    },
  },
  corrosive: {
    hero: 'impact-rot',
    heroSize: 104,
    scatter: {
      count: 14, speed: 175, lifespan: 700, shape: 'mote', size: 14,
      gravityY: 460, spread: 12, drag: 0.4, stagger: 0.05,
    },
  },
  heat: {
    hero: 'impact-bloom',
    heroSize: 112,
    heroGlow: true,
    scatter: {
      count: 20, speed: 210, lifespan: 620, shape: 'mote', size: 12,
      gravityY: -240, glow: true, drag: 0.7, stagger: 0.07,
    },
    secondary: {
      count: 5, speed: 60, lifespan: 940, shape: 'smoke', size: 52,
      alpha: 0.26, gravityY: -110, drag: 0.9,
    },
  },
  light: {
    hero: 'impact-frost',
    heroSize: 112,
    heroGlow: true,
    scatter: {
      count: 16, speed: 300, lifespan: 380, shape: 'mote', size: 14,
      glow: true, drag: 0.85,
    },
  },
  typeless: {
    hero: 'impact-star',
    heroSize: 100,
    heroGlow: true,
    scatter: {
      count: 12, speed: 260, lifespan: 360, shape: 'mote', size: 13,
      glow: true, drag: 0.82,
    },
  },
  generic: {
    hero: 'impact-star',
    heroSize: 88,
    scatter: {
      count: 10, speed: 230, lifespan: 340, shape: 'mote', size: 12, drag: 0.8,
    },
  },
  cold: {
    hero: 'impact-frost',
    heroSize: 108,
    scatter: {
      count: 14, speed: 240, lifespan: 520, shape: 'shard', size: 11,
      gravityY: 320, tumble: true, drag: 0.7, stagger: 0.04,
    },
  },
  water: {
    hero: 'impact-bloom',
    heroSize: 104,
    scatter: {
      count: 16, speed: 200, lifespan: 560, shape: 'mote', size: 13,
      gravityY: 620, spread: 14, drag: 0.5, stagger: 0.04,
    },
  },
  malforming: {
    hero: 'impact-shards',
    heroSize: 104,
    scatter: {
      count: 13, speed: 160, lifespan: 700, shape: 'mote', size: 16,
      spread: 16, drag: 0.6, tumble: true, stagger: 0.06,
    },
  },
  cleansing: {
    hero: 'impact-frost',
    heroSize: 100,
    heroGlow: true,
    scatter: {
      count: 13, speed: 150, lifespan: 640, shape: 'mote', size: 13,
      gravityY: -190, glow: true, drag: 0.7, stagger: 0.06,
    },
  },
  healing: {
    hero: 'impact-bloom',
    heroSize: 96,
    heroGlow: true,
    scatter: {
      count: 13, speed: 140, lifespan: 680, shape: 'mote', size: 13,
      gravityY: -210, glow: true, drag: 0.7, stagger: 0.06,
    },
  },
};

/** Types whose scatter is thrown along the blow rather than radially. */
const DIRECTIONAL_TYPES = new Set<DamageType>(['pierce', 'slashing', 'shatter']);
/** Types that leave chips on the ground behind the combatants. */
const DEBRIS_TYPES = new Set<DamageType>(['shatter', 'pierce', 'slashing']);

const SANITY_COLOR = 0xd184c5;
const WARD_COLOR = 0xc9a961;
const MISS_COLOR = 0x8da89d;

interface FlashState {
  tinted: boolean;
  tint: number;
  fill: boolean;
  timer: Phaser.Time.TimerEvent;
}

export class ImpactFxDirector {
  private readonly sheets: ImpactSheetPlayer;
  private readonly timers = new Set<Phaser.Time.TimerEvent>();
  private readonly flashing = new Map<Phaser.GameObjects.Sprite, FlashState>();
  private hitstopTimer?: Phaser.Time.TimerEvent;
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly particles: ParticleFx,
    private readonly reducedMotion: () => boolean,
    private readonly baseTimeScale: () => number,
  ) {
    this.sheets = new ImpactSheetPlayer(scene);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  /** Play the full reaction to one combat readout: art, matter, flash, shake. */
  play(request: ImpactRequest): void {
    if (this.destroyed) return;
    const { feedback } = request;
    const severity = Phaser.Math.Clamp(request.severity, 0, 1);
    const big = severity >= IMPACT_FX.heavySeverity || !!feedback.critical;

    this.spawnImpact(request, severity);

    switch (feedback.kind) {
      case 'damage':
      case 'sanityDamage':
        if (request.sprite) this.flash(request.sprite, !!feedback.critical);
        if (big) this.hitstop(feedback.critical ? 'crit' : 'normal');
        break;
      default:
        break;
    }

    if (request.weight) this.shake(request.weight);
  }

  /** White out a struck sprite without losing whatever tint it already wore. */
  flash(sprite: Phaser.GameObjects.Sprite, critical: boolean): void {
    if (this.destroyed || this.reducedMotion() || !sprite.active) return;
    const duration = critical ? IMPACT_FX.flash.critDuration : IMPACT_FX.flash.duration;
    const active = this.flashing.get(sprite);
    if (active) {
      // Already white: extend it. Re-reading the tint now would record the
      // flash itself as the colour to restore and strand the sprite white.
      active.timer.remove();
      active.timer = this.scene.time.delayedCall(duration, () => this.endFlash(sprite));
      return;
    }
    const state: FlashState = {
      tinted: sprite.isTinted,
      tint: sprite.tintTopLeft,
      fill: sprite.tintFill,
      timer: this.scene.time.delayedCall(duration, () => this.endFlash(sprite)),
    };
    this.flashing.set(sprite, state);
    sprite.setTintFill(IMPACT_FX.flash.color);
  }

  private endFlash(sprite: Phaser.GameObjects.Sprite): void {
    const state = this.flashing.get(sprite);
    if (!state) return;
    this.flashing.delete(sprite);
    state.timer.remove();
    if (!sprite.active) return;
    if (state.tinted) {
      sprite.setTint(state.tint);
      sprite.tintFill = state.fill;
    } else {
      sprite.clearTint();
    }
  }

  /**
   * Bite a hole in the animation clock. `time.timeScale` is deliberately left
   * alone so the restore timer runs at full speed and can always undo this.
   */
  hitstop(kind: 'normal' | 'crit'): void {
    if (this.destroyed || this.reducedMotion()) return;
    const base = this.baseTimeScale();
    this.scene.tweens.timeScale = base * IMPACT_FX.hitstop.scale;
    this.scene.anims.globalTimeScale = base * IMPACT_FX.hitstop.scale;
    this.hitstopTimer?.remove();
    const duration = kind === 'crit' ? IMPACT_FX.hitstop.critDuration : IMPACT_FX.hitstop.duration;
    this.hitstopTimer = this.scene.time.delayedCall(duration, () => {
      this.hitstopTimer = undefined;
      this.restoreTimeScale();
    });
  }

  shake(weight: ImpactWeight): void {
    if (this.destroyed || this.reducedMotion()) return;
    const { duration, intensity } = IMPACT_FX.shake[weight];
    this.scene.cameras.main.shake(duration, intensity);
  }

  /** A decree stamped on the field: the Order word's own mark. */
  sigil(at: Vec2, color: number, size: number): void {
    if (this.destroyed) return;
    const reduced = this.reducedMotion();
    this.sheets.play('impact-star', at, { color, size, glow: true, still: reduced });
    this.particles.burst(at, {
      color,
      count: 14,
      speed: 210,
      lifespan: 460,
      shape: 'mote',
      size: 12,
      glow: true,
      drag: 0.85,
      stagger: 0.05,
    });
    this.particles.burst(at, {
      color, count: 1, speed: 0, lifespan: 420, shape: 'ring', size: size * 0.8, glow: true,
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    for (const sprite of [...this.flashing.keys()]) this.endFlash(sprite);
    this.sheets.destroy();
    this.hitstopTimer?.remove();
    this.hitstopTimer = undefined;
    for (const timer of this.timers) timer.remove();
    this.timers.clear();
    this.restoreTimeScale();
  }

  private restoreTimeScale(): void {
    const base = this.baseTimeScale();
    this.scene.tweens.timeScale = base;
    this.scene.anims.globalTimeScale = base;
  }

  private spawnImpact(request: ImpactRequest, severity: number): void {
    const { feedback, at } = request;
    const reduced = this.reducedMotion();
    const color = this.colorFor(feedback);

    if (feedback.kind === 'immune' || feedback.kind === 'blocked') {
      this.sheets.play('impact-star', at, {
        color: WARD_COLOR, size: 74, alpha: 0.9, still: reduced,
      });
      this.particles.burst(at, {
        color, count: 8, speed: 190, lifespan: 280, shape: 'spark', size: 16,
        drag: 0.9, alignToTravel: true,
      });
      return;
    }
    if (feedback.kind === 'miss') {
      this.particles.burst(at, {
        color, count: 6, speed: 220, lifespan: 240, shape: 'spark', size: 15,
        alpha: 0.7, drag: 0.9, alignToTravel: true,
      });
      return;
    }

    const type = this.damageTypeFor(feedback);
    const recipe = DAMAGE_RECIPES[type];
    // A heavier hit throws more, faster — a graze should not look like a crit.
    const force = 0.7 + severity * 1.5 + (feedback.critical ? 0.45 : 0);
    const directed = request.angle != null && DIRECTIONAL_TYPES.has(type);

    this.sheets.play(recipe.hero, at, {
      color,
      size: recipe.heroSize * (0.82 + Math.min(force, 2) * 0.16),
      angle: request.angle,
      glow: recipe.heroGlow,
      still: reduced,
    });

    this.emit(
      at,
      recipe.scatter,
      color,
      force,
      directed ? request.angle : undefined,
      feedback.critical ? 78 : 58,
    );
    if (recipe.secondary) this.emit(at, recipe.secondary, color, force, undefined, 0);

    if (feedback.critical) {
      this.sheets.play('impact-cataclysm', at, {
        color, size: 190, alpha: 0.85, glow: true, still: reduced,
      });
    }
    if (DEBRIS_TYPES.has(type) && severity >= IMPACT_FX.heavySeverity) {
      this.particles.burst(at, {
        color,
        count: Math.round(7 * force),
        speed: recipe.scatter.speed * 0.5,
        lifespan: 900,
        shape: 'shard',
        size: 9,
        gravityY: 860,
        tumble: true,
        drag: 0.4,
        stagger: 0.05,
        depth: 4.6,
      });
    }
  }

  private emit(
    at: Vec2,
    scatter: Scatter,
    color: number,
    force: number,
    angle: number | undefined,
    coneDegrees: number,
  ): void {
    this.particles.burst(at, {
      ...scatter,
      color: scatter.color ?? color,
      count: Math.max(1, Math.round(scatter.count * force)),
      speed: scatter.speed * (0.75 + force * 0.35),
      angle: angle != null ? this.cone(angle, coneDegrees) : scatter.angle,
    });
  }

  private damageTypeFor(feedback: CombatFeedback): DamageType {
    if (feedback.kind === 'heal') return 'healing';
    if (feedback.kind === 'sanityHeal') return 'cleansing';
    if (feedback.kind === 'sanityDamage') return 'shadow';
    return feedback.damageType ?? 'generic';
  }

  /** Degrees, centred on the blow's heading. */
  private cone(angle: number, spreadDegrees: number): { min: number; max: number } {
    const centre = Phaser.Math.RadToDeg(angle);
    return { min: centre - spreadDegrees, max: centre + spreadDegrees };
  }

  private colorFor(feedback: CombatFeedback): number {
    if (feedback.kind === 'heal') return DAMAGE_COLORS.healing;
    if (feedback.kind === 'sanityHeal') return DAMAGE_COLORS.cleansing;
    if (feedback.kind === 'sanityDamage') return SANITY_COLOR;
    if (feedback.kind === 'immune' || feedback.kind === 'blocked') return WARD_COLOR;
    if (feedback.kind === 'miss') return MISS_COLOR;
    return DAMAGE_COLORS[feedback.damageType ?? 'generic'];
  }
}
