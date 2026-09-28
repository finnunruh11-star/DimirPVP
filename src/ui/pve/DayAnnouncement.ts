// The turn of a day, played as a title card. Black bars close in, light breaks
// along a horizon, the sun (by night, the moon) climbs behind the title while
// the day's number rolls over to the next, and what the new day brings is
// listed underneath. A click cuts it short.

import Phaser from 'phaser';
import { playSound } from '../../audio';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config/constants';
import { clockTime } from '../../pve/exploration/clock';
import type { BloodmoonOmen } from '../../pve/exploration/bloodmoon';
import { darkness } from '../../visuals/daylight';
import { ensureGlowTextures, GLOW } from '../../visuals/glowTextures';
import { ParticleFx } from '../../visuals/ParticleFx';
import { isReducedMotion } from '../cabinet/motion';
import { MENU_FONT } from '../cabinet/theme';

export interface DayCard {
  day: number;
  hour: number;
  news: readonly string[];
  /** How near the next bloodmoon is. On its last day the whole card turns red. */
  omen?: BloodmoonOmen;
}

interface Palette {
  glow: number;
  core: number;
  ray: number;
  mote: number;
  flash: number;
  rule: number;
  top: string;
  bottom: string;
  stroke: string;
  shadow: string;
  label: string;
  news: string;
}

const SUNRISE: Palette = {
  glow: 0xffa640, core: 0xfff0c8, ray: 0xffd88e, mote: 0xffe2a0, flash: 0xffe0a0, rule: 0xd2bd7f,
  top: '#fffaf0', bottom: '#f2b24a', stroke: '#2c1806', shadow: '#ff9630', label: '#ffe2a8', news: '#f3e6c8',
};

const MOONRISE: Palette = {
  glow: 0x5a78ff, core: 0xdce6ff, ray: 0xa9bfff, mote: 0xcfdcff, flash: 0xb8c8ff, rule: 0x9fb4f0,
  top: '#ffffff', bottom: '#9fb4f0', stroke: '#0a1030', shadow: '#5a7cff', label: '#c9d6ff', news: '#dde4f6',
};

const BLOODRISE: Palette = {
  glow: 0xff3a24, core: 0xffd2c0, ray: 0xff7a5a, mote: 0xff9a7a, flash: 0xff6a4a, rule: 0xd86a5a,
  top: '#fff0ea', bottom: '#ff5a3a', stroke: '#2a0404', shadow: '#ff3020', label: '#ffb8a8', news: '#f6ddd6',
};

const BAR = 66;
/** When the new number lands, ms into the card; the sound's second hit is timed to it. */
const IMPACT = 1260;
const OUTRO = 3450;

function phaseWord(hour: number): string {
  if (hour < 1.5) return 'MIDNIGHT';
  if (hour < 5) return 'NIGHT';
  if (hour < 7) return 'DAWN';
  if (hour < 11) return 'MORNING';
  if (hour < 14) return 'NOON';
  if (hour < 18) return 'AFTERNOON';
  if (hour < 20.5) return 'DUSK';
  return 'NIGHT';
}

/** Play the card for `card`. `onImpact` fires as the number lands. Resolves once it has gone. */
export function playDayCard(scene: Phaser.Scene, card: DayCard, onImpact?: () => void): Promise<void> {
  ensureGlowTextures(scene);
  const still = isReducedMotion();
  const night = darkness(card.hour) > 0.5;
  const lastDay = !!card.omen?.tonight;
  const p = lastDay ? BLOODRISE : night ? MOONRISE : SUNRISE;
  const W = GAME_WIDTH;
  const H = GAME_HEIGHT;
  const cx = W / 2;
  const cy = H / 2 - 22;
  const horizonY = cy + 46;
  const ADD = Phaser.BlendModes.ADD;
  const timers: Phaser.Time.TimerEvent[] = [];
  const masks: Phaser.GameObjects.Graphics[] = [];
  const particles = new ParticleFx(scene, () => still);
  const at = (ms: number, run: () => void): void => {
    timers.push(scene.time.delayedCall(still ? ms * 0.5 : ms, run));
  };
  const tween = (config: Phaser.Types.Tweens.TweenBuilderConfig): void => {
    scene.tweens.add(still ? { ...config, duration: Math.min(Number(config.duration ?? 300), 260), delay: 0 } : config);
  };

  const dim = scene.add.rectangle(0, 0, W, H, 0x000000, 1).setOrigin(0).setAlpha(0);
  const vignette = scene.add.image(cx, H / 2, GLOW.vignette).setDisplaySize(W * 1.1, H * 1.25).setAlpha(0);
  const glow = scene.add.image(cx, horizonY, GLOW.soft).setTint(p.glow).setBlendMode(ADD).setScale(7.5, 2.8).setAlpha(0);
  const rays = scene.add.image(cx, horizonY - 8, GLOW.rays).setTint(p.ray).setBlendMode(ADD).setScale(0.55).setAlpha(0);
  const body = scene.add.image(cx, horizonY + 80, night ? GLOW.moon : GLOW.sun).setScale(1.55).setAlpha(0);
  if (lastDay) body.setTint(0xff4a30);
  const bodyMask = scene.make.graphics({}, false);
  bodyMask.fillStyle(0xffffff, 1).fillRect(0, 0, W, horizonY);
  masks.push(bodyMask);
  body.setMask(bodyMask.createGeometryMask());
  const horizon = scene.add.image(cx, horizonY, GLOW.horizon).setTint(p.core).setBlendMode(ADD).setScale(0, 1.1).setAlpha(0);
  const barTop = scene.add.rectangle(0, -BAR, W, BAR, 0x000000, 1).setOrigin(0);
  const barBottom = scene.add.rectangle(0, H, W, BAR, 0x000000, 1).setOrigin(0);
  const trimTop = scene.add.rectangle(0, -2, W, 1, p.rule, 0.5).setOrigin(0);
  const trimBottom = scene.add.rectangle(0, H + 1, W, 1, p.rule, 0.5).setOrigin(0);

  const label = scene.add.text(cx, cy - 84, `${phaseWord(card.hour)}   ·   ${clockTime(card.hour)}`, {
    fontFamily: MENU_FONT.control,
    fontSize: '15px',
    fontStyle: 'bold',
    color: p.label,
  }).setOrigin(0.5).setLetterSpacing(7).setAlpha(0);

  const rule = scene.add.graphics({ x: cx, y: cy - 62 });
  rule.lineStyle(1, p.rule, 0.9).lineBetween(-250, 0, -16, 0).lineBetween(16, 0, 250, 0);
  rule.lineStyle(1, p.rule, 0.3).lineBetween(-340, 0, -254, 0).lineBetween(254, 0, 340, 0);
  rule.fillStyle(p.rule, 1).fillPoints([
    new Phaser.Math.Vector2(0, -6), new Phaser.Math.Vector2(7, 0), new Phaser.Math.Vector2(0, 6), new Phaser.Math.Vector2(-7, 0),
  ], true);
  rule.fillCircle(-254, 0, 2).fillCircle(254, 0, 2);
  rule.setScale(0, 1).setAlpha(0);

  const pad = 26;
  const style = (size: number): Phaser.Types.GameObjects.Text.TextStyle => ({
    fontFamily: MENU_FONT.display,
    fontSize: `${size}px`,
    fontStyle: 'bold',
    color: p.top,
    stroke: p.stroke,
    strokeThickness: 7,
    shadow: { offsetX: 0, offsetY: 0, color: p.shadow, blur: 26, stroke: true, fill: true },
    padding: { x: pad, y: pad },
  });
  const gild = (text: Phaser.GameObjects.Text): Phaser.GameObjects.Text => {
    const gradient = text.context.createLinearGradient(0, pad, 0, text.height - pad);
    gradient.addColorStop(0.1, p.top);
    gradient.addColorStop(0.55, p.top);
    gradient.addColorStop(1, p.bottom);
    text.setFill(gradient);
    text.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    return text;
  };
  const word = gild(scene.add.text(0, cy, 'DAY', style(82)).setOrigin(0, 0.5).setLetterSpacing(12).setAlpha(0));
  const before = gild(scene.add.text(0, cy, String(Math.max(1, card.day - 1)), style(96)).setOrigin(0, 0.5).setAlpha(0));
  const after = gild(scene.add.text(0, cy + 104, String(card.day), style(96)).setOrigin(0, 0.5).setAlpha(0));
  const wordW = word.width - pad * 2;
  const numW = Math.max(before.width, after.width) - pad * 2;
  const gap = 30;
  const left = cx - (wordW + gap + numW) / 2;
  const numLeft = left + wordW + gap;
  word.setX(left - pad);
  before.setX(numLeft + (numW - (before.width - pad * 2)) / 2 - pad);
  after.setX(numLeft + (numW - (after.width - pad * 2)) / 2 - pad);
  const numX = numLeft + numW / 2;
  const slot = scene.make.graphics({}, false);
  slot.fillStyle(0xffffff, 1).fillRect(numLeft - 40, cy - 78, numW + 80, 156);
  masks.push(slot);
  const slotMask = slot.createGeometryMask();
  before.setMask(slotMask);
  after.setMask(slotMask);

  const burst = scene.add.image(numX, cy, GLOW.soft).setTint(p.core).setBlendMode(ADD).setScale(0.4).setAlpha(0);
  const wave = scene.add.graphics({ x: numX, y: cy }).setAlpha(0);
  wave.lineStyle(3, p.core, 1).strokeCircle(0, 0, 36);
  wave.lineStyle(12, p.glow, 0.28).strokeCircle(0, 0, 40);
  const flash = scene.add.rectangle(0, 0, W, H, p.flash, 1).setOrigin(0).setBlendMode(ADD).setAlpha(0);

  const news = scene.add.text(cx, cy + 84, card.news.join('      ·      '), {
    fontFamily: MENU_FONT.control,
    fontSize: '16px',
    color: p.news,
    align: 'center',
    wordWrap: { width: W - 220 },
    shadow: { offsetX: 0, offsetY: 2, color: '#000000', blur: 6, fill: true },
  }).setOrigin(0.5, 0).setLetterSpacing(1).setAlpha(0);

  // The bloodmoon's countdown; on its last day, a warning that will not be missed.
  const omen = card.omen;
  const warning = scene.add.text(cx, cy + 128, omen ? (omen.tonight ? 'THE BLOODMOON RISES TONIGHT' : `BLOODMOON IN ${omen.daysLeft} DAYS`) : '', {
    fontFamily: omen?.tonight ? MENU_FONT.display : MENU_FONT.control,
    fontSize: omen?.tonight ? '30px' : '16px',
    fontStyle: 'bold',
    color: omen?.tonight ? '#ffd6c8' : '#ff9a88',
    stroke: '#1a0202',
    strokeThickness: omen?.tonight ? 6 : 3,
    shadow: { offsetX: 0, offsetY: 0, color: '#ff2a1a', blur: omen?.tonight ? 22 : 8, fill: true, stroke: true },
  }).setOrigin(0.5, 0).setLetterSpacing(omen?.tonight ? 8 : 5).setAlpha(0);

  const skip = scene.add.zone(0, 0, W, H).setOrigin(0).setInteractive();
  // Plain scene objects rather than a container, so the masks hold under the canvas renderer too.
  const layer = [dim, vignette, glow, rays, body, horizon, barTop, barBottom, trimTop, trimBottom, label, rule, word, before, after, burst, wave, flash, news, warning, skip];
  for (const part of layer) part.setDepth(90);

  playSound(night ? 'day.night' : 'day.dawn');
  tween({ targets: dim, alpha: 0.58, duration: 460, ease: 'Sine.Out' });
  tween({ targets: vignette, alpha: 1, duration: 700, ease: 'Sine.Out' });
  tween({ targets: [barTop, trimTop], y: `+=${BAR}`, duration: 440, ease: 'Cubic.Out' });
  tween({ targets: [barBottom, trimBottom], y: `-=${BAR}`, duration: 440, ease: 'Cubic.Out' });
  tween({ targets: horizon, scaleX: 2.7, alpha: 0.95, duration: 900, delay: 120, ease: 'Cubic.Out' });
  tween({ targets: glow, alpha: 0.55, duration: 1000, delay: 140, ease: 'Sine.Out' });
  tween({ targets: body, y: horizonY - 30, alpha: 1, duration: 1700, delay: 240, ease: 'Sine.Out' });
  tween({ targets: rays, alpha: 0.5, scale: 1.55, duration: 1700, delay: 240, ease: 'Sine.Out' });
  if (!still) tween({ targets: rays, angle: 22, duration: OUTRO + 600, ease: 'Linear' });
  label.setY(cy - 76);
  tween({ targets: label, alpha: 1, y: cy - 84, duration: 520, delay: 380, ease: 'Cubic.Out' });
  tween({ targets: rule, scaleX: 1, alpha: 1, duration: 760, delay: 400, ease: 'Cubic.Out' });
  word.setScale(1.14);
  before.setScale(1.14);
  tween({ targets: [word, before], alpha: 1, scale: 1, duration: 560, delay: 520, ease: 'Cubic.Out' });

  if (still) {
    at(900, () => {
      before.setAlpha(0);
      after.setY(cy);
      tween({ targets: after, alpha: 1, duration: 200 });
      onImpact?.();
    });
  } else {
    tween({ targets: before, y: cy - 110, alpha: 0, duration: 380, delay: IMPACT - 180, ease: 'Cubic.In' });
    tween({ targets: after, y: cy, duration: 640, delay: IMPACT - 140, ease: 'Back.Out' });
    tween({ targets: after, alpha: 1, duration: 200, delay: IMPACT - 140 });
    at(IMPACT, () => {
      onImpact?.();
      scene.cameras.main.shake(140, 0.0022);
      flash.setAlpha(0.32);
      tween({ targets: flash, alpha: 0, duration: 520, ease: 'Quad.Out' });
      wave.setAlpha(1).setScale(0.6);
      tween({ targets: wave, scale: 3.4, alpha: 0, duration: 820, ease: 'Cubic.Out' });
      burst.setAlpha(0.9);
      tween({ targets: burst, scale: 3.2, alpha: 0, duration: 760, ease: 'Cubic.Out' });
      particles.burst({ x: numX, y: cy }, { color: p.mote, count: 28, speed: 280, lifespan: 1400, glow: true, drag: 0.88, size: 12, gravityY: -26, spread: 18, depth: 91 });
    });
    for (let t = 300; t < OUTRO - 200; t += 110) {
      at(t, () => particles.burst({ x: cx + (Math.random() - 0.5) * 900, y: horizonY + (Math.random() - 0.5) * 18 }, {
        color: p.mote, count: 2, speed: 38, lifespan: 2000, glow: true, size: 9, alpha: 0.8,
        angle: { min: 255, max: 285 }, gravityY: -22, depth: 91,
      }));
    }
  }
  news.setY(cy + 94);
  tween({ targets: news, alpha: 1, y: cy + 84, duration: 640, delay: 1600, ease: 'Cubic.Out' });
  if (omen) {
    warning.setY(cy + 138).setScale(omen.tonight ? 1.25 : 1);
    tween({ targets: warning, alpha: 1, y: cy + 128, scale: 1, duration: omen.tonight ? 420 : 560, delay: 1900, ease: omen.tonight ? 'Back.Out' : 'Cubic.Out' });
    if (omen.tonight) {
      at(1900, () => {
        playSound('boss.omen');
        if (!still) scene.cameras.main.shake(160, 0.003);
      });
      if (!still) tween({ targets: warning, alpha: 0.55, duration: 420, delay: 2400, yoyo: true, repeat: 2, ease: 'Sine.InOut' });
    }
  }

  return new Promise<void>((resolve) => {
    let done = false;
    const cleanup = (): void => {
      if (done) return;
      done = true;
      for (const timer of timers) timer.remove(false);
      scene.tweens.killTweensOf(layer);
      for (const part of layer) part.destroy();
      for (const mask of masks) mask.destroy();
      particles.destroy();
      scene.events.off(Phaser.Scenes.Events.SHUTDOWN, cleanup);
      resolve();
    };
    let leaving = false;
    const outro = (): void => {
      if (leaving || done) return;
      leaving = true;
      for (const timer of timers) timer.remove(false);
      const fade = layer.filter((child) => child !== barTop && child !== barBottom && child !== trimTop && child !== trimBottom && child !== skip);
      scene.tweens.killTweensOf(layer);
      scene.tweens.add({ targets: fade, alpha: 0, duration: 480, ease: 'Sine.In' });
      scene.tweens.add({ targets: [word, after, label, rule], y: '-=14', duration: 520, ease: 'Sine.In' });
      scene.tweens.add({ targets: [barTop, trimTop], y: `-=${BAR + 2}`, duration: 420, delay: 80, ease: 'Cubic.In' });
      scene.tweens.add({ targets: [barBottom, trimBottom], y: `+=${BAR + 2}`, duration: 420, delay: 80, ease: 'Cubic.In' });
      scene.time.delayedCall(540, cleanup);
    };
    skip.once('pointerdown', outro);
    at(OUTRO, outro);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
  });
}
