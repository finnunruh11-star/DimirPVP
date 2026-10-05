// A scene fight as it is laid out on the field: who stands where, on which
// side, how hurt, and what props stand among them. Pure data plus the checks
// the wire needs.

import { isMineEnemyKind, type MineEnemyKind } from '../minerun';
import { ENEMY_DEFS, type EnemyKind } from '../swamprun';
import { WAYSIDE_KINDS, type WaysideKind } from './shops';

/** foe: must fall to win. rival: fights everyone and must fall too. prey: fights nobody. escort: fights for the party. */
export type SceneSide = 'foe' | 'rival' | 'prey' | 'escort';
/** Scene-only people: a dwarven guard who fights, and a villager who does not. */
export type ScenePerson = 'dwarf-guard' | 'villager';
export type SceneUnitKind = EnemyKind | MineEnemyKind | ScenePerson;
export type ScenePropKind = 'campfire' | 'burnt-bush' | 'carriage' | 'boat' | 'cart' | 'salt-lick';

export const SCENE_SIDES: readonly SceneSide[] = ['foe', 'rival', 'prey', 'escort'];
export const SCENE_PEOPLE: readonly ScenePerson[] = ['dwarf-guard', 'villager'];
export const SCENE_PROPS: readonly ScenePropKind[] = ['campfire', 'burnt-bush', 'carriage', 'boat', 'cart', 'salt-lick'];

export interface SceneUnit {
  kind: SceneUnitKind;
  side: SceneSide;
  /** Where it stands, as a share of the field's width and height. The party lines up at the left. */
  x: number;
  y: number;
  /** Share of its health it starts with. */
  hp?: number;
  /** Cannot move: tied up, stuck on a spit. */
  tied?: boolean;
  name?: string;
}

export interface SceneProp {
  kind: ScenePropKind;
  x: number;
  y: number;
}

export interface SceneFight {
  id: string;
  units: SceneUnit[];
  props: SceneProp[];
  /** A merchant saved by winning opens these wares. */
  wares?: WaysideKind;
}

/** Most extra foes a bigger party draws into a scene. */
const MAX_EXTRA = 3;

/**
 * The units that take the field for `fighters` party members: every fighter past
 * the first brings one more of the scene's first foe (or rival), stood beside it.
 */
export function sceneRoster(fight: SceneFight, fighters: number): SceneUnit[] {
  const lead = fight.units.find((unit) => unit.side === 'foe') ?? fight.units.find((unit) => unit.side === 'rival');
  const extra = lead ? Math.min(MAX_EXTRA, Math.max(0, fighters - 1)) : 0;
  const out = [...fight.units];
  for (let i = 0; i < extra; i++) {
    const side = i % 2 ? 1 : -1;
    out.push({
      ...lead!,
      x: clampShare(lead!.x + 0.05 * (1 + Math.floor(i / 2))),
      y: clampShare(lead!.y + side * 0.16 * (1 + Math.floor(i / 2))),
    });
  }
  return out;
}

const clampShare = (value: number): number => Math.min(0.95, Math.max(0.05, value));

export function isSceneUnitKind(kind: unknown): kind is SceneUnitKind {
  if (typeof kind !== 'string') return false;
  return (SCENE_PEOPLE as readonly string[]).includes(kind) || isMineEnemyKind(kind) || Object.prototype.hasOwnProperty.call(ENEMY_DEFS, kind);
}

// ---- the wire ------------------------------------------------------------------

type Loose = Record<string, unknown>;
const record = (value: unknown): Loose | null => (value && typeof value === 'object' && !Array.isArray(value) ? value as Loose : null);
const share = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? clampShare(value) : null);
const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined;

function parseUnit(value: unknown): SceneUnit | null {
  const raw = record(value);
  if (!raw || !isSceneUnitKind(raw.kind) || !(SCENE_SIDES as readonly unknown[]).includes(raw.side)) return null;
  const x = share(raw.x);
  const y = share(raw.y);
  if (x == null || y == null) return null;
  const unit: SceneUnit = { kind: raw.kind, side: raw.side as SceneSide, x, y };
  if (typeof raw.hp === 'number' && Number.isFinite(raw.hp)) unit.hp = Math.min(1, Math.max(0.05, raw.hp));
  if (raw.tied === true) unit.tied = true;
  const name = text(raw.name, 24);
  if (name) unit.name = name;
  return unit;
}

/** A scene fight read off the wire; anything malformed or oversized is refused. */
export function parseSceneFight(value: unknown): SceneFight | undefined {
  const raw = record(value);
  const id = raw ? text(raw.id, 40) : undefined;
  if (!raw || !id || !Array.isArray(raw.units) || raw.units.length > 16) return undefined;
  const units = raw.units.map(parseUnit);
  if (units.some((unit) => !unit) || units.length === 0) return undefined;
  const props: SceneProp[] = [];
  if (Array.isArray(raw.props)) {
    for (const item of raw.props.slice(0, 8)) {
      const prop = record(item);
      const x = share(prop?.x);
      const y = share(prop?.y);
      if (prop && (SCENE_PROPS as readonly unknown[]).includes(prop.kind) && x != null && y != null) props.push({ kind: prop.kind as ScenePropKind, x, y });
    }
  }
  const fight: SceneFight = { id, units: units as SceneUnit[], props };
  if ((WAYSIDE_KINDS as readonly unknown[]).includes(raw.wares)) fight.wares = raw.wares as WaysideKind;
  return fight;
}
