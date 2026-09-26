// Autosave for an Exploration run. Everything read back off disk is treated as
// hostile: the party goes through `parseScenario`, and every scalar is clamped
// or dropped rather than trusted.

import { parseScenario } from '../../core/Scenario';
import { BOUNTY_CAP } from './bounties';
import { START_HOUR } from './clock';
import { isPackedExplored, packExplored, revealTiles, unpackExplored, widenExplored } from './explored';
import { gateArrival, OPEN_WORLD_ID, worldTileCell } from './openWorld';
import { QUEST_JOBS, QUEST_OVER } from './quest';
import { EXPLORATION_VERSION, type ActiveBounty, type ExplorationRun, type LocaleState, type MapStyle, type QuestState } from './run';
import { createWorld, DESERT_COLUMNS, isPassable, placeById, PLACES, START_PLACE, WORLD_H, WORLD_W } from './world';

const STORAGE_KEY = 'dimir.exploration.v1';
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
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(run));
    return true;
  } catch {
    return false;
  }
}

export function clearRun(): void {
  storage()?.removeItem(STORAGE_KEY);
}

export function hasSavedRun(): boolean {
  return !!storage()?.getItem(STORAGE_KEY);
}

const int = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;

const strings = (value: unknown, cap: number): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string').slice(0, cap)
    : [];

/** Read the stored run, or null when there is none and when it cannot be trusted. */
export function loadRun(): ExplorationRun | null {
  const raw = storage()?.getItem(STORAGE_KEY);
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
    const locale = parsed.locale as Record<string, unknown> | null | undefined;
    const beaten: Record<string, number> = Object.create(null);
    if (parsed.groupsBeaten && typeof parsed.groupsBeaten === 'object') {
      for (const [key, day] of Object.entries(parsed.groupsBeaten as Record<string, unknown>).slice(-MAX_BEATEN)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        beaten[key] = Math.max(0, int(day, 0));
      }
    }
    // Runs from before maps were sold already had one, and never saw the quest.
    const hasMap = version < 5 || parsed.hasMap === true;
    const mapStyle = hasMap && parsed.mapStyle !== 'open' ? 'travel' : 'open';

    return {
      version: EXPLORATION_VERSION,
      seed: int(parsed.seed, 1) >>> 0,
      steps: Math.max(0, int(parsed.steps, 0)),
      pos,
      hour: typeof parsed.hour === 'number' && parsed.hour >= 0 && parsed.hour < 24 ? parsed.hour : START_HOUR,
      explored,
      searched: version >= 4 ? strings(parsed.searched, 64) : [],
      gold: typeof parsed.gold === 'number' && Number.isFinite(parsed.gold)
        ? Math.min(1_000_000, Math.max(0, Math.round(parsed.gold * 10) / 10))
        : 0,
      party,
      flags: strings(parsed.flags, MAX_FLAGS),
      visited,
      level: clamp(parsed.level, 1, 99, 1),
      xp: clamp(parsed.xp, 0, 1_000_000, 0),
      pendingLevels: clamp(parsed.pendingLevels, 0, 20, 0),
      day: clamp(parsed.day, 1, 1_000_000, 1),
      lastTown,
      bounties: parseBounties(parsed.bounties, version),
      bountiesTaken: strings(parsed.bountiesTaken, MAX_VISITED),
      purchases: strings(parsed.purchases, MAX_VISITED),
      locale: parseLocale(locale, version, mapStyle),
      wildsSeen: strings(parsed.wildsSeen, 8192),
      groupsBeaten: beaten,
      mapStyle,
      hasMap,
      quest: version < 5 ? { job: QUEST_OVER, taken: false, progress: 0, opens: 1 } : parseQuest(parsed.quest),
    };
  } catch {
    return null;
  }
}

function parseLocale(locale: Record<string, unknown> | null | undefined, version: number, mapStyle: MapStyle): LocaleState | null {
  if (!locale || typeof locale.id !== 'string') return null;
  const at = { x: clamp(locale.x, 0, 100_000, 0), y: clamp(locale.y, 0, 100_000, 0) };
  const id = locale.id.slice(0, 64);
  // The open world grew: keep the party on the same world tile.
  if (id === OPEN_WORLD_ID && version < 6) {
    return { id, ...worldTileCell({ x: Math.floor(at.x / V5_WORLD_SCALE), y: Math.floor(at.y / V5_WORLD_SCALE) }) };
  }
  // The forest glades became a dive: a party inside one steps out at the Small Forest's gate.
  if (id.startsWith(OLD_FOREST_PREFIX)) {
    const forest = placeById('small-forest')!;
    return mapStyle === 'open' ? { id: OPEN_WORLD_ID, ...gateArrival(forest) } : null;
  }
  return { id, ...at };
}

function parseQuest(value: unknown): QuestState {
  const q = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const job = clamp(q.job, 0, QUEST_OVER, 0);
  return {
    job,
    taken: q.taken === true,
    progress: clamp(q.progress, 0, QUEST_JOBS[job]?.need ?? 0, 0),
    opens: clamp(q.opens, 1, 1_000_000, 1),
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
      target: b.target.slice(0, 64),
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
