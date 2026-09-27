// The time wheel: a dial of the whole day, painted in the colour of each hour,
// turning under a brass pointer. The sun rises on the left, stands overhead at
// noon and sets on the right; by night the moon and stars come round. Below the
// horizon plate sit the day, the hour and how long until the light turns.

import Phaser from 'phaser';
import { clockTime, hoursToTurn, isNight, spanLabel } from '../../pve/exploration/clock';
import { MENU_COLOR, MENU_FONT, MENU_HEX } from '../cabinet/theme';
import { isReducedMotion } from '../cabinet/motion';
import { cssColor, darkness, skyColor } from '../../visuals/daylight';
import { ensureGlowTextures, GLOW } from '../../visuals/glowTextures';

const R = 52;
const WHEEL_Y = 70;
const PLATE_W = R + 36;
const PLATE_H = 52;
const TEXTURE = 'hud-time-wheel';
/** How quickly the dial catches up with the clock; long jumps spin at speed. */
const FOLLOW_MS = 170;

/** Hour `h` sits this many radians round the unrotated dial; hours run anticlockwise. */
const angleOf = (hour: number): number => -Math.PI / 2 - (hour / 24) * Math.PI * 2;

function paintDial(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEXTURE)) return;
  const size = R * 2 + 4;
  const texture = scene.textures.createCanvas(TEXTURE, size, size);
  const ctx = texture?.getContext();
  if (!texture || !ctx) return;
  const c = size / 2;
  const radial = (x: number, y: number, r0: number, r1: number, stops: [number, string][]): CanvasGradient => {
    const gradient = ctx.createRadialGradient(x, y, r0, x, y, r1);
    for (const [at, color] of stops) gradient.addColorStop(at, color);
    return gradient;
  };
  const slices = 192;
  for (let i = 0; i < slices; i++) {
    const h0 = (i / slices) * 24;
    const h1 = ((i + 1) / slices) * 24;
    ctx.fillStyle = cssColor(skyColor((h0 + h1) / 2));
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, R, angleOf(h1) - 0.004, angleOf(h0) + 0.004);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = radial(c, c, R * 0.15, R, [[0, 'rgba(255,255,255,0.12)'], [0.62, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.4)']]);
  ctx.beginPath();
  ctx.arc(c, c, R, 0, Math.PI * 2);
  ctx.fill();

  let seed = 11;
  const rand = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 48; i++) {
    const hour = 20.7 + rand() * 8.6;
    const a = angleOf(hour % 24);
    const r = R * (0.24 + rand() * 0.68);
    const x = c + Math.cos(a) * r;
    const y = c + Math.sin(a) * r;
    const edge = Math.min(hour - 20.7, 29.3 - hour);
    const alpha = Math.min(1, edge / 1.3) * (0.4 + rand() * 0.6);
    const big = rand() < 0.14;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, big ? 1.4 : 0.75, 0, Math.PI * 2);
    ctx.fill();
    if (big) {
      ctx.strokeStyle = `rgba(214,226,255,${alpha * 0.75})`;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(x - 3.2, y);
      ctx.lineTo(x + 3.2, y);
      ctx.moveTo(x, y - 3.2);
      ctx.lineTo(x, y + 3.2);
      ctx.stroke();
    }
  }

  const sun = angleOf(12);
  const sx = c + Math.cos(sun) * R * 0.6;
  const sy = c + Math.sin(sun) * R * 0.6;
  ctx.fillStyle = radial(sx, sy, 0, 21, [[0, 'rgba(255,244,200,0.95)'], [0.4, 'rgba(255,204,96,0.45)'], [1, 'rgba(255,170,60,0)']]);
  ctx.fillRect(sx - 21, sy - 21, 42, 42);
  ctx.strokeStyle = 'rgba(255,238,172,0.92)';
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let k = 0; k < 12; k++) {
    const t = (k / 12) * Math.PI * 2;
    ctx.moveTo(sx + Math.cos(t) * 9.5, sy + Math.sin(t) * 9.5);
    ctx.lineTo(sx + Math.cos(t) * (k % 2 ? 12 : 14), sy + Math.sin(t) * (k % 2 ? 12 : 14));
  }
  ctx.stroke();
  ctx.fillStyle = radial(sx - 2, sy - 2, 0.5, 8, [[0, '#fffef2'], [0.6, '#ffe38a'], [1, '#f2a338']]);
  ctx.beginPath();
  ctx.arc(sx, sy, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(150,84,20,0.55)';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  const moon = angleOf(0);
  const mx = c + Math.cos(moon) * R * 0.6;
  const my = c + Math.sin(moon) * R * 0.6;
  ctx.fillStyle = radial(mx, my, 0, 17, [[0, 'rgba(206,220,255,0.7)'], [0.45, 'rgba(150,176,255,0.25)'], [1, 'rgba(120,150,255,0)']]);
  ctx.fillRect(mx - 17, my - 17, 34, 34);
  ctx.save();
  ctx.beginPath();
  ctx.arc(mx, my, 6.5, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#eef2ff';
  ctx.fillRect(mx - 7, my - 7, 14, 14);
  ctx.fillStyle = 'rgba(10,14,40,0.9)';
  ctx.beginPath();
  ctx.arc(mx + 3.4, my - 2.2, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  for (let h = 0; h < 24; h++) {
    const a = angleOf(h);
    const major = h % 6 === 0;
    const inner = R - (major ? 8 : 4.5);
    ctx.strokeStyle = major ? 'rgba(255,248,226,0.9)' : 'rgba(255,248,226,0.34)';
    ctx.lineWidth = major ? 1.8 : 1;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner);
    ctx.lineTo(c + Math.cos(a) * (R - 1.5), c + Math.sin(a) * (R - 1.5));
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(c, c, R - 1, 0, Math.PI * 2);
  ctx.stroke();
  texture.refresh();
  texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
}

export class TimeWheel extends Phaser.GameObjects.Container {
  private readonly dial: Phaser.GameObjects.Image;
  private readonly halo: Phaser.GameObjects.Image;
  private readonly ring: Phaser.GameObjects.Graphics;
  private readonly dayText: Phaser.GameObjects.Text;
  private readonly timeText: Phaser.GameObjects.Text;
  private readonly phaseText: Phaser.GameObjects.Text;
  private readonly maskShape: Phaser.GameObjects.Graphics;
  private shown = -1;
  private target = 0;

  constructor(scene: Phaser.Scene, x: number) {
    super(scene, x, 0);
    scene.add.existing(this);
    this.setDepth(95);
    ensureGlowTextures(scene);
    paintDial(scene);

    // The masked dial stays out of the container: canvas rendering ignores masks on container children.
    this.halo = scene.add.image(x, WHEEL_Y - 16, GLOW.soft).setScale(1.9, 1.3).setAlpha(0.3)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(94.6);
    const backing = scene.add.graphics().setDepth(94.7);
    backing.fillStyle(MENU_COLOR.pitch, 0.92).fillCircle(x, WHEEL_Y, R + 7);
    this.dial = scene.add.image(x, WHEEL_Y, TEXTURE).setDepth(94.8);
    const glass = scene.add.graphics().setDepth(94.9);
    glass.lineStyle(5, 0xffffff, 0.07).beginPath().arc(x, WHEEL_Y, R - 9, Math.PI * 1.08, Math.PI * 1.48).strokePath();
    glass.lineStyle(2, 0xffffff, 0.1).beginPath().arc(x, WHEEL_Y, R - 3, Math.PI * 1.55, Math.PI * 1.8).strokePath();
    this.maskShape = scene.make.graphics({}, false);
    this.maskShape.fillStyle(0xffffff, 1).fillRect(x - R - 10, 0, R * 2 + 20, WHEEL_Y);
    const mask = this.maskShape.createGeometryMask();
    this.dial.setMask(mask);
    glass.setMask(mask);
    const under: Phaser.GameObjects.GameObject[] = [this.halo, backing, this.dial, glass, this.maskShape];

    const bezel = scene.add.graphics();
    bezel.lineStyle(5, MENU_COLOR.brassDark, 1).beginPath().arc(0, WHEEL_Y, R + 4, Math.PI, Math.PI * 2).strokePath();
    bezel.lineStyle(2, MENU_COLOR.brass, 1).beginPath().arc(0, WHEEL_Y, R + 5, Math.PI, Math.PI * 2).strokePath();
    bezel.lineStyle(1, MENU_COLOR.brassLight, 0.8).beginPath().arc(0, WHEEL_Y, R + 6.5, Math.PI * 1.1, Math.PI * 1.9).strokePath();
    bezel.lineStyle(1.5, MENU_COLOR.ink, 1).beginPath().arc(0, WHEEL_Y, R + 1, Math.PI, Math.PI * 2).strokePath();
    for (let k = 1; k < 6; k++) {
      const a = Math.PI + (k / 6) * Math.PI;
      bezel.fillStyle(MENU_COLOR.brassLight, 1).fillCircle(Math.cos(a) * (R + 4.5), WHEEL_Y + Math.sin(a) * (R + 4.5), 1.2);
    }

    const pointer = scene.add.graphics();
    const tipY = WHEEL_Y - R + 5;
    const topY = WHEEL_Y - R - 10;
    pointer.fillStyle(MENU_COLOR.ink, 1).fillTriangle(-8, topY - 1, 8, topY - 1, 0, tipY + 2);
    pointer.fillStyle(MENU_COLOR.brass, 1).fillTriangle(-6, topY, 6, topY, 0, tipY);
    pointer.fillStyle(MENU_COLOR.brassLight, 1).fillTriangle(-6, topY, 0, topY, 0, tipY);
    pointer.fillStyle(MENU_COLOR.ink, 1).fillCircle(0, topY - 2, 4);
    pointer.fillStyle(0xfff1c4, 1).fillCircle(0, topY - 2, 2.4);

    const plate = scene.add.graphics();
    const top = WHEEL_Y - 1;
    const bottom = WHEEL_Y + PLATE_H;
    plate.fillStyle(MENU_COLOR.pitch, 1).fillPoints([
      new Phaser.Math.Vector2(-PLATE_W - 3, top), new Phaser.Math.Vector2(PLATE_W + 3, top),
      new Phaser.Math.Vector2(PLATE_W - 9, bottom + 3), new Phaser.Math.Vector2(-PLATE_W + 9, bottom + 3),
    ], true);
    plate.fillStyle(MENU_COLOR.woodDeep, 1).fillPoints([
      new Phaser.Math.Vector2(-PLATE_W, top + 2), new Phaser.Math.Vector2(PLATE_W, top + 2),
      new Phaser.Math.Vector2(PLATE_W - 10, bottom), new Phaser.Math.Vector2(-PLATE_W + 10, bottom),
    ], true);
    plate.lineStyle(1, MENU_COLOR.brassDark, 1).strokePoints([
      new Phaser.Math.Vector2(-PLATE_W, top + 2), new Phaser.Math.Vector2(PLATE_W, top + 2),
      new Phaser.Math.Vector2(PLATE_W - 10, bottom), new Phaser.Math.Vector2(-PLATE_W + 10, bottom),
    ], true, true);
    plate.fillStyle(MENU_COLOR.brass, 1).fillRect(-PLATE_W - 3, top, PLATE_W * 2 + 6, 2);
    plate.fillStyle(MENU_COLOR.brassLight, 1).fillRect(-R, top, R * 2, 1);
    for (const side of [-1, 1]) {
      const ex = side * (PLATE_W + 3);
      plate.fillStyle(MENU_COLOR.ink, 1).fillTriangle(ex, top - 4, ex + side * 5, top + 1, ex, top + 6);
      plate.fillStyle(MENU_COLOR.brass, 1).fillTriangle(ex, top - 3, ex + side * 4, top + 1, ex, top + 5);
    }
    plate.fillStyle(MENU_COLOR.brass, 1).fillPoints([
      new Phaser.Math.Vector2(0, top + 15), new Phaser.Math.Vector2(3, top + 18),
      new Phaser.Math.Vector2(0, top + 21), new Phaser.Math.Vector2(-3, top + 18),
    ], true);
    plate.lineStyle(1, MENU_COLOR.brassDark, 0.7).lineBetween(-PLATE_W + 26, top + 30, PLATE_W - 26, top + 30);

    this.dayText = scene.add.text(-9, top + 8, '', {
      fontFamily: MENU_FONT.display,
      fontSize: '17px',
      fontStyle: 'bold',
      color: MENU_HEX.brassLight,
    }).setOrigin(1, 0).setLetterSpacing(1);
    this.timeText = scene.add.text(9, top + 7, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '19px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    }).setOrigin(0, 0);
    this.phaseText = scene.add.text(0, top + 34, '', {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      color: MENU_HEX.boneDim,
    }).setOrigin(0.5, 0).setLetterSpacing(1);

    this.ring = scene.add.graphics().setVisible(false);
    this.add([bezel, pointer, plate, this.dayText, this.timeText, this.phaseText, this.ring]);
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      for (const part of under) part.destroy();
    });
  }

  /** Point the dial at a moment. It turns there smoothly unless `snap` is set or time ran backwards. */
  setTime(day: number, hour: number, snap = false): void {
    this.target = (day - 1) * 24 + hour;
    if (snap || this.shown < 0 || this.target < this.shown) {
      this.shown = this.target;
      this.apply();
    }
  }

  /** A flash round the rim: the day has turned. */
  pulse(): void {
    const scene = this.scene;
    const ring = this.ring;
    ring.clear().setVisible(true).setAlpha(1).setScale(1).setPosition(0, WHEEL_Y);
    ring.lineStyle(3, 0xfff1c4, 1).strokeCircle(0, 0, R + 6);
    ring.lineStyle(8, 0xffd27a, 0.35).strokeCircle(0, 0, R + 8);
    scene.tweens.add({ targets: ring, scale: 1.45, alpha: 0, duration: 820, ease: 'Cubic.Out', onComplete: () => ring.setVisible(false) });
    if (isReducedMotion()) return;
    scene.tweens.add({ targets: this.dial, scale: 1.07, duration: 150, yoyo: true, ease: 'Sine.Out' });
    scene.tweens.add({ targets: this.halo, alpha: 0.85, duration: 180, yoyo: true, hold: 220, ease: 'Sine.Out' });
  }

  update(delta: number): void {
    const gap = this.target - this.shown;
    if (gap <= 1e-4) return;
    const eased = gap * (1 - Math.exp(-delta / FOLLOW_MS));
    this.shown += Math.min(gap, Math.max(eased, (delta / 1000) * 0.5));
    this.apply();
  }

  private apply(): void {
    const total = Math.max(0, this.shown);
    const hour = total % 24;
    const day = Math.floor(total / 24) + 1;
    this.dial.setRotation((hour / 24) * Math.PI * 2);
    this.halo.setTint(skyColor(hour));
    this.halo.setAlpha(0.18 + 0.2 * (1 - darkness(hour)));
    const night = isNight(hour);
    const turn = hoursToTurn(hour);
    const dayLabel = `DAY ${day}`;
    const timeLabel = clockTime(hour);
    const phase = night ? `Dawn in ${spanLabel(turn)}` : `Night in ${spanLabel(turn)}`;
    if (this.dayText.text !== dayLabel) this.dayText.setText(dayLabel);
    if (this.timeText.text !== timeLabel) this.timeText.setText(timeLabel);
    if (this.phaseText.text !== phase) this.phaseText.setText(phase);
    this.timeText.setColor(night ? '#cdd8ff' : MENU_HEX.bone);
    this.phaseText.setColor(night ? '#9fb3f0' : turn <= 2 ? '#f0a050' : '#e2cd8a');
  }
}
