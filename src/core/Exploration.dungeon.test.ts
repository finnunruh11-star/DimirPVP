import { Dice } from '../core/Dice';
import { Mage } from '../core/Mage';
import { dungeonCombat, DUNGEON_REFIGHT, DUNGEONS } from '../pve/exploration/dungeons';
import { shopStock } from '../pve/exploration/economy';
import { creaturePower, rollForestWave, spawnKindId } from '../pve/exploration/encounters';
import { capturePartySnapshot } from '../pve/exploration/party';
import { enterMines, mineCycle, minePassageDice, mineSeed, spendMineHours } from '../pve/exploration/mines';
import { createRun } from '../pve/exploration/run';
import { parseRun } from '../pve/exploration/save';
import { shopById } from '../pve/exploration/shops';
import { PLACES, placeById } from '../pve/exploration/world';
import {
  MINE_TUNNEL_LONGEST,
  MINE_TUNNEL_SHORTEST,
  mineGap,
  mineNodePoint,
  mineTunnelHours,
  mineTunnelLength,
} from '../pve/mineLayout';
import { createMineMaze, currentMineNode, MINE_DIRECTIONS, MINE_DIRECTION_VECTOR, MINE_OPPOSITE_DIRECTION, mineRoomNeedsInteraction, mineTrapHarm, travelMineMaze } from '../pve/mineMaze';

type Pt = { x: number; y: number };

function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Do segments ab and cd cross at a point inside both? */
function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const side = (o: Pt, p: Pt, q: Pt): number => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = side(c, d, a);
  const d2 = side(c, d, b);
  const d3 = side(a, b, c);
  const d4 = side(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

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

  ['stretches mine tunnels from a third to twice a standard tunnel, keeping every passage clear', () => {
    const gaps: number[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      for (let index = -40; index < 40; index++) gaps.push(mineGap(seed * 7919, 'x', index), mineGap(seed * 7919, 'y', index));
    }
    assert(gaps.every((gap) => gap >= MINE_TUNNEL_SHORTEST - 1e-9 && gap <= MINE_TUNNEL_LONGEST + 1e-9), 'every gap lies between a third and twice');
    assert(Math.min(...gaps) < 0.4 && Math.max(...gaps) > 1.9, `the whole range turns up (${Math.min(...gaps).toFixed(2)}-${Math.max(...gaps).toFixed(2)})`);
    const short = gaps.filter((gap) => gap < 0.75).length / gaps.length;
    const long = gaps.filter((gap) => gap > 1.4).length / gaps.length;
    assert(short > 0.2 && long > 0.2, `short and long tunnels are both common (${short.toFixed(2)} / ${long.toFixed(2)})`);
    equal([mineGap(undefined, 'x', 3), mineTunnelHours({}, { mapX: 2, mapY: -1 }, 'NE')], [1, 0.05], 'a mine without a layout keeps standard tunnels');
    for (let seed = 1; seed <= 20; seed++) {
      const rng = new Dice(seed);
      const maze = createMineMaze(rng, { shops: false, layoutSeed: seed * 104729 });
      for (let step = 0; step < 120; step++) {
        const frontier = Object.values(maze.nodes).flatMap((node) => MINE_DIRECTIONS
          .filter((direction) => node.exits[direction] === null).map((direction) => ({ node, direction })));
        if (!frontier.length) break;
        const choice = frontier[rng.die(frontier.length) - 1];
        maze.currentNodeId = choice.node.id;
        travelMineMaze(maze, choice.direction, rng);
      }
      const tunnels: [Pt, Pt, number, number][] = [];
      for (const node of Object.values(maze.nodes)) {
        for (const direction of MINE_DIRECTIONS) {
          if (!Object.prototype.hasOwnProperty.call(node.exits, direction)) continue;
          const length = mineTunnelLength(maze, node, direction);
          assert(length >= MINE_TUNNEL_SHORTEST - 1e-9 && length <= MINE_TUNNEL_LONGEST + 1e-9, `seed ${seed}: ${length} is a third to twice`);
          const minutes = mineTunnelHours(maze, node, direction) * 60;
          assert(minutes >= 1 - 1e-9 && minutes <= 6 + 1e-9 && Math.abs(minutes - Math.round(minutes)) < 1e-9,
            `seed ${seed}: ${minutes} min is 1 to 6 whole minutes`);
          const id = node.exits[direction];
          if (id == null) continue;
          const target = maze.nodes[id];
          equal(mineTunnelLength(maze, target, MINE_OPPOSITE_DIRECTION[direction]).toFixed(9), length.toFixed(9), `seed ${seed}: as long walked back`);
          if (node.id < id) tunnels.push([mineNodePoint(maze, node.mapX, node.mapY), mineNodePoint(maze, target.mapX, target.mapY), node.id, id]);
        }
      }
      const junctions = Object.values(maze.nodes).map((node) => ({ id: node.id, ...mineNodePoint(maze, node.mapX, node.mapY) }));
      for (const [a, b, from, to] of tunnels) {
        for (const junction of junctions) {
          if (junction.id === from || junction.id === to) continue;
          assert(distanceToSegment(junction, a, b) >= 0.2, `seed ${seed}: tunnel ${from}-${to} keeps clear of junction ${junction.id}`);
        }
      }
      for (let i = 0; i < tunnels.length; i++) {
        for (let j = i + 1; j < tunnels.length; j++) {
          const [a, b, f1, t1] = tunnels[i];
          const [c, d, f2, t2] = tunnels[j];
          if (f1 === f2 || f1 === t2 || t1 === f2 || t1 === t2) continue;
          assert(!segmentsCross(a, b, c, d), `seed ${seed}: tunnels ${f1}-${t1} and ${f2}-${t2} do not cross`);
        }
      }
    }
  }],

  ['keeps a mine\'s tunnel lengths through a save, and gives older mines lengths of their own', () => {
    const mage = new Mage({ name: 'Miner', isAI: false, team: 1, position: { x: 0, y: 0 }, loadout: [] });
    const run = createRun(77, capturePartySnapshot([mage]));
    const maze = enterMines(run);
    equal(maze.layoutSeed, mineSeed(run.seed, mineCycle(run.day), 0, 'layout'), 'drawn from the run and its bloodmoon cycle');
    equal(parseRun(JSON.stringify(run))?.mines?.maze.layoutSeed, maze.layoutSeed, 'a save keeps them');
    const old = JSON.parse(JSON.stringify(run));
    delete old.mines.maze.layoutSeed;
    const older = parseRun(JSON.stringify(old));
    assert(older?.mines && older.mines.maze.layoutSeed === undefined, 'a mine saved before lengths varied has none');
    equal(enterMines(older).layoutSeed, maze.layoutSeed, 'and gets the same ones on the way in');
    const later = createRun(77, capturePartySnapshot([mage]));
    later.day = 5;
    assert(enterMines(later).layoutSeed !== maze.layoutSeed, 'the next bloodmoon reshapes them too');
  }],

  ['spends about half an hour on ten tunnels', () => {
    let minutes = 0;
    let tunnels = 0;
    for (let seed = 1; seed <= 10; seed++) {
      for (let x = -5; x < 5; x++) {
        for (const direction of MINE_DIRECTIONS) {
          minutes += mineTunnelHours({ layoutSeed: seed * 31 }, { mapX: x, mapY: x * 2 }, direction) * 60;
          tunnels += 1;
        }
      }
    }
    const perTen = (minutes / tunnels) * 10;
    assert(perTen > 25 && perTen < 40, `ten tunnels take ${perTen.toFixed(1)} minutes`);
  }],

  ['sets traps in about a tenth of the passages', () => {
    let passages = 0;
    let trapped = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const rng = new Dice(seed * 17);
      const maze = createMineMaze(rng, { shops: false });
      for (let step = 0; step < 150; step++) {
        const frontier = Object.values(maze.nodes).flatMap((node) => MINE_DIRECTIONS
          .filter((direction) => node.exits[direction] === null).map((direction) => ({ node, direction })));
        if (!frontier.length) break;
        const choice = frontier[rng.die(frontier.length) - 1];
        maze.currentNodeId = choice.node.id;
        travelMineMaze(maze, choice.direction, rng);
      }
      for (const node of Object.values(maze.nodes)) {
        for (const direction of MINE_DIRECTIONS) {
          if (!Object.prototype.hasOwnProperty.call(node.exits, direction)) continue;
          const id = node.exits[direction];
          if (id != null && id < node.id) continue;
          passages += 1;
          if (node.traps[direction] || (id != null && maze.nodes[id].traps[MINE_OPPOSITE_DIRECTION[direction]])) trapped += 1;
        }
      }
    }
    const share = trapped / passages;
    assert(share > 0.06 && share < 0.15, `${(share * 100).toFixed(1)}% of ${passages} passages are trapped`);
  }],

  ['lets a trap leave someone at full health on 1 HP, but kill anyone already hurt', () => {
    equal(mineTrapHarm(4, 10, 10), { dealt: 4, fatal: false, clung: false }, 'a blow they survive lands in full');
    equal(mineTrapHarm(17, 10, 10), { dealt: 9, fatal: false, clung: true }, 'at full health a killing blow leaves 1 HP');
    equal(mineTrapHarm(10, 10, 10), { dealt: 9, fatal: false, clung: true }, 'so does an exact one');
    equal(mineTrapHarm(17, 9, 10), { dealt: 9, fatal: true, clung: false }, 'one point short of full, it kills');
    equal(mineTrapHarm(3, 1, 1), { dealt: 1, fatal: true, clung: false }, 'with 1 HP to begin with there is nothing to cling to');
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
