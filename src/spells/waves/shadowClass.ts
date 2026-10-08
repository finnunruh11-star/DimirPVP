// =============================================================================
//  SHADOW WAVE · CLASS SPELLS
// -----------------------------------------------------------------------------
//  Life / Objects / Hexcraft versions of the all-noun Shadow combos not covered
//  yet (Mind Shadow lives in mindClass.ts, the Water ones in waterClass.ts,
//  the Death ones in deathClass.ts).
//  Shadow is black and amplifies: the two-word Objects are trinkets that make
//  their other word stronger, the laws make it stronger for everyone, and the
//  minions lean on shadow damage. Only now and then do they care whether a
//  unit stands in a shadow. Black majorities hit allies too.
// =============================================================================

import type { EffectContext } from '../../effects/effects';
import { castPower, imbue, law, minion, variants } from './classWave';

const DUSK = 0x6a5acd;
const EMBER = 0xc0502a;
const DREAD = 0x8a3b6b;
const ASH = 0x9a8f8a;
const NERVE = 0xb86bd8;
const SEAR = 0xd1475c;

/** Lightning gear: one use per `per` Lightning power, at least one. */
const usesPer = (per: number) => (ctx: EffectContext): number => Math.max(1, Math.ceil(castPower(ctx) / per));

// =============================================================================
//  TWO WORDS
// =============================================================================

variants(
  ['lightning', 'shadow'],
  minion('umbral-coil', {
    dc: 12,
    lightning: true,
    color: DUSK,
    text:
      'It cannot attack and is immune to shadow. At the start of your turns, a bolt leaps from it to a random unit within half the Lightning ' +
      'power in cm (at least 2cm), friend or foe but never you: 1d6 shadow plus 1 per 6 Lightning power, doubled if ' +
      'that unit stands in a shadow. A shadow opens where it strikes.',
  }),
  imbue('gloomLantern', {
    dc: 12,
    ally: true,
    color: DUSK,
    text: "For the rest of the fight, the bearer's Lightning power is 4 higher.",
  }),
  law('blackStorm', {
    dc: 13,
    lightning: true,
    color: DUSK,
    text:
      "every unit's Lightning power is higher by a third of this law's Lightning power (at least 2). Whenever a unit " +
      'declares a spell with Lightning in it, the storm strikes it too: 1d6 shadow.',
  })
);

variants(
  ['fire', 'shadow'],
  minion('cinder-shade', {
    dc: 11,
    color: EMBER,
    text:
      'It cannot attack and is immune to heat and shadow. At the start of your turns, every unit within 3cm of it but you, ' +
      'allies included, takes 1d4 shadow; a burning one then takes its Fire pulse at once, any other catches 1 Fire.',
  }),
  imbue('coalHeart', {
    dc: 11,
    ally: true,
    color: EMBER,
    text: 'For the rest of the fight, every time the bearer sets Fire on a unit, it gains 1 more stack.',
  }),
  law('blackfire', {
    dc: 12,
    color: EMBER,
    text: 'every heat hit also deals 1d4 shadow to its victim, 2d4 if it stands in a shadow.',
  })
);

variants(
  ['pain', 'shadow'],
  minion('wailing-shade', {
    dc: 11,
    color: DREAD,
    text:
      'It is immune to shadow. Its touch deals 1d4 sanity, and 1d6 more against a target standing in a shadow. At the start of your turns, ' +
      'every unit within 2cm of it but you, allies included, takes 1d4 sanity.',
  }),
  imbue('thornedCirclet', {
    dc: 11,
    ally: true,
    color: DREAD,
    text:
      'For the rest of the fight, every sanity hit the bearer deals is 2 higher, and every sanity hit it takes is 1 ' +
      'higher.',
  }),
  law('echoingAgony', {
    dc: 12,
    color: DREAD,
    text:
      'every sanity hit echoes: every other unit within 2cm of its victim, allies included, takes half as much ' +
      'sanity (rounded down).',
  })
);

// =============================================================================
//  THREE WORDS
// =============================================================================

variants(
  ['lightning', 'fire', 'shadow'],
  minion('ashcloud', {
    dc: 14,
    lightning: true,
    color: ASH,
    text:
      'It cannot attack and is immune to heat. At the start of your turns, lightning sets off every burning unit ' +
      'within half the Lightning power in cm of it (at least 2cm), friend or foe but never you: each takes its Fire ' +
      'pulse at once and 1d4 shadow. If none there burns, it strikes the nearest enemy there instead: 1d6 heat plus ' +
      '1 per 6 Lightning power and 2 Fire.',
  }),
  imbue('stormBrand', {
    dc: 14,
    color: ASH,
    uses: usesPer(5),
    text:
      'Your next landed basic attacks, 1 per 5 Lightning power (at least 1), sear the target: 1d6 shadow, then its ' +
      'Fire pulses at once and it gains 2 Fire.',
  }),
  law('firestorm', {
    dc: 14,
    lightning: true,
    color: ASH,
    text:
      'at the end of each round, lightning strikes every burning unit, friend or foe: its Fire pulses at once and ' +
      'it takes 1d4 shadow plus 1 per 6 Lightning power.',
  })
);

variants(
  ['lightning', 'shadow', 'pain'],
  minion('nerve-coil', {
    dc: 13,
    lightning: true,
    color: NERVE,
    text:
      'It cannot attack. Every sanity hit on another unit within 3cm of it, allies included, deals 1 more, plus 1 per ' +
      '8 Lightning power. At the start of your turns it shrieks: every unit within 3cm of it but you takes 1d4 sanity.',
  }),
  imbue('nerveMail', {
    dc: 13,
    ally: true,
    color: NERVE,
    uses: usesPer(5),
    text:
      'The next units to land a basic attack on the bearer, 1 per 5 Lightning power (at least 1), are shocked: 1d6 ' +
      'sanity, and the shock jumps to the nearest other unit within 3cm of them, friend or foe but never the bearer: ' +
      '1d4 sanity.',
  }),
  law('screamingSky', {
    dc: 14,
    lightning: true,
    color: NERVE,
    text:
      'at the end of each round, lightning strikes the unit with the least sanity, friend or foe: 1d6 sanity (2d6 if ' +
      'it stands in a shadow) and 1d6 shadow, each plus 1 per 6 Lightning power.',
  })
);

variants(
  ['fire', 'shadow', 'pain'],
  minion('pyre-wraith', {
    dc: 13,
    color: SEAR,
    text:
      'It is immune to heat and shadow. Its touch deals 1d4 heat and 1d4 sanity and sets 1 Fire. When it dies it bursts: every ' +
      'unit within 3cm of it, you included, takes 1d6 sanity and gains 2 Fire.',
  }),
  imbue('brandOfAgony', {
    dc: 13,
    color: SEAR,
    text:
      'For the rest of the fight, your landed basic attacks deal 1 sanity per Fire stack the target carries (at ' +
      'least 1), then set 1 Fire. If it has drawn no blood since your last turn, it bites you for 1 corrosive at the ' +
      'start of your turn.',
  }),
  law('burningTerror', {
    dc: 13,
    color: SEAR,
    text: 'a burning unit takes 1d4 sanity at the start of each of its turns, 2d4 if it stands in a shadow.',
  })
);

variants(
  ['mind', 'shadow', 'pain'],
  minion('haunt', {
    dc: 13,
    color: DREAD,
    text:
      'It cannot attack and is immune to shadow. At the start of your turns, the unit with the least sanity within 6cm of it, allies ' +
      'included but never you, takes 1d6 sanity (2d6 if it stands in a shadow) and forgets one random word until the ' +
      'end of its next turn.',
  }),
  imbue('dreadfulEdge', {
    dc: 13,
    color: DREAD,
    text:
      'For the rest of the fight, your landed basic attacks deal 1d4 sanity. Against a target at half its sanity or ' +
      'less they deal 2d6 sanity instead, and it forgets one random word until the end of its next turn.',
  }),
  law('frayingMinds', {
    dc: 13,
    color: DREAD,
    text: 'every sanity hit deals 1 more for every word or deed its victim has forgotten.',
  })
);
