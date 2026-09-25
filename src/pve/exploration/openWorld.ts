// The whole world on foot. For runs that would rather walk than plan trips,
// the world map becomes one walkable place: every world tile is a square of
// WORLD_SCALE x WORLD_SCALE ground tiles, towns and dungeons are gates to walk
// into, packs roam the country between them and caches lie hidden off the
// roads. Built once from the world map; packs reroll daily. Pure: no Phaser.

import { Dice } from '../../core/Dice';
import type { BuildingSpec } from '../../world/buildings';
import { cellHash } from '../../world/kenney';
import { buildLocaleModel, type BuildingPlacement, type ExitDef, type LocaleDef, type LocaleModel, type PropPlacement } from '../../world/locale';
import type { Cell } from '../../world/pathfind';
import { MINE_ENEMY_DEFS } from '../minerun';
import { ENEMY_DEFS } from '../swamprun';
import { hashString } from './economy';
import { creatureName, rollEncounter, spawnKindId, type EncounterSpawn } from './encounters';
import { rollFind } from './finds';
import type { Landmark, LocaleTravel, ResolvedLocale, Secret, SecretResult, WildPack } from './locales';
import type { ExplorationRun } from './run';
import {
  createWorld,
  depthAt,
  PLACES,
  placeById,
  REGIONS,
  regionAt,
  TERRAIN,
  terrainAt,
  terrainFill,
  type Place,
  type RegionId,
  type WorldMap,
} from './world';

export const OPEN_WORLD_ID = 'world';
/** Walkable tiles along each side of one world tile. */
export const WORLD_SCALE = 3;
const K = WORLD_SCALE;
/** One pack may roam each block of this many world tiles a side, rerolled daily. */
const PACK_BLOCK = 6;
/** One cache may lie hidden in each block of this many world tiles a side. */
const CACHE_BLOCK = 8;
const CACHE_CHANCE = 0.45;
/** No pack settles this close to a town, in world tiles. */
const TOWN_PEACE = 4;

const WHERE: Record<RegionId, string> = {
  capitol: 'on the plains',
  forest: 'in the woods',
  red: 'on the slopes',
  black: 'in the marsh',
  lake: 'by the lake',
  white: 'on the dunes',
};

const CACHE_LABEL: Record<RegionId, string> = {
  capitol: 'Overgrown milestone',
  forest: 'Hollow stump',
  red: 'Cairn of stones',
  black: 'Sunken cart',
  lake: 'Beached rowboat',
  white: 'Half-buried chest',
};

/** The ground tile that holds the middle of a world tile. */
export function worldTileCell(tile: Cell): Cell {
  return { x: tile.x * K + 1, y: tile.y * K + 1 };
}

/** The world tile a ground tile belongs to. */
export function cellWorldTile(cell: Cell): Cell {
  return { x: Math.floor(cell.x / K), y: Math.floor(cell.y / K) };
}

function forestChar(region: RegionId, roll: number): string {
  if (roll >= 560) return roll < 640 ? '"' : '.';
  const pick = (set: string): string => set[roll % set.length];
  switch (region) {
    case 'forest': return pick('TtDdYyQqtb');
    case 'capitol': return pick('tTfbtT');
    case 'red': return pick('YyQqy');
    case 'black': return pick('dDvxd');
    case 'lake': return pick('tTyb');
    case 'white': return pick('xr');
  }
}

function plainsChar(region: RegionId, roll: number): string {
  switch (region) {
    case 'white': return roll < 60 ? '"' : '.';
    case 'red': return roll < 40 ? 'r' : roll < 70 ? '"' : '.';
    case 'black': return roll < 50 ? 'w' : roll < 70 ? 'm' : '.';
    default: return roll < 25 ? '*' : roll < 70 ? '"' : roll < 85 ? 'b' : roll < 90 ? 't' : '.';
  }
}

function cellChar(world: WorldMap, x: number, y: number): string {
  const tx = Math.floor(x / K);
  const ty = Math.floor(y / K);
  const region = regionAt(world, tx, ty);
  const roll = cellHash(x, y, 41) % 1000;
  switch (terrainAt(world, tx, ty)) {
    case 'road': return '=';
    case 'bridge': {
      const road = (dx: number, dy: number): boolean => ['road', 'bridge'].includes(terrainAt(world, tx + dx, ty + dy));
      return road(0, -1) || road(0, 1) ? 'I' : 'H';
    }
    case 'water': return '~';
    case 'bog': return 'o';
    case 'ford': return '_';
    case 'mountain': return 'M';
    case 'forest': return forestChar(region, roll);
    case 'hills': return roll < 110 ? 'r' : roll < 190 ? 'y' : roll < 240 ? '"' : '.';
    case 'swamp': return roll < 120 ? 'w' : roll < 160 ? 'm' : roll < 190 ? 'x' : roll < 200 ? 'N' : '.';
    case 'sand': return roll < 40 ? '"' : '.';
    case 'dunes': return roll < 18 ? 'r' : roll < 30 ? 'x' : roll < 40 ? 'N' : '.';
    case 'flats': return roll < 80 ? 'r' : roll < 110 ? '"' : roll < 125 ? 'x' : '.';
    case 'plains': return plainsChar(region, roll);
  }
}

/** Decorative buildings round each town's gate: a few roofs, not the town itself. */
const TOWN_ROOFS: Record<string, BuildingSpec[]> = {
  capitol: [
    { w: 6, h: 5, wallRows: 2, roof: 'slate', wall: 'stone', door: 2, windows: [1, 4], banner: 0x2f4f86 },
    { w: 4, h: 4, roof: 'red', wall: 'plaster', door: 1, windows: [3] },
    { w: 4, h: 4, roof: 'blue', wall: 'plaster', door: 2, windows: [0] },
  ],
  oakhaven: [{ w: 4, h: 4, roof: 'green', wall: 'darkwood', door: 1, windows: [3], chimney: 2 }, { w: 4, h: 4, roof: 'thatch', wall: 'wood', door: 2 }],
  pennybruck: [{ w: 4, h: 4, roof: 'slate', wall: 'stone', door: 1, chimney: 2 }, { w: 4, h: 4, roof: 'charcoal', wall: 'stone', door: 2 }],
  hearthfire: [
    { w: 6, h: 5, roof: 'rust', wall: 'brick', door: 2, chimney: 3, windows: [4] },
    { w: 4, h: 4, roof: 'charcoal', wall: 'stone', door: 1, chimney: 1 },
    { w: 4, h: 4, roof: 'red', wall: 'brick', door: 2 },
  ],
  kerusai: [{ w: 4, h: 4, roof: 'plum', wall: 'darkwood', door: 1 }, { w: 4, h: 4, roof: 'thatch', wall: 'darkwood', door: 2 }],
  thassa: [{ w: 4, h: 4, roof: 'teal', wall: 'plaster', door: 1, windows: [3] }, { w: 4, h: 4, roof: 'blue', wall: 'plaster', door: 2 }],
  nerogril: [{ w: 4, h: 4, roof: 'thatch', wall: 'sandstone', door: 1, windows: [3] }, { w: 4, h: 4, roof: 'rust', wall: 'sandstone', door: 2 }],
  theocracy: [
    { w: 6, h: 6, wallRows: 3, roof: 'teal', wall: 'plaster', door: 2, windows: [1, 4], banner: 0xe7c24a },
    { w: 4, h: 4, roof: 'thatch', wall: 'sandstone', door: 1 },
    { w: 4, h: 4, roof: 'teal', wall: 'sandstone', door: 2 },
  ],
};

interface Draft {
  rows: string[][];
  w: number;
  h: number;
}

const OPEN_GROUND = '.';
const DECOR_KEEP = '=:#;_~oHIMLJKWF';

function cellAt(d: Draft, x: number, y: number): string {
  return d.rows[y]?.[x] ?? '';
}

/** Wipe trees, rocks and scrub off a rectangle, leaving paths, water and cliffs. */
function clearDecor(d: Draft, x0: number, y0: number, w: number, h: number): void {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const ch = cellAt(d, x, y);
    if (ch && !DECOR_KEEP.includes(ch)) d.rows[y][x] = OPEN_GROUND;
  }
}

function open(d: Draft, x0: number, y0: number, w: number, h: number): boolean {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (cellAt(d, x, y) !== OPEN_GROUND) return false;
  return true;
}

function placeCell(place: Place): Cell {
  return { x: place.x * K, y: place.y * K };
}

function dressPlace(d: Draft, place: Place, buildings: BuildingPlacement[], props: PropPlacement[]): void {
  const { x: cx, y: cy } = placeCell(place);
  if (place.kind === 'city') {
    clearDecor(d, cx - 2 * K, cy - 3 * K, 5 * K, 6 * K);
    // Roofs go wherever the roads leave room, nearest the gate and behind it first.
    const taken = new Set<string>();
    const free = (x: number, y: number, w: number, h: number): boolean => {
      if (!open(d, x - 1, y, w + 2, h + 1)) return false;
      if (x < cx + K + 1 && x + w > cx - 1 && y < cy + K + 1 && y + h > cy - 1) return false;
      for (let yy = y - 1; yy <= y + h; yy++) for (let xx = x - 1; xx <= x + w; xx++) if (taken.has(`${xx},${yy}`)) return false;
      return true;
    };
    for (const spec of TOWN_ROOFS[place.id] ?? []) {
      let best: { x: number; y: number; score: number } | null = null;
      for (let y = cy - 3 * K; y + spec.h <= cy + 3 * K; y++) {
        for (let x = cx - 2 * K; x + spec.w <= cx + 3 * K; x++) {
          if (!free(x, y, spec.w, spec.h)) continue;
          const score = Math.hypot(x + spec.w / 2 - (cx + 1.5), y + spec.h - (cy + 1)) + (y + spec.h > cy + 1 ? 4 : 0);
          if (!best || score < best.score) best = { x, y, score };
        }
      }
      if (!best) continue;
      buildings.push({ x: best.x, y: best.y, spec });
      for (let yy = best.y; yy < best.y + spec.h; yy++) for (let xx = best.x; xx < best.x + spec.w; xx++) taken.add(`${xx},${yy}`);
    }
    if (cellAt(d, cx - 1, cy + K) === OPEN_GROUND) d.rows[cy + K][cx - 1] = '$';
    return;
  }
  clearDecor(d, cx - 1, cy - 2, K + 2, K + 3);
  switch (place.id) {
    case 'small-forest':
      for (const [x, y] of [[cx - 1, cy], [cx - 1, cy + 2], [cx + K, cy], [cx + K, cy + 2]]) {
        if (cellAt(d, x, y) === OPEN_GROUND) d.rows[y][x] = 'D';
      }
      if (cellAt(d, cx + 1, cy - 1) === OPEN_GROUND) d.rows[cy - 1][cx + 1] = '$';
      break;
    case 'red-wilds':
      for (const [x, y] of [[cx + K, cy], [cx + K, cy + 1], [cx - 1, cy + 2]]) {
        if (cellAt(d, x, y) === OPEN_GROUND) d.rows[y][x] = 'G';
      }
      if (cellAt(d, cx + 1, cy - 1) === OPEN_GROUND) d.rows[cy - 1][cx + 1] = '$';
      break;
    case 'mines':
      if (open(d, cx, cy - 2, 2, 2)) props.push({ x: cx, y: cy - 2, kind: 'cave' });
      break;
    case 'swamps':
      for (const [x, y] of [[cx - 1, cy], [cx + K, cy + 1], [cx - 1, cy + 2]]) {
        if (cellAt(d, x, y) === OPEN_GROUND) d.rows[y][x] = 'g';
      }
      break;
  }
}

let cachedDef: LocaleDef | null = null;
let cachedModel: LocaleModel | null = null;

/** The world as one walkable map. Built once. */
export function openWorldDef(): LocaleDef {
  if (cachedDef) return cachedDef;
  const world = createWorld();
  const w = world.w * K;
  const h = world.h * K;
  const d: Draft = { w, h, rows: Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => cellChar(world, x, y))) };
  const buildings: BuildingPlacement[] = [];
  const props: PropPlacement[] = [];
  for (const place of PLACES) dressPlace(d, place, buildings, props);

  // Palms round the oasis, clear of anything already standing there.
  const taken = new Set<number>();
  const claim = (x: number, y: number, cw: number, ch: number): void => {
    for (let yy = y; yy < y + ch; yy++) for (let xx = x; xx < x + cw; xx++) taken.add(yy * w + xx);
  };
  for (const b of buildings) claim(b.x, b.y, b.spec.w, b.spec.h);
  for (const p of props) claim(p.x, p.y, 2, 2);
  for (let y = 1; y < h; y++) for (let x = 0; x < w; x++) {
    const tx = Math.floor(x / K);
    const ty = Math.floor(y / K);
    if (terrainAt(world, tx, ty) !== 'plains' || regionAt(world, tx, ty) !== 'white') continue;
    if (cellHash(x, y, 43) % 1000 >= 160 || !open(d, x, y - 1, 1, 2)) continue;
    if (taken.has(y * w + x) || taken.has((y - 1) * w + x)) continue;
    props.push({ x, y: y - 1, kind: 'palm' });
    claim(x, y - 1, 1, 2);
  }

  const exits: ExitDef[] = PLACES.map((place) => {
    const { x, y } = placeCell(place);
    return {
      x,
      y,
      w: K,
      h: K,
      label: place.locale ? `Enter ${place.name}` : `${place.name} (closed)`,
      to: 'place',
      place: place.id,
    };
  });
  const capitol = placeById('capitol')!;
  cachedDef = {
    id: OPEN_WORLD_ID,
    name: 'The World',
    ground: 'grass',
    terrain: d.rows.map((row) => row.join('')),
    buildings,
    props,
    exits,
    spawn: { x: capitol.x * K + 1, y: capitol.y * K + K + 1 },
    groundAt: (x, y) => {
      const tx = Math.floor(x / K);
      const ty = Math.floor(y / K);
      return terrainFill(terrainAt(world, tx, ty), regionAt(world, tx, ty));
    },
  };
  return cachedDef;
}

export function openWorldModel(): LocaleModel {
  if (!cachedModel) cachedModel = buildLocaleModel(openWorldDef());
  return cachedModel;
}

/** An open ground tile to stand on for a world tile: below a place's gate, else as near its middle as the land allows. */
export function openWorldCell(tile: Cell): Cell {
  const model = openWorldModel();
  const place = PLACES.find((p) => p.x === tile.x && p.y === tile.y);
  const want = place ? { x: tile.x * K + 1, y: tile.y * K + K } : worldTileCell(tile);
  for (let r = 0; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = want.x + dx;
      const y = want.y + dy;
      if (!model.blocked(x, y) && !model.exitAt(x, y)) return { x, y };
    }
  }
  return openWorldDef().spawn;
}

function describe(spawns: EncounterSpawn[]): string {
  const counts = new Map<string, number>();
  for (const spawn of spawns) {
    const kind = spawnKindId(spawn);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts].map(([kind, n]) => `${n} ${creatureName(kind)}${n > 1 ? 's' : ''}`).join(', ');
}

function tintOf(spawns: EncounterSpawn[]): number {
  const first = spawns[0];
  if (!first) return 0xc8a890;
  return first.family === 'mine' ? MINE_ENEMY_DEFS[first.spec.kind].tint : ENEMY_DEFS[first.kind].tint ?? 0xc8a890;
}

function townClose(tx: number, ty: number): boolean {
  return PLACES.some((place) => place.kind === 'city' && Math.max(Math.abs(place.x - tx), Math.abs(place.y - ty)) <= TOWN_PEACE);
}

/** An open ground tile inside world tile (tx, ty), picked by the dice. */
function openCellIn(model: LocaleModel, tx: number, ty: number, dice: Dice): Cell | null {
  for (let tries = 0; tries < 6; tries++) {
    const x = tx * K + dice.die(K) - 1;
    const y = ty * K + dice.die(K) - 1;
    if (!model.blocked(x, y) && !model.exitAt(x, y)) return { x, y };
  }
  return null;
}

/** Today's packs across the whole world. */
export function openWorldPacks(run: ExplorationRun): WildPack[] {
  const world = createWorld();
  const model = openWorldModel();
  const packs: WildPack[] = [];
  for (let by = 0; by * PACK_BLOCK < world.h; by++) {
    for (let bx = 0; bx * PACK_BLOCK < world.w; bx++) {
      const dice = new Dice((hashString(`ow:${bx},${by}:${run.day}`) ^ run.seed) >>> 0);
      const tx = bx * PACK_BLOCK + dice.die(PACK_BLOCK) - 1;
      const ty = by * PACK_BLOCK + dice.die(PACK_BLOCK) - 1;
      if (tx >= world.w || ty >= world.h || townClose(tx, ty)) continue;
      const terrain = TERRAIN[terrainAt(world, tx, ty)];
      if (!Number.isFinite(terrain.time)) continue;
      const region = regionAt(world, tx, ty);
      const chance = Math.min(0.85, 0.32 * REGIONS[region].danger * terrain.danger);
      if (dice.float() >= chance) continue;
      const at = openCellIn(model, tx, ty, dice);
      if (!at) continue;
      const depth = depthAt(world, tx, ty);
      const kind = dice.float() < REGIONS[region].robbery ? 'robbery' : 'monsters';
      const spawns = rollEncounter(region, kind, depth, dice);
      packs.push({
        id: `ow:${bx},${by}`,
        x: at.x,
        y: at.y,
        sight: region === 'white' ? 5 : 4,
        depth,
        spawns,
        label: `${describe(spawns)} ${WHERE[region]}.`,
        tint: tintOf(spawns),
        elite: depth >= 8 || spawns.some((spawn) => spawn.family === 'mine' && spawn.spec.kind === 'sandworm'),
        zone: region,
      });
    }
  }
  return packs;
}

/** Caches hidden across the world; the same for the whole run, each found once. */
export function openWorldSecrets(run: ExplorationRun): Secret[] {
  const world = createWorld();
  const model = openWorldModel();
  const secrets: Secret[] = [];
  for (let by = 0; by * CACHE_BLOCK < world.h; by++) {
    for (let bx = 0; bx * CACHE_BLOCK < world.w; bx++) {
      const dice = new Dice((hashString(`ow-cache:${bx},${by}`) ^ run.seed) >>> 0);
      if (dice.float() >= CACHE_CHANCE) continue;
      const tx = bx * CACHE_BLOCK + dice.die(CACHE_BLOCK) - 1;
      const ty = by * CACHE_BLOCK + dice.die(CACHE_BLOCK) - 1;
      if (tx >= world.w || ty >= world.h || townClose(tx, ty) || terrainAt(world, tx, ty) === 'road') continue;
      const at = openCellIn(model, tx, ty, dice);
      if (!at) continue;
      secrets.push({ id: `ow-cache:${bx},${by}`, x: at.x, y: at.y, reveal: 2, label: CACHE_LABEL[regionAt(world, tx, ty)] });
    }
  }
  return secrets;
}

function searchCache(run: ExplorationRun, secret: Secret): SecretResult {
  const world = createWorld();
  const tile = cellWorldTile(secret);
  const dice = new Dice((hashString(`${secret.id}:found`) ^ run.seed) >>> 0);
  return { message: rollFind(run, regionAt(world, tile.x, tile.y), depthAt(world, tile.x, tile.y), dice) };
}

function enterPlace(run: ExplorationRun, exit: ExitDef): LocaleTravel {
  const place = exit.place ? placeById(exit.place) : undefined;
  if (!place) return { t: 'stay', notice: 'Nothing here.' };
  if (!place.locale) return { t: 'stay', notice: place.note ?? `${place.name} is closed.` };
  run.pos = { x: place.x, y: place.y };
  if (!run.visited.includes(place.id)) run.visited.push(place.id);
  return { t: 'locale', locale: place.locale, notice: `You enter ${place.name}.` };
}

export const OPEN_WORLD_LANDMARKS: readonly Landmark[] = PLACES.map((place) => ({
  id: place.id,
  x: place.x * K + 1,
  y: place.y * K + 1,
  name: place.name,
}));

export function resolveOpenWorld(run: ExplorationRun, id: string): ResolvedLocale | null {
  if (id !== OPEN_WORLD_ID) return null;
  return {
    def: openWorldDef(),
    model: openWorldModel(),
    kind: 'world',
    zone: 'capitol',
    depth: 1,
    packs: openWorldPacks(run),
    secrets: openWorldSecrets(run),
    search: searchCache,
    travel: enterPlace,
    fogChunk: K,
    landmarks: [...OPEN_WORLD_LANDMARKS],
    world: true,
  };
}
