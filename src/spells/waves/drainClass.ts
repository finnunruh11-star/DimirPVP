// =============================================================================
//  DRAIN WAVE · CLASS SPELLS
// -----------------------------------------------------------------------------
//  Life / Objects / Hexcraft versions of every all-verb Drain combo not covered
//  yet (Corrode, Veil and Pierce brought theirs). Each is its Corrode twin that
//  heals for all the corrosive damage it deals: minions feed themselves as well
//  as their summoner, and the gear drinks a share of the blow it lands, so it
//  grows with the hit. Drain Twist stifles, as Corrode Twist does.
// =============================================================================

import {
  conjure,
  HELD,
  imbue,
  law,
  minion,
  rotText,
  SLAM,
  STIFLE,
  STIFLE_ITS,
  TURN,
  variants,
} from './classWave';

const BLOOD = 0xc04a5a;
const CLOT = 0x9a3a4a;
const MARROW = 0xc8a890;

const HALF = 'corrosive equal to half the damage dealt (rounded up)';
const THIRSTING_BLIGHT =
  'a stack of Thirsting Blight (1d3 corrosive per stack at the start of its turns, up to 3 stacks, healing whoever laid ' +
  'it; loses a stack each turn it is not refreshed and spreads to its allies within 3cm)';

// =============================================================================
//  TWO WORDS
// =============================================================================

variants(
  ['drain', 'twist'],
  minion('gag-leech', {
    dc: 12,
    color: BLOOD,
    text: `Its bite drains 1d3 corrosive, with a 34% chance that ${STIFLE} and drains 1d3 corrosive from it.`,
  }),
  imbue('gaggingFang', {
    dc: 12,
    color: BLOOD,
    text: `Your next 3 landed basic attacks drain ${HALF}, healing you, and ${STIFLE}.`,
  }),
  law('chokingThirst', {
    dc: 12,
    color: BLOOD,
    text: `the first corrosive hit a unit takes from another each round means that ${STIFLE_ITS}, and the attacker heals for that hit.`,
  })
);

variants(
  ['drain', 'bind'],
  minion('blood-slime', {
    dc: 11,
    color: CLOT,
    text: 'Its bite drains 1d3 corrosive and tethers the target to it for 2 turns: it cannot move further than 3cm from the slime.',
  }),
  imbue('leechingChains', {
    dc: 12,
    color: CLOT,
    text:
      'For the rest of the fight, a unit landing a basic attack on you is rooted for 2 turns and drained for corrosive ' +
      'equal to half the damage it dealt you (rounded up); you heal for it.',
  }),
  law('clingingThirst', {
    dc: 12,
    color: CLOT,
    text: 'the first corrosive hit a unit takes from another each round roots it for 2 turns, and the attacker heals for that hit.',
  })
);

variants(
  ['drain', 'shatter'],
  minion('leech-brute', {
    dc: 12,
    color: MARROW,
    text: 'Its blows deal 1d6 shatter and drain 1d3 corrosive, and the target takes 1 more damage from every hit for 2 turns.',
  }),
  conjure('conjuredBloodhammer', {
    dc: 12,
    color: MARROW,
    text:
      `Conjure a Bloodhammer into your hand until the fight ends. ${HELD} 120% Strength shatter. On hit: drains ${HALF}, ` +
      'healing you, and the target takes 1 more damage from every hit for 2 turns.',
  }),
  law('brittleThirst', {
    dc: 12,
    color: MARROW,
    text:
      'a corrosive hit makes its target brittle for 4 turns. The next shatter hit on a brittle unit also drains 1d6 ' +
      'corrosive (its attacker heals for it) and ends it.',
  })
);

variants(
  ['drain', 'curse'],
  minion('blood-idol', {
    dc: 12,
    color: BLOOD,
    text: 'It cannot attack. At the start of your turns, every unit within 3cm of it but you, allies included, is drained for 1d3 corrosive.',
  }),
  imbue('thirstingCurse', {
    dc: 11,
    color: BLOOD,
    text:
      'For the rest of the fight, your landed basic attacks inflict Thirsting Curse: half the damage they dealt (rounded ' +
      "up) as corrosive at the start of the target's turns for 3 turns; you heal for it. If it landed nothing since your " +
      'last turn, it drinks 2 corrosive from you at your turn start.',
  }),
  law('curseOfThirst', {
    dc: 11,
    bonus: true,
    color: BLOOD,
    text:
      'a unit carrying a damage over time moves 75% slower, and each damage-over-time tick also drains 1d3 corrosive ' +
      'from its bearer: whoever laid it heals for that.',
  })
);

// =============================================================================
//  THREE WORDS · TWIST
// =============================================================================

variants(
  ['drain', 'twist', 'bind'],
  minion('bloodjaw', {
    dc: 13,
    color: CLOT,
    text:
      'Its bite drains 1d3 corrosive and roots the target for 2 turns. At the start of your turns, for every rooted ' +
      'enemy within 2cm of it, the next action that enemy declares other than moving fails and drains 1d3 corrosive from it.',
  }),
  imbue('bloodGag', {
    dc: 13,
    color: CLOT,
    text: `Your next 3 landed basic attacks root the target for 2 turns and drain ${HALF}, healing you, and ${STIFLE}.`,
  }),
  law('gnawingLockdown', {
    dc: 13,
    color: CLOT,
    text:
      'the first action a rooted unit declares each round, other than moving, fails and drains 1d3 corrosive from it: ' +
      'the nearest unit of another side heals for it.',
  })
);

variants(
  ['drain', 'twist', 'shatter'],
  minion('bloodmill', {
    dc: 14,
    color: MARROW,
    text:
      `It cannot attack. At the start of your turns, every enemy within 2.5cm of it ${TURN} it, takes 1d6 shatter and ` +
      `is drained for 1d3 corrosive; ${SLAM}: 2d6 shatter more.`,
  }),
  imbue('leechspring', {
    dc: 14,
    color: MARROW,
    text:
      `The next 2 basic attacks against you are negated. Each attacker ${TURN} you, takes 1d6 shatter and is drained ` +
      'for corrosive equal to half the blow it would have dealt (rounded up); you heal for it.',
  }),
  law('grindingThirst', {
    dc: 14,
    color: MARROW,
    text:
      'a slam into a wall or the field edge deals double damage and drains 1d6 corrosive more (whoever moved it heals for ' +
      'that), and every shatter hit pushes its target 1cm away from its attacker.',
  })
);

variants(
  ['drain', 'twist', 'curse'],
  minion('leech-wheel', {
    dc: 13,
    color: BLOOD,
    text:
      "Its bite drains 1d3 corrosive, then 1d4 corrosive at the start of each of the target's turns for 4 turns. " +
      `At the start of your turns, every unit within 3cm of it carrying a damage over time, except you, ${TURN} it.`,
  }),
  imbue('thirstingSpindle', {
    dc: 13,
    color: BLOOD,
    text:
      'For the rest of the fight, your landed basic attacks inflict Spindle Thirst: a third of the damage they dealt ' +
      "(rounded up) as corrosive at the start of the target's turns for 3 turns, which heals you; and the target " +
      `${TURN} you.`,
  }),
  law('passingThirst', {
    dc: 13,
    color: BLOOD,
    text:
      'at the end of each round, every damage over time moves from its bearer to the nearest other unit within 4cm; ' +
      'the former bearer takes 1d3 corrosive, and whoever laid that damage over time heals for it.',
  })
);

// =============================================================================
//  THREE WORDS · BIND
// =============================================================================

variants(
  ['drain', 'bind', 'shatter'],
  minion('blood-warden', {
    dc: 13,
    color: CLOT,
    text:
      'Its blows deal 1d4 shatter, drain 1d3 corrosive, root the target for 2 turns and make it take 1 more damage from ' +
      'every hit for 2 turns.',
  }),
  conjure('conjuredLeechingBuckler', {
    dc: 13,
    color: CLOT,
    text:
      `Conjure a Leeching Buckler into your hand until the fight ends. ${HELD} Shield: blocks 20%, +1 armour. ` +
      'A unit landing a basic attack on you is rooted for 2 turns and drained for corrosive equal to half the damage it ' +
      'dealt you (rounded up); you heal for it.',
  }),
  law('calcifiedThirst', {
    dc: 14,
    color: CLOT,
    text:
      'rooted units take 1 more from corrosive hits, and whoever lands one heals for it; the first shatter hit on a ' +
      'rooted unit each round stuns it for 2 turns.',
  })
);

variants(
  ['drain', 'bind', 'curse'],
  minion('fetter-leech', {
    dc: 13,
    color: CLOT,
    text:
      `Its bite drains 1d3 corrosive, gives the target ${rotText('Thirsting Shackles', '1d2', 4, 3)}, which it drains, ` +
      'and slows it by 30% for 2 turns.',
  }),
  imbue('thirstingFetters', {
    dc: 13,
    color: CLOT,
    text:
      'For the rest of the fight, a unit landing a basic attack on you is rooted for 2 turns and takes a third of the ' +
      'damage it dealt you (rounded up) as corrosive at the start of its turns for 3 turns; you heal for it.',
  }),
  law('festeringThirst', {
    dc: 13,
    color: CLOT,
    text: 'corrosive damage over time on a rooted unit rolls its damage twice, and whoever laid it heals for the whole tick.',
  })
);

// =============================================================================
//  THREE WORDS · SHATTER
// =============================================================================

variants(
  ['drain', 'shatter', 'curse'],
  minion('gorged-toad', {
    dc: 13,
    color: MARROW,
    text:
      'Its blows deal 1d4 shatter and drain 1d3 corrosive. When it dies, every unit within 2.5cm takes 2d4 corrosive ' +
      `(you heal for it) and ${THIRSTING_BLIGHT}.`,
  }),
  imbue('blightdrinker', {
    dc: 13,
    color: MARROW,
    text: `For the rest of the fight, your landed basic attacks give the target ${THIRSTING_BLIGHT}.`,
  }),
  law('crackedVessels', {
    dc: 14,
    color: MARROW,
    text:
      'each shatter hit makes every corrosive damage over time on its target deal its damage once more, at once, and ' +
      'its attacker heals for that damage.',
  })
);
