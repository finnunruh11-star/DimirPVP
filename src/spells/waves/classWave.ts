// =============================================================================
//  CLASS-SPELL WAVES · SHARED BUILDERS
// -----------------------------------------------------------------------------
//  Every all-verb (or all-noun) combo of two or three words resolves per
//  calling:
//    Life     : a minion (MINIONS in effects/classKit.ts).
//    Objects  : an imbue on the caster's gear, or a conjured item for the fight.
//    Hexcraft : a law the whole field obeys for a while.
//  The behaviour lives in the class kit as data; a wave file only names, prices
//  and describes it through these builders.
//
//  Crit rule (as in classSpells.ts): Objects variants may crit, doubling their
//  uses; Life and Hexcraft variants never crit.
// =============================================================================

import { RANGE_UNIT } from '../../config/constants';
import { getItem, type ItemId } from '../../core/Items';
import type { Mage } from '../../core/Mage';
import type { WordId } from '../../core/Words';
import { addImbue, HEX_LAW_NAMES, IMBUES, makeMinion, minionDrinks, MINIONS, type HexLawKind, type ImbueDef, type MinionDef, type RuleLawKind } from '../../effects/classKit';
import { RULE_LAWS, type RuleLaw } from '../../effects/ruleLaws';
import { rollDice, type EffectContext } from '../../effects/effects';
import { registerClassSpellVariants, type ClassSpellVariant } from '../registry';
import { attachSummonRider } from '../summonRiders';

export const R = (units: number): number => units * RANGE_UNIT;
/** How long a Hexcraft law holds the field. */
export const LAW_ROUNDS = 8;
const MINION_RANGE = 6;

export interface Priced {
  dc: number;
  color: number;
  /** Rules text after the shared opening sentence. */
  text: string;
  bonus?: boolean;
}

/**
 * Lightning power: the kept d20 plus INT and Luck above 1, doubled by a
 * critical. Every Lightning class spell scales with it.
 */
export function castPower(ctx: EffectContext): number {
  const natural = ctx.spellRoll ?? 1;
  const power =
    natural +
    Math.max(0, ctx.caster.statInt - 1) +
    Math.max(0, ctx.caster.luck - 1) +
    ctx.game.lightningAmplifier(ctx.caster);
  ctx.log(`Lightning power: ${power}${ctx.crit ? ' (doubled)' : ''}.`);
  return power * (ctx.crit ? 2 : 1);
}

/** The Lightning gamble, rolled where everyone sees it: 1 misfires, 6 surges, anything else holds steady. */
export function lightningGamble(ctx: EffectContext): number {
  const roll = rollDice(ctx, '1d6', 'Lightning gamble', ctx.caster);
  ctx.log(`Lightning gamble: ${roll === 1 ? 'misfire' : roll === 6 ? 'surge' : 'steady'}.`);
  return roll;
}

// ---- Life -------------------------------------------------------------------

export function minion(
  kind: string,
  o: Priced & { after?: (ctx: EffectContext, unit: Mage) => void; lightning?: boolean; untamed?: boolean }
): ClassSpellVariant {
  const def = MINIONS[kind];
  return {
    name: def.name,
    actionType: o.bonus ? 'bonus' : 'main',
    range: R(MINION_RANGE),
    targeting: 'point',
    dc: o.dc,
    noCrit: true,
    noCastSprite: true,
    manualCastVisual: true,
    description:
      `Summon a ${def.name} within ${MINION_RANGE}cm. ${o.text} ` +
      (minionDrinks(kind) ? 'Whatever it drains heals it as well as you. ' : '') +
      `HP ${def.hp}, move ${def.move}cm${def.armor ? `, armour ${def.armor}` : ''}. ${o.untamed ? 'It obeys no one.' : 'Obeys Command.'}`,
    visual: { preset: 'conjure', color: o.color, size: 26, speed: 1 },
    cast(ctx) {
      if (!ctx.targetPoint) return;
      const unit = makeMinion(kind, {
        ownerInt: ctx.caster.effectiveInt(),
        dcRoll: rollDice(ctx, '1d20', 'Summon vigor'),
        ownerName: ctx.caster.name,
        pos: ctx.targetPoint,
        team: ctx.caster.team,
      });
      ctx.game.spawnSummon(unit, ctx.caster, kind);
      attachSummonRider(unit, kind);
      if (o.lightning) unit.lightningMindPower = castPower(ctx);
      o.after?.(ctx, unit);
      ctx.log(`${ctx.caster.name} raises ${unit.name} (HP ${unit.hp}).`);
    },
  };
}

// ---- Objects ----------------------------------------------------------------

export function imbue(
  id: string,
  o: Priced & { ally?: boolean; foe?: boolean; uses?: (ctx: EffectContext) => number; lightning?: boolean }
): ClassSpellVariant {
  const def = IMBUES[id];
  def.text = o.text;
  const gear = def.slot === 'weapon' ? 'weapon' : def.slot === 'armour' ? 'armour' : 'trinket';
  return {
    name: def.name,
    actionType: o.bonus ? 'bonus' : 'main',
    range: o.ally ? R(8) : o.foe ? R(10) : 0,
    targeting: o.ally ? 'any' : o.foe ? 'enemy' : 'self',
    dc: o.dc,
    noCastSprite: true,
    description: o.ally
      ? `Enchant the ${gear} of yourself or a unit within 8cm. ${o.text}`
      : o.foe
        ? `Bind the ${gear} of one enemy within 10cm. ${o.text}`
        : `Enchant your ${gear}. ${o.text}`,
    visual: { preset: 'conjure', color: o.color, size: 24, speed: 1 },
    cast(ctx) {
      const bearer = ctx.target ?? ctx.caster;
      const laid = o.uses
        ? addImbue(ctx.game, ctx.caster, bearer, id, 1, Math.max(1, o.uses(ctx)))
        : addImbue(ctx.game, ctx.caster, bearer, id, ctx.crit ? 2 : 1);
      if (o.lightning) laid.power = castPower(ctx);
    },
  };
}

export function conjure(id: ItemId, o: Priced & { count?: number }): ClassSpellVariant {
  const item = getItem(id);
  return {
    name: item.name,
    actionType: o.bonus ? 'bonus' : 'main',
    range: 0,
    targeting: 'self',
    dc: o.dc,
    noCastSprite: true,
    description: o.text,
    visual: { preset: 'conjure', color: o.color, size: 28, speed: 1 },
    cast(ctx) {
      const caster = ctx.caster;
      if (item.slot === 'utility') {
        const count = (o.count ?? 1) * (ctx.crit ? 2 : 1);
        for (let i = 0; i < count; i++) caster.utility.push(id);
        ctx.log(`${caster.name} conjures ${count} × ${item.name}.`);
        return;
      }
      caster.conjureInHand(id);
      ctx.log(
        caster.hands.includes(id)
          ? `${caster.name} conjures ${item.name}.`
          : `${caster.name}'s hands are bound; ${item.name} crumbles.`
      );
    },
  };
}

/** Rules text shared by every conjured hand item. */
export const HELD = 'Other non-wand hand items go to your bag and return when it fades.';

// ---- Hexcraft ---------------------------------------------------------------

export function law(
  kind: HexLawKind,
  o: Priced & { lightning?: boolean; after?: (ctx: EffectContext) => void }
): ClassSpellVariant {
  return {
    name: HEX_LAW_NAMES[kind],
    actionType: o.bonus ? 'bonus' : 'main',
    range: 0,
    targeting: 'self',
    dc: o.dc,
    noCrit: true,
    description: `For ${LAW_ROUNDS} rounds, on the whole field: ${o.text}`,
    visual: { preset: 'nova', color: o.color, size: 110, speed: 0.8 },
    cast(ctx) {
      ctx.game.addHexcraftGlobal(kind, ctx.caster.team, LAW_ROUNDS, ctx.caster);
      const laid = o.lightning ? ctx.game.hexLaw(kind) : undefined;
      if (laid) laid.power = castPower(ctx);
      o.after?.(ctx);
    },
  };
}

export function variants(
  words: WordId[],
  life: ClassSpellVariant,
  objects: ClassSpellVariant,
  hexcraft: ClassSpellVariant
): void {
  registerClassSpellVariants({ words, variants: { life, objects, hexcraft } });
}

// ---- Data registered with its spell -------------------------------------------

/** A minion defined right beside its spell. */
export function raise(
  kind: string,
  def: MinionDef,
  o: Priced & { after?: (ctx: EffectContext, unit: Mage) => void }
): ClassSpellVariant {
  MINIONS[kind] = def;
  return minion(kind, o);
}

/** Gear defined right beside its spell. */
export function gear(id: string, def: ImbueDef, o: Priced): ClassSpellVariant {
  IMBUES[id] = def;
  return imbue(id, o);
}

/** A data law (effects/ruleLaws.ts) defined right beside its spell. */
export function rule(id: string, def: RuleLaw, o: Priced): ClassSpellVariant {
  const kind: RuleLawKind = `rule:${id}`;
  RULE_LAWS[kind] = def;
  HEX_LAW_NAMES[kind] = def.name;
  return law(kind, o);
}

// ---- Shared wording -----------------------------------------------------------

/** Rules text for a stacking rot. */
export const rotText = (name: string, spec: string, max: number, turns: number, type = 'corrosive'): string =>
  `a stack of ${name} (${spec} ${type} per stack at the start of its turns, up to ${max} stacks, ${turns} turns)`;
export const TURN = 'is turned a quarter circle around';
export const SLAM = 'stopped by a wall or the field edge';
export const AFFECTED = 'affected units (Desecrate spares black units and minions)';
/** A stifle: the next declared action fails before it begins. */
export const STIFLE = 'the next action the target declares other than moving fails';
export const STIFLE_ITS = 'its next action other than moving fails';
/** A shroud minion: its side near it cannot be singled out, but area effects find them. */
export const SHROUD = (cm: number): string =>
  `Your side within ${cm}cm of it (not the minion itself) cannot be targeted by enemy single-target attacks, spells ` +
  'or effects; area effects still hit them.';
/** Hit and run. */
export const DASH_AWAY = (cm: number): string => `dashes ${cm}cm straight away from the target`;

// ---- Objects: robes ------------------------------------------------------------

/** A robe (Objects Veil, two words): a weaker spell as a bonus action that works half the time. */
export function robe(id: string, o: Priced): ClassSpellVariant {
  const def = IMBUES[id];
  return imbue(id, {
    ...o,
    ally: true,
    text:
      `It becomes a robe with ${def.charges} uses. Bonus action, works 50% of the time (a failed try still spends a use): ` +
      `${def.robe!.text}${o.text ? ` ${o.text}` : ''}`,
  });
}
