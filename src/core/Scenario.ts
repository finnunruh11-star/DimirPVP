// =============================================================================
//  SCENARIO (saved combat "memories")
// -----------------------------------------------------------------------------
//  A scenario is a JSON snapshot of a whole fight: every entity (players,
//  creatures and summons) with its kit, resources, position and statuses, plus
//  the turn order. The Scenario Lab writes them; Memory mode reads them back to
//  drop you straight into that exact fight, which makes practising a specific
//  encounter repeatable.
//
//  Files are UNTRUSTED input, so everything that comes back off disk goes
//  through `parseScenario`, which rebuilds each value from scratch: ids are
//  checked against the real registries, numbers are clamped, arrays are capped
//  and dangerous object keys (__proto__ & friends) are dropped.
//
//  Deliberately NOT captured: the resolution stack, field objects (shadows,
//  totems, barriers, orbs, scarabs) and mid-cast bookkeeping. A scenario is a
//  starting position, not a save-state of a half-resolved action.
// =============================================================================

import { FIELD } from '../config/constants';
import { Dice } from './Dice';
import type { ColorName } from './Colors';
import type { MageClass } from './Classes';
import { toMageClass } from './Classes';
import { asItemIds, type ItemId } from './Items';
import { Mage } from './Mage';
import type { Scarab, ScarabState } from './Scarab';
import type { Status } from './Status';
import { WORDS, type WordId } from './Words';
import { ENEMY_DEFS, applyEnemyTraits, type EnemyKind } from '../pve/swamprun';
import { applyMineEnemyTraits, isMineEnemyKind, type SentinelRole } from '../pve/minerun';
import { attachSummonRider } from '../spells/summonRiders';

export const SCENARIO_VERSION = 1;

/** Hard caps so a malformed or hostile file cannot exhaust memory. */
const MAX_ENTITIES = 64;
const MAX_LIST = 64;
const MAX_STATUSES = 64;
const MAX_NAME = 48;
const BIG = 1e6;

/** Per-combat numeric fields copied verbatim. Every entry must be a `number`. */
const NUMBER_FLAGS = [
  'thunderStacks',
  'greedStacks',
  'momentumStacks',
  'anchorStacks',
  'rageBonus',
  'distMovedThisTurn',
  'deathsAngelEnergy',
  'deathsAngelFlightTurns',
  'shadowDaggerStealthRound',
  'reloadTurns',
  'wallAngle',
  'bindMantleCharges',
  'conjuredBowCombatsLeft',
  'dodgesRemaining',
  'wordSpellReactionsUsed',
  'weaponReactionsUsed',
  'leapsUsed',
  'summonMoveMultiplier',
  'arrows',
  'torchCombatsLeft',
  'silver',
  'intrinsicArmorFlat',
  'intrinsicInitiativePriority',
  'companionHealCharges',
  'damageCapPerSource',
  'drainLinkTurns',
  'beastDemonBlood',
  'lastAbilityManaPaid',
] as const satisfies readonly (keyof Mage)[];

/** Per-combat boolean fields copied verbatim. Every entry must be a `boolean`. */
const BOOL_FLAGS = [
  'statsAssigned',
  'bastionShieldForm',
  'shieldBashUsed',
  'blockPending',
  'firstBlackSpellUsed',
  'manaMilledOnce',
  'eldritchDefend',
  'redFirstWeaponAttackUsed',
  'redGenerator',
  'redSummonHaste',
  'blackBellCondense',
  'edgelordLanternActive',
  'conjuredBowFiredThisTurn',
  'movedThisTurn',
  'dealtDamageThisTurn',
  'reactionAvailable',
  'reactedThisCycle',
  'focusUsed',
  'cleaveUsed',
  'focusNextSpell',
  'hasCastThisTurn',
  'unkillable',
  'trainingPassive',
  'isSummon',
  'sanityImmune',
  'physicalImmune',
  'cannotAttack',
  'debuffImmune',
  'isBoss',
  'intrinsicAirborne',
  'justSpawned',
  'reviveAtHalfAvailable',
  'ghastKind',
  'beastDemonKind',
  'oniKind',
  'oniHidden',
  'deathknightKind',
  'slowStunImmune',
  'acidZombieKind',
  'reaperKind',
  'reaperChanneling',
  'expeditionPermanent',
  'unarmedBanned',
] as const satisfies readonly (keyof Mage)[];

type NumberFlag = (typeof NUMBER_FLAGS)[number];
type BoolFlag = (typeof BOOL_FLAGS)[number];

export interface ScenarioEntity {
  name: string;
  team: number;
  isAI: boolean;
  mageClass: MageClass;
  loadout: WordId[];
  primaryColor: ColorName | null;
  secondaryColor: ColorName | null;
  x: number;
  y: number;
  stats: { strength: number; dex: number; int: number };
  vitals: {
    hp: number;
    maxHp: number;
    mana: number;
    maxMana: number;
    sanity: number;
    maxSanity: number;
    luck: number;
    maxLuck: number;
    colorCharges: number;
    maxColorCharges: number;
  };
  charges: Record<string, number>;
  abilityCastsUsed: Record<string, number>;
  actions: { move: number; main: number; bonus: number };
  gear: {
    hands: ItemId[];
    bag: ItemId[];
    head: ItemId | null;
    torso: ItemId | null;
    boots: ItemId | null;
    accessories: ItemId[];
    utility: ItemId[];
  };
  statuses: Status[];
  numbers: Partial<Record<NumberFlag, number>>;
  bools: Partial<Record<BoolFlag, boolean>>;
  /** Rebuilds a creature's intrinsic kit (including its on-hit riders). */
  creature?: { kind?: string; mine?: { kind: string; level: number; role?: SentinelRole } };
  intrinsic: {
    immune: string[];
    resist: string[];
    weak: string[];
    moveUnits?: number;
    bodyRadius?: number;
    meleeReach?: number;
    meleeMin?: number;
    melee?: { spec: string; type: string; damageClass: string };
    damageAura?: { radius: number; damageSpec: string; type: string; damageClass: string };
  };
  summon?: {
    kind?: string;
    ownerIndex?: number;
    moveUnits?: number;
    order?: { kind: 'move' | 'attack' | 'follow'; x?: number; y?: number; targetIndex?: number };
  };
  /** Index-based links to other entities in this same scenario. */
  links: {
    drainLinkTo?: number;
    reaperMarkedBy?: number;
    reaperDeletedBy?: number;
    edgelordCapturedBy?: number;
  };
}

/** A scarab swarm member. Ids are re-issued on load, so they are not stored. */
export interface ScenarioScarab {
  x: number;
  y: number;
  owner: number;
  ownerIndex?: number;
  hp: number;
  maxHp: number;
  sanity: number;
  maxSanity: number;
  state: ScarabState;
  targetIndex?: number;
}

export interface Scenario {
  version: number;
  name: string;
  createdAt: string;
  entities: ScenarioEntity[];
  scarabs: ScenarioScarab[];
  turn: {
    order: number[];
    rolls: number[];
    currentIndex: number;
    round: number;
    turnSeq: number;
  };
}

/** The slice of GameState a scenario reads and writes. */
export interface ScenarioSource {
  mages: Mage[];
  scarabs: Scarab[];
  initiativeOrder: number[];
  initiativeRolls: number[];
  currentIndex: number;
  round: number;
  turnSeq: number;
}

// ---------------------------------------------------------------------------
//  CAPTURE
// ---------------------------------------------------------------------------

export function captureScenario(gs: ScenarioSource, name: string): Scenario {
  const index = new Map<Mage, number>();
  gs.mages.forEach((m, i) => index.set(m, i));
  return {
    version: SCENARIO_VERSION,
    name: name.slice(0, MAX_NAME) || 'Untitled fight',
    createdAt: new Date().toISOString(),
    entities: gs.mages.map((m) => captureEntity(m, index)),
    scarabs: gs.scarabs.map((s) => ({
      x: s.x,
      y: s.y,
      owner: s.owner,
      ownerIndex: s.ownerIndex,
      hp: s.hp,
      maxHp: s.maxHp,
      sanity: s.sanity,
      maxSanity: s.maxSanity,
      state: s.state,
      targetIndex: s.target ? index.get(s.target) : undefined,
    })),
    turn: {
      order: [...gs.initiativeOrder],
      rolls: [...gs.initiativeRolls],
      currentIndex: gs.currentIndex,
      round: gs.round,
      turnSeq: gs.turnSeq,
    },
  };
}

function captureEntity(m: Mage, index: Map<Mage, number>): ScenarioEntity {
  const numbers: Partial<Record<NumberFlag, number>> = {};
  for (const key of NUMBER_FLAGS) numbers[key] = m[key];
  const bools: Partial<Record<BoolFlag, boolean>> = {};
  for (const key of BOOL_FLAGS) bools[key] = m[key];
  return {
    name: m.name,
    team: m.team,
    isAI: m.isAI,
    mageClass: m.mageClass,
    loadout: [...m.loadout],
    primaryColor: m.preferredPrimaryColor,
    secondaryColor: m.preferredSecondaryColor,
    x: m.x,
    y: m.y,
    stats: { strength: m.statStrength, dex: m.statDex, int: m.statInt },
    vitals: {
      hp: m.hp,
      maxHp: m.maxHp,
      mana: m.mana,
      maxMana: m.maxMana,
      sanity: m.sanity,
      maxSanity: m.maxSanity,
      luck: m.luck,
      maxLuck: m.maxLuck,
      colorCharges: m.colorCharges,
      maxColorCharges: m.maxColorCharges,
    },
    charges: { ...m.charges },
    abilityCastsUsed: { ...m.abilityCastsUsed },
    actions: { ...m.actions },
    gear: {
      hands: [...m.hands],
      bag: [...m.bag],
      head: m.head,
      torso: m.torso,
      boots: m.boots,
      accessories: [...m.accessories],
      utility: [...m.utility],
    },
    statuses: JSON.parse(JSON.stringify(m.statuses)) as Status[],
    numbers,
    bools,
    creature:
      m.enemyKind || m.mine
        ? {
          kind: m.enemyKind,
          mine: m.mine
            ? { kind: m.mine.kind, level: m.mine.level, role: m.mine.role }
            : undefined,
        }
        : undefined,
    intrinsic: {
      immune: [...m.intrinsicImmuneTypes],
      resist: [...m.intrinsicResistTypes],
      weak: [...m.intrinsicWeakTypes],
      moveUnits: m.intrinsicMoveUnits,
      bodyRadius: m.intrinsicBodyRadius,
      meleeReach: m.intrinsicMeleeReach,
      meleeMin: m.intrinsicMeleeMin,
      melee: m.intrinsicMelee
        ? {
          spec: m.intrinsicMelee.spec,
          type: m.intrinsicMelee.type,
          damageClass: m.intrinsicMelee.damageClass,
        }
        : undefined,
      damageAura: m.intrinsicDamageAura ? { ...m.intrinsicDamageAura } : undefined,
    },
    summon: m.isSummon
      ? {
        kind: m.summonKind,
        ownerIndex: m.summonOwnerIndex,
        moveUnits: m.summonMoveUnits,
        order: m.summonOrder
          ? {
            kind: m.summonOrder.kind,
            x: m.summonOrder.point?.x,
            y: m.summonOrder.point?.y,
            targetIndex: m.summonOrder.targetIndex,
          }
          : undefined,
      }
      : undefined,
    links: {
      drainLinkTo: m.drainLinkTo ? index.get(m.drainLinkTo) : undefined,
      reaperMarkedBy: m.reaperMarkedBy ? index.get(m.reaperMarkedBy) : undefined,
      reaperDeletedBy: m.reaperDeletedBy ? index.get(m.reaperDeletedBy) : undefined,
      edgelordCapturedBy: m.edgelordCapturedBy ? index.get(m.edgelordCapturedBy) : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
//  SANITISING PARSER  (everything below treats its input as hostile)
// ---------------------------------------------------------------------------

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback: number, min = -BIG, max = BIG): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

function int(value: unknown, fallback: number, min = -BIG, max = BIG): number {
  return Math.round(num(value, fallback, min, max));
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.slice(0, MAX_NAME) : fallback;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value.slice(0, MAX_LIST) : [];
}

/** A fresh record with only finite numbers, skipping prototype-polluting keys. */
function numberRecord(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(value)) return out;
  for (const [key, raw] of Object.entries(value).slice(0, MAX_LIST)) {
    if (UNSAFE_KEYS.has(key) || typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    out[key] = Math.max(0, Math.round(raw));
  }
  return out;
}

function words(value: unknown): WordId[] {
  return list(value).filter((w): w is WordId => typeof w === 'string' && w in WORDS);
}

function items(value: unknown): ItemId[] {
  return asItemIds(list(value));
}

function item(value: unknown): ItemId | null {
  return items([value])[0] ?? null;
}

function colorName(value: unknown): ColorName | null {
  return value === 'black' || value === 'blue' || value === 'white' || value === 'red'
    ? value
    : null;
}

function damageTypes(value: unknown): string[] {
  return list(value).filter((t): t is string => typeof t === 'string');
}

/** Statuses are plain data; keep only well-formed entries and deep-copy them. */
function statuses(value: unknown): Status[] {
  const out: Status[] = [];
  for (const raw of list(value).slice(0, MAX_STATUSES)) {
    if (!isRecord(raw)) continue;
    if (typeof raw.kind !== 'string' || typeof raw.key !== 'string') continue;
    if (typeof raw.name !== 'string' || typeof raw.duration !== 'number') continue;
    const copy = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
    for (const key of UNSAFE_KEYS) delete copy[key];
    out.push(copy as unknown as Status);
  }
  return out;
}

function entityIndex(value: unknown, count: number): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  return value >= 0 && value < count ? value : undefined;
}

function parseSummonOrder(raw: Record<string, unknown>): NonNullable<NonNullable<ScenarioEntity['summon']>['order']> {
  const kind = raw.kind === 'attack' || raw.kind === 'follow' ? raw.kind : 'move';
  const hasPoint = typeof raw.x === 'number' && typeof raw.y === 'number';
  return {
    kind,
    x: hasPoint ? num(raw.x, 0, FIELD.x, FIELD.x + FIELD.w) : undefined,
    y: hasPoint ? num(raw.y, 0, FIELD.y, FIELD.y + FIELD.h) : undefined,
    targetIndex: entityIndex(raw.targetIndex, MAX_ENTITIES),
  };
}

function parseScarab(raw: unknown): ScenarioScarab {
  const s = isRecord(raw) ? raw : {};
  const state = s.state;
  const maxHp = int(s.maxHp, 1, 1, BIG);
  const maxSanity = int(s.maxSanity, 1, 1, BIG);
  return {
    x: num(s.x, FIELD.x, FIELD.x, FIELD.x + FIELD.w),
    y: num(s.y, FIELD.y, FIELD.y, FIELD.y + FIELD.h),
    owner: int(s.owner, 1, 1, 8),
    ownerIndex: typeof s.ownerIndex === 'number' ? int(s.ownerIndex, 0, 0, MAX_ENTITIES) : undefined,
    hp: int(s.hp, maxHp, 0, maxHp),
    maxHp,
    sanity: int(s.sanity, maxSanity, 0, maxSanity),
    maxSanity,
    state:
      state === 'attached' || state === 'returning' || state === 'resting' ? state : 'seeking',
    targetIndex: entityIndex(s.targetIndex, MAX_ENTITIES),
  };
}

function parseEntity(raw: unknown): ScenarioEntity {
  const e = isRecord(raw) ? raw : {};
  const vitals = isRecord(e.vitals) ? e.vitals : {};
  const stats = isRecord(e.stats) ? e.stats : {};
  const actions = isRecord(e.actions) ? e.actions : {};
  const gear = isRecord(e.gear) ? e.gear : {};
  const intrinsic = isRecord(e.intrinsic) ? e.intrinsic : {};
  const creature = isRecord(e.creature) ? e.creature : undefined;
  const mine = creature && isRecord(creature.mine) ? creature.mine : undefined;
  const summon = isRecord(e.summon) ? e.summon : undefined;
  const order = summon && isRecord(summon.order) ? summon.order : undefined;
  const links = isRecord(e.links) ? e.links : {};
  const melee = isRecord(intrinsic.melee) ? intrinsic.melee : undefined;
  const aura = isRecord(intrinsic.damageAura) ? intrinsic.damageAura : undefined;

  const numbers: Partial<Record<NumberFlag, number>> = {};
  const rawNumbers = isRecord(e.numbers) ? e.numbers : {};
  for (const key of NUMBER_FLAGS) {
    const value = rawNumbers[key];
    if (typeof value === 'number' && Number.isFinite(value)) numbers[key] = num(value, 0);
  }
  const bools: Partial<Record<BoolFlag, boolean>> = {};
  const rawBools = isRecord(e.bools) ? e.bools : {};
  for (const key of BOOL_FLAGS) {
    if (typeof rawBools[key] === 'boolean') bools[key] = rawBools[key];
  }

  const maxHp = int(vitals.maxHp, 12, 1, BIG);
  const maxMana = int(vitals.maxMana, 24, 0, BIG);
  const maxSanity = int(vitals.maxSanity, 20, 1, BIG);
  const maxLuck = int(vitals.maxLuck, 0, 0, BIG);
  const maxColorCharges = int(vitals.maxColorCharges, 12, 0, BIG);
  const role = mine?.role;
  return {
    name: str(e.name, 'Entity') || 'Entity',
    team: int(e.team, 1, 1, 8),
    isAI: bool(e.isAI, true),
    mageClass: toMageClass(e.mageClass),
    loadout: words(e.loadout),
    primaryColor: colorName(e.primaryColor),
    secondaryColor: colorName(e.secondaryColor),
    x: num(e.x, FIELD.x + FIELD.w / 2, FIELD.x, FIELD.x + FIELD.w),
    y: num(e.y, FIELD.y + FIELD.h / 2, FIELD.y, FIELD.y + FIELD.h),
    stats: {
      strength: int(stats.strength, 0, 0, 999),
      dex: int(stats.dex, 0, 0, 999),
      int: int(stats.int, 0, 0, 999),
    },
    vitals: {
      hp: int(vitals.hp, maxHp, 0, maxHp),
      maxHp,
      mana: int(vitals.mana, maxMana, 0, maxMana),
      maxMana,
      sanity: int(vitals.sanity, maxSanity, 0, maxSanity),
      maxSanity,
      luck: int(vitals.luck, maxLuck, 0, maxLuck),
      maxLuck,
      colorCharges: int(vitals.colorCharges, 0, 0, maxColorCharges),
      maxColorCharges,
    },
    charges: numberRecord(e.charges),
    abilityCastsUsed: numberRecord(e.abilityCastsUsed),
    actions: {
      move: int(actions.move, 1, 0, 99),
      main: int(actions.main, 1, 0, 99),
      bonus: int(actions.bonus, 2, 0, 99),
    },
    gear: {
      hands: items(gear.hands).slice(0, 2),
      bag: items(gear.bag),
      head: item(gear.head),
      torso: item(gear.torso),
      boots: item(gear.boots),
      accessories: items(gear.accessories).slice(0, 2),
      utility: items(gear.utility),
    },
    statuses: statuses(e.statuses),
    numbers,
    bools,
    creature: creature
      ? {
        kind: typeof creature.kind === 'string' ? creature.kind : undefined,
        mine:
          mine && typeof mine.kind === 'string'
            ? {
              kind: mine.kind,
              level: int(mine.level, 1, 1, 99),
              role: role === 'tank' || role === 'healer' || role === 'dps' ? role : undefined,
            }
            : undefined,
      }
      : undefined,
    intrinsic: {
      immune: damageTypes(intrinsic.immune),
      resist: damageTypes(intrinsic.resist),
      weak: damageTypes(intrinsic.weak),
      moveUnits: typeof intrinsic.moveUnits === 'number' ? num(intrinsic.moveUnits, 0, 0, 999) : undefined,
      bodyRadius:
        typeof intrinsic.bodyRadius === 'number' ? num(intrinsic.bodyRadius, 0, 0, 999) : undefined,
      meleeReach:
        typeof intrinsic.meleeReach === 'number' ? num(intrinsic.meleeReach, 0, 0, 9999) : undefined,
      meleeMin: typeof intrinsic.meleeMin === 'number' ? num(intrinsic.meleeMin, 0, 0, 9999) : undefined,
      melee: melee
        ? {
          spec: str(melee.spec, '1d3'),
          type: str(melee.type, 'generic'),
          damageClass: str(melee.damageClass, 'physical'),
        }
        : undefined,
      damageAura: aura
        ? {
          radius: num(aura.radius, 0, 0, 9999),
          damageSpec: str(aura.damageSpec, '1d3'),
          type: str(aura.type, 'generic'),
          damageClass: str(aura.damageClass, 'physical'),
        }
        : undefined,
    },
    summon: summon
      ? {
        kind: typeof summon.kind === 'string' ? summon.kind : undefined,
        ownerIndex:
          typeof summon.ownerIndex === 'number' ? int(summon.ownerIndex, 0, 0, MAX_ENTITIES) : undefined,
        moveUnits: typeof summon.moveUnits === 'number' ? num(summon.moveUnits, 0, 0, 999) : undefined,
        order: order ? parseSummonOrder(order) : undefined,
      }
      : undefined,
    links: {
      drainLinkTo: entityIndex(links.drainLinkTo, MAX_ENTITIES),
      reaperMarkedBy: entityIndex(links.reaperMarkedBy, MAX_ENTITIES),
      reaperDeletedBy: entityIndex(links.reaperDeletedBy, MAX_ENTITIES),
      edgelordCapturedBy: entityIndex(links.edgelordCapturedBy, MAX_ENTITIES),
    },
  };
}

/** Rebuild a scenario from untrusted JSON text. Throws with a readable reason. */
export function parseScenario(text: string): Scenario {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!isRecord(raw)) throw new Error('That file does not contain a scenario.');
  const entitiesRaw = Array.isArray(raw.entities) ? raw.entities.slice(0, MAX_ENTITIES) : [];
  if (entitiesRaw.length === 0) throw new Error('That scenario has no entities.');
  const entities = entitiesRaw.map(parseEntity);
  const count = entities.length;
  for (const e of entities) {
    e.links = {
      drainLinkTo: entityIndex(e.links.drainLinkTo, count),
      reaperMarkedBy: entityIndex(e.links.reaperMarkedBy, count),
      reaperDeletedBy: entityIndex(e.links.reaperDeletedBy, count),
      edgelordCapturedBy: entityIndex(e.links.edgelordCapturedBy, count),
    };
    if (e.summon) e.summon.ownerIndex = entityIndex(e.summon.ownerIndex, count);
    if (e.summon?.order) e.summon.order.targetIndex = entityIndex(e.summon.order.targetIndex, count);
  }
  const scarabs = list(raw.scarabs)
    .slice(0, MAX_LIST)
    .map(parseScarab)
    .map((s) => ({
      ...s,
      ownerIndex: entityIndex(s.ownerIndex, count),
      targetIndex: entityIndex(s.targetIndex, count),
    }));
  const turnRaw = isRecord(raw.turn) ? raw.turn : {};
  // Summons never hold initiative: their owner drives them with Command.
  const order = list(turnRaw.order)
    .map((v) => entityIndex(v, count))
    .filter((v): v is number => v !== undefined && !entities[v].summon);
  const seen = new Set<number>();
  const uniqueOrder = order.filter((i) => !seen.has(i) && seen.add(i));
  for (let i = 0; i < count; i++) {
    if (!seen.has(i) && !entities[i].summon) uniqueOrder.push(i);
  }
  const rolls = entities.map((_, i) => int(list(turnRaw.rolls)[i], 0, 0, 999));
  return {
    version: int(raw.version, SCENARIO_VERSION, 0, 999),
    name: str(raw.name, 'Untitled fight') || 'Untitled fight',
    createdAt: str(raw.createdAt, ''),
    entities,
    scarabs,
    turn: {
      order: uniqueOrder,
      rolls,
      currentIndex: entityIndex(turnRaw.currentIndex, count) ?? uniqueOrder[0] ?? 0,
      round: int(turnRaw.round, 1, 1, 9999),
      turnSeq: int(turnRaw.turnSeq, 0, 0, 1e6),
    },
  };
}

// ---------------------------------------------------------------------------
//  RESTORE
// ---------------------------------------------------------------------------

/** Rebuild every combatant described by a scenario, in its stored order. */
export function scenarioToMages(scenario: Scenario, rng: Dice = new Dice()): Mage[] {
  const mages = scenario.entities.map((e) => buildMage(e, rng));
  scenario.entities.forEach((e, i) => {
    const m = mages[i];
    const at = (idx: number | undefined): Mage | undefined =>
      idx === undefined ? undefined : mages[idx];
    m.drainLinkTo = at(e.links.drainLinkTo);
    m.reaperMarkedBy = at(e.links.reaperMarkedBy);
    m.reaperDeletedBy = at(e.links.reaperDeletedBy);
    m.edgelordCapturedBy = at(e.links.edgelordCapturedBy);
  });
  return mages;
}

/** Rebuild the scarab swarm; the caller issues the ids. */
export function scenarioToScarabs(scenario: Scenario, mages: Mage[]): Omit<Scarab, 'id'>[] {
  return scenario.scarabs.map((s) => ({
    x: s.x,
    y: s.y,
    owner: s.owner,
    ownerIndex: s.ownerIndex,
    hp: s.hp,
    maxHp: s.maxHp,
    sanity: s.sanity,
    maxSanity: s.maxSanity,
    state: s.state,
    target: s.targetIndex !== undefined ? mages[s.targetIndex] ?? null : null,
  }));
}

function buildMage(e: ScenarioEntity, rng: Dice): Mage {
  const m = new Mage({
    name: e.name,
    isAI: e.isAI,
    team: e.team,
    position: { x: e.x, y: e.y },
    loadout: e.loadout,
    mageClass: e.mageClass,
  });
  m.setLoadout(e.loadout, e.primaryColor, e.secondaryColor);

  // Re-run the creature builders first: they restore the parts of a monster kit
  // that JSON cannot carry, such as an intrinsic strike's on-hit rider.
  const kind = e.creature?.kind;
  if (kind && kind in ENEMY_DEFS) applyEnemyTraits(m, kind as EnemyKind, rng);
  const mine = e.creature?.mine;
  if (mine && isMineEnemyKind(mine.kind)) {
    applyMineEnemyTraits(m, { kind: mine.kind, level: mine.level, role: mine.role }, rng);
  }

  m.statStrength = e.stats.strength;
  m.statDex = e.stats.dex;
  m.statInt = e.stats.int;
  m.maxHp = e.vitals.maxHp;
  m.hp = e.vitals.hp;
  m.maxMana = e.vitals.maxMana;
  m.mana = e.vitals.mana;
  m.maxSanity = e.vitals.maxSanity;
  m.sanity = e.vitals.sanity;
  m.maxLuck = e.vitals.maxLuck;
  m.luck = e.vitals.luck;
  m.maxColorCharges = e.vitals.maxColorCharges;
  m.colorCharges = e.vitals.colorCharges;
  m.charges = { ...e.charges };
  m.abilityCastsUsed = { ...e.abilityCastsUsed };
  m.actions = { ...e.actions };

  m.hands = [...e.gear.hands];
  m.bag = [...e.gear.bag];
  m.head = e.gear.head;
  m.torso = e.gear.torso;
  m.boots = e.gear.boots;
  m.accessories = [...e.gear.accessories];
  m.utility = [...e.gear.utility];
  m.statuses = e.statuses;

  for (const key of NUMBER_FLAGS) {
    const value = e.numbers[key];
    if (value !== undefined) m[key] = value;
  }
  for (const key of BOOL_FLAGS) {
    const value = e.bools[key];
    if (value !== undefined) m[key] = value;
  }

  if (e.creature?.kind) m.enemyKind = e.creature.kind;
  m.intrinsicImmuneTypes = e.intrinsic.immune as Mage['intrinsicImmuneTypes'];
  m.intrinsicResistTypes = e.intrinsic.resist as Mage['intrinsicResistTypes'];
  m.intrinsicWeakTypes = e.intrinsic.weak as Mage['intrinsicWeakTypes'];
  m.intrinsicMoveUnits = e.intrinsic.moveUnits;
  m.intrinsicBodyRadius = e.intrinsic.bodyRadius;
  m.intrinsicMeleeReach = e.intrinsic.meleeReach;
  m.intrinsicMeleeMin = e.intrinsic.meleeMin;
  if (e.intrinsic.melee) {
    // Overwrite the numbers in place so a rebuilt creature keeps its on-hit rider.
    const melee = e.intrinsic.melee as unknown as NonNullable<Mage['intrinsicMelee']>;
    m.intrinsicMelee = m.intrinsicMelee
      ? { ...m.intrinsicMelee, spec: melee.spec, type: melee.type, damageClass: melee.damageClass }
      : melee;
  } else {
    m.intrinsicMelee = undefined;
  }
  m.intrinsicDamageAura = e.intrinsic.damageAura
    ? (e.intrinsic.damageAura as unknown as Mage['intrinsicDamageAura'])
    : undefined;

  if (e.summon) {
    m.isSummon = true;
    m.summonKind = e.summon.kind;
    m.summonOwnerIndex = e.summon.ownerIndex;
    m.summonMoveUnits = e.summon.moveUnits;
    m.summonOrder = e.summon.order
      ? {
        kind: e.summon.order.kind,
        point:
          e.summon.order.x !== undefined && e.summon.order.y !== undefined
            ? { x: e.summon.order.x, y: e.summon.order.y }
            : undefined,
        targetIndex: e.summon.order.targetIndex,
      }
      : undefined;
    // A strike rider is a function, so it is rebuilt from the summon's kind.
    if (e.summon.kind) attachSummonRider(m, e.summon.kind);
  }
  return m;
}
