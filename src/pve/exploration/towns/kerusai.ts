// Kerusai: a small bog town in the black country, huddled around a muddy
// square. The basics, a dealer in drowned valuables, and a graveyard across
// the mere.

import type { BuildingPlacement, LocaleDef, PropPlacement } from '../../../world/locale';
import { MapBuilder } from '../../../world/mapBuilder';

const W = 40;
const H = 28;

function terrain(): string[] {
  const b = new MapBuilder(W, H);
  // Dead woods all round, open only to the east road.
  b.scatter(0, 0, W, 2, 'dQqDv', 0.85, 31);
  b.scatter(0, 26, W, 2, 'dQqDv', 0.85, 32);
  b.scatter(0, 2, 2, 24, 'dQqv', 0.85, 33);
  b.scatter(38, 2, 2, 10, 'dQqv', 0.85, 34);
  b.scatter(38, 14, 2, 12, 'dQqv', 0.85, 35);

  // The road and the square.
  b.fill(2, 12, 38, 2, '=');
  b.fill(13, 8, 13, 4, '=');


  
  // Meres, a fishing jetty and the causeway to the graveyard.
  b.fill(4, 16, 8, 6, '~');
  b.fill(7, 16, 1, 4, 'I');
  b.fill(26, 16, 9, 5, '~');
  b.fill(30, 16, 1, 5, 'I');
  b.ring(26, 21, 11, 5, 'F');
  b.set(30, 21, ':');
  b.fill(30, 22, 1, 3, ':');
  for (const x of [28, 32, 34]) b.set(x, 22, 'g').set(x, 24, 'g');
  b.set(28, 23, '"').set(33, 23, 'm');

  // Lanes to the south huts.
  b.fill(18, 14, 1, 8, ':');
  b.fill(14, 22, 10, 1, ':');

  // Mud, reeds, fungus and the odd torch.
  b.scatter(2, 2, 36, 5, 'md"vws', 0.12, 36);
  b.scatter(2, 14, 36, 12, 'md"ws', 0.1, 37);
  b.scatter(3, 15, 10, 8, '""m', 0.5, 38);
  b.scatter(25, 15, 11, 7, '""m', 0.4, 39);
  for (const x of [4, 11, 27, 34]) b.set(x, 11, 'i');
  for (const x of [8, 22, 36]) b.set(x, 14, 'i');
  b.set(9, 10, 'c').set(10, 10, 'e');
  b.set(33, 8, 'k').set(33, 9, 'u').set(34, 9, 'n');
  b.set(12, 5, 'l').set(24, 6, 's');
  // Nothing grows under a roof, a cart or a notice board.
  for (const { x, y, spec } of buildings) b.clearDecor(x, y, spec.w, spec.h + 1);
  b.clearDecor(22, 5, 2, 2).clearDecor(36, 15, 2, 2);
  return b.build();
}

const buildings: BuildingPlacement[] = [
  { x: 14, y: 3, shop: 'kerusai-guild', spec: { w: 7, h: 5, roof: 'plum', wall: 'darkwood', door: 3, windows: [1, 5], dormers: [2, 4], banner: 0x6a4a6e } },
  { x: 4, y: 6, shop: 'kerusai-apothecary', spec: { w: 5, h: 5, roof: 'teal', wall: 'darkwood', door: 1, windows: [3], sign: 'potion', awning: 0x3f8a86 } },
  { x: 28, y: 6, shop: 'kerusai-valuables', spec: { w: 5, h: 5, roof: 'charcoal', wall: 'wood', door: 1, windows: [3], sign: 'coin', awning: 0xa8862c } },
  { x: 33, y: 3, spec: { w: 5, h: 4, roof: 'thatch', wall: 'darkwood', door: 2 } },
  { x: 13, y: 18, spec: { w: 5, h: 4, roof: 'thatch', wall: 'darkwood', door: 2 } },
  { x: 19, y: 18, spec: { w: 5, h: 4, roof: 'plum', wall: 'wood', door: 2, chimney: 3 } },
];

const props: PropPlacement[] = [
  { kind: 'notice', x: 22, y: 5 },
  { kind: 'cart', x: 36, y: 15 },
];

export const KERUSAI: LocaleDef = {
  id: 'kerusai',
  name: 'Kerusai',
  ground: 'olive',
  terrain: terrain(),
  buildings,
  props,
  exits: [{ x: 39, y: 12, w: 1, h: 2, label: 'Leave Kerusai' }],
  spawn: { x: 37, y: 12 },
};
