// The day and hour, and how far the party is from its next level: two small
// plates for the top of the pack and the inventory, so neither has to be read
// off the HUD.

import Phaser from 'phaser';
import { bloodmoonOmen, omenLabel } from '../../pve/exploration/bloodmoon';
import { clockTime, isNight } from '../../pve/exploration/clock';
import { MENU_COLOR, MENU_FONT, MENU_HEX } from '../cabinet/theme';
import { drawPlate } from './HudParts';

export interface JourneyView {
  day: number;
  hour: number;
  level: number;
  /** XP into the current level. */
  xp: number;
  /** XP the current level needs. */
  next: number;
  /** Levels gained whose rewards are still to be chosen. */
  pending?: number;
}

const CLOCK_W = 250;
const XP_W = 300;
const GAP = 12;
export const JOURNEY_H = 66;
/** Both plates side by side. */
export const JOURNEY_W = CLOCK_W + GAP + XP_W;

function partOfDay(hour: number): string {
  if (isNight(hour)) return 'Night';
  if (hour < 11) return 'Morning';
  if (hour < 14) return 'Midday';
  if (hour < 18) return 'Afternoon';
  return 'Evening';
}

/** The clock plate and the XP plate, their right edge at `right`. */
export function addJourneyStrip(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, right: number, top: number, view: JourneyView): void {
  const g = scene.add.graphics();
  parent.add(g);
  const clockX = right - JOURNEY_W;
  const xpX = right - XP_W;
  drawPlate(g, clockX, top, CLOCK_W, JOURNEY_H);
  drawPlate(g, xpX, top, XP_W, JOURNEY_H);

  // The sky: a sun by day, a moon by night.
  const night = isNight(view.hour);
  const sx = clockX + 26;
  const sy = top + 33;
  if (night) {
    g.fillStyle(0xdfe6f2, 1).fillCircle(sx, sy, 10);
    g.fillStyle(MENU_COLOR.wood, 1).fillCircle(sx + 5, sy - 3, 8.5);
  } else {
    g.lineStyle(2, 0xf2c14e, 0.9);
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      g.lineBetween(sx + Math.cos(a) * 10, sy + Math.sin(a) * 10, sx + Math.cos(a) * 14, sy + Math.sin(a) * 14);
    }
    g.fillStyle(0xf2c14e, 1).fillCircle(sx, sy, 7.5);
    g.fillStyle(0xfff0b0, 1).fillCircle(sx - 2, sy - 2, 2.5);
  }
  const omen = bloodmoonOmen(view.day);
  parent.add([
    scene.add.text(clockX + 50, top + 10, `DAY ${view.day}`, {
      fontFamily: MENU_FONT.control, fontSize: '12px', fontStyle: 'bold', color: MENU_HEX.brassLight,
    }).setLetterSpacing(2),
    scene.add.text(clockX + 49, top + 25, clockTime(view.hour), {
      fontFamily: MENU_FONT.display, fontSize: '26px', fontStyle: 'bold', color: MENU_HEX.bone,
    }),
    scene.add.text(clockX + CLOCK_W - 14, top + 12, partOfDay(view.hour), {
      fontFamily: MENU_FONT.control, fontSize: '13px', color: MENU_HEX.bone,
    }).setOrigin(1, 0),
    scene.add.text(clockX + CLOCK_W - 14, top + 38, omenLabel(omen).replace('The bloodmoon', 'Bloodmoon'), {
      fontFamily: MENU_FONT.control, fontSize: '11px', fontStyle: omen.tonight ? 'bold' : 'normal',
      color: omen.tonight ? '#e0645a' : MENU_HEX.boneDim,
    }).setOrigin(1, 0),
  ]);

  // The XP bar to the next level.
  const share = view.next > 0 ? Phaser.Math.Clamp(view.xp / view.next, 0, 1) : 0;
  const barX = xpX + 14;
  const barY = top + 31;
  const barW = XP_W - 28;
  g.fillStyle(MENU_COLOR.ink, 1).fillRect(barX, barY, barW, 12);
  if (share > 0) {
    g.fillStyle(0xc9a040, 1).fillRect(barX, barY, Math.max(2, Math.round(barW * share)), 12);
    g.fillStyle(0xf0d27a, 1).fillRect(barX, barY, Math.max(2, Math.round(barW * share)), 3);
  }
  g.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(barX + 0.5, barY + 0.5, barW - 1, 11);
  g.lineStyle(1, MENU_COLOR.pitch, 0.6);
  for (let k = 1; k < 10; k++) g.lineBetween(barX + (barW * k) / 10, barY + 2, barX + (barW * k) / 10, barY + 10);
  const pending = view.pending ?? 0;
  parent.add([
    scene.add.text(xpX + 14, top + 10, `LEVEL ${view.level}`, {
      fontFamily: MENU_FONT.control, fontSize: '12px', fontStyle: 'bold', color: MENU_HEX.brassLight,
    }).setLetterSpacing(2),
    scene.add.text(xpX + XP_W - 14, top + 9, `${view.xp} / ${view.next} XP`, {
      fontFamily: MENU_FONT.control, fontSize: '13px', fontStyle: 'bold', color: MENU_HEX.bone,
    }).setOrigin(1, 0),
    scene.add.text(xpX + 14, top + 46, pending > 0
      ? `Level up! ${pending > 1 ? `${pending} rewards` : 'A reward'} to choose`
      : view.xp >= view.next ? 'Level ready at long rest' : `${view.next - view.xp} XP to level ${view.level + 1}`, {
      fontFamily: MENU_FONT.control, fontSize: '11px', fontStyle: pending > 0 ? 'bold' : 'normal',
      color: pending > 0 ? '#f0d27a' : MENU_HEX.boneDim,
    }),
  ]);
}
