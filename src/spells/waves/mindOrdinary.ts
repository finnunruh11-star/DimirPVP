// =============================================================================
//  MIND WAVE · ORDINARY SPELLS
// -----------------------------------------------------------------------------
//  The plain versions of the all-noun Mind combos. Mind spoils minds: sanity
//  damage, burning thoughts, conducting stacks, a mind that cannot tell what is
//  real. Shadow amplifies; Lightning always scales with the cast roll.
//  (Reality Mind's swap, Fire Mind's and Lightning Mind's weapon enchants are
//  now their Hexcraft / Objects class versions in mindClass.ts.)
// =============================================================================

import { RANGE_UNIT } from '../../config/constants';
import { dmg } from '../../core/Damage';
import type { BlueflareStatus } from '../../core/Status';
import { UNREALITY_KEY } from '../../effects/classKit';
import { applyBlueflareStacks, applyDebuff, applyDot, dealDamage, rollDice } from '../../effects/effects';
import { applyMindLightningStack, mindLightningDamage } from '../mindLightning';
import { registerSpell } from '../registry';
import { castPower } from './classWave';

const R = (units: number): number => units * RANGE_UNIT;

registerSpell({
  name: 'Nightmare',
  words: ['mind', 'shadow'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 11,
  description:
    'One enemy within 15cm takes 1d6 sanity. A nightmare then clings to it: 1d3 sanity at the start of its turns ' +
    'for 3 turns, or 6 turns if it stands in a shadow.',
  visual: { preset: 'beam', color: 0x9b7bff, size: 6, speed: 1.2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const shaded = ctx.game.isInShadow(foe);
    dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Nightmare'), 'sanity'));
    if (!foe.alive) return;
    applyDot(ctx, foe, {
      name: 'Nightmare',
      key: 'dot:nightmare',
      duration: shaded ? 6 : 3,
      damage: dmg(0, 'sanity'),
      damageSpec: '1d3',
    });
  },
});

registerSpell({
  name: 'Unreality',
  words: ['reality', 'mind'],
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 12,
  description:
    'One enemy within 20cm takes 1d6 sanity and loses its grip on what is real for 3 turns: every single-target ' +
    'spell or basic attack it declares has a 50% chance to strike a phantom and do nothing.',
  visual: { preset: 'beam', color: 0xff5599, size: 7, speed: 1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Unreality'), 'sanity'));
    if (!foe.alive) return;
    applyDebuff(ctx, foe, { name: 'Unreality', key: UNREALITY_KEY, duration: 3, mods: {} });
  },
});

registerSpell({
  name: 'Thoughtfire',
  words: ['fire', 'mind'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 11,
  description:
    'One enemy within 15cm takes 1d4 sanity and gains 2 Blueflare. If it already carried Blueflare, the flare ' +
    'pulses at once.',
  visual: { preset: 'beam', color: 0x56bfff, size: 8, speed: 1.3 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const smouldering = ((foe.statuses.find((s) => s.kind === 'blueflare') as BlueflareStatus | undefined)?.stacks ?? 0) > 0;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '1d4', 'Thoughtfire'), 'sanity'));
    if (!foe.alive) return;
    applyBlueflareStacks(ctx, foe, 2);
    if (smouldering && foe.alive) ctx.game.pulseBlueflare(foe);
  },
});

registerSpell({
  name: 'Synaptic Bolt',
  words: ['lightning', 'mind'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 11,
  description:
    'A bolt strikes one enemy within 15cm: it gains 1 Mindconduct stack plus 1 per 10 Lightning power, then takes ' +
    '1d4 sanity, 50% more for every stack after the first.',
  visual: { preset: 'beam', color: 0x79bfff, size: 8, speed: 1.8 },
  async cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const power = castPower(ctx);
    await (ctx.vfx?.mindLightningBolt?.(ctx.caster.pos, foe.pos) ?? ctx.vfx?.lightningBolt?.(ctx.caster.pos, foe.pos));
    let stacks = 0;
    for (let i = 0; i <= Math.floor(power / 10); i++) stacks = applyMindLightningStack(foe);
    const base = rollDice(ctx, '1d4', 'Synaptic Bolt');
    dealDamage(ctx, foe, dmg(Math.ceil(mindLightningDamage(base, stacks)), 'sanity'));
  },
});
