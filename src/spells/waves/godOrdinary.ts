// =============================================================================
//  THE GOD WORDS · ORDINARY SPELLS
// -----------------------------------------------------------------------------
//  The pairs the god waves skipped, and the plain versions of the Stop and
//  Desecrate class combos (what a modifier casts). Death reaps and executes,
//  Desecrate fouls the ground and spares black and minion units, Reality
//  reaches anywhere and ignores what stands in the way, and Stop answers: as a
//  reaction it cancels what it answers. Beside blue it disrupts; beside
//  colourless words it hurts.
// =============================================================================

import { dmg } from '../../core/Damage';
import type { Mage } from '../../core/Mage';
import { addOrExtendStatus } from '../../core/Status';
import { dist, type Vec2 } from '../../core/utils';
import { applyStifle } from '../../effects/classKit';
import {
  afflictDuration,
  applyInvisibility,
  dash,
  desecrateGround,
  placeShadow,
  rollDice,
  type EffectContext,
} from '../../effects/effects';
import { registerSpell } from '../registry';
import {
  awayFromFoes,
  curseWith,
  deedsToForget,
  drag,
  FIELD_DIAGONAL,
  foesAround,
  forgetTokens,
  hit,
  R,
  relocate,
  root,
  shove,
  strikeAll,
  swapPlaces,
} from './waterKit';

const BONE = 0xb9c0cc;
const UNHALLOWED = 0x4d3d6e;
const REALITY = 0xff5599;
const STOP = 0x9ee7ff;
const GLASS = 0xd8f0ff;

/** The answered action's source when cast as a reaction, else the chosen target. */
function answeredOrTarget(ctx: EffectContext): Mage | null {
  const foe = ctx.game.counteredItem?.source ?? ctx.target;
  return foe?.alive ? foe : null;
}

/** It cannot react for `turns` turns. */
function numb(ctx: EffectContext, m: Mage, turns: number): void {
  if (!m.alive || m.isDebuffImmune()) return;
  addOrExtendStatus(
    m.statuses,
    { key: 'reflexStop', name: 'Frozen Reflexes', kind: 'reflexStop', duration: afflictDuration(ctx, m, turns) },
    false
  );
}

/** A quarter turn around `pivot`; a wall or the field edge stopping it slams for 2d6 shatter. Returns whether it slammed. */
function turn(ctx: EffectContext, m: Mage, pivot: Vec2): boolean {
  if (!m.alive || ctx.game.isUnreachable(m)) return false;
  const { slammed } = ctx.game.orbitAround(m, pivot, ctx.rng.chance(0.5));
  if (slammed) hit(ctx, m, '2d6', 'shatter', 'Slam', { canMiss: false });
  return slammed;
}

/** Reap on `m`, then an execution. */
function harvest(ctx: EffectContext, m: Mage, reap: number, execute: number): void {
  if (m.alive && reap > 0) ctx.game.applyReap(m, reap, ctx.caster);
  if (m.alive && execute > 0) ctx.game.executeTarget(ctx.caster, m, execute);
}

// ---- Death ------------------------------------------------------------------

registerSpell({
  name: 'Killing Thrust',
  words: ['death', 'pierce'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 12,
  description:
    'Dash up to 6cm toward one enemy within 12cm and run it through: 2d6 pierce that cannot miss. It gains 1 Reap for ' +
    'every 3 pierce dealt, then it is executed for 2.',
  visual: { preset: 'beam', color: 0xd9dde8, size: 6, speed: 1.8 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    if (dist(ctx.caster.pos, foe.pos) > R(1)) dash(ctx, ctx.caster, { toPoint: foe.pos, distance: R(6) });
    ctx.vfx?.godFx?.('reap', foe.pos, { size: R(4), angle: Math.atan2(foe.y - ctx.caster.y, foe.x - ctx.caster.x) });
    const dealt = hit(ctx, foe, '2d6', 'pierce', 'Killing Thrust', { canMiss: false });
    harvest(ctx, foe, Math.floor(dealt / 3), 2);
  },
});

registerSpell({
  name: 'Bonebreaker',
  words: ['death', 'shatter'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 12,
  description:
    'One enemy within 10cm takes 1d6 shatter, gains 1d4 Reap and is thrown 3cm away from you. If a wall or the field ' +
    'edge stops it, it is executed for 5; otherwise for 1.',
  visual: { preset: 'conjure', color: BONE, size: 36, speed: 1.2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    ctx.vfx?.godFx?.('skull', foe.pos, { size: foe.bodyRadius() * 4 });
    hit(ctx, foe, '1d6', 'shatter', 'Bonebreaker');
    if (!foe.alive) return;
    ctx.game.applyReap(foe, rollDice(ctx, '1d4', 'Bonebreaker — Reap', foe), ctx.caster);
    const slammed = shove(ctx, foe, ctx.caster.pos, 3);
    if (foe.alive) ctx.game.executeTarget(ctx.caster, foe, slammed ? 5 : 1);
  },
});

// ---- Desecrate --------------------------------------------------------------

registerSpell({
  name: 'Shadowed Ground',
  words: ['desecrate', 'shadow'],
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 12,
  aoe: { kind: 'circle', radius: R(5) },
  noCastSprite: true,
  description:
    'Foul a 5cm circle within 12cm for 4 turns. Affected units inside take 1d6 shadow at the start of their turns and ' +
    'cannot be healed. A shadow opens at its centre for 4 turns. Black and minion units are spared.',
  visual: { preset: 'burst', color: UNHALLOWED, size: R(5), speed: 0.8 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    ctx.vfx?.godFx?.('void', at, { size: R(5) * 2, color: UNHALLOWED });
    desecrateGround(ctx, at, {
      name: 'Shadowed Ground',
      radius: R(5),
      turns: 4,
      blocksHealing: true,
      ticks: [{ spec: '1d6', type: 'shadow' }],
    });
    placeShadow(ctx, at, 4);
  },
});

// ---- Reality ----------------------------------------------------------------

registerSpell({
  name: 'Gravity Well',
  words: ['reality', 'bind'],
  actionType: 'main',
  range: Infinity,
  targeting: 'point',
  dc: 13,
  noCastSprite: true,
  description:
    'Bend space toward a point anywhere: every enemy on the field is dragged up to 3cm toward it. Those within 4cm of ' +
    'it are rooted for 1 turn.',
  visual: { preset: 'nova', color: REALITY, size: R(4), speed: 0.8 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    ctx.vfx?.godFx?.('implode', at, { size: R(8), color: REALITY });
    for (const foe of foesAround(ctx, ctx.caster.pos, FIELD_DIAGONAL)) {
      drag(ctx, foe, at, 3);
      if (foe.alive && dist(foe.pos, at) <= R(4) + foe.bodyRadius()) root(ctx, foe, 1);
    }
  },
});

registerSpell({
  name: 'Elsewhere',
  words: ['reality', 'veil'],
  actionType: 'bonus',
  range: R(12),
  targeting: 'point',
  dc: 12,
  noCastSprite: true,
  description:
    'Step through reality to a point within 12cm (walls and bodies do not stop you) and vanish into a ' +
    'full veil until your next turn.',
  visual: { preset: 'nova', color: 0xff88cc, size: 40, speed: 1.2 },
  cast(ctx) {
    const at = ctx.targetPoint ?? awayFromFoes(ctx, ctx.caster, 6);
    ctx.vfx?.godFx?.('rift', ctx.caster.pos, { size: ctx.caster.bodyRadius() * 5, color: 0xff88cc });
    relocate(ctx, ctx.caster, at);
    applyInvisibility(ctx, ctx.caster, { duration: 1, mode: 'full' });
  },
});

registerSpell({
  name: 'Needle Through the World',
  words: ['reality', 'pierce'],
  actionType: 'main',
  range: Infinity,
  targeting: 'enemy',
  ignoresStealth: true,
  dc: 13,
  description: 'One enemy anywhere on the field, even a concealed one, takes 2d6 pierce that cannot miss.',
  visual: { preset: 'beam', color: REALITY, size: 4, speed: 2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    ctx.vfx?.godFx?.('rift', foe.pos, { size: foe.bodyRadius() * 4, color: REALITY });
    hit(ctx, foe, '2d6', 'pierce', 'Needle Through the World', { canMiss: false });
  },
});

// ---- Stop -------------------------------------------------------------------

registerSpell({
  name: 'Frozen Thought',
  words: ['mind', 'stop'],
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 13,
  reaction: true,
  counters: true,
  description:
    'One enemy within 20cm takes 1d6 sanity and cannot react for 2 turns. As a reaction, also cancel the answered ' +
    'action: its source forgets every word of it for 2 turns.',
  visual: { preset: 'beam', color: 0xc8b8ff, size: 6, speed: 1.4 },
  cast(ctx) {
    const answered = ctx.game.counteredItem;
    const foe = answeredOrTarget(ctx);
    if (!foe) return;
    ctx.vfx?.godFx?.('sphere', foe.pos, { size: foe.bodyRadius() * 4, color: STOP });
    hit(ctx, foe, '1d6', 'sanity', 'Frozen Thought', { canMiss: false });
    if (!foe.alive) return;
    numb(ctx, foe, 2);
    if (answered) forgetTokens(ctx, foe, deedsToForget(answered, foe), 2);
  },
});

registerSpell({
  name: 'Pause',
  words: ['reality', 'stop'],
  actionType: 'main',
  range: Infinity,
  targeting: 'enemy',
  dc: 14,
  reaction: true,
  counters: true,
  description:
    'Stop time for one enemy anywhere for 1 turn: it skips that turn, and every hit it takes is held until time ' +
    'resumes. As a reaction, also cancel the answered action; its source is stopped instead.',
  visual: { preset: 'burst', color: STOP, size: 50, speed: 0.8 },
  cast(ctx) {
    const foe = answeredOrTarget(ctx);
    if (!foe) return;
    if (ctx.game.stopTime(ctx.caster, foe, { turns: 1 })) {
      ctx.vfx?.godFx?.('sphere', foe.pos, { size: foe.bodyRadius() * 6, color: STOP });
    }
  },
});

// ---- Stop: the plain versions of its class combos ---------------------------

registerSpell({
  name: 'Unseen Halt',
  words: ['stop', 'veil'],
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 12,
  reaction: true,
  counters: true,
  description:
    "One enemy within 20cm: its next action other than moving fails. You vanish into a full veil until your next " +
    'turn. As a reaction, also cancel the answered action; its source is stifled instead.',
  visual: { preset: 'beam', color: STOP, size: 5, speed: 1.6 },
  cast(ctx) {
    const foe = answeredOrTarget(ctx);
    if (foe) {
      ctx.vfx?.godFx?.('sphere', foe.pos, { size: foe.bodyRadius() * 4, color: STOP });
      applyStifle(ctx, foe);
    }
    applyInvisibility(ctx, ctx.caster, { duration: 1, mode: 'full' });
  },
});

registerSpell({
  name: 'Halt',
  words: ['stop', 'bind'],
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 12,
  reaction: true,
  counters: true,
  description:
    'One enemy within 20cm is rooted for 2 turns and cannot react until its next turn. As a reaction, also cancel the ' +
    'answered action; its source is held instead.',
  visual: { preset: 'beam', color: STOP, size: 7, speed: 1.4 },
  cast(ctx) {
    const foe = answeredOrTarget(ctx);
    if (!foe) return;
    ctx.vfx?.godFx?.('sphere', foe.pos, { size: foe.bodyRadius() * 4, color: STOP });
    root(ctx, foe, 2);
    numb(ctx, foe, 1);
  },
});

registerSpell({
  name: 'Held Wound',
  words: ['stop', 'pierce'],
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 12,
  reaction: true,
  counters: true,
  description:
    'One enemy within 20cm takes 1d6 pierce that cannot miss, and the wound is held in time: it lands again, whole, ' +
    'at the start of its next turn. As a reaction, also cancel the answered action; its source is struck instead.',
  visual: { preset: 'beam', color: 0xa8e0ff, size: 4, speed: 1.9 },
  cast(ctx) {
    const foe = answeredOrTarget(ctx);
    if (!foe) return;
    ctx.vfx?.godFx?.('sphere', foe.pos, { size: foe.bodyRadius() * 4, color: 0xa8e0ff });
    const dealt = hit(ctx, foe, '1d6', 'pierce', 'Held Wound', { canMiss: false });
    if (dealt > 0) curseWith(ctx, foe, 'Held Wound', 'pierce', 1, { damage: dmg(dealt, 'pierce') });
  },
});

registerSpell({
  name: 'Dead Stop',
  words: ['stop', 'shatter'],
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 12,
  reaction: true,
  counters: true,
  description:
    'One enemy within 20cm stops dead: 1d6 shatter, plus 1d6 for every 2cm between where it stands and where its ' +
    'latest turn began (up to 5d6 in all). As a reaction, also cancel the answered action; its source stops instead.',
  visual: { preset: 'burst', color: GLASS, size: 40, speed: 1.5 },
  cast(ctx) {
    const foe = answeredOrTarget(ctx);
    if (!foe) return;
    const start = foe.turnStartState;
    const momentum = start ? Math.min(4, Math.floor(dist(start, foe.pos) / R(2))) : 0;
    ctx.vfx?.godFx?.('cataclysm', foe.pos, { size: foe.bodyRadius() * 4, color: GLASS });
    hit(ctx, foe, `${1 + momentum}d6`, 'shatter', 'Dead Stop', { canMiss: false });
  },
});

registerSpell({
  name: 'Reversal',
  words: ['stop', 'twist'],
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 12,
  reaction: true,
  counters: true,
  description:
    'One enemy within 20cm is turned a quarter circle around you (2d6 shatter if a wall or the field edge stops it), ' +
    'and its next action other than moving fails. As a reaction, also cancel the answered action; its source is ' +
    'turned instead.',
  visual: { preset: 'beam', color: 0x7ee7d8, size: 5, speed: 1.4 },
  cast(ctx) {
    const foe = answeredOrTarget(ctx);
    if (!foe) return;
    ctx.vfx?.godFx?.('warp', foe.pos, { size: foe.bodyRadius() * 4, color: STOP });
    turn(ctx, foe, ctx.caster.pos);
    applyStifle(ctx, foe);
  },
});

registerSpell({
  name: 'Turnabout',
  words: ['stop', 'veil', 'twist'],
  set: 'finns',
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 14,
  reaction: true,
  counters: true,
  description:
    'Trade places with one enemy within 12cm; its next action other than moving fails, and you slip into a half veil ' +
    'until your next turn. As a reaction, also cancel the answered action; you trade places with its source.',
  visual: { preset: 'beam', color: 0x9ed8e7, size: 6, speed: 1.3 },
  cast(ctx) {
    const foe = answeredOrTarget(ctx);
    if (!foe) return;
    ctx.vfx?.godFx?.('warp', foe.pos, { size: foe.bodyRadius() * 5, color: STOP });
    swapPlaces(ctx, ctx.caster, foe);
    applyStifle(ctx, foe);
    applyInvisibility(ctx, ctx.caster, { duration: 1, mode: 'partial' });
  },
});

registerSpell({
  name: 'Wound Clock',
  words: ['stop', 'bind', 'twist'],
  set: 'finns',
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 14,
  reaction: true,
  counters: true,
  description:
    'One enemy within 15cm is turned a quarter circle around you and rooted for 2 turns. If a wall or the field edge ' +
    'stops it, it takes 2d6 shatter and is frozen in time for its next turn. As a reaction, also cancel the answered ' +
    'action; its source is wound instead.',
  visual: { preset: 'beam', color: STOP, size: 7, speed: 1.2 },
  cast(ctx) {
    const foe = answeredOrTarget(ctx);
    if (!foe) return;
    ctx.vfx?.godFx?.('warp', foe.pos, { size: foe.bodyRadius() * 5, color: STOP });
    const slammed = turn(ctx, foe, ctx.caster.pos);
    root(ctx, foe, 2);
    if (slammed && foe.alive && ctx.game.stopTime(ctx.caster, foe, { turns: 1 })) {
      ctx.vfx?.godFx?.('sphere', foe.pos, { size: foe.bodyRadius() * 5, color: STOP });
    }
  },
});

registerSpell({
  name: 'Clockhand Thrust',
  words: ['stop', 'pierce', 'twist'],
  set: 'finns',
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 14,
  reaction: true,
  counters: true,
  description:
    'One enemy within 15cm takes 2d6 pierce that cannot miss, is turned a quarter circle around you (2d6 shatter if ' +
    'a wall or the field edge stops it) and cannot react for 2 turns. As a reaction, also cancel the answered action; ' +
    'its source is struck instead.',
  visual: { preset: 'beam', color: 0xa8e0ff, size: 5, speed: 1.9 },
  cast(ctx) {
    const foe = answeredOrTarget(ctx);
    if (!foe) return;
    ctx.vfx?.godFx?.('reap', foe.pos, { size: R(4), angle: Math.atan2(foe.y - ctx.caster.y, foe.x - ctx.caster.x), color: STOP });
    hit(ctx, foe, '2d6', 'pierce', 'Clockhand Thrust', { canMiss: false });
    turn(ctx, foe, ctx.caster.pos);
    numb(ctx, foe, 2);
  },
});

registerSpell({
  name: 'Shattered Hour',
  words: ['stop', 'shatter', 'twist'],
  set: 'finns',
  actionType: 'main',
  range: R(15),
  targeting: 'point',
  dc: 14,
  aoe: { kind: 'circle', radius: R(4) },
  reaction: true,
  counters: true,
  noCastSprite: true,
  description:
    'The hour breaks at a point within 15cm: every enemy within 4cm takes 2d6 shatter and is turned a quarter circle ' +
    'around it (2d6 shatter more if a wall or the field edge stops it); any slammed so loses its next action other ' +
    'than moving. As a reaction, also cancel the answered action; the hour breaks on its source.',
  visual: { preset: 'nova', color: GLASS, size: R(4), speed: 1.2 },
  cast(ctx) {
    const at = ctx.game.counteredItem?.source.pos ?? ctx.targetPoint;
    if (!at) return;
    const centre = { x: at.x, y: at.y };
    ctx.vfx?.godFx?.('cataclysm', centre, { size: R(8), color: GLASS });
    const caught = foesAround(ctx, centre, R(4));
    strikeAll(ctx, caught, [['2d6', 'shatter']], 'Shattered Hour');
    for (const m of caught) if (turn(ctx, m, centre) && m.alive) applyStifle(ctx, m);
  },
});

// ---- Desecrate: the plain version of its class combo ------------------------

registerSpell({
  name: 'Grave Quake',
  words: ['shatter', 'desecrate'],
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 12,
  aoe: { kind: 'circle', radius: R(4) },
  noCastSprite: true,
  description:
    'The ground cracks at a point within 12cm: enemies within 3cm take 2d6 shatter. The ground within 4cm is fouled ' +
    'for 3 turns: affected units inside take 1d4 shatter at the start of their turns and cannot be healed. Black and ' +
    'minion units are spared by the ground.',
  visual: { preset: 'burst', color: 0x8a7a6e, size: R(4), speed: 1 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    ctx.vfx?.godFx?.('cataclysm', at, { size: R(6), color: UNHALLOWED });
    strikeAll(ctx, foesAround(ctx, at, R(3)), [['2d6', 'shatter']], 'Grave Quake');
    desecrateGround(ctx, at, {
      name: 'Grave Quake',
      radius: R(4),
      turns: 3,
      blocksHealing: true,
      ticks: [{ spec: '1d4', type: 'shatter' }],
    });
  },
});
