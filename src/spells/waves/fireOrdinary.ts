// =============================================================================
//  FIRE · ORDINARY SPELLS
// -----------------------------------------------------------------------------
//  Fire is red: stacking Fire that burns at the start of each turn, spreads
//  when it overflows and can be made to burn all at once. These are the
//  three-word Fire combos that had no spell yet. Blue beside it holds and
//  hides, black beside it hits everyone near, colourless words hit hardest.
// =============================================================================

import { dmg } from '../../core/Damage';
import type { Mage } from '../../core/Mage';
import type { FireStatus } from '../../core/Status';
import {
  applyBlueflareStacks,
  applyDebuff,
  applyDot,
  applyFireStacks,
  applyInvisibility,
  placeShadow,
  type EffectContext,
} from '../../effects/effects';
import { registerSpell } from '../registry';
import {
  curseWith,
  drag,
  everyoneAround,
  everyoneInCone,
  foesAround,
  foesOnLane,
  hit,
  lane,
  R,
  root,
  shove,
  strikeAll,
} from './waterKit';

const FIRE = 0xff5a36;
const EMBER = 0xff8a3d;
const STEAM = 0xd9e8f2;
const SMOKE = 0x6a4a5a;

const fireOf = (m: Mage): number => (m.statuses.find((s) => s.kind === 'fire') as FireStatus | undefined)?.stacks ?? 0;

function burn(ctx: EffectContext, m: Mage, stacks: number): void {
  if (m.alive) applyFireStacks(ctx, m, stacks);
}

// =============================================================================
//  WITH BLUE: HOLD AND HIDE
// =============================================================================

registerSpell({
  name: 'Smouldering Shackle',
  words: ['fire', 'bind', 'mind'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description: 'One enemy within 15cm is rooted for 2 turns and gains 2 Fire and 2 Blueflare.',
  visual: { preset: 'beam', color: 0xd86ab0, size: 7, speed: 1.3 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    root(ctx, foe, 2);
    burn(ctx, foe, 2);
    if (foe.alive) applyBlueflareStacks(ctx, foe, 2);
  },
});

registerSpell({
  name: 'Kiln Lock',
  words: ['fire', 'bind', 'shatter'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 12cm takes 1d6 shatter. If it was burning, all of its Fire burns at once in a single hit and it ' +
    'is rooted for 2 turns; otherwise it gains 2 Fire and is rooted for 1 turn.',
  visual: { preset: 'conjure', color: EMBER, size: 34, speed: 1.2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const burning = fireOf(foe) > 0;
    hit(ctx, foe, '1d6', 'shatter', 'Kiln Lock');
    if (!foe.alive) return;
    if (burning) ctx.game.condenseFire(foe, ctx);
    else burn(ctx, foe, 2);
    root(ctx, foe, burning ? 2 : 1);
  },
});

registerSpell({
  name: 'Boiling Snare',
  words: ['fire', 'bind', 'water'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 12cm takes 1d4 water and 1d4 heat, is dragged up to 3cm toward you, rooted for 1 turn and gains 1 Fire.',
  visual: { preset: 'beam', color: STEAM, size: 8, speed: 1.4 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d4', 'water', 'Boiling Snare');
    hit(ctx, foe, '1d4', 'heat', 'Boiling Snare');
    drag(ctx, foe, ctx.caster.pos, 3);
    root(ctx, foe, 1);
    burn(ctx, foe, 1);
  },
});

registerSpell({
  name: 'Smokeburst',
  words: ['fire', 'veil', 'shatter'],
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 13,
  aoe: { kind: 'circle', radius: R(3) },
  description:
    'Glass and smoke burst around you: every enemy within 3cm takes 1d6 shatter and gains 1 Fire. Then you vanish into ' +
    'a full veil until your next turn.',
  visual: { preset: 'nova', color: SMOKE, size: R(3), speed: 1.4 },
  cast(ctx) {
    const caught = foesAround(ctx, ctx.caster.pos, R(3));
    strikeAll(ctx, caught, [['1d6', 'shatter']], 'Smokeburst');
    for (const m of caught) burn(ctx, m, 1);
    applyInvisibility(ctx, ctx.caster, { duration: 1, mode: 'full' });
  },
});

registerSpell({
  name: 'Steam Veil',
  words: ['fire', 'veil', 'water'],
  actionType: 'main',
  range: 0,
  targeting: 'none',
  dc: 13,
  aoe: { kind: 'circle', radius: R(3) },
  description:
    'Scalding steam rolls off you: every enemy within 2cm takes 1d4 heat, gains 1 Fire and is pushed 2cm away. You and ' +
    'every ally within 3cm slip into a half veil for 2 turns.',
  visual: { preset: 'nova', color: STEAM, size: R(3), speed: 1.1 },
  cast(ctx) {
    const scalded = foesAround(ctx, ctx.caster.pos, R(2));
    strikeAll(ctx, scalded, [['1d4', 'heat']], 'Steam Veil');
    for (const m of scalded) {
      burn(ctx, m, 1);
      shove(ctx, m, ctx.caster.pos, 2);
    }
    for (const friend of everyoneAround(ctx, ctx.caster.pos, R(3))) {
      if (friend.team === ctx.caster.team) applyInvisibility(ctx, friend, { duration: 2, mode: 'partial' });
    }
  },
});

registerSpell({
  name: 'Mindfire Fracture',
  words: ['fire', 'mind', 'shatter'],
  actionType: 'main',
  range: R(12),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 12cm takes 1d6 shatter. If it was burning, its Fire turns inward: every Fire stack becomes ' +
    'Blueflare, plus 1, and the flare pulses at once. Otherwise it gains 1 Fire and 1 Blueflare.',
  visual: { preset: 'conjure', color: 0xb070ff, size: 34, speed: 1.2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const stacks = fireOf(foe);
    hit(ctx, foe, '1d6', 'shatter', 'Mindfire Fracture');
    if (!foe.alive) return;
    if (stacks > 0) {
      foe.statuses = foe.statuses.filter((s) => s.kind !== 'fire');
      ctx.log(`${foe.name}'s Fire turns inward.`);
      applyBlueflareStacks(ctx, foe, stacks + 1);
      if (foe.alive) ctx.game.pulseBlueflare(foe);
      return;
    }
    burn(ctx, foe, 1);
    if (foe.alive) applyBlueflareStacks(ctx, foe, 1);
  },
});

// =============================================================================
//  WITH BLACK: EVERYONE NEAR BURNS
// =============================================================================

registerSpell({
  name: 'Cinderfall',
  words: ['fire', 'shadow', 'shatter'],
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'circle', radius: R(2) },
  description:
    'Burning slag falls on a point within 12cm: everything within 2cm, allies and you included, takes 2d6 shatter and ' +
    'gains 2 Fire. Leaves a shadow for 3 turns.',
  visual: { preset: 'burst', color: EMBER, size: R(2), speed: 1 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const caught = everyoneAround(ctx, at, R(2));
    strikeAll(ctx, caught, [['2d6', 'shatter']], 'Cinderfall');
    for (const m of caught) burn(ctx, m, 2);
    placeShadow(ctx, at, 3);
  },
});

registerSpell({
  name: 'Black Smoke',
  words: ['fire', 'shadow', 'corrode'],
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'circle', radius: R(3) },
  description:
    'Choking smoke at a point within 12cm: every unit within 3cm but you takes 1d6 corrosive, and 1d6 shadow more if ' +
    'it was burning. Then each gains 1 Fire. Leaves a shadow for 3 turns.',
  visual: { preset: 'burst', color: SMOKE, size: R(3), speed: 0.9 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const caught = everyoneAround(ctx, at, R(3)).filter((m) => m !== ctx.caster);
    const burning = caught.filter((m) => fireOf(m) > 0);
    strikeAll(ctx, caught, [['1d6', 'corrosive']], 'Black Smoke');
    strikeAll(ctx, burning, [['1d6', 'shadow']], 'Black Smoke');
    for (const m of caught) burn(ctx, m, 1);
    placeShadow(ctx, at, 3);
  },
});

registerSpell({
  name: 'Smouldering Hex',
  words: ['fire', 'shadow', 'curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'Curse one enemy within 15cm for 4 turns: 1d4 shadow at the start of its turns, and each tick scorches every other ' +
    'enemy within 2cm of it for 1d3 heat. It gains 2 Fire now.',
  visual: { preset: 'beam', color: 0xa04a6a, size: 6, speed: 1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    applyDot(ctx, foe, {
      name: 'Smouldering Hex',
      key: 'dot:smouldering-hex',
      duration: 4,
      damage: dmg(0, 'shadow'),
      damageSpec: '1d4',
      splash: { radius: R(2), damage: dmg(0, 'heat'), damageSpec: '1d3' },
      sourceTeam: ctx.caster.team,
    });
    burn(ctx, foe, 2);
  },
});

registerSpell({
  name: 'Ember from the Dark',
  words: ['fire', 'shadow', 'pierce'],
  actionType: 'main',
  range: R(15),
  bonusRangeInOwnShadow: R(99),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 15cm, or anywhere if it stands in one of your shadows, takes 1d6 pierce and 1d6 heat. It gains 2 ' +
    'Fire, or 4 if it stands in any shadow.',
  visual: { preset: 'projectile', color: 0xc8502a, size: 9, speed: 1.6 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const dark = ctx.game.isInShadow(foe);
    hit(ctx, foe, '1d6', 'pierce', 'Ember from the Dark');
    hit(ctx, foe, '1d6', 'heat', 'Ember from the Dark');
    burn(ctx, foe, dark ? 4 : 2);
  },
});

registerSpell({
  name: 'Slagburst',
  words: ['fire', 'shatter', 'corrode'],
  actionType: 'main',
  range: R(10),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'circle', radius: R(2) },
  description:
    'Molten slag bursts at a point within 10cm: every unit within 2cm but you, allies included, takes 1d6 corrosive and ' +
    '1d6 shatter and gains 1 Fire.',
  visual: { preset: 'burst', color: 0xd9a23b, size: R(2), speed: 1.1 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const caught = everyoneAround(ctx, at, R(2)).filter((m) => m !== ctx.caster);
    strikeAll(ctx, caught, [['1d6', 'corrosive'], ['1d6', 'shatter']], 'Slagburst');
    for (const m of caught) burn(ctx, m, 1);
  },
});

registerSpell({
  name: 'Kindled Fracture',
  words: ['fire', 'shatter', 'curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description: 'Curse one enemy within 15cm for 3 turns: 1d6 shatter at the start of its turns. It gains 2 Fire now.',
  visual: { preset: 'beam', color: 0xc87a4a, size: 7, speed: 1.1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    curseWith(ctx, foe, 'Kindled Fracture', 'shatter', 3, { damageSpec: '1d6' });
    burn(ctx, foe, 2);
  },
});

registerSpell({
  name: 'Searing Shrapnel',
  words: ['fire', 'shatter', 'pain'],
  actionType: 'main',
  range: R(5),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'cone', radius: R(5), degrees: 90 },
  description:
    'A 90° cone of burning shrapnel, 5cm long: everything in it, allies included, takes 1d6 shatter and 1d4 sanity and ' +
    'gains 1 Fire.',
  visual: { preset: 'burst', color: 0xd8604a, size: 60, speed: 1.2 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const caught = everyoneInCone(ctx, at, R(5), 90);
    strikeAll(ctx, caught, [['1d6', 'shatter'], ['1d4', 'sanity']], 'Searing Shrapnel');
    for (const m of caught) burn(ctx, m, 1);
  },
});

registerSpell({
  name: 'Rotfire',
  words: ['fire', 'corrode', 'curse'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'Curse one enemy within 15cm for 4 turns: 1d4 corrosive at the start of its turns, and each tick the rot spreads to ' +
    'everything within 2cm of it, allies included, for half the turns left. It gains 2 Fire now.',
  visual: { preset: 'beam', color: 0x9a8a3a, size: 7, speed: 1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    curseWith(ctx, foe, 'Rotfire', 'corrosive', 4, { damageSpec: '1d4', spreadRadius: R(2) });
    burn(ctx, foe, 2);
  },
});

registerSpell({
  name: 'Etching Bolt',
  words: ['fire', 'corrode', 'pierce'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'One enemy within 15cm takes 1d6 pierce and 1d6 corrosive and gains 2 Fire. The acid eats into it: it takes 1 more ' +
    'damage from every hit for 3 turns.',
  visual: { preset: 'projectile', color: 0xb8c84a, size: 9, speed: 1.6 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d6', 'pierce', 'Etching Bolt');
    hit(ctx, foe, '1d6', 'corrosive', 'Etching Bolt');
    burn(ctx, foe, 2);
    if (foe.alive) applyDebuff(ctx, foe, { name: 'Etched', duration: 3, mods: { damageTaken: 1 } });
  },
});

registerSpell({
  name: 'Burning Rot',
  words: ['fire', 'corrode', 'pain'],
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'circle', radius: R(3) },
  description:
    'At a point within 12cm, every unit within 3cm but you, allies included, takes 1d4 corrosive and 1d4 sanity and gains 1 Fire.',
  visual: { preset: 'burst', color: 0xa86a3a, size: R(3), speed: 0.9 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const caught = everyoneAround(ctx, at, R(3)).filter((m) => m !== ctx.caster);
    strikeAll(ctx, caught, [['1d4', 'corrosive'], ['1d4', 'sanity']], 'Burning Rot');
    for (const m of caught) burn(ctx, m, 1);
  },
});

registerSpell({
  name: 'Barbed Ember',
  words: ['fire', 'curse', 'pierce'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description: 'One enemy within 15cm takes 1d6 pierce and is cursed for 3 turns: 1d4 heat at the start of its turns. It gains 1 Fire.',
  visual: { preset: 'projectile', color: 0xe0603a, size: 8, speed: 1.6 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d6', 'pierce', 'Barbed Ember');
    curseWith(ctx, foe, 'Barbed Ember', 'heat', 3, { damageSpec: '1d4' });
    burn(ctx, foe, 1);
  },
});

registerSpell({
  name: 'Fever Dream',
  words: ['fire', 'curse', 'pain'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'Curse one enemy within 15cm for 4 turns with a fever that climbs: 1d3 sanity at the start of its first turn, then ' +
    '1d4, 1d6 and 1d8. It gains 2 Fire now.',
  visual: { preset: 'beam', color: 0xd8506a, size: 6, speed: 1 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    curseWith(ctx, foe, 'Fever Dream', 'sanity', 4, { damageSpec: '1d3', escalateSpecs: ['1d3', '1d4', '1d6', '1d8'] });
    burn(ctx, foe, 2);
  },
});

// =============================================================================
//  WITH COLOURLESS WORDS: HIT HARDEST
// =============================================================================

registerSpell({
  name: 'Molten Lance',
  words: ['fire', 'shatter', 'pierce'],
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 14,
  noCastSprite: true,
  description:
    'A molten lance 12cm long from you toward a point: every enemy on it takes 2d6 pierce and 1d6 heat and gains 1 Fire.',
  visual: { preset: 'beam', color: FIRE, size: 10, speed: 1.8 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const { from, to } = lane(ctx, at, R(12));
    const struck = foesOnLane(ctx, from, to);
    strikeAll(ctx, struck, [['2d6', 'pierce'], ['1d6', 'heat']], 'Molten Lance');
    for (const m of struck) burn(ctx, m, 1);
  },
});

registerSpell({
  name: 'Steam Burst',
  words: ['fire', 'shatter', 'water'],
  actionType: 'main',
  range: R(12),
  targeting: 'point',
  dc: 13,
  aoe: { kind: 'circle', radius: R(3) },
  description:
    'Water flashes to steam at a point within 12cm: every enemy within 3cm takes 1d6 water and is thrown 3cm out from ' +
    'it. Those that were burning burst: all of their Fire burns at once in a single hit, and they take 1d6 shatter.',
  visual: { preset: 'burst', color: STEAM, size: R(3), speed: 1.3 },
  cast(ctx) {
    const at = ctx.targetPoint;
    if (!at) return;
    const caught = foesAround(ctx, at, R(3));
    const burning = caught.filter((m) => fireOf(m) > 0);
    strikeAll(ctx, caught, [['1d6', 'water']], 'Steam Burst');
    for (const m of burning) {
      if (!m.alive) continue;
      ctx.game.condenseFire(m, ctx);
      hit(ctx, m, '1d6', 'shatter', 'Steam Burst', { canMiss: false, aoe: true });
    }
    for (const m of caught) shove(ctx, m, at, 3);
  },
});

registerSpell({
  name: 'Geyser Lance',
  words: ['fire', 'pierce', 'water'],
  actionType: 'main',
  range: R(15),
  targeting: 'enemy',
  dc: 13,
  description:
    'A jet of boiling water strikes one enemy within 15cm and every other enemy on the line to it: each takes 1d6 ' +
    'pierce and 1d4 heat, gains 1 Fire and is pushed 2cm away from you.',
  visual: { preset: 'beam', color: 0x8fc8f0, size: 8, speed: 1.9 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    const struck = foesOnLane(ctx, ctx.caster.pos, foe.pos);
    if (!struck.includes(foe)) struck.push(foe);
    strikeAll(ctx, struck, [['1d6', 'pierce'], ['1d4', 'heat']], 'Geyser Lance');
    for (const m of struck) {
      burn(ctx, m, 1);
      shove(ctx, m, ctx.caster.pos, 2);
    }
  },
});

registerSpell({
  name: 'Searing Needle',
  words: ['fire', 'pierce', 'pain'],
  actionType: 'main',
  range: R(20),
  targeting: 'enemy',
  ignoresStealth: true,
  dc: 14,
  description:
    'One enemy within 20cm, even a concealed one, takes 1d6 pierce and 1d6 sanity that cannot miss. It gains 2 Fire, ' +
    'and its Fire flares once at once.',
  visual: { preset: 'beam', color: 0xe05a5a, size: 4, speed: 2 },
  cast(ctx) {
    const foe = ctx.target;
    if (!foe) return;
    hit(ctx, foe, '1d6', 'pierce', 'Searing Needle', { canMiss: false });
    hit(ctx, foe, '1d6', 'sanity', 'Searing Needle', { canMiss: false });
    burn(ctx, foe, 2);
    if (foe.alive) ctx.game.pulseFire(foe);
  },
});
