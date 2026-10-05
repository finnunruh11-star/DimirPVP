// Money, stock and gear for Exploration towns. Every function here takes the run
// and mutates it through the party snapshot, so a save always reflects the shop
// counter. Seeded from the run: the same day in the same shop shows the same shelf.

import type { MageClass } from '../../core/Classes';
import { Dice } from '../../core/Dice';
import { getItem, type ItemDef, type ItemId, type Rarity } from '../../core/Items';
import type { Mage } from '../../core/Mage';
import { packCanStow, packFits } from '../../core/Pack';
import { advanceHours, clockTime, spanLabel } from './clock';
import { hoursBeforeBloodmoon } from './bloodmoon';
import { leadMember, livingMembers, memberOf, respawnFallen } from './coop';
import { capturePartySnapshot, restoreParty } from './party';
import type { ExplorationRun } from './run';
import { shopById, stockCandidates, type ShopDef } from './shops';
import { designProblem, rollCraft } from '../../core/crafting/craft';
import { craftItemId, type CraftDesign } from '../../core/crafting/item';

export interface ShopResult {
  ok: boolean;
  message: string;
}

const PACK_OVERFLOW = 'Without that bag the pack would overflow. Empty it first.';

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

/**
 * Hand out finds: each to `prefer` if they can carry it, else the first member
 * standing with room. Nobody is loaded past what they can carry or what their
 * pack holds: whatever finds no room is left behind. Returns how many were left.
 */
export function grantToParty(run: ExplorationRun, id: ItemId, count = 1, prefer?: MageClass | null): number {
  const weight = getItem(id).weight;
  return withParty(run, (leader, party) => {
    const living = livingMembers(party);
    const carriers = living.length ? living : [leader];
    const first = prefer ? carriers.find((mage) => mage.mageClass === prefer) : undefined;
    const order = first ? [first, ...carriers.filter((mage) => mage !== first)] : carriers;
    let left = 0;
    for (let i = 0; i < count; i++) {
      const carrier = order.find((mage) => mage.canCarry(weight) && packFits(mage, [id]));
      if (carrier) grantToMage(carrier, id);
      else left += 1;
    }
    return left;
  });
}

/** "2x Moonglow" as a find reads, and how much of it nobody had room for. */
export function haulLabel(id: ItemId, count: number, left = 0): string {
  const name = `${count > 1 ? `${count}x ` : ''}${getItem(id).name}`;
  if (left <= 0) return name;
  return `${name} (${left >= count ? '' : `${left} of them `}left behind: no room to carry)`;
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
  const slots: StockSlot[] = (rule.fixed ?? []).map(({ id, qty = 1, price }) => ({
    key: `f:${id}`,
    id,
    qty,
    price: price ?? buyPrice(getItem(id), mult, qty),
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

/** Undo what an item did to its bearer's body when it was handed over, as it leaves them. */
function releaseFromMage(mage: Mage, def: ItemDef): void {
  if (def.hpFlat != null) mage.maxHp = Math.max(1, mage.maxHp - def.hpFlat);
  if (def.hpMult) mage.maxHp = Math.max(1, Math.round(mage.maxHp / def.hpMult));
  if (def.sanityMult) mage.maxSanity = Math.max(1, Math.round(mage.maxSanity / def.sanityMult));
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
  return withMember(run, member, (buyer, party) => {
    if (def.keyItem && party.some((mage) => carries(mage, slot.id))) return { ok: false, message: 'The party already has one.' };
    if (!buyer.canCarry(def.weight * slot.qty)) return { ok: false, message: 'Too heavy to carry.' };
    if (!packFits(buyer, Array.from({ length: slot.qty }, () => slot.id))) return { ok: false, message: 'No room in the pack.' };
    for (let i = 0; i < slot.qty; i++) grantToMage(buyer, slot.id);
    run.gold = money(run.gold - slot.price);
    if (!slot.fixed) run.purchases.push(slot.key);
    return { ok: true, message: `Bought ${slot.qty > 1 ? `${slot.qty}x ` : ''}${def.name} for ${moneyLabel(slot.price)}.` };
  });
}

/** Does `mage` have `id` anywhere: worn, held, belted or packed? */
function carries(mage: Mage, id: ItemId): boolean {
  return mage.bag.includes(id) || mage.equippedItems().includes(id);
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
    if (def.permanentlyBinding || def.keyItem) continue;
    const unit = sellPrice(shop, def);
    if (unit > 0) offers.push({ id, name: def.name, count, unit });
  }
  return offers.sort((a, b) => b.unit * b.count - a.unit * a.count);
}

export function sellItem(run: ExplorationRun, shopId: string, id: ItemId, all: boolean, member?: MageClass | null): ShopResult {
  const shop = shopById(shopId);
  if (!shop) return { ok: false, message: 'No such shop.' };
  const def = getItem(id);
  if (def.keyItem) return { ok: false, message: 'A key item. It stays with the party.' };
  const unit = sellPrice(shop, def);
  if (unit <= 0) return { ok: false, message: 'Not bought here.' };
  return withMember(run, member, (seller) => {
    const owned = [...seller.bag, ...seller.utility].filter((entry) => entry === id).length;
    if (owned === 0) return { ok: false, message: 'You have none.' };
    if (!packFits(seller, [], Array.from({ length: all ? owned : 1 }, () => id))) return { ok: false, message: PACK_OVERFLOW };
    let sold = 0;
    for (const list of [seller.bag, seller.utility]) {
      for (let i = list.length - 1; i >= 0 && (all || sold === 0); i--) {
        if (list[i] !== id) continue;
        list.splice(i, 1);
        releaseFromMage(seller, def);
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

/** Hours a night in a room lasts. */
export const LONG_REST_HOURS = 8;
/** Share of every maximum a whole night gives back. */
const LONG_REST_SHARE = 0.75;

/**
 * Eight hours in a room: 75% of everything back, and the fallen get up with 1 HP,
 * 1 sanity, no mana and no word charges. A rising bloodmoon wakes the party, and
 * a night cut short gives back only the share of it that was slept.
 */
export function rest(run: ExplorationRun, shopId: string): ShopResult {
  const shop = shopById(shopId);
  const price = roomPrice(run, shop);
  if (!shop || price == null) return { ok: false, message: 'No beds here.' };
  const hours = hoursBeforeBloodmoon(run, LONG_REST_HOURS);
  if (hours <= 0) return { ok: false, message: 'The bloodmoon is up. Nobody sleeps through it.' };
  if (run.gold < price) return { ok: false, message: `Rooms cost ${moneyLabel(price)}.` };
  run.gold = money(run.gold - price);
  const whole = hours >= LONG_REST_HOURS;
  const dice = runDice(run, `rest:${shop.id}`);
  const risen = withParty(run, (_leader, party) => {
    const fallen = party.filter((mage) => !mage.alive);
    for (const mage of party) {
      if (!mage.alive) continue;
      if (whole) mage.swamprunRest(dice);
      else mage.restoreShare((LONG_REST_SHARE * hours) / LONG_REST_HOURS);
    }
    for (const mage of fallen) respawnFallen(mage);
    return fallen.map((mage) => mage.name);
  });
  const days = advanceHours(run, hours);
  const slept = whole ? `Slept ${LONG_REST_HOURS} hours` : `The bloodmoon wakes the party after ${spanLabel(hours)}`;
  const restock = days > 0 ? ' A new day: the shops have restocked.' : '';
  const back = risen.length ? ` ${risen.join(' and ')} ${risen.length > 1 ? 'are' : 'is'} back on their feet.` : '';
  return { ok: true, message: `${slept}. Day ${run.day}, ${clockTime(run.hour)}.${restock}${back}` };
}

export interface CraftResult extends ShopResult {
  /** What came off the bench; its id also tells how it was rolled. */
  item?: ItemId;
}

/** Who may work the bench for this player: an Objects mage on their feet (online, only their own traveller). */
export function craftersIn(run: ExplorationRun, member?: MageClass | null): Mage[] {
  return partyOf(run).filter((mage) => mage.alive && mage.spellClass === 'objects' && (member == null || mage.mageClass === member));
}

/**
 * Craft at a forge's bench. Online `member` is the traveller who asked; alone
 * `crafter` names which Objects mage works. The materials and the mana are spent,
 * the dice come from the run, and the item goes to the crafter.
 */
export function craftItem(run: ExplorationRun, shopId: string, design: CraftDesign, member?: MageClass | null, crafter?: MageClass | null): CraftResult {
  const shop = shopById(shopId);
  if (!shop?.services.includes('forge')) return { ok: false, message: 'There is no crafting bench here.' };
  const problem = designProblem(design);
  if (problem) return { ok: false, message: problem };
  return withParty(run, (leader, party): CraftResult => {
    const smith = memberOf(party, member ?? crafter ?? leader.mageClass);
    if (!smith) return { ok: false, message: 'No such party member.' };
    if (smith.spellClass !== 'objects') return { ok: false, message: 'Only an Objects mage can craft.' };
    if (!smith.alive) return { ok: false, message: `${smith.name} has fallen.` };
    const used = [...design.parts, ...design.sockets];
    for (const id of new Set(used)) {
      const need = used.filter((entry) => entry === id).length;
      if (smith.bag.filter((entry) => entry === id).length < need) return { ok: false, message: `Needs ${need}x ${getItem(id).name}.` };
    }
    if (smith.mana < design.mana) return { ok: false, message: `Needs ${design.mana} mana.` };
    const id = craftItemId(rollCraft(design, runDice(run, `craft:${run.crafts}`)));
    const made = getItem(id);
    const freed = used.reduce((sum, part) => sum + getItem(part).weight, 0);
    if (!smith.canCarry(made.weight - freed)) return { ok: false, message: 'Too heavy to carry.' };
    if (!packFits(smith, [id], used)) return { ok: false, message: 'No room in the pack.' };
    for (const part of used) smith.bag.splice(smith.bag.indexOf(part), 1);
    smith.spendMana(design.mana);
    run.crafts += 1;
    grantToMage(smith, id);
    return { ok: true, message: `Crafted ${made.name}.`, item: id };
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
    const worn = leader.hands.includes(id) || leader.accessories.includes(id) || leader.head === id || leader.torso === id || leader.boots === id;
    if (worn && def.torchCombats == null && !packCanStow(leader, id)) return { ok: false, message: 'No room in the pack.' };
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

/** Leave an item behind for good. Key items stay; a bag stays while its room is in use. */
export function dropItem(run: ExplorationRun, id: ItemId, member?: MageClass | null): ShopResult {
  if (getItem(id).keyItem) return { ok: false, message: 'A key item. It stays with the party.' };
  return withMember(run, member, (leader) => {
    if (!packFits(leader, [], [id])) return { ok: false, message: PACK_OVERFLOW };
    for (const list of [leader.bag, leader.utility]) {
      const index = list.indexOf(id);
      if (index >= 0) {
        list.splice(index, 1);
        releaseFromMage(leader, getItem(id));
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
    if (!packFits(taker, [id])) return { ok: false, message: `${taker.name} has no room in the pack.` };
    if (!packFits(giver, [], [id])) return { ok: false, message: PACK_OVERFLOW };
    const list = giver.bag.includes(id) ? giver.bag : giver.utility.includes(id) ? giver.utility : null;
    if (!list) return { ok: false, message: 'Not in your pack.' };
    list.splice(list.indexOf(id), 1);
    grantToMage(taker, id);
    return { ok: true, message: `Gave ${def.name} to ${taker.name}.` };
  });
}
