import { CRUSADE_COST, CRUSADE_HP, crusadeHelperHealth, crusadeRoster, type CrusadeKind } from '../pve/crusade';
import { Dice } from './Dice';
import { applyEnemyTraits } from '../pve/swamprun';
import { Mage } from './Mage';
import { GameState } from './GameState';
import { dmg } from './Damage';
import { RANGE_UNIT } from '../config/constants';
import { applyDebuff, applyDot, dealDamage } from '../effects/effects';
import { fireCrusadeBallista, resolveCrusadeAction, spawnCrusadeHelpers } from '../pve/crusadeCombat';
import { chooseCrusadeAction } from '../ai/crusadeAI';
import { bossDamageScales, bossRoster, bossScaling } from '../pve/exploration/bloodmoon';
import { BOSS_ART } from '../visuals/bosses/art';
import { BOSS_ANIMS, renderAnim } from '../visuals/bosses/rig';

const U = RANGE_UNIT;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

for (const [kind, hp] of Object.entries(CRUSADE_HP)) {
  const original = { crusadeSoldier: 30, crusadePriest: 10, crusadeBallista: 20, crusadeCamp: 40, crusadeHelper: 4 }[kind];
  assert(original != null && hp === original * (2 / 3), `${kind}: exact two-thirds health`);
  const mage = new Mage({ name: kind, isAI: true, team: 2, position: { x: 700, y: 300 }, loadout: [] });
  applyEnemyTraits(mage, kind as CrusadeKind, new Dice(5));
  assert(mage.hp === hp && mage.maxHp === hp, `${kind}: instantiated health`);
}
assert(crusadeHelperHealth(3) === 4 * (2 / 3), 'three-player helper base health');
assert(crusadeHelperHealth(4) > crusadeHelperHealth(3), 'helpers scale above three players');
for (let seed = 0; seed < 200; seed++) {
  const a = crusadeRoster(3, new Dice(seed));
  const b = crusadeRoster(3, new Dice(seed));
  assert(JSON.stringify(a) === JSON.stringify(b), 'deterministic roster');
  const baseline = { crusadeSoldier: 2, crusadePriest: 1, crusadeHelper: 2, crusadeCamp: 1, crusadeBallista: 1 };
  let spent = 0;
  for (const kind of Object.keys(baseline) as CrusadeKind[]) {
    assert(a.counts[kind] >= baseline[kind], `${kind}: guaranteed minimum`);
    spent += (a.counts[kind] - baseline[kind]) * CRUSADE_COST[kind];
  }
  assert(a.points >= 8 && a.points <= 12 && spent === a.points, 'spends precisely 8-12 extra points');
}
function unit(kind: CrusadeKind, x: number, y = 300): Mage {
  const mage = new Mage({ name: kind, isAI: true, team: 2, position: { x, y }, loadout: [] });
  applyEnemyTraits(mage, kind, new Dice(5));
  mage.actions = { main: 1, move: 1, bonus: 2 };
  return mage;
}

function player(x = 300): Mage {
  const mage = new Mage({ name: 'Walker', isAI: false, team: 1, position: { x, y: 300 }, loadout: [] });
  mage.assignFlatStats(3);
  return mage;
}

assert(!bossDamageScales('crusade') && bossScaling(3, 'crusade').health === 1, 'no generic stat inflation');
assert(bossRoster('crusade', 3, new Dice(1)).every((entry) => entry.kind.startsWith('crusade')), 'real boss roster');

{
  const walker = player();
  const soldier = unit('crusadeSoldier', 500);
  const priest = unit('crusadePriest', 700);
  const game = new GameState([walker, soldier, priest], 3);
  game.rng.chance = () => false;
  game.startRound();
  const dealt = dealDamage(game.effectContext(walker, priest, null), priest, dmg(10, 'generic'), { canMiss: false });
  assert(priest.hp === priest.maxHp && soldier.hp === soldier.maxHp - dealt, 'soldier intercepts attacks on the ally behind it');
  assert(dealt === 7 && !soldier.reactionAvailable, '33% block, reaction spent');
  assert(soldier.reduceIncoming(7, 'pierce') === 6, 'one physical armor');
  dealDamage(game.effectContext(walker, priest, null), priest, dmg(1, 'typeless'), { canMiss: false });
  assert(priest.hp < priest.maxHp, 'cannot intercept true damage');
  game.startRound();
  game.rng.chance = () => true;
  const before = priest.hp;
  dealDamage(game.effectContext(walker, priest, null), priest, dmg(1, 'typeless'), { canMiss: false });
  assert(priest.hp < before && soldier.reactionAvailable, 'true damage leaves the reaction available');
  dealDamage(game.effectContext(walker, priest, null), priest, dmg(2, 'generic'), { canMiss: false });
  assert(soldier.reactionAvailable, 'small chance to decline a block');
}

{
  const walker = player();
  const soldier = unit('crusadeSoldier', 650, 500);
  const camp = unit('crusadeCamp', 700);
  const game = new GameState([walker, soldier, camp], 4);
  const ctx = game.effectContext(walker, camp, null);
  assert(dealDamage(ctx, camp, dmg(4, 'heat'), { canMiss: false }) === 2, 'direct heat respects the Light half immunity');
  assert(dealDamage(ctx, camp, dmg(4, 'heat'), { canMiss: false, dot: true }) === 4, 'Burn damage is doubled after resistance');
  assert(dealDamage(ctx, camp, dmg(4, 'light'), { canMiss: false }) === 0, 'camp immune to Light');
  applyDebuff(ctx, camp, { name: 'Slow', duration: 4, mods: { moveRange: -10 } });
  applyDot(ctx, camp, { name: 'Poison', duration: 4, damage: dmg(1, 'corrosive') });
  assert(camp.statuses.find((s) => s.name === 'Slow')?.duration === 2, 'non-dot debuff resistance halves duration');
  assert(camp.statuses.find((s) => s.name === 'Poison')?.duration === 4, 'DoT duration is not resisted');
  assert(camp.inert && !game.initiativeOrder.includes(2), 'camp never takes a turn');
}

{
  const walker = player();
  const soldier = unit('crusadeSoldier', 700, 500);
  const camp = unit('crusadeCamp', 800);
  const helper = unit('crusadeHelper', 800, 350);
  const game = new GameState([walker, soldier, camp, helper], 5);
  walker.deathknightKind = true;
  walker.hp -= 5;
  walker.greedArmed = true;
  walker.hasGamblerBlade = () => true;
  walker.hasDeathsAngelWings = () => true;
  const hp = walker.hp;
  dealDamage(game.effectContext(walker, helper, null), helper, dmg(1, 'typeless'), { canMiss: false });
  assert(walker.hp === hp && walker.greedStacks === 0, 'helper damage grants no drain or greed');
  const sanity = walker.sanity;
  dealDamage(game.effectContext(walker, helper, null), helper, dmg(99, 'typeless'), { canMiss: false });
  assert(!helper.alive && walker.deathsAngelEnergy === 0, 'helper kills grant no energy');
  assert(sanity - walker.sanity >= 0 && sanity - walker.sanity <= 1, 'killer takes 1d2-1 mill');
  assert(game.pendingCrusadeHelpers.length === 1, 'one replacement pair queued');
  const children = spawnCrusadeHelpers(game);
  assert(children.length === 2 && children.every((m) => m.hp === crusadeHelperHealth(1)), 'two scaled helpers appear at a camp');
  assert(game.takeExtraTurn() === children[0] && game.takeExtraTurn() === children[1], 'replacements act immediately');
  dealDamage(game.effectContext(walker, soldier, null), soldier, dmg(99, 'typeless'), { canMiss: false });
  assert(camp.withdrawn && children.every((m) => m.withdrawn) && game.isOver, 'last fighter death instantly ends combat and routes support');
}

{
  const walker = player();
  const soldier = unit('crusadeSoldier', 700, 500);
  const priest = unit('crusadePriest', 750, 500);
  const ballista = unit('crusadeBallista', 850);
  const helper = unit('crusadeHelper', 850, 340);
  const camp = unit('crusadeCamp', 900, 340);
  const game = new GameState([walker, soldier, priest, ballista, helper, camp], 6);
  assert(!game.canMelee(ballista, walker), 'unloaded unmanned ballista cannot fire');
  assert(resolveCrusadeAction(game, helper, { kind: 'stock', target: camp, supply: 'load' }), 'take one load');
  assert(helper.actions.main === 0 && helper.actions.move === 0, 'taking supplies ends the turn');
  helper.actions.main = 1;
  assert(resolveCrusadeAction(game, helper, { kind: 'load', target: ballista }), 'load and man ballista');
  soldier.x = 600; soldier.y = 300; soldier.hp -= 4;
  priest.x = 650; priest.y = 300; priest.hp -= 3;
  helper.actions.main = 1;
  helper.crusade!.supply = 'load';
  assert(!resolveCrusadeAction(game, helper, { kind: 'load', target: ballista }) && helper.crusade!.supply === 'load', 'full ballista leaves its waiting load in hand');
  const hp = soldier.hp;
  const helperHp = helper.hp;
  ballista.actions.main = 0;
  assert(fireCrusadeBallista(game, ballista, walker), 'fire resolves after scene spends main action');
  assert(soldier.hp > hp && helper.hp === helperHp, 'beam heals Crusaders in its 2cm line but not helpers');
  ballista.crusade!.loaded = true;
  assert(!game.canMelee(ballista, walker), 'cannot fire twice in a turn even if reloaded');
  game.turnSeq++;
  ballista.distMovedThisTurn = U;
  assert(!game.canMelee(ballista, walker), 'cannot fire after moving');
  helper.hp = 0;
  ballista.distMovedThisTurn = 0;
  assert(!game.canMelee(ballista, walker), 'cannot fire without a living crew');
}

{
  const walker = player();
  const soldier = unit('crusadeSoldier', 700, 450);
  const priest = unit('crusadePriest', 700);
  const helper = unit('crusadeHelper', 750, 450);
  const camp = unit('crusadeCamp', 850, 450);
  const game = new GameState([walker, soldier, priest, helper, camp], 7);
  soldier.hp -= 3;
  assert(resolveCrusadeAction(game, priest, { kind: 'priest-heal', target: soldier }), 'priest heals another fighter');
  priest.actions.main = 1;
  assert(!resolveCrusadeAction(game, priest, { kind: 'priest-heal', target: priest }), 'no priest self-healing');
  assert(!resolveCrusadeAction(game, priest, { kind: 'priest-heal', target: helper }), 'no priest helper-healing');
  helper.crusade!.supply = 'bandages';
  camp.hp -= 10;
  helper.x = 810;
  assert(resolveCrusadeAction(game, helper, { kind: 'bandage', target: camp }), 'bandages can heal non-helper buildings');
  assert(!helper.crusade!.supply && helper.actions.move === 0, 'bandages consumed and turn ends');
  dealDamage(game.effectContext(walker, camp, null), camp, dmg(99, 'typeless'), { canMiss: false });
  helper.actions = { main: 1, move: 1, bonus: 2 };
  helper.x = 1000;
  assert(chooseCrusadeAction(game, helper).type === 'move', 'helpers panic when every camp is gone');
  helper.x = soldier.x; helper.y = soldier.y + U;
  const hp = soldier.hp;
  assert(resolveCrusadeAction(game, helper, { kind: 'panic', target: soldier }) && soldier.hp === hp - 1, 'panicked helper can wound its own faction for one true damage');
  assert(game.pendingCrusadeHelpers.length === 0, 'no camp, no replacements');
  assert(chooseCrusadeAction(game, priest).type !== 'end', 'priest chooses a ranged action and kiting position');
}

{
  const walker = player();
  const soldier = unit('crusadeSoldier', 700, 500);
  const camp = unit('crusadeCamp', 900);
  const helper = unit('crusadeHelper', 800);
  const game = new GameState([walker, soldier, camp, helper], 8);
  let defeated: Mage | undefined;
  game.onMageDefeated = (target) => { defeated = target; };
  applyDot(game.effectContext(walker, camp, null), camp, { name: 'Burn', duration: 3, damage: dmg(1, 'heat') });
  const hp = camp.hp;
  game.startRound();
  assert(camp.hp === hp - 2, 'inert camps take doubled Burn ticks once per round');
  camp.hp = 1;
  game.startRound();
  assert(!camp.alive && defeated === camp, 'inert camp DoT deaths are attributed');
  const secondCamp = unit('crusadeCamp', 950, 500);
  game.addMage(secondCamp);
  applyDot(game.effectContext(walker, helper, null), helper, { name: 'Poison', duration: 3, damage: dmg(99, 'corrosive') });
  game.setCurrent(helper);
  game.beginTurn();
  assert(!helper.alive && game.pendingCrusadeHelpers.length === 1, 'helper DoT deaths queue a replacement pair');
  applyDot(game.effectContext(walker, soldier, null), soldier, { name: 'Poison', duration: 3, damage: dmg(99, 'corrosive') });
  game.setCurrent(soldier);
  game.beginTurn();
  assert(secondCamp.withdrawn && Number(game.pendingCrusadeHelpers.length) === 0, 'last-fighter DoT death routes support and clears births');
}

for (const kind of Object.keys(CRUSADE_HP)) {
  for (const animation of BOSS_ANIMS) {
    const frames = renderAnim(BOSS_ART[kind], animation);
    assert(frames[0].px.data.some((value) => value >= 0), `${kind}: ${animation} has visible pixels`);
  }
}

console.log('Crusade health, roster, blocking, supplies, ballista, healing, panic, rewards, retreat, upkeep and art checks passed.');