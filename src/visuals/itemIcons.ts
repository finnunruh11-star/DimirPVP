// A small picture for every item: 16x16 pixels, drawn from what kind of thing it
// is (a sword, a ring, a herb) and what it is made of (iron, gold, ruby). Pure:
// the pack and the inventory copy the pixels into textures, and a plain script
// can render the whole set to check it.

import { CRAFT_MATERIALS, CRAFT_TEMPLATES, type CraftForm } from '../core/crafting/data';
import { getItem, RARITY_COLOR, type ItemDef, type ItemId } from '../core/Items';
import { PixelBuffer, shade, tint } from '../world/pixels';

export const ITEM_ICON_SIZE = 16;

export type ItemIconKind =
  | 'sword' | 'dagger' | 'spear' | 'axe' | 'hammer' | 'club' | 'bow' | 'crossbow' | 'staff' | 'wand'
  | 'shield' | 'buckler' | 'lantern' | 'torch' | 'bell' | 'bolas'
  | 'helm' | 'hat' | 'circlet' | 'armor' | 'robe' | 'cloak' | 'wings' | 'boots'
  | 'ring' | 'bracelet' | 'amulet' | 'gloves' | 'bag' | 'chalice' | 'book' | 'bolt'
  | 'potion' | 'vial' | 'arrows' | 'ore' | 'gem' | 'leaf' | 'root' | 'mushroom'
  | 'pelt' | 'fang' | 'scale' | 'core' | 'crystal' | 'blob' | 'ingot' | 'eye' | 'trinket' | 'pickaxe' | 'map' | 'paper';

interface Tone {
  base: number;
  light: number;
  dark: number;
}

const tone = (base: number): Tone => ({ base, light: tint(base, 0.38), dark: shade(base, 0.4) });

const OUTLINE = 0x15100c;
const SHINE = 0xfff8e8;
const WOOD = tone(0x8a5a32);
const LEATHER = tone(0x7a4a2a);
const STRING = tone(0xd8cdb0);
const GLASS = tone(0x9fd0e0);

const METAL = {
  steel: tone(0xa7b1bc),
  iron: tone(0x8a9097),
  silver: tone(0xc9d2da),
  gold: tone(0xdcae3c),
  copper: tone(0xc4733c),
  dark: tone(0x4c5064),
  stone: tone(0x8a8274),
  glass: tone(0x9ad6ea),
  rot: tone(0x7f9a4e),
  ember: tone(0xd2632e),
  rune: tone(0x6f8fd8),
  bone: tone(0xd6cbac),
} as const;

const GEM_COLOR: Partial<Record<ItemId, number>> = {
  gemRuby: 0xd8404c,
  gemSapphire: 0x4572dc,
  gemEmerald: 0x3fbf6c,
  gemAmethyst: 0xa066d6,
  gemOnyx: 0x4e4858,
  gemDiamond: 0xd8f2ff,
  gemPearl: 0xf0ebe0,
};

const HERB_COLOR: Partial<Record<ItemId, number>> = {
  herbMoonglow: 0xdfe8f5,
  herbWaterleaf: 0x4a90e0,
  herbDeathweed: 0x7a4a8a,
  herbFireblossom: 0xf06a2a,
};

const GEL_COLOR: Partial<Record<ItemId, number>> = {
  slimeGel: 0x6cc84e,
  gelRed: 0xd85a48,
  gelBlue: 0x5a8ae0,
  gelBlack: 0x4a4452,
  gelWhite: 0xe8e8e0,
};

const ORE_FLECK: Partial<Record<ItemId, number>> = {
  oreCoal: 0x26262a,
  oreCopper: 0xd57a3a,
  oreIron: 0xb0603c,
  oreGold: 0xf0c848,
  redStone: 0xd8503a,
  pebble: 0x8a8478,
};

// ---------------------------------------------------------------------------
//  WHAT IT IS
// ---------------------------------------------------------------------------

const has = (label: string, pattern: RegExp): boolean => pattern.test(label);

const CRAFTED_KIND: Record<CraftForm, ItemIconKind> = {
  dagger: 'dagger',
  sword: 'sword',
  greatsword: 'sword',
  wand: 'wand',
  staff: 'staff',
  shortbow: 'bow',
  longbow: 'bow',
  jerkin: 'armor',
  mail: 'armor',
  plate: 'armor',
};

export function itemIconKind(def: ItemDef): ItemIconKind {
  const label = `${def.id} ${def.name}`.toLowerCase();
  if (def.crafted) return CRAFTED_KIND[def.crafted.form];
  if (def.paper || def.hexzettel || def.id === 'hexCodex') return 'paper';
  if (def.ammo) return 'arrows';
  if (def.potion) return def.potion === 'word' ? 'vial' : 'potion';
  if (def.id === 'pickaxe') return 'pickaxe';
  if (def.id === 'torch') return 'torch';
  // Staffs come before the geode / lens / core rules their names would otherwise meet.
  if (def.staffBolts || def.castThrough) return has(label, /wand|scepter/) ? 'wand' : 'staff';
  if (def.keyItem && has(label, /map/)) return 'map';
  if (has(label, /moonshard/)) return 'crystal';
  if (def.edgelordLantern || has(label, /lantern/)) return 'lantern';
  if (def.sandPocket || has(label, /\bbag\b|pocket/)) return 'bag';
  if (def.materialKind === 'gem' || def.id.startsWith('gem')) return 'gem';
  if (def.materialKind === 'herb' || def.id.startsWith('herb')) return def.id === 'herbFireblossom' ? 'root' : 'leaf';
  if (def.id.startsWith('ore') || def.id === 'redStone' || def.id === 'pebble') return 'ore';
  if (def.id === 'wood') return 'ingot';
  if (has(label, /wings/)) return 'wings';
  if (has(label, /pelt|hide|leather/)) return 'pelt';
  if (has(label, /fang|tusk|horn/)) return 'fang';
  if (def.material && has(label, /scale/)) return 'scale';
  if (def.material && has(label, /shard/)) return 'crystal';
  if (has(label, /core|geode|battery/) || (def.material && has(label, /heart/))) return 'core';
  if (def.material && has(label, /stone/)) return 'crystal';
  if (has(label, /ectoplasm|essence|\bgel\b|membrane/) || (def.material && has(label, /soul/))) return 'blob';
  if (has(label, /\bbar\b/)) return 'ingot';
  if (has(label, /\beye\b|lens/)) return 'eye';
  if (has(label, /trinket/)) return 'trinket';
  if (has(label, /chalice/)) return 'chalice';
  if (has(label, /vial/)) return 'vial';
  if (has(label, /bell/)) return 'bell';
  if (has(label, /bolas/)) return 'bolas';
  if (has(label, /creed|book|tome/)) return 'book';
  if (has(label, /thunder/)) return 'bolt';
  if (has(label, /javelin|harpoon/)) return 'spear';
  if (has(label, /dagger|knife|dart/)) return 'dagger';
  if (def.slot === 'hand') {
    if (has(label, /crossbow|arbalest/)) return 'crossbow';
    if (def.weaponFamily === 'bow' || has(label, /bow/)) return 'bow';
    if (def.weaponFamily === 'hammer' || has(label, /hammer|maul/)) return 'hammer';
    if (has(label, /spear|pike|lance|trident/)) return 'spear';
    if (has(label, /axe|hatchet|marrowdrinker/)) return 'axe';
    if (has(label, /club|mace|cudgel|gravebreaker/)) return 'club';
    if (has(label, /sword|blade|edge/)) return 'sword';
    if (has(label, /buckler/)) return 'buckler';
    if (def.shield || has(label, /shield/)) return 'shield';
    if (def.isWand || has(label, /wand|\brod\b/)) return 'wand';
    if (has(label, /staff/)) return 'staff';
    if (has(label, /needle/)) return 'dagger';
    return 'sword';
  }
  if (has(label, /cape|cloak|mantle/)) return 'cloak';
  if (def.slot === 'head') return has(label, /circlet|crown/) ? 'circlet' : has(label, /hat|headpiece/) ? 'hat' : 'helm';
  if (def.slot === 'torso') return has(label, /robe|stillsuit/) ? 'robe' : 'armor';
  if (def.slot === 'boots') return 'boots';
  if (def.slot === 'cape') return 'cloak';
  if (def.slot === 'gloves' || has(label, /glove/)) return 'gloves';
  if (has(label, /ring\b|band\b|ring of/)) return 'ring';
  if (has(label, /bracelet|anklet/)) return 'bracelet';
  if (has(label, /needle/)) return 'dagger';
  if (def.slot === 'accessory') return 'amulet';
  return 'trinket';
}

function metalOf(label: string): Tone {
  if (has(label, /\bwood\b/)) return WOOD;
  if (has(label, /gold|gilded|gambler/)) return METAL.gold;
  if (has(label, /silver|quicksilver|lareneg|moon|aluminium/)) return METAL.silver;
  if (has(label, /copper|bronze/)) return METAL.copper;
  if (has(label, /darksteel|shadow|black|onyx|gravebreaker|marrow|hollow|redacted|edgelord/)) return METAL.dark;
  if (has(label, /stone|primitive|crude/)) return METAL.stone;
  if (has(label, /glass|crystal|diamond/)) return METAL.glass;
  if (has(label, /rot|plague|acid/)) return METAL.rot;
  if (has(label, /ember|magma|fire|red drake/)) return METAL.ember;
  if (has(label, /runic|rune|mana|wand/)) return METAL.rune;
  if (has(label, /bone|calcified/)) return METAL.bone;
  if (has(label, /iron|chain|greaves|forged/)) return METAL.iron;
  return METAL.steel;
}

function accentOf(def: ItemDef, label: string): Tone {
  const gem = GEM_COLOR[def.id] ?? HERB_COLOR[def.id];
  if (gem != null) return tone(gem);
  if (has(label, /geode/)) return tone(0xe08a3a);
  if (has(label, /\blens\b|white moonshard|prism/)) return tone(0xeef4ff);
  if (has(label, /hexwood|eclipse/)) return tone(0x7a4ab0);
  if (has(label, /miser/)) return tone(0xe8c048);
  if (has(label, /farcaster/)) return tone(0x6fb8ff);
  if (has(label, /equinox/)) return tone(0x9ce08a);
  if (has(label, /ruby|blood|red|ember|magma|tantrum|health/)) return tone(0xd8434a);
  if (has(label, /sapphire|mana|channel|smart|blue|frost/)) return tone(0x4a7fe0);
  if (has(label, /emerald|thorn|green|rot|plague|acid|slime/)) return tone(0x4cbf6a);
  if (has(label, /amethyst|eldritch|purple|soul|echo|word/)) return tone(0x9a62d8);
  if (has(label, /onyx|shadow|dark|black|death|grave|reaper|hush/)) return tone(0x5a5070);
  if (has(label, /diamond|lareneg|glass|serenity|clear|ecto/)) return tone(0xd2f0ff);
  if (has(label, /gold|sun|greed|gambler/)) return tone(0xe8c048);
  if (has(label, /copper/)) return tone(0xd07a40);
  if (has(label, /moon/)) return tone(0xa8d0ff);
  if (has(label, /thunder|storm|charged/)) return tone(0xf0dc58);
  if (has(label, /faith|oath|ward|creed|sigil|chalice/)) return tone(0xe8d8a0);
  if (has(label, /lich/)) return tone(0x7ad08a);
  return tone(parseInt(RARITY_COLOR[def.rarity].slice(1), 16));
}

/** Leather, cloth or fur: what the soft things are. */
function softOf(label: string): Tone {
  if (has(label, /wolf/)) return tone(0x8a8a90);
  if (has(label, /\bbat\b/)) return tone(0x5a4a48);
  if (has(label, /rabbit/)) return tone(0xc8b08a);
  if (has(label, /lion/)) return tone(0xcf9a48);
  if (has(label, /boar/)) return tone(0x6e4a32);
  if (has(label, /padded|travel/)) return tone(0x9a7a52);
  if (has(label, /assassin|shadow|dark|death/)) return tone(0x3e3a4c);
  return LEATHER;
}

// ---------------------------------------------------------------------------
//  DRAWING
// ---------------------------------------------------------------------------

type Point = readonly [number, number];

function line(px: PixelBuffer, x0: number, y0: number, x1: number, y1: number, color: number): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const tx = Math.round(x1);
  const ty = Math.round(y1);
  const dx = Math.abs(tx - x);
  const dy = -Math.abs(ty - y);
  const sx = x < tx ? 1 : -1;
  const sy = y < ty ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    px.set(x, y, color);
    if (x === tx && y === ty) return;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

function disc(px: PixelBuffer, cx: number, cy: number, r: number, color: number): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r + 0.3) px.set(x, y, color);
    }
  }
}

function ring(px: PixelBuffer, cx: number, cy: number, r: number, width: number, color: number): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r + 0.35 && d >= r - width + 0.35) px.set(x, y, color);
    }
  }
}

/** Fill a polygon by pixel centres. */
function poly(px: PixelBuffer, points: readonly Point[], color: number): void {
  const ys = points.map((p) => p[1]);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
    const cy = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[(i + 1) % points.length];
      if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.ceil(xs[i] - 0.5); x <= Math.floor(xs[i + 1] - 0.5); x++) px.set(x, y, color);
    }
  }
}

/** A blade or shaft along the "/" diagonal: light on its upper edge, dark below. */
function diagonal(px: PixelBuffer, x0: number, y0: number, x1: number, y1: number, t: Tone, width = 2): void {
  line(px, x0, y0, x1, y1, t.light);
  if (width >= 2) line(px, x0 + 1, y0, x1 + 1, y1, t.base);
  if (width >= 3) line(px, x0 + 1, y0 + 1, x1 + 1, y1 + 1, t.dark);
}

interface Look {
  kind: ItemIconKind;
  metal: Tone;
  accent: Tone;
  soft: Tone;
  id: ItemId;
  label: string;
}

function paint(px: PixelBuffer, look: Look): void {
  const { metal, accent, soft, label } = look;
  switch (look.kind) {
    case 'sword': {
      diagonal(px, 5, 10, 12, 3, metal, 3);
      px.set(13, 2, metal.light);
      line(px, 3, 8, 7, 12, accent.base === metal.base ? METAL.gold.base : METAL.gold.base);
      line(px, 3, 9, 6, 12, METAL.gold.dark);
      line(px, 4, 11, 2, 13, soft.base);
      px.set(1, 14, METAL.gold.light);
      px.set(2, 14, METAL.gold.base);
      px.set(1, 13, METAL.gold.base);
      return;
    }
    case 'dagger': {
      diagonal(px, 7, 8, 11, 4, metal, 3);
      px.set(12, 3, metal.light);
      line(px, 5, 7, 8, 10, METAL.gold.base);
      line(px, 6, 9, 4, 11, soft.base);
      line(px, 5, 10, 3, 12, soft.dark);
      px.set(3, 12, METAL.gold.light);
      return;
    }
    case 'spear': {
      diagonal(px, 2, 13, 10, 5, WOOD, 2);
      poly(px, [[9, 6], [11, 2], [14, 1], [13, 4]], metal.base);
      line(px, 11, 3, 13, 2, metal.light);
      line(px, 10, 6, 13, 4, metal.dark);
      px.set(9, 7, accent.base);
      px.set(8, 7, accent.dark);
      return;
    }
    case 'axe': {
      diagonal(px, 3, 13, 10, 4, WOOD, 2);
      poly(px, [[8, 3], [12, 1], [14, 4], [13, 8], [10, 7]], metal.base);
      line(px, 12, 1, 14, 4, metal.light);
      line(px, 14, 5, 13, 8, metal.light);
      line(px, 9, 6, 11, 7, metal.dark);
      return;
    }
    case 'hammer': {
      diagonal(px, 3, 13, 9, 7, WOOD, 2);
      poly(px, [[6, 4], [10, 1], [14, 5], [10, 9]], metal.base);
      line(px, 7, 4, 10, 2, metal.light);
      line(px, 10, 8, 13, 5, metal.dark);
      line(px, 9, 3, 11, 6, metal.dark);
      return;
    }
    case 'club': {
      diagonal(px, 2, 13, 6, 9, WOOD, 2);
      poly(px, [[5, 9], [9, 3], [13, 2], [13, 6], [8, 11]], WOOD.base);
      line(px, 9, 3, 13, 2, WOOD.light);
      line(px, 8, 10, 12, 6, WOOD.dark);
      px.set(10, 5, WOOD.dark);
      px.set(8, 7, WOOD.dark);
      px.set(11, 4, metal.light);
      return;
    }
    case 'bow': {
      const bowWood = has(label, /moonfire|glass|veil|wrenching/) ? metal : WOOD;
      for (let y = 1; y <= 14; y++) {
        const t = (y - 7.5) / 6.5;
        const x = 4 + Math.round(7 * (1 - t * t));
        px.set(x, y, bowWood.base);
        px.set(x + 1, y, bowWood.dark);
        if (Math.abs(t) < 0.9) px.set(x - 1, y, bowWood.light);
      }
      line(px, 4, 2, 4, 13, STRING.light);
      px.set(11, 7, accent.base);
      px.set(11, 8, accent.base);
      px.set(12, 7, accent.dark);
      px.set(12, 8, accent.dark);
      return;
    }
    case 'crossbow': {
      diagonal(px, 3, 12, 11, 4, WOOD, 3);
      for (let i = 0; i <= 8; i++) {
        const x = 6 + i;
        const y = 1 + i;
        const bend = i === 0 || i === 8 ? 1 : 0;
        px.set(x - bend, y + bend, metal.base);
        px.set(x - bend + 1, y + bend, metal.dark);
      }
      line(px, 7, 3, 12, 8, STRING.light);
      px.set(2, 13, WOOD.dark);
      px.set(3, 13, WOOD.dark);
      return;
    }
    case 'staff': {
      diagonal(px, 2, 14, 11, 5, WOOD, 2);
      ring(px, 12, 3.5, 2.5, 1, METAL.gold.base);
      disc(px, 12, 3.5, 1.2, accent.light);
      px.set(12, 3, SHINE);
      return;
    }
    case 'wand': {
      line(px, 3, 13, 10, 6, metal.base);
      line(px, 4, 13, 11, 6, metal.dark);
      line(px, 3, 12, 9, 6, metal.light);
      disc(px, 12, 4, 1.6, accent.base);
      px.set(12, 4, SHINE);
      px.set(14, 2, accent.light);
      px.set(10, 2, accent.light);
      px.set(14, 6, accent.light);
      return;
    }
    case 'shield': {
      poly(px, [[2, 2], [14, 2], [14, 8], [8, 15], [2, 8]], metal.base);
      line(px, 3, 3, 13, 3, metal.light);
      line(px, 3, 3, 3, 8, metal.light);
      line(px, 13, 4, 13, 8, metal.dark);
      line(px, 12, 9, 8, 13, metal.dark);
      poly(px, [[6, 5], [10, 5], [10, 8], [8, 11], [6, 8]], accent.base);
      line(px, 6, 5, 10, 5, accent.light);
      return;
    }
    case 'buckler': {
      disc(px, 7.5, 8, 6, metal.base);
      ring(px, 7.5, 8, 6, 1, metal.dark);
      line(px, 4, 4, 7, 3, metal.light);
      line(px, 3, 5, 3, 7, metal.light);
      disc(px, 7.5, 8, 2, accent.base);
      px.set(7, 7, accent.light);
      return;
    }
    case 'lantern': {
      line(px, 6, 1, 9, 1, metal.dark);
      px.set(5, 2, metal.dark);
      px.set(10, 2, metal.dark);
      px.set(7, 2, metal.base);
      px.set(8, 2, metal.base);
      poly(px, [[5, 3], [11, 3], [11, 5], [5, 5]], metal.base);
      line(px, 5, 3, 10, 3, metal.light);
      poly(px, [[5, 5], [11, 5], [11, 12], [5, 12]], 0xffc44a);
      poly(px, [[7, 7], [9, 7], [9, 10], [7, 10]], 0xfff2b0);
      line(px, 5, 5, 5, 12, metal.dark);
      line(px, 10, 5, 10, 12, metal.dark);
      line(px, 8, 5, 8, 12, metal.base);
      poly(px, [[4, 12], [12, 12], [12, 14], [4, 14]], metal.dark);
      line(px, 4, 12, 11, 12, metal.base);
      return;
    }
    case 'torch': {
      diagonal(px, 4, 14, 8, 8, WOOD, 2);
      line(px, 7, 9, 9, 8, LEATHER.dark);
      disc(px, 10, 5.5, 2.4, 0xe0582a);
      disc(px, 10, 5, 1.5, 0xffa040);
      px.set(11, 2, 0xffd060);
      px.set(10, 3, 0xffd060);
      px.set(10, 5, 0xfff0a0);
      return;
    }
    case 'bell': {
      poly(px, [[5, 3], [10, 3], [12, 11], [3, 11]], metal.base);
      line(px, 5, 4, 4, 10, metal.light);
      line(px, 10, 4, 11, 10, metal.dark);
      poly(px, [[2, 11], [13, 11], [13, 13], [2, 13]], metal.dark);
      line(px, 2, 11, 12, 11, metal.light);
      px.set(7, 2, metal.dark);
      px.set(8, 2, metal.dark);
      disc(px, 7.5, 14, 1, accent.base);
      return;
    }
    case 'bolas': {
      line(px, 4, 11, 11, 4, STRING.base);
      line(px, 4, 11, 7, 13, STRING.dark);
      disc(px, 4, 11, 2.2, METAL.stone.base);
      disc(px, 11, 4, 2.2, METAL.stone.base);
      disc(px, 8, 13, 1.5, METAL.stone.dark);
      px.set(3, 10, METAL.stone.light);
      px.set(10, 3, METAL.stone.light);
      return;
    }
    case 'helm': {
      const t = has(label, /leather|cap/) && !has(label, /iron/) ? soft : metal;
      poly(px, [[3, 6], [5, 3], [10, 3], [12, 6], [12, 13], [10, 13], [10, 10], [5, 10], [5, 13], [3, 13]], t.base);
      line(px, 5, 3, 10, 3, t.light);
      line(px, 4, 4, 3, 6, t.light);
      line(px, 12, 7, 12, 13, t.dark);
      line(px, 5, 8, 10, 8, OUTLINE);
      line(px, 7, 4, 7, 7, t.light);
      if (has(label, /drake/)) {
        px.set(2, 4, accent.base);
        px.set(13, 4, accent.base);
        px.set(1, 3, accent.light);
        px.set(14, 3, accent.light);
      }
      return;
    }
    case 'hat': {
      poly(px, [[5, 3], [10, 3], [11, 11], [4, 11]], metal.base);
      line(px, 5, 4, 4, 10, metal.light);
      line(px, 10, 4, 11, 10, metal.dark);
      poly(px, [[1, 11], [14, 11], [14, 13], [1, 13]], metal.dark);
      line(px, 1, 11, 13, 11, metal.light);
      line(px, 5, 9, 10, 9, accent.base);
      return;
    }
    case 'circlet': {
      ring(px, 7.5, 9, 6, 1, METAL.gold.base);
      for (let x = 2; x <= 13; x++) px.set(x, 6, -1);
      for (let x = 2; x <= 13; x++) if (px.get(x, 7) >= 0) px.set(x, 7, METAL.gold.light);
      poly(px, [[6, 5], [9, 5], [9, 8], [6, 8]], METAL.gold.base);
      disc(px, 7.5, 6.5, 1.2, accent.base);
      px.set(7, 6, accent.light);
      return;
    }
    case 'armor': {
      const t = has(label, /jerkin|padded|leather|stillsuit/) ? soft : metal;
      poly(px, [[2, 3], [6, 2], [9, 2], [13, 3], [14, 7], [12, 7], [11, 13], [4, 13], [3, 7], [1, 7]], t.base);
      line(px, 6, 2, 7, 4, OUTLINE);
      line(px, 9, 2, 8, 4, OUTLINE);
      line(px, 3, 3, 5, 3, t.light);
      line(px, 4, 8, 4, 12, t.light);
      line(px, 11, 8, 10, 12, t.dark);
      line(px, 4, 10, 11, 10, accent.base);
      if (has(label, /chain|mail/)) {
        for (let y = 5; y <= 12; y += 2) for (let x = 4 + (y % 4 === 1 ? 1 : 0); x <= 11; x += 2) if (px.get(x, y) === t.base) px.set(x, y, t.dark);
      }
      return;
    }
    case 'robe': {
      poly(px, [[5, 2], [10, 2], [12, 5], [13, 14], [2, 14], [3, 5]], accent.dark);
      line(px, 5, 2, 7, 5, accent.base);
      line(px, 10, 2, 8, 5, accent.base);
      line(px, 4, 6, 3, 13, accent.base);
      line(px, 7, 6, 7, 13, shade(accent.dark, 0.3));
      line(px, 4, 8, 11, 8, METAL.gold.base);
      return;
    }
    case 'cloak': {
      poly(px, [[5, 2], [10, 2], [11, 5], [14, 14], [1, 14], [4, 5]], soft === LEATHER ? accent.dark : soft.base);
      const c = soft === LEATHER ? accent : soft;
      line(px, 5, 3, 3, 13, c.light);
      line(px, 7, 6, 6, 13, c.dark);
      line(px, 9, 6, 10, 13, c.dark);
      line(px, 5, 2, 10, 2, c.light);
      disc(px, 7.5, 4, 1, METAL.gold.base);
      return;
    }
    case 'wings': {
      const c = accent;
      poly(px, [[7, 5], [1, 2], [1, 7], [4, 12], [7, 9]], c.base);
      poly(px, [[8, 5], [14, 2], [14, 7], [11, 12], [8, 9]], c.base);
      line(px, 1, 2, 6, 5, c.light);
      line(px, 14, 2, 9, 5, c.light);
      line(px, 2, 7, 5, 9, c.dark);
      line(px, 13, 7, 10, 9, c.dark);
      line(px, 3, 10, 5, 11, c.dark);
      line(px, 12, 10, 10, 11, c.dark);
      return;
    }
    case 'boots': {
      const t = has(label, /greaves|iron|anchor/) ? metal : soft;
      poly(px, [[4, 2], [9, 2], [9, 9], [13, 10], [14, 13], [4, 13]], t.base);
      line(px, 4, 2, 9, 2, t.light);
      line(px, 4, 3, 4, 12, t.light);
      line(px, 4, 13, 14, 13, t.dark);
      line(px, 4, 4, 9, 4, accent.base);
      line(px, 10, 10, 13, 11, t.light);
      return;
    }
    case 'ring': {
      const band = has(label, /iron|smart|thorn/) ? metal === METAL.steel ? METAL.iron : metal : has(label, /copper/) ? METAL.copper : has(label, /lareneg|silver/) ? METAL.silver : METAL.gold;
      ring(px, 7.5, 9.5, 4.5, 2, band.base);
      line(px, 4, 8, 5, 6, band.light);
      line(px, 10, 12, 11, 11, band.dark);
      disc(px, 7.5, 4.5, 1.8, accent.base);
      px.set(7, 4, accent.light);
      px.set(8, 5, accent.dark);
      return;
    }
    case 'bracelet': {
      const band = has(label, /quicksilver|silver/) ? METAL.silver : METAL.gold;
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        const x = Math.round(7.5 + Math.cos(a) * 6);
        const y = Math.round(8 + Math.sin(a) * 3.5);
        px.set(x, y, band.base);
        px.set(x, y + 1, band.dark);
      }
      for (const x of [4, 8, 11]) px.set(x, 11, accent.base);
      px.set(2, 7, band.light);
      return;
    }
    case 'amulet': {
      line(px, 3, 1, 7, 7, METAL.gold.dark);
      line(px, 12, 1, 8, 7, METAL.gold.dark);
      disc(px, 7.5, 10, 3.6, METAL.gold.base);
      disc(px, 7.5, 10, 2.4, accent.base);
      px.set(7, 9, accent.light);
      px.set(6, 9, accent.light);
      px.set(8, 11, accent.dark);
      return;
    }
    case 'gloves': {
      const t = has(label, /tantrum/) ? tone(0xa84a3a) : soft;
      poly(px, [[3, 6], [5, 2], [12, 2], [13, 9], [11, 13], [5, 13]], t.base);
      for (const x of [6, 8, 10]) line(px, x, 2, x, 6, t.dark);
      line(px, 3, 6, 2, 8, t.base);
      line(px, 4, 7, 2, 8, t.dark);
      poly(px, [[5, 11], [12, 11], [11, 14], [5, 14]], t.dark);
      line(px, 5, 11, 11, 11, accent.base);
      return;
    }
    case 'bag': {
      const t = has(label, /holding/) ? accent : has(label, /sand/) ? tone(0xd2b47a) : soft;
      disc(px, 7.5, 9.5, 5, t.base);
      poly(px, [[5, 3], [10, 3], [9, 6], [6, 6]], t.base);
      line(px, 5, 6, 10, 6, STRING.base);
      line(px, 4, 8, 4, 12, t.light);
      line(px, 10, 13, 12, 10, t.dark);
      px.set(5, 2, t.light);
      px.set(10, 2, t.dark);
      return;
    }
    case 'chalice': {
      const m = has(label, /silver|clear/) ? METAL.silver : METAL.gold;
      poly(px, [[2, 2], [13, 2], [11, 7], [4, 7]], m.base);
      line(px, 3, 2, 12, 2, accent.light);
      line(px, 3, 3, 4, 6, m.light);
      line(px, 12, 3, 11, 6, m.dark);
      poly(px, [[7, 7], [9, 7], [9, 11], [7, 11]], m.dark);
      poly(px, [[4, 11], [12, 11], [12, 13], [4, 13]], m.base);
      line(px, 4, 11, 11, 11, m.light);
      return;
    }
    case 'book': {
      poly(px, [[3, 2], [12, 2], [12, 13], [3, 13]], accent.dark);
      line(px, 12, 3, 12, 13, STRING.light);
      line(px, 13, 4, 13, 13, STRING.base);
      line(px, 3, 2, 3, 13, shade(accent.dark, 0.35));
      disc(px, 7.5, 7, 2, METAL.gold.base);
      px.set(7, 6, METAL.gold.light);
      line(px, 5, 11, 10, 11, METAL.gold.dark);
      return;
    }
    case 'bolt': {
      poly(px, [[9, 1], [3, 9], [7, 9], [5, 15], [12, 6], [8, 6], [11, 1]], 0xf0d850);
      line(px, 9, 2, 4, 8, 0xfff4b0);
      line(px, 7, 10, 6, 13, 0xfff4b0);
      return;
    }
    case 'potion': {
      const liquid = has(label, /mana/) ? tone(0x4a7fe0) : has(label, /health/) ? tone(0xd8434a) : accent;
      disc(px, 7.5, 9.5, 4.6, GLASS.base);
      for (let y = 8; y <= 14; y++) for (let x = 2; x <= 13; x++) if (px.get(x, y) === GLASS.base) px.set(x, y, y === 8 ? liquid.light : liquid.base);
      poly(px, [[6, 3], [10, 3], [10, 6], [6, 6]], GLASS.base);
      poly(px, [[6, 1], [10, 1], [10, 3], [6, 3]], WOOD.base);
      line(px, 6, 1, 9, 1, WOOD.light);
      px.set(5, 8, SHINE);
      px.set(4, 9, SHINE);
      line(px, 9, 13, 11, 11, liquid.dark);
      return;
    }
    case 'vial': {
      const liquid = accent;
      poly(px, [[6, 3], [10, 3], [10, 13], [6, 13]], GLASS.base);
      poly(px, [[6, 6], [10, 6], [10, 13], [6, 13]], liquid.base);
      line(px, 6, 6, 9, 6, liquid.light);
      line(px, 9, 7, 9, 12, liquid.dark);
      poly(px, [[5, 1], [11, 1], [11, 3], [5, 3]], WOOD.base);
      line(px, 6, 4, 6, 11, SHINE);
      return;
    }
    case 'arrows': {
      for (const off of [-3, 0, 3]) {
        line(px, 2 + off + 2, 13, 11 + off + 2, 4, WOOD.light);
        px.set(12 + off + 2, 3, metal.light);
        px.set(12 + off + 2, 2, metal.base);
        px.set(11 + off + 2, 3, metal.base);
        px.set(1 + off + 2, 13, 0xd84a3a);
        px.set(2 + off + 2, 14, 0xd84a3a);
      }
      return;
    }
    case 'ore': {
      const coal = look.id === 'oreCoal';
      const rock = coal ? tone(0x3a3a40) : look.id === 'redStone' ? tone(0x8a4a3a) : METAL.stone;
      poly(px, [[2, 9], [4, 5], [8, 3], [12, 4], [14, 8], [12, 12], [7, 13], [3, 12]], rock.base);
      line(px, 4, 5, 8, 3, rock.light);
      line(px, 3, 6, 2, 9, rock.light);
      line(px, 8, 13, 12, 12, rock.dark);
      line(px, 13, 9, 12, 11, rock.dark);
      const fleck = ORE_FLECK[look.id] ?? accent.base;
      const spots: Point[] = coal ? [[6, 6], [9, 8], [5, 10], [11, 6]] : [[6, 6], [7, 6], [9, 8], [10, 8], [5, 10], [11, 5], [8, 11]];
      for (const [x, y] of spots) px.set(x, y, coal ? 0x6a6a78 : fleck);
      px.set(7, 5, coal ? 0xa0a0b0 : tint(fleck, 0.5));
      px.set(10, 7, coal ? 0x8a8a98 : tint(fleck, 0.5));
      return;
    }
    case 'gem': {
      const c = accent;
      poly(px, [[4, 3], [11, 3], [14, 7], [7.5, 14], [1, 7]], c.base);
      poly(px, [[5, 4], [10, 4], [11, 6], [4, 6]], c.light);
      line(px, 1, 7, 14, 7, c.dark);
      line(px, 4, 7, 7, 13, c.light);
      line(px, 11, 7, 8, 13, c.dark);
      px.set(6, 4, SHINE);
      return;
    }
    case 'leaf': {
      poly(px, [[2, 14], [3, 9], [6, 5], [11, 2], [14, 1], [13, 5], [10, 9], [6, 12]], accent.base);
      line(px, 2, 14, 12, 3, accent.light);
      line(px, 7, 11, 12, 6, accent.dark);
      line(px, 5, 8, 7, 9, accent.light);
      line(px, 8, 5, 10, 6, accent.light);
      return;
    }
    case 'root': {
      disc(px, 7, 6, 3.6, accent.base);
      line(px, 7, 9, 5, 14, accent.dark);
      line(px, 8, 9, 11, 13, accent.dark);
      line(px, 6, 9, 2, 12, accent.dark);
      px.set(6, 4, accent.light);
      px.set(5, 5, accent.light);
      line(px, 7, 2, 9, 0, 0x6ab04a);
      line(px, 6, 2, 4, 0, 0x4a8a3a);
      return;
    }
    case 'mushroom': {
      const cap = tone(0xa8743c);
      poly(px, [[6, 8], [10, 8], [10, 14], [6, 14]], STRING.base);
      line(px, 6, 9, 6, 13, STRING.light);
      line(px, 9, 9, 9, 13, STRING.dark);
      for (let y = 2; y <= 8; y++) for (let x = 1; x <= 14; x++) {
        const dx = (x - 7.5) / 6.6;
        const dy = (y - 8.5) / 6.2;
        if (dx * dx + dy * dy <= 1) px.set(x, y, cap.base);
      }
      line(px, 2, 8, 13, 8, cap.dark);
      px.set(5, 4, cap.light);
      px.set(9, 3, cap.light);
      px.set(11, 6, cap.light);
      px.set(4, 4, cap.light);
      return;
    }
    case 'pelt': {
      const t = soft;
      // A stretched hide: the body, four legs out to the corners, the head and a tail.
      for (let y = 3; y <= 13; y++) for (let x = 3; x <= 12; x++) {
        const dx = (x - 7.5) / 4.6;
        const dy = (y - 8) / 5.4;
        if (dx * dx + dy * dy <= 1) px.set(x, y, t.base);
      }
      poly(px, [[3, 4], [1, 2], [2, 1], [5, 3]], t.base);
      poly(px, [[12, 4], [14, 2], [13, 1], [10, 3]], t.base);
      poly(px, [[3, 11], [1, 14], [3, 14], [5, 12]], t.base);
      poly(px, [[12, 11], [14, 14], [12, 14], [10, 12]], t.base);
      poly(px, [[6, 2], [9, 2], [9, 4], [6, 4]], t.base);
      line(px, 7, 13, 8, 15, t.dark);
      line(px, 7, 4, 7, 12, t.dark);
      line(px, 4, 6, 4, 10, t.light);
      line(px, 5, 5, 6, 4, t.light);
      line(px, 11, 7, 11, 11, t.dark);
      return;
    }
    case 'fang': {
      const t = METAL.bone;
      // A tusk curving up from a thick root to a point.
      for (let i = 0; i <= 20; i++) {
        const s = i / 20;
        const a = Math.PI + s * (Math.PI / 2);
        const cx = 13 + Math.cos(a) * 10;
        const cy = 14 + Math.sin(a) * 10;
        disc(px, cx, cy, 2.3 - s * 1.9, t.base);
      }
      for (let i = 2; i <= 18; i++) {
        const s = i / 20;
        const a = Math.PI + s * (Math.PI / 2);
        px.set(Math.round(13 + Math.cos(a) * 8.6), Math.round(14 + Math.sin(a) * 8.6), t.dark);
        px.set(Math.round(13 + Math.cos(a) * 11.2), Math.round(14 + Math.sin(a) * 11.2), t.light);
      }
      line(px, 2, 13, 5, 14, shade(t.base, 0.25));
      return;
    }
    case 'scale': {
      const t = has(label, /black/) ? tone(0x3e3e52) : has(label, /charged/) ? tone(0x5ac8d8) : tone(0xc84038);
      poly(px, [[7.5, 1], [13, 5], [12, 11], [7.5, 15], [3, 11], [2, 5]], t.base);
      line(px, 7, 2, 3, 6, t.light);
      line(px, 7, 4, 7, 13, t.dark);
      line(px, 4, 8, 11, 8, t.dark);
      line(px, 5, 11, 10, 11, t.dark);
      return;
    }
    case 'core': {
      const c = has(label, /magma/) ? tone(0xf07a30) : has(label, /heart/) ? tone(0x9a8f80) : has(label, /golem/) ? tone(0xd8a050) : has(label, /geode/) ? tone(0xa070e0) : has(label, /battery/) ? tone(0x50d0c0) : accent;
      disc(px, 7.5, 8, 5.4, METAL.dark.base);
      disc(px, 7.5, 8, 3.8, c.base);
      disc(px, 7, 7.5, 2, c.light);
      px.set(6, 6, SHINE);
      line(px, 3, 12, 6, 13, METAL.dark.light);
      return;
    }
    case 'crystal': {
      const big = has(label, /big/);
      const small = has(label, /small/);
      const c = has(label, /moonshard/) ? accent : has(label, /magma/) ? tone(0xf07a30) : has(label, /void/) ? tone(0x3a2a52) : tone(0x58a8f0);
      const pts: Point[] = big
        ? [[7, 0], [12, 5], [11, 14], [4, 14], [3, 5]]
        : small ? [[7, 4], [10, 7], [9, 13], [6, 13], [5, 7]] : [[7, 2], [11, 6], [10, 14], [5, 14], [4, 6]];
      poly(px, pts, c.base);
      line(px, pts[0][0], pts[0][1] + 1, pts[4][0] + 1, pts[4][1] + 1, c.light);
      line(px, pts[0][0] + 1, pts[0][1] + 2, pts[3][0] + 2, pts[3][1] - 1, c.dark);
      px.set(pts[0][0], pts[0][1] + 2, SHINE);
      return;
    }
    case 'blob': {
      const gel = GEL_COLOR[look.id];
      const c = gel != null ? tone(gel) : has(label, /soul/) ? tone(0x8a86b0) : has(label, /slime/) ? tone(0x6cc84e) : has(label, /ghast/) ? tone(0x9a70d0) : has(label, /membrane|echo/) ? tone(0xd890b0) : tone(0xb8eae8);
      poly(px, [[2, 12], [3, 7], [6, 4], [10, 3], [13, 6], [14, 11], [11, 14], [5, 14]], c.base);
      line(px, 4, 7, 7, 4, c.light);
      line(px, 6, 13, 12, 12, c.dark);
      px.set(6, 6, SHINE);
      px.set(10, 8, c.light);
      return;
    }
    case 'ingot': {
      const t = metal === METAL.steel ? METAL.dark : metal;
      poly(px, [[1, 9], [4, 5], [15, 5], [12, 9]], t.light);
      poly(px, [[1, 9], [12, 9], [12, 12], [1, 12]], t.base);
      poly(px, [[12, 9], [15, 5], [15, 8], [12, 12]], t.dark);
      line(px, 3, 10, 9, 10, t.light);
      return;
    }
    case 'eye': {
      if (has(label, /lens/)) {
        ring(px, 7.5, 7.5, 6, 2, METAL.gold.base);
        disc(px, 7.5, 7.5, 4, GLASS.base);
        line(px, 5, 5, 6, 4, SHINE);
        return;
      }
      disc(px, 7.5, 7.5, 6, 0xd8d0c8);
      disc(px, 7.5, 7.5, 3.4, accent.base);
      disc(px, 7.5, 7.5, 1.6, OUTLINE);
      px.set(6, 6, SHINE);
      line(px, 2, 10, 4, 12, 0xb05050);
      return;
    }
    case 'pickaxe': {
      diagonal(px, 3, 14, 10, 7, WOOD, 2);
      const head: Point[] = [[1, 6], [3, 3], [7, 1], [11, 2], [14, 5], [15, 9], [12, 6], [9, 4], [5, 4], [3, 6]];
      poly(px, head, metal.base);
      line(px, 3, 3, 7, 1, metal.light);
      line(px, 11, 2, 14, 5, metal.light);
      line(px, 5, 4, 9, 4, metal.dark);
      return;
    }
    case 'map': {
      const paper = tone(0xd8c48e);
      poly(px, [[2, 3], [13, 2], [14, 12], [3, 13]], paper.base);
      line(px, 2, 3, 13, 2, paper.light);
      line(px, 3, 13, 14, 12, paper.dark);
      line(px, 4, 6, 6, 9, 0x8a6a40);
      line(px, 6, 9, 9, 6, 0x8a6a40);
      line(px, 9, 6, 10, 8, 0x8a6a40);
      line(px, 9, 9, 12, 12, 0xc83a32);
      line(px, 12, 9, 9, 12, 0xc83a32);
      return;
    }
    case 'paper': {
      const sheet = tone(has(label, /fine/) ? 0xeee4c8 : 0xd8c9a0);
      poly(px, [[3, 1], [12, 1], [13, 14], [4, 14]], sheet.base);
      line(px, 3, 1, 12, 1, sheet.light);
      line(px, 12, 1, 13, 14, sheet.dark);
      line(px, 4, 14, 13, 14, sheet.dark);
      if (has(label, /^hex:/)) {
        const ink = 0x6a3fb0;
        line(px, 6, 4, 10, 4, ink);
        line(px, 8, 4, 8, 11, ink);
        line(px, 6, 8, 10, 12, ink);
        line(px, 10, 8, 6, 12, ink);
      } else {
        for (const y of [4, 7, 10]) for (const x of [6, 8, 10]) px.set(x, y, sheet.dark);
      }
      return;
    }
    case 'trinket':
    default: {
      line(px, 7, 1, 7, 5, STRING.base);
      poly(px, [[4, 6], [11, 6], [12, 10], [7.5, 14], [3, 10]], METAL.bone.base);
      disc(px, 7.5, 9, 1.6, accent.base);
      line(px, 4, 7, 3, 9, METAL.bone.light);
      line(px, 11, 8, 9, 12, METAL.bone.dark);
      return;
    }
  }
}

/** The look of `id`: kind, metal and accent, as the painter uses them. */
export function itemIconLook(id: ItemId): Look {
  const def = getItem(id);
  const label = `${def.id} ${def.name}`.toLowerCase();
  const made = def.crafted;
  if (made) {
    const main = made.parts[CRAFT_TEMPLATES[made.template].namePart];
    const other = made.parts.find((part) => part !== main) ?? main;
    return {
      kind: itemIconKind(def),
      metal: tone(craftTint(main)),
      accent: made.sockets[0] ? tone(craftTint(made.sockets[0])) : accentOf(def, label),
      soft: tone(craftTint(other)),
      id,
      label,
    };
  }
  return { kind: itemIconKind(def), metal: metalOf(label), accent: accentOf(def, label), soft: softOf(label), id, label };
}

/** A material's colour at the crafting bench and on what is made of it. */
export function craftTint(id: ItemId | null | undefined): number {
  if (!id) return 0x6f6b60;
  const known = CRAFT_MATERIALS[id]?.tint;
  if (known != null) return known;
  const def = getItem(id) as ItemDef | undefined;
  if (!def) return 0x6f6b60;
  const gem = GEM_COLOR[id];
  if (gem != null) return gem;
  const label = `${def.id} ${def.name}`.toLowerCase();
  const kind = itemIconKind(def);
  if (kind === 'pelt' || kind === 'scale') return softOf(label).base;
  if (kind === 'ore' || kind === 'ingot') return metalOf(label).base;
  return accentOf(def, label).base;
}

/** The 16x16 picture of `id`, outlined in near-black. */
export function itemIconPixels(id: ItemId): PixelBuffer {
  const px = new PixelBuffer(ITEM_ICON_SIZE, ITEM_ICON_SIZE);
  paint(px, itemIconLook(id));
  px.outline(OUTLINE);
  return px;
}

/** `id`'s rarity as a colour, for the rim round its icon. */
export function itemRarityColor(id: ItemId): number {
  return parseInt(RARITY_COLOR[getItem(id).rarity].slice(1), 16);
}
