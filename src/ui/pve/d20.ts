// The bone d20 the search and the mines roll: a hexagon of facets round a
// triangular face, shaded from `color`.

import Phaser from 'phaser';
import { mixColor } from '../../visuals/daylight';
import { MENU_COLOR } from '../cabinet/theme';

export function drawD20(g: Phaser.GameObjects.Graphics, color: number, r = 50): void {
  const hex = Array.from({ length: 6 }, (_, k) => {
    const a = -Math.PI / 2 + (k * Math.PI) / 3;
    return new Phaser.Math.Vector2(Math.cos(a) * r, Math.sin(a) * r);
  });
  const tri = [new Phaser.Math.Vector2(0, -r * 0.5), new Phaser.Math.Vector2(-r * 0.47, r * 0.33), new Phaser.Math.Vector2(r * 0.47, r * 0.33)];
  const drop = r / 12;
  g.clear();
  g.fillStyle(MENU_COLOR.pitch, 0.9).fillPoints(hex.map((p) => new Phaser.Math.Vector2(p.x + drop, p.y + drop * 1.25)), true);
  g.fillStyle(mixColor(color, 0x000000, 0.28), 1).fillPoints(hex, true);
  g.fillStyle(color, 1).fillPoints(tri, true);
  // Side facets: each triangle corner to its two nearest rim corners.
  const facet = (a: Phaser.Math.Vector2, b: Phaser.Math.Vector2, c: Phaser.Math.Vector2, shade: number): void => {
    g.fillStyle(mixColor(color, 0x000000, shade), 1).fillPoints([a, b, c], true);
  };
  facet(tri[0], hex[0], hex[1], 0.12);
  facet(tri[0], hex[5], hex[0], 0.06);
  facet(tri[1], hex[3], hex[4], 0.22);
  facet(tri[1], hex[4], hex[5], 0.16);
  facet(tri[2], hex[1], hex[2], 0.18);
  facet(tri[2], hex[2], hex[3], 0.24);
  facet(tri[0], tri[1], hex[5], 0.1);
  facet(tri[0], tri[2], hex[1], 0.14);
  facet(tri[1], tri[2], hex[3], 0.2);
  g.lineStyle(Math.max(1, r / 25), MENU_COLOR.ink, 0.9).strokePoints(hex, true);
  g.lineStyle(1, MENU_COLOR.ink, 0.55);
  g.strokePoints(tri, true);
  for (const [a, b] of [[0, 0], [0, 1], [0, 5], [1, 3], [1, 4], [1, 5], [2, 1], [2, 2], [2, 3]] as const) {
    g.lineBetween(tri[a].x, tri[a].y, hex[b].x, hex[b].y);
  }
  g.lineStyle(1, 0xffffff, 0.35).lineBetween(tri[0].x + r * 0.06, tri[0].y + r * 0.12, tri[1].x + r * 0.12, tri[1].y - r * 0.04);
}
