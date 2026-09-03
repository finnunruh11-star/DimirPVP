import { Mage } from '../core/Mage';
import { capturePartySnapshot, restoreParty } from '../pve/exploration/party';
import {
  applyExplorationCommand,
  createRun,
  fleeDestination,
  hasFlag,
  stepDice,
  type ExplorationRun,
} from '../pve/exploration/run';
import { createWorld, nodeAt } from '../pve/exploration/world';

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
  m.gainMana?.(0);
  return [m];
}

function freshRun(seed = 5): ExplorationRun {
  return createRun(seed, capturePartySnapshot(party()));
}

/** The first road node out of the Capitol. */
const FIRST_ROAD = 'road-capitol-kerusai-1';

const tests: [name: string, run: () => void][] = [
  ['starts in the Capitol with nothing earned', () => {
    const run = freshRun();
    equal(run.nodeId, 'capitol', 'begins in the Capitol');
    equal(run.gold, 0, 'begins broke');
    equal(run.steps, 0, 'begins before the first step');
  }],

  ['refuses a step to a node that is not adjacent', () => {
    const run = freshRun();
    const before = run.nodeId;
    const outcome = applyExplorationCommand(run, { t: 'travel', to: 'hearthfire' });
    equal(outcome, null, 'the step is rejected');
    equal(run.nodeId, before, 'the party has not moved');
    equal(run.steps, 0, 'a rejected step does not advance the clock');
  }],

  ['walks onto a road and rolls it', () => {
    const run = freshRun();
    const outcome = applyExplorationCommand(run, { t: 'travel', to: FIRST_ROAD });
    assert(outcome, 'travelling returned an outcome');
    equal(outcome.node.id, FIRST_ROAD, 'arrived on the road');
    equal(run.nodeId, FIRST_ROAD, 'the run agrees');
    equal(run.steps, 1, 'the step counter advanced');
    assert(
      ['robbery', 'monsters', 'event', 'nothing'].includes(outcome.encounter),
      'the road rolled something legal'
    );
  }],

  ['never rolls an encounter anywhere but a road', () => {
    const world = createWorld();
    const run = freshRun();
    // Walk the whole Emberway back to Hearthfire, checking every arrival.
    let guard = 0;
    const seen = new Set<string>([run.nodeId]);
    while (run.nodeId !== 'hearthfire' && guard++ < 40) {
      const next = nodeAt(world, run.nodeId).links.find(
        (id) => !seen.has(id) && (id.startsWith('road-hearthfire-capitol') || id === 'hearthfire')
      );
      if (!next) break;
      seen.add(next);
      const outcome = applyExplorationCommand(run, { t: 'travel', to: next });
      assert(outcome, 'each step produced an outcome');
      if (outcome.node.kind !== 'path') {
        equal(outcome.encounter, 'nothing', `${outcome.node.id} is safe to arrive at`);
      }
    }
    equal(run.nodeId, 'hearthfire', 'the Emberway reaches Hearthfire');
  }],

  ['replays the same road for the same seed and step', () => {
    const a = freshRun(1234);
    const b = freshRun(1234);
    const c = freshRun(9999);
    equal(stepDice(a, 7).float(), stepDice(b, 7).float(), 'same seed and step, same roll');
    assert(stepDice(a, 7).float() !== stepDice(c, 7).float(), 'a different seed rolls differently');
    assert(stepDice(a, 7).float() !== stepDice(a, 8).float(), 'a different step rolls differently');
  }],

  ['tracks gold, flags and where it has been', () => {
    const run = freshRun();
    applyExplorationCommand(run, { t: 'earn', gold: 12 });
    applyExplorationCommand(run, { t: 'spend', gold: 5 });
    equal(run.gold, 7, 'gold adds and subtracts');
    applyExplorationCommand(run, { t: 'spend', gold: 999 });
    equal(run.gold, 0, 'gold never goes negative');
    applyExplorationCommand(run, { t: 'flag', id: 'wilds:mapped' });
    applyExplorationCommand(run, { t: 'flag', id: 'wilds:mapped' });
    equal(run.flags.length, 1, 'a flag is only recorded once');
    assert(hasFlag(run, 'wilds:mapped'), 'the flag reads back');
    applyExplorationCommand(run, { t: 'travel', to: FIRST_ROAD });
    equal(run.visited.includes(FIRST_ROAD), true, 'the road is remembered');
  }],

  ['sends a fleeing party back the way it came, or onward', () => {
    const world = createWorld();
    const run = freshRun();
    applyExplorationCommand(run, { t: 'travel', to: FIRST_ROAD });
    equal(
      fleeDestination(run, 'capitol', 'west', world),
      'capitol',
      'running back the way you came returns you'
    );
    equal(
      fleeDestination(run, 'capitol', 'east', world),
      'road-capitol-kerusai-2',
      'running onward skips the encounter'
    );
    equal(
      fleeDestination(run, 'capitol', 'north', world),
      FIRST_ROAD,
      'running sideways leaves you where you stood'
    );
  }],

  ['carries the party through a snapshot intact', () => {
    const original = party();
    original[0].hp = 17;
    original[0].bag.push('oreIron', 'oreIron', 'magmaCore');
    const restored = restoreParty(capturePartySnapshot(original));
    equal(restored.length, 1, 'the roster survives');
    equal(restored[0].name, 'Wanderer', 'the name survives');
    equal(restored[0].hp, 17, 'wounds survive');
    equal(
      restored[0].bag.filter((id) => id === 'oreIron').length,
      2,
      'stacked materials survive'
    );
    assert(restored[0].bag.includes('magmaCore'), 'salvage survives');
  }],

  ['round-trips a whole run through JSON', () => {
    const run = freshRun(77);
    applyExplorationCommand(run, { t: 'travel', to: FIRST_ROAD });
    applyExplorationCommand(run, { t: 'earn', gold: 9 });
    applyExplorationCommand(run, { t: 'flag', id: 'hearthfire:visited' });
    const copy = JSON.parse(JSON.stringify(run)) as ExplorationRun;
    equal(copy.nodeId, run.nodeId, 'position survives');
    equal(copy.gold, run.gold, 'gold survives');
    equal(copy.steps, run.steps, 'the step clock survives');
    equal(copy.flags, run.flags, 'flags survive');
    equal(restoreParty(copy.party)[0].hp, 31, 'the party survives');
  }],
];

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration run: ${tests.length} checks passed.`);
