import Phaser from 'phaser';

export const UI = {
  panel: 0x0b111a,
  panelRaised: 0x111b29,
  panelHover: 0x203149,
  panelDisabled: 0x0e151f,
  border: 0x41536d,
  borderSoft: 0x26364a,
  cyan: 0x48b8d0,
  gold: 0xd9a441,
  coral: 0xf06a5d,
  green: 0x47c98b,
  violet: 0xa78bfa,
} as const;

export const UI_HEX = {
  panel: '#0b111a',
  panelRaised: '#111b29',
  panelHover: '#203149',
  panelDisabled: '#0e151f',
  border: '#41536d',
  cyan: '#48b8d0',
  gold: '#d9a441',
  coral: '#f06a5d',
  green: '#47c98b',
} as const;

export const UI_FONT = '"Bahnschrift SemiCondensed", "Trebuchet MS", sans-serif';

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