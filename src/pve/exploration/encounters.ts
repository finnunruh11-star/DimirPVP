// Who waits on the road. Each zone has its own roster so a region reads as a
// place: bandits and vermin near the Capitol, the drowned dead in the black
// country, fire and scale in the red. Pure and seeded: no Phaser, no Math.random.

import type { Dice } from '../../core/Dice';
import { ENEMY_DEFS, type EnemyKind } from '../swamprun';
import { MINE_ENEMY_DEFS, mineEnemyLevel, type MineEnemyKind, type MineSpawnSpec } from '../minerun';

export type EncounterZone = 'capitol' | 'black' | 'red' | 'forest' | 'wilds' | 'lake' | 'white';
export type EncounterKind = 'robbery' | 'monsters';

export type EncounterSpawn =
  | { family: 'swamp'; kind: EnemyKind }
  | { family: 'mine'; spec: MineSpawnSpec };

interface PoolEntry {
  family: 'swamp' | 'mine';
  kind: EnemyKind | MineEnemyKind;
  /** First depth at which this creature may appear. */
  unlock: number;
}

const swamp = (kind: EnemyKind, unlock: number): PoolEntry => ({ family: 'swamp', kind, unlock });
const mine = (kind: MineEnemyKind, unlock: number): PoolEntry => ({ family: 'mine', kind, unlock });

interface ZoneRoster {
  monsters: PoolEntry[];
  robbery: PoolEntry[];
  /** Added on top of the budget every fifth depth. */
  elites: PoolEntry[];
}

const BANDITS: PoolEntry[] = [mine('bandit', 1), mine('bandit-archer', 2), mine('bandit-captain', 3)];

export const ZONE_ROSTERS: Record<EncounterZone, ZoneRoster> = {
  capitol: {
    monsters: [mine('kobold', 1), mine('cavern-bat', 1), mine('rockling', 2), mine('elite-kobold', 4)],
    robbery: BANDITS,
    elites: [mine('bandit-captain', 1)],
  },
  black: {
    monsters: [swamp('zombie', 1), swamp('wisp', 2), swamp('acidZombie', 2), swamp('skeleton', 3), swamp('specter', 5)],
    robbery: [mine('bandit', 1), mine('bandit-archer', 1), mine('bandit-captain', 3)],
    elites: [swamp('skeleton', 1), swamp('ghast', 8)],
  },
  red: {
    monsters: [
      mine('kobold', 1),
      mine('rockling', 1),
      mine('sentinel', 2),
      mine('elite-kobold', 3),
      mine('earth-elemental', 5),
      mine('magma-sentinel', 6),
      mine('red-dragonborn', 7),
    ],
    robbery: [...BANDITS, mine('elite-kobold', 4)],
    elites: [mine('sentinel', 1), mine('red-dragonborn', 6)],
  },
  forest: {
    monsters: [
      swamp('zombie', 1),
      mine('cavern-bat', 1),
      mine('kobold', 2),
      swamp('wisp', 3),
      swamp('acidZombie', 3),
      swamp('skeleton', 6),
    ],
    robbery: BANDITS,
    elites: [swamp('skeleton', 1), mine('elite-kobold', 5), swamp('ghast', 15)],
  },
  wilds: {
    monsters: [
      mine('sentinel', 1),
      mine('kobold', 1),
      mine('rockling', 1),
      mine('elite-kobold', 2),
      mine('earth-elemental', 3),
      mine('magma-sentinel', 4),
      mine('red-dragonborn', 5),
      mine('black-dragonborn', 6),
    ],
    robbery: [...BANDITS, mine('elite-kobold', 3)],
    elites: [mine('magma-sentinel', 1), mine('black-dragonborn', 5)],
  },
  lake: {
    monsters: [
      swamp('wisp', 1),
      mine('cavern-bat', 1),
      swamp('zombie', 2),
      mine('kobold', 2),
      swamp('acidZombie', 4),
      swamp('skeleton', 5),
    ],
    robbery: [mine('bandit', 1), mine('bandit-archer', 1), mine('bandit-captain', 3)],
    elites: [mine('bandit-captain', 1), swamp('specter', 6)],
  },
  white: {
    monsters: [
      mine('sand-stalker', 1),
      swamp('skeleton', 1),
      mine('rockling', 2),
      mine('earth-elemental', 4),
      swamp('specter', 5),
      mine('sandworm', 7),
    ],
    robbery: [mine('bandit', 1), mine('bandit-archer', 1), mine('bandit-captain', 2)],
    elites: [mine('bandit-captain', 1), mine('sandworm', 6)],
  },
};

function entryCost(entry: PoolEntry): number {
  if (entry.family === 'swamp') return ENEMY_DEFS[entry.kind as EnemyKind].power;
  const def = MINE_ENEMY_DEFS[entry.kind as MineEnemyKind];
  // A pack costs half its members' sum: they are fragile individually.
  return def.packSize ? Math.ceil((def.cost * def.packSize) / 2) : def.cost;
}

function entrySize(entry: PoolEntry): number {
  return entry.family === 'mine' ? MINE_ENEMY_DEFS[entry.kind as MineEnemyKind].packSize ?? 1 : 1;
}

/** Enemy power bought per fight. Gentle: a depth-1 road fields one weak creature or two. */
export function encounterBudget(depth: number): number {
  return Math.round(3 + Math.max(1, depth) * 1.5);
}

/** Most bodies a fight may field (packs such as Rocklings count in full). */
export function encounterCap(depth: number): number {
  return Math.min(4, 1 + Math.floor(Math.max(1, depth) / 2)) + (depth >= 3 ? 1 : 0);
}

function toSpawn(entry: PoolEntry, depth: number): EncounterSpawn {
  if (entry.family === 'swamp') return { family: 'swamp', kind: entry.kind as EnemyKind };
  return { family: 'mine', spec: { kind: entry.kind as MineEnemyKind, level: mineEnemyLevel(depth) } };
}

/** Roll one encounter for a zone. Always returns at least one creature. */
export function rollEncounter(
  zone: EncounterZone,
  kind: EncounterKind,
  depth: number,
  rng: Dice,
): EncounterSpawn[] {
  const roster = ZONE_ROSTERS[zone];
  const pool = kind === 'robbery' ? roster.robbery : roster.monsters;
  const cap = encounterCap(depth);
  let budget = encounterBudget(depth);
  const out: EncounterSpawn[] = [];

  while (out.length < cap) {
    const room = cap - out.length;
    const affordable = pool.filter(
      (entry) => depth >= entry.unlock && entryCost(entry) <= budget && entrySize(entry) <= room,
    );
    if (affordable.length === 0) break;
    const weights = affordable.map((entry) => 1 + entryCost(entry) * 0.25);
    let roll = rng.float() * weights.reduce((sum, w) => sum + w, 0);
    let chosen = affordable[0];
    for (let i = 0; i < affordable.length; i++) {
      roll -= weights[i];
      if (roll <= 0) {
        chosen = affordable[i];
        break;
      }
    }
    for (let i = 0; i < entrySize(chosen); i++) out.push(toSpawn(chosen, depth));
    budget -= entryCost(chosen);
  }

  if (out.length === 0) {
    const cheapest = [...pool].filter((e) => depth >= e.unlock).sort((a, b) => entryCost(a) - entryCost(b))[0] ?? pool[0];
    out.push(toSpawn(cheapest, depth));
  }

  if (depth % 5 === 0 && kind === 'monsters') {
    const elite = [...roster.elites].reverse().find((entry) => depth >= entry.unlock);
    if (elite) out.push(toSpawn(elite, depth));
  }
  return out;
}

/** The family id a bounty counts: the creature's kind with any role stripped. */
export function spawnKindId(spawn: EncounterSpawn): string {
  return spawn.family === 'swamp' ? spawn.kind : spawn.spec.kind;
}

export function creatureName(kind: string): string {
  if (kind in ENEMY_DEFS) return ENEMY_DEFS[kind as EnemyKind].name;
  if (kind in MINE_ENEMY_DEFS) return MINE_ENEMY_DEFS[kind as MineEnemyKind].name;
  return kind;
}
