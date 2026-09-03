// The party between fights. A roster is stored as a one-scene Scenario, which
// already knows how to carry vitals, gear, charges and statuses through JSON —
// and, importantly, how to parse that JSON back in as hostile input.

import { Dice } from '../../core/Dice';
import type { Mage } from '../../core/Mage';
import { captureScenario, scenarioToMages, type Scenario } from '../../core/Scenario';

/** Freeze the party as it stands, ready to be stored or handed to a fight. */
export function capturePartySnapshot(mages: readonly Mage[]): Scenario {
  const roster = [...mages];
  return captureScenario(
    {
      mages: roster,
      scarabs: [],
      initiativeOrder: roster.map((_, index) => index),
      initiativeRolls: roster.map(() => 0),
      currentIndex: 0,
      round: 1,
      turnSeq: 0,
    },
    'party',
  );
}

/** Rebuild the party from a snapshot. */
export function restoreParty(snapshot: Scenario, rng: Dice = new Dice()): Mage[] {
  return scenarioToMages(snapshot, rng);
}
