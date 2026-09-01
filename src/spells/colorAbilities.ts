// =============================================================================
//  COLOR ABILITIES
// -----------------------------------------------------------------------------
//  Bonus-action powers unlocked by your *primary* color. Unlike word-spells they
//  never roll a DC (they always resolve) and are paid for with color-charges +
//  mana rather than per-word charges. They reuse the Spell shape so they flow
//  through the existing stack / targeting / visual machinery, but are kept out
//  of the word-combo registry (their `words` list is empty).
//
//  Black-secondary tier makes every color ability you cast 25% more potent, at
//  the cost of 5% of your max HP (min 1) — applied here in each cast.
// =============================================================================

import type { Spell } from './Spell';
import type { ColorName } from '../core/Colors';
import type { MageClass } from '../core/Classes';
import { DEFAULT_MAGE_CLASS } from '../core/Classes';
import type { EffectContext } from '../effects/effects';
import { applyDebuff, dealDamage, placeWall, rollDice } from '../effects/effects';
import { dmg } from '../core/Damage';
import { MARKED_DAMAGE, RANGE_UNIT } from '../config/constants';

export interface ColorAbility extends Spell {
  color: ColorName;
  /** Color-charges spent to cast (before blue-secondary discount). */
  chargeCost: number;
  /** Mana spent to cast. */
  manaCost: number;
  /** Costs no bonus action, so it can be cast alongside a normal bonus action. */
  freeAction?: boolean;
}

/** "marked" never expires — a huge duration that outlasts any duel. */
const MARKED_DURATION = 9999;

/** Black-secondary tier amplifies color abilities by a quarter. */
function potencyOf(ctx: EffectContext): number {
  return ctx.caster.profile.blackSecondaryTier ? 1.25 : 1;
}

/** Black-secondary tier: pay 5% of max HP (min 1) to fuel the empowered magic. */
function payBlackSecondaryLife(ctx: EffectContext): void {
  if (!ctx.caster.profile.blackSecondaryTier) return;
  const cost = Math.max(1, Math.floor(ctx.caster.maxHp * 0.05));
  ctx.caster.hp = Math.max(0, ctx.caster.hp - cost);
  ctx.log(`${ctx.caster.name} burns ${cost} life to empower the color magic.`);
}

const R = (units: number): number => units * RANGE_UNIT;

const bane: ColorAbility = {
  id: 'ability:bane',
  name: 'Bane',
  color: 'black',
  words: [],
  actionType: 'bonus',
  range: R(15),
  targeting: 'enemy',
  chargeCost: 3,
  manaCost: 4,
  description:
    'You and the target take 1d3 shadow; the target is marked (+1 damage taken, permanently).',
  visual: { preset: 'beam', color: 0x8a6bff, size: 5 },
  cast(ctx) {
    const p = potencyOf(ctx);
    const amount = Math.round(rollDice(ctx, '1d3', 'Bane') * p);
    if (ctx.target) {
      dealDamage(ctx, ctx.target, dmg(amount, 'shadow', 'physical'), { canMiss: false });
      applyDebuff(ctx, ctx.target, {
        name: 'Marked',
        key: 'debuff:marked',
        duration: MARKED_DURATION,
        mods: { damageTaken: MARKED_DAMAGE },
      });
    }
    // White-secondary casters replace the caster-side backlash with the healing
    // pulse applied centrally after resolution (see GameState.resolve); other
    // casters take the shadow recoil as normal.
    if (!ctx.caster.profile.whiteSecondaryTier) {
      dealDamage(ctx, ctx.caster, dmg(amount, 'shadow', 'physical'), { canMiss: false, aoe: true });
    }
    payBlackSecondaryLife(ctx);
  },
};

const necrosis: ColorAbility = {
  id: 'ability:necrosis',
  name: 'Necrosis',
  color: 'black',
  words: [],
  actionType: 'bonus',
  range: 0,
  targeting: 'none',
  chargeCost: 9,
  manaCost: 8,
  description:
    'A spreading doom: over the next 3 rounds everyone takes 1d3, then 3d3, then 2d10 dark damage.',
  visual: { preset: 'nova', color: 0x6a3aff, size: 44 },
  cast(ctx) {
    ctx.game.addGlobalEscalation({
      name: 'Necrosis',
      stages: ['1d3', '3d3', '2d10'],
      type: 'shadow',
      damageClass: 'physical',
      potency: potencyOf(ctx),
    });
    payBlackSecondaryLife(ctx);
  },
};

const rejuvenate: ColorAbility = {
  id: 'ability:rejuvenate',
  name: 'Rejuvenate',
  color: 'blue',
  words: [],
  actionType: 'bonus',
  range: R(15),
  // Target any mage in range (ally, self, or another); defaults to the caster.
  targeting: 'any',
  chargeCost: 3,
  manaCost: 2,
  description: 'Restore 3 + (mana spent on this) mana to the target.',
  visual: { preset: 'nova', color: 0x6ad1ff, size: 28 },
  cast(ctx) {
    const target = ctx.target ?? ctx.caster;
    const restored = 3 + Math.max(0, ctx.caster.lastAbilityManaPaid);
    target.gainMana(restored);
    ctx.log(`${target.name} is rejuvenated (+${restored} mana).`);
    payBlackSecondaryLife(ctx);
  },
};

const wall: ColorAbility = {
  id: 'ability:wall',
  name: 'Wall',
  color: 'blue',
  words: [],
  actionType: 'bonus',
  range: R(5),
  targeting: 'point',
  rotatableWall: { length: 360, thickness: 20 },
  chargeCost: 4,
  manaCost: 3,
  description:
    'Raise a thin wall blocking movement for 2d3 rounds. Place it anywhere within range 5 and press H while aiming to rotate it (longer with black potency).',
  visual: { preset: 'beam', color: 0x6ad1ff, size: 6 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const wider = ctx.caster.profile.blackSecondaryTier;
    const ttl = rollDice(ctx, '2d3', 'Wall duration');
    placeWall(ctx, ctx.targetPoint, {
      angle: ctx.caster.wallAngle,
      length: wider ? 540 : 360,
      thickness: 20,
      ttl,
    });
    payBlackSecondaryLife(ctx);
  },
};

// ---------------------------------------------------------------------------
//  WHITE COLOR ABILITIES  (unlocked by a white primary)
// ---------------------------------------------------------------------------

const whiteBane: ColorAbility = {
  id: 'ability:white-bane',
  name: 'Bane',
  color: 'white',
  words: [],
  actionType: 'bonus',
  range: R(20),
  targeting: 'enemy',
  chargeCost: 4,
  manaCost: 5,
  description:
    'Mark a target within range 20 with bane (+1 damage taken from every source; does not stack). ' +
    'You and the target take 1d3 darkness — or 3d3 if the target was already baned.',
  visual: { preset: 'beam', color: 0xf3ecd2, size: 6 },
  cast(ctx) {
    if (!ctx.target) return;
    const already = ctx.target.statuses.some((s) => s.key === 'debuff:marked');
    const amount = rollDice(ctx, already ? '3d3' : '1d3', 'Bane');
    dealDamage(ctx, ctx.target, dmg(amount, 'shadow', 'physical'), { canMiss: false });
    dealDamage(ctx, ctx.caster, dmg(amount, 'shadow', 'physical'), { canMiss: false, aoe: true });
    // Non-stacking mark (shares the "Marked" key, so re-baning never stacks).
    applyDebuff(ctx, ctx.target, {
      name: 'Marked',
      key: 'debuff:marked',
      duration: MARKED_DURATION,
      mods: { damageTaken: MARKED_DAMAGE },
    });
  },
};

const theOrderIsGiven: ColorAbility = {
  id: 'ability:the-order-is-given',
  name: 'THE ORDER IS GIVEN!!!',
  color: 'white',
  words: [],
  actionType: 'bonus',
  freeAction: true,
  range: 0,
  targeting: 'none',
  chargeCost: 8,
  manaCost: 0,
  description: 'Costs no bonus action. Commanding your summons is free for the rest of this turn.',
  visual: { preset: 'nova', color: 0xf3ecd2, size: 40 },
  cast(ctx) {
    ctx.caster.freeSummonOrders = true;
    ctx.log(`${ctx.caster.name} gives the order — their summons obey freely this turn.`);
  },
};

// ---------------------------------------------------------------------------
//  Retagged black; no colour/class slot currently grants it.
// ---------------------------------------------------------------------------

const deathRealm: ColorAbility = {
  id: 'ability:death-realm',
  name: 'Death Realm',
  color: 'black',
  words: [],
  actionType: 'bonus',
  range: 0,
  targeting: 'none',
  chargeCost: 8,
  manaCost: 5,
  description:
    'Open the Hunger of Hadar over the battlefield for 2 turns: every living creature takes 1d3 ' +
    'cold and 1d3 darkness at the start of each turn. (Its heal-inversion and slow are simplified.)',
  visual: { preset: 'nova', color: 0x5a4a8a, size: 52 },
  cast(ctx) {
    // The full realm (heals become true damage, all speeds halved, on-death
    // true-damage picks) is not modelled; the recurring aura is captured as two
    // global escalations that tick 1d3 each over the next 2 rounds.
    ctx.game.addGlobalEscalation({
      name: 'Hunger of Hadar (cold)',
      stages: ['1d3', '1d3'],
      type: 'shatter',
      damageClass: 'physical',
      potency: 1,
    });
    ctx.game.addGlobalEscalation({
      name: 'Hunger of Hadar (dark)',
      stages: ['1d3', '1d3'],
      type: 'shadow',
      damageClass: 'physical',
      potency: 1,
    });
  },
};

// ---------------------------------------------------------------------------
//  RED COLOR ABILITIES
// ---------------------------------------------------------------------------

const lightningBolt: ColorAbility = {
  id: 'ability:lightning-bolt',
  name: 'Lightning Bolt',
  color: 'red',
  words: [],
  actionType: 'bonus',
  range: R(15),
  targeting: 'enemy',
  chargeCost: 6,
  manaCost: 7,
  description:
    'Deal 2d6 typeless magical damage that ignores armour, resistance, and immunity. If the dice total is below 6, roll one additional d6.',
  visual: { preset: 'beam', color: 0xff3b24, size: 8 },
  cast(ctx) {
    if (!ctx.target) return;
    let amount = rollDice(ctx, '2d6', 'Lightning Bolt');
    if (amount < 6) amount += rollDice(ctx, '1d6', 'Lightning Bolt surge');
    dealDamage(ctx, ctx.target, dmg(amount, 'typeless', 'physical'), {
      canMiss: false,
      trueDamage: true,
    });
  },
};

const redOrb: ColorAbility = {
  id: 'ability:red-orb',
  name: 'Static Orb',
  color: 'red',
  words: [],
  actionType: 'bonus',
  range: R(10),
  targeting: 'point',
  chargeCost: 8,
  manaCost: 5,
  description:
    'Create a permanent range-3 slowing orb. Any entity that moves inside it is zapped for 1d3 typeless damage.',
  visual: { preset: 'conjure', color: 0xff5a36, size: 48 },
  cast(ctx) {
    if (ctx.targetPoint) ctx.game.addRedOrb(ctx.targetPoint, ctx.caster);
  },
};

const redGenerator: ColorAbility = {
  id: 'ability:red-generator',
  name: 'Generator',
  color: 'red',
  words: [],
  actionType: 'bonus',
  range: 0,
  targeting: 'self',
  chargeCost: 8,
  manaCost: 5,
  description: 'Gain one additional color charge at the start of every turn until combat ends.',
  visual: { preset: 'conjure', color: 0xffd447, size: 44 },
  cast(ctx) {
    ctx.caster.redGenerator = true;
    ctx.log(`${ctx.caster.name} anchors a permanent red generator.`);
  },
};

const redSummonHaste: ColorAbility = {
  id: 'ability:red-summon-haste',
  name: 'Overdrive Host',
  color: 'red',
  words: [],
  actionType: 'bonus',
  range: 0,
  targeting: 'self',
  chargeCost: 8,
  manaCost: 5,
  description: 'All of your existing and future summons gain double movement until combat ends.',
  visual: { preset: 'nova', color: 0xff7040, size: 54 },
  cast(ctx) {
    ctx.caster.redSummonHaste = true;
    for (const summon of ctx.game.summonsOf(ctx.caster)) summon.summonMoveMultiplier = 2;
    ctx.log(`${ctx.caster.name} drives every summon into red overdrive.`);
  },
};

export const COLOR_ABILITIES: ColorAbility[] = [
  bane,
  necrosis,
  rejuvenate,
  wall,
  whiteBane,
  theOrderIsGiven,
  deathRealm,
  lightningBolt,
  redOrb,
  redGenerator,
  redSummonHaste,
];

/**
 * Each colour grants a fixed FIRST ability plus a SECOND ability chosen by the
 * caster's class. The primary colour still decides the pair; the class swaps out
 * the second slot only (e.g. blue Objects → Wall, blue Hexcraft → a portal, blue
 * Life → a summon-warding aura).
 *
 * The class-specific variants are not authored yet, so every class currently
 * points at the colour's original second ability. When the new spells land, drop
 * them into the matching {@link MageClass} slot below — no caller changes needed.
 */
interface ColorAbilitySet {
  first: ColorAbility;
  second: Record<MageClass, ColorAbility>;
}

const ABILITIES_BY_COLOR: Record<ColorName, ColorAbilitySet> = {
  blue: {
    first: rejuvenate,
    second: { objects: wall, life: wall, hexcraft: wall },
  },
  black: {
    first: bane,
    second: { objects: necrosis, life: necrosis, hexcraft: necrosis },
  },
  white: {
    first: whiteBane,
    second: { objects: theOrderIsGiven, life: theOrderIsGiven, hexcraft: theOrderIsGiven },
  },
  red: {
    first: lightningBolt,
    second: { objects: redOrb, life: redSummonHaste, hexcraft: redGenerator },
  },
};

/**
 * The two colour abilities granted by a primary colour, for a given class. The
 * first is fixed; the second depends on the class (see {@link ABILITIES_BY_COLOR}).
 */
export function getColorAbilitiesFor(
  color: ColorName | null,
  mageClass: MageClass = DEFAULT_MAGE_CLASS
): ColorAbility[] {
  if (!color) return [];
  const set = ABILITIES_BY_COLOR[color];
  return [set.first, set.second[mageClass]];
}
