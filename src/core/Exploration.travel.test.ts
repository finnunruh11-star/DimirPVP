import { RANGE_UNIT } from '../config/constants';
import { wordSpellMana } from '../core/Colors';
import { Dice } from '../core/Dice';
import { Mage } from '../core/Mage';
import type { WordId } from '../core/Words';
import { isSandstorm, stormOnDay } from '../pve/exploration/desert';
import { packExplored, revealTiles, unpackExplored } from '../pve/exploration/explored';
import {
  AMBUSH_MAX_TILES, FIELD_RULES, fieldCombos, fieldHealAmount, fieldSpellMana, reachTiles,
} from '../pve/exploration/fieldWords';
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
const capitol = placeById('capitol')!;

/** A run planning from the Capitol, the middle of the map. */
function freshRun(seed = 21): ExplorationRun {
  const mage = new Mage({ name: 'Walker', isAI: false, team: 1, position: { x: 0, y: 0 }, loadout: [] });
  mage.assignFlatStats(3);
  const run = createRun(seed, capturePartySnapshot([mage]));
  run.pos = { x: capitol.x, y: capitol.y };
  return run;
}

function mage(loadout: WordId[]): Mage {
  return new Mage({ name: 'Speaker', isAI: false, team: 1, position: { x: 0, y: 0 }, loadout });
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

  ['hands over a find: a thing, never coin or experience', () => {
    for (const seed of [1, 4, 9, 16, 25, 36]) {
      const run = freshRun();
      const carried = (): number => {
        const leader = restoreParty(run.party)[0];
        const worn = [...leader.hands, ...leader.bag, ...leader.utility, ...leader.accessories, leader.head, leader.torso, leader.boots];
        return worn.filter(Boolean).length + leader.arrows;
      };
      const before = carried();
      const message = rollFind(run, 'forest', 3, new Dice(seed));
      assert(!message.includes('XP') && !/\dg\b/.test(message), `seed ${seed}: no gold or XP in "${message}"`);
      equal([run.gold, run.xp, run.pendingLevels], [freshRun().gold, 0, 0], `seed ${seed}: purse and training untouched`);
      assert(carried() > before, `seed ${seed}: something was gained`);
    }
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

  ['hides the desert in a storm', () => {
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
    assert(!noon.storm && noon.steps.every((step) => step.known), 'in still air the mapped road is known');
  }],

  ['combines up to two words outside a fight, for what the cast would cost in one', () => {
    equal(
      fieldCombos(['fire', 'veil', 'pierce']).map((combo) => combo.join('+')),
      ['fire', 'veil', 'pierce', 'fire+veil', 'fire+pierce', 'veil+pierce'],
      'each word alone, then each pair',
    );
    const plain = mage(['pierce', 'shatter', 'veil']);
    equal(fieldSpellMana(plain, ['pierce']), 0, 'one word costs no mana');
    const pair = fieldSpellMana(plain, ['pierce', 'shatter']);
    assert(pair > 0 && pair === wordSpellMana(['pierce', 'shatter'], plain.profile), 'two words cost what they cost in a fight');
    equal(fieldSpellMana(mage(['curse', 'corrode', 'pierce']), ['pierce']), 2, 'black words make even one word cost');
    equal(Object.keys(FIELD_RULES).sort(), ['bind', 'heal', 'mind', 'veil'], 'Shadow does nothing of its own out here');
    equal(FIELD_RULES.mind?.ms, 30_000, 'Mind reads packs for thirty seconds');
    equal([reachTiles(20 * RANGE_UNIT), reachTiles(3 * RANGE_UNIT)], [AMBUSH_MAX_TILES, 3], 'reach in tiles, capped');
    equal([fieldHealAmount(4, 2), fieldHealAmount(1, -3)], [6, 1], 'field heal is 1d6 + Intellect');
  }],
];

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration travel: ${tests.length} checks passed.`);
