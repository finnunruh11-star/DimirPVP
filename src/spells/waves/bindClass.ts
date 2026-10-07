// =============================================================================
//  BIND WAVE · CLASS SPELLS
// -----------------------------------------------------------------------------
//  Life / Objects / Hexcraft versions of the all-verb Bind combos not covered
//  yet (Corrode, Veil, Pierce and Drain brought theirs; Bind Curse keeps the
//  variants it already had in classSpells.ts). Bind is blue: it holds bodies
//  still. Its minions guard their side rather than hunt, its gear sometimes
//  binds an enemy's own item against it, and its laws tie two states together
//  in ways that cut both ways. Twist beside Bind stifles.
// =============================================================================

import { addImbue, IMBUES } from '../../effects/classKit';
import type { ClassSpellVariant } from '../registry';
import { imbue, law, minion, R, STIFLE_ITS, variants } from './classWave';

const IRON = 0x6a8ad8;
const STONE = 0xa8a090;
const HEX = 0x7a6ab8;

const STONING =
  'turns a stage further to stone: at first it moves 50% slower for 3 turns, once slowed it is rooted for 2 turns, ' +
  'and once rooted it is stunned for 2 turns and takes 1d6 shatter';

// =============================================================================
//  TWO WORDS
// =============================================================================

variants(
  ['bind', 'twist'],
  minion('gaoler', {
    dc: 12,
    color: IRON,
    text:
      'It cannot attack. At the start of your turns it guards your side: the enemy closest to one of your units within ' +
      `5cm of it, if within 3cm of that unit, is rooted for 2 turns, and ${STIFLE_ITS}.`,
  }),
  imbue('shackledGrip', {
    dc: 12,
    foe: true,
    color: IRON,
    text: `The next 3 times it lands a basic attack, its own weapon roots it for 2 turns, and ${STIFLE_ITS}.`,
  }),
  law('gagOrder', {
    dc: 12,
    color: IRON,
    text: 'the first action a rooted unit declares each round, other than moving, fails, and the failure frees it from every root.',
  })
);

variants(
  ['bind', 'shatter'],
  minion('bulwark', {
    dc: 12,
    color: STONE,
    text:
      'It cannot attack. Enemy single-target attacks and spells aimed at you strike it instead 35% of the time. ' +
      'Whenever a hit lands on it, every enemy within 2cm of it takes 1d4 shatter and is rooted for 2 turns.',
  }),
  imbue('brittleFetters', {
    dc: 12,
    foe: true,
    color: STONE,
    text: 'The next 3 times a unit lands a basic attack on it, it takes 1d6 shatter more and is rooted for 2 turns.',
  }),
  law('petrifaction', {
    dc: 12,
    color: STONE,
    text: 'rooted units turn to stone: every hit on them deals half (rounded up), except shatter, which deals double.',
  })
);

// =============================================================================
//  THREE WORDS
// =============================================================================

variants(
  ['bind', 'twist', 'shatter'],
  minion('warding-obelisk', {
    dc: 14,
    color: STONE,
    text:
      'It cannot attack. At the start of your turns, every enemy within 3cm of it is rooted for 2 turns, and the next ' +
      'action the nearest of them declares other than moving fails. When it falls it shatters: every enemy within 3cm ' +
      'takes 2d6 shatter and is stunned for 2 turns.',
  }),
  imbue('shatterlockMail', {
    dc: 14,
    ally: true,
    color: STONE,
    text:
      'The next 2 basic attacks against the bearer are negated. Each attacker takes 1d6 shatter, its next action other ' +
      'than moving fails, and the weapon it struck with is shackled for the rest of the fight: it cannot be put away ' +
      'and deals half damage.',
  }),
  law('breakingPoint', {
    dc: 14,
    color: STONE,
    text:
      'a unit rooted while it is already rooted breaks its bonds: it is freed of every root, takes 2d6 shatter, and ' +
      'its next action other than moving fails.',
  })
);

const EFFIGY_TEXT =
  'For the rest of the fight, each of your landed basic attacks, on anyone, also lays the Effigy Curse on it: 1d3 ' +
  "shadow at the start of its turns for 3 turns, each tick rooting it until its next turn. There is a 34% chance " +
  'that its next action other than moving fails as well.';

const effigyBlade: ClassSpellVariant = {
  name: IMBUES.effigyBlade.name,
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  noCastSprite: true,
  description: `Bind your weapon to one enemy within 12cm. ${EFFIGY_TEXT}`,
  visual: { preset: 'conjure', color: HEX, size: 24, speed: 1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    addImbue(ctx.game, ctx.caster, ctx.caster, 'effigyBlade').boundIndex = ctx.game.mages.indexOf(foe);
    ctx.log(`${ctx.caster.name}'s weapon is bound to ${foe.name}.`);
  },
};
IMBUES.effigyBlade.text = EFFIGY_TEXT;

variants(
  ['bind', 'twist', 'curse'],
  minion('shackle-wraith', {
    dc: 13,
    color: HEX,
    text:
      "Its touch deals 1d3 shadow and lays the Shackle Curse: 1d3 shadow at the start of the target's turns for 3 " +
      'turns, each tick rooting it until its next turn. At the start of your turns, every enemy carrying a damage over ' +
      'time within 2cm of one of your units (within 5cm of the wraith) has its next action other than moving fail.',
  }),
  effigyBlade,
  law('hexedSilence', {
    dc: 13,
    color: HEX,
    text:
      'whenever an action is stifled, every damage over time on its actor deals its damage at once; but a unit ' +
      'carrying a damage over time cannot be rooted.',
  })
);

variants(
  ['bind', 'shatter', 'curse'],
  minion('basilisk', {
    dc: 13,
    color: HEX,
    text: `Its gaze strikes from 4cm for 1d4 shatter, and the target ${STONING}.`,
  }),
  imbue('gorgonCharm', {
    dc: 13,
    ally: true,
    color: HEX,
    text: `For the rest of the fight, at the start of the bearer's turns, every enemy within 3cm of it ${STONING}.`,
  }),
  law('shatteredCurses', {
    dc: 14,
    color: HEX,
    text:
      'a shatter hit on a unit carrying a damage over time breaks the longest-lasting one: it deals all its remaining ' +
      'damage at once and ends, and the unit is rooted for 2 turns.',
  })
);
