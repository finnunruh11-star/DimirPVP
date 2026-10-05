import { Dice } from '../core/Dice';
import { Mage } from '../core/Mage';
import { dayNews } from '../pve/exploration/calendar';
import { hoursToTurn, spanLabel } from '../pve/exploration/clock';
import { stormOnDay } from '../pve/exploration/desert';
import { hasMonsters } from '../pve/exploration/encounters';
import { ROAD_EVENTS } from '../pve/exploration/events';
import { gatherHerbs, HERBS, rollCache } from '../pve/exploration/finds';
import { emptyRoad, findSighting, LEG_TILES, rollBeat, stopsAlong, walkStep, type Beat } from '../pve/exploration/journey';
import { capturePartySnapshot, restoreParty } from '../pve/exploration/party';
import { createRun, type ExplorationRun } from '../pve/exploration/run';
import { parseRun } from '../pve/exploration/save';
import type { TravelMode, TripStep } from '../pve/exploration/travel';
import { createWorld, depthAt, isPassable, nearTown, placeAt, placeById, regionAt, townDistance } from '../pve/exploration/world';
import { darkness, mapShade, skyColor } from '../visuals/daylight';
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
const kerusai = placeById('kerusai')!;

function freshRun(seed = 3): ExplorationRun {
  const mage = new Mage({ name: 'Walker', isAI: false, team: 1, position: { x: 0, y: 0 }, loadout: [] });
  mage.assignFlatStats(3);
  return createRun(seed, capturePartySnapshot([mage]));
}

function stepAt(cell: Cell, over: Partial<TripStep> = {}): TripStep {
  return {
    cell,
    hours: 0.25,
    known: true,
    enemy: 0,
    find: 0,
    zone: regionAt(world, cell.x, cell.y),
    depth: depthAt(world, cell.x, cell.y),
    night: false,
    storm: false,
    ...over,
  };
}

/** Open country well away from any town, with room all round, where monsters live. */
function wildCell(): Cell {
  for (let y = 6; y < world.h - 6; y++) {
    for (let x = 6; x < world.w - 6; x++) {
      if (nearTown(x, y) || placeAt(x, y) || !isPassable(world, x, y) || townDistance(x, y) < 9) continue;
      if (!hasMonsters(regionAt(world, x, y))) continue;
      let open = 0;
      for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) if (isPassable(world, x + dx, y + dy)) open++;
      if (open >= 110) return { x, y };
    }
  }
  throw new Error('no open country anywhere');
}

/** A walkable tile right by Kerusai's walls. */
function gateCell(): Cell {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const cell = { x: kerusai.x + dx, y: kerusai.y + dy };
    if (isPassable(world, cell.x, cell.y) && !placeAt(cell.x, cell.y)) return cell;
  }
  throw new Error('Kerusai has no open ground outside');
}

function beatsFor(mode: TravelMode, road: { danger: number; luck: number }, cell: Cell, rolls = 300): Record<Beat['kind'], number> {
  const counts: Record<Beat['kind'], number> = { fight: 0, loot: 0, event: 0, sighting: 0, rest: 0 };
  for (let seed = 0; seed < rolls; seed++) {
    const run = freshRun(seed);
    run.road = { tiles: LEG_TILES, ...road };
    counts[rollBeat(world, run, stepAt(cell), mode, []).kind] += 1;
  }
  return counts;
}

const wild = wildCell();

const tests: [name: string, run: () => void][] = [
  ['stops every four tiles, and a short hop carries its tiles into the next trip', () => {
    const run = freshRun();
    const step = stepAt(wild, { enemy: 0.05, find: 0.03 });
    for (let tile = 1; tile < LEG_TILES; tile++) assert(!walkStep(run, step), `tile ${tile} is no stop`);
    assert(walkStep(run, step), 'the fourth tile is');
    assert(run.road.danger > 0 && run.road.luck > 0, 'danger and luck build up as the party walks');
    equal(stopsAlong(freshRun(), 20), [3, 7, 11, 15], 'a fresh road stops after tiles 4, 8, 12 and 16');
    equal(stopsAlong(freshRun(), 4), [], 'a stop falling on the arrival waits for the next trip');
    const hopped = freshRun();
    hopped.road.tiles = 3;
    equal(stopsAlong(hopped, 20), [0, 4, 8, 12, 16], 'three tiles already walked bring the first stop forward');
  }],

  ['rolls the same stop from the same run, then clears the leg and moves the seed on', () => {
    const a = freshRun(9);
    a.road = { tiles: LEG_TILES, danger: 0.4, luck: 0.3 };
    const b = JSON.parse(JSON.stringify(a)) as ExplorationRun;
    equal(rollBeat(world, a, stepAt(wild), 'sprint', []), rollBeat(world, b, stepAt(wild), 'sprint', []), 'same run, same stop');
    equal(a.road, emptyRoad(), 'the leg starts over');
    equal(a.steps, 1, 'the next stop rolls fresh');
  }],

  ['never springs a fight at the town gates, and fights more the riskier the road', () => {
    const gates = beatsFor('sprint', { danger: 6, luck: 0 }, gateCell());
    equal(gates.fight, 0, 'nothing attacks by the walls');
    const risky = beatsFor('sprint', { danger: 1.5, luck: 0 }, wild);
    const calm = beatsFor('sprint', { danger: 0.05, luck: 0 }, wild);
    assert(risky.fight > calm.fight * 4, `a dangerous leg brings far more fights (${risky.fight} vs ${calm.fight})`);
    assert(calm.fight < 30, `a quiet leg rarely does (${calm.fight}/300)`);
  }],

  ['keeps some quiet stretches, brings roadside events often, and turns up more when exploring', () => {
    const sprint = beatsFor('sprint', { danger: 0, luck: 0.15 }, wild);
    const explore = beatsFor('explore', { danger: 0, luck: 0.15 }, wild);
    assert(sprint.rest > 60 && sprint.rest < 180, `a quiet sprint still has quiet stretches (${sprint.rest}/300)`);
    assert(sprint.event > 40, `roadside events are common (${sprint.event}/300)`);
    assert(sprint.sighting > 30 && sprint.sighting < 140, `something is spotted now and then (${sprint.sighting}/300)`);
    assert(explore.sighting > sprint.sighting, `exploring spots more (${explore.sighting} vs ${sprint.sighting})`);
    assert(explore.rest < sprint.rest, `exploring is rarely quiet (${explore.rest} vs ${sprint.rest})`);
    assert(sprint.loot > 0, 'finds still turn up');
  }],

  ['spots things a short walk off the way, never on the route ahead nor in a town', () => {
    const ahead: Cell[] = Array.from({ length: 6 }, (_, i) => ({ x: wild.x + i + 1, y: wild.y }));
    const kinds: Record<string, number> = { herbs: 0, pack: 0, cache: 0, event: 0 };
    let seen = 0;
    for (let seed = 0; seed < 400; seed++) {
      const sighting = findSighting(world, stepAt(wild), ahead, new Dice(seed));
      if (!sighting) continue;
      seen += 1;
      kinds[sighting.kind] += 1;
      const { x, y } = sighting.cell;
      const distance = Math.hypot(x - wild.x, y - wild.y);
      assert(distance >= 2 && distance <= 5.5, `seed ${seed}: ${distance.toFixed(1)} tiles off`);
      assert(isPassable(world, x, y) && !placeAt(x, y), `seed ${seed}: open ground`);
      assert(!ahead.some((cell) => cell.x === x && cell.y === y), `seed ${seed}: off the route`);
      assert(/^\d+ tiles? (north|south|east|west|north-east|north-west|south-east|south-west)$/.test(sighting.bearing), `seed ${seed}: bearing "${sighting.bearing}"`);
      if (sighting.kind === 'pack') assert(sighting.spawns?.length, `seed ${seed}: a pack has members`);
      if (sighting.kind === 'herbs') assert(sighting.herb && HERBS[sighting.zone].includes(sighting.herb), `seed ${seed}: a local herb`);
      if (sighting.kind === 'cache') assert(sighting.site, `seed ${seed}: a ruin has a name`);
      if (sighting.kind === 'event') {
        assert(ROAD_EVENTS.some((event) => event.id === sighting.eventId && event.sighted), `seed ${seed}: a real event that sits off the road`);
        const scene = sighting.scene;
        assert(scene && scene.id === sighting.eventId && scene.title === sighting.title && scene.text === sighting.text, `seed ${seed}: the card shows the scene that will play`);
      }
    }
    assert(seen > 380, `open country always has somewhere to look (${seen}/400)`);
    assert(Object.values(kinds).every((n) => n > 0), `herbs, packs, ruins and scenes all turn up (${JSON.stringify(kinds)})`);
    for (let seed = 0; seed < 100; seed++) {
      const near = findSighting(world, stepAt(gateCell()), [], new Dice(seed));
      assert(!near || near.kind !== 'pack' || !nearTown(near.cell.x, near.cell.y), `seed ${seed}: no pack waits by the walls`);
    }
  }],

  ['sees less far by night', () => {
    for (let seed = 0; seed < 200; seed++) {
      const sighting = findSighting(world, stepAt(wild, { night: true }), [], new Dice(seed));
      if (!sighting) continue;
      const distance = Math.hypot(sighting.cell.x - wild.x, sighting.cell.y - wild.y);
      assert(distance <= 3.5, `seed ${seed}: spotted ${distance.toFixed(1)} tiles off in the dark`);
    }
  }],

  ['gathers two to four herbs and searches ruins for things, never coin', () => {
    const run = freshRun();
    const herbs = (): number => {
      const leader = restoreParty(run.party)[0];
      return [...leader.bag, ...leader.utility].filter((id) => id === 'herbMoonglow').length;
    };
    for (let seed = 0; seed < 12; seed++) {
      const before = herbs();
      const message = gatherHerbs(run, 'herbMoonglow', new Dice(seed));
      const gained = herbs() - before;
      assert(gained >= 2 && gained <= 4, `seed ${seed}: ${gained} picked`);
      equal(message, `Gathered ${gained}x Moonglow.`, `seed ${seed}: says what was picked`);
    }
    const gold = run.gold;
    for (let seed = 0; seed < 12; seed++) {
      const message = rollCache(run, 'forest', 4, new Dice(seed), 'Old hunting lodge');
      assert(message.startsWith('Old hunting lodge: ') && message.endsWith('.'), `seed ${seed}: "${message}"`);
      assert(!/Moonglow|Waterleaf|Deathweed|Fireblossom/.test(message), `seed ${seed}: no herbs in a ruin`);
    }
    equal(run.gold, gold, 'no coin from either');
  }],

  ['keeps the leg through a save, clamps a bent one and starts old saves fresh', () => {
    const run = freshRun(4);
    run.road = { tiles: 4, danger: 0.3, luck: 0.12 };
    equal(parseRun(JSON.stringify(run))?.road, run.road, 'the leg survives a reload');
    const bent = JSON.parse(JSON.stringify(run)) as Record<string, unknown>;
    bent.road = { tiles: -5, danger: 'lots', luck: 1e9 };
    equal(parseRun(JSON.stringify(bent))?.road, { tiles: 0, danger: 0, luck: 20 }, 'nonsense is clamped');
    delete bent.road;
    equal(parseRun(JSON.stringify(bent))?.road, emptyRoad(), 'a save from before legs starts a fresh one');
  }],

  ['tells what a new day brings', () => {
    const run = freshRun(12);
    let day = 1;
    while (!stormOnDay(run, day)) day += 1;
    run.day = day;
    const news = dayNews(run);
    assert(news.includes('Shops restocked') && news.includes('New bounties posted'), 'shops and boards turn over');
    assert(news.some((line) => /^Sandstorm over the desert at \d\d:\d\d$/.test(line)), `the storm is called (${news.join(' | ')})`);
    let calm = 1;
    while (stormOnDay(run, calm)) calm += 1;
    run.day = calm;
    assert(!dayNews(run).some((line) => line.startsWith('Sandstorm')), 'a still day calls no storm');
  }],

  ['reads the hour: when the light turns, and what colour it is', () => {
    equal([hoursToTurn(22), hoursToTurn(2), hoursToTurn(19), hoursToTurn(6)], [8, 4, 1, 14], 'night falls at 20:00 and breaks at 06:00');
    equal([spanLabel(0.1), spanLabel(0.75), spanLabel(1.25), spanLabel(3)], ['15 min', '45 min', '1 h 15 min', '3 h'], 'quarter hours');
    equal([darkness(12), darkness(0)], [0, 1], 'noon is light, midnight dark');
    const noon = skyColor(12);
    const midnight = skyColor(0);
    assert(((noon >> 16) & 255) > 220 && ((noon >> 8) & 255) > 190 && (noon & 255) < 170, 'the noon sky is yellow');
    assert(((midnight >> 16) & 255) < 30 && ((midnight >> 8) & 255) < 30 && (midnight & 255) < 50, 'the midnight sky is near black');
    assert(mapShade(12).alpha === 0 && mapShade(2).alpha > 0.4, 'the map is clear by day and shaded by night');
    assert(mapShade(18.6).color >> 16 > 0xc0, 'dusk lays a warm light');
  }],
];

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration journey: ${tests.length} checks passed.`);
