import { Mage } from '../core/Mage';
import { resolveLocale } from '../pve/exploration/locales';
import {
  cellWorldTile,
  OPEN_WORLD_ID,
  openWorldCell,
  openWorldDef,
  openWorldMainland,
  openWorldModel,
  openWorldPace,
  openWorldPacks,
  openWorldSecrets,
  WORLD_SCALE,
} from '../pve/exploration/openWorld';
import { capturePartySnapshot, restoreParty } from '../pve/exploration/party';
import { createRun, type ExplorationRun } from '../pve/exploration/run';
import { createWorld, PLACES, placeById, regionAt } from '../pve/exploration/world';
import { validateLocale } from '../world/locale';
import { findPath } from '../world/pathfind';

/** WALK_SPEED in world/walker.ts, which cannot load outside Vite. */
const WALK_SPEED = 4.4;

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
    equal([def.terrain[0].length, def.terrain.length], [world.w * WORLD_SCALE, world.h * WORLD_SCALE], 'ten tiles to a world tile');
    equal(validateLocale(def), [], 'the world map is sound');
    assert(openWorldDef() === def && openWorldModel() === openWorldModel(), 'built once');
    const model = openWorldModel();
    const capitol = placeById('capitol')!;
    const inside = openWorldCell(capitol);
    assert(!model.blocked(inside.x, inside.y) && !model.exitAt(inside.x, inside.y), 'the party arrives on open ground beside a gate');
    equal(cellWorldTile(inside), { x: capitol.x, y: capitol.y }, 'on the Capitol tile');
    equal(model.exitAt(inside.x, inside.y - 1)?.place, 'capitol', 'just below the Capitol gate');
  }],

  ['puts neighbouring towns most of a minute apart on the road, behind no wall', () => {
    const model = openWorldModel();
    const land = openWorldMainland();
    for (const p of PLACES) {
      if (regionAt(world, p.x, p.y) === 'white') continue;
      const at = openWorldCell(p);
      assert(land[at.y * model.w + at.x], `${p.name} can be walked to from the start`);
    }
    const from = openWorldCell(placeById('kerusai')!);
    const to = openWorldCell(placeById('capitol')!);
    const path = findPath(model.w, model.h, model.blocked, from, to, 2_000_000);
    assert(path, 'Kerusai and the Capitol are joined on foot');
    let cells = 0;
    let prev = from;
    for (const cell of path) {
      cells += Math.hypot(cell.x - prev.x, cell.y - prev.y);
      prev = cell;
    }
    const seconds = cells / WALK_SPEED;
    assert(seconds > 35 && seconds < 60, `Kerusai to the Capitol takes about 45 s at full pace (${seconds.toFixed(0)} s)`);
  }],

  ['keeps every white-region cell beyond the solid wall', () => {
    const model = openWorldModel();
    const land = openWorldMainland();
    for (let y = 0; y < model.h; y++) for (let x = 0; x < model.w; x++) {
      if (regionAt(world, Math.floor(x / WORLD_SCALE), Math.floor(y / WORLD_SCALE)) !== 'white') continue;
      assert(!land[y * model.w + x], `white ground at ${x},${y} cannot be reached`);
    }
  }],

  ['walks full pace on the road and slower in rough country', () => {
    const def = openWorldDef();
    const find = (ch: string): { x: number; y: number } => {
      for (let y = 0; y < def.terrain.length; y++) {
        const x = def.terrain[y].indexOf(ch);
        if (x >= 0) return { x, y };
      }
      throw new Error(`no '${ch}' on the map`);
    };
    const road = find('=');
    equal(openWorldPace(road.x, road.y), 1, 'full pace on the road');
    const ford = find('_');
    assert(openWorldPace(ford.x, ford.y) < 0.6, 'fords are slow going');
    const tree = find('T');
    assert(openWorldPace(tree.x, tree.y + 1) < 1, 'off the road is slower');
  }],

  ['makes reachable places gates, and leaves desert gates behind the wall', () => {
    const def = openWorldDef();
    const run = freshRun();
    const place = resolveLocale(run, OPEN_WORLD_ID);
    assert(place?.world && place.travel, 'the world resolves as a walkable place');
    for (const p of PLACES) {
      const exit = def.exits.find((e) => e.place === p.id);
      if (regionAt(world, p.x, p.y) === 'white') {
        assert(!exit, `${p.name} has no accessible gate before the wall falls`);
        continue;
      }
      assert(exit, `${p.name} has a gate`);
      equal(cellWorldTile(exit), { x: p.x, y: p.y }, `${p.name}'s gate stands on its tile`);
      const travel = place.travel(run, exit);
      if (p.locale) {
        equal(travel, { t: 'locale', locale: p.locale, notice: `You enter ${p.name}.` }, `${p.name} can be entered`);
        equal(run.pos, { x: p.x, y: p.y }, 'the run stands on the place it entered');
      } else if (p.dungeon) {
        equal(travel, { t: 'dungeon', place: p.id }, `${p.name} leads into its dungeon`);
      } else {
        equal(travel.t, 'stay', `${p.name} turns the party away`);
      }
    }
  }],

  ['rolls packs across the country each day, many on the roads, never at a town gate', () => {
    const run = freshRun(21);
    const model = openWorldModel();
    const today = openWorldPacks(run);
    assert(today.length >= 120, `plenty of packs roam (${today.length})`);
    const onRoad = today.filter((pack) => model.def.terrain[pack.y][pack.x] === '=').length;
    assert(onRoad >= 20, `many wait on the roads (${onRoad})`);
    assert(today.every((pack) => (pack.pace ?? 0) >= 3 && (pack.pace ?? 0) <= 7), 'every pack has a chase pace');
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
    assert(today.every((pack) => pack.zone !== 'white'), 'hunters stay outside the wall');
  }],

  ['hides caches for the whole run and hands out a find: things, never coin or experience', () => {
    const run = freshRun(4);
    const caches = openWorldSecrets(run);
    assert(caches.length >= 15, `caches lie across the world (${caches.length})`);
    equal(openWorldSecrets(run), caches, 'the same run hides them in the same places');
    run.day += 3;
    equal(openWorldSecrets(run), caches, 'they wait day after day');
    const place = resolveLocale(run, OPEN_WORLD_ID)!;
    const gold = run.gold;
    const before = JSON.stringify(restoreParty(run.party)[0]);
    const result = place.search!(run, caches[0]);
    assert(!result.message.includes('XP'), 'a cache teaches nothing');
    equal([run.gold, run.xp], [gold, 0], 'and holds no coin');
    assert(JSON.stringify(restoreParty(run.party)[0]) !== before, 'but something is found');
  }],
];

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration open world: ${tests.length} checks passed.`);
