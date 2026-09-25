// Hearthfire: a forge town under the mountain, walled in by lava on the east.
// It keeps the basics — guild and apothecary — and the finest smithies in the
// land around a square of furnaces and anvils.

import type { BuildingPlacement, LocaleDef, PropPlacement } from '../../../world/locale';
import { MapBuilder } from '../../../world/mapBuilder';

const W = 48;
const H = 34;

function terrain(): string[] {
  const b = new MapBuilder(W, H);
  // The mountain's foot, the western scree and the southern rim.
  b.fill(0, 0, 41, 4, ',');
  b.scatter(0, 2, 41, 2, 'Qqr', 0.55, 21, ',');
  b.scatter(0, 0, 41, 2, 'r', 0.25, 22, ',');
  b.scatter(0, 4, 2, 28, 'Qqr', 0.85, 23);
  b.scatter(0, 32, 22, 2, 'rqQ', 0.85, 24);
  b.scatter(26, 32, 15, 2, 'rqQ', 0.85, 25);

  // Lava on the east, and the burnt country beyond it.
  b.fill(43, 0, 5, H, ',');
  b.scatter(43, 0, 5, H, 'r', 0.3, 26, ',');
  b.fill(41, 0, 2, H, 'L');
  b.fill(35, 12, 6, 6, ',');
  b.fill(36, 13, 4, 4, 'L');

  // Streets.
  b.fill(3, 10, 38, 2, '#');
  b.fill(14, 12, 16, 6, '#');
  b.fill(2, 18, 39, 2, '#');
  b.fill(22, 20, 4, 14, '#');
  b.fill(2, 26, 39, 2, '=');

  // Scorched patches, yards and clutter.
  b.fill(17, 21, 5, 4, ',');
  b.fill(27, 28, 12, 3, ',');
  b.fill(4, 28, 12, 3, ',');
  b.paste(3, 12, ['r ', '  ', ' r', '  ']);
  b.paste(13, 20, ['r']);
  b.set(9, 20, 'u').set(10, 20, 'k').set(27, 20, 'k').set(33, 20, 'u');
  b.paste(17, 21, ['z  u', '    ', 'l  k', ' z  ']);
  b.paste(4, 28, ['kku  l ', '  z   k', 'u   ll ']);
  b.paste(27, 28, ['l  kk  u', 'z      k', ' ll   uu']);
  b.set(2, 21, 'r').set(9, 22, 'r').set(40, 22, 'r').set(26, 21, 'r');
  // Keep the ground under the boulders clear.
  for (const [x, y] of BOULDERS) b.fill(x, y, 2, 2, ',');
  return b.build();
}

const BOULDERS: [number, number][] = [[1, 0], [8, 0], [19, 0], [34, 0], [44, 6], [44, 20]];

const buildings: BuildingPlacement[] = [
  { x: 24, y: 4, shop: 'hearthfire-forge', spec: { w: 9, h: 6, roof: 'rust', wall: 'brick', door: 4, windows: [1, 2, 6, 7], chimney: 7, sign: 'anvil', awning: 0x7a2f2f } },
  { x: 14, y: 5, shop: 'hearthfire-weaponsmith', spec: { w: 6, h: 5, roof: 'charcoal', wall: 'brick', door: 2, windows: [4], chimney: 1, sign: 'sword', awning: 0x8a3b2b } },
  { x: 34, y: 5, shop: 'hearthfire-armory', spec: { w: 7, h: 5, roof: 'slate', wall: 'stone', door: 3, windows: [1, 5], sign: 'shield', chimney: 5 } },
  { x: 5, y: 13, shop: 'hearthfire-guild', spec: { w: 8, h: 5, roof: 'red', wall: 'sandstone', door: 3, windows: [1, 5, 6], dormers: [1, 5], banner: 0xb0602e } },
  { x: 30, y: 13, shop: 'hearthfire-apothecary', spec: { w: 5, h: 5, roof: 'teal', wall: 'plaster', door: 1, windows: [3], sign: 'potion', awning: 0x3f8a86 } },
  { x: 4, y: 21, spec: { w: 5, h: 5, roof: 'rust', wall: 'darkwood', door: 1, windows: [3] } },
  { x: 11, y: 21, spec: { w: 6, h: 5, roof: 'charcoal', wall: 'stone', door: 2, windows: [4], chimney: 4 } },
  { x: 28, y: 21, spec: { w: 5, h: 5, roof: 'red', wall: 'brick', door: 3, windows: [1], chimney: 1 } },
  { x: 34, y: 21, spec: { w: 6, h: 5, roof: 'thatch', wall: 'wood', door: 2, windows: [4] } },
];

const props: PropPlacement[] = [
  { kind: 'furnace', x: 15, y: 12 },
  { kind: 'furnace', x: 19, y: 12 },
  { kind: 'anvil', x: 17, y: 15 },
  { kind: 'anvil', x: 20, y: 15 },
  { kind: 'anvil', x: 27, y: 15 },
  { kind: 'rack', x: 26, y: 12 },
  { kind: 'crate', x: 23, y: 12 },
  { kind: 'barrel', x: 28, y: 12 },
  { kind: 'brazier', x: 14, y: 16 },
  { kind: 'brazier', x: 29, y: 16 },
  { kind: 'brazier', x: 13, y: 8 },
  { kind: 'brazier', x: 33, y: 8 },
  { kind: 'brazier', x: 3, y: 16 },
  { kind: 'brazier', x: 40, y: 16 },
  { kind: 'notice', x: 20, y: 8 },
  { kind: 'cart', x: 19, y: 29 },
  ...BOULDERS.map(([x, y]): PropPlacement => ({ kind: 'boulder', x, y })),
];

export const HEARTHFIRE: LocaleDef = {
  id: 'hearthfire',
  name: 'Hearthfire',
  ground: 'dirt',
  altGround: 'ember',
  wallStone: 0x6b6570,
  terrain: terrain(),
  buildings,
  props,
  exits: [{ x: 22, y: 33, w: 4, h: 1, label: 'Leave Hearthfire' }],
  spawn: { x: 23, y: 31 },
};
