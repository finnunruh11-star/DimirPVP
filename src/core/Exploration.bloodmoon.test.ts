import { Mage } from '../core/Mage';
import { applyEnemyTraits, ENEMY_DEFS } from '../pve/swamprun';
import { Dice } from '../core/Dice';
import { dealDamage } from '../effects/effects';
import { dmg } from './Damage';
import { GameState } from './GameState';
import { capturePartySnapshot } from '../pve/exploration/party';
import { createRun } from '../pve/exploration/run';
import { parseRun } from '../pve/exploration/save';
import { parseFightWire, toFightWire } from '../net/fightWire';
import {
  BOSS_IDS, BOSS_STAND_IN, BOSSES, bloodmoonBoss, bloodmoonCombat, bloodmoonCycle, bloodmoonDue, bloodmoonFight,
  bloodmoonOmen, bossPool, bossRoster, bossScaling, cycleDay, cycleDayTitle, hoursToBloodmoon, nextBloodmoonDay, parseBossFight, roman,
} from '../pve/exploration/bloodmoon';
import { BOSS_ART } from '../visuals/bosses/art';
import { BOSS_ANIMS, GROUND, renderAnim } from '../visuals/bosses/rig';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}: expected ${e}, received ${a}`);
}

function freshRun(seed = 7) {
  const mage = new Mage({ name: 'Walker', isAI: false, team: 1, position: { x: 0, y: 0 }, loadout: [] });
  mage.assignFlatStats(3);
  return createRun(seed, capturePartySnapshot([mage]));
}

const tests: [name: string, run: () => void][] = [
  ['rises on day 5 and every ten days after', () => {
    equal([1, 4, 5, 6, 14, 15, 24, 25, 35].map(bloodmoonCycle), [0, 0, 1, 1, 1, 2, 2, 3, 4], 'cycles');
    equal([1, 4, 5, 14, 15].map(nextBloodmoonDay), [5, 5, 15, 15, 25], 'next bloodmoon');
    equal(hoursToBloodmoon(4, 20), 4, 'four hours before midnight on day 4');
    equal(hoursToBloodmoon(1, 8), 88, 'from the first morning');
  }],

  ['counts the days down and warns on the last one', () => {
    equal(bloodmoonOmen(1), { daysLeft: 4, tonight: false }, 'day 1');
    equal(bloodmoonOmen(3), { daysLeft: 2, tonight: false }, 'day 3');
    equal(bloodmoonOmen(4), { daysLeft: 1, tonight: true }, 'day 4 is the last day');
    equal(bloodmoonOmen(5), { daysLeft: 10, tonight: false }, 'the day it rose');
    equal(bloodmoonOmen(14).tonight, true, 'day 14 before the second');
  }],

  ['names each day of the cycle, the last one the final day', () => {
    equal([1, 2, 3, 4, 5, 6, 14, 15].map(cycleDay), [1, 2, 3, 4, 1, 2, 10, 1], 'days of the cycle');
    equal([1, 3, 4, 5, 13, 14].map(cycleDayTitle), ['The First Day', 'The Third Day', 'The Final Day', 'The First Day', 'The Ninth Day', 'The Final Day'], 'titles');
  }],

  ['draws each bloodmoon from its own pool, the same boss for the same run', () => {
    equal(bossPool(1), ['goblins', 'minion', 'rock', 'zargarg'], 'first pool');
    equal(bossPool(2), ['dragon', 'crusade', 'baral'], 'second pool');
    equal(bossPool(3), ['trickster', 'planetar', 'selga'], 'third pool');
    equal(bossPool(7), bossPool(3), 'later bloodmoons keep to the third pool');
    for (let seed = 1; seed < 40; seed++) {
      for (let cycle = 1; cycle <= 4; cycle++) {
        const id = bloodmoonBoss(seed, cycle);
        assert(bossPool(cycle).includes(id), `seed ${seed} cycle ${cycle} in pool`);
        equal(bloodmoonBoss(seed, cycle), id, 'deterministic');
      }
    }
    const firsts = new Set(Array.from({ length: 60 }, (_, seed) => bloodmoonBoss(seed + 1, 1)));
    equal(firsts.size, 4, 'every first-pool boss can come up');
    equal(Object.fromEntries(BOSS_IDS.map((id) => [id, BOSSES[id].color])), {
      goblins: 'red', minion: 'black', rock: 'green', zargarg: 'blue',
      dragon: 'red', crusade: 'white', baral: 'blue',
      trickster: 'black', planetar: 'green', selga: 'white',
    }, 'colours as given');
  }],

  ['scales damage by 30% and health by 75% for each extra player', () => {
    equal(bossScaling(1), { damage: 1, health: 1 }, 'solo');
    equal(bossScaling(2), { damage: 1.3, health: 1.75 }, 'two');
    equal(bossScaling(3), { damage: 1.6, health: 2.5 }, 'three');
  }],

  ['owes a fight once the bloodmoon has risen, until it is fought', () => {
    const run = freshRun();
    assert(!bloodmoonDue(run) && bloodmoonFight(run) === null, 'nothing owed on day 1');
    run.day = 5;
    const fight = bloodmoonFight(run);
    assert(bloodmoonDue(run) && fight?.cycle === 1 && bossPool(1).includes(fight.id), 'the first boss is owed');
    const combat = bloodmoonCombat(run, fight, 'forest');
    equal(bossRoster('zargarg', 1), [{ kind: BOSS_STAND_IN, art: 'zargarg', count: 1, leader: true }], 'a zombie stands in for an unwritten boss');
    equal(combat.boss, fight, 'the fight carries its boss');
    equal(parseFightWire(JSON.parse(JSON.stringify(toFightWire(combat))))?.boss, fight, 'guests are told the boss');
    run.bloodmoons = 1;
    assert(!bloodmoonDue(run), 'fought through');
    run.day = 15;
    equal(bloodmoonFight(run)?.cycle, 2, 'the second one comes');
  }],

  ['saves the bloodmoons fought, and does not charge old saves for ones they slept through', () => {
    const run = freshRun();
    run.day = 16;
    run.bloodmoons = 2;
    equal(parseRun(JSON.stringify(run))?.bloodmoons, 2, 'round-trips');
    const old = JSON.parse(JSON.stringify(run)) as Record<string, unknown>;
    delete old.bloodmoons;
    equal(parseRun(JSON.stringify(old))?.bloodmoons, 2, 'an old save starts square');
    const cheat = { ...old, bloodmoons: 99 };
    equal(parseRun(JSON.stringify(cheat))?.bloodmoons, 2, 'never more than have risen');
    assert(parseBossFight({ id: 'dragon', cycle: 0 }) === undefined && parseBossFight({ id: 'nope', cycle: 1 }) === undefined, 'hostile input');
    equal(roman(3), 'III', 'numerals');
  }],

  ['hits harder as the damage scale says', () => {
    const boss = new Mage({ name: 'Boss', isAI: true, team: 2, position: { x: 400, y: 200 }, loadout: [] });
    applyEnemyTraits(boss, 'zombie', new Dice(1));
    const target = new Mage({ name: 'Target', isAI: false, team: 1, position: { x: 300, y: 200 }, loadout: [] });
    target.assignFlatStats(10);
    const game = new GameState([target, boss], 7);
    const ctx = game.effectContext(boss, target, null);
    const plain = dealDamage(ctx, target, dmg(10, 'typeless'), { canMiss: false });
    boss.damageScale = 1.6;
    equal(dealDamage(ctx, target, dmg(10, 'typeless'), { canMiss: false }), Math.round(plain * 1.6), 'x1.6');
    assert(ENEMY_DEFS[BOSS_STAND_IN], 'the stand-in exists');
  }],

  ['paints every boss: all five animations, feet on the ground line, nothing empty but the end of death', () => {
    for (const id of BOSS_IDS) {
      const art = BOSS_ART[id];
      assert(art, `${id} has art`);
      for (const anim of BOSS_ANIMS) {
        const frames = renderAnim(art, anim);
        equal(frames.length, art.frames[anim], `${id} ${anim} frame count`);
        frames.forEach((frame, index) => {
          let filled = 0;
          let lowest = 0;
          for (let y = 0; y < frame.h; y++) for (let x = 0; x < frame.w; x++) {
            if (frame.px.get(x, y) < 0) continue;
            filled++;
            lowest = Math.max(lowest, y);
          }
          const dying = anim === 'death' && index / (frames.length - 1) > 0.22;
          const ground = art.ground ?? GROUND;
          // Small pixel-art frames hold far fewer pixels than the painted ones.
          assert(dying || filled > (art.h < 64 ? 60 : 400), `${id} ${anim} ${index} is drawn`);
          // Floating bosses hover a little above the line; none sinks through it.
          if (!dying) assert(lowest >= ground - 12 && lowest <= ground + 6, `${id} ${anim} ${index} stands on the ground (${lowest})`);
        });
      }
    }
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
  console.error(`${failed} of ${tests.length} bloodmoon tests failed`);
  process.exit(1);
}
console.log(`All ${tests.length} bloodmoon tests passed.`);
