// Every shop an Exploration town can hold. A town lists shop ids; adding a shop
// means adding a def here and placing its door on a town map. Pure data.

import { getItem, ITEM_DEFS, type ItemDef, type ItemId, type Rarity } from '../../core/Items';

export type ShopKind =
  | 'guild'
  | 'apothecary'
  | 'weaponsmith'
  | 'armory'
  | 'jeweller'
  | 'gems'
  | 'valuables'
  | 'forge'
  | 'bowyer'
  | 'herbalist'
  | 'supply';

/** 'forge': a crafting bench, where an Objects mage designs gear from templates (core/crafting). */
export type ShopService = 'rest' | 'bounties' | 'forge';

/** Which pixel shopkeeper stands at the door. */
export type KeeperLook =
  | 'guildmaster'
  | 'alchemist'
  | 'smith'
  | 'armorer'
  | 'jeweller'
  | 'gemcutter'
  | 'fence'
  | 'forgemaster'
  | 'hunter'
  | 'herbalist'
  | 'miner'
  | 'pearler'
  | 'nomad'
  | 'priest';

export interface StockRule {
  /** Always on the shelf, never sold out. `qty` is how many one purchase gives; `price` (gold) overrides the usual markup. */
  fixed?: { id: ItemId; qty?: number; price?: number }[];
  /** Rolled each day from this pool. */
  pool?: (def: ItemDef) => boolean;
  rarities?: readonly Rarity[];
  size?: number;
  priceMult?: number;
}

export interface BuyRule {
  accepts: (def: ItemDef) => boolean;
  /** Fraction of the item's worth paid out. */
  rate: number;
}

export interface ShopDef {
  id: string;
  kind: ShopKind;
  name: string;
  /** Label over the door. */
  sign: string;
  keeper: KeeperLook;
  stock?: StockRule;
  buys: BuyRule[];
  services: ShopService[];
  /** Gold per rest (guild only). */
  restPrice?: number;
}

const SHOPPABLE = (def: ItemDef): boolean =>
  !def.enemyOnly && def.set !== 'conjured' && !def.material && !def.ammo && !def.potion && def.rarity !== 'lareneg' &&
  !def.keyItem && !def.pack && !def.paper && !def.hexzettel;

const isWeapon = (def: ItemDef): boolean =>
  SHOPPABLE(def) && def.slot === 'hand' && !def.lightSource && (!!def.weapon || !!def.isWand || !!def.shield);
const isArmour = (def: ItemDef): boolean =>
  SHOPPABLE(def) && (def.slot === 'head' || def.slot === 'torso' || def.slot === 'boots');
const isAccessory = (def: ItemDef): boolean => SHOPPABLE(def) && def.slot === 'accessory';
const isGem = (def: ItemDef): boolean => def.materialKind === 'gem';
const isHerb = (def: ItemDef): boolean => def.materialKind === 'herb';
const isMaterial = (def: ItemDef): boolean => !!def.material;
const isOre = (def: ItemDef): boolean => !!def.material && !def.materialKind;
const isBow = (def: ItemDef): boolean => isWeapon(def) && !!def.weapon?.usesArrows;
const isGear = SHOPPABLE;
const isSupply = (def: ItemDef): boolean => !!def.potion || !!def.throwable;

const GEM_JEWELLERY: ItemId[] = ['rubyPendant', 'sapphireRing', 'emeraldCharm', 'onyxAmulet', 'amethystCirclet'];

const SUPPLIES: StockRule['fixed'] = [
  { id: 'healthPotion' },
  { id: 'manaPotion' },
  { id: 'arrow', qty: 10 },
  { id: 'torch' },
  { id: 'throwingDagger' },
];

/** A night at any guild, in gold: two silver. */
export const ROOM_PRICE = 0.2;
/** Gold for a pickaxe, wherever it is sold. */
export const PICKAXE_PRICE = 3;
/** Gold for the Minemap. */
export const MINE_MAP_PRICE = 3;

/** Every guild sells bags (the pack grows with them), the Minemap, and paper for a Hexcraft mage to draw on. */
const GUILD_STOCK: StockRule = {
  fixed: [
    { id: 'smallBag', price: 0.5 },
    { id: 'goodBag', price: 2 },
    { id: 'bagOfHolding', price: 10 },
    { id: 'mineMap', price: MINE_MAP_PRICE },
    { id: 'paper', price: 0.1 },
    { id: 'finePaper', price: 1 },
  ],
};

const guild = (town: string, name: string): ShopDef => ({
  id: `${town}-guild`,
  kind: 'guild',
  name,
  sign: 'GUILD',
  keeper: 'guildmaster',
  stock: GUILD_STOCK,
  buys: [{ accepts: isMaterial, rate: 1 }],
  services: ['rest', 'bounties'],
  restPrice: ROOM_PRICE,
});

const apothecary = (town: string, name: string): ShopDef => ({
  id: `${town}-apothecary`,
  kind: 'apothecary',
  name,
  sign: 'POTIONS',
  keeper: 'alchemist',
  stock: { fixed: SUPPLIES },
  buys: [
    { accepts: isHerb, rate: 1.25 },
    { accepts: isSupply, rate: 0.5 },
  ],
  services: [],
});

const valuables = (town: string, name: string, rarities: readonly Rarity[]): ShopDef => ({
  id: `${town}-valuables`,
  kind: 'valuables',
  name,
  sign: 'VALUABLES',
  keeper: 'fence',
  stock: { pool: SHOPPABLE, rarities, size: 4, priceMult: 1.2 },
  buys: [
    { accepts: isGear, rate: 0.5 },
    { accepts: isGem, rate: 1 },
    { accepts: isMaterial, rate: 0.8 },
  ],
  services: [],
});

const FORGE_SUPPLIES: StockRule['fixed'] = [
  { id: 'wood' },
  { id: 'oreCoal' },
  { id: 'oreCopper' },
  { id: 'oreIron' },
  { id: 'pickaxe', price: PICKAXE_PRICE },
];

const outfitter = (town: string, name: string): ShopDef => ({
  id: `${town}-outfitter`,
  kind: 'supply',
  name,
  sign: 'OUTFITTER',
  keeper: 'nomad',
  stock: { fixed: [{ id: 'stillsuit' }, { id: 'healthPotion' }, { id: 'torch' }, { id: 'arrow', qty: 10 }, { id: 'throwingDagger' }] },
  buys: [
    { accepts: isGem, rate: 1.1 },
    { accepts: isSupply, rate: 0.5 },
  ],
  services: [],
});

export const SHOPS: Record<string, ShopDef> = Object.fromEntries(
  ([
    // ---- The Capitol: everything ----
    guild('capitol', "Adventurers' Guild"),
    apothecary('capitol', 'Royal Apothecary'),
    {
      id: 'capitol-weaponsmith',
      kind: 'weaponsmith',
      name: 'Kingsguard Arms',
      sign: 'WEAPONS',
      keeper: 'smith',
      stock: {
        fixed: [{ id: 'travellersDagger' }, { id: 'quarterstaff' }, { id: 'ironShortsword' }, { id: 'huntingBow' }, { id: 'apprenticeWand' }],
        pool: isWeapon,
        rarities: ['rare', 'epic', 'unreal'],
        size: 4,
      },
      buys: [{ accepts: isWeapon, rate: 0.3 }],
      services: [],
    },
    {
      id: 'capitol-armory',
      kind: 'armory',
      name: 'Crown Armory',
      sign: 'ARMOUR',
      keeper: 'armorer',
      stock: {
        fixed: [{ id: 'leatherCap' }, { id: 'paddedJerkin' }, { id: 'leatherBoots' }],
        pool: isArmour,
        rarities: ['rare', 'epic'],
        size: 3,
      },
      buys: [{ accepts: isArmour, rate: 0.3 }],
      services: [],
    },
    {
      id: 'capitol-jeweller',
      kind: 'jeweller',
      name: 'Silverleaf Accessories',
      sign: 'ACCESSORIES',
      keeper: 'jeweller',
      stock: {
        fixed: [{ id: 'copperRing' }, { id: 'ironBand' }, { id: 'quicksilverAnklet' }],
        pool: (def) => isAccessory(def) && !GEM_JEWELLERY.includes(def.id),
        rarities: ['rare', 'epic', 'unreal'],
        size: 4,
      },
      buys: [{ accepts: isAccessory, rate: 0.3 }],
      services: [],
    },
    {
      id: 'capitol-gems',
      kind: 'gems',
      name: 'The Facet',
      sign: 'GEMS',
      keeper: 'gemcutter',
      stock: {
        pool: (def) => isGem(def) || GEM_JEWELLERY.includes(def.id),
        rarities: ['consumeable', 'rare'],
        size: 5,
        priceMult: 1.5,
      },
      buys: [{ accepts: isGem, rate: 1.25 }],
      services: [],
    },
    valuables('capitol', 'Gilded Curios', ['rare', 'epic', 'unreal', 'mythical']),
    {
      id: 'capitol-forge',
      kind: 'forge',
      name: 'City Forge',
      sign: 'FORGE',
      keeper: 'forgemaster',
      stock: { fixed: FORGE_SUPPLIES, priceMult: 1.5 },
      buys: [],
      services: ['forge'],
    },
    // ---- Hearthfire: the basics, and the best steel in the land ----
    guild('hearthfire', 'Hearthfire Guildhall'),
    apothecary('hearthfire', 'Ashen Remedies'),
    {
      id: 'hearthfire-weaponsmith',
      kind: 'weaponsmith',
      name: 'Anvilheart Weapons',
      sign: 'WEAPONS',
      keeper: 'smith',
      stock: {
        fixed: [{ id: 'ironShortsword' }, { id: 'forgedWarAxe' }, { id: 'huntingBow' }],
        pool: isWeapon,
        rarities: ['rare', 'epic', 'unreal', 'mythical'],
        size: 6,
      },
      buys: [{ accepts: isWeapon, rate: 0.4 }],
      services: [],
    },
    {
      id: 'hearthfire-armory',
      kind: 'armory',
      name: 'Emberwall Armory',
      sign: 'ARMOUR',
      keeper: 'armorer',
      stock: {
        fixed: [{ id: 'paddedJerkin' }, { id: 'chainShirt' }, { id: 'ironGreaves' }, { id: 'leatherCap' }],
        pool: isArmour,
        rarities: ['rare', 'epic', 'unreal', 'mythical'],
        size: 5,
      },
      buys: [{ accepts: isArmour, rate: 0.4 }],
      services: [],
    },
    {
      id: 'hearthfire-forge',
      kind: 'forge',
      name: 'The Great Forge',
      sign: 'FORGE',
      keeper: 'forgemaster',
      stock: { fixed: FORGE_SUPPLIES, priceMult: 1.2 },
      buys: [{ accepts: (def) => !!def.material && !def.materialKind, rate: 1.1 }],
      services: ['forge'],
    },
    // ---- Kerusai: a small town ----
    guild('kerusai', 'Kerusai Lodge'),
    apothecary('kerusai', 'Mirewater Tonics'),
    valuables('kerusai', 'The Drowned Coin', ['rare', 'epic']),
    // ---- Oakhaven: a timber town in the Northwood ----
    guild('oakhaven', 'Oakhaven Lodge'),
    {
      id: 'oakhaven-herbalist',
      kind: 'herbalist',
      name: 'Greenhollow Herbs',
      sign: 'HERBS',
      keeper: 'herbalist',
      stock: { fixed: [{ id: 'healthPotion' }, { id: 'manaPotion' }, { id: 'herbMoonglow' }, { id: 'torch' }] },
      buys: [
        { accepts: isHerb, rate: 1.5 },
        { accepts: isSupply, rate: 0.5 },
      ],
      services: [],
    },
    {
      id: 'oakhaven-bowyer',
      kind: 'bowyer',
      name: 'Longshadow Bowyer',
      sign: 'BOWS',
      keeper: 'hunter',
      stock: {
        fixed: [{ id: 'huntingBow' }, { id: 'arrow', qty: 10 }, { id: 'leatherCap' }, { id: 'paddedJerkin' }, { id: 'leatherBoots' }],
        pool: isBow,
        rarities: ['rare', 'epic', 'unreal'],
        size: 2,
      },
      buys: [
        { accepts: isBow, rate: 0.45 },
        { accepts: isArmour, rate: 0.25 },
      ],
      services: [],
    },
    // ---- Pennybruck: a small miners' village on the lower slopes ----
    guild('pennybruck', 'Pennybruck Hall'),
    apothecary('pennybruck', 'Slopeside Remedies'),
    {
      id: 'pennybruck-supply',
      kind: 'supply',
      name: 'Deepvein Supply',
      sign: 'SUPPLY',
      keeper: 'miner',
      stock: { fixed: [{ id: 'torch' }, { id: 'lantern' }, { id: 'pickaxe', price: PICKAXE_PRICE }, { id: 'mineMap', price: MINE_MAP_PRICE }, { id: 'throwingDagger' }, { id: 'oreCoal' }] },
      buys: [
        { accepts: isOre, rate: 1.2 },
        { accepts: isGem, rate: 1.1 },
      ],
      services: [],
    },
    // ---- Thassa: the lake port ----
    guild('thassa', 'Tidewatch Guild'),
    apothecary('thassa', 'Saltwind Apothecary'),
    {
      id: 'thassa-pearls',
      kind: 'jeweller',
      name: 'The Pearl Trader',
      sign: 'PEARLS',
      keeper: 'pearler',
      stock: { pool: isAccessory, rarities: ['rare', 'epic', 'unreal'], size: 4, priceMult: 1.1 },
      buys: [
        { accepts: isGem, rate: 1.2 },
        { accepts: isAccessory, rate: 0.35 },
      ],
      services: [],
    },
    // ---- Nerogril: the last well before the deep desert ----
    guild('nerogril', 'Nerogril Waystation'),
    apothecary('nerogril', 'Sandglass Remedies'),
    outfitter('nerogril', 'Dune Outfitters'),
    // ---- The Theocracy: the holy city of the White Desert ----
    guild('theocracy', "The Pilgrims' Hall"),
    apothecary('theocracy', 'The Sacred Spring'),
    outfitter('theocracy', 'Oasis Outfitters'),
    {
      id: 'theocracy-arms',
      kind: 'weaponsmith',
      name: 'Arms of the Faithful',
      sign: 'WEAPONS',
      keeper: 'smith',
      stock: {
        fixed: [{ id: 'ironShortsword' }, { id: 'huntingBow' }, { id: 'quarterstaff' }],
        pool: isWeapon,
        rarities: ['rare', 'epic', 'unreal'],
        size: 5,
      },
      buys: [{ accepts: isWeapon, rate: 0.35 }],
      services: [],
    },
    {
      id: 'theocracy-relics',
      kind: 'valuables',
      name: 'Reliquary of the Sun',
      sign: 'RELICS',
      keeper: 'priest',
      stock: { pool: (def) => isAccessory(def) || isArmour(def), rarities: ['epic', 'unreal', 'mythical'], size: 4, priceMult: 1.3 },
      buys: [
        { accepts: isGem, rate: 1.3 },
        { accepts: isGear, rate: 0.5 },
      ],
      services: [],
    },
  ] satisfies ShopDef[]).map((shop) => [shop.id, shop] as const),
);

/** What a merchant saved on the road may turn out to sell. */
export const WAYSIDE_KINDS = ['weaponsmith', 'armory', 'jeweller', 'apothecary', 'bowyer', 'herbalist', 'supply', 'gems'] as const satisfies readonly ShopKind[];
export type WaysideKind = (typeof WAYSIDE_KINDS)[number];
/** Grateful merchants sell a little under their usual price. */
export const WAYSIDE_DISCOUNT = 0.85;

export const waysideShopId = (kind: WaysideKind): string => `wayside-${kind}`;

const WAYSIDE_NAMES: Record<WaysideKind, string> = {
  weaponsmith: "Travelling Weaponsmith's Cart",
  armory: "Travelling Armourer's Cart",
  jeweller: "Travelling Jeweller's Coach",
  apothecary: "Travelling Apothecary's Wagon",
  bowyer: "Travelling Bowyer's Cart",
  herbalist: "Travelling Herbalist's Wagon",
  supply: "Travelling Outfitter's Wagon",
  gems: "Travelling Gem Dealer's Coach",
};

// Wayside wares stock like the first town shop of their kind, cheaper, and buy nothing.
for (const kind of WAYSIDE_KINDS) {
  const model = Object.values(SHOPS).find((shop) => shop.kind === kind && shop.stock);
  if (!model?.stock) continue;
  SHOPS[waysideShopId(kind)] = {
    id: waysideShopId(kind),
    kind,
    name: WAYSIDE_NAMES[kind],
    sign: 'WARES',
    keeper: model.keeper,
    stock: { ...model.stock, priceMult: (model.stock.priceMult ?? 1) * WAYSIDE_DISCOUNT },
    buys: [],
    services: [],
  };
}

export function shopById(id: string): ShopDef | undefined {
  return Object.prototype.hasOwnProperty.call(SHOPS, id) ? SHOPS[id] : undefined;
}

/** Items a stock pool may roll from. */
export function stockCandidates(rule: StockRule): ItemDef[] {
  if (!rule.pool) return [];
  const pool = rule.pool;
  const rarities = rule.rarities;
  return ITEM_DEFS.filter((def) => pool(def) && (!rarities || rarities.includes(def.rarity)));
}

export function itemName(id: ItemId): string {
  return getItem(id).name;
}
