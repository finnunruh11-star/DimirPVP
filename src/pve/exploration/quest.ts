// The first days in Kerusai. A new traveller has five silver and a travel map.
// The keeper of the Kerusai Lodge has two jobs, a day apart: the dead in the marsh
// north-east of town, then Bogcap in the small wood past it. Both are done on foot:
// travel close on the map, then set out on foot there. Pure: no Phaser.

import type { Cell } from '../../world/pathfind';
import { mineEnemyLevel } from '../minerun';
import { addRunXp, partyXpScale } from './coop';
import { grantToParty, money, moneyLabel, roomPrice, type ShopResult } from './economy';
import type { EncounterSpawn, EncounterZone } from './encounters';
import type { SecretResult } from './locales';
import type { ExplorationRun } from './run';
import { shopById } from './shops';
import { placeById } from './world';

export const QUEST_TOWN = 'kerusai';
export const QUEST_LODGE = 'kerusai-guild';
/** While the quest runs, no roaming pack settles this close to Kerusai (world tiles). */
export const QUEST_CALM = 8;

export type QuestJobId = 'dead' | 'herbs';

export interface QuestJob {
  id: QuestJobId;
  title: string;
  /** What the keeper says when offering the job. */
  brief: string;
  /** The tracker line while the job is under way. */
  goal: string;
  tip: string;
  need: number;
  reward: { gold: number; xp: number };
  /** Where the work lies, for the tracker's heading. */
  site?: Cell;
  /** Days until the Lodge has the next job once this one is reported. */
  wait: number;
}

const DEAD_SITE: Cell = { x: 87, y: 42 };
const WOOD_SITE: Cell = { x: 91, y: 40 };
const BOGCAP_SITES: readonly Cell[] = [{ x: 89, y: 41 }, { x: 91, y: 39 }, { x: 93, y: 40 }];
const FORAGER_SITE: Cell = { x: 90, y: 40 };

export const QUEST_JOBS: readonly QuestJob[] = [
  {
    id: 'dead',
    title: 'The dead of the marsh',
    brief: 'Two zombies have walked out of the marsh north-east of Kerusai. Put them down.',
    goal: 'Put down the zombies in the marsh north-east of Kerusai.',
    tip: 'Travel close on the map, then Explore on foot. Number keys pick up to two words, R casts.',
    need: 1,
    reward: { gold: 4, xp: 4 },
    site: DEAD_SITE,
    wait: 1,
  },
  {
    id: 'herbs',
    title: 'Bogcap',
    brief: 'The apothecary wants Bogcap. Three patches grow in the small wood past the marsh. Find them. The Bogcap is yours to keep or sell.',
    goal: 'Find the Bogcap patches in the small wood past the marsh.',
    tip: 'Explore on foot there. C: sneak. F: melee ambush on foes that have not seen you. E: search a glint.',
    need: BOGCAP_SITES.length,
    reward: { gold: 5, xp: 5 },
    site: WOOD_SITE,
    wait: 0,
  },
];

export const QUEST_OVER = QUEST_JOBS.length;

export function questJob(run: ExplorationRun): QuestJob | null {
  return QUEST_JOBS[run.quest.job] ?? null;
}

export function questActive(run: ExplorationRun): boolean {
  return run.quest.job < QUEST_OVER;
}

/** The job is done and waits to be reported at the Lodge. */
export function questReady(run: ExplorationRun): boolean {
  const job = questJob(run);
  return !!job && run.quest.taken && run.quest.progress >= job.need;
}

/** The job `id` is taken and its work is still out in the world. */
export function questUnderway(run: ExplorationRun, id: QuestJobId): boolean {
  const job = questJob(run);
  return !!job && job.id === id && run.quest.taken && run.quest.progress < job.need;
}

function nextJob(run: ExplorationRun, wait: number): void {
  const quest = run.quest;
  quest.job += 1;
  quest.taken = false;
  quest.progress = 0;
  quest.opens = run.day + wait;
}

export function takeQuestJob(run: ExplorationRun): ShopResult {
  const job = questJob(run);
  if (!job || run.quest.taken) return { ok: false, message: 'No job on offer.' };
  if (run.day < run.quest.opens) return { ok: false, message: `The Lodge has work again on day ${run.quest.opens}.` };
  run.quest.taken = true;
  run.quest.progress = 0;
  return { ok: true, message: `Job taken: ${job.title}. ${job.goal}` };
}

export function reportQuestJob(run: ExplorationRun): ShopResult & { levels: number } {
  const job = questJob(run);
  if (!job || !questReady(run)) return { ok: false, message: 'Not done yet.', levels: 0 };
  run.gold = money(run.gold + job.reward.gold);
  const xp = Math.round(job.reward.xp * partyXpScale(run));
  const levels = addRunXp(run, xp);
  nextJob(run, job.wait);
  const next = questJob(run);
  const room = roomPrice(run, shopById(QUEST_LODGE));
  const after = !next ? ' The Lodge has no more work for you.'
    : run.quest.opens > run.day ? ` More work on day ${run.quest.opens}.${room ? ` Rooms here cost ${moneyLabel(room)}.` : ''}`
    : '';
  return {
    ok: true,
    message: `${job.title}: +${job.reward.gold}g, +${xp} XP.${levels ? ' Level up!' : ''}${after}`,
    levels,
  };
}

// -----------------------------------------------------------------------------
//  OUT IN THE WORLD
// -----------------------------------------------------------------------------

export interface QuestPackSpec {
  id: string;
  tile: Cell;
  spawns: EncounterSpawn[];
  label: string;
  zone: EncounterZone;
  sight: number;
}

export interface QuestCacheSpec {
  id: string;
  tile: Cell;
  label: string;
}

/** Foes the quest puts in the world today. */
export function questPackSpecs(run: ExplorationRun): QuestPackSpec[] {
  const packs: QuestPackSpec[] = [];
  if (questUnderway(run, 'dead')) {
    packs.push({
      id: 'quest:dead',
      tile: DEAD_SITE,
      spawns: [{ family: 'swamp', kind: 'zombie' }, { family: 'swamp', kind: 'zombie' }],
      label: '2 Zombies in the marsh.',
      zone: 'black',
      sight: 5,
    });
  }
  if (questUnderway(run, 'herbs') && run.groupsBeaten['quest:forager'] == null) {
    packs.push({
      id: 'quest:forager',
      tile: FORAGER_SITE,
      spawns: [{ family: 'mine', spec: { kind: 'kobold', level: mineEnemyLevel(1) } }],
      label: '1 Kobold in the wood.',
      zone: 'forest',
      sight: 5,
    });
  }
  return packs;
}

/** Things the quest hides in the world. */
export function questCacheSpecs(run: ExplorationRun): QuestCacheSpec[] {
  if (!questUnderway(run, 'herbs')) return [];
  return BOGCAP_SITES.map((tile, index) => ({ id: `quest:bogcap:${index}`, tile, label: 'Bogcap patch' }));
}

export function searchQuestCache(run: ExplorationRun): SecretResult {
  grantToParty(run, 'herbBogcap');
  const job = questJob(run);
  if (!job || !questUnderway(run, 'herbs')) return { message: 'Found 1 Bogcap.' };
  run.quest.progress += 1;
  const done = run.quest.progress >= job.need;
  return { message: `Found 1 Bogcap. Patches ${run.quest.progress}/${job.need}.${done ? ' Report to the Kerusai Lodge.' : ''}` };
}

/** A fight tagged `tag` was won. Returns a line for the party when it moved the quest on. */
export function questFightWon(run: ExplorationRun, tag: string | undefined): string | null {
  if (tag !== 'quest:dead' || !questUnderway(run, 'dead')) return null;
  run.quest.progress = 1;
  return 'The zombies are down. Report to the Kerusai Lodge.';
}

/** While the quest runs, the country round Kerusai holds no roaming packs. */
export function questCalm(run: ExplorationRun, tx: number, ty: number): boolean {
  const town = placeById(QUEST_TOWN);
  return !!town && questActive(run) && Math.max(Math.abs(tx - town.x), Math.abs(ty - town.y)) <= QUEST_CALM;
}

// -----------------------------------------------------------------------------
//  TRACKER
// -----------------------------------------------------------------------------

const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];

/** "  (6 tiles north-east)" from where the party stands, or nothing when it is there. */
function heading(run: ExplorationRun, to: Cell | undefined): string {
  if (!to) return '';
  const dx = to.x - run.pos.x;
  const dy = to.y - run.pos.y;
  const tiles = Math.round(Math.hypot(dx, dy));
  if (tiles < 1) return '';
  const octant = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
  return `  (${tiles} tile${tiles === 1 ? '' : 's'} ${COMPASS[octant]})`;
}

/** The quest panel: the job, what to do next and where. Empty once the quest is over. */
export function questLines(run: ExplorationRun): string[] {
  const job = questJob(run);
  if (!job) return [];
  const quest = run.quest;
  const head = `QUEST  ${job.title}`;
  const lodge = placeById(QUEST_TOWN);
  if (!quest.taken) {
    if (run.day < quest.opens) return [head, `The Lodge has work again on day ${quest.opens}.`];
    return [head, `See the keeper of the Kerusai Lodge.${heading(run, lodge)}`];
  }
  if (quest.progress >= job.need) return [head, `Report to the Kerusai Lodge.${heading(run, lodge)}`];
  return [head, `${job.goal} ${quest.progress}/${job.need}${heading(run, job.site)}`, job.tip];
}
