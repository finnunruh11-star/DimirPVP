// =============================================================================
//  SHADOW · ORDINARY SPELLS
// -----------------------------------------------------------------------------
//  Shadow is black and amplifies: it makes the word beside it hit harder, leans
//  toward shadow damage, and now and then feeds on units standing in shadows.
//  These are the three noun combos that had no ordinary spell yet. Red and black
//  together are risky damage; a black majority hits allies too.
// =============================================================================

import { dmg } from '../../core/Damage';
import type { Mage } from '../../core/Mage';
import { dist, type Vec2 } from '../../core/utils';
import { applyFireStacks, dealDamage, rollDice } from '../../effects/effects';
import { registerSpell } from '../registry';
import { castPower } from './classWave';
import { everyoneAround, hit, PAIN_COLOR, R, strikeAll } from './waterKit';

const ASH = 0x9a8f8a;
const NERVE = 0xb86bd8;

/** `spec` with a flat bonus added. */
const plus = (spec: string, bonus: number): string => (bonus > 0 ? `${spec}+${bonus}` : spec);

registerSpell({
  name: 'Ashen Bolt',
  words: ['lightning', 'fire', 'shadow'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 14,
  description:
    'A bolt strikes one enemy within 15cm: 1d6 heat and 1d6 shadow, each plus 1 per 5 Lightning power, and 1 Fire. ' +
    'It then leaps on to 1 more unit per 6 Lightning power, each the nearest unit within a third of the Lightning ' +
    'power in cm (at least 2cm) of the last, friend or foe but never you or a unit already struck, and strikes it ' +
    'the same way. A struck unit standing in a shadow takes its Fire pulse at once.',
  visual: { preset: 'beam', color: ASH, size: 9, speed: 1.8 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const power = castPower(ctx);
    const spec = plus('1d6', Math.floor(power / 5));
    const reach = R(Math.max(2, power / 3));
    const struck = new Set<Mage>();
    let from: Vec2 = { ...ctx.caster.pos };
    let current: Mage | undefined = foe;
    for (let leap = 0; current && leap <= Math.floor(power / 6); leap++) {
      void ctx.vfx?.lightningBolt?.(from, current.pos);
      hit(ctx, current, spec, 'heat', 'Ashen Bolt', { canMiss: false, aoe: leap > 0 });
      hit(ctx, current, spec, 'shadow', 'Ashen Bolt', { canMiss: false, aoe: leap > 0 });
      if (current.alive) applyFireStacks(ctx, current, 1);
      if (current.alive && ctx.game.isInShadow(current)) ctx.game.pulseFire(current);
      struck.add(current);
      const here: Vec2 = { ...current.pos };
      from = here;
      current = ctx.game.mages
        .filter(
          (m) =>
            m.alive &&
            m !== ctx.caster &&
            !struck.has(m) &&
            !ctx.game.isUnreachable(m) &&
            dist(m.pos, here) <= reach + m.bodyRadius()
        )
        .sort((a, b) => dist(a.pos, here) - dist(b.pos, here))[0];
    }
  },
});

registerSpell({
  name: 'Nerve Storm',
  words: ['lightning', 'shadow', 'pain'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 14,
  description:
    'A bolt strikes one enemy within 15cm: 1d6 sanity and 1d6 shadow, each plus 1 per 5 Lightning power. The shock ' +
    'spreads: every other unit within a quarter of the Lightning power in cm of it (at least 2cm), allies and you ' +
    'included, takes 1d4 sanity plus 1 per 6 Lightning power, twice that if it stands in a shadow.',
  visual: { preset: 'beam', color: NERVE, size: 8, speed: 1.9 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const power = castPower(ctx);
    const spec = plus('1d6', Math.floor(power / 5));
    void ctx.vfx?.lightningBolt?.(ctx.caster.pos, foe.pos);
    hit(ctx, foe, spec, 'sanity', 'Nerve Storm', { canMiss: false });
    hit(ctx, foe, spec, 'shadow', 'Nerve Storm', { canMiss: false });
    const shock = rollDice(ctx, plus('1d4', Math.floor(power / 6)), 'Nerve Storm shock');
    for (const m of everyoneAround(ctx, foe.pos, R(Math.max(2, power / 4)))) {
      if (m === foe || !m.alive) continue;
      void ctx.vfx?.lightningBolt?.(foe.pos, m.pos);
      dealDamage(ctx, m, dmg(ctx.game.isInShadow(m) ? shock * 2 : shock, 'sanity'), { canMiss: false, aoe: true });
    }
  },
});

registerSpell({
  name: 'Searing Dread',
  words: ['fire', 'shadow', 'pain'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 12cm takes 1d6 heat and 1d6 sanity and gains 2 Fire. Every other unit within 2cm of it, ' +
    'allies included, takes 1d4 sanity. If it stands in a shadow, its Fire pulses at once.',
  visual: { preset: 'projectile', color: PAIN_COLOR, size: 11, speed: 1.3 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d6', 'heat', 'Searing Dread');
    hit(ctx, foe, '1d6', 'sanity', 'Searing Dread');
    if (foe.alive) applyFireStacks(ctx, foe, 2);
    strikeAll(ctx, everyoneAround(ctx, foe.pos, R(2)).filter((m) => m !== foe), [['1d4', 'sanity']], 'Searing Dread');
    if (foe.alive && ctx.game.isInShadow(foe)) ctx.game.pulseFire(foe);
  },
});
