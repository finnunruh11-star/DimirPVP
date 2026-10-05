// What the travel map shows while the party is on the move: the way ahead with
// its stops marked, prints and dust left behind, torchlight after dark, a
// thought bubble on a quiet stretch, a campfire at a rest, an alarm when
// trouble finds them, and a beacon over anything spotted off the way.
// Presentation only.

import Phaser from 'phaser';
import { playSound } from '../audio';
import { spawnTint, type EncounterSpawn } from '../pve/exploration/encounters';
import type { SightingKind } from '../pve/exploration/journey';
import type { Terrain } from '../pve/exploration/world';
import { ENEMY_DEFS } from '../pve/swamprun';
import { isReducedMotion } from '../ui/cabinet/motion';
import { MENU_COLOR, MENU_FONT, MENU_HEX } from '../ui/cabinet/theme';
import { drawSightingGlyph, SIGHTING_COLORS } from '../ui/pve/sightingGlyphs';
import { CREATURE_FRAME_RATIO, creatureFacesRight, creatureSpriteFor, creatureTexture } from '../world/creatureSprite';
import { MAGE_FIRST_FRAME, MAGE_IDLE } from '../world/mageSprite';
import { OW_CELL, OW_SCALE } from '../world/overworldRender';
import type { Cell } from '../world/pathfind';
import { ensureGlowTextures, GLOW } from './glowTextures';
import { ParticleFx } from './ParticleFx';

type Point = { x: number; y: number };

/** The party token stands at depth 22. */
const DEPTH = { prints: 20.4, route: 21, torch: 21.5, dust: 21.8, marker: 21.9, figure: 22.2, fire: 22.4, float: 24 };
const FIGURE_SCALE = OW_SCALE + 0.3;
const MAX_PRINTS = 48;
const INK = 0x120d09;
/** Where a thought floats from the token's feet, the dots trailing back to its head, and how long it stays. */
const THOUGHT = { x: 14, y: -70, dots: [[4, -36, 2.2], [8, -45, 3.2]] as const, hold: 1900 };

const DUST: Partial<Record<Terrain, number>> = {
  road: 0xcdb88c, bridge: 0xb9a07a, plains: 0xc9c79a, sand: 0xead6a4, dunes: 0xead6a4, flats: 0xd8c39a,
  hills: 0xb8a07c, forest: 0x9aa878, swamp: 0x8fa6a2, ford: 0xa8c4d0,
};

const vec = (x: number, y: number): Phaser.Math.Vector2 => new Phaser.Math.Vector2(x, y);

function diamond(g: Phaser.GameObjects.Graphics, at: Point, r: number, color: number, alpha: number): void {
  g.fillStyle(color, alpha).fillPoints([vec(at.x, at.y - r), vec(at.x + r, at.y), vec(at.x, at.y + r), vec(at.x - r, at.y)], true);
}

/** A flame's teardrop standing on the origin, `w` wide at the base and `h` tall. */
function flameShape(g: Phaser.GameObjects.Graphics, w: number, h: number, color: number): void {
  const points = [vec(0, -h)];
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI / 6 + (i / 10) * ((Math.PI * 4) / 3);
    points.push(vec(Math.cos(a) * w, -w + Math.sin(a) * w));
  }
  g.fillStyle(color, 1).fillPoints(points, true);
}

/** A cloud `w` by `h` round the origin: a pill with bumps along its top and bottom, inked round the edge. */
function thoughtCloud(g: Phaser.GameObjects.Graphics, w: number, h: number): void {
  const puffs: [number, number, number][] = [];
  const n = Math.max(2, Math.round(w / 24));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / n;
    puffs.push([x, -h * 0.3, h * 0.42], [x + (i % 2 ? -3 : 3), h * 0.32, h * 0.36]);
  }
  for (const [edge, color] of [[1.6, INK], [0, MENU_COLOR.bone]] as const) {
    g.fillStyle(color, 1);
    for (const [x, y, r] of puffs) g.fillCircle(x, y, r + edge);
    g.fillRoundedRect(-w / 2 - edge, -h / 2 - edge, w + edge * 2, h + edge * 2, h / 2 + edge);
  }
}

export interface Beacon {
  destroy(): void;
}

export class TravelFx {
  private readonly route: Phaser.GameObjects.Graphics;
  private readonly torch: Phaser.GameObjects.Image;
  private readonly torchCore: Phaser.GameObjects.Image;
  private readonly particles: ParticleFx;
  private readonly prints: Phaser.GameObjects.Image[] = [];
  private readonly reduced = isReducedMotion();
  private stride = 1;
  private thought: Phaser.GameObjects.Container | null = null;

  constructor(private readonly scene: Phaser.Scene, private readonly token: Phaser.GameObjects.Sprite) {
    ensureGlowTextures(scene);
    this.route = scene.add.graphics().setDepth(DEPTH.route);
    this.torch = scene.add.image(token.x, token.y, GLOW.soft)
      .setTint(0xff9f45).setBlendMode(Phaser.BlendModes.ADD).setScale(2.9).setAlpha(0).setDepth(DEPTH.torch);
    this.torchCore = scene.add.image(token.x, token.y, GLOW.soft)
      .setTint(0xffd590).setBlendMode(Phaser.BlendModes.ADD).setScale(0.95).setAlpha(0).setDepth(DEPTH.torch);
    this.particles = new ParticleFx(scene, () => this.reduced);
  }

  destroy(): void {
    this.route.destroy();
    this.torch.destroy();
    this.torchCore.destroy();
    this.scene.tweens.killTweensOf(this.prints);
    for (const print of this.prints) print.destroy();
    this.prints.length = 0;
    this.dropThought();
    this.particles.destroy();
  }

  /** The way ahead: a dotted trail, a diamond at every coming stop and a ring round the end. */
  drawRoute(cells: readonly Cell[], stops: readonly number[], center: (cell: Cell) => Point, known: (cell: Cell) => boolean): void {
    const g = this.route.clear();
    if (cells.length === 0) return;
    const marks = new Set(stops);
    cells.forEach((cell, index) => {
      if (index === cells.length - 1 || marks.has(index)) return;
      const at = center(cell);
      g.fillStyle(INK, 0.8).fillCircle(at.x, at.y, 5);
      g.fillStyle(known(cell) ? 0xf3e2b0 : 0xe08a3c, 1).fillCircle(at.x, at.y, 3);
    });
    for (const index of stops) {
      const cell = cells[index];
      if (!cell || index === cells.length - 1) continue;
      const at = center(cell);
      diamond(g, at, 10, INK, 0.9);
      diamond(g, at, 7.5, 0xa98b50, 1);
      diamond(g, at, 5, 0xd2bd7f, 1);
      diamond(g, at, 2, 0xfff1c4, 1);
    }
    const end = center(cells[cells.length - 1]);
    g.lineStyle(4, INK, 0.8).strokeCircle(end.x, end.y, 13);
    g.lineStyle(2, 0xffe08a, 1).strokeCircle(end.x, end.y, 13);
  }

  clearRoute(): void {
    this.route.clear();
  }

  /** A footprint where the party stepped off and a little dust kicked up. */
  step(from: Point, to: Point, terrain: Terrain): void {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    this.stride = -this.stride;
    const feet = {
      x: from.x - Math.sin(angle) * 3 * this.stride,
      y: from.y + 7 + Math.cos(angle) * 3 * this.stride,
    };
    if (terrain !== 'bridge' && terrain !== 'ford') {
      const print = this.scene.add.image(feet.x, feet.y, GLOW.print)
        .setTint(0x24180e).setAlpha(0.5).setRotation(angle).setScale(1.3).setDepth(DEPTH.prints);
      this.prints.push(print);
      if (this.prints.length > MAX_PRINTS) {
        const oldest = this.prints.shift();
        if (oldest) {
          this.scene.tweens.killTweensOf(oldest);
          oldest.destroy();
        }
      }
      this.scene.tweens.add({
        targets: print,
        alpha: 0,
        delay: 900,
        duration: 5200,
        ease: 'Sine.In',
        onComplete: () => {
          const index = this.prints.indexOf(print);
          if (index >= 0) this.prints.splice(index, 1);
          print.destroy();
        },
      });
    }
    this.particles.burst(feet, {
      color: DUST[terrain] ?? 0xc8b890,
      count: 4,
      speed: 26,
      lifespan: 560,
      size: 8,
      alpha: 0.5,
      angle: { min: 190, max: 350 },
      gravityY: -14,
      drag: 0.7,
      spread: 3,
      depth: DEPTH.dust,
    });
  }

  /** Keep the torch and any thought on the party, the torch lit as far as the dark calls for. */
  update(time: number, dark: number): void {
    this.thought?.setPosition(this.token.x, this.token.y);
    const lit = dark > 0.02;
    this.torch.setVisible(lit);
    this.torchCore.setVisible(lit);
    if (!lit) return;
    const flicker = this.reduced ? 1 : 0.9 + 0.06 * Math.sin(time * 0.013) + 0.04 * Math.sin(time * 0.031 + 1.7);
    const x = this.token.x;
    const y = this.token.y - 4;
    this.torch.setPosition(x, y).setAlpha(dark * 0.34 * flicker);
    this.torchCore.setPosition(x, y).setAlpha(dark * 0.3 * flicker);
  }

  /** A quiet stretch: a thought bubble over the party, which walks on beneath it. */
  think(text: string): void {
    this.dropThought();
    const scene = this.scene;
    const side = this.token.flipX ? -1 : 1;
    const dots = scene.add.graphics();
    for (const [edge, color] of [[1.6, INK], [0, MENU_COLOR.bone]] as const) {
      for (const [x, y, r] of THOUGHT.dots) dots.fillStyle(color, 1).fillCircle(side * x, y, r + edge);
    }
    const label = scene.add.text(0, 0, text, {
      fontFamily: MENU_FONT.body,
      fontSize: '13px',
      fontStyle: 'italic',
      color: MENU_HEX.ink,
    }).setOrigin(0.5);
    const cloud = scene.add.graphics();
    thoughtCloud(cloud, Math.max(40, Math.ceil(label.width) + 20), Math.ceil(label.height) + 12);
    const puff = scene.add.container(side * THOUGHT.x, THOUGHT.y, [cloud, label]);
    const bubble = scene.add.container(this.token.x, this.token.y, [dots, puff]).setDepth(DEPTH.float).setAlpha(0);
    this.thought = bubble;
    scene.tweens.add({ targets: bubble, alpha: 1, duration: 180, ease: 'Sine.Out' });
    if (!this.reduced) {
      puff.setScale(0.4);
      scene.tweens.add({ targets: puff, scale: 1, duration: 280, ease: 'Back.Out' });
      scene.tweens.add({ targets: puff, y: THOUGHT.y - 6, delay: THOUGHT.hold, duration: 320, ease: 'Sine.In' });
    }
    scene.tweens.add({
      targets: bubble,
      alpha: 0,
      delay: THOUGHT.hold,
      duration: 320,
      ease: 'Sine.In',
      onComplete: () => {
        if (this.thought === bubble) this.dropThought();
      },
    });
  }

  private dropThought(): void {
    const bubble = this.thought;
    if (!bubble) return;
    this.thought = null;
    this.scene.tweens.killTweensOf([bubble, ...bubble.list]);
    bubble.destroy();
  }

  /** A short rest: a small fire is lit beside the party, crackles a moment and is put out. */
  async rest(): Promise<void> {
    const scene = this.scene;
    playSound('travel.rest');
    const side = this.token.flipX ? -1 : 1;
    const base = { x: this.token.x + side * 17, y: this.token.y + 7 };
    const fire = scene.add.container(base.x, base.y).setDepth(DEPTH.fire).setScale(0);
    const glow = scene.add.image(0, -6, GLOW.soft).setTint(0xff9a40).setBlendMode(Phaser.BlendModes.ADD).setScale(0.95).setAlpha(0);
    const logs = scene.add.graphics();
    logs.fillStyle(0x24140a, 1).fillPoints([vec(-10, 0), vec(8, -3), vec(10, 1), vec(-8, 4)], true);
    logs.fillStyle(0x5e3c22, 1).fillPoints([vec(-9, -3), vec(10, 2), vec(8, 5), vec(-10, 0)], true);
    logs.fillStyle(0x7a5030, 1).fillRect(-7, -2, 3, 2);
    const flame = scene.add.graphics();
    flameShape(flame, 6.5, 18, 0xd9432a);
    flameShape(flame, 4.6, 13, 0xf5962a);
    flameShape(flame, 2.6, 8, 0xffe27a);
    fire.add([glow, logs, flame]);
    scene.tweens.add({ targets: fire, scale: 1, duration: 260, ease: 'Back.Out' });
    scene.tweens.add({ targets: glow, alpha: 0.75, duration: 300 });
    if (!this.reduced) {
      scene.tweens.add({ targets: flame, scaleY: 1.18, scaleX: 0.88, duration: 150, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      scene.tweens.add({ targets: glow, scale: 1.1, duration: 110, yoyo: true, repeat: -1, delay: 300, ease: 'Sine.InOut' });
    }
    const embers = scene.time.addEvent({
      delay: 140,
      repeat: 8,
      callback: () => this.particles.burst({ x: base.x, y: base.y - 10 }, {
        color: 0xffb04a, count: 1 + Math.round(Math.random()), speed: 36, lifespan: 820, glow: true, size: 5,
        angle: { min: 250, max: 290 }, gravityY: -34, spread: 3, depth: DEPTH.fire + 0.05,
      }),
    });
    this.caption('Short rest', '#f6d9a0');
    await this.wait(1300);
    embers.remove(false);
    this.particles.burst({ x: base.x, y: base.y - 12 }, {
      shape: 'smoke', color: 0x9a9088, count: 3, speed: 16, lifespan: 900, size: 18, alpha: 0.4,
      angle: { min: 250, max: 290 }, gravityY: -20, depth: DEPTH.fire + 0.05,
    });
    scene.tweens.killTweensOf([flame, glow]);
    scene.tweens.add({ targets: fire, alpha: 0, scale: 0.6, duration: 260, ease: 'Sine.In', onComplete: () => fire.destroy() });
    await this.wait(220);
  }

  /** Trouble: a warning mark over the party, a red flash, and the foe stepping into view. */
  async alarm(foe?: EncounterSpawn): Promise<void> {
    playSound('travel.ambush');
    const cam = this.scene.cameras.main;
    if (!this.reduced) cam.shake(240, 0.005);
    cam.flash(200, 120, 24, 16);
    this.bubble('!', '#ff6a52');
    const ring = this.scene.add.graphics({ x: this.token.x, y: this.token.y + 7 }).setDepth(DEPTH.marker);
    ring.lineStyle(3, 0xff5a40, 1).strokeEllipse(0, 0, 26, 13);
    this.scene.tweens.add({ targets: ring, scale: 5, alpha: 0, duration: 600, ease: 'Cubic.Out', onComplete: () => ring.destroy() });
    if (foe) {
      const side = this.token.flipX ? -1 : 1;
      const figure = this.figure(foe, { x: this.token.x + side * OW_CELL * 1.4, y: this.token.y });
      const full = figure.scale;
      figure.setScale(full * 0.2).setAlpha(0);
      this.scene.tweens.add({ targets: figure, scale: full, alpha: 1, duration: 260, ease: 'Back.Out' });
      this.particles.burst({ x: figure.x, y: figure.y + 4 }, {
        shape: 'smoke', color: 0x6a6258, count: 5, speed: 40, lifespan: 600, size: 16, alpha: 0.45, drag: 0.6, depth: DEPTH.figure - 0.05,
      });
    }
    await this.wait(950);
  }

  /** Something to decide on the spot: a symbol pops over the party. */
  async cue(symbol: string, color: string): Promise<void> {
    playSound('travel.notice');
    this.bubble(symbol, color);
    await this.wait(420);
  }

  /** A find: sparks and motes thrown up round the party. */
  sparkle(): void {
    const at = { x: this.token.x, y: this.token.y - 6 };
    this.particles.burst(at, {
      shape: 'spark', color: 0xffe08a, count: 12, speed: 150, lifespan: 650, glow: true, alignToTravel: true, drag: 0.85, size: 12, depth: DEPTH.float,
    });
    this.particles.burst(at, { color: 0xfff1c4, count: 10, speed: 60, lifespan: 900, glow: true, size: 8, gravityY: -40, spread: 10, depth: DEPTH.float });
  }

  /** A line of text rising off the party and fading. */
  caption(text: string, color = '#f3e2b0'): void {
    const label = this.scene.add.text(this.token.x, this.token.y - 30, text, {
      fontFamily: MENU_FONT.control,
      fontSize: '14px',
      fontStyle: 'bold',
      color,
      stroke: '#120d09',
      strokeThickness: 4,
    }).setOrigin(0.5, 1).setDepth(DEPTH.float).setAlpha(0);
    this.scene.tweens.chain({
      targets: label,
      tweens: [
        { alpha: 1, y: label.y - 10, duration: 240, ease: 'Cubic.Out' },
        { alpha: 0, y: label.y - 18, duration: 320, delay: 950, ease: 'Sine.In' },
      ],
      onComplete: () => label.destroy(),
    });
  }

  /** A beacon over something spotted: a trail out to it, pulsing rings, a shaft of light and its emblem. */
  mark(kind: SightingKind, at: Point, foe?: EncounterSpawn): Beacon {
    const scene = this.scene;
    const color = SIGHTING_COLORS[kind];
    const parts: Phaser.GameObjects.GameObject[] = [];
    const from = { x: this.token.x, y: this.token.y };
    const trail = scene.add.graphics().setDepth(DEPTH.marker);
    const length = Math.hypot(at.x - from.x, at.y - from.y);
    const ux = (at.x - from.x) / (length || 1);
    const uy = (at.y - from.y) / (length || 1);
    for (let d = 16; d < length - 16; d += 13) {
      const end = Math.min(d + 7, length - 16);
      trail.lineStyle(5, INK, 0.6).lineBetween(from.x + ux * d, from.y + uy * d, from.x + ux * end, from.y + uy * end);
      trail.lineStyle(2, color, 0.95).lineBetween(from.x + ux * d, from.y + uy * d, from.x + ux * end, from.y + uy * end);
    }
    trail.setAlpha(0);
    scene.tweens.add({ targets: trail, alpha: 1, duration: 360 });
    parts.push(trail);
    for (const delay of [0, 750]) {
      const ring = scene.add.graphics({ x: at.x, y: at.y + 8 }).setDepth(DEPTH.marker);
      ring.lineStyle(2, color, 1).strokeEllipse(0, 0, 36, 17);
      ring.setScale(0.4).setAlpha(0);
      scene.tweens.add({ targets: ring, scale: 1.6, alpha: { from: 1, to: 0 }, duration: 1500, delay, repeat: -1, ease: 'Sine.Out' });
      parts.push(ring);
    }
    const beam = scene.add.image(at.x, at.y + 8, GLOW.beam).setOrigin(0.5, 1).setTint(color)
      .setBlendMode(Phaser.BlendModes.ADD).setScale(1.3, 0).setAlpha(0.55).setDepth(DEPTH.marker);
    scene.tweens.add({ targets: beam, scaleY: 0.9, duration: 420, ease: 'Cubic.Out' });
    if (!this.reduced) scene.tweens.add({ targets: beam, alpha: 0.3, duration: 900, yoyo: true, repeat: -1, delay: 420, ease: 'Sine.InOut' });
    parts.push(beam);
    let top = at.y - 30;
    if (foe) {
      const figure = this.figure(foe, at);
      parts.push(figure);
      top = at.y - figure.displayHeight * 0.8 - 12;
    }
    const badge = scene.add.container(at.x, top).setDepth(DEPTH.float).setScale(0);
    const disc = scene.add.graphics();
    disc.fillStyle(INK, 0.95).fillCircle(0, 0, 14);
    disc.lineStyle(2, color, 1).strokeCircle(0, 0, 13);
    const glyph = scene.add.graphics();
    drawSightingGlyph(glyph, kind, 18);
    badge.add([disc, glyph]);
    scene.tweens.add({ targets: badge, scale: 1, duration: 340, ease: 'Back.Out' });
    if (!this.reduced) scene.tweens.add({ targets: badge, y: top - 4, duration: 760, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    parts.push(badge);
    return {
      destroy: () => {
        for (const part of parts) {
          scene.tweens.killTweensOf(part);
          part.destroy();
        }
      },
    };
  }

  /** A creature standing on the map in its own art, or as the tinted figure it wears in a fight. */
  private figure(foe: EncounterSpawn, at: Point): Phaser.GameObjects.Sprite {
    const kind = foe.family === 'swamp' ? foe.kind : null;
    const creature = creatureSpriteFor(kind);
    const sprite = this.scene.add.sprite(at.x, at.y + 6, creature ? creatureTexture(creature) : MAGE_FIRST_FRAME)
      .setOrigin(0.5, creature ? 0.9 : 0.95).setDepth(DEPTH.figure);
    sprite.play(creature ? `enemy-${creature}-idle` : MAGE_IDLE);
    if (creature && kind) {
      const mage = this.scene.textures.getFrame(MAGE_FIRST_FRAME).height * FIGURE_SCALE;
      sprite.setScale((mage * CREATURE_FRAME_RATIO * (ENEMY_DEFS[kind].scale ?? 1)) / (sprite.height || 1));
    } else {
      sprite.setScale(FIGURE_SCALE).setTint(spawnTint([foe]));
    }
    const facesRight = !creature || creatureFacesRight(creature);
    const partyLeft = this.token.x < sprite.x;
    sprite.setFlipX(facesRight ? partyLeft : !partyLeft);
    return sprite;
  }

  private bubble(symbol: string, color: string): void {
    const mark = this.scene.add.text(this.token.x, this.token.y - 32, symbol, {
      fontFamily: MENU_FONT.display,
      fontSize: '32px',
      fontStyle: 'bold',
      color,
      stroke: '#1a0806',
      strokeThickness: 6,
    }).setOrigin(0.5, 1).setDepth(DEPTH.float).setScale(0);
    this.scene.tweens.chain({
      targets: mark,
      tweens: [
        { scale: 1.3, duration: 150, ease: 'Back.Out' },
        { scale: 1, duration: 120, ease: 'Sine.Out' },
        { alpha: 0, y: mark.y - 12, duration: 280, delay: 700, ease: 'Sine.In' },
      ],
      onComplete: () => mark.destroy(),
    });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.scene.time.delayedCall(ms, () => resolve()));
  }
}
