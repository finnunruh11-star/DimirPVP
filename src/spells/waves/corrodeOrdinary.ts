// =============================================================================
//  CORRODE WAVE · ORDINARY SPELLS
// -----------------------------------------------------------------------------
//  The plain versions of the Corrode combos that had none. They are what a
//  caster without the matching calling gets, and what any caster gets once a
//  modifier is attached. Twist spells answer as reactions and cancel what they
//  answer, like every Twist. Paired with Bind or Veil (or alone with Corrode)
//  Twist stifles; with Shatter, Drain or Curse it moves bodies.
// =============================================================================

import { RANGE_UNIT } from '../../config/constants';
import { dmg } from '../../core/Damage';
import type { Mage } from '../../core/Mage';
import { dist } from '../../core/utils';
import { applyStifle } from '../../effects/classKit';
import {
  applyDot,
  applyInvisibility,
  applyStun,
  dash,
  dealDamage,
  drainDamage,
  placeTotem,
  rollDice,
  type EffectContext,
} from '../../effects/effects';
import { registerSpell } from '../registry';

const R = (units: number): number => units * RANGE_UNIT;

/** Living enemies of the caster within `radius` of `at`, nearest first. */
function foesNear(ctx: EffectContext, at: { x: number; y: number }, radius: number, exclude?: Mage): Mage[] {
  return ctx.game.mages
    .filter((m) => m.alive && m !== exclude && m.team !== ctx.caster.team && dist(m.pos, at) <= radius + m.bodyRadius())
    .sort((a, b) => dist(a.pos, at) - dist(b.pos, at));
}

/** Spin `victim` a quarter turn around the caster; a wall or the field edge adds `slamSpec` of `type`. */
function wrench(ctx: EffectContext, victim: Mage, slamSpec: string, type: 'corrosive' | 'shatter'): void {
  if (!victim.alive) return;
  const turn = ctx.game.orbitAround(victim, ctx.caster.pos, ctx.rng.chance(0.5));
  if (!turn.slammed || !victim.alive) return;
  ctx.game.slamDamage(ctx, victim, rollDice(ctx, slamSpec, 'Slam', victim), type);
  ctx.log(`${victim.name} is slammed into something immovable.`);
}

registerSpell({
  name: 'Seize',
  words: ['corrode', 'twist'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 12,
  reaction: true,
  counters: true,
  description:
    'One enemy within 15cm takes 1d6 corrosive, and the next action it declares other than moving fails. ' +
    'As a reaction, cancels the answered action.',
  visual: { preset: 'beam', color: 0x86e8a8, size: 6, speed: 1.3 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Seize'), 'corrosive'));
    applyStifle(ctx, foe);
  },
});

registerSpell({
  name: 'Corrode Curse',
  words: ['corrode', 'curse'],
  actionType: 'bonus',
  range: R(5),
  targeting: 'point',
  dc: 11,
  noCastSprite: true,
  aoe: { kind: 'circle', radius: R(3) },
  description:
    'Place a totem within 5cm for 3 rounds. Enemies starting their turn within 3cm of it take 1d3 corrosive and lose half their movement for 2 turns.',
  visual: { preset: 'burst', color: 0x9be870, size: 48, speed: 1 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    placeTotem(ctx, ctx.targetPoint, { radius: R(3), damageSpec: '1d3', slow: 0.5 });
  },
});

registerSpell({
  name: 'Rusted Lock',
  words: ['corrode', 'twist', 'bind'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  reaction: true,
  counters: true,
  description:
    'One enemy within 12cm is rooted for 2 turns, and the next action it declares other than moving fails and deals 2d4 corrosive to it. ' +
    'As a reaction, cancels the answered action.',
  visual: { preset: 'beam', color: 0x7fc8b0, size: 7, speed: 1.2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    applyStun(ctx, foe, { duration: 2, type: 'movement' });
    applyStifle(ctx, foe, { spec: '2d4' });
  },
});

registerSpell({
  name: 'Choking Veil',
  words: ['corrode', 'twist', 'veil'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 13,
  reaction: true,
  counters: true,
  description:
    'One enemy within 10cm takes 2d4 corrosive, and the next action it declares other than moving fails. ' +
    'Then you gain a half veil for 2 turns. As a reaction, cancels the answered action.',
  visual: { preset: 'beam', color: 0x9fb8c8, size: 6, speed: 1.4 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d4', 'Choking Veil'), 'corrosive'));
    applyStifle(ctx, foe);
    if (ctx.caster.alive) applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'partial' });
  },
});

registerSpell({
  name: 'Corkscrew',
  words: ['corrode', 'twist', 'pierce'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  reaction: true,
  counters: true,
  description:
    'One enemy within 12cm takes 2d6 pierce, then 1d6 corrosive at the start of each of its turns for 2 turns. ' +
    'As a reaction, cancels the answered action.',
  visual: { preset: 'projectile', color: 0xc8f0a0, size: 8, speed: 1.7 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Corkscrew'), 'pierce'));
    if (!foe.alive) return;
    applyDot(ctx, foe, { name: 'Corkscrew', duration: 2, damage: dmg(0, 'corrosive'), damageSpec: '1d6' });
  },
});

registerSpell({
  name: 'Wrecking Spin',
  words: ['corrode', 'twist', 'shatter'],
  actionType: 'main',
  range: R(3),
  targeting: 'none',
  dc: 14,
  reaction: true,
  counters: true,
  aoe: { kind: 'circle', radius: R(3) },
  description:
    'Every enemy within 3cm takes 1d6 shatter and 1d4 corrosive and is turned a quarter circle around you. ' +
    'Stopped by a wall or the field edge: 2d6 shatter more. As a reaction, cancels the answered action.',
  visual: { preset: 'nova', color: 0xc8d878, size: 70, speed: 1.2 },
  cast(ctx) {
    const foes = foesNear(ctx, ctx.caster.pos, R(3));
    if (foes.length === 0) ctx.log('Nothing is close enough to catch in the spin.');
    for (const foe of foes) {
      dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Wrecking Spin', foe), 'shatter'), { aoe: true });
      if (foe.alive) dealDamage(ctx, foe, dmg(rollDice(ctx, '1d4', 'Wrecking Spin', foe), 'corrosive'), { aoe: true });
      wrench(ctx, foe, '2d6', 'shatter');
    }
  },
});

registerSpell({
  name: 'Siphon Spin',
  words: ['corrode', 'twist', 'drain'],
  actionType: 'main',
  range: R(3),
  targeting: 'none',
  dc: 13,
  reaction: true,
  counters: true,
  aoe: { kind: 'circle', radius: R(3) },
  description:
    'Every other unit within 3cm, allies included, is turned a quarter circle around you and takes 1d6 corrosive. ' +
    'You heal for the damage dealt. As a reaction, cancels the answered action.',
  visual: { preset: 'nova', color: 0x57d6a0, size: 70, speed: 1.2 },
  cast(ctx) {
    const caught = ctx.game.mages
      .filter((m) => m.alive && m !== ctx.caster && dist(m.pos, ctx.caster.pos) <= R(3) + m.bodyRadius())
      .sort((a, b) => dist(a.pos, ctx.caster.pos) - dist(b.pos, ctx.caster.pos));
    if (caught.length === 0) ctx.log('Nothing is close enough to catch in the spin.');
    for (const victim of caught) {
      ctx.game.orbitAround(victim, ctx.caster.pos, ctx.rng.chance(0.5));
      if (victim.alive) {
        drainDamage(ctx, victim, dmg(rollDice(ctx, '1d6', 'Siphon Spin', victim), 'corrosive'), { aoe: true });
      }
    }
  },
});

registerSpell({
  name: 'Wringing Curse',
  words: ['corrode', 'twist', 'curse'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  reaction: true,
  counters: true,
  description:
    'Curse one enemy within 12cm for 4 turns. At the start of each of its turns it takes 1d4, then 1d6, 1d8 and 1d10 corrosive, ' +
    'and is turned a quarter circle around you. As a reaction, cancels the answered action.',
  visual: { preset: 'beam', color: 0xa8d890, size: 6, speed: 1.1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    applyDot(ctx, foe, {
      name: 'Wringing Curse',
      duration: 4,
      damage: dmg(0, 'corrosive'),
      escalateSpecs: ['1d4', '1d6', '1d8', '1d10'],
      orbitSource: true,
    });
  },
});

registerSpell({
  name: 'Leech Chain',
  words: ['corrode', 'bind', 'drain'],
  actionType: 'main',
  range: R(8),
  targeting: 'enemy',
  dc: 13,
  description:
    'Chain yourself to one enemy within 8cm for 3 turns: neither of you can move more than 4cm from the other. ' +
    'It takes 1d6 corrosive at the start of each of its turns for 3 turns, and you heal for that damage.',
  visual: { preset: 'beam', color: 0x5fc8a0, size: 7, speed: 1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const owner = ctx.game.mages.indexOf(ctx.caster);
    ctx.game.tether(owner, foe, ctx.caster, R(4), 3);
    ctx.game.tether(owner, ctx.caster, foe, R(4), 3);
    applyDot(ctx, foe, {
      name: 'Leech Chain',
      duration: 3,
      damage: dmg(0, 'corrosive'),
      damageSpec: '1d6',
      lifestealToIndex: owner,
    });
  },
});

registerSpell({
  name: 'Hidden Barb',
  words: ['corrode', 'pierce', 'veil'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 10cm takes 1d6 pierce and 1d6 corrosive. Then you dash 3cm straight away from it.',
  visual: { preset: 'projectile', color: 0xb0c8a0, size: 7, speed: 1.8 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Hidden Barb'), 'pierce'));
    if (foe.alive) dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Hidden Barb'), 'corrosive'));
    const me = ctx.caster;
    if (me.alive) dash(ctx, me, { direction: { x: me.x - foe.x, y: me.y - foe.y }, distance: R(3) });
  },
});

registerSpell({
  name: 'Leech Mist',
  words: ['corrode', 'veil', 'drain'],
  actionType: 'main',
  range: R(3),
  targeting: 'none',
  dc: 13,
  aoe: { kind: 'circle', radius: R(3) },
  description:
    'Every enemy within 3cm takes 1d6 corrosive, and you heal for the damage dealt. Then you gain a half veil for 2 turns.',
  visual: { preset: 'nova', color: 0x6fb8a0, size: 70, speed: 1 },
  cast(ctx) {
    for (const foe of foesNear(ctx, ctx.caster.pos, R(3))) {
      drainDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Leech Mist', foe), 'corrosive'), { aoe: true });
    }
    if (ctx.caster.alive) applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'partial' });
  },
});

registerSpell({
  name: 'Bloodletting Lance',
  words: ['corrode', 'pierce', 'drain'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 12cm takes 1d6 pierce, then 1d6 corrosive twice. You heal for the corrosive damage dealt.',
  visual: { preset: 'projectile', color: 0x6fd6a0, size: 8, speed: 1.8 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Bloodletting Lance'), 'pierce'));
    for (let i = 0; i < 2 && foe.alive; i++) {
      drainDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Bloodletting Lance'), 'corrosive'), { canMiss: false });
    }
  },
});

registerSpell({
  name: 'Marrow Crush',
  words: ['corrode', 'shatter', 'drain'],
  actionType: 'main',
  range: R(3),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 3cm takes 2d6 shatter, then 1d6 corrosive twice; you heal for the corrosive damage dealt. ' +
    '25% chance to stun it for 2 turns.',
  visual: { preset: 'conjure', color: 0xb8d070, size: 30, speed: 1.1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Marrow Crush'), 'shatter'));
    for (let i = 0; i < 2 && foe.alive; i++) {
      drainDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Marrow Crush'), 'corrosive'), { canMiss: false });
    }
    if (foe.alive && ctx.rng.chance(0.25)) applyStun(ctx, foe, { duration: 2, type: 'full' });
  },
});

registerSpell({
  name: 'Gnawing Curse',
  words: ['corrode', 'drain', 'curse'],
  actionType: 'main',
  range: R(8),
  targeting: 'enemy',
  dc: 13,
  aoe: { kind: 'circle', radius: R(2) },
  description:
    'Curse one enemy within 8cm and every other enemy within 2cm of it for 4 turns: 1d6 corrosive at the start of each of their turns. ' +
    'You heal for the damage dealt.',
  visual: { preset: 'burst', color: 0x57d6a0, size: 50, speed: 1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const owner = ctx.game.mages.indexOf(ctx.caster);
    for (const victim of [foe, ...foesNear(ctx, foe.pos, R(2), foe)]) {
      applyDot(ctx, victim, {
        name: 'Gnawing Curse',
        duration: 4,
        damage: dmg(0, 'corrosive'),
        damageSpec: '1d6',
        lifestealToIndex: owner,
      });
    }
  },
});
