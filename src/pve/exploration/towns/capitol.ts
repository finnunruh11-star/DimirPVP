// The Capitol: a walled city with the castle keep at its head, a market plaza
// and fountain at its heart, and every trade in the land along its streets.
// Coordinates are in tiles; the south gate leads back to the road.

import type { BuildingPlacement, LocaleDef, PropPlacement } from '../../../world/locale';
import { MapBuilder } from '../../../world/mapBuilder';

const W = 60;
const H = 40;

function terrain(): string[] {
  const b = new MapBuilder(W, H);
  // Woods outside the walls.
  b.scatter(0, 0, W, 1, 'ty', 0.85, 1);
  b.scatter(0, 1, W, 1, 'TY', 0.7, 2);
  b.scatter(0, 38, W, 1, 'TY', 0.7, 3);
  b.scatter(0, 39, W, 1, 'ty', 0.85, 4);
  b.scatter(0, 2, 1, 36, 'ty', 0.9, 5);
  b.scatter(59, 2, 1, 36, 'ty', 0.9, 6);

  // Walls, gate and the road out.
  b.ring(1, 2, 58, 36, 'W');
  b.fill(28, 37, 4, 1, '#');
  b.fill(28, 38, 4, 2, '=');

  // Streets.
  b.fill(3, 10, 54, 2, '#'); // north street, past the keep
  b.fill(18, 12, 24, 10, '#'); // market plaza
  b.fill(3, 18, 15, 2, '#'); // guild row
  b.fill(42, 18, 15, 2, '#'); // smiths' row
  b.fill(3, 24, 54, 2, '#'); // cross street
  b.fill(3, 31, 54, 2, '#'); // south street
  b.fill(3, 10, 2, 23, '#'); // west lane
  b.fill(55, 10, 2, 23, '#'); // east lane
  b.fill(28, 22, 4, 15, '#'); // the avenue from the gate
  b.fill(2, 34, 56, 2, '~'); // the river under the south wall
  b.fill(28, 34, 4, 2, 'I');

  // Gardens and greenery.
  b.paste(3, 3, ['TT', '  ', 'T ', ' b', 'T ', '* ']);
  b.fill(5, 4, 13, 1, 'h');
  b.scatter(5, 3, 13, 1, '*"', 0.5, 7);
  b.paste(18, 3, ['*t*', 'T  ', ' * b', '  T ', 'b  *', '* T ', ' *  ']);
  b.paste(38, 3, ['t ', ' *', 'b ', ' t', '* ', ' b']);
  b.fill(40, 4, 12, 1, 'h');
  b.scatter(40, 3, 12, 1, '*"', 0.5, 8);
  b.paste(52, 3, ['T  T ', '  b  ', 'T  * ', ' *  T', 'b  * ', '  T  ', '*   b']);
  b.scatter(5, 12, 13, 1, 'b*', 0.35, 9);
  b.scatter(42, 12, 13, 1, 'b*', 0.35, 10);
  b.paste(14, 13, ['  t ', '*   ', '    ', '    ', '   *']);
  b.fill(5, 22, 22, 1, 'h');
  b.fill(33, 22, 22, 1, 'h');
  b.scatter(5, 23, 22, 1, '*"', 0.45, 11);
  b.scatter(33, 23, 22, 1, '*"', 0.45, 12);
  b.paste(11, 26, ['ku', ' ']);
  b.set(13, 30, '^');
  b.paste(19, 26, ['b', ' ', 'T', ' ', '*']);
  b.paste(26, 26, ['t', ' ', '*', 't', ' ']);
  b.paste(32, 26, ['t', ' ', '*', 't', ' ']);
  b.paste(39, 26, ['T ', '  ', ' b', '  ', '* ']);
  b.paste(47, 26, ['b', ' ', '*', ' ', 'b']);
  b.paste(54, 26, ['u', 'k', ' ', ' ', 'u']);
  b.scatter(2, 33, 56, 1, '"*"w', 0.45, 13);
  b.scatter(2, 36, 56, 1, '"b"', 0.35, 14);
  b.set(11, 8, 'u').set(11, 9, 'k');
  b.set(18, 9, 'c');
  b.set(54, 12, 'u');
  return b.build();
}

const buildings: BuildingPlacement[] = [
  // The keep: grand, but its doors stay shut to travellers.
  { x: 22, y: 3, spec: { w: 16, h: 7, wallRows: 3, roof: 'slate', wall: 'stone', door: 7, windows: [2, 4, 11, 13], dormers: [3, 6, 9, 12], banner: 0x2f4f86 } },
  { x: 5, y: 5, shop: 'capitol-valuables', spec: { w: 6, h: 5, roof: 'charcoal', wall: 'darkwood', door: 2, windows: [4], sign: 'coin', awning: 0xc9a64a } },
  { x: 12, y: 5, shop: 'capitol-apothecary', spec: { w: 6, h: 5, roof: 'green', wall: 'plaster', door: 2, windows: [4], sign: 'potion', awning: 0x3f7a4a, chimney: 0 } },
  { x: 40, y: 5, shop: 'capitol-jeweller', spec: { w: 5, h: 5, roof: 'plum', wall: 'plaster', door: 1, windows: [3], sign: 'ring', awning: 0x7a3f8a } },
  { x: 47, y: 5, shop: 'capitol-gems', spec: { w: 5, h: 5, roof: 'teal', wall: 'sandstone', door: 1, windows: [3], sign: 'gem' } },
  { x: 5, y: 13, shop: 'capitol-guild', spec: { w: 9, h: 5, roof: 'blue', wall: 'stone', door: 4, windows: [1, 2, 6, 7], dormers: [2, 6], banner: 0xb34a3c } },
  { x: 42, y: 13, shop: 'capitol-armory', spec: { w: 7, h: 5, roof: 'slate', wall: 'stone', door: 3, windows: [1, 5], sign: 'shield', chimney: 5 } },
  { x: 49, y: 13, shop: 'capitol-weaponsmith', spec: { w: 6, h: 5, roof: 'red', wall: 'brick', door: 2, windows: [4], sign: 'sword', awning: 0x8a3b2b, chimney: 1 } },
  { x: 5, y: 26, shop: 'capitol-forge', spec: { w: 6, h: 5, roof: 'rust', wall: 'brick', door: 2, windows: [4], sign: 'anvil', awning: 0x7a2f2f, chimney: 4 } },
  // Homes.
  { x: 14, y: 26, spec: { w: 5, h: 5, roof: 'red', wall: 'plaster', door: 1, windows: [3], chimney: 3 } },
  { x: 21, y: 26, spec: { w: 5, h: 5, roof: 'thatch', wall: 'wood', door: 3, windows: [1] } },
  { x: 34, y: 26, shop: 'capitol-scriptorium', spec: { w: 5, h: 5, roof: 'plum', wall: 'plaster', door: 1, windows: [3], chimney: 1, sign: 'quill', awning: 0x4a3a7a } },
  { x: 41, y: 26, spec: { w: 6, h: 5, roof: 'green', wall: 'wood', door: 2, windows: [4] } },
  { x: 48, y: 26, spec: { w: 6, h: 5, roof: 'red', wall: 'stone', door: 2, windows: [4], chimney: 4 } },
];

const props: PropPlacement[] = [
  { kind: 'fountain', x: 28, y: 15 },
  { kind: 'statue', x: 24, y: 15 },
  { kind: 'statue', x: 34, y: 15 },
  { kind: 'stall', x: 19, y: 19, color: 0xb34a3c },
  { kind: 'stall', x: 23, y: 19, color: 0xe0a93a },
  { kind: 'stall', x: 34, y: 19, color: 0x4f8a4b },
  { kind: 'stall', x: 38, y: 19, color: 0x4a6fa8 },
  { kind: 'bench', x: 21, y: 16 },
  { kind: 'bench', x: 37, y: 16 },
  { kind: 'lamp', x: 20, y: 12 },
  { kind: 'lamp', x: 39, y: 12 },
  { kind: 'lamp', x: 26, y: 20 },
  { kind: 'lamp', x: 33, y: 20 },
  { kind: 'banner', x: 26, y: 12, color: 0x2f4f86 },
  { kind: 'banner', x: 33, y: 12, color: 0x2f4f86 },
  { kind: 'lamp', x: 21, y: 8 },
  { kind: 'lamp', x: 38, y: 8 },
  { kind: 'lamp', x: 27, y: 22 },
  { kind: 'lamp', x: 32, y: 22 },
  { kind: 'notice', x: 14, y: 16 },
  { kind: 'furnace', x: 11, y: 28 },
];

export const CAPITOL: LocaleDef = {
  id: 'capitol',
  name: 'The Capitol',
  ground: 'grass',
  wallStone: 0x9ea3ab,
  terrain: terrain(),
  buildings,
  props,
  exits: [{ x: 28, y: 39, w: 4, h: 1, label: 'Leave the Capitol' }],
  spawn: { x: 29, y: 36 },
};
