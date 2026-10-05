import { FIELD, RANGE_UNIT } from '../config/constants';
import { rollEncounter, rollForestWave } from '../pve/exploration/encounters';
import { applyMineEnemyTraits, MINE_SPAWN_KINDS, mineWaveComposition, type MineEnemyKind } from '../pve/minerun';
import { canRabbitChargeHit, makeMineActionItem } from '../pve/mineActions';
import { chooseMineAction } from '../pve/mineAI';
import { Dice } from './Dice';
import { GameState } from './GameState';
import { Mage } from './Mage';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}: expected ${e}, received ${a}`);
}

const ANIMALS: readonly MineEnemyKind[] = ['rabbit', 'slime', 'boar', 'wolf', 'lion', 'lioness'];
const MID_Y = FIELD.y + FIELD.h / 2;
const LEFT = FIELD.x + 200;

function traveller(x = LEFT, y = MID_Y): Mage {
  const m = new Mage({ name: 'Traveller', isAI: false, team: 1, position: { x, y }, loadout: [] });
  m.assignFlatStats(3);
  m.maxHp = 400;
  m.hp = 400;
  return m;
}

function beast(kind: MineEnemyKind, x: number, y = MID_Y, level = 1, seed = 3): Mage {
  const m = new Mage({ name: 'Enemy', isAI: true, team: 2, position: { x, y }, loadout: [] });
  applyMineEnemyTraits(m, { kind, level }, new Dice(seed));
  return m;
}

const isAnimal = (kind: string): boolean => (ANIMALS as readonly string[]).includes(kind);

const tests: [name: string, run: () => void | Promise<void>][] = [
  ['gives every beast less mind than body; a slime keeps 5 HP and a 1d3 bite at any level', () => {
    for (const kind of ANIMALS) {
      for (let level = 1; level <= 8; level++) {
        for (let seed = 1; seed <= 10; seed++) {
          const m = beast(kind, LEFT, MID_Y, level, seed);
          assert(m.maxSanity < m.maxHp, `${kind} L${level}#${seed}: sanity ${m.maxSanity} < hp ${m.maxHp}`);
        }
      }
    }
    for (let level = 1; level <= 10; level++) {
      const slime = beast('slime', LEFT, MID_Y, level);
      equal([slime.maxHp, slime.intrinsicMelee?.spec], [5, '1d3'], `slime at level ${level}`);
    }
    assert(beast('boar', LEFT).maxHp > beast('wolf', LEFT).maxHp, 'a boar is mostly hide');
    equal([beast('boar', LEFT).intrinsicMoveUnits, beast('wolf', LEFT).intrinsicMoveUnits], [12, 10], 'boars run 12 cm, wolves 10');
  }],

  ['a rabbit 4-7 cm off charges instead of moving, lands its blow and lives', async () => {
    for (const cm of [4.5, 5.5, 6.5]) {
      const foe = traveller();
      const rabbit = beast('rabbit', LEFT + cm * RANGE_UNIT);
      const game = new GameState([foe, rabbit], 7);
      assert(canRabbitChargeHit(game, rabbit, foe), `a charge from ${cm} cm reaches`);
      const decision = chooseMineAction(game, rabbit);
      assert(decision?.type === 'mine-action' && decision.choice.id === 'rabbit-charge', `it charges from ${cm} cm`);
      await makeMineActionItem(game, rabbit, decision.choice).resolve(game);
      assert(foe.hp < 400, 'the charge hurts');
      assert(rabbit.alive, 'and the rabbit lives');
      equal(rabbit.actions.move, 0, 'the charge was its move');
    }
    for (const cm of [2.5, 9]) {
      const foe = traveller();
      const rabbit = beast('rabbit', LEFT + cm * RANGE_UNIT);
      const game = new GameState([foe, rabbit], 7);
      assert(!canRabbitChargeHit(game, rabbit, foe), `no charge from ${cm} cm`);
      equal(chooseMineAction(game, rabbit), null, `from ${cm} cm it walks and bites like anything else`);
    }
  }],

  ['a boar hits harder the further it ran this turn, up to six', async () => {
    let seen = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const hit = async (ranCm: number): Promise<number> => {
        const foe = traveller();
        const boar = beast('boar', LEFT + 1.2 * RANGE_UNIT);
        const game = new GameState([foe, boar], seed);
        boar.distMovedThisTurn = ranCm * RANGE_UNIT;
        await game.makeMeleeItem(boar, foe).resolve(game);
        return 400 - foe.hp;
      };
      const still = await hit(0);
      const ran = await hit(10);
      const far = await hit(40);
      if (still === 0) continue;
      seen += 1;
      equal([ran - still, far - still], [5, 6], `seed ${seed}: +1 per 2 cm, capped at 6`);
    }
    assert(seen >= 10, `enough blows landed to judge (${seen})`);
  }],

  ['wolves pick one quarry and take different places round it', () => {
    const foe = traveller(FIELD.x + FIELD.w / 2, MID_Y);
    const wolves = [0, 1, 2].map((i) => beast('wolf', foe.x + 7 * RANGE_UNIT, MID_Y - RANGE_UNIT + i * RANGE_UNIT, 1, i + 1));
    const game = new GameState([foe, ...wolves], 11);
    const bearings = wolves.map((wolf) => {
      const decision = chooseMineAction(game, wolf);
      assert(decision?.type === 'move', 'each wolf moves in');
      const angle = Math.atan2(decision.point.y - foe.y, decision.point.x - foe.x);
      return angle;
    });
    for (let i = 0; i < bearings.length; i++) {
      for (let j = i + 1; j < bearings.length; j++) {
        const gap = Math.abs(Math.atan2(Math.sin(bearings[i] - bearings[j]), Math.cos(bearings[i] - bearings[j])));
        assert(gap > Math.PI / 6, `wolves ${i} and ${j} close from different sides (${(gap * 180 / Math.PI).toFixed(0)} deg)`);
      }
    }
  }],

  ['a wolf that could reach alone waits at the edge of reach until the pack can strike together', () => {
    const foe = traveller(FIELD.x + 150, MID_Y);
    const scout = beast('wolf', foe.x + 8 * RANGE_UNIT, MID_Y, 1, 1);
    const pack = [1, 2].map((i) => beast('wolf', foe.x + 30 * RANGE_UNIT, MID_Y + i * RANGE_UNIT, 1, i + 1));
    const alone = new GameState([foe, scout, ...pack], 13);
    const waiting = chooseMineAction(alone, scout);
    assert(waiting?.type === 'move', 'the scout moves');
    const held = Math.hypot(waiting.point.x - foe.x, waiting.point.y - foe.y);
    assert(held > 3 * RANGE_UNIT, `it holds off (${(held / RANGE_UNIT).toFixed(1)} cm away)`);

    const together = [scout, ...[1, 2].map((i) => beast('wolf', foe.x + 8 * RANGE_UNIT, MID_Y + i * RANGE_UNIT, 1, i + 1))];
    const ready = new GameState([foe, ...together], 13);
    const going = chooseMineAction(ready, scout);
    assert(going?.type === 'move', 'with the pack at hand it moves in');
    const close = Math.hypot(going.point.x - foe.x, going.point.y - foe.y);
    assert(close < 2 * RANGE_UNIT, `and closes to the quarry (${(close / RANGE_UNIT).toFixed(1)} cm away)`);
  }],

  ['wolves come two to five at a time; the road and the forest field only beasts; the Mine Run never does', () => {
    let packs = 0;
    for (let depth = 1; depth <= 12; depth++) {
      for (let seed = 1; seed <= 40; seed++) {
        for (const spawns of [rollEncounter('forest', 'monsters', depth, new Dice(seed * 13 + depth)), rollForestWave(depth, new Dice(seed * 17 + depth))]) {
          assert(spawns.every((s) => s.family === 'mine' && isAnimal(s.spec.kind)), `depth ${depth}: only beasts`);
          const wolves = spawns.filter((s) => s.family === 'mine' && s.spec.kind === 'wolf').length;
          if (wolves) packs += 1;
          assert(wolves === 0 || (wolves >= 2 && wolves <= 10), `depth ${depth}: wolves come in packs (${wolves})`);
        }
        const road = rollEncounter('forest', 'monsters', depth, new Dice(seed * 13 + depth));
        const roadWolves = road.filter((s) => s.family === 'mine' && s.spec.kind === 'wolf').length;
        assert(roadWolves === 0 || (roadWolves >= 2 && roadWolves <= 5), `depth ${depth}: one pack of two to five on the road (${roadWolves})`);
      }
    }
    assert(packs > 50, `wolf packs turn up (${packs})`);
    assert(!MINE_SPAWN_KINDS.some(isAnimal), 'the Mine Run roster has no beasts');
    for (let wave = 1; wave <= 20; wave++) {
      assert(mineWaveComposition(wave, new Dice(wave)).every((spec) => !isAnimal(spec.kind)), `mine wave ${wave} has no beasts`);
    }
  }],
];

for (const [name, run] of tests) {
  await run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration animals: ${tests.length} checks passed.`);
