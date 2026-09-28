// Everything a player does to the run outside a fight, as data. The solo game
// and the host apply these directly; a guest sends them to the host, which
// checks and applies them. Pure: no Phaser.

import { MAGE_CLASSES, type MageClass } from '../../core/Classes';
import { asItemIds, type ItemId } from '../../core/Items';
import { abandonBounty, acceptBounty, claimBounty } from './bounties';
import { memberOf } from './coop';
import {
  buyItem,
  dropItem,
  equipItem,
  forge,
  giveItem,
  memberIn,
  moneyLabel,
  partyOf,
  rest,
  sellItem,
  unequipItem,
  type ShopResult,
} from './economy';
import { applyLevelChoice, parseLevelChoice, type LevelChoice } from './levels';
import { reportQuestJob, takeQuestJob } from './quest';
import type { ExplorationRun } from './run';

export type ExplorationIntent =
  | { op: 'buy'; shop: string; key: string }
  | { op: 'sell'; shop: string; item: ItemId }
  | { op: 'sell-all'; shop: string; items: ItemId[] }
  | { op: 'forge'; shop: string; recipe: string }
  | { op: 'rest'; shop: string }
  | { op: 'equip'; item: ItemId }
  | { op: 'unequip'; item: ItemId }
  | { op: 'drop'; item: ItemId }
  | { op: 'give'; item: ItemId; to: MageClass }
  | { op: 'bounty-accept'; town: string; id: string }
  | { op: 'bounty-abandon'; id: string }
  | { op: 'bounty-claim'; town: string; id: string }
  | { op: 'quest-take' }
  | { op: 'quest-report' }
  | { op: 'level'; choice: LevelChoice };

export type IntentOp = ExplorationIntent['op'];

export interface IntentResult extends ShopResult {
  /** Levels the party gained by it. */
  levels?: number;
}

/** Things done for the whole party at once; only the host decides them online. */
export const PARTY_INTENTS: ReadonlySet<IntentOp> = new Set<IntentOp>(['rest']);

/** Apply `intent` for `member` (null: the leader). Never throws. */
export function applyIntent(run: ExplorationRun, member: MageClass | null, intent: ExplorationIntent): IntentResult {
  if (member && !memberOf(partyOf(run), member)) return { ok: false, message: 'No such party member.' };
  try {
    switch (intent.op) {
      case 'buy': return buyItem(run, intent.shop, intent.key, member);
      case 'sell': return sellItem(run, intent.shop, intent.item, false, member);
      case 'sell-all': return sellAll(run, intent.shop, intent.items, member);
      case 'forge': return forge(run, intent.shop, intent.recipe, member);
      case 'rest': return rest(run, intent.shop);
      case 'equip': return equipItem(run, intent.item, member);
      case 'unequip': return unequipItem(run, intent.item, member);
      case 'drop': return dropItem(run, intent.item, member);
      case 'give': return member ? giveItem(run, intent.item, member, intent.to) : { ok: false, message: 'Nobody to give it to.' };
      case 'bounty-accept': return acceptBounty(run, intent.town, intent.id);
      case 'bounty-abandon': return abandonBounty(run, intent.id);
      case 'bounty-claim': return claimBounty(run, intent.town, intent.id);
      case 'quest-take': return takeQuestJob(run);
      case 'quest-report': return reportQuestJob(run);
      case 'level': {
        const who = member ?? memberIn(run)?.mageClass;
        return who ? applyLevelChoice(run, who, intent.choice) : { ok: false, message: 'No such party member.' };
      }
    }
  } catch {
    return { ok: false, message: 'That cannot be done now.' };
  }
}

function sellAll(run: ExplorationRun, shop: string, items: readonly ItemId[], member: MageClass | null): IntentResult {
  let gold = 0;
  for (const id of new Set(items)) {
    const before = run.gold;
    if (sellItem(run, shop, id, true, member).ok) gold += run.gold - before;
  }
  gold = Math.round(gold * 10) / 10;
  return { ok: gold > 0, message: gold > 0 ? `Sold the lot for ${moneyLabel(gold)}.` : 'Nothing sold.' };
}

const text = (value: unknown, max = 64): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;

const itemId = (value: unknown): ItemId | null => asItemIds([value])[0] ?? null;

const mageClass = (value: unknown): MageClass | null =>
  MAGE_CLASSES.includes(value as MageClass) ? value as MageClass : null;

/** Read an intent that came over the wire. Anything malformed is null. */
export function parseIntent(value: unknown): ExplorationIntent | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  switch (raw.op) {
    case 'buy': {
      const shop = text(raw.shop);
      const key = text(raw.key, 96);
      return shop && key ? { op: 'buy', shop, key } : null;
    }
    case 'sell': {
      const shop = text(raw.shop);
      const item = itemId(raw.item);
      return shop && item ? { op: 'sell', shop, item } : null;
    }
    case 'sell-all': {
      const shop = text(raw.shop);
      const items = Array.isArray(raw.items) ? raw.items.slice(0, 64).map(itemId) : null;
      return shop && items && items.every((id): id is ItemId => !!id) ? { op: 'sell-all', shop, items: items as ItemId[] } : null;
    }
    case 'forge': {
      const shop = text(raw.shop);
      const recipe = text(raw.recipe);
      return shop && recipe ? { op: 'forge', shop, recipe } : null;
    }
    case 'rest': {
      const shop = text(raw.shop);
      return shop ? { op: 'rest', shop } : null;
    }
    case 'equip':
    case 'unequip':
    case 'drop': {
      const item = itemId(raw.item);
      return item ? { op: raw.op, item } : null;
    }
    case 'give': {
      const item = itemId(raw.item);
      const to = mageClass(raw.to);
      return item && to ? { op: 'give', item, to } : null;
    }
    case 'bounty-accept':
    case 'bounty-claim': {
      const town = text(raw.town);
      const id = text(raw.id, 96);
      return town && id ? { op: raw.op, town, id } : null;
    }
    case 'bounty-abandon': {
      const id = text(raw.id, 96);
      return id ? { op: 'bounty-abandon', id } : null;
    }
    case 'quest-take':
    case 'quest-report':
      return { op: raw.op };
    case 'level': {
      const choice = parseLevelChoice(raw.choice);
      return choice ? { op: 'level', choice } : null;
    }
    default:
      return null;
  }
}

/** How the windows outside a fight act on the run. */
export interface ExplorationActions {
  /** Whose pack and purse-hand the window works with; null means the leader. */
  readonly member: MageClass | null;
  /** This player may do things for the whole party (rest at an inn). */
  readonly leads: boolean;
  apply(intent: ExplorationIntent): Promise<IntentResult>;
}

/** Apply straight to the run: the solo game, and the host acting for itself. */
export function localActions(run: ExplorationRun, member: MageClass | null = null): ExplorationActions {
  return { member, leads: true, apply: (intent) => Promise.resolve(applyIntent(run, member, intent)) };
}
