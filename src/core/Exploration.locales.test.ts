import { Mage } from '../core/Mage';
import { resolveLocale, type ResolvedLocale } from '../pve/exploration/locales';
import { capturePartySnapshot, restoreParty } from '../pve/exploration/party';
import { createRun, type ExplorationRun } from '../pve/exploration/run';
import { SHOPS } from '../pve/exploration/shops';
import { TOWNS } from '../pve/exploration/towns';
import { volcanicWilds, WILDS_ID } from '../pve/exploration/wilds';
import { placeById } from '../pve/exploration/world';
import { buildLocaleModel, validateLocale } from '../world/locale';
import { findPath, floodReach } from '../world/pathfind';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}: expected ${e}, received ${a}`);
}

function freshRun(seed = 21): ExplorationRun {
  const mage = new Mage({ name: 'Walker', isAI: false, team: 1, position: { x: 0, y: 0 }, loadout: ['shadow', 'mind'] });
  mage.assignFlatStats(3);
  return createRun(seed, capturePartySnapshot([mage]));
}

/** Every secret and pack in a place stands where the party can walk to it. */
function assertReachable(place: ResolvedLocale): void {
  const model = buildLocaleModel(place.def);
  const reach = floodReach(model.w, model.h, model.blocked, place.def.spawn);
  const open = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < model.w && y < model.h && reach[y * model.w + x] === 1;
  for (const secret of place.secrets) {
    const ok = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => open(secret.x + dx, secret.y + dy));
    assert(ok, `${place.def.id}: secret ${secret.id} cannot be reached`);
  }
  for (const pack of place.packs) assert(open(pack.x, pack.y), `${place.def.id}: pack ${pack.id} stands out of reach`);
}

const TOWN_LIST = Object.values(TOWNS);

const tests: [name: string, run: () => void][] = [
  ['every town is sound and every one of its shops has a keeper at the door', () => {
    assert(TOWN_LIST.length >= 3, 'three towns at least');
    for (const town of TOWN_LIST) {
      equal(validateLocale(town), [], `${town.id} problems`);
      const keepers = buildLocaleModel(town).keepers.map((k) => k.shop).sort();
      const shops = town.buildings.filter((b) => b.shop).map((b) => b.shop!).sort();
      equal(keepers, shops, `${town.id} keepers`);
      assert(new Set(shops).size === shops.length, `${town.id} lists a shop twice`);
    }
    const capitol = TOWNS.capitol;
    assert(capitol, 'the Capitol exists');
    const capitolShops = Object.keys(SHOPS).filter((id) => id.startsWith('capitol-')).sort();
    const placed = capitol.buildings.filter((b) => b.shop).map((b) => b.shop!).sort();
    equal(placed, capitolShops, 'the Capitol houses every one of its shops');
  }],

  ['towns resolve as safe places with no packs', () => {
    const run = freshRun();
    for (const town of TOWN_LIST) {
      const place = resolveLocale(run, town.id);
      assert(place && place.kind === 'town', `${town.id} resolves as a town`);
      equal(place.packs.length, 0, `${town.id} packs`);
    }
    assert(resolveLocale(run, 'atlantis') === null, 'an unknown place resolves to nothing');
  }],

  ['a path finds its way round a wall and never cuts a corner', () => {
    const wall = new Set(['2,0', '2,1', '2,2', '2,3']);
    const blocked = (x: number, y: number): boolean => wall.has(`${x},${y}`);
    const path = findPath(5, 5, blocked, { x: 0, y: 0 }, { x: 4, y: 0 });
    assert(path, 'a way round exists');
    assert(path.some((c) => c.y === 4), 'the path goes under the wall');
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      if (a.x !== b.x && a.y !== b.y) assert(!blocked(b.x, a.y) && !blocked(a.x, b.y), 'no corner is cut');
    }
    assert(findPath(5, 5, (x) => x === 2, { x: 0, y: 0 }, { x: 4, y: 0 }) === null, 'a sealed side cannot be reached');
  }],

  ['the Small Forest is a dive now: its old glades no longer resolve', () => {
    equal(placeById('small-forest')?.dungeon, 'forest', 'the Small Forest is a dungeon');
    assert(!placeById('small-forest')?.locale, 'with no walkable map of its own');
    for (const id of ['forest:1', 'forest:3', 'forest:x']) assert(resolveLocale(freshRun(), id) === null, `${id} is gone`);
  }],

  ['the wilds are sound and every secret and pack can be walked to', () => {
    const def = volcanicWilds();
    equal(validateLocale(def), [], 'wilds problems');
    const place = resolveLocale(freshRun(), WILDS_ID);
    assert(place && place.kind === 'wilds' && place.fogChunk, 'the wilds resolve under fog');
    assert(place.secrets.length >= 10, 'plenty to find');
    assert(place.packs.some((p) => p.elite), 'some packs are elite');
    assertReachable(place);
    for (const mark of place.landmarks ?? []) {
      assert(mark.x >= 0 && mark.y >= 0 && mark.x < def.terrain[0].length && mark.y < def.terrain.length, `${mark.id} is on the map`);
    }
  }],

  ['wild packs reroll each day but not within one', () => {
    const run = freshRun(8);
    const today = resolveLocale(run, WILDS_ID)!.packs.map((p) => p.spawns);
    equal(resolveLocale(run, WILDS_ID)!.packs.map((p) => p.spawns), today, 'the same day, the same packs');
    let changed = false;
    for (let day = 2; day < 6 && !changed; day++) {
      run.day = day;
      changed = JSON.stringify(resolveLocale(run, WILDS_ID)!.packs.map((p) => p.spawns)) !== JSON.stringify(today);
    }
    assert(changed, 'a later day brings different packs');
  }],

  ['a guarded secret fights first and pays out after; the lookout reveals the map', () => {
    const run = freshRun(9);
    const place = resolveLocale(run, WILDS_ID)!;
    const hoard = place.secrets.find((s) => s.id === 'wilds-hoard');
    assert(hoard && place.search, 'the hoard is searchable');
    const first = place.search(run, hoard);
    assert(first.fight, 'the keeper wakes');
    const gold = run.gold;
    const carried = (): number => restoreParty(run.party)[0].bag.length;
    const before = carried();
    run.groupsBeaten[first.fight.id] = run.day;
    const second = place.search(run, hoard);
    assert(!second.fight && carried() > before, 'the hoard gives up its kit once its keeper falls');
    equal(run.gold, gold, 'and not a coin of it');
    const lookout = place.secrets.find((s) => s.id === 'wilds-lookout');
    assert(lookout && place.search(run, lookout).revealAll, 'the lookout lifts the fog');
  }],
];

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration locales: ${tests.length} checks passed.`);
