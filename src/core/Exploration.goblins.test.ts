import { FIELD, MELEE_RANGE, RANGE_UNIT } from '../config/constants';
import { chooseGoblinAction } from '../ai/goblinAI';
import { bossRoster, goblinBand } from '../pve/exploration/bloodmoon';
import { GOBLIN_RITE_RANGE, GOBLIN_SHAMAN_LEASH } from '../pve/goblins';
import { applyEnemyTraits, type EnemyKind } from '../pve/swamprun';
import { BOSS_ART } from '../visuals/bosses/art';
import { BOSS_ANIMS, renderAnim } from '../visuals/bosses/rig';
import type { DamageType } from './Damage';
import { Dice } from './Dice';
import { GameState } from './GameState';
import { Mage } from './Mage';

const U = RANGE_UNIT;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}: expected ${e}, received ${a}`);
}

function goblin(kind: EnemyKind, x: number, y: number): Mage {
  const m = new Mage({ name: kind, isAI: true, team: 2, position: { x, y }, loadout: [] });
  applyEnemyTraits(m, kind, new Dice(5));
  m.actions = { move: 1, main: 1, bonus: 2 };
  return m;
}

function player(x: number, y: number, name = 'Walker'): Mage {
  const m = new Mage({ name, isAI: false, team: 1, position: { x, y }, loadout: [] });
  m.assignFlatStats(3);
  return m;
}

const mid = FIELD.y + FIELD.h / 2;

const tests: [name: string, run: () => void][] = [
  ['brings a band that grows with the party', () => {
    equal([1, 2, 3, 4, 5, 6].map(goblinBand), [
      { shamans: 1, raiders: 1 }, { shamans: 2, raiders: 2 }, { shamans: 2, raiders: 4 },
      { shamans: 3, raiders: 5 }, { shamans: 4, raiders: 6 }, { shamans: 5, raiders: 7 },
    ], 'band sizes');
    equal(bossRoster('goblins', 3).map((unit) => [unit.kind, unit.count]), [['goblinChief', 1], ['goblinRaider', 4], ['goblinShaman', 2]], 'three players');
    equal(bossRoster('crusade', 3).map((unit) => [unit.kind, unit.count]), [['zombie', 1]], 'unwritten bosses keep the stand-in');
  }],

  ['gives each goblin the stats it was written with, and no resistances', () => {
    const chief = goblin('goblinChief', 400, mid);
    const raider = goblin('goblinRaider', 400, mid);
    const shaman = goblin('goblinShaman', 400, mid);
    equal([chief.maxHp, raider.maxHp, shaman.maxHp], [15, 5, 3], 'hp');
    equal([chief.maxSanity, raider.maxSanity, shaman.maxSanity], [10, 5, 7], 'sanity');
    equal([chief.moveRange(), raider.moveRange(), shaman.moveRange()], [8 * U, 5 * U, 3 * U], 'speed');
    equal([chief.intrinsicMeleeReach, raider.intrinsicMeleeReach ?? MELEE_RANGE], [MELEE_RANGE + 2 * U, MELEE_RANGE], 'reach');
    equal([chief.intrinsicMelee?.spec, raider.intrinsicMelee?.spec], ['5', '1d4'], 'damage');
    assert(shaman.cannotAttack && !chief.cannotAttack && !raider.cannotAttack, 'the shaman never strikes');
    const types: DamageType[] = ['pierce', 'shatter', 'slashing', 'shadow', 'corrosive', 'heat', 'light', 'cold', 'sanity', 'generic'];
    for (const m of [chief, raider, shaman]) {
      for (const type of types) equal(m.resistMultiplier(type), 1, `${m.name} ${type}`);
    }
  }],

  ['mends for 3 and hastens by half, hexes slow by a quarter, and both stack', () => {
    const shaman = goblin('goblinShaman', 900, mid);
    const raider = goblin('goblinRaider', 700, mid);
    const walker = player(300, mid);
    const game = new GameState([walker, raider, shaman], 3);
    raider.hp = 1;
    game.goblinMend(shaman, raider);
    equal(raider.hp, 4, 'healed by 3');
    equal(raider.moveRange(), Math.round(5 * U * 1.5), '+50% move');
    game.goblinMend(shaman, raider);
    equal([raider.hp, raider.moveRange()], [5, 5 * U + 2 * Math.round(5 * U * 0.5)], 'a second mending stacks and cannot overheal');
    const base = walker.moveRange();
    game.goblinHex(shaman, walker);
    game.goblinHex(shaman, walker);
    equal(walker.moveRange(), base - 2 * Math.round(base * 0.25), 'two hexes, -50%');
    game.goblinHex(shaman, walker);
    game.goblinHex(shaman, walker);
    equal(walker.moveRange(), 0, 'four hexes hold a traveller still');
    game.currentIndex = 1;
    game.beginTurn();
    assert(raider.moveRange() > 5 * U, 'the haste holds on its first turn');
    game.currentIndex = 1;
    game.beginTurn();
    assert(raider.moveRange() > 5 * U, 'and on its second');
    game.currentIndex = 1;
    game.beginTurn();
    equal(raider.moveRange(), 5 * U, 'then it is gone');
  }],

  ['has the shaman mend whoever is hurt, the chief first, and hex only when nobody is', () => {
    const chief = goblin('goblinChief', 800, mid);
    const raider = goblin('goblinRaider', 760, mid - 60);
    const shaman = goblin('goblinShaman', 1100, mid);
    const walker = player(300, mid);
    const game = new GameState([walker, chief, raider, shaman], 4);
    const hex = chooseGoblinAction(game, shaman);
    assert(hex.type === 'goblin-hex' && hex.target === walker, 'nobody hurt: hex the traveller');
    raider.hp -= 3;
    chief.hp -= 3;
    const mend = chooseGoblinAction(game, shaman);
    assert(mend.type === 'goblin-heal' && mend.target === chief, 'the chief is mended before a raider');
    chief.hp = chief.maxHp;
    const second = chooseGoblinAction(game, shaman);
    assert(second.type === 'goblin-heal' && second.target === raider, 'then the raider');
    shaman.actions.main = 0;
    walker.x = 1000;
    const away = chooseGoblinAction(game, shaman);
    assert(away.type === 'move' && Math.hypot(away.point.x - walker.x, away.point.y - walker.y) > Math.hypot(shaman.x - walker.x, shaman.y - walker.y), 'rite spent: it backs away from the party');
    assert(GOBLIN_RITE_RANGE === 20 * U, 'rites reach 20cm');
  }],

  ['has raiders strike what is in reach, and keep to the shamans when nothing is', () => {
    const chief = goblin('goblinChief', 1000, mid);
    const shaman = goblin('goblinShaman', 1200, mid);
    const raider = goblin('goblinRaider', 340, mid);
    const walker = player(300, mid);
    const game = new GameState([walker, chief, raider, shaman], 5);
    const strike = chooseGoblinAction(game, raider);
    assert(strike.type === 'melee' && strike.target === walker, 'adjacent: it strikes');
    raider.x = FIELD.x + 40;
    raider.y = FIELD.y + 30;
    walker.x = FIELD.x + FIELD.w - 60;
    walker.y = FIELD.y + FIELD.h - 30;
    shaman.x = FIELD.x + FIELD.w * 0.5;
    shaman.y = mid;
    const far = goblin('goblinRaider', FIELD.x + 30, FIELD.y + FIELD.h - 30);
    game.addMage(far);
    const hold = chooseGoblinAction(game, far);
    assert(hold.type === 'move', 'nothing to hit: it moves up');
    assert(Math.hypot(hold.point.x - shaman.x, hold.point.y - shaman.y) <= GOBLIN_SHAMAN_LEASH + 1, 'and stays within 22cm of a shaman');
  }],

  ['has the chief swing when he can and fall back to be mended when badly hurt', () => {
    const chief = goblin('goblinChief', 600, mid);
    const shaman = goblin('goblinShaman', 1150, mid);
    const walker = player(500, mid);
    const game = new GameState([walker, chief, shaman], 6);
    chief.hp = 3;
    const swing = chooseGoblinAction(game, chief);
    assert(swing.type === 'melee' && swing.target === walker, 'hurt, but a foe is in reach: he swings');
    chief.actions.main = 0;
    const back = chooseGoblinAction(game, chief);
    assert(back.type === 'move' && back.point.x > chief.x, 'then retreats towards his shaman');
    chief.hp = chief.maxHp;
    chief.actions = { move: 1, main: 1, bonus: 2 };
    walker.x = 200;
    const lunge = chooseGoblinAction(game, chief);
    assert(lunge.type === 'move' && lunge.point.x < chief.x, 'healthy and out of reach: he closes in');
  }],

  ['routs the rest once the chief is dead: they run for the edge and slip away', () => {
    const chief = goblin('goblinChief', 700, mid);
    const raider = goblin('goblinRaider', 900, mid);
    const walker = player(400, mid);
    const game = new GameState([walker, chief, raider], 7);
    chief.hp = 0;
    const run = chooseGoblinAction(game, raider);
    const gap = (p: { x: number; y: number }): number => Math.hypot(p.x - walker.x, p.y - walker.y);
    const edgeGap = (p: { x: number; y: number }): number => Math.min(p.x - FIELD.x, FIELD.x + FIELD.w - p.x, p.y - FIELD.y, FIELD.y + FIELD.h - p.y);
    assert(run.type === 'move' && gap(run.point) > gap(raider.pos) && edgeGap(run.point) < edgeGap(raider.pos), 'away from the party, towards the nearest edge');
    raider.x = FIELD.x + FIELD.w - 30;
    const out = chooseGoblinAction(game, raider);
    equal(out.type, 'goblin-escape', 'at the edge it leaves');
    game.goblinEscape(raider);
    assert(!raider.alive, 'and is gone from the fight');
  }],

  ['paints Snazzlegob, a raider and a shaman with every animation', () => {
    for (const id of ['goblin-chief', 'goblin-raider', 'goblin-shaman']) {
      const art = BOSS_ART[id];
      assert(art, `${id} has art`);
      for (const anim of BOSS_ANIMS) equal(renderAnim(art, anim).length, art.frames[anim], `${id} ${anim}`);
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
  console.error(`${failed} of ${tests.length} goblin tests failed`);
  process.exit(1);
}
console.log(`All ${tests.length} goblin tests passed.`);
