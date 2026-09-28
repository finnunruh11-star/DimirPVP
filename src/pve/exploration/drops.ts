// What a fallen creature leaves on an Exploration field. Every row rolls on its
// own, so most fodder leaves nothing and only bosses always pay. Harder kinds
// carry better rows, and creatures met deeper in are a little more generous.
// Pure and seeded.

import type { Dice } from '../../core/Dice';
import type { ItemId } from '../../core/Items';

export interface DropRow {
  item: ItemId;
  chance: number;
  /** Up to this many extra copies when the row hits. */
  extra?: number;
}

export const DROP_TABLES: Readonly<Record<string, readonly DropRow[]>> = {
  // ---- The dead ----
  zombie: [{ item: 'manaStoneSmall', chance: 0.5 }, { item: 'manaStoneMedium', chance: 0.1 }],
  acidZombie: [{ item: 'manaStoneSmall', chance: 0.5 }, { item: 'manaStoneMedium', chance: 0.15 }],
  skeleton: [{ item: 'manaStoneSmall', chance: 0.4 }, { item: 'manaStoneMedium', chance: 0.25 }, { item: 'manaStoneBig', chance: 0.05 }],
  wisp: [{ item: 'ectoplasm', chance: 0.4 }],
  specter: [{ item: 'ectoplasm', chance: 0.6, extra: 1 }, { item: 'manaStoneMedium', chance: 0.15 }],
  defender: [{ item: 'manaStoneBig', chance: 0.6 }, { item: 'darksteelBar', chance: 0.25 }],
  ghast: [{ item: 'manaStoneBig', chance: 0.5 }, { item: 'darksteelBar', chance: 0.3 }, { item: 'ghastEssence', chance: 0.1 }],
  soldierDemon: [{ item: 'manaStoneMedium', chance: 0.5 }, { item: 'darksteelBar', chance: 0.1 }],
  beastDemon: [{ item: 'manaStoneMedium', chance: 0.5 }, { item: 'manaStoneBig', chance: 0.15 }],
  oni: [{ item: 'manaStoneBig', chance: 0.6 }, { item: 'darksteelBar', chance: 0.3 }],
  lich: [{ item: 'lichCore', chance: 1 }, { item: 'ectoplasm', chance: 1, extra: 3 }],
  reaper: [{ item: 'reaperCore', chance: 1 }, { item: 'manaStoneBig', chance: 1, extra: 1 }],
  deathknightSpear: [{ item: 'darksteelBar', chance: 1, extra: 1 }, { item: 'manaStoneBig', chance: 1 }],
  // ---- The goblin band ----
  goblinChief: [{ item: 'crudeTrinket', chance: 1, extra: 2 }, { item: 'manaStoneMedium', chance: 1 }],
  goblinRaider: [{ item: 'crudeTrinket', chance: 0.3 }],
  goblinShaman: [{ item: 'manaStoneSmall', chance: 0.45 }],
  // ---- Baral's workshop ----
  baral: [{ item: 'manaStoneBig', chance: 1, extra: 1 }, { item: 'crudeTrinket', chance: 1, extra: 2 }],
  denialArtifact: [{ item: 'sentinelLens', chance: 0.5 }],
  baralDrake: [{ item: 'crudeTrinket', chance: 0.15 }],
  // ---- Stone, scale and bandits ----
  rockling: [],
  kobold: [{ item: 'crudeTrinket', chance: 0.3 }],
  'elite-kobold': [{ item: 'chargedScale', chance: 0.4 }, { item: 'crudeTrinket', chance: 0.2 }],
  golem: [{ item: 'golemCore', chance: 0.5 }],
  sentinel: [{ item: 'sentinelLens', chance: 0.35 }],
  'magma-sentinel': [{ item: 'magmaCore', chance: 0.35 }],
  'earth-elemental': [{ item: 'elementalGeode', chance: 0.4 }],
  pftlhb: [{ item: 'darkEye', chance: 0.5 }],
  'cavern-bat': [{ item: 'echoMembrane', chance: 0.35 }],
  'red-dragonborn': [{ item: 'redDrakeScale', chance: 0.5 }],
  'black-dragonborn': [{ item: 'blackDrakeScale', chance: 0.5 }],
  bandit: [{ item: 'crudeTrinket', chance: 0.25 }],
  'bandit-archer': [{ item: 'crudeTrinket', chance: 0.3 }],
  'bandit-captain': [{ item: 'crudeTrinket', chance: 0.6 }, { item: 'manaStoneMedium', chance: 0.2 }],
  'sand-stalker': [{ item: 'manaStoneSmall', chance: 0.35 }],
  sandworm: [{ item: 'manaStoneBig', chance: 0.5 }, { item: 'gemDiamond', chance: 0.35 }],
  // ---- Beasts ----
  rabbit: [{ item: 'rabbitPelt', chance: 0.4 }],
  slime: [{ item: 'slimeGel', chance: 0.5 }],
  wolf: [{ item: 'wolfPelt', chance: 0.45 }, { item: 'wolfFang', chance: 0.1 }],
  boar: [{ item: 'boarHide', chance: 0.55 }, { item: 'boarTusk', chance: 0.25 }],
};

/** How much likelier every row is at `depth`: +2% per depth past the first, at most +50%. */
export function depthLuck(depth: number): number {
  return Math.min(1.5, 1 + Math.max(0, depth - 1) * 0.02);
}

export function dropTable(kind: string): readonly DropRow[] {
  return Object.prototype.hasOwnProperty.call(DROP_TABLES, kind) ? DROP_TABLES[kind] : [];
}

/** Roll what one fallen creature of `kind` leaves at `depth`. Usually little, often nothing. */
export function rollDrops(kind: string, depth: number, rng: Dice): ItemId[] {
  const luck = depthLuck(depth);
  const out: ItemId[] = [];
  for (const row of dropTable(kind)) {
    if (!rng.chance(Math.min(1, row.chance * luck))) continue;
    const copies = 1 + (row.extra ? rng.die(row.extra + 1) - 1 : 0);
    for (let i = 0; i < copies; i++) out.push(row.item);
  }
  return out;
}
