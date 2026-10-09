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
import type { HitEffect } from '../effects/classKit';
import { isCraftedItemId, resolveCraftedItem, type CraftedInfo } from './crafting/item';
import { isHexItemId, PAPER_COST, resolveHexItem } from './hexcraft/item';
import type { HexRecipe, PaperKind } from './hexcraft/runes';
import {
  BASE_CARRY_KG,
  MELEE_RANGE,
  RANGE_UNIT,
  SILVER_PER_GOLD,
} from '../config/constants';

export type ItemSlot = 'hand' | 'head' | 'torso' | 'boots' | 'accessory' | 'utility';

/**
 * Which toggleable catalogue an item belongs to. The start screen lets players
 * enable/disable whole sets before a duel; the draft only offers items whose
 * set is active. Untagged items default to 'original'.
 *   - original: the base Dimir catalogue.
 *   - finns:    Finn's Additions (extra sidegrade gear).
 *   - dlc:      Dimir Faithful DLC (Buckler, Throwing Dagger).
 */
export type ItemSet = 'original' | 'finns' | 'dlc' | 'conjured';

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
  | 'moonfireBow'
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
  | 'deathsAngelWings'
  | 'shadowDagger'
  | 'roaringThunder'
  | 'needleOfSerenity'
  | 'secondRingOfLareneg'
  | 'throwingDagger'
  | 'ironwallGreatshield'
  | 'lungingEdge'
  | 'warHammer'
  | 'runicMaul'
  // ---- Dimir Faithful DLC (wards & cleansing) ----
  | 'oathboundMail'
  | 'faithkeepersSigil'
  | 'wardingBeads'
  | 'creedOfTheUnyielding'
  | 'chaliceOfClearWater'
  | 'arrow'
  | 'manaPotion'
  | 'healthPotion'
  | 'sandPocket'
  | 'torch'
  | 'lantern'
  | 'edgelordLantern'
  // ---- Materials (mined or salvaged; carried cargo, sold in towns) ----
  | 'oreCoal'
  | 'oreCopper'
  | 'oreIron'
  | 'oreGold'
  | 'crudeTrinket'
  | 'chargedScale'
  | 'stoneHeart'
  | 'sentinelLens'
  | 'magmaCore'
  | 'redStone'
  | 'darkEye'
  | 'batLeather'
  | 'redDrakeScale'
  | 'blackDrakeScale'
  // ---- Finn's Additions ----
  | 'bloodCharm'
  | 'bloodRing'
  | 'momentumBoots'
  | 'smartRing'
  | 'gamblersBlade'
  | 'gamblersCurse'
  | 'anchorBoots'
  | 'battleRobe'
  | 'soulBattery'
  | 'soulLocket'
  | 'tantrumGloves'
  | 'thornRing'
  | 'aluminiumHat'
  | 'assassinsCloak'
  // ---- Rare additions (original set) ----
  | 'channelingRing'
  | 'ironCap'
  | 'travelerBoots'
  | 'silverShortsword'
  | 'manaWand'
  // ---- Rare additions (original set) ----
  | 'wordVial'
  // ---- Conjured (never drafted; created by Objects class spells) ----
  | 'conjuredVeilBow'
  | 'conjuredBlackBell'
  | 'conjuredAcidJavelin'
  | 'conjuredRotHammer'
  | 'conjuredHarpoon'
  | 'conjuredWrenchingBow'
  | 'conjuredBreachingArbalest'
  | 'conjuredHushVial'
  | 'conjuredSnareBolas'
  | 'conjuredHollowMaul'
  | 'conjuredSiphonMaul'
  | 'conjuredGlassLongbow'
  | 'conjuredHushingHammer'
  | 'conjuredCalcifiedBuckler'
  | 'conjuredHollowDart'
  | 'conjuredPlagueSpear'
  | 'conjuredMarrowdrinker'
  | 'conjuredGravebreaker'
  | 'conjuredArcBrand'
  | 'conjuredTwinblades'
  | 'conjuredGrapnel'
  | 'conjuredSplinterJavelin'
  | 'conjuredThornbow'
  | 'conjuredLeechingRapier'
  | 'conjuredBoneLongbow'
  | 'conjuredSilencerCrossbow'
  | 'conjuredCorkscrewLance'
  | 'conjuredLeechingChakram'
  | 'conjuredHookblade'
  | 'conjuredStakeCrossbow'
  | 'conjuredBloodhookHarpoon'
  | 'conjuredThornwhip'
  | 'conjuredSplinterbow'
  | 'conjuredBonebreakerPike'
  | 'conjuredHarvestersGlaive'
  | 'conjuredThornspitter'
  | 'conjuredBloodhammer'
  | 'conjuredLeechingBuckler'
  | 'conjuredGravedrinker'
  | 'conjuredOssuaryMaul'
  // ---- Mine creatures (never offered to players) ----
  | 'crudeSpear'
  | 'stoneSpear'
  | 'ironSpear'
  | 'primitiveClub'
  | 'stoneAxe'
  | 'ironAxe'
  // ---- Adventure gear (sold and forged in Exploration towns only) ----
  | 'travellersDagger'
  | 'quarterstaff'
  | 'shortsword'
  | 'huntingBow'
  | 'ironShortsword'
  | 'apprenticeWand'
  | 'forgedWarAxe'
  | 'leatherCap'
  | 'paddedJerkin'
  | 'leatherBoots'
  | 'chainShirt'
  | 'ironGreaves'
  | 'emberplate'
  | 'drakescaleHelm'
  | 'copperRing'
  | 'ironBand'
  | 'quicksilverAnklet'
  | 'rubyPendant'
  | 'sapphireRing'
  | 'emeraldCharm'
  | 'onyxAmulet'
  | 'amethystCirclet'
  | 'stillsuit'
  // ---- Adventure materials: gems and herbs ----
  | 'gemRuby'
  | 'gemSapphire'
  | 'gemEmerald'
  | 'gemAmethyst'
  | 'gemOnyx'
  | 'gemDiamond'
  | 'gemPearl'
  | 'herbMoonglow'
  | 'herbWaterleaf'
  | 'herbDeathweed'
  | 'herbFireblossom'
  // ---- Adventure drops: what fallen creatures leave, sold at guilds ----
  | 'manaStoneSmall'
  | 'manaStoneMedium'
  | 'manaStoneBig'
  | 'ectoplasm'
  | 'darksteelBar'
  | 'ghastEssence'
  | 'lichCore'
  | 'reaperCore'
  | 'rabbitPelt'
  | 'slimeGel'
  | 'wolfPelt'
  | 'wolfFang'
  | 'boarHide'
  | 'boarTusk'
  | 'lionPelt'
  | 'lionFang'
  | 'spiderLeg'
  | 'hugeSpiderLeg'
  | 'gigantuanSpiderLeg'
  | 'silk'
  | 'fineSilk'
  | 'koboldScale'
  | 'demonHorn'
  | 'badCharm'
  | 'magmaShardTank'
  | 'magmaShardHealer'
  | 'magmaShardMage'
  | 'gelRed'
  | 'gelBlue'
  | 'gelBlack'
  | 'gelWhite'
  | 'wood'
  | 'voidShard'
  | 'beastHorn'
  | 'pebble'
  | 'lostSoul'
  // ---- Adventure tools ----
  | 'pickaxe'
  // ---- Adventure bags and key items ----
  | 'smallBag'
  | 'goodBag'
  | 'mineMap'
  // ---- Hexcraft paper ----
  | 'paper'
  | 'finePaper'
  | 'hexCodex'
  // ---- Bloodmoon boss materials ----
  | 'moonshardWhite'
  | 'moonshardBlue'
  | 'moonshardBlack'
  | 'moonshardRed'
  | 'moonshardGreen'
  // ---- Adventure staffs ----
  | 'rubyStaff'
  | 'sapphireStaff'
  | 'emeraldStaff'
  | 'amethystStaff'
  | 'onyxStaff'
  | 'diamondStaff'
  | 'geodeStaff'
  | 'lensStaff'
  | 'surgeStaff'
  | 'thriftStaff'
  | 'farStaff'
  | 'hexStaff'
  | 'prismStaff'
  // ---- Crafted at a bench: the id spells the whole item out (crafting/item.ts) ----
  | `craft:${string}`
  // ---- A drawn Hexzettel: the id spells the sheet out (hexcraft/item.ts) ----
  | `hex:${string}`;

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
  consumeable: 35,
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
  /** On a landed strength strike, shove the target back this many range-units (War Hammer). */
  knockbackUnits?: number;
  /** After landing a strike, the attacker may dash this many range-units (Lunging Edge). */
  dashAfterHitUnits?: number;
  /** +1 damage per `per` px the wielder moved this turn before the strike, up to `max`. */
  charge?: { per: number; max: number };
  /** +1 damage per this many px of the wielder's move range. */
  moveScaled?: number;
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

/** True when a basic weapon strike can reach an airborne target. */
export function isRangedWeapon(weapon: WeaponMod | null | undefined): boolean {
  return !!(
    weapon?.usesArrows ||
    weapon?.rangeAccuracy ||
    weapon?.toHit ||
    weapon?.oneShotSpec
  );
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

/** A staff's own bolt: a main action that costs mana and rolls no cast check. */
export interface StaffBolt {
  label: string;
  mana: number;
  sides: number;
  /** Added to the Int-scaled dice count (never below one die). */
  diceDelta?: number;
  type: DamageType;
  rangePx: number;
  /** The aimed foe plus the nearest others in range, this many in all. Default 1. */
  targets?: number;
  /** What a landed bolt also does to the struck. */
  onHit?: HitEffect[];
}

/** What holding a staff does to every word spell cast through it. */
export interface CastThrough {
  /** Multiplies the damage of each spell hit. */
  damageMult?: number;
  /** Added to every spell's mana cost (negative is cheaper; a cost never drops below 0). */
  manaDelta?: number;
  /** Added to every spell's reach, in px. */
  rangePx?: number;
  /** A spell hit leaves this on the struck: extra damage taken for a while. */
  hex?: { name: string; damageTaken: number; duration: number };
  /** This share of each spell hit lands as `type` instead. */
  split?: { share: number; type: DamageType };
}

/** Dice in a staff bolt: one, plus one per 10 Int, plus the bolt's own adjustment; never fewer than one. */
export function staffDice(int: number, bolt: StaffBolt): number {
  return Math.max(1, 1 + Math.floor(Math.max(0, int) / 10) + (bolt.diceDelta ?? 0));
}

export interface ItemDef {
  id: ItemId;
  name: string;
  slot: ItemSlot;
  /** Which toggleable catalogue this item belongs to (defaults to 'original'). */
  set?: ItemSet;
  /** Rarity tier, driving the shop draft. */
  rarity: Rarity;
  /** Price in SILVER (10 silver = 1 gold). Vestigial under the draft shop. */
  cost: number;
  weight: number;
  blurb: string;
  /** Wands don't block spellcasting even though they fill a hand slot. */
  isWand?: boolean;
  /** Weapon family (bow, hammer...), for anything that picks weapons by kind. */
  weaponFamily?: 'bow' | 'hammer';
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
  /**
   * Debuff RESISTANCE: multiplies the duration of every affliction landed on the
   * wearer (debuff / DoT / aura-DoT / stun / control). Stacks multiplicatively;
   * a scaled duration never drops below one cycle.
   */
  debuffDurationMult?: number;
  /** Debuff IMMUNITY: every status-shaped effect (harmful or not) slides off. */
  debuffImmunity?: boolean;
  /** Grants the Cleanse bonus action, stripping the wearer's afflictions for this much mana. */
  cleanseManaCost?: number;
  /** Consumable potion, drunk as a bonus action. */
  potion?: 'mana' | 'health' | 'word';
  /** Arrows: stack as a numeric count and fuel bows. */
  ammo?: boolean;
  /**
   * Mined ore or salvaged remains. Carried cargo: never drafted or offered in a
   * shop's buy list, sold by weight-vs-value judgement, reserved for crafting.
   */
  material?: boolean;
  /** Gain this much mana whenever you take damage (Channeling Ring). */
  manaOnHit?: number;
  /** Mana held in it, given to its bearer as an Exploration fight begins. */
  fightStartMana?: number;
  /** Stuns and disarms do not take hold on its bearer (roots still do). */
  stunProof?: boolean;
  /** Its bearer cannot be pushed, pulled, turned or knocked back. */
  immovable?: boolean;
  /** Extra dodges each fight. */
  extraDodges?: number;
  /** HP its bearer heals at the start of each of their turns. */
  regen?: number;
  /** Its bearer gathers a stone each turn, up to this many; their next landed strike hurls them, +1 damage each. */
  gatherStones?: number;
  /** Sand Pocket: stores up to 3kg of loose sand. */
  sandPocket?: boolean;
  /** Multiplicative max-HP factor applied once on equip (0.8 = -20%). */
  hpMult?: number;
  /** Multiplicative max-sanity factor applied once on equip. */
  sanityMult?: number;
  /** Multiplicative move-range factor (0.5 = -50% movement). */
  moveMult?: number;
  /** Flat max-HP change applied once on equip (negative = fragile). */
  hpFlat?: number;
  /** Multiplies HP healing this mage receives (Blood Ring). */
  healMult?: number;
  /** Each spell you cast drains this fraction of your max HP (Blood Charm). */
  spellHealthCostPct?: number;
  /** Spells you cast heal you for this fraction of the damage dealt (Blood Charm). */
  spellLifestealPct?: number;
  /** Melee hits heal you for this much (before healMult) (Blood Ring). */
  meleeHealOnHit?: number;
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
  weaponAbility?: 'bastionSwap' | 'mutivargZone' | 'gamblerCash' | 'blackBellMode' | 'shadowDaggerTeleport';
  /** Occupies both hands even though it is represented by one item id. */
  twoHanded?: boolean;
  /** This weapon's basic attack is a bonus action (Gambler's Blade). */
  bonusActionAttack?: boolean;
  /** Gambler's Blade: each hit (melee or spell) grants 1d3 Greed stacks. */
  gamblerGreed?: boolean;
  // ---- New-catalogue mechanics --------------------------------------------
  /** Reduce every incoming mental (sanity) hit by this flat amount (Neforpubi's Headpiece). */
  mentalReduce?: number;
  /** Cap on how much this mage can be slowed, as a fraction (Gaze Timez: 0.75). */
  slowCapPct?: number;
  /** Once per combat, gain 1d3 mana when mental (mill) damage is dealt or taken — Gaze Timez. */
  millManaOnce?: boolean;
  /** Flat bonus to strength-based melee damage (Fighter's Gloves). */
  meleeDamageBonus?: number;
  /** A bag: the pack's slot count while carried, and what the things inside it weigh (Bag of Holding: 75%). */
  pack?: { slots: number; weightMult?: number };
  /** A key item: takes no pack slot, is never sold or dropped. */
  keyItem?: boolean;
  /** A tool (pickaxe): one to a pack slot. */
  tool?: boolean;
  /** Made at a crafting bench: how, of what, and with which roll. */
  crafted?: CraftedInfo;
  /** A blank sheet a Hexcraft mage can draw a hex on. */
  paper?: PaperKind;
  /** A drawn Hexzettel: the hex it looses. */
  hexzettel?: HexRecipe;
  /** Staff bolts held in hand: each is one main-action choice. */
  staffBolts?: StaffBolt[];
  /** Changes every word spell cast while this is held. */
  castThrough?: CastThrough;
  /** First spell each combat that contains a black word costs 0 mana (Dark Mage's Cape). */
  firstBlackSpellFree?: boolean;
  /** Casting through this wand doubles the spell's mana cost (Mutivarg's Rod). */
  doublesSpellCost?: boolean;
  /** Casting through this wand burns this fraction of the target's current mana (Mutivarg's Rod). */
  manaBurnPct?: number;
  /** A thrown consumable: bonus action to hurl at a unit within `rangePx`, then consumed. */
  throwable?: {
    rangePx: number;
    /** Damage dice; a throw without them only carries its hit effects. */
    rollSpec?: string;
    type?: DamageType;
    onHit?: HitEffect[];
  };
  /** Grants the "Eldritch" main action (Mantle of Eldritch Truth). */
  eldritchMantle?: boolean;
  /** Grants kill Energy, temporary flight, a life-draining aura and execution. */
  deathsAngelWings?: boolean;
  /** Shadow teleport toll and round-based stealth upkeep for Dagger of Shadow. */
  shadowDagger?: { teleportManaCost: number; stealthManaPerRound: number };
  /** Grants the Roaring Thunder stack engine + Charge Up / Discharge bonus actions. */
  thunderBlessing?: boolean;
  /** Skews every d20 the bearer rolls: 1-3 become a natural 1, 18-20 a natural 20. */
  gamblersCurse?: boolean;
  /** A one-time reaction that stifles an ability/weapon attack and bans it forever (Needle of Serenity). */
  needleOfSerenity?: boolean;
  /** Untouchable to all hostile effects during turn cycles 3 and 4 (Second Ring of Lareneg). */
  laranegRing?: boolean;
  /** A torch/lantern: emits a light aura and swings as an unarmed light source. */
  lightSource?: boolean;
  /** Radius (px) of the light aura this source projects. */
  lightRadiusPx?: number;
  /** Lantern: the aura also shines while the item is merely stowed in the bag. */
  lightInBag?: boolean;
  /** Exclude this item from every draft/shop outside Swamprun. */
  swamprunOnly?: boolean;
  /** Only sold, forged or found in Exploration; never drafted anywhere. */
  adventureOnly?: boolean;
  /** Material subtype read by the Gem shop and the Apothecary. */
  materialKind?: 'gem' | 'herb';
  /** Creature equipment that is never offered or accepted as player gear. */
  enemyOnly?: boolean;
  /** Torch: number of combats a lit torch burns for before it is used up. */
  torchCombats?: number;
  /** A conjured Veil Corrode Pierce bow (Objects): veils its holder; special firing rider. */
  conjuredVeilBow?: boolean;
  /** Shadow Shatter Curse (Objects): low-damage hammer with Toll / Condense modes. */
  conjuredBlackBell?: boolean;
  /** Cursed, permanently-bound lantern with a toggleable dark-light prison. */
  edgelordLantern?: boolean;
  /** Item carries a curse whose drawbacks remain part of its identity. */
  cursed?: boolean;
  /** Once equipped, this item cannot be stowed or dropped. */
  permanentlyBinding?: boolean;
  /** Conjured for one fight: it fades when the fight is over. */
  fleeting?: boolean;
  /** What a landed basic attack with this weapon also does to the struck. */
  onHit?: HitEffect[];
  /** What holding or wearing this does to anyone who lands a basic attack on you. */
  onStruck?: HitEffect[];
}

const U = RANGE_UNIT;
/** Convert a gold price to silver for the catalog. */
const g = (gold: number): number => gold * SILVER_PER_GOLD;

// Blurb style: terse and uniform. Percentages over fractions. Fixed vocabulary:
// "Immunity to X" / "Resist X" (50%) / "Weak to X" (200%) / "Range Ncm" /
// "Bonus action:" / "Main action:" / "Weapon Action:" / "Reaction:" /
// "On hit:" / "On kill:" / "On cast:" / "On fizzle:" / "On damage taken:".

export const ITEM_DEFS: ItemDef[] = [
  // ---- Conjured (never offered in the shop; made by Objects class spells) --
  {
    id: 'conjuredBlackBell',
    name: 'Black Bell',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb:
      'Two-handed, 10% Strength shatter. Toll: +1d3 shadow DoT for 6 turns, 9 in shadow. Weapon Action: toggle Condense. Condense hit: remove all harmful statuses, deal all remaining DoT instantly as 50% shatter / 50% shadow, create a shadow +1cm per debuff removed.',
    conjuredBlackBell: true,
    twoHanded: true,
    weaponAbility: 'blackBellMode',
    weapon: {
      rangePx: MELEE_RANGE,
      kind: 'strength',
      multiplier: 0.1,
      damageType: 'shatter',
    },
  },
  {
    id: 'conjuredVeilBow',
    name: 'Conjured Veil Bow',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb:
      'Two-handed Dex bow, corrosive, range 15cm. Veils the holder while held. On fire: costs mana, veil breaks for 1 turn, slow on hit. Lasts 3 combats.',
    conjuredVeilBow: true,
    weapon: {
      rangePx: 15 * U,
      kind: 'dex',
      damageType: 'corrosive',
    },
  },
  // ---- Conjured for one fight by the Corrode class spells (Objects) --------
  {
    id: 'conjuredAcidJavelin',
    name: 'Acid Javelin',
    slot: 'utility',
    set: 'conjured',
    rarity: 'consumeable',
    cost: g(0),
    weight: 0,
    blurb: 'Bonus action: throw within 10cm for 1d6 pierce + 1d4 corrosive. Fades after the fight.',
    fleeting: true,
    throwable: { rollSpec: '1d6', rangePx: 10 * U, onHit: [{ k: 'damage', spec: '1d4', type: 'corrosive' }] },
  },
  {
    id: 'conjuredHollowDart',
    name: 'Hollow Dart',
    slot: 'utility',
    set: 'conjured',
    rarity: 'consumeable',
    cost: g(0),
    weight: 0,
    blurb: 'Bonus action: throw within 10cm for 1d4 pierce, then drain 1d4 corrosive (heals you). Fades after the fight.',
    fleeting: true,
    throwable: { rollSpec: '1d4', rangePx: 10 * U, onHit: [{ k: 'drain', spec: '1d4' }] },
  },
  {
    id: 'conjuredRotHammer',
    name: 'Rot Hammer',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb: '120% Strength shatter. On hit: +1d3 corrosive, +1 damage taken for 2 turns. Fades after the fight.',
    fleeting: true,
    weapon: { rangePx: MELEE_RANGE, kind: 'strength', multiplier: 1.2, damageType: 'shatter' },
    onHit: [{ k: 'damage', spec: '1d3', type: 'corrosive' }, { k: 'pitted', amount: 1, turns: 2 }],
  },
  {
    id: 'conjuredHarpoon',
    name: 'Rusted Harpoon',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb: 'Dex pierce, range 8cm. On hit: +1d3 corrosive, the target is tethered to you (3cm) for 2 turns. Fades after the fight.',
    fleeting: true,
    weapon: { rangePx: 8 * U, kind: 'dex', damageType: 'pierce' },
    onHit: [{ k: 'damage', spec: '1d3', type: 'corrosive' }, { k: 'tether', px: 3 * U, turns: 2 }],
  },
  {
    id: 'conjuredWrenchingBow',
    name: 'Wrenching Bow',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    weaponFamily: 'bow',
    blurb: 'Dex pierce, range 15cm, needs no arrows. On hit: the target is turned a quarter circle around you; a wall or the field edge stopping it adds 1d6 corrosive. Fades after the fight.',
    fleeting: true,
    weapon: {
      rangePx: 15 * U,
      kind: 'dex',
      damageType: 'pierce',
      rangeAccuracy: { autoWithin: 15 * U, maxRange: 15 * U, farChance: 1 },
    },
    onHit: [{ k: 'orbit', slam: { spec: '1d6', type: 'corrosive' } }],
  },
  {
    id: 'conjuredBreachingArbalest',
    name: 'Breaching Arbalest',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb: 'Dex pierce +30% damage, range 12cm, ignores armour, needs no bolts. On hit: +1d4 corrosive, 20% chance to stun for 2 turns. Fades after the fight.',
    fleeting: true,
    weapon: {
      rangePx: 12 * U,
      kind: 'dex',
      multiplier: 1.3,
      damageType: 'pierce',
      ignoreArmor: true,
      rangeAccuracy: { autoWithin: 12 * U, maxRange: 12 * U, farChance: 1 },
    },
    onHit: [{ k: 'damage', spec: '1d4', type: 'corrosive' }, { k: 'stun', turns: 2, chance: 0.2 }],
  },
  {
    id: 'conjuredCalcifiedBuckler',
    name: 'Calcified Buckler',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb: 'Shield: 20% block, +1 armour. Melee attackers who hit you are rooted for 2 turns and take +1 damage for 2 turns. Fades after the fight.',
    fleeting: true,
    shield: { blockPct: 0.2, armorFlat: 1, bashMult: 0.6 },
    onStruck: [{ k: 'root', turns: 2 }, { k: 'pitted', amount: 1, turns: 2 }],
  },
  {
    id: 'conjuredPlagueSpear',
    name: 'Plague Spear',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb: '150% Strength pierce, range 2cm. On hit against units Desecrate harms: +2d4 corrosive, no healing for 2 turns. Fades after the fight.',
    fleeting: true,
    weapon: { rangePx: 2 * U, kind: 'strength', multiplier: 1.5, damageType: 'pierce' },
    onHit: [{ k: 'affected', then: [{ k: 'damage', spec: '2d4', type: 'corrosive' }, { k: 'noHeal', turns: 2 }] }],
  },
  {
    id: 'conjuredMarrowdrinker',
    name: 'Marrowdrinker',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb: '130% Strength shatter. On hit: drain 50% of the damage dealt as corrosive (heals you). Fades after the fight.',
    fleeting: true,
    weapon: { rangePx: MELEE_RANGE, kind: 'strength', multiplier: 1.3, damageType: 'shatter' },
    onHit: [{ k: 'siphon', pct: 0.5 }],
  },
  {
    id: 'conjuredGravebreaker',
    name: 'Gravebreaker',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb: 'Two-handed, 160% Strength shatter. On hit against units Desecrate harms: +2d6 corrosive and the ground around them is fouled for 2 turns (1d6 corrosive, no healing). Fades after the fight.',
    fleeting: true,
    twoHanded: true,
    weapon: { rangePx: MELEE_RANGE, kind: 'strength', multiplier: 1.6, damageType: 'shatter' },
    onHit: [{
      k: 'affected',
      then: [{ k: 'damage', spec: '2d6', type: 'corrosive' }, { k: 'foul', radius: 2 * U, turns: 2, spec: '1d6' }],
    }],
  },
  // ---- Conjured for one fight by the Veil class spells (Objects) -----------
  {
    id: 'conjuredHushVial',
    name: 'Hush Vial',
    slot: 'utility',
    set: 'conjured',
    rarity: 'consumeable',
    cost: g(0),
    weight: 0,
    blurb: 'Bonus action: throw at a unit within 8cm. Drain 1d4 corrosive (heals you); its next action other than moving fails. Fades after the fight.',
    fleeting: true,
    throwable: { rangePx: 8 * U, onHit: [{ k: 'drain', spec: '1d4' }, { k: 'stifle' }] },
  },
  {
    id: 'conjuredSnareBolas',
    name: 'Snare Bolas',
    slot: 'utility',
    set: 'conjured',
    rarity: 'consumeable',
    cost: g(0),
    weight: 0,
    blurb: 'Bonus action: throw at a unit within 8cm. It is rooted for 3 turns, and you gain a half veil for 2 turns. Fades after the fight.',
    fleeting: true,
    throwable: { rangePx: 8 * U, onHit: [{ k: 'root', turns: 3 }, { k: 'veilSelf', turns: 2 }] },
  },
  {
    id: 'conjuredHollowMaul',
    name: 'Hollow Maul',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb: '120% Strength shatter. On hit: 1d3 shadow at the start of the target\'s turns for 4 turns; 20% chance to stun it for 2 turns. Fades after the fight.',
    fleeting: true,
    weapon: { rangePx: MELEE_RANGE, kind: 'strength', multiplier: 1.2, damageType: 'shatter' },
    onHit: [{ k: 'dot', name: 'Hollow Curse', spec: '1d3', turns: 4, type: 'shadow' }, { k: 'stun', turns: 2, chance: 0.2 }],
  },
  {
    id: 'conjuredSiphonMaul',
    name: 'Siphoning Maul',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb: '120% Strength shatter. On hit: drain 50% of the damage dealt as corrosive (heals you), then dash 2cm straight away from the target. Fades after the fight.',
    fleeting: true,
    weapon: { rangePx: MELEE_RANGE, kind: 'strength', multiplier: 1.2, damageType: 'shatter' },
    onHit: [{ k: 'siphon', pct: 0.5 }, { k: 'dashAway', px: 2 * U }],
  },
  {
    id: 'conjuredGlassLongbow',
    name: 'Glass Longbow',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    weaponFamily: 'bow',
    blurb: 'Dex pierce, range 18cm, needs no arrows. 100% hit to 12cm, 75% to 18cm. On hit: +1d4 shatter. Fades after the fight.',
    fleeting: true,
    weapon: {
      rangePx: 18 * U,
      kind: 'dex',
      damageType: 'pierce',
      rangeAccuracy: { autoWithin: 12 * U, maxRange: 18 * U, farChance: 0.75 },
    },
    onHit: [{ k: 'damage', spec: '1d4', type: 'shatter' }],
  },
  {
    id: 'conjuredHushingHammer',
    name: 'Hushing Hammer',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    weaponFamily: 'hammer',
    blurb: '120% Strength shatter. On hit: 30% chance that the target\'s next action other than moving fails. Fades after the fight.',
    fleeting: true,
    weapon: { rangePx: MELEE_RANGE, kind: 'strength', multiplier: 1.2, damageType: 'shatter' },
    onHit: [{ k: 'stifle', chance: 0.3 }],
  },
  // ---- Conjured for one fight by the Lightning class spells (Objects) -------
  {
    id: 'conjuredArcBrand',
    name: 'Arc Brand',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb:
      'Dex heat. On hit, roll 1d6. 1: you take 1d6 heat. 2-5: +1 Fire, and lightning arcs to the nearest other unit within 3cm of the target (friend or foe, never you) for 1d6 heat. 6: +2 Fire, the arc, and you dash 2cm away. Fades after the fight.',
    fleeting: true,
    weapon: { rangePx: MELEE_RANGE, kind: 'dex', damageType: 'heat' },
    onHit: [{
      k: 'gamble',
      low: [{ k: 'self', then: [{ k: 'damage', spec: '1d6', type: 'heat' }] }],
      mid: [{ k: 'fire', stacks: 1 }, { k: 'arc', radius: 3 * U, hits: [{ spec: '1d6', type: 'heat' }] }],
      high: [
        { k: 'fire', stacks: 2 },
        { k: 'arc', radius: 3 * U, hits: [{ spec: '1d6', type: 'heat' }] },
        { k: 'dashAway', px: 2 * U },
      ],
    }],
  },
  // ---- Conjured for one fight by the Pierce class spells (Objects) ---------
  {
    id: 'conjuredTwinblades',
    name: 'Twinblades',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb: 'Dex pierce, strikes twice. On hit: you slip a quarter circle around the target. Fades after the fight.',
    fleeting: true,
    weapon: { rangePx: MELEE_RANGE, kind: 'dex', damageType: 'pierce', hits: 2 },
    onHit: [{ k: 'flank' }],
  },
  {
    id: 'conjuredGrapnel',
    name: 'Grapnel',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb: 'Dex pierce, range 8cm. On hit: the target is rooted for 2 turns and you dash to its side. Fades after the fight.',
    fleeting: true,
    weapon: { rangePx: 8 * U, kind: 'dex', damageType: 'pierce' },
    onHit: [{ k: 'root', turns: 2 }, { k: 'closeIn' }],
  },
  {
    id: 'conjuredSplinterJavelin',
    name: 'Splinter Javelin',
    slot: 'utility',
    set: 'conjured',
    rarity: 'consumeable',
    cost: g(0),
    weight: 0,
    blurb: 'Bonus action: throw within 10cm for 1d6 pierce; every other enemy within 2cm of the target takes 1d4 shatter. Fades after the fight.',
    fleeting: true,
    throwable: {
      rollSpec: '1d6',
      rangePx: 10 * U,
      onHit: [{ k: 'shrapnel', radius: 2 * U, hits: [{ spec: '1d4', type: 'shatter' }], foes: true }],
    },
  },
  {
    id: 'conjuredThornbow',
    name: 'Thornbow',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    weaponFamily: 'bow',
    blurb: 'Dex pierce, range 12cm, needs no arrows. On hit: bleeding, 1d4 pierce for 3 turns; each pierce hit on it adds a turn, up to 4. Fades after the fight.',
    fleeting: true,
    weapon: {
      rangePx: 12 * U,
      kind: 'dex',
      damageType: 'pierce',
      rangeAccuracy: { autoWithin: 12 * U, maxRange: 12 * U, farChance: 1 },
    },
    onHit: [{ k: 'dot', name: 'Bleeding', spec: '1d4', turns: 3, type: 'pierce', barbed: true }],
  },
  {
    id: 'conjuredLeechingRapier',
    name: 'Leeching Rapier',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb: 'Dex attack +2, pierce. On hit: drain 50% of the damage dealt as corrosive (heals you), then dash up to 2cm. Fades after the fight.',
    fleeting: true,
    weapon: { rangePx: MELEE_RANGE, kind: 'dex', dexBonus: 2, damageType: 'pierce', dashAfterHitUnits: 2 },
    onHit: [{ k: 'siphon', pct: 0.5 }],
  },
  {
    id: 'conjuredBoneLongbow',
    name: 'Bone Longbow',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    weaponFamily: 'bow',
    blurb: 'Dex attack +2, pierce, range 16cm, needs no arrows. 100% hit to 12cm, 75% to 16cm. On hit against affected units: +2d6 pierce, no healing for 2 turns. Fades after the fight.',
    fleeting: true,
    weapon: {
      rangePx: 16 * U,
      kind: 'dex',
      dexBonus: 2,
      damageType: 'pierce',
      rangeAccuracy: { autoWithin: 12 * U, maxRange: 16 * U, farChance: 0.75 },
    },
    onHit: [{ k: 'affected', then: [{ k: 'damage', spec: '2d6', type: 'pierce' }, { k: 'noHeal', turns: 2 }] }],
  },
  {
    id: 'conjuredSilencerCrossbow',
    name: 'Silencer Crossbow',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb: 'Dex pierce, range 12cm, needs no bolts. On hit: rooted for 2 turns, 34% chance that its next action other than moving fails. Fades after the fight.',
    fleeting: true,
    weapon: {
      rangePx: 12 * U,
      kind: 'dex',
      damageType: 'pierce',
      rangeAccuracy: { autoWithin: 12 * U, maxRange: 12 * U, farChance: 1 },
    },
    onHit: [{ k: 'root', turns: 2 }, { k: 'stifle', chance: 0.34 }],
  },
  {
    id: 'conjuredCorkscrewLance',
    name: 'Corkscrew Lance',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb: '140% Strength pierce, reach 3cm. On hit: the target is turned a quarter circle around you; stopped by a wall or the field edge: +2d6 shatter. Fades after the fight.',
    fleeting: true,
    weapon: { rangePx: 3 * U, kind: 'strength', multiplier: 1.4, damageType: 'pierce' },
    onHit: [{ k: 'orbit', slam: { spec: '2d6', type: 'shatter' } }],
  },
  {
    id: 'conjuredLeechingChakram',
    name: 'Leeching Chakram',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb: 'Dex pierce, range 8cm. On hit: drain 50% of the damage dealt as corrosive (heals you); the target is turned a quarter circle around you. Fades after the fight.',
    fleeting: true,
    weapon: {
      rangePx: 8 * U,
      kind: 'dex',
      damageType: 'pierce',
      rangeAccuracy: { autoWithin: 8 * U, maxRange: 8 * U, farChance: 1 },
    },
    onHit: [{ k: 'siphon', pct: 0.5 }, { k: 'orbit' }],
  },
  {
    id: 'conjuredHookblade',
    name: 'Hookblade',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb: '120% Strength pierce. On hit: the target is turned a quarter circle around you (stopped by a wall or the field edge: +1d6 pierce) and takes 1d4 pierce at the start of its turns for 2 turns. Fades after the fight.',
    fleeting: true,
    weapon: { rangePx: MELEE_RANGE, kind: 'strength', multiplier: 1.2, damageType: 'pierce' },
    onHit: [
      { k: 'orbit', slam: { spec: '1d6', type: 'pierce' } },
      { k: 'dot', name: 'Hook Wound', spec: '1d4', turns: 2, type: 'pierce' },
    ],
  },
  {
    id: 'conjuredStakeCrossbow',
    name: 'Stake Crossbow',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb: 'Dex pierce, range 10cm, needs no bolts. On hit: rooted for 2 turns; if it already was, +1d6 shatter instead. Fades after the fight.',
    fleeting: true,
    weapon: {
      rangePx: 10 * U,
      kind: 'dex',
      damageType: 'pierce',
      rangeAccuracy: { autoWithin: 10 * U, maxRange: 10 * U, farChance: 1 },
    },
    onHit: [{ k: 'ifRooted', then: [{ k: 'damage', spec: '1d6', type: 'shatter' }], else: [{ k: 'root', turns: 2 }] }],
  },
  {
    id: 'conjuredBloodhookHarpoon',
    name: 'Bloodhook Harpoon',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb: 'Dex pierce, range 8cm. On hit: drain 50% of the damage dealt as corrosive (heals you), and the target is rooted for 2 turns. Fades after the fight.',
    fleeting: true,
    weapon: { rangePx: 8 * U, kind: 'dex', damageType: 'pierce' },
    onHit: [{ k: 'siphon', pct: 0.5 }, { k: 'root', turns: 2 }],
  },
  {
    id: 'conjuredThornwhip',
    name: 'Thornwhip',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb: '110% Strength pierce, reach 4cm. On hit: rooted for 2 turns; if it already was, thorns instead: 1d4 pierce for 3 turns. Fades after the fight.',
    fleeting: true,
    weapon: { rangePx: 4 * U, kind: 'strength', multiplier: 1.1, damageType: 'pierce' },
    onHit: [{
      k: 'ifRooted',
      then: [{ k: 'dot', name: 'Thorns', spec: '1d4', turns: 3, type: 'pierce' }],
      else: [{ k: 'root', turns: 2 }],
    }],
  },
  {
    id: 'conjuredSplinterbow',
    name: 'Splinterbow',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    weaponFamily: 'bow',
    blurb: 'Dex pierce, range 14cm, needs no arrows. On hit: splinters, 1d3 shatter for 3 turns, and every other unit within 1.5cm of the target, yours included, takes 1d3 shatter. Fades after the fight.',
    fleeting: true,
    weapon: {
      rangePx: 14 * U,
      kind: 'dex',
      damageType: 'pierce',
      rangeAccuracy: { autoWithin: 14 * U, maxRange: 14 * U, farChance: 1 },
    },
    onHit: [
      { k: 'dot', name: 'Splinters', spec: '1d3', turns: 3, type: 'shatter' },
      { k: 'shrapnel', radius: 1.5 * U, hits: [{ spec: '1d3', type: 'shatter' }] },
    ],
  },
  {
    id: 'conjuredBonebreakerPike',
    name: 'Bonebreaker Pike',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb: '150% Strength pierce, reach 3cm. On hit against affected units: +2d6 shatter, stunned for 2 turns. Fades after the fight.',
    fleeting: true,
    weapon: { rangePx: 3 * U, kind: 'strength', multiplier: 1.5, damageType: 'pierce' },
    onHit: [{ k: 'affected', then: [{ k: 'damage', spec: '2d6', type: 'shatter' }, { k: 'stun', turns: 2 }] }],
  },
  {
    id: 'conjuredHarvestersGlaive',
    name: "Harvester's Glaive",
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb: '140% Strength pierce, reach 3cm. On hit: drain 50% of the damage dealt as corrosive (heals you); against affected units drain 100% more, no healing for 2 turns. Fades after the fight.',
    fleeting: true,
    weapon: { rangePx: 3 * U, kind: 'strength', multiplier: 1.4, damageType: 'pierce' },
    onHit: [{ k: 'siphon', pct: 0.5 }, { k: 'affected', then: [{ k: 'siphon', pct: 1 }, { k: 'noHeal', turns: 2 }] }],
  },
  {
    id: 'conjuredThornspitter',
    name: 'Thornspitter',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb: 'Dex attack +2, pierce, range 12cm, needs no bolts. On hit: bleeding, 1d4 pierce for 3 turns; on affected units every damage over time lasts 2 turns longer. Fades after the fight.',
    fleeting: true,
    weapon: {
      rangePx: 12 * U,
      kind: 'dex',
      dexBonus: 2,
      damageType: 'pierce',
      rangeAccuracy: { autoWithin: 12 * U, maxRange: 12 * U, farChance: 1 },
    },
    onHit: [
      { k: 'dot', name: 'Bleeding', spec: '1d4', turns: 3, type: 'pierce' },
      { k: 'affected', then: [{ k: 'deepen', turns: 2 }] },
    ],
  },
  // ---- Conjured for one fight by the Drain class spells (Objects) ----------
  {
    id: 'conjuredBloodhammer',
    name: 'Bloodhammer',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    weaponFamily: 'hammer',
    blurb: '120% Strength shatter. On hit: drain 50% of the damage dealt as corrosive (heals you), +1 damage taken for 2 turns. Fades after the fight.',
    fleeting: true,
    weapon: { rangePx: MELEE_RANGE, kind: 'strength', multiplier: 1.2, damageType: 'shatter' },
    onHit: [{ k: 'siphon', pct: 0.5 }, { k: 'pitted', amount: 1, turns: 2 }],
  },
  {
    id: 'conjuredLeechingBuckler',
    name: 'Leeching Buckler',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb: 'Shield: 20% block, +1 armour. Attackers who hit you are rooted for 2 turns and drained for 50% of the damage they dealt you (heals you). Fades after the fight.',
    fleeting: true,
    shield: { blockPct: 0.2, armorFlat: 1, bashMult: 0.6 },
    onStruck: [{ k: 'root', turns: 2 }, { k: 'siphon', pct: 0.5 }],
  },
  {
    id: 'conjuredGravedrinker',
    name: 'Gravedrinker',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    blurb: 'Two-handed, 160% Strength shatter. On hit against units Desecrate harms: drain 100% of the damage dealt as corrosive (heals you), and the ground around them is fouled for 2 turns (1d6 corrosive, no healing; you heal for it). Fades after the fight.',
    fleeting: true,
    twoHanded: true,
    weapon: { rangePx: MELEE_RANGE, kind: 'strength', multiplier: 1.6, damageType: 'shatter' },
    onHit: [{
      k: 'affected',
      then: [{ k: 'siphon', pct: 1 }, { k: 'foul', radius: 2 * U, turns: 2, spec: '1d6', drink: true }],
    }],
  },
  // ---- Conjured for one fight by the Curse class spells (Objects) ----------
  {
    id: 'conjuredOssuaryMaul',
    name: 'Ossuary Maul',
    slot: 'hand',
    set: 'conjured',
    rarity: 'common',
    cost: g(0),
    weight: 0,
    weaponFamily: 'hammer',
    blurb: 'Two-handed, 150% Strength shatter. On hit against units Desecrate harms: the whole hit again as shatter at the start of their next 3 turns, and no healing meanwhile. Fades after the fight.',
    fleeting: true,
    twoHanded: true,
    weapon: { rangePx: MELEE_RANGE, kind: 'strength', multiplier: 1.5, damageType: 'shatter' },
    onHit: [{
      k: 'affected',
      then: [{ k: 'dot', name: 'Splitting Curse', pct: 1, turns: 3, type: 'shatter' }, { k: 'noHeal', turns: 3 }],
    }],
  },
  // ---- Legendary ----------------------------------------------------------
  {
    id: 'roaringThunder',
    name: 'Blessing of Roaring Thunder',
    slot: 'utility',
    rarity: 'legendary',
    cost: g(0),
    weight: 0,
    blurb:
      '-15% max HP and sanity. On cast: +1 Thunder. 9+ Thunder: damage each turn. 15 Thunder: death. Bonus action: mana + 1d6 true for +1d4 Thunder and color charges. Bonus action: spend all Thunder as chain lightning, 1d3 per stack.',
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
      'Reaction, one use: cancel an ability or weapon attack. That source is permanently disabled against you.',
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
      'Immunity to everything hostile during turn cycles 3 and 4.',
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
      'Main action, choose one: 10 true damage at any range; immunity to all damage until your next turn; or +5 HP, +10 mana and +2 charges per word.',
    eldritchMantle: true,
  },
  {
    id: 'deathsAngelWings',
    name: 'Wings of Deaths Angel',
    slot: 'torso',
    set: 'original',
    rarity: 'legendary',
    cost: g(0),
    weight: 0,
    blurb:
      'Permanently binding. On kill: +1 Energy. Bonus action (1 Energy): fly 2 turns. Per flying turn: +1d3 HP and 1d3 true damage to enemies within 5cm. Your damage executes below 6% max HP.',
    deathsAngelWings: true,
    permanentlyBinding: true,
  },
  {
    id: 'shadowDagger',
    name: 'Dagger of Shadow',
    slot: 'hand',
    set: 'original',
    rarity: 'legendary',
    cost: g(0),
    weight: 0,
    blurb:
      'Dex attack, sanity. In shadow (1 mana/turn): immunity to all targeting, unbreakable. Weapon Action (8 mana): teleport to any shadow. Unpaid mana costs 1 random permanent stat point each.',
    weaponAbility: 'shadowDaggerTeleport',
    shadowDagger: { teleportManaCost: 8, stealthManaPerRound: 1 },
    weapon: {
      rangePx: MELEE_RANGE,
      kind: 'dex',
      damageType: 'sanity',
    },
  },
  {
    id: 'bastionSword',
    name: 'Greatshield of <Redacted>',
    slot: 'hand',
    rarity: 'legendary',
    cost: g(0),
    weight: 0,
    blurb:
      'Weapon Action: toggle form. Both: -25% move. Shield: +2 armour, +2 magic armour, block 67%, bash, 50% Strength shatter. Sword: +1cm range, 200% Strength slashing, ignores armour and resistances, no bag actions, cannot be dropped.',
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
  // ---- Dimir Faithful DLC: wards, immunities & cleansing -------------------
  {
    id: 'creedOfTheUnyielding',
    name: 'Creed of the Unyielding',
    slot: 'torso',
    set: 'dlc',
    rarity: 'mythical',
    cost: g(25),
    weight: 6,
    blurb:
      'Immunity to all debuffs AND buffs. -20% max HP and sanity.',
    debuffImmunity: true,
    hpMult: 0.8,
    sanityMult: 0.8,
  },
  {
    id: 'faithkeepersSigil',
    name: "Faithkeeper's Sigil",
    slot: 'accessory',
    set: 'dlc',
    rarity: 'unreal',
    cost: g(40),
    weight: 1,
    blurb:
      'Immunity to shadow. Weak to light. -50% debuff duration.',
    resist: { immune: ['shadow'], weak: ['light'] },
    debuffDurationMult: 0.5,
  },
  {
    id: 'oathboundMail',
    name: 'Oathbound Mail',
    slot: 'torso',
    set: 'dlc',
    rarity: 'unreal',
    cost: g(30),
    weight: 10,
    blurb:
      '+2 armour. Resist pierce, slashing and shatter. Weak to corrosive. -25% move.',
    armor: { flat: 2 },
    resist: { resist: ['pierce', 'slashing', 'shatter'], weak: ['corrosive'] },
    moveMult: 0.75,
  },
  {
    id: 'chaliceOfClearWater',
    name: 'Chalice of Clear Water',
    slot: 'hand',
    set: 'dlc',
    rarity: 'epic',
    cost: g(20),
    weight: 2,
    blurb:
      'Bonus action (6 mana): cleanse all debuffs. Unlimited uses.',
    cleanseManaCost: 6,
  },
  {
    id: 'wardingBeads',
    name: 'Warding Beads',
    slot: 'accessory',
    set: 'dlc',
    rarity: 'rare',
    cost: g(10),
    weight: 0,
    blurb: '-25% debuff duration.',
    debuffDurationMult: 0.75,
  },
  // ---- Unreal -------------------------------------------------------------
  {
    id: 'ironwallGreatshield',
    name: 'Ironwall Greatshield',
    slot: 'hand',
    set: 'dlc',
    rarity: 'unreal',
    cost: g(20),
    weight: 12,
    blurb:
      'Shield: +2 armour, +2 magic armour, block 60%, bash. 30% Strength shatter.',
    weapon: {
      rangePx: MELEE_RANGE,
      kind: 'strength',
      multiplier: 0.3,
      damageType: 'shatter',
    },
    shield: { blockPct: 0.6, armorFlat: 2, magicFlat: 2, bashMult: 0.5 },
  },
  {
    id: 'lungingEdge',
    name: 'Lunging Edge',
    slot: 'hand',
    set: 'dlc',
    rarity: 'unreal',
    cost: g(20),
    weight: 3,
    blurb:
      '+75% Strength slashing, +1cm range. On hit: dash 3cm.',
    weapon: {
      rangePx: MELEE_RANGE + U,
      kind: 'strength',
      multiplier: 1.75,
      damageType: 'slashing',
      dashAfterHitUnits: 3,
    },
  },
  {
    id: 'mutivargRod',
    name: "Mutivarg's Rod",
    slot: 'hand',
    rarity: 'unreal',
    cost: g(25),
    weight: 4,
    blurb:
      'Wand. Casts cost 200% mana and burn 20% of target mana. Weapon Action: spend 25% mana for a slow and root circle, 2 turns. Fails below 4 mana paid.',
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
    cost: g(20),
    weight: 2,
    blurb: '+1 armour. +1 melee damage.',
    armor: { flat: 1 },
    meleeDamageBonus: 1,
  },
  {
    id: 'dwarfCrossbow',
    name: 'Crossbow',
    slot: 'hand',
    rarity: 'epic',
    cost: g(14),
    weight: 7,
    blurb:
      'Range 10cm. d20 vs DC = cm x 2. 2d10+1 pierce, +1d6 if the roll is under 10. Reload 2 turns.',
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
    cost: g(10),
    weight: 3,
    blurb:
      'Bag. Unlimited pack slots. What is inside weighs 25% less.',
    pack: { slots: Infinity, weightMult: 0.75 },
  },
  // ---- Epic ---------------------------------------------------------------
  {
    id: 'warHammer',
    name: 'War Hammer',
    slot: 'hand',
    set: 'dlc',
    rarity: 'epic',
    cost: g(0),
    weight: 12,
    weaponFamily: 'hammer',
    blurb:
      '+50% Strength shatter. On hit: knockback 3cm.',
    weapon: {
      rangePx: MELEE_RANGE,
      kind: 'strength',
      multiplier: 1.5,
      damageType: 'shatter',
      knockbackUnits: 3,
    },
  },
  {
    id: 'woodenBow',
    name: 'Wooden Bow',
    slot: 'hand',
    rarity: 'epic',
    cost: g(10),
    weight: 1,
    weaponFamily: 'bow',
    blurb:
      'Dex attack +3, pierce, range 20cm. 100% hit to 15cm, 50% to 20cm. Uses arrows.',
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
    cost: g(15),
    weight: 1,
    blurb: '-1 to all incoming sanity damage.',
    mentalReduce: 1,
  },
  {
    id: 'moonfireBow',
    name: 'Moonfire Bow',
    slot: 'hand',
    rarity: 'unreal',
    cost: g(25),
    weight: 2,
    blurb: 'Dex attack +5, +50% damage, pierce, range 24cm. 100% hit to 20cm, 75% to 24cm. Uses arrows. Burning arrows.',
    weaponFamily: 'bow',
    weapon: {
      rangePx: 24 * U,
      kind: 'dex',
      dexBonus: 5,
      multiplier: 1.5,
      usesArrows: true,
      damageType: 'pierce',
      rangeAccuracy: { autoWithin: 20 * U, maxRange: 24 * U, farChance: 0.75 },
    },
  },
  {
    id: 'runicMaul',
    name: 'Runic Maul',
    slot: 'hand',
    rarity: 'unreal',
    cost: g(0),
    weight: 14,
    blurb: '+100% Strength shatter. On hit: knockback 4cm.',
    weaponFamily: 'hammer',
    weapon: {
      rangePx: MELEE_RANGE,
      kind: 'strength',
      multiplier: 2,
      damageType: 'shatter',
      knockbackUnits: 4,
    },
  },
  {
    id: 'gazeTimezBracelet',
    name: 'Gaze Timez Bracelet',
    slot: 'accessory',
    rarity: 'epic',
    cost: g(0),
    weight: 2,
    blurb:
      'Slow capped at 75%. Once per combat: +1d3 mana on the first sanity damage.',
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
      'Dex attack +50% Dex, pierce.',
    weapon: {
      rangePx: MELEE_RANGE,
      kind: 'dex',
      dexBonusPct: 0.5,
      damageType: 'pierce',
    },
  },
  // ---- Rare ---------------------------------------------------------------
  {
    id: 'channelingRing',
    name: 'Channeling Ring',
    slot: 'accessory',
    rarity: 'rare',
    cost: g(0),
    weight: 0,
    blurb: 'On damage taken: +2 mana.',
    manaOnHit: 2,
  },
  {
    id: 'ironCap',
    name: 'Iron Cap',
    slot: 'head',
    rarity: 'rare',
    cost: g(0),
    weight: 3,
    blurb: '+1 armour.',
    armor: { flat: 1 },
  },
  {
    id: 'travelerBoots',
    name: 'Traveler\'s Boots',
    slot: 'boots',
    rarity: 'rare',
    cost: g(0),
    weight: 1,
    blurb: '+25% move.',
    moveMult: 1.25,
  },
  {
    id: 'silverShortsword',
    name: 'Silver Shortsword',
    slot: 'hand',
    rarity: 'rare',
    cost: g(0),
    weight: 2,
    blurb: '100% Strength slashing. 20% chance to double damage.',
    weapon: {
      rangePx: MELEE_RANGE,
      kind: 'strength',
      multiplier: 1.0,
      damageType: 'slashing',
      critChance: 0.2,
    },
  },
  {
    id: 'manaWand',
    name: 'Mana Wand',
    slot: 'hand',
    rarity: 'rare',
    cost: g(0),
    weight: 1,
    blurb: 'Wand. -1 mana per word spell.',
    isWand: true,
    manaDiscount: 1,
  },
  {
    id: 'razorSword',
    name: 'Razor Sword',
    slot: 'hand',
    rarity: 'rare',
    cost: g(0),
    weight: 2,
    blurb: '+50% Strength slashing, +1cm range.',
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
    set: 'dlc',
    rarity: 'rare',
    cost: g(0),
    weight: 2,
    blurb:
      'Shield: +1 armour, block 33%, bash. 25% Strength shatter.',
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
    blurb: 'First black-word spell each combat: 0 mana.',
    firstBlackSpellFree: true,
  },
  // ---- Consumeable --------------------------------------------------------
  {
    id: 'throwingDagger',
    name: 'Throwing Dagger',
    slot: 'utility',
    set: 'dlc',
    rarity: 'consumeable',
    cost: g(1),
    weight: 1,
    blurb: 'Bonus action: 1d3 pierce, range 10cm. Consumed.',
    throwable: { rollSpec: '1d3', rangePx: 10 * U },
  },
  {
    id: 'arrow',
    name: 'Arrow',
    slot: 'utility',
    rarity: 'consumeable',
    cost: 5, // silver
    weight: 0,
    blurb: 'Bow ammunition.',
    ammo: true,
  },
  {
    id: 'manaPotion',
    name: 'Mana Potion',
    slot: 'utility',
    rarity: 'consumeable',
    cost: g(3),
    weight: 1,
    blurb: 'Bonus action: +10 mana. Consumed.',
    potion: 'mana',
  },
  // ---- Materials -----------------------------------------------------------
  // Cargo, not equipment: heavy for their price, so hauling a full load home is
  // a real decision. Sold in towns; kept in the bag for future crafting.
  {
    id: 'oreCoal',
    name: 'Coal',
    slot: 'utility',
    rarity: 'consumeable',
    cost: g(0.5),
    weight: 1,
    blurb: 'Material. Mined ore.',
    material: true,
  },
  {
    id: 'oreCopper',
    name: 'Copper Ore',
    slot: 'utility',
    rarity: 'consumeable',
    cost: g(1),
    weight: 1.5,
    blurb: 'Material. Mined ore.',
    material: true,
  },
  {
    id: 'oreIron',
    name: 'Iron Ore',
    slot: 'utility',
    rarity: 'consumeable',
    cost: g(1.5),
    weight: 2,
    blurb: 'Material. Mined ore.',
    material: true,
  },
  {
    id: 'oreGold',
    name: 'Gold Ore',
    slot: 'utility',
    rarity: 'consumeable',
    cost: g(3),
    weight: 2.5,
    blurb: 'Material. Mined ore.',
    material: true,
  },
  {
    id: 'crudeTrinket',
    name: 'Crude Trinket',
    slot: 'utility',
    rarity: 'consumeable',
    cost: g(0.5),
    weight: 0.5,
    blurb: 'Material. Salvaged from a kobold.',
    material: true,
  },
  {
    id: 'chargedScale',
    name: 'Charged Scale',
    slot: 'utility',
    rarity: 'consumeable',
    cost: g(1),
    weight: 0.5,
    blurb: 'Material. Salvaged from an elite kobold.',
    material: true,
  },
  {
    id: 'stoneHeart',
    name: 'Stone Heart',
    slot: 'utility',
    rarity: 'consumeable',
    cost: g(2),
    weight: 3,
    blurb: 'Material. Salvaged from a golem.',
    material: true,
  },
  {
    id: 'sentinelLens',
    name: 'Sentinel Lens',
    slot: 'utility',
    rarity: 'consumeable',
    cost: g(1.5),
    weight: 1,
    blurb: 'Material. Salvaged from a sentinel.',
    material: true,
  },
  {
    id: 'magmaCore',
    name: 'Magma Core',
    slot: 'utility',
    rarity: 'consumeable',
    cost: g(4),
    weight: 2,
    blurb: 'Material. Salvaged from a magma sentinel.',
    material: true,
  },
  {
    id: 'redStone',
    name: 'Red Stone',
    slot: 'utility',
    rarity: 'consumeable',
    cost: g(2),
    weight: 1.5,
    blurb: 'Material. Salvaged from an earth elemental.',
    material: true,
  },
  {
    id: 'darkEye',
    name: 'Dark Eye',
    slot: 'utility',
    rarity: 'consumeable',
    cost: g(2),
    weight: 0.5,
    blurb: 'Material. Salvaged from a pftlhb.',
    material: true,
  },
  {
    id: 'batLeather',
    name: 'Bat Leather',
    slot: 'utility',
    rarity: 'consumeable',
    cost: g(0.5),
    weight: 0.5,
    blurb: 'Material. Skinned from a cavern bat.',
    material: true,
  },
  {
    id: 'redDrakeScale',
    name: 'Red Drake Scale',
    slot: 'utility',
    rarity: 'consumeable',
    cost: g(4),
    weight: 1,
    blurb: 'Material. Salvaged from a red dragonborn.',
    material: true,
  },
  {
    id: 'blackDrakeScale',
    name: 'Black Drake Scale',
    slot: 'utility',
    rarity: 'consumeable',
    cost: g(4),
    weight: 1,
    blurb: 'Material. Salvaged from a black dragonborn.',
    material: true,
  },
  {
    id: 'healthPotion',
    name: 'Health Potion',
    slot: 'utility',
    rarity: 'consumeable',
    cost: g(4),
    weight: 1,
    blurb: 'Bonus action: +2d3 HP. Consumed.',
    potion: 'health',
  },
  {
    id: 'sandPocket',
    name: 'Sand Pocket',
    slot: 'utility',
    rarity: 'mythical',
    cost: g(0),
    weight: 1,
    blurb: 'Stores up to 3kg of sand. Bonus action: pour out or pick up 1kg at a time.',
    sandPocket: true,
  },
  {
    id: 'torch',
    name: 'Torch',
    slot: 'hand',
    rarity: 'consumeable',
    cost: g(2),
    weight: 1,
    blurb:
      'Light 3cm, 3 combats. Light-weak enemies in the aura: 2 typeless per turn. Unarmed strike, +5 true vs light-weak. 10% to break per swing. Stowing destroys it.',
    lightSource: true,
    lightRadiusPx: 3 * U,
    torchCombats: 3,
    swamprunOnly: true,
  },
  {
    id: 'lantern',
    name: 'Everburning Lantern',
    slot: 'hand',
    rarity: 'mythical',
    cost: g(0),
    weight: 2,
    blurb:
      'Light 3cm, permanent, works from the bag. Light-weak enemies in the aura: 2 typeless per turn. Unarmed strike, +5 true vs light-weak.',
    lightSource: true,
    lightRadiusPx: 3 * U,
    lightInBag: true,
    swamprunOnly: true,
  },
  {
    id: 'edgelordLantern',
    name: 'Edgelord Lantern',
    slot: 'hand',
    set: 'finns',
    rarity: 'unreal',
    cost: g(0),
    weight: 0,
    blurb:
      'Cursed. Permanently binding. Weak to light. Bonus action: toggle active or dormant.\n' +
      'ACTIVE (4 mana): 15cm dark light that counts as your shadow. On activation: 3 Soul Rend to all in range, including you. Move through walls. Reveals all stealth except Shadow Veil. On weapon attack: pull all units 6cm in, then 2 shadow to all in the light, including you.\n' +
      'DORMANT: -33% move. Full turn: throw within (Strength)cm for a 5cm blast, 1d20 shadow/shatter + 1d10 sanity. Can hit you.\n' +
      'On deactivate: pull all units 6cm in, then capture units in 6cm with Soul Rend below 15 HP, 8 sanity or 34%.\n' +
      'Captives: 2 mana per turn, 10 true HP + 5 true sanity each. Unpaid: you die.\n' +
      'Soul Rend: 1d3 true HP + 1d3 true sanity per stack per turn, then -1 stack.',
    resist: { weak: ['light'] },
    edgelordLantern: true,
    cursed: true,
    permanentlyBinding: true,
  },

  // ===========================================================================
  //  FINN'S ADDITIONS  (set: 'finns')
  // ===========================================================================
  {
    id: 'bloodCharm',
    name: 'Blood Charm',
    slot: 'accessory',
    set: 'finns',
    rarity: 'unreal',
    cost: g(0),
    weight: 1,
    blurb:
      'On cast: -15% max HP. Spells heal you 15% of HP damage dealt.',
    spellHealthCostPct: 0.15,
    spellLifestealPct: 0.15,
  },
  {
    id: 'bloodRing',
    name: 'Blood Ring',
    slot: 'accessory',
    set: 'finns',
    rarity: 'epic',
    cost: g(0),
    weight: 1,
    blurb:
      '-8 max HP. +50% healing received. On melee hit: +2 HP.',
    hpFlat: -8,
    healMult: 1.5,
    meleeHealOnHit: 2,
  },
  {
    id: 'momentumBoots',
    name: 'Momentum Boots',
    slot: 'boots',
    set: 'finns',
    rarity: 'epic',
    cost: g(0),
    weight: 2,
    blurb:
      '-5 Dex. +1cm move per consecutive turn moving 80%+ of max. Resets when stationary.',
    statMods: { dex: -5 },
    momentumBoots: true,
  },
  {
    id: 'smartRing',
    name: 'Smart Ring',
    slot: 'accessory',
    set: 'finns',
    rarity: 'rare',
    cost: g(0),
    weight: 1,
    blurb: '+2 Intellect.',
    statMods: { int: 2 },
  },
  {
    id: 'gamblersBlade',
    name: "Gambler's Blade",
    slot: 'hand',
    set: 'finns',
    rarity: 'unreal',
    cost: g(0),
    weight: 3,
    blurb:
      'Bonus action attack, 50% Strength slashing. On hit: +1d3 Greed. Weapon Action: destroy the blade, draft 1 of 3 items per 5 Greed.',
    weapon: {
      rangePx: MELEE_RANGE,
      kind: 'strength',
      multiplier: 0.5,
      damageType: 'slashing',
    },
    bonusActionAttack: true,
    gamblerGreed: true,
    weaponAbility: 'gamblerCash',
  },
  {
    id: 'gamblersCurse',
    name: "Gambler's Curse",
    slot: 'utility',
    set: 'finns',
    rarity: 'unreal',
    cost: g(0),
    weight: 0,
    blurb:
      'Every d20 you roll of 1-3 counts as a natural 1. Every d20 you roll of 18-20 counts as a natural 20.',
    gamblersCurse: true,
  },
  {
    id: 'anchorBoots',
    name: 'Anchor Boots',
    slot: 'boots',
    set: 'finns',
    rarity: 'epic',
    cost: g(0),
    weight: 3,
    blurb:
      '-30% move. +1 armour per consecutive stationary turn, max +4.',
    moveMult: 0.7,
    anchorBoots: true,
  },
  {
    id: 'battleRobe',
    name: 'Battle Robe',
    slot: 'torso',
    set: 'finns',
    rarity: 'unreal',
    cost: g(0),
    weight: 2,
    blurb:
      '-4 Dex. Melee damage dealt becomes mana. Not bows or crossbows.',
    statMods: { dex: -4 },
    manaPerMeleeDmg: true,
  },
  {
    id: 'soulBattery',
    name: 'Soul Battery',
    slot: 'accessory',
    set: 'finns',
    rarity: 'rare',
    cost: g(0),
    weight: 1,
    blurb: '-2 Intellect. On fizzle: +4 HP.',
    statMods: { int: -2 },
    onFizzleHeal: 4,
  },
  {
    id: 'soulLocket',
    name: 'Soul Locket',
    slot: 'accessory',
    set: 'finns',
    rarity: 'epic',
    cost: g(0),
    weight: 1,
    blurb: '-2 Intellect. On fizzle: +4 mana.',
    statMods: { int: -2 },
    onFizzleMana: 4,
  },
  {
    id: 'tantrumGloves',
    name: 'Tantrum Gloves',
    slot: 'accessory',
    set: 'finns',
    rarity: 'epic',
    cost: g(0),
    weight: 1,
    blurb: '-2 Intellect. On fizzle: +50% damage to your next attack.',
    statMods: { int: -2 },
    onFizzleRage: 0.5,
  },
  {
    id: 'thornRing',
    name: 'Thorn Ring',
    slot: 'accessory',
    set: 'finns',
    rarity: 'rare',
    cost: g(0),
    weight: 1,
    blurb: 'On melee hit taken: 2 damage to the attacker.',
    thorns: 2,
  },
  {
    id: 'aluminiumHat',
    name: 'Aluminium Hat',
    slot: 'head',
    set: 'finns',
    rarity: 'epic',
    cost: g(0),
    weight: 1,
    blurb: 'Immunity to sanity damage below 3.',
    sanityWardBelow: 3,
  },
  {
    id: 'assassinsCloak',
    name: "Assassin's Cloak",
    slot: 'torso',
    set: 'finns',
    rarity: 'unreal',
    cost: g(0),
    weight: 2,
    blurb: '+50% Dex attack damage while stealthed.',
    veiledDaggerBonus: 0.5,
  },
  {
    id: 'crudeSpear',
    name: 'Crude Spear',
    slot: 'hand',
    rarity: 'common',
    cost: 0,
    weight: 1,
    blurb: 'Dex attack -2 (pierce). Enemy weapon.',
    enemyOnly: true,
    weapon: { rangePx: MELEE_RANGE * 1.2, kind: 'dex', dexBonus: -2, damageType: 'pierce' },
  },
  {
    id: 'stoneSpear',
    name: 'Stone Spear',
    slot: 'hand',
    rarity: 'common',
    cost: 0,
    weight: 2,
    blurb: 'Dex attack (pierce). Enemy weapon.',
    enemyOnly: true,
    weapon: { rangePx: MELEE_RANGE * 1.25, kind: 'dex', damageType: 'pierce' },
  },
  {
    id: 'ironSpear',
    name: 'Iron Spear',
    slot: 'hand',
    rarity: 'common',
    cost: 0,
    weight: 2,
    blurb: 'Dex attack +2 (pierce). Enemy weapon.',
    enemyOnly: true,
    weapon: { rangePx: MELEE_RANGE * 1.3, kind: 'dex', dexBonus: 2, damageType: 'pierce' },
  },
  {
    id: 'primitiveClub',
    name: 'Primitive Club',
    slot: 'hand',
    rarity: 'common',
    cost: 0,
    weight: 3,
    blurb: '80% Strength shatter damage. Enemy weapon.',
    enemyOnly: true,
    weapon: { rangePx: MELEE_RANGE, kind: 'strength', multiplier: 0.8, damageType: 'shatter' },
  },
  {
    id: 'stoneAxe',
    name: 'Stone Axe',
    slot: 'hand',
    rarity: 'common',
    cost: 0,
    weight: 3,
    blurb: '100% Strength slashing damage. Enemy weapon.',
    enemyOnly: true,
    weapon: { rangePx: MELEE_RANGE, kind: 'strength', damageType: 'slashing' },
  },
  {
    id: 'ironAxe',
    name: 'Iron Axe',
    slot: 'hand',
    rarity: 'common',
    cost: 0,
    weight: 4,
    blurb: '130% Strength slashing damage. Enemy weapon.',
    enemyOnly: true,
    weapon: { rangePx: MELEE_RANGE, kind: 'strength', multiplier: 1.3, damageType: 'slashing' },
  },
  // ---- Adventure gear --------------------------------------------------------
  {
    id: 'travellersDagger',
    name: "Traveller's Dagger",
    slot: 'hand',
    rarity: 'common',
    cost: g(4),
    weight: 1,
    blurb: 'Dex attack +6, pierce.',
    adventureOnly: true,
    weapon: { rangePx: MELEE_RANGE, kind: 'dex', dexBonus: 6, damageType: 'pierce' },
  },
  {
    id: 'quarterstaff',
    name: 'Quarterstaff',
    slot: 'hand',
    rarity: 'common',
    cost: g(3),
    weight: 2,
    blurb: '90% Strength shatter, +2cm range.',
    adventureOnly: true,
    weapon: { rangePx: MELEE_RANGE + U * 2, kind: 'strength', multiplier: 0.9, damageType: 'shatter' },
  },
  {
    id: 'shortsword',
    name: 'Shortsword',
    slot: 'hand',
    rarity: 'common',
    cost: g(4),
    weight: 2,
    blurb: '150% Strength slashing.',
    adventureOnly: true,
    weapon: { rangePx: MELEE_RANGE, kind: 'strength', multiplier: 1.5, damageType: 'slashing' },
  },
  {
    id: 'huntingBow',
    name: 'Hunting Bow',
    slot: 'hand',
    rarity: 'common',
    cost: g(6),
    weight: 1,
    weaponFamily: 'bow',
    blurb: 'Dex attack +1, pierce, range 16cm. 100% hit to 10cm, 50% to 16cm. Uses arrows.',
    adventureOnly: true,
    weapon: {
      rangePx: 16 * U,
      kind: 'dex',
      dexBonus: 1,
      usesArrows: true,
      damageType: 'pierce',
      rangeAccuracy: { autoWithin: 10 * U, maxRange: 16 * U, farChance: 0.5 },
    },
  },
  {
    id: 'ironShortsword',
    name: 'Iron Shortsword',
    slot: 'hand',
    rarity: 'common',
    cost: g(6),
    weight: 2,
    blurb: '110% Strength slashing.',
    adventureOnly: true,
    weapon: { rangePx: MELEE_RANGE, kind: 'strength', multiplier: 1.1, damageType: 'slashing' },
  },
  {
    id: 'apprenticeWand',
    name: 'Apprentice Wand',
    slot: 'hand',
    rarity: 'common',
    cost: g(5),
    weight: 0.5,
    blurb: 'Wand. +1 Int.',
    adventureOnly: true,
    isWand: true,
    statMods: { int: 1 },
  },
  {
    id: 'forgedWarAxe',
    name: 'Forged War Axe',
    slot: 'hand',
    rarity: 'rare',
    cost: g(14),
    weight: 4,
    blurb: '140% Strength slashing.',
    adventureOnly: true,
    weapon: { rangePx: MELEE_RANGE, kind: 'strength', multiplier: 1.4, damageType: 'slashing' },
  },
  {
    id: 'leatherCap',
    name: 'Leather Cap',
    slot: 'head',
    rarity: 'common',
    cost: g(4),
    weight: 1,
    blurb: '+1 magic armour.',
    adventureOnly: true,
    armor: { flat: 0, magicFlat: 1 },
  },
  {
    id: 'paddedJerkin',
    name: 'Padded Jerkin',
    slot: 'torso',
    rarity: 'common',
    cost: g(6),
    weight: 3,
    blurb: '+1 armour.',
    adventureOnly: true,
    armor: { flat: 1 },
  },
  {
    id: 'leatherBoots',
    name: 'Leather Boots',
    slot: 'boots',
    rarity: 'common',
    cost: g(4),
    weight: 1,
    blurb: '+10% move.',
    adventureOnly: true,
    moveMult: 1.1,
  },
  {
    id: 'chainShirt',
    name: 'Chain Shirt',
    slot: 'torso',
    rarity: 'rare',
    cost: g(14),
    weight: 6,
    blurb: '+2 armour. -10% move.',
    adventureOnly: true,
    armor: { flat: 2 },
    moveMult: 0.9,
  },
  {
    id: 'ironGreaves',
    name: 'Iron Greaves',
    slot: 'boots',
    rarity: 'rare',
    cost: g(10),
    weight: 4,
    blurb: '+1 armour.',
    adventureOnly: true,
    armor: { flat: 1 },
  },
  {
    id: 'emberplate',
    name: 'Emberplate',
    slot: 'torso',
    rarity: 'epic',
    cost: g(30),
    weight: 8,
    blurb: '+2 armour. Resist heat.',
    adventureOnly: true,
    armor: { flat: 2 },
    resist: { resist: ['heat'] },
  },
  {
    id: 'drakescaleHelm',
    name: 'Drakescale Helm',
    slot: 'head',
    rarity: 'epic',
    cost: g(24),
    weight: 3,
    blurb: '+1 armour, +1 magic armour. Resist slashing.',
    adventureOnly: true,
    armor: { flat: 1, magicFlat: 1 },
    resist: { resist: ['slashing'] },
  },
  {
    id: 'copperRing',
    name: 'Copper Ring',
    slot: 'accessory',
    rarity: 'common',
    cost: g(6),
    weight: 0,
    blurb: '+1 Int.',
    adventureOnly: true,
    statMods: { int: 1 },
  },
  {
    id: 'ironBand',
    name: 'Iron Band',
    slot: 'accessory',
    rarity: 'common',
    cost: g(6),
    weight: 0,
    blurb: '+1 Strength.',
    adventureOnly: true,
    statMods: { str: 1 },
  },
  {
    id: 'quicksilverAnklet',
    name: 'Quicksilver Anklet',
    slot: 'accessory',
    rarity: 'common',
    cost: g(6),
    weight: 0,
    blurb: '+1 Dex.',
    adventureOnly: true,
    statMods: { dex: 1 },
  },
  {
    id: 'rubyPendant',
    name: 'Ruby Pendant',
    slot: 'accessory',
    rarity: 'rare',
    cost: g(16),
    weight: 0,
    blurb: 'Resist heat.',
    adventureOnly: true,
    resist: { resist: ['heat'] },
  },
  {
    id: 'sapphireRing',
    name: 'Sapphire Ring',
    slot: 'accessory',
    rarity: 'rare',
    cost: g(18),
    weight: 0,
    blurb: '+2 Int.',
    adventureOnly: true,
    statMods: { int: 2 },
  },
  {
    id: 'emeraldCharm',
    name: 'Emerald Charm',
    slot: 'accessory',
    rarity: 'rare',
    cost: g(16),
    weight: 0,
    blurb: '-20% debuff duration.',
    adventureOnly: true,
    debuffDurationMult: 0.8,
  },
  {
    id: 'onyxAmulet',
    name: 'Onyx Amulet',
    slot: 'accessory',
    rarity: 'rare',
    cost: g(16),
    weight: 0,
    blurb: 'Resist shadow.',
    adventureOnly: true,
    resist: { resist: ['shadow'] },
  },
  {
    id: 'amethystCirclet',
    name: 'Amethyst Circlet',
    slot: 'head',
    rarity: 'rare',
    cost: g(18),
    weight: 1,
    blurb: '-1 to all incoming sanity damage.',
    adventureOnly: true,
    mentalReduce: 1,
  },
  {
    id: 'stillsuit',
    name: 'Stillsuit',
    slot: 'torso',
    rarity: 'rare',
    cost: g(20),
    weight: 2,
    blurb: 'Resist heat. +1 armour.',
    adventureOnly: true,
    resist: { resist: ['heat'] },
    armor: { flat: 1 },
  },
  ...(
    [
      ['gemRuby', 'Ruby', 3],
      ['gemSapphire', 'Sapphire', 3],
      ['gemEmerald', 'Emerald', 3],
      ['gemAmethyst', 'Amethyst', 2],
      ['gemOnyx', 'Onyx', 3],
      ['gemDiamond', 'Diamond', 8],
      ['gemPearl', 'Pearl', 3],
    ] as const
  ).map(([id, name, gold]): ItemDef => ({
    id,
    name,
    slot: 'utility',
    rarity: 'consumeable',
    cost: g(gold),
    weight: 0.2,
    blurb: 'Material. Gemstone.',
    material: true,
    materialKind: 'gem',
    adventureOnly: true,
  })),
  ...(
    [
      ['herbMoonglow', 'Moonglow', 0.5],
      ['herbWaterleaf', 'Waterleaf', 0.5],
      ['herbDeathweed', 'Deathweed', 0.5],
      ['herbFireblossom', 'Fireblossom', 1],
    ] as const
  ).map(([id, name, gold]): ItemDef => ({
    id,
    name,
    slot: 'utility',
    rarity: 'consumeable',
    cost: g(gold),
    weight: 0.2,
    blurb: 'Material. Herb.',
    material: true,
    materialKind: 'herb',
    adventureOnly: true,
  })),
  ...(
    [
      ['manaStoneSmall', 'Small Mana Stone', 2, 0.2, 'Left by the dead.'],
      ['manaStoneMedium', 'Medium Mana Stone', 5, 0.3, 'Left by the dead.'],
      ['manaStoneBig', 'Big Mana Stone', 12, 0.5, 'Left by the dead.'],
      ['ectoplasm', 'Ectoplasm', 1, 0.1, 'Left by wisps and specters.'],
      ['darksteelBar', 'Darksteel Bar', 30, 2, 'Salvaged from defenders and ghasts.'],
      ['ghastEssence', 'Ghast Pearl', 25, 0.3, 'Salvaged from a ghast.'],
      ['lichCore', 'Lich Core', 150, 1, 'Salvaged from a lich.'],
      ['reaperCore', 'Reaper Core', 200, 1, 'Salvaged from a reaper.'],
      ['rabbitPelt', 'Rabbit Pelt', 1, 0.3, 'Skinned from a rabbit.'],
      ['slimeGel', 'Green Gel', 1, 0.2, 'Scraped from a green slime.'],
      ['gelRed', 'Red Gel', 1, 0.2, 'Scraped from a red slime.'],
      ['gelBlue', 'Blue Gel', 1, 0.2, 'Scraped from a blue slime.'],
      ['gelBlack', 'Black Gel', 1, 0.2, 'Scraped from a black slime.'],
      ['gelWhite', 'White Gel', 1, 0.2, 'Scraped from a white slime.'],
      ['wolfPelt', 'Wolf Pelt', 3, 0.8, 'Skinned from a wolf.'],
      ['wolfFang', 'Wolf Fang', 4, 0.1, 'Pulled from a wolf.'],
      ['boarHide', 'Boar Hide', 4, 1.5, 'Skinned from a boar.'],
      ['boarTusk', 'Boar Tusk', 6, 0.4, 'Pulled from a boar.'],
      ['lionPelt', 'Lion Pelt', 8, 1.2, 'Skinned from a lion.'],
      ['lionFang', 'Lion Fang', 7, 0.2, 'Pulled from a lion.'],
      ['spiderLeg', 'Spider Leg', 2, 0.2, 'Taken from a small spider.'],
      ['hugeSpiderLeg', 'Huge Spider Leg', 9, 0.8, 'Taken from a huge spider.'],
      ['gigantuanSpiderLeg', 'Gigantuan Spider Leg', 25, 2, 'Taken from a gigantuan spider.'],
      ['silk', 'Silk', 3, 0.1, 'Spun by a small spider.'],
      ['fineSilk', 'Fine Silk', 10, 0.1, 'Rare spider thread.'],
      ['koboldScale', 'Kobold Scale', 2, 0.3, 'Salvaged from a kobold.'],
      ['demonHorn', 'Soldier Demon Horn', 20, 1, 'Broken from a soldier demon.'],
      ['badCharm', 'Bad Charm', 15, 0.1, 'Dropped by an oni. It means ill.'],
      ['magmaShardTank', 'Magma Shard (Tank)', 30, 1, 'Salvaged from a tank magma sentinel.'],
      ['magmaShardHealer', 'Magma Shard (Healer)', 30, 1, 'Salvaged from a healer magma sentinel.'],
      ['magmaShardMage', 'Magma Shard (Mage)', 30, 1, 'Salvaged from a mage magma sentinel.'],
      ['wood', 'Wood', 1, 1, 'Cut timber.'],
      ['voidShard', 'Void Shard', 120, 0.3, 'Left by a reaper.'],
      ['beastHorn', 'Beast Demon Horn', 15, 0.8, 'Broken from a beast demon.'],
      ['pebble', 'Pebble', 1, 0.3, 'Shed by a rockling.'],
      ['lostSoul', 'Lost Soul', 250, 0.1, 'Freed from a deathknight.'],
    ] as const
  ).map(([id, name, silver, weight, source]): ItemDef => ({
    id,
    name,
    slot: 'utility',
    rarity: 'consumeable',
    cost: silver,
    weight,
    blurb: `Material. ${source}`,
    material: true,
    adventureOnly: true,
  })),
  {
    id: 'pickaxe',
    name: 'Pickaxe',
    slot: 'utility',
    rarity: 'consumeable',
    cost: g(3),
    weight: 3,
    blurb: 'Tool. Needed to mine ore. In the Mines each one carried is a pickaxe with 10 durability. Lost when it breaks.',
    material: true,
    tool: true,
    adventureOnly: true,
  },
  // ---- Adventure bags and key items ----------------------------------------
  {
    id: 'smallBag',
    name: 'Small Bag',
    slot: 'utility',
    rarity: 'common',
    cost: 5,
    weight: 1,
    blurb: 'Bag. 15 pack slots.',
    adventureOnly: true,
    pack: { slots: 15 },
  },
  {
    id: 'goodBag',
    name: 'Good Bag',
    slot: 'utility',
    rarity: 'rare',
    cost: g(2),
    weight: 1,
    blurb: 'Bag. 30 pack slots.',
    adventureOnly: true,
    pack: { slots: 30 },
  },
  {
    id: 'mineMap',
    name: 'Minemap',
    slot: 'utility',
    rarity: 'rare',
    cost: g(3),
    weight: 0,
    blurb: 'Key item. The party keeps its map of the Mines between visits. Kept through every bloodmoon.',
    adventureOnly: true,
    keyItem: true,
  },
  {
    id: 'paper',
    name: 'Paper',
    slot: 'utility',
    rarity: 'consumeable',
    cost: PAPER_COST.plain,
    weight: 0.1,
    blurb: 'A sheet ruled with three peg grids. A Hexcraft mage draws a hex on it from the pack, 1 mana a line.',
    adventureOnly: true,
    paper: 'plain',
  },
  {
    id: 'finePaper',
    name: 'Fine Paper',
    slot: 'utility',
    rarity: 'rare',
    cost: PAPER_COST.fine,
    weight: 0.1,
    blurb: 'Heavy vellum ruled with five peg grids. A Hexcraft mage draws a hex on it from the pack, 1 mana a line.',
    adventureOnly: true,
    paper: 'fine',
  },
  {
    id: 'hexCodex',
    name: 'Hex Codex',
    slot: 'utility',
    rarity: 'rare',
    cost: g(1.5),
    weight: 0,
    blurb: 'Key item. With it, a scriptorium will sell the party runes: three a day, offered by what they feel like, not by name.',
    adventureOnly: true,
    keyItem: true,
  },
  ...(
    [
      ['moonshardWhite', 'White Moonshard'],
      ['moonshardBlue', 'Blue Moonshard'],
      ['moonshardBlack', 'Black Moonshard'],
      ['moonshardRed', 'Red Moonshard'],
      ['moonshardGreen', 'Green Moonshard'],
    ] as const
  ).map(([id, name]): ItemDef => ({
    id,
    name,
    slot: 'utility',
    rarity: 'legendary',
    cost: g(8),
    weight: 0.3,
    blurb: 'Material. Left by a bloodmoon boss of its colour. The finest focus a crafting bench takes.'
      + (id === 'moonshardRed' ? ' Consume from the pack to learn Fire.'
        : id === 'moonshardBlue' ? ' Consume from the pack to learn Mind.'
        : id === 'moonshardBlack' ? ' Consume from the pack to learn Shadow.' : ''),
    material: true,
    adventureOnly: true,
  })),
  // ---- Adventure staffs: forged; held in hand, they never block casting ----
  ...(
    [
      ['rubyStaff', 'Ruby Staff', 'heat'],
      ['sapphireStaff', 'Sapphire Staff', 'cold'],
      ['emeraldStaff', 'Emerald Staff', 'corrosive'],
      ['amethystStaff', 'Amethyst Staff', 'sanity'],
      ['onyxStaff', 'Onyx Staff', 'shadow'],
      ['diamondStaff', 'Diamond Staff', 'light'],
      ['geodeStaff', 'Geode Staff', 'shatter'],
      ['lensStaff', 'Lens Staff', 'pierce'],
    ] as const
  ).map(([id, name, type]): ItemDef => ({
    id,
    name,
    slot: 'hand',
    rarity: 'rare',
    cost: g(8),
    weight: 1.5,
    blurb: `Staff. Main action, 3 mana: Xd6 ${type} to one foe within 10cm. X = 1 + Int/10.`,
    adventureOnly: true,
    isWand: true,
    staffBolts: [{ label: 'Bolt', mana: 3, sides: 6, type, rangePx: 10 * U }],
  })),
  {
    id: 'surgeStaff',
    name: 'Overcharged Staff',
    slot: 'hand',
    rarity: 'epic',
    cost: g(12),
    weight: 1.5,
    blurb: 'Staff. Spells cast through it: +50% damage, +2 mana.',
    adventureOnly: true,
    isWand: true,
    castThrough: { damageMult: 1.5, manaDelta: 2 },
  },
  {
    id: 'thriftStaff',
    name: "Miser's Staff",
    slot: 'hand',
    rarity: 'epic',
    cost: g(12),
    weight: 1.5,
    blurb: 'Staff. Spells cast through it: -2 mana.',
    adventureOnly: true,
    isWand: true,
    castThrough: { manaDelta: -2 },
  },
  {
    id: 'farStaff',
    name: "Farcaster's Staff",
    slot: 'hand',
    rarity: 'epic',
    cost: g(12),
    weight: 1.5,
    blurb: 'Staff. Spells cast through it: +5cm range.',
    adventureOnly: true,
    isWand: true,
    castThrough: { rangePx: 5 * U },
  },
  {
    id: 'hexStaff',
    name: 'Hexwood Staff',
    slot: 'hand',
    rarity: 'epic',
    cost: g(12),
    weight: 1.5,
    blurb: 'Staff. Spells cast through it hex the enemies they hit: +1 damage taken, 2 turns.',
    adventureOnly: true,
    isWand: true,
    castThrough: { hex: { name: 'Hexed', damageTaken: 1, duration: 3 } },
  },
  {
    id: 'prismStaff',
    name: 'Prism Staff',
    slot: 'hand',
    rarity: 'epic',
    cost: g(12),
    weight: 1.5,
    blurb: 'Staff. Spells cast through it: half of every hit is light damage.',
    adventureOnly: true,
    isWand: true,
    castThrough: { split: { share: 0.5, type: 'light' } },
  },
];

const ITEM_BY_ID: Record<ItemId, ItemDef> = ITEM_DEFS.reduce((acc, def) => {
  acc[def.id] = def;
  return acc;
}, {} as Record<ItemId, ItemDef>);

export function getItem(id: ItemId): ItemDef {
  if (isCraftedItemId(id)) return resolveCraftedItem(id) as ItemDef;
  if (isHexItemId(id)) return resolveHexItem(id) as ItemDef;
  return ITEM_BY_ID[id];
}

/** A catalogue id, or a crafted or drawn id that reads as a whole item. */
export function isItemId(value: unknown): value is ItemId {
  if (typeof value !== 'string') return false;
  if (isCraftedItemId(value)) return !!resolveCraftedItem(value);
  if (isHexItemId(value)) return !!resolveHexItem(value);
  return Object.prototype.hasOwnProperty.call(ITEM_BY_ID, value);
}

/** Ids an item once had, read as the item it became (saves, snapshots, the wire). */
const RENAMED: Readonly<Record<string, ItemId>> = {
  herbMoonleaf: 'herbMoonglow',
  herbEmberroot: 'herbFireblossom',
  herbBogcap: 'herbDeathweed',
  golemCore: 'stoneHeart',
  elementalGeode: 'redStone',
  echoMembrane: 'batLeather',
  gemOpal: 'gemOnyx',
};

/** `id`, or what it was renamed to. */
export function currentItemId(id: string): string {
  return Object.prototype.hasOwnProperty.call(RENAMED, id) ? RENAMED[id] : id;
}

/** A list is a valid {@link ItemId} array (used to sanitise networked carts). */
export function asItemIds(value: unknown): ItemId[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (typeof entry === 'string' ? currentItemId(entry) : entry)).filter(isItemId);
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
 * the carry capacity (weight). Items are considered in order and each is kept
 * only if it still fits. Deterministic, so both peers sanitise a cart to the same result.
 */
export function sanitizeCart(items: ItemId[], strength: number, budget = Infinity): ItemId[] {
  const cap = carryCapacity(strength);
  const kept: ItemId[] = [];
  const counts = emptySlotCounts();
  let spent = 0;
  let weight = 0;
  for (const id of items) {
    const def = ITEM_BY_ID[id];
    if (!def || def.enemyOnly) continue;
    if (spent + def.cost > budget) continue;
    if (weight + def.weight > cap) continue;
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

/**
 * Which item sets the current match draws its draft pool from. Configured once
 * at match start (identically on both online peers) via {@link setActiveItemSets}.
 * Defaults to the base catalogue only.
 */
let ACTIVE_ITEM_SETS: Set<ItemSet> = new Set<ItemSet>(['original']);

/** Choose which item sets the draft offers. Empty selection falls back to 'original'. */
export function setActiveItemSets(sets: Partial<Record<ItemSet, boolean>>): void {
  const next = new Set<ItemSet>();
  if (sets.original) next.add('original');
  if (sets.finns) next.add('finns');
  if (sets.dlc) next.add('dlc');
  if (next.size === 0) next.add('original');
  ACTIVE_ITEM_SETS = next;
}

/** All catalogue items of a rarity tier, optionally including Swamprun-only gear. */
export function itemsOfRarity(rarity: Rarity, includeSwamprunOnly = false): ItemDef[] {
  return ITEM_DEFS.filter(
    (d) =>
      d.rarity === rarity &&
      ACTIVE_ITEM_SETS.has(d.set ?? 'original') &&
      !d.enemyOnly &&
      !d.material &&
      !d.adventureOnly &&
      (includeSwamprunOnly || !d.swamprunOnly)
  );
}

/**
 * Roll a rarity tier. Rarer tiers are less likely; each point of Luck nudges the
 * roll slightly toward rarer tiers. Only tiers that contain items are eligible.
 * `rng` returns a float in [0, 1).
 */
export function rollRarity(rng: () => number, luck = 0, includeSwamprunOnly = false): Rarity {
  const tiers = RARITY_ORDER.filter((r) => itemsOfRarity(r, includeSwamprunOnly).length > 0);
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
export function draftChoices(
  rarity: Rarity,
  rng: () => number,
  count = 3,
  includeSwamprunOnly = false
): ItemId[] {
  const pool = itemsOfRarity(rarity, includeSwamprunOnly).map((d) => d.id);
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
