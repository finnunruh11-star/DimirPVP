// Walkable places — towns, forest glades, the wilds — as plain data: rows of
// terrain characters plus lists of buildings and props. `buildLocaleModel`
// turns a definition into collision, ground frames and a draw list; the
// renderer only paints what this file decides. Pure: no Phaser.

import { AUTOTILES, cellHash, FILLS, NATURE, KENNEY_PROPS, narrowFrame, pickFill, wideFrame, E, N, S, W, type FillKind } from './kenney';
import type { BuildingSpec } from './buildings';
import { PROPS, type PropKind } from './props';
import { floodReach } from './pathfind';
import { shopById, type KeeperLook } from '../pve/exploration/shops';

export interface BuildingPlacement {
  x: number;
  y: number;
  spec: BuildingSpec;
  /** The shop behind this door; its keeper stands outside it. */
  shop?: string;
}

export interface PropPlacement {
  x: number;
  y: number;
  kind: PropKind;
  color?: number;
  flip?: boolean;
}

export interface ExitDef {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  /** Where the exit leads: the overworld (default), deeper into / back out of a dive, or into a place. */
  to?: 'world' | 'deeper' | 'back' | 'place';
  /** The place an exit of kind 'place' opens. */
  place?: string;
}

export interface LocaleDef {
  id: string;
  name: string;
  /** Fill under '.' cells. */
  ground: FillKind;
  /** Fill under ',' cells. */
  altGround?: FillKind;
  /** Fill for one cell, when a map changes ground from place to place; overrides both fills. */
  groundAt?: (x: number, y: number) => FillKind | undefined;
  /** Stone colour for 'W' walls. */
  wallStone?: number;
  terrain: readonly string[];
  buildings: readonly BuildingPlacement[];
  props: readonly PropPlacement[];
  exits: readonly ExitDef[];
  spawn: { x: number; y: number };
}

type Material = 'dirt' | 'stone' | 'sand' | 'water' | 'pool';

interface CellRule {
  solid: boolean;
  material?: Material;
  narrow?: boolean;
  alt?: boolean;
  /** Kenney frames: one tile, or [top, bottom] for two-tile trees. */
  nature?: number | readonly [number, number] | readonly number[];
  small?: PropKind;
  special?: 'lava' | 'bridgeH' | 'bridgeV' | 'lavaBridgeH' | 'lavaBridgeV' | 'wall' | 'fence' | 'hedge' | 'cliff';
}

const LEGEND: Record<string, CellRule> = {
  '.': { solid: false },
  ',': { solid: false, alt: true },
  '=': { solid: false, material: 'dirt' },
  ':': { solid: false, material: 'dirt', narrow: true },
  '#': { solid: false, material: 'stone' },
  ';': { solid: false, material: 'stone', narrow: true },
  '_': { solid: false, material: 'sand' },
  '~': { solid: true, material: 'water' },
  'o': { solid: true, material: 'pool' },
  'H': { solid: false, material: 'water', special: 'bridgeH' },
  'I': { solid: false, material: 'water', special: 'bridgeV' },
  'L': { solid: true, special: 'lava' },
  'J': { solid: false, special: 'lavaBridgeH' },
  'K': { solid: false, special: 'lavaBridgeV' },
  'M': { solid: true, special: 'cliff' },
  'X': { solid: true },
  'W': { solid: true, special: 'wall' },
  'F': { solid: true, special: 'fence' },
  'h': { solid: true, special: 'hedge' },
  'T': { solid: true, nature: NATURE.treeTall },
  't': { solid: true, nature: NATURE.treeRound },
  'A': { solid: true, nature: NATURE.treeTallAutumn },
  'a': { solid: true, nature: NATURE.treeRoundAutumn },
  'D': { solid: true, nature: NATURE.treeTallDark },
  'd': { solid: true, nature: NATURE.treeRoundDark },
  'Y': { solid: true, nature: NATURE.pineTall },
  'y': { solid: true, nature: NATURE.pine },
  'Q': { solid: true, nature: NATURE.pineTallDark },
  'q': { solid: true, nature: NATURE.pineDark },
  'f': { solid: true, nature: NATURE.fruitTree },
  'b': { solid: true, nature: NATURE.bush },
  'B': { solid: true, nature: NATURE.bushAutumn },
  'v': { solid: true, nature: NATURE.bushDark },
  '*': { solid: false, nature: NATURE.flowers },
  '"': { solid: false, nature: NATURE.tuft },
  'w': { solid: false, nature: NATURE.weeds },
  'p': { solid: true, nature: NATURE.pumpkin },
  's': { solid: true, nature: NATURE.stump },
  'l': { solid: true, nature: NATURE.logs },
  'g': { solid: true, nature: KENNEY_PROPS.gravestones },
  '!': { solid: true, nature: KENNEY_PROPS.campfire },
  'i': { solid: true, nature: KENNEY_PROPS.torch },
  '^': { solid: true, nature: KENNEY_PROPS.anvil },
  '$': { solid: true, nature: KENNEY_PROPS.signpost },
  'u': { solid: true, small: 'barrel' },
  'k': { solid: true, small: 'crate' },
  'n': { solid: true, small: 'sack' },
  'z': { solid: true, small: 'hay' },
  'r': { solid: true, small: 'rock' },
  'm': { solid: false, small: 'mushrooms' },
  'e': { solid: true, small: 'pots' },
  'c': { solid: true, small: 'cauldron' },
  'P': { solid: true, small: 'planter' },
  'j': { solid: true, small: 'lamp' },
  'x': { solid: true, small: 'deadtree' },
  'G': { solid: true, small: 'emberrock' },
  'V': { solid: false, small: 'vent' },
  'N': { solid: false, small: 'bones' },
};

export type LocaleSprite =
  | { t: 'kenney'; frame: number; x: number; y: number; depth: number }
  | { t: 'prop'; kind: PropKind; x: number; y: number; color?: number; flip?: boolean; depth: number }
  | { t: 'fence' | 'wall'; mask: number; x: number; y: number; depth: number }
  | { t: 'building'; placement: BuildingPlacement; depth: number }
  | { t: 'bridge'; vertical: boolean; stone?: boolean; x: number; y: number; depth: number }
  | { t: 'lava'; mask: number; x: number; y: number; depth: number }
  | { t: 'cliff'; mask: number; variant: number; x: number; y: number; depth: number };

export interface Keeper {
  shop: string;
  look: KeeperLook;
  name: string;
  x: number;
  y: number;
}

export interface LocaleModel {
  def: LocaleDef;
  w: number;
  h: number;
  /** 1 where nothing may walk. */
  solid: Uint8Array;
  /** Base fill frame per cell. */
  ground: Int32Array;
  /** Autotile frame per cell, or -1. */
  overlay: Int32Array;
  sprites: LocaleSprite[];
  keepers: Keeper[];
  blocked(x: number, y: number): boolean;
  exitAt(x: number, y: number): ExitDef | null;
}

function ruleAt(def: LocaleDef, x: number, y: number): CellRule | null {
  const ch = def.terrain[y]?.[x];
  return ch == null ? null : LEGEND[ch] ?? null;
}

export function buildLocaleModel(def: LocaleDef): LocaleModel {
  const h = def.terrain.length;
  const w = def.terrain[0]?.length ?? 0;
  const solid = new Uint8Array(w * h);
  const ground = new Int32Array(w * h);
  const overlay = new Int32Array(w * h).fill(-1);
  const sprites: LocaleSprite[] = [];
  const at = (x: number, y: number): number => y * w + x;
  const material = (x: number, y: number): Material | null =>
    x < 0 || y < 0 || x >= w || y >= h ? null : ruleAt(def, x, y)?.material ?? null;
  const isNarrow = (x: number, y: number): boolean => !!ruleAt(def, x, y)?.narrow;
  const special = (x: number, y: number, kind: CellRule['special']): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && ruleAt(def, x, y)?.special === kind;
  // Lava runs off the map edge and under its bridges without a crust.
  const molten = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return true;
    const kind = ruleAt(def, x, y)?.special;
    return kind === 'lava' || kind === 'lavaBridgeH' || kind === 'lavaBridgeV';
  };
  const rock = (x: number, y: number): boolean => x < 0 || y < 0 || x >= w || y >= h || special(x, y, 'cliff');

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const rule = ruleAt(def, x, y) ?? LEGEND['.'];
      const i = at(x, y);
      ground[i] = pickFill(def.groundAt?.(x, y) ?? (rule.alt && def.altGround ? def.altGround : def.ground), x, y);
      if (rule.solid) solid[i] = 1;
      const bottom = (y + 1) * 16;

      if (rule.material) {
        const mat = rule.material;
        const same = (dx: number, dy: number): boolean => material(x + dx, y + dy) === mat;
        if (rule.narrow) {
          const mask = (same(0, -1) ? N : 0) | (same(1, 0) ? E : 0) | (same(0, 1) ? S : 0) | (same(-1, 0) ? W : 0);
          overlay[i] = narrowFrame(AUTOTILES[mat as 'dirt'], mask);
        } else {
          // A narrow path joining a wide area keeps the joint open.
          const inArea = (dx: number, dy: number): boolean => {
            if (!same(dx, dy)) {
              if (dx !== 0 && dy !== 0) {
                return (same(dx, 0) && isNarrow(x + dx, y)) || (same(0, dy) && isNarrow(x, y + dy));
              }
              return false;
            }
            return true;
          };
          overlay[i] = wideFrame(AUTOTILES[mat].wide, inArea);
          if (mat === 'water' && overlay[i] === AUTOTILES.water.wide.c) {
            overlay[i] = FILLS.water[cellHash(x, y, 3) % FILLS.water.length];
          }
        }
      }

      if (rule.special === 'lava' || rule.special === 'lavaBridgeH' || rule.special === 'lavaBridgeV') {
        const mask = (molten(x, y - 1) ? N : 0) | (molten(x + 1, y) ? E : 0) | (molten(x, y + 1) ? S : 0) | (molten(x - 1, y) ? W : 0);
        sprites.push({ t: 'lava', mask, x, y, depth: 0 });
      }
      if (rule.special === 'lavaBridgeH' || rule.special === 'lavaBridgeV') {
        sprites.push({ t: 'bridge', vertical: rule.special === 'lavaBridgeV', stone: true, x, y, depth: 1 });
      }
      if (rule.special === 'cliff') {
        const mask = (rock(x, y - 1) ? N : 0) | (rock(x + 1, y) ? E : 0) | (rock(x, y + 1) ? S : 0) | (rock(x - 1, y) ? W : 0);
        sprites.push({ t: 'cliff', mask, variant: cellHash(x, y, 17) % 4, x, y, depth: 1 });
      }
      if (rule.special === 'bridgeH' || rule.special === 'bridgeV') {
        sprites.push({ t: 'bridge', vertical: rule.special === 'bridgeV', x, y, depth: 1 });
      }
      if (rule.special === 'fence' || rule.special === 'wall') {
        const kind = rule.special;
        const mask = (special(x, y - 1, kind) ? N : 0) | (special(x + 1, y, kind) ? E : 0)
          | (special(x, y + 1, kind) ? S : 0) | (special(x - 1, y, kind) ? W : 0);
        sprites.push({ t: kind, mask, x, y, depth: bottom });
      }
      if (rule.special === 'hedge') {
        const left = special(x - 1, y, 'hedge');
        const right = special(x + 1, y, 'hedge');
        const piece = left && right ? 1 : left ? 2 : right ? 0 : 1;
        sprites.push({ t: 'kenney', frame: NATURE.hedgeTop[piece], x, y: y - 1, depth: bottom });
        sprites.push({ t: 'kenney', frame: NATURE.hedgeBottom[piece], x, y, depth: bottom });
      }
      if (rule.nature != null) {
        const nature = rule.nature;
        if (typeof nature === 'number') {
          sprites.push({ t: 'kenney', frame: nature, x, y, depth: rule.solid ? bottom : 2 });
        } else if (rule.solid && nature.length === 2 && isTallTree(nature)) {
          sprites.push({ t: 'kenney', frame: nature[0], x, y: y - 1, depth: bottom });
          sprites.push({ t: 'kenney', frame: nature[1], x, y, depth: bottom });
        } else {
          const frame = nature[cellHash(x, y, 11) % nature.length];
          sprites.push({ t: 'kenney', frame, x, y, depth: rule.solid ? bottom : 2 });
        }
      }
      if (rule.small) {
        const size = PROPS[rule.small];
        sprites.push({
          t: 'prop',
          kind: rule.small,
          x,
          y: y - (size.h - 1),
          flip: cellHash(x, y, 5) % 2 === 0,
          depth: rule.solid ? bottom : 2,
        });
      }
    }
  }

  for (const placement of def.buildings) {
    const { x, y, spec } = placement;
    for (let yy = y; yy < y + spec.h; yy++) for (let xx = x; xx < x + spec.w; xx++) {
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) solid[at(xx, yy)] = 1;
    }
    sprites.push({ t: 'building', placement, depth: (y + spec.h) * 16 });
  }

  for (const prop of def.props) {
    const size = PROPS[prop.kind];
    const top = size.solid === 'bottom' ? prop.y + size.h - 1 : prop.y;
    if (size.solid !== 'none') {
      for (let yy = top; yy < prop.y + size.h; yy++) for (let xx = prop.x; xx < prop.x + size.w; xx++) {
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) solid[at(xx, yy)] = 1;
      }
    }
    sprites.push({ t: 'prop', kind: prop.kind, x: prop.x, y: prop.y, color: prop.color, flip: prop.flip, depth: (prop.y + size.h) * 16 });
  }

  const keepers: Keeper[] = [];
  for (const placement of def.buildings) {
    if (!placement.shop || placement.spec.door == null) continue;
    const shop = shopById(placement.shop);
    if (!shop) continue;
    const x = placement.x + placement.spec.door;
    const y = placement.y + placement.spec.h;
    keepers.push({ shop: shop.id, look: shop.keeper, name: shop.name, x, y });
    if (x >= 0 && y >= 0 && x < w && y < h) solid[at(x, y)] = 1;
  }

  return {
    def,
    w,
    h,
    solid,
    ground,
    overlay,
    sprites,
    keepers,
    blocked: (x, y) => x < 0 || y < 0 || x >= w || y >= h || solid[at(x, y)] === 1,
    exitAt: (x, y) => def.exits.find((exit) => x >= exit.x && y >= exit.y && x < exit.x + exit.w && y < exit.y + exit.h) ?? null,
  };
}

function isTallTree(frames: readonly number[]): boolean {
  const tall: readonly (readonly number[])[] = [
    NATURE.treeTall, NATURE.treeTallAutumn, NATURE.treeTallDark,
    NATURE.pineTall, NATURE.pineTallAutumn, NATURE.pineTallDark, NATURE.fruitTree,
  ];
  return tall.some((pair) => pair[0] === frames[0] && pair[1] === frames[1]);
}

/** Everything wrong with a definition; an empty list means it is sound. */
export function validateLocale(def: LocaleDef): string[] {
  const errors: string[] = [];
  const h = def.terrain.length;
  const w = def.terrain[0]?.length ?? 0;
  def.terrain.forEach((row, y) => {
    if (row.length !== w) errors.push(`${def.id}: row ${y} is ${row.length} wide, expected ${w}`);
    for (let x = 0; x < row.length; x++) {
      if (!(row[x] in LEGEND)) errors.push(`${def.id}: unknown terrain '${row[x]}' at ${x},${y}`);
    }
  });
  if (errors.length) return errors;

  // Wide ground must come in blocks at least 2x2, or its edges cannot join up.
  const wideMat = (x: number, y: number): Material | null => {
    const rule = ruleAt(def, x, y);
    return rule?.material && !rule.narrow ? rule.material : null;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const mat = wideMat(x, y);
    if (!mat) continue;
    const inBlock = [[0, 0], [-1, 0], [0, -1], [-1, -1]].some(([ox, oy]) =>
      [[0, 0], [1, 0], [0, 1], [1, 1]].every(([dx, dy]) => wideMat(x + ox + dx, y + oy + dy) === mat));
    if (!inBlock) errors.push(`${def.id}: ${mat} at ${x},${y} is a one-tile strip (use a narrow path)`);
  }

  const model = buildLocaleModel(def);
  const occupied = new Map<number, string>();
  const claim = (x: number, y: number, what: string): void => {
    if (x < 0 || y < 0 || x >= w || y >= h) {
      errors.push(`${def.id}: ${what} leaves the map at ${x},${y}`);
      return;
    }
    const key = y * w + x;
    const prior = occupied.get(key);
    if (prior) errors.push(`${def.id}: ${what} overlaps ${prior} at ${x},${y}`);
    occupied.set(key, what);
    const rule = ruleAt(def, x, y);
    if (rule?.solid || rule?.nature != null || rule?.small) errors.push(`${def.id}: ${what} sits on terrain '${def.terrain[y][x]}' at ${x},${y}`);
  };
  def.buildings.forEach((b, index) => {
    for (let y = b.y; y < b.y + b.spec.h; y++) for (let x = b.x; x < b.x + b.spec.w; x++) claim(x, y, `building ${b.shop ?? index}`);
    if (b.shop && !shopById(b.shop)) errors.push(`${def.id}: unknown shop ${b.shop}`);
    if (b.shop && b.spec.door == null) errors.push(`${def.id}: shop ${b.shop} has no door`);
  });
  def.props.forEach((p) => {
    const size = PROPS[p.kind];
    for (let y = p.y; y < p.y + size.h; y++) for (let x = p.x; x < p.x + size.w; x++) claim(x, y, `${p.kind} at ${p.x},${p.y}`);
  });
  for (const keeper of model.keepers) claim(keeper.x, keeper.y, `keeper ${keeper.shop}`);

  const spawnBlocked = model.blocked(def.spawn.x, def.spawn.y);
  if (spawnBlocked) errors.push(`${def.id}: spawn ${def.spawn.x},${def.spawn.y} is blocked`);
  const reach = floodReach(w, h, model.blocked, def.spawn);
  const reachable = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && reach[y * w + x] === 1;
  for (const keeper of model.keepers) {
    const near = [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1]].some(([dx, dy]) => reachable(keeper.x + dx, keeper.y + dy));
    if (!near) errors.push(`${def.id}: nobody can reach the ${keeper.shop} keeper at ${keeper.x},${keeper.y}`);
  }
  for (const exit of def.exits) {
    let ok = false;
    for (let y = exit.y; y < exit.y + exit.h && !ok; y++) for (let x = exit.x; x < exit.x + exit.w && !ok; x++) ok = reachable(x, y);
    if (!ok) errors.push(`${def.id}: exit "${exit.label}" cannot be reached`);
  }
  return errors;
}

/** A one-character-per-tile picture of the finished map, for checking layouts by eye. */
export function localeSketch(def: LocaleDef): string[] {
  const model = buildLocaleModel(def);
  const rows = def.terrain.map((row) => row.split(''));
  for (const b of def.buildings) {
    for (let y = b.y; y < b.y + b.spec.h; y++) for (let x = b.x; x < b.x + b.spec.w; x++) {
      if (rows[y]?.[x] != null) rows[y][x] = y === b.y + b.spec.h - 1 && x === b.x + (b.spec.door ?? -9) ? 'O' : '@';
    }
  }
  for (const p of def.props) {
    const size = PROPS[p.kind];
    for (let y = p.y; y < p.y + size.h; y++) for (let x = p.x; x < p.x + size.w; x++) if (rows[y]?.[x] != null) rows[y][x] = '%';
  }
  for (const keeper of model.keepers) if (rows[keeper.y]?.[keeper.x] != null) rows[keeper.y][keeper.x] = '&';
  if (rows[def.spawn.y]?.[def.spawn.x] != null) rows[def.spawn.y][def.spawn.x] = '+';
  return rows.map((row) => row.join(''));
}
