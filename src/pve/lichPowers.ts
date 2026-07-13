// Lich powers — the boss combines its three death-words exactly like a player
// caster combines theirs, but with no dice, no mana and no difficulty class: it
// is a master of the grave and always succeeds. Its words are Drain, Curse and
// Void; every combination is its own spell (see LICH_SPELLS below). Charges are
// tracked per *word* by the Lich's AI (Drain ×4, Curse ×2, Void ×1), and casting
// a combo spends one charge of each word it uses — so Void, the god-word, fuels
// exactly one cataclysm per fight.
//
// These are ordinary `Spell` objects so the scene resolves them through the
// normal stack, but the AI casts them "for free" and, with no `dc`, they never
// fizzle. `Spell.words` is left empty on purpose (the runtime word system has no
// 'void' word); the word composition lives in `LichSpell.words` instead.

import type { Spell } from '../spells/Spell';
import type { EffectContext } from '../effects/effects';
import type { Mage } from '../core/Mage';
import { dmg } from '../core/Damage';
import {
  dealDamage,
  drainDamage,
  applyDebuff,
  applyDot,
  placeTotem,
  rollDice,
  heal,
} from '../effects/effects';
import { RANGE_UNIT } from '../config/constants';

/** How far the Lich can reach with its powers (very long — it rarely must move). */
const LICH_POWER_RANGE = 20 * RANGE_UNIT;

export type LichWord = 'drain' | 'curse' | 'void';

/**
 * The Lich's Curse, cast identically to the player word: a lingering hex that
 * ticks 1d3 shadow at the start of each of the victim's next 4 turns. Shared by
 * the single Curse and by Annihilation.
 */
function lichCurseDot(ctx: EffectContext, target: Mage | null = ctx.target): void {
  if (!target) return;
  applyDot(ctx, target, {
    name: 'Curse',
    duration: 4,
    damage: dmg(2, 'shadow', 'physical'),
    damageSpec: '1d3',
  });
}

// -----------------------------------------------------------------------------
//  SINGLE WORDS  (Drain / Curse mirror the player word system exactly)
// -----------------------------------------------------------------------------

/** Drain — the player word: 1d6 corrosive with 100% lifesteal. */
const LICH_DRAIN: Spell = {
  id: 'lich:drain',
  name: 'Drain',
  words: [],
  actionType: 'main',
  range: LICH_POWER_RANGE,
  targeting: 'enemy',
  description: 'A siphon: 1d6 corrosive damage that heals the Lich for the full amount dealt.',
  visual: { preset: 'projectile', color: 0x57d6a0, size: 10, speed: 1.5 },
  cast(ctx) {
    if (!ctx.target) return;
    drainDamage(ctx, ctx.target, dmg(rollDice(ctx, '1d6', 'Drain'), 'corrosive', 'physical'));
  },
};

/** Curse — the player word: a 1d3 shadow damage-over-time for 4 turns. */
const LICH_CURSE: Spell = {
  id: 'lich:curse',
  name: 'Curse',
  words: [],
  actionType: 'main',
  range: LICH_POWER_RANGE,
  targeting: 'enemy',
  description: "A withering hex: 1d3 damage at the start of each of the target's next 4 turns.",
  visual: { preset: 'beam', color: 0xff9f6b, size: 5, speed: 1 },
  cast(ctx) {
    lichCurseDot(ctx);
  },
};

/**
 * Void: the god-word — but a mortal-tamed one. A rip in reality that unmakes the
 * target: unstoppable damage to body AND mind that ignores armour, resistance and
 * wards alike. The Lich has but one Void per fight, so it lands like a verdict.
 */
const LICH_VOID: Spell = {
  id: 'lich:void',
  name: 'Void',
  words: [],
  actionType: 'main',
  range: LICH_POWER_RANGE,
  targeting: 'enemy',
  description:
    'Erasure. Unstoppable damage to body and mind that ignores all defences.',
  visual: { preset: 'burst', color: 0x1a0b2e, size: 18, speed: 1.2 },
  cast(ctx) {
    if (!ctx.target) return;
    dealDamage(ctx, ctx.target, dmg(5, 'shadow', 'physical'), { canMiss: false, trueDamage: true });
    dealDamage(ctx, ctx.target, dmg(3, 'shadow', 'sanity'), { canMiss: false, trueDamage: true });
  },
};

// -----------------------------------------------------------------------------
//  TWO-WORD COMBOS
// -----------------------------------------------------------------------------

/**
 * Drain + Curse — the player combo: a leeching totem. Its 3-range aura ticks 1d3
 * corrosive on enemies each turn and heals the Lich for the damage dealt. Dropped
 * on the target's position.
 */
const LICH_DRAIN_CURSE: Spell = {
  id: 'lich:drain+curse',
  name: 'Drain Curse',
  words: [],
  actionType: 'main',
  range: LICH_POWER_RANGE,
  targeting: 'enemy',
  description: 'A leeching totem: its aura rots nearby foes for 1d3 corrosive each turn and heals the Lich.',
  visual: { preset: 'burst', color: 0x57d6a0, size: 50, speed: 1 },
  noCastSprite: true,
  cast(ctx) {
    if (!ctx.target) return;
    placeTotem(ctx, ctx.target.pos, { radius: 3 * RANGE_UNIT, damageSpec: '1d3', slow: 0, lifesteal: true });
  },
};

/**
 * Drain + Void — Oblivion Siphon: Void, but harder-hitting and with 100%
 * lifesteal. Greater unstoppable damage that restores the Lich for the full
 * amount torn from the body, plus a mind-rend.
 */
const LICH_DRAIN_VOID: Spell = {
  id: 'lich:drain+void',
  name: 'Oblivion Siphon',
  words: [],
  actionType: 'main',
  range: LICH_POWER_RANGE,
  targeting: 'enemy',
  description:
    'Void-fed hunger: greater unstoppable damage that heals the Lich for everything it devours, and rends the mind besides.',
  visual: { preset: 'beam', color: 0x2a0f4a, size: 12, speed: 1.1 },
  cast(ctx) {
    if (!ctx.target) return;
    // Void, but bigger — and every point torn from the body heals the Lich.
    const dealt = dealDamage(ctx, ctx.target, dmg(8, 'shadow', 'physical'), {
      canMiss: false,
      trueDamage: true,
    });
    if (dealt > 0 && ctx.caster.alive) heal(ctx, ctx.caster, dealt);
    dealDamage(ctx, ctx.target, dmg(4, 'shadow', 'sanity'), { canMiss: false, trueDamage: true });
  },
};

/**
 * Curse + Void — Doom: a dot/debuff sentence whose *total* far outstrips a single
 * Void, but paid out over time. The victim is cracked wide open (+5 damage taken)
 * and set to unravel under an unstoppable 3d6 decay for three turns (~31 vs Void's
 * ~16 burst) — no defence stops it.
 */
const LICH_CURSE_VOID: Spell = {
  id: 'lich:curse+void',
  name: 'Doom',
  words: [],
  actionType: 'main',
  range: LICH_POWER_RANGE,
  targeting: 'enemy',
  description:
    'A death-sentence over time: the target is cracked open (+5 damage taken) and unravels for 3d3 unstoppable damage each turn for 3 turns.',
  visual: { preset: 'conjure', color: 0x3a0b3e, size: 14, speed: 1.1 },
  cast(ctx) {
    if (!ctx.target) return;
    applyDebuff(ctx, ctx.target, {
      name: 'Doomed',
      key: 'debuff:void-curse',
      duration: 4,
      mods: { damageTaken: 5, damageDealt: -2 },
    });
    applyDot(ctx, ctx.target, {
      name: 'Unraveling',
      key: 'dot:unraveling',
      duration: 3,
      damage: dmg(5, 'shadow', 'physical'),
      damageSpec: '3d3',
    });
  },
};

// -----------------------------------------------------------------------------
//  THREE-WORD ULTIMATE
// -----------------------------------------------------------------------------

/**
 * Drain + Curse + Void — Annihilation: the Lich's masterwork. Every living foe
 * is scoured by unstoppable body-and-mind damage, has the life torn from it fed
 * straight back to the Lich, and is doomed (+5 taken) and cursed to unravel. A
 * board-wide apocalypse far beyond any single mortal word.
 */
const LICH_ANNIHILATION: Spell = {
  id: 'lich:drain+curse+void',
  name: 'Annihilation',
  words: [],
  actionType: 'main',
  range: LICH_POWER_RANGE,
  targeting: 'enemy',
  description:
    'The grave opens wide: every living foe suffers unstoppable ruin, is doomed and cursed, and feeds the Lich.',
  visual: { preset: 'burst', color: 0x120024, size: 26, speed: 1.3 },
  cast(ctx) {
    const foes = ctx.game.livingEnemiesOf(ctx.caster);
    let leech = 0;
    for (const foe of foes) {
      leech += dealDamage(ctx, foe, dmg(7, 'shadow', 'physical'), {
        canMiss: false,
        aoe: true,
        trueDamage: true,
      });
      dealDamage(ctx, foe, dmg(4, 'shadow', 'sanity'), { canMiss: false, aoe: true, trueDamage: true });
      applyDebuff(ctx, foe, {
        name: 'Doomed',
        key: 'debuff:void-curse',
        duration: 4,
        mods: { damageTaken: 5, damageDealt: -2 },
      });
      lichCurseDot(ctx, foe);
    }
    // Every point torn from the foes' bodies feeds the Lich.
    if (leech > 0 && ctx.caster.alive) heal(ctx, ctx.caster, leech);
  },
};

export interface LichSpell {
  id: string;
  /** The death-words composing this cast; one charge of each is spent. */
  words: LichWord[];
  spell: Spell;
}

/**
 * The full combination lattice of the Lich's words, ordered strongest-first so
 * the AI can scan for its best affordable option. Void-bearing entries are the
 * god-tier plays and, with a single Void charge, only one can ever be cast.
 */
export const LICH_SPELLS: LichSpell[] = [
  { id: 'annihilation', words: ['drain', 'curse', 'void'], spell: LICH_ANNIHILATION },
  { id: 'oblivion-siphon', words: ['drain', 'void'], spell: LICH_DRAIN_VOID },
  { id: 'doom', words: ['curse', 'void'], spell: LICH_CURSE_VOID },
  { id: 'void', words: ['void'], spell: LICH_VOID },
  { id: 'drain-curse', words: ['drain', 'curse'], spell: LICH_DRAIN_CURSE },
  { id: 'drain', words: ['drain'], spell: LICH_DRAIN },
  { id: 'curse', words: ['curse'], spell: LICH_CURSE },
];

/** The Lich's power reach, so callers can range-check without a spell handle. */
export const LICH_SPELL_RANGE = LICH_POWER_RANGE;

/** Starting per-combat, per-word charge counts for a freshly spawned Lich. */
export function freshLichCharges(): Record<LichWord, number> {
  return { drain: 4, curse: 2, void: 1 };
}
