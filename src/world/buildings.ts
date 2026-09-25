// Town buildings, painted pixel by pixel in the flat, softly outlined style of
// the Kenney ground tiles they stand on. A spec picks materials and fittings;
// the painter lays roof, wall, door, windows and the shop's hanging sign.

import { PixelBuffer, shade, tint, tones, type Palette, type Tones } from './pixels';

export type RoofColor = 'red' | 'blue' | 'green' | 'slate' | 'thatch' | 'plum' | 'rust' | 'teal' | 'charcoal';
export type WallKind = 'plaster' | 'stone' | 'wood' | 'brick' | 'darkwood' | 'sandstone';
export type SignIcon =
  | 'guild'
  | 'potion'
  | 'sword'
  | 'shield'
  | 'ring'
  | 'gem'
  | 'coin'
  | 'anvil'
  | 'bow'
  | 'leaf'
  | 'pick'
  | 'pearl'
  | 'sun'
  | 'drop'
  | 'none';

export interface BuildingSpec {
  /** Width in tiles. */
  w: number;
  /** Height in tiles, roof and wall together. */
  h: number;
  /** Tiles of wall under the roof. */
  wallRows?: number;
  roof: RoofColor;
  wall: WallKind;
  /** Door column, counted in tiles from the left. Omit for a closed house. */
  door?: number;
  windows?: number[];
  /** Small windows set into the roof. */
  dormers?: number[];
  chimney?: number;
  sign?: SignIcon;
  /** Striped cloth over the door, in this colour. */
  awning?: number;
  /** Hanging banners either side of the door, in this colour. */
  banner?: number;
}

const ROOFS: Record<RoofColor, number> = {
  red: 0xb34a3c,
  blue: 0x4a6fa8,
  green: 0x4f8a4b,
  slate: 0x6b7280,
  thatch: 0xc9a24f,
  plum: 0x6a4a6e,
  rust: 0xb0602e,
  teal: 0x3f8a86,
  charcoal: 0x4a4650,
};

const WALLS: Record<WallKind, number> = {
  plaster: 0xe6d9bc,
  stone: 0xa7acb2,
  wood: 0x9b6b43,
  brick: 0xa65a45,
  darkwood: 0x5d4838,
  sandstone: 0xd2b98a,
};

const TIMBER = tones(0x6e4a2e);
const PLINTH = tones(0x8a8f96);
const GLASS = { base: 0x6fa9cf, light: 0xc6e6f5, dark: 0x3f6f95 };
const DOOR = tones(0x7a4f2e);
const GOLD = 0xe7c24a;
const IRON = 0x3a3a42;

export function buildingPixels(spec: BuildingSpec): PixelBuffer {
  const W = spec.w * 16;
  const H = spec.h * 16;
  const wallH = (spec.wallRows ?? 2) * 16;
  const roofH = H - wallH;
  const px = new PixelBuffer(W, H);
  const roof = tones(ROOFS[spec.roof]);
  const wall = tones(WALLS[spec.wall]);

  paintWall(px, spec, wall, roofH, W, H);
  paintRoof(px, spec, roof, W, roofH);
  if (spec.chimney != null) paintChimney(px, spec.chimney * 16 + 4, roof);
  for (const col of spec.dormers ?? []) paintDormer(px, col * 16 + 4, Math.max(4, roofH - 14), roof);
  for (const col of spec.windows ?? []) paintWindow(px, col * 16 + 3, roofH + 7, wall, roof);
  if (spec.door != null) {
    const doorX = spec.door * 16 + 3;
    if (spec.banner != null) paintBanners(px, doorX, roofH + 4, spec.banner);
    paintDoor(px, doorX, H, spec.wall === 'stone' || spec.wall === 'sandstone' ? wall.base : null);
    if (spec.awning != null) paintAwning(px, Math.max(2, doorX - 7), roofH + 1, 24, spec.awning);
    if (spec.sign && spec.sign !== 'none') {
      const right = spec.door < spec.w - 1;
      paintSign(px, right ? doorX + 12 : doorX - 15, roofH + 3, spec.sign, right);
    }
  }
  return px;
}

function paintRoof(px: PixelBuffer, spec: BuildingSpec, roof: Tones, W: number, roofH: number): void {
  const upper = tint(roof.base, 0.1);
  px.rect(0, 0, W, roofH, roof.base);
  px.rect(0, 0, W, Math.floor(roofH / 2), upper);
  // Shingle courses with staggered joints.
  for (let y = 3, row = 0; y < roofH - 3; y += 4, row++) {
    px.hline(0, y + 3, W, roof.dark);
    for (let x = row % 2 ? 2 : 6; x < W; x += 8) px.vline(x, y, 3, shade(roof.base, 0.14));
    px.hline(0, y, W, y < roofH / 2 ? tint(upper, 0.08) : roof.base);
  }
  // Ridge, gable edges and the shadow the eave throws on the wall.
  px.rect(0, 0, W, 2, roof.dark);
  px.hline(0, 2, W, roof.light);
  px.vline(0, 0, roofH, roof.deep);
  px.vline(W - 1, 0, roofH, roof.deep);
  px.hline(0, roofH - 2, W, roof.dark);
  px.hline(0, roofH - 1, W, roof.deep);
  if (spec.roof === 'thatch') {
    for (let x = 1; x < W - 1; x += 3) px.set(x, roofH - 1, roof.dark);
  }
}

function paintWall(px: PixelBuffer, spec: BuildingSpec, wall: Tones, top: number, W: number, H: number): void {
  const x0 = 2;
  const x1 = W - 3;
  const w = x1 - x0 + 1;
  px.rect(x0, top, w, H - top, wall.base);
  switch (spec.wall) {
    case 'stone':
    case 'sandstone':
      for (let y = top + 2, row = 0; y < H - 3; y += 4, row++) {
        px.hline(x0, y + 3, w, wall.dark);
        for (let x = x0 + (row % 2 ? 3 : 7); x < x1; x += 8) px.vline(x, y, 3, wall.dark);
        px.hline(x0, y, w, tint(wall.base, 0.12));
      }
      break;
    case 'brick':
      for (let y = top + 2, row = 0; y < H - 3; y += 3, row++) {
        px.hline(x0, y + 2, w, tint(wall.base, 0.35));
        for (let x = x0 + (row % 2 ? 2 : 5); x < x1; x += 6) px.vline(x, y, 2, tint(wall.base, 0.35));
      }
      break;
    case 'wood':
    case 'darkwood':
      for (let x = x0 + 3; x < x1; x += 4) px.vline(x, top, H - top, wall.dark);
      for (let x = x0 + 1; x < x1; x += 8) px.vline(x, top + 5, 2, wall.light);
      break;
    case 'plaster': {
      const beams = [x0, x1 - 1];
      for (let x = x0 + 24; x < x1 - 8; x += 24) beams.push(x);
      for (const x of beams) px.rect(x, top, 2, H - top, TIMBER.base);
      px.rect(x0, H - 10, w, 2, TIMBER.base);
      for (let x = x0 + 5; x < x1; x += 11) px.set(x, top + 6, wall.dark);
      break;
    }
  }
  // Corners, the eave shadow and a stone plinth along the ground.
  px.vline(x0, top, H - top, wall.deep);
  px.vline(x1, top, H - top, wall.deep);
  px.hline(x0, top, w, shade(wall.base, 0.4));
  px.hline(x0, top + 1, w, wall.dark);
  px.rect(x0, H - 3, w, 3, PLINTH.base);
  px.hline(x0, H - 3, w, PLINTH.light);
  px.hline(x0, H - 1, w, PLINTH.dark);
}

function paintChimney(px: PixelBuffer, x: number, roof: Tones): void {
  const brick = tones(0x9a5a48);
  px.rect(x, 0, 8, 11, brick.base);
  for (let y = 2; y < 11; y += 3) px.hline(x, y, 8, brick.light);
  px.rect(x - 1, 0, 10, 2, IRON);
  px.vline(x, 0, 11, brick.dark);
  px.vline(x + 7, 0, 11, brick.dark);
  px.hline(x, 11, 8, roof.deep);
}

function paintDormer(px: PixelBuffer, x: number, y: number, roof: Tones): void {
  px.rect(x - 1, y - 2, 10, 2, roof.dark);
  px.rect(x, y, 8, 8, 0xe9dfc8);
  px.rect(x + 1, y + 1, 6, 6, GLASS.base);
  px.set(x + 2, y + 2, GLASS.light);
  px.vline(x + 4, y + 1, 6, 0xe9dfc8);
  px.hline(x, y + 8, 8, roof.deep);
}

function paintWindow(px: PixelBuffer, x: number, y: number, wall: Tones, roof: Tones): void {
  const frame = shade(wall.base, 0.45);
  px.rect(x - 2, y, 2, 10, roof.dark);
  px.rect(x + 10, y, 2, 10, roof.dark);
  px.rect(x, y, 10, 10, frame);
  px.rect(x + 1, y + 1, 8, 8, GLASS.base);
  px.hline(x + 1, y + 1, 8, GLASS.dark);
  px.set(x + 2, y + 3, GLASS.light);
  px.set(x + 3, y + 2, GLASS.light);
  px.set(x + 6, y + 6, GLASS.light);
  px.vline(x + 5, y + 1, 8, frame);
  px.hline(x + 1, y + 5, 8, frame);
  px.rect(x - 1, y + 10, 12, 2, tint(wall.base, 0.25));
  px.hline(x - 1, y + 12, 12, wall.deep);
}

function paintDoor(px: PixelBuffer, x: number, H: number, archFill: number | null): void {
  const top = H - 22;
  px.rect(x - 1, top - 1, 12, 23, shade(DOOR.base, 0.55));
  px.rect(x, top, 10, 21, DOOR.base);
  for (let dx = 2; dx < 10; dx += 3) px.vline(x + dx, top + 1, 20, DOOR.dark);
  px.hline(x, top + 5, 10, DOOR.dark);
  px.hline(x, top + 14, 10, DOOR.dark);
  px.set(x + 7, top + 11, GOLD);
  px.set(x + 7, top + 12, shade(GOLD, 0.3));
  if (archFill != null) {
    px.set(x, top, shade(DOOR.base, 0.55));
    px.set(x + 9, top, shade(DOOR.base, 0.55));
    px.set(x - 1, top - 1, archFill);
    px.set(x + 10, top - 1, archFill);
  }
  px.rect(x - 2, H - 2, 14, 2, 0xb8b2a6);
}

function paintAwning(px: PixelBuffer, x: number, y: number, w: number, color: number): void {
  const cloth = tones(color);
  for (let dx = 0; dx < w; dx++) {
    const stripe = Math.floor(dx / 4) % 2 === 0 ? cloth.base : 0xf1ebdc;
    px.vline(x + dx, y, 5, stripe);
    if (dx % 4 !== 3) px.set(x + dx, y + 5, stripe);
  }
  px.hline(x, y, w, cloth.dark);
  px.hline(x, y + 6, w, shade(0x6b5a48, 0.3));
  px.vline(x, y, 6, cloth.deep);
  px.vline(x + w - 1, y, 6, cloth.deep);
}

function paintBanners(px: PixelBuffer, doorX: number, y: number, color: number): void {
  const cloth = tones(color);
  for (const x of [doorX - 8, doorX + 12]) {
    px.rect(x - 1, y - 1, 8, 1, IRON);
    px.rect(x, y, 6, 13, cloth.base);
    px.vline(x, y, 13, cloth.dark);
    px.vline(x + 5, y, 13, cloth.dark);
    px.set(x + 2, y + 13, cloth.base);
    px.set(x + 3, y + 13, cloth.base);
    px.set(x + 2, y + 5, GOLD);
    px.set(x + 3, y + 5, GOLD);
    px.set(x + 2, y + 6, GOLD);
    px.set(x + 3, y + 6, GOLD);
  }
}

const ICONS: Record<Exclude<SignIcon, 'none'>, readonly string[]> = {
  guild: ['.aaaaa.', 'aawwwaa', 'aawaawa', 'aawwwaa', 'aawaaaa', '.aaaaa.', '..aaa..'],
  potion: ['..kk...', '..ww...', '.waaw..', 'waaaaw.', 'waaaaw.', 'waaaaw.', '.wwww..'],
  sword: ['......w', '.....w.', '....w..', 'k..w...', '.kw....', '.ak....', 'a..k...'],
  shield: ['aaaaaaa', 'awwawwa', 'awwawwa', 'aaaaaaa', 'awwawwa', '.awawa.', '..aaa..'],
  ring: ['..www..', '.w...w.', 'w.....w', 'w.....w', '.w...w.', '..www..', '...a...'],
  gem: ['.aaaaa.', 'awawawa', 'aaaaaaa', '.aaaaa.', '..aaa..', '...a...', '.......'],
  coin: ['..aaa..', '.aawaa.', 'aawaaaa', 'aaaaaaa', 'aaaaaaa', '.aaaaa.', '..aaa..'],
  anvil: ['.......', 'kkkkkk.', 'kwwwwkk', '.kkkk..', '..kk...', '.kkkk..', 'kkkkkk.'],
  bow: ['.aa....', 'a..k...', 'a...k..', 'awwwwwk', 'a...k..', 'a..k...', '.aa....'],
  leaf: ['....aa.', '...aaaa', '..aawaa', '.aawaa.', 'aawaa..', '.waa...', 'w......'],
  pick: ['.kkkkk.', 'k..a..k', '...a...', '...a...', '...a...', '...a...', '...a...'],
  pearl: ['.......', '.aaaaa.', 'aa...aa', 'a.www.a', 'a.www.a', 'aaaaaaa', '.......'],
  sun: ['a..a..a', '.aaaaa.', '.awwwa.', 'aawwwaa', '.awwwa.', '.aaaaa.', 'a..a..a'],
  drop: ['...a...', '..aaa..', '..aaa..', '.aawaa.', '.awwaa.', '.aaaaa.', '..aaa..'],
};

const ICON_ACCENT: Record<Exclude<SignIcon, 'none'>, number> = {
  guild: 0xb34a3c,
  potion: 0x8a3fb0,
  sword: 0x8b5a2b,
  shield: 0x3f66a8,
  ring: GOLD,
  gem: 0x3fb0c7,
  coin: GOLD,
  anvil: IRON,
  bow: 0x8b5a2b,
  leaf: 0x4f8a4b,
  pick: 0x9b6b43,
  pearl: 0x3f8a86,
  sun: GOLD,
  drop: 0x3f8ad0,
};

function paintSign(px: PixelBuffer, x: number, y: number, icon: Exclude<SignIcon, 'none'>, right: boolean): void {
  const board = tones(0xa8784a);
  const bracketX = right ? x - 1 : x + 12;
  px.hline(right ? x - 3 : x + 11, y, 5, IRON);
  px.vline(bracketX, y, 2, IRON);
  px.rect(x, y + 2, 12, 11, board.dark);
  px.rect(x + 1, y + 3, 10, 9, board.light);
  const palette: Palette = { a: ICON_ACCENT[icon], w: 0xf4f1e6, k: IRON };
  px.blit(ICONS[icon], palette, x + 2, y + 4);
}
