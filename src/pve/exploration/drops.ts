// What a fallen creature leaves on an Exploration field: its own material, and
// many creatures nothing at all. Every row rolls on its own; the lich and the
// reaper roll their hoards instead, d20 after d20. Creatures met deeper in are a
// little more generous. Pure and seeded.

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
  zombie: [],
  acidZombie: [],
  skeleton: [],
  wisp: [{ item: 'ectoplasm', chance: 0.4 }],
  specter: [{ item: 'ectoplasm', chance: 0.6, extra: 1 }, { item: 'manaStoneMedium', chance: 0.15 }],
  defender: [],
  ghast: [{ item: 'manaStoneBig', chance: 0.5 }, { item: 'ghastEssence', chance: 0.05 }],
  soldierDemon: [{ item: 'manaStoneMedium', chance: 0.5 }, { item: 'demonHorn', chance: 0.35 }],
  beastDemon: [{ item: 'beastHorn', chance: 0.35 }],
  oni: [{ item: 'manaStoneBig', chance: 0.6 }, { item: 'badCharm', chance: 0.4 }],
  // Their hoards: see HOARDS.
  lich: [],
  reaper: [],
  // The only darksteel there is, for whoever rolls well.
  deathknightSpear: [{ item: 'darksteelBar', chance: 0.35, extra: 1 }, { item: 'lostSoul', chance: 0.5 }],
  // ---- The goblin band ----
  goblinChief: [],
  goblinRaider: [],
  goblinShaman: [],
  // ---- Baral's workshop ----
  baral: [{ item: 'manaStoneBig', chance: 1, extra: 1 }, { item: 'crudeTrinket', chance: 1, extra: 2 }],
  denialArtifact: [{ item: 'sentinelLens', chance: 0.5 }],
  baralDrake: [{ item: 'crudeTrinket', chance: 0.15 }],
  // ---- Stone, scale and bandits ----
  rockling: [{ item: 'pebble', chance: 0.4 }],
  kobold: [{ item: 'koboldScale', chance: 0.35 }, { item: 'crudeTrinket', chance: 0.1 }],
  'elite-kobold': [{ item: 'chargedScale', chance: 0.4 }, { item: 'crudeTrinket', chance: 0.2 }],
  golem: [{ item: 'stoneHeart', chance: 0.25 }],
  sentinel: [{ item: 'sentinelLens', chance: 0.35 }],
  // A magma sentinel leaves the shard of its role; one met without a role, any of them.
  'magma-sentinel': [
    { item: 'magmaShardTank', chance: 0.12 },
    { item: 'magmaShardHealer', chance: 0.12 },
    { item: 'magmaShardMage', chance: 0.12 },
  ],
  'magma-sentinel:tank': [{ item: 'magmaShardTank', chance: 0.35 }],
  'magma-sentinel:healer': [{ item: 'magmaShardHealer', chance: 0.35 }],
  'magma-sentinel:dps': [{ item: 'magmaShardMage', chance: 0.35 }],
  'earth-elemental': [{ item: 'redStone', chance: 0.4 }],
  pftlhb: [{ item: 'darkEye', chance: 0.5 }],
  'cavern-bat': [{ item: 'batLeather', chance: 0.35 }],
  'red-dragonborn': [{ item: 'redDrakeScale', chance: 0.5 }],
  'black-dragonborn': [{ item: 'blackDrakeScale', chance: 0.5 }],
  bandit: [],
  'bandit-archer': [],
  'bandit-captain': [],
  'sand-stalker': [],
  sandworm: [],
  // ---- Beasts ----
  rabbit: [{ item: 'rabbitPelt', chance: 0.4 }],
  slime: [{ item: 'slimeGel', chance: 0.5 }],
  'slime-red': [{ item: 'gelRed', chance: 0.5 }],
  'slime-blue': [{ item: 'gelBlue', chance: 0.5 }],
  'slime-black': [{ item: 'gelBlack', chance: 0.5 }],
  'slime-white': [{ item: 'gelWhite', chance: 0.5 }],
  wolf: [{ item: 'wolfPelt', chance: 0.45 }, { item: 'wolfFang', chance: 0.1 }],
  boar: [{ item: 'boarHide', chance: 0.55 }, { item: 'boarTusk', chance: 0.25 }],
  lion: [{ item: 'lionPelt', chance: 0.6 }, { item: 'lionFang', chance: 0.3 }],
  lioness: [{ item: 'lionPelt', chance: 0.45 }, { item: 'lionFang', chance: 0.2 }],
};

/**
 * A boss's hoard, rolled d20 after d20: 1-6 ends it, 7-17 gives the common find
 * and rolls again, 18-19 gives the core and ends it, 20 gives the core and rolls
 * again with every later roll 3 lower (so no second core). A `thirteen` replaces
 * the common find on a 13 and ends the hoard.
 */
export interface Hoard {
  core: ItemId;
  common: ItemId;
  thirteen?: ItemId;
}

export const HOARDS: Readonly<Record<string, Hoard>> = {
  reaper: { core: 'reaperCore', common: 'ectoplasm', thirteen: 'voidShard' },
  lich: { core: 'lichCore', common: 'ectoplasm' },
};

export function rollHoard(hoard: Hoard, rng: Dice): ItemId[] {
  const out: ItemId[] = [];
  let penalty = 0;
  for (let guard = 0; guard < 200; guard++) {
    const face = rng.die(20) - penalty;
    if (face <= 6) break;
    if (face === 13 && hoard.thirteen) {
      out.push(hoard.thirteen);
      break;
    }
    if (face <= 17) {
      out.push(hoard.common);
      continue;
    }
    out.push(hoard.core);
    if (face < 20) break;
    penalty = 3;
  }
  return out;
}

/** How much likelier every row is at `depth`: +2% per depth past the first, at most +50%. */
export function depthLuck(depth: number): number {
  return Math.min(1.5, 1 + Math.max(0, depth - 1) * 0.02);
}

export function dropTable(kind: string): readonly DropRow[] {
  if (Object.prototype.hasOwnProperty.call(DROP_TABLES, kind)) return DROP_TABLES[kind];
  const family = kind.split(':')[0];
  return family !== kind ? dropTable(family) : [];
}

/** The table a creature rolls on: its kind, or its kind and role (`magma-sentinel:dps`). */
export function dropKind(kind: string, role?: string): string {
  return role ? `${kind}:${role}` : kind;
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
  const family = kind.split(':')[0];
  if (Object.prototype.hasOwnProperty.call(HOARDS, family)) out.push(...rollHoard(HOARDS[family], rng));
  return out;
}
