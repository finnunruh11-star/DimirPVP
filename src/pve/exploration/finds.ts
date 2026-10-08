// What a party turns up off the road: local resources and lost supplies, or
// crafted gear when exploring. Every roll uses the caller's dice so a reload
// finds the same thing.

import type { Dice } from '../../core/Dice';
import type { ItemId } from '../../core/Items';
import { craftScore, effectPool, materialsValue, pickEffects, POSSIBLE_ROLLS } from '../../core/crafting/craft';
import { CRAFT_TEMPLATES, CRAFT_TEMPLATE_IDS, MAX_CRAFT_MANA, POWER_LEVELS, craftRoll, type PowerLevel } from '../../core/crafting/data';
import { craftItemId, craftMaterial, type CraftDesign } from '../../core/crafting/item';
import { grantToParty, haulLabel } from './economy';
import { dropTable } from './drops';
import { ZONE_ROSTERS } from './encounters';
import type { ExplorationRun } from './run';
import type { RegionId } from './world';

export const HERBS: Record<RegionId, ItemId[]> = {
  capitol: ['herbMoonglow'],
  forest: ['herbMoonglow', 'herbWaterleaf'],
  red: ['herbFireblossom'],
  black: ['herbDeathweed'],
  lake: ['herbWaterleaf', 'herbMoonglow'],
  white: ['herbMoonglow', 'herbFireblossom'],
};

export const GEMS: Record<RegionId, ItemId[]> = {
  capitol: ['gemAmethyst'],
  forest: ['gemEmerald', 'gemAmethyst'],
  red: ['gemRuby', 'gemSapphire'],
  black: ['gemOnyx', 'gemAmethyst'],
  lake: ['gemSapphire', 'gemEmerald', 'gemPearl'],
  white: ['gemSapphire', 'gemAmethyst', 'gemDiamond', 'gemPearl'],
};

/** Ore near enough the surface to dig out by hand. */
export const ORES: Record<RegionId, ItemId[]> = {
  capitol: ['oreCoal'],
  forest: ['oreCoal', 'oreIron'],
  red: ['oreIron', 'oreCopper', 'oreGold'],
  black: [],
  lake: ['oreCopper'],
  white: ['oreCopper', 'oreGold'],
};

const SUPPLIES: ItemId[] = ['healthPotion', 'manaPotion', 'torch', 'throwingDagger', 'arrow'];
const LOST_KIT: ItemId[] = ['huntingBow', 'ironShortsword', 'leatherCap', 'leatherBoots', 'paddedJerkin', 'copperRing', 'ironBand'];
/** Materials that can turn up naturally in this region, including its creatures' drops. */
export function localCraftMaterials(zone: RegionId): ItemId[] {
  const roster = ZONE_ROSTERS[zone];
  const kinds = [...roster.monsters, ...roster.robbery, ...roster.elites].map((entry) => entry.kind);
  return [...new Set<ItemId>([
    'wood', ...ORES[zone], ...HERBS[zone], ...GEMS[zone],
    ...kinds.flatMap((kind) => dropTable(kind).map((row) => row.item)),
  ])].filter((id) => craftMaterial(id) !== null);
}

const FOREIGN_MATERIALS: ItemId[] = [...new Set((Object.keys(HERBS) as RegionId[]).flatMap(localCraftMaterials))];

const craftDice = (roll: number, dice: Dice): [number, number] => {
  if (roll === 26) {
    const face = dice.die(20);
    return [face, face];
  }
  return [roll === 22 ? 20 : roll, dice.die(roll === 22 ? 19 : roll - 1)];
};

/** Roll a valid crafting design at exactly the reward level, favoring materials from the region. */
export function rollExploreCraft(zone: RegionId, level: PowerLevel, dice: Dice): ItemId {
  const local = localCraftMaterials(zone);
  const bySlot = (items: ItemId[], slot: 'material' | 'focus'): ItemId[] => items.filter((id) => craftMaterial(id)?.slot === slot);
  const localParts = bySlot(local, 'material');
  const localFocus = bySlot(local, 'focus');
  const foreignParts = bySlot(FOREIGN_MATERIALS, 'material');
  const foreignFocus = bySlot(FOREIGN_MATERIALS, 'focus');
  const pickMaterial = (native: ItemId[], all: ItemId[], foreignChance: number): ItemId => {
    const pool = dice.chance(foreignChance) ? all.filter((id) => !native.includes(id)) : native;
    return dice.pick(pool.length ? pool : native);
  };
  const next = POWER_LEVELS[level.level]?.min ?? Infinity;
  for (let attempt = 0; attempt < 512; attempt++) {
    const template = dice.pick(CRAFT_TEMPLATE_IDS);
    const sizes = CRAFT_TEMPLATES[template].sizes;
    const size = dice.pick(level.level >= 5 ? sizes.filter((entry) => entry.sockets >= 2) : sizes);
    if (!size) continue;
    const foreignChance = attempt < 128 ? 0.1 : 0.5;
    const parts = CRAFT_TEMPLATES[template].parts.map(() => pickMaterial(localParts, foreignParts, foreignChance));
    const socketCount = level.level >= 3 ? size.sockets : dice.die(size.sockets + 1) - 1;
    const sockets = Array.from({ length: socketCount }, () => pickMaterial(localFocus, foreignFocus, foreignChance));
    const design: CraftDesign = { template, form: size.form, parts, sockets, mana: 0 };
    const base = materialsValue(design);
    const rolls = POSSIBLE_ROLLS.filter((result) =>
      result >= 2 && Math.max(0, level.min - base - result) <= Math.min(MAX_CRAFT_MANA, next - 1 - base - result));
    if (!rolls.length) continue;
    const rolled = craftDice(dice.pick(rolls), dice);
    const rollScore = craftRoll(...rolled);
    const minMana = Math.max(0, level.min - base - rollScore);
    const maxMana = Math.min(MAX_CRAFT_MANA, next - 1 - base - rollScore);
    design.mana = minMana + dice.die(maxMana - minMana + 1) - 1;
    const score = craftScore(design, rolled).total;
    return craftItemId({ ...design, dice: rolled, score, effects: pickEffects(effectPool(design), level, dice) });
  }
  throw new Error(`No ${level.name} crafting design could be found for ${zone}`);
}

const WHERE: Record<RegionId, string[]> = {
  capitol: ['In a hedgerow', 'Under a milestone', 'By an old well'],
  forest: ['Under a fallen oak', 'In a hollow stump', 'Among the ferns'],
  red: ['In a rock crevice', 'Beside a steaming vent', 'Under a cairn'],
  black: ['Half-sunk in the mud', 'In a drowned cart', 'On a grave mound'],
  lake: ['Washed up on the shore', 'In a beached rowboat', 'Among the reeds'],
  white: ['Under a dune crest', 'In a sun-bleached skeleton', 'Beside a half-buried pillar'],
};

/** Hand the party one find and say what it was. Things, never coin, and nothing learned from it. */
export function rollFind(run: ExplorationRun, zone: RegionId, depth: number, dice: Dice): string {
  const where = dice.pick(WHERE[zone]);
  const roll = dice.float();
  const pool = roll < 0.55 ? HERBS[zone] : roll < 0.75 ? SUPPLIES : roll < 0.93 || depth < 3 ? GEMS[zone] : LOST_KIT;
  const id = dice.pick(pool);
  const count = pool === HERBS[zone] ? dice.die(2) : id === 'arrow' ? 3 + dice.die(4) : 1;
  return `${where}: ${grant(run, id, count)}.`;
}

/** Explore's d20 find: 1-10 nothing, then increasingly powerful crafted gear. */
export function rollExploreFind(run: ExplorationRun, zone: RegionId, roll: number, rare: number | undefined, dice: Dice): string | null {
  return rollExploreFindLoot(run, zone, roll, rare, dice)?.message ?? null;
}

export interface ExploreFindLoot { message: string; item: ItemId; left: number }

/** The road find and any item that still needs room after the party takes what fits. */
export function rollExploreFindLoot(run: ExplorationRun, zone: RegionId, roll: number, rare: number | undefined, dice: Dice): ExploreFindLoot | null {
  if (roll <= 10) return null;
  const level = roll <= 13 ? POWER_LEVELS[0] : roll <= 16 ? POWER_LEVELS[1]
    : roll <= 18 ? POWER_LEVELS[2] : roll === 19 ? POWER_LEVELS[3]
      : (rare ?? dice.die(20)) <= 10 ? POWER_LEVELS[4] : POWER_LEVELS[5];
  const id = rollExploreCraft(zone, level, dice);
  const where = dice.pick(WHERE[zone]);
  const left = grantToParty(run, id);
  return { message: `${where}: ${haulLabel(id, 1, left)}.`, item: id, left };
}

function grant(run: ExplorationRun, id: ItemId, count: number): string {
  return haulLabel(id, count, grantToParty(run, id, count));
}

/** Pick a patch clean: two to four of the herb. */
export function gatherHerbs(run: ExplorationRun, herb: ItemId, dice: Dice): string {
  return `Gathered ${grant(run, herb, 1 + dice.die(3))}.`;
}

/** Search a ruin off the way: supplies, stones or lost kit, never herbs or coin. */
export function rollCache(run: ExplorationRun, zone: RegionId, depth: number, dice: Dice, where: string): string {
  const roll = dice.float();
  const pool = roll < 0.4 ? SUPPLIES : roll < 0.82 || depth < 2 ? GEMS[zone] : LOST_KIT;
  const id = dice.pick(pool);
  const count = id === 'arrow' ? 4 + dice.die(4) : pool === SUPPLIES && dice.float() < 0.35 ? 2 : 1;
  return `${where}: ${grant(run, id, count)}.`;
}
