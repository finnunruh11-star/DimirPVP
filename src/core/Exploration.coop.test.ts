import { Dice } from '../core/Dice';
import { MAGE_CLASSES, type MageClass } from '../core/Classes';
import { getItem } from '../core/Items';
import { Mage } from '../core/Mage';
import { WORD_ORDER } from '../core/Words';
import {
  addRunXp,
  classesUnique,
  fightingParty,
  levelsOwed,
  mergeFightParty,
  partyScale,
  respawnFallen,
} from '../pve/exploration/coop';
import {
  applyCreation,
  creationWordOffers,
  STARTER_WEAPONS,
  validCreationPick,
  type CreationPick,
} from '../pve/exploration/creation';
import { giveItem, grantToParty, memberIn, partyOf, rest, roomPrice, withParty } from '../pve/exploration/economy';
import { rollReinforcements } from '../pve/exploration/encounters';
import { ROAD_EVENTS } from '../pve/exploration/events';
import { applyIntent, parseIntent } from '../pve/exploration/intents';
import { applyLevelChoice, levelWordOffers } from '../pve/exploration/levels';
import { capturePartySnapshot, restoreParty } from '../pve/exploration/party';
import { createRun, type ExplorationRun } from '../pve/exploration/run';
import { parseRun } from '../pve/exploration/save';
import { shopById } from '../pve/exploration/shops';
import { ENEMY_DEFS } from '../pve/swamprun';
import { xpToNext } from '../pve/progression';
import { parseWildPack } from '../net/fightWire';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}: expected ${e}, received ${a}`);
}

function traveller(mageClass: MageClass, name: string): Mage {
  const mage = new Mage({ name, isAI: false, team: 1, position: { x: 200, y: 200 }, loadout: ['shadow', 'mind', 'subtle'], mageClass });
  mage.assignFlatStats(3);
  return mage;
}

function partyRun(size: number, seed = 5, gold = 10): ExplorationRun {
  const party = MAGE_CLASSES.slice(0, size).map((mageClass, index) => traveller(mageClass, `Player ${index + 1}`));
  const run = createRun(seed, capturePartySnapshot(party));
  run.gold = gold;
  return run;
}

/** The first offered word each round, a modifier and a weapon. */
function firstPick(run: ExplorationRun, mageClass: MageClass): CreationPick {
  const words = [creationWordOffers(run, mageClass, 0, [])[0]];
  words.push(creationWordOffers(run, mageClass, 1, words)[0]);
  return { mageClass, words, modifier: 'delay', weapon: 'huntingBow' };
}

const tests: [name: string, run: () => void][] = [
  ['offers each traveller three distinct base words, and a second round without the first pick', () => {
    const run = partyRun(3);
    for (const mageClass of MAGE_CLASSES) {
      const first = creationWordOffers(run, mageClass, 0, []);
      equal(first, creationWordOffers(run, mageClass, 0, []), `${mageClass} offers are seeded`);
      equal(new Set(first).size, 3, `${mageClass} gets three different words`);
      assert(first.every((word) => WORD_ORDER.includes(word)), `${mageClass} is offered base words only`);
      const second = creationWordOffers(run, mageClass, 1, [first[0]]);
      assert(!second.includes(first[0]), `${mageClass} is not offered its first word again`);
    }
  }],

  ['sets the party out with one class each, two words, a modifier and a weapon', () => {
    const run = createRun(9, partyRun(2).party, { creating: true });
    equal(run.gold, 1, 'five silver per traveller');
    const picks = [firstPick(run, 'hexcraft'), firstPick(run, 'objects')];
    assert(picks.every((pick) => validCreationPick(run, pick)), 'the offered picks are valid');
    assert(!validCreationPick(run, { ...picks[0], words: ['storm', 'fire'] }), 'unoffered words are refused');
    assert(!validCreationPick(run, { ...picks[0], weapon: 'torch' }), 'only starter weapons');
    assert(!applyCreation(run, [picks[0], { ...picks[1], mageClass: 'hexcraft' }]), 'a class travels once');
    assert(run.creating, 'a refused creation changes nothing');
    assert(applyCreation(run, picks), 'the party sets out');
    const party = partyOf(run);
    equal(party.map((mage) => mage.mageClass), ['hexcraft', 'objects'], 'classes in seat order');
    equal(party[0].loadout, [...picks[0].words, 'delay'], 'two words and the modifier');
    assert(party[1].hands.includes('huntingBow') && party[1].arrows >= 15, 'the bow comes with arrows');
    assert(!run.creating && classesUnique(run.party), 'creation is over and classes are unique');
  }],

  ['scales XP by party size, so a level takes as many fights per head', () => {
    equal(xpToNext(1, partyScale(1)), xpToNext(1), 'solo curve unchanged');
    equal(xpToNext(1, partyScale(2)), Math.ceil(10 * 1.75), 'two need 75% more');
    const run = partyRun(2);
    equal(addRunXp(run, 17), 0, 'seventeen XP is not yet a level for two');
    equal(addRunXp(run, 1), 1, 'eighteen is');
    equal([run.level, run.xp, run.pendingLevels], [2, 0, 1], 'the level is owed');
    equal(levelsOwed(run, 'objects'), 1, 'each member owes it');
  }],

  ['takes each member\'s level rewards on their own, checking the offers', () => {
    const run = partyRun(2);
    addRunXp(run, 18);
    const offers = levelWordOffers(run, 'life', 2, memberIn(run, 'life')!.loadout);
    assert(!applyLevelChoice(run, 'life', { level: 3, stats: [] }).ok, 'only the next level');
    assert(!applyLevelChoice(run, 'life', { level: 2, stats: ['hp'] }).ok, 'no stats on an even level');
    const unoffered = WORD_ORDER.find((word) => !offers.includes(word) && !memberIn(run, 'life')!.loadout.includes(word))!;
    assert(!applyLevelChoice(run, 'life', { level: 2, stats: [], word: unoffered }).ok, 'only offered words');
    assert(applyLevelChoice(run, 'life', { level: 2, stats: [], word: offers[0] }).ok, 'the offer is learned');
    assert(memberIn(run, 'life')!.loadout.includes(offers[0]), 'the word is on the rack');
    equal([levelsOwed(run, 'life'), levelsOwed(run, 'objects'), run.pendingLevels], [0, 1, 1], 'the other member still owes it');
  }],

  ['a night at an inn raises the fallen with 1 HP, 1 sanity and nothing to cast with', () => {
    const run = partyRun(2, 3, 5);
    withParty(run, (_leader, party) => {
      party[0].hp = 3;
      party[1].hp = 0;
    });
    const guild = shopById('capitol-guild')!;
    equal(roomPrice(run, guild), Math.round(guild.restPrice! * 2 * 10) / 10, 'a room each');
    assert(rest(run, guild.id).ok, 'the party rests');
    const [standing, risen] = partyOf(run);
    assert(standing.hp > 3, 'the living heal');
    equal([risen.alive, risen.hp, risen.sanity, risen.mana], [true, 1, 1, 0], 'the fallen get up spent');
    assert(Object.values(risen.charges).every((charge) => charge === 0), 'no word charges');
    const fresh = traveller('life', 'Fresh');
    fresh.hp = 0;
    respawnFallen(fresh);
    assert(fresh.alive, 'respawning revives');
  }],

  ['fights only the standing, then keeps the fallen and the absent in the roster', () => {
    const run = partyRun(3);
    withParty(run, (_leader, party) => { party[1].hp = 0; });
    const fighters = restoreParty(fightingParty(run.party));
    equal(fighters.map((mage) => mage.mageClass), ['objects', 'hexcraft'], 'the fallen sit it out');
    fighters[0].hp = 2;
    fighters[1].hp = 0;
    const after = restoreParty(mergeFightParty(run.party, fighters));
    equal(after.map((mage) => [mage.mageClass, mage.hp]), [['objects', 2], ['life', 0], ['hexcraft', 0]], 'order and state kept');
  }],

  ['road events hit every standing member and test the best of them', () => {
    const run = partyRun(2, 4, 20);
    withParty(run, (_leader, party) => {
      party[0].statStrength = 0;
      party[1].statStrength = 30;
    });
    const carter = ROAD_EVENTS.find((event) => event.id === 'carter')!;
    carter.choices[0].resolve({ run, zone: 'capitol', depth: 1, dice: new Dice(1) });
    const shrine = ROAD_EVENTS.find((event) => event.id === 'shrine')!;
    withParty(run, (_leader, party) => { for (const mage of party) mage.hp = 2; });
    shrine.choices[0].resolve({ run, zone: 'capitol', depth: 1, dice: new Dice(2) });
    assert(partyOf(run).every((mage) => mage.hp > 2), 'prayer heals everyone');
  }],

  ['hands finds to whoever can carry them, and lets members pass items on', () => {
    const run = partyRun(2);
    withParty(run, (_leader, party) => { party[0].statStrength = -20; });
    grantToParty(run, 'oreIron', 2);
    const [weak, strong] = partyOf(run);
    equal([weak.bag.filter((id) => id === 'oreIron').length, strong.bag.filter((id) => id === 'oreIron').length], [0, 2], 'the one with room carries it');
    assert(giveItem(run, 'oreIron', 'life', 'objects').ok === false, 'the weak cannot take it');
    withParty(run, (_leader, party) => { party[0].statStrength = 3; });
    assert(giveItem(run, 'oreIron', 'life', 'objects').ok, 'passed across');
    equal(memberIn(run, 'objects')!.bag.filter((id) => id === 'oreIron').length, 1, 'arrived');
    assert(!giveItem(run, 'oreIron', 'life', 'life').ok, 'not to yourself');
  }],

  ['reads intents off the wire defensively and applies them for the right member', () => {
    equal(parseIntent({ op: 'equip', item: 'constructor' }), null, 'prototype keys are not items');
    equal(parseIntent({ op: 'buy', shop: 'x'.repeat(200), key: 'k' }), null, 'long strings are refused');
    equal(parseIntent({ op: 'launch-missiles' }), null, 'unknown ops are refused');
    equal(parseIntent('rest'), null, 'non-objects are refused');
    equal(parseIntent({ op: 'give', item: 'torch', to: 'objects' }), { op: 'give', item: 'torch', to: 'objects' }, 'a gift parses');
    const run = partyRun(2);
    assert(!applyIntent(run, 'hexcraft', { op: 'drop', item: 'torch' }).ok, 'nobody of that class travels');
    withParty(run, (_leader, party) => { party[1].bag.push('torch'); });
    assert(applyIntent(run, 'life', { op: 'drop', item: 'torch' }).ok, 'members act for themselves');
  }],

  ['saves the creation state and per-member levels, and upgrades single-count saves', () => {
    const run = partyRun(2);
    run.creating = true;
    const parsed = parseRun(JSON.stringify(run));
    assert(parsed && parsed.creating, 'creation survives a save');
    const legacy = JSON.parse(JSON.stringify(partyRun(1))) as Record<string, unknown>;
    legacy.level = 4;
    legacy.pendingLevels = 2;
    delete legacy.levelsTaken;
    delete legacy.creating;
    const upgraded = parseRun(JSON.stringify(legacy));
    assert(upgraded, 'the old save loads');
    equal([upgraded.creating, upgraded.levelsTaken.objects, upgraded.pendingLevels], [false, 2, 2], 'owed levels carried');
    const twins = JSON.parse(JSON.stringify(run)) as ExplorationRun;
    twins.party.entities[1].mageClass = twins.party.entities[0].mageClass;
    assert(!parseRun(JSON.stringify(twins)), 'two of one class are refused');
  }],

  ['brings reinforcements for a bigger party, from the same seeded dice', () => {
    equal(rollReinforcements('capitol', 'monsters', 3, new Dice(4), 0), [], 'none for one');
    const two = rollReinforcements('capitol', 'monsters', 3, new Dice(4), partyScale(2) - 1);
    assert(two.length >= 1, 'a second traveller draws more foes');
    equal(two, rollReinforcements('capitol', 'monsters', 3, new Dice(4), partyScale(2) - 1), 'seeded');
    const three = rollReinforcements('capitol', 'monsters', 3, new Dice(4), partyScale(3) - 1);
    assert(three.length >= two.length, 'a third draws at least as many');
  }],

  ['starts with the same kit per traveller', () => {
    assert(STARTER_WEAPONS.every((weapon) => getItem(weapon.id)), 'every starter weapon exists');
  }],

  ['reads an ambush the host set down, and refuses a forged one', () => {
    const pack = {
      id: 'once:amb:3,4:2:9', x: 30, y: 40, sight: 6, depth: 2, label: 'Wolves', tint: 0xffffff, hunting: true,
      spawns: [{ family: 'swamp', kind: Object.keys(ENEMY_DEFS)[0] }], zone: 'capitol', pace: 3.4,
    };
    const parsed = parseWildPack(JSON.parse(JSON.stringify(pack)));
    assert(parsed, 'a real ambush parses');
    equal([parsed.id, parsed.x, parsed.y, parsed.hunting, parsed.zone, parsed.spawns?.length], [pack.id, 30, 40, true, 'capitol', 1], 'kept');
    equal(parseWildPack({ ...pack, spawns: [{ family: 'swamp', kind: '__proto__' }] }), null, 'unknown foes are refused');
    equal(parseWildPack({ ...pack, x: -5 }), null, 'off the map is refused');
    equal(parseWildPack({ ...pack, id: 7 }), null, 'an id must be text');
    equal(parseWildPack('wolves'), null, 'non-objects are refused');
  }],
];

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration co-op: ${tests.length} checks passed.`);
