import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config/constants';
import { SceneInput } from '../../engine/SceneInput';
import { CabinetButton, MenuFocusGroup } from '../cabinet/controls';
import { MENU_COLOR, MENU_FONT, MENU_HEX } from '../cabinet/theme';

export interface PauseViewOptions {
  motionReduced: boolean;
  combatSpeed: number;
  resume: () => void;
  toggleMotion: () => void;
  toggleSpeed: () => void;
  returnToMenu: () => void;
}

export class PauseView extends Phaser.GameObjects.Container {
  private readonly sceneInput: SceneInput;
  private readonly focus = new MenuFocusGroup();
  private readonly motion: CabinetButton;
  private readonly speed: CabinetButton;
  private disposed = false;

  constructor(scene: Phaser.Scene, private readonly options: PauseViewOptions) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(115);

    const left = 380;
    const top = 68;
    const width = 520;
    const height = 584;
    const dim = scene.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, MENU_COLOR.pitch, 0.88)
      .setOrigin(0)
      .setInteractive();
    dim.on('pointerdown', options.resume);
    const frame = scene.add.graphics();
    frame.fillStyle(MENU_COLOR.pitch, 1).fillRect(left - 9, top - 9, width + 18, height + 18);
    frame.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(left, top, width, height);
    frame.fillStyle(MENU_COLOR.charcoal, 1).fillRect(left + 14, top + 14, width - 28, height - 28);
    frame.lineStyle(2, MENU_COLOR.brassDark, 1).strokeRect(left + 14.5, top + 14.5, width - 29, height - 29);
    frame.fillStyle(MENU_COLOR.brass, 1).fillRect(left + 14, top + 14, width - 28, 6);
    const eyebrow = scene.add.text(GAME_WIDTH / 2, top + 39, 'DIMIR CABINET', {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      color: MENU_HEX.brassLight,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    const title = scene.add.text(GAME_WIDTH / 2, top + 68, 'PAUSED', {
      fontFamily: MENU_FONT.display,
      fontSize: '34px',
      color: MENU_HEX.bone,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.add([dim, frame, eyebrow, title]);

    const resume = new CabinetButton(scene, left + 46, top + 126, {
      width: width - 92,
      height: 70,
      label: 'RESUME',
      index: '>',
      primary: true,
      onActivate: options.resume,
    });
    this.motion = new CabinetButton(scene, left + 46, top + 214, {
      width: width - 92,
      height: 70,
      label: '',
      index: 'M',
      selected: options.motionReduced,
      onActivate: options.toggleMotion,
      onAdjust: () => options.toggleMotion(),
    });
    this.speed = new CabinetButton(scene, left + 46, top + 302, {
      width: width - 92,
      height: 70,
      label: '',
      index: 'S',
      selected: options.combatSpeed > 1,
      onActivate: options.toggleSpeed,
      onAdjust: () => options.toggleSpeed(),
    });
    const menu = new CabinetButton(scene, left + 46, top + 414, {
      width: width - 92,
      height: 70,
      label: 'RETURN TO CABINET',
      index: '<',
      onActivate: options.returnToMenu,
    });
    this.add([resume, this.motion, this.speed, menu]);
    this.focus.add(resume);
    this.focus.add(this.motion);
    this.focus.add(this.speed);
    this.focus.add(menu);
    this.refresh(options.motionReduced, options.combatSpeed);

    this.sceneInput = new SceneInput(scene);
    this.sceneInput.bindKeys([
      { key: 'UP', capture: true, run: () => this.focus.move(-1) },
      { key: 'DOWN', capture: true, run: () => this.focus.move(1) },
      { key: 'TAB', capture: true, run: (event) => this.focus.move(event.shiftKey ? -1 : 1) },
      { key: 'LEFT', capture: true, run: () => this.focus.adjust(-1) },
      { key: 'RIGHT', capture: true, run: () => this.focus.adjust(1) },
      { key: 'SPACE', capture: true, run: () => this.focus.activate() },
      { key: 'ENTER', capture: true, run: () => this.focus.activate() },
    ]);
  }

  refresh(motionReduced: boolean, combatSpeed: number): void {
    this.motion.setCopy(`MOTION: ${motionReduced ? 'REDUCED' : 'FULL'}`);
    this.motion.setSelected(motionReduced);
    this.speed.setCopy(`COMBAT SPEED: ${combatSpeed}X`);
    this.speed.setSelected(combatSpeed > 1);
  }

  override destroy(fromScene?: boolean): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sceneInput.destroy();
    super.destroy(fromScene);
  }
}
