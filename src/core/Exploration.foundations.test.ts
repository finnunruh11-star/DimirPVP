import { FIELD, RANGE_UNIT } from '../config/constants';
import { FLEE_EDGE_MARGIN, fleeEdgeAt } from './Flee';
import { getItem, ITEM_DEFS, itemsOfRarity, RARITY_ORDER } from './Items';
import { MINE_ORE_DEFS, resolveMineOre } from '../pve/mineMaze';
import { MINE_SPAWN_KINDS, OVERWORLD_SPAWN_KINDS, rollMineLoot } from '../pve/minerun';
import { Dice } from './Dice';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(actualJson === expectedJson, `${label}: expected ${expectedJson}, received ${actualJson}`);
}

const centre = { x: FIELD.x + FIELD.w / 2, y: FIELD.y + FIELD.h / 2 };

const tests: [name: string, run: () => void][] = [
  ['names the border a body is pressed against', () => {
    equal(fleeEdgeAt({ x: FIELD.x + 1, y: centre.y }), 'west', 'west edge');
    equal(fleeEdgeAt({ x: FIELD.x + FIELD.w - 1, y: centre.y }), 'east', 'east edge');
    equal(fleeEdgeAt({ x: centre.x, y: FIELD.y + 1 }), 'north', 'north edge');
    equal(fleeEdgeAt({ x: centre.x, y: FIELD.y + FIELD.h - 1 }), 'south', 'south edge');
  }],

  ['refuses to let a body in the open slip away', () => {
    equal(fleeEdgeAt(centre), null, 'field centre offers no border');
  }],

  ['takes the nearest border when a body stands in a corner', () => {
    // The field is far wider than it is tall, so a corner is always nearer a
    // horizontal border than a vertical one.
    equal(fleeEdgeAt({ x: FIELD.x + 2, y: FIELD.y + 1 }), 'north', 'north-west corner');
  }],

  ['honours the margin exactly', () => {
    const inside = { x: FIELD.x + FLEE_EDGE_MARGIN, y: centre.y };
    const outside = { x: FIELD.x + FLEE_EDGE_MARGIN + 1, y: centre.y };
    equal(fleeEdgeAt(inside), 'west', 'a body exactly on the margin may leave');
    equal(fleeEdgeAt(outside), null, 'a body one pixel past it may not');
    assert(FLEE_EDGE_MARGIN === RANGE_UNIT * 2, 'margin is two range units');
  }],

  ['keeps materials out of every draft and shop pool', () => {
    const materials = ITEM_DEFS.filter((d) => d.material);
    assert(materials.length >= 14, 'the material catalogue is populated');
    for (const rarity of RARITY_ORDER) {
      const offered = itemsOfRarity(rarity, true).filter((d) => d.material);
      equal(offered.length, 0, `no material is offered at rarity ${rarity}`);
    }
  }],

  ['gives every material real weight and a sale value', () => {
    for (const def of ITEM_DEFS.filter((d) => d.material)) {
      assert(def.weight > 0, `${def.id} weighs something`);
      assert(def.cost > 0, `${def.id} is worth something`);
      equal(def.slot, 'utility', `${def.id} is cargo, not equipment`);
    }
  }],

  ['hauls one ore item per extracted vein instead of paying gold', () => {
    const rng = new Dice(7);
    const result = resolveMineOre('iron', 3, [10], rng);
    equal(result.materials.length, result.extracted, 'one item per extracted vein');
    for (const id of result.materials) {
      equal(id, MINE_ORE_DEFS.iron.item, 'the haul is iron ore');
      assert(getItem(id).material, 'the haul is a material');
    }
  }],

  ['drops salvage as carried items, never as folded-in gold', () => {
    const rng = new Dice(3);
    let seen = 0;
    for (let i = 0; i < 200; i++) {
      const loot = rollMineLoot('magma-sentinel', rng);
      equal(loot.gold, 4.5, 'base gold never absorbs the salvage value');
      for (const id of loot.materials) {
        equal(id, 'magmaCore', 'a magma sentinel yields a magma core');
        seen += 1;
      }
    }
    assert(seen > 0, 'salvage drops at least sometimes');
  }],

  ['keeps sentinels and dragonborn out of the tunnels', () => {
    for (const kind of ['sentinel', 'magma-sentinel', 'red-dragonborn', 'black-dragonborn'] as const) {
      assert(!MINE_SPAWN_KINDS.includes(kind), `${kind} no longer spawns in the mines`);
      assert(OVERWORLD_SPAWN_KINDS.includes(kind), `${kind} spawns on the surface`);
    }
  }],

  ['keeps kobolds in both rosters', () => {
    for (const kind of ['kobold', 'elite-kobold'] as const) {
      assert(MINE_SPAWN_KINDS.includes(kind), `${kind} still spawns in the mines`);
      assert(OVERWORLD_SPAWN_KINDS.includes(kind), `${kind} also spawns on the surface`);
    }
  }],
];

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration foundations: ${tests.length} checks passed.`);
