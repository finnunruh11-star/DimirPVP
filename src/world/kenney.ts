// The Kenney Roguelike/RPG sheet (CC0): 57 x 31 tiles of 16px with 1px spacing.
// Only ground and nature come from the sheet; buildings, props and people are
// drawn in code (see pixelArt.ts), so every frame used here is named below.
// Pure: the sheet URL is imported by the renderer, so tests can load this file.

export const KENNEY_KEY = 'kenney-rpg';
export const KENNEY_FRAME = { frameWidth: 16, frameHeight: 16, spacing: 1 } as const;
export const KENNEY_COLS = 57;
/** On-screen size of one 16px tile. */
export const TILE_SCALE = 3;
export const TILE_PX = 16 * TILE_SCALE;

export const k = (col: number, row: number): number => row * KENNEY_COLS + col;

/** A ground that tiles by itself: pick among variants by position. */
export const FILLS = {
  grass: [k(5, 0), k(5, 1)],
  dirt: [k(6, 0), k(6, 1)],
  stone: [k(7, 0), k(7, 1)],
  sand: [k(8, 0), k(8, 1)],
  olive: [k(0, 6), k(1, 6), k(0, 7), k(1, 7)],
  sage: [k(0, 9), k(1, 9), k(0, 10), k(1, 10)],
  moss: [k(0, 12), k(1, 12), k(0, 13), k(1, 13)],
  meadow: [k(0, 15), k(1, 15), k(0, 16), k(1, 16)],
  ember: [k(0, 18), k(1, 18), k(0, 19), k(1, 19)],
  blight: [k(0, 21), k(1, 21), k(0, 22), k(1, 22)],
  water: [k(0, 0), k(1, 0), k(3, 1)],
} as const;

export type FillKind = keyof typeof FILLS;

/** One autotile family: a 1-wide path set plus a wide 3x3 set with inner corners. */
export interface AutotileSet {
  narrow?: Record<number, number>;
  wide: {
    tl: number; t: number; tr: number;
    l: number; c: number; r: number;
    bl: number; b: number; br: number;
    /** Inner corners, named for the corner that is cut away. */
    notchTL: number; notchTR: number; notchBL: number; notchBR: number;
  };
}

// Neighbour bits for the 1-wide path set.
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

function pathSet(base: number): AutotileSet {
  const r = base;
  return {
    narrow: {
      0: k(8, r + 5),
      [N]: k(5, r + 4),
      [S]: k(6, r + 4),
      [W]: k(5, r + 5),
      [E]: k(6, r + 5),
      [N | S]: k(9, r),
      [E | W]: k(9, r + 1),
      [E | S]: k(7, r),
      [W | S]: k(8, r),
      [N | E]: k(7, r + 1),
      [N | W]: k(8, r + 1),
      [E | S | W]: k(5, r),
      [N | S | W]: k(6, r),
      [N | E | S]: k(5, r + 1),
      [N | E | W]: k(6, r + 1),
      [N | E | S | W]: k(7, r + 5),
    },
    wide: {
      tl: k(7, r + 2), t: k(8, r + 2), tr: k(9, r + 2),
      l: k(7, r + 3), c: k(8, r + 3), r: k(9, r + 3),
      bl: k(7, r + 4), b: k(8, r + 4), br: k(9, r + 4),
      notchBR: k(5, r + 2), notchBL: k(6, r + 2), notchTR: k(5, r + 3), notchTL: k(6, r + 3),
    },
  };
}

export const AUTOTILES = {
  dirt: pathSet(7),
  stone: pathSet(13),
  sand: pathSet(19),
  water: {
    wide: {
      tl: k(2, 0), t: k(3, 0), tr: k(4, 0),
      l: k(2, 1), c: k(3, 1), r: k(4, 1),
      bl: k(2, 2), b: k(3, 2), br: k(4, 2),
      notchBR: k(0, 1), notchBL: k(1, 1), notchTR: k(0, 2), notchTL: k(1, 2),
    },
  },
  pool: {
    wide: {
      tl: k(2, 3), t: k(3, 3), tr: k(4, 3),
      l: k(2, 4), c: k(3, 4), r: k(4, 4),
      bl: k(2, 5), b: k(3, 5), br: k(4, 5),
      notchBR: k(0, 3), notchBL: k(1, 3), notchTR: k(0, 4), notchTL: k(1, 4),
    },
  },
} satisfies Record<string, AutotileSet>;

export type AutotileKind = keyof typeof AUTOTILES;

/** 3x3 overlay patches (rounded blobs laid on a fill), for ground variety. */
export function patchFrames(groupRow: number): number[][] {
  return [0, 1, 2].map((dy) => [2, 3, 4].map((col) => k(col, groupRow + dy)));
}

export const NATURE = {
  treeRound: k(13, 9),
  treeRoundAutumn: k(14, 9),
  treeRoundDark: k(15, 9),
  treeTall: [k(13, 10), k(13, 11)],
  treeTallAutumn: [k(14, 10), k(14, 11)],
  treeTallDark: [k(15, 10), k(15, 11)],
  pine: k(16, 9),
  pineAutumn: k(17, 9),
  pineDark: k(18, 9),
  pineTall: [k(16, 10), k(16, 11)],
  pineTallAutumn: [k(17, 10), k(17, 11)],
  pineTallDark: [k(18, 10), k(18, 11)],
  bush: k(19, 9),
  bushAutumn: k(20, 9),
  bushDark: k(21, 9),
  hedgeTop: [k(19, 10), k(20, 10), k(21, 10)],
  hedgeBottom: [k(19, 11), k(20, 11), k(21, 11)],
  sapling: k(22, 9),
  tuft: [k(22, 10), k(22, 11), k(28, 10)],
  fruitTree: [k(23, 10), k(23, 11)],
  flowerBushBlue: k(24, 10),
  flowerBushPurple: k(24, 11),
  flowers: [k(25, 10), k(25, 11), k(28, 9), k(28, 11)],
  weeds: k(26, 9),
  pumpkin: k(26, 10),
  twigs: k(27, 9),
  stump: k(27, 10),
  logs: k(27, 11),
} as const;

export const KENNEY_PROPS = {
  signpost: [k(19, 0), k(20, 0), k(21, 0)],
  gravestones: [k(22, 0), k(23, 0), k(24, 0), k(25, 0), k(26, 0), k(27, 0)],
  anvil: k(15, 0),
  campfire: [k(13, 8), k(14, 8), k(15, 8)],
  torch: [k(16, 8), k(17, 8), k(18, 8)],
} as const;

/**
 * Pick the tile of a wide autotile from its neighbours. `at(dx, dy)` answers
 * whether the neighbour belongs to the same area.
 */
export function wideFrame(set: AutotileSet['wide'], at: (dx: number, dy: number) => boolean): number {
  const n = at(0, -1);
  const e = at(1, 0);
  const s = at(0, 1);
  const w = at(-1, 0);
  if (!n && !w) return set.tl;
  if (!n && !e) return set.tr;
  if (!s && !w) return set.bl;
  if (!s && !e) return set.br;
  if (!n) return set.t;
  if (!s) return set.b;
  if (!w) return set.l;
  if (!e) return set.r;
  if (!at(-1, -1)) return set.notchTL;
  if (!at(1, -1)) return set.notchTR;
  if (!at(-1, 1)) return set.notchBL;
  if (!at(1, 1)) return set.notchBR;
  return set.c;
}

export function narrowFrame(set: AutotileSet, mask: number): number {
  return set.narrow?.[mask & 15] ?? set.wide.c;
}

/** Stable per-cell variety without touching any gameplay RNG. */
export function cellHash(x: number, y: number, salt = 0): number {
  let h = Math.imul(x + 374761393, 668265263) ^ Math.imul(y + salt * 31 + 1442695041, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return (h ^ (h >>> 16)) >>> 0;
}

export function pickFill(kind: FillKind, x: number, y: number): number {
  const frames = FILLS[kind];
  // The first variant carries most of the ground; the rest only speckle it.
  const roll = cellHash(x, y, 7) % 100;
  return roll < 70 ? frames[0] : frames[1 + (roll % (frames.length - 1))];
}
