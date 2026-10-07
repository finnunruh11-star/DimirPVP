import { FIELD, RANGE_UNIT } from '../config/constants';
import { SimpleAI } from '../ai/SimpleAI';
import '../spells/sampleSpells';
import { WORD_COLOR } from './Colors';
import { rollEncounter, rollForestWave } from '../pve/exploration/encounters';
import { applyMineEnemyTraits, MINE_SPAWN_KINDS, mineWaveComposition, type MineEnemyKind } from '../pve/minerun';
import { canRabbitChargeHit, canUseMineAction, commitMineAction, makeMineActionItem } from '../pve/mineActions';
import { chooseMineAction } from '../pve/mineAI';
import { rollDrops } from '../pve/exploration/drops';
import { Dice } from './Dice';
import { dmg } from './Damage';
import { dealDamage } from '../effects/effects';
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

const ANIMALS: readonly MineEnemyKind[] = ['rabbit', 'slime', 'boar', 'wolf', 'lion', 'lioness', 'marsh-toad', 'thornback', 'small-spider', 'huge-spider', 'gigantuan-spider', 'hydra'];
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
  ['Water Spirit displaces before placing a three-round wall', async () => {
    const player = traveller();
    const spirit = beast('water-spirit', LEFT + 4 * RANGE_UNIT);
    const game = new GameState([player, spirit], 7);
    equal(spirit.intrinsicMoveUnits, 10, 'spirit moves ten centimetres');
    assert(['pierce', 'shatter', 'slashing'].every((type) => spirit.intrinsicImmuneTypes.includes(type as 'pierce')), 'physical immunity');
    const action = chooseMineAction(game, spirit);
    assert(action?.type === 'mine-action' && action.choice.id === 'water-surge', 'spirit chooses its surge');
    const hp = player.hp;
    await makeMineActionItem(game, spirit, action.choice).resolve(game);
    equal(player.hp, hp, 'new wall cannot slam on the first surge');
    equal(game.barriers.length, 1, 'wall placed after displacement');
    equal(game.barriers[0].ttl, 3, 'wall lasts three rounds');
    const barrier = game.barriers[0];
    game.forceMove(spirit, player, spirit.pos);
    assert(player.hp < hp, 'an existing wall can slam a displaced target');
    game.tickBarriers(); game.tickBarriers();
    assert(game.barriers.includes(barrier), 'wall persists through two rounds');
    game.tickBarriers();
    assert(!game.barriers.includes(barrier), 'wall falls on the third');
  }],
  ['Spider venom sheds painfully by movement and turn, and kills at fifty', () => {
    const victim = traveller();
    const spider = beast('huge-spider', LEFT + 5 * RANGE_UNIT);
    const game = new GameState([victim, spider], 5);
    game.addSpiderVenom(victim, 8, spider);
    const origin = victim.pos;
    victim.x += 1.4 * RANGE_UNIT;
    game.notifyMageRelocation(victim, origin, victim.pos, true);
    equal(victim.venomStacks, 7, 'one centimetre strips one stack');
    equal(victim.hp, 399, 'one stripped stack deals one damage');
    game.currentIndex = game.mages.indexOf(victim);
    game.beginTurn();
    equal(victim.venomStacks, 5, 'one quarter of seven, rounded up, sheds on turn start');
    equal(victim.hp, 397, 'turn-start removal hurts for two');
    game.addSpiderVenom(victim, 45, spider);
    assert(!victim.alive, 'fifty stacks kill immediately');
  }],
  ['a landed huge spider bite adds 2d6 venom', async () => {
    const victim = traveller();
    const spider = beast('huge-spider', LEFT + RANGE_UNIT);
    const game = new GameState([victim, spider], 8);
    for (let hit = 0; hit < 30 && victim.venomStacks === 0; hit++) {
      await game.makeMeleeItem(spider, victim).resolve(game);
    }
    assert(victim.venomStacks >= 2 && victim.venomStacks <= 12, 'the landed bite adds two six-sided dice of venom');
  }],
  ['eggs hatch in three rounds or delay two and emerge huge on a six', () => {
    let small = false;
    let huge = false;
    for (let seed = 1; seed <= 40 && (!small || !huge); seed++) {
      const game = new GameState([traveller()], seed);
      const egg = game.spawnSpiderCreature('spider-egg', 1, { x: LEFT + 5 * RANGE_UNIT, y: MID_Y });
      egg.mine!.hatchRound = game.round + 3;
      for (let turn = 0; turn < 3; turn++) game.endTurn();
      if (egg.mine!.hatchHuge) {
        assert(egg.alive && egg.mine!.hatchRound === game.round + 2, 'six delays the egg by exactly two rounds');
        game.endTurn();
        assert(egg.alive, 'still growing after one extra round');
        game.endTurn();
        assert(!egg.alive && game.mages.some((mage) => mage.mine?.kind === 'huge-spider'), 'hatches huge after the second');
        huge = true;
      } else {
        assert(!egg.alive && game.mages.some((mage) => mage.mine?.kind === 'small-spider'), 'ordinary roll hatches small');
        small = true;
      }
    }
    assert(small && huge, 'both outcomes occur under seeded dice');
  }],
  ['Spiders lay visible eggs, eat them to heal, and split on death', async () => {
    const player = traveller();
    const mother = beast('gigantuan-spider', LEFT + 5 * RANGE_UNIT);
    const game = new GameState([player, mother], 9);
    game.currentIndex = game.mages.indexOf(mother);
    game.beginTurn();
    assert(!game.mages.some((mage) => mage.mine?.kind === 'spider-egg'), 'first turn has no eggs');
    game.beginTurn();
    const eggs = game.mages.filter((mage) => mage.mine?.kind === 'spider-egg');
    assert(eggs.length >= 1 && eggs.length <= 3 && eggs.every((egg) => egg.inert), 'second turn lays inert field eggs');
    mother.hp = Math.floor(mother.maxHp / 2);
    const choice = chooseMineAction(game, mother);
    assert(choice?.type === 'mine-action' && choice.choice.id === 'spider-eat-egg', 'wounded mother eats an egg');
    const hp = mother.hp;
    await makeMineActionItem(game, mother, choice.choice).resolve(game);
    equal(mother.hp, Math.min(mother.maxHp, hp + Math.ceil(mother.maxHp / 3)), 'an egg restores one third');
    assert(!choice.choice.target!.alive, 'eaten egg does not hatch');
    const remaining = eggs.find((egg) => egg.alive);
    if (remaining) {
      for (let turn = 0; turn < 80 && remaining.alive; turn++) game.endTurn();
      assert(!remaining.alive, 'an egg hatches after three turns or two extra on a six');
      assert(game.mages.some((mage) => mage.mine?.kind === 'small-spider' || mage.mine?.kind === 'huge-spider'), 'egg produces a spider');
    }
    const huge = beast('huge-spider', LEFT + 8 * RANGE_UNIT);
    const split = new GameState([traveller(), huge], 4);
    split.defeatMage(huge, split.mages[0], 'huge spider falls');
    const children = split.mages.filter((mage) => mage.mine?.kind === 'small-spider');
    assert(children.length >= 1 && children.length <= 8, 'huge spider releases 1d8 small spiders');
    const legs = rollDrops('small-spider', 1, new Dice(2));
    assert(legs.includes('spiderLeg') && legs.filter((item) => item === 'silk').length >= 3, 'small spiders leave legs and plenty of silk');
    const titan = beast('gigantuan-spider', LEFT + 9 * RANGE_UNIT);
    const titanGame = new GameState([traveller(), titan], 4);
    titanGame.defeatMage(titan, titanGame.mages[0], 'titan falls');
    const giants = titanGame.mages.filter((mage) => mage.mine?.kind === 'huge-spider');
    assert(giants.length >= 1 && giants.length <= 4, 'gigantuan spider releases 1d4 huge spiders');
  }],
  ['Hydra gains a main action at each uncauterized quarter threshold', async () => {
    const player = traveller();
    const hydra = beast('hydra', LEFT + RANGE_UNIT);
    const game = new GameState([player, hydra], 3);
    const wound = (amount: number, type: 'pierce' | 'heat' = 'pierce'): void => {
      dealDamage(game.effectContext(player, hydra, null), hydra, dmg(amount, type), { canMiss: false, trueDamage: true });
    };
    equal(hydra.mine?.heads, 3, 'starts with three heads');
    wound(Math.floor(hydra.maxHp * 0.25) + 1);
    equal(hydra.mine?.heads, 4, 'crossing 75% grows a fourth head immediately');
    game.currentIndex = game.mages.indexOf(hydra);
    game.beginTurn();
    equal(hydra.actions.main, 4, 'four separate main actions');
    const choice = chooseMineAction(game, hydra);
    assert(choice?.type === 'mine-action' && choice.choice.id === 'hydra-bite', 'hydra attacks with heads');
    const before = player.hp;
    await makeMineActionItem(game, hydra, choice.choice).resolve(game);
    assert(before - player.hp <= 4, 'one action bites once for at most 1d4');
    wound(Math.ceil(hydra.maxHp * 0.26));
    equal(hydra.mine?.heads, 5, 'crossing 50% grows a fifth head');
    wound(Math.ceil(hydra.maxHp * 0.26), 'heat');
    equal(hydra.mine?.heads, 5, 'fire cauterizes the 25% threshold');
    game.beginTurn();
    equal(hydra.actions.main, 5, 'cauterized head does not grant an action');
    assert(!canUseMineAction(game, hydra, { id: 'hydra-regenerate' }), 'fire disables regeneration action');
    const scorched = hydra.hp;
    game.beginTurn();
    equal(hydra.hp, scorched, 'fire prevents regeneration');
    const fresh = beast('hydra', LEFT + RANGE_UNIT);
    const freshGame = new GameState([traveller(), fresh], 11);
    dealDamage(freshGame.effectContext(freshGame.mages[0], fresh, null), fresh,
      dmg(Math.ceil(fresh.maxHp * 0.8), 'pierce'), { canMiss: false, trueDamage: true });
    equal(fresh.mine?.heads, 6, 'one blow crossing all three thresholds grows three heads');
    freshGame.currentIndex = freshGame.mages.indexOf(fresh);
    freshGame.beginTurn();
    equal(fresh.actions.main, 6, 'each of six heads has one main action');
    const healChoice = chooseMineAction(freshGame, fresh);
    assert(healChoice?.type === 'mine-action' && healChoice.choice.id === 'hydra-regenerate', 'injured hydra channels regeneration');
    const woundedHp = fresh.hp;
    fresh.spend(commitMineAction(fresh, healChoice.choice));
    await makeMineActionItem(freshGame, fresh, healChoice.choice).resolve(freshGame);
    assert(fresh.hp > woundedHp && fresh.actions.main === 5, 'healing costs one head action');
    fresh.hp = fresh.maxHp;
    dealDamage(freshGame.effectContext(freshGame.mages[0], fresh, null), fresh,
      dmg(Math.ceil(fresh.maxHp * 0.3), 'pierce'), { canMiss: false, trueDamage: true });
    equal(fresh.mine?.heads, 6, 'healing and recrossing cannot farm extra heads');
  }],
  ['lake creatures control the field and forest newcomers use their own moves', async () => {
    const player = traveller();
    const ally = traveller(LEFT + RANGE_UNIT);
    const crab = beast('crab', LEFT + 6 * RANGE_UNIT);
    const game = new GameState([player, ally, crab], 7);
    equal(chooseMineAction(game, crab), { type: 'mine-action', choice: { id: 'crab-dance' } }, 'crab raves');
    const sanity = [player.sanity, ally.sanity];
    await makeMineActionItem(game, crab, { id: 'crab-dance' }).resolve(game);
    assert(player.sanity < sanity[0] && ally.sanity < sanity[1], 'rave hurts every other mage');
    crab.actions.main = 0;
    const step = chooseMineAction(game, crab);
    assert(step?.type === 'move' && step.point.y === crab.y, 'crab walks sideways only');

    const siren = beast('siren', LEFT + 7 * RANGE_UNIT);
    const song = new GameState([player, ally, siren], 5);
    equal(siren.intrinsicMoveUnits, 0, 'siren stays put');
    assert(chooseMineAction(song, siren)?.type === 'mine-action', 'siren sings at a distance');
    let charmed = false;
    for (let attempt = 0; attempt < 60 && !charmed; attempt++) {
      await makeMineActionItem(song, siren, { id: 'siren-charm', target: player }).resolve(song);
      charmed = player.sirenCharm === siren;
    }
    assert(charmed, 'song can charm');
    const oldHp = ally.hp;
    assert(song.resolveCreatureCompulsion(player), 'charmed turn is forced');
    assert(ally.hp < oldHp, 'siren makes a nearby ally the target');
    player.sirenCharm = undefined;
    const oldX = player.x;
    assert(song.resolveCreatureCompulsion(player) === false, 'control ends when charm is gone');
    player.sirenCharm = siren;
    ally.hp = 0;
    song.resolveCreatureCompulsion(player);
    assert(player.x > oldX, 'alone, the victim moves toward the siren');
    siren.x = player.x + 2 * RANGE_UNIT;
    song.currentIndex = song.mages.indexOf(siren);
    song.beginTurn();
    assert(siren.mine?.aggressive, 'proximity turns the siren aggressive on its turn start');
    const rend = chooseMineAction(song, siren);
    assert(rend?.type === 'mine-action' && rend.choice.id === 'siren-rend', 'close siren rends instead of singing');
    const hpBeforeRend = player.hp;
    await makeMineActionItem(song, siren, rend.choice).resolve(song);
    assert(player.hp < hpBeforeRend && player.sirenCharm === siren, 'rend hurts without releasing its charm');

    const spirit = beast('spellcaster-spirit', LEFT + 8 * RANGE_UNIT);
    assert(spirit.loadout.every((word) => WORD_COLOR[word] === 'blue' || WORD_COLOR[word] === 'none'), 'spirit knows only blue and colorless words');
    assert(['pierce', 'slashing', 'shatter'].every((type) => spirit.intrinsicImmuneTypes.includes(type as 'pierce')), 'spirit ignores physical damage types');
    assert(spirit.statInt > spirit.statStrength && spirit.mana === 30, 'spirit has a mage stat line and mana');
    const spiritAction = new SimpleAI(new GameState([traveller(), spirit], 3), spirit).chooseAction();
    assert(spiritAction.type === 'spell', 'spirit casts instead of running to melee');

    const toad = beast('marsh-toad', LEFT + 3 * RANGE_UNIT);
    const thorns = beast('thornback', LEFT + 3 * RANGE_UNIT);
    const toadGame = new GameState([traveller(), toad], 3);
    equal(chooseMineAction(toadGame, toad)?.type, 'mine-action', 'toad snares from a distance');
    const thornGame = new GameState([traveller(), thorns], 3);
    equal(chooseMineAction(thornGame, thorns)?.type, 'mine-action', 'thornback shoots thorns');
  }],

  ['faeri interrupts every side and crocodile grips until the d3 escape succeeds', async () => {
    for (let team = 1; team <= 2; team++) {
      const victim = traveller();
      victim.team = team;
      const faeri = beast('faeri', LEFT + 6 * RANGE_UNIT);
      const game = new GameState([victim, faeri], 6);
      let stopped = false;
      for (let attempt = 0; attempt < 60 && !stopped; attempt++) {
        stopped = game.stopDeclaredAction(game.makeMoveItem(victim, { x: LEFT + RANGE_UNIT, y: MID_Y }));
      }
      assert(stopped && victim.sanity < victim.maxSanity, 'faeri stifles and hurts either team');
      assert(faeri.x < LEFT + 6 * RANGE_UNIT, 'faeri blinks to the actor');
    }
    const victim = traveller();
    const croc = beast('crocodile', LEFT + RANGE_UNIT);
    const game = new GameState([victim, croc], 2);
    victim.fleeChannel = 'west';
    for (let attempt = 0; attempt < 30 && !victim.crocodileGrip; attempt++) {
      await game.makeMeleeItem(croc, victim).resolve(game);
    }
    assert(victim.crocodileGrip === croc, 'snapping jaw catches its prey');
    assert(victim.fleeChannel === undefined, 'a bite cancels an existing withdrawal');
    assert(game.cannotReact(victim), 'the captive cannot react');
    const captiveMove = game.makeMoveItem(victim, { x: LEFT + RANGE_UNIT, y: MID_Y });
    assert(game.stopDeclaredAction(captiveMove) && game.stunPrevents(captiveMove) != null, 'the captive cannot move or act');
    const hp = victim.hp;
    game.beginTurn();
    assert(victim.hp < hp, 'jaw deals start-of-turn piercing');
    let escaped = false;
    for (let attempt = 0; attempt < 40 && !escaped; attempt++) {
      game.resolveCreatureCompulsion(victim);
      escaped = !victim.crocodileGrip;
    }
    assert(escaped, 'a d3 break free roll eventually releases the prey');
  }],
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
