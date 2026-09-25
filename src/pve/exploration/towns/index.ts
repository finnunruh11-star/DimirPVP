import type { LocaleDef } from '../../../world/locale';
import { CAPITOL } from './capitol';
import { HEARTHFIRE } from './hearthfire';
import { KERUSAI } from './kerusai';
import { NEROGRIL } from './nerogril';
import { OAKHAVEN } from './oakhaven';
import { PENNYBRUCK } from './pennybruck';
import { THASSA } from './thassa';
import { THEOCRACY } from './theocracy';

/** Every walkable town, keyed by its overworld place id. */
export const TOWNS: Readonly<Record<string, LocaleDef>> = {
  capitol: CAPITOL,
  hearthfire: HEARTHFIRE,
  kerusai: KERUSAI,
  oakhaven: OAKHAVEN,
  pennybruck: PENNYBRUCK,
  thassa: THASSA,
  nerogril: NEROGRIL,
  theocracy: THEOCRACY,
};

export function townById(id: string): LocaleDef | undefined {
  return Object.prototype.hasOwnProperty.call(TOWNS, id) ? TOWNS[id] : undefined;
}
