// =============================================================================
//  SPELLS
// -----------------------------------------------------------------------------
//  Every regular spell combination is preset below. A spell maps a combination
//  of words to:
//    - actionType : 'main' | 'bonus'
//    - range      : pixels = abstract range × RANGE_UNIT (5 poor / 10 avg / 15 good)
//    - targeting  : 'none' | 'self' | 'enemy' | 'ally' | 'point'
//    - dc         : roll 1d20 on resolution; below dc the spell fizzles
//    - aoe        : optional cone / circle footprint (drives the targeting preview)
//    - reaction   : may it be cast outside your turn?
//    - counters   : does it remove the action it responds to?
//    - visual     : a preset animation with your own colour / size / speed
//    - cast(ctx)  : the effect, built from the helpers in effects/effects.ts
//
//  Combinations may also have optional class-specific overrides in classSpells.
// =============================================================================

import { dmg } from '../core/Damage';
import { addOrExtendStatus } from '../core/Status';
import { CONE_DEGREES, FIELD, MOVE_RANGE, RANGE_UNIT, SHADOW_RADIUS } from '../config/constants';
import {
  applyAuraDot,
  applyAnchorSpike,
  applyBlueflareStacks,
  applyControl,
  applyDebuff,
  applyDot,
  applyFireStacks,
  applyForget,
  applyInvisibility,
  applyOrderJudgment,
  applyPierceEcho,
  applySeal,
  applyShadowTrail,
  applyShadowVeil,
  applyStackingDot,
  applyStormConduit,
  applyStun,
  applyWard,
  areaDamage,
  blinkstep,
  coneDamage,
  critScale,
  dash,
  dealDamage,
  dispelVeil,
  drainDamage,
  grantExtraTurn,
  heal,
  placeHazardZone,
  placeRealityWedge,
  placeShadow,
  placeTotem,
  placeWall,
  rollDice,
  summonScarabs,
  swapMinds,
  teleport,
  twistStrike,
} from '../effects/effects';
import { registerSpell } from './registry';
import type { Mage } from '../core/Mage';
import type { EffectContext } from '../effects/effects';
import type { DotStatus } from '../core/Status';
import type { Vec2 } from '../core/utils';

/** Convert an abstract range number (5 / 10 / 15) to pixels. */
const R = (units: number): number => units * RANGE_UNIT;

/** Nearest living enemy of the caster within `radius` of `at`, if any. */
function enemyNear(ctx: EffectContext, at: { x: number; y: number }, radius: number): Mage | null {
  const foes = ctx.game
    .magesInRadius(at, radius, ctx.caster)
    .filter((m) => m.team !== ctx.caster.team);
  if (foes.length === 0) return null;
  foes.sort((a, b) => {
    const da = (a.x - at.x) ** 2 + (a.y - at.y) ** 2;
    const db = (b.x - at.x) ** 2 + (b.y - at.y) ** 2;
    return da - db;
  });
  return foes[0];
}

interface TrailSegment {
  from: Vec2;
  to: Vec2;
}

const RED_TRAIL_COLOR = 0xff4c15;

/** Sweep a blade arc down the axis of a cone aimed at `toward`. */
function slashCone(ctx: EffectContext, toward: Vec2, range: number): void {
  const angle = Math.atan2(toward.y - ctx.caster.y, toward.x - ctx.caster.x);
  ctx.vfx?.slash?.(
    {
      x: ctx.caster.x + Math.cos(angle) * range * 0.5,
      y: ctx.caster.y + Math.sin(angle) * range * 0.5,
    },
    angle,
    range * 1.7
  );
}

/** Kept d20 plus the modifiers represented by assigned INT and remaining Luck. */
function lightningPower(ctx: EffectContext): number {
  const natural = ctx.spellRoll ?? 1;
  const intellect = Math.max(0, ctx.caster.statInt - 1);
  const luck = Math.max(0, ctx.caster.luck - 1);
  const power = natural + intellect + luck;
  ctx.log(`Lightning power: ${natural} + ${intellect} INT + ${luck} Luck = ${power}.`);
  return power;
}

type LightningGamble = 'overload' | 'unstable' | 'stable' | 'surge';

function lightningGamble(ctx: EffectContext): LightningGamble {
  const roll = rollDice(ctx, '1d6', 'Lightning gamble', ctx.caster);
  const result: LightningGamble =
    roll === 1 ? 'overload' : roll === 2 ? 'unstable' : roll === 6 ? 'surge' : 'stable';
  ctx.log(`Lightning gamble: ${result}.`);
  return result;
}

/** Lightning power, doubled by a critical cast. */
function lightningRoll(ctx: EffectContext): number {
  return lightningPower(ctx) * (ctx.crit ? 2 : 1);
}

/**
 * A distance derived from the roll. A critical already doubled the roll, and it
 * doubles reach again on top — so a crit quadruples anything measured this way.
 */
function lightningRange(ctx: EffectContext, units: number): number {
  return R(Math.max(0, units)) * (ctx.crit ? 2 : 1);
}

function pointSegmentDistance(point: Vec2, segment: TrailSegment): number {
  const dx = segment.to.x - segment.from.x;
  const dy = segment.to.y - segment.from.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0.001) return Math.hypot(point.x - segment.from.x, point.y - segment.from.y);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - segment.from.x) * dx + (point.y - segment.from.y) * dy) / lengthSq)
  );
  return Math.hypot(point.x - (segment.from.x + dx * t), point.y - (segment.from.y + dy * t));
}

/** First point beyond the tiny launch grace that touches any existing red trail. */
function firstTrailCollision(from: Vec2, to: Vec2, trail: readonly TrailSegment[]): Vec2 | null {
  if (trail.length === 0) return null;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const startGrace = 16;
  if (length <= startGrace) return null;
  const steps = Math.ceil(length / 4);
  for (let i = Math.floor((startGrace / length) * steps) + 1; i <= steps; i++) {
    const t = i / steps;
    const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    if (trail.some((segment) => pointSegmentDistance(point, segment) <= 4)) return point;
  }
  return null;
}

function segmentHitsMage(segment: TrailSegment, mage: Mage): boolean {
  return pointSegmentDistance(mage.pos, segment) <= mage.bodyRadius();
}

/**
 * Nearest own shadow pool whose disc contains `at` and hasn't already been
 * spent (its id is not in `used`). Returns null when the point lands on no
 * fresh shadow.
 */
function unusedShadowAt(
  ctx: EffectContext,
  at: { x: number; y: number },
  used: Set<number>
) {
  const pools = ctx.game
    .shadowsOf(ctx.caster.team)
    .filter((s) => !used.has(s.id) && Math.hypot(s.x - at.x, s.y - at.y) <= s.radius);
  if (pools.length === 0) return null;
  pools.sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y));
  return pools[0];
}

// ---------------------------------------------------------------------------
//  SINGLE-WORD SPELLS
// ---------------------------------------------------------------------------

// ===========================================================================
//  SINGLE-WORD SPELLS   (DC 6–8)
// ===========================================================================

registerSpell({
  name: 'Shadow',
  words: ['shadow'],
  actionType: 'bonus',
  range: Infinity,
  targeting: 'point',
  dc: 7,
  description:
    'Place a shadow pool anywhere on the field. You can cast spells from your shadow pools and bounce spells through them, and any mage standing in a shadow takes +2 damage.',
  visual: { preset: 'burst', color: 0x8a6bff, size: 70, speed: 1 },
  cast(ctx) {
    if (ctx.targetPoint) placeShadow(ctx, ctx.targetPoint);
  },
});

registerSpell({
  name: 'Shatter',
  words: ['shatter'],
  actionType: 'main',
  range: R(5),
  targeting: 'point',
  dc: 7,
  aoe: { kind: 'cone', radius: R(5), degrees: CONE_DEGREES },
  description: '1d6 shatter damage to everything in a 90° cone (range 5) in the aimed direction.',
  visual: { preset: 'burst', color: 0xffd166, size: 60, speed: 1.2 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const amount = rollDice(ctx, '1d6', 'Shatter');
    coneDamage(
      ctx,
      ctx.targetPoint,
      R(5),
      CONE_DEGREES,
      dmg(amount, 'shatter', 'physical'),
      { strictRange: true }
    );
  },
});

registerSpell({
  name: 'Pierce',
  words: ['pierce'],
  actionType: 'main',
  range: R(8),
  targeting: 'enemy',
  dc: 6,
  description: 'Deal 1d6 pierce damage to one enemy (range 8).',
  visual: { preset: 'projectile', color: 0xfffbe0, size: 8, speed: 1.6 },
  cast(ctx) {
    if (!ctx.target) return;
    const amount = rollDice(ctx, '1d6', 'Pierce');
    dealDamage(ctx, ctx.target, dmg(amount, 'pierce', 'physical'));
  },
});

registerSpell({
  name: 'Mind',
  words: ['mind'],
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 8,
  description:
    "Target one enemy (range 20). On its next turn it cannot use reactions and takes +2 damage.",
  visual: { preset: 'beam', color: 0xff8be0, size: 5, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    applyControl(ctx, ctx.target, { name: 'Foreseen', mode: 'expose', duration: 2 });
    applyDebuff(ctx, ctx.target, { name: 'Foreseen', duration: 2, mods: { damageTaken: 2 } });
  },
});

registerSpell({
  name: 'Veil',
  words: ['veil'],
  actionType: 'bonus',
  range: 0,
  targeting: 'any',
  dc: 6,
  reaction: true, // can flicker out of sight in response to an incoming attack
  description:
    'Give a chosen mage a half veil for 2 turns. Targeted attacks against it miss more often the farther away the attacker is (50% at point-blank, up to 95% at long range). Any landed hit, or an enemy moving within 1 of it, removes the veil. Can be cast as a reaction to make an incoming attack miss.',
  visual: { preset: 'heal', color: 0xb98bff, size: 44, speed: 1 },
  cast(ctx) {
    applyInvisibility(ctx, ctx.target ?? ctx.caster, { duration: 2, mode: 'partial' });
  },
});

registerSpell({
  name: 'Bind',
  words: ['bind'],
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 6,
  reaction: true,
  description: "Reduce one enemy's movement by 50% for 1 turn (range 20).",
  visual: { preset: 'beam', color: 0x6ad1ff, size: 7, speed: 1.4 },
  cast(ctx) {
    if (!ctx.target) return;
    applyDebuff(ctx, ctx.target, {
      name: 'Bound',
      duration: 2,
      mods: { moveRange: -Math.round(MOVE_RANGE * 0.5) },
    });
  },
});

registerSpell({
  name: 'Corrode',
  words: ['corrode'],
  actionType: 'bonus',
  range: R(10),
  targeting: 'point',
  dc: 7,
  aoe: { kind: 'circle', radius: R(1.6) },
  description:
    '1d6 corrosive damage to all enemies in a small area (radius 1.6, aimed within range 10). Each enemy hit has a 33% chance to take 1 corrosive damage per turn for 2 turns, and a 20% chance to move 30% slower for 2 turns.',
  visual: { preset: 'burst', color: 0x9be870, size: 60, speed: 1 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const amount = rollDice(ctx, '1d6', 'Corrode');
    const hits = areaDamage(ctx, ctx.targetPoint, R(1.6), dmg(amount, 'corrosive', 'physical'));
    for (const m of hits) {
      if (ctx.rng.chance(0.33)) {
        applyDot(ctx, m, {
          name: 'Corrosion',
          duration: 2,
          damage: dmg(1, 'corrosive', 'physical'),
        });
      }
      if (ctx.rng.chance(0.2)) {
        applyDebuff(ctx, m, {
          name: 'Etched',
          duration: 2,
          mods: { moveRange: -Math.round(MOVE_RANGE * 0.3) },
        });
      }
    }
  },
});

registerSpell({
  name: 'Curse',
  words: ['curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 7,
  description: "Deal 1d3 shadow damage to one enemy at the start of each of its next 4 turns (range 15).",
  visual: { preset: 'beam', color: 0xff9f6b, size: 5, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    applyDot(ctx, ctx.target, {
      name: 'Curse',
      duration: 4,
      damage: dmg(2, 'shadow', 'physical'),
      damageSpec: '1d3',
    });
  },
});

// ===========================================================================
//  TWO-WORD SPELLS   (DC 9–13)
// ===========================================================================

registerSpell({
  name: 'Shatter Mind',
  words: ['shatter', 'mind'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 11,
  description:
    '1d6 sanity damage to one enemy, with a 50% chance to fully stun it (range 15). If the stun lands as a reaction, it cancels the action it answers.',
  visual: { preset: 'beam', color: 0xff8be0, size: 6, speed: 1.2 },
  cast(ctx) {
    if (!ctx.target) return;
    const amount = rollDice(ctx, '1d6', 'Shatter Mind');
    dealDamage(ctx, ctx.target, dmg(amount, 'shadow', 'sanity'));
    if (ctx.rng.chance(0.5)) applyStun(ctx, ctx.target, { duration: 2, type: 'full' });
  },
});

registerSpell({
  name: 'Mind Bind',
  words: ['mind', 'bind'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 12,
  description:
    'For 3 turns the target must repeat its last action; if it cannot, it does nothing (range 15).',
  visual: { preset: 'beam', color: 0xc59bff, size: 6, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    applyControl(ctx, ctx.target, { name: 'Compelled', mode: 'repeat', duration: 4 });
  },
});

registerSpell({
  name: 'Mind Corrode',
  words: ['mind', 'corrode'],
  actionType: 'main',
  range: R(5),
  targeting: 'enemy',
  dc: 12,
  description: '1d8 sanity damage with a 75% chance to fully stun (range 5).',
  visual: { preset: 'projectile', color: 0xc6f08a, size: 10, speed: 1.2 },
  cast(ctx) {
    if (!ctx.target) return;
    const amount = rollDice(ctx, '1d8', 'Mind Corrode');
    dealDamage(ctx, ctx.target, dmg(amount, 'corrosive', 'sanity'));
    if (ctx.rng.chance(0.75)) applyStun(ctx, ctx.target, { duration: 2, type: 'full' });
  },
});

registerSpell({
  name: 'Mind Veil',
  words: ['mind', 'veil'],
  actionType: 'bonus',
  range: 0,
  targeting: 'any',
  dc: 9,
  reaction: true,
  description: 'Give a chosen mage a Mind Dodge that blocks the next instance of sanity damage or mental control.',
  visual: { preset: 'heal', color: 0xd8a0ff, size: 44, speed: 1 },
  cast(ctx) {
    applyWard(ctx, ctx.target ?? ctx.caster, { name: 'Mind Dodge', against: 'mind', duration: 5 });
  },
});

registerSpell({
  name: 'Mind Curse',
  words: ['mind', 'curse'],
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 13,
  description:
    "For 3 turns the target's spells are chosen at random instead of by its controller (range 20).",
  visual: { preset: 'beam', color: 0xff7bb0, size: 6, speed: 0.9 },
  cast(ctx) {
    if (!ctx.target) return;
    applyControl(ctx, ctx.target, { name: 'Scrambled', mode: 'random', duration: 4 });
  },
});

registerSpell({
  name: 'Mind Pierce',
  words: ['mind', 'pierce'],
  actionType: 'main',
  range: R(10),
  targeting: 'point',
  dc: 10,
  description:
    'Dash up to range 10 toward a point. An enemy you dash to or through takes 1d6 pierce damage and 1d4 sanity damage.',
  visual: { preset: 'projectile', color: 0xffb0e0, size: 9, speed: 1.8 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    dash(ctx, ctx.caster, { toPoint: ctx.targetPoint, distance: R(10) });
    const foe = enemyNear(ctx, ctx.caster.pos, 90);
    if (foe) {
      dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Mind Pierce'), 'pierce', 'physical'));
      dealDamage(ctx, foe, dmg(rollDice(ctx, '1d4', 'Mind Pierce'), 'shadow', 'sanity'));
    }
  },
});

registerSpell({
  name: 'Shadow Bind',
  words: ['shadow', 'bind'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 12,
  description: '2d6 shadow damage and the target is fully rooted for 3 turns (range 15).',
  visual: { preset: 'conjure', color: 0x8a6bff, size: 30, speed: 1.1 },
  cast(ctx) {
    if (!ctx.target) return;
    const amount = rollDice(ctx, '2d6', 'Shadow Bind');
    dealDamage(ctx, ctx.target, dmg(amount, 'shadow', 'physical'));
    applyStun(ctx, ctx.target, { duration: 4, type: 'movement' });
  },
});

registerSpell({
  name: 'Shadow Veil',
  words: ['shadow', 'veil'],
  actionType: 'bonus',
  range: 0,
  targeting: 'any',
  dc: 9,
  reaction: true,
  description: 'For 3 turns a chosen mage is fully invisible whenever it stands inside a shadow.',
  visual: { preset: 'heal', color: 0x8a6bff, size: 44, speed: 1.2 },
  cast(ctx) {
    applyShadowVeil(ctx, ctx.target ?? ctx.caster, { duration: 4 });
  },
});

registerSpell({
  name: 'Shadow Curse',
  words: ['shadow', 'curse'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 11,
  description:
    'Curse one enemy (range 10): each turn for 3 turns it deals 1d6 shadow damage to everyone within range 2 of it — including you if you stand too close.',
  visual: { preset: 'beam', color: 0x6a4bd0, size: 6, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    applyAuraDot(ctx, ctx.target, {
      name: 'Shadow Curse',
      duration: 4,
      radius: R(2),
      damageSpec: '1d6',
      type: 'shadow',
      damageClass: 'physical',
    });
  },
});

registerSpell({
  name: 'Shadow Pierce',
  words: ['shadow', 'pierce'],
  actionType: 'main',
  range: R(5),
  targeting: 'enemy',
  dc: 12,
  description:
    '1d6 shadow damage + 1d6 pierce damage to one enemy (range 5). You must be standing in one of your shadow pools, or have a shadow pool within range 5 of the target.',
  visual: { preset: 'conjure', color: 0xb09bff, size: 28, speed: 1.2 },
  cast(ctx) {
    if (!ctx.target) return;
    const tgt = ctx.target;
    const fromShadow =
      ctx.game.isInShadow(ctx.caster) ||
      ctx.game.shadowsOf(ctx.caster.team).some((s) => Math.hypot(s.x - tgt.x, s.y - tgt.y) <= R(5));
    if (!fromShadow) {
      ctx.log(`${ctx.caster.name} has no shadow to strike from — the blade finds nothing.`);
      return;
    }
    dealDamage(ctx, tgt, dmg(rollDice(ctx, '1d6', 'Shadow Pierce'), 'shadow', 'physical'));
    dealDamage(ctx, tgt, dmg(rollDice(ctx, '1d6', 'Shadow Pierce'), 'pierce', 'physical'));
  },
});

registerSpell({
  name: 'Bind Pierce',
  words: ['bind', 'pierce'],
  actionType: 'main',
  range: R(10),
  targeting: 'point',
  dc: 10,
  reaction: true,
  description:
    'Dash up to range 10 toward a point, then fully stun the nearest enemy within about range 2 of where you land. Can be cast as a reaction, but does not counter the triggering action.',
  visual: { preset: 'projectile', color: 0x9ad8ff, size: 10, speed: 1.7 },
  cast(ctx) {
    if (ctx.targetPoint) dash(ctx, ctx.caster, { toPoint: ctx.targetPoint, distance: R(10) });
    const foe = enemyNear(ctx, ctx.caster.pos, 90);
    if (foe) applyStun(ctx, foe, { duration: 2, type: 'full' });
  },
});

// NOTE: Corrode Curse (corrode + curse) is a CLASS SPELL and now lives in
// spells/classSpells.ts (registerClassSpell), resolving per mage class.

registerSpell({
  name: 'Veil Pierce',
  words: ['veil', 'pierce'],
  actionType: 'main',
  range: R(10),
  targeting: 'point',
  dc: 10,
  description:
    'Dash up to range 10 toward a point, dealing 1d6 pierce damage to the nearest enemy within about range 2 of where you land, then gain a half veil for 2 turns.',
  visual: { preset: 'projectile', color: 0xd9c0ff, size: 9, speed: 1.8 },
  cast(ctx) {
    if (ctx.targetPoint) dash(ctx, ctx.caster, { toPoint: ctx.targetPoint, distance: R(10) });
    const foe = enemyNear(ctx, ctx.caster.pos, 90);
    if (foe) dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Veil Pierce'), 'pierce', 'physical'));
    applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'partial' });
  },
});

// ---------------------------------------------------------------------------
//  ADDITIONAL 2-WORD COMBOS
// ---------------------------------------------------------------------------

registerSpell({
  name: 'Curse Pierce',
  words: ['curse', 'pierce'],
  actionType: 'main',
  range: R(13),
  minRange: R(7),
  targeting: 'enemy',
  dc: 12,
  description:
    'Curse one enemy (cast at range 7-13). It takes 3d3 pierce damage each turn for 4 turns, but only on turns when it is between range 7 and 13 from you.',
  visual: { preset: 'beam', color: 0xc0d0ff, size: 6, speed: 1.1 },
  cast(ctx) {
    if (!ctx.target) return;
    applyDot(ctx, ctx.target, {
      name: 'Curse Pierce',
      duration: 4,
      damage: dmg(0, 'pierce', 'physical'),
      damageSpec: '3d3',
      band: { min: R(7), max: R(13) },
    });
  },
});

registerSpell({
  name: 'Shatter Shadow',
  words: ['shatter', 'shadow'],
  actionType: 'main',
  range: R(15),
  targeting: 'point',
  dc: 12,
  aoe: { kind: 'circle', radius: R(3) },
  description:
    'At a point (range 15), deal 1d6 shadow damage to every enemy within range 3 and root them for 3 turns, then leave a shadow pool there for 5 turns.',
  visual: { preset: 'burst', color: 0x7a5bd0, size: 55, speed: 1.1 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const hits = areaDamage(
      ctx,
      ctx.targetPoint,
      R(3),
      dmg(rollDice(ctx, '1d6', 'Shatter Shadow'), 'shadow', 'physical'),
      { canMiss: false }
    );
    for (const m of hits) applyStun(ctx, m, { duration: 3, type: 'movement' });
    placeShadow(ctx, ctx.targetPoint, 5);
  },
});

registerSpell({
  name: 'Shatter Bind',
  words: ['shatter', 'bind'],
  actionType: 'main',
  range: R(1),
  targeting: 'enemy',
  dc: 10,
  description:
    '1d3 shatter damage to an adjacent enemy (range 1), fully stunning it for 2 turns and rooting it for 4 turns.',
  visual: { preset: 'beam', color: 0xff9bd0, size: 7, speed: 1.3 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d3', 'Shatter Bind'), 'shatter', 'physical'));
    applyStun(ctx, ctx.target, { duration: 2, type: 'full' });
    applyStun(ctx, ctx.target, { duration: 4, type: 'movement' });
  },
});

registerSpell({
  name: 'Shatter Corrode',
  words: ['shatter', 'corrode'],
  actionType: 'main',
  range: R(5),
  targeting: 'enemy',
  dc: 11,
  description:
    '1d6 shatter damage + 1d6 corrosive damage to one enemy (range 5). 25% chance to fully stun it for 2 turns; if that fails, root it for 3 turns instead.',
  visual: { preset: 'projectile', color: 0xc6e08a, size: 11, speed: 1.3 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Shatter Corrode'), 'shatter', 'physical'));
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Shatter Corrode'), 'corrosive', 'physical'));
    if (ctx.rng.chance(0.25)) applyStun(ctx, ctx.target, { duration: 2, type: 'full' });
    else applyStun(ctx, ctx.target, { duration: 3, type: 'movement' });
  },
});

registerSpell({
  name: 'Shatter Veil',
  words: ['shatter', 'veil'],
  actionType: 'main',
  range: 0,
  targeting: 'any',
  dc: 11,
  description:
    'Every veiled mage takes 1d6 shatter damage and is fully stunned for 2 turns. All veils on the field are removed, then a chosen mage gains a half veil for 2 turns.',
  visual: { preset: 'nova', color: 0xff8be0, size: 70, speed: 1.4 },
  cast(ctx) {
    const isVeiled = (m: Mage) =>
      m.isInvisible() || m.statuses.some((s) => s.kind === 'shadowVeil');
    const veiled = ctx.game.mages.filter((m) => m !== ctx.caster && m.alive && isVeiled(m));
    for (const m of veiled) {
      dealDamage(ctx, m, dmg(rollDice(ctx, '1d6', 'Shatter Veil'), 'shatter', 'physical'), {
        canMiss: false,
      });
      applyStun(ctx, m, { duration: 2, type: 'full' });
    }
    for (const m of ctx.game.mages) dispelVeil(ctx, m);
    applyInvisibility(ctx, ctx.target ?? ctx.caster, { duration: 2, mode: 'partial' });
  },
});

registerSpell({
  name: 'Shatter Curse',
  words: ['shatter', 'curse'],
  actionType: 'main',
  range: R(5),
  targeting: 'enemy',
  dc: 11,
  description:
    'Curse one enemy (range 5): 1d6 shatter damage each turn for 3 turns, with a 25% chance to fully stun on each turn it ticks.',
  visual: { preset: 'beam', color: 0xff7bb0, size: 6, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    applyDot(ctx, ctx.target, {
      name: 'Shatter Curse',
      duration: 4,
      damage: dmg(0, 'shatter', 'physical'),
      damageSpec: '1d6',
      stunChance: 0.25,
      stunType: 'full',
    });
  },
});

registerSpell({
  name: 'Shatter Pierce',
  words: ['shatter', 'pierce'],
  actionType: 'main',
  range: R(15),
  minRange: R(15),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'circle', radius: R(5) },
  description:
    'Aimed exactly at range 15. Enemies within range 5 take 1d6 shatter damage and have a 25% chance to move 50% slower for 2 turns; enemies within range 1 of the center also take 2d6 pierce damage and are rooted for 3 turns.',
  visual: { preset: 'burst', color: 0xffd08a, size: 60, speed: 1.2 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const outer = areaDamage(
      ctx,
      ctx.targetPoint,
      R(5),
      dmg(rollDice(ctx, '1d6', 'Shatter Pierce'), 'shatter', 'physical'),
      { canMiss: false }
    );
    for (const m of outer) {
      if (ctx.rng.chance(0.25))
        applyDebuff(ctx, m, {
          name: 'Slowed',
          duration: 2,
          mods: { moveRange: -Math.round(MOVE_RANGE * 0.5) },
        });
    }
    const inner = areaDamage(
      ctx,
      ctx.targetPoint,
      R(1),
      dmg(rollDice(ctx, '2d6', 'Shatter Pierce'), 'pierce', 'physical'),
      { canMiss: false }
    );
    for (const m of inner) applyStun(ctx, m, { duration: 3, type: 'movement' });
  },
});

// NOTE: Mind Shadow (mind + shadow) is a CLASS SPELL and now lives in
// spells/classSpells.ts (registerClassSpell), resolving per mage class.

registerSpell({
  name: 'Shadow Corrode',
  words: ['shadow', 'corrode'],
  actionType: 'main',
  range: R(10),
  bonusRangeInOwnShadow: R(99),
  targeting: 'enemy',
  dc: 11,
  description:
    '1d6 corrosive damage + 2d6 shadow damage to one enemy (range 10). If the target is standing in one of your shadow pools, you can hit it from anywhere on the field.',
  visual: { preset: 'projectile', color: 0xa8d88a, size: 11, speed: 1.4 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Shadow Corrode'), 'corrosive', 'physical'));
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '2d6', 'Shadow Corrode'), 'shadow', 'physical'));
  },
});

// NOTE: Bind Veil (bind + veil) is a CLASS SPELL and now lives in
// spells/classSpells.ts (registerClassSpell), resolving per mage class.

registerSpell({
  name: 'Bind Corrode',
  words: ['bind', 'corrode'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 11,
  description:
    '1d6 corrosive damage to one enemy (range 10), root it for 2 turns, and deal 1d3 corrosive damage each turn for 3 turns.',
  visual: { preset: 'projectile', color: 0x9be870, size: 11, speed: 1.3 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Bind Corrode'), 'corrosive', 'physical'));
    applyStun(ctx, ctx.target, { duration: 2, type: 'movement' });
    applyDot(ctx, ctx.target, {
      name: 'Corrosion',
      duration: 3,
      damage: dmg(1, 'corrosive', 'physical'),
      damageSpec: '1d3',
    });
  },
});

// NOTE: Bind Curse (bind + curse) is a CLASS SPELL and now lives in
// spells/classSpells.ts (registerClassSpell), resolving per mage class.

registerSpell({
  name: 'Veil Corrode',
  words: ['veil', 'corrode'],
  actionType: 'bonus',
  range: 0,
  targeting: 'any',
  dc: 10,
  aoe: { kind: 'circle', radius: R(2) },
  description:
    'Give a chosen mage a half veil for 2 turns. Every enemy within range 2 of you takes 1d6 corrosive damage and moves 30% slower for 2 turns.',
  visual: { preset: 'nova', color: 0x9be870, size: 60, speed: 1 },
  cast(ctx) {
    applyInvisibility(ctx, ctx.target ?? ctx.caster, { duration: 2, mode: 'partial' });
    const hits = areaDamage(
      ctx,
      ctx.caster.pos,
      R(2),
      dmg(rollDice(ctx, '1d6', 'Veil Corrode'), 'corrosive', 'physical')
    );
    for (const m of hits) {
      applyDebuff(ctx, m, {
        name: 'Etched',
        duration: 2,
        mods: { moveRange: -Math.round(MOVE_RANGE * 0.3) },
      });
    }
  },
});

registerSpell({
  name: 'Veil Curse',
  words: ['veil', 'curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 11,
  description:
    'Deal 1d3 shadow damage to one enemy each turn for 4 turns (range 15), and gain a half veil for 2 turns.',
  visual: { preset: 'beam', color: 0xb98bff, size: 6, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    applyDot(ctx, ctx.target, {
      name: 'Veil Curse',
      duration: 4,
      damage: dmg(2, 'shadow', 'physical'),
      damageSpec: '1d3',
    });
    applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'partial' });
  },
});

registerSpell({
  name: 'Pierce Corrode',
  words: ['pierce', 'corrode'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 11,
  description:
    '1d6 pierce damage + 1d6 corrosive damage to one enemy (range 10), then deal 1d3 corrosive damage each turn for 2 turns and slow it (30% less movement) for 2 turns.',
  visual: { preset: 'projectile', color: 0xc6f08a, size: 9, speed: 1.6 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Pierce Corrode'), 'pierce', 'physical'));
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Pierce Corrode'), 'corrosive', 'physical'));
    applyDot(ctx, ctx.target, {
      name: 'Corrosion',
      duration: 2,
      damage: dmg(1, 'corrosive', 'physical'),
      damageSpec: '1d3',
    });
    applyDebuff(ctx, ctx.target, {
      name: 'Etched',
      duration: 2,
      mods: { moveRange: -Math.round(MOVE_RANGE * 0.3) },
    });
  },
});

// ---------------------------------------------------------------------------
//  3-WORD COMBO
// ---------------------------------------------------------------------------

registerSpell({
  name: 'Veil Mind Pierce',
  words: ['veil', 'mind', 'pierce'],
  actionType: 'main',
  range: 0,
  targeting: 'any',
  dc: 4,
  description:
    'Repeatedly roll a d6. On each new result, teleport to a point within range 4 (ignoring roots and barriers), then deal 1d3 sanity damage + 1d3 pierce damage to an enemy within range 5. Each teleport lets enemies react. The first time a number repeats, you turn fully invisible for 2 turns and the spell ends.',
  visual: { preset: 'nova', color: 0xd9c0ff, size: 60, speed: 1.3 },
  async cast(ctx) {
    const seen = new Set<number>();
    // A d6 can yield at most 6 distinct values, so a repeat is forced by the
    // 7th roll — the loop is bounded and always terminates.
    for (let i = 0; i < 6; i++) {
      const roll = rollDice(ctx, '1d6', 'Veil Mind Pierce');
      if (seen.has(roll)) {
        applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'full' });
        ctx.log(`${ctx.caster.name} glimpses a familiar number and vanishes completely.`);
        return;
      }
      seen.add(roll);
      // Blink to a point within R(4), then strike an enemy within R(5) of it.
      const point = ctx.requestPoint
        ? await ctx.requestPoint({
            maxRange: R(4),
            origin: ctx.caster.pos,
            prompt: `${ctx.caster.name}: blink to a point (R4) — roll ${roll}.`,
          })
        : ctx.caster.pos;
      const center = point ?? ctx.caster.pos;
      // A teleport, not a physical dash — unaffected by roots, shatter zones, etc.
      blinkstep(ctx, ctx.caster, { toPoint: center, distance: R(4) });
      // Each blink is its own step: opponents may react at this exact timing.
      await ctx.reactionWindow?.('Veil Mind Pierce — blink', ctx.caster.pos);
      if (!ctx.caster.alive) return;
      const foe = ctx.requestEnemy
        ? await ctx.requestEnemy({
            range: R(5),
            origin: ctx.caster.pos,
            prompt: `${ctx.caster.name}: strike an enemy within R5 of the mark.`,
          })
        : enemyNear(ctx, ctx.caster.pos, R(5));
      if (foe) {
        dealDamage(ctx, foe, dmg(rollDice(ctx, '1d3', 'Veil Mind Pierce'), 'shadow', 'sanity'));
        dealDamage(ctx, foe, dmg(rollDice(ctx, '1d3', 'Veil Mind Pierce'), 'pierce', 'physical'));
        // Show the strike land (dice + hit animation) before the next d6 roll.
        await ctx.resolveImpacts?.();
      }
    }
    applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'full' });
  },
});

// ===========================================================================
//  NAD EASTER-EGG SPELLS   (words: Mind / Shatter / Twist / Reality)
// ===========================================================================

registerSpell({
  name: 'Reality',
  words: ['reality'],
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 7,
  reaction: true,
  minStackDepth: 2,
  nullifiesStack: true,
  description:
    'May only be cast while at least two other items are on the stack. On success, nullify every other item on the stack.',
  visual: { preset: 'nova', color: 0xff5599, size: 80, speed: 1.2 },
  cast() {},
});

registerSpell({
  name: 'Twist',
  words: ['twist'],
  actionType: 'main',
  range: R(25),
  targeting: 'enemy',
  dc: 9,
  reaction: true,
  counters: true, // as a reaction it stifles whatever it answers (even a move)
  description:
    'Target one enemy (range 25). Cast as a reaction, it cancels any action it answers, including a move. If you Twist the same target twice in one turn, deal 2d6 physical damage; otherwise disarm its next action.',
  visual: { preset: 'beam', color: 0x66ffd1, size: 5, speed: 1.4 },
  cast(ctx) {
    if (!ctx.target) return;
    twistStrike(ctx, ctx.target);
  },
});

registerSpell({
  name: 'Stop',
  words: ['stop'],
  actionType: 'main',
  range: R(30),
  targeting: 'enemy',
  reaction: true,
  counters: true,
  description:
    'Companion-only command magic. As a reaction, unconditionally cancel any action or effect it answers. On turn, stop one enemy for its next action.',
  visual: { preset: 'burst', color: 0x9ee7ff, size: 52, speed: 1.8 },
  cast(ctx) {
    if (ctx.target) applyStun(ctx, ctx.target, { duration: 1, type: 'full' });
  },
});

registerSpell({
  name: 'Twist Mind',
  words: ['twist', 'mind'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 12,
  description:
    "3d3 sanity damage to one enemy (range 15). It also forgets 2 random actions (move, melee, or one of its words) for 3 turns.",
  visual: { preset: 'beam', color: 0x66ffd1, size: 6, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '3d3', 'Mind Twist'), 'shadow', 'sanity'));
    applyForget(ctx, ctx.target, { count: 2, duration: 3 });
  },
});

registerSpell({
  name: 'Twist Reality',
  words: ['twist', 'reality'],
  actionType: 'main',
  range: Infinity,
  targeting: 'point',
  dc: 12,
  reaction: true,
  counters: true,
  description:
    'Turn every living entity 90 degrees around the battlefield centre while all terrain remains fixed. Enemies that hit a wall or field border take 2d6 typeless physical damage. Aim right of centre for clockwise or left for counterclockwise. As a reaction, also cancel the answered action.',
  visual: { preset: 'nova', color: 0x88d8b8, size: 120, speed: 0.8 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const centreX = FIELD.x + FIELD.w / 2;
    ctx.game.turnBattlefield(ctx.targetPoint.x >= centreX, ctx.caster);
  },
});

registerSpell({
  name: 'Mind Shatter Twist',
  words: ['mind', 'shatter', 'twist'],
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 14,
  reaction: true,
  counters: true,
  description:
    'Deal 2d6 sanity damage, fully stun for 1 turn, and make the target forget 2 actions for 3 turns (range 20). As a reaction, cancel the answered action.',
  visual: { preset: 'beam', color: 0xb58bd8, size: 9, speed: 1.2 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(
      ctx,
      ctx.target,
      dmg(rollDice(ctx, '2d6', 'Mind Shatter Twist'), 'shadow', 'sanity')
    );
    applyStun(ctx, ctx.target, { duration: 2, type: 'full' });
    applyForget(ctx, ctx.target, { count: 2, duration: 3 });
  },
});

registerSpell({
  name: 'Mind Twist Reality',
  words: ['mind', 'twist', 'reality'],
  actionType: 'main',
  range: Infinity,
  targeting: 'enemy',
  dc: 15,
  reaction: true,
  counters: true,
  description:
    'From anywhere on the field, deal 4d3 sanity damage and make the target forget 3 actions for 4 turns. As a reaction, cancel the answered action.',
  visual: { preset: 'beam', color: 0xd078c8, size: 10, speed: 1.2 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '4d3', 'Mind Twist Reality'), 'shadow', 'sanity'));
    applyForget(ctx, ctx.target, { count: 3, duration: 4 });
  },
});

registerSpell({
  name: 'Shatter Twist Reality',
  words: ['shatter', 'twist', 'reality'],
  actionType: 'main',
  range: Infinity,
  targeting: 'enemy',
  dc: 15,
  reaction: true,
  counters: true,
  aoe: { kind: 'circle', radius: R(2) },
  description:
    'Cancel the answered action, then deal 3d6 shatter damage to enemies within range 2 of its source anywhere on the field. Fully stun the primary target for 1 turn and slow the others for 2 turns.',
  visual: { preset: 'burst', color: 0xe09878, size: 76, speed: 1.3 },
  cast(ctx) {
    if (!ctx.target) return;
    const hits = areaDamage(
      ctx,
      ctx.target.pos,
      R(2),
      dmg(rollDice(ctx, '3d6', 'Shatter Twist Reality'), 'shatter', 'physical')
    );
    for (const hit of hits) {
      if (hit === ctx.target) applyStun(ctx, hit, { duration: 2, type: 'full' });
      else {
        applyDebuff(ctx, hit, {
          name: 'Reality Fracture',
          duration: 2,
          mods: { moveRange: -Math.round(MOVE_RANGE * 0.5) },
        });
      }
    }
  },
});

registerSpell({
  name: 'Reality Mind',
  words: ['reality', 'mind'],
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 14,
  description:
    'Swap control with the target for 2 turns (range 20): you control their mage and they control yours.',
  visual: { preset: 'beam', color: 0xff5599, size: 7, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    swapMinds(ctx, ctx.target, 2);
  },
});

registerSpell({
  name: 'Reality Shatter',
  words: ['reality', 'shatter'],
  actionType: 'main',
  range: Infinity,
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'cone', radius: 1400, degrees: 45 },
  twoPointAim: true,
  description:
    'Aim two points (both chosen before the roll) to set where a wedge opens and how wide it is. Enemies caught inside take 2d6 shatter damage. The wedge extends to the field edge and blocks movement for 3 rounds.',
  visual: { preset: 'burst', color: 0xff5599, size: 70, speed: 1.2 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const diag = Math.hypot(FIELD.w, FIELD.h);
    // Both cone edges were chosen up-front (before the DC roll): targetPoint is
    // one edge, targetPoint2 the other. The wedge reaches to the field's edge.
    const wedge = placeRealityWedge(ctx, ctx.targetPoint, ctx.targetPoint2 ?? null, {
      ttl: 3,
      length: diag,
    });
    const toward = {
      x: wedge.apex.x + Math.cos(wedge.angle) * wedge.range,
      y: wedge.apex.y + Math.sin(wedge.angle) * wedge.range,
    };
    coneDamage(
      ctx,
      toward,
      wedge.range,
      (wedge.halfAngle * 360) / Math.PI,
      dmg(rollDice(ctx, '2d6', 'Reality Shatter'), 'shatter', 'physical')
    );
  },
});

registerSpell({
  name: 'Shatter Mind Reality',
  words: ['shatter', 'mind', 'reality'],
  actionType: 'main',
  range: R(20),
  targeting: 'any',
  dc: 15,
  description:
    'Choose any living target within range 20; it takes an extra turn after this one. Then every enemy takes 3d3 mental damage.',
  visual: { preset: 'beam', color: 0xff5599, size: 7, speed: 1.1 },
  cast(ctx) {
    if (!ctx.target) return;
    grantExtraTurn(ctx, ctx.target);
    const amount = rollDice(ctx, '3d3', 'Shatter Mind Reality');
    for (const enemy of ctx.game.mages) {
      if (enemy.alive && enemy.team !== ctx.caster.team) {
        dealDamage(
          ctx,
          enemy,
          dmg(amount, 'shadow', 'sanity'),
          { aoe: true }
        );
      }
    }
  },
});

// ===========================================================================
//  MODIFIER WORDS   (Subtle / Delay / Channel — known by every mage)
// -----------------------------------------------------------------------------
//  Subtle and Channel only ever attach to another spell. Delay does too, but it
//  is also a spell in its own right: cast alone it postpones something already
//  waiting on the stack.
// ===========================================================================

registerSpell({
  name: 'Delay',
  words: ['delay'],
  actionType: 'bonus',
  range: 0,
  targeting: 'none',
  dc: 7,
  description:
    "Answer an action or damage trigger waiting on the stack: it does not happen now. Instead it resolves at the start of the affected entity's next turn.",
  delaysStackItem: true,
  visual: { preset: 'nova', color: 0x7fd8c0, size: 46, speed: 1.3 },
  cast(ctx) {
    // The postponement itself is performed by the stack once this resolves.
    ctx.log(`${ctx.caster.name} folds the moment aside.`);
  },
});

// ===========================================================================
//  KAT EASTER-EGG SPELLS   (words: Corrode / Curse / Shadow / Drain / Death)
// -----------------------------------------------------------------------------
//  Death is the execute word. It stacks Reap on a victim: a reaped foe dies the
//  moment its health falls to its Reap count, and every execution threshold is
//  raised by 2 per stack.
// ===========================================================================

registerSpell({
  name: 'Death',
  words: ['death'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 7,
  description:
    'Mark one enemy with 1d6 Reap, then execute it for 1 (range 15). A reaped foe dies at or below its Reap count, and executions are raised by 2 per stack.',
  visual: { preset: 'beam', color: 0xb9c0cc, size: 6, speed: 1.2 },
  cast(ctx) {
    if (!ctx.target) return;
    ctx.game.applyReap(ctx.target, rollDice(ctx, '1d6', 'Death — Reap'), ctx.caster);
    if (ctx.target.alive) ctx.game.executeTarget(ctx.caster, ctx.target, 1);
  },
});

registerSpell({
  name: 'Death Corrode',
  words: ['corrode', 'death'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 11,
  description: 'Mark one enemy with 1d4 Reap and deal 1d6 corrosive health damage (range 10).',
  visual: { preset: 'projectile', color: 0xa9b487, size: 10, speed: 1.3 },
  cast(ctx) {
    if (!ctx.target) return;
    ctx.game.applyReap(ctx.target, rollDice(ctx, '1d4', 'Death Corrode — Reap'), ctx.caster);
    if (!ctx.target.alive) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Death Corrode'), 'corrosive', 'physical'));
  },
});

registerSpell({
  name: 'Death Drain',
  words: ['drain', 'death'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 11,
  description:
    'Mark one enemy with 1d4 Reap and deal 1d6 corrosive health damage, healing yourself for the corrosive damage dealt (range 10).',
  visual: { preset: 'projectile', color: 0x8fa88f, size: 11, speed: 1.4 },
  manualCastVisual: true,
  cast(ctx) {
    if (!ctx.target) return;
    ctx.game.applyReap(ctx.target, rollDice(ctx, '1d4', 'Death Drain — Reap'), ctx.caster);
    if (!ctx.target.alive) return;
    drainDamage(
      ctx,
      ctx.target,
      dmg(rollDice(ctx, '1d6', 'Death Drain'), 'corrosive', 'physical')
    );
  },
});

registerSpell({
  name: 'Death Shadow',
  words: ['shadow', 'death'],
  actionType: 'main',
  range: R(5),
  targeting: 'none',
  dc: 11,
  description:
    'Mark every enemy within range 5 — and every enemy standing in one of your shadows, at any distance — with 1d10 Reap, then execute each of them for 1.',
  visual: { preset: 'nova', color: 0x8a6bff, size: 60, speed: 1.2 },
  cast(ctx) {
    const pools = ctx.game.shadowsOf(ctx.caster.team);
    const foes = ctx.game.mages.filter(
      (mage) =>
        mage.alive &&
        mage.team !== ctx.caster.team &&
        (Math.hypot(mage.x - ctx.caster.x, mage.y - ctx.caster.y) <= R(5) ||
          pools.some((pool) => Math.hypot(pool.x - mage.x, pool.y - mage.y) <= pool.radius))
    );
    if (foes.length === 0) {
      ctx.log('The dark finds nothing to reap.');
      return;
    }
    for (const foe of foes) {
      ctx.game.applyReap(foe, rollDice(ctx, '1d10', 'Death Shadow — Reap'), ctx.caster);
      if (foe.alive) ctx.game.executeTarget(ctx.caster, foe, 1);
    }
  },
});

registerSpell({
  name: 'Death Curse',
  words: ['curse', 'death'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 11,
  description:
    'Bind one enemy with a 13-counter Death Curse. Each counter falls at the start of its turn and whenever it takes shadow or corrosive damage, granting 2 Reap. While it lasts, executions become Reap instead of kills; its final counter executes the victim for 1.',
  visual: { preset: 'beam', color: 0x8d7f9c, size: 7, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    ctx.game.applyDeathCurse(ctx.target, 13, ctx.caster);
  },
});

registerSpell({
  name: 'Corrode Drain',
  words: ['corrode', 'drain'],
  actionType: 'bonus',
  range: R(10),
  targeting: 'point',
  dc: 11,
  aoe: { kind: 'circle', radius: R(2) },
  description:
    'Deal 1d6 corrosive damage to enemies in a range-2 area aimed within range 10, healing for all damage dealt. Each target has a 25% chance to be slowed by 30% for 2 turns.',
  visual: { preset: 'burst', color: 0x70c880, size: 64, speed: 1.2 },
  manualCastVisual: true,
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const foes = ctx.game
      .magesInRadius(ctx.targetPoint, R(2), ctx.caster)
      .filter((mage) => mage.team !== ctx.caster.team);
    for (const foe of foes) {
      drainDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Corrode Drain'), 'corrosive', 'physical'), {
        aoe: true,
      });
      if (ctx.rng.chance(0.25)) {
        applyDebuff(ctx, foe, {
          name: 'Dissolved Footing',
          duration: 2,
          mods: { moveRange: -Math.round(MOVE_RANGE * 0.3) },
        });
      }
    }
  },
});

registerSpell({
  name: 'Umbral Rot',
  words: ['corrode', 'curse', 'shadow'],
  actionType: 'main',
  range: R(15),
  bonusRangeInOwnShadow: R(99),
  targeting: 'enemy',
  dc: 13,
  description:
    'Deal 1d6 corrosive damage, then curse the target for 1d6 shadow damage each turn and +2 damage taken for 5 turns. Targets in your shadows can be reached globally.',
  visual: { preset: 'projectile', color: 0x6f9b68, size: 12, speed: 1.1 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Umbral Rot'), 'corrosive', 'physical'));
    applyDot(ctx, ctx.target, {
      name: 'Umbral Rot',
      key: 'dot:umbral-rot',
      duration: 5,
      damage: dmg(0, 'shadow', 'physical'),
      damageSpec: '1d6',
    });
    applyDebuff(ctx, ctx.target, {
      name: 'Umbral Rot',
      key: 'debuff:umbral-rot',
      duration: 5,
      mods: { damageTaken: 2 },
    });
  },
});

registerSpell({
  name: 'Rotting Verdict',
  words: ['corrode', 'curse', 'death'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'Pass sentence on one enemy: 1d6 corrosive damage each turn for 4 turns, and every tick adds 2 Reap. The verdict lands with an immediate execution for 2.',
  visual: { preset: 'beam', color: 0x9aa877, size: 8, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    applyDot(ctx, ctx.target, {
      name: 'Rotting Verdict',
      key: 'dot:rotting-verdict',
      duration: 4,
      damage: dmg(0, 'corrosive', 'physical'),
      damageSpec: '1d6',
      reapPerTick: 2,
    });
    if (ctx.target.alive) ctx.game.executeTarget(ctx.caster, ctx.target, 2);
  },
});

registerSpell({
  name: 'Umbral Dissolution',
  words: ['corrode', 'shadow', 'drain'],
  actionType: 'main',
  range: R(10),
  bonusRangeInOwnShadow: R(99),
  targeting: 'enemy',
  dc: 13,
  description:
    'Drain 2d6 corrosive and 2d6 shadow damage, then slow the target by 50% for 2 turns. Targets in your shadows can be reached globally.',
  visual: { preset: 'projectile', color: 0x579b80, size: 13, speed: 1.3 },
  manualCastVisual: true,
  cast(ctx) {
    if (!ctx.target) return;
    drainDamage(
      ctx,
      ctx.target,
      dmg(rollDice(ctx, '2d6', 'Umbral Dissolution'), 'corrosive', 'physical')
    );
    drainDamage(ctx, ctx.target, dmg(rollDice(ctx, '2d6', 'Umbral Dissolution'), 'shadow', 'physical'));
    applyDebuff(ctx, ctx.target, {
      name: 'Dissolved',
      duration: 2,
      mods: { moveRange: -Math.round(MOVE_RANGE * 0.5) },
    });
  },
});

registerSpell({
  name: 'Umbral Guillotine',
  words: ['corrode', 'shadow', 'death'],
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'circle', radius: R(2) },
  description:
    'Drop a blade of darkness on a range-2 area. Enemies take 2d6 corrosive damage and 1d6 Reap, then are executed for 2. A victim standing in one of your shadows takes 2 extra Reap and is executed for 4 instead.',
  visual: { preset: 'burst', color: 0x6b5a86, size: 68, speed: 1.3 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const pools = ctx.game.shadowsOf(ctx.caster.team);
    const foes = ctx.game
      .magesInRadius(ctx.targetPoint, R(2), ctx.caster)
      .filter((mage) => mage.team !== ctx.caster.team);
    for (const foe of foes) {
      const shadowed = pools.some(
        (pool) => Math.hypot(pool.x - foe.x, pool.y - foe.y) <= pool.radius
      );
      dealDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Umbral Guillotine'), 'corrosive', 'physical'), {
        aoe: true,
      });
      if (!foe.alive) continue;
      ctx.game.applyReap(
        foe,
        rollDice(ctx, '1d6', 'Umbral Guillotine — Reap') + (shadowed ? 2 : 0),
        ctx.caster
      );
      if (foe.alive) ctx.game.executeTarget(ctx.caster, foe, shadowed ? 4 : 2);
    }
  },
});

registerSpell({
  name: 'Rotfeast',
  words: ['corrode', 'drain', 'death'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 13,
  description:
    'Corrosion twice over: two separate surges of 2d6 corrosive damage, each healing you for everything it deals and each feeding the mark 1d4 Reap. The feast closes with an execution for 4.',
  visual: { preset: 'projectile', color: 0x7fa06a, size: 14, speed: 1.4 },
  manualCastVisual: true,
  cast(ctx) {
    if (!ctx.target) return;
    // Corrode and Drain are the same bite, so stacking them lands it twice.
    for (let surge = 0; surge < 2 && ctx.target.alive; surge++) {
      drainDamage(
        ctx,
        ctx.target,
        dmg(rollDice(ctx, '2d6', 'Rotfeast'), 'corrosive', 'physical')
      );
      if (!ctx.target.alive) break;
      ctx.game.applyReap(ctx.target, rollDice(ctx, '1d4', 'Rotfeast — Reap'), ctx.caster);
    }
    if (ctx.target.alive) ctx.game.executeTarget(ctx.caster, ctx.target, 4);
  },
});

registerSpell({
  name: 'Umbral Hunger',
  words: ['curse', 'shadow', 'drain'],
  actionType: 'main',
  range: R(15),
  bonusRangeInOwnShadow: R(99),
  targeting: 'enemy',
  dc: 14,
  description:
    'Curse the target for 2d4 shadow damage each turn for 5 turns, healing your health for all damage. It takes +2 damage, and targets in your shadows can be reached globally.',
  visual: { preset: 'beam', color: 0x675788, size: 8, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    applyDot(ctx, ctx.target, {
      name: 'Umbral Hunger',
      key: 'dot:umbral-hunger',
      duration: 5,
      damage: dmg(0, 'shadow', 'physical'),
      damageSpec: '2d4',
      lifestealToIndex: ctx.game.mages.indexOf(ctx.caster),
    });
    applyDebuff(ctx, ctx.target, {
      name: 'Umbral Hunger',
      key: 'debuff:umbral-hunger',
      duration: 5,
      mods: { damageTaken: 2 },
    });
  },
});

registerSpell({
  name: "Reaper's Tithe",
  words: ['curse', 'shadow', 'death'],
  actionType: 'main',
  range: R(15),
  bonusRangeInOwnShadow: R(99),
  targeting: 'enemy',
  dc: 14,
  description:
    'A shade stalks the target for 5 turns, dealing 1d4 shadow damage and adding 1 Reap each turn. When the marked victim dies, its entire Reap count leaps to the nearest enemy within range 10. Targets in your shadows can be reached globally.',
  visual: { preset: 'beam', color: 0x5f5d86, size: 8, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    applyDot(ctx, ctx.target, {
      name: "Reaper's Tithe",
      key: 'dot:reapers-tithe',
      duration: 5,
      damage: dmg(0, 'shadow', 'physical'),
      damageSpec: '1d4',
      reapPerTick: 1,
      reapTransferRadius: R(10),
    });
  },
});

registerSpell({
  name: 'Grave Tithe',
  words: ['curse', 'drain', 'death'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 14,
  description:
    'Chain one enemy to your own recovery for 5 turns: it suffers 1d6 corrosive damage each turn and you drink that damage as health. While the chain holds, every heal you receive from any source adds 1 Reap to the victim.',
  visual: { preset: 'beam', color: 0x6f8f86, size: 8, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    applyDot(ctx, ctx.target, {
      name: 'Grave Tithe',
      key: 'dot:grave-tithe',
      duration: 5,
      damage: dmg(0, 'corrosive', 'physical'),
      damageSpec: '1d6',
      lifestealToIndex: ctx.game.mages.indexOf(ctx.caster),
      reapOnOwnerHealIndex: ctx.game.mages.indexOf(ctx.caster),
    });
  },
});

registerSpell({
  name: "Reaper's Shard",
  words: ['shadow', 'drain', 'death'],
  actionType: 'main',
  range: R(15),
  bonusRangeInOwnShadow: R(99),
  targeting: 'enemy',
  dc: 13,
  description:
    'Hurl a returning shard of grave-glass: 1d6 Reap, an execution for 2, and 2d6 corrosive damage that heals you for the amount dealt. If the shard kills, you may spend 5 mana to throw it again at any enemy in range 15 — as long as it keeps killing. Targets in your shadows can be reached globally.',
  visual: { preset: 'projectile', color: 0x7d6f8c, size: 12, speed: 1.5 },
  manualCastVisual: true,
  async cast(ctx) {
    let foe = ctx.target;
    // Each re-throw costs mana and must kill again, so the loop always ends.
    for (let throwCount = 0; foe && ctx.caster.alive; throwCount++) {
      const impactPoint = { ...foe.pos };
      await ctx.vfx?.boomerang?.(ctx.caster.pos, impactPoint, 0x7d6f8c, 12, 1.5);
      ctx.game.applyReap(foe, rollDice(ctx, "1d6", "Reaper's Shard — Reap"), ctx.caster);
      if (foe.alive) ctx.game.executeTarget(ctx.caster, foe, 2);
      if (foe.alive) {
        drainDamage(
          ctx,
          foe,
          dmg(rollDice(ctx, '2d6', "Reaper's Shard"), 'corrosive', 'physical')
        );
      } else {
        ctx.vfx?.spellEffect?.(foe, 'corrosive');
        ctx.vfx?.drainParticles?.(impactPoint, ctx.caster.pos);
      }
      await ctx.resolveImpacts?.();
      await ctx.vfx?.boomerang?.(impactPoint, ctx.caster.pos, 0x7d6f8c, 12, 1.5);
      if (foe.alive || !ctx.caster.alive) return;

      ctx.log(`The shard tears free of ${foe.name} and returns to ${ctx.caster.name}.`);
      if (!ctx.caster.hasMana(5)) {
        ctx.log(`${ctx.caster.name} lacks the 5 mana to hurl the shard again.`);
        return;
      }
      const next = ctx.requestEnemy
        ? await ctx.requestEnemy({
            range: R(15),
            origin: ctx.caster.pos,
            prompt: `${ctx.caster.name}: spend 5 mana to hurl the shard again — Esc to keep it.`,
          })
        : null;
      if (!next) return;
      ctx.caster.spendMana(5);
      ctx.log(`${ctx.caster.name} spends 5 mana and hurls the shard at ${next.name}.`);
      foe = next;
    }
  },
});

// ===========================================================================
//  SNIFF EASTER-EGG SPELLS   (Pierce / Mind / Veil / Fire / Lightning)
// ===========================================================================

registerSpell({
  name: 'Fire',
  words: ['fire'],
  actionType: 'bonus',
  range: R(15),
  targeting: 'enemy',
  dc: 7,
  description: 'Apply 1 stack of Fire to one enemy (range 15).',
  visual: { preset: 'projectile', color: 0xff5a36, size: 10, speed: 1.4 },
  cast(ctx) {
    if (ctx.target) applyFireStacks(ctx, ctx.target, 1);
  },
});

registerSpell({
  name: 'Lightning',
  words: ['lightning'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 8,
  description:
    'Strike one enemy for 1d6 plus power scaling, then fork onward to fresh enemies — never the same body twice — until nothing is left in reach. Lightning power sets the bounce range, which halves with every jump. An overload also mirrors the first hit into you; a surge widens every bounce. A natural 20 doubles the reach.',
  visual: { preset: 'beam', color: 0xffe45c, size: 7, speed: 1.7 },
  async cast(ctx) {
    if (!ctx.target) return;
    const power = lightningPower(ctx);
    const gamble = lightningGamble(ctx);
    const amount = rollDice(ctx, '1d6', 'Lightning') + Math.floor(power / 6);
    dealDamage(ctx, ctx.target, dmg(amount, 'heat', 'physical'));
    if (gamble === 'overload' && ctx.caster.alive) {
      dealDamage(ctx, ctx.caster, dmg(amount, 'heat', 'physical'), { canMiss: false });
    }
    // Grounding into yourself is what overload is for, so the fork only ever
    // leaps to fresh enemy bodies and dies out once none are left in reach.
    const struck = new Set<Mage>([ctx.target]);
    let from = ctx.target;
    let reach = R(Math.min(12, 3 + Math.floor(power / 3))) * (ctx.crit ? 2 : 1);
    if (gamble === 'surge') reach *= 1.5;
    let bounces = 0;
    while (reach >= R(1)) {
      const candidates = ctx.game
        .magesInRadius(from.pos, reach)
        .filter((mage) => !struck.has(mage) && mage.team !== ctx.caster.team);
      if (candidates.length === 0) break;
      const next = ctx.rng.pick(candidates);
      await ctx.vfx?.lightningBolt?.(from.pos, next.pos);
      dealDamage(ctx, next, dmg(amount, 'heat', 'physical'), { canMiss: false });
      struck.add(next);
      from = next;
      reach /= 2;
      bounces += 1;
    }
    if (bounces > 0) {
      ctx.log(`The bolt forks through ${bounces} more ${bounces === 1 ? 'body' : 'bodies'}.`);
    }
  },
});

registerSpell({
  name: 'Fire Mind',
  words: ['fire', 'mind'],
  actionType: 'main',
  range: R(10),
  targeting: 'any',
  dc: 11,
  description: 'Enchant the target’s active weapon. Every landed hit applies 1 Blueflare.',
  visual: { preset: 'conjure', color: 0x56bfff, size: 38, speed: 1.3 },
  cast(ctx) {
    const target = ctx.target ?? ctx.caster;
    const weaponId = target.activeWeaponId();
    if (!weaponId) {
      ctx.log(`${target.name} has no active weapon to enchant.`);
      return;
    }
    target.weaponEnchant = 'fireMind';
    target.enchantedWeapon = weaponId;
    ctx.log(`${target.name}'s weapon begins burning with thought-fire.`);
  },
});

registerSpell({
  name: 'Fire Lightning',
  words: ['fire', 'lightning'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 11,
  description:
    'Strike an enemy, then gamble through up to one random nearby unit per 5 Lightning power. Every arc deals 1d6 heat and applies Fire; allies and caster are valid later jumps. A natural 20 overloads every living unit for 20d6 and 20 Fire.',
  visual: { preset: 'beam', color: 0xff9d36, size: 10, speed: 1.6 },
  async cast(ctx) {
    if (!ctx.target) return;
    const power = lightningPower(ctx);
    if (ctx.crit) {
      for (const target of ctx.game.mages.filter((mage) => mage.alive)) {
        await ctx.vfx?.lightningBolt?.(ctx.caster.pos, target.pos);
        dealDamage(ctx, target, dmg(rollDice(ctx, '20d6', 'Fire Lightning overload'), 'heat', 'physical'), {
          canMiss: false,
        });
        if (target.alive) applyFireStacks(ctx, target, 20);
      }
      return;
    }
    let current = ctx.target;
    let from = ctx.caster.pos;
    const visited = new Set<Mage>();
    const jumps = Math.max(1, Math.ceil(power / 5)) * (ctx.crit ? 2 : 1);
    const jumpRange = R(ctx.crit ? 12 : 6);
    for (let jump = 0; jump < jumps && current.alive; jump++) {
      const gamble = lightningGamble(ctx);
      const overload = gamble === 'overload';
      if (overload) current = ctx.caster;
      await ctx.vfx?.lightningBolt?.(from, current.pos);
      const amount = rollDice(ctx, '1d6', 'Fire Lightning arc') + Math.floor(power / 6);
      dealDamage(ctx, current, dmg(amount, 'heat', 'physical'), { canMiss: false });
      if (current.alive) applyFireStacks(ctx, current, 1 + Math.floor(power / 10));
      visited.add(current);
      if (overload || !ctx.caster.alive) break;
      const candidates = ctx.game.mages.filter(
        (mage) =>
          mage !== current &&
          mage.alive &&
          (ctx.crit || !visited.has(mage)) &&
          Math.hypot(mage.x - current.x, mage.y - current.y) <= jumpRange
      );
      if (gamble === 'surge' && candidates.length > 0) {
        const fork = ctx.rng.pick(candidates);
        await ctx.vfx?.lightningBolt?.(current.pos, fork.pos);
        dealDamage(ctx, fork, dmg(amount, 'heat', 'physical'), { canMiss: false });
        if (fork.alive) applyFireStacks(ctx, fork, 1 + Math.floor(power / 10));
        visited.add(fork);
      }
      const next = candidates.filter((candidate) => ctx.crit || !visited.has(candidate));
      if (next.length === 0) break;
      from = current.pos;
      current = ctx.rng.pick(next);
    }
  },
});

registerSpell({
  name: 'Fire Veil',
  words: ['fire', 'veil'],
  actionType: 'bonus',
  range: 0,
  targeting: 'self',
  dc: 10,
  reaction: true,
  description: 'Gain a weaker half veil for 2 turns. At each turn start while still veiled, nearby enemies within range 2 gain 1 Fire.',
  visual: { preset: 'nova', color: 0xff6f52, size: R(2), speed: 1.4 },
  cast(ctx) {
    applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'partial' });
    for (const target of ctx.game.magesInRadius(ctx.caster.pos, R(2), ctx.caster)) {
      if (target.team !== ctx.caster.team) applyFireStacks(ctx, target, 1);
    }
    addOrExtendStatus(
      ctx.caster.statuses,
      {
        key: 'aura:fire-veil',
        name: 'Cinder Veil',
        kind: 'fireVeilAura',
        duration: 3,
        radius: R(2),
        ownerIndex: ctx.game.mages.indexOf(ctx.caster),
      },
      false
    );
  },
});

registerSpell({
  name: 'Lightning Mind',
  words: ['lightning', 'mind'],
  actionType: 'main',
  range: 0,
  targeting: 'self',
  dc: 11,
  description:
    'Enchant your active weapon. Each hit arcs half its dealt damage as sanity. The conductor may overload you, surge to two targets, or on a natural 20 arc to everything nearby.',
  visual: { preset: 'conjure', color: 0x79bfff, size: 46, speed: 1.7 },
  cast(ctx) {
    const target = ctx.target ?? ctx.caster;
    const weaponId = target.activeWeaponId();
    if (!weaponId) {
      ctx.log(`${target.name} has no active weapon to enchant.`);
      return;
    }
    const power = lightningPower(ctx);
    const gamble = lightningGamble(ctx);
    if (gamble === 'overload') {
      dealDamage(ctx, target, dmg(rollDice(ctx, '1d6', 'Synaptic overload'), 'heat', 'sanity'), {
        canMiss: false,
      });
      if (!ctx.crit) {
        ctx.log(`The conductor grounds into ${target.name} before it can bind.`);
        return;
      }
      ctx.log(`The critical conductor grounds into ${target.name} and binds anyway.`);
    }
    target.weaponEnchant = 'lightningMind';
    target.enchantedWeapon = weaponId;
    target.lightningMindPower = power;
    target.lightningMindCritical = !!ctx.crit;
    target.lightningMindSurged = gamble === 'surge';
    ctx.log(
      `${target.name}'s weapon holds a ${power}-power mindstorm${ctx.crit ? ' that will arc to everything nearby' : ''}.`
    );
  },
});

registerSpell({
  name: 'Lightning Veil',
  words: ['lightning', 'veil'],
  actionType: 'bonus',
  range: 0,
  targeting: 'self',
  dc: 11,
  description:
    'Arc to every ally and enemy within range 6 for 1d3 Fire and turn each hit invisible. Lightning power sets veil duration. A natural 20 hits every other living unit for 20d3 and veils them for 20 turns.',
  visual: { preset: 'nova', color: 0xffef8a, size: R(6), speed: 1.8 },
  async cast(ctx) {
    const power = lightningPower(ctx);
    const targets = ctx.crit
      ? ctx.game.mages.filter((mage) => mage !== ctx.caster && mage.alive)
      : ctx.game.magesInRadius(ctx.caster.pos, R(6), ctx.caster);
    for (const target of targets) {
      await ctx.vfx?.lightningBolt?.(ctx.caster.pos, target.pos);
      dealDamage(
        ctx,
        target,
        dmg(rollDice(ctx, ctx.crit ? '20d3' : '1d3', 'Lightning Veil'), 'heat', 'physical'),
        { canMiss: false }
      );
      if (target.alive) {
        applyInvisibility(ctx, target, {
          duration: ctx.crit ? 20 : Math.max(1, Math.ceil(power / 10)),
          mode: 'full',
        });
      }
    }
    const repeatPool = ctx.crit
      ? ctx.game.mages.filter((mage) => mage.alive)
      : ctx.game.mages.filter(
          (mage) => mage.alive && Math.hypot(mage.x - ctx.caster.x, mage.y - ctx.caster.y) <= R(6)
        );
    const repeats = Math.floor(power / 8) * (ctx.crit ? 2 : 1);
    for (let repeat = 0; repeat < repeats && repeatPool.length > 0; repeat++) {
      const target = ctx.rng.pick(repeatPool);
      await ctx.vfx?.lightningBolt?.(ctx.caster.pos, target.pos);
      dealDamage(
        ctx,
        target,
        dmg(rollDice(ctx, ctx.crit ? '20d3' : '1d3', 'Lightning Veil repeat'), 'heat', 'physical'),
        { canMiss: false }
      );
      if (target.alive) {
        applyInvisibility(ctx, target, {
          duration: ctx.crit ? 20 : Math.max(1, Math.ceil(power / 10)),
          mode: 'full',
        });
      }
    }
  },
});

registerSpell({
  name: 'Fire Pierce',
  words: ['fire', 'pierce'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 11,
  description:
    'At over 7.5 range, dash 6 and apply 2 Fire. At 6.5–7.5, dash 7, explode for 2d4 Fire in range 2, and apply 2 Fire. Below 6.5, dash to the target and deal 1d6 Fire.',
  visual: { preset: 'projectile', color: 0xff6a3d, size: 11, speed: 1.5 },
  cast(ctx) {
    const target = ctx.target;
    if (!target) return;
    const units = Math.hypot(target.x - ctx.caster.x, target.y - ctx.caster.y) / RANGE_UNIT;
    if (units > 7.5) {
      dash(ctx, ctx.caster, { toPoint: target.pos, distance: R(6) });
      applyFireStacks(ctx, target, 2);
      return;
    }
    if (units >= 6.5) {
      dash(ctx, ctx.caster, { toPoint: target.pos, distance: R(7) });
      const explosion = rollDice(ctx, '2d4', 'Fire Pierce explosion');
      for (const entity of ctx.game.magesInRadius(target.pos, R(2))) {
        dealDamage(ctx, entity, dmg(explosion, 'heat', 'physical'), {
          canMiss: false,
          aoe: true,
        });
      }
      applyFireStacks(ctx, target, 2);
      return;
    }
    dash(ctx, ctx.caster, { toPoint: target.pos, distance: R(units) });
    dealDamage(ctx, target, dmg(rollDice(ctx, '1d6', 'Fire Pierce'), 'heat', 'physical'), {
      canMiss: false,
    });
  },
});

registerSpell({
  name: 'Lightning Pierce',
  words: ['lightning', 'pierce'],
  actionType: 'main',
  range: 0,
  targeting: 'self',
  dc: 12,
  description:
    'Use the modified cast roll as range (doubled on a critical). Teleport-dash to each random ally or enemy in range at most once and deal 2d6 Fire; the range halves with every jump. Every jump has a 1/roll misfire chance that deals 2d4 Fire to you and ends the chain.',
  visual: { preset: 'nova', color: 0xffe45c, size: 70, speed: 1.4 },
  async cast(ctx) {
    const power = lightningPower(ctx);
    let range = R(power * (ctx.crit ? 2 : 1));
    const visited = new Set<Mage>();
    while (range >= R(1) && ctx.caster.alive) {
      const candidates = ctx.game.mages.filter(
        (entity) =>
          entity !== ctx.caster &&
          entity.alive &&
          !visited.has(entity) &&
          Math.hypot(entity.x - ctx.caster.x, entity.y - ctx.caster.y) <= range
      );
      if (candidates.length === 0) break;
      if (ctx.rng.chance(1 / Math.max(1, power))) {
        ctx.log(`${ctx.caster.name}'s Lightning Pierce misfires!`);
        dealDamage(ctx, ctx.caster, dmg(rollDice(ctx, ctx.crit ? '4d4' : '2d4', 'Lightning misfire'), 'heat', 'physical'), {
          canMiss: false,
        });
        break;
      }
      const target = ctx.rng.pick(candidates);
      visited.add(target);
      const bolt = ctx.vfx?.lightningBolt?.(ctx.caster.pos, target.pos);
      blinkstep(ctx, ctx.caster, { toPoint: target.pos, distance: range });
      await bolt;
      dealDamage(ctx, target, dmg(rollDice(ctx, '2d6', 'Lightning Pierce') + Math.floor(power / 8), 'heat', 'physical'), {
        canMiss: false,
      });
      range /= 2;
    }
  },
});

registerSpell({
  name: 'Fire Lightning Mind',
  words: ['fire', 'lightning', 'mind'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 14,
  description:
    'Deal roll-scaled Fire to health and sanity, then apply 2–4 Blueflare based on Lightning power (range 15).',
  visual: { preset: 'beam', color: 0x6caeff, size: 13, speed: 1.6 },
  cast(ctx) {
    if (!ctx.target) return;
    const power = lightningPower(ctx);
    const gamble = lightningGamble(ctx);
    const bonus = Math.floor(power / 6);
    const physicalAmount = rollDice(ctx, '1d6', 'Fire Lightning Mind') + bonus;
    dealDamage(ctx, ctx.target, dmg(physicalAmount, 'heat', 'physical'));
    if (gamble === 'overload' && ctx.caster.alive) {
      dealDamage(ctx, ctx.caster, dmg(physicalAmount, 'heat', 'physical'), { canMiss: false });
    }
    if (!ctx.target.alive) return;
    const sanityAmount = rollDice(ctx, '1d6', 'Fire Lightning Mind sanity') + bonus;
    dealDamage(
      ctx,
      ctx.target,
      dmg(sanityAmount, 'heat', 'sanity')
    );
    if (ctx.target.alive) {
      applyBlueflareStacks(ctx, ctx.target, Math.min(4, 2 + Math.floor(power / 12)));
    }
    if (gamble === 'surge') {
      const candidates = ctx.game
        .magesInRadius(
          ctx.target.pos,
          R(Math.min(12, 3 + Math.floor(power / 3))),
          ctx.target
        )
        .filter((mage) => mage !== ctx.caster);
      if (candidates.length > 0) {
        const arcTarget = ctx.rng.pick(candidates);
        ctx.vfx?.lightningBolt?.(ctx.target.pos, arcTarget.pos);
        dealDamage(ctx, arcTarget, dmg(sanityAmount, 'heat', 'sanity'), { canMiss: false });
      }
    }
  },
});

registerSpell({
  name: 'Fire Lightning Veil',
  words: ['fire', 'lightning', 'veil'],
  actionType: 'main',
  range: R(20),
  targeting: 'point',
  dc: 14,
  description:
    'Detonate indiscriminate wildfire storms at departure and arrival, then vanish. Power expands their radius and damage. A natural 20 makes both storms battlefield-wide, self-inclusive 20d6 catastrophes with 20 Fire and a 20-turn veil.',
  visual: { preset: 'nova', color: 0xff8b45, size: R(6), speed: 1.7 },
  async cast(ctx) {
    if (!ctx.targetPoint) return;
    const power = lightningPower(ctx);
    const origin = { ...ctx.caster.pos };
    const storm = async (centre: { x: number; y: number }) => {
      const targets = ctx.crit
        ? ctx.game.mages.filter((mage) => mage.alive)
        : ctx.game.magesInRadius(centre, R(2 + Math.floor(power / 5)), ctx.caster);
      for (const target of targets) {
        await ctx.vfx?.lightningBolt?.(centre, target.pos);
        dealDamage(
          ctx,
          target,
          dmg(
            ctx.crit
              ? rollDice(ctx, '20d6', 'Fire Lightning Veil catastrophe')
              : rollDice(ctx, '2d6', 'Fire Lightning Veil') + Math.floor(power / 4),
            'heat',
            'physical'
          ),
          { canMiss: false, aoe: true }
        );
        if (target.alive) applyFireStacks(ctx, target, ctx.crit ? 20 : 2 + Math.floor(power / 10));
      }
    };
    await storm(origin);
    blinkstep(ctx, ctx.caster, {
      toPoint: ctx.targetPoint,
      distance: R(Math.min(20, power * (ctx.crit ? 2 : 1))),
    });
    await storm(ctx.caster.pos);
    applyInvisibility(ctx, ctx.caster, {
      duration: ctx.crit ? 20 : Math.max(1, Math.ceil(power / 8)),
      mode: 'full',
    });
  },
});

registerSpell({
  name: 'Fire Mind Pierce',
  words: ['fire', 'mind', 'pierce'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'Dash up to range 10 toward an enemy, deal 1d6 Fire to health and sanity, then apply 2 Blueflare.',
  visual: { preset: 'projectile', color: 0xff6680, size: 13, speed: 1.7 },
  cast(ctx) {
    if (!ctx.target) return;
    dash(ctx, ctx.caster, { toPoint: ctx.target.pos, distance: R(10) });
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Fire Mind Pierce'), 'heat', 'physical'), {
      canMiss: false,
    });
    if (!ctx.target.alive) return;
    dealDamage(
      ctx,
      ctx.target,
      dmg(rollDice(ctx, '1d6', 'Fire Mind Pierce sanity'), 'heat', 'sanity'),
      { canMiss: false }
    );
    if (ctx.target.alive) applyBlueflareStacks(ctx, ctx.target, 2);
  },
});

registerSpell({
  name: 'Fire Mind Veil',
  words: ['fire', 'mind', 'veil'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description: 'Apply 3 Blueflare to an enemy and become fully invisible for 2 turns (range 15).',
  visual: { preset: 'beam', color: 0xb57eff, size: 11, speed: 1.5 },
  cast(ctx) {
    if (!ctx.target) return;
    applyBlueflareStacks(ctx, ctx.target, 3);
    applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'full' });
  },
});

registerSpell({
  name: 'Fire Veil Pierce',
  words: ['fire', 'veil', 'pierce'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'Breach up to range 15 into an enemy and erupt for 4d6 Fire against every enemy within range 3, applying 4 Fire. Vanish for 3 turns and kindle a Cinder Veil around yourself.',
  visual: { preset: 'burst', color: 0xff8060, size: R(3), speed: 1.8 },
  cast(ctx) {
    if (!ctx.target) return;
    dash(ctx, ctx.caster, { toPoint: ctx.target.pos, distance: R(15) });
    const blast = rollDice(ctx, '4d6', 'Fire Veil Pierce breach');
    for (const target of ctx.game.magesInRadius(ctx.caster.pos, R(3), ctx.caster)) {
      if (target.team === ctx.caster.team) continue;
      dealDamage(ctx, target, dmg(blast, 'heat', 'physical'), { canMiss: false, aoe: true });
      if (target.alive) applyFireStacks(ctx, target, 4);
    }
    applyInvisibility(ctx, ctx.caster, { duration: 3, mode: 'full' });
    addOrExtendStatus(
      ctx.caster.statuses,
      {
        key: 'aura:fire-veil',
        name: 'Cinder Veil',
        kind: 'fireVeilAura',
        duration: 4,
        radius: R(3),
        ownerIndex: ctx.game.mages.indexOf(ctx.caster),
      },
      false
    );
  },
});

registerSpell({
  name: 'Lightning Mind Pierce',
  words: ['lightning', 'mind', 'pierce'],
  actionType: 'main',
  range: 0,
  targeting: 'self',
  dc: 14,
  description:
    'Chain through random unvisited allies or enemies within Lightning-power range. Each jump deals 1d6 Pierce, 1d6 sanity, and applies 1 Blueflare; the range is divided by 3 each jump.',
  visual: { preset: 'nova', color: 0x65b8ff, size: 76, speed: 1.6 },
  async cast(ctx) {
    const power = lightningPower(ctx);
    let range = R(power * (ctx.crit ? 2 : 1));
    const visited = new Set<Mage>();
    while (range >= R(1) && ctx.caster.alive) {
      const candidates = ctx.game.mages.filter(
        (target) =>
          target !== ctx.caster &&
          target.alive &&
          !visited.has(target) &&
          Math.hypot(target.x - ctx.caster.x, target.y - ctx.caster.y) <= range
      );
      if (candidates.length === 0) break;
      if (ctx.rng.chance(1 / Math.max(1, power))) {
        ctx.log(`${ctx.caster.name}'s neural current folds back into its source!`);
        dealDamage(
          ctx,
          ctx.caster,
          dmg(rollDice(ctx, '1d6', 'Lightning Mind Pierce backlash') + Math.floor(power / 8), 'heat', 'sanity'),
          { canMiss: false }
        );
        break;
      }
      const target = ctx.rng.pick(candidates);
      visited.add(target);
      const bolt = ctx.vfx?.lightningBolt?.(ctx.caster.pos, target.pos);
      blinkstep(ctx, ctx.caster, { toPoint: target.pos, distance: range });
      await bolt;
      const bonus = Math.floor(power / 8);
      dealDamage(ctx, target, dmg(rollDice(ctx, '1d6', 'Lightning Mind Pierce') + bonus, 'pierce', 'physical'), {
        canMiss: false,
      });
      if (target.alive) {
        dealDamage(
          ctx,
          target,
          dmg(rollDice(ctx, '1d6', 'Lightning Mind Pierce sanity') + bonus, 'heat', 'sanity'),
          { canMiss: false }
        );
      }
      if (target.alive) applyBlueflareStacks(ctx, target, 1);
      if (ctx.crit) {
        const forkCandidates = candidates.filter((candidate) => candidate !== target);
        if (forkCandidates.length > 0) {
          const fork = ctx.rng.pick(forkCandidates);
          await ctx.vfx?.lightningBolt?.(target.pos, fork.pos);
          dealDamage(ctx, fork, dmg(rollDice(ctx, '1d6', 'Neural fork') + bonus, 'heat', 'sanity'), {
            canMiss: false,
          });
          if (fork.alive) applyBlueflareStacks(ctx, fork, 1);
          visited.add(fork);
        }
      }
      range /= 3;
    }
  },
});

registerSpell({
  name: 'Lightning Mind Veil',
  words: ['lightning', 'mind', 'veil'],
  actionType: 'main',
  range: R(20),
  targeting: 'point',
  dc: 14,
  description:
    'Tear open indiscriminate sanity storms at departure and arrival, then vanish. Power expands and intensifies both storms. A natural 20 strikes every living unit, including caster, for 20d6 sanity and 20 Blueflare at both sites.',
  visual: { preset: 'nova', color: 0x8fa7ff, size: R(6), speed: 1.7 },
  async cast(ctx) {
    if (!ctx.targetPoint) return;
    const power = lightningPower(ctx);
    const origin = { ...ctx.caster.pos };
    const storm = async (centre: { x: number; y: number }) => {
      const targets = ctx.crit
        ? ctx.game.mages.filter((mage) => mage.alive)
        : ctx.game.magesInRadius(centre, R(3 + Math.floor(power / 5)), ctx.caster);
      for (const target of targets) {
        await ctx.vfx?.lightningBolt?.(centre, target.pos);
        dealDamage(
          ctx,
          target,
          dmg(
            ctx.crit
              ? rollDice(ctx, '20d6', 'Lightning Mind Veil catastrophe')
              : rollDice(ctx, '2d6', 'Lightning Mind Veil') + Math.floor(power / 4),
            'heat',
            'sanity'
          ),
          { canMiss: false, aoe: true }
        );
        if (target.alive) applyBlueflareStacks(ctx, target, ctx.crit ? 20 : 2 + Math.floor(power / 10));
      }
    };
    await storm(origin);
    blinkstep(ctx, ctx.caster, {
      toPoint: ctx.targetPoint,
      distance: R(Math.min(20, power * (ctx.crit ? 2 : 1))),
    });
    await storm(ctx.caster.pos);
    applyInvisibility(ctx, ctx.caster, {
      duration: ctx.crit ? 20 : Math.max(1, Math.ceil(power / 6)),
      mode: 'full',
    });
  },
});

registerSpell({
  name: 'Lightning Veil Pierce',
  words: ['lightning', 'veil', 'pierce'],
  actionType: 'main',
  range: 0,
  targeting: 'self',
  dc: 14,
  description:
    'A stronger Lightning Pierce: chain up to power/3 times (rounded down) into random other allies or enemies with 5 additional range and no misfire, dealing 2d6 Fire each hit. The reach halves after every jump. The bolt always prefers a fresh body; when it has to strike the same mage twice in a row that repeat hit only deals 2d3. The caster cannot be hit. Then roll d6, dash that far, and become invisible for 6 minus the roll turns.',
  visual: { preset: 'nova', color: 0xffc95c, size: 78, speed: 1.5 },
  async cast(ctx) {
    const power = lightningPower(ctx);
    const dashCount = Math.floor(power / 3);
    let range = R((power + 5) * (ctx.crit ? 2 : 1));
    let previous: Mage | null = null;
    for (let dashIndex = 0; dashIndex < dashCount && range >= R(1) && ctx.caster.alive; dashIndex++) {
      const candidates = ctx.game.mages.filter(
        (entity) =>
          entity !== ctx.caster &&
          entity.alive &&
          Math.hypot(entity.x - ctx.caster.x, entity.y - ctx.caster.y) <= range
      );
      if (candidates.length === 0) break;
      const fresh = candidates.filter((entity) => entity !== previous);
      const target = ctx.rng.pick(fresh.length > 0 ? fresh : candidates);
      const repeat = target === previous;
      const bolt = ctx.vfx?.lightningBolt?.(ctx.caster.pos, target.pos);
      blinkstep(ctx, ctx.caster, { toPoint: target.pos, distance: range });
      await bolt;
      const rolled = repeat
        ? rollDice(ctx, '2d3', 'Lightning Veil Pierce repeat')
        : rollDice(ctx, '2d6', 'Lightning Veil Pierce');
      dealDamage(ctx, target, dmg(rolled + Math.floor(power / 8), 'heat', 'physical'), {
        canMiss: false,
      });
      previous = target;
      range /= 2;
    }
    if (!ctx.caster.alive) return;
    const finalRoll = rollDice(ctx, '1d6', 'Lightning Veil Pierce escape', ctx.caster);
    const dashRange = R(finalRoll * (ctx.crit ? 2 : 1));
    const destination = ctx.requestPoint
      ? await ctx.requestPoint({
          maxRange: dashRange,
          origin: ctx.caster.pos,
          prompt: `Lightning Veil Pierce — dash ${finalRoll}${ctx.crit ? ' × 2' : ''}`,
        })
      : null;
    if (destination) dash(ctx, ctx.caster, { toPoint: destination, distance: dashRange });
    const invisibilityTurns = 6 - finalRoll;
    if (invisibilityTurns > 0) {
      applyInvisibility({ ...ctx, crit: false }, ctx.caster, {
        duration: invisibilityTurns,
        mode: 'full',
      });
    }
  },
});

registerSpell({
  name: 'Lightning Fire Pierce',
  words: ['lightning', 'fire', 'pierce'],
  actionType: 'main',
  range: 0,
  targeting: 'self',
  dc: 15,
  description:
    'Dash roll/3 times, starting at roll/3 range and cutting the range by a third with every dash. The chain stops once a dash would be under 2cm (critical doubles the starting range and damage). Choose each direction, then roll d6 accuracy: 1 veers 45° left, 2 veers 22.5° left, 3-4 fly true, 5 veers 22.5° right, 6 veers 45° right. A veer scatters by a further 5° either way. The animated lightning trail deals 4d6 Fire whenever crossed; touching your own earlier trail stops you there and deals 4d6 Fire to you.',
  visual: { preset: 'nova', color: 0xff3d24, size: 80, speed: 1.5 },
  async cast(ctx) {
    const power = lightningPower(ctx);
    const dashCount = Math.max(1, Math.floor(power / 1.5));
    const dashDistance = R((power / 3) * (ctx.crit ? 2 : 1));
    const trail: TrailSegment[] = [];
    try {
      for (let step = 0; step < dashCount && ctx.caster.alive; step++) {
        const currentDashDistance = dashDistance * 0.8 ** step;
        // Too short to be worth a dash; end the chain here.
        if (currentDashDistance < R(2)) break;
        let chosen: Vec2 | null;
        if (ctx.requestPoint) {
          chosen = await ctx.requestPoint({
              maxRange: currentDashDistance,
              origin: ctx.caster.pos,
              prompt: `Lightning Fire Pierce — choose dash ${step + 1}/${dashCount} (range ${Math.round(currentDashDistance / RANGE_UNIT)})`,
            });
        } else {
          const fallbackAngle = ctx.rng.float() * Math.PI * 2;
          chosen = {
            x: ctx.caster.x + Math.cos(fallbackAngle) * currentDashDistance,
            y: ctx.caster.y + Math.sin(fallbackAngle) * currentDashDistance,
          };
        }
        if (!chosen) break;
        const accuracy = rollDice(ctx, '1d6', 'Lightning dash accuracy', ctx.caster);
        // Settle the accuracy die before the body moves, or it reads as landing
        // at the same time as the damage the dash goes on to deal.
        await ctx.resolveImpacts?.();
        // Screen y grows downward, so a positive offset veers right of the aim.
        const deflection = [-45, -22.5, 0, 0, 22.5, 45][accuracy - 1];
        // Drawn on every face so the RNG sequence cannot depend on the roll.
        const jitter = (ctx.rng.float() * 2 - 1) * 5;
        const veer = deflection === 0 ? 0 : deflection + jitter;
        const aimedAngle = Math.atan2(chosen.y - ctx.caster.y, chosen.x - ctx.caster.x);
        const angle = aimedAngle + veer * (Math.PI / 180);
        const from = { ...ctx.caster.pos };
        const intended = {
          x: Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, from.x + Math.cos(angle) * currentDashDistance)),
          y: Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, from.y + Math.sin(angle) * currentDashDistance)),
        };
        const collision = firstTrailCollision(from, intended, trail);
        dash(ctx, ctx.caster, {
          toPoint: collision ?? intended,
          distance: collision
            ? Math.hypot(collision.x - from.x, collision.y - from.y)
            : currentDashDistance,
        });
        const segment = { from, to: { ...ctx.caster.pos } };
        trail.push(segment);
        ctx.vfx?.lightningTrail?.(trail);
        await ctx.vfx?.lightningDash?.(segment.from, segment.to, RED_TRAIL_COLOR);
        for (const entity of ctx.game.mages) {
          if (entity === ctx.caster || !entity.alive || !segmentHitsMage(segment, entity)) continue;
          ctx.vfx?.lightningImpact?.(entity.pos, RED_TRAIL_COLOR);
          dealDamage(ctx, entity, dmg(rollDice(ctx, '4d6', 'Red lightning trail', entity) + Math.floor(power / 5), 'heat', 'physical'), {
            canMiss: false,
          });
        }
        if (collision) {
          ctx.log(`${ctx.caster.name} crosses the red trail and the spell collapses!`);
          await ctx.vfx?.lightningCrash?.(segment.to, RED_TRAIL_COLOR);
          dealDamage(ctx, ctx.caster, dmg(rollDice(ctx, '4d6', 'Red trail collision', ctx.caster) + Math.floor(power / 5), 'heat', 'physical'), {
            canMiss: false,
          });
          break;
        }
        await ctx.resolveImpacts?.();
      }
    } finally {
      ctx.vfx?.clearLightningTrail?.();
    }
  },
});


// ===========================================================================
//  ADDITIONAL FIRE / LIGHTNING COMBOS
//  Cheat-code words Fire and Lightning paired with every standard word, plus
//  the Fire/Lightning/Veil/Pierce/Bind three-word set (Bind standing in for
//  Mind, since Mind's three-word slots with this set are already covered).
// ===========================================================================

registerSpell({
  name: 'Fire Shatter',
  words: ['fire', 'shatter'],
  actionType: 'main',
  range: R(5),
  targeting: 'point',
  dc: 12,
  aoe: { kind: 'cone', radius: R(5), degrees: CONE_DEGREES },
  description:
    '1d6 shatter damage to everything in a 90° cone (range 5), and apply 1 Fire to each enemy hit.',
  visual: { preset: 'burst', color: 0xff6a3d, size: 62, speed: 1.2 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const amount = rollDice(ctx, '1d6', 'Fire Shatter');
    const hits = coneDamage(ctx, ctx.targetPoint, R(5), CONE_DEGREES, dmg(amount, 'shatter', 'physical'));
    for (const h of hits) applyFireStacks(ctx, h, 1);
  },
});

registerSpell({
  name: 'Fire Corrode',
  words: ['fire', 'corrode'],
  actionType: 'bonus',
  range: R(10),
  targeting: 'point',
  dc: 11,
  aoe: { kind: 'circle', radius: R(1.6) },
  description:
    '1d6 corrosive damage to all enemies in a small area (radius 1.6, range 10), and apply 1 Fire to each hit.',
  visual: { preset: 'burst', color: 0xd9a23b, size: 60, speed: 1 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const amount = rollDice(ctx, '1d6', 'Fire Corrode');
    const hits = areaDamage(ctx, ctx.targetPoint, R(1.6), dmg(amount, 'corrosive', 'physical'));
    for (const m of hits) applyFireStacks(ctx, m, 1);
  },
});

registerSpell({
  name: 'Fire Shadow',
  words: ['fire', 'shadow'],
  actionType: 'main',
  range: R(15),
  targeting: 'point',
  dc: 11,
  aoe: { kind: 'circle', radius: R(2) },
  description:
    'At a point (range 15), every enemy within range 2 takes 1d6 Fire and gains 1 Fire, then leave a shadow pool there for 5 turns.',
  visual: { preset: 'burst', color: 0xd6602a, size: 58, speed: 1.1 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const amount = rollDice(ctx, '1d6', 'Fire Shadow');
    const hits = areaDamage(ctx, ctx.targetPoint, R(2), dmg(amount, 'heat', 'physical'), { canMiss: false });
    for (const m of hits) applyFireStacks(ctx, m, 1);
    placeShadow(ctx, ctx.targetPoint, 5);
  },
});

registerSpell({
  name: 'Fire Curse',
  words: ['fire', 'curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 11,
  description:
    'Curse one enemy (range 15): 1d3 heat damage each turn for 4 turns, and apply 2 Fire immediately.',
  visual: { preset: 'beam', color: 0xff7a45, size: 6, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    applyDot(ctx, ctx.target, {
      name: 'Fire Curse',
      duration: 4,
      damage: dmg(2, 'heat', 'physical'),
      damageSpec: '1d3',
    });
    applyFireStacks(ctx, ctx.target, 2);
  },
});

registerSpell({
  name: 'Fire Bind',
  words: ['fire', 'bind'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 12,
  description:
    '1d6 heat damage to one enemy (range 15), root it (movement stun) for 3 turns, and apply 2 Fire.',
  visual: { preset: 'projectile', color: 0xff5a36, size: 11, speed: 1.4 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Fire Bind'), 'heat', 'physical'));
    if (!ctx.target.alive) return;
    applyStun(ctx, ctx.target, { duration: 3, type: 'movement' });
    applyFireStacks(ctx, ctx.target, 2);
  },
});

registerSpell({
  name: 'Lightning Shatter',
  words: ['lightning', 'shatter'],
  actionType: 'main',
  range: R(3),
  targeting: 'enemy',
  dc: 12,
  description:
    'A thunderclap at close quarters (range 3). One enemy takes 2d6 shatter and is fully stunned for 2 turns. Up to one further unit per 5 Lightning power, within power ÷ 2 cm of it and on either side, takes 1d3 shatter and is stunned as well. On a Lightning power under 6 the clap turns inward and stuns you instead of any of them — and you are standing in melee range when it does.',
  visual: { preset: 'nova', color: 0xffe45c, size: R(3), speed: 1.9 },
  cast(ctx) {
    if (!ctx.target) return;
    const power = lightningRoll(ctx);
    const backfired = power < 6;
    const splash = ctx.game
      .magesInRadius(ctx.target.pos, lightningRange(ctx, power / 2), ctx.target)
      .filter((m) => m !== ctx.caster)
      .slice(0, Math.floor(power / 5));
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '2d6', 'Lightning Shatter'), 'shatter', 'physical'));
    if (!backfired && ctx.target.alive) applyStun(ctx, ctx.target, { duration: 2, type: 'full' });
    for (const body of splash) {
      if (!body.alive) continue;
      dealDamage(ctx, body, dmg(rollDice(ctx, '1d3', 'Lightning Shatter'), 'shatter', 'physical'), {
        canMiss: false,
        aoe: true,
      });
      if (!backfired && body.alive) applyStun(ctx, body, { duration: 2, type: 'full' });
    }
    if (backfired) {
      ctx.log('The clap turns inward.');
      applyStun(ctx, ctx.caster, { duration: 2, type: 'full' });
    }
  },
});

registerSpell({
  name: 'Lightning Corrode',
  words: ['lightning', 'corrode'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 12,
  description:
    'Deal 1d6 corrosive to one enemy. The charge then splits twice, each wave firing all at once: every arc from the target to everything within power ÷ 2 cm, then every arc from all of those at half that reach. The second wave re-crosses bodies the web already holds. One 1d3 corrosive roll is made per wave and it lands once for EVERY arc that reaches a body. Allies conduct it too. The paths fuse into a single field of corrosion for 3 rounds that deals 1d3 to anything standing on it, however many lines overlap there.',
  visual: { preset: 'beam', color: 0xc7e85c, size: 9, speed: 1.8 },
  async cast(ctx) {
    if (!ctx.target) return;
    const power = lightningRoll(ctx);
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Lightning Corrode'), 'corrosive', 'physical'));
    const indexOf = (m: Mage) => ctx.game.mages.indexOf(m);
    // Deterministic, so both peers of an online match derive the same field.
    const groupId = ctx.game.turnSeq * 64 + indexOf(ctx.caster);
    const burnt = new Set<string>();
    let frontier: Mage[] = [ctx.target];
    let units = power / 2;
    // Always exactly two waves; the roll decides their reach, never their count.
    for (let wave = 0; wave < 2 && frontier.length > 0; wave++) {
      const reach = lightningRange(ctx, units);
      const arcs: { from: Mage; to: Mage }[] = [];
      for (const node of frontier) {
        for (const body of ctx.game.mages) {
          if (!body.alive || body === node || body === ctx.caster) continue;
          if (Math.hypot(body.x - node.x, body.y - node.y) > reach) continue;
          arcs.push({ from: node, to: body });
        }
      }
      if (arcs.length === 0) break;
      // The whole wave leaps at the same instant rather than one arc at a time.
      await Promise.all(
        arcs.map((arc) => ctx.vfx?.lightningBolt?.(arc.from.pos, arc.to.pos) ?? Promise.resolve())
      );
      for (const arc of arcs) {
        // One line per pair of bodies, however many times the web crosses it.
        const key = [indexOf(arc.from), indexOf(arc.to)].sort((a, b) => a - b).join('-');
        if (burnt.has(key) || burnt.size >= 40) continue;
        burnt.add(key);
        placeHazardZone(ctx, { ...arc.from.pos }, {
          name: 'Corrosion Scar',
          to: { ...arc.to.pos },
          radius: R(0.6),
          rounds: 3,
          damageSpecs: ['1d3'],
          damageType: 'corrosive',
          color: 0xc7e85c,
          groupId,
        });
      }
      // A single roll for the wave, but every arc that lands deals it again.
      const bite = rollDice(ctx, '1d3', 'Lightning Corrode wave');
      for (const arc of arcs) {
        if (!arc.to.alive) continue;
        dealDamage(ctx, arc.to, dmg(bite, 'corrosive', 'physical'), { canMiss: false, aoe: true });
      }
      frontier = [...new Set(arcs.map((arc) => arc.to))].filter((m) => m.alive);
      units /= 2;
    }
  },
});

registerSpell({
  name: 'Lightning Shadow',
  words: ['lightning', 'shadow'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 12,
  description:
    'A bolt that arcs through anything, ally or enemy, never the same body twice. Its reach is Lightning power in cm and halves with every jump. Each hit deals 2d6 split evenly between shadow and heat, and drowns the ground beneath it in shadow — and every pool the storm lays adds another 1d6 shadow to every hit that follows.',
  visual: { preset: 'beam', color: 0x9b7bff, size: 10, speed: 1.7 },
  async cast(ctx) {
    if (!ctx.target) return;
    const power = lightningRoll(ctx);
    let units = power;
    let current: Mage | null = ctx.target;
    let from = ctx.caster.pos;
    const struck = new Set<Mage>();
    let laid = 0;
    while (current && units >= 1) {
      await ctx.vfx?.lightningBolt?.(from, current.pos);
      const roll = rollDice(ctx, '2d6', 'Lightning Shadow');
      const dark = Math.ceil(roll / 2);
      dealDamage(ctx, current, dmg(dark, 'shadow', 'physical'), { canMiss: false });
      if (current.alive) {
        dealDamage(ctx, current, dmg(roll - dark, 'heat', 'physical'), { canMiss: false });
      }
      // Every pool already laid feeds the storm one more die.
      if (laid > 0 && current.alive) {
        dealDamage(
          ctx,
          current,
          dmg(rollDice(ctx, `${laid}d6`, 'Lightning Shadow — gathered dark'), 'shadow', 'physical'),
          { canMiss: false }
        );
      }
      const spot = { ...current.pos };
      placeShadow(ctx, spot);
      laid += 1;
      struck.add(current);
      from = spot;
      units /= 2;
      if (units < 1) break;
      const reach = lightningRange(ctx, units);
      const candidates = ctx.game.mages.filter(
        (m) =>
          m.alive && m !== ctx.caster && !struck.has(m) && Math.hypot(m.x - from.x, m.y - from.y) <= reach
      );
      current = candidates.length > 0 ? ctx.rng.pick(candidates) : null;
    }
  },
});

registerSpell({
  name: 'Lightning Curse',
  words: ['lightning', 'curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'any',
  dc: 12,
  description:
    'Make one unit a conductor for 3 turns — an enemy, or an ally you are willing to spend. Every time it is wounded, a share of that wound arcs onward to the nearest bodies within power ÷ 3 cm: one body per 8 Lightning power, each taking power ÷ 20 of the damage as heat. At full power the storm passes on everything it receives.',
  visual: { preset: 'beam', color: 0xffc95c, size: 8, speed: 1.5 },
  cast(ctx) {
    const target = ctx.target ?? ctx.caster;
    const power = lightningRoll(ctx);
    applyStormConduit(ctx, target, {
      duration: 3,
      maxTargets: Math.max(1, Math.ceil(power / 8)),
      radius: lightningRange(ctx, power / 3),
      sharePct: power / 20,
    });
  },
});

registerSpell({
  name: 'Lightning Bind',
  words: ['lightning', 'bind'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 12,
  description:
    'A bolt that arcs through anything, ally or enemy, never the same body twice. Its reach is Lightning power in cm and halves with every jump. Each hit deals 1d6 heat and roots whatever it touches for 3 turns.',
  visual: { preset: 'beam', color: 0x6ad1ff, size: 8, speed: 1.6 },
  async cast(ctx) {
    if (!ctx.target) return;
    const power = lightningRoll(ctx);
    let units = power;
    let current: Mage | null = ctx.target;
    let from = ctx.caster.pos;
    const struck = new Set<Mage>();
    while (current && units >= 1) {
      await ctx.vfx?.lightningBolt?.(from, current.pos);
      dealDamage(ctx, current, dmg(rollDice(ctx, '1d6', 'Lightning Bind'), 'heat', 'physical'), {
        canMiss: false,
      });
      if (current.alive) applyStun(ctx, current, { duration: 3, type: 'movement' });
      struck.add(current);
      from = current.pos;
      units /= 2;
      if (units < 1) break;
      const reach = lightningRange(ctx, units);
      const candidates = ctx.game.mages.filter(
        (m) =>
          m.alive && m !== ctx.caster && !struck.has(m) && Math.hypot(m.x - from.x, m.y - from.y) <= reach
      );
      current = candidates.length > 0 ? ctx.rng.pick(candidates) : null;
    }
  },
});

// ---------------------------------------------------------------------------
//  THREE-WORD BIND VARIANTS
//  The cheat set {Fire, Lightning, Veil, Mind, Pierce} already has all ten of
//  its 3-word combinations implemented above. These swap Mind for the
//  standard word Bind wherever Mind actually appeared in one of those ten,
//  giving the remaining six combinations of {Fire, Lightning, Veil, Bind, Pierce}.
// ---------------------------------------------------------------------------

registerSpell({
  name: 'Fire Lightning Bind',
  words: ['fire', 'lightning', 'bind'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 14,
  description:
    'Deal 1d6 plus 1 damage per 5 Lightning power (range 15), apply up to 3 Fire based on that power, and root the target (movement stun) for 3 turns plus 1 per 10 power (max 6).',
  visual: { preset: 'beam', color: 0xff9d36, size: 13, speed: 1.6 },
  cast(ctx) {
    if (!ctx.target) return;
    const power = lightningPower(ctx);
    const amount = rollDice(ctx, '1d6', 'Fire Lightning Bind') + Math.floor(power / 5);
    dealDamage(ctx, ctx.target, dmg(amount, 'heat', 'physical'));
    if (!ctx.target.alive) return;
    applyFireStacks(ctx, ctx.target, Math.min(3, 1 + Math.floor(power / 10)));
    applyStun(ctx, ctx.target, { duration: Math.min(6, 3 + Math.floor(power / 10)), type: 'movement' });
  },
});

registerSpell({
  name: 'Lightning Veil Bind',
  words: ['lightning', 'veil', 'bind'],
  actionType: 'main',
  range: R(20),
  targeting: 'point',
  dc: 14,
  description:
    'Root enemies within range 3 of your departure (movement stun), blink by Lightning power, repeat at arrival, then become invisible.',
  visual: { preset: 'burst', color: 0x8fa7ff, size: R(3), speed: 1.7 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const power = lightningPower(ctx);
    const origin = { ...ctx.caster.pos };
    for (const target of ctx.game.magesInRadius(origin, R(3), ctx.caster)) {
      if (target.team !== ctx.caster.team) applyStun(ctx, target, { duration: 2, type: 'movement' });
    }
    blinkstep(ctx, ctx.caster, {
      toPoint: ctx.targetPoint,
      distance: R(Math.min(20, power * (ctx.crit ? 2 : 1))),
    });
    for (const target of ctx.game.magesInRadius(ctx.caster.pos, R(3), ctx.caster)) {
      if (target.team !== ctx.caster.team) applyStun(ctx, target, { duration: 2, type: 'movement' });
    }
    applyInvisibility(ctx, ctx.caster, {
      duration: Math.max(1, Math.ceil(power / 8)),
      mode: 'full',
    });
  },
});

registerSpell({
  name: 'Lightning Bind Pierce',
  words: ['lightning', 'bind', 'pierce'],
  actionType: 'main',
  range: 0,
  targeting: 'self',
  dc: 14,
  description:
    'Chain through random unvisited allies or enemies within Lightning-power range. Each jump deals 1d6 pierce damage and roots the target (movement stun) for 2 turns; the range is divided by 3 each jump.',
  visual: { preset: 'nova', color: 0x8ad1ff, size: 76, speed: 1.6 },
  async cast(ctx) {
    const power = lightningPower(ctx);
    let range = R(power * (ctx.crit ? 2 : 1));
    const visited = new Set<Mage>();
    while (range >= R(1) && ctx.caster.alive) {
      const candidates = ctx.game.mages.filter(
        (target) =>
          target !== ctx.caster &&
          target.alive &&
          !visited.has(target) &&
          Math.hypot(target.x - ctx.caster.x, target.y - ctx.caster.y) <= range
      );
      if (candidates.length === 0) break;
      const target = ctx.rng.pick(candidates);
      visited.add(target);
      const bolt = ctx.vfx?.lightningBolt?.(ctx.caster.pos, target.pos);
      blinkstep(ctx, ctx.caster, { toPoint: target.pos, distance: range });
      await bolt;
      dealDamage(ctx, target, dmg(rollDice(ctx, '1d6', 'Lightning Bind Pierce'), 'pierce', 'physical'), {
        canMiss: false,
      });
      if (target.alive) applyStun(ctx, target, { duration: 2, type: 'movement' });
      range /= 3;
    }
  },
});

registerSpell({
  name: 'Lightning Shatter Pierce',
  words: ['lightning', 'shatter', 'pierce'],
  actionType: 'main',
  range: Infinity,
  targeting: 'point',
  dc: 14,
  description:
    'Become the bolt. Charge in a straight line for Lightning power in cm, punching through bodies instead of stopping at them. Everything you pass takes power ÷ 4 d6 pierce and is fully stunned for 2 turns, allies included. The charge grows less stable with every body it crosses: after each one, roll 1d6 — if it comes up at or under the number you have already pierced, the charge blows out inside you. You stop there, take that same damage yourself and are stunned for 2 turns.',
  visual: { preset: 'nova', color: 0xffe45c, size: 70, speed: 1.9 },
  async cast(ctx) {
    if (!ctx.targetPoint) return;
    const power = lightningRoll(ctx);
    const spec = `${Math.max(1, Math.floor(power / 4))}d6`;
    const angle = Math.atan2(ctx.targetPoint.y - ctx.caster.y, ctx.targetPoint.x - ctx.caster.x);
    const from = { ...ctx.caster.pos };
    const to = {
      x: from.x + Math.cos(angle) * lightningRange(ctx, power),
      y: from.y + Math.sin(angle) * lightningRange(ctx, power),
    };
    const lane: TrailSegment = { from, to };
    // Bodies in the order the charge reaches them, so the risk builds correctly.
    const speared = ctx.game.mages
      .filter(
        (m) =>
          m !== ctx.caster &&
          m.alive &&
          pointSegmentDistance(m.pos, lane) <= m.bodyRadius() + R(0.5)
      )
      .sort(
        (a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y)
      );
    ctx.vfx?.lightningBolt?.(from, to);
    let pierced = 0;
    for (const body of speared) {
      dealDamage(ctx, body, dmg(rollDice(ctx, spec, 'Lightning Shatter Pierce'), 'pierce', 'physical'), {
        canMiss: false,
        aoe: true,
      });
      if (body.alive) applyStun(ctx, body, { duration: 2, type: 'full' });
      pierced += 1;
      if (rollDice(ctx, '1d6', 'Lightning Shatter Pierce — instability') > pierced) continue;
      ctx.log(`The charge blows out inside ${ctx.caster.name} after ${pierced} bodies.`);
      blinkstep(ctx, ctx.caster, { toPoint: body.pos, distance: lightningRange(ctx, power) });
      dealDamage(ctx, ctx.caster, dmg(rollDice(ctx, spec, 'Lightning Shatter Pierce — blowout'), 'pierce', 'physical'), {
        canMiss: false,
      });
      if (ctx.caster.alive) applyStun(ctx, ctx.caster, { duration: 2, type: 'full' });
      return;
    }
    // Punches through bodies and barriers alike; only the field edge stops it.
    blinkstep(ctx, ctx.caster, { toPoint: to, distance: lightningRange(ctx, power) });
  },
});

registerSpell({
  name: 'Lightning Shadow Pierce',
  words: ['lightning', 'shadow', 'pierce'],
  actionType: 'main',
  range: Infinity,
  targeting: 'point',
  dc: 14,
  description:
    'Drown yourself in a shadow of radius equal to Lightning power in cm, then pick a direction and ricochet around the inside of it. Every wall you strike has a 20% chance to shatter the shadow; when it breaks you shoot off in whatever direction you were last travelling for another power cm. Anything you pass over, ally or enemy, takes power ÷ 5 shadow damage each time. When you finally stop, you have a 10% chance per bounce of tearing yourself apart for power ÷ 5 d3 — ten bounces and it is certain.',
  visual: { preset: 'nova', color: 0x9b7bff, size: 70, speed: 1.7 },
  async cast(ctx) {
    if (!ctx.targetPoint) return;
    const power = lightningRoll(ctx);
    const centre = { ...ctx.caster.pos };
    const radius = Math.max(R(2), Math.min(lightningRange(ctx, power), Math.min(FIELD.w, FIELD.h) / 2));
    const pool = ctx.game.addShadow(centre, ctx.caster.team);
    pool.radius = radius;
    ctx.log(`${ctx.caster.name} drowns the ground in a ${Math.round(radius / RANGE_UNIT)}cm shadow.`);

    const grazed = Math.max(1, Math.floor(power / 5));
    let dir = Math.atan2(ctx.targetPoint.y - centre.y, ctx.targetPoint.x - centre.x);
    let at = { ...centre };
    let bounces = 0;
    let broken = false;

    const sweep = async (to: Vec2) => {
      const leg: TrailSegment = { from: { ...at }, to };
      for (const body of ctx.game.mages) {
        if (body === ctx.caster || !body.alive) continue;
        if (pointSegmentDistance(body.pos, leg) > body.bodyRadius()) continue;
        dealDamage(ctx, body, dmg(grazed, 'shadow', 'physical'), { canMiss: false, aoe: true });
      }
      blinkstep(ctx, ctx.caster, { toPoint: to, distance: Math.hypot(to.x - at.x, to.y - at.y) + 1 });
      at = { ...ctx.caster.pos };
      await ctx.resolveImpacts?.();
    };

    // Each wall has a 1-in-5 chance of releasing you, so this always terminates.
    for (let step = 0; step < 30 && !broken && ctx.caster.alive; step++) {
      // Where the ray from `at` along `dir` leaves the disc.
      const ox = at.x - centre.x;
      const oy = at.y - centre.y;
      const dx = Math.cos(dir);
      const dy = Math.sin(dir);
      const b = ox * dx + oy * dy;
      const c = ox * ox + oy * oy - radius * radius;
      const t = -b + Math.sqrt(Math.max(0, b * b - c));
      if (!Number.isFinite(t) || t <= 0.5) break;
      await sweep({ x: at.x + dx * t, y: at.y + dy * t });
      bounces += 1;
      if (ctx.rng.chance(0.2)) {
        broken = true;
        break;
      }
      // Reflect around the disc's normal at the point of impact.
      const nx = (at.x - centre.x) / radius;
      const ny = (at.y - centre.y) / radius;
      const dot = dx * nx + dy * ny;
      dir = Math.atan2(dy - 2 * dot * ny, dx - 2 * dot * nx);
    }

    if (broken && ctx.caster.alive) {
      ctx.log('The shadow shatters and flings its passenger clear.');
      ctx.game.shadows = ctx.game.shadows.filter((s) => s.id !== pool.id);
      const out = lightningRange(ctx, power);
      await sweep({ x: at.x + Math.cos(dir) * out, y: at.y + Math.sin(dir) * out });
    }
    ctx.log(`${ctx.caster.name} ricochets ${bounces} time${bounces === 1 ? '' : 's'}.`);
    if (bounces > 0 && ctx.caster.alive && ctx.rng.chance(Math.min(1, bounces / 10))) {
      ctx.log('The ride tears its rider apart.');
      dealDamage(
        ctx,
        ctx.caster,
        dmg(rollDice(ctx, `${grazed}d3`, 'Lightning Shadow Pierce — whiplash'), 'shadow', 'physical'),
        { canMiss: false }
      );
    }
  },
});

registerSpell({
  name: 'Fire Veil Bind',
  words: ['fire', 'veil', 'bind'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'Root an enemy (movement stun) for 4 turns and apply 3 Fire, then become fully invisible for 2 turns (range 15).',
  visual: { preset: 'beam', color: 0xff8060, size: 11, speed: 1.5 },
  cast(ctx) {
    if (!ctx.target) return;
    applyStun(ctx, ctx.target, { duration: 4, type: 'movement' });
    applyFireStacks(ctx, ctx.target, 3);
    applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'full' });
  },
});

registerSpell({
  name: 'Fire Bind Pierce',
  words: ['fire', 'bind', 'pierce'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'Dash up to range 10 toward an enemy, deal 1d6 Fire, root it (movement stun) for 3 turns, then apply 2 Fire.',
  visual: { preset: 'projectile', color: 0xff6a55, size: 13, speed: 1.6 },
  cast(ctx) {
    if (!ctx.target) return;
    dash(ctx, ctx.caster, { toPoint: ctx.target.pos, distance: R(10) });
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Fire Bind Pierce'), 'heat', 'physical'), {
      canMiss: false,
    });
    if (!ctx.target.alive) return;
    applyStun(ctx, ctx.target, { duration: 3, type: 'movement' });
    applyFireStacks(ctx, ctx.target, 2);
  },
});

registerSpell({
  name: 'Veil Bind Pierce',
  words: ['veil', 'bind', 'pierce'],
  actionType: 'main',
  range: 0,
  targeting: 'any',
  dc: 4,
  description:
    'Repeatedly roll a d6. On each new result, teleport to a point within range 4 (ignoring roots and barriers), then deal 1d3 pierce damage and root (movement stun, 1 turn) an enemy within range 5. Each teleport lets enemies react. The first time a number repeats, you turn fully invisible for 2 turns and the spell ends.',
  visual: { preset: 'nova', color: 0x9ad1ff, size: 60, speed: 1.3 },
  async cast(ctx) {
    const seen = new Set<number>();
    // A d6 can yield at most 6 distinct values, so a repeat is forced by the
    // 7th roll — the loop is bounded and always terminates.
    for (let i = 0; i < 6; i++) {
      const roll = rollDice(ctx, '1d6', 'Veil Bind Pierce');
      if (seen.has(roll)) {
        applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'full' });
        ctx.log(`${ctx.caster.name} glimpses a familiar number and vanishes completely.`);
        return;
      }
      seen.add(roll);
      // Blink to a point within R(4), then strike an enemy within R(5) of it.
      const point = ctx.requestPoint
        ? await ctx.requestPoint({
            maxRange: R(4),
            origin: ctx.caster.pos,
            prompt: `${ctx.caster.name}: blink to a point (R4) — roll ${roll}.`,
          })
        : ctx.caster.pos;
      const center = point ?? ctx.caster.pos;
      // A teleport, not a physical dash — unaffected by roots, shatter zones, etc.
      blinkstep(ctx, ctx.caster, { toPoint: center, distance: R(4) });
      // Each blink is its own step: opponents may react at this exact timing.
      await ctx.reactionWindow?.('Veil Bind Pierce — blink', ctx.caster.pos);
      if (!ctx.caster.alive) return;
      const foe = ctx.requestEnemy
        ? await ctx.requestEnemy({
            range: R(5),
            origin: ctx.caster.pos,
            prompt: `${ctx.caster.name}: strike an enemy within R5 of the mark.`,
          })
        : enemyNear(ctx, ctx.caster.pos, R(5));
      if (foe) {
        dealDamage(ctx, foe, dmg(rollDice(ctx, '1d3', 'Veil Bind Pierce'), 'pierce', 'physical'));
        if (foe.alive) applyStun(ctx, foe, { duration: 1, type: 'movement' });
        // Show the strike land (dice + hit animation) before the next d6 roll.
        await ctx.resolveImpacts?.();
      }
    }
    applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'full' });
  },
});

registerSpell({
  name: 'Drain',
  words: ['drain'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 7,
  description:
    '1d6 corrosive damage (range 10) that heals you for the full amount dealt.',
  visual: { preset: 'projectile', color: 0x57d6a0, size: 10, speed: 1.5 },
  manualCastVisual: true,
  cast(ctx) {
    if (!ctx.target) return;
    drainDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Drain'), 'corrosive', 'physical'));
  },
});

registerSpell({
  name: 'Drain Curse',
  words: ['drain', 'curse'],
  actionType: 'bonus',
  range: R(5),
  targeting: 'point',
  dc: 11,
  aoe: { kind: 'circle', radius: R(3) },
  description:
    'Place a totem (aimed within range 5). Each turn it deals 1d3 corrosive damage to enemies within range 3 of it and heals you for the damage dealt.',
  visual: { preset: 'burst', color: 0x57d6a0, size: 50, speed: 1 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    placeTotem(ctx, ctx.targetPoint, { radius: R(3), damageSpec: '1d3', slow: 0, lifesteal: true });
  },
});

registerSpell({
  name: 'Shadow Drain',
  words: ['shadow', 'drain'],
  actionType: 'main',
  range: R(10),
  bonusRangeInOwnShadow: R(99),
  targeting: 'enemy',
  dc: 11,
  description:
    '1d6 corrosive damage + 2d6 shadow damage to one enemy (range 10), healing you for the full amount dealt. If the target is standing in one of your shadow pools, you can hit it from anywhere on the field.',
  visual: { preset: 'projectile', color: 0x57d6a0, size: 11, speed: 1.4 },
  manualCastVisual: true,
  cast(ctx) {
    if (!ctx.target) return;
    drainDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Shadow Drain'), 'corrosive', 'physical'));
    drainDamage(ctx, ctx.target, dmg(rollDice(ctx, '2d6', 'Shadow Drain'), 'shadow', 'physical'));
  },
});

registerSpell({
  name: 'Curse Drain Corrode',
  words: ['curse', 'drain', 'corrode'],
  actionType: 'main',
  range: R(5),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'circle', radius: R(5) },
  description:
    'Summon 5 scarabs around a point (range 5). Each turn they move toward the nearest enemy (up to 3 per enemy, staying within range 8 of you), bite for 1d3, then return to heal you for 1d3. Each scarab has 5 health and 5 sanity and can be killed by area effects.',
  visual: { preset: 'burst', color: 0x57d6a0, size: 70, speed: 1.1 },
  manualCastVisual: true,
  // CLASS SPELL (all verbs). Currently hard-wired to the Life alignment (summon);
  // future Objects / Hexcraft variants plug in through byClass().
  cast(ctx) {
    if (!ctx.targetPoint) return;
    summonScarabs(ctx, ctx.targetPoint);
  },
});

// ===========================================================================
//  GEN EASTER-EGG SPELLS   (words: Order / Curse / Drain / Slash)
// ---------------------------------------------------------------------------
//  Order is the white color word. Several of these spells describe exotic
//  battlefield-command mechanics (target-locking, action-mirroring) that the
//  engine cannot fully model; those are approximated with the closest existing
//  primitives (stuns, debuffs, control labels, DoTs) and noted inline.
// ===========================================================================

registerSpell({
  name: 'Slash',
  words: ['slash'],
  actionType: 'main',
  range: R(5),
  targeting: 'point',
  dc: 7,
  aoe: { kind: 'cone', radius: R(5), degrees: 100 },
  description:
    '1d8 slashing damage in a 100° cone (range 5), then dash 2 in the aimed direction.',
  visual: { preset: 'burst', color: 0xffe08a, size: 60, speed: 1.3 },
  manualCastVisual: true,
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const amount = rollDice(ctx, '1d8', 'Slash');
    slashCone(ctx, ctx.targetPoint, R(5));
    coneDamage(ctx, ctx.targetPoint, R(5), 100, dmg(amount, 'slashing', 'physical'));
    dash(ctx, ctx.caster, { toPoint: ctx.targetPoint, distance: R(2) });
  },
});

registerSpell({
  name: 'Order',
  words: ['order'],
  actionType: 'main',
  range: R(20),
  targeting: 'any',
  dc: 7,
  description:
    'Target an ally or enemy (range 20). Enemy: disarmed for 1 turn (cannot take main actions). ' +
    'Ally: for 2 turns it deals +2 damage and gains +2 movement.',
  visual: { preset: 'beam', color: 0xf3ecd2, size: 6, speed: 1.1 },
  manualCastVisual: true,
  cast(ctx) {
    const target = ctx.target ?? ctx.caster;
    ctx.vfx?.sigil?.(target.pos, target.team === ctx.caster.team ? 0xf3ecd2 : 0xd8c9a0, 96);
    if (target.team !== ctx.caster.team) {
      // ENEMY: "cannot take hostile actions for 1 turn". Approximated with a
      // main-action disarm (they keep move + non-attack options); the engine
      // cannot distinguish self/ally-only spells, so a full main-stun is used.
      applyStun(ctx, target, { duration: 1, type: 'main' });
    } else {
      // ALLY / SELF: the true buff (+25% dmg & healing, +25% movespeed toward
      // enemies, but locked to the caster's chosen target) is simplified to a
      // flat empowerment; target-locking/retargeting flow is not modelled.
      applyDebuff(ctx, target, {
        name: 'Emboldened',
        key: 'buff:order',
        duration: 2,
        mods: { damageDealt: 2, moveRange: R(2) },
      });
    }
  },
});

registerSpell({
  name: 'Curse Slash',
  words: ['curse', 'slash'],
  actionType: 'main',
  range: R(5),
  targeting: 'point',
  dc: 10,
  aoe: { kind: 'cone', radius: R(5), degrees: 120 },
  description:
    '1d8 slashing damage in a 120° cone (range 5). Every enemy hit gains a bleed stack that deals 1d3 per stack each turn (stacks up to 6), lasting 3 turns.',
  visual: { preset: 'burst', color: 0xff6b8a, size: 64, speed: 1.2 },
  manualCastVisual: true,
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const amount = rollDice(ctx, '1d8', 'Curse Slash');
    slashCone(ctx, ctx.targetPoint, R(5));
    const hits = coneDamage(ctx, ctx.targetPoint, R(5), 120, dmg(amount, 'slashing', 'physical'));
    for (const h of hits) {
      applyStackingDot(ctx, h, {
        name: 'Bleed',
        key: 'dot:bleed',
        damage: dmg(0, 'slashing', 'physical'),
        perStackSpec: '1d3',
        maxStacks: 6,
        refreshDuration: 3,
      });
    }
  },
});

registerSpell({
  name: 'Slash Drain',
  words: ['drain', 'slash'],
  actionType: 'main',
  range: R(5),
  targeting: 'point',
  dc: 11,
  aoe: { kind: 'cone', radius: R(5), degrees: 80 },
  description:
    '80° cone (range 5). Enemies in the narrow 5° center take 1d8 slashing damage and you dash 2 toward them; enemies elsewhere in the cone take 1d6 corrosive damage. All damage heals you for the amount dealt.',
  visual: { preset: 'burst', color: 0x9ad67a, size: 66, speed: 1.2 },
  manualCastVisual: true,
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const p = ctx.targetPoint;
    slashCone(ctx, p, R(5));
    const inner = ctx.game
      .magesInCone(ctx.caster.pos, p, R(5), 5, ctx.caster)
      .filter((m) => m.team !== ctx.caster.team);
    const outer = ctx.game
      .magesInCone(ctx.caster.pos, p, R(5), 80, ctx.caster)
      .filter((m) => m.team !== ctx.caster.team);
    const innerSet = new Set(inner);
    for (const m of outer) {
      if (innerSet.has(m)) {
        // Core enemies take slashing + lifesteal (no corrosive), per the spec.
        drainDamage(ctx, m, dmg(rollDice(ctx, '1d8', 'Slash Drain'), 'slashing', 'physical'), {
          aoe: true,
        });
      } else {
        drainDamage(ctx, m, dmg(rollDice(ctx, '1d6', 'Slash Drain'), 'corrosive', 'physical'), {
          aoe: true,
        });
      }
    }
    if (inner.length > 0) dash(ctx, ctx.caster, { toPoint: p, distance: R(2) });
  },
});

registerSpell({
  name: 'Order Curse',
  words: ['curse', 'order'],
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 11,
  description:
    'For 5 turns the target is forced to repeat its actions and deals 2 less damage (range 20).',
  visual: { preset: 'beam', color: 0xc9a0ff, size: 6, speed: 1.1 },
  manualCastVisual: true,
  cast(ctx) {
    if (!ctx.target) return;
    ctx.vfx?.sigil?.(ctx.target.pos, 0xc9a0ff, 104);
    // "Can only attack targets you targeted last turn" is not enforceable by the
    // engine; represented as a control label plus a damage-sapping debuff.
    applyControl(ctx, ctx.target, { name: 'Ordered', mode: 'repeat', duration: 5 });
    applyDebuff(ctx, ctx.target, {
      name: 'Ordered',
      key: 'debuff:ordered',
      duration: 5,
      mods: { damageDealt: -2 },
    });
  },
});

registerSpell({
  name: 'Order Slash',
  words: ['order', 'slash'],
  actionType: 'main',
  range: R(5),
  targeting: 'point',
  dc: 11,
  aoe: { kind: 'cone', radius: R(5), degrees: 120 },
  description:
    '1d8 slashing damage in a 120° cone (range 5). Every enemy hit is forced to repeat its action for 2 turns.',
  visual: { preset: 'burst', color: 0xf3d08a, size: 64, speed: 1.2 },
  manualCastVisual: true,
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const amount = rollDice(ctx, '1d8', 'Order Slash');
    slashCone(ctx, ctx.targetPoint, R(5));
    const hits = coneDamage(ctx, ctx.targetPoint, R(5), 120, dmg(amount, 'slashing', 'physical'));
    for (const h of hits) {
      // The "must hit a target you specify" compulsion is labelled as control;
      // the engine does not enforce the forced target choice.
      applyControl(ctx, h, { name: 'Commanded', mode: 'repeat', duration: 2 });
    }
  },
});

registerSpell({
  name: "Order's Due",
  words: ['drain', 'order'],
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 11,
  description:
    'For 4 rounds, whenever an enemy explicitly targets you or an ally, it first takes 1d6 corrosive damage and you heal for the damage dealt.',
  visual: { preset: 'nova', color: 0x9ad67a, size: 46, speed: 1.1 },
  cast(ctx) {
    ctx.vfx?.sigil?.(ctx.caster.pos, 0x9ad67a, 120);
    ctx.game.addOrderDrainCurse(ctx.caster, 4);
  },
});

// ---------------------------------------------------------------------------
//  GEN 3-WORD SPELLS
// ---------------------------------------------------------------------------

registerSpell({
  name: 'Order Curse Drain',
  words: ['order', 'curse', 'drain'],
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 13,
  description:
    'Curse one enemy for 4 turns (range 20). It is forced to repeat its actions. Each turn it takes ' +
    '1d6 corrosive damage — plus another 1d6 if it dealt no damage last turn — and you heal for all of it. ' +
    'Whenever it damages one of your allies, the curse lasts 2 turns longer.',
  visual: { preset: 'beam', color: 0x9ad67a, size: 7, speed: 1.1 },
  manualCastVisual: true,
  cast(ctx) {
    if (!ctx.target) return;
    ctx.vfx?.sigil?.(ctx.target.pos, 0x9ad67a, 112);
    const ownerIndex = ctx.game.mages.indexOf(ctx.caster);
    // The action-lock ("only repeat the next action, never forgotten, walking
    // legal") is labelled as a compulsion; the engine does not fully enforce the
    // restriction, but the draining curse below is modelled faithfully.
    applyControl(ctx, ctx.target, { name: 'Ordered', mode: 'repeat', duration: 4 });
    applyDot(ctx, ctx.target, {
      name: "Order's Drain",
      key: 'dot:order-curse-drain',
      duration: 4,
      damage: dmg(0, 'corrosive', 'physical'),
      damageSpec: '1d6',
      bonusNoDamageSpec: '1d6',
      lifestealToIndex: ownerIndex,
      extendOwnerTeam: ctx.caster.team,
    });
  },
});

registerSpell({
  name: 'Curse Drain Slash',
  words: ['curse', 'drain', 'slash'],
  actionType: 'main',
  range: R(5),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'cone', radius: R(5), degrees: 120 },
  description:
    '1d6 slashing damage then 1d6 corrosive damage in a 120° cone (range 5). Every enemy hit gains 2 ' +
    'bleed stacks (1d3 per stack each turn). You then heal 1d3 for each bleed stack on those enemies.',
  visual: { preset: 'burst', color: 0xd66a9a, size: 66, speed: 1.2 },
  manualCastVisual: true,
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const slash = rollDice(ctx, '1d6', 'Curse Drain Slash');
    slashCone(ctx, ctx.targetPoint, R(5));
    const hits = coneDamage(ctx, ctx.targetPoint, R(5), 120, dmg(slash, 'slashing', 'physical'));
    let leech = 0;
    for (const h of hits) {
      dealDamage(ctx, h, dmg(rollDice(ctx, '1d6', 'Curse Drain Slash'), 'corrosive', 'physical'), {
        aoe: true,
      });
      // Two stacks of bleed (one call per stack).
      for (let i = 0; i < 2; i++) {
        applyStackingDot(ctx, h, {
          name: 'Bleed',
          key: 'dot:bleed',
          damage: dmg(0, 'slashing', 'physical'),
          perStackSpec: '1d3',
          maxStacks: 6,
          refreshDuration: 3,
        });
      }
      const bleed = h.statuses.find((s) => s.key === 'dot:bleed') as DotStatus | undefined;
      const stacks = bleed?.stacks ?? 0;
      let targetLeech = 0;
      for (let i = 0; i < stacks; i++) {
        targetLeech += rollDice(ctx, '1d3', 'Curse Drain Slash — leech');
      }
      leech += targetLeech;
      if (targetLeech > 0) ctx.vfx?.drainParticles?.(h.pos, ctx.caster.pos);
    }
    if (leech > 0) heal(ctx, ctx.caster, leech);
  },
});

registerSpell({
  name: 'Order Drain Slash',
  words: ['drain', 'order', 'slash'],
  actionType: 'main',
  range: R(5),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'cone', radius: R(5), degrees: 120 },
  description:
    'Every enemy in a 120° cone (range 5) is set to the lowest HP among them. ' +
    'You heal for the largest amount of HP removed from any single enemy, then dash 2 toward them.',
  visual: { preset: 'nova', color: 0x8ad0c4, size: 60, speed: 1.1 },
  manualCastVisual: true,
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const p = ctx.targetPoint;
    slashCone(ctx, p, R(5));
    ctx.vfx?.sigil?.(p, 0x8ad0c4, 108);
    const foes = ctx.game
      .magesInCone(ctx.caster.pos, p, R(5), 120, ctx.caster)
      .filter((m) => m.alive && m.team !== ctx.caster.team);
    if (foes.length > 0) {
      const minHp = Math.min(...foes.map((f) => f.hp));
      let mostEqualized = 0;
      for (const f of foes) {
        if (f.hp > minHp) {
          const removed = f.hp - minHp;
          mostEqualized = Math.max(mostEqualized, removed);
          f.hp = minHp;
          ctx.vfx?.hit?.(f);
          ctx.vfx?.spellEffect?.(f, 'corrosive');
          ctx.vfx?.drainParticles?.(f.pos, ctx.caster.pos);
        }
      }
      ctx.log(`${ctx.caster.name} equalizes the cone to ${minHp} HP.`);
      if (mostEqualized > 0) heal(ctx, ctx.caster, mostEqualized);
    }
    dash(ctx, ctx.caster, { toPoint: p, distance: R(2) });
  },
});

registerSpell({
  name: 'Order Curse Slash',
  words: ['curse', 'order', 'slash'],
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 13,
  description:
    'Bind an enemy and name an entity it must engage (range 20). On each of its next 3 turns it ' +
    'gains a stack for failing to move toward that entity and a stack for failing to attack it. ' +
    'After the third turn it is dealt 2d3 slashing for every stack.',
  visual: { preset: 'beam', color: 0xf3d08a, size: 7, speed: 1.1 },
  manualCastVisual: true,
  async cast(ctx) {
    if (!ctx.target) return;
    const enemy = ctx.target;
    ctx.vfx?.sigil?.(enemy.pos, 0xf3d08a, 104);
    // Pick the "target entity" the enemy must chase and strike. Any mage is a
    // legal choice, so take a point and snap to the nearest mage to it.
    const point = ctx.requestPoint
      ? await ctx.requestPoint({
          maxRange: R(99),
          origin: ctx.caster.pos,
          prompt: 'Name the entity the enemy must engage',
        })
      : null;
    let entity: Mage | null = null;
    if (point) {
      let best = Infinity;
      for (const m of ctx.game.mages) {
        if (!m.alive) continue;
        const d = (m.pos.x - point.x) ** 2 + (m.pos.y - point.y) ** 2;
        if (d < best) {
          best = d;
          entity = m;
        }
      }
    }
    // Headless / no selection: default to the caster ("come at me").
    if (!entity) entity = ctx.caster;
    // A second mark names the entity, so the pairing is readable on the field.
    ctx.vfx?.sigil?.(entity.pos, 0xffe08a, 88);
    applyOrderJudgment(ctx, enemy, entity, { evals: 3, perStackSpec: '2d3' });
  },
});

// ===========================================================================
//  FINN'S ADDITIONS — 3-WORD SPELLS   (set: 'finns')
//  Only available when Finn's Additions is enabled on the start screen.
// ===========================================================================

// ---------------------------------------------------------------------------
//  VEIL + MIND + BIND   —   Foreseen Snare
//  Reaction capstone for all three reaction-granting words.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Foreseen Snare',
  words: ['veil', 'mind', 'bind'],
  set: 'finns',
  actionType: 'bonus',
  range: 0,
  targeting: 'any',
  dc: 13,
  reaction: true,
  description:
    'Gain a full veil for 2 turns (often dodging the triggering attack), root the nearest enemy within range 12 for 2 turns, and mark it (no reactions and +2 damage taken on its next turn). Can be cast as a reaction but does not counter the action.',
  visual: { preset: 'nova', color: 0xb98bff, size: 60, speed: 1.1 },
  cast(ctx) {
    applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'full' });
    const foe = enemyNear(ctx, ctx.caster.pos, R(12));
    if (foe) {
      applyStun(ctx, foe, { duration: 2, type: 'movement' });
      applyControl(ctx, foe, { name: 'Foreseen', mode: 'expose', duration: 2 });
      applyDebuff(ctx, foe, { name: 'Foreseen', duration: 2, mods: { damageTaken: 2 } });
    }
  },
});

// ---------------------------------------------------------------------------
//  VEIL + SHADOW + MIND   —   Ghostwalk
//  Utility capstone: vanish, blink to a shadow, mark the nearest foe.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Ghostwalk',
  words: ['veil', 'shadow', 'mind'],
  set: 'finns',
  actionType: 'bonus',
  range: 0,
  targeting: 'self',
  dc: 12,
  description:
    'Turn fully invisible for 2 turns and teleport to your nearest shadow pool. The nearest enemy within range 10 is marked (no reactions and +2 damage taken on its next turn). With no shadow on the field, you turn invisible where you stand.',
  visual: { preset: 'nova', color: 0x8a6bff, size: 60, speed: 1.2 },
  cast(ctx) {
    applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'full' });
    const pools = ctx.game.shadowsOf(ctx.caster.team);
    if (pools.length > 0) {
      let best = pools[0];
      for (const s of pools) {
        if (
          Math.hypot(s.x - ctx.caster.x, s.y - ctx.caster.y) <
          Math.hypot(best.x - ctx.caster.x, best.y - ctx.caster.y)
        )
          best = s;
      }
      blinkstep(ctx, ctx.caster, { toPoint: { x: best.x, y: best.y }, distance: 99999 });
    }
    const foe = enemyNear(ctx, ctx.caster.pos, R(10));
    if (foe) {
      applyControl(ctx, foe, { name: 'Foreseen', mode: 'expose', duration: 2 });
      applyDebuff(ctx, foe, { name: 'Foreseen', duration: 2, mods: { damageTaken: 2 } });
    }
  },
});

// ---------------------------------------------------------------------------
//  SHADOW + MIND + PIERCE   —   Umbral Lance
//  Dash-and-blink hunt: dash for the kill, then chain through shadow pools.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Umbral Lance',
  words: ['shadow', 'mind', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: 0,
  targeting: 'self',
  dc: 13,
  description:
    'Place a shadow pool beneath you (counts as already used). Then teleport to any shadow pool you have not used yet: if an enemy is within range 7, dash onto it for 1d6 shadow damage + 1d3 sanity damage, then optionally dash up to range 10 in any direction. If you land in another unused shadow pool you can repeat. Ends when no enemy is within range 7 or your dash stops outside an unused shadow pool.',
  visual: { preset: 'nova', color: 0x9b7bff, size: 56, speed: 1.4 },
  async cast(ctx) {
    const used = new Set<number>();

    // Step 1: spawn a shadow beneath the caster — it counts as already used
    // (you cannot blink back into the pool you started on).
    placeShadow(ctx, { x: ctx.caster.x, y: ctx.caster.y });
    const spawned = unusedShadowAt(ctx, ctx.caster.pos, used);
    if (spawned) used.add(spawned.id);

    // Each iteration blinks to a fresh shadow (consuming it), so the field
    // drains and the loop is bounded; the guard caps it beyond any pool count.
    for (let step = 0; step < 24; step++) {
      if (!ctx.caster.alive) return;

      // Step 2a: blink to a shadow not yet teleported to (instant, no animation).
      const click = ctx.requestPoint
        ? await ctx.requestPoint({
            maxRange: Math.hypot(FIELD.w, FIELD.h),
            origin: ctx.caster.pos,
            prompt: `${ctx.caster.name}: blink to an unused shadow — Esc to end.`,
          })
        : null;
      if (!click) return;
      const pool = unusedShadowAt(ctx, click, used);
      if (!pool) return;
      used.add(pool.id);
      teleport(ctx, ctx.caster, { x: pool.x, y: pool.y });

      // Step 2b: target an enemy within R7. None in reach → the spell ends.
      const foe = ctx.requestEnemy
        ? await ctx.requestEnemy({
            range: R(7),
            origin: ctx.caster.pos,
            prompt: `${ctx.caster.name}: strike an enemy within R7 — Esc to end.`,
          })
        : enemyNear(ctx, ctx.caster.pos, R(7));
      if (!foe) return;

      // Dash onto the marked enemy (regular roll animation) and lance them.
      dash(ctx, ctx.caster, { toPoint: foe.pos, distance: R(7) });
      await ctx.reactionWindow?.('Umbral Lance — dash', ctx.caster.pos);
      if (!ctx.caster.alive) return;
      dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Umbral Lance'), 'shadow', 'physical'));
      dealDamage(ctx, foe, dmg(rollDice(ctx, '1d3', 'Umbral Lance'), 'shadow', 'sanity'));
      await ctx.resolveImpacts?.();
      if (!ctx.caster.alive) return;

      // Step 2c: an optional R10 dash in any direction.
      const reposition = ctx.requestPoint
        ? await ctx.requestPoint({
            maxRange: R(10),
            origin: ctx.caster.pos,
            prompt: `${ctx.caster.name}: dash up to R10 in any direction — Esc to end.`,
          })
        : null;
      if (!reposition) return;
      dash(ctx, ctx.caster, { toPoint: reposition, distance: R(10) });
      await ctx.reactionWindow?.('Umbral Lance — dash', ctx.caster.pos);
      if (!ctx.caster.alive) return;

      // Step 3: land in a fresh shadow to repeat Step 2, otherwise the spell ends.
      if (!unusedShadowAt(ctx, ctx.caster.pos, used)) return;
    }
  },
});

// ---------------------------------------------------------------------------
//  SHATTER + MIND + PIERCE   —   Skullpierce
//  Precise burst with an execute threshold.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Skullpierce',
  words: ['shatter', 'mind', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 15,
  description:
    '2d6 pierce damage + 1d6 sanity damage to one enemy (range 12). If this leaves it below a quarter of its HP or sanity, deal an extra 3d6 true pierce damage (ignores armor and resistances).',
  visual: { preset: 'projectile', color: 0xffb0e0, size: 11, speed: 1.9 },
  cast(ctx) {
    if (!ctx.target) return;
    const foe = ctx.target;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Skullpierce'), 'pierce', 'physical'));
    dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Skullpierce'), 'shadow', 'sanity'));
    if (foe.alive && (foe.hp <= foe.maxHp * 0.25 || foe.sanity <= foe.maxSanity * 0.25)) {
      ctx.log(`${foe.name} is broken open — the lance finds the crack.`);
      dealDamage(ctx, foe, dmg(rollDice(ctx, '3d6', 'Skullpierce — execute'), 'pierce', 'physical'), {
        trueDamage: true,
        canMiss: false,
      });
    }
  },
});

// ---------------------------------------------------------------------------
//  SHATTER + SHADOW + VEIL   —   Null Pulse
//  Anti-stealth burst: strips all veils, conjures a shadow, you vanish.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Null Pulse',
  words: ['shatter', 'shadow', 'veil'],
  set: 'finns',
  actionType: 'main',
  range: 0,
  targeting: 'any',
  dc: 13,
  aoe: { kind: 'circle', radius: R(4) },
  description:
    '1d6 shatter damage to every enemy within range 4. Remove all veils on the field, place a shadow pool at your feet, then gain a full veil for 2 turns.',
  visual: { preset: 'nova', color: 0xff8be0, size: 70, speed: 1.3 },
  cast(ctx) {
    areaDamage(
      ctx,
      ctx.caster.pos,
      R(4),
      dmg(rollDice(ctx, '1d6', 'Null Pulse'), 'shatter', 'physical'),
      { canMiss: false }
    );
    for (const m of ctx.game.mages) dispelVeil(ctx, m);
    placeShadow(ctx, ctx.caster.pos);
    applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'full' });
  },
});

// ---------------------------------------------------------------------------
//  SHATTER + MIND + BIND   —   Mind Fracture
//  Heavy close-range combo; grants an extra turn if the target's mind breaks.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Mind Fracture',
  words: ['shatter', 'mind', 'bind'],
  set: 'finns',
  actionType: 'main',
  range: R(4),
  targeting: 'enemy',
  dc: 14,
  description:
    '2d4 shatter damage + 2d4 sanity damage to one enemy (range 4) and root it for 3 turns. If this leaves it below a quarter of its sanity, you gain an extra turn.',
  visual: { preset: 'conjure', color: 0xff8be0, size: 40, speed: 1.3 },
  cast(ctx) {
    if (!ctx.target) return;
    const foe = ctx.target;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d4', 'Mind Fracture'), 'shatter', 'physical'));
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d4', 'Mind Fracture'), 'shadow', 'sanity'));
    applyStun(ctx, foe, { duration: 3, type: 'movement' });
    if (foe.alive && foe.sanity <= foe.maxSanity * 0.25) {
      ctx.log(`${foe.name}'s mind shatters — the surge carries ${ctx.caster.name} forward.`);
      grantExtraTurn(ctx, ctx.caster);
    }
  },
});

// ---------------------------------------------------------------------------
//  SHADOW + CORRODE + PIERCE   —   Venomfang
//  Blinkstep to nearest shadow, then fire a heavy corrosive lance.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Venomfang',
  words: ['shadow', 'corrode', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  description:
    'Teleport to the nearest shadow pool, then deal 2d6 corrosive damage + 1d6 shadow damage to one enemy (range 12). With no shadow on the field, you stay where you are and deal only the corrosive damage.',
  visual: { preset: 'projectile', color: 0xa8d88a, size: 11, speed: 1.8 },
  cast(ctx) {
    if (!ctx.target) return;
    const pools = ctx.game.shadowsOf(ctx.caster.team);
    if (pools.length === 0) {
      ctx.log(`${ctx.caster.name} finds no shadow to strike from — the fang bites shallow.`);
      dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '2d6', 'Venomfang'), 'corrosive', 'physical'));
      return;
    }
    let best = pools[0];
    for (const s of pools) {
      if (
        Math.hypot(s.x - ctx.caster.x, s.y - ctx.caster.y) <
        Math.hypot(best.x - ctx.caster.x, best.y - ctx.caster.y)
      )
        best = s;
    }
    blinkstep(ctx, ctx.caster, { toPoint: { x: best.x, y: best.y }, distance: 99999 });
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '2d6', 'Venomfang'), 'corrosive', 'physical'));
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Venomfang'), 'shadow', 'physical'));
  },
});

// ---------------------------------------------------------------------------
//  SHATTER + VEIL + CURSE   —   Dreambreaker
//  Nightmare cone that strips veils and seeds sanity rot.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Dreambreaker',
  words: ['shatter', 'veil', 'curse'],
  set: 'finns',
  actionType: 'main',
  range: R(6),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'cone', radius: R(6), degrees: CONE_DEGREES },
  description:
    '1d6 shatter damage to every enemy in a 90° cone (range 6). Veiled enemies lose their veil and take an extra 1d6. Every enemy hit also takes 1d3 sanity damage each turn for 3 turns.',
  visual: { preset: 'burst', color: 0xff7bb0, size: 60, speed: 1.2 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const hits = coneDamage(
      ctx,
      ctx.targetPoint,
      R(6),
      CONE_DEGREES,
      dmg(rollDice(ctx, '1d6', 'Dreambreaker'), 'shatter', 'physical')
    );
    for (const m of hits) {
      if (m.isInvisible() || m.statuses.some((s) => s.kind === 'shadowVeil')) {
        dealDamage(
          ctx,
          m,
          dmg(rollDice(ctx, '1d6', 'Dreambreaker — nightmare'), 'shatter', 'physical'),
          { canMiss: false }
        );
        dispelVeil(ctx, m);
      }
      applyDot(ctx, m, {
        name: 'Nightmare',
        duration: 3,
        damage: dmg(2, 'shadow', 'sanity'),
        damageSpec: '1d3',
      });
    }
  },
});

// ---------------------------------------------------------------------------
//  SHADOW + BIND + CURSE   —   Grasping Dark
//  Zone prison: root + curse DoT inside a persistent shadow.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Grasping Dark',
  words: ['shadow', 'bind', 'curse'],
  set: 'finns',
  actionType: 'main',
  range: R(10),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'circle', radius: R(3) },
  description:
    'At a point (range 10), every enemy within range 3 is rooted for 3 turns and takes 1d3 shadow damage each turn for 4 turns. Leaves a shadow pool there for 5 turns.',
  visual: { preset: 'burst', color: 0x7a5bd0, size: 60, speed: 1.1 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const hits = ctx.game
      .magesInRadius(ctx.targetPoint, R(3), ctx.caster)
      .filter((m) => m.team !== ctx.caster.team && m.alive);
    for (const m of hits) {
      applyStun(ctx, m, { duration: 3, type: 'movement' });
      applyDot(ctx, m, {
        name: 'Grasping Dark',
        duration: 4,
        damage: dmg(2, 'shadow', 'physical'),
        damageSpec: '1d3',
      });
    }
    placeShadow(ctx, ctx.targetPoint, 5);
  },
});

// ---------------------------------------------------------------------------
//  BIND + CORRODE + CURSE   —   Rotting Shackles
//  Hard lock + stacking DoT; zero burst, pure attrition.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Rotting Shackles',
  words: ['bind', 'corrode', 'curse'],
  set: 'finns',
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 12,
  description:
    'Root one enemy for 4 turns (range 15) and apply a stacking corrosive rot. Each cast adds a stack (up to 4); it deals 1d2 corrosive per stack each turn (so 1d2, 2d2, 3d2, 4d2). The rot ends two turns after the last stack is applied; casting again at 4 stacks only refreshes it.',
  visual: { preset: 'beam', color: 0x9be870, size: 6, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    applyStun(ctx, ctx.target, { duration: 4, type: 'movement' });
    applyStackingDot(ctx, ctx.target, {
      name: 'Rotting Shackles',
      damage: dmg(1, 'corrosive', 'physical'),
      perStackSpec: '1d2',
      maxStacks: 4,
      refreshDuration: 3,
    });
  },
});

// ===========================================================================
//  DIMIR FAITHFUL DLC SPELLS   (set: 'dlc')
// ===========================================================================

/** Caster-team shadow nearest to `at`, if the team owns one. */
function ownShadowNear(ctx: EffectContext, at: Vec2): Vec2 | null {
  const pools = ctx.game.shadowsOf(ctx.caster.team);
  if (pools.length === 0) return null;
  let best = pools[0];
  for (const pool of pools) {
    if (
      Math.hypot(pool.x - at.x, pool.y - at.y) < Math.hypot(best.x - at.x, best.y - at.y)
    ) best = pool;
  }
  return { x: best.x, y: best.y };
}

// ---------------------------------------------------------------------------
//  BIND + SHADOW + MIND
//  Chain a mind to the dark: dragged in every turn, then judged on where it
//  landed — swallowed costs it a word, stranded costs it sanity.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Chain of the Drowned Mind',
  words: ['bind', 'shadow', 'mind'],
  set: 'dlc',
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  description:
    'Range 12. Root for 3 turns and anchor the target to your nearest shadow. At the start of each of its turns: drag it 5cm toward the anchor, then check its position. Inside one of your shadows it forgets 1 random word or action for the turn. Outside, it takes 1d4 sanity. If you own no shadow, one is created under the target.',
  visual: { preset: 'beam', color: 0x8a6bff, size: 8, speed: 1.1 },
  cast(ctx) {
    if (!ctx.target) return;
    let anchor = ownShadowNear(ctx, ctx.target.pos);
    if (!anchor) {
      placeShadow(ctx, ctx.target.pos, 4);
      anchor = { ...ctx.target.pos };
    }
    addOrExtendStatus(
      ctx.target.statuses,
      {
        key: 'shadowAnchor',
        name: 'Chained to the Dark',
        kind: 'shadowAnchor',
        duration: critScale(ctx, 3),
        x: anchor.x,
        y: anchor.y,
        ownerIndex: ctx.game.mages.indexOf(ctx.caster),
        ownerTeam: ctx.caster.team,
        pullPx: R(5),
      },
      false
    );
    ctx.log(`${ctx.target.name} is chained to the dark.`);
  },
});

// ---------------------------------------------------------------------------
//  BIND + SHADOW + SHATTER
//  Shatter the ground into a sealed cage around a shadow. Nothing crosses —
//  including you.
// ---------------------------------------------------------------------------
const CAGE_SEGMENTS = 8;

registerSpell({
  name: 'Sealing Cage',
  words: ['bind', 'shadow', 'shatter'],
  set: 'dlc',
  actionType: 'main',
  range: R(10),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'circle', radius: R(4) },
  description:
    'Shatter the ground into a sealed ring of reality breaks, radius 4, for 3 rounds — nothing crosses it, including you. Every enemy caught inside takes 2d6 shatter as the walls slam up, and a shadow pool opens at its centre.',
  visual: { preset: 'burst', color: 0xffd166, size: R(4), speed: 1.2 },
  noCastSprite: true,
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const centre = { ...ctx.targetPoint };
    const radius = critScale(ctx, R(4));
    areaDamage(
      ctx,
      centre,
      radius,
      dmg(rollDice(ctx, '2d6', 'Sealing Cage'), 'shatter', 'physical'),
      { canMiss: false }
    );
    // Regular polygon of wall segments; each is over-long so the corners overlap.
    const apothem = radius * Math.cos(Math.PI / CAGE_SEGMENTS);
    const side = 2 * radius * Math.sin(Math.PI / CAGE_SEGMENTS);
    for (let i = 0; i < CAGE_SEGMENTS; i++) {
      const outward = (i / CAGE_SEGMENTS) * Math.PI * 2;
      placeWall(
        ctx,
        { x: centre.x + Math.cos(outward) * apothem, y: centre.y + Math.sin(outward) * apothem },
        { angle: outward + Math.PI / 2, length: side * 1.25, thickness: 10, ttl: 3 }
      );
    }
    placeShadow(ctx, centre, 4);
  },
});

// ---------------------------------------------------------------------------
//  BIND + SHADOW + PIERCE
//  Sink a hook and reel: the victim is dragged in every turn and paves your
//  shadow network with its own retreat.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Reeling Hook',
  words: ['bind', 'shadow', 'pierce'],
  set: 'dlc',
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'Range 15. Root for 3 turns. At the start of each of the target\u2019s turns: pull it 4cm toward you, deal 1d6 pierce, and create one of your shadow pools where it stops. Being pulled into a wall or the field edge adds 2d6 shatter.',
  visual: { preset: 'beam', color: 0xfffbe0, size: 8, speed: 1.6 },
  cast(ctx) {
    if (!ctx.target) return;
    const duration = critScale(ctx, 3);
    applyStun(ctx, ctx.target, { duration, type: 'movement' });
    addOrExtendStatus(
      ctx.target.statuses,
      {
        key: 'shadowHook',
        name: 'Hooked',
        kind: 'shadowHook',
        duration,
        ownerIndex: ctx.game.mages.indexOf(ctx.caster),
        ownerTeam: ctx.caster.team,
        pullPx: R(4),
        damageSpec: '1d6',
        shadowTtl: 3,
      },
      false
    );
    ctx.log(`${ctx.caster.name}'s hook bites into ${ctx.target.name}.`);
  },
});

// ---------------------------------------------------------------------------
//  BIND + SHADOW + CORRODE
//  The dark grows hungry: every pool you own swallows what stands in it, and
//  each meal makes it wider and more caustic.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Hungering Dark',
  words: ['bind', 'shadow', 'corrode'],
  set: 'dlc',
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 13,
  description:
    'For 3 rounds, every shadow you own damages enemies. An enemy starting its turn in one of your pools is rooted for 1 turn and takes 1d3 shadow, plus 1d3 corrosive per enemy that pool has already consumed. Each consumption widens the pool by 1cm. Each pool may consume at most 2 enemies per round.',
  visual: { preset: 'nova', color: 0x9be870, size: 64, speed: 1.1 },
  cast(ctx) {
    ctx.game.feedingDarks.push({
      ownerIndex: ctx.game.mages.indexOf(ctx.caster),
      ownerTeam: ctx.caster.team,
      roundsLeft: critScale(ctx, 3),
    });
    if (ctx.game.shadowsOf(ctx.caster.team).length === 0) placeShadow(ctx, ctx.caster.pos, 4);
    ctx.log(`${ctx.caster.name}'s shadows begin to hunger.`);
  },
});

// ---------------------------------------------------------------------------
//  BIND + MIND + CURSE
//  Obey and rot; break free and bleed; ride it out and carry the rot anyway.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Sworn Repetition',
  words: ['bind', 'mind', 'curse'],
  set: 'dlc',
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  description:
    'Range 12. The target must repeat its last action for 4 turns. Each turn it repeats successfully, gain 1 stack: -1 damage dealt and +1 damage taken per stack, cumulative. If it fails to repeat, it takes 1d6 sanity per stack and the effect ends. If it survives all 4 turns, it takes no damage but the stacks remain for 2 more turns.',
  visual: { preset: 'beam', color: 0xff9f6b, size: 7, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    const duration = critScale(ctx, 4);
    applyControl(ctx, ctx.target, { name: 'Compelled', mode: 'repeat', duration });
    addOrExtendStatus(
      ctx.target.statuses,
      {
        key: 'swornRepetition',
        name: 'Sworn Repetition',
        kind: 'swornRepetition',
        duration,
        ownerIndex: ctx.game.mages.indexOf(ctx.caster),
        stacks: 0,
        perStackSpec: 'd6',
        lingerTurns: 2,
        lingering: false,
      },
      false
    );
    ctx.log(`${ctx.target.name} is sworn to repeat itself.`);
  },
});

// ---------------------------------------------------------------------------
//  BIND + MIND + PIERCE
//  Three dashes sew a thread through everyone you clip; afterwards they all
//  share every wound any of them takes.
// ---------------------------------------------------------------------------
const THREAD_DASHES = 3;
/** Slack around the dash line so a body clipped in passing still counts. */
const THREAD_CLIP = 12;

registerSpell({
  name: 'Threaded Run',
  words: ['bind', 'mind', 'pierce'],
  set: 'dlc',
  actionType: 'main',
  range: 0,
  targeting: 'self',
  dc: 13,
  description:
    'Dash 3 times, up to 5cm each. Every enemy you pass through is marked and rooted for 3 turns and takes 1d3 sanity. While marked, damage dealt to any marked enemy also deals 50% of that amount to every other marked enemy as sanity damage.',
  visual: { preset: 'nova', color: 0xffb0e0, size: 58, speed: 1.6 },
  async cast(ctx) {
    const threaded = new Set<Mage>();
    for (let step = 0; step < THREAD_DASHES && ctx.caster.alive; step++) {
      const chosen = await ctx.requestPoint?.({
        maxRange: R(5),
        origin: ctx.caster.pos,
        prompt: `Bind Mind Pierce — dash ${step + 1}/${THREAD_DASHES} (Esc to stop)`,
      });
      if (!chosen) break;
      const from = { ...ctx.caster.pos };
      dash(ctx, ctx.caster, { toPoint: chosen, distance: R(5) });
      for (const foe of ctx.game.mages) {
        if (foe === ctx.caster || !foe.alive || foe.team === ctx.caster.team) continue;
        if (threaded.has(foe)) continue;
        if (pointSegmentDistance(foe.pos, { from, to: ctx.caster.pos }) > foe.bodyRadius() + THREAD_CLIP) continue;
        threaded.add(foe);
        dealDamage(ctx, foe, dmg(rollDice(ctx, '1d3', 'Threaded Run'), 'shadow', 'sanity'), {
          canMiss: false,
        });
        if (!foe.alive) continue;
        applyStun(ctx, foe, { duration: 3, type: 'movement' });
        addOrExtendStatus(
          foe.statuses,
          {
            key: 'threadMark',
            name: 'Threaded',
            kind: 'threadMark',
            duration: critScale(ctx, 3),
            ownerTeam: ctx.caster.team,
            sharePct: 0.5,
          },
          false
        );
      }
      await ctx.resolveImpacts?.();
    }
    ctx.log(
      threaded.size > 0
        ? `${ctx.caster.name} sews ${threaded.size} ${threaded.size === 1 ? 'body' : 'bodies'} together.`
        : `${ctx.caster.name}'s thread catches nothing.`
    );
  },
});

// ---------------------------------------------------------------------------
//  SHADOW + VEIL + CORRODE
//  Stop existing. Drift through the world and dissolve whatever you pass.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Dissolve Into Dark',
  words: ['shadow', 'veil', 'corrode'],
  set: 'dlc',
  actionType: 'main',
  range: 0,
  targeting: 'self',
  dc: 13,
  description:
    'Until the start of your next turn you cannot be targeted, damaged or affected by anything, including debuffs and DoTs. You may only move, passing through walls, zones and bodies. Enemies you move through take 1d6 corrosive. Phasing back in skips your upkeep; statuses still count down. Creates a shadow pool at your position.',
  visual: { preset: 'nova', color: 0x9be870, size: 60, speed: 1.2 },
  cast(ctx) {
    placeShadow(ctx, ctx.caster.pos, 4);
    addOrExtendStatus(
      ctx.caster.statuses,
      {
        key: 'phaseOut',
        name: 'Dissolved',
        kind: 'phaseOut',
        duration: 1,
        mode: 'self',
        ownerIndex: ctx.game.mages.indexOf(ctx.caster),
        ownerTeam: ctx.caster.team,
        passThroughSpec: '1d6',
      },
      false
    );
    ctx.log(`${ctx.caster.name} dissolves into the dark.`);
  },
});

// ---------------------------------------------------------------------------
//  SHADOW + VEIL + CURSE
//  Banish a threat into the dark — then let the dark spit it back out.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Banish Into Dark',
  words: ['shadow', 'veil', 'curse'],
  set: 'dlc',
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'Range 15. The target cannot be targeted, damaged or affected by anything until the start of its next turn. It may only move; its items have no effect and its upkeep is skipped, but its statuses still count down. When it ends, every enemy within 4cm of it, including itself, takes 2d6 shadow.',
  visual: { preset: 'beam', color: 0xb98bff, size: 9, speed: 1.2 },
  cast(ctx) {
    if (!ctx.target) return;
    addOrExtendStatus(
      ctx.target.statuses,
      {
        key: 'phaseOut',
        name: 'Banished',
        kind: 'phaseOut',
        duration: 1,
        mode: 'banished',
        ownerIndex: ctx.game.mages.indexOf(ctx.caster),
        ownerTeam: ctx.caster.team,
        burstSpec: '2d6',
        burstRadius: R(4),
      },
      false
    );
    ctx.log(`${ctx.target.name} is swallowed out of the world.`);
  },
});

// ---------------------------------------------------------------------------
//  SHADOW + SHATTER + PIERCE
//  Spend your own board as ammunition: every pool you break becomes a spike.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Impale Through Dark',
  words: ['shadow', 'shatter', 'pierce'],
  set: 'dlc',
  actionType: 'main',
  range: Infinity,
  targeting: 'enemy',
  dc: 13,
  description:
    'Choose an enemy at any range, then choose how many of your own shadow pools to shatter. Each pool you spend launches a spike for 1d6 pierce and 1d6 shatter, rolled separately, and is consumed. Spend nothing and the spell does nothing.',
  visual: { preset: 'beam', color: 0xffd166, size: 9, speed: 1.8 },
  async cast(ctx) {
    if (!ctx.target) return;
    const foe = ctx.target;
    let spent = 0;
    // Each pick names one pool to shatter; Esc stops and keeps the rest.
    for (let i = 0; i < 24 && foe.alive; i++) {
      const owned = ctx.game.shadowsOf(ctx.caster.team);
      if (owned.length === 0) break;
      const chosen = await ctx.requestPoint?.({
        maxRange: Math.hypot(FIELD.w, FIELD.h),
        origin: ctx.caster.pos,
        prompt: `Shadow Shatter Pierce — shatter a pool (${owned.length} left, Esc to stop)`,
      });
      if (!chosen) break;
      const pool = ctx.game.shadows.find(
        (shadow) =>
          shadow.owner === ctx.caster.team &&
          Math.hypot(shadow.x - chosen.x, shadow.y - chosen.y) <= shadow.radius
      );
      if (!pool) {
        ctx.log(`${ctx.caster.name} grasps at dark that is not theirs.`);
        break;
      }
      ctx.game.shadows = ctx.game.shadows.filter((shadow) => shadow !== pool);
      spent += 1;
      dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Shadow spike'), 'pierce', 'physical'), {
        canMiss: false,
      });
      if (foe.alive) {
        dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Shadow spike'), 'shatter', 'physical'), {
          canMiss: false,
        });
      }
      await ctx.resolveImpacts?.();
    }
    ctx.log(
      spent > 0
        ? `${ctx.caster.name} shatters ${spent} pool${spent === 1 ? '' : 's'} into ${foe.name}.`
        : `${ctx.caster.name} keeps the dark intact.`
    );
  },
});

// ---------------------------------------------------------------------------
//  SHADOW + CURSE + PIERCE
//  A wound that opens into a shadow and travels with its victim.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Walking Wound',
  words: ['shadow', 'curse', 'pierce'],
  set: 'dlc',
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  description:
    'A ranging shot. Beyond 8 range the wound is shallow: 2d6 pierce and a 1-range shade biting 1d3 for 2 turns. Inside 5 range you are too close to aim: the same shade for 3 turns. Struck from the sweet spot at 5–8 range it is 3d6 pierce and a 2-range shade biting 1d6 for 5 turns. The shade is one of YOUR pools and travels with its victim — reach, teleports and every spell that reads your pools find it.',
  visual: { preset: 'projectile', color: 0x8a6bff, size: 10, speed: 1.8 },
  cast(ctx) {
    if (!ctx.target) return;
    const units = Math.hypot(ctx.target.x - ctx.caster.x, ctx.target.y - ctx.caster.y) / RANGE_UNIT;
    const sweet = units >= 5 && units <= 8;
    dealDamage(
      ctx,
      ctx.target,
      dmg(rollDice(ctx, sweet ? '3d6' : '2d6', 'Walking Wound'), 'pierce', 'physical')
    );
    if (!ctx.target.alive) return;
    const duration = sweet ? 5 : units > 8 ? 2 : 3;
    addOrExtendStatus(
      ctx.target.statuses,
      {
        key: 'woundShade',
        name: 'Walking Wound',
        kind: 'woundShade',
        duration: critScale(ctx, duration),
        ownerIndex: ctx.game.mages.indexOf(ctx.caster),
        ownerTeam: ctx.caster.team,
        radius: sweet ? R(2) : R(1),
        damageSpec: sweet ? '1d6' : '1d3',
      },
      false
    );
    ctx.log(
      sweet
        ? `${ctx.caster.name} finds the range — the wound tears wide open.`
        : `${ctx.caster.name}'s shot lands ${units > 8 ? 'long' : 'short'}.`
    );
  },
});

// ---------------------------------------------------------------------------
//  VEIL + MIND + CURSE
//  Erase the difference between friend and foe, and the memory of where each
//  of them was standing.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Friend From Foe',
  words: ['veil', 'mind', 'curse'],
  set: 'dlc',
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 14,
  description:
    'For 3 turns the victim cannot tell friend from foe: every entity reads as hostile to it, its areas and cones spare nobody, and each target it picks is chosen at random instead of by its controller. It also bleeds 1d4 sanity each turn. You slip into a partial veil.',
  visual: { preset: 'beam', color: 0xff8be0, size: 8, speed: 1.1 },
  cast(ctx) {
    if (!ctx.target) return;
    addOrExtendStatus(
      ctx.target.statuses,
      {
        key: 'foeBlind',
        name: 'Friend From Foe',
        kind: 'foeBlind',
        duration: critScale(ctx, 3),
        ownerIndex: ctx.game.mages.indexOf(ctx.caster),
        damageSpec: '1d4',
      },
      false
    );
    applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'partial' });
    ctx.log(`${ctx.target.name} can no longer tell who is who.`);
  },
});

// ---------------------------------------------------------------------------
//  MIND + SHATTER + CURSE
//  A fuse the victim shapes: rush it small, or stall it and pray.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Swelling Fuse',
  words: ['mind', 'shatter', 'curse'],
  set: 'dlc',
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'Range 15. Sets a fuse lasting 10 of the target’s turns. It starts at 1d6 sanity and gains 1d6 every turn it survives. Each action the target takes (main, bonus or reaction) reduces the timer by 1 extra turn.',
  visual: { preset: 'beam', color: 0xffd166, size: 8, speed: 1.2 },
  cast(ctx) {
    if (!ctx.target) return;
    addOrExtendStatus(
      ctx.target.statuses,
      {
        key: 'mindFuse',
        name: 'Swelling Fuse',
        kind: 'mindFuse',
        duration: critScale(ctx, 10),
        ownerIndex: ctx.game.mages.indexOf(ctx.caster),
        baseSpec: '1d6',
        growthSpec: '1d6',
        ticks: 0,
      },
      false
    );
    ctx.log(`A fuse begins to swell inside ${ctx.target.name}.`);
  },
});

// ---------------------------------------------------------------------------
//  MIND + CURSE + PIERCE
//  A needle that punishes reacting instead of forbidding it.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Remembering Needle',
  words: ['mind', 'curse', 'pierce'],
  set: 'dlc',
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  description:
    'Range 12. Deal 2d6 sanity and apply a needle for 4 turns. Each reaction the target takes deals a further 2d6 sanity to it. The reaction still resolves.',
  visual: { preset: 'projectile', color: 0xff7bb0, size: 10, speed: 1.9 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '2d6', 'Remembering Needle'), 'shadow', 'sanity'));
    if (!ctx.target.alive) return;
    addOrExtendStatus(
      ctx.target.statuses,
      {
        key: 'reactionNeedle',
        name: 'Remembering Needle',
        kind: 'reactionNeedle',
        duration: critScale(ctx, 4),
        ownerIndex: ctx.game.mages.indexOf(ctx.caster),
        damageSpec: '2d6',
      },
      false
    );
    ctx.log(`A needle settles into ${ctx.target.name}'s mind.`);
  },
});

// ---------------------------------------------------------------------------
//  SHADOW + MIND + SHATTER
//  Break open a lasting pool; everything caught in the opening is rattled.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Breaking Dark',
  words: ['shadow', 'mind', 'shatter'],
  set: 'dlc',
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'circle', radius: SHADOW_RADIUS },
  description:
    'Break a shadow pool open at a point within range 12; it lasts 5 turns. Every enemy caught in the opening takes 1d6 shatter and 1d3 mill and is fully stunned for 1 turn.',
  visual: { preset: 'burst', color: 0xffd166, size: SHADOW_RADIUS, speed: 1.2 },
  noCastSprite: true,
  cast(ctx) {
    if (!ctx.targetPoint) return;
    placeShadow(ctx, ctx.targetPoint, 5);
    const shatter = rollDice(ctx, '1d6', 'Breaking Dark');
    const mill = rollDice(ctx, '1d3', 'Breaking Dark mill');
    for (const foe of areaDamage(
      ctx,
      ctx.targetPoint,
      SHADOW_RADIUS,
      dmg(shatter, 'shatter', 'physical'),
      { canMiss: false }
    )) {
      if (!foe.alive) continue;
      dealDamage(ctx, foe, dmg(mill, 'shadow', 'sanity'), { canMiss: false, aoe: true });
      if (foe.alive) applyStun(ctx, foe, { duration: 1, type: 'full' });
    }
  },
});

// ---------------------------------------------------------------------------
//  SHADOW + MIND + CORRODE
//  A single d20 split between body and mind; whichever half bites deep enough
//  leaves its own mark.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Divided Rot',
  words: ['shadow', 'mind', 'corrode'],
  set: 'dlc',
  actionType: 'main',
  range: Infinity,
  targeting: 'enemy',
  dc: 13,
  requiresTargetNearOwnShadow: R(5),
  description:
    'Choose an enemy standing within range 5 of any shadow of yours, however far away it is. Roll 1d20: it takes that much corrosive damage and 20 minus that much as mill. If 6 or more corrosion lands after mitigation it is slowed 50% for 3 turns; if 6 or more mill lands after mitigation it is rooted for 1 turn.',
  visual: { preset: 'beam', color: 0x9be870, size: 9, speed: 1.3 },
  cast(ctx) {
    if (!ctx.target) return;
    const split = rollDice(ctx, '1d20', 'Divided Rot');
    const rot = dealDamage(ctx, ctx.target, dmg(split, 'corrosive', 'physical'));
    if (!ctx.target.alive) return;
    const mill = dealDamage(ctx, ctx.target, dmg(20 - split, 'shadow', 'sanity'));
    if (!ctx.target.alive) return;
    if (rot >= 6) {
      applyDebuff(ctx, ctx.target, {
        name: 'Divided Rot',
        duration: 3,
        mods: { moveRange: -Math.round(MOVE_RANGE * 0.5) },
      });
    }
    if (mill >= 6) applyStun(ctx, ctx.target, { duration: 1, type: 'movement' });
    ctx.log(`The rot divides ${rot} into the body and ${mill} into the mind.`);
  },
});

// ---------------------------------------------------------------------------
//  SHADOW + MIND + CURSE
//  Nail a pool to one enemy, then make every pool you own a rotting mire.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Standing Rot',
  words: ['shadow', 'mind', 'curse'],
  set: 'dlc',
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'Range 15. Attach a shadow pool to the target for 5 turns; it moves with the target and counts as one of yours. For 5 rounds, every shadow you own damages enemies: an enemy starting its turn in one takes 1d3 sanity and 1d6 corrosive and is slowed 75%.',
  visual: { preset: 'beam', color: 0x8a6bff, size: 9, speed: 1.2 },
  cast(ctx) {
    if (!ctx.target) return;
    const duration = critScale(ctx, 5);
    addOrExtendStatus(
      ctx.target.statuses,
      {
        key: 'woundShade',
        name: 'Nailed Dark',
        kind: 'woundShade',
        duration,
        ownerIndex: ctx.game.mages.indexOf(ctx.caster),
        ownerTeam: ctx.caster.team,
        radius: SHADOW_RADIUS,
      },
      false
    );
    ctx.game.rottingDarks.push({
      ownerIndex: ctx.game.mages.indexOf(ctx.caster),
      ownerTeam: ctx.caster.team,
      roundsLeft: duration,
    });
    ctx.log(`${ctx.caster.name} nails the dark to ${ctx.target.name} and it begins to rot.`);
  },
});

// ---------------------------------------------------------------------------
//  BIND + MIND + CORRODE
//  A shackle that eats whatever the victim reaches for.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Memory Shackle',
  words: ['bind', 'mind', 'corrode'],
  set: 'dlc',
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 13,
  description:
    'Root one enemy for 3 turns and deal 1d6 corrosive sanity (range 10). While the shackle holds, everything it declares is eaten: a weapon strike makes it forget how to attack, and a spell makes it forget every word that spell used, for 3 turns each.',
  visual: { preset: 'beam', color: 0xc6f08a, size: 7, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Memory Shackle'), 'corrosive', 'sanity'));
    if (!ctx.target.alive) return;
    applyStun(ctx, ctx.target, { duration: 3, type: 'movement' });
    addOrExtendStatus(
      ctx.target.statuses,
      {
        key: 'memoryShackle',
        name: 'Memory Shackle',
        kind: 'memoryShackle',
        duration: critScale(ctx, 3),
        forgetDuration: 3,
      },
      false
    );
    ctx.log(`${ctx.target.name}'s memory begins to dissolve.`);
  },
});

// ---------------------------------------------------------------------------
//  SHADOW + VEIL + PIERCE
//  Step out of the dark, strike once, step back into it, and vanish again.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Shadowstep Assassination',
  words: ['shadow', 'veil', 'pierce'],
  set: 'dlc',
  actionType: 'main',
  range: 0,
  targeting: 'self',
  dc: 13,
  description:
    'Optionally step to any point inside a shadow, then run the nearest enemy within range 5 through for 3d6 pierce. Afterwards step back to where you started or to any point inside a shadow you choose, and vanish for 2 turns.',
  visual: { preset: 'nova', color: 0xb98bff, size: 56, speed: 1.4 },
  async cast(ctx) {
    const origin = { ...ctx.caster.pos };
    const fieldDiag = Math.hypot(FIELD.w, FIELD.h);
    const stepIntoShadow = async (prompt: string): Promise<void> => {
      const chosen = await ctx.requestPoint?.({
        maxRange: fieldDiag,
        origin: ctx.caster.pos,
        prompt,
      });
      if (!chosen) return;
      if (!ctx.game.shadowAt(chosen)) {
        ctx.log(`${ctx.caster.name} reaches for dark that is not there.`);
        return;
      }
      teleport(ctx, ctx.caster, chosen);
    };

    await stepIntoShadow('Shadow Veil Pierce — step into a shadow (Esc to stay)');
    const foe = enemyNear(ctx, ctx.caster.pos, R(5));
    if (foe) {
      dealDamage(ctx, foe, dmg(rollDice(ctx, '3d6', 'Shadow Veil Pierce'), 'pierce', 'physical'));
      await ctx.resolveImpacts?.();
    } else {
      ctx.log(`${ctx.caster.name} finds nobody within reach of the blade.`);
    }
    if (!ctx.caster.alive) return;

    const back = await ctx.requestPoint?.({
      maxRange: fieldDiag,
      origin: ctx.caster.pos,
      prompt: 'Shadow Veil Pierce — withdraw to a shadow (Esc to return where you began)',
    });
    teleport(ctx, ctx.caster, back && ctx.game.shadowAt(back) ? back : origin);
    applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'full' });
  },
});


// ---------------------------------------------------------------------------
//  SHATTER + CORRODE + CURSE   —   Blightburst
//  AoE nuke that seeds a corrosive plague.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Blightburst',
  words: ['shatter', 'corrode', 'curse'],
  set: 'finns',
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 14,
  aoe: { kind: 'circle', radius: R(3) },
  description:
    'At a point (range 12), every enemy within range 3 takes 1d6 shatter damage + 1d6 corrosive damage, with a 25% chance to be fully stunned. Each also gets a corrosive plague: 1d3 damage per stack each turn, stacks up to 3, spreads to nearby enemies each turn, and loses one stack on any turn no new stack is added.',
  visual: { preset: 'burst', color: 0xc6e08a, size: 62, speed: 1.2 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const hits = areaDamage(
      ctx,
      ctx.targetPoint,
      R(3),
      dmg(rollDice(ctx, '1d6', 'Blightburst'), 'shatter', 'physical'),
      { canMiss: false }
    );
    for (const m of hits) {
      dealDamage(ctx, m, dmg(rollDice(ctx, '1d6', 'Blightburst'), 'corrosive', 'physical'), {
        aoe: true,
        canMiss: false,
      });
      if (ctx.rng.chance(0.25)) applyStun(ctx, m, { duration: 2, type: 'full' });
      applyStackingDot(ctx, m, {
        name: 'Blight',
        damage: dmg(1, 'corrosive', 'physical'),
        perStackSpec: '1d3',
        maxStacks: 3,
        refreshDuration: 99,
        decayPerTick: true,
        infectRadius: R(3),
      });
    }
  },
});

// ---------------------------------------------------------------------------
//  SHADOW + VEIL + BIND
//  Blue-dominant: the control does the work and shadow only sharpens it, so
//  this makes no pool. The seal hides the victim from its OWN side.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Shadow Veil Bind',
  words: ['shadow', 'veil', 'bind'],
  set: 'finns',
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 14,
  description:
    'Deal 2d6 shadow damage to one enemy (range 12) and seal it for 3 turns: it is fully stunned and rooted, and its own allies can no longer see or target it — only you and your allies can. Each turn it takes 1d3 shadow damage and is executed for 2.',
  visual: { preset: 'beam', color: 0x8ad1ff, size: 9, speed: 1.1 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '2d6', 'Shadow Veil Bind'), 'shadow', 'physical'));
    if (!ctx.target.alive) return;
    applySeal(ctx, ctx.target, { duration: 3, damageSpec: '1d3', executeAmount: 2 });
  },
});

// ---------------------------------------------------------------------------
//  SHATTER + BIND + CORRODE   —   Calcifying Strike
//  Point-blank two-stage lock: full stun then root, calcification slow lingers.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Calcifying Strike',
  words: ['shatter', 'bind', 'corrode'],
  set: 'finns',
  actionType: 'main',
  range: R(1),
  targeting: 'enemy',
  dc: 13,
  description:
    '1d6 shatter damage + 1d6 corrosive damage to an adjacent enemy (range 1), fully stun it for 2 turns, root it for 3 turns, and slow it (40% less movement) for 6 turns.',
  visual: { preset: 'conjure', color: 0xc6e08a, size: 30, speed: 1.3 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Calcifying Strike'), 'shatter', 'physical'));
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Calcifying Strike'), 'corrosive', 'physical'));
    applyStun(ctx, ctx.target, { duration: 2, type: 'full' });
    applyStun(ctx, ctx.target, { duration: 3, type: 'movement' });
    applyDebuff(ctx, ctx.target, {
      name: 'Calcified',
      duration: 6,
      mods: { moveRange: -Math.round(MOVE_RANGE * 0.4) },
    });
  },
});

// ---------------------------------------------------------------------------
//  MIND + CORRODE + CURSE   —   Mind Plague
//  Triple-stacked debuff + expose; no burst, pure attrition.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Mind Plague',
  words: ['mind', 'corrode', 'curse'],
  set: 'finns',
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'Mark one enemy (range 15) for 2 turns (no reactions, +2 damage taken). It also takes 1d3 sanity damage each turn for 4 turns and 1d3 corrosive damage each turn for 4 turns.',
  visual: { preset: 'beam', color: 0xff8be0, size: 6, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    applyControl(ctx, ctx.target, { name: 'Plagued', mode: 'expose', duration: 2 });
    applyDebuff(ctx, ctx.target, { name: 'Plagued', duration: 2, mods: { damageTaken: 2 } });
    applyDot(ctx, ctx.target, {
      name: 'Mind Plague',
      key: 'dot:mindPlague:sanity',
      duration: 4,
      damage: dmg(2, 'shadow', 'sanity'),
      damageSpec: '1d3',
    });
    applyDot(ctx, ctx.target, {
      name: 'Corrosive Plague',
      key: 'dot:mindPlague:corrode',
      duration: 4,
      damage: dmg(1, 'corrosive', 'physical'),
      damageSpec: '1d3',
    });
  },
});

// ---------------------------------------------------------------------------
//  SHATTER + CURSE + PIERCE   —   Harrowing Lance
//  Long-range cursed shard that stuns with each tick.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Harrowing Lance',
  words: ['shatter', 'curse', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: R(18),
  targeting: 'enemy',
  dc: 14,
  description:
    '2d6 pierce damage to one enemy (range 18), then 1d6 shatter damage each turn for 3 turns, with a 33% chance to fully stun on each turn it ticks.',
  visual: { preset: 'projectile', color: 0xffd08a, size: 9, speed: 1.7 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '2d6', 'Harrowing Lance'), 'pierce', 'physical'));
    applyDot(ctx, ctx.target, {
      name: 'Harrowing Lance',
      duration: 3,
      damage: dmg(0, 'shatter', 'physical'),
      damageSpec: '1d6',
      stunChance: 0.33,
      stunType: 'full',
    });
  },
});

// ===========================================================================
//  REMAINING STANDARD 3-WORD COMBINATIONS   (set: 'finns')
// ---------------------------------------------------------------------------
//  Colour majority decides the character of each spell: blue = control and
//  concealment, black = raw power that does not care whose side you are on,
//  colourless = damage. Every one of these resolves on its own — none needs a
//  pre-existing veil or shadow pool to function.
// ===========================================================================

// ---------------------------------------------------------------------------
//  BIND + VEIL + CORRODE
//  Blue-dominant: a small concealing mist that only bites what moves in it.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Bind Veil Corrode',
  words: ['bind', 'veil', 'corrode'],
  set: 'finns',
  actionType: 'main',
  range: R(10),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'circle', radius: R(2) },
  description:
    'Raise a range-2 mist at a point (range 10) for 3 rounds. Anyone inside it has a 50% chance to dodge any targeted attack. At the start of its turn, anyone inside who moved during its last turn takes 1d4 corrosive damage. Affects everyone, including you and your allies.',
  visual: { preset: 'burst', color: 0x8fd6a8, size: R(2), speed: 1 },
  noCastSprite: true,
  cast(ctx) {
    if (!ctx.targetPoint) return;
    placeHazardZone(ctx, ctx.targetPoint, {
      name: 'Corroding Mist',
      radius: R(2),
      rounds: 3,
      damageSpecs: ['1d4'],
      damageType: 'corrosive',
      movedOnly: true,
      dodgeChance: 0.5,
      color: 0x8fd6a8,
    });
  },
});

// ---------------------------------------------------------------------------
//  SHADOW + SHATTER + CORRODE
//  Black-dominant destruction. No pull, no root, no zone — it just pulverises.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Shadow Shatter Corrode',
  words: ['shadow', 'shatter', 'corrode'],
  set: 'finns',
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 14,
  aoe: { kind: 'circle', radius: R(3) },
  description:
    'Deal 2d10 damage to one enemy (range 10), split evenly between corrosive and shadow, and fully stun it for 1 turn. Everything else within range 3 takes 1d3 shatter + 1d3 corrosive + 1d3 shadow damage and has a 33% chance to be fully stunned for 1 turn. The blast hits your allies too.',
  visual: { preset: 'burst', color: 0x7a5f8c, size: R(3), speed: 1.4 },
  cast(ctx) {
    if (!ctx.target) return;
    const focus = ctx.target;
    const roll = rollDice(ctx, '2d10', 'Shadow Shatter Corrode');
    const corrosive = Math.ceil(roll / 2);
    dealDamage(ctx, focus, dmg(corrosive, 'corrosive', 'physical'));
    if (focus.alive) {
      dealDamage(ctx, focus, dmg(roll - corrosive, 'shadow', 'physical'), { canMiss: false });
    }
    if (focus.alive) applyStun(ctx, focus, { duration: 2, type: 'full' });
    // Black does not check sides: the shockwave catches every other body.
    for (const bystander of ctx.game.magesInRadius(focus.pos, R(3), focus)) {
      if (!bystander.alive) continue;
      for (const type of ['shatter', 'corrosive', 'shadow'] as const) {
        if (!bystander.alive) break;
        dealDamage(
          ctx,
          bystander,
          dmg(rollDice(ctx, '1d3', `Shadow Shatter Corrode — ${type}`), type, 'physical'),
          { canMiss: false, aoe: true }
        );
      }
      if (bystander.alive && ctx.rng.chance(0.33)) {
        applyStun(ctx, bystander, { duration: 2, type: 'full' });
      }
    }
  },
});

// ---------------------------------------------------------------------------
//  SHADOW + CORRODE + CURSE
//  Pure black: a giant death zone you have to play around. It rots your side too.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Shadow Corrode Curse',
  words: ['shadow', 'corrode', 'curse'],
  set: 'finns',
  actionType: 'main',
  range: R(10),
  targeting: 'point',
  dc: 15,
  aoe: { kind: 'circle', radius: R(8) },
  description:
    'Open a range-8 zone of decay at a point (range 10) for 4 rounds. Anyone starting a turn inside takes corrosive damage that deepens every round: 1d4, then 1d6, then 1d8, then 1d10. All healing received inside the zone is halved. It does not care whose side you are on.',
  visual: { preset: 'nova', color: 0x6f8f5a, size: R(8), speed: 0.9 },
  noCastSprite: true,
  cast(ctx) {
    if (!ctx.targetPoint) return;
    placeHazardZone(ctx, ctx.targetPoint, {
      name: 'Rotting Ground',
      radius: R(8),
      rounds: 4,
      damageSpecs: ['1d4', '1d6', '1d8', '1d10'],
      damageType: 'corrosive',
      healMult: 0.5,
      color: 0x6f8f5a,
    });
  },
});

// ---------------------------------------------------------------------------
//  VEIL + CORRODE + CURSE
//  Black-dominant contagion. It hides its own victims, so you lose track of them.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Veil Corrode Curse',
  words: ['veil', 'corrode', 'curse'],
  set: 'finns',
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 14,
  description:
    'Infect one enemy for 4 turns (range 15): 1d6 corrosive damage each turn, and it turns fully invisible. Each turn it ticks, the plague spreads to everything within range 4 at half the remaining duration — allies included. You cannot see who is carrying it.',
  visual: { preset: 'beam', color: 0x86a86f, size: 8, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    applyDot(ctx, ctx.target, {
      name: 'Silent Plague',
      key: 'dot:silent-plague',
      duration: 4,
      damage: dmg(0, 'corrosive', 'physical'),
      damageSpec: '1d6',
      spreadRadius: R(4),
      spreadVeils: true,
    });
    applyInvisibility(ctx, ctx.target, { duration: 4, mode: 'full' });
  },
});

// ---------------------------------------------------------------------------
//  CORRODE + CURSE + PIERCE
//  Black-dominant rot that any further pierce hit keeps prying back open.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Corrode Curse Pierce',
  words: ['corrode', 'curse', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 14,
  description:
    '1d6 pierce damage to one enemy (range 12), then 3 turns of corrosive rot that deepens as it runs: 1d6, then 1d8, then 1d10. Any pierce damage it takes from any source reopens the wound for 1 more turn — always if that hit dealt 6 or more, otherwise 50% of the time. It can never hold more than 3 turns at once.',
  visual: { preset: 'projectile', color: 0x9aa86a, size: 10, speed: 1.6 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Corrode Curse Pierce'), 'pierce', 'physical'));
    if (!ctx.target.alive) return;
    applyDot(ctx, ctx.target, {
      name: 'Suppurating Wound',
      key: 'dot:suppurating-wound',
      duration: 3,
      damage: dmg(0, 'corrosive', 'physical'),
      escalateSpecs: ['1d6', '1d8', '1d10'],
      extendOnPierce: { minAmount: 6, chanceBelow: 0.5, maxDuration: 3 },
    });
  },
});

// ---------------------------------------------------------------------------
//  VEIL + SHATTER + PIERCE
//  Colourless-dominant sniping. The shot finds what nobody else can see.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Veil Shatter Pierce',
  words: ['veil', 'shatter', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: R(18),
  targeting: 'enemy',
  dc: 14,
  ignoresStealth: true,
  description:
    'Snipe one enemy (range 18). This shot can pick a target that is invisible or otherwise concealed. Deal 2d6 pierce damage; if the target was veiled, deal an extra 1d12 shatter damage and strip the veil. If there was no veil to break, you gain a half veil for 2 turns instead.',
  visual: { preset: 'projectile', color: 0xd9d0ff, size: 8, speed: 2 },
  cast(ctx) {
    if (!ctx.target) return;
    const foe = ctx.target;
    const wasVeiled = ctx.game.isVeiled(foe);
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Veil Shatter Pierce'), 'pierce', 'physical'), {
      canMiss: false,
    });
    if (!wasVeiled) {
      applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'partial' });
      return;
    }
    if (foe.alive) {
      dealDamage(ctx, foe, dmg(rollDice(ctx, '1d12', 'Veil Shatter Pierce — unveiling'), 'shatter', 'physical'), {
        canMiss: false,
      });
    }
    dispelVeil(ctx, foe);
  },
});

// ---------------------------------------------------------------------------
//  BIND + SHATTER + PIERCE
//  Colourless-dominant: it never forbids movement, it bills it.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Bind Shatter Pierce',
  words: ['bind', 'shatter', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 14,
  description:
    '2d6 pierce damage to one enemy (range 15) and stake it to the spot it stands on for 4 turns. At the start of each of its turns it is dragged back to the stake and takes 1d6 shatter damage for every 2 range units it strayed, up to 4d6 at 8 units.',
  visual: { preset: 'projectile', color: 0xffc98a, size: 10, speed: 1.8 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '2d6', 'Bind Shatter Pierce'), 'pierce', 'physical'));
    if (!ctx.target.alive) return;
    applyAnchorSpike(ctx, ctx.target, { duration: 4, pxPerDie: R(2), maxDice: 4 });
  },
});

// ---------------------------------------------------------------------------
//  SHATTER + CORRODE + PIERCE
//  Colourless-dominant. Corrode's only job is to eat the armour on the way in.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Shatter Corrode Pierce',
  words: ['shatter', 'corrode', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: R(8),
  targeting: 'enemy',
  dc: 14,
  description:
    '2d6 shatter damage then 2d6 pierce damage to one enemy (range 8). Both hits ignore armour and every resistance and immunity.',
  visual: { preset: 'conjure', color: 0xe0d08a, size: 34, speed: 1.5 },
  cast(ctx) {
    if (!ctx.target) return;
    const foe = ctx.target;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Shatter Corrode Pierce'), 'shatter', 'physical'), {
      trueDamage: true,
      canMiss: false,
    });
    if (!foe.alive) return;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Shatter Corrode Pierce'), 'pierce', 'physical'), {
      trueDamage: true,
      canMiss: false,
    });
  },
});

// ---------------------------------------------------------------------------
//  BIND + CURSE + PIERCE
//  A contract: the curse repeats every pierce wound you open while it holds.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Bind Curse Pierce',
  words: ['bind', 'curse', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 14,
  description:
    'Root one enemy for 3 turns and slow it by 30% for 4 turns (range 12), then deal 1d6 pierce damage. For the next 4 turns every point of pierce damage you deal to anyone is dealt again at the end of your turn.',
  visual: { preset: 'beam', color: 0xc0a8ff, size: 8, speed: 1.2 },
  cast(ctx) {
    if (!ctx.target) return;
    applyStun(ctx, ctx.target, { duration: 3, type: 'movement' });
    applyDebuff(ctx, ctx.target, {
      name: 'Oathbound',
      key: 'debuff:blood-oath',
      duration: 4,
      mods: { moveRange: -Math.round(MOVE_RANGE * 0.3) },
    });
    // The oath is sworn before the shot, so this hit already echoes.
    applyPierceEcho(ctx, ctx.caster, 4);
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Bind Curse Pierce'), 'pierce', 'physical'));
  },
});

// ---------------------------------------------------------------------------
//  MIND + CORRODE + PIERCE
//  An infection, not a compulsion: a virus injected straight into the mind.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Mind Corrode Pierce',
  words: ['mind', 'corrode', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 14,
  description:
    'Inject one enemy for 1d6 pierce damage (range 12), then infect it for 4 turns. Each turn the virus deals sanity damage that deepens as it multiplies — 1d4, then 1d6, then 1d8, then 1d10 — and the host forgets one random action. If the infection empties its sanity, the virus abandons it and takes root in the nearest unit within range 4, whatever side that unit is on.',
  visual: { preset: 'projectile', color: 0xa8c86f, size: 9, speed: 1.7 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Mind Corrode Pierce'), 'pierce', 'physical'));
    if (!ctx.target.alive) return;
    applyDot(ctx, ctx.target, {
      name: 'Neural Virus',
      key: 'dot:neural-virus',
      duration: 4,
      damage: dmg(0, 'corrosive', 'sanity'),
      escalateSpecs: ['1d4', '1d6', '1d8', '1d10'],
      forgetPerTick: 1,
      jumpOnMindBreakRadius: R(4),
    });
  },
});
