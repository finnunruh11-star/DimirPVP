// =============================================================================
//  MIND WAVE · CLASS SPELLS
// -----------------------------------------------------------------------------
//  Life / Objects / Hexcraft versions of every legal all-noun Mind combo
//  (builders in classWave.ts). Reality only joins blue words, and red, black
//  and blue never meet in one spell, so Mind has five: Reality, Fire,
//  Lightning and Shadow Mind, plus Lightning Mind Fire (whose Objects version
//  lives in classSpells.ts).
//  Mind is blue and spoils minds: sanity, burning thoughts (Blueflare),
//  conducting stacks (Mindconduct), figments, swapped minds and nightmares.
//  Fire and Lightning add red damage and risk; Lightning always scales with the
//  roll. Shadow amplifies and breaks minds.
// =============================================================================

import { critScale, swapMinds } from '../../effects/effects';
import type { ClassSpellVariant } from '../registry';
import { registerClassSpellVariants } from '../registry';
import { castPower, imbue, law, minion, R, variants } from './classWave';

const BOLT = 'gains 1 Mindconduct stack, then takes';
const SCALED = '50% more for every stack after the first';

/** Reality Mind · Hexcraft: trade control of minds with an enemy. */
const SWAP_MINDS: ClassSpellVariant = {
  name: 'Reality Mind',
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 14,
  noCrit: true,
  description: 'Swap control with one enemy within 20cm for 2 turns: you control its mage and it controls yours.',
  visual: { preset: 'beam', color: 0xff5599, size: 7, speed: 1 },
  cast(ctx) {
    if (ctx.target) swapMinds(ctx, ctx.target, 2);
  },
};

/** Fire Mind · Objects: a weapon that sets thoughts alight. */
const FIRE_MIND_EDGE: ClassSpellVariant = {
  name: 'Fire Mind',
  actionType: 'main',
  range: R(10),
  targeting: 'any',
  dc: 11,
  noCastSprite: true,
  description: "Enchant the active weapon of yourself or a unit within 10cm: every landed hit applies 1 Blueflare.",
  visual: { preset: 'conjure', color: 0x56bfff, size: 38, speed: 1.3 },
  cast(ctx) {
    const target = ctx.target ?? ctx.caster;
    const weaponId = target.activeWeaponId();
    if (!weaponId) {
      ctx.log(`${target.name} has no active weapon to enchant.`);
      return;
    }
    target.weaponEnchant = 'fireMind';
    target.enchantedWeapon = weaponId;
    ctx.log(`${target.name}'s weapon begins burning with thought-fire.`);
  },
};

/** Lightning Mind · Objects: a weapon charged with conducting bolts. */
const LIGHTNING_MIND_EDGE: ClassSpellVariant = {
  name: 'Lightning Mind',
  actionType: 'main',
  range: 0,
  targeting: 'self',
  dc: 11,
  noCastSprite: true,
  description:
    'Enchant your active weapon for 1 hit per 6 Lightning power (at least 1). Each hit gives its enemy 1 Mindconduct ' +
    'stack, then a bolt within a third of the Lightning power in cm strikes you or a marked enemy, likelier the more ' +
    'stacks it carries, for 1d3 sanity, 50% more for every stack after the first.',
  visual: { preset: 'conjure', color: 0x79bfff, size: 46, speed: 1.7 },
  cast(ctx) {
    const target = ctx.target ?? ctx.caster;
    const weaponId = target.activeWeaponId();
    if (!weaponId) {
      ctx.log(`${target.name} has no active weapon to enchant.`);
      return;
    }
    const effectivePower = castPower(ctx);
    const power = ctx.crit ? effectivePower / 2 : effectivePower;
    target.weaponEnchant = 'lightningMind';
    target.enchantedWeapon = weaponId;
    target.lightningMindPower = power;
    target.lightningMindCritical = !!ctx.crit;
    // A critical doubled the power and doubles the reach again on top.
    target.lightningMindRange = R(Math.max(1, Math.ceil(effectivePower / 3))) * (ctx.crit ? 2 : 1);
    target.lightningMindCharges = critScale(ctx, Math.max(1, Math.ceil(effectivePower / 6)));
    ctx.log(
      `${target.name}'s weapon holds ${target.lightningMindCharges} ${power}-power Mind Lightning charge${target.lightningMindCharges === 1 ? '' : 's'}.`
    );
  },
};

// =============================================================================
//  TWO WORDS
// =============================================================================

variants(
  ['reality', 'mind'],
  minion('figment', {
    dc: 12,
    color: 0xff5599,
    text:
      'It cannot attack. While it lives, every enemy single-target spell or basic attack aimed at you has a 50% ' +
      'chance to strike it instead. Every hit that lands on it sends a shock through the minds around it: every ' +
      'enemy within 3cm of it takes 1d4 sanity.',
  }),
  imbue('mirroredMind', {
    dc: 12,
    ally: true,
    color: 0xff5599,
    text: 'The next 2 single-target spells an enemy aims at the bearer turn back: each is cast at its own caster instead.',
  }),
  SWAP_MINDS
);

variants(
  ['fire', 'mind'],
  minion('candlewight', {
    dc: 11,
    color: 0x56bfff,
    text:
      'It cannot attack and is immune to heat. At the start of your turns, every enemy within 3cm of it gains 1 ' +
      'Blueflare. When it is destroyed, every enemy within 6cm takes its Blueflare pulse at once.',
  }),
  FIRE_MIND_EDGE,
  law('burningFocus', {
    dc: 12,
    color: 0x56bfff,
    text: 'a unit that casts a spell gains 1 Blueflare for every word in it.',
  })
);

variants(
  ['lightning', 'mind'],
  minion('synapse', {
    dc: 12,
    lightning: true,
    color: 0x79bfff,
    text:
      'It cannot attack. At the start of your turns it fires 1 bolt per 8 Lightning power (at least 1) into the minds ' +
      'within half the Lightning power in cm. Each bolt strikes an enemy there or the Synapse itself, likelier the ' +
      `more Mindconduct stacks an enemy carries: it ${BOLT} 1d3 sanity, ${SCALED}.`,
  }),
  LIGHTNING_MIND_EDGE,
  law('neuralStorm', {
    dc: 12,
    lightning: true,
    color: 0x79bfff,
    text:
      'every sanity hit gives its victim 1 Mindconduct stack. At the end of each round, lightning strikes the unit with ' +
      `the most stacks for 1d3 sanity plus 1 per 6 Lightning power, ${SCALED}, then halves its stacks.`,
  })
);

variants(
  ['mind', 'shadow'],
  minion('mare', {
    dc: 12,
    color: 0x9b7bff,
    text:
      'It is immune to shadow. Its bite deals 1d4 sanity and leaves a nightmare: 1d3 sanity at the start of the target\'s turns for 3 turns. ' +
      'A mind it leaves at 4 sanity or less breaks: the unit dies.',
  }),
  imbue('dreamreaver', {
    dc: 12,
    color: 0x9b7bff,
    text:
      'For the rest of the fight, your landed basic attacks also deal 1d4 sanity. Against a target already carrying a ' +
      'damage over time they deal 2d4 sanity instead, and each of its damage-over-time effects lasts 1 turn longer.',
  }),
  law('nightTerrors', {
    dc: 13,
    color: 0x9b7bff,
    text:
      'a unit at half its sanity or less takes 1d4 sanity at the start of each of its turns and forgets a random word ' +
      'until its next turn. Sanity damage to a unit standing in a shadow is doubled.',
  })
);

// =============================================================================
//  THREE WORDS
// =============================================================================

registerClassSpellVariants({
  words: ['lightning', 'mind', 'fire'],
  variants: {
    life: minion('stormmind-wisp', {
      dc: 14,
      lightning: true,
      color: 0x6caeff,
      text:
        'It cannot attack. At the start of your turns it rolls 1d6. On a 1 it overloads and detonates. Otherwise it ' +
        'arcs to 1 unit per 5 Lightning power (at least 1) within half the Lightning power in cm of it (at least 4cm), ' +
        'enemies first, then anyone: each takes 1d6 heat and 1d4 sanity, each plus 1 per 6 Lightning power, and gains ' +
        '1 Fire and 1 Blueflare. On a 6 every arc strikes twice. Whenever it dies it detonates: every unit within 4cm ' +
        'of it, you included, takes 4d6 heat and gains 3 Fire and 3 Blueflare.',
    }),
    hexcraft: law('brainstorm', {
      dc: 14,
      lightning: true,
      color: 0x6caeff,
      text:
        'at the start of each of your turns, lightning strikes the unit other than you carrying the most Fire and ' +
        'Blueflare combined, friend or foe, then forks to 1 more unit per 8 Lightning power, the next most burning ' +
        'first. Each strike deals 1d6 heat and 1d6 sanity, each plus 1 per 5 Lightning power, then sets off the ' +
        "unit's Fire and Blueflare at once. With nobody burning, it strikes the nearest enemy instead and sets 2 Fire " +
        'and 2 Blueflare on it.',
    }),
  },
});
