// Mine Run creature data, deterministic level scaling, wave composition, and
// salvage. Runtime actions live separately so this module stays Phaser-free.

import { RANGE_UNIT } from '../config/constants';
import type { DamageType } from '../core/Damage';
import type { Dice } from '../core/Dice';
import { getItem, type ItemId } from '../core/Items';
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
  | 'black-dragonborn'
  | 'bandit'
  | 'bandit-archer'
  | 'bandit-captain'
  | 'sand-stalker'
  | 'sandworm'
  | 'rabbit'
  | 'slime'
  | 'slime-red'
  | 'slime-blue'
  | 'slime-black'
  | 'slime-white'
  | 'boar'
  | 'wolf'
  | 'lion'
  | 'lioness'
  | 'crab'
  | 'faeri'
  | 'crocodile'
  | 'siren'
  | 'spellcaster-spirit'
  | 'thornback'
  | 'marsh-toad'
  | 'water-spirit'
  | 'small-spider'
  | 'huge-spider'
  | 'gigantuan-spider'
  | 'spider-egg'
  | 'hydra';

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
  /** A group of this many, rolled per encounter (wolves). */
  packRange?: readonly [number, number];
  /** Melee hits +1 harder per `per` cm run this turn before striking, up to `max`. */
  charge?: { per: number; max: number };
  /** Health and bite stay the same at every level. */
  unscaled?: boolean;
}

const FIRE_RESIST: DamageType[] = ['heat', 'light'];
const FIRE_WEAK: DamageType[] = ['shadow'];
const SCALE_RESIST: DamageType[] = ['slashing'];
const SCALE_WEAK: DamageType[] = ['pierce'];

const SLIME: Omit<MineEnemyDef, 'kind' | 'name' | 'tint'> = {
  hpSpec: '5',
  sanity: 1,
  moveUnits: 4,
  stats: { strength: 1, dex: 1, int: 0 },
  statGrowth: { strength: 0, dex: 0, int: 0 },
  melee: { spec: '1d3', type: 'corrosive' },
  bodyRadius: 14,
  scale: 0.55,
  unlock: 1,
  cost: 1,
  unscaled: true,
};

/** Slimes come in all five colours; only the colour differs. */
export const SLIME_KINDS = ['slime', 'slime-red', 'slime-blue', 'slime-black', 'slime-white'] as const;

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
    melee: { spec: '2d6', type: 'shatter', reach: 112 },
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
    melee: { spec: '1d4', type: 'heat' },
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
    melee: { spec: '1d6', type: 'heat' },
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
    melee: { spec: '3d8', type: 'shadow' },
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
    melee: { spec: '1d4', type: 'pierce' },
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
  bandit: {
    kind: 'bandit',
    name: 'Bandit',
    hpSpec: '2d4+4',
    sanity: 8,
    moveUnits: 6,
    stats: { strength: 3, dex: 4, int: 1 },
    statGrowth: { strength: 3, dex: 3, int: 0 },
    tint: 0x9a7b5c,
    scale: 0.95,
    unlock: 1,
    cost: 3,
  },
  'bandit-archer': {
    kind: 'bandit-archer',
    name: 'Bandit Archer',
    hpSpec: '2d3+3',
    sanity: 8,
    moveUnits: 5,
    stats: { strength: 1, dex: 5, int: 1 },
    statGrowth: { strength: 0, dex: 3, int: 0 },
    melee: { spec: '1d4', type: 'pierce', reach: 225 },
    tint: 0x6f8a55,
    scale: 0.92,
    unlock: 2,
    cost: 4,
  },
  'bandit-captain': {
    kind: 'bandit-captain',
    name: 'Bandit Captain',
    hpSpec: '3d6+8',
    sanity: 10,
    moveUnits: 6,
    stats: { strength: 5, dex: 4, int: 2 },
    statGrowth: { strength: 2, dex: 3, int: 0 },
    initiativePriority: 1,
    tint: 0x8c3a3a,
    scale: 1.05,
    unlock: 3,
    cost: 7,
  },
  'sand-stalker': {
    kind: 'sand-stalker',
    name: 'Sand Stalker',
    hpSpec: '2d6+5',
    sanity: 8,
    moveUnits: 9,
    stats: { strength: 3, dex: 7, int: 1 },
    statGrowth: { strength: 3, dex: 2, int: 0 },
    melee: { spec: '1d6', type: 'corrosive' },
    resistTypes: ['heat'],
    weakTypes: ['cold'],
    tint: 0xc8a66a,
    scale: 0.85,
    unlock: 1,
    cost: 4,
  },
  sandworm: {
    kind: 'sandworm',
    name: 'Sandworm',
    hpSpec: '6d10+24',
    sanity: 14,
    moveUnits: 7,
    stats: { strength: 8, dex: 2, int: 0 },
    statGrowth: { strength: 2, dex: 0, int: 0 },
    melee: { spec: '3d8', type: 'pierce', reach: 140 },
    resistTypes: ['heat', 'slashing'],
    weakTypes: ['cold', 'water'],
    bodyRadius: 58,
    tint: 0xb89160,
    scale: 1.9,
    unlock: 6,
    cost: 12,
  },
  // ---- Forest animals: all body, little mind ----
  rabbit: {
    kind: 'rabbit',
    name: 'Rabbit',
    hpSpec: '1d4+3',
    sanity: 2,
    moveUnits: 8,
    stats: { strength: 1, dex: 6, int: 0 },
    statGrowth: { strength: 6, dex: 3, int: 0 },
    melee: { spec: '1d3', type: 'pierce' },
    bodyRadius: 12,
    tint: 0xc9b08a,
    scale: 0.5,
    unlock: 1,
    cost: 2,
  },
  slime: { ...SLIME, kind: 'slime', name: 'Slime', tint: 0x6fd35a },
  'slime-red': { ...SLIME, kind: 'slime-red', name: 'Red Slime', tint: 0xd9523f },
  'slime-blue': { ...SLIME, kind: 'slime-blue', name: 'Blue Slime', tint: 0x4f8fe0 },
  'slime-black': { ...SLIME, kind: 'slime-black', name: 'Black Slime', tint: 0x4a3f55 },
  'slime-white': { ...SLIME, kind: 'slime-white', name: 'White Slime', tint: 0xeae6da },
  boar: {
    kind: 'boar',
    name: 'Boar',
    hpSpec: '3d6+12',
    sanity: 5,
    moveUnits: 12,
    stats: { strength: 6, dex: 3, int: 0 },
    statGrowth: { strength: 3, dex: 4, int: 0 },
    melee: { spec: '1d6', type: 'pierce' },
    charge: { per: 2, max: 6 },
    bodyRadius: 28,
    tint: 0x7a5238,
    scale: 0.95,
    unlock: 3,
    cost: 6,
  },
  wolf: {
    kind: 'wolf',
    name: 'Wolf',
    hpSpec: '2d6+4',
    sanity: 4,
    moveUnits: 10,
    stats: { strength: 3, dex: 6, int: 1 },
    statGrowth: { strength: 3, dex: 3, int: 0 },
    melee: { spec: '1d6', type: 'pierce' },
    bodyRadius: 18,
    tint: 0x8a8f96,
    scale: 0.75,
    unlock: 2,
    cost: 3,
    packRange: [2, 5],
  },
  // ---- Green beasts of the plains: sturdy and hard-hitting, little mind ----
  lion: {
    kind: 'lion',
    name: 'Lion',
    hpSpec: '3d6+14',
    sanity: 4,
    moveUnits: 5,
    stats: { strength: 6, dex: 4, int: 0 },
    statGrowth: { strength: 3, dex: 4, int: 0 },
    melee: { spec: '1d3+3', type: 'slashing' },
    bodyRadius: 26,
    tint: 0xc7913f,
    scale: 1,
    unlock: 3,
    cost: 8,
  },
  lioness: {
    kind: 'lioness',
    name: 'Lioness',
    hpSpec: '3d6+8',
    sanity: 3,
    moveUnits: 6,
    stats: { strength: 4, dex: 6, int: 0 },
    statGrowth: { strength: 3, dex: 3, int: 0 },
    melee: { spec: '1d3+2', type: 'slashing' },
    bodyRadius: 22,
    tint: 0xd8ad62,
    scale: 0.9,
    unlock: 2,
    cost: 6,
  },
  crab: {
    kind: 'crab',
    name: 'Crab',
    hpSpec: '1d4+2',
    sanity: 3,
    moveUnits: 2,
    stats: { strength: 1, dex: 1, int: 0 },
    statGrowth: { strength: 0, dex: 0, int: 0 },
    cannotAttack: true,
    resistTypes: ['pierce', 'slashing', 'shatter'],
    bodyRadius: 14,
    tint: 0x408fac,
    scale: 0.55,
    unlock: 1,
    cost: 2,
    unscaled: true,
  },
  faeri: {
    kind: 'faeri', name: 'Faeri', hpSpec: '2d4+3', sanity: 12, moveUnits: 5,
    stats: { strength: 0, dex: 7, int: 6 }, statGrowth: { strength: 0, dex: 3, int: 3 },
    cannotAttack: true, tint: 0x92d5ef, scale: 0.58, unlock: 3, cost: 7,
  },
  crocodile: {
    kind: 'crocodile', name: 'Crocodile', hpSpec: '4d8+16', sanity: 5, moveUnits: 5,
    stats: { strength: 7, dex: 3, int: 0 }, statGrowth: { strength: 3, dex: 5, int: 0 },
    melee: { spec: '1d6', type: 'pierce' }, bodyRadius: 36,
    tint: 0x557b69, scale: 1.3, unlock: 4, cost: 9,
  },
  siren: {
    kind: 'siren', name: 'Siren', hpSpec: '2d6+8', sanity: 14, moveUnits: 0,
    stats: { strength: 3, dex: 4, int: 8 }, statGrowth: { strength: 4, dex: 4, int: 2 },
    cannotAttack: true, tint: 0x6daac2, scale: 0.85, unlock: 5, cost: 8,
  },
  'spellcaster-spirit': {
    kind: 'spellcaster-spirit', name: 'Spellcaster Spirit', hpSpec: '2d6+6', sanity: 20, moveUnits: 5,
    stats: { strength: 0, dex: 3, int: 10 }, statGrowth: { strength: 0, dex: 4, int: 2 },
    immuneTypes: ['pierce', 'slashing', 'shatter'], cannotAttack: true,
    tint: 0x91b9f4, scale: 0.9, unlock: 6, cost: 10,
  },
  thornback: {
    kind: 'thornback', name: 'Thornback', hpSpec: '4d6+12', sanity: 4, moveUnits: 4,
    stats: { strength: 6, dex: 2, int: 0 }, statGrowth: { strength: 3, dex: 5, int: 0 },
    melee: { spec: '1d6', type: 'pierce' }, resistTypes: ['slashing'],
    bodyRadius: 29, tint: 0x54794a, scale: 1, unlock: 5, cost: 7,
  },
  'marsh-toad': {
    kind: 'marsh-toad', name: 'Marsh Toad', hpSpec: '2d6+6', sanity: 3, moveUnits: 4,
    stats: { strength: 3, dex: 3, int: 0 }, statGrowth: { strength: 4, dex: 4, int: 0 },
    melee: { spec: '1d4', type: 'pierce' }, bodyRadius: 22,
    tint: 0x77a05e, scale: 0.8, unlock: 2, cost: 4,
  },
  'water-spirit': {
    kind: 'water-spirit', name: 'Water Spirit', hpSpec: '2d6+12', sanity: 18, moveUnits: 10,
    stats: { strength: 1, dex: 7, int: 7 }, statGrowth: { strength: 0, dex: 3, int: 3 },
    immuneTypes: ['pierce', 'slashing', 'shatter'], cannotAttack: true,
    tint: 0x67bfd3, scale: 0.9, unlock: 4, cost: 9,
  },
  'small-spider': {
    kind: 'small-spider', name: 'Small Spider', hpSpec: '1d4+3', sanity: 2, moveUnits: 8,
    stats: { strength: 1, dex: 5, int: 0 }, statGrowth: { strength: 5, dex: 3, int: 0 },
    melee: { spec: '1d3', type: 'pierce' }, bodyRadius: 11,
    tint: 0x575d45, scale: 0.45, unlock: 1, cost: 2,
  },
  'huge-spider': {
    kind: 'huge-spider', name: 'Huge Spider', hpSpec: '4d8+20', sanity: 6, moveUnits: 7,
    stats: { strength: 7, dex: 5, int: 0 }, statGrowth: { strength: 3, dex: 3, int: 0 },
    melee: { spec: '1d8', type: 'pierce' }, bodyRadius: 38,
    tint: 0x393d31, scale: 1.4, unlock: 5, cost: 10,
  },
  'gigantuan-spider': {
    kind: 'gigantuan-spider', name: 'Gigantuan Spider', hpSpec: '9d10+55', sanity: 10, moveUnits: 4,
    stats: { strength: 12, dex: 4, int: 1 }, statGrowth: { strength: 2, dex: 4, int: 0 },
    melee: { spec: '2d8', type: 'pierce', reach: 130 }, bodyRadius: 68,
    resistTypes: ['pierce', 'slashing'], tint: 0x3b332c, scale: 2,
    unlock: 9, cost: 18,
  },
  'spider-egg': {
    kind: 'spider-egg', name: 'Spider Egg', hpSpec: '3', sanity: 1, moveUnits: 0,
    stats: { strength: 0, dex: 0, int: 0 }, statGrowth: { strength: 0, dex: 0, int: 0 },
    cannotAttack: true, bodyRadius: 12, tint: 0xe0dbbd, scale: 0.4,
    unlock: 99, cost: 0, unscaled: true,
  },
  hydra: {
    kind: 'hydra', name: 'Hydra', hpSpec: '8d10+48', sanity: 8, moveUnits: 4,
    stats: { strength: 10, dex: 3, int: 1 }, statGrowth: { strength: 2, dex: 5, int: 0 },
    cannotAttack: true, resistTypes: ['slashing'], weakTypes: ['heat'],
    bodyRadius: 62, tint: 0x537c53, scale: 1.8, unlock: 8, cost: 16,
  },
};

const SENTINEL_PROFILES: Record<SentinelRole, Partial<MineEnemyDef>> = {
  tank: {
    hpSpec: '3d6+12',
    sanity: 8,
    moveUnits: 4,
    stats: { strength: 6, dex: 2, int: 2 },
    statGrowth: { strength: 2, dex: 6, int: 4 },
    melee: { spec: '1d6', type: 'shatter' },
    bodyRadius: 32,
  },
  healer: {
    hpSpec: '2d6+8',
    sanity: 10,
    moveUnits: 5,
    stats: { strength: 2, dex: 3, int: 6 },
    statGrowth: { strength: 6, dex: 4, int: 2 },
    melee: { spec: '1d4', type: 'heat' },
  },
  dps: {
    hpSpec: '2d6+6',
    sanity: 7,
    moveUnits: 6,
    stats: { strength: 2, dex: 5, int: 5 },
    statGrowth: { strength: 6, dex: 3, int: 2 },
    melee: { spec: '1d4', type: 'heat' },
  },
};

/**
 * Which roster a spawn table draws from. The mines hold everything of the red
 * surface but its slimes, and the tunnel dwellers besides.
 */
export const MINE_SPAWN_KINDS: readonly MineEnemyKind[] = [
  'rockling',
  'kobold',
  'elite-kobold',
  'sentinel',
  'magma-sentinel',
  'red-dragonborn',
  'black-dragonborn',
  'golem',
  'earth-elemental',
  'pftlhb',
  'cavern-bat',
];

export const OVERWORLD_SPAWN_KINDS: readonly MineEnemyKind[] = [
  'kobold',
  'elite-kobold',
  'sentinel',
  'magma-sentinel',
  'red-dragonborn',
  'black-dragonborn',
];

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
export function mineWaveComposition(
  wave: number,
  rng: Dice,
  partySize = 1,
  pool: readonly MineEnemyKind[] = MINE_SPAWN_KINDS,
): MineSpawnSpec[] {
  const level = mineEnemyLevel(wave);
  const extraMembers = Math.max(0, Math.floor(partySize) - 1);
  const spawnCap = MAX_PER_WAVE + extraMembers * 2;
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
    const affordable = pool.filter((kind) => {
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

/** "1d3+3" plus 1 is "1d3+4": a dice spec takes one flat modifier. */
function withBonus(spec: string, bonus: number): string {
  if (bonus === 0) return spec;
  const m = /^(\d*d\d+)([+-]\d+)?$/.exec(spec);
  if (!m) return spec;
  const flat = Number(m[2] ?? 0) + bonus;
  return flat ? `${m[1]}${flat > 0 ? '+' : ''}${flat}` : m[1];
}

function resolvedDef(spawn: MineSpawnSpec): MineEnemyDef {
  const base = MINE_ENEMY_DEFS[spawn.kind];
  if ((spawn.kind !== 'sentinel' && spawn.kind !== 'magma-sentinel') || !spawn.role) return base;
  return { ...base, ...SENTINEL_PROFILES[spawn.role], kind: base.kind, name: base.name } as MineEnemyDef;
}

/** Configure a fresh team-2 Mage as one deterministic, level-scaled Mine creature. */
export function applyMineEnemyTraits(mage: Mage, spawn: MineSpawnSpec, rng: Dice): void {
  const def = resolvedDef(spawn);
  const power = def.unscaled ? 0 : mineAbilityPower(spawn.level);
  const magma = spawn.kind === 'magma-sentinel';
  const hpMultiplier = def.unscaled ? 1 : (1 + 0.12 * (spawn.level - 1)) * (magma ? 1.5 : 1);
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
        spec: withBonus(def.melee.spec, power),
        type: def.melee.type,
        onHit: magma
          ? (ctx, target) => ctx.game.applySentinelFireStacks(target, 1, ctx.caster)
          : spawn.kind === 'crocodile'
            ? (ctx, target) => {
                if (ctx.game.lastIntrinsicDamage > 0) {
                  target.crocodileGrip = mage;
                  target.fleeChannel = undefined;
                }
              }
            : spawn.kind === 'huge-spider'
              ? (ctx, target) => {
                  if (ctx.game.lastIntrinsicDamage > 0) {
                    ctx.game.addSpiderVenom(target, ctx.game.rng.roll('2d6').total, mage);
                  }
                }
            : undefined,
        chargePer: def.charge ? def.charge.per * RANGE_UNIT : undefined,
        chargeMax: def.charge?.max,
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
  if (spawn.kind === 'spider-egg') mage.inert = true;
  if (spawn.kind === 'crab') mage.intrinsicArmorFlat = 2;
  if (spawn.kind === 'thornback') mage.intrinsicArmorFlat = 2;
  if (spawn.kind === 'spellcaster-spirit') {
    mage.setLoadout(['mind', 'bind', 'water', 'stop', 'pierce', 'shatter']);
    mage.maxMana = 30;
    mage.mana = 30;
  }
  mage.mine = {
    kind: spawn.kind,
    level: spawn.level,
    role: spawn.role,
    cooldowns: {},
    golemState: spawn.kind === 'golem' ? 'dormant' : undefined,
    stones: spawn.kind === 'earth-elemental' ? rng.die(10) : undefined,
    stonesRound: spawn.kind === 'earth-elemental' ? 1 : undefined,
    charges: spawn.kind === 'elite-kobold' ? 7 : undefined,
    heads: spawn.kind === 'hydra' ? 3 : undefined,
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
  /** Salvage that must be carried home; no longer folded into `gold`. */
  materials: ItemId[];
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
  bandit: 1.5,
  'bandit-archer': 1.5,
  'bandit-captain': 4,
  'sand-stalker': 1.5,
  sandworm: 8,
  rabbit: 0.25,
  slime: 0.25,
  'slime-red': 0.25,
  'slime-blue': 0.25,
  'slime-black': 0.25,
  'slime-white': 0.25,
  boar: 1.5,
  wolf: 1,
  lion: 2,
  lioness: 1.5,
  crab: 0.25,
  faeri: 2,
  crocodile: 3,
  siren: 2,
  'spellcaster-spirit': 3,
  thornback: 2,
  'marsh-toad': 1,
  'water-spirit': 3,
  'small-spider': 0.5,
  'huge-spider': 3,
  'gigantuan-spider': 8,
  'spider-egg': 0,
  hydra: 6,
};

const BONUS_SALVAGE: Record<MineEnemyKind, ItemId | null> = {
  rockling: null,
  kobold: 'crudeTrinket',
  'elite-kobold': 'chargedScale',
  golem: 'stoneHeart',
  sentinel: 'sentinelLens',
  'magma-sentinel': 'magmaCore',
  'earth-elemental': 'redStone',
  pftlhb: 'darkEye',
  'cavern-bat': 'batLeather',
  'red-dragonborn': 'redDrakeScale',
  'black-dragonborn': 'blackDrakeScale',
  bandit: 'crudeTrinket',
  'bandit-archer': 'crudeTrinket',
  'bandit-captain': 'crudeTrinket',
  'sand-stalker': null,
  sandworm: 'gemDiamond',
  rabbit: 'rabbitPelt',
  slime: 'slimeGel',
  'slime-red': 'slimeGel',
  'slime-blue': 'slimeGel',
  'slime-black': 'slimeGel',
  'slime-white': 'slimeGel',
  boar: 'boarHide',
  wolf: 'wolfPelt',
  lion: 'lionPelt',
  lioness: 'lionPelt',
  crab: null,
  faeri: null,
  crocodile: null,
  siren: null,
  'spellcaster-spirit': null,
  thornback: null,
  'marsh-toad': null,
  'water-spirit': null,
  'small-spider': null,
  'huge-spider': null,
  'gigantuan-spider': null,
  'spider-egg': null,
  hydra: null,
};

export function rollMineLoot(kind: MineEnemyKind, rng: Dice): MineLootResult {
  const result: MineLootResult = { gold: BASE_GOLD[kind], materials: [], drops: [] };
  if (kind === 'rockling') return result;
  const chance = MINE_ENEMY_DEFS[kind].cost >= 10 ? 0.25 : 0.2;
  const salvage = BONUS_SALVAGE[kind];
  if (salvage && rng.chance(chance)) {
    result.materials.push(salvage);
    result.drops.push(getItem(salvage).name);
  }
  return result;
}

/** Seeded creature equipment; returned items are equipped directly and never drop. */
export function rollMineEnemyWeapon(kind: MineEnemyKind, level: number, rng: Dice): ItemId | null {
  if (kind === 'bandit') return rng.chance(0.7) ? rng.pick<ItemId>(['primitiveClub', 'crudeSpear']) : null;
  if (kind === 'bandit-captain') return level >= 4 ? 'ironAxe' : 'stoneAxe';
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