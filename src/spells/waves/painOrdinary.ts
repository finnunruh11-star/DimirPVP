// =============================================================================
//  PAIN · ORDINARY SPELLS
// -----------------------------------------------------------------------------
//  Pain is black: sanity damage of its own. Unlike Mind, which bends a spell
//  toward the mind, Pain simply adds mental damage to whatever it joins, and
//  the amplifiers (Shadow, Curse) make more of it. Black majorities hurt
//  everyone near; blue ones hold and hide. Water + Pain combos live here too.
// =============================================================================

import { dmg } from '../../core/Damage';
import type { Mage } from '../../core/Mage';
import { dist } from '../../core/utils';
import {
  applyDebuff,
  dealDamage,
  desecrate,
  desecrateGround,
  dispelVeil,
  placeShadow,
  rollDice,
  type EffectContext,
} from '../../effects/effects';
import { registerSpell } from '../registry';
import {
  cmApart,
  curseWith,
  dashAwayFrom,
  drag,
  everyoneAround,
  everyoneInCone,
  forgetTokens,
  foesAround,
  foesInCone,
  hideFrom,
  hit,
  lastDeeds,
  PAIN_COLOR,
  R,
  randomHeading,
  randomWords,
  richestWord,
  root,
  shove,
  shoveAlong,
  strikeAll,
  stun,
  veilSelf,
  WATER_COLOR,
} from './waterKit';

const DREAD = 0x8a3b6b;
const RAW = 0xb8463c;

/** Whether `m` stands in one of the caster's own shadows. */
function inOwnShadow(ctx: EffectContext, m: Mage): boolean {
  return ctx.game.shadowsOf(ctx.caster.team).some((s) => dist({ x: s.x, y: s.y }, m.pos) <= s.radius);
}

/** At half its sanity or less (the mindless never are). */
const shaken = (m: Mage): boolean => m.alive && !m.isImmuneTo('sanity') && m.maxSanity > 0 && m.sanity * 2 <= m.maxSanity;

/** Push 1cm per 3cm between the caster and `m`, at most `max`. */
const jetPush = (ctx: EffectContext, m: Mage, max = 6): number =>
  Math.min(max, Math.floor(cmApart(ctx.caster.pos, m.pos) / 3));

/** Reap on `m`, then an execution. */
function harvest(ctx: EffectContext, m: Mage, reap: number, execute: number): void {
  if (m.alive && reap > 0) ctx.game.applyReap(m, reap, ctx.caster);
  if (m.alive && execute > 0) ctx.game.executeTarget(ctx.caster, m, execute);
}

// =============================================================================
//  ONE AND TWO WORDS
// =============================================================================

registerSpell({
  name: 'Pain',
  words: ['pain'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 6,
  description: 'One enemy within 10cm takes 1d4 sanity.',
  visual: { preset: 'beam', color: PAIN_COLOR, size: 5, speed: 1.4 },
  cast(ctx) {
    if (ctx.target) hit(ctx, ctx.target, '1d4', 'sanity', 'Pain');
  },
});

registerSpell({
  name: 'Wracking Bind',
  words: ['pain', 'bind'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 11,
  description: 'One enemy within 12cm takes 1d4 sanity and is rooted for 2 turns. It takes 1d4 sanity at the start of its next 2 turns.',
  visual: { preset: 'beam', color: PAIN_COLOR, size: 6, speed: 1.2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d4', 'sanity', 'Wracking Bind');
    root(ctx, foe, 2);
    curseWith(ctx, foe, 'Wracking Bind', 'sanity', 2, { damageSpec: '1d4' });
  },
});

registerSpell({
  name: 'Dark Agony',
  words: ['pain', 'shadow'],
  actionType: 'main',
  range: R(12),
  bonusRangeInOwnShadow: R(99),
  targeting: 'enemy',
  dc: 11,
  description: 'One enemy within 12cm, or anywhere if it stands in one of your shadows, takes 2d6 sanity.',
  visual: { preset: 'beam', color: DREAD, size: 7, speed: 1.1 },
  cast(ctx) {
    if (ctx.target) hit(ctx, ctx.target, '2d6', 'sanity', 'Shadow Pain');
  },
});

registerSpell({
  name: 'Lash and Vanish',
  words: ['pain', 'veil'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 11,
  description:
    'One enemy within 10cm takes 1d6 sanity. You dash 2cm straight away from it and gain a half veil until your next turn.',
  visual: { preset: 'beam', color: PAIN_COLOR, size: 6, speed: 1.5 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d6', 'sanity', 'Pain Veil');
    dashAwayFrom(ctx, foe.pos, 2);
    veilSelf(ctx, 1);
  },
});

registerSpell({
  name: 'Psychic Agony',
  words: ['pain', 'mind'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 12,
  description:
    'One enemy within 15cm takes 2d4 sanity and forgets the word it holds the most charges of until the end of its next turn.',
  visual: { preset: 'beam', color: 0xe06a9a, size: 6, speed: 1.2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '2d4', 'sanity', 'Pain Mind');
    const word = richestWord(foe);
    if (word) forgetTokens(ctx, foe, [word], 2);
  },
});

registerSpell({
  name: 'Splitting Pain',
  words: ['pain', 'shatter'],
  actionType: 'main',
  range: R(5),
  targeting: 'point',
  dc: 11,
  aoe: { kind: 'cone', radius: R(5), degrees: 90 },
  description: 'Enemies in a 5cm cone take 1d6 shatter and 1d4 sanity. The nearest of them is also stunned for 1 turn.',
  visual: { preset: 'burst', color: RAW, size: R(2), speed: 1.3 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const foes = foesInCone(ctx, ctx.targetPoint, R(5), 90);
    strikeAll(ctx, foes, [['1d6', 'shatter'], ['1d4', 'sanity']], 'Splitting Pain');
    const nearest = foes
      .filter((m) => m.alive)
      .sort((a, b) => dist(a.pos, ctx.caster.pos) - dist(b.pos, ctx.caster.pos))[0];
    if (nearest) stun(ctx, nearest, 1);
  },
});

registerSpell({
  name: 'Searing Bite',
  words: ['pain', 'corrode'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 10,
  description: 'One enemy within 10cm takes 1d6 corrosive and 1d4 sanity.',
  visual: { preset: 'projectile', color: 0xa8b85a, size: 10, speed: 1.4 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d6', 'corrosive', 'Corrode Pain');
    hit(ctx, foe, '1d4', 'sanity', 'Corrode Pain');
  },
});

registerSpell({
  name: 'Throbbing Curse',
  words: ['pain', 'curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 11,
  description: 'Curse one enemy within 15cm for 4 turns: at the start of its turns it takes 1d3, then 1d4, 1d6 and 1d8 sanity.',
  visual: { preset: 'beam', color: PAIN_COLOR, size: 5, speed: 1 },
  cast(ctx) {
    if (ctx.target) curseWith(ctx, ctx.target, 'Throbbing Curse', 'sanity', 4, { escalateSpecs: ['1d3', '1d4', '1d6', '1d8'] });
  },
});

registerSpell({
  name: 'Nerve Strike',
  words: ['pain', 'pierce'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 11,
  description:
    'One enemy within 15cm takes 1d6 pierce and 1d4 sanity. From 6cm to 10cm away it strikes a nerve: 2d6 sanity ' +
    'instead of 1d4.',
  visual: { preset: 'projectile', color: PAIN_COLOR, size: 7, speed: 1.9 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const gap = cmApart(ctx.caster.pos, foe.pos);
    hit(ctx, foe, '1d6', 'pierce', 'Nerve Strike');
    hit(ctx, foe, gap >= 6 && gap <= 10 ? '2d6' : '1d4', 'sanity', 'Nerve Strike');
  },
});

registerSpell({
  name: 'Drowning Panic',
  words: ['water', 'pain'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 11,
  description:
    'One enemy within 12cm takes 1d4 water and 1d6 sanity and is pushed 3cm away from you. Slammed into a wall or the ' +
    'field edge, it takes another 1d6 sanity.',
  visual: { preset: 'projectile', color: WATER_COLOR, size: 10, speed: 1.4 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d4', 'water', 'Water Pain');
    hit(ctx, foe, '1d6', 'sanity', 'Water Pain');
    if (shove(ctx, foe, ctx.caster.pos, 3)) hit(ctx, foe, '1d6', 'sanity', 'Panic', { canMiss: false });
  },
});

// =============================================================================
//  THREE WORDS
// =============================================================================

registerSpell({
  name: 'Grip of Dread',
  words: ['pain', 'bind', 'shadow'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  description:
    'Root one enemy within 12cm for 2 turns. It takes 1d6 sanity, or 2d6 if it stands in a shadow. A shadow then opens under it.',
  visual: { preset: 'beam', color: DREAD, size: 7, speed: 1.1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    root(ctx, foe, 2);
    hit(ctx, foe, ctx.game.isInShadow(foe) ? '2d6' : '1d6', 'sanity', 'Grip of Dread');
    placeShadow(ctx, foe.pos, 3);
  },
});

registerSpell({
  name: 'Paralysing Pain',
  words: ['pain', 'bind', 'veil'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 12cm takes 1d6 sanity. Left at half its sanity or less it is stunned for 1 turn; otherwise it is ' +
    'rooted for 2 turns. You gain a half veil until your next turn.',
  visual: { preset: 'beam', color: PAIN_COLOR, size: 6, speed: 1.2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d6', 'sanity', 'Paralysing Pain');
    if (shaken(foe)) stun(ctx, foe, 1);
    else root(ctx, foe, 2);
    veilSelf(ctx, 1);
  },
});

registerSpell({
  name: 'Locked Mind',
  words: ['pain', 'bind', 'mind'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description: 'One enemy within 15cm takes 1d6 sanity and forgets how to move and how to attack until the end of its next turn.',
  visual: { preset: 'beam', color: 0xe06a9a, size: 6, speed: 1.1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d6', 'sanity', 'Locked Mind');
    forgetTokens(ctx, foe, ['move', 'melee'], 2);
  },
});

registerSpell({
  name: 'Breaking Point',
  words: ['pain', 'bind', 'shatter'],
  actionType: 'main',
  range: R(6),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 6cm takes 2d4 shatter and 1d6 sanity. Already rooted, it is stunned for 1 turn; otherwise it is ' +
    'rooted for 2 turns.',
  visual: { preset: 'conjure', color: RAW, size: 32, speed: 1.3 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const held = foe.isStunned('movement');
    hit(ctx, foe, '2d4', 'shatter', 'Breaking Point');
    hit(ctx, foe, '1d6', 'sanity', 'Breaking Point');
    if (held) stun(ctx, foe, 1);
    else root(ctx, foe, 2);
  },
});

registerSpell({
  name: 'Burning Shackles',
  words: ['pain', 'bind', 'corrode'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  description: 'Root one enemy within 12cm for 2 turns. For 3 turns it takes 1d4 corrosive and 1d4 sanity at the start of its turns.',
  visual: { preset: 'beam', color: 0xa8b85a, size: 7, speed: 1.1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    root(ctx, foe, 2);
    curseWith(ctx, foe, 'Burning Shackles', 'corrosive', 3, { damageSpec: '1d4' });
    curseWith(ctx, foe, 'Shackled Agony', 'sanity', 3, { damageSpec: '1d4' });
  },
});

registerSpell({
  name: 'Agony of Stillness',
  words: ['pain', 'bind', 'curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'Root one enemy within 15cm for 2 turns and curse it for 4 turns: 1d4 sanity at the start of its turns, and 1d6 ' +
    'more after any turn in which it dealt no damage.',
  visual: { preset: 'beam', color: PAIN_COLOR, size: 6, speed: 1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    root(ctx, foe, 2);
    curseWith(ctx, foe, 'Agony of Stillness', 'sanity', 4, { damageSpec: '1d4', bonusNoDamageSpec: '1d6' });
  },
});

registerSpell({
  name: 'Nerve Pin',
  words: ['pain', 'bind', 'pierce'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description: 'One enemy within 15cm takes 1d6 pierce and 1d6 sanity and is rooted for 2 turns.',
  visual: { preset: 'projectile', color: PAIN_COLOR, size: 8, speed: 1.8 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d6', 'pierce', 'Nerve Pin');
    hit(ctx, foe, '1d6', 'sanity', 'Nerve Pin');
    root(ctx, foe, 2);
  },
});

registerSpell({
  name: 'Unseen Agony',
  words: ['pain', 'shadow', 'veil'],
  actionType: 'main',
  range: R(12),
  bonusRangeInOwnShadow: R(99),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 12cm, or anywhere if it stands in one of your shadows, takes 2d6 sanity. You dash 2cm straight ' +
    'away from it and gain a half veil for 2 turns.',
  visual: { preset: 'beam', color: DREAD, size: 7, speed: 1.3 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '2d6', 'sanity', 'Unseen Agony');
    dashAwayFrom(ctx, foe.pos, 2);
    veilSelf(ctx, 2);
  },
});

registerSpell({
  name: 'Dread',
  words: ['pain', 'shadow', 'mind'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 15cm takes 2d6 sanity and forgets one random word until the end of its next turn. Standing in a ' +
    'shadow, it takes 3d6 instead.',
  visual: { preset: 'beam', color: DREAD, size: 7, speed: 1.1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, ctx.game.isInShadow(foe) ? '3d6' : '2d6', 'sanity', 'Dread');
    forgetTokens(ctx, foe, randomWords(ctx, foe, 1), 2);
  },
});

registerSpell({
  name: 'Shattering Dread',
  words: ['pain', 'shadow', 'shatter'],
  actionType: 'main',
  range: R(10),
  targeting: 'point',
  dc: 14,
  aoe: { kind: 'circle', radius: R(3) },
  description:
    'Every unit within 3cm of a point within 10cm, allies and you included, takes 2d6 sanity and 1d6 shatter. Those ' +
    'standing in a shadow are also stunned for 1 turn.',
  visual: { preset: 'burst', color: DREAD, size: R(3), speed: 1.1 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const caught = everyoneAround(ctx, at, R(3));
    const dark = caught.filter((m) => ctx.game.isInShadow(m));
    strikeAll(ctx, caught, [['2d6', 'sanity'], ['1d6', 'shatter']], 'Shattering Dread');
    for (const m of dark) stun(ctx, m, 1);
  },
});

registerSpell({
  name: 'Agonised Rot',
  words: ['pain', 'shadow', 'corrode'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 14,
  description:
    'One enemy within 12cm takes 2d6 sanity and 1d6 corrosive. Every other unit within 2cm of it, allies and you ' +
    'included, takes half of each.',
  visual: { preset: 'projectile', color: 0x6f7a4a, size: 12, speed: 1.2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const pain = rollDice(ctx, '2d6', 'Agonised Rot');
    const rot = rollDice(ctx, '1d6', 'Agonised Rot');
    const around = everyoneAround(ctx, foe.pos, R(2)).filter((m) => m !== foe);
    dealDamage(ctx, foe, dmg(pain, 'sanity'));
    if (foe.alive) dealDamage(ctx, foe, dmg(rot, 'corrosive'), { canMiss: false });
    for (const m of around) {
      if (m.alive) dealDamage(ctx, m, dmg(Math.ceil(pain / 2), 'sanity'), { canMiss: false, aoe: true });
      if (m.alive) dealDamage(ctx, m, dmg(Math.ceil(rot / 2), 'corrosive'), { canMiss: false, aoe: true });
    }
  },
});

registerSpell({
  name: 'Nightmare Plague',
  words: ['pain', 'shadow', 'curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 14,
  description:
    'Curse one enemy within 15cm for 4 turns: 1d4 sanity at the start of its turns. Each tick the curse spreads, at ' +
    'half its remaining time, to every unit within 2cm of it, allies and you included.',
  visual: { preset: 'beam', color: DREAD, size: 6, speed: 1 },
  cast(ctx) {
    if (ctx.target) curseWith(ctx, ctx.target, 'Nightmare Plague', 'sanity', 4, { damageSpec: '1d4', spreadRadius: R(2) });
  },
});

registerSpell({
  name: 'Shadow Needles',
  words: ['pain', 'shadow', 'pierce'],
  actionType: 'main',
  range: R(12),
  bonusRangeInOwnShadow: R(99),
  targeting: 'enemy',
  dc: 14,
  description:
    'Needles strike up to 3 different enemies within 12cm, or anywhere if they stand in your shadows: each takes 1d4 ' +
    'pierce and 1d6 sanity. Choose the second and third as the first flies.',
  visual: { preset: 'projectile', color: DREAD, size: 6, speed: 2 },
  async cast(ctx) {
    const first = ctx.target;
    if (!first) return;
    const struck: Mage[] = [first];
    for (let i = 0; i < 2; i++) {
      const candidates = foesAround(ctx, ctx.caster.pos, R(99)).filter(
        (m) => !struck.includes(m) && (dist(m.pos, ctx.caster.pos) <= R(12) + m.bodyRadius() || inOwnShadow(ctx, m))
      );
      if (candidates.length === 0) break;
      const next = await ctx.requestCombatant?.({
        candidates,
        range: R(99),
        prompt: `Pain Shadow Pierce: needle ${i + 2} of 3 (Esc to stop).`,
      });
      if (!next) break;
      struck.push(next);
    }
    for (const foe of struck) {
      hit(ctx, foe, '1d4', 'pierce', 'Shadow Needle');
      hit(ctx, foe, '1d6', 'sanity', 'Shadow Needle');
    }
  },
});

registerSpell({
  name: 'Unseen Torment',
  words: ['pain', 'veil', 'mind'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 15cm takes 1d6 sanity and cannot single you out for 2 turns. It takes 1d4 sanity at the start ' +
    'of its next 2 turns.',
  visual: { preset: 'beam', color: 0xe06a9a, size: 6, speed: 1.2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d6', 'sanity', 'Unseen Torment');
    hideFrom(ctx, foe, 3);
    curseWith(ctx, foe, 'Unseen Torment', 'sanity', 2, { damageSpec: '1d4' });
  },
});

registerSpell({
  name: 'Glass Agony',
  words: ['pain', 'veil', 'shatter'],
  actionType: 'main',
  range: R(6),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'cone', radius: R(6), degrees: 90 },
  description:
    'Enemies in a 6cm cone take 1d6 shatter and 1d6 sanity. Any that were veiled lose the veil and are stunned for 1 turn.',
  visual: { preset: 'burst', color: 0xd8b0c8, size: R(3), speed: 1.3 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const foes = foesInCone(ctx, ctx.targetPoint, R(6), 90);
    const veiled = foes.filter((m) => ctx.game.isVeiled(m));
    strikeAll(ctx, foes, [['1d6', 'shatter'], ['1d6', 'sanity']], 'Glass Agony');
    for (const m of veiled) {
      dispelVeil(ctx, m);
      stun(ctx, m, 1);
    }
  },
});

registerSpell({
  name: 'Seeping Agony',
  words: ['pain', 'veil', 'corrode'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  description:
    'Curse one enemy within 12cm for 3 turns: 1d4 corrosive and 1d4 sanity at the start of its turns. You gain a half ' +
    'veil for 2 turns.',
  visual: { preset: 'beam', color: 0xa8b85a, size: 6, speed: 1.1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    curseWith(ctx, foe, 'Seeping Agony', 'corrosive', 3, { damageSpec: '1d4' });
    curseWith(ctx, foe, 'Seeping Dread', 'sanity', 3, { damageSpec: '1d4' });
    veilSelf(ctx, 2);
  },
});

registerSpell({
  name: 'Spiteful Haunting',
  words: ['pain', 'veil', 'curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'Curse one enemy within 15cm for 3 turns: 1d6 sanity at the start of its turns. Each turn it damages you or an ' +
    'ally, the curse lasts 2 turns longer. You gain a half veil for 2 turns.',
  visual: { preset: 'beam', color: PAIN_COLOR, size: 5, speed: 1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    curseWith(ctx, foe, 'Spiteful Haunting', 'sanity', 3, { damageSpec: '1d6', extendOwnerTeam: ctx.caster.team });
    veilSelf(ctx, 2);
  },
});

registerSpell({
  name: 'Needle from Nowhere',
  words: ['pain', 'veil', 'pierce'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  ignoresStealth: true,
  dc: 13,
  description:
    'One enemy within 15cm, even a concealed one, takes 1d6 pierce and 1d6 sanity that cannot miss. You gain a half ' +
    'veil until your next turn.',
  visual: { preset: 'projectile', color: 0xd8b0c8, size: 6, speed: 2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d6', 'pierce', 'Needle from Nowhere', { canMiss: false });
    hit(ctx, foe, '1d6', 'sanity', 'Needle from Nowhere', { canMiss: false });
    veilSelf(ctx, 1);
  },
});

registerSpell({
  name: 'Splitting Migraine',
  words: ['pain', 'mind', 'shatter'],
  actionType: 'main',
  range: R(8),
  targeting: 'enemy',
  dc: 13,
  description: 'One enemy within 8cm takes 2d6 sanity and 1d6 shatter and is stunned for 1 turn.',
  visual: { preset: 'conjure', color: 0xe06a9a, size: 34, speed: 1.3 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '2d6', 'sanity', 'Splitting Migraine');
    hit(ctx, foe, '1d6', 'shatter', 'Splitting Migraine');
    stun(ctx, foe, 1);
  },
});

registerSpell({
  name: 'Corroded Mind',
  words: ['pain', 'mind', 'corrode'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 13,
  description: 'One enemy within 10cm takes 1d6 corrosive and 2d6 sanity, with a 50% chance to be stunned for 1 turn.',
  visual: { preset: 'projectile', color: 0xa8b85a, size: 10, speed: 1.3 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d6', 'corrosive', 'Corroded Mind');
    hit(ctx, foe, '2d6', 'sanity', 'Corroded Mind');
    if (ctx.rng.chance(0.5)) stun(ctx, foe, 1);
  },
});

registerSpell({
  name: 'Haunting Memory',
  words: ['pain', 'mind', 'curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description: 'Curse one enemy within 15cm for 4 turns: at the start of its turns it takes 1d6 sanity and forgets a random action.',
  visual: { preset: 'beam', color: 0xe06a9a, size: 5, speed: 1 },
  cast(ctx) {
    if (ctx.target) curseWith(ctx, ctx.target, 'Haunting Memory', 'sanity', 4, { damageSpec: '1d6', forgetPerTick: 1 });
  },
});

registerSpell({
  name: 'Mind Needle',
  words: ['pain', 'mind', 'pierce'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  ignoresStealth: true,
  dc: 13,
  description:
    'One enemy within 15cm, even a concealed one, takes 1d4 pierce and 2d6 sanity and forgets whatever it did last ' +
    'until the end of its next turn.',
  visual: { preset: 'projectile', color: 0xe06a9a, size: 6, speed: 2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d4', 'pierce', 'Mind Needle');
    hit(ctx, foe, '2d6', 'sanity', 'Mind Needle');
    forgetTokens(ctx, foe, lastDeeds(foe), 2);
  },
});

registerSpell({
  name: 'Acid Agony',
  words: ['pain', 'shatter', 'corrode'],
  actionType: 'main',
  range: R(6),
  targeting: 'point',
  dc: 14,
  aoe: { kind: 'cone', radius: R(6), degrees: 90 },
  description: 'Every unit in a 6cm cone, allies included, takes 1d6 shatter, 1d6 corrosive and 1d4 sanity.',
  visual: { preset: 'burst', color: 0xa8b85a, size: R(3), speed: 1.3 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    strikeAll(
      ctx,
      everyoneInCone(ctx, ctx.targetPoint, R(6), 90),
      [['1d6', 'shatter'], ['1d6', 'corrosive'], ['1d4', 'sanity']],
      'Acid Agony'
    );
  },
});

registerSpell({
  name: 'Shattered Nerves',
  words: ['pain', 'shatter', 'curse'],
  actionType: 'main',
  range: R(8),
  targeting: 'enemy',
  dc: 14,
  description:
    'One enemy within 8cm takes 2d6 shatter and 1d6 sanity. Curse it for 3 turns: 1d6 sanity at the start of its ' +
    'turns, each with a 33% chance to stun it for that turn.',
  visual: { preset: 'conjure', color: RAW, size: 32, speed: 1.2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '2d6', 'shatter', 'Shattered Nerves');
    hit(ctx, foe, '1d6', 'sanity', 'Shattered Nerves');
    curseWith(ctx, foe, 'Shattered Nerves', 'sanity', 3, { damageSpec: '1d6', stunChance: 0.33, stunType: 'full' });
  },
});

registerSpell({
  name: 'Skewer',
  words: ['pain', 'shatter', 'pierce'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 14,
  description: 'One enemy within 10cm takes 3d6 pierce and 1d6 sanity. Left at half its sanity or less, it is stunned for 1 turn.',
  visual: { preset: 'projectile', color: RAW, size: 9, speed: 1.9 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '3d6', 'pierce', 'Skewer');
    hit(ctx, foe, '1d6', 'sanity', 'Skewer');
    if (shaken(foe)) stun(ctx, foe, 1);
  },
});

registerSpell({
  name: 'Wracking Rot',
  words: ['pain', 'corrode', 'curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 14,
  description:
    'Curse one enemy within 15cm for 4 turns: 1d6 corrosive and 1d4 sanity at the start of its turns. It cannot be ' +
    'healed while cursed.',
  visual: { preset: 'beam', color: 0x6f7a4a, size: 6, speed: 1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    curseWith(ctx, foe, 'Wracking Rot', 'corrosive', 4, { damageSpec: '1d6' });
    curseWith(ctx, foe, 'Wracking Agony', 'sanity', 4, { damageSpec: '1d4' });
    if (foe.alive) applyDebuff(ctx, foe, { name: 'Festering', key: 'debuff:wracking-rot', duration: 4, mods: {}, healMult: 0 });
  },
});

registerSpell({
  name: 'Toxic Needle',
  words: ['pain', 'corrode', 'pierce'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 14,
  description: 'One enemy within 12cm takes 1d6 pierce, 1d6 corrosive and 1d6 sanity.',
  visual: { preset: 'projectile', color: 0xa8b85a, size: 7, speed: 1.9 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d6', 'pierce', 'Toxic Needle');
    hit(ctx, foe, '1d6', 'corrosive', 'Toxic Needle');
    hit(ctx, foe, '1d6', 'sanity', 'Toxic Needle');
  },
});

registerSpell({
  name: 'Barbed Torment',
  words: ['pain', 'curse', 'pierce'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 14,
  description:
    'One enemy within 15cm takes 1d6 pierce and is cursed for 4 turns: 1d6 sanity at the start of its turns. Pierce ' +
    'damage on it reopens the curse for another turn, always from 6 or more, otherwise half the time, to at most 4 turns.',
  visual: { preset: 'projectile', color: PAIN_COLOR, size: 8, speed: 1.7 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d6', 'pierce', 'Barbed Torment');
    curseWith(ctx, foe, 'Barbed Torment', 'sanity', 4, {
      damageSpec: '1d6',
      extendOnPierce: { minAmount: 6, chanceBelow: 0.5, maxDuration: 4 },
    });
  },
});

// =============================================================================
//  WATER + PAIN, THREE WORDS
// =============================================================================

registerSpell({
  name: 'Drowning Hold',
  words: ['water', 'pain', 'bind'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 12cm takes 1d4 water, is dragged up to 3cm toward you and is rooted for 2 turns. It takes 1d4 ' +
    'sanity at the start of its next 2 turns.',
  visual: { preset: 'beam', color: WATER_COLOR, size: 7, speed: 1.2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d4', 'water', 'Drowning Hold');
    drag(ctx, foe, ctx.caster.pos, 3);
    root(ctx, foe, 2);
    curseWith(ctx, foe, 'Drowning Hold', 'sanity', 2, { damageSpec: '1d4' });
  },
});

registerSpell({
  name: 'Drowning Dread',
  words: ['water', 'pain', 'shadow'],
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'circle', radius: R(3) },
  description:
    'Every unit within 3cm of a point within 12cm, allies and you included, takes 2d4 sanity and is drawn 3cm toward ' +
    'its centre. A shadow opens there.',
  visual: { preset: 'burst', color: DREAD, size: R(3), speed: 1 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const caught = everyoneAround(ctx, at, R(3));
    strikeAll(ctx, caught, [['2d4', 'sanity']], 'Drowning Dread');
    for (const m of caught) drag(ctx, m, at, 3);
    placeShadow(ctx, at, 3);
  },
});

registerSpell({
  name: 'Panic and Slip',
  words: ['water', 'pain', 'veil'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 10cm takes 1d6 sanity and is pushed 3cm away from you. You dash 3cm the other way and gain a ' +
    'half veil for 2 turns.',
  visual: { preset: 'beam', color: WATER_COLOR, size: 6, speed: 1.4 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const from = { ...foe.pos };
    hit(ctx, foe, '1d6', 'sanity', 'Panic and Slip');
    shove(ctx, foe, ctx.caster.pos, 3);
    dashAwayFrom(ctx, from, 3);
    veilSelf(ctx, 2);
  },
});

registerSpell({
  name: 'Panic Flood',
  words: ['water', 'pain', 'mind'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 15cm takes 1d6 sanity, is swept 1d6cm in a random direction and forgets one random word until ' +
    'the end of its next turn.',
  visual: { preset: 'beam', color: 0x8fb4ff, size: 6, speed: 1.2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d6', 'sanity', 'Panic Flood');
    shoveAlong(ctx, foe, randomHeading(ctx), rollDice(ctx, '1d6', 'Panic Flood sweep', foe));
    forgetTokens(ctx, foe, randomWords(ctx, foe, 1), 2);
  },
});

registerSpell({
  name: 'Riptide Crash',
  words: ['water', 'pain', 'shatter'],
  actionType: 'main',
  range: R(6),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'cone', radius: R(6), degrees: 90 },
  description:
    'A wave crashes through a 6cm cone: enemies in it take 1d6 water and 1d6 sanity and are pushed 4cm away from you. ' +
    'Any slammed into a wall or the field edge takes another 1d6 sanity.',
  visual: { preset: 'burst', color: WATER_COLOR, size: R(3), speed: 1.3 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const foes = foesInCone(ctx, ctx.targetPoint, R(6), 90);
    strikeAll(ctx, foes, [['1d6', 'water'], ['1d6', 'sanity']], 'Riptide Crash');
    for (const foe of foes) {
      if (shove(ctx, foe, ctx.caster.pos, 4)) hit(ctx, foe, '1d6', 'sanity', 'Riptide Crash', { canMiss: false, aoe: true });
    }
  },
});

registerSpell({
  name: 'Acid Rain',
  words: ['water', 'pain', 'corrode'],
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 14,
  aoe: { kind: 'circle', radius: R(3) },
  description:
    'Acid rain falls on a point within 12cm: every unit within 3cm, allies and you included, takes 1d6 corrosive and ' +
    '1d4 sanity and is washed 2cm out from its centre.',
  visual: { preset: 'burst', color: 0x8fb87a, size: R(3), speed: 1 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const caught = everyoneAround(ctx, at, R(3));
    strikeAll(ctx, caught, [['1d6', 'corrosive'], ['1d4', 'sanity']], 'Acid Rain');
    for (const m of caught) shove(ctx, m, at, 2);
  },
});

registerSpell({
  name: 'Drowning Nightmare',
  words: ['water', 'pain', 'curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 14,
  description:
    'Curse one enemy within 15cm for 4 turns: at the start of its turns it takes 1d6 sanity and is pushed 3cm away from you.',
  visual: { preset: 'beam', color: WATER_COLOR, size: 6, speed: 1 },
  cast(ctx) {
    if (ctx.target) curseWith(ctx, ctx.target, 'Drowning Nightmare', 'sanity', 4, { damageSpec: '1d6', drift: { px: R(3) } });
  },
});

registerSpell({
  name: 'Piercing Torrent',
  words: ['water', 'pain', 'pierce'],
  actionType: 'main',
  range: R(18),
  targeting: 'enemy',
  dc: 13,
  description:
    'A torrent hits one enemy within 18cm for 1d6 pierce and 1d6 sanity and pushes it 1cm away for every 3cm between ' +
    'you, at most 6cm.',
  visual: { preset: 'beam', color: WATER_COLOR, size: 7, speed: 1.9 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const push = jetPush(ctx, foe);
    hit(ctx, foe, '1d6', 'pierce', 'Piercing Torrent');
    hit(ctx, foe, '1d6', 'sanity', 'Piercing Torrent');
    shove(ctx, foe, ctx.caster.pos, push);
  },
});

// =============================================================================
//  THE GOD WORDS   (Death and Desecrate are black: they take Pain, never Water)
// =============================================================================

registerSpell({
  name: 'Mortal Agony',
  words: ['pain', 'death'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description: 'One enemy within 15cm takes 2d6 sanity and gains Reap equal to half the sanity dealt, then it is executed for 2.',
  visual: { preset: 'beam', color: 0xb9a0b0, size: 6, speed: 1.2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    ctx.vfx?.godFx?.('deathMark', foe.pos, { size: foe.bodyRadius() * 5, color: PAIN_COLOR });
    const dealt = hit(ctx, foe, '2d6', 'sanity', 'Mortal Agony');
    harvest(ctx, foe, Math.ceil(dealt / 2), 2);
  },
});

registerSpell({
  name: 'Wailing Ground',
  words: ['pain', 'desecrate'],
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'circle', radius: R(5) },
  noCastSprite: true,
  description:
    'Foul a 5cm circle within 12cm for 4 turns. Affected units inside take 2d4 sanity at the start of their turns and ' +
    'cannot be healed. Black and minion units are spared.',
  visual: { preset: 'burst', color: DREAD, size: R(5), speed: 0.9 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    desecrateGround(ctx, ctx.targetPoint, {
      name: 'Wailing Ground',
      radius: R(5),
      turns: 4,
      blocksHealing: true,
      ticks: [{ spec: '2d4', type: 'sanity' }],
    });
  },
});

registerSpell({
  name: 'Dread Harvest',
  words: ['pain', 'death', 'shadow'],
  set: 'finns',
  actionType: 'main',
  range: R(15),
  bonusRangeInOwnShadow: R(99),
  targeting: 'enemy',
  dc: 15,
  description:
    'One enemy within 15cm, or anywhere if it stands in one of your shadows, takes 2d6 sanity and gains Reap equal to ' +
    'half the sanity dealt, all of it if it stands in a shadow. Then it is executed for 3.',
  visual: { preset: 'beam', color: DREAD, size: 7, speed: 1.1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const dark = ctx.game.isInShadow(foe);
    ctx.vfx?.godFx?.('deathMark', foe.pos, { size: foe.bodyRadius() * 6, color: DREAD });
    const dealt = hit(ctx, foe, '2d6', 'sanity', 'Dread Harvest');
    harvest(ctx, foe, dark ? dealt : Math.ceil(dealt / 2), 3);
  },
});

registerSpell({
  name: 'Rotting Agony',
  words: ['pain', 'death', 'corrode'],
  set: 'finns',
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 15,
  description:
    'One enemy within 12cm takes 1d6 corrosive and 1d6 sanity. Curse it for 3 turns: 1d4 sanity and 1 Reap at the ' +
    'start of its turns.',
  visual: { preset: 'projectile', color: 0x8a9a6a, size: 11, speed: 1.2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    ctx.vfx?.godFx?.('hex', foe.pos, { size: foe.bodyRadius() * 5 });
    hit(ctx, foe, '1d6', 'corrosive', 'Rotting Agony');
    hit(ctx, foe, '1d6', 'sanity', 'Rotting Agony');
    curseWith(ctx, foe, 'Rotting Agony', 'sanity', 3, { damageSpec: '1d4', reapPerTick: 1 });
  },
});

registerSpell({
  name: 'Death Throes',
  words: ['pain', 'death', 'curse'],
  set: 'finns',
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 15,
  description:
    'Curse one enemy within 15cm for 4 turns: 1d6 sanity at the start of its turns, each tick adding 2 Reap. It is ' +
    'executed for 2 at once.',
  visual: { preset: 'beam', color: 0x9a7f9c, size: 7, speed: 1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    ctx.vfx?.godFx?.('deathMark', foe.pos, { size: foe.bodyRadius() * 6 });
    curseWith(ctx, foe, 'Death Throes', 'sanity', 4, { damageSpec: '1d6', reapPerTick: 2 });
    harvest(ctx, foe, 0, 2);
  },
});

registerSpell({
  name: 'Shattering Death',
  words: ['pain', 'death', 'shatter'],
  set: 'finns',
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 15,
  description: 'One enemy within 10cm takes 2d6 shatter and 1d6 sanity. Left at half its sanity or less, it is executed for 6.',
  visual: { preset: 'conjure', color: 0xb9c0cc, size: 40, speed: 1.1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    ctx.vfx?.godFx?.('skull', foe.pos, { size: foe.bodyRadius() * 5, color: PAIN_COLOR });
    hit(ctx, foe, '2d6', 'shatter', 'Shattering Death');
    hit(ctx, foe, '1d6', 'sanity', 'Shattering Death');
    if (shaken(foe)) harvest(ctx, foe, 0, 6);
  },
});

registerSpell({
  name: 'Killing Nerve',
  words: ['pain', 'death', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  ignoresStealth: true,
  dc: 15,
  description:
    'One enemy within 20cm, even a concealed one, takes 1d6 pierce and 2d6 sanity that cannot miss. It gains 1 Reap ' +
    'for every 3 sanity it is missing, at most 6, then it is executed for 2.',
  visual: { preset: 'beam', color: 0xb9a0b0, size: 5, speed: 1.9 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    ctx.vfx?.godFx?.('reap', foe.pos, { size: R(5), angle: Math.atan2(foe.y - ctx.caster.y, foe.x - ctx.caster.x) });
    hit(ctx, foe, '1d6', 'pierce', 'Killing Nerve', { canMiss: false });
    hit(ctx, foe, '2d6', 'sanity', 'Killing Nerve', { canMiss: false });
    const missing = foe.isImmuneTo('sanity') ? 0 : Math.max(0, foe.maxSanity - foe.sanity);
    harvest(ctx, foe, Math.min(6, Math.floor(missing / 3)), 2);
  },
});

registerSpell({
  name: 'Wailing Harvest',
  words: ['pain', 'death', 'desecrate'],
  set: 'finns',
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 16,
  description:
    'For 3 rounds every affected unit takes 1d4 sanity at the start of its turn and cannot be healed. Whenever anything ' +
    'dies, every affected unit gains 2 Reap. Black and minion units are spared.',
  visual: { preset: 'nova', color: DREAD, size: 120, speed: 0.8 },
  cast(ctx) {
    ctx.vfx?.godFx?.('deathMark', ctx.caster.pos, { size: R(6), color: DREAD });
    desecrate(ctx, {
      name: 'Wailing Harvest',
      rounds: 3,
      blocksHealing: true,
      reapOnDeath: 2,
      ticks: [{ spec: '1d4', type: 'sanity' }],
    });
  },
});

registerSpell({
  name: 'Haunted Ground',
  words: ['pain', 'desecrate', 'shadow'],
  set: 'finns',
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 15,
  aoe: { kind: 'circle', radius: R(4) },
  noCastSprite: true,
  description:
    'Foul a 4cm circle within 12cm for 5 turns. Affected units inside take 1d6 sanity and 1d4 shadow at the start of ' +
    'their turns and cannot be healed. A shadow opens at its centre.',
  visual: { preset: 'burst', color: DREAD, size: R(4), speed: 0.8 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    ctx.vfx?.godFx?.('void', at, { size: R(4) * 2.2, color: DREAD });
    desecrateGround(ctx, at, {
      name: 'Haunted Ground',
      radius: R(4),
      turns: 5,
      blocksHealing: true,
      ticks: [
        { spec: '1d6', type: 'sanity' },
        { spec: '1d4', type: 'shadow' },
      ],
    });
    placeShadow(ctx, at, 3);
  },
});

registerSpell({
  name: 'Screaming Rot',
  words: ['pain', 'desecrate', 'corrode'],
  set: 'finns',
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 15,
  description: 'For 4 rounds every affected unit takes 1d4 corrosive and 1d4 sanity at the start of its turn and cannot be healed.',
  visual: { preset: 'nova', color: 0x6f7a4a, size: 120, speed: 0.8 },
  cast(ctx) {
    ctx.vfx?.godFx?.('hex', ctx.caster.pos, { size: R(6) });
    desecrate(ctx, {
      name: 'Screaming Rot',
      rounds: 4,
      blocksHealing: true,
      ticks: [
        { spec: '1d4', type: 'corrosive' },
        { spec: '1d4', type: 'sanity' },
      ],
    });
  },
});

registerSpell({
  name: 'Litany of Pain',
  words: ['pain', 'desecrate', 'curse'],
  set: 'finns',
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 15,
  description:
    'For 4 rounds every affected unit takes sanity damage at the start of its turn, deepening each round: 1d4, then ' +
    '1d6, 1d8 and 1d10. It cannot be healed.',
  visual: { preset: 'nova', color: PAIN_COLOR, size: 120, speed: 0.7 },
  cast(ctx) {
    ctx.vfx?.godFx?.('hex', ctx.caster.pos, { size: R(6), color: PAIN_COLOR });
    desecrate(ctx, {
      name: 'Litany of Pain',
      rounds: 4,
      blocksHealing: true,
      ticks: [{ spec: '1d4', type: 'sanity' }],
      stageTicks: [
        [{ spec: '1d4', type: 'sanity' }],
        [{ spec: '1d6', type: 'sanity' }],
        [{ spec: '1d8', type: 'sanity' }],
        [{ spec: '1d10', type: 'sanity' }],
      ],
    });
  },
});

registerSpell({
  name: 'Shrieking Ground',
  words: ['pain', 'desecrate', 'shatter'],
  set: 'finns',
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 15,
  aoe: { kind: 'circle', radius: R(6) },
  noCastSprite: true,
  description:
    'Foul a 6cm circle within 12cm for 4 turns. Affected units inside take 1d6 sanity at the start of their turns and ' +
    'cannot be healed. An affected unit that dies inside bursts: 2d6 shatter to affected units within 3cm of it.',
  visual: { preset: 'burst', color: RAW, size: R(6), speed: 0.8 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    ctx.vfx?.godFx?.('hex', at, { size: R(6) * 2, color: RAW });
    desecrateGround(ctx, at, {
      name: 'Shrieking Ground',
      radius: R(6),
      turns: 4,
      blocksHealing: true,
      burstOnDeath: { spec: '2d6', type: 'shatter', radius: R(3) },
      ticks: [{ spec: '1d6', type: 'sanity' }],
    });
  },
});

registerSpell({
  name: 'Torment Spikes',
  words: ['pain', 'desecrate', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 15,
  description:
    'Spikes rise beneath every affected unit on the field: 1d6 pierce and 1d6 sanity, and it is rooted for 1 turn. ' +
    'Black and minion units are spared.',
  visual: { preset: 'nova', color: PAIN_COLOR, size: 140, speed: 0.9 },
  cast(ctx) {
    const prey = ctx.game.mages.filter((m) => m.alive && ctx.game.isDesecrationAffected(m) && !ctx.game.isUnreachable(m));
    if (prey.length === 0) {
      ctx.log('Nothing unhallowed stands on the field.');
      return;
    }
    for (const m of prey) ctx.vfx?.godFx?.('hex', m.pos, { size: m.bodyRadius() * 4, color: PAIN_COLOR });
    strikeAll(ctx, prey, [['1d6', 'pierce'], ['1d6', 'sanity']], 'Torment Spikes');
    for (const m of prey) root(ctx, m, 1);
  },
});
