// =============================================================================
//  REALITY · CLASS SPELLS
// -----------------------------------------------------------------------------
//  Reality is a blue noun that joins only the other blue nouns, Mind and
//  Water. It does not hurt much by itself; it rewrites where things are, what
//  is real and who acts: doubles that take your place, phantoms that swallow
//  attacks, rifts to the far side of the field, a field that tilts and a sea
//  that dreams.
// =============================================================================

import { FIELD } from '../../config/constants';
import type { GameState } from '../../core/GameState';
import type { Mage } from '../../core/Mage';
import { addOrExtendStatus } from '../../core/Status';
import { dist, type Vec2 } from '../../core/utils';
import { runHitEffects, UNREALITY_KEY, type HitEffect, type Strike } from '../../effects/classKit';
import { applyControl, applyDebuff, teleport } from '../../effects/effects';
import { swapPlaces } from '../../effects/godKit';
import { R, raise, gear, rule, variants } from './classWave';

const PINK = 0xff5599;
const RIFT = 0xd46bb0;
const TIDE = 0x6fa8e8;

const call = (run: (strike: Strike) => void): HitEffect => ({ k: 'call', run });

/** Half of its single-target spells and basic attacks strike a phantom and do nothing. */
function unreal(strike: Strike, turns: number): void {
  const { victim, ctx } = strike;
  if (victim.alive) applyDebuff(ctx, victim, { name: 'Unreality', key: UNREALITY_KEY, duration: turns, mods: {} });
}

/** Where `p` lands mirrored through the centre of the field. */
function mirrored(p: Vec2): Vec2 {
  return { x: 2 * (FIELD.x + FIELD.w / 2) - p.x, y: 2 * (FIELD.y + FIELD.h / 2) - p.y };
}

/** Thrown through a rift to `at` (the nearest free spot to it). */
function rift(game: GameState, owner: Mage, m: Mage, at: Vec2): void {
  if (!m.alive || game.isImmovable(m) || m.displacementImmune) return;
  game.vfxSink?.godFx?.('rift', m.pos, { size: m.bodyRadius() * 5, color: RIFT });
  teleport(game.quietContext(owner, m), m, game.nearestFreePosition(m, at));
  game.vfxSink?.godFx?.('rift', m.pos, { size: m.bodyRadius() * 5, color: RIFT });
}

// =============================================================================
//  REALITY MIND
// =============================================================================

const doppelganger = raise('doppelganger', {
  name: 'Doppelganger', hp: 10, move: 5, pacifist: true, decoy: 0.5,
  pulse: [{
    k: 'call',
    run: (game, double, owner) => {
      const pressed = game.mages.some((m) => m.alive && m.team !== owner.team && dist(m.pos, owner.pos) <= R(3) + m.bodyRadius());
      if (pressed && swapPlaces(game, owner, owner, double)) game.log(`${owner.name} was never there: it was the double.`);
    },
  }],
  death: [{ k: 'burst', radius: R(4), hits: [{ spec: '2d6', type: 'sanity' }], foes: true, stun: 2 }],
}, {
  dc: 12, color: PINK,
  after: (ctx, double) => {
    double.maxHp = Math.max(1, Math.ceil(ctx.caster.hp / 2));
    double.hp = double.maxHp;
  },
  text: 'It is you, as far as anyone can tell: it rises with half your current health. Every enemy single-target ' +
    'spell or basic attack aimed at you has a 50% chance to strike it instead. At the start of your turns, if an ' +
    'enemy stands within 3cm of you, you and it trade places. When it falls the lie breaks: every enemy within 4cm ' +
    'takes 2d6 sanity and is stunned for 1 turn.',
});
doppelganger.description = doppelganger.description.replace(/HP \d+, /, 'HP half yours, ');

variants(
  ['reality', 'mind'],
  doppelganger,
  gear('crownOfUnreality', {
    name: 'Crown of Unreality', slot: 'trinket',
    turnStart: [{ k: 'hex', radius: R(6), who: 'foes', then: [{ k: 'damage', spec: '1d4', type: 'sanity' }, call((s) => unreal(s, 2))] }],
  }, {
    dc: 12, color: PINK,
    text: 'For the rest of the fight, at the start of your turns every enemy within 6cm of you takes 1d4 sanity and ' +
      'slips out of reality for 2 turns: half of its single-target spells and basic attacks strike a phantom and do nothing.',
  }),
  rule('hallOfMirrors', {
    name: 'Hall of Mirrors',
    turn: {
      who: 'foes',
      then: [call((strike) => {
        const { victim, drinker, ctx } = strike;
        const others = ctx.game.mages.filter((m) => m.alive && m !== victim && !ctx.game.isUnreachable(m));
        if (others.length > 0) swapPlaces(ctx.game, drinker, victim, ctx.game.rng.pick(others));
        unreal(strike, 2);
      })],
    },
  }, {
    dc: 13, color: PINK,
    text: "at the start of each enemy's turn it trades places with another unit chosen at random (on either side), " +
      'and for 2 turns half of its single-target spells and basic attacks strike a phantom and do nothing.',
  })
);

// =============================================================================
//  REALITY WATER
// =============================================================================

/** The way the field tilts this round, shared by everyone it carries. */
const tilts = new WeakMap<GameState, { round: number; dir: Vec2; name: string }>();
const HEADINGS = [
  { dir: { x: 1, y: 0 }, name: 'right' },
  { dir: { x: -1, y: 0 }, name: 'left' },
  { dir: { x: 0, y: 1 }, name: 'down' },
  { dir: { x: 0, y: -1 }, name: 'up' },
];

function tiltOf(game: GameState): { dir: Vec2; name: string } {
  const cached = tilts.get(game);
  if (cached?.round === game.round) return cached;
  const pick = HEADINGS[game.rng.die(4) - 1];
  tilts.set(game, { round: game.round, ...pick });
  game.log(`The field tilts ${pick.name}.`);
  return pick;
}

variants(
  ['reality', 'water'],
  raise('elsewhere-tide', {
    name: 'Tide of Elsewhere', hp: 10, move: 4, pacifist: true,
    pulse: [{
      k: 'hex', radius: R(8), who: 'foes', nearest: true,
      then: [
        call(({ victim, drinker, ctx }) => rift(ctx.game, drinker, victim, mirrored(victim.pos))),
        { k: 'damage', spec: '2d4', type: 'water' },
      ],
    }],
  }, {
    dc: 12, color: TIDE,
    text: 'It cannot attack. At the start of your turns it opens a rift under the nearest enemy within 8cm: the enemy ' +
      'falls through and comes out at the mirrored point on the far side of the field, taking 2d4 water.',
  }),
  gear('tidebreakerMantle', {
    name: 'Tidebreaker Mantle', slot: 'armour', charges: 3,
    deflect: [
      call(({ victim, drinker, ctx }) => {
        const at = { x: FIELD.x + ctx.game.rng.die(FIELD.w), y: FIELD.y + ctx.game.rng.die(FIELD.h) };
        rift(ctx.game, drinker, victim, at);
      }),
      { k: 'damage', spec: '1d6', type: 'water' },
    ],
  }, {
    dc: 12, color: TIDE,
    text: 'The next 3 basic attacks against you never land: each attacker is swept through a rift to a random spot on ' +
      'the field and takes 1d6 water.',
  }),
  rule('worldTilt', {
    name: 'World Tilt',
    roundEnd: {
      then: [call(({ victim, drinker, ctx }) => {
        const { dir } = tiltOf(ctx.game);
        if (victim.team === drinker.team && !victim.movedThisTurn) return;
        ctx.game.forceMove(drinker, victim, { x: victim.x + dir.x * R(4), y: victim.y + dir.y * R(4) });
      })],
    },
  }, {
    dc: 13, color: TIDE,
    text: 'at the end of every round the field tilts toward a random edge and every unit slides 4cm that way, slammed ' +
      'for 2d6 shatter if a wall or the field edge stops it. Units of yours that did not move on their last turn brace ' +
      'and do not slide.',
  })
);

// =============================================================================
//  REALITY MIND WATER
// =============================================================================

variants(
  ['reality', 'mind', 'water'],
  raise('dream-tide', {
    name: 'Dream Tide', hp: 9, move: 4, pacifist: true,
    pulse: [{
      k: 'hex', radius: R(5), who: 'foes',
      then: [
        { k: 'pull', cm: 3 },
        { k: 'damage', spec: '1d4', type: 'sanity' },
        call((strike) => {
          const { victim, drinker, ctx } = strike;
          if (!victim.alive) return;
          const start = victim.turnStartState;
          if (victim.forgotten().length > 0 && start) {
            rift(ctx.game, drinker, victim, { x: start.x, y: start.y });
            ctx.game.log(`${victim.name} wakes where its last turn began.`);
            return;
          }
          runHitEffects(strike, [{ k: 'forget', count: 1, turns: 2 }]);
        }),
      ],
    }],
  }, {
    dc: 13, color: TIDE,
    text: 'It cannot attack. At the start of your turns every enemy within 5cm of it is drawn 3cm toward it and takes ' +
      '1d4 sanity. One that has already forgotten a word is swept back to where its last turn began; every other one ' +
      'forgets a random word for 2 turns.',
  }),
  gear('undertowRobe', {
    name: 'Undertow Robe', slot: 'armour',
    turnStart: [{
      k: 'hex', radius: R(5), who: 'foes',
      then: [
        { k: 'pull', cm: 3 },
        call(({ victim }) => {
          if (victim.alive && !victim.isDebuffImmune()) {
            addOrExtendStatus(victim.statuses, { key: 'reflexStop', name: 'Undertow', kind: 'reflexStop', duration: 2 }, false);
          }
        }),
      ],
    }],
  }, {
    dc: 13, color: TIDE,
    text: 'For the rest of the fight, at the start of your turns every enemy within 5cm of you is dragged 3cm toward ' +
      'you and cannot react until its next turn.',
  }),
  rule('dreamingSea', {
    name: 'The Dreaming Sea',
    turn: {
      who: 'foes',
      then: [
        { k: 'damage', spec: '1d4', type: 'sanity' },
        { k: 'pull', cm: 3 },
        {
          k: 'ifShaken',
          then: [call(({ victim, ctx }) => applyControl(ctx, victim, { name: 'Sleepwalking', mode: 'random', duration: 2 }))],
        },
      ],
    },
  }, {
    dc: 13, color: TIDE,
    text: "at the start of each enemy's turn the dreaming sea takes 1d4 of its sanity and draws it 3cm toward you; an " +
      'enemy at half its sanity or less sleepwalks through that turn: it acts at random.',
  })
);
