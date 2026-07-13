// Swamprun — an endless PvE survival mode. The player faces waves of steadily
// stronger foes until they fall. This module holds the creature roster and the
// wave-composition logic; the runtime wave manager lives in GameScene.

import type { Dice } from '../core/Dice';
import type { Mage } from '../core/Mage';
import type { DamageType, DamageClass } from '../core/Damage';

export type EnemyKind =
  | 'zombie'
  | 'skeleton'
  | 'wisp'
  | 'specter'
  | 'defender'
  | 'lich'
  | 'ghast'
  | 'reaper';

/** Static definition of a Swamprun creature. Rolled/instantiated at spawn. */
export interface EnemyDef {
  kind: EnemyKind;
  name: string;
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

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  // Basic shambler: slow, weak, mindless. Weak to light and blunt trauma.
  zombie: {
    kind: 'zombie',
    name: 'Zombie',
    hpSpec: '2d4+5', // 7–13, ~10
    sanity: MINDLESS_SANITY,
    moveUnits: 3,
    meleeSpec: '2',
    meleeType: 'shatter',
    meleeClass: 'physical',
    weakTypes: ['light', 'shatter'],
    sanityImmune: true,
    tint: 0x6f9a52,
  },
  // Elite undead: faster, tougher, shrugs off blades and points.
  skeleton: {
    kind: 'skeleton',
    name: 'Skeleton',
    hpSpec: '1d16+14', // 15–30
    sanity: MINDLESS_SANITY,
    moveUnits: 4,
    meleeSpec: '1d6',
    meleeType: 'shatter',
    meleeClass: 'physical',
    weakTypes: ['light', 'shatter'],
    resistTypes: ['pierce', 'slashing'],
    sanityImmune: true,
    tint: 0xd6cfae,
  },
  // Flickering mote: fragile and incorporeal, but multiplies if ignored.
  wisp: {
    kind: 'wisp',
    name: 'Wisp',
    hpSpec: '3',
    sanity: 3,
    moveUnits: 3,
    meleeSpec: '2',
    meleeType: 'shadow',
    meleeClass: 'physical',
    weakTypes: ['light'],
    physicalImmune: true,
    duplicateChance: 0.5,
    tint: 0x9fe0ff,
    scale: 0.7,
  },
  // Wailing shade: fast and incorporeal, assaults the mind.
  specter: {
    kind: 'specter',
    name: 'Specter',
    hpSpec: '2d4+5', // ~10
    sanity: 10,
    moveUnits: 10,
    meleeSpec: '1d6',
    meleeType: 'shadow',
    meleeClass: 'sanity',
    weakTypes: ['light'],
    physicalImmune: true,
    tint: 0xb7a8ff,
  },
  // Hulking bulwark: a wall of armour that blocks passage and crushes with blunt.
  defender: {
    kind: 'defender',
    name: 'Defender',
    hpSpec: '50',
    sanity: MINDLESS_SANITY,
    moveUnits: 5,
    meleeSpec: '2d6',
    meleeType: 'shatter',
    meleeClass: 'physical',
    meleeReach: 108,
    weakTypes: ['shatter'],
    resistTypes: ['pierce', 'slashing'],
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
    resistTypes: ['shatter'],
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
    hpSpec: '20', // fixed
    sanity: 30,
    moveUnits: 10,
    // A weak fallback bite; its real threats are the mark and the shove.
    meleeSpec: '1d3',
    meleeType: 'shadow',
    meleeClass: 'physical',
    meleeReach: 360, // 8cm — the shove reach
    immuneTypes: ['pierce', 'slashing', 'shatter', 'generic'],
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
    hpSpec: '33', // fixed
    sanity: MINDLESS_SANITY,
    moveUnits: 6,
    meleeSpec: '0', // the mark deals no damage
    meleeType: 'shadow',
    meleeClass: 'physical',
    meleeReach: 180, // 4cm mark range
    immuneTypes: ['pierce', 'slashing', 'shatter', 'generic', 'shadow'],
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
  if (def.bodyRadius != null) m.intrinsicBodyRadius = def.bodyRadius;
}

/** Wave at which each creature first appears. */
const UNLOCK: Record<EnemyKind, number> = {
  zombie: 1,
  wisp: 2,
  skeleton: 3,
  specter: 4,
  defender: 5,
  // The Ghast is a rare elite that starts appearing in generic waves at 6.
  ghast: 6,
  // The Lich and Reaper are bosses and are never rolled into a normal wave
  // (handled by the wave manager); the high unlock keeps generic budget logic
  // from picking them.
  lich: 999,
  reaper: 999,
};

/** Point cost of each creature when filling a wave's budget. */
const COST: Record<EnemyKind, number> = {
  zombie: 2,
  wisp: 2,
  skeleton: 4,
  specter: 5,
  defender: 8,
  ghast: 10,
  lich: 99,
  reaper: 99,
};

// The Lich and Reaper are intentionally excluded from generic wave rolls (boss
// spawn only).
const ALL_KINDS: EnemyKind[] = ['zombie', 'wisp', 'skeleton', 'specter', 'defender', 'ghast'];

/** Hard cap on simultaneous spawns from a single wave (keeps the board sane). */
const MAX_PER_WAVE = 12;

/**
 * Roll the roster for a given wave number. Budget grows each wave and is spent
 * greedily on unlocked creatures, biased toward tougher foes as waves climb.
 */
export function waveComposition(wave: number, rng: Dice): EnemyKind[] {
  const unlocked = ALL_KINDS.filter((k) => wave >= UNLOCK[k]);
  let budget = 3 + wave * 2;
  const out: EnemyKind[] = [];
  while (out.length < MAX_PER_WAVE) {
    const affordable = unlocked.filter((k) => COST[k] <= budget);
    if (affordable.length === 0) break;
    // Weight tougher creatures more heavily as the run wears on.
    const weights = affordable.map((k) => COST[k] * (1 + wave / 6));
    const totalW = weights.reduce((a, b) => a + b, 0);
    let pickR = rng.float() * totalW;
    let chosen = affordable[0];
    for (let i = 0; i < affordable.length; i++) {
      pickR -= weights[i];
      if (pickR <= 0) {
        chosen = affordable[i];
        break;
      }
    }
    out.push(chosen);
    budget -= COST[chosen];
  }
  if (out.length === 0) out.push('zombie');
  return out;
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
  }
  return res;
}
