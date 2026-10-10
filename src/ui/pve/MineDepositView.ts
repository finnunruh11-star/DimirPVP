// The rock face of an ore room, worked a swing at a time. Pick a vein on the
// wall, then every strike throws a d20 plus the miner's Strength into the dig:
// reach the ore's value and the ore comes free, run out of strikes first and the
// seam comes down. A natural 1 or 2 chips the pickaxe.

import Phaser from 'phaser';
import { playSound } from '../../audio';
import { SceneInput } from '../../engine/SceneInput';
import { mineDepositAllows, type MineOreDef, type MineOreKind, type MineStrike, type MineVein } from '../../pve/mineMaze';
import { cssColor, mixColor } from '../../visuals/daylight';
import { GLOW } from '../../visuals/glowTextures';
import { itemIconTexture } from '../../visuals/itemIconTextures';
import type { ChamberSpec, VeinState } from '../../visuals/mineChamber';
import { CabinetChip, MenuFocusGroup } from '../cabinet/controls';
import { isReducedMotion } from '../cabinet/motion';
import { addCabinetBackdrop, MENU_COLOR, MENU_FONT, MENU_HEX } from '../cabinet/theme';
import { drawD20 } from './d20';
import { ChamberPicture } from './MineChamberView';
import type { MineLight } from './MineMapView';

/** Each ore's colour on the bar, in the chips and in the burst when it comes free. */
const ORE_COLOR: Record<MineOreKind, number> = {
  coal: 0xa9b6d2,
  copper: 0xe39257,
  iron: 0xd6cdc2,
  gold: 0xf2c94e,
};

const PANEL = { x: 60, y: 566, w: 706, h: 108 } as const;
const BAR = { x: 84, y: 608, w: 658, h: 18 } as const;
const PIPS = { x: 150, y: 640, w: 16, h: 10, gap: 5 } as const;
const PICKS = { x: 784, y: 586, size: 36, gap: 8, shown: 6 } as const;
const DANGER = 0xe0645a;
/** How long the die tumbles before it lands. */
const TUMBLE_MS = 480;
const FINISH_FIRST = 'Finish this vein first.';

export interface MineDepositModel {
  title: string;
  /** Time, pickaxes and the like, small at the top right. */
  status: string;
  /** The lit ore room the veins are in. */
  spec: ChamberSpec;
  ore: MineOreDef;
  /** Live: the scene strikes these and the window reads them back. */
  veins: readonly MineVein[];
  pickaxes: readonly number[];
  /** False: the party leader works the rock and this screen watches. */
  interactive: boolean;
  /** The light the party carries; a torch when not given. */
  light?: MineLight;
}

/** One strike, already made, for the window to play out. */
export interface MineStrikeShown extends MineStrike {
  vein: number;
  /** Who swung the pick. */
  miner?: string;
  /** Where the ore went once it came free: "+1 Iron Ore", or that nobody could carry it. */
  haul?: string;
}

const veinState = (vein: MineVein): VeinState =>
  vein.outcome === 'extracted' ? 'mined' : vein.outcome === 'collapsed' ? 'collapsed' : 'intact';

/** An ore room's rock face: the veins, the dig on the picked one, the pickaxes, and the d20 every swing throws. */
export class MineDepositView extends Phaser.GameObjects.Container {
  private readonly sceneInput: SceneInput;
  private readonly focus = new MenuFocusGroup();
  private readonly picture: ChamberPicture;
  private readonly reduced = isReducedMotion();
  private readonly color: number;
  private readonly marks: Phaser.GameObjects.Graphics;
  private readonly tags: Phaser.GameObjects.Text[] = [];
  private readonly zones: Phaser.GameObjects.Zone[] = [];
  private readonly fx: Phaser.GameObjects.Container;
  private readonly heading: Phaser.GameObjects.Text;
  private readonly bar: Phaser.GameObjects.Graphics;
  private readonly barText: Phaser.GameObjects.Text;
  private readonly pips: Phaser.GameObjects.Graphics;
  private readonly pipsNote: Phaser.GameObjects.Text;
  private readonly message: Phaser.GameObjects.Text;
  private readonly picks: Phaser.GameObjects.Container;
  private readonly strikeChip?: CabinetChip;
  private readonly leaveChip?: CabinetChip;
  private readonly timers: Phaser.Time.TimerEvent[] = [];
  private readonly waiting = new Set<() => void>();
  private selected = -1;
  private hovered = -1;
  private busy = false;
  private disposed = false;

  constructor(scene: Phaser.Scene, private readonly model: MineDepositModel, private readonly choose: (id: string) => void) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(99);
    this.color = ORE_COLOR[model.ore.kind];
    addCabinetBackdrop(scene, this);
    this.add(scene.add.text(58, 38, model.title, {
      fontFamily: MENU_FONT.display,
      fontSize: '26px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    }));
    this.add(scene.add.text(1222, 47, model.status, {
      fontFamily: MENU_FONT.control,
      fontSize: '13px',
      color: MENU_HEX.boneDim,
      align: 'right',
    }).setOrigin(1, 0));

    // The rock face, with a tag under each vein and a hit area over it.
    this.picture = new ChamberPicture(scene, this, model.spec, { kind: model.ore.kind, veins: model.veins.map(veinState) }, model.light);
    this.marks = scene.add.graphics();
    this.add(this.marks);
    model.veins.forEach((_, slot) => {
      const rect = this.picture.veinRect(slot);
      const tag = scene.add.text(rect.centerX, rect.bottom + 16, '', {
        fontFamily: MENU_FONT.control,
        fontSize: '11px',
        fontStyle: 'bold',
        color: MENU_HEX.bone,
        padding: { x: 8, y: 3 },
      }).setOrigin(0.5, 0).setLetterSpacing(1);
      const zone = scene.add.zone(rect.x - 12, rect.y - 12, rect.width + 24, rect.height + 24).setOrigin(0);
      zone.on('pointerover', () => {
        this.hovered = slot;
        this.drawMarks();
      });
      zone.on('pointerout', () => {
        if (this.hovered === slot) this.hovered = -1;
        this.drawMarks();
      });
      zone.on('pointerdown', () => this.pickVein(slot));
      this.tags.push(tag);
      this.zones.push(zone);
      this.add([tag, zone]);
    });
    this.fx = scene.add.container(0, 0);
    this.add(this.fx);

    // The dig on the picked vein: how deep it is, and how many strikes it has taken.
    const plate = scene.add.graphics();
    plate.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h);
    plate.lineStyle(1, MENU_COLOR.brassDark, 0.8).strokeRect(PANEL.x + 0.5, PANEL.y + 0.5, PANEL.w - 1, PANEL.h - 1);
    plate.fillStyle(this.color, 1).fillRect(PANEL.x, PANEL.y, 6, PANEL.h);
    this.heading = scene.add.text(BAR.x, 574, '', {
      fontFamily: MENU_FONT.display,
      fontSize: '22px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
    });
    const rules = scene.add.text(BAR.x + BAR.w, 581, `NEEDS ${model.ore.miningValue}  ·  ${model.ore.failCount} STRIKES`, {
      fontFamily: MENU_FONT.control,
      fontSize: '11px',
      fontStyle: 'bold',
      color: MENU_HEX.boneDim,
    }).setOrigin(1, 0).setLetterSpacing(1);
    this.bar = scene.add.graphics();
    this.barText = scene.add.text(BAR.x + BAR.w / 2, BAR.y + BAR.h / 2, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5);
    const strikesLabel = scene.add.text(BAR.x, 638, 'STRIKES', {
      fontFamily: MENU_FONT.control,
      fontSize: '10px',
      fontStyle: 'bold',
      color: MENU_HEX.boneDim,
    }).setLetterSpacing(2);
    this.pips = scene.add.graphics();
    this.pipsNote = scene.add.text(BAR.x, 656, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '11px',
      fontStyle: 'bold',
      color: cssColor(DANGER),
    }).setLetterSpacing(2);
    this.message = scene.add.text(300, 634, '', {
      fontFamily: MENU_FONT.body,
      fontSize: '14px',
      color: MENU_HEX.bone,
      wordWrap: { width: BAR.x + BAR.w - 300 },
      lineSpacing: 2,
      maxLines: 2,
    });
    this.add([plate, this.heading, rules, this.bar, this.barText, strikesLabel, this.pips, this.pipsNote, this.message]);

    // The pickaxes, and what to do.
    this.add(scene.add.text(PICKS.x, 568, 'PICKAXES', {
      fontFamily: MENU_FONT.control,
      fontSize: '10px',
      fontStyle: 'bold',
      color: MENU_HEX.boneDim,
    }).setLetterSpacing(2));
    this.picks = scene.add.container(0, 0);
    this.add(this.picks);
    if (model.interactive) {
      this.strikeChip = new CabinetChip(scene, PICKS.x, 630, {
        width: 214,
        height: 42,
        label: 'Strike   [Space]',
        tone: 'primary',
        onActivate: () => this.strike(),
      });
      this.leaveChip = new CabinetChip(scene, PICKS.x + 224, 630, {
        width: 214,
        height: 42,
        label: 'Leave   [Esc]',
        onActivate: () => this.leave(),
      });
      this.add([this.strikeChip, this.leaveChip]);
      this.focus.add(this.strikeChip);
      this.focus.add(this.leaveChip);
    } else {
      this.add(scene.add.text(PICKS.x + 219, 651, 'THE PARTY LEADER IS MINING', {
        fontFamily: MENU_FONT.control,
        fontSize: '13px',
        fontStyle: 'bold',
        color: MENU_HEX.brassLight,
      }).setOrigin(0.5));
    }

    this.sceneInput = new SceneInput(scene);
    if (model.interactive) {
      this.sceneInput.bindKeys([
        { key: 'LEFT', capture: true, run: () => this.focus.move(-1) },
        { key: 'RIGHT', capture: true, run: () => this.focus.move(1) },
        { key: 'TAB', capture: true, run: (event) => this.focus.move(event.shiftKey ? -1 : 1) },
        { key: 'ENTER', capture: true, run: () => this.focus.activate() },
        { key: 'SPACE', capture: true, run: () => this.strike() },
        { key: 'ESC', run: () => this.leave() },
        ...['ONE', 'TWO', 'THREE'].map((key, slot) => ({ key, run: () => this.pickVein(slot) })),
      ]);
    }

    this.say(model.pickaxes.length === 0
      ? 'No pickaxe. Mine shops sell them.'
      : model.interactive
        ? 'Pick a vein.'
        : 'The party leader is mining.');
    this.refresh();
    if (!this.reduced) {
      scene.tweens.add({ targets: this.marks, alpha: { from: 1, to: 0.5 }, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
  }

  /** The party leader has picked vein `slot` to work. */
  select(slot: number): void {
    if (this.disposed) return;
    this.selected = slot;
    this.say(`Vein ${slot + 1}.`);
    this.refresh();
    const tag = this.tags[slot];
    if (tag && !this.reduced) {
      tag.setScale(1.25);
      this.scene.tweens.add({ targets: tag, scale: 1, duration: 200, ease: 'Back.Out' });
    }
  }

  /** Play out a strike the scene has already made, then hand the window back. */
  async playStrike(strike: MineStrikeShown): Promise<void> {
    if (this.disposed) return;
    const { scene } = this;
    const quick = this.reduced;
    const rect = this.picture.veinRect(strike.vein);
    this.lock();
    const gained = strike.roll + strike.bonus;
    this.drawProgress(strike.progress - gained, strike.strike - 1);

    // The swing: the pick comes down on the vein from the right.
    if (!quick) {
      const pick = scene.add.image(rect.right + 40, rect.centerY + 52, itemIconTexture(scene, 'pickaxe'))
        .setOrigin(0.78, 0.94).setScale(6).setFlipX(true).setAngle(38);
      this.fx.add(pick);
      playSound('melee.swing');
      scene.tweens.add({ targets: pick, angle: -24, duration: 150, ease: 'Cubic.In' });
      await this.wait(150);
      if (this.disposed) return;
      scene.tweens.add({ targets: pick, alpha: 0, angle: -8, duration: 260, delay: 90, onComplete: () => pick.destroy() });
    }
    playSound('hit.block');
    this.picture.jolt(strike.vein);
    this.spark(rect.right - 52, rect.centerY);
    this.chips(rect.right - 52, rect.centerY);

    // The d20, tumbling over the vein.
    const dieX = rect.centerX;
    const dieY = rect.y - 50;
    const glow = scene.add.image(dieX, dieY, GLOW.soft).setTint(this.color).setBlendMode(Phaser.BlendModes.ADD).setScale(1.2).setAlpha(0.22);
    const die = scene.add.container(dieX, dieY);
    const body = scene.add.graphics();
    const face = scene.add.text(0, 4, String(1 + Math.floor(Math.random() * 20)), {
      fontFamily: MENU_FONT.display,
      fontSize: '22px',
      fontStyle: 'bold',
      color: MENU_HEX.ink,
    }).setOrigin(0.5);
    drawD20(body, MENU_COLOR.bone, 32);
    die.add([body, face]);
    this.fx.add([glow, die]);
    playSound('dice.roll');
    if (!quick) {
      die.setScale(0.3);
      scene.tweens.add({ targets: die, scale: 1, duration: 180, ease: 'Back.Out' });
      scene.tweens.add({ targets: die, angle: { from: -32, to: 32 }, duration: 130, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      const tumble = scene.time.addEvent({
        delay: 60,
        loop: true,
        callback: () => face.setText(String(1 + Math.floor(Math.random() * 20))),
      });
      this.timers.push(tumble);
      await this.wait(TUMBLE_MS);
      if (this.disposed) return;
      tumble.remove(false);
      scene.tweens.killTweensOf(die);
      die.setAngle(0).setScale(1.3);
      scene.tweens.add({ targets: die, scale: 1, duration: 280, ease: 'Back.Out' });
    }

    // It lands: the dig deepens by the roll.
    const crit = strike.roll === 20;
    const chipped = strike.roll <= 2;
    face.setText(String(strike.roll));
    drawD20(body, crit ? 0xf3dc8a : chipped ? 0xc27a70 : mixColor(MENU_COLOR.bone, this.color, 0.3), 32);
    if (crit) playSound('dice.crit');
    else if (chipped) playSound('dice.fumble');
    const gain = scene.add.text(dieX + 44, dieY - 6, strike.bonus > 0 ? `+${strike.roll}+${strike.bonus}` : `+${strike.roll}`, {
      fontFamily: MENU_FONT.display,
      fontSize: '24px',
      fontStyle: 'bold',
      color: cssColor(crit ? 0xf3dc8a : chipped ? DANGER : this.color),
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0, 0.5);
    this.fx.add(gain);
    scene.tweens.add({ targets: gain, y: dieY - 30, alpha: { from: 1, to: 0 }, duration: quick ? 400 : 900, delay: 200, ease: 'Sine.In', onComplete: () => gain.destroy() });
    const before = strike.progress - gained;
    this.drawProgress(quick ? strike.progress : before, strike.strike);
    if (!quick) {
      scene.tweens.addCounter({
        from: before,
        to: strike.progress,
        duration: 380,
        ease: 'Cubic.Out',
        onUpdate: (tween) => {
          if (!this.disposed) this.drawProgress(Math.round(Number(tween.getValue())), strike.strike);
        },
      });
    }
    if (strike.durabilityLost) this.wearPick(strike.broke);

    await this.wait(quick ? 80 : 360);
    if (this.disposed) return;
    const { ore } = this.model;
    let text: string;
    if (strike.outcome === 'extracted') {
      this.picture.setVein(strike.vein, 'mined');
      this.burst(rect);
      this.stamp(rect, 'EXTRACTED', 0xe6c25a);
      playSound('ui.confirm');
      text = strike.haul ?? `Mined the ${ore.name.toLowerCase()}.`;
    } else if (strike.outcome === 'collapsed') {
      this.picture.setVein(strike.vein, 'collapsed');
      this.dust(rect);
      this.stamp(rect, 'COLLAPSED', DANGER);
      playSound('shield.bash');
      if (!quick) scene.cameras.main.shake(240, 0.004);
      text = 'The vein collapsed. The ore is lost.';
    } else {
      const short = ore.miningValue - strike.progress;
      const left = ore.failCount - strike.strike;
      text = `${crit ? 'Critical! ' : chipped ? 'Weak hit. ' : ''}${short} more needed; ${left} strike${left === 1 ? '' : 's'} left.`;
    }
    if (strike.miner) text = `${strike.miner}: ${strike.roll} + ${strike.bonus} STR. ${text}`;
    if (strike.broke) text += ' The pickaxe breaks.';
    else if (strike.durabilityLost) text += ' The pickaxe is damaged.';
    if (!strike.outcome && this.model.pickaxes.length === 0) text += ' No pickaxe left.';
    this.say(text);

    await this.wait(quick ? 120 : 480);
    if (this.disposed) return;
    scene.tweens.add({
      targets: [die, glow],
      alpha: 0,
      duration: quick ? 60 : 200,
      onComplete: () => {
        die.destroy();
        glow.destroy();
      },
    });
    this.busy = false;
    this.refresh();
  }

  override destroy(fromScene?: boolean): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sceneInput.destroy();
    for (const timer of this.timers) timer.remove(false);
    this.scene.tweens.killTweensOf([this.marks, this.message, ...this.tags, ...this.fx.list]);
    super.destroy(fromScene);
    this.picture.destroy();
    // Whatever was being played out stops here; let it return.
    for (const done of [...this.waiting]) done();
  }

  private allows(choice: string): boolean {
    return !this.busy && !this.disposed && mineDepositAllows(choice, this.model.veins, this.selected, this.model.pickaxes.length);
  }

  /** The picked vein has been struck and is not done yet. */
  private working(): boolean {
    const vein = this.model.veins[this.selected];
    return !!vein && !vein.outcome && vein.strikes > 0;
  }

  private pickVein(slot: number): void {
    if (!this.model.interactive || this.busy || this.disposed) return;
    if (!this.allows(`vein:${slot}`)) {
      if (slot === this.selected) return;
      playSound('ui.deny');
      if (this.working()) this.say(FINISH_FIRST);
      return;
    }
    playSound('ui.click');
    this.choose(`vein:${slot}`);
  }

  /** Swing at the picked vein; with none picked (or it is done), pick the next one. */
  private strike(): void {
    if (!this.model.interactive || this.busy || this.disposed) return;
    if (this.allows('strike')) {
      this.choose('strike');
      return;
    }
    const next = this.model.veins.findIndex((_, slot) => this.allows(`vein:${slot}`));
    if (next >= 0) this.pickVein(next);
    else playSound('ui.deny');
  }

  private leave(): void {
    if (!this.model.interactive || this.busy || this.disposed) return;
    if (!this.allows('leave')) {
      playSound('ui.deny');
      this.say(FINISH_FIRST);
      return;
    }
    this.choose('leave');
  }

  /** Nothing answers clicks while a strike plays out. */
  private lock(): void {
    this.busy = true;
    for (const zone of this.zones) zone.disableInteractive();
    this.strikeChip?.setEnabled(false);
    this.leaveChip?.setEnabled(false);
    this.drawMarks();
  }

  /** Line the tags, brackets, dig, pickaxes and buttons up with the deposit as it now stands. */
  private refresh(): void {
    const { veins } = this.model;
    veins.forEach((vein, slot) => {
      const state = veinState(vein);
      const picked = slot === this.selected && state === 'intact';
      const [fill, ink] = state === 'mined'
        ? [MENU_COLOR.verdigris, MENU_HEX.ink]
        : state === 'collapsed'
          ? [MENU_COLOR.blood, MENU_HEX.bone]
          : picked
            ? [MENU_COLOR.brassLight, MENU_HEX.ink]
            : [MENU_COLOR.charcoalRaised, MENU_HEX.bone];
      const label = state === 'mined'
        ? 'MINED'
        : state === 'collapsed'
          ? 'COLLAPSED'
          : this.model.interactive ? `VEIN ${slot + 1}   [${slot + 1}]` : `VEIN ${slot + 1}`;
      this.tags[slot].setText(label).setBackgroundColor(cssColor(fill)).setColor(ink);
      const zone = this.zones[slot];
      if (this.model.interactive && this.allows(`vein:${slot}`)) zone.setInteractive({ useHandCursor: true });
      else zone.disableInteractive();
    });
    this.drawMarks();

    const vein = veins[this.selected];
    if (vein) {
      const done = vein.outcome === 'extracted' ? '  ·  MINED' : vein.outcome === 'collapsed' ? '  ·  COLLAPSED' : '';
      this.heading.setText(`VEIN ${this.selected + 1}${done}`).setColor(cssColor(vein.outcome === 'collapsed' ? DANGER : this.color));
      this.drawProgress(vein.progress, vein.strikes);
    } else {
      this.heading.setText('CHOOSE A VEIN').setColor(MENU_HEX.brassLight);
      this.drawProgress(0, 0, true);
    }
    this.drawPicks();

    const canStrike = this.allows('strike');
    const canLeave = this.allows('leave');
    this.strikeChip?.setEnabled(canStrike);
    this.leaveChip?.setEnabled(canLeave);
    // When there is nothing left to dig, the way out is what Enter should press.
    const more = veins.some((_, slot) => this.allows(`vein:${slot}`));
    if (canStrike) this.focus.focus(0);
    else if (!more && canLeave) this.focus.focus(1);
  }

  private drawMarks(): void {
    this.marks.clear();
    const picked = this.model.veins[this.selected];
    if (picked && (this.busy || !picked.outcome)) this.bracket(this.selected, MENU_COLOR.brassLight, 3);
    if (this.hovered >= 0 && this.hovered !== this.selected && this.model.interactive && this.allows(`vein:${this.hovered}`)) {
      this.bracket(this.hovered, MENU_COLOR.brass, 2);
    }
  }

  /** Corner brackets round the vein in `slot`. */
  private bracket(slot: number, color: number, width: number): void {
    const r = this.picture.veinRect(slot);
    const x0 = r.x - 10;
    const y0 = r.y - 10;
    const x1 = r.right + 10;
    const y1 = r.bottom + 10;
    const arm = 16;
    const g = this.marks;
    g.lineStyle(width, color, 1);
    g.beginPath();
    g.moveTo(x0, y0 + arm);
    g.lineTo(x0, y0);
    g.lineTo(x0 + arm, y0);
    g.moveTo(x1 - arm, y0);
    g.lineTo(x1, y0);
    g.lineTo(x1, y0 + arm);
    g.moveTo(x1, y1 - arm);
    g.lineTo(x1, y1);
    g.lineTo(x1 - arm, y1);
    g.moveTo(x0 + arm, y1);
    g.lineTo(x0, y1);
    g.lineTo(x0, y1 - arm);
    g.strokePath();
  }

  /** The bar (how deep the dig is against the ore's value) and the strike pips. */
  private drawProgress(progress: number, strikes: number, idle = false): void {
    const { miningValue: value, failCount } = this.model.ore;
    const g = this.bar;
    g.clear();
    g.fillStyle(MENU_COLOR.pitch, 1).fillRect(BAR.x - 3, BAR.y - 3, BAR.w + 6, BAR.h + 6);
    g.fillStyle(mixColor(this.color, 0x000000, 0.8), 1).fillRect(BAR.x, BAR.y, BAR.w, BAR.h);
    const fill = Math.round(BAR.w * Phaser.Math.Clamp(progress / value, 0, 1));
    if (fill > 0) {
      g.fillStyle(this.color, 1).fillRect(BAR.x, BAR.y, fill, BAR.h);
      g.fillStyle(0xffffff, 0.25).fillRect(BAR.x, BAR.y, fill, 3);
      g.fillStyle(0x000000, 0.2).fillRect(BAR.x, BAR.y + BAR.h - 3, fill, 3);
    }
    g.lineStyle(1, MENU_COLOR.pitch, 0.6);
    for (let at = 5; at < value; at += 5) {
      const x = BAR.x + Math.round((BAR.w * at) / value) + 0.5;
      g.lineBetween(x, BAR.y + BAR.h - 6, x, BAR.y + BAR.h);
    }
    this.barText.setText(`${progress} / ${value}`).setAlpha(idle ? 0.5 : 1);

    const p = this.pips;
    p.clear();
    for (let k = 0; k < failCount; k += 1) {
      const x = PIPS.x + k * (PIPS.w + PIPS.gap);
      p.fillStyle(MENU_COLOR.pitch, 1).fillRect(x, PIPS.y, PIPS.w, PIPS.h);
      if (k < strikes) {
        p.fillStyle(MENU_COLOR.bone, 1).fillRect(x + 1, PIPS.y + 1, PIPS.w - 2, PIPS.h - 2);
      } else {
        p.lineStyle(1, k === failCount - 1 ? DANGER : MENU_COLOR.brassDark, 1).strokeRect(x + 0.5, PIPS.y + 0.5, PIPS.w - 1, PIPS.h - 1);
      }
    }
    this.pipsNote.setText(!idle && progress < value && strikes === failCount - 1 ? 'LAST STRIKE' : '');
  }

  /** The party's pickaxes, the one in hand first, each with the durability it has left. */
  private drawPicks(): void {
    const { scene } = this;
    this.picks.removeAll(true);
    const picks = this.model.pickaxes;
    if (picks.length === 0) {
      this.picks.add(scene.add.text(PICKS.x, PICKS.y + 8, 'None left', {
        fontFamily: MENU_FONT.body,
        fontSize: '15px',
        fontStyle: 'bold',
        color: cssColor(DANGER),
      }));
      return;
    }
    picks.slice(0, PICKS.shown).forEach((durability, index) => {
      const x = PICKS.x + index * (PICKS.size + PICKS.gap);
      const well = scene.add.graphics();
      well.fillStyle(MENU_COLOR.pitch, 1).fillRect(x, PICKS.y, PICKS.size, PICKS.size);
      well.lineStyle(index === 0 ? 2 : 1, index === 0 ? MENU_COLOR.brassLight : MENU_COLOR.brassDark, 1)
        .strokeRect(x + 0.5, PICKS.y + 0.5, PICKS.size - 1, PICKS.size - 1);
      const icon = scene.add.image(x + PICKS.size / 2, PICKS.y + PICKS.size / 2, itemIconTexture(scene, 'pickaxe'))
        .setScale(2).setAlpha(index === 0 ? 1 : 0.7);
      const count = scene.add.text(x + PICKS.size - 2, PICKS.y + PICKS.size, String(durability), {
        fontFamily: MENU_FONT.control,
        fontSize: '11px',
        fontStyle: 'bold',
        color: durability <= 2 ? cssColor(DANGER) : MENU_HEX.bone,
        stroke: '#000000',
        strokeThickness: 3,
      }).setOrigin(1, 1);
      this.picks.add([well, icon, count]);
    });
    const extra = picks.length - PICKS.shown;
    const end = PICKS.x + Math.min(picks.length, PICKS.shown) * (PICKS.size + PICKS.gap);
    this.picks.add(scene.add.text(end, PICKS.y + 11, `${extra > 0 ? `+${extra}   ` : ''}in hand: ${picks[0]}/10`, {
      fontFamily: MENU_FONT.control,
      fontSize: '11px',
      fontStyle: 'bold',
      color: MENU_HEX.boneDim,
    }));
  }

  /** A natural 1 or 2: the pick in hand loses a point, or breaks. */
  private wearPick(broke: boolean): void {
    const { scene } = this;
    const x = PICKS.x + PICKS.size / 2;
    const y = PICKS.y + PICKS.size / 2;
    const flash = scene.add.rectangle(x, y, PICKS.size, PICKS.size, DANGER, 0.75);
    const note = scene.add.text(x, y, broke ? 'BROKE' : '-1', {
      fontFamily: MENU_FONT.control,
      fontSize: '13px',
      fontStyle: 'bold',
      color: cssColor(DANGER),
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5);
    this.drawPicks();
    this.fx.add([flash, note]);
    scene.tweens.add({ targets: flash, alpha: 0, duration: 420, onComplete: () => flash.destroy() });
    scene.tweens.add({ targets: note, y: y - 30, alpha: { from: 1, to: 0 }, duration: 1000, delay: 250, ease: 'Sine.In', onComplete: () => note.destroy() });
    if (broke) playSound('spell.shatter');
  }

  private spark(x: number, y: number): void {
    const flash = this.scene.add.image(x, y, GLOW.soft).setTint(0xfff0c8).setBlendMode(Phaser.BlendModes.ADD).setScale(0.35).setAlpha(0.95);
    this.fx.add(flash);
    this.scene.tweens.add({ targets: flash, scale: 1.1, alpha: 0, duration: this.reduced ? 120 : 260, ease: 'Cubic.Out', onComplete: () => flash.destroy() });
  }

  /** Rock (and the odd fleck of ore) knocked out of the wall. */
  private chips(x: number, y: number): void {
    if (this.reduced) return;
    for (let k = 0; k < 10; k += 1) {
      const size = 3 + Math.floor(Math.random() * 4);
      const chip = this.scene.add.rectangle(x, y, size, size, k % 3 === 0 ? this.color : 0x6f675d);
      this.fx.add(chip);
      const vx = (Math.random() * 1.6 - 0.4) * 110;
      const vy = -(40 + Math.random() * 90);
      const spin = (Math.random() - 0.5) * 720;
      this.scene.tweens.addCounter({
        from: 0,
        to: 1,
        duration: 420 + Math.random() * 220,
        onUpdate: (tween) => {
          if (this.disposed) return;
          const t = Number(tween.getValue());
          chip.setPosition(x + vx * t, y + vy * t + 260 * t * t).setAngle(spin * t).setAlpha(1 - t * t * t);
        },
        onComplete: () => chip.destroy(),
      });
    }
  }

  /** The ore comes free: a flash in its colour and a lump of it held up. */
  private burst(rect: Phaser.Geom.Rectangle): void {
    const { scene } = this;
    const glow = scene.add.image(rect.centerX, rect.centerY, GLOW.soft).setTint(this.color).setBlendMode(Phaser.BlendModes.ADD).setScale(0.8).setAlpha(0.95);
    const lump = scene.add.image(rect.centerX, rect.centerY - 8, itemIconTexture(scene, this.model.ore.item)).setScale(this.reduced ? 4 : 1.5);
    this.fx.add([glow, lump]);
    scene.tweens.add({ targets: glow, scale: 2.8, alpha: 0, duration: 520, ease: 'Cubic.Out', onComplete: () => glow.destroy() });
    if (!this.reduced) scene.tweens.add({ targets: lump, scale: 4, duration: 260, ease: 'Back.Out' });
    scene.tweens.add({
      targets: lump,
      y: rect.centerY - 44,
      alpha: 0,
      duration: 420,
      delay: this.reduced ? 500 : 900,
      ease: 'Sine.In',
      onComplete: () => lump.destroy(),
    });
  }

  /** The seam comes down in a cloud of dust. */
  private dust(rect: Phaser.Geom.Rectangle): void {
    const { scene } = this;
    for (let k = 0; k < 6; k += 1) {
      const scale = 0.6 + Math.random() * 0.4;
      const puff = scene.add.image(rect.x + Math.random() * rect.width, rect.y + rect.height * (0.3 + Math.random() * 0.6), GLOW.soft)
        .setTint(0x9a8c78).setScale(scale).setAlpha(0.6);
      this.fx.add(puff);
      scene.tweens.add({
        targets: puff,
        scale: scale * 2.4,
        y: puff.y + 14,
        alpha: 0,
        duration: this.reduced ? 300 : 900 + Math.random() * 400,
        ease: 'Sine.Out',
        onComplete: () => puff.destroy(),
      });
    }
  }

  /** A big word over the vein's lower edge for a moment: EXTRACTED, COLLAPSED. */
  private stamp(rect: Phaser.Geom.Rectangle, label: string, color: number): void {
    const { scene } = this;
    const stamp = scene.add.text(rect.centerX, rect.bottom - 6, label, {
      fontFamily: MENU_FONT.display,
      fontSize: '20px',
      fontStyle: 'bold',
      color: MENU_HEX.ink,
      backgroundColor: cssColor(color),
      padding: { x: 12, y: 4 },
    }).setOrigin(0.5);
    this.fx.add(stamp);
    if (!this.reduced) {
      stamp.setScale(1.6).setAlpha(0);
      scene.tweens.add({ targets: stamp, scale: 1, alpha: 1, duration: 240, ease: 'Back.Out' });
    }
    scene.tweens.add({ targets: stamp, alpha: 0, duration: 300, delay: 1300, onComplete: () => stamp.destroy() });
  }

  private say(text: string): void {
    this.message.setText(text);
    if (this.reduced) return;
    this.scene.tweens.killTweensOf(this.message);
    this.message.setAlpha(0.25);
    this.scene.tweens.add({ targets: this.message, alpha: 1, duration: 180 });
  }

  /** Resolves after `ms`, or at once if the window goes first. */
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        this.waiting.delete(done);
        resolve();
      };
      this.waiting.add(done);
      this.timers.push(this.scene.time.delayedCall(ms, done));
    });
  }
}
