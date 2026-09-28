import { Mage } from '../core/Mage';
import { partyOf, rest } from '../pve/exploration/economy';
import { resolveLocale, type ResolvedLocale } from '../pve/exploration/locales';
import { cellWorldTile, OPEN_WORLD_ID, openWorldModel, openWorldPacks } from '../pve/exploration/openWorld';
import { capturePartySnapshot } from '../pve/exploration/party';
import {
  QUEST_CALM,
  QUEST_LODGE,
  QUEST_OVER,
  questActive,
  questFightWon,
  questJob,
  questLines,
  questReady,
  reportQuestJob,
  takeQuestJob,
} from '../pve/exploration/quest';
import { createRun, type ExplorationRun } from '../pve/exploration/run';
import { createWorld, placeById, regionAt } from '../pve/exploration/world';

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

function freshRun(seed = 17): ExplorationRun {
  const mage = new Mage({ name: 'Walker', isAI: false, team: 1, position: { x: 0, y: 0 }, loadout: ['pierce'] });
  mage.assignFlatStats(3);
  return createRun(seed, capturePartySnapshot([mage]));
}

function openWorld(run: ExplorationRun): ResolvedLocale {
  const place = resolveLocale(run, OPEN_WORLD_ID);
  assert(place, 'the world resolves');
  return place;
}

const fromKerusai = (x: number, y: number): number => Math.max(Math.abs(x - kerusai.x), Math.abs(y - kerusai.y));

/** Take the first job and put its dead down. */
function deadDone(run: ExplorationRun): void {
  assert(takeQuestJob(run).ok, 'the first job is taken');
  assert(questFightWon(run, 'quest:dead'), 'the fight counts');
}

const tests: [name: string, run: () => void][] = [
  ['sends a new traveller to the keeper of the Kerusai Lodge first', () => {
    const run = freshRun();
    equal(questJob(run)?.id, 'dead', 'the first job is the dead of the marsh');
    assert(questLines(run).some((line) => line.includes('Kerusai Lodge')), 'the tracker points at the Lodge');
    assert(!openWorld(run).packs.some((pack) => pack.id.startsWith('quest:')), 'nothing waits in the marsh before the job is taken');
    equal(questFightWon(run, 'quest:dead'), null, 'a fight before the job counts for nothing');
  }],

  ['puts two zombies in the marsh north-east of Kerusai once the job is taken', () => {
    const run = freshRun();
    assert(takeQuestJob(run).ok, 'the job is taken');
    assert(!takeQuestJob(run).ok, 'and only once');
    const dead = openWorld(run).packs.find((pack) => pack.id === 'quest:dead');
    assert(dead, 'the dead are out');
    assert(!openWorldModel().blocked(dead.x, dead.y), 'on ground that can be walked');
    const tile = cellWorldTile(dead);
    equal(regionAt(world, tile.x, tile.y), 'black', 'in the swamps');
    assert(tile.x > kerusai.x && tile.y < kerusai.y && fromKerusai(tile.x, tile.y) <= 8, 'a short walk north-east of Kerusai');
    equal([dead.spawns?.length, dead.depth, dead.zone], [2, 1, 'black'], 'two gentle zombies, fought in the swamp');
    assert(questLines(run).some((line) => line.includes('north-east')), 'the tracker gives the heading');
  }],

  ['pays for the dead, then has the Bogcap job the next day', () => {
    const run = freshRun();
    deadDone(run);
    assert(questReady(run), 'ready to report');
    assert(!openWorld(run).packs.some((pack) => pack.id === 'quest:dead'), 'the dead stay down');
    const report = reportQuestJob(run);
    assert(report.ok && report.message.includes('+4g'), `reported: ${report.message}`);
    equal(run.gold, 4.5, 'five silver and four gold');
    equal(questJob(run)?.id, 'herbs', 'the next job is the Bogcap');
    assert(!takeQuestJob(run).ok, 'but not until tomorrow');
    assert(rest(run, QUEST_LODGE).ok, 'a room at the Lodge is affordable');
    equal([run.day, run.gold], [2, 4.3], 'a new day, two silver lighter');
    assert(takeQuestJob(run).ok, 'the Bogcap job is on offer');
  }],

  ['hides three Bogcap patches in the small wood past the marsh', () => {
    const run = freshRun();
    deadDone(run);
    reportQuestJob(run);
    run.day += 1;
    takeQuestJob(run);
    const place = openWorld(run);
    const patches = place.secrets.filter((secret) => secret.id.startsWith('quest:bogcap:'));
    equal(patches.length, 3, 'three patches');
    const before = openWorld(freshRun()).packs;
    for (const patch of patches) {
      assert(!openWorldModel().blocked(patch.x, patch.y), `${patch.id} can be stood on`);
      const tile = cellWorldTile(patch);
      assert(tile.x >= 88 && tile.x <= 94 && tile.y >= 38 && tile.y <= 43, `${patch.id} lies in the wood past the marsh`);
    }
    assert(place.packs.some((pack) => pack.id === 'quest:forager'), 'a kobold forages there');
    assert(before.every((pack) => !pack.id.startsWith('quest:')), 'none of it is out before the job');
    for (const patch of patches) assert(place.search?.(run, patch).message.includes('Bogcap'), 'each patch gives Bogcap');
    assert(questReady(run), 'three patches finish the job');
    equal(partyOf(run)[0].bag.filter((id) => id === 'herbBogcap').length, 3, 'the Bogcap is kept');
    const report = reportQuestJob(run);
    assert(report.ok && report.message.includes('+5g'), `reported: ${report.message}`);
    assert(report.message.includes('no more work'), 'the Bogcap is the last job');
    equal([run.quest.job, questJob(run), questActive(run)], [QUEST_OVER, null, false], 'the quest is over');
    equal(questLines(run), [], 'the tracker is gone');
    assert(!openWorld(run).packs.some((pack) => pack.id.startsWith('quest:')), 'and its work leaves the world');
  }],

  ['keeps the country round Kerusai clear of roaming packs while the quest runs', () => {
    const run = freshRun(23);
    for (let day = 1; day <= 6; day++) {
      run.day = day;
      for (const pack of openWorldPacks(run)) {
        const tile = cellWorldTile(pack);
        assert(fromKerusai(tile.x, tile.y) > QUEST_CALM, `${pack.id} keeps away on day ${day}`);
      }
    }
    run.quest.job = QUEST_OVER;
    let near = 0;
    for (let day = 1; day <= 6; day++) {
      run.day = day;
      near += openWorldPacks(run).filter((pack) => {
        const tile = cellWorldTile(pack);
        return fromKerusai(tile.x, tile.y) <= QUEST_CALM;
      }).length;
    }
    assert(near > 0, 'afterwards the marsh fills up again');
  }],
];

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration quest: ${tests.length} checks passed.`);
