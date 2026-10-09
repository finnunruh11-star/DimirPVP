import { findPath } from '../world/pathfind';
import {
  createWorld,
  depthAt,
  isPassable,
  line4,
  MIN_TERRAIN_TIME,
  nearTown,
  placeById,
  placeNear,
  PLACES,
  REGIONS,
  regionAt,
  START_PLACE,
  TERRAIN,
  terrainAt,
  WORLD_H,
  WORLD_W,
  type Terrain,
} from '../pve/exploration/world';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(actualJson === expectedJson, `${label}: expected ${expectedJson}, received ${actualJson}`);
}

const world = createWorld();
const towns = PLACES.filter((place) => place.kind === 'city');

/** Tiles of `terrain` within `radius` of a place. */
function around(x: number, y: number, radius: number, terrain: Terrain): number {
  let count = 0;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    if (terrainAt(world, x + dx, y + dy) === terrain) count += 1;
  }
  return count;
}

const tests: [name: string, run: () => void][] = [
  ['finds a place from a tile beside it, the nearest when two are close', () => {
    for (const place of PLACES) {
      equal(placeNear(place.x, place.y, 1)?.id, place.id, `${place.name} from its own tile`);
      for (const [dx, dy] of [[1, 0], [-1, 1], [0, -1]]) {
        const near = placeNear(place.x + dx, place.y + dy, 1);
        assert(near && Math.max(Math.abs(near.x - place.x - dx), Math.abs(near.y - place.y - dy)) <= 1, `a place next to ${place.name}`);
      }
    }
  }],

  ['lays out one fixed world, starting in Kerusai', () => {
    equal([world.w, world.h], [WORLD_W, WORLD_H], 'map size');
    equal(world.terrain.length, WORLD_W * WORLD_H, 'a terrain entry per tile');
    const start = placeById(START_PLACE);
    assert(start && start.kind === 'city' && start.name === 'Kerusai', 'the run starts in Kerusai');
    assert(createWorld() === world, 'the world is built once');
  }],

  ['puts eight towns in the right regions and none in the swamps', () => {
    equal(
      towns.map((t) => t.id).sort(),
      ['capitol', 'hearthfire', 'kerusai', 'nerogril', 'oakhaven', 'pennybruck', 'thassa', 'theocracy'],
      'the towns',
    );
    const region = (id: string): string => {
      const place = placeById(id)!;
      return regionAt(world, place.x, place.y);
    };
    equal(region('capitol'), 'capitol', 'the Capitol sits on its plains');
    equal(region('oakhaven'), 'forest', 'Oakhaven is in the Northwood');
    equal(region('pennybruck'), 'red', 'Pennybruck is in the mountains');
    equal(region('hearthfire'), 'red', 'Hearthfire is in the mountains');
    equal(region('thassa'), 'lake', 'Thassa is on the Great Lake');
    equal(region('nerogril'), 'white', 'Nerogril is in the desert');
    equal(region('theocracy'), 'white', 'the Theocracy is in the desert');
    for (const town of towns) assert(region(town.id) !== 'black', `${town.name} is not in the swamps`);
  }],

  ['lays the desert across the north-west, vast and mostly dunes', () => {
    const count = (id: string): number => {
      let n = 0;
      for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) if (regionAt(world, x, y) === id) n += 1;
      return n;
    };
    let desert = 0;
    let dunes = 0;
    let northWest = 0;
    for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) {
      if (regionAt(world, x, y) !== 'white') continue;
      desert += 1;
      if (terrainAt(world, x, y) === 'dunes') dunes += 1;
      if (x < WORLD_W / 2 && y < WORLD_H / 2) northWest += 1;
    }
    for (const other of ['capitol', 'forest', 'red', 'black', 'lake']) assert(desert > count(other), `the desert is bigger than ${other}`);
    assert(dunes > desert / 2, 'most of the desert is dunes');
    assert(northWest > desert * 0.6, 'the desert lies in the north-west');
    const theocracy = placeById('theocracy')!;
    const nerogril = placeById('nerogril')!;
    assert(theocracy.x < nerogril.x, 'the Theocracy lies deeper in the desert than Nerogril');
    assert(around(theocracy.x + 5, theocracy.y + 4, 3, 'water') > 0, 'an oasis lies below the Theocracy');
  }],

  ['keeps Kerusai just west of the swamps and Hearthfire above Pennybruck', () => {
    const kerusai = placeById('kerusai')!;
    let swampNear = false;
    for (let dx = 1; dx <= 8 && !swampNear; dx++) swampNear = regionAt(world, kerusai.x + dx, kerusai.y) === 'black';
    assert(swampNear, 'the swamps begin a few tiles east of Kerusai');
    const hearthfire = placeById('hearthfire')!;
    const pennybruck = placeById('pennybruck')!;
    assert(hearthfire.y < pennybruck.y, 'Hearthfire lies further up the range');
    assert(
      around(hearthfire.x, hearthfire.y, 4, 'mountain') > around(pennybruck.x, pennybruck.y, 4, 'mountain'),
      'Hearthfire is ringed by more peaks than Pennybruck',
    );
  }],

  ['keeps desert places behind the wall and other places reachable', () => {
    const start = placeById(START_PLACE)!;
    const blocked = (x: number, y: number): boolean => !isPassable(world, x, y);
    for (const place of PLACES) {
      if (regionAt(world, place.x, place.y) === 'white') {
        assert(!isPassable(world, place.x, place.y), `${place.name} is behind the wall`);
        assert(!findPath(world.w, world.h, blocked, start, place, world.w * world.h * 2), `${place.name} cannot be reached over land`);
        continue;
      }
      assert(isPassable(world, place.x, place.y), `${place.name} is on passable ground`);
      if (place.id === START_PLACE) continue;
      assert(findPath(world.w, world.h, blocked, start, place, world.w * world.h * 2), `${place.name} can be reached over land`);
    }
  }],

  ['links every town to the start by road', () => {
    const start = placeById(START_PLACE)!;
    const offRoad = (x: number, y: number): boolean => {
      const t = terrainAt(world, x, y);
      return t !== 'road' && t !== 'bridge';
    };
    for (const town of towns) {
      if (town.id === START_PLACE) continue;
      assert(findPath(world.w, world.h, offRoad, start, town, world.w * world.h * 2), `a road runs to ${town.name}`);
    }
    assert(world.roads.length >= 8, 'the roads are recorded for drawing');
  }],

  ['keeps the Great Lake and the peaks impassable, and roads the cheapest going', () => {
    for (const [id, rule] of Object.entries(TERRAIN)) {
      assert(rule.time >= MIN_TERRAIN_TIME, `${id} is no cheaper than a road`);
    }
    for (const id of ['water', 'mountain', 'bog'] as const) assert(!Number.isFinite(TERRAIN[id].time), `${id} blocks travel`);
    assert(terrainAt(world, 40, 48) === 'water', 'the middle of the Great Lake is water');
    assert(!isPassable(world, -1, 5) && !isPassable(world, 5, WORLD_H), 'the edge of the world is closed');
  }],

  ['ranks the regions by danger and deepens the road away from towns', () => {
    assert(REGIONS.white.danger > REGIONS.black.danger, 'the desert is the most hostile');
    assert(REGIONS.black.danger > REGIONS.red.danger && REGIONS.red.danger > REGIONS.forest.danger, 'swamps, then mountains, then woods');
    assert(REGIONS.forest.danger > REGIONS.capitol.danger, 'the plains are the safest');
    equal(REGIONS.black.robbery, 0, 'nobody robs travellers in the swamps');
    const capitol = placeById('capitol')!;
    equal(depthAt(world, capitol.x, capitol.y), REGIONS.capitol.depth, 'town gates are shallow');
    const swamps = placeById('swamps')!;
    assert(depthAt(world, swamps.x, swamps.y) >= 6, 'the deep swamp is deep');
    assert(nearTown(capitol.x + 2, capitol.y) && !nearTown(capitol.x + 3, capitol.y), 'safety ends three tiles out');
  }],

  ['draws straight lines as joined 4-connected steps', () => {
    const line = line4({ x: 2, y: 3 }, { x: 9, y: 7 });
    equal(line[0], { x: 2, y: 3 }, 'starts at the start');
    equal(line[line.length - 1], { x: 9, y: 7 }, 'ends at the end');
    for (let i = 1; i < line.length; i++) {
      const step = Math.abs(line[i].x - line[i - 1].x) + Math.abs(line[i].y - line[i - 1].y);
      equal(step, 1, `step ${i} moves one tile`);
    }
  }],
];

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration world: ${tests.length} checks passed.`);
