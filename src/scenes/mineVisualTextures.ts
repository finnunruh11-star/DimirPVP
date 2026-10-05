import Phaser from 'phaser';
import { MINE_TRAP_DAMAGE, type MineRoomKind, type MineTrapDamage } from '../pve/mineMaze';

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

export function mineTrapTextureKey(kind: MineTrapDamage): string {
  return `mine-trap-art-${kind}`;
}

export function mineTrapIconTextureKey(kind: MineTrapDamage): string {
  return `mine-trap-icon-${kind}`;
}

export function buildMineRoomTextures(scene: Phaser.Scene): void {
  const kinds: MineRoomVisualKind[] = ['hidden', 'empty', 'enemies', 'treasure', 'ore', 'shop'];
  for (const kind of kinds) {
    buildRoomArt(scene, kind);
    buildRoomIcon(scene, kind);
  }
  for (const kind of MINE_TRAP_DAMAGE) {
    buildTrapArt(scene, kind);
    buildTrapIcon(scene, kind);
  }
}

/** A stretch of timbered tunnel with its trap caught in the act. */
function buildTrapArt(scene: Phaser.Scene, kind: MineTrapDamage): void {
  const key = mineTrapTextureKey(kind);
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const rect = (color: number, x: number, y: number, width: number, height: number, alpha = 1): void => {
    g.fillStyle(color, alpha).fillRect(x, y, width, height);
  };
  const rock = (x: number, y: number, r: number, color = 0x6d6458): void => {
    g.fillStyle(0x1b1712, 1).fillCircle(x + 1, y + 1, r);
    g.fillStyle(color, 1).fillCircle(x, y, r);
    g.fillStyle(0x91877a, 1).fillCircle(x - r * 0.35, y - r * 0.35, Math.max(1, r * 0.4));
  };

  rect(0x05080a, 0, 0, 112, 64);
  rect(0x12191a, 5, 5, 102, 47);
  g.fillStyle(0x27302f, 1).fillTriangle(0, 0, 25, 0, 8, 33);
  g.fillStyle(0x202827, 1).fillTriangle(112, 0, 85, 0, 105, 36);
  g.fillStyle(0x303735, 1).fillTriangle(48, 0, 57, 0, 53, 9);
  rect(0x2c302d, 0, 48, 112, 16);
  rect(0x41403a, 0, 48, 112, 3);
  rect(0x181c1d, 8, 56, 20, 2);
  rect(0x181c1d, 78, 58, 25, 2);
  // Timber set: two posts and a cap, except where the roof came down.
  if (kind !== '1d20') {
    rect(0x382516, 10, 11, 5, 39);
    rect(0x82512a, 12, 11, 2, 39);
    rect(0x382516, 96, 10, 5, 40);
    rect(0x82512a, 97, 10, 2, 40);
    rect(0x3b2717, 9, 10, 93, 5);
    rect(0x956136, 11, 11, 89, 2);
  }

  if (kind === '1d3') {
    // Holes in the left post spit darts across a tripwire.
    for (const y of [24, 31, 38]) rect(0x07090a, 15, y, 3, 3);
    g.lineStyle(1, 0xd8cfae, 0.9).lineBetween(16, 52, 95, 50);
    [[30, 25], [48, 32], [64, 39]].forEach(([x, y]) => {
      rect(0x767d7f, x - 12, y + 1, 10, 1, 0.45);
      rect(0x9c3326, x, y, 3, 3);
      rect(0xd9d2bd, x + 3, y + 1, 9, 1);
      rect(0xeef3f4, x + 12, y + 1, 2, 1);
    });
    rect(0xd9d2bd, 89, 27, 7, 1);
    rect(0x9c3326, 86, 26, 3, 3);
  } else if (kind === '2d4') {
    // A pressure plate gives, and spikes stab up out of the floor.
    rect(0x3c3a36, 30, 49, 52, 4);
    rect(0x5a5650, 31, 49, 50, 1);
    for (let i = 0; i < 7; i++) {
      const x = 32 + i * 7;
      const tip = 26 + (i % 2) * 7 + (i === 3 ? -4 : 0);
      g.fillStyle(0x8d9597, 1).fillTriangle(x, 50, x + 5, 50, x + 2.5, tip);
      g.lineStyle(1, 0xd5dcde, 1).lineBetween(x + 2, 49, x + 2.5, tip + 2);
    }
    rect(0x8a2018, 53, 24, 2, 3);
    rect(0xd9d0b8, 86, 55, 10, 2);
    g.fillStyle(0xd9d0b8, 1).fillCircle(84, 54, 3);
    rect(0x2b2a26, 83, 53, 1, 1);
  } else if (kind === '3d3') {
    // A blade on an iron arm swings down across the passage.
    g.fillStyle(0x4a4c4d, 1).fillCircle(56, 15, 3);
    g.lineStyle(2, 0x6a6d6e, 1).lineBetween(56, 15, 73, 37);
    g.lineStyle(1, 0x9aa3a5, 0.35);
    g.beginPath();
    g.arc(56, 15, 30, 0.35, 2.75);
    g.strokePath();
    g.lineStyle(1, 0x9aa3a5, 0.2);
    g.beginPath();
    g.arc(56, 15, 26, 0.5, 2.6);
    g.strokePath();
    g.fillStyle(0xc4ccce, 1).fillCircle(76, 41, 10);
    g.fillStyle(0x12191a, 1).fillCircle(72, 37, 9);
    g.fillStyle(0xeef3f4, 1).fillRect(81, 44, 3, 2);
  } else if (kind === '2d6') {
    // Cracks open in the roof and stone comes down.
    g.lineStyle(1, 0x070909, 1).lineBetween(40, 15, 46, 22);
    g.lineBetween(46, 22, 44, 27);
    g.lineBetween(62, 15, 58, 21);
    rock(45, 25, 4);
    rock(58, 33, 5);
    rock(50, 41, 3);
    rock(68, 22, 3);
    g.fillStyle(0x8c8172, 0.3).fillCircle(44, 48, 9);
    g.fillStyle(0x8c8172, 0.25).fillCircle(62, 47, 11);
    rock(40, 52, 5, 0x5b5246);
    rock(52, 54, 6, 0x5b5246);
    rock(66, 53, 4, 0x5b5246);
  } else {
    // The roof gives way: a snapped cap, boulders and dust filling the passage.
    rect(0x382516, 10, 13, 5, 37);
    rect(0x82512a, 12, 13, 2, 37);
    g.lineStyle(4, 0x3b2717, 1).lineBetween(10, 12, 46, 28);
    g.lineStyle(2, 0x956136, 1).lineBetween(11, 11, 46, 27);
    g.lineStyle(4, 0x3b2717, 1).lineBetween(101, 12, 70, 34);
    g.lineStyle(2, 0x956136, 1).lineBetween(100, 11, 70, 33);
    g.fillStyle(0x8c8172, 0.28).fillCircle(56, 30, 22);
    rock(40, 44, 8, 0x4f483f);
    rock(60, 40, 10, 0x5b5246);
    rock(78, 47, 7, 0x4f483f);
    rock(52, 54, 6, 0x5b5246);
    rock(70, 22, 4);
    rock(48, 16, 3);
    g.fillStyle(0x8c8172, 0.2).fillCircle(30, 50, 12);
    g.fillStyle(0x8c8172, 0.2).fillCircle(86, 52, 10);
  }

  g.generateTexture(key, 112, 64);
  g.destroy();
}

function buildTrapIcon(scene: Phaser.Scene, kind: MineTrapDamage): void {
  const key = mineTrapIconTextureKey(kind);
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const rect = (color: number, x: number, y: number, width: number, height: number): void => {
    g.fillStyle(color, 1).fillRect(x, y, width, height);
  };
  if (kind === '1d3') {
    g.lineStyle(2, 0xd9d2bd, 1).lineBetween(3, 12, 12, 3);
    rect(0xeef3f4, 12, 2, 2, 2);
    rect(0xc0432f, 2, 11, 3, 3);
  } else if (kind === '2d4') {
    for (const x of [2, 6, 10]) g.fillStyle(0xb5bdbf, 1).fillTriangle(x, 14, x + 4, 14, x + 2, 3);
    rect(0x5a5650, 1, 14, 14, 2);
  } else if (kind === '3d3') {
    g.lineStyle(1, 0x8d9597, 1).lineBetween(3, 1, 8, 8);
    g.lineStyle(3, 0xd0d7d9, 1);
    g.beginPath();
    g.arc(8, 8, 5, 0.1, 2.9);
    g.strokePath();
  } else if (kind === '2d6') {
    g.fillStyle(0x8a8070, 1).fillCircle(5, 5, 3);
    g.fillStyle(0x8a8070, 1).fillCircle(11, 8, 3);
    g.fillStyle(0x6d6458, 1).fillCircle(7, 12, 3);
  } else {
    g.lineStyle(2, 0x956136, 1).lineBetween(1, 3, 7, 8);
    g.lineBetween(15, 3, 9, 9);
    g.fillStyle(0x6d6458, 1).fillCircle(8, 12, 4);
    g.fillStyle(0x8a8070, 1).fillCircle(3, 13, 2);
    g.fillStyle(0x8a8070, 1).fillCircle(13, 13, 2);
  }
  g.generateTexture(key, 16, 16);
  g.destroy();
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