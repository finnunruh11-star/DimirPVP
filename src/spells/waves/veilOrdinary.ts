// =============================================================================
//  VEIL WAVE · ORDINARY SPELLS
// -----------------------------------------------------------------------------
//  The plain versions of the all-verb Veil combos that had none. Veil is blue:
//  less damage, more denial, evasion and hit-and-run. Every Twist here stifles,
//  answers as a reaction and cancels what it answers.
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
  rollDice,
  type EffectContext,
} from '../../effects/effects';
import { registerSpell } from '../registry';

const R = (units: number): number => units * RANGE_UNIT;

/** The caster slips into a half veil for `turns`. */
function slipAway(ctx: EffectContext, turns = 2): void {
  if (ctx.caster.alive) applyInvisibility(ctx, ctx.caster, { duration: turns, mode: 'partial' });
}

/** Hit and run: the caster dashes `cm` straight away from `foe`. */
function dashAway(ctx: EffectContext, foe: Mage, cm: number): void {
  const me = ctx.caster;
  if (me.alive) dash(ctx, me, { direction: { x: me.x - foe.x, y: me.y - foe.y }, distance: R(cm) });
}

registerSpell({
  name: 'Veiled Siphon',
  words: ['veil', 'drain'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 11,
  description:
    'Drain 2d4 corrosive from one enemy within 10cm; you heal for the damage dealt. ' +
    'Then you dash 2cm straight away from it.',
  visual: { preset: 'projectile', color: 0x6fb8a0, size: 9, speed: 1.4 },
  manualCastVisual: true,
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    drainDamage(ctx, foe, dmg(rollDice(ctx, '2d4', 'Veiled Siphon'), 'corrosive'));
    dashAway(ctx, foe, 2);
  },
});

registerSpell({
  name: 'Muffle',
  words: ['veil', 'twist'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 12,
  reaction: true,
  counters: true,
  description:
    'The next action one enemy within 15cm declares, other than moving, fails. You gain a half veil for 2 turns. ' +
    'As a reaction, cancels the answered action.',
  visual: { preset: 'beam', color: 0x9ab8d8, size: 5, speed: 1.4 },
  cast(ctx) {
    if (!ctx.target) return;
    applyStifle(ctx, ctx.target);
    slipAway(ctx);
  },
});

registerSpell({
  name: 'Shrouded Snare',
  words: ['veil', 'bind'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 11,
  description: 'Root one enemy within 12cm for 2 turns. You and every ally within 3cm of you gain a half veil for 2 turns.',
  visual: { preset: 'beam', color: 0x8ad1ff, size: 6, speed: 1.2 },
  cast(ctx) {
    if (!ctx.target) return;
    applyStun(ctx, ctx.target, { duration: 2, type: 'movement' });
    for (const ally of ctx.game.mages) {
      if (!ally.alive || ally.team !== ctx.caster.team || dist(ally.pos, ctx.caster.pos) > R(3) + ally.bodyRadius()) continue;
      applyInvisibility(ctx, ally, { duration: 2, mode: 'partial' });
    }
  },
});

registerSpell({
  name: 'Unseen Leech',
  words: ['veil', 'curse', 'drain'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  description:
    'Curse one enemy within 12cm for 4 turns: 2d4 corrosive at the start of its turns; you heal for the damage dealt. ' +
    'You gain a half veil for 2 turns.',
  visual: { preset: 'projectile', color: 0x5f9f8a, size: 10, speed: 1.2 },
  cast(ctx) {
    if (!ctx.target) return;
    applyDot(ctx, ctx.target, {
      name: 'Unseen Leech',
      duration: 4,
      damage: dmg(0, 'corrosive'),
      damageSpec: '2d4',
      lifestealToIndex: ctx.game.mages.indexOf(ctx.caster),
    });
    slipAway(ctx);
  },
});

registerSpell({
  name: 'Smother',
  words: ['veil', 'curse', 'twist'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  reaction: true,
  counters: true,
  description:
    'Curse one enemy within 12cm for 3 turns: 1d4 shadow at the start of its turns, and each tick makes its next action ' +
    'other than moving fail. You gain a half veil for 2 turns. As a reaction, cancels the answered action.',
  visual: { preset: 'beam', color: 0x8a7fb0, size: 6, speed: 1.2 },
  cast(ctx) {
    if (!ctx.target) return;
    applyDot(ctx, ctx.target, {
      name: 'Smother',
      duration: 3,
      damage: dmg(0, 'shadow'),
      damageSpec: '1d4',
      stifleOnTick: true,
    });
    slipAway(ctx);
  },
});

registerSpell({
  name: 'Leeching Shot',
  words: ['veil', 'drain', 'pierce'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 15cm takes 2d4 pierce, then is drained for 1d6 corrosive; ' +
    'you heal for the damage dealt. Then you gain a half veil for 2 turns.',
  visual: { preset: 'projectile', color: 0x6fd6b0, size: 8, speed: 1.8 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d4', 'Leeching Shot'), 'pierce'));
    if (foe.alive) drainDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Leeching Shot'), 'corrosive'), { canMiss: false });
    slipAway(ctx);
  },
});

registerSpell({
  name: 'Hollowing Blow',
  words: ['veil', 'drain', 'shatter'],
  actionType: 'main',
  range: R(4),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 4cm takes 2d6 shatter, then is drained for 1d6 corrosive; you heal for the damage dealt. ' +
    'If it was veiled, it is also stunned for 2 turns. Then you gain a half veil for 2 turns.',
  visual: { preset: 'conjure', color: 0x8ab890, size: 30, speed: 1.1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const wasHidden = ctx.game.isVeiled(foe);
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Hollowing Blow'), 'shatter'));
    if (foe.alive) drainDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Hollowing Blow'), 'corrosive'), { canMiss: false });
    if (wasHidden && foe.alive) applyStun(ctx, foe, { duration: 2, type: 'full' });
    slipAway(ctx);
  },
});

registerSpell({
  name: 'Gagging Siphon',
  words: ['veil', 'drain', 'twist'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  reaction: true,
  counters: true,
  description:
    'Drain 1d6 corrosive from one enemy within 12cm (you heal for the damage dealt); its next action other than moving fails. ' +
    'You gain a half veil for 2 turns. As a reaction, cancels the answered action.',
  visual: { preset: 'beam', color: 0x6fc0b0, size: 6, speed: 1.3 },
  manualCastVisual: true,
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    drainDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Gagging Siphon'), 'corrosive'));
    applyStifle(ctx, foe);
    slipAway(ctx);
  },
});

registerSpell({
  name: 'Shrouded Tether',
  words: ['veil', 'drain', 'bind'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 13,
  description:
    'Tether one enemy within 10cm to you for 3 turns: it cannot move further than 4cm from you. For 3 turns it takes ' +
    '1d4 corrosive at the start of its turns; you heal for the damage dealt. You gain a half veil for 2 turns.',
  visual: { preset: 'beam', color: 0x6ab8c0, size: 7, speed: 1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const owner = ctx.game.mages.indexOf(ctx.caster);
    ctx.game.tether(owner, foe, ctx.caster, R(4), 3);
    applyDot(ctx, foe, {
      name: 'Shrouded Tether',
      duration: 3,
      damage: dmg(0, 'corrosive'),
      damageSpec: '1d4',
      lifestealToIndex: owner,
    });
    slipAway(ctx);
  },
});

registerSpell({
  name: 'Silencing Shot',
  words: ['veil', 'pierce', 'twist'],
  actionType: 'main',
  range: R(18),
  targeting: 'enemy',
  dc: 13,
  reaction: true,
  counters: true,
  description:
    'One enemy within 18cm takes 2d4 pierce, and its next action other than moving fails. You gain a half veil for 2 turns. ' +
    'As a reaction, cancels the answered action.',
  visual: { preset: 'projectile', color: 0xc0d0e8, size: 7, speed: 1.9 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d4', 'Silencing Shot'), 'pierce'));
    applyStifle(ctx, foe);
    slipAway(ctx);
  },
});

registerSpell({
  name: 'Shattering Hush',
  words: ['veil', 'shatter', 'twist'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 13,
  reaction: true,
  counters: true,
  description:
    'One enemy within 10cm takes 2d4 shatter, and its next action other than moving fails. If it was veiled, it is also ' +
    'stunned for 2 turns. As a reaction, cancels the answered action.',
  visual: { preset: 'conjure', color: 0xb8c8d8, size: 28, speed: 1.2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const wasHidden = ctx.game.isVeiled(foe);
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d4', 'Shattering Hush'), 'shatter'));
    applyStifle(ctx, foe);
    if (wasHidden && foe.alive) applyStun(ctx, foe, { duration: 2, type: 'full' });
  },
});

registerSpell({
  name: 'Silent Snare',
  words: ['veil', 'twist', 'bind'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  reaction: true,
  counters: true,
  description:
    'One enemy within 12cm is rooted for 2 turns, and its next action other than moving fails. You gain a half veil ' +
    'for 2 turns. As a reaction, cancels the answered action.',
  visual: { preset: 'beam', color: 0x8ac8e8, size: 6, speed: 1.2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    applyStun(ctx, foe, { duration: 2, type: 'movement' });
    applyStifle(ctx, foe);
    slipAway(ctx);
  },
});
