// =============================================================================
//  CORRODE WAVE · CLASS SPELLS
// -----------------------------------------------------------------------------
//  Life / Objects / Hexcraft versions of every all-verb Corrode combo (builders
//  in classWave.ts). Corrode Curse and Corrode Pierce Veil keep the variants
//  they already had in classSpells.ts.
// =============================================================================

import { makeSilencingSpike } from '../../core/sandSummons';
import { desecrateGround, summonScarabs } from '../../effects/effects';
import {
  AFFECTED,
  conjure,
  HELD,
  imbue,
  law,
  minion,
  R,
  robe,
  rotText,
  SHROUD,
  SLAM,
  STIFLE,
  STIFLE_ITS,
  TURN,
  variants,
} from './classWave';

const BLIGHT_TEXT =
  'a stack of Blight (1d3 corrosive per stack at the start of its turns, up to 3 stacks; loses a stack each turn it is not refreshed and spreads to its allies within 3cm)';
const PLAGUE_TEXT = rotText('Plague Rot', '1d3', 4, 3);

// =============================================================================
//  TWO WORDS
// =============================================================================

variants(
  ['corrode', 'twist'],
  minion('gag-mite', {
    dc: 12,
    color: 0x86e8a8,
    text: `Its bite deals 1d3 corrosive, with a 34% chance that ${STIFLE} and deals 1d3 corrosive to it.`,
  }),
  imbue('gaggingEdge', {
    dc: 12,
    color: 0x86e8a8,
    text: `On your next 3 landed basic attacks, ${STIFLE} and deals 1d3 corrosive to it.`,
  }),
  law('chokingRust', {
    dc: 12,
    color: 0x86e8a8,
    text: `the first corrosive hit a unit takes each round means that ${STIFLE_ITS}.`,
  })
);

variants(
  ['corrode', 'bind'],
  minion('tar-slime', {
    dc: 11,
    color: 0x7fc8b0,
    text: 'Its bite deals 1d3 corrosive and tethers the target to it for 2 turns: it cannot move further than 3cm from the slime.',
  }),
  imbue('rustChains', {
    dc: 12,
    color: 0x7fc8b0,
    text: 'For the rest of the fight, a unit landing a basic attack on you takes 1d3 corrosive and is rooted for 2 turns.',
  }),
  law('clingingRust', {
    dc: 12,
    color: 0x7fc8b0,
    text: 'the first corrosive hit a unit takes each round roots it for 2 turns.',
  })
);

variants(
  ['corrode', 'veil'],
  minion('caustic-fume', {
    dc: 11,
    bonus: true,
    color: 0x9fb8c8,
    text: `It cannot attack and is immune to pierce. ${SHROUD(2)} At the start of your turns, enemies within 2cm of it take 1d3 corrosive.`,
  }),
  robe('smokeglassRobe', { dc: 11, bonus: true, color: 0x9fb8c8, text: '' }),
  law('acidFog', {
    dc: 11,
    bonus: true,
    color: 0x9fb8c8,
    text: 'a unit hit by corrosive damage gains a half veil for 2 turns.',
  })
);

variants(
  ['corrode', 'pierce'],
  {
    name: 'Silencing Spike',
    actionType: 'main',
    range: 0,
    targeting: 'self',
    dc: 11,
    noCrit: true,
    description:
      'Bind a floating Silencing Spike to yourself. On your turn it hurls itself at the furthest enemy within 15cm ' +
      'for 1d6 pierce, then lodges there and deals 1d4 corrosive to it each turn until it falls. It takes no orders.',
    visual: { preset: 'conjure', color: 0xc0b0d8, size: 26, speed: 1 },
    cast(ctx) {
      const spike = makeSilencingSpike({ ownerName: ctx.caster.name, pos: ctx.caster.pos, team: ctx.caster.team });
      ctx.game.spawnSummon(spike, ctx.caster, 'silencing-spike');
      spike.attachedToIndex = ctx.game.mages.indexOf(ctx.caster);
      ctx.log(`${ctx.caster.name} raises ${spike.name}.`);
    },
  },
  conjure('conjuredAcidJavelin', {
    dc: 12,
    count: 3,
    color: 0xc8f0a0,
    text:
      'Conjure 3 Acid Javelins into your utility slot until the fight ends. Bonus action: throw one at a unit within 10cm ' +
      'for 1d6 pierce and 1d4 corrosive.',
  }),
  law('etching', {
    dc: 12,
    color: 0xc8f0a0,
    text: 'every pierce hit also deals 1d3 corrosive.',
  })
);

variants(
  ['corrode', 'shatter'],
  minion('slag-brute', {
    dc: 12,
    color: 0xc8d878,
    text: 'Its blows deal 1d6 shatter and 1d3 corrosive, with a 25% chance to stun for 2 turns.',
  }),
  conjure('conjuredRotHammer', {
    dc: 12,
    color: 0xc8d878,
    text:
      `Conjure a Rot Hammer into your hand until the fight ends. ${HELD} 120% Strength shatter. ` +
      'On hit: 1d3 corrosive more, and the target takes 1 more damage from every hit for 2 turns.',
  }),
  law('brittle', {
    dc: 12,
    color: 0xc8d878,
    text: 'a corrosive hit makes its target brittle for 4 turns. The next shatter hit on a brittle unit deals 1d6 more and ends it.',
  })
);

variants(
  ['corrode', 'drain'],
  minion('blood-tick', {
    dc: 11,
    bonus: true,
    color: 0x57d6a0,
    text: 'Its bite deals 1d4 corrosive and heals you for the damage dealt.',
  }),
  imbue('leechingEdge', {
    dc: 11,
    bonus: true,
    color: 0x57d6a0,
    text:
      'For the rest of the fight, your landed basic attacks drain 1d3 corrosive: you heal for the damage dealt. ' +
      'If it landed nothing since your last turn, you take 1 corrosive at your turn start.',
  }),
  law('bloodtide', {
    dc: 11,
    bonus: true,
    color: 0x57d6a0,
    text: 'whoever deals corrosive damage to another unit heals for all of it.',
  })
);

variants(
  ['corrode', 'desecrate'],
  minion('blight-walker', {
    dc: 12,
    color: 0x7a8a50,
    text:
      `Its blows deal 1d6 corrosive. For 6 turns the ground within 3cm of it is fouled and moves with it: ${AFFECTED} ` +
      'there take 2d4 corrosive at the start of their turns and cannot be healed.',
    after(ctx, unit) {
      desecrateGround(ctx, unit.pos, {
        name: 'Blight Walk',
        radius: R(3),
        turns: 6,
        blocksHealing: true,
        carrierIndex: ctx.game.mages.indexOf(unit),
        ticks: [{ spec: '2d4', type: 'corrosive' }],
      });
    },
  }),
  imbue('foulingEdge', {
    dc: 12,
    color: 0x7a8a50,
    text:
      `For the rest of the fight, landing a basic attack on one of the ${AFFECTED} fouls the ground within 2cm of it for 3 turns: ` +
      'affected units there take 2d4 corrosive at the start of their turns and cannot be healed.',
  }),
  law('rottingWorld', {
    dc: 12,
    color: 0x7a8a50,
    text: `every hit on one of the ${AFFECTED} also deals 1d4 corrosive, and they cannot be healed.`,
  })
);

// =============================================================================
//  THREE WORDS · TWIST
// =============================================================================

variants(
  ['corrode', 'twist', 'bind'],
  minion('lockjaw', {
    dc: 13,
    color: 0x80d8b0,
    text:
      'Its bite deals 1d3 corrosive and roots the target for 2 turns. At the start of your turns, for every rooted enemy ' +
      'within 2cm of it, the next action that enemy declares other than moving fails.',
  }),
  imbue('rustGag', {
    dc: 13,
    color: 0x80d8b0,
    text: `Your next 3 landed basic attacks root the target for 2 turns, and ${STIFLE} and deals 1d4 corrosive to it.`,
  }),
  law('lockdown', {
    dc: 13,
    color: 0x80d8b0,
    text: 'the first action a rooted unit declares each round, other than moving, fails and deals 1d3 corrosive to it.',
  })
);

variants(
  ['corrode', 'twist', 'veil'],
  minion('hushwraith', {
    dc: 13,
    color: 0x98c8c0,
    text: `Its bite deals 1d3 corrosive, with a 50% chance that ${STIFLE} and deals 1d3 corrosive to it.`,
  }),
  imbue('hushingCloak', {
    dc: 13,
    color: 0x98c8c0,
    text:
      'The next 3 times a unit lands a basic attack on you, the next action it declares other than moving fails, ' +
      'it takes 1d3 corrosive, and you gain a half veil until your next turn.',
  }),
  law('misdirection', {
    dc: 13,
    color: 0x98c8c0,
    text:
      'a single-target hit that can miss has a 25% chance to land on the nearest other unit within 3cm of its target instead ' +
      '(never its attacker), as corrosive damage.',
  })
);

variants(
  ['corrode', 'twist', 'pierce'],
  minion('drill-wasp', {
    dc: 13,
    color: 0xb0f0b0,
    text: 'It strikes from 2cm for 1d6 pierce and 1d3 corrosive.',
  }),
  conjure('conjuredWrenchingBow', {
    dc: 13,
    color: 0xb0f0b0,
    text:
      `Conjure a Wrenching Bow into your hand until the fight ends. ${HELD} Dexterity pierce, range 15cm, needs no arrows. ` +
      `On hit: the target ${TURN} you; ${SLAM}: 1d6 corrosive.`,
  }),
  law('ricochet', {
    dc: 13,
    color: 0xb0f0b0,
    text:
      'when a pierce hit lands, half of it (rounded down) is dealt as corrosive to the nearest other unit within 3cm of the target, ' +
      'never the attacker.',
  })
);

variants(
  ['corrode', 'twist', 'shatter'],
  minion('grindstone', {
    dc: 14,
    color: 0xc0d890,
    text:
      `It cannot attack. At the start of your turns, every enemy within 2.5cm of it ${TURN} it and takes 1d6 shatter ` +
      `and 1d3 corrosive; ${SLAM}: 2d6 shatter more.`,
  }),
  imbue('deflector', {
    dc: 14,
    color: 0xc0d890,
    text:
      `The next 2 basic attacks against you are negated. Each attacker ${TURN} you and takes 1d6 shatter and 1d3 corrosive.`,
  }),
  law('crushing', {
    dc: 14,
    color: 0xc0d890,
    text:
      'a slam into a wall or the field edge deals double damage and 1d6 corrosive more, and every shatter hit pushes its ' +
      'target 1cm away from its attacker.',
  })
);

variants(
  ['corrode', 'twist', 'drain'],
  minion('lamprey-vortex', {
    dc: 13,
    color: 0x60d8b0,
    text:
      'Its bite deals 1d4 corrosive and heals you for the damage dealt. At the start of your turns, every other unit within ' +
      `2cm of it except you ${TURN} it and takes 1d3 corrosive; you heal for the damage dealt.`,
  }),
  imbue('leechHook', {
    dc: 13,
    color: 0x60d8b0,
    text:
      `For the rest of the fight, a target of your landed basic attacks ${TURN} you and is drained for 1d4 corrosive: ` +
      'you heal for the damage dealt.',
  }),
  law('spiralFeast', {
    dc: 13,
    color: 0x60d8b0,
    text:
      `at the start of each unit's turn, every other unit within 2cm of it ${TURN} it and takes 1d3 corrosive; ` +
      'the unit whose turn it is heals for the damage dealt.',
  })
);

variants(
  ['corrode', 'twist', 'curse'],
  minion('hex-wheel', {
    dc: 13,
    color: 0xa0d8a0,
    text:
      'Its bite deals 1d3 corrosive, then 1d4 corrosive at the start of each of the target\'s turns for 4 turns. ' +
      `At the start of your turns, every unit within 3cm of it carrying a damage over time, except you, ${TURN} it.`,
  }),
  imbue('spindle', {
    dc: 13,
    color: 0xa0d8a0,
    text:
      `For the rest of the fight, your landed basic attacks give the target ${rotText('Spindle Rot', '1d3', 3, 3)}, ` +
      `and it ${TURN} you.`,
  }),
  law('passingRot', {
    dc: 13,
    color: 0xa0d8a0,
    text:
      'at the end of each round, every damage over time moves from its bearer to the nearest other unit within 4cm; ' +
      'the former bearer takes 1d3 corrosive.',
  })
);

// =============================================================================
//  THREE WORDS · BIND
// =============================================================================

variants(
  ['corrode', 'bind', 'veil'],
  minion('mistweaver', {
    dc: 13,
    color: 0x88b8c8,
    text: `It cannot attack. ${SHROUD(3)} At the start of your turns, enemies within 3cm of it move 30% slower for 2 turns.`,
  }),
  imbue('gossamer', {
    dc: 13,
    color: 0x88b8c8,
    text:
      'The next 3 times a unit lands a basic attack on you, it is rooted for 2 turns and you gain a half veil until your ' +
      'next turn.',
  }),
  law('stillness', {
    dc: 13,
    color: 0x88b8c8,
    text:
      'a unit that ends its turn without moving gains a half veil for 2 turns; one that moved takes 1d2 corrosive ' +
      'per full 2cm moved, up to 3d2.',
  })
);

variants(
  ['corrode', 'bind', 'pierce'],
  minion('rivet-beetle', {
    dc: 13,
    color: 0xa8e0b0,
    text: 'It strikes from 3cm for 1d4 pierce and 1d3 corrosive and roots the target for 2 turns.',
  }),
  conjure('conjuredHarpoon', {
    dc: 13,
    color: 0xa8e0b0,
    text:
      `Conjure a Rusted Harpoon into your hand until the fight ends. ${HELD} Dexterity pierce, reach 8cm. ` +
      'On hit: 1d3 corrosive more, and the target is tethered to you for 2 turns (3cm).',
  }),
  law('nailing', {
    dc: 14,
    color: 0xa8e0b0,
    text: 'every pierce hit roots its target for 2 turns and deals 1 corrosive more.',
  })
);

variants(
  ['corrode', 'bind', 'shatter'],
  minion('clay-warden', {
    dc: 13,
    color: 0xb8c890,
    text:
      'Its blows deal 1d4 shatter, root the target for 2 turns and make it take 1 more damage from every hit for 2 turns.',
  }),
  conjure('conjuredCalcifiedBuckler', {
    dc: 13,
    color: 0xb8c890,
    text:
      `Conjure a Calcified Buckler into your hand until the fight ends. ${HELD} Shield: blocks 20%, +1 armour. ` +
      'A unit landing a basic attack on you is rooted for 2 turns and takes 1 more damage from every hit for 2 turns.',
  }),
  law('calcification', {
    dc: 14,
    color: 0xb8c890,
    text:
      'rooted units take 1 more from corrosive hits, and the first shatter hit on a rooted unit each round stuns it for 2 turns.',
  })
);

variants(
  ['corrode', 'bind', 'drain'],
  minion('lamprey', {
    dc: 13,
    color: 0x58c8a8,
    text:
      'Its bite deals 1d4 corrosive, heals you for the damage dealt and tethers the target to it for 2 turns (2cm). ' +
      'At the start of your turns, every unit tethered to it takes 1d3 corrosive; you heal for the damage dealt.',
  }),
  imbue('bloodchain', {
    dc: 14,
    color: 0x58c8a8,
    text:
      'For the rest of the fight, your landed basic attacks drain 1d4 corrosive (you heal for the damage dealt), ' +
      'and you and the target are tethered to each other for 2 turns (3cm).',
  }),
  law('chainHunger', {
    dc: 13,
    color: 0x58c8a8,
    text:
      'the first corrosive hit each of your enemies takes each round roots it for 2 turns, and every rooted enemy ' +
      'takes 2d4 corrosive at the start of its turns; you heal for the damage dealt.',
  })
);

variants(
  ['corrode', 'bind', 'curse'],
  minion('fetter-ghoul', {
    dc: 13,
    color: 0x98c898,
    text:
      `Its bite deals 1d3 corrosive, gives the target ${rotText('Rotting Shackles', '1d2', 4, 3)} and slows it by 30% for 2 turns.`,
  }),
  imbue('fetters', {
    dc: 13,
    color: 0x98c898,
    text:
      'For the rest of the fight, a unit landing a basic attack on you is rooted for 2 turns and gains ' +
      `${rotText('Rotting Shackles', '1d2', 4, 3)}.`,
  }),
  law('fester', {
    dc: 13,
    color: 0x98c898,
    text: 'corrosive damage over time on a rooted unit rolls its damage twice.',
  })
);

// =============================================================================
//  THREE WORDS · VEIL
// =============================================================================

variants(
  ['corrode', 'veil', 'shatter'],
  minion('shardling', {
    dc: 13,
    color: 0xb0c0b8,
    text:
      'Its bite deals 1d3 corrosive. ' +
      'When it dies, every unit within 2cm takes 2d4 shatter and 1d4 corrosive.',
  }),
  imbue('shatterglass', {
    dc: 13,
    color: 0xb0c0b8,
    text:
      'The first 2 times a hit of 5 or more lands on you, every other unit within 2cm takes 1d6 shatter and 1d4 corrosive, ' +
      'and you gain a half veil until your next turn.',
  }),
  law('glassVeils', {
    dc: 13,
    color: 0xb0c0b8,
    text: 'when a hit tears away a unit\'s veil, every other unit within 2cm of it takes 1d6 shatter and 1d3 corrosive.',
  })
);

variants(
  ['corrode', 'veil', 'drain'],
  minion('shade-leech', {
    dc: 13,
    color: 0x70a8a0,
    text: 'Its bite deals 1d4 corrosive and heals you for the damage dealt.',
  }),
  imbue('bloodmist', {
    dc: 14,
    color: 0x70a8a0,
    text:
      'For the rest of the fight, at the start of your turns every enemy within 2cm takes 1d3 corrosive and you heal for ' +
      'the damage dealt.',
  }),
  law('veiledHunger', {
    dc: 13,
    color: 0x70a8a0,
    text:
      'a unit about to gain a veil first takes 1d4 corrosive, and the nearest unit of another side heals for the damage dealt.',
  })
);

variants(
  ['corrode', 'veil', 'curse'],
  minion('plague-moth', {
    dc: 13,
    color: 0x98a8a0,
    text:
      'Its bite deals 1d2 corrosive, ' +
      'then 1d3 corrosive at the start of each of the target\'s turns for 4 turns.',
  }),
  imbue('silentEdge', {
    dc: 14,
    color: 0x98a8a0,
    text:
      `For the rest of the fight, your landed basic attacks give the target ${rotText('Silent Rot', '1d3', 3, 3)}, ` +
      'then you dash 2cm straight away from it.',
  }),
  law('quarantine', {
    dc: 13,
    color: 0x98a8a0,
    text: 'a unit carrying a damage over time cannot be targeted by its own side.',
  })
);

// =============================================================================
//  THREE WORDS · PIERCE
// =============================================================================

variants(
  ['corrode', 'pierce', 'shatter'],
  minion('bore-beetle', {
    dc: 13,
    color: 0xd0e0a0,
    text: 'Its blows deal 1d8 pierce and 1d4 corrosive.',
  }),
  conjure('conjuredBreachingArbalest', {
    dc: 14,
    color: 0xd0e0a0,
    text:
      `Conjure a Breaching Arbalest into your hand until the fight ends. ${HELD} Dexterity pierce +30% damage, range 12cm, ` +
      'ignores armour, needs no bolts. On hit: 1d4 corrosive more, with a 20% chance to stun for 2 turns.',
  }),
  law('breach', {
    dc: 14,
    color: 0xd0e0a0,
    text: 'pierce and shatter hits ignore armour and deal 1 corrosive more.',
  })
);

variants(
  ['corrode', 'pierce', 'drain'],
  minion('blood-gnat', {
    dc: 13,
    color: 0x80e0b0,
    text: 'It strikes from 2cm for 1d4 pierce, then drains 1d3 corrosive: you heal for the drained damage.',
  }),
  conjure('conjuredHollowDart', {
    dc: 13,
    count: 3,
    color: 0x80e0b0,
    text:
      'Conjure 3 Hollow Darts into your utility slot until the fight ends. Bonus action: throw one at a unit within 10cm ' +
      'for 1d4 pierce, then 1d4 corrosive; you heal for the corrosive damage dealt.',
  }),
  law('bleeding', {
    dc: 13,
    color: 0x80e0b0,
    text: 'every pierce hit also drains 1d3 corrosive: its attacker heals for that damage.',
  })
);

variants(
  ['corrode', 'pierce', 'curse'],
  minion('barb-archer', {
    dc: 13,
    color: 0xb8e0a0,
    text: `It shoots from 10cm for 1d4 pierce and gives the target ${rotText('Barb Venom', '1d3', 3, 3)}.`,
  }),
  imbue('barbed', {
    dc: 13,
    color: 0xb8e0a0,
    text:
      'For the rest of the fight, your landed basic attacks inflict Barb: 1d4 corrosive at the start of the target\'s turns ' +
      'for 3 turns. Each pierce hit on it adds a turn, up to 4.',
  }),
  law('festering', {
    dc: 13,
    color: 0xb8e0a0,
    text: 'every pierce hit also deals 1d3 corrosive at the start of the target\'s turns for 2 turns.',
  })
);

variants(
  ['corrode', 'pierce', 'desecrate'],
  minion('plague-archer', {
    dc: 15,
    color: 0x8a9a60,
    text:
      `It shoots from 12cm for 1d6 pierce. One of the ${AFFECTED} it hits carries fouled ground (2cm) for 3 turns: ` +
      'affected units there take 1d6 corrosive at the start of their turns and cannot be healed.',
  }),
  conjure('conjuredPlagueSpear', {
    dc: 15,
    color: 0x8a9a60,
    text:
      `Conjure a Plague Spear into your hand until the fight ends. ${HELD} 150% Strength pierce, reach 2cm. ` +
      `On hit against one of the ${AFFECTED}: 2d4 corrosive more, and it cannot be healed for 2 turns.`,
  }),
  law('impaling', {
    dc: 15,
    color: 0x8a9a60,
    text: `pierce hits on ${AFFECTED} deal double damage, and they cannot be healed.`,
  })
);

// =============================================================================
//  THREE WORDS · SHATTER
// =============================================================================

variants(
  ['corrode', 'shatter', 'drain'],
  minion('bonegnawer', {
    dc: 13,
    color: 0x90d0a0,
    text:
      'Its blows deal 1d6 shatter, then drain 1d3 corrosive: you heal for the drained damage. 20% chance to stun for 2 turns.',
  }),
  conjure('conjuredMarrowdrinker', {
    dc: 13,
    color: 0x90d0a0,
    text:
      `Conjure a Marrowdrinker into your hand until the fight ends. ${HELD} 130% Strength shatter. ` +
      'On hit: drains 1d4 corrosive, and you heal for the drained damage.',
  }),
  law('shatteringHunger', {
    dc: 13,
    color: 0x90d0a0,
    text: 'every shatter hit also deals 1d3 corrosive, and its attacker heals for that corrosive damage.',
  })
);

variants(
  ['corrode', 'shatter', 'curse'],
  minion('blight-toad', {
    dc: 13,
    color: 0xb0c880,
    text: `Its blows deal 1d4 shatter. When it dies, every unit within 2.5cm takes 2d4 corrosive and ${BLIGHT_TEXT}.`,
  }),
  imbue('blightHammer', {
    dc: 13,
    color: 0xb0c880,
    text: `For the rest of the fight, your landed basic attacks give the target ${BLIGHT_TEXT}.`,
  }),
  law('brittleRot', {
    dc: 14,
    color: 0xb0c880,
    text: 'each shatter hit makes every corrosive damage over time on its target deal its damage once more, at once.',
  })
);

variants(
  ['corrode', 'shatter', 'desecrate'],
  minion('grave-colossus', {
    dc: 15,
    color: 0x9a9a60,
    text:
      `Its blows deal 2d6 shatter. At the start of your turns, ${AFFECTED} within 2cm of it take 1d6 shatter. ` +
      'When it dies, the ground within 3cm is fouled for 4 turns: affected units there take 1d6 corrosive and 1d6 shatter ' +
      'at the start of their turns and cannot be healed.',
  }),
  conjure('conjuredGravebreaker', {
    dc: 15,
    color: 0x9a9a60,
    text:
      'Conjure Gravebreaker into both hands until the fight ends. Two-handed: you cannot cast while holding it; ' +
      'your hand items go to your bag and return when it fades. 160% Strength shatter. ' +
      `On hit against one of the ${AFFECTED}: 2d6 corrosive more, and the ground within 2cm of it is fouled for 2 turns ` +
      '(affected units there take 1d6 corrosive at the start of their turns and cannot be healed).',
  }),
  law('crumbling', {
    dc: 15,
    color: 0x9a9a60,
    text: `shatter hits on ${AFFECTED} deal double damage, and the first such hit on each of them each round stuns it for 2 turns.`,
  })
);

// =============================================================================
//  THREE WORDS · CURSE / DRAIN / DESECRATE
// =============================================================================

variants(
  ['corrode', 'drain', 'curse'],
  {
    name: 'Scarab Swarm',
    actionType: 'main',
    range: R(5),
    targeting: 'point',
    dc: 13,
    noCrit: true,
    manualCastVisual: true,
    aoe: { kind: 'circle', radius: R(5) },
    description:
      'Summon 5 scarabs around a point within 5cm. Each turn they move toward the nearest enemy (up to 3 per enemy, staying ' +
      'within 8cm of you) and bite for 1d3 corrosive, then return to heal you for the damage their bites dealt. Each scarab ' +
      'has 5 health and 5 sanity and can be killed by area effects.',
    visual: { preset: 'burst', color: 0x57d6a0, size: 70, speed: 1.1 },
    cast(ctx) {
      if (!ctx.targetPoint) return;
      summonScarabs(ctx, ctx.targetPoint);
    },
  },
  imbue('vampireFang', {
    dc: 13,
    color: 0x57d6a0,
    text:
      'For the rest of the fight, your landed basic attacks inflict Drinking Curse: 1d3 corrosive at the start of the ' +
      'target\'s turns for 3 turns; you heal for the damage dealt.',
  }),
  law('feedingRot', {
    dc: 13,
    color: 0x57d6a0,
    text: 'damage over time heals whoever applied it for the damage dealt.',
  })
);

variants(
  ['corrode', 'drain', 'desecrate'],
  minion('gorging-maw', {
    dc: 15,
    color: 0x5f7d4d,
    text:
      `Its bite deals 2d6 corrosive and heals you for the damage dealt. At the start of your turns, ${AFFECTED} within 3cm ` +
      'of it take 1d6 corrosive; you heal for the damage dealt.',
  }),
  imbue('devourer', {
    dc: 15,
    color: 0x5f7d4d,
    text:
      `For the rest of the fight, landing a basic attack on one of the ${AFFECTED} drains 2d6 corrosive (you heal for the ` +
      'damage dealt) and strips 2 of its maximum health, up to 8 in total; it returns when the fight ends.',
  }),
  law('worldFeeds', {
    dc: 15,
    color: 0x5f7d4d,
    text: `every hit on one of the ${AFFECTED} also drains 1d4 corrosive (its attacker heals for that damage), and they cannot be healed.`,
  })
);

variants(
  ['corrode', 'curse', 'desecrate'],
  minion('rot-herald', {
    dc: 15,
    color: 0x6e7d4d,
    text:
      `It cannot attack. At the start of your turns, ${AFFECTED} within 3cm of it gain ${PLAGUE_TEXT} and cannot be healed ` +
      'for 2 turns. When it dies, affected units within 4cm gain 2 stacks.',
  }),
  imbue('plagueCenser', {
    dc: 15,
    color: 0x6e7d4d,
    text:
      `For the rest of the fight, at the start of your turns, ${AFFECTED} within 4cm gain ${PLAGUE_TEXT} and cannot be healed for 2 turns.`,
  }),
  law('eternalRot', {
    dc: 15,
    color: 0x6e7d4d,
    text: `damage over time on ${AFFECTED} does not run down and deals 1 more each tick.`,
  })
);
