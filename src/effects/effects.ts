// =============================================================================
//  SPELL EFFECT INFRASTRUCTURE
// -----------------------------------------------------------------------------
//  These are the building blocks you use to author spells. Every function takes
//  an EffectContext (who is casting, on whom, with what dice / log) plus a small
//  options object. Compose them inside a Spell's `cast()` to make new spells.
//
//  To add a brand-new kind of effect, just add another exported function here
//  and call it from your spells — nothing else needs to change.
// =============================================================================

import type { DamageInstance, DamageClass, DamageType } from '../core/Damage';
import type { Dice } from '../core/Dice';
import type { GameState } from '../core/GameState';
import type { Mage } from '../core/Mage';
import type { MageClass } from '../core/Classes';
import { getItem } from '../core/Items';
import {
  addOrExtendStatus,
  type ControlMode,
  type DotStatus,
  type InvisMode,
  type OrderJudgmentStatus,
  type StunType,
} from '../core/Status';
import { dist, stepTowards, type Vec2 } from '../core/utils';
import { FIELD, RANGE_UNIT, SCARAB, VEIL } from '../config/constants';
import { Dev } from '../config/dev';

/**
 * The "base" physical damage types a physically-immune (incorporeal) creature
 * ignores. Elemental/exotic physical-class damage (shadow, corrosive, fire,
 * ...) still lands — immunity is to plain blows only, not all health hits.
 */
const BASE_PHYSICAL_TYPES = new Set<DamageType>(['pierce', 'shatter', 'slashing', 'generic']);

export type CombatFeedbackKind =
  | 'damage'
  | 'sanityDamage'
  | 'heal'
  | 'sanityHeal'
  | 'immune'
  | 'miss'
  | 'blocked';

export interface CombatFeedback {
  kind: CombatFeedbackKind;
  amount?: number;
  damageType?: DamageType;
  label?: string;
  critical?: boolean;
  /** Who dealt this, so presentation can voice enemy blows differently. */
  source?: Mage;
}

/**
 * Optional bridge the scene supplies so effects can request visuals. Pure logic
 * still works without it (e.g. in tests), so every call is guarded with `?.`.
 */
export interface VfxSink {
  /** Show a dice-rolling animation for a roll that has already been computed. */
  diceRoll(spec: string, total: number, rolls: number[], label?: string, target?: Mage): void;
  /** Play the "took damage" recoil on a mage. */
  hit?(mage: Mage): void;
  /** Animate a gradual dash for `mover`, which has just jumped from `from`. */
  dash?(mover: Mage, from: Vec2): void;
  /** Phase a body out at `from` and back in at `to` (teleports and blinks). */
  blink?(from: Vec2, to: Vec2, color: number): void;
  /** Sweep a blade arc centred at `at`, aimed along `angle`, spanning `size` px. */
  slash?(at: Vec2, angle: number, size: number): void;
  /** Glide one logically-repositioned unit inward and resolve when it arrives. */
  pull?(mover: Mage, from: Vec2, to: Vec2): Promise<void>;
  /** Animate a lightning arc between two points and resolve after one loop. */
  lightningBolt?(from: Vec2, to: Vec2): Promise<void>;
  /** Play a one-shot hit-effect overlay on `mage`. */
  spellEffect?(mage: Mage, kind: 'generic' | 'corrosive' | 'vanish'): void;
  /** Pull a stream of life particles from `from` into `to`. */
  drainParticles?(from: Vec2, to: Vec2): void;
  /** Throw one curved, spinning shard leg and resolve when it reaches `to`. */
  boomerang?(from: Vec2, to: Vec2, color: number, size: number, speed: number): Promise<void>;
  /** Puff smoke at one newly created minion. */
  summonPuff?(at: Vec2, size: number): void;
  /** Stamp a decree mark at a point — the visual signature of the Order word. */
  sigil?(at: Vec2, color: number, size: number): void;
  /** Show one outcome-aware floating combat readout over `mage`. */
  combatFeedback?(mage: Mage, feedback: CombatFeedback): void;
  /** Play a compact shatter-sheet burst at an exact impact point. */
  shatterBurst?(at: Vec2, size: number): void;
  /**
   * Paint the shatter cone stretched to fill a reality wedge: apex at `apex`,
   * opening toward `angle`, half-arc `halfAngle`, length `range` (px).
   */
  wedge?(apex: Vec2, angle: number, halfAngle: number, range: number): void;
  /** Draw or replace the animated trail for Lightning Fire Pierce. */
  lightningTrail?(segments: readonly { from: Vec2; to: Vec2 }[]): void;
  /** Rip a bolt along one dash path; resolves as the mover lands. */
  lightningDash?(from: Vec2, to: Vec2, color: number): Promise<void>;
  /** Punch a lightning impact through a body the trail has caught. */
  lightningImpact?(at: Vec2, color: number): void;
  /** Blast the point where the caster slammed into their own trail. */
  lightningCrash?(at: Vec2, color: number): Promise<void>;
  /** Clear the temporary Lightning Fire Pierce trail. */
  clearLightningTrail?(): void;
  /** Cue a logical full-field quarter-turn without owning any movement state. */
  quarterTurn?(clockwise: boolean): void;
  /** Report a large detonation at `at` so the scene can voice it. */
  boom?(at: Vec2): void;
  /** Report a peal of lightning big enough to warrant a thunderclap. */
  thunder?(at: Vec2): void;
  /** Pulse the active Twist Rune and show its orbit direction. */
  twistRune?(pivot: Vec2, radius: number, clockwise: boolean): void;
}

/** Options for an interactive point sub-target requested mid-resolution. */
export interface SubTargetPointOpts {
  /** Maximum distance (px) from `origin` the point may be. */
  maxRange: number;
  /** Minimum distance (px) from `origin` the point must be. */
  minRange?: number;
  /** Origin the range is measured from (defaults to the caster). */
  origin?: Vec2;
  /** Hint shown to the player while picking. */
  prompt?: string;
}

/** Options for an interactive enemy sub-target requested mid-resolution. */
export interface SubTargetEnemyOpts {
  /** Maximum distance (px) from `origin` the enemy may be. */
  range: number;
  /** Origin the range is measured from (defaults to the caster). */
  origin?: Vec2;
  /** Hint shown to the player while picking. */
  prompt?: string;
}

/** Options for a mandatory mid-resolution pick from an explicit combatant set. */
export interface SubTargetCombatantOpts {
  /** The combatants that may be picked; allies and the source are allowed. */
  candidates: readonly Mage[];
  /** Maximum distance (px) from `origin` the combatant may be. */
  range: number;
  /** Origin the range is measured from (defaults to the caster). */
  origin?: Vec2;
  /** Hint shown to the player while picking. */
  prompt?: string;
}

/**
 * Optional bridge the scene supplies so a spell can ask for *additional* targets
 * while it resolves (e.g. "now pick a point, then an enemy"). Because these run
 * during resolution — after the single reaction window for the spell has already
 * passed — repeated sub-targeting never grants the opponent another reaction.
 * Returns null if the player cancels or no legal target exists.
 */
export interface SubTargeter {
  requestPoint(source: Mage, opts: SubTargetPointOpts): Promise<Vec2 | null>;
  requestEnemy(source: Mage, opts: SubTargetEnemyOpts): Promise<Mage | null>;
  requestCombatant(source: Mage, opts: SubTargetCombatantOpts): Promise<Mage | null>;
  /**
   * Open a reaction window mid-resolution so opponents may spend their reaction
   * in response to the current step (e.g. one blink of a multi-step flurry).
   */
  reactionWindow(source: Mage, label: string, at?: Vec2): Promise<void>;
  /**
   * Flush any pending dice rolls and queued hit animations right now, so a
   * multi-step spell can show a strike land before rolling its next step.
   */
  resolveImpacts(): Promise<void>;
}

export interface EffectContext {
  game: GameState;
  caster: Mage;
  /** The chosen target mage, if the spell is targeted at a mage. */
  target: Mage | null;
  /** The chosen point, if the spell targets a location. */
  targetPoint: Vec2 | null;
  /** A second chosen point (two-point spells like Reality Shatter). */
  targetPoint2?: Vec2 | null;
  rng: Dice;
  log: (msg: string) => void;
  /** Visual feedback bridge (provided by the scene; absent in headless logic). */
  vfx?: VfxSink | null;
  /**
   * True when this cast rolled a natural 20 on its success check — a critical.
   * Direct damage is doubled (see {@link dealDamage}); totems, zones and other
   * duration/area effects double their radius / duration instead (see
   * {@link critScale}). Absent for effects that never roll (movement, ticks).
   */
  crit?: boolean;
  /** Kept natural d20 from this spell's success check, before stat modifiers. */
  spellRoll?: number;
  /**
   * Ask the player (or AI) to pick an extra point mid-resolution. Absent in
   * headless logic, so always call it as `await ctx.requestPoint?.(...)`.
   */
  requestPoint?(opts: SubTargetPointOpts): Promise<Vec2 | null>;
  /**
   * Ask the player (or AI) to pick an extra enemy mid-resolution. Absent in
   * headless logic, so always call it as `await ctx.requestEnemy?.(...)`.
   */
  requestEnemy?(opts: SubTargetEnemyOpts): Promise<Mage | null>;
  /**
   * Open a reaction window mid-resolution so opponents may respond to the
   * current step. Absent in headless logic — call as `await ctx.reactionWindow?.(...)`.
   */
  reactionWindow?(label: string, at?: Vec2): Promise<void>;
  /**
   * Play the pending dice and queued hit animations now (mid-cast), so a strike
   * is shown before the next step rolls. Call as `await ctx.resolveImpacts?.()`.
   */
  resolveImpacts?(): Promise<void>;
}

// -----------------------------------------------------------------------------
//  DICE
// -----------------------------------------------------------------------------

/**
 * Double a duration / radius / range on a critical cast (natural-20 success),
 * otherwise return it unchanged. Damage doubling is handled directly in
 * {@link dealDamage}; this covers totems, zones, damage-over-time, control and
 * any other effect whose potency is measured in cycles or pixels.
 */
export function critScale(ctx: EffectContext, value: number): number {
  const scaled = ctx.crit ? value * 2 : value;
  return castPotencyScale(ctx, scaled);
}

/** Apply the resolving cast's modifier potency, rounding up as Subtle requires. */
export function castPotencyScale(ctx: EffectContext, value: number): number {
  const potency = ctx.game.castPotency;
  return potency === 1 ? value : Math.ceil(value * potency);
}

/**
 * Duration of an affliction (debuff / DoT / stun / control) landing on `target`,
 * after crit + modifier scaling and the target's own debuff resistance. Warded
 * gear can shorten an affliction but never erase it: the floor is one cycle.
 */
export function afflictDuration(ctx: EffectContext, target: Mage, value: number): number {
  const scaled = critScale(ctx, value);
  const resisted = target.debuffDurationMult();
  if (resisted === 1 || !Number.isFinite(scaled)) return scaled;
  return Math.max(1, Math.round(scaled * resisted));
}

/**
 * CLASS-SPELL DISPATCH. Pick the effect variant that matches the caster's class
 * (Objects / Life / Hexcraft). "Class spells" — word combos of only nouns or
 * only verbs (see {@link isClassSpell}) — resolve their effect toward the
 * caster's class, so their `cast` bodies branch through this helper:
 *
 *   cast(ctx) {
 *     byClass(ctx, {
 *       objects:  (c) => summonWeapon(c),
 *       life:     (c) => summonScarabs(c, c.targetPoint),
 *       hexcraft: (c) => placeField(c),
 *     });
 *   }
 *
 * No new spells are wired yet; this is the seam future class spells plug into.
 */
export function byClass<T>(
  ctx: EffectContext,
  variants: Record<MageClass, (ctx: EffectContext) => T>
): T {
  return variants[ctx.caster.mageClass](ctx);
}

/**
 * Roll dice from a spec string ("2d6+1", "d20", "3d8"). Logs the result and
 * returns the total. Use this for variable damage, chances, etc.
 *
 * `victim` puts the roll's tray over one body. Leave it off and the scene
 * infers the body from whatever this roll goes on to damage, which is right for
 * ordinary spells; pass it when the roll belongs to somebody the roll does not
 * damage (an accuracy check on the caster) or when rolling inside a per-target
 * loop, where the inference would otherwise lump the rolls together.
 */
export function rollDice(
  ctx: EffectContext,
  spec: string,
  reason?: string,
  victim?: Mage | null,
): number {
  const r = ctx.rng.roll(spec);
  const detail = r.rolls.length
    ? ` [${r.rolls.join(', ')}${r.modifier ? (r.modifier > 0 ? `+${r.modifier}` : r.modifier) : ''}]`
    : '';
  ctx.log(`${ctx.caster.name} rolls ${spec}${reason ? ` for ${reason}` : ''}: ${r.total}${detail}`);
  ctx.vfx?.diceRoll(spec, r.total, r.rolls, reason, victim ?? undefined);
  return r.total;
}

// -----------------------------------------------------------------------------
//  DAMAGE
// -----------------------------------------------------------------------------

/**
 * Deal damage to a target. Honours the target's veil (a distance-based dodge
 * for targeted attacks; area attacks always land) and any damageDealt /
 * damageTaken debuffs. A landed hit may also tear a veil away — both the
 * victim's (struck) and the attacker's (revealed by striking).
 * Set opts.canMiss = false for guaranteed effects (e.g. damage-over-time ticks).
 * Set opts.aoe = true for area effects that bypass the dodge entirely.
 */
export interface DealDamageOptions {
  canMiss?: boolean;
  aoe?: boolean;
  ignoreResist?: boolean;
  ignoreArmor?: boolean;
  trueDamage?: boolean;
  /** Suppress the automatic spell hit-effect overlay (basic attacks, DoT ticks). */
  noImpactFx?: boolean;
  /** Caption for the floating number, e.g. the name of the DoT that ticked. */
  cause?: string;
}

export function dealDamage(
  ctx: EffectContext,
  target: Mage,
  damage: DamageInstance,
  opts: DealDamageOptions = {}
): number {
  const targetWasAlive = target.alive;
  ctx.game.triggerOniAmbush(ctx.caster, target);
  const canMiss = opts.canMiss !== false;
  const isAoe = !!opts.aoe;
  const isTrue = !!opts.trueDamage;
  // An armed veil is consumed by beginning an attack, even if the attack later
  // misses or is prevented. Bonus damage is released only after a landed hit.
  const veilCorrodePiercePower = canMiss
    ? ctx.game.prepareVeilCorrodePierce(ctx.caster)
    : 0;

  // Second Ring of Lareneg / phased into the dark: nothing hostile reaches them.
  if (ctx.game.isUnreachable(target)) {
    ctx.vfx?.combatFeedback?.(target, { kind: 'immune', label: 'UNTOUCHABLE' });
    return 0;
  }

  // Eldritch Truth: while shrouded, the wielder voids all incoming damage until
  // their next turn.
  if (target.eldritchDefend) {
    ctx.log(`${target.name} is immune to all damage (Eldritch).`);
    ctx.vfx?.combatFeedback?.(target, { kind: 'blocked', label: 'VOIDED' });
    return 0;
  }

  // Swamprun creature class-immunities. Mindless things ignore mental (sanity)
  // damage; incorporeal things ignore physical damage except radiant 'light'.
  if (target.sanityImmune && damage.damageClass === 'sanity') {
    ctx.log(`${target.name} is immune to sanity damage.`);
    ctx.vfx?.combatFeedback?.(target, { kind: 'immune', label: 'MINDLESS' });
    return 0;
  }
  if (target.physicalImmune && BASE_PHYSICAL_TYPES.has(damage.type)) {
    ctx.log(`${target.name} is immune to physical damage.`);
    ctx.vfx?.combatFeedback?.(target, {
      kind: 'immune',
      damageType: damage.type,
      label: 'INCORPOREAL',
    });
    return 0;
  }

  // Veil dodge: only targeted (non-area) attacks can be slipped. Area effects
  // always connect. True damage never misses.
  if (canMiss && !isAoe && !isTrue && !Dev.autoSuccess) {
    const inv = ctx.game.effectiveInvisibility(target);
    if (inv) {
      const units = dist(ctx.caster.pos, target.pos) / RANGE_UNIT;
      const dodge = veilDodgeChance(inv.mode, units);
      if (dodge >= 1 || ctx.rng.chance(dodge)) {
        ctx.log(`${target.name} dodges the attack.`);
        ctx.vfx?.combatFeedback?.(target, { kind: 'miss', label: 'DODGED' });
        return 0;
      }
    }
    // Standing inside a concealing hazard is its own miss chance.
    const hazardDodge = ctx.game.hazardDodgeChance(target);
    if (hazardDodge > 0 && ctx.rng.chance(hazardDodge)) {
      ctx.log(`${target.name} is lost in the haze and the attack misses.`);
      ctx.vfx?.combatFeedback?.(target, { kind: 'miss', label: 'DODGED' });
      return 0;
    }
  }

  // A Mind Dodge ward absorbs the next instance of sanity damage.
  if (damage.damageClass === 'sanity' && target.consumeWard('mind')) {
    ctx.log(`${target.name}'s Mind Dodge negates the sanity damage.`);
    ctx.vfx?.combatFeedback?.(target, { kind: 'blocked', label: 'MIND WARD' });
    return 0;
  }

  // A critical cast (natural-20 success) doubles the raw damage of this hit.
  let amount =
    castPotencyScale(ctx, ctx.crit ? damage.amount * 2 : damage.amount) +
    ctx.caster.modifier('damageDealt') +
    target.modifier('damageTaken') -
    ctx.game.swornRepetitionStacks(ctx.caster) +
    ctx.game.swornRepetitionStacks(target);
  const mandate = ctx.game.orderMandate(ctx.caster);
  if (mandate && amount > 0) amount = Math.round(amount * mandate.potency);
  let feedbackLabel: string | undefined;

  const globalHexcraftBonus = ctx.game.hexcraftDamageBonus(damage.type, damage.damageClass);
  if (globalHexcraftBonus > 0) {
    amount += globalHexcraftBonus;
    ctx.log(`Mind Shadow deepens the attack (+${globalHexcraftBonus}).`);
  }

  amount = Math.max(0, Math.round(amount));
  // Worn armour soaks physical / magical blows (flat reduction), unless this
  // strike is fully armour-penetrating (Greatshield sword form).
  if (!opts.ignoreArmor && !isTrue) {
    const beforeArmor = amount;
    amount = target.reduceIncoming(amount, damage.type, damage.damageClass);
    if (amount < beforeArmor) feedbackLabel = amount > 0 ? 'ARMOUR' : 'ARMOURED';
  }

  // Damage-type resistances / immunities / weaknesses (multiplicative), unless
  // this strike is set to ignore them (e.g. Bastion sword form).
  if (amount > 0 && !opts.ignoreResist && !isTrue) {
    const mult = target.resistMultiplier(damage.type);
    if (mult !== 1) {
      const before = amount;
      amount = Math.floor(amount * mult);
      if (mult === 0) {
        ctx.log(`${target.name} is immune to ${damage.type}.`);
        feedbackLabel = 'IMMUNE';
      } else if (mult < 1) {
        ctx.log(`${target.name} resists ${damage.type} (${before} → ${amount}).`);
        feedbackLabel = 'RESISTED';
      } else {
        ctx.log(`${target.name} is vulnerable to ${damage.type} (${before} → ${amount})!`);
        feedbackLabel = 'VULNERABLE';
      }
    }
  }

  // An Aluminium Hat shrugs off any minor psychic jab below its threshold.
  if (damage.damageClass === 'sanity' && amount > 0 && amount < target.sanityWardBelow()) {
    ctx.log(`${target.name}'s Aluminium Hat negates the sanity damage.`);
    amount = 0;
    feedbackLabel = 'FOIL WARD';
  }

  // A shield raised as a reaction blunts the next physical blow (one-shot).
  if (amount > 0 && damage.damageClass === 'physical' && target.blockPending && !isTrue) {
    const block = target.blockReduction();
    target.blockPending = false;
    if (block > 0) {
      const before = amount;
      amount = Math.floor(amount * (1 - block));
      ctx.log(`${target.name} blocks with a shield (${before} → ${amount}).`);
      feedbackLabel = 'BLOCKED';
    }
  }

  // A Reaper takes at most `damageCapPerSource` from any single entity per round
  // cycle (its DoTs never land — it is debuff-immune — so only direct hits count).
  if (target.damageCapPerSource > 0 && amount > 0) {
    const used = target.damageBySourceThisCycle.get(ctx.caster) ?? 0;
    const allowed = Math.max(0, target.damageCapPerSource - used);
    if (amount > allowed) {
      ctx.log(
        `${target.name} shrugs off the excess — only ${allowed} of ${ctx.caster.name}'s damage lands this cycle.`
      );
      amount = allowed;
      feedbackLabel = 'CAPPED';
    }
    target.damageBySourceThisCycle.set(ctx.caster, used + amount);
  }

  if (
    amount > 0 &&
    (damage.type === 'light' || damage.type === 'heat') &&
    ctx.game.defeatPftlhbByIllumination(target, ctx.caster)
  ) {
    return 0;
  }

  if (amount <= 0) {
    ctx.vfx?.combatFeedback?.(target, {
      kind: feedbackLabel === 'IMMUNE' ? 'immune' : 'blocked',
      damageType: damage.type,
      label: feedbackLabel ?? 'NEGATED',
    });
  }

  const floorVital = target.unkillable ? 1 : 0;
  if (damage.damageClass === 'sanity') {
    target.sanity = Math.max(floorVital, target.sanity - amount);
  } else {
    target.hp = Math.max(floorVital, target.hp - amount);
  }
  ctx.log(
    `${target.name} takes ${amount} ${damage.type} ${damage.damageClass} damage.`
  );
  if (amount > 0) {
    ctx.vfx?.combatFeedback?.(target, {
      kind: damage.damageClass === 'sanity' ? 'sanityDamage' : 'damage',
      amount,
      damageType: damage.type,
      label: feedbackLabel ?? opts.cause,
      critical: !!ctx.crit,
      source: ctx.caster,
    });
  }

  if (amount > 0 && ctx.caster.deathknightKind && ctx.caster.alive) {
    const before = ctx.caster.hp;
    ctx.caster.hp = Math.min(ctx.caster.maxHp, ctx.caster.hp + amount);
    const healed = ctx.caster.hp - before;
    if (healed > 0) {
      ctx.log(`${ctx.caster.name} drains ${healed} health.`);
      ctx.vfx?.combatFeedback?.(ctx.caster, { kind: 'heal', amount: healed, label: 'LIFESTEAL' });
    }
  }

  if (
    amount > 0 &&
    ctx.caster !== target &&
    ctx.caster.hasDeathsAngelWings() &&
    target.alive &&
    !target.unkillable &&
    target.hp <= Math.ceil(target.maxHp * 0.06)
  ) {
    target.hp = 0;
    ctx.log(`${ctx.caster.name}'s Wings execute ${target.name}.`);
  }

  // Lich "Link": HP damage dealt to a linked victim is mirrored back to the
  // owning lich as healing (it profits from the party wounding its thralls).
  if (amount > 0 && damage.damageClass !== 'sanity' && target.drainLinkTo) {
    const lich = target.drainLinkTo;
    if (lich !== target && lich.alive && lich.hp < lich.maxHp) {
      const before = lich.hp;
      lich.hp = Math.min(lich.maxHp, lich.hp + amount);
      const healed = lich.hp - before;
      if (healed > 0) {
        ctx.log(`${lich.name} drains ${healed} health from ${target.name}.`);
        ctx.vfx?.combatFeedback?.(lich, { kind: 'heal', amount: healed, label: 'DRAIN LINK' });
      }
    }
  }

  // Lich phylactery: the first time it would die, it claws back to half HP
  // instead. Sanity is also topped up so a mental "kill" can't slip past.
  if (
    target.reviveAtHalfAvailable &&
    (target.hp <= 0 || (!target.sanityImmune && target.sanity <= 0)) &&
    !target.unkillable
  ) {
    target.reviveAtHalfAvailable = false;
    target.hp = Math.max(1, Math.ceil(target.maxHp / 2));
    if (target.maxSanity > 0) target.sanity = target.maxSanity;
    ctx.log(`${target.name} revives at half HP (phylactery).`);
  }

  if (targetWasAlive && !target.alive) {
    ctx.game.notifyMageDefeated(target, ctx.caster);
    ctx.game.restoreEdgelordCaptives();
  }

  // Death-word marks resolve after ordinary lethality, so a blow that already
  // killed the target cannot be attributed twice.
  if (amount > 0 && (damage.type === 'shadow' || damage.type === 'corrosive')) {
    ctx.game.tickDeathCurse(target, `${damage.type} damage`);
  }
  if (amount > 0) ctx.game.checkReapDeath(target, ctx.caster);

  // A landed hit can shatter veils. The victim's veil may be torn off; the
  // attacker may reveal themselves by striking. DoT ticks (canMiss === false)
  // do not reveal an attacker.
  if (amount > 0) {
    ctx.vfx?.hit?.(target);
    // Track that the attacker landed a hit on a foe this turn (Order Curse Drain
    // reads this to decide its "no damage dealt" bonus), and deepen an Order
    // Curse Drain if the cursed creature wounds one of the curse-author's allies.
    if (target.team !== ctx.caster.team) {
      ctx.caster.dealtDamageThisTurn = true;
      if (ctx.caster.deathknightKind) ctx.caster.deathknightHitThisTurn.add(target);
      const ocd = ctx.caster.statuses.find(
        (s) => s.kind === 'dot' && s.key === 'dot:order-curse-drain'
      ) as DotStatus | undefined;
      if (ocd && ocd.extendOwnerTeam === target.team && ocd.extendSeq !== ctx.game.turnSeq) {
        ocd.duration += 2;
        ocd.extendSeq = ctx.game.turnSeq;
        ctx.log(`Order's curse deepens on ${ctx.caster.name} (+2 cycles).`);
      }
    }
    // Order Curse Slash: mark that the bearer struck the entity it was ordered
    // to engage (read at its next turn to decide whether it earns a stack).
    const oj = ctx.caster.statuses.find((s) => s.kind === 'orderJudgment') as
      | OrderJudgmentStatus
      | undefined;
    if (oj && ctx.game.mages[oj.targetIndex] === target) oj.attackedTarget = true;
    ctx.game.echoThreadMark(ctx.caster, target, amount);
    ctx.game.arcStormConduit(ctx.caster, target, amount);
    ctx.game.recordPierceEcho(ctx.caster, target, amount);
    ctx.game.extendPierceWounds(target, damage, amount);
    // Spell impact overlay on the afflicted target: corrosive → poison splash,
    // anything else → the generic impact. Suppressed for basic attacks and DoT
    // ticks (which drive their own 'dot' overlay).
    if (!opts.noImpactFx) {
      ctx.vfx?.spellEffect?.(target, damage.type === 'corrosive' ? 'corrosive' : 'generic');
    }
    breakVeilOnStruck(ctx, target, damage.damageClass, amount);
    if (canMiss) breakVeilOnStrike(ctx, ctx.caster, amount);
    ctx.game.resolveVeilCorrodePierce(ctx.caster, target, veilCorrodePiercePower);
    // A Channeling Ring converts pain into mana.
    const manaBack = target.manaOnHit();
    if (manaBack > 0) {
      target.gainMana(manaBack);
      ctx.log(`${target.name}'s Channeling Ring grants ${manaBack} mana.`);
    }
    // Gaze Timez Bracelet: dealing or taking mental (mill) damage grants 1d3 mana.
    if (damage.damageClass === 'sanity') {
      tryMillMana(ctx.caster, ctx);
      tryMillMana(target, ctx);
    }
    // A Gambler's Blade hoards Greed — 1d3 per damaging action (dedup per action).
    if (ctx.caster.greedArmed && ctx.caster.hasGamblerBlade()) {
      ctx.caster.greedArmed = false;
      const gained = ctx.rng.roll('1d3').total;
      ctx.caster.greedStacks += gained;
      ctx.log(
        `${ctx.caster.name}'s Gambler's Blade hoards ${gained} Greed (now ${ctx.caster.greedStacks}).`
      );
    }
    // Blood Charm: spells you cast heal you for a slice of the HP damage dealt.
    if (
      damage.damageClass !== 'sanity' &&
      ctx.caster.spellcastActive &&
      target.team !== ctx.caster.team &&
      ctx.caster.spellLifestealPct() > 0 &&
      ctx.caster.alive
    ) {
      const leech = Math.round(amount * ctx.caster.spellLifestealPct() * ctx.caster.healMult());
      if (leech > 0) {
        ctx.caster.hp = Math.min(ctx.caster.maxHp, ctx.caster.hp + leech);
        ctx.log(`${ctx.caster.name}'s Blood Charm heals ${leech}.`);
      }
    }
  }
  return amount;
}

/** Gaze Timez Bracelet: once per duel, dealing/taking mental damage gives 1d3 mana. */
function tryMillMana(mage: Mage, ctx: EffectContext): void {
  if (mage.manaMilledOnce) return;
  if (!mage.equippedItems().some((id) => getItem(id).millManaOnce)) return;
  mage.manaMilledOnce = true;
  const gain = ctx.rng.roll('1d3').total;
  mage.gainMana(gain);
  ctx.log(`${mage.name}'s Gaze Timez Bracelet grants ${gain} mana.`);
}

/** Chance (0..1) that a targeted attack misses a veiled mage `units` away. */
function veilDodgeChance(mode: 'full' | 'partial', units: number): number {
  if (mode === 'full') {
    // True veil: untargetable beyond range, otherwise a heavy dodge up close.
    return units > VEIL.full.targetableDist ? 1 : VEIL.full.dodge;
  }
  // Half veil: the further the attacker, the harder you are to pin down.
  if (units > VEIL.half.farDist) return VEIL.half.farDodge;
  if (units >= VEIL.half.midDist) return VEIL.half.midDodge;
  return VEIL.half.nearDodge;
}

/** End the victim's veil after it is struck, per the half/true veil rules. */
function breakVeilOnStruck(
  ctx: EffectContext,
  target: Mage,
  damageClass: DamageClass,
  amount: number
): void {
  const inv = target.getInvisibility();
  if (!inv) return;
  const isMill = damageClass === 'sanity';
  const breaks =
    inv.mode === 'partial'
      ? true // any landed damage shatters a half veil
      : isMill
      ? amount > VEIL.full.breakMill
      : amount > VEIL.full.breakNonMill;
  if (breaks) {
    removeInvisibility(target);
    ctx.log(`${target.name}'s veil is removed by the hit.`);
  }
}

/** Attacking with anything reveals you: any blow that lands tears your veil away. */
function breakVeilOnStrike(ctx: EffectContext, attacker: Mage, amount: number): void {
  // A silent cast never gives the caster away.
  if (ctx.game.castSilent) return;
  const inv = attacker.getInvisibility();
  if (!inv) return;
  if (amount > 0) {
    removeInvisibility(attacker);
    ctx.log(`${attacker.name} is revealed by their attack.`);
  }
}

/** Strip any invisibility status from a mage. */
function removeInvisibility(m: Mage): void {
  m.statuses = m.statuses.filter((s) => s.kind !== 'invisibility');
}

// -----------------------------------------------------------------------------
//  HEAL
// -----------------------------------------------------------------------------

export function heal(
  ctx: EffectContext,
  target: Mage,
  amount: number,
  pool: 'hp' | 'sanity' = 'hp'
): void {
  amount = Math.max(0, Math.round(amount));
  // A mandated healer works harder, whichever pool it is mending.
  const mandate = ctx.game.orderMandate(ctx.caster);
  if (mandate) amount = Math.round(amount * mandate.potency);
  if (pool === 'sanity') {
    const before = target.sanity;
    target.sanity = Math.min(target.maxSanity, target.sanity + amount);
    ctx.log(`${target.name} recovers ${amount} sanity.`);
    const restored = target.sanity - before;
    if (restored > 0) ctx.vfx?.combatFeedback?.(target, { kind: 'sanityHeal', amount: restored });
  } else {
    // Blood Charm and the like make every heal restore more.
    amount = Math.round(amount * target.healMult() * ctx.game.healMultiplierAt(target.pos));
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + amount);
    ctx.log(`${target.name} heals ${amount} health.`);
    const restored = target.hp - before;
    if (restored > 0) ctx.vfx?.combatFeedback?.(target, { kind: 'heal', amount: restored });
    if (amount > 0) {
      ctx.game.reapOnOwnerHeal(target);
    }
  }
}

// -----------------------------------------------------------------------------
//  INVISIBILITY
// -----------------------------------------------------------------------------

/**
 * Make a mage invisible.
 *  - mode 'full'    : a "true veil" — untargetable past close range, and a 90%
 *                     dodge within it; only torn off by heavy hits.
 *  - mode 'partial' : a "half veil" — a distance-based dodge that any landed
 *                     hit (or a close enemy) collapses.
 * `extend` adds to an existing invisibility's duration instead of refreshing.
 */
export function applyInvisibility(
  ctx: EffectContext,
  target: Mage,
  opts: { duration: number; mode: InvisMode; extend?: boolean; veilBindLinked?: boolean }
): void {
  const duration = critScale(ctx, opts.duration);
  addOrExtendStatus(
    target.statuses,
    {
      key: 'invisibility',
      name: opts.mode === 'full' ? 'Unseen' : 'Veiled',
      kind: 'invisibility',
      duration,
      mode: opts.mode,
    },
    !!opts.extend
  );
  ctx.log(
    `${target.name} becomes ${opts.mode === 'full' ? 'fully invisible' : 'hard to see'} (${duration} cycles).`
  );
  ctx.vfx?.spellEffect?.(target, 'vanish');
  if (!opts.veilBindLinked && ctx.game.isInVeilBindZone(target)) {
    applyStun(ctx, target, { duration, type: 'movement', veilBindLinked: true });
  }
}

// -----------------------------------------------------------------------------
//  STUN
// -----------------------------------------------------------------------------

/**
 * Stun a mage.
 *  - 'main'     : cannot take main actions.
 *  - 'movement' : cannot move.
 *  - 'full'     : cannot act at all.
 * `extend` adds to an existing stun's duration instead of refreshing.
 */
export function applyStun(
  ctx: EffectContext,
  target: Mage,
  opts: { duration: number; type: StunType; extend?: boolean; veilBindLinked?: boolean }
): void {
  if (ctx.game.isUnreachable(target)) return;
  if (target.slowStunImmune) {
    ctx.log(`${target.name} is immune to stuns and roots.`);
    return;
  }
  if (target.isDebuffImmune()) {
    ctx.log(`${target.name} is immune to stuns.`);
    return;
  }
  const names: Record<StunType, string> = {
    main: 'Disarmed',
    movement: 'Rooted',
    full: 'Stunned',
  };
  let duration = afflictDuration(ctx, target, opts.duration);
  if (opts.type === 'movement' && target.slowStunResist) duration = Math.max(1, Math.floor(duration / 2));
  addOrExtendStatus(
    target.statuses,
    {
      key: `stun:${opts.type}`,
      name: names[opts.type],
      kind: 'stun',
      duration,
      stunType: opts.type,
      physicalRoot: opts.type === 'movement',
    },
    !!opts.extend
  );
  ctx.log(`${target.name} is ${names[opts.type].toLowerCase()} (${duration} cycles).`);
  if (!opts.veilBindLinked && opts.type !== 'main' && ctx.game.isInVeilBindZone(target)) {
    applyInvisibility(ctx, target, {
      duration,
      mode: 'partial',
      veilBindLinked: true,
    });
  }
}

// -----------------------------------------------------------------------------
//  DASH / FORCED MOVEMENT
// -----------------------------------------------------------------------------

/** Phase colours: arcane for a raw blink, shadow for a pool-to-pool step. */
const BLINK_ARCANE = 0xbfa8ff;
const BLINK_SHADOW = 0x8a6bff;

/**
 * Move a mage. Provide either:
 *  - toPoint   : dash towards an absolute point (capped at `distance`), or
 *  - direction : a (non-normalised) vector to travel `distance` along.
 * Movement is clamped to the playfield. Works for self-dashes and for shoving
 * an enemy (pass the enemy as `mover`).
 */
export function dash(
  ctx: EffectContext,
  mover: Mage,
  opts: { toPoint?: Vec2; direction?: Vec2; distance: number }
): void {
  let dest: Vec2;
  if (opts.toPoint) {
    dest = stepTowards(mover.pos, opts.toPoint, opts.distance);
  } else if (opts.direction) {
    const len = Math.hypot(opts.direction.x, opts.direction.y) || 1;
    dest = {
      x: mover.x + (opts.direction.x / len) * opts.distance,
      y: mover.y + (opts.direction.y / len) * opts.distance,
    };
  } else {
    return;
  }
  const from = { x: mover.x, y: mover.y };
  const fieldDest = {
    x: Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, dest.x)),
    y: Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, dest.y)),
  };
  // A reality-break barrier stops a dash at its edge (the dash/spell ends).
  const bc = ctx.game.clampToBarriers(from, fieldDest);
  mover.x = bc.dest.x;
  mover.y = bc.dest.y;
  ctx.game.notifyMageRelocation(mover, from, bc.dest, true);
  ctx.vfx?.dash?.(mover, from);
  ctx.game.triggerNeedlepointDomains(mover);
  if (bc.blocked) {
    ctx.log(`${mover.name} is stopped by a reality break.`);
  } else {
    ctx.log(`${mover.name} dashes ${Math.round(opts.distance)} away.`);
  }
}

/**
 * Teleport a mage ("blinkstep"). Unlike {@link dash} this is instantaneous
 * displacement, not physical travel: it ignores every movement modifier —
 * reality-break barriers, Mutivarg crushing fields and roots — and only the
 * playfield edge bounds where the mage may appear.
 */
export function blinkstep(
  ctx: EffectContext,
  mover: Mage,
  opts: { toPoint?: Vec2; direction?: Vec2; distance: number }
): void {
  let dest: Vec2;
  if (opts.toPoint) {
    dest = stepTowards(mover.pos, opts.toPoint, opts.distance);
  } else if (opts.direction) {
    const len = Math.hypot(opts.direction.x, opts.direction.y) || 1;
    dest = {
      x: mover.x + (opts.direction.x / len) * opts.distance,
      y: mover.y + (opts.direction.y / len) * opts.distance,
    };
  } else {
    return;
  }
  const from = { x: mover.x, y: mover.y };
  // Clamp only to the field edge — barriers and crushing fields never stop a blink.
  mover.x = Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, dest.x));
  mover.y = Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, dest.y));
  ctx.game.notifyMageRelocation(mover, from, mover.pos, false);
  ctx.vfx?.blink?.(from, mover.pos, BLINK_ARCANE);
  ctx.game.triggerNeedlepointDomains(mover);
  ctx.log(`${mover.name} blinksteps ${Math.round(opts.distance)} away.`);
}

/**
 * Instantly reposition a mage at `at` with NO travel animation — the mage does
 * not visibly slide across the field, they simply are somewhere new on the next
 * redraw. Clamped to the playfield edge. Used for shadow-to-shadow teleports.
 */
export function teleport(ctx: EffectContext, mover: Mage, at: Vec2): void {
  const from = mover.pos;
  mover.x = Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, at.x));
  mover.y = Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, at.y));
  ctx.game.notifyMageRelocation(mover, from, mover.pos, false);
  ctx.vfx?.blink?.(from, mover.pos, BLINK_SHADOW);
  ctx.game.triggerNeedlepointDomains(mover);
  ctx.log(`${mover.name} teleports.`);
}

/** Distance helper exposed for spells that scale with range. */
export function distanceBetween(a: Mage, b: Mage): number {
  return dist(a.pos, b.pos);
}

// -----------------------------------------------------------------------------
//  SHADOW
// -----------------------------------------------------------------------------

/**
 * Conjure a shadow zone at `at`, owned by the caster's team. While it lasts the
 * caster can cast from / bounce spells through it, and any mage standing inside
 * a shadow suffers (or deals) extra damage.
 */
export function placeShadow(ctx: EffectContext, at: Vec2, ttl?: number): void {
  ctx.game.addShadow(at, ctx.caster.team, ttl != null ? critScale(ctx, ttl) : ttl);
  ctx.log(`${ctx.caster.name} creates a shadow pool.`);
}

/**
 * Scatter `charges` of sand at `at`. Sand belongs to nobody: it is ground, and
 * whoever stands on it may draw on it.
 */
export function placeSand(ctx: EffectContext, at: Vec2, charges = 1): void {
  ctx.game.addSand(at, charges);
  ctx.log(`${charges} charge${charges === 1 ? '' : 's'} of sand drift across the ground.`);
}

/** How many charges of sand lie at `at`. */
export function sandChargesAt(ctx: EffectContext, at: Vec2): number {
  return ctx.game.sandChargesAt(at);
}

/** Consume up to `count` charges at `at`; returns how many were actually spent. */
export function spendSand(ctx: EffectContext, at: Vec2, count: number): number {
  return ctx.game.spendSandAt(at, count);
}

/** Shift up to `count` charges from one point to another; returns how many moved. */
export function moveSand(ctx: EffectContext, from: Vec2, to: Vec2, count: number): number {
  return ctx.game.moveSand(from, to, count);
}

/** Whether the caster has sand to work with, underfoot or where it is aiming. */
export function hasSand(ctx: EffectContext, at?: Vec2 | null): boolean {
  return ctx.game.hasSandFor(ctx.caster, at);
}

/** Strip every invisibility / veil status from `target`. Returns true if any. */
export function dispelVeil(ctx: EffectContext, target: Mage): boolean {
  const before = target.statuses.length;
  target.statuses = target.statuses.filter(
    (s) => s.kind !== 'invisibility' && s.kind !== 'shadowVeil'
  );
  const removed = target.statuses.length !== before;
  if (removed) ctx.log(`${target.name}'s veil is removed.`);
  return removed;
}

// -----------------------------------------------------------------------------
//  DEBUFF / DAMAGE-OVER-TIME
// -----------------------------------------------------------------------------

/**
 * Apply a damage-over-time effect that ticks at the start of the victim's turn.
 */
export function applyDot(
  ctx: EffectContext,
  target: Mage,
  opts: {
    name: string;
    key?: string;
    duration: number;
    damage: DamageInstance;
    /** Optional dice spec rolled fresh each tick (e.g. "1d3"); overrides amount. */
    damageSpec?: string;
    /** Only tick while the bearer's opponent is within this distance band (px). */
    band?: { min: number; max: number };
    /** Chance (0-1) for each tick to also stun the bearer. */
    stunChance?: number;
    /** Stun kind applied when `stunChance` triggers (default 'full'). */
    stunType?: StunType;
    /** Index (in game.mages) of the mage healed for this DoT's damage each tick. */
    lifestealToIndex?: number;
    /** Resource restored by lifesteal; defaults to HP. */
    lifestealPool?: 'hp' | 'sanity';
    /** Enemy-only damage splashed around the bearer on each tick. */
    splash?: {
      radius: number;
      damage: DamageInstance;
      damageSpec: string;
    };
    /** Team of the DoT's source, used to exclude allies from splash. */
    sourceTeam?: number;
    /** Extra dice rolled on a tick when the bearer dealt no damage last turn. */
    bonusNoDamageSpec?: string;
    /** Owner's team: bearer damaging this team in a cycle extends the DoT +2. */
    extendOwnerTeam?: number;
    /** Reap stacks added to the bearer on every tick. */
    reapPerTick?: number;
    /** Index (in game.mages) whose healing adds 1 Reap to the bearer. */
    reapOnOwnerHealIndex?: number;
    /** On the bearer's death, pass its Reap to the nearest enemy in this radius. */
    reapTransferRadius?: number;
    /** Dice specs used in order on successive ticks; the last one repeats forever. */
    escalateSpecs?: string[];
    /** Random actions the bearer forgets on every tick. */
    forgetPerTick?: number;
    /** Each tick, copy this DoT at half duration onto everything within this radius. */
    spreadRadius?: number;
    /** The contagion veils everyone it infects. */
    spreadVeils?: boolean;
    /** Pierce damage on the bearer buys the DoT more time. */
    extendOnPierce?: { minAmount: number; chanceBelow: number; maxDuration: number };
    /** When a tick empties the bearer's sanity, jump to the nearest unit in this radius. */
    jumpOnMindBreakRadius?: number;
    extend?: boolean;
  }
): void {
  if (target.isDebuffImmune()) {
    ctx.log(`${target.name} is immune to debuffs. ${opts.name} fails.`);
    return;
  }
  const duration = afflictDuration(ctx, target, opts.duration);
  addOrExtendStatus(
    target.statuses,
    {
      key: opts.key ?? `dot:${opts.name}`,
      name: opts.name,
      kind: 'dot',
      duration,
      sourceIndex: ctx.game.mages.indexOf(ctx.caster),
      damage: opts.damage,
      damageSpec: opts.damageSpec,
      band: opts.band,
      stunChance: opts.stunChance,
      stunType: opts.stunType,
      lifestealToIndex: opts.lifestealToIndex,
      lifestealPool: opts.lifestealPool,
      splash: opts.splash,
      sourceTeam: opts.sourceTeam,
      bonusNoDamageSpec: opts.bonusNoDamageSpec,
      extendOwnerTeam: opts.extendOwnerTeam,
      reapPerTick: opts.reapPerTick,
      reapOnOwnerHealIndex: opts.reapOnOwnerHealIndex,
      reapTransferRadius: opts.reapTransferRadius,
      escalateSpecs: opts.escalateSpecs,
      escalateIndex: opts.escalateSpecs ? 0 : undefined,
      forgetPerTick: opts.forgetPerTick,
      spreadRadius: opts.spreadRadius,
      spreadVeils: opts.spreadVeils,
      extendOnPierce: opts.extendOnPierce,
      jumpOnMindBreakRadius: opts.jumpOnMindBreakRadius,
    },
    !!opts.extend
  );
  ctx.game.syncCurseCorrodeSlow(target);
  ctx.log(`${target.name} is afflicted with ${opts.name} (${duration} cycles).`);
}

/**
 * Apply (or add a stack to) a stacking damage-over-time. Each tick rolls
 * `perStackSpec` once per stack, so a 3-stack "1d2" DoT ticks for 3d2. A fresh
 * cast on an already-afflicted target adds one stack (capped at `maxStacks`) and
 * refreshes the duration; landing a stack while already at the cap only refreshes.
 */
export function applyStackingDot(
  ctx: EffectContext,
  target: Mage,
  opts: {
    name: string;
    key?: string;
    damage: DamageInstance;
    perStackSpec: string;
    maxStacks: number;
    /** Duration (in cycles) the DoT is refreshed to whenever a stack lands. */
    refreshDuration: number;
    /** Lose a stack each cycle in which no fresh stack was applied. */
    decayPerTick?: boolean;
    /** Spread the DoT to the owner's enemies within this radius (px) each tick. */
    infectRadius?: number;
  }
): void {
  if (target.isDebuffImmune()) {
    ctx.log(`${target.name} is immune to debuffs. ${opts.name} fails.`);
    return;
  }
  const key = opts.key ?? `dot:${opts.name}`;
  const refreshDuration = afflictDuration(ctx, target, opts.refreshDuration);
  const existing = target.statuses.find(
    (s) => s.key === key && s.kind === 'dot'
  ) as DotStatus | undefined;
  if (existing) {
    const before = existing.stacks ?? 1;
    existing.stacks = Math.min(opts.maxStacks, before + 1);
    existing.duration = Math.max(existing.duration, refreshDuration);
    existing.freshStack = true;
    ctx.game.syncCurseCorrodeSlow(target);
    ctx.log(`${target.name}'s ${opts.name} deepens to ${existing.stacks} stacks.`);
    return;
  }
  target.statuses.push({
    key,
    name: opts.name,
    kind: 'dot',
    duration: refreshDuration,
    sourceIndex: ctx.game.mages.indexOf(ctx.caster),
    damage: opts.damage,
    perStackSpec: opts.perStackSpec,
    stacks: 1,
    maxStacks: opts.maxStacks,
    freshStack: true,
    decayPerTick: opts.decayPerTick,
    infectRadius: opts.infectRadius,
    sourceTeam: ctx.caster.team,
  });
  ctx.game.syncCurseCorrodeSlow(target);
  ctx.log(`${target.name} is afflicted with ${opts.name}.`);
}

/** Apply one or more stacks of the dedicated Fire status. */
export function applyFireStacks(
  ctx: EffectContext,
  target: Mage,
  count = 1
): void {
  ctx.game.applyFireStacks(target, count, ctx.caster);
}

/** Apply one or more stacks of Blueflare, Fire's slower-decaying mental counterpart. */
export function applyBlueflareStacks(
  ctx: EffectContext,
  target: Mage,
  count = 1
): void {
  ctx.game.applyBlueflareStacks(target, count, ctx.caster);
}

/**
 * Apply a debuff that changes stats (moveRange / damageDealt / damageTaken).
 */
export function applyDebuff(
  ctx: EffectContext,
  target: Mage,
  opts: {
    name: string;
    key?: string;
    duration: number;
    mods: Partial<{ moveRange: number; damageDealt: number; damageTaken: number }>;
    healMult?: number;
    extend?: boolean;
  }
): void {
  if (ctx.game.isUnreachable(target)) return;
  if (target.slowStunImmune && (opts.mods.moveRange ?? 0) < 0) {
    ctx.log(`${target.name} ignores the slow.`);
    return;
  }
  if (target.isDebuffImmune()) {
    ctx.log(`${target.name} is immune to debuffs. ${opts.name} fails.`);
    return;
  }
  // A Witch Wand makes every debuff the caster lands last twice as long.
  const duration = afflictDuration(ctx, target, ctx.caster.hasWitchWand() ? opts.duration * 2 : opts.duration);
  addOrExtendStatus(
    target.statuses,
    {
      key: opts.key ?? `debuff:${opts.name}`,
      name: opts.name,
      kind: 'debuff',
      duration,
      mods: opts.mods,
      healMult: opts.healMult,
    },
    !!opts.extend
  );
  ctx.log(`${target.name} is cursed with ${opts.name} (${duration} cycles).`);
}

/** Remove all debuffs / dots / stuns from a mage (a cleanse helper). */
export function cleanse(ctx: EffectContext, target: Mage): void {
  const before = target.statuses.length;
  target.statuses = target.statuses.filter(
    (s) => s.kind === 'invisibility'
  );
  if (target.statuses.length !== before) {
    ctx.log(`${target.name} is cleansed.`);
  }
}

// -----------------------------------------------------------------------------
//  AREA / CONE DAMAGE
// -----------------------------------------------------------------------------

/**
 * Damage every enemy of the caster inside a circle centred on `at`.
 * Returns the mages that were hit.
 */
export function areaDamage(
  ctx: EffectContext,
  at: Vec2,
  radius: number,
  damage: DamageInstance,
  opts: { canMiss?: boolean; noImpactFx?: boolean } = {}
): Mage[] {
  const hits = ctx.game
    .magesInRadius(at, radius, ctx.caster)
    .filter((m) => m.team !== ctx.caster.team || ctx.game.isFoeBlind(ctx.caster));
  for (const m of hits) dealDamage(ctx, m, { ...damage }, { ...opts, aoe: true });
  ctx.game.damageScarabsInRadius(
    at,
    radius,
    ctx.caster.team,
    damage.amount,
    damage.type,
    damage.damageClass === 'sanity'
  );
  return hits;
}

/**
 * Damage every enemy of the caster inside a cone from the caster aimed at
 * `toward`. Returns the mages that were hit.
 */
export function coneDamage(
  ctx: EffectContext,
  toward: Vec2,
  range: number,
  degrees: number,
  damage: DamageInstance,
  opts: { canMiss?: boolean; strictRange?: boolean; noImpactFx?: boolean } = {}
): Mage[] {
  const { strictRange = false, ...damageOpts } = opts;
  let hits = ctx.game
    .magesInCone(ctx.caster.pos, toward, range, degrees, ctx.caster)
    .filter((m) => m.team !== ctx.caster.team || ctx.game.isFoeBlind(ctx.caster));
  if (strictRange) {
    hits = hits.filter((m) => dist(ctx.caster.pos, m.pos) <= range + 0.5);
  }
  for (const m of hits) {
    dealDamage(ctx, m, { ...damage }, { ...damageOpts, aoe: true });
  }
  if (damage.type === 'heat') {
    ctx.game.destroyScarabsByFireInCone(
      ctx.caster.pos,
      toward,
      range,
      degrees,
      ctx.caster.team,
      strictRange
    );
  }
  return hits;
}

// -----------------------------------------------------------------------------
//  TOTEMS / AURAS / WARDS / CONTROL
// -----------------------------------------------------------------------------

/** Place a damaging, slowing totem at `at` owned by the caster's team. */
export function placeTotem(
  ctx: EffectContext,
  at: Vec2,
  opts: { radius: number; damageSpec: string; slow: number; ttl?: number; lifesteal?: boolean }
): void {
  // A critical cast widens the totem and (if it expires) makes it linger twice
  // as long.
  const scaled = {
    ...opts,
    radius: critScale(ctx, opts.radius),
    ttl: opts.ttl != null ? critScale(ctx, opts.ttl) : opts.ttl,
  };
  ctx.game.addTotem(at, ctx.caster.team, { ...scaled, ownerIndex: ctx.game.mages.indexOf(ctx.caster) });
  ctx.log(
    opts.lifesteal
      ? `${ctx.caster.name} raises a leeching totem.`
      : `${ctx.caster.name} raises a corroding totem.`
  );
}

/**
 * Deal damage to `target` and heal the caster for the amount dealt (lifesteal).
 * Returns the damage actually dealt.
 */
export function drainDamage(
  ctx: EffectContext,
  target: Mage,
  damage: DamageInstance,
  opts: DealDamageOptions = {}
): number {
  const dealt = dealDamage(ctx, target, damage, { ...opts, noImpactFx: true });
  if (dealt > 0 && ctx.caster.alive) {
    if (!opts.noImpactFx) ctx.vfx?.spellEffect?.(target, 'corrosive');
    ctx.vfx?.drainParticles?.(target.pos, ctx.caster.pos);
    heal(ctx, ctx.caster, dealt);
  }
  return dealt;
}

/** Summon a swarm of scarabs around `at`, owned by the caster's team. */
export function summonScarabs(
  ctx: EffectContext,
  at: Vec2,
  count = SCARAB.count
): void {
  ctx.game.addScarabs(at, ctx.caster.team, count, ctx.game.mages.indexOf(ctx.caster));
  ctx.log(`${ctx.caster.name} summons ${count} scarabs.`);
}

/** Curse a mage so it bleeds damage to everyone around it each turn. */
export function applyAuraDot(
  ctx: EffectContext,
  target: Mage,
  opts: {
    name: string;
    duration: number;
    radius: number;
    damageSpec: string;
    type: DamageType;
    damageClass?: DamageClass;
  }
): void {
  if (ctx.game.isUnreachable(target)) return;
  if (target.isDebuffImmune()) {
    ctx.log(`${target.name} is immune to debuffs. ${opts.name} fails.`);
    return;
  }
  const duration = afflictDuration(ctx, target, opts.duration);
  addOrExtendStatus(
    target.statuses,
    {
      key: `auraDot:${opts.name}`,
      name: opts.name,
      kind: 'auraDot',
      duration,
      radius: critScale(ctx, opts.radius),
      damageSpec: opts.damageSpec,
      type: opts.type,
      damageClass: opts.damageClass ?? 'physical',
    },
    false
  );
  ctx.game.syncCurseCorrodeSlow(target);
  ctx.log(`${target.name} gains ${opts.name} (${duration} cycles).`);
}

/** Grant a consumable ward that negates the next matching hit. */
export function applyWard(
  ctx: EffectContext,
  target: Mage,
  opts: { name: string; against: 'mind'; duration: number }
): void {
  addOrExtendStatus(
    target.statuses,
    {
      key: `ward:${opts.against}`,
      name: opts.name,
      kind: 'ward',
      duration: critScale(ctx, opts.duration),
      against: opts.against,
    },
    false
  );
  ctx.log(`${target.name} readies ${opts.name}.`);
}

/** Apply a mental compulsion (expose / repeat / random). Warded by Mind Dodge. */
export function applyControl(
  ctx: EffectContext,
  target: Mage,
  opts: { name: string; mode: ControlMode; duration: number }
): void {
  if (ctx.game.isUnreachable(target)) return;
  if (target.controlImmune) {
    ctx.log(`${target.name} cannot be controlled from outside.`);
    return;
  }
  if (target.isDebuffImmune()) {
    ctx.log(`${target.name} is immune to control.`);
    return;
  }
  if (target.consumeWard('mind')) {
    ctx.log(`${target.name}'s Mind Dodge negates the control effect.`);
    return;
  }
  const duration = afflictDuration(ctx, target, opts.duration);
  addOrExtendStatus(
    target.statuses,
    {
      key: 'control',
      name: opts.name,
      kind: 'control',
      duration,
      mode: opts.mode,
    },
    false
  );
  ctx.log(`${target.name} is controlled by ${opts.name} (${duration} cycles).`);
}

/**
 * Order Curse Slash: bind `bearer` to engage `entity`. Each of the bearer's
 * next `evals` turns is judged (move toward + attack the entity); disobedience
 * accrues stacks that detonate as `perStackSpec` slashing when the count runs
 * out. Tracked and resolved by GameState.tickOrderJudgments.
 */
export function applyOrderJudgment(
  ctx: EffectContext,
  bearer: Mage,
  entity: Mage,
  opts: { evals: number; perStackSpec: string }
): void {
  const targetIndex = ctx.game.mages.indexOf(entity);
  const ownerIndex = ctx.game.mages.indexOf(ctx.caster);
  addOrExtendStatus(
    bearer.statuses,
    {
      key: 'orderJudgment',
      name: 'Order',
      kind: 'orderJudgment',
      // Padded past the evaluation window so tickStatuses never expires it
      // before the judgement detonates (GameState removes it explicitly).
      duration: opts.evals + 2,
      targetIndex,
      ownerIndex,
      evalsLeft: opts.evals,
      stacks: 0,
      lastDist: 0,
      attackedTarget: false,
      observing: false,
      perStackSpec: opts.perStackSpec,
    },
    false
  );
  ctx.log(`${bearer.name} is bound to Order \u2014 engage ${entity.name} or answer for it.`);
}

/** Mono Order on an enemy: it may declare nothing hostile while this holds. */
export function applyPacify(ctx: EffectContext, target: Mage, duration: number): void {
  if (ctx.game.isUnreachable(target)) return;
  if (target.isDebuffImmune()) {
    ctx.log(`${target.name} will not be told what to do.`);
    return;
  }
  const turns = afflictDuration(ctx, target, duration);
  addOrExtendStatus(
    target.statuses,
    { key: 'pacified', name: 'Pacified', kind: 'pacified', duration: turns },
    false
  );
  ctx.log(`${target.name} is forbidden any hostile action (${turns} cycles).`);
}

/** Mono Order on an ally: stronger in every way, but only against one entity. */
export function applyOrderMandate(
  ctx: EffectContext,
  bearer: Mage,
  entity: Mage,
  opts: { duration: number; potency: number }
): void {
  const targetIndex = ctx.game.mages.indexOf(entity);
  if (targetIndex < 0) return;
  const turns = critScale(ctx, opts.duration);
  addOrExtendStatus(
    bearer.statuses,
    {
      key: 'orderMandate',
      name: 'Mandate',
      kind: 'orderMandate',
      duration: turns,
      targetIndex,
      ownerIndex: ctx.game.mages.indexOf(ctx.caster),
      potency: opts.potency,
    },
    false
  );
  ctx.log(
    `${bearer.name} accepts the Mandate: +${Math.round((opts.potency - 1) * 100)}% power, ` +
    `but ${entity.name} is the only thing it may touch (${turns} cycles).`
  );
}

/** Grant the bearer full invisibility while standing in a shadow zone. */
export function applyShadowVeil(
  ctx: EffectContext,
  target: Mage,
  opts: { duration: number }
): void {
  addOrExtendStatus(
    target.statuses,
    {
      key: 'shadowVeil',
      name: 'Shadow Veil',
      kind: 'shadowVeil',
      duration: opts.duration,
    },
    false
  );
  ctx.log(`${target.name} gains Shadow Veil (${opts.duration} cycles).`);
}

/**
 * Mark `target` so it leaves a trail of the caster's shadows wherever it moves
 * while the status lasts. Each dropped shadow persists for `perShadowTtl` rounds.
 */
export function applyShadowTrail(
  ctx: EffectContext,
  target: Mage,
  opts: { duration: number; perShadowTtl: number }
): void {
  addOrExtendStatus(
    target.statuses,
    {
      key: 'shadowTrail',
      name: 'Shadow Trail',
      kind: 'shadowTrail',
      duration: opts.duration,
      team: ctx.caster.team,
      perShadowTtl: opts.perShadowTtl,
    },
    false
  );
  ctx.log(`${target.name} now leaves a shadow trail.`);
}

// -----------------------------------------------------------------------------
//  REALITY (NAD easter-egg) EFFECTS
// -----------------------------------------------------------------------------

/**
 * Reality+Mind: swap which player controls which mage for the next exchange.
 * The swap activates once the caster's turn ends and lasts `turns` turns.
 */
export function swapMinds(ctx: EffectContext, target: Mage, turns: number): void {
  if (target.controlImmune) {
    ctx.log(`${target.name} cannot be controlled from outside.`);
    return;
  }
  ctx.game.pendingMindSwap = turns;
  ctx.log(`${ctx.caster.name} swaps control with ${target.name}.`);
}

/**
 * Reality+Shatter: raise a wedge "reality break" that blocks all movement.
 * The wedge's apex sits at the caster; its direction and width are derived from
 * the two aimed edges `cornerA` and `cornerB`, so the caster decides exactly where
 * the cone points and how wide it spreads. The cone always reaches out to
 * `opts.length` (the field's edge). Passing a null `cornerB` (AI / headless) falls
 * back to a default 45° wedge aimed at `cornerA`. Also fires the stretched shatter
 * animation so the visual matches the barrier.
 */
export function placeRealityWedge(
  ctx: EffectContext,
  cornerA: Vec2,
  cornerB: Vec2 | null,
  opts: { ttl: number; length: number }
): { apex: Vec2; angle: number; halfAngle: number; range: number } {
  const apex = { x: ctx.caster.x, y: ctx.caster.y };
  const angA = Math.atan2(cornerA.y - apex.y, cornerA.x - apex.x);
  let angle: number;
  let halfAngle: number;
  if (cornerB && (cornerB.x !== cornerA.x || cornerB.y !== cornerA.y)) {
    const angB = Math.atan2(cornerB.y - apex.y, cornerB.x - apex.x);
    // Signed shortest difference so the wedge always spans the narrow arc.
    let diff = angB - angA;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    angle = angA + diff / 2;
    halfAngle = Math.min(Math.abs(diff) / 2, (85 * Math.PI) / 180);
  } else {
    angle = angA;
    halfAngle = ((45 * Math.PI) / 180) / 2;
  }
  const range = Math.max(opts.length, 1);
  ctx.game.addBarrier(apex, angle, {
    shape: 'wedge',
    halfAngle,
    range,
    owner: ctx.caster.team,
    ttl: opts.ttl,
  });
  ctx.vfx?.wedge?.(apex, angle, halfAngle, range);
  ctx.log(`${ctx.caster.name} creates a reality wedge. Blocks all movement.`);
  return { apex, angle, halfAngle, range };
}

/**
 * Blue Wall: raise a thin rectangular wall centred on `center`, oriented at
 * `angle` (radians), that blocks all movement for `ttl` rounds.
 */
export function placeWall(
  ctx: EffectContext,
  center: Vec2,
  opts: { angle: number; length: number; thickness: number; ttl: number }
): void {
  ctx.game.addBarrier({ x: center.x, y: center.y }, opts.angle, {
    shape: 'rect',
    range: opts.length,
    thickness: opts.thickness,
    owner: ctx.caster.team,
    ttl: opts.ttl,
  });
  ctx.log(`${ctx.caster.name} raises a wall. Blocks all movement.`);
}

/** Shatter+Mind+Reality: grant `m` an extra turn after the current one. */
export function grantExtraTurn(ctx: EffectContext, m: Mage): void {
  ctx.game.grantExtraTurn(m);
  ctx.log(`${m.name} gains an extra turn.`);
}

/**
 * Twist+Mind: the target forgets `count` random actions (move / melee / one of
 * its words) for `duration` cycles. Placeholder for a richer system later.
 */
export function applyForget(
  ctx: EffectContext,
  target: Mage,
  opts: { count: number; duration: number }
): void {
  const pool: string[] = ['move', 'melee', ...target.loadout];
  const forgotten: string[] = [];
  while (forgotten.length < opts.count && pool.length > 0) {
    const idx = ctx.rng.die(pool.length) - 1;
    const [pick] = pool.splice(idx, 1);
    forgotten.push(pick);
  }
  addOrExtendStatus(
    target.statuses,
    { key: 'forget', name: 'Forgotten', kind: 'forget', duration: opts.duration, forgotten },
    false
  );
  ctx.log(`${target.name} forgets how to ${forgotten.join(' & ')} (${opts.duration} cycles).`);
}

/**
 * Twist (alone): a stifling warp. Hitting the same target with Twist twice in
 * the same turn (via reactions / repeated casts) deals 2d6 physical damage;
 * otherwise it briefly disarms the target's next main action.
 */
export function twistStrike(ctx: EffectContext, target: Mage): void {
  const seq = ctx.game.turnSeq;
  const consecutive = target.twistStampSeq === seq;
  target.twistStampSeq = seq;
  if (consecutive) {
    const amount = rollDice(ctx, '2d6', 'Twist (consecutive)');
    dealDamage(ctx, target, { amount, type: 'shatter', damageClass: 'physical' });
  } else {
    applyStun(ctx, target, { duration: 2, type: 'main' });
    ctx.log(`${target.name} loses its next main action.`);
  }
}

// -----------------------------------------------------------------------------
//  HAZARDS / SEALS / SPIKES / OATHS
// -----------------------------------------------------------------------------

/** Raise a standing, indiscriminate hazard centred on `at`. */
export function placeHazardZone(
  ctx: EffectContext,
  at: Vec2,
  opts: {
    name: string;
    radius: number;
    rounds: number;
    damageSpecs: string[];
    damageType: DamageType;
    movedOnly?: boolean;
    dodgeChance?: number;
    healMult?: number;
    color: number;
    /** Far end, to lay the hazard along a line instead of in a disc. */
    to?: Vec2;
    /** Pieces sharing a group merge into one field that only ticks once. */
    groupId?: number;
  }
): void {
  const { to, ...zone } = opts;
  ctx.game.addHazardZone(at, ctx.caster, {
    ...zone,
    toX: to?.x,
    toY: to?.y,
    radius: critScale(ctx, opts.radius),
    roundsLeft: critScale(ctx, opts.rounds),
  });
  ctx.log(`${ctx.caster.name} raises ${opts.name}.`);
}

/**
 * Seal `target` away: hidden from its OWN side (so no ally can reach it) while
 * the sealer's team may still act on it freely.
 */
export function applySeal(
  ctx: EffectContext,
  target: Mage,
  opts: { duration: number; damageSpec: string; executeAmount: number }
): void {
  if (target.isDebuffImmune()) {
    ctx.log(`${target.name} is immune to debuffs. The seal fails.`);
    return;
  }
  const duration = afflictDuration(ctx, target, opts.duration);
  addOrExtendStatus(
    target.statuses,
    {
      key: 'seal',
      name: 'Sealed',
      kind: 'seal',
      duration,
      blindTeam: target.team,
      ownerIndex: ctx.game.mages.indexOf(ctx.caster),
      damageSpec: opts.damageSpec,
      executeAmount: opts.executeAmount,
    },
    false
  );
  applyStun(ctx, target, { duration, type: 'full' });
  applyStun(ctx, target, { duration, type: 'movement' });
  ctx.log(`${target.name} is sealed away from its own side (${duration} cycles).`);
}

/** Stake `target` to the ground it stands on; straying from it is billed each turn. */
export function applyAnchorSpike(
  ctx: EffectContext,
  target: Mage,
  opts: { duration: number; pxPerDie: number; maxDice: number }
): void {
  if (target.isDebuffImmune()) {
    ctx.log(`${target.name} is immune to debuffs. The spike fails.`);
    return;
  }
  const duration = afflictDuration(ctx, target, opts.duration);
  addOrExtendStatus(
    target.statuses,
    {
      key: 'anchorSpike',
      name: 'Staked',
      kind: 'anchorSpike',
      duration,
      ownerIndex: ctx.game.mages.indexOf(ctx.caster),
      x: target.x,
      y: target.y,
      pxPerDie: opts.pxPerDie,
      maxDice: opts.maxDice,
    },
    false
  );
  ctx.log(`${target.name} is staked to the ground (${duration} cycles).`);
}

/** For `duration` cycles, every pierce hit the caster lands is dealt again at turn end. */
export function applyPierceEcho(ctx: EffectContext, target: Mage, duration: number): void {
  addOrExtendStatus(
    target.statuses,
    {
      key: 'pierceEcho',
      name: 'Blood Oath',
      kind: 'pierceEcho',
      duration: critScale(ctx, duration),
    },
    false
  );
  ctx.log(`${target.name} swears the oath: its pierce wounds will echo.`);
}

/** Turn `target` into a conduit: every wound on it arcs a share to nearby bodies. */
export function applyStormConduit(
  ctx: EffectContext,
  target: Mage,
  opts: { duration: number; maxTargets: number; radius: number; sharePct: number }
): void {
  if (target.isDebuffImmune()) {
    ctx.log(`${target.name} is immune to debuffs. The storm will not hold.`);
    return;
  }
  const duration = afflictDuration(ctx, target, opts.duration);
  addOrExtendStatus(
    target.statuses,
    {
      key: 'stormConduit',
      name: 'Storm Conduit',
      kind: 'stormConduit',
      duration,
      ownerIndex: ctx.game.mages.indexOf(ctx.caster),
      maxTargets: opts.maxTargets,
      radius: opts.radius,
      sharePct: opts.sharePct,
    },
    false
  );
  ctx.log(`${target.name} becomes a storm conduit (${duration} cycles).`);
}

