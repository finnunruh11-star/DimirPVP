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
  /** Always on the shelf, never sold out. `qty` is how many one purchase gives. */
  fixed?: { id: ItemId; qty?: number }[];
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
  /** Forge recipe ids this smithy knows. */
  recipes?: string[];
}

const SHOPPABLE = (def: ItemDef): boolean =>
  !def.enemyOnly && def.set !== 'conjured' && !def.material && !def.ammo && !def.potion && def.rarity !== 'lareneg';

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

const guild = (town: string, name: string, restPrice: number): ShopDef => ({
  id: `${town}-guild`,
  kind: 'guild',
  name,
  sign: 'GUILD',
  keeper: 'guildmaster',
  buys: [{ accepts: isMaterial, rate: 1 }],
  services: ['rest', 'bounties'],
  restPrice,
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

export const FORGE_RECIPES: Record<string, { output: ItemId; inputs: [ItemId, number][]; gold: number }> = {
  ironCap: { output: 'ironCap', inputs: [['oreIron', 1], ['oreCoal', 1]], gold: 2 },
  ironGreaves: { output: 'ironGreaves', inputs: [['oreIron', 2]], gold: 3 },
  chainShirt: { output: 'chainShirt', inputs: [['oreIron', 3], ['oreCoal', 1]], gold: 4 },
  buckler: { output: 'buckler', inputs: [['oreIron', 2]], gold: 3 },
  forgedWarAxe: { output: 'forgedWarAxe', inputs: [['oreIron', 2], ['oreCoal', 1]], gold: 4 },
  warHammer: { output: 'warHammer', inputs: [['oreIron', 4], ['golemCore', 1]], gold: 8 },
  emberplate: { output: 'emberplate', inputs: [['magmaCore', 1], ['redDrakeScale', 1], ['oreIron', 2]], gold: 8 },
  drakescaleHelm: { output: 'drakescaleHelm', inputs: [['blackDrakeScale', 1], ['oreIron', 1]], gold: 6 },
  rubyPendant: { output: 'rubyPendant', inputs: [['gemRuby', 1], ['oreGold', 1]], gold: 3 },
  sapphireRing: { output: 'sapphireRing', inputs: [['gemSapphire', 1], ['oreCopper', 1]], gold: 3 },
  emeraldCharm: { output: 'emeraldCharm', inputs: [['gemEmerald', 1], ['oreCopper', 1]], gold: 3 },
  onyxAmulet: { output: 'onyxAmulet', inputs: [['gemOnyx', 1], ['oreIron', 1]], gold: 3 },
  amethystCirclet: { output: 'amethystCirclet', inputs: [['gemAmethyst', 2], ['oreCopper', 1]], gold: 4 },
};

const ALL_RECIPES = Object.keys(FORGE_RECIPES);
const BASIC_RECIPES = ['ironCap', 'ironGreaves', 'chainShirt', 'buckler', ...GEM_JEWELLERY];

const FORGE_SUPPLIES: StockRule['fixed'] = [{ id: 'oreCoal' }, { id: 'oreCopper' }, { id: 'oreIron' }];

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
    guild('capitol', "Adventurers' Guild", 3),
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
      recipes: BASIC_RECIPES,
    },
    // ---- Hearthfire: the basics, and the best steel in the land ----
    guild('hearthfire', 'Hearthfire Guildhall', 3),
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
      recipes: ALL_RECIPES,
    },
    // ---- Kerusai: a small town ----
    guild('kerusai', 'Kerusai Lodge', 2),
    apothecary('kerusai', 'Mirewater Tonics'),
    valuables('kerusai', 'The Drowned Coin', ['rare', 'epic']),
    // ---- Oakhaven: a timber town in the Northwood ----
    guild('oakhaven', 'Oakhaven Lodge', 2),
    {
      id: 'oakhaven-herbalist',
      kind: 'herbalist',
      name: 'Greenhollow Herbs',
      sign: 'HERBS',
      keeper: 'herbalist',
      stock: { fixed: [{ id: 'healthPotion' }, { id: 'manaPotion' }, { id: 'herbMoonleaf' }, { id: 'torch' }] },
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
    guild('pennybruck', 'Pennybruck Hall', 2),
    apothecary('pennybruck', 'Slopeside Remedies'),
    {
      id: 'pennybruck-supply',
      kind: 'supply',
      name: 'Deepvein Supply',
      sign: 'SUPPLY',
      keeper: 'miner',
      stock: { fixed: [{ id: 'torch' }, { id: 'lantern' }, { id: 'throwingDagger' }, { id: 'oreCoal' }] },
      buys: [
        { accepts: isOre, rate: 1.2 },
        { accepts: isGem, rate: 1.1 },
      ],
      services: [],
    },
    // ---- Thassa: the lake port ----
    guild('thassa', 'Tidewatch Guild', 3),
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
    guild('nerogril', 'Nerogril Waystation', 2),
    apothecary('nerogril', 'Sandglass Remedies'),
    outfitter('nerogril', 'Dune Outfitters'),
    // ---- The Theocracy: the holy city of the White Desert ----
    guild('theocracy', "The Pilgrims' Hall", 3),
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
