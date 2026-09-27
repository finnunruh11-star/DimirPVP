// Something spotted off the way, offered as a card at the foot of the screen so
// the map above stays in view: what it is, where it lies, and whether to go.

import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config/constants';
import { SceneInput } from '../../engine/SceneInput';
import type { SightingKind } from '../../pve/exploration/journey';
import { cssColor, mixColor } from '../../visuals/daylight';
import { ensureGlowTextures, GLOW } from '../../visuals/glowTextures';
import { CabinetChip, MenuFocusGroup } from '../cabinet/controls';
import { isReducedMotion } from '../cabinet/motion';
import { MENU_COLOR, MENU_FONT, MENU_HEX } from '../cabinet/theme';
import { drawSightingGlyph, SIGHTING_COLORS } from './sightingGlyphs';

export interface SightingCardModel {
  kind: SightingKind;
  title: string;
  bearing: string;
  text: string;
  go: string;
  pass: string;
}

const W = 680;
const H = 172;

export class SightingCard extends Phaser.GameObjects.Container {
  private readonly keys: SceneInput;
  private readonly focus = new MenuFocusGroup();
  private settled = false;

  constructor(scene: Phaser.Scene, model: SightingCardModel, private readonly choose: (go: boolean) => void) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setDepth(97);
    ensureGlowTextures(scene);
    const left = (GAME_WIDTH - W) / 2;
    const top = GAME_HEIGHT - H - 42;
    const color = SIGHTING_COLORS[model.kind];

    const shade = scene.add.graphics();
    for (let i = 0; i < 12; i++) shade.fillStyle(0x000000, 0.03 + i * 0.03).fillRect(0, GAME_HEIGHT - 288 + i * 24, GAME_WIDTH, 24);

    const frame = scene.add.graphics();
    frame.fillStyle(MENU_COLOR.pitch, 0.8).fillRect(left + 6, top + 7, W, H);
    frame.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(left, top, W, H);
    frame.fillStyle(MENU_COLOR.charcoal, 1).fillRect(left + 9, top + 9, W - 18, H - 18);
    frame.fillStyle(mixColor(MENU_COLOR.charcoal, color, 0.08), 1).fillRect(left + 9, top + 13, W - 18, 46);
    frame.lineStyle(2, MENU_COLOR.brassDark, 1).strokeRect(left + 9.5, top + 9.5, W - 19, H - 19);
    frame.lineStyle(1, MENU_COLOR.brass, 0.55).strokeRect(left + 0.5, top + 0.5, W - 1, H - 1);
    frame.fillStyle(color, 1).fillRect(left + 9, top + 9, W - 18, 4);
    for (const [x, y] of [[left + 4, top + 4], [left + W - 4, top + 4], [left + 4, top + H - 4], [left + W - 4, top + H - 4]]) {
      frame.fillStyle(MENU_COLOR.ink, 1).fillCircle(x, y + 0.5, 3);
      frame.fillStyle(MENU_COLOR.brass, 1).fillCircle(x, y, 2.4);
    }

    const mx = left + 86;
    const my = top + H / 2 + 3;
    const aura = scene.add.image(mx, my, GLOW.soft).setTint(color).setBlendMode(Phaser.BlendModes.ADD).setScale(1.35).setAlpha(0.3);
    const medal = scene.add.graphics({ x: mx, y: my });
    medal.fillStyle(MENU_COLOR.ink, 1).fillCircle(1.5, 3, 52);
    medal.fillStyle(MENU_COLOR.pitch, 1).fillCircle(0, 0, 51);
    medal.lineStyle(3, MENU_COLOR.brass, 1).strokeCircle(0, 0, 48);
    medal.lineStyle(1, MENU_COLOR.brassLight, 0.7).strokeCircle(0, 0, 44);
    medal.fillStyle(mixColor(color, 0x000000, 0.74), 1).fillCircle(0, 0, 42);
    medal.fillStyle(mixColor(color, 0x000000, 0.6), 1).fillCircle(0, -4, 36);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      medal.fillStyle(MENU_COLOR.brassLight, 0.8).fillCircle(Math.cos(a) * 48, Math.sin(a) * 48, 1.2);
    }
    const glyph = scene.add.graphics({ x: mx, y: my });
    drawSightingGlyph(glyph, model.kind, 50);

    const textX = left + 160;
    const textW = W - 184;
    const kicker = scene.add.text(textX, top + 22, `SPOTTED   ·   ${model.bearing.toUpperCase()}`, {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      fontStyle: 'bold',
      color: cssColor(mixColor(color, 0xffffff, 0.25)),
    }).setLetterSpacing(3);
    let size = 24;
    const title = scene.add.text(textX, top + 38, model.title, {
      fontFamily: MENU_FONT.display,
      fontSize: `${size}px`,
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    });
    while (title.width > textW && size > 15) title.setFontSize(--size);
    const body = scene.add.text(textX, top + 72, model.text, {
      fontFamily: MENU_FONT.body,
      fontSize: '14px',
      color: MENU_HEX.boneDim,
      wordWrap: { width: textW },
      lineSpacing: 2,
    });
    this.add([shade, frame, aura, medal, glyph, kicker, title, body]);

    const go = new CabinetChip(scene, textX, top + H - 54, {
      width: 300,
      height: 36,
      label: `1   ${model.go}`,
      tone: 'primary',
      onActivate: () => this.settle(true),
    });
    const pass = new CabinetChip(scene, textX + 312, top + H - 54, {
      width: textW - 312,
      height: 36,
      label: `2   ${model.pass}`,
      onActivate: () => this.settle(false),
    });
    this.add([go, pass]);
    this.focus.add(go);
    this.focus.add(pass);

    this.keys = new SceneInput(scene);
    this.keys.bindKeys([
      { key: 'ONE', run: () => this.settle(true) },
      { key: 'TWO', run: () => this.settle(false) },
      { key: 'ESC', run: () => this.settle(false) },
      { key: 'LEFT', capture: true, run: () => this.focus.move(-1) },
      { key: 'RIGHT', capture: true, run: () => this.focus.move(1) },
      { key: 'UP', capture: true, run: () => this.focus.move(-1) },
      { key: 'DOWN', capture: true, run: () => this.focus.move(1) },
      { key: 'TAB', capture: true, run: (event) => this.focus.move(event.shiftKey ? -1 : 1) },
      { key: 'ENTER', capture: true, run: () => this.focus.activate() },
      { key: 'SPACE', capture: true, run: () => this.focus.activate() },
    ]);

    const still = isReducedMotion();
    this.setAlpha(0).setY(still ? 0 : 26);
    scene.tweens.add({ targets: this, alpha: 1, y: 0, duration: still ? 120 : 280, ease: 'Cubic.Out' });
    if (!still) {
      glyph.setScale(0.35);
      scene.tweens.add({ targets: glyph, scale: 1, duration: 460, delay: 110, ease: 'Back.Out' });
      scene.tweens.add({ targets: aura, alpha: 0.6, scale: 1.55, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
  }

  private settle(go: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.keys.destroy();
    this.choose(go);
    this.scene.tweens.killTweensOf(this.list);
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      y: 18,
      duration: 170,
      ease: 'Cubic.In',
      onComplete: () => this.destroy(),
    });
  }

  override destroy(fromScene?: boolean): void {
    if (!this.settled) this.keys.destroy();
    this.settled = true;
    if (this.scene) this.scene.tweens.killTweensOf([this, ...this.list]);
    super.destroy(fromScene);
  }
}
