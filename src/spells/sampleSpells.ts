// =============================================================================
//  SPELLS
// -----------------------------------------------------------------------------
//  Every 1- and 2-word combination is preset below. A spell maps a combination
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
//  3-word combos (and any 2-word combo not listed here) are intentionally left
//  unimplemented for now and simply cannot be cast.
// =============================================================================

import { dmg } from '../core/Damage';
import { CONE_DEGREES, FIELD, MOVE_RANGE, RANGE_UNIT } from '../config/constants';
import {
  applyAuraDot,
  applyControl,
  applyDebuff,
  applyDot,
  applyForget,
  applyInvisibility,
  applyShadowTrail,
  applyShadowVeil,
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
  placeBarrier,
  placeShadow,
  placeTotem,
  rollDice,
  summonScarabs,
  swapMinds,
  twistStrike,
} from '../effects/effects';
import { registerSpell } from './registry';
import type { Mage } from '../core/Mage';
import type { EffectContext } from '../effects/effects';

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
    'Conjure a pool of shadow anywhere on the field. You can cast from and bounce spells through your shadows, and any mage standing in one takes +2 damage.',
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
  description: 'A precise lance. 1d6 pierce damage (range 8).',
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
    "Read the target's intentions (range 20): you predict their next move, so they cannot hold a reaction and take +2 damage during their next turn.",
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
    'Slip a chosen mage behind a half veil for 2 cycles: targeted attacks miss more often the further the attacker stands (50% point-blank, up to 95% at long range). Any landed hit — or an enemy stepping within 1 — drops it. Castable as a reaction, so it can make an incoming spell miss.',
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
  description: 'Snare the target so it moves at 50% speed for a turn (range 20).',
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
    '1d6 corrosive damage in a small area (range 10). Each victim has a 33% chance to be left with a weak corrosion and 20% chance to be slowed.',
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
  description: "A withering hex: 1d3 damage at the start of each of the target's next 4 turns (range 15).",
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
    '1d6 sanity damage with a 50% chance to fully stun (range 15). A stun landed as a reaction stifles the action it answers.',
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
    'Lock the target into a loop: for 3 turns it must repeat its last action. If it cannot, it does nothing (range 15).',
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
  description: 'Ready a Mind Dodge on a chosen mage that negates the next instance of sanity damage or mental compulsion.',
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
    "Scramble the target's focus: for 3 turns its spells are chosen at random instead of by its caster (range 20).",
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
    'Blink up to range 10 toward a point; an enemy you dash to or through takes 1d6 pierce and 1d4 sanity damage.',
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
    'Wreathe the target in clawing dark: 1d6 shadow damage to everyone around it each turn for 3 turns — including you if you stand too close (range 10).',
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
    'Strike from the dark for 1d6 shadow + 1d6 pierce damage. Must be cast from one of your own shadows (range 5).',
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
    'Blink up to range 10 and bind an enemy you reach, locking down its movement and attacks. May be cast as a reaction, but does not counter the triggering spell.',
  visual: { preset: 'projectile', color: 0x9ad8ff, size: 10, speed: 1.7 },
  cast(ctx) {
    if (ctx.targetPoint) dash(ctx, ctx.caster, { toPoint: ctx.targetPoint, distance: R(10) });
    const foe = enemyNear(ctx, ctx.caster.pos, 90);
    if (foe) applyStun(ctx, foe, { duration: 2, type: 'full' });
  },
});

registerSpell({
  name: 'Corrode Curse',
  words: ['corrode', 'curse'],
  actionType: 'bonus',
  range: R(5),
  targeting: 'point',
  dc: 11,
  aoe: { kind: 'circle', radius: R(3) },
  description:
    'Raise a totem (range 5) whose 3-range aura deals 1d3 corrosive damage and 50% slow to enemies within it each turn.',
  visual: { preset: 'burst', color: 0x9be870, size: 50, speed: 1 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    placeTotem(ctx, ctx.targetPoint, { radius: R(3), damageSpec: '1d3', slow: 0.5 });
  },
});

registerSpell({
  name: 'Veil Pierce',
  words: ['veil', 'pierce'],
  actionType: 'main',
  range: R(10),
  targeting: 'point',
  dc: 10,
  description:
    'Blink up to range 10, striking an enemy you reach for 1d6 pierce, then slip behind a half veil after the dash.',
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
    'Hex the target so it bleeds 3d3 pierce damage each turn — but only while it stays at mid range (7-13) from you. Cast at range 7-13.',
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
    'Slam a 3-range pool of shadow at a point (range 15): 1d6 shadow damage and roots every enemy caught, then a shadow lingers there for 5 turns.',
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
    '1d3 shatter damage at point-blank (range 1): a brief full stun that gives way to a longer root.',
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
  range: R(1),
  targeting: 'enemy',
  dc: 11,
  description:
    '1d6 shatter + 1d6 corrosive damage at point-blank (range 1), with a 25% chance to fully stun — and a root if the stun fails to land.',
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
    'Erupt with anti-stealth force: every veiled entity takes 1d6 shatter and is stunned, all veils across the field are torn down, then a chosen mage slips behind a half veil for 2 turns.',
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
    'Curse the target with splintering pain: 1d6 shatter damage each turn for 3 turns, each tick carrying a 25% chance to fully stun (range 5).',
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
    'A long-range bombardment landing exactly at range 15: a 5-range blast of 1d6 shatter with a 25% slow, and a 1-range core of 2d6 pierce that roots.',
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

registerSpell({
  name: 'Mind Shadow',
  words: ['mind', 'shadow'],
  actionType: 'main',
  range: R(8),
  targeting: 'enemy',
  dc: 11,
  description:
    '1d6 sanity + 1d3 shadow damage (range 8), and your shadow clings to the target — wherever it walks next turn it leaves a pool of your shadow that lasts 5 turns.',
  visual: { preset: 'projectile', color: 0x9b7bff, size: 10, speed: 1.4 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Mind Shadow'), 'shadow', 'sanity'));
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d3', 'Mind Shadow'), 'shadow', 'physical'));
    applyShadowTrail(ctx, ctx.target, { duration: 2, perShadowTtl: 5 });
  },
});

registerSpell({
  name: 'Shadow Corrode',
  words: ['shadow', 'corrode'],
  actionType: 'main',
  range: R(10),
  bonusRangeInOwnShadow: R(99),
  targeting: 'enemy',
  dc: 11,
  description:
    '1d6 corrosive + 2d6 shadow damage (range 10). If the target stands in one of your shadows you can strike it from anywhere on the field.',
  visual: { preset: 'projectile', color: 0xa8d88a, size: 11, speed: 1.4 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Shadow Corrode'), 'corrosive', 'physical'));
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '2d6', 'Shadow Corrode'), 'shadow', 'physical'));
  },
});

registerSpell({
  name: 'Bind Veil',
  words: ['bind', 'veil'],
  actionType: 'bonus',
  range: 0,
  targeting: 'any',
  dc: 10,
  reaction: true,
  description:
    'Vanish and ensnare: slip a chosen mage behind a half veil for 2 turns and root the nearest enemy within range 10 for 2 turns, so nothing can give chase. Castable as a reaction.',
  visual: { preset: 'nova', color: 0x8ad1ff, size: 60, speed: 1.1 },
  cast(ctx) {
    applyInvisibility(ctx, ctx.target ?? ctx.caster, { duration: 2, mode: 'partial' });
    const foe = enemyNear(ctx, ctx.caster.pos, R(10));
    if (foe) applyStun(ctx, foe, { duration: 2, type: 'movement' });
  },
});

registerSpell({
  name: 'Bind Corrode',
  words: ['bind', 'corrode'],
  actionType: 'main',
  range: R(10),
  targeting: 'enemy',
  dc: 11,
  description:
    '1d6 corrosive damage and the target is rooted for 2 turns as caustic rot sets in, bleeding 1d3 corrosive each turn for 3 turns (range 10).',
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

registerSpell({
  name: 'Bind Curse',
  words: ['bind', 'curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 12,
  description:
    'A shackling hex (range 15): for 4 turns the target is rooted in place and withers for 1d3 shadow damage at the start of each of its turns.',
  visual: { preset: 'beam', color: 0x6a7bd0, size: 6, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    applyStun(ctx, ctx.target, { duration: 4, type: 'movement' });
    applyDot(ctx, ctx.target, {
      name: 'Bind Curse',
      duration: 4,
      damage: dmg(2, 'shadow', 'physical'),
      damageSpec: '1d3',
    });
  },
});

registerSpell({
  name: 'Veil Corrode',
  words: ['veil', 'corrode'],
  actionType: 'bonus',
  range: 0,
  targeting: 'any',
  dc: 10,
  aoe: { kind: 'circle', radius: R(2) },
  description:
    'Cloak a chosen mage in a caustic haze: it slips behind a half veil for 2 turns while every enemy within range 2 of the caster takes 1d6 corrosive damage and is slowed.',
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
    'Hex from hiding (range 15): the target bleeds 1d3 shadow damage each turn for 4 turns, and you slip behind a half veil for 2 turns as the curse takes hold.',
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
    'A corrosive lance (range 10): 1d6 pierce + 1d6 corrosive damage, leaving the target bleeding 1d3 corrosive each turn for 2 turns and slowed.',
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
    'A push-your-luck flurry: roll a d6 and, for each fresh result, blinkstep (a teleport that ignores movement modifiers) to a point within R(4) then lash an enemy within R(5) of you for 1d3 sanity + 1d3 pierce. Each blink invites a reaction. The moment a number repeats, you turn fully invisible for 2 rounds and the flurry ends.',
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
    'A far-reaching warp (range 25). Cast as a reaction it stifles any action it answers — a spell or even a move. Twisting the same target twice in one turn deals 2d6 physical; otherwise it disarms their next action.',
  visual: { preset: 'beam', color: 0x66ffd1, size: 5, speed: 1.4 },
  cast(ctx) {
    if (!ctx.target) return;
    twistStrike(ctx, ctx.target);
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
    "Warp the target's memory: it forgets 2 random actions (move, melee, or one of its words) for 2 turns.",
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
    'Swap minds with the target for the next exchange: you pilot their mage and they pilot yours for the next 2 turns.',
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
  description:
    'Tear a 45° wedge of reality open along the aimed direction at unlimited range. For 3 rounds no one may move into it: run in and you are rooted until it mends; dash in and you stop dead as your dash ends.',
  visual: { preset: 'burst', color: 0xff5599, size: 70, speed: 1.2 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    const diag = Math.hypot(FIELD.w, FIELD.h);
    placeBarrier(ctx, ctx.targetPoint, { degrees: 45, range: diag, ttl: 3 });
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
    'Bend the timeline: you take an extra turn after this one, and the target takes 3d3 mental damage and cannot move for 1 turn.',
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
//  KAT EASTER-EGG SPELLS   (words: Corrode / Curse / Shadow / Drain)
// ===========================================================================

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
    'Raise a leeching totem (range 5) whose 3-range aura deals 1d3 corrosive damage to enemies each turn and heals you for the damage dealt.',
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
    '1d6 corrosive + 2d6 shadow damage (range 10), healing you for the full amount dealt. If the target stands in one of your shadows you can strike it from anywhere on the field.',
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
    'Loose a swarm of 5 scarabs around a point (range 5). Each turn they crawl toward the nearest enemy (up to 3 per foe, never straying past range 8 from you), bite for 1d3, then return to heal you for 1d3. They have 5 health and 5 sanity and can be destroyed by area effects.',
  visual: { preset: 'burst', color: 0x57d6a0, size: 70, speed: 1.1 },
  cast(ctx) {
    if (!ctx.targetPoint) return;
    summonScarabs(ctx, ctx.targetPoint);
  },
});

// ===========================================================================
//  FINN'S ADDITIONS — 3-WORD SPELLS   (set: 'finns')
//  Only available when Finn's Additions is enabled on the start screen.
//  DC 13–15; every spell delivers one "over-the-top" payoff.
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
    'Foresee the blow and slip aside: drop behind a full veil for 2 turns (often dodging the triggering attack), root the nearest enemy within range 12 for 2 turns, and mark them — no reaction and +2 damage next turn. Does not counter the action.',
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
    'Step out of the world: turn fully invisible for 2 turns and blinkstep to your nearest shadow pool. The nearest enemy within range 10 is foreseen — no reaction and +2 damage taken next turn. With no shadow on the field you vanish where you stand.',
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
//  SHADOW + MIND + PIERCE   —   Umbral Flurry
//  Chain-dash through every own shadow, lancing whoever is close.
// ---------------------------------------------------------------------------
registerSpell({
  name: 'Umbral Flurry',
  words: ['shadow', 'mind', 'pierce'],
  set: 'finns',
  actionType: 'main',
  range: 0,
  targeting: 'self',
  dc: 13,
  description:
    'Chain-blinkstep through up to 4 of your own shadows (nearest first), lancing the nearest enemy within range 3 of each pool for 1d6 pierce + 1d4 sanity. Each blink invites a reaction. With no shadows on the field the flurry fizzles.',
  visual: { preset: 'projectile', color: 0x9b7bff, size: 10, speed: 1.8 },
  async cast(ctx) {
    const pools = ctx.game.shadowsOf(ctx.caster.team).slice();
    if (pools.length === 0) {
      ctx.log(`${ctx.caster.name} reaches for shadows that aren't there — the flurry fizzles.`);
      return;
    }
    pools.sort(
      (a, b) =>
        Math.hypot(a.x - ctx.caster.x, a.y - ctx.caster.y) -
        Math.hypot(b.x - ctx.caster.x, b.y - ctx.caster.y)
    );
    for (const s of pools.slice(0, 4)) {
      if (!ctx.caster.alive) return;
      blinkstep(ctx, ctx.caster, { toPoint: { x: s.x, y: s.y }, distance: 99999 });
      await ctx.reactionWindow?.('Umbral Flurry — blink', ctx.caster.pos);
      if (!ctx.caster.alive) return;
      const foe = enemyNear(ctx, ctx.caster.pos, R(3));
      if (foe) {
        dealDamage(ctx, foe, dmg(rollDice(ctx, '1d6', 'Umbral Flurry'), 'pierce', 'physical'));
        dealDamage(ctx, foe, dmg(rollDice(ctx, '1d4', 'Umbral Flurry'), 'shadow', 'sanity'));
      }
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
    'Drive a spike of force through mind and body (range 12): 2d6 pierce + 1d6 sanity damage. If the target is left below a quarter of its HP or sanity, the wound splits open for 3d6 true pierce damage.',
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
    'Unleash an anti-magic pulse: 1d6 shatter to every enemy within range 4, strip all veils from the field, conjure a shadow pool at your feet, then slip behind a full veil yourself.',
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
    'Crack the target\'s mind with shattering force (range 4): 2d4 shatter + 2d4 sanity damage and root for 3 turns. If this drops them below a quarter sanity, you are granted an extra turn.',
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
    'Blinkstep to the nearest shadow pool, then lance a target within range 12 for 2d6 pierce + 1d6 corrosive, leaving a corroding wound that bleeds 1d3 each turn for 3 turns. Without a shadow on the field you fire a weaker 1d6 lance from where you stand.',
  visual: { preset: 'projectile', color: 0xa8d88a, size: 11, speed: 1.8 },
  cast(ctx) {
    if (!ctx.target) return;
    const pools = ctx.game.shadowsOf(ctx.caster.team);
    if (pools.length === 0) {
      ctx.log(`${ctx.caster.name} finds no shadow to strike from — the fang is blunted.`);
      dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Venomfang'), 'pierce', 'physical'));
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
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '2d6', 'Venomfang'), 'pierce', 'physical'));
    dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Venomfang'), 'corrosive', 'physical'));
    applyDot(ctx, ctx.target, {
      name: 'Venomfang',
      duration: 3,
      damage: dmg(1, 'corrosive', 'physical'),
      damageSpec: '1d3',
    });
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
    'Fire a 90° cone of nightmare shatter (range 6): 1d6 shatter to every enemy caught. Veiled targets are stripped and take an extra 1d6. All targets struck are cursed with a sanity rot: 1d3 sanity damage per turn for 3 turns.',
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
    'Open a 3-range pool of grasping shadow (range 10): every enemy caught is rooted for 3 turns and cursed to bleed 1d3 shadow damage each turn for 4 turns. The shadow lingers for 5 turns.',
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
    'Bind the target in corroding chains (range 15): rooted for 4 turns, bleeding 1d3 corrosive each turn for 4 turns, and slowed by 50% even after the root breaks.',
  visual: { preset: 'beam', color: 0x9be870, size: 6, speed: 1 },
  cast(ctx) {
    if (!ctx.target) return;
    applyStun(ctx, ctx.target, { duration: 4, type: 'movement' });
    applyDot(ctx, ctx.target, {
      name: 'Rotting Shackles',
      duration: 4,
      damage: dmg(1, 'corrosive', 'physical'),
      damageSpec: '1d3',
    });
    applyDebuff(ctx, ctx.target, {
      name: 'Etched',
      duration: 6,
      mods: { moveRange: -Math.round(MOVE_RANGE * 0.5) },
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
    'Detonate a 3-range blight (range 12): 1d6 shatter + 1d6 corrosive to all enemies caught, a 25% chance to fully stun each, and a corrosive plague bleeding 1d3 per turn for 3 turns.',
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
      applyDot(ctx, m, {
        name: 'Blight',
        duration: 3,
        damage: dmg(1, 'corrosive', 'physical'),
        damageSpec: '1d3',
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
    'Root the nearest enemy within range 10 for 3 turns, conjure a shadow pool at their location, then slip behind a full veil for 2 turns. Castable as a reaction.',
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
    'Smash corrosive crystal into an adjacent foe (range 1): 1d6 shatter + 1d6 corrosive damage, a brief full stun that hardens into a 3-turn root, then a calcification slow that persists for 6 turns.',
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
    'Seed a spreading mental plague (range 15): expose the target for 2 turns (no reaction, +2 damage taken), inflict a 1d3 sanity rot for 4 turns, and a 1d3 corrosive wound for 4 turns. Zero burst — pure attrition.',
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
    'Hurl a cursed piercing shard at long range (range 18): 2d6 pierce damage and a harrowing curse that deals 1d6 shatter each turn for 3 turns, with a 33% chance to fully stun on each tick.',
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

