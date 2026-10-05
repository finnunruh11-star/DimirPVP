import { Dice } from '../core/Dice';
import { MAGE_CLASSES, type MageClass } from '../core/Classes';
import { Mage } from '../core/Mage';
import {
  areaBounds, areaHours, areaInStep, areaLead, enterArea, gapLabel, hoursBehind, inAreaBounds, leaveArea, memberHours, restOver, restTogether,
  spendAreaTime, waitInArea,
} from '../pve/exploration/area';
import { memberIn, partyOf, withParty } from '../pve/exploration/economy';
import type { EncounterSpawn } from '../pve/exploration/encounters';
import { ORES } from '../pve/exploration/finds';
import { resolveLocale } from '../pve/exploration/locales';
import { cellWorldTile, OPEN_WORLD_ID, openWorldDef } from '../pve/exploration/openWorld';
import { capturePartySnapshot } from '../pve/exploration/party';
import { createRun, type ExplorationRun } from '../pve/exploration/run';
import {
  bestSearcher,
  checkOutcome,
  findSearchTarget,
  pickedOver,
  resolveSearch,
  searchBonus,
  searchKey,
  searchOdds,
  searchSite,
  searchTargets,
  trackedPack,
  type SearchTarget,
} from '../pve/exploration/search';
import { shortRestRisk, SHORT_REST_HOURS, takeShortRest } from '../pve/exploration/shortRest';
import { createWorld, placeById, TERRAIN, terrainAt } from '../pve/exploration/world';
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
const capitolTile: Cell = { x: capitol.x + 3, y: capitol.y };

function traveller(mageClass: MageClass, name: string, stat = 3): Mage {
  const mage = new Mage({ name, isAI: false, team: 1, position: { x: 0, y: 0 }, loadout: ['pierce', 'shadow'], mageClass });
  mage.assignFlatStats(stat);
  return mage;
}

function partyRun(size = 1, seed = 11): ExplorationRun {
  return createRun(seed, capturePartySnapshot(MAGE_CLASSES.slice(0, size).map((mageClass, i) => traveller(mageClass, `Player ${i + 1}`))));
}

function kindOf(spawn: EncounterSpawn): string {
  return spawn.family === 'swamp' ? spawn.kind : spawn.spec.kind;
}

/** Search until the roll comes out as `outcome` (the dice differ per seed). */
function searchUntil(run: ExplorationRun, tile: Cell, target: SearchTarget, bonus: number, outcome: string): ReturnType<typeof resolveSearch> {
  for (let seed = 1; seed <= 400; seed++) {
    const copy = JSON.parse(JSON.stringify(run)) as ExplorationRun;
    const probe = resolveSearch(copy, tile, target, 'objects', bonus, new Dice(seed));
    if (probe.roll.outcome !== outcome) continue;
    return resolveSearch(run, tile, target, 'objects', bonus, new Dice(seed));
  }
  throw new Error(`no ${outcome} in 400 seeds`);
}

/** A world tile out in the country where a rest may be broken, for a run by day. */
function riskyTile(run: ExplorationRun): Cell {
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      if (!Number.isFinite(TERRAIN[terrainAt(world, x, y)].time)) continue;
      const risk = shortRestRisk(run, { safe: false, tile: { x, y } });
      if (risk > 0.2 && risk < 0.5) return { x, y };
    }
  }
  throw new Error('no risky tile');
}

const tests: [name: string, run: () => void][] = [
  ['rolls a d20 against the DC: a natural 20 always finds, a natural 1 never, a near miss still counts', () => {
    equal(checkOutcome(20, 0, 99), 'found', 'a natural 20 finds anything');
    equal(checkOutcome(1, 20, 2), 'nothing', 'a natural 1 finds nothing');
    equal(checkOutcome(10, 2, 12), 'found', 'meeting the DC finds it');
    equal(checkOutcome(10, 0, 15), 'near', 'five short is a near miss');
    equal(checkOutcome(9, 0, 15), 'nothing', 'six short is nothing');
    equal(searchOdds(11, 0), { found: 0.5, near: 0.25, nothing: 0.25 }, 'the odds on DC 11 with no bonus');
    for (const [dc, bonus] of [[8, 0], [14, 3], [27, 6], [2, 6]]) {
      const odds = searchOdds(dc, bonus);
      assert(Math.abs(odds.found + odds.near + odds.nothing - 1) < 1e-9, `the odds on DC ${dc} add up`);
      assert(odds.found >= 0.05 && odds.nothing >= 0.05, `DC ${dc}: a 20 always finds and a 1 never does`);
    }
  }],

  ['makes what belongs to the ground easy to find, and what does not much harder', () => {
    const run = partyRun();
    const { zone } = searchSite(run, capitolTile);
    const targets = searchTargets(run, capitolTile);
    const ores = targets.resource.filter((target) => target.resource === 'ore');
    const native = ores.find((target) => target.standing === 'native');
    const foreign = ores.find((target) => target.standing === 'foreign');
    assert(native && foreign, `${zone} has ore of its own and ore it lacks`);
    assert(ORES[zone].includes(native.id as never), 'native ore comes from the finds table');
    equal([native.dc, foreign.dc], [12, 20], 'ore: DC 12 at home, 8 more elsewhere');
    equal(targets.resource[0].standing, 'native', 'what belongs is listed first');
    const creatures = targets.creature;
    assert(creatures[0].standing === 'native' && creatures[0].dc === 11, 'a native creature is DC 11');
    assert(creatures.every((target) => target.standing !== 'foreign'), 'nothing that lives elsewhere can be found here');
    assert(creatures.every((target) => target.id.startsWith('bandit')), `the capitol has only its robbers (${creatures.map((target) => target.id).join(', ')})`);
    equal(targets.events.map((target) => target.dc), [8], 'anything nearby is DC 8');
  }],

  ['makes each search of the same ground on the same day harder', () => {
    const run = partyRun();
    equal(pickedOver(run, capitolTile), 0, 'fresh ground');
    run.searched.push(searchKey(capitolTile, run.day), searchKey(capitolTile, run.day));
    equal(pickedOver(run, capitolTile), 4, 'two searches today: +4');
    equal(searchTargets(run, capitolTile).events[0].dc, 12, 'and every target is harder');
    equal(pickedOver(run, { x: capitolTile.x + 1, y: capitolTile.y }), 0, 'the next tile over is fresh');
    run.day += 1;
    equal(pickedOver(run, capitolTile), 0, 'the next day it has grown back');
  }],

  ['refuses a target that cannot be sought here', () => {
    const run = partyRun();
    equal(findSearchTarget(run, capitolTile, 'resource', 'constructor'), null, 'no prototype keys');
    equal(findSearchTarget(run, capitolTile, 'weapons', 'huntingBow'), null, 'no unknown categories');
    equal(findSearchTarget(run, capitolTile, 'resource', 'huntingBow'), null, 'a bow is no resource');
    equal(findSearchTarget(run, capitolTile, 'events', 'events')?.dc, 8, 'events are always there');
  }],

  ['rolls half the searcher\'s knack, up to +6, and the best of the party leads', () => {
    const sharp = traveller('objects', 'Sharp', 9);
    equal([searchBonus(sharp, 'resource'), searchBonus(sharp, 'creature'), searchBonus(sharp, 'events')], [4, 4, 4], 'half of 9, rounded down');
    equal(searchBonus(traveller('life', 'Sage', 30), 'resource'), 6, 'never more than +6');
    const run = createRun(3, capturePartySnapshot([traveller('objects', 'Dull', 1), traveller('life', 'Keen', 8)]));
    equal(bestSearcher(run, 'creature')?.name, 'Keen', 'the keenest tracker searches');
    withParty(run, (_leader, party) => { party[1].hp = 0; });
    equal(bestSearcher(run, 'creature')?.name, 'Dull', 'the fallen cannot');
  }],

  ['hands a found resource to the searcher and marks the ground searched', () => {
    const run = partyRun();
    const target = searchTargets(run, capitolTile).resource[0];
    const before = memberIn(run, 'objects')!.bag.filter((id) => id === target.id).length;
    const found = searchUntil(run, capitolTile, target, 6, 'found');
    assert(found.message.startsWith('Found '), `found: ${found.message}`);
    assert(memberIn(run, 'objects')!.bag.filter((id) => id === target.id).length > before, 'it is in the searcher\'s bag');
    equal(pickedOver(run, capitolTile), 2, 'the ground is picked over');
  }],

  ['turns a near miss into something good all the same', () => {
    for (let trial = 0; trial < 6; trial++) {
      const run = partyRun(1, 40 + trial);
      withParty(run, (_leader, party) => {
        party[0].hp = 1;
        party[0].mana = 0;
      });
      const snapshot = (): string => {
        const mage = partyOf(run)[0];
        return JSON.stringify([run.gold, mage.bag.length, mage.hp, mage.mana, run.xp, run.level]);
      };
      const target = searchTargets(run, capitolTile).resource.find((entry) => entry.standing === 'foreign')!;
      const before = snapshot();
      const near = searchUntil(run, capitolTile, target, 0, 'near');
      assert(near.message.length > 0, 'the lucky turn is told');
      assert(snapshot() !== before, `a near miss is never for nothing: ${near.message}`);
    }
  }],

  ['tracks a sought creature down to a group of its own kind, still unaware', () => {
    const run = partyRun();
    const creature = searchTargets(run, capitolTile).creature[0];
    for (let seed = 1; seed <= 10; seed++) {
      const spawns = trackedPack(creature.id, 3, new Dice(seed));
      assert(spawns.length >= 1 && spawns.every((spawn) => kindOf(spawn) === creature.id), `a group of ${creature.id}`);
    }
    const found = searchUntil(run, capitolTile, creature, 6, 'found');
    assert(found.pack && found.pack.spawns.every((spawn) => kindOf(spawn) === creature.id), 'the pack is what was sought');
    equal(found.pack.zone, searchSite(run, capitolTile).zone, 'fought on this ground');
    const events = searchUntil(partyRun(), capitolTile, searchTargets(run, capitolTile).events[0], 6, 'found');
    assert(events.event && !events.pack, 'looking about turns up something going on');
  }],

  ['gives back a quarter of everything on a short rest, rounded up, in one to two hours', () => {
    const run = partyRun(2);
    withParty(run, (_leader, party) => {
      party[0].maxHp = 41;
      party[0].hp = 1;
      party[0].mana = 0;
      for (const word of party[0].loadout) party[0].charges[word] = 0;
      party[1].hp = 0;
    });
    const mage = partyOf(run)[0];
    const outcome = takeShortRest(run, null, { safe: true }, new Dice(3));
    assert(!outcome.ambush, 'nothing breaks a rest inside walls');
    assert(outcome.hours >= SHORT_REST_HOURS.min && outcome.hours <= SHORT_REST_HOURS.max && Number.isInteger(outcome.hours * 4), 'one to two hours, by the quarter');
    const [rested, fallen] = partyOf(run);
    equal(rested.hp, 1 + Math.ceil(41 / 4), 'a quarter of 41 HP is 11');
    equal(rested.mana, Math.ceil(mage.maxMana / 4), 'a quarter of the mana');
    for (const word of rested.loadout) equal(rested.charges[word], Math.ceil(rested.maxWordCharges(word) / 4), `a quarter of ${word}'s charges`);
    equal([fallen.alive, outcome.restored.map((entry) => entry.member)], [false, ['objects']], 'the fallen stay down');
    const hours = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) hours.add(takeShortRest(partyRun(), null, { safe: true }, new Dice(seed)).hours);
    assert(hours.size > 2 && Math.min(...hours) >= 1 && Math.max(...hours) <= 2, 'rests take different lengths');
  }],

  ['rests only the travellers named, on foot each rests alone', () => {
    const run = partyRun(2);
    withParty(run, (_leader, party) => { for (const mage of party) mage.hp = 1; });
    const outcome = takeShortRest(run, ['life'], { safe: true }, new Dice(8));
    equal(outcome.restored.map((entry) => entry.member), ['life'], 'only the one who rests');
    equal(partyOf(run).map((mage) => mage.hp > 1), [false, true], 'the other is still hurt');
  }],

  ['risks an ambush out in the country, worse by night, and none by a town', () => {
    const run = partyRun();
    run.hour = 12;
    equal(shortRestRisk(run, { safe: true }), 0, 'safe inside walls');
    equal(shortRestRisk(run, { safe: false, tile: { x: capitol.x, y: capitol.y } }), 0, 'safe at a town gate');
    const tile = riskyTile(run);
    const day = shortRestRisk(run, { safe: false, tile });
    run.hour = 23;
    assert(shortRestRisk(run, { safe: false, tile }) > day, 'night is riskier');
  }],

  ['cuts an ambushed rest short, and gives nothing back', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const run = partyRun(1, seed);
      run.hour = 23;
      withParty(run, (_leader, party) => { party[0].hp = 1; });
      const outcome = takeShortRest(run, null, { safe: false, tile: riskyTile(run) }, new Dice(seed));
      if (!outcome.ambush) continue;
      equal([outcome.restored.length, partyOf(run)[0].hp], [0, 1], 'nobody rested');
      assert(outcome.hours > 0 && outcome.hours < SHORT_REST_HOURS.max, 'it was cut short');
      assert(outcome.ambush.spawns.length > 0, 'something is there to fight');
      return;
    }
    throw new Error('no ambush in 200 rests');
  }],

  ['on foot, the party clock follows whoever has spent the most time', () => {
    const run = partyRun(3);
    run.hour = 8;
    const start = { ...run.pos };
    enterArea(run);
    equal(spendAreaTime(run, ['objects'], 1), 0, 'no midnight passes');
    equal(run.hour, 9, 'one hour: the clock moves one');
    spendAreaTime(run, ['life'], 3);
    equal(run.hour, 11, 'three hours for another: the clock catches up to three');
    spendAreaTime(run, ['hexcraft'], 2);
    equal(run.hour, 11, 'two for the third: nobody passed the slowest');
    equal([areaHours(run.area!), areaLead(run.area!)], [3, { member: 'life', hours: 3 }], 'the one who spent most leads');
    spendAreaTime(run, ['objects', 'life', 'hexcraft'], 1);
    equal(run.hour, 12, 'a fight costs everyone an hour');
    run.pos = { x: start.x + 2, y: start.y };
    equal(leaveArea(run), 4, 'four hours out');
    equal([run.pos, run.area], [start, null], 'back where the party set out');
    enterArea(run);
    run.hour = 23;
    equal(spendAreaTime(run, ['objects'], 2), 1, 'a midnight passes');
    equal(spendAreaTime(run, [], 2) + spendAreaTime(run, ['life'], 0), 0, 'nothing done, no time');
  }],

  ['on foot, each traveller keeps their own time: pick, rest, wait, and move on only in step', () => {
    const run = partyRun(3);
    run.hour = 8;
    enterArea(run);
    const area = run.area!;
    // Five herbs, half an hour each: two pick two, one picks one.
    spendAreaTime(run, ['objects'], 1);
    spendAreaTime(run, ['life'], 1);
    spendAreaTime(run, ['hexcraft'], 0.5);
    equal(run.hour, 9, 'five herbs take one hour between three');
    assert(!areaInStep(area, ['objects', 'life', 'hexcraft']), 'one is behind');
    equal([hoursBehind(area, 'hexcraft'), gapLabel(hoursBehind(area, 'hexcraft'))], [0.5, '30m'], 'half an hour behind');
    equal(gapLabel(1.5), '1:30h', 'longer gaps in hours');
    equal(waitInArea(run, 'hexcraft').hours, 0.5, 'waiting catches up');
    assert(areaInStep(area, ['objects', 'life', 'hexcraft']), 'in step again');
    equal(run.hour, 9, 'catching up moves no clock');
    // Two rest 1.5 h; the third keeps picking.
    const rest = restTogether(run, ['life', 'hexcraft'], 1.5);
    equal([rest.until, memberHours(area, 'life'), memberHours(area, 'hexcraft')], [2.5, 2.5, 2.5], 'both get up at the same time');
    assert(!restOver(area, ['objects'], rest.until), 'still resting');
    spendAreaTime(run, ['objects'], 0.5);
    spendAreaTime(run, ['objects'], 0.5);
    assert(!restOver(area, ['objects'], rest.until), 'two herbs in');
    spendAreaTime(run, ['objects'], 0.5);
    assert(restOver(area, ['objects'], rest.until), 'the third herb and they get up');
    assert(restOver(area, [], 9), 'with nobody keeping on, a rest is over at once');
    equal(waitInArea(run, 'objects').hours, 0.5, 'in front, a wait is half an hour');
    equal(run.hour, 11, 'and that one moves the clock');
  }],

  ['on foot, walks only the country round where the party set out', () => {
    const run = partyRun();
    const everywhere = resolveLocale(run, OPEN_WORLD_ID)!;
    run.area = { tile: capitolTile, spent: {} };
    const here = resolveLocale(run, OPEN_WORLD_ID)!;
    const bounds = areaBounds(capitolTile);
    const inside = (cell: Cell): boolean => inAreaBounds(bounds, cellWorldTile(cell));
    assert(here.packs.every(inside) && here.secrets.every(inside), 'nothing waits past the edge');
    assert(here.packs.length + here.secrets.length < everywhere.packs.length + everywhere.secrets.length, 'the rest of the world is not walked');
    equal([bounds.x1 - bounds.x0, bounds.y1 - bounds.y0], [4, 4], 'five tiles across and down');
  }],

  ['ends the walk on foot at a town gate', () => {
    const run = partyRun();
    run.area = { tile: capitolTile, spent: { objects: 2 } };
    const place = resolveLocale(run, OPEN_WORLD_ID)!;
    const gate = openWorldDef().exits.find((exit) => exit.place === 'capitol')!;
    const travel = place.travel?.(run, gate);
    equal(travel?.t, 'locale', 'into the town');
    equal([run.area, run.pos], [null, { x: capitol.x, y: capitol.y }], 'the party stands in the town, off its feet');
  }],
];

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration search: ${tests.length} checks passed.`);
