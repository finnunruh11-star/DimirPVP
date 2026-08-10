import Phaser from 'phaser';
import type { Rect } from './layout';
import { SPACE } from './layout';

// =============================================================================
//  UI THEME
// -----------------------------------------------------------------------------
//  One palette and one set of panel/control builders. Everything chrome-like in
//  the game should come from here so the interface stays consistent.
// =============================================================================

export const UI = {
  bg: 0x05070c,
  field: 0x0b1119,
  panel: 0x10151f,
  panelRaised: 0x161d2a,
  panelHover: 0x1f2938,
  panelActive: 0x24344a,
  panelDisabled: 0x0c1017,
  border: 0x2b3547,
  borderSoft: 0x1c2431,
  cyan: 0x54c7e8,
  gold: 0xe0b054,
  coral: 0xef6a5f,
  green: 0x4fca8b,
  violet: 0xa78bfa,
} as const;

export const UI_HEX = {
  panel: '#10151f',
  panelRaised: '#161d2a',
  panelHover: '#1f2938',
  panelDisabled: '#0c1017',
  border: '#2b3547',
  cyan: '#54c7e8',
  gold: '#e0b054',
  coral: '#ef6a5f',
  green: '#4fca8b',
  text: '#eef2f8',
  textDim: '#8b97a9',
} as const;

export const UI_FONT = '"Bahnschrift SemiCondensed", "Trebuchet MS", sans-serif';

/** Type ramp. Keeping sizes to this short list stops the HUD looking noisy. */
export const FONT = {
  micro: '10px',
  small: '12px',
  body: '13px',
  label: '15px',
  title: '18px',
  hero: '34px',
} as const;

// -----------------------------------------------------------------------------
//  PANELS
// -----------------------------------------------------------------------------

export interface PanelStyle {
  /** Accent colour for the header rail. Omit for a plain panel. */
  accent?: number;
  fill?: number;
  border?: number;
  radius?: number;
  alpha?: number;
}

/** Draw a dock/overlay panel: soft fill, hairline border, optional accent rail. */
export function drawPanel(
  g: Phaser.GameObjects.Graphics,
  rect: Rect,
  style: PanelStyle = {}
): void {
  const radius = style.radius ?? 6;
  g.fillStyle(style.fill ?? UI.panel, style.alpha ?? 1);
  g.fillRoundedRect(rect.x, rect.y, rect.w, rect.h, radius);
  g.lineStyle(1, style.border ?? UI.border, 0.9);
  g.strokeRoundedRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1, radius);
  if (style.accent != null) {
    g.fillStyle(style.accent, 1);
    g.fillRoundedRect(rect.x + SPACE.sm, rect.y + 1, 28, 2, 1);
  }
}

/** A slim vital/progress bar drawn on its own track. */
export function drawBar(
  g: Phaser.GameObjects.Graphics,
  rect: Rect,
  fraction: number,
  color: number
): void {
  const clamped = Math.max(0, Math.min(1, fraction));
  g.fillStyle(UI.bg, 1);
  g.fillRoundedRect(rect.x, rect.y, rect.w, rect.h, 2);
  if (clamped > 0) {
    g.fillStyle(color, 1);
    g.fillRoundedRect(rect.x, rect.y, Math.max(2, rect.w * clamped), rect.h, 2);
  }
  g.lineStyle(1, UI.borderSoft, 0.8);
  g.strokeRoundedRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1, 2);
}

// -----------------------------------------------------------------------------
//  CONTROLS
// -----------------------------------------------------------------------------

interface TextControlOptions {
  idleBackground?: string;
  hoverBackground?: string;
  hoverShadow?: string;
}

/** Apply one consistent hover/press contract to Phaser text controls. */
export function bindTextControl(
  button: Phaser.GameObjects.Text,
  onClick: () => void,
  options: TextControlOptions = {}
): void {
  const restore = (): void => {
    if (options.idleBackground) button.setBackgroundColor(options.idleBackground);
    button.setAlpha(1);
    button.setShadow(0, 0, '#000000', 0);
  };

  button.setInteractive({ useHandCursor: true });
  button.on('pointerover', () => {
    if (options.hoverBackground) button.setBackgroundColor(options.hoverBackground);
    if (options.hoverShadow) button.setShadow(0, 0, options.hoverShadow, 8);
  });
  button.on('pointerout', restore);
  button.on('pointerup', () => button.setAlpha(1));
  button.on('pointerdown', () => {
    button.setAlpha(0.82);
    onClick();
  });
}

export interface ChipOptions {
  fontSize?: string;
  width?: number;
  align?: 'left' | 'center';
}

/**
 * A compact toggle used across the HUD. Drive its look with {@link setChipState}.
 */
export function makeChip(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onClick: () => void,
  options: ChipOptions = {}
): Phaser.GameObjects.Text {
  const chip = scene.add
    .text(x, y, label, {
      fontFamily: UI_FONT,
      fontSize: options.fontSize ?? FONT.small,
      color: UI_HEX.textDim,
      backgroundColor: UI_HEX.panelRaised,
      align: options.align ?? 'center',
      fixedWidth: options.width,
      padding: { x: 8, y: 5 },
    })
    .setOrigin(0, 0);
  chip.setData('bg', UI_HEX.panelRaised);
  chip.setInteractive({ useHandCursor: true });
  chip.on('pointerover', () => chip.setBackgroundColor(UI_HEX.panelHover));
  chip.on('pointerout', () =>
    chip.setBackgroundColor((chip.getData('bg') as string) ?? UI_HEX.panelRaised)
  );
  chip.on('pointerdown', () => {
    chip.setAlpha(0.8);
    onClick();
  });
  chip.on('pointerup', () => chip.setAlpha(1));
  return chip;
}

/** Drive a chip's appearance: active, available, or unavailable. */
export function setChipState(
  chip: Phaser.GameObjects.Text,
  state: 'on' | 'off' | 'disabled'
): void {
  const bg =
    state === 'on' ? '#1d3a46' : state === 'disabled' ? UI_HEX.panelDisabled : UI_HEX.panelRaised;
  chip.setData('bg', bg);
  chip.setBackgroundColor(bg);
  chip.setColor(state === 'on' ? UI_HEX.cyan : state === 'disabled' ? '#4d5666' : UI_HEX.textDim);
  chip.setAlpha(1);
  if (state === 'disabled') chip.disableInteractive();
  else chip.setInteractive({ useHandCursor: true });
}