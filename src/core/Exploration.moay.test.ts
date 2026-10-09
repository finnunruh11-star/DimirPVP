import { FIELD } from '../config/constants';
import { SimpleAI } from '../ai/SimpleAI';
import { applyDebuff, applyStun, teleport } from '../effects/effects';
import { clampToMoayArena, MOAY_AOE_RADIUS } from '../pve/moay';
import { applyEnemyTraits } from '../pve/swamprun';
import { BOSS_ART } from '../visuals/bosses/art';
import { BOSS_ANIMS, renderAnim } from '../visuals/bosses/rig';
import { Dice } from './Dice';
import { GameState } from './GameState';
import { Mage } from './Mage';
import { dist } from './utils';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function fixture(players = 4): { game: GameState; boss: Mage; party: Mage[] } {
  const party = Array.from({ length: players }, (_, index) => {
    const mage = new Mage({ name: `Player ${index}`, isAI: false, team: 1,
      position: { x: FIELD.x + 40 + index * 100, y: FIELD.y + 30 + index % 2 * 340 }, loadout: [] });
    mage.maxHp = mage.hp = 100;
    return mage;
  });
  const boss = new Mage({ name: 'Boss', isAI: true, team: 2,
    position: { x: FIELD.x + FIELD.w - 40, y: FIELD.y + FIELD.h / 2 }, loadout: [] });
  applyEnemyTraits(boss, 'moay', new Dice(1));
  const game = new GameState([...party, boss], 7);
  return { game, boss, party };
}

const tests: [string, () => void | Promise<void>][] = [
  ['all five sprite keys use exactly the same nonempty pixels', () => {
    const art = BOSS_ART.rock;
    let reference = '';
    for (const animation of BOSS_ANIMS) {
      const frames = renderAnim(art, animation);
      assert(frames.length === 1, 'single-frame sprite');
      const pixels = Array.from({ length: art.h }, (_, row) =>
        Array.from({ length: art.w }, (_, column) => frames[0].px.get(column, row)));
      assert(pixels.flat().filter((pixel) => pixel >= 0).length > 600, 'visible statue');
      const raster = JSON.stringify(pixels);
      if (!reference) reference = raster;
      assert(raster === reference, `${animation} stays static`);
    }
  }],
  ['AI ends skipped turns, pursues the nearest player, and prefers a multi-player slam when reachable', async () => {
    const { game, boss, party } = fixture(3);
    const ai = new SimpleAI(game, boss);
    game.setCurrent(boss);
    game.beginTurn();
    assert(ai.chooseAction().type === 'end', 'first turn skipped');
    game.beginTurn();
    assert(ai.chooseAction().type === 'end', 'second turn skipped');
    boss.moayTurns = 3;
    boss.actions = { move: 1, main: 1, bonus: 2 };
    boss.x = 600;
    boss.y = 270;
    Object.assign(party[0], { x: 500, y: 270 });
    Object.assign(party[1], { x: 800, y: 270 });
    Object.assign(party[2], { x: 1100, y: 270 });
    const decision = ai.chooseAction();
    assert(decision.type === 'move' && decision.point.x > boss.x, 'moves toward two-player splash instead of single close target');
    boss.actions.move = 0;
    await game.makeMoveItem(boss, decision.point).resolve(game);
    const attack = ai.chooseAction();
    assert(attack.type === 'melee' && attack.target === party[1], 'hits the cluster');
    boss.actions = { move: 1, main: 1, bonus: 2 };
    boss.x = FIELD.x + FIELD.w - 30;
    Object.assign(party[0], { x: FIELD.x + 40, y: 270 });
    Object.assign(party[1], { x: FIELD.x + 150, y: 270 });
    Object.assign(party[2], { x: FIELD.x + 260, y: 270 });
    const chase = ai.chooseAction();
    assert(chase.type === 'move' && chase.point.x < boss.x, 'walks toward nearest distant player');
  }],
  ['skips two turns, removes original area in 20% ticks, then 10%, without damage or overlapping bodies', () => {
    const { game, boss } = fixture(6);
    const health = game.mages.map((m) => m.hp);
    for (const remaining of [100, 100, 80, 60, 40, 20, 10, 10]) {
      game.setCurrent(boss);
      game.beginTurn();
      assert((game.moayArena?.remaining ?? 100) === remaining, `remaining ${remaining}`);
      if (boss.moayTurns <= 2) assert(Object.values(boss.actions).every((n) => n === 0), 'no actions during skipped turns');
      else assert(boss.actions.main === 1, 'can attack after waking');
      if (game.moayArena) {
        const arena = game.moayArena;
        assert(Math.abs(arena.w * arena.h / (FIELD.w * FIELD.h) * 100 - remaining) < 0.001, 'percentage of starting area');
        for (const mage of game.mages) {
          assert(dist(mage.pos, clampToMoayArena(arena, mage.pos, mage.bodyRadius())) < 0.01, 'whole body inside walls');
          for (const other of game.mages) {
            if (mage === other) continue;
            assert(dist(mage.pos, other.pos) >= mage.bodyRadius() + other.bodyRadius(), 'no overlapping bodies');
          }
        }
      }
      assert(JSON.stringify(game.mages.map((m) => m.hp)) === JSON.stringify(health), 'walls deal no damage');
    }
    assert(MOAY_AOE_RADIUS >= Math.hypot(game.moayArena!.w, game.moayArena!.h), 'splash covers the final arena');
    const before = game.moayArena;
    game.clearFieldObjects();
    assert(before && !game.moayArena, 'new combat resets the walls');
  }],
  ['walking and teleportation cannot leave the shrinking arena, but inward walking remains possible', async () => {
    const { game, boss, party } = fixture(2);
    game.setCurrent(boss);
    for (let count = 0; count < 7; count++) game.beginTurn();
    const player = party[0];
    await game.makeMoveItem(player, { x: FIELD.x, y: FIELD.y }).resolve(game);
    assert(dist(player.pos, clampToMoayArena(game.moayArena, player.pos, player.bodyRadius())) < 0.01, 'walk stays inside');
    teleport(game.effectContext(player, player, null), player, { x: FIELD.x, y: FIELD.y });
    assert(dist(player.pos, clampToMoayArena(game.moayArena, player.pos, player.bodyRadius())) < 0.01, 'teleport stays inside');
    const centre = { x: FIELD.x + FIELD.w / 2, y: FIELD.y + FIELD.h / 2 };
    const start = player.pos;
    await game.makeMoveItem(player, centre).resolve(game);
    assert(dist(player.pos, start) > 1, 'not stuck at the wall');
  }],
  ['debuffs and stuns last twice as long', () => {
    const { game, boss, party } = fixture(1);
    const context = game.effectContext(party[0], boss, null);
    applyDebuff(context, boss, { name: 'Slow', mods: { moveRange: -1 }, duration: 2 });
    applyStun(context, boss, { type: 'main', duration: 2 });
    assert(boss.statuses.every((status) => status.duration === 4), 'doubled duration');
  }],
  ['one close-range attack damages everyone in the wide splash with the same 1d10 roll', async () => {
    const { game, boss, party } = fixture(3);
    boss.x = 640;
    boss.y = 270;
    Object.assign(party[0], { x: 570, y: 270 });
    Object.assign(party[1], { x: 350, y: 270 });
    Object.assign(party[2], { x: FIELD.x + 22, y: FIELD.y + 22 });
    assert(game.canMelee(boss, party[0]) && !game.canMelee(boss, party[1]), 'close target required, splash goes farther');
    await game.makeMeleeItem(boss, party[0]).resolve(game);
    const damage = 100 - party[0].hp;
    assert(damage >= 1 && damage <= 10, '1d10 damage');
    assert(100 - party[1].hp === damage, 'same roll for splash');
    assert(party[2].hp === 100, 'outside splash is safe');
  }],
];

let failed = 0;
for (const [name, run] of tests) {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}\n     ${(error as Error).message}`);
  }
}
if (failed) process.exit(1);