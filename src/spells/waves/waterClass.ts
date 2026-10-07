// =============================================================================
//  WATER WAVE · CLASS SPELLS
// -----------------------------------------------------------------------------
//  Life / Objects / Hexcraft versions of every legal all-noun Water combo
//  (builders in classWave.ts, behaviour in effects/classKit.ts). Water is blue:
//  water damage and forced movement, so its minions lure, sweep and swap, its
//  gear pushes and drags, and its laws make the whole field flow. Reality and
//  Mind keep it blue (control), Fire and Lightning add red damage (Lightning
//  always scales with the roll), Shadow and Pain add black dread. Red, black
//  and blue never meet, so Water has thirteen combos.
// =============================================================================

import { FIELD } from '../../config/constants';
import { dist } from '../../core/utils';
import { tideAnchors } from '../../effects/classKit';
import { placeShadow, type EffectContext } from '../../effects/effects';
import { castPower, imbue, law, LAW_ROUNDS, minion, robe, variants } from './classWave';

const WATER = 0x4f9be8;
const DARK_WATER = 0x3a5a8c;
const TIDE = 0x7fc4ff;
const STEAM = 0xd9e8f2;
const STORM = 0x9fc8ff;
const PAIN = 0xd1475c;
const DEEP = 0x5b5fb0;
const THOUGHT = 0x56bfff;

const BOLT = 'gains 1 Mindconduct stack, then takes';
const SCALED = '50% more for every stack after the first';

/** Lightning gear: one use per `per` Lightning power, at least one. */
const usesPer = (per: number) => (ctx: EffectContext): number => Math.max(1, Math.ceil(castPower(ctx) / per));

// =============================================================================
//  TWO WORDS
// =============================================================================

variants(
  ['water', 'mind'],
  minion('undine', {
    dc: 12,
    color: WATER,
    text:
      'It cannot attack. At the start of your turns, the nearest enemy within 5cm of it is drawn 2cm toward it and ' +
      'forgets one random word until the end of its next turn.',
  }),
  imbue('undertowMantle', {
    dc: 12,
    ally: true,
    color: WATER,
    text:
      'For the rest of the fight, a unit landing a basic attack on the bearer is pushed 3cm away and forgets one ' +
      'random word until the end of its next turn.',
  }),
  law('tidesOfForgetting', {
    dc: 12,
    color: WATER,
    text:
      'a unit moved by force (pushed, dragged, swept, swapped or flung, by anyone) forgets one random word until the ' +
      'end of its next turn.',
  })
);

variants(
  ['water', 'shadow'],
  minion('drowner', {
    dc: 11,
    color: DARK_WATER,
    text:
      'It is immune to shadow. Its grip deals 1d4 water and drags the target 2cm toward it. Against a target standing in a shadow it also ' +
      'deals 1d4 shadow and roots it for 2 turns. When it dies, a shadow opens where it fell.',
  }),
  imbue('blackwaterHook', {
    dc: 11,
    color: DARK_WATER,
    text:
      'For the rest of the fight, your landed basic attacks drag the target 2cm toward you. Against a target standing ' +
      'in a shadow they also deal 1d6 shadow.',
  }),
  law('blackUndertow', {
    dc: 12,
    color: DARK_WATER,
    text:
      'at the start of each of its turns, a unit is dragged 2cm toward the nearest shadow pool, then takes 1d4 water ' +
      'if it stands in a shadow. A shadow opens under you as the law is laid.',
    after: (ctx) => placeShadow(ctx, ctx.caster.pos),
  })
);

variants(
  ['water', 'reality'],
  minion('riptide-spirit', {
    dc: 12,
    color: TIDE,
    text: 'It cannot attack. At the start of your turns, it trades places with the nearest enemy within 8cm of it, which takes 1d4 water.',
  }),
  imbue('tidalWard', {
    dc: 12,
    ally: true,
    color: TIDE,
    text: 'The next 2 basic attacks aimed at the bearer never land: each attacker is thrown 4cm away instead.',
  }),
  law('turningTide', {
    dc: 13,
    color: TIDE,
    text:
      'at the end of each round, the tide carries every unit 3cm: to the right, then down, left and up, turning a ' +
      'quarter each round. A unit carried into a wall or the field edge is slammed (2d6 shatter).',
  })
);

variants(
  ['water', 'fire'],
  minion('geyser', {
    dc: 11,
    color: STEAM,
    text:
      'It cannot attack and is immune to heat. At the start of your turns it erupts: every enemy within 3cm of it ' +
      'takes 1d4 heat, gains 1 Fire and is thrown 2cm away.',
  }),
  imbue('steamblade', {
    dc: 11,
    color: STEAM,
    text:
      'For the rest of the fight, your landed basic attacks give the target 1 Fire and push it 1cm away. Against a ' +
      'target that was already burning they also deal 1d4 heat.',
  }),
  law('scaldingWater', {
    dc: 12,
    color: STEAM,
    text: 'every water hit also gives its victim 1 Fire, and every heat hit pushes its victim 1cm away from whoever dealt it.',
  })
);

variants(
  ['water', 'lightning'],
  minion('storm-eel', {
    dc: 12,
    lightning: true,
    color: STORM,
    text:
      'It cannot attack. At the start of your turns, lightning leaps from it to the nearest enemy within half the ' +
      'Lightning power in cm (at least 2cm): 1d6 heat plus 1 per 6 Lightning power, and the struck enemy is thrown ' +
      '2cm away from it.',
  }),
  imbue('conductorsTrident', {
    dc: 12,
    color: STORM,
    uses: usesPer(5),
    text:
      'Your next landed basic attacks, 1 per 5 Lightning power (at least 1), push the target 2cm away, then lightning ' +
      'arcs from it to the nearest other enemy within 3cm: 1d6 heat.',
  }),
  law('conductiveSea', {
    dc: 13,
    lightning: true,
    color: STORM,
    text:
      'every water hit sends lightning from its victim to the nearest other unit of its own side within a third of ' +
      'the Lightning power in cm (at least 2cm): 1d6 heat plus 1 per 6 Lightning power.',
  })
);

variants(
  ['water', 'pain'],
  minion('drowned-thrall', {
    dc: 11,
    color: PAIN,
    text:
      'Its grip deals 1d4 sanity and drags the target 2cm toward it. When it dies, every enemy within 2cm of it takes ' +
      '1d6 sanity.',
  }),
  imbue('gaspingHook', {
    dc: 11,
    color: PAIN,
    text: 'For the rest of the fight, your landed basic attacks drag the target 2cm toward you and deal 1d4 sanity.',
  }),
  law('panicTide', {
    dc: 12,
    color: PAIN,
    text:
      'every slam into a wall or the field edge also deals 1d6 sanity, and a unit that ends its turn within 2cm of a ' +
      'wall or the field edge takes 1d4 sanity.',
  })
);

// =============================================================================
//  THREE WORDS
// =============================================================================

variants(
  ['water', 'mind', 'shadow'],
  minion('abyssal-eye', {
    dc: 13,
    color: DEEP,
    text:
      'It cannot attack and is immune to shadow. A shadow opens under it as it rises. At the start of your turns, every enemy within 6cm of ' +
      'it that stands in a shadow forgets one random word until the end of its next turn.',
    after: (ctx, unit) => placeShadow(ctx, unit.pos),
  }),
  imbue('deepwaterCloak', {
    dc: 13,
    ally: true,
    color: DEEP,
    text:
      'For the rest of the fight, a unit landing a basic attack on the bearer is pushed 3cm away. If it then stands in ' +
      'a shadow, it forgets two random words until the end of its next turn.',
  }),
  law('drownedMemories', {
    dc: 13,
    color: DEEP,
    text:
      'a unit that starts its turn in a shadow forgets one random word for that turn. At the end of each round, every ' +
      'shadow pool drifts 2cm toward the nearest enemy of the side that made it. A shadow opens under your nearest ' +
      'enemy as the law is laid.',
    after(ctx) {
      const foe = ctx.game.mages
        .filter((m) => m.alive && m.team !== ctx.caster.team && !ctx.game.isUnreachable(m))
        .sort((a, b) => dist(a.pos, ctx.caster.pos) - dist(b.pos, ctx.caster.pos))[0];
      if (foe) placeShadow(ctx, foe.pos);
    },
  })
);

variants(
  ['water', 'mind', 'reality'],
  minion('tide-clock', {
    dc: 13,
    color: TIDE,
    text:
      'It cannot attack. At the start of your turns, every enemy within 5cm of it is carried up to 4cm back toward ' +
      'where it began its last turn.',
  }),
  robe('robeOfEbb', { dc: 13, color: TIDE, text: '' }),
  law('tideRemembers', {
    dc: 13,
    color: TIDE,
    text:
      'at the end of each round, every unit is drawn up to 3cm back toward where it stood when the round began (or ' +
      'when the law was laid).',
    after(ctx) {
      const laid = ctx.game.hexLaw('tideRemembers');
      if (laid) laid.anchors = tideAnchors(ctx.game);
    },
  })
);

variants(
  ['water', 'mind', 'fire'],
  minion('kettle-spirit', {
    dc: 13,
    color: THOUGHT,
    text:
      'It cannot attack and is immune to heat. At the start of your turns, the nearest enemy within 6cm of it is ' +
      'drawn 2cm toward it and gains 2 Blueflare. When it is destroyed, every enemy within 4cm takes its Blueflare ' +
      'pulse at once.',
  }),
  imbue('kettleEdge', {
    dc: 13,
    color: THOUGHT,
    text: 'For the rest of the fight, your landed basic attacks give the target 1 Blueflare and push it 2cm away.',
  }),
  law('boilingThoughts', {
    dc: 13,
    color: THOUGHT,
    text:
      'every water hit gives its victim 1 Blueflare, and a unit carrying Blueflare that is moved by force takes its ' +
      'Blueflare pulse at once.',
  })
);

variants(
  ['water', 'mind', 'lightning'],
  minion('brine-synapse', {
    dc: 13,
    lightning: true,
    color: STORM,
    text:
      'It cannot attack. At the start of your turns, a bolt from it strikes the enemy carrying the most Mindconduct ' +
      `within half the Lightning power in cm (at least 2cm): it ${BOLT} 1d3 sanity, ${SCALED}, and is thrown 2cm away.`,
  }),
  imbue('staticMail', {
    dc: 13,
    ally: true,
    color: STORM,
    uses: usesPer(5),
    text:
      'The next units to land a basic attack on the bearer, 1 per 5 Lightning power (at least 1), are struck back: ' +
      `each ${BOLT} 1d4 sanity, ${SCALED}, and is pushed 2cm away.`,
  }),
  law('mindCurrent', {
    dc: 13,
    lightning: true,
    color: STORM,
    text:
      'every water hit gives its victim 1 Mindconduct stack and arcs from it to the nearest other unit of its own ' +
      `side within a third of the Lightning power in cm (at least 2cm): that unit ${BOLT} 1d3 sanity plus 1 per 6 ` +
      `Lightning power, ${SCALED}.`,
  })
);

variants(
  ['water', 'mind', 'pain'],
  minion('siren', {
    dc: 13,
    color: PAIN,
    text: 'It cannot attack. At the start of your turns, the nearest enemy within 8cm of it is drawn 3cm toward it and takes 1d4 sanity.',
  }),
  imbue('wailingTrident', {
    dc: 13,
    color: PAIN,
    text:
      'Your next 3 landed basic attacks deal 1d4 sanity, push the target 2cm away and make it forget one random word ' +
      'until the end of its next turn.',
  }),
  law('flinching', {
    dc: 13,
    color: PAIN,
    text: 'a unit that takes sanity damage flinches: it is pushed 1cm away from whoever dealt it for every 2 sanity lost.',
  })
);

variants(
  ['water', 'shadow', 'pain'],
  minion('abyssal-maw', {
    dc: 13,
    color: DARK_WATER,
    text:
      'It is immune to shadow. Its bite deals 1d6 sanity. At the start of your turns, every unit within 4cm of it but you, allies included, is ' +
      'drawn 2cm toward it and takes 1d4 sanity. When it dies, every unit within 3cm of it, you included, takes 2d4 ' +
      'sanity.',
  }),
  imbue('abyssHook', {
    dc: 13,
    color: DARK_WATER,
    text:
      'For the rest of the fight, your landed basic attacks drag the target 3cm toward you and deal 1d6 sanity. If it ' +
      'has drawn no blood since your last turn, it bites you for 1 corrosive at the start of your turn.',
  }),
  law('maelstrom', {
    dc: 13,
    color: DARK_WATER,
    text:
      'a shadow opens at the centre of the field as the law is laid. At the start of each of its turns, a unit is ' +
      'dragged 2cm toward the centre of the field, then takes 2d4 sanity if it stands within 4cm of it.',
    after: (ctx) => placeShadow(ctx, { x: FIELD.x + FIELD.w / 2, y: FIELD.y + FIELD.h / 2 }, LAW_ROUNDS),
  })
);

variants(
  ['water', 'fire', 'lightning'],
  minion('thundercloud', {
    dc: 14,
    lightning: true,
    color: STORM,
    text:
      'It cannot attack. At the start of your turns, lightning strikes a random unit within half the Lightning power ' +
      'in cm of it (at least 2cm), friend or foe but never you: 1d6 heat plus 1 per 6 Lightning power and 1 Fire, and ' +
      'the thunderclap throws every other unit within 2cm of the strike 2cm away. When it dies it bursts: every unit ' +
      'within 3cm of it, you included, takes 2d6 heat and gains 1 Fire.',
  }),
  imbue('stormTrident', {
    dc: 14,
    color: STORM,
    uses: usesPer(4),
    text:
      'Your next landed basic attacks, 1 per 4 Lightning power (at least 1), call lightning onto the target: 1d6 heat ' +
      'and 1 Fire, and every other unit within 2cm of it, you included, is thrown 2cm away from it.',
  }),
  law('squall', {
    dc: 14,
    lightning: true,
    color: STORM,
    text:
      'at the end of each round, lightning strikes the unit carrying the most Fire, friend or foe (a random unit when ' +
      'nobody burns): 2d6 heat plus 1 per 6 Lightning power. The thunderclap throws every other unit within 3cm of ' +
      'it 2cm away and gives each 1 Fire.',
  })
);
