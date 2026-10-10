// The old dungeons, open to an Exploration run. Each is a dive the party makes
// from its gate and walks back out of, with no rest and no shop until it is
// out. The Swamps and the Small Forest are waves, one depth after another; the
// Mines are the Mine Run's maze. Pure: no Phaser.

import type { ExplorationCombat } from '../../config/MatchConfig';
import type { EncounterZone } from './encounters';
import type { ExplorationRun, LocaleState } from './run';
import type { DungeonId } from './world';

export interface DungeonDef {
  id: DungeonId;
  name: string;
  /** The arena its fights are drawn in. */
  zone: EncounterZone;
  /** What the gate says before the party commits. */
  warning: string;
}

export const DUNGEONS: Record<DungeonId, DungeonDef> = {
  swamps: {
    id: 'swamps',
    name: 'The Swamps',
    zone: 'black',
    warning: 'Undead get stronger with depth. No rest or shop inside.',
  },
  forest: {
    id: 'forest',
    name: 'The Small Forest',
    zone: 'forest',
    warning: 'Beasts get stronger with depth. No rest or shop inside.',
  },
  mines: {
    id: 'mines',
    name: 'The Mines',
    zone: 'red',
    warning: 'Tunnels with ore and chests. No shops inside: bring pickaxes. The only exit is the entrance.',
  },
};

/** Chance that each cleared depth must be fought again on the way out. */
export const DUNGEON_REFIGHT = 0.05;

/** The fight that starts a dive. `back` is where the party comes out; without it, it stays on the travel map. */
export function dungeonCombat(run: ExplorationRun, dungeon: DungeonId, back?: LocaleState): ExplorationCombat {
  const def = DUNGEONS[dungeon];
  return {
    run,
    encounter: 'monsters',
    depth: 1,
    cameFrom: null,
    zone: def.zone,
    dungeon,
    returnTo: back,
    fleeTo: back,
    label: `${def.name}, depth 1.`,
  };
}
