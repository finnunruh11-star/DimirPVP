// Level progression shared by Expedition and Exploration. Pure: no Phaser, no RNG.

import { isModifierWord, type WordId } from '../core/Words';

/** A rack never holds more base words than this; later word levels replace one. */
export const MAX_BASE_WORDS = 5;

export function xpToNext(level: number): number {
  return Math.ceil(10 * Math.pow(1.7, Math.max(1, level) - 1));
}

export interface LevelReward {
  /** How many different stats may each be raised by 1. */
  stats: number;
  /** Whether a new word is offered. */
  word: boolean;
}

/** Odd levels train a stat, even levels teach a word, every fifth does both twice over. */
export function levelReward(level: number): LevelReward {
  if (level % 5 === 0) return { stats: 2, word: true };
  if (level % 2 === 0) return { stats: 0, word: true };
  return { stats: 1, word: false };
}

export interface LevelTrack {
  level: number;
  xp: number;
  /** Levels gained whose rewards have not been chosen yet. */
  pendingLevels: number;
}

/** Add XP and roll over any levels it completes. Returns the number of levels gained. */
export function addXp(track: LevelTrack, amount: number): number {
  track.xp += Math.max(0, Math.floor(amount));
  let gained = 0;
  while (track.xp >= xpToNext(track.level)) {
    track.xp -= xpToNext(track.level);
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
