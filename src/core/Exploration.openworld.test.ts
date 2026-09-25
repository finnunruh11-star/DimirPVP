import { Mage } from '../core/Mage';
import { resolveLocale } from '../pve/exploration/locales';
import {
  cellWorldTile,
  OPEN_WORLD_ID,
  openWorldCell,
  openWorldDef,
  openWorldModel,
  openWorldPacks,
  openWorldSecrets,
  WORLD_SCALE,
} from '../pve/exploration/openWorld';
import { capturePartySnapshot } from '../pve/exploration/party';
import { createRun, type ExplorationRun } from '../pve/exploration/run';
import { createWorld, PLACES, placeById, regionAt } from '../pve/exploration/world';
import { validateLocale } from '../world/locale';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}: expected ${e}, received ${a}`);
}

const world = createWorld();

function freshRun(seed = 11): ExplorationRun {
  const mage = new Mage({ name: 'Walker', isAI: false, team: 1, position: { x: 0, y: 0 }, loadout: [] });
  mage.assignFlatStats(3);
  return createRun(seed, capturePartySnapshot([mage]));
}

const tests: [name: string, run: () => void][] = [
  ['lays the whole world out on foot, sound and built once', () => {
    const def = openWorldDef();
    equal([def.terrain[0].length, def.terrain.length], [world.w * WORLD_SCALE, world.h * WORLD_SCALE], 'three tiles to a world tile');
    equal(validateLocale(def), [], 'the world map is sound');
    assert(openWorldDef() === def && openWorldModel() === openWorldModel(), 'built once');
    const model = openWorldModel();
    const capitol = placeById('capitol')!;
    const inside = openWorldCell(capitol);
    assert(!model.blocked(inside.x, inside.y) && !model.exitAt(inside.x, inside.y), 'the party arrives on open ground beside a gate');
    equal(cellWorldTile(inside), { x: capitol.x, y: capitol.y + 1 }, 'just below the Capitol gate');
  }],

  ['makes every place a gate, and says so when it is closed', () => {
    const def = openWorldDef();
    const run = freshRun();
    const place = resolveLocale(run, OPEN_WORLD_ID);
    assert(place?.world && place.travel, 'the world resolves as a walkable place');
    for (const p of PLACES) {
      const exit = def.exits.find((e) => e.place === p.id);
      assert(exit, `${p.name} has a gate`);
      equal(cellWorldTile(exit), { x: p.x, y: p.y }, `${p.name}'s gate stands on its tile`);
      const travel = place.travel(run, exit);
      if (p.locale) {
        equal(travel, { t: 'locale', locale: p.locale, notice: `You enter ${p.name}.` }, `${p.name} can be entered`);
        equal(run.pos, { x: p.x, y: p.y }, 'the run stands on the place it entered');
      } else {
        equal(travel.t, 'stay', `${p.name} turns the party away`);
      }
    }
  }],

  ['rolls packs across the country each day, never at a town gate', () => {
    const run = freshRun(21);
    const model = openWorldModel();
    const today = openWorldPacks(run);
    assert(today.length >= 25, `plenty of packs roam (${today.length})`);
    equal(openWorldPacks(run), today, 'the same day keeps the same packs');
    run.day += 1;
    assert(JSON.stringify(openWorldPacks(run)) !== JSON.stringify(today), 'a new day brings new packs');
    const towns = PLACES.filter((p) => p.kind === 'city');
    for (const pack of today) {
      assert(!model.blocked(pack.x, pack.y), `${pack.id} stands on open ground`);
      const tile = cellWorldTile(pack);
      assert(towns.every((t) => Math.max(Math.abs(t.x - tile.x), Math.abs(t.y - tile.y)) > 4), `${pack.id} keeps away from towns`);
      equal(pack.zone, regionAt(world, tile.x, tile.y), `${pack.id} fights like its region`);
    }
    assert(today.some((pack) => pack.zone === 'white'), 'the desert has its hunters');
  }],

  ['hides caches for the whole run and hands out a find', () => {
    const run = freshRun(4);
    const caches = openWorldSecrets(run);
    assert(caches.length >= 15, `caches lie across the world (${caches.length})`);
    equal(openWorldSecrets(run), caches, 'the same run hides them in the same places');
    run.day += 3;
    equal(openWorldSecrets(run), caches, 'they wait day after day');
    const place = resolveLocale(run, OPEN_WORLD_ID)!;
    const gold = run.gold;
    const result = place.search!(run, caches[0]);
    assert(result.message.includes('+1 XP'), 'a cache teaches something');
    assert(run.gold >= gold, 'and never costs anything');
  }],
];

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration open world: ${tests.length} checks passed.`);
