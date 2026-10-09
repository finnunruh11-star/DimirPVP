import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIELD, MELEE_RANGE, RANGE_UNIT } from '../config/constants';
import { chooseLillithAction, lillithPrey } from '../ai/lillithAI';
import { BOSSES, bossDamageScales, bossRoster, bossScaling } from '../pve/exploration/bloodmoon';
import {
  LILLITH_CIRCLE_RADIUS,
  LILLITH_CM,
  LILLITH_ORB_HP,
  lillithAfterSpawns,
  lillithCopies,
  lillithCopyCount,
  lillithHeldReap,
  lillithOrbCount,
  lillithTurnEnd,
  lillithTurnStart,
  makeLillithCopy,
  openLillith,
  type LillithPlan,
} from '../pve/lillith';
import { applyEnemyTraits, type EnemyKind } from '../pve/swamprun';
import { dealDamage, heal } from '../effects/effects';
import { BOSS_ART } from '../visuals/bosses/art';
import { AUTHORED_BOSSES, authoredIdleSpecial } from '../visuals/bosses/authored';
import { BOSS_ANIMS, renderAnim } from '../visuals/bosses/rig';
import { dmg } from './Damage';
import { Dice } from './Dice';
import { GameState } from './GameState';
import { Mage } from './Mage';
import { dist } from './utils';

const U = RANGE_UNIT;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}: expected ${e}, received ${a}`);
}

function unit(kind: EnemyKind, x: number, y: number): Mage {
  const m = new Mage({ name: kind, isAI: true, team: 2, position: { x, y }, loadout: [] });
  applyEnemyTraits(m, kind, new Dice(5));
  m.actions = { move: 1, main: 1, bonus: 2 };
  return m;
}

function player(x: number, y: number, name: string): Mage {
  const m = new Mage({ name, isAI: false, team: 1, position: { x, y }, loadout: [] });
  m.assignFlatStats(3);
  return m;
}

/** What the scene does with a plan: her copies, her orbs, her dead take the field. */
function raise(game: GameState, boss: Mage, plan: LillithPlan): { copies: Mage[]; orbs: Mage[]; risen: Mage[] } {
  if (plan.blinkTo) Object.assign(boss, plan.blinkTo);
  const copies = plan.copies.map((at) => {
    const copy = unit('lillithCopy', at.x, at.y);
    game.addMage(copy);
    makeLillithCopy(game, boss, copy);
    return copy;
  });
  const risen = plan.risings.map((r) => {
    const m = unit(r.kind, r.at.x, r.at.y);
    game.addMage(m);
    return m;
  });
  const orbs = plan.orbs.map((at) => {
    const orb = unit('lillithOrb', at.x, at.y);
    orb.maxHp = orb.hp = LILLITH_ORB_HP;
    game.addMage(orb);
    return orb;
  });
  lillithAfterSpawns(game, boss);
  return { copies, orbs, risen };
}

function turn(game: GameState, boss: Mage): { plan: LillithPlan; copies: Mage[]; orbs: Mage[]; risen: Mage[] } {
  const plan = lillithTurnStart(game, boss);
  return { plan, ...raise(game, boss, plan) };
}

const mid = FIELD.y + FIELD.h / 2;
const centre = { x: FIELD.x + FIELD.w / 2, y: mid };

const tests: [name: string, run: () => void | Promise<void>][] = [
  ['takes the third pool\'s black seat with one skeleton per player, her health scaling from 130 at three players', () => {
    equal([BOSSES.lillith.tier, BOSSES.lillith.color], [3, 'black'], 'pool and colour');
    for (const players of [1, 2, 3, 5]) {
      equal(bossRoster('lillith', players).map((u) => [u.kind, u.art, u.count, !!u.leader]),
        [['lillith', 'lillith', 1, true], ['skeleton', 'skeleton', players, false]], `${players}-player roster`);
    }
    const boss = unit('lillith', 800, mid);
    equal([Math.round(boss.maxHp * bossScaling(3, 'lillith').health), boss.maxSanity], [130, 70], 'three-player hp and sanity');
    assert(bossScaling(1, 'lillith').health < 1 && bossScaling(5, 'lillith').health > 1, 'health still scales with party size');
    assert(!bossDamageScales('lillith'), 'her damage was not written to scale');
    equal([1, 2, 3, 5].map(lillithCopyCount), [2, 3, 4, 6], 'one copy more than players');
    equal([1, 2, 3, 5].map(lillithOrbCount), [2, 2, 3, 5], 'two orbs, one more per player past two');
    equal([0, 2, 6, 14].map(lillithHeldReap), [2, 4, 8, 16], '2 Reap and as much again');
    assert(Math.abs(LILLITH_CIRCLE_RADIUS / LILLITH_CM - 3.5) < 0.001, 'circles are 7cm across');
  }],

  ['has 1 physical and magical armor, and lays 1d3 Reap with a 1d4 corrosive blow at 2cm', async () => {
    const boss = unit('lillith', 800, mid);
    equal([boss.maxHp, boss.maxSanity], [130, 70], 'hp and sanity');
    equal([boss.intrinsicArmorFlat, boss.intrinsicMagicArmorFlat], [1, 1], 'armor');
    equal(boss.intrinsicMelee && [boss.intrinsicMelee.spec, boss.intrinsicMelee.type], ['1d4', 'corrosive'], 'blow');
    equal(boss.intrinsicMeleeReach, MELEE_RANGE + 2 * U, '2cm reach');
    equal([boss.resistMultiplier('light'), boss.resistMultiplier('shadow'), boss.resistMultiplier('corrosive')], [2, 0.5, 1], 'weak to light, resists shadow');
    const a = player(800 - MELEE_RANGE, mid, 'A');
    const game = new GameState([a, boss], 3);
    const hp = a.hp;
    await game.makeMeleeItem(boss, a).resolve(game);
    assert(a.hp < hp && a.hp >= hp - 4, `1d4 corrosive (${hp - a.hp})`);
    assert(game.reapOn(a) >= 1 && game.reapOn(a) <= 3, '1d3 Reap');
    const strides = new Set<number>();
    openLillith(game, boss, 1);
    for (let i = 0; i < 40; i++) {
      game.setCurrent(boss);
      game.beginTurn();
      strides.add(boss.moveRange() / U);
    }
    assert([...strides].every((s) => s >= 3 && s <= 13) && strides.size > 4, `a 2d6+1cm stride, rolled each turn (${[...strides]})`);
  }],

  ['always takes the last turn, whoever joins the fight', () => {
    const a = player(200, mid, 'A');
    const b = player(200, mid + 80, 'B');
    const boss = unit('lillith', 900, mid);
    const game = new GameState([boss, a, b], 4);
    assert(game.mages[game.initiativeOrder[game.initiativeOrder.length - 1]] === boss, 'last from the start');
    game.endTurn();
    game.endTurn();
    assert(game.current === boss, 'her turn');
    const zombie = unit('zombie', 700, mid);
    game.addMage(zombie);
    const order = game.upcomingTurns(4);
    equal([order[0] === boss, order[3] === zombie], [true, true], 'still her turn, and the newcomer acts before her next one');
    game.endTurn();
    assert(game.upcomingTurns(4)[3] === boss, 'last again in the round after');
  }],

  ['phase one: a grave per player summons from the new table unless stood on; all held, it ends', () => {
    const a = player(200, mid - 100, 'A');
    const b = player(200, mid + 100, 'B');
    const boss = unit('lillith', 1100, mid);
    const game = new GameState([a, b, boss], 5);
    openLillith(game, boss, 2);
    const s = boss.lillith!;
    equal([s.phase, s.graves.length], [1, 2], 'it begins at once, one grave per player');
    const die = game.rng.die.bind(game.rng);
    game.rng.die = () => 1;
    const first = turn(game, boss);
    equal(first.risen.map((m) => m.enemyKind), ['zombie', 'zombie'], 'both open graves raise a zombie on a low roll');
    Object.assign(a, s.graves[0]);
    equal(lillithTurnStart(game, boss).risings.length, 1, 'a held grave stays shut');
    Object.assign(b, s.graves[1]);
    const quiet = lillithTurnStart(game, boss);
    equal([s.phase, s.graves.length, quiet.risings.length], [0, 0, 0], 'every grave held: the phase ends, and this turn is quiet');
    const next = lillithTurnStart(game, boss);
    equal([s.phase, next.copies.length, !!next.blinkTo], [2, 3, true], 'then phase two: one copy more than players, and she slips among them');
    game.rng.die = die;
  }],

  ['grave summon table has exact percentage boundaries and allows only one reroll-twice per circle', () => {
    const a = player(FIELD.x + 30, FIELD.y + 30, 'A');
    const boss = unit('lillith', 1100, mid);
    const game = new GameState([a, boss], 51);
    openLillith(game, boss, 1);
    boss.lillith!.graves = [{ ...centre }];
    const roll = (...rolls: number[]): string[] => {
      let index = 0;
      game.rng.die = (sides) => {
        equal(sides, 100, 'percentage die');
        assert(index < rolls.length, 'reroll recursion is bounded');
        return rolls[index++];
      };
      const kinds = lillithTurnStart(game, boss).risings.map((r) => r.kind);
      equal(index, rolls.length, 'all planned rolls consumed');
      return kinds;
    };
    const totals: Record<string, number> = {};
    for (let value = 1; value <= 80; value++) {
      const result = roll(value);
      const outcome = result.length === 3 ? '3 zombies' : result[0];
      totals[outcome] = (totals[outcome] ?? 0) + 1;
    }
    equal(totals, { zombie: 33, wisp: 17, '3 zombies': 17, skeleton: 7, acidZombie: 5, ghast: 1 }, '80 direct results');
    for (let value = 81; value <= 100; value++) equal(roll(value, 51, 80), ['zombie', 'zombie', 'zombie', 'ghast'], '20 reroll results summon both outcomes');
    equal(roll(81, 81, 1), ['zombie'], 'a repeated reroll does nothing');
    equal(roll(100, 100, 100), [], 'two repeated rerolls do nothing');
    boss.lillith!.graves.push({ x: centre.x + 100, y: centre.y });
    equal(roll(81, 1, 34, 81, 68, 80), ['zombie', 'wisp', 'skeleton', 'ghast'], 'each circle gets its own reroll');
  }],

  ['phase two: copies wear her health, pop at a blow, and what they did comes undone; a lingering one turns real', () => {
    const a = player(300, mid - 100, 'A');
    const b = player(300, mid + 100, 'B');
    const boss = unit('lillith', 1100, mid);
    const game = new GameState([a, b, boss], 6);
    openLillith(game, boss, 2);
    const s = boss.lillith!;
    s.phase = 0;
    s.lull = 0;
    s.next = 2;
    const { copies } = turn(game, boss);
    equal(copies.length, 3, 'three copies for two players');
    equal(s.pools.length, 3 * 6 + 9, 'six circles per copy, and nine from the original');
    equal([0, 3, 6, 9].map((reach) => s.pools.filter((pool) => [a, b].some((who) => Math.abs(dist(pool, who.pos) / LILLITH_CM - reach) < 0.001)).length),
      [1, 3 + 2, 3 * 2 + 3, 3 * 3 + 3], 'one on a player; per-copy and original 3/6/9cm counts');
    assert(copies.every((c) => c.name === boss.name), 'they bear her name');
    dealDamage(game.effectContext(a, boss, null), boss, dmg(10, 'typeless'), { canMiss: false });
    equal(copies.map((c) => [c.hp, c.maxHp, c.sanity]), copies.map(() => [boss.hp, boss.maxHp, boss.sanity]), 'and her wounds');

    const hp = a.hp;
    dealDamage(game.effectContext(copies[0], a, null), a, dmg(5, 'corrosive'), { canMiss: false });
    const die = game.rng.die.bind(game.rng);
    game.rng.die = () => 3;
    game.lillithReap(copies[0], a);
    game.rng.die = die;
    equal([a.hp, game.reapOn(a)], [hp - 5, 3], 'its rolled Reap seems real');
    dealDamage(game.effectContext(copies[0], a, null), a, dmg(999, 'corrosive'), { canMiss: false });
    assert(a.alive && a.hp === 1, 'but cannot kill');
    dealDamage(game.effectContext(a, copies[0], null), copies[0], dmg(1, 'typeless'), { canMiss: false });
    assert(!copies[0].alive, 'one landed point pops it');
    equal([a.hp, game.reapOn(a)], [hp, 0], 'and what it did was never real');

    const bHp = b.hp;
    dealDamage(game.effectContext(copies[1], b, null), b, dmg(4, 'corrosive'), { canMiss: false });
    s.pools = [{ x: 640, y: mid, fires: 2 }];
    Object.assign(a, { x: 640, y: mid });
    b.x = FIELD.x + 30;
    b.y = FIELD.y + 30;
    const before = a.hp;
    turn(game, boss);
    equal(before - a.hp, 3, 'a circle bites everyone in it for 3 corrosive at her turn');
    equal(lillithCopies(game, boss).length, 2, 'a copy fell this round: none fades');
    s.pools = [];
    turn(game, boss);
    const left = lillithCopies(game, boss);
    equal(left.length, 1, 'a round with none fallen: one fades');
    const faded = !left.includes(copies[1]);
    dealDamage(game.effectContext(a, left[0], null), left[0], dmg(1, 'typeless'), { canMiss: false });
    equal(b.hp, faded ? bHp - 4 : bHp, faded ? 'the faded copy\'s blow stays dealt' : 'the struck copy\'s blow is undone');
    equal([s.phase, s.pools.length, s.next], [0, 0, 3], 'the last copy gone: the phase ends and its circles go with it');
  }],

  ['phase three: holds the least held player in the middle, one action a turn, reaped harder each of her turns, until the orbs break', () => {
    const a = player(300, mid - 100, 'A');
    const b = player(300, mid + 100, 'B');
    const boss = unit('lillith', 1100, mid);
    const game = new GameState([a, b, boss], 7);
    openLillith(game, boss, 2);
    const s = boss.lillith!;
    s.phase = 0;
    s.lull = 0;
    s.next = 3;
    const { orbs } = turn(game, boss);
    const held = s.bound!;
    const other = held === a ? b : a;
    equal([s.phase, orbs.length, orbs.every((o) => o.hp === LILLITH_ORB_HP && o.inert)], [3, 2, true], 'two orbs of 7');
    assert(dist(held.pos, centre) < 40 && held.lillithBound, 'held in the middle');
    equal(game.reapOn(held), 0, 'no Reap the turn she takes them');

    game.setCurrent(held);
    game.beginTurn();
    equal(held.actions.move, 0, 'no walking');
    held.spend('main');
    equal([held.actions.main, held.actions.bonus], [0, 0], 'one main or bonus action, not both');
    const at = held.pos;
    held.x += 120;
    game.notifyMageRelocation(held, at, held.pos, true);
    equal(held.pos, at, 'nothing moves them');

    boss.x = held.x + MELEE_RANGE;
    boss.y = held.y;
    other.x = FIELD.x + 40;
    boss.actions = { move: 1, main: 1, bonus: 2 };
    const choice = chooseLillithAction(game, boss);
    assert(!(choice.type === 'melee' && choice.target === held), 'she never strikes the one she holds');

    lillithTurnStart(game, boss);
    equal(game.reapOn(held), 2, 'her next turn: 2 Reap');
    lillithTurnStart(game, boss);
    equal(game.reapOn(held), 6, 'then 2 more and as much again');

    for (const orb of orbs) dealDamage(game.effectContext(other, orb, null), orb, dmg(LILLITH_ORB_HP, 'typeless'), { canMiss: false });
    equal([s.phase, s.next, held.lillithBound, s.bound], [0, 1, undefined, undefined], 'the last orb breaks: free, and phase one is next');
    s.lull = 0;
    s.next = 3;
    turn(game, boss);
    assert(s.bound === other, 'next time, whoever was held least');
  }],

  ['phase three alone: she simply fights two turns, then opens the graves again', () => {
    const a = player(300, mid, 'A');
    const boss = unit('lillith', 1100, mid);
    const game = new GameState([a, boss], 8);
    openLillith(game, boss, 1);
    const s = boss.lillith!;
    s.phase = 0;
    s.lull = 0;
    s.next = 3;
    lillithTurnStart(game, boss);
    equal([s.phase, s.bound], [0, undefined], 'nobody is held');
    lillithTurnStart(game, boss);
    equal(s.phase, 0, 'a second plain turn');
    lillithTurnStart(game, boss);
    equal([s.phase, s.graves.length], [1, 1], 'phase one again');
  }],

  ['sheds her debuffs when a phase ran through her whole turn', () => {
    const a = player(300, mid, 'A');
    const boss = unit('lillith', 1100, mid);
    const game = new GameState([a, boss], 9);
    openLillith(game, boss, 1);
    const curse = () => boss.statuses.push({ key: 'debuff:test', name: 'Test', kind: 'debuff', duration: 3 } as never);
    curse();
    lillithTurnStart(game, boss);
    lillithTurnEnd(game, boss);
    equal(boss.statuses.length, 0, 'phase one held all turn: cleansed');
    const s = boss.lillith!;
    Object.assign(a, s.graves[0]);
    curse();
    lillithTurnStart(game, boss);
    lillithTurnEnd(game, boss);
    equal(boss.statuses.length, 1, 'the phase ended: no cleanse');
    lillithTurnStart(game, boss);
    lillithTurnEnd(game, boss);
    equal(boss.statuses.length, 1, 'a new phase began this turn: no cleanse');
  }],

  ['stays on her prey until another player deals and mends far more since her last turn', () => {
    const a = player(900 - MELEE_RANGE, mid, 'A');
    const b = player(700, mid, 'B');
    const boss = unit('lillith', 900, mid);
    const game = new GameState([a, b, boss], 10);
    openLillith(game, boss, 2);
    assert(lillithPrey(game, boss) === a, 'nobody has done anything: the nearest');
    dealDamage(game.effectContext(a, boss, null), boss, dmg(2, 'typeless'), { canMiss: false });
    b.hp -= 4;
    heal(game.effectContext(b, b, null), b, 4);
    equal([game.lillithOutput.get(a), game.lillithOutput.get(b)], [2, 4], 'damage and healing both count');
    assert(lillithPrey(game, boss) === a, 'a little more is not enough');
    dealDamage(game.effectContext(b, boss, null), boss, dmg(3, 'typeless'), { canMiss: false });
    assert(lillithPrey(game, boss) === b, 'twice as much and more: she turns');
    boss.lillith!.turnPhase = 1;
    lillithTurnEnd(game, boss);
    equal(game.lillithOutput.size, 0, 'her reading starts over each turn');
  }],

  ['takes her copies, her orbs and her dead with her, and frees the one she holds', () => {
    const a = player(300, mid - 100, 'A');
    const b = player(300, mid + 100, 'B');
    const boss = unit('lillith', 1100, mid);
    const game = new GameState([a, b, boss], 11);
    openLillith(game, boss, 2);
    const { risen } = turn(game, boss);
    const s = boss.lillith!;
    s.phase = 0;
    s.lull = 0;
    s.next = 3;
    const { orbs } = turn(game, boss);
    const held = s.bound!;
    dealDamage(game.effectContext(a, boss, null), boss, dmg(999, 'typeless'), { canMiss: false });
    assert(!boss.alive && [...risen, ...orbs].every((m) => !m.alive), 'everything of hers goes');
    assert(!held.lillithBound, 'the held walk free');
    assert(game.isOver, 'and the fight is won');
  }],

  ['idle specials happen half as often and choose Inspect 90% of the time, otherwise the existing taunt', () => {
    equal(AUTHORED_BOSSES.lillith.special!.every, 8, 'eight idle loops between specials');
    const results = Array.from({ length: 100 }, (_, index) => authoredIdleSpecial('lillith', index / 100));
    equal([results.filter((strip) => strip === 'idle_inspect').length, results.filter((strip) => strip === 'taunt').length], [90, 10], '90/10 split');
    equal([authoredIdleSpecial('lillith', 0.899999), authoredIdleSpecial('lillith', 0.9)], ['idle_inspect', 'taunt'], 'probability boundary');
    equal(authoredIdleSpecial('rock', 0.5), null, 'bosses without idle specials are unchanged');
  }],

  ['wears the shade queen\'s sheets, every strip on disk the size her registry says, and paints her orb', () => {
    const boss = AUTHORED_BOSSES.lillith;
    assert(boss && !BOSS_ART.lillith, 'she is drawn from sheets, not painted');
    for (const anim of BOSS_ANIMS) assert(boss.strips[anim], `a ${anim} strip`);
    for (const name of [...boss.attacks, boss.special!.strip, boss.special!.alternate!.strip, boss.cast!.strip]) assert(boss.strips[name], `a ${name} strip`);
    assert(boss.cast!.peak < boss.strips[boss.cast!.strip].frames, 'the chant peaks within its strip');
    equal(boss.ground / boss.h, 0.9, 'her feet sit nine tenths down, where the arena anchors creatures');
    for (const [name, strip] of Object.entries(boss.strips)) {
      const png = readFileSync(join('src', 'Sprites', 'ShadeQueen', `${name}.png`));
      const cols = Math.min(boss.columns, strip.frames);
      const rows = Math.ceil(strip.frames / boss.columns);
      equal([png.readUInt32BE(16), png.readUInt32BE(20)], [cols * boss.w, rows * boss.h], `${name}.png`);
    }
    const orb = BOSS_ART['lillith-orb'];
    for (const anim of BOSS_ANIMS) equal(renderAnim(orb, anim).length, orb.frames[anim], `orb ${anim}`);
  }],
];

let failed = 0;
for (const [name, run] of tests) {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}\n     ${(error as Error).message}`);
  }
}
if (failed) {
  console.error(`${failed} of ${tests.length} Lillith tests failed`);
  process.exit(1);
}
console.log(`All ${tests.length} Lillith tests passed.`);
