// Nerogril: the last well before the deep desert, a walled caravan stop on
// the edge of the dunes. The guild, an apothecary and the outfitter who sells
// the stillsuits nobody crosses the White Desert without.

import type { BuildingPlacement, LocaleDef, PropPlacement } from '../../../world/locale';
import { MapBuilder } from '../../../world/mapBuilder';
import { PROPS } from '../../../world/props';

const W = 36;
const H = 26;

function terrain(): string[] {
  const b = new MapBuilder(W, H);
  // Dunes and stones beyond the wall.
  b.scatter(0, 0, W, 1, 'rxN', 0.25, 71);
  b.scatter(0, H - 1, W, 1, 'rxN', 0.25, 72);
  b.scatter(0, 1, 1, H - 2, 'rxN', 0.25, 73);

  // The wall, the east gate and the road out.
  b.ring(1, 1, 34, 24, 'W');
  b.fill(34, 11, 2, 3, '#');

  // The caravan street, the well square and the lane behind the market.
  b.fill(2, 11, 32, 3, '#');
  b.fill(14, 5, 8, 6, '#');
  b.fill(2, 20, 32, 2, '=');
  b.fill(17, 14, 2, 6, '=');

  // Hardpan yards, stones and the odd crate.
  b.fill(24, 15, 9, 4, ',');
  b.scatter(2, 2, 32, 3, 'r"', 0.08, 74);
  b.scatter(2, 14, 32, 6, 'r"', 0.05, 75);
  b.scatter(2, 22, 32, 2, 'rN"', 0.12, 76);
  b.set(13, 10, 'u').set(22, 10, 'k').set(33, 19, 'u').set(32, 19, 'k').set(10, 22, 'n');

  // Nothing lies under a roof or a prop, nor where a keeper stands.
  for (const { x, y, spec } of buildings) b.clearDecor(x, y, spec.w, spec.h + 1);
  for (const p of props) b.clearDecor(p.x, p.y, PROPS[p.kind].w, PROPS[p.kind].h, b.get(p.x, p.y) === ',' ? ',' : '.');
  return b.build();
}

const buildings: BuildingPlacement[] = [
  { x: 3, y: 5, shop: 'nerogril-guild', spec: { w: 7, h: 6, roof: 'rust', wall: 'sandstone', door: 3, windows: [1, 5], banner: 0xc9a64a } },
  { x: 23, y: 6, shop: 'nerogril-outfitter', spec: { w: 6, h: 5, roof: 'thatch', wall: 'sandstone', door: 2, windows: [4], sign: 'drop', awning: 0xb89a6a } },
  { x: 30, y: 6, spec: { w: 4, h: 5, roof: 'thatch', wall: 'plaster', door: 1, windows: [3] } },
  { x: 4, y: 15, shop: 'nerogril-apothecary', spec: { w: 5, h: 5, roof: 'teal', wall: 'sandstone', door: 1, windows: [3], sign: 'potion', awning: 0x3f8a86 } },
  { x: 10, y: 15, spec: { w: 5, h: 5, roof: 'rust', wall: 'plaster', door: 2, windows: [4] } },
];

const props: PropPlacement[] = [
  { kind: 'well', x: 17, y: 7 },
  { kind: 'palm', x: 14, y: 5 },
  { kind: 'palm', x: 21, y: 5 },
  { kind: 'palm', x: 11, y: 3 },
  { kind: 'palm', x: 29, y: 3 },
  { kind: 'tent', x: 20, y: 16, color: 0xc9a46a },
  { kind: 'tent', x: 24, y: 15, color: 0xa86a48 },
  { kind: 'tent', x: 28, y: 15, color: 0xd8c8a0 },
  { kind: 'cart', x: 30, y: 17 },
  { kind: 'brazier', x: 13, y: 12 },
  { kind: 'brazier', x: 22, y: 12 },
  { kind: 'notice', x: 10, y: 9 },
  { kind: 'boulder', x: 2, y: 22 },
];

export const NEROGRIL: LocaleDef = {
  id: 'nerogril',
  name: 'Nerogril',
  ground: 'sand',
  altGround: 'dirt',
  wallStone: 0xc8a878,
  terrain: terrain(),
  buildings,
  props,
  exits: [{ x: 35, y: 11, w: 1, h: 3, label: 'Leave Nerogril' }],
  spawn: { x: 33, y: 12 },
};
