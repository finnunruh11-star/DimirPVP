// Thassa: a white-walled port on the shore of the Great Lake, with a sandy
// beach, three piers and boats drawn up on the sand. The guild, an
// apothecary and a pearl trader along the waterfront.

import type { BuildingPlacement, LocaleDef, PropPlacement } from '../../../world/locale';
import { MapBuilder } from '../../../world/mapBuilder';
import { PROPS } from '../../../world/props';

const W = 44;
const H = 30;

function terrain(): string[] {
  const b = new MapBuilder(W, H);
  // Orchards and hedgerows inland, open only to the north road.
  b.scatter(0, 0, 20, 3, 'tfbv', 0.8, 81);
  b.scatter(24, 0, 20, 3, 'tfbv', 0.8, 82);
  b.scatter(0, 3, 2, 15, 'tbv', 0.8, 83);
  b.scatter(42, 3, 2, 15, 'tbv', 0.8, 84);

  // The beach and the Great Lake, with a ragged waterline.
  b.fill(0, 19, W, 4, ',');
  b.fill(0, 23, W, 7, '~');
  b.fill(0, 21, 4, 2, '~');
  b.fill(16, 22, 4, 1, '~');
  b.fill(40, 21, 4, 2, '~');
  b.fill(30, 23, 3, 1, ',');

  // Three piers out over the water.
  b.fill(10, 23, 2, 5, 'I');
  b.fill(24, 23, 2, 6, 'I');
  b.fill(36, 23, 2, 4, 'I');

  // The north road, the back lane and the waterfront promenade.
  b.fill(20, 0, 4, 16, '#');
  b.fill(2, 9, 40, 2, '#');
  b.fill(2, 16, 40, 2, '#');

  // Flowers in the yards, planters by the doors.
  b.scatter(2, 3, 40, 6, '*"b', 0.1, 85);
  b.scatter(2, 11, 40, 5, '*"', 0.08, 86);
  b.scatter(0, 18, W, 1, '"*', 0.2, 87);
  b.set(18, 15, 'P').set(25, 15, 'P');

  // Nothing grows under a roof or a prop, nor where a keeper stands.
  for (const { x, y, spec } of buildings) b.clearDecor(x, y, spec.w, spec.h + 1);
  for (const p of props) b.clearDecor(p.x, p.y, PROPS[p.kind].w, PROPS[p.kind].h);
  return b.build();
}

const buildings: BuildingPlacement[] = [
  { x: 4, y: 4, spec: { w: 5, h: 5, roof: 'blue', wall: 'plaster', door: 2, windows: [4] } },
  { x: 11, y: 4, spec: { w: 6, h: 5, roof: 'teal', wall: 'sandstone', door: 2, windows: [4], chimney: 1 } },
  { x: 26, y: 3, spec: { w: 7, h: 6, roof: 'blue', wall: 'plaster', door: 3, windows: [1, 5], dormers: [2, 4] } },
  { x: 35, y: 4, spec: { w: 5, h: 5, roof: 'teal', wall: 'plaster', door: 1, windows: [3] } },
  { x: 3, y: 11, shop: 'thassa-guild', spec: { w: 8, h: 5, roof: 'blue', wall: 'plaster', door: 3, windows: [1, 5, 6], banner: 0x3f66a8 } },
  { x: 13, y: 11, shop: 'thassa-apothecary', spec: { w: 5, h: 5, roof: 'teal', wall: 'plaster', door: 1, windows: [3], sign: 'potion', awning: 0x3f8a86 } },
  { x: 26, y: 11, shop: 'thassa-pearls', spec: { w: 6, h: 5, roof: 'teal', wall: 'sandstone', door: 2, windows: [4], sign: 'pearl', awning: 0x3f8a86 } },
  { x: 34, y: 11, spec: { w: 6, h: 5, roof: 'blue', wall: 'plaster', door: 3, windows: [1, 5] } },
];

const PALMS = [3, 8, 13, 21, 28, 35, 40];

const props: PropPlacement[] = [
  ...PALMS.map((x): PropPlacement => ({ kind: 'palm', x, y: 18 })),
  { kind: 'boat', x: 5, y: 21 },
  { kind: 'boat', x: 14, y: 21, flip: true },
  { kind: 'boat', x: 28, y: 21 },
  { kind: 'boat', x: 38, y: 21, flip: true },
  { kind: 'rack', x: 17, y: 19 },
  { kind: 'rack', x: 32, y: 19 },
  { kind: 'crate', x: 9, y: 22 },
  { kind: 'barrel', x: 12, y: 22 },
  { kind: 'crate', x: 23, y: 22 },
  { kind: 'barrel', x: 26, y: 22 },
  { kind: 'crate', x: 35, y: 22 },
  { kind: 'barrel', x: 38, y: 22 },
  { kind: 'bench', x: 5, y: 18 },
  { kind: 'bench', x: 30, y: 18 },
  { kind: 'lamp', x: 11, y: 14 },
  { kind: 'lamp', x: 19, y: 14 },
  { kind: 'lamp', x: 24, y: 14 },
  { kind: 'lamp', x: 33, y: 14 },
  { kind: 'lamp', x: 41, y: 14 },
];

export const THASSA: LocaleDef = {
  id: 'thassa',
  name: 'Thassa',
  ground: 'grass',
  altGround: 'sand',
  terrain: terrain(),
  buildings,
  props,
  exits: [{ x: 20, y: 0, w: 4, h: 1, label: 'Leave Thassa' }],
  spawn: { x: 21, y: 2 },
};
