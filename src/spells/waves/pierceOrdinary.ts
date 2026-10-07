// =============================================================================
//  PIERCE WAVE · ORDINARY SPELLS
// -----------------------------------------------------------------------------
//  The plain versions of the all-verb Pierce combos that had none. Pierce is
//  colourless: pierce damage, single targets and dashes. Every Twist here
//  answers as a reaction and cancels what it answers; beside Bind it stifles,
//  otherwise it moves bodies.
// =============================================================================

import { dmg } from '../../core/Damage';
import type { Mage } from '../../core/Mage';
import { dist, type Vec2 } from '../../core/utils';
import { applyStifle } from '../../effects/classKit';
import {
  applyDebuff,
  applyDot,
  applyStun,
  dash,
  dealDamage,
  desecrateGround,
  drainDamage,
  rollDice,
  type EffectContext,
} from '../../effects/effects';
import { registerSpell } from '../registry';
import { drag, everyoneAround, foesAround, foesOnLane, lane, R, strikeAll } from './waterKit';

/** The caster dashes to `foe`'s side, stopping short of its body. */
function closeIn(ctx: EffectContext, foe: Mage): void {
  const me = ctx.caster;
  const room = dist(me.pos, foe.pos) - (foe.bodyRadius() + me.bodyRadius() + 2);
  if (me.alive && room > 0.5) dash(ctx, me, { toPoint: foe.pos, distance: room });
}

/** `m` is turned a quarter circle around the caster; a wall or the field edge adds `slam` shatter. */
function wrench(ctx: EffectContext, m: Mage, slam?: string): void {
  if (!m.alive) return;
  const turn = ctx.game.orbitAround(m, ctx.caster.pos, ctx.rng.chance(0.5));
  if (turn.slammed && slam && m.alive) ctx.game.slamDamage(ctx, m, rollDice(ctx, slam, 'Slam', m), 'shatter');
}

registerSpell({
  name: 'Flanking Strike',
  words: ['pierce', 'twist'],
  actionType: 'main',
  range: R(8),
  targeting: 'enemy',
  dc: 12,
  reaction: true,
  counters: true,
  description:
    'Dash to one enemy within 8cm, slip a quarter circle around it and strike it for 2d4 pierce. As a reaction, cancels ' +
    'the answered action.',
  visual: { preset: 'conjure', color: 0xd8f0e0, size: 30, speed: 1.6 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    closeIn(ctx, foe);
    if (ctx.caster.alive) ctx.game.orbitAround(ctx.caster, foe.pos, ctx.rng.chance(0.5));
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d4', 'Flanking Strike'), 'pierce'));
  },
});

registerSpell({
  name: 'Leeching Bolt',
  words: ['pierce', 'drain'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 12,
  description: 'A bolt strikes one enemy within 12cm for 1d6 pierce, then drains 1d6 corrosive from it: you heal for the drained damage.',
  visual: { preset: 'projectile', color: 0xa8f0c8, size: 8, speed: 1.6 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Leeching Bolt'), 'pierce'));
    if (foe.alive) drainDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Leeching Bolt drain'), 'corrosive'));
  },
});

registerSpell({
  name: 'Defiling Lance',
  words: ['pierce', 'desecrate'],
  actionType: 'main',
  range: R(20),
  targeting: 'point',
  dc: 14,
  noCastSprite: true,
  description:
    'Hurl a lance 20cm toward a point: every enemy along its line takes 2d6 pierce. Under each affected unit it ' +
    'pierces (Desecrate spares black units and minions) the ground is fouled for 3 turns: affected units there take ' +
    '1d6 pierce at the start of their turns and cannot be healed.',
  visual: { preset: 'beam', color: 0xb0a0b8, size: 9, speed: 1.8 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const { from, to } = lane(ctx, ctx.targetPoint, R(20));
    const pierced = foesOnLane(ctx, from, to);
    const unhallowed = pierced.filter((m) => ctx.game.isDesecrationAffected(m));
    strikeAll(ctx, pierced, [['2d6', 'pierce']], 'Defiling Lance');
    for (const m of unhallowed) {
      desecrateGround(ctx, m.pos, {
        name: 'Defiled Wound',
        radius: R(1.5),
        turns: 3,
        blocksHealing: true,
        ticks: [{ spec: '1d6', type: 'pierce' }],
      });
    }
  },
});

registerSpell({
  name: 'Pinning Shot',
  words: ['pierce', 'twist', 'bind'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  reaction: true,
  counters: true,
  description:
    'One enemy within 12cm takes 1d6 pierce and is rooted for 2 turns, and the next action it declares other than ' +
    'moving fails. As a reaction, cancels the answered action.',
  visual: { preset: 'projectile', color: 0xb8e8f0, size: 7, speed: 1.8 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Pinning Shot'), 'pierce'));
    if (!foe.alive) return;
    applyStun(ctx, foe, { duration: 2, type: 'movement' });
    applyStifle(ctx, foe);
  },
});

registerSpell({
  name: 'Corkscrew Dash',
  words: ['pierce', 'twist', 'shatter'],
  actionType: 'main',
  range: R(8),
  targeting: 'point',
  dc: 14,
  reaction: true,
  counters: true,
  noCastSprite: true,
  description:
    'Dash up to 8cm toward a point, spinning. Every enemy you pass takes 2d4 pierce and 1d4 shatter and is turned a ' +
    'quarter circle around where you stop; stopped by a wall or the field edge, it takes 2d6 shatter more. As a ' +
    'reaction, cancels the answered action.',
  visual: { preset: 'beam', color: 0xf0e8b0, size: 10, speed: 2 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const start: Vec2 = { ...ctx.caster.pos };
    dash(ctx, ctx.caster, { toPoint: ctx.targetPoint, distance: R(8) });
    const passed = foesOnLane(ctx, start, ctx.caster.pos, R(1));
    if (passed.length === 0) ctx.log('The corkscrew passes nobody.');
    strikeAll(ctx, passed, [['2d4', 'pierce'], ['1d4', 'shatter']], 'Corkscrew Dash');
    for (const m of passed) wrench(ctx, m, '2d6');
  },
});

registerSpell({
  name: 'Leeching Spiral',
  words: ['pierce', 'twist', 'drain'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 13,
  reaction: true,
  counters: true,
  description:
    'One enemy within 10cm takes 1d6 pierce and is turned a quarter circle around you, then you drain 1d6 corrosive ' +
    'from it and heal for the drained damage. As a reaction, cancels the answered action.',
  visual: { preset: 'beam', color: 0x98e8c0, size: 7, speed: 1.4 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Leeching Spiral'), 'pierce'));
    wrench(ctx, foe);
    if (foe.alive) drainDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Leeching Spiral drain'), 'corrosive'));
  },
});

registerSpell({
  name: 'Barbed Hook',
  words: ['pierce', 'twist', 'curse'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  reaction: true,
  counters: true,
  description:
    'Lodge a barbed hook in one enemy within 12cm: 1d6 pierce, then 1d4 pierce at the start of each of its turns for 3 ' +
    'turns, each tick turning it a quarter circle around you. As a reaction, cancels the answered action.',
  visual: { preset: 'projectile', color: 0xf0c0a0, size: 7, speed: 1.6 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Barbed Hook'), 'pierce'));
    if (!foe.alive) return;
    applyDot(ctx, foe, { name: 'Barbed Hook', duration: 3, damage: dmg(0, 'pierce'), damageSpec: '1d4', orbitSource: true });
  },
});

registerSpell({
  name: 'Bloodhook',
  words: ['pierce', 'bind', 'drain'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 13,
  description:
    'Harpoon one enemy within 10cm for 1d6 pierce. It is dragged up to 4cm toward you and rooted for 2 turns, and you ' +
    'drain 1d4 corrosive from it, healing for the drained damage.',
  visual: { preset: 'beam', color: 0x90d8c8, size: 7, speed: 1.2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Bloodhook'), 'pierce'));
    if (!foe.alive) return;
    drag(ctx, foe, ctx.caster.pos, 4);
    if (foe.alive) applyStun(ctx, foe, { duration: 2, type: 'movement' });
    if (foe.alive) drainDamage(ctx, foe, dmg(rollDice(ctx, '1d4', 'Bloodhook drain'), 'corrosive'));
  },
});

registerSpell({
  name: 'Marrow Bolt',
  words: ['pierce', 'shatter', 'drain'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  description:
    'A bolt bursts inside one enemy within 12cm: 2d6 pierce, then you drain 1d6 corrosive from it and heal for the ' +
    'drained damage. Every other enemy within 2cm of it takes 1d4 shatter.',
  visual: { preset: 'projectile', color: 0xc8e0a8, size: 9, speed: 1.6 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const at: Vec2 = { ...foe.pos };
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Marrow Bolt'), 'pierce'));
    if (foe.alive) drainDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Marrow Bolt drain'), 'corrosive'));
    strikeAll(ctx, foesAround(ctx, at, R(2)).filter((m) => m !== foe), [['1d4', 'shatter']], 'Marrow splinters');
  },
});

registerSpell({
  name: 'Exsanguinate',
  words: ['pierce', 'drain', 'curse'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 10cm takes 1d6 pierce and bleeds dry: 1d4 corrosive at the start of its turns for 3 turns, and ' +
    'you heal for each tick. Every other unit within 2cm of it but you, your side included, bleeds dry the same way.',
  visual: { preset: 'beam', color: 0xc87870, size: 8, speed: 1.2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Exsanguinate'), 'pierce'));
    const bled = everyoneAround(ctx, foe.pos, R(2)).filter((m) => m !== ctx.caster && m !== foe);
    for (const m of [foe, ...bled]) {
      if (!m.alive) continue;
      applyDot(ctx, m, {
        name: 'Bled Dry',
        key: 'dot:bled-dry',
        duration: 3,
        damage: dmg(0, 'corrosive'),
        damageSpec: '1d4',
        lifestealToIndex: ctx.game.mages.indexOf(ctx.caster),
      });
    }
  },
});

registerSpell({
  name: 'Harvest Spear',
  words: ['pierce', 'drain', 'desecrate'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 15,
  description:
    'Impale one enemy within 15cm for 2d6 pierce and drain 2d6 corrosive from it: you heal for the drained damage. ' +
    'If it is an affected unit (Desecrate spares black units and minions), drain 2d6 more, and it cannot be healed ' +
    'for 3 turns.',
  visual: { preset: 'projectile', color: 0x8a6070, size: 10, speed: 1.7 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const unhallowed = ctx.game.isDesecrationAffected(foe);
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Harvest Spear'), 'pierce'));
    if (foe.alive) drainDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Harvest Spear drain'), 'corrosive'));
    if (!unhallowed || !foe.alive) return;
    drainDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Harvest Spear feast'), 'corrosive'));
    if (foe.alive) applyDebuff(ctx, foe, { name: 'Festering', key: 'debuff:kit-no-heal', duration: 3, mods: {}, healMult: 0 });
  },
});
