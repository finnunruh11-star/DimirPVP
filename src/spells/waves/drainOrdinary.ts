// =============================================================================
//  DRAIN WAVE · ORDINARY SPELLS
// -----------------------------------------------------------------------------
//  The plain versions of the all-verb Drain combos that had none: each is its
//  Corrode twin, and the caster heals for all the corrosive damage it deals.
//  Every Twist answers as a reaction and cancels what it answers; Drain Twist
//  stifles, like Corrode Twist, while Shatter and Curse still move bodies.
// =============================================================================

import { MOVE_RANGE } from '../../config/constants';
import { dmg } from '../../core/Damage';
import type { Mage } from '../../core/Mage';
import { applyRot, applyStifle } from '../../effects/classKit';
import {
  applyDebuff,
  applyDot,
  applyStun,
  dealDamage,
  desecrateGround,
  drainDamage,
  rollDice,
  type EffectContext,
} from '../../effects/effects';
import { registerSpell } from '../registry';
import { foesAround, R } from './waterKit';

/** Drain `spec` corrosive from `foe`; the caster heals for it. */
function sip(ctx: EffectContext, foe: Mage, spec: string, label: string, aoe = false): void {
  if (foe.alive) drainDamage(ctx, foe, dmg(rollDice(ctx, spec, label, foe), 'corrosive'), aoe ? { aoe: true } : {});
}

registerSpell({
  name: 'Throttle',
  words: ['drain', 'twist'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 12,
  reaction: true,
  counters: true,
  description:
    'Drain 1d6 corrosive from one enemy within 15cm (you heal for it), and the next action it declares other than ' +
    'moving fails. As a reaction, cancels the answered action.',
  visual: { preset: 'beam', color: 0xc04a5a, size: 6, speed: 1.3 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    sip(ctx, foe, '1d6', 'Throttle');
    applyStifle(ctx, foe);
  },
});

registerSpell({
  name: 'Leeching Shackle',
  words: ['drain', 'bind'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 11,
  description:
    'Drain 1d6 corrosive from one enemy within 10cm and root it for 2 turns. It is drained for 1d3 corrosive at the ' +
    'start of each of its turns for 3 turns. You heal for all of it.',
  visual: { preset: 'beam', color: 0x9a3a4a, size: 7, speed: 1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    sip(ctx, foe, '1d6', 'Leeching Shackle');
    if (!foe.alive) return;
    applyStun(ctx, foe, { duration: 2, type: 'movement' });
    applyDot(ctx, foe, {
      name: 'Leeching Shackle',
      duration: 3,
      damage: dmg(0, 'corrosive'),
      damageSpec: '1d3',
      lifestealToIndex: ctx.game.mages.indexOf(ctx.caster),
    });
  },
});

registerSpell({
  name: 'Marrow Tap',
  words: ['drain', 'shatter'],
  actionType: 'main',
  range: R(5),
  targeting: 'enemy',
  dc: 11,
  description:
    'One enemy within 5cm takes 1d6 shatter and is drained for 1d6 corrosive; you heal for it. 25% chance to stun it ' +
    'for 2 turns; if that fails, it is rooted for 3 turns instead.',
  visual: { preset: 'conjure', color: 0xc8a890, size: 28, speed: 1.1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Marrow Tap'), 'shatter'));
    sip(ctx, foe, '1d6', 'Marrow Tap drain');
    if (!foe.alive) return;
    if (ctx.rng.chance(0.25)) applyStun(ctx, foe, { duration: 2, type: 'full' });
    else applyStun(ctx, foe, { duration: 3, type: 'movement' });
  },
});

registerSpell({
  name: 'Bloodlock',
  words: ['drain', 'twist', 'bind'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  reaction: true,
  counters: true,
  description:
    'One enemy within 12cm is rooted for 2 turns, and the next action it declares other than moving fails and drains ' +
    '2d4 corrosive from it; you heal for it. As a reaction, cancels the answered action.',
  visual: { preset: 'beam', color: 0x9a3a4a, size: 7, speed: 1.2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    applyStun(ctx, foe, { duration: 2, type: 'movement' });
    applyStifle(ctx, foe, { spec: '2d4', drink: true });
  },
});

registerSpell({
  name: 'Leeching Whirl',
  words: ['drain', 'twist', 'shatter'],
  actionType: 'main',
  range: R(3),
  targeting: 'none',
  dc: 14,
  reaction: true,
  counters: true,
  aoe: { kind: 'circle', radius: R(3) },
  description:
    'Every enemy within 3cm takes 1d6 shatter, is drained for 1d4 corrosive (you heal for it) and is turned a quarter ' +
    'circle around you. Stopped by a wall or the field edge: 2d6 shatter more. As a reaction, cancels the answered action.',
  visual: { preset: 'nova', color: 0xc8a890, size: 70, speed: 1.2 },
  cast(ctx) {
    const foes = foesAround(ctx, ctx.caster.pos, R(3));
    if (foes.length === 0) ctx.log('Nothing is close enough to catch in the whirl.');
    for (const foe of foes) {
      dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Leeching Whirl', foe), 'shatter'), { aoe: true });
      sip(ctx, foe, '1d4', 'Leeching Whirl drain', true);
      if (!foe.alive) continue;
      const turn = ctx.game.orbitAround(foe, ctx.caster.pos, ctx.rng.chance(0.5));
      if (turn.slammed && foe.alive) ctx.game.slamDamage(ctx, foe, rollDice(ctx, '2d6', 'Slam', foe), 'shatter');
    }
  },
});

registerSpell({
  name: 'Wringing Hunger',
  words: ['drain', 'twist', 'curse'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  reaction: true,
  counters: true,
  description:
    'Curse one enemy within 12cm for 4 turns. At the start of each of its turns it is drained for 1d4, then 1d6, 1d8 ' +
    'and 1d10 corrosive (you heal for it), and is turned a quarter circle around you. As a reaction, cancels the ' +
    'answered action.',
  visual: { preset: 'beam', color: 0xc04a5a, size: 6, speed: 1.1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    applyDot(ctx, foe, {
      name: 'Wringing Hunger',
      duration: 4,
      damage: dmg(0, 'corrosive'),
      escalateSpecs: ['1d4', '1d6', '1d8', '1d10'],
      orbitSource: true,
      lifestealToIndex: ctx.game.mages.indexOf(ctx.caster),
    });
  },
});

registerSpell({
  name: 'Marrow Clamp',
  words: ['drain', 'bind', 'shatter'],
  actionType: 'main',
  range: R(2),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 2cm takes 1d6 shatter and is drained for 1d6 corrosive (you heal for it). It is stunned for ' +
    '2 turns, rooted for 3 and moves 40% slower for 6.',
  visual: { preset: 'conjure', color: 0x9a3a4a, size: 30, speed: 1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Marrow Clamp'), 'shatter'));
    sip(ctx, foe, '1d6', 'Marrow Clamp drain');
    if (!foe.alive) return;
    applyStun(ctx, foe, { duration: 2, type: 'full' });
    applyStun(ctx, foe, { duration: 3, type: 'movement' });
    applyDebuff(ctx, foe, { name: 'Clamped', duration: 6, mods: { moveRange: -Math.round(MOVE_RANGE * 0.4) } });
  },
});

registerSpell({
  name: 'Leech Shackles',
  words: ['drain', 'bind', 'curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 12,
  description:
    'Root one enemy within 15cm for 4 turns and set a stacking leech on it: each cast adds a stack (up to 4), and it ' +
    'drains 1d2 corrosive per stack at the start of each of its turns; you heal for it. The leech lets go two turns ' +
    'after its last stack; casting again at 4 stacks only refreshes it.',
  visual: { preset: 'beam', color: 0x9a3a4a, size: 6, speed: 1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    applyStun(ctx, foe, { duration: 4, type: 'movement' });
    applyRot(ctx, foe, { name: 'Leech Shackles', spec: '1d2', max: 4, turns: 2, drink: true });
  },
});

registerSpell({
  name: 'Bloodburst',
  words: ['drain', 'shatter', 'curse'],
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 14,
  aoe: { kind: 'circle', radius: R(3) },
  description:
    'At a point within 12cm, every enemy within 3cm takes 1d6 shatter and is drained for 1d6 corrosive (you heal for ' +
    'it), with a 25% chance to be stunned for 2 turns. Each also catches a draining plague: 1d3 corrosive per stack ' +
    'at the start of its turns, healing you, up to 3 stacks. It spreads to nearby enemies each turn and loses a stack ' +
    'on any turn no new stack is added.',
  visual: { preset: 'burst', color: 0xc8a890, size: 60, speed: 1 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    for (const foe of foesAround(ctx, ctx.targetPoint, R(3))) {
      dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Bloodburst', foe), 'shatter'), { aoe: true });
      sip(ctx, foe, '1d6', 'Bloodburst drain', true);
      if (!foe.alive) continue;
      if (ctx.rng.chance(0.25)) applyStun(ctx, foe, { duration: 2, type: 'full' });
      applyRot(ctx, foe, { name: 'Bloodburst Plague', spec: '1d3', max: 3, turns: 99, decay: true, spread: R(3), drink: true });
    }
  },
});

registerSpell({
  name: 'Gorging Pit',
  words: ['drain', 'shatter', 'desecrate'],
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 15,
  aoe: { kind: 'circle', radius: R(6) },
  noCastSprite: true,
  description:
    'Open a 6cm pit within 12cm for 4 rounds. Nothing can walk out of it, and it shrinks 1.5cm every round. Affected ' +
    'units inside take 1d6 corrosive + 1d6 shatter at the start of their turn and cannot be healed; you heal for the ' +
    'corrosive. When it closes, affected units still inside take 6d6 shatter.',
  visual: { preset: 'burst', color: 0x6a4a50, size: R(6), speed: 0.8 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    ctx.vfx?.godFx?.('implode', ctx.targetPoint, { size: R(6) * 2 });
    desecrateGround(ctx, ctx.targetPoint, {
      name: 'Gorging Pit',
      radius: R(6),
      turns: 4,
      sealed: true,
      blocksHealing: true,
      lifesteal: true,
      growPerRound: -R(1.5),
      collapse: { spec: '6d6', type: 'shatter' },
      ticks: [
        { spec: '1d6', type: 'corrosive' },
        { spec: '1d6', type: 'shatter' },
      ],
    });
  },
});
