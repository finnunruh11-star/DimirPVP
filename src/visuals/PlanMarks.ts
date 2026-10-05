// Online, on the travel map: one line for each place someone wants to go, in
// the colour of whoever planned it, its stops marked, and at its end a head for
// every player going that way with the pace they chose beneath it.

import Phaser from 'phaser';
import type { Cell } from '../world/pathfind';

export const SEAT_COLORS = [0xffd070, 0x6ad1ff, 0xff7aa8] as const;

const INK = 0x120d09;
const HEAD_R = 10;
const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

export interface PlanHead {
  seat: number;
  name: string;
  /** The pace chosen, or what they are looking at. */
  pace: string;
}

export interface PlanLine {
  /** Whose colour the line takes: the first to plan it. */
  seat: number;
  cells: readonly Cell[];
  /** Indices into `cells` where a stop falls. */
  stops: readonly number[];
  mine: boolean;
  heads: PlanHead[];
}

type Point = { x: number; y: number };

export class PlanMarks {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private drawn = '';

  constructor(private readonly scene: Phaser.Scene, depth: number) {
    this.graphics = scene.add.graphics().setDepth(depth);
  }

  draw(lines: readonly PlanLine[], center: (cell: Cell) => Point): void {
    // The same plans are not drawn again: nothing flickers while others only look around.
    const key = JSON.stringify(lines.map((line) => [line.seat, line.mine, line.cells.length, line.cells[line.cells.length - 1], line.stops, line.heads]));
    if (key === this.drawn) return;
    this.drawn = key;
    const g = this.graphics.clear();
    for (const label of this.labels) label.destroy();
    this.labels = [];
    for (const line of lines) {
      if (!line.cells.length) continue;
      const color = SEAT_COLORS[line.seat % SEAT_COLORS.length];
      const points = line.cells.map(center);
      g.lineStyle(line.mine ? 6 : 5, INK, 0.55).strokePoints(points, false);
      g.lineStyle(line.mine ? 3 : 2, color, 0.95).strokePoints(points, false);
      const stops = new Set(line.stops);
      points.forEach((p, index) => {
        if (index === points.length - 1) return;
        if (stops.has(index)) {
          diamond(g, p, 9, INK, 0.9);
          diamond(g, p, 6, color, 1);
          diamond(g, p, 2.5, 0xfff1c4, 1);
        } else if (index % 2 === 0) {
          g.fillStyle(INK, 0.8).fillCircle(p.x, p.y, 3.5);
          g.fillStyle(color, 1).fillCircle(p.x, p.y, 2);
        }
      });
      const end = points[points.length - 1];
      g.lineStyle(4, INK, 0.8).strokeCircle(end.x, end.y, 14);
      g.lineStyle(2, color, 1).strokeCircle(end.x, end.y, 14);
      const spread = (HEAD_R * 2 + 6);
      line.heads.forEach((head, slot) => {
        const x = end.x + (slot - (line.heads.length - 1) / 2) * spread;
        const y = end.y - 34;
        const tone = SEAT_COLORS[head.seat % SEAT_COLORS.length];
        g.fillStyle(INK, 0.9).fillCircle(x, y, HEAD_R + 2);
        g.fillStyle(tone, 1).fillCircle(x, y, HEAD_R);
        this.labels.push(this.scene.add.text(x, y, (head.name.trim()[0] ?? '?').toUpperCase(), {
          fontFamily: 'Georgia, serif',
          fontSize: '12px',
          fontStyle: 'bold',
          color: '#120d09',
        }).setOrigin(0.5).setDepth(this.graphics.depth + 3));
        this.labels.push(this.scene.add.text(x, y - HEAD_R - 3, head.pace, {
          fontFamily: 'Georgia, serif',
          fontSize: '11px',
          color: hex(tone),
          stroke: '#120d09',
          strokeThickness: 3,
        }).setOrigin(0.5, 1).setDepth(this.graphics.depth + 3));
      });
    }
  }

  destroy(): void {
    this.graphics.destroy();
    for (const label of this.labels) label.destroy();
    this.labels = [];
  }
}

function diamond(g: Phaser.GameObjects.Graphics, at: Point, r: number, color: number, alpha: number): void {
  g.fillStyle(color, alpha).fillPoints([
    new Phaser.Geom.Point(at.x, at.y - r),
    new Phaser.Geom.Point(at.x + r, at.y),
    new Phaser.Geom.Point(at.x, at.y + r),
    new Phaser.Geom.Point(at.x - r, at.y),
  ], true);
}
