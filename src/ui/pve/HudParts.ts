// Pieces of the on-foot HUD, all in the cabinet's materials: hardwood plates
// with a brass rule, bone key caps, bars that ease to their value and leave a
// pale trail where damage was taken.

import Phaser from 'phaser';
import { MENU_COLOR, MENU_FONT, MENU_HEX } from '../cabinet/theme';
import { isReducedMotion } from '../cabinet/motion';
import { mix } from '../../world/pixels';

/** A solid hardwood plate with a brass rule along its top. */
export function drawPlate(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
  g.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(x, y, w, h);
  g.fillStyle(MENU_COLOR.wood, 1).fillRect(x + 2, y + 4, w - 4, h - 6);
  g.fillStyle(MENU_COLOR.woodRaised, 1).fillRect(x + 2, y + 4, w - 4, 1);
  g.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  g.fillStyle(MENU_COLOR.brass, 1).fillRect(x, y, w, 2);
}

/** A bone key cap with a pressed-in lower edge. Returns its width. */
function keyCap(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, x: number, y: number, key: string, size = 12): number {
  const text = scene.add.text(0, 0, key.toUpperCase(), {
    fontFamily: MENU_FONT.control, fontSize: `${size}px`, fontStyle: 'bold', color: MENU_HEX.ink,
  });
  const w = Math.max(size + 10, Math.ceil(text.width) + 12);
  const h = size + 10;
  const g = scene.add.graphics();
  g.fillStyle(MENU_COLOR.boneDim, 1).fillRect(x, y, w, h);
  g.fillStyle(MENU_COLOR.bone, 1).fillRect(x, y, w, h - 3);
  g.lineStyle(1, MENU_COLOR.ink, 1).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  text.setPosition(x + Math.round((w - text.width) / 2), y + 3);
  parent.add([g, text]);
  return w;
}

/** The control legend along the bottom: "E: act     I: pack" drawn as key caps. */
export class KeyLegend extends Phaser.GameObjects.Container {
  private source = '';

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y);
    scene.add.existing(this);
  }

  set(text: string): void {
    if (text === this.source) return;
    this.source = text;
    this.removeAll(true);
    let x = 0;
    for (const part of text.split(/\s{3,}/).map((s) => s.trim()).filter(Boolean)) {
      const at = part.lastIndexOf(': ');
      if (at < 0) {
        const note = this.scene.add.text(x, 3, part, { fontFamily: MENU_FONT.control, fontSize: '12px', color: MENU_HEX.brassLight });
        this.add(note);
        x += Math.ceil(note.width) + 16;
        continue;
      }
      x += keyCap(this.scene, this, x, -1, part.slice(0, at), 11) + 5;
      const label = this.scene.add.text(x, 3, part.slice(at + 2), { fontFamily: MENU_FONT.control, fontSize: '12px', color: MENU_HEX.bone });
      this.add(label);
      x += Math.ceil(label.width) + 16;
    }
    const back = this.scene.add.graphics();
    back.fillStyle(MENU_COLOR.pitch, 1).fillRect(-8, -6, x + 2, 32);
    back.fillStyle(MENU_COLOR.brassDark, 1).fillRect(-8, -6, x + 2, 1);
    this.addAt(back, 0);
  }
}

/** "[E] Talk: Mira" as a key cap and a label, popping in when it changes; also shows hold progress. */
export class PromptPlate extends Phaser.GameObjects.Container {
  private source = '';
  private holdBar?: Phaser.GameObjects.Graphics;
  private plateW = 0;
  private plateH = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y);
    scene.add.existing(this);
    this.setVisible(false);
  }

  set(text: string | null, visible: boolean): void {
    if (!text) {
      this.source = '';
      this.setVisible(false);
      return;
    }
    if (text !== this.source) this.build(text);
    this.setVisible(visible);
  }

  private build(text: string): void {
    const fresh = !this.source;
    this.source = text;
    this.removeAll(true);
    const match = /^\[(Hold )?([^\]]+)\]\s*(.*)$/.exec(text);
    const inner = this.scene.add.container(0, 0);
    let x = 0;
    if (match) {
      if (match[1]) {
        const hold = this.scene.add.text(x, 5, 'HOLD', { fontFamily: MENU_FONT.control, fontSize: '12px', fontStyle: 'bold', color: MENU_HEX.brass });
        inner.add(hold);
        x += Math.ceil(hold.width) + 6;
      }
      x += keyCap(this.scene, inner, x, 0, match[2], 14) + 10;
    }
    const label = this.scene.add.text(x, 2, match ? match[3] : text, {
      fontFamily: MENU_FONT.control, fontSize: '17px', fontStyle: 'bold', color: MENU_HEX.bone,
    });
    inner.add(label);
    x += Math.ceil(label.width);
    const w = x + 28;
    const h = 40;
    const back = this.scene.add.graphics();
    drawPlate(back, -w / 2, -h / 2, w, h);
    inner.setPosition(Math.round(-w / 2 + 14), -12);
    this.holdBar = this.scene.add.graphics();
    this.plateW = w;
    this.plateH = h;
    this.add([back, inner, this.holdBar]);
    if (isReducedMotion()) return;
    this.scene.tweens.killTweensOf(this);
    this.setScale(fresh ? 0.9 : 0.97).setAlpha(fresh ? 0 : 1);
    this.scene.tweens.add({ targets: this, scale: 1, alpha: 1, duration: fresh ? 160 : 110, ease: 'Back.Out' });
  }

  /** 0..1 fills the brass strip under the plate; null clears it. */
  setHold(t: number | null): void {
    const g = this.holdBar;
    if (!g) return;
    g.clear();
    if (t == null) return;
    const w = this.plateW - 8;
    const y = this.plateH / 2 + 3;
    g.fillStyle(MENU_COLOR.ink, 1).fillRect(-w / 2 - 1, y - 1, w + 2, 7);
    g.fillStyle(t >= 1 ? MENU_COLOR.bone : MENU_COLOR.brassLight, 1).fillRect(-w / 2, y, Math.round(w * t), 5);
  }
}

interface Toast { message: string; ms: number }

/** Messages slide in one at a time; a waiting one cuts a long one short. */
export class ToastRail {
  private queue: Toast[] = [];
  private current?: Phaser.GameObjects.Container;
  private shownAt = 0;
  private timer?: Phaser.Time.TimerEvent;

  constructor(private readonly scene: Phaser.Scene, private readonly x: number, private readonly y: number) {}

  push(message: string, ms: number): void {
    if (this.queue.some((t) => t.message === message)) return;
    this.queue.push({ message, ms });
    if (this.queue.length > 3) this.queue.shift();
    if (!this.current) this.next();
    else if (this.scene.time.now - this.shownAt > 900) this.dismiss();
    else {
      this.timer?.remove();
      this.timer = this.scene.time.delayedCall(900 - (this.scene.time.now - this.shownAt), () => this.dismiss());
    }
  }

  private next(): void {
    const toast = this.queue.shift();
    if (!toast) return;
    const scene = this.scene;
    const text = scene.add.text(0, 0, toast.message, {
      fontFamily: MENU_FONT.body, fontSize: '15px', color: MENU_HEX.bone, align: 'center', wordWrap: { width: 720 },
    }).setOrigin(0.5, 0);
    const w = Math.ceil(text.width) + 36;
    const h = Math.ceil(text.height) + 20;
    const back = scene.add.graphics();
    drawPlate(back, -w / 2, 0, w, h);
    text.setY(11);
    const box = scene.add.container(this.x, this.y, [back, text]).setDepth(50);
    this.current = box;
    this.shownAt = scene.time.now;
    if (!isReducedMotion()) {
      box.setAlpha(0).setY(this.y - 12);
      scene.tweens.add({ targets: box, alpha: 1, y: this.y, duration: 180, ease: 'Cubic.Out' });
    }
    this.timer?.remove();
    this.timer = scene.time.delayedCall(this.queue.length ? Math.min(toast.ms, 1400) : toast.ms, () => this.dismiss());
  }

  private dismiss(): void {
    this.timer?.remove();
    this.timer = undefined;
    const box = this.current;
    this.current = undefined;
    if (box) {
      this.scene.tweens.killTweensOf(box);
      this.scene.tweens.add({ targets: box, alpha: 0, y: box.y - 8, duration: 200, ease: 'Sine.In', onComplete: () => box.destroy() });
    }
    this.next();
  }
}

/** A bar that eases to its value; a drop leaves a pale trail that drains after it. */
export class EasedBar {
  private shown = -1;
  private trail = 0;
  private target = 0;
  private max = 1;
  private hold = 0;

  constructor(readonly x: number, readonly y: number, readonly w: number, readonly h: number, readonly color: number) {}

  set(value: number, max: number): void {
    this.max = Math.max(1, max);
    if (this.shown < 0) this.shown = this.trail = value;
    if (value < this.target) this.hold = 380;
    this.target = value;
  }

  /** True while it still moves. */
  step(delta: number): boolean {
    const before = this.shown + this.trail;
    const reduced = isReducedMotion();
    this.shown = reduced ? this.target : this.shown + (this.target - this.shown) * Math.min(1, delta / 90);
    if (Math.abs(this.shown - this.target) < 0.05) this.shown = this.target;
    if (this.trail < this.shown || reduced) this.trail = this.shown;
    else if (this.hold > 0) this.hold -= delta;
    else this.trail = Math.max(this.shown, this.trail - (this.max * delta) / 900);
    return this.shown + this.trail !== before;
  }

  draw(g: Phaser.GameObjects.Graphics): void {
    const f = (v: number): number => Math.round(this.w * Math.max(0, Math.min(1, v / this.max)));
    g.fillStyle(MENU_COLOR.ink, 1).fillRect(this.x, this.y, this.w, this.h);
    g.fillStyle(0xe8d6a0, 1).fillRect(this.x, this.y, f(this.trail), this.h);
    const fill = f(this.shown);
    g.fillStyle(this.color, 1).fillRect(this.x, this.y, fill, this.h);
    if (fill > 2) g.fillStyle(mix(this.color, 0xffffff, 0.25), 1).fillRect(this.x, this.y, fill, 2);
    g.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(this.x + 0.5, this.y + 0.5, this.w - 1, this.h - 1);
  }
}
