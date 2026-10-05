// A mine room filling the window: the picture of what lies past the doorway,
// what it means in one big line, and the choices. From the threshold the room is
// dark and only gives itself away (eyes, a glint of ore, the edge of a chest);
// inside, the party's lamp lights it.

import Phaser from 'phaser';
import { SceneInput } from '../../engine/SceneInput';
import type { MineOreKind } from '../../pve/mineMaze';
import { ensureGlowTextures, GLOW } from '../../visuals/glowTextures';
import {
  CHAMBER_H,
  CHAMBER_W,
  chamberLayout,
  paintChamber,
  paintVein,
  veinGlints,
  type ChamberLayout,
  type ChamberSpec,
  type VeinState,
} from '../../visuals/mineChamber';
import { bufferTexture } from '../../world/localeRender';
import { CabinetChip, MenuFocusGroup } from '../cabinet/controls';
import { isReducedMotion } from '../cabinet/motion';
import { addCabinetBackdrop, MENU_COLOR, MENU_FONT, MENU_HEX } from '../cabinet/theme';
import type { MineLight } from './MineMapView';
import { MineVoteStrip, type MineVoteDisplay, type MineVoteState } from './MineVoteStrip';

/** Where the picture sits in the window, and how much each of its pixels is blown up. */
export const PICTURE = { x: 60, y: 84, scale: 4 } as const;
export const PICTURE_W = CHAMBER_W * PICTURE.scale;
export const PICTURE_H = CHAMBER_H * PICTURE.scale;

const SHINE: Record<MineOreKind, number> = {
  coal: 0xc8d8ff,
  copper: 0xffb070,
  iron: 0xe8e0d8,
  gold: 0xffe080,
};

let textureSerial = 0;

export interface ChamberOre {
  kind: MineOreKind;
  /** One entry per vein, filling the room's vein slots in order. */
  veins: VeinState[];
}

/**
 * The picture itself, with what moves in it: eyes that blink in the dark, ore and
 * locks that glint, the lamp that flickers. Its textures go when it does.
 */
export class ChamberPicture {
  readonly layout: ChamberLayout;
  private readonly keys: string[] = [];
  private readonly veins: Phaser.GameObjects.Image[] = [];
  private readonly glints: Phaser.GameObjects.Image[][] = [];
  private readonly timers: Phaser.Time.TimerEvent[] = [];
  private readonly serial = ++textureSerial;
  private readonly reduced = isReducedMotion();
  private readonly maskShape: Phaser.GameObjects.Graphics;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly parent: Phaser.GameObjects.Container,
    private readonly spec: ChamberSpec,
    private readonly ore?: ChamberOre,
    /** What the party carries: a torch flickers warm, a lantern holds steady, and without either the room stays murky. */
    light: MineLight = 'torch',
  ) {
    ensureGlowTextures(scene);
    this.layout = chamberLayout(spec.seed);
    const { x, y, scale } = PICTURE;
    const frame = scene.add.graphics();
    frame.fillStyle(MENU_COLOR.pitch, 1).fillRect(x - 6, y - 6, PICTURE_W + 12, PICTURE_H + 12);
    frame.lineStyle(2, MENU_COLOR.brassDark, 1).strokeRect(x - 4, y - 4, PICTURE_W + 8, PICTURE_H + 8);
    frame.lineStyle(1, MENU_COLOR.brass, 0.5).strokeRect(x - 6.5, y - 6.5, PICTURE_W + 13, PICTURE_H + 13);
    parent.add(frame);

    const roomKey = this.texture('room', paintChamber(spec));
    const room = scene.add.image(x, y, roomKey).setOrigin(0).setScale(scale);
    parent.add(room);

    const overlay = scene.add.container(0, 0);
    parent.add(overlay);
    this.maskShape = scene.make.graphics({}, false).fillRect(x, y, PICTURE_W, PICTURE_H);
    overlay.setMask(this.maskShape.createGeometryMask());

    ore?.veins.forEach((state, slot) => {
      const at = this.layout.veins[slot];
      if (!at) return;
      const image = scene.add.image(x + at.x * scale, y + at.y * scale, this.veinTexture(slot, state)).setOrigin(0).setScale(scale);
      overlay.add(image);
      this.veins[slot] = image;
    });

    const vignette = scene.add.image(x + PICTURE_W / 2, y + PICTURE_H / 2, GLOW.vignette)
      .setDisplaySize(PICTURE_W * 1.08, PICTURE_H * 1.25).setAlpha((spec.lit ? 0.6 : 0.85) + (light ? 0 : 0.1));
    overlay.add(vignette);
    // No light of the party's own: only what glows by itself shows clearly.
    if (!light) overlay.add(scene.add.rectangle(x, y, PICTURE_W, PICTURE_H, 0x020304, 0.35).setOrigin(0));

    // What gives itself away stays bright over the dark edges.
    ore?.veins.forEach((state, slot) => {
      this.glints[slot] = state === 'intact' && this.layout.veins[slot] ? this.addGlints(overlay, slot) : [];
    });
    if (spec.content === 'treasure' && !spec.resolved) this.addGlint(overlay, this.layout.glint.x, this.layout.glint.y, 0xffe08a, 0.2, 0);
    if (spec.content === 'enemies' && !spec.resolved) this.addEyes(overlay);

    // The party's light: by the doorway it lights the threshold; a torch flickers.
    const glowBase = light ? (spec.lit ? 0.1 : 0.08) : 0.04;
    const lamp = scene.add.image(x + 145 * scale, y + PICTURE_H + 30, GLOW.soft)
      .setTint(light === 'lantern' ? 0xffdca0 : light ? 0xff9a40 : 0x8fa2b8)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(spec.lit ? 11 : 7, spec.lit ? 5 : 3)
      .setAlpha(glowBase + 0.02);
    overlay.add(lamp);
    if (!this.reduced && light === 'torch') {
      this.timers.push(scene.time.addEvent({
        delay: 140,
        loop: true,
        callback: () => lamp.setAlpha(glowBase + Math.random() * 0.05),
      }));
    }

    if (!this.reduced) {
      // Coming up to the doorway: the room swims up out of the black.
      room.setAlpha(0);
      overlay.setAlpha(0);
      scene.tweens.add({ targets: room, alpha: 1, duration: spec.lit ? 260 : 520, ease: 'Sine.Out' });
      scene.tweens.add({ targets: overlay, alpha: 1, duration: 380, delay: spec.lit ? 60 : 320, ease: 'Sine.Out' });
    }
  }

  /** The screen rectangle of the vein in `slot`. */
  veinRect(slot: number): Phaser.Geom.Rectangle {
    const at = this.layout.veins[slot];
    const { x, y, scale } = PICTURE;
    return new Phaser.Geom.Rectangle(x + at.x * scale, y + at.y * scale, at.w * scale, at.h * scale);
  }

  /** Show the vein in `slot` as `state` now is. */
  setVein(slot: number, state: VeinState): void {
    const image = this.veins[slot];
    if (!image || !this.ore) return;
    image.setTexture(this.veinTexture(slot, state));
    if (state !== 'intact') {
      for (const glint of this.glints[slot] ?? []) {
        this.scene.tweens.killTweensOf(glint);
        glint.destroy();
      }
      this.glints[slot] = [];
    }
  }

  /** The vein in `slot` jolts as a pick bites into it. */
  jolt(slot: number): void {
    const image = this.veins[slot];
    if (!image || this.reduced) return;
    const x = image.x;
    this.scene.tweens.killTweensOf(image);
    image.x = x;
    this.scene.tweens.add({ targets: image, x: x + 4, duration: 40, yoyo: true, repeat: 1, onComplete: () => image.setX(x) });
    image.setTintFill(0xffffff);
    this.scene.time.delayedCall(55, () => image.active && image.clearTint());
  }

  destroy(): void {
    for (const timer of this.timers) timer.remove(false);
    this.maskShape.destroy();
    for (const key of this.keys) if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
  }

  private texture(name: string, px: Parameters<typeof bufferTexture>[2]): string {
    const key = `mine-${name}:${this.serial}`;
    if (!this.keys.includes(key)) this.keys.push(key);
    return bufferTexture(this.scene, key, px);
  }

  private veinTexture(slot: number, state: VeinState): string {
    const at = this.layout.veins[slot];
    return this.texture(`vein-${slot}-${state}`, paintVein(this.ore!.kind, state, this.spec, at, slot));
  }

  private addGlints(overlay: Phaser.GameObjects.Container, slot: number): Phaser.GameObjects.Image[] {
    const at = this.layout.veins[slot];
    const color = SHINE[this.ore!.kind];
    return veinGlints(this.spec, slot).map((g, k) => this.addGlint(overlay, at.x + g.x, at.y + g.y, color, this.spec.lit ? 0.14 : 0.2, k * 520 + slot * 330));
  }

  /** A soft star that comes and goes over pixel (px, py) of the room. */
  private addGlint(overlay: Phaser.GameObjects.Container, px: number, py: number, color: number, size: number, delay: number): Phaser.GameObjects.Image {
    const { x, y, scale } = PICTURE;
    const glint = this.scene.add.image(x + (px + 0.5) * scale, y + (py + 0.5) * scale, GLOW.soft)
      .setTint(color).setBlendMode(Phaser.BlendModes.ADD).setScale(size).setAlpha(this.reduced ? 0.6 : 0);
    overlay.add(glint);
    if (!this.reduced) {
      this.scene.tweens.add({
        targets: glint,
        alpha: { from: 0, to: 0.95 },
        scale: { from: size * 0.6, to: size * 1.25 },
        duration: 420,
        yoyo: true,
        hold: 120,
        repeat: -1,
        repeatDelay: 1300 + (delay % 900),
        delay: 400 + delay,
        ease: 'Sine.InOut',
      });
    }
    return glint;
  }

  /** Pairs of red eyes in the dark: they glow, drift a little and blink. */
  private addEyes(overlay: Phaser.GameObjects.Container): void {
    const { x, y, scale } = PICTURE;
    this.layout.eyes.forEach((spot, index) => {
      const size = spot.size * scale;
      const left = x + spot.x * scale + size / 2;
      const right = left + spot.gap * scale;
      const ey = y + spot.y * scale + size / 2;
      const pair = this.scene.add.container(0, 0);
      const glow = this.scene.add.image((left + right) / 2, ey, GLOW.soft)
        .setTint(0xff2a14).setBlendMode(Phaser.BlendModes.ADD).setScale((spot.gap * scale) / 36, (size * 2.4) / 64).setAlpha(0.7);
      const shine = this.scene.add.image((left + right) / 2, ey + 40, GLOW.soft)
        .setTint(0xb01808).setBlendMode(Phaser.BlendModes.ADD).setScale(spot.gap * 0.12, 0.25).setAlpha(0.18);
      const eyes = [left, right].map((ex) => this.scene.add.rectangle(ex, ey, size, size, 0xff4a2c));
      const cores = [left, right].map((ex) => this.scene.add.rectangle(ex - size / 4, ey - size / 4, Math.max(2, size / 3), Math.max(2, size / 3), 0xffd2b0));
      pair.add([shine, glow, ...eyes, ...cores]);
      overlay.add(pair);
      if (this.reduced) return;
      pair.setAlpha(0);
      this.scene.tweens.add({ targets: pair, alpha: 1, duration: 500, delay: 700 + index * 260, ease: 'Sine.In' });
      this.scene.tweens.add({
        targets: pair,
        x: { from: -2 * scale * 0.5, to: 2 * scale * 0.5 },
        duration: 2200 + index * 380,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
      this.timers.push(this.scene.time.addEvent({
        delay: 1600 + index * 730,
        loop: true,
        callback: () => {
          if (Math.random() < 0.35) return;
          this.scene.tweens.add({ targets: [...eyes, ...cores], scaleY: 0.12, duration: 60, yoyo: true, hold: 70 });
        },
      }));
    });
  }
}

export interface MineChamberChoice {
  id: string;
  label: string;
  enabled: boolean;
  tone?: 'normal' | 'positive' | 'danger' | 'primary';
}

export interface MineChamberModel {
  title: string;
  /** Time, pickaxes and the like, small at the top right. */
  status: string;
  /** What the picture means, in a few words: "ENEMIES INSIDE". */
  verdict: string;
  verdictColor: number;
  body: string;
  spec: ChamberSpec;
  ore?: ChamberOre;
  /** Empty: someone else decides, and the window says so. */
  choices: MineChamberChoice[];
  /** The party votes on these choices (online). */
  vote?: boolean;
  /** The light the party carries; a torch when not given. */
  light?: MineLight;
}

/** One look into (or around) a mine room, and what to do about it. */
export class MineChamberView extends Phaser.GameObjects.Container implements MineVoteDisplay {
  private readonly sceneInput: SceneInput;
  private readonly focus = new MenuFocusGroup();
  private readonly picture: ChamberPicture;
  private readonly voteStrip?: MineVoteStrip;
  private disposed = false;

  constructor(scene: Phaser.Scene, model: MineChamberModel, choose: (id: string) => void, decide: () => void = () => undefined) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(99);
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
    this.picture = new ChamberPicture(scene, this, model.spec, model.ore, model.light);
    addVerdict(scene, this, model.verdict, model.verdictColor, model.body);

    const choices = model.choices;
    if (choices.length === 0) {
      this.add(scene.add.text(1000, 616, 'WAITING FOR THE PARTY LEADER', {
        fontFamily: MENU_FONT.control,
        fontSize: '13px',
        fontStyle: 'bold',
        color: MENU_HEX.brassLight,
      }).setOrigin(0.5));
    } else {
      const area = { x: 784, y: 576, w: 438, h: 92 };
      const rows = choices.length > 3 ? 2 : 1;
      const perRow = Math.ceil(choices.length / rows);
      const h = rows === 1 ? 64 : 40;
      choices.forEach((choice, index) => {
        const row = Math.floor(index / perRow);
        const column = index % perRow;
        const inRow = Math.min(perRow, choices.length - row * perRow);
        const w = Math.floor((area.w - (inRow - 1) * 10) / inRow);
        const chip = new CabinetChip(scene, area.x + column * (w + 10), area.y + (rows === 1 ? 14 : row * (h + 10)), {
          width: w,
          height: h,
          label: `${index + 1}   ${choice.label}`,
          tone: choice.tone ?? (index === 0 ? 'primary' : 'normal'),
          enabled: choice.enabled,
          onActivate: () => choose(choice.id),
        });
        this.add(chip);
        this.focus.add(chip);
      });
    }
    if (model.vote) {
      this.voteStrip = new MineVoteStrip(scene, this, { x: 1003, y: 571, width: 438, chip: { x: 600, y: 34 } }, this.focus, decide);
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
      ...['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'].map((key, index) => ({
        key,
        run: () => {
          const choice = choices[index];
          if (choice?.enabled) choose(choice.id);
        },
      })),
    ]);
  }

  setVotes(state: MineVoteState): void {
    if (!this.disposed) this.voteStrip?.set(state);
  }

  override destroy(fromScene?: boolean): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sceneInput.destroy();
    super.destroy(fromScene);
    this.picture.destroy();
  }
}

/** The big line under the picture that says what it shows, and a sentence or two after it. */
export function addVerdict(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, verdict: string, color: number, body: string): void {
  const g = scene.add.graphics();
  g.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(60, 566, 706, 108);
  g.lineStyle(1, MENU_COLOR.brassDark, 0.8).strokeRect(60.5, 566.5, 705, 107);
  g.fillStyle(color, 1).fillRect(60, 566, 6, 108);
  const hex = `#${color.toString(16).padStart(6, '0')}`;
  parent.add([
    g,
    scene.add.text(84, 576, verdict, {
      fontFamily: MENU_FONT.display,
      fontSize: '25px',
      fontStyle: 'bold',
      color: hex,
    }),
    scene.add.text(85, 612, body, {
      fontFamily: MENU_FONT.body,
      fontSize: '15px',
      color: MENU_HEX.bone,
      wordWrap: { width: 660 },
      lineSpacing: 3,
      maxLines: 3,
    }),
  ]);
}
