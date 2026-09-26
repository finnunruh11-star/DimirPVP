import { Dice } from '../core/Dice';
import { Mage } from '../core/Mage';
import { dungeonCombat, DUNGEON_REFIGHT, DUNGEONS } from '../pve/exploration/dungeons';
import { shopStock } from '../pve/exploration/economy';
import { creaturePower, rollForestWave, spawnKindId } from '../pve/exploration/encounters';
import { capturePartySnapshot } from '../pve/exploration/party';
import { createRun } from '../pve/exploration/run';
import { shopById } from '../pve/exploration/shops';
import { PLACES, placeById } from '../pve/exploration/world';
import { createMineMaze, currentMineNode, MINE_DIRECTIONS, travelMineMaze } from '../pve/mineMaze';

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
