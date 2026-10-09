// Level progression for Exploration. Pure: no Phaser, no RNG.

import { isModifierWord, type WordId } from '../core/Words';
import type { MineEnemyKind } from './minerun';
import type { EnemyKind } from './swamprun';

/** XP for felling each creature, a zombie being 1. A bloodmoon boss and what it brings give none: its fall is a level. */
export const KILL_XP: Record<EnemyKind | MineEnemyKind, number> = {
  zombie: 1,
  slime: 1,
  'slime-red': 1,
  'slime-blue': 1,
  'slime-black': 1,
  'slime-white': 1,
  rabbit: 1,
  crab: 1,
  'marsh-toad': 3,
  faeri: 5,
  crocodile: 8,
  siren: 8,
  'spellcaster-spirit': 10,
  'water-spirit': 8,
  'small-spider': 1,
  'huge-spider': 10,
  'gigantuan-spider': 20,
  'spider-egg': 0,
  hydra: 15,
  thornback: 8,
  rockling: 1,
  'cavern-bat': 2,
  pftlhb: 2,
  wisp: 2,
  skeleton: 3,
  kobold: 3,
  wolf: 3,
  acidZombie: 3,
  goblinRaider: 5,
  goblinShaman: 5,
  specter: 5,
  'elite-kobold': 5,
  boar: 5,
  lioness: 8,
  'sand-stalker': 5,
  bandit: 8,
  'bandit-archer': 8,
  lion: 8,
  sentinel: 8,
  'bandit-captain': 10,
  'earth-elemental': 10,
  golem: 10,
  ghast: 10,
  soldierDemon: 10,
  beastDemon: 10,
  'red-dragonborn': 10,
  'black-dragonborn': 10,
  defender: 10,
  'magma-sentinel': 10,
  oni: 15,
  sandworm: 15,
  lich: 20,
  reaper: 33,
  deathknightSpear: 66,
  goblinChief: 0,
  baral: 0,
  baralDrake: 0,
  denialArtifact: 0,
  lillith: 0,
  lillithCopy: 0,
  lillithOrb: 0,
};

export function killXp(kind: string | undefined): number {
  return kind && kind in KILL_XP ? KILL_XP[kind as keyof typeof KILL_XP] : 0;
}

/** A rack never holds more base words than this; later word levels replace one. */
export const MAX_BASE_WORDS = 5;

/** XP from `level` to the next; `scale` stretches the curve for a bigger party. */
export function xpToNext(level: number, scale = 1): number {
  return Math.ceil(10 * Math.pow(1.7, Math.max(1, level) - 1) * Math.max(1, scale));
}

export interface LevelReward {
  /** How many different stats are raised. */
  stats: number;
  /** How much each raised stat goes up. */
  statGain: number;
  /** Whether a new word is offered. */
  word: boolean;
}

/** What a traveller's chosen strength starts with, on top of everything else. */
export const START_STAT_BONUS = 3;

/** Even levels offer one stat; even levels and every fifth also teach a word. */
export function levelReward(level: number): LevelReward {
  return { stats: level % 2 === 0 ? 1 : 0, statGain: 1, word: level % 2 === 0 || level % 5 === 0 };
}

/** Rounded-up cumulative growth in each physical or mental stat for this level. */
export function levelCoreStatGain(level: number): number {
  return Math.ceil((level - 1) * 2 / 5) - Math.ceil((level - 2) * 2 / 5);
}

export interface LevelTrack {
  level: number;
  xp: number;
  /** Levels gained whose rewards have not been chosen yet. */
  pendingLevels: number;
}

/** Bank XP until a completed long rest. */
export function addXp(track: LevelTrack, amount: number): number {
  track.xp += Math.max(0, Math.floor(amount));
  return 0;
}

/** Claim levels after a completed long rest, carrying one-third of each level's overflow. */
export function claimXpLevels(track: LevelTrack, scale = 1): number {
  let gained = 0;
  while (track.xp >= xpToNext(track.level, scale)) {
    track.xp = Math.floor((track.xp - xpToNext(track.level, scale)) / 3);
    track.level += 1;
    track.pendingLevels += 1;
    gained += 1;
  }
  return gained;
}

export function baseWordCount(loadout: readonly WordId[]): number {
  return loadout.filter((word) => !isModifierWord(word)).length;
}

/** Whether learning a word must replace a known one. */
export function rackIsFull(loadout: readonly WordId[]): boolean {
  return baseWordCount(loadout) >= MAX_BASE_WORDS;
}
