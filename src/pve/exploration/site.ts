// A spot off the road the party walked over to from the travel map. On foot it
// is a small area round that tile holding what was spotted, and always
// something else besides: a light sleeper or a sentry by a sleeping pack, a
// patrol or a snake in the herbs, a chest that turns out to be bait. Where
// things stand on the ground is the open world's business (openWorld.ts); what
// they are, and what taking them gives, lives here. Pure and seeded.

import { Dice } from '../../core/Dice';
import { getItem, type ItemId } from '../../core/Items';
import type { Cell } from '../../world/pathfind';
import { MINE_ENEMY_DEFS, type MineEnemyKind, type SentinelRole } from '../minerun';
import { ENEMY_DEFS, type EnemyKind } from '../swamprun';
import { grantToParty, hashString, haulLabel, money, moneyLabel } from './economy';
import { describeSpawns, hasMonsters, packPace, rollEncounter, spawnTint, type EncounterSpawn } from './encounters';
import { HERBS, rollCache } from './finds';
import type { Sighting } from './journey';
import type { Secret, SecretResult, WildPack } from './locales';
import type { ExplorationRun } from './run';
import type { TravelMode } from './travel';
import { REGIONS, type RegionId } from './world';

/** World tiles either side of the spot that the walk there covers. */
export const SITE_RADIUS = 1;

export type SiteKind = 'pack' | 'herbs' | 'cache';
export type SiteTwist =
  | 'lightSleeper' | 'sentry' | 'stash'
  | 'patrol' | 'snake' | 'sleepers'
  | 'trap' | 'guarded' | 'scattered';

const TWISTS: Record<SiteKind, readonly SiteTwist[]> = {
  pack: ['lightSleeper', 'sentry', 'stash'],
  herbs: ['patrol', 'snake', 'sleepers'],
  cache: ['trap', 'guarded', 'scattered'],
};

const SITE_KINDS: readonly SiteKind[] = ['pack', 'herbs', 'cache'];
const ALL_TWISTS: readonly SiteTwist[] = Object.values(TWISTS).flat();
const MODES: readonly TravelMode[] = ['sprint', 'sneak', 'explore', 'fast'];
const HERB_IDS: readonly ItemId[] = [...new Set(Object.values(HERBS).flat())];

export interface EncounterSite {
  kind: SiteKind;
  seed: number;
  zone: RegionId;
  depth: number;
  /** What was spotted, as the card named it. */
  title: string;
  twist: SiteTwist;
  /** The pack that was spotted. */
  spawns?: EncounterSpawn[];
  herb?: ItemId;
  /** What the ruin is called. */
  place?: string;
  /** The world tile the party came over from; it arrives on that side. */
  from?: Cell;
  /** Where the interrupted trip was bound, and how, so it can be planned again. */
  dest?: Cell;
  mode?: TravelMode;
}

export type SitePackRole = 'camp' | 'sentry' | 'patrol' | 'sleepers' | 'guards';
export type SiteThingRole = 'herb' | 'cache' | 'stash' | 'trinket';

export interface SitePackPlan {
  id: string;
  role: SitePackRole;
  spawns: EncounterSpawn[];
  asleep: boolean;
  /** Tiles off it a traveller wakes it from while it sleeps. */
  wakeTiles: number;
  sight: number;
  /** Ground tiles from the middle of the site it is set down, nearest and furthest. */
  near: number;
  far: number;
  label: string;
}

export interface SiteThingPlan {
  id: string;
  role: SiteThingRole;
  label: string;
  /** Milliseconds of holding E it takes to pick up. */
  hold: number;
  near: number;
  far: number;
}

export interface SitePlan {
  packs: SitePackPlan[];
  things: SiteThingPlan[];
}

export interface SiteGoal {
  label: string;
  done: boolean;
  optional?: boolean;
}

const HOLD_MS: Record<SiteThingRole, number> = { herb: 1800, cache: 2600, stash: 2200, trinket: 900 };

const ROLE_WORDS: Record<SitePackRole, string> = {
  camp: 'asleep',
  sentry: 'on watch',
  patrol: 'on the prowl',
  sleepers: 'asleep in the grass',
  guards: 'asleep on guard',
};

export const siteId = (site: EncounterSite, part: string): string => `site:${site.seed}:${part}`;
/** Set once anything at the site has woken: from then on nothing there is asleep. */
export const siteWokeFlag = (site: EncounterSite): string => siteId(site, 'woke');

/** The site a sighting becomes on foot, or null for sightings that play out on the map. */
export function createSite(
  run: ExplorationRun,
  sighting: Sighting,
  from?: Cell,
  trip?: { dest: Cell; mode: TravelMode },
): EncounterSite | null {
  const kind = SITE_KINDS.find((entry) => entry === sighting.kind);
  if (!kind) return null;
  const seed = (hashString(`site:${sighting.cell.x},${sighting.cell.y}:${run.steps}`) ^ run.seed) >>> 0;
  const dice = new Dice(seed);
  const site: EncounterSite = {
    kind,
    seed,
    zone: sighting.zone,
    depth: sighting.depth,
    title: sighting.title,
    twist: dice.pick(TWISTS[kind]),
  };
  if (kind === 'pack') site.spawns = sighting.spawns?.length ? sighting.spawns : rollEncounter(sighting.zone, 'monsters', sighting.depth, dice);
  if (kind === 'herbs') site.herb = sighting.herb ?? HERBS[sighting.zone][0];
  if (kind === 'cache') site.place = sighting.site ?? 'The ruin';
  if (from) site.from = { x: from.x, y: from.y };
  if (trip) {
    site.dest = { x: trip.dest.x, y: trip.dest.y };
    site.mode = trip.mode;
  }
  return site;
}

/** What stands at the site. The same site always holds the same things. */
export function sitePlan(site: EncounterSite): SitePlan {
  const dice = new Dice((site.seed ^ 0x5eed) >>> 0);
  const packs: SitePackPlan[] = [];
  const things: SiteThingPlan[] = [];
  let patrols = 0;
  // Where nothing lives yet, nothing stands guard.
  const wild = hasMonsters(site.zone);
  const minions = (): EncounterSpawn[] => rollEncounter(site.zone, 'monsters', Math.max(1, site.depth - 1), dice).slice(0, dice.chance(0.45) ? 2 : 1);
  const pack = (role: SitePackRole, spawns: EncounterSpawn[], asleep: boolean, near: number, far: number, wakeTiles = 2, sight = 6): void => {
    if (!wild) return;
    packs.push({
      id: siteId(site, role === 'patrol' ? `patrol:${patrols++}` : role),
      role,
      spawns,
      asleep,
      wakeTiles,
      sight,
      near,
      far,
      label: `${describeSpawns(spawns)}, ${ROLE_WORDS[role]}`,
    });
  };
  const thing = (role: SiteThingRole, part: string, label: string, near: number, far: number): void => {
    things.push({ id: siteId(site, part), role, label, hold: HOLD_MS[role], near, far });
  };
  if (site.kind === 'pack') {
    const spawns = site.spawns?.length ? site.spawns : rollEncounter(site.zone, 'monsters', site.depth, dice);
    pack('camp', spawns, true, 0, 2, site.twist === 'lightSleeper' ? 4 : 2.2);
    if (site.twist === 'sentry') pack('sentry', minions(), false, 5, 7, 2, 5);
    if (site.twist === 'stash') thing('stash', 'stash', 'Their stash', 2.5, 3.5);
  } else if (site.kind === 'herbs') {
    const name = getItem(site.herb ?? HERBS[site.zone][0]).name;
    const count = 2 + dice.die(3);
    for (let i = 0; i < count; i++) thing('herb', `herb:${i}`, name, 1, 8);
    if (site.twist === 'patrol') {
      pack('patrol', minions(), false, 4, 9);
      if (dice.chance(0.5)) pack('patrol', minions(), false, 4, 9);
    }
    if (site.twist === 'sleepers') pack('sleepers', minions(), true, 1, 4, 2.5);
  } else {
    thing('cache', 'cache', site.place ?? 'The ruin', 0, 2);
    if (site.twist === 'guarded') pack('guards', minions(), true, 2, 4, 2.5);
    if (site.twist === 'scattered') {
      const extra = 1 + dice.die(2);
      for (let i = 0; i < extra; i++) thing('trinket', `trinket:${i}`, 'Something glinting', 4, 9);
      pack('patrol', minions(), false, 5, 9);
    }
  }
  return { packs, things };
}

/** Which herb patch hides the snake. */
function snakeIndex(site: EncounterSite, plan: SitePlan): number {
  const herbs = plan.things.filter((entry) => entry.role === 'herb').length;
  return new Dice((site.seed ^ 0x5a4e) >>> 0).die(Math.max(1, herbs)) - 1;
}

function ambushPack(site: EncounterSite, id: string, spawns: EncounterSpawn[], at: Secret, words: string): WildPack {
  return {
    id,
    x: at.x,
    y: at.y,
    sight: 8,
    depth: site.depth,
    spawns,
    label: `${describeSpawns(spawns)}, ${words}`,
    tint: spawnTint(spawns),
    zone: site.zone,
    pace: packPace(spawns),
    hunting: true,
  };
}

function grant(run: ExplorationRun, id: ItemId, count: number): string {
  return haulLabel(id, count, grantToParty(run, id, count));
}

function purse(run: ExplorationRun, silver: number): string {
  const gold = money(silver / 10);
  run.gold = money(run.gold + gold);
  return moneyLabel(gold);
}

/** Pick something at the site up. A snake or a baited chest fights first, and gives its due once beaten. */
export function siteFind(run: ExplorationRun, site: EncounterSite, secret: Secret): SecretResult {
  const plan = sitePlan(site);
  const thing = plan.things.find((entry) => entry.id === secret.id);
  if (!thing) return { message: 'Nothing there after all.' };
  const dice = new Dice((hashString(`${secret.id}:found`) ^ run.seed) >>> 0);
  switch (thing.role) {
    case 'herb': {
      const index = plan.things.filter((entry) => entry.role === 'herb').indexOf(thing);
      const snake = siteId(site, 'snake');
      if (site.twist === 'snake' && hasMonsters(site.zone) && index === snakeIndex(site, plan) && run.groupsBeaten[snake] == null) {
        const spawns = rollEncounter(site.zone, 'monsters', Math.max(1, site.depth - 1), new Dice((site.seed ^ 0x51a7) >>> 0)).slice(0, 2);
        return { message: 'Something was coiled in the leaves!', fight: ambushPack(site, snake, spawns, secret, 'coiled in the herbs'), trap: true };
      }
      const herb = site.herb ?? HERBS[site.zone][0];
      return {
        message: `Picked ${grant(run, herb, dice.chance(0.3) ? 2 : 1)}.`,
        wake: site.twist === 'sleepers' ? { tiles: 5, chance: 0.22 } : undefined,
      };
    }
    case 'cache': {
      const trap = siteId(site, 'trap');
      if (site.twist === 'trap' && hasMonsters(site.zone) && run.groupsBeaten[trap] == null) {
        const spawns = rollEncounter(site.zone, 'monsters', site.depth, new Dice((site.seed ^ 0x7a9) >>> 0));
        return { message: 'It was bait! They were lying in wait.', fight: ambushPack(site, trap, spawns, secret, 'lying in wait'), trap: true };
      }
      const found = rollCache(run, site.zone, site.depth, dice, thing.label);
      const coin = dice.chance(0.5) ? ` And ${purse(run, 2 + dice.die(6))}.` : '';
      return { message: `${found}${coin}`, wake: site.twist === 'guarded' ? { tiles: 7, chance: 0.35 } : undefined };
    }
    case 'stash': {
      const roll = dice.float();
      const found = roll < 0.45
        ? purse(run, 3 + dice.die(6))
        : roll < 0.8
          ? grant(run, dice.pick<ItemId>(['healthPotion', 'manaPotion', 'throwingDagger']), 1)
          : grant(run, 'arrow', 3 + dice.die(4));
      return { message: `Their stash: ${found}.`, wake: { tiles: 7, chance: 0.4 } };
    }
    case 'trinket': {
      const roll = dice.float();
      const found = roll < 0.4 ? purse(run, 1 + dice.die(3)) : roll < 0.7 ? grant(run, 'arrow', 2 + dice.die(3)) : grant(run, 'healthPotion', 1);
      return { message: `${found}.` };
    }
  }
}

/** What the party came for, and how far along it is. */
export function siteGoals(run: ExplorationRun, site: EncounterSite): SiteGoal[] {
  const plan = sitePlan(site);
  const found = (id: string): boolean => run.flags.includes(`secret:${id}`);
  const goals: SiteGoal[] = [];
  for (const pack of plan.packs) {
    if (pack.role !== 'camp') continue;
    goals.push({ label: `Defeat ${describeSpawns(pack.spawns)}`, done: run.groupsBeaten[pack.id] != null });
  }
  const herbs = plan.things.filter((entry) => entry.role === 'herb');
  if (herbs.length) {
    const picked = herbs.filter((entry) => found(entry.id)).length;
    goals.push({ label: `Pick ${herbs[0].label}  ${picked}/${herbs.length}`, done: picked === herbs.length });
  }
  for (const entry of plan.things) {
    if (entry.role === 'cache') goals.push({ label: `Search ${entry.label}`, done: found(entry.id) });
    if (entry.role === 'stash') goals.push({ label: 'Their stash', done: found(entry.id), optional: true });
  }
  const trinkets = plan.things.filter((entry) => entry.role === 'trinket');
  if (trinkets.length) {
    const picked = trinkets.filter((entry) => found(entry.id)).length;
    goals.push({ label: `Odds and ends  ${picked}/${trinkets.length}`, done: picked === trinkets.length, optional: true });
  }
  return goals;
}

/** Everything the party came for is done. */
export function siteDone(run: ExplorationRun, site: EncounterSite): boolean {
  return siteGoals(run, site).every((goal) => goal.optional || goal.done);
}

/** The first thing said on arriving. */
export function siteIntro(site: EncounterSite): string {
  if (site.kind === 'pack') {
    const spawns = site.spawns ?? [];
    return `${describeSpawns(spawns)} asleep ahead. Sneak up (C) and strike first (F).`;
  }
  if (site.kind === 'herbs') return `${getItem(site.herb ?? HERBS[site.zone][0]).name} grows here. Hold E by a patch to pick it.`;
  return `${site.place ?? 'The ruin'}. Hold E by it to search.`;
}

// -----------------------------------------------------------------------------
//  SAVES
// -----------------------------------------------------------------------------

const own = (value: object, key: unknown): boolean => typeof key === 'string' && Object.prototype.hasOwnProperty.call(value, key);
const whole = (value: unknown, min: number, max: number): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : null;

function readCell(value: unknown): Cell | undefined {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const x = whole(raw?.x, 0, 10_000);
  const y = whole(raw?.y, 0, 10_000);
  return x != null && y != null ? { x, y } : undefined;
}

function readSpawn(value: unknown): EncounterSpawn | null {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  if (raw?.family === 'swamp') return own(ENEMY_DEFS, raw.kind) ? { family: 'swamp', kind: raw.kind as EnemyKind } : null;
  const spec = raw?.family === 'mine' && raw.spec && typeof raw.spec === 'object' ? raw.spec as Record<string, unknown> : null;
  const level = whole(spec?.level, 1, 99);
  if (!spec || !own(MINE_ENEMY_DEFS, spec.kind) || level == null) return null;
  const role = spec.role === 'tank' || spec.role === 'healer' || spec.role === 'dps' ? spec.role as SentinelRole : undefined;
  return { family: 'mine', spec: { kind: spec.kind as MineEnemyKind, level, ...(role ? { role } : {}) } };
}

/** A stored site, read as hostile input. Null when it is not one. */
export function parseSite(value: unknown): EncounterSite | null {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const kind = SITE_KINDS.find((entry) => entry === raw?.kind);
  const twist = ALL_TWISTS.find((entry) => entry === raw?.twist);
  const seed = whole(raw?.seed, 0, 0xffffffff);
  const depth = whole(raw?.depth, 1, 10);
  if (!raw || !kind || !twist || !TWISTS[kind].includes(twist) || seed == null || depth == null || !own(REGIONS, raw.zone)) return null;
  const site: EncounterSite = {
    kind,
    seed,
    zone: raw.zone as RegionId,
    depth,
    title: typeof raw.title === 'string' ? raw.title.slice(0, 80) : 'Something',
    twist,
  };
  if (Array.isArray(raw.spawns)) {
    const spawns = raw.spawns.slice(0, 24).map(readSpawn);
    if (spawns.some((entry) => !entry)) return null;
    if (spawns.length) site.spawns = spawns as EncounterSpawn[];
  }
  if (HERB_IDS.includes(raw.herb as ItemId)) site.herb = raw.herb as ItemId;
  if (typeof raw.place === 'string') site.place = raw.place.slice(0, 60);
  const from = readCell(raw.from);
  const dest = readCell(raw.dest);
  if (from) site.from = from;
  if (dest) site.dest = dest;
  const mode = MODES.find((entry) => entry === raw.mode);
  if (mode) site.mode = mode;
  return site;
}
