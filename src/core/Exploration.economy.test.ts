import { Dice } from '../core/Dice';
import { getItem } from '../core/Items';
import { Mage } from '../core/Mage';
import {
  acceptBounty,
  bountyBoard,
  canClaim,
  claimBounty,
  MAX_ACTIVE_BOUNTIES,
  recordKills,
} from '../pve/exploration/bounties';
import {
  buyItem,
  partyOf,
  rest,
  sellItem,
  sellOffers,
  shopStock,
  withParty,
} from '../pve/exploration/economy';
import { encounterCap, rollEncounter, ZONE_ROSTERS, type EncounterZone } from '../pve/exploration/encounters';
import { stage } from '../pve/exploration/eventKit';
import { ROAD_EVENTS, variantsFor } from '../pve/exploration/events';
import { capturePartySnapshot } from '../pve/exploration/party';
import { createRun, type ExplorationRun } from '../pve/exploration/run';
import { parseRun } from '../pve/exploration/save';
import { shopById, SHOPS } from '../pve/exploration/shops';
import { addXp, killXp, levelCoreStatGain, levelReward, rackIsFull, xpToNext } from '../pve/progression';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}: expected ${e}, received ${a}`);
}

function traveller(): Mage {
  const m = new Mage({
    name: 'Traveller',
    isAI: false,
    team: 1,
    position: { x: 200, y: 200 },
    loadout: ['shadow', 'mind', 'pierce', 'subtle'],
  });
  m.assignFlatStats(3);
  return m;
}

function freshRun(seed = 11, gold = 0): ExplorationRun {
  const run = createRun(seed, capturePartySnapshot([traveller()]));
  run.gold = gold;
  return run;
}

const ZONES: EncounterZone[] = ['capitol', 'black', 'red', 'forest', 'wilds'];

const tests: [name: string, run: () => void][] = [
  ['levels follow the level curve', () => {
    equal(xpToNext(1), 10, 'level 1 needs 10 XP');
    equal(xpToNext(2), 17, 'level 2 needs 17 XP');
    equal(levelReward(2), { stats: 1, statGain: 1, word: true }, 'even levels offer one point and teach a word');
    equal(levelReward(3), { stats: 0, statGain: 1, word: false }, 'odd levels have no stat choice');
    equal(levelReward(5), { stats: 0, statGain: 1, word: true }, 'every fifth level also teaches a word');
    equal([2, 3, 4, 5, 6, 7].map(levelCoreStatGain), [1, 0, 1, 0, 0, 1], 'rounded cumulative 0.4 growth');
    const track = { level: 1, xp: 0, pendingLevels: 0 };
    equal(addXp(track, 30), 2, 'a big payout can roll two levels');
    equal(track, { level: 3, xp: 3, pendingLevels: 2 }, 'leftover XP carries');
  }],

  ['pays XP by creature, a zombie being 1, and nothing for a boss\'s retinue', () => {
    equal([killXp('zombie'), killXp('wisp'), killXp('wolf'), killXp('boar'), killXp('lion')], [1, 2, 3, 5, 8], 'the low table');
    equal([killXp('ghast'), killXp('oni'), killXp('lich'), killXp('reaper'), killXp('deathknightSpear')], [10, 15, 20, 33, 66], 'the high table');
    equal([killXp('baralDrake'), killXp('denialArtifact'), killXp(undefined)], [0, 0, 0], 'adds and unknowns give nothing');
  }],

  ['a full rack counts base words, not the modifier', () => {
    assert(!rackIsFull(['shadow', 'mind', 'pierce', 'veil', 'subtle']), 'four words and a modifier still have room');
    assert(rackIsFull(['shadow', 'mind', 'pierce', 'veil', 'bind', 'subtle']), 'five base words fill the rack');
  }],

  ['every zone always fields a legal, capped roster', () => {
    for (const zone of ZONES) {
      for (const kind of ['monsters', 'robbery'] as const) {
        for (let depth = 1; depth <= 14; depth++) {
          for (let seed = 1; seed <= 12; seed++) {
            const spawns = rollEncounter(zone, kind, depth, new Dice(seed * 97 + depth));
            assert(spawns.length >= 1, `${zone}/${kind}/${depth} fields someone`);
            const eliteRoom = depth % 5 === 0 && kind === 'monsters' ? 1 : 0;
            assert(
              spawns.length <= Math.max(1, encounterCap(depth)) + eliteRoom + 2,
              `${zone}/${kind}/${depth} stays near its cap (${spawns.length})`,
            );
          }
        }
      }
    }
  }],

  ['the first stretch of road only fields depth-1 creatures', () => {
    const early = new Set(ZONE_ROSTERS.forest.monsters.filter((e) => e.unlock <= 1).map((e) => e.kind));
    for (let seed = 1; seed <= 40; seed++) {
      for (const spawn of rollEncounter('forest', 'monsters', 1, new Dice(seed))) {
        const kind = spawn.family === 'swamp' ? spawn.kind : spawn.spec.kind;
        assert(early.has(kind), `depth 1 fielded ${kind}`);
      }
    }
    for (const spawn of rollEncounter('capitol', 'robbery', 1, new Dice(3))) {
      assert(spawn.family === 'mine' && spawn.spec.kind.startsWith('bandit'), 'robbers are bandits');
    }
  }],

  ['a shelf is the same all day and restocks after a rest', () => {
    const run = freshRun(42, 100);
    const shop = shopById('capitol-weaponsmith');
    assert(shop, 'the weaponsmith exists');
    const today = shopStock(run, shop).map((slot) => slot.id);
    equal(shopStock(run, shop).map((slot) => slot.id), today, 'same day, same shelf');
    run.hour = 20;
    rest(run, 'capitol-guild');
    equal(run.day, 2, 'a night from the evening ends on a new day');
    const rolled = shopStock(run, shop).filter((slot) => !slot.fixed).map((slot) => slot.key);
    assert(rolled.every((key) => key.includes(':2:')), 'the rolled stock belongs to the new day');
  }],

  ['buying pays, hands the item over, and sells the slot out', () => {
    const run = freshRun(7, 200);
    const shop = shopById('capitol-weaponsmith')!;
    const slot = shopStock(run, shop).find((entry) => !entry.fixed && getItem(entry.id).weight <= 4)!;
    assert(slot, 'a liftable weapon is on the shelf');
    const before = run.gold;
    const result = buyItem(run, shop.id, slot.key);
    assert(result.ok, `purchase went through: ${result.message}`);
    equal(run.gold, before - slot.price, 'the price was paid');
    const leader = partyOf(run)[0];
    assert(
      leader.bag.includes(slot.id) || leader.hands.includes(slot.id),
      'the item is carried',
    );
    assert(shopStock(run, shop).find((entry) => entry.key === slot.key)?.sold, 'the slot is sold out');
    assert(!buyItem(run, shop.id, slot.key).ok, 'a sold slot cannot be bought twice');
  }],

  ['a purse too light buys nothing', () => {
    const run = freshRun(7, 0);
    const shop = shopById('capitol-apothecary')!;
    const slot = shopStock(run, shop)[0];
    assert(!buyItem(run, shop.id, slot.key).ok, 'no gold, no sale');
    equal(run.gold, 0, 'nothing was charged');
  }],

  ['the guild pays full worth for materials and ignores gear', () => {
    const run = freshRun(3, 0);
    withParty(run, (leader) => leader.bag.push('oreIron', 'oreIron', 'travellersDagger'));
    const guild = shopById('capitol-guild')!;
    const offers = sellOffers(run, guild);
    equal(offers.map((offer) => offer.id), ['oreIron'], 'only the ore is wanted');
    const result = sellItem(run, guild.id, 'oreIron', true);
    assert(result.ok, 'the ore sold');
    equal(run.gold, (getItem('oreIron').cost / 10) * 2, 'two ores at full worth');
    equal(partyOf(run)[0].bag.filter((id) => id === 'oreIron').length, 0, 'the ore is gone');
  }],

  ['resting restores 75% and costs the room', () => {
    const run = freshRun(5, 10);
    withParty(run, (leader) => {
      leader.hp = 1;
    });
    const max = partyOf(run)[0].maxHp;
    const result = rest(run, 'capitol-guild');
    assert(result.ok, 'rested');
    equal(run.gold, 10 - shopById('capitol-guild')!.restPrice!, 'the room was paid for');
    const hp = partyOf(run)[0].hp;
    assert(hp >= Math.min(max, 1 + Math.floor(max * 0.75)), `rest healed (${hp}/${max})`);
    assert(!rest(freshRun(5, 0), 'capitol-guild').ok, 'no gold, no bed');
  }],

  ['every registered shop has a door-ready definition', () => {
    for (const shop of Object.values(SHOPS)) {
      assert(shop.buys.length > 0 || shop.services.length > 0 || shop.stock, `${shop.id} does something`);
      if (shop.stock) assert(shopStock(freshRun(), shop).length > 0, `${shop.id} has something on the shelf`);
    }
  }],

  ['bounties post, count kills and pay out', () => {
    const run = freshRun(21, 0);
    const board = bountyBoard(run, 'capitol');
    assert(board.length > 0 && board.length <= 3, 'the board has notices');
    equal(bountyBoard(run, 'capitol'), board, 'the board is stable within a day');
    const slay = board.find((b) => b.kind === 'slay') ?? board[0];
    assert(acceptBounty(run, 'capitol', slay.id).ok, 'accepted');
    assert(!bountyBoard(run, 'capitol').some((b) => b.id === slay.id), 'a taken notice leaves the board');
    if (slay.kind === 'slay') {
      recordKills(run, Array.from({ length: slay.count }, () => slay.target));
      assert(canClaim(run, 'capitol', run.bounties[0]), 'enough kills to claim');
      const claim = claimBounty(run, 'capitol', slay.id);
      assert(claim.ok, 'claimed');
      equal(run.gold, slay.rewardGold, 'the reward was paid');
      equal(run.bounties.length, 0, 'the bounty is closed');
    }
  }],

  ['gather bounties take the goods; deliveries pay only at the destination', () => {
    const run = freshRun(4, 0);
    run.bounties.push(
      { id: 'g', town: 'capitol', kind: 'gather', target: 'herbMoonglow', count: 2, progress: 0, rewardGold: 5, rewardXp: 4, label: 'g' },
      { id: 'd', town: 'capitol', kind: 'deliver', target: 'kerusai', count: 1, progress: 0, rewardGold: 9, rewardXp: 5, label: 'd' },
    );
    assert(!canClaim(run, 'capitol', run.bounties[0]), 'no herbs yet');
    withParty(run, (leader) => leader.bag.push('herbMoonglow', 'herbMoonglow', 'herbMoonglow'));
    assert(claimBounty(run, 'capitol', 'g').ok, 'herbs handed in');
    equal(partyOf(run)[0].bag.filter((id) => id === 'herbMoonglow').length, 1, 'exactly two were taken');
    assert(!claimBounty(run, 'capitol', 'd').ok, 'a parcel is not claimed at home');
    assert(claimBounty(run, 'kerusai', 'd').ok, 'a parcel is claimed where it is going');
    equal(run.gold, 14, 'both rewards paid');
  }],

  ['the bounty ledger has a ceiling', () => {
    const run = freshRun(8, 0);
    for (let day = 1; run.bounties.length < MAX_ACTIVE_BOUNTIES && day < 20; day++) {
      run.day = day;
      for (const offer of bountyBoard(run, 'capitol')) acceptBounty(run, 'capitol', offer.id);
    }
    equal(run.bounties.length, MAX_ACTIVE_BOUNTIES, 'filled to the ceiling');
    run.day = 99;
    const extra = bountyBoard(run, 'capitol')[0];
    assert(!acceptBounty(run, 'capitol', extra.id).ok, 'one more is refused');
  }],

  ['every road event resolves every choice in every zone', () => {
    for (const event of ROAD_EVENTS) {
      for (const zone of event.zones ?? ZONES) {
        for (const variant of variantsFor(event, zone)) variant.choices.forEach((_, index) => {
          for (let seed = 1; seed <= 6; seed++) {
            const run = freshRun(seed, 20);
            withParty(run, (leader) => leader.utility.push('healthPotion'));
            const choice = stage(event, variant, new Dice(seed)).choices[index];
            const ctx = { run, zone, depth: 2, dice: new Dice(seed * 31 + index) };
            if (choice.available && !choice.available(ctx)) continue;
            const outcome = choice.resolve(ctx);
            assert(outcome.message.length > 0, `${event.id}/${choice.label} says something`);
            assert(run.gold >= 0, `${event.id}/${choice.label} never goes into debt`);
            assert(partyOf(run)[0].hp >= 1, `${event.id}/${choice.label} never kills`);
          }
        });
      }
    }
  }],

  ['a version 1 save upgrades; a broken one is refused', () => {
    const v1 = JSON.parse(JSON.stringify(freshRun(13, 6))) as Record<string, unknown>;
    v1.version = 1;
    v1.nodeId = 'capitol';
    for (const key of ['level', 'xp', 'day', 'bounties', 'forest', 'locale', 'lastTown', 'pos', 'hour', 'explored', 'searched']) delete v1[key];
    const upgraded = parseRun(JSON.stringify(v1));
    assert(upgraded, 'the old save loads');
    equal([upgraded.level, upgraded.xp, upgraded.day, upgraded.lastTown], [1, 0, 1, 'capitol'], 'defaults filled');
    equal(upgraded.gold, 6, 'gold carried over');
    assert(!parseRun(JSON.stringify({ ...v1, nodeId: 'atlantis' })), 'an unknown place is refused');
    assert(!parseRun('{not json'), 'garbage is refused');
  }],
];

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration economy: ${tests.length} checks passed.`);
