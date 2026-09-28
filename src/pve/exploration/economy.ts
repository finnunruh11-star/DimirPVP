// Money, stock and gear for Exploration towns. Every function here takes the run
// and mutates it through the party snapshot, so a save always reflects the shop
// counter. Seeded from the run: the same day in the same shop shows the same shelf.

import type { MageClass } from '../../core/Classes';
import { Dice } from '../../core/Dice';
import { getItem, type ItemDef, type ItemId, type Rarity } from '../../core/Items';
import type { Mage } from '../../core/Mage';
import { sleepUntilMorning } from './clock';
import { leadMember, livingMembers, memberOf, respawnFallen } from './coop';
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

/** Restore the party, let `fn` change it, and store the result back on the run. The leader is the first member standing. */
export function withParty<T>(run: ExplorationRun, fn: (leader: Mage, party: Mage[]) => T): T {
  const party = restoreParty(run.party);
  const leader = leadMember(party);
  if (!leader) throw new Error('The party is empty.');
  const result = fn(leader, party);
  run.party = capturePartySnapshot(party);
  return result;
}

/** The same for one member; no member means the leader. */
export function withMember<T>(run: ExplorationRun, member: MageClass | null | undefined, fn: (mage: Mage, party: Mage[]) => T): T {
  return withParty(run, (leader, party) => fn(actingMember(party, member) ?? leader, party));
}

function actingMember(party: readonly Mage[], member: MageClass | null | undefined): Mage | undefined {
  if (member == null) return leadMember(party);
  const mage = memberOf(party, member);
  if (!mage) throw new Error('No such party member.');
  return mage;
}

export function partyOf(run: ExplorationRun): Mage[] {
  return restoreParty(run.party);
}

/** One member as stored; no member means the leader. */
export function memberIn(run: ExplorationRun, member?: MageClass | null): Mage | undefined {
  const party = partyOf(run);
  return member == null ? leadMember(party) : memberOf(party, member);
}

/** Hand out finds: each to `prefer` if they can carry it, else the first member standing with room, else the first standing. */
export function grantToParty(run: ExplorationRun, id: ItemId, count = 1, prefer?: MageClass | null): void {
  const weight = getItem(id).weight;
  withParty(run, (leader, party) => {
    const living = livingMembers(party);
    const carriers = living.length ? living : [leader];
    const first = prefer ? carriers.find((mage) => mage.mageClass === prefer) : undefined;
    const order = first ? [first, ...carriers.filter((mage) => mage !== first)] : carriers;
    for (let i = 0; i < count; i++) grantToMage(order.find((mage) => mage.canCarry(weight)) ?? order[0], id);
  });
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

export function buyItem(run: ExplorationRun, shopId: string, key: string, member?: MageClass | null): ShopResult {
  const shop = shopById(shopId);
  if (!shop) return { ok: false, message: 'No such shop.' };
  const slot = shopStock(run, shop).find((entry) => entry.key === key);
  if (!slot) return { ok: false, message: 'Not in stock.' };
  if (slot.sold) return { ok: false, message: 'Sold out until tomorrow.' };
  if (run.gold < slot.price) return { ok: false, message: `Costs ${moneyLabel(slot.price)}.` };
  const def = getItem(slot.id);
  return withMember(run, member, (buyer) => {
    if (!buyer.canCarry(def.weight * slot.qty)) return { ok: false, message: 'Too heavy to carry.' };
    for (let i = 0; i < slot.qty; i++) grantToMage(buyer, slot.id);
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
export function sellOffers(run: ExplorationRun, shop: ShopDef, member?: MageClass | null): SellOffer[] {
  const seller = memberIn(run, member);
  if (!seller) return [];
  const counts = new Map<ItemId, number>();
  for (const id of [...seller.bag, ...seller.utility]) counts.set(id, (counts.get(id) ?? 0) + 1);
  const offers: SellOffer[] = [];
  for (const [id, count] of counts) {
    const def = getItem(id);
    if (def.permanentlyBinding) continue;
    const unit = sellPrice(shop, def);
    if (unit > 0) offers.push({ id, name: def.name, count, unit });
  }
  return offers.sort((a, b) => b.unit * b.count - a.unit * a.count);
}

export function sellItem(run: ExplorationRun, shopId: string, id: ItemId, all: boolean, member?: MageClass | null): ShopResult {
  const shop = shopById(shopId);
  if (!shop) return { ok: false, message: 'No such shop.' };
  const def = getItem(id);
  const unit = sellPrice(shop, def);
  if (unit <= 0) return { ok: false, message: 'Not bought here.' };
  return withMember(run, member, (seller) => {
    let sold = 0;
    for (const list of [seller.bag, seller.utility]) {
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

/** A night's rooms for the whole party, fallen members included. */
export function roomPrice(run: ExplorationRun, shop: ShopDef | undefined): number | undefined {
  const price = shop?.restPrice;
  return price == null ? undefined : money(price * Math.max(1, run.party.entities.length));
}

/**
 * A room for the night: 75% of everything back, and wake at seven on the next day.
 * The fallen get up again, with 1 HP, 1 sanity, no mana and no word charges.
 */
export function rest(run: ExplorationRun, shopId: string): ShopResult {
  const shop = shopById(shopId);
  const price = roomPrice(run, shop);
  if (!shop || price == null) return { ok: false, message: 'No beds here.' };
  if (run.gold < price) return { ok: false, message: `Rooms cost ${moneyLabel(price)}.` };
  run.gold = money(run.gold - price);
  const dice = runDice(run, `rest:${shop.id}`);
  const risen = withParty(run, (_leader, party) => {
    const fallen = party.filter((mage) => !mage.alive);
    for (const mage of party) if (mage.alive) mage.swamprunRest(dice);
    for (const mage of fallen) respawnFallen(mage);
    return fallen.map((mage) => mage.name);
  });
  sleepUntilMorning(run);
  const back = risen.length ? ` ${risen.join(' and ')} ${risen.length > 1 ? 'are' : 'is'} back on their feet.` : '';
  return { ok: true, message: `Rested for ${moneyLabel(price)}. Day ${run.day}, 07:00. Shops have restocked.${back}` };
}

export interface RecipeView {
  id: string;
  output: ItemId;
  inputs: { id: ItemId; need: number; have: number }[];
  gold: number;
  ready: boolean;
}

export function recipesAt(run: ExplorationRun, shop: ShopDef, member?: MageClass | null): RecipeView[] {
  const smith = memberIn(run, member);
  const have = (id: ItemId): number => smith ? smith.bag.filter((entry) => entry === id).length : 0;
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

export function forge(run: ExplorationRun, shopId: string, recipeId: string, member?: MageClass | null): ShopResult {
  const shop = shopById(shopId);
  const view = shop ? recipesAt(run, shop, member).find((entry) => entry.id === recipeId) : undefined;
  if (!shop || !view) return { ok: false, message: 'Unknown recipe.' };
  if (!view.ready) return { ok: false, message: 'Missing materials or gold.' };
  const output = getItem(view.output);
  return withMember(run, member, (smith) => {
    const freed = view.inputs.reduce((sum, input) => sum + getItem(input.id).weight * input.need, 0);
    if (!smith.canCarry(output.weight - freed)) return { ok: false, message: 'Too heavy to carry.' };
    for (const input of view.inputs) {
      for (let n = 0; n < input.need; n++) smith.bag.splice(smith.bag.indexOf(input.id), 1);
    }
    run.gold = money(run.gold - view.gold);
    grantToMage(smith, view.output);
    return { ok: true, message: `Forged ${output.name}.` };
  });
}

// -----------------------------------------------------------------------------
//  PACK
// -----------------------------------------------------------------------------

export function equipItem(run: ExplorationRun, id: ItemId, member?: MageClass | null): ShopResult {
  return withMember(run, member, (leader) => {
    if (!leader.canEquipFromBag(id) || !leader.equipFromBag(id)) {
      return { ok: false, message: 'Cannot equip that now.' };
    }
    return { ok: true, message: `Equipped ${getItem(id).name}.` };
  });
}

export function unequipItem(run: ExplorationRun, id: ItemId, member?: MageClass | null): ShopResult {
  return withMember(run, member, (leader) => {
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
export function dropItem(run: ExplorationRun, id: ItemId, member?: MageClass | null): ShopResult {
  return withMember(run, member, (leader) => {
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

/** Pass a carried item to another member. Items that change their bearer's body stay put. */
export function giveItem(run: ExplorationRun, id: ItemId, from: MageClass, to: MageClass): ShopResult {
  const def = getItem(id);
  if (from === to) return { ok: false, message: 'Already yours.' };
  if (def.permanentlyBinding || def.hpMult != null || def.hpFlat != null || def.sanityMult != null) {
    return { ok: false, message: `${def.name} cannot change hands.` };
  }
  return withParty(run, (_leader, party) => {
    const giver = memberOf(party, from);
    const taker = memberOf(party, to);
    if (!giver || !taker) return { ok: false, message: 'No such party member.' };
    if (!taker.canCarry(def.weight)) return { ok: false, message: `${taker.name} cannot carry it.` };
    const list = giver.bag.includes(id) ? giver.bag : giver.utility.includes(id) ? giver.utility : null;
    if (!list) return { ok: false, message: 'Not in your pack.' };
    list.splice(list.indexOf(id), 1);
    grantToMage(taker, id);
    return { ok: true, message: `Gave ${def.name} to ${taker.name}.` };
  });
}
