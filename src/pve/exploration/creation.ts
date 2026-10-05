// Setting out. Each traveller first says what it reaches for when something needs
// doing (its class, never named as one), then names the first two words that
// come to mind (three offered to them alone, each time) and how they get things
// done (a modifier). Offers are seeded from the run, so the host can check a
// pick made on another machine. Weapons come after, at the Lodge (see arms.ts).
// Pure: no Phaser.

import { Dice } from '../../core/Dice';
import { MAGE_CLASSES, type MageClass } from '../../core/Classes';
import type { ItemId } from '../../core/Items';
import { STAT_ORDER, type StatKey } from '../../core/Stats';
import { MODIFIER_WORDS, WORD_ORDER, type WordId } from '../../core/Words';
import { START_STAT_BONUS } from '../progression';
import { hashString } from './economy';
import { capturePartySnapshot, restoreParty } from './party';
import type { ExplorationRun } from './run';

export const CREATION_WORD_ROUNDS = 2;
export const CREATION_OFFERS = 3;

export const STARTER_WEAPONS: readonly { id: ItemId; extra?: string }[] = [
  { id: 'travellersDagger' },
  { id: 'quarterstaff' },
  { id: 'shortsword' },
  { id: 'huntingBow', extra: '15 arrows' },
  { id: 'apprenticeWand' },
];

/** What one traveller named: what it reaches for, two words, a modifier, and the stat it is good at. */
export interface CreationPick {
  calling: MageClass;
  words: WordId[];
  modifier: WordId;
  stat: StatKey;
}

/** Nobody leaves Kerusai before every traveller has picked a weapon at the Lodge. */
export const ARMS_PENDING = 'arms:pending';

/** The words offered to `member` in word round `round` (0-based), never one it already took. */
export function creationWordOffers(
  run: ExplorationRun,
  member: MageClass,
  round: number,
  taken: readonly WordId[],
): WordId[] {
  const dice = new Dice((hashString(`create-word:${member}:${round}`) ^ Math.imul(run.seed, 0x9e3779b1)) >>> 0);
  const pool = WORD_ORDER.filter((word) => !taken.includes(word));
  const offers: WordId[] = [];
  while (pool.length > 0 && offers.length < CREATION_OFFERS) {
    const word = dice.pick(pool);
    offers.push(word);
    pool.splice(pool.indexOf(word), 1);
  }
  return offers;
}

/** Whether `pick` could have come out of the offers this run makes to `member`. */
export function validCreationPick(run: ExplorationRun, member: MageClass, pick: CreationPick): boolean {
  if (!MAGE_CLASSES.includes(member)) return false;
  if (!pick || !MAGE_CLASSES.includes(pick.calling)) return false;
  if (!Array.isArray(pick.words) || pick.words.length !== CREATION_WORD_ROUNDS) return false;
  for (let round = 0; round < CREATION_WORD_ROUNDS; round++) {
    const offers = creationWordOffers(run, member, round, pick.words.slice(0, round));
    if (!offers.includes(pick.words[round])) return false;
  }
  return MODIFIER_WORDS.includes(pick.modifier) && STAT_ORDER.includes(pick.stat);
}

/**
 * Hand every member its words and class at once (member i takes picks[i]) and
 * end the naming. Everyone sets out still unarmed.
 */
export function applyCreation(run: ExplorationRun, picks: readonly CreationPick[]): boolean {
  const party = restoreParty(run.party);
  if (picks.length !== party.length) return false;
  if (!party.every((mage, index) => validCreationPick(run, mage.mageClass, picks[index]))) return false;
  party.forEach((mage, index) => {
    const pick = picks[index];
    mage.classless = false;
    mage.calling = pick.calling;
    mage.setLoadout([...pick.words, pick.modifier], null, null);
    mage.gainStat(pick.stat, START_STAT_BONUS);
  });
  run.party = capturePartySnapshot(party);
  run.creating = false;
  if (!run.flags.includes(ARMS_PENDING)) run.flags.push(ARMS_PENDING);
  return true;
}
