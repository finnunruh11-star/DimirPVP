// Autosave for an Exploration run. Everything read back off disk is treated as
// hostile: the party goes through `parseScenario`, and every scalar is clamped
// or dropped rather than trusted.

import { MAGE_CLASSES, type MageClass } from '../../core/Classes';
import { parseHexLore } from '../../core/hexcraft/lore';
import { currentItemId } from '../../core/Items';
import { parseScenario, type Scenario } from '../../core/Scenario';
import { AREA_RADIUS } from './area';
import { BOUNTY_CAP } from './bounties';
import { START_HOUR } from './clock';
import { classesUnique } from './coop';
import { isPackedExplored, packExplored, revealTiles, unpackExplored, widenExplored } from './explored';
import { cellWorldTile, OPEN_WORLD_ID, worldTileCell } from './openWorld';
import { parseExplorationMines } from './mines';
import { bloodmoonCycle } from './bloodmoon';
import { EXPLORATION_VERSION, type ActiveBounty, type AreaState, type ExplorationRun, type LocaleState, type RoadState } from './run';
import { parseSite } from './site';
import { createWorld, DESERT_COLUMNS, isPassable, placeById, PLACES, START_PLACE, WORLD_H, WORLD_W } from './world';

const SLOT_KEYS = {
  solo: 'dimir.exploration.v1',
  online: 'dimir.exploration.online.v1',
} as const;

/** Which run the autosave reads and writes: the solo run, the online run this host keeps, or none (a guest). */
export type SaveSlot = keyof typeof SLOT_KEYS | 'none';

let slot: SaveSlot = 'solo';
let onSaved: ((run: ExplorationRun) => void) | null = null;
const retired = new WeakSet<ExplorationRun>();

export function setSaveSlot(next: SaveSlot): void {
  slot = next;
}

/** Never save this run again: an online run once its session has closed, so it cannot land in the solo slot. */
export function retireRun(run: ExplorationRun): void {
  retired.add(run);
}

export function saveSlot(): SaveSlot {
  return slot;
}

/** Hear about every save (the online host shares each one with its guests). */
export function setSaveListener(listener: ((run: ExplorationRun) => void) | null): void {
  onSaved = listener;
}

function slotKey(which: SaveSlot = slot): string | null {
  return which === 'none' ? null : SLOT_KEYS[which];
}

const MAX_FLAGS = 256;
const MAX_BEATEN = 1024;
const MAX_VISITED = 2048;
/** Width of the map before the desert was added (version 3 saves). */
const V3_WORLD_W = 88;
/** Where runs began before version 5. */
const LEGACY_START = 'capitol';
/** Ground tiles per world tile in the open world before version 6. */
const V5_WORLD_SCALE = 3;
/** Locale ids of the forest glades, before the Small Forest became a dive. */
const OLD_FOREST_PREFIX = 'forest:';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function saveRun(run: ExplorationRun): boolean {
  const key = slotKey();
  if (!key || retired.has(run)) return true;
  onSaved?.(run);
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(run));
    return true;
  } catch {
    return false;
  }
}

export function clearRun(which: SaveSlot = slot): void {
  const key = slotKey(which);
  if (key) storage()?.removeItem(key);
}

/** Put a run loaded from a file into `which` save, replacing what was there. */
export function storeRun(run: ExplorationRun, which: Exclude<SaveSlot, 'none'>): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(SLOT_KEYS[which], JSON.stringify(run));
    return true;
  } catch {
    return false;
  }
}

export function hasSavedRun(which: SaveSlot = slot): boolean {
  const key = slotKey(which);
  return !!key && !!storage()?.getItem(key);
}

const int = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;

const strings = (value: unknown, cap: number): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string').slice(0, cap)
    : [];

/** Read the stored run, or null when there is none and when it cannot be trusted. */
export function loadRun(which: SaveSlot = slot): ExplorationRun | null {
  const key = slotKey(which);
  const raw = key ? storage()?.getItem(key) : null;
  if (!raw) return null;
  return parseRun(raw);
}

const clamp = (value: unknown, min: number, max: number, fallback: number): number =>
  Math.min(max, Math.max(min, int(value, fallback)));

/** Graph nodes from before the tile map: roads and forks become the last town. */
const LEGACY_NODE = /^(road-[a-z-]+-\d+|fork-forest|fork-wilds)$/;
const LEGACY_PLACE: Record<string, string> = { 'fork-forest': 'small-forest' };

const isTown = (value: unknown): value is string =>
  typeof value === 'string' && placeById(value)?.kind === 'city';

/** Parse a stored run. Older saves are upgraded; newer or broken ones are refused. */
export function parseRun(raw: string): ExplorationRun | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const version = int(parsed.version, 0);
    if (version < 1 || version > EXPLORATION_VERSION) return null;

    const world = createWorld();
    const lastTown = isTown(parsed.lastTown) ? parsed.lastTown : version < 5 ? LEGACY_START : START_PLACE;
    const home = placeById(lastTown)!;
    let pos = { x: home.x, y: home.y };
    if (version < 3) {
      const nodeId = typeof parsed.nodeId === 'string' ? parsed.nodeId : '';
      const place = placeById(LEGACY_PLACE[nodeId] ?? nodeId);
      if (!place && !LEGACY_NODE.test(nodeId)) return null;
      if (place) pos = { x: place.x, y: place.y };
    } else {
      // Version 3 maps began where the desert now ends.
      const shift = version === 3 ? DESERT_COLUMNS : 0;
      const at = (parsed.pos ?? {}) as Record<string, unknown>;
      const x = clamp(int(at.x, home.x - shift) + shift, 0, WORLD_W - 1, home.x);
      const y = clamp(at.y, 0, WORLD_H - 1, home.y);
      if (isPassable(world, x, y)) pos = { x, y };
    }
    const visited = strings(parsed.visited, MAX_VISITED)
      .map((id) => LEGACY_PLACE[id] ?? id)
      .filter((id) => !!placeById(id));
    let explored = version >= 3 && isPackedExplored(parsed.explored) ? parsed.explored : '';
    if (version === 3 && typeof parsed.explored === 'string') {
      explored = widenExplored(parsed.explored.slice(0, Math.ceil((V3_WORLD_W * WORLD_H) / 6)), V3_WORLD_W, WORLD_H, DESERT_COLUMNS);
    }
    if (version < 3) {
      const mask = unpackExplored('');
      revealTiles(mask, [pos, ...PLACES.filter((place) => visited.includes(place.id))], 4);
      explored = packExplored(mask);
    }

    // parseScenario does the heavy validation of the roster itself.
    const party = parseScenario(JSON.stringify(parsed.party));
    if (party.entities.length === 0 || !classesUnique(party)) return null;
    const level = clamp(parsed.level, 1, 99, 1);
    const levelsTaken = parseLevelsTaken(parsed.levelsTaken, party, level, clamp(parsed.pendingLevels, 0, 20, 0));
    const locale = parsed.locale as Record<string, unknown> | null | undefined;
    const beaten: Record<string, number> = Object.create(null);
    if (parsed.groupsBeaten && typeof parsed.groupsBeaten === 'object') {
      for (const [key, day] of Object.entries(parsed.groupsBeaten as Record<string, unknown>).slice(-MAX_BEATEN)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        beaten[key] = Math.max(0, int(day, 0));
      }
    }
    const localeState = parseLocale(locale, version);
    const day = clamp(parsed.day, 1, 1_000_000, 1);
    // A save from before the bosses does not owe the bloodmoons it already slept through.
    const bloodmoons = Math.min(bloodmoonCycle(day), clamp(parsed.bloodmoons, 0, 100_000, bloodmoonCycle(day)));

    return {
      version: EXPLORATION_VERSION,
      seed: int(parsed.seed, 1) >>> 0,
      steps: Math.max(0, int(parsed.steps, 0)),
      pos,
      hour: typeof parsed.hour === 'number' && parsed.hour >= 0 && parsed.hour < 24 ? parsed.hour : START_HOUR,
      explored,
      searched: version >= 4 ? strings(parsed.searched, 64) : [],
      gold: typeof parsed.gold === 'number' && Number.isFinite(parsed.gold)
        ? Math.min(1_000_000, Math.max(0, Math.round(parsed.gold * 100) / 100))
        : 0,
      party,
      summons: parseSummons(parsed.summons),
      creating: parsed.creating === true,
      flags: strings(parsed.flags, MAX_FLAGS),
      visited,
      level,
      xp: clamp(parsed.xp, 0, 1_000_000, 0),
      pendingLevels: Math.max(0, ...party.entities.map((entity) => level - (levelsTaken[entity.mageClass] ?? 1))),
      levelsTaken,
      day,
      lastTown,
      bounties: parseBounties(parsed.bounties, version),
      bountiesTaken: strings(parsed.bountiesTaken, MAX_VISITED),
      purchases: strings(parsed.purchases, MAX_VISITED),
      locale: localeState,
      wildsSeen: strings(parsed.wildsSeen, 8192),
      groupsBeaten: beaten,
      area: parseArea(parsed.area, party, localeState),
      road: parseRoad(parsed.road),
      mines: parseExplorationMines(parsed.mines),
      bloodmoons,
      crafts: clamp(parsed.crafts, 0, 1_000_000, 0),
      hexLore: parseHexLore(parsed.hexLore),
    };
  } catch {
    return null;
  }
}

/** The summons following the party; anything broken simply leaves them behind. */
function parseSummons(value: unknown): Scenario | null {
  if (!value || typeof value !== 'object') return null;
  try {
    const summons = parseScenario(JSON.stringify(value));
    return summons.entities.some((entity) => entity.summon) ? summons : null;
  } catch {
    return null;
  }
}

function parseRoad(value: unknown): RoadState {
  const road = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const hazard = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(20, Math.max(0, v)) : 0);
  return { tiles: clamp(road.tiles, 0, 64, 0), danger: hazard(road.danger), luck: hazard(road.luck) };
}

/** The level each member has taken rewards up to. Saves before co-op kept one count of levels owed. */
function parseLevelsTaken(value: unknown, party: Scenario, level: number, legacyPending: number): Partial<Record<MageClass, number>> {
  const out: Partial<Record<MageClass, number>> = {};
  const stored = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  for (const entity of party.entities) {
    const mageClass = entity.mageClass;
    if (!MAGE_CLASSES.includes(mageClass)) continue;
    out[mageClass] = stored
      ? clamp(stored[mageClass], 1, level, 1)
      : Math.max(1, level - legacyPending);
  }
  return out;
}

function parseLocale(locale: Record<string, unknown> | null | undefined, version: number): LocaleState | null {
  if (!locale || typeof locale.id !== 'string') return null;
  const at = { x: clamp(locale.x, 0, 100_000, 0), y: clamp(locale.y, 0, 100_000, 0) };
  const id = locale.id.slice(0, 64);
  // The open world grew: keep the party on the same world tile.
  if (id === OPEN_WORLD_ID && version < 6) {
    return { id, ...worldTileCell({ x: Math.floor(at.x / V5_WORLD_SCALE), y: Math.floor(at.y / V5_WORLD_SCALE) }) };
  }
  // The forest glades became a dive: a party inside one is back on the map by the Small Forest.
  if (id.startsWith(OLD_FOREST_PREFIX)) return null;
  return { id, ...at };
}

/** On foot: where the party set out from and what each member has spent. Runs that walked the whole world set out from where they stand. */
function parseArea(value: unknown, party: Scenario, locale: LocaleState | null): AreaState | null {
  if (locale?.id !== OPEN_WORLD_ID) return null;
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const stored = raw?.tile && typeof raw.tile === 'object' ? raw.tile as Record<string, unknown> : null;
  const here = cellWorldTile(locale);
  const tile = stored
    ? { x: clamp(stored.x, 0, WORLD_W - 1, here.x), y: clamp(stored.y, 0, WORLD_H - 1, here.y) }
    : here;
  const spentRaw = raw?.spent && typeof raw.spent === 'object' ? raw.spent as Record<string, unknown> : {};
  const spent: AreaState['spent'] = {};
  for (const entity of party.entities) {
    const hours = Object.prototype.hasOwnProperty.call(spentRaw, entity.mageClass) ? spentRaw[entity.mageClass] : undefined;
    if (typeof hours === 'number' && Number.isFinite(hours) && hours > 0) spent[entity.mageClass] = Math.min(240, hours);
  }
  const site = parseSite(raw?.site);
  const radius = typeof raw?.radius === 'number' && Number.isInteger(raw.radius) ? clamp(raw.radius, 1, AREA_RADIUS, AREA_RADIUS) : null;
  return {
    tile,
    spent,
    ...(radius != null && radius !== AREA_RADIUS ? { radius } : {}),
    ...(site ? { site } : {}),
  };
}

function parseBounties(value: unknown, version: number): ActiveBounty[] {
  if (!Array.isArray(value)) return [];
  const out: ActiveBounty[] = [];
  // Bounties posted before version 6 paid far more than any does now.
  const cap = version < 6 ? BOUNTY_CAP : 10_000;
  for (const entry of value.slice(0, 16)) {
    if (!entry || typeof entry !== 'object') continue;
    const b = entry as Record<string, unknown>;
    const kind = b.kind === 'slay' || b.kind === 'gather' || b.kind === 'deliver' ? b.kind : null;
    if (!kind || typeof b.id !== 'string' || !isTown(b.town)) continue;
    if (typeof b.target !== 'string' || typeof b.label !== 'string') continue;
    out.push({
      id: b.id.slice(0, 64),
      town: b.town,
      kind,
      target: kind === 'gather' ? currentItemId(b.target.slice(0, 64)) : b.target.slice(0, 64),
      count: clamp(b.count, 1, 99, 1),
      progress: clamp(b.progress, 0, 99, 0),
      rewardGold: typeof b.rewardGold === 'number' && Number.isFinite(b.rewardGold)
        ? Math.min(cap, Math.max(0, Math.round(b.rewardGold * 10) / 10))
        : 0,
      rewardXp: clamp(b.rewardXp, 0, 10_000, 0),
      label: b.label.slice(0, 120),
    });
  }
  return out;
}
