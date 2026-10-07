// =============================================================================
//  BIND WAVE · ORDINARY SPELLS
// -----------------------------------------------------------------------------
//  The plain versions of the all-verb Bind combos that had none. Bind holds a
//  body still; every Twist answers as a reaction, cancels what it answers and,
//  beside Bind, stifles.
// =============================================================================

import { dmg } from '../../core/Damage';
import { applyStifle } from '../../effects/classKit';
import { applyDot, applyStun, dealDamage, rollDice } from '../../effects/effects';
import { registerSpell } from '../registry';
import { R } from './waterKit';

const IRON = 0x6a8ad8;

registerSpell({
  name: 'Arrest',
  words: ['bind', 'twist'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 12,
  reaction: true,
  counters: true,
  description:
    'One enemy within 12cm is rooted for 2 turns, and the next action it declares other than moving fails. As a ' +
    'reaction, cancels the answered action.',
  visual: { preset: 'beam', color: IRON, size: 6, speed: 1.3 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    applyStun(ctx, foe, { duration: 2, type: 'movement' });
    applyStifle(ctx, foe);
  },
});

registerSpell({
  name: 'Binding Curse',
  words: ['bind', 'curse'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 11,
  description:
    'Curse one enemy within 12cm for 3 turns: 1d4 shadow at the start of each of its turns, and each tick roots it ' +
    'until its next turn.',
  visual: { preset: 'beam', color: 0x6a7bd0, size: 6, speed: 1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    applyDot(ctx, foe, {
      name: 'Binding Curse',
      duration: 3,
      damage: dmg(0, 'shadow'),
      damageSpec: '1d4',
      stunChance: 1,
      stunType: 'movement',
    });
  },
});

registerSpell({
  name: 'Shatterlock',
  words: ['bind', 'twist', 'shatter'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 14,
  reaction: true,
  counters: true,
  description:
    'One enemy within 10cm takes 1d6 shatter, 2d6 if it is already rooted. Then it is rooted for 2 turns, and the ' +
    'next action it declares other than moving fails. As a reaction, cancels the answered action.',
  visual: { preset: 'conjure', color: 0xa8a090, size: 28, speed: 1.2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const spec = foe.isStunned('movement') ? '2d6' : '1d6';
    dealDamage(ctx, foe, dmg(rollDice(ctx, spec, 'Shatterlock'), 'shatter'));
    if (!foe.alive) return;
    applyStun(ctx, foe, { duration: 2, type: 'movement' });
    applyStifle(ctx, foe);
  },
});

registerSpell({
  name: 'Hex Gag',
  words: ['bind', 'twist', 'curse'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  reaction: true,
  counters: true,
  description:
    'One enemy within 12cm is rooted for 2 turns and cursed for 3: 1d3 shadow at the start of each of its turns, and ' +
    'each tick makes the next action it declares other than moving fail. As a reaction, cancels the answered action.',
  visual: { preset: 'beam', color: 0x7a6ab8, size: 6, speed: 1.1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    applyStun(ctx, foe, { duration: 2, type: 'movement' });
    applyDot(ctx, foe, { name: 'Hex Gag', duration: 3, damage: dmg(0, 'shadow'), damageSpec: '1d3', stifleOnTick: true });
  },
});
