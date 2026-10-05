import { Dice } from '../core/Dice';
import { getItem } from '../core/Items';
import { Mage } from '../core/Mage';
import { bountyBoard, BOUNTY_CAP } from '../pve/exploration/bounties';
import { DROP_TABLES, depthLuck, dropTable, rollDrops } from '../pve/exploration/drops';
import { grantToMage, rest, sellItem, sellPrice, withParty } from '../pve/exploration/economy';
import { ZONE_ROSTERS } from '../pve/exploration/encounters';
import { stage } from '../pve/exploration/eventKit';
import { ROAD_EVENTS, variantsFor } from '../pve/exploration/events';
import { capturePartySnapshot } from '../pve/exploration/party';
import { createRun, type ExplorationRun } from '../pve/exploration/run';
import { ROOM_PRICE, SHOPS, shopById } from '../pve/exploration/shops';
import { MINE_ENEMY_DEFS } from '../pve/minerun';
import { ENEMY_DEFS } from '../pve/swamprun';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}: expected ${e}, received ${a}`);
}

function freshRun(seed = 7): ExplorationRun {
  const mage = new Mage({ name: 'Walker', isAI: false, team: 1, position: { x: 0, y: 0 }, loadout: [] });
  mage.assignFlatStats(3);
  return createRun(seed, capturePartySnapshot([mage]));
}

const guild = shopById('capitol-guild')!;
const TOWNS = ['capitol', 'kerusai', 'hearthfire', 'oakhaven', 'pennybruck', 'thassa', 'nerogril', 'theocracy'];

const tests: [name: string, run: () => void][] = [
  ['the restless dead, goblins, bandits and the desert leave nothing; mana stones still sell', () => {
    const rng = new Dice(99);
    const nothing = ['zombie', 'skeleton', 'acidZombie', 'defender', 'goblinChief', 'goblinRaider', 'goblinShaman', 'bandit', 'bandit-archer', 'bandit-captain', 'sand-stalker', 'sandworm'];
    for (const kind of nothing) {
      for (let i = 0; i < 200; i++) equal(rollDrops(kind, 9, rng), [], `${kind} leaves nothing`);
    }
    equal([sellPrice(guild, getItem('manaStoneSmall')), sellPrice(guild, getItem('manaStoneMedium'))], [0.2, 0.5], 'they sell for 2s and 5s');
  }],

  ['fodder usually leaves nothing and harder creatures leave more; boss hoards can come up empty', () => {
    const rng = new Dice(5);
    const empty = (kind: string, depth = 1): number => {
      let none = 0;
      for (let i = 0; i < 4000; i++) if (rollDrops(kind, depth, rng).length === 0) none += 1;
      return none / 4000;
    };
    for (const kind of ['zombie', 'rabbit', 'slime', 'kobold', 'bandit', 'wolf', 'rockling']) {
      assert(empty(kind) > 0.3, `${kind} often leaves nothing (${empty(kind).toFixed(2)})`);
    }
    const worth = (kind: string): number => {
      let silver = 0;
      for (let i = 0; i < 4000; i++) for (const id of rollDrops(kind, 1, rng)) silver += getItem(id).cost;
      return silver / 4000;
    };
    assert(worth('specter') > worth('wisp') && worth('ghast') > worth('specter'), 'the harder the dead, the richer the pickings');
    assert(worth('boar') > worth('rabbit'), 'a boar is worth more than a rabbit');
    assert(worth('deathknightSpear') > worth('ghast'), 'a deathknight is worth the most');
    for (const boss of ['lich', 'reaper']) {
      const none = empty(boss);
      assert(none > 0.25 && none < 0.35, `a ${boss}'s hoard comes up empty on a 1-6 (${none.toFixed(2)})`);
    }
    assert(depthLuck(1) === 1 && depthLuck(11) > 1 && depthLuck(99) === 1.5, 'depth helps, up to half again');
    equal(rollDrops('nobody', 3, rng), [], 'an unknown creature leaves nothing');
  }],

  ['every creature the world fields has a drop table, and every drop sells at a guild', () => {
    const kinds = new Set<string>([...Object.keys(ENEMY_DEFS), ...Object.keys(MINE_ENEMY_DEFS)]);
    for (const roster of Object.values(ZONE_ROSTERS)) {
      for (const entry of [...roster.monsters, ...roster.robbery, ...roster.elites]) kinds.add(entry.kind);
    }
    for (const kind of kinds) assert(Object.prototype.hasOwnProperty.call(DROP_TABLES, kind), `${kind} has a drop table`);
    for (const kind of kinds) {
      for (const row of dropTable(kind)) {
        const def = getItem(row.item);
        assert(def?.material, `${kind} drops ${row.item}, a material`);
        assert(sellPrice(guild, def) > 0, `${row.item} sells at a guild`);
        assert(row.chance > 0 && row.chance <= 1, `${kind}/${row.item} has sane odds`);
      }
    }
  }],

  ['a room costs two silver everywhere and no bounty pays more than two gold', () => {
    for (const shop of Object.values(SHOPS).filter((s) => s.kind === 'guild')) equal(shop.restPrice, ROOM_PRICE, `${shop.name} room`);
    equal(ROOM_PRICE, 0.2, 'two silver');
    const run = freshRun(12);
    for (let day = 1; day <= 30; day++) {
      run.day = day;
      for (const town of TOWNS) {
        for (const offer of bountyBoard(run, town)) {
          assert(offer.rewardGold >= 0.2 && offer.rewardGold <= BOUNTY_CAP, `${offer.label}: ${offer.rewardGold}g`);
          equal(Math.round(offer.rewardGold * 10) / 10, offer.rewardGold, `${offer.label} pays in whole silver`);
        }
      }
    }
  }],

  ['silver adds up exactly across a sale and a night', () => {
    const run = freshRun(3);
    run.gold = 0.5;
    withParty(run, (leader) => grantToMage(leader, 'manaStoneSmall'));
    assert(sellItem(run, guild.id, 'manaStoneSmall', false).ok, 'the guild buys the stone');
    equal(run.gold, 0.7, 'five silver and two make seven');
    assert(rest(run, guild.id).ok, 'a room is affordable');
    equal(run.gold, 0.5, 'and costs two');
  }],

  ['roadside events never pay gold or experience', () => {
    const zones = ['capitol', 'black', 'red', 'forest', 'wilds', 'lake', 'white'] as const;
    for (const event of ROAD_EVENTS) {
      for (const zone of zones) {
        for (const variant of variantsFor(event, zone)) variant.choices.forEach((_, index) => {
          for (let seed = 1; seed <= 6; seed++) {
            const run = freshRun(seed);
            run.gold = 10;
            const choice = stage(event, variant, new Dice(seed)).choices[index];
            const ctx = { run, zone, depth: 3, dice: new Dice(seed * 31 + index) };
            withParty(run, (leader) => grantToMage(leader, 'healthPotion'));
            if (choice.available && !choice.available(ctx)) continue;
            choice.resolve(ctx);
            assert(run.gold <= 10, `${event.id}/${choice.label} pays no gold`);
            equal([run.xp, run.pendingLevels], [0, 0], `${event.id}/${choice.label} teaches nothing`);
          }
        });
      }
    }
  }],
];

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration drops and money: ${tests.length} checks passed.`);
