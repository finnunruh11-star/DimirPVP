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
//  WHITE COLOR ABILITIES  (unlocked by a white primary — e.g. Order + none-words)
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

const deathRealm: ColorAbility = {
  id: 'ability:death-realm',
  name: 'Death Realm',
  color: 'white',
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

export const COLOR_ABILITIES: ColorAbility[] = [
  bane,
  necrosis,
  rejuvenate,
  wall,
  whiteBane,
  deathRealm,
];

/** The two color abilities granted by a given primary color. */
export function getColorAbilitiesFor(color: ColorName | null): ColorAbility[] {
  if (!color) return [];
  return COLOR_ABILITIES.filter((a) => a.color === color);
}
