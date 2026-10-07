// =============================================================================
//  LIGHTNING · ORDINARY SPELLS
// -----------------------------------------------------------------------------
//  Lightning is red and gambles: on the cast roll, on dice of its own and on
//  where it leaps next. With black beside it nothing contains it: allies and
//  the caster are fair game. These are the noun combos that had no ordinary
//  spell yet.
// =============================================================================

import { dmg } from '../../core/Damage';
import type { Mage } from '../../core/Mage';
import { dist, type Vec2 } from '../../core/utils';
import { applyFireStacks, dealDamage, rollDice, type EffectContext } from '../../effects/effects';
import { registerSpell } from '../registry';
import { castPower, lightningGamble } from './classWave';
import { cmApart, everyoneAround, hit, R } from './waterKit';

const WRITHE = 0xc85ad8;
const HELL = 0xe0503c;

/** `spec` with a flat bonus added. */
const plus = (spec: string, bonus: number): string => (bonus > 0 ? `${spec}+${bonus}` : spec);

/** Hops a hellbolt may make before it burns out, so no run of luck bounces forever. */
const MAX_BOUNCES = 50;

registerSpell({
  name: 'Writhing Bolt',
  words: ['lightning', 'pain'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 12,
  description:
    'A bolt strikes one enemy within 15cm: 1d6 heat and 1d6 sanity, each plus 1 per 5 Lightning power. It writhes on ' +
    'for 1 more jump per 5 Lightning power, each into a random unit within a third of the Lightning power in cm (at ' +
    'least 2cm) of the last, friend or foe and you included, never the one it just left: 1d6 sanity plus 1 per 6 ' +
    'Lightning power. Lightning gamble: on a 1 the first strike hits you too; on a 6 every strike deals double.',
  visual: { preset: 'beam', color: WRITHE, size: 8, speed: 1.8 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const power = castPower(ctx);
    const roll = lightningGamble(ctx);
    const mult = roll === 6 ? 2 : 1;
    const spec = plus('1d6', Math.floor(power / 5));
    const strike = (m: Mage): void => {
      void ctx.vfx?.lightningBolt?.(ctx.caster.pos, m.pos);
      dealDamage(ctx, m, dmg(rollDice(ctx, spec, 'Writhing Bolt', m) * mult, 'heat'), { canMiss: false });
      if (m.alive) dealDamage(ctx, m, dmg(rollDice(ctx, spec, 'Writhing Bolt', m) * mult, 'sanity'), { canMiss: false });
    };
    strike(foe);
    if (roll === 1 && ctx.caster.alive) {
      ctx.log('The bolt misfires through its caster.');
      strike(ctx.caster);
    }
    const reach = R(Math.max(2, power / 3));
    const shock = plus('1d6', Math.floor(power / 6));
    let last: Mage = foe;
    for (let jump = 0; jump < Math.floor(power / 5); jump++) {
      const from: Vec2 = { ...last.pos };
      const options = ctx.game.mages.filter(
        (m) => m.alive && m !== last && !ctx.game.isUnreachable(m) && dist(m.pos, from) <= reach + m.bodyRadius()
      );
      if (options.length === 0) break;
      const next = ctx.rng.pick(options);
      void ctx.vfx?.lightningBolt?.(from, next.pos);
      dealDamage(ctx, next, dmg(rollDice(ctx, shock, 'Writhing Bolt jump', next) * mult, 'sanity'), {
        canMiss: false,
        aoe: true,
      });
      last = next;
    }
  },
});

registerSpell({
  name: 'Hellbolt',
  words: ['lightning', 'fire', 'pain'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 14,
  description:
    'A bolt strikes one enemy within 15cm, then bounces on from unit to unit at random, the nearer the likelier, ' +
    'friend or foe, you included, never twice in a row into the same one. Every unit it strikes rolls 1d6. On 1\u20135 ' +
    'it takes 1d6 heat and 1d3 sanity and gains 1 Fire, and the bolt bounces on. On a 6 the bolt explodes: every ' +
    'unit within 4cm of it, your side included, takes 1d10 sanity, and all of its Fire burns at once in a single hit.',
  visual: { preset: 'beam', color: HELL, size: 11, speed: 1.6 },
  cast(ctx) {
    let struck = ctx.target;
    if (!struck) return;
    let from: Vec2 = { ...ctx.caster.pos };
    for (let bounce = 0; bounce < MAX_BOUNCES; bounce++) {
      void ctx.vfx?.lightningBolt?.(from, struck.pos);
      if (rollDice(ctx, '1d6', 'Hellbolt gamble', struck) === 6) {
        explode(ctx, { ...struck.pos });
        return;
      }
      hit(ctx, struck, '1d6', 'heat', 'Hellbolt', { canMiss: false });
      hit(ctx, struck, '1d3', 'sanity', 'Hellbolt', { canMiss: false });
      if (struck.alive) applyFireStacks(ctx, struck, 1);
      from = { ...struck.pos };
      const next = bounceFrom(ctx, struck);
      if (!next) return;
      struck = next;
    }
    ctx.log('The hellbolt burns itself out.');
  },
});

/** Where a hellbolt bounces next: any other unit still in this world, the nearer the likelier. */
function bounceFrom(ctx: EffectContext, from: Mage): Mage | undefined {
  const options = ctx.game.mages.filter((m) => m.alive && m !== from && !ctx.game.isUnreachable(m));
  const weights = options.map((m) => 1 / (1 + cmApart(m.pos, from.pos)));
  let roll = ctx.rng.float() * weights.reduce((sum, w) => sum + w, 0);
  for (let i = 0; i < options.length; i++) {
    roll -= weights[i];
    if (roll < 0) return options[i];
  }
  return options[options.length - 1];
}

/** The hellbolt explodes at `at`: 1d10 sanity on everyone within 4cm, then all of their Fire burns at once. */
function explode(ctx: EffectContext, at: Vec2): void {
  ctx.log('The hellbolt explodes.');
  ctx.vfx?.boom?.(at);
  const caught = everyoneAround(ctx, at, R(4));
  const sanity = rollDice(ctx, '1d10', 'Hellbolt explosion');
  for (const m of caught) if (m.alive) dealDamage(ctx, m, dmg(sanity, 'sanity'), { canMiss: false, aoe: true });
  for (const m of caught) ctx.game.condenseFire(m, ctx);
}
