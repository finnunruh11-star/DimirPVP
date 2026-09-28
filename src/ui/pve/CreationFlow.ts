// The prompts of setting out: a class, two words from three, a modifier and a
// weapon. They only ask; applying the picks is `applyCreation`'s job.

import { MAGE_CLASS_DEFS, MAGE_CLASSES, type MageClass } from '../../core/Classes';
import { getItem, type ItemId } from '../../core/Items';
import { MODIFIER_WORDS, WORDS, type WordId } from '../../core/Words';
import {
  CREATION_WORD_ROUNDS,
  creationWordOffers,
  STARTER_WEAPONS,
  type CreationPick,
} from '../../pve/exploration/creation';
import type { ExplorationRun } from '../../pve/exploration/run';

export type Chooser = <T extends string>(
  title: string,
  subtitle: string,
  options: { id: T; label: string; detail: string; enabled?: boolean }[],
) => Promise<T>;

/** Claim a class; the ones already taken show but cannot be picked. */
export function chooseClass(choose: Chooser, taken: readonly MageClass[], who = ''): Promise<MageClass> {
  return choose<MageClass>(`${who}CHOOSE A CLASS`.toUpperCase(), 'Each class travels once in a party.',
    MAGE_CLASSES.map((mageClass) => ({
      id: mageClass,
      label: MAGE_CLASS_DEFS[mageClass].label,
      detail: taken.includes(mageClass) ? 'Already taken.' : MAGE_CLASS_DEFS[mageClass].blurb,
      enabled: !taken.includes(mageClass),
    })));
}

/** Two words, a modifier and a weapon for a traveller of `mageClass`. */
export async function chooseKit(choose: Chooser, run: ExplorationRun, mageClass: MageClass, who = ''): Promise<Omit<CreationPick, 'mageClass'>> {
  const words: WordId[] = [];
  for (let round = 0; round < CREATION_WORD_ROUNDS; round++) {
    const offers = creationWordOffers(run, mageClass, round, words);
    words.push(await choose<WordId>(`${who}CHOOSE A WORD (${round + 1}/${CREATION_WORD_ROUNDS})`.toUpperCase(),
      round === 0 ? 'The first word you know.' : 'Your second word.',
      offers.map((word) => ({ id: word, label: WORDS[word].label, detail: WORDS[word].blurb }))));
  }
  const modifier = await choose<WordId>(`${who}CHOOSE A MODIFIER`.toUpperCase(), 'It shapes how you cast.',
    MODIFIER_WORDS.map((word) => ({ id: word, label: WORDS[word].label, detail: WORDS[word].blurb })));
  const weapon = await choose<ItemId>(`${who}CHOOSE A WEAPON`.toUpperCase(), 'Every traveller leaves Kerusai armed.',
    STARTER_WEAPONS.map(({ id, extra }) => {
      const def = getItem(id);
      return { id, label: def.name, detail: `${def.blurb}${extra ? ` Comes with ${extra}.` : ''}` };
    }));
  return { words, modifier, weapon };
}
