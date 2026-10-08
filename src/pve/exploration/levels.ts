// A member's rewards for one level, as data: the stats trained, the word learned
// (and the one it replaced), and the colour order on a tie. The windows collect
// a choice; `applyLevelChoice` checks it against the run and applies it, so a
// choice made on another machine goes through the same checks. Pure: no Phaser.

import { MAGE_CLASSES, type MageClass } from '../../core/Classes';
import { WORD_COLOR, type ColorName } from '../../core/Colors';
import { Dice } from '../../core/Dice';
import type { Mage } from '../../core/Mage';
import { STAT_ORDER, type StatKey } from '../../core/Stats';
import { isModifierWord, WORD_ORDER, WORDS, type WordId } from '../../core/Words';
import { levelCoreStatGain, levelReward, rackIsFull } from '../progression';
import { levelTaken, memberOf, takeLevel } from './coop';
import { hashString, withParty, type ShopResult } from './economy';
import type { ExplorationRun } from './run';

export interface LevelChoice {
  level: number;
  stats: StatKey[];
  word?: WordId;
  ascend?: WordId;
  /** Loadout index the new word takes when the rack is full. */
  replace?: number;
  primary?: ColorName | null;
  secondary?: ColorName | null;
}

/** God words available to a three-word mage with only one colored identity. */
export function godWordChoices(loadout: readonly WordId[]): WordId[] {
  const base = loadout.filter((word) => !isModifierWord(word));
  if (base.length !== 3) return [];
  const colors = new Set(base.map((word) => WORD_COLOR[word]).filter((color) => color !== 'none'));
  if (colors.size !== 1) return [];
  const color = [...colors][0];
  if (color !== 'blue' && color !== 'black') return [];
  const gods: WordId[] = color === 'blue' ? ['reality', 'stop'] : ['desecrate', 'death'];
  return gods.filter((word) => !loadout.includes(word));
}

/** The three words `member` is offered at `level`, never one it knows. */
export function levelWordOffers(run: ExplorationRun, member: MageClass, level: number, loadout: readonly WordId[]): WordId[] {
  const dice = new Dice((hashString(`level-word:${member}:${level}`) ^ Math.imul(run.seed, 0x9e3779b1)) >>> 0);
  const pool = WORD_ORDER.filter((word) => !loadout.includes(word));
  const offers: WordId[] = [];
  while (pool.length > 0 && offers.length < 3) {
    const word = dice.pick(pool);
    offers.push(word);
    pool.splice(pool.indexOf(word), 1);
  }
  return offers;
}

/** The loadout once `word` is learned: added, or put in the place of `replace` on a full rack. */
export function learnedLoadout(loadout: readonly WordId[], word: WordId, replace?: number): WordId[] | null {
  if (!rackIsFull(loadout)) return [...loadout, word];
  if (replace == null || replace < 0 || replace >= loadout.length || isModifierWord(loadout[replace])) return null;
  const next = [...loadout];
  next[replace] = word;
  return next;
}

export interface ColorTies {
  /** Colours tied for first; one entry means no choice. Empty when fewer than two colours. */
  primary: ColorName[];
  /** Colours tied for second once `primary` is settled. */
  secondary: (primary: ColorName) => ColorName[];
}

export function colorTies(loadout: readonly WordId[]): ColorTies {
  const counts: Record<ColorName, number> = { black: 0, blue: 0, white: 0, red: 0 };
  for (const word of loadout) {
    const color = WORD_COLOR[word];
    if (color !== 'none') counts[color] += 1;
  }
  const present = (Object.keys(counts) as ColorName[]).filter((color) => counts[color] > 0);
  if (present.length < 2) return { primary: [], secondary: () => [] };
  const top = Math.max(...present.map((color) => counts[color]));
  return {
    primary: present.filter((color) => counts[color] === top),
    secondary: (primary) => {
      const rest = present.filter((color) => color !== primary);
      const second = Math.max(...rest.map((color) => counts[color]));
      return rest.filter((color) => counts[color] === second);
    },
  };
}

/** Apply a colour order to `mage`, falling back to the first tied colour where a choice is missing or invalid. */
export function settleColors(mage: Mage, primary?: ColorName | null, secondary?: ColorName | null): void {
  const ties = colorTies(mage.loadout);
  if (ties.primary.length === 0) {
    mage.setLoadout(mage.loadout, null, null);
    return;
  }
  const first = primary && ties.primary.includes(primary) ? primary : ties.primary[0];
  const seconds = ties.secondary(first);
  const second = secondary && seconds.includes(secondary) ? secondary : seconds[0];
  mage.setLoadout(mage.loadout, first, second);
}

/** Check and apply `member`'s rewards for the next level it owes. */
export function applyLevelChoice(run: ExplorationRun, member: MageClass, choice: LevelChoice): ShopResult {
  const level = levelTaken(run, member) + 1;
  if (choice.level !== level || level > run.level) return { ok: false, message: 'No level to claim.' };
  const reward = levelReward(level);
  const stats = [...new Set(choice.stats)];
  if (stats.length !== choice.stats.length || stats.length !== reward.stats) return { ok: false, message: `Choose ${reward.stats} stat${reward.stats === 1 ? '' : 's'}.` };
  return withParty(run, (_leader, party) => {
    const mage = memberOf(party, member);
    if (!mage) return { ok: false, message: 'No such party member.' };
    let loadout = [...mage.loadout];
    if (reward.word && choice.ascend && !choice.word) {
      if (!godWordChoices(loadout).includes(choice.ascend)) return { ok: false, message: 'That god word is not available.' };
      if (choice.replace == null || !Number.isInteger(choice.replace) || choice.replace < 0
        || choice.replace >= loadout.length || isModifierWord(loadout[choice.replace])) {
        return { ok: false, message: 'Choose a known word to replace.' };
      }
      loadout[choice.replace] = choice.ascend;
    } else if (reward.word && choice.word && !choice.ascend) {
      if (!levelWordOffers(run, member, level, loadout).includes(choice.word)) return { ok: false, message: 'That word was not offered.' };
      const next = learnedLoadout(loadout, choice.word, choice.replace);
      if (!next) return { ok: false, message: 'Choose a word to replace.' };
      loadout = next;
    } else if (choice.word || choice.ascend) {
      return { ok: false, message: 'No word at this level.' };
    }
    const coreGain = levelCoreStatGain(level);
    for (const stat of ['strength', 'dex', 'int'] as const) mage.gainStat(stat, coreGain);
    mage.gainStat('mana', 1);
    mage.gainStat('hp', 1);
    for (const stat of stats) mage.gainStat(stat, reward.statGain);
    mage.setLoadout(loadout);
    settleColors(mage, choice.primary, choice.secondary);
    takeLevel(run, member, level);
    return { ok: true, message: `${mage.name} reaches level ${level}.` };
  });
}

const COLORS: readonly ColorName[] = ['black', 'blue', 'white', 'red'];

/** Read a level choice that came over the wire. Anything malformed is null. */
export function parseLevelChoice(value: unknown): LevelChoice | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const level = typeof raw.level === 'number' && Number.isInteger(raw.level) && raw.level >= 2 && raw.level <= 99 ? raw.level : null;
  const stats = Array.isArray(raw.stats) && raw.stats.length <= STAT_ORDER.length
    ? raw.stats.filter((stat): stat is StatKey => STAT_ORDER.includes(stat as StatKey))
    : null;
  if (level == null || !stats || stats.length !== (raw.stats as unknown[]).length) return null;
  const word = typeof raw.word === 'string' && Object.prototype.hasOwnProperty.call(WORDS, raw.word) ? raw.word as WordId : undefined;
  if (raw.word != null && !word) return null;
  const ascend = typeof raw.ascend === 'string' && Object.prototype.hasOwnProperty.call(WORDS, raw.ascend) ? raw.ascend as WordId : undefined;
  if (raw.ascend != null && !ascend) return null;
  const replace = typeof raw.replace === 'number' && Number.isInteger(raw.replace) ? raw.replace : undefined;
  const color = (entry: unknown): ColorName | null => COLORS.includes(entry as ColorName) ? entry as ColorName : null;
  return { level, stats, word, ascend, replace, primary: color(raw.primary), secondary: color(raw.secondary) };
}

export const isMageClass = (value: unknown): value is MageClass => MAGE_CLASSES.includes(value as MageClass);
