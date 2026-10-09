// =============================================================================
//  LIGHTNING · ORDINARY SPELLS
// -----------------------------------------------------------------------------
//  Lightning is red and gambles: on the cast roll, on dice of its own and on
//  where it leaps next. With black beside it nothing contains it: allies and
//  the caster are fair game. With blue it holds and hides; with colourless
//  words it hits hardest. These are the combos that had no ordinary spell yet.
// =============================================================================

import { dmg, type DamageType } from '../../core/Damage';
import type { Mage } from '../../core/Mage';
import type { FireStatus } from '../../core/Status';
import { dist, stepTowards, type Vec2 } from '../../core/utils';
import {
  applyDot,
  applyFireStacks,
  applyInvisibility,
  dealDamage,
  placeShadow,
  rollDice,
  type EffectContext,
} from '../../effects/effects';
import { applyMindLightningStack, mindLightningDamage } from '../mindLightning';
import { registerSpell } from '../registry';
import { castPower, lightningGamble } from './classWave';
import {
  cmApart,
  curseWith,
  drag,
  everyoneAround,
  everyoneInCone,
  foesAround,
  hit,
  R,
  root,
  shove,
  stun,
} from './waterKit';

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

// =============================================================================
//  THE MIXED COMBOS
// =============================================================================

type Hits = readonly (readonly [string, DamageType])[];

interface Charge {
  power: number;
  /** A surge (6) doubles every strike. */
  mult: number;
  /** A misfire (1) turns the bolt on its caster. */
  misfire: boolean;
}

function charge(ctx: EffectContext): Charge {
  const power = castPower(ctx);
  const roll = lightningGamble(ctx);
  return { power, mult: roll === 6 ? 2 : 1, misfire: roll === 1 };
}

/** A bolt from `from` landing each hit on `m`. Returns what landed. */
function zap(ctx: EffectContext, m: Mage, from: Vec2, hits: Hits, mult: number, label: string): number {
  if (!m.alive) return 0;
  void ctx.vfx?.lightningBolt?.(from, m.pos);
  let dealt = 0;
  for (const [spec, type] of hits) {
    if (m.alive) dealt += dealDamage(ctx, m, dmg(rollDice(ctx, spec, label, m) * mult, type), { canMiss: false, aoe: true });
  }
  return dealt;
}

/** On a misfire the bolt runs back through its caster. Returns whether it did. */
function backfire(ctx: EffectContext, c: Charge, hits: Hits, label: string): boolean {
  if (!c.misfire || !ctx.caster.alive) return false;
  ctx.log('The bolt misfires through its caster.');
  zap(ctx, ctx.caster, ctx.caster.pos, hits, 1, label);
  return true;
}

/** A share of the Lightning power, in cm, kept between `min` and `max`. */
const reach = (power: number, per: number, min: number, max = 12): number => R(Math.min(max, Math.max(min, power / per)));

/** A random living unit within `radius` of `at`, never `not`; the caster included. */
function anyoneNear(ctx: EffectContext, at: Vec2, radius: number, not?: Mage): Mage | undefined {
  const options = everyoneAround(ctx, at, radius).filter((m) => m !== not);
  return options.length > 0 ? ctx.rng.pick(options) : undefined;
}

/** Every body but the caster touching the segment from `from` to `to`, allies included. */
function bodiesOnLane(ctx: EffectContext, from: Vec2, to: Vec2): Mage[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy || 1;
  return ctx.game.mages.filter((m) => {
    if (m === ctx.caster || !m.alive || ctx.game.isUnreachable(m)) return false;
    const t = Math.max(0, Math.min(1, ((m.x - from.x) * dx + (m.y - from.y) * dy) / lengthSq));
    return Math.hypot(m.x - (from.x + dx * t), m.y - (from.y + dy * t)) <= m.bodyRadius() + R(0.5);
  });
}

const fireOf = (m: Mage): number => (m.statuses.find((s) => s.kind === 'fire') as FireStatus | undefined)?.stacks ?? 0;
const SKY = (at: Vec2): Vec2 => ({ x: at.x, y: at.y - R(5) });
const SPARK = 0xffe45c;

// ---- With blue: hold and hide -----------------------------------------------------

registerSpell({
  name: 'Synapse Lock',
  words: ['lightning', 'bind', 'mind'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 15cm takes 1d6 heat plus 1 per 6 Lightning power, gains 1 Mindconduct stack and is stunned for ' +
    '1 turn. Lightning gamble: on a 1 the bolt also strikes you and roots you for 1 turn; on a 6 it deals double.',
  visual: { preset: 'beam', color: 0x9a8aff, size: 7, speed: 1.6 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const c = charge(ctx);
    const hits: Hits = [[plus('1d6', Math.floor(c.power / 6)), 'heat']];
    zap(ctx, foe, ctx.caster.pos, hits, c.mult, 'Synapse Lock');
    if (foe.alive) applyMindLightningStack(foe);
    stun(ctx, foe, 1);
    if (backfire(ctx, c, hits, 'Synapse Lock')) root(ctx, ctx.caster, 1);
  },
});

registerSpell({
  name: 'Thunder Shackle',
  words: ['lightning', 'bind', 'shatter'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 12cm takes 2d6 shatter and is rooted for 1 turn, plus 1 per 10 Lightning power (at most 3). The ' +
    'bolt arcs on to one other enemy within a third of the Lightning power in cm (at least 2cm) for 1d6 heat. ' +
    'Lightning gamble: on a 1 the shatter strikes you too; on a 6 every strike deals double.',
  visual: { preset: 'beam', color: SPARK, size: 8, speed: 1.5 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const c = charge(ctx);
    zap(ctx, foe, ctx.caster.pos, [['2d6', 'shatter']], c.mult, 'Thunder Shackle');
    root(ctx, foe, Math.min(3, 1 + Math.floor(c.power / 10)));
    const next = foesAround(ctx, foe.pos, reach(c.power, 3, 2)).find((m) => m !== foe);
    if (next) zap(ctx, next, foe.pos, [['1d6', 'heat']], c.mult, 'Thunder Shackle arc');
    backfire(ctx, c, [['2d6', 'shatter']], 'Thunder Shackle');
  },
});

registerSpell({
  name: 'Charged Current',
  words: ['lightning', 'bind', 'water'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 15cm takes 1d6 water, is dragged toward you 1cm per 5 Lightning power (1 to 6cm) and rooted for ' +
    '1 turn. Lightning runs through the water: every other enemy within 2cm of it takes 1d6 heat plus 1 per 6 ' +
    'Lightning power. Lightning gamble: on a 1 the current runs through you too; on a 6 every strike deals double.',
  visual: { preset: 'beam', color: 0x7fb8f0, size: 8, speed: 1.4 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const c = charge(ctx);
    zap(ctx, foe, ctx.caster.pos, [['1d6', 'water']], c.mult, 'Charged Current');
    drag(ctx, foe, ctx.caster.pos, Math.min(6, Math.max(1, Math.floor(c.power / 5))));
    root(ctx, foe, 1);
    const shock: Hits = [[plus('1d6', Math.floor(c.power / 6)), 'heat']];
    for (const m of foesAround(ctx, foe.pos, R(2))) if (m !== foe) zap(ctx, m, foe.pos, shock, c.mult, 'Charged Current');
    backfire(ctx, c, shock, 'Charged Current');
  },
});

registerSpell({
  name: 'Thunderclap Veil',
  words: ['lightning', 'veil', 'shatter'],
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 13,
  aoe: { kind: 'circle', radius: R(3) },
  description:
    'A thunderclap around you: every enemy within 3cm takes 1d6 shatter plus 1 per 6 Lightning power and is stunned ' +
    'for 1 turn, and you vanish into a full veil until your next turn. Lightning gamble: on a 1 the flash gives you ' +
    'away and you stay unveiled; on a 6 the clap deals double.',
  visual: { preset: 'nova', color: SPARK, size: R(3), speed: 1.9 },
  cast(ctx) {
    const c = charge(ctx);
    for (const m of foesAround(ctx, ctx.caster.pos, R(3))) {
      zap(ctx, m, ctx.caster.pos, [[plus('1d6', Math.floor(c.power / 6)), 'shatter']], c.mult, 'Thunderclap Veil');
      stun(ctx, m, 1);
    }
    if (c.misfire) ctx.log('The flash gives its caster away.');
    else applyInvisibility(ctx, ctx.caster, { duration: 1, mode: 'full' });
  },
});

registerSpell({
  name: 'Stormfog',
  words: ['lightning', 'veil', 'water'],
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 13,
  aoe: { kind: 'circle', radius: R(4) },
  description:
    'A charged fog rolls out from you: every enemy within 4cm takes 1d4 water and 1d4 heat plus 1 per 8 Lightning ' +
    'power and is pushed 2cm away. You and every ally within 4cm slip into a half veil for 2 turns. Lightning gamble: ' +
    'on a 1 the fog sparks through you too; on a 6 it deals double.',
  visual: { preset: 'nova', color: 0x9fc8ff, size: R(4), speed: 1.1 },
  cast(ctx) {
    const c = charge(ctx);
    const hits: Hits = [['1d4', 'water'], [plus('1d4', Math.floor(c.power / 8)), 'heat']];
    for (const m of foesAround(ctx, ctx.caster.pos, R(4))) {
      zap(ctx, m, ctx.caster.pos, hits, c.mult, 'Stormfog');
      shove(ctx, m, ctx.caster.pos, 2);
    }
    for (const friend of everyoneAround(ctx, ctx.caster.pos, R(4))) {
      if (friend.team === ctx.caster.team) applyInvisibility(ctx, friend, { duration: 2, mode: 'partial' });
    }
    backfire(ctx, c, [['1d4', 'heat']], 'Stormfog');
  },
});

registerSpell({
  name: 'Brainquake',
  words: ['lightning', 'mind', 'shatter'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 15cm takes 1d6 shatter plus 1 per 6 Lightning power, gains 1 Mindconduct stack and takes 1d4 ' +
    'sanity, 50% more for every stack after the first. At 3 stacks or more it is stunned for 1 turn. Lightning gamble: ' +
    'on a 1 the shatter strikes you too; on a 6 every strike deals double.',
  visual: { preset: 'conjure', color: 0xd890ff, size: 34, speed: 1.4 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const c = charge(ctx);
    const quake: Hits = [[plus('1d6', Math.floor(c.power / 6)), 'shatter']];
    zap(ctx, foe, ctx.caster.pos, quake, c.mult, 'Brainquake');
    if (foe.alive) {
      const stacks = applyMindLightningStack(foe);
      const amount = Math.ceil(mindLightningDamage(rollDice(ctx, '1d4', 'Brainquake', foe), stacks)) * c.mult;
      dealDamage(ctx, foe, dmg(amount, 'sanity'), { canMiss: false });
      if (stacks >= 3) stun(ctx, foe, 1);
    }
    backfire(ctx, c, quake, 'Brainquake');
  },
});

registerSpell({
  name: 'Riptide Bolt',
  words: ['lightning', 'pierce', 'water'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 15cm takes 1d6 pierce and 1d6 water and is pushed away 1cm per 4 Lightning power (1 to 6cm). ' +
    'Every other enemy within 2cm of where it lands takes 1d6 heat. Lightning gamble: on a 1 the pierce strikes you ' +
    'too; on a 6 every strike deals double.',
  visual: { preset: 'beam', color: 0x8fd0ff, size: 6, speed: 2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const c = charge(ctx);
    zap(ctx, foe, ctx.caster.pos, [['1d6', 'pierce'], ['1d6', 'water']], c.mult, 'Riptide Bolt');
    shove(ctx, foe, ctx.caster.pos, Math.min(6, Math.max(1, Math.floor(c.power / 4))));
    for (const m of foesAround(ctx, foe.pos, R(2))) if (m !== foe) zap(ctx, m, foe.pos, [['1d6', 'heat']], c.mult, 'Riptide Bolt');
    backfire(ctx, c, [['1d6', 'pierce']], 'Riptide Bolt');
  },
});

registerSpell({
  name: 'Thunderwave',
  words: ['lightning', 'shatter', 'water'],
  actionType: 'main',
  range: R(6),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'cone', radius: R(6), degrees: 90 },
  description:
    'A 90° wave of thunder, 6cm long: every enemy in it takes 1d6 water and 1d6 shatter and is pushed away 1cm per 5 ' +
    'Lightning power (1 to 6cm). Lightning gamble: on a 1 the wave breaks back over you for 1d6 shatter; on a 6 it ' +
    'deals double.',
  visual: { preset: 'burst', color: 0x7fc8ff, size: 70, speed: 1.4 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const c = charge(ctx);
    const push = Math.min(6, Math.max(1, Math.floor(c.power / 5)));
    const angle = Math.atan2(at.y - ctx.caster.y, at.x - ctx.caster.x);
    for (const m of everyoneInCone(ctx, at, R(6), 90).filter((u) => u.team !== ctx.caster.team)) {
      zap(ctx, m, ctx.caster.pos, [['1d6', 'water'], ['1d6', 'shatter']], c.mult, 'Thunderwave');
      shove(ctx, m, ctx.caster.pos, push);
    }
    ctx.vfx?.godFx?.('cataclysm', stepTowards(ctx.caster.pos, at, R(3)), { size: R(6), color: 0x7fc8ff, angle });
    backfire(ctx, c, [['1d6', 'shatter']], 'Thunderwave');
  },
});

// ---- With black: nothing contains it ----------------------------------------------

registerSpell({
  name: 'Black Thunder',
  words: ['lightning', 'shadow', 'shatter'],
  actionType: 'main',
  range: R(15),
  targeting: 'point',
  dc: 14,
  aoe: { kind: 'circle', radius: R(3) },
  description:
    'Black lightning strikes a point within 15cm: everything within a fifth of the Lightning power in cm (2 to 5cm), ' +
    'allies and you included, takes 2d6 shatter plus 1 per 5 Lightning power. Leaves a shadow for 3 turns. Lightning ' +
    'gamble: on a 1 it strikes you too wherever you stand; on a 6 it deals double.',
  visual: { preset: 'burst', color: 0x6a5aff, size: R(3), speed: 1.4 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const c = charge(ctx);
    const hits: Hits = [[plus('2d6', Math.floor(c.power / 5)), 'shatter']];
    const caught = everyoneAround(ctx, at, reach(c.power, 5, 2, 5));
    for (const m of caught) zap(ctx, m, SKY(at), hits, c.mult, 'Black Thunder');
    if (!caught.includes(ctx.caster)) backfire(ctx, c, hits, 'Black Thunder');
    placeShadow(ctx, at, 3);
  },
});

registerSpell({
  name: 'Acid Storm',
  words: ['lightning', 'shadow', 'corrode'],
  actionType: 'main',
  range: R(15),
  targeting: 'point',
  dc: 14,
  aoe: { kind: 'circle', radius: R(6) },
  description:
    'An acid storm breaks over a point within 15cm: 1 bolt plus 1 per 6 Lightning power (at most 8), each striking a ' +
    'random unit within 6cm of it, allies and you included, for 1d6 corrosive. Leaves a shadow for 3 turns. Lightning ' +
    'gamble: on a 1 the first bolt strikes you; on a 6 every bolt deals double.',
  visual: { preset: 'burst', color: 0x8ac84a, size: R(6), speed: 1 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const c = charge(ctx);
    const bolts = Math.min(8, 1 + Math.floor(c.power / 6));
    for (let bolt = 0; bolt < bolts; bolt++) {
      const struck = bolt === 0 && c.misfire ? ctx.caster : anyoneNear(ctx, at, R(6));
      if (!struck) break;
      zap(ctx, struck, SKY(at), [['1d6', 'corrosive']], c.mult, 'Acid Storm');
    }
    placeShadow(ctx, at, 3);
  },
});

registerSpell({
  name: 'Hex Bolt',
  words: ['lightning', 'shadow', 'curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 15cm takes 1d6 heat and is cursed for 3 turns, plus 1 per 10 Lightning power: 1d4 shadow at the ' +
    'start of its turns, each tick arcing 1d3 heat into every other unit within 3cm of it, allies and you included. ' +
    'Lightning gamble: on a 1 the heat strikes you too; on a 6 it deals double.',
  visual: { preset: 'beam', color: 0x9a5ad8, size: 7, speed: 1.5 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const c = charge(ctx);
    zap(ctx, foe, ctx.caster.pos, [['1d6', 'heat']], c.mult, 'Hex Bolt');
    if (foe.alive) {
      applyDot(ctx, foe, {
        name: 'Hex Bolt',
        key: 'dot:hex-bolt',
        duration: 3 + Math.floor(c.power / 10),
        damage: dmg(0, 'shadow'),
        damageSpec: '1d4',
        splash: { radius: R(3), damage: dmg(0, 'heat'), damageSpec: '1d3' },
        sourceTeam: -1,
      });
    }
    backfire(ctx, c, [['1d6', 'heat']], 'Hex Bolt');
  },
});

registerSpell({
  name: 'Corroding Arc',
  words: ['lightning', 'shatter', 'corrode'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 15cm takes 1d6 corrosive and 1d6 shatter. The bolt then leaps once per 5 Lightning power into a ' +
    'random unit within 4cm of the last, allies and you included, never the one it just left: 1d4 corrosive each. ' +
    'Lightning gamble: on a 1 the first strike runs through you too; on a 6 every strike deals double.',
  visual: { preset: 'beam', color: 0xb8c84a, size: 8, speed: 1.6 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const c = charge(ctx);
    const first: Hits = [['1d6', 'corrosive'], ['1d6', 'shatter']];
    zap(ctx, foe, ctx.caster.pos, first, c.mult, 'Corroding Arc');
    let last = foe;
    for (let jump = 0; jump < Math.min(10, Math.floor(c.power / 5)); jump++) {
      const next = anyoneNear(ctx, last.pos, R(4), last);
      if (!next) break;
      zap(ctx, next, last.pos, [['1d4', 'corrosive']], c.mult, 'Corroding Arc jump');
      last = next;
    }
    backfire(ctx, c, first, 'Corroding Arc');
  },
});

registerSpell({
  name: 'Thunder Curse',
  words: ['lightning', 'shatter', 'curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 15cm takes 1d6 heat plus 1 per 6 Lightning power and is cursed for 3 turns: 1d6 shatter at the ' +
    'start of its turns, each tick with a 1 in 4 chance to stun it. Lightning gamble: on a 1 the heat strikes you ' +
    'too; on a 6 it deals double.',
  visual: { preset: 'beam', color: 0xc8a84a, size: 7, speed: 1.4 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const c = charge(ctx);
    const bolt: Hits = [[plus('1d6', Math.floor(c.power / 6)), 'heat']];
    zap(ctx, foe, ctx.caster.pos, bolt, c.mult, 'Thunder Curse');
    curseWith(ctx, foe, 'Thunder Curse', 'shatter', 3, { damageSpec: '1d6', stunChance: 0.25 });
    backfire(ctx, c, bolt, 'Thunder Curse');
  },
});

registerSpell({
  name: 'Splitting Thunder',
  words: ['lightning', 'shatter', 'pain'],
  actionType: 'main',
  range: R(15),
  targeting: 'point',
  dc: 14,
  aoe: { kind: 'circle', radius: R(2) },
  description:
    'Thunder splits a point within 15cm: everything within 2cm, allies and you included, takes 1d6 shatter and 1d6 ' +
    'sanity, each plus 1 per 6 Lightning power. Lightning gamble: on a 1 it strikes you too wherever you stand; on a 6 ' +
    'it deals double and stuns everything it strikes for 1 turn.',
  visual: { preset: 'burst', color: 0xd85a7a, size: R(2), speed: 1.6 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const c = charge(ctx);
    const bonus = Math.floor(c.power / 6);
    const hits: Hits = [[plus('1d6', bonus), 'shatter'], [plus('1d6', bonus), 'sanity']];
    const caught = everyoneAround(ctx, at, R(2));
    for (const m of caught) {
      zap(ctx, m, SKY(at), hits, c.mult, 'Splitting Thunder');
      if (c.mult > 1) stun(ctx, m, 1);
    }
    if (!caught.includes(ctx.caster)) backfire(ctx, c, hits, 'Splitting Thunder');
  },
});

registerSpell({
  name: 'Rusting Storm',
  words: ['lightning', 'corrode', 'curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 15cm takes 1d6 heat and is cursed for 4 turns: 1d4 corrosive at the start of its turns, and each ' +
    'tick the rust spreads to everything within a quarter of the Lightning power in cm of it (2 to 4cm), allies ' +
    'included, for half the turns left. Lightning gamble: on a 1 the heat strikes you too; on a 6 it deals double.',
  visual: { preset: 'beam', color: 0xa8783a, size: 7, speed: 1.3 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const c = charge(ctx);
    zap(ctx, foe, ctx.caster.pos, [['1d6', 'heat']], c.mult, 'Rusting Storm');
    curseWith(ctx, foe, 'Rusting Storm', 'corrosive', 4, { damageSpec: '1d4', spreadRadius: reach(c.power, 4, 2, 4) });
    backfire(ctx, c, [['1d6', 'heat']], 'Rusting Storm');
  },
});

registerSpell({
  name: 'Acid Lance',
  words: ['lightning', 'corrode', 'pierce'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 14,
  description:
    'A lance of acid lightning runs 15cm from you through one enemy: every body on it, allies included, takes 1d6 ' +
    'pierce plus 1 per 6 Lightning power and 1d6 corrosive. Lightning gamble: on a 1 it strikes you too; on a 6 it ' +
    'deals double.',
  visual: { preset: 'beam', color: 0xc8e04a, size: 6, speed: 2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const c = charge(ctx);
    const from = { ...ctx.caster.pos };
    const gap = dist(from, foe.pos) || 1;
    const to = { x: from.x + ((foe.x - from.x) / gap) * R(15), y: from.y + ((foe.y - from.y) / gap) * R(15) };
    const struck = bodiesOnLane(ctx, from, to);
    if (!struck.includes(foe)) struck.push(foe);
    const hits: Hits = [[plus('1d6', Math.floor(c.power / 6)), 'pierce'], ['1d6', 'corrosive']];
    void ctx.vfx?.lightningBolt?.(from, to);
    for (const m of struck) zap(ctx, m, from, hits, c.mult, 'Acid Lance');
    backfire(ctx, c, hits, 'Acid Lance');
  },
});

registerSpell({
  name: 'Searing Static',
  words: ['lightning', 'corrode', 'pain'],
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 13,
  aoe: { kind: 'circle', radius: R(4) },
  description:
    'Static crawls off you: every other unit within a quarter of the Lightning power in cm (3 to 8cm), allies ' +
    'included, takes 1d4 corrosive and 1d4 sanity. Lightning gamble: on a 1 it crawls over you too; on a 6 it deals double.',
  visual: { preset: 'nova', color: 0xb86a6a, size: R(4), speed: 1.3 },
  cast(ctx) {
    const c = charge(ctx);
    const hits: Hits = [['1d4', 'corrosive'], ['1d4', 'sanity']];
    for (const m of everyoneAround(ctx, ctx.caster.pos, reach(c.power, 4, 3, 8))) {
      if (m !== ctx.caster) zap(ctx, m, ctx.caster.pos, hits, c.mult, 'Searing Static');
    }
    backfire(ctx, c, hits, 'Searing Static');
  },
});

registerSpell({
  name: 'Burning Acid',
  words: ['lightning', 'corrode', 'fire'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 15cm takes 1d6 corrosive and 1d6 heat and gains 1 Fire, plus 1 per 10 Lightning power. The bolt ' +
    'arcs on once into a random unit within 4cm of it, allies and you included, for the same. Lightning gamble: on a ' +
    '1 the arc runs into you; on a 6 every strike deals double.',
  visual: { preset: 'beam', color: 0xd8a03a, size: 8, speed: 1.6 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const c = charge(ctx);
    const hits: Hits = [['1d6', 'corrosive'], ['1d6', 'heat']];
    const stacks = 1 + Math.floor(c.power / 10);
    const scorch = (m: Mage, from: Vec2): void => {
      zap(ctx, m, from, hits, c.mult, 'Burning Acid');
      if (m.alive) applyFireStacks(ctx, m, stacks);
    };
    scorch(foe, ctx.caster.pos);
    const arc = c.misfire ? ctx.caster : anyoneNear(ctx, foe.pos, R(4), foe);
    if (arc) scorch(arc, foe.pos);
  },
});

registerSpell({
  name: 'Barbed Bolt',
  words: ['lightning', 'curse', 'pierce'],
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 20cm takes 1d6 pierce plus 1 per 6 Lightning power and is cursed for 3 turns: 1d4 pierce at the ' +
    'start of its turns. Lightning gamble: on a 1 the bolt strikes you too; on a 6 the strike deals double and the ' +
    'curse lasts 6 turns.',
  visual: { preset: 'beam', color: 0xe0d0a0, size: 5, speed: 2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const c = charge(ctx);
    const bolt: Hits = [[plus('1d6', Math.floor(c.power / 6)), 'pierce']];
    zap(ctx, foe, ctx.caster.pos, bolt, c.mult, 'Barbed Bolt');
    curseWith(ctx, foe, 'Barbed Bolt', 'pierce', 3 * c.mult, { damageSpec: '1d4' });
    backfire(ctx, c, bolt, 'Barbed Bolt');
  },
});

registerSpell({
  name: 'Static Torment',
  words: ['lightning', 'curse', 'pain'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 15cm takes 1d4 sanity plus 1 per 6 Lightning power and is cursed for 4 turns: 1d4 sanity at the ' +
    'start of its turns, each tick arcing 1d3 sanity into every other unit within 2cm of it, allies and you included. ' +
    'Lightning gamble: on a 1 you are cursed too; on a 6 the first strike deals double.',
  visual: { preset: 'beam', color: 0xd84a8a, size: 6, speed: 1.4 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const c = charge(ctx);
    zap(ctx, foe, ctx.caster.pos, [[plus('1d4', Math.floor(c.power / 6)), 'sanity']], c.mult, 'Static Torment');
    const torment = (m: Mage): void => {
      if (!m.alive) return;
      applyDot(ctx, m, {
        name: 'Static Torment',
        key: 'dot:static-torment',
        duration: 4,
        damage: dmg(0, 'sanity'),
        damageSpec: '1d4',
        splash: { radius: R(2), damage: dmg(0, 'sanity'), damageSpec: '1d3' },
        sourceTeam: -1,
      });
    };
    torment(foe);
    if (c.misfire) torment(ctx.caster);
  },
});

registerSpell({
  name: 'Scorching Hex',
  words: ['lightning', 'curse', 'fire'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'Curse one enemy within 15cm for 3 turns: 1d4 heat at the start of its turns. It gains 2 Fire. The hex arcs into ' +
    'the nearest other unit within a quarter of the Lightning power in cm of it (2 to 6cm), allies and you included: ' +
    '1d4 heat and 1 Fire. Lightning gamble: on a 1 the arc runs into you; on a 6 the arc deals double and burns twice.',
  visual: { preset: 'beam', color: 0xff7a3a, size: 7, speed: 1.4 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const c = charge(ctx);
    curseWith(ctx, foe, 'Scorching Hex', 'heat', 3, { damageSpec: '1d4' });
    if (foe.alive) applyFireStacks(ctx, foe, 2);
    const arc = c.misfire
      ? ctx.caster
      : everyoneAround(ctx, foe.pos, reach(c.power, 4, 2, 6))
          .filter((m) => m !== foe)
          .sort((a, b) => cmApart(a.pos, foe.pos) - cmApart(b.pos, foe.pos))[0];
    if (!arc) return;
    zap(ctx, arc, foe.pos, [['1d4', 'heat']], c.mult, 'Scorching Hex');
    if (arc.alive) applyFireStacks(ctx, arc, c.mult);
  },
});

registerSpell({
  name: 'Thunderfire',
  words: ['lightning', 'shatter', 'fire'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 14,
  description:
    'One enemy within 15cm takes 2d6 shatter plus 1 per 5 Lightning power. If it was burning, all of its Fire burns at ' +
    'once in a single hit. Then it gains 2 Fire. Lightning gamble: on a 1 you gain 2 Fire too; on a 6 the shatter ' +
    'deals double.',
  visual: { preset: 'beam', color: 0xffa040, size: 10, speed: 1.6 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const c = charge(ctx);
    const burning = fireOf(foe) > 0;
    zap(ctx, foe, ctx.caster.pos, [[plus('2d6', Math.floor(c.power / 5)), 'shatter']], c.mult, 'Thunderfire');
    if (burning && foe.alive) ctx.game.condenseFire(foe, ctx);
    if (foe.alive) applyFireStacks(ctx, foe, 2);
    if (c.misfire && ctx.caster.alive) applyFireStacks(ctx, ctx.caster, 2);
  },
});

// ---- With colourless words: hit hardest ------------------------------------------

registerSpell({
  name: 'Nerve Bolt',
  words: ['lightning', 'pierce', 'pain'],
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  ignoresStealth: true,
  dc: 14,
  description:
    'One enemy within 20cm, even a concealed one, takes 1d6 pierce and 1d6 sanity, each plus 1 per 6 Lightning power. ' +
    'Lightning gamble: on a 1 the bolt strikes you too; on a 6 it deals double.',
  visual: { preset: 'beam', color: 0xe07a9a, size: 4, speed: 2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const c = charge(ctx);
    const bonus = Math.floor(c.power / 6);
    const hits: Hits = [[plus('1d6', bonus), 'pierce'], [plus('1d6', bonus), 'sanity']];
    zap(ctx, foe, ctx.caster.pos, hits, c.mult, 'Nerve Bolt');
    backfire(ctx, c, hits, 'Nerve Bolt');
  },
});
