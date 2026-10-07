// =============================================================================
//  LIGHTNING WAVE · CLASS SPELLS
// -----------------------------------------------------------------------------
//  Life / Objects / Hexcraft versions of the all-noun Lightning combos not yet
//  covered (Mind, Water and Shadow brought the others). Lightning is red and
//  gambles: on the cast roll (Life and Hexcraft never crit, so a natural 18 or
//  more is their high roll), on dice of its own, and on whoever stands near.
//  With Pain beside it nothing contains it; with blue words it keeps off your side.
// =============================================================================

import { conjure, HELD, imbue, law, minion, variants } from './classWave';

const SPARK = 0xffb347;
const WIRE = 0xc85ad8;
const HELL = 0xe0503c;

variants(
  ['lightning', 'fire'],
  minion('ball-lightning', {
    dc: 11,
    lightning: true,
    color: SPARK,
    text:
      'It cannot attack and is immune to heat. At the start of your turns it runs on its own to the nearest enemy, ' +
      'however far, and bursts: every unit within 2cm of it, allies included but never you, takes 1d10 heat plus 1 ' +
      'per 6 Lightning power and gains 1 Fire. Summoned on a natural 18 or more, its bursts reach 4cm.',
    after: (ctx, unit) => {
      unit.lightningSurge = (ctx.spellRoll ?? 0) >= 18;
      if (unit.lightningSurge) ctx.log(`${unit.name} crackles: its bursts will reach twice as far.`);
    },
  }),
  conjure('conjuredArcBrand', {
    dc: 11,
    color: SPARK,
    text:
      `Conjure an Arc Brand into your hand until the fight ends. ${HELD} Dexterity heat. On hit it rolls 1d6. ` +
      'On a 1 the charge grounds through you: you take 1d6 heat. On 2\u20135 the target gains 1 Fire and lightning ' +
      'arcs to the nearest other unit within 3cm of it, friend or foe but never you: 1d6 heat. On a 6 the target ' +
      'gains 2 Fire, the arc still leaps, and you dash 2cm away.',
  }),
  law('dryLightning', {
    dc: 12,
    lightning: true,
    color: SPARK,
    text:
      'every heat hit rolls 1d6. On a 5 or 6 lightning leaps from its victim to the nearest other unit within a ' +
      'third of the Lightning power in cm (at least 2cm), friend or foe, for the same heat. On a 1 the heat leaps ' +
      'back into whoever dealt it instead.',
  })
);

variants(
  ['lightning', 'pain'],
  minion('live-wire', {
    dc: 12,
    lightning: true,
    color: WIRE,
    text:
      'It cannot attack. At the start of your turns it rolls 1d6. On 2\u20135 it lashes a random unit within half the ' +
      "Lightning power in cm (at least 2cm), friend or foe but never you: 1d6 sanity and 1d4 heat, each plus 1 per 6 " +
      "Lightning power, then leaps to that unit's side. On a 1 it lashes you instead, wherever you are. On a 6 it " +
      'lashes every unit there but you.',
  }),
  imbue('agonyCapacitor', {
    dc: 12,
    ally: true,
    lightning: true,
    color: WIRE,
    text:
      'For the rest of the fight, every hit the bearer takes charges it with the damage dealt, up to the Lightning ' +
      "power. At the start of the bearer's turns the whole charge discharges on 1d6: on a 1 into the bearer as " +
      'sanity; on 2\u20135 into a random unit within 4cm, friend or foe but never the bearer, as heat and again as ' +
      'sanity; on a 6 into every unit within 4cm but the bearer, the same.',
  }),
  law('stormOfAgony', {
    dc: 13,
    lightning: true,
    color: WIRE,
    text:
      'at the end of each round, every unit rolls 1d6. On a 1 lightning strikes it: 1d6 heat and 1d6 sanity, each ' +
      'plus 1 per 6 Lightning power. On a 6 lightning leaps from it into the nearest other unit within half the ' +
      'Lightning power in cm (at least 3cm), friend or foe, for the same.',
  })
);

variants(
  ['lightning', 'fire', 'pain'],
  minion('hellspark', {
    dc: 13,
    lightning: true,
    color: HELL,
    text:
      'It cannot attack and is immune to heat. At the start of your turns it rolls 1d3 and zips that many times, ' +
      '1d6cm each, roughly toward the nearest enemy. After every zip it flares: every unit within 2cm of it, you and ' +
      'your allies included, takes 1d4 heat and 1d4 sanity, each plus 1 per 6 Lightning power, and gains 1 Fire.',
  }),
  imbue('thunderingMantle', {
    dc: 13,
    ally: true,
    lightning: true,
    color: HELL,
    text:
      'For the rest of the fight, whatever damage the bearer takes, even from itself or over time, also strikes ' +
      'every other unit within a quarter of the Lightning power in cm of it (at least 2cm), friend or foe: half of ' +
      'it as heat, a quarter as sanity and a quarter as Fire stacks, rounded down. Every hit on the bearer that is ' +
      'not damage over time also rolls 1d3: on a 3 nothing more; on a 2 the bearer takes 1 heat; on a 1 lightning ' +
      'arcs from it into the nearest other unit, friend or foe: 1d3 sanity.',
  }),
  law('burningFrenzy', {
    dc: 13,
    color: HELL,
    text:
      'every Fire tick or blast also deals half its damage as sanity, rounded up, and whenever a unit loses sanity ' +
      'it flares: every other unit within 1d6cm of it, friend or foe, gains 1 Fire.',
  })
);
