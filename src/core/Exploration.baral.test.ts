import { MELEE_RANGE, RANGE_UNIT } from '../config/constants';
import { chooseBaralAction } from '../ai/baralAI';
import { bossDamageScales, bossRoster } from '../pve/exploration/bloodmoon';
import { denialLabel, denialStartCharges, denialThreshold, DRAKE_LIFESPAN } from '../pve/baral';
import { applyEnemyTraits, type EnemyKind } from '../pve/swamprun';
import { applyDebuff, dealDamage } from '../effects/effects';
import { BOSS_ART } from '../visuals/bosses/art';
import { BOSS_ANIMS, renderAnim } from '../visuals/bosses/rig';
import { dmg, type DamageType } from './Damage';
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

function unit(kind: EnemyKind, x: number, y: number): Mage {
  const m = new Mage({ name: kind, isAI: true, team: 2, position: { x, y }, loadout: [] });
  applyEnemyTraits(m, kind, new Dice(5));
  m.actions = { move: 1, main: 1, bonus: 2 };
  if (kind === 'baral') m.baral = { turns: 0, wounded: false, hpMark: 20 };
  if (kind === 'baralDrake') m.drakeTurns = DRAKE_LIFESPAN;
  return m;
}

function artifact(x: number, y: number, charges: number, threshold = 3): Mage {
  const m = unit('denialArtifact', x, y);
  m.denial = { charges, threshold };
  return m;
}

function player(x: number, y: number, name = 'Walker'): Mage {
  const m = new Mage({ name, isAI: false, team: 1, position: { x, y }, loadout: [] });
  m.assignFlatStats(3);
  return m;
}

const mid = 300;

const tests: [name: string, run: () => void][] = [
  ['opens with an artifact and a drake per player, charged 3, 2, 1, 0 and round again, armed sooner for bigger parties', () => {
    equal(
      bossRoster('baral', 3).map((u) => [u.kind, u.art, u.count]),
      [['baral', 'baral', 1], ['denialArtifact', 'denial-artifact', 3], ['baralDrake', 'baral-drake', 3]],
      'three players'
    );
    equal(denialStartCharges(6), [3, 2, 1, 0, 3, 2], 'start charges');
    equal([1, 2, 3, 4, 5, 6].map(denialThreshold), [4, 3, 3, 3, 2, 2], 'charges to arm');
    assert(!bossDamageScales('baral'), 'his damage does not scale; his health does');
  }],

  ['gives Baral, the artifact and the drake the stats they were written with', () => {
    const baral = unit('baral', 800, mid);
    const art = unit('denialArtifact', 900, mid);
    const drake = unit('baralDrake', 700, mid);
    equal([baral.maxHp, art.maxHp, drake.maxHp], [40, 8, 2], 'hp');
    equal([baral.maxSanity, drake.maxSanity], [30, 2], 'sanity');
    equal([baral.moveRange(), art.moveRange(), drake.moveRange()], [10 * U, 0, 4 * U], 'speed');
    baral.hp = 19;
    equal(baral.moveRange(), 30 * U, 'below 20 hp he runs');
    baral.hp = 40;
    baral.sanity = 14;
    equal(baral.moveRange(), 30 * U, 'below 15 sanity too');
    baral.sanity = 30;
    equal([baral.intrinsicMelee, drake.intrinsicMelee], [{ spec: '1d3', type: 'sanity' }, { spec: '1d2', type: 'sanity' }], 'mill blows');
    equal([baral.intrinsicMeleeReach ?? MELEE_RANGE, drake.intrinsicMeleeReach ?? MELEE_RANGE], [MELEE_RANGE, MELEE_RANGE], '0cm range');
    const types: DamageType[] = ['pierce', 'shatter', 'slashing', 'shadow', 'corrosive', 'heat', 'light', 'cold', 'sanity', 'generic'];
    for (const type of types) equal(baral.resistMultiplier(type), 1, `Baral ${type}`);
    assert(art.isImmuneTo('sanity') && art.resistMultiplier('shatter') > 1, 'the artifact has no mind and breaks to blunt force');
    for (const type of ['pierce', 'shadow', 'heat', 'cold', 'light'] as DamageType[]) assert(art.resistMultiplier(type) < 1, `the artifact resists ${type}`);
    assert(art.cannotAttack && art.inert, 'the artifact never acts');
    assert(drake.resistMultiplier('slashing') > 1 && drake.resistMultiplier('shatter') > 1 && drake.resistMultiplier('pierce') < 1, 'the drake: weak to slashing and blunt, resists piercing');
  }],

  ['charges on every party action, stifles the next once armed for 1 mill, and only one artifact answers', () => {
    const walker = player(300, mid);
    const baral = unit('baral', 900, mid);
    const a = artifact(600, 100, 2);
    const b = artifact(600, 500, 2);
    const game = new GameState([walker, baral, a, b], 3);
    const step = () => game.makeMoveItem(walker, { x: walker.x + 20, y: walker.y });
    assert(game.stifleByDenial(step()) === null, 'nothing armed yet');
    game.chargeDenial(step());
    equal([a.denial!.charges, b.denial!.charges], [3, 3], 'both charged and armed');
    const window = step();
    window.windowTrigger = true;
    assert(game.stifleByDenial(window) === null, 'ending a turn is not an action');
    const sanity = walker.sanity;
    equal(game.stifleByDenial(step()), a, 'the first armed artifact stifles it');
    equal([a.denial!.charges, b.denial!.charges, walker.sanity], [0, 3, sanity - 1], 'it is spent, the other keeps its charge, the actor loses 1 sanity');
    equal(game.stifleByDenial(step()), b, 'the next action meets the other');
    game.chargeDenial(game.makeMoveItem(baral, { x: 880, y: mid }));
    equal(a.denial!.charges, 0, "Baral's own actions do not charge them");
    equal(denialLabel(a), '\u25A1\u25A1\u25A1 0/3', 'charges are shown to everyone');
  }],

  ['takes no turns, and cracks for 5 whenever it is moved', () => {
    const walker = player(300, mid);
    const baral = unit('baral', 900, mid);
    const game = new GameState([walker, baral], 4);
    const a = artifact(600, mid, 0);
    game.addMage(a);
    assert(!game.initiativeOrder.includes(game.mages.indexOf(a)), 'never in the turn order');
    game.notifyMageRelocation(a, a.pos, a.pos, false);
    equal(a.hp, 8, 'standing still costs nothing');
    const from = { ...a.pos };
    a.x += 60;
    game.notifyMageRelocation(a, from, a.pos, false);
    equal(a.hp, 3, 'a shove costs 5');
  }],

  ['the first time he drops below 20 hp or 15 sanity: held at one under, two drakes, unseen, a 10cm dash and a cleanse, once', () => {
    const walker = player(300, mid);
    const baral = unit('baral', 900, mid);
    const game = new GameState([walker, baral], 5);
    const ctx = game.effectContext(walker, baral, null);
    dealDamage(ctx, baral, dmg(20, 'typeless'), { canMiss: false });
    equal(game.pendingDrakes.length, 0, 'at 20 he holds');
    applyDebuff(ctx, baral, { name: 'Mired', duration: 2, mods: { moveRange: -U } });
    const from = { ...baral.pos };
    dealDamage(ctx, baral, dmg(99, 'typeless'), { canMiss: false });
    assert(baral.alive, 'the blow is turned aside');
    equal(baral.hp, 19, 'he is left at 19');
    equal(game.pendingDrakes.map((p) => p.count), [2], 'below it: two drakes');
    assert(baral.statuses.some((s) => s.kind === 'invisibility' && s.duration === 1), 'unseen until his next turn');
    assert(!baral.statuses.some((s) => s.kind === 'debuff'), 'fully cleansed');
    const dashed = Math.hypot(baral.x - from.x, baral.y - from.y);
    assert(dashed > 0 && dashed <= 10 * U + 1, `dashed up to 10cm (${dashed})`);
    assert(game.isUntargetable(baral, walker) && baral.unseen, 'gone from sight: nothing can single him out');
    equal(dealDamage(ctx, baral, dmg(5, 'typeless'), { canMiss: false }), 0, 'and nothing reaches him until his next turn');
    game.setCurrent(baral);
    game.beginTurn();
    assert(!baral.unseen && !game.isUntargetable(baral, walker), 'his turn brings him back into sight');
    dealDamage(ctx, baral, dmg(1, 'typeless'), { canMiss: false });
    equal([game.pendingDrakes.length, baral.hp], [1, 18], 'only the first time');
    const other = unit('baral', 950, mid);
    const second = new GameState([walker, other], 6);
    dealDamage(second.effectContext(walker, other, null), other, dmg(20, 'sanity'), { canMiss: false });
    equal([second.pendingDrakes.length, other.sanity, other.hp], [1, 14, 40], 'sanity counts too, held at 14');
  }],

  ['builds a drake at the end of odd turns, two at his marks, and an artifact every second turn', () => {
    const walker = player(300, mid);
    const baral = unit('baral', 900, mid);
    const game = new GameState([walker, baral], 7);
    equal(game.baralEndStep(baral), { artifacts: 0, drakes: 1 }, 'first turn');
    equal(game.baralEndStep(baral), { artifacts: 1, drakes: 0 }, 'second turn');
    baral.hp = 20;
    equal(game.baralEndStep(baral), { artifacts: 0, drakes: 2 }, 'at 20 hp, two');
    baral.hp = 40;
    baral.sanity = 15;
    game.baralEndStep(baral);
    equal(game.baralEndStep(baral), { artifacts: 0, drakes: 2 }, 'at 15 sanity, two');
  }],

  ['lets a drake last three of its turns, and brings his works down with him', () => {
    const walker = player(300, mid);
    const baral = unit('baral', 900, mid);
    const drake = unit('baralDrake', 700, mid);
    const a = artifact(600, mid, 1);
    const game = new GameState([walker, baral, drake, a], 8);
    assert(!game.wearDrake(drake) && !game.wearDrake(drake), 'two turns in, still going');
    assert(game.wearDrake(drake) && !drake.alive, 'the third ends it');
    const second = unit('baralDrake', 720, mid);
    game.addMage(second);
    baral.baral!.wounded = true;
    dealDamage(game.effectContext(walker, baral, null), baral, dmg(99, 'typeless'), { canMiss: false });
    assert(!baral.alive && !second.alive && !a.alive, 'drakes and artifacts fail when he falls');
    assert(game.isOver, 'and the fight is won');
  }],

  ['hunts the player with the least health, hides when out of reach, and sends drakes at the closest', () => {
    const strong = player(840, mid, 'Strong');
    const weak = player(860, mid + 60, 'Weak');
    const baral = unit('baral', 900, mid + 20);
    const game = new GameState([strong, weak, baral], 9);
    weak.hp = 3;
    const hit = chooseBaralAction(game, baral);
    assert(hit.type === 'melee' && hit.target === weak, 'the weakest in reach: he strikes');
    baral.actions.main = 0;
    const hide = chooseBaralAction(game, baral);
    const gap = (p: { x: number; y: number }): number => Math.min(Math.hypot(p.x - strong.x, p.y - strong.y), Math.hypot(p.x - weak.x, p.y - weak.y));
    assert(hide.type === 'move' && gap(hide.point) > gap(baral.pos) + 2 * U, 'having struck, he gets away');
    baral.actions = { move: 1, main: 1, bonus: 2 };
    baral.x = 1250;
    weak.x = 120;
    const away = chooseBaralAction(game, baral);
    assert(away.type !== 'melee' && !(away.type === 'move' && Math.hypot(away.point.x - weak.x, away.point.y - weak.y) < MELEE_RANGE), 'the weakest out of reach: he does not go for anyone else');
    const drake = unit('baralDrake', 800, mid);
    game.addMage(drake);
    const bite = chooseBaralAction(game, drake);
    assert(bite.type === 'melee' && bite.target === strong, 'the drake bites the closest player');
  }],

  ['paints Baral, his artifact and his drake with every animation', () => {
    for (const id of ['baral', 'denial-artifact', 'baral-drake']) {
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
  console.error(`${failed} of ${tests.length} Baral tests failed`);
  process.exit(1);
}
console.log(`All ${tests.length} Baral tests passed.`);
