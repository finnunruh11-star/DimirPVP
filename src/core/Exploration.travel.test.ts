import { RANGE_UNIT } from '../config/constants';
import { Dice } from '../core/Dice';
import { Mage } from '../core/Mage';
import { applyHeat, isSandstorm, stormOnDay } from '../pve/exploration/desert';
import { packExplored, revealTiles, unpackExplored } from '../pve/exploration/explored';
import { AMBUSH_MAX_TILES, fieldHealAmount, fieldWordsFor } from '../pve/exploration/fieldWords';
import { rollFind } from '../pve/exploration/finds';
import { capturePartySnapshot, restoreParty } from '../pve/exploration/party';
import { createRun, type ExplorationRun } from '../pve/exploration/run';
import {
  canSearch,
  exploreAlong,
  findRoute,
  planTrip,
  rollSearch,
  rollTrip,
  TRAVEL_MODES,
} from '../pve/exploration/travel';
import { createWorld, placeById, terrainAt } from '../pve/exploration/world';
import type { Cell } from '../world/pathfind';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}: expected ${e}, received ${a}`);
}

const world = createWorld();

function freshRun(seed = 21): ExplorationRun {
  const mage = new Mage({ name: 'Walker', isAI: false, team: 1, position: { x: 0, y: 0 }, loadout: [] });
  mage.assignFlatStats(3);
  return createRun(seed, capturePartySnapshot([mage]));
}

function routeTo(run: ExplorationRun, id: string): Cell[] {
  const place = placeById(id)!;
  const route = findRoute(world, run, place);
  assert(route && route.length > 0, `a route to ${id}`);
  return route;
}

/** Mark a whole route explored, as if it had been walked before. */
function walked(run: ExplorationRun, route: Cell[]): void {
  const mask = unpackExplored(run.explored);
  revealTiles(mask, route, 0);
  run.explored = packExplored(mask);
}

const tests: [name: string, run: () => void][] = [
  ['routes along roads where it can', () => {
    const run = freshRun();
    const route = routeTo(run, 'oakhaven');
    const onRoad = route.filter((cell) => ['road', 'bridge'].includes(terrainAt(world, cell.x, cell.y))).length;
    assert(onRoad / route.length > 0.7, `the Northway carries most of the trip (${onRoad}/${route.length})`);
    equal(findRoute(world, run, { x: 40, y: 48 }), null, 'nobody walks into the lake');
  }],

  ['makes sneaking slow and safe, and exploring slow, risky and rich', () => {
    const run = freshRun();
    const route = routeTo(run, 'kerusai');
    const sprint = planTrip(world, run, route, 'sprint');
    const sneak = planTrip(world, run, route, 'sneak');
    const explore = planTrip(world, run, route, 'explore');
    assert(sneak.hours > sprint.hours && explore.hours > sneak.hours, 'sprint < sneak < explore in hours');
    assert(sneak.fights < sprint.fights, 'sneaking meets fewer fights');
    assert(explore.fights > sprint.fights, 'exploring meets more fights');
    assert(explore.finds > sprint.finds * 2, 'exploring turns up far more');
    assert(sprint.fights > 0 && sprint.finds > 0, 'a sprint is not free of either');
  }],

  ['charges more time and danger for unexplored ground, and more for longer trips', () => {
    const run = freshRun();
    const route = routeTo(run, 'thassa');
    const blind = planTrip(world, run, route, 'sprint');
    const known = freshRun();
    walked(known, route);
    const familiar = planTrip(world, known, route, 'sprint');
    assert(blind.hours > familiar.hours, 'new ground takes longer');
    assert(blind.fights > familiar.fights, 'new ground is more dangerous');
    const short = planTrip(world, run, route.slice(0, 8), 'sprint');
    assert(short.fights < blind.fights, 'a shorter trip risks less');
  }],

  ['allows fast travel only on a known route, with one roll and no finds', () => {
    const run = freshRun();
    const route = routeTo(run, 'pennybruck');
    const refused = planTrip(world, run, route, 'fast');
    assert(!refused.allowed && refused.reason, 'an unknown route cannot be fast-travelled');
    walked(run, route);
    const fast = planTrip(world, run, route, 'fast');
    assert(fast.allowed, 'a walked route can');
    equal(fast.steps.filter((step) => step.enemy > 0).length, 1, 'exactly one roll for trouble');
    equal(fast.finds, 0, 'nothing is found at speed');
    assert(fast.hours < planTrip(world, run, route, 'sprint').hours, 'fast travel is quicker');
  }],

  ['makes night travel riskier, except for sneaking', () => {
    const day = freshRun();
    const night = freshRun();
    night.hour = 22;
    const route = routeTo(day, 'kerusai').slice(0, 12);
    assert(planTrip(world, night, route, 'sprint').fights > planTrip(world, day, route, 'sprint').fights, 'sprinting by night is worse');
    assert(planTrip(world, night, route, 'sneak').fights < planTrip(world, day, route, 'sneak').fights, 'sneaking by night is better');
  }],

  ['rolls a trip the same way every time, stopping at the first fight', () => {
    const run = freshRun(99);
    const plan = planTrip(world, run, routeTo(run, 'hearthfire'), 'explore');
    run.steps = 4;
    const first = rollTrip(run, plan);
    equal(rollTrip(run, plan), first, 'same step, same trip');
    for (let i = 1; i < first.length; i++) assert(first[i].index > first[i - 1].index || first[i].index === first[i - 1].index, 'stops come in order');
    const fight = first.findIndex((stop) => stop.kind === 'robbery' || stop.kind === 'monsters');
    assert(fight < 0 || fight === first.length - 1, 'nothing happens after a fight');
    let fights = 0;
    for (let step = 0; step < 200; step++) {
      run.steps = step;
      if (rollTrip(run, plan).some((stop) => stop.kind === 'monsters' || stop.kind === 'robbery')) fights += 1;
    }
    assert(fights > 20 && fights < 200, `a long explore usually but not always ends in a fight (${fights}/200)`);
  }],

  ['lets an area be searched once a day, mostly for loot, never for a fight at the gates', () => {
    const run = freshRun(5);
    assert(canSearch(run).allowed, 'a fresh tile can be searched');
    const counts: Record<string, number> = { loot: 0, event: 0, monsters: 0, robbery: 0, nothing: 0 };
    run.pos = { x: 62, y: 20 };
    for (let step = 0; step < 400; step++) {
      run.steps = step;
      run.searched = [];
      counts[rollSearch(world, run).outcome] += 1;
    }
    assert(counts.loot > (counts.monsters + counts.robbery) * 2, 'loot outweighs fights');
    assert(!canSearch(run).allowed, 'searching marks the tile for the day');
    run.day += 1;
    assert(canSearch(run).allowed, 'tomorrow it can be searched again');
    const gates = freshRun(8);
    for (let step = 0; step < 100; step++) {
      gates.steps = step;
      gates.searched = [];
      const { outcome } = rollSearch(world, gates);
      assert(outcome !== 'monsters' && outcome !== 'robbery', 'nothing attacks at the town gates');
    }
  }],

  ['marks a walked route explored, wider when exploring', () => {
    const run = freshRun();
    const route = routeTo(run, 'oakhaven');
    const narrow = freshRun();
    const wide = freshRun();
    const a = exploreAlong(narrow, route, TRAVEL_MODES.sprint.reveal);
    const b = exploreAlong(wide, route, TRAVEL_MODES.explore.reveal);
    assert(a > 0 && b > a, 'exploring maps a wider strip');
  }],

  ['hands over a find and a little experience', () => {
    const run = freshRun();
    const before = JSON.stringify(restoreParty(run.party)[0].bag) + run.gold;
    const message = rollFind(run, 'forest', 3, new Dice(4));
    assert(message.includes('+1 XP'), 'finds teach something');
    const after = JSON.stringify(restoreParty(run.party)[0].bag) + run.gold;
    assert(before !== after || restoreParty(run.party)[0].utility.length > 0, 'something was gained');
  }],

  ['blows sandstorms over the desert about every other day', () => {
    const run = freshRun(31);
    let stormy = 0;
    for (let day = 1; day <= 200; day++) {
      const storm = stormOnDay(run, day);
      if (!storm) continue;
      stormy += 1;
      assert(storm.hours >= 5 && storm.hours <= 10, 'a storm lasts five to ten hours');
    }
    assert(stormy > 70 && stormy < 130, `about half the days bring a storm (${stormy}/200)`);
    equal(stormOnDay(run, 17), stormOnDay(freshRun(31), 17), 'the same run keeps the same weather');
  }],

  ['hides the desert in a storm and burns travellers by day', () => {
    const run = freshRun(8);
    let day = 1;
    while (!stormOnDay(run, day)) day += 1;
    const storm = stormOnDay(run, day)!;
    run.day = Math.floor(storm.start / 24) + 1;
    run.hour = (storm.start % 24) + 0.25;
    assert(isSandstorm(run), 'the storm is raging now');
    const nerogril = placeById('nerogril')!;
    run.pos = { x: nerogril.x, y: nerogril.y };
    const theocracy = placeById('theocracy')!;
    const route = findRoute(world, run, theocracy)!;
    walked(run, route);
    const plan = planTrip(world, run, route, 'sprint');
    const first = plan.steps[0];
    assert(first.storm && !first.known, 'a mapped road counts as unknown in the storm');
    const fast = planTrip(world, run, route, 'fast');
    equal([fast.allowed, fast.reason], [false, 'A sandstorm hides the way.'], 'nobody fast-travels through a storm');
    const calm = freshRun(8);
    calm.pos = run.pos;
    calm.hour = 12;
    while (isSandstorm(calm)) calm.day += 1;
    walked(calm, route);
    const noon = planTrip(world, calm, route.slice(0, 6), 'sprint');
    assert(noon.heat > 0, 'the noon sun burns');
    equal(planTrip(world, calm, route.slice(0, 6), 'sprint', { heatProof: true }).heat, 0, 'a stillsuit keeps it off');
    calm.hour = 22;
    const midnight = planTrip(world, calm, route.slice(0, 6), 'sprint');
    if (!midnight.storm) equal(midnight.heat, 0, 'the night is cool');
    const lost = applyHeat(calm, 3);
    equal(lost, 3, 'heat takes whole points');
    const leader = restoreParty(calm.party)[0];
    leader.hp = 2;
    calm.party = capturePartySnapshot([leader]);
    applyHeat(calm, 5);
    equal(restoreParty(calm.party)[0].hp, 1, 'the sun never kills');
  }],

  ['offers the words that work outside a fight, in loadout order', () => {
    const reach = (word: string): number | null => (word === 'fire' ? 20 * RANGE_UNIT : word === 'curse' ? null : 3 * RANGE_UNIT);
    const words = fieldWordsFor(['fire', 'veil', 'twist', 'curse', 'shatter', 'heal', 'stop'], reach);
    equal(words.map((w) => `${w.word}:${w.effect}`), ['fire:ambush', 'veil:veil', 'shatter:ambush', 'heal:heal'], 'field words');
    equal(words.map((w) => w.range), [AMBUSH_MAX_TILES, 0, 3, 0], 'reach in tiles, capped');
    equal([fieldHealAmount(4, 2), fieldHealAmount(1, -3)], [6, 1], 'field heal is 1d6 + Intellect');
  }],
];

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration travel: ${tests.length} checks passed.`);
