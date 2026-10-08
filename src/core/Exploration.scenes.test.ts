import { FIELD, RANGE_UNIT } from '../config/constants';
import { SimpleAI } from '../ai/SimpleAI';
import { Dice } from './Dice';
import { GameState } from './GameState';
import { Mage } from './Mage';
import { hasMonsters, livesIn, rollEncounter, ZONE_ROSTERS, type EncounterKind, type EncounterSpawn, type EncounterZone } from '../pve/exploration/encounters';
import { foe } from '../pve/exploration/scenes';
import { isSceneUnitKind, parseSceneFight, sceneRoster, type SceneFight } from '../pve/exploration/sceneFight';
import { SCENES, scenesFor, stageScene } from '../pve/exploration/scenes';
import { shopById, SHOPS, WAYSIDE_DISCOUNT, WAYSIDE_KINDS, waysideShopId } from '../pve/exploration/shops';
import { capturePartySnapshot } from '../pve/exploration/party';
import { createRun } from '../pve/exploration/run';
import { applyMineEnemyTraits, MINE_ENEMY_DEFS, MINE_SPAWN_KINDS, SLIME_KINDS, type MineEnemyKind } from '../pve/minerun';
import { ENEMY_DEFS } from '../pve/swamprun';
import { canLionPounceHit, LION_POUNCE, makeMineActionItem } from '../pve/mineActions';
import { chooseMineAction } from '../pve/mineAI';
import { parseFightWire, toFightWire } from '../net/fightWire';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}: expected ${e}, received ${a}`);
}

const ZONES: EncounterZone[] = ['capitol', 'black', 'red', 'forest', 'wilds', 'lake', 'white'];
const KINDS: EncounterKind[] = ['monsters', 'robbery'];
const MID_Y = FIELD.y + FIELD.h / 2;
const LEFT = FIELD.x + 200;

function beast(kind: MineEnemyKind, x: number, team = 2, y = MID_Y): Mage {
  const m = new Mage({ name: 'Enemy', isAI: true, team, position: { x, y }, loadout: [] });
  applyMineEnemyTraits(m, { kind, level: 1 }, new Dice(3));
  return m;
}

function traveller(x = LEFT, y = MID_Y): Mage {
  const m = new Mage({ name: 'Traveller', isAI: false, team: 1, position: { x, y }, loadout: [] });
  m.assignFlatStats(3);
  m.maxHp = 400;
  m.hp = 400;
  return m;
}

/** Every rolled encounter over zones, kinds, depths and seeds, and the scene it might become. */
function* encounters(seeds = 30): Generator<{ zone: EncounterZone; kind: EncounterKind; depth: number; spawns: EncounterSpawn[]; seed: number }> {
  for (const zone of ZONES) {
    for (const kind of KINDS) {
      for (let depth = 1; depth <= 10; depth++) {
        for (let seed = 1; seed <= seeds; seed++) yield { zone, kind, depth, spawns: rollEncounter(zone, kind, depth, new Dice(seed * 31 + depth)), seed };
      }
    }
  }
}

const tests: [name: string, run: () => void | Promise<void>][] = [
  ['keeps every creature in its home: undead in the swamps, beasts and lions in the forest, the red for kobolds, sentinels, dragonborn and red slimes', () => {
    const kinds = (zone: EncounterZone): string[] => {
      const roster = ZONE_ROSTERS[zone];
      return [...new Set([...roster.monsters, ...roster.elites].map((entry) => entry.kind as string))].sort();
    };
    for (const zone of ['capitol', 'white'] as const) {
      equal(kinds(zone), [], `${zone} has no monsters yet`);
      assert(!hasMonsters(zone), `${zone} fields only robbers`);
      for (let seed = 1; seed <= 20; seed++) {
        for (const spawn of rollEncounter(zone, 'monsters', 1 + (seed % 10), new Dice(seed))) {
          assert(spawn.family === 'mine' && spawn.spec.kind.startsWith('bandit'), `${zone}: only robbers turn up (${JSON.stringify(spawn)})`);
        }
      }
    }
    equal(kinds('lake'), ['crab', 'crocodile', 'faeri', 'siren', 'spellcaster-spirit', 'water-spirit'], 'the blue lake');
    equal(kinds('forest'), ['boar', 'gigantuan-spider', 'huge-spider', 'hydra', 'lion', 'lioness', 'marsh-toad', 'rabbit', 'slime', 'small-spider', 'thornback', 'wolf'], 'the forest');
    equal(kinds('red'), ['black-dragonborn', 'elite-kobold', 'kobold', 'magma-sentinel', 'red-dragonborn', 'sentinel', 'slime-red'], 'the red surface');
    equal(kinds('wilds'), kinds('red'), 'the red wilds are the red');
    const swampDwellers = ['zombie', 'acidZombie', 'skeleton', 'wisp', 'specter', 'ghast', 'lich', 'reaper', 'deathknightSpear', 'soldierDemon', 'beastDemon', 'oni'];
    for (const kind of swampDwellers) assert(kind in ENEMY_DEFS, `${kind} is a real creature`);
    for (const zone of ZONES) {
      for (const kind of swampDwellers) {
        if (zone !== 'black') assert(!livesIn(kind, zone), `${kind} never leaves the swamps (${zone})`);
      }
    }
    const red = kinds('red').filter((kind) => kind !== 'slime-red');
    equal([...MINE_SPAWN_KINDS].sort(), [...red, 'cavern-bat', 'earth-elemental', 'golem', 'pftlhb', 'rockling'].sort(), 'the mines: the red without its slimes, and the tunnel dwellers');
  }],

  ['puts every creature of every scene in the region it plays in', () => {
    for (const scene of SCENES) {
      for (const zone of scene.zones) {
        for (let seed = 1; seed <= 12; seed++) {
          for (const unit of scene.build(Math.max(scene.minDepth ?? 1, 1 + (seed % 10)), new Dice(seed)).units) {
            if (unit.kind === 'dwarf-guard' || unit.kind === 'villager') continue;
            assert(livesIn(unit.kind, zone), `${scene.id}: ${unit.kind} does not live in ${zone}`);
          }
        }
      }
    }
  }],

  ['has handcrafted scenes, never in the black country, each one standing in for encounters that really happen', () => {
    const ids = SCENES.map((scene) => scene.id);
    equal(new Set(ids).size, ids.length, 'ids are unique');
    assert(SCENES.length >= 9, `plenty of scenes (${SCENES.length})`);
    const used = new Set<string>();
    for (const { zone, kind, depth, spawns } of encounters()) {
      for (const scene of scenesFor(zone, kind, depth, spawns, true)) used.add(scene.id);
    }
    for (const scene of SCENES) {
      assert(!scene.zones.includes('black'), `${scene.id} keeps out of the black country`);
      assert(used.has(scene.id), `${scene.id} stands in for some real encounter`);
    }
    for (const zone of ['capitol', 'forest', 'red'] as const) {
      assert(SCENES.some((scene) => scene.zones.includes(zone)), `${zone} has scenes`);
    }
  }],

  ['replaces only what it fits: wolves become a wolf hunt, never a slime; bandits a shakedown; the carriage only on red roads', () => {
    const wolves: EncounterSpawn[] = [foe('wolf', 3), foe('wolf', 3)];
    const ids = (zone: EncounterZone, kind: EncounterKind, spawns: EncounterSpawn[], road = true, depth = 5): string[] =>
      scenesFor(zone, kind, depth, spawns, road).map((scene) => scene.id);
    assert(ids('forest', 'monsters', wolves).includes('wolf-hunt'), 'wolves may be a wolf hunt');
    assert(!ids('forest', 'monsters', [foe('slime', 3)]).includes('wolf-hunt'), 'a slime is never a wolf hunt');
    assert(!ids('forest', 'robbery', wolves).includes('wolf-hunt'), 'nor a robbery');
    assert(ids('capitol', 'robbery', [foe('bandit', 3)]).includes('shakedown'), 'bandits may be shaking down a farmer');
    assert(ids('red', 'monsters', [foe('kobold', 5)], true).includes('carriage-raid'), 'raiders on the road');
    assert(!ids('red', 'monsters', [foe('kobold', 5)], false).includes('carriage-raid'), 'but no carriage off it');
    assert(!ids('red', 'monsters', [foe('kobold', 1)], true, 1).includes('carriage-raid'), 'nor near the towns');
    for (const zone of ['capitol', 'lake', 'white'] as const) {
      assert(!ids(zone, 'monsters', [foe('bandit', 3)]).length, `no monster scenes in ${zone}`);
    }
    for (const kind of KINDS) equal(ids('black', kind, [foe('zombie', 3)]), [], `no scenes in the black country (${kind})`);
  }],

  ['turns about a third of fitting encounters into scenes, the same one from the same dice', () => {
    let fits = 0;
    let staged = 0;
    for (const { zone, kind, depth, spawns, seed } of encounters(12)) {
      if (!scenesFor(zone, kind, depth, spawns, true).length) {
        equal(stageScene(zone, kind, depth, spawns, new Dice(seed), true), null, `${zone} ${kind} d${depth}: nothing fits, nothing staged`);
        continue;
      }
      fits += 1;
      const a = stageScene(zone, kind, depth, spawns, new Dice(seed), true);
      const b = stageScene(zone, kind, depth, spawns, new Dice(seed), true);
      equal(a, b, `${zone} ${kind} d${depth} #${seed}: the same dice, the same scene`);
      if (a) staged += 1;
    }
    const share = staged / fits;
    assert(share > 0.22 && share < 0.38, `about a third become scenes (${(share * 100).toFixed(0)}% of ${fits})`);
  }],

  ['lays out every scene on the field with somebody to beat, no boons, and sends it over the wire intact', () => {
    let fights = 0;
    const seen = new Set<string>();
    for (const scene of SCENES) {
      for (let depth = scene.minDepth ?? 1; depth <= 10; depth++) {
        for (let seed = 1; seed <= 12; seed++) {
          const built = scene.build(depth, new Dice(seed * 13 + depth));
          const fight: SceneFight = { id: scene.id, units: built.units, props: built.props ?? [], ...(built.wares ? { wares: built.wares } : {}) };
          const at = `${scene.id} d${depth} #${seed}`;
          fights += 1;
          seen.add(scene.id);
          assert(built.label.length > 0 && built.label.length <= 120 && !/[{}]/.test(built.label), `${at}: label "${built.label}"`);
          assert(built.units.some((unit) => unit.side === 'foe'), `${at}: somebody to beat`);
          assert(!built.wares || scene.road, `${at}: wares only from a merchant on the road`);
          for (const unit of built.units) {
            assert(isSceneUnitKind(unit.kind), `${at}: ${unit.kind} is real`);
            assert(unit.x >= 0.3 && unit.x <= 0.95 && unit.y >= 0.05 && unit.y <= 0.95, `${at}: ${unit.kind} stands on the field, right of the party (${unit.x.toFixed(2)}, ${unit.y.toFixed(2)})`);
            assert(unit.hp == null || (unit.hp > 0 && unit.hp <= 1), `${at}: ${unit.kind} health share ${unit.hp}`);
          }
          equal(parseSceneFight(JSON.parse(JSON.stringify(fight))), fight, `${at}: the wire carries it`);
          const wire = parseFightWire(JSON.parse(JSON.stringify(toFightWire({ run: createRun(1, capturePartySnapshot([traveller()])), encounter: 'monsters', depth, cameFrom: null, scene: fight }))));
          equal(wire?.scene, fight, `${at}: inside a fight too`);
        }
      }
    }
    assert(fights > 500 && seen.size === SCENES.length, `every scene laid out (${fights})`);
  }],

  ['refuses a scene off the wire that is malformed, oversized or not a creature', () => {
    const good: SceneFight = { id: 'x', units: [{ kind: 'wolf', side: 'foe', x: 0.7, y: 0.5 }], props: [] };
    assert(parseSceneFight(good), 'a plain scene reads');
    equal(parseSceneFight({ ...good, units: [{ kind: 'constructor', side: 'foe', x: 0.7, y: 0.5 }] }), undefined, 'no prototype keys for kinds');
    equal(parseSceneFight({ ...good, units: [{ kind: 'wolf', side: 'judge', x: 0.7, y: 0.5 }] }), undefined, 'no made-up sides');
    equal(parseSceneFight({ ...good, units: [] }), undefined, 'nobody there');
    equal(parseSceneFight({ ...good, units: Array.from({ length: 17 }, () => good.units[0]) }), undefined, 'a crowd too big');
    equal(parseSceneFight('scene'), undefined, 'not an object');
    const clamped = parseSceneFight({ ...good, units: [{ kind: 'wolf', side: 'foe', x: 9, y: -3, hp: 7 }], props: [{ kind: 'castle', x: 0.5, y: 0.5 }], wares: 'castle' });
    equal([clamped?.units[0].x, clamped?.units[0].y, clamped?.units[0].hp, clamped?.props.length, clamped?.wares], [0.95, 0.05, 1, 0, undefined], 'shares clamped, unknown props and wares dropped');
    equal(parseSceneFight({ ...good, wares: 'apothecary' })?.wares, 'apothecary', 'real wares kept');
  }],

  ['draws more of the lead foe for a bigger party, never past three more', () => {
    const fight: SceneFight = {
      id: 'x',
      units: [{ kind: 'rabbit', side: 'prey', x: 0.7, y: 0.5 }, { kind: 'wolf', side: 'foe', x: 0.8, y: 0.5 }],
      props: [],
    };
    equal(sceneRoster(fight, 1).length, 2, 'alone: the scene as it stands');
    const four = sceneRoster(fight, 4);
    equal(four.map((unit) => unit.kind), ['rabbit', 'wolf', 'wolf', 'wolf', 'wolf'], 'three more wolves for four');
    equal(sceneRoster(fight, 9).length, 5, 'never more than three extra');
    for (const unit of four) assert(unit.x >= 0.05 && unit.x <= 0.95 && unit.y >= 0.05 && unit.y <= 0.95, 'extras stand on the field');
    equal(sceneRoster({ ...fight, units: [fight.units[0]] }, 4).length, 1, 'no foe, no extras');
  }],

  ['slimes of every colour share their stats; a lion outlasts and outhits a lioness, who runs faster', () => {
    const base = beast('slime', LEFT);
    for (const kind of SLIME_KINDS) {
      const slime = beast(kind, LEFT);
      equal([slime.maxHp, slime.intrinsicMelee?.spec, slime.intrinsicMoveUnits], [base.maxHp, base.intrinsicMelee?.spec, base.intrinsicMoveUnits], `${kind} is a slime`);
    }
    const tints = new Set(SLIME_KINDS.map((kind) => MINE_ENEMY_DEFS[kind].tint));
    equal(tints.size, SLIME_KINDS.length, 'each colour its own tint');
    const lion = beast('lion', LEFT);
    const lioness = beast('lioness', LEFT);
    assert(lion.maxHp > lioness.maxHp, `a lion has more health (${lion.maxHp} vs ${lioness.maxHp})`);
    assert(lion.maxSanity < lion.maxHp && lioness.maxSanity < lioness.maxHp, 'little mind for a lot of body');
    equal([lion.intrinsicMelee?.spec, lioness.intrinsicMelee?.spec], ['1d3+3', '1d3+2'], 'about five and about four a blow');
    equal([lion.intrinsicMoveUnits, lioness.intrinsicMoveUnits], [5, 6], 'lions walk 5 cm, lionesses 6');
  }],

  ['a lioness pounces once a fight, from up to five centimetres, half again as hard', async () => {
    const reach = LION_POUNCE * RANGE_UNIT;
    const target = traveller();
    const cat = beast('lioness', LEFT + reach * 0.9);
    const game = new GameState([target, cat], 5);
    assert(canLionPounceHit(game, cat, target), 'a pounce from four and a half centimetres reaches');
    const decision = chooseMineAction(game, cat);
    assert(decision?.type === 'mine-action' && decision.choice.id === 'lion-pounce', 'and she takes it');
    await makeMineActionItem(game, cat, decision.choice).resolve(game);
    const lost = 400 - target.hp;
    assert(lost >= Math.round(3 * 1.5) && lost <= Math.round(5 * 1.5), `it lands half again as hard (${lost})`);
    equal(cat.actions.move, 0, 'the pounce was her move');
    cat.movedThisTurn = false;
    assert(!canLionPounceHit(game, cat, target), 'only once a fight');
    const lion = beast('lion', LEFT + reach * 0.9);
    assert(!canLionPounceHit(new GameState([traveller(), lion], 5), lion, target), 'the males do not pounce');
    const far = beast('lioness', LEFT + reach * 2);
    const faraway = new GameState([traveller(), far], 5);
    assert(!canLionPounceHit(faraway, far, faraway.mages[0]), 'not from twice as far');
  }],

  ['keeps the sides apart: prey is never the party\'s foe, the escort never decides the fight, prey runs', () => {
    const hero = traveller();
    const guard = traveller(LEFT + 40);
    guard.isAI = true;
    guard.sceneSide = 'escort';
    const rabbit = beast('rabbit', FIELD.x + FIELD.w * 0.6, 4);
    rabbit.sceneSide = 'prey';
    rabbit.cannotAttack = true;
    const wolf = beast('wolf', FIELD.x + FIELD.w * 0.62, 2);
    const boar = beast('boar', FIELD.x + FIELD.w * 0.8, 3);
    const game = new GameState([hero, guard, rabbit, wolf, boar], 9);
    game.coopSurvivalTeam = 1;
    assert(!game.livingEnemiesOf(hero).includes(rabbit), 'the party does not hunt the prey');
    assert(game.livingEnemiesOf(wolf).includes(rabbit), 'the wolves do');
    assert(game.livingEnemiesOf(boar).includes(wolf) && game.livingEnemiesOf(wolf).includes(boar), 'rivals fight each other');
    const run = new SimpleAI(game, rabbit).chooseAction();
    assert(run.type === 'move', 'the prey runs');
    assert(!game.isOver, 'the fight is on');
    hero.hp = 0;
    assert(game.isOver, 'the party fell: the guard fights on alone, but the fight is lost');
  }],

  ['opens wayside wares for every kind: stocked like the towns, a little cheaper, buying nothing', () => {
    for (const kind of WAYSIDE_KINDS) {
      const shop = shopById(waysideShopId(kind));
      assert(shop?.stock, `${kind}: stocked`);
      equal([shop.kind, shop.buys.length, shop.services.length], [kind, 0, 0], `${kind}: sells only`);
      const model = Object.values(SHOPS).find((town) => town.kind === kind && town.stock && town !== shop)!;
      const usual = model.stock!.priceMult ?? 1;
      assert(Math.abs((shop.stock.priceMult ?? 1) - usual * WAYSIDE_DISCOUNT) < 1e-9, `${kind}: ${WAYSIDE_DISCOUNT} of the usual price`);
    }
  }],
];

for (const [name, run] of tests) {
  await run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration scenes: ${tests.length} checks passed.`);
