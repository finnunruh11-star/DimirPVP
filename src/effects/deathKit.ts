// =============================================================================
//  DEATH · CLASS RITES
// -----------------------------------------------------------------------------
//  Death is a god word, and its class spells bend dying itself. They are too
//  strange for the class kit's data, so their minions and gear call in here.
//  Death's minions are too much to command: they choose their own prey among
//  your enemies and grow on the souls they take. The Shikigami is no minion:
//  it rides its caster's shoulder for the day, and spares no one.
//    Death Shadow       the Shikigami (fed with offerings), the Ferryman's
//                       Obol (someone else dies for you), Death's Holiday
//                       (nobody dies, until everyone who should does).
//    Death Pain         the Requiem (five verses, a voice per soul), the
//                       Severing Scythe (Reap and Dread), the Mortal Coil
//                       (the body follows the mind).
//    Death Shadow Pain  the Fetch (a doomed double that moves on), the Scythe
//                       of the Long Shadow (grows on kills), the Great
//                       Mourning (grief that kills).
// =============================================================================

import { RANGE_UNIT } from '../config/constants';
import { dmg, type DamageType } from '../core/Damage';
import type { GameState } from '../core/GameState';
import type { Mage } from '../core/Mage';
import type { DebuffStatus, DreadStatus } from '../core/Status';
import { dist, stepTowards } from '../core/utils';
import {
  IMBUES,
  imbuesOf,
  lawOwner,
  makeMinion,
  MINIONS,
  rushToward,
  type HexLawKind,
  type ImbueDef,
  type MinionDef,
  type Strike,
} from './classKit';
import {
  dealDamage,
  rollDice,
  type DealDamageOptions,
  type EffectContext,
  type OfferingChoice,
  type OfferingOpts,
} from './effects';

const R = (cm: number): number => cm * RANGE_UNIT;
const QUIET: DealDamageOptions = { canMiss: false, noImpactFx: true };
const DUE_KEY = 'debuff:deaths-due';

/** Death's minions: no Command reaches them. */
export const UNTAMED: ReadonlySet<string> = new Set(['requiem', 'fetch']);

/** At half its sanity or less (the mindless never are). */
const shaken = (m: Mage): boolean => m.alive && !m.isImmuneTo('sanity') && m.maxSanity > 0 && m.sanity * 2 <= m.maxSanity;

/** A summon answers for its summoner. */
function masterOf(game: GameState, m: Mage): Mage {
  return m.isSummon && m.summonOwnerIndex != null ? game.mages[m.summonOwnerIndex] ?? m : m;
}

/** `m`'s name without the verse its rite wrote after it. */
const bareName = (m: Mage): string => m.name.replace(/ \(verse \d\)$/, '');

/** Leave `m` standing, with at least 1 health and 1 sanity. */
function stand(m: Mage): void {
  m.hp = Math.max(1, m.hp);
  if (m.maxSanity > 0) m.sanity = Math.max(1, m.sanity);
}

/** The nearest living unit an untamed minion could go for. */
function nearestPrey(game: GameState, self: Mage, owner: Mage, allow: (m: Mage) => boolean = () => true): Mage | undefined {
  return game.mages
    .filter((m) => m.alive && m !== self && m !== owner && !game.isUnreachable(m) && allow(m))
    .sort((a, b) => dist(a.pos, self.pos) - dist(b.pos, self.pos) || game.mages.indexOf(a) - game.mages.indexOf(b))[0];
}

// ---- Death Shadow · Life: the Shikigami on the shoulder ------------------------

/** Most maximum health a day's Shikigami takes, and how much of it buys a point. */
const LIFE_CAP = 12;
const LIFE_PER_POINT = 4;

/** Its rank: 1 for 0-2 points, one more for every 2 points after, up to 5. */
export function shikigamiTier(points: number): number {
  return Math.max(1, Math.min(5, Math.ceil(points / 2)));
}

/** What each rank adds; a rank does everything below it as well. */
export const SHIKIGAMI_TIERS: readonly string[] = [
  'executes a random unit, friend or foe, you included, for 3',
  'marks a random unit with 1d3 Reap',
  'gives a random reaped unit half its Reap again (rounded up)',
  'a unit felled by Reap or an execution passes three quarters of its Reap to the nearest of your enemies',
  'executes every enemy whose Reap reaches half its health',
];

/** Points an offering earns: 1 per 4 maximum health, 2 for the day's items, 1 per minion. */
export function offeringPoints(choice: OfferingChoice): number {
  return Math.floor(choice.life / LIFE_PER_POINT) + (choice.items ? 2 : 0) + choice.summons.length;
}

/** What `caster` may still give: health up to 12 a day (keeping 1), the day's items once, and its minions. */
export function shikigamiOffers(game: GameState, caster: Mage): OfferingOpts {
  const room = Math.min(LIFE_CAP - (caster.shikigami?.lifePaid ?? 0), caster.maxHp - 1);
  return {
    lifeMax: Math.max(0, Math.floor(room / LIFE_PER_POINT) * LIFE_PER_POINT),
    items: !caster.shikigami?.itemsPaid,
    summons: game.summonsOf(caster),
    points: caster.shikigami?.points ?? 0,
  };
}

/** The Shikigami settles on `caster`'s shoulder, or grows, for what was offered. */
export function offerToShikigami(game: GameState, caster: Mage, choice: OfferingChoice): void {
  const offers = shikigamiOffers(game, caster);
  const rite = (caster.shikigami ??= { points: 0, day: caster.stormDay, lifePaid: 0, itemsPaid: false });
  const life = Math.max(0, Math.min(offers.lifeMax, Math.floor(choice.life / LIFE_PER_POINT) * LIFE_PER_POINT));
  const items = choice.items && offers.items;
  const summons = choice.summons.filter((m) => offers.summons.includes(m));
  if (life > 0) {
    caster.maxHp -= life;
    caster.hp = Math.min(caster.hp, caster.maxHp);
    rite.lifePaid += life;
    game.log(`${caster.name} gives ${life} maximum health to the Shikigami for the day.`);
  }
  if (items) {
    rite.itemsPaid = true;
    game.log(`${caster.name} gives the use of their items to the Shikigami for the day.`);
  }
  for (const m of summons) game.defeatMage(m, caster, `${caster.name} gives ${m.name} to the Shikigami.`);
  rite.points += offeringPoints({ life, items, summons });
  game.log(`The Shikigami on ${caster.name}'s shoulder holds ${rite.points} points: rank ${shikigamiTier(rite.points)}.`);
  game.vfxSink?.godFx?.('skull', caster.pos, { size: caster.bodyRadius() * 4 });
}

/** At its rider's turn start the Shikigami acts by its rank, on anyone at all. */
export function shoulderTurn(game: GameState, rider: Mage): void {
  const rite = rider.shikigami;
  if (!rite || !rider.alive) return;
  const tier = shikigamiTier(rite.points);
  const anyone = (): Mage[] => game.mages.filter((m) => m.alive && !game.isUnreachable(m));
  const pick = (units: Mage[]): Mage | undefined => (units.length > 0 ? game.rng.pick(units) : undefined);
  game.log(`${rider.name}'s Shikigami acts.`);
  const doomed = pick(anyone());
  if (doomed) {
    game.vfxSink?.godFx?.('reap', doomed.pos, { size: doomed.bodyRadius() * 4 });
    game.executeTarget(rider, doomed, 3);
  }
  const marked = tier >= 2 ? pick(anyone()) : undefined;
  if (marked) game.applyReap(marked, game.rng.roll('1d3').total, rider);
  const reaped = tier >= 3 ? pick(anyone().filter((m) => game.reapOn(m) > 0)) : undefined;
  if (reaped) game.applyReap(reaped, Math.ceil(game.reapOn(reaped) / 2), rider);
  if (tier >= 5) for (const m of anyone()) shoulderExecutes(game, m);
}

/** Rank 5: an enemy of a rider whose Reap reaches half its health is executed. */
export function shoulderExecutes(game: GameState, target: Mage): boolean {
  const reap = game.reapOn(target);
  if (reap <= 0 || !target.alive || reap * 2 < target.hp) return false;
  const rider = game.mages.find(
    (m) => m.alive && m.team !== target.team && !!m.shikigami && shikigamiTier(m.shikigami.points) >= 5
  );
  if (!rider) return false;
  game.log(`${rider.name}'s Shikigami takes ${target.name}: its Reap has reached half its health.`);
  game.vfxSink?.godFx?.('reap', target.pos, { size: target.bodyRadius() * 5 });
  return game.killByDeathWord(target, rider);
}

/** Rank 4: a unit felled by Reap or an execution passes three quarters of its Reap to the rider's nearest enemy. */
export function deathWordFell(game: GameState, dead: Mage): void {
  const reap = game.reapOn(dead);
  if (reap <= 0) return;
  for (const rider of game.mages) {
    if (!rider.alive || !rider.shikigami || shikigamiTier(rider.shikigami.points) < 4) continue;
    const heir = game.mages
      .filter((m) => m.alive && m !== dead && m.team !== rider.team && !game.isUnreachable(m))
      .sort((a, b) => dist(a.pos, dead.pos) - dist(b.pos, dead.pos) || game.mages.indexOf(a) - game.mages.indexOf(b))[0];
    if (!heir) continue;
    const passed = Math.ceil(reap * 0.75);
    game.log(`${rider.name}'s Shikigami passes ${passed} of ${dead.name}'s Reap to ${heir.name}.`);
    game.applyReap(heir, passed, rider);
  }
}

// ---- Death Shadow · Objects and Hexcraft: deaths refused --------------------

const owes = (m: Mage): boolean => m.statuses.some((s) => s.key === DUE_KEY);

/** Death's Holiday: `target` owes Death a life, and a debtor's would-be kill pays its own. */
function owe(game: GameState, target: Mage, source: Mage): void {
  if (!owes(target)) {
    const due: DebuffStatus = { key: DUE_KEY, name: "Death's Due", kind: 'debuff', duration: Infinity, mods: {} };
    target.statuses.push(due);
    game.log(`Death's Holiday: ${target.name} does not die, but owes Death a life.`);
  }
  if (source !== target && owes(source)) {
    source.statuses = source.statuses.filter((s) => s.key !== DUE_KEY);
    game.log(`${source.name} pays its debt with ${target.name}'s life.`);
  }
}

/** The Ferryman's Obol: the enemy with the most Reap, at no more than 3 health per Reap, dies in the bearer's place. */
function payTheFerryman(game: GameState, bearer: Mage): boolean {
  const obol = imbuesOf(bearer).find((s) => s.imbue === 'ferrymansObol');
  if (!obol) return false;
  bearer.statuses = bearer.statuses.filter((s) => s !== obol);
  const substitute = game.mages
    .filter((m) => m.alive && m.team !== bearer.team && game.reapOn(m) > 0 && !game.isUnreachable(m))
    .filter((m) => m.hp <= 3 * game.reapOn(m))
    .sort((a, b) => game.reapOn(b) - game.reapOn(a) || dist(a.pos, bearer.pos) - dist(b.pos, bearer.pos))[0];
  if (!substitute) {
    game.log(`The Ferryman finds no other soul to take, and takes ${bearer.name}'s.`);
    return false;
  }
  stand(bearer);
  game.log(`The Ferryman takes ${substitute.name} in ${bearer.name}'s place.`);
  game.vfxSink?.godFx?.('reap', substitute.pos, { size: substitute.bodyRadius() * 5 });
  game.addShadow(bearer.pos, bearer.team);
  game.killByDeathWord(substitute, bearer);
  return true;
}

/** Whether a death about to land is refused; if so `target` is left standing. */
export function cheatDeath(game: GameState, target: Mage, source: Mage): boolean {
  if (target.unkillable) return false;
  if (game.hexLaw('deathsHoliday')) {
    stand(target);
    owe(game, target, source);
    return true;
  }
  return payTheFerryman(game, target);
}

// ---- Death Pain · Life: the Requiem -------------------------------------------

/** It drifts toward the nearest enemy and sings its next verse to the enemies near it, louder for every voice it has taken. */
function requiemVerse(game: GameState, self: Mage, owner: Mage): void {
  const foe = (m: Mage): boolean => m.team !== owner.team;
  const prey = nearestPrey(game, self, owner, foe);
  if (prey) rushToward(game, owner, self, prey, R(4));
  const rite = (self.deathRite ??= { level: 0 });
  rite.level += 1;
  const verse = Math.min(rite.level, 5);
  const voices = rite.souls ?? 0;
  const lacrimosa = verse === 5;
  const reach = R(3 + voices);
  const hearers = game.mages.filter(
    (m) => m.alive && foe(m) && !game.isUnreachable(m) && dist(m.pos, self.pos) <= reach + m.bodyRadius()
  );
  self.name = `${bareName(self)} (verse ${verse})`;
  game.log(lacrimosa ? `${self.name} sings the Lacrimosa.` : `${self.name} sings.`);
  game.vfxSink?.godFx?.(lacrimosa ? 'skull' : 'hex', self.pos, { size: reach * 2 });
  const spec = `${Math.min(verse, 4)}d4${voices > 0 ? `+${voices}` : ''}`;
  for (const m of hearers) {
    dealDamage(game.quietContext(self, m), m, dmg(game.rng.roll(spec).total, 'sanity'), { ...QUIET, aoe: true, cause: 'Requiem' });
    if (!m.alive) continue;
    if (!lacrimosa) game.applyReap(m, 1, self);
    else if (shaken(m)) game.killByDeathWord(m, self);
  }
  if (lacrimosa) game.defeatMage(self, self, `${self.name} falls silent: the Requiem is over.`);
}

// ---- Death Pain · Objects: the Severing Scythe, and Dread -----------------------

/** Dread on `m`: Reap for the mind. */
export function dreadOn(m: Mage): number {
  return (m.statuses.find((s) => s.kind === 'dread') as DreadStatus | undefined)?.stacks ?? 0;
}

/** A mind dies at or below its Dread. */
function checkDread(game: GameState, m: Mage, source: Mage): boolean {
  const dread = dreadOn(m);
  if (dread <= 0 || !m.alive || m.maxSanity <= 0 || m.isImmuneTo('sanity') || m.sanity > dread) return false;
  game.log(`${m.name}'s mind breaks under ${dread} Dread.`);
  return game.killByDeathWord(m, source);
}

function setDread(game: GameState, m: Mage, stacks: number, source: Mage): void {
  if (!m.alive || m.maxSanity <= 0 || m.isImmuneTo('sanity') || stacks <= 0) return;
  const dread = m.statuses.find((s) => s.kind === 'dread') as DreadStatus | undefined;
  if (dread) dread.stacks = stacks;
  else m.statuses.push({ key: 'dread', name: 'Dread', kind: 'dread', duration: Infinity, stacks });
  game.log(`${m.name} is filled with ${stacks} Dread.`);
  checkDread(game, m, source);
}

/** It reaps 1d6 and fills the mind with as much Dread as the body has Reap. */
function sever(strike: Strike): void {
  const { victim, drinker, ctx } = strike;
  const game = ctx.game;
  if (!victim.alive) return;
  game.applyReap(victim, game.rng.roll('1d6').total, drinker);
  setDread(game, victim, game.reapOn(victim), drinker);
  if (victim.alive || drinker.maxSanity <= 0) return;
  drinker.sanity = Math.min(drinker.maxSanity, drinker.sanity + game.reapOn(victim));
  game.log(`${drinker.name} wears ${victim.name}'s soul.`);
  game.vfxSink?.godFx?.('reap', victim.pos, { size: victim.bodyRadius() * 5 });
}

// ---- Death Pain · Hexcraft: the Mortal Coil ------------------------------------

/** The body follows the mind: health above sanity falls to it. */
function coil(game: GameState, m: Mage, source: Mage): void {
  if (!m.alive || m.maxSanity <= 0 || m.isImmuneTo('sanity') || m.hp <= m.sanity) return;
  const lost = m.hp - m.sanity;
  m.hp = m.sanity;
  game.log(`${m.name}'s body follows its mind: ${lost} health lost.`);
  game.vfxSink?.combatFeedback?.(m, { kind: 'damage', amount: lost, label: 'MORTAL COIL' });
  game.checkReapDeath(m, source);
}

/** The Mortal Coil binds everyone the moment it is laid. */
export function bindMortalCoil(game: GameState, source: Mage): void {
  for (const m of [...game.mages]) coil(game, m, source);
}

// ---- Death Shadow Pain · Hexcraft: the Great Mourning ------------------------------

/** How deep grief is cascading; a bound on mourning the mourners. */
let grieving = 0;

function mourn(game: GameState, dead: Mage): void {
  if (!game.hexLaw('greatMourning') || grieving >= 8) return;
  const owner = lawOwner(game, 'greatMourning');
  const grief = Math.max(1, Math.ceil(dead.maxHp / 4));
  game.log(`The field mourns ${dead.name}.`);
  game.vfxSink?.godFx?.('skull', dead.pos, { size: dead.bodyRadius() * 4 });
  grieving += 1;
  game.hexLawDepth += 1;
  try {
    for (const m of [...game.mages]) {
      if (!m.alive || m === dead || game.isUnreachable(m)) continue;
      const amount = m.team === dead.team ? grief : game.rng.roll('1d4').total;
      dealDamage(game.quietContext(owner ?? m, m), m, dmg(amount, 'sanity'), { ...QUIET, aoe: true, cause: 'Mourning' });
      if (m.alive && shaken(m)) game.applyReap(m, 1, owner ?? m);
    }
  } finally {
    game.hexLawDepth -= 1;
    grieving -= 1;
  }
}

// ---- Death Shadow Pain · Life: the Fetch -----------------------------------------

const originalOf = (game: GameState, fetch: Mage): Mage | undefined =>
  fetch.summonKind === 'fetch' ? game.mages[fetch.deathRite?.originalIndex ?? -1] : undefined;

function fetchesOf(game: GameState, original: Mage): Mage[] {
  const index = game.mages.indexOf(original);
  return game.mages.filter((m) => m.alive && m.summonKind === 'fetch' && m.deathRite?.originalIndex === index);
}

/** Raise the Fetch of the targeted enemy beside it, with half the health it has now. */
export function raiseFetch(ctx: EffectContext): void {
  const original = ctx.target;
  if (!original?.alive) return;
  const game = ctx.game;
  const fetch = makeMinion('fetch', {
    ownerInt: ctx.caster.effectiveInt(),
    dcRoll: rollDice(ctx, '1d20', 'Summon vigor'),
    ownerName: ctx.caster.name,
    pos: original.pos,
    team: ctx.caster.team,
  });
  const spot = game.nearestFreePosition(fetch, stepTowards(original.pos, ctx.caster.pos, original.bodyRadius() + fetch.bodyRadius() + 4));
  fetch.x = spot.x;
  fetch.y = spot.y;
  fetch.name = `${original.name}'s Fetch`;
  fetch.maxHp = Math.max(1, Math.ceil(original.hp / 2));
  fetch.hp = fetch.maxHp;
  fetch.deathRite = { level: 0, originalIndex: game.mages.indexOf(original) };
  game.spawnSummon(fetch, ctx.caster, 'fetch');
  game.log(`${fetch.name} steps out of its shadow: an omen of its death.`);
  game.vfxSink?.godFx?.('deathMark', fetch.pos, { size: fetch.bodyRadius() * 5 });
}

function fetchStare(game: GameState, self: Mage, owner: Mage): void {
  const original = originalOf(game, self);
  if (!original?.alive || game.isUnreachable(original)) return;
  rushToward(game, owner, self, original, R(6));
  if (dist(self.pos, original.pos) > R(3) + original.bodyRadius()) return;
  game.log(`${self.name} stares at ${original.name}.`);
  const spec = `${1 + (self.deathRite?.souls ?? 0)}d4`;
  dealDamage(game.quietContext(self, original), original, dmg(game.rng.roll(spec).total, 'sanity'), { ...QUIET, cause: 'Fetch' });
}

/** Its original died first: the Fetch moves on to the nearest of its summoner's enemies. */
function fetchMovesOn(game: GameState, dead: Mage): void {
  const index = game.mages.indexOf(dead);
  for (const fetch of game.mages.filter((m) => m.alive && m.summonKind === 'fetch' && m.deathRite?.originalIndex === index)) {
    const next = nearestPrey(game, fetch, masterOf(game, fetch), (m) => m.team !== fetch.team && m.summonKind !== 'fetch');
    if (!next) {
      game.defeatMage(fetch, fetch, `${fetch.name} fades: there is no one left for it to foretell.`);
      continue;
    }
    const rite = (fetch.deathRite ??= { level: 0 });
    rite.originalIndex = game.mages.indexOf(next);
    rite.souls = (rite.souls ?? 0) + 1;
    fetch.maxHp = Math.max(1, Math.ceil(next.hp / 2));
    fetch.hp = fetch.maxHp;
    game.log(`${fetch.name} turns to its next omen: ${next.name}.`);
    fetch.name = `${next.name}'s Fetch`;
    game.vfxSink?.godFx?.('deathMark', next.pos, { size: next.bodyRadius() * 5 });
  }
}

/** Re-entry guard: a mirrored wound is not mirrored back. */
let echoing = false;

/** Every wound an original takes lands on its Fetch too; any other wound on a Fetch reaches its original as sanity. */
export function echoFetch(game: GameState, source: Mage, target: Mage, type: DamageType, amount: number): void {
  if (echoing || !game.mages.some((m) => m.alive && m.summonKind === 'fetch')) return;
  const original = originalOf(game, target);
  const fetches = original || type === 'sanity' ? [] : fetchesOf(game, target);
  echoing = true;
  try {
    if (original?.alive) {
      dealDamage(game.quietContext(source, original), original, dmg(amount, 'sanity'), { ...QUIET, cause: 'Fetch' });
    }
    for (const fetch of fetches) {
      dealDamage(game.quietContext(source, fetch), fetch, dmg(amount, type), { ...QUIET, trueDamage: true, cause: 'Omen' });
    }
  } finally {
    echoing = false;
  }
}

function fetchDies(game: GameState, fetch: Mage): void {
  const original = originalOf(game, fetch);
  if (!original?.alive) return;
  const owner = masterOf(game, fetch);
  game.log(`${original.name} sees its own death.`);
  game.vfxSink?.godFx?.('deathMark', original.pos, { size: original.bodyRadius() * 5 });
  game.addShadow(original.pos, owner.team);
  if (shaken(original)) game.killByDeathWord(original, owner);
  else game.executeTarget(owner, original, 6);
}

// ---- Death Shadow Pain · Objects: the Scythe of the Long Shadow -------------------

/** Its shadow starts short and grows with every unit it kills, blow or shadow. */
function longShadow(strike: Strike): void {
  const { striker, victim, drinker, ctx } = strike;
  const game = ctx.game;
  const scythe = imbuesOf(striker).find((s) => s.imbue === 'longShadow');
  if (!scythe) return;
  const reaped = (dead: Mage): void => {
    scythe.souls = (scythe.souls ?? 0) + 1;
    scythe.name = `${IMBUES.longShadow.name} (${scythe.souls} soul${scythe.souls === 1 ? '' : 's'})`;
    game.addShadow(dead.pos, drinker.team);
    game.log(`${dead.name} leaves its shadow behind, and the scythe's shadow grows.`);
  };
  if (!victim.alive) reaped(victim);
  const souls = scythe.souls ?? 0;
  const reach = R(3 + 3 * souls);
  const caught = game.mages.filter(
    (m) =>
      m.alive &&
      m !== victim &&
      m.team !== drinker.team &&
      !game.isUnreachable(m) &&
      game.isInShadow(m) &&
      dist(m.pos, victim.pos) <= reach + m.bodyRadius()
  );
  for (const m of caught) {
    game.vfxSink?.godFx?.('reap', m.pos, { size: m.bodyRadius() * 4 });
    dealDamage(game.quietContext(striker, m), m, dmg(game.rng.roll('1d4').total + souls, 'sanity'), {
      ...QUIET,
      aoe: true,
      cause: 'Long Shadow',
    });
    if (m.alive && souls >= 2) game.applyReap(m, Math.floor(souls / 2), drinker);
    if (!m.alive) reaped(m);
  }
}

// ---- Hooks ------------------------------------------------------------------------

/** A Requiem that kills grows on the soul: another voice joins its choir. */
function petFeeds(game: GameState, dead: Mage, killer: Mage): void {
  if (killer === dead || !killer.alive || killer.summonKind !== 'requiem') return;
  const rite = (killer.deathRite ??= { level: 0 });
  rite.souls = (rite.souls ?? 0) + 1;
  game.log(`${dead.name}'s voice joins ${killer.name}.`);
}

/** Every defeat: an omen fulfilled or moved on, a pet fed, the dead mourned. */
export function deathRites(game: GameState, dead: Mage, source: Mage): void {
  if (dead.summonKind === 'fetch') fetchDies(game, dead);
  fetchMovesOn(game, dead);
  petFeeds(game, dead, source);
  mourn(game, dead);
}

/** Every landed wound: a Fetch's mirror, then for a wounded mind the Mortal Coil and Dread. */
export function woundRites(game: GameState, source: Mage, target: Mage, type: DamageType, amount: number): void {
  echoFetch(game, source, target, type, amount);
  if (type !== 'sanity' || !target.alive) return;
  if (game.hexLaw('mortalCoil')) coil(game, target, source);
  checkDread(game, target, source);
}

/** Death's Holiday runs out: every debt is collected at once. */
export function deathLawEnds(game: GameState, kind: HexLawKind, owner: Mage | undefined): void {
  if (kind !== 'deathsHoliday') return;
  for (const m of game.mages.filter((u) => u.alive && owes(u))) {
    m.statuses = m.statuses.filter((s) => s.key !== DUE_KEY);
    game.vfxSink?.godFx?.('skull', m.pos, { size: m.bodyRadius() * 4 });
    game.defeatMage(m, owner ?? m, `Death's Holiday is over: ${m.name} dies.`);
  }
}

const DEATH_MINIONS: Record<string, MinionDef> = {
  requiem: { name: 'Requiem', hp: 9, move: 4, pacifist: true, immune: ['sanity'], pulse: [{ k: 'call', run: requiemVerse }] },
  fetch: { name: 'Fetch', hp: 1, move: 6, pacifist: true, immune: ['shadow'], pulse: [{ k: 'call', run: fetchStare }] },
};

const DEATH_IMBUES: Record<string, ImbueDef> = {
  ferrymansObol: { name: "Ferryman's Obol", slot: 'trinket', reap: 1 },
  severingScythe: { name: 'Severing Scythe', slot: 'weapon', onHit: [{ k: 'call', run: sever }] },
  longShadow: { name: 'Scythe of the Long Shadow', slot: 'weapon', onHit: [{ k: 'call', run: longShadow }] },
};

Object.assign(MINIONS, DEATH_MINIONS);
Object.assign(IMBUES, DEATH_IMBUES);
