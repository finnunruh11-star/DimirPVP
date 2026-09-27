// What a party turns up off the road: the local herbs and stones, dropped
// supplies, and now and then a lost piece of kit. Every roll comes from the
// dice the caller hands in, so a reload finds the same thing.

import type { Dice } from '../../core/Dice';
import { getItem, type ItemId } from '../../core/Items';
import { grantToMage, withParty } from './economy';
import type { ExplorationRun } from './run';
import type { RegionId } from './world';

export const HERBS: Record<RegionId, ItemId[]> = {
  capitol: ['herbMoonleaf'],
  forest: ['herbMoonleaf', 'herbBogcap'],
  red: ['herbEmberroot'],
  black: ['herbBogcap'],
  lake: ['herbMoonleaf', 'herbBogcap'],
  white: ['herbEmberroot'],
};

const GEMS: Record<RegionId, ItemId[]> = {
  capitol: ['gemAmethyst'],
  forest: ['gemEmerald', 'gemAmethyst'],
  red: ['gemRuby', 'gemSapphire'],
  black: ['gemOnyx', 'gemAmethyst'],
  lake: ['gemSapphire', 'gemEmerald'],
  white: ['gemSapphire', 'gemAmethyst', 'gemDiamond'],
};

const SUPPLIES: ItemId[] = ['healthPotion', 'manaPotion', 'torch', 'throwingDagger', 'arrow'];
const LOST_KIT: ItemId[] = ['huntingBow', 'ironShortsword', 'leatherCap', 'leatherBoots', 'paddedJerkin', 'copperRing', 'ironBand'];

const WHERE: Record<RegionId, string[]> = {
  capitol: ['In a hedgerow', 'Under a milestone', 'By an old well'],
  forest: ['Under a fallen oak', 'In a hollow stump', 'Among the ferns'],
  red: ['In a rock crevice', 'Beside a steaming vent', 'Under a cairn'],
  black: ['Half-sunk in the mud', 'In a drowned cart', 'On a grave mound'],
  lake: ['Washed up on the shore', 'In a beached rowboat', 'Among the reeds'],
  white: ['Under a dune crest', 'In a sun-bleached skeleton', 'Beside a half-buried pillar'],
};

/** Hand the leader one find and say what it was. Things, never coin, and nothing learned from it. */
export function rollFind(run: ExplorationRun, zone: RegionId, depth: number, dice: Dice): string {
  const where = dice.pick(WHERE[zone]);
  const roll = dice.float();
  const pool = roll < 0.55 ? HERBS[zone] : roll < 0.75 ? SUPPLIES : roll < 0.93 || depth < 3 ? GEMS[zone] : LOST_KIT;
  const id = dice.pick(pool);
  const count = pool === HERBS[zone] ? dice.die(2) : id === 'arrow' ? 3 + dice.die(4) : 1;
  withParty(run, (leader) => {
    for (let i = 0; i < count; i++) grantToMage(leader, id);
  });
  return `${where}: ${count > 1 ? `${count}x ` : ''}${getItem(id).name}.`;
}

function grant(run: ExplorationRun, id: ItemId, count: number): string {
  withParty(run, (leader) => {
    for (let i = 0; i < count; i++) grantToMage(leader, id);
  });
  return `${count > 1 ? `${count}x ` : ''}${getItem(id).name}`;
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
