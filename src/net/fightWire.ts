// An Adventure fight as it travels from the host to its guests: everything a
// GameScene needs except the run (each guest already holds the host's run) and
// the connection. Read back as hostile input. Pure: no Phaser.

import type { ExplorationCombat, ExplorationOpening } from '../config/MatchConfig';
import { MAGE_CLASSES, type MageClass } from '../core/Classes';
import { WORDS, type WordId } from '../core/Words';
import { parseBossFight } from '../pve/exploration/bloodmoon';
import type { EncounterSpawn, EncounterZone } from '../pve/exploration/encounters';
import type { WildPack } from '../pve/exploration/locales';
import type { LocaleState } from '../pve/exploration/run';
import type { DungeonId } from '../pve/exploration/world';
import { MINE_ENEMY_DEFS, type MineEnemyKind, type SentinelRole } from '../pve/minerun';
import { ENEMY_DEFS, type EnemyKind } from '../pve/swamprun';

export type FightWire = Omit<ExplorationCombat, 'run'>;

const ZONES: readonly EncounterZone[] = ['capitol', 'black', 'red', 'forest', 'wilds', 'lake', 'white'];
const DUNGEON_IDS: readonly DungeonId[] = ['swamps', 'mines', 'forest'];
const ROLES: readonly SentinelRole[] = ['tank', 'healer', 'dps'];
const MAX_SPAWNS = 24;

const own = (record: object, key: unknown): boolean =>
  typeof key === 'string' && Object.prototype.hasOwnProperty.call(record, key);

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' ? value.slice(0, max) : undefined;

const int = (value: unknown, min: number, max: number): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : null;

export function toFightWire(combat: ExplorationCombat): FightWire {
  const { run: _run, ...wire } = combat;
  return wire;
}

function spawn(value: unknown): EncounterSpawn | null {
  const raw = record(value);
  if (!raw) return null;
  if (raw.family === 'swamp') return own(ENEMY_DEFS, raw.kind) ? { family: 'swamp', kind: raw.kind as EnemyKind } : null;
  if (raw.family !== 'mine') return null;
  const spec = record(raw.spec);
  const level = int(spec?.level, 1, 99);
  if (!spec || !own(MINE_ENEMY_DEFS, spec.kind) || level == null) return null;
  const role = ROLES.includes(spec.role as SentinelRole) ? spec.role as SentinelRole : undefined;
  return { family: 'mine', spec: { kind: spec.kind as MineEnemyKind, level, ...(role ? { role } : {}) } };
}

function place(value: unknown): LocaleState | undefined {
  const raw = record(value);
  const id = text(raw?.id, 64);
  const x = int(raw?.x, 0, 100_000);
  const y = int(raw?.y, 0, 100_000);
  return raw && id && x != null && y != null ? { id, x, y } : undefined;
}

function opening(value: unknown): ExplorationOpening | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  const by = MAGE_CLASSES.includes(raw.by as MageClass) ? raw.by as MageClass : undefined;
  if (raw.kind === 'weapon') return { kind: 'weapon', by };
  if (raw.kind !== 'spell' || !Array.isArray(raw.words)) return undefined;
  const words = raw.words.slice(0, 3).filter((word): word is WordId => own(WORDS, word));
  return words.length ? { kind: 'spell', words, by } : undefined;
}

/** Which relay seat plays each party member. */
export function readMemberSeats(value: unknown): Partial<Record<MageClass, number>> {
  const raw = record(value);
  const out: Partial<Record<MageClass, number>> = {};
  for (const mageClass of MAGE_CLASSES) {
    const seat = int(raw?.[mageClass], 0, 3);
    if (seat != null) out[mageClass] = seat;
  }
  return out;
}

/** Read a pack the host put into the world (an ambush). Null when it is not one. */
export function parseWildPack(value: unknown): WildPack | null {
  const raw = record(value);
  const cell = (at: unknown): number | null =>
    typeof at === 'number' && Number.isInteger(at) && at >= 0 && at <= 100_000 ? at : null;
  const id = text(raw?.id, 96);
  const x = cell(raw?.x);
  const y = cell(raw?.y);
  const depth = int(raw?.depth, 1, 99);
  const sight = typeof raw?.sight === 'number' && Number.isFinite(raw.sight) ? Math.min(40, Math.max(0, raw.sight)) : null;
  if (!raw || !id || x == null || y == null || depth == null || sight == null) return null;
  const spawns = Array.isArray(raw.spawns) ? raw.spawns.slice(0, MAX_SPAWNS).map(spawn) : undefined;
  if (spawns && spawns.some((entry) => !entry)) return null;
  const pace = typeof raw.pace === 'number' && Number.isFinite(raw.pace) ? Math.min(20, Math.max(0.5, raw.pace)) : undefined;
  return {
    id,
    x,
    y,
    sight,
    depth,
    spawns: spawns as EncounterSpawn[] | undefined,
    label: text(raw.label, 160) ?? 'Something',
    tint: int(raw.tint, 0, 0xffffff) ?? 0xffffff,
    elite: raw.elite === true,
    zone: ZONES.includes(raw.zone as EncounterZone) ? raw.zone as EncounterZone : undefined,
    pace,
    hunting: raw.hunting === true,
  };
}

/** Read a fight the host sent. Null when it is not one. */
export function parseFightWire(value: unknown): FightWire | null {
  const raw = record(value);
  if (!raw) return null;
  const depth = int(raw.depth, 1, 99);
  if (depth == null) return null;
  const spawns = Array.isArray(raw.spawns) ? raw.spawns.slice(0, MAX_SPAWNS).map(spawn) : undefined;
  if (spawns && spawns.some((entry) => !entry)) return null;
  return {
    encounter: raw.encounter === 'robbery' ? 'robbery' : 'monsters',
    depth,
    cameFrom: text(raw.cameFrom, 64) ?? null,
    zone: ZONES.includes(raw.zone as EncounterZone) ? raw.zone as EncounterZone : undefined,
    spawns: spawns as EncounterSpawn[] | undefined,
    returnTo: place(raw.returnTo),
    fleeTo: place(raw.fleeTo),
    tag: text(raw.tag, 96),
    label: text(raw.label, 160),
    opening: opening(raw.opening),
    dungeon: DUNGEON_IDS.includes(raw.dungeon as DungeonId) ? raw.dungeon as DungeonId : undefined,
    seats: readMemberSeats(raw.seats),
    boss: parseBossFight(raw.boss),
  };
}
