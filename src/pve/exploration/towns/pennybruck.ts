// Pennybruck: a mining hamlet under the mountain wall, a stone street and
// a mine mouth above it. The guild, an apothecary and a miners' supply.

import type { BuildingPlacement, LocaleDef, PropPlacement } from '../../../world/locale';
import { cellHash } from '../../../world/kenney';
import { MapBuilder } from '../../../world/mapBuilder';
import { PROPS } from '../../../world/props';

const W = 36;
const H = 26;

function terrain(): string[] {
  const b = new MapBuilder(W, H);
  // The mountain wall, with a ragged foot everywhere but over the mine.
  b.fill(0, 0, W, 4, 'M');
  for (let x = 0; x < W; x++) {
    if ((x >= 12 && x <= 21) || BOULDERS.some(([bx]) => x === bx || x === bx + 1)) continue;
    const foot = cellHash(x, 0, 71) % 3;
    b.fill(x, 4, 1, foot, 'M');
  }

  // Pines on the slopes either side and below.
  b.scatter(0, 4, 3, 20, 'YyQq', 0.85, 72);
  b.scatter(33, 4, 3, 20, 'YyQq', 0.85, 73);
  b.scatter(0, 24, 16, 2, 'YyQqr', 0.85, 74);
  b.scatter(20, 24, 16, 2, 'YyQqr', 0.85, 75);

  // The mine yard, the path down from it, the street and the lower lane.
  b.fill(12, 4, 10, 3, ',');
  b.fill(15, 6, 2, 7, '=');
  b.fill(3, 13, 30, 2, '#');
  b.fill(16, 15, 4, 11, '=');
  b.fill(3, 21, 30, 2, '=');

  // Scree, ore sacks and clutter.
  b.scatter(3, 5, 30, 8, 'r"', 0.08, 76);
  b.scatter(3, 15, 30, 6, 'r"w', 0.08, 77);
  b.set(12, 4, 'n').set(13, 5, 'n').set(21, 5, 'k').set(20, 6, 'r');
  b.set(21, 15, 'k').set(22, 15, 'u').set(11, 15, 'u');

  // Nothing lies under a roof or a prop, nor where a keeper stands.
  for (const { x, y, spec } of buildings) b.clearDecor(x, y, spec.w, spec.h + 1);
  for (const p of props) b.clearDecor(p.x, p.y, PROPS[p.kind].w, PROPS[p.kind].h, p.y <= 6 ? ',' : '.');
  return b.build();
}

const BOULDERS: [number, number][] = [[6, 4], [26, 4]];

const buildings: BuildingPlacement[] = [
  { x: 4, y: 7, shop: 'pennybruck-guild', spec: { w: 7, h: 6, roof: 'slate', wall: 'stone', door: 3, windows: [1, 5], dormers: [1, 5], banner: 0x8a3b2b } },
  { x: 23, y: 8, shop: 'pennybruck-apothecary', spec: { w: 5, h: 5, roof: 'teal', wall: 'stone', door: 1, windows: [3], sign: 'potion', awning: 0x3f8a86 } },
  { x: 29, y: 9, spec: { w: 4, h: 4, roof: 'charcoal', wall: 'stone', door: 1, windows: [3] } },
  { x: 5, y: 16, spec: { w: 5, h: 5, roof: 'slate', wall: 'stone', door: 2, windows: [4], chimney: 1 } },
  { x: 11, y: 17, spec: { w: 4, h: 4, roof: 'charcoal', wall: 'wood', door: 2, windows: [0] } },
  { x: 21, y: 16, shop: 'pennybruck-supply', spec: { w: 6, h: 5, roof: 'rust', wall: 'darkwood', door: 2, windows: [4], chimney: 4, sign: 'pick', awning: 0x9b6b43 } },
  { x: 28, y: 17, spec: { w: 5, h: 4, roof: 'slate', wall: 'darkwood', door: 1, windows: [3] } },
];

const props: PropPlacement[] = [
  { kind: 'cave', x: 15, y: 4 },
  { kind: 'cart', x: 18, y: 4 },
  { kind: 'well', x: 19, y: 9 },
  { kind: 'notice', x: 12, y: 10 },
  { kind: 'lamp', x: 3, y: 11 },
  { kind: 'lamp', x: 22, y: 11 },
  { kind: 'lamp', x: 27, y: 19 },
  { kind: 'lamp', x: 15, y: 19 },
  ...BOULDERS.map(([x, y]): PropPlacement => ({ kind: 'boulder', x, y })),
];

export const PENNYBRUCK: LocaleDef = {
  id: 'pennybruck',
  name: 'Pennybruck',
  ground: 'sage',
  altGround: 'stone',
  terrain: terrain(),
  buildings,
  props,
  exits: [{ x: 16, y: 25, w: 4, h: 1, label: 'Leave Pennybruck' }],
  spawn: { x: 17, y: 23 },
};
