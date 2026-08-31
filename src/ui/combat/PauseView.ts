import Phaser from 'phaser';
import { audioVolume, isAudioMuted, playSound, setAudioMuted, setAudioVolume } from '../../audio';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config/constants';
import { SceneInput } from '../../engine/SceneInput';
import { CabinetButton, MenuFocusGroup } from '../cabinet/controls';
import { MENU_COLOR, MENU_FONT, MENU_HEX } from '../cabinet/theme';
import { diceMode, diceModeLabel } from './dicePreference';

export interface PauseViewOptions {
  motionReduced: boolean;
  combatSpeed: number;
  diceLabel: string;
  diceOn: boolean;
  resume: () => void;
  toggleMotion: () => void;
  toggleSpeed: () => void;
  cycleDice: (direction: 1 | -1) => void;
  returnToMenu: () => void;
}

export class PauseView extends Phaser.GameObjects.Container {
  private readonly sceneInput: SceneInput;
  private readonly focus = new MenuFocusGroup();
  private readonly motion: CabinetButton;
  private readonly speed: CabinetButton;
  private readonly dice: CabinetButton;
  private readonly volume: CabinetButton;
  private disposed = false;

  constructor(scene: Phaser.Scene, private readonly options: PauseViewOptions) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(115);

    const left = 380;
    const top = 48;
    const width = 520;
    const height = 640;
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
    const eyebrow = scene.add.text(GAME_WIDTH / 2, top + 39, 'DIMIR', {
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
    this.speed = new CabinetButton(scene, left + 46, top + 290, {
      width: width - 92,
      height: 70,
      label: '',
      index: 'S',
      selected: options.combatSpeed > 1,
      onActivate: options.toggleSpeed,
      onAdjust: () => options.toggleSpeed(),
    });
    this.volume = new CabinetButton(scene, left + 46, top + 366, {
      width: width - 92,
      height: 70,
      label: '',
      index: 'V',
      selected: !isAudioMuted(),
      onActivate: () => this.toggleMute(),
      onAdjust: (direction) => this.stepVolume(direction),
    });
    this.dice = new CabinetButton(scene, left + 46, top + 442, {
      width: width - 92,
      height: 70,
      label: '',
      index: 'D',
      selected: options.diceOn,
      onActivate: () => options.cycleDice(1),
      onAdjust: (direction) => options.cycleDice(direction),
    });
    const menu = new CabinetButton(scene, left + 46, top + 528, {
      width: width - 92,
      height: 70,
      label: 'RETURN TO MAIN MENU',
      index: '<',
      onActivate: options.returnToMenu,
    });
    this.add([resume, this.motion, this.speed, this.volume, this.dice, menu]);
    this.focus.add(resume);
    this.focus.add(this.motion);
    this.focus.add(this.speed);
    this.focus.add(this.volume);
    this.focus.add(this.dice);
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
    this.dice.setCopy(`DICE: ${diceModeLabel()}`);
    this.dice.setSelected(diceMode() !== 'none');
    this.refreshVolume();
  }

  private refreshVolume(): void {
    const muted = isAudioMuted();
    this.volume.setCopy(`VOLUME: ${muted ? 'MUTED' : `${Math.round(audioVolume() * 100)}%`}`);
    this.volume.setSelected(!muted);
  }

  private toggleMute(): void {
    const muted = !isAudioMuted();
    setAudioMuted(muted);
    if (!muted && audioVolume() <= 0) setAudioVolume(0.7);
    this.refreshVolume();
  }

  private stepVolume(direction: -1 | 1): void {
    const next = Math.min(1, Math.max(0, Math.round((audioVolume() + direction * 0.1) * 10) / 10));
    setAudioVolume(next);
    if (next > 0) setAudioMuted(false);
    this.refreshVolume();
    // Preview blip so the new level is audible immediately.
    playSound('ui.hover');
  }

  override destroy(fromScene?: boolean): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sceneInput.destroy();
    super.destroy(fromScene);
  }
}
