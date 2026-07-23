// =============================================================================
//  LIFE-CLASS SUMMONS
// -----------------------------------------------------------------------------
//  Factories for the controllable minions conjured by Life-class "class spells".
//  A summon is a real {@link Mage} (so it reuses movement, items, melee,
//  rendering and the damage pipeline) that is flagged `isSummon` and driven by
//  its owner's "Command" bonus action rather than taking its own turn. See
//  {@link GameState.spawnSummon}.
// =============================================================================

import { Mage } from './Mage';
import type { Vec2 } from './utils';
import { RANGE_UNIT, MELEE_RANGE } from '../config/constants';

/** Divide and round up (each stat term rounds up on its own). */
const ceilDiv = (a: number, b: number): number => Math.ceil(a / b);

/** Range-units → pixels. */
const R = (units: number): number => units * RANGE_UNIT;

/**
 * Shared scaffold for every Life-class summon: a real {@link Mage} whose three
 * stats scale off the caster's intellect and the spell's cast roll, exactly
 * like {@link makeGhostSummon}:
 *   str = dex = int = ceil(dcRoll / 4) + ceil(ownerInt / 3)
 *   mana            = 5 + int
 * Callers then layer on the unit's body (hp), reach, movement and intrinsic
 * strike. The on-hit rider is attached by the caller (in the spells layer) so
 * this core module stays free of any dependency on the effects pipeline.
 */
function baseSummon(opts: {
  ownerInt: number;
  dcRoll: number;
  ownerName: string;
  suffix: string;
  pos: Vec2;
  team: number;
}): { unit: Mage; stat: number } {
  const stat = ceilDiv(opts.dcRoll, 4) + ceilDiv(opts.ownerInt, 3);
  const unit = new Mage({
    name: `${opts.ownerName}'s ${opts.suffix}`,
    isAI: false,
    team: opts.team,
    position: opts.pos,
    loadout: [],
  });
  unit.statStrength = stat;
  unit.statDex = stat;
  unit.statInt = stat;
  unit.maxMana = 5 + stat;
  unit.mana = unit.maxMana;
  unit.statsAssigned = true;
  return { unit, stat };
}

/**
 * Life · Mind Shadow — a controllable undead ghost that deals "mill" (sanity)
 * damage and can carry and use a single item. Its stats scale off the caster's
 * intellect and the spell's cast roll:
 *   str / dex / int = ceil(dcRoll / 4) + ceil(ownerInt / 3)
 *   mana            = 5 + int
 *   hp              = 7
 * It is incorporeal (physical damage voiöded bar light), mindless (sanity damage
 * voided) and weak to light — "bad in the daylight" like every other ghost.
 */
export function makeGhostSummon(opts: {
  ownerInt: number;
  dcRoll: number;
  ownerName: string;
  pos: Vec2;
  team: number;
}): Mage {
  const share = ceilDiv(opts.dcRoll, 4);
  const fromInt = ceilDiv(opts.ownerInt, 3);
  const str = share + fromInt;
  const dex = share + fromInt;
  const int = share + fromInt;

  const g = new Mage({
    name: `${opts.ownerName}'s Ghost`,
    isAI: false,
    team: opts.team,
    position: opts.pos,
    loadout: [],
  });

  g.maxHp = 7;
  g.hp = 7;
  // Undead: mindless, so mental damage is voided. Keep a safety sanity pool so
  // `alive` (hp > 0 && sanity > 0) never trips on the mind axis.
  g.maxSanity = 999;
  g.sanity = 999;
  g.sanityImmune = true;

  g.statStrength = str;
  g.statDex = dex;
  g.statInt = int;
  g.maxMana = 5 + int;
  g.mana = g.maxMana;
  g.statsAssigned = true;

  // Mundane blows pass through it; magical physical damage still connects.
  g.intrinsicImmuneTypes = ['pierce', 'shatter', 'slashing', 'generic'];
  g.intrinsicWeakTypes = ['light'];
  g.intrinsicMelee = { spec: '1d4', type: 'shadow', damageClass: 'sanity' };

  return g;
}

/**
 * Life · Corrode Curse — a slow, pacifist "walking totem". It trudges a fixed 5
 * range-units a step and pulses corrosive damage around itself. A stocky
 * construct (hp 8).
 */
export function makeCorrosionSentry(opts: {
  ownerInt: number;
  dcRoll: number;
  ownerName: string;
  pos: Vec2;
  team: number;
}): Mage {
  const { unit } = baseSummon({ ...opts, suffix: 'Rot Sentry' });
  unit.maxHp = 8;
  unit.hp = 8;
  unit.intrinsicMoveUnits = 5; // ponderous, totem-like crawl
  unit.cannotAttack = true;
  unit.intrinsicDamageAura = {
    radius: R(3),
    damageSpec: '1d3',
    type: 'corrosive',
    damageClass: 'physical',
  };
  return unit;
}

/**
 * Life · Bind Curse — a ranged binder. It lashes shackling shadow at foes up to
 * 10 range-units away and roots what it hits (rider attached by the caller).
 * Fragile (hp 6).
 */
export function makeBinderSummon(opts: {
  ownerInt: number;
  dcRoll: number;
  ownerName: string;
  pos: Vec2;
  team: number;
}): Mage {
  const { unit } = baseSummon({ ...opts, suffix: 'Binder' });
  unit.maxHp = 6;
  unit.hp = 6;
  unit.intrinsicMelee = { spec: '1d3', type: 'shadow', damageClass: 'physical' };
  unit.intrinsicMeleeReach = R(10);
  return unit;
}

/**
 * Life · Veil Corrode Pierce — a corroding archer. It fires piercing, acidic
 * bolts out to 15 range-units but cannot loose point-blank (min 10). Its shots
 * reveal the hidden and slow the struck (rider attached by the caller). Fragile
 * (hp 6).
 */
export function makeArcherSummon(opts: {
  ownerInt: number;
  dcRoll: number;
  ownerName: string;
  pos: Vec2;
  team: number;
}): Mage {
  const { unit } = baseSummon({ ...opts, suffix: 'Corroding Archer' });
  unit.maxHp = 6;
  unit.hp = 6;
  unit.intrinsicMelee = { spec: '1d4', type: 'corrosive', damageClass: 'physical' };
  unit.intrinsicMeleeReach = R(15);
  unit.intrinsicMeleeMin = R(10);
  return unit;
}

/**
 * Life · Corrode Mind — a neural parasite whose bite corrodes sanity and the
 * victim's ability to react. Fragile, quick, and dangerous only at close range.
 */
export function makeNeuralLeech(opts: {
  ownerInt: number;
  dcRoll: number;
  ownerName: string;
  pos: Vec2;
  team: number;
}): Mage {
  const { unit } = baseSummon({ ...opts, suffix: 'Neural Leech' });
  unit.maxHp = 5;
  unit.hp = 5;
  unit.intrinsicMoveUnits = 7;
  unit.intrinsicMelee = { spec: '1d3', type: 'corrosive', damageClass: 'sanity' };
  unit.intrinsicMeleeReach = MELEE_RANGE;
  return unit;
}

/**
 * Life · Drain Mind — a thought-eater that steals one charged word whenever it
 * bites. Its spell-layer rider decides whether the stolen thought becomes a
 * matching word charge or raw mana for the owner.
 */
export function makeThoughtLeech(opts: {
  ownerInt: number;
  dcRoll: number;
  ownerName: string;
  pos: Vec2;
  team: number;
}): Mage {
  const { unit } = baseSummon({ ...opts, suffix: 'Thought Leech' });
  unit.maxHp = 5;
  unit.hp = 5;
  unit.intrinsicMoveUnits = 8;
  unit.intrinsicMelee = { spec: '1d3', type: 'shadow', damageClass: 'sanity' };
  unit.intrinsicMeleeReach = MELEE_RANGE;
  return unit;
}
