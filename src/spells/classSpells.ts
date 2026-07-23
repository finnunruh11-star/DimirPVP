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
import { addOrExtendStatus } from '../core/Status';
import {
  makeArcherSummon,
  makeBinderSummon,
  makeCorrosionSentry,
  makeGhostSummon,
  makeNeuralLeech,
  makeThoughtLeech,
} from '../core/summons';
import {
  applyControl,
  applyDebuff,
  applyDot,
  applyInvisibility,
  applyShadowTrail,
  applyStun,
  dealDamage,
  dispelVeil,
  rollDice,
} from '../effects/effects';
import type { EffectContext } from '../effects/effects';
import { registerClassSpell, registerClassSpellVariants } from './registry';

/** Abstract range number (5 / 10 / 15) to pixels. */
const R = (units: number): number => units * RANGE_UNIT;
const HEXCRAFT_FIELD_DURATION = 8;

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
      name: 'Mind Shadow',
      actionType: 'main',
      range: 0,
      targeting: 'self',
      dc: 11,
      noCrit: true,
      noCastSprite: true,
      description:
        'Enchant your held weapon: for the rest of the fight its strikes deal ' +
        'shadow-typed "mill" (sanity) damage instead of their normal damage.',
      visual: { preset: 'conjure', color: 0x9b7bff, size: 22, speed: 1 },
      cast(ctx) {
        ctx.caster.weaponEnchant = 'mindShadow';
        ctx.log(`${ctx.caster.name}'s weapon is sheathed in mind-eating shadow.`);
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
        'and undead, but weak to light - bad in daylight.',
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
      range: 0,
      targeting: 'self',
      dc: 12,
      noCrit: true,
      description:
        'Deepen shadow across the entire battlefield for 8 rounds. Every instance of ' +
        'shadow damage or mill (sanity) damage deals 2 additional damage, regardless of source.',
      visual: { preset: 'nova', color: 0x9b7bff, size: 110, speed: 0.8 },
      cast(ctx) {
        ctx.game.addHexcraftGlobal('mindShadow', ctx.caster.team, HEXCRAFT_FIELD_DURATION);
      },
    },
  },
});

// ===========================================================================
//  TARGETED CLASS OVERRIDES
// ---------------------------------------------------------------------------
//  These mixed-grammar combinations deliberately align for one class only.
//  Other classes keep their ordinary spell, or have no spell when no ordinary
//  combination exists.
// ===========================================================================

// ---------------------------------------------------------------------------
//  CORRODE MIND · LIFE — summon a parasite that eats sanity and reactions.
// ---------------------------------------------------------------------------
registerClassSpellVariants({
  words: ['corrode', 'mind'],
  variants: {
    life: {
      name: 'Corrode Mind',
      actionType: 'main',
      range: R(6),
      targeting: 'point',
      dc: 12,
      noCrit: true,
      noCastSprite: true,
      description:
        'Raise a Neural Leech within range 6. Its bite deals 1d3 corrosive sanity ' +
        'damage and inflicts Neural Rot for 3 turns: 1 corrosive sanity damage each ' +
        'turn and no reactions while the rot remains. HP 5; obeys Command.',
      visual: { preset: 'conjure', color: 0xb7dd77, size: 24, speed: 1 },
      cast(ctx) {
        if (!ctx.targetPoint) return;
        const leech = makeNeuralLeech({
          ownerInt: ctx.caster.effectiveInt(),
          dcRoll: summonVigor(ctx),
          ownerName: ctx.caster.name,
          pos: ctx.targetPoint,
          team: ctx.caster.team,
        });
        leech.intrinsicMelee!.onHit = (hitCtx, victim) => {
          applyDot(hitCtx, victim, {
            name: 'Neural Rot',
            duration: 3,
            damage: dmg(1, 'corrosive', 'sanity'),
          });
          applyControl(hitCtx, victim, {
            name: 'Reaction Eaten',
            mode: 'expose',
            duration: 3,
          });
        };
        ctx.game.spawnSummon(leech, ctx.caster, 'neural-leech');
        ctx.log(`${ctx.caster.name} breeds ${leech.name} (HP ${leech.hp}).`);
      },
    },
  },
});

// ---------------------------------------------------------------------------
//  DRAIN MIND · LIFE — summon a thought-eater that steals charged words.
// ---------------------------------------------------------------------------
registerClassSpellVariants({
  words: ['drain', 'mind'],
  variants: {
    life: {
      name: 'Drain Mind',
      actionType: 'main',
      range: R(6),
      targeting: 'point',
      dc: 12,
      noCrit: true,
      noCastSprite: true,
      description:
        'Raise a Thought Leech within range 6. Its bite deals 1d3 sanity damage and ' +
        'drains one random charged word from the victim. If you know that word, its ' +
        'charge transfers to you; otherwise the thought is digested into 2 mana. HP 5; obeys Command.',
      visual: { preset: 'conjure', color: 0x57d6a0, size: 24, speed: 1 },
      cast(ctx) {
        if (!ctx.targetPoint) return;
        const leech = makeThoughtLeech({
          ownerInt: ctx.caster.effectiveInt(),
          dcRoll: summonVigor(ctx),
          ownerName: ctx.caster.name,
          pos: ctx.targetPoint,
          team: ctx.caster.team,
        });
        leech.intrinsicMelee!.onHit = (hitCtx, victim) => {
          const charged = victim.loadout.filter((word) => (victim.charges[word] ?? 0) > 0);
          if (charged.length === 0) {
            hitCtx.log(`${leech.name} finds no charged thought to drain.`);
            return;
          }
          const stolen = hitCtx.rng.pick(charged);
          victim.charges[stolen] = Math.max(0, (victim.charges[stolen] ?? 0) - 1);
          const owner =
            leech.summonOwnerIndex != null ? hitCtx.game.mages[leech.summonOwnerIndex] : undefined;
          if (!owner?.alive) return;
          if (owner.loadout.includes(stolen)) {
            owner.charges[stolen] = (owner.charges[stolen] ?? 0) + 1;
            hitCtx.log(`${leech.name} transfers ${stolen} from ${victim.name} to ${owner.name}.`);
          } else {
            owner.gainMana(2);
            hitCtx.log(`${leech.name} digests ${victim.name}'s ${stolen} thought into 2 mana.`);
          }
        };
        ctx.game.spawnSummon(leech, ctx.caster, 'thought-leech');
        ctx.log(`${ctx.caster.name} breeds ${leech.name} (HP ${leech.hp}).`);
      },
    },
  },
});

// ---------------------------------------------------------------------------
//  PIERCE BIND · HEXCRAFT — make every chosen destination a binding rune.
// ---------------------------------------------------------------------------
registerClassSpellVariants({
  words: ['pierce', 'bind'],
  variants: {
    hexcraft: {
      name: 'Needlepoint Domain',
      actionType: 'main',
      range: 0,
      targeting: 'self',
      dc: 12,
      noCrit: true,
      description:
        'Impose a battlefield-wide domain for 8 rounds. The first time each enemy ' +
        'repositions during a turn, its chosen destination becomes a binding rune: ' +
        'it takes 1d4 pierce damage and is rooted there for the rest of that turn.',
      visual: { preset: 'nova', color: 0x9ad8ff, size: 110, speed: 0.8 },
      cast(ctx) {
        ctx.game.addNeedlepointDomain(ctx.caster.team, HEXCRAFT_FIELD_DURATION);
      },
    },
  },
});

// ---------------------------------------------------------------------------
//  SHADOW SHATTER CURSE · OBJECTS — conjure Black Bell.
// ---------------------------------------------------------------------------
registerClassSpellVariants({
  words: ['shadow', 'shatter', 'curse'],
  variants: {
    objects: {
      name: 'Black Bell',
      actionType: 'main',
      range: 0,
      targeting: 'self',
      dc: 14,
      noCastSprite: true,
      description:
        'Conjure Black Bell into both hands. Toll strikes deal only 1 direct damage, ' +
        'then inflict 1d3 shadow damage for 6 turns (9 when the victim stands in shadow). ' +
        'Weapon Action toggles Condense: strikes clear every harmful status, roll all ' +
        'remaining DoT damage immediately as half shatter / half shadow, and create a ' +
        'normal shadow enlarged by 1 for each non-damaging debuff consumed.',
      visual: { preset: 'conjure', color: 0x7658b8, size: 34, speed: 0.8 },
      cast(ctx) {
        const caster = ctx.caster;
        for (const held of [...caster.hands]) {
          caster.hands = caster.hands.filter((item) => item !== held);
          caster.bag.push(held);
        }
        caster.hands.push('conjuredBlackBell');
        caster.blackBellCondense = false;
        ctx.log(`${caster.name} conjures Black Bell; its first toll waits inside the glass.`);
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
      range: 0,
      targeting: 'self',
      dc: 11,
      noCrit: true,
      noCastSprite: true,
      description:
        'Curse your held weapon with living acid: while you wield it you rot for 1d3 ' +
        'corrosive at the start of each turn, but every enemy it strikes begins ' +
        'corroding too (1d3 corrosive for 3 turns).',
      visual: { preset: 'conjure', color: 0x9be870, size: 22, speed: 1 },
      cast(ctx) {
        ctx.caster.weaponEnchant = 'curseCorrode';
        ctx.log(`${ctx.caster.name}'s weapon weeps corrosive acid \u2014 at a price.`);
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
        'Raise a Rot Sentry within range 5. It cannot attack, but at the start of each of ' +
        'your turns its range-3 aura deals 1d3 corrosive damage to everyone except you ' +
        'and your summons, including other allies. HP 8, move 5; obeys Command.',
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
        ctx.game.spawnSummon(sentry, ctx.caster, 'sentry');
        ctx.log(`${ctx.caster.name} raises ${sentry.name} (HP ${sentry.hp}).`);
      },
    },
    hexcraft: {
      name: 'Corrode Curse',
      actionType: 'bonus',
      range: 0,
      targeting: 'self',
      dc: 11,
      noCrit: true,
      description:
        'Impose a global curse for 8 rounds. Any unit carrying a DoT is slowed by 75% ' +
        'for the DoT\'s full duration, and each DoT tick also deals 1d3 corrosive damage.',
      visual: { preset: 'nova', color: 0x9be870, size: 110, speed: 0.8 },
      cast(ctx) {
        ctx.game.addHexcraftGlobal('curseCorrode', ctx.caster.team, HEXCRAFT_FIELD_DURATION);
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
      name: 'Veil Bind',
      actionType: 'main',
      range: R(8),
      targeting: 'any',
      dc: 10,
      noCrit: true,
      description:
        'Lay a binding mantle on a chosen mage (range 8): it grants them two uses of a ' +
        'weak Bind \u2014 a bonus action that roots the nearest enemy for 1 turn.',
      visual: { preset: 'nova', color: 0x8ad1ff, size: 60, speed: 1.1 },
      cast(ctx) {
        const who = ctx.target ?? ctx.caster;
        who.bindMantleCharges += 2;
        ctx.log(`${who.name} is wrapped in a binding mantle (2 weak Binds).`);
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
      range: R(15),
      targeting: 'point',
      dc: 11,
      noCrit: true,
      aoe: { kind: 'circle', radius: R(5) },
      noCastSprite: true,
      reaction: true,
      description:
        'Place a range-5 linking circle within range 15 for 8 rounds. Inside it, gaining ' +
        'a veil also roots the bearer, while being rooted or bound grants a half veil ' +
        'for the same duration. Can be cast as a reaction.',
      visual: { preset: 'burst', color: 0x8ad1ff, size: 100, speed: 1.1 },
      cast(ctx) {
        if (!ctx.targetPoint) return;
        ctx.game.addVeilBindZone(ctx.targetPoint, ctx.caster.team, HEXCRAFT_FIELD_DURATION);
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
      range: R(10),
      targeting: 'enemy',
      dc: 12,
      noCrit: true,
      description:
        "Shackle one of an enemy's items (range 10): it can no longer be unequipped, and " +
        'all of its damage and stats are halved (kept half rounds up in the holder\u2019s favour).',
      visual: { preset: 'projectile', color: 0x6a7bd0, size: 11, speed: 1.4 },
      cast(ctx) {
        const t = ctx.target;
        if (!t) return;
        const id = t.activeWeaponId() ?? t.hands[0] ?? t.equippedItems()[0];
        if (!id) {
          ctx.log(`${t.name} has nothing to shackle.`);
          return;
        }
        t.sabotagedItems.add(id);
        ctx.log(`${ctx.caster.name} shackles ${t.name}'s gear \u2014 it is stuck and weakened.`);
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
        'Curse one enemy with a range-3 binding aura for 8 turns. At each of its turn ' +
        'starts, nearby enemies are bound for 1 round; if anyone is caught, the cursed ' +
        'bearer is bound too. Each enemy can be caught by this aura at most twice.',
      visual: { preset: 'nova', color: 0x6a7bd0, size: 60, speed: 1 },
      cast(ctx) {
        if (!ctx.target) return;
        addOrExtendStatus(ctx.target.statuses, {
          key: `hexcraft:bind-curse:${ctx.game.mages.indexOf(ctx.caster)}`,
          name: 'Bind Curse',
          kind: 'bindCurseAura',
          duration: HEXCRAFT_FIELD_DURATION,
          radius: R(3),
          ownerIndex: ctx.game.mages.indexOf(ctx.caster),
          boundCounts: {},
        }, false);
        ctx.log(`${ctx.target.name} bears a binding aura for 8 turns.`);
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
      range: 0,
      targeting: 'self',
      dc: 13,
      noCrit: true,
      noCastSprite: true,
      description:
        'Conjure a two-handed Veil Bow into your hands (replacing what you held) and slip ' +
        'into a half veil. While held it re-cloaks you each turn; firing costs 2 mana, ' +
        'reveals you for that turn, deals Dex-scaled corrosive damage and mires the mark ' +
        '(2 turns). It lasts until unsummoned or 3 combats; unequipping it erases it.',
      visual: { preset: 'conjure', color: 0x9be870, size: 26, speed: 1 },
      cast(ctx) {
        const c = ctx.caster;
        // Free the hands into the bag, then conjure the bow.
        for (const held of [...c.hands]) {
          c.hands = c.hands.filter((h) => h !== held);
          c.bag.push(held);
        }
        c.hands.push('conjuredVeilBow');
        c.conjuredBowCombatsLeft = 3;
        c.conjuredBowFiredThisTurn = false;
        applyInvisibility(ctx, c, { duration: 1, mode: 'partial' });
        ctx.log(`${c.name} conjures a Veil Bow and fades from sight.`);
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
      targeting: 'any',
      requiresInvisibleTarget: true,
      dc: 13,
      noCrit: true,
      description:
        'Arm an invisible unit within range 10 without revealing the caster. Its next ' +
        'attack consumes its remaining stealth and, on a hit, deals an extra corrosive ' +
        'and piercing die whose size equals the lost duration, capped at 1d7.',
      visual: { preset: 'conjure', color: 0x9be870, size: 34, speed: 1 },
      cast(ctx) {
        if (!ctx.target) return;
        ctx.game.armVeilCorrodePierce(ctx.target);
      },
    },
  },
});

