// =============================================================================
//  EQUIPMENT / ITEMS
// -----------------------------------------------------------------------------
//  After the stat-assignment phase each duellist visits the shop with a small
//  purse and outfits themselves. Money is tracked in *silver* (10 silver = 1
//  gold). Items occupy equipment slots (2 hand, 1 head, 1 torso, 1 boots, 2
//  accessory/ring, unlimited utility), weigh something (carry capacity scales
//  with Strength) and tweak the basic attack, defence, spellcasting or vitals.
// =============================================================================

import type { DamageType } from './Damage';
import {
  BASE_CARRY_KG,
  MELEE_RANGE,
  RANGE_UNIT,
  SILVER_PER_GOLD,
} from '../config/constants';

export type ItemSlot = 'hand' | 'head' | 'torso' | 'boots' | 'accessory' | 'utility';

/** How many items each slot can hold. Utility (potions / arrows) is unlimited. */
export const SLOT_CAPS: Record<ItemSlot, number> = {
  hand: 2,
  head: 1,
  torso: 1,
  boots: 1,
  accessory: 2,
  utility: Infinity,
};

export type ItemId =
  | 'woodenBow'
  | 'dwarfCrossbow'
  | 'mutivargRod'
  | 'bastionSword'
  | 'darkMagesCape'
  | 'neforpubiHeadpiece'
  | 'gazeTimezBracelet'
  | 'fightersGloves'
  | 'bagOfHolding'
  | 'razorSword'
  | 'buckler'
  | 'finesseDagger'
  | 'eldritchMantle'
  | 'roaringThunder'
  | 'needleOfSerenity'
  | 'secondRingOfLareneg'
  | 'throwingDagger'
  | 'arrow'
  | 'manaPotion'
  | 'healthPotion';

/**
 * Rarity tiers, ordered from most common to rarest. The shop draft rolls a
 * rarity (rarer = less likely; Luck nudges the roll toward rarer tiers) then
 * offers three items of that tier to choose from.
 */
export type Rarity =
  | 'common'
  | 'consumeable'
  | 'rare'
  | 'epic'
  | 'unreal'
  | 'mythical'
  | 'legendary'
  | 'lareneg';

export const RARITY_ORDER: Rarity[] = [
  'common',
  'consumeable',
  'rare',
  'epic',
  'unreal',
  'mythical',
  'legendary',
  'lareneg',
];

/** Display colour (hex) per rarity, for the draft UI. */
export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#b8b8c0',
  consumeable: '#8fdfc8',
  rare: '#5aa9ff',
  epic: '#b061ff',
  unreal: '#ff5ad0',
  mythical: '#ffca3a',
  legendary: '#ff7a2f',
  lareneg: '#eafcff',
};

/** Base draw weight per tier (higher = more likely). Empty tiers are skipped. */
const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 50,
  consumeable: 40,
  rare: 26,
  epic: 15,
  unreal: 7,
  mythical: 3,
  legendary: 2,
  lareneg: 1,
};

/** How a weapon reshapes the wielder's basic attack. */
export interface WeaponMod {
  /** Reach of the basic attack, in pixels. */
  rangePx: number;
  /** Minimum reach (sniper bow can't hit point-blank). */
  minRangePx?: number;
  /** 'strength' = flat melee scaling; 'dex' = the d20 dex-attack formula. */
  kind: 'strength' | 'dex';
  /** Multiplier applied to strength-based damage. */
  multiplier?: number;
  /** Flat bonus added inside the dex-attack formula (may be negative). */
  dexBonus?: number;
  /** Bonus added inside the dex-attack formula equal to this fraction of Dex (finesse dagger). */
  dexBonusPct?: number;
  /** Finesse multiplier on the convex (dex²) term. Default 1; a strong dagger 3. */
  dexScale?: number;
  /** A dex strike that rolls this natural d20 or higher crits for ×1.5. */
  dexCritOn?: number;
  /** Sniper-style range reward: +1 damage per `per` px travelled, up to `cap`. */
  rangeReward?: { per: number; cap: number };
  /** A dex weapon strikes this many times, each rolled separately (dualblade). */
  hits?: number;
  /** Bows consume one arrow per shot and can't fire without ammo. */
  usesArrows?: boolean;
  damageType: DamageType;
  /** Chance (0..1) to deal double damage (silver shortsword). */
  critChance?: number;
  /** A single-use weapon that rolls this spec then is consumed (crossbow). */
  oneShotSpec?: string;
  /** This weapon's strikes ignore the target's resistances/immunities (Bastion sword form). */
  ignoreResist?: boolean;
  /** This weapon's strikes ignore worn armour entirely (Greatshield sword form). */
  ignoreArmor?: boolean;
  /**
   * Range-based accuracy (regular bow): a shot within `autoWithin` px always
   * hits; between there and `maxRange` px it hits with `farChance`; beyond
   * `maxRange` it cannot fire.
   */
  rangeAccuracy?: { autoWithin: number; maxRange: number; farChance: number };
  /**
   * Roll-to-hit weapon (crossbow): d20 versus DC = floor(distUnits) *
   * `dcPerUnit`. Damage is `rollSpec`, plus `bonusDice` when the to-hit roll is
   * below `bonusBelow`. Firing empties the chamber; `reloadTurns` turns to refill.
   */
  toHit?: {
    dcPerUnit: number;
    rollSpec: string;
    bonusDice?: string;
    bonusBelow?: number;
    reloadTurns: number;
  };
}

/**
 * A shield's defensive profile. Block is a passive ("unlimited reaction") damage
 * reduction against physical blows; bash is a once-per-duel automatic counter.
 */
export interface ShieldMod {
  /** Fraction of incoming physical/magical damage removed while the shield is active. */
  blockPct: number;
  /** Flat physical armour added while the shield is active. */
  armorFlat: number;
  /** Flat magic armour added while the shield is active. */
  magicFlat?: number;
  /** Multiplier on the wielder's Strength swing for the once-per-duel bash (blunt). */
  bashMult: number;
}

/** How worn armour soaks incoming physical damage. */
export interface ArmorMod {
  /** Flat reduction of physical-type damage (pierce/slash/shatter), pre-halving. */
  flat: number;
  /** Flat reduction of magical-type damage (shadow/corrosive). */
  magicFlat?: number;
  /** Damage types whose (post-flat) amount is halved. */
  halveTypes?: DamageType[];
}

/**
 * Damage-type resistances granted by an item. Multipliers stack multiplicatively
 * across all equipped gear and apply AFTER flat armour:
 *   - immune: ×0   (fully negated)
 *   - resist: ×0.5
 *   - weak:   ×2
 */
export interface ResistMod {
  immune?: DamageType[];
  resist?: DamageType[];
  weak?: DamageType[];
}

/** Flat additive tweaks an item makes to a mage's combat stats. */
export interface StatMods {
  str?: number;
  dex?: number;
  int?: number;
}

export interface ItemDef {
  id: ItemId;
  name: string;
  slot: ItemSlot;
  /** Rarity tier, driving the shop draft. */
  rarity: Rarity;
  /** Price in SILVER (10 silver = 1 gold). Vestigial under the draft shop. */
  cost: number;
  weight: number;
  blurb: string;
  /** Wands don't block spellcasting even though they fill a hand slot. */
  isWand?: boolean;
  weapon?: WeaponMod;
  armor?: ArmorMod;
  /** Damage-type resistances / immunities / weaknesses (multiplicative, post-armour). */
  resist?: ResistMod;
  /** Flat stat tweaks (Caster Robe, rings, bracelet). */
  statMods?: StatMods;
  /** Mana wand: word-spells cost this much less mana. */
  manaDiscount?: number;
  /** Witch wand: debuffs you apply last twice as long. */
  doubleDebuffs?: boolean;
  /** Consumable potion, drunk as a bonus action. */
  potion?: 'mana' | 'health';
  /** Arrows: stack as a numeric count and fuel bows. */
  ammo?: boolean;
  /** Gain this much mana whenever you take damage (Channeling Ring). */
  manaOnHit?: number;
  /** Multiplicative max-HP factor applied once on equip (0.8 = -20%). */
  hpMult?: number;
  /** Multiplicative max-sanity factor applied once on equip. */
  sanityMult?: number;
  /** Multiplicative move-range factor (0.5 = -50% movement). */
  moveMult?: number;
  /** Flat max-HP change applied once on equip (negative = fragile). */
  hpFlat?: number;
  /** Multiplies HP healing this mage receives (Blood Charm). */
  healMult?: number;
  /** Battle Robe: gain mana equal to the melee damage you deal. */
  manaPerMeleeDmg?: boolean;
  /** Reflect this much damage onto anyone who melee-strikes you (Thorn Ring). */
  thorns?: number;
  /** Fully negate sanity hits whose amount is below this (Aluminium Hat). */
  sanityWardBelow?: number;
  /** A failed spell heals you this much (Soul Battery). */
  onFizzleHeal?: number;
  /** A failed spell grants you this much mana (Soul Locket). */
  onFizzleMana?: number;
  /** A failed spell boosts your next basic attack by this fraction (Tantrum Gloves). */
  onFizzleRage?: number;
  /** Extra dagger-damage fraction while veiled (Assassin's Cloak). */
  veiledDaggerBonus?: number;
  /** Momentum Boots: +1 RANGE_UNIT of move per consecutive turn moved. */
  momentumBoots?: boolean;
  /** Anchor Boots: +1 flat armour per consecutive turn stationary (cap 4). */
  anchorBoots?: boolean;
  /** Shield profile (Buckler; Bastion's shield form). */
  shield?: ShieldMod;
  /** Basic-attack profile used while this item is in shield form (Greatshield). */
  shieldWeapon?: WeaponMod;
  /** What this weapon does when its owner takes the Weapon Action. */
  weaponAbility?: 'bastionSwap' | 'mutivargZone';
  /** This weapon's basic attack is a bonus action (Gambler's Blade). */
  bonusActionAttack?: boolean;
  /** Earn floor(1d3) gold whenever its wielder deals any damage (Gambler's Blade). */
  gamblerGold?: boolean;
  // ---- New-catalogue mechanics --------------------------------------------
  /** Reduce every incoming mental (sanity) hit by this flat amount (Neforpubi's Headpiece). */
  mentalReduce?: number;
  /** Cap on how much this mage can be slowed, as a fraction (Gaze Timez: 0.75). */
  slowCapPct?: number;
  /** Once per combat, gain 1d3 mana when mental (mill) damage is dealt or taken — Gaze Timez. */
  millManaOnce?: boolean;
  /** Flat bonus to strength-based melee damage (Fighter's Gloves). */
  meleeDamageBonus?: number;
  /** Carried items weigh nothing while this is equipped (Bag of Holding). */
  bagOfHolding?: boolean;
  /** First spell each combat that contains a black word costs 0 mana (Dark Mage's Cape). */
  firstBlackSpellFree?: boolean;
  /** Casting through this wand doubles the spell's mana cost (Mutivarg's Rod). */
  doublesSpellCost?: boolean;
  /** Casting through this wand burns this fraction of the target's current mana (Mutivarg's Rod). */
  manaBurnPct?: number;
  /** A thrown consumable: bonus action to hurl for `rollSpec` damage within `rangePx`, then consumed. */
  throwable?: { rollSpec: string; rangePx: number };
  /** Grants the "Eldritch" main action (Mantle of Eldritch Truth). */
  eldritchMantle?: boolean;
  /** Grants the Roaring Thunder stack engine + Charge Up / Discharge bonus actions. */
  thunderBlessing?: boolean;
  /** A one-time reaction that stifles an ability/weapon attack and bans it forever (Needle of Serenity). */
  needleOfSerenity?: boolean;
  /** Untouchable to all hostile effects during turn cycles 3 and 4 (Second Ring of Lareneg). */
  laranegRing?: boolean;
}

const U = RANGE_UNIT;
/** Convert a gold price to silver for the catalog. */
const g = (gold: number): number => gold * SILVER_PER_GOLD;

export const ITEM_DEFS: ItemDef[] = [
  // ---- Legendary ----------------------------------------------------------
  {
    id: 'roaringThunder',
    name: 'Blessing of Roaring Thunder',
    slot: 'utility',
    rarity: 'legendary',
    cost: g(0),
    weight: 0,
    blurb:
      '−15% max HP and max sanity. Each word you cast (even on a failure) adds a Thunder stack, which reshapes your speed and, past 9 stacks, sears you every turn; 15 stacks kills you in an explosion. Charge Up (bonus): spend mana + 1d6 true damage to roll d4 extra stacks & color charges. Discharge (bonus): dump all stacks as bouncing lightning (1d3 per stack).',
    hpMult: 0.85,
    sanityMult: 0.85,
    thunderBlessing: true,
  },
  // ---- Lareneg ------------------------------------------------------------
  {
    id: 'needleOfSerenity',
    name: 'Needle of Serenity',
    slot: 'utility',
    rarity: 'lareneg',
    cost: g(0),
    weight: 0,
    blurb:
      'One-time reaction to an ability or a weapon attack: stifle that action (it never happens). Whatever was stifled can never be used against you again — a weapon is disabled for good (all copies of that item), an ability (dodge, colour ability, or the unarmed strike) is disabled for good. Base mechanics like walking and casting spells cannot be stifled.',
    needleOfSerenity: true,
  },
  {
    id: 'secondRingOfLareneg',
    name: 'Second Ring of Lareneg',
    slot: 'accessory',
    rarity: 'lareneg',
    cost: g(0),
    weight: 0,
    blurb:
      'During turn cycles 3 and 4 you cannot be affected by anything hostile — no damage, stuns, movement impairment, or debuffs. You basically do not exist to anything hostile.',
    laranegRing: true,
  },
  {
    id: 'eldritchMantle',
    name: 'Mantle of Eldritch Truth',
    slot: 'torso',
    rarity: 'legendary',
    cost: g(0),
    weight: 0,
    blurb:
      'Grants the "Eldritch" main action: Attack (10 true damage to any target at any range), Defend (cancel all damage to you until your next turn), or Restore (regain 5 HP, 10 mana and 2 charges of each word).',
    eldritchMantle: true,
  },
  {
    id: 'bastionSword',
    name: 'Greatshield of <Redacted>',
    slot: 'hand',
    rarity: 'legendary',
    cost: g(0),
    weight: 0,
    blurb:
      'Weapon Action toggles form (both forms: -25% move). Shield: +2 physical & +2 magic armour, block reaction removes 67% of a physical/magical blow, enables shield-bash, and strikes at -50% Strength (shatter). Sword: +1 range and a +100% Strength slashing strike that fully ignores armour & resistances — but disables bag actions & weapon swaps and cannot be dropped.',
    moveMult: 0.75,
    weaponAbility: 'bastionSwap',
    weapon: {
      rangePx: MELEE_RANGE + U,
      kind: 'strength',
      multiplier: 2,
      damageType: 'slashing',
      ignoreResist: true,
      ignoreArmor: true,
    },
    shieldWeapon: {
      rangePx: MELEE_RANGE,
      kind: 'strength',
      multiplier: 0.5,
      damageType: 'shatter',
    },
    shield: { blockPct: 0.67, armorFlat: 2, magicFlat: 2, bashMult: 0.5 },
  },
  // ---- Unreal -------------------------------------------------------------
  {
    id: 'mutivargRod',
    name: "Mutivarg's Rod",
    slot: 'hand',
    rarity: 'unreal',
    cost: g(0),
    weight: 4,
    blurb:
      'Wand (never blocks casting). Casting through it doubles the spell\u2019s mana cost and burns 20% of the target\u2019s current mana. Weapon Action (bonus): pay 25% of your mana (fails at \u22643 paid) to raise a crushing slow / root circle that grinds everyone inside for two of your turns.',
    isWand: true,
    weaponAbility: 'mutivargZone',
    doublesSpellCost: true,
    manaBurnPct: 0.2,
  },
  {
    id: 'fightersGloves',
    name: "Fighter's Gloves",
    slot: 'accessory',
    rarity: 'unreal',
    cost: g(0),
    weight: 2,
    blurb: '+1 physical armour and +1 melee damage.',
    armor: { flat: 1 },
    meleeDamageBonus: 1,
  },
  {
    id: 'dwarfCrossbow',
    name: 'Crossbow',
    slot: 'hand',
    rarity: 'epic',
    cost: g(0),
    weight: 7,
    blurb:
      'Roll d20 to hit versus DC = distance(tiles) \u00d7 2. Damage 2d10+1 (+1d6 if the to-hit roll is under 10). Starts combat loaded; takes 2 turns to reload after firing.',
    weapon: {
      rangePx: 10 * U,
      kind: 'strength',
      damageType: 'pierce',
      toHit: { dcPerUnit: 2, rollSpec: '2d10+1', bonusDice: '1d6', bonusBelow: 10, reloadTurns: 2 },
    },
  },
  {
    id: 'bagOfHolding',
    name: 'Bag of Holding',
    slot: 'utility',
    rarity: 'unreal',
    cost: g(0),
    weight: 3,
    blurb:
      'Everything you carry weighs nothing \u2014 carry unlimited weapons, armour, accessories and potions.',
    bagOfHolding: true,
  },
  // ---- Epic ---------------------------------------------------------------
  {
    id: 'woodenBow',
    name: 'Wooden Bow',
    slot: 'hand',
    rarity: 'epic',
    cost: g(0),
    weight: 1,
    blurb:
      'Dex attack +3 (pierce). Always hits within 15 tiles; 50% chance to hit from 16\u201320 tiles; cannot reach farther. Consumes an arrow per shot.',
    weapon: {
      rangePx: 20 * U,
      kind: 'dex',
      dexBonus: 3,
      usesArrows: true,
      damageType: 'pierce',
      rangeAccuracy: { autoWithin: 15 * U, maxRange: 20 * U, farChance: 0.5 },
    },
  },
  {
    id: 'neforpubiHeadpiece',
    name: "Neforpubi's Headpiece",
    slot: 'head',
    rarity: 'epic',
    cost: g(0),
    weight: 1,
    blurb: 'Reduce all incoming mental (sanity) damage by 1.',
    mentalReduce: 1,
  },
  {
    id: 'gazeTimezBracelet',
    name: 'Gaze Timez Bracelet',
    slot: 'accessory',
    rarity: 'epic',
    cost: g(0),
    weight: 2,
    blurb:
      'You cannot be slowed by more than 75% (roots / shatter-reality disable movement outright and are unaffected). Once per combat, gain 1d3 mana when mental (mill) damage is dealt or taken \u2014 yours or the enemy\u2019s.',
    slowCapPct: 0.75,
    millManaOnce: true,
  },
  {
    id: 'finesseDagger',
    name: 'Finesse Dagger',
    slot: 'hand',
    rarity: 'epic',
    cost: g(0),
    weight: 1,
    blurb:
      'Dex attack (pierce): floor((d20 + dex + bonus \u2212 10) / 2), where the bonus is 50% of your Dex.',
    weapon: {
      rangePx: MELEE_RANGE,
      kind: 'dex',
      dexBonusPct: 0.5,
      damageType: 'pierce',
    },
  },
  // ---- Rare ---------------------------------------------------------------
  {
    id: 'razorSword',
    name: 'Razor Sword',
    slot: 'hand',
    rarity: 'rare',
    cost: g(0),
    weight: 2,
    blurb: '+1 tile of melee range and +50% Strength damage (slashing).',
    weapon: {
      rangePx: MELEE_RANGE + U,
      kind: 'strength',
      multiplier: 1.5,
      damageType: 'slashing',
    },
  },
  {
    id: 'buckler',
    name: 'Buckler',
    slot: 'hand',
    rarity: 'rare',
    cost: g(0),
    weight: 2,
    blurb:
      'Counts as a shield: +1 physical armour, block reaction removes 33% of a physical/magical blow, enables shield-bash. Strikes at 25% Strength (shatter).',
    weapon: {
      rangePx: MELEE_RANGE,
      kind: 'strength',
      multiplier: 0.25,
      damageType: 'shatter',
    },
    shield: { blockPct: 0.33, armorFlat: 1, bashMult: 0.5 },
  },
  {
    id: 'darkMagesCape',
    name: "Dark Mage's Cape",
    slot: 'torso',
    rarity: 'rare',
    cost: g(0),
    weight: 1,
    blurb: 'The first spell you cast each combat is free (0 mana) if it contains a black word.',
    firstBlackSpellFree: true,
  },
  // ---- Consumeable --------------------------------------------------------
  {
    id: 'throwingDagger',
    name: 'Throwing Dagger',
    slot: 'utility',
    rarity: 'consumeable',
    cost: g(1),
    weight: 1,
    blurb: 'Bonus action: hurl for 1d3 pierce at a target within 10 tiles, then consumed.',
    throwable: { rollSpec: '1d3', rangePx: 10 * U },
  },
  {
    id: 'arrow',
    name: 'Arrow',
    slot: 'utility',
    rarity: 'consumeable',
    cost: 5, // silver
    weight: 0,
    blurb: 'Ammunition for bows, consumed on each bow shot.',
    ammo: true,
  },
  {
    id: 'manaPotion',
    name: 'Mana Potion',
    slot: 'utility',
    rarity: 'consumeable',
    cost: g(3),
    weight: 1,
    blurb: 'Bonus action: restore 10 mana, then consumed.',
    potion: 'mana',
  },
  {
    id: 'healthPotion',
    name: 'Health Potion',
    slot: 'utility',
    rarity: 'consumeable',
    cost: g(4),
    weight: 1,
    blurb: 'Bonus action: heal 2d3 HP, then consumed.',
    potion: 'health',
  },
];

const ITEM_BY_ID: Record<ItemId, ItemDef> = ITEM_DEFS.reduce((acc, def) => {
  acc[def.id] = def;
  return acc;
}, {} as Record<ItemId, ItemDef>);

export function getItem(id: ItemId): ItemDef {
  return ITEM_BY_ID[id];
}

/** A list is a valid {@link ItemId} array (used to sanitise networked carts). */
export function asItemIds(value: unknown): ItemId[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is ItemId => typeof v === 'string' && v in ITEM_BY_ID);
}

/** Format a silver amount as a friendly gold/silver string. */
export function formatMoney(silver: number): string {
  const gold = Math.floor(silver / SILVER_PER_GOLD);
  const rem = silver % SILVER_PER_GOLD;
  if (gold && rem) return `${gold}g ${rem}s`;
  if (gold) return `${gold}g`;
  return `${rem}s`;
}

/** Carry capacity (kg) for a given Strength score. */
export function carryCapacity(strength: number): number {
  return BASE_CARRY_KG + strength;
}

/** Empty per-slot tally. */
function emptySlotCounts(): Record<ItemSlot, number> {
  return { hand: 0, head: 0, torso: 0, boots: 0, accessory: 0, utility: 0 };
}

/**
 * Trim a desired cart down to a *legal* loadout: the per-slot capacities and
 * the carry capacity (weight). A Bag of Holding in the cart lifts the weight
 * limit entirely. Items are considered in order and each is kept only if it
 * still fits. Deterministic, so both peers sanitise a cart to the same result.
 */
export function sanitizeCart(items: ItemId[], strength: number, budget = Infinity): ItemId[] {
  const cap = carryCapacity(strength);
  const hasBag = items.some((id) => !!ITEM_BY_ID[id]?.bagOfHolding);
  const kept: ItemId[] = [];
  const counts = emptySlotCounts();
  let spent = 0;
  let weight = 0;
  for (const id of items) {
    const def = ITEM_BY_ID[id];
    if (!def) continue;
    if (spent + def.cost > budget) continue;
    if (!hasBag && weight + def.weight > cap) continue;
    // Hand items are never dropped for exceeding the slot cap: they all go into
    // the bag at equip time and are equipped/unequipped by hand during the duel.
    // Only worn/accessory slots enforce their capacity at purchase.
    if (def.slot !== 'hand' && counts[def.slot] >= SLOT_CAPS[def.slot]) continue;
    kept.push(id);
    spent += def.cost;
    weight += def.weight;
    counts[def.slot] += 1;
  }
  return kept;
}

// ---- Rarity draft ---------------------------------------------------------

/** How many 1-of-3 picks each duellist drafts before the duel. */
export const DRAFT_ROUNDS = 8;

/** Rarity-tier ordinal (0 = common, 6 = legendary). */
export function rarityRank(rarity: Rarity): number {
  return RARITY_ORDER.indexOf(rarity);
}

/** All catalogue items of a given rarity tier. */
export function itemsOfRarity(rarity: Rarity): ItemDef[] {
  return ITEM_DEFS.filter((d) => d.rarity === rarity);
}

/**
 * Roll a rarity tier. Rarer tiers are less likely; each point of Luck nudges the
 * roll slightly toward rarer tiers. Only tiers that contain items are eligible.
 * `rng` returns a float in [0, 1).
 */
export function rollRarity(rng: () => number, luck = 0): Rarity {
  const tiers = RARITY_ORDER.filter((r) => itemsOfRarity(r).length > 0);
  const weights = tiers.map((r) => RARITY_WEIGHT[r] * (1 + Math.max(0, luck) * 0.02 * rarityRank(r)));
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rng() * total;
  for (let i = 0; i < tiers.length; i++) {
    x -= weights[i];
    if (x <= 0) return tiers[i];
  }
  return tiers[tiers.length - 1];
}

/** Pick up to `count` distinct items of `rarity` to offer as draft choices. */
export function draftChoices(rarity: Rarity, rng: () => number, count = 3): ItemId[] {
  const pool = itemsOfRarity(rarity).map((d) => d.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

/** A random AI draft: for each round, roll a rarity and take a random option. */
export function aiDraft(luck: number, rounds = DRAFT_ROUNDS, rng: () => number = Math.random): ItemId[] {
  const picks: ItemId[] = [];
  for (let r = 0; r < rounds; r++) {
    const rarity = rollRarity(rng, luck);
    const options = draftChoices(rarity, rng);
    if (options.length) picks.push(options[Math.floor(rng() * options.length)]);
  }
  return picks;
}
