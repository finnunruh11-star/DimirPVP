// Guild bounties. Each guild posts three a day, seeded by the run, so the board
// is the same after a reload. Slay bounties count kills anywhere; gather
// bounties read the bag at hand-in; deliveries are claimed at the destination.

import { getItem, type ItemId } from '../../core/Items';
import { addRunXp, partyXpScale } from './coop';
import { creatureName, creaturePower } from './encounters';
import { money, moneyLabel, runDice, withParty, partyOf, type ShopResult } from './economy';
import type { ActiveBounty, ExplorationRun } from './run';
import { placeById } from './world';

export const MAX_ACTIVE_BOUNTIES = 4;
const BOARD_SIZE = 3;
/** No bounty pays more than this, in gold; the hardest pay it. */
export const BOUNTY_CAP = 2;
const BOUNTY_FLOOR = 0.2;
/** Gather bounties only ask for goods worth this much each at most. */
const GATHER_WORTH = 1.6;

const reward = (gold: number): number => Math.min(BOUNTY_CAP, Math.max(BOUNTY_FLOOR, money(gold)));

const TOWN_NAMES: Record<string, string> = {
  capitol: 'the Capitol',
  kerusai: 'Kerusai',
  hearthfire: 'Hearthfire',
  oakhaven: 'Oakhaven',
  pennybruck: 'Pennybruck',
  thassa: 'Thassa',
  nerogril: 'Nerogril',
  theocracy: 'the Theocracy',
};

// Each town posts what lives in its own country; where nothing lives yet, its robbers.
const SLAY_TARGETS: Record<string, string[]> = {
  capitol: ['bandit', 'bandit-archer', 'bandit-captain'],
  kerusai: ['zombie', 'skeleton', 'wisp', 'acidZombie', 'bandit'],
  hearthfire: ['sentinel', 'kobold', 'rockling', 'elite-kobold', 'magma-sentinel'],
  oakhaven: ['wolf', 'boar', 'rabbit', 'slime', 'bandit'],
  pennybruck: ['kobold', 'rockling', 'sentinel', 'bandit', 'elite-kobold'],
  thassa: ['bandit', 'bandit-archer', 'bandit-captain'],
  nerogril: ['bandit', 'bandit-archer', 'bandit-captain'],
  theocracy: ['bandit', 'bandit-archer', 'bandit-captain'],
};

const GATHER_TARGETS: Record<string, ItemId[]> = {
  capitol: ['crudeTrinket', 'herbMoonglow', 'gemAmethyst', 'batLeather'],
  kerusai: ['herbDeathweed', 'herbMoonglow', 'batLeather', 'gemOnyx'],
  hearthfire: ['sentinelLens', 'herbFireblossom', 'oreIron', 'gemRuby'],
  oakhaven: ['herbMoonglow', 'herbWaterleaf', 'gemEmerald', 'wolfPelt'],
  pennybruck: ['oreIron', 'oreCopper', 'gemRuby', 'herbFireblossom'],
  thassa: ['herbWaterleaf', 'gemSapphire', 'crudeTrinket', 'batLeather'],
  nerogril: ['herbFireblossom', 'gemSapphire', 'crudeTrinket', 'gemAmethyst'],
  theocracy: ['gemSapphire', 'herbFireblossom', 'redStone', 'gemAmethyst'],
};

const plural = (name: string, n: number): string => (n === 1 ? name : name.endsWith('s') ? name : `${name}s`);

/** Today's unclaimed offers on a town's board. */
export function bountyBoard(run: ExplorationRun, town: string): ActiveBounty[] {
  const slay = SLAY_TARGETS[town];
  const gather = GATHER_TARGETS[town];
  if (!slay || !gather) return [];
  const dice = runDice(run, `board:${town}`);
  const others = Object.keys(TOWN_NAMES).filter((id) => id !== town);
  const offers: ActiveBounty[] = [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    const id = `${town}:${run.day}:${i}`;
    const roll = dice.float();
    let bounty: ActiveBounty;
    if (roll < 0.5) {
      const target = dice.pick(slay);
      const count = 2 + dice.die(3);
      bounty = {
        id, town, kind: 'slay', target, count, progress: 0,
        rewardGold: reward(0.05 * count * creaturePower(target)), rewardXp: count * 2,
        label: `Slay ${count} ${plural(creatureName(target), count)}`,
      };
    } else if (roll < 0.8) {
      const cheap = gather.filter((item) => getItem(item).cost / 10 <= GATHER_WORTH);
      const target = dice.pick(cheap.length ? cheap : gather);
      const worth = getItem(target).cost / 10;
      const count = Math.max(1, Math.min(1 + dice.die(3), Math.floor(GATHER_WORTH / worth)));
      bounty = {
        id, town, kind: 'gather', target, count, progress: 0,
        rewardGold: reward(worth * count * 1.25), rewardXp: count * 2,
        label: `Bring ${count} ${getItem(target).name}`,
      };
    } else {
      const target = dice.pick(others);
      const from = placeById(town);
      const to = placeById(target);
      const tiles = from && to ? Math.hypot(from.x - to.x, from.y - to.y) : 20;
      bounty = {
        id, town, kind: 'deliver', target, count: 1, progress: 0,
        rewardGold: reward(0.5 + tiles / 40), rewardXp: 5,
        label: `Deliver a parcel to ${TOWN_NAMES[target]}`,
      };
    }
    if (!run.bountiesTaken.includes(id)) offers.push(bounty);
  }
  return offers;
}

export function acceptBounty(run: ExplorationRun, town: string, id: string): ShopResult {
  const offer = bountyBoard(run, town).find((entry) => entry.id === id);
  if (!offer) return { ok: false, message: 'That notice is gone.' };
  if (run.bounties.length >= MAX_ACTIVE_BOUNTIES) {
    return { ok: false, message: `At most ${MAX_ACTIVE_BOUNTIES} bounties at once.` };
  }
  run.bounties.push(offer);
  run.bountiesTaken.push(id);
  return { ok: true, message: `Accepted: ${offer.label}.` };
}

export function abandonBounty(run: ExplorationRun, id: string): ShopResult {
  const index = run.bounties.findIndex((entry) => entry.id === id);
  if (index < 0) return { ok: false, message: 'No such bounty.' };
  const [gone] = run.bounties.splice(index, 1);
  return { ok: true, message: `Abandoned: ${gone.label}.` };
}

/** Count a fight's kills against every open slay bounty. */
export function recordKills(run: ExplorationRun, kills: readonly string[]): string[] {
  const done: string[] = [];
  for (const bounty of run.bounties) {
    if (bounty.kind !== 'slay' || bounty.progress >= bounty.count) continue;
    const hits = kills.filter((kind) => kind === bounty.target).length;
    if (hits === 0) continue;
    bounty.progress = Math.min(bounty.count, bounty.progress + hits);
    if (bounty.progress >= bounty.count) done.push(bounty.label);
  }
  return done;
}

/** How far along a bounty is, reading every bag for gather bounties. */
export function bountyProgress(run: ExplorationRun, bounty: ActiveBounty): number {
  if (bounty.kind !== 'gather') return bounty.progress;
  const have = partyOf(run).reduce((sum, mage) => sum + mage.bag.filter((id) => id === bounty.target).length, 0);
  return Math.min(bounty.count, have);
}

export function canClaim(run: ExplorationRun, town: string, bounty: ActiveBounty): boolean {
  if (bounty.kind === 'deliver') return town === bounty.target;
  return town === bounty.town && bountyProgress(run, bounty) >= bounty.count;
}

export function claimBounty(run: ExplorationRun, town: string, id: string): ShopResult & { levels: number } {
  const bounty = run.bounties.find((entry) => entry.id === id);
  if (!bounty || !canClaim(run, town, bounty)) return { ok: false, message: 'Not finished yet.', levels: 0 };
  if (bounty.kind === 'gather') {
    withParty(run, (_leader, party) => {
      let owed = bounty.count;
      for (const mage of party) {
        for (let i = mage.bag.length - 1; i >= 0 && owed > 0; i--) {
          if (mage.bag[i] !== bounty.target) continue;
          mage.bag.splice(i, 1);
          owed -= 1;
        }
      }
    });
  }
  run.bounties.splice(run.bounties.indexOf(bounty), 1);
  run.gold = money(run.gold + bounty.rewardGold);
  const xp = Math.round(bounty.rewardXp * partyXpScale(run));
  const levels = addRunXp(run, xp);
  return {
    ok: true,
    message: `${bounty.label}: +${moneyLabel(bounty.rewardGold)}, +${xp} XP.${levels ? ` Level ${run.level}!` : ''}`,
    levels,
  };
}
