// =============================================================================
//  CLASS SPELLS  (first wave)
// -----------------------------------------------------------------------------
//  "Class spells" are word combos made of only nouns or only verbs (see
//  isClassSpell in core/Words.ts). Unlike ordinary spells they resolve to a
//  DIFFERENT full definition per mage class — targeting, range, action type and
//  effect may all differ between Objects / Life / Hexcraft for the very same
//  words. They are registered here through registerClassSpell().
//
//  Rollout is phased. Where a class's bespoke variant is not built yet, that
//  variant preserves the combo's previous (pre-class) behaviour so nothing is
//  lost while the other classes are implemented.
//
//  Crit rule: Objects class spells CAN crit (doubling their duration via
//  critScale); Life and Hexcraft class spells never crit.
// =============================================================================

import { RANGE_UNIT } from '../config/constants';
import { dmg } from '../core/Damage';
import type { Mage } from '../core/Mage';
import {
  makeArcherSummon,
  makeBinderSummon,
  makeCorrosionSentry,
  makeGhostSummon,
} from '../core/summons';
import {
  applyAuraDot,
  applyDebuff,
  applyDot,
  applyInvisibility,
  applyShadowTrail,
  applyStun,
  dealDamage,
  dispelVeil,
  placeTotem,
  rollDice,
} from '../effects/effects';
import type { EffectContext } from '../effects/effects';
import { registerClassSpell } from './registry';

/** Abstract range number (5 / 10 / 15) to pixels. */
const R = (units: number): number => units * RANGE_UNIT;

/** Nearest living enemy of the caster within `radius` of `at`, if any. */
function nearestEnemy(ctx: EffectContext, at: { x: number; y: number }, radius: number): Mage | null {
  const foes = ctx.game
    .magesInRadius(at, radius, ctx.caster)
    .filter((m) => m.team !== ctx.caster.team);
  if (foes.length === 0) return null;
  foes.sort((a, b) => (a.x - at.x) ** 2 + (a.y - at.y) ** 2 - ((b.x - at.x) ** 2 + (b.y - at.y) ** 2));
  return foes[0];
}

/** Roll 1d20 as a summon's vigour (scales its stats). */
function summonVigor(ctx: EffectContext): number {
  return rollDice(ctx, '1d20', 'Summon vigor');
}

// ===========================================================================
//  MIND SHADOW   (mind + shadow — all nouns)
//    Objects  : a conjured shadow-edge that mills the mind and stains the ground.
//    Life     : raise a controllable "mill"-damage ghost that can hold an item.
//    Hexcraft : wreathe a foe in a mind-eating shadow aura that bleeds those near it.
// ===========================================================================
registerClassSpell({
  words: ['mind', 'shadow'],
  variants: {
    objects: {
      name: 'Mind Shadow Edge',
      actionType: 'main',
      range: R(8),
      targeting: 'enemy',
      dc: 11,
      description:
        'Conjure a shadow-edged strike: 1d6 sanity + 1d3 shadow to one enemy (range 8). ' +
        'For its next turn, wherever it moves it trails your shadow pools (each lasts 5 turns).',
      visual: { preset: 'projectile', color: 0x9b7bff, size: 10, speed: 1.4 },
      cast(ctx) {
        if (!ctx.target) return;
        dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Mind Shadow Edge'), 'shadow', 'sanity'));
        dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d3', 'Mind Shadow Edge'), 'shadow', 'physical'));
        applyShadowTrail(ctx, ctx.target, { duration: 2, perShadowTtl: 5 });
      },
    },
    life: {
      name: 'Mind Shadow',
      actionType: 'main',
      range: R(6),
      targeting: 'point',
      dc: 12,
      noCrit: true,
      noCastSprite: true,
      description:
        'Summon a ghost (aimed within range 6). It deals "mill" (sanity) damage, ' +
        'can hold and use one item, and obeys your Command bonus action. HP 7; ' +
        'its str/dex/int scale with the cast roll and your intellect. Incorporeal ' +
        'and undead, but weak to light — bad in daylight.',
      visual: { preset: 'conjure', color: 0x9b7bff, size: 26, speed: 1 },
      cast(ctx) {
        if (!ctx.targetPoint) return;
        const ghost = makeGhostSummon({
          ownerInt: ctx.caster.effectiveInt(),
          dcRoll: summonVigor(ctx),
          ownerName: ctx.caster.name,
          pos: ctx.targetPoint,
          team: ctx.caster.team,
        });
        ctx.game.spawnSummon(ghost, ctx.caster, 'ghost');
        ctx.log(`${ctx.caster.name} raises ${ghost.name} (HP ${ghost.hp}).`);
      },
    },
    hexcraft: {
      name: 'Mind Shadow',
      actionType: 'main',
      range: R(8),
      targeting: 'enemy',
      dc: 12,
      noCrit: true,
      description:
        'Wreathe one enemy (range 8) in a mind-shadow aura for 4 turns: at the start of ' +
        "each turn it and every enemy within range 3 of it take 1d3 shadow \u201cmill\u201d damage.",
      visual: { preset: 'nova', color: 0x9b7bff, size: 46, speed: 1 },
      cast(ctx) {
        if (!ctx.target) return;
        applyAuraDot(ctx, ctx.target, {
          name: 'Mind Shadow',
          duration: 4,
          radius: R(3),
          damageSpec: '1d3',
          type: 'shadow',
          damageClass: 'sanity',
        });
      },
    },
  },
});

// ===========================================================================
//  CORRODE CURSE   (corrode + curse — all verbs)
//    Objects  : an acid-etched strike that keeps eating at the wound.
//    Life     : a slow, walking "rot totem" that corrodes and mires what it touches.
//    Hexcraft : plant a corroding totem-field that gnaws and slows those inside it.
// ===========================================================================
registerClassSpell({
  words: ['corrode', 'curse'],
  variants: {
    objects: {
      name: 'Corrode Curse',
      actionType: 'main',
      range: R(6),
      targeting: 'enemy',
      dc: 11,
      description:
        'Etch one enemy with acid (range 6): 1d6 corrosive damage now, then 1d3 corrosive ' +
        'at the start of each of its next 3 turns.',
      visual: { preset: 'projectile', color: 0x9be870, size: 11, speed: 1.4 },
      cast(ctx) {
        if (!ctx.target) return;
        dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Corrode Curse'), 'corrosive', 'physical'));
        applyDot(ctx, ctx.target, {
          name: 'Corrosion',
          duration: 3,
          damage: dmg(2, 'corrosive', 'physical'),
          damageSpec: '1d3',
        });
      },
    },
    life: {
      name: 'Corrode Curse',
      actionType: 'main',
      range: R(5),
      targeting: 'point',
      dc: 12,
      noCrit: true,
      noCastSprite: true,
      description:
        'Raise a Rot Sentry (aimed within range 5): a slow, walking totem (moves 5) that ' +
        'corrodes what it strikes and mires it (\u2013 movement for 2 turns). HP 8; obeys your ' +
        'Command bonus action. Its stats scale with the cast roll and your intellect.',
      visual: { preset: 'conjure', color: 0x9be870, size: 30, speed: 1 },
      cast(ctx) {
        if (!ctx.targetPoint) return;
        const sentry = makeCorrosionSentry({
          ownerInt: ctx.caster.effectiveInt(),
          dcRoll: summonVigor(ctx),
          ownerName: ctx.caster.name,
          pos: ctx.targetPoint,
          team: ctx.caster.team,
        });
        sentry.intrinsicMelee!.onHit = (hitCtx, victim) => {
          applyDebuff(hitCtx, victim, {
            name: 'Mired',
            duration: 2,
            mods: { moveRange: -R(4) },
          });
        };
        ctx.game.spawnSummon(sentry, ctx.caster, 'sentry');
        ctx.log(`${ctx.caster.name} raises ${sentry.name} (HP ${sentry.hp}).`);
      },
    },
    hexcraft: {
      name: 'Corrode Curse',
      actionType: 'bonus',
      range: R(5),
      targeting: 'point',
      dc: 11,
      noCrit: true,
      aoe: { kind: 'circle', radius: R(3) },
      noCastSprite: true,
      description:
        'Plant a corroding totem (aimed within range 5). Each turn it deals 1d3 corrosive ' +
        'damage to enemies within range 3 of it and slows them by 50%.',
      visual: { preset: 'burst', color: 0x9be870, size: 50, speed: 1 },
      cast(ctx) {
        if (!ctx.targetPoint) return;
        placeTotem(ctx, ctx.targetPoint, { radius: R(3), damageSpec: '1d3', slow: 0.5 });
      },
    },
  },
});

// ===========================================================================
//  BIND VEIL   (bind + veil — all verbs)
//    Objects  : a caltrop-and-smoke ward — veil an ally, root a nearby foe.
//    Life     : each of your summons roots the nearest foe and half-vanishes.
//    Hexcraft : a veiling field — hide your side, root theirs, all at once.
// ===========================================================================
registerClassSpell({
  words: ['bind', 'veil'],
  variants: {
    objects: {
      name: 'Bind Veil',
      actionType: 'bonus',
      range: 0,
      targeting: 'any',
      dc: 10,
      reaction: true,
      description:
        'Give a chosen mage a half veil for 2 turns and root the nearest enemy within ' +
        'range 10 for 2 turns. Can be cast as a reaction.',
      visual: { preset: 'nova', color: 0x8ad1ff, size: 60, speed: 1.1 },
      cast(ctx) {
        applyInvisibility(ctx, ctx.target ?? ctx.caster, { duration: 2, mode: 'partial' });
        const foe = nearestEnemy(ctx, ctx.caster.pos, R(10));
        if (foe) applyStun(ctx, foe, { duration: 2, type: 'movement' });
      },
    },
    life: {
      name: 'Bind Veil',
      actionType: 'bonus',
      range: 0,
      targeting: 'any',
      dc: 10,
      noCrit: true,
      reaction: true,
      description:
        'Every summon you control roots the nearest enemy within range 3 of it for ' +
        '2 turns and turns hard to see (half veil) for 2 turns. With no summons out, ' +
        'instead veil a chosen mage and root the nearest enemy within range 10.',
      visual: { preset: 'nova', color: 0x8ad1ff, size: 60, speed: 1.1 },
      cast(ctx) {
        const summons = ctx.game.summonsOf(ctx.caster);
        if (summons.length === 0) {
          // Graceful fallback when nothing has been raised yet.
          applyInvisibility(ctx, ctx.target ?? ctx.caster, { duration: 2, mode: 'partial' });
          const foe = nearestEnemy(ctx, ctx.caster.pos, R(10));
          if (foe) applyStun(ctx, foe, { duration: 2, type: 'movement' });
          return;
        }
        for (const s of summons) {
          const foe = nearestEnemy(ctx, s.pos, R(3));
          if (foe) applyStun(ctx, foe, { duration: 2, type: 'movement' });
          applyInvisibility(ctx, s, { duration: 2, mode: 'partial' });
        }
      },
    },
    hexcraft: {
      name: 'Bind Veil',
      actionType: 'bonus',
      range: 0,
      targeting: 'self',
      dc: 11,
      noCrit: true,
      aoe: { kind: 'circle', radius: R(4) },
      reaction: true,
      description:
        'A veiling field bursts from you (range 4): you and every ally within it gain a ' +
        'half veil for 2 turns, and every enemy within it is rooted for 2 turns. Can be ' +
        'cast as a reaction.',
      visual: { preset: 'nova', color: 0x8ad1ff, size: 90, speed: 1.1 },
      cast(ctx) {
        const near = ctx.game.magesInRadius(ctx.caster.pos, R(4));
        for (const m of near) {
          if (!m.alive) continue;
          if (m.team === ctx.caster.team) {
            applyInvisibility(ctx, m, { duration: 2, mode: 'partial' });
          } else {
            applyStun(ctx, m, { duration: 2, type: 'movement' });
          }
        }
        applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'partial' });
      },
    },
  },
});

// ===========================================================================
//  BIND CURSE   (bind + curse — all verbs)
//    Objects  : a manacle-bolt that shackles and shadow-burns on impact.
//    Life     : raise a ranged Binder that roots what it strikes from afar.
//    Hexcraft : a lingering shackling curse — rooted and bleeding shadow for 4 turns.
// ===========================================================================
registerClassSpell({
  words: ['bind', 'curse'],
  variants: {
    objects: {
      name: 'Bind Curse',
      actionType: 'main',
      range: R(12),
      targeting: 'enemy',
      dc: 12,
      description:
        'Hurl a manacle-bolt at one enemy (range 12): 1d6 shadow damage and root it for ' +
        '2 turns.',
      visual: { preset: 'projectile', color: 0x6a7bd0, size: 11, speed: 1.4 },
      cast(ctx) {
        if (!ctx.target) return;
        dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Bind Curse'), 'shadow', 'physical'));
        applyStun(ctx, ctx.target, { duration: 2, type: 'movement' });
      },
    },
    life: {
      name: 'Bind Curse',
      actionType: 'main',
      range: R(6),
      targeting: 'point',
      dc: 12,
      noCrit: true,
      noCastSprite: true,
      description:
        'Raise a Binder (aimed within range 6): a fragile, ranged minion (reach 10) that ' +
        'roots what it strikes for 2 turns. HP 6; obeys your Command bonus action. Its ' +
        'stats scale with the cast roll and your intellect.',
      visual: { preset: 'conjure', color: 0x6a7bd0, size: 28, speed: 1 },
      cast(ctx) {
        if (!ctx.targetPoint) return;
        const binder = makeBinderSummon({
          ownerInt: ctx.caster.effectiveInt(),
          dcRoll: summonVigor(ctx),
          ownerName: ctx.caster.name,
          pos: ctx.targetPoint,
          team: ctx.caster.team,
        });
        binder.intrinsicMelee!.onHit = (hitCtx, victim) => {
          applyStun(hitCtx, victim, { duration: 2, type: 'movement' });
        };
        ctx.game.spawnSummon(binder, ctx.caster, 'binder');
        ctx.log(`${ctx.caster.name} raises ${binder.name} (HP ${binder.hp}).`);
      },
    },
    hexcraft: {
      name: 'Bind Curse',
      actionType: 'main',
      range: R(15),
      targeting: 'enemy',
      dc: 12,
      noCrit: true,
      description:
        'Root one enemy for 4 turns and deal 1d3 shadow damage at the start of each of ' +
        'its turns for 4 turns (range 15).',
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
    },
  },
});

// ===========================================================================
//  VEIL CORRODE PIERCE   (veil + corrode + pierce — all verbs)
//    Objects  : a veiled, armour-piercing acid lance — and you slip into a veil.
//    Life     : raise a corroding Archer that reveals the hidden and slows its marks.
//    Hexcraft : a piercing acid aura on a foe while you fade into a veil.
// ===========================================================================
registerClassSpell({
  words: ['veil', 'corrode', 'pierce'],
  variants: {
    objects: {
      name: 'Veil Corrode Pierce',
      actionType: 'main',
      range: R(8),
      targeting: 'enemy',
      dc: 13,
      description:
        'A veiled acid lance runs one enemy through (range 8): 1d8 piercing-corrosive ' +
        'damage plus 1d3 corrosive at the start of each of its next 2 turns. You slip ' +
        'into a half veil for 2 turns.',
      visual: { preset: 'projectile', color: 0x9be870, size: 12, speed: 1.6 },
      cast(ctx) {
        if (!ctx.target) return;
        dealDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d8', 'Veil Corrode Pierce'), 'corrosive', 'physical'));
        applyDot(ctx, ctx.target, {
          name: 'Corrosion',
          duration: 2,
          damage: dmg(2, 'corrosive', 'physical'),
          damageSpec: '1d3',
        });
        applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'partial' });
      },
    },
    life: {
      name: 'Veil Corrode Pierce',
      actionType: 'main',
      range: R(6),
      targeting: 'point',
      dc: 13,
      noCrit: true,
      noCastSprite: true,
      description:
        'Raise a Corroding Archer (aimed within range 6): a ranged minion that fires acid ' +
        'bolts (reach 15, but never point-blank under 10). Its shots reveal the hidden and ' +
        'mire the struck for 2 turns. HP 6; obeys your Command bonus action.',
      visual: { preset: 'conjure', color: 0x9be870, size: 28, speed: 1 },
      cast(ctx) {
        if (!ctx.targetPoint) return;
        const archer = makeArcherSummon({
          ownerInt: ctx.caster.effectiveInt(),
          dcRoll: summonVigor(ctx),
          ownerName: ctx.caster.name,
          pos: ctx.targetPoint,
          team: ctx.caster.team,
        });
        archer.intrinsicMelee!.onHit = (hitCtx, victim) => {
          dispelVeil(hitCtx, victim);
          applyDebuff(hitCtx, victim, {
            name: 'Mired',
            duration: 2,
            mods: { moveRange: -R(3) },
          });
        };
        ctx.game.spawnSummon(archer, ctx.caster, 'archer');
        ctx.log(`${ctx.caster.name} raises ${archer.name} (HP ${archer.hp}).`);
      },
    },
    hexcraft: {
      name: 'Veil Corrode Pierce',
      actionType: 'main',
      range: R(10),
      targeting: 'enemy',
      dc: 13,
      noCrit: true,
      description:
        'Wreathe one enemy (range 10) in a piercing acid aura for 3 turns: at the start of ' +
        'each turn it and every enemy within range 3 of it take 1d3 corrosive damage. You ' +
        'slip into a half veil for 2 turns.',
      visual: { preset: 'nova', color: 0x9be870, size: 48, speed: 1 },
      cast(ctx) {
        if (!ctx.target) return;
        applyAuraDot(ctx, ctx.target, {
          name: 'Acid Veil',
          duration: 3,
          radius: R(3),
          damageSpec: '1d3',
          type: 'corrosive',
          damageClass: 'physical',
        });
        applyInvisibility(ctx, ctx.caster, { duration: 2, mode: 'partial' });
      },
    },
  },
});

