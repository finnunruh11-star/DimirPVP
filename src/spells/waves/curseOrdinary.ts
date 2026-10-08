// =============================================================================
//  CURSE WAVE · ORDINARY SPELLS
// -----------------------------------------------------------------------------
//  The plain versions of the all-verb Curse combos that had none. A curse pays
//  out a great deal over several turns; beside Twist it moves bodies, and as
//  every Twist it answers as a reaction and cancels what it answers.
// =============================================================================

import { dmg } from '../../core/Damage';
import { applyDot, dealDamage, rollDice } from '../../effects/effects';
import { registerSpell } from '../registry';
import { R } from './waterKit';

registerSpell({
  name: "Hangman's Noose",
  words: ['curse', 'twist'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 12,
  reaction: true,
  counters: true,
  description:
    'Curse one enemy within 12cm for 4 turns: at the start of each of its turns it takes 2d4 shadow and is dragged 2cm ' +
    'toward you. As a reaction, cancels the answered action.',
  visual: { preset: 'beam', color: 0x7a3b8f, size: 6, speed: 1.1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    applyDot(ctx, foe, {
      name: "Hangman's Noose",
      duration: 4,
      damage: dmg(0, 'shadow'),
      damageSpec: '2d4',
      drift: { px: -R(2) },
    });
  },
});

registerSpell({
  name: 'Shattering Spiral',
  words: ['curse', 'shatter', 'twist'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 14,
  reaction: true,
  counters: true,
  description:
    'One enemy within 10cm takes 2d6 shatter and is cursed for 4 turns: 1d6 shatter at the start of each of its turns, ' +
    'each tick turning it a quarter circle around you. As a reaction, cancels the answered action.',
  visual: { preset: 'beam', color: 0x9a7a6a, size: 7, speed: 1.2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Shattering Spiral'), 'shatter'));
    if (!foe.alive) return;
    applyDot(ctx, foe, { name: 'Shattering Spiral', duration: 4, damage: dmg(0, 'shatter'), damageSpec: '1d6', orbitSource: true });
  },
});
