// =============================================================================
//  GEN SAND SUMMONS
// -----------------------------------------------------------------------------
//  Stat blocks for the desert kingdom's conjured soldiery. Every one is a real
//  {@link Mage} flagged `isSummon`, driven by its owner's Command bonus action,
//  exactly like the Life-class summons in ./summons.ts.
//
//  KEYWORD MAPPING (the design doc's words -> this engine):
//    blunt -> 'shatter'      dark -> 'shadow'        piercing -> 'pierce'
//    mill  -> the sanity pool (immunity via `sanityImmune`)
//    purification -> 'cleansing'
//    movement-impairing -> slowStunImmune / slowStunResist
//    displacement / misplacement -> displacementImmune / displacementWeak
//    external-control, mind-control -> controlImmune
//    debuffs -> debuffImmune
//  'cold', 'water' and 'malforming' are real damage types added for this set.
//
//  "floats" is flavour only: it deliberately does NOT set `intrinsicAirborne`,
//  which would make these units unreachable by ordinary melee.
// =============================================================================

import { Mage } from './Mage';
import type { Vec2 } from './utils';
import { RANGE_UNIT, MELEE_RANGE } from '../config/constants';

/** Range-units ("cm" in the design doc) -> pixels. */
const R = (units: number): number => units * RANGE_UNIT;

interface SummonOpts {
  ownerName: string;
  pos: Vec2;
  team: number;
}

/** A summon with a fixed stat block: nothing here scales off the caster. */
function unit(opts: SummonOpts, name: string, hp: number, mill: number): Mage {
  const m = new Mage({
    name: `${opts.ownerName}'s ${name}`,
    isAI: false,
    team: opts.team,
    position: opts.pos,
    loadout: [],
  });
  m.maxHp = hp;
  m.hp = hp;
  m.maxSanity = mill;
  m.sanity = mill;
  m.statsAssigned = true;
  return m;
}

/** The shared Sandsoldier chassis: sand-born, sun-proof, washed away by water. */
function sandsoldier(m: Mage, dropsOnDeath: number): Mage {
  m.sandBorn = true;
  m.sandStrider = true;
  m.sandDropOnDeath = dropsOnDeath;
  m.sanityImmune = true;
  m.controlImmune = true;
  m.slowStunResist = true;
  m.displacementWeak = true;
  m.intrinsicImmuneTypes = ['heat', 'cold', 'light'];
  m.intrinsicResistTypes = ['malforming', 'shadow'];
  m.intrinsicWeakTypes = ['shatter', 'water'];
  return m;
}

/**
 * Sand Heal — a floating field-medic. Its "attack" cleanses rather than wounds,
 * and every second strike costs a charge of sand to keep it standing.
 */
export function makeSandPriest(opts: SummonOpts): Mage {
  const m = sandsoldier(unit(opts, 'Sandsoldier-Priest', 5, 15), 1);
  m.intrinsicMoveUnits = 3;
  m.intrinsicMelee = { spec: '1d3', type: 'healing', damageClass: 'physical' };
  m.intrinsicMeleeReach = R(10);
  m.sandUpkeepEvery = 2;
  return m;
}

/**
 * Sand Pierce — a spearwall. It strikes for free at anything crossing its reach
 * inside the half-circle it faces.
 */
export function makeSandSpear(opts: SummonOpts): Mage {
  const m = sandsoldier(unit(opts, 'Sandsoldier-Spear', 20, 10), 2);
  m.intrinsicMoveUnits = 5;
  m.intrinsicMelee = { spec: '1d6', type: 'pierce', damageClass: 'physical' };
  m.intrinsicMeleeReach = R(6);
  m.intrinsicResistTypes = ['pierce', 'malforming', 'shadow'];
  m.opportunityStrike = {
    reach: R(6),
    arcDegrees: 180,
    spec: '1d6',
    type: 'pierce',
    damageClass: 'physical',
  };
  return m;
}

/**
 * Sand Corrode — a rot-mote that rides an ally and poisons everything near it.
 * Its aura is pulsed by GameState on its owner's turn.
 */
export function makeDesertblight(opts: SummonOpts): Mage {
  const m = sandsoldier(unit(opts, 'Desertblight', 1, 1), 0);
  m.intrinsicMoveUnits = 1;
  m.cannotAttack = true;
  m.slowStunImmune = true;
  m.slowStunResist = false;
  m.intrinsicResistTypes = [];
  m.intrinsicWeakTypes = [];
  m.intrinsicDamageAura = {
    radius: R(5),
    damageSpec: '2d3',
    type: 'corrosive',
    damageClass: 'physical',
  };
  return m;
}

/**
 * Heal Pierce — a spectral siege engine. It cannot fire point-blank and needs a
 * round to wind back between shots; every bolt washes healing over nearby allies.
 */
export function makeSpectralBallista(opts: SummonOpts): Mage {
  const m = unit(opts, 'Spectral Ballista', 4, 8);
  m.intrinsicMoveUnits = 3;
  m.intrinsicMelee = { spec: '1d6', type: 'pierce', damageClass: 'physical' };
  m.intrinsicMeleeReach = R(25);
  m.intrinsicMeleeMin = R(15);
  m.attackCooldownRounds = 2;
  m.intrinsicResistTypes = ['light'];
  m.intrinsicWeakTypes = ['shadow', 'cold'];
  return m;
}

/**
 * Heal Corrode — a corpse walked upright. Its body, reach and bite are all
 * inherited from whatever it was raised from.
 */
export function makeRemnant(opts: SummonOpts & { corpse: Mage }): Mage {
  const { corpse } = opts;
  const bonusPierce = Math.ceil(Math.max(0, corpse.statStrength) / 4);
  const m = unit(opts, 'Remnant', 2 + Math.floor(corpse.maxHp / 2), Math.max(1, corpse.maxSanity));
  m.intrinsicMoveUnits = 2 + (corpse.intrinsicMoveUnits ?? 1 + corpse.statDex);
  m.intrinsicMelee = { spec: `${1 + bonusPierce}`, type: 'pierce', damageClass: 'physical' };
  m.intrinsicMeleeReach = MELEE_RANGE;
  m.controlImmune = true;
  m.intrinsicResistTypes = ['pierce', 'cold'];
  m.intrinsicWeakTypes = ['healing', 'light', 'malforming'];
  return m;
}

/**
 * Pierce Corrode — a spike tethered to its caster. It picks its own victim, so
 * it is deliberately left uncommandable.
 */
export function makeSilencingSpike(opts: SummonOpts): Mage {
  const m = unit(opts, 'Silencing Spike', 10, 10);
  m.cannotAttack = false;
  m.intrinsicMoveUnits = 0;
  m.intrinsicMelee = { spec: '1d6', type: 'pierce', damageClass: 'physical' };
  m.intrinsicMeleeReach = R(10);
  m.debuffImmune = true;
  m.displacementImmune = true;
  m.intrinsicResistTypes = ['shadow', 'cold'];
  m.intrinsicWeakTypes = ['light', 'heat', 'water', 'cleansing', 'malforming', 'shatter'];
  return m;
}

/**
 * Sand Heal Pierce — the banner. It heals and hastens the whole conjured host,
 * and buys back any sand-born unit that falls while it stands.
 */
export function makeStandardbearer(opts: SummonOpts): Mage {
  const m = sandsoldier(unit(opts, 'Sandsoldier-Standardbearer', 40, 20), 4);
  m.intrinsicMoveUnits = 10;
  m.cannotAttack = true;
  m.intrinsicResistTypes = ['pierce', 'malforming', 'shadow'];
  return m;
}

/**
 * Sand Heal Corrode — a marker rather than a fighter. Its mark denies healing
 * and rots; whatever dies under it may rise again as a cadett.
 */
export function makeOrzhovSandpriest(opts: SummonOpts): Mage {
  const m = sandsoldier(unit(opts, 'Orzhov-Sandpriest', 20, 25), 0);
  m.intrinsicMoveUnits = 5;
  m.cannotAttack = true;
  m.intrinsicImmuneTypes = ['heat', 'cold'];
  m.intrinsicResistTypes = ['pierce', 'malforming', 'shadow'];
  m.intrinsicWeakTypes = ['shatter', 'light'];
  return m;
}

/** The Orzhov-Sandpriest's harvest: a short-lived swordsman. */
export function makeSandCadett(opts: SummonOpts): Mage {
  const m = sandsoldier(unit(opts, 'Sandsoldier-Cadett', 10, 6), 1);
  m.intrinsicMoveUnits = 5;
  m.intrinsicMelee = { spec: '1d6', type: 'slashing', damageClass: 'physical' };
  m.intrinsicMeleeReach = R(2);
  m.intrinsicResistTypes = ['slashing', 'malforming', 'shadow'];
  m.intrinsicWeakTypes = ['water'];
  m.displacementWeak = true;
  return m;
}

/**
 * Heal Pierce Corrode — a matched pair. The suckling drains what the spitling
 * gives away; both ride whatever they bite.
 */
function parasite(opts: SummonOpts, name: string): Mage {
  const m = unit(opts, name, 25, 10);
  m.intrinsicMoveUnits = 5;
  m.intrinsicMelee = { spec: '5', type: 'pierce', damageClass: 'physical' };
  m.intrinsicMeleeReach = R(1);
  m.controlImmune = true;
  m.intrinsicResistTypes = ['shadow', 'heat'];
  m.intrinsicWeakTypes = ['light', 'malforming', 'cleansing', 'cold'];
  return m;
}

export function makeSuckling(opts: SummonOpts): Mage {
  return parasite(opts, 'Suckling');
}

export function makeSpitling(opts: SummonOpts): Mage {
  return parasite(opts, 'Spitling');
}
