// Which world tiles the party has walked, packed six to a character so a save
// stays small. Unexplored ground is slower and more dangerous to cross, and
// fast travel needs every tile of its route known.

import type { Cell } from '../../world/pathfind';
import { WORLD_H, WORLD_W } from './world';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const CELLS = WORLD_W * WORLD_H;
export const EXPLORED_LENGTH = Math.ceil(CELLS / 6);

export function unpackExplored(text: string): Uint8Array {
  const mask = new Uint8Array(CELLS);
  for (let c = 0; c < text.length && c < EXPLORED_LENGTH; c++) {
    const value = ALPHABET.indexOf(text[c]);
    if (value <= 0) continue;
    for (let bit = 0; bit < 6; bit++) {
      const i = c * 6 + bit;
      if (i < CELLS && (value >> bit) & 1) mask[i] = 1;
    }
  }
  return mask;
}

export function packExplored(mask: Uint8Array): string {
  let text = '';
  for (let c = 0; c < EXPLORED_LENGTH; c++) {
    let value = 0;
    for (let bit = 0; bit < 6; bit++) {
      const i = c * 6 + bit;
      if (i < CELLS && mask[i]) value |= 1 << bit;
    }
    text += ALPHABET[value];
  }
  return text;
}

export function isPackedExplored(text: unknown): text is string {
  return typeof text === 'string' && text.length <= EXPLORED_LENGTH && [...text].every((ch) => ALPHABET.includes(ch));
}

/** Re-pack tiles walked on an older, narrower map, moved `dx` tiles east onto today's. */
export function widenExplored(text: string, oldW: number, oldH: number, dx: number): string {
  const mask = new Uint8Array(CELLS);
  for (let c = 0; c < text.length; c++) {
    const value = ALPHABET.indexOf(text[c]);
    if (value <= 0) continue;
    for (let bit = 0; bit < 6; bit++) {
      const i = c * 6 + bit;
      if (i >= oldW * oldH || !((value >> bit) & 1)) continue;
      const x = (i % oldW) + dx;
      const y = Math.floor(i / oldW);
      if (x >= 0 && x < WORLD_W && y < WORLD_H) mask[y * WORLD_W + x] = 1;
    }
  }
  return packExplored(mask);
}

/** Mark everything within `radius` tiles of each cell. Returns how many tiles were new. */
export function revealTiles(mask: Uint8Array, cells: readonly Cell[], radius: number): number {
  let fresh = 0;
  for (const cell of cells) {
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const x = cell.x + dx;
      const y = cell.y + dy;
      if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H || dx * dx + dy * dy > radius * radius + radius) continue;
      const i = y * WORLD_W + x;
      if (!mask[i]) {
        mask[i] = 1;
        fresh += 1;
      }
    }
  }
  return fresh;
}

export function isExplored(mask: Uint8Array, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H && mask[y * WORLD_W + x] === 1;
}
