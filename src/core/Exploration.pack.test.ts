import { dealDamage } from '../effects/effects';
import { RANGE_UNIT } from '../config/constants';
import { dmg } from './Damage';
import { GameState } from './GameState';
import { getItem, staffDice, type ItemId, type StaffBolt } from './Items';
import { Mage } from './Mage';
import { packCapacity, packFits, packSlotsUsed, slotsFor, slotsForCount, stackSize } from './Pack';
import type { Spell } from '../spells/Spell';
import { BOSSES, MOONSHARD } from '../pve/exploration/bloodmoon';
import { buyItem, dropItem, grantToParty, partyOf, sellItem, sellOffers, shopStock, withParty } from '../pve/exploration/economy';
import { enterMines, markMineKnown, mineCycle, minePassageDice, parseExplorationMines } from '../pve/exploration/mines';
import { capturePartySnapshot } from '../pve/exploration/party';
import { createRun, type ExplorationRun } from '../pve/exploration/run';
import { SHOPS, shopById, stockCandidates } from '../pve/exploration/shops';
import { craftMaterial } from './crafting/item';
import { MINE_DIRECTIONS, travelMineMaze } from '../pve/mineMaze';
import { tallyVotes } from '../pve/partyVote';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}: expected ${e}, received ${a}`);
}

function traveller(): Mage {
  const m = new Mage({ name: 'Traveller', isAI: false, team: 1, position: { x: 200, y: 200 }, loadout: ['shadow', 'mind', 'pierce', 'subtle'] });
  m.assignFlatStats(3);
  m.statStrength = 30;
  return m;
}

function freshRun(seed = 11, gold = 0): ExplorationRun {
  const run = createRun(seed, capturePartySnapshot([traveller()]));
  run.gold = gold;
  return run;
}

/** A volley: (X-1)d20 at the aimed foe and the two nearest others. */
const VOLLEY: StaffBolt = { label: 'Volley', mana: 10, sides: 20, diceDelta: -1, type: 'typeless', rangePx: 24 * RANGE_UNIT, targets: 3 };

/** A sturdy fighter with a plain body: no armour, no resistances. */
function unit(name: string, team: number, x: number): Mage {
  const m = new Mage({ name, isAI: team !== 1, team, position: { x, y: 270 }, loadout: [] });
  m.maxHp = 300;
  m.hp = 300;
  return m;
}

/** Ten different materials, one of each: a bare pack, full. */
const TEN_KINDS: ItemId[] = [
  'oreCoal', 'oreCopper', 'oreIron', 'oreGold', 'gemRuby', 'gemSapphire', 'gemEmerald', 'gemAmethyst', 'gemOnyx', 'gemDiamond',
];

const tests: [name: string, run: () => void][] = [
  ['stacks twenty to a slot, one weapon or tool to a slot, and key items and bags in none', () => {
    equal([slotsForCount('oreCopper', 20), slotsForCount('oreCopper', 21), slotsForCount('oreCopper', 41), slotsForCount('oreCopper', 59)], [1, 2, 3, 3], 'copper ore');
    equal(stackSize(getItem('healthPotion')), 20, 'potions stack');
    equal([stackSize(getItem('pickaxe')), stackSize(getItem('rubyStaff')), stackSize(getItem('ironCap'))], [1, 1, 1], 'tools, weapons and gear do not');
    equal([stackSize(getItem('mineMap')), stackSize(getItem('smallBag')), stackSize(getItem('bagOfHolding'))], [0, 0, 0], 'key items and bags take no slot');
    equal(slotsFor(['pickaxe', 'pickaxe', 'oreIron', 'oreIron', 'mineMap']), 3, 'two pickaxes and a stack of iron');
  }],

  ['holds ten slots bare, and as many as the best bag carried', () => {
    const mage = traveller();
    equal(packCapacity(mage), 10, 'bare');
    mage.utility.push('smallBag');
    equal(packCapacity(mage), 15, 'a small bag');
    mage.utility.push('goodBag');
    equal(packCapacity(mage), 30, 'the better bag wins');
    mage.utility.push('bagOfHolding');
    equal(packCapacity(mage), Infinity, 'a Bag of Holding has no end');
  }],

  ['refuses a new kind of thing once the pack is full, but tops up a stack and wears what it can', () => {
    const mage = traveller();
    mage.bag.push(...TEN_KINDS);
    equal(packSlotsUsed(mage), 10, 'ten kinds, ten slots');
    assert(!packFits(mage, ['herbMoonglow']), 'an eleventh kind does not fit');
    assert(packFits(mage, ['oreIron']), 'another iron ore joins its stack');
    assert(packFits(mage, ['ironCap']), 'a cap goes on the empty head');
    assert(packFits(mage, ['mineMap']), 'a key item takes no slot');
    mage.utility.push('smallBag');
    assert(packFits(mage, ['herbMoonglow']), 'a small bag makes room');
    assert(packFits(mage, [], ['smallBag']), 'the bag may go while ten slots are enough');
    mage.bag.push('herbMoonglow');
    assert(!packFits(mage, [], ['smallBag']), 'but not once its room is in use');
    mage.utility = mage.utility.filter((id) => id !== 'smallBag');
    mage.bag.push('herbDeathweed');
    assert(packFits(mage, [], ['herbMoonglow']), 'an overfull pack can always be emptied');
    assert(!packFits(mage, ['herbFireblossom']), 'but takes nothing new');
  }],

  ['leaves finds behind when no pack has room', () => {
    const run = freshRun(4);
    withParty(run, (leader) => leader.bag.push(...TEN_KINDS));
    equal(grantToParty(run, 'herbMoonglow', 2), 2, 'both herbs stay on the ground');
    equal(grantToParty(run, 'oreIron', 2), 0, 'iron joins its stack');
    equal(partyOf(run)[0].bag.filter((id) => id === 'oreIron').length, 3, 'three iron now');
  }],

  ['sells bags and the Minemap at every guild, the Minemap only once', () => {
    const run = freshRun(6, 40);
    const guild = shopById('capitol-guild')!;
    const stock = shopStock(run, guild);
    const price = (id: ItemId): number | undefined => stock.find((slot) => slot.id === id)?.price;
    equal([price('smallBag'), price('goodBag'), price('bagOfHolding'), price('mineMap')], [0.5, 2, 10, 3], 'guild prices');
    withParty(run, (leader) => leader.bag.push(...TEN_KINDS));
    const map = stock.find((slot) => slot.id === 'mineMap')!;
    assert(buyItem(run, guild.id, map.key).ok, 'the Minemap fits a full pack');
    assert(!buyItem(run, guild.id, map.key).ok, 'the party needs only one');
    assert(!sellOffers(run, guild).some((offer) => offer.id === 'mineMap'), 'a key item is never offered for sale');
    assert(!sellItem(run, guild.id, 'mineMap', false).ok, 'nor sold');
    assert(!dropItem(run, 'mineMap').ok, 'nor dropped');
    const bag = stock.find((slot) => slot.id === 'smallBag')!;
    assert(buyItem(run, guild.id, bag.key).ok, 'a bag fits a full pack');
    withParty(run, (leader) => leader.bag.push('herbMoonglow'));
    assert(!dropItem(run, 'smallBag').ok, 'a bag in use stays');
  }],

  ['sells pickaxes for 3 gold wherever they are sold', () => {
    const run = freshRun(2, 0);
    let seen = 0;
    for (const shop of Object.values(SHOPS)) {
      for (const slot of shopStock(run, shop)) {
        if (slot.id !== 'pickaxe') continue;
        equal(slot.price, 3, `${shop.id} pickaxe`);
        seen += 1;
      }
    }
    assert(seen > 0, 'somebody sells pickaxes');
  }],

  ['a Bag of Holding lightens what is inside it by a quarter', () => {
    const mage = traveller();
    mage.bag.push('oreIron', 'oreIron', 'oreIron', 'oreIron');
    const loose = mage.carriedWeight();
    mage.utility.push('bagOfHolding');
    const held = mage.carriedWeight();
    const bag = getItem('bagOfHolding').weight;
    assert(Math.abs(held - (loose * 0.75 + bag)) < 1e-9, `contents weigh 75% (${loose} -> ${held})`);
    assert(Number.isFinite(mage.carryCap()), 'and the carry limit still holds');
  }],

  ['keeps the map of the Mines between visits only with a Minemap', () => {
    const run = freshRun(9);
    const maze = enterMines(run);
    equal(run.mines!.known, [0], 'a first visit knows the entrance');
    const direction = MINE_DIRECTIONS.find((d) => Object.prototype.hasOwnProperty.call(maze.nodes[0].exits, d))!;
    const step = travelMineMaze(maze, direction, minePassageDice(run, 0, direction));
    assert(!step.blocked, 'the first passage opens');
    markMineKnown(run, step.node.id);
    enterMines(run, false);
    equal(run.mines!.known, [0], 'without the map the walk is forgotten');
    assert(run.mines!.maze.nodes[step.node.id], 'but the tunnels are still there');
    markMineKnown(run, step.node.id);
    enterMines(run, true);
    equal(run.mines!.known, [0, step.node.id], 'with the map it is kept');
    const old = JSON.parse(JSON.stringify({ cycle: run.mines!.cycle, maze: run.mines!.maze }));
    equal(parseExplorationMines(old)?.known, Object.keys(run.mines!.maze.nodes).map(Number), 'an old save keeps every junction it dug');
    let day = run.day;
    while (mineCycle(day) === mineCycle(run.day)) day += 1;
    run.day = day;
    enterMines(run, true);
    equal(run.mines!.known, [0], 'a bloodmoon reshapes the Mines, map or not');
  }],

  ['a staff bolt rolls 1 + Int/10 dice, never fewer than one', () => {
    const bolt = getItem('rubyStaff').staffBolts![0];
    equal([0, 9, 10, 25].map((int) => staffDice(int, bolt)), [1, 1, 2, 3], 'Xd6');
    equal([5, 20, 30].map((int) => staffDice(int, VOLLEY)), [1, 2, 3], '(X-1)d20, at least one');
    const caster = unit('Caster', 1, 100);
    caster.statInt = 25;
    const foe = unit('Foe', 2, 200);
    const game = new GameState([caster, foe], 5);
    game.staffBolt(caster, 'rubyStaff', 0, foe);
    const taken = 300 - foe.hp;
    assert(taken >= 3 && taken <= 18, `3d6 heat landed (${taken})`);
  }],

  ['a volley strikes the aimed foe and the nearest others in reach', () => {
    const caster = unit('Caster', 1, 100);
    const aimed = unit('Aimed', 2, 400);
    const near = unit('Near', 2, 460);
    const nearer = unit('Nearer', 2, 430);
    const far = unit('Far', 2, 100 + 30 * RANGE_UNIT);
    const game = new GameState([caster, aimed, near, nearer, far], 9);
    equal(game.staffBoltTargets(caster, VOLLEY, aimed).map((m) => m.name), ['Aimed', 'Nearer', 'Near'], 'three foes, the far one spared');
  }],

  ['a staff shapes the spells cast through it, and only those', () => {
    const caster = unit('Caster', 1, 100);
    const foe = unit('Foe', 2, 200);
    const friend = unit('Friend', 1, 150);
    const game = new GameState([caster, foe, friend], 5);
    const ctx = game.effectContext(caster, foe, null);
    caster.hands.push('surgeStaff');
    dealDamage(ctx, foe, dmg(10, 'heat'), { canMiss: false });
    equal(300 - foe.hp, 10, 'outside a spell the staff does nothing');
    game.castThroughCaster = caster;
    dealDamage(ctx, foe, dmg(10, 'heat'), { canMiss: false });
    equal(300 - foe.hp, 25, '+50% through the Overcharged Staff');
    dealDamage(game.effectContext(caster, friend, null), friend, dmg(10, 'heat'), { canMiss: false });
    equal(300 - friend.hp, 10, 'a friend is not hit harder');
    caster.hands = ['hexStaff'];
    dealDamage(ctx, foe, dmg(10, 'heat'), { canMiss: false });
    assert(foe.statuses.some((status) => status.key === 'debuff:staff-hexed'), 'the Hexwood Staff hexes');
    const before = foe.hp;
    dealDamage(ctx, foe, dmg(10, 'heat'), { canMiss: false });
    equal(before - foe.hp, 11, 'a hexed foe takes one more');
    caster.hands = ['prismStaff'];
    foe.statuses = [];
    const prism = foe.hp;
    dealDamage(ctx, foe, dmg(10, 'heat'), { canMiss: false });
    equal(prism - foe.hp, 10, 'half heat, half light: the same total');
  }],

  ['a staff changes what spells cost and how far they reach', () => {
    const caster = unit('Caster', 1, 100);
    const game = new GameState([caster, unit('Foe', 2, 200)], 3);
    caster.hands = ['surgeStaff', 'thriftStaff'];
    equal(caster.spellManaDelta(), 0, '+2 and -2');
    caster.hands = ['thriftStaff'];
    equal(caster.spellManaDelta(), -2, "the Miser's Staff saves 2");
    caster.hands = ['farStaff'];
    const word = { words: ['shadow'], range: 100 } as unknown as Spell;
    const ability = { words: [], range: 100 } as unknown as Spell;
    equal(game.spellReach(word, caster), 100 + 5 * RANGE_UNIT, 'a word spell reaches 5cm further');
    equal(game.spellReach(ability, caster), 100, 'a colour ability does not');
  }],

  ['a bloodmoon boss leaves moonshards, the finest focus pieces a bench takes', () => {
    for (const boss of Object.values(BOSSES)) {
      const shard = MOONSHARD[boss.color];
      assert(getItem(shard).material, `${boss.id} leaves a material`);
      const material = craftMaterial(shard);
      assert(material?.slot === 'focus' && material.value >= 12, `${shard} is a top focus piece`);
    }
    for (const shop of Object.values(SHOPS)) {
      if (shop.stock) assert(!stockCandidates(shop.stock).some((def) => def.crafted || def.keyItem || def.pack), `${shop.id} never rolls crafted or key items`);
    }
  }],

  ['a party vote goes the way most want, and a tie is settled by chance', () => {
    equal(tallyVotes(['N', 'E', 'N']), 'N', 'majority');
    equal(tallyVotes([]), null, 'no votes, no choice');
    let offered: readonly string[] = [];
    equal(tallyVotes(['E', 'N'], (tied) => { offered = tied; return tied[1]; }), 'N', 'the tie-break picks');
    equal(offered, ['E', 'N'], 'among the tied, in voting order');
  }],
];

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration pack: ${tests.length} checks passed.`);
