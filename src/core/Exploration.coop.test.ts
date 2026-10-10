import { Dice } from '../core/Dice';
import { MAGE_CLASSES, type MageClass } from '../core/Classes';
import { WORD_COLOR } from './Colors';
import { getItem } from '../core/Items';
import { Mage } from '../core/Mage';
import { scenarioToMages } from '../core/Scenario';
import { WORD_ORDER, type WordId } from '../core/Words';
import {
  addRunXp,
  captureSummons,
  classesUnique,
  fightingParty,
  levelsOwed,
  mergeFightParty,
  partyScale,
  partyXpScale,
  respawnFallen,
  withSummons,
} from '../pve/exploration/coop';
import {
  applyCreation,
  ARMS_PENDING,
  creationWordOffers,
  STARTER_WEAPONS,
  validCreationPick,
  type CreationPick,
} from '../pve/exploration/creation';
import { armsPending, gateRefusal, lodgeWaiting, starterPicks, takeStarterWeapon, weaponsShared } from '../pve/exploration/arms';
import { START_PLACE } from '../pve/exploration/world';
import { exchangeItems, giveItem, grantToParty, memberIn, partyOf, rest, roomPrice, withParty } from '../pve/exploration/economy';
import { rollReinforcements } from '../pve/exploration/encounters';
import { applyIntent, parseIntent } from '../pve/exploration/intents';
import { applyLevelChoice, levelWordOffers } from '../pve/exploration/levels';
import { capturePartySnapshot, restoreParty } from '../pve/exploration/party';
import { createRun, type ExplorationRun } from '../pve/exploration/run';
import { parseRun } from '../pve/exploration/save';
import { shopById } from '../pve/exploration/shops';
import { ENEMY_DEFS, rollSwamprunEncounter } from '../pve/swamprun';
import { mineWaveComposition } from '../pve/minerun';
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

/** The first offered word each round, a modifier, and a calling. */
function firstPick(run: ExplorationRun, mageClass: MageClass): CreationPick {
  const words = [creationWordOffers(run, mageClass, 0, [])[0]];
  words.push(creationWordOffers(run, mageClass, 1, words)[0]);
  return { calling: 'life', words, modifier: 'delay', stat: 'int' };
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

  ['keeps creation unrestricted but later offers within known colors and colorless words', () => {
    const starts = new Set<WordId>();
    const loadouts: WordId[][] = [['fire', 'subtle'], ['mind', 'shadow'], ['pierce', 'shatter'], ['heal', 'subtle']];
    for (let seed = 1; seed <= 60; seed++) {
      const run = partyRun(1, seed);
      for (const word of creationWordOffers(run, 'objects', 0, [])) starts.add(word);
      for (const word of creationWordOffers(run, 'objects', 1, ['fire'])) starts.add(word);
      for (const loadout of loadouts) {
        const colors = new Set(loadout.map((word) => WORD_COLOR[word]));
        const offers = levelWordOffers(run, 'objects', 2, loadout);
        assert(offers.every((word) => !loadout.includes(word)
          && (WORD_COLOR[word] === 'none' || colors.has(WORD_COLOR[word]))), 'offers never introduce a color');
        equal(offers, levelWordOffers(run, 'objects', 2, loadout), 'restricted offers remain seeded');
      }
    }
    assert(WORD_ORDER.every((word) => starts.has(word)), 'every starting word remains available');
  }],

  ['sets the party out with its calling, two words and a modifier, still unarmed', () => {
    const run = createRun(9, partyRun(2).party, { creating: true });
    equal(run.gold, 1, 'five silver per traveller');
    const [first, second] = run.party.entities.map((entity) => entity.mageClass);
    const picks = [firstPick(run, first), firstPick(run, second)];
    assert(validCreationPick(run, first, picks[0]) && validCreationPick(run, second, picks[1]), 'the offered picks are valid');
    assert(!validCreationPick(run, first, { ...picks[0], words: ['storm', 'fire'] }), 'unoffered words are refused');
    assert(!validCreationPick(run, first, { ...picks[0], modifier: 'bind' }), 'only modifiers as the modifier');
    assert(!validCreationPick(run, first, { ...picks[0], stat: 'charm' as never }), 'only a real stat');
    assert(!validCreationPick(run, first, { ...picks[0], calling: 'bard' as never }), 'only a real calling');
    const intBefore = partyOf(run)[0].statInt;
    assert(!applyCreation(run, [picks[0]]), 'everyone names their words');
    assert(run.creating, 'a refused creation changes nothing');
    assert(applyCreation(run, picks), 'the party sets out');
    const party = partyOf(run);
    equal(party[0].loadout, [...picks[0].words, 'delay'], 'two words and the modifier');
    equal(party[0].statInt, intBefore + 3, 'the chosen stat starts 3 higher');
    assert(party.every((mage) => !mage.classless && mage.spellClass === 'life'), 'everyone casts with the calling it named');
    equal(party.map((mage) => mage.mageClass), [first, second], 'the party ids are untouched');
    assert(party.every((mage) => !STARTER_WEAPONS.some((weapon) => mage.hands.includes(weapon.id))), 'nobody is armed yet');
    assert(!run.creating && armsPending(run) && classesUnique(run.party), 'creation is over and the Lodge is next');
    assert(partyOf(parseRun(JSON.stringify(run))!).every((mage) => mage.spellClass === 'life'), 'the calling survives a save');
  }],

  ['arms the party at the Lodge: one weapon each, and the gate opens once all are armed', () => {
    const run = createRun(9, partyRun(2).party, { creating: true });
    const [first, second] = run.party.entities.map((entity) => entity.mageClass);
    applyCreation(run, [firstPick(run, first), firstPick(run, second)]);
    assert(gateRefusal(run, START_PLACE, START_PLACE), 'the gate is shut while unarmed');
    equal(gateRefusal(run, 'elsewhere', START_PLACE), null, 'only Kerusai holds the party');
    equal(lodgeWaiting(run), [first, second], 'nobody is in the Lodge yet');
    assert(applyIntent(run, second, { op: 'lodge' }).ok, 'a traveller comes in');
    equal(lodgeWaiting(run), [first], 'and is no longer waited for');
    assert(!weaponsShared(run), 'fewer travellers than pedestals');
    assert(!takeStarterWeapon(run, first, 'torch').ok, 'only what is on the pedestals');
    const arrowsBefore = memberIn(run, first)!.arrows;
    assert(takeStarterWeapon(run, first, 'huntingBow').ok, 'the bow is taken');
    assert(memberIn(run, first)!.hands.includes('huntingBow'), 'the bow is equipped');
    equal(memberIn(run, first)!.arrows, arrowsBefore + 3, 'the bow comes with exactly three arrows');
    assert(!takeStarterWeapon(run, first, 'quarterstaff').ok, 'one each');
    assert(!takeStarterWeapon(run, second, 'huntingBow').ok, 'a taken weapon is gone');
    assert(armsPending(run) && gateRefusal(run, START_PLACE, START_PLACE), 'still one unarmed');
    equal(parseIntent({ op: 'arm', weapon: 'quarterstaff' }), { op: 'arm', weapon: 'quarterstaff' }, 'the intent parses');
    equal(parseIntent({ op: 'lodge' }), { op: 'lodge' }, 'so does coming in');
    assert(applyIntent(run, second, { op: 'arm', weapon: 'quarterstaff' }).ok, 'the second arms by intent');
    equal(starterPicks(run), { [first]: 'huntingBow', [second]: 'quarterstaff' }, 'who took what');
    assert(!armsPending(run) && gateRefusal(run, START_PLACE, START_PLACE) === null, 'the gate opens');
    assert(!run.flags.some((flag) => flag.startsWith('arms-in:')), 'the Lodge presence is tidied away');
  }],

  ['keeps the pedestals one each while a full party fits the rack', () => {
    const run = partyRun(3);
    run.flags.push(ARMS_PENDING);
    assert(!weaponsShared(run), 'three travellers, four pedestals');
    assert(takeStarterWeapon(run, MAGE_CLASSES[0], 'apprenticeWand').ok, 'one takes the wand');
    assert(!takeStarterWeapon(run, MAGE_CLASSES[1], 'apprenticeWand').ok, 'nobody else gets it');
    assert(takeStarterWeapon(run, MAGE_CLASSES[1], 'travellersDagger').ok, 'another takes something else');
  }],

  ['softens multiplayer mob scaling without changing solo encounters', () => {
    equal(partyScale(1), 1, 'solo budget unchanged');
    equal(partyScale(2), 1.35, 'two add 35%');
    equal(partyScale(3), 1.7, 'three add 70%');
    for (const wave of [1, 2, 3, 4, 5, 6, 8, 9]) {
      const solo = rollSwamprunEncounter(wave, new Dice(5), 1);
      const trio = rollSwamprunEncounter(wave, new Dice(5), 3);
      assert(trio.kinds.length <= solo.kinds.length + 1, 'a trio adds at most one compact mob');
    }
    const soloMine = mineWaveComposition(100, new Dice(4), 1, ['kobold']);
    const trioMine = mineWaveComposition(100, new Dice(4), 3, ['kobold']);
    equal(trioMine.length, soloMine.length + 4, 'the mine cap adds two mobs per extra member, not four');
  }],

  ['scales XP by party size, so a level takes as many fights per head', () => {
    equal(xpToNext(1, partyXpScale(partyRun(1))), xpToNext(1), 'solo curve unchanged');
    equal(xpToNext(1, partyXpScale(partyRun(2))), Math.ceil(10 * 1.75), 'two need 75% more');
    const run = partyRun(2);
    equal(addRunXp(run, 17), 0, 'seventeen XP is not yet a level for two');
    equal(addRunXp(run, 1), 0, 'eighteen waits for rest');
    equal([run.level, run.xp, run.pendingLevels], [1, 18, 0], 'the XP is banked');
    run.gold = 10;
    assert(rest(run, 'capitol-guild').ok, 'a completed night');
    equal([run.level, run.xp, run.pendingLevels], [2, 0, 1], 'the level is owed after rest');
    equal(levelsOwed(run, 'objects'), 1, 'each member owes it');
  }],

  ['takes each member\'s level rewards on their own, checking the offers', () => {
    const run = partyRun(2);
    addRunXp(run, 18);
    run.gold = 10;
    assert(rest(run, 'capitol-guild').ok, 'a completed night earns the rewards');
    const offers = levelWordOffers(run, 'life', 2, memberIn(run, 'life')!.loadout);
    assert(!applyLevelChoice(run, 'life', { level: 3, stats: ['hp'] }).ok, 'only the next level');
    assert(!applyLevelChoice(run, 'life', { level: 2, stats: ['hp', 'int'], word: offers[0] }).ok, 'one stat a level');
    const unoffered = WORD_ORDER.find((word) => !offers.includes(word) && !memberIn(run, 'life')!.loadout.includes(word))!;
    assert(!applyLevelChoice(run, 'life', { level: 2, stats: ['hp'], word: unoffered }).ok, 'only offered words');
    const before = memberIn(run, 'life')!;
    const hpBefore = before.maxHp;
    const manaBefore = before.maxMana;
    const luckBefore = before.maxLuck;
    const coreBefore = [before.statStrength, before.statDex, before.statInt];
    assert(applyLevelChoice(run, 'life', { level: 2, stats: ['hp'], word: offers[0] }).ok, 'the offer is learned');
    equal(memberIn(run, 'life')!.maxHp, hpBefore + 2, 'health gets the automatic and chosen points');
    equal(memberIn(run, 'life')!.maxMana, manaBefore + 1, 'mana grows each level');
    equal([memberIn(run, 'life')!.statStrength, memberIn(run, 'life')!.statDex, memberIn(run, 'life')!.statInt], coreBefore.map((value) => value + 1), 'core stats round up after level 2');
    equal(memberIn(run, 'life')!.maxLuck, luckBefore, 'luck does not grow');
    assert(memberIn(run, 'life')!.loadout.includes(offers[0]), 'the word is on the rack');
    equal([levelsOwed(run, 'life'), levelsOwed(run, 'objects'), run.pendingLevels], [0, 1, 1], 'the other member still owes it');
    run.level = 7;
    for (let level = 3; level <= 7; level++) {
      if (level % 2 !== 0) assert(!applyLevelChoice(run, 'life', { level, stats: ['luck'] }).ok, 'odd levels reject stat picks');
      assert(applyLevelChoice(run, 'life', { level, stats: level % 2 === 0 ? ['hp'] : [] }).ok, `level ${level} can be claimed`);
    }
    const grown = memberIn(run, 'life')!;
    equal([grown.statStrength, grown.statDex, grown.statInt], coreBefore.map((value) => value + 3), 'six levels give three rounded core points');
    equal([grown.maxHp, grown.maxMana, grown.maxLuck], [hpBefore + 9, manaBefore + 6, luckBefore], 'vitals grow and luck stays fixed');
  }],

  ['a complete night at an inn fully restores the fallen', () => {
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
    equal([risen.alive, risen.hp, risen.sanity, risen.mana], [true, risen.maxHp, risen.maxSanity, risen.maxMana], 'the fallen get up fully restored');
    assert(risen.loadout.every((word) => risen.charges[word] === risen.maxWordCharges(word)), 'all word charges restored');
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

  ['keeps a living owner\'s summons, on their shoulder, for the next fight and through a save', () => {
    const run = partyRun(3);
    const fighters = restoreParty(fightingParty(run.party));
    const foe = new Mage({ name: 'Foe', isAI: true, team: 2, position: { x: 600, y: 200 }, loadout: [] });
    const pet = (name: string, owner: number, shoulder?: 0 | 1): Mage => {
      const summon = new Mage({ name, isAI: false, team: 1, position: { x: 300, y: 200 }, loadout: [] });
      summon.isSummon = true;
      summon.summonKind = 'remnant';
      summon.summonOwnerIndex = owner;
      summon.summonShoulder = shoulder;
      return summon;
    };
    fighters[0].hp = 0;
    const field = [foe, ...fighters, pet('Orphan', 1), pet('Rider', 3, 1)];
    run.summons = captureSummons(field);
    const loaded = parseRun(JSON.stringify(run));
    assert(loaded?.summons, 'the summons survive a save');
    const next = scenarioToMages(withSummons(fightingParty(loaded.party), loaded.summons));
    equal(next.map((mage) => mage.name), ['Player 1', 'Player 2', 'Player 3', 'Rider'], 'only the living owner\'s summon follows');
    const rider = next[3];
    equal([rider.isSummon, rider.summonOwnerIndex, rider.summonShoulder], [true, 2, 1], 'back on its owner\'s shoulder');
    equal(withSummons(fightingParty(run.party), null).entities.length, 3, 'no summons, just the party');
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

  ['exchanges two offers atomically, including one-sided gifts', () => {
    const run = partyRun(2);
    withParty(run, (_leader, party) => {
      party.find((mage) => mage.mageClass === 'life')!.bag.push('oreIron', 'oreIron');
      party.find((mage) => mage.mageClass === 'objects')!.bag.push('torch');
    });
    const exchanged = exchangeItems(run, 'life', 'objects', ['oreIron'], ['torch']);
    assert(exchanged.ok, `two-sided exchange: ${exchanged.message}`);
    assert(memberIn(run, 'life')!.hands.includes('torch'), 'first received and equipped torch');
    assert(memberIn(run, 'objects')!.bag.includes('oreIron'), 'second received ore');
    const before = JSON.stringify(run.party);
    assert(!exchangeItems(run, 'life', 'objects', ['oreIron', 'oreIron'], []).ok, 'cannot offer more than owned');
    equal(JSON.stringify(run.party), before, 'failed exchange moved nothing');
    assert(exchangeItems(run, 'life', 'objects', ['oreIron'], []).ok, 'gift with empty receiving offer');
    assert(!exchangeItems(run, 'life', 'objects', [], []).ok, 'empty deal changes nothing');
    withParty(run, (_leader, party) => { party.find((mage) => mage.mageClass === 'life')!.statStrength = -20; });
    const beforeHeavy = JSON.stringify(run.party);
    assert(!exchangeItems(run, 'objects', 'life', ['oreIron'], []).ok, 'overweight gift refused');
    equal(JSON.stringify(run.party), beforeHeavy, 'overweight gift changes neither pack');
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
