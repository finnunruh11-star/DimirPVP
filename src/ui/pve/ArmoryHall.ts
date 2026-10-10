// The Guild's armoury on the first day: five pedestals with one starter weapon
// each, and you walking between them. It only shows and asks; taking a weapon
// is `takeStarterWeapon`'s job (via the hooks).

import Phaser from 'phaser';
import { playSound } from '../../audio';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config/constants';
import { getItem, type ItemId } from '../../core/Items';
import { bufferTexture } from '../../world/localeRender';
import { MAGE_FIRST_FRAME, MAGE_IDLE, MAGE_RUN } from '../../world/mageSprite';
import { keeperPixels } from '../../world/npcs';
import { MENU_COLOR, MENU_FONT, MENU_HEX } from '../cabinet/theme';

export interface ArmoryPedestal {
  id: ItemId;
  /** Names of the travellers who took it. */
  takenBy: string[];
}

export interface ArmoryState {
  pedestals: ArmoryPedestal[];
  /** Any weapon may go to several travellers (a party bigger than the rack). */
  shared: boolean;
  /** Who picks on this screen now; null once nobody here is left to arm. */
  picker: string | null;
  /** Travellers who have not come into the Lodge yet; nobody picks until they do. */
  waitingFor: string[];
  /** Everyone in the party is armed. */
  done: boolean;
}

export interface ArmoryHooks {
  keeperName: string;
  reducedMotion: boolean;
  state(): ArmoryState;
  /** The picker takes `weapon`; resolves with whether it worked and what was said. */
  take(weapon: ItemId): Promise<{ ok: boolean; message: string }>;
}

const W = GAME_WIDTH;
const H = GAME_HEIGHT;
const FLOOR_Y = 420;
const PEDESTAL_Y = 470;
const WALK_Y = 600;
const BOX_TOP = 604;

const ALL_ARMED = "Y'all finally decided. Good. Now go away.";
const WAITING_OTHERS = 'Tell your teammates to hurry up, you cannot leave without them..';

const PITCH: Partial<Record<ItemId, string>> = {
  travellersDagger: 'Imagine all the places this could go...',
  quarterstaff: "Imagine all the places THIS could go O_O.",
  shortsword: 'This should go NOWHERE but your enemies you freak.',
  huntingBow: 'Bow. Thats all, really. Oh and 3 arrows',
  apprenticeWand: "This thing is NEEEDLESLY LARGE. ",
};

const TAKEN_LINE: Partial<Record<ItemId, string>> = {
  travellersDagger: 'Stab responsibly.',
  quarterstaff: 'Nobody ever lost a fight with a stick. Mostly.',
  shortsword: 'Filthy Bruiser, I know what you are...',
  huntingBow: 'Bro is a coward',
  apprenticeWand: 'If you get another you can make a Hat! Wait wrong game...',
};

type Stage = 'browse' | 'confirm' | 'busy';

interface PedestalView {
  id: ItemId;
  x: number;
  weapon: Phaser.GameObjects.Container;
  beam: Phaser.GameObjects.Graphics;
  plate: Phaser.GameObjects.Text;
  note: Phaser.GameObjects.Text;
}

export class ArmoryHall {
  private readonly root: Phaser.GameObjects.Container;
  private readonly pedestals: PedestalView[] = [];
  private readonly player: Phaser.GameObjects.Sprite;
  private readonly keeper: Phaser.GameObjects.Sprite;
  private readonly speaker: Phaser.GameObjects.Text;
  private readonly line: Phaser.GameObjects.Text;
  private readonly keys: Phaser.GameObjects.Text;
  private readonly title: Phaser.GameObjects.Text;
  private readonly fast: boolean;
  private focus = 0;
  private stage: Stage = 'busy';
  private typer: Phaser.Time.TimerEvent | null = null;
  private greeted = false;
  private wasDone = false;
  private closed = false;
  private seen = '';
  private readonly onKey = (event: KeyboardEvent): void => this.key(event);

  constructor(private readonly scene: Phaser.Scene, private readonly hooks: ArmoryHooks, private readonly close: () => void) {
    this.fast = hooks.reducedMotion;
    this.root = scene.add.container(0, 0).setDepth(300);
    this.root.add(scene.add.rectangle(0, 0, W, H, 0x000000, 1).setOrigin(0).setInteractive());
    this.paintRoom();
    this.keeper = this.paintKeeper();
    const state = hooks.state();
    const count = state.pedestals.length;
    state.pedestals.forEach((pedestal, index) => {
      this.pedestals.push(this.paintPedestal(pedestal.id, W / 2 + (index - (count - 1) / 2) * 250));
    });
    this.player = scene.add.sprite(W / 2, WALK_Y + 40, MAGE_FIRST_FRAME).setOrigin(0.5, 0.95);
    const frame = scene.textures.getFrame(MAGE_FIRST_FRAME);
    this.player.setScale(110 / Math.max(1, frame?.height ?? 16));
    if (scene.anims.exists(MAGE_IDLE)) this.player.play(MAGE_IDLE);
    this.root.add(this.player);
    this.title = scene.add.text(W / 2, 26, 'KERUSAI GUILD  -  STARTER WEAPONS', {
      fontFamily: MENU_FONT.display,
      fontSize: '18px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
      letterSpacing: 2,
    }).setOrigin(0.5);
    this.root.add(this.title);
    const box = scene.add.graphics();
    box.fillStyle(MENU_COLOR.woodDeep, 0.95).fillRoundedRect(40, BOX_TOP, W - 80, H - BOX_TOP - 14, 8);
    box.lineStyle(2, MENU_COLOR.brass, 0.9).strokeRoundedRect(40, BOX_TOP, W - 80, H - BOX_TOP - 14, 8);
    this.speaker = scene.add.text(62, BOX_TOP + 10, hooks.keeperName.toUpperCase(), {
      fontFamily: MENU_FONT.control,
      fontSize: '13px',
      color: MENU_HEX.brass,
      letterSpacing: 3,
    });
    this.line = scene.add.text(62, BOX_TOP + 32, '', {
      fontFamily: MENU_FONT.body,
      fontSize: '17px',
      color: MENU_HEX.bone,
      wordWrap: { width: W - 140 },
      lineSpacing: 4,
    });
    this.keys = scene.add.text(W - 62, H - 24, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      color: MENU_HEX.boneDim,
      align: 'right',
    }).setOrigin(1, 1);
    this.root.add([box, this.speaker, this.line, this.keys]);
    scene.input.keyboard?.on('keydown', this.onKey);
    this.root.setAlpha(0);
    scene.tweens.add({ targets: this.root, alpha: 1, duration: this.fast ? 1 : 500 });
    this.player.x = -60;
    this.walkTo(0, this.fast ? 1 : 1200);
    this.greet();
  }

  /** The run changed (someone took a weapon, someone came in): redraw the pedestals and the words. */
  refresh(): void {
    if (this.closed) return;
    const state = this.hooks.state();
    const seen = JSON.stringify(state);
    if (seen === this.seen) return;
    this.seen = seen;
    this.paintTaken(state);
    if (!this.greeted || this.stage !== 'browse') return;
    if (state.done && !this.wasDone) {
      this.wasDone = true;
      this.say(ALL_ARMED);
      return;
    }
    this.describe();
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    this.typer?.remove();
    this.scene.input.keyboard?.off('keydown', this.onKey);
    this.scene.tweens.killTweensOf(this.root.list);
    for (const pedestal of this.pedestals) this.scene.tweens.killTweensOf([pedestal.weapon, ...pedestal.weapon.list, pedestal.beam]);
    this.root.destroy();
  }

  // --- Talking ---

  private greet(): void {
    this.greeted = true;
    this.stage = 'browse';
    const state = this.hooks.state();
    this.seen = JSON.stringify(state);
    this.wasDone = state.done;
    this.paintTaken(state);
    this.describe(true);
  }

  /** The weapon you stand in front of, what the keeper makes of it, and whether you may take it. */
  private describe(immediate = false): void {
    const state = this.hooks.state();
    const pedestal = state.pedestals[this.focus];
    if (!pedestal) return;
    const def = getItem(pedestal.id);
    const takenHere = !state.shared && pedestal.takenBy.length > 0;
    const stats = `${def.name}: ${def.blurb}`;
    let text = `${PITCH[pedestal.id] ?? ''}\n${stats}`.trim();
    let keys = 'Left / Right  browse      Esc  leave';
    if (state.done) {
      text = `${ALL_ARMED}\n${stats}`;
    } else if (!state.picker) {
      text = WAITING_OTHERS;
    } else if (state.waitingFor.length > 0) {
      text = `Hold on, we're still waiting for ${listNames(state.waitingFor)}.\n${stats}`;
    } else if (takenHere) {
      text = `Sorry, ${pedestal.takenBy.join(' and ')} already took the ${def.name}. No swapping.`;
    } else {
      keys = `Enter  take the ${def.name}      Left / Right  browse      Esc  leave`;
    }
    this.speaker.setText(this.hooks.keeperName.toUpperCase());
    this.say(text, immediate);
    this.keys.setText(state.picker && !state.done ? `${state.picker}:   ${keys}` : keys);
  }

  private say(text: string, immediate = false): void {
    this.typer?.remove();
    let shown = 0;
    this.line.setText('');
    if (this.fast || immediate) {
      this.line.setText(text);
      return;
    }
    this.typer = this.scene.time.addEvent({
      delay: 18,
      repeat: text.length - 1,
      callback: () => {
        shown += 1;
        this.line.setText(text.slice(0, shown));
        if (shown % 5 === 1 && text[shown - 1] !== ' ') playSound('ui.hover', { gain: 0.2 });
      },
    });
    this.scene.tweens.add({ targets: this.keeper, y: this.keeper.y - 6, duration: 90, yoyo: true, repeat: 1 });
  }

  // --- Input ---

  private key(event: KeyboardEvent): void {
    if (this.closed) return;
    const k = event.key;
    if (this.stage === 'browse') {
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') this.step(-1);
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') this.step(1);
      else if (k === 'Enter' || k === 'e' || k === 'E' || k === ' ') this.ask();
      else if (k === 'Escape') this.leave();
      else if (/^[1-9]$/.test(k)) this.jump(Number(k) - 1);
    } else if (this.stage === 'confirm') {
      if (k === 'Enter' || k === 'e' || k === 'E' || k === 'y' || k === 'Y') void this.takeFocused();
      else if (k === 'Escape' || k === 'n' || k === 'N' || k === 'Backspace') {
        playSound('ui.back');
        this.stage = 'browse';
        this.describe();
      }
    }
  }

  private step(delta: number): void {
    const next = this.focus + delta;
    if (next < 0 || next >= this.pedestals.length) return;
    this.jump(next);
  }

  private jump(index: number): void {
    if (index === this.focus || index < 0 || index >= this.pedestals.length || this.stage !== 'browse') return;
    playSound('ui.hover');
    this.walkTo(index, this.fast ? 1 : 420);
    this.describe();
  }

  private ask(): void {
    const state = this.hooks.state();
    const pedestal = state.pedestals[this.focus];
    if (state.done) {
      this.leave();
      return;
    }
    if (!pedestal || !state.picker || state.waitingFor.length > 0 || (!state.shared && pedestal.takenBy.length > 0)) {
      playSound('ui.deny');
      return;
    }
    playSound('ui.click');
    this.stage = 'confirm';
    const name = getItem(pedestal.id).name;
    this.say(`The ${name}, then? No returns.`);
    this.keys.setText(`Enter  take it      Esc  back`);
  }

  private async takeFocused(): Promise<void> {
    const pedestal = this.pedestals[this.focus];
    this.stage = 'busy';
    this.keys.setText('');
    const result = await this.hooks.take(pedestal.id);
    if (this.closed) return;
    if (!result.ok) {
      playSound('ui.deny');
      this.stage = 'browse';
      this.say(result.message);
      return;
    }
    await this.grab(pedestal);
    if (this.closed) return;
    const state = this.hooks.state();
    this.seen = JSON.stringify(state);
    this.paintTaken(state);
    this.wasDone = state.done;
    const next = state.done
      ? ALL_ARMED
      : state.picker
        ? `Next! ${state.picker}, your turn.`
        : WAITING_OTHERS;
    const quip = TAKEN_LINE[pedestal.id];
    this.stage = 'browse';
    this.say(quip ? `${quip} ${next}` : next);
    this.keys.setText(state.done ? 'Enter / Esc  leave' : state.picker ? 'Left / Right  browse      Enter  take      Esc  leave' : 'Esc  leave');
  }

  private leave(): void {
    if (this.closed) return;
    playSound('ui.back');
    this.stage = 'busy';
    this.scene.tweens.add({
      targets: this.root,
      alpha: 0,
      duration: this.fast ? 1 : 300,
      onComplete: () => {
        this.destroy();
        this.close();
      },
    });
  }

  // --- Motion ---

  private walkTo(index: number, duration: number): void {
    const target = this.pedestals[index]?.x ?? W / 2;
    this.focus = index;
    this.scene.tweens.killTweensOf(this.player);
    if (Math.abs(target - this.player.x) > 2) this.player.setFlipX(target < this.player.x);
    if (this.scene.anims.exists(MAGE_RUN)) this.player.play(MAGE_RUN, true);
    this.scene.tweens.add({
      targets: this.player,
      x: target,
      y: WALK_Y + 40,
      duration,
      ease: 'Sine.InOut',
      onComplete: () => {
        if (this.scene.anims.exists(MAGE_IDLE)) this.player.play(MAGE_IDLE, true);
      },
    });
    this.pedestals.forEach((pedestal, i) => {
      this.scene.tweens.add({ targets: pedestal.beam, alpha: i === index ? 1 : 0.35, duration: this.fast ? 1 : 250 });
    });
  }

  /** The weapon leaves its pedestal and lands in your hands, with a bit of a show. */
  private grab(pedestal: PedestalView): Promise<void> {
    playSound('melee.swing');
    const scene = this.scene;
    const flyer = pedestal.weapon;
    const angle = flyer.angle;
    scene.tweens.killTweensOf(flyer);
    return new Promise((resolve) => {
      scene.tweens.add({
        targets: flyer,
        x: this.player.x,
        y: this.player.y - 70,
        angle: flyer.angle + 360,
        scale: 0.7,
        duration: this.fast ? 1 : 700,
        ease: 'Cubic.InOut',
        onComplete: () => {
          playSound('ui.confirm');
          const flash = scene.add.circle(this.player.x, this.player.y - 60, 20, 0xfff2c0, 0.9).setBlendMode(Phaser.BlendModes.ADD);
          this.root.add(flash);
          scene.tweens.add({ targets: flash, scale: 5, alpha: 0, duration: this.fast ? 1 : 500, onComplete: () => flash.destroy() });
          for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2;
            const spark = scene.add.circle(this.player.x, this.player.y - 60, 2, 0xffd98a, 1);
            this.root.add(spark);
            scene.tweens.add({
              targets: spark,
              x: spark.x + Math.cos(angle) * 90,
              y: spark.y + Math.sin(angle) * 90,
              alpha: 0,
              duration: this.fast ? 1 : 600,
              ease: 'Cubic.Out',
              onComplete: () => spark.destroy(),
            });
          }
          scene.tweens.add({ targets: this.player, y: this.player.y - 18, duration: this.fast ? 1 : 140, yoyo: true, ease: 'Sine.Out' });
          scene.tweens.add({
            targets: flyer,
            alpha: 0,
            duration: this.fast ? 1 : 300,
            onComplete: () => {
              // Home again, unseen: a shared rack shows it once more.
              flyer.setPosition(pedestal.x, PEDESTAL_Y - 80).setAngle(angle).setScale(1);
              resolve();
            },
          });
        },
      });
    });
  }

  // --- Painting ---

  private paintTaken(state: ArmoryState): void {
    state.pedestals.forEach((pedestal, index) => {
      const view = this.pedestals[index];
      if (!view) return;
      const gone = !state.shared && pedestal.takenBy.length > 0;
      if (gone) view.weapon.setAlpha(0);
      else if (view.weapon.alpha === 0) this.scene.tweens.add({ targets: view.weapon, alpha: 1, duration: this.fast ? 1 : 400 });
      view.plate.setColor(gone ? MENU_HEX.disabled : MENU_HEX.brassLight);
      view.note.setText(pedestal.takenBy.length > 0 ? `Taken by ${pedestal.takenBy.join(', ')}` : '');
    });
  }

  private paintRoom(): void {
    const scene = this.scene;
    const g = scene.add.graphics();
    // Back wall: dark timber panels above a stone skirting.
    g.fillStyle(0x1d140e, 1).fillRect(0, 0, W, FLOOR_Y);
    for (let x = 0; x < W; x += 80) {
      g.fillStyle(x % 160 === 0 ? 0x251a12 : 0x22170f, 1).fillRect(x + 2, 40, 76, FLOOR_Y - 90);
      g.lineStyle(1, 0x3a281b, 0.8).strokeRect(x + 2, 40, 76, FLOOR_Y - 90);
    }
    g.fillStyle(0x3a281b, 1).fillRect(0, 30, W, 12);
    g.fillStyle(0x2e2a26, 1).fillRect(0, FLOOR_Y - 50, W, 50);
    for (let x = 0; x < W; x += 64) g.lineStyle(1, 0x1b1916, 1).strokeRect(x + ((x / 64) % 2) * 16, FLOOR_Y - 50, 64, 25).strokeRect(x, FLOOR_Y - 25, 64, 25);
    // Floor: planks going back to the wall.
    g.fillStyle(0x4a3322, 1).fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
    for (let y = FLOOR_Y; y < H; y += 22) {
      g.fillStyle(((y - FLOOR_Y) / 22) % 2 === 0 ? 0x4f3625 : 0x46301f, 1).fillRect(0, y, W, 21);
      g.lineStyle(1, 0x2a1c12, 1).lineBetween(0, y, W, y);
      const offset = ((y - FLOOR_Y) / 22) * 97;
      for (let x = offset % 180; x < W; x += 180) g.lineBetween(x, y, x, y + 21);
    }
    // A worn runner up the middle.
    g.fillStyle(0x6b2a24, 0.9).fillRect(W / 2 - 520, WALK_Y + 10, 1040, 50);
    g.lineStyle(2, 0xc9a64a, 0.6).strokeRect(W / 2 - 516, WALK_Y + 14, 1032, 42);
    this.root.add(g);
    // Banners.
    [150, 470, 810, 1130].forEach((x, index) => {
      const banner = scene.add.graphics();
      const color = [0x2f4f86, 0x7c3733, 0x2f4f86, 0x7c3733][index];
      banner.fillStyle(0xc9a64a, 1).fillRect(x - 40, 52, 80, 6);
      banner.fillStyle(color, 1).fillPoints([
        new Phaser.Geom.Point(x - 34, 58), new Phaser.Geom.Point(x + 34, 58),
        new Phaser.Geom.Point(x + 34, 200), new Phaser.Geom.Point(x, 176), new Phaser.Geom.Point(x - 34, 200),
      ], true);
      banner.lineStyle(2, 0xc9a64a, 0.8).strokeCircle(x, 112, 16);
      banner.lineBetween(x - 10, 122, x + 10, 102);
      banner.lineBetween(x - 10, 102, x + 10, 122);
      banner.setPosition(0, 0);
      this.root.add(banner);
      if (!this.fast) scene.tweens.add({ targets: banner, scaleY: 1.01, duration: 2400 + index * 300, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    });
    // Torches.
    [310, 970].forEach((x, index) => {
      const glow = scene.add.circle(x, 150, 90, 0xff9a3c, 0.12).setBlendMode(Phaser.BlendModes.ADD);
      const holder = scene.add.rectangle(x, 176, 10, 36, 0x2a211b).setStrokeStyle(1, 0x65472b);
      const flame = scene.add.ellipse(x, 150, 16, 26, 0xffb347, 1).setBlendMode(Phaser.BlendModes.ADD);
      const core = scene.add.ellipse(x, 154, 7, 12, 0xfff2c0, 1);
      this.root.add([glow, holder, flame, core]);
      if (this.fast) return;
      scene.tweens.add({ targets: glow, alpha: 0.2, scale: 1.1, duration: 180 + index * 40, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      scene.tweens.add({ targets: flame, scaleY: 1.25, scaleX: 0.85, duration: 140 + index * 30, yoyo: true, repeat: -1 });
    });
    // Dust in the light.
    for (let i = 0; i < 30; i++) {
      const mote = scene.add.circle(Math.random() * W, 60 + Math.random() * 480, 1, 0xffe8b0, 0.3 + Math.random() * 0.3);
      this.root.add(mote);
      if (this.fast) continue;
      scene.tweens.add({ targets: mote, y: mote.y + 30 + Math.random() * 40, x: mote.x + (Math.random() - 0.5) * 30, alpha: 0, duration: 4000 + Math.random() * 5000, repeat: -1, delay: Math.random() * 3000 });
    }
  }

  private paintKeeper(): Phaser.GameObjects.Sprite {
    const scene = this.scene;
    const key = 'keeper:guildmaster';
    bufferTexture(scene, key, keeperPixels('guildmaster'), 16);
    const anim = 'keeper-idle:guildmaster';
    if (!scene.anims.exists(anim)) {
      scene.anims.create({ key: anim, frames: scene.anims.generateFrameNumbers(key, { start: 0, end: 1 }), frameRate: 1.6, repeat: -1 });
    }
    // A counter across the back, the guildmaster behind it.
    const counter = scene.add.graphics();
    counter.fillStyle(0x5a3d27, 1).fillRect(W / 2 - 110, FLOOR_Y - 60, 220, 70);
    counter.fillStyle(0x6e4b31, 1).fillRect(W / 2 - 120, FLOOR_Y - 68, 240, 12);
    counter.lineStyle(2, 0x2a1c12, 1).strokeRect(W / 2 - 110, FLOOR_Y - 60, 220, 70);
    const keeper = scene.add.sprite(W / 2, FLOOR_Y - 56, key, 0).setOrigin(0.5, 1).setScale(6);
    keeper.play(anim);
    this.root.add([keeper, counter]);
    return keeper;
  }

  private paintPedestal(id: ItemId, x: number): PedestalView {
    const scene = this.scene;
    const beam = scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.35);
    beam.fillStyle(0xfff0c0, 0.08).fillTriangle(x, 0, x - 90, PEDESTAL_Y + 10, x + 90, PEDESTAL_Y + 10);
    beam.fillStyle(0xfff0c0, 0.12).fillEllipse(x, PEDESTAL_Y + 6, 170, 30);
    const stone = scene.add.graphics();
    stone.fillStyle(0x000000, 0.35).fillEllipse(x, PEDESTAL_Y + 64, 130, 22);
    stone.fillStyle(0x6d6a66, 1).fillRect(x - 56, PEDESTAL_Y + 44, 112, 18);
    stone.fillStyle(0x5a5754, 1).fillRect(x - 36, PEDESTAL_Y - 4, 72, 50);
    stone.fillStyle(0x8a8580, 1).fillRect(x - 50, PEDESTAL_Y - 16, 100, 14);
    stone.lineStyle(1, 0x2e2c2a, 1).strokeRect(x - 36, PEDESTAL_Y - 4, 72, 50).strokeRect(x - 50, PEDESTAL_Y - 16, 100, 14).strokeRect(x - 56, PEDESTAL_Y + 44, 112, 18);
    stone.lineStyle(1, 0x9d978f, 0.5).lineBetween(x - 20, PEDESTAL_Y + 4, x - 20, PEDESTAL_Y + 40);
    const weapon = this.paintWeapon(id);
    weapon.setPosition(x, PEDESTAL_Y - 80);
    const plate = scene.add.text(x, PEDESTAL_Y + 76, getItem(id).name, {
      fontFamily: MENU_FONT.display,
      fontSize: '15px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
    }).setOrigin(0.5, 0);
    const note = scene.add.text(x, PEDESTAL_Y + 96, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      color: MENU_HEX.boneDim,
    }).setOrigin(0.5, 0);
    this.root.add([beam, stone, weapon, plate, note]);
    if (!this.fast) {
      scene.tweens.add({ targets: weapon, y: weapon.y - 10, duration: 1500 + x % 400, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
    return { id, x, weapon, beam, plate, note };
  }

  /** Each starter weapon, drawn upright around (0, 0). */
  private paintWeapon(id: ItemId): Phaser.GameObjects.Container {
    const scene = this.scene;
    const glow = scene.add.circle(0, 0, 56, 0xffe2a0, 0.12).setBlendMode(Phaser.BlendModes.ADD);
    const g = scene.add.graphics();
    const parts: Phaser.GameObjects.GameObject[] = [glow, g];
    if (id === 'travellersDagger') {
      g.fillStyle(0xd7dde4, 1).fillTriangle(-7, -8, 7, -8, 0, -52);
      g.fillStyle(0xa9b2bc, 1).fillTriangle(0, -8, 7, -8, 0, -52);
      g.fillStyle(0xc9a64a, 1).fillRect(-16, -10, 32, 6);
      g.fillStyle(0x5b3a22, 1).fillRect(-4, -4, 8, 26);
      g.fillStyle(0xc9a64a, 1).fillCircle(0, 25, 5);
    } else if (id === 'quarterstaff') {
      g.fillStyle(0x8a5a33, 1).fillRect(-4, -60, 8, 120);
      g.fillStyle(0x6b4426, 1).fillRect(1, -60, 3, 120);
      g.fillStyle(0x9aa3ab, 1).fillRect(-5, -60, 10, 8).fillRect(-5, 52, 10, 8);
      g.fillStyle(0x3b2a1c, 1).fillRect(-5, -8, 10, 16);
    } else if (id === 'shortsword') {
      g.fillStyle(0xd7dde4, 1).fillRect(-6, -62, 12, 54).fillTriangle(-6, -62, 6, -62, 0, -74);
      g.fillStyle(0xa9b2bc, 1).fillRect(0, -62, 6, 54).fillTriangle(0, -62, 6, -62, 0, -74);
      g.fillStyle(0xc9a64a, 1).fillRect(-20, -10, 40, 6);
      g.fillStyle(0x5b3a22, 1).fillRect(-4, -4, 8, 30);
      g.fillStyle(0xc9a64a, 1).fillCircle(0, 29, 6);
    } else if (id === 'huntingBow') {
      g.lineStyle(6, 0x7a4c2a, 1);
      g.beginPath();
      g.arc(-30, 0, 56, -1.05, 1.05);
      g.strokePath();
      g.lineStyle(1, 0xece4d0, 1).lineBetween(-2, -48, -2, 48);
      g.fillStyle(0x3b2a1c, 1).fillRect(22, -8, 6, 16);
      g.lineStyle(2, 0x9a7b55, 1).lineBetween(-12, 0, 44, 0);
      g.fillStyle(0xb9c0cc, 1).fillTriangle(44, -5, 44, 5, 54, 0);
      g.fillStyle(0xd8cbae, 1).fillTriangle(-12, 0, -20, -6, -16, 0).fillTriangle(-12, 0, -20, 6, -16, 0);
    } else {
      g.fillStyle(0x2b1d14, 1).fillRect(-3, -40, 6, 76);
      g.fillStyle(0xc9a64a, 1).fillRect(-4, 20, 8, 5).fillRect(-4, -34, 8, 4);
      const tip = scene.add.circle(0, -46, 7, 0xb98bff, 1).setBlendMode(Phaser.BlendModes.ADD);
      const halo = scene.add.circle(0, -46, 16, 0xb98bff, 0.35).setBlendMode(Phaser.BlendModes.ADD);
      parts.push(halo, tip);
      if (!this.fast) scene.tweens.add({ targets: halo, scale: 1.5, alpha: 0.1, duration: 900, yoyo: true, repeat: -1 });
    }
    const weapon = scene.add.container(0, 0, parts);
    weapon.setAngle(id === 'quarterstaff' ? 18 : id === 'huntingBow' ? -10 : 0);
    if (!this.fast) scene.tweens.add({ targets: glow, alpha: 0.24, scale: 1.15, duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    return weapon;
  }
}

function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? 'someone';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
