// Emblems for what the party can spot off the way, shared by the sighting card
// and the beacon over the map: a leaf, claw marks, a chest and a compass star.

import Phaser from 'phaser';
import type { SightingKind } from '../../pve/exploration/journey';

export const SIGHTING_COLORS: Record<SightingKind, number> = {
  herbs: 0x8fd16a,
  pack: 0xe25b4c,
  cache: 0xe6bd5c,
  event: 0xb58be0,
};

const SHADOW = 0x120d09;

/** Draw the emblem centred on the graphics' origin, about `size` px across. */
export function drawSightingGlyph(g: Phaser.GameObjects.Graphics, kind: SightingKind, size: number): void {
  const s = size / 40;
  const color = SIGHTING_COLORS[kind];
  const pt = (x: number, y: number): Phaser.Math.Vector2 => new Phaser.Math.Vector2(x * s, y * s);
  const shape = (points: [number, number][], dx: number, dy: number): Phaser.Math.Vector2[] =>
    points.map(([x, y]) => pt(x + dx, y + dy));
  switch (kind) {
    case 'herbs': {
      const tilt = -0.72;
      const turn = (x: number, y: number): [number, number] =>
        [x * Math.cos(tilt) - y * Math.sin(tilt), x * Math.sin(tilt) + y * Math.cos(tilt)];
      const leaf: [number, number][] = [];
      for (let i = 0; i <= 12; i++) leaf.push(turn(-17 + (i / 12) * 34, -Math.sin((Math.PI * i) / 12) * 8.5 * (1 - 0.3 * (i / 12))));
      for (let i = 12; i >= 0; i--) leaf.push(turn(-17 + (i / 12) * 34, Math.sin((Math.PI * i) / 12) * 8.5 * (1 - 0.3 * (i / 12))));
      g.fillStyle(SHADOW, 0.85).fillPoints(shape(leaf, 1.6, 2.2), true);
      g.fillStyle(color, 1).fillPoints(shape(leaf, 0, 0), true);
      g.fillStyle(0xd6f5b4, 0.45).fillPoints(shape(leaf.slice(0, 13).concat([turn(17, 0), turn(-17, 0)]), 0, 0), true);
      const [bx, by] = turn(-17, 0);
      const [tx, ty] = turn(15, 0);
      g.lineStyle(Math.max(1, 1.8 * s), 0x2d5a1c, 1).lineBetween(bx * s, by * s, tx * s, ty * s);
      for (const t of [-8, -1, 6]) {
        const [vx, vy] = turn(t, 0);
        const [ex, ey] = turn(t + 5, -5.5);
        const [fx, fy] = turn(t + 5, 5.5);
        g.lineStyle(Math.max(1, 1.1 * s), 0x2d5a1c, 0.8).lineBetween(vx * s, vy * s, ex * s, ey * s).lineBetween(vx * s, vy * s, fx * s, fy * s);
      }
      g.lineStyle(Math.max(1, 2.2 * s), 0x2d5a1c, 1).lineBetween(bx * s, by * s, (bx - 5) * s, (by + 6) * s);
      return;
    }
    case 'pack': {
      for (const k of [-1, 0, 1]) {
        const ox = k * 9.5;
        const claw: [number, number][] = [[ox + 8, -17], [ox + 11.5, -15], [ox - 6, 16], [ox - 9.5, 14.5]];
        g.fillStyle(SHADOW, 0.85).fillPoints(shape(claw, 1.6, 2.2), true);
        g.fillStyle(color, 1).fillPoints(shape(claw, 0, 0), true);
        g.lineStyle(Math.max(1, 1.1 * s), 0xffc2b4, 0.7).lineBetween((ox + 9) * s, -15 * s, (ox - 5) * s, 12 * s);
      }
      return;
    }
    case 'cache': {
      g.fillStyle(SHADOW, 0.9).fillRect(-16 * s, -11 * s, 33 * s, 27 * s);
      g.fillStyle(0x7a4c1c, 1).fillRect(-14 * s, -1 * s, 28 * s, 14 * s);
      g.fillStyle(0xa2692a, 1).fillRoundedRect(-14 * s, -10 * s, 28 * s, 10 * s, { tl: 5 * s, tr: 5 * s, bl: 0, br: 0 });
      g.fillStyle(color, 1).fillRect(-14 * s, -2 * s, 28 * s, 3 * s);
      g.fillRect(-10 * s, -10 * s, 3 * s, 23 * s).fillRect(7 * s, -10 * s, 3 * s, 23 * s);
      g.fillStyle(0xfff0b0, 1).fillRect(-3 * s, -3 * s, 6 * s, 7 * s);
      g.fillStyle(SHADOW, 1).fillRect(-1 * s, -0.5 * s, 2 * s, 2.5 * s);
      return;
    }
    case 'event': {
      const star: [number, number][] = [];
      for (let i = 0; i < 8; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 4;
        const r = i % 2 ? 5.5 : 17;
        star.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      g.fillStyle(SHADOW, 0.85).fillPoints(shape(star, 1.6, 2.2), true);
      g.fillStyle(color, 1).fillPoints(shape(star, 0, 0), true);
      g.fillStyle(0xf0e2ff, 0.55).fillPoints(shape([star[0], star[1], [0, 0], star[7]], 0, 0), true);
      g.fillStyle(0xfff6ff, 1).fillCircle(0, 0, 3 * s);
      return;
    }
  }
}
