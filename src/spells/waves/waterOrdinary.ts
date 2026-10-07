// =============================================================================
//  WATER · ORDINARY SPELLS
// -----------------------------------------------------------------------------
//  Water is blue: water damage and forced movement. Its spells push, drag,
//  sweep, swap and fling bodies, and a push into a wall or the field edge slams
//  for 2d6 shatter. A blue majority controls, a black one hits everyone, a
//  colourless one hits hardest. Every combo with Pain lives in painOrdinary.ts.
// =============================================================================

import { dmg } from '../../core/Damage';
import type { Mage } from '../../core/Mage';
import type { BlueflareStatus, FireStatus } from '../../core/Status';
import { dist, stepTowards, type Vec2 } from '../../core/utils';
import {
  applyBlueflareStacks,
  applyFireStacks,
  applyInvisibility,
  critScale,
  dash,
  dealDamage,
  placeHazardZone,
  placeShadow,
  placeWall,
  rollDice,
  type EffectContext,
} from '../../effects/effects';
import { applyMindLightningStack, mindLightningDamage } from '../mindLightning';
import { registerSpell } from '../registry';
import { castPower } from './classWave';
import {
  awayFromFoes,
  cmApart,
  curseWith,
  dashAwayFrom,
  deedsToForget,
  drag,
  edgeOnRay,
  everyoneAround,
  FIELD_DIAGONAL,
  fling,
  foesAround,
  foesInCone,
  foesOnLane,
  forgetTokens,
  hideFrom,
  hit,
  lane,
  lastDeeds,
  nearestEdgePoint,
  R,
  randomWords,
  relocate,
  root,
  shove,
  shoveAlong,
  strikeAll,
  stun,
  swapPlaces,
  veilSelf,
  WATER_COLOR,
} from './waterKit';

const DARK_WATER = 0x3a5a8c;
const BRINE = 0x6fb8a0;

/** Push 1cm per 3cm between the caster and `m`, at most `max`. */
const jetPush = (ctx: EffectContext, m: Mage, max = 6): number =>
  Math.min(max, Math.floor(cmApart(ctx.caster.pos, m.pos) / 3));

/** Move a friend by its own feet, a foe by force. */
function carry(ctx: EffectContext, m: Mage, to: Vec2, cm: number): void {
  if (m.team !== ctx.caster.team) {
    drag(ctx, m, to, cm);
    return;
  }
  if (!m.alive || ctx.game.isImmovable(m) || dist(m.pos, to) < 0.5) return;
  dash(ctx, m, { toPoint: to, distance: R(cm) });
}

/** The caster's shadow pool nearest to `p`, if any. */
function nearestOwnShadow(ctx: EffectContext, p: Vec2): Vec2 | undefined {
  return ctx.game
    .shadowsOf(ctx.caster.team)
    .map((s) => ({ x: s.x, y: s.y }))
    .sort((a, b) => dist(a, p) - dist(b, p))[0];
}

/** The answered action's source when cast as a reaction, else the chosen target. */
function answeredOrTarget(ctx: EffectContext): Mage | null {
  const foe = ctx.game.counteredItem?.source ?? ctx.target;
  return foe?.alive ? foe : null;
}

/** Halfway between the caster and its aimed point, for art spanning both. */
const midway = (ctx: EffectContext): Vec2 => ({
  x: ctx.caster.x + (ctx.targetPoint ? (ctx.targetPoint.x - ctx.caster.x) / 2 : 0),
  y: ctx.caster.y + (ctx.targetPoint ? (ctx.targetPoint.y - ctx.caster.y) / 2 : 0),
});

// =============================================================================
//  ONE AND TWO WORDS
// =============================================================================

registerSpell({
  name: 'Water',
  words: ['water'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 7,
  description:
    'Hit one enemy within 15cm with water. Within 3cm it takes 1d6 water and is knocked back 1d6cm; within 10cm, ' +
    '1d3 water and 1d4cm; farther, 1d2 water and 1d3cm.',
  visual: { preset: 'projectile', color: WATER_COLOR, size: 10, speed: 1.5 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const gap = cmApart(ctx.caster.pos, foe.pos);
    const [spec, push] = gap <= 3 ? ['1d6', '1d6'] : gap < 10 ? ['1d3', '1d4'] : ['1d2', '1d3'];
    hit(ctx, foe, spec, 'water', 'Water');
    shove(ctx, foe, ctx.caster.pos, rollDice(ctx, push, 'Water knockback', foe));
  },
});

registerSpell({
  name: 'Undertow Snare',
  words: ['water', 'bind'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 11,
  description: 'One enemy within 12cm takes 1d3 water, is dragged up to 4cm to a point you choose and is rooted for 2 turns.',
  visual: { preset: 'beam', color: WATER_COLOR, size: 7, speed: 1.3 },
  async cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d3', 'water', 'Water Bind');
    const toward = stepTowards(foe.pos, ctx.caster.pos, R(4));
    const to =
      (await ctx.requestPoint?.({ maxRange: R(4), origin: foe.pos, prompt: 'Water Bind: drag it where?', aiPoint: toward })) ??
      toward;
    drag(ctx, foe, to, 4);
    root(ctx, foe, 2);
  },
});

registerSpell({
  name: 'Black Tide',
  words: ['water', 'shadow'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 11,
  description:
    'One enemy within 15cm takes 2d4 water and is pushed 3cm away from you. Standing in a shadow, it takes 4d4 and ' +
    'is pushed 6cm instead. A shadow opens where it stops.',
  visual: { preset: 'projectile', color: DARK_WATER, size: 11, speed: 1.3 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const dark = ctx.game.isInShadow(foe);
    hit(ctx, foe, dark ? '4d4' : '2d4', 'water', 'Black Tide');
    shove(ctx, foe, ctx.caster.pos, dark ? 6 : 3);
    placeShadow(ctx, foe.pos, 3);
  },
});

registerSpell({
  name: 'Mist Step',
  words: ['water', 'veil'],
  actionType: 'bonus',
  range: R(8),
  targeting: 'any',
  dc: 9,
  reaction: true,
  description: 'A chosen mage within 8cm is carried up to 4cm to a point you choose and gains a half veil for 2 turns.',
  visual: { preset: 'heal', color: WATER_COLOR, size: 44, speed: 1.2 },
  async cast(ctx) {
    const mage = ctx.target ?? ctx.caster;
    const away = awayFromFoes(ctx, mage, 4);
    const to =
      (await ctx.requestPoint?.({ maxRange: R(4), origin: mage.pos, prompt: 'Water Veil: carry it where?', aiPoint: away })) ??
      away;
    carry(ctx, mage, to, 4);
    if (mage.alive) applyInvisibility(ctx, mage, { duration: 2, mode: 'partial' });
  },
});

registerSpell({
  name: 'Washed Mind',
  words: ['water', 'mind'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 11,
  description:
    'One enemy within 15cm takes 1d4 sanity, is pushed 1d4cm away from you and forgets one random word until the end ' +
    'of its next turn.',
  visual: { preset: 'beam', color: 0x8fb4ff, size: 6, speed: 1.2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d4', 'sanity', 'Water Mind');
    shove(ctx, foe, ctx.caster.pos, rollDice(ctx, '1d4', 'Water Mind push', foe));
    forgetTokens(ctx, foe, randomWords(ctx, foe, 1), 2);
  },
});

registerSpell({
  name: 'Overhead Fling',
  words: ['water', 'shatter'],
  actionType: 'main',
  range: R(10),
  targeting: 'point',
  dc: 12,
  aoe: { kind: 'circle', radius: R(2) },
  description:
    'Everything within 2cm of a point within 10cm is flung over you and lands mirrored on your other side. Each unit ' +
    'flung takes 1d6 water and 1d5 shatter. A wall, totem or item that lands on a unit deals it 2d6 shatter.',
  visual: { preset: 'burst', color: WATER_COLOR, size: R(2), speed: 1.2 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    fling(ctx, ctx.targetPoint, R(2), [{ spec: '1d6', type: 'water' }, { spec: '1d5', type: 'shatter' }], '2d6');
  },
});

registerSpell({
  name: 'Brine Surge',
  words: ['water', 'corrode'],
  actionType: 'main',
  range: R(10),
  targeting: 'point',
  dc: 11,
  aoe: { kind: 'circle', radius: R(2) },
  description:
    'Brine bursts at a point within 10cm: enemies within 2cm take 1d4 corrosive and 1d4 water, then are flushed 3cm ' +
    'out from its centre.',
  visual: { preset: 'burst', color: BRINE, size: R(2), speed: 1.1 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const foes = foesAround(ctx, at, R(2));
    strikeAll(ctx, foes, [['1d4', 'corrosive'], ['1d4', 'water']], 'Brine Surge');
    for (const foe of foes) shove(ctx, foe, at, 3);
  },
});

registerSpell({
  name: 'Undertow',
  words: ['water', 'curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 11,
  description: 'Curse one enemy within 15cm for 4 turns: at the start of its turns it takes 1d3 water and is dragged 2cm toward you.',
  visual: { preset: 'beam', color: DARK_WATER, size: 6, speed: 1 },
  cast(ctx) {
    if (ctx.target) curseWith(ctx, ctx.target, 'Undertow', 'water', 4, { damageSpec: '1d3', drift: { px: -R(2) } });
  },
});

registerSpell({
  name: 'Water Jet',
  words: ['water', 'pierce'],
  actionType: 'main',
  range: R(18),
  targeting: 'enemy',
  dc: 11,
  description:
    'A jet hits one enemy within 18cm for 1d4 pierce and 1d4 water and pushes it 1cm away from you for every 3cm ' +
    'between you, at most 6cm.',
  visual: { preset: 'beam', color: WATER_COLOR, size: 6, speed: 1.8 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const push = jetPush(ctx, foe);
    hit(ctx, foe, '1d4', 'pierce', 'Water Jet');
    hit(ctx, foe, '1d4', 'water', 'Water Jet');
    shove(ctx, foe, ctx.caster.pos, push);
  },
});

// =============================================================================
//  THREE WORDS
// =============================================================================

registerSpell({
  name: 'Drowning Dark',
  words: ['water', 'bind', 'shadow'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  description:
    'Root one enemy within 12cm for 2 turns and drag it up to 5cm toward your nearest shadow. If it ends inside a ' +
    'shadow it is also stunned for 1 turn. A shadow opens where it stops.',
  visual: { preset: 'beam', color: DARK_WATER, size: 8, speed: 1.1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const pool = nearestOwnShadow(ctx, foe.pos);
    if (pool) drag(ctx, foe, pool, 5);
    root(ctx, foe, 2);
    if (foe.alive && ctx.game.isInShadow(foe)) stun(ctx, foe, 1);
    placeShadow(ctx, foe.pos, 3);
  },
});

registerSpell({
  name: 'Tidal Refuge',
  words: ['water', 'bind', 'veil'],
  actionType: 'main',
  range: R(10),
  targeting: 'any',
  dc: 13,
  reaction: true,
  description:
    'Every enemy within 4cm of a chosen mage within 10cm is pushed 4cm away from it and rooted for 1 turn. The mage ' +
    'gains a half veil for 2 turns.',
  visual: { preset: 'nova', color: WATER_COLOR, size: R(4), speed: 1.3 },
  cast(ctx) {
    const mage = ctx.target ?? ctx.caster;
    for (const foe of foesAround(ctx, mage.pos, R(4))) {
      if (foe === mage) continue;
      shove(ctx, foe, mage.pos, 4);
      root(ctx, foe, 1);
    }
    if (mage.alive) applyInvisibility(ctx, mage, { duration: 2, mode: 'partial' });
  },
});

registerSpell({
  name: 'Lost at Sea',
  words: ['water', 'bind', 'mind'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 15cm trades places with a unit you choose within 10cm of it, or with you. Each enemy moved ' +
    'takes 1d4 sanity and is rooted for 1 turn.',
  visual: { preset: 'beam', color: 0x8fb4ff, size: 7, speed: 1.1 },
  async cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const candidates = everyoneAround(ctx, foe.pos, R(10)).filter((m) => m !== foe && m !== ctx.caster);
    const picked =
      candidates.length > 0
        ? await ctx.requestCombatant?.({ candidates, range: R(10), origin: foe.pos, prompt: 'Water Bind Mind: who trades places with it?' })
        : null;
    const other = picked ?? ctx.caster;
    if (!swapPlaces(ctx, foe, other)) return;
    for (const m of [foe, other]) {
      if (m.team === ctx.caster.team) continue;
      hit(ctx, m, '1d4', 'sanity', 'Lost at Sea', { canMiss: false });
      root(ctx, m, 1);
    }
  },
});

registerSpell({
  name: 'Crushing Wave',
  words: ['water', 'bind', 'shatter'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 10cm takes 1d6 water and is hurled 5cm away from you. Slammed into a wall or the field edge, it ' +
    'is stunned for 1 turn; otherwise it is rooted for 2 turns.',
  visual: { preset: 'projectile', color: WATER_COLOR, size: 13, speed: 1.4 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d6', 'water', 'Crushing Wave');
    if (shove(ctx, foe, ctx.caster.pos, 5)) stun(ctx, foe, 1);
    else root(ctx, foe, 2);
  },
});

registerSpell({
  name: 'Salt Shackles',
  words: ['water', 'bind', 'corrode'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  description:
    'Root one enemy within 12cm for 2 turns. For 3 turns, at the start of its turns it takes 1d4 corrosive and is ' +
    'dragged 2cm toward you.',
  visual: { preset: 'beam', color: BRINE, size: 7, speed: 1.1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    root(ctx, foe, 2);
    curseWith(ctx, foe, 'Salt Shackles', 'corrosive', 3, { damageSpec: '1d4', drift: { px: -R(2) } });
  },
});

registerSpell({
  name: 'Tidal Lock',
  words: ['water', 'bind', 'curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'Curse one enemy within 15cm to the spot it stands on for 4 turns: at the start of its turns it takes 1d4 water ' +
    'and is dragged up to 4cm back toward that spot.',
  visual: { preset: 'beam', color: DARK_WATER, size: 7, speed: 1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    curseWith(ctx, foe, 'Tidal Lock', 'water', 4, { damageSpec: '1d4', drift: { px: R(4), to: { ...foe.pos } } });
  },
});

registerSpell({
  name: 'Pinning Jet',
  words: ['water', 'bind', 'pierce'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'A jet hits one enemy within 15cm for 1d6 pierce and pushes it 4cm away from you. Slammed into a wall or the field ' +
    'edge, it is pinned there: another 1d6 pierce, and rooted for 2 turns.',
  visual: { preset: 'beam', color: WATER_COLOR, size: 6, speed: 1.9 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d6', 'pierce', 'Pinning Jet');
    if (!shove(ctx, foe, ctx.caster.pos, 4)) return;
    hit(ctx, foe, '1d6', 'pierce', 'Pinned', { canMiss: false });
    root(ctx, foe, 2);
  },
});

registerSpell({
  name: 'Dark Wave',
  words: ['water', 'shadow', 'veil'],
  actionType: 'main',
  range: R(8),
  targeting: 'point',
  dc: 13,
  description:
    'Ride a dark wave up to 8cm toward a point. Shadows open where you leave and where you land, every enemy within ' +
    '2cm of where you land is pushed 3cm away, and you gain a half veil for 2 turns.',
  visual: { preset: 'nova', color: DARK_WATER, size: R(2), speed: 1.3 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    placeShadow(ctx, ctx.caster.pos, 3);
    dash(ctx, ctx.caster, { toPoint: ctx.targetPoint, distance: R(8) });
    placeShadow(ctx, ctx.caster.pos, 3);
    for (const foe of foesAround(ctx, ctx.caster.pos, R(2))) shove(ctx, foe, ctx.caster.pos, 3);
    veilSelf(ctx, 2);
  },
});

registerSpell({
  name: 'Drowned Memory',
  words: ['water', 'shadow', 'mind'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 15cm takes 1d6 sanity, is pushed 2cm away and forgets one random word until the end of its next ' +
    'turn. Standing in a shadow, it takes 2d6 and forgets two words. A shadow opens under it.',
  visual: { preset: 'beam', color: DARK_WATER, size: 7, speed: 1.1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const dark = ctx.game.isInShadow(foe);
    hit(ctx, foe, dark ? '2d6' : '1d6', 'sanity', 'Drowned Memory');
    shove(ctx, foe, ctx.caster.pos, 2);
    forgetTokens(ctx, foe, randomWords(ctx, foe, dark ? 2 : 1), 2);
    placeShadow(ctx, foe.pos, 3);
  },
});

registerSpell({
  name: 'Black Breaker',
  words: ['water', 'shadow', 'shatter'],
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 14,
  aoe: { kind: 'circle', radius: R(3) },
  description:
    'A dark wave breaks on a point within 12cm: enemies within 3cm take 1d6 water and 1d6 shatter and are thrown 3cm ' +
    'out from its centre, or 6cm if they stand in a shadow.',
  visual: { preset: 'burst', color: DARK_WATER, size: R(3), speed: 1.2 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const foes = foesAround(ctx, at, R(3));
    const dark = new Set(foes.filter((m) => ctx.game.isInShadow(m)));
    strikeAll(ctx, foes, [['1d6', 'water'], ['1d6', 'shatter']], 'Black Breaker');
    for (const foe of foes) shove(ctx, foe, at, dark.has(foe) ? 6 : 3);
  },
});

registerSpell({
  name: 'Bilge Pit',
  words: ['water', 'shadow', 'corrode'],
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 14,
  aoe: { kind: 'circle', radius: R(3) },
  noCastSprite: true,
  description:
    'Flood a 3cm circle within 12cm with black bilge for 3 rounds. Anyone starting a turn inside, allies and you ' +
    'included, takes 1d6 corrosive and is drawn 2cm toward its centre. A shadow opens at its centre.',
  visual: { preset: 'burst', color: 0x3b5a4a, size: R(3), speed: 0.9 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    placeHazardZone(ctx, at, {
      name: 'Bilge Pit',
      radius: R(3),
      rounds: 3,
      damageSpecs: ['1d6'],
      damageType: 'corrosive',
      drift: { px: R(2), inward: true },
      color: 0x3b5a4a,
    });
    placeShadow(ctx, at, 3);
  },
});

registerSpell({
  name: 'Rising Dark',
  words: ['water', 'shadow', 'curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 14,
  description:
    'Curse one enemy within 15cm for 4 turns: at the start of its turns it takes 1d4, then 1d6, 1d8 and 1d10 shadow, ' +
    'and is dragged 2cm toward you.',
  visual: { preset: 'beam', color: DARK_WATER, size: 6, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    curseWith(ctx, ctx.target, 'Rising Dark', 'shadow', 4, {
      escalateSpecs: ['1d4', '1d6', '1d8', '1d10'],
      drift: { px: -R(2) },
    });
  },
});

registerSpell({
  name: 'Dark Current',
  words: ['water', 'shadow', 'pierce'],
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 13,
  noCastSprite: true,
  description:
    'A current runs 12cm from you toward a point. Every enemy on it takes 1d6 pierce and is swept to its far end, ' +
    'where a shadow opens.',
  visual: { preset: 'beam', color: DARK_WATER, size: 9, speed: 1.5 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const { from, to } = lane(ctx, ctx.targetPoint, R(12));
    const foes = foesOnLane(ctx, from, to);
    strikeAll(ctx, foes, [['1d6', 'pierce']], 'Dark Current');
    [...foes].reverse().forEach((foe, i) => {
      if (foe.alive) ctx.game.forceMove(ctx.caster, foe, stepTowards(to, from, i * R(1.1)));
    });
    placeShadow(ctx, to, 3);
  },
});

registerSpell({
  name: 'Mirage Flood',
  words: ['water', 'veil', 'mind'],
  actionType: 'main',
  range: 0,
  targeting: 'self',
  dc: 13,
  aoe: { kind: 'circle', radius: R(5) },
  description: 'Every enemy within 5cm of you takes 1d4 sanity, is pushed 3cm away and cannot single you out for 2 turns.',
  visual: { preset: 'nova', color: 0x8fb4ff, size: R(5), speed: 1.2 },
  cast(ctx) {
    const foes = foesAround(ctx, ctx.caster.pos, R(5));
    strikeAll(ctx, foes, [['1d4', 'sanity']], 'Mirage Flood');
    for (const foe of foes) {
      shove(ctx, foe, ctx.caster.pos, 3);
      hideFrom(ctx, foe, 3);
    }
  },
});

registerSpell({
  name: 'Breakwater',
  words: ['water', 'veil', 'shatter'],
  actionType: 'main',
  range: R(10),
  targeting: 'point',
  dc: 13,
  rotatableWall: { length: R(6), thickness: 16 },
  noCastSprite: true,
  description:
    'Raise a 6cm wall of water within 10cm for 2 rounds; [H] rotates it while aiming. Nothing walks through it, and ' +
    'enemies within 2cm of it are pushed 2cm away as it rises. When it falls it breaks: every unit within 2cm of it ' +
    'takes 1d6 water and 1d4 shatter.',
  visual: { preset: 'burst', color: WATER_COLOR, size: 40, speed: 1 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const angle = ctx.caster.wallAngle;
    const along = { x: Math.cos(angle), y: Math.sin(angle) };
    const normal = { x: -Math.sin(angle), y: Math.cos(angle) };
    for (const m of everyoneAround(ctx, at, R(3) + R(2))) {
      const dx = m.x - at.x;
      const dy = m.y - at.y;
      if (Math.abs(dx * along.x + dy * along.y) > R(3) + m.bodyRadius()) continue;
      const across = dx * normal.x + dy * normal.y;
      const side = across >= 0 ? 1 : -1;
      const clear = 8 + m.bodyRadius() + 1;
      if (Math.abs(across) < clear) {
        const shift = side * clear - across;
        relocate(ctx, m, { x: m.x + normal.x * shift, y: m.y + normal.y * shift });
      } else if (m.team !== ctx.caster.team && Math.abs(across) <= clear + R(2)) {
        shoveAlong(ctx, m, { x: normal.x * side, y: normal.y * side }, 2);
      }
    }
    placeWall(ctx, at, {
      angle,
      length: R(6),
      thickness: 16,
      ttl: critScale(ctx, 2),
      burst: { radius: R(2), hits: [{ spec: '1d6', type: 'water' }, { spec: '1d4', type: 'shatter' }] },
    });
  },
});

registerSpell({
  name: 'Salt Fog',
  words: ['water', 'veil', 'corrode'],
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'circle', radius: R(3) },
  noCastSprite: true,
  description:
    'Raise a 3cm salt fog within 12cm for 3 rounds. Targeted attacks on anyone inside miss half the time. Anyone ' +
    'starting a turn inside, allies and you included, takes 1d3 corrosive and is pushed 2cm out from its centre.',
  visual: { preset: 'burst', color: 0x9fc9c0, size: R(3), speed: 0.9 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    placeHazardZone(ctx, at, {
      name: 'Salt Fog',
      radius: R(3),
      rounds: 3,
      damageSpecs: ['1d3'],
      damageType: 'corrosive',
      dodgeChance: 0.5,
      drift: { px: R(2), inward: false },
      color: 0x9fc9c0,
    });
  },
});

registerSpell({
  name: 'Drifting Hex',
  words: ['water', 'veil', 'curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'Curse one enemy within 15cm for 3 turns: at the start of its turns it takes 1d4 water and drifts 3cm in a ' +
    'direction you choose, slamming into whatever wall or edge it reaches. You gain a half veil for 2 turns.',
  visual: { preset: 'beam', color: WATER_COLOR, size: 6, speed: 1 },
  async cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const edge = nearestEdgePoint(foe.pos);
    const aim =
      (await ctx.requestPoint?.({ maxRange: FIELD_DIAGONAL, origin: foe.pos, prompt: 'Water Veil Curse: which way does it drift?', aiPoint: edge })) ??
      edge;
    curseWith(ctx, foe, 'Drifting Hex', 'water', 3, { damageSpec: '1d4', drift: { px: R(3), to: edgeOnRay(foe.pos, aim) } });
    veilSelf(ctx, 2);
  },
});

registerSpell({
  name: 'Spray and Slip',
  words: ['water', 'veil', 'pierce'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 15cm takes 1d6 pierce and 1d4 water and is pushed 2cm away. You dash 3cm straight away from it ' +
    'and gain a half veil until your next turn.',
  visual: { preset: 'beam', color: WATER_COLOR, size: 6, speed: 1.8 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d6', 'pierce', 'Spray and Slip');
    hit(ctx, foe, '1d4', 'water', 'Spray and Slip');
    shove(ctx, foe, ctx.caster.pos, 2);
    dashAwayFrom(ctx, foe.pos, 3);
    veilSelf(ctx, 1);
  },
});

registerSpell({
  name: 'Concussive Wave',
  words: ['water', 'mind', 'shatter'],
  actionType: 'main',
  range: R(6),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'cone', radius: R(6), degrees: 90 },
  description:
    'A wave crashes through a 6cm cone: enemies in it take 1d6 water and 1d4 sanity and are pushed 3cm away from you. ' +
    'Any slammed into a wall or the field edge is also stunned for 1 turn.',
  visual: { preset: 'burst', color: WATER_COLOR, size: R(3), speed: 1.3 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const foes = foesInCone(ctx, ctx.targetPoint, R(6), 90);
    strikeAll(ctx, foes, [['1d6', 'water'], ['1d4', 'sanity']], 'Concussive Wave');
    for (const foe of foes) if (shove(ctx, foe, ctx.caster.pos, 3)) stun(ctx, foe, 1);
  },
});

registerSpell({
  name: 'Brine Thoughts',
  words: ['water', 'mind', 'corrode'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'Curse one enemy within 15cm for 3 turns: at the start of its turns it takes 1d4 corrosive, forgets a random ' +
    'action and is dragged 2cm toward you.',
  visual: { preset: 'beam', color: BRINE, size: 6, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    curseWith(ctx, ctx.target, 'Brine Thoughts', 'corrosive', 3, { damageSpec: '1d4', forgetPerTick: 1, drift: { px: -R(2) } });
  },
});

registerSpell({
  name: 'Whirling Madness',
  words: ['water', 'mind', 'curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description: 'Curse one enemy within 15cm for 4 turns: at the start of its turns it takes 1d4 sanity and is whirled a quarter turn around you.',
  visual: { preset: 'beam', color: 0x8fb4ff, size: 6, speed: 1 },
  cast(ctx) {
    if (ctx.target) curseWith(ctx, ctx.target, 'Whirling Madness', 'sanity', 4, { damageSpec: '1d4', orbitSource: true });
  },
});

registerSpell({
  name: 'Thought Jet',
  words: ['water', 'mind', 'pierce'],
  actionType: 'main',
  range: R(18),
  targeting: 'enemy',
  dc: 13,
  description:
    'A jet hits one enemy within 18cm for 1d6 pierce and 1d4 sanity and pushes it 1cm away for every 3cm between you, ' +
    'at most 6cm. It forgets whatever it did last until the end of its next turn.',
  visual: { preset: 'beam', color: 0x8fb4ff, size: 6, speed: 1.8 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const push = jetPush(ctx, foe);
    hit(ctx, foe, '1d6', 'pierce', 'Thought Jet');
    hit(ctx, foe, '1d4', 'sanity', 'Thought Jet');
    shove(ctx, foe, ctx.caster.pos, push);
    forgetTokens(ctx, foe, lastDeeds(foe), 2);
  },
});

registerSpell({
  name: 'Corroding Surf',
  words: ['water', 'shatter', 'corrode'],
  actionType: 'main',
  range: R(10),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'circle', radius: R(2) },
  description:
    'Surf breaks on a point within 10cm: enemies within 2cm take 1d6 shatter and 1d4 corrosive and are thrown 4cm out ' +
    'from its centre. Any slammed into a wall or the field edge takes another 1d6 corrosive.',
  visual: { preset: 'burst', color: BRINE, size: R(2), speed: 1.2 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const foes = foesAround(ctx, at, R(2));
    strikeAll(ctx, foes, [['1d6', 'shatter'], ['1d4', 'corrosive']], 'Corroding Surf');
    for (const foe of foes) {
      if (shove(ctx, foe, at, 4)) hit(ctx, foe, '1d6', 'corrosive', 'Corroding Surf', { canMiss: false, aoe: true });
    }
  },
});

registerSpell({
  name: 'Hammer Tide',
  words: ['water', 'shatter', 'curse'],
  actionType: 'main',
  range: R(8),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 8cm takes 2d6 shatter and is pushed 4cm away. Curse it for 3 turns: at the start of its turns it ' +
    'takes 1d4 water and is pushed 2cm further from you.',
  visual: { preset: 'conjure', color: WATER_COLOR, size: 34, speed: 1.3 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '2d6', 'shatter', 'Hammer Tide');
    shove(ctx, foe, ctx.caster.pos, 4);
    curseWith(ctx, foe, 'Hammer Tide', 'water', 3, { damageSpec: '1d4', drift: { px: R(2) } });
  },
});

registerSpell({
  name: 'Hydro Lance',
  words: ['water', 'shatter', 'pierce'],
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 14,
  noCastSprite: true,
  description:
    'A pressurised lance runs 12cm from you toward a point. Every enemy on it takes 2d6 pierce and 1d6 water and is ' +
    'thrown 3cm off the line.',
  visual: { preset: 'beam', color: WATER_COLOR, size: 10, speed: 2 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const { from, to } = lane(ctx, ctx.targetPoint, R(12));
    const foes = foesOnLane(ctx, from, to);
    strikeAll(ctx, foes, [['2d6', 'pierce'], ['1d6', 'water']], 'Hydro Lance');
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    for (const foe of foes) {
      const side = dx * (foe.y - from.y) - dy * (foe.x - from.x) >= 0 ? 1 : -1;
      shoveAlong(ctx, foe, { x: -dy * side, y: dx * side }, 3);
    }
  },
});

registerSpell({
  name: 'Brackish Rot',
  words: ['water', 'corrode', 'curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 14,
  description:
    'Curse one enemy within 15cm for 4 turns: at the start of its turns it takes 1d4 corrosive and is dragged 2cm ' +
    'toward you. Each tick the rot spreads, at half its remaining time, to every unit within 3cm of it, allies and you ' +
    'included.',
  visual: { preset: 'beam', color: BRINE, size: 7, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    curseWith(ctx, ctx.target, 'Brackish Rot', 'corrosive', 4, { damageSpec: '1d4', spreadRadius: R(3), drift: { px: -R(2) } });
  },
});

registerSpell({
  name: 'Brine Harpoon',
  words: ['water', 'corrode', 'pierce'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'A harpoon hits one enemy within 15cm for 1d6 pierce and reels it 4cm toward you. Brine eats it for 3 turns: 1d4 ' +
    'corrosive at the start of its turns.',
  visual: { preset: 'projectile', color: BRINE, size: 9, speed: 1.8 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d6', 'pierce', 'Brine Harpoon');
    drag(ctx, foe, ctx.caster.pos, 4);
    curseWith(ctx, foe, 'Brine', 'corrosive', 3, { damageSpec: '1d4' });
  },
});

registerSpell({
  name: 'Mark of the Tide',
  words: ['water', 'curse', 'pierce'],
  actionType: 'main',
  range: R(18),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 18cm takes 1d6 pierce. Curse it for 3 turns: at the start of its turns it takes 1d3 water and is ' +
    'carried 3cm toward its nearest field edge, slamming into it on arrival.',
  visual: { preset: 'beam', color: WATER_COLOR, size: 5, speed: 1.9 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d6', 'pierce', 'Mark of the Tide');
    curseWith(ctx, foe, 'Mark of the Tide', 'water', 3, { damageSpec: '1d3', drift: { px: R(3), to: nearestEdgePoint(foe.pos) } });
  },
});

// =============================================================================
//  FIRE AND LIGHTNING   (blue-red: controlled damage; Lightning scales with power)
// =============================================================================

const STEAM = 0xd9e8f2;
const STORM = 0x9fc8ff;

const fireOf = (m: Mage): number => (m.statuses.find((s) => s.kind === 'fire') as FireStatus | undefined)?.stacks ?? 0;
const blueflareOf = (m: Mage): number =>
  (m.statuses.find((s) => s.kind === 'blueflare') as BlueflareStatus | undefined)?.stacks ?? 0;
/** `spec` with a flat bonus added. */
const plus = (spec: string, bonus: number): string => (bonus > 0 ? `${spec}+${bonus}` : spec);

registerSpell({
  name: 'Scalding Jet',
  words: ['water', 'fire'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 11,
  description:
    'One enemy within 12cm takes 1d4 water and is pushed 3cm away from you. If it was burning, its Fire boils off ' +
    'as steam: it and every enemy within 2cm of it take 1d4 heat per Fire stack lost (at most 6d4). Otherwise it ' +
    'takes 1d4 heat and gains 1 Fire.',
  visual: { preset: 'beam', color: STEAM, size: 8, speed: 1.6 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const burning = fireOf(foe);
    hit(ctx, foe, '1d4', 'water', 'Scalding Jet');
    if (foe.alive && burning > 0) {
      foe.statuses = foe.statuses.filter((s) => s.kind !== 'fire');
      ctx.log(`${foe.name}'s Fire boils off as steam.`);
      const scalded = [foe, ...foesAround(ctx, foe.pos, R(2)).filter((m) => m !== foe)];
      strikeAll(ctx, scalded, [[`${Math.min(6, burning)}d4`, 'heat']], 'Steam');
    } else if (foe.alive) {
      hit(ctx, foe, '1d4', 'heat', 'Scalding Jet');
      if (foe.alive) applyFireStacks(ctx, foe, 1);
    }
    shove(ctx, foe, ctx.caster.pos, 3);
  },
});

registerSpell({
  name: 'Conducting Wave',
  words: ['water', 'lightning'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 12,
  description:
    'A wave hits one enemy within 15cm for 1d6 water and pushes it 1cm per 5 Lightning power (at least 1cm). ' +
    'Lightning runs through the water: every other enemy within a quarter of the Lightning power in cm of it (at ' +
    'least 2cm) takes 1d6 heat plus 1 per 6 Lightning power.',
  visual: { preset: 'projectile', color: STORM, size: 10, speed: 1.5 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const power = castPower(ctx);
    hit(ctx, foe, '1d6', 'water', 'Conducting Wave');
    shove(ctx, foe, ctx.caster.pos, Math.max(1, Math.floor(power / 5)));
    const struck = everyoneAround(ctx, foe.pos, R(Math.max(2, power / 4))).filter(
      (m) => m !== foe && m.team !== ctx.caster.team
    );
    for (const m of struck) void ctx.vfx?.lightningBolt?.(foe.pos, m.pos);
    strikeAll(ctx, struck, [[plus('1d6', Math.floor(power / 6)), 'heat']], 'Conducted lightning');
  },
});

registerSpell({
  name: 'Scalding Memory',
  words: ['water', 'mind', 'fire'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 15cm takes 1d4 water, gains 2 Blueflare, is pushed 2cm away from you and forgets whatever it ' +
    'did last until the end of its next turn. If it already carried Blueflare, the flare pulses at once.',
  visual: { preset: 'beam', color: 0x56bfff, size: 8, speed: 1.4 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const smouldering = blueflareOf(foe) > 0;
    hit(ctx, foe, '1d4', 'water', 'Scalding Memory');
    if (!foe.alive) return;
    applyBlueflareStacks(ctx, foe, 2);
    shove(ctx, foe, ctx.caster.pos, 2);
    forgetTokens(ctx, foe, lastDeeds(foe), 2);
    if (smouldering && foe.alive) ctx.game.pulseBlueflare(foe);
  },
});

registerSpell({
  name: 'Static Tide',
  words: ['water', 'mind', 'lightning'],
  actionType: 'main',
  range: 0,
  targeting: 'self',
  dc: 13,
  aoe: { kind: 'circle', radius: R(5) },
  description:
    'Every enemy within a third of the Lightning power in cm of you (at least 3cm) gains 1 Mindconduct stack, takes ' +
    '1d3 sanity, 50% more for every stack after the first, and is pushed 2cm away from you.',
  visual: { preset: 'nova', color: 0x79bfff, size: R(5), speed: 1.4 },
  cast(ctx) {
    const power = castPower(ctx);
    for (const foe of foesAround(ctx, ctx.caster.pos, R(Math.max(3, power / 3)))) {
      void ctx.vfx?.lightningBolt?.(ctx.caster.pos, foe.pos);
      const stacks = applyMindLightningStack(foe);
      const amount = Math.ceil(mindLightningDamage(rollDice(ctx, '1d3', 'Static Tide', foe), stacks));
      dealDamage(ctx, foe, dmg(amount, 'sanity'), { canMiss: false, aoe: true });
      shove(ctx, foe, ctx.caster.pos, 2);
    }
  },
});

registerSpell({
  name: 'Storm Call',
  words: ['water', 'fire', 'lightning'],
  actionType: 'main',
  range: R(15),
  targeting: 'point',
  dc: 14,
  aoe: { kind: 'circle', radius: R(2) },
  description:
    'Lightning strikes a point within 15cm: every unit within 2cm of it, allies and you included, takes 2d6 heat plus ' +
    '1 per 5 Lightning power and gains 1 Fire. The thunderclap then throws every unit within 4cm 3cm straight out ' +
    'from the strike.',
  visual: { preset: 'nova', color: STORM, size: R(4), speed: 1.6 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const power = castPower(ctx);
    void ctx.vfx?.lightningBolt?.({ x: at.x, y: at.y - R(5) }, at);
    const struck = everyoneAround(ctx, at, R(2));
    strikeAll(ctx, struck, [[plus('2d6', Math.floor(power / 5)), 'heat']], 'Storm Call');
    for (const m of struck) if (m.alive) applyFireStacks(ctx, m, 1);
    for (const m of everyoneAround(ctx, at, R(4))) shove(ctx, m, at, 3);
  },
});

// =============================================================================
//  THE GOD WORDS   (Reality and Stop are blue: they take Water, never Pain)
// =============================================================================

registerSpell({
  name: 'Tide Turn',
  words: ['water', 'reality'],
  actionType: 'main',
  range: Infinity,
  targeting: 'point',
  dc: 13,
  noCastSprite: true,
  description:
    'Choose a direction with a point anywhere: every enemy on the field is swept 4cm that way. Any slammed into a wall ' +
    'or the field edge takes the slam.',
  visual: { preset: 'nova', color: WATER_COLOR, size: 120, speed: 0.8 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const dir = { x: at.x - ctx.caster.x, y: at.y - ctx.caster.y };
    if (Math.hypot(dir.x, dir.y) < 1) return;
    ctx.vfx?.godFx?.('warp', midway(ctx), { size: R(10), color: WATER_COLOR });
    for (const foe of foesAround(ctx, ctx.caster.pos, FIELD_DIAGONAL)) shoveAlong(ctx, foe, dir, 4);
  },
});

registerSpell({
  name: 'Floodgate',
  words: ['water', 'stop'],
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 13,
  reaction: true,
  counters: true,
  description:
    'One enemy within 20cm takes 1d6 water and is pushed 5cm away from you. As a reaction, also cancel the answered ' +
    'action; its source is struck instead.',
  visual: { preset: 'beam', color: 0x9ee7ff, size: 8, speed: 1.6 },
  cast(ctx) {
    const foe = answeredOrTarget(ctx);
    if (!foe) return;
    ctx.vfx?.godFx?.('sphere', foe.pos, { size: foe.bodyRadius() * 4, color: WATER_COLOR });
    hit(ctx, foe, '1d6', 'water', 'Floodgate', { canMiss: false });
    shove(ctx, foe, ctx.caster.pos, 5);
  },
});

registerSpell({
  name: 'Sea Lift',
  words: ['water', 'reality', 'bind'],
  set: 'finns',
  actionType: 'main',
  range: Infinity,
  targeting: 'any',
  dc: 15,
  description:
    'Lift any unit anywhere and set it down up to 10cm from where it stands. An enemy then takes 2d6 water and is ' +
    'rooted for 2 turns.',
  visual: { preset: 'burst', color: WATER_COLOR, size: 60, speed: 1 },
  async cast(ctx) {
    const unit = ctx.target;
    if (!unit?.alive) return;
    const hostile = unit.team !== ctx.caster.team;
    const aim = hostile ? stepTowards(unit.pos, nearestEdgePoint(unit.pos), R(10)) : awayFromFoes(ctx, unit, 10);
    const to =
      (await ctx.requestPoint?.({ maxRange: R(10), origin: unit.pos, prompt: `Water Reality Bind: set ${unit.name} down where?`, aiPoint: aim })) ??
      aim;
    ctx.vfx?.godFx?.('warp', unit.pos, { size: unit.bodyRadius() * 6, color: WATER_COLOR });
    relocate(ctx, unit, to);
    if (!hostile) return;
    hit(ctx, unit, '2d6', 'water', 'Sea Lift', { canMiss: false });
    root(ctx, unit, 2);
  },
});

registerSpell({
  name: 'Moonpool',
  words: ['water', 'reality', 'veil'],
  set: 'finns',
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 15,
  description: 'You and every ally are each carried up to 4cm to a point you choose, then gain a half veil for 2 turns.',
  visual: { preset: 'nova', color: WATER_COLOR, size: 100, speed: 0.9 },
  async cast(ctx) {
    const friends = everyoneAround(ctx, ctx.caster.pos, FIELD_DIAGONAL).filter((m) => m.team === ctx.caster.team);
    ctx.vfx?.godFx?.('rift', ctx.caster.pos, { size: R(6), color: WATER_COLOR });
    for (const friend of friends) {
      const away = awayFromFoes(ctx, friend, 4);
      const to = await ctx.requestPoint?.({
        maxRange: R(4),
        origin: friend.pos,
        prompt: `Water Reality Veil: carry ${friend.name} where? (Esc keeps it)`,
        aiPoint: away,
      });
      if (to) carry(ctx, friend, to, 4);
      if (friend.alive) applyInvisibility(ctx, friend, { duration: 2, mode: 'partial' });
    }
  },
});

registerSpell({
  name: 'Sea of Minds',
  words: ['water', 'reality', 'mind'],
  set: 'finns',
  actionType: 'main',
  range: Infinity,
  targeting: 'enemy',
  dc: 15,
  description:
    'One enemy anywhere trades places with another enemy you choose anywhere. Each takes 1d6 sanity and forgets one ' +
    'random word until the end of its next turn.',
  visual: { preset: 'beam', color: 0x8fb4ff, size: 7, speed: 1 },
  async cast(ctx) {
    const first = ctx.target;
    if (!first) return;
    const candidates = foesAround(ctx, ctx.caster.pos, FIELD_DIAGONAL).filter((m) => m !== first);
    const second =
      candidates.length > 0
        ? await ctx.requestCombatant?.({ candidates, range: FIELD_DIAGONAL, origin: first.pos, prompt: 'Water Reality Mind: who trades places with it?' })
        : null;
    ctx.vfx?.godFx?.('warp', first.pos, { size: first.bodyRadius() * 6, color: 0x8fb4ff });
    if (second) swapPlaces(ctx, first, second);
    for (const foe of second ? [first, second] : [first]) {
      hit(ctx, foe, '1d6', 'sanity', 'Sea of Minds', { canMiss: false });
      forgetTokens(ctx, foe, randomWords(ctx, foe, 1), 2);
    }
  },
});

registerSpell({
  name: 'Tidal Wave',
  words: ['water', 'reality', 'shatter'],
  set: 'finns',
  actionType: 'main',
  range: Infinity,
  targeting: 'point',
  dc: 15,
  aoe: { kind: 'cone', radius: 1400, degrees: 90 },
  noCastSprite: true,
  description:
    'A 90° wave rolls from you to the field edge. Every enemy in it takes 2d6 water and 1d6 shatter and is thrown 4cm ' +
    'away from you.',
  visual: { preset: 'burst', color: WATER_COLOR, size: 90, speed: 1 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    ctx.vfx?.godFx?.('cataclysm', midway(ctx), {
      size: R(12),
      color: WATER_COLOR,
      angle: Math.atan2(at.y - ctx.caster.y, at.x - ctx.caster.x),
    });
    const foes = foesInCone(ctx, at, FIELD_DIAGONAL, 90);
    strikeAll(ctx, foes, [['2d6', 'water'], ['1d6', 'shatter']], 'Tidal Wave');
    for (const foe of foes) shove(ctx, foe, ctx.caster.pos, 4);
  },
});

registerSpell({
  name: 'Abyssal Jet',
  words: ['water', 'reality', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: Infinity,
  targeting: 'enemy',
  ignoresStealth: true,
  dc: 15,
  description:
    'A jet strikes one enemy anywhere, ignoring concealment: 2d6 pierce and 2d6 water that cannot miss, and it is ' +
    'pushed 6cm away from you.',
  visual: { preset: 'beam', color: WATER_COLOR, size: 9, speed: 2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    ctx.vfx?.godFx?.('void', foe.pos, { size: foe.bodyRadius() * 5, color: WATER_COLOR });
    hit(ctx, foe, '2d6', 'pierce', 'Abyssal Jet', { canMiss: false });
    hit(ctx, foe, '2d6', 'water', 'Abyssal Jet', { canMiss: false });
    shove(ctx, foe, ctx.caster.pos, 6);
  },
});

registerSpell({
  name: 'Still Tide',
  words: ['water', 'reality', 'stop'],
  set: 'finns',
  actionType: 'main',
  range: Infinity,
  targeting: 'enemy',
  dc: 16,
  reaction: true,
  counters: true,
  description:
    'Carry one enemy anywhere 6cm away from you, then stop time for it for 1 turn: it skips that turn, and every hit ' +
    'it takes is held until time resumes. As a reaction, also cancel the answered action; its source is carried and ' +
    'stopped instead.',
  visual: { preset: 'burst', color: 0x9ee7ff, size: 60, speed: 0.8 },
  cast(ctx) {
    const foe = answeredOrTarget(ctx);
    if (!foe) return;
    shove(ctx, foe, ctx.caster.pos, 6);
    if (ctx.game.stopTime(ctx.caster, foe, { turns: 1 })) {
      ctx.vfx?.godFx?.('sphere', foe.pos, { size: foe.bodyRadius() * 6, color: WATER_COLOR });
    }
  },
});

registerSpell({
  name: 'Floodlock',
  words: ['water', 'stop', 'bind'],
  set: 'finns',
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 15,
  reaction: true,
  counters: true,
  description:
    'Drag one enemy within 20cm up to 5cm toward you and root it for 2 turns. As a reaction, also cancel the answered ' +
    'action; its source is dragged and rooted instead.',
  visual: { preset: 'beam', color: 0x9ee7ff, size: 7, speed: 1.4 },
  cast(ctx) {
    const foe = answeredOrTarget(ctx);
    if (!foe) return;
    ctx.vfx?.godFx?.('sphere', foe.pos, { size: foe.bodyRadius() * 4, color: WATER_COLOR });
    drag(ctx, foe, ctx.caster.pos, 5);
    root(ctx, foe, 2);
  },
});

registerSpell({
  name: 'Wave Guard',
  words: ['water', 'stop', 'veil'],
  set: 'finns',
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 15,
  reaction: true,
  counters: true,
  description:
    'You and every ally within 4cm of you are carried 3cm away from the nearest enemy and gain a half veil until your ' +
    'next turn. As a reaction, also cancel the answered action, and everyone is carried away from its source.',
  visual: { preset: 'nova', color: 0x9ee7ff, size: R(4), speed: 1.4 },
  cast(ctx) {
    const threat =
      ctx.game.counteredItem?.source ??
      ctx.game.mages
        .filter((m) => m.alive && m.team !== ctx.caster.team)
        .sort((a, b) => dist(a.pos, ctx.caster.pos) - dist(b.pos, ctx.caster.pos))[0];
    ctx.vfx?.godFx?.('sphere', ctx.caster.pos, { size: R(4) * 2, color: WATER_COLOR });
    const friends = everyoneAround(ctx, ctx.caster.pos, R(4)).filter((m) => m.team === ctx.caster.team);
    for (const friend of friends) {
      if (threat && dist(threat.pos, friend.pos) > 0.5 && !ctx.game.isImmovable(friend)) {
        dash(ctx, friend, { direction: { x: friend.x - threat.x, y: friend.y - threat.y }, distance: R(3) });
      }
      if (friend.alive) applyInvisibility(ctx, friend, { duration: 1, mode: 'partial' });
    }
  },
});

registerSpell({
  name: 'Second Thoughts',
  words: ['water', 'stop', 'mind'],
  set: 'finns',
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 15,
  reaction: true,
  counters: true,
  description:
    'One enemy within 20cm takes 1d6 sanity, is pushed 3cm away and forgets whatever it did last until the end of its ' +
    'next turn. As a reaction, also cancel the answered action: its source forgets every word of it for 2 turns.',
  visual: { preset: 'beam', color: 0xb8c8ff, size: 6, speed: 1.2 },
  cast(ctx) {
    const answered = ctx.game.counteredItem;
    const foe = answeredOrTarget(ctx);
    if (!foe) return;
    ctx.vfx?.godFx?.('sphere', foe.pos, { size: foe.bodyRadius() * 4, color: 0xb8c8ff });
    hit(ctx, foe, '1d6', 'sanity', 'Second Thoughts', { canMiss: false });
    shove(ctx, foe, ctx.caster.pos, 3);
    forgetTokens(ctx, foe, deedsToForget(answered, foe), answered ? 3 : 2);
  },
});

registerSpell({
  name: 'Breaking Wave',
  words: ['water', 'stop', 'shatter'],
  set: 'finns',
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 15,
  reaction: true,
  counters: true,
  description:
    'One enemy within 20cm and every enemy within 2cm of it take 2d6 water and are thrown 4cm away from you. As a ' +
    'reaction, also cancel the answered action; the wave breaks on its source.',
  visual: { preset: 'burst', color: 0x9ee7ff, size: R(2), speed: 1.3 },
  cast(ctx) {
    const foe = answeredOrTarget(ctx);
    if (!foe) return;
    ctx.vfx?.godFx?.('cataclysm', foe.pos, { size: R(4), color: WATER_COLOR });
    const caught = [foe, ...foesAround(ctx, foe.pos, R(2)).filter((m) => m !== foe)];
    strikeAll(ctx, caught, [['2d6', 'water']], 'Breaking Wave');
    for (const m of caught) shove(ctx, m, ctx.caster.pos, 4);
  },
});

registerSpell({
  name: 'Rebuke Jet',
  words: ['water', 'stop', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 15,
  reaction: true,
  counters: true,
  description:
    'A jet hits one enemy within 20cm for 1d6 pierce and 1d6 water and pushes it 1cm away for every 3cm between you, ' +
    'at most 6cm. As a reaction, also cancel the answered action; the jet hits its source.',
  visual: { preset: 'beam', color: 0x9ee7ff, size: 6, speed: 2 },
  cast(ctx) {
    const foe = answeredOrTarget(ctx);
    if (!foe) return;
    const push = jetPush(ctx, foe);
    ctx.vfx?.godFx?.('sphere', foe.pos, { size: foe.bodyRadius() * 4, color: WATER_COLOR });
    hit(ctx, foe, '1d6', 'pierce', 'Rebuke Jet', { canMiss: false });
    hit(ctx, foe, '1d6', 'water', 'Rebuke Jet', { canMiss: false });
    shove(ctx, foe, ctx.caster.pos, push);
  },
});
