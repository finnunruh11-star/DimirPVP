// The Exploration overworld: one authored map of terrain tiles in six regions.
// The White Desert fills the north-west, the Northwood lies across the north,
// the Ember Peaks to the north-east, the Undead Swamps to the south-east and
// the Great Lake to the south-west, all around the Capitol plains. Pure data
// and pure functions, so the whole map can be walked and asserted in a test.

import { cellHash, type FillKind } from '../../world/kenney';
import type { Cell } from '../../world/pathfind';

export const WORLD_W = 120;
export const WORLD_H = 60;
/** Columns added west of the original map for the desert. */
export const DESERT_COLUMNS = 32;

export type RegionId = 'capitol' | 'forest' | 'red' | 'black' | 'lake' | 'white';

export interface RegionRule {
  name: string;
  /** Encounter multiplier across the region. */
  danger: number;
  /** Enemy strength next to a town; it rises the further you stray. */
  depth: number;
  /** Share of the region's fights that are robberies. */
  robbery: number;
}

export const REGIONS: Record<RegionId, RegionRule> = {
  capitol: { name: 'The Capitol Plains', danger: 0.8, depth: 1, robbery: 0.5 },
  forest: { name: 'The Northwood', danger: 1, depth: 2, robbery: 0.3 },
  red: { name: 'The Ember Peaks', danger: 1.15, depth: 4, robbery: 0.2 },
  black: { name: 'The Undead Swamps', danger: 1.35, depth: 5, robbery: 0 },
  lake: { name: 'The Great Lake', danger: 0.9, depth: 2, robbery: 0.5 },
  white: { name: 'The White Desert', danger: 1.5, depth: 5, robbery: 0.3 },
};

export type Terrain =
  | 'road'
  | 'bridge'
  | 'plains'
  | 'sand'
  | 'ford'
  | 'forest'
  | 'hills'
  | 'swamp'
  | 'dunes'
  | 'flats'
  | 'mountain'
  | 'water'
  | 'bog';

export interface TerrainRule {
  label: string;
  /** Hours multiplier per tile; Infinity where nobody can walk. */
  time: number;
  /** Encounter multiplier. */
  danger: number;
}

export const TERRAIN: Record<Terrain, TerrainRule> = {
  road: { label: 'road', time: 0.6, danger: 0.6 },
  bridge: { label: 'bridge', time: 0.6, danger: 0.6 },
  plains: { label: 'open country', time: 1, danger: 1 },
  sand: { label: 'shore', time: 1.2, danger: 0.9 },
  ford: { label: 'ford', time: 2.2, danger: 1.2 },
  forest: { label: 'woods', time: 1.4, danger: 1.2 },
  hills: { label: 'slopes', time: 1.6, danger: 1.1 },
  swamp: { label: 'marsh', time: 1.8, danger: 1.4 },
  dunes: { label: 'dunes', time: 1.5, danger: 1.3 },
  flats: { label: 'hardpan', time: 1.1, danger: 1.1 },
  mountain: { label: 'peaks', time: Infinity, danger: 0 },
  water: { label: 'water', time: Infinity, danger: 0 },
  bog: { label: 'bog', time: Infinity, danger: 0 },
};

/** The cheapest terrain there is; the route finder's heuristic relies on it. */
export const MIN_TERRAIN_TIME = 0.6;

export type PlaceKind = 'city' | 'dungeon' | 'wilderness';

/** A dive the party makes from a gate and walks back out of. */
export type DungeonId = 'swamps' | 'mines' | 'forest';

export interface Place {
  id: string;
  kind: PlaceKind;
  name: string;
  x: number;
  y: number;
  /** The walkable map this place opens. Closed places carry a note instead. */
  locale?: string;
  /** The dungeon this place's gate leads into. */
  dungeon?: DungeonId;
  note?: string;
}

export const PLACES: readonly Place[] = [
  { id: 'capitol', kind: 'city', name: 'The Capitol', x: 74, y: 30, locale: 'capitol' },
  { id: 'oakhaven', kind: 'city', name: 'Oakhaven', x: 63, y: 9, locale: 'oakhaven' },
  { id: 'pennybruck', kind: 'city', name: 'Pennybruck', x: 93, y: 23, locale: 'pennybruck' },
  { id: 'hearthfire', kind: 'city', name: 'Hearthfire', x: 107, y: 9, locale: 'hearthfire' },
  { id: 'kerusai', kind: 'city', name: 'Kerusai', x: 82, y: 46, locale: 'kerusai' },
  { id: 'thassa', kind: 'city', name: 'Thassa', x: 53, y: 38, locale: 'thassa' },
  { id: 'nerogril', kind: 'city', name: 'Nerogril', x: 44, y: 24, locale: 'nerogril' },
  { id: 'theocracy', kind: 'city', name: 'The Theocracy', x: 14, y: 14, locale: 'theocracy' },
  { id: 'small-forest', kind: 'dungeon', name: 'Small Forest', x: 51, y: 12, dungeon: 'forest' },
  { id: 'red-wilds', kind: 'wilderness', name: 'The Volcanic Wilds', x: 102, y: 27, locale: 'red-wilds' },
  { id: 'mines', kind: 'dungeon', name: 'The Mines', x: 112, y: 14, dungeon: 'mines' },
  { id: 'swamps', kind: 'dungeon', name: 'The Swamps', x: 108, y: 51, dungeon: 'swamps' },
];

/** Where a fresh run begins. */
export const START_PLACE = 'kerusai';

export function placeById(id: string): Place | undefined {
  return PLACES.find((place) => place.id === id);
}

export interface RoadLine {
  name: string;
  points: readonly Cell[];
  /** The authored bends the road runs straight between. */
  waypoints: readonly Cell[];
}

export interface WorldMap {
  readonly w: number;
  readonly h: number;
  readonly terrain: readonly Terrain[];
  readonly region: readonly RegionId[];
  /** Every road tile in order, per road, for drawing. */
  readonly roads: readonly RoadLine[];
}

// -----------------------------------------------------------------------------
//  AUTHORING
// -----------------------------------------------------------------------------

/** Smooth value noise in 0..1, `scale` tiles per lattice cell. */
export function noise(x: number, y: number, scale: number, salt: number): number {
  const gx = x / scale;
  const gy = y / scale;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const v = (i: number, j: number): number => (cellHash(i, j, salt) % 1000) / 1000;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sx;
  const bottom = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sx;
  return top + (bottom - top) * sy;
}

/** Several seeds per region; the nearest (with a wobble) claims each tile. */
const ANCHORS: readonly [RegionId, number, number][] = [
  ['white', 6, 6], ['white', 20, 4], ['white', 34, 6], ['white', 8, 18], ['white', 22, 16], ['white', 36, 18],
  ['white', 6, 30], ['white', 22, 28], ['white', 42, 23],
  ['forest', 46, 5], ['forest', 62, 6], ['forest', 78, 5], ['forest', 88, 9],
  ['red', 102, 6], ['red', 114, 10], ['red', 100, 18], ['red', 114, 24], ['red', 96, 23],
  ['capitol', 74, 28], ['capitol', 64, 24], ['capitol', 84, 32], ['capitol', 72, 38], ['capitol', 80, 45],
  ['black', 96, 52], ['black', 106, 46], ['black', 114, 54], ['black', 114, 42],
  ['lake', 44, 44], ['lake', 54, 52], ['lake', 38, 36], ['lake', 62, 56], ['lake', 22, 46], ['lake', 10, 52], ['lake', 30, 57],
];

const REGION_SALT: Record<RegionId, number> = { capitol: 101, forest: 102, red: 103, black: 104, lake: 105, white: 106 };

/** The eastern lands were drawn before the desert; their noise keeps its old origin. */
const nx = (x: number): number => x - DESERT_COLUMNS;

function regionOf(x: number, y: number): RegionId {
  let best: RegionId = 'capitol';
  let bestScore = Infinity;
  for (const [id, ax, ay] of ANCHORS) {
    const score = Math.hypot(x - ax, y - ay) + (noise(nx(x), y, 6, REGION_SALT[id]) - 0.5) * 18;
    if (score < bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

function baseTerrain(region: RegionId, wx: number, y: number): Terrain {
  const x = nx(wx);
  switch (region) {
    case 'capitol':
      return noise(x, y, 5, 11) > 0.7 ? 'forest' : 'plains';
    case 'forest':
      return noise(x, y, 5, 12) > 0.44 ? 'forest' : 'plains';
    case 'red': {
      // Higher toward the north-east corner, broken up by the noise.
      const lift = Math.max(0, 1 - Math.hypot(x - 79, y - 9) / 26) * 0.6;
      const height = noise(x, y, 6, 13) * 0.55 + lift;
      return height > 0.6 ? 'mountain' : height > 0.36 ? 'hills' : 'plains';
    }
    case 'black':
      if (noise(x, y, 4, 14) > 0.66) return 'bog';
      return noise(x, y, 6, 15) > 0.7 ? 'forest' : 'swamp';
    case 'lake':
      return noise(x, y, 5, 16) > 0.75 ? 'forest' : 'plains';
    case 'white': {
      // Sea after sea of dunes, broken by mesas and their hardpan skirts.
      const rock = noise(wx, y, 7, 18);
      return rock > 0.76 ? 'mountain' : rock > 0.63 ? 'flats' : 'dunes';
    }
  }
}

/** A 4-connected line of tiles from `a` to `b`, so paths drawn over it join up. */
export function line4(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = [{ x: a.x, y: a.y }];
  const samples = (Math.abs(b.x - a.x) + Math.abs(b.y - a.y)) * 2;
  let prev = out[0];
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const cell = { x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t) };
    if (cell.x === prev.x && cell.y === prev.y) continue;
    if (cell.x !== prev.x && cell.y !== prev.y) out.push({ x: cell.x, y: prev.y });
    out.push(cell);
    prev = cell;
  }
  return out;
}

const ROADS: readonly { name: string; points: readonly [number, number][] }[] = [
  { name: 'Kingsroad', points: [[74, 30], [75, 35], [78, 39], [81, 43], [82, 46]] },
  { name: 'Northway', points: [[74, 30], [72, 25], [69, 19], [66, 14], [63, 9]] },
  { name: 'Emberway', points: [[74, 30], [80, 29], [86, 27], [90, 25], [93, 23]] },
  { name: 'Cinder Stair', points: [[93, 23], [96, 20], [99, 18], [101, 15], [104, 12], [107, 9]] },
  { name: 'Shore Road', points: [[82, 46], [76, 47], [69, 45], [63, 42], [58, 39], [53, 38]] },
  { name: 'Westway', points: [[74, 30], [68, 31], [62, 33], [57, 35], [53, 38]] },
  { name: "Hunters' Trail", points: [[63, 9], [58, 10], [54, 11], [51, 12]] },
  { name: 'Mine Track', points: [[107, 9], [109, 11], [111, 12], [112, 14]] },
  { name: 'Ashfall Path', points: [[93, 23], [96, 25], [99, 26], [102, 27]] },
  { name: 'Mire Track', points: [[82, 46], [87, 48], [93, 49], [99, 50], [104, 51], [108, 51]] },
  { name: 'High Pass', points: [[63, 9], [70, 11], [77, 13], [83, 16], [88, 19], [93, 23]] },
  { name: 'Caravan Road', points: [[74, 30], [67, 28], [60, 27], [53, 26], [48, 25], [44, 24]] },
  { name: "Pilgrims' Way", points: [[44, 24], [38, 22], [32, 20], [26, 18], [20, 16], [14, 14]] },
  { name: 'Salt Road', points: [[53, 38], [51, 34], [49, 30], [46, 27], [44, 24]] },
];

/** The river that runs from the foot of the peaks into the Great Lake. */
const RIVER: readonly [number, number][] = [[92, 29], [88, 32], [84, 35], [79, 38], [74, 40], [68, 41], [62, 41], [59, 42]];
const FORDS: readonly [number, number][] = [[84, 35], [68, 41]];

/** The Great Lake and its one wooded island. */
const LAKE = { x: 40, y: 48, rx: 22, ry: 10 };
const ISLAND = { x: 30, y: 50, rx: 2.6, ry: 2 };
/** The oasis below the Theocracy. */
const OASIS = { x: 19, y: 18, rx: 2.2, ry: 1.4 };

let cached: WorldMap | null = null;

/** Build the authored world. Deterministic, and built once. */
export function createWorld(): WorldMap {
  if (cached) return cached;
  const w = WORLD_W;
  const h = WORLD_H;
  const terrain = new Array<Terrain>(w * h);
  const region = new Array<RegionId>(w * h);
  const at = (x: number, y: number): number => y * w + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = regionOf(x, y);
      region[at(x, y)] = r;
      terrain[at(x, y)] = baseTerrain(r, x, y);
    }
  }

  // The Great Lake, one wooded island, and a beach all round.
  const inEllipse = (e: { x: number; y: number; rx: number; ry: number }, x: number, y: number, grow = 0): number =>
    ((x - e.x) / (e.rx + grow)) ** 2 + ((y - e.y) / (e.ry + grow)) ** 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = inEllipse(LAKE, x, y) + (noise(nx(x), y, 4, 17) - 0.5) * 0.35;
      if (d < 1) terrain[at(x, y)] = 'water';
      if (inEllipse(ISLAND, x, y) < 1) terrain[at(x, y)] = 'forest';
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = terrain[at(x, y)];
      if (t !== 'plains' && t !== 'forest' && t !== 'dunes' && t !== 'flats') continue;
      let shore = false;
      for (let dy = -1; dy <= 1 && !shore; dy++) for (let dx = -1; dx <= 1 && !shore; dx++) {
        shore = inside(x + dx, y + dy) && terrain[at(x + dx, y + dy)] === 'water' && Math.hypot(x - ISLAND.x, y - ISLAND.y) > 3.2;
      }
      if (shore) terrain[at(x, y)] = 'sand';
    }
  }

  // Green around the oasis, water at its heart.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (inEllipse(OASIS, x, y, 1.6) < 1) terrain[at(x, y)] = 'plains';
      if (inEllipse(OASIS, x, y) < 1) terrain[at(x, y)] = 'water';
    }
  }

  // The river is two tiles wide so its banks draw cleanly; fords are 2x2 shallows.
  for (let i = 1; i < RIVER.length; i++) {
    const [ax, ay] = RIVER[i - 1];
    const [bx, by] = RIVER[i];
    for (const cell of line4({ x: ax, y: ay }, { x: bx, y: by })) {
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const x = cell.x + dx;
        const y = cell.y + dy;
        if (inside(x, y) && terrain[at(x, y)] !== 'mountain') terrain[at(x, y)] = 'water';
      }
    }
  }
  for (const [fx, fy] of FORDS) {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) terrain[at(fx + dx, fy + dy)] = 'ford';
  }

  // Roads cut passes, cross the river on bridges and run causeways over the bog.
  const roads: RoadLine[] = [];
  for (const road of ROADS) {
    const points: Cell[] = [];
    for (let i = 1; i < road.points.length; i++) {
      const [ax, ay] = road.points[i - 1];
      const [bx, by] = road.points[i];
      const segment = line4({ x: ax, y: ay }, { x: bx, y: by });
      points.push(...(i === 1 ? segment : segment.slice(1)));
    }
    for (const cell of points) {
      const i = at(cell.x, cell.y);
      terrain[i] = terrain[i] === 'water' || terrain[i] === 'bridge' ? 'bridge' : 'road';
    }
    roads.push({ name: road.name, points, waypoints: road.points.map(([x, y]) => ({ x, y })) });
  }

  // Every place stands on its own square with open ground around a town.
  for (const place of PLACES) {
    terrain[at(place.x, place.y)] = 'road';
    if (place.kind !== 'city') continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = place.x + dx;
      const y = place.y + dy;
      if (!inside(x, y)) continue;
      const t = terrain[at(x, y)];
      if (t !== 'mountain' && t !== 'bog' && t !== 'water') continue;
      const r = region[at(x, y)];
      terrain[at(x, y)] = r === 'red' ? 'hills' : r === 'white' ? 'flats' : 'plains';
    }
  }

  cached = { w, h, terrain, region, roads };
  return cached;
}

// -----------------------------------------------------------------------------
//  QUERIES
// -----------------------------------------------------------------------------

export function inWorld(world: WorldMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < world.w && y < world.h;
}

export function terrainAt(world: WorldMap, x: number, y: number): Terrain {
  return inWorld(world, x, y) ? world.terrain[y * world.w + x] : 'mountain';
}

export function regionAt(world: WorldMap, x: number, y: number): RegionId {
  return inWorld(world, x, y) ? world.region[y * world.w + x] : 'capitol';
}

export function isPassable(world: WorldMap, x: number, y: number): boolean {
  return regionAt(world, x, y) !== 'white' && Number.isFinite(TERRAIN[terrainAt(world, x, y)].time);
}

export function placeAt(x: number, y: number): Place | undefined {
  return PLACES.find((place) => place.x === x && place.y === y);
}

/** The place within `reach` tiles of (x, y), the closest when several are. */
export function placeNear(x: number, y: number, reach: number): Place | undefined {
  let best: Place | undefined;
  let bestDist = Infinity;
  for (const place of PLACES) {
    if (Math.max(Math.abs(place.x - x), Math.abs(place.y - y)) > reach) continue;
    const dist = Math.hypot(place.x - x, place.y - y);
    if (dist < bestDist) {
      best = place;
      bestDist = dist;
    }
  }
  return best;
}

/** Tiles to the nearest town, as the crow flies. */
export function townDistance(x: number, y: number): number {
  let best = Infinity;
  for (const place of PLACES) {
    if (place.kind === 'city') best = Math.min(best, Math.hypot(place.x - x, place.y - y));
  }
  return best;
}

/** Close enough to a town's walls that nothing attacks. */
export function nearTown(x: number, y: number): boolean {
  return PLACES.some((place) => place.kind === 'city' && Math.max(Math.abs(place.x - x), Math.abs(place.y - y)) <= 2);
}

/** Enemy strength on a tile: the region's floor, rising a step every ten tiles from town. */
export function depthAt(world: WorldMap, x: number, y: number): number {
  return Math.min(10, REGIONS[regionAt(world, x, y)].depth + Math.floor(townDistance(x, y) / 10));
}

/** What the party calls the ground it stands on. */
export function describeTile(world: WorldMap, x: number, y: number): string {
  const place = placeAt(x, y);
  if (place) return place.name;
  return `${REGIONS[regionAt(world, x, y)].name}, ${TERRAIN[terrainAt(world, x, y)].label}`;
}

const REGION_GROUND: Record<RegionId, FillKind> = {
  capitol: 'grass',
  forest: 'meadow',
  red: 'dirt',
  black: 'olive',
  lake: 'grass',
  white: 'sand',
};

/** The ground fill a tile of `terrain` shows in `region`, on the map and underfoot. */
export function terrainFill(terrain: Terrain, region: RegionId): FillKind {
  switch (terrain) {
    case 'sand':
    case 'ford':
    case 'dunes':
      return 'sand';
    case 'flats':
    case 'hills':
      return 'dirt';
    case 'swamp':
      return 'blight';
    case 'mountain':
      return region === 'white' ? 'sand' : 'stone';
    case 'forest':
      return region === 'forest' ? 'moss' : REGION_GROUND[region];
    case 'plains':
      return region === 'white' ? 'grass' : REGION_GROUND[region];
    default:
      return REGION_GROUND[region];
  }
}
