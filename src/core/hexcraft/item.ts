// A drawn Hexzettel is its own id, like a crafted item: the paper and every
// grid's lines are spelled out in it, so it travels through saves, snapshots
// and the wire, and every client reads the same hex from it.

import type { ItemDef, ItemId } from '../Items';
import { FULL_GRID, hexLines, hexName, PAPERS, readHex, type HexRecipe, type PaperKind } from './runes';

export const HEX_PREFIX = 'hex:';

/** Silver a sheet costs at the guild. */
export const PAPER_COST: Record<PaperKind, number> = { plain: 1, fine: 10 };

export function isHexItemId(id: string): boolean {
  return id.startsWith(HEX_PREFIX);
}

/** `hex:<p|f>:<grid>.<grid>...`, each grid its line mask in base 36. */
export function hexItemId(paper: PaperKind, grids: readonly number[]): ItemId {
  return `${HEX_PREFIX}${PAPERS[paper].code}:${grids.map((mask) => mask.toString(36)).join('.')}` as ItemId;
}

const PATTERN = /^hex:([pf]):([0-9a-z]{1,5}(?:\.[0-9a-z]{1,5}){0,7})$/;

/** Read a Hexzettel id back. Anything malformed or unreadable is null: the id comes from saves and the wire. */
export function parseHexItemId(id: string): HexRecipe | null {
  const match = PATTERN.exec(id);
  if (!match) return null;
  const paper: PaperKind = match[1] === 'f' ? 'fine' : 'plain';
  const grids = match[2].split('.').map((raw) => parseInt(raw, 36));
  if (grids.some((mask) => !Number.isInteger(mask) || mask > FULL_GRID)) return null;
  if (hexItemId(paper, grids) !== id) return null;
  return readHex(paper, grids).recipe;
}

function buildHexItem(id: ItemId, recipe: HexRecipe): ItemDef {
  return {
    id,
    name: hexName(recipe),
    slot: 'utility',
    rarity: recipe.paper === 'fine' ? 'rare' : 'consumeable',
    cost: PAPER_COST[recipe.paper] + recipe.lines,
    weight: 0.1,
    blurb: [`A hex drawn on ${PAPERS[recipe.paper].name.toLowerCase()}. Anyone may loose it.`, ...hexLines(recipe)].join(' '),
    adventureOnly: true,
    hexzettel: recipe,
  };
}

const MAX_CACHED = 512;
const cache = new Map<string, ItemDef | null>();

/** The item a Hexzettel id stands for, built once and kept; undefined when the id is malformed. */
export function resolveHexItem(id: string): ItemDef | undefined {
  let def = cache.get(id);
  if (def === undefined) {
    const recipe = parseHexItemId(id);
    def = recipe ? buildHexItem(id as ItemId, recipe) : null;
    if (cache.size >= MAX_CACHED) cache.clear();
    cache.set(id, def);
  }
  return def ?? undefined;
}
