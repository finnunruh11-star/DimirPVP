// =============================================================================
//  GOD-WORD KIT
// -----------------------------------------------------------------------------
//  Engine pieces the god-word class spells share: Stop minions and gear that
//  cancel an action the moment it is declared, and gear that acts as its
//  bearer's turn ends.
// =============================================================================

import type { GameState } from '../core/GameState';
import type { Mage } from '../core/Mage';
import type { StackItem } from '../core/Stack';
import type { DotStatus } from '../core/Status';
import { dist } from '../core/utils';
import { IMBUES, imbuesOf, MINIONS, runHitEffects, runPulse, type HitEffect } from './classKit';
import { teleport } from './effects';

/** Curse Desecrate's mark: whatever dies under it walks again for whoever laid it. */
export const UNBURIED = 'Unburied Curse';

/** Two bodies trade places through a fold (nothing between stops it). */
export function swapPlaces(game: GameState, owner: Mage, a: Mage, b: Mage): boolean {
  if ([a, b].some((m) => !m.alive || game.isImmovable(m) || m.displacementImmune)) return false;
  const pa = { ...a.pos };
  const pb = { ...b.pos };
  teleport(game.quietContext(owner, a), a, pb);
  teleport(game.quietContext(owner, b), b, pa, a);
  game.log(`${a.name} and ${b.name} trade places.`);
  return true;
}

/** A unit that dies under an Unburied Curse rises as its curser's Remnant. */
export function godDeathRites(game: GameState, corpse: Mage): void {
  const curse = corpse.statuses.find((s) => s.kind === 'dot' && s.name === UNBURIED) as DotStatus | undefined;
  const owner = curse?.sourceIndex != null ? game.mages[curse.sourceIndex] : undefined;
  if (owner?.alive && owner.team !== corpse.team) game.raiseThrall(corpse, owner);
}

/** Round each stopper (a minion, or a piece of gear) last stopped something. */
const lastStop = new WeakMap<object, number>();

function stopWith(game: GameState, stopper: object, by: Mage, owner: Mage, item: StackItem, then?: HitEffect[]): true {
  const actor = item.source;
  lastStop.set(stopper, game.round);
  game.log(`${by.name} stops ${actor.name}'s ${item.label} before it begins.`);
  game.vfxSink?.godFx?.('sphere', actor.pos, { size: actor.bodyRadius() * 5, color: 0x9ee7ff });
  if (then?.length && actor.alive) {
    runHitEffects({ striker: by, victim: actor, dealt: 0, drinker: owner, ctx: game.quietContext(by, actor) }, then);
  }
  return true;
}

/** A Stop minion near the actor, or Stop gear on what it aims at, cancels a declared action. */
export function godStops(game: GameState, item: StackItem): boolean {
  const actor = item.source;
  if (item.kind === 'move' || item.windowTrigger || !actor.alive) return false;
  for (const m of game.mages) {
    const stops = m.alive && m.isSummon && m.team !== actor.team ? MINIONS[m.summonKind ?? '']?.stops : undefined;
    if (!stops || lastStop.get(m) === game.round) continue;
    if (dist(m.pos, actor.pos) > stops.radius + actor.bodyRadius()) continue;
    return stopWith(game, m, m, game.mages[m.summonOwnerIndex ?? -1] ?? m, item, stops.then);
  }
  const target = item.target;
  const spell = item.kind === 'spell' ? item.spell : undefined;
  const single = item.kind === 'melee' || (!!spell && !spell.aoe && (spell.targeting === 'enemy' || spell.targeting === 'any'));
  if (!single || !target?.alive || target.team === actor.team) return false;
  for (const imbue of imbuesOf(target)) {
    const stops = IMBUES[imbue.imbue]?.stops;
    if (!stops || lastStop.get(imbue) === game.round) continue;
    return stopWith(game, imbue, target, target, item, stops.then);
  }
  return false;
}

/** Gear that acts as its bearer's turn ends; a use each time, when it has uses. */
export function godTurnEnd(game: GameState, bearer: Mage): void {
  for (const imbue of [...imbuesOf(bearer)]) {
    const def = IMBUES[imbue.imbue];
    if (!def?.turnEnd || !bearer.alive) continue;
    runPulse(game, bearer, bearer, def.turnEnd);
    if (imbue.charges == null) continue;
    imbue.charges -= 1;
    if (imbue.charges <= 0) bearer.statuses = bearer.statuses.filter((s) => s !== imbue);
  }
}
