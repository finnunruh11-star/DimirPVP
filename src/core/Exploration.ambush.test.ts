import { Mage } from '../core/Mage';
import { AMBUSH_PACE, AMBUSH_PEACE, ambushChance, rollAmbush } from '../pve/exploration/ambush';
import { packPace, type EncounterSpawn } from '../pve/exploration/encounters';
import { capturePartySnapshot } from '../pve/exploration/party';
import { createRun, type ExplorationRun } from '../pve/exploration/run';
import { createWorld, PLACES, placeById, terrainAt } from '../pve/exploration/world';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}: expected ${e}, received ${a}`);
}

/** WALK_SPEED in world/walker.ts, which cannot load outside Vite. */
const WALK_SPEED = 4.4;
const world = createWorld();
const open = { sneaking: false, veiled: false };

function freshRun(seed = 3): ExplorationRun {
  const mage = new Mage({ name: 'Walker', isAI: false, team: 1, position: { x: 0, y: 0 }, loadout: [] });
  mage.assignFlatStats(3);
  const run = createRun(seed, capturePartySnapshot([mage]));
  run.hour = 12;
  return run;
}

const farFromTowns = (x: number, y: number): boolean =>
  PLACES.every((p) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) > AMBUSH_PEACE + 1);

/** The first tile of `terrain` well away from every place. */
function wildTile(terrain: string): { x: number; y: number } {
  for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) {
    if (terrainAt(world, x, y) === terrain && farFromTowns(x, y)) return { x, y };
  }
  throw new Error(`no wild ${terrain}`);
}

const mine = (kind: string): EncounterSpawn => ({ family: 'mine', spec: { kind: kind as never, level: 1 } });

const tests: [name: string, run: () => void][] = [
  ['never lies in wait by a town or at a gate', () => {
    const run = freshRun();
    const capitol = placeById('capitol')!;
    equal(ambushChance(run, capitol, open), 0, 'not at a gate');
    equal(ambushChance(run, { x: capitol.x + AMBUSH_PEACE, y: capitol.y }, open), 0, 'not in sight of the walls');
    assert(ambushChance(run, wildTile('plains'), open) > 0, 'open country is dangerous');
  }],

  ['is likelier at night and in rough country, less likely sneaking or veiled', () => {
    const run = freshRun();
    const plains = wildTile('plains');
    const day = ambushChance(run, plains, open);
    run.hour = 23;
    const night = ambushChance(run, plains, open);
    run.hour = 12;
    assert(night > day, `night is worse (${night.toFixed(3)} > ${day.toFixed(3)})`);
    assert(ambushChance(run, plains, { sneaking: true, veiled: false }) < day, 'sneaking helps');
    assert(ambushChance(run, plains, { sneaking: false, veiled: true }) < day, 'a veil helps more');
    assert(ambushChance(run, wildTile('road'), open) < ambushChance(run, wildTile('swamp'), open), 'roads are safer than the marsh');
  }],

  ['rolls the same way for the same tile, day and hour, about as often as it says', () => {
    const run = freshRun(11);
    const tile = wildTile('forest');
    equal(rollAmbush(run, tile, open, WALK_SPEED), rollAmbush(run, tile, open, WALK_SPEED), 'the same roll twice');
    let tries = 0;
    let hits = 0;
    let expected = 0;
    for (let y = 0; y < world.h; y += 2) for (let x = 0; x < world.w; x += 2) {
      for (const hour of [9, 13, 17]) {
        run.hour = hour;
        const chance = ambushChance(run, { x, y }, open);
        if (chance <= 0) continue;
        tries += 1;
        expected += chance;
        if (rollAmbush(run, { x, y }, open, WALK_SPEED)) hits += 1;
      }
    }
    assert(tries > 1000, `enough country to sample (${tries})`);
    assert(Math.abs(hits - expected) < expected * 0.2 + 10, `ambushes land at their odds (${hits} vs ${expected.toFixed(0)})`);
    const perTile = expected / tries;
    assert(perTile > 0.04 && perTile < 0.15, `about one wild tile in ten to twenty draws one (${perTile.toFixed(3)})`);
  }],

  ['hunts the party down: on its trail from the start, and faster than walking', () => {
    const run = freshRun(5);
    let pack = null;
    for (let y = 0; y < world.h && !pack; y++) for (let x = 0; x < world.w && !pack; x++) pack = rollAmbush(run, { x, y }, open, WALK_SPEED);
    assert(pack, 'an ambush turns up somewhere');
    assert(pack.hunting && pack.id.startsWith('once:amb:'), 'hunting, and never recorded as beaten');
    assert((pack.pace ?? 0) >= WALK_SPEED * AMBUSH_PACE, `it outruns a walker (${pack.pace})`);
    assert((pack.spawns?.length ?? 0) >= 1 && pack.label.includes('on your trail'), 'someone is after you');
  }],

  ['sets chase pace by the fastest member: the dead shamble, beasts and bandits run you down', () => {
    assert(packPace([{ family: 'swamp', kind: 'zombie' }]) < WALK_SPEED, 'zombies can be outwalked');
    assert(packPace([mine('bandit')]) > WALK_SPEED, 'bandits cannot');
    assert(packPace([mine('wolf')]) > packPace([mine('kobold')]), 'wolves are quicker than kobolds');
    equal(packPace([mine('boar')]), 7, 'a boar runs at the cap');
    equal(packPace([{ family: 'swamp', kind: 'zombie' }, mine('wolf')]), packPace([mine('wolf')]), 'the fastest sets the pace');
  }],
];

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration ambush: ${tests.length} checks passed.`);
