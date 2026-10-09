// =============================================================================
//  LAST CORNERS · ORDINARY SPELLS
// -----------------------------------------------------------------------------
//  The plain versions of the corner class combos (what a modifier casts):
//  Shatter Twist, which answers and cancels like every Twist; Fire Pain, red
//  Fire that burns into the mind; and Drain Mind, black thirst for sanity.
// =============================================================================

import type { FireStatus } from '../../core/Status';
import { applyFireStacks, heal } from '../../effects/effects';
import { registerSpell } from '../registry';
import { hit, R } from './waterKit';

registerSpell({
  name: 'Wrench',
  words: ['shatter', 'twist'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 12,
  reaction: true,
  counters: true,
  description:
    'One enemy within 15cm takes 1d6 shatter and is turned a quarter circle around you; if a wall or the field edge ' +
    'stops it, it takes 2d6 shatter more. As a reaction, cancels the answered action.',
  visual: { preset: 'beam', color: 0xb8c878, size: 7, speed: 1.3 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d6', 'shatter', 'Wrench');
    if (!foe.alive) return;
    if (ctx.game.orbitAround(foe, ctx.caster.pos, ctx.rng.chance(0.5)).slammed) {
      hit(ctx, foe, '2d6', 'shatter', 'Wrench slam', { canMiss: false });
    }
  },
});

registerSpell({
  name: 'Searing Agony',
  words: ['fire', 'pain'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 11,
  description:
    'One enemy within 15cm takes 1d4 sanity for every Fire stack burning on it (at least 1d4, at most 6d4), then gains 2 Fire.',
  visual: { preset: 'beam', color: 0xe0603a, size: 6, speed: 1.3 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const stacks = (foe.statuses.find((s) => s.kind === 'fire') as FireStatus | undefined)?.stacks ?? 0;
    hit(ctx, foe, `${Math.min(6, Math.max(1, stacks))}d4`, 'sanity', 'Searing Agony');
    if (foe.alive) applyFireStacks(ctx, foe, 2);
  },
});

registerSpell({
  name: 'Thought Theft',
  words: ['drain', 'mind'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 11,
  description: 'One enemy within 12cm takes 2d4 sanity, and you recover as much sanity as it lost.',
  visual: { preset: 'beam', color: 0x57d6a0, size: 6, speed: 1.1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const drunk = hit(ctx, foe, '2d4', 'sanity', 'Thought Theft');
    if (drunk > 0 && ctx.caster.alive) {
      ctx.vfx?.drainParticles?.(foe.pos, ctx.caster.pos);
      heal(ctx, ctx.caster, drunk, 'sanity');
    }
  },
});
