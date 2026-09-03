// The Exploration overworld: a hand-authored graph of cities, roads, dungeon
// mouths and wild country. Pure data and pure functions — no Phaser, no RNG of
// its own — so the whole map can be walked and asserted in a test.
//
// The five regions are White, Blue, Black, Red and Green. Only Black and Red
// exist so far; the rest are reachable stubs.

export type RegionId = 'capitol' | 'black' | 'red';

export type NodeKind =
  | 'city'
  /** A stretch of road. Entering one rolls for an encounter. */
  | 'path'
  /** The mouth of a dungeon; entering runs that dungeon's own mode. */
  | 'dungeon'
  /** Open country that opens into its own local map. */
  | 'wilderness'
  /** Authored but not yet built. Reachable, and says so. */
  | 'wip';

export type DungeonId = 'mines' | 'swamps';

export interface WorldNode {
  id: string;
  kind: NodeKind;
  name: string;
  region: RegionId;
  /**
   * How far into the region this node sits. Encounter strength reads this, so
   * the world is a fixed difficulty map rather than one that chases the player.
   */
  depth: number;
  /** Neighbours, in no particular order. Travel is always bidirectional. */
  links: string[];
  /** Where the node sits on the drawn map. */
  at: { x: number; y: number };
  /** Which dungeon a `dungeon` node opens. */
  dungeon?: DungeonId;
  /** Shown when a `wip` node is entered. */
  note?: string;
}

export type WorldMap = ReadonlyMap<string, WorldNode>;

/** Where a fresh run begins. */
export const START_NODE = 'capitol';

interface RoadSpec {
  /** Id prefix for the generated path nodes. */
  id: string;
  name: string;
  region: RegionId;
  from: string;
  to: string;
  /** How many path nodes sit between the two ends. */
  length: number;
  /** Depth of the first path node; each subsequent node is one deeper. */
  depth: number;
  /** Perpendicular offset of the road's midpoint, so roads curve apart. */
  bow?: number;
}

/**
 * Roads, exactly as authored:
 *   Capitol -10- Kerusai, with a spur -1- to the Swamps.
 *   Kerusai -2- a fork: the Small Forest, or on into the Red region.
 *   That fork -6- another: the Red Wilderness, or -2- Hearthfire.
 *   Hearthfire -7- Capitol, closing the loop.
 */
const ROADS: RoadSpec[] = [
  { id: 'road-capitol-kerusai', name: 'Kingsroad', region: 'capitol', from: 'capitol', to: 'kerusai', length: 10, depth: 1, bow: -60 },
  { id: 'road-swamp-spur', name: 'Mire Track', region: 'black', from: 'kerusai', to: 'swamps', length: 1, depth: 4 },
  { id: 'road-kerusai-fork', name: 'Blackwood Road', region: 'black', from: 'kerusai', to: 'fork-forest', length: 2, depth: 2 },
  { id: 'road-fork-redfork', name: 'Ashen Way', region: 'red', from: 'fork-forest', to: 'fork-wilds', length: 6, depth: 1, bow: 70 },
  { id: 'road-redfork-hearthfire', name: 'Cinder Path', region: 'red', from: 'fork-wilds', to: 'hearthfire', length: 2, depth: 6 },
  { id: 'road-hearthfire-capitol', name: 'Emberway', region: 'red', from: 'hearthfire', to: 'capitol', length: 7, depth: 3, bow: -150 },
];

const PLACES: Omit<WorldNode, 'links'>[] = [
  { id: 'capitol', kind: 'city', name: 'The Capitol', region: 'capitol', depth: 0, at: { x: 620, y: 120 } },
  { id: 'kerusai', kind: 'city', name: 'Kerusai', region: 'black', depth: 0, at: { x: 210, y: 330 } },
  { id: 'hearthfire', kind: 'city', name: 'Hearthfire', region: 'red', depth: 0, at: { x: 1010, y: 430 } },
  { id: 'mines', kind: 'dungeon', name: 'The Mines', region: 'red', depth: 1, dungeon: 'mines', at: { x: 1160, y: 560 } },
  { id: 'swamps', kind: 'dungeon', name: 'The Swamps', region: 'black', depth: 1, dungeon: 'swamps', at: { x: 90, y: 470 } },
  { id: 'red-wilds', kind: 'wilderness', name: 'The Volcanic Wilds', region: 'red', depth: 4, at: { x: 600, y: 660 } },
  {
    id: 'fork-forest',
    kind: 'wip',
    name: 'Small Forest',
    region: 'black',
    depth: 3,
    note: 'The trees thin into unfinished country. Nothing lives here yet.',
    at: { x: 250, y: 520 },
  },
  { id: 'fork-wilds', kind: 'path', name: 'Ashfall Crossing', region: 'red', depth: 4, at: { x: 760, y: 570 } },
];

/** Build the authored world. Deterministic: the same map every time. */
export function createWorld(): WorldMap {
  const nodes = new Map<string, WorldNode>();
  for (const place of PLACES) nodes.set(place.id, { ...place, links: [] });

  const link = (a: string, b: string): void => {
    const from = nodes.get(a);
    const to = nodes.get(b);
    if (!from || !to) throw new Error(`Cannot link unknown nodes ${a} <-> ${b}.`);
    if (!from.links.includes(b)) from.links.push(b);
    if (!to.links.includes(a)) to.links.push(a);
  };

  for (const road of ROADS) {
    const start = nodes.get(road.from)!.at;
    const end = nodes.get(road.to)!.at;
    // Bow the midpoint out along the road's normal so roads do not overlap.
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const span = Math.hypot(dx, dy) || 1;
    const bow = road.bow ?? 0;
    const mid = {
      x: (start.x + end.x) / 2 + (-dy / span) * bow,
      y: (start.y + end.y) / 2 + (dx / span) * bow,
    };
    let previous = road.from;
    for (let step = 1; step <= road.length; step++) {
      const id = `${road.id}-${step}`;
      const t = step / (road.length + 1);
      const inv = 1 - t;
      nodes.set(id, {
        id,
        kind: 'path',
        name: `${road.name} ${step}/${road.length}`,
        region: road.region,
        depth: road.depth + step - 1,
        links: [],
        at: {
          x: inv * inv * start.x + 2 * inv * t * mid.x + t * t * end.x,
          y: inv * inv * start.y + 2 * inv * t * mid.y + t * t * end.y,
        },
      });
      link(previous, id);
      previous = id;
    }
    link(previous, road.to);
  }

  // Hearthfire sits on top of the mine shafts; the wilds open off the red fork.
  link('hearthfire', 'mines');
  link('fork-wilds', 'red-wilds');
  return nodes;
}

export function nodeAt(world: WorldMap, id: string): WorldNode {
  const node = world.get(id);
  if (!node) throw new Error(`Unknown world node "${id}".`);
  return node;
}

/** Whether a step from `fromId` to `toId` is a legal single move. */
export function canTravel(world: WorldMap, fromId: string, toId: string): boolean {
  return nodeAt(world, fromId).links.includes(toId);
}

// -----------------------------------------------------------------------------
//  ENCOUNTERS
// -----------------------------------------------------------------------------

export type PathEncounter = 'robbery' | 'monsters' | 'event' | 'nothing';

/**
 * What waits on a stretch of road. Authored odds: robbery and monsters a fifth
 * each, an event a tenth, and half the time the road is simply empty.
 */
export const PATH_ENCOUNTER_ODDS: readonly { kind: PathEncounter; weight: number }[] = [
  { kind: 'robbery', weight: 0.2 },
  { kind: 'monsters', weight: 0.2 },
  { kind: 'event', weight: 0.1 },
  { kind: 'nothing', weight: 0.5 },
];

/** Roll a road's encounter. `roll` is a float in [0, 1). */
export function rollPathEncounter(roll: number): PathEncounter {
  let remaining = roll;
  for (const entry of PATH_ENCOUNTER_ODDS) {
    remaining -= entry.weight;
    if (remaining < 0) return entry.kind;
  }
  return 'nothing';
}
