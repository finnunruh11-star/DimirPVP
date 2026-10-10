// How an item reads in every inventory window: its category, where it sorts,
// the facts worth a line of their own, and how carried things fall into
// stacks and pack slots. Pure: no Phaser.

import { RANGE_UNIT } from '../../config/constants';
import { getItem, rarityRank, type ItemDef, type ItemId, type Rarity } from '../../core/Items';
import type { Mage } from '../../core/Mage';
import { packItems, stackSize } from '../../core/Pack';

export type ItemCategory =
  | 'weapon'
  | 'light'
  | 'armor'
  | 'trinket'
  | 'consumable'
  | 'ammo'
  | 'arcana'
  | 'tool'
  | 'bag'
  | 'key'
  | 'material';

export const CATEGORY_ORDER: readonly ItemCategory[] = [
  'weapon', 'light', 'armor', 'trinket', 'consumable', 'ammo', 'arcana', 'tool', 'bag', 'key', 'material',
];

export const CATEGORY_LABEL: Record<ItemCategory, string> = {
  weapon: 'Weapon',
  light: 'Light',
  armor: 'Armour',
  trinket: 'Trinket',
  consumable: 'Consumable',
  ammo: 'Ammunition',
  arcana: 'Magic',
  tool: 'Tool',
  bag: 'Bag',
  key: 'Key Item',
  material: 'Material',
};

export const RARITY_NAME: Record<Rarity, string> = {
  common: 'Common',
  consumeable: '',
  rare: 'Rare',
  epic: 'Epic',
  unreal: 'Unreal',
  mythical: 'Mythical',
  legendary: 'Legendary',
  lareneg: 'Lareneg',
};

export type ItemFilter = 'all' | 'gear' | 'supplies' | 'materials' | 'other';

export const FILTERS: readonly { id: ItemFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'gear', label: 'Gear' },
  { id: 'supplies', label: 'Supplies' },
  { id: 'materials', label: 'Materials' },
  { id: 'other', label: 'Other' },
];

const FILTER_OF: Record<ItemCategory, ItemFilter> = {
  weapon: 'gear',
  light: 'gear',
  armor: 'gear',
  trinket: 'gear',
  consumable: 'supplies',
  ammo: 'supplies',
  arcana: 'supplies',
  tool: 'other',
  bag: 'other',
  key: 'other',
  material: 'materials',
};

export function itemCategory(def: ItemDef): ItemCategory {
  if (def.keyItem) return 'key';
  if (def.pack) return 'bag';
  if (def.ammo) return 'ammo';
  if (def.tool) return 'tool';
  if (def.material) return 'material';
  if (def.paper || def.hexzettel || /^moonshard/.test(def.id)) return 'arcana';
  if (def.slot === 'utility') return 'consumable';
  if (def.slot === 'hand') return def.lightSource ? 'light' : 'weapon';
  if (def.slot === 'accessory') return 'trinket';
  return 'armor';
}

export function matchesFilter(id: ItemId, filter: ItemFilter): boolean {
  return filter === 'all' || FILTER_OF[itemCategory(getItem(id))] === filter;
}

/** Category first, then the rarest, then by name. */
export function compareItems(a: ItemId, b: ItemId): number {
  const da = getItem(a);
  const db = getItem(b);
  return CATEGORY_ORDER.indexOf(itemCategory(da)) - CATEGORY_ORDER.indexOf(itemCategory(db))
    || rarityRank(db.rarity) - rarityRank(da.rarity)
    || da.name.localeCompare(db.name)
    || a.localeCompare(b);
}

const SLOT_WORD: Record<ItemDef['slot'], string> = {
  hand: 'Hand',
  head: 'Head',
  torso: 'Torso',
  cape: 'Cape',
  gloves: 'Gloves',
  boots: 'Feet',
  accessory: 'Accessory',
  utility: 'Bag',
};

/** "Rare Weapon  /  Two hands", "Supply Material". */
export function itemKindLine(def: ItemDef): string {
  const category = itemCategory(def);
  const slot = def.slot === 'hand' ? (def.twoHanded ? 'Two hands' : 'One hand')
    : def.slot === 'utility' ? '' : SLOT_WORD[def.slot];
  return [`${RARITY_NAME[def.rarity]} ${CATEGORY_LABEL[category]}`.trim(), slot].filter(Boolean).join('  /  ');
}

const cm = (px: number): string => `${Math.round(px / RANGE_UNIT)}cm`;
const cap = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);
const signed = (value: number): string => `${value > 0 ? '+' : ''}${value}`;

/** The handful of facts an item is chosen for, each short enough for a chip. */
export function itemFacts(def: ItemDef): string[] {
  const facts: string[] = [];
  const weapon = def.weapon;
  if (weapon) {
    facts.push(`${cap(weapon.damageType)} ${weapon.kind === 'dex' ? 'finesse' : 'strength'}`);
    if (weapon.rangePx > 0) facts.push(`Reach ${cm(weapon.rangePx)}`);
    if (weapon.usesArrows) facts.push('Uses arrows');
  }
  if (def.isWand) facts.push('Wand: casts freely');
  if (def.armor) {
    facts.push(`Armour ${signed(def.armor.flat)}`);
    if (def.armor.magicFlat) facts.push(`Magic armour ${signed(def.armor.magicFlat)}`);
  }
  if (def.shield) facts.push(`Block ${Math.round(def.shield.blockPct * 100)}%`);
  const stats = def.statMods;
  if (stats) {
    for (const [key, label] of [['str', 'Str'], ['dex', 'Dex'], ['int', 'Int']] as const) {
      if (stats[key]) facts.push(`${label} ${signed(stats[key]!)}`);
    }
  }
  if (def.resist?.immune?.length) facts.push(`Immune: ${def.resist.immune.map(cap).join(', ')}`);
  if (def.resist?.resist?.length) facts.push(`Resist: ${def.resist.resist.map(cap).join(', ')}`);
  if (def.resist?.weak?.length) facts.push(`Weak: ${def.resist.weak.map(cap).join(', ')}`);
  if (def.throwable) facts.push(`Thrown ${cm(def.throwable.rangePx)}${def.throwable.rollSpec ? `, ${def.throwable.rollSpec}` : ''}`);
  if (def.potion) facts.push('Drink: bonus action');
  if (def.pack) facts.push(`${Number.isFinite(def.pack.slots) ? def.pack.slots : 'Unlimited'} bag slots`);
  if (def.lightRadiusPx) facts.push(`Light ${cm(def.lightRadiusPx)}`);
  if (def.torchCombats != null) facts.push(`Lasts ${def.torchCombats} fights`);
  if (def.keyItem) facts.push('Never sold or dropped');
  if (def.permanentlyBinding) facts.push('Binds when worn');
  if (def.cursed) facts.push('Cursed');
  return facts.slice(0, 8);
}

/** One kind of carried thing and how many. */
export interface ItemStack {
  id: ItemId;
  count: number;
}

/** Carried, unworn things gathered one row per kind, in display order. */
export function stacksOf(items: readonly ItemId[]): ItemStack[] {
  const counts = new Map<ItemId, number>();
  for (const id of items) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].map(([id, count]) => ({ id, count })).sort((a, b) => compareItems(a.id, b.id));
}

/** Everything a mage carries but does not wear, one row per kind. */
export function carriedStacks(mage: Mage): ItemStack[] {
  return stacksOf(packItems(mage));
}

/** One square of the pack grid: a full stack of a kind, or what is left of it. */
export interface PackCell {
  id: ItemId;
  count: number;
  /** Bags and key items ride outside the slots. */
  free: boolean;
}

/** Stacks broken into pack slots the way the pack counts them: 41 ore is 20, 20 and 1. */
export function packCells(stacks: readonly ItemStack[]): PackCell[] {
  const cells: PackCell[] = [];
  for (const { id, count } of stacks) {
    const size = stackSize(getItem(id));
    if (size <= 0) {
      cells.push({ id, count, free: true });
      continue;
    }
    for (let left = count; left > 0; left -= size) cells.push({ id, count: Math.min(size, left), free: false });
  }
  return cells;
}

/** "12.5" or "3" kilograms. */
export function kg(value: number): string {
  return Number.isInteger(Math.round(value * 10) / 10) ? String(Math.round(value)) : value.toFixed(1);
}
