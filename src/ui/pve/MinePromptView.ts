import Phaser from 'phaser';
import { SceneInput } from '../../engine/SceneInput';
import { CabinetButton, MenuFocusGroup } from '../cabinet/controls';
import {
  MENU_COLOR,
  MENU_FONT,
  MENU_HEX,
  addCabinetBackdrop,
  addRecess,
  addSectionRule,
} from '../cabinet/theme';

export interface MineChoiceView {
  id: string;
  label: string;
  enabled: boolean;
}

export interface MineVisualView {
  artKey: string;
  iconKey: string;
  label: string;
  hidden: boolean;
}

export interface MinePromptSnapshot {
  title: string;
  subtitle: string;
  body: string;
  visual?: MineVisualView;
  choices: MineChoiceView[];
}

export class MinePromptView extends Phaser.GameObjects.Container {
  private readonly sceneInput: SceneInput;
  private readonly focus = new MenuFocusGroup();
  private disposed = false;

  constructor(
    scene: Phaser.Scene,
    snapshot: MinePromptSnapshot,
    choose: (id: string) => void
  ) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(99);
    addCabinetBackdrop(scene, this);
    const title = scene.add.text(58, 42, snapshot.title, {
      fontFamily: MENU_FONT.display,
      fontSize: '28px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    });
    const subtitle = scene.add.text(60, 82, snapshot.subtitle, {
      fontFamily: MENU_FONT.body,
      fontSize: '14px',
      color: MENU_HEX.boneDim,
      fixedWidth: 1110,
    });
    this.add([title, subtitle]);
    addSectionRule(scene, this, 58, 112, 1164);
    addRecess(scene, this, 58, 132, 1164, 432);

    let bodyX = 92;
    let bodyWidth = 1096;
    if (snapshot.visual) {
      const visual = snapshot.visual;
      const artFrame = scene.add.graphics();
      artFrame.fillStyle(MENU_COLOR.pitch, 1).fillRect(88, 164, 384, 238);
      artFrame.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(96, 172, 368, 222);
      artFrame.lineStyle(2, visual.hidden ? MENU_COLOR.disabled : MENU_COLOR.brass, 1)
        .strokeRect(96.5, 172.5, 367, 221);
      const art = scene.add.image(280, 276, visual.artKey).setDisplaySize(344, 196);
      const captionBed = scene.add.graphics();
      captionBed.fillStyle(MENU_COLOR.charcoal, 1).fillRect(108, 350, 344, 32);
      const icon = scene.add.image(124, 366, visual.iconKey).setDisplaySize(22, 22);
      const label = scene.add.text(144, 359, visual.label.toUpperCase(), {
        fontFamily: MENU_FONT.control,
        fontSize: '12px',
        fontStyle: 'bold',
        color: visual.hidden ? MENU_HEX.disabled : MENU_HEX.brassLight,
      });
      this.add([artFrame, art, captionBed, icon, label]);
      bodyX = 508;
      bodyWidth = 668;
    }
    const body = scene.add.text(bodyX, 184, snapshot.body, {
      fontFamily: MENU_FONT.body,
      fontSize: '17px',
      color: MENU_HEX.bone,
      fixedWidth: bodyWidth,
      wordWrap: { width: bodyWidth },
      lineSpacing: 5,
    });
    this.add(body);

    if (snapshot.choices.length === 0) {
      const waiting = scene.add.text(640, 490, 'WAITING FOR THE PARTY LEADER', {
        fontFamily: MENU_FONT.control,
        fontSize: '13px',
        fontStyle: 'bold',
        color: MENU_HEX.brassLight,
      }).setOrigin(0.5);
      this.add(waiting);
    } else {
      snapshot.choices.forEach((choice, index) => {
        const columns = Math.min(4, snapshot.choices.length);
        const row = Math.floor(index / columns);
        const column = index % columns;
        const rowCount = Math.min(columns, snapshot.choices.length - row * columns);
        const width = Math.min(250, Math.floor((1080 - (rowCount - 1) * 14) / rowCount));
        const total = rowCount * width + (rowCount - 1) * 14;
        const x = 640 - total / 2 + column * (width + 14);
        const button = new CabinetButton(scene, x, 464 + row * 70, {
          width,
          height: 58,
          label: choice.label,
          index: String(index + 1),
          enabled: choice.enabled,
          onActivate: () => choose(choice.id),
        });
        this.add(button);
        this.focus.add(button);
      });
    }

    this.sceneInput = new SceneInput(scene);
    this.sceneInput.bindKeys([
      { key: 'LEFT', capture: true, run: () => this.focus.move(-1) },
      { key: 'UP', capture: true, run: () => this.focus.move(-1) },
      { key: 'RIGHT', capture: true, run: () => this.focus.move(1) },
      { key: 'DOWN', capture: true, run: () => this.focus.move(1) },
      { key: 'TAB', capture: true, run: (event) => this.focus.move(event.shiftKey ? -1 : 1) },
      { key: 'SPACE', capture: true, run: () => this.focus.activate() },
      { key: 'ENTER', capture: true, run: () => this.focus.activate() },
    ]);
  }

  override destroy(fromScene?: boolean): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sceneInput.destroy();
    super.destroy(fromScene);
  }
}