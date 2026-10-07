// =============================================================================
//  CLASS KIT
// -----------------------------------------------------------------------------
//  The shared vocabulary of the class spells. A Life minion is a stat block
//  plus what its bite, its owner's turn and its death do; an Objects imbue is
//  what a landed strike, a blow taken or a turn start does; a Hexcraft law is a
//  rule the whole field obeys for a while. All three are data read here, so a
//  summon or an imbue rebuilt from a saved fight gets its behaviour back from
//  its kind alone.
// =============================================================================

import { FIELD, MELEE_RANGE, MOVE_RANGE, RANGE_UNIT } from '../config/constants';
import { barrierDistance } from '../core/Barrier';
import { dmg, type DamageInstance, type DamageType } from '../core/Damage';
import type { GameState } from '../core/GameState';
import { getItem } from '../core/Items';
import { Mage } from '../core/Mage';
import type { StackItem } from '../core/Stack';
import {
  addOrExtendStatus,
  type BlueflareStatus,
  type DotStatus,
  type FireStatus,
  type ForgetStatus,
  type ImbueStatus,
  type StifleStatus,
  type TetherStatus,
} from '../core/Status';
import { dist, stepTowards, type Vec2 } from '../core/utils';
import { isModifierWord, type WordId } from '../core/Words';
import { applyMindLightningStack, mindLightningDamage } from '../spells/mindLightning';
import {
  applyBlueflareStacks,
  applyDebuff,
  applyDot,
  applyFireStacks,
  applyInvisibility,
  applyStackingDot,
  applyStun,
  blinkstep,
  dash,
  dealDamage,
  desecrateGround,
  heal,
  type DealDamageOptions,
  type EffectContext,
} from './effects';

const R = (units: number): number => units * RANGE_UNIT;

export interface Hit {
  spec: string;
  type: DamageType;
}

/** Stacking rot shared by several spells: dice per stack, a cap, and how long a fresh stack lasts. */
export interface RotSpec {
  name: string;
  spec: string;
  max: number;
  turns: number;
  decay?: boolean;
  spread?: number;
  /** Whoever laid it heals for every tick. */
  drink?: boolean;
}

/** Blightburst's plague: it wanes when not refreshed and jumps to nearby enemies. */
export const BLIGHT: RotSpec = { name: 'Blight', spec: '1d3', max: 3, turns: 99, decay: true, spread: R(3) };

// -----------------------------------------------------------------------------
//  HIT EFFECTS — what a landed strike does to whoever it struck
// -----------------------------------------------------------------------------

export type HitEffect =
  | { k: 'damage'; spec: string; type: DamageType }
  /** A corrosive bite whose damage heals the drinker in full. */
  | { k: 'drain'; spec: string }
  /** A drain that scales: corrosive equal to `pct` of what the strike dealt (rounded up), healing the drinker in full. */
  | { k: 'siphon'; pct: number }
  /** The drinker heals everything the strike itself dealt. */
  | { k: 'lifesteal' }
  | { k: 'root'; turns: number; chance?: number }
  | { k: 'stun'; turns: number; chance?: number }
  | { k: 'slow'; pct: number; turns: number }
  /** Corroded armour: the victim takes this much more from every hit. */
  | { k: 'pitted'; amount: number; turns: number }
  | {
      k: 'dot';
      name: string;
      /** Dice per tick; or `pct`: each tick deals that share of what the strike dealt (rounded up). */
      spec?: string;
      pct?: number;
      turns: number;
      type?: DamageType;
      drink?: boolean;
      barbed?: boolean;
      /** Every tick also stifles the bearer's next action. */
      stifles?: boolean;
      /** Every tick turns the bearer a quarter circle around whoever laid it. */
      orbit?: boolean;
      /** Every tick roots the bearer until its next turn. */
      roots?: boolean;
    }
  | { k: 'rot'; rot: RotSpec }
  | { k: 'tether'; px: number; turns: number; mutual?: boolean }
  /** The victim spins a quarter turn around the striker; `onSlam` runs if a wall or the field edge stops it, `orElse` if not. */
  | { k: 'orbit'; slam?: Hit; onSlam?: HitEffect[]; orElse?: HitEffect[] }
  | { k: 'veilSelf'; turns: number }
  /** The victim's next declared action other than moving fails, costing it `spec` corrosive (`drink`: the stifler heals for it). */
  | { k: 'stifle'; chance?: number; spec?: string; drink?: boolean }
  /** Foul the ground around the victim (desecration rules: harms affected units only; `drink`: the striker heals for it). */
  | { k: 'foul'; radius: number; turns: number; spec: string; carried?: boolean; drink?: boolean }
  | { k: 'wither'; amount: number; cap: number }
  | { k: 'noHeal'; turns: number }
  /** Only against units Desecrate may harm. */
  | { k: 'affected'; then: HitEffect[] }
  /** Hit and run: the striker dashes this far straight away from the victim. */
  | { k: 'dashAway'; px: number }
  /** A mind left at `at` sanity or less breaks and the unit dies. */
  | { k: 'breakMind'; at: number }
  /** Branch on whether the victim already carries a damage-over-time. */
  | { k: 'ifDot'; then: HitEffect[]; else?: HitEffect[] }
  /** Every damage-over-time on the victim lasts this much longer. */
  | { k: 'deepen'; turns: number }
  /** The victim is pushed `cm` straight away from the striker; `slam` runs if a wall or the field edge stops it. */
  | { k: 'push'; cm: number; slam?: HitEffect[] }
  /** The victim is dragged up to `cm` toward the striker. */
  | { k: 'pull'; cm: number }
  /** The victim forgets `count` random words for `turns`. */
  | { k: 'forget'; count: number; turns: number }
  | { k: 'fire'; stacks: number }
  | { k: 'blueflare'; stacks: number }
  /** Only against a victim standing in a shadow. */
  | { k: 'inShadow'; then: HitEffect[] }
  /** Branch on whether the victim is burning. */
  | { k: 'ifBurning'; then: HitEffect[]; else?: HitEffect[] }
  /** Lightning leaps from the victim to the nearest other unit in reach but the striker; only the drinker's enemies with `foes`. */
  | { k: 'arc'; radius: number; hits: Hit[]; foes?: boolean }
  /** A Mindconduct bolt: a stack, then `spec` sanity, 50% more for every stack after the first. */
  | { k: 'mindBolt'; spec: string }
  /** Lightning on the victim: it takes the hits and Fire, and every other unit in reach is thrown `cm` away from it. */
  | { k: 'thunderclap'; radius: number; cm: number; hits: Hit[]; fire?: number }
  /** Reap stacks: the victim dies at or below its Reap count. `inShadow` instead when it stands in a shadow. */
  | { k: 'reap'; stacks: number; inShadow?: number }
  /** The victim dies at `at` health or less (+2 per Reap). */
  | { k: 'execute'; at: number }
  /** These land on the striker instead: the price some gear asks. */
  | { k: 'self'; then: HitEffect[] }
  /** The striker teleports this far straight away from the victim. */
  | { k: 'blinkAway'; px: number }
  /** Only in a fight's first `rounds` rounds. */
  | { k: 'early'; rounds: number; then: HitEffect[] }
  /** The victim's Fire pulses at once. */
  | { k: 'pulseFire' }
  /** Sanity equal to the victim's Fire stacks, at least 1. */
  | { k: 'fireSanity' }
  /** Branch on whether the victim is at half its sanity or less. */
  | { k: 'ifShaken'; then: HitEffect[]; else?: HitEffect[] }
  /** The Lightning gamble: roll 1d6, a 1 runs `low`, a 6 runs `high`, anything else `mid`. */
  | { k: 'gamble'; low?: HitEffect[]; mid?: HitEffect[]; high?: HitEffect[] }
  /** The striker slips a quarter circle around the victim. */
  | { k: 'flank' }
  /** The striker dashes to the victim's side. */
  | { k: 'closeIn' }
  /** Splinters: every other unit within `radius` of the victim, never the striker, takes the hits; only the drinker's enemies with `foes`. */
  | { k: 'shrapnel'; radius: number; hits: Hit[]; foes?: boolean }
  /** Branch on whether the victim is rooted. */
  | { k: 'ifRooted'; then: HitEffect[]; else?: HitEffect[] }
  /** Stoning, a stage at a time: slowed 50% for 3 turns, then rooted for 2, then stunned for 2 with 1d6 shatter. */
  | { k: 'petrify' }
  /** The weapon the victim holds is shackled for the fight: it cannot be put away and deals half damage. */
  | { k: 'sabotage' };

export interface Strike {
  striker: Mage;
  victim: Mage;
  /** What the strike itself dealt, for lifesteal. */
  dealt: number;
  /** Who drinks a drain: a minion's summoner, otherwise the striker. */
  drinker: Mage;
  ctx: EffectContext;
}

const QUIET: DealDamageOptions = { canMiss: false, noImpactFx: true };
const STONING_KEY = 'debuff:kit-stoning';

/** Who a drain feeds: the drinker, the summon that drew it (`via`), and a drinking summon's summoner. */
export function drainFed(game: GameState, drinker: Mage, via?: Mage): Mage[] {
  const fed = [drinker];
  if (via && via !== drinker && via.isSummon) fed.push(via);
  const lord = drinker.isSummon && drinker.summonOwnerIndex != null ? game.mages[drinker.summonOwnerIndex] : undefined;
  if (lord && !fed.includes(lord)) fed.push(lord);
  return fed.filter((m) => m.alive);
}

export function drink(game: GameState, drinker: Mage, amount: number, via?: Mage): void {
  if (amount <= 0) return;
  for (const m of drainFed(game, drinker, via)) heal(game.quietContext(m, m), m, amount);
}

/** A body forced movement can reach: alive, in this world, riding nothing. */
function shovable(game: GameState, m: Mage): boolean {
  return m.alive && !game.isUnreachable(m) && m.attachedToIndex == null;
}

/** Push `victim` `cm` straight away from `from`, by force. Returns whether it slammed. */
function pushFrom(game: GameState, mover: Mage, victim: Mage, from: Vec2, cm: number): boolean {
  if (!shovable(game, victim) || cm <= 0) return false;
  const dx = victim.x - from.x;
  const dy = victim.y - from.y;
  const len = Math.hypot(dx, dy);
  const dir = len < 0.5 ? { x: 1, y: 0 } : { x: dx / len, y: dy / len };
  return game.forceMove(mover, victim, { x: victim.x + dir.x * R(cm), y: victim.y + dir.y * R(cm) });
}

/** Drag `victim` up to `cm` toward `to`, never past it. Returns whether it slammed. */
function drawToward(game: GameState, mover: Mage, victim: Mage, to: Vec2, cm: number): boolean {
  if (!shovable(game, victim) || cm <= 0) return false;
  const dest = stepTowards(victim.pos, to, R(cm));
  if (dist(dest, victim.pos) < 0.5) return false;
  return game.forceMove(mover, victim, dest);
}

/** `a` and `b` trade places (a lift: walls and bodies do not stop it); `b` was moved by force. */
function swapBodies(game: GameState, mover: Mage, a: Mage, b: Mage): boolean {
  for (const m of [a, b]) {
    if (!shovable(game, m) || game.isImmovable(m)) return false;
    if (m.displacementImmune && m.team !== mover.team) return false;
  }
  const pa = { ...a.pos };
  const pb = { ...b.pos };
  a.x = pb.x;
  a.y = pb.y;
  b.x = pa.x;
  b.y = pa.y;
  game.notifyMageRelocation(a, pa, a.pos, false);
  game.notifyMageRelocation(b, pb, b.pos, false);
  game.updateAttachedScarabs();
  game.log(`${a.name} and ${b.name} trade places.`);
  game.lawShoved(mover, b);
  return true;
}

interface Clap {
  hits: Hit[];
  /** Fire set on the struck unit. */
  fire?: number;
  radius: number;
  cm: number;
  /** Fire set on everyone the clap throws. */
  splashFire?: number;
}

/** Lightning strikes `victim`; the thunderclap throws every other unit near it away from it. */
function thunderclapOn(game: GameState, from: Mage, victim: Mage, clap: Clap): void {
  void game.vfxSink?.lightningBolt?.({ x: victim.x, y: victim.y - R(4) }, victim.pos);
  const ctx = game.quietContext(from, victim);
  hitAll(game, ctx, victim, clap.hits);
  if (clap.fire && victim.alive) applyFireStacks(ctx, victim, clap.fire);
  const thrown = game.mages.filter(
    (m) => m.alive && m !== victim && dist(m.pos, victim.pos) <= clap.radius + m.bodyRadius()
  );
  for (const m of thrown) {
    pushFrom(game, from, m, victim.pos, clap.cm);
    if (clap.splashFire && m.alive) applyFireStacks(game.quietContext(from, m), m, clap.splashFire);
  }
}

export function runHitEffects(strike: Strike, effects: readonly HitEffect[]): void {
  const { striker, victim, drinker, ctx } = strike;
  const game = ctx.game;
  const roll = (spec: string): number => game.rng.roll(spec).total;
  for (const e of effects) {
    if (!victim.alive && e.k !== 'foul' && e.k !== 'lifesteal' && e.k !== 'dashAway' && e.k !== 'self' && e.k !== 'blinkAway' && e.k !== 'shrapnel') continue;
    switch (e.k) {
      case 'damage':
        dealDamage(ctx, victim, dmg(roll(e.spec), e.type), QUIET);
        break;
      case 'drain':
        drink(game, drinker, dealDamage(ctx, victim, dmg(roll(e.spec), 'corrosive'), QUIET), striker);
        break;
      case 'siphon': {
        const amount = Math.ceil(strike.dealt * e.pct);
        if (amount > 0) drink(game, drinker, dealDamage(ctx, victim, dmg(amount, 'corrosive'), QUIET), striker);
        break;
      }
      case 'lifesteal':
        drink(game, drinker, strike.dealt, striker);
        break;
      case 'root':
        if (!e.chance || game.rng.chance(e.chance)) applyStun(ctx, victim, { duration: e.turns, type: 'movement' });
        break;
      case 'stun':
        if (!e.chance || game.rng.chance(e.chance)) applyStun(ctx, victim, { duration: e.turns, type: 'full' });
        break;
      case 'slow':
        applyDebuff(ctx, victim, {
          name: 'Etched',
          key: 'debuff:kit-etched',
          duration: e.turns,
          mods: { moveRange: -Math.round(MOVE_RANGE * e.pct) },
        });
        break;
      case 'pitted':
        applyDebuff(ctx, victim, { name: 'Pitted', key: 'debuff:pitted', duration: e.turns, mods: { damageTaken: e.amount } });
        break;
      case 'dot':
        if (e.pct != null && strike.dealt <= 0) break;
        applyDot(ctx, victim, {
          name: e.name,
          key: `dot:kit:${e.name}`,
          duration: e.turns,
          damage: dmg(e.pct != null ? Math.ceil(strike.dealt * e.pct) : 0, e.type ?? 'corrosive'),
          damageSpec: e.pct != null ? undefined : e.spec,
          lifestealToIndex: e.drink ? game.mages.indexOf(drinker) : undefined,
          extendOnPierce: e.barbed ? { minAmount: 1, chanceBelow: 1, maxDuration: 4 } : undefined,
          stifleOnTick: e.stifles,
          orbitSource: e.orbit,
          stunChance: e.roots ? 1 : undefined,
          stunType: e.roots ? 'movement' : undefined,
        });
        break;
      case 'rot':
        applyRot(ctx, victim, e.rot, drinker);
        break;
      case 'tether': {
        const owner = game.mages.indexOf(drinker);
        game.tether(owner, victim, striker, e.px, e.turns);
        if (e.mutual) game.tether(owner, striker, victim, e.px, e.turns);
        break;
      }
      case 'orbit': {
        const turn = game.orbitAround(victim, striker.pos, game.rng.chance(0.5));
        if (turn.slammed) slamInto(ctx, victim, e.slam);
        const branch = turn.slammed ? e.onSlam : e.orElse;
        if (branch) runHitEffects(strike, branch);
        break;
      }
      case 'veilSelf':
        applyInvisibility(ctx, striker, { duration: e.turns, mode: 'partial' });
        break;
      case 'stifle':
        if (!e.chance || game.rng.chance(e.chance)) applyStifle(ctx, victim, { spec: e.spec, drink: e.drink });
        break;
      case 'foul':
        if (!game.isDesecrationAffected(victim) && victim.alive) break;
        desecrateGround(ctx, victim.pos, {
          name: 'Fouled Wound',
          radius: e.radius,
          turns: e.turns,
          blocksHealing: true,
          lifesteal: e.drink,
          carrierIndex: e.carried && victim.alive ? game.mages.indexOf(victim) : undefined,
          ticks: [{ spec: e.spec, type: 'corrosive' }],
        });
        break;
      case 'wither':
        game.wither(victim, e.amount, e.cap);
        break;
      case 'noHeal':
        applyDebuff(ctx, victim, { name: 'Festering', key: 'debuff:kit-no-heal', duration: e.turns, mods: {}, healMult: 0 });
        break;
      case 'affected':
        if (game.isDesecrationAffected(victim)) runHitEffects(strike, e.then);
        break;
      case 'dashAway':
        if (striker.alive && striker !== victim) {
          dash(ctx, striker, { direction: { x: striker.x - victim.x, y: striker.y - victim.y }, distance: e.px });
        }
        break;
      case 'breakMind':
        breakMind(game, drinker, victim, e.at);
        break;
      case 'ifDot': {
        const branch = victim.statuses.some((s) => s.kind === 'dot') ? e.then : e.else;
        if (branch) runHitEffects(strike, branch);
        break;
      }
      case 'deepen':
        for (const s of victim.statuses) if (s.kind === 'dot') s.duration += e.turns;
        break;
      case 'push':
        if (pushFrom(game, ctx.caster, victim, striker.pos, e.cm) && e.slam) runHitEffects(strike, e.slam);
        break;
      case 'pull':
        drawToward(game, ctx.caster, victim, striker.pos, e.cm);
        break;
      case 'forget':
        forgetWords(game, victim, e.count, e.turns);
        break;
      case 'fire':
        applyFireStacks(ctx, victim, e.stacks);
        break;
      case 'blueflare':
        applyBlueflareStacks(ctx, victim, e.stacks);
        break;
      case 'inShadow':
        if (game.isInShadow(victim)) runHitEffects(strike, e.then);
        break;
      case 'ifBurning': {
        const branch = stacksOf(victim, 'fire') > 0 ? e.then : e.else;
        if (branch) runHitEffects(strike, branch);
        break;
      }
      case 'arc': {
        const allow = e.foes ? (m: Mage): boolean => m.team !== drinker.team : undefined;
        const next = nearestOther(game, victim, e.radius, [victim, striker], allow);
        if (!next) break;
        void game.vfxSink?.lightningBolt?.(victim.pos, next.pos);
        hitAll(game, game.quietContext(ctx.caster, next), next, e.hits);
        break;
      }
      case 'mindBolt':
        mindBolt(game, drinker, victim, e.spec);
        break;
      case 'thunderclap':
        thunderclapOn(game, ctx.caster, victim, { hits: e.hits, fire: e.fire, radius: e.radius, cm: e.cm });
        break;
      case 'reap':
        game.applyReap(victim, e.inShadow != null && game.isInShadow(victim) ? e.inShadow : e.stacks, drinker);
        break;
      case 'execute':
        game.executeTarget(drinker, victim, e.at);
        break;
      case 'self':
        if (striker.alive) runHitEffects({ ...strike, victim: striker }, e.then);
        break;
      case 'blinkAway':
        if (striker.alive && striker !== victim) {
          blinkstep(ctx, striker, { direction: { x: striker.x - victim.x, y: striker.y - victim.y }, distance: e.px });
        }
        break;
      case 'early':
        if (game.round <= e.rounds) runHitEffects(strike, e.then);
        break;
      case 'pulseFire':
        game.pulseFire(victim);
        break;
      case 'fireSanity':
        dealDamage(ctx, victim, dmg(Math.max(1, stacksOf(victim, 'fire')), 'sanity'), QUIET);
        break;
      case 'ifShaken': {
        const branch = shaken(victim) ? e.then : e.else;
        if (branch) runHitEffects(strike, branch);
        break;
      }
      case 'gamble': {
        const roll = game.rng.die(6);
        game.log(`Lightning gamble: ${roll === 1 ? 'misfire' : roll === 6 ? 'surge' : 'steady'} (${roll}).`);
        const branch = roll === 1 ? e.low : roll === 6 ? e.high : e.mid;
        if (branch) runHitEffects(strike, branch);
        break;
      }
      case 'flank':
        if (striker.alive && striker !== victim) game.orbitAround(striker, victim.pos, game.rng.chance(0.5));
        break;
      case 'closeIn':
        if (striker.alive && striker !== victim) rushToward(game, striker, striker, victim, Infinity);
        break;
      case 'shrapnel':
        for (const m of game.mages) {
          if (!m.alive || m === victim || m === striker || game.isUnreachable(m)) continue;
          if ((e.foes && m.team === drinker.team) || dist(m.pos, victim.pos) > e.radius + m.bodyRadius()) continue;
          hitAll(game, game.quietContext(ctx.caster, m), m, e.hits);
        }
        break;
      case 'ifRooted': {
        const branch = victim.isStunned('movement') ? e.then : e.else;
        if (branch) runHitEffects(strike, branch);
        break;
      }
      case 'petrify':
        if (victim.isStunned('movement')) {
          applyStun(ctx, victim, { duration: 2, type: 'full' });
          dealDamage(ctx, victim, dmg(roll('1d6'), 'shatter'), QUIET);
          victim.statuses = victim.statuses.filter((s) => s.key !== STONING_KEY);
        } else if (victim.statuses.some((s) => s.key === STONING_KEY)) {
          applyStun(ctx, victim, { duration: 2, type: 'movement' });
        } else {
          applyDebuff(ctx, victim, {
            name: 'Stiffening',
            key: STONING_KEY,
            duration: 3,
            mods: { moveRange: -Math.round(MOVE_RANGE * 0.5) },
          });
        }
        break;
      case 'sabotage': {
        const held = victim.activeWeaponId() ?? victim.hands[0];
        if (!held || victim.sabotagedItems.has(held)) break;
        victim.sabotagedItems.add(held);
        game.log(`${victim.name}'s ${getItem(held).name} is shackled.`);
        break;
      }
    }
  }
}

/** At half its sanity or less (the mindless never are). */
function shaken(m: Mage): boolean {
  return m.alive && !m.isImmuneTo('sanity') && m.maxSanity > 0 && m.sanity * 2 <= m.maxSanity;
}

/** Fire or Blueflare stacks `m` carries. */
function stacksOf(m: Mage, kind: 'fire' | 'blueflare'): number {
  return (m.statuses.find((s) => s.kind === kind) as FireStatus | BlueflareStatus | undefined)?.stacks ?? 0;
}

/** A Mindconduct bolt: the victim gains a stack, then takes `spec` sanity, 50% more per stack after the first. */
function mindBolt(game: GameState, from: Mage, victim: Mage, spec: string): number {
  if (!victim.alive) return 0;
  const stacks = applyMindLightningStack(victim);
  const amount = Math.ceil(mindLightningDamage(game.rng.roll(spec).total, stacks));
  return dealDamage(game.quietContext(from, victim), victim, dmg(amount, 'sanity'), QUIET);
}

/** A mind at `threshold` sanity or less breaks and the unit dies. The mindless are spared. */
export function breakMind(game: GameState, from: Mage, victim: Mage, threshold: number): boolean {
  if (!victim.alive || threshold <= 0 || victim.isImmuneTo('sanity') || victim.sanity > threshold) return false;
  game.log(`${victim.name}'s mind breaks.`);
  dealDamage(game.quietContext(from, victim), victim, dmg(victim.sanity, 'sanity'), { ...QUIET, trueDamage: true });
  return true;
}

export function applyRot(ctx: EffectContext, victim: Mage, rot: RotSpec, drinker: Mage = ctx.caster): void {
  applyStackingDot(ctx, victim, {
    name: rot.name,
    key: `dot:${rot.name}`,
    damage: dmg(0, 'corrosive'),
    perStackSpec: rot.spec,
    maxStacks: rot.max,
    refreshDuration: rot.turns,
    decayPerTick: rot.decay,
    infectRadius: rot.spread,
    lifestealToIndex: rot.drink ? ctx.game.mages.indexOf(drinker) : undefined,
  });
}

// -----------------------------------------------------------------------------
//  PULSES — what happens around a unit at its owner's turn start
// -----------------------------------------------------------------------------

type PulseWho = 'foes' | 'others' | 'affected' | 'rooted';

export type PulseEffect =
  /** Every chosen unit in reach takes the hits; `drink` heals the owner (and the minion) for the corrosive part. */
  | { k: 'aura'; radius: number; who: PulseWho; hits: Hit[]; drink?: boolean }
  /** Enemies in reach lose their veils; those that had one take the hits. */
  | { k: 'unveil'; radius: number; hits: Hit[] }
  /** Enemies in reach move `pct` slower for a while. */
  | { k: 'mire'; radius: number; pct: number; turns: number }
  | { k: 'orbit'; radius: number; who: 'foes' | 'others'; hits?: Hit[]; slam?: Hit; drink?: boolean }
  | { k: 'drinkTethered'; spec: string }
  /** Every unit in reach carrying a damage-over-time spins around it. */
  | { k: 'orbitAfflicted'; radius: number }
  /** Affected units in reach gain a stack of plague rot and cannot be healed for 2 turns. */
  | { k: 'rotAffected'; radius: number; drink?: boolean }
  /** Stifle the nearest enemy in reach, or every rooted / afflicted one; a failed action costs it `spec` corrosive. */
  | { k: 'stifle'; radius: number; who: 'nearest' | 'rooted' | 'afflicted'; spec?: string; drink?: boolean }
  | { k: 'kindle'; radius: number; who: PulseWho; blueflare?: number; fire?: number }
  /** Lightning minions: their summoning roll sets reach and count. */
  | { k: 'synapse' }
  | { k: 'stormArc' }
  /** The nearest enemy in reach is drawn `cm` toward it, then takes the hits, Blueflare and forgetting. */
  | { k: 'lure'; radius: number; cm: number; hits?: Hit[]; blueflare?: number; forget?: number }
  /** Every chosen unit in reach takes the hits and Fire, then is thrown `cm` away from it. */
  | { k: 'wave'; radius: number; cm: number; who: PulseWho; hits?: Hit[]; fire?: number }
  /** Every chosen unit in reach is drawn `cm` toward it, then takes the hits. */
  | { k: 'whirl'; radius: number; cm: number; who: PulseWho; hits?: Hit[] }
  /** It trades places with the nearest enemy in reach, which then takes the hits. */
  | { k: 'swap'; radius: number; hits?: Hit[] }
  /** Enemies in reach are carried up to `cm` back toward where they began their last turn. */
  | { k: 'rewind'; radius: number; cm: number }
  /** Enemies in reach standing in a shadow forget a random word until the end of their next turn. */
  | { k: 'forgetInShadow'; radius: number }
  /** Lightning water minions: the eel's shock, the conducting bolt and the thundercloud. */
  | { k: 'shock' }
  | { k: 'conductBolt' }
  | { k: 'thunderhead' }
  /** Umbral Coil: a shadow bolt into a random unit in reach, doubled on one standing in a shadow. */
  | { k: 'darkBolt' }
  /** Every other unit in reach takes the hits, then its Fire pulses at once, or it catches 1 Fire. */
  | { k: 'pyre'; radius: number; hits: Hit[] }
  /** Grave Shade: it steps out of its side's shadow beside the nearest enemy standing in one. */
  | { k: 'stalk' }
  /** Ashcloud: lightning sets off every burning unit in reach, or kindles the nearest enemy. */
  | { k: 'ignite' }
  /** The least sane other unit in reach takes 1d6 sanity (2d6 in a shadow) and forgets a word. */
  | { k: 'haunt'; radius: number }
  /** Every other unit in reach takes 1d6 sanity; one left at half sanity or less gains `reap` Reap. */
  | { k: 'wail'; radius: number; reap: number }
  /** Lightning-wave minions: each rolls the Lightning gamble every turn. */
  | { k: 'ballLightning' }
  | { k: 'liveWire' }
  | { k: 'hellspark' }
  /** Assassins: it dashes up to `cm` (all the way without) to the nearest chosen unit in reach, then strikes it if it got there. */
  | { k: 'lunge'; radius: number; cm?: number; who?: 'foes' | 'others'; hits?: Hit[]; then?: HitEffect[] }
  /** Sentries: it shoots the nearest enemy in reach. */
  | { k: 'shoot'; radius: number; hits: Hit[]; then?: HitEffect[] }
  /** These land on every chosen unit in reach (only the nearest with `nearest`). */
  | { k: 'hex'; radius: number; who: PulseWho; then: HitEffect[]; nearest?: boolean }
  /**
   * Wardens: these land on the enemy nearest to one of the owner's units within `radius` of it, if it stands within
   * `reach` of that unit (every such enemy with `all`; only those carrying a damage over time with `afflicted`).
   */
  | { k: 'guard'; radius: number; reach: number; then: HitEffect[]; all?: boolean; afflicted?: boolean };

/** Plaguewell's rot: the stack desecrations hand out. */
const PLAGUE_ROT: RotSpec = { name: 'Plague Rot', spec: '1d3', max: 4, turns: 3, decay: true };
/** Plague rot that feeds whoever laid it. */
const THIRSTING_PLAGUE: RotSpec = { ...PLAGUE_ROT, name: 'Thirsting Plague', drink: true };

function pulseTargets(game: GameState, source: Mage, owner: Mage, radius: number, who: PulseWho): Mage[] {
  return game.mages.filter((m) => {
    if (!m.alive || m === source || dist(m.pos, source.pos) > radius + m.bodyRadius()) return false;
    if (who === 'foes') return m.team !== owner.team;
    if (who === 'rooted') return m.team !== owner.team && m.isStunned('movement');
    if (who === 'affected') return game.isDesecrationAffected(m);
    return m !== owner;
  });
}

/** Every hit in turn; returns what they dealt, or only the part of type `only`. */
function hitAll(game: GameState, ctx: EffectContext, victim: Mage, hits: readonly Hit[], only?: DamageType): number {
  let dealt = 0;
  for (const hit of hits) {
    if (!victim.alive) break;
    const landed = dealDamage(ctx, victim, dmg(game.rng.roll(hit.spec).total, hit.type), { ...QUIET, aoe: true });
    if (!only || hit.type === only) dealt += landed;
  }
  return dealt;
}

export function runPulse(game: GameState, source: Mage, owner: Mage, effects: readonly PulseEffect[]): void {
  for (const e of effects) {
    if (!source.alive) return;
    switch (e.k) {
      case 'aura':
        for (const victim of pulseTargets(game, source, owner, e.radius, e.who)) {
          const dealt = hitAll(game, game.quietContext(source, victim), victim, e.hits, e.drink ? 'corrosive' : undefined);
          if (e.drink) drink(game, owner, dealt, source);
        }
        break;
      case 'unveil':
        for (const victim of pulseTargets(game, source, owner, e.radius, 'foes')) {
          if (!game.isVeiled(victim)) continue;
          hitAll(game, game.quietContext(source, victim), victim, e.hits);
          victim.statuses = victim.statuses.filter((s) => s.kind !== 'invisibility');
          game.log(`${source.name} strips ${victim.name}'s veil away.`);
        }
        break;
      case 'mire':
        for (const victim of pulseTargets(game, source, owner, e.radius, 'foes')) {
          applyDebuff(game.quietContext(owner, victim), victim, {
            name: 'Mired',
            key: 'debuff:kit-mired',
            duration: e.turns,
            mods: { moveRange: -Math.round(MOVE_RANGE * e.pct) },
          });
        }
        break;
      case 'orbit':
        for (const victim of pulseTargets(game, source, owner, e.radius, e.who)) {
          const ctx = game.quietContext(source, victim);
          const turn = game.orbitAround(victim, source.pos, game.rng.chance(0.5));
          const dealt = e.hits ? hitAll(game, ctx, victim, e.hits, e.drink ? 'corrosive' : undefined) : 0;
          if (e.drink) drink(game, owner, dealt, source);
          if (turn.slammed) slamInto(ctx, victim, e.slam);
        }
        break;
      case 'drinkTethered':
        for (const victim of game.tetheredTo(source)) {
          drink(game, owner, hitAll(game, game.quietContext(source, victim), victim, [{ spec: e.spec, type: 'corrosive' }]), source);
        }
        break;
      case 'orbitAfflicted':
        for (const victim of game.mages) {
          if (!victim.alive || victim === source || victim === owner) continue;
          if (dist(victim.pos, source.pos) > e.radius + victim.bodyRadius()) continue;
          if (!victim.statuses.some((s) => s.kind === 'dot')) continue;
          game.orbitAround(victim, source.pos, game.rng.chance(0.5));
        }
        break;
      case 'rotAffected':
        for (const victim of pulseTargets(game, source, owner, e.radius, 'affected')) {
          const ctx = game.quietContext(e.drink ? source : owner, victim);
          applyRot(ctx, victim, e.drink ? THIRSTING_PLAGUE : PLAGUE_ROT, owner);
          applyDebuff(ctx, victim, { name: 'Festering', key: 'debuff:kit-no-heal', duration: 2, mods: {}, healMult: 0 });
        }
        break;
      case 'stifle': {
        const foes = pulseTargets(game, source, owner, e.radius, e.who === 'rooted' ? 'rooted' : 'foes')
          .filter((m) => e.who !== 'afflicted' || m.statuses.some((s) => s.kind === 'dot'))
          .sort((a, b) => dist(a.pos, source.pos) - dist(b.pos, source.pos));
        for (const victim of e.who === 'nearest' ? foes.slice(0, 1) : foes) {
          applyStifle(game.quietContext(source, victim), victim, { spec: e.spec, drink: e.drink });
        }
        break;
      }
      case 'kindle':
        for (const victim of pulseTargets(game, source, owner, e.radius, e.who)) {
          const ctx = game.quietContext(owner, victim);
          if (e.blueflare) applyBlueflareStacks(ctx, victim, e.blueflare);
          if (e.fire && victim.alive) applyFireStacks(ctx, victim, e.fire);
        }
        break;
      case 'synapse':
        synapseBolts(game, source, owner);
        break;
      case 'stormArc':
        stormArc(game, source, owner);
        break;
      case 'lure': {
        const foe = nearestPulseFoe(game, source, owner, e.radius);
        if (!foe) break;
        const ctx = game.quietContext(owner, foe);
        drawToward(game, owner, foe, source.pos, e.cm);
        if (e.hits) hitAll(game, ctx, foe, e.hits);
        if (e.blueflare && foe.alive) applyBlueflareStacks(ctx, foe, e.blueflare);
        if (e.forget) forgetWords(game, foe, e.forget, 2);
        break;
      }
      case 'wave':
        for (const victim of pulseTargets(game, source, owner, e.radius, e.who)) {
          const ctx = game.quietContext(owner, victim);
          if (e.hits) hitAll(game, ctx, victim, e.hits);
          if (e.fire && victim.alive) applyFireStacks(ctx, victim, e.fire);
          pushFrom(game, owner, victim, source.pos, e.cm);
        }
        break;
      case 'whirl':
        for (const victim of pulseTargets(game, source, owner, e.radius, e.who)) {
          drawToward(game, owner, victim, source.pos, e.cm);
          if (e.hits) hitAll(game, game.quietContext(owner, victim), victim, e.hits);
        }
        break;
      case 'swap': {
        const foe = nearestPulseFoe(game, source, owner, e.radius);
        if (foe && swapBodies(game, owner, source, foe) && e.hits) {
          hitAll(game, game.quietContext(owner, foe), foe, e.hits);
        }
        break;
      }
      case 'rewind':
        for (const victim of pulseTargets(game, source, owner, e.radius, 'foes')) {
          const start = victim.turnStartState;
          if (start) drawToward(game, owner, victim, start, e.cm);
        }
        break;
      case 'forgetInShadow':
        for (const victim of pulseTargets(game, source, owner, e.radius, 'foes')) {
          if (game.isInShadow(victim)) forgetWords(game, victim, 1, 2);
        }
        break;
      case 'shock':
        shock(game, source, owner);
        break;
      case 'conductBolt':
        conductBolt(game, source, owner);
        break;
      case 'thunderhead':
        thunderhead(game, source, owner);
        break;
      case 'darkBolt':
        darkBolt(game, source, owner);
        break;
      case 'pyre':
        for (const victim of pulseTargets(game, source, owner, e.radius, 'others')) {
          const ctx = game.quietContext(owner, victim);
          hitAll(game, ctx, victim, e.hits);
          if (!victim.alive) continue;
          if (stacksOf(victim, 'fire') > 0) game.pulseFire(victim);
          else applyFireStacks(ctx, victim, 1);
        }
        break;
      case 'stalk':
        stalk(game, source, owner);
        break;
      case 'ignite':
        ignite(game, source, owner);
        break;
      case 'haunt': {
        const victim = pulseTargets(game, source, owner, e.radius, 'others')
          .filter((m) => !game.isUnreachable(m) && !m.isImmuneTo('sanity') && m.maxSanity > 0)
          .sort((a, b) => a.sanity - b.sanity || dist(a.pos, source.pos) - dist(b.pos, source.pos))[0];
        if (!victim) break;
        hitAll(game, game.quietContext(owner, victim), victim, [
          { spec: game.isInShadow(victim) ? '2d6' : '1d6', type: 'sanity' },
        ]);
        forgetWords(game, victim, 1, 2);
        break;
      }
      case 'wail':
        for (const victim of pulseTargets(game, source, owner, e.radius, 'others')) {
          hitAll(game, game.quietContext(owner, victim), victim, [{ spec: '1d6', type: 'sanity' }]);
          if (shaken(victim)) game.applyReap(victim, e.reap, owner);
        }
        break;
      case 'ballLightning':
        ballLightning(game, source, owner);
        break;
      case 'liveWire':
        liveWire(game, source, owner);
        break;
      case 'hellspark':
        hellspark(game, source, owner);
        break;
      case 'lunge':
        lunge(game, source, owner, e);
        break;
      case 'shoot': {
        const foe = nearestPulseFoe(game, source, owner, e.radius);
        if (foe) strikeFrom(game, source, owner, foe, e.hits, e.then);
        break;
      }
      case 'hex': {
        const caught = pulseTargets(game, source, owner, e.radius, e.who)
          .sort((a, b) => dist(a.pos, source.pos) - dist(b.pos, source.pos));
        for (const victim of e.nearest ? caught.slice(0, 1) : caught) strikeFrom(game, source, owner, victim, [], e.then);
        break;
      }
      case 'guard': {
        const wards = game.mages.filter(
          (m) => m.alive && m !== source && m.team === owner.team && dist(m.pos, source.pos) <= e.radius + m.bodyRadius()
        );
        const threats = game.mages
          .filter((m) => m.alive && m.team !== owner.team && !game.isUnreachable(m))
          .filter((m) => !e.afflicted || m.statuses.some((s) => s.kind === 'dot'))
          .map((m) => ({ m, gap: Math.min(...wards.map((w) => dist(w.pos, m.pos) - m.bodyRadius())) }))
          .filter((t) => t.gap <= e.reach)
          .sort((a, b) => a.gap - b.gap);
        for (const t of e.all ? threats : threats.slice(0, 1)) strikeFrom(game, source, owner, t.m, [], e.then);
        break;
      }
    }
  }
}

/** A minion's own strike on `victim`: the hits, then what they set off (its summoner drinks). */
function strikeFrom(game: GameState, source: Mage, owner: Mage, victim: Mage, hits: readonly Hit[] = [], then?: readonly HitEffect[]): void {
  const ctx = game.quietContext(source, victim);
  const dealt = hitAll(game, ctx, victim, hits);
  if (then?.length) runHitEffects({ striker: source, victim, dealt, drinker: owner, ctx }, then);
}

/** An assassin's lunge: to the nearest chosen unit in reach, striking it once it stands beside it. */
function lunge(game: GameState, source: Mage, owner: Mage, e: Extract<PulseEffect, { k: 'lunge' }>): void {
  const prey = game.mages
    .filter((m) => m.alive && m !== source && m !== owner && !game.isUnreachable(m) && (e.who === 'others' || m.team !== owner.team))
    .filter((m) => dist(m.pos, source.pos) <= e.radius + m.bodyRadius())
    .sort((a, b) => dist(a.pos, source.pos) - dist(b.pos, source.pos) || game.mages.indexOf(a) - game.mages.indexOf(b))[0];
  if (!prey) return;
  rushToward(game, owner, source, prey, e.cm ? R(e.cm) : Infinity);
  const beside = dist(source.pos, prey.pos) <= source.bodyRadius() + prey.bodyRadius() + R(0.5);
  if (beside && (e.hits || e.then)) strikeFrom(game, source, owner, prey, e.hits, e.then);
}

/** `mover` dashes up to `maxPx` toward `target`, stopping short of its body. */
function rushToward(game: GameState, owner: Mage, mover: Mage, target: Mage, maxPx: number): void {
  const room = dist(mover.pos, target.pos) - (target.bodyRadius() + mover.bodyRadius() + 2);
  if (room <= 0.5 || game.isImmovable(mover)) return;
  dash(game.quietContext(owner, mover), mover, { toPoint: target.pos, distance: Math.min(maxPx, room) });
}

/** `mover` appears right beside `target`, on its own side of it (a leap, not a walk). */
function stepBeside(game: GameState, mover: Mage, target: Mage): boolean {
  const gap = target.bodyRadius() + mover.bodyRadius() + 2;
  if (game.isImmovable(mover) || dist(target.pos, mover.pos) <= gap + 1) return false;
  const from = { ...mover.pos };
  const to = stepTowards(target.pos, mover.pos, gap);
  mover.x = to.x;
  mover.y = to.y;
  game.notifyMageRelocation(mover, from, mover.pos, false);
  game.updateAttachedScarabs();
  return true;
}

/** Ball Lightning: it runs to the nearest enemy, however far, and bursts; raised on a natural 18+, twice as wide. */
function ballLightning(game: GameState, source: Mage, owner: Mage): void {
  const foe = nearestPulseFoe(game, source, owner, Infinity);
  if (!foe) return;
  rushToward(game, owner, source, foe, Infinity);
  const radius = R(source.lightningSurge ? 4 : 2);
  const caught = game.mages.filter(
    (m) =>
      m.alive && m !== source && m !== owner && !game.isUnreachable(m) && dist(m.pos, source.pos) <= radius + m.bodyRadius()
  );
  game.log(`${source.name} bursts${source.lightningSurge ? ' wide' : ''}.`);
  const spec = plus('1d10', Math.floor(sparkOf(source) / 6));
  for (const m of caught) {
    const ctx = game.quietContext(owner, m);
    hitAll(game, ctx, m, [{ spec, type: 'heat' }]);
    if (m.alive) applyFireStacks(ctx, m, 1);
  }
}

/** Live Wire: it lashes a random unit in reach and leaps to it; a 1 lashes its owner, a 6 everyone in reach. */
function liveWire(game: GameState, source: Mage, owner: Mage): void {
  const power = sparkOf(source);
  const bonus = Math.floor(power / 6);
  const roll = game.rng.die(6);
  const lash = (m: Mage): void => {
    void game.vfxSink?.lightningBolt?.(source.pos, m.pos);
    hitAll(game, game.quietContext(owner, m), m, [
      { spec: plus('1d6', bonus), type: 'sanity' },
      { spec: plus('1d4', bonus), type: 'heat' },
    ]);
  };
  if (roll === 1) {
    game.log(`${source.name} lashes its own master.`);
    if (owner.alive) lash(owner);
    return;
  }
  const near = strikeable(game, source, owner, R(Math.max(2, power / 2)));
  if (roll === 6) {
    for (const m of near) lash(m);
    return;
  }
  if (near.length === 0) return;
  const victim = game.rng.pick(near);
  lash(victim);
  if (victim.alive && stepBeside(game, source, victim)) game.log(`${source.name} leaps to ${victim.name}.`);
}

/**
 * Hellspark: it zips 1d3 times, 1d6cm each, roughly toward the nearest enemy (up to 45° off),
 * and flares over everyone near it after every zip, its owner included.
 */
function hellspark(game: GameState, source: Mage, owner: Mage): void {
  const bonus = Math.floor(sparkOf(source) / 6);
  const zips = game.rng.die(3);
  game.log(`${source.name} zips ${zips} time${zips === 1 ? '' : 's'}.`);
  for (let i = 0; i < zips && source.alive; i++) {
    const foe = nearestPulseFoe(game, source, owner, Infinity);
    const swerve = (game.rng.float() - 0.5) * (Math.PI / 2);
    const angle = foe ? Math.atan2(foe.y - source.y, foe.x - source.x) + swerve : game.rng.float() * Math.PI * 2;
    const cm = game.rng.die(6);
    if (!game.isImmovable(source)) {
      dash(game.quietContext(owner, source), source, { direction: { x: Math.cos(angle), y: Math.sin(angle) }, distance: R(cm) });
    }
    const caught = game.mages.filter(
      (m) => m.alive && m !== source && !game.isUnreachable(m) && dist(m.pos, source.pos) <= R(2) + m.bodyRadius()
    );
    for (const m of caught) {
      const ctx = game.quietContext(owner, m);
      hitAll(game, ctx, m, [
        { spec: plus('1d4', bonus), type: 'heat' },
        { spec: plus('1d4', bonus), type: 'sanity' },
      ]);
      if (m.alive) applyFireStacks(ctx, m, 1);
    }
  }
}

/** Umbral Coil: a shadow bolt into a random unit in reach, never its owner; a shadow opens where it lands. */
function darkBolt(game: GameState, source: Mage, owner: Mage): void {
  const power = sparkOf(source);
  const struck = strikeable(game, source, owner, R(Math.max(2, power / 2)));
  if (struck.length === 0) return;
  const victim = game.rng.pick(struck);
  void game.vfxSink?.lightningBolt?.(source.pos, victim.pos);
  const rolled = game.rng.roll(plus('1d6', Math.floor(power / 6))).total;
  const amount = game.isInShadow(victim) ? rolled * 2 : rolled;
  dealDamage(game.quietContext(owner, victim), victim, dmg(amount, 'shadow'), { ...QUIET, aoe: true });
  game.addShadow(victim.pos, owner.team);
}

/** Grave Shade: out of its side's shadow, beside the nearest enemy standing in one. */
function stalk(game: GameState, source: Mage, owner: Mage): void {
  if (game.isImmovable(source)) return;
  const pools = game.shadowsOf(owner.team);
  const prey = game.mages
    .filter((m) => m.alive && m.team !== owner.team && !game.isUnreachable(m) && pools.some((p) => dist(p, m.pos) <= p.radius))
    .sort((a, b) => dist(a.pos, source.pos) - dist(b.pos, source.pos) || game.mages.indexOf(a) - game.mages.indexOf(b))[0];
  if (!prey) return;
  if (stepBeside(game, source, prey)) game.log(`${source.name} steps out of the dark beside ${prey.name}.`);
}

/** Ashcloud: every burning unit in reach flares at once and takes shadow; with none, the nearest enemy catches fire. */
function ignite(game: GameState, source: Mage, owner: Mage): void {
  const power = sparkOf(source);
  const near = strikeable(game, source, owner, R(Math.max(2, power / 2)));
  const burning = near.filter((m) => stacksOf(m, 'fire') > 0);
  for (const m of burning) {
    void game.vfxSink?.lightningBolt?.(source.pos, m.pos);
    game.pulseFire(m);
    if (m.alive) hitAll(game, game.quietContext(owner, m), m, [{ spec: '1d4', type: 'shadow' }]);
  }
  if (burning.length > 0) return;
  const foe = near
    .filter((m) => m.team !== owner.team)
    .sort((a, b) => dist(a.pos, source.pos) - dist(b.pos, source.pos))[0];
  if (!foe) return;
  void game.vfxSink?.lightningBolt?.(source.pos, foe.pos);
  const ctx = game.quietContext(owner, foe);
  hitAll(game, ctx, foe, [{ spec: plus('1d6', Math.floor(power / 6)), type: 'heat' }]);
  if (foe.alive) applyFireStacks(ctx, foe, 2);
}

/** The nearest enemy of `owner` within `radius` of `source` that is still in this world. */
function nearestPulseFoe(game: GameState, source: Mage, owner: Mage, radius: number): Mage | undefined {
  return pulseTargets(game, source, owner, radius, 'foes')
    .filter((m) => !game.isUnreachable(m))
    .sort((a, b) => dist(a.pos, source.pos) - dist(b.pos, source.pos) || game.mages.indexOf(a) - game.mages.indexOf(b))[0];
}

/** Units a lightning minion may strike: anyone in reach but itself and its owner. */
function strikeable(game: GameState, source: Mage, owner: Mage, reach: number): Mage[] {
  return game.mages.filter(
    (m) =>
      m.alive && m !== source && m !== owner && !game.isUnreachable(m) && dist(m.pos, source.pos) <= reach + m.bodyRadius()
  );
}

/** Storm Eel: lightning leaps to the nearest enemy in reach and throws it back (blue keeps it off your side). */
function shock(game: GameState, source: Mage, owner: Mage): void {
  const power = sparkOf(source);
  const victim = strikeable(game, source, owner, R(Math.max(2, power / 2)))
    .filter((m) => m.team !== owner.team)
    .sort((a, b) => dist(a.pos, source.pos) - dist(b.pos, source.pos))[0];
  if (!victim) return;
  void game.vfxSink?.lightningBolt?.(source.pos, victim.pos);
  hitAll(game, game.quietContext(owner, victim), victim, [{ spec: plus('1d6', Math.floor(power / 6)), type: 'heat' }]);
  pushFrom(game, owner, victim, source.pos, 2);
}

/** Brine Synapse: a bolt into the most charged enemy mind in reach, which it throws back. */
function conductBolt(game: GameState, source: Mage, owner: Mage): void {
  const reach = R(Math.max(2, sparkOf(source) / 2));
  const victim = pulseTargets(game, source, owner, reach, 'foes')
    .filter((m) => !game.isUnreachable(m))
    .sort((a, b) => b.lightningMindStacks - a.lightningMindStacks || dist(a.pos, source.pos) - dist(b.pos, source.pos))[0];
  if (!victim) return;
  void game.vfxSink?.lightningBolt?.(source.pos, victim.pos);
  mindBolt(game, owner, victim, '1d3');
  pushFrom(game, owner, victim, source.pos, 2);
}

/** Thundercloud: lightning strikes a random unit in reach, never its owner, and the clap throws the rest back. */
function thunderhead(game: GameState, source: Mage, owner: Mage): void {
  const power = sparkOf(source);
  const struck = strikeable(game, source, owner, R(Math.max(2, power / 2)));
  if (struck.length === 0) return;
  const victim = game.rng.pick(struck);
  game.log(`${source.name} strikes ${victim.name}.`);
  thunderclapOn(game, owner, victim, {
    hits: [{ spec: plus('1d6', Math.floor(power / 6)), type: 'heat' }],
    fire: 1,
    radius: R(2),
    cm: 2,
  });
}

/** The Lightning power a minion was raised with. */
function sparkOf(m: Mage): number {
  return m.lightningMindPower > 0 ? m.lightningMindPower : 10;
}

/** Synapse: bolts into nearby minds, likelier toward heavier Mindconduct, or into itself. */
function synapseBolts(game: GameState, source: Mage, owner: Mage): void {
  const power = sparkOf(source);
  const reach = R(Math.max(1, power / 2));
  const bolts = Math.max(1, Math.floor(power / 8));
  for (let i = 0; i < bolts && source.alive; i++) {
    const foes = pulseTargets(game, source, owner, reach, 'foes');
    const weights = foes.map((m) => 1 + m.lightningMindStacks);
    let roll = game.rng.die(1 + weights.reduce((sum, w) => sum + w, 0)) - 1;
    let victim: Mage = source;
    for (let j = 0; j < foes.length && roll > 0; j++) {
      roll -= weights[j];
      if (roll <= 0) victim = foes[j];
    }
    void game.vfxSink?.lightningBolt?.(source.pos, victim.pos);
    mindBolt(game, owner, victim, '1d3');
  }
}

/**
 * Stormmind Wisp: a 1 overloads it and it detonates (its death burst); otherwise it arcs
 * into units around it, enemies first, setting them alight. A 6 makes every arc strike twice.
 */
function stormArc(game: GameState, source: Mage, owner: Mage): void {
  const power = sparkOf(source);
  const gamble = game.rng.die(6);
  if (gamble === 1) {
    game.log(`${source.name} overloads.`);
    dealDamage(game.quietContext(owner, source), source, dmg(Math.max(1, source.hp), 'heat'), { ...QUIET, trueDamage: true });
    return;
  }
  const arcs = Math.max(1, Math.floor(power / 5));
  const reach = R(Math.max(4, power / 2));
  const bonus = Math.floor(power / 6);
  const enemyFirst = (m: Mage): number => (m.team !== owner.team ? 0 : 1);
  const struck = game.mages
    .filter((m) => m.alive && m !== source && dist(m.pos, source.pos) <= reach + m.bodyRadius())
    .sort((a, b) => enemyFirst(a) - enemyFirst(b) || dist(a.pos, source.pos) - dist(b.pos, source.pos))
    .slice(0, arcs);
  const strikes = gamble === 6 ? 2 : 1;
  if (strikes > 1) game.log(`${source.name} crackles: every arc strikes twice.`);
  for (const victim of struck) {
    for (let i = 0; i < strikes && victim.alive; i++) {
      void game.vfxSink?.lightningBolt?.(source.pos, victim.pos);
      const ctx = game.quietContext(owner, victim);
      hitAll(game, ctx, victim, [{ spec: plus('1d6', bonus), type: 'heat' }, { spec: plus('1d4', bonus), type: 'sanity' }]);
      if (!victim.alive) break;
      applyFireStacks(ctx, victim, 1);
      if (victim.alive) applyBlueflareStacks(ctx, victim, 1);
    }
  }
}

// -----------------------------------------------------------------------------
//  DEATH — what a minion leaves behind
// -----------------------------------------------------------------------------

export type DeathEffect =
  /** Everything in reach (only enemies with `foes`) takes the hits, then the listed afflictions; `drink` feeds the owner the corrosive part. */
  | {
      k: 'burst';
      radius: number;
      hits: Hit[];
      foes?: boolean;
      rot?: RotSpec;
      stun?: number;
      root?: number;
      stifle?: boolean;
      fire?: number;
      blueflare?: number;
      reap?: number;
      drink?: boolean;
    }
  | { k: 'foul'; radius: number; turns: number; ticks: Hit[]; drink?: boolean }
  | { k: 'rotAffected'; radius: number; stacks: number; drink?: boolean }
  /** Every enemy in reach takes its Blueflare pulse at once. */
  | { k: 'flare'; radius: number }
  /** A shadow opens where it fell, for its owner's side. */
  | { k: 'shade' };

export function runDeath(game: GameState, corpse: Mage, owner: Mage, effects: readonly DeathEffect[]): void {
  for (const e of effects) {
    switch (e.k) {
      case 'burst':
        for (const victim of game.mages) {
          if (!victim.alive || victim === corpse || dist(victim.pos, corpse.pos) > e.radius + victim.bodyRadius()) continue;
          if (e.foes && victim.team === owner.team) continue;
          const ctx = game.quietContext(owner, victim);
          const dealt = hitAll(game, ctx, victim, e.hits, 'corrosive');
          if (e.drink && victim !== owner) drink(game, owner, dealt);
          if (!victim.alive) continue;
          if (e.rot) applyRot(ctx, victim, e.rot, owner);
          if (e.stun) applyStun(ctx, victim, { duration: e.stun, type: 'full' });
          if (e.root) applyStun(ctx, victim, { duration: e.root, type: 'movement' });
          if (e.stifle) applyStifle(ctx, victim);
          if (e.fire) applyFireStacks(ctx, victim, e.fire);
          if (e.blueflare && victim.alive) applyBlueflareStacks(ctx, victim, e.blueflare);
          if (e.reap && victim.alive) game.applyReap(victim, e.reap, owner);
        }
        game.log(`${corpse.name} bursts.`);
        break;
      case 'foul':
        desecrateGround(game.quietContext(owner, corpse), corpse.pos, {
          name: `${corpse.name}'s Remains`,
          radius: e.radius,
          turns: e.turns,
          blocksHealing: true,
          lifesteal: e.drink,
          ticks: e.ticks,
        });
        break;
      case 'rotAffected':
        for (const victim of game.mages) {
          if (!game.isDesecrationAffected(victim) || dist(victim.pos, corpse.pos) > e.radius + victim.bodyRadius()) continue;
          const ctx = game.quietContext(owner, victim);
          for (let i = 0; i < e.stacks; i++) applyRot(ctx, victim, e.drink ? THIRSTING_PLAGUE : PLAGUE_ROT);
        }
        break;
      case 'flare':
        for (const victim of game.mages) {
          if (!victim.alive || victim.team === owner.team || dist(victim.pos, corpse.pos) > e.radius + victim.bodyRadius()) continue;
          game.pulseBlueflare(victim);
        }
        break;
      case 'shade':
        game.addShadow(corpse.pos, owner.team);
        game.log(`A shadow spreads where ${corpse.name} fell.`);
        break;
    }
  }
}

// -----------------------------------------------------------------------------
//  LIFE — minions
// -----------------------------------------------------------------------------

export interface MinionDef {
  name: string;
  hp: number;
  /** Range units per step. */
  move: number;
  armor?: number;
  melee?: { spec: string; type: DamageType; reach?: number };
  pacifist?: boolean;
  immune?: DamageType[];
  /** Its owner's side within this reach (not the minion itself) cannot be singled out by enemies; areas still hit. */
  shroud?: number;
  /** Chance that an enemy single-target spell or attack aimed at its owner strikes it instead. */
  decoy?: number;
  /** Whenever a hit lands on it, every enemy within `radius` of it takes these (and is rooted for `root` turns). */
  struck?: { radius: number; hits: Hit[]; root?: number };
  /** Hits of these types on any other unit within `radius` of it deal `bonus` more, plus 1 per `perPower` Lightning power. */
  amplify?: { radius: number; types: DamageType[]; bonus: number; perPower?: number };
  onHit?: HitEffect[];
  pulse?: PulseEffect[];
  death?: DeathEffect[];
}

const corrosive = (spec: string): Hit => ({ spec, type: 'corrosive' });
const pierce = (spec: string): Hit => ({ spec, type: 'pierce' });
/** Grave Stalker's wound on one of the affected: deeper, and past mending for a while. */
const GRAVE_WOUND: HitEffect = { k: 'affected', then: [{ k: 'damage', spec: '1d6', type: 'pierce' }, { k: 'noHeal', turns: 2 }] };
/** Vampire Bat's bleed: a corrosive curse that feeds its master. */
const BLOODLETTING: HitEffect = { k: 'dot', name: 'Bloodletting', spec: '1d3', turns: 3, drink: true };
/** Fetter Leech's shackles: Rotting Shackles that feed whoever laid them. */
const THIRSTING_SHACKLES: RotSpec = { name: 'Thirsting Shackles', spec: '1d2', max: 4, turns: 3, drink: true };
/** Blight that feeds whoever laid it. */
const THIRSTING_BLIGHT: RotSpec = { ...BLIGHT, name: 'Thirsting Blight', drink: true };

export const MINIONS: Record<string, MinionDef> = {
  'gag-mite': {
    name: 'Gag Mite', hp: 6, move: 6, melee: { spec: '1d3', type: 'corrosive' },
    onHit: [{ k: 'stifle', chance: 0.34, spec: '1d3' }],
  },
  'tar-slime': {
    name: 'Tar Slime', hp: 9, move: 4, melee: { spec: '1d3', type: 'corrosive' },
    onHit: [{ k: 'tether', px: R(3), turns: 2 }],
  },
  'caustic-fume': {
    name: 'Caustic Fume', hp: 6, move: 6, pacifist: true, immune: ['pierce'], shroud: R(2),
    pulse: [{ k: 'aura', radius: R(2), who: 'foes', hits: [corrosive('1d3')] }],
  },
  'slag-brute': {
    name: 'Slag Brute', hp: 12, move: 3, armor: 1, melee: { spec: '1d6', type: 'shatter' },
    onHit: [{ k: 'damage', spec: '1d3', type: 'corrosive' }, { k: 'stun', turns: 2, chance: 0.25 }],
  },
  'blood-tick': {
    name: 'Blood Tick', hp: 5, move: 6, melee: { spec: '1d4', type: 'corrosive' },
    onHit: [{ k: 'lifesteal' }],
  },
  'blight-walker': {
    name: 'Blight Walker', hp: 14, move: 4, melee: { spec: '1d6', type: 'corrosive' },
  },
  lockjaw: {
    name: 'Lockjaw', hp: 8, move: 5, melee: { spec: '1d3', type: 'corrosive' },
    onHit: [{ k: 'root', turns: 2 }],
    pulse: [{ k: 'stifle', radius: R(2), who: 'rooted' }],
  },
  hushwraith: {
    name: 'Hushwraith', hp: 5, move: 6, melee: { spec: '1d3', type: 'corrosive' },
    onHit: [{ k: 'stifle', chance: 0.5, spec: '1d3' }],
  },
  'drill-wasp': {
    name: 'Drill Wasp', hp: 5, move: 8, melee: { spec: '1d6', type: 'pierce', reach: R(2) },
    onHit: [{ k: 'damage', spec: '1d3', type: 'corrosive' }],
  },
  grindstone: {
    name: 'Grindstone', hp: 12, move: 3, pacifist: true,
    pulse: [{
      k: 'orbit', radius: R(2.5), who: 'foes',
      hits: [{ spec: '1d6', type: 'shatter' }, corrosive('1d3')],
      slam: { spec: '2d6', type: 'shatter' },
    }],
  },
  'lamprey-vortex': {
    name: 'Lamprey Vortex', hp: 7, move: 6, melee: { spec: '1d4', type: 'corrosive' },
    onHit: [{ k: 'lifesteal' }],
    pulse: [{ k: 'orbit', radius: R(2), who: 'others', hits: [corrosive('1d3')], drink: true }],
  },
  'hex-wheel': {
    name: 'Hex Wheel', hp: 8, move: 5, melee: { spec: '1d3', type: 'corrosive' },
    onHit: [{ k: 'dot', name: 'Wheel Rot', spec: '1d4', turns: 4 }],
    pulse: [{ k: 'orbitAfflicted', radius: R(3) }],
  },
  mistweaver: {
    name: 'Mistweaver', hp: 6, move: 6, pacifist: true, shroud: R(3),
    pulse: [{ k: 'mire', radius: R(3), pct: 0.3, turns: 2 }],
  },
  'rivet-beetle': {
    name: 'Rivet Beetle', hp: 8, move: 5, melee: { spec: '1d4', type: 'pierce', reach: R(3) },
    onHit: [{ k: 'damage', spec: '1d3', type: 'corrosive' }, { k: 'root', turns: 2 }],
  },
  'clay-warden': {
    name: 'Clay Warden', hp: 12, move: 3, armor: 1, melee: { spec: '1d4', type: 'shatter' },
    onHit: [{ k: 'root', turns: 2 }, { k: 'pitted', amount: 1, turns: 2 }],
  },
  lamprey: {
    name: 'Lamprey', hp: 6, move: 6, melee: { spec: '1d4', type: 'corrosive' },
    onHit: [{ k: 'lifesteal' }, { k: 'tether', px: R(2), turns: 2 }],
    pulse: [{ k: 'drinkTethered', spec: '1d3' }],
  },
  'fetter-ghoul': {
    name: 'Fetter Ghoul', hp: 8, move: 4, melee: { spec: '1d3', type: 'corrosive' },
    onHit: [
      { k: 'rot', rot: { name: 'Rotting Shackles', spec: '1d2', max: 4, turns: 3 } },
      { k: 'slow', pct: 0.3, turns: 2 },
    ],
  },
  shardling: {
    name: 'Shardling', hp: 6, move: 6, melee: { spec: '1d3', type: 'corrosive' },
    death: [{ k: 'burst', radius: R(2), hits: [{ spec: '2d4', type: 'shatter' }, corrosive('1d4')] }],
  },
  'shade-leech': {
    name: 'Shade Leech', hp: 5, move: 7, melee: { spec: '1d4', type: 'corrosive' },
    onHit: [{ k: 'lifesteal' }],
  },
  'plague-moth': {
    name: 'Plague Moth', hp: 4, move: 8, melee: { spec: '1d2', type: 'corrosive' },
    onHit: [{ k: 'dot', name: 'Moth Rot', spec: '1d3', turns: 4 }],
  },
  'bore-beetle': {
    name: 'Bore Beetle', hp: 10, move: 4, armor: 1, melee: { spec: '1d8', type: 'pierce' },
    onHit: [{ k: 'damage', spec: '1d4', type: 'corrosive' }],
  },
  'blood-gnat': {
    name: 'Blood Gnat', hp: 4, move: 8, melee: { spec: '1d4', type: 'pierce', reach: R(2) },
    onHit: [{ k: 'drain', spec: '1d3' }],
  },
  'barb-archer': {
    name: 'Barb Archer', hp: 5, move: 5, melee: { spec: '1d4', type: 'pierce', reach: R(10) },
    onHit: [{ k: 'rot', rot: { name: 'Barb Venom', spec: '1d3', max: 3, turns: 3 } }],
  },
  'plague-archer': {
    name: 'Plague Archer', hp: 10, move: 4, melee: { spec: '1d6', type: 'pierce', reach: R(12) },
    onHit: [{ k: 'affected', then: [{ k: 'foul', radius: R(2), turns: 3, spec: '1d6', carried: true }] }],
  },
  bonegnawer: {
    name: 'Bonegnawer', hp: 10, move: 4, melee: { spec: '1d6', type: 'shatter' },
    onHit: [{ k: 'drain', spec: '1d3' }, { k: 'stun', turns: 2, chance: 0.2 }],
  },
  'blight-toad': {
    name: 'Blight Toad', hp: 8, move: 4, melee: { spec: '1d4', type: 'shatter' },
    death: [{ k: 'burst', radius: R(2.5), hits: [corrosive('2d4')], rot: BLIGHT }],
  },
  'grave-colossus': {
    name: 'Grave Colossus', hp: 18, move: 3, armor: 1, melee: { spec: '2d6', type: 'shatter' },
    pulse: [{ k: 'aura', radius: R(2), who: 'affected', hits: [{ spec: '1d6', type: 'shatter' }] }],
    death: [{ k: 'foul', radius: R(3), turns: 4, ticks: [corrosive('1d6'), { spec: '1d6', type: 'shatter' }] }],
  },
  'gorging-maw': {
    name: 'Gorging Maw', hp: 16, move: 3, melee: { spec: '2d6', type: 'corrosive' },
    onHit: [{ k: 'lifesteal' }],
    pulse: [{ k: 'aura', radius: R(3), who: 'affected', hits: [corrosive('1d6')], drink: true }],
  },
  'rot-herald': {
    name: 'Rot Herald', hp: 12, move: 4, pacifist: true,
    pulse: [{ k: 'rotAffected', radius: R(3) }],
    death: [{ k: 'rotAffected', radius: R(4), stacks: 2 }],
  },

  // ---- Veil wave: shrouds, disruptors and hit-and-run ----
  'murk-wisp': {
    name: 'Murk Wisp', hp: 4, move: 7, melee: { spec: '1d2', type: 'shadow' },
    onHit: [{ k: 'dot', name: 'Murk Curse', spec: '1d3', turns: 4, type: 'shadow' }, { k: 'dashAway', px: R(2) }],
  },
  'siphon-wraith': {
    name: 'Siphon Wraith', hp: 6, move: 6, pacifist: true,
    pulse: [{ k: 'aura', radius: R(2), who: 'foes', hits: [corrosive('1d3')], drink: true }],
  },
  'phantom-lancer': {
    name: 'Phantom Lancer', hp: 5, move: 7, melee: { spec: '1d4', type: 'pierce', reach: R(3) },
    onHit: [{ k: 'dashAway', px: R(2) }],
  },
  'mirror-knight': {
    name: 'Mirror Knight', hp: 9, move: 5, melee: { spec: '1d6', type: 'shatter' },
    pulse: [{ k: 'unveil', radius: R(3), hits: [{ spec: '1d3', type: 'shatter' }] }],
    death: [{ k: 'burst', radius: R(2), hits: [], foes: true, stun: 2 }],
  },
  'hush-sprite': {
    name: 'Hush Sprite', hp: 4, move: 7, pacifist: true,
    pulse: [{ k: 'stifle', radius: R(4), who: 'nearest' }],
  },
  'night-leech': {
    name: 'Night Leech', hp: 6, move: 7, melee: { spec: '1d4', type: 'corrosive' },
    onHit: [{ k: 'lifesteal' }, { k: 'dot', name: 'Drinking Curse', spec: '1d3', turns: 3, drink: true }],
  },
  'hexbow-phantom': {
    name: 'Hexbow Phantom', hp: 5, move: 5, melee: { spec: '1d4', type: 'pierce', reach: R(12) },
    onHit: [{ k: 'dot', name: 'Hex Arrow', spec: '1d3', turns: 3, type: 'shadow' }],
  },
  'dread-sentinel': {
    name: 'Dread Sentinel', hp: 10, move: 4, armor: 1, melee: { spec: '1d6', type: 'shatter' },
    onHit: [{ k: 'dot', name: 'Dread', spec: '1d3', turns: 3, type: 'shadow' }],
  },
  'muttering-shade': {
    name: 'Muttering Shade', hp: 6, move: 6, pacifist: true,
    pulse: [{ k: 'stifle', radius: R(3), who: 'afflicted' }],
  },
  'veil-spider': {
    name: 'Veil Spider', hp: 6, move: 6, melee: { spec: '1d3', type: 'shadow' },
    onHit: [{ k: 'root', turns: 2 }, { k: 'dot', name: 'Spider Venom', spec: '1d3', turns: 3, type: 'shadow' }],
  },
  'gloom-bat': {
    name: 'Gloom Bat', hp: 4, move: 9, melee: { spec: '1d4', type: 'pierce', reach: R(2) },
    onHit: [{ k: 'drain', spec: '1d3' }, { k: 'dashAway', px: R(2) }],
  },
  'gloom-brute': {
    name: 'Gloom Brute', hp: 10, move: 4, armor: 1, melee: { spec: '1d6', type: 'shatter' },
    onHit: [{ k: 'drain', spec: '1d3' }],
  },
  'hush-leech': {
    name: 'Hush Leech', hp: 5, move: 6, melee: { spec: '1d4', type: 'corrosive' },
    onHit: [{ k: 'lifesteal' }, { k: 'stifle', chance: 0.34 }],
  },
  'shroud-leech': {
    name: 'Shroud Leech', hp: 6, move: 6, shroud: R(2), melee: { spec: '1d3', type: 'corrosive' },
    onHit: [{ k: 'lifesteal' }, { k: 'root', turns: 2 }],
    pulse: [{ k: 'aura', radius: R(3), who: 'rooted', hits: [corrosive('1d4')], drink: true }],
  },
  'mirror-lancer': {
    name: 'Mirror Lancer', hp: 8, move: 5, melee: { spec: '1d8', type: 'pierce', reach: R(3) },
    death: [{ k: 'burst', radius: R(2), hits: [{ spec: '2d4', type: 'shatter' }], foes: true }],
  },
  'hush-archer': {
    name: 'Hush Archer', hp: 5, move: 5, melee: { spec: '1d4', type: 'pierce', reach: R(12) },
    onHit: [{ k: 'stifle', chance: 0.34 }],
  },
  'web-lurker': {
    name: 'Web Lurker', hp: 6, move: 6, melee: { spec: '1d4', type: 'pierce', reach: R(3) },
    onHit: [{ k: 'tether', px: R(3), turns: 2 }],
  },
  'shatter-wisp': {
    name: 'Shatter Wisp', hp: 5, move: 6, melee: { spec: '1d4', type: 'shatter' },
    death: [{ k: 'burst', radius: R(3), hits: [{ spec: '1d6', type: 'shatter' }], foes: true, stifle: true }],
  },
  'glass-warden': {
    name: 'Glass Warden', hp: 10, move: 4, armor: 1, shroud: R(2), melee: { spec: '1d4', type: 'shatter' },
    onHit: [{ k: 'root', turns: 2 }],
    death: [{ k: 'burst', radius: R(2), hits: [], foes: true, root: 2 }],
  },
  'gag-spider': {
    name: 'Gag Spider', hp: 6, move: 6, melee: { spec: '1d3', type: 'shadow' },
    onHit: [{ k: 'root', turns: 2 }, { k: 'stifle', chance: 0.34 }],
  },

  // ---- Mind wave: figments, burning thoughts, conducting minds and nightmares ----
  figment: {
    name: 'Figment', hp: 5, move: 7, pacifist: true, decoy: 0.5,
    struck: { radius: R(3), hits: [{ spec: '1d4', type: 'sanity' }] },
  },
  candlewight: {
    name: 'Candlewight', hp: 5, move: 6, pacifist: true, immune: ['heat'],
    pulse: [{ k: 'kindle', radius: R(3), who: 'foes', blueflare: 1 }],
    death: [{ k: 'flare', radius: R(6) }],
  },
  synapse: { name: 'Synapse', hp: 4, move: 7, pacifist: true, pulse: [{ k: 'synapse' }] },
  'stormmind-wisp': {
    name: 'Stormmind Wisp', hp: 6, move: 7, pacifist: true, pulse: [{ k: 'stormArc' }],
    death: [{ k: 'burst', radius: R(4), hits: [{ spec: '4d6', type: 'heat' }], fire: 3, blueflare: 3 }],
  },
  mare: {
    name: 'Mare', hp: 6, move: 7, immune: ['shadow'], melee: { spec: '1d4', type: 'sanity' },
    onHit: [{ k: 'dot', name: 'Nightmare', spec: '1d3', turns: 3, type: 'sanity' }, { k: 'breakMind', at: 4 }],
  },

  // ---- Water wave: currents, tides, sirens and storms ----
  undine: {
    name: 'Undine', hp: 5, move: 7, pacifist: true,
    pulse: [{ k: 'lure', radius: R(5), cm: 2, forget: 1 }],
  },
  drowner: {
    name: 'Drowner', hp: 7, move: 6, immune: ['shadow'], melee: { spec: '1d4', type: 'water' },
    onHit: [
      { k: 'pull', cm: 2 },
      { k: 'inShadow', then: [{ k: 'damage', spec: '1d4', type: 'shadow' }, { k: 'root', turns: 2 }] },
    ],
    death: [{ k: 'shade' }],
  },
  'riptide-spirit': {
    name: 'Riptide Spirit', hp: 6, move: 8, pacifist: true,
    pulse: [{ k: 'swap', radius: R(8), hits: [{ spec: '1d4', type: 'water' }] }],
  },
  geyser: {
    name: 'Geyser', hp: 7, move: 3, pacifist: true, immune: ['heat'],
    pulse: [{ k: 'wave', radius: R(3), cm: 2, who: 'foes', hits: [{ spec: '1d4', type: 'heat' }], fire: 1 }],
  },
  'storm-eel': { name: 'Storm Eel', hp: 5, move: 8, pacifist: true, pulse: [{ k: 'shock' }] },
  'drowned-thrall': {
    name: 'Drowned Thrall', hp: 7, move: 5, melee: { spec: '1d4', type: 'sanity' },
    onHit: [{ k: 'pull', cm: 2 }],
    death: [{ k: 'burst', radius: R(2), hits: [{ spec: '1d6', type: 'sanity' }], foes: true }],
  },
  'abyssal-eye': {
    name: 'Abyssal Eye', hp: 5, move: 6, pacifist: true, immune: ['shadow'],
    pulse: [{ k: 'forgetInShadow', radius: R(6) }],
  },
  'tide-clock': {
    name: 'Tide Clock', hp: 6, move: 6, pacifist: true,
    pulse: [{ k: 'rewind', radius: R(5), cm: 4 }],
  },
  'kettle-spirit': {
    name: 'Kettle Spirit', hp: 5, move: 6, pacifist: true, immune: ['heat'],
    pulse: [{ k: 'lure', radius: R(6), cm: 2, blueflare: 2 }],
    death: [{ k: 'flare', radius: R(4) }],
  },
  'brine-synapse': { name: 'Brine Synapse', hp: 4, move: 7, pacifist: true, pulse: [{ k: 'conductBolt' }] },
  siren: {
    name: 'Siren', hp: 5, move: 7, pacifist: true,
    pulse: [{ k: 'lure', radius: R(8), cm: 3, hits: [{ spec: '1d4', type: 'sanity' }] }],
  },
  'abyssal-maw': {
    name: 'Abyssal Maw', hp: 10, move: 3, immune: ['shadow'], melee: { spec: '1d6', type: 'sanity' },
    pulse: [{ k: 'whirl', radius: R(4), cm: 2, who: 'others', hits: [{ spec: '1d4', type: 'sanity' }] }],
    death: [{ k: 'burst', radius: R(3), hits: [{ spec: '2d4', type: 'sanity' }] }],
  },
  thundercloud: {
    name: 'Thundercloud', hp: 6, move: 6, pacifist: true, pulse: [{ k: 'thunderhead' }],
    death: [{ k: 'burst', radius: R(3), hits: [{ spec: '2d6', type: 'heat' }], fire: 1 }],
  },

  // ---- Shadow wave: amplifiers ----
  'umbral-coil': { name: 'Umbral Coil', hp: 5, move: 7, pacifist: true, immune: ['shadow'], pulse: [{ k: 'darkBolt' }] },
  'cinder-shade': {
    name: 'Cinder Shade', hp: 6, move: 5, pacifist: true, immune: ['heat', 'shadow'],
    pulse: [{ k: 'pyre', radius: R(3), hits: [{ spec: '1d4', type: 'shadow' }] }],
  },
  'wailing-shade': {
    name: 'Wailing Shade', hp: 6, move: 6, immune: ['shadow'], melee: { spec: '1d4', type: 'sanity' },
    onHit: [{ k: 'inShadow', then: [{ k: 'damage', spec: '1d6', type: 'sanity' }] }],
    pulse: [{ k: 'aura', radius: R(2), who: 'others', hits: [{ spec: '1d4', type: 'sanity' }] }],
  },
  'grave-shade': {
    name: 'Grave Shade', hp: 7, move: 6, immune: ['shadow'], melee: { spec: '1d4', type: 'shadow' },
    onHit: [{ k: 'reap', stacks: 1, inShadow: 3 }],
    pulse: [{ k: 'stalk' }],
    death: [{ k: 'burst', radius: R(3), hits: [], foes: true, reap: 2 }],
  },
  ashcloud: { name: 'Ashcloud', hp: 6, move: 6, pacifist: true, immune: ['heat'], pulse: [{ k: 'ignite' }] },
  'nerve-coil': {
    name: 'Nerve Coil', hp: 5, move: 6, pacifist: true,
    amplify: { radius: R(3), types: ['sanity'], bonus: 1, perPower: 8 },
    pulse: [{ k: 'aura', radius: R(3), who: 'others', hits: [{ spec: '1d4', type: 'sanity' }] }],
  },
  'pyre-wraith': {
    name: 'Pyre Wraith', hp: 7, move: 5, immune: ['heat', 'shadow'], melee: { spec: '1d4', type: 'heat' },
    onHit: [{ k: 'fire', stacks: 1 }, { k: 'damage', spec: '1d4', type: 'sanity' }],
    death: [{ k: 'burst', radius: R(3), hits: [{ spec: '1d6', type: 'sanity' }], fire: 2 }],
  },
  haunt: { name: 'Haunt', hp: 5, move: 7, pacifist: true, immune: ['shadow'], pulse: [{ k: 'haunt', radius: R(6) }] },
  banshee: { name: 'Banshee', hp: 6, move: 7, pacifist: true, immune: ['shadow'], pulse: [{ k: 'wail', radius: R(3), reap: 2 }] },

  // ---- Lightning wave: gamblers ----
  'ball-lightning': { name: 'Ball Lightning', hp: 3, move: 8, pacifist: true, immune: ['heat'], pulse: [{ k: 'ballLightning' }] },
  'live-wire': { name: 'Live Wire', hp: 4, move: 8, pacifist: true, pulse: [{ k: 'liveWire' }] },
  hellspark: { name: 'Hellspark', hp: 5, move: 6, pacifist: true, immune: ['heat'], pulse: [{ k: 'hellspark' }] },

  // ---- Pierce wave: archers, assassins and sentries ----
  'blade-dervish': {
    name: 'Blade Dervish', hp: 5, move: 7, melee: { spec: '1d4', type: 'pierce', reach: R(2) },
    pulse: [{ k: 'lunge', radius: R(5), hits: [pierce('1d4')], then: [{ k: 'orbit', slam: pierce('1d6') }] }],
  },
  'pin-archer': {
    name: 'Pin Archer', hp: 5, move: 5, melee: { spec: '1d4', type: 'pierce', reach: R(10) },
    onHit: [{ k: 'root', turns: 2 }],
  },
  scorpion: {
    name: 'Scorpion', hp: 10, move: 2, armor: 1, melee: { spec: '1d8', type: 'pierce', reach: R(14) },
    onHit: [{ k: 'shrapnel', radius: R(1.5), hits: [{ spec: '1d4', type: 'shatter' }], foes: true }],
  },
  'thorn-fiend': {
    name: 'Thorn Fiend', hp: 6, move: 6, melee: { spec: '1d4', type: 'pierce', reach: R(2) },
    onHit: [{ k: 'dot', name: 'Bleeding', spec: '1d3', turns: 3, type: 'pierce', barbed: true }],
    death: [{ k: 'burst', radius: R(2), hits: [pierce('2d4')] }],
  },
  'bloodfang-stalker': {
    name: 'Bloodfang Stalker', hp: 6, move: 7, melee: { spec: '1d4', type: 'pierce', reach: R(2) },
    onHit: [{ k: 'drain', spec: '1d3' }],
    pulse: [{ k: 'lunge', radius: R(6), hits: [pierce('1d4')], then: [{ k: 'drain', spec: '1d3' }] }],
  },
  'grave-stalker': {
    name: 'Grave Stalker', hp: 10, move: 6, melee: { spec: '1d8', type: 'pierce', reach: R(2) },
    onHit: [GRAVE_WOUND],
    pulse: [{ k: 'lunge', radius: R(8), hits: [pierce('1d8')], then: [GRAVE_WOUND] }],
  },
  'needle-sentry': {
    name: 'Needle Sentry', hp: 6, move: 3, pacifist: true,
    pulse: [{ k: 'shoot', radius: R(10), hits: [pierce('1d4')], then: [{ k: 'stifle' }] }],
  },
  'spinning-top': {
    name: 'Spinning Top', hp: 8, move: 6, pacifist: true,
    pulse: [
      { k: 'lunge', radius: R(6), cm: 4 },
      { k: 'orbit', radius: R(2), who: 'foes', hits: [pierce('1d6')], slam: { spec: '2d6', type: 'shatter' } },
    ],
  },
  'leech-dervish': {
    name: 'Leech Dervish', hp: 6, move: 7, melee: { spec: '1d4', type: 'pierce', reach: R(2) },
    onHit: [{ k: 'drain', spec: '1d3' }],
    pulse: [{ k: 'lunge', radius: R(6), hits: [pierce('1d4')], then: [{ k: 'drain', spec: '1d3' }, { k: 'flank' }] }],
  },
  'hooked-archer': {
    name: 'Hooked Archer', hp: 5, move: 5, melee: { spec: '1d4', type: 'pierce', reach: R(10) },
    onHit: [{ k: 'dot', name: 'Barbed Hook', spec: '1d3', turns: 3, type: 'pierce', orbit: true }],
  },
  'stake-warden': {
    name: 'Stake Warden', hp: 10, move: 4, armor: 1, melee: { spec: '1d8', type: 'pierce', reach: R(3) },
    onHit: [{ k: 'ifRooted', then: [{ k: 'damage', spec: '1d6', type: 'shatter' }] }, { k: 'root', turns: 2 }],
    death: [{ k: 'burst', radius: R(2), hits: [{ spec: '2d4', type: 'shatter' }], foes: true, root: 2 }],
  },
  'leech-harpooner': {
    name: 'Leech Harpooner', hp: 6, move: 5, melee: { spec: '1d4', type: 'pierce', reach: R(6) },
    onHit: [{ k: 'pull', cm: 2 }, { k: 'drain', spec: '1d3' }],
  },
  thornbinder: {
    name: 'Thornbinder', hp: 7, move: 5, melee: { spec: '1d4', type: 'pierce', reach: R(4) },
    onHit: [{ k: 'root', turns: 2 }, { k: 'dot', name: 'Thorns', spec: '1d3', turns: 3, type: 'pierce' }],
  },
  'marrow-archer': {
    name: 'Marrow Archer', hp: 5, move: 5, melee: { spec: '1d4', type: 'pierce', reach: R(12) },
    onHit: [{ k: 'drain', spec: '1d3' }, { k: 'shrapnel', radius: R(1.5), hits: [{ spec: '1d3', type: 'shatter' }], foes: true }],
  },
  shardhound: {
    name: 'Shardhound', hp: 7, move: 7, melee: { spec: '1d6', type: 'pierce', reach: R(2) },
    onHit: [{ k: 'dot', name: 'Splinters', spec: '1d4', turns: 3, type: 'shatter' }],
    death: [{ k: 'burst', radius: R(2), hits: [{ spec: '2d4', type: 'shatter' }] }],
  },
  'bone-thrower': {
    name: 'Bone Thrower', hp: 14, move: 3, armor: 1, melee: { spec: '2d6', type: 'pierce', reach: R(10) },
    onHit: [{ k: 'affected', then: [{ k: 'stun', turns: 2 }] }],
    death: [{ k: 'foul', radius: R(3), turns: 4, ticks: [pierce('1d6')] }],
  },
  'vampire-bat': {
    name: 'Vampire Bat', hp: 5, move: 9, melee: { spec: '1d4', type: 'pierce', reach: R(2) },
    onHit: [BLOODLETTING],
    pulse: [{ k: 'lunge', radius: R(6), who: 'others', hits: [pierce('1d4')], then: [BLOODLETTING] }],
  },
  'blood-harvester': {
    name: 'Blood Harvester', hp: 12, move: 5, melee: { spec: '2d4', type: 'pierce', reach: R(3) },
    onHit: [{ k: 'drain', spec: '1d4' }, { k: 'affected', then: [{ k: 'drain', spec: '2d4' }, { k: 'noHeal', turns: 2 }] }],
  },
  'thorn-archer': {
    name: 'Thorn Archer', hp: 8, move: 5, melee: { spec: '1d6', type: 'pierce', reach: R(12) },
    onHit: [
      { k: 'dot', name: 'Bleeding', spec: '1d4', turns: 3, type: 'pierce' },
      { k: 'affected', then: [{ k: 'noHeal', turns: 3 }] },
    ],
  },

  // ---- Drain wave: the Corrode minions, drinking what they deal ----
  'gag-leech': {
    name: 'Gag Leech', hp: 6, move: 6, melee: { spec: '1d3', type: 'corrosive' },
    onHit: [{ k: 'lifesteal' }, { k: 'stifle', chance: 0.34, spec: '1d3', drink: true }],
  },
  'blood-slime': {
    name: 'Blood Slime', hp: 9, move: 4, melee: { spec: '1d3', type: 'corrosive' },
    onHit: [{ k: 'lifesteal' }, { k: 'tether', px: R(3), turns: 2 }],
  },
  'leech-brute': {
    name: 'Leech Brute', hp: 12, move: 3, armor: 1, melee: { spec: '1d6', type: 'shatter' },
    onHit: [{ k: 'drain', spec: '1d3' }, { k: 'pitted', amount: 1, turns: 2 }],
  },
  'blood-idol': {
    name: 'Blood Idol', hp: 8, move: 5, pacifist: true,
    pulse: [{ k: 'aura', radius: R(3), who: 'others', hits: [corrosive('1d3')], drink: true }],
  },
  'blood-wight': {
    name: 'Blood Wight', hp: 14, move: 4, melee: { spec: '1d6', type: 'corrosive' },
    onHit: [{ k: 'lifesteal' }],
  },
  bloodjaw: {
    name: 'Bloodjaw', hp: 8, move: 5, melee: { spec: '1d3', type: 'corrosive' },
    onHit: [{ k: 'lifesteal' }, { k: 'root', turns: 2 }],
    pulse: [{ k: 'stifle', radius: R(2), who: 'rooted', spec: '1d3', drink: true }],
  },
  bloodmill: {
    name: 'Bloodmill', hp: 12, move: 3, pacifist: true,
    pulse: [{
      k: 'orbit', radius: R(2.5), who: 'foes', drink: true,
      hits: [{ spec: '1d6', type: 'shatter' }, corrosive('1d3')],
      slam: { spec: '2d6', type: 'shatter' },
    }],
  },
  'leech-wheel': {
    name: 'Leech Wheel', hp: 8, move: 5, melee: { spec: '1d3', type: 'corrosive' },
    onHit: [{ k: 'lifesteal' }, { k: 'dot', name: 'Drinking Wheel', spec: '1d4', turns: 4, drink: true }],
    pulse: [{ k: 'orbitAfflicted', radius: R(3) }],
  },
  'blood-warden': {
    name: 'Blood Warden', hp: 12, move: 3, armor: 1, melee: { spec: '1d4', type: 'shatter' },
    onHit: [{ k: 'drain', spec: '1d3' }, { k: 'root', turns: 2 }, { k: 'pitted', amount: 1, turns: 2 }],
  },
  'fetter-leech': {
    name: 'Fetter Leech', hp: 8, move: 4, melee: { spec: '1d3', type: 'corrosive' },
    onHit: [{ k: 'lifesteal' }, { k: 'rot', rot: THIRSTING_SHACKLES }, { k: 'slow', pct: 0.3, turns: 2 }],
  },
  'gorged-toad': {
    name: 'Gorged Toad', hp: 8, move: 4, melee: { spec: '1d4', type: 'shatter' },
    onHit: [{ k: 'drain', spec: '1d3' }],
    death: [{ k: 'burst', radius: R(2.5), hits: [corrosive('2d4')], rot: THIRSTING_BLIGHT, drink: true }],
  },
  'marrow-colossus': {
    name: 'Marrow Colossus', hp: 18, move: 3, armor: 1, melee: { spec: '2d6', type: 'shatter' },
    pulse: [{ k: 'aura', radius: R(2), who: 'affected', hits: [{ spec: '1d6', type: 'shatter' }, corrosive('1d4')], drink: true }],
    death: [{ k: 'foul', radius: R(3), turns: 4, ticks: [corrosive('1d6'), { spec: '1d6', type: 'shatter' }], drink: true }],
  },
  'blood-herald': {
    name: 'Blood Herald', hp: 12, move: 4, pacifist: true,
    pulse: [{ k: 'rotAffected', radius: R(3), drink: true }],
    death: [{ k: 'rotAffected', radius: R(4), stacks: 2, drink: true }],
  },

  // ---- Bind wave: blue wardens hold the enemy off your side; the cursed ones hunt alone ----
  gaoler: {
    name: 'Gaoler', hp: 7, move: 5, pacifist: true,
    pulse: [{ k: 'guard', radius: R(5), reach: R(3), then: [{ k: 'root', turns: 2 }, { k: 'stifle' }] }],
  },
  bulwark: {
    name: 'Bulwark', hp: 12, move: 4, armor: 2, pacifist: true, decoy: 0.35,
    struck: { radius: R(2), hits: [{ spec: '1d4', type: 'shatter' }], root: 2 },
  },
  'warding-obelisk': {
    name: 'Warding Obelisk', hp: 14, move: 2, armor: 2, pacifist: true,
    pulse: [
      { k: 'hex', radius: R(3), who: 'foes', then: [{ k: 'root', turns: 2 }] },
      { k: 'hex', radius: R(3), who: 'foes', nearest: true, then: [{ k: 'stifle' }] },
    ],
    death: [{ k: 'burst', radius: R(3), hits: [{ spec: '2d6', type: 'shatter' }], foes: true, stun: 2 }],
  },
  'shackle-wraith': {
    name: 'Shackle Wraith', hp: 6, move: 6, melee: { spec: '1d3', type: 'shadow' },
    onHit: [{ k: 'dot', name: 'Shackle Curse', spec: '1d3', turns: 3, type: 'shadow', roots: true }],
    pulse: [{ k: 'guard', radius: R(5), reach: R(2), all: true, afflicted: true, then: [{ k: 'stifle' }] }],
  },
  basilisk: {
    name: 'Basilisk', hp: 9, move: 4, melee: { spec: '1d4', type: 'shatter', reach: R(4) },
    onHit: [{ k: 'petrify' }],
  },
};

/** Whether a minion of `kind` drains: whatever it drinks heals it as well as its summoner. */
export function minionDrinks(kind: string): boolean {
  return /"k":"(drain|siphon|lifesteal|drinkTethered)"|"drink":true/.test(JSON.stringify(MINIONS[kind] ?? {}));
}

/**
 * Build a minion of `kind` for its summoner. Its strength, dexterity and
 * intellect scale with the summoning roll and the summoner's intellect, like
 * every Life summon.
 */
export function makeMinion(
  kind: string,
  opts: { ownerInt: number; dcRoll: number; ownerName: string; pos: Vec2; team: number }
): Mage {
  const def = MINIONS[kind];
  const stat = Math.ceil(opts.dcRoll / 4) + Math.ceil(opts.ownerInt / 3);
  const unit = new Mage({
    name: `${opts.ownerName}'s ${def.name}`,
    isAI: false,
    team: opts.team,
    position: opts.pos,
    loadout: [],
  });
  unit.statStrength = stat;
  unit.statDex = stat;
  unit.statInt = stat;
  unit.maxMana = 5 + stat;
  unit.mana = unit.maxMana;
  unit.statsAssigned = true;
  unit.maxHp = def.hp;
  unit.hp = def.hp;
  unit.intrinsicMoveUnits = def.move;
  unit.intrinsicArmorFlat = def.armor ?? 0;
  unit.intrinsicImmuneTypes = [...(def.immune ?? [])];
  if (def.pacifist) unit.cannotAttack = true;
  if (def.melee) {
    unit.intrinsicMelee = { spec: def.melee.spec, type: def.melee.type };
    unit.intrinsicMeleeReach = def.melee.reach ?? MELEE_RANGE;
  }
  return unit;
}

/** The strike rider a minion of `kind` carries, rebuilt from data. */
export function minionRider(kind: string, self: Mage): ((ctx: EffectContext, target: Mage) => void) | undefined {
  const effects = MINIONS[kind]?.onHit;
  if (!effects?.length) return undefined;
  return (ctx, victim) => {
    if (ctx.game.lastIntrinsicDamage <= 0) return;
    const owner = self.summonOwnerIndex != null ? ctx.game.mages[self.summonOwnerIndex] : undefined;
    runHitEffects({ striker: self, victim, dealt: ctx.game.lastIntrinsicDamage, drinker: owner ?? self, ctx }, effects);
  };
}

// -----------------------------------------------------------------------------
//  OBJECTS — imbues on weapons, armour and trinkets
// -----------------------------------------------------------------------------

export interface ImbueDef {
  name: string;
  slot: 'weapon' | 'armour' | 'trinket';
  /** Player-facing rules text, filled in by the spell that grants it. */
  text?: string;
  /** Uses before it is spent; absent lasts the whole fight. */
  charges?: number;
  /** Robe: a bonus action that works half the time; every try spends a use. */
  robe?: { label: string; text: string; cast: (game: GameState, wearer: Mage) => void };
  /** Weapon: on every landed basic attack. */
  onHit?: HitEffect[];
  /** Weapon bound to a unit (`boundIndex`): every landed basic attack, on anyone, also lands these on it. */
  onBound?: HitEffect[];
  /** Weapon: when it drew no blood since the bearer's last turn, it bites the bearer for this much. */
  hunger?: number;
  /** Armour: run on the attacker whenever a basic attack lands on the bearer. */
  onStruck?: HitEffect[];
  /** Armour: negate a basic attack outright (spends a charge), then run these on the attacker. */
  deflect?: HitEffect[];
  /** Armour: when a hit of at least `min` lands, burst over everyone else nearby and veil the bearer. */
  burst?: { min: number; radius: number; hits: Hit[]; veil: number };
  /** Every turn start of the bearer. */
  turnStart?: PulseEffect[];
  /** Armour: an enemy single-target spell aimed at the bearer is cast at its own caster instead (a use each). */
  reflect?: boolean;
  /** The bearer's hits of these types deal `dealt` more; such hits on the bearer deal `taken` more. */
  amplify?: { types: DamageType[]; dealt: number; taken?: number };
  /** The bearer's Lightning power is this much higher. */
  lightning?: number;
  /** Fire the bearer sets is this many stacks stronger. */
  kindle?: number;
  /** Reap the bearer marks is this much higher. */
  reap?: number;
  /** The bearer's executions reach this much more health. */
  execute?: number;
  /** Trinket: every hit on the bearer charges it (up to its Lightning power); it discharges on the gamble at turn start. */
  capacitor?: { radius: number };
  /** Armour: whatever the bearer takes also strikes everyone near it, and a hit rolls 1d3 on top. */
  thunder?: boolean;
}

export const IMBUES: Record<string, ImbueDef> = {
  gaggingEdge: { name: 'Gagging Edge', slot: 'weapon', charges: 3, onHit: [{ k: 'stifle', spec: '1d3' }] },
  rustChains: {
    name: 'Rust Chains', slot: 'armour',
    onStruck: [{ k: 'damage', spec: '1d3', type: 'corrosive' }, { k: 'root', turns: 2 }],
  },
  smokeglassRobe: {
    name: 'Smokeglass Robe', slot: 'armour', charges: 3,
    robe: {
      label: 'Smokeglass Puff',
      text: 'Enemies within 2cm take 1d3 corrosive, then the wearer gains a half veil until its next turn.',
      cast(game, wearer) {
        for (const foe of pulseTargets(game, wearer, wearer, R(2), 'foes')) {
          hitAll(game, game.quietContext(wearer, foe), foe, [corrosive('1d3')]);
        }
        veilUntilNextTurn(game, wearer);
      },
    },
  },
  leechingEdge: { name: 'Leeching Edge', slot: 'weapon', onHit: [{ k: 'siphon', pct: 0.5 }], hunger: 1 },
  foulingEdge: { name: 'Fouling Edge', slot: 'weapon', onHit: [{ k: 'foul', radius: R(2), turns: 3, spec: '2d4' }] },
  rustGag: {
    name: 'Rust Gag', slot: 'weapon', charges: 3,
    onHit: [{ k: 'root', turns: 2 }, { k: 'stifle', spec: '1d4' }],
  },
  hushingCloak: {
    name: 'Hushing Cloak', slot: 'armour', charges: 3,
    onStruck: [{ k: 'stifle' }, { k: 'damage', spec: '1d3', type: 'corrosive' }, { k: 'veilSelf', turns: 1 }],
  },
  deflector: {
    name: 'Shatterspring', slot: 'armour', charges: 2,
    deflect: [{ k: 'orbit' }, { k: 'damage', spec: '1d6', type: 'shatter' }, { k: 'damage', spec: '1d3', type: 'corrosive' }],
  },
  leechHook: { name: 'Leeching Hook', slot: 'weapon', onHit: [{ k: 'orbit' }, { k: 'siphon', pct: 0.5 }] },
  spindle: {
    name: 'Spindle Curse', slot: 'weapon',
    onHit: [{ k: 'rot', rot: { name: 'Spindle Rot', spec: '1d3', max: 3, turns: 3 } }, { k: 'orbit' }],
  },
  gossamer: {
    name: 'Gossamer Shroud', slot: 'armour', charges: 3,
    onStruck: [{ k: 'root', turns: 2 }, { k: 'veilSelf', turns: 1 }],
  },
  bloodchain: {
    name: 'Bloodchain', slot: 'weapon',
    onHit: [{ k: 'siphon', pct: 0.5 }, { k: 'tether', px: R(3), turns: 2, mutual: true }],
  },
  fetters: {
    name: 'Cursed Fetters', slot: 'armour',
    onStruck: [{ k: 'root', turns: 2 }, { k: 'rot', rot: { name: 'Rotting Shackles', spec: '1d2', max: 4, turns: 3 } }],
  },
  shatterglass: {
    name: 'Shatterglass Mail', slot: 'armour', charges: 2,
    burst: { min: 5, radius: R(2), hits: [{ spec: '1d6', type: 'shatter' }, corrosive('1d4')], veil: 1 },
  },
  bloodmist: {
    name: 'Bloodmist Cloak', slot: 'armour',
    turnStart: [{ k: 'aura', radius: R(2), who: 'foes', hits: [corrosive('1d3')], drink: true }],
  },
  silentEdge: {
    name: 'Silent Edge', slot: 'weapon',
    onHit: [{ k: 'rot', rot: { name: 'Silent Rot', spec: '1d3', max: 3, turns: 3 } }, { k: 'dashAway', px: R(2) }],
  },
  barbed: { name: 'Barbed Edge', slot: 'weapon', onHit: [{ k: 'dot', name: 'Barb', spec: '1d4', turns: 3, barbed: true }] },
  blightHammer: { name: 'Blight Hammer', slot: 'weapon', onHit: [{ k: 'rot', rot: BLIGHT }] },
  vampireFang: { name: 'Vampire Fang', slot: 'weapon', onHit: [{ k: 'dot', name: 'Drinking Curse', pct: 1 / 3, turns: 3, drink: true }] },
  devourer: {
    name: 'Devourer', slot: 'weapon',
    onHit: [{ k: 'affected', then: [{ k: 'siphon', pct: 1 }, { k: 'wither', amount: 2, cap: 8 }] }],
  },
  plagueCenser: { name: 'Plague Censer', slot: 'trinket', turnStart: [{ k: 'rotAffected', radius: R(4) }] },

  // ---- Veil wave ----
  hexingRobe: {
    name: 'Hexing Robe', slot: 'armour', charges: 3,
    robe: {
      label: 'Robe Hex',
      text: "The nearest enemy within 10cm takes 1d3 shadow at the start of its turns for 2 turns, then the wearer gains a half veil until its next turn.",
      cast(game, wearer) {
        const foe = nearestFoe(game, wearer, R(10));
        if (foe) {
          applyDot(game.quietContext(wearer, foe), foe, {
            name: 'Robe Hex', key: 'dot:robe-hex', duration: 2, damage: dmg(0, 'shadow'), damageSpec: '1d3',
          });
        }
        veilUntilNextTurn(game, wearer);
      },
    },
  },
  thirstingRobe: {
    name: 'Thirsting Robe', slot: 'armour', charges: 3,
    robe: {
      label: 'Robe Thirst',
      text: 'Drain 1d4 corrosive from the nearest enemy within 6cm; the wearer heals for the damage dealt.',
      cast(game, wearer) {
        const foe = nearestFoe(game, wearer, R(6));
        if (foe) drink(game, wearer, dealDamage(game.quietContext(wearer, foe), foe, dmg(game.rng.roll('1d4').total, 'corrosive'), QUIET));
      },
    },
  },
  smokeRobe: {
    name: 'Smoke Robe', slot: 'armour', charges: 3,
    robe: {
      label: 'Smoke Step',
      text: 'The wearer dashes 4cm straight away from the nearest enemy, then gains a half veil until its next turn.',
      cast(game, wearer) {
        const foe = game.mages
          .filter((m) => m.alive && m.team !== wearer.team)
          .sort((a, b) => dist(a.pos, wearer.pos) - dist(b.pos, wearer.pos))[0];
        if (foe) {
          dash(game.quietContext(wearer, wearer), wearer, { direction: { x: wearer.x - foe.x, y: wearer.y - foe.y }, distance: R(4) });
        }
        veilUntilNextTurn(game, wearer);
      },
    },
  },
  mirrorRobe: {
    name: 'Mirror Robe', slot: 'armour', charges: 3,
    robe: {
      label: 'Mirror Flash',
      text: 'Every veiled enemy within 6cm takes 1d4 shatter and loses its veil.',
      cast(game, wearer) {
        for (const foe of pulseTargets(game, wearer, wearer, R(6), 'foes')) {
          if (!game.isVeiled(foe)) continue;
          hitAll(game, game.quietContext(wearer, foe), foe, [{ spec: '1d4', type: 'shatter' }]);
          foe.statuses = foe.statuses.filter((s) => s.kind !== 'invisibility');
          game.log(`${wearer.name}'s robe flashes: ${foe.name} is laid bare.`);
        }
      },
    },
  },
  hushingRobe: {
    name: 'Hushing Robe', slot: 'armour', charges: 3,
    robe: {
      label: 'Robe Hush',
      text: 'The next action of the nearest enemy within 8cm, other than moving, fails.',
      cast(game, wearer) {
        const foe = nearestFoe(game, wearer, R(8));
        if (foe) applyStifle(game.quietContext(wearer, foe), foe);
      },
    },
  },
  leechveil: {
    name: 'Leechveil', slot: 'armour', charges: 3,
    onStruck: [{ k: 'dot', name: 'Leeching Curse', pct: 1 / 3, turns: 3, drink: true }, { k: 'veilSelf', turns: 1 }],
  },
  briarShroud: {
    name: 'Briar Shroud', slot: 'armour',
    onStruck: [{ k: 'dot', name: 'Briars', spec: '1d3', turns: 3, type: 'pierce' }],
  },
  hushingCurse: {
    name: 'Hushing Curse', slot: 'weapon', charges: 3,
    onHit: [{ k: 'dot', name: 'Hush', spec: '1d3', turns: 2, type: 'shadow', stifles: true }],
  },
  bindingShroud: {
    name: 'Binding Shroud', slot: 'armour',
    onStruck: [{ k: 'root', turns: 2 }, { k: 'dot', name: 'Shroud Curse', spec: '1d3', turns: 3, type: 'shadow' }],
  },
  thirstingNeedle: {
    name: 'Thirsting Needle', slot: 'weapon',
    onHit: [{ k: 'siphon', pct: 0.5 }, { k: 'dashAway', px: R(2) }],
  },
  bindingVeil: {
    name: 'Binding Veil', slot: 'armour',
    onStruck: [{ k: 'root', turns: 2 }, { k: 'siphon', pct: 0.5 }],
  },
  mirrorMail: {
    name: 'Mirror Mail', slot: 'armour', charges: 2,
    deflect: [{ k: 'root', turns: 2 }, { k: 'damage', spec: '1d4', type: 'shatter' }],
  },
  hushingShackles: {
    name: 'Hushing Shackles', slot: 'armour', charges: 3,
    onStruck: [{ k: 'root', turns: 2 }, { k: 'stifle' }],
  },
  hushingPin: {
    name: 'Hushing Pin', slot: 'weapon', charges: 3,
    onHit: [{ k: 'damage', spec: '1d3', type: 'pierce' }, { k: 'stifle' }],
  },

  // ---- Mind wave ----
  mirroredMind: { name: 'Mirrored Mind', slot: 'armour', charges: 2, reflect: true },
  dreamreaver: {
    name: 'Dreamreaver', slot: 'weapon',
    onHit: [{
      k: 'ifDot',
      then: [{ k: 'damage', spec: '2d4', type: 'sanity' }, { k: 'deepen', turns: 1 }],
      else: [{ k: 'damage', spec: '1d4', type: 'sanity' }],
    }],
  },

  // ---- Water wave (Lightning imbues get their uses from the cast) ----
  undertowMantle: {
    name: 'Undertow Mantle', slot: 'armour',
    onStruck: [{ k: 'push', cm: 3 }, { k: 'forget', count: 1, turns: 2 }],
  },
  blackwaterHook: {
    name: 'Blackwater Hook', slot: 'weapon',
    onHit: [{ k: 'pull', cm: 2 }, { k: 'inShadow', then: [{ k: 'damage', spec: '1d6', type: 'shadow' }] }],
  },
  tidalWard: { name: 'Tidal Ward', slot: 'armour', charges: 2, deflect: [{ k: 'push', cm: 4 }] },
  steamblade: {
    name: 'Steamblade', slot: 'weapon',
    onHit: [
      { k: 'ifBurning', then: [{ k: 'damage', spec: '1d4', type: 'heat' }] },
      { k: 'fire', stacks: 1 },
      { k: 'push', cm: 1 },
    ],
  },
  conductorsTrident: {
    name: "Conductor's Trident", slot: 'weapon', charges: 1,
    onHit: [{ k: 'push', cm: 2 }, { k: 'arc', radius: R(3), hits: [{ spec: '1d6', type: 'heat' }], foes: true }],
  },
  gaspingHook: {
    name: 'Gasping Hook', slot: 'weapon',
    onHit: [{ k: 'pull', cm: 2 }, { k: 'damage', spec: '1d4', type: 'sanity' }],
  },
  deepwaterCloak: {
    name: 'Deepwater Cloak', slot: 'armour',
    onStruck: [{ k: 'push', cm: 3 }, { k: 'inShadow', then: [{ k: 'forget', count: 2, turns: 2 }] }],
  },
  robeOfEbb: {
    name: 'Robe of Ebb', slot: 'armour', charges: 3,
    robe: {
      label: 'Ebb',
      text: 'The wearer trades places with the nearest enemy within 10cm, which forgets one random word until the end of its next turn.',
      cast(game, wearer) {
        const foe = nearestFoe(game, wearer, R(10));
        if (foe && swapBodies(game, wearer, wearer, foe)) forgetWords(game, foe, 1, 2);
      },
    },
  },
  kettleEdge: { name: 'Kettle Edge', slot: 'weapon', onHit: [{ k: 'blueflare', stacks: 1 }, { k: 'push', cm: 2 }] },
  staticMail: {
    name: 'Static Mail', slot: 'armour', charges: 1,
    onStruck: [{ k: 'mindBolt', spec: '1d4' }, { k: 'push', cm: 2 }],
  },
  wailingTrident: {
    name: 'Wailing Trident', slot: 'weapon', charges: 3,
    onHit: [{ k: 'damage', spec: '1d4', type: 'sanity' }, { k: 'push', cm: 2 }, { k: 'forget', count: 1, turns: 2 }],
  },
  abyssHook: {
    name: 'Abyss Hook', slot: 'weapon', hunger: 1,
    onHit: [{ k: 'pull', cm: 3 }, { k: 'damage', spec: '1d6', type: 'sanity' }],
  },
  stormTrident: {
    name: 'Storm Trident', slot: 'weapon', charges: 1,
    onHit: [{ k: 'thunderclap', radius: R(2), cm: 2, hits: [{ spec: '1d6', type: 'heat' }], fire: 1 }],
  },

  // ---- Shadow wave: the two-word trinkets amplify their other word ----
  gloomLantern: { name: 'Gloom Lantern', slot: 'trinket', lightning: 4 },
  coalHeart: { name: 'Coal Heart', slot: 'trinket', kindle: 1 },
  thornedCirclet: { name: 'Thorned Circlet', slot: 'trinket', amplify: { types: ['sanity'], dealt: 2, taken: 1 } },
  blackSigil: { name: 'Black Sigil', slot: 'trinket', reap: 1, execute: 2 },
  stormBrand: {
    name: 'Storm Brand', slot: 'weapon', charges: 1,
    onHit: [{ k: 'damage', spec: '1d6', type: 'shadow' }, { k: 'pulseFire' }, { k: 'fire', stacks: 2 }],
  },
  nerveMail: {
    name: 'Nerve Mail', slot: 'armour', charges: 1,
    onStruck: [{ k: 'damage', spec: '1d6', type: 'sanity' }, { k: 'arc', radius: R(3), hits: [{ spec: '1d4', type: 'sanity' }] }],
  },
  brandOfAgony: { name: 'Brand of Agony', slot: 'weapon', hunger: 1, onHit: [{ k: 'fireSanity' }, { k: 'fire', stacks: 1 }] },
  dreadfulEdge: {
    name: 'Dreadful Edge', slot: 'weapon',
    onHit: [{
      k: 'ifShaken',
      then: [{ k: 'damage', spec: '2d6', type: 'sanity' }, { k: 'forget', count: 1, turns: 2 }],
      else: [{ k: 'damage', spec: '1d4', type: 'sanity' }],
    }],
  },
  shroudOfMourning: {
    name: 'Shroud of Mourning', slot: 'armour',
    onStruck: [
      { k: 'damage', spec: '1d4', type: 'sanity' },
      { k: 'ifShaken', then: [{ k: 'reap', stacks: 3 }], else: [{ k: 'reap', stacks: 1 }] },
    ],
  },

  // ---- Lightning wave: the gamble rides on what the bearer takes ----
  agonyCapacitor: { name: 'Agony Capacitor', slot: 'trinket', capacitor: { radius: R(4) } },
  thunderingMantle: { name: 'Thundering Mantle', slot: 'armour', thunder: true },

  // ---- Pierce wave ----
  boneMail: { name: 'Bone Mail', slot: 'armour', charges: 2, deflect: [{ k: 'damage', spec: '1d6', type: 'pierce' }, { k: 'siphon', pct: 0.5 }] },
  bloodthirstyEdge: {
    name: 'Bloodthirsty Edge', slot: 'weapon', hunger: 2,
    onHit: [{ k: 'siphon', pct: 0.5 }, { k: 'dot', name: 'Bleeding', spec: '1d3', turns: 2, type: 'pierce' }],
  },

  // ---- Drain wave: the Corrode gear, drinking what it deals ----
  gaggingFang: { name: 'Gagging Fang', slot: 'weapon', charges: 3, onHit: [{ k: 'stifle' }, { k: 'siphon', pct: 0.5 }] },
  leechingChains: { name: 'Leeching Chains', slot: 'armour', onStruck: [{ k: 'siphon', pct: 0.5 }, { k: 'root', turns: 2 }] },
  thirstingCurse: {
    name: 'Thirsting Curse', slot: 'weapon', hunger: 2,
    onHit: [{ k: 'dot', name: 'Thirsting Curse', pct: 0.5, turns: 3, drink: true }],
  },
  gorgingEdge: {
    name: 'Gorging Edge', slot: 'weapon',
    onHit: [{ k: 'affected', then: [{ k: 'siphon', pct: 0.5 }, { k: 'foul', radius: R(2), turns: 3, spec: '2d4', drink: true }] }],
  },
  bloodGag: {
    name: 'Blood Gag', slot: 'weapon', charges: 3,
    onHit: [{ k: 'root', turns: 2 }, { k: 'stifle' }, { k: 'siphon', pct: 0.5 }],
  },
  leechspring: {
    name: 'Leechspring', slot: 'armour', charges: 2,
    deflect: [{ k: 'orbit' }, { k: 'damage', spec: '1d6', type: 'shatter' }, { k: 'siphon', pct: 0.5 }],
  },
  thirstingSpindle: {
    name: 'Thirsting Spindle', slot: 'weapon',
    onHit: [{ k: 'dot', name: 'Spindle Thirst', pct: 1 / 3, turns: 3, drink: true }, { k: 'orbit' }],
  },
  thirstingFetters: {
    name: 'Thirsting Fetters', slot: 'armour',
    onStruck: [{ k: 'root', turns: 2 }, { k: 'dot', name: 'Fettered Thirst', pct: 1 / 3, turns: 3, drink: true }],
  },
  blightdrinker: { name: 'Blightdrinker', slot: 'weapon', onHit: [{ k: 'rot', rot: THIRSTING_BLIGHT }] },
  bloodCenser: { name: 'Blood Censer', slot: 'trinket', turnStart: [{ k: 'rotAffected', radius: R(4), drink: true }] },

  // ---- Bind wave: shackles on enemy gear, wards on your own ----
  shackledGrip: {
    name: 'Shackled Grip', slot: 'weapon', charges: 3,
    onHit: [{ k: 'self', then: [{ k: 'root', turns: 2 }, { k: 'stifle' }] }],
  },
  brittleFetters: {
    name: 'Brittle Fetters', slot: 'armour', charges: 3,
    onStruck: [{ k: 'self', then: [{ k: 'damage', spec: '1d6', type: 'shatter' }, { k: 'root', turns: 2 }] }],
  },
  shatterlockMail: {
    name: 'Shatterlock Mail', slot: 'armour', charges: 2,
    deflect: [{ k: 'damage', spec: '1d6', type: 'shatter' }, { k: 'stifle' }, { k: 'sabotage' }],
  },
  effigyBlade: {
    name: 'Effigy Blade', slot: 'weapon',
    onBound: [
      { k: 'dot', name: 'Effigy Curse', spec: '1d3', turns: 3, type: 'shadow', roots: true },
      { k: 'stifle', chance: 0.34 },
    ],
  },
  gorgonCharm: { name: 'Gorgon Charm', slot: 'trinket', turnStart: [{ k: 'hex', radius: R(3), who: 'foes', then: [{ k: 'petrify' }] }] },
};

export function imbuesOf(m: Mage): ImbueStatus[] {
  return m.statuses.filter((s) => s.kind === 'imbue') as ImbueStatus[];
}

/** Put imbue `id` on `bearer` for the rest of the fight, replacing one of the same kind. `scale` multiplies its uses; `uses` sets them outright. */
export function addImbue(game: GameState, owner: Mage, bearer: Mage, id: string, scale = 1, uses?: number): ImbueStatus {
  const def = IMBUES[id];
  const charges = uses ?? (def.charges != null ? def.charges * scale : undefined);
  bearer.statuses = bearer.statuses.filter((s) => !(s.kind === 'imbue' && (s as ImbueStatus).imbue === id));
  const status: ImbueStatus = {
    key: `imbue:${id}`,
    name: def.name,
    kind: 'imbue',
    duration: 1,
    imbue: id,
    ownerIndex: game.mages.indexOf(owner),
    charges,
    fed: true,
  };
  bearer.statuses.push(status);
  game.log(`${bearer.name} carries ${def.name}.`);
  return status;
}

function spend(bearer: Mage, imbue: ImbueStatus): void {
  if (imbue.charges == null) return;
  imbue.charges -= 1;
  if (imbue.charges > 0) return;
  bearer.statuses = bearer.statuses.filter((s) => s !== imbue);
}

/** The nearest enemy within `reach` that `from` could single out. */
function nearestFoe(game: GameState, from: Mage, reach: number): Mage | undefined {
  return game.mages
    .filter((m) => m.alive && m.team !== from.team && dist(m.pos, from.pos) <= reach + m.bodyRadius() && !game.isUntargetable(m, from))
    .sort((a, b) => dist(a.pos, from.pos) - dist(b.pos, from.pos) || game.mages.indexOf(a) - game.mages.indexOf(b))[0];
}

function veilUntilNextTurn(game: GameState, m: Mage): void {
  if (m.alive) applyInvisibility(game.quietContext(m, m), m, { duration: 1, mode: 'partial' });
}

/** The robe `m` wears that still has uses, if any. */
export function robeOf(m: Mage): ImbueStatus | undefined {
  return imbuesOf(m).find((s) => IMBUES[s.imbue]?.robe && (s.charges ?? 0) > 0);
}

/** Bonus action: the robe answers half the time; every try spends a use. Returns whether it answered. */
export function castRobe(game: GameState, wearer: Mage): boolean {
  const imbue = robeOf(wearer);
  const robe = imbue ? IMBUES[imbue.imbue].robe : undefined;
  if (!imbue || !robe) return false;
  const name = IMBUES[imbue.imbue].name;
  spend(wearer, imbue);
  if (!game.rng.chance(0.5)) {
    game.log(`${wearer.name}'s ${name} stays still.`);
    return false;
  }
  game.log(`${wearer.name}'s ${name} answers: ${robe.label}.`);
  robe.cast(game, wearer);
  return true;
}

/**
 * A declared action meets the field before anyone may answer it: Burning Focus,
 * an unreal mind striking a phantom, a Figment that takes the blow, a mirror that turns a spell back.
 */
export function onDeclare(game: GameState, item: StackItem): void {
  const source = item.source;
  if (item.kind === 'move' || item.windowTrigger || !source.alive) return;
  if (item.kind === 'spell' && item.spell && game.hexLaw('burningFocus')) {
    const owner = lawOwner(game, 'burningFocus') ?? source;
    applyBlueflareStacks(game.quietContext(owner, source), source, item.spell.words.length);
  }
  if (item.kind === 'spell' && item.spell?.words.includes('lightning') && game.hexLaw('blackStorm')) {
    game.log(`The black storm answers ${source.name}'s lightning.`);
    lawHit(game, lawOwner(game, 'blackStorm') ?? source, source, { spec: '1d6', type: 'shadow' }, false);
    if (!source.alive) return;
  }
  let target = item.target;
  if (!target?.alive) return;
  const spell = item.kind === 'spell' ? item.spell : undefined;
  const singleSpell = !!spell && !spell.aoe && (spell.targeting === 'enemy' || spell.targeting === 'any');
  if (!singleSpell && item.kind !== 'melee') return;
  if (source.statuses.some((s) => s.key === UNREALITY_KEY) && game.rng.chance(0.5)) {
    const label = item.label;
    item.resolve = () => game.log(`${source.name} strikes a phantom: ${label} does nothing.`);
    return;
  }
  if (target.team === source.team) return;
  const figment = game.summonsOf(target).find((s) => (MINIONS[s.summonKind ?? '']?.decoy ?? 0) > 0);
  if (figment && game.rng.chance(MINIONS[figment.summonKind!].decoy!) && game.retarget(item, figment)) {
    game.log(`${item.label} is drawn to ${figment.name}.`);
    target = figment;
  }
  if (!singleSpell) return;
  const mirror = imbuesOf(target).find((s) => IMBUES[s.imbue]?.reflect);
  if (mirror && game.retarget(item, source, true)) {
    game.log(`${target.name}'s ${IMBUES[mirror.imbue].name} turns ${item.label} back on ${source.name}.`);
    spend(target, mirror);
  }
}

/** Unreality's debuff: half of the bearer's single-target actions strike a phantom. */
export const UNREALITY_KEY = 'debuff:unreality';

/** Figment: every hit that lands on a minion with `struck` sends its burst over the enemies around it. */
export function minionStruck(game: GameState, minion: Mage, dealt: number): void {
  const def = MINIONS[minion.summonKind ?? ''];
  if (!def?.struck || dealt <= 0) return;
  const owner = minion.summonOwnerIndex != null ? game.mages[minion.summonOwnerIndex] : undefined;
  if (!owner) return;
  for (const foe of game.mages) {
    if (!foe.alive || foe.team === owner.team || dist(foe.pos, minion.pos) > def.struck.radius + foe.bodyRadius()) continue;
    const ctx = game.quietContext(owner, foe);
    hitAll(game, ctx, foe, def.struck.hits);
    if (def.struck.root && foe.alive) applyStun(ctx, foe, { duration: def.struck.root, type: 'movement' });
  }
}

/** `m` forgets `count` random words it still remembers until `turns` run out, on top of anything already forgotten. */
function forgetWords(game: GameState, m: Mage, count: number, turns: number): void {
  if (!m.alive || m.isDebuffImmune()) return;
  const known = m.loadout.filter((w) => !isModifierWord(w) && !m.hasForgotten(w));
  const lost: WordId[] = [];
  while (lost.length < count && known.length > 0) lost.push(...known.splice(game.rng.die(known.length) - 1, 1));
  if (lost.length === 0) return;
  const status = m.statuses.find((s) => s.kind === 'forget') as ForgetStatus | undefined;
  if (status) {
    status.forgotten.push(...lost);
    status.duration = Math.max(status.duration, turns);
  } else {
    m.statuses.push({ key: 'forget', name: 'Forgotten', kind: 'forget', duration: turns, forgotten: [...lost] });
  }
  game.log(`${m.name} forgets ${lost.join(' & ')}.`);
}

/**
 * A defender's deflecting armour may swallow a basic attack before it lands.
 * Returns true when the blow is negated. `blocked`: what the blow would have dealt.
 */
export function imbueDeflects(game: GameState, attacker: Mage, defender: Mage, blocked = 0): boolean {
  if (attacker.team === defender.team) return false;
  const deflector = imbuesOf(defender).find((s) => IMBUES[s.imbue]?.deflect);
  if (!deflector) return false;
  const def = IMBUES[deflector.imbue];
  game.log(`${defender.name}'s ${def.name} turns the blow aside.`);
  spend(defender, deflector);
  runHitEffects(
    { striker: defender, victim: attacker, dealt: blocked, drinker: defender, ctx: game.quietContext(defender, attacker) },
    def.deflect!
  );
  return true;
}

/** A basic attack from `source` landed on `target` for `dealt`: weapon, gear and armour riders. */
export function imbueAfterStrike(
  game: GameState,
  source: Mage,
  target: Mage,
  dealt: number,
  weaponHits: readonly HitEffect[] = [],
  armourHits: readonly HitEffect[] = []
): void {
  if (dealt <= 0) return;
  const owner = source.isSummon && source.summonOwnerIndex != null ? game.mages[source.summonOwnerIndex] ?? source : source;
  const ctx = game.quietContext(source, target);
  if (weaponHits.length) runHitEffects({ striker: source, victim: target, dealt, drinker: owner, ctx }, weaponHits);
  for (const imbue of imbuesOf(source)) {
    const def = IMBUES[imbue.imbue];
    if (!def?.onHit) continue;
    imbue.fed = true;
    runHitEffects({ striker: source, victim: target, dealt, drinker: owner, ctx }, def.onHit);
    if (def.charges != null) spend(source, imbue);
  }
  for (const imbue of imbuesOf(source)) {
    const bound = imbue.boundIndex != null ? game.mages[imbue.boundIndex] : undefined;
    const def = IMBUES[imbue.imbue];
    if (!def?.onBound || !bound?.alive) continue;
    runHitEffects({ striker: source, victim: bound, dealt, drinker: owner, ctx: game.quietContext(source, bound) }, def.onBound);
  }
  if (source.team === target.team) return;
  // Armour answers with the blow it took: `dealt` is what landed on the wearer.
  const back = game.quietContext(target, source);
  if (armourHits.length && source.alive) {
    runHitEffects({ striker: target, victim: source, dealt, drinker: target, ctx: back }, armourHits);
  }
  for (const imbue of imbuesOf(target)) {
    const def = IMBUES[imbue.imbue];
    if (!def?.onStruck || !source.alive || !target.alive) continue;
    runHitEffects({ striker: target, victim: source, dealt, drinker: target, ctx: back }, def.onStruck);
    if (def.charges != null) spend(target, imbue);
  }
}

/** Any hit landed on an imbued bearer: bursting mail, charging capacitors, a thundering mantle. `dot`: a damage-over-time tick. */
export function imbueOnDamaged(game: GameState, target: Mage, dealt: number, dot = false): void {
  if (dealt <= 0) return;
  for (const imbue of imbuesOf(target)) {
    if (IMBUES[imbue.imbue]?.capacitor) imbue.stored = Math.min(imbue.power ?? 10, (imbue.stored ?? 0) + dealt);
  }
  for (const imbue of imbuesOf(target)) {
    const burst = IMBUES[imbue.imbue]?.burst;
    if (!burst || dealt < burst.min) continue;
    spend(target, imbue);
    for (const victim of game.mages) {
      if (!victim.alive || victim === target || dist(victim.pos, target.pos) > burst.radius + victim.bodyRadius()) continue;
      hitAll(game, game.quietContext(target, victim), victim, burst.hits);
    }
    if (target.alive) applyInvisibility(game.quietContext(target, target), target, { duration: burst.veil, mode: 'partial' });
    game.log(`${target.name}'s ${IMBUES[imbue.imbue].name} bursts.`);
  }
  for (const imbue of imbuesOf(target)) {
    if (IMBUES[imbue.imbue]?.thunder) thunder(game, target, imbue, dealt, dot);
  }
}

/** A damage-over-time tick that never passed through a hit: only a thundering mantle hears it. */
export function imbueOnDotTick(game: GameState, bearer: Mage, taken: number): void {
  if (taken <= 0) return;
  for (const imbue of imbuesOf(bearer)) {
    if (IMBUES[imbue.imbue]?.thunder) thunder(game, bearer, imbue, taken, true);
  }
}

/** Nonzero while a mantle thunders: its own strikes never set a mantle off again. */
let thundering = 0;

/**
 * Thundering Mantle: what the bearer takes also strikes every other unit near it, half as heat,
 * a quarter as sanity and a quarter as Fire stacks (rounded down). A hit (not a damage-over-time
 * tick) then rolls 1d3: a 2 crackles back into the bearer for 1 heat, a 1 arcs 1d3 sanity into
 * the nearest other unit.
 */
function thunder(game: GameState, bearer: Mage, imbue: ImbueStatus, taken: number, dot: boolean): void {
  if (thundering > 0) return;
  thundering += 1;
  try {
    const name = IMBUES[imbue.imbue].name;
    const heat = Math.floor(taken / 2);
    const quarter = Math.floor(taken / 4);
    const radius = R(Math.max(2, (imbue.power ?? 8) / 4));
    const near = heat > 0
      ? game.mages.filter(
        (m) => m.alive && m !== bearer && !game.isUnreachable(m) && dist(m.pos, bearer.pos) <= radius + m.bodyRadius()
      )
      : [];
    if (near.length > 0) game.log(`${bearer.name}'s ${name} thunders out.`);
    for (const m of near) {
      void game.vfxSink?.lightningBolt?.(bearer.pos, m.pos);
      const ctx = game.quietContext(bearer, m);
      dealDamage(ctx, m, dmg(heat, 'heat'), { ...QUIET, aoe: true });
      if (quarter > 0 && m.alive) dealDamage(ctx, m, dmg(quarter, 'sanity'), { ...QUIET, aoe: true });
      if (quarter > 0 && m.alive) applyFireStacks(ctx, m, quarter);
    }
    if (dot || !bearer.alive) return;
    const roll = game.rng.die(3);
    if (roll === 2) {
      game.log(`${bearer.name}'s ${name} crackles back into its bearer.`);
      dealDamage(game.quietContext(bearer, bearer), bearer, dmg(1, 'heat'), QUIET);
    } else if (roll === 1) {
      const next = nearestOther(game, bearer, Infinity, [bearer], (m) => !game.isUnreachable(m));
      if (!next) return;
      game.log(`${bearer.name}'s ${name} arcs into ${next.name}.`);
      void game.vfxSink?.lightningBolt?.(bearer.pos, next.pos);
      dealDamage(game.quietContext(bearer, next), next, dmg(game.rng.roll('1d3').total, 'sanity'), QUIET);
    }
  } finally {
    thundering -= 1;
  }
}

/** Imbue upkeep at the bearer's turn start. */
export function imbueTurnStart(game: GameState, bearer: Mage): void {
  for (const imbue of [...imbuesOf(bearer)]) {
    const def = IMBUES[imbue.imbue];
    if (!def || !bearer.alive) continue;
    if (def.hunger && !imbue.fed) {
      dealDamage(game.quietContext(bearer, bearer), bearer, dmg(def.hunger, 'corrosive'), QUIET);
      game.log(`${bearer.name}'s ${def.name} drinks from its wielder.`);
    }
    imbue.fed = false;
    if (def.turnStart) runPulse(game, bearer, bearer, def.turnStart);
    if (def.capacitor && (imbue.stored ?? 0) > 0) discharge(game, bearer, imbue, def.capacitor.radius);
  }
}

/** Agony Capacitor: the whole charge goes on the gamble — into the bearer, one unit near it, or all of them. */
function discharge(game: GameState, bearer: Mage, imbue: ImbueStatus, radius: number): void {
  const charge = imbue.stored ?? 0;
  const roll = game.rng.die(6);
  const near = game.mages.filter(
    (m) => m.alive && m !== bearer && !game.isUnreachable(m) && dist(m.pos, bearer.pos) <= radius + m.bodyRadius()
  );
  const zap = (m: Mage, type: DamageType): void => {
    if (m.alive) dealDamage(game.quietContext(bearer, m), m, dmg(charge, type), { ...QUIET, aoe: true });
  };
  if (roll === 1) {
    game.log(`${bearer.name}'s ${IMBUES[imbue.imbue].name} discharges into its bearer.`);
    zap(bearer, 'sanity');
  } else if (roll === 6) {
    game.log(`${bearer.name}'s ${IMBUES[imbue.imbue].name} discharges into everything near it.`);
    for (const m of near) {
      void game.vfxSink?.lightningBolt?.(bearer.pos, m.pos);
      zap(m, 'heat');
      zap(m, 'sanity');
    }
  } else if (near.length > 0) {
    const victim = game.rng.pick(near);
    void game.vfxSink?.lightningBolt?.(bearer.pos, victim.pos);
    zap(victim, 'heat');
    zap(victim, 'sanity');
  }
  // Emptied last: a discharge into its own bearer must not charge it straight back up.
  imbue.stored = 0;
}

// -----------------------------------------------------------------------------
//  AMPLIFIERS — Shadow gear, auras and laws that make other words stronger
// -----------------------------------------------------------------------------

const imbueSum = (m: Mage, read: (def: ImbueDef) => number | undefined): number => {
  let sum = 0;
  for (const imbue of imbuesOf(m)) {
    const def = IMBUES[imbue.imbue];
    if (def) sum += read(def) ?? 0;
  }
  return sum;
};

/** What gear and minion auras add to a hit of `type` from `source` on `target`. */
export function hitAmplifier(game: GameState, source: Mage, target: Mage, type: DamageType): number {
  let bonus = imbueSum(source, (def) => (def.amplify?.types.includes(type) ? def.amplify.dealt : 0));
  bonus += imbueSum(target, (def) => (def.amplify?.types.includes(type) ? def.amplify.taken : 0));
  for (const m of game.mages) {
    const aura = m.isSummon && m.alive && m !== target ? MINIONS[m.summonKind ?? '']?.amplify : undefined;
    if (!aura?.types.includes(type) || dist(m.pos, target.pos) > aura.radius + target.bodyRadius()) continue;
    bonus += aura.bonus + (aura.perPower ? Math.floor(sparkOf(m) / aura.perPower) : 0);
  }
  return bonus;
}

/** How much higher `m`'s Lightning power runs: its gear and Black Storm. */
export function lightningAmplifier(game: GameState, m: Mage): number {
  const storm = game.hexLaw('blackStorm');
  return imbueSum(m, (def) => def.lightning) + (storm ? Math.max(2, Math.floor((storm.power ?? 0) / 3)) : 0);
}

/** Extra Fire stacks whatever `owner` sets. */
export function kindleBonus(owner: Mage): number {
  return imbueSum(owner, (def) => def.kindle);
}

/** Extra Reap whatever `source` marks. */
export function reapBonus(source: Mage): number {
  return imbueSum(source, (def) => def.reap);
}

/** Extra health `source`'s executions reach. */
export function executeBonus(source: Mage): number {
  return imbueSum(source, (def) => def.execute);
}

/** How much every Reap stack counts: double under Long Night. */
export function reapWeight(game: GameState): number {
  return game.hexLaw('longNight') ? 2 : 1;
}

// -----------------------------------------------------------------------------
//  HEXCRAFT — laws the whole field obeys
// -----------------------------------------------------------------------------

export type HexLawKind =
  | 'chokingRust'
  | 'clingingRust'
  | 'acidFog'
  | 'etching'
  | 'brittle'
  | 'bloodtide'
  | 'rottingWorld'
  | 'lockdown'
  | 'misdirection'
  | 'ricochet'
  | 'crushing'
  | 'spiralFeast'
  | 'passingRot'
  | 'stillness'
  | 'nailing'
  | 'calcification'
  | 'chainHunger'
  | 'fester'
  | 'glassVeils'
  | 'veiledHunger'
  | 'quarantine'
  | 'breach'
  | 'bleeding'
  | 'festering'
  | 'impaling'
  | 'shatteringHunger'
  | 'brittleRot'
  | 'crumbling'
  | 'feedingRot'
  | 'worldFeeds'
  | 'eternalRot'
  | 'creepingShroud'
  | 'thirstingVeil'
  | 'unseenBlades'
  | 'brittleVeils'
  | 'silentVeil'
  | 'unseenHunger'
  | 'huntersHex'
  | 'shatteredShroud'
  | 'smotheringCurse'
  | 'shackleCurse'
  | 'hiddenFangs'
  | 'shatteredThirst'
  | 'stifledThirst'
  | 'chokingMist'
  | 'longShadows'
  | 'pinningSilence'
  | 'nailedShadows'
  | 'brittleSilence'
  | 'brittleBonds'
  | 'gaggingBonds'
  | 'burningFocus'
  | 'neuralStorm'
  | 'brainstorm'
  | 'nightTerrors'
  | 'tidesOfForgetting'
  | 'blackUndertow'
  | 'turningTide'
  | 'scaldingWater'
  | 'conductiveSea'
  | 'panicTide'
  | 'drownedMemories'
  | 'tideRemembers'
  | 'boilingThoughts'
  | 'mindCurrent'
  | 'flinching'
  | 'maelstrom'
  | 'squall'
  | 'blackStorm'
  | 'blackfire'
  | 'echoingAgony'
  | 'longNight'
  | 'firestorm'
  | 'screamingSky'
  | 'burningTerror'
  | 'frayingMinds'
  | 'dyingLight'
  | 'dryLightning'
  | 'stormOfAgony'
  | 'burningFrenzy'
  | 'turningBlades'
  | 'splintering'
  | 'openWounds'
  | 'bloodscent'
  | 'graveStakes'
  | 'pinningLaw'
  | 'whirlwind'
  | 'circlingThirst'
  | 'twistingBarbs'
  | 'stakeLaw'
  | 'bloodpin'
  | 'thornedFetters'
  | 'marrowThirst'
  | 'splinterCurse'
  | 'boneGarden'
  | 'vampiricWounds'
  | 'bloodHarvest'
  | 'stigmata'
  | 'chokingThirst'
  | 'clingingThirst'
  | 'brittleThirst'
  | 'curseOfThirst'
  | 'gorgingWorld'
  | 'gnawingLockdown'
  | 'grindingThirst'
  | 'passingThirst'
  | 'calcifiedThirst'
  | 'festeringThirst'
  | 'crackedVessels'
  | 'marrowFeast'
  | 'eternalThirst'
  | 'gagOrder'
  | 'petrifaction'
  | 'breakingPoint'
  | 'hexedSilence'
  | 'shatteredCurses';

export const HEX_LAW_NAMES: Record<HexLawKind, string> = {
  chokingRust: 'Choking Rust',
  clingingRust: 'Clinging Rust',
  acidFog: 'Acid Fog',
  etching: 'Etching Law',
  brittle: 'Brittle Law',
  bloodtide: 'Bloodtide',
  rottingWorld: 'Rotting World',
  lockdown: 'Lockdown',
  misdirection: 'Misdirection',
  ricochet: 'Ricochet Law',
  crushing: 'Crushing Law',
  spiralFeast: 'Spiral Feast',
  passingRot: 'Passing Rot',
  stillness: 'Stillness Law',
  nailing: 'Nailing Law',
  calcification: 'Calcification',
  chainHunger: 'Hunger of Chains',
  fester: 'Fester Law',
  glassVeils: 'Glass Veils',
  veiledHunger: 'Veiled Hunger',
  quarantine: 'Quarantine',
  breach: 'Breach Law',
  bleeding: 'Bleeding Law',
  festering: 'Festering Law',
  impaling: 'Impaling Law',
  shatteringHunger: 'Shattering Hunger',
  brittleRot: 'Brittle Rot',
  crumbling: 'Crumbling World',
  feedingRot: 'Feeding Rot',
  worldFeeds: 'The World Feeds',
  eternalRot: 'Eternal Rot',
  creepingShroud: 'Creeping Shroud',
  thirstingVeil: 'Thirsting Veil',
  unseenBlades: 'Unseen Blades',
  brittleVeils: 'Brittle Veils',
  silentVeil: 'Silent Veil',
  unseenHunger: 'Unseen Hunger',
  huntersHex: "Hunter's Hex",
  shatteredShroud: 'Shattered Shroud',
  smotheringCurse: 'Smothering Curse',
  shackleCurse: 'Shackle Curse',
  hiddenFangs: 'Hidden Fangs',
  shatteredThirst: 'Shattered Thirst',
  stifledThirst: 'Stifled Thirst',
  chokingMist: 'Choking Mist',
  longShadows: 'Long Shadows',
  pinningSilence: 'Pinning Silence',
  nailedShadows: 'Nailed Shadows',
  brittleSilence: 'Brittle Silence',
  brittleBonds: 'Brittle Bonds',
  gaggingBonds: 'Gagging Bonds',
  burningFocus: 'Burning Focus',
  neuralStorm: 'Neural Storm',
  brainstorm: 'Brainstorm',
  nightTerrors: 'Night Terrors',
  tidesOfForgetting: 'Tides of Forgetting',
  blackUndertow: 'Black Undertow',
  turningTide: 'Turning Tide',
  scaldingWater: 'Scalding Water',
  conductiveSea: 'Conductive Sea',
  panicTide: 'Panic Tide',
  drownedMemories: 'Drowned Memories',
  tideRemembers: 'The Tide Remembers',
  boilingThoughts: 'Boiling Thoughts',
  mindCurrent: 'Mind Current',
  flinching: 'Flinching Law',
  maelstrom: 'Maelstrom',
  squall: 'Squall',
  blackStorm: 'Black Storm',
  blackfire: 'Blackfire',
  echoingAgony: 'Echoing Agony',
  longNight: 'Long Night',
  firestorm: 'Firestorm',
  screamingSky: 'Screaming Sky',
  burningTerror: 'Burning Terror',
  frayingMinds: 'Fraying Minds',
  dyingLight: 'Dying Light',
  dryLightning: 'Dry Lightning',
  stormOfAgony: 'Storm of Agony',
  burningFrenzy: 'Burning Frenzy',
  turningBlades: 'Turning Blades',
  splintering: 'Splintering Law',
  openWounds: 'Open Wounds',
  bloodscent: 'Bloodscent',
  graveStakes: 'Grave Stakes',
  pinningLaw: 'Pinning Law',
  whirlwind: 'Whirlwind Law',
  circlingThirst: 'Circling Thirst',
  twistingBarbs: 'Twisting Barbs',
  stakeLaw: 'Stake Law',
  bloodpin: 'Bloodpin Law',
  thornedFetters: 'Thorned Fetters',
  marrowThirst: 'Marrow Thirst',
  splinterCurse: 'Splinter Curse',
  boneGarden: 'Bone Garden',
  vampiricWounds: 'Vampiric Wounds',
  bloodHarvest: 'Blood Harvest',
  stigmata: 'Stigmata',
  chokingThirst: 'Choking Thirst',
  clingingThirst: 'Clinging Thirst',
  brittleThirst: 'Brittle Thirst',
  curseOfThirst: 'Curse of Thirst',
  gorgingWorld: 'The Gorging World',
  gnawingLockdown: 'Gnawing Lockdown',
  grindingThirst: 'Grinding Thirst',
  passingThirst: 'Passing Thirst',
  calcifiedThirst: 'Calcified Thirst',
  festeringThirst: 'Festering Thirst',
  crackedVessels: 'Cracked Vessels',
  marrowFeast: 'Marrow Feast',
  eternalThirst: 'Eternal Thirst',
  gagOrder: 'Gag Order',
  petrifaction: 'Petrifaction',
  breakingPoint: 'Breaking Point',
  hexedSilence: 'Hexed Silence',
  shatteredCurses: 'Shattered Curses',
};

export function isHexLawKind(kind: string): kind is HexLawKind {
  return Object.prototype.hasOwnProperty.call(HEX_LAW_NAMES, kind);
}

const BRITTLE_KEY = 'debuff:law-brittle';
const BRITTLE_THIRST_KEY = 'debuff:law-brittle-thirst';

/** Once per unit per round: true the first time, false after. */
function firstThisRound(game: GameState, kind: HexLawKind, m: Mage): boolean {
  const law = game.hexLaw(kind);
  if (!law) return false;
  const index = game.mages.indexOf(m);
  law.marks ??= {};
  if (law.marks[index] === game.round) return false;
  law.marks[index] = game.round;
  return true;
}

function nearestOther(
  game: GameState,
  from: Mage,
  radius: number,
  exclude: readonly Mage[],
  allow: (m: Mage) => boolean = () => true
): Mage | null {
  return game.mages
    .filter((m) => m.alive && !exclude.includes(m) && allow(m) && dist(m.pos, from.pos) <= radius + m.bodyRadius())
    .sort((a, b) => dist(a.pos, from.pos) - dist(b.pos, from.pos) || game.mages.indexOf(a) - game.mages.indexOf(b))[0] ?? null;
}

/** A law's own hit: it never sets off another law. `drinks` heals `from` for what it dealt. */
function lawHit(game: GameState, from: Mage, victim: Mage, hit: Hit, drinks: boolean): void {
  if (!victim.alive) return;
  game.hexLawDepth += 1;
  try {
    const dealt = dealDamage(game.quietContext(from, victim), victim, dmg(game.rng.roll(hit.spec).total, hit.type), QUIET);
    if (drinks && from !== victim) drink(game, from, dealt);
  } finally {
    game.hexLawDepth -= 1;
  }
}

/** Whoever laid law `kind`, if still standing. */
function lawOwner(game: GameState, kind: HexLawKind): Mage | undefined {
  const owner = game.mages[game.hexLaw(kind)?.ownerIndex ?? -1];
  return owner?.alive ? owner : undefined;
}

const shadowHit = (spec: string): Hit => ({ spec, type: 'shadow' });

export interface LawPrep {
  damage: DamageInstance;
  opts: DealDamageOptions;
  /** The hit lands on someone else instead. */
  redirect?: Mage;
}

/** Laws that reshape a hit before it lands. `targetVeiled`: the target was veiled as the hit came. */
export function lawBeforeHit(
  ctx: EffectContext,
  target: Mage,
  damage: DamageInstance,
  opts: DealDamageOptions,
  targetVeiled: boolean
): LawPrep {
  const game = ctx.game;
  const prep: LawPrep = { damage: { ...damage }, opts: { ...opts } };
  const type = damage.type;
  if (game.hexLaw('misdirection') && opts.canMiss !== false && !opts.aoe && game.rng.chance(0.25)) {
    const other = nearestOther(game, target, R(3), [target, ctx.caster]);
    if (other) {
      game.log(`Misdirection: the blow meant for ${target.name} finds ${other.name}.`);
      prep.redirect = other;
      prep.damage = { amount: damage.amount, type: 'corrosive' };
      return prep;
    }
  }
  const affected = game.isDesecrationAffected(target);
  if (game.hexLaw('impaling') && type === 'pierce' && affected) prep.damage.amount *= 2;
  if ((game.hexLaw('crumbling') || game.hexLaw('marrowFeast')) && type === 'shatter' && affected) prep.damage.amount *= 2;
  if (game.hexLaw('calcification') && type === 'corrosive' && target.isStunned('movement')) prep.damage.amount += 1;
  if (game.hexLaw('calcifiedThirst') && type === 'corrosive' && target.isStunned('movement')) prep.damage.amount += 1;
  if (game.hexLaw('brittle') && type === 'shatter' && target.statuses.some((s) => s.key === BRITTLE_KEY)) {
    prep.damage.amount += game.rng.roll('1d6').total;
    target.statuses = target.statuses.filter((s) => s.key !== BRITTLE_KEY);
    game.log(`${target.name} was brittle: the blow cracks deeper.`);
  }
  if (game.hexLaw('breach') && (type === 'pierce' || type === 'shatter')) prep.opts.ignoreArmor = true;
  if (targetVeiled && type === 'pierce') {
    if (game.hexLaw('unseenBlades')) prep.damage.amount *= 2;
    if (game.hexLaw('huntersHex')) prep.damage.amount += game.rng.roll('1d4').total;
  }
  if (game.hexLaw('brittleBonds') && type === 'shatter' && target.isStunned('movement')) {
    prep.damage.amount += game.rng.roll('1d6').total;
  }
  if (game.hexLaw('nightTerrors') && type === 'sanity' && game.isInShadow(target)) prep.damage.amount *= 2;
  if (game.hexLaw('frayingMinds') && type === 'sanity') prep.damage.amount += target.forgotten().length;
  if (game.hexLaw('stigmata') && type === 'pierce' && affected && target.statuses.some((s) => s.kind === 'dot')) {
    prep.damage.amount *= 2;
  }
  if (game.hexLaw('petrifaction') && target.isStunned('movement')) {
    prep.damage.amount = type === 'shatter' ? prep.damage.amount * 2 : Math.ceil(prep.damage.amount / 2);
  }
  return prep;
}

/** Laws that answer a landed hit. Their own hits never set off another law. */
export function lawAfterHit(ctx: EffectContext, target: Mage, type: DamageType, dealt: number, targetVeiled: boolean): void {
  const game = ctx.game;
  if (dealt <= 0) return;
  const attacker = ctx.caster;
  const law = (kind: HexLawKind): boolean => !!game.hexLaw(kind);
  const side = (victim: Mage, hit: Hit): number =>
    victim.alive ? dealDamage(ctx, victim, dmg(game.rng.roll(hit.spec).total, hit.type), QUIET) : 0;
  const affected = game.isDesecrationAffected(target);
  const veilFor = (m: Mage): void => {
    if (m.alive) applyInvisibility(game.quietContext(attacker, m), m, { duration: 1, mode: 'partial' });
  };
  if (law('thirstingVeil') && targetVeiled && attacker !== target) drink(game, attacker, dealt);
  if (type === 'corrosive') {
    if (law('clingingRust') && target.alive && firstThisRound(game, 'clingingRust', target)) {
      applyStun(ctx, target, { duration: 2, type: 'movement' });
    }
    if (law('chokingRust') && target.alive && firstThisRound(game, 'chokingRust', target)) applyStifle(ctx, target);
    const hunger = game.hexLaw('chainHunger');
    if (hunger && target.alive && target.team !== hunger.owner && firstThisRound(game, 'chainHunger', target)) {
      applyStun(ctx, target, { duration: 2, type: 'movement' });
    }
    if (law('acidFog') && target.alive) applyInvisibility(ctx, target, { duration: 2, mode: 'partial' });
    if (law('brittle') && target.alive) {
      applyDebuff(ctx, target, { name: 'Brittle', key: BRITTLE_KEY, duration: 4, mods: {} });
    }
    if (law('bloodtide') && attacker !== target) drink(game, attacker, dealt);
    if (attacker !== target) drainingCorrosion(ctx, target, dealt);
  }
  if (type === 'pierce') {
    if (law('etching')) side(target, corrosive('1d3'));
    if (law('ricochet') && Math.floor(dealt / 2) > 0) {
      const other = nearestOther(game, target, R(3), [target, attacker]);
      if (other) dealDamage(ctx, other, dmg(Math.floor(dealt / 2), 'corrosive'), QUIET);
    }
    if (law('nailing') && target.alive) {
      applyStun(ctx, target, { duration: 2, type: 'movement' });
      side(target, corrosive('1'));
    }
    if (law('bleeding') && attacker !== target) drink(game, attacker, side(target, corrosive('1d3')));
    if (law('festering') && target.alive) {
      applyDot(ctx, target, { name: 'Festering Wound', key: 'dot:law-festering', duration: 2, damage: dmg(0, 'corrosive'), damageSpec: '1d3' });
    }
    if (law('unseenBlades')) veilFor(target);
    if (law('hiddenFangs') && attacker !== target) {
      if (targetVeiled) drink(game, attacker, side(target, corrosive('1d4')));
      veilFor(attacker);
    }
    if (law('pinningSilence') && target.alive) {
      applyStifle(ctx, target);
      veilFor(target);
    }
    if (law('nailedShadows') && target.alive) applyStun(ctx, target, { duration: 2, type: 'movement' });
    if (law('longShadows') && attacker !== target && dist(attacker.pos, target.pos) >= R(10)) {
      side(target, { spec: '1d6', type: 'pierce' });
      if (attacker.alive) applyInvisibility(ctx, attacker, { duration: 2, mode: 'partial' });
    }
  }
  if (type === 'shatter') {
    if ((law('crushing') || law('grindingThirst')) && target.alive && attacker !== target) {
      game.forceMove(attacker, target, stepTowards(target.pos, attacker.pos, -R(1)));
    }
    if (law('calcification') && target.alive && target.isStunned('movement') && firstThisRound(game, 'calcification', target)) {
      applyStun(ctx, target, { duration: 2, type: 'full' });
    }
    if (law('shatteringHunger') && attacker !== target) drink(game, attacker, side(target, corrosive('1d3')));
    if (law('brittleRot') && target.alive) game.tickCorrosiveDots(target, attacker);
    if (law('crumbling') && affected && target.alive && firstThisRound(game, 'crumbling', target)) {
      applyStun(ctx, target, { duration: 2, type: 'full' });
    }
    shatteringThirsts(ctx, target, affected);
    if (law('shatteredCurses') && target.alive) shatterCurse(ctx, target);
  }
  if ((type === 'pierce' || type === 'shatter') && law('breach')) side(target, corrosive('1'));
  if (type === 'sanity' && law('neuralStorm') && target.alive) applyMindLightningStack(target);
  if (type === 'water') {
    if (law('scaldingWater') && target.alive) applyFireStacks(ctx, target, 1);
    if (law('boilingThoughts') && target.alive) applyBlueflareStacks(ctx, target, 1);
    const sea = game.hexLaw('conductiveSea');
    if (sea) conduct(game, attacker, target, sea.power ?? 0, false);
    const current = game.hexLaw('mindCurrent');
    if (current) {
      if (target.alive) applyMindLightningStack(target);
      conduct(game, attacker, target, current.power ?? 0, true);
    }
  }
  if (attacker !== target && target.alive) {
    if (type === 'heat' && law('scaldingWater')) pushFrom(game, attacker, target, attacker.pos, 1);
    if (type === 'sanity' && law('flinching') && dealt >= 2) pushFrom(game, attacker, target, attacker.pos, Math.floor(dealt / 2));
  }
  if (type === 'heat' && law('blackfire') && target.alive) {
    side(target, { spec: game.isInShadow(target) ? '2d4' : '1d4', type: 'shadow' });
  }
  if (type === 'sanity' && law('echoingAgony') && dealt >= 2) {
    const echo = Math.floor(dealt / 2);
    for (const other of game.mages) {
      if (!other.alive || other === target || dist(other.pos, target.pos) > R(2) + other.bodyRadius()) continue;
      dealDamage(game.quietContext(attacker, other), other, dmg(echo, 'sanity'), { ...QUIET, aoe: true });
    }
  }
  if (type === 'sanity' && law('dyingLight') && dealt >= 4 && target.alive) game.applyReap(target, 1, attacker);
  if (type === 'sanity' && law('burningFrenzy')) frenzyFlare(game, target);
  const dry = game.hexLaw('dryLightning');
  if (type === 'heat' && dry) {
    const roll = game.rng.die(6);
    if (roll >= 5) {
      const next = nearestOther(game, target, R(Math.max(2, (dry.power ?? 0) / 3)), [target]);
      if (next) {
        void game.vfxSink?.lightningBolt?.(target.pos, next.pos);
        dealDamage(game.quietContext(attacker, next), next, dmg(dealt, 'heat'), QUIET);
      }
    } else if (roll === 1 && attacker !== target && attacker.alive) {
      game.log(`The dry lightning leaps back into ${attacker.name}.`);
      void game.vfxSink?.lightningBolt?.(target.pos, attacker.pos);
      dealDamage(game.quietContext(attacker, attacker), attacker, dmg(dealt, 'heat'), QUIET);
    }
  }
  if (affected) {
    if (law('worldFeeds') && attacker !== target) drink(game, attacker, side(target, corrosive('1d4')));
    if (law('rottingWorld')) side(target, corrosive('1d4'));
    if (law('gorgingWorld') && attacker !== target) drink(game, attacker, side(target, corrosive(String(Math.ceil(dealt / 2)))));
  }
  if (type === 'pierce') pierceLaws(ctx, target, affected);
  if (type === 'shatter' && law('splinterCurse') && target.alive) {
    applyDot(ctx, target, { name: 'Splinters', key: 'dot:law-splinters', duration: 3, damage: dmg(0, 'pierce'), damageSpec: '1d3' });
  }
  if ((type === 'pierce' || type === 'shatter') && dealt >= 4 && law('marrowThirst') && attacker !== target) {
    drink(game, attacker, side(target, corrosive('1d4')));
  }
}

/** Shattered Curses: the longest damage over time on `target` deals all its remaining ticks at once and ends; it is rooted. */
function shatterCurse(ctx: EffectContext, target: Mage): void {
  const game = ctx.game;
  const dot = (target.statuses.filter((s) => s.kind === 'dot') as DotStatus[]).sort((a, b) => b.duration - a.duration)[0];
  if (!dot) return;
  target.statuses = target.statuses.filter((s) => s !== dot);
  let total = 0;
  for (let i = 0; i < Math.max(1, dot.duration); i++) total += game.rollDotDamage(dot);
  game.log(`${dot.name} shatters on ${target.name}.`);
  dealDamage(ctx, target, dmg(total, dot.damage.type), { ...QUIET, cause: dot.name, dot: true });
  if (target.alive) applyStun(ctx, target, { duration: 2, type: 'movement' });
}

/** The Drain laws that answer a corrosive hit one unit lands on another. */
function drainingCorrosion(ctx: EffectContext, target: Mage, dealt: number): void {
  const game = ctx.game;
  const attacker = ctx.caster;
  if (game.hexLaw('chokingThirst') && target.alive && firstThisRound(game, 'chokingThirst', target)) {
    applyStifle(ctx, target);
    drink(game, attacker, dealt);
  }
  if (game.hexLaw('clingingThirst') && target.alive && firstThisRound(game, 'clingingThirst', target)) {
    applyStun(ctx, target, { duration: 2, type: 'movement' });
    drink(game, attacker, dealt);
  }
  if (game.hexLaw('brittleThirst') && target.alive) {
    applyDebuff(ctx, target, { name: 'Brittle', key: BRITTLE_THIRST_KEY, duration: 4, mods: {} });
  }
  if (game.hexLaw('calcifiedThirst') && target.isStunned('movement')) drink(game, attacker, dealt);
}

/** The Drain laws that answer a shatter hit. */
function shatteringThirsts(ctx: EffectContext, target: Mage, affected: boolean): void {
  const game = ctx.game;
  const attacker = ctx.caster;
  const side = (hit: Hit): number =>
    target.alive ? dealDamage(ctx, target, dmg(game.rng.roll(hit.spec).total, hit.type), QUIET) : 0;
  const feed = (amount: number): void => {
    if (attacker !== target) drink(game, attacker, amount);
  };
  if (game.hexLaw('brittleThirst') && target.statuses.some((s) => s.key === BRITTLE_THIRST_KEY)) {
    target.statuses = target.statuses.filter((s) => s.key !== BRITTLE_THIRST_KEY);
    game.log(`${target.name} was brittle: the blow cracks it open.`);
    feed(side(corrosive('1d6')));
  }
  if (game.hexLaw('calcifiedThirst') && target.alive && target.isStunned('movement') && firstThisRound(game, 'calcifiedThirst', target)) {
    applyStun(ctx, target, { duration: 2, type: 'full' });
  }
  if (game.hexLaw('crackedVessels') && target.alive) feed(game.tickCorrosiveDots(target, attacker));
  if (game.hexLaw('marrowFeast') && affected && target.alive && firstThisRound(game, 'marrowFeast', target)) {
    applyStun(ctx, target, { duration: 2, type: 'full' });
    feed(side(corrosive('1d6')));
  }
}

/** The Pierce laws that answer a landed pierce hit. */
function pierceLaws(ctx: EffectContext, target: Mage, affected: boolean): void {
  const game = ctx.game;
  const attacker = ctx.caster;
  const law = (kind: HexLawKind): boolean => !!game.hexLaw(kind);
  const side = (hit: Hit): number =>
    target.alive ? dealDamage(ctx, target, dmg(game.rng.roll(hit.spec).total, hit.type), QUIET) : 0;
  const struck = attacker !== target;
  const rooted = target.isStunned('movement');
  const stake = game.hexLaw('stakeLaw');
  if (stake && rooted && target.team !== stake.owner) {
    side({ spec: '1d6', type: 'shatter' });
    if (target.alive) applyStun(ctx, target, { duration: 2, type: 'movement' });
  }
  if (law('bloodpin') && rooted && struck) drink(game, attacker, side(corrosive('1d4')));
  const pin = game.hexLaw('pinningLaw');
  if (pin && target.alive && target.team !== pin.owner) applyStun(ctx, target, { duration: 2, type: 'movement' });
  if (law('splintering')) {
    for (const m of game.mages) {
      if (!m.alive || m === target || m === attacker || dist(m.pos, target.pos) > R(1.5) + m.bodyRadius()) continue;
      dealDamage(game.quietContext(attacker, m), m, dmg(game.rng.roll('1d4').total, 'shatter'), { ...QUIET, aoe: true });
    }
  }
  if (law('openWounds') && target.alive) {
    applyStackingDot(ctx, target, {
      name: 'Open Wound', key: 'dot:law-open-wound', damage: dmg(0, 'pierce'), perStackSpec: '1d3',
      maxStacks: 4, refreshDuration: 3,
    });
  }
  if (law('bloodscent') && struck && target.alive && target.hp * 2 <= target.maxHp) drink(game, attacker, side(corrosive('1d6')));
  if (law('twistingBarbs') && target.alive) {
    applyDot(ctx, target, {
      name: 'Twisting Barb', key: 'dot:law-twisting-barb', duration: 2, damage: dmg(0, 'pierce'), damageSpec: '1d3', orbitSource: true,
    });
  }
  if (law('vampiricWounds') && struck && target.alive) {
    applyDot(ctx, target, {
      name: 'Bloodletting', key: 'dot:law-bloodletting', duration: 3, damage: dmg(0, 'corrosive'), damageSpec: '1d3',
      lifestealToIndex: game.mages.indexOf(attacker),
    });
  }
  if (affected && law('graveStakes') && target.alive) {
    applyStun(ctx, target, { duration: 2, type: 'movement' });
    side(pierce('1d6'));
    if (target.alive) applyDebuff(ctx, target, { name: 'Festering', key: 'debuff:kit-no-heal', duration: 2, mods: {}, healMult: 0 });
  }
  if (affected && law('bloodHarvest') && struck) drink(game, attacker, side(corrosive('1d6')));
  if (!struck || !attacker.alive) return;
  if (law('turningBlades') && target.alive && game.orbitAround(target, attacker.pos, game.rng.chance(0.5)).slammed) {
    slamInto(ctx, target, pierce('1d6'));
  }
  if (law('circlingThirst') && target.alive) {
    game.orbitAround(attacker, target.pos, game.rng.chance(0.5));
    drink(game, attacker, side(corrosive('1d3')));
  }
}

/** Conductive Sea and Mind Current: lightning runs from `victim` through the water to the nearest other unit of its own side. */
function conduct(game: GameState, attacker: Mage, victim: Mage, power: number, mind: boolean): void {
  const next = nearestOther(game, victim, R(Math.max(2, power / 3)), [victim], (m) => m.team === victim.team);
  if (!next) return;
  void game.vfxSink?.lightningBolt?.(victim.pos, next.pos);
  const bonus = Math.floor(power / 6);
  const ctx = game.quietContext(attacker, next);
  if (!mind) {
    dealDamage(ctx, next, dmg(game.rng.roll(plus('1d6', bonus)).total, 'heat'), QUIET);
    return;
  }
  const stacks = applyMindLightningStack(next);
  const amount = Math.ceil(mindLightningDamage(game.rng.roll('1d3').total + bonus, stacks));
  dealDamage(ctx, next, dmg(amount, 'sanity'), QUIET);
}

/** The middle of the field: the Maelstrom's eye. */
const fieldCentre = (): Vec2 => ({ x: FIELD.x + FIELD.w / 2, y: FIELD.y + FIELD.h / 2 });

/** Whether `m` stands within `reach` of a wall or the field edge. */
function nearWallOrEdge(game: GameState, m: Mage, reach: number): boolean {
  const r = m.bodyRadius() + reach;
  if (m.x - FIELD.x <= r || FIELD.x + FIELD.w - m.x <= r || m.y - FIELD.y <= r || FIELD.y + FIELD.h - m.y <= r) return true;
  return game.barriers.some((b) => b.shape === 'rect' && barrierDistance(b, m.pos) <= r);
}

/** A law moves `m` itself: the move sets no other law off. */
function lawDrag(game: GameState, kind: HexLawKind, m: Mage, to: Vec2, cm: number): void {
  game.hexLawDepth += 1;
  try {
    drawToward(game, lawOwner(game, kind) ?? m, m, to, cm);
  } finally {
    game.hexLawDepth -= 1;
  }
}

/** Laws that answer a unit moved by force. Moves the laws make themselves set nothing off. */
export function lawOnShoved(game: GameState, source: Mage, target: Mage): void {
  if (game.hexLawDepth > 0 || !target.alive || game.hexcraftGlobals.length === 0) return;
  if (game.hexLaw('tidesOfForgetting')) forgetWords(game, target, 1, 2);
  if (game.hexLaw('boilingThoughts') && stacksOf(target, 'blueflare') > 0) {
    game.log(`${target.name}'s thoughts boil over as ${source === target ? 'it is' : `${source.name}`} moves it.`);
    game.hexLawDepth += 1;
    try {
      game.pulseBlueflare(target);
    } finally {
      game.hexLawDepth -= 1;
    }
  }
}

/** Whirlwind Law: a unit that dashes spins everyone near where it stops around itself and cuts them. */
export function lawOnDash(game: GameState, mover: Mage): void {
  if (!game.hexLaw('whirlwind') || !mover.alive) return;
  const caught = game.mages.filter(
    (m) => m.alive && m !== mover && !game.isUnreachable(m) && dist(m.pos, mover.pos) <= R(2) + m.bodyRadius()
  );
  if (caught.length === 0) return;
  game.log(`${mover.name} whirls to a stop.`);
  game.hexLawDepth += 1;
  try {
    for (const m of caught) {
      const ctx = game.quietContext(mover, m);
      const turn = game.orbitAround(m, mover.pos, game.rng.chance(0.5));
      dealDamage(ctx, m, dmg(game.rng.roll('1d4').total, 'pierce'), { ...QUIET, aoe: true });
      if (turn.slammed) slamInto(ctx, m, { spec: '2d6', type: 'shatter' });
    }
  } finally {
    game.hexLawDepth -= 1;
  }
}

/** Laws that answer a death: Blood Harvest feeds the killer, Bone Garden bursts the corpse. `unhallowed`: Desecrate could harm it. */
export function lawOnDeath(game: GameState, victim: Mage, killer: Mage, unhallowed: boolean): void {
  if (!unhallowed || game.hexcraftGlobals.length === 0) return;
  if (game.hexLaw('bloodHarvest') && killer.alive && killer !== victim) {
    game.log(`${killer.name} feasts on ${victim.name}.`);
    heal(game.quietContext(killer, killer), killer, game.rng.roll('2d6').total);
  }
  if (!game.hexLaw('boneGarden')) return;
  const owner = lawOwner(game, 'boneGarden') ?? killer;
  const caught = game.mages.filter(
    (m) => m !== victim && game.isDesecrationAffected(m) && dist(m.pos, victim.pos) <= R(3) + m.bodyRadius()
  );
  game.log(`Bone spikes burst from where ${victim.name} fell.`);
  for (const m of caught) lawHit(game, owner, m, pierce('2d6'), false);
}

/** Laws that act at a unit's own turn start. */
export function lawTurnStart(game: GameState, m: Mage): void {
  if (!m.alive) return;
  const rooted = m.isStunned('movement');
  const hunger = game.hexLaw('chainHunger');
  const hungry = lawOwner(game, 'chainHunger');
  if (hunger && hungry && m.team !== hunger.owner && rooted) lawHit(game, hungry, m, corrosive('2d4'), true);
  if (game.hexLaw('spiralFeast')) {
    for (const other of game.mages) {
      if (!other.alive || other === m || dist(other.pos, m.pos) > R(2) + other.bodyRadius()) continue;
      game.orbitAround(other, m.pos, game.rng.chance(0.5));
      drink(game, m, dealDamage(game.quietContext(m, other), other, dmg(game.rng.roll('1d3').total, 'corrosive'), { ...QUIET, aoe: true }));
    }
  }
  if (lawOwner(game, 'unseenHunger') === m) {
    for (const prey of game.mages) {
      if (!prey.alive || prey.team === m.team || !prey.statuses.some((s) => s.kind === 'dot')) continue;
      lawHit(game, m, prey, corrosive('1d6'), true);
      if (prey.alive) applyInvisibility(game.quietContext(m, prey), prey, { duration: 1, mode: 'partial' });
    }
  }
  if (rooted && game.hexLaw('shackleCurse')) lawHit(game, lawOwner(game, 'shackleCurse') ?? m, m, shadowHit('1d4'), false);
  const storm = game.hexLaw('brainstorm');
  if (storm && lawOwner(game, 'brainstorm') === m) brainstorm(game, m, storm.power ?? 0);
  const terrors = game.hexLaw('nightTerrors');
  if (terrors && m.maxSanity > 0 && !m.isImmuneTo('sanity') && m.sanity * 2 <= m.maxSanity) {
    game.log(`Night Terrors grip ${m.name}.`);
    lawHit(game, lawOwner(game, 'nightTerrors') ?? m, m, { spec: '1d4', type: 'sanity' }, false);
    // Statuses age right after this hook: 2 lasts until its next turn.
    forgetWords(game, m, 1, 2);
  }
  if (game.hexLaw('blackUndertow') && m.alive) {
    const pool = [...game.shadows].sort((a, b) => dist(a, m.pos) - dist(b, m.pos))[0];
    if (pool) lawDrag(game, 'blackUndertow', m, { x: pool.x, y: pool.y }, 2);
    if (m.alive && game.isInShadow(m)) {
      lawHit(game, lawOwner(game, 'blackUndertow') ?? m, m, { spec: '1d4', type: 'water' }, false);
    }
  }
  if (game.hexLaw('drownedMemories') && m.alive && game.isInShadow(m)) {
    game.log(`${m.name}'s memories drown in the dark.`);
    forgetWords(game, m, 1, 2);
  }
  if (game.hexLaw('maelstrom') && m.alive) {
    const eye = fieldCentre();
    lawDrag(game, 'maelstrom', m, eye, 2);
    if (m.alive && dist(m.pos, eye) <= R(4) + m.bodyRadius()) {
      lawHit(game, lawOwner(game, 'maelstrom') ?? m, m, { spec: '2d4', type: 'sanity' }, false);
    }
  }
  if (game.hexLaw('burningTerror') && m.alive && stacksOf(m, 'fire') > 0) {
    const spec = game.isInShadow(m) ? '2d4' : '1d4';
    lawHit(game, lawOwner(game, 'burningTerror') ?? m, m, { spec, type: 'sanity' }, false);
  }
  if (game.hexLaw('dyingLight') && game.isInShadow(m) && shaken(m)) {
    game.log(`The light dies around ${m.name}.`);
    game.applyReap(m, 2, lawOwner(game, 'dyingLight') ?? m);
  }
}

/** `spec` with a flat bonus added. */
const plus = (spec: string, bonus: number): string => (bonus > 0 ? `${spec}+${bonus}` : spec);

/**
 * Brainstorm: lightning strikes the most burning unit other than its owner, friend or foe, and forks
 * once more per 8 power. Each strike sets the unit's Fire and Blueflare off at once. With nobody
 * burning it strikes the nearest enemy and sets it alight.
 */
function brainstorm(game: GameState, m: Mage, power: number): void {
  const burning = (u: Mage): number => stacksOf(u, 'fire') + stacksOf(u, 'blueflare');
  let struck = game.mages
    .filter((o) => o.alive && o !== m && burning(o) > 0)
    .sort((a, b) => burning(b) - burning(a) || dist(a.pos, m.pos) - dist(b.pos, m.pos))
    .slice(0, 1 + Math.floor(power / 8));
  const kindle = struck.length === 0;
  if (kindle) {
    const foe = game.mages
      .filter((o) => o.alive && o.team !== m.team)
      .sort((a, b) => dist(a.pos, m.pos) - dist(b.pos, m.pos))[0];
    struck = foe ? [foe] : [];
  }
  const bonus = Math.floor(power / 5);
  let from = m.pos;
  for (const u of struck) {
    game.log(`Brainstorm strikes ${u.name}.`);
    void game.vfxSink?.lightningBolt?.(from, u.pos);
    from = u.pos;
    lawHit(game, m, u, { spec: plus('1d6', bonus), type: 'heat' }, false);
    lawHit(game, m, u, { spec: plus('1d6', bonus), type: 'sanity' }, false);
    if (!u.alive) continue;
    if (kindle) {
      const ctx = game.quietContext(m, u);
      applyFireStacks(ctx, u, 2);
      if (u.alive) applyBlueflareStacks(ctx, u, 2);
    } else {
      game.pulseFire(u);
      game.pulseBlueflare(u);
    }
  }
}

/** As a unit's turn ends: Panic Tide frightens whoever ends it against a wall; Stillness Law hides or corrodes. */
export function lawTurnEnd(game: GameState, m: Mage): void {
  if (!m.alive) return;
  if (game.hexLaw('panicTide') && nearWallOrEdge(game, m, R(2))) {
    lawHit(game, lawOwner(game, 'panicTide') ?? m, m, { spec: '1d4', type: 'sanity' }, false);
  }
  const law = game.hexLaw('stillness');
  if (!law || !m.alive) return;
  const owner = game.mages[law.ownerIndex ?? -1] ?? m;
  const ctx = game.quietContext(owner, m);
  if (m.distMovedThisTurn < 1) {
    applyInvisibility(ctx, m, { duration: 2, mode: 'partial' });
    return;
  }
  const dice = Math.min(3, Math.floor(m.distMovedThisTurn / R(2)));
  if (dice > 0) dealDamage(ctx, m, dmg(game.rng.roll(`${dice}d2`).total, 'corrosive'), QUIET);
}

/** Round-end laws: Passing Rot moves every damage-over-time on, Neural Storm strikes the most charged mind, the tides run. */
export function lawRoundEnd(game: GameState): void {
  neuralStorm(game);
  turningTide(game);
  tideRemembers(game);
  driftShadows(game);
  squall(game);
  firestorm(game);
  screamingSky(game);
  stormOfAgony(game);
  passDots(game, 'passingRot');
  passDots(game, 'passingThirst');
}

/** Passing Rot / Passing Thirst: every damage-over-time moves on to the nearest other unit within 4cm, biting the one it leaves. */
function passDots(game: GameState, kind: 'passingRot' | 'passingThirst'): void {
  const law = game.hexLaw(kind);
  if (!law) return;
  const owner = game.mages[law.ownerIndex ?? -1];
  const moves: { from: Mage; to: Mage; dot: DotStatus }[] = [];
  for (const bearer of game.mages) {
    if (!bearer.alive) continue;
    for (const status of bearer.statuses) {
      if (status.kind !== 'dot') continue;
      const next = nearestOther(game, bearer, R(4), [bearer]);
      if (next && !next.isDebuffImmune()) moves.push({ from: bearer, to: next, dot: status as DotStatus });
    }
  }
  for (const move of moves) {
    move.from.statuses = move.from.statuses.filter((s) => s !== move.dot);
    move.to.statuses.push(move.dot);
    if (move.from.alive) {
      const bite = dealDamage(game.quietContext(owner ?? move.from, move.from), move.from, dmg(game.rng.roll('1d3').total, 'corrosive'), QUIET);
      const laidBy = move.dot.sourceIndex != null ? game.mages[move.dot.sourceIndex] : undefined;
      if (kind === 'passingThirst' && laidBy && laidBy !== move.from) drink(game, laidBy, bite);
    }
    game.log(`${move.dot.name} passes from ${move.from.name} to ${move.to.name}.`);
  }
}

/** Neural Storm: lightning strikes the unit carrying the most Mindconduct, then halves its charge. */
function neuralStorm(game: GameState): void {
  const law = game.hexLaw('neuralStorm');
  if (!law) return;
  const charged = game.mages.filter((m) => m.alive && m.lightningMindStacks > 0);
  if (charged.length === 0) return;
  const most = Math.max(...charged.map((m) => m.lightningMindStacks));
  const struck = game.rng.pick(charged.filter((m) => m.lightningMindStacks === most));
  const base = game.rng.roll('1d3').total + Math.floor((law.power ?? 0) / 6);
  const amount = Math.ceil(mindLightningDamage(base, struck.lightningMindStacks));
  game.log(`Neural Storm strikes ${struck.name}.`);
  void game.vfxSink?.lightningBolt?.({ x: struck.x, y: struck.y - R(4) }, struck.pos);
  lawHit(game, lawOwner(game, 'neuralStorm') ?? struck, struck, { spec: String(amount), type: 'sanity' }, false);
  struck.lightningMindStacks = Math.floor(struck.lightningMindStacks / 2);
}

/** Where the Turning Tide runs, round by round: right, down, left, up. */
const TIDE_HEADINGS: readonly Vec2[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
const TIDE_NAMES = ['right', 'down', 'left', 'up'];

/** Turning Tide: every unit is carried 3cm one way, and the tide turns a quarter for the next round. */
function turningTide(game: GameState): void {
  const law = game.hexLaw('turningTide');
  if (!law) return;
  const phase = (law.phase ?? 0) % 4;
  law.phase = phase + 1;
  const heading = TIDE_HEADINGS[phase];
  const owner = lawOwner(game, 'turningTide');
  game.log(`The tide runs ${TIDE_NAMES[phase]}.`);
  // The units furthest downstream move first, so nobody is held back by a body the tide is about to carry off.
  const ahead = (m: Mage): number => m.x * heading.x + m.y * heading.y;
  const carried = game.mages.filter((m) => shovable(game, m)).sort((a, b) => ahead(b) - ahead(a));
  game.hexLawDepth += 1;
  try {
    for (const m of carried) {
      if (!m.alive) continue;
      game.forceMove(owner ?? m, m, { x: m.x + heading.x * R(3), y: m.y + heading.y * R(3) });
    }
  } finally {
    game.hexLawDepth -= 1;
  }
}

/** Where everyone stands right now, as The Tide Remembers keeps it. */
export function tideAnchors(game: GameState): Record<number, Vec2> {
  const anchors: Record<number, Vec2> = {};
  game.mages.forEach((m, i) => {
    if (m.alive) anchors[i] = { x: m.x, y: m.y };
  });
  return anchors;
}

/** The Tide Remembers: every unit is drawn up to 3cm back toward where it stood as the round began. */
function tideRemembers(game: GameState): void {
  const law = game.hexLaw('tideRemembers');
  if (!law) return;
  const owner = lawOwner(game, 'tideRemembers');
  const anchors = law.anchors ?? {};
  game.hexLawDepth += 1;
  try {
    game.mages.forEach((m, i) => {
      const at = anchors[i];
      if (at && dist(at, m.pos) >= R(0.5)) drawToward(game, owner ?? m, m, at, 3);
    });
  } finally {
    game.hexLawDepth -= 1;
  }
  law.anchors = tideAnchors(game);
}

/** Drowned Memories: every conjured shadow drifts 2cm toward the nearest enemy of its side. */
function driftShadows(game: GameState): void {
  if (!game.hexLaw('drownedMemories') || game.shadows.length === 0) return;
  for (const pool of game.shadows) {
    const prey = game.mages
      .filter((m) => m.alive && m.team !== pool.owner && !game.isUnreachable(m))
      .sort((a, b) => dist(a.pos, pool) - dist(b.pos, pool) || game.mages.indexOf(a) - game.mages.indexOf(b))[0];
    if (!prey) continue;
    const to = stepTowards(pool, prey.pos, R(2));
    pool.x = to.x;
    pool.y = to.y;
  }
  game.log('The shadows drift with the current.');
}

/**
 * Squall: lightning strikes the unit carrying the most Fire, friend or foe (anyone when nobody burns).
 * The thunderclap throws everyone near it away and sets them alight.
 */
function squall(game: GameState): void {
  const law = game.hexLaw('squall');
  if (!law) return;
  const living = game.mages.filter((m) => m.alive && !game.isUnreachable(m));
  if (living.length === 0) return;
  const most = Math.max(...living.map((m) => stacksOf(m, 'fire')));
  const struck = game.rng.pick(most > 0 ? living.filter((m) => stacksOf(m, 'fire') === most) : living);
  game.log(`The squall strikes ${struck.name}.`);
  game.hexLawDepth += 1;
  try {
    thunderclapOn(game, lawOwner(game, 'squall') ?? struck, struck, {
      hits: [{ spec: plus('2d6', Math.floor((law.power ?? 0) / 6)), type: 'heat' }],
      radius: R(3),
      cm: 2,
      splashFire: 1,
    });
  } finally {
    game.hexLawDepth -= 1;
  }
}

/** Firestorm: lightning sets off every burning unit at round end, friend or foe, and darkens the burn. */
function firestorm(game: GameState): void {
  const law = game.hexLaw('firestorm');
  if (!law) return;
  const burning = game.mages.filter((m) => m.alive && !game.isUnreachable(m) && stacksOf(m, 'fire') > 0);
  if (burning.length === 0) return;
  const owner = lawOwner(game, 'firestorm');
  const spec = plus('1d4', Math.floor((law.power ?? 0) / 6));
  game.log('The firestorm strikes every burning unit.');
  game.hexLawDepth += 1;
  try {
    for (const m of burning) {
      void game.vfxSink?.lightningBolt?.({ x: m.x, y: m.y - R(4) }, m.pos);
      game.pulseFire(m);
      if (m.alive) dealDamage(game.quietContext(owner ?? m, m), m, dmg(game.rng.roll(spec).total, 'shadow'), QUIET);
    }
  } finally {
    game.hexLawDepth -= 1;
  }
}

/** Screaming Sky: lightning strikes the least sane mind at round end, friend or foe. */
function screamingSky(game: GameState): void {
  const law = game.hexLaw('screamingSky');
  if (!law) return;
  const minds = game.mages.filter((m) => m.alive && !game.isUnreachable(m) && !m.isImmuneTo('sanity') && m.maxSanity > 0);
  if (minds.length === 0) return;
  const least = Math.min(...minds.map((m) => m.sanity));
  const struck = game.rng.pick(minds.filter((m) => m.sanity === least));
  const owner = lawOwner(game, 'screamingSky') ?? struck;
  const bonus = Math.floor((law.power ?? 0) / 6);
  game.log(`The sky screams at ${struck.name}.`);
  void game.vfxSink?.lightningBolt?.({ x: struck.x, y: struck.y - R(4) }, struck.pos);
  lawHit(game, owner, struck, { spec: plus(game.isInShadow(struck) ? '2d6' : '1d6', bonus), type: 'sanity' }, false);
  lawHit(game, owner, struck, { spec: plus('1d6', bonus), type: 'shadow' }, false);
}

/** Storm of Agony: every unit rolls at round end; a 1 is struck, a 6 sends the bolt on to its nearest neighbour. */
function stormOfAgony(game: GameState): void {
  const law = game.hexLaw('stormOfAgony');
  if (!law) return;
  const power = law.power ?? 0;
  const bonus = Math.floor(power / 6);
  const reach = R(Math.max(3, power / 2));
  const owner = lawOwner(game, 'stormOfAgony');
  for (const m of game.mages.filter((u) => u.alive && !game.isUnreachable(u))) {
    if (!m.alive) continue;
    const roll = game.rng.die(6);
    const struck = roll === 1 ? m : roll === 6 ? nearestOther(game, m, reach, [m]) : null;
    if (!struck) continue;
    game.log(roll === 1 ? `Lightning strikes ${struck.name}.` : `Lightning leaps from ${m.name} into ${struck.name}.`);
    void game.vfxSink?.lightningBolt?.(roll === 1 ? { x: m.x, y: m.y - R(4) } : m.pos, struck.pos);
    lawHit(game, owner ?? struck, struck, { spec: plus('1d6', bonus), type: 'heat' }, false);
    lawHit(game, owner ?? struck, struck, { spec: plus('1d6', bonus), type: 'sanity' }, false);
  }
}

/** Burning Frenzy: a unit that loses sanity flares, and Fire leaps onto every other unit within 1d6cm of it. */
function frenzyFlare(game: GameState, m: Mage): void {
  const reach = game.rng.die(6);
  const caught = game.mages.filter(
    (o) => o.alive && o !== m && !game.isUnreachable(o) && dist(o.pos, m.pos) <= R(reach) + o.bodyRadius()
  );
  game.log(`${m.name} flares: Fire leaps ${reach}cm.`);
  const owner = lawOwner(game, 'burningFrenzy') ?? m;
  game.hexLawDepth += 1;
  try {
    for (const o of caught) applyFireStacks(game.quietContext(owner, o), o, 1);
  } finally {
    game.hexLawDepth -= 1;
  }
}

/** Burning Frenzy: Fire burns the mind as well, for half its damage rounded up. `dot`: a Fire tick, not a blast. */
export function lawFireBurns(ctx: EffectContext, m: Mage, rolled: number, dot: boolean): void {
  if (!ctx.game.hexLaw('burningFrenzy') || !m.alive || rolled <= 0) return;
  dealDamage(ctx, m, dmg(Math.ceil(rolled / 2), 'sanity'), { ...QUIET, dot });
}

/** Extra damage a law adds to one DoT tick on `bearer`. */
export function lawDotBonus(game: GameState, bearer: Mage, dot: DotStatus): number {
  let bonus = 0;
  if (game.hexLaw('fester') && dot.damage.type === 'corrosive' && bearer.isStunned('movement')) {
    bonus += game.rollDotDamage(dot);
  }
  if (game.hexLaw('festeringThirst') && dot.damage.type === 'corrosive' && bearer.isStunned('movement')) {
    bonus += game.rollDotDamage(dot);
  }
  if (game.hexLaw('eternalRot') && game.isDesecrationAffected(bearer)) bonus += 1;
  if (game.hexLaw('creepingShroud')) bonus += 1;
  return bonus;
}

/** After a DoT tick: Feeding Rot feeds whoever laid it; Creeping Shroud veils the bearer; a mind losing sanity flares under Burning Frenzy. */
export function lawAfterDotTick(game: GameState, bearer: Mage, dot: DotStatus, dealt: number): void {
  const source = dot.sourceIndex != null ? game.mages[dot.sourceIndex] : undefined;
  if (game.hexLaw('feedingRot') && dealt > 0 && dot.lifestealToIndex == null && source && source !== bearer) {
    drink(game, source, dealt);
  }
  const laidBy = source && source !== bearer && source.alive ? source : undefined;
  if (laidBy && dealt > 0 && dot.lifestealToIndex == null) {
    const rooted = bearer.isStunned('movement');
    if (game.hexLaw('festeringThirst') && dot.damage.type === 'corrosive' && rooted) drink(game, laidBy, dealt);
    if (game.hexLaw('eternalThirst') && game.isDesecrationAffected(bearer)) drink(game, laidBy, dealt);
  }
  if (laidBy && game.hexLaw('curseOfThirst')) lawHit(game, laidBy, bearer, corrosive('1d3'), true);
  // Ticks land at the bearer's turn start, before its statuses age: 2 lasts until its next turn.
  if (game.hexLaw('creepingShroud') && bearer.alive) {
    applyInvisibility(game.quietContext(source ?? bearer, bearer), bearer, { duration: 2, mode: 'partial' });
  }
  if (game.hexLaw('burningFrenzy') && dot.damage.type === 'sanity' && dealt > 0) frenzyFlare(game, bearer);
  if (game.hexLaw('stigmata') && dealt > 0 && game.isDesecrationAffected(bearer)) {
    lawHit(game, lawOwner(game, 'stigmata') ?? bearer, bearer, pierce('1d4'), false);
  }
}

/** Healing laws: units Desecrate may harm cannot be healed under these. */
export function lawBlocksHealing(game: GameState, target: Mage): boolean {
  if (!game.isDesecrationAffected(target)) return false;
  return !!(game.hexLaw('rottingWorld') || game.hexLaw('impaling') || game.hexLaw('worldFeeds') || game.hexLaw('gorgingWorld'));
}

/** Quarantine: a unit carrying a damage-over-time is hidden from its own side. */
export function lawQuarantines(game: GameState, m: Mage, from: Mage): boolean {
  return !!game.hexLaw('quarantine') && from !== m && from.team === m.team && m.statuses.some((s) => s.kind === 'dot');
}

/** Gagging Bonds stifles whoever is rooted; Choking Mist chokes a rooted veil away; Thorned Fetters drives thorns in; Breaking Point snaps a doubled root. */
export function lawOnRoot(ctx: EffectContext, target: Mage, already = false): void {
  const game = ctx.game;
  if (already && game.hexLaw('breakingPoint') && target.alive) {
    target.statuses = target.statuses.filter((s) => !(s.kind === 'stun' && s.stunType === 'movement'));
    game.log(`${target.name} strains against a second binding and breaks free.`);
    lawHit(game, ctx.caster, target, { spec: '2d6', type: 'shatter' }, false);
    applyStifle(ctx, target);
    return;
  }
  if (game.hexLaw('gaggingBonds') && target.alive) applyStifle(ctx, target);
  if (game.hexLaw('chokingMist') && target.alive && target.getInvisibility()) {
    target.statuses = target.statuses.filter((s) => s.kind !== 'invisibility');
    game.log(`The mist chokes ${target.name}'s veil away.`);
    lawHit(game, ctx.caster, target, corrosive('1d4'), true);
  }
  if (game.hexLaw('thornedFetters') && target.alive) {
    applyDot(ctx, target, { name: 'Thorned Fetters', key: 'dot:law-thorned-fetters', duration: 3, damage: dmg(0, 'pierce'), damageSpec: '1d3' });
  }
}

/** Choking Mist: a rooted unit cannot be veiled. */
export function lawVeilBlocked(game: GameState, m: Mage): boolean {
  return !!game.hexLaw('chokingMist') && m.isStunned('movement');
}

/** Thirsting Veil: every veil lasts a turn longer. */
export function lawVeilDuration(game: GameState, turns: number): number {
  return game.hexLaw('thirstingVeil') ? turns + 1 : turns;
}

/** Nailed Shadows: hits cannot tear a rooted unit's veil. */
export function lawVeilHolds(game: GameState, m: Mage): boolean {
  return !!game.hexLaw('nailedShadows') && m.isStunned('movement');
}

/** Laws that tax a unit about to gain a veil. */
export function lawOnVeilGained(ctx: EffectContext, target: Mage): void {
  const game = ctx.game;
  if (!target.alive) return;
  if (game.hexLaw('veiledHunger')) {
    const feeder = game.mages
      .filter((o) => o.alive && o.team !== target.team)
      .sort((a, b) => dist(a.pos, target.pos) - dist(b.pos, target.pos) || game.mages.indexOf(a) - game.mages.indexOf(b))[0];
    lawHit(game, feeder ?? target, target, corrosive('1d4'), !!feeder);
  }
  if (game.hexLaw('huntersHex') && target.alive) {
    applyDot(game.quietContext(lawOwner(game, 'huntersHex') ?? target, target), target, {
      name: "Hunter's Mark", key: 'dot:law-hunters-mark', duration: 3, damage: dmg(0, 'shadow'), damageSpec: '1d3',
    });
  }
}

/** Laws that answer a veil torn away by a hit; `ctx.caster` struck the blow. */
export function lawOnVeilBroken(ctx: EffectContext, target: Mage): void {
  const game = ctx.game;
  if (game.hexLawDepth > 0) return;
  const law = (kind: HexLawKind): boolean => !!game.hexLaw(kind);
  if (law('glassVeils')) {
    game.hexLawDepth += 1;
    try {
      for (const victim of game.mages) {
        if (!victim.alive || victim === target || dist(victim.pos, target.pos) > R(2) + victim.bodyRadius()) continue;
        hitAll(game, game.quietContext(ctx.caster, victim), victim, [{ spec: '1d6', type: 'shatter' }, corrosive('1d3')]);
      }
      game.log(`${target.name}'s veil shatters like glass.`);
    } finally {
      game.hexLawDepth -= 1;
    }
  }
  if (!target.alive) return;
  if (law('brittleVeils')) applyStun(ctx, target, { duration: 2, type: 'full' });
  if (law('brittleSilence')) applyStifle(ctx, target);
  if (law('shatteredShroud')) {
    applyDot(ctx, target, { name: 'Shattered Shroud', key: 'dot:law-shattered-shroud', duration: 4, damage: dmg(0, 'shadow'), damageSpec: '1d4' });
  }
  if (law('shatteredThirst') && ctx.caster !== target) lawHit(game, ctx.caster, target, corrosive('1d6'), true);
}

/** Gagging Bonds: a rooted unit cannot react. Silent Veil: a veiled unit cannot react. Pinning Law: your rooted enemies cannot. */
export function lawCannotReact(game: GameState, m: Mage): boolean {
  if (game.hexLaw('gaggingBonds') && m.isStunned('movement')) return true;
  const pin = game.hexLaw('pinningLaw');
  if (pin && m.team !== pin.owner && m.isStunned('movement')) return true;
  return !!game.hexLaw('silentVeil') && game.isVeiled(m);
}

/** Brittle Bonds: a veiled unit cannot be rooted. Hexed Silence: nor can one carrying a damage over time. */
export function lawBlocksRoot(game: GameState, m: Mage): boolean {
  if (game.hexLaw('hexedSilence') && m.statuses.some((s) => s.kind === 'dot')) return true;
  return !!game.hexLaw('brittleBonds') && game.isVeiled(m);
}

/** Crushing Law doubles a slam and adds acid to it; Grinding Thirst doubles it and drinks; Panic Tide adds dread. */
export function lawSlam(game: GameState): { mult: number; extras: (Hit & { drink?: boolean })[] } {
  const extras: (Hit & { drink?: boolean })[] = [];
  if (game.hexLaw('crushing')) extras.push(corrosive('1d6'));
  if (game.hexLaw('grindingThirst')) extras.push({ ...corrosive('1d6'), drink: true });
  if (game.hexLaw('panicTide')) extras.push({ spec: '1d6', type: 'sanity' });
  return { mult: game.hexLaw('crushing') || game.hexLaw('grindingThirst') ? 2 : 1, extras };
}

/** A unit spun into a wall or the field edge takes `hit` (and whatever Crushing Law and Panic Tide add). */
export function slamInto(ctx: EffectContext, victim: Mage, hit?: Hit): void {
  const game = ctx.game;
  if (!victim.alive) return;
  if (hit) {
    game.slamDamage(ctx, victim, game.rng.roll(hit.spec).total, hit.type, QUIET);
  } else {
    const extras = lawSlam(game).extras;
    if (extras.length === 0) return;
    for (const extra of extras) {
      if (!victim.alive) continue;
      const dealt = dealDamage(ctx, victim, dmg(game.rng.roll(extra.spec).total, extra.type), QUIET);
      if (extra.drink && ctx.caster !== victim) drink(game, ctx.caster, dealt);
    }
  }
  game.log(`${victim.name} is slammed into something immovable.`);
}

// -----------------------------------------------------------------------------
//  BIND / TWIST statuses shared by several spells
// -----------------------------------------------------------------------------

/** Where a tethered walker may end up: never further from its anchor than the leash allows. */
export function clampToTethers(game: GameState, mover: Mage, from: Vec2, to: Vec2): Vec2 {
  let dest = to;
  for (const status of mover.statuses) {
    if (status.kind !== 'tether') continue;
    const tether = status as TetherStatus;
    const anchor = game.mages[tether.anchorIndex];
    if (!anchor?.alive) continue;
    const limit = Math.max(tether.leash, dist(from, anchor.pos));
    if (dist(dest, anchor.pos) > limit) dest = stepTowards(anchor.pos, dest, limit);
  }
  return dest;
}

// -----------------------------------------------------------------------------
//  STIFLE — Twist's denial: a declared action fails before it begins
// -----------------------------------------------------------------------------

/** The victim's next declared action other than moving fails, dealing `spec` to it. */
export function applyStifle(
  ctx: EffectContext,
  victim: Mage,
  opts: { spec?: string; type?: DamageType; turns?: number; drink?: boolean } = {}
): void {
  const game = ctx.game;
  if (!victim.alive || game.isUnreachable(victim)) return;
  if (victim.isDebuffImmune()) {
    game.log(`${victim.name} cannot be stifled.`);
    return;
  }
  addOrExtendStatus(
    victim.statuses,
    {
      key: 'stifle',
      name: 'Stifled',
      kind: 'stifle',
      duration: opts.turns ?? 3,
      ownerIndex: game.mages.indexOf(ctx.caster),
      spec: opts.spec,
      type: opts.type,
      drink: opts.drink,
    },
    false
  );
  game.log(`${victim.name}'s next action will be stifled.`);
}

/**
 * A declared action meets a stifle (the status, Lockdown or Smothering Curse)
 * and fails before it begins. Returns true when it was stopped.
 */
export function stifleDeclaration(game: GameState, item: StackItem): boolean {
  const actor = item.source;
  if (item.kind === 'move' || item.windowTrigger || !actor.alive) return false;
  let stopper: Mage | undefined;
  let hit: Hit | null = null;
  let drinks = false;
  let unbinds = false;
  const status = actor.statuses.find((s) => s.kind === 'stifle') as StifleStatus | undefined;
  const afflictions = actor.statuses.filter((s) => s.kind === 'dot').length;
  if (status) {
    actor.statuses = actor.statuses.filter((s) => s !== status);
    stopper = game.mages[status.ownerIndex];
    if (status.spec) hit = { spec: status.spec, type: status.type ?? 'corrosive' };
    drinks = !!status.drink;
  } else if (actor.isStunned('movement') && firstThisRound(game, 'lockdown', actor)) {
    stopper = lawOwner(game, 'lockdown');
    hit = corrosive('1d3');
  } else if (actor.isStunned('movement') && firstThisRound(game, 'gnawingLockdown', actor)) {
    stopper = nearestOther(game, actor, Infinity, [actor], (m) => m.team !== actor.team) ?? undefined;
    hit = corrosive('1d3');
    drinks = true;
  } else if (actor.isStunned('movement') && firstThisRound(game, 'gagOrder', actor)) {
    stopper = lawOwner(game, 'gagOrder');
    unbinds = true;
  } else if (afflictions >= 2 && firstThisRound(game, 'smotheringCurse', actor)) {
    stopper = lawOwner(game, 'smotheringCurse');
  } else {
    return false;
  }
  game.log(`${actor.name}'s ${item.label} is stifled.`);
  game.vfxSink?.combatFeedback?.(actor, { kind: 'blocked', label: 'STIFLED' });
  const from = stopper?.alive ? stopper : actor;
  if (hit) lawHit(game, from, actor, hit, drinks);
  if (unbinds) {
    actor.statuses = actor.statuses.filter((s) => !(s.kind === 'stun' && s.stunType === 'movement'));
    game.log(`The gag loosens ${actor.name}'s bonds.`);
  }
  if (game.hexLaw('hexedSilence') && actor.alive && actor.statuses.some((s) => s.kind === 'dot')) {
    game.log(`${actor.name}'s silence sets its curses off.`);
    game.hexLawDepth += 1;
    try {
      game.tickDotsNow(actor, from);
    } finally {
      game.hexLawDepth -= 1;
    }
  }
  if (game.hexLaw('stifledThirst') && from !== actor) lawHit(game, from, actor, corrosive('1d6'), true);
  if (game.hexLaw('silentVeil') && actor.alive) {
    applyInvisibility(game.quietContext(from, actor), actor, { duration: 1, mode: 'partial' });
  }
  return true;
}
