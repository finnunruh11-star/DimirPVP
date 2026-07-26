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
import { CONE_DEGREES, FIELD, MOVE_RANGE, RANGE_UNIT } from '../config/constants';
import {
  applyAuraDot,
  applyBlueflareStacks,
  applyControl,
  applyDebuff,
  applyDot,
  applyFireStacks,
  applyForget,
  applyInvisibility,
  applyOrderJudgment,
  applyShadowTrail,
  applyShadowVeil,
  applyStackingDot,
  applyStun,
  applyWard,
  areaDamage,
  blinkstep,
  coneDamage,
  dash,
  dealDamage,
  dispelVeil,
  drainDamage,
  grantExtraTurn,
  heal,
  placeRealityWedge,
  placeShadow,
  placeTotem,
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

/** Kept d20 plus the modifiers represented by assigned INT and remaining Luck. */
function lightningPower(ctx: EffectContext): number {
  const natural = ctx.spellRoll ?? 1;
  const intellect = Math.max(0, ctx.caster.statInt - 1);
  const luck = Math.max(0, ctx.caster.luck - 1);
  const power = natural + intellect + luck;
  ctx.log(`Lightning power: ${natural} + ${intellect} INT + ${luck} Luck = ${power}.`);
  return power;
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
    coneDamage(ctx, ctx.targetPoint, R(5), CONE_DEGREES, dmg(amount, 'shatter', 'physical'));
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
    'Aim two points (both chosen before the roll) to set where a wedge opens and how wide it is; it extends to the edge of the field. For 3 rounds no one can move into it: walk in and you are rooted until it ends; dash in and your dash stops at its edge.',
  visual: { preset: 'burst', color: 0xff5599, size: 70, speed: 1.2 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const diag = Math.hypot(FIELD.w, FIELD.h);
    // Both cone edges were chosen up-front (before the DC roll): targetPoint is
    // one edge, targetPoint2 the other. The wedge reaches to the field's edge.
    placeRealityWedge(ctx, ctx.targetPoint, ctx.targetPoint2 ?? null, { ttl: 3, length: diag });
  },
});

registerSpell({
  name: 'Shatter Mind Reality',
  words: ['shatter', 'mind', 'reality'],
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 15,
  description:
    'Take an extra turn after this one. The target takes 3d3 sanity damage and cannot move for 1 turn (range 20).',
  visual: { preset: 'beam', color: 0xff5599, size: 7, speed: 1.1 },
  cast(ctx) {
    grantExtraTurn(ctx, ctx.caster);
    if (ctx.target) {
      dealDamage(
        ctx,
        ctx.target,
        dmg(rollDice(ctx, '3d3', 'Shatter Mind Reality'), 'shadow', 'sanity')
      );
      applyStun(ctx, ctx.target, { duration: 2, type: 'movement' });
    }
  },
});

// ===========================================================================
//  KAT EASTER-EGG SPELLS   (words: Corrode / Curse / Shadow / Drain / Pain)
// ===========================================================================

registerSpell({
  name: 'Pain',
  words: ['pain'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 7,
  description: 'Deal 1d4 mental damage to one enemy (range 15).',
  visual: { preset: 'beam', color: 0xe06b9f, size: 6, speed: 1.2 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d4', 'Pain'), 'shadow', 'sanity'));
  },
});

registerSpell({
  name: 'Corrode Pain',
  words: ['corrode', 'pain'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 11,
  description: 'Deal 1d6 corrosive health damage and 1d4 mental damage to one enemy (range 10).',
  visual: { preset: 'projectile', color: 0xc68b73, size: 10, speed: 1.3 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Corrode Pain'), 'corrosive', 'physical'));
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d4', 'Corrode Pain'), 'shadow', 'sanity'));
  },
});

registerSpell({
  name: 'Shadow Pain',
  words: ['shadow', 'pain'],
  actionType: 'main',
  range: R(15),
  bonusRangeInOwnShadow: R(99),
  targeting: 'enemy',
  dc: 11,
  description: 'Deal 2d3 mental damage (range 15). Shadow pools amplify the damage, and targets in your shadows can be hit from anywhere.',
  visual: { preset: 'beam', color: 0xb66fd1, size: 7, speed: 1.2 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '2d3', 'Shadow Pain'), 'shadow', 'sanity'));
  },
});

registerSpell({
  name: 'Curse Pain',
  words: ['curse', 'pain'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 11,
  description: 'Inflict 1d4 mental damage at the start of each of the target\'s next 4 turns (range 15).',
  visual: { preset: 'beam', color: 0xf07b8c, size: 6, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    applyDot(ctx, ctx.target, {
      name: 'Pain Curse',
      duration: 4,
      damage: dmg(2, 'shadow', 'sanity'),
      damageSpec: '1d4',
    });
  },
});

registerSpell({
  name: 'Drain Pain',
  words: ['drain', 'pain'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 11,
  description: 'Deal 1d6 corrosive health damage and 1d4 mental damage. Heal health for corrosive damage dealt and sanity for mental damage dealt.',
  visual: { preset: 'projectile', color: 0x8fa88f, size: 11, speed: 1.4 },
  cast(ctx) {
    if (!ctx.target) return;
    const healthDamage = dealDamage(
      ctx,
      ctx.target,
      dmg(rollDice(ctx, '1d6', 'Drain Pain'), 'corrosive', 'physical')
    );
    if (healthDamage > 0 && ctx.caster.alive) heal(ctx, ctx.caster, healthDamage, 'hp');
    const mentalDamage = dealDamage(
      ctx,
      ctx.target,
      dmg(rollDice(ctx, '1d4', 'Drain Pain'), 'shadow', 'sanity')
    );
    if (mentalDamage > 0 && ctx.caster.alive) heal(ctx, ctx.caster, mentalDamage, 'sanity');
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
  description: 'Strike one enemy for 1d6 plus 1 damage per 6 Lightning power (range 15).',
  visual: { preset: 'beam', color: 0xffe45c, size: 7, speed: 1.7 },
  cast(ctx) {
    if (!ctx.target) return;
    const power = lightningPower(ctx);
    const amount = rollDice(ctx, '1d6', 'Lightning') + Math.floor(power / 6);
    dealDamage(ctx, ctx.target, dmg(amount, 'fire', 'physical'));
  },
});

registerSpell({
  name: 'Fire Mind',
  words: ['fire', 'mind'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 11,
  description: 'Apply 2 stacks of Blueflare, a spreading mental flame with slower decay (range 15).',
  visual: { preset: 'beam', color: 0x56bfff, size: 8, speed: 1.3 },
  cast(ctx) {
    if (ctx.target) applyBlueflareStacks(ctx, ctx.target, 2);
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
    'Deal 1d6 plus 1 damage per 5 Lightning power and apply up to 3 Fire based on that power (range 15).',
  visual: { preset: 'beam', color: 0xff9d36, size: 10, speed: 1.6 },
  cast(ctx) {
    if (!ctx.target) return;
    const power = lightningPower(ctx);
    const amount = rollDice(ctx, '1d6', 'Fire Lightning') + Math.floor(power / 5);
    dealDamage(ctx, ctx.target, dmg(amount, 'fire', 'physical'));
    if (ctx.target.alive) applyFireStacks(ctx, ctx.target, Math.min(3, 1 + Math.floor(power / 10)));
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
  description: 'Gain a half veil for 2 turns and apply 1 Fire to nearby enemies within range 2.',
  visual: { preset: 'nova', color: 0xff6f52, size: R(2), speed: 1.4 },
  cast(ctx) {
    applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'partial' });
    for (const target of ctx.game.magesInRadius(ctx.caster.pos, R(2), ctx.caster)) {
      if (target.team !== ctx.caster.team) applyFireStacks(ctx, target, 1);
    }
  },
});

registerSpell({
  name: 'Lightning Mind',
  words: ['lightning', 'mind'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 11,
  description:
    'Deal 1d6 plus 1 sanity damage per 6 Lightning power, then apply 1 Blueflare (range 15).',
  visual: { preset: 'beam', color: 0x79bfff, size: 9, speed: 1.7 },
  cast(ctx) {
    if (!ctx.target) return;
    const power = lightningPower(ctx);
    const amount = rollDice(ctx, '1d6', 'Lightning Mind') + Math.floor(power / 6);
    dealDamage(ctx, ctx.target, dmg(amount, 'fire', 'sanity'));
    if (ctx.target.alive) applyBlueflareStacks(ctx, ctx.target, 1);
  },
});

registerSpell({
  name: 'Lightning Veil',
  words: ['lightning', 'veil'],
  actionType: 'bonus',
  range: R(20),
  targeting: 'point',
  dc: 11,
  description:
    'Blink up to your Lightning power in range (critical doubles it), then gain a half veil for 1 turn per 10 power.',
  visual: { preset: 'burst', color: 0xffef8a, size: 30, speed: 1.8 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const power = lightningPower(ctx);
    const distance = R(Math.min(20, power * (ctx.crit ? 2 : 1)));
    blinkstep(ctx, ctx.caster, { toPoint: ctx.targetPoint, distance });
    applyInvisibility(ctx, ctx.caster, {
      duration: Math.max(1, Math.ceil(power / 10)),
      mode: 'partial',
    });
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
        dealDamage(ctx, entity, dmg(explosion, 'fire', 'physical'), {
          canMiss: false,
          aoe: true,
        });
      }
      applyFireStacks(ctx, target, 2);
      return;
    }
    dash(ctx, ctx.caster, { toPoint: target.pos, distance: R(units) });
    dealDamage(ctx, target, dmg(rollDice(ctx, '1d6', 'Fire Pierce'), 'fire', 'physical'), {
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
    'Use the modified cast roll as range (doubled on a critical). Teleport-dash to each random ally or enemy in range at most once and deal 2d6 Fire, losing 1 range each jump. Every jump has a 1/roll misfire chance that deals 2d4 Fire to you and ends the chain.',
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
        dealDamage(ctx, ctx.caster, dmg(rollDice(ctx, '2d4', 'Lightning misfire'), 'fire', 'physical'), {
          canMiss: false,
        });
        break;
      }
      const target = ctx.rng.pick(candidates);
      visited.add(target);
      const bolt = ctx.vfx?.lightningBolt?.(ctx.caster.pos, target.pos);
      blinkstep(ctx, ctx.caster, { toPoint: target.pos, distance: range });
      await bolt;
      dealDamage(ctx, target, dmg(rollDice(ctx, '2d6', 'Lightning Pierce'), 'fire', 'physical'), {
        canMiss: false,
      });
      range -= R(1);
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
    const bonus = Math.floor(power / 6);
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Fire Lightning Mind') + bonus, 'fire', 'physical'));
    if (!ctx.target.alive) return;
    dealDamage(
      ctx,
      ctx.target,
      dmg(rollDice(ctx, '1d6', 'Fire Lightning Mind sanity') + bonus, 'fire', 'sanity')
    );
    if (ctx.target.alive) {
      applyBlueflareStacks(ctx, ctx.target, Math.min(4, 2 + Math.floor(power / 12)));
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
    'Apply 2 Fire to enemies within range 2 of your departure, blink by Lightning power, repeat at arrival, and become invisible.',
  visual: { preset: 'burst', color: 0xff8b45, size: R(2), speed: 1.7 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const power = lightningPower(ctx);
    const origin = { ...ctx.caster.pos };
    for (const target of ctx.game.magesInRadius(origin, R(2), ctx.caster)) {
      if (target.team !== ctx.caster.team) applyFireStacks(ctx, target, 2);
    }
    blinkstep(ctx, ctx.caster, {
      toPoint: ctx.targetPoint,
      distance: R(Math.min(20, power * (ctx.crit ? 2 : 1))),
    });
    for (const target of ctx.game.magesInRadius(ctx.caster.pos, R(2), ctx.caster)) {
      if (target.team !== ctx.caster.team) applyFireStacks(ctx, target, 2);
    }
    applyInvisibility(ctx, ctx.caster, {
      duration: Math.max(1, Math.ceil(power / 12)),
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Fire Mind Pierce'), 'fire', 'physical'), {
      canMiss: false,
    });
    if (!ctx.target.alive) return;
    dealDamage(
      ctx,
      ctx.target,
      dmg(rollDice(ctx, '1d6', 'Fire Mind Pierce sanity'), 'fire', 'sanity'),
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
    'Dash up to range 12 toward an enemy, deal 2d6 Fire, apply 2 Fire, and become fully invisible for 2 turns.',
  visual: { preset: 'projectile', color: 0xff8060, size: 14, speed: 1.8 },
  cast(ctx) {
    if (!ctx.target) return;
    dash(ctx, ctx.caster, { toPoint: ctx.target.pos, distance: R(12) });
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '2d6', 'Fire Veil Pierce'), 'fire', 'physical'), {
      canMiss: false,
    });
    if (ctx.target.alive) applyFireStacks(ctx, ctx.target, 2);
    applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'full' });
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
    'Chain through random unvisited allies or enemies within Lightning-power range. Each jump deals 1d6 Pierce, 1d6 sanity, and applies 1 Blueflare; range falls by 2 each jump.',
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
      const target = ctx.rng.pick(candidates);
      visited.add(target);
      const bolt = ctx.vfx?.lightningBolt?.(ctx.caster.pos, target.pos);
      blinkstep(ctx, ctx.caster, { toPoint: target.pos, distance: range });
      await bolt;
      dealDamage(ctx, target, dmg(rollDice(ctx, '1d6', 'Lightning Mind Pierce'), 'pierce', 'physical'), {
        canMiss: false,
      });
      if (target.alive) {
        dealDamage(
          ctx,
          target,
          dmg(rollDice(ctx, '1d6', 'Lightning Mind Pierce sanity'), 'fire', 'sanity'),
          { canMiss: false }
        );
      }
      if (target.alive) applyBlueflareStacks(ctx, target, 1);
      range -= R(2);
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
    'Apply 1 Blueflare to enemies within range 3 of your departure, blink by Lightning power, repeat at arrival, and become invisible.',
  visual: { preset: 'burst', color: 0x8fa7ff, size: R(3), speed: 1.7 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const power = lightningPower(ctx);
    const origin = { ...ctx.caster.pos };
    for (const target of ctx.game.magesInRadius(origin, R(3), ctx.caster)) {
      if (target.team !== ctx.caster.team) applyBlueflareStacks(ctx, target, 1);
    }
    blinkstep(ctx, ctx.caster, {
      toPoint: ctx.targetPoint,
      distance: R(Math.min(20, power * (ctx.crit ? 2 : 1))),
    });
    for (const target of ctx.game.magesInRadius(ctx.caster.pos, R(3), ctx.caster)) {
      if (target.team !== ctx.caster.team) applyBlueflareStacks(ctx, target, 1);
    }
    applyInvisibility(ctx, ctx.caster, {
      duration: Math.max(1, Math.ceil(power / 8)),
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
    'A stronger Lightning Pierce: repeatedly chain into random allies or enemies with 5 additional range and no misfire, dealing 2d6 Fire each hit. The same mage can be hit any number of times. Then roll d6, dash that far, and become invisible for 6 minus the roll turns.',
  visual: { preset: 'nova', color: 0xffc95c, size: 78, speed: 1.5 },
  async cast(ctx) {
    const power = lightningPower(ctx);
    let range = R((power + 5) * (ctx.crit ? 2 : 1));
    while (range >= R(1) && ctx.caster.alive) {
      const candidates = ctx.game.mages.filter(
        (entity) =>
          entity !== ctx.caster &&
          entity.alive &&
          Math.hypot(entity.x - ctx.caster.x, entity.y - ctx.caster.y) <= range
      );
      if (candidates.length === 0) break;
      const target = ctx.rng.pick(candidates);
      const bolt = ctx.vfx?.lightningBolt?.(ctx.caster.pos, target.pos);
      blinkstep(ctx, ctx.caster, { toPoint: target.pos, distance: range });
      await bolt;
      dealDamage(ctx, target, dmg(rollDice(ctx, '2d6', 'Lightning Veil Pierce'), 'fire', 'physical'), {
        canMiss: false,
      });
      range -= R(1);
    }
    if (!ctx.caster.alive) return;
    const finalRoll = rollDice(ctx, '1d6', 'Lightning Veil Pierce escape');
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
    'Dash roll/3 times, starting at roll/3 range and losing 1 range each dash (critical doubles the starting range and damage). Choose each direction, then roll d6 accuracy with up to 30° error. The animated lightning trail deals 4d6 Fire whenever crossed; touching your own earlier trail stops you there and deals 4d6 Fire to you.',
  visual: { preset: 'nova', color: 0xff3d24, size: 80, speed: 1.5 },
  async cast(ctx) {
    const power = lightningPower(ctx);
    const dashCount = Math.max(1, Math.floor(power / 3));
    const dashDistance = R((power / 3) * (ctx.crit ? 2 : 1));
    const trail: TrailSegment[] = [];
    try {
      for (let step = 0; step < dashCount && ctx.caster.alive; step++) {
        const currentDashDistance = Math.max(R(1), dashDistance - R(step));
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
        const accuracy = rollDice(ctx, '1d6', 'Lightning dash accuracy');
        const maxError = [30, 24, 18, 12, 6, 0][accuracy - 1] * (Math.PI / 180);
        const aimedAngle = Math.atan2(chosen.y - ctx.caster.y, chosen.x - ctx.caster.x);
        const angle = aimedAngle + (ctx.rng.float() * 2 - 1) * maxError;
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
        for (const entity of ctx.game.mages) {
          if (entity === ctx.caster || !entity.alive || !segmentHitsMage(segment, entity)) continue;
          dealDamage(ctx, entity, dmg(rollDice(ctx, '4d6', 'Red lightning trail'), 'fire', 'physical'), {
            canMiss: false,
          });
        }
        if (collision) {
          ctx.log(`${ctx.caster.name} crosses the red trail and the spell collapses!`);
          dealDamage(ctx, ctx.caster, dmg(rollDice(ctx, '4d6', 'Red trail collision'), 'fire', 'physical'), {
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
    const hits = areaDamage(ctx, ctx.targetPoint, R(2), dmg(amount, 'fire', 'physical'), { canMiss: false });
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
    'Curse one enemy (range 15): 1d3 fire damage each turn for 4 turns, and apply 2 Fire immediately.',
  visual: { preset: 'beam', color: 0xff7a45, size: 6, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    applyDot(ctx, ctx.target, {
      name: 'Fire Curse',
      duration: 4,
      damage: dmg(2, 'fire', 'physical'),
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
    '1d6 Fire damage to one enemy (range 15), root it (movement stun) for 3 turns, and apply 2 Fire.',
  visual: { preset: 'projectile', color: 0xff5a36, size: 11, speed: 1.4 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Fire Bind'), 'fire', 'physical'));
    if (!ctx.target.alive) return;
    applyStun(ctx, ctx.target, { duration: 3, type: 'movement' });
    applyFireStacks(ctx, ctx.target, 2);
  },
});

registerSpell({
  name: 'Lightning Shatter',
  words: ['lightning', 'shatter'],
  actionType: 'main',
  range: R(5),
  targeting: 'point',
  dc: 12,
  aoe: { kind: 'cone', radius: R(5), degrees: CONE_DEGREES },
  description:
    '1d6 plus 1 damage per 6 Lightning power in a 90° cone (range 5); each enemy hit has a 25% chance to be fully stunned for 2 turns.',
  visual: { preset: 'burst', color: 0xffe45c, size: 62, speed: 1.3 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const power = lightningPower(ctx);
    const amount = rollDice(ctx, '1d6', 'Lightning Shatter') + Math.floor(power / 6);
    const hits = coneDamage(ctx, ctx.targetPoint, R(5), CONE_DEGREES, dmg(amount, 'fire', 'physical'));
    for (const h of hits) {
      if (ctx.rng.chance(0.25)) applyStun(ctx, h, { duration: 2, type: 'full' });
    }
  },
});

registerSpell({
  name: 'Lightning Corrode',
  words: ['lightning', 'corrode'],
  actionType: 'bonus',
  range: R(10),
  targeting: 'point',
  dc: 12,
  aoe: { kind: 'circle', radius: R(1.6) },
  description:
    '1d6 plus 1 damage per 8 Lightning power to all enemies in a small area (radius 1.6, range 10). Each hit has a 33% chance to take 1 corrosive damage per turn for 2 turns.',
  visual: { preset: 'burst', color: 0xc7e85c, size: 60, speed: 1.2 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const power = lightningPower(ctx);
    const amount = rollDice(ctx, '1d6', 'Lightning Corrode') + Math.floor(power / 8);
    const hits = areaDamage(ctx, ctx.targetPoint, R(1.6), dmg(amount, 'fire', 'physical'));
    for (const m of hits) {
      if (ctx.rng.chance(0.33)) {
        applyDot(ctx, m, { name: 'Corrosion', duration: 2, damage: dmg(1, 'corrosive', 'physical') });
      }
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
    'Deal 1d6 plus 1 damage per 6 Lightning power to one enemy (range 15), then leave a shadow pool at its location for 5 turns.',
  visual: { preset: 'beam', color: 0xd0e85c, size: 8, speed: 1.5 },
  cast(ctx) {
    if (!ctx.target) return;
    const power = lightningPower(ctx);
    const amount = rollDice(ctx, '1d6', 'Lightning Shadow') + Math.floor(power / 6);
    const spot = { ...ctx.target.pos };
    dealDamage(ctx, ctx.target, dmg(amount, 'fire', 'physical'));
    placeShadow(ctx, spot, 5);
  },
});

registerSpell({
  name: 'Lightning Curse',
  words: ['lightning', 'curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 12,
  description:
    'Deal 1d6 plus 1 damage per 6 Lightning power to one enemy (range 15), then curse it for 1d3 fire damage each turn for 4 turns.',
  visual: { preset: 'beam', color: 0xffc95c, size: 7, speed: 1.4 },
  cast(ctx) {
    if (!ctx.target) return;
    const power = lightningPower(ctx);
    const amount = rollDice(ctx, '1d6', 'Lightning Curse') + Math.floor(power / 6);
    dealDamage(ctx, ctx.target, dmg(amount, 'fire', 'physical'));
    if (!ctx.target.alive) return;
    applyDot(ctx, ctx.target, {
      name: 'Lightning Curse',
      duration: 4,
      damage: dmg(2, 'fire', 'physical'),
      damageSpec: '1d3',
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
    'Deal 1d6 plus 1 damage per 6 Lightning power to one enemy (range 15) and root it (movement stun) for 3 turns.',
  visual: { preset: 'beam', color: 0x6ad1ff, size: 7, speed: 1.4 },
  cast(ctx) {
    if (!ctx.target) return;
    const power = lightningPower(ctx);
    const amount = rollDice(ctx, '1d6', 'Lightning Bind') + Math.floor(power / 6);
    dealDamage(ctx, ctx.target, dmg(amount, 'fire', 'physical'));
    if (ctx.target.alive) applyStun(ctx, ctx.target, { duration: 3, type: 'movement' });
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
    dealDamage(ctx, ctx.target, dmg(amount, 'fire', 'physical'));
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
    'Chain through random unvisited allies or enemies within Lightning-power range. Each jump deals 1d6 pierce damage and roots the target (movement stun) for 2 turns; range falls by 2 each jump.',
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
      range -= R(2);
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Fire Bind Pierce'), 'fire', 'physical'), {
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
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const amount = rollDice(ctx, '1d8', 'Slash');
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
  cast(ctx) {
    const target = ctx.target ?? ctx.caster;
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
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const amount = rollDice(ctx, '1d8', 'Curse Slash');
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
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const p = ctx.targetPoint;
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
  cast(ctx) {
    if (!ctx.target) return;
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
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const amount = rollDice(ctx, '1d8', 'Order Slash');
    const hits = coneDamage(ctx, ctx.targetPoint, R(5), 120, dmg(amount, 'slashing', 'physical'));
    for (const h of hits) {
      // The "must hit a target you specify" compulsion is labelled as control;
      // the engine does not enforce the forced target choice.
      applyControl(ctx, h, { name: 'Commanded', mode: 'repeat', duration: 2 });
    }
  },
});

registerSpell({
  name: 'Order Drain',
  words: ['drain', 'order'],
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 11,
  description:
    'Every current enemy takes 1d6 corrosive damage each turn for 4 turns.',
  visual: { preset: 'nova', color: 0x9ad67a, size: 46, speed: 1.1 },
  cast(ctx) {
    // The true effect (mirror the caster's last action; punish deviating foes and
    // lifesteal 100%) is not modelled; every current enemy takes a 4-turn DoT.
    const foes = ctx.game.mages.filter((m) => m.alive && m.team !== ctx.caster.team);
    for (const m of foes) {
      applyDot(ctx, m, {
        name: "Order's Judgement",
        key: 'dot:order',
        duration: 4,
        damage: dmg(0, 'corrosive', 'physical'),
        damageSpec: '1d6',
      });
    }
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
  cast(ctx) {
    if (!ctx.target) return;
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
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const slash = rollDice(ctx, '1d6', 'Curse Drain Slash');
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
      for (let i = 0; i < stacks; i++) leech += rollDice(ctx, '1d3', 'Curse Drain Slash — leech');
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
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const p = ctx.targetPoint;
    const foes = ctx.game
      .magesInCone(ctx.caster.pos, p, R(5), 120, ctx.caster)
      .filter((m) => m.alive && m.team !== ctx.caster.team);
    if (foes.length > 0) {
      const minHp = Math.min(...foes.map((f) => f.hp));
      let mostEqualized = 0;
      for (const f of foes) {
        if (f.hp > minHp) {
          mostEqualized = Math.max(mostEqualized, f.hp - minHp);
          f.hp = minHp;
          ctx.vfx?.hit?.(f);
          ctx.vfx?.spellEffect?.(f, 'generic');
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
  async cast(ctx) {
    if (!ctx.target) return;
    const enemy = ctx.target;
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
//  SHADOW + VEIL + BIND   —   Phantom Cage
//  Root the enemy, drop a shadow on them, slip into a full veil. Reaction.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Phantom Cage',
  words: ['shadow', 'veil', 'bind'],
  set: 'finns',
  actionType: 'bonus',
  range: 0,
  targeting: 'any',
  dc: 12,
  reaction: true,
  description:
    'Root the nearest enemy within range 10 for 3 turns, place a shadow pool at its location, then gain a full veil for 2 turns. Can be cast as a reaction.',
  visual: { preset: 'nova', color: 0x8ad1ff, size: 60, speed: 1.1 },
  cast(ctx) {
    const foe = enemyNear(ctx, ctx.caster.pos, R(10));
    if (foe) {
      applyStun(ctx, foe, { duration: 3, type: 'movement' });
      placeShadow(ctx, foe.pos);
    }
    applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'full' });
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