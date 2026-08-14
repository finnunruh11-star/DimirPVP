import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config/constants';
import { MENU_COLOR, MENU_FONT, MENU_HEX } from './theme';

export interface CabinetWindowOptions {
  width: number;
  height: number;
  title: string;
  subtitle?: string;
  accent?: number;
  dismiss?: () => void;
}

export interface CabinetWindowChrome {
  dim: Phaser.GameObjects.Rectangle;
  frame: Phaser.GameObjects.Rectangle;
  title: Phaser.GameObjects.Text;
}

export function addCabinetWindow(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  options: CabinetWindowOptions,
): CabinetWindowChrome {
  const centerX = GAME_WIDTH / 2;
  const centerY = GAME_HEIGHT / 2;
  const accent = options.accent ?? MENU_COLOR.brass;
  const dim = scene.add
    .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, MENU_COLOR.pitch, 0.86)
    .setOrigin(0, 0)
    .setInteractive();
  if (options.dismiss) dim.on('pointerdown', options.dismiss);
  const shadow = scene.add
    .rectangle(centerX + 8, centerY + 10, options.width + 10, options.height + 10, MENU_COLOR.pitch, 1);
  const frame = scene.add
    .rectangle(centerX, centerY, options.width, options.height, MENU_COLOR.woodDeep, 1)
    .setStrokeStyle(2, MENU_COLOR.brassDark);
  const body = scene.add
    .rectangle(centerX, centerY, options.width - 20, options.height - 20, MENU_COLOR.charcoal, 1)
    .setStrokeStyle(1, MENU_COLOR.woodEdge, 1);
  const rail = scene.add
    .rectangle(centerX, centerY - options.height / 2 + 10, options.width - 20, 5, accent, 1);
  const marker = scene.add
    .rectangle(centerX - options.width / 2 + 26, centerY - options.height / 2 + 38, 5, 28, MENU_COLOR.brass, 1);
  const title = scene.add.text(
    centerX - options.width / 2 + 40,
    centerY - options.height / 2 + 18,
    options.title,
    {
      fontFamily: MENU_FONT.display,
      fontSize: '22px',
      color: MENU_HEX.bone,
      fontStyle: 'bold',
    },
  );
  container.add([dim, shadow, frame, body, rail, marker, title]);
  if (options.subtitle) {
    const subtitle = scene.add.text(
      centerX - options.width / 2 + 40,
      centerY - options.height / 2 + 45,
      options.subtitle,
      {
        fontFamily: MENU_FONT.body,
        fontSize: '12px',
        color: MENU_HEX.boneDim,
      },
    );
    container.add(subtitle);
  }
  return { dim, frame, title };
}
