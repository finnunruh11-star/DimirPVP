// Money, stock and gear for Exploration towns. Every function here takes the run
// and mutates it through the party snapshot, so a save always reflects the shop
// counter. Seeded from the run: the same day in the same shop shows the same shelf.

import { Dice } from '../../core/Dice';
import { getItem, type ItemDef, type ItemId, type Rarity } from '../../core/Items';
import type { Mage } from '../../core/Mage';
import { sleepUntilMorning } from './clock';
import { capturePartySnapshot, restoreParty } from './party';
import type { ExplorationRun } from './run';
import { FORGE_RECIPES, shopById, stockCandidates, type ShopDef } from './shops';

export interface ShopResult {
  ok: boolean;
  message: string;
}

const RARITY_GOLD: Record<Rarity, number> = {
  consumeable: 1,
  common: 2,
  rare: 4,
  epic: 6,
  unreal: 10,
  mythical: 14,
  legendary: 18,
  lareneg: 24,
};

/** A sum of money kept to the silver (a tenth of a gold). */
export const money = (value: number): number => Math.round(value * 10) / 10;
/** A computed price, rounded down to the silver. */
const silverDown = (value: number): number => Math.floor(value * 10 + 1e-6) / 10;

/** A purse as it reads: "8g", "3g 5s", "5s". Ten silver to the gold. */
export function moneyLabel(gold: number): string {
  const silver = Math.max(0, Math.round(gold * 10));
  const g = Math.floor(silver / 10);
  const s = silver % 10;
  if (g && s) return `${g}g ${s}s`;
  return s ? `${s}s` : `${g}g`;
}

/** What an item is worth, in gold, before any shop's cut. */
export function itemWorth(def: ItemDef): number {
  return def.cost > 0 ? def.cost / 10 : RARITY_GOLD[def.rarity] * 2.5;
}

export function buyPrice(def: ItemDef, mult = 1, qty = 1): number {
  return Math.max(1, Math.ceil(itemWorth(def) * qty * 1.25 * mult));
}

export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Dice for one named purpose on one day of a run. */
export function runDice(run: ExplorationRun, purpose: string): Dice {
  return new Dice((hashString(purpose) ^ Math.imul(run.seed, 0x9e3779b1) ^ Math.imul(run.day, 0x85ebca6b)) >>> 0);
}

/** Restore the party, let `fn` change it, and store the result back on the run. */
export function withParty<T>(run: ExplorationRun, fn: (leader: Mage, party: Mage[]) => T): T {
  const party = restoreParty(run.party);
  const result = fn(party[0], party);
  run.party = capturePartySnapshot(party);
  return result;
}

export function partyOf(run: ExplorationRun): Mage[] {
  return restoreParty(run.party);
}

// -----------------------------------------------------------------------------
//  STOCK
// -----------------------------------------------------------------------------

export interface StockSlot {
  key: string;
  id: ItemId;
  qty: number;
  price: number;
  fixed: boolean;
  sold: boolean;
}

export function shopStock(run: ExplorationRun, shop: ShopDef): StockSlot[] {
  const rule = shop.stock;
  if (!rule) return [];
  const mult = rule.priceMult ?? 1;
  const slots: StockSlot[] = (rule.fixed ?? []).map(({ id, qty = 1 }) => ({
    key: `f:${id}`,
    id,
    qty,
    price: buyPrice(getItem(id), mult, qty),
    fixed: true,
    sold: false,
  }));
  const pool = stockCandidates(rule).filter((def) => !slots.some((slot) => slot.id === def.id));
  const dice = runDice(run, `stock:${shop.id}`);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(dice.float() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  pool.slice(0, rule.size ?? 0).forEach((def, index) => {
    const key = `${shop.id}:${run.day}:${index}`;
    slots.push({
      key,
      id: def.id,
      qty: 1,
      price: buyPrice(def, mult),
      fixed: false,
      sold: run.purchases.includes(key),
    });
  });
  return slots;
}

/** Put an item on a mage the way a merchant hands it over: worn if the slot is free. */
export function grantToMage(mage: Mage, id: ItemId): void {
  const def = getItem(id);
  if (def.ammo) {
    mage.arrows += 1;
    return;
  }
  if (def.slot === 'utility') {
    if (def.material) mage.bag.push(id);
    else mage.utility.push(id);
  } else {
    mage.bag.push(id);
    const handsEmpty = def.slot === 'hand' && mage.hands.length === 0;
    if ((def.slot !== 'hand' || handsEmpty) && mage.canEquipFromBag(id)) {
      const worn = def.slot === 'head' ? mage.head : def.slot === 'torso' ? mage.torso : def.slot === 'boots' ? mage.boots : null;
      if (!worn) mage.equipFromBag(id);
    }
  }
  if (def.hpMult != null) mage.maxHp = Math.max(1, Math.round(mage.maxHp * def.hpMult));
  if (def.hpFlat != null) mage.maxHp = Math.max(1, mage.maxHp + def.hpFlat);
  if (def.sanityMult != null) mage.maxSanity = Math.max(1, Math.round(mage.maxSanity * def.sanityMult));
  mage.hp = Math.min(mage.hp, mage.maxHp);
  mage.sanity = Math.min(mage.sanity, mage.maxSanity);
}

export function buyItem(run: ExplorationRun, shopId: string, key: string): ShopResult {
  const shop = shopById(shopId);
  if (!shop) return { ok: false, message: 'No such shop.' };
  const slot = shopStock(run, shop).find((entry) => entry.key === key);
  if (!slot) return { ok: false, message: 'Not in stock.' };
  if (slot.sold) return { ok: false, message: 'Sold out until tomorrow.' };
  if (run.gold < slot.price) return { ok: false, message: `Costs ${moneyLabel(slot.price)}.` };
  const def = getItem(slot.id);
  return withParty(run, (leader) => {
    if (!leader.canCarry(def.weight * slot.qty)) return { ok: false, message: 'Too heavy to carry.' };
    for (let i = 0; i < slot.qty; i++) grantToMage(leader, slot.id);
    run.gold = money(run.gold - slot.price);
    if (!slot.fixed) run.purchases.push(slot.key);
    return { ok: true, message: `Bought ${slot.qty > 1 ? `${slot.qty}x ` : ''}${def.name} for ${moneyLabel(slot.price)}.` };
  });
}

// -----------------------------------------------------------------------------
//  SELLING
// -----------------------------------------------------------------------------

export interface SellOffer {
  id: ItemId;
  name: string;
  count: number;
  unit: number;
}

function buyRate(shop: ShopDef, def: ItemDef): number {
  return shop.buys.find((rule) => rule.accepts(def))?.rate ?? 0;
}

export function sellPrice(shop: ShopDef, def: ItemDef): number {
  return silverDown(itemWorth(def) * buyRate(shop, def));
}

/** Unequipped goods the shop will take, one row per item id. */
export function sellOffers(run: ExplorationRun, shop: ShopDef): SellOffer[] {
  const leader = partyOf(run)[0];
  if (!leader) return [];
  const counts = new Map<ItemId, number>();
  for (const id of [...leader.bag, ...leader.utility]) counts.set(id, (counts.get(id) ?? 0) + 1);
  const offers: SellOffer[] = [];
  for (const [id, count] of counts) {
    const def = getItem(id);
    if (def.permanentlyBinding) continue;
    const unit = sellPrice(shop, def);
    if (unit > 0) offers.push({ id, name: def.name, count, unit });
  }
  return offers.sort((a, b) => b.unit * b.count - a.unit * a.count);
}

export function sellItem(run: ExplorationRun, shopId: string, id: ItemId, all: boolean): ShopResult {
  const shop = shopById(shopId);
  if (!shop) return { ok: false, message: 'No such shop.' };
  const def = getItem(id);
  const unit = sellPrice(shop, def);
  if (unit <= 0) return { ok: false, message: 'Not bought here.' };
  return withParty(run, (leader) => {
    let sold = 0;
    for (const list of [leader.bag, leader.utility]) {
      for (let i = list.length - 1; i >= 0 && (all || sold === 0); i--) {
        if (list[i] !== id) continue;
        list.splice(i, 1);
        sold += 1;
      }
    }
    if (sold === 0) return { ok: false, message: 'You have none.' };
    const gold = money(unit * sold);
    run.gold = money(run.gold + gold);
    return { ok: true, message: `Sold ${sold > 1 ? `${sold}x ` : ''}${def.name} for ${moneyLabel(gold)}.` };
  });
}

// -----------------------------------------------------------------------------
//  SERVICES
// -----------------------------------------------------------------------------

/** A room for the night: 75% of everything back, and wake at seven on the next day. */
export function rest(run: ExplorationRun, shopId: string): ShopResult {
  const shop = shopById(shopId);
  const price = shop?.restPrice;
  if (!shop || price == null) return { ok: false, message: 'No beds here.' };
  if (run.gold < price) return { ok: false, message: `A room costs ${moneyLabel(price)}.` };
  run.gold = money(run.gold - price);
  const dice = runDice(run, `rest:${shop.id}`);
  withParty(run, (_leader, party) => {
    for (const mage of party) if (mage.alive) mage.swamprunRest(dice);
  });
  sleepUntilMorning(run);
  return { ok: true, message: `Rested for ${moneyLabel(price)}. Day ${run.day}, 07:00. Shops have restocked.` };
}

export interface RecipeView {
  id: string;
  output: ItemId;
  inputs: { id: ItemId; need: number; have: number }[];
  gold: number;
  ready: boolean;
}

export function recipesAt(run: ExplorationRun, shop: ShopDef): RecipeView[] {
  const leader = partyOf(run)[0];
  const have = (id: ItemId): number => leader ? leader.bag.filter((entry) => entry === id).length : 0;
  return (shop.recipes ?? []).flatMap((id) => {
    const recipe = FORGE_RECIPES[id];
    if (!recipe) return [];
    const inputs = recipe.inputs.map(([item, need]) => ({ id: item, need, have: have(item) }));
    return [{
      id,
      output: recipe.output,
      inputs,
      gold: recipe.gold,
      ready: run.gold >= recipe.gold && inputs.every((input) => input.have >= input.need),
    }];
  });
}

export function forge(run: ExplorationRun, shopId: string, recipeId: string): ShopResult {
  const shop = shopById(shopId);
  const view = shop ? recipesAt(run, shop).find((entry) => entry.id === recipeId) : undefined;
  if (!shop || !view) return { ok: false, message: 'Unknown recipe.' };
  if (!view.ready) return { ok: false, message: 'Missing materials or gold.' };
  const output = getItem(view.output);
  return withParty(run, (leader) => {
    const freed = view.inputs.reduce((sum, input) => sum + getItem(input.id).weight * input.need, 0);
    if (!leader.canCarry(output.weight - freed)) return { ok: false, message: 'Too heavy to carry.' };
    for (const input of view.inputs) {
      for (let n = 0; n < input.need; n++) leader.bag.splice(leader.bag.indexOf(input.id), 1);
    }
    run.gold = money(run.gold - view.gold);
    grantToMage(leader, view.output);
    return { ok: true, message: `Forged ${output.name}.` };
  });
}

// -----------------------------------------------------------------------------
//  PACK
// -----------------------------------------------------------------------------

export function equipItem(run: ExplorationRun, id: ItemId): ShopResult {
  return withParty(run, (leader) => {
    if (!leader.canEquipFromBag(id) || !leader.equipFromBag(id)) {
      return { ok: false, message: 'Cannot equip that now.' };
    }
    return { ok: true, message: `Equipped ${getItem(id).name}.` };
  });
}

export function unequipItem(run: ExplorationRun, id: ItemId): ShopResult {
  return withParty(run, (leader) => {
    const def = getItem(id);
    if (def.permanentlyBinding) return { ok: false, message: `${def.name} is bound to you.` };
    let removed = false;
    if (leader.hands.includes(id)) removed = leader.unequipHand(id);
    else if (leader.accessories.includes(id)) {
      leader.accessories.splice(leader.accessories.indexOf(id), 1);
      leader.bag.push(id);
      removed = true;
    } else if (leader.head === id || leader.torso === id || leader.boots === id) {
      if (leader.head === id) leader.head = null;
      if (leader.torso === id) leader.torso = null;
      if (leader.boots === id) leader.boots = null;
      leader.bag.push(id);
      removed = true;
    }
    return removed
      ? { ok: true, message: `Stowed ${def.name}.` }
      : { ok: false, message: 'Cannot stow that now.' };
  });
}

/** Leave an item behind for good. */
export function dropItem(run: ExplorationRun, id: ItemId): ShopResult {
  return withParty(run, (leader) => {
    for (const list of [leader.bag, leader.utility]) {
      const index = list.indexOf(id);
      if (index >= 0) {
        list.splice(index, 1);
        return { ok: true, message: `Dropped ${getItem(id).name}.` };
      }
    }
    return { ok: false, message: 'Not in your pack.' };
  });
}
