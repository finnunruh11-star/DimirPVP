import Phaser from 'phaser';
import type { MineRoomKind } from '../pve/mineMaze';

export type MineRoomVisualKind = MineRoomKind | 'hidden';

export const MINE_ROOM_VISUAL_LABEL: Record<MineRoomVisualKind, string> = {
  hidden: 'Unexplored room',
  empty: 'Quiet chamber',
  enemies: 'Creature den',
  treasure: 'Treasure vault',
  ore: 'Ore deposit',
  shop: 'Supply room',
};

export function mineRoomTextureKey(kind: MineRoomVisualKind): string {
  return `mine-room-art-${kind}`;
}

export function mineRoomIconTextureKey(kind: MineRoomVisualKind): string {
  return `mine-room-icon-${kind}`;
}

export function buildMineRoomTextures(scene: Phaser.Scene): void {
  const kinds: MineRoomVisualKind[] = ['hidden', 'empty', 'enemies', 'treasure', 'ore', 'shop'];
  for (const kind of kinds) {
    buildRoomArt(scene, kind);
    buildRoomIcon(scene, kind);
  }
}

function buildRoomArt(scene: Phaser.Scene, kind: MineRoomVisualKind): void {
  const key = mineRoomTextureKey(kind);
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const rect = (color: number, x: number, y: number, width: number, height: number): void => {
    g.fillStyle(color, 1).fillRect(x, y, width, height);
  };

  rect(0x05080a, 0, 0, 112, 64);
  rect(0x12191a, 5, 5, 102, 47);
  g.fillStyle(0x27302f, 1).fillTriangle(0, 0, 25, 0, 8, 33);
  g.fillStyle(0x202827, 1).fillTriangle(112, 0, 85, 0, 105, 36);
  g.fillStyle(0x303735, 1).fillTriangle(15, 0, 23, 0, 19, 11);
  g.fillStyle(0x303735, 1).fillTriangle(48, 0, 57, 0, 53, 14);
  g.fillStyle(0x303735, 1).fillTriangle(79, 0, 88, 0, 84, 10);
  rect(0x2c302d, 0, 48, 112, 16);
  rect(0x41403a, 0, 48, 112, 3);
  rect(0x181c1d, 8, 56, 20, 2);
  rect(0x181c1d, 78, 58, 25, 2);
  rect(0x382516, 10, 11, 5, 39);
  rect(0x82512a, 12, 11, 2, 39);
  rect(0x382516, 96, 10, 5, 40);
  rect(0x82512a, 97, 10, 2, 40);
  rect(0x3b2717, 9, 10, 93, 5);
  rect(0x956136, 11, 11, 89, 2);

  if (kind === 'hidden') {
    g.fillStyle(0x050607, 1).fillCircle(56, 39, 24);
    rect(0x050607, 32, 36, 48, 15);
    g.lineStyle(3, 0x59605b, 1).strokeCircle(56, 39, 24);
    rect(0x342216, 39, 25, 34, 26);
    rect(0x704622, 42, 27, 4, 22);
    rect(0x704622, 51, 26, 4, 23);
    rect(0x704622, 60, 26, 4, 23);
    rect(0x1b110c, 72, 25, 3, 26);
    g.fillStyle(0xd7b665, 1).fillCircle(67, 38, 2);
  } else if (kind === 'empty') {
    g.fillStyle(0x090d0e, 1).fillCircle(57, 34, 22);
    rect(0x090d0e, 35, 33, 44, 17);
    g.fillStyle(0x54707a, 0.75).fillEllipse(73, 54, 27, 5);
    rect(0x18191a, 28, 52, 3, 12);
    rect(0x18191a, 49, 50, 3, 14);
    g.lineStyle(2, 0x75664e, 1).lineBetween(28, 55, 89, 59);
    g.lineStyle(2, 0x75664e, 1).lineBetween(29, 61, 89, 63);
  } else if (kind === 'enemies') {
    g.fillStyle(0x080b0c, 1).fillCircle(56, 37, 22);
    rect(0x080b0c, 34, 35, 44, 16);
    g.fillStyle(0x1b2525, 1).fillCircle(42, 42, 10);
    g.fillStyle(0x26302f, 1).fillCircle(68, 40, 12);
    rect(0x161d1e, 35, 42, 15, 11);
    rect(0x1c2424, 59, 40, 19, 13);
    rect(0xf16755, 39, 38, 3, 2);
    rect(0xf16755, 45, 38, 3, 2);
    rect(0xf16755, 64, 35, 3, 2);
    rect(0xf16755, 71, 35, 3, 2);
    g.lineStyle(2, 0xb3a37a, 1).lineBetween(80, 27, 72, 51);
    g.lineStyle(2, 0x8f9695, 1).lineBetween(77, 29, 84, 26);
  } else if (kind === 'treasure') {
    g.fillStyle(0x090d0e, 1).fillCircle(57, 35, 22);
    rect(0x090d0e, 35, 34, 44, 17);
    rect(0x382213, 38, 36, 38, 17);
    rect(0x8a5324, 40, 34, 34, 17);
    rect(0xbf8133, 40, 37, 34, 4);
    rect(0xe1b955, 53, 35, 7, 18);
    rect(0x5c3b1e, 36, 43, 42, 3);
    rect(0xffdf6a, 30, 53, 6, 3);
    rect(0xd89432, 82, 55, 5, 3);
    rect(0xffdf6a, 89, 51, 4, 3);
  } else if (kind === 'ore') {
    g.fillStyle(0x090d0e, 1).fillCircle(56, 35, 22);
    rect(0x090d0e, 34, 34, 45, 17);
    g.fillStyle(0x6f7777, 1).fillTriangle(31, 52, 41, 30, 48, 52);
    g.fillStyle(0xb56b43, 1).fillTriangle(43, 52, 52, 25, 60, 52);
    g.fillStyle(0xaeb6b4, 1).fillTriangle(55, 52, 65, 28, 73, 52);
    g.fillStyle(0xd4ad45, 1).fillTriangle(67, 52, 77, 35, 84, 52);
    rect(0xe8d4a1, 50, 30, 3, 9);
    rect(0xf0d875, 73, 39, 3, 7);
    g.lineStyle(3, 0x9a6939, 1).lineBetween(83, 24, 70, 50);
    g.lineStyle(3, 0xaeb8b9, 1).lineBetween(75, 25, 91, 31);
  } else {
    rect(0x182224, 25, 19, 62, 34);
    rect(0x704623, 28, 24, 56, 29);
    rect(0x2d1b11, 27, 39, 58, 5);
    rect(0x996437, 27, 45, 58, 8);
    rect(0x263033, 33, 28, 12, 9);
    rect(0xb7c7bd, 35, 30, 8, 5);
    rect(0x263033, 49, 27, 12, 10);
    g.fillStyle(0xd98943, 1).fillCircle(55, 32, 4);
    rect(0x293235, 65, 27, 13, 10);
    rect(0x73b9c5, 68, 29, 7, 5);
    g.fillStyle(0xf0c761, 1).fillCircle(88, 24, 5);
    rect(0x6e4826, 86, 28, 4, 12);
  }

  g.generateTexture(key, 112, 64);
  g.destroy();
}

function buildRoomIcon(scene: Phaser.Scene, kind: MineRoomVisualKind): void {
  const key = mineRoomIconTextureKey(kind);
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const rect = (color: number, x: number, y: number, width: number, height: number): void => {
    g.fillStyle(color, 1).fillRect(x, y, width, height);
  };

  if (kind === 'hidden') {
    rect(0x3a2518, 3, 4, 10, 11);
    rect(0x9a6638, 5, 5, 2, 9);
    rect(0x9a6638, 9, 5, 2, 9);
    rect(0xe2bd68, 11, 9, 1, 2);
  } else if (kind === 'empty') {
    g.lineStyle(2, 0xaeb8bd, 1).strokeCircle(8, 9, 6);
    rect(0x111719, 3, 8, 10, 7);
    rect(0x76868a, 6, 12, 4, 1);
  } else if (kind === 'enemies') {
    g.lineStyle(2, 0xe16b60, 1).lineBetween(3, 3, 13, 14);
    g.lineBetween(13, 3, 3, 14);
    rect(0xe9b56b, 2, 2, 4, 2);
    rect(0xe9b56b, 10, 2, 4, 2);
  } else if (kind === 'treasure') {
    rect(0x70411f, 2, 6, 12, 8);
    rect(0xd99a39, 3, 5, 10, 3);
    rect(0xffdc67, 7, 5, 3, 9);
    rect(0x2e1b12, 2, 9, 12, 2);
  } else if (kind === 'ore') {
    g.fillStyle(0xb46d46, 1).fillTriangle(2, 14, 6, 3, 9, 14);
    g.fillStyle(0xaeb8bd, 1).fillTriangle(7, 14, 11, 1, 14, 14);
    rect(0xf2d584, 10, 5, 2, 5);
  } else {
    rect(0x6d4727, 2, 5, 12, 9);
    rect(0xd6a35d, 1, 4, 14, 3);
    rect(0x75c1cc, 4, 8, 3, 3);
    rect(0xe0c56b, 9, 8, 3, 3);
    rect(0x392419, 7, 7, 2, 7);
  }

  g.generateTexture(key, 16, 16);
  g.destroy();
}