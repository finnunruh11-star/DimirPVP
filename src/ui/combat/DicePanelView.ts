import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config/constants';
import { MENU_COLOR, MENU_FONT, MENU_HEX } from '../cabinet/theme';

export interface DiceRollView {
  spec: string;
  total: number;
  rolls: number[];
  label?: string;
}

interface DieView {
  root: Phaser.GameObjects.Container;
  face: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
}

export class DicePanelView extends Phaser.GameObjects.Container {
  private readonly timers = new Set<Phaser.Time.TimerEvent>();
  private tumble: Phaser.Time.TimerEvent | null = null;
  private activeResolve: (() => void) | null = null;
  private disposed = false;

  constructor(scene: Phaser.Scene) {
    super(scene, GAME_WIDTH / 2, GAME_HEIGHT - 96);
    scene.add.existing(this);
    this.setDepth(80).setVisible(false);
  }

  play(roll: DiceRollView, reducedMotion: boolean): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.finishActive();
    return new Promise((resolve) => {
      this.activeResolve = resolve;
      this.renderRoll(roll, reducedMotion);
    });
  }

  hide(): void {
    this.finishActive();
  }

  override destroy(fromScene?: boolean): void {
    if (this.disposed) return;
    this.disposed = true;
    this.finishActive();
    super.destroy(fromScene);
  }

  private renderRoll(roll: DiceRollView, reducedMotion: boolean): void {
    const sides = this.parseSides(roll.spec);
    const count = Math.max(1, roll.rolls.length);
    const gap = count > 12 ? 5 : 10;
    const dieSize = Phaser.Math.Clamp(Math.floor((960 - gap * (count - 1)) / count), 30, 46);
    const diceWidth = count * dieSize + (count - 1) * gap;
    const titleText = roll.label ?? roll.spec;
    const panelWidth = Math.min(1160, Math.max(diceWidth + 184, titleText.length * 10 + 60));
    const panelHeight = 154;

    const shadow = this.scene.add.rectangle(7, 9, panelWidth + 8, panelHeight + 8, MENU_COLOR.pitch, 1);
    const background = this.scene.add.rectangle(0, 0, panelWidth, panelHeight, MENU_COLOR.woodDeep, 1)
      .setStrokeStyle(2, MENU_COLOR.brassDark);
    const bed = this.scene.add.rectangle(0, 20, panelWidth - 24, 82, MENU_COLOR.felt, 1)
      .setStrokeStyle(1, MENU_COLOR.woodEdge);
    const rail = this.scene.add.rectangle(0, -panelHeight / 2 + 9, panelWidth - 18, 5, MENU_COLOR.brass, 1);
    const title = this.scene.add.text(0, -52, titleText.toUpperCase(), {
      fontFamily: MENU_FONT.display,
      fontSize: '18px',
      color: MENU_HEX.bone,
      fontStyle: 'bold',
      fixedWidth: panelWidth - 180,
      align: 'center',
    }).setOrigin(0.5);
    const spec = this.scene.add.text(-panelWidth / 2 + 16, -35, roll.spec.toUpperCase(), {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      color: MENU_HEX.brassLight,
    }).setOrigin(0, 0.5);
    this.add([shadow, background, bed, rail, title, spec]);

    const dice: DieView[] = [];
    const startX = -diceWidth / 2 + dieSize / 2;
    for (let index = 0; index < count; index++) {
      const root = this.scene.add.container(startX + index * (dieSize + gap), 20);
      const face = this.scene.add.graphics();
      const label = this.scene.add.text(0, 0, '?', {
        fontFamily: MENU_FONT.control,
        fontSize: `${Math.max(18, Math.floor(dieSize * 0.52))}px`,
        color: MENU_HEX.ink,
        fontStyle: 'bold',
      }).setOrigin(0.5);
      root.add([face, label]);
      this.drawDieFace(face, label, dieSize, 1, sides);
      this.add(root);
      dice.push({ root, face, label });
      if (!reducedMotion) {
        root.setY(-4).setAngle(index % 2 === 0 ? -5 : 5);
        this.scene.tweens.add({
          targets: root,
          y: 20,
          angle: 0,
          duration: 180,
          delay: index * 18,
          ease: 'Bounce.Out',
        });
      }
    }

    const totalPlate = this.scene.add.rectangle(diceWidth / 2 + 52, 20, 76, 52, MENU_COLOR.brass, 1)
      .setStrokeStyle(2, MENU_COLOR.brassLight);
    const totalText = this.scene.add.text(diceWidth / 2 + 52, 20, '', {
      fontFamily: MENU_FONT.display,
      fontSize: '25px',
      color: MENU_HEX.ink,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.add([totalPlate, totalText]);

    this.setVisible(true).setAlpha(reducedMotion ? 1 : 0).setScale(reducedMotion ? 1 : 0.96);
    if (!reducedMotion) {
      this.scene.tweens.add({ targets: this, alpha: 1, scale: 1, duration: 140, ease: 'Sine.Out' });
      this.tumble = this.scene.time.addEvent({
        delay: 70,
        loop: true,
        callback: () => dice.forEach((die) => {
          this.drawDieFace(die.face, die.label, dieSize, 1 + Math.floor(Math.random() * sides), sides);
        }),
      });
    }

    this.schedule(reducedMotion ? 0 : 900, () => {
      this.tumble?.remove();
      this.tumble = null;
      roll.rolls.forEach((value, index) => {
        const die = dice[index];
        if (die) this.drawDieFace(die.face, die.label, dieSize, value, sides);
      });
      if (roll.rolls.length === 0 && dice[0]) {
        this.drawDieFace(dice[0].face, dice[0].label, dieSize, roll.total, sides);
      }
      totalText.setText(String(roll.total));
      if (!reducedMotion) {
        this.scene.tweens.add({ targets: totalPlate, scale: 1.08, duration: 100, yoyo: true });
        this.scene.tweens.add({ targets: totalText, scale: 1.08, duration: 100, yoyo: true });
      }

      this.schedule(reducedMotion ? 550 : 900, () => {
        if (reducedMotion) {
          this.finishActive();
          return;
        }
        this.scene.tweens.add({
          targets: this,
          alpha: 0,
          duration: 160,
          onComplete: () => this.finishActive(),
        });
      });
    });
  }

  private schedule(delay: number, callback: () => void): void {
    let timer: Phaser.Time.TimerEvent;
    timer = this.scene.time.delayedCall(delay, () => {
      this.timers.delete(timer);
      if (!this.disposed && this.activeResolve) callback();
    });
    this.timers.add(timer);
  }

  private finishActive(): void {
    this.tumble?.remove();
    this.tumble = null;
    for (const timer of this.timers) timer.remove();
    this.timers.clear();
    this.scene.tweens.killTweensOf([this, ...this.list]);
    this.setVisible(false).setAlpha(1).setScale(1);
    this.removeAll(true);
    const resolve = this.activeResolve;
    this.activeResolve = null;
    resolve?.();
  }

  private parseSides(spec: string): number {
    const match = /d(\d+)/i.exec(spec);
    return match ? parseInt(match[1], 10) : 6;
  }

  private drawDieFace(
    graphics: Phaser.GameObjects.Graphics,
    label: Phaser.GameObjects.Text,
    size: number,
    value: number,
    sides: number
  ): void {
    const half = size / 2;
    graphics.clear();
    graphics.fillStyle(MENU_COLOR.pitch, 1).fillRect(-half + 3, -half + 4, size, size);
    graphics.fillStyle(MENU_COLOR.bone, 1).fillRect(-half, -half, size, size);
    graphics.lineStyle(2, MENU_COLOR.brassDark, 1).strokeRect(-half + 1, -half + 1, size - 2, size - 2);
    graphics.lineStyle(1, MENU_COLOR.brassLight, 0.7);
    graphics.lineBetween(-half + 5, -half + 5, half - 5, -half + 5);
    graphics.lineBetween(-half + 5, -half + 5, -half + 5, half - 5);

    if (sides !== 6 || value < 1 || value > 6) {
      label.setText(String(value)).setVisible(true);
      return;
    }

    label.setVisible(false);
    const inset = size * 0.23;
    const pips: Record<number, [number, number][]> = {
      1: [[0, 0]],
      2: [[-inset, -inset], [inset, inset]],
      3: [[-inset, -inset], [0, 0], [inset, inset]],
      4: [[-inset, -inset], [inset, -inset], [-inset, inset], [inset, inset]],
      5: [[-inset, -inset], [inset, -inset], [0, 0], [-inset, inset], [inset, inset]],
      6: [[-inset, -inset], [-inset, 0], [-inset, inset], [inset, -inset], [inset, 0], [inset, inset]],
    };
    graphics.fillStyle(MENU_COLOR.ink, 1);
    for (const [x, y] of pips[value]) graphics.fillCircle(x, y, Math.max(2.5, size * 0.07));
  }
}