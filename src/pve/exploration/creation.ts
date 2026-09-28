// Setting out. Every traveller claims a class (one of each, taken in seat
// order), then picks two words from three offered to them alone, then a
// modifier and a weapon. Offers are seeded from the run, so the host can check
// a pick made on another machine. Pure: no Phaser.

import { Dice } from '../../core/Dice';
import { MAGE_CLASSES, type MageClass } from '../../core/Classes';
import type { ItemId } from '../../core/Items';
import { MODIFIER_WORDS, WORD_ORDER, type WordId } from '../../core/Words';
import { grantToMage, hashString } from './economy';
import { capturePartySnapshot, restoreParty } from './party';
import type { ExplorationRun } from './run';

export const CREATION_WORD_ROUNDS = 2;
export const CREATION_OFFERS = 3;

export const STARTER_WEAPONS: readonly { id: ItemId; extra?: string }[] = [
  { id: 'travellersDagger' },
  { id: 'quarterstaff' },
  { id: 'huntingBow', extra: '15 arrows' },
  { id: 'apprenticeWand' },
];

const BOW_ARROWS = 15;

export interface CreationPick {
  mageClass: MageClass;
  words: WordId[];
  modifier: WordId;
  weapon: ItemId;
}

/** Classes still free, in menu order. */
export function openClasses(taken: readonly MageClass[]): MageClass[] {
  return MAGE_CLASSES.filter((mageClass) => !taken.includes(mageClass));
}

/** The words offered to `mageClass` in word round `round` (0-based), never one it already took. */
export function creationWordOffers(
  run: ExplorationRun,
  mageClass: MageClass,
  round: number,
  taken: readonly WordId[],
): WordId[] {
  const dice = new Dice((hashString(`create-word:${mageClass}:${round}`) ^ Math.imul(run.seed, 0x9e3779b1)) >>> 0);
  const pool = WORD_ORDER.filter((word) => !taken.includes(word));
  const offers: WordId[] = [];
  while (pool.length > 0 && offers.length < CREATION_OFFERS) {
    const word = dice.pick(pool);
    offers.push(word);
    pool.splice(pool.indexOf(word), 1);
  }
  return offers;
}

/** Whether `pick` could have come out of the offers this run makes. */
export function validCreationPick(run: ExplorationRun, pick: CreationPick): boolean {
  if (!MAGE_CLASSES.includes(pick.mageClass)) return false;
  if (!Array.isArray(pick.words) || pick.words.length !== CREATION_WORD_ROUNDS) return false;
  for (let round = 0; round < CREATION_WORD_ROUNDS; round++) {
    const offers = creationWordOffers(run, pick.mageClass, round, pick.words.slice(0, round));
    if (!offers.includes(pick.words[round])) return false;
  }
  if (!MODIFIER_WORDS.includes(pick.modifier)) return false;
  return STARTER_WEAPONS.some((weapon) => weapon.id === pick.weapon);
}

/** Hand every member its pick at once (member i takes picks[i]) and end creation. */
export function applyCreation(run: ExplorationRun, picks: readonly CreationPick[]): boolean {
  const party = restoreParty(run.party);
  if (picks.length !== party.length) return false;
  if (new Set(picks.map((pick) => pick.mageClass)).size !== picks.length) return false;
  if (!picks.every((pick) => validCreationPick(run, pick))) return false;
  party.forEach((mage, index) => {
    const pick = picks[index];
    mage.mageClass = pick.mageClass;
    mage.setLoadout([...pick.words, pick.modifier], null, null);
    grantToMage(mage, pick.weapon);
    if (pick.weapon === 'huntingBow') mage.arrows += BOW_ARROWS;
  });
  run.party = capturePartySnapshot(party);
  run.creating = false;
  return true;
}
