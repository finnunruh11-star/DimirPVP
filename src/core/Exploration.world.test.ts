import { Dice } from '../core/Dice';
import {
  START_NODE,
  canTravel,
  createWorld,
  nodeAt,
  rollPathEncounter,
  type PathEncounter,
  type WorldMap,
} from '../pve/exploration/world';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(actualJson === expectedJson, `${label}: expected ${expectedJson}, received ${actualJson}`);
}

/** Shortest number of steps between two nodes, or -1 when unreachable. */
function distance(world: WorldMap, fromId: string, toId: string): number {
  const seen = new Set([fromId]);
  let frontier = [fromId];
  let steps = 0;
  while (frontier.length) {
    if (frontier.includes(toId)) return steps;
    const next: string[] = [];
    for (const id of frontier) {
      for (const link of nodeAt(world, id).links) {
        if (seen.has(link)) continue;
        seen.add(link);
        next.push(link);
      }
    }
    frontier = next;
    steps += 1;
  }
  return -1;
}

const tests: [name: string, run: () => void][] = [
  ['starts a run in the Capitol', () => {
    const world = createWorld();
    equal(nodeAt(world, START_NODE).kind, 'city', 'the start is a city');
    equal(nodeAt(world, START_NODE).name, 'The Capitol', 'the start is the Capitol');
  }],

  ['lays every road at its authored length', () => {
    const world = createWorld();
    // A road of N path nodes puts its two ends N+1 steps apart.
    equal(distance(world, 'capitol', 'kerusai'), 11, 'Capitol to Kerusai across 10 path nodes');
    equal(distance(world, 'kerusai', 'swamps'), 2, 'Kerusai to the Swamps across 1 path node');
    equal(distance(world, 'kerusai', 'fork-forest'), 3, 'Kerusai to the forest fork across 2');
    equal(distance(world, 'fork-forest', 'fork-wilds'), 7, 'the forest fork to the red fork across 6');
    equal(distance(world, 'fork-wilds', 'hearthfire'), 3, 'the red fork to Hearthfire across 2');
    equal(distance(world, 'hearthfire', 'capitol'), 8, 'Hearthfire to the Capitol across 7');
  }],

  ['hangs the dungeons and the wilds off the right places', () => {
    const world = createWorld();
    assert(canTravel(world, 'hearthfire', 'mines'), 'the mines open off Hearthfire');
    assert(canTravel(world, 'fork-wilds', 'red-wilds'), 'the wilds open off the red fork');
    equal(nodeAt(world, 'mines').dungeon, 'mines', 'the mine mouth names its dungeon');
    equal(nodeAt(world, 'swamps').dungeon, 'swamps', 'the swamp mouth names its dungeon');
  }],

  ['closes the loop, so every node is reachable from the start', () => {
    const world = createWorld();
    for (const id of world.keys()) {
      assert(distance(world, START_NODE, id) >= 0, `${id} is reachable from the Capitol`);
    }
  }],

  ['keeps every link reciprocal', () => {
    const world = createWorld();
    for (const node of world.values()) {
      for (const link of node.links) {
        assert(
          nodeAt(world, link).links.includes(node.id),
          `${link} links back to ${node.id}`
        );
      }
    }
  }],

  ['deepens each road as it runs', () => {
    const world = createWorld();
    const road = [...world.values()]
      .filter((n) => n.id.startsWith('road-fork-redfork-'))
      .sort((a, b) => a.depth - b.depth);
    equal(road.length, 6, 'the Ashen Way has six stretches');
    for (let i = 1; i < road.length; i++) {
      assert(road[i].depth === road[i - 1].depth + 1, 'each stretch is one deeper than the last');
    }
  }],

  ['only roads roll for encounters', () => {
    const world = createWorld();
    const kinds = new Set([...world.values()].map((n) => n.kind));
    for (const kind of ['city', 'path', 'dungeon', 'wilderness', 'wip']) {
      assert(kinds.has(kind as never), `the map uses its ${kind} nodes`);
    }
  }],

  ['rolls road encounters at the authored odds', () => {
    const rng = new Dice(11);
    const seen: Record<PathEncounter, number> = { robbery: 0, monsters: 0, event: 0, nothing: 0 };
    const runs = 20000;
    for (let i = 0; i < runs; i++) seen[rollPathEncounter(rng.float())] += 1;
    const near = (actual: number, expected: number, label: string): void => {
      const share = actual / runs;
      assert(
        Math.abs(share - expected) < 0.02,
        `${label}: expected about ${expected}, saw ${share.toFixed(3)}`
      );
    };
    near(seen.robbery, 0.2, 'robbery');
    near(seen.monsters, 0.2, 'monsters');
    near(seen.event, 0.1, 'event');
    near(seen.nothing, 0.5, 'quiet road');
  }],

  ['maps the ends of the roll to the ends of the table', () => {
    equal(rollPathEncounter(0), 'robbery', 'a zero roll robs you');
    equal(rollPathEncounter(0.999999), 'nothing', 'a top roll leaves the road quiet');
  }],
];

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration world: ${tests.length} checks passed.`);
