// Lillith Belvus, the Nice and Friendly: the third bloodmoon's black boss. She
// takes the last turn of every round and cycles through three phases, with one
// quiet turn after each: graves that raise the dead unless someone stands on
// them; copies of her whose blows are only illusions (unless a copy lingers)
// while acid circles close in on the party; and one player held in the middle
// of the field, reaped ever harder, until the orbs holding them break. Pure.

import { FIELD } from '../config/constants';
import { dmg } from '../core/Damage';
import type { GameState } from '../core/GameState';
import type { Mage } from '../core/Mage';
import type { ReapStatus } from '../core/Status';
import { dist, type Vec2 } from '../core/utils';
import { cleanse, dealDamage } from '../effects/effects';
import type { EnemyKind } from './swamprun';

/** Her circles' centimetre: four or five circles, edge to edge, span the field top to bottom. */
export const LILLITH_CM = FIELD.h / 22.5;
/** Every grave and acid circle is 5cm across. */
export const LILLITH_CIRCLE_RADIUS = 2.5 * LILLITH_CM;
/** What an acid circle deals everyone in it, at each of her next two turns. */
export const LILLITH_POOL_DAMAGE = 3;
export const LILLITH_POOL_FIRES = 2;
/** What one of the orbs holding her chosen player can take. */
export const LILLITH_ORB_HP = 7;
/** She turns on another player once they put out twice her prey's damage and healing, and this much more. */
export const LILLITH_SWAP_MARGIN = 4;

const TAU = Math.PI * 2;

export type LillithPhase = 0 | 1 | 2 | 3;

export interface LillithPool {
  x: number;
  y: number;
  /** Her turns it still bites at. */
  fires: number;
}

export interface LillithState {
  /** The phase running; 0 between two. */
  phase: LillithPhase;
  /** The phase that begins once the quiet turns between are spent. */
  next: 1 | 2 | 3;
  /** Her turns left with nothing fancy before `next` begins. */
  lull: number;
  /** Players who started the fight: phase three needs two. */
  players: number;
  graves: Vec2[];
  pools: LillithPool[];
  /** How often each player has been held. */
  held: Map<Mage, number>;
  bound?: Mage;
  /** A copy fell since her last turn; when none did, one fades and its blows turn real. */
  copyFell: boolean;
  /** Her turns phase two has run. */
  phaseTurns: number;
  /** The phase running as her current turn began, until it ends. */
  turnPhase?: LillithPhase;
  /** Whom she is after. */
  prey?: Mage;
}

export interface LillithCopy {
  boss: Mage;
  /** What its blows only seemed to do, by victim. */
  seeming: Map<Mage, { hp: number; sanity: number; reap: number }>;
  prey?: Mage;
}

/** What her turn brings onto the field; the scene raises it. */
export interface LillithPlan {
  risings: { kind: EnemyKind; at: Vec2 }[];
  copies: Vec2[];
  /** Where she slips to among her copies. */
  blinkTo?: Vec2;
  orbs: Vec2[];
  banner?: string;
}

export function isLillithUnit(m: Mage): boolean {
  return m.enemyKind === 'lillith' || m.enemyKind === 'lillithCopy' || m.enemyKind === 'lillithOrb';
}

/** Phase two: one copy more than there are players. */
export function lillithCopyCount(players: number): number {
  return Math.max(1, Math.floor(players)) + 1;
}

/** Phase three: two orbs, and one more for every player past two. */
export function lillithOrbCount(players: number): number {
  return 2 + Math.max(0, Math.floor(players) - 2);
}

/** The Reap the held player gains each of her turns: 2, plus as much as they already bear. */
export function lillithHeldReap(current: number): number {
  return 2 + current;
}

/** Whether `a` puts out so much more than `b` that she turns on them. */
export function lillithOutweighs(a: number, b: number): boolean {
  return a >= Math.max(2 * b, b + LILLITH_SWAP_MARGIN);
}

export function lillithCopies(game: GameState, boss: Mage): Mage[] {
  return game.mages.filter((m) => m.alive && m.lillithCopy?.boss === boss);
}

function lillithOrbs(game: GameState, boss: Mage): Mage[] {
  return game.mages.filter((m) => m.alive && m.team === boss.team && m.enemyKind === 'lillithOrb');
}

function partyOf(game: GameState, boss: Mage): Mage[] {
  return game.livingEnemiesOf(boss).filter((m) => !m.isSummon);
}

/** A grave is held while one of the party, or one of their summons, stands on it. */
export function lillithGraveHeld(game: GameState, boss: Mage, grave: Vec2): boolean {
  return game.livingEnemiesOf(boss).some((m) => dist(m.pos, grave) <= LILLITH_CIRCLE_RADIUS);
}

function fieldSpot(game: GameState): Vec2 {
  return { x: FIELD.x + 60 + game.rng.float() * (FIELD.w - 120), y: FIELD.y + 40 + game.rng.float() * (FIELD.h - 80) };
}

/** A random spot `gap` clear of every body and of the spots already `taken`. */
function openSpot(game: GameState, gap: number, taken: readonly Vec2[] = []): Vec2 {
  let spot = fieldSpot(game);
  for (let tries = 0; tries < 24; tries++) {
    const clear =
      game.mages.every((m) => !m.alive || dist(m.pos, spot) >= gap + m.bodyRadius()) &&
      taken.every((p) => dist(p, spot) >= gap * 2);
    if (clear) break;
    spot = fieldSpot(game);
  }
  return spot;
}

function inField(p: Vec2): boolean {
  return p.x >= FIELD.x && p.x <= FIELD.x + FIELD.w && p.y >= FIELD.y && p.y <= FIELD.y + FIELD.h;
}

/** The fight begins, and phase one with it. */
export function openLillith(game: GameState, boss: Mage, players: number): void {
  boss.lillith = { phase: 0, next: 1, lull: 0, players, graves: [], pools: [], held: new Map(), copyFell: false, phaseTurns: 0 };
  beginPhase(game, boss, 1, emptyPlan());
}

function emptyPlan(): LillithPlan {
  return { risings: [], copies: [], orbs: [] };
}

/** Her stride: 1d10cm, rolled anew as each of her (or a copy's) turns begins. */
export function lillithStride(game: GameState, m: Mage): void {
  m.intrinsicMoveUnits = game.rng.die(10);
  game.log(`${m.name} moves up to ${m.intrinsicMoveUnits}cm this turn.`);
}

/**
 * Her turn begins. A phase whose end has come ends; a quiet turn passes, or the
 * next phase begins; otherwise the running phase does its work: graves raise
 * the dead, acid circles bite, the held player is reaped.
 */
export function lillithTurnStart(game: GameState, boss: Mage): LillithPlan {
  const plan = emptyPlan();
  const s = boss.lillith;
  if (!s || !boss.alive) return plan;
  if (s.phase === 1 && s.graves.every((grave) => lillithGraveHeld(game, boss, grave))) {
    endPhase(game, boss, 'Every grave is stood on: the dead stay down.');
  } else if (s.phase === 2 && !lillithCopies(game, boss).length) {
    endPhase(game, boss, `${boss.name} stands alone again.`);
  } else if (s.phase === 3 && !s.bound?.alive) {
    endPhase(game, boss, 'Nobody is left to hold: the orbs crumble.');
  }
  s.turnPhase = s.phase;
  if (s.phase === 0) {
    if (s.lull > 0) {
      s.lull -= 1;
      return plan;
    }
    beginPhase(game, boss, s.next, plan);
    return plan;
  }
  if (s.phase === 1) raiseGraves(game, boss, plan);
  else if (s.phase === 2) bitePools(game, boss);
  else if (s.bound?.alive) game.applyReap(s.bound, lillithHeldReap(game.reapOn(s.bound)), boss);
  return plan;
}

/** Once her copies stand: each living copy lays an acid circle 2cm from a player, and four more fall 6 and 9cm out; a lingering copy fades. */
export function lillithAfterSpawns(game: GameState, boss: Mage): void {
  const s = boss.lillith;
  if (!s || !boss.alive || s.phase !== 2) return;
  const copies = lillithCopies(game, boss);
  const reaches = [...copies.map(() => 2), 6, 6, 9, 9];
  for (const reach of reaches) {
    const pool = poolNear(game, boss, reach);
    if (pool) s.pools.push(pool);
  }
  game.log(`Acid circles bloom around the party. They bite at the start of ${boss.name}'s next two turns.`);
  if (s.phaseTurns > 0 && !s.copyFell && copies.length) fade(game, boss, game.rng.pick(copies));
  s.copyFell = false;
  s.phaseTurns += 1;
  if (!lillithCopies(game, boss).length) endPhase(game, boss, `${boss.name} stands alone again.`);
}

/** Her turn ended: if one phase ran all through it, she sheds every debuff. Her reading of the party starts over. */
export function lillithTurnEnd(game: GameState, m: Mage): void {
  const s = m.lillith;
  if (!s || s.turnPhase == null) return;
  const was = s.turnPhase;
  s.turnPhase = undefined;
  game.lillithOutput.clear();
  if (m.alive && was !== 0 && s.phase === was) cleanse({ ...game.effectContext(m, m, null), crit: false }, m);
}

function beginPhase(game: GameState, boss: Mage, phase: 1 | 2 | 3, plan: LillithPlan): void {
  const s = boss.lillith!;
  const party = partyOf(game, boss);
  if (phase === 1) {
    s.phase = 1;
    s.graves = [];
    for (let i = 0; i < Math.max(1, party.length); i++) s.graves.push(openSpot(game, LILLITH_CIRCLE_RADIUS, s.graves));
    plan.banner = 'Lillith opens the graves: stand on them';
    game.log(`${boss.name} opens ${s.graves.length === 1 ? 'a grave' : `${s.graves.length} graves`}. At her turn, the dead climb out of any nobody stands on.`);
    return;
  }
  if (phase === 2) {
    s.phase = 2;
    s.pools = [];
    s.copyFell = false;
    s.phaseTurns = 0;
    const taken: Vec2[] = [];
    for (let i = 0; i < lillithCopyCount(party.length); i++) taken.push(openSpot(game, boss.bodyRadius() * 2, taken));
    plan.copies = taken.slice();
    plan.blinkTo = openSpot(game, boss.bodyRadius() * 2, taken);
    plan.banner = 'Lillith splits: only one of her is real';
    game.log(`${boss.name} splits into ${plan.copies.length + 1} of herself. Only one is real; the others vanish at the first blow, and so does what they did.`);
    return;
  }
  if (s.players < 2) {
    s.phase = 0;
    s.next = 1;
    s.lull = 1;
    game.log(`${boss.name} simply fights for a while.`);
    return;
  }
  if (!party.length) return;
  const least = Math.min(...party.map((m) => s.held.get(m) ?? 0));
  const chosen = game.rng.pick(party.filter((m) => (s.held.get(m) ?? 0) === least));
  s.held.set(chosen, least + 1);
  s.phase = 3;
  s.bound = chosen;
  hold(game, boss, chosen);
  const taken: Vec2[] = [];
  for (let i = 0; i < lillithOrbCount(party.length); i++) taken.push(openSpot(game, chosen.bodyRadius() * 2, taken));
  plan.orbs = taken;
  plan.banner = `Lillith holds ${chosen.name}: break the orbs`;
}

function endPhase(game: GameState, boss: Mage, why: string): void {
  const s = boss.lillith!;
  const was = s.phase;
  if (was === 0) return;
  if (was === 1) s.graves = [];
  if (was === 2) s.pools = [];
  if (was === 3) release(game, boss);
  s.phase = 0;
  s.lull = 1;
  s.next = was === 1 ? 2 : was === 2 ? 3 : 1;
  game.log(why);
}

function raiseGraves(game: GameState, boss: Mage, plan: LillithPlan): void {
  const s = boss.lillith!;
  for (const grave of s.graves) {
    if (lillithGraveHeld(game, boss, grave)) continue;
    plan.risings.push({ kind: game.rng.chance(2 / 3) ? 'zombie' : 'wisp', at: { ...grave } });
  }
  if (plan.risings.length) game.log(`The dead climb out of ${plan.risings.length === 1 ? 'an open grave' : `${plan.risings.length} open graves`}.`);
}

function bitePools(game: GameState, boss: Mage): void {
  const s = boss.lillith!;
  for (const pool of s.pools) {
    for (const victim of game.livingEnemiesOf(boss)) {
      if (dist(victim.pos, pool) > LILLITH_CIRCLE_RADIUS) continue;
      dealDamage({ ...game.effectContext(boss, victim, null), crit: false }, victim, dmg(LILLITH_POOL_DAMAGE, 'corrosive'), {
        canMiss: false,
        aoe: true,
        noImpactFx: true,
      });
    }
    pool.fires -= 1;
  }
  s.pools = s.pools.filter((pool) => pool.fires > 0);
}

/** An acid circle centred `reach` of her centimetres from a random player. */
function poolNear(game: GameState, boss: Mage, reach: number): LillithPool | null {
  const party = partyOf(game, boss);
  if (!party.length) return null;
  const who = game.rng.pick(party);
  const r = reach * LILLITH_CM;
  const a = game.rng.float() * TAU;
  for (let k = 0; k < 8; k++) {
    const at = { x: who.x + Math.cos(a + (k * TAU) / 8) * r, y: who.y + Math.sin(a + (k * TAU) / 8) * r };
    if (inField(at)) return { ...at, fires: LILLITH_POOL_FIRES };
  }
  return null;
}

/** A copy lingered a whole round untouched: it goes, and what it did stays done. */
function fade(game: GameState, boss: Mage, copy: Mage): void {
  const victims = [...(copy.lillithCopy?.seeming.keys() ?? [])];
  copy.lillithCopy?.seeming.clear();
  copy.withdrawn = true;
  game.vfxSink?.summonPuff?.(copy.pos, 60);
  game.log(`One ${boss.name} was a copy, and it lingered: it fades, and what it did was real.`);
  for (const victim of victims) game.checkReapDeath(victim, boss);
}

/** A copy struck down: what its blows seemed to do comes undone. */
function dispel(game: GameState, copy: Mage): void {
  const c = copy.lillithCopy;
  if (!c) return;
  const spared: string[] = [];
  for (const [victim, seen] of c.seeming) {
    if (!victim.alive) continue;
    const hp = Math.max(0, Math.min(seen.hp, victim.maxHp - victim.hp));
    const sanity = Math.max(0, Math.min(seen.sanity, victim.maxSanity - victim.sanity));
    victim.hp += hp;
    victim.sanity += sanity;
    takeReap(victim, seen.reap);
    if (hp > 0) game.vfxSink?.combatFeedback?.(victim, { kind: 'heal', amount: hp, label: 'ILLUSION' });
    if (sanity > 0) game.vfxSink?.combatFeedback?.(victim, { kind: 'sanityHeal', amount: sanity });
    if (hp > 0 || sanity > 0 || seen.reap > 0) spared.push(victim.name);
  }
  c.seeming.clear();
  game.log(`That ${copy.name} was only a copy.${spared.length ? ` What it did to ${spared.join(' and ')} was never real.` : ''}`);
}

function takeReap(victim: Mage, stacks: number): void {
  const reap = victim.statuses.find((s) => s.kind === 'reap') as ReapStatus | undefined;
  if (!reap || stacks <= 0) return;
  reap.stacks = Math.max(0, reap.stacks - stacks);
  if (reap.stacks === 0) victim.statuses = victim.statuses.filter((s) => s !== reap);
}

/** The held player goes to the middle of the field and stays there. */
function hold(game: GameState, boss: Mage, victim: Mage): void {
  const centre = { x: FIELD.x + FIELD.w / 2, y: FIELD.y + FIELD.h / 2 };
  let at = centre;
  search: for (const r of [0, 30, 60, 90, 120, 150]) {
    for (let k = 0; k < (r ? 12 : 1); k++) {
      const spot = { x: centre.x + Math.cos((k * TAU) / 12) * r, y: centre.y + Math.sin((k * TAU) / 12) * r };
      if (game.mages.every((m) => m === victim || !m.alive || dist(m.pos, spot) >= m.bodyRadius() + victim.bodyRadius())) {
        at = spot;
        break search;
      }
    }
  }
  const from = victim.pos;
  victim.lillithBound = undefined;
  victim.x = at.x;
  victim.y = at.y;
  game.notifyMageRelocation(victim, from, at, false);
  victim.lillithBound = { ...victim.pos };
  game.vfxSink?.summonPuff?.(victim.pos, 70);
  game.log(`${boss.name} takes ${victim.name} to the middle of the field and holds them there: one action a turn, no walking, and her Reap at every turn of hers until the orbs break.`);
}

function release(game: GameState, boss: Mage): void {
  const s = boss.lillith!;
  if (s.bound) {
    s.bound.lillithBound = undefined;
    if (s.bound.alive) game.log(`${s.bound.name} breaks free.`);
  }
  s.bound = undefined;
  for (const orb of lillithOrbs(game, boss)) {
    orb.withdrawn = true;
    game.vfxSink?.summonPuff?.(orb.pos, 50);
  }
}

/** Something of hers fell: a copy is dispelled, the last orb frees the held, she takes her works with her. */
export function lillithOnDeath(game: GameState, fallen: Mage): void {
  if (fallen.lillith) {
    const s = fallen.lillith;
    for (const copy of lillithCopies(game, fallen)) dispel(game, copy);
    release(game, fallen);
    s.phase = 0;
    s.graves = [];
    s.pools = [];
    const works = game.mages.filter((m) => m.alive && m !== fallen && m.team === fallen.team);
    for (const m of works) {
      m.withdrawn = true;
      game.vfxSink?.summonPuff?.(m.pos, 60);
    }
    if (works.length) game.log(`With ${fallen.name} gone, her copies and her dead go with her.`);
    return;
  }
  const copy = fallen.lillithCopy;
  if (copy) {
    dispel(game, fallen);
    const s = copy.boss.lillith;
    if (!s || !copy.boss.alive) return;
    s.copyFell = true;
    if (s.phase === 2 && !lillithCopies(game, copy.boss).length) endPhase(game, copy.boss, `The last copy breaks: ${copy.boss.name} stands alone again.`);
    return;
  }
  const boss = game.mages.find((m) => m.alive && m.lillith?.phase === 3 && (m.lillith.bound === fallen || (fallen.enemyKind === 'lillithOrb' && m.team === fallen.team)));
  if (!boss) return;
  if (boss.lillith!.bound === fallen) endPhase(game, boss, 'Nobody is left to hold: the orbs crumble.');
  else if (!lillithOrbs(game, boss).length) endPhase(game, boss, 'The last orb breaks.');
}

/** Her copies wear her health and mind, whatever happens to her. */
export function mirrorLillith(game: GameState, boss: Mage): void {
  if (!boss.alive) return;
  for (const copy of lillithCopies(game, boss)) {
    copy.maxHp = boss.maxHp;
    copy.hp = boss.hp;
    copy.maxSanity = boss.maxSanity;
    copy.sanity = boss.sanity;
  }
}

/** A freshly raised unit becomes one of her copies. */
export function makeLillithCopy(game: GameState, boss: Mage, copy: Mage): void {
  copy.lillithCopy = { boss, seeming: new Map() };
  copy.name = boss.name;
  copy.intrinsicMoveUnits = boss.intrinsicMoveUnits;
  mirrorLillith(game, boss);
}

/** A copy's blow lands on one of the party: it never takes them below 1, and it is written down to be undone. */
export function lillithIllusory(source: Mage, target: Mage): boolean {
  return !!source.lillithCopy && target.team !== source.team;
}

/** A landed hit: a copy's is noted down, one on a copy pops it, one on her shows on her copies. */
export function lillithHit(game: GameState, source: Mage, target: Mage, hpLost: number, sanityLost: number): void {
  const copy = source.lillithCopy;
  if (copy && lillithIllusory(source, target) && (hpLost > 0 || sanityLost > 0)) {
    const seen = copy.seeming.get(target) ?? { hp: 0, sanity: 0, reap: 0 };
    seen.hp += hpLost;
    seen.sanity += sanityLost;
    copy.seeming.set(target, seen);
  }
  if (target.lillithCopy) target.hp = 0;
  if (target.lillith) mirrorLillith(game, target);
}

/** Her blow's rider: 1 Reap, only seeming when a copy dealt it. */
export function lillithReap(game: GameState, source: Mage, target: Mage): void {
  if (!target.alive) return;
  const copy = source.lillithCopy;
  if (copy && lillithIllusory(source, target)) {
    const seen = copy.seeming.get(target) ?? { hp: 0, sanity: 0, reap: 0 };
    seen.reap += 1;
    copy.seeming.set(target, seen);
  }
  game.applyReap(target, 1, source);
}

/** Reap on `target` that a living copy only seemed to lay. */
export function illusoryReap(game: GameState, target: Mage): number {
  let total = 0;
  for (const m of game.mages) {
    if (m.alive && m.lillithCopy) total += m.lillithCopy.seeming.get(target)?.reap ?? 0;
  }
  return total;
}
