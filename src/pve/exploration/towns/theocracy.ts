// The Theocracy: the holy city of the White Desert, white walls around a sun
// temple, a sacred pool and a pilgrims' market. The guild, an apothecary, an
// outfitter, an armoury of the faithful and a reliquary of rare gear.

import type { BuildingPlacement, LocaleDef, PropPlacement } from '../../../world/locale';
import { MapBuilder } from '../../../world/mapBuilder';
import { PROPS } from '../../../world/props';

const W = 56;
const H = 40;

function terrain(): string[] {
  const b = new MapBuilder(W, H);
  // Dunes beyond the walls.
  b.scatter(0, 0, W, 1, 'rxN', 0.22, 81);
  b.scatter(0, H - 1, 26, 1, 'rxN', 0.22, 82);
  b.scatter(30, H - 1, 26, 1, 'rxN', 0.22, 83);
  b.scatter(0, 1, 1, H - 2, 'rxN', 0.22, 84);
  b.scatter(W - 1, 1, 1, H - 2, 'rxN', 0.22, 85);

  // The white wall, the south gate and the road out.
  b.ring(1, 1, 54, 38, 'W');
  b.fill(26, 38, 4, 2, '#');

  // The temple plaza, its side streets, the avenue and the cross streets.
  b.fill(14, 11, 28, 8, '#');
  b.fill(3, 11, 11, 2, '#');
  b.fill(42, 11, 11, 2, '#');
  b.fill(26, 19, 4, 19, '#');
  b.fill(3, 24, 50, 2, '#');
  b.fill(3, 32, 50, 2, '#');

  // The sacred pool with its garden, and the pilgrims' yard.
  b.fill(5, 26, 10, 6, ',');
  b.fill(7, 27, 5, 3, 'o');
  b.scatter(5, 26, 10, 6, '"*', 0.25, 86, ',');
  b.fill(40, 26, 13, 6, ',');

  // Stones and scraps in the lee of the wall.
  b.scatter(2, 2, 52, 2, 'r"', 0.06, 87);
  b.scatter(2, 34, 52, 4, 'rN"', 0.06, 88);

  // Nothing lies under a roof or a prop, nor where a keeper stands.
  for (const { x, y, spec } of buildings) b.clearDecor(x, y, spec.w, spec.h + 1);
  for (const p of props) b.clearDecor(p.x, p.y, PROPS[p.kind].w, PROPS[p.kind].h, b.get(p.x, p.y) === ',' ? ',' : '.');
  return b.build();
}

const buildings: BuildingPlacement[] = [
  // The sun temple: its doors open only to the faithful.
  { x: 20, y: 3, spec: { w: 16, h: 8, wallRows: 4, roof: 'teal', wall: 'plaster', door: 7, windows: [2, 4, 11, 13], dormers: [3, 6, 9, 12], banner: 0xe7c24a } },
  { x: 4, y: 4, shop: 'theocracy-guild', spec: { w: 9, h: 7, roof: 'teal', wall: 'plaster', door: 4, windows: [1, 2, 6, 7], dormers: [2, 6], banner: 0xe7c24a } },
  { x: 43, y: 5, shop: 'theocracy-relics', spec: { w: 8, h: 6, roof: 'teal', wall: 'sandstone', door: 3, windows: [1, 6], sign: 'sun', awning: 0xe7c24a } },
  { x: 5, y: 19, shop: 'theocracy-apothecary', spec: { w: 6, h: 5, roof: 'teal', wall: 'plaster', door: 2, windows: [4], sign: 'potion', awning: 0x3f8a86 } },
  { x: 16, y: 19, shop: 'theocracy-outfitter', spec: { w: 6, h: 5, roof: 'thatch', wall: 'sandstone', door: 2, windows: [4], sign: 'drop', awning: 0xb89a6a } },
  { x: 33, y: 19, shop: 'theocracy-arms', spec: { w: 6, h: 5, roof: 'rust', wall: 'sandstone', door: 2, windows: [4], chimney: 4, sign: 'sword', awning: 0x8a3b2b } },
  { x: 44, y: 19, spec: { w: 6, h: 5, roof: 'teal', wall: 'plaster', door: 3, windows: [1, 5] } },
  { x: 17, y: 27, spec: { w: 5, h: 5, roof: 'thatch', wall: 'plaster', door: 2, windows: [4] } },
  { x: 33, y: 27, spec: { w: 5, h: 5, roof: 'teal', wall: 'sandstone', door: 2, windows: [0] } },
  { x: 8, y: 34, spec: { w: 6, h: 4, roof: 'rust', wall: 'sandstone', door: 2, windows: [4] } },
  { x: 42, y: 34, spec: { w: 6, h: 4, roof: 'thatch', wall: 'plaster', door: 3, windows: [1] } },
];

const props: PropPlacement[] = [
  { kind: 'fountain', x: 26, y: 13 },
  { kind: 'statue', x: 21, y: 12 },
  { kind: 'statue', x: 33, y: 12 },
  { kind: 'brazier', x: 17, y: 11 },
  { kind: 'brazier', x: 38, y: 11 },
  { kind: 'brazier', x: 24, y: 17 },
  { kind: 'brazier', x: 31, y: 17 },
  { kind: 'bench', x: 17, y: 16 },
  { kind: 'bench', x: 37, y: 16 },
  { kind: 'banner', x: 19, y: 9, color: 0xe7c24a },
  { kind: 'banner', x: 36, y: 9, color: 0xe7c24a },
  { kind: 'palm', x: 5, y: 26 },
  { kind: 'palm', x: 13, y: 26 },
  { kind: 'palm', x: 6, y: 30 },
  { kind: 'palm', x: 13, y: 30 },
  { kind: 'palm', x: 24, y: 20 },
  { kind: 'palm', x: 31, y: 20 },
  { kind: 'tent', x: 41, y: 27, color: 0xe8dcc0 },
  { kind: 'tent', x: 45, y: 27, color: 0xc9a46a },
  { kind: 'tent', x: 49, y: 27, color: 0xa86a48 },
  { kind: 'stall', x: 20, y: 34, color: 0xe7c24a },
  { kind: 'stall', x: 32, y: 34, color: 0x3f8a86 },
  { kind: 'well', x: 44, y: 30 },
  { kind: 'notice', x: 13, y: 9 },
];

export const THEOCRACY: LocaleDef = {
  id: 'theocracy',
  name: 'The Theocracy',
  ground: 'sand',
  altGround: 'grass',
  wallStone: 0xe6dcc4,
  terrain: terrain(),
  buildings,
  props,
  exits: [{ x: 26, y: 39, w: 4, h: 1, label: 'Leave the Theocracy' }],
  spawn: { x: 27, y: 37 },
};
