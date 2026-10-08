// =============================================================================
//  STOP · CLASS SPELLS
// -----------------------------------------------------------------------------
//  Stop is a blue verb and a command: every one of these may also be cast as a
//  reaction that cancels what it answers. Alone with blue words it disrupts:
//  actions stopped before they begin, clocks that stop, sight that freezes,
//  bodies folded out of time. With colourless words it hurts: wounds held in
//  time that land again, glass that breaks, momentum that kills. Life raises
//  clockwork that stops what is declared near it, Objects lays gear that
//  holds the moment, Hexcraft rewrites how time runs for your enemies.
// =============================================================================

import { dmg, type DamageType } from '../../core/Damage';
import type { GameState } from '../../core/GameState';
import type { Mage } from '../../core/Mage';
import { addOrExtendStatus } from '../../core/Status';
import { dist, stepTowards, type Vec2 } from '../../core/utils';
import { runHitEffects, type HitEffect, type Strike } from '../../effects/classKit';
import { swapPlaces } from '../../effects/godKit';
import { applyInvisibility, applyStun, dealDamage, teleport } from '../../effects/effects';
import type { ClassSpellVariant } from '../registry';
import { gear, R, raise, rule, variants } from './classWave';

const ICE = 0x9ee7ff;
const CLOCK = 0xa8e0ff;
const GLASS = 0xd8f0ff;

/** Every Stop class spell is also an answer. */
function answer(v: ClassSpellVariant): ClassSpellVariant {
  return {
    ...v,
    reaction: true,
    counters: true,
    description: `${v.description} As a reaction, also cancel the answered action.`,
  };
}

function stopVariants(words: Parameters<typeof variants>[0], life: ClassSpellVariant, objects: ClassSpellVariant, hexcraft: ClassSpellVariant): void {
  variants(words, answer(life), answer(objects), answer(hexcraft));
}

const call = (run: (strike: Strike) => void): HitEffect => ({ k: 'call', run });

// ---- Time, held and broken ------------------------------------------------------

/** Frozen in time: it loses its next turn, and what it takes meanwhile is held until time resumes. */
function freeze(game: GameState, owner: Mage, m: Mage, release?: { spec: string; type: DamageType }): void {
  if (!m.alive || game.isTimeStopped(m)) return;
  if (game.stopTime(owner, m, { turns: 1, release })) game.vfxSink?.godFx?.('sphere', m.pos, { size: m.bodyRadius() * 5, color: ICE });
}

/** Sealed in glass until the end of its next turn: it loses that turn and nothing reaches it; the glass breaks over its side. */
function coffin(game: GameState, owner: Mage, m: Mage, spec: string): void {
  if (!m.alive || game.isTimeStopped(m)) return;
  if (game.stopTime(owner, m, { turns: 1, sanctuary: true, burst: { spec, type: 'shatter', radius: R(3) } })) {
    game.vfxSink?.godFx?.('sphere', m.pos, { size: m.bodyRadius() * 5, color: GLASS });
  }
}

/** A status that holds unless the unit shrugs off debuffs. */
function afflict(m: Mage, key: string, name: string, kind: 'clockStopped' | 'reflexStop' | 'stillOath' | 'fixedPoint', turns: number): void {
  if (!m.alive || m.isDebuffImmune()) return;
  addOrExtendStatus(m.statuses, { key, name, kind, duration: turns }, false);
}

const stopClock = (m: Mage, turns: number): void => afflict(m, 'clockStopped', 'Stopped Clock', 'clockStopped', turns);
const numb = (m: Mage, turns: number): void => afflict(m, 'reflexStop', 'Frozen Reflexes', 'reflexStop', turns);

/** Nailed in place: it cannot walk or be moved by anything, and it cannot dodge. */
function nail(game: GameState, m: Mage, turns: number): void {
  if (!m.alive || m.isDebuffImmune()) return;
  afflict(m, 'fixedPoint', 'Fixed Point', 'fixedPoint', turns);
  applyStun(game.quietContext(m, m), m, { duration: turns, type: 'movement', key: 'stun:fixed-point' });
  game.vfxSink?.godFx?.('warp', m.pos, { size: m.bodyRadius() * 4 });
}

function veil(game: GameState, m: Mage, mode: 'full' | 'partial'): void {
  if (m.alive) applyInvisibility(game.quietContext(m, m), m, { duration: 1, mode });
}

/** Its picture of the field freezes: it cannot target anything that has since moved more than 2cm. */
function freezeSight(game: GameState, m: Mage, turns: number): void {
  if (!m.alive || m.isDebuffImmune()) return;
  const positions: Record<number, Vec2> = {};
  game.mages.forEach((u, i) => {
    if (u.alive) positions[i] = { x: u.x, y: u.y };
  });
  addOrExtendStatus(m.statuses, { key: 'frozenPerception', name: 'Frozen Perception', kind: 'frozenPerception', duration: turns, positions }, false);
}

/** Up to 5 dice of shatter, one for every 2cm `m` moved since its turn began. */
function momentum(game: GameState, owner: Mage, m: Mage, label: string): void {
  const start = m.turnStartState;
  const dice = start ? Math.min(5, Math.floor(dist(start, m.pos) / R(2))) : 0;
  if (dice <= 0 || !m.alive) return;
  dealDamage(game.quietContext(owner, m), m, dmg(game.showRoll(`${dice}d6`, label, m).total, 'shatter'), { canMiss: false, aoe: true });
}

/** A wound held in time: it lands again, whole, at the start of the target's next turns. */
const held = (turns: number, type: DamageType = 'pierce'): HitEffect => ({ k: 'dot', name: 'Held Wound', pct: 1, turns, type });
const slam = { spec: '2d6', type: 'shatter' as const };

/** Per-unit counters (wind-ups, cracks, hourglass turns). Deterministic, but not saved with a scenario. */
function tick(counter: WeakMap<object, number>, of: object): number {
  const n = (counter.get(of) ?? 0) + 1;
  counter.set(of, n);
  return n;
}
const windUps = new WeakMap<object, number>();
const cracks = new WeakMap<object, number>();
const hourglassTurns = new WeakMap<object, number>();

// =============================================================================
//  TWO WORDS
// =============================================================================

stopVariants(
  ['stop', 'veil'],
  raise('hush-warden', {
    name: 'Hush Warden', hp: 10, move: 4, pacifist: true,
    stops: { radius: R(6), then: [call(({ drinker, ctx }) => veil(ctx.game, drinker, 'full'))] },
  }, {
    dc: 12, color: ICE,
    text: 'It cannot attack. Once a round, when an enemy within 6cm of it declares anything but a move, that action ' +
      'is stopped before it begins, and you vanish into a full veil until your next turn.',
  }),
  gear('stillcloak', {
    name: 'Stillcloak', slot: 'armour',
    stops: { then: [call(({ drinker, ctx }) => veil(ctx.game, drinker, 'full'))] },
  }, {
    dc: 12, color: ICE,
    text: 'For the rest of the fight, once a round, the first single-target spell or basic attack an enemy aims at you ' +
      'is stopped before it begins, and you vanish into a full veil until your next turn.',
  }),
  rule('frozenWitness', {
    name: 'Frozen Witness',
    turn: {
      then: [call(({ victim, drinker, ctx }) => {
        if (victim.team === drinker.team) veil(ctx.game, victim, 'partial');
        else freezeSight(ctx.game, victim, 2);
      })],
    },
  }, {
    dc: 13, color: ICE,
    text: "at the start of each of your enemies' turns its picture of the field freezes: until its next turn it " +
      'cannot target anything that has moved more than 2cm since. Each unit on your side begins its turns in a half veil.',
  })
);

stopVariants(
  ['stop', 'bind'],
  raise('clockwork-jailer', {
    name: 'Clockwork Jailer', hp: 12, move: 3, armor: 1, pacifist: true,
    stops: { radius: R(5), then: [{ k: 'root', turns: 2 }, call(({ victim }) => stopClock(victim, 2))] },
  }, {
    dc: 12, color: CLOCK,
    text: 'It cannot attack. Once a round, when an enemy within 5cm of it declares anything but a move, that action ' +
      'is stopped before it begins; the enemy is rooted for 2 turns and its clock stops for 2 turns (nothing on it wears off).',
  }),
  gear('shackleOfSeconds', {
    name: 'Shackle of Seconds', slot: 'weapon',
    onHit: [
      { k: 'ifRooted', then: [call(({ victim, drinker, ctx }) => freeze(ctx.game, drinker, victim))], else: [{ k: 'root', turns: 2 }] },
      call(({ victim }) => stopClock(victim, 2)),
    ],
  }, {
    dc: 12, color: CLOCK,
    text: "For the rest of the fight, your landed basic attacks stop the target's clock for 2 turns (nothing on it " +
      'wears off) and root it for 2 turns; a target already rooted is frozen in time instead: it loses its next turn, ' +
      'and damage it takes meanwhile is held until time resumes.',
  }),
  rule('longSecond', {
    name: 'The Long Second',
    turn: { who: 'foes', then: [call(({ victim }) => afflict(victim, 'stillOath', 'The Long Second', 'stillOath', 2))] },
  }, {
    dc: 13, color: CLOCK,
    text: 'your enemies get one action a turn: once one of them acts (anything but a move), the rest of its turn is gone.',
  })
);

stopVariants(
  ['stop', 'pierce'],
  raise('second-hand', {
    name: 'Second Hand', hp: 8, move: 3, pacifist: true,
    pulse: [{ k: 'shoot', radius: R(10), hits: [{ spec: '1d6', type: 'pierce' }], then: [held(1)] }],
    stops: { radius: R(3), then: [{ k: 'damage', spec: '1d6', type: 'pierce' }] },
  }, {
    dc: 12, color: CLOCK,
    text: 'It cannot attack. At the start of your turns it shoots the nearest enemy within 10cm for 1d6 pierce, and ' +
      "the wound is held in time: it lands again, whole, at the start of that enemy's next turn. Once a round, when an " +
      'enemy within 3cm of it declares anything but a move, that action is stopped before it begins and the enemy ' +
      'takes 1d6 pierce.',
  }),
  gear('hourglassStiletto', {
    name: 'Hourglass Stiletto', slot: 'weapon',
    onHit: [held(2)],
  }, {
    dc: 12, color: CLOCK,
    text: 'For the rest of the fight, every wound your basic attacks deal is held in time: it lands again, whole, as ' +
      "pierce at the start of each of the target's next 2 turns.",
  }),
  rule('arrestedMoment', {
    name: 'Arrested Moment',
    hit: { types: ['pierce'], who: 'foes', then: [held(1)] },
  }, {
    dc: 13, color: CLOCK,
    text: 'every pierce wound on one of your enemies is held in time: it lands again, whole, at the start of its next turn.',
  })
);

stopVariants(
  ['stop', 'shatter'],
  raise('shatterwarden', {
    name: 'Shatterwarden', hp: 12, move: 3, armor: 1, pacifist: true,
    stops: { radius: R(5), then: [{ k: 'damage', spec: '2d6', type: 'shatter' }, { k: 'stun', turns: 2 }] },
  }, {
    dc: 12, color: GLASS,
    text: 'It cannot attack. Once a round, when an enemy within 5cm of it declares anything but a move, that action ' +
      'is stopped before it begins; the enemy takes 2d6 shatter and is stunned for 1 turn.',
  }),
  gear('shatterclock', {
    name: 'Shatterclock Hammer', slot: 'weapon', charges: 3,
    onHit: [call(({ victim, drinker, ctx }) => freeze(ctx.game, drinker, victim, { spec: '2d6', type: 'shatter' }))],
  }, {
    dc: 12, color: GLASS,
    text: 'Your next 3 landed basic attacks freeze the target in time: it loses its next turn, damage it takes ' +
      'meanwhile is held, and when time resumes it takes all of it at once plus 2d6 shatter.',
  }),
  rule('brittleTime', {
    name: 'Brittle Time',
    turnEnd: {
      who: 'foes',
      then: [call(({ victim, drinker, ctx }) => {
        if (!victim.movedThisTurn) freeze(ctx.game, drinker, victim, { spec: '2d6', type: 'shatter' });
      })],
    },
  }, {
    dc: 13, color: GLASS,
    text: 'an enemy that ends its turn without having moved is frozen in time: it loses its next turn, damage it ' +
      'takes meanwhile is held, and when time resumes it takes all of it at once plus 2d6 shatter.',
  })
);

stopVariants(
  ['stop', 'twist'],
  raise('pendulum', {
    name: 'Pendulum', hp: 10, move: 2, pacifist: true,
    pulse: [{ k: 'hex', radius: R(4), who: 'foes', then: [{ k: 'orbit', slam }, { k: 'stifle' }] }],
  }, {
    dc: 12, color: ICE,
    text: 'It cannot attack. At the start of your turns it swings: every enemy within 4cm of it is turned a quarter ' +
      'circle around it (2d6 shatter if a wall or the field edge stops it), and its next action other than moving fails.',
  }),
  gear('mobiusLoop', {
    name: 'Möbius Loop', slot: 'trinket', charges: 3,
    turnEnd: [{
      k: 'call',
      run: (game, bearer) => {
        const start = bearer.turnStartState;
        if (!start || !bearer.alive) return;
        if (!game.isImmovable(bearer) && dist(start, bearer.pos) > 1) teleport(game.quietContext(bearer, bearer), bearer, { x: start.x, y: start.y });
        bearer.hp = Math.min(bearer.maxHp, Math.max(bearer.hp, start.hp));
        bearer.sanity = Math.min(bearer.maxSanity, Math.max(bearer.sanity, start.sanity));
        game.log(`${bearer.name}'s turn loops back on itself.`);
        game.vfxSink?.godFx?.('rift', bearer.pos, { size: bearer.bodyRadius() * 5 });
      },
    }],
  }, {
    dc: 12, color: ICE,
    text: 'The next 3 times you end your turn, time loops: you return to where you began that turn, and any health or ' +
      'sanity you lost during it comes back.',
  }),
  rule('pendulumLaw', {
    name: 'The Pendulum',
    roundEnd: {
      who: 'foes',
      then: [{ k: 'orbit', slam, onSlam: [call(({ victim, drinker, ctx }) => freeze(ctx.game, drinker, victim))] }],
    },
  }, {
    dc: 13, color: ICE,
    text: 'at the end of every round each of your enemies is turned a quarter circle around you; one stopped by a ' +
      'wall or the field edge takes 2d6 shatter and is frozen in time for its next turn.',
  })
);

// =============================================================================
//  THREE WORDS
// =============================================================================

stopVariants(
  ['stop', 'veil', 'bind'],
  raise('still-warden', {
    name: 'Warden of the Still Hour', hp: 12, move: 3, pacifist: true,
    stops: {
      radius: R(5),
      then: [
        { k: 'root', turns: 2 },
        call(({ victim, drinker, ctx }) => {
          if (!victim.alive || victim.isDebuffImmune()) return;
          addOrExtendStatus(victim.statuses, {
            key: 'phaseOut', name: 'Folded Out of Time', kind: 'phaseOut', duration: 2, mode: 'banished',
            ownerIndex: ctx.game.mages.indexOf(drinker), ownerTeam: drinker.team,
          }, false);
          ctx.game.vfxSink?.godFx?.('void', victim.pos, { size: victim.bodyRadius() * 5 });
        }),
      ],
    },
  }, {
    dc: 14, color: ICE,
    text: 'It cannot attack. Once a round, when an enemy within 5cm of it declares anything but a move, that action ' +
      'is stopped before it begins, and the enemy is folded out of time until the end of its next turn: rooted, it ' +
      'cannot act, be targeted or be harmed.',
  }),
  gear('veilOfStillness', {
    name: 'Veil of Stillness', slot: 'armour', charges: 3,
    deflect: [{ k: 'root', turns: 2 }, call(({ drinker, ctx }) => veil(ctx.game, drinker, 'full'))],
  }, {
    dc: 14, color: ICE,
    text: 'The next 3 basic attacks against you are stopped: each attacker is rooted for 2 turns, and you vanish into ' +
      'a full veil until your next turn.',
  }),
  rule('stillHour', {
    name: 'The Still Hour',
    turnEnd: {
      then: [call(({ victim, drinker, ctx }) => {
        if (victim.team === drinker.team) veil(ctx.game, victim, 'partial');
        else if (victim.isStunned('movement')) freeze(ctx.game, drinker, victim);
      })],
    },
  }, {
    dc: 14, color: ICE,
    text: 'an enemy that ends its turn rooted is frozen in time for its next turn (damage it takes meanwhile is held ' +
      'until time resumes), and each unit on your side ends its turns in a half veil.',
  })
);

stopVariants(
  ['stop', 'veil', 'pierce'],
  raise('silent-needle', {
    name: 'Silent Needle', hp: 6, move: 6, melee: { spec: '1d6', type: 'pierce' },
    onHit: [call(({ victim }) => numb(victim, 2))],
    pulse: [{ k: 'lunge', radius: R(6), hits: [{ spec: '1d6', type: 'pierce' }], then: [call(({ victim }) => numb(victim, 2))] }],
  }, {
    dc: 14, color: CLOCK,
    text: 'It strikes for 1d6 pierce. At the start of your turns it darts to the nearest enemy within 6cm and strikes ' +
      'it for 1d6 pierce. Anything it strikes cannot react for 2 turns.',
  }),
  gear('unseenSecond', {
    name: 'Unseen Second', slot: 'weapon',
    onHit: [{ k: 'damage', spec: '1d4', type: 'pierce' }, call(({ victim }) => numb(victim, 2)), { k: 'veilSelf', turns: 1 }],
  }, {
    dc: 14, color: CLOCK,
    text: 'For the rest of the fight, your landed basic attacks deal 1d4 more pierce and leave the target unable to ' +
      'react for 2 turns, and you slip into a half veil until your next turn.',
  }),
  rule('numbReflexes', {
    name: 'Numb Reflexes',
    turn: { who: 'foes', then: [call(({ victim }) => numb(victim, 2))] },
    hit: { types: ['pierce'], who: 'foes', then: [{ k: 'stifle' }] },
  }, {
    dc: 14, color: CLOCK,
    text: 'your enemies cannot react at all, and every pierce hit on one of them makes its next action other than moving fail.',
  })
);

stopVariants(
  ['stop', 'veil', 'shatter'],
  raise('glass-wraith', {
    name: 'Glass Wraith', hp: 9, move: 5, pacifist: true,
    stops: { radius: R(4), then: [call(({ victim, drinker, ctx }) => coffin(ctx.game, drinker, victim, '3d6'))] },
  }, {
    dc: 14, color: GLASS,
    text: 'It cannot attack. Once a round, when an enemy within 4cm of it declares anything but a move, that action ' +
      'is stopped before it begins, and the enemy is sealed in glass until the end of its next turn: it loses that ' +
      'turn and nothing can target or harm it. When the glass breaks, your enemies within 3cm of it take 3d6 shatter.',
  }),
  gear('mirrorOfStoppedTime', {
    name: 'Mirror of Stopped Time', slot: 'armour', charges: 2,
    deflect: [call(({ victim, drinker, ctx }) => coffin(ctx.game, drinker, victim, '2d6'))],
  }, {
    dc: 14, color: GLASS,
    text: 'The next 2 basic attacks against you are stopped, and each attacker is sealed in glass until the end of its ' +
      'next turn: it loses that turn and nothing can reach it. When the glass breaks, your enemies within 3cm of it ' +
      'take 2d6 shatter.',
  }),
  rule('glassHour', {
    name: 'The Glass Hour',
    turnEnd: {
      who: 'foes',
      then: [call(({ victim, drinker, ctx }) => {
        if (ctx.game.rng.die(3) === 1) coffin(ctx.game, drinker, victim, '3d6');
      })],
    },
  }, {
    dc: 14, color: GLASS,
    text: 'an enemy that ends its turn has a 1 in 3 chance to be sealed in glass until the end of its next turn: it ' +
      'loses that turn and nothing can reach it. When the glass breaks, your enemies within 3cm take 3d6 shatter.',
  })
);

stopVariants(
  ['stop', 'veil', 'twist'],
  raise('mirage-clock', {
    name: 'Mirage Clock', hp: 8, move: 5, pacifist: true,
    pulse: [{
      k: 'call',
      run: (game, clock, owner) => {
        const foe = game.mages
          .filter((m) => m.alive && m.team !== owner.team && !game.isUnreachable(m) && dist(m.pos, clock.pos) <= R(6) + m.bodyRadius())
          .sort((a, b) => dist(a.pos, clock.pos) - dist(b.pos, clock.pos))[0];
        if (!foe) return;
        swapPlaces(game, owner, clock, foe);
        runHitEffects({ striker: clock, victim: foe, dealt: 0, drinker: owner, ctx: game.quietContext(clock, foe) }, [{ k: 'stifle' }]);
      },
    }],
  }, {
    dc: 14, color: ICE,
    text: 'It cannot attack. At the start of your turns it trades places with the nearest enemy within 6cm, and that ' +
      "enemy's next action other than moving fails.",
  }),
  gear('turncoatVeil', {
    name: 'Turncoat Veil', slot: 'armour', charges: 3,
    deflect: [{ k: 'orbit', slam }, { k: 'stifle' }],
  }, {
    dc: 14, color: ICE,
    text: 'The next 3 basic attacks against you are stopped: each attacker is turned a quarter circle around you ' +
      '(2d6 shatter if a wall or the field edge stops it), and its next action other than moving fails.',
  }),
  rule('lostTime', {
    name: 'Lost Time',
    turnEnd: {
      who: 'foes',
      then: [call(({ victim, drinker, ctx }) => {
        const start = victim.turnStartState;
        if (!start || ctx.game.isImmovable(victim) || dist(start, victim.pos) < R(0.5)) return;
        const back = stepTowards(victim.pos, start, dist(start, victim.pos) / 2);
        teleport(ctx.game.quietContext(drinker, victim), victim, back);
        ctx.game.log(`Half of ${victim.name}'s turn never happened.`);
      })],
    },
  }, {
    dc: 14, color: ICE,
    text: 'half of every enemy turn never happens: an enemy ending its turn is carried halfway back to where it began it.',
  })
);

stopVariants(
  ['stop', 'bind', 'pierce'],
  raise('pinning-clockwork', {
    name: 'Pinning Clockwork', hp: 9, move: 4, melee: { spec: '1d6', type: 'pierce', reach: R(2) },
    onHit: [{ k: 'root', turns: 2 }, call(({ victim }) => stopClock(victim, 2))],
    stops: { radius: R(4), then: [call(({ victim, ctx }) => nail(ctx.game, victim, 2))] },
  }, {
    dc: 14, color: CLOCK,
    text: 'It strikes from 2cm for 1d6 pierce, rooting the target for 2 turns and stopping its clock for 2 turns ' +
      '(nothing on it wears off). Once a round, when an enemy within 4cm of it declares anything but a move, that ' +
      'action is stopped before it begins, and the enemy is nailed in place for 2 turns: it cannot walk or be moved, and it cannot dodge.',
  }),
  gear('needleOfTheHour', {
    name: 'Needle of the Hour', slot: 'weapon',
    onHit: [{ k: 'damage', spec: '1d4', type: 'pierce' }, call(({ victim, ctx }) => nail(ctx.game, victim, 2))],
  }, {
    dc: 14, color: CLOCK,
    text: 'For the rest of the fight, your landed basic attacks deal 1d4 more pierce and nail the target in place for ' +
      '2 turns: it cannot walk or be moved, and it cannot dodge.',
  }),
  rule('pinnedHour', {
    name: 'The Pinned Hour',
    hit: { types: ['pierce'], who: 'foes', then: [{ k: 'ifRooted', then: [held(1)], else: [{ k: 'root', turns: 2 }] }] },
  }, {
    dc: 14, color: CLOCK,
    text: 'every pierce hit roots an enemy for 2 turns; on one already rooted the wound is held in time instead: it ' +
      'lands again, whole, at the start of its next turn.',
  })
);

stopVariants(
  ['stop', 'bind', 'shatter'],
  raise('stasis-bell', {
    name: 'Stasis Bell', hp: 12, move: 2, pacifist: true,
    pulse: [{
      k: 'hex', radius: R(5), who: 'foes',
      then: [call(({ victim, drinker, ctx }) => momentum(ctx.game, drinker, victim, 'Stasis Bell')), { k: 'root', turns: 2 }],
    }],
  }, {
    dc: 14, color: GLASS,
    text: 'It cannot attack. At the start of your turns it tolls and everything near it stops dead: every enemy within ' +
      '5cm of it takes 1d6 shatter for every 2cm it moved since its last turn began (up to 5d6) and is rooted for 2 turns.',
  }),
  gear('frozenPlate', {
    name: 'Frozen Plate', slot: 'armour',
    onStruck: [{
      k: 'ifRooted',
      then: [call(({ victim, drinker, ctx }) => freeze(ctx.game, drinker, victim, { spec: '2d6', type: 'shatter' }))],
      else: [{ k: 'root', turns: 2 }],
    }],
  }, {
    dc: 14, color: GLASS,
    text: 'For the rest of the fight, a unit landing a basic attack on you is rooted for 2 turns; one already rooted ' +
      'is frozen in time instead: it loses its next turn, and when time resumes it takes everything held plus 2d6 shatter.',
  }),
  rule('conservedMomentum', {
    name: 'Conservation of Momentum',
    turnEnd: { who: 'foes', then: [call(({ victim, drinker, ctx }) => momentum(ctx.game, drinker, victim, 'Momentum'))] },
  }, {
    dc: 14, color: GLASS,
    text: 'an enemy ending its turn stops dead: it takes 1d6 shatter for every 2cm it moved during that turn (up to 5d6).',
  })
);

stopVariants(
  ['stop', 'bind', 'twist'],
  raise('gyroscope', {
    name: 'Gyroscope', hp: 10, move: 3, pacifist: true,
    pulse: [{
      k: 'hex', radius: R(3), who: 'foes',
      then: [
        { k: 'orbit', slam, onSlam: [call(({ victim, drinker, ctx }) => freeze(ctx.game, drinker, victim))] },
        { k: 'root', turns: 2 },
      ],
    }],
  }, {
    dc: 14, color: ICE,
    text: 'It cannot attack. At the start of your turns every enemy within 3cm of it is turned a quarter circle around ' +
      'it and rooted for 2 turns; one stopped by a wall or the field edge takes 2d6 shatter and is frozen in time for its next turn.',
  }),
  gear('torqueShackle', {
    name: 'Torque Shackle', slot: 'weapon',
    onHit: [
      { k: 'orbit', slam, onSlam: [call(({ victim, drinker, ctx }) => freeze(ctx.game, drinker, victim))] },
      { k: 'root', turns: 2 },
    ],
  }, {
    dc: 14, color: ICE,
    text: 'For the rest of the fight, your landed basic attacks turn the target a quarter circle around you and root ' +
      'it for 2 turns; one stopped by a wall or the field edge takes 2d6 shatter and is frozen in time for its next turn.',
  }),
  rule('gearwork', {
    name: 'The Gearwork',
    turn: { who: 'foes', then: [{ k: 'orbit', slam }, call(({ victim }) => numb(victim, 2))] },
  }, {
    dc: 14, color: ICE,
    text: 'you are the axle the field turns on: at the start of each enemy turn, that enemy is turned a quarter circle ' +
      'around you (2d6 shatter if a wall or the field edge stops it) and cannot react until its next turn.',
  })
);

stopVariants(
  ['stop', 'pierce', 'shatter'],
  raise('clockwork-ballista', {
    name: 'Clockwork Ballista', hp: 10, move: 2, pacifist: true,
    pulse: [{
      k: 'call',
      run: (game, ballista, owner) => {
        if (tick(windUps, ballista) % 3 !== 0) {
          game.log(`${ballista.name} winds up.`);
          return;
        }
        const foe = game.mages
          .filter((m) => m.alive && m.team !== owner.team && !game.isUnreachable(m))
          .sort((a, b) => dist(a.pos, ballista.pos) - dist(b.pos, ballista.pos))[0];
        if (!foe) return;
        const ctx = game.quietContext(ballista, foe);
        game.log(`${ballista.name} looses a bolt through time at ${foe.name}.`);
        game.vfxSink?.godFx?.('rift', foe.pos, { size: foe.bodyRadius() * 6 });
        dealDamage(ctx, foe, dmg(game.showRoll('3d6', 'Clockwork Ballista', foe).total, 'pierce'), { canMiss: false });
        if (foe.alive) dealDamage(ctx, foe, dmg(game.showRoll('3d6', 'Clockwork Ballista', foe).total, 'shatter'), { canMiss: false });
        freeze(game, owner, foe);
      },
    }],
  }, {
    dc: 14, color: GLASS,
    text: 'It cannot attack. It winds up over 2 of your turns; at the start of the third it looses a bolt through time ' +
      'at the nearest enemy anywhere on the field: 3d6 pierce and 3d6 shatter, and the target is frozen in time for its ' +
      'next turn. Then it winds up again.',
  }),
  gear('breakpoint', {
    name: 'Breakpoint', slot: 'weapon',
    onHit: [call(({ victim, drinker, ctx }) => {
      if (!victim.alive) return;
      const n = tick(cracks, victim) % 3;
      if (n !== 0) {
        ctx.game.log(`${victim.name} cracks toward its breakpoint (${n}/3).`);
        return;
      }
      ctx.game.log(`${victim.name} reaches its breakpoint.`);
      ctx.game.vfxSink?.shatterBurst?.(victim.pos, victim.bodyRadius() * 4, drinker.pos);
      const q = ctx.game.quietContext(drinker, victim);
      dealDamage(q, victim, dmg(ctx.game.showRoll('3d6', 'Breakpoint', victim).total, 'pierce'), { canMiss: false });
      if (victim.alive) dealDamage(q, victim, dmg(ctx.game.showRoll('3d6', 'Breakpoint', victim).total, 'shatter'), { canMiss: false });
    })],
  }, {
    dc: 14, color: GLASS,
    text: 'For the rest of the fight, every third basic attack you land on the same unit reaches its breakpoint: it ' +
      'takes 3d6 pierce and 3d6 shatter on top.',
  }),
  rule('fractureInTime', {
    name: 'Fracture in Time',
    hit: {
      who: 'foes',
      then: [call((strike) => {
        if (strike.dealt >= 5) runHitEffects(strike, [{ k: 'dot', name: 'Fracture', pct: 1, turns: 1, type: 'shatter' }]);
      })],
    },
  }, {
    dc: 14, color: GLASS,
    text: 'every hit of 5 or more on one of your enemies is held in time: it lands again, whole, as shatter at the start of its next turn.',
  })
);

stopVariants(
  ['stop', 'pierce', 'twist'],
  raise('clockhand-duelist', {
    name: 'Clockhand Duelist', hp: 9, move: 5, melee: { spec: '1d6', type: 'pierce' },
    onHit: [{ k: 'orbit', slam }],
    stops: { radius: R(3), then: [{ k: 'damage', spec: '1d6', type: 'pierce' }, { k: 'orbit', slam }] },
  }, {
    dc: 14, color: CLOCK,
    text: 'It strikes for 1d6 pierce and turns the target a quarter circle around itself (2d6 shatter if a wall or ' +
      'the field edge stops it). Once a round, when an enemy within 3cm of it declares anything but a move, that ' +
      'action is stopped before it begins, and the duelist strikes and turns it the same way.',
  }),
  gear('tickingRapier', {
    name: 'Ticking Rapier', slot: 'weapon',
    onHit: [
      { k: 'orbit', slam, onSlam: [call(({ victim, drinker, ctx }) => freeze(ctx.game, drinker, victim))] },
      call(({ victim }) => numb(victim, 2)),
    ],
  }, {
    dc: 14, color: CLOCK,
    text: 'For the rest of the fight, your landed basic attacks turn the target a quarter circle around you and leave ' +
      'it unable to react for 2 turns; one stopped by a wall or the field edge takes 2d6 shatter and is frozen in time for its next turn.',
  }),
  rule('clockwise', {
    name: 'Clockwise',
    hit: { types: ['pierce'], who: 'foes', then: [{ k: 'orbit', slam }, call(({ victim }) => numb(victim, 2))] },
  }, {
    dc: 14, color: CLOCK,
    text: 'every pierce hit turns its target a quarter circle around its attacker (2d6 shatter if a wall or the field ' +
      'edge stops it) and leaves it unable to react for 2 turns.',
  })
);

const golemFuse = new WeakMap<Mage, number>();

stopVariants(
  ['stop', 'shatter', 'twist'],
  raise('hourglass-golem', {
    name: 'Hourglass Golem', hp: 14, move: 2, armor: 1, pacifist: true,
    pulse: [
      { k: 'mire', radius: R(5), pct: 0.5, turns: 2 },
      {
        k: 'call',
        run: (game, golem, owner) => {
          const fuse = (golemFuse.get(golem) ?? 0) + 1;
          golemFuse.set(golem, fuse);
          if (fuse < 3) game.log(`${golem.name}'s sand runs low (${3 - fuse} left).`);
          else game.defeatMage(golem, owner, `${golem.name}'s glass gives way.`);
        },
      },
    ],
    death: [{ k: 'burst', radius: R(5), hits: [{ spec: '4d6', type: 'shatter' }], foes: true, stun: 2 }],
  }, {
    dc: 14, color: GLASS,
    text: 'It cannot attack. Time thickens around it: at the start of your turns, enemies within 5cm of it move 50% ' +
      'slower for 2 turns. At the start of your third turn after it rises, or as soon as it is destroyed, it shatters: ' +
      'every enemy within 5cm of it takes 4d6 shatter and is stunned for 1 turn.',
  }),
  gear('twistedHourglass', {
    name: 'Twisted Hourglass', slot: 'trinket',
    turnStart: [{
      k: 'call',
      run: (game, bearer) => {
        const foes = game.mages.filter((m) => m.alive && m.team !== bearer.team && !game.isUnreachable(m));
        if (tick(hourglassTurns, bearer) % 2 === 1) {
          const near = foes.filter((m) => dist(m.pos, bearer.pos) <= R(5) + m.bodyRadius())
            .sort((a, b) => dist(a.pos, bearer.pos) - dist(b.pos, bearer.pos))[0];
          if (near) freeze(game, bearer, near, { spec: '1d6', type: 'shatter' });
          return;
        }
        game.vfxSink?.shatterBurst?.(bearer.pos, R(3));
        for (const m of foes) {
          if (dist(m.pos, bearer.pos) > R(3) + m.bodyRadius()) continue;
          dealDamage(game.quietContext(bearer, m), m, dmg(game.rng.roll('2d6').total, 'shatter'), { canMiss: false, aoe: true });
        }
      },
    }],
  }, {
    dc: 14, color: GLASS,
    text: 'For the rest of the fight the hourglass turns at the start of each of your turns, every other way round. ' +
      'One turn, time stops for the nearest enemy within 5cm: it loses its next turn, and when time resumes it takes ' +
      'everything held plus 1d6 shatter. The next, it breaks around you: every enemy within 3cm takes 2d6 shatter.',
  }),
  rule('brokenClock', {
    name: 'The Broken Clock',
    refilled: {
      who: 'foes',
      then: [call(({ victim, drinker, ctx }) => {
        const roll = ctx.game.showRoll('1d6', 'The Broken Clock', victim).total;
        if (roll <= 2) victim.actions.main = 0;
        else if (roll <= 4) victim.actions.move = 0;
        else if (roll === 5) victim.actions.bonus = 0;
        else runHitEffects({ striker: drinker, victim, dealt: 0, drinker, ctx }, [{ k: 'orbit', slam }, { k: 'damage', spec: '2d6', type: 'shatter' }]);
        ctx.game.log(
          `The clock skips for ${victim.name}: ${roll <= 2 ? 'no main action' : roll <= 4 ? 'no move' : roll === 5 ? 'no bonus action' : 'it is wrenched around'}.`
        );
      })],
    },
  }, {
    dc: 14, color: GLASS,
    text: "at the start of each enemy's turn the clock skips: roll 1d6. On 1-2 it loses its main action, on 3-4 its " +
      'move, on 5 its bonus action, and on a 6 it is turned a quarter circle around you (2d6 shatter if a wall stops ' +
      'it) and takes 2d6 shatter.',
  })
);
