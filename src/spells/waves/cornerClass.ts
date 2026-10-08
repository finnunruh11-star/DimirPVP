// =============================================================================
//  LAST CORNERS · CLASS SPELLS
// -----------------------------------------------------------------------------
//  The class combos no wave reached: Shatter Twist's Life and Objects (its
//  Hexcraft Twist Rune is older) and the two Pain pairs with Fire and Mind.
// =============================================================================

import { registerClassSpellVariants } from '../registry';
import { gear, R, raise, rule, variants } from './classWave';

const SHARD = 0xb8c878;
const EMBER = 0xe0603a;
const ACHE = 0xd1475c;

// ---- Shatter Twist ------------------------------------------------------------

registerClassSpellVariants({
  words: ['shatter', 'twist'],
  variants: {
    life: raise('shard-dervish', {
      name: 'Shard Dervish', hp: 8, move: 5, melee: { spec: '1d4', type: 'shatter' },
      onHit: [{ k: 'orbit', slam: { spec: '2d6', type: 'shatter' } }],
      pulse: [{ k: 'orbit', radius: R(2), who: 'foes', hits: [{ spec: '1d3', type: 'shatter' }], slam: { spec: '2d6', type: 'shatter' } }],
    }, {
      dc: 12, color: SHARD,
      text: 'It strikes for 1d4 shatter and turns the target a quarter circle around itself (2d6 shatter if a wall or ' +
        'the field edge stops it). At the start of your turns every enemy within 2cm of it is turned the same way and ' +
        'takes 1d3 shatter.',
    }),
    objects: gear('torsionHammer', {
      name: 'Torsion Hammer', slot: 'weapon',
      onHit: [{ k: 'orbit', slam: { spec: '2d6', type: 'shatter' }, onSlam: [{ k: 'stun', turns: 2 }] }],
    }, {
      dc: 12, color: SHARD,
      text: 'For the rest of the fight, your landed basic attacks turn the target a quarter circle around you; stopped ' +
        'by a wall or the field edge, it takes 2d6 shatter and is stunned for 2 turns.',
    }),
  },
});

// ---- Fire Pain ------------------------------------------------------------------

variants(
  ['fire', 'pain'],
  raise('brand-imp', {
    name: 'Brand Imp', hp: 7, move: 6, melee: { spec: '1d3', type: 'heat' },
    onHit: [{ k: 'fireSanity' }, { k: 'fire', stacks: 1 }],
  }, {
    dc: 12, color: EMBER,
    text: "It bites for 1d3 heat, then deals sanity equal to the target's Fire stacks (at least 1) and sets 1 Fire on it.",
  }),
  gear('mantleOfCinders', {
    name: 'Mantle of Cinders', slot: 'armour',
    onStruck: [{ k: 'fire', stacks: 2 }, { k: 'fireSanity' }],
  }, {
    dc: 12, color: EMBER,
    text: 'For the rest of the fight, a unit landing a basic attack on you catches 2 Fire, then takes sanity equal to ' +
      'its Fire stacks.',
  }),
  rule('agonizingFlames', {
    name: 'Agonizing Flames',
    turn: { burning: true, then: [{ k: 'fireSanity' }] },
    hit: { types: ['sanity'], then: [{ k: 'ifBurning', then: [{ k: 'fire', stacks: 1 }] }] },
  }, {
    dc: 13, color: EMBER,
    text: 'every burning unit takes sanity equal to its Fire stacks at the start of its turns, and every sanity hit ' +
      'on a burning unit adds 1 Fire.',
  })
);

// ---- Mind Pain ------------------------------------------------------------------

variants(
  ['mind', 'pain'],
  raise('migraine', {
    name: 'Migraine', hp: 6, move: 6, pacifist: true,
    pulse: [{
      k: 'aura', radius: R(3), who: 'foes', hits: [{ spec: '1d3', type: 'sanity' }],
      then: [{ k: 'ifShaken', then: [{ k: 'damage', spec: '1d4', type: 'sanity' }] }],
    }],
  }, {
    dc: 12, color: ACHE,
    text: 'It cannot attack. At the start of your turns every enemy within 3cm of it takes 1d3 sanity, and 1d4 more ' +
      'if it is at half its sanity or less.',
  }),
  gear('circletOfMigraines', {
    name: 'Circlet of Migraines', slot: 'trinket',
    turnStart: [{
      k: 'hex', radius: R(4), who: 'foes', nearest: true,
      then: [{ k: 'damage', spec: '1d4', type: 'sanity' }, { k: 'ifShaken', then: [{ k: 'forget', count: 1, turns: 2 }] }],
    }],
  }, {
    dc: 12, color: ACHE,
    text: 'For the rest of the fight, at the start of your turns the nearest enemy within 4cm of you takes 1d4 sanity; ' +
      'at half its sanity or less it also forgets a random word for 2 turns.',
  }),
  rule('splittingHeadaches', {
    name: 'Splitting Headaches',
    hit: { types: ['sanity'], then: [{ k: 'shrapnel', radius: R(2), hits: [{ spec: '1', type: 'sanity' }] }] },
  }, {
    dc: 13, color: ACHE,
    text: 'every sanity hit splinters: every other unit within 2cm of its target, but its attacker, takes 1 sanity.',
  })
);
