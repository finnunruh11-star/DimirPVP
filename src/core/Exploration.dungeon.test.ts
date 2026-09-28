import { Dice } from '../core/Dice';
import { Mage } from '../core/Mage';
import { dungeonCombat, DUNGEON_REFIGHT, DUNGEONS } from '../pve/exploration/dungeons';
import { shopStock } from '../pve/exploration/economy';
import { creaturePower, rollForestWave, spawnKindId } from '../pve/exploration/encounters';
import { capturePartySnapshot } from '../pve/exploration/party';
import { enterMines, mineCycle, minePassageDice, spendMineHours } from '../pve/exploration/mines';
import { createRun } from '../pve/exploration/run';
import { parseRun } from '../pve/exploration/save';
import { shopById } from '../pve/exploration/shops';
import { PLACES, placeById } from '../pve/exploration/world';
import { createMineMaze, currentMineNode, MINE_DIRECTIONS, MINE_DIRECTION_VECTOR, MINE_OPPOSITE_DIRECTION, mineRoomNeedsInteraction, travelMineMaze } from '../pve/mineMaze';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}: expected ${e}, received ${a}`);
}

/** Wander a maze for `steps` tunnels and list every room kind met. */
function roomsMet(shops: boolean, seed: number, steps: number): string[] {
  const rng = new Dice(seed);
  const maze = createMineMaze(rng, { shops });
  const kinds: string[] = [];
  for (let step = 0; step < steps; step++) {
    const node = currentMineNode(maze);
    const exits = MINE_DIRECTIONS.filter((d) => Object.prototype.hasOwnProperty.call(node.exits, d));
    const { node: next } = travelMineMaze(maze, exits[rng.die(exits.length) - 1], rng);
    if (next.room) kinds.push(next.room.kind);
  }
  return kinds;
}

const tests: [name: string, run: () => void][] = [
  ['opens the Swamps, the Mines and the Small Forest as dungeons, with nothing sold inside', () => {
    equal(
      ['swamps', 'mines', 'small-forest'].map((id) => placeById(id)?.dungeon),
      ['swamps', 'mines', 'forest'],
      'each gate leads into its dungeon',
    );
    assert(PLACES.filter((p) => p.dungeon).every((p) => !p.note && !p.locale), 'none is closed, none is a walkable map');
    for (const def of Object.values(DUNGEONS)) assert(/No (rest or )?shops?/.test(def.warning), `${def.name} warns there is no shop`);
    equal(DUNGEON_REFIGHT, 0.05, 'the way back refights one depth in twenty');
  }],

  ['starts a dive at depth 1 and brings the party out where it went in', () => {
    const mage = new Mage({ name: 'Walker', isAI: false, team: 1, position: { x: 0, y: 0 }, loadout: [] });
    const run = createRun(4, capturePartySnapshot([mage]));
    const back = { id: 'world', x: 514, y: 126 };
    const combat = dungeonCombat(run, 'swamps', back);
    equal(
      [combat.dungeon, combat.depth, combat.zone, combat.encounter, combat.returnTo, combat.fleeTo],
      ['swamps', 1, 'black', 'monsters', back, back],
      'the swamp dive',
    );
    equal([dungeonCombat(run, 'mines').returnTo, dungeonCombat(run, 'forest').zone], [undefined, 'forest'], 'from the travel map it has nowhere else to go');
  }],

  ['digs the Mines without supply rooms for an Exploration party', () => {
    for (let seed = 1; seed <= 20; seed++) {
      assert(!roomsMet(false, seed, 150).includes('shop'), `seed ${seed}: no supply room`);
    }
    assert(Array.from({ length: 20 }, (_, i) => roomsMet(true, i + 1, 150)).some((kinds) => kinds.includes('shop')), 'the Mine Run itself still has them');
  }],

  ['keeps every mine passage adjacent, reciprocal, and clear of crossed tunnels', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rng = new Dice(seed);
      const maze = createMineMaze(rng, { shops: false });
      for (let step = 0; step < 150; step++) {
        const frontier = Object.values(maze.nodes).flatMap((node) => MINE_DIRECTIONS
          .filter((direction) => node.exits[direction] === null)
          .map((direction) => ({ node, direction })));
        if (!frontier.length) break;
        const choice = frontier[rng.die(frontier.length) - 1];
        maze.currentNodeId = choice.node.id;
        travelMineMaze(maze, choice.direction, rng);
        const positions = new Set<string>();
        const diagonals = new Set<string>();
        for (const node of Object.values(maze.nodes)) {
          const position = `${node.mapX},${node.mapY}`;
          assert(!positions.has(position), `seed ${seed}: unique coordinate ${position}`);
          positions.add(position);
          for (const direction of MINE_DIRECTIONS) {
            const destId = node.exits[direction];
            if (destId == null) continue;
            const target = maze.nodes[destId];
            const vector = MINE_DIRECTION_VECTOR[direction];
            assert(target && target.mapX === node.mapX + vector.x && target.mapY === node.mapY + vector.y,
              `seed ${seed}: ${node.id} ${direction} is adjacent`);
            assert(target.exits[MINE_OPPOSITE_DIRECTION[direction]] === node.id, `seed ${seed}: way back from ${target.id}`);
            if (vector.x && vector.y) {
              const crossing = `${node.mapX + target.mapX},${node.mapY + target.mapY}`;
              if (node.id < target.id) {
                assert(!diagonals.has(crossing), `seed ${seed}: no diagonal crossing at ${crossing}`);
                diagonals.add(crossing);
              }
            }
          }
        }
      }
    }
  }],

  ['offers rare alternate ways out only after exploring beyond the entrance', () => {
    let exits = 0;
    let rooms = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const rng = new Dice(seed * 113);
      const maze = createMineMaze(rng, { shops: false });
      for (let step = 0; step < 160; step++) {
        const frontier = Object.values(maze.nodes).flatMap((node) => MINE_DIRECTIONS
          .filter((direction) => node.exits[direction] === null).map((direction) => ({ node, direction })));
        if (!frontier.length) break;
        const choice = frontier[rng.die(frontier.length) - 1];
        maze.currentNodeId = choice.node.id;
        travelMineMaze(maze, choice.direction, rng);
      }
      for (const node of Object.values(maze.nodes)) {
        if (node.escape) {
          assert(node.id >= 10 && node.kind === 'crossroad', `seed ${seed}: no exit right next to the entrance`);
          exits++;
        }
        rooms++;
      }
    }
    assert(exits >= 2, `multiple side exits turn up across mines (${exits})`);
    assert(exits < rooms * 0.08, `side exits remain rare (${exits}/${rooms})`);
    const soloRng = new Dice(73);
    const standalone = createMineMaze(soloRng, { shops: true });
    for (let step = 0; step < 80; step++) {
      const available = MINE_DIRECTIONS.filter((direction) =>
        Object.prototype.hasOwnProperty.call(currentMineNode(standalone).exits, direction));
      if (!available.length) break;
      travelMineMaze(standalone, available[soloRng.die(available.length) - 1], soloRng);
    }
    assert(Object.values(standalone.nodes).every((node) => !node.escape), 'standalone Mine Run has no escape portals');
  }],

  ['keeps the same excavated mine through re-entry, reload and death, with spent traps shared', () => {
    const mage = new Mage({ name: 'Miner', isAI: false, team: 1, position: { x: 0, y: 0 }, loadout: [] });
    const run = createRun(128, capturePartySnapshot([mage]));
    const maze = enterMines(run);
    const firstDirection = MINE_DIRECTIONS.find((direction) => maze.nodes[0].exits[direction] === null)!;
    maze.nodes[0].traps[firstDirection] = { damage: '1d3', triggered: false };
    const first = travelMineMaze(maze, firstDirection, minePassageDice(run, 0, firstDirection));
    assert(first.trap === '1d3', 'the trap fires on the first crossing');
    const room = first.node.room;
    if (room) {
      room.entered = true;
      room.resolved = true;
      room.oreAmount = room.kind === 'ore' ? 0 : undefined;
    }
    const nodeCount = Object.keys(maze.nodes).length;
    const copy = parseRun(JSON.stringify(run));
    assert(copy?.mines, 'the snapshot survives a save');
    equal(copy.mines.cycle, 0, 'the first mine cycle');
    equal(copy.mines.maze.nodes[first.node.id].room, room, 'cleared/harvested rooms remain cleared');
    const reverse = MINE_OPPOSITE_DIRECTION[firstDirection];
    equal(copy.mines.maze.nodes[first.node.id].traps[reverse], { damage: '1d3', triggered: true }, 'the reverse passage is spent');
    copy.mines.maze.currentNodeId = first.node.id;
    const returned = travelMineMaze(copy.mines.maze, reverse, minePassageDice(copy, first.node.id, reverse));
    equal(returned.trap, null, 'crossing back cannot retrigger the trap');
    const same = enterMines(copy);
    equal(same.currentNodeId, 0, 'every visit begins at the entrance');
    equal(Object.keys(same.nodes).length, nodeCount, 'a death or exit does not refill the mine');
    equal(same.nodes[first.node.id].room, room, 'the emptied room remains empty');
    same.nodes[first.node.id].kind = 'room';
    const deposit = { kind: 'ore' as const, oreKind: 'iron' as const, oreAmount: 2, entered: true, resolved: false };
    same.nodes[first.node.id].room = deposit;
    const partial = parseRun(JSON.stringify(copy));
    equal(partial?.mines?.maze.nodes[first.node.id].room?.oreAmount, 2, 'half-mined ore stays for the next visit');
    deposit.oreAmount = 0;
    deposit.resolved = true;
    equal(parseRun(JSON.stringify(copy))?.mines?.maze.nodes[first.node.id].room?.resolved, true, 'fully mined ore stays empty');
    copy.day = 4;
    assert(enterMines(copy) === same, 'day 4 keeps the same maze');
    copy.day = 5;
    const reset = enterMines(copy);
    assert(reset !== same && Object.keys(reset.nodes).length === 1, 'the first bloodmoon reshuffles and replenishes');
    copy.day = 14;
    assert(enterMines(copy) === reset, 'day 14 keeps the bloodmoon maze');
    copy.day = 15;
    assert(enterMines(copy) !== reset, 'day 15 reshuffles again');
  }],

  ['counts bloodmoons only on days 5, 15, 25 and crushes a party that crosses one underground', () => {
    equal([1, 4, 5, 14, 15, 24, 25, 45].map(mineCycle), [0, 0, 1, 1, 2, 2, 3, 5], 'bloodmoon cycles');
    const mage = new Mage({ name: 'Miner', isAI: false, team: 1, position: { x: 0, y: 0 }, loadout: [] });
    const run = createRun(6, capturePartySnapshot([mage]));
    enterMines(run);
    run.day = 4;
    run.hour = 23.75;
    assert(spendMineHours(run, 0.5), 'walking into day 5 triggers the collapse');
    equal([run.day, run.hour], [5, 0.25], 'the clock crossed midnight');
    assert(!spendMineHours(run, 0.5), 'the following hour is not a second collapse');
    run.day = 14;
    run.hour = 23.5;
    assert(spendMineHours(run, 1), 'day 15 also crushes a party still below');
  }],

  ['keeps mined-out ore and cleared enemy rooms quiet, but allows unfinished deposits', () => {
    assert(!mineRoomNeedsInteraction({ kind: 'enemies', entered: true, resolved: true }), 'cleared enemies do not return');
    assert(!mineRoomNeedsInteraction({ kind: 'treasure', entered: true, resolved: true }), 'an opened chest stays empty');
    assert(!mineRoomNeedsInteraction({ kind: 'ore', entered: true, resolved: true, oreAmount: 0 }), 'exhausted ore is empty');
    assert(mineRoomNeedsInteraction({ kind: 'ore', entered: true, resolved: false, oreAmount: 2 }), 'remaining ore can be mined');
  }],

  ['rejects corrupt or oversized stored mine maps without losing the run', () => {
    const mage = new Mage({ name: 'Miner', isAI: false, team: 1, position: { x: 0, y: 0 }, loadout: [] });
    const run = createRun(13, capturePartySnapshot([mage]));
    enterMines(run);
    const old = JSON.parse(JSON.stringify(run));
    delete old.mines;
    equal(parseRun(JSON.stringify(old))?.mines, null, 'an older save starts a fresh mine');
    const broken = JSON.parse(JSON.stringify(run));
    broken.mines.maze.nodes[1] = { ...broken.mines.maze.nodes[0], id: 1, mapX: 0, mapY: 0 };
    equal(parseRun(JSON.stringify(broken))?.mines, null, 'duplicate locations are refused');
    assert(parseRun(JSON.stringify(broken)), 'the rest of the run still loads');
    const excess = JSON.parse(JSON.stringify(run));
    for (let index = 1; index < 520; index++) excess.mines.maze.nodes[index] = { id: index };
    equal(parseRun(JSON.stringify(excess))?.mines, null, 'oversized graphs are refused');
  }],

  ['fields fiercer beasts deeper into the Small Forest', () => {
    const power = (depth: number): number => {
      let total = 0;
      for (let seed = 1; seed <= 60; seed++) {
        total += rollForestWave(depth, new Dice(seed * 7 + depth)).reduce((sum, spawn) => sum + creaturePower(spawnKindId(spawn)), 0);
      }
      return total / 60;
    };
    const shallow = power(1);
    const deep = power(8);
    assert(deep > shallow * 2, `depth 8 is far harder than depth 1 (${deep.toFixed(1)} vs ${shallow.toFixed(1)})`);
  }],

  ['sells pickaxes where miners shop', () => {
    const mage = new Mage({ name: 'Walker', isAI: false, team: 1, position: { x: 0, y: 0 }, loadout: [] });
    const run = createRun(4, capturePartySnapshot([mage]));
    for (const id of ['hearthfire-forge', 'capitol-forge', 'pennybruck-supply']) {
      const shop = shopById(id);
      assert(shop && shopStock(run, shop).some((slot) => slot.id === 'pickaxe'), `${id} sells pickaxes`);
    }
  }],
];

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration dungeons: ${tests.length} checks passed.`);
