// The world on foot. The whole map is built once as one walkable place: every
// world tile is a square of WORLD_SCALE x WORLD_SCALE ground tiles, towns and
// dungeons are gates to walk into, packs roam the country between them and caches
// lie hidden off the roads. A party on foot walks only the area round the tile it
// set out from (see area.ts). Packs reroll daily. Pure: no Phaser.

import { Dice } from '../../core/Dice';
import type { BuildingSpec } from '../../world/buildings';
import { cellHash } from '../../world/kenney';
import { buildLocaleModel, type BuildingPlacement, type ExitDef, type LocaleDef, type LocaleModel, type PropPlacement } from '../../world/locale';
import { floodReach, type Cell } from '../../world/pathfind';
import { areaBounds, areaBoundsOf, inAreaBounds } from './area';
import { hashString } from './economy';
import { describeSpawns, packPace, rollEncounter, spawnTint } from './encounters';
import { rollFind } from './finds';
import type { Landmark, LocaleTravel, ResolvedLocale, Secret, SecretResult, WildPack } from './locales';
import { questCacheSpecs, questCalm, questPackSpecs, searchQuestCache } from './quest';
import type { ExplorationRun } from './run';
import { SITE_RADIUS, siteFind, sitePlan, siteWokeFlag, type EncounterSite } from './site';
import {
  createWorld,
  depthAt,
  noise,
  PLACES,
  placeById,
  REGIONS,
  regionAt,
  START_PLACE,
  TERRAIN,
  terrainAt,
  terrainFill,
  type Place,
  type RegionId,
  type Terrain,
  type WorldMap,
} from './world';

export const OPEN_WORLD_ID = 'world';
/** Walkable tiles along each side of one world tile. */
export const WORLD_SCALE = 10;
const K = WORLD_SCALE;
/** Gates are this many ground tiles a side at any scale, so the dressing round them keeps its size. */
const GATE = 3;
/** A gate's first ground tile inside its world tile: centred. */
const GATE_AT = Math.floor((K - GATE) / 2);
/** Roads run through this ground tile of every world tile: the middle of a gate. */
const MID = GATE_AT + 1;
/** One pack may roam each block of this many world tiles a side, rerolled daily. */
const PACK_BLOCK = 3;
/** One cache may lie hidden in each block of this many world tiles a side. */
const CACHE_BLOCK = 8;
const CACHE_CHANCE = 0.45;
/** No pack settles this close to a town, in world tiles. */
const TOWN_PEACE = 4;
/** Chance a block with road in it sets a pack on the road, and how much likelier bandits are there. */
const ROAD_PACK_CHANCE = 0.4;
const ROAD_ROBBERY = 1.5;
/** How far soft ground strays across the world grid, in ground tiles, and how broad its bends are. */
const WARP = 3.5;
const WARP_SCALE = 9;

/** Ground the warp may reshape. */
const SOFT: ReadonlySet<Terrain> = new Set<Terrain>(['plains', 'forest', 'hills', 'swamp', 'sand', 'dunes', 'flats']);
/** Ground nobody walks: soft ground may eat into it, never the other way round. */
const HARD: ReadonlySet<Terrain> = new Set<Terrain>(['water', 'mountain', 'bog']);
/** A road through ground nobody walks runs through this instead. */
const PASS_FILL: Record<RegionId, Terrain> = { capitol: 'plains', forest: 'plains', red: 'hills', black: 'swamp', lake: 'plains', white: 'flats' };

/** Share of full walking pace on each ground; paved track and bridges are full pace wherever they run. */
const PACE: Record<Terrain, number> = {
  road: 1,
  bridge: 1,
  plains: 0.8,
  sand: 0.8,
  flats: 0.8,
  forest: 0.65,
  hills: 0.65,
  dunes: 0.65,
  swamp: 0.55,
  ford: 0.55,
  bog: 0.55,
  mountain: 0.55,
  water: 0.55,
};

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
  return { x: tile.x * K + MID, y: tile.y * K + MID };
}

/** The world tile a ground tile belongs to. */
export function cellWorldTile(cell: Cell): Cell {
  return { x: Math.floor(cell.x / K), y: Math.floor(cell.y / K) };
}

let under: Terrain[] | null = null;

/** What each world tile is made of beneath its road: bridges span water, other roads the soft ground round them. */
function groundUnder(world: WorldMap): Terrain[] {
  if (under) return under;
  under = world.terrain.map((terrain, i) => {
    if (terrain === 'bridge') return 'water';
    if (terrain !== 'road') return terrain;
    const x = i % world.w;
    const y = (i - x) / world.w;
    const counts = new Map<Terrain, number>();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const t = terrainAt(world, x + dx, y + dy);
      if (SOFT.has(t)) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    let best = PASS_FILL[world.region[i]];
    let most = 0;
    for (const [t, n] of counts) {
      if (n > most) {
        best = t;
        most = n;
      }
    }
    return best;
  });
  return under;
}

/** The world tile a ground tile takes its look from: its own, unless soft ground wanders over the line. */
function sourceTile(world: WorldMap, ground: readonly Terrain[], x: number, y: number): number {
  const bx = Math.floor(x / K);
  const by = Math.floor(y / K);
  const own = by * world.w + bx;
  if (!SOFT.has(ground[own]) && !HARD.has(ground[own])) return own;
  const wx = Math.floor((x + (noise(x, y, WARP_SCALE, 61) - 0.5) * 2 * WARP) / K);
  const wy = Math.floor((y + (noise(x, y, WARP_SCALE, 62) - 0.5) * 2 * WARP) / K);
  if ((wx === bx && wy === by) || wx < 0 || wy < 0 || wx >= world.w || wy >= world.h) return own;
  const other = wy * world.w + wx;
  return SOFT.has(ground[other]) ? other : own;
}

function forestChar(region: RegionId, x: number, y: number, roll: number): string {
  // Trees stand in thickets with glades between, so a wood can be crossed.
  const thicket = noise(x, y, 4, 71) > 0.56;
  const trees = thicket ? 850 : 110;
  if (roll >= trees) return roll < trees + (thicket ? 50 : 80) ? '"' : '.';
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

function cellChar(world: WorldMap, ground: readonly Terrain[], tile: number, x: number, y: number): string {
  const region = world.region[tile];
  const roll = cellHash(x, y, 41) % 1000;
  switch (ground[tile]) {
    case 'road':
    case 'bridge':
      return '.';
    case 'water': return '~';
    case 'bog': return 'o';
    case 'ford': return '_';
    case 'mountain': return 'M';
    case 'forest': return forestChar(region, x, y, roll);
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

const BRUSH: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [0, 1], [1, 1]];

/** Every road as a track two tiles wide, straight between its bends and bridged over water. */
function paveRoads(d: Draft, world: WorldMap): void {
  for (const road of world.roads) {
    for (let i = 1; i < road.waypoints.length; i++) {
      const a = road.waypoints[i - 1];
      const b = road.waypoints[i];
      const x0 = a.x * K + MID;
      const y0 = a.y * K + MID;
      const dx = (b.x - a.x) * K;
      const dy = (b.y - a.y) * K;
      const vertical = Math.abs(dy) > Math.abs(dx);
      const steps = Math.max(Math.abs(dx), Math.abs(dy)) * 2;
      for (let s = 0; s <= steps; s++) {
        const px = Math.round(x0 + (dx * s) / steps);
        const py = Math.round(y0 + (dy * s) / steps);
        for (const [ox, oy] of BRUSH) {
          const ch = cellAt(d, px + ox, py + oy);
          if (!ch || ch === '_') continue;
          d.rows[py + oy][px + ox] = ch === '~' || ch === 'H' || ch === 'I' ? (vertical ? 'I' : 'H') : '=';
        }
      }
    }
  }
}

const WIDE: Readonly<Record<string, string>> = { '~': 'water', H: 'water', I: 'water', o: 'pool', _: 'sand', '=': 'dirt', '#': 'stone' };
/** What a stray strip of wide ground becomes: always something to walk on. */
const STRAY: Readonly<Record<string, string>> = { '~': '.', H: '=', I: '=', o: '.', _: '.', '=': '.', '#': '.' };

/** Wide ground only joins up in 2x2 blocks; trim the one-tile strips the warp leaves. */
function trimStrays(d: Draft): void {
  const wide = (x: number, y: number): string | undefined => WIDE[cellAt(d, x, y)];
  const inBlock = (x: number, y: number, m: string): boolean =>
    BRUSH.some(([ox, oy]) => BRUSH.every(([dx, dy]) => wide(x - ox + dx, y - oy + dy) === m));
  const stack: number[] = [];
  for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) if (wide(x, y)) stack.push(y * d.w + x);
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % d.w;
    const y = (i - x) / d.w;
    const m = wide(x, y);
    if (!m || inBlock(x, y, m)) continue;
    d.rows[y][x] = STRAY[d.rows[y][x]];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && wide(x + dx, y + dy)) stack.push((y + dy) * d.w + x + dx);
    }
  }
}

/** The top-left ground tile of a place's gate. */
function gateCell(place: Place): Cell {
  return { x: place.x * K + GATE_AT, y: place.y * K + GATE_AT };
}

function dressPlace(d: Draft, place: Place, buildings: BuildingPlacement[], props: PropPlacement[]): void {
  const { x: cx, y: cy } = gateCell(place);
  const G = GATE;
  if (place.kind === 'city') {
    clearDecor(d, cx - 2 * G, cy - 3 * G, 5 * G, 6 * G);
    // Roofs go wherever the roads leave room, nearest the gate and behind it first.
    const taken = new Set<string>();
    const free = (x: number, y: number, w: number, h: number): boolean => {
      if (!open(d, x - 1, y, w + 2, h + 1)) return false;
      if (x < cx + G + 1 && x + w > cx - 1 && y < cy + G + 1 && y + h > cy - 1) return false;
      for (let yy = y - 1; yy <= y + h; yy++) for (let xx = x - 1; xx <= x + w; xx++) if (taken.has(`${xx},${yy}`)) return false;
      return true;
    };
    for (const spec of TOWN_ROOFS[place.id] ?? []) {
      let best: { x: number; y: number; score: number } | null = null;
      for (let y = cy - 3 * G; y + spec.h <= cy + 3 * G; y++) {
        for (let x = cx - 2 * G; x + spec.w <= cx + 3 * G; x++) {
          if (!free(x, y, spec.w, spec.h)) continue;
          const score = Math.hypot(x + spec.w / 2 - (cx + 1.5), y + spec.h - (cy + 1)) + (y + spec.h > cy + 1 ? 4 : 0);
          if (!best || score < best.score) best = { x, y, score };
        }
      }
      if (!best) continue;
      buildings.push({ x: best.x, y: best.y, spec });
      for (let yy = best.y; yy < best.y + spec.h; yy++) for (let xx = best.x; xx < best.x + spec.w; xx++) taken.add(`${xx},${yy}`);
    }
    if (cellAt(d, cx - 1, cy + G) === OPEN_GROUND) d.rows[cy + G][cx - 1] = '$';
    return;
  }
  clearDecor(d, cx - 1, cy - 2, G + 2, G + 3);
  switch (place.id) {
    case 'small-forest':
      for (const [x, y] of [[cx - 1, cy], [cx - 1, cy + 2], [cx + G, cy], [cx + G, cy + 2]]) {
        if (cellAt(d, x, y) === OPEN_GROUND) d.rows[y][x] = 'D';
      }
      if (cellAt(d, cx + 1, cy - 1) === OPEN_GROUND) d.rows[cy - 1][cx + 1] = '$';
      break;
    case 'red-wilds':
      for (const [x, y] of [[cx + G, cy], [cx + G, cy + 1], [cx - 1, cy + 2]]) {
        if (cellAt(d, x, y) === OPEN_GROUND) d.rows[y][x] = 'G';
      }
      if (cellAt(d, cx + 1, cy - 1) === OPEN_GROUND) d.rows[cy - 1][cx + 1] = '$';
      break;
    case 'mines':
      if (open(d, cx, cy - 2, 2, 2)) props.push({ x: cx, y: cy - 2, kind: 'cave' });
      break;
    case 'swamps':
      for (const [x, y] of [[cx - 1, cy], [cx + G, cy + 1], [cx - 1, cy + 2]]) {
        if (cellAt(d, x, y) === OPEN_GROUND) d.rows[y][x] = 'g';
      }
      break;
  }
}

let cachedDef: LocaleDef | null = null;
let cachedModel: LocaleModel | null = null;
/** For every ground tile, the world tile it takes its look from. */
let cachedSource: Int32Array | null = null;

/** The world as one walkable map. Built once. */
export function openWorldDef(): LocaleDef {
  if (cachedDef) return cachedDef;
  const world = createWorld();
  const ground = groundUnder(world);
  const w = world.w * K;
  const h = world.h * K;
  const source = new Int32Array(w * h);
  const rows: string[][] = new Array(h);
  for (let y = 0; y < h; y++) {
    const row: string[] = new Array(w);
    for (let x = 0; x < w; x++) {
      const tile = sourceTile(world, ground, x, y);
      source[y * w + x] = tile;
      row[x] = cellChar(world, ground, tile, x, y);
    }
    rows[y] = row;
  }
  const d: Draft = { w, h, rows };
  paveRoads(d, world);
  trimStrays(d);
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
    const tile = source[y * w + x];
    if (ground[tile] !== 'plains' || world.region[tile] !== 'white') continue;
    if (cellHash(x, y, 43) % 1000 >= 160 || !open(d, x, y - 1, 1, 2)) continue;
    if (taken.has(y * w + x) || taken.has((y - 1) * w + x)) continue;
    props.push({ x, y: y - 1, kind: 'palm' });
    claim(x, y - 1, 1, 2);
  }

  const exits: ExitDef[] = PLACES.map((place) => {
    const { x, y } = gateCell(place);
    return {
      x,
      y,
      w: GATE,
      h: GATE,
      label: place.locale || place.dungeon ? `Enter ${place.name}` : `${place.name} (closed)`,
      to: 'place',
      place: place.id,
    };
  });
  const capitol = gateCell(placeById('capitol')!);
  cachedSource = source;
  cachedDef = {
    id: OPEN_WORLD_ID,
    name: 'The World',
    ground: 'grass',
    terrain: d.rows.map((row) => row.join('')),
    buildings,
    props,
    exits,
    spawn: { x: capitol.x + 1, y: capitol.y + GATE },
    groundAt: (x, y) => {
      const tile = source[y * w + x];
      return terrainFill(ground[tile], world.region[tile]);
    },
  };
  return cachedDef;
}

export function openWorldModel(): LocaleModel {
  if (!cachedModel) cachedModel = buildLocaleModel(openWorldDef());
  return cachedModel;
}

/** Share of full walking pace on a ground tile: roads and bridges are quickest, marsh and fords slowest. */
export function openWorldPace(x: number, y: number): number {
  const def = openWorldDef();
  const ch = def.terrain[y]?.[x];
  if (ch == null || ch === '=' || ch === 'H' || ch === 'I') return 1;
  const tile = cachedSource![y * def.terrain[0].length + x];
  return PACE[groundUnder(createWorld())[tile]];
}

/** The ground tile just below a place's gate, where a party stepping out of it stands. */
export function gateArrival(tile: Cell): Cell {
  return { x: tile.x * K + GATE_AT + 1, y: tile.y * K + GATE_AT + GATE };
}

/** An open ground tile to stand on for a world tile: below a place's gate, else as near its middle as the land allows. */
export function openWorldCell(tile: Cell): Cell {
  const model = openWorldModel();
  const place = PLACES.find((p) => p.x === tile.x && p.y === tile.y);
  const want = place ? gateArrival(place) : worldTileCell(tile);
  for (let r = 0; r <= K + 2; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = want.x + dx;
      const y = want.y + dy;
      if (!model.blocked(x, y) && !model.exitAt(x, y)) return { x, y };
    }
  }
  return openWorldDef().spawn;
}

function townClose(tx: number, ty: number): boolean {
  return PLACES.some((place) => place.kind === 'city' && Math.max(Math.abs(place.x - tx), Math.abs(place.y - ty)) <= TOWN_PEACE);
}

let mainland: Uint8Array | null = null;

/** Every ground tile that can be walked to from the start; islands and walled-in pockets are left out. */
export function openWorldMainland(): Uint8Array {
  if (mainland) return mainland;
  const model = openWorldModel();
  mainland = floodReach(model.w, model.h, model.blocked, openWorldCell(placeById(START_PLACE)!));
  return mainland;
}

/** A reachable open ground tile inside world tile (tx, ty), picked by the dice. */
function openCellIn(model: LocaleModel, tx: number, ty: number, dice: Dice): Cell | null {
  const land = openWorldMainland();
  for (let tries = 0; tries < 12; tries++) {
    const x = tx * K + dice.die(K) - 1;
    const y = ty * K + dice.die(K) - 1;
    if (land[y * model.w + x] && !model.exitAt(x, y)) return { x, y };
  }
  return null;
}

/** A reachable ground tile of paved road inside world tile (tx, ty), picked by the dice. */
function roadCellIn(model: LocaleModel, tx: number, ty: number, dice: Dice): Cell | null {
  const land = openWorldMainland();
  const rows = model.def.terrain;
  const cells: Cell[] = [];
  for (let y = ty * K; y < (ty + 1) * K; y++) for (let x = tx * K; x < (tx + 1) * K; x++) {
    if (rows[y]?.[x] === '=' && land[y * model.w + x] && !model.exitAt(x, y)) cells.push({ x, y });
  }
  return cells.length ? cells[dice.die(cells.length) - 1] : null;
}

/** Today's packs across the whole world. Most roam wild country; many wait on the roads. */
export function openWorldPacks(run: ExplorationRun): WildPack[] {
  const world = createWorld();
  const model = openWorldModel();
  const packs: WildPack[] = [];
  const settles = (tx: number, ty: number): boolean =>
    tx < world.w && ty < world.h && !townClose(tx, ty) && !questCalm(run, tx, ty) && !PLACES.some((p) => p.x === tx && p.y === ty);
  for (let by = 0; by * PACK_BLOCK < world.h; by++) {
    for (let bx = 0; bx * PACK_BLOCK < world.w; bx++) {
      const dice = new Dice((hashString(`ow2:${bx},${by}:${run.day}`) ^ run.seed) >>> 0);
      const roads: Cell[] = [];
      for (let y = by * PACK_BLOCK; y < (by + 1) * PACK_BLOCK; y++) for (let x = bx * PACK_BLOCK; x < (bx + 1) * PACK_BLOCK; x++) {
        if (terrainAt(world, x, y) === 'road' && settles(x, y)) roads.push({ x, y });
      }
      let tx = bx * PACK_BLOCK + dice.die(PACK_BLOCK) - 1;
      let ty = by * PACK_BLOCK + dice.die(PACK_BLOCK) - 1;
      let at: Cell | null = null;
      let kind: 'robbery' | 'monsters';
      if (roads.length && dice.float() < ROAD_PACK_CHANCE) {
        // Roads are travelled, so something always lies in wait along them.
        ({ x: tx, y: ty } = roads[dice.die(roads.length) - 1]);
        kind = dice.float() < REGIONS[regionAt(world, tx, ty)].robbery * ROAD_ROBBERY ? 'robbery' : 'monsters';
        at = roadCellIn(model, tx, ty, dice);
      } else {
        if (!settles(tx, ty)) continue;
        const terrain = TERRAIN[terrainAt(world, tx, ty)];
        if (!Number.isFinite(terrain.time)) continue;
        const region = regionAt(world, tx, ty);
        const chance = Math.min(0.85, 0.32 * REGIONS[region].danger * terrain.danger);
        if (dice.float() >= chance) continue;
        kind = dice.float() < REGIONS[region].robbery ? 'robbery' : 'monsters';
        at = openCellIn(model, tx, ty, dice);
      }
      if (!at) continue;
      const zone = regionAt(world, tx, ty);
      const depth = depthAt(world, tx, ty);
      const spawns = rollEncounter(zone, kind, depth, dice);
      packs.push({
        id: `ow2:${bx},${by}`,
        x: at.x,
        y: at.y,
        sight: zone === 'white' ? 8 : 7,
        depth,
        spawns,
        label: `${describeSpawns(spawns)} ${WHERE[zone]}.`,
        tint: spawnTint(spawns),
        elite: depth >= 8 || spawns.some((spawn) => spawn.family === 'mine' && spawn.spec.kind === 'sandworm'),
        zone,
        pace: packPace(spawns),
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
  if (secret.id.startsWith('quest:')) return searchQuestCache(run);
  const site = run.area?.site;
  if (site && secret.id.startsWith('site:')) return siteFind(run, site, secret);
  const world = createWorld();
  const tile = cellWorldTile(secret);
  const dice = new Dice((hashString(`${secret.id}:found`) ^ run.seed) >>> 0);
  return { message: rollFind(run, regionAt(world, tile.x, tile.y), depthAt(world, tile.x, tile.y), dice) };
}

function enterPlace(run: ExplorationRun, exit: ExitDef): LocaleTravel {
  const place = exit.place ? placeById(exit.place) : undefined;
  if (!place) return { t: 'stay', notice: 'Nothing here.' };
  if (place.dungeon) return { t: 'dungeon', place: place.id };
  if (!place.locale) return { t: 'stay', notice: place.note ?? `${place.name} is closed.` };
  // Inside the walls the walk is over; the party leaves by the map again.
  run.area = null;
  run.pos = { x: place.x, y: place.y };
  if (!run.visited.includes(place.id)) run.visited.push(place.id);
  return { t: 'locale', locale: place.locale, notice: `You enter ${place.name}.` };
}

export const OPEN_WORLD_LANDMARKS: readonly Landmark[] = PLACES.map((place) => ({
  id: place.id,
  x: place.x * K + MID,
  y: place.y * K + MID,
  name: place.name,
}));

/** The ground tile nearest the middle of world tile `tile` that can be walked to from the start. */
function walkableCellNear(tile: Cell): Cell | null {
  const model = openWorldModel();
  const land = openWorldMainland();
  const want = worldTileCell(tile);
  for (let r = 0; r <= K + 2; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = want.x + dx;
      const y = want.y + dy;
      if (x < 0 || y < 0 || x >= model.w || y >= model.h) continue;
      if (land[y * model.w + x] && !model.exitAt(x, y)) return { x, y };
    }
  }
  return null;
}

function questPacks(run: ExplorationRun): WildPack[] {
  return questPackSpecs(run).flatMap((spec) => {
    const at = walkableCellNear(spec.tile);
    return at
      ? [{ id: spec.id, x: at.x, y: at.y, sight: spec.sight, depth: 1, spawns: spec.spawns, label: spec.label, tint: spawnTint(spec.spawns), zone: spec.zone, pace: packPace(spec.spawns) }]
      : [];
  });
}

function questSecrets(run: ExplorationRun): Secret[] {
  return questCacheSpecs(run).flatMap((spec) => {
    const at = walkableCellNear(spec.tile);
    return at ? [{ id: spec.id, x: at.x, y: at.y, reveal: 3, label: spec.label }] : [];
  });
}

export function resolveOpenWorld(run: ExplorationRun, id: string): ResolvedLocale | null {
  if (id !== OPEN_WORLD_ID) return null;
  const area = run.area;
  // At a site only what was spotted (and what came with it) stands on the ground.
  const content = area?.site ? siteContent(run, area.tile, area.site) : null;
  // On foot only the country round where the party set out is walked.
  const bounds = area ? areaBoundsOf(area) : null;
  const here = (cell: Cell): boolean => !bounds || inAreaBounds(bounds, cellWorldTile(cell));
  return {
    def: openWorldDef(),
    model: openWorldModel(),
    kind: 'world',
    zone: 'capitol',
    depth: 1,
    packs: content ? content.packs : [...openWorldPacks(run), ...questPacks(run)].filter(here),
    secrets: content ? content.secrets : [...openWorldSecrets(run), ...questSecrets(run)].filter(here),
    search: searchCache,
    travel: enterPlace,
    fogChunk: K,
    landmarks: [...OPEN_WORLD_LANDMARKS],
    world: true,
  };
}

/** Where the party walks in at a site: the edge it came over from, a tile out from the middle. */
export function siteArrival(tile: Cell, site: EncounterSite): Cell {
  const from = site.from ?? { x: tile.x, y: tile.y + 1 };
  const dx = Math.sign(from.x - tile.x);
  const dy = Math.sign(from.y - tile.y);
  return openWorldCell({ x: tile.x + dx, y: tile.y + (dx || dy ? dy : 1) });
}

/** A site's packs and things, each set down on open ground round the middle of its tile. */
export function siteContent(run: ExplorationRun, tile: Cell, site: EncounterSite): { packs: WildPack[]; secrets: Secret[] } {
  const model = openWorldModel();
  const land = openWorldMainland();
  const plan = sitePlan(site);
  const dice = new Dice((site.seed ^ 0x9ace) >>> 0);
  const bounds = areaBounds(tile, SITE_RADIUS);
  const centre = openWorldCell(tile);
  const arrival = siteArrival(tile, site);
  const taken: Cell[] = [];
  const spot = (near: number, far: number): Cell => {
    for (let tries = 0; tries < 60; tries++) {
      const angle = dice.float() * Math.PI * 2;
      const r = near + dice.float() * Math.max(0, far - near) + Math.floor(tries / 20);
      const x = Math.round(centre.x + Math.cos(angle) * r);
      const y = Math.round(centre.y + Math.sin(angle) * r);
      if (!inAreaBounds(bounds, cellWorldTile({ x, y })) || !land[y * model.w + x] || model.exitAt(x, y)) continue;
      if (Math.hypot(x - arrival.x, y - arrival.y) < 5) continue;
      if (taken.some((cell) => Math.hypot(cell.x - x, cell.y - y) < 2.5)) continue;
      taken.push({ x, y });
      return { x, y };
    }
    return { ...centre };
  };
  const woke = run.flags.includes(siteWokeFlag(site));
  const packs: WildPack[] = [];
  for (const pack of plan.packs) {
    const at = spot(pack.near, pack.far);
    if (run.groupsBeaten[pack.id] != null) continue;
    packs.push({
      id: pack.id,
      x: at.x,
      y: at.y,
      sight: pack.sight,
      depth: site.depth,
      spawns: pack.spawns,
      label: pack.label,
      tint: spawnTint(pack.spawns),
      zone: site.zone,
      pace: packPace(pack.spawns),
      asleep: pack.asleep && !woke,
      wakeTiles: pack.wakeTiles,
    });
  }
  const secrets: Secret[] = plan.things.map((thing) => ({
    id: thing.id,
    ...spot(thing.near, thing.far),
    reveal: 40,
    label: thing.label,
    hold: thing.hold,
    look: thing.role,
    ...(thing.role === 'herb' && site.herb ? { herb: site.herb } : {}),
  }));
  return { packs, secrets };
}
