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
import {
  addOrExtendStatus,
  type ControlMode,
  type InvisMode,
  type StunType,
} from '../core/Status';
import { dist, stepTowards, type Vec2 } from '../core/utils';
import { FIELD, RANGE_UNIT, SCARAB, SHADOW_DAMAGE_BONUS, VEIL } from '../config/constants';
import { Dev } from '../config/dev';

/**
 * Optional bridge the scene supplies so effects can request visuals. Pure logic
 * still works without it (e.g. in tests), so every call is guarded with `?.`.
 */
export interface VfxSink {
  /** Show a dice-rolling animation for a roll that has already been computed. */
  diceRoll(spec: string, total: number, rolls: number[], label?: string): void;
  /** Play the "took damage" recoil on a mage. */
  hit?(mage: Mage): void;
  /** Animate a gradual dash for `mover`, which has just jumped from `from`. */
  dash?(mover: Mage, from: Vec2): void;
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
}

export interface EffectContext {
  game: GameState;
  caster: Mage;
  /** The chosen target mage, if the spell is targeted at a mage. */
  target: Mage | null;
  /** The chosen point, if the spell targets a location. */
  targetPoint: Vec2 | null;
  rng: Dice;
  log: (msg: string) => void;
  /** Visual feedback bridge (provided by the scene; absent in headless logic). */
  vfx?: VfxSink | null;
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
}

// -----------------------------------------------------------------------------
//  DICE
// -----------------------------------------------------------------------------

/**
 * Roll dice from a spec string ("2d6+1", "d20", "3d8"). Logs the result and
 * returns the total. Use this for variable damage, chances, etc.
 */
export function rollDice(ctx: EffectContext, spec: string, reason?: string): number {
  const r = ctx.rng.roll(spec);
  const detail = r.rolls.length
    ? ` [${r.rolls.join(', ')}${r.modifier ? (r.modifier > 0 ? `+${r.modifier}` : r.modifier) : ''}]`
    : '';
  ctx.log(`${ctx.caster.name} rolls ${spec}${reason ? ` for ${reason}` : ''}: ${r.total}${detail}`);
  ctx.vfx?.diceRoll(spec, r.total, r.rolls, reason ? `${reason} — damage` : undefined);
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
export function dealDamage(
  ctx: EffectContext,
  target: Mage,
  damage: DamageInstance,
  opts: { canMiss?: boolean; aoe?: boolean } = {}
): number {
  const canMiss = opts.canMiss !== false;
  const isAoe = !!opts.aoe;

  // Veil dodge: only targeted (non-area) attacks can be slipped. Area effects
  // always connect.
  if (canMiss && !isAoe && !Dev.autoSuccess) {
    const inv = target.getInvisibility();
    if (inv) {
      const units = dist(ctx.caster.pos, target.pos) / RANGE_UNIT;
      const dodge = veilDodgeChance(inv.mode, units);
      if (dodge >= 1 || ctx.rng.chance(dodge)) {
        ctx.log(`${target.name} blurs aside — the attack finds nothing.`);
        return 0;
      }
    }
  }

  // A Mind Dodge ward absorbs the next instance of sanity damage.
  if (damage.damageClass === 'sanity' && target.consumeWard('mind')) {
    ctx.log(`${target.name}'s Mind Dodge absorbs the psychic assault.`);
    return 0;
  }

  let amount = damage.amount + ctx.caster.modifier('damageDealt') + target.modifier('damageTaken');

  // Shadow empowerment: casting from within a shadow, or striking a target that
  // stands in one, deals extra damage.
  let shadowBonus = 0;
  if (ctx.game.isInShadow(ctx.caster)) shadowBonus += SHADOW_DAMAGE_BONUS;
  if (ctx.game.isInShadow(target)) shadowBonus += SHADOW_DAMAGE_BONUS;
  if (shadowBonus > 0) {
    amount += shadowBonus;
    ctx.log(`The shadows deepen the wound (+${shadowBonus}).`);
  }

  amount = Math.max(0, Math.round(amount));

  if (damage.damageClass === 'sanity') {
    target.sanity = Math.max(0, target.sanity - amount);
  } else {
    target.hp = Math.max(0, target.hp - amount);
  }
  ctx.log(
    `${target.name} takes ${amount} ${damage.type} ${damage.damageClass} damage.`
  );

  // A landed hit can shatter veils. The victim's veil may be torn off; the
  // attacker may reveal themselves by striking. DoT ticks (canMiss === false)
  // do not reveal an attacker.
  if (amount > 0) {
    ctx.vfx?.hit?.(target);
    breakVeilOnStruck(ctx, target, damage.damageClass, amount);
    if (canMiss) breakVeilOnStrike(ctx, ctx.caster, amount);
  }
  return amount;
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
    ctx.log(`${target.name}'s veil is torn away by the hit.`);
  }
}

/** A veiled attacker may reveal themselves when they land a blow. */
function breakVeilOnStrike(ctx: EffectContext, attacker: Mage, amount: number): void {
  const inv = attacker.getInvisibility();
  if (!inv) return;
  const eligible =
    inv.mode === 'partial' ? amount > 0 : amount > VEIL.full.revealDealThreshold;
  const chance =
    inv.mode === 'partial' ? VEIL.half.revealOnDealChance : VEIL.full.revealOnDealChance;
  if (eligible && ctx.rng.chance(chance)) {
    removeInvisibility(attacker);
    ctx.log(`${attacker.name}'s veil flickers as they strike.`);
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
  if (pool === 'sanity') {
    target.sanity = Math.min(target.maxSanity, target.sanity + amount);
    ctx.log(`${target.name} recovers ${amount} sanity.`);
  } else {
    target.hp = Math.min(target.maxHp, target.hp + amount);
    ctx.log(`${target.name} heals ${amount} health.`);
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
  opts: { duration: number; mode: InvisMode; extend?: boolean }
): void {
  addOrExtendStatus(
    target.statuses,
    {
      key: 'invisibility',
      name: opts.mode === 'full' ? 'Unseen' : 'Veiled',
      kind: 'invisibility',
      duration: opts.duration,
      mode: opts.mode,
    },
    !!opts.extend
  );
  ctx.log(
    `${target.name} becomes ${opts.mode === 'full' ? 'fully invisible' : 'hard to see'} (${opts.duration} cycles).`
  );
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
  opts: { duration: number; type: StunType; extend?: boolean }
): void {
  const names: Record<StunType, string> = {
    main: 'Disarmed',
    movement: 'Rooted',
    full: 'Stunned',
  };
  addOrExtendStatus(
    target.statuses,
    {
      key: `stun:${opts.type}`,
      name: names[opts.type],
      kind: 'stun',
      duration: opts.duration,
      stunType: opts.type,
    },
    !!opts.extend
  );
  ctx.log(`${target.name} is ${names[opts.type].toLowerCase()} (${opts.duration} cycles).`);
}

// -----------------------------------------------------------------------------
//  DASH / FORCED MOVEMENT
// -----------------------------------------------------------------------------

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
  ctx.vfx?.dash?.(mover, from);
  if (bc.blocked) {
    ctx.log(`${mover.name} slams into a reality break and stops short.`);
  } else {
    ctx.log(`${mover.name} dashes ${Math.round(opts.distance)} away.`);
  }
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
  ctx.game.addShadow(at, ctx.caster.team, ttl);
  ctx.log(`${ctx.caster.name} conjures a pool of shadow.`);
}

/** Strip every invisibility / veil status from `target`. Returns true if any. */
export function dispelVeil(ctx: EffectContext, target: Mage): boolean {
  const before = target.statuses.length;
  target.statuses = target.statuses.filter(
    (s) => s.kind !== 'invisibility' && s.kind !== 'shadowVeil'
  );
  const removed = target.statuses.length !== before;
  if (removed) ctx.log(`${target.name}'s veil is torn away.`);
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
    extend?: boolean;
  }
): void {
  addOrExtendStatus(
    target.statuses,
    {
      key: opts.key ?? `dot:${opts.name}`,
      name: opts.name,
      kind: 'dot',
      duration: opts.duration,
      damage: opts.damage,
      damageSpec: opts.damageSpec,
      band: opts.band,
      stunChance: opts.stunChance,
      stunType: opts.stunType,
    },
    !!opts.extend
  );
  ctx.log(`${target.name} is afflicted with ${opts.name} (${opts.duration} cycles).`);
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
    extend?: boolean;
  }
): void {
  addOrExtendStatus(
    target.statuses,
    {
      key: opts.key ?? `debuff:${opts.name}`,
      name: opts.name,
      kind: 'debuff',
      duration: opts.duration,
      mods: opts.mods,
    },
    !!opts.extend
  );
  ctx.log(`${target.name} is cursed with ${opts.name} (${opts.duration} cycles).`);
}

/** Remove all debuffs / dots / stuns from a mage (a cleanse helper). */
export function cleanse(ctx: EffectContext, target: Mage): void {
  const before = target.statuses.length;
  target.statuses = target.statuses.filter(
    (s) => s.kind === 'invisibility'
  );
  if (target.statuses.length !== before) {
    ctx.log(`${target.name} is cleansed of afflictions.`);
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
  opts: { canMiss?: boolean } = {}
): Mage[] {
  const hits = ctx.game
    .magesInRadius(at, radius, ctx.caster)
    .filter((m) => m.team !== ctx.caster.team);
  for (const m of hits) dealDamage(ctx, m, { ...damage }, { ...opts, aoe: true });
  ctx.game.damageScarabsInRadius(
    at,
    radius,
    ctx.caster.team,
    damage.amount,
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
  opts: { canMiss?: boolean } = {}
): Mage[] {
  const hits = ctx.game
    .magesInCone(ctx.caster.pos, toward, range, degrees, ctx.caster)
    .filter((m) => m.team !== ctx.caster.team);
  for (const m of hits) dealDamage(ctx, m, { ...damage }, { ...opts, aoe: true });
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
  ctx.game.addTotem(at, ctx.caster.team, opts);
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
  opts: { canMiss?: boolean; aoe?: boolean } = {}
): number {
  const dealt = dealDamage(ctx, target, damage, opts);
  if (dealt > 0 && ctx.caster.alive) heal(ctx, ctx.caster, dealt);
  return dealt;
}

/** Summon a swarm of scarabs around `at`, owned by the caster's team. */
export function summonScarabs(
  ctx: EffectContext,
  at: Vec2,
  count = SCARAB.count
): void {
  ctx.game.addScarabs(at, ctx.caster.team, count);
  ctx.log(`${ctx.caster.name} looses a swarm of ${count} scarabs.`);
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
  addOrExtendStatus(
    target.statuses,
    {
      key: `auraDot:${opts.name}`,
      name: opts.name,
      kind: 'auraDot',
      duration: opts.duration,
      radius: opts.radius,
      damageSpec: opts.damageSpec,
      type: opts.type,
      damageClass: opts.damageClass ?? 'physical',
    },
    false
  );
  ctx.log(`${target.name} is wreathed in ${opts.name} (${opts.duration} cycles).`);
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
      duration: opts.duration,
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
  if (target.consumeWard('mind')) {
    ctx.log(`${target.name}'s Mind Dodge shrugs off the compulsion.`);
    return;
  }
  addOrExtendStatus(
    target.statuses,
    {
      key: 'control',
      name: opts.name,
      kind: 'control',
      duration: opts.duration,
      mode: opts.mode,
    },
    false
  );
  ctx.log(`${target.name} is gripped by ${opts.name} (${opts.duration} cycles).`);
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
  ctx.log(`${target.name} melds with the shadows (${opts.duration} cycles).`);
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
  ctx.log(`${ctx.caster.name}'s shadow clings to ${target.name}'s heels.`);
}

// -----------------------------------------------------------------------------
//  REALITY (NAD easter-egg) EFFECTS
// -----------------------------------------------------------------------------

/**
 * Reality+Mind: swap which player controls which mage for the next exchange.
 * The swap activates once the caster's turn ends and lasts `turns` turns.
 */
export function swapMinds(ctx: EffectContext, target: Mage, turns: number): void {
  ctx.game.pendingMindSwap = turns;
  ctx.log(`${ctx.caster.name} swaps minds with ${target.name} — control is about to invert!`);
}

/**
 * Reality+Shatter: raise a wedge "reality break" that blocks all movement.
 * The wedge opens from the caster, centred on the aim direction.
 */
export function placeBarrier(
  ctx: EffectContext,
  toward: Vec2,
  opts: { degrees: number; range: number; ttl: number }
): void {
  const angle = Math.atan2(toward.y - ctx.caster.y, toward.x - ctx.caster.x);
  ctx.game.addBarrier({ x: ctx.caster.x, y: ctx.caster.y }, angle, {
    halfAngle: ((opts.degrees * Math.PI) / 180) / 2,
    range: opts.range,
    owner: ctx.caster.team,
    ttl: opts.ttl,
  });
  ctx.log(`${ctx.caster.name} tears a wedge of reality open — no one may pass.`);
}

/** Shatter+Mind+Reality: grant `m` an extra turn after the current one. */
export function grantExtraTurn(ctx: EffectContext, m: Mage): void {
  ctx.game.grantExtraTurn(m);
  ctx.log(`${m.name} is granted an extra turn!`);
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
    ctx.log(`${target.name}'s next action is stifled by the twist.`);
  }
}

