// Everything a player does to the run outside a fight, as data. The solo game
// and the host apply these directly; a guest sends them to the host, which
// checks and applies them. Pure: no Phaser.

import { MAGE_CLASSES, type MageClass } from '../../core/Classes';
import { CRAFT_TEMPLATE_IDS, MAX_CRAFT_MANA, type CraftForm, type CraftTemplateId } from '../../core/crafting/data';
import type { CraftDesign } from '../../core/crafting/item';
import { FULL_GRID, PAPERS, RUNE_ORDER, type RuneId } from '../../core/hexcraft/runes';
import { asItemIds, type ItemId } from '../../core/Items';
import { abandonBounty, acceptBounty, claimBounty } from './bounties';
import { enterLodge, takeStarterWeapon } from './arms';
import { memberOf } from './coop';
import {
  buyItem,
  craftItem,
  drawHex,
  dropItem,
  equipItem,
  giveItem,
  learnMoonshard,
  learnRune,
  memberIn,
  moneyLabel,
  partyOf,
  rest,
  sellItem,
  unequipItem,
  type ShopResult,
} from './economy';
import { applyLevelChoice, parseLevelChoice, type LevelChoice } from './levels';
import type { ExplorationRun } from './run';

export type ExplorationIntent =
  | { op: 'buy'; shop: string; key: string }
  | { op: 'sell'; shop: string; item: ItemId; count?: number }
  | { op: 'sell-all'; shop: string; items: ItemId[] }
  | { op: 'craft'; shop: string; design: CraftDesign; crafter?: MageClass }
  | { op: 'hex'; paper: ItemId; grids: number[] }
  | { op: 'hex-rune'; shop: string; rune: RuneId }
  | { op: 'learn-shard'; item: ItemId; replace?: number }
  | { op: 'rest'; shop: string }
  | { op: 'equip'; item: ItemId }
  | { op: 'unequip'; item: ItemId }
  | { op: 'drop'; item: ItemId; count?: number }
  | { op: 'give'; item: ItemId; to: MageClass; count?: number }
  | { op: 'bounty-accept'; town: string; id: string }
  | { op: 'bounty-abandon'; id: string }
  | { op: 'bounty-claim'; town: string; id: string }
  | { op: 'arm'; weapon: ItemId }
  | { op: 'lodge' }
  | { op: 'level'; choice: LevelChoice };

export type IntentOp = ExplorationIntent['op'];

export interface IntentResult extends ShopResult {
  /** Levels the party gained by it. */
  levels?: number;
  /** What a craft made. */
  item?: ItemId;
}

/** Things done for the whole party at once; only the host decides them online. */
export const PARTY_INTENTS: ReadonlySet<IntentOp> = new Set<IntentOp>(['rest']);

/** Apply `intent` for `member` (null: the leader). Never throws. */
export function applyIntent(run: ExplorationRun, member: MageClass | null, intent: ExplorationIntent): IntentResult {
  if (member && !memberOf(partyOf(run), member)) return { ok: false, message: 'No such party member.' };
  try {
    switch (intent.op) {
      case 'buy': return buyItem(run, intent.shop, intent.key, member);
      case 'sell': return sellItem(run, intent.shop, intent.item, intent.count ?? false, member);
      case 'sell-all': return sellAll(run, intent.shop, intent.items, member);
      case 'craft': return craftItem(run, intent.shop, intent.design, member, intent.crafter);
      case 'hex': return drawHex(run, intent.paper, intent.grids, member);
      case 'hex-rune': return learnRune(run, intent.shop, intent.rune);
      case 'learn-shard': return learnMoonshard(run, intent.item, member, intent.replace);
      case 'rest': return rest(run, intent.shop);
      case 'equip': return equipItem(run, intent.item, member);
      case 'unequip': return unequipItem(run, intent.item, member);
      case 'drop': return dropItem(run, intent.item, member, intent.count ?? 1);
      case 'give': return member ? giveItem(run, intent.item, member, intent.to, intent.count ?? 1) : { ok: false, message: 'Nobody to give it to.' };
      case 'bounty-accept': return acceptBounty(run, intent.town, intent.id);
      case 'bounty-abandon': return abandonBounty(run, intent.id);
      case 'bounty-claim': return claimBounty(run, intent.town, intent.id);
      case 'arm': return takeStarterWeapon(run, member, intent.weapon);
      case 'lodge': return enterLodge(run, member);
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

/** An optional amount off the wire: absent, or a whole number 1..999. False when malformed. */
const countOf = (value: unknown): { count?: number } | false =>
  value == null ? {} : Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 999 ? { count: value as number } : false;

const mageClass = (value: unknown): MageClass | null =>
  MAGE_CLASSES.includes(value as MageClass) ? value as MageClass : null;

/** A bench design off the wire: its shape only; the bench itself judges the materials. */
function parseDesign(value: unknown): CraftDesign | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const template = CRAFT_TEMPLATE_IDS.find((id) => id === raw.template) as CraftTemplateId | undefined;
  const ids = (list: unknown): ItemId[] | null => {
    if (!Array.isArray(list) || list.length > 4) return null;
    const valid = asItemIds(list);
    return valid.length === list.length ? valid : null;
  };
  const parts = ids(raw.parts);
  const sockets = ids(raw.sockets);
  const mana = raw.mana;
  if (!template || typeof raw.form !== 'string' || raw.form.length > 16 || !parts || !sockets) return null;
  if (typeof mana !== 'number' || !Number.isInteger(mana) || mana < 0 || mana > MAX_CRAFT_MANA) return null;
  return { template, form: raw.form as CraftForm, parts, sockets, mana };
}

/** A drawn sheet off the wire: grid masks only; the paper decides how many. */
function parseGrids(value: unknown): number[] | null {
  const most = Math.max(...Object.values(PAPERS).map((paper) => paper.grids));
  if (!Array.isArray(value) || value.length === 0 || value.length > most) return null;
  return value.every((mask) => Number.isInteger(mask) && mask >= 0 && mask <= FULL_GRID) ? (value as number[]) : null;
}

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
      const count = countOf(raw.count);
      return shop && item && count ? { op: 'sell', shop, item, ...count } : null;
    }
    case 'sell-all': {
      const shop = text(raw.shop);
      const items = Array.isArray(raw.items) ? raw.items.slice(0, 64).map(itemId) : null;
      return shop && items && items.every((id): id is ItemId => !!id) ? { op: 'sell-all', shop, items: items as ItemId[] } : null;
    }
    case 'craft': {
      const shop = text(raw.shop);
      const design = parseDesign(raw.design);
      const crafter = raw.crafter == null ? undefined : mageClass(raw.crafter) ?? null;
      return shop && design && crafter !== null ? { op: 'craft', shop, design, crafter } : null;
    }
    case 'hex': {
      const paper = itemId(raw.paper);
      const grids = parseGrids(raw.grids);
      return paper && grids ? { op: 'hex', paper, grids: [...grids] } : null;
    }
    case 'hex-rune': {
      const shop = text(raw.shop);
      const rune = RUNE_ORDER.find((id) => id === raw.rune);
      return shop && rune ? { op: 'hex-rune', shop, rune } : null;
    }
    case 'learn-shard': {
      const item = itemId(raw.item);
      const replace = raw.replace;
      if (!item || (replace != null && (typeof replace !== 'number' || !Number.isInteger(replace) || replace < 0 || replace > 99))) return null;
      return { op: 'learn-shard', item, ...(replace != null ? { replace: replace as number } : {}) };
    }
    case 'rest': {
      const shop = text(raw.shop);
      return shop ? { op: 'rest', shop } : null;
    }
    case 'equip':
    case 'unequip': {
      const item = itemId(raw.item);
      return item ? { op: raw.op, item } : null;
    }
    case 'drop': {
      const item = itemId(raw.item);
      const count = countOf(raw.count);
      return item && count ? { op: 'drop', item, ...count } : null;
    }
    case 'give': {
      const item = itemId(raw.item);
      const to = mageClass(raw.to);
      const count = countOf(raw.count);
      return item && to && count ? { op: 'give', item, to, ...count } : null;
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
    case 'lodge':
      return { op: raw.op };
    case 'arm': {
      const weapon = itemId(raw.weapon);
      return weapon ? { op: 'arm', weapon } : null;
    }
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
