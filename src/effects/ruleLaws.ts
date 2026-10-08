// =============================================================================
//  RULE LAWS
// -----------------------------------------------------------------------------
//  Hexcraft laws written as data: which moment of the fight they answer (a hit,
//  a turn's start or end, a round's end, a death), whom they watch and the hit
//  effects they set off. A wave registers one under a `rule:` kind; the field
//  then runs it like any other law. Their own hits never set off another law.
// =============================================================================

import type { DamageType } from '../core/Damage';
import type { GameState, HexcraftGlobalEffect } from '../core/GameState';
import type { Mage } from '../core/Mage';
import { dist } from '../core/utils';
import { runHitEffects, type HitEffect, type RuleLawKind } from './classKit';
import type { EffectContext } from './effects';

/** Whom a law watches, seen from the side that laid it. */
export type LawWho = 'all' | 'foes' | 'allies' | 'affected';

export interface RuleLaw {
  name: string;
  /** A landed hit on a watched unit: `then` lands on it, its attacker acting (what the hit dealt is passed on). */
  hit?: { types?: DamageType[]; who?: LawWho; then: HitEffect[] };
  /** A watched unit begins its turn (`burning`: only while it burns): `then` lands on it, the law's caster acting. */
  turn?: { who?: LawWho; burning?: boolean; then: HitEffect[] };
  /** As `turn`, once the unit's actions for the turn are counted out (so they can be taken away). */
  refilled?: { who?: LawWho; then: HitEffect[] };
  /** A watched unit ends its turn: `then` lands on it, the law's caster acting. */
  turnEnd?: { who?: LawWho; then: HitEffect[] };
  /** A round ends: `then` lands on every watched unit, the law's caster acting. */
  roundEnd?: { who?: LawWho; then: HitEffect[] };
  /** A watched unit dies: its side within `radius` takes `kin`, its enemies there take `foes`, the corpse itself `corpse`. */
  death?: { who?: LawWho; radius: number; kin?: HitEffect[]; foes?: HitEffect[]; corpse?: HitEffect[] };
}

export const RULE_LAWS: Record<RuleLawKind, RuleLaw> = {};

interface Active {
  law: HexcraftGlobalEffect;
  rule: RuleLaw;
}

function active(game: GameState): Active[] {
  const found: Active[] = [];
  for (const law of game.hexcraftGlobals) {
    const rule = law.roundsLeft > 0 ? RULE_LAWS[law.kind as RuleLawKind] : undefined;
    if (rule) found.push({ law, rule });
  }
  return found;
}

function watches(game: GameState, law: HexcraftGlobalEffect, m: Mage, who: LawWho = 'all'): boolean {
  if (who === 'foes') return m.team !== law.owner;
  if (who === 'allies') return m.team === law.owner;
  if (who === 'affected') return !game.isMinion(m) && m.profile.primary !== 'black';
  return true;
}

/** Whoever laid the law while still standing, else `fallback`. */
function caster(game: GameState, law: HexcraftGlobalEffect, fallback: Mage): Mage {
  const owner = game.mages[law.ownerIndex ?? -1];
  return owner?.alive ? owner : fallback;
}

function land(game: GameState, actor: Mage, victim: Mage, effects: readonly HitEffect[] | undefined, dealt = 0): void {
  if (!effects?.length || !victim.alive) return;
  runHitEffects({ striker: actor, victim, dealt, drinker: actor, ctx: game.quietContext(actor, victim) }, effects);
}

/** Run `fn` as a law: nothing it does sets off another law. */
function asLaw(game: GameState, fn: () => void): void {
  game.hexLawDepth += 1;
  try {
    fn();
  } finally {
    game.hexLawDepth -= 1;
  }
}

/** A hit landed (already inside the law guard). */
export function ruleAfterHit(ctx: EffectContext, target: Mage, type: DamageType, dealt: number): void {
  const game = ctx.game;
  const attacker = ctx.caster;
  if (dealt <= 0 || attacker === target || !target.alive) return;
  for (const { law, rule } of active(game)) {
    const hit = rule.hit;
    if (!hit || (hit.types && !hit.types.includes(type)) || !watches(game, law, target, hit.who)) continue;
    land(game, attacker, target, hit.then, dealt);
  }
}

/** Run `pick(rule)` on `m` for every law that has it, the law's caster acting. */
function onUnit(
  game: GameState,
  m: Mage,
  pick: (rule: RuleLaw) => { who?: LawWho; then: HitEffect[] } | undefined
): void {
  const laws = active(game).filter(({ rule }) => pick(rule));
  if (laws.length === 0) return;
  asLaw(game, () => {
    for (const { law, rule } of laws) {
      const step = pick(rule)!;
      if (m.alive && watches(game, law, m, step.who)) land(game, caster(game, law, m), m, step.then);
    }
  });
}

/** `m` has its actions for the turn. */
export function ruleTurnRefilled(game: GameState, m: Mage): void {
  onUnit(game, m, (rule) => rule.refilled);
}

/** `m` ends its turn. */
export function ruleTurnEnd(game: GameState, m: Mage): void {
  onUnit(game, m, (rule) => rule.turnEnd);
}

/** A round has ended. */
export function ruleRoundEnd(game: GameState): void {
  for (const m of [...game.mages]) if (m.alive) onUnit(game, m, (rule) => rule.roundEnd);
}

/** `m` begins its turn. */
export function ruleTurnStart(game: GameState, m: Mage): void {
  const laws = active(game).filter(({ rule }) => rule.turn);
  if (laws.length === 0) return;
  asLaw(game, () => {
    for (const { law, rule } of laws) {
      const turn = rule.turn!;
      if (!m.alive || !watches(game, law, m, turn.who)) continue;
      if (turn.burning && !m.statuses.some((s) => s.kind === 'fire')) continue;
      land(game, caster(game, law, m), m, turn.then);
    }
  });
}

/** `corpse` just died. */
export function ruleOnDeath(game: GameState, corpse: Mage): void {
  const laws = active(game).filter(({ rule }) => rule.death);
  if (laws.length === 0) return;
  asLaw(game, () => {
    for (const { law, rule } of laws) {
      const death = rule.death!;
      if (!watches(game, law, corpse, death.who)) continue;
      const actor = caster(game, law, corpse);
      if (death.corpse?.length) {
        runHitEffects({ striker: actor, victim: corpse, dealt: 0, drinker: actor, ctx: game.quietContext(actor, corpse) }, death.corpse);
      }
      for (const m of [...game.mages]) {
        if (!m.alive || m === corpse || dist(m.pos, corpse.pos) > death.radius + m.bodyRadius()) continue;
        land(game, actor, m, m.team === corpse.team ? death.kin : death.foes);
      }
    }
  });
}
