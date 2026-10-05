// =============================================================================
//  VEIL WAVE · CLASS SPELLS
// -----------------------------------------------------------------------------
//  Life / Objects / Hexcraft versions of every all-verb Veil combo (builders in
//  classWave.ts). Veil Bind and the Corrode Veil combos already have theirs.
//  Veil is blue: evasion and protection. Shroud minions, robes, hit-and-run
//  and denial; being veiled never makes anything stronger. Twist with Veil stifles.
// =============================================================================

import {
  conjure,
  DASH_AWAY,
  HELD,
  imbue,
  law,
  minion,
  robe,
  SHROUD,
  STIFLE,
  STIFLE_ITS,
  variants,
} from './classWave';

const SHADOW_TICK = (turns: number, spec = '1d3'): string =>
  `${spec} shadow at the start of the target's turns for ${turns} turns`;

// =============================================================================
//  TWO WORDS
// =============================================================================

variants(
  ['veil', 'curse'],
  minion('murk-wisp', {
    dc: 11,
    color: 0x8a7fb0,
    text: `Its bite deals 1d2 shadow, then ${SHADOW_TICK(4)}, and it ${DASH_AWAY(2)}.`,
  }),
  robe('hexingRobe', { dc: 11, bonus: true, color: 0x8a7fb0, text: '' }),
  law('creepingShroud', {
    dc: 12,
    color: 0x8a7fb0,
    text: 'every damage-over-time tick deals 1 more and leaves its bearer with a half veil until its next turn.',
  })
);

variants(
  ['veil', 'drain'],
  minion('siphon-wraith', {
    dc: 11,
    color: 0x6fb8a0,
    text:
      'It cannot attack. At the start of your turns, every enemy within 2cm of it takes 1d3 corrosive; you heal for the ' +
      'damage dealt.',
  }),
  robe('thirstingRobe', { dc: 11, bonus: true, color: 0x6fb8a0, text: '' }),
  law('thirstingVeil', {
    dc: 12,
    color: 0x6fb8a0,
    text: 'every veil lasts 1 turn longer, but any hit on a veiled unit heals its attacker for all of the damage dealt.',
  })
);

variants(
  ['veil', 'pierce'],
  minion('phantom-lancer', {
    dc: 11,
    color: 0xc0c8e0,
    text: `It strikes from 3cm for 1d4 pierce, then ${DASH_AWAY(2)}.`,
  }),
  robe('smokeRobe', { dc: 11, bonus: true, color: 0xc0c8e0, text: '' }),
  law('unseenBlades', {
    dc: 12,
    color: 0xc0c8e0,
    text: 'every pierce hit leaves its target with a half veil until its next turn, and pierce hits on a veiled unit deal double damage.',
  })
);

variants(
  ['veil', 'shatter'],
  minion('mirror-knight', {
    dc: 12,
    color: 0xb8c8d8,
    text:
      'Its blows deal 1d6 shatter. At the start of your turns, every veiled enemy within 3cm of it takes 1d3 shatter and ' +
      'loses its veil. When it dies, every enemy within 2cm is stunned for 2 turns.',
  }),
  robe('mirrorRobe', { dc: 12, bonus: true, color: 0xb8c8d8, text: '' }),
  law('brittleVeils', {
    dc: 12,
    color: 0xb8c8d8,
    text: 'a unit whose veil is torn away by a hit is stunned for 2 turns.',
  })
);

variants(
  ['veil', 'twist'],
  minion('hush-sprite', {
    dc: 11,
    color: 0x9ab8d8,
    text:
      'It cannot attack. At the start of your turns, the next action of the nearest enemy within 4cm of it, other than ' +
      'moving, fails.',
  }),
  robe('hushingRobe', { dc: 12, bonus: true, color: 0x9ab8d8, text: '' }),
  law('silentVeil', {
    dc: 12,
    color: 0x9ab8d8,
    text: 'a unit whose action is stifled gains a half veil until its next turn, and veiled units cannot react.',
  })
);

// =============================================================================
//  THREE WORDS · CURSE
// =============================================================================

variants(
  ['veil', 'curse', 'drain'],
  minion('night-leech', {
    dc: 13,
    color: 0x5f9f8a,
    text:
      'Its bite deals 1d4 corrosive and heals you for the damage dealt, then 1d3 corrosive at the start ' +
      "of each of the target's turns for 3 turns, which also heals you.",
  }),
  imbue('leechveil', {
    dc: 13,
    color: 0x5f9f8a,
    text:
      'The next 3 times a unit lands a basic attack on you, it takes 1d4 corrosive at the start of its turns for 3 turns ' +
      '(you heal for that damage), and you gain a half veil until your next turn.',
  }),
  law('unseenHunger', {
    dc: 14,
    color: 0x5f9f8a,
    text:
      'at the start of each of your turns, every enemy carrying a damage over time takes 1d6 corrosive (you heal for the ' +
      'damage dealt) and gains a half veil until its next turn.',
  })
);

variants(
  ['veil', 'curse', 'pierce'],
  minion('hexbow-phantom', {
    dc: 13,
    color: 0xa098c8,
    text: `It shoots from 12cm for 1d4 pierce, then ${SHADOW_TICK(3)}.`,
  }),
  imbue('briarShroud', {
    dc: 13,
    color: 0xa098c8,
    text: 'For the rest of the fight, a unit landing a basic attack on you takes 1d3 pierce at the start of its turns for 3 turns.',
  }),
  law('huntersHex', {
    dc: 13,
    color: 0xa098c8,
    text:
      'every veil is a mark: a unit that gains a veil takes 1d3 shadow at the start of its turns for 3 turns, and pierce ' +
      'hits on a veiled unit deal 1d4 more.',
  })
);

variants(
  ['veil', 'curse', 'shatter'],
  minion('dread-sentinel', {
    dc: 13,
    color: 0x9890b0,
    text: `Its blows deal 1d6 shatter, then ${SHADOW_TICK(3)}.`,
  }),
  conjure('conjuredHollowMaul', {
    dc: 13,
    color: 0x9890b0,
    text:
      `Conjure a Hollow Maul into your hand until the fight ends. ${HELD} 120% Strength shatter. ` +
      `On hit: ${SHADOW_TICK(4)}, with a 20% chance to stun it for 2 turns.`,
  }),
  law('shatteredShroud', {
    dc: 13,
    color: 0x9890b0,
    text: 'a unit whose veil is torn away by a hit takes 1d4 shadow at the start of its turns for 4 turns.',
  })
);

variants(
  ['veil', 'curse', 'twist'],
  minion('muttering-shade', {
    dc: 13,
    color: 0x8a80a8,
    text:
      'It cannot attack. At the start of your turns, every enemy within 3cm of it carrying a damage over time has its ' +
      'next action other than moving fail.',
  }),
  imbue('hushingCurse', {
    dc: 13,
    color: 0x8a80a8,
    text:
      'Your next 3 landed basic attacks curse the target for 2 turns: 1d3 shadow at the start of its turns, and each tick ' +
      'makes its next action other than moving fail.',
  }),
  law('smotheringCurse', {
    dc: 14,
    color: 0x8a80a8,
    text: 'the first action each round of a unit carrying two or more damage-over-time effects, other than moving, fails.',
  })
);

variants(
  ['veil', 'curse', 'bind'],
  minion('veil-spider', {
    dc: 13,
    color: 0x8890c0,
    text: `Its bite deals 1d3 shadow and roots the target for 2 turns, then ${SHADOW_TICK(3)}.`,
  }),
  imbue('bindingShroud', {
    dc: 13,
    ally: true,
    color: 0x8890c0,
    text:
      'For the rest of the fight, a unit landing a basic attack on the bearer is rooted for 2 turns and takes 1d3 shadow ' +
      'at the start of its turns for 3 turns.',
  }),
  law('shackleCurse', {
    dc: 13,
    color: 0x8890c0,
    text: 'a rooted unit takes 1d4 shadow at the start of its turns.',
  })
);

// =============================================================================
//  THREE WORDS · DRAIN
// =============================================================================

variants(
  ['veil', 'drain', 'pierce'],
  minion('gloom-bat', {
    dc: 13,
    color: 0x70c8b0,
    text: `It strikes from 2cm for 1d4 pierce, then drains 1d3 corrosive (you heal for the drained damage) and ${DASH_AWAY(2)}.`,
  }),
  imbue('thirstingNeedle', {
    dc: 13,
    color: 0x70c8b0,
    text:
      'For the rest of the fight, your landed basic attacks drain 1d3 corrosive (you heal for the damage dealt), then ' +
      'you dash 2cm straight away from the target.',
  }),
  law('hiddenFangs', {
    dc: 13,
    color: 0x70c8b0,
    text:
      'a unit that lands a pierce hit gains a half veil until its next turn, and a pierce hit on a veiled unit drains ' +
      '1d4 corrosive more; the attacker heals for that damage.',
  })
);

variants(
  ['veil', 'drain', 'shatter'],
  minion('gloom-brute', {
    dc: 13,
    color: 0x80b098,
    text: 'Its blows deal 1d6 shatter, then drain 1d3 corrosive: you heal for the drained damage.',
  }),
  conjure('conjuredSiphonMaul', {
    dc: 13,
    color: 0x80b098,
    text:
      `Conjure a Siphoning Maul into your hand until the fight ends. ${HELD} 120% Strength shatter. ` +
      'On hit: drain 1d4 corrosive (you heal for the damage dealt), then dash 2cm straight away from the target.',
  }),
  law('shatteredThirst', {
    dc: 13,
    color: 0x80b098,
    text: "when a hit tears away a unit's veil, its attacker drains 1d6 corrosive from it and heals for that damage.",
  })
);

variants(
  ['veil', 'drain', 'twist'],
  minion('hush-leech', {
    dc: 13,
    color: 0x6fc0b0,
    text: `Its bite deals 1d4 corrosive and heals you for the damage dealt, with a 34% chance that ${STIFLE}.`,
  }),
  conjure('conjuredHushVial', {
    dc: 13,
    count: 3,
    color: 0x6fc0b0,
    text:
      'Conjure 3 Hush Vials into your utility slot until the fight ends. Bonus action: throw one at a unit within 8cm: ' +
      `drain 1d4 corrosive (you heal for the damage dealt), and ${STIFLE_ITS}.`,
  }),
  law('stifledThirst', {
    dc: 13,
    color: 0x6fc0b0,
    text: "whenever a unit's action is stifled, it takes 1d6 corrosive and whoever stifled it heals for that damage.",
  })
);

variants(
  ['veil', 'drain', 'bind'],
  minion('shroud-leech', {
    dc: 13,
    color: 0x6ab8c0,
    text:
      `${SHROUD(2)} Its bite deals 1d3 corrosive, heals you for the damage dealt and roots the target for 2 turns. ` +
      'At the start of your turns, every rooted enemy within 3cm of it takes 1d4 corrosive; you heal for the damage dealt.',
  }),
  imbue('bindingVeil', {
    dc: 13,
    ally: true,
    color: 0x6ab8c0,
    text:
      'For the rest of the fight, a unit landing a basic attack on the bearer is rooted for 2 turns and drained for 1d3 ' +
      'corrosive; the bearer heals for the damage dealt.',
  }),
  law('chokingMist', {
    dc: 13,
    color: 0x6ab8c0,
    text:
      'a rooted unit cannot be veiled. Rooting a veiled unit tears its veil away and deals 1d4 corrosive to it; whoever ' +
      'rooted it heals for that damage.',
  })
);

// =============================================================================
//  THREE WORDS · PIERCE / SHATTER / TWIST
// =============================================================================

variants(
  ['veil', 'pierce', 'shatter'],
  minion('mirror-lancer', {
    dc: 13,
    color: 0xc8d0e0,
    text: 'It strikes from 3cm for 1d8 pierce. When it dies, every enemy within 2cm takes 2d4 shatter.',
  }),
  conjure('conjuredGlassLongbow', {
    dc: 14,
    color: 0xc8d0e0,
    text:
      `Conjure a Glass Longbow into your hand until the fight ends. ${HELD} Dexterity pierce, range 18cm, needs no arrows: ` +
      '100% hit to 12cm, 75% to 18cm. On hit: 1d4 shatter more.',
  }),
  law('longShadows', {
    dc: 14,
    color: 0xc8d0e0,
    text: 'a pierce hit from 10cm or further deals 1d6 pierce more, and its attacker gains a half veil for 2 turns.',
  })
);

variants(
  ['veil', 'pierce', 'twist'],
  minion('hush-archer', {
    dc: 13,
    color: 0xc0d0e8,
    text: `It shoots from 12cm for 1d4 pierce, with a 34% chance that ${STIFLE}.`,
  }),
  imbue('hushingPin', {
    dc: 13,
    color: 0xc0d0e8,
    text: `Your next 3 landed basic attacks deal 1d3 pierce more, and ${STIFLE}.`,
  }),
  law('pinningSilence', {
    dc: 13,
    color: 0xc0d0e8,
    text:
      "every pierce hit makes its target's next action other than moving fail, and leaves it with a half veil until its " +
      'next turn.',
  })
);

variants(
  ['veil', 'pierce', 'bind'],
  minion('web-lurker', {
    dc: 13,
    color: 0xa8c8e8,
    text: 'It strikes from 3cm for 1d4 pierce and tethers the target to it for 2 turns (3cm).',
  }),
  conjure('conjuredSnareBolas', {
    dc: 13,
    count: 3,
    color: 0xa8c8e8,
    text:
      'Conjure 3 Snare Bolas into your utility slot until the fight ends. Bonus action: throw one at a unit within 8cm: ' +
      'it is rooted for 3 turns, and you gain a half veil for 2 turns.',
  }),
  law('nailedShadows', {
    dc: 13,
    color: 0xa8c8e8,
    text: "a pierce hit roots its target for 2 turns, and hits cannot tear a rooted unit's veil away.",
  })
);

variants(
  ['veil', 'shatter', 'twist'],
  minion('shatter-wisp', {
    dc: 13,
    color: 0xb8c8d8,
    text:
      'Its blows deal 1d4 shatter. When it dies, every enemy within 3cm takes 1d6 shatter, and ' +
      'their next action other than moving fails.',
  }),
  conjure('conjuredHushingHammer', {
    dc: 13,
    color: 0xb8c8d8,
    text:
      `Conjure a Hushing Hammer into your hand until the fight ends. ${HELD} 120% Strength shatter. ` +
      `On hit: 30% chance that ${STIFLE}.`,
  }),
  law('brittleSilence', {
    dc: 13,
    color: 0xb8c8d8,
    text: "when a hit tears away a unit's veil, its next action other than moving fails.",
  })
);

variants(
  ['veil', 'shatter', 'bind'],
  minion('glass-warden', {
    dc: 13,
    color: 0xa8c0d8,
    text:
      `${SHROUD(2)} Its blows deal 1d4 shatter and root the target for 2 turns. When it dies, every enemy within 2cm ` +
      'is rooted for 2 turns.',
  }),
  imbue('mirrorMail', {
    dc: 13,
    color: 0xa8c0d8,
    text: 'The next 2 basic attacks against you are negated; each attacker is rooted for 2 turns and takes 1d4 shatter.',
  }),
  law('brittleBonds', {
    dc: 13,
    color: 0xa8c0d8,
    text: 'shatter hits on a rooted unit deal 1d6 more, and veiled units cannot be rooted.',
  })
);

variants(
  ['veil', 'twist', 'bind'],
  minion('gag-spider', {
    dc: 13,
    color: 0x8ac8e8,
    text: `Its bite deals 1d3 shadow and roots the target for 2 turns, with a 34% chance that ${STIFLE}.`,
  }),
  imbue('hushingShackles', {
    dc: 13,
    ally: true,
    color: 0x8ac8e8,
    text: `The next 3 times a unit lands a basic attack on the bearer, it is rooted for 2 turns and ${STIFLE_ITS}.`,
  }),
  law('gaggingBonds', {
    dc: 14,
    color: 0x8ac8e8,
    text: 'whenever a unit is rooted, its next action other than moving fails, and rooted units cannot react.',
  })
);
