// The turn of a day, as a title over a black screen: "Dawn of / The Second Day /
// -72 Hours Remain-". On the day the bloodmoon rises it is the final day, in the
// colour of the moon, and in its last hours the countdown alone comes back.
// Only fades: nothing slides or bounces. A click cuts it short.

import Phaser from 'phaser';
import { playSound } from '../../audio';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config/constants';
import { bloodmoonOmen, cycleDayTitle, hoursToBloodmoon } from '../../pve/exploration/bloodmoon';
import { ensureGlowTextures, GLOW } from '../../visuals/glowTextures';
import { isReducedMotion } from '../cabinet/motion';
import { MENU_FONT } from '../cabinet/theme';

export interface DayCard {
  day: number;
  hour: number;
  news: readonly string[];
  /** The bloodmoon's last hours: only the countdown is shown. */
  countdown?: boolean;
}

const HOLD = 2600;
const CUT = 600;

/** "-48 Hours Remain-", or at the very end "-1 Hour Remains-". */
export function hoursLine(day: number, hour: number): string {
  const hours = Math.max(1, Math.round(hoursToBloodmoon(day, hour)));
  return hours === 1 ? '-1 Hour Remains-' : `-${hours} Hours Remain-`;
}

/** Play the card for `card`. Resolves once it has gone. */
export function playDayCard(scene: Phaser.Scene, card: DayCard): Promise<void> {
  ensureGlowTextures(scene);
  const still = isReducedMotion();
  const final = bloodmoonOmen(card.day).tonight;
  const W = GAME_WIDTH;
  const H = GAME_HEIGHT;
  const cx = W / 2;
  const cy = H / 2 - 20;
  const ink = final ? '#ffe2da' : '#fbf6ea';
  const glow = final ? '#ff3a24' : '#c9a86a';
  const text = (y: number, value: string, size: number, spacing: number, color = ink): Phaser.GameObjects.Text =>
    scene.add.text(cx, y, value, {
      fontFamily: MENU_FONT.display,
      fontSize: `${size}px`,
      color,
      align: 'center',
      shadow: { offsetX: 0, offsetY: 0, color: glow, blur: size > 40 ? 22 : 12, fill: true },
    }).setOrigin(0.5).setLetterSpacing(spacing).setAlpha(0);

  const black = scene.add.rectangle(0, 0, W, H, 0x000000, 1).setOrigin(0).setAlpha(0);
  const haze = scene.add.image(cx, cy, GLOW.soft).setTint(final ? 0xa0140c : 0x3a2c14).setScale(9, 3.2)
    .setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
  const parts: Phaser.GameObjects.GameObject[] = [black, haze];
  const lines: Phaser.GameObjects.Text[] = [];
  const remain = hoursLine(card.day, card.hour);
  if (card.countdown) {
    lines.push(text(cy, remain, 58, 6));
  } else {
    lines.push(text(cy - 78, card.hour < 4 ? 'Night of' : 'Dawn of', 30, 8));
    lines.push(text(cy - 8, cycleDayTitle(card.day), 72, 4));
    lines.push(text(cy + 78, remain, 30, 5));
    if (card.news.length) {
      lines.push(text(H - 110, card.news.join('     ·     '), 16, 1, final ? '#e0b0a8' : '#bdb29a').setShadow(0, 0, '#000000', 0));
    }
  }
  parts.push(...lines);
  const skip = scene.add.zone(0, 0, W, H).setOrigin(0).setInteractive();
  parts.push(skip);
  for (const part of parts) (part as Phaser.GameObjects.Components.Depth & Phaser.GameObjects.GameObject).setDepth(90);

  playSound(card.countdown || final ? 'boss.omen' : card.hour < 4 ? 'day.night' : 'day.dawn');
  const fade = (targets: Phaser.GameObjects.GameObject | Phaser.GameObjects.GameObject[], alpha: number, delay: number, duration: number): void => {
    scene.tweens.add({ targets, alpha, delay: still ? 0 : delay, duration: still ? Math.min(duration, 200) : duration, ease: 'Sine.InOut' });
  };
  fade(black, card.countdown ? 0.82 : 0.94, 0, 500);
  fade(haze, 0.35, 300, 1200);
  lines.forEach((line, index) => fade(line, 1, 450 + index * 520, 700));

  return new Promise<void>((resolve) => {
    let done = false;
    const timers: Phaser.Time.TimerEvent[] = [];
    const cleanup = (): void => {
      if (done) return;
      done = true;
      for (const timer of timers) timer.remove(false);
      scene.tweens.killTweensOf(parts);
      for (const part of parts) part.destroy();
      scene.events.off(Phaser.Scenes.Events.SHUTDOWN, cleanup);
      resolve();
    };
    let leaving = false;
    const outro = (): void => {
      if (leaving || done) return;
      leaving = true;
      for (const timer of timers) timer.remove(false);
      scene.tweens.killTweensOf(parts);
      scene.tweens.add({ targets: parts.filter((part) => part !== skip), alpha: 0, duration: still ? 150 : CUT, ease: 'Sine.In' });
      timers.push(scene.time.delayedCall((still ? 150 : CUT) + 20, cleanup));
    };
    skip.once('pointerdown', outro);
    timers.push(scene.time.delayedCall(450 + lines.length * 520 + HOLD, outro));
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
  });
}
