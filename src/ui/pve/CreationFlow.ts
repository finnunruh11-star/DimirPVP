// Setting out: the awakening asks each traveller for words (see Awakening.ts);
// applying the picks is `applyCreation`'s job.

import type { MageClass } from '../../core/Classes';
import { creationWordOffers, type CreationPick } from '../../pve/exploration/creation';
import type { ExplorationRun } from '../../pve/exploration/run';
import type { AwakeningModel } from './Awakening';

export type Chooser = <T extends string>(
  title: string,
  subtitle: string,
  options: { id: T; label: string; detail: string; enabled?: boolean }[],
) => Promise<T>;

/** Plays the awakening for one traveller and returns what it named. */
export type Awakener = (model: AwakeningModel) => Promise<CreationPick>;

/** The awakening of `member` (a hidden id; travellers have no class yet). */
export function awaken(awakener: Awakener, run: ExplorationRun, member: MageClass, reducedMotion: boolean, who?: string): Promise<CreationPick> {
  return awakener({
    who,
    reducedMotion,
    offers: (round, taken) => creationWordOffers(run, member, round, taken),
  });
}
