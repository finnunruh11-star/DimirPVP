// Swamprun — an endless PvE survival mode. The player faces waves of steadily
// stronger foes until they fall. This module holds the creature roster and the
// wave-composition logic; the runtime wave manager lives in GameScene.

import type { Dice } from '../core/Dice';
import type { Mage } from '../core/Mage';
import type { DamageType, DamageClass } from '../core/Damage';
import { RANGE_UNIT } from '../config/constants';

export type EnemyKind =
  | 'zombie'
  | 'skeleton'
  | 'wisp'
  | 'specter'
  | 'defender'
  | 'lich'
  | 'ghast'
  | 'reaper'
  | 'soldierDemon'
  | 'beastDemon'
  | 'oni'
  | 'deathknightSpear'
  | 'acidZombie';

export type SwamprunCurse = 'madness' | 'decay' | 'sloth' | 'feeding';
export const RAID_BOSS_KINDS = ['lich', 'reaper', 'deathknightSpear'] as const;
export type RaidBossKind = (typeof RAID_BOSS_KINDS)[number];

export const SWAMPRUN_DEPTH_STEP = 100;
export const DEEP_SWAMP_DEPTH = 800;

/** Authored encounter-power floor for each standard-swamp depth. */
export const STANDARD_DEPTH_POWER: Record<number, number> = {
  100: 4,
  200: 8,
  300: 12,
  400: 16,
  500: 22,
  600: 30,
  700: 40,
};

export function swamprunDepth(wave: number): number {
  return Math.max(1, Math.floor(wave)) * SWAMPRUN_DEPTH_STEP;
}

/** Static definition of a Swamprun creature. Rolled/instantiated at spawn. */
export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  /** Encounter power spent to add this creature to a wave. */
  power: number;
  /** First depth (metres) at which this creature may be rolled. */
  unlockDepth: number;
  /** Max-HP dice spec, rolled once at spawn (a flat number is allowed). */
  hpSpec: string;
  /** Sanity pool. Mindless creatures set this high and rely on `sanityImmune`. */
  sanity: number;
  /** Movement range in abstract range-units ("cm"), independent of Dexterity. */
  moveUnits: number;
  /** Intrinsic melee strike. */
  meleeSpec: string;
  meleeType: DamageType;
  meleeClass: DamageClass;
  /** Reach (px) of the melee; bulky bodies need extra to strike past their hull. */
  meleeReach?: number;
  immuneTypes?: DamageType[];
  resistTypes?: DamageType[];
  weakTypes?: DamageType[];
  /** Mindless: sanity-class damage is voided. */
  sanityImmune?: boolean;
  /** Incorporeal: physical-class damage is voided (except 'light'). */
  physicalImmune?: boolean;
  /** Larger collision body (px) — bulky creatures block passage. */
  bodyRadius?: number;
  /** Wisp gimmick: chance each of its turns to spawn a copy of itself. */
  duplicateChance?: number;
  /** Immune to every debuff/DoT/stun/control (Lich). */
  debuffImmune?: boolean;
  /** Boss creature: unique, expensive, and (Lich) revives once at half HP. */
  boss?: boolean;
  /** Revives once at 50% max HP the first time it would die (Lich). */
  reviveAtHalf?: boolean;
  /** Ghast: enables the delayed area-mark + shove kiting behaviour. */
  ghastKind?: boolean;
  /** Reaper: enables the leash, unpreventable mark, channel-clap and damage cap. */
  reaperKind?: boolean;
  /** Reaper: max damage this creature may take from any single entity per round. */
  damageCapPerSource?: number;
  /** Sprite tint, so creature kinds read apart at a glance. */
  tint: number;
  /** Sprite scale multiplier applied on top of the base mage size. */
  scale?: number;
}

// Mindless things keep a huge sanity pool purely as a safety net; `sanityImmune`
// already voids all mental damage, so it never actually drops.
const MINDLESS_SANITY = 999;

// Every swamp dweller resists heat and is weak to light, so a heat hit (half
// heat, half light) settles at ×1.25 against the whole roster.
export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  // Basic shambler: slow, weak, mindless. Weak to light and blunt trauma.
  zombie: {
    kind: 'zombie',
    name: 'Zombie',
    power: 3,
    unlockDepth: 100,
    hpSpec: '2d4+5', // 7–13, ~10
    sanity: MINDLESS_SANITY,
    moveUnits: 3,
    meleeSpec: '2',
    meleeType: 'shatter',
    meleeClass: 'physical',
    weakTypes: ['light', 'shatter'],
    resistTypes: ['heat'],
    sanityImmune: true,
    tint: 0x6f9a52,
  },
  // Elite undead: faster, tougher, shrugs off blades and points.
  skeleton: {
    kind: 'skeleton',
    name: 'Skeleton',
    power: 5,
    unlockDepth: 200,
    hpSpec: '1d16+14', // 15–30
    sanity: MINDLESS_SANITY,
    moveUnits: 4,
    meleeSpec: '1d6',
    meleeType: 'shatter',
    meleeClass: 'physical',
    weakTypes: ['light', 'shatter'],
    resistTypes: ['pierce', 'slashing', 'heat'],
    sanityImmune: true,
    tint: 0xd6cfae,
  },
  // Flickering mote: fragile and incorporeal, but multiplies if ignored.
  wisp: {
    kind: 'wisp',
    name: 'Wisp',
    power: 3,
    unlockDepth: 100,
    hpSpec: '3',
    sanity: 3,
    moveUnits: 3,
    meleeSpec: '2',
    meleeType: 'shadow',
    meleeClass: 'physical',
    weakTypes: ['light'],
    resistTypes: ['heat'],
    physicalImmune: true,
    duplicateChance: 0.5,
    tint: 0x9fe0ff,
    scale: 0.7,
  },
  // Wailing shade: fast and incorporeal, assaults the mind.
  specter: {
    kind: 'specter',
    name: 'Specter',
    power: 7,
    unlockDepth: 300,
    hpSpec: '2d4+5', // ~10
    sanity: 10,
    moveUnits: 10,
    meleeSpec: '1d6',
    meleeType: 'shadow',
    meleeClass: 'sanity',
    weakTypes: ['light'],
    resistTypes: ['heat'],
    physicalImmune: true,
    tint: 0xb7a8ff,
  },
  // Hulking bulwark: a wall of armour that blocks passage and crushes with blunt.
  defender: {
    kind: 'defender',
    name: 'Defender',
    power: 12,
    unlockDepth: 500,
    hpSpec: '50',
    sanity: MINDLESS_SANITY,
    moveUnits: 5,
    meleeSpec: '2d6',
    meleeType: 'shatter',
    meleeClass: 'physical',
    meleeReach: 108,
    weakTypes: ['shatter', 'light'],
    resistTypes: ['pierce', 'slashing', 'heat'],
    sanityImmune: true,
    bodyRadius: 58,
    tint: 0x8f8f97,
    scale: 1.6,
  },
  // Lich: a super-intelligent undead commander. Fixed 30 HP, high sanity, slow.
  // Immune to shadow, all base physical except shatter, and every debuff. Weak
  // to light; resists shatter. Wields bespoke Drain/Curse/Void powers (no dice,
  // no mana — always succeed), revives once at half HP, and directs every other
  // undead on the field to play optimally.
  lich: {
    kind: 'lich',
    name: 'Lich',
    power: 18,
    unlockDepth: 600,
    hpSpec: '30', // fixed, not randomized
    sanity: 80,
    moveUnits: 6,
    // Weak 1d3 shadow bite at 10cm range. The Lich is smart and rarely stoops
    // to it, preferring its death-words — but it can pick off a distant foe.
    meleeSpec: '1d3',
    meleeType: 'shadow',
    meleeClass: 'physical',
    meleeReach: 450, // 10cm (10 × RANGE_UNIT)
    // "Physical except shatter" immunity is spelled out as the base physical
    // types minus shatter, plus shadow. Shatter is only resisted; light hurts.
    immuneTypes: ['pierce', 'slashing', 'generic', 'shadow'],
    resistTypes: ['shatter', 'heat'],
    weakTypes: ['light'],
    debuffImmune: true,
    boss: true,
    reviveAtHalf: true,
    bodyRadius: 40,
    tint: 0x3ad6b0,
    scale: 1.3,
  },
  // Ghast: an elite shadow-caster on par with (or above) the Defender. It never
  // wants to be near you — it marks the ground for a delayed shadow burst and
  // shoves anyone who closes in, then flees. Immune to raw physical damage types
  // (corrosive and shadow still bite) and to every debuff; weak to light.
  ghast: {
    kind: 'ghast',
    name: 'Ghast',
    power: 9,
    unlockDepth: 400,
    hpSpec: '20', // fixed
    sanity: 30,
    moveUnits: 10,
    // A weak fallback bite; its real threats are the mark and the shove.
    meleeSpec: '1d3',
    meleeType: 'shadow',
    meleeClass: 'physical',
    meleeReach: 360, // 8cm — the shove reach
    immuneTypes: ['pierce', 'slashing', 'shatter', 'generic'],
    resistTypes: ['heat'],
    weakTypes: ['light'],
    debuffImmune: true,
    ghastKind: true,
    bodyRadius: 42,
    tint: 0x7a4fb0,
    scale: 1.35,
  },
  // Reaper: a boss beyond even the Lich. Fixed 33 HP, mindless (infinite
  // sanity), slow. It leashes its prey (you cannot flee more than 6cm/turn from
  // it), marks foes with an unpreventable touch, then channels and claps to
  // delete every marked foe — killing the Reaper restores them. No single
  // entity may deal it more than 10 damage per round. Immune to physical damage
  // types, shadow, and every debuff; only light truly hurts it.
  reaper: {
    kind: 'reaper',
    name: 'Reaper',
    power: 28,
    unlockDepth: 700,
    hpSpec: '33', // fixed
    sanity: MINDLESS_SANITY,
    moveUnits: 6,
    meleeSpec: '0', // the mark deals no damage
    meleeType: 'shadow',
    meleeClass: 'physical',
    meleeReach: 180, // 4cm mark range
    immuneTypes: ['pierce', 'slashing', 'shatter', 'generic', 'shadow'],
    resistTypes: ['heat'],
    weakTypes: ['light'],
    sanityImmune: true,
    debuffImmune: true,
    boss: true,
    reaperKind: true,
    damageCapPerSource: 10,
    bodyRadius: 46,
    tint: 0x1a1a22,
    scale: 1.55,
  },
  soldierDemon: {
    kind: 'soldierDemon',
    name: 'Soldier Demon',
    power: 12,
    unlockDepth: DEEP_SWAMP_DEPTH,
    hpSpec: '3d8+18',
    sanity: 24,
    moveUnits: 5,
    meleeSpec: '2d6+2',
    meleeType: 'slashing',
    meleeClass: 'physical',
    resistTypes: ['pierce', 'slashing', 'heat'],
    weakTypes: ['light'],
    bodyRadius: 48,
    tint: 0xb83b32,
    scale: 1.45,
  },
  beastDemon: {
    kind: 'beastDemon',
    name: 'Beast Demon',
    power: 10,
    unlockDepth: DEEP_SWAMP_DEPTH,
    hpSpec: '3d6+12',
    sanity: 18,
    moveUnits: 9,
    meleeSpec: '1d8',
    meleeType: 'slashing',
    meleeClass: 'physical',
    weakTypes: ['light'],
    resistTypes: ['heat'],
    tint: 0xd86b35,
    scale: 1.25,
  },
  oni: {
    kind: 'oni',
    name: 'Oni',
    power: 14,
    unlockDepth: DEEP_SWAMP_DEPTH,
    hpSpec: '2d10+15',
    sanity: 30,
    moveUnits: 7,
    meleeSpec: '2d6',
    meleeType: 'shadow',
    meleeClass: 'physical',
    weakTypes: ['light'],
    resistTypes: ['heat'],
    tint: 0x7b2337,
    scale: 1.3,
  },
  deathknightSpear: {
    kind: 'deathknightSpear',
    name: 'Deathknight (Spear)',
    power: 100,
    unlockDepth: DEEP_SWAMP_DEPTH,
    hpSpec: '125',
    sanity: 99,
    moveUnits: 12,
    meleeSpec: '2d10',
    meleeType: 'pierce',
    meleeClass: 'physical',
    meleeReach: 5 * RANGE_UNIT,
    // Armoured against ordinary steel and its own darkness; blunt force still tells.
    resistTypes: ['pierce', 'slashing', 'generic', 'shadow', 'heat'],
    weakTypes: ['light', 'cleansing', 'healing'],
    boss: true,
    bodyRadius: 52,
    tint: 0x63253d,
    scale: 1.65,
  },
  acidZombie: {
    kind: 'acidZombie',
    name: 'Acid Zombie',
    power: 4,
    unlockDepth: DEEP_SWAMP_DEPTH,
    hpSpec: '2d3+3',
    sanity: MINDLESS_SANITY,
    moveUnits: 3,
    meleeSpec: '1d4',
    meleeType: 'corrosive',
    meleeClass: 'physical',
    meleeReach: 10 * RANGE_UNIT,
    weakTypes: ['light', 'shatter'],
    resistTypes: ['heat'],
    sanityImmune: true,
    tint: 0x87ad35,
  },
};

/** Configure an already-constructed team-2 Mage as the given creature kind. */
export function applyEnemyTraits(m: Mage, kind: EnemyKind, rng: Dice): void {
  const def = ENEMY_DEFS[kind];
  m.enemyKind = kind;
  m.name = def.name;
  m.maxHp = Math.max(1, rng.roll(def.hpSpec).total);
  m.hp = m.maxHp;
  m.maxSanity = def.sanity;
  m.sanity = def.sanity;
  m.intrinsicMoveUnits = def.moveUnits;
  m.intrinsicMelee = { spec: def.meleeSpec, type: def.meleeType, damageClass: def.meleeClass };
  if (def.meleeReach != null) m.intrinsicMeleeReach = def.meleeReach;
  m.intrinsicImmuneTypes = [...(def.immuneTypes ?? [])];
  m.intrinsicResistTypes = [...(def.resistTypes ?? [])];
  m.intrinsicWeakTypes = [...(def.weakTypes ?? [])];
  m.sanityImmune = !!def.sanityImmune;
  m.physicalImmune = !!def.physicalImmune;
  m.debuffImmune = !!def.debuffImmune;
  m.isBoss = !!def.boss;
  m.reviveAtHalfAvailable = !!def.reviveAtHalf;
  m.ghastKind = !!def.ghastKind;
  m.reaperKind = !!def.reaperKind;
  m.damageCapPerSource = def.damageCapPerSource ?? 0;
  m.intrinsicArmorFlat = kind === 'soldierDemon' ? 2 : 0;
  m.beastDemonKind = kind === 'beastDemon';
  m.beastDemonBlood = 0;
  m.oniKind = kind === 'oni';
  m.oniHidden = kind === 'oni';
  m.deathknightKind = kind === 'deathknightSpear';
  m.slowStunImmune = kind === 'deathknightSpear';
  m.acidZombieKind = kind === 'acidZombie';
  if (m.beastDemonKind) m.intrinsicMeleeReach = 10 * RANGE_UNIT;
  if (def.bodyRadius != null) m.intrinsicBodyRadius = def.bodyRadius;
}

const STANDARD_KINDS: EnemyKind[] = [
  'zombie',
  'wisp',
  'skeleton',
  'specter',
  'ghast',
  'defender',
  'lich',
  'reaper',
];
const EXTRA_MEMBER_BUDGET_SCALE = 0.75;

/** Multiplayer pressure: each extra party member adds 75% of a solo wave. */
export function swamprunPartyScale(partySize: number): number {
  return 1 + Math.max(0, Math.floor(partySize) - 1) * EXTRA_MEMBER_BUDGET_SCALE;
}

export interface SwamprunEncounter {
  depth: number;
  power: number;
  deep: boolean;
  kinds: EnemyKind[];
}

const STANDARD_TEMPLATES: Record<number, (roll: number) => EnemyKind[]> = {
  100: (roll) => Array.from({ length: roll >= 11 ? 3 : 2 }, () => 'zombie' as EnemyKind),
  200: () => ['skeleton', 'skeleton', 'wisp', 'wisp'],
  300: () => ['specter', 'specter', 'skeleton'],
  400: () => ['ghast', 'wisp', 'wisp'],
  500: (roll) => (roll >= 19 ? ['lich', 'defender'] : ['defender', 'defender']),
  600: (roll) => ['lich', ...Array.from({ length: roll >= 18 ? 2 : roll >= 10 ? 1 : 0 }, () => 'zombie' as EnemyKind)],
  700: (roll) => (roll >= 18 ? ['lich', 'defender', 'defender'] : ['reaper']),
};

function deepTemplate(roll: number): EnemyKind[] {
  if (roll === 10) return ['deathknightSpear'];
  if (roll >= 9) return ['soldierDemon', 'soldierDemon', 'soldierDemon', 'oni', 'oni'];
  if (roll >= 7) return ['soldierDemon', 'soldierDemon', 'beastDemon', 'oni'];
  if (roll >= 4) return ['soldierDemon', 'soldierDemon', 'oni'];
  return ['soldierDemon', 'soldierDemon', 'beastDemon'];
}

function scaleCompactRoster(kinds: EnemyKind[], partySize: number): EnemyKind[] {
  if (kinds.includes('deathknightSpear')) return kinds;
  const extraMembers = Math.max(0, Math.min(3, Math.floor(partySize) - 1));
  if (extraMembers === 0) return kinds;
  const strongest = [...kinds]
    .filter((kind) => !ENEMY_DEFS[kind].boss)
    .sort((a, b) => ENEMY_DEFS[b].power - ENEMY_DEFS[a].power)[0] ?? kinds[0];
  return [...kinds, ...Array.from({ length: extraMembers }, () => strongest)];
}

/** Roll one compact encounter: standard swamps use d20, Deep Swamps use d10. */
export function rollSwamprunEncounter(wave: number, rng: Dice, partySize = 1): SwamprunEncounter {
  const depth = swamprunDepth(wave);
  const deep = depth >= DEEP_SWAMP_DEPTH;
  const roll = rng.die(deep ? 10 : 20);
  const basePower = deep
    ? 55 + Math.max(0, Math.floor(wave) - 8) * 8
    : STANDARD_DEPTH_POWER[Math.min(700, depth)] ?? STANDARD_DEPTH_POWER[700];
  const power = Math.round((basePower + roll) * swamprunPartyScale(partySize));
  const baseKinds = deep
    ? deepTemplate(roll)
    : STANDARD_TEMPLATES[Math.min(700, depth)]?.(roll) ?? STANDARD_TEMPLATES[700](roll);
  return { depth, power, deep, kinds: scaleCompactRoster(baseKinds, partySize) };
}

/** Compatibility helper for callers that only need the rolled roster. */
export function waveComposition(wave: number, rng: Dice, partySize = 1): EnemyKind[] {
  return rollSwamprunEncounter(wave, rng, partySize).kinds;
}

// =============================================================================
//  LOOT
// -----------------------------------------------------------------------------
//  When a wave is cleared the party auto-sells every creature's drops for gold,
//  which is then spent in the between-wave shop. Values below are the sale price
//  of each flavour drop.
// =============================================================================

/** Gold sale value of each flavour drop. */
export const DROP_VALUE = {
  smallManaStone: 1,
  mediumManaStone: 2,
  bigManaStone: 3,
  ectoplasm: 0.5,
  darksteelBar: 6,
  ghastEssence: 5,
  lichCore: 25,
  reaperCore: 30,
} as const;

export interface LootResult {
  /** Gold earned from this single creature. */
  gold: number;
  /** Flavour names of what dropped, for the loot log. */
  drops: string[];
}

/**
 * Roll the loot a single creature yields on death. Wisp *copies* (spawned by a
 * living wisp) drop nothing — pass `isCopy` for those.
 */
export function rollLoot(kind: EnemyKind, rng: Dice, isCopy = false): LootResult {
  const res: LootResult = { gold: 0, drops: [] };
  if (isCopy) return res;
  const d20 = (): number => rng.die(20);
  switch (kind) {
    case 'zombie':
      res.gold += 0.5;
      if (d20() <= 2) {
        res.gold += DROP_VALUE.smallManaStone;
        res.drops.push('small mana stone');
      }
      break;
    case 'skeleton':
      res.gold += 1;
      if (d20() <= 1) {
        res.gold += DROP_VALUE.smallManaStone;
        res.drops.push('small mana stone');
      }
      if (d20() <= 1) {
        res.gold += DROP_VALUE.mediumManaStone;
        res.drops.push('medium mana stone');
      }
      break;
    case 'wisp':
      res.gold += 0.5;
      if (d20() <= 10) {
        res.gold += DROP_VALUE.ectoplasm;
        res.drops.push('ectoplasm');
      }
      break;
    case 'specter': {
      res.gold += 2;
      let ecto = 1; // one guaranteed, then 50% each for more until a miss
      while (rng.chance(0.5)) ecto++;
      res.gold += ecto * DROP_VALUE.ectoplasm;
      res.drops.push(`${ecto}\u00d7 ectoplasm`);
      break;
    }
    case 'defender': {
      const r = d20(); // one mutually-exclusive roll on the drop table
      if (r <= 8) {
        res.gold += DROP_VALUE.mediumManaStone;
        res.drops.push('medium mana stone');
      } else if (r <= 16) {
        res.gold += DROP_VALUE.bigManaStone;
        res.drops.push('big mana stone');
      } else if (r <= 19) {
        res.gold += DROP_VALUE.darksteelBar;
        res.drops.push('darksteel bar');
      } else {
        res.gold += 2 * DROP_VALUE.darksteelBar;
        res.drops.push('2\u00d7 darksteel bar');
      }
      break;
    }
    case 'ghast': {
      // Elite tier — sits between the Defender and the bosses.
      const r = d20();
      if (r <= 10) {
        res.gold += DROP_VALUE.bigManaStone;
        res.drops.push('big mana stone');
      } else if (r <= 17) {
        res.gold += DROP_VALUE.darksteelBar;
        res.drops.push('darksteel bar');
      } else {
        res.gold += DROP_VALUE.ghastEssence;
        res.drops.push('ghast essence');
      }
      break;
    }
    case 'lich': {
      // Recursive boss hoard rolled on a d20, potentially unbounded via rerolls:
      //   1-6   → +1 ectoplasm
      //   7-17  → +1 ectoplasm and +1 reroll
      //   18-19 → a Lich Core
      //   20    → +2 rerolls
      // The negative drift on the reroll count guarantees it terminates; a hard
      // cap guards against any pathological rng seed.
      let rerolls = 1;
      let ecto = 0;
      let cores = 0;
      let guard = 0;
      while (rerolls > 0 && guard++ < 500) {
        rerolls -= 1;
        const r = d20();
        if (r <= 6) {
          ecto += 1;
        } else if (r <= 17) {
          ecto += 1;
          rerolls += 1;
        } else if (r <= 19) {
          cores += 1;
        } else {
          rerolls += 2;
        }
      }
      if (ecto > 0) {
        res.gold += ecto * DROP_VALUE.ectoplasm;
        res.drops.push(`${ecto}\u00d7 ectoplasm`);
      }
      if (cores > 0) {
        res.gold += cores * DROP_VALUE.lichCore;
        res.drops.push(`${cores}\u00d7 Lich Core`);
      }
      break;
    }
    case 'reaper': {
      // The Reaper hoards even richer than the Lich — the same recursive d20
      // minigame, but with fatter payouts and its own core:
      //   1-5   → +2 ectoplasm
      //   6-16  → +1 ectoplasm and +1 reroll
      //   17-19 → a Reaper Core
      //   20    → +2 rerolls
      let rerolls = 1;
      let ecto = 0;
      let cores = 0;
      let guard = 0;
      while (rerolls > 0 && guard++ < 500) {
        rerolls -= 1;
        const r = d20();
        if (r <= 5) {
          ecto += 2;
        } else if (r <= 16) {
          ecto += 1;
          rerolls += 1;
        } else if (r <= 19) {
          cores += 1;
        } else {
          rerolls += 2;
        }
      }
      if (ecto > 0) {
        res.gold += ecto * DROP_VALUE.ectoplasm;
        res.drops.push(`${ecto}\u00d7 ectoplasm`);
      }
      if (cores > 0) {
        res.gold += cores * DROP_VALUE.reaperCore;
        res.drops.push(`${cores}\u00d7 Reaper Core`);
      }
      break;
    }
    case 'soldierDemon':
      res.gold += 4;
      res.drops.push('demonsteel scrap');
      break;
    case 'beastDemon':
      res.gold += 3;
      res.drops.push('coagulated demon blood');
      break;
    case 'oni':
      res.gold += 5;
      res.drops.push('oni mask shard');
      break;
    case 'deathknightSpear':
      res.gold += 40;
      res.drops.push('deathknight spearhead');
      break;
    case 'acidZombie':
      res.gold += 0.5;
      res.drops.push('acid gland');
      break;
  }
  return res;
}
