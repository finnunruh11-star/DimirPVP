// =============================================================================
//  COLOR ABILITIES
// -----------------------------------------------------------------------------
//  Bonus-action powers unlocked by your *primary* color. Unlike word-spells they
//  never roll a DC (they always resolve) and are paid for with color-charges +
//  mana rather than per-word charges. They reuse the Spell shape so they flow
//  through the existing stack / targeting / visual machinery, but are kept out
//  of the word-combo registry (their `words` list is empty).
//
//  Black-secondary tier makes every color ability you cast 50% more potent, at
//  the cost of 5% of your max HP (min 1) — applied here in each cast.
// =============================================================================

import type { Spell } from './Spell';
import type { ColorName } from '../core/Colors';
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
}

/** "marked" never expires — a huge duration that outlasts any duel. */
const MARKED_DURATION = 9999;

/** Black-secondary tier amplifies color abilities by half. */
function potencyOf(ctx: EffectContext): number {
  return ctx.caster.profile.blackSecondaryTier ? 1.5 : 1;
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
    dealDamage(ctx, ctx.caster, dmg(amount, 'shadow', 'physical'), { canMiss: false, aoe: true });
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
  // Targets any player; with no allies yet, this resolves on the caster.
  targeting: 'self',
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

export const COLOR_ABILITIES: ColorAbility[] = [bane, necrosis, rejuvenate, wall];

/** The two color abilities granted by a given primary color. */
export function getColorAbilitiesFor(color: ColorName | null): ColorAbility[] {
  if (!color) return [];
  return COLOR_ABILITIES.filter((a) => a.color === color);
}
