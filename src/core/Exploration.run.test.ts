import { Mage } from '../core/Mage';
import { advanceHours, clockLabel, isNight, sleepUntilMorning } from '../pve/exploration/clock';
import { isExplored, packExplored, revealTiles, unpackExplored } from '../pve/exploration/explored';
import { capturePartySnapshot, restoreParty } from '../pve/exploration/party';
import { createRun, hasFlag, stepDice, type ExplorationRun } from '../pve/exploration/run';
import { parseRun } from '../pve/exploration/save';
import { placeById } from '../pve/exploration/world';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(actualJson === expectedJson, `${label}: expected ${expectedJson}, received ${actualJson}`);
}

function party(): Mage[] {
  const m = new Mage({
    name: 'Wanderer',
    isAI: false,
    team: 1,
    position: { x: 200, y: 200 },
    loadout: [],
  });
  m.maxHp = 40;
  m.hp = 31;
  return [m];
}

function freshRun(seed = 5): ExplorationRun {
  return createRun(seed, capturePartySnapshot(party()));
}

/** A save as version 2 wrote it: standing on a graph node, no clock. */
function legacy(run: ExplorationRun, nodeId: string): string {
  const old = JSON.parse(JSON.stringify(run)) as Record<string, unknown>;
  old.version = 2;
  old.nodeId = nodeId;
  for (const key of ['pos', 'hour', 'explored', 'searched']) delete old[key];
  return JSON.stringify(old);
}

const capitol = placeById('capitol')!;

const tests: [name: string, run: () => void][] = [
  ['starts on the Capitol at eight in the morning with its streets explored', () => {
    const run = freshRun();
    equal(run.pos, { x: capitol.x, y: capitol.y }, 'on the Capitol tile');
    equal([run.day, run.hour], [1, 8], 'day one, eight o\'clock');
    equal([run.gold, run.steps], [0, 0], 'broke and yet to take a step');
    const mask = unpackExplored(run.explored);
    assert(isExplored(mask, capitol.x + 3, capitol.y), 'the country round the Capitol is known');
    assert(!isExplored(mask, capitol.x + 20, capitol.y), 'the far country is not');
  }],

  ['replays the same rolls for the same seed and step', () => {
    const a = freshRun(1234);
    const b = freshRun(1234);
    const c = freshRun(9999);
    equal(stepDice(a, 7).float(), stepDice(b, 7).float(), 'same seed and step, same roll');
    assert(stepDice(a, 7).float() !== stepDice(c, 7).float(), 'a different seed rolls differently');
    assert(stepDice(a, 7).float() !== stepDice(a, 8).float(), 'a different step rolls differently');
  }],

  ['keeps time: hours roll into days, nights fall, sleep ends at seven', () => {
    const clock = { day: 1, hour: 22 };
    assert(isNight(clock.hour), 'ten at night is night');
    equal(advanceHours(clock, 5), 1, 'one midnight passed');
    equal([clock.day, clock.hour], [2, 3], 'three in the morning of day two');
    sleepUntilMorning(clock);
    equal([clock.day, clock.hour], [2, 7], 'a pre-dawn sleep ends the same day');
    clock.hour = 15;
    sleepUntilMorning(clock);
    equal([clock.day, clock.hour], [3, 7], 'an afternoon nap ends the next morning');
    equal(clockLabel({ day: 3, hour: 21.6 }), 'Day 3, 21:30 (night)', 'the clock rounds to the quarter hour');
  }],

  ['packs explored tiles six to a character', () => {
    const mask = unpackExplored('');
    const fresh = revealTiles(mask, [{ x: 10, y: 10 }], 2);
    assert(fresh > 9, 'a radius reveals a patch');
    equal(revealTiles(mask, [{ x: 10, y: 10 }], 2), 0, 'revealing twice finds nothing new');
    const copy = unpackExplored(packExplored(mask));
    assert(copy.every((bit, i) => bit === mask[i]), 'packing round-trips');
  }],

  ['carries the party through a snapshot intact', () => {
    const original = party();
    original[0].hp = 17;
    original[0].bag.push('oreIron', 'oreIron', 'magmaCore');
    const restored = restoreParty(capturePartySnapshot(original));
    equal(restored.length, 1, 'the roster survives');
    equal(restored[0].hp, 17, 'wounds survive');
    equal(restored[0].bag.filter((id) => id === 'oreIron').length, 2, 'stacked materials survive');
  }],

  ['round-trips a whole run through the save format', () => {
    const run = freshRun(77);
    run.pos = { x: capitol.x + 3, y: capitol.y + 1 };
    run.hour = 13.5;
    run.gold = 9;
    run.flags.push('hearthfire:visited');
    const copy = parseRun(JSON.stringify(run));
    assert(copy, 'the save loads');
    equal([copy.pos, copy.hour, copy.gold], [run.pos, 13.5, 9], 'position, clock and gold survive');
    assert(hasFlag(copy, 'hearthfire:visited'), 'flags survive');
    equal(copy.explored, run.explored, 'the explored map survives');
    equal(restoreParty(copy.party)[0].hp, 31, 'the party survives');
  }],

  ['upgrades a version 2 save onto the tile map', () => {
    const run = freshRun(12);
    run.lastTown = 'hearthfire';
    const onRoad = parseRun(legacy(run, 'road-capitol-kerusai-4'));
    const hearthfire = placeById('hearthfire')!;
    assert(onRoad, 'a save on a road loads');
    equal(onRoad.pos, { x: hearthfire.x, y: hearthfire.y }, 'a party on an old road wakes in its last town');
    equal(onRoad.hour, 8, 'the clock starts in the morning');
    const inForest = parseRun(legacy(run, 'fork-forest'));
    const forest = placeById('small-forest')!;
    equal(inForest?.pos, { x: forest.x, y: forest.y }, 'the old forest fork is the Small Forest');
    assert(!parseRun(legacy(run, 'atlantis')), 'an unknown place is refused');
  }],

  ['sends a party standing somewhere impossible back to its last town', () => {
    const run = freshRun(3);
    run.pos = { x: 40, y: 48 };
    const copy = parseRun(JSON.stringify(run));
    equal(copy?.pos, { x: capitol.x, y: capitol.y }, 'nobody stands in the middle of the lake');
  }],

  ['moves a version 3 save east of the new desert, map and all', () => {
    const run = freshRun(5) as unknown as Record<string, unknown>;
    const oldW = 88;
    const bits = new Uint8Array(oldW * 60);
    bits[30 * oldW + 45] = 1;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let packed = '';
    for (let c = 0; c < Math.ceil(bits.length / 6); c++) {
      let value = 0;
      for (let bit = 0; bit < 6; bit++) if (bits[c * 6 + bit]) value |= 1 << bit;
      packed += alphabet[value];
    }
    Object.assign(run, { version: 3, pos: { x: capitol.x - 32, y: capitol.y }, explored: packed, searched: ['10,30:1'] });
    delete run.mapStyle;
    const copy = parseRun(JSON.stringify(run));
    assert(copy, 'the old save loads');
    equal(copy.pos, { x: capitol.x, y: capitol.y }, 'the party keeps its town');
    const mask = unpackExplored(copy.explored);
    assert(isExplored(mask, 45 + 32, 30) && !isExplored(mask, 45, 30), 'walked tiles move with the land');
    equal([copy.searched, copy.mapStyle], [[], 'travel'], 'old searches are dropped and the map is planned');
  }],
];

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration run: ${tests.length} checks passed.`);
