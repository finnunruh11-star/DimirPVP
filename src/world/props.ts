// Street furniture for towns and wilds. Small props are ASCII pixel art; the
// larger ones (stalls, wells, statues) are painted from rectangles so their
// proportions stay honest. Pure: every prop is a PixelBuffer.

import { PixelBuffer, shade, tint, tones, type Palette } from './pixels';

const PAL: Palette = {
  m: 0x3b2a1e, // deep wood outline
  w: 0x6e4a2e,
  W: 0x9b6b43,
  V: 0xb98555,
  D: 0x3a3a42,
  d: 0x56565f,
  i: 0x8a8f96,
  I: 0xc9ccd1,
  Y: 0xe7c24a,
  y: 0xa8862c,
  F: 0xfff1b0,
  O: 0xe08a3c,
  o: 0xb0602e,
  R: 0xb34a3c,
  r: 0x7e3029,
  G: 0x4f8a4b,
  g: 0x2f5f33,
  L: 0x8cc334,
  h: 0xd8c07a,
  H: 0xf0dc9c,
  c: 0xa8904f,
  s: 0x7d8288,
  S: 0xa7acb2,
  T: 0xc7ccd1,
  p: 0x6a4a6e,
  P: 0x9a6fb0,
  e: 0xe6d9bc,
  E: 0xf4efe2,
  B: 0x4a6fa8,
  b: 0x2d4a78,
  C: 0x9fd0ea,
  x: 0x1c1c20,
  n: 0x5d4838,
  u: 0x3f7a3a,
  U: 0x6fae5a,
  k: 0x7a2f2f,
  K: 0xc2504a,
  z: 0x4b4f5a,
};

const ART: Record<string, readonly string[]> = {
  barrel: [
    '................',
    '................',
    '....mmmmmmmm....',
    '...mwWWWWWWwm...',
    '...mWVVVVVVWm...',
    '...mwWWWWWWwm...',
    '...mddddddddm...',
    '...mWWVWWVWWm...',
    '...mWWVWWVWWm...',
    '...mWWVWWVWWm...',
    '...mddddddddm...',
    '...mWWVWWVWWm...',
    '...mwWVWWVWwm...',
    '...mwwwwwwwwm...',
    '....mmmmmmmm....',
    '................',
  ],
  crate: [
    '................',
    '................',
    '..mmmmmmmmmmmm..',
    '..mVVVVVVVVVVm..',
    '..mVwVVVVVVwVm..',
    '..mVVwVVVVwVVm..',
    '..mVVVwVVwVVVm..',
    '..mVVVVwwVVVVm..',
    '..mVVVVwwVVVVm..',
    '..mVVVwVVwVVVm..',
    '..mVVwVVVVwVVm..',
    '..mVwVVVVVVwVm..',
    '..mWWWWWWWWWWm..',
    '..mmmmmmmmmmmm..',
    '................',
    '................',
  ],
  sack: [
    '................',
    '................',
    '................',
    '......mmmm......',
    '.....mhhhhm.....',
    '......mccm......',
    '.....mhhhhm.....',
    '....mhHhhhhm....',
    '...mhHhhhhhhm...',
    '...mhHhhhhhhm...',
    '...mhhhhhhhcm...',
    '...mhhhhhhccm...',
    '....mhhhhccm....',
    '.....mmmmmm.....',
    '................',
    '................',
  ],
  hay: [
    '................',
    '................',
    '................',
    '...cccccccccc...',
    '..chHhHhHhHhHc..',
    '..cHhHhHhHhHhc..',
    '..chhhhhhhhhhc..',
    '..cmmmmmmmmmmc..',
    '..chHhHhHhHhHc..',
    '..cHhHhHhHhHhc..',
    '..chhhhhhhhhhc..',
    '..cmmmmmmmmmmc..',
    '..chhhhhhhhhhc..',
    '...cccccccccc...',
    '................',
    '................',
  ],
  pots: [
    '................',
    '................',
    '................',
    '................',
    '.........kkk....',
    '.........kKk....',
    '..kkkk..kKKKk...',
    '..kKKk.kKKKKKk..',
    '.kKKKKkkKKKKKk..',
    '.kKKKKkkKKKKKk..',
    '.kKKKKk.kKKKk...',
    '..kkkk...kkk....',
    '................',
    '................',
    '................',
    '................',
  ],
  rock: [
    '................',
    '................',
    '................',
    '................',
    '.....zzzz.......',
    '...zzSSTSzz.....',
    '..zSSTTTSSsz....',
    '..zSSSSSSSssz...',
    '.zSSSSSSSSSssz..',
    '.zsSSSSSSSsssz..',
    '.zssSSSSsssssz..',
    '..zssssssssz....',
    '...zzzzzzzz.....',
    '................',
    '................',
    '................',
  ],
  mushrooms: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '.....PPP........',
    '....PPEPP.......',
    '...PPPPPPP..pp..',
    '.....ee....pPPp.',
    '.....ee.....ee..',
    '..pp.ee.....ee..',
    '.pPPp.......ee..',
    '..ee............',
    '..ee............',
    '................',
    '................',
  ],
  cauldron: [
    '................',
    '................',
    '................',
    '................',
    '.....U.U........',
    '....UuUUu.U.....',
    '..DDDDDDDDDDD...',
    '..DuuUUUUUuuD...',
    '..DDDDDDDDDDD...',
    '..DdddddddddD...',
    '..DddiiddddD....',
    '...DdddddddD....',
    '....DDDDDDD.....',
    '....D.....D.....',
    '...oOo...oOo....',
    '................',
  ],
  planter: [
    '................',
    '................',
    '................',
    '...R..Y..R..Y...',
    '..RYR.G.RYR.G...',
    '...G.uGu.G.uGu..',
    '..uGuGGGuGuGGu..',
    '..mmmmmmmmmmmm..',
    '..mVVVVVVVVVVm..',
    '..mWWWWWWWWWWm..',
    '..mWWWWWWWWWWm..',
    '..mmmmmmmmmmmm..',
    '................',
    '................',
    '................',
    '................',
  ],
  stump: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '....mmmmmmm.....',
    '...mhVhhhVhm....',
    '...mVhmmhhVm....',
    '...mhhhhhVhm....',
    '...mwhhhhhwm....',
    '...mwWWWWWwm....',
    '..mwwWWWWWwwm...',
    '..mmwmmmmwmmm...',
    '................',
    '................',
    '................',
  ],
  anvil: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '..DDDDDDDDDDD...',
    '.DIIIIIIIIIIDD..',
    '..DdddddddddD...',
    '.....DddD.......',
    '.....DddD.......',
    '....DddddD......',
    '...DDDDDDDD.....',
    '................',
    '................',
    '................',
    '................',
  ],
};

/** Everything a map can place, with its size in tiles and which cells block. */
export const PROPS = {
  barrel: { w: 1, h: 1, solid: 'all' },
  crate: { w: 1, h: 1, solid: 'all' },
  sack: { w: 1, h: 1, solid: 'all' },
  hay: { w: 1, h: 1, solid: 'all' },
  pots: { w: 1, h: 1, solid: 'all' },
  rock: { w: 1, h: 1, solid: 'all' },
  mushrooms: { w: 1, h: 1, solid: 'none' },
  cauldron: { w: 1, h: 1, solid: 'all' },
  planter: { w: 1, h: 1, solid: 'all' },
  stump: { w: 1, h: 1, solid: 'all' },
  anvil: { w: 1, h: 1, solid: 'all' },
  lamp: { w: 1, h: 2, solid: 'bottom' },
  bench: { w: 2, h: 1, solid: 'all' },
  stall: { w: 3, h: 2, solid: 'bottom' },
  well: { w: 2, h: 2, solid: 'all' },
  notice: { w: 2, h: 2, solid: 'bottom' },
  statue: { w: 2, h: 3, solid: 'bottom' },
  cart: { w: 2, h: 2, solid: 'bottom' },
  furnace: { w: 2, h: 2, solid: 'all' },
  rack: { w: 2, h: 2, solid: 'bottom' },
  boulder: { w: 2, h: 2, solid: 'all' },
  spout: { w: 1, h: 2, solid: 'bottom' },
  banner: { w: 1, h: 2, solid: 'bottom' },
  brazier: { w: 1, h: 2, solid: 'bottom' },
  fountain: { w: 4, h: 3, solid: 'all' },
  deadtree: { w: 1, h: 2, solid: 'bottom' },
  emberrock: { w: 1, h: 1, solid: 'all' },
  vent: { w: 1, h: 1, solid: 'none' },
  bones: { w: 1, h: 1, solid: 'none' },
  tent: { w: 2, h: 2, solid: 'all' },
  cave: { w: 2, h: 2, solid: 'all' },
  boat: { w: 2, h: 1, solid: 'all' },
  palm: { w: 1, h: 2, solid: 'bottom' },
  bigoak: { w: 3, h: 3, solid: 'bottom' },
} as const satisfies Record<string, { w: number; h: number; solid: 'all' | 'bottom' | 'none' }>;

export type PropKind = keyof typeof PROPS;

export interface PropOptions {
  /** Canopy, banner or goods colour. */
  color?: number;
  /** Mirror left to right. */
  flip?: boolean;
}

export function propPixels(kind: PropKind, opts: PropOptions = {}): PixelBuffer {
  const size = PROPS[kind];
  const px = new PixelBuffer(size.w * 16, size.h * 16);
  const art = ART[kind];
  if (art) {
    px.blit(art, PAL, 0, 0, opts.flip);
    return px;
  }
  switch (kind) {
    case 'lamp': paintLamp(px); break;
    case 'bench': paintBench(px); break;
    case 'stall': paintStall(px, opts.color ?? 0xb34a3c); break;
    case 'well': paintWell(px); break;
    case 'notice': paintNotice(px); break;
    case 'statue': paintStatue(px); break;
    case 'cart': paintCart(px); break;
    case 'furnace': paintFurnace(px); break;
    case 'rack': paintRack(px); break;
    case 'boulder': paintBoulder(px); break;
    case 'spout': paintSpout(px); break;
    case 'banner': paintBannerPole(px, opts.color ?? 0x4a6fa8); break;
    case 'brazier': paintBrazier(px); break;
    case 'fountain': paintFountain(px); break;
    case 'deadtree': paintDeadTree(px); break;
    case 'emberrock': paintEmberRock(px); break;
    case 'vent': paintVent(px); break;
    case 'bones': paintBones(px); break;
    case 'tent': paintTent(px, opts.color ?? 0x9a7650); break;
    case 'cave': paintCave(px); break;
    case 'boat': paintBoat(px); break;
    case 'palm': paintPalm(px); break;
    case 'bigoak': paintBigOak(px); break;
    default: break;
  }
  return px;
}

const IRON = tones(0x3a3a42);
const WOOD = tones(0x9b6b43);
const STONE = tones(0xa7acb2);

function paintLamp(px: PixelBuffer): void {
  px.rect(7, 9, 2, 20, IRON.base);
  px.vline(8, 9, 20, IRON.light);
  px.rect(5, 28, 6, 3, IRON.base);
  px.hline(4, 30, 8, IRON.dark);
  px.rect(4, 1, 8, 2, IRON.base);
  px.rect(5, 3, 6, 6, 0xe7c24a);
  px.rect(6, 4, 4, 4, 0xfff1b0);
  px.vline(4, 3, 6, IRON.base);
  px.vline(11, 3, 6, IRON.base);
  px.hline(4, 9, 8, IRON.base);
  px.set(7, 0, IRON.base);
  px.set(8, 0, IRON.base);
}

function paintBench(px: PixelBuffer): void {
  px.rect(2, 5, 28, 3, WOOD.light);
  px.hline(2, 8, 28, WOOD.dark);
  px.rect(2, 9, 28, 3, WOOD.base);
  px.hline(2, 12, 28, WOOD.deep);
  for (const x of [4, 26]) px.rect(x, 12, 2, 3, WOOD.deep);
  px.frame(1, 4, 30, 9, WOOD.deep);
}

function paintStall(px: PixelBuffer, color: number): void {
  const cloth = tones(color);
  // Posts.
  for (const x of [3, 43]) px.rect(x, 6, 2, 24, WOOD.dark);
  // Canopy with stripes and a scalloped hem.
  for (let x = 1; x < 47; x++) {
    const stripe = Math.floor((x - 1) / 5) % 2 === 0 ? cloth.base : 0xf1ebdc;
    px.vline(x, 2, 8, stripe);
    if ((x - 1) % 5 !== 4) px.set(x, 10, stripe);
  }
  px.hline(1, 1, 46, cloth.dark);
  px.hline(1, 2, 46, cloth.light);
  px.vline(0, 1, 10, cloth.deep);
  px.vline(47, 1, 10, cloth.deep);
  // Counter with goods on it.
  px.rect(2, 20, 44, 4, WOOD.light);
  px.rect(2, 24, 44, 6, WOOD.base);
  px.hline(2, 24, 44, WOOD.dark);
  px.hline(2, 30, 44, WOOD.deep);
  const goods = [0xb34a3c, 0xe7c24a, 0x6fae5a, 0xe08a3c, 0x9a6fb0, 0xb34a3c, 0x6fae5a];
  goods.forEach((c, i) => {
    const x = 6 + i * 6;
    px.rect(x, 17, 4, 3, c);
    px.set(x + 1, 17, tint(c, 0.4));
    px.hline(x, 20, 4, shade(c, 0.4));
  });
  px.frame(1, 19, 46, 12, WOOD.deep);
}

function paintWell(px: PixelBuffer): void {
  // Roof on two posts.
  px.rect(4, 0, 24, 5, 0xb34a3c);
  px.hline(4, 0, 24, 0x7e3029);
  px.hline(4, 4, 24, 0x7e3029);
  for (const x of [6, 24]) px.rect(x, 5, 2, 14, WOOD.dark);
  px.hline(8, 8, 16, WOOD.base);
  px.rect(15, 9, 2, 5, IRON.light);
  px.rect(13, 13, 6, 4, WOOD.base);
  // Stone ring with dark water.
  px.rect(3, 17, 26, 13, STONE.base);
  for (let x = 3; x < 29; x += 5) px.vline(x, 17, 13, STONE.dark);
  px.hline(3, 22, 26, STONE.dark);
  px.rect(6, 16, 20, 4, 0x2d4a78);
  px.hline(6, 16, 20, STONE.light);
  px.frame(2, 15, 28, 16, STONE.deep);
}

function paintNotice(px: PixelBuffer): void {
  for (const x of [4, 26]) px.rect(x, 4, 2, 27, WOOD.dark);
  px.rect(2, 3, 28, 18, WOOD.base);
  px.frame(2, 3, 28, 18, WOOD.deep);
  px.hline(2, 2, 28, WOOD.dark);
  const papers: [number, number, number, number][] = [[5, 6, 8, 10], [15, 5, 7, 7], [23, 7, 5, 9], [15, 13, 9, 6]];
  papers.forEach(([x, y, w, h], i) => {
    px.rect(x, y, w, h, i % 2 ? 0xf4efe2 : 0xe6d9bc);
    for (let yy = y + 2; yy < y + h - 1; yy += 2) px.hline(x + 1, yy, w - 2, 0x8a8f96);
    px.set(x + (w >> 1), y, 0xb34a3c);
  });
}

function paintStatue(px: PixelBuffer): void {
  // Pedestal.
  px.rect(4, 32, 24, 14, STONE.base);
  px.hline(4, 32, 24, STONE.light);
  px.hline(4, 38, 24, STONE.dark);
  px.frame(3, 31, 26, 16, STONE.deep);
  px.rect(10, 40, 12, 3, 0xe7c24a);
  // A robed figure with a raised sword.
  const body = tones(0xc7ccd1);
  px.rect(11, 12, 10, 20, body.base);
  px.rect(10, 26, 12, 6, body.dark);
  px.rect(12, 5, 8, 8, body.light);
  px.set(14, 8, body.deep);
  px.set(17, 8, body.deep);
  px.rect(20, 12, 3, 9, body.base);
  px.vline(22, 0, 12, 0xe6ecf2);
  px.vline(23, 1, 10, body.dark);
  px.hline(20, 11, 5, body.deep);
  px.rect(8, 13, 3, 10, body.dark);
  px.frame(10, 11, 12, 21, body.deep);
}

function paintCart(px: PixelBuffer): void {
  px.rect(1, 8, 28, 10, WOOD.base);
  for (let x = 4; x < 29; x += 6) px.vline(x, 8, 10, WOOD.dark);
  px.hline(1, 8, 28, WOOD.light);
  px.frame(1, 8, 28, 10, WOOD.deep);
  // Load of hay.
  px.rect(3, 2, 24, 7, 0xd8c07a);
  for (let x = 4; x < 27; x += 3) px.vline(x, 3, 5, 0xf0dc9c);
  px.hline(3, 2, 24, 0xa8904f);
  // Wheels and the shaft.
  for (const cx of [7, 23]) {
    px.rect(cx - 4, 17, 9, 9, WOOD.deep);
    px.rect(cx - 3, 18, 7, 7, WOOD.dark);
    px.set(cx, 21, IRON.light);
  }
  px.hline(29, 15, 3, WOOD.dark);
}

function paintFurnace(px: PixelBuffer): void {
  px.rect(2, 6, 28, 25, STONE.dark);
  for (let y = 8; y < 30; y += 4) {
    px.hline(2, y, 28, STONE.deep);
    for (let x = y % 8 ? 4 : 8; x < 30; x += 8) px.vline(x, y + 1, 3, STONE.deep);
  }
  px.rect(8, 16, 16, 12, 0x1c1c20);
  px.rect(10, 20, 12, 8, 0xe08a3c);
  px.rect(12, 22, 8, 6, 0xfff1b0);
  px.hline(8, 16, 16, STONE.light);
  px.rect(20, 0, 7, 7, STONE.base);
  px.hline(20, 0, 7, IRON.base);
  px.frame(1, 5, 30, 27, STONE.deep);
}

function paintRack(px: PixelBuffer): void {
  for (const x of [3, 27]) px.rect(x, 4, 2, 26, WOOD.dark);
  px.hline(3, 8, 26, WOOD.base);
  px.hline(3, 24, 26, WOOD.base);
  // Blades leaning in the rack.
  for (const x of [8, 13, 18, 23]) {
    px.vline(x, 2, 22, 0xd9dde3);
    px.vline(x + 1, 3, 20, 0x8a8f96);
    px.hline(x - 1, 20, 4, 0xa8862c);
    px.rect(x, 21, 2, 4, 0x6e4a2e);
  }
  px.rect(2, 28, 28, 3, WOOD.deep);
}

function paintBoulder(px: PixelBuffer): void {
  const stone = tones(0x6b6570);
  px.rect(4, 8, 24, 22, stone.base);
  px.rect(7, 4, 18, 6, stone.base);
  px.rect(8, 6, 10, 6, stone.light);
  px.rect(18, 18, 8, 10, stone.dark);
  px.hline(5, 29, 22, stone.deep);
  px.outline(stone.deep);
}

function paintSpout(px: PixelBuffer): void {
  const stone = tones(0xc7ccd1);
  px.rect(5, 18, 6, 12, stone.base);
  px.rect(3, 26, 10, 4, stone.dark);
  px.rect(6, 10, 4, 8, stone.light);
  // Water arcing out and falling back.
  for (const [x, y] of [[4, 8], [3, 10], [2, 13], [11, 8], [12, 10], [13, 13], [7, 5], [8, 4], [8, 6]]) {
    px.set(x, y, 0x9fd0ea);
  }
  px.rect(7, 7, 2, 3, 0xc6e6f5);
  px.outline(stone.deep);
}

function paintBannerPole(px: PixelBuffer, color: number): void {
  const cloth = tones(color);
  px.rect(3, 1, 2, 30, IRON.base);
  px.set(3, 0, 0xe7c24a);
  px.set(4, 0, 0xe7c24a);
  px.rect(5, 3, 9, 13, cloth.base);
  px.vline(5, 3, 13, cloth.dark);
  px.hline(5, 3, 9, cloth.light);
  for (let x = 5; x < 14; x += 2) px.set(x, 16, cloth.base);
  px.rect(8, 7, 3, 3, 0xe7c24a);
  px.rect(1, 29, 6, 2, IRON.dark);
}

function paintBrazier(px: PixelBuffer): void {
  px.rect(7, 16, 2, 13, IRON.base);
  px.rect(4, 28, 8, 3, IRON.dark);
  px.rect(3, 11, 10, 5, IRON.base);
  px.hline(3, 11, 10, IRON.light);
  px.rect(5, 6, 6, 5, 0xe08a3c);
  px.rect(6, 4, 4, 5, 0xfff1b0);
  px.set(7, 2, 0xe08a3c);
  px.set(9, 3, 0xe08a3c);
}

function paintFountain(px: PixelBuffer): void {
  const rim = tones(0xc7ccd1);
  // Basin: a stone rim around a pool, seen from above and a little in front.
  px.rect(2, 12, 60, 34, rim.base);
  px.rect(0, 16, 64, 26, rim.base);
  px.rect(6, 16, 52, 20, 0x4a8fc4);
  px.rect(4, 20, 56, 12, 0x4a8fc4);
  for (let x = 8; x < 56; x += 7) px.hline(x, 22 + (x % 3), 4, 0x9fd0ea);
  px.hline(6, 16, 52, 0x2d4a78);
  px.rect(2, 38, 60, 6, rim.dark);
  for (let x = 4; x < 62; x += 8) px.vline(x, 38, 6, rim.deep);
  px.hline(2, 12, 60, rim.light);
  // Centre column and its jets.
  px.rect(28, 6, 8, 22, rim.light);
  px.rect(26, 26, 12, 4, rim.dark);
  px.rect(24, 4, 16, 3, rim.base);
  px.hline(24, 4, 16, rim.light);
  for (const [x, y] of [[22, 6], [20, 9], [19, 13], [18, 17], [41, 6], [43, 9], [44, 13], [45, 17], [31, 1], [32, 0], [33, 2]]) {
    px.set(x, y, 0xc6e6f5);
    px.set(x, y + 1, 0x9fd0ea);
  }
  px.outline(rim.deep);
}

const CHAR = tones(0x5a4232);

function paintDeadTree(px: PixelBuffer): void {
  // Trunk and root flare.
  px.rect(6, 12, 4, 18, CHAR.base);
  px.vline(6, 12, 18, CHAR.light);
  px.vline(9, 12, 18, CHAR.dark);
  px.rect(4, 28, 8, 2, CHAR.base);
  px.set(3, 29, CHAR.dark);
  px.set(12, 29, CHAR.dark);
  // Bare limbs, thick at the trunk and thinning out.
  const limbs: [number, number][][] = [
    [[6, 13], [5, 12], [4, 11], [3, 10], [3, 9], [2, 8], [2, 7]],
    [[9, 12], [10, 11], [11, 10], [12, 9], [12, 8], [13, 7], [13, 6]],
    [[7, 11], [7, 10], [8, 9], [8, 8], [7, 7], [7, 6], [8, 5], [8, 4]],
    [[4, 10], [5, 9], [5, 8]],
    [[11, 9], [10, 8], [10, 7]],
  ];
  limbs.forEach((limb, i) => limb.forEach(([x, y], j) => {
    px.set(x, y, j < 2 && i < 3 ? CHAR.base : CHAR.dark);
    if (j < 3 && i < 3) px.set(x + 1, y, CHAR.dark);
  }));
  px.outline(CHAR.deep);
}

function paintEmberRock(px: PixelBuffer): void {
  const rock = tones(0x3e3434);
  px.rect(3, 6, 10, 8, rock.base);
  px.rect(4, 4, 8, 3, rock.base);
  px.rect(5, 5, 5, 2, rock.light);
  px.hline(3, 13, 10, rock.dark);
  for (const [x, y] of [[6, 8], [7, 9], [8, 9], [9, 10], [10, 11], [5, 11], [4, 12]]) px.set(x, y, 0xe0602a);
  px.set(8, 9, 0xffb050);
  px.outline(rock.deep);
}

function paintVent(px: PixelBuffer): void {
  const ash = tones(0x4a3a34);
  px.rect(4, 10, 8, 4, ash.base);
  px.rect(3, 11, 10, 2, ash.base);
  px.hline(4, 13, 8, ash.dark);
  px.rect(6, 11, 4, 2, 0xd8561f);
  px.set(7, 11, 0xffb050);
  px.set(8, 12, 0xffb050);
  // A wisp of smoke drifting up.
  for (const [x, y] of [[7, 8], [6, 7], [7, 6], [8, 5], [8, 4], [9, 3]]) px.set(x, y, 0x8a8a8a);
  px.set(7, 5, 0xb0b0b0);
}

function paintBones(px: PixelBuffer): void {
  const bone = 0xe6d9bc;
  px.rect(5, 7, 5, 4, bone);
  px.rect(6, 11, 3, 1, bone);
  px.set(6, 8, 0x3a3030);
  px.set(8, 8, 0x3a3030);
  px.hline(9, 12, 5, 0xd8cba8);
  px.set(9, 11, bone);
  px.set(13, 11, bone);
  px.set(9, 13, bone);
  px.set(13, 13, bone);
  for (const [x, y] of [[2, 14], [3, 13], [4, 12]]) px.set(x, y, 0xd8cba8);
  px.outline(0x5a5040);
}

function paintTent(px: PixelBuffer, color: number): void {
  const hide = tones(color);
  for (let y = 4; y <= 28; y++) {
    const half = Math.round(((y - 4) * 13) / 24);
    px.hline(16 - half, y, half, hide.light);
    px.hline(16, y, half + 1, hide.base);
  }
  px.vline(16, 4, 25, hide.dark);
  for (let y = 18; y <= 28; y++) {
    const half = Math.round(((y - 18) * 4) / 10);
    px.hline(16 - half, y, half * 2 + 1, 0x2a1e18);
  }
  for (const [x, y] of [[15, 3], [14, 2], [13, 1], [17, 3], [18, 2], [19, 1]]) px.set(x, y, CHAR.base);
  px.hline(3, 29, 27, hide.dark);
  px.outline(hide.deep);
}

function paintCave(px: PixelBuffer): void {
  const rock = tones(0x5b4d47);
  px.rect(0, 2, 32, 30, rock.base);
  px.rect(2, 0, 28, 3, rock.base);
  px.hline(2, 0, 28, rock.light);
  for (const [x, y] of [[3, 6], [27, 5], [4, 20], [28, 18], [2, 27], [29, 28]]) px.rect(x, y, 2, 1, rock.dark);
  // The dark mouth under an arched top.
  px.rect(9, 12, 14, 20, 0x0e0a0a);
  px.rect(11, 10, 10, 2, 0x0e0a0a);
  // Timber props and lintel.
  px.rect(7, 11, 3, 21, WOOD.base);
  px.vline(7, 11, 21, WOOD.light);
  px.rect(22, 11, 3, 21, WOOD.base);
  px.vline(24, 11, 21, WOOD.dark);
  px.rect(6, 8, 20, 3, WOOD.base);
  px.hline(6, 8, 20, WOOD.light);
  px.hline(6, 10, 20, WOOD.dark);
  px.outline(rock.deep);
}

function paintBoat(px: PixelBuffer): void {
  const insets = [4, 2, 1, 0, 0, 1, 2, 4];
  insets.forEach((inset, i) => px.hline(inset, 6 + i, 32 - inset * 2, WOOD.base));
  px.hline(4, 6, 24, WOOD.light);
  px.rect(4, 8, 24, 4, WOOD.dark);
  px.rect(15, 8, 2, 4, WOOD.base);
  px.hline(4, 13, 24, WOOD.deep);
  for (let i = 0; i < 12; i++) px.set(7 + i, 4 + Math.floor(i / 6), WOOD.light);
  px.outline(0x3b2a1e);
}

function paintPalm(px: PixelBuffer): void {
  const bark = tones(0x9b7a4a);
  for (let y = 12; y < 31; y++) {
    const x = 7 + (y < 20 ? 1 : 0);
    px.hline(x, y, 2, y % 3 === 0 ? bark.dark : bark.base);
  }
  px.rect(6, 30, 4, 1, bark.dark);
  const leaf = tones(0x4f8a4b);
  const fronds: [number, number][] = [[1, 8], [2, 4], [7, 1], [13, 4], [14, 8], [12, 12], [3, 12]];
  for (const [tx, ty] of fronds) {
    for (let i = 0; i <= 6; i++) {
      const x = Math.round(8 + ((tx - 8) * i) / 6);
      const y = Math.round(9 + ((ty - 9) * i) / 6);
      px.set(x, y, i > 3 ? leaf.dark : leaf.base);
      px.set(x, y + 1, leaf.dark);
    }
  }
  px.set(7, 11, 0x6e4a2e);
  px.set(9, 11, 0x6e4a2e);
  px.outline(0x1f2a18);
}

function paintBigOak(px: PixelBuffer): void {
  const bark = tones(0x6e4a2e);
  const leaf = tones(0x4f8a4b);
  px.rect(20, 30, 8, 16, bark.base);
  px.vline(20, 30, 16, bark.light);
  px.vline(27, 30, 16, bark.dark);
  px.rect(16, 44, 16, 3, bark.base);
  px.set(15, 46, bark.dark);
  px.set(32, 46, bark.dark);
  const disc = (cx: number, cy: number, r: number, color: number): void => {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) px.set(cx + x, cy + y, color);
  };
  for (const [cx, cy, r] of [[24, 18, 15], [12, 22, 10], [36, 22, 10], [18, 11, 9], [31, 11, 9]] as const) disc(cx, cy, r, leaf.dark);
  for (const [cx, cy, r] of [[24, 16, 12], [13, 20, 7], [35, 20, 7], [19, 10, 6], [30, 10, 6]] as const) disc(cx, cy, r, leaf.base);
  for (const [cx, cy, r] of [[20, 10, 3], [29, 9, 3], [12, 17, 2], [24, 13, 4]] as const) disc(cx, cy, r, leaf.light);
  px.outline(0x1f2a18);
}

// -----------------------------------------------------------------------------
//  AUTO-CONNECTING PIECES
// -----------------------------------------------------------------------------

/** Neighbour mask bits: N=1, E=2, S=4, W=8. */
export function fencePixels(mask: number): PixelBuffer {
  const px = new PixelBuffer(16, 16);
  const rail = WOOD.base;
  if (mask & 8) { px.rect(0, 6, 8, 2, rail); px.rect(0, 11, 8, 2, rail); }
  if (mask & 2) { px.rect(8, 6, 8, 2, rail); px.rect(8, 11, 8, 2, rail); }
  if (mask & 1) px.rect(7, 0, 2, 6, rail);
  if (mask & 4) px.rect(7, 12, 2, 4, rail);
  px.rect(6, 3, 4, 12, WOOD.light);
  px.vline(9, 3, 12, WOOD.dark);
  px.hline(6, 3, 4, WOOD.dark);
  px.outline(0x3b2a1e);
  return px;
}

/** A city wall block: a lit top course over a battered stone face. */
export function wallPixels(mask: number, stone = 0x9a9ea6): PixelBuffer {
  const s = tones(stone);
  const px = new PixelBuffer(16, 16);
  const openSouth = !(mask & 4);
  px.rect(0, 0, 16, 16, s.base);
  // Top walk and crenels when nothing sits north.
  px.rect(0, 0, 16, 5, s.light);
  if (!(mask & 1)) {
    px.rect(0, 0, 16, 2, s.dark);
    px.rect(2, 0, 4, 2, s.light);
    px.rect(10, 0, 4, 2, s.light);
  }
  px.hline(0, 5, 16, s.dark);
  // Brick courses on the face.
  for (let y = 6, row = 0; y < 16; y += 4, row++) {
    px.hline(0, y + 3, 16, s.dark);
    for (let x = row % 2 ? 3 : 7; x < 16; x += 8) px.vline(x, y, 3, s.dark);
  }
  if (!(mask & 8)) px.vline(0, 0, 16, s.deep);
  if (!(mask & 2)) px.vline(15, 0, 16, s.deep);
  if (openSouth) px.hline(0, 15, 16, s.deep);
  return px;
}

/** Molten rock, two frames for a slow crawl. `mask` marks lava neighbours; open sides get a cooled crust. */
export function lavaPixels(frame: number, mask = 15): PixelBuffer {
  const px = new PixelBuffer(16, 16);
  px.rect(0, 0, 16, 16, 0xd8561f);
  const spots: [number, number][] = [[2, 3], [9, 1], [12, 8], [5, 11], [13, 13], [1, 8]];
  spots.forEach(([x, y], i) => {
    const dx = (x + frame * 2 + i) % 16;
    px.rect(dx, y, 3, 2, 0xf4a23a);
    px.set((dx + 1) % 16, y, 0xffe08a);
  });
  const crust: [number, number][] = [[6, 5], [11, 3], [3, 14], [14, 10]];
  crust.forEach(([x, y]) => px.rect((x + 16 - frame) % 16, y, 2, 1, 0x7a2a12));
  const rim = (x: number, y: number, w: number, h: number, inner: [number, number, number, number]): void => {
    px.rect(x, y, w, h, 0x3a1c12);
    px.rect(...inner, 0x9a3a18);
  };
  if (!(mask & 1)) rim(0, 0, 16, 2, [0, 2, 16, 1]);
  if (!(mask & 4)) rim(0, 14, 16, 2, [0, 13, 16, 1]);
  if (!(mask & 8)) rim(0, 0, 2, 16, [2, 0, 1, 16]);
  if (!(mask & 2)) rim(14, 0, 2, 16, [13, 0, 1, 16]);
  return px;
}

/** Planks laid across water, or dressed stone across lava. `vertical` runs them north-south. */
export function bridgePixels(vertical: boolean, stone = false): PixelBuffer {
  const px = new PixelBuffer(16, 16);
  const deck = stone ? tones(0x8a8480) : WOOD;
  if (vertical) {
    px.rect(2, 0, 12, 16, deck.base);
    for (let y = 3; y < 16; y += 4) px.hline(2, y, 12, deck.dark);
    if (stone) for (let y = 1; y < 16; y += 4) px.vline(y % 8 === 1 ? 6 : 10, y, 2, deck.dark);
    px.rect(1, 0, 2, 16, deck.deep);
    px.rect(13, 0, 2, 16, deck.deep);
  } else {
    px.rect(0, 2, 16, 12, deck.base);
    for (let x = 3; x < 16; x += 4) px.vline(x, 2, 12, deck.dark);
    if (stone) for (let x = 1; x < 16; x += 4) px.hline(x, x % 8 === 1 ? 6 : 10, 2, deck.dark);
    px.rect(0, 1, 16, 2, deck.deep);
    px.rect(0, 13, 16, 2, deck.deep);
  }
  return px;
}

/**
 * Raised rock: mountains, crags and ravine walls. `mask` marks rock
 * neighbours; open tops catch the light and open fronts show a sheer face.
 */
export function cliffPixels(mask: number, variant = 0): PixelBuffer {
  const rock = tones(0x5b4d47);
  const px = new PixelBuffer(16, 16);
  px.rect(0, 0, 16, 16, rock.base);
  // Grit, placed by the variant so neighbouring blocks differ.
  for (let i = 0; i < 7; i++) {
    const x = (variant * 5 + i * 7) % 15;
    const y = (variant * 3 + i * 5) % 13;
    px.set(x, y, i % 2 ? rock.light : rock.dark);
    if (i % 3 === 0) px.set(x + 1, y, rock.dark);
  }
  if (!(mask & 1)) {
    px.hline(0, 0, 16, tint(rock.light, 0.2));
    px.hline(0, 1, 16, rock.light);
  }
  if (!(mask & 8)) px.vline(0, 0, 16, rock.dark);
  if (!(mask & 2)) px.vline(15, 0, 16, rock.deep);
  if (!(mask & 4)) {
    // The face drops away to the south.
    px.rect(0, 9, 16, 7, rock.dark);
    for (let x = (variant % 3) + 1; x < 16; x += 3) px.vline(x, 10, 5, rock.deep);
    px.hline(0, 9, 16, rock.base);
    px.hline(0, 15, 16, shade(rock.deep, 0.3));
  }
  return px;
}

/** A soft shadow blob to seat objects on the ground. */
export function shadowPixels(w: number): PixelBuffer {
  const px = new PixelBuffer(w, 4);
  px.rect(2, 0, w - 4, 4, 0x000000);
  px.rect(0, 1, w, 2, 0x000000);
  return px;
}
