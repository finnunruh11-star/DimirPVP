import { Mage } from '../core/Mage';
import { forestFightDepth, forestGlade, forestLocaleId } from '../pve/exploration/forest';
import { resolveLocale, type ResolvedLocale } from '../pve/exploration/locales';
import { capturePartySnapshot } from '../pve/exploration/party';
import { createRun, type ExplorationRun } from '../pve/exploration/run';
import { SHOPS } from '../pve/exploration/shops';
import { TOWNS } from '../pve/exploration/towns';
import { volcanicWilds, WILDS_ID } from '../pve/exploration/wilds';
import { buildLocaleModel, validateLocale, type ExitDef, type LocaleDef } from '../world/locale';
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

function exitTo(def: LocaleDef, to: ExitDef['to']): ExitDef {
  const exit = def.exits.find((e) => e.to === to);
  assert(exit, `${def.id} has a '${to}' exit`);
  return exit;
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

  ['forest glades are sound, walkable and the same every time', () => {
    for (const seed of [1, 99, 424242]) {
      for (let depth = 1; depth <= 15; depth++) {
        const glade = forestGlade(seed, depth);
        equal(validateLocale(glade.def), [], `seed ${seed} depth ${depth}`);
        equal(glade.def.id, forestLocaleId(depth), 'glade id');
        equal(forestGlade(seed, depth).def.terrain, glade.def.terrain, 'the same glade twice');
        exitTo(glade.def, 'deeper');
        exitTo(glade.def, 'back');
        const run = freshRun(seed);
        const place = resolveLocale(run, glade.def.id);
        assert(place && place.kind === 'forest', 'a glade resolves');
        assertReachable(place);
      }
    }
    assert(forestFightDepth(1) === 1 && forestFightDepth(10) < 10, 'the forest stays gentle');
    assert(resolveLocale(freshRun(), 'forest:0') === null && resolveLocale(freshRun(), 'forest:x') === null, 'bad depths are refused');
  }],

  ['going deeper means a fight unless the way was cleared today; the first glade leads out', () => {
    const run = freshRun(5);
    const glade = resolveLocale(run, forestLocaleId(3));
    assert(glade?.travel, 'glades have travel');
    glade.onEnter?.(run);
    equal([run.forest.depth, run.forest.deepest], [3, 3], 'depth recorded');

    const down = glade.travel(run, exitTo(glade.def, 'deeper'));
    assert(down.t === 'fight', 'the next depth is guarded');
    equal(down.then.locale, forestLocaleId(4), 'a win leads deeper');
    equal(down.fleeTo?.locale, forestLocaleId(3), 'running stays on this depth');
    run.groupsBeaten[down.pack.id] = run.day;
    const again = glade.travel(run, exitTo(glade.def, 'deeper'));
    assert(again.t === 'locale' && again.locale === forestLocaleId(4), 'a cleared way is free today');
    run.day += 1;
    assert(glade.travel(run, exitTo(glade.def, 'deeper')).t === 'fight', 'the guard is back tomorrow');

    const first = resolveLocale(run, forestLocaleId(1));
    assert(first?.travel, 'the first glade');
    equal(first.travel(run, exitTo(first.def, 'back')).t, 'world', 'the first glade leads out');
    const up = glade.travel(run, exitTo(glade.def, 'back'));
    const target = up.t === 'fight' ? up.then.locale : up.t === 'locale' ? up.locale : null;
    equal(target, forestLocaleId(2), 'turning back climbs one depth');
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
    run.groupsBeaten[first.fight.id] = run.day;
    const second = place.search(run, hoard);
    assert(!second.fight && run.gold > gold, 'the hoard pays out once its keeper falls');
    const lookout = place.secrets.find((s) => s.id === 'wilds-lookout');
    assert(lookout && place.search(run, lookout).revealAll, 'the lookout lifts the fog');
  }],
];

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration locales: ${tests.length} checks passed.`);
