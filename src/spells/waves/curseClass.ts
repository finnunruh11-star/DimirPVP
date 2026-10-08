// =============================================================================
//  CURSE WAVE · CLASS SPELLS
// -----------------------------------------------------------------------------
//  Life / Objects / Hexcraft versions of the all-verb Curse combos not covered
//  yet. Curse is black and heavy: it takes a blow, makes it far bigger and
//  pays it out over the turns that follow, or it lays something that lasts.
//  Its minions hurt everything near them every round, your side included,
//  and leave curses behind. Twist beside Curse moves bodies. Curse Twist
//  Desecrate is left out, as Twist never meets Desecrate.
// =============================================================================

import { AFFECTED, conjure, imbue, law, minion, rotText, TURN, variants } from './classWave';

const HEX = 0x7a3b8f;
const FAULT = 0x9a7a6a;
const GRAVE = 0x4a3a5a;

const FAULT_LINES = rotText('Fault Lines', '1d2', 5, 6, 'shatter');
const KNELL = rotText('Knell', '1d3', 6, 6, 'shadow');
const BONE_ROT = rotText('Bone Rot', '1d4', 5, 5, 'shatter');
const FRACTURE = rotText('Fracture', '1d4', 6, 5, 'shatter');

// =============================================================================
//  TWO WORDS
// =============================================================================

variants(
  ['curse', 'shatter'],
  minion('fault-idol', {
    dc: 13,
    color: FAULT,
    text:
      'It cannot attack. At the start of your turns the ground quakes around it: every unit within 3cm of it but you, ' +
      `allies included, takes 1d4 shatter and gains ${FAULT_LINES}.`,
  }),
  imbue('faultlineEdge', {
    dc: 13,
    color: FAULT,
    text:
      'For the rest of the fight, your landed basic attacks leave an Aftershock: two thirds of the damage dealt (rounded ' +
      "up) as shatter at the start of the target's turns for 3 turns. If it landed nothing since your last turn, it " +
      'bites you for 2 corrosive at your turn start.',
  }),
  law('aftershocks', {
    dc: 13,
    color: FAULT,
    text:
      "every shatter hit echoes: its full damage again as shatter at the start of its target's next 2 turns. Echoes on " +
      'the same unit add up.',
  })
);

variants(
  ['curse', 'twist'],
  minion('hex-vortex', {
    dc: 12,
    color: HEX,
    text:
      `It cannot attack. At the start of your turns, every unit within 3cm of it but you, allies included, ${TURN} it, ` +
      'takes 1d4 shadow and is cursed: 1d3 shadow at the start of its turns for 4 turns.',
  }),
  imbue('hangmansKnot', {
    dc: 12,
    color: HEX,
    text:
      'For the rest of the fight, your landed basic attacks tie a Noose: half the damage dealt (rounded up) as shadow at ' +
      "the start of the target's turns for 3 turns, each tick dragging it 2cm toward you. If it landed nothing since " +
      'your last turn, it bites you for 1 corrosive at your turn start.',
  }),
  law('gyreOfCurses', {
    dc: 13,
    color: HEX,
    text:
      'every damage-over-time tick turns its bearer a quarter circle around whoever laid it; stopped by a wall or the ' +
      'field edge, the tick deals its damage again.',
  })
);

variants(
  ['curse', 'desecrate'],
  minion('mourning-bell', {
    dc: 13,
    color: GRAVE,
    text: `It cannot attack. At the start of your turns it tolls: ${AFFECTED} within 5cm of it take 1d6 shadow and gain ${KNELL}.`,
  }),
  imbue('graveDirtBlade', {
    dc: 13,
    color: GRAVE,
    text:
      `For the rest of the fight, your landed basic attacks on ${AFFECTED} lay the Grave Curse: half the damage dealt ` +
      '(rounded up) as shadow at the start of its turns for 6 turns, and it cannot be healed for 6 turns.',
  }),
  law('longCurse', {
    dc: 13,
    color: GRAVE,
    text:
      `damage over time on ${AFFECTED} rolls its damage twice, and when one of them dies, its curses pass to the nearest ` +
      'affected unit within 5cm.',
  })
);

// =============================================================================
//  THREE WORDS
// =============================================================================

variants(
  ['curse', 'shatter', 'twist'],
  minion('puppeteer', {
    dc: 14,
    color: FAULT,
    text:
      'It cannot attack. At the start of your turns, every unit within 2cm of it but you, allies included, takes 1d4 ' +
      "shatter, and it ties its strings to the nearest enemy within 6cm: 1d4 shatter at the start of that enemy's turns " +
      'for 4 turns, each tick turning it a quarter circle around the puppeteer.',
  }),
  imbue('spiralFracture', {
    dc: 14,
    color: FAULT,
    text:
      'For the rest of the fight, your landed basic attacks leave a Spiral Fracture: half the damage dealt (rounded up) ' +
      `as shatter at the start of the target's turns for 3 turns, and each tick it ${TURN} you. If it landed nothing ` +
      'since your last turn, it bites you for 1 corrosive at your turn start.',
  }),
  law('rattlingCurses', {
    dc: 14,
    color: FAULT,
    text:
      'whenever a unit is moved by force or turned, every damage over time on it deals its damage at once (once a round ' +
      'for each unit).',
  })
);

variants(
  ['curse', 'shatter', 'desecrate'],
  minion('bone-reliquary', {
    dc: 15,
    color: GRAVE,
    text:
      `It cannot attack. At the start of your turns, ${AFFECTED} within 4cm of it take 1d6 shatter and gain ${BONE_ROT}. ` +
      'When it breaks, affected units within 4cm gain 2 stacks.',
  }),
  conjure('conjuredOssuaryMaul', {
    dc: 15,
    color: GRAVE,
    text:
      'Conjure an Ossuary Maul into both hands until the fight ends. Two-handed: you cannot cast while holding it; ' +
      'your hand items go to your bag and return when it fades. 150% Strength shatter. ' +
      `On hit against one of the ${AFFECTED}: the whole hit again as shatter at the start of its next 3 turns, and it ` +
      'cannot be healed meanwhile.',
  }),
  law('fracturingCurse', {
    dc: 15,
    color: GRAVE,
    text: `every hit on one of the ${AFFECTED} cracks it: ${FRACTURE}.`,
  })
);
