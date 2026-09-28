import { Mage } from '../core/Mage';
import { areaBounds, inAreaBounds } from '../pve/exploration/area';
import { resolveLocale } from '../pve/exploration/locales';
import { cellWorldTile, OPEN_WORLD_ID, openWorldModel, siteArrival } from '../pve/exploration/openWorld';
import { capturePartySnapshot } from '../pve/exploration/party';
import { createRun, type ExplorationRun } from '../pve/exploration/run';
import { parseRun } from '../pve/exploration/save';
import {
  createSite, parseSite, siteDone, siteFind, siteGoals, sitePlan, siteWokeFlag, SITE_RADIUS, type EncounterSite,
} from '../pve/exploration/site';
import type { Sighting } from '../pve/exploration/journey';
import { createWorld, PLACES, regionAt } from '../pve/exploration/world';

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

/** Forest tiles well away from any town. */
const SPOTS = (() => {
  const out: { x: number; y: number }[] = [];
  for (let y = 2; y < world.h - 2; y++) for (let x = 2; x < world.w - 2; x++) {
    if (regionAt(world, x, y) !== 'forest') continue;
    if (PLACES.some((p) => Math.hypot(p.x - x, p.y - y) < 4)) continue;
    out.push({ x, y });
  }
  return out;
})();

function sighting(kind: Sighting['kind'], cell: { x: number; y: number }): Sighting {
  return {
    kind, cell, zone: 'forest', depth: 3, title: 'TEST', bearing: '3 tiles east', text: '',
    herb: kind === 'herbs' ? 'herbMoonleaf' : undefined,
    site: kind === 'cache' ? "Woodcutter's hut" : undefined,
  };
}

/** A site of `kind` with `twist`, stood on a spot where all of it fits. */
function siteWith(kind: EncounterSite['kind'], twist: EncounterSite['twist']): { run: ExplorationRun; site: EncounterSite } {
  for (const cell of SPOTS) {
    for (let steps = 0; steps < 40; steps++) {
      const run = freshRun();
      run.steps = steps;
      const site = createSite(run, sighting(kind, cell), { x: cell.x - 1, y: cell.y }, { dest: { x: cell.x + 6, y: cell.y }, mode: 'explore' });
      if (!site || site.twist !== twist) continue;
      enter(run, site);
      const place = resolveLocale(run, OPEN_WORLD_ID)!;
      const plan = sitePlan(site);
      if (place.packs.length === plan.packs.length && place.secrets.length === plan.things.length) return { run, site };
    }
  }
  throw new Error(`no spot fits a ${kind}/${twist} site`);
}

function enter(run: ExplorationRun, site: EncounterSite): void {
  const tile = { x: site.from!.x + 1, y: site.from!.y };
  run.pos = { ...tile };
  run.area = { tile, spent: {}, radius: SITE_RADIUS, site };
  const at = siteArrival(tile, site);
  run.locale = { id: OPEN_WORLD_ID, x: at.x, y: at.y };
}

const tests: [name: string, run: () => void][] = [
  ['turns herbs, packs and caches into sites, and leaves events on the map', () => {
    const run = freshRun();
    const cell = SPOTS[0];
    assert(createSite(run, sighting('event', cell)) === null, 'events stay on the map');
    const a = createSite(run, sighting('herbs', cell));
    const b = createSite(run, sighting('herbs', cell));
    equal(a, b, 'the same sighting makes the same site');
    run.steps += 1;
    assert(createSite(run, sighting('herbs', cell))?.seed !== a?.seed, 'a later sighting is a different site');
  }],

  ['always puts something else at a site besides what was spotted', () => {
    for (const [kind, twist] of [
      ['pack', 'lightSleeper'], ['pack', 'sentry'], ['pack', 'stash'],
      ['herbs', 'patrol'], ['herbs', 'snake'], ['herbs', 'sleepers'],
      ['cache', 'trap'], ['cache', 'guarded'], ['cache', 'scattered'],
    ] as const) {
      const { site } = siteWith(kind, twist);
      const plan = sitePlan(site);
      if (kind === 'pack') assert(plan.packs.some((p) => p.role === 'camp' && p.asleep), `${twist}: a sleeping camp`);
      if (kind === 'herbs') assert(plan.things.filter((t) => t.role === 'herb').length >= 3, `${twist}: several patches`);
      if (kind === 'cache') assert(plan.things.some((t) => t.role === 'cache'), `${twist}: the cache`);
      const extras = plan.packs.length + plan.things.length - (kind === 'herbs' ? plan.things.length : 1);
      if (twist === 'lightSleeper') assert(plan.packs[0].wakeTiles > 3, 'a light sleeper wakes from further off');
      else assert(extras >= (twist === 'snake' || twist === 'trap' ? 0 : 1), `${twist}: something besides`);
      assert(plan.things.every((t) => t.hold > 0), `${twist}: finds are held for`);
    }
  }],

  ['lays a site out inside its small area, on open ground, the same every time', () => {
    const { run, site } = siteWith('herbs', 'patrol');
    const place = resolveLocale(run, OPEN_WORLD_ID)!;
    const model = openWorldModel();
    const bounds = areaBounds(run.area!.tile, SITE_RADIUS);
    for (const thing of [...place.packs, ...place.secrets]) {
      assert(!model.blocked(thing.x, thing.y), `${thing.id} stands on open ground`);
      assert(inAreaBounds(bounds, cellWorldTile(thing)), `${thing.id} lies inside the site`);
    }
    const arrival = siteArrival(run.area!.tile, site);
    assert(inAreaBounds(bounds, cellWorldTile(arrival)), 'the party arrives inside the site');
    const patrol = place.packs[0];
    run.groupsBeaten[patrol.id] = 0;
    const again = resolveLocale(run, OPEN_WORLD_ID)!;
    equal(again.secrets.map((s) => [s.x, s.y]), place.secrets.map((s) => [s.x, s.y]), 'beating a pack moves nothing');
    assert(!again.packs.some((p) => p.id === patrol.id), 'a beaten pack is gone');
  }],

  ['keeps sleepers asleep until something at the site wakes', () => {
    const { run, site } = siteWith('cache', 'guarded');
    assert(resolveLocale(run, OPEN_WORLD_ID)!.packs.every((p) => p.asleep), 'the guards sleep');
    run.flags.push(siteWokeFlag(site));
    assert(resolveLocale(run, OPEN_WORLD_ID)!.packs.every((p) => !p.asleep), 'once woken, awake for good');
  }],

  ['picks herbs, tracks the goal and is done once all are picked', () => {
    const { run, site } = siteWith('herbs', 'patrol');
    const place = resolveLocale(run, OPEN_WORLD_ID)!;
    assert(!siteDone(run, site), 'not done on arrival');
    const before = JSON.stringify(run.party);
    for (const secret of place.secrets) {
      const result = place.search!(run, secret);
      assert(!result.fight, 'plain herbs do not fight');
      run.flags.push(`secret:${secret.id}`);
    }
    assert(JSON.stringify(run.party) !== before, 'the herbs went into the packs');
    assert(siteGoals(run, site).every((goal) => goal.done || goal.optional), 'every goal ticked');
    assert(siteDone(run, site), 'done');
  }],

  ['springs a baited cache until its ambushers are beaten', () => {
    const { run, site } = siteWith('cache', 'trap');
    const secret = resolveLocale(run, OPEN_WORLD_ID)!.secrets[0];
    const first = siteFind(run, site, secret);
    assert(first.fight && first.trap && first.fight.hunting, 'the bait springs');
    equal(siteFind(run, site, secret).fight?.id, first.fight.id, 'still a trap until beaten');
    run.groupsBeaten[first.fight.id] = 0;
    assert(!siteFind(run, site, secret).fight, 'then it gives its due');
  }],

  ['hides a snake in exactly one patch', () => {
    const { run, site } = siteWith('herbs', 'snake');
    const secrets = resolveLocale(run, OPEN_WORLD_ID)!.secrets;
    const fights = secrets.filter((secret) => siteFind(run, site, secret).fight);
    equal(fights.length, 1, 'one snake');
  }],

  ['saves a site with the area and rejects rubbish', () => {
    const { run, site } = siteWith('pack', 'sentry');
    const back = parseRun(JSON.stringify(run));
    equal(back?.area?.site, site, 'the site survives a save');
    equal(back?.area?.radius, SITE_RADIUS, 'and its size');
    equal(parseSite(JSON.parse(JSON.stringify(site))), site, 'round-trips');
    assert(parseSite({ ...site, kind: 'dragon' }) === null, 'unknown kind');
    assert(parseSite({ ...site, twist: 'trap' }) === null, 'a twist of another kind');
    assert(parseSite('site') === null && parseSite(null) === null, 'not an object');
  }],
];

let failed = 0;
for (const [name, run] of tests) {
  try {
    run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}\n     ${(error as Error).message}`);
  }
}
if (failed) {
  console.error(`${failed} of ${tests.length} site tests failed`);
  process.exit(1);
}
console.log(`All ${tests.length} site tests passed.`);
