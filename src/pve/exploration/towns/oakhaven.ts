// Oakhaven: a timber town in a clearing of the Northwood, gathered round its
// great oak. The guild, an herbalist and the best bowyer in the north.

import type { BuildingPlacement, LocaleDef, PropPlacement } from '../../../world/locale';
import { MapBuilder } from '../../../world/mapBuilder';
import { PROPS } from '../../../world/props';

const W = 44;
const H = 32;

function terrain(): string[] {
  const b = new MapBuilder(W, H);
  // The Northwood closes in on every side but the south road.
  b.scatter(0, 0, W, 4, 'TtDdTtb', 0.92, 61);
  b.scatter(0, 28, 19, 4, 'TtDdb', 0.9, 62);
  b.scatter(25, 28, 19, 4, 'TtDdb', 0.9, 63);
  b.scatter(0, 4, 3, 24, 'TtDdb', 0.9, 64);
  b.scatter(41, 4, 3, 24, 'TtDdb', 0.9, 65);

  // Lanes round the green, and the road south.
  b.fill(4, 11, 36, 2, '=');
  b.fill(4, 25, 36, 2, '=');
  b.fill(4, 11, 2, 16, '=');
  b.fill(38, 11, 2, 16, '=');
  b.fill(20, 25, 4, 7, '=');

  // The duck pond on the green, flowers and the odd bush.
  b.fill(32, 14, 4, 4, 'o');
  b.scatter(3, 4, 38, 7, '*"b', 0.1, 66);
  b.scatter(6, 13, 32, 12, '*"w', 0.1, 67);
  b.scatter(6, 27, 14, 1, '"*', 0.3, 68);
  b.scatter(24, 27, 14, 1, '"*', 0.3, 69);

  // The sawyard by the east lane, planters by the doors.
  b.paste(33, 20, ['l s', '   ', 's l']);
  b.set(23, 10, 'P').set(29, 10, 'P').set(15, 10, 'u').set(25, 24, 'k').set(32, 21, 'u');

  // Nothing grows under a roof or a prop, nor where a keeper stands.
  for (const { x, y, spec } of buildings) b.clearDecor(x, y, spec.w, spec.h + 1);
  for (const p of props) b.clearDecor(p.x, p.y, PROPS[p.kind].w, PROPS[p.kind].h);
  return b.build();
}

const buildings: BuildingPlacement[] = [
  { x: 7, y: 5, shop: 'oakhaven-guild', spec: { w: 8, h: 6, roof: 'green', wall: 'darkwood', door: 3, windows: [1, 5, 6], dormers: [1, 6], banner: 0x4f8a4b } },
  { x: 17, y: 6, spec: { w: 5, h: 5, roof: 'thatch', wall: 'wood', door: 2, windows: [4], chimney: 1 } },
  { x: 24, y: 6, shop: 'oakhaven-herbalist', spec: { w: 5, h: 5, roof: 'green', wall: 'plaster', door: 1, windows: [3], sign: 'leaf', awning: 0x4f8a4b } },
  { x: 31, y: 5, spec: { w: 6, h: 6, roof: 'thatch', wall: 'darkwood', door: 3, windows: [1, 5], chimney: 4 } },
  { x: 7, y: 20, spec: { w: 5, h: 5, roof: 'green', wall: 'wood', door: 2, windows: [4] } },
  { x: 13, y: 21, spec: { w: 5, h: 4, roof: 'thatch', wall: 'darkwood', door: 1, windows: [3], chimney: 3 } },
  { x: 26, y: 20, shop: 'oakhaven-bowyer', spec: { w: 6, h: 5, roof: 'rust', wall: 'darkwood', door: 2, windows: [4], chimney: 5, sign: 'bow', awning: 0x8b5a2b } },
];

const props: PropPlacement[] = [
  { kind: 'bigoak', x: 20, y: 14 },
  { kind: 'bench', x: 17, y: 18 },
  { kind: 'bench', x: 24, y: 18 },
  { kind: 'well', x: 11, y: 15 },
  { kind: 'notice', x: 28, y: 14 },
  { kind: 'cart', x: 36, y: 21 },
  { kind: 'lamp', x: 6, y: 9 },
  { kind: 'lamp', x: 16, y: 9 },
  { kind: 'lamp', x: 30, y: 9 },
  { kind: 'lamp', x: 37, y: 9 },
  { kind: 'lamp', x: 12, y: 23 },
  { kind: 'lamp', x: 19, y: 23 },
  { kind: 'lamp', x: 24, y: 23 },
  { kind: 'lamp', x: 32, y: 23 },
];

export const OAKHAVEN: LocaleDef = {
  id: 'oakhaven',
  name: 'Oakhaven',
  ground: 'grass',
  terrain: terrain(),
  buildings,
  props,
  exits: [{ x: 20, y: 31, w: 4, h: 1, label: 'Leave Oakhaven' }],
  spawn: { x: 21, y: 29 },
};
