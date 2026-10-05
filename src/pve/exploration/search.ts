// Searching the country round you. The searcher says what they are after: a
// resource, a creature, or whatever is going on nearby. One d20 decides it, helped
// by their knack for it (Int for resources, Dex for tracking, Luck for events).
// What belongs to the ground is found far more easily than what does not, every
// search of the same ground on the same day makes the next one harder, and a roll
// that falls just short still turns up something good. Pure and seeded.

import type { MageClass } from '../../core/Classes';
import type { Dice } from '../../core/Dice';
import { getItem, type ItemId } from '../../core/Items';
import type { Mage } from '../../core/Mage';
import type { Cell } from '../../world/pathfind';
import { MINE_ENEMY_DEFS, mineEnemyLevel, type MineEnemyKind } from '../minerun';
import { ENEMY_DEFS, type EnemyKind } from '../swamprun';
import { isNight } from './clock';
import { bountyProgress } from './bounties';
import { addRunXp, livingMembers, partyXpScale } from './coop';
import { grantToParty, haulLabel, money, moneyLabel, partyOf, withMember } from './economy';
import {
  creatureName,
  creaturePower,
  describeSpawns,
  encounterBudget,
  encounterCap,
  ZONE_ROSTERS,
  type EncounterSpawn,
} from './encounters';
import { GEMS, HERBS, ORES } from './finds';
import type { ExplorationRun } from './run';
import { createWorld, depthAt, REGIONS, regionAt, TERRAIN, terrainAt, type RegionId } from './world';

export type SearchCategory = 'resource' | 'creature' | 'events';
/** How much a target belongs where the search is made. */
export type SearchStanding = 'native' | 'scarce' | 'foreign';
export type ResourceKind = 'herb' | 'gem' | 'ore';
export type SearchOutcome = 'found' | 'near' | 'nothing';
export type SearchStat = 'int' | 'dex' | 'luck';

export interface SearchTarget {
  category: SearchCategory;
  /** An item id, a creature kind, or 'events'. */
  id: string;
  label: string;
  standing: SearchStanding;
  dc: number;
  resource?: ResourceKind;
  /** Where it is at home, for the window. */
  home: string;
}

export interface SearchRoll {
  die: number;
  bonus: number;
  total: number;
  dc: number;
  outcome: SearchOutcome;
}

/** Hours one search takes. */
export const SEARCH_HOURS = 1;
/** A roll falling this far under the DC or less still turns something up. */
export const NEAR_MISS = 5;
/** Extra DC for every search already made of the same ground today. */
export const PICKED_OVER = 2;
/** Extra DC for anything that does not belong where it is sought. */
export const FOREIGN_DC = 8;
export const SEARCH_STAT: Record<SearchCategory, SearchStat> = { resource: 'int', creature: 'dex', events: 'luck' };
export const STAT_LABEL: Record<SearchStat, string> = { int: 'Int', dex: 'Dex', luck: 'Luck' };

const RESOURCE_DC: Record<ResourceKind, number> = { herb: 10, ore: 12, gem: 14 };
const CREATURE_DC: Record<SearchStanding, number> = { native: 11, scarce: 15, foreign: 19 };
const EVENTS_DC = 8;
const MAX_BONUS = 6;

const REGION_IDS: readonly RegionId[] = ['capitol', 'forest', 'red', 'black', 'lake', 'white'];
const RESOURCE_TABLE: Record<ResourceKind, Record<RegionId, ItemId[]>> = { herb: HERBS, ore: ORES, gem: GEMS };
const RESOURCES: readonly { id: ItemId; kind: ResourceKind }[] = [
  ...(['herbMoonglow', 'herbWaterleaf', 'herbDeathweed', 'herbFireblossom'] as const).map((id) => ({ id, kind: 'herb' as const })),
  ...(['oreCoal', 'oreCopper', 'oreIron', 'oreGold'] as const).map((id) => ({ id, kind: 'ore' as const })),
  ...(['gemAmethyst', 'gemOnyx', 'gemEmerald', 'gemRuby', 'gemSapphire', 'gemDiamond', 'gemPearl'] as const).map((id) => ({ id, kind: 'gem' as const })),
];

/** Every creature some region of the map is home to. */
const CREATURES: readonly string[] = [...new Set(REGION_IDS.flatMap((zone) => {
  const roster = ZONE_ROSTERS[zone];
  return [...roster.monsters, ...roster.robbery, ...roster.elites].map((entry) => entry.kind as string);
}))];

const regionList = (zones: readonly RegionId[]): string =>
  zones.length ? zones.map((zone) => REGIONS[zone].name).join(', ') : 'Nowhere on the map';

// -----------------------------------------------------------------------------
//  THE GROUND
// -----------------------------------------------------------------------------

/** The region and enemy depth where a search is made; night brings worse out. */
export function searchSite(run: ExplorationRun, tile: Cell): { zone: RegionId; depth: number; ground: string } {
  const world = createWorld();
  return {
    zone: regionAt(world, tile.x, tile.y),
    depth: Math.min(10, depthAt(world, tile.x, tile.y) + (isNight(run.hour) ? 1 : 0)),
    ground: TERRAIN[terrainAt(world, tile.x, tile.y)].label,
  };
}

export function searchKey(tile: Cell, day: number): string {
  return `${tile.x},${tile.y}:${day}`;
}

/** Extra DC on this ground today: it has been searched already. */
export function pickedOver(run: ExplorationRun, tile: Cell): number {
  const key = searchKey(tile, run.day);
  return run.searched.filter((entry) => entry === key).length * PICKED_OVER;
}

function recordSearch(run: ExplorationRun, tile: Cell): void {
  run.searched = [...run.searched, searchKey(tile, run.day)].slice(-64);
}

function creatureStanding(zone: RegionId, kind: string, depth: number): SearchStanding {
  const roster = ZONE_ROSTERS[zone];
  // Bandits only work country where they rob anyone.
  const pools = [...roster.monsters, ...(REGIONS[zone].robbery > 0 ? roster.robbery : [])].filter((entry) => entry.kind === kind);
  if (pools.some((entry) => entry.unlock <= depth)) return 'native';
  if (pools.length || roster.elites.some((entry) => entry.kind === kind)) return 'scarce';
  return 'foreign';
}

const STANDING_ORDER: Record<SearchStanding, number> = { native: 0, scarce: 1, foreign: 2 };
const byStanding = (a: SearchTarget, b: SearchTarget): number =>
  STANDING_ORDER[a.standing] - STANDING_ORDER[b.standing] || a.dc - b.dc || a.label.localeCompare(b.label);

/** Everything that can be sought here, what belongs first. */
export function searchTargets(run: ExplorationRun, tile: Cell): Record<SearchCategory, SearchTarget[]> {
  const { zone, depth } = searchSite(run, tile);
  const extra = pickedOver(run, tile);
  const resource = RESOURCES.map(({ id, kind }): SearchTarget => {
    const native = RESOURCE_TABLE[kind][zone].includes(id);
    return {
      category: 'resource',
      id,
      label: getItem(id).name,
      standing: native ? 'native' : 'foreign',
      dc: RESOURCE_DC[kind] + (native ? 0 : FOREIGN_DC) + extra,
      resource: kind,
      home: regionList(REGION_IDS.filter((region) => RESOURCE_TABLE[kind][region].includes(id))),
    };
  }).sort(byStanding);
  // A creature is only ever found where it lives.
  const creature = CREATURES.map((kind): SearchTarget => {
    const standing = creatureStanding(zone, kind, depth);
    return {
      category: 'creature',
      id: kind,
      label: creatureName(kind),
      standing,
      dc: CREATURE_DC[standing] + extra,
      home: regionList(REGION_IDS.filter((region) => creatureStanding(region, kind, 10) !== 'foreign')),
    };
  }).filter((target) => target.standing !== 'foreign').sort(byStanding);
  const events: SearchTarget[] = [{
    category: 'events',
    id: 'events',
    label: 'Anything nearby',
    standing: 'native',
    dc: EVENTS_DC + extra,
    home: 'Travellers, ruins, trouble: whatever the country holds today.',
  }];
  return { resource, creature, events };
}

/** One target as sought here, or null when there is no such thing. */
export function findSearchTarget(run: ExplorationRun, tile: Cell, category: unknown, id: unknown): SearchTarget | null {
  if (category !== 'resource' && category !== 'creature' && category !== 'events') return null;
  return searchTargets(run, tile)[category].find((target) => target.id === id) ?? null;
}

// -----------------------------------------------------------------------------
//  THE ROLL
// -----------------------------------------------------------------------------

export function statValue(mage: Mage, stat: SearchStat): number {
  if (stat === 'int') return mage.effectiveInt();
  if (stat === 'dex') return mage.effectiveDex();
  return mage.maxLuck;
}

/** Half the searcher's knack for it, rounded down. */
export function searchBonus(mage: Mage, category: SearchCategory): number {
  return Math.max(0, Math.min(MAX_BONUS, Math.floor(statValue(mage, SEARCH_STAT[category]) / 2)));
}

/** Who searches for the party on the map: the member standing who is best at it. */
export function bestSearcher(run: ExplorationRun, category: SearchCategory): { member: MageClass; name: string; bonus: number; stat: number } | null {
  let best: { member: MageClass; name: string; bonus: number; stat: number } | null = null;
  for (const mage of livingMembers(partyOf(run))) {
    const bonus = searchBonus(mage, category);
    if (!best || bonus > best.bonus) best = { member: mage.mageClass, name: mage.name, bonus, stat: statValue(mage, SEARCH_STAT[category]) };
  }
  return best;
}

/** A natural 20 always finds it; a natural 1 never turns anything up. */
export function checkOutcome(die: number, bonus: number, dc: number): SearchOutcome {
  if (die >= 20) return 'found';
  if (die <= 1) return 'nothing';
  const total = die + bonus;
  if (total >= dc) return 'found';
  return total >= dc - NEAR_MISS ? 'near' : 'nothing';
}

export function searchOdds(dc: number, bonus: number): Record<SearchOutcome, number> {
  const counts: Record<SearchOutcome, number> = { found: 0, near: 0, nothing: 0 };
  for (let die = 1; die <= 20; die++) counts[checkOutcome(die, bonus, dc)] += 1;
  return { found: counts.found / 20, near: counts.near / 20, nothing: counts.nothing / 20 };
}

export function rollSearchCheck(dc: number, bonus: number, dice: Dice): SearchRoll {
  const die = dice.die(20);
  return { die, bonus, total: die + bonus, dc, outcome: checkOutcome(die, bonus, dc) };
}

export interface SearchShelfEntry {
  target: SearchTarget;
  bonus: number;
  /** Whose knack the bonus comes from, e.g. "Kara's Int 5". */
  knack: string;
  odds: Record<SearchOutcome, number>;
  /** A bounty that wants it. */
  note?: string;
}

/**
 * Every target here as `searcher` would roll for it. With no searcher the party
 * searches, and whoever standing is best at each kind of search leads it.
 */
export function searchShelves(run: ExplorationRun, tile: Cell, searcher: Mage | null): Record<SearchCategory, SearchShelfEntry[]> {
  const targets = searchTargets(run, tile);
  const party = searcher ? [searcher] : livingMembers(partyOf(run));
  const shelf = (category: SearchCategory): SearchShelfEntry[] => {
    const stat = SEARCH_STAT[category];
    const lead = party.reduce<Mage | null>((best, mage) => (!best || searchBonus(mage, category) > searchBonus(best, category) ? mage : best), null);
    const bonus = lead ? searchBonus(lead, category) : 0;
    const knack = lead ? `${lead.name}'s ${STAT_LABEL[stat]} ${statValue(lead, stat)}` : STAT_LABEL[stat];
    return targets[category].map((target) => {
      const bounty = run.bounties.find((entry) => entry.target === target.id
        && ((category === 'creature' && entry.kind === 'slay') || (category === 'resource' && entry.kind === 'gather')));
      return {
        target,
        bonus,
        knack,
        odds: searchOdds(target.dc, bonus),
        note: bounty ? `Bounty ${bountyProgress(run, bounty)}/${bounty.count}` : undefined,
      };
    });
  };
  return { resource: shelf('resource'), creature: shelf('creature'), events: shelf('events') };
}

// -----------------------------------------------------------------------------
//  WHAT TURNS UP
// -----------------------------------------------------------------------------

/** A creature's own kind of spawn, at the depth it is met. */
function spawnOf(kind: string, depth: number): EncounterSpawn {
  if (Object.prototype.hasOwnProperty.call(ENEMY_DEFS, kind)) return { family: 'swamp', kind: kind as EnemyKind };
  return { family: 'mine', spec: { kind: kind as MineEnemyKind, level: mineEnemyLevel(depth) } };
}

/** The group a tracker comes upon: the creature sought, as many as the ground's depth fields. */
export function trackedPack(kind: string, depth: number, dice: Dice): EncounterSpawn[] {
  const def = Object.prototype.hasOwnProperty.call(MINE_ENEMY_DEFS, kind) ? MINE_ENEMY_DEFS[kind as MineEnemyKind] : undefined;
  let count: number;
  if (def?.packRange) {
    const [least, most] = def.packRange;
    const top = Math.min(most, least + Math.floor(Math.max(1, depth) / 2));
    count = least + dice.die(top - least + 1) - 1;
  } else if (def?.packSize) {
    count = def.packSize;
  } else {
    const fits = Math.floor(encounterBudget(depth) / Math.max(1, creaturePower(kind)));
    count = Math.max(1, Math.min(encounterCap(depth), fits));
  }
  return Array.from({ length: count }, () => spawnOf(kind, depth));
}

function gatherResource(run: ExplorationRun, target: SearchTarget, member: MageClass | null, dice: Dice): string {
  const id = target.id as ItemId;
  const count = target.resource === 'herb' ? dice.die(3) : target.resource === 'ore' ? dice.die(2) : 1;
  return haulLabel(id, count, grantToParty(run, id, count, member));
}

const SUPPLY_FINDS: readonly ItemId[] = ['healthPotion', 'manaPotion', 'torch', 'arrow'];

/** Just short of what was sought, but the search was not for nothing. */
function luckyTurn(run: ExplorationRun, member: MageClass | null, zone: RegionId, dice: Dice): { message: string; levels: number } {
  const roll = dice.float();
  const herbs = HERBS[zone];
  if (roll < 0.3 && herbs.length) {
    const herb = dice.pick(herbs);
    const count = dice.die(2);
    const left = grantToParty(run, herb, count, member);
    return { message: `Not what you were after, but a patch of ${getItem(herb).name}: ${haulLabel(herb, count, left)}.`, levels: 0 };
  }
  if (roll < 0.55) {
    const id = dice.pick(SUPPLY_FINDS);
    const count = id === 'arrow' ? 2 + dice.die(3) : 1;
    const left = grantToParty(run, id, count, member);
    return { message: `A pack someone dropped: ${haulLabel(id, count, left)}.`, levels: 0 };
  }
  if (roll < 0.75) {
    const gold = money((2 + dice.die(6)) / 10);
    run.gold = money(run.gold + gold);
    return { message: `A purse someone lost: ${moneyLabel(gold)}.`, levels: 0 };
  }
  if (roll < 0.9) {
    const back = withMember(run, member, (mage) => (mage.alive ? mage.restoreShare(0.15) : null));
    const parts = back ? [back.hp ? `+${back.hp} HP` : '', back.mana ? `+${back.mana} mana` : ''].filter(Boolean) : [];
    return { message: `A sheltered spot to catch your breath${parts.length ? `: ${parts.join(', ')}` : ''}.`, levels: 0 };
  }
  const xp = Math.max(1, Math.round(2 * partyXpScale(run)));
  const levels = addRunXp(run, xp);
  return { message: `Old marks on a stone teach you something: +${xp} XP.${levels ? ' Level up!' : ''}`, levels };
}

export interface SearchResolution {
  roll: SearchRoll;
  /** What it came to, for the searcher. */
  message: string;
  levels: number;
  /** A creature was tracked down: the group, still unaware of the searcher. */
  pack?: { spawns: EncounterSpawn[]; label: string; zone: RegionId; depth: number };
  /** Something is going on nearby: the caller plays an event. */
  event?: boolean;
}

/**
 * Search `tile` for `target` as `member` with `bonus`. Resources and lucky turns
 * are handed out here; a tracked pack or an event is the caller's to play.
 * The caller moves the clock on.
 */
export function resolveSearch(run: ExplorationRun, tile: Cell, target: SearchTarget, member: MageClass | null, bonus: number, dice: Dice): SearchResolution {
  const roll = rollSearchCheck(target.dc, bonus, dice);
  const site = searchSite(run, tile);
  recordSearch(run, tile);
  if (roll.outcome === 'found') {
    if (target.category === 'resource') return { roll, message: `Found ${gatherResource(run, target, member, dice)}.`, levels: 0 };
    if (target.category === 'creature') {
      const spawns = trackedPack(target.id, site.depth, dice);
      const label = describeSpawns(spawns);
      return { roll, message: `Tracks lead to ${label}. They have not noticed you.`, levels: 0, pack: { spawns, label, zone: site.zone, depth: site.depth } };
    }
    return { roll, message: 'Something is going on nearby.', levels: 0, event: true };
  }
  if (roll.outcome === 'near') return { roll, ...luckyTurn(run, member, site.zone, dice) };
  const miss = target.category === 'events' ? 'All quiet. Nothing is going on here.'
    : target.category === 'creature' ? `No sign of any ${target.label}.`
    : `No ${target.label} here.`;
  return { roll, message: miss, levels: 0 };
}
