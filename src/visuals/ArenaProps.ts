// Set dressing for handcrafted roadside scenes: a cookfire, a burnt bush, a
// carriage, a beached boat, a cart, a salt lick. Drawn once onto the arena
// floor, beneath every body; purely for show, nothing collides with them.

import Phaser from 'phaser';
import type { SceneProp, ScenePropKind } from '../pve/exploration/sceneFight';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const INK = 0x120d09;
const WOOD = [0x3b2414, 0x5c3a1e, 0x80542b, 0xa8743d] as const;
const STONE = [0x3a3a40, 0x5a5a62, 0x85858c] as const;
/** Below the bodies (5), above the floor and its rings. */
const PROP_DEPTH = 0.5;

type Draw = (g: Phaser.GameObjects.Graphics, x: number, y: number) => void;

const DRAW: Record<ScenePropKind, Draw> = {
  campfire: (g, x, y) => {
    g.fillStyle(INK, 0.35).fillEllipse(x, y + 4, 70, 24);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      g.fillStyle(STONE[i % 2], 1).fillEllipse(x + Math.cos(a) * 26, y + Math.sin(a) * 10, 12, 8);
    }
    g.fillStyle(0x1c120c, 1).fillEllipse(x, y, 40, 14);
    g.lineStyle(6, WOOD[1], 1).lineBetween(x - 16, y + 4, x + 14, y - 4).lineBetween(x - 14, y - 4, x + 16, y + 4);
    g.fillStyle(0xd9471f, 1).fillTriangle(x - 12, y, x + 12, y, x, y - 30);
    g.fillStyle(0xf59b2c, 1).fillTriangle(x - 8, y, x + 8, y, x + 2, y - 22);
    g.fillStyle(0xffe08a, 1).fillTriangle(x - 4, y, x + 4, y, x, y - 12);
    // The spit across the flames.
    g.lineStyle(3, WOOD[0], 1).lineBetween(x - 30, y - 34, x + 30, y - 34);
    g.lineBetween(x - 28, y - 36, x - 28, y + 2).lineBetween(x + 28, y - 36, x + 28, y + 2);
  },
  'burnt-bush': (g, x, y) => {
    g.fillStyle(0x1a1412, 0.7).fillEllipse(x, y + 4, 80, 26);
    g.fillStyle(0x3a2e28, 0.8).fillEllipse(x + 6, y + 2, 50, 16);
    g.lineStyle(5, 0x241a14, 1).lineBetween(x, y + 4, x - 2, y - 26);
    g.lineStyle(3, 0x241a14, 1)
      .lineBetween(x - 1, y - 12, x - 18, y - 30)
      .lineBetween(x - 2, y - 20, x + 14, y - 36)
      .lineBetween(x - 10, y - 21, x - 22, y - 22)
      .lineBetween(x + 6, y - 28, x + 20, y - 26);
    for (const [dx, dy] of [[-18, -30], [14, -36], [20, -26], [-22, -22]]) g.fillStyle(0xd9471f, 0.8).fillCircle(x + dx, y + dy, 1.8);
  },
  carriage: (g, x, y) => {
    g.fillStyle(INK, 0.35).fillEllipse(x, y + 18, 150, 30);
    g.fillStyle(WOOD[1], 1).fillRect(x - 60, y - 44, 120, 50);
    g.fillStyle(WOOD[2], 1).fillRect(x - 56, y - 40, 112, 42);
    g.fillStyle(0x2a1a10, 1).fillRect(x - 40, y - 34, 26, 20).fillRect(x + 14, y - 34, 26, 20);
    g.fillStyle(0x6e1f1f, 1).fillRect(x - 66, y - 52, 132, 10);
    g.lineStyle(2, 0xc8a24a, 1).strokeRect(x - 56, y - 40, 112, 42);
    // One wheel off and lying flat: the raid broke it.
    for (const wx of [x - 42, x + 42]) {
      g.lineStyle(5, WOOD[0], 1).strokeCircle(wx, y + 8, 14);
      g.lineStyle(2, WOOD[3], 1).lineBetween(wx - 12, y + 8, wx + 12, y + 8).lineBetween(wx, y - 4, wx, y + 20);
    }
    g.lineStyle(4, WOOD[0], 1).strokeEllipse(x + 78, y + 20, 30, 10);
    // Spilled crates.
    g.fillStyle(WOOD[2], 1).fillRect(x - 96, y + 4, 20, 16).fillRect(x - 80, y + 14, 18, 14);
    g.lineStyle(1, WOOD[0], 1).strokeRect(x - 96, y + 4, 20, 16).strokeRect(x - 80, y + 14, 18, 14);
  },
  boat: (g, x, y) => {
    g.fillStyle(0x2c5a78, 0.35).fillEllipse(x + 20, y + 10, 160, 40);
    g.fillStyle(WOOD[0], 1).fillPoints([
      new Phaser.Math.Vector2(x - 64, y - 16),
      new Phaser.Math.Vector2(x + 64, y - 16),
      new Phaser.Math.Vector2(x + 48, y + 12),
      new Phaser.Math.Vector2(x - 50, y + 12),
    ], true);
    g.fillStyle(WOOD[2], 1).fillRect(x - 58, y - 16, 116, 6);
    g.lineStyle(1, WOOD[0], 1).lineBetween(x - 54, y - 2, x + 54, y - 2);
    g.lineStyle(4, WOOD[1], 1).lineBetween(x, y - 16, x - 4, y - 70);
    g.lineStyle(3, WOOD[3], 1).lineBetween(x + 20, y - 14, x + 70, y - 34);
  },
  cart: (g, x, y) => {
    g.fillStyle(INK, 0.35).fillEllipse(x, y + 16, 110, 24);
    g.fillStyle(WOOD[1], 1).fillRect(x - 44, y - 24, 88, 30);
    g.fillStyle(0xcdb98a, 1).fillEllipse(x - 12, y - 28, 40, 18).fillEllipse(x + 16, y - 26, 32, 14);
    g.lineStyle(4, WOOD[0], 1).strokeCircle(x - 30, y + 8, 12).strokeCircle(x + 30, y + 8, 12);
    g.lineStyle(3, WOOD[2], 1).lineBetween(x - 44, y - 6, x - 76, y + 6);
  },
  'salt-lick': (g, x, y) => {
    g.fillStyle(0xd8d4c6, 0.5).fillEllipse(x, y + 4, 90, 30);
    g.fillStyle(0xeae6da, 1).fillEllipse(x, y - 4, 50, 24);
    g.fillStyle(0xfdfbf4, 1).fillEllipse(x - 6, y - 10, 24, 10);
    // Old bones round it.
    g.lineStyle(3, 0xcfc3a4, 1).lineBetween(x - 44, y + 12, x - 26, y + 16).lineBetween(x + 30, y + 14, x + 48, y + 8);
    g.fillStyle(0xcfc3a4, 1).fillCircle(x + 38, y - 12, 6);
    g.fillStyle(INK, 1).fillCircle(x + 36, y - 13, 1.5).fillCircle(x + 40, y - 13, 1.5);
  },
};

/** Paint a scene's props onto the arena floor; the objects, to be destroyed with the fight. */
export function drawSceneProps(scene: Phaser.Scene, field: Rect, props: readonly SceneProp[], reducedMotion: boolean): Phaser.GameObjects.GameObject[] {
  const out: Phaser.GameObjects.GameObject[] = [];
  if (props.length === 0) return out;
  const g = scene.add.graphics().setDepth(PROP_DEPTH);
  out.push(g);
  for (const prop of props) {
    const x = field.x + field.w * prop.x;
    const y = field.y + field.h * prop.y;
    DRAW[prop.kind](g, x, y);
    if (prop.kind !== 'campfire') continue;
    const glow = scene.add.ellipse(x, y - 6, 150, 70, 0xf59b2c, 0.16).setDepth(PROP_DEPTH).setBlendMode(Phaser.BlendModes.ADD);
    out.push(glow);
    if (!reducedMotion) scene.tweens.add({ targets: glow, alpha: 0.55, scale: 1.08, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
  }
  return out;
}
