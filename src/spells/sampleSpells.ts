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
import { CONE_DEGREES, FIELD, MELEE_RANGE, MOVE_RANGE, RANGE_UNIT, SHADOW_RADIUS } from '../config/constants';
import {
  afflictDuration,
  applyAuraDot,
  applyAnchorSpike,
  applyBlueflareStacks,
  applyControl,
  applyDebuff,
  applyDot,
  applyFireStacks,
  applyForget,
  applyInvisibility,
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
  desecrate,
  desecrateGround,
  dispelVeil,
  drainDamage,
  grantExtraTurn,
  heal,
  placeHazardZone,
  placeRealityWedge,
  placeSand,
  placeShadow,
  placeTotem,
  placeWall,
  rollDice,
  summonScarabs,
  teleport,
  twistStrike,
} from '../effects/effects';
import { registerSpell, spellById } from './registry';
import {
  applyMindLightningStack,
  closestMindLightningDirection,
  MIND_LIGHTNING_DIRECTIONS,
  mindLightningBoltTarget,
  mindLightningDamage,
  mindLightningDashCount,
} from './mindLightning';
import type { Mage } from '../core/Mage';
import {
  makeDesertblight,
  makeOrzhovSandpriest,
  makeSandPriest,
  makeSandSpear,
  makeSilencingSpike,
  makeSpectralBallista,
  makeSpitling,
  makeStandardbearer,
  makeSuckling,
} from '../core/sandSummons';
import type { EffectContext } from '../effects/effects';
import type { DotStatus } from '../core/Status';
import type { StackItem } from '../core/Stack';
import type { Spell } from './Spell';
import { splitModifiers, WORDS } from '../core/Words';
import { barrierContains } from '../core/Barrier';
import { dist, stepTowards, type Vec2 } from '../core/utils';
import './waves/corrodeOrdinary';
import './waves/veilOrdinary';
import './waves/mindOrdinary';
import './waves/waterOrdinary';
import './waves/painOrdinary';
import './waves/shadowOrdinary';
import './waves/lightningOrdinary';
import './waves/pierceOrdinary';
import './waves/drainOrdinary';
import './waves/bindOrdinary';
import './waves/curseOrdinary';
import './waves/fireOrdinary';
import './waves/godOrdinary';
import './waves/cornerOrdinary';
import { aimSpell } from './aimSpell';

/** Convert an abstract range number (5 / 10 / 15) to pixels. */
const R = (units: number): number => units * RANGE_UNIT;
const MIND_LIGHTNING_PIERCE_DC = 16;

async function stormDie(ctx: EffectContext, sides: number, label: string): Promise<number> {
  let value = rollDice(ctx, `1d${sides}`, label, ctx.caster);
  if (await ctx.requestReroll?.({ label, value, sides })) {
    value = rollDice(ctx, `1d${sides}`, `${label} reroll`, ctx.caster);
  }
  return value;
}

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
  const amplified = ctx.game.lightningAmplifier(ctx.caster);
  const power = natural + intellect + luck + amplified;
  ctx.log(
    `Lightning power: ${natural} + ${intellect} INT + ${luck} Luck${amplified ? ` + ${amplified} dark` : ''} = ${power}.`
  );
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

function segmentHitsMage(segment: TrailSegment, mage: Mage, padding = 0): boolean {
  return pointSegmentDistance(mage.pos, segment) <= mage.bodyRadius() + padding;
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
      dmg(amount, 'shatter'),
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
    dealDamage(ctx, ctx.target, dmg(amount, 'pierce'));
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
    const hits = areaDamage(ctx, ctx.targetPoint, R(1.6), dmg(amount, 'corrosive'));
    for (const m of hits) {
      if (ctx.rng.chance(0.33)) {
        applyDot(ctx, m, {
          name: 'Corrosion',
          duration: 2,
          damage: dmg(1, 'corrosive'),
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
      damage: dmg(2, 'shadow'),
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
    dealDamage(ctx, ctx.target, dmg(amount, 'sanity'));
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
    dealDamage(ctx, ctx.target, dmg(amount, 'sanity'));
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
      dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Mind Pierce'), 'pierce'));
      dealDamage(ctx, foe, dmg(rollDice(ctx, '1d4', 'Mind Pierce'), 'sanity'));
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
    dealDamage(ctx, ctx.target, dmg(amount, 'shadow'));
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
    });
  },
});

registerSpell({
  name: 'Shadow Pierce',
  words: ['shadow', 'pierce'],
  actionType: 'main',
  range: Infinity,
  targeting: 'enemy',
  dc: 12,
  reachFromShadows: R(5),
  description:
    '2d6 pierce damage to one enemy within range 5 of any of your shadows: your own, a teammate\'s or summon\'s, or a shadow pool of your side.',
  visual: { preset: 'conjure', color: 0xb09bff, size: 28, speed: 1.2 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '2d6', 'Shadow Pierce'), 'pierce'));
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
    if (foe) dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Veil Pierce'), 'pierce'));
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
      damage: dmg(0, 'pierce'),
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
      dmg(rollDice(ctx, '1d6', 'Shatter Shadow'), 'shadow'),
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d3', 'Shatter Bind'), 'shatter'));
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Shatter Corrode'), 'shatter'));
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Shatter Corrode'), 'corrosive'));
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
      dealDamage(ctx, m, dmg(rollDice(ctx, '1d6', 'Shatter Veil'), 'shatter'), {
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
      damage: dmg(0, 'shatter'),
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
      dmg(rollDice(ctx, '1d6', 'Shatter Pierce'), 'shatter'),
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
      dmg(rollDice(ctx, '2d6', 'Shatter Pierce'), 'pierce'),
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Shadow Corrode'), 'corrosive'));
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '2d6', 'Shadow Corrode'), 'shadow'));
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Bind Corrode'), 'corrosive'));
    applyStun(ctx, ctx.target, { duration: 2, type: 'movement' });
    applyDot(ctx, ctx.target, {
      name: 'Corrosion',
      duration: 3,
      damage: dmg(1, 'corrosive'),
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
      dmg(rollDice(ctx, '1d6', 'Veil Corrode'), 'corrosive')
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
      damage: dmg(2, 'shadow'),
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Pierce Corrode'), 'pierce'));
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Pierce Corrode'), 'corrosive'));
    applyDot(ctx, ctx.target, {
      name: 'Corrosion',
      duration: 2,
      damage: dmg(1, 'corrosive'),
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
        dealDamage(ctx, foe, dmg(rollDice(ctx, '1d3', 'Veil Mind Pierce'), 'sanity'));
        dealDamage(ctx, foe, dmg(rollDice(ctx, '1d3', 'Veil Mind Pierce'), 'pierce'));
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '3d3', 'Mind Twist'), 'sanity'));
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
      dmg(rollDice(ctx, '2d6', 'Mind Shatter Twist'), 'sanity')
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '4d3', 'Mind Twist Reality'), 'sanity'));
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
      dmg(rollDice(ctx, '3d6', 'Shatter Twist Reality'), 'shatter')
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
      dmg(rollDice(ctx, '2d6', 'Reality Shatter'), 'shatter')
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
          dmg(amount, 'sanity'),
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Death Corrode'), 'corrosive'));
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
      dmg(rollDice(ctx, '1d6', 'Death Drain'), 'corrosive')
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
      drainDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Corrode Drain'), 'corrosive'), {
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Umbral Rot'), 'corrosive'));
    applyDot(ctx, ctx.target, {
      name: 'Umbral Rot',
      key: 'dot:umbral-rot',
      duration: 5,
      damage: dmg(0, 'shadow'),
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
      damage: dmg(0, 'corrosive'),
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
      dmg(rollDice(ctx, '2d6', 'Umbral Dissolution'), 'corrosive')
    );
    drainDamage(ctx, ctx.target, dmg(rollDice(ctx, '2d6', 'Umbral Dissolution'), 'shadow'));
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
      dealDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Umbral Guillotine'), 'corrosive'), {
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
        dmg(rollDice(ctx, '2d6', 'Rotfeast'), 'corrosive')
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
      damage: dmg(0, 'shadow'),
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
      damage: dmg(0, 'shadow'),
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
      damage: dmg(0, 'corrosive'),
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
          dmg(rollDice(ctx, '2d6', "Reaper's Shard"), 'corrosive')
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
//  DESECRATE   (KAT: Corrode / Curse / Desecrate / Drain / Death)
// ---------------------------------------------------------------------------
//  A god-level black word. Every effect either fouls a patch of ground or lays
//  a law over the whole board, and all of them spare "kin" — black-primary
//  mages and minions (the drafted cast and anything they conjure). Wild
//  creatures are what Desecrate is for.
//
//  Corrode and Drain stay strict mirrors here as everywhere else: the Drain
//  version is the Corrode version plus lifesteal, never a sidegrade.
// ===========================================================================

registerSpell({
  name: 'Desecrate',
  words: ['desecrate'],
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 9,
  description:
    'For 3 rounds the whole battlefield is unhallowed. Every affected unit takes 1d3 shadow + 1d3 corrosive at the start of its turn and cannot be healed by anything. Black and minion units are spared.',
  visual: { preset: 'nova', color: 0x6e4d7d, size: 120, speed: 0.8 },
  cast(ctx) {
    desecrate(ctx, {
      name: 'Unhallowed Ground',
      rounds: 3,
      blocksHealing: true,
      ticks: [
        { spec: '1d3', type: 'shadow' },
        { spec: '1d3', type: 'corrosive' },
      ],
    });
  },
});

registerSpell({
  name: 'Desecrate Corrode',
  words: ['desecrate', 'corrode'],
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 11,
  aoe: { kind: 'circle', radius: R(5) },
  description:
    'Foul a range-5 circle for 4 turns. Affected units inside take 2d4 shadow at the start of their turn and cannot be healed. A turn with nothing inside costs the ground an extra turn of life.',
  visual: { preset: 'burst', color: 0x6e4d7d, size: R(5), speed: 0.9 },
  noCastSprite: true,
  cast(ctx) {
    if (!ctx.targetPoint) return;
    desecrateGround(ctx, ctx.targetPoint, {
      name: 'Fouled Ground',
      radius: R(5),
      turns: 4,
      blocksHealing: true,
      withersWhenEmpty: true,
      ticks: [{ spec: '2d4', type: 'shadow' }],
    });
  },
});

registerSpell({
  name: 'Desecrate Drain',
  words: ['desecrate', 'drain'],
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 11,
  aoe: { kind: 'circle', radius: R(5) },
  description:
    'Foul a range-5 circle for 4 turns. Affected units inside take 2d4 shadow at the start of their turn and cannot be healed; every black or minion unit anywhere on the field heals for the amount dealt. A turn with nothing inside costs the ground an extra turn of life.',
  visual: { preset: 'burst', color: 0x5f7d4d, size: R(5), speed: 0.9 },
  noCastSprite: true,
  manualCastVisual: true,
  cast(ctx) {
    if (!ctx.targetPoint) return;
    desecrateGround(ctx, ctx.targetPoint, {
      name: 'Feeding Ground',
      radius: R(5),
      turns: 4,
      blocksHealing: true,
      healKin: true,
      withersWhenEmpty: true,
      ticks: [{ spec: '2d4', type: 'shadow' }],
    });
  },
});

registerSpell({
  name: 'Desecrate Curse',
  words: ['desecrate', 'curse'],
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 11,
  aoe: { kind: 'circle', radius: R(4) },
  description:
    'Open a range-4 blight for 6 turns that widens by 2 every round. Affected units inside take 1d6 corrosive at the start of their turn and cannot be healed. Every affected unit that dies inside widens it a further 2, up to 4 in total.',
  visual: { preset: 'burst', color: 0x7d6e4d, size: R(4), speed: 0.9 },
  noCastSprite: true,
  cast(ctx) {
    if (!ctx.targetPoint) return;
    desecrateGround(ctx, ctx.targetPoint, {
      name: 'Creeping Blight',
      radius: R(4),
      turns: 6,
      blocksHealing: true,
      growPerRound: R(2),
      growOnDeath: R(2),
      growOnDeathCap: R(4),
      ticks: [{ spec: '1d6', type: 'corrosive' }],
    });
  },
});

registerSpell({
  name: 'Desecrate Death',
  words: ['desecrate', 'death'],
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 11,
  aoe: { kind: 'circle', radius: R(5) },
  description:
    'Open a range-5 sink for 5 turns. Anything inside at the start of its turn, or entering during its turn, loses a bonus action and a reaction for that cycle, and walking cannot carry it back out. Whenever anything inside dies, every unit on the field is hauled 5 toward the corpse and anything inside is dragged to the centre. Anything within range 1 of the centre below 10 health is unmade outright.',
  visual: { preset: 'nova', color: 0x4d3d5d, size: R(5), speed: 0.8 },
  noCastSprite: true,
  cast(ctx) {
    if (!ctx.targetPoint) return;
    desecrateGround(ctx, ctx.targetPoint, {
      name: 'The Sink',
      radius: R(5),
      turns: 5,
      sealed: true,
      stripsActions: true,
      pullOnDeath: R(5),
      executeRadius: R(1),
      executeBelow: 10,
      ticks: [],
    });
  },
});

registerSpell({
  name: 'Desecrate Corrode Curse',
  words: ['desecrate', 'corrode', 'curse'],
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'circle', radius: R(5) },
  description:
    'Foul a range-5 circle for 5 turns. Affected units inside take 1d3 corrosive and catch a rot that deals 1d3 per stack each turn, up to 4 stacks. The rot travels with its carrier and spreads to affected units within range 3 of one. Nothing rotting can be healed.',
  visual: { preset: 'burst', color: 0x5d6e4d, size: R(5), speed: 1 },
  noCastSprite: true,
  cast(ctx) {
    if (!ctx.targetPoint) return;
    desecrateGround(ctx, ctx.targetPoint, {
      name: 'Plaguewell',
      radius: R(5),
      turns: 5,
      blocksHealing: true,
      rot: { spec: '1d3', maxStacks: 4, spreadRadius: R(3) },
      ticks: [{ spec: '1d3', type: 'corrosive' }],
    });
  },
});

registerSpell({
  name: 'Desecrate Corrode Drain',
  words: ['desecrate', 'corrode', 'drain'],
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 13,
  description:
    'For 4 rounds the world digests them. Every affected unit takes 2d3 corrosive at the start of its turn, cannot be healed, and loses 2 maximum health, to a total of 8. You drink everything it deals. All lost maximum health returns when the combat ends.',
  visual: { preset: 'nova', color: 0x5f7d4d, size: 120, speed: 0.8 },
  manualCastVisual: true,
  cast(ctx) {
    desecrate(ctx, {
      name: 'Digestion',
      rounds: 4,
      blocksHealing: true,
      lifesteal: true,
      wither: { perTurn: 2, cap: 8 },
      ticks: [{ spec: '2d3', type: 'corrosive' }],
    });
  },
});

registerSpell({
  name: 'Desecrate Corrode Death',
  words: ['desecrate', 'corrode', 'death'],
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 13,
  description:
    'For 3 rounds every affected unit cannot be healed and takes 1d3 shadow + 1d3 cold + 1d3 corrosive at the start of its turn. Whenever any creature dies, every affected unit gains 2 Reap.',
  visual: { preset: 'nova', color: 0x6e5d4d, size: 120, speed: 0.8 },
  cast(ctx) {
    desecrate(ctx, {
      name: 'Last Harvest',
      rounds: 3,
      blocksHealing: true,
      reapOnDeath: 2,
      ticks: [
        { spec: '1d3', type: 'shadow' },
        { spec: '1d3', type: 'cold' },
        { spec: '1d3', type: 'corrosive' },
      ],
    });
  },
});

registerSpell({
  name: 'Desecrate Drain Death',
  words: ['desecrate', 'drain', 'death'],
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 13,
  description:
    'For 3 rounds every affected unit cannot be healed and takes 1d3 shadow + 1d3 cold + 1d3 corrosive at the start of its turn. Whenever any creature dies, every affected unit gains 2 Reap and every black or minion unit heals 3.',
  visual: { preset: 'nova', color: 0x4d7d6e, size: 120, speed: 0.8 },
  manualCastVisual: true,
  cast(ctx) {
    desecrate(ctx, {
      name: 'The Reaping',
      rounds: 3,
      blocksHealing: true,
      reapOnDeath: 2,
      healKinOnDeath: 3,
      ticks: [
        { spec: '1d3', type: 'shadow' },
        { spec: '1d3', type: 'cold' },
        { spec: '1d3', type: 'corrosive' },
      ],
    });
  },
});

registerSpell({
  name: 'Desecrate Curse Drain',
  words: ['desecrate', 'curse', 'drain'],
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 13,
  description:
    'For 6 rounds every point of healing an affected unit would receive anywhere on the field is tithed to you instead. They also take 1d4 shadow + 1d4 corrosive at the start of their turn.',
  visual: { preset: 'nova', color: 0x7d4d6e, size: 120, speed: 0.8 },
  manualCastVisual: true,
  cast(ctx) {
    desecrate(ctx, {
      name: 'Tithe of the Fallow',
      rounds: 6,
      redirectHealing: true,
      ticks: [
        { spec: '1d4', type: 'shadow' },
        { spec: '1d4', type: 'corrosive' },
      ],
    });
  },
});

registerSpell({
  name: 'Desecrate Curse Death',
  words: ['desecrate', 'curse', 'death'],
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'circle', radius: R(5) },
  description:
    'Consecrate a range-5 grave for 5 turns. Affected units inside take 1d6 shadow at the start of their turn, cannot be healed, and gain 2 Reap for every turn they begin there. Whenever an affected unit dies anywhere on the field the grave moves to its corpse and refreshes, at most once a round.',
  visual: { preset: 'burst', color: 0x5d4d6e, size: R(5), speed: 0.9 },
  noCastSprite: true,
  cast(ctx) {
    if (!ctx.targetPoint) return;
    desecrateGround(ctx, ctx.targetPoint, {
      name: 'Last Rites',
      radius: R(5),
      turns: 5,
      blocksHealing: true,
      reapPerTurn: 2,
      relocateOnDeath: true,
      ticks: [{ spec: '1d6', type: 'shadow' }],
    });
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
    dealDamage(ctx, ctx.target, dmg(amount, 'heat'));
    if (gamble === 'overload' && ctx.caster.alive) {
      dealDamage(ctx, ctx.caster, dmg(amount, 'heat'), { canMiss: false });
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
      dealDamage(ctx, next, dmg(amount, 'heat'), { canMiss: false });
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
  name: 'Lightning Storm',
  words: ['lightning', 'storm'],
  actionType: 'main',
  range: 0,
  targeting: 'self',
  dc: 18,
  description:
    'Roll two d20s for range, a d8 for hits, a d6 for recoil, a shared d4 for damage, and a d3 for repeat rounds. Each die may be rerolled once. Choose each eligible target once before repeating any; the same volley repeats automatically at your next upkeeps.',
  visual: { preset: 'nova', color: 0x72d7ff, size: R(10), speed: 2 },
  async cast(ctx) {
    const range = R(
      (await stormDie(ctx, 20, 'Lightning Storm range')) +
      (await stormDie(ctx, 20, 'Lightning Storm range'))
    );
    const hits = await stormDie(ctx, 8, 'Lightning Storm hits');
    const recoil = await stormDie(ctx, 6, 'Lightning Storm recoil');
    const damage = await stormDie(ctx, 4, 'Lightning Storm damage');
    const repeats = await stormDie(ctx, 3, 'Lightning Storm repeats');
    const eligible = ctx.game.mages.filter(
      (target) =>
        target !== ctx.caster &&
        target.alive &&
        dist(ctx.caster.pos, target.pos) <= range
    );
    const targetIndices: number[] = [];
    let remaining = [...eligible];
    for (let hit = 1; hit <= hits && eligible.length > 0; hit += 1) {
      if (remaining.length === 0) remaining = [...eligible].filter((target) => target.alive);
      const target = ctx.requestCombatant
        ? await ctx.requestCombatant({
            candidates: remaining,
            range,
            prompt: `Lightning Storm: choose strike ${hit}/${hits}`,
          })
        : remaining[0];
      if (!target) break;
      targetIndices.push(ctx.game.mages.indexOf(target));
      remaining = remaining.filter((candidate) => candidate !== target);
    }
    for (const targetIndex of targetIndices) {
      const target = ctx.game.mages[targetIndex];
      if (!target?.alive) continue;
      await ctx.vfx?.lightningBolt?.(ctx.caster.pos, target.pos);
      dealDamage(ctx, target, dmg(damage, 'heat'), { canMiss: false });
    }
    dealDamage(ctx, ctx.caster, dmg(recoil, 'heat'), { canMiss: false });
    addOrExtendStatus(
      ctx.caster.statuses,
      {
        key: 'lightning-storm',
        name: 'Lightning Storm',
        kind: 'lightningStorm',
        duration: repeats,
        ownerIndex: ctx.game.mages.indexOf(ctx.caster),
        targetIndices,
        damage,
        critical: !!ctx.crit,
      },
      false
    );
  },
});

registerSpell({
  name: 'Mind Storm',
  words: ['mind', 'storm'],
  actionType: 'main',
  range: R(20),
  targeting: 'point',
  dc: 18,
  aoe: { kind: 'circle', radius: R(10) },
  description:
    'Every other living entity within 10cm of a target point within 20cm becomes Foreseen for 10 turns: it cannot react and takes +20 damage.',
  visual: { preset: 'burst', color: 0xff8be0, size: R(10), speed: 1.5 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    for (const target of ctx.game.magesInRadius(ctx.targetPoint, R(10), ctx.caster)) {
      if (target === ctx.caster) continue;
      applyControl(ctx, target, { name: 'Foreseen', mode: 'expose', duration: 10 });
      applyDebuff(ctx, target, {
        name: 'Foreseen',
        key: 'mind-storm-foreseen',
        duration: 10,
        mods: { damageTaken: 20 },
      });
    }
  },
});

registerSpell({
  name: 'Fire Storm',
  words: ['fire', 'storm'],
  actionType: 'main',
  range: R(10),
  targeting: 'point',
  dc: 18,
  aoe: { kind: 'circle', radius: R(10) },
  description:
    'Choose a point within 10cm. Roll 1d8 once; every other living entity within 10cm of that point gains that many Fire stacks.',
  visual: { preset: 'burst', color: 0xff5a36, size: R(10), speed: 1.8 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const stacks = rollDice(ctx, '1d8', 'Fire Storm');
    for (const target of ctx.game.magesInRadius(ctx.targetPoint, R(10), ctx.caster)) {
      if (target !== ctx.caster) applyFireStacks(ctx, target, stacks);
    }
  },
});

registerSpell({
  name: 'Lightning Mind Storm',
  words: ['lightning', 'mind', 'storm'],
  actionType: 'main',
  range: 0,
  targeting: 'self',
  dc: 20,
  description:
    'Twice for every living entity, apply 2 Mindconduct stacks to a random living enemy. Then roll 1d10 and resolve that many normal weighted Mindconduct bolts.',
  visual: { preset: 'nova', color: 0x4ba8ff, size: R(12), speed: 2 },
  async cast(ctx) {
    const living = ctx.game.mages.filter((target) => target.alive);
    const enemies = living.filter((target) => target.team !== ctx.caster.team);
    for (let application = 0; application < living.length * 2 && enemies.length > 0; application += 1) {
      const target = ctx.rng.pick(enemies);
      applyMindLightningStack(target, 2);
      ctx.log(`${target.name} gains 2 Mind Lightning stacks (${target.lightningMindStacks}).`);
    }
    const bolts = rollDice(ctx, '1d10', 'Lightning Mind Storm bolts', ctx.caster);
    for (let bolt = 1; bolt <= bolts; bolt += 1) {
      const marked = enemies.filter((target) => target.alive && target.lightningMindStacks > 0);
      const sides = 1 + marked.reduce((total, target) => total + target.lightningMindStacks, 0);
      const route = rollDice(ctx, `1d${sides}`, `Lightning Mind Storm bolt ${bolt}`, ctx.caster);
      const target = mindLightningBoltTarget(ctx.caster, marked, route);
      await (
        ctx.vfx?.mindLightningBolt?.(ctx.caster.pos, target.pos) ??
        ctx.vfx?.lightningBolt?.(ctx.caster.pos, target.pos)
      );
      const base = rollDice(ctx, '1d3', `Lightning Mind Storm damage ${bolt}`, target);
      dealDamage(ctx, target, dmg(mindLightningDamage(base, target.lightningMindStacks), 'sanity'), {
        canMiss: false,
      });
      await ctx.resolveImpacts?.();
      if (bolt < bolts) await ctx.vfx?.pause?.(240);
    }
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
        dealDamage(ctx, target, dmg(rollDice(ctx, '20d6', 'Fire Lightning overload'), 'heat'), {
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
      dealDamage(ctx, current, dmg(amount, 'heat'), { canMiss: false });
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
        dealDamage(ctx, fork, dmg(amount, 'heat'), { canMiss: false });
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
        dmg(rollDice(ctx, ctx.crit ? '20d3' : '1d3', 'Lightning Veil'), 'heat'),
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
        dmg(rollDice(ctx, ctx.crit ? '20d3' : '1d3', 'Lightning Veil repeat'), 'heat'),
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
        dealDamage(ctx, entity, dmg(explosion, 'heat'), {
          canMiss: false,
          aoe: true,
        });
      }
      applyFireStacks(ctx, target, 2);
      return;
    }
    dash(ctx, ctx.caster, { toPoint: target.pos, distance: R(units) });
    dealDamage(ctx, target, dmg(rollDice(ctx, '1d6', 'Fire Pierce'), 'heat'), {
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
          !ctx.game.isUnreachable(entity) &&
          Math.hypot(entity.x - ctx.caster.x, entity.y - ctx.caster.y) <= range
      );
      if (candidates.length === 0) break;
      if (ctx.rng.chance(1 / Math.max(1, power))) {
        ctx.log(`${ctx.caster.name}'s Lightning Pierce misfires!`);
        dealDamage(ctx, ctx.caster, dmg(rollDice(ctx, ctx.crit ? '4d4' : '2d4', 'Lightning misfire'), 'heat'), {
          canMiss: false,
        });
        break;
      }
      const target = ctx.rng.pick(candidates);
      visited.add(target);
      const bolt = ctx.vfx?.lightningBolt?.(ctx.caster.pos, target.pos);
      blinkstep(ctx, ctx.caster, { toPoint: target.pos, distance: range });
      await bolt;
      dealDamage(ctx, target, dmg(rollDice(ctx, '2d6', 'Lightning Pierce') + Math.floor(power / 8), 'heat'), {
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
    'Deal roll-scaled Fire to health and sanity, then apply 2–4 Blueflare based on Lightning power (range 15). The target gains 1 persistent Mind Lightning stack; sanity damage scales by 50% per stack after the first.',
  visual: { preset: 'beam', color: 0x6caeff, size: 13, speed: 1.6 },
  cast(ctx) {
    if (!ctx.target) return;
    const power = lightningPower(ctx);
    const gamble = lightningGamble(ctx);
    const bonus = Math.floor(power / 6);
    const physicalAmount = rollDice(ctx, '1d6', 'Fire Lightning Mind') + bonus;
    dealDamage(ctx, ctx.target, dmg(physicalAmount, 'heat'));
    if (gamble === 'overload' && ctx.caster.alive) {
      dealDamage(ctx, ctx.caster, dmg(physicalAmount, 'heat'), { canMiss: false });
    }
    if (!ctx.target.alive) return;
    const sanityAmount = rollDice(ctx, '1d6', 'Fire Lightning Mind sanity') + bonus;
    const stacks = applyMindLightningStack(ctx.target);
    dealDamage(
      ctx,
      ctx.target,
      dmg(mindLightningDamage(sanityAmount, stacks), 'sanity')
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
        const arcStacks = applyMindLightningStack(arcTarget);
        dealDamage(ctx, arcTarget, dmg(mindLightningDamage(sanityAmount, arcStacks), 'sanity'), {
          canMiss: false,
        });
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
            'heat'
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Fire Mind Pierce'), 'heat'), {
      canMiss: false,
    });
    if (!ctx.target.alive) return;
    dealDamage(
      ctx,
      ctx.target,
      dmg(rollDice(ctx, '1d6', 'Fire Mind Pierce sanity'), 'sanity'),
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
      dealDamage(ctx, target, dmg(blast, 'heat'), { canMiss: false, aoe: true });
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
  dc: MIND_LIGHTNING_PIERCE_DC,
  noCrit: true,
  description:
    'Choose 4 different compass directions. Then dash 1d4cm, 2d4cm, 3d4cm, and 4d4cm in that order. Each enemy crossed gains 1 persistent Mind Lightning stack. Then fire 4 bolts: each rolls 1d(1 + all enemy stacks); 1 hits you and each enemy owns outcomes equal to its stacks. Each bolt deals 1d3 x 50% x (target stacks + 1) sanity.',
  visual: { preset: 'nova', color: 0x65b8ff, size: 76, speed: 1.6 },
  async cast(ctx) {
    const dashCount = mindLightningDashCount(Math.floor(MIND_LIGHTNING_PIERCE_DC / 4));
    const directionRange = Math.hypot(FIELD.w, FIELD.h);
    const remainingDirections = [...MIND_LIGHTNING_DIRECTIONS];
    const chosenDirections: Vec2[] = [];
    for (let step = 1; step <= dashCount; step += 1) {
      const origin = { ...ctx.caster.pos };
      const fallback = remainingDirections[0];
      const chosen = ctx.requestPoint
        ? await ctx.requestPoint({
            maxRange: directionRange,
            origin,
            prompt: `Lightning Mind Pierce: choose direction ${step}/${dashCount}`,
            directions: remainingDirections,
            required: true,
          })
        : { x: origin.x + fallback.x, y: origin.y + fallback.y };
      if (!chosen) return;
      const direction = closestMindLightningDirection(
        { x: chosen.x - origin.x, y: chosen.y - origin.y },
        remainingDirections
      );
      chosenDirections.push(direction);
      remainingDirections.splice(remainingDirections.indexOf(direction), 1);
    }

    for (let step = 1; step <= chosenDirections.length && ctx.caster.alive; step += 1) {
      const distance = R(
        rollDice(ctx, `${step}d4`, `Lightning Mind Pierce dash ${step}`, ctx.caster)
      );
      await ctx.resolveImpacts?.();
      const from = { ...ctx.caster.pos };
      dash(ctx, ctx.caster, {
        direction: chosenDirections[step - 1],
        distance,
      });
      const segment = { from, to: { ...ctx.caster.pos } };
      for (const enemy of ctx.game.mages) {
        if (
          enemy.alive &&
          enemy.team !== ctx.caster.team &&
          segmentHitsMage(segment, enemy, ctx.caster.bodyRadius() + 0.3)
        ) {
          applyMindLightningStack(enemy);
          ctx.log(`${enemy.name} gains 1 Mind Lightning stack (${enemy.lightningMindStacks}).`);
        }
      }
      await ctx.reactionWindow?.(`Lightning Mind Pierce dash ${step}`, ctx.caster.pos);
      if (step < chosenDirections.length) await ctx.vfx?.pause?.(420);
    }

    const marked = ctx.game.mages.filter(
      (target) =>
        target.alive &&
        target.team !== ctx.caster.team &&
        target.lightningMindStacks > 0
    );
    const sides = 1 + marked.reduce((total, target) => total + target.lightningMindStacks, 0);
    for (let boltIndex = 1; boltIndex <= dashCount; boltIndex += 1) {
      const result = rollDice(ctx, `1d${sides}`, `Lightning Mind Pierce bolt ${boltIndex}`, ctx.caster);
      const target = mindLightningBoltTarget(ctx.caster, marked, result);
      await (
        ctx.vfx?.mindLightningBolt?.(ctx.caster.pos, target.pos) ??
        ctx.vfx?.lightningBolt?.(ctx.caster.pos, target.pos)
      );
      const base = rollDice(ctx, '1d3', `Lightning Mind Pierce damage ${boltIndex}`, target);
      dealDamage(ctx, target, dmg(mindLightningDamage(base, target.lightningMindStacks), 'sanity'), {
        canMiss: false,
      });
      await ctx.resolveImpacts?.();
      if (boltIndex < dashCount) await ctx.vfx?.pause?.(240);
    }
  },
});

registerSpell({
  name: 'Faraday Veil',
  words: ['lightning', 'mind', 'veil'],
  actionType: 'main',
  range: R(20),
  targeting: 'ally',
  dc: 14,
  description:
    'Protect yourself or an ally. Direct hostile hits may be reduced by up to 90% and discharged into the strongest nearby Mind Lightning conductor; a failed route leaves the hit intact and deals power/8 sanity to the bearer. Duration and arc range scale heavily with Lightning power.',
  visual: { preset: 'heal', color: 0x65b8ff, size: 58, speed: 1.5 },
  cast(ctx) {
    const bearer = ctx.target ?? ctx.caster;
    const power = lightningPower(ctx);
    const effectivePower = power * (ctx.crit ? 2 : 1);
    addOrExtendStatus(
      bearer.statuses,
      {
        key: 'faraday-veil',
        name: 'Faraday Veil',
        kind: 'faradayVeil',
        duration: critScale(ctx, Math.max(1, Math.ceil(effectivePower / 6))),
        ownerIndex: ctx.game.mages.indexOf(ctx.caster),
        power,
        effectivePower,
        arcRange: lightningRange(ctx, Math.max(1, Math.ceil(effectivePower / 3))),
        critical: !!ctx.crit,
      },
      false
    );
    ctx.log(`${bearer.name} is protected by a ${effectivePower}-power Faraday Veil.`);
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
    'A stronger Lightning Pierce: chain up to power/3 times (rounded down) into random enemies with 5 additional range and no misfire, dealing 2d6 Fire each hit. The reach halves after every jump. The bolt always prefers a fresh body; when it has to strike the same mage twice in a row that repeat hit only deals 2d3. It never strikes you or your allies. Then roll d6, dash that far, and become invisible for 6 minus the roll turns.',
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
          entity.team !== ctx.caster.team &&
          entity.alive &&
          !ctx.game.isUnreachable(entity) &&
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
      dealDamage(ctx, target, dmg(rolled + Math.floor(power / 8), 'heat'), {
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
              if (entity === ctx.caster || !entity.alive ||
                !segmentHitsMage(segment, entity, ctx.caster.bodyRadius() + 0.3)) continue;
          ctx.vfx?.lightningImpact?.(entity.pos, RED_TRAIL_COLOR);
          dealDamage(ctx, entity, dmg(rollDice(ctx, '4d6', 'Red lightning trail', entity) + Math.floor(power / 5), 'heat'), {
            canMiss: false,
          });
        }
        if (collision) {
          ctx.log(`${ctx.caster.name} crosses the red trail and the spell collapses!`);
          await ctx.vfx?.lightningCrash?.(segment.to, RED_TRAIL_COLOR);
          dealDamage(ctx, ctx.caster, dmg(rollDice(ctx, '4d6', 'Red trail collision', ctx.caster) + Math.floor(power / 5), 'heat'), {
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
    const hits = coneDamage(ctx, ctx.targetPoint, R(5), CONE_DEGREES, dmg(amount, 'shatter'));
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
    const hits = areaDamage(ctx, ctx.targetPoint, R(1.6), dmg(amount, 'corrosive'));
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
    const hits = areaDamage(ctx, ctx.targetPoint, R(2), dmg(amount, 'heat'), { canMiss: false });
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
      damage: dmg(2, 'heat'),
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Fire Bind'), 'heat'));
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '2d6', 'Lightning Shatter'), 'shatter'));
    if (!backfired && ctx.target.alive) applyStun(ctx, ctx.target, { duration: 2, type: 'full' });
    for (const body of splash) {
      if (!body.alive) continue;
      dealDamage(ctx, body, dmg(rollDice(ctx, '1d3', 'Lightning Shatter'), 'shatter'), {
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Lightning Corrode'), 'corrosive'));
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
        dealDamage(ctx, arc.to, dmg(bite, 'corrosive'), { canMiss: false, aoe: true });
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
      dealDamage(ctx, current, dmg(dark, 'shadow'), { canMiss: false });
      if (current.alive) {
        dealDamage(ctx, current, dmg(roll - dark, 'heat'), { canMiss: false });
      }
      // Every pool already laid feeds the storm one more die.
      if (laid > 0 && current.alive) {
        dealDamage(
          ctx,
          current,
          dmg(rollDice(ctx, `${laid}d6`, 'Lightning Shadow — gathered dark'), 'shadow'),
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
      dealDamage(ctx, current, dmg(rollDice(ctx, '1d6', 'Lightning Bind'), 'heat'), {
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
    dealDamage(ctx, ctx.target, dmg(amount, 'heat'));
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
      dealDamage(ctx, target, dmg(rollDice(ctx, '1d6', 'Lightning Bind Pierce'), 'pierce'), {
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
      dealDamage(ctx, body, dmg(rollDice(ctx, spec, 'Lightning Shatter Pierce'), 'pierce'), {
        canMiss: false,
        aoe: true,
      });
      if (body.alive) applyStun(ctx, body, { duration: 2, type: 'full' });
      pierced += 1;
      if (rollDice(ctx, '1d6', 'Lightning Shatter Pierce — instability') > pierced) continue;
      ctx.log(`The charge blows out inside ${ctx.caster.name} after ${pierced} bodies.`);
      blinkstep(ctx, ctx.caster, { toPoint: body.pos, distance: lightningRange(ctx, power) });
      dealDamage(ctx, ctx.caster, dmg(rollDice(ctx, spec, 'Lightning Shatter Pierce — blowout'), 'pierce'), {
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
        dealDamage(ctx, body, dmg(grazed, 'shadow'), { canMiss: false, aoe: true });
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
        dmg(rollDice(ctx, `${grazed}d3`, 'Lightning Shadow Pierce — whiplash'), 'shadow'),
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Fire Bind Pierce'), 'heat'), {
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
        dealDamage(ctx, foe, dmg(rollDice(ctx, '1d3', 'Veil Bind Pierce'), 'pierce'));
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
    drainDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Drain'), 'corrosive'));
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
    drainDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Shadow Drain'), 'corrosive'));
    drainDamage(ctx, ctx.target, dmg(rollDice(ctx, '2d6', 'Shadow Drain'), 'shadow'));
  },
});

// Curse Drain Corrode's scarab swarm is its Life variant (spells/waves/corrodeClass.ts);
// the ordinary spell for the combo is Gnawing Curse (spells/waves/corrodeOrdinary.ts).

//  GEN EASTER-EGG SPELLS   (words: Heal / Sand / Corrode / Pierce / Shadow)
// ---------------------------------------------------------------------------
//  Heal, Sand, Corrode and Pierce are all verbs, so every combination without
//  Shadow is a class spell. Sand is the desert kingdom's whole defence: its
//  spells need sand underfoot, and they leave more of it behind.
// ===========================================================================

registerSpell({
  name: 'Heal',
  words: ['heal'],
  actionType: 'main',
  range: MELEE_RANGE,
  targeting: 'any',
  dc: 6,
  description: 'Touch one creature and restore 1d4 health. It does not have to be willing.',
  visual: { preset: 'heal', color: 0x8fe6b4, size: 40, speed: 1.2 },
  cast(ctx) {
    const target = ctx.target ?? ctx.caster;
    heal(ctx, target, rollDice(ctx, '1d4', 'Heal', target));
  },
});

registerSpell({
  name: 'Sand',
  words: ['sand'],
  actionType: 'main',
  range: R(5),
  targeting: 'point',
  dc: 7,
  description:
    'Aim at bare ground within range 5 to lay 3 charges of sand, or at a creature for 1d3 corrosive and 2 charges. '
    + 'Aim at existing sand to pick a second spot and sweep up to 3 charges there — a creature caught by the drift '
    + 'takes 1d3 corrosive per charge. The only Sand spell that needs no sand to cast.',
  visual: { preset: 'burst', color: 0xe8c98a, size: 52, speed: 1.4 },
  async cast(ctx) {
    const at = ctx.targetPoint ?? ctx.target?.pos ?? ctx.caster.pos;
    const bodyAt = (p: Vec2): Mage | undefined =>
      ctx.game.mages.find((m) => m.alive && m !== ctx.caster && dist(m.pos, p) <= m.bodyRadius());

    // Case three: aimed at sand, so this is a sweep rather than a conjuring.
    if (ctx.game.sandChargesAt(at) > 0) {
      const to = await ctx.requestPoint?.({
        maxRange: R(15),
        origin: at,
        prompt: 'Sand — pick where the drift should land.',
      });
      if (!to) return;
      const moved = ctx.game.moveSand(at, to, 3);
      if (moved <= 0) return;
      ctx.log(`${moved} charge${moved === 1 ? '' : 's'} of sand sweep across the ground.`);
      const caught = bodyAt(to);
      if (caught) {
        dealDamage(
          ctx,
          caught,
          dmg(rollDice(ctx, `${moved}d3`, 'Sand drift', caught), 'corrosive')
        );
      }
      return;
    }

    const victim = bodyAt(at);
    if (!victim) {
      placeSand(ctx, at, 3);
      return;
    }
    dealDamage(ctx, victim, dmg(rollDice(ctx, '1d3', 'Sand', victim), 'corrosive'));
    placeSand(ctx, victim.pos, 2);
  },
});

// ---------------------------------------------------------------------------
//  The conjured desert host. Every one of these is a stat block in
//  core/sandSummons.ts; the spell layer only pays the sand and places the unit.
// ---------------------------------------------------------------------------

/** Spend `cost` charges at `at`, or log why the conjuring failed. */
function paySand(ctx: EffectContext, at: Vec2, cost: number): boolean {
  if (ctx.game.spendSandAt(at, cost) < cost) {
    ctx.log(`Not enough sand there — ${cost} charges are needed.`);
    return false;
  }
  return true;
}

/** Place a finished summon and announce it. */
function raise(ctx: EffectContext, unit: Mage, kind: string): Mage {
  ctx.game.spawnSummon(unit, ctx.caster, kind);
  ctx.log(`${ctx.caster.name} raises ${unit.name}.`);
  return unit;
}

registerSpell({
  name: 'Sand Heal',
  words: ['sand', 'heal'],
  actionType: 'main',
  range: R(15),
  targeting: 'point',
  dc: 10,
  description:
    'Aim at sand within range 15 and spend 1 charge to raise a Sandsoldier-Priest: '
    + 'a floating medic whose strike heals 1d3 and cleanses, and which must eat a charge of sand every second strike.',
  visual: { preset: 'conjure', color: 0xe8c98a, size: 30, speed: 1 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at || !paySand(ctx, at, 1)) return;
    raise(ctx, makeSandPriest({ ownerName: ctx.caster.name, pos: at, team: ctx.caster.team }), 'sand-priest');
  },
});

registerSpell({
  name: 'Sand Pierce',
  words: ['sand', 'pierce'],
  actionType: 'main',
  range: R(15),
  targeting: 'point',
  dc: 10,
  description:
    'Aim at sand within range 15. Spend 4 charges for two Sandsoldier-Spears, or 2 for one. '
    + 'A Spear strikes for free at anything crossing its range 6 reach in the half-circle it faces.',
  visual: { preset: 'conjure', color: 0xd8b877, size: 32, speed: 1 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const count = ctx.game.sandChargesAt(at) >= 4 ? 2 : 1;
    if (!paySand(ctx, at, count * 2)) return;
    for (let i = 0; i < count; i++) {
      const pos = { x: at.x + (i === 0 ? 0 : RANGE_UNIT), y: at.y };
      raise(ctx, makeSandSpear({ ownerName: ctx.caster.name, pos, team: ctx.caster.team }), 'sand-spear');
    }
  },
});

registerSpell({
  name: 'Sand Corrode',
  words: ['sand', 'corrode'],
  actionType: 'main',
  range: R(15),
  targeting: 'point',
  dc: 10,
  description:
    'Aim at sand (1 charge) or at one of your own sand-born summons within range 15 to raise a Desertblight. '
    + 'It rides its host untargetably and rots every enemy within range 5 for 2d3, slowing them by 50%.',
  visual: { preset: 'conjure', color: 0xa8c07a, size: 26, speed: 1 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const host = ctx.game
      .summonsOf(ctx.caster)
      .find((s) => s.sandBorn && dist(s.pos, at) <= s.bodyRadius() + RANGE_UNIT);
    if (!host && !paySand(ctx, at, 1)) return;
    const blight = makeDesertblight({
      ownerName: ctx.caster.name,
      pos: host ? host.pos : at,
      team: ctx.caster.team,
    });
    raise(ctx, blight, 'desertblight');
    if (host) blight.attachedToIndex = ctx.game.mages.indexOf(host);
  },
});

registerSpell({
  name: 'Heal Pierce',
  words: ['heal', 'pierce'],
  actionType: 'main',
  range: R(3),
  targeting: 'point',
  dc: 10,
  description:
    'Raise a spectral ballista within range 3. It fires 1d6 piercing between range 15 and 25, '
    + 'only every second round, and heals every ally within range 2 of the impact for 2.',
  visual: { preset: 'conjure', color: 0xbfe3ff, size: 30, speed: 1 },
  cast(ctx) {
    const at = ctx.targetPoint ?? ctx.caster.pos;
    const ballista = makeSpectralBallista({ ownerName: ctx.caster.name, pos: at, team: ctx.caster.team });
    const casterTeam = ctx.caster.team;
    ballista.intrinsicMelee = {
      ...ballista.intrinsicMelee!,
      onHit: (hitCtx: EffectContext, victim: Mage) => {
        for (const ally of hitCtx.game.mages) {
          if (!ally.alive || ally.team !== casterTeam) continue;
          if (dist(ally.pos, victim.pos) > R(2)) continue;
          heal(hitCtx, ally, 2);
        }
      },
    };
    raise(ctx, ballista, 'ballista');
  },
});

registerSpell({
  name: 'Heal Corrode',
  words: ['heal', 'corrode'],
  actionType: 'main',
  range: R(10),
  targeting: 'point',
  dc: 11,
  description:
    'Aim at a corpse within range 10 and walk it upright as a Remnant. It inherits half the body\u2019s health, '
    + 'its speed and a share of its strength. Its bite halves healing and rots for 1 over 2 turns, and anything '
    + 'that dies rotting rises as another Remnant for 3 mana.',
  visual: { preset: 'conjure', color: 0x9fb87a, size: 28, speed: 1 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const corpse = ctx.game.mages.find(
      (m) => !m.alive && !m.isSummon && dist(m.pos, at) <= m.bodyRadius() + RANGE_UNIT
    );
    if (!corpse) {
      ctx.log('There is no body there to raise.');
      return;
    }
    const remnant = ctx.game.raiseRemnant(corpse, ctx.caster);
    ctx.log(`${ctx.caster.name} raises ${remnant.name}.`);
  },
});

// Pierce Corrode's Silencing Spike is its Life variant (spells/waves/corrodeClass.ts).

registerSpell({
  name: 'Sand Heal Pierce',
  words: ['sand', 'heal', 'pierce'],
  actionType: 'main',
  range: R(15),
  targeting: 'point',
  dc: 12,
  description:
    'Aim at sand within range 15. Spend 6 charges for a Sandsoldier-Standardbearer and a Spear, or 4 for the banner alone. '
    + 'Each turn the banner heals every conjured ally within range 15 for 5 and grants them range 5 of extra movement.',
  visual: { preset: 'conjure', color: 0xf0d79a, size: 36, speed: 1 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const grand = ctx.game.sandChargesAt(at) >= 6;
    if (!paySand(ctx, at, grand ? 6 : 4)) return;
    raise(ctx, makeStandardbearer({ ownerName: ctx.caster.name, pos: at, team: ctx.caster.team }), 'standardbearer');
    if (grand) {
      raise(
        ctx,
        makeSandSpear({ ownerName: ctx.caster.name, pos: { x: at.x + RANGE_UNIT, y: at.y }, team: ctx.caster.team }),
        'sand-spear'
      );
    }
  },
});

registerSpell({
  name: 'Sand Heal Corrode',
  words: ['sand', 'heal', 'corrode'],
  actionType: 'main',
  range: R(20),
  targeting: 'point',
  dc: 12,
  description:
    'Aim at one of your sand-born summons within range 20 and unmake it to raise an Orzhov-Sandpriest. '
    + 'Instead of striking it marks an enemy for 3 turns: no healing reaches them and 1d6 corrosion eats at them each turn.',
  visual: { preset: 'conjure', color: 0xe6d7b0, size: 34, speed: 1 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const offering = ctx.game
      .summonsOf(ctx.caster)
      .find((s) => s.sandBorn && dist(s.pos, at) <= s.bodyRadius() + RANGE_UNIT);
    if (!offering) {
      ctx.log('That needs one of your own sand-born summons.');
      return;
    }
    const pos = offering.pos;
    // Sacrificed, not killed: it leaves no sand behind.
    offering.sandDropOnDeath = 0;
    ctx.game.defeatMage(offering, ctx.caster, `${offering.name} is unmade for the rite.`);
    raise(ctx, makeOrzhovSandpriest({ ownerName: ctx.caster.name, pos, team: ctx.caster.team }), 'orzhov-sandpriest');
  },
});

registerSpell({
  name: 'Sand Pierce Corrode',
  words: ['sand', 'pierce', 'corrode'],
  actionType: 'main',
  range: R(15),
  targeting: 'point',
  dc: 12,
  description:
    'Aim at sand within range 15. Spend 9 charges for two Sandsoldier-Spears, or 3 for one, '
    + 'each carrying a Desertblight on its back.',
  visual: { preset: 'conjure', color: 0xc6c07a, size: 34, speed: 1 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const pairs = ctx.game.sandChargesAt(at) >= 9 ? 2 : 1;
    if (!paySand(ctx, at, pairs === 2 ? 9 : 3)) return;
    for (let i = 0; i < pairs; i++) {
      const pos = { x: at.x + i * RANGE_UNIT, y: at.y };
      const spear = raise(
        ctx,
        makeSandSpear({ ownerName: ctx.caster.name, pos, team: ctx.caster.team }),
        'sand-spear'
      );
      const blight = raise(
        ctx,
        makeDesertblight({ ownerName: ctx.caster.name, pos, team: ctx.caster.team }),
        'desertblight'
      );
      blight.attachedToIndex = ctx.game.mages.indexOf(spear);
    }
  },
});

registerSpell({
  name: 'Heal Pierce Corrode',
  words: ['heal', 'pierce', 'corrode'],
  actionType: 'main',
  range: 0,
  targeting: 'self',
  dc: 12,
  description:
    'Bind a Suckling and a Spitling to yourself. Each rides the first thing it bites. '
    + 'While both are latched the Suckling drains 2d6 corrosion a turn and the Spitling gives back half of it.',
  visual: { preset: 'conjure', color: 0xb98bff, size: 30, speed: 1 },
  cast(ctx) {
    const casterIndex = ctx.game.mages.indexOf(ctx.caster);
    const latch = (unit: Mage): void => {
      unit.intrinsicMelee = {
        ...unit.intrinsicMelee!,
        onHit: (hitCtx: EffectContext, victim: Mage) => {
          unit.attachedToIndex = hitCtx.game.mages.indexOf(victim);
        },
      };
    };
    const suckling = makeSuckling({ ownerName: ctx.caster.name, pos: ctx.caster.pos, team: ctx.caster.team });
    const spitling = makeSpitling({ ownerName: ctx.caster.name, pos: ctx.caster.pos, team: ctx.caster.team });
    latch(suckling);
    latch(spitling);
    raise(ctx, suckling, 'suckling');
    raise(ctx, spitling, 'spitling');
    suckling.attachedToIndex = casterIndex;
    spitling.attachedToIndex = casterIndex;
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
      dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Umbral Lance'), 'shadow'));
      dealDamage(ctx, foe, dmg(rollDice(ctx, '1d3', 'Umbral Lance'), 'sanity'));
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
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Skullpierce'), 'pierce'));
    dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Skullpierce'), 'sanity'));
    if (foe.alive && (foe.hp <= foe.maxHp * 0.25 || foe.sanity <= foe.maxSanity * 0.25)) {
      ctx.log(`${foe.name} is broken open — the lance finds the crack.`);
      dealDamage(ctx, foe, dmg(rollDice(ctx, '3d6', 'Skullpierce — execute'), 'pierce'), {
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
      dmg(rollDice(ctx, '1d6', 'Null Pulse'), 'shatter'),
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
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d4', 'Mind Fracture'), 'shatter'));
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d4', 'Mind Fracture'), 'sanity'));
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
      dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '2d6', 'Venomfang'), 'corrosive'));
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '2d6', 'Venomfang'), 'corrosive'));
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Venomfang'), 'shadow'));
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
      dmg(rollDice(ctx, '1d6', 'Dreambreaker'), 'shatter')
    );
    for (const m of hits) {
      if (m.isInvisible() || m.statuses.some((s) => s.kind === 'shadowVeil')) {
        dealDamage(
          ctx,
          m,
          dmg(rollDice(ctx, '1d6', 'Dreambreaker — nightmare'), 'shatter'),
          { canMiss: false }
        );
        dispelVeil(ctx, m);
      }
      applyDot(ctx, m, {
        name: 'Nightmare',
        duration: 3,
        damage: dmg(2, 'sanity'),
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
        damage: dmg(2, 'shadow'),
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
      damage: dmg(1, 'corrosive'),
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
      dmg(rollDice(ctx, '2d6', 'Sealing Cage'), 'shatter'),
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
        dealDamage(ctx, foe, dmg(rollDice(ctx, '1d3', 'Threaded Run'), 'sanity'), {
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
      dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Shadow spike'), 'pierce'), {
        canMiss: false,
      });
      if (foe.alive) {
        dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Shadow spike'), 'shatter'), {
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
      dmg(rollDice(ctx, sweet ? '3d6' : '2d6', 'Walking Wound'), 'pierce')
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '2d6', 'Remembering Needle'), 'sanity'));
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
      dmg(shatter, 'shatter'),
      { canMiss: false }
    )) {
      if (!foe.alive) continue;
      dealDamage(ctx, foe, dmg(mill, 'sanity'), { canMiss: false, aoe: true });
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
    const rot = dealDamage(ctx, ctx.target, dmg(split, 'corrosive'));
    if (!ctx.target.alive) return;
    const mill = dealDamage(ctx, ctx.target, dmg(20 - split, 'sanity'));
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
    'Root one enemy for 3 turns and deal 1d6 sanity (range 10). While the shackle holds, everything it declares is eaten: a weapon strike makes it forget how to attack, and a spell makes it forget every word that spell used, for 3 turns each.',
  visual: { preset: 'beam', color: 0xc6f08a, size: 7, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Memory Shackle'), 'sanity'));
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
      dealDamage(ctx, foe, dmg(rollDice(ctx, '3d6', 'Shadow Veil Pierce'), 'pierce'));
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
      dmg(rollDice(ctx, '1d6', 'Blightburst'), 'shatter'),
      { canMiss: false }
    );
    for (const m of hits) {
      dealDamage(ctx, m, dmg(rollDice(ctx, '1d6', 'Blightburst'), 'corrosive'), {
        aoe: true,
        canMiss: false,
      });
      if (ctx.rng.chance(0.25)) applyStun(ctx, m, { duration: 2, type: 'full' });
      applyStackingDot(ctx, m, {
        name: 'Blight',
        damage: dmg(1, 'corrosive'),
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '2d6', 'Shadow Veil Bind'), 'shadow'));
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Calcifying Strike'), 'shatter'));
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Calcifying Strike'), 'corrosive'));
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
      damage: dmg(2, 'sanity'),
      damageSpec: '1d3',
    });
    applyDot(ctx, ctx.target, {
      name: 'Corrosive Plague',
      key: 'dot:mindPlague:corrode',
      duration: 4,
      damage: dmg(1, 'corrosive'),
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '2d6', 'Harrowing Lance'), 'pierce'));
    applyDot(ctx, ctx.target, {
      name: 'Harrowing Lance',
      duration: 3,
      damage: dmg(0, 'shatter'),
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
    dealDamage(ctx, focus, dmg(corrosive, 'corrosive'));
    if (focus.alive) {
      dealDamage(ctx, focus, dmg(roll - corrosive, 'shadow'), { canMiss: false });
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
          dmg(rollDice(ctx, '1d3', `Shadow Shatter Corrode — ${type}`), type),
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
      damage: dmg(0, 'corrosive'),
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Corrode Curse Pierce'), 'pierce'));
    if (!ctx.target.alive) return;
    applyDot(ctx, ctx.target, {
      name: 'Suppurating Wound',
      key: 'dot:suppurating-wound',
      duration: 3,
      damage: dmg(0, 'corrosive'),
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
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Veil Shatter Pierce'), 'pierce'), {
      canMiss: false,
    });
    if (!wasVeiled) {
      applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'partial' });
      return;
    }
    if (foe.alive) {
      dealDamage(ctx, foe, dmg(rollDice(ctx, '1d12', 'Veil Shatter Pierce — unveiling'), 'shatter'), {
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '2d6', 'Bind Shatter Pierce'), 'pierce'));
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
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Shatter Corrode Pierce'), 'shatter'), {
      trueDamage: true,
      canMiss: false,
    });
    if (!foe.alive) return;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Shatter Corrode Pierce'), 'pierce'), {
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Bind Curse Pierce'), 'pierce'));
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Mind Corrode Pierce'), 'pierce'));
    if (!ctx.target.alive) return;
    applyDot(ctx, ctx.target, {
      name: 'Neural Virus',
      key: 'dot:neural-virus',
      duration: 4,
      damage: dmg(0, 'sanity'),
      escalateSpecs: ['1d4', '1d6', '1d8', '1d10'],
      forgetPerTick: 1,
      jumpOnMindBreakRadius: R(4),
    });
  },
});

// ===========================================================================
//  THE LAST STANDARD 3-WORD COMBINATIONS   (set: 'finns')
// ---------------------------------------------------------------------------
//  With these, every 1-3 word combination of the eight standard words is a
//  spell. Colour majority still decides character; a combo with one word of
//  each colour gives every word one job. Shadow Shatter Curse stays Black Bell
//  for Objects — the spell here is what Life and Hexcraft cast.
// ===========================================================================

// ---------------------------------------------------------------------------
//  BIND + VEIL + SHATTER
//  Blue-dominant: an illusion that fights back. A struck double shatters into
//  its attacker and pins it.
// ---------------------------------------------------------------------------
const GLASS_DOUBLES = 3;

registerSpell({
  name: 'Glass Doubles',
  words: ['bind', 'veil', 'shatter'],
  set: 'finns',
  actionType: 'bonus',
  range: R(8),
  targeting: 'any',
  dc: 13,
  reaction: true,
  description:
    'Range 8cm. A chosen mage gains 3 glass doubles for 3 turns. A targeted attack on it hits a double instead 75% of the time (67% with 2 left, 50% with 1): the attack deals nothing, the double shatters, and the attacker takes 1d4 shatter and is rooted for 1 turn. Area effects ignore the doubles. Can be cast as a reaction.',
  visual: { preset: 'heal', color: 0xcfe8f5, size: 48, speed: 1.1 },
  cast(ctx) {
    const bearer = ctx.target ?? ctx.caster;
    addOrExtendStatus(
      bearer.statuses,
      {
        key: 'mirrorImages',
        name: `Glass Doubles ×${GLASS_DOUBLES}`,
        kind: 'mirrorImages',
        duration: critScale(ctx, 3),
        images: GLASS_DOUBLES,
      },
      false
    );
    ctx.vfx?.spellEffect?.(bearer, 'vanish');
    ctx.log(`${bearer.name} is surrounded by ${GLASS_DOUBLES} glass doubles.`);
  },
});

// ---------------------------------------------------------------------------
//  BIND + VEIL + CURSE
//  Blue-dominant sleight of hand: you take its place, it takes yours, and it
//  cannot walk back out of the trade.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Veiled Exchange',
  words: ['bind', 'veil', 'curse'],
  set: 'finns',
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'Range 15cm. Trade places with one enemy. It is rooted for 1 turn and takes 1d4 shadow at its turn start for 4 turns. You gain a half veil for 2 turns. An enemy that cannot be moved is only rooted and cursed.',
  visual: { preset: 'beam', color: 0x9d8bd8, size: 7, speed: 1.2 },
  cast(ctx) {
    if (!ctx.target) return;
    const foe = ctx.target;
    if (foe.displacementImmune) {
      ctx.log(`${foe.name} cannot be moved.`);
    } else {
      const mine = { x: ctx.caster.x, y: ctx.caster.y };
      const theirs = { x: foe.x, y: foe.y };
      teleport(ctx, ctx.caster, theirs, foe);
      teleport(ctx, foe, mine);
    }
    applyStun(ctx, foe, { duration: 2, type: 'movement' });
    applyDot(ctx, foe, {
      name: 'Exchange Curse',
      key: 'dot:veiled-exchange',
      duration: 4,
      damage: dmg(0, 'shadow'),
      damageSpec: '1d4',
    });
    applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'partial' });
  },
});

// ---------------------------------------------------------------------------
//  BIND + SHATTER + CURSE
//  One job per colour: blue holds it still, black lets the stone set,
//  colourless breaks the statue. Only healing cracks the stone back.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Stone Curse',
  words: ['bind', 'shatter', 'curse'],
  set: 'finns',
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 14,
  description:
    'Range 12cm. The target turns to stone over its next 3 turns: slowed 50%, then rooted, then fully stunned with shatter damage against it doubled. When the third turn ends it shatters: 3d6 shatter to it and 1d6 shatter to every unit within 3cm, allies included. Each heal it receives undoes one stage; undoing the first ends the curse.',
  visual: { preset: 'beam', color: 0xa8a39a, size: 8, speed: 0.9 },
  cast(ctx) {
    if (!ctx.target) return;
    ctx.game.petrify(ctx.caster, ctx.target);
  },
});

// ---------------------------------------------------------------------------
//  BIND + CORRODE + PIERCE
//  One job per colour: the bolt goes through, the rivet holds, the rust bites.
//  With nobody behind the target, it is nailed to the ground instead.
// ---------------------------------------------------------------------------
const RIVET_REACH = R(5);

registerSpell({
  name: 'Riveting Bolt',
  words: ['bind', 'corrode', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 14,
  description:
    'Range 12cm. 2d6 pierce to one enemy. The bolt carries on through it: the first other enemy within 5cm behind it takes 1d6 pierce, is pulled against it, and the two are riveted for 3 turns. Whenever either moves, the other is dragged along. With nobody behind it, the target is rooted for 3 turns instead. Every body hit takes 1d4 corrosive at its turn start for 3 turns.',
  visual: { preset: 'projectile', color: 0xb0a070, size: 9, speed: 2 },
  cast(ctx) {
    if (!ctx.target) return;
    const foe = ctx.target;
    const heading = Math.atan2(foe.y - ctx.caster.y, foe.x - ctx.caster.x);
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Riveting Bolt'), 'pierce'));
    if (!foe.alive) return;
    const line = {
      from: foe.pos,
      to: { x: foe.x + Math.cos(heading) * RIVET_REACH, y: foe.y + Math.sin(heading) * RIVET_REACH },
    };
    const second = ctx.game.mages
      .filter(
        (m) =>
          m !== foe &&
          m !== ctx.caster &&
          m.alive &&
          m.team !== ctx.caster.team &&
          !ctx.game.isUnreachable(m) &&
          (m.x - foe.x) * Math.cos(heading) + (m.y - foe.y) * Math.sin(heading) > 0 &&
          pointSegmentDistance(m.pos, line) <= m.bodyRadius()
      )
      .sort((a, b) => dist(a.pos, foe.pos) - dist(b.pos, foe.pos))[0];
    const struck = [foe];
    if (second) {
      dealDamage(ctx, second, dmg(rollDice(ctx, '1d6', 'Riveting Bolt', second), 'pierce'), {
        canMiss: false,
      });
      if (second.alive) {
        struck.push(second);
        const leash = foe.bodyRadius() + second.bodyRadius() + 6;
        const gap = dist(second.pos, foe.pos);
        if (gap > leash) ctx.game.forceMove(ctx.caster, second, stepTowards(second.pos, foe.pos, gap - leash));
        ctx.game.rivet(foe, second, leash, critScale(ctx, 3));
      }
    }
    if (struck.length === 1) applyStun(ctx, foe, { duration: 3, type: 'movement' });
    for (const body of struck) {
      if (!body.alive) continue;
      applyDot(ctx, body, {
        name: 'Rusted Rivet',
        key: 'dot:rusted-rivet',
        duration: 3,
        damage: dmg(0, 'corrosive'),
        damageSpec: '1d4',
      });
    }
  },
});

// ---------------------------------------------------------------------------
//  VEIL + MIND + SHATTER
//  Blue-dominant counter-magic: the veil turns their spell away, the mind takes
//  it, the shatter breaks whatever cannot be taken.
// ---------------------------------------------------------------------------

registerSpell({
  name: 'Stolen Thought',
  words: ['veil', 'mind', 'shatter'],
  set: 'finns',
  actionType: 'bonus',
  range: 0,
  targeting: 'none',
  dc: 13,
  reaction: true,
  counters: true,
  minStackDepth: 1,
  description:
    'Reaction only. Counter the action you answer. A countered spell becomes yours: cast it at once with new targets, at no cost. Any other countered action deals 2d6 sanity to whoever took it.',
  visual: { preset: 'nova', color: 0xe3a8ff, size: 56, speed: 1.4 },
  async cast(ctx) {
    const answered = ctx.game.counteredItem;
    // Taken once: a stolen Stolen Thought must find nothing left to steal.
    ctx.game.counteredItem = null;
    if (!answered || answered.windowTrigger) {
      ctx.log(`${ctx.caster.name} finds nothing to take.`);
      return;
    }
    const stolen = answered.kind === 'spell' ? answered.spell : undefined;
    if (!stolen) {
      if (answered.source.alive) {
        dealDamage(
          ctx,
          answered.source,
          dmg(rollDice(ctx, '2d6', 'Stolen Thought'), 'sanity'),
          { canMiss: false }
        );
      }
      return;
    }
    const aim = await aimSpell(ctx, stolen, answered);
    if (!aim) {
      ctx.log(`${ctx.caster.name} lets the stolen ${stolen.name} fade.`);
      return;
    }
    ctx.log(`${ctx.caster.name} casts the stolen ${stolen.name}.`);
    await stolen.cast(ctx.game.effectContext(ctx.caster, aim.target, aim.point, aim.point2));
  },
});

// ---------------------------------------------------------------------------
//  VEIL + MIND + CORRODE
//  Blue-dominant: you are not hidden from the world, only eaten out of one
//  mind, and the hole rots wider every turn it stays open.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Blind Spot',
  words: ['veil', 'mind', 'corrode'],
  set: 'finns',
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'Range 15cm. 1d6 sanity. For 2 turns the target cannot perceive you: it cannot target you with attacks or spells, though its area effects still reach you. Its mind rots at its turn start for 3 turns: 1d4, then 1d6, then 1d8 sanity.',
  visual: { preset: 'beam', color: 0xb7c98f, size: 7, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    const foe = ctx.target;
    if (foe.consumeWard('mind')) {
      ctx.log(`${foe.name}'s Mind Dodge negates Blind Spot.`);
      return;
    }
    dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Blind Spot'), 'sanity'));
    if (!foe.alive) return;
    if (foe.isDebuffImmune() || foe.controlImmune || foe.isImmuneTo('sanity')) {
      ctx.log(`${foe.name} has no mind to empty.`);
      return;
    }
    const casterIndex = ctx.game.mages.indexOf(ctx.caster);
    addOrExtendStatus(
      foe.statuses,
      {
        key: `blindSpot:${casterIndex}`,
        name: 'Blind Spot',
        kind: 'blindSpot',
        duration: afflictDuration(ctx, foe, 3),
        hiddenIndex: casterIndex,
      },
      false
    );
    applyDot(ctx, foe, {
      name: 'Mind Rot',
      key: 'dot:blind-spot',
      duration: 3,
      damage: dmg(0, 'sanity'),
      escalateSpecs: ['1d4', '1d6', '1d8'],
    });
    ctx.log(`${foe.name} can no longer perceive ${ctx.caster.name}.`);
  },
});

// ---------------------------------------------------------------------------
//  VEIL + SHATTER + CORRODE
//  One job per colour: the veil blinds, the glass stands, the acid waits for it
//  to fall.
// ---------------------------------------------------------------------------
const CURTAIN_LENGTH = R(6);
const CURTAIN_THICKNESS = 18;

registerSpell({
  name: 'Caustic Curtain',
  words: ['veil', 'shatter', 'corrode'],
  set: 'finns',
  actionType: 'main',
  range: R(10),
  targeting: 'point',
  rotatableWall: { length: CURTAIN_LENGTH, thickness: CURTAIN_THICKNESS },
  dc: 14,
  noCastSprite: true,
  description:
    'Raise a 6cm glass curtain within 10cm for 3 rounds; [H] rotates it while aiming. Nothing can walk through it, and no attack or enemy-targeted spell can cross it. Area effects pass. When it falls it shatters: every unit within 2cm of it takes 1d6 shatter and 1d6 corrosive, allies included.',
  visual: { preset: 'burst', color: 0xbfe3e8, size: 40, speed: 1 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    placeWall(ctx, ctx.targetPoint, {
      angle: ctx.caster.wallAngle,
      length: CURTAIN_LENGTH,
      thickness: CURTAIN_THICKNESS,
      ttl: critScale(ctx, 3),
      opaque: true,
      burst: {
        radius: R(2),
        hits: [
          { spec: '1d6', type: 'shatter' },
          { spec: '1d6', type: 'corrosive' },
        ],
      },
    });
  },
});

// ---------------------------------------------------------------------------
//  VEIL + CURSE + PIERCE
//  One job per colour: stay hidden, let the curse build, the arrows do the
//  rest. Every turn you are seen, the archer holds.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Unseen Volley',
  words: ['veil', 'curse', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 14,
  description:
    "Range 15cm. You gain a half veil for 3 turns. For 3 turns, at the target's turn start, an arrow strikes it while you are hidden: 1d6 pierce, then 2d6, then 3d6. A turn you are not hidden is skipped and does not advance the volley.",
  visual: { preset: 'projectile', color: 0xc9b8e8, size: 7, speed: 2 },
  cast(ctx) {
    if (!ctx.target) return;
    applyInvisibility(ctx, ctx.caster, { duration: 3, mode: 'partial' });
    applyDot(ctx, ctx.target, {
      name: 'Unseen Volley',
      key: 'dot:unseen-volley',
      duration: 3,
      damage: dmg(0, 'pierce'),
      escalateSpecs: ['1d6', '2d6', '3d6'],
      whileSourceVeiled: true,
    });
  },
});

// ---------------------------------------------------------------------------
//  MIND + SHATTER + CORRODE
//  One job per colour: the blow stuns, the mind is split open, the rot eats a
//  word out of it. Charges never come back.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Lobotomy',
  words: ['mind', 'shatter', 'corrode'],
  set: 'finns',
  actionType: 'main',
  range: R(5),
  targeting: 'enemy',
  dc: 14,
  description:
    'Range 5cm. 1d6 shatter and 2d6 sanity to one enemy, and it is fully stunned for 1 turn. Its most-charged word loses 1d4 charges. A target with no charged words takes another 2d6 sanity instead.',
  visual: { preset: 'conjure', color: 0xb8c07a, size: 34, speed: 1.3 },
  cast(ctx) {
    if (!ctx.target) return;
    const foe = ctx.target;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Lobotomy'), 'shatter'));
    if (!foe.alive) return;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Lobotomy'), 'sanity'));
    if (!foe.alive) return;
    applyStun(ctx, foe, { duration: 2, type: 'full' });
    const charged = splitModifiers(foe.loadout).base.filter((word) => (foe.charges[word] ?? 0) > 0);
    if (charged.length === 0) {
      dealDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Lobotomy'), 'sanity'), { canMiss: false });
      return;
    }
    const richest = charged.reduce((best, word) =>
      (foe.charges[word] ?? 0) > (foe.charges[best] ?? 0) ? word : best
    );
    const lost = Math.min(foe.charges[richest] ?? 0, rollDice(ctx, '1d4', 'Lobotomy charges', foe));
    foe.charges[richest] = (foe.charges[richest] ?? 0) - lost;
    ctx.log(`${foe.name} loses ${lost} ${WORDS[richest].label} charge${lost === 1 ? '' : 's'}.`);
  },
});

// ---------------------------------------------------------------------------
//  SHADOW + SHATTER + CURSE   (Life and Hexcraft; Objects conjures Black Bell)
//  Black-dominant: the Bell's two modes in one peal, on both sides. What
//  already suffers is cashed out at once; what does not is tolled for later.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Condensing Toll',
  words: ['shadow', 'shatter', 'curse'],
  set: 'finns',
  actionType: 'main',
  range: R(10),
  targeting: 'point',
  dc: 15,
  aoe: { kind: 'circle', radius: R(3) },
  description:
    'Tolls every unit within 3cm of a point in range 10cm, allies and you included. An afflicted unit is condensed: its remaining DoT damage lands at once as half shatter and half shadow, its other afflictions are removed, and a shadow opens beneath it, 1cm wider per non-damaging affliction removed. An unafflicted unit takes 1d6 shatter and 1d3 shadow at its turn start for 6 turns, 9 if it stands in a shadow.',
  visual: { preset: 'burst', color: 0x7658b8, size: R(3), speed: 0.9 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const caught = ctx.game.magesInRadius(ctx.targetPoint, R(3));
    const peal = rollDice(ctx, '1d6', 'Condensing Toll');
    for (const unit of caught) {
      if (!unit.alive) continue;
      if (ctx.game.hasCondensableAffliction(unit)) {
        ctx.game.condenseWithBlackBell(ctx.caster, unit);
        continue;
      }
      dealDamage(ctx, unit, dmg(peal, 'shatter'), { canMiss: false, aoe: true });
      if (!unit.alive) continue;
      applyDot(ctx, unit, {
        name: 'Toll',
        key: 'dot:condensing-toll',
        duration: ctx.game.isInShadow(unit) ? 9 : 6,
        damage: dmg(0, 'shadow'),
        damageSpec: '1d3',
      });
    }
  },
});

// ===========================================================================
//  THE GOD WORDS   (Death / Desecrate / Reality / Stop — set: 'finns')
// ---------------------------------------------------------------------------
//  The four god words join the eight standard words. Death and Desecrate never
//  share a spell with blue; Reality and Stop never share one with black. Their
//  combinations stand above the ordinary 3-word band: longer reach, harder
//  rules, and an authored flourish of their own (VfxSink.godFx).
//
//  Desecrate keeps its universal filter: it only ever harms affected units,
//  never black-primary units or minions. Where the colourless words hold the
//  majority, the damage is theirs and lands on enemies as usual; Desecrate's
//  one job there is the fouled ground.
// ===========================================================================

/** Where a ray from `from` through `toward` leaves the field. */
function rayToFieldEdge(from: Vec2, toward: Vec2): Vec2 {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  let t = Infinity;
  if (ux > 1e-6) t = Math.min(t, (FIELD.x + FIELD.w - from.x) / ux);
  if (ux < -1e-6) t = Math.min(t, (FIELD.x - from.x) / ux);
  if (uy > 1e-6) t = Math.min(t, (FIELD.y + FIELD.h - from.y) / uy);
  if (uy < -1e-6) t = Math.min(t, (FIELD.y - from.y) / uy);
  if (!Number.isFinite(t)) t = 0;
  return { x: from.x + ux * t, y: from.y + uy * t };
}

/** The end of a lane `length` long from `from` toward `toward`, stopping at the field edge. */
function laneEnd(from: Vec2, toward: Vec2, length: number): Vec2 {
  const edge = rayToFieldEdge(from, toward);
  return dist(from, edge) <= length ? edge : stepTowards(from, edge, length);
}

/** Every living body but the caster touching a lane, nearest first. Either side. */
function bodiesOnLane(ctx: EffectContext, from: Vec2, to: Vec2, pad: number): Mage[] {
  return ctx.game.mages
    .filter(
      (m) =>
        m.alive &&
        m !== ctx.caster &&
        pointSegmentDistance(m.pos, { from, to }) <= m.bodyRadius() + pad
    )
    .sort((a, b) => dist(from, a.pos) - dist(from, b.pos));
}

/** Add named words or actions to what `target` has forgotten, keeping the old ones. */
function forgetTokens(ctx: EffectContext, target: Mage, tokens: string[], duration: number): void {
  if (tokens.length === 0 || !target.alive) return;
  if (target.isDebuffImmune()) {
    ctx.log(`${target.name} is immune to debuffs and forgets nothing.`);
    return;
  }
  addOrExtendStatus(
    target.statuses,
    {
      key: 'forget',
      name: 'Forgotten',
      kind: 'forget',
      duration: afflictDuration(ctx, target, duration),
      forgotten: [...new Set([...target.forgotten(), ...tokens])],
    },
    false
  );
  ctx.log(`${target.name} forgets ${tokens.join(' & ')}.`);
}

/** A mind that cannot be reached: warded, immune, or out of reality. Logs why. */
function mindShielded(ctx: EffectContext, foe: Mage): boolean {
  if (ctx.game.isUnreachable(foe)) return true;
  if (foe.isDebuffImmune() || foe.controlImmune) {
    ctx.log(`${foe.name}'s mind cannot be touched.`);
    return true;
  }
  if (foe.consumeWard('mind')) {
    ctx.log(`${foe.name}'s Mind Dodge negates it.`);
    return true;
  }
  return false;
}

/** A plain affliction status on a foe, honouring debuff immunity. Returns whether it held. */
function afflict(ctx: EffectContext, foe: Mage, status: Parameters<typeof addOrExtendStatus>[1]): boolean {
  if (!foe.alive || ctx.game.isUnreachable(foe)) return false;
  if (foe.isDebuffImmune()) {
    ctx.log(`${foe.name} is immune to debuffs. ${status.name} fails.`);
    return false;
  }
  addOrExtendStatus(foe.statuses, status, false);
  return true;
}

/** Heading from the caster to `at`, for directional art. */
function headingTo(ctx: EffectContext, at: Vec2): number {
  return Math.atan2(at.y - ctx.caster.y, at.x - ctx.caster.x);
}

// ---------------------------------------------------------------------------
//  DEATH + SHADOW + SHATTER
//  A bell of bone. Shadow amplifies what Death has already claimed: every
//  survivor's Reap doubles before the headsman's count.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Knell of Endings',
  words: ['death', 'shadow', 'shatter'],
  set: 'finns',
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 15,
  aoe: { kind: 'circle', radius: R(3) },
  noCastSprite: true,
  description:
    "A bell of bone tolls at a point within 12cm. Everything within 3cm, allies and you included, takes 2d6 shatter and is stunned for 1 turn. Each survivor's Reap doubles, gaining at least 2, then it is executed for 4. Leaves a shadow.",
  visual: { preset: 'burst', color: 0x8a6bff, size: R(3), speed: 0.8 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const at = ctx.targetPoint;
    ctx.vfx?.godFx?.('deathMark', at, { size: R(3) * 2.4 });
    ctx.vfx?.godFx?.('cataclysm', at, { size: R(3) * 2.6 });
    const caught = ctx.game.magesInRadius(at, R(3));
    const toll = rollDice(ctx, '2d6', 'Knell of Endings');
    for (const unit of caught) {
      if (!unit.alive) continue;
      dealDamage(ctx, unit, dmg(toll, 'shatter'), { canMiss: false, aoe: true });
      if (!unit.alive) continue;
      applyStun(ctx, unit, { duration: 2, type: 'full' });
      ctx.game.applyReap(unit, Math.max(2, ctx.game.reapOn(unit)), ctx.caster);
      if (unit.alive) ctx.game.executeTarget(ctx.caster, unit, 4);
    }
    placeShadow(ctx, at, 3);
  },
});

// ---------------------------------------------------------------------------
//  DEATH + SHADOW + PIERCE
//  The shot from the dark. It executes by fraction, not by number: the bigger
//  the body, the sooner it is over, and a shadow doubles the fraction.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Nightshot',
  words: ['death', 'shadow', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: R(25),
  bonusRangeInOwnShadow: R(99),
  targeting: 'enemy',
  ignoresStealth: true,
  dc: 15,
  description:
    'Shoot one enemy within 25cm, or anywhere if it stands in your shadow. Ignores concealment and cannot miss: 2d6 pierce, then it is executed at 25% of its maximum health, or 50% if it stands in any shadow. A kill leaves a shadow where it fell.',
  visual: { preset: 'beam', color: 0x6b5a9c, size: 6, speed: 1.6 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    ctx.vfx?.godFx?.('void', foe.pos, { size: foe.bodyRadius() * 4 });
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Nightshot'), 'pierce'), { canMiss: false });
    if (foe.alive) {
      const share = ctx.game.isInShadow(foe) ? 0.5 : 0.25;
      ctx.game.executeTarget(ctx.caster, foe, Math.floor(foe.maxHp * share));
    }
    if (foe.alive) return;
    ctx.vfx?.godFx?.('skull', foe.pos, { size: foe.bodyRadius() * 5 });
    placeShadow(ctx, foe.pos, 3);
  },
});

// ---------------------------------------------------------------------------
//  DEATH + CORRODE + SHATTER
//  Rot the body itself, then break what is left. The withered health does not
//  come back until the fight is over.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Crumble',
  words: ['death', 'corrode', 'shatter'],
  set: 'finns',
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 15,
  description:
    'Deal 2d6 corrosive to one enemy within 10cm. Its maximum health withers by the damage dealt until the combat ends. If it is then at or below half its maximum health, its bones give way: it is stunned for 1 turn and executed for 6, and bone shards deal 1d6 shatter to everything else within 2cm.',
  visual: { preset: 'conjure', color: 0x9aa877, size: 40, speed: 1.1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    ctx.vfx?.godFx?.('hex', foe.pos, { size: foe.bodyRadius() * 5 });
    const dealt = dealDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Crumble'), 'corrosive'));
    if (!foe.alive || dealt <= 0) return;
    const bite = Math.max(0, Math.min(dealt, foe.maxHp - 1));
    foe.maxHp -= bite;
    foe.witheredMaxHp += bite;
    foe.hp = Math.min(foe.hp, foe.maxHp);
    ctx.log(`${foe.name} withers: ${bite} maximum health is gone.`);
    if (foe.hp > foe.maxHp / 2) return;
    ctx.log(`${foe.name}'s bones give way.`);
    ctx.vfx?.godFx?.('skull', foe.pos, { size: foe.bodyRadius() * 5, color: 0xc9d1a0 });
    const shards = ctx.game.magesInRadius(foe.pos, R(2), foe);
    applyStun(ctx, foe, { duration: 2, type: 'full' });
    ctx.game.executeTarget(ctx.caster, foe, 6);
    if (shards.length === 0) return;
    const shard = rollDice(ctx, '1d6', 'Bone shards');
    for (const unit of shards) {
      if (unit.alive) dealDamage(ctx, unit, dmg(shard, 'shatter'), { canMiss: false, aoe: true });
    }
  },
});

// ---------------------------------------------------------------------------
//  DEATH + CORRODE + PIERCE
//  A needle that does not care what is in its way. The wound it leaves turns
//  mending into more death.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Mortal Wound',
  words: ['death', 'corrode', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 15,
  description:
    'A needle flies 20cm through one enemy within 20cm and everything else in its path, allies included. Each body takes 2d6 pierce and a mortal wound for 4 turns: 1d6 corrosive at the start of its turn, and every heal it receives becomes that much Reap instead.',
  visual: { preset: 'beam', color: 0x7f9a6a, size: 5, speed: 1.8 },
  cast(ctx) {
    if (!ctx.target) return;
    const from = ctx.caster.pos;
    const to = laneEnd(from, ctx.target.pos, R(20));
    const struck = bodiesOnLane(ctx, from, to, R(0.5));
    if (!struck.includes(ctx.target)) struck.push(ctx.target);
    ctx.vfx?.godFx?.('reap', stepTowards(from, to, dist(from, to) / 2), {
      size: Math.max(R(4), dist(from, to)),
      angle: headingTo(ctx, to),
      color: 0xa8c890,
    });
    const pierce = rollDice(ctx, '2d6', 'Mortal Wound');
    for (const body of struck) {
      if (!body.alive) continue;
      dealDamage(ctx, body, dmg(pierce, 'pierce'), { canMiss: false, aoe: true });
      if (!body.alive) continue;
      applyDot(ctx, body, {
        name: 'Mortal Wound',
        key: 'dot:mortal-wound',
        duration: 4,
        damage: dmg(0, 'corrosive'),
        damageSpec: '1d6',
        healBecomesReap: true,
      });
    }
  },
});

// ---------------------------------------------------------------------------
//  DEATH + CURSE + SHATTER
//  A doom the victim can hear coming. Curse waits it out; Shatter hurries it.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Doom',
  words: ['death', 'curse', 'shatter'],
  set: 'finns',
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 15,
  description:
    'Doom one enemy within 15cm. At the start of each of its turns, and whenever it takes shatter damage, the doom draws 1 closer. On the third it falls: 4d6 shatter and an execution for 6, and everything else within 3cm takes half. Dooming the doomed makes it fall at once.',
  visual: { preset: 'beam', color: 0x8d7f9c, size: 8, speed: 0.9 },
  cast(ctx) {
    if (!ctx.target) return;
    ctx.vfx?.godFx?.('deathMark', ctx.target.pos, { size: ctx.target.bodyRadius() * 7 });
    ctx.game.applyDoom(ctx.caster, ctx.target, {
      countdown: 3,
      spec: '4d6',
      executeAmount: 6,
      radius: R(3),
    });
  },
});

// ---------------------------------------------------------------------------
//  DEATH + CURSE + PIERCE
//  Hunted. Everyone's blows become Death's, and the mark comes due at the end.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Marked for Death',
  words: ['death', 'curse', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  ignoresStealth: true,
  dc: 15,
  description:
    'Deal 1d6 pierce to one enemy within 20cm, ignoring concealment, and mark it for 4 turns. It cannot hide, and every wound it takes from anyone adds 1 Reap, 2 if pierce. When the mark comes due, it is executed for 2.',
  visual: { preset: 'beam', color: 0xa33a52, size: 5, speed: 1.7 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    ctx.game.applyDeathMark(ctx.caster, foe, afflictDuration(ctx, foe, 4), 2);
    ctx.vfx?.godFx?.('deathMark', foe.pos, { size: foe.bodyRadius() * 6 });
    dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Marked for Death'), 'pierce'), { canMiss: false });
  },
});

// ---------------------------------------------------------------------------
//  DEATH + SHATTER + PIERCE   (colourless majority: damage)
//  One lance, one body. Death's only job is the count; a kill buys the
//  wielder another swing.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Reaping Lance',
  words: ['death', 'shatter', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 15,
  description:
    'Deal 3d6 pierce that cannot miss to one enemy within 20cm. If it survives, it is stunned for 1 turn and executed for 4. A kill gives you your main action back.',
  visual: { preset: 'beam', color: 0xd9dde8, size: 9, speed: 1.9 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    ctx.vfx?.godFx?.('reap', foe.pos, { size: R(5), angle: headingTo(ctx, foe.pos) });
    dealDamage(ctx, foe, dmg(rollDice(ctx, '3d6', 'Reaping Lance'), 'pierce'), { canMiss: false });
    if (foe.alive) {
      applyStun(ctx, foe, { duration: 2, type: 'full' });
      ctx.game.executeTarget(ctx.caster, foe, 4);
    }
    if (foe.alive) return;
    ctx.vfx?.godFx?.('skull', foe.pos, { size: foe.bodyRadius() * 5 });
    ctx.caster.actions.main += 1;
    ctx.log(`${ctx.caster.name} reaps a main action back.`);
  },
});

// ---------------------------------------------------------------------------
//  DESECRATE + SHADOW + SHATTER
//  The dark falls like a weight: the unhallowed are dragged into the crush.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Darkfall',
  words: ['desecrate', 'shadow', 'shatter'],
  set: 'finns',
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 15,
  aoe: { kind: 'circle', radius: R(6) },
  noCastSprite: true,
  description:
    'The dark falls on a point within 12cm. Affected units within 6cm are dragged to its centre, take 3d6 shatter and are stunned for 1 turn; those already standing in a shadow take double. Leaves a shadow. Black and minion units are spared.',
  visual: { preset: 'nova', color: 0x4d3d6e, size: R(6), speed: 0.7 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const at = ctx.targetPoint;
    ctx.vfx?.godFx?.('implode', at, { size: R(6) * 2.2 });
    const prey = ctx.game.magesInRadius(at, R(6)).filter((m) => ctx.game.isDesecrationAffected(m));
    const shadowed = new Set(prey.filter((m) => ctx.game.isInShadow(m)));
    for (const m of prey) {
      const gap = dist(m.pos, at);
      if (gap > R(1)) ctx.game.forceMove(ctx.caster, m, stepTowards(m.pos, at, gap - R(1)));
    }
    if (prey.length > 0) {
      const crush = rollDice(ctx, '3d6', 'Darkfall');
      for (const m of prey) {
        if (!m.alive) continue;
        dealDamage(ctx, m, dmg(shadowed.has(m) ? crush * 2 : crush, 'shatter'), { canMiss: false, aoe: true });
        if (m.alive) applyStun(ctx, m, { duration: 2, type: 'full' });
      }
    }
    placeShadow(ctx, at, 3);
  },
});

// ---------------------------------------------------------------------------
//  DESECRATE + SHADOW + CORRODE
//  Ground that hunts. It crawls toward whatever it has not eaten yet.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Hungering Dark',
  words: ['desecrate', 'shadow', 'corrode'],
  set: 'finns',
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 15,
  aoe: { kind: 'circle', radius: R(4) },
  noCastSprite: true,
  description:
    'Foul a 4cm circle within 12cm for 6 rounds. Every round it crawls 6cm toward the nearest affected unit. Affected units inside take 2d6 corrosive + 1d6 shadow at the start of their turn and cannot be healed. Each death inside grows it 1cm, up to 4cm.',
  visual: { preset: 'burst', color: 0x3d4d3d, size: R(4), speed: 0.8 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    ctx.vfx?.godFx?.('void', ctx.targetPoint, { size: R(4) * 2.2 });
    desecrateGround(ctx, ctx.targetPoint, {
      name: 'Hungering Dark',
      radius: R(4),
      turns: 6,
      blocksHealing: true,
      crawl: R(6),
      growOnDeath: R(1),
      growOnDeathCap: R(4),
      ticks: [
        { spec: '2d6', type: 'corrosive' },
        { spec: '1d6', type: 'shadow' },
      ],
    });
  },
});

// ---------------------------------------------------------------------------
//  DESECRATE + SHADOW + CURSE
//  Two amplifiers and a law: the night doubles every round it is left to run.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'The Long Night',
  words: ['desecrate', 'shadow', 'curse'],
  set: 'finns',
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 15,
  description:
    'For 4 rounds the night deepens. Every affected unit takes shadow damage at the start of its turn: 1d4 in the first round, then 2d4, 4d4 and 8d4. They cannot be healed.',
  visual: { preset: 'nova', color: 0x2d2440, size: 120, speed: 0.6 },
  cast(ctx) {
    ctx.vfx?.godFx?.('void', ctx.caster.pos, { size: R(8) });
    desecrate(ctx, {
      name: 'The Long Night',
      rounds: 4,
      blocksHealing: true,
      ticks: [{ spec: '1d4', type: 'shadow' }],
      stageTicks: [
        [{ spec: '1d4', type: 'shadow' }],
        [{ spec: '2d4', type: 'shadow' }],
        [{ spec: '4d4', type: 'shadow' }],
        [{ spec: '8d4', type: 'shadow' }],
      ],
    });
  },
});

// ---------------------------------------------------------------------------
//  DESECRATE + SHADOW + PIERCE
//  Stakes under every unhallowed foot on the field; twice under those in shadow.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Forest of Stakes',
  words: ['desecrate', 'shadow', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 15,
  description:
    'Stakes erupt beneath every affected unit on the field: 2d6 pierce, and rooted for 1 turn. Affected units standing in a shadow are staked twice.',
  visual: { preset: 'nova', color: 0x6e4d7d, size: 140, speed: 0.9 },
  cast(ctx) {
    const prey = ctx.game.mages.filter((m) => ctx.game.isDesecrationAffected(m));
    if (prey.length === 0) {
      ctx.log('Nothing unhallowed stands on the field.');
      return;
    }
    const stake = rollDice(ctx, '2d6', 'Forest of Stakes');
    for (const m of prey) {
      const times = ctx.game.isInShadow(m) ? 2 : 1;
      ctx.vfx?.godFx?.('hex', m.pos, { size: m.bodyRadius() * 4 });
      for (let i = 0; i < times && m.alive; i++) {
        dealDamage(ctx, m, dmg(stake, 'pierce'), { canMiss: false, aoe: true });
      }
      if (m.alive) applyStun(ctx, m, { duration: 2, type: 'movement' });
    }
  },
});

// ---------------------------------------------------------------------------
//  DESECRATE + SHADOW + DEATH   (all nouns: a class spell)
//  The dead do not rest. Everything unhallowed that falls gets back up for you.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Night of the Risen',
  words: ['desecrate', 'shadow', 'death'],
  set: 'finns',
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 15,
  description:
    'For 3 rounds the dead do not rest. Every affected unit takes 1d4 shadow at the start of its turn, and each one that dies rises as your Remnant. Every affected unit gains 1d4 Reap now, 2d4 if it stands in a shadow.',
  visual: { preset: 'nova', color: 0x5d4d6e, size: 130, speed: 0.7 },
  cast(ctx) {
    ctx.vfx?.godFx?.('deathMark', ctx.caster.pos, { size: R(5) });
    desecrate(ctx, {
      name: 'Night of the Risen',
      rounds: 3,
      raiseDead: true,
      ticks: [{ spec: '1d4', type: 'shadow' }],
    });
    for (const m of ctx.game.mages.filter((u) => ctx.game.isDesecrationAffected(u))) {
      if (!m.alive) continue;
      const spec = ctx.game.isInShadow(m) ? '2d4' : '1d4';
      ctx.game.applyReap(m, rollDice(ctx, spec, 'Night of the Risen', m), ctx.caster);
    }
  },
});

// ---------------------------------------------------------------------------
//  DESECRATE + CORRODE + SHATTER
//  The ground rots away underfoot, holds whatever stands on it, and closes.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Rotting Sinkhole',
  words: ['desecrate', 'corrode', 'shatter'],
  set: 'finns',
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 15,
  aoe: { kind: 'circle', radius: R(6) },
  noCastSprite: true,
  description:
    'Open a 6cm sinkhole within 12cm for 4 rounds. Nothing can walk out of it, and it shrinks 1.5cm every round. Affected units inside take 1d6 corrosive + 1d6 shatter at the start of their turn and cannot be healed. When it closes, affected units still inside take 6d6 shatter.',
  visual: { preset: 'burst', color: 0x5d5a3d, size: R(6), speed: 0.8 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    ctx.vfx?.godFx?.('implode', ctx.targetPoint, { size: R(6) * 2 });
    desecrateGround(ctx, ctx.targetPoint, {
      name: 'Rotting Sinkhole',
      radius: R(6),
      turns: 4,
      sealed: true,
      blocksHealing: true,
      growPerRound: -R(1.5),
      collapse: { spec: '6d6', type: 'shatter' },
      ticks: [
        { spec: '1d6', type: 'corrosive' },
        { spec: '1d6', type: 'shatter' },
      ],
    });
  },
});

// ---------------------------------------------------------------------------
//  DESECRATE + CORRODE + PIERCE
//  Harpoon one of them and make it carry the rot to its own kind.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Plague Bearer',
  words: ['desecrate', 'corrode', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: R(25),
  targeting: 'enemy',
  dc: 15,
  description:
    'Harpoon an affected unit within 25cm for 2d6 pierce and make it a carrier: for 5 rounds a 3cm desecration travels with it. Affected units inside, the carrier too, take 1d6 corrosive at the start of their turn and cannot be healed. When the carrier dies, the rot stays where it fell.',
  visual: { preset: 'beam', color: 0x7d9a4d, size: 6, speed: 1.6 },
  cast(ctx) {
    const carrier = ctx.target;
    if (!carrier) return;
    if (!ctx.game.isDesecrationAffected(carrier)) {
      ctx.log(`${carrier.name} is not unhallowed. The harpoon finds nothing to foul.`);
      return;
    }
    dealDamage(ctx, carrier, dmg(rollDice(ctx, '2d6', 'Plague Bearer'), 'pierce'));
    ctx.vfx?.godFx?.('hex', carrier.pos, { size: R(3) * 2 });
    desecrateGround(ctx, carrier.pos, {
      name: 'Plague Bearer',
      radius: R(3),
      turns: 5,
      blocksHealing: true,
      carrierIndex: carrier.alive ? ctx.game.mages.indexOf(carrier) : undefined,
      ticks: [{ spec: '1d6', type: 'corrosive' }],
    });
  },
});

// ---------------------------------------------------------------------------
//  DESECRATE + CURSE + SHATTER
//  Cursed ground where every death is a charge waiting to go off.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Carrion Chain',
  words: ['desecrate', 'curse', 'shatter'],
  set: 'finns',
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 15,
  aoe: { kind: 'circle', radius: R(6) },
  noCastSprite: true,
  description:
    'Curse a 6cm circle within 12cm for 5 rounds. Affected units inside take 1d6 shatter at the start of their turn and cannot be healed. Any affected unit that dies inside bursts: 3d6 shatter to affected units within 3cm of it, which can set off more bursts.',
  visual: { preset: 'burst', color: 0x6e5d7d, size: R(6), speed: 0.8 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    ctx.vfx?.godFx?.('hex', ctx.targetPoint, { size: R(6) * 2 });
    desecrateGround(ctx, ctx.targetPoint, {
      name: 'Carrion Chain',
      radius: R(6),
      turns: 5,
      blocksHealing: true,
      burstOnDeath: { spec: '3d6', type: 'shatter', radius: R(3) },
      ticks: [{ spec: '1d6', type: 'shatter' }],
    });
  },
});

// ---------------------------------------------------------------------------
//  DESECRATE + CURSE + PIERCE
//  A law against walking. Every step is billed, and the bill grows each round.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Profane Thorns',
  words: ['desecrate', 'curse', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 15,
  description:
    'For 4 rounds thorns answer every step. When an affected unit ends its turn, it takes 1 pierce die for every 2cm between where it started and ended that turn, up to 6: d4 in the first round, then d6, d8 and d10.',
  visual: { preset: 'nova', color: 0x7d4d5d, size: 130, speed: 0.8 },
  cast(ctx) {
    ctx.vfx?.godFx?.('hex', ctx.caster.pos, { size: R(6) });
    desecrate(ctx, {
      name: 'Profane Thorns',
      rounds: 4,
      ticks: [],
      thorns: { pxPerDie: R(2), maxDice: 6, sides: [4, 6, 8, 10], type: 'pierce' },
    });
  },
});

// ---------------------------------------------------------------------------
//  DESECRATE + DEATH + SHATTER
//  The cull. Every unhallowed thing on the field is weighed at once, and what
//  falls breaks over what is left.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'The Culling',
  words: ['desecrate', 'death', 'shatter'],
  set: 'finns',
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 16,
  description:
    'Every affected unit on the field gains 1d4 Reap and is executed for 4. Each one that dies bursts: 2d6 shatter to affected units within 3cm, and anything a burst kills bursts too.',
  visual: { preset: 'nova', color: 0x8d8d9c, size: 140, speed: 0.8 },
  cast(ctx) {
    const prey = ctx.game.mages.filter((m) => ctx.game.isDesecrationAffected(m));
    if (prey.length === 0) {
      ctx.log('Nothing unhallowed stands on the field.');
      return;
    }
    ctx.vfx?.godFx?.('deathMark', { x: FIELD.x + FIELD.w / 2, y: FIELD.y + FIELD.h / 2 }, { size: R(8) });
    const fallen: Mage[] = [];
    for (const m of prey) {
      if (!m.alive) continue;
      ctx.game.applyReap(m, rollDice(ctx, '1d4', 'The Culling', m), ctx.caster);
      if (m.alive) ctx.game.executeTarget(ctx.caster, m, 4);
      if (!m.alive) fallen.push(m);
    }
    if (fallen.length === 0) return;
    const burst = rollDice(ctx, '2d6', 'Culling burst');
    const burstAlready = new Set<Mage>();
    while (fallen.length > 0) {
      const corpse = fallen.shift()!;
      if (burstAlready.has(corpse)) continue;
      burstAlready.add(corpse);
      ctx.vfx?.godFx?.('skull', corpse.pos, { size: R(3) * 2 });
      for (const m of ctx.game.magesInRadius(corpse.pos, R(3), corpse)) {
        if (!ctx.game.isDesecrationAffected(m)) continue;
        dealDamage(ctx, m, dmg(burst, 'shatter'), { canMiss: false, aoe: true });
        if (!m.alive) fallen.push(m);
      }
    }
  },
});

// ---------------------------------------------------------------------------
//  DESECRATE + DEATH + PIERCE
//  Kill it, and it is yours.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Thrall Spike',
  words: ['desecrate', 'death', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: R(25),
  targeting: 'enemy',
  dc: 15,
  description:
    'Deal 3d6 pierce to one affected unit within 25cm, then execute it for 6. If it dies, it rises at once as your Remnant.',
  visual: { preset: 'beam', color: 0x9a8aac, size: 7, speed: 1.8 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    if (!ctx.game.isDesecrationAffected(foe)) {
      ctx.log(`${foe.name} is not unhallowed. The spike will not take it.`);
      return;
    }
    ctx.vfx?.godFx?.('hex', foe.pos, { size: foe.bodyRadius() * 5 });
    dealDamage(ctx, foe, dmg(rollDice(ctx, '3d6', 'Thrall Spike'), 'pierce'));
    if (foe.alive) ctx.game.executeTarget(ctx.caster, foe, 6);
    if (!foe.alive) ctx.game.raiseThrall(foe, ctx.caster);
  },
});

// ---------------------------------------------------------------------------
//  DESECRATE + SHATTER + PIERCE   (colourless majority: damage)
//  The spire is the damage and strikes enemies as usual; Desecrate's one job
//  is the fouled ground it leaves.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Bone Spire',
  words: ['desecrate', 'shatter', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: R(20),
  targeting: 'point',
  dc: 15,
  aoe: { kind: 'circle', radius: R(2) },
  noCastSprite: true,
  description:
    'A bone spire erupts at a point within 20cm. Enemies within 2cm take 3d6 pierce and are stunned for 1 turn. The ground within 5cm is fouled for 3 rounds: affected units there take 1d6 pierce at the start of their turn and cannot be healed.',
  visual: { preset: 'burst', color: 0xe8e0d0, size: R(2), speed: 1.2 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const at = ctx.targetPoint;
    ctx.vfx?.godFx?.('cataclysm', at, { size: R(2) * 3, color: 0xf0e6d2 });
    const hits = areaDamage(ctx, at, R(2), dmg(rollDice(ctx, '3d6', 'Bone Spire'), 'pierce'));
    for (const m of hits) if (m.alive) applyStun(ctx, m, { duration: 2, type: 'full' });
    desecrateGround(ctx, at, {
      name: 'Bone Spire',
      radius: R(5),
      turns: 3,
      blocksHealing: true,
      ticks: [{ spec: '1d6', type: 'pierce' }],
    });
  },
});

// ---------------------------------------------------------------------------
//  REALITY + BIND + VEIL
//  Fold a unit out of the world and set it down wherever you like.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Pocket Dimension',
  words: ['reality', 'bind', 'veil'],
  set: 'finns',
  actionType: 'main',
  range: Infinity,
  targeting: 'any',
  dc: 15,
  description:
    'Fold any unit anywhere out of reality until its next turn begins: nothing can target or harm it, and it can only walk. Choose where on the field it returns.',
  visual: { preset: 'burst', color: 0xff5599, size: 60, speed: 1.1 },
  async cast(ctx) {
    const folded = ctx.target;
    if (!folded?.alive) return;
    // An AI sends a friend as far from the fight as it can and a foe as far from where it stood.
    const danger = folded.team === ctx.caster.team ? ctx.game.opponentOf(ctx.caster).pos : folded.pos;
    const corners = [
      { x: FIELD.x + 30, y: FIELD.y + 30 },
      { x: FIELD.x + FIELD.w - 30, y: FIELD.y + 30 },
      { x: FIELD.x + 30, y: FIELD.y + FIELD.h - 30 },
      { x: FIELD.x + FIELD.w - 30, y: FIELD.y + FIELD.h - 30 },
    ];
    const aiPoint = corners.sort((a, b) => dist(b, danger) - dist(a, danger))[0];
    const home = await ctx.requestPoint?.({
      maxRange: Math.hypot(FIELD.w, FIELD.h),
      origin: ctx.caster.pos,
      prompt: `${ctx.caster.name}: choose where ${folded.name} returns (Esc keeps it in place).`,
      aiPoint,
    });
    ctx.vfx?.godFx?.('warp', folded.pos, { size: folded.bodyRadius() * 6 });
    if (home && !folded.displacementImmune) teleport(ctx, folded, home);
    addOrExtendStatus(
      folded.statuses,
      {
        key: 'phaseOut',
        name: 'Folded Away',
        kind: 'phaseOut',
        duration: 1,
        mode: 'banished',
        ownerIndex: ctx.game.mages.indexOf(ctx.caster),
        ownerTeam: ctx.caster.team,
      },
      false
    );
    ctx.vfx?.godFx?.('void', folded.pos, { size: folded.bodyRadius() * 5 });
    ctx.log(`${folded.name} is folded out of reality.`);
  },
});

// ---------------------------------------------------------------------------
//  REALITY + BIND + MIND
//  A contract with consequence: every wound it deals is billed to its mind.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Pact of Consequence',
  words: ['reality', 'bind', 'mind'],
  set: 'finns',
  actionType: 'main',
  range: Infinity,
  targeting: 'enemy',
  dc: 15,
  description:
    'Bind one enemy anywhere to the consequences of its choices for 3 turns: whenever it damages anything else, it takes the same amount as sanity damage. It takes 1d6 sanity now.',
  visual: { preset: 'beam', color: 0xd46bb0, size: 6, speed: 1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const bound = afflict(ctx, foe, {
      key: 'soulPact',
      name: 'Pact of Consequence',
      kind: 'soulPact',
      duration: afflictDuration(ctx, foe, 3),
      ownerIndex: ctx.game.mages.indexOf(ctx.caster),
    });
    if (!bound) return;
    ctx.log(`${foe.name} is bound to the consequences of its choices.`);
    ctx.vfx?.godFx?.('void', foe.pos, { size: foe.bodyRadius() * 5, color: 0xd46bb0 });
    dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Pact of Consequence'), 'sanity'));
  },
});

// ---------------------------------------------------------------------------
//  REALITY + BIND + SHATTER
//  Space collapses onto a point; the more it catches, the harder it crushes.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Singularity',
  words: ['reality', 'bind', 'shatter'],
  set: 'finns',
  actionType: 'main',
  range: Infinity,
  targeting: 'point',
  dc: 15,
  aoe: { kind: 'circle', radius: R(8) },
  noCastSprite: true,
  description:
    'Collapse space onto a point anywhere. Enemies within 8cm are hauled to it, take 2d6 shatter plus 1d6 for every other enemy hauled with them, and are rooted for 1 turn.',
  visual: { preset: 'nova', color: 0xff5599, size: R(8), speed: 0.7 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const at = ctx.targetPoint;
    ctx.vfx?.godFx?.('implode', at, { size: R(8) * 2 });
    const hauled = ctx.game.magesInRadius(at, R(8)).filter((m) => m.team !== ctx.caster.team);
    if (hauled.length === 0) return;
    for (const m of hauled) ctx.game.forceMove(ctx.caster, m, at);
    let crush = rollDice(ctx, '2d6', 'Singularity');
    if (hauled.length > 1) crush += rollDice(ctx, `${hauled.length - 1}d6`, 'Singularity crush');
    for (const m of hauled) {
      if (!m.alive) continue;
      dealDamage(ctx, m, dmg(crush, 'shatter'), { canMiss: false, aoe: true });
      if (m.alive) applyStun(ctx, m, { duration: 2, type: 'movement' });
    }
  },
});

// ---------------------------------------------------------------------------
//  REALITY + BIND + PIERCE
//  Nailed to its coordinates: nothing moves it, and it cannot slip a blow.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Fixed Point',
  words: ['reality', 'bind', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: Infinity,
  targeting: 'enemy',
  ignoresStealth: true,
  dc: 15,
  description:
    'Nail one enemy anywhere to its place in reality: 2d6 pierce, ignoring concealment. For 3 turns it cannot walk, teleport or be moved by anything, and it cannot dodge.',
  visual: { preset: 'beam', color: 0xff5599, size: 4, speed: 2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Fixed Point'), 'pierce'), { canMiss: false });
    const nailed = afflict(ctx, foe, {
      key: 'fixedPoint',
      name: 'Fixed Point',
      kind: 'fixedPoint',
      duration: afflictDuration(ctx, foe, 3),
    });
    if (!nailed) return;
    applyStun(ctx, foe, { duration: 3, type: 'movement', key: 'stun:fixed-point' });
    ctx.vfx?.godFx?.('warp', foe.pos, { size: foe.bodyRadius() * 5 });
  },
});

// ---------------------------------------------------------------------------
//  REALITY + VEIL + MIND
//  The last turn never happened. An enemy is left not even remembering it.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Deja Vu',
  words: ['reality', 'veil', 'mind'],
  set: 'finns',
  actionType: 'main',
  range: Infinity,
  targeting: 'any',
  dc: 15,
  description:
    "Undo one unit's latest turn: it returns to where it stood, and to the health and sanity it had, when that turn began. An enemy also forgets the action it last took for 2 turns.",
  visual: { preset: 'burst', color: 0xff88cc, size: 60, speed: 0.9 },
  cast(ctx) {
    const unit = ctx.target;
    if (!unit) return;
    ctx.vfx?.godFx?.('rift', unit.pos, { size: unit.bodyRadius() * 8 });
    if (!ctx.game.rewind(unit, ctx.caster)) {
      ctx.log(`${unit.name} has no turn to undo.`);
      return;
    }
    if (unit.team === ctx.caster.team || !unit.alive) return;
    const last = unit.lastAction;
    const spell = last?.type === 'spell' && last.spellId ? spellById(last.spellId) : undefined;
    const tokens = spell
      ? splitModifiers(spell.words).base.map(String)
      : last?.type === 'move'
        ? ['move']
        : last?.type === 'melee'
          ? ['melee']
          : [];
    forgetTokens(ctx, unit, tokens, 2);
  },
});

// ---------------------------------------------------------------------------
//  REALITY + VEIL + SHATTER
//  Every illusion on the field breaks at once, and the glass cuts whoever hid.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Shattered Illusion',
  words: ['reality', 'veil', 'shatter'],
  set: 'finns',
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 15,
  description:
    'Shatter every illusion on the field. All enemy concealment ends. Every enemy takes 1d6 shatter; those that were concealed take 4d6 instead and are stunned for 1 turn. Your side slips into a half veil for 2 turns.',
  visual: { preset: 'nova', color: 0xffa3d1, size: 150, speed: 0.9 },
  cast(ctx) {
    ctx.vfx?.godFx?.('rift', { x: FIELD.x + FIELD.w / 2, y: FIELD.y + FIELD.h / 2 }, { size: FIELD.w * 0.45 });
    const foes = ctx.game.mages.filter((m) => m.alive && m.team !== ctx.caster.team);
    const concealed = new Set(
      foes.filter(
        (m) =>
          ctx.game.isVeiled(m) ||
          m.statuses.some((s) => s.kind === 'invisibility' || s.kind === 'shadowVeil')
      )
    );
    for (const m of foes) dispelVeil(ctx, m);
    if (foes.length > 0) {
      const light = rollDice(ctx, '1d6', 'Shattered Illusion');
      const heavy = concealed.size > 0 ? rollDice(ctx, '4d6', 'Shattered Illusion: the hidden') : 0;
      for (const m of foes) {
        if (!m.alive) continue;
        const hidden = concealed.has(m);
        ctx.vfx?.shatterBurst?.(m.pos, m.bodyRadius() * 3);
        dealDamage(ctx, m, dmg(hidden ? heavy : light, 'shatter'), { canMiss: false, aoe: true });
        if (hidden && m.alive) applyStun(ctx, m, { duration: 2, type: 'full' });
      }
    }
    for (const ally of ctx.game.mages) {
      if (ally.alive && ally.team === ctx.caster.team) {
        applyInvisibility(ctx, ally, { duration: 2, mode: 'partial' });
      }
    }
  },
});

// ---------------------------------------------------------------------------
//  REALITY + VEIL + PIERCE
//  Rewrite your own targeting rules: distance and concealment stop counting.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Phantom Reach',
  words: ['reality', 'veil', 'pierce'],
  set: 'finns',
  actionType: 'bonus',
  range: 0,
  targeting: 'self',
  dc: 15,
  description:
    'Until the end of your next turn, your targeted spells reach any distance and ignore concealment. You slip into a half veil.',
  visual: { preset: 'heal', color: 0xff77bb, size: 44, speed: 1.2 },
  cast(ctx) {
    addOrExtendStatus(
      ctx.caster.statuses,
      { key: 'phantomReach', name: 'Phantom Reach', kind: 'phantomReach', duration: critScale(ctx, 2) },
      false
    );
    applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'partial' });
    ctx.vfx?.godFx?.('warp', ctx.caster.pos, { size: ctx.caster.bodyRadius() * 5, color: 0xff77bb });
    ctx.log(`${ctx.caster.name}'s reach slips its bounds.`);
  },
});

// ---------------------------------------------------------------------------
//  REALITY + MIND + PIERCE
//  Break a mind anywhere on the field, and the moment it loses is yours.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Seized Moment',
  words: ['reality', 'mind', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: Infinity,
  targeting: 'enemy',
  ignoresStealth: true,
  dc: 15,
  description:
    'Deal 2d6 pierce and 2d6 sanity to one enemy anywhere, ignoring concealment. If this leaves its sanity at or below half, you take an extra turn after this one.',
  visual: { preset: 'beam', color: 0xe070c0, size: 6, speed: 1.6 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    ctx.vfx?.godFx?.('void', foe.pos, { size: foe.bodyRadius() * 5, color: 0xe070c0 });
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Seized Moment'), 'pierce'), { canMiss: false });
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Seized Moment: mind'), 'sanity'), { canMiss: false });
    if (foe.sanity > foe.maxSanity / 2) return;
    ctx.vfx?.godFx?.('rift', ctx.caster.pos, { size: R(6) });
    grantExtraTurn(ctx, ctx.caster);
  },
});

// ---------------------------------------------------------------------------
//  REALITY + SHATTER + PIERCE   (colourless majority: damage)
//  A tear to the edge of the world. Reality's one job: walls do not hold it.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Rift Lance',
  words: ['reality', 'shatter', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: Infinity,
  targeting: 'point',
  dc: 15,
  noCastSprite: true,
  description:
    'Tear a straight rift from you through a point to the edge of the field. Every enemy on it takes 3d6 pierce and 1d6 shatter, and every wall it crosses is destroyed.',
  visual: { preset: 'beam', color: 0xff5599, size: 10, speed: 1.4 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const from = ctx.caster.pos;
    const to = rayToFieldEdge(from, ctx.targetPoint);
    const length = dist(from, to);
    const steps = Math.max(2, Math.ceil(length / 8));
    const lane = Array.from({ length: steps + 1 }, (_, i) => stepTowards(from, to, (length * i) / steps));
    ctx.vfx?.godFx?.('rift', stepTowards(from, to, length / 2), { size: Math.max(R(6), length) });
    const struck = bodiesOnLane(ctx, from, to, R(0.5)).filter((m) => m.team !== ctx.caster.team);
    if (struck.length > 0) {
      const pierce = rollDice(ctx, '3d6', 'Rift Lance');
      const shatter = rollDice(ctx, '1d6', 'Rift Lance: shatter');
      for (const m of struck) {
        if (!m.alive) continue;
        dealDamage(ctx, m, dmg(pierce, 'pierce'), { canMiss: false, aoe: true });
        if (m.alive) dealDamage(ctx, m, dmg(shatter, 'shatter'), { canMiss: false, aoe: true });
      }
    }
    const broken = ctx.game.barriers.filter((wall) => lane.some((p) => barrierContains(wall, p)));
    if (broken.length === 0) return;
    ctx.game.barriers = ctx.game.barriers.filter((wall) => !broken.includes(wall));
    for (const wall of broken) ctx.vfx?.shatterBurst?.({ x: wall.x, y: wall.y }, R(3));
    ctx.log(`The rift tears down ${broken.length} wall${broken.length === 1 ? '' : 's'}.`);
  },
});

// ---------------------------------------------------------------------------
//  REALITY + STOP + BIND
//  A prison of stopped time. Whatever is done to the prisoner waits for it.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Stasis Prison',
  words: ['reality', 'stop', 'bind'],
  set: 'finns',
  actionType: 'main',
  range: Infinity,
  targeting: 'any',
  dc: 15,
  reaction: true,
  counters: true,
  description:
    'Stop time for any unit anywhere for 2 of its turns. It cannot act, react or be moved, and nothing on it wears off. Damage it takes is held and lands all at once when time resumes. As a reaction, also cancel the answered action.',
  visual: { preset: 'burst', color: 0x9ee7ff, size: 70, speed: 0.8 },
  cast(ctx) {
    const unit = ctx.target;
    if (!unit) return;
    if (ctx.game.stopTime(ctx.caster, unit, { turns: 2 })) {
      ctx.vfx?.godFx?.('sphere', unit.pos, { size: unit.bodyRadius() * 6 });
    }
  },
});

// ---------------------------------------------------------------------------
//  REALITY + STOP + VEIL
//  Time stops for everyone else. They cannot see it happen, so they cannot
//  answer it, and everything done to them lands the moment it starts again.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'The World',
  words: ['reality', 'stop', 'veil'],
  set: 'finns',
  actionType: 'main',
  range: 0,
  targeting: 'self',
  dc: 16,
  turnOnly: true,
  description:
    'Your turn only. Stop time for everyone but you and take an extra turn after this one. Until it ends, no one else can react, and damage they take is held and lands all at once when time resumes.',
  visual: { preset: 'nova', color: 0xcfd8ff, size: 160, speed: 0.6 },
  cast(ctx) {
    ctx.vfx?.godFx?.('rift', ctx.caster.pos, { size: R(10) });
    for (const m of ctx.game.mages) {
      if (m.alive && m !== ctx.caster) {
        ctx.game.stopTime(ctx.caster, m, { turns: 0, resumeAfterOwnerTurns: 2 });
      }
    }
    grantExtraTurn(ctx, ctx.caster);
    ctx.log('Time stops.');
  },
});

// ---------------------------------------------------------------------------
//  REALITY + STOP + MIND
//  Its next decision is already known, and already undone.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Foreknowledge',
  words: ['reality', 'stop', 'mind'],
  set: 'finns',
  actionType: 'main',
  range: Infinity,
  targeting: 'enemy',
  dc: 15,
  reaction: true,
  counters: true,
  description:
    'Foresee one enemy anywhere. The next action it declares within 3 turns is stopped the moment it is declared, and it takes 2d6 sanity. As a reaction, also cancel the answered action.',
  visual: { preset: 'beam', color: 0xb58bd8, size: 5, speed: 1.2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe || mindShielded(ctx, foe)) return;
    addOrExtendStatus(
      foe.statuses,
      {
        key: 'foreknown',
        name: 'Foreknown',
        kind: 'foreknown',
        duration: afflictDuration(ctx, foe, 3),
        ownerIndex: ctx.game.mages.indexOf(ctx.caster),
        spec: '2d6',
      },
      false
    );
    ctx.vfx?.godFx?.('sphere', foe.pos, { size: foe.bodyRadius() * 5, color: 0xb58bd8 });
    ctx.log(`${ctx.caster.name} foresees ${foe.name}'s next move.`);
  },
});

// ---------------------------------------------------------------------------
//  REALITY + STOP + SHATTER
//  A circle of stopped time anywhere; it breaks over everything caught in it.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Shattered Moment',
  words: ['reality', 'stop', 'shatter'],
  set: 'finns',
  actionType: 'main',
  range: Infinity,
  targeting: 'point',
  dc: 15,
  aoe: { kind: 'circle', radius: R(4) },
  noCastSprite: true,
  description:
    'Stop time in a 4cm circle anywhere. Every enemy inside loses its next turn, damage it takes is held, and when time resumes it takes everything held plus 3d6 shatter.',
  visual: { preset: 'burst', color: 0x9ee7ff, size: R(4), speed: 0.7 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    ctx.vfx?.godFx?.('sphere', ctx.targetPoint, { size: R(4) * 2.2 });
    for (const m of ctx.game.magesInRadius(ctx.targetPoint, R(4))) {
      if (m.team === ctx.caster.team) continue;
      ctx.game.stopTime(ctx.caster, m, { turns: 1, release: { spec: '3d6', type: 'shatter' } });
    }
  },
});

// ---------------------------------------------------------------------------
//  REALITY + STOP + PIERCE
//  Everything the enemy has in motion stops, and every hand behind it is hit.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Stopping Volley',
  words: ['reality', 'stop', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 15,
  reaction: true,
  counters: true,
  minStackDepth: 1,
  nullifiesHostileStack: true,
  description:
    'Reaction only. Cancel every enemy action waiting on the stack. Each of their sources takes 2d6 pierce.',
  visual: { preset: 'nova', color: 0x9ee7ff, size: 90, speed: 1.4 },
  cast(ctx) {
    const sources = new Set<Mage>();
    const countered = ctx.game.counteredItem;
    if (countered && countered.source.team !== ctx.caster.team) sources.add(countered.source);
    for (const item of ctx.game.stack) {
      if (item.source.team !== ctx.caster.team && !item.windowTrigger) sources.add(item.source);
    }
    if (sources.size === 0) {
      ctx.log('No enemy action waits on the stack.');
      return;
    }
    const volley = rollDice(ctx, '2d6', 'Stopping Volley');
    for (const source of sources) {
      if (!source.alive) continue;
      ctx.vfx?.godFx?.('sphere', source.pos, { size: source.bodyRadius() * 4 });
      dealDamage(ctx, source, dmg(volley, 'pierce'), { canMiss: false, aoe: true });
    }
  },
});

// ---------------------------------------------------------------------------
//  STOP + BIND + VEIL
//  Still water holds one blow back entirely, then hides what it protected.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Stillwater Ward',
  words: ['stop', 'bind', 'veil'],
  set: 'finns',
  actionType: 'main',
  range: R(15),
  targeting: 'any',
  dc: 15,
  reaction: true,
  counters: true,
  description:
    'Ward any unit within 15cm for 3 turns. The next damage it would take is stopped. When the ward breaks, the unit vanishes into a full veil for 1 turn and its attacker is rooted for 1 turn. As a reaction, also cancel the answered action.',
  visual: { preset: 'heal', color: 0x9ee7ff, size: 44, speed: 1 },
  cast(ctx) {
    const unit = ctx.target;
    if (!unit?.alive) return;
    addOrExtendStatus(
      unit.statuses,
      {
        key: 'stillWard',
        name: 'Stillwater Ward',
        kind: 'stillWard',
        duration: critScale(ctx, 3),
        ownerIndex: ctx.game.mages.indexOf(ctx.caster),
      },
      false
    );
    ctx.vfx?.godFx?.('sphere', unit.pos, { size: unit.bodyRadius() * 4 });
    ctx.log(`Still water gathers around ${unit.name}.`);
  },
});

// ---------------------------------------------------------------------------
//  STOP + BIND + MIND
//  An oath of stillness: one choice a turn, and the rest of the turn is gone.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Oath of Stillness',
  words: ['stop', 'bind', 'mind'],
  set: 'finns',
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 15,
  reaction: true,
  counters: true,
  description:
    'Swear one enemy within 15cm to stillness for 3 turns: the first action it takes on a turn is the only one it gets. It takes 1d6 sanity now. As a reaction, also cancel the answered action.',
  visual: { preset: 'beam', color: 0x8fb7d8, size: 6, speed: 1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe || mindShielded(ctx, foe)) return;
    addOrExtendStatus(
      foe.statuses,
      { key: 'stillOath', name: 'Oath of Stillness', kind: 'stillOath', duration: afflictDuration(ctx, foe, 3) },
      false
    );
    ctx.log(`${foe.name} is sworn to stillness.`);
    ctx.vfx?.godFx?.('sphere', foe.pos, { size: foe.bodyRadius() * 4, color: 0x8fb7d8 });
    dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Oath of Stillness'), 'sanity'));
  },
});

// ---------------------------------------------------------------------------
//  STOP + BIND + SHATTER
//  Everything in motion stops dead, and momentum breaks whatever carried it.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Sudden Stop',
  words: ['stop', 'bind', 'shatter'],
  set: 'finns',
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 15,
  aoe: { kind: 'circle', radius: R(12) },
  reaction: true,
  counters: true,
  description:
    'Everything in motion stops at once. Every enemy within 12cm takes 1d6 shatter, plus 1d6 for every 2cm between where it stands and where its latest turn began (up to 6d6 in all), and is rooted for 1 turn. As a reaction, also cancel the answered action.',
  visual: { preset: 'nova', color: 0x9ee7ff, size: R(12), speed: 1.2 },
  cast(ctx) {
    ctx.vfx?.godFx?.('sphere', ctx.caster.pos, { size: R(12) * 1.2 });
    const foes = ctx.game
      .magesInRadius(ctx.caster.pos, R(12), ctx.caster)
      .filter((m) => m.team !== ctx.caster.team);
    for (const foe of foes) {
      if (!foe.alive) continue;
      const start = foe.turnStartState;
      const momentum = start ? Math.min(5, Math.floor(dist(start, foe.pos) / R(2))) : 0;
      const amount = rollDice(ctx, `${1 + momentum}d6`, `Sudden Stop: ${foe.name}`, foe);
      dealDamage(ctx, foe, dmg(amount, 'shatter'), { canMiss: false, aoe: true });
      if (foe.alive) applyStun(ctx, foe, { duration: 2, type: 'movement' });
    }
  },
});

// ---------------------------------------------------------------------------
//  STOP + BIND + PIERCE
//  A needle through the clock itself: nothing on its bearer wears off.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Stopped Clock',
  words: ['stop', 'bind', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: R(20),
  targeting: 'any',
  dc: 15,
  reaction: true,
  counters: true,
  description:
    "Stop one unit's clock within 20cm for 3 turns: nothing on it wears off, though its afflictions still bite. An enemy also takes 2d6 pierce. As a reaction, also cancel the answered action.",
  visual: { preset: 'beam', color: 0xa8e0ff, size: 4, speed: 1.9 },
  cast(ctx) {
    const unit = ctx.target;
    if (!unit?.alive) return;
    if (unit.team !== ctx.caster.team) {
      dealDamage(ctx, unit, dmg(rollDice(ctx, '2d6', 'Stopped Clock'), 'pierce'), { canMiss: false });
    }
    if (!unit.alive || ctx.game.isUnreachable(unit)) return;
    addOrExtendStatus(
      unit.statuses,
      { key: 'clockStopped', name: 'Stopped Clock', kind: 'clockStopped', duration: 3 },
      false
    );
    ctx.vfx?.godFx?.('sphere', unit.pos, { size: unit.bodyRadius() * 4, color: 0xa8e0ff });
    ctx.log(`${unit.name}'s clock stops.`);
  },
});

// ---------------------------------------------------------------------------
//  STOP + VEIL + MIND
//  Its picture of the field freezes. Anything that moves slips out of it.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Frozen Perception',
  words: ['stop', 'veil', 'mind'],
  set: 'finns',
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 15,
  reaction: true,
  counters: true,
  description:
    "Freeze one enemy's perception within 20cm for 3 turns: it sees the field as it is now, and cannot target anything that has since moved more than 2cm. It takes 1d6 sanity now. As a reaction, also cancel the answered action.",
  visual: { preset: 'beam', color: 0xb8c8ff, size: 6, speed: 1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe || mindShielded(ctx, foe)) return;
    const positions: Record<number, { x: number; y: number }> = {};
    ctx.game.mages.forEach((m, i) => {
      if (m.alive) positions[i] = { x: m.x, y: m.y };
    });
    addOrExtendStatus(
      foe.statuses,
      {
        key: 'frozenPerception',
        name: 'Frozen Perception',
        kind: 'frozenPerception',
        duration: afflictDuration(ctx, foe, 3),
        positions,
      },
      false
    );
    ctx.log(`${foe.name}'s picture of the field freezes.`);
    ctx.vfx?.godFx?.('sphere', foe.pos, { size: foe.bodyRadius() * 4, color: 0xb8c8ff });
    dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Frozen Perception'), 'sanity'));
  },
});

// ---------------------------------------------------------------------------
//  STOP + VEIL + SHATTER
//  A glass coffin: a turn lost, perfectly safe, and it breaks outward.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Glass Coffin',
  words: ['stop', 'veil', 'shatter'],
  set: 'finns',
  actionType: 'main',
  range: R(15),
  targeting: 'any',
  dc: 15,
  reaction: true,
  counters: true,
  description:
    'Seal any unit within 15cm in glass until the end of its next turn: it loses that turn, but nothing can target or harm it. When the glass breaks, your enemies within 3cm of it take 3d6 shatter. As a reaction, also cancel the answered action.',
  visual: { preset: 'burst', color: 0xd8f0ff, size: 60, speed: 1 },
  cast(ctx) {
    const unit = ctx.target;
    if (!unit) return;
    const coffin = ctx.game.stopTime(ctx.caster, unit, {
      turns: 1,
      sanctuary: true,
      burst: { spec: '3d6', type: 'shatter', radius: R(3) },
    });
    if (coffin) ctx.vfx?.godFx?.('sphere', unit.pos, { size: unit.bodyRadius() * 5, color: 0xd8f0ff });
  },
});

// ---------------------------------------------------------------------------
//  STOP + VEIL + PIERCE
//  A needle nobody sees coming, and after it, no reflex left to answer with.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Frozen Reflexes',
  words: ['stop', 'veil', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 15,
  unanswerable: true,
  reaction: true,
  counters: true,
  description:
    'Nothing can answer this spell. Deal 2d6 pierce that cannot be dodged to one enemy within 20cm. For 3 turns it cannot react at all. As a reaction, also cancel the answered action.',
  visual: { preset: 'beam', color: 0xcfe8ff, size: 3, speed: 2.2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    ctx.vfx?.godFx?.('sphere', foe.pos, { size: foe.bodyRadius() * 4, color: 0xcfe8ff });
    dealDamage(ctx, foe, dmg(rollDice(ctx, '2d6', 'Frozen Reflexes'), 'pierce'), { canMiss: false });
    const frozen = afflict(ctx, foe, {
      key: 'reflexStop',
      name: 'Frozen Reflexes',
      kind: 'reflexStop',
      duration: afflictDuration(ctx, foe, 3),
    });
    if (frozen) ctx.log(`${foe.name}'s reflexes stop.`);
  },
});

// ---------------------------------------------------------------------------
//  STOP + MIND + SHATTER
//  The bigger the spell you stop, the harder it breaks the mind behind it.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Shattered Will',
  words: ['stop', 'mind', 'shatter'],
  set: 'finns',
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 15,
  reaction: true,
  counters: true,
  description:
    'Deal 2d6 sanity to one enemy within 20cm and stun it for 1 turn. As a reaction, cancel the answered action instead: its source takes 1d6 sanity plus 1d6 for every word the cancelled spell used, and is stunned for 1 turn.',
  visual: { preset: 'beam', color: 0xb58bd8, size: 8, speed: 1.2 },
  cast(ctx) {
    const countered = ctx.game.counteredItem;
    const victim = countered?.source ?? ctx.target;
    if (!victim?.alive) return;
    const words = countered?.spell ? splitModifiers(countered.spell.words).base.length : 0;
    const dice = countered ? 1 + words : 2;
    ctx.vfx?.godFx?.('void', victim.pos, { size: victim.bodyRadius() * 5, color: 0xb58bd8 });
    dealDamage(ctx, victim, dmg(rollDice(ctx, `${dice}d6`, 'Shattered Will', victim), 'sanity'), {
      canMiss: false,
    });
    if (victim.alive) applyStun(ctx, victim, { duration: 2, type: 'full' });
  },
});

// ---------------------------------------------------------------------------
//  STOP + MIND + PIERCE
//  A precise silence: the words it reached for are the words it loses.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Silencing Needle',
  words: ['stop', 'mind', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 15,
  reaction: true,
  counters: true,
  description:
    'Deal 1d6 pierce and 1d6 sanity to one enemy within 20cm; it forgets its two most charged words for 2 turns. As a reaction, cancel the answered action instead, and its source forgets every word of it, or the move or attack, for 3 turns.',
  visual: { preset: 'beam', color: 0xd0c8ff, size: 3, speed: 2.1 },
  cast(ctx) {
    const countered = ctx.game.counteredItem;
    const victim = countered?.source ?? ctx.target;
    if (!victim?.alive) return;
    ctx.vfx?.godFx?.('void', victim.pos, { size: victim.bodyRadius() * 4, color: 0xd0c8ff });
    dealDamage(ctx, victim, dmg(rollDice(ctx, '1d6', 'Silencing Needle'), 'pierce'), { canMiss: false });
    if (victim.alive) {
      dealDamage(ctx, victim, dmg(rollDice(ctx, '1d6', 'Silencing Needle: mind'), 'sanity'), {
        canMiss: false,
      });
    }
    if (!victim.alive) return;
    if (countered) {
      const tokens = countered.spell
        ? splitModifiers(countered.spell.words).base.map(String)
        : countered.kind === 'melee'
          ? ['melee']
          : countered.kind === 'move'
            ? ['move']
            : [];
      forgetTokens(ctx, victim, tokens, 3);
      return;
    }
    const words = [...new Set(splitModifiers(victim.loadout).base)];
    const richest = [...words]
      .sort((a, b) => (victim.charges[b] ?? 0) - (victim.charges[a] ?? 0))
      .slice(0, 2)
      .map(String);
    forgetTokens(ctx, victim, richest, 2);
  },
});

// ---------------------------------------------------------------------------
//  STOP + SHATTER + PIERCE   (colourless majority: damage)
//  The answer to a blow is a bigger blow. Stop's one job is the cancel.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Counterstrike',
  words: ['stop', 'shatter', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  dc: 15,
  reaction: true,
  counters: true,
  description:
    'Deal 2d6 pierce and 2d6 shatter to one enemy within 20cm. As a reaction, also cancel the answered action; if that action was aimed at you, its source is also stunned for 1 turn.',
  visual: { preset: 'beam', color: 0xf0f4ff, size: 8, speed: 2 },
  cast(ctx) {
    const countered = ctx.game.counteredItem;
    const foe = countered?.source ?? ctx.target;
    if (!foe?.alive) return;
    const pierce = rollDice(ctx, '2d6', 'Counterstrike');
    const shatter = rollDice(ctx, '2d6', 'Counterstrike: shatter');
    ctx.vfx?.godFx?.('cataclysm', foe.pos, { size: foe.bodyRadius() * 6, color: 0xf0f4ff });
    dealDamage(ctx, foe, dmg(pierce, 'pierce'), { canMiss: false });
    if (foe.alive) dealDamage(ctx, foe, dmg(shatter, 'shatter'), { canMiss: false });
    if (foe.alive && countered?.target === ctx.caster) {
      ctx.log(`${ctx.caster.name} turns the blow meant for them back on ${foe.name}.`);
      applyStun(ctx, foe, { duration: 2, type: 'full' });
    }
  },
});
