// =============================================================================
//  DESECRATE · CLASS SPELLS
// -----------------------------------------------------------------------------
//  Desecrate is black and godly: it fouls the ground, raises the dead and
//  starves the living of healing. Most of these harm the caster's enemies
//  directly; some still keep the old Desecrate rule and spare black units and
//  minions ("affected units"), and some do both, harder on the unhallowed.
//  Life raises things that spread corruption, Objects lays gear that turns
//  its wearer or its victims into a plague, Hexcraft lays laws of famine,
//  stakes, plague and the walking dead.
// =============================================================================

import { FIELD, MOVE_RANGE } from '../../config/constants';
import { dmg } from '../../core/Damage';
import type { DesecrationField, DesecrationTick, GameState } from '../../core/GameState';
import type { Mage } from '../../core/Mage';
import { addOrExtendStatus, type DotStatus } from '../../core/Status';
import { dist, type Vec2 } from '../../core/utils';
import { drink, runHitEffects, type HitEffect, type RotSpec, type RuleLawKind, type Strike } from '../../effects/classKit';
import { applyDebuff, applyDot, dealDamage, heal, rollDice, type EffectContext } from '../../effects/effects';
import { UNBURIED } from '../../effects/godKit';
import type { ClassSpellVariant } from '../registry';
import { AFFECTED, gear, LAW_ROUNDS, R, raise, rule, variants } from './classWave';

const BONE = 0x9b8f7a;
const ROT = 0x6e8d4d;
const GRAVE = 0x6e4d7d;
const BLOOD = 0x9a3b4a;

const call = (run: (strike: Strike) => void): HitEffect => ({ k: 'call', run });

type Foul = Omit<DesecrationField, 'id' | 'x' | 'y' | 'ownerIndex' | 'ownerTeam'>;

/** Hostile fouled ground: it harms the owner's enemies and none of them can be healed on it. */
function foul(game: GameState, owner: Mage, at: Vec2, opts: Omit<Foul, 'hostile' | 'blocksHealing'>): DesecrationField {
  return game.addDesecrationField(at, owner, { hostile: true, blocksHealing: true, ...opts });
}

/** Overlapping patches of one law's ground bite a unit once (a grower index no minion can have). */
const lawGround = (game: GameState, owner: Mage): number => -1 - game.mages.indexOf(owner);

/** Rounds the law of `kind` has stood. */
function stood(game: GameState, kind: RuleLawKind): number {
  return LAW_ROUNDS - (game.hexLaw(kind)?.roundsLeft ?? LAW_ROUNDS);
}

const afflictions = (m: Mage): number => m.statuses.filter((s) => s.kind === 'dot').length;

/** Fouled ground worn by its caster for a while; a fresh one replaces the old. */
function wornGround(
  name: string,
  o: { dc: number; color: number; text: string; turns: (ctx: EffectContext) => number; field: Omit<Foul, 'name' | 'turnsLeft' | 'carrierIndex' | 'hostile' | 'blocksHealing'> }
): ClassSpellVariant {
  return {
    name,
    actionType: 'main',
    range: R(8),
    targeting: 'any',
    dc: o.dc,
    noCastSprite: true,
    description: o.text,
    visual: { preset: 'conjure', color: o.color, size: 30, speed: 1 },
    cast(ctx) {
      const wearer = ctx.target ?? ctx.caster;
      const index = ctx.game.mages.indexOf(wearer);
      const turns = o.turns(ctx) * (ctx.crit ? 2 : 1);
      ctx.game.desecrationFields = ctx.game.desecrationFields.filter((f) => !(f.name === name && f.carrierIndex === index));
      foul(ctx.game, wearer, wearer.pos, { ...o.field, name, turnsLeft: turns, carrierIndex: index });
      ctx.log(`${wearer.name} wraps itself in the ${name} for ${turns} turns.`);
    },
  };
}

// =============================================================================
//  TWO WORDS
// =============================================================================

// ---- Corrode Desecrate: the plague walks -----------------------------------------

/** A plague that rides on its carrier and rots every enemy of yours near it, the carrier included. */
function plagueCarrier({ victim, drinker, ctx }: Strike): void {
  if (!victim.alive) return;
  const index = ctx.game.mages.indexOf(victim);
  ctx.game.desecrationFields = ctx.game.desecrationFields.filter((f) => !(f.name === 'Plague Carrier' && f.carrierIndex === index));
  foul(ctx.game, drinker, victim.pos, {
    name: 'Plague Carrier', radius: R(2.5), turnsLeft: 3, ticks: [{ spec: '1d6', type: 'corrosive' }], carrierIndex: index,
  });
}

variants(
  ['corrode', 'desecrate'],
  raise('plague-mother', {
    name: 'Plague Mother', hp: 16, move: 3, pacifist: true,
    pulse: [{
      k: 'call',
      run: (game, mother, owner) => {
        foul(game, owner, mother.pos, {
          name: 'Plague Pool', radius: R(2), turnsLeft: 4, ticks: [{ spec: '1d6', type: 'corrosive' }], heartIndex: game.mages.indexOf(mother),
        });
      },
    }],
    death: [{ k: 'foul', radius: R(5), turns: 4, ticks: [{ spec: '2d6', type: 'corrosive' }] }],
  }, {
    dc: 13, color: ROT,
    text: 'It cannot attack. Wherever it stands at the start of your turns it leaves a 2cm Plague Pool for 4 turns: ' +
      'your enemies starting a turn in its pools take 1d6 corrosive (once, however many overlap) and cannot be healed ' +
      `there. Walk it with Command and the plague follows. When it falls its corpse fouls 5cm for 4 turns: ${AFFECTED} ` +
      'starting a turn there take 2d6 corrosive and cannot be healed.',
  }),
  gear('plaguebringersGauntlet', {
    name: "Plaguebringer's Gauntlet", slot: 'weapon',
    onHit: [call(plagueCarrier)],
  }, {
    dc: 13, color: ROT,
    text: 'For the rest of the fight, whatever your basic attacks land on becomes a plague carrier for 3 turns: a ' +
      '2.5cm plague rides on it, and every enemy of yours starting a turn in it (the carrier included) takes 1d6 ' +
      'corrosive and cannot be healed there.',
  }),
  rule('rottingEarth', {
    name: 'Rotting Earth',
    roundEnd: {
      who: 'foes',
      then: [call(({ victim, drinker, ctx }) => {
        const game = ctx.game;
        const group = lawGround(game, drinker);
        const under = game.desecrationFieldsAt(victim.pos).find((f) => f.heartIndex === group);
        if (under) {
          under.radius = Math.min(R(4), under.radius + R(1));
          under.turnsLeft = Math.max(under.turnsLeft, 2);
          return;
        }
        foul(game, drinker, victim.pos, { name: 'Rotting Earth', radius: R(2), turnsLeft: 2, ticks: [{ spec: '1d6', type: 'corrosive' }], heartIndex: group });
      })],
    },
  }, {
    dc: 13, color: ROT,
    text: 'at the end of every round the earth rots under each of your enemies: a 2cm patch for 2 turns where your ' +
      'enemies take 1d6 corrosive at the start of their turns (once, however many overlap) and cannot be healed. An ' +
      'enemy still standing on rotting earth makes it grow 1cm instead (up to 4cm).',
  })
);

// ---- Curse Desecrate: the unburied -------------------------------------------------

function unburied(game: GameState, owner: Mage, victim: Mage, spec: string, turns: number): void {
  if (!victim.alive) return;
  applyDot(game.quietContext(owner, victim), victim, { name: UNBURIED, key: 'dot:unburied', duration: turns, damage: dmg(0, 'shadow'), damageSpec: spec });
  game.vfxSink?.godFx?.('skull', victim.pos, { size: victim.bodyRadius() * 4 });
}

variants(
  ['curse', 'desecrate'],
  raise('gravecaller', {
    name: 'Gravecaller', hp: 12, move: 3, pacifist: true,
    pulse: [{
      k: 'call',
      run: (game, caller, owner) => {
        const prey = game.mages
          .filter((m) => m.alive && m.team !== owner.team && !game.isUnreachable(m) && dist(m.pos, caller.pos) <= R(8) + m.bodyRadius())
          .sort((a, b) => b.hp - a.hp || game.mages.indexOf(a) - game.mages.indexOf(b))[0];
        if (prey) unburied(game, owner, prey, '1d6', 4);
      },
    }],
  }, {
    dc: 13, color: GRAVE,
    text: 'It cannot attack. At the start of your turns it lays the Unburied Curse on the healthiest enemy within 8cm ' +
      'of it: 1d6 shadow at the start of its turns for 4 turns. Whatever dies under an Unburied Curse rises again as your Remnant.',
  }),
  gear('ghoulsKiss', {
    name: "Ghoul's Kiss", slot: 'weapon',
    onHit: [call(({ victim, drinker, ctx }) => unburied(ctx.game, drinker, victim, '1d4', 3))],
  }, {
    dc: 13, color: GRAVE,
    text: 'For the rest of the fight, your landed basic attacks lay the Unburied Curse: 1d4 shadow at the start of the ' +
      "target's turns for 3 turns. Whatever dies under it rises again as your Remnant.",
  }),
  rule('nightOfTheUnburied', {
    name: 'Night of the Unburied',
    death: { who: 'foes', radius: 0, corpse: [call(({ victim, drinker, ctx }) => {
      if (drinker.alive && drinker.team !== victim.team) ctx.game.raiseThrall(victim, drinker);
    })] },
    turn: {
      who: 'foes',
      then: [call(({ victim, ctx }) => {
        const curses = afflictions(victim);
        if (curses > 0) dealDamage(ctx, victim, dmg(ctx.game.showRoll(`${curses}d4`, 'Night of the Unburied', victim).total, 'shadow'), { canMiss: false, noImpactFx: true });
      })],
    },
  }, {
    dc: 13, color: GRAVE,
    text: 'every enemy of yours that dies rises again as your Remnant, and at the start of each enemy turn every ' +
      'curse (damage over time) on it bites 1d4 shadow harder.',
  })
);

// ---- Drain Desecrate: the blood price -----------------------------------------------

const altarFed = new WeakMap<Mage, number>();

variants(
  ['drain', 'desecrate'],
  raise('blood-altar', {
    name: 'Blood Altar', hp: 14, move: 1, pacifist: true,
    pulse: [{
      k: 'call',
      run: (game, altar, owner) => {
        let drawn = 0;
        for (const m of game.mages) {
          if (!m.alive || m.team === owner.team || dist(m.pos, altar.pos) > R(6) + m.bodyRadius()) continue;
          drawn += dealDamage(game.quietContext(altar, m), m, dmg(game.rng.roll('1d4').total, 'corrosive'), { canMiss: false, aoe: true });
        }
        if (drawn <= 0) return;
        const wounded = game.mages
          .filter((m) => m.alive && m.team === owner.team)
          .sort((a, b) => b.maxHp - b.hp - (a.maxHp - a.hp) || game.mages.indexOf(a) - game.mages.indexOf(b))[0];
        if (wounded) heal(game.quietContext(owner, wounded), wounded, drawn);
        const fed = (altarFed.get(altar) ?? 0) + drawn;
        altarFed.set(altar, fed);
        if (fed < 30) return;
        const mend = game.showRoll('2d6', 'Blood Altar', altar).total;
        for (const m of game.mages) {
          if (m.alive && m.team === owner.team && m !== altar && dist(m.pos, altar.pos) <= R(6) + m.bodyRadius()) heal(game.quietContext(owner, m), m, mend);
        }
        game.defeatMage(altar, owner, `${altar.name} overflows and bursts into a fountain of blood.`);
      },
    }],
  }, {
    dc: 13, color: BLOOD,
    text: 'It cannot attack. At the start of your turns every enemy within 6cm of it bleeds 1d4 corrosive into it, ' +
      'and the blood heals the most wounded unit on your side. Once it has drawn 30 it overflows: your side within 6cm ' +
      'heals 2d6 and the altar is spent.',
  }),
  wornGround("Vampire's Shroud", {
    dc: 13, color: BLOOD,
    turns: () => 6,
    field: { radius: R(4), ticks: [{ spec: '1d6', type: 'corrosive' }], lifesteal: true },
    text: 'Wrap yourself in a thirsting shroud for 6 turns (twice as long on a critical). Wherever you go it fouls ' +
      'the ground 4cm around you: your enemies there cannot be healed, and each one that starts its turn there bleeds ' +
      '1d6 corrosive, which heals you. If you fall, it stays where you fell until it runs out.',
  }),
  rule('bloodTithe', {
    name: 'The Blood Tithe',
    turn: {
      who: 'foes',
      then: [
        { k: 'noHeal', turns: 2 },
        call(({ victim, drinker, ctx }) => {
          if (!victim.alive) return;
          const bled = dealDamage(ctx, victim, dmg(ctx.game.rng.roll('1d4').total, 'corrosive'), { canMiss: false, noImpactFx: true });
          if (drinker !== victim) drink(ctx.game, drinker, bled);
          if (!victim.alive || victim.hp * 4 > victim.maxHp) return;
          const left = victim.hp;
          ctx.game.log(`${victim.name} is drained dry.`);
          if (ctx.game.killByDeathWord(victim, drinker) && drinker !== victim) drink(ctx.game, drinker, left);
        }),
      ],
    },
  }, {
    dc: 13, color: BLOOD,
    text: 'your enemies cannot be healed, and at the start of each of their turns each bleeds 1d4 corrosive, which ' +
      'heals you. One left at a quarter of its health or less is drained dry: it dies, and you drink what it had left.',
  })
);

// ---- Pierce Desecrate: stakes ------------------------------------------------------

/** A ring of stakes: enemies of the owner cannot walk out of it, and bleed in it. */
const stakes = (game: GameState, owner: Mage, at: Vec2, turns: number, spec: string, heartIndex?: number): DesecrationField =>
  foul(game, owner, at, { name: 'Ring of Stakes', radius: R(2), turnsLeft: turns, ticks: [{ spec, type: 'pierce' }], sealed: true, heartIndex });

variants(
  ['pierce', 'desecrate'],
  raise('bone-spitter', {
    name: 'Bone Spitter', hp: 8, move: 3, pacifist: true,
    pulse: [{
      k: 'shoot', radius: R(10), hits: [{ spec: '1d6', type: 'pierce' }],
      then: [call(({ victim, drinker, ctx }) => {
        if (victim.alive) stakes(ctx.game, drinker, victim.pos, 2, '1d4');
      })],
    }],
  }, {
    dc: 13, color: BONE,
    text: 'It cannot attack. At the start of your turns it spits a bone at the nearest enemy within 10cm: 1d6 pierce, ' +
      'and a 2cm ring of stakes erupts around it for 2 turns: your enemies cannot walk out of it, take 1d4 pierce at ' +
      'the start of their turns inside it and cannot be healed there.',
  }),
  gear('stakeOfUnmaking', {
    name: 'Stake of Unmaking', slot: 'weapon', charges: 3,
    onHit: [
      { k: 'damage', spec: '2d6', type: 'pierce' },
      { k: 'root', turns: 2 },
      call(({ victim, drinker, ctx }) => {
        if (victim.alive) stakes(ctx.game, drinker, victim.pos, 3, '1d6');
      }),
    ],
  }, {
    dc: 13, color: BONE,
    text: 'Your next 3 landed basic attacks drive a stake: 2d6 more pierce, the target is rooted for 2 turns, and a ' +
      '2cm ring of stakes erupts around it for 3 turns: your enemies cannot walk out of it, take 1d6 pierce at the ' +
      'start of their turns inside it and cannot be healed there.',
  }),
  rule('fieldOfStakes', {
    name: 'Field of Stakes',
    roundEnd: {
      who: 'foes',
      then: [call(({ victim, drinker, ctx }) => {
        if (victim.alive) stakes(ctx.game, drinker, victim.pos, 2, '1d6', lawGround(ctx.game, drinker));
      })],
    },
  }, {
    dc: 13, color: BONE,
    text: 'at the end of every round a 2cm ring of stakes erupts around each of your enemies for 2 turns: your enemies ' +
      'cannot walk out of a ring, take 1d6 pierce at the start of their turns inside one (once, however many overlap) ' +
      'and cannot be healed there.',
  })
);

// ---- Shatter Desecrate: the charnel ---------------------------------------------------

/** Charnel Root's blight: patches that widen, and a new one breaking out every turn. */
const BLIGHT = { start: R(2.5), max: R(4), grow: R(0.5), step: R(4), cap: 12, linger: 3 };
const BLIGHT_TICKS: DesecrationTick[] = [{ spec: '1d6', type: 'shatter' }, { spec: '1d4', type: 'shadow' }];

/** Every patch of the root's blight widens and lives on, and a new one reaches for the nearest enemy not yet on it. */
function spreadBlight(game: GameState, root: Mage, owner: Mage): void {
  const index = game.mages.indexOf(root);
  const patches = game.desecrationFields.filter((f) => f.heartIndex === index);
  for (const patch of patches) {
    patch.radius = Math.min(BLIGHT.max, patch.radius + BLIGHT.grow);
    patch.turnsLeft = Math.max(patch.turnsLeft, BLIGHT.linger);
  }
  if (patches.length >= BLIGHT.cap) return;
  let at: Vec2 = { ...root.pos };
  if (patches.length > 0) {
    let best: { from: Vec2; to: Vec2; gap: number } | undefined;
    for (const m of game.mages) {
      if (!m.alive || m.team === owner.team || game.isUnreachable(m)) continue;
      if (patches.some((p) => dist(m.pos, p) <= p.radius)) continue;
      for (const p of patches) {
        const gap = dist(p, m.pos);
        if (!best || gap < best.gap) best = { from: { x: p.x, y: p.y }, to: m.pos, gap };
      }
    }
    const from = best?.from ?? game.rng.pick(patches);
    const angle = best
      ? Math.atan2(best.to.y - from.y, best.to.x - from.x)
      : (game.rng.die(360) - 1) * (Math.PI / 180);
    const reach = best ? Math.min(BLIGHT.step, best.gap) : BLIGHT.step;
    at = {
      x: Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, from.x + Math.cos(angle) * reach)),
      y: Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, from.y + Math.sin(angle) * reach)),
    };
  }
  foul(game, owner, at, { name: 'Charnel Blight', radius: BLIGHT.start, turnsLeft: BLIGHT.linger, ticks: BLIGHT_TICKS, heartIndex: index });
  game.log(`${root.name}'s blight breaks out further (${patches.length + 1} patches).`);
}

const REIGN: RuleLawKind = 'rule:reignOfBones';

/** The ground breaks under a foe: one more die of each every 3 rounds the reign has stood. */
function breakTheGround({ victim, ctx }: Strike): void {
  if (!victim.alive) return;
  const spec = `${1 + Math.floor(stood(ctx.game, REIGN) / 3)}d6`;
  dealDamage(ctx, victim, dmg(ctx.game.showRoll(spec, 'Reign of Bones', victim).total, 'shatter'), { canMiss: false, aoe: true });
  if (!victim.alive) return;
  dealDamage(ctx, victim, dmg(ctx.game.showRoll(spec, 'Reign of Bones', victim).total, 'shadow'), { canMiss: false, aoe: true });
}

function breakTheBones({ victim, ctx }: Strike): void {
  if (!victim.alive) return;
  applyDebuff(ctx, victim, {
    name: 'Broken Bones',
    key: 'debuff:broken-bones',
    duration: 2,
    mods: { moveRange: -Math.round(MOVE_RANGE * 0.5), damageTaken: 2 },
    healMult: 0,
  });
}

variants(
  ['shatter', 'desecrate'],
  raise('charnel-root', {
    name: 'Charnel Root', hp: 20, move: 2, armor: 1, pacifist: true,
    pulse: [{ k: 'call', run: spreadBlight }],
  }, {
    dc: 13, color: BONE,
    after: (ctx, unit) => spreadBlight(ctx.game, unit, ctx.caster),
    text: 'It cannot attack. The ground under it rots at once into a 2.5cm Charnel Blight. At the start of each of ' +
      'your turns every patch of the blight widens by 0.5cm (up to 4cm), and a new patch breaks out up to 4cm further, ' +
      'reaching for the nearest enemy the blight does not yet cover (up to 12 patches). Your enemies starting a turn ' +
      'on the blight take 1d6 shatter and 1d4 shadow (once, however many patches overlap) and cannot be healed while ' +
      'on it. The blight lives as long as the root does, then dies back within 3 turns.',
  }),
  wornGround('Ossuary Shroud', {
    dc: 13, color: BONE,
    turns: (ctx) => rollDice(ctx, '1d6', 'Ossuary Shroud') + 1,
    field: { radius: R(6), ticks: [{ spec: '1d6', type: 'shatter' }, { spec: '1d6', type: 'shadow' }] },
    text: 'Wrap yourself in a shroud of bone and grave-cloth for 1d6+1 turns (twice as long on a critical). Wherever ' +
      'you go it fouls the ground 6cm around you: your enemies there cannot be healed, and each one that starts its ' +
      'turn there takes 2d6, half shatter and half shadow (1d6 of each). If you fall, it stays where you fell until it runs out.',
  }),
  rule('reignOfBones', {
    name: 'Reign of Bones',
    turn: {
      who: 'foes',
      then: [
        call(breakTheGround),
        { k: 'damage', spec: '1d4', type: 'sanity' },
        call(breakTheBones),
        { k: 'ifShaken', then: [{ k: 'stun', turns: 2, chance: 0.5 }] },
      ],
    },
    death: { who: 'foes', radius: R(3), kin: [{ k: 'damage', spec: '2d6', type: 'shatter' }] },
  }, {
    dc: 13, color: BONE,
    text: 'your enemies live in terror. At the start of each of their turns the ground breaks under them for 1d6 ' +
      'shatter and 1d6 shadow, one more die of each for every 3 rounds the reign has stood (3d6 and 3d6 at the end), ' +
      'and dread takes 1d4 sanity; one left at half its sanity or less is paralysed for that turn half the time. ' +
      'Their bones stay broken: they move 50% slower, take 2 more damage from every hit and cannot be healed. When ' +
      'one of them dies its bones burst: every other enemy of yours within 3cm of it takes 2d6 shatter, and the burst ' +
      'can set off the next.',
  })
);

// =============================================================================
//  THREE WORDS
// =============================================================================

const ACID: RotSpec = { name: 'Acid', spec: '1d3', max: 5, turns: 3 };
const BLACK_PLAGUE: RotSpec = { name: 'Black Plague', spec: '1d4', max: 5, turns: 4, spread: R(3) };
const acidSoaked = new WeakMap<Mage, number>();

variants(
  ['corrode', 'pierce', 'desecrate'],
  raise('acid-lancer', {
    name: 'Acid Lancer', hp: 10, move: 4, melee: { spec: '1d6', type: 'pierce', reach: R(2) },
    onHit: [{ k: 'pitted', amount: 2, turns: 2 }, { k: 'affected', then: [{ k: 'execute', at: 6 }] }],
  }, {
    dc: 15, color: ROT,
    text: 'It strikes from 2cm for 1d6 pierce and eats the armour where it lands: the target takes 2 more from every ' +
      'hit for 2 turns. A unit Desecrate may harm (not black, not a minion) left at 6 health or less is unmade.',
  }),
  gear('corrodingLance', {
    name: 'Corroding Lance', slot: 'weapon',
    onHit: [{ k: 'ifDot', then: [{ k: 'damage', spec: '1d6', type: 'pierce' }] }, { k: 'rot', rot: ACID }],
  }, {
    dc: 15, color: ROT,
    text: 'For the rest of the fight, your landed basic attacks deal 1d6 more pierce to a target already suffering a ' +
      'damage over time, then lay a stack of Acid (1d3 corrosive per stack at the start of its turns, up to 5 stacks, 3 turns).',
  }),
  rule('acidRain', {
    name: 'Acid Rain',
    roundEnd: {
      who: 'foes',
      then: [
        { k: 'damage', spec: '1d6', type: 'corrosive' },
        call(({ victim, ctx }) => {
          if (!victim.alive) return;
          const soaked = Math.min(5, (acidSoaked.get(victim) ?? 0) + 1);
          acidSoaked.set(victim, soaked);
          applyDebuff(ctx, victim, { name: `Acid-Eaten ×${soaked}`, key: 'debuff:acid-rain', duration: 3, mods: { damageTaken: soaked } });
        }),
      ],
    },
  }, {
    dc: 15, color: ROT,
    text: 'at the end of every round acid rains on your enemies: 1d6 corrosive each, and their armour is eaten away: ' +
      'each takes 1 more damage from every hit for every round it has stood in the rain (up to 5).',
  })
);

variants(
  ['corrode', 'shatter', 'desecrate'],
  raise('bone-colossus', {
    name: 'Bone Colossus', hp: 24, move: 2, armor: 2, melee: { spec: '2d6', type: 'shatter' },
    struck: { radius: R(2), hits: [{ spec: '1d4', type: 'corrosive' }] },
    death: [{ k: 'foul', radius: R(4), turns: 4, ticks: [{ spec: '1d6', type: 'shatter' }, { spec: '1d4', type: 'corrosive' }] }],
  }, {
    dc: 15, color: BONE,
    text: 'It strikes for 2d6 shatter. Every hit that lands on it splashes rotten marrow: every enemy within 2cm of it ' +
      `takes 1d4 corrosive. When it falls it collapses into fouled ground 4cm wide for 4 turns: ${AFFECTED} starting a ` +
      'turn there take 1d6 shatter and 1d4 corrosive and cannot be healed.',
  }),
  gear('crumblingMail', {
    name: 'Crumbling Mail', slot: 'armour',
    onStruck: [
      { k: 'damage', spec: '1d6', type: 'corrosive' },
      call(({ victim, ctx }) => {
        if (victim.alive) applyDebuff(ctx, victim, { name: 'Crumbling Weapon', key: 'debuff:crumbling', duration: 3, mods: { damageDealt: -2 } });
      }),
    ],
  }, {
    dc: 15, color: BONE,
    text: 'For the rest of the fight, a unit landing a basic attack on you takes 1d6 corrosive and its weapon crumbles: ' +
      'it deals 2 less damage for 3 turns.',
  }),
  rule('boneRot', {
    name: 'Bone Rot',
    hit: {
      types: ['corrosive'],
      who: 'foes',
      then: [call(({ victim, dealt, ctx }) => {
        if (!victim.alive || dealt <= 0) return;
        const echo = ctx.game.isDesecrationAffected(victim) ? dealt * 2 : dealt;
        dealDamage(ctx, victim, dmg(echo, 'shatter'), { canMiss: false, noImpactFx: true });
      })],
    },
    turn: { who: 'affected', then: [{ k: 'damage', spec: '1d4', type: 'corrosive' }, { k: 'noHeal', turns: 2 }] },
  }, {
    dc: 15, color: BONE,
    text: 'corrosion rots the bones of your enemies: every corrosive hit on one deals the same again as shatter ' +
      `(twice that on ${AFFECTED}). Those affected units also take 1d4 corrosive at the start of their turns and cannot be healed.`,
  })
);

variants(
  ['corrode', 'drain', 'desecrate'],
  raise('leech-mother', {
    name: 'Leech Mother', hp: 14, move: 3, melee: { spec: '1d4', type: 'corrosive' },
    onHit: [
      { k: 'lifesteal' },
      call(({ victim, drinker, ctx }) => {
        if (!victim.alive && drinker.alive && drinker.team !== victim.team) ctx.game.raiseThrall(victim, drinker);
      }),
    ],
    pulse: [{ k: 'aura', radius: R(2), who: 'foes', hits: [{ spec: '1d3', type: 'corrosive' }], drink: true }],
  }, {
    dc: 15, color: BLOOD,
    text: 'It bites for 1d4 corrosive and drinks what it deals; whatever its bite kills rises again as your Remnant. At ' +
      'the start of your turns every enemy within 2cm of it bleeds 1d3 corrosive into it.',
  }),
  gear('parasiteFang', {
    name: 'Parasite Fang', slot: 'weapon',
    onHit: [call(({ victim, drinker, ctx }) => {
      if (!victim.alive || afflictions(victim) === 0) return;
      ctx.game.log(`Every rot on ${victim.name} bites at once.`);
      drink(ctx.game, drinker, ctx.game.tickDotsNow(victim, drinker));
    })],
  }, {
    dc: 15, color: BLOOD,
    text: 'For the rest of the fight, your landed basic attacks make every damage over time on the target tick at ' +
      'once, and you drink all of it.',
  }),
  rule('famine', {
    name: 'Famine',
    turn: {
      who: 'foes',
      then: [
        { k: 'noHeal', turns: 2 },
        call(({ victim, drinker, ctx }) => {
          if (!victim.alive) return;
          const hunger = ctx.game.rng.roll('1d4').total + stood(ctx.game, 'rule:famine');
          const starved = dealDamage(ctx, victim, dmg(hunger, 'corrosive'), { canMiss: false, noImpactFx: true });
          if (drinker !== victim) drink(ctx.game, drinker, Math.ceil(starved / 2));
        }),
      ],
    },
  }, {
    dc: 15, color: BLOOD,
    text: 'your enemies starve: they cannot be healed, and at the start of each of their turns each takes 1d4 ' +
      'corrosive, 1 more for every round the famine has stood. You drink half of it.',
  })
);

variants(
  ['corrode', 'curse', 'desecrate'],
  raise('plague-saint', {
    name: 'Plague Saint', hp: 12, move: 3, pacifist: true,
    pulse: [{ k: 'hex', radius: R(4), who: 'foes', then: [{ k: 'rot', rot: BLACK_PLAGUE }] }],
  }, {
    dc: 15, color: ROT,
    text: 'It cannot attack. At the start of your turns every enemy within 4cm of it catches a stack of Black Plague ' +
      '(1d4 corrosive per stack at the start of its turns, up to 5 stacks, 4 turns), which spreads to your other ' +
      'enemies within 3cm of a carrier.',
  }),
  gear('plagueMantle', {
    name: 'Plague Mantle', slot: 'armour',
    onStruck: [{ k: 'rot', rot: BLACK_PLAGUE }, { k: 'rot', rot: BLACK_PLAGUE }],
  }, {
    dc: 15, color: ROT,
    text: 'For the rest of the fight, a unit landing a basic attack on you catches 2 stacks of Black Plague (1d4 ' +
      'corrosive per stack at the start of its turns, up to 5 stacks, 4 turns), which spreads to your other enemies ' +
      'within 3cm of a carrier.',
  }),
  rule('blackDeath', {
    name: 'The Black Death',
    roundEnd: {
      who: 'foes',
      then: [
        { k: 'noHeal', turns: 2 },
        call(({ victim, drinker, ctx }) => {
          if (!victim.alive) return;
          const rots = victim.statuses.filter((s) => s.kind === 'dot') as DotStatus[];
          for (const other of ctx.game.mages) {
            if (!other.alive || other === victim || other.team === drinker.team || dist(other.pos, victim.pos) > R(3) + other.bodyRadius()) continue;
            if (other.isDebuffImmune()) continue;
            for (const rot of rots) {
              if (!other.statuses.some((s) => s.key === rot.key)) addOrExtendStatus(other.statuses, { ...rot }, false);
            }
          }
          if (rots.length >= 3) {
            dealDamage(ctx, victim, dmg(ctx.game.showRoll('2d6', 'The Black Death', victim).total, 'shadow'), { canMiss: false, noImpactFx: true });
          }
        }),
      ],
    },
  }, {
    dc: 15, color: ROT,
    text: 'at the end of every round every damage over time on one of your enemies leaps to each of your other enemies ' +
      'within 3cm of it that does not carry it yet. None of your enemies can be healed, and one carrying 3 or more takes 2d6 shadow.',
  })
);

const knells = new WeakMap<Mage, number>();

variants(
  ['curse', 'shatter', 'desecrate'],
  raise('ossuary-bell', {
    name: 'Ossuary Bell', hp: 12, move: 2, pacifist: true,
    pulse: [{
      k: 'hex', radius: R(5), who: 'foes',
      then: [call(({ victim, drinker, ctx }) => {
        if (!victim.alive) return;
        const toll = (knells.get(victim) ?? 0) + 1;
        if (toll < 3) {
          knells.set(victim, toll);
          dealDamage(ctx, victim, dmg(ctx.game.rng.roll('1d4').total, 'shadow'), { canMiss: false, noImpactFx: true });
          ctx.game.log(`The bell tolls for ${victim.name} (${toll}/3).`);
          return;
        }
        knells.set(victim, 0);
        ctx.game.log(`The third knell breaks ${victim.name}'s bones.`);
        ctx.game.vfxSink?.godFx?.('skull', victim.pos, { size: victim.bodyRadius() * 5 });
        dealDamage(ctx, victim, dmg(ctx.game.showRoll('3d6', 'Ossuary Bell', victim).total, 'shatter'), { canMiss: false });
        runHitEffects({ striker: ctx.caster, victim, dealt: 0, drinker, ctx }, [{ k: 'stun', turns: 2 }]);
      })],
    }],
  }, {
    dc: 15, color: GRAVE,
    text: 'It cannot attack. At the start of your turns it tolls for every enemy within 5cm of it: 1d4 shadow. The ' +
      "third knell for the same enemy breaks its bones instead: 3d6 shatter, and it is stunned for 1 turn.",
  }),
  gear('hexboneHammer', {
    name: 'Hexbone Hammer', slot: 'weapon',
    onHit: [{ k: 'dot', name: 'Bone Curse', spec: '1d4', turns: 3, type: 'shatter' }, { k: 'petrify' }],
  }, {
    dc: 15, color: GRAVE,
    text: 'For the rest of the fight, your landed basic attacks lay a Bone Curse (1d4 shatter at the start of its ' +
      'turns for 3 turns) and turn the target a stage further to stone: slowed 50% for 3 turns, then rooted for 2, ' +
      'then stunned for 2 with 1d6 shatter.',
  }),
  rule('calcify', {
    name: 'Calcify',
    turn: { who: 'foes', then: [{ k: 'ifDot', then: [{ k: 'petrify' }] }] },
    hit: {
      types: ['shatter'],
      who: 'foes',
      then: [call(({ victim, ctx }) => {
        if (victim.alive && victim.isStunned('full')) dealDamage(ctx, victim, dmg(ctx.game.rng.roll('1d6').total, 'shatter'), { canMiss: false, noImpactFx: true });
      })],
    },
  }, {
    dc: 15, color: GRAVE,
    text: 'curses turn flesh to stone: an enemy starting its turn under any damage over time turns a stage further to ' +
      'stone (slowed, then rooted, then stunned with 1d6 shatter). Every shatter hit on a stunned enemy deals 1d6 more.',
  })
);

variants(
  ['drain', 'shatter', 'desecrate'],
  raise('marrow-drinker', {
    name: 'Marrow Drinker', hp: 12, move: 4, melee: { spec: '1d6', type: 'shatter' },
    onHit: [{ k: 'lifesteal' }, { k: 'affected', then: [{ k: 'wither', amount: 2, cap: 10 }] }],
  }, {
    dc: 15, color: BLOOD,
    text: 'It strikes for 1d6 shatter and drinks what it deals. A unit Desecrate may harm (not black, not a minion) ' +
      'also loses 2 maximum health per strike (up to 10, until the fight ends).',
  }),
  gear('marrowSiphon', {
    name: 'Marrow Siphon', slot: 'weapon',
    onHit: [
      { k: 'siphon', pct: 0.5 },
      call(({ victim, ctx }) => {
        if (victim.alive && victim.hp * 4 <= victim.maxHp) {
          dealDamage(ctx, victim, dmg(ctx.game.showRoll('2d6', 'Marrow Siphon', victim).total, 'shatter'), { canMiss: false });
        }
      }),
    ],
  }, {
    dc: 15, color: BLOOD,
    text: 'For the rest of the fight, your landed basic attacks drink half the damage dealt again (rounded up) as ' +
      'corrosive, which heals you, and crack the bones of a target at a quarter of its health or less for 2d6 shatter.',
  }),
  rule('boneFeast', {
    name: 'The Bone Feast',
    death: {
      who: 'foes',
      radius: R(5),
      kin: [{ k: 'damage', spec: '1d6', type: 'shatter' }],
      corpse: [call(({ victim, drinker, ctx }) => {
        if (drinker.alive && drinker !== victim) heal(ctx.game.quietContext(drinker, drinker), drinker, Math.ceil(victim.maxHp / 4));
      })],
    },
  }, {
    dc: 15, color: BLOOD,
    text: 'whenever one of your enemies dies its bones splinter into its own side (1d6 shatter to each within 5cm), ' +
      'and you feast: you heal a quarter of its maximum health.',
  })
);

const BLOODCURSE: HitEffect = { k: 'dot', name: 'Bloodcurse', spec: '1d4', turns: 4, drink: true };

variants(
  ['drain', 'curse', 'desecrate'],
  raise('soul-leech', {
    name: 'Soul Leech', hp: 8, move: 5, melee: { spec: '1d4', type: 'corrosive' },
    onHit: [BLOODCURSE],
    pulse: [{ k: 'hex', radius: R(6), who: 'foes', nearest: true, then: [BLOODCURSE] }],
  }, {
    dc: 15, color: BLOOD,
    text: 'It bites for 1d4 corrosive. Its bite, and at the start of your turns its gaze on the nearest enemy within ' +
      '6cm, lays a Bloodcurse: 1d4 corrosive at the start of the target\'s turns for 4 turns, which heals you.',
  }),
  gear('bloodcurseRing', {
    name: 'Bloodcurse Ring', slot: 'trinket',
    turnStart: [{ k: 'hex', radius: R(8), who: 'foes', then: [{ k: 'ifDot', then: [{ k: 'drain', spec: '1d4' }] }] }],
  }, {
    dc: 15, color: BLOOD,
    text: 'For the rest of the fight, at the start of your turns every enemy within 8cm of you that carries a curse ' +
      '(damage over time) bleeds 1d4 corrosive, which heals you.',
  }),
  rule('bloodDebt', {
    name: 'Blood Debt',
    turn: {
      who: 'foes',
      then: [call((strike) => {
        const debts = afflictions(strike.victim);
        if (debts > 0 && strike.drinker !== strike.victim) runHitEffects(strike, [{ k: 'drain', spec: `${debts}d4` }]);
      })],
    },
  }, {
    dc: 15, color: BLOOD,
    text: "every curse on your enemies runs up a blood debt: at the start of each enemy's turn it bleeds 1d4 " +
      'corrosive for every damage over time it carries, and you drink all of it.',
  })
);

/** Bones that burst over every enemy of yours close by. */
const BONE_BURST = call(({ victim, drinker, ctx }) => {
  if (!victim.alive || victim.team === drinker.team) return;
  dealDamage(ctx, victim, dmg(ctx.game.rng.roll('2d6').total, 'pierce'), { canMiss: false, aoe: true });
  if (victim.alive) dealDamage(ctx, victim, dmg(ctx.game.rng.roll('1d6').total, 'shatter'), { canMiss: false, aoe: true });
});

variants(
  ['pierce', 'shatter', 'desecrate'],
  raise('ossified-thrower', {
    name: 'Ossified Thrower', hp: 9, move: 3, pacifist: true,
    pulse: [{
      k: 'shoot', radius: R(10), hits: [{ spec: '1d6', type: 'pierce' }],
      then: [
        { k: 'shrapnel', radius: R(2), hits: [{ spec: '1d4', type: 'shatter' }], foes: true },
        { k: 'affected', then: [{ k: 'execute', at: 5 }] },
      ],
    }],
  }, {
    dc: 15, color: BONE,
    text: 'It cannot attack. At the start of your turns it hurls a bone at the nearest enemy within 10cm: 1d6 pierce, ' +
      'and the bone splinters into every other enemy within 2cm of it for 1d4 shatter. A unit Desecrate may harm (not ' +
      'black, not a minion) left at 5 health or less is unmade.',
  }),
  gear('bonesawSpear', {
    name: 'Bonesaw Spear', slot: 'weapon',
    onHit: [
      { k: 'shrapnel', radius: R(2), hits: [{ spec: '1d4', type: 'shatter' }], foes: true },
      { k: 'affected', then: [{ k: 'damage', spec: '1d6', type: 'pierce' }] },
    ],
  }, {
    dc: 15, color: BONE,
    text: 'For the rest of the fight, your landed basic attacks splinter: every other enemy of yours within 2cm of the ' +
      'target takes 1d4 shatter, and a target Desecrate may harm (not black, not a minion) takes 1d6 more pierce.',
  }),
  rule('splinteringDead', {
    name: 'The Splintering Dead',
    death: { radius: R(4), kin: [BONE_BURST], foes: [BONE_BURST] },
  }, {
    dc: 15, color: BONE,
    text: 'whenever any unit dies, its bones burst outward: every enemy of yours within 4cm of it takes 2d6 pierce and 1d6 shatter.',
  })
);

variants(
  ['pierce', 'drain', 'desecrate'],
  raise('bloodspike', {
    name: 'Bloodspike', hp: 10, move: 4, melee: { spec: '1d6', type: 'pierce', reach: R(2) },
    onHit: [{ k: 'lifesteal' }, { k: 'root', turns: 2 }, { k: 'affected', then: [{ k: 'noHeal', turns: 3 }] }],
  }, {
    dc: 15, color: BLOOD,
    text: 'It strikes from 2cm for 1d6 pierce, drinks what it deals and roots the target for 2 turns. A unit ' +
      'Desecrate may harm (not black, not a minion) cannot be healed for 3 turns after.',
  }),
  gear('vampireStake', {
    name: 'Vampire Stake', slot: 'weapon', charges: 3,
    onHit: [{ k: 'drain', spec: '2d6' }, { k: 'root', turns: 2 }, { k: 'noHeal', turns: 3 }],
  }, {
    dc: 15, color: BLOOD,
    text: 'Your next 3 landed basic attacks drive a blood stake: 2d6 more corrosive, which heals you; the target is ' +
      'rooted for 2 turns and cannot be healed for 3.',
  }),
  rule('exsanguination', {
    name: 'Exsanguination',
    hit: { types: ['pierce'], who: 'foes', then: [{ k: 'dot', name: 'Bleeding Out', pct: 0.5, turns: 3, drink: true }] },
  }, {
    dc: 15, color: BLOOD,
    text: "every pierce wound on your enemies bleeds: half of it again (rounded up) as corrosive at the start of the " +
      "target's next 3 turns, and whoever dealt it drinks every drop.",
  })
);

variants(
  ['pierce', 'curse', 'desecrate'],
  raise('nail-priest', {
    name: 'Nail Priest', hp: 10, move: 3, pacifist: true,
    pulse: [{
      k: 'shoot', radius: R(8), hits: [{ spec: '1d4', type: 'pierce' }],
      then: [{ k: 'dot', name: 'Nail Curse', spec: '1d6', turns: 3, type: 'pierce', barbed: true }],
    }],
  }, {
    dc: 15, color: GRAVE,
    text: 'It cannot attack. At the start of your turns it drives a cursed nail into the nearest enemy within 8cm: 1d4 ' +
      'pierce, and a Nail Curse (1d6 pierce at the start of its turns for 3 turns) that every fresh pierce wound keeps open longer.',
  }),
  gear('barbedRosary', {
    name: 'Barbed Rosary', slot: 'weapon',
    onHit: [{ k: 'dot', name: 'Barbed Curse', pct: 0.5, turns: 3, type: 'pierce', barbed: true }],
  }, {
    dc: 15, color: GRAVE,
    text: 'For the rest of the fight, your landed basic attacks lay a Barbed Curse: half the damage dealt (rounded ' +
      'up) as pierce at the start of the target\'s turns for 3 turns, kept open longer by every fresh pierce wound.',
  }),
  rule('crownOfThorns', {
    name: 'Crown of Thorns',
    turn: {
      who: 'foes',
      then: [call(({ victim, ctx }) => {
        const thorns = afflictions(victim);
        if (thorns > 0) dealDamage(ctx, victim, dmg(ctx.game.showRoll(`${thorns}d4`, 'Crown of Thorns', victim).total, 'pierce'), { canMiss: false, noImpactFx: true });
      })],
    },
    hit: { types: ['pierce'], who: 'foes', then: [{ k: 'deepen', turns: 1 }] },
  }, {
    dc: 15, color: GRAVE,
    text: "at the start of each enemy's turn it takes 1d4 pierce for every damage over time on it, and every pierce " +
      'hit on one of your enemies makes all of its damage over time last 1 turn longer.',
  })
);
