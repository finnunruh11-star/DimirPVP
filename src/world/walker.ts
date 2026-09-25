// The player on foot: keyboard steering, click-to-walk along an A* path, and
// sliding collision against the locale's blocked cells.

import Phaser from 'phaser';
import { TILE_PX, TILE_SCALE } from './kenney';
import { findPath, type Cell } from './pathfind';
import { MAGE_FIRST_FRAME, MAGE_IDLE, MAGE_RUN } from './mageSprite';

/** Tiles per second. */
export const WALK_SPEED = 4.4;
/** Half the width and the depth of the feet box, in world pixels. */
const FOOT_HALF_W = 13;
const FOOT_H = 10;

/** Whether a feet box at x, y (world pixels) fits between blocked cells. */
export function feetFit(x: number, y: number, w: number, h: number, blocked: (x: number, y: number) => boolean): boolean {
  const left = Math.floor((x - FOOT_HALF_W) / TILE_PX);
  const right = Math.floor((x + FOOT_HALF_W) / TILE_PX);
  const top = Math.floor((y - FOOT_H) / TILE_PX);
  const bottom = Math.floor((y - 1) / TILE_PX);
  if (left < 0 || top < 0 || right >= w || bottom >= h) return false;
  for (let cy = top; cy <= bottom; cy++) for (let cx = left; cx <= right; cx++) {
    if (blocked(cx, cy)) return false;
  }
  return true;
}

export class Walker {
  readonly sprite: Phaser.GameObjects.Sprite;
  /** Feet position in world pixels. */
  x: number;
  y: number;
  /** Share of the usual pace (sneaking walks slower). */
  speedMul = 1;
  private path: Cell[] | null = null;
  private moving = false;
  private arrive?: () => void;

  constructor(
    scene: Phaser.Scene,
    cell: Cell,
    private readonly w: number,
    private readonly h: number,
    private readonly blocked: (x: number, y: number) => boolean,
  ) {
    this.x = (cell.x + 0.5) * TILE_PX;
    this.y = (cell.y + 0.8) * TILE_PX;
    this.sprite = scene.add.sprite(this.x, this.y, MAGE_FIRST_FRAME).setOrigin(0.5, 0.95).setScale(TILE_SCALE);
    this.sprite.play(MAGE_IDLE);
    this.sync();
  }

  get cell(): Cell {
    return { x: Math.floor(this.x / TILE_PX), y: Math.floor((this.y - 1) / TILE_PX) };
  }

  get isMoving(): boolean {
    return this.moving;
  }

  /** Walk to a cell; `onArrive` runs once the path is finished. */
  walkTo(target: Cell, onArrive?: () => void): boolean {
    const path = findPath(this.w, this.h, this.blocked, this.cell, target);
    if (!path) return false;
    this.path = path;
    this.arrive = onArrive;
    if (path.length === 0) this.finishPath();
    return true;
  }

  stop(): void {
    this.path = null;
    this.arrive = undefined;
  }

  /** Put the feet down somewhere else at once (a shadow step). */
  placeAt(x: number, y: number): void {
    this.stop();
    this.x = x;
    this.y = y;
    this.sync();
  }

  update(deltaMs: number, steer: { x: number; y: number }): void {
    const dt = Math.min(0.05, deltaMs / 1000);
    let vx = steer.x;
    let vy = steer.y;
    if (vx !== 0 || vy !== 0) {
      this.stop();
    } else if (this.path && this.path.length) {
      const next = this.path[0];
      const tx = (next.x + 0.5) * TILE_PX;
      const ty = (next.y + 0.8) * TILE_PX;
      const dx = tx - this.x;
      const dy = ty - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 4) {
        this.path.shift();
        if (!this.path.length) this.finishPath();
      } else {
        vx = dx / dist;
        vy = dy / dist;
      }
    }
    const len = Math.hypot(vx, vy);
    this.moving = len > 0;
    if (this.moving) {
      const step = (WALK_SPEED * this.speedMul * TILE_PX * dt) / len;
      this.tryMove(vx * step, 0);
      this.tryMove(0, vy * step);
      if (vx !== 0) this.sprite.setFlipX(vx < 0);
    }
    const anim = this.moving ? MAGE_RUN : MAGE_IDLE;
    if (this.sprite.anims.currentAnim?.key !== anim) this.sprite.play(anim);
    this.sync();
  }

  private finishPath(): void {
    this.path = null;
    const done = this.arrive;
    this.arrive = undefined;
    done?.();
  }

  private tryMove(dx: number, dy: number): void {
    const nx = this.x + dx;
    const ny = this.y + dy;
    if (this.fits(nx, ny)) {
      this.x = nx;
      this.y = ny;
    }
  }

  private fits(x: number, y: number): boolean {
    return feetFit(x, y, this.w, this.h, this.blocked);
  }

  private sync(): void {
    this.sprite.setPosition(Math.round(this.x), Math.round(this.y));
    this.sprite.setDepth(this.y);
  }
}
