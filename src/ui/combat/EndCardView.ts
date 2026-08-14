import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config/constants';
import { CabinetButton } from '../cabinet/controls';
import { MENU_COLOR, MENU_FONT, MENU_HEX } from '../cabinet/theme';

export type EndCardTone = 'victory' | 'defeat' | 'warning' | 'neutral';

export interface EndCardOptions {
  eyebrow: string;
  title: string;
  detail: string;
  actionLabel: string;
  tone: EndCardTone;
  onActivate: () => void;
}

export class EndCardView extends Phaser.GameObjects.Container {
  private activated = false;
  private readonly action: CabinetButton;

  constructor(scene: Phaser.Scene, private readonly options: EndCardOptions) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(120);

    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;
    const width = 660;
    const height = 320;
    const accent = options.tone === 'victory'
      ? MENU_COLOR.verdigris
      : options.tone === 'defeat'
        ? MENU_COLOR.blood
        : options.tone === 'warning'
          ? MENU_COLOR.brassLight
          : MENU_COLOR.amethyst;

    const dim = scene.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, MENU_COLOR.pitch, 0.9)
      .setOrigin(0, 0)
      .setInteractive();
    const shadow = scene.add.rectangle(cx + 9, cy + 11, width + 10, height + 10, MENU_COLOR.pitch, 1);
    const frame = scene.add
      .rectangle(cx, cy, width, height, MENU_COLOR.woodDeep, 1)
      .setStrokeStyle(2, MENU_COLOR.brassDark);
    const body = scene.add
      .rectangle(cx, cy + 8, width - 22, height - 38, MENU_COLOR.charcoal, 1)
      .setStrokeStyle(1, MENU_COLOR.woodEdge);
    const rail = scene.add.rectangle(cx, cy - height / 2 + 10, width - 20, 6, accent, 1);
    const marker = scene.add.rectangle(cx - width / 2 + 29, cy - 50, 6, 104, accent, 1);
    const eyebrow = scene.add.text(cx, cy - 112, options.eyebrow, {
      fontFamily: MENU_FONT.control,
      fontSize: '13px',
      color: MENU_HEX.brassLight,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    const title = scene.add.text(cx, cy - 69, options.title, {
      fontFamily: MENU_FONT.display,
      fontSize: '36px',
      color: MENU_HEX.bone,
      fontStyle: 'bold',
      align: 'center',
      fixedWidth: width - 100,
    }).setOrigin(0.5);
    const detail = scene.add.text(cx, cy + 1, options.detail, {
      fontFamily: MENU_FONT.body,
      fontSize: '16px',
      color: MENU_HEX.boneDim,
      align: 'center',
      fixedWidth: width - 118,
      wordWrap: { width: width - 118 },
      lineSpacing: 3,
    }).setOrigin(0.5);

    this.action = new CabinetButton(scene, cx - 190, cy + 78, {
      width: 380,
      height: 58,
      label: options.actionLabel,
      index: '>',
      primary: true,
      onActivate: () => this.activate(),
    });
    this.action.setFocused(true);
    this.add([dim, shadow, frame, body, rail, marker, eyebrow, title, detail, this.action]);
  }

  activate(): void {
    if (this.activated) return;
    this.activated = true;
    this.options.onActivate();
  }
}