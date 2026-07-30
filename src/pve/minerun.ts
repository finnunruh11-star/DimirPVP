// Mine Run creature data, deterministic level scaling, wave composition, and
// salvage. Runtime actions live separately so this module stays Phaser-free.

import type { DamageClass, DamageType } from '../core/Damage';
import type { Dice } from '../core/Dice';
import type { ItemId } from '../core/Items';
import type { Mage } from '../core/Mage';
import { swamprunPartyScale } from './swamprun';

export type MineEnemyKind =
  | 'rockling'
  | 'kobold'
  | 'elite-kobold'
  | 'golem'
  | 'sentinel'
  | 'magma-sentinel'
  | 'earth-elemental'
  | 'pftlhb'
  | 'cavern-bat'
  | 'red-dragonborn'
  | 'black-dragonborn';

export type SentinelRole = 'tank' | 'healer' | 'dps';

export interface MineSpawnSpec {
  kind: MineEnemyKind;
  level: number;
  role?: SentinelRole;
}

interface MineStats {
  strength: number;
  dex: number;
  int: number;
}

interface MineMelee {
  spec: string;
  type: DamageType;
  damageClass: DamageClass;
  reach?: number;
}

export interface MineEnemyDef {
  kind: MineEnemyKind;
  name: string;
  hpSpec: string;
  sanity: number;
  moveUnits: number;
  stats: MineStats;
  /** Levels between permanent gains in each stat; 0 disables that stat's growth. */
  statGrowth: MineStats;
  melee?: MineMelee;
  immuneTypes?: DamageType[];
  resistTypes?: DamageType[];
  weakTypes?: DamageType[];
  airborne?: boolean;
  cannotAttack?: boolean;
  initiativePriority?: number;
  bodyRadius?: number;
  tint: number;
  scale: number;
  unlock: number;
  cost: number;
  packSize?: number;
}

const FIRE_RESIST: DamageType[] = ['fire', 'light'];
const FIRE_WEAK: DamageType[] = ['shadow'];
const SCALE_RESIST: DamageType[] = ['slashing'];
const SCALE_WEAK: DamageType[] = ['pierce'];

export const MINE_ENEMY_DEFS: Record<MineEnemyKind, MineEnemyDef> = {
  rockling: {
    kind: 'rockling',
    name: 'Rockling',
    hpSpec: '1d3+1',
    sanity: 2,
    moveUnits: 9,
    stats: { strength: 1, dex: 7, int: 0 },
    statGrowth: { strength: 6, dex: 3, int: 0 },
    cannotAttack: true,
    bodyRadius: 10,
    tint: 0x8d8375,
    scale: 0.45,
    unlock: 1,
    cost: 2,
    packSize: 3,
  },
  kobold: {
    kind: 'kobold',
    name: 'Kobold',
    hpSpec: '2d4+5',
    sanity: 10,
    moveUnits: 8,
    stats: { strength: 3, dex: 6, int: 2 },
    statGrowth: { strength: 3, dex: 2, int: 6 },
    resistTypes: [...SCALE_RESIST],
    weakTypes: [...SCALE_WEAK],
    tint: 0xb58a54,
    scale: 0.78,
    unlock: 1,
    cost: 3,
  },
  'elite-kobold': {
    kind: 'elite-kobold',
    name: 'Elite Kobold',
    hpSpec: '2d4+8',
    sanity: 12,
    moveUnits: 8,
    stats: { strength: 4, dex: 7, int: 4 },
    statGrowth: { strength: 3, dex: 2, int: 3 },
    resistTypes: [...SCALE_RESIST],
    weakTypes: [...SCALE_WEAK],
    initiativePriority: 1,
    tint: 0xd4473f,
    scale: 0.86,
    unlock: 4,
    cost: 6,
  },
  golem: {
    kind: 'golem',
    name: 'Golem',
    hpSpec: '4d8+24',
    sanity: 6,
    moveUnits: 2,
    stats: { strength: 8, dex: 0, int: 0 },
    statGrowth: { strength: 2, dex: 0, int: 0 },
    melee: { spec: '2d6', type: 'shatter', damageClass: 'physical', reach: 112 },
    bodyRadius: 52,
    tint: 0x77746d,
    scale: 1.62,
    unlock: 4,
    cost: 9,
  },
  sentinel: {
    kind: 'sentinel',
    name: 'Sentinel',
    hpSpec: '2d6+8',
    sanity: 9,
    moveUnits: 5,
    stats: { strength: 3, dex: 3, int: 4 },
    statGrowth: { strength: 3, dex: 3, int: 2 },
    melee: { spec: '1d4', type: 'fire', damageClass: 'physical' },
    resistTypes: [...FIRE_RESIST],
    weakTypes: [...FIRE_WEAK],
    tint: 0xd4a24f,
    scale: 1.02,
    unlock: 3,
    cost: 6,
  },
  'magma-sentinel': {
    kind: 'magma-sentinel',
    name: 'Magma Sentinel',
    hpSpec: '2d6+8',
    sanity: 9,
    moveUnits: 5,
    stats: { strength: 5, dex: 5, int: 6 },
    statGrowth: { strength: 3, dex: 3, int: 2 },
    melee: { spec: '1d6', type: 'fire', damageClass: 'physical' },
    resistTypes: [...FIRE_RESIST],
    weakTypes: [...FIRE_WEAK],
    bodyRadius: 34,
    tint: 0xff6b2c,
    scale: 1.32,
    unlock: 8,
    cost: 12,
  },
  'earth-elemental': {
    kind: 'earth-elemental',
    name: 'Earth Elemental',
    hpSpec: '3d8+18',
    sanity: 9,
    moveUnits: 3,
    stats: { strength: 7, dex: 1, int: 2 },
    statGrowth: { strength: 2, dex: 6, int: 4 },
    cannotAttack: true,
    bodyRadius: 46,
    tint: 0x8f7659,
    scale: 1.45,
    unlock: 5,
    cost: 8,
  },
  pftlhb: {
    kind: 'pftlhb',
    name: 'Pftlhb',
    hpSpec: '3d6+6',
    sanity: 12,
    moveUnits: 6,
    stats: { strength: 7, dex: 4, int: 2 },
    statGrowth: { strength: 2, dex: 3, int: 6 },
    melee: { spec: '3d8', type: 'shadow', damageClass: 'physical' },
    tint: 0x19172a,
    scale: 1.06,
    unlock: 5,
    cost: 6,
  },
  'cavern-bat': {
    kind: 'cavern-bat',
    name: 'Cavern Bat',
    hpSpec: '2d3+1',
    sanity: 6,
    moveUnits: 6,
    stats: { strength: 2, dex: 6, int: 2 },
    statGrowth: { strength: 4, dex: 2, int: 6 },
    melee: { spec: '1d4', type: 'pierce', damageClass: 'physical' },
    airborne: true,
    bodyRadius: 16,
    tint: 0x7f7898,
    scale: 0.7,
    unlock: 2,
    cost: 3,
  },
  'red-dragonborn': {
    kind: 'red-dragonborn',
    name: 'Red Dragonborn',
    hpSpec: '4d8+12',
    sanity: 12,
    moveUnits: 7,
    stats: { strength: 7, dex: 5, int: 3 },
    statGrowth: { strength: 2, dex: 3, int: 4 },
    resistTypes: [...FIRE_RESIST, ...SCALE_RESIST],
    weakTypes: [...FIRE_WEAK, ...SCALE_WEAK],
    bodyRadius: 30,
    tint: 0xc94335,
    scale: 1.18,
    unlock: 6,
    cost: 10,
  },
  'black-dragonborn': {
    kind: 'black-dragonborn',
    name: 'Black Dragonborn',
    hpSpec: '4d8+12',
    sanity: 12,
    moveUnits: 7,
    stats: { strength: 7, dex: 5, int: 3 },
    statGrowth: { strength: 2, dex: 3, int: 4 },
    resistTypes: [...FIRE_RESIST, ...SCALE_RESIST],
    weakTypes: [...FIRE_WEAK, ...SCALE_WEAK],
    bodyRadius: 30,
    tint: 0x34303d,
    scale: 1.18,
    unlock: 7,
    cost: 10,
  },
};

const SENTINEL_PROFILES: Record<SentinelRole, Partial<MineEnemyDef>> = {
  tank: {
    hpSpec: '3d6+12',
    sanity: 8,
    moveUnits: 4,
    stats: { strength: 6, dex: 2, int: 2 },
    statGrowth: { strength: 2, dex: 6, int: 4 },
    melee: { spec: '1d6', type: 'shatter', damageClass: 'physical' },
    bodyRadius: 32,
  },
  healer: {
    hpSpec: '2d6+8',
    sanity: 10,
    moveUnits: 5,
    stats: { strength: 2, dex: 3, int: 6 },
    statGrowth: { strength: 6, dex: 4, int: 2 },
    melee: { spec: '1d4', type: 'fire', damageClass: 'physical' },
  },
  dps: {
    hpSpec: '2d6+6',
    sanity: 7,
    moveUnits: 6,
    stats: { strength: 2, dex: 5, int: 5 },
    statGrowth: { strength: 6, dex: 3, int: 2 },
    melee: { spec: '1d4', type: 'fire', damageClass: 'physical' },
  },
};

const ALL_KINDS = Object.keys(MINE_ENEMY_DEFS) as MineEnemyKind[];
const MAX_PER_WAVE = 12;

export function mineEnemyLevel(wave: number): number {
  return 1 + Math.floor((Math.max(1, wave) - 1) / 2);
}

export function mineAbilityPower(level: number): number {
  return Math.floor((Math.max(1, level) - 1) / 3);
}

function statAtLevel(base: number, growthEvery: number, level: number, rng: Dice): number {
  const growth = growthEvery > 0 ? Math.floor((level - 1) / growthEvery) : 0;
  const jitter = rng.pick([-1, 0, 0, 1] as const);
  return Math.max(0, base + growth + jitter);
}

function shuffledRoles(rng: Dice): SentinelRole[] {
  const roles: SentinelRole[] = ['tank', 'healer', 'dps'];
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(rng.float() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }
  return roles;
}

/** Fill a Mine wave from the Swamprun budget while keeping Sentinel roles balanced. */
export function mineWaveComposition(wave: number, rng: Dice, partySize = 1): MineSpawnSpec[] {
  const level = mineEnemyLevel(wave);
  const extraMembers = Math.max(0, Math.floor(partySize) - 1);
  const spawnCap = MAX_PER_WAVE + extraMembers * 4;
  let budget = Math.round((3 + Math.max(1, wave) * 2) * swamprunPartyScale(partySize));
  const out: MineSpawnSpec[] = [];
  const roleOrder = shuffledRoles(rng);
  const roleCounts: Record<SentinelRole, number> = { tank: 0, healer: 0, dps: 0 };

  const nextRole = (): SentinelRole => {
    const minimum = Math.min(...Object.values(roleCounts));
    const role = roleOrder.find((candidate) => roleCounts[candidate] === minimum) ?? 'tank';
    roleCounts[role] += 1;
    return role;
  };

  while (out.length < spawnCap) {
    const room = spawnCap - out.length;
    const affordable = ALL_KINDS.filter((kind) => {
      const def = MINE_ENEMY_DEFS[kind];
      return wave >= def.unlock && def.cost <= budget && (def.packSize ?? 1) <= room;
    });
    if (affordable.length === 0) break;
    const weights = affordable.map((kind) => MINE_ENEMY_DEFS[kind].cost * (1 + wave / 6));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let roll = rng.float() * total;
    let chosen = affordable[0];
    for (let i = 0; i < affordable.length; i++) {
      roll -= weights[i];
      if (roll <= 0) {
        chosen = affordable[i];
        break;
      }
    }
    const def = MINE_ENEMY_DEFS[chosen];
    for (let i = 0; i < (def.packSize ?? 1); i++) {
      const sentinel = chosen === 'sentinel' || chosen === 'magma-sentinel';
      out.push({ kind: chosen, level, role: sentinel ? nextRole() : undefined });
    }
    budget -= def.cost;
  }

  if (out.length === 0) out.push({ kind: 'kobold', level });
  return out;
}

function resolvedDef(spawn: MineSpawnSpec): MineEnemyDef {
  const base = MINE_ENEMY_DEFS[spawn.kind];
  if ((spawn.kind !== 'sentinel' && spawn.kind !== 'magma-sentinel') || !spawn.role) return base;
  return { ...base, ...SENTINEL_PROFILES[spawn.role], kind: base.kind, name: base.name } as MineEnemyDef;
}

/** Configure a fresh team-2 Mage as one deterministic, level-scaled Mine creature. */
export function applyMineEnemyTraits(mage: Mage, spawn: MineSpawnSpec, rng: Dice): void {
  const def = resolvedDef(spawn);
  const power = mineAbilityPower(spawn.level);
  const magma = spawn.kind === 'magma-sentinel';
  const hpMultiplier = (1 + 0.12 * (spawn.level - 1)) * (magma ? 1.5 : 1);
  const roleSuffix = spawn.role ? ` ${spawn.role[0].toUpperCase()}${spawn.role.slice(1)}` : '';

  mage.enemyKind = spawn.kind;
  mage.name = `${def.name}${roleSuffix}`;
  mage.maxHp = Math.max(1, Math.round(rng.roll(def.hpSpec).total * hpMultiplier));
  mage.hp = mage.maxHp;
  mage.maxSanity = Math.max(
    1,
    Math.round(def.sanity * (1 + 0.05 * (spawn.level - 1))) + rng.pick([-1, 0, 0, 1] as const)
  );
  mage.sanity = mage.maxSanity;
  mage.statStrength = statAtLevel(def.stats.strength, def.statGrowth.strength, spawn.level, rng);
  mage.statDex = statAtLevel(def.stats.dex, def.statGrowth.dex, spawn.level, rng);
  mage.statInt = statAtLevel(def.stats.int, def.statGrowth.int, spawn.level, rng);
  if (magma) {
    mage.statStrength += 2;
    mage.statDex += 2;
    mage.statInt += 2;
  }
  mage.statsAssigned = true;
  const moveGrowth = spawn.kind === 'golem' ? 0 : (spawn.level >= 6 ? 1 : 0) + (spawn.level >= 12 ? 1 : 0);
  mage.intrinsicMoveUnits = def.moveUnits + moveGrowth;
  mage.intrinsicMelee = def.melee
    ? {
        spec: power > 0 ? `${def.melee.spec}+${power}` : def.melee.spec,
        type: def.melee.type,
        damageClass: def.melee.damageClass,
        onHit: magma
          ? (ctx, target) => ctx.game.applySentinelFireStacks(target, 1, ctx.caster)
          : undefined,
      }
    : undefined;
  mage.intrinsicMeleeReach = def.melee?.reach;
  mage.intrinsicImmuneTypes = [...(def.immuneTypes ?? [])];
  mage.intrinsicResistTypes = [...(def.resistTypes ?? [])];
  mage.intrinsicWeakTypes = [...(def.weakTypes ?? [])];
  mage.intrinsicBodyRadius = def.bodyRadius;
  mage.intrinsicAirborne = !!def.airborne;
  mage.intrinsicInitiativePriority = def.initiativePriority ?? 0;
  mage.cannotAttack = !!def.cannotAttack;
  mage.mine = {
    kind: spawn.kind,
    level: spawn.level,
    role: spawn.role,
    cooldowns: {},
    golemState: spawn.kind === 'golem' ? 'dormant' : undefined,
    stones: spawn.kind === 'earth-elemental' ? rng.die(10) : undefined,
    stonesRound: spawn.kind === 'earth-elemental' ? 1 : undefined,
    charges: spawn.kind === 'elite-kobold' ? 7 : undefined,
  };
  if (spawn.kind === 'golem') mage.cannotAttack = true;
}

export function isMineEnemyKind(value: string | undefined): value is MineEnemyKind {
  return value != null && Object.prototype.hasOwnProperty.call(MINE_ENEMY_DEFS, value);
}

export function mineEnemyVisual(mage: Mage): { tint: number; scale: number } {
  const kind = mage.mine?.kind;
  if (!isMineEnemyKind(kind)) return { tint: 0xffffff, scale: 1 };
  const def = MINE_ENEMY_DEFS[kind];
  const role = mage.mine?.role;
  const roleTint: Record<SentinelRole, number> = {
    tank: kind === 'magma-sentinel' ? 0xff8438 : 0xb28b62,
    healer: kind === 'magma-sentinel' ? 0xffbe4f : 0xe0c86e,
    dps: kind === 'magma-sentinel' ? 0xff3d24 : 0xd66b4d,
  };
  const dormantScale = mage.mine?.golemState === 'dormant' ? 0.72 : 1;
  const golemTint = kind === 'golem'
    ? mage.mine?.golemState === 'dormant'
      ? 0x4f504d
      : mage.mine?.golemState === 'waking'
        ? 0xc19a55
        : def.tint
    : def.tint;
  return {
    tint: role ? roleTint[role] : golemTint,
    scale: def.scale * dormantScale,
  };
}

export interface MineLootResult {
  gold: number;
  drops: string[];
}

const BASE_GOLD: Record<MineEnemyKind, number> = {
  rockling: 0.25,
  kobold: 1,
  'elite-kobold': 2,
  golem: 3,
  sentinel: 2,
  'magma-sentinel': 4.5,
  'earth-elemental': 3,
  pftlhb: 2,
  'cavern-bat': 0.5,
  'red-dragonborn': 4,
  'black-dragonborn': 4,
};

const BONUS_SALVAGE: Record<MineEnemyKind, { value: number; label: string }> = {
  rockling: { value: 0, label: 'stone chips' },
  kobold: { value: 0.5, label: 'crude trinket' },
  'elite-kobold': { value: 1, label: 'charged scale' },
  golem: { value: 2, label: 'golem core' },
  sentinel: { value: 1.5, label: 'sentinel lens' },
  'magma-sentinel': { value: 4, label: 'magma core' },
  'earth-elemental': { value: 2, label: 'elemental geode' },
  pftlhb: { value: 2, label: 'dark eye' },
  'cavern-bat': { value: 0.5, label: 'echo membrane' },
  'red-dragonborn': { value: 4, label: 'red drake scale' },
  'black-dragonborn': { value: 4, label: 'black drake scale' },
};

export function rollMineLoot(kind: MineEnemyKind, rng: Dice): MineLootResult {
  const result: MineLootResult = { gold: BASE_GOLD[kind], drops: [] };
  if (kind === 'rockling') return result;
  const chance = MINE_ENEMY_DEFS[kind].cost >= 10 ? 0.25 : 0.2;
  if (rng.chance(chance)) {
    const bonus = BONUS_SALVAGE[kind];
    result.gold += bonus.value;
    result.drops.push(bonus.label);
  }
  return result;
}

/** Seeded creature equipment; returned items are equipped directly and never drop. */
export function rollMineEnemyWeapon(kind: MineEnemyKind, level: number, rng: Dice): ItemId | null {
  if (kind === 'kobold' || kind === 'elite-kobold') {
    if (!rng.chance(0.5)) return null;
    if (level >= 6) return 'ironSpear';
    if (level >= 3) return 'stoneSpear';
    return 'crudeSpear';
  }
  if (kind !== 'red-dragonborn' && kind !== 'black-dragonborn') return null;
  if (!rng.chance(0.6)) return null;
  const eligible: ItemId[] = ['primitiveClub'];
  if (level >= 3) eligible.push('stoneAxe');
  if (level >= 6) eligible.push('ironAxe');
  return rng.pick(eligible);
}