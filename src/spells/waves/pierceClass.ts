// =============================================================================
//  PIERCE WAVE · CLASS SPELLS
// -----------------------------------------------------------------------------
//  Life / Objects / Hexcraft versions of the all-verb Pierce combos (builders
//  in classWave.ts). Corrode and Veil brought theirs, and Pierce Bind keeps its
//  Needlepoint Domain. Pierce is colourless, the ranger and assassin word:
//  pierce damage, archers and bows, lunges and dashes. The other words bring
//  the colour. Twist moves bodies here, except beside Bind (blue), where it stifles.
// =============================================================================

import { registerClassSpellVariants } from '../registry';
import { conjure, HELD, imbue, law, minion, SLAM, STIFLE, TURN, variants } from './classWave';

/** A bleeding wound: pierce damage over time. */
const BLEED = (spec: string, turns: number): string => `${spec} pierce at the start of its turns for ${turns} turns`;

// =============================================================================
//  TWO WORDS
// =============================================================================

variants(
  ['pierce', 'twist'],
  minion('blade-dervish', {
    dc: 11,
    color: 0xd8f0e0,
    text:
      'Its blades deal 1d4 pierce. At the start of your turns it dashes to the nearest enemy within 5cm and cuts it ' +
      `for 1d4 pierce; the enemy ${TURN} it, and ${SLAM} it takes 1d6 pierce more.`,
  }),
  conjure('conjuredTwinblades', {
    dc: 11,
    color: 0xd8f0e0,
    text:
      `Conjure Twinblades into your hand until the fight ends. ${HELD} Dexterity pierce, two strikes per attack, each ` +
      'rolled. On hit: you slip a quarter circle around the target.',
  }),
  law('turningBlades', {
    dc: 12,
    color: 0xd8f0e0,
    text: `every pierce hit turns its target a quarter circle around its attacker; ${SLAM}, it takes 1d6 pierce more.`,
  })
);

registerClassSpellVariants({
  words: ['pierce', 'bind'],
  variants: {
    life: minion('pin-archer', {
      dc: 11,
      color: 0xc8e8ff,
      text: 'It shoots from 10cm for 1d4 pierce and roots the target for 2 turns.',
    }),
    objects: conjure('conjuredGrapnel', {
      dc: 11,
      color: 0xc8e8ff,
      text:
        `Conjure a Grapnel into your hand until the fight ends. ${HELD} Dexterity pierce, reach 8cm. On hit: the target ` +
        'is rooted for 2 turns, and you dash to its side.',
    }),
  },
});

variants(
  ['pierce', 'shatter'],
  minion('scorpion', {
    dc: 12,
    color: 0xffe8a8,
    text: 'It shoots bolts from 14cm for 1d8 pierce; every other enemy within 1.5cm of the target takes 1d4 shatter.',
  }),
  conjure('conjuredSplinterJavelin', {
    dc: 12,
    count: 3,
    color: 0xffe8a8,
    text:
      'Conjure 3 Splinter Javelins into your utility slot until the fight ends. Bonus action: throw one at a unit within ' +
      '10cm for 1d6 pierce; every other enemy within 2cm of it takes 1d4 shatter.',
  }),
  law('splintering', {
    dc: 12,
    color: 0xffe8a8,
    text: 'every pierce hit splinters: every other unit within 1.5cm of its target, never its attacker, takes 1d4 shatter.',
  })
);

variants(
  ['pierce', 'curse'],
  minion('thorn-fiend', {
    dc: 11,
    color: 0xffc8a8,
    text:
      `Its claws deal 1d4 pierce and open a bleeding wound: ${BLEED('1d3', 3)}; each pierce hit on it adds a turn, up to 4. ` +
      'When it dies it bursts into thorns: every unit within 2cm, your side included, takes 2d4 pierce.',
  }),
  conjure('conjuredThornbow', {
    dc: 12,
    color: 0xffc8a8,
    text:
      `Conjure a Thornbow into your hand until the fight ends. ${HELD} Dexterity pierce, range 12cm, needs no arrows. ` +
      `On hit: the target bleeds, ${BLEED('1d4', 3)}; each pierce hit on it adds a turn, up to 4.`,
  }),
  law('openWounds', {
    dc: 12,
    color: 0xffc8a8,
    text:
      'every pierce hit opens a wound: a stack of Open Wound (1d3 pierce per stack at the start of its turns, up to 4 ' +
      'stacks, 3 turns).',
  })
);

variants(
  ['pierce', 'drain'],
  minion('bloodfang-stalker', {
    dc: 11,
    color: 0xa8f0c8,
    text:
      'Its fangs deal 1d4 pierce, then drain 1d3 corrosive: you heal for the drained damage. At the start of your turns ' +
      'it dashes to the nearest enemy within 6cm and bites it.',
  }),
  conjure('conjuredLeechingRapier', {
    dc: 11,
    color: 0xa8f0c8,
    text:
      `Conjure a Leeching Rapier into your hand until the fight ends. ${HELD} Dexterity pierce, +2 to the attack roll. ` +
      'On hit: drains corrosive equal to half the damage dealt (rounded up; you heal for it), then you may dash up to 2cm.',
  }),
  law('bloodscent', {
    dc: 12,
    color: 0xa8f0c8,
    text:
      'every pierce hit on a unit at half its health or less also drains 1d6 corrosive from it; its attacker heals for ' +
      'that damage.',
  })
);

// =============================================================================
//  THREE WORDS · TWIST
// =============================================================================

variants(
  ['pierce', 'twist', 'bind'],
  minion('needle-sentry', {
    dc: 13,
    color: 0xb8e8f0,
    text:
      'It cannot attack. At the start of your turns it shoots the nearest enemy within 10cm for 1d4 pierce, and that ' +
      "enemy's next action other than moving fails.",
  }),
  conjure('conjuredSilencerCrossbow', {
    dc: 13,
    color: 0xb8e8f0,
    text:
      `Conjure a Silencer Crossbow into your hand until the fight ends. ${HELD} Dexterity pierce, range 12cm, needs no ` +
      `bolts. On hit: the target is rooted for 2 turns, with a 34% chance that ${STIFLE}.`,
  }),
  law('pinningLaw', {
    dc: 13,
    color: 0xb8e8f0,
    text: 'a pierce hit on one of your enemies roots it for 2 turns, and your rooted enemies cannot react.',
  })
);

variants(
  ['pierce', 'twist', 'shatter'],
  minion('spinning-top', {
    dc: 14,
    color: 0xf0e8b0,
    text:
      'It cannot attack. At the start of your turns it dashes up to 4cm toward the nearest enemy within 6cm, then every ' +
      `enemy within 2cm of it ${TURN} it and takes 1d6 pierce; ${SLAM}, it takes 2d6 shatter more.`,
  }),
  conjure('conjuredCorkscrewLance', {
    dc: 14,
    color: 0xf0e8b0,
    text:
      `Conjure a Corkscrew Lance into your hand until the fight ends. ${HELD} 140% Strength pierce, reach 3cm. On hit: ` +
      `the target ${TURN} you; ${SLAM}: 2d6 shatter.`,
  }),
  law('whirlwind', {
    dc: 14,
    color: 0xf0e8b0,
    text:
      `whenever a unit dashes, every other unit within 2cm of where it stops ${TURN} it and takes 1d4 pierce; ${SLAM}, ` +
      'it takes 2d6 shatter more.',
  })
);

variants(
  ['pierce', 'twist', 'drain'],
  minion('leech-dervish', {
    dc: 13,
    color: 0x98e8c0,
    text:
      'Its fangs deal 1d4 pierce, then drain 1d3 corrosive: you heal for the drained damage. At the start of your turns ' +
      'it dashes to the nearest enemy within 6cm, bites it and slips a quarter circle around it.',
  }),
  conjure('conjuredLeechingChakram', {
    dc: 13,
    color: 0x98e8c0,
    text:
      `Conjure a Leeching Chakram into your hand until the fight ends. ${HELD} Dexterity pierce, range 8cm. On hit: it ` +
      `drains corrosive equal to half the damage dealt (rounded up; you heal for it), and the target ${TURN} you.`,
  }),
  law('circlingThirst', {
    dc: 13,
    color: 0x98e8c0,
    text:
      'after a unit lands a pierce hit, it slips a quarter circle around its target and drains 1d3 corrosive from it, ' +
      'healing for that damage.',
  })
);

variants(
  ['pierce', 'twist', 'curse'],
  minion('hooked-archer', {
    dc: 13,
    color: 0xf0c0a0,
    text:
      `It shoots from 10cm for 1d4 pierce and lodges a barbed hook: ${BLEED('1d3', 3)}, and each tick the target ` +
      `${TURN} the archer.`,
  }),
  conjure('conjuredHookblade', {
    dc: 13,
    color: 0xf0c0a0,
    text:
      `Conjure a Hookblade into your hand until the fight ends. ${HELD} 120% Strength pierce. On hit: the target ${TURN} ` +
      `you (${SLAM}: 1d6 pierce) and takes ${BLEED('1d4', 2)}.`,
  }),
  law('twistingBarbs', {
    dc: 13,
    color: 0xf0c0a0,
    text:
      "every pierce hit lodges a barb: 1d3 pierce at the start of its target's next 2 turns, and each tick turns it a " +
      'quarter circle around whoever lodged it.',
  })
);

// =============================================================================
//  THREE WORDS · BIND
// =============================================================================

variants(
  ['pierce', 'bind', 'shatter'],
  minion('stake-warden', {
    dc: 14,
    color: 0xd8e0c0,
    text:
      'Its pike strikes from 3cm for 1d8 pierce and roots the target for 2 turns; a target already rooted takes 1d6 ' +
      'shatter more. When it dies, every enemy within 2cm takes 2d4 shatter and is rooted for 2 turns.',
  }),
  conjure('conjuredStakeCrossbow', {
    dc: 14,
    color: 0xd8e0c0,
    text:
      `Conjure a Stake Crossbow into your hand until the fight ends. ${HELD} Dexterity pierce, range 10cm, needs no ` +
      'bolts. On hit: the target is rooted for 2 turns; if it already was, it takes 1d6 shatter more instead.',
  }),
  law('stakeLaw', {
    dc: 14,
    color: 0xd8e0c0,
    text: 'a pierce hit on one of your rooted enemies deals 1d6 shatter more and roots it again for 2 turns.',
  })
);

variants(
  ['pierce', 'bind', 'drain'],
  minion('leech-harpooner', {
    dc: 13,
    color: 0x90d8c8,
    text:
      'It strikes from 6cm for 1d4 pierce, drags the target 2cm toward itself and drains 1d3 corrosive: you heal for ' +
      'the drained damage.',
  }),
  conjure('conjuredBloodhookHarpoon', {
    dc: 13,
    color: 0x90d8c8,
    text:
      `Conjure a Bloodhook Harpoon into your hand until the fight ends. ${HELD} Dexterity pierce, reach 8cm. On hit: it ` +
      'drains corrosive equal to half the damage dealt (rounded up; you heal for it) and roots the target for 2 turns.',
  }),
  law('bloodpin', {
    dc: 13,
    color: 0x90d8c8,
    text: 'a pierce hit on a rooted unit also drains 1d4 corrosive from it; its attacker heals for that damage.',
  })
);

variants(
  ['pierce', 'bind', 'curse'],
  minion('thornbinder', {
    dc: 14,
    color: 0xd0b8d0,
    text:
      'Its barbed chain strikes from 4cm for 1d4 pierce, roots the target for 2 turns and leaves thorns in it: ' +
      `${BLEED('1d3', 3)}.`,
  }),
  conjure('conjuredThornwhip', {
    dc: 14,
    color: 0xd0b8d0,
    text:
      `Conjure a Thornwhip into your hand until the fight ends. ${HELD} 110% Strength pierce, reach 4cm. On hit: the ` +
      `target is rooted for 2 turns; if it already was, thorns dig in instead: ${BLEED('1d4', 3)}.`,
  }),
  law('thornedFetters', {
    dc: 14,
    color: 0xd0b8d0,
    text: 'whenever a unit is rooted, thorns dig in: 1d3 pierce at the start of its turns for 3 turns.',
  })
);

// =============================================================================
//  THREE WORDS · SHATTER
// =============================================================================

variants(
  ['pierce', 'shatter', 'drain'],
  minion('marrow-archer', {
    dc: 13,
    color: 0xc8e0a8,
    text:
      'It shoots from 12cm for 1d4 pierce and drains 1d3 corrosive (you heal for the drained damage); every other ' +
      'enemy within 1.5cm of the target takes 1d3 shatter.',
  }),
  imbue('boneMail', {
    dc: 13,
    color: 0xc8e0a8,
    text:
      'The next 2 basic attacks against you are negated; each attacker takes 1d6 pierce and is drained for corrosive ' +
      'equal to half the blow it would have dealt (rounded up): you heal for it.',
  }),
  law('marrowThirst', {
    dc: 13,
    color: 0xc8e0a8,
    text: 'every pierce or shatter hit of 4 or more also drains 1d4 corrosive from its target; its attacker heals for that damage.',
  })
);

variants(
  ['pierce', 'shatter', 'curse'],
  minion('shardhound', {
    dc: 14,
    color: 0xf0b890,
    text:
      "Its bite deals 1d6 pierce and leaves splinters: 1d4 shatter at the start of the target's turns for 3 turns. When " +
      'it dies it bursts: every unit within 2cm, your side included, takes 2d4 shatter.',
  }),
  conjure('conjuredSplinterbow', {
    dc: 14,
    color: 0xf0b890,
    text:
      `Conjure a Splinterbow into your hand until the fight ends. ${HELD} Dexterity pierce, range 14cm, needs no arrows. ` +
      "On hit: splinters, 1d3 shatter at the start of the target's turns for 3 turns, and every other unit within 1.5cm " +
      'of it, your side included, takes 1d3 shatter.',
  }),
  law('splinterCurse', {
    dc: 14,
    color: 0xf0b890,
    text: `every shatter hit leaves splinters in its target: ${BLEED('1d3', 3)}.`,
  })
);

// =============================================================================
//  THREE WORDS · DRAIN / CURSE
// =============================================================================

variants(
  ['pierce', 'drain', 'curse'],
  minion('vampire-bat', {
    dc: 13,
    color: 0xc87870,
    text:
      "Its bite deals 1d4 pierce and inflicts Bloodletting: 1d3 corrosive at the start of the target's turns for 3 turns, " +
      'which heals you. At the start of your turns it dashes to the nearest unit within 6cm, friend or foe but never ' +
      'you, and bites it.',
  }),
  imbue('bloodthirstyEdge', {
    dc: 13,
    color: 0xc87870,
    text:
      'For the rest of the fight, your landed basic attacks drain corrosive equal to half the damage they dealt (rounded ' +
      `up; you heal for it) and leave the target bleeding: ${BLEED('1d3', 2)}. If it landed nothing since your last turn, it drinks 2 corrosive ` +
      'from you at your turn start.',
  }),
  law('vampiricWounds', {
    dc: 13,
    color: 0xc87870,
    text:
      "every pierce hit inflicts Bloodletting: 1d3 corrosive at the start of the target's turns for 3 turns, and whoever " +
      'dealt the hit heals for each tick.',
  })
);
