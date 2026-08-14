import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config/constants';
import { SPACE, type Rect } from '../layout';

export const MENU_COLOR = {
  pitch: 0x080907,
  charcoal: 0x111310,
  charcoalRaised: 0x1a1d18,
  woodDeep: 0x17110d,
  wood: 0x2b1d14,
  woodRaised: 0x3a281b,
  woodEdge: 0x65472b,
  felt: 0x17251f,
  feltLight: 0x20342b,
  brassDark: 0x675735,
  brass: 0xa98b50,
  brassLight: 0xd2bd7f,
  bone: 0xd8cbae,
  boneDim: 0xa99d83,
  ink: 0x17130f,
  verdigris: 0x4d7c70,
  blood: 0x7c3733,
  amethyst: 0x645174,
  disabled: 0x6f6b60,
} as const;

export const MENU_HEX = {
  bone: '#d8cbae',
  boneDim: '#a99d83',
  ink: '#17130f',
  brass: '#a98b50',
  brassLight: '#d2bd7f',
  verdigris: '#6e9e91',
  disabled: '#6f6b60',
} as const;

export const MENU_FONT = {
  display: '"Palatino Linotype", "Book Antiqua", Georgia, serif',
  control: '"Bahnschrift SemiCondensed", "Arial Narrow", sans-serif',
  body: 'Candara, "Trebuchet MS", sans-serif',
} as const;

export const MENU_MOTION = {
  fast: 110,
  base: 190,
  slow: 320,
  distance: 42,
  ease: 'Sine.Out',
} as const;

export const FONT = {
  micro: '10px',
  small: '12px',
  body: '13px',
  label: '15px',
  title: '18px',
  hero: '34px',
} as const;

export interface CabinetPanelStyle {
  accent?: number;
  fill?: number;
  border?: number;
  alpha?: number;
}

export function drawCabinetPanel(
  graphics: Phaser.GameObjects.Graphics,
  rect: Rect,
  style: CabinetPanelStyle = {},
): void {
  graphics.fillStyle(style.fill ?? MENU_COLOR.woodDeep, style.alpha ?? 1);
  graphics.fillRect(rect.x, rect.y, rect.w, rect.h);
  graphics.lineStyle(1, style.border ?? MENU_COLOR.brassDark, 0.9);
  graphics.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
  if (style.accent != null) {
    graphics.fillStyle(style.accent, 1);
    graphics.fillRect(rect.x + SPACE.sm, rect.y + 1, 28, 2);
  }
}

export function drawCabinetBar(
  graphics: Phaser.GameObjects.Graphics,
  rect: Rect,
  fraction: number,
  color: number,
): void {
  const clamped = Math.max(0, Math.min(1, fraction));
  graphics.fillStyle(MENU_COLOR.pitch, 1).fillRect(rect.x, rect.y, rect.w, rect.h);
  if (clamped > 0) {
    graphics.fillStyle(color, 1).fillRect(rect.x, rect.y, Math.max(2, rect.w * clamped), rect.h);
  }
  graphics.lineStyle(1, MENU_COLOR.brassDark, 0.8);
  graphics.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
}

export function addCabinetBackdrop(scene: Phaser.Scene, parent: Phaser.GameObjects.Container): void {
  const graphics = scene.add.graphics();
  parent.add(graphics);

  graphics.fillStyle(MENU_COLOR.pitch, 1).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
  graphics.fillStyle(MENU_COLOR.charcoal, 1).fillRect(30, 26, GAME_WIDTH - 60, GAME_HEIGHT - 52);

  graphics.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(0, 0, GAME_WIDTH, 28);
  graphics.fillStyle(MENU_COLOR.wood, 1).fillRect(0, 28, 34, GAME_HEIGHT - 56);
  graphics.fillStyle(MENU_COLOR.wood, 1).fillRect(GAME_WIDTH - 34, 28, 34, GAME_HEIGHT - 56);
  graphics.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(0, GAME_HEIGHT - 28, GAME_WIDTH, 28);

  graphics.fillStyle(MENU_COLOR.woodRaised, 1).fillRect(30, 28, GAME_WIDTH - 60, 12);
  graphics.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(30, GAME_HEIGHT - 40, GAME_WIDTH - 60, 12);
  graphics.lineStyle(1, MENU_COLOR.woodEdge, 0.8);
  graphics.strokeRect(26.5, 24.5, GAME_WIDTH - 53, GAME_HEIGHT - 49);
  graphics.lineStyle(2, MENU_COLOR.brassDark, 1);
  graphics.strokeRect(34, 32, GAME_WIDTH - 68, GAME_HEIGHT - 64);

  graphics.lineStyle(1, MENU_COLOR.woodEdge, 0.22);
  for (let y = 7; y < GAME_HEIGHT; y += 13) {
    const offset = (y * 17) % 71;
    graphics.lineBetween(0, y, 28 + offset, y);
    graphics.lineBetween(GAME_WIDTH - 28 - offset, y, GAME_WIDTH, y);
  }
  for (let x = 58; x < GAME_WIDTH - 58; x += 86) {
    const length = 18 + (x % 37);
    graphics.lineBetween(x, 34, x + length, 34);
    graphics.lineBetween(x - length / 2, GAME_HEIGHT - 34, x + length, GAME_HEIGHT - 34);
  }

  graphics.fillStyle(MENU_COLOR.brass, 1);
  for (const [x, y] of [[19, 18], [GAME_WIDTH - 19, 18], [19, GAME_HEIGHT - 18], [GAME_WIDTH - 19, GAME_HEIGHT - 18]]) {
    graphics.fillCircle(x, y, 5);
    graphics.fillStyle(MENU_COLOR.ink, 1).fillRect(x - 2, y - 0.5, 4, 1);
    graphics.fillStyle(MENU_COLOR.brass, 1);
  }
}

export function addSectionRule(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  x: number,
  y: number,
  width: number
): void {
  const graphics = scene.add.graphics();
  graphics.lineStyle(1, MENU_COLOR.brassDark, 0.85).lineBetween(x, y, x + width, y);
  graphics.fillStyle(MENU_COLOR.brass, 1).fillRect(x, y - 2, 34, 4);
  parent.add(graphics);
}

export function addRecess(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: number = MENU_COLOR.felt
): Phaser.GameObjects.Graphics {
  const graphics = scene.add.graphics();
  graphics.fillStyle(MENU_COLOR.pitch, 1).fillRect(x - 5, y - 5, width + 10, height + 10);
  graphics.fillStyle(fill, 1).fillRect(x, y, width, height);
  graphics.lineStyle(1, MENU_COLOR.brassDark, 0.72).strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  graphics.lineStyle(1, MENU_COLOR.feltLight, 0.45);
  for (let lineY = y + 12; lineY < y + height; lineY += 16) {
    graphics.lineBetween(x + 9, lineY, x + width - 9, lineY);
  }
  parent.add(graphics);
  return graphics;
}
