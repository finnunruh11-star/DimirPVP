import { dealDamage } from '../effects/effects';
import { RANGE_UNIT } from '../config/constants';
import { dmg } from './Damage';
import { Dice } from './Dice';
import { GameState } from './GameState';
import { getItem, staffDice, type ItemId, type StaffBolt } from './Items';
import { Mage } from './Mage';
import { packCapacity, packFits, packSlotsUsed, slotsFor, slotsForCount, stackSize } from './Pack';
import type { Spell } from '../spells/Spell';
import { BOSSES, MOONSHARD } from '../pve/exploration/bloodmoon';
import { buyItem, dropItem, grantToMage, grantToParty, partyOf, sellItem, sellOffers, sellPrice, shopStock, withParty } from '../pve/exploration/economy';
import { canMoveLoot, canReleaseLoot, claimLoot, lootEntries, moveLoot, parseLootChoice, releaseLoot } from '../pve/loot';
import { rollExploreFindLoot } from '../pve/exploration/finds';
import { applyIntent, parseIntent } from '../pve/exploration/intents';
import { levelWordPool } from '../pve/exploration/levels';
import { enterMines, markMineKnown, mineCycle, minePassageDice, parseExplorationMines } from '../pve/exploration/mines';
import { capturePartySnapshot, restoreParty } from '../pve/exploration/party';
import { createRun, type ExplorationRun } from '../pve/exploration/run';
import { parseRun } from '../pve/exploration/save';
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
  ['redistributes carried items through the loose haul without duplication', () => {
    const first = traveller();
    const second = traveller();
    first.bag.push('oreIron', 'oreIron');
    first.arrows = 2;
    first.utility.push('healthPotion');
    first.readyConsumable = 'healthPotion';
    const haul = lootEntries([]);
    assert(releaseLoot(haul, [first, second], 0, 'oreIron'), 'old inventory can become loose loot');
    equal(first.bag, ['oreIron'], 'one copy leaves the source');
    equal(claimLoot(haul, [first, second], 0, 1, grantToMage), 'oreIron', 'the other player takes it');
    equal(claimLoot(haul, [first, second], 0, 1, grantToMage), null, 'the same loose item cannot be claimed twice');
    assert(moveLoot([first, second], 0, 1, 'arrow', grantToMage), 'arrows move directly');
    equal([first.arrows, second.arrows], [1, 1], 'one arrow moves');
    assert(releaseLoot(haul, [first, second], 0, 'healthPotion'), 'readied supplies may be released');
    equal(first.readyConsumable, null, 'readied supply is cleared');
    assert(!releaseLoot(haul, [first, second], 0, 'healthPotion'), 'missing inventory cannot be released again');
    first.hands.push('ironShortsword');
    assert(!canReleaseLoot([first], 0, 'ironShortsword'), 'held gear is not loose bag inventory');
    first.bag.push('mineMap');
    assert(!canReleaseLoot([first], 0, 'mineMap'), 'key items stay with their owner');
  }],

  ['keeps weight and slot limits atomic when redistributing loot', () => {
    const first = traveller();
    const second = traveller();
    first.bag.push('oreIron');
    second.canCarry = () => false;
    assert(!canMoveLoot([first, second], 0, 1, 'oreIron'), 'overweight target refused');
    assert(!moveLoot([first, second], 0, 1, 'oreIron', grantToMage), 'overweight transfer rejected');
    equal([first.bag, second.bag], [['oreIron'], []], 'rejection changes neither bag');
    second.canCarry = () => true;
    second.bag.push(...TEN_KINDS.filter((id) => id !== 'oreIron'), 'herbMoonglow');
    assert(!moveLoot([first, second], 0, 1, 'oreIron', grantToMage), 'full target refused');
    equal(first.bag, ['oreIron'], 'a slot rejection leaves the source untouched');
    assert(!canMoveLoot([first, second], 0, 0, 'oreIron'), 'self-transfer refused');
    first.utility.push('smallBag');
    first.bag.push(...TEN_KINDS.filter((id) => id !== 'oreIron'), 'herbMoonglow');
    assert(!canReleaseLoot([first], 0, 'smallBag'), 'a bag cannot leave while its slots are needed');
    equal(parseLootChoice('release:0:oreIron'), { kind: 'release', member: 0, id: 'oreIron' }, 'release parses');
    equal(parseLootChoice('move:0:1:oreIron'), { kind: 'move', from: 0, to: 1, id: 'oreIron' }, 'transfer parses');
    for (const choice of ['release:-1:oreIron', 'move:0:oreIron', 'release:0:1:oreIron', 'move:0:1:unknown', 'release:0:%ZZ']) {
      equal(parseLootChoice(choice), null, 'malformed inventory operation refused');
    }
  }],

  ['checks the remaining weight when a weight-reducing bag leaves', () => {
    const mage = traveller();
    mage.utility.push('bagOfHolding');
    mage.bag.push(...Array.from({ length: 20 }, () => 'oreIron' as ItemId));
    const lightened = mage.carriedWeight();
    mage.carryCap = () => lightened;
    assert(!canReleaseLoot([mage], 0, 'bagOfHolding'), 'removing the weight reduction cannot overload the owner');
    equal(mage.utility, ['bagOfHolding'], 'checking removal never changes the real bag');
    const cap = lightened / 2;
    mage.carryCap = () => cap;
    assert(canReleaseLoot([mage], 0, 'oreIron'), 'an already overloaded owner can still shed weight');
  }],

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

  ['keeps an open-world find available until a pack slot is freed', () => {
    const run = freshRun(23);
    withParty(run, (mage) => {
      mage.statStrength = 1000;
      mage.hands.push('ironShortsword', 'huntingBow');
      mage.head = 'ironCap';
      mage.torso = 'paddedJerkin';
      mage.boots = 'leatherBoots';
      mage.accessories.push('copperRing', 'ironBand');
      mage.bag.push(...TEN_KINDS);
    });
    const loot = rollExploreFindLoot(run, 'forest', 11, undefined, new Dice(23));
    assert(loot?.left === 1, 'the crafted find waits when every pack slot is filled');
    assert(!partyOf(run)[0].bag.includes(loot.item), 'the item was not silently granted');
    assert(dropItem(run, 'oreCoal').ok, 'the player can free a slot');
    equal(grantToParty(run, loot.item, loot.left), 0, 'the original find fits after dropping something');
    assert(partyOf(run)[0].bag.includes(loot.item), 'the same find is now carried');
  }],

  ['lets a traveller make weight for the same open-world find', () => {
    const run = freshRun(24);
    withParty(run, (mage) => {
      mage.statStrength = 0;
      mage.bag.push('pickaxe', 'pickaxe', 'pickaxe', 'pickaxe');
    });
    const loot = rollExploreFindLoot(run, 'forest', 11, undefined, new Dice(23));
    assert(loot?.left === 1, 'the crafted find is too heavy despite free slots');
    assert(packSlotsUsed(partyOf(run)[0]) < packCapacity(partyOf(run)[0]), 'slots were not the limit');
    assert(dropItem(run, 'pickaxe').ok, 'a carried item can be dropped');
    equal(grantToParty(run, loot.item, loot.left), 0, 'the waiting find can now be carried');
    assert(partyOf(run)[0].hands.includes(loot.item), 'the exact find was picked up');
  }],

  ['exchanges a carried item for a pickup only when the replacement fits', () => {
    const mage = traveller();
    mage.statStrength = 0;
    mage.hands.push('pickaxe');
    const game = new GameState([mage], 4);
    assert(game.dropItem(mage, 'pickaxe'), 'place the pickup nearby');
    const dropId = game.droppedItems[0].id;
    while (mage.canCarry(getItem('pickaxe').weight)) mage.bag.push('pickaxe');
    assert(!mage.canCarry(getItem('pickaxe').weight), 'pickup exceeds carry limit');
    assert(game.canSwapDroppedItem(mage, dropId, 'pickaxe'), 'one discarded pickaxe frees enough weight');
    assert(!game.swapDroppedItem(mage, dropId, 'smallBag'), 'cannot exchange an item not carried');
    assert(game.swapDroppedItem(mage, dropId, 'pickaxe'), 'exchange succeeds');
    assert(mage.hands.includes('pickaxe'), 'the pickup is held');
    assert(!game.droppedItems.some((entry) => entry.id === dropId), 'original pickup is gone');
    assert(game.droppedItems.some((entry) => entry.itemId === 'pickaxe'), 'discarded item stays on the ground');

    mage.bag = [];
    mage.hands.push('surgeStaff');
    const nextDrop = game.droppedItems.find((entry) => entry.itemId === 'pickaxe')!;
    assert(game.canSwapDroppedItem(mage, nextDrop.id, 'surgeStaff'), 'a held item can free a hand');
    assert(game.swapDroppedItem(mage, nextDrop.id, 'surgeStaff'), 'full hands can exchange');
    assert(mage.hands.includes('pickaxe') && !mage.hands.includes('surgeStaff'), 'the chosen hand item was exchanged');

    mage.bag = [...TEN_KINDS, 'herbMoonglow'];
    mage.utility.push('smallBag');
    assert(!game.canSwapDroppedItem(mage, game.droppedItems[0].id, 'smallBag'), 'cannot discard a bag holding the extra slot');
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

  ['guild pouch stores three consumables through a saved party without losing pack weight', () => {
    const run = freshRun(6, 40);
    const guild = shopById('capitol-guild')!;
    const offer = shopStock(run, guild).find((slot) => slot.id === 'consumablePouch')!;
    equal(offer.price, 0.5, 'guild pouch price');
    assert(buyItem(run, guild.id, offer.key).ok, 'buy pouch');
    const mage = partyOf(run)[0];
    assert(mage.hasConsumablePouch(), 'pouch belongs to buyer');
    mage.utility.push('manaPotion', 'healthPotion', 'manaPotion', 'healthPotion');
    const weight = mage.carriedWeight();
    const slots = packSlotsUsed(mage);
    assert(mage.stowInPouch('manaPotion'), 'store potion');
    assert(mage.stowInPouch('healthPotion'), 'store second potion');
    assert(mage.stowInPouch('manaPotion'), 'store third potion');
    assert(!mage.stowInPouch('healthPotion'), 'fourth does not fit');
    assert(!mage.stowInPouch('smallBag'), 'non-consumable cannot be stored');
    equal([mage.carriedWeight(), packSlotsUsed(mage)], [weight, slots], 'contents still count');
    const [loaded] = restoreParty(capturePartySnapshot([mage]));
    equal(loaded.pouch, mage.pouch, 'contents survive save and restore');
    assert(!packFits(loaded, [], ['consumablePouch']), 'full pouch cannot be removed');
    assert(loaded.removeFromPouch('manaPotion'), 'remove one potion');
    equal(loaded.pouch.length, 2, 'two remain');
    loaded.readyConsumable = 'manaPotion';
    equal(restoreParty(capturePartySnapshot([loaded]))[0].readyConsumable, 'manaPotion', 'readied potion survives save');
    assert(loaded.stowInPouch('manaPotion'), 'readied potion can be stored');
    equal(loaded.readyConsumable, null, 'stowing clears readied state');
  }],

  ['throws directly from a pouch and spends the stored item', () => {
    const caster = unit('Caster', 1, 200);
    const foe = unit('Foe', 2, 230);
    caster.utility.push('consumablePouch', 'throwingDagger');
    assert(caster.stowInPouch('throwingDagger'), 'dagger stored');
    const game = new GameState([caster, foe], 3);
    game.throwItem(caster, foe, 'throwingDagger');
    equal(caster.pouch.length, 0, 'dagger spent from pouch');
    assert(foe.hp < foe.maxHp, 'throw dealt damage');
  }],

  ['drops, sells and hands over arrows and pouched supplies by the count', () => {
    const run = freshRun(4, 0);
    withParty(run, (leader) => {
      leader.arrows = 30;
      leader.utility.push('consumablePouch', 'manaPotion', 'manaPotion');
      leader.stowInPouch('manaPotion');
    });
    assert(dropItem(run, 'arrow', null, 12).ok, 'arrows drop');
    equal(partyOf(run)[0].arrows, 18, 'twelve left behind');
    assert(applyIntent(run, null, { op: 'drop', item: 'manaPotion', count: 2 }).ok, 'the loose potion goes first, then the pouched one');
    equal([partyOf(run)[0].utility.includes('manaPotion'), partyOf(run)[0].pouch.length], [false, 0], 'both potions gone');
    const shop = Object.values(SHOPS).find((entry) => sellPrice(entry, getItem('arrow')) > 0);
    if (shop) {
      assert(sellItem(run, shop.id, 'arrow', 8).ok, 'arrows sell by the count');
      equal(partyOf(run)[0].arrows, 10, 'eight sold');
    }
    equal(parseIntent({ op: 'drop', item: 'arrow', count: 5 }), { op: 'drop', item: 'arrow', count: 5 }, 'a count parses');
    equal(parseIntent({ op: 'drop', item: 'arrow', count: 0 }), null, 'a zero count is refused');
    equal(parseIntent({ op: 'sell', shop: 'x', item: 'arrow', count: 1.5 }), null, 'a fractional count is refused');
  }],

  ['wears capes and gloves in their own slots, and moves them there from older saves', () => {
    const mage = traveller();
    mage.bag.push('assassinsCloak', 'fightersGloves', 'tantrumGloves');
    assert(mage.equipFromBag('assassinsCloak') && mage.cape === 'assassinsCloak', 'a cloak goes on the back');
    assert(mage.equipFromBag('fightersGloves') && mage.gloves === 'fightersGloves', 'gloves go on the hands');
    assert(mage.equipFromBag('tantrumGloves') && mage.bag.includes('fightersGloves'), 'new gloves swap the old ones into the bag');
    assert(mage.stow('assassinsCloak') && !mage.cape && mage.bag.includes('assassinsCloak'), 'a cape comes off into the bag');
    const old = traveller();
    old.torso = 'darkMagesCape';
    old.accessories = ['fightersGloves', 'tantrumGloves'];
    const [loaded] = restoreParty(capturePartySnapshot([old]));
    equal([loaded.torso, loaded.cape, loaded.gloves, loaded.accessories, loaded.bag], [null, 'darkMagesCape', 'fightersGloves', [], ['tantrumGloves']], 'old gear finds its new slot');
  }],

  ['equips over a heavy load and swaps a full pair of hands in one go', () => {
    const mage = traveller();
    mage.statStrength = 0;
    mage.bag.push('oreIron', 'oreIron', 'oreIron', 'oreIron', 'oreIron', 'oreIron', 'oreIron', 'leatherCap', 'travellersDagger');
    assert(mage.overloaded(), 'the load is over capacity');
    assert(mage.equipFromBag('leatherCap'), 'gear still goes on when wearing it adds no weight');
    mage.hands = ['torch', 'buckler'];
    equal(mage.displacedBy('travellersDagger'), ['buckler'], 'the off hand gives way by default');
    equal(mage.displacedBy('travellersDagger', 'torch'), ['torch'], 'or the hand chosen');
    assert(mage.swapIn('travellersDagger', 'torch'), 'replace the main hand');
    equal(mage.hands, ['travellersDagger', 'buckler'], 'replacement stays in the selected hand');
    assert(mage.swapHands(), 'held items can switch hands');
    equal(mage.hands, ['buckler', 'travellersDagger'], 'switching hands swaps their order');
    mage.hands = ['buckler'];
    mage.bag.push('travellersDagger');
    equal(mage.displacedBy('travellersDagger', 'buckler'), ['buckler'], 'selected hand is replaced even with another hand free');
    assert(mage.swapIn('travellersDagger', 'buckler'), 'replace rather than fill a free hand');
    equal(mage.hands, ['travellersDagger'], 'replacement does not equip a second item');
    assert(mage.bag.includes('buckler'), 'displaced gear is stowed');
  }],

  ['switches the active weapon even with no actions left', () => {
    const mage = traveller();
    mage.hands = ['ironShortsword', 'travellersDagger'];
    mage.actions = { main: 0, bonus: 0, move: 0 };
    equal(mage.activeWeaponId(), 'ironShortsword', 'main weapon is initially active');
    assert(mage.swapHands(), 'dragging hands does not require an action');
    equal(mage.activeWeaponId(), 'travellersDagger', 'offhand weapon becomes active');
    equal(mage.actions, { main: 0, bonus: 0, move: 0 }, 'no actions charged');
    assert(mage.swapHands(), 'can switch back for free');
    equal(mage.activeWeaponId(), 'ironShortsword', 'original weapon becomes active again');
  }],

  ['honors empty hand targets and preserves them through saved parties', () => {
    const mage = traveller();
    mage.bag.push('travellersDagger', 'buckler');
    assert(mage.equipAt('travellersDagger', undefined, 'off'), 'equip directly into empty offhand');
    equal([mage.handAt('main'), mage.handAt('off')], [null, 'travellersDagger'], 'main hand stays empty');
    const [loaded] = restoreParty(capturePartySnapshot([mage]));
    equal([loaded.handAt('main'), loaded.handAt('off')], [null, 'travellersDagger'], 'offhand placement survives save');
    loaded.hands = ['ironShortsword'];
    equal([loaded.handAt('main'), loaded.handAt('off')], ['ironShortsword', null], 'replacing the held kit clears old placement');
    assert(mage.equipAt('buckler', undefined, 'main'), 'equip into empty main');
    equal(mage.hands, ['buckler', 'travellersDagger'], 'both hand targets are honored');
    mage.bag.push('torch');
    assert(mage.equipAt('torch', undefined, 'main'), 'replace main while offhand stays equipped');
    equal(mage.hands, ['torch', 'travellersDagger'], 'offhand is untouched');
    const actions = { ...mage.actions };
    mage.torchCombatsLeft -= 1;
    const burn = mage.torchCombatsLeft;
    assert(mage.swapHands(), 'switch held items for free');
    equal(mage.actions, actions, 'no actions spent');
    equal(mage.torchCombatsLeft, burn, 'torch is not stowed or relit');
    mage.sabotagedItems.add('torch');
    assert(!mage.swapHands(), 'bound gear cannot change hands');
  }],

  ['puts a fresh torch back whole, but spends one that has burned', () => {
    const mage = traveller();
    mage.bag.push('torch');
    assert(mage.equipFromBag('torch'), 'lit');
    assert(!mage.torchSpentOnStow('torch'), 'a fresh torch is not spent');
    assert(mage.unequipHand('torch') && mage.bag.includes('torch'), 'back in the pack, whole');
    assert(mage.equipFromBag('torch'), 'lit again');
    mage.torchCombatsLeft -= 1;
    assert(mage.torchSpentOnStow('torch'), 'a burned torch is spent');
    assert(mage.unequipHand('torch') && !mage.bag.includes('torch'), 'put out and gone');
  }],

  ['checks and applies targeted equipment and free hand switches through co-op intents', () => {
    const mage = traveller();
    mage.hands = ['torch', 'buckler'];
    mage.bag.push('travellersDagger');
    const run = createRun(11, capturePartySnapshot([mage]));
    const intent = parseIntent({ op: 'equip', item: 'travellersDagger', hand: 'main' });
    assert(intent && applyIntent(run, null, intent).ok, 'targeted equip is accepted');
    equal(partyOf(run)[0].hands, ['travellersDagger', 'buckler'], 'intent honors main hand');
    const swap = parseIntent({ op: 'swap-hands' });
    assert(swap && applyIntent(run, null, swap).ok, 'swap is accepted');
    equal(partyOf(run)[0].hands, ['buckler', 'travellersDagger'], 'intent switches held items');
    equal(parseIntent({ op: 'equip', item: 'travellersDagger', hand: 'invalid' }), null, 'reject invalid hand');
    equal(parseIntent({ op: 'equip', item: 'travellersDagger', replace: 'invalid' }), null, 'reject invalid replacement');
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

  ['consumes colored moonshards to learn Fire, Mind and Shadow through checked intents', () => {
    for (const [item, word] of [['moonshardRed', 'fire'], ['moonshardBlue', 'mind'], ['moonshardBlack', 'shadow']] as const) {
      const run = freshRun();
      withParty(run, (mage) => {
        mage.setLoadout(['pierce', 'subtle']);
        mage.utility.push(item, item);
      });
      const intent = parseIntent({ op: 'learn-shard', item });
      assert(intent && applyIntent(run, null, intent).ok, `${item} can teach its word`);
      const mage = partyOf(run)[0];
      assert(mage.loadout.includes(word) && mage.charges[word]! > 0, 'the learned word is ready');
      equal(mage.utility.filter((id) => id === item).length, 1, 'consumes exactly one shard');
      assert(!applyIntent(run, null, intent).ok, 'knowing the word prevents wasting another shard');
      equal(partyOf(run)[0].utility.filter((id) => id === item).length, 1, 'duplicate learning consumes nothing');
      const saved = parseRun(JSON.stringify(run));
      assert(saved && partyOf(saved)[0].loadout.includes(word), 'the word survives a save round trip');
    }
    equal(parseIntent({ op: 'learn-shard', item: 'moonshardRed', replace: 0.5 }), null, 'fractional replacement is malformed');
    const run = freshRun();
    assert(!applyIntent(run, null, { op: 'learn-shard', item: 'moonshardRed' }).ok, 'cannot use a shard not carried');
    assert(!applyIntent(run, null, { op: 'learn-shard', item: 'oreIron' }).ok, 'ordinary materials teach nothing');
  }],

  ['only uses the acting member\'s shard, never a companion\'s', () => {
    const first = traveller();
    first.mageClass = 'objects';
    first.setLoadout(['pierce', 'subtle']);
    const second = traveller();
    second.mageClass = 'life';
    second.setLoadout(['mind', 'subtle']);
    second.utility.push('moonshardRed');
    const run = createRun(7, capturePartySnapshot([first, second]));
    const intent = { op: 'learn-shard', item: 'moonshardRed' } as const;
    assert(!applyIntent(run, 'objects', intent).ok, 'cannot consume a companion\'s shard');
    assert(!applyIntent(run, 'hexcraft', intent).ok, 'a missing member cannot learn');
    assert(applyIntent(run, 'life', intent).ok, 'the owner learns the word');
    const party = partyOf(run);
    assert(!party[0].loadout.includes('fire') && party[1].loadout.includes('fire'), 'only the acting member learns Fire');
  }],

  ['replaces a full rack word with a shard and unlocks only that new color for offers', () => {
    const run = freshRun();
    withParty(run, (mage) => {
      mage.setLoadout(['mind', 'bind', 'veil', 'water', 'pierce', 'subtle']);
      mage.bag.push('moonshardBlack');
    });
    assert(!levelWordPool(partyOf(run)[0].loadout).includes('curse'), 'black words are initially locked');
    assert(!applyIntent(run, null, { op: 'learn-shard', item: 'moonshardBlack' }).ok, 'a full rack needs a replacement');
    assert(!applyIntent(run, null, { op: 'learn-shard', item: 'moonshardBlack', replace: 5 }).ok, 'modifiers cannot be replaced');
    assert(!applyIntent(run, null, { op: 'learn-shard', item: 'moonshardBlack', replace: 99 }).ok, 'invalid replacements are refused');
    assert(partyOf(run)[0].bag.includes('moonshardBlack'), 'rejected choices keep the shard');
    assert(applyIntent(run, null, { op: 'learn-shard', item: 'moonshardBlack', replace: 4 }).ok, 'a base word can be replaced');
    const mage = partyOf(run)[0];
    equal(mage.loadout, ['mind', 'bind', 'veil', 'water', 'shadow', 'subtle'], 'rack stays within its limit');
    assert(!mage.bag.includes('moonshardBlack'), 'the bag shard is consumed');
    assert(levelWordPool(mage.loadout).includes('curse'), 'black choices unlock after learning Shadow');
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
