// The adventure pack: how many item slots a mage's carried things fill, and how
// many there are. Ten slots bare; a carried bag sets the count (the best bag wins).
// Materials and everyday items stack 20 to a slot, gear and tools one. Worn gear,
// bags and key items take no slot. Pure: used by shops, loot and the UI alike.

import { getItem, SLOT_CAPS, type ItemDef, type ItemId } from './Items';
import type { Mage } from './Mage';

export const BASE_PACK_SLOTS = 10;
export const STACK_SIZE = 20;

/** How many of `def` share one pack slot; 0 means it takes none. */
export function stackSize(def: ItemDef): number {
  if (def.keyItem || def.pack) return 0;
  if (def.tool) return 1;
  return def.slot === 'utility' ? STACK_SIZE : 1;
}

/** Everything a mage carries but does not wear: the stowed bag, the belt, and arrows. */
export function packItems(mage: Mage): ItemId[] {
  const items: ItemId[] = [...mage.bag, ...mage.utility];
  for (let i = 0; i < mage.arrows; i++) items.push('arrow');
  return items;
}

/** Slots taken by `count` of one item: 41 or 59 copper ore both take 3. */
export function slotsForCount(id: ItemId, count: number): number {
  const size = stackSize(getItem(id));
  return size > 0 && count > 0 ? Math.ceil(count / size) : 0;
}

/** Pack slots a list of carried things fills, each kind in stacks of its stack size. */
export function slotsFor(items: readonly ItemId[]): number {
  const counts = new Map<ItemId, number>();
  for (const id of items) counts.set(id, (counts.get(id) ?? 0) + 1);
  let slots = 0;
  for (const [id, count] of counts) slots += slotsForCount(id, count);
  return slots;
}

/** The slot count these carried things allow: the best bag among them, or ten. */
export function capacityFor(items: readonly ItemId[]): number {
  let best = BASE_PACK_SLOTS;
  for (const id of items) best = Math.max(best, getItem(id).pack?.slots ?? 0);
  return best;
}

export function packSlotsUsed(mage: Mage): number {
  return slotsFor(packItems(mage));
}

export function packCapacity(mage: Mage): number {
  return capacityFor(packItems(mage));
}

/** "Pack 7/10", "Pack 12/∞". */
export function packLabel(mage: Mage): string {
  const capacity = packCapacity(mage);
  return `Pack ${packSlotsUsed(mage)}/${Number.isFinite(capacity) ? capacity : '∞'}`;
}

/**
 * Would the pack still hold everything after `removes` leave it and `adds` are
 * handed over the way a merchant hands things over (worn if the slot is free,
 * a hand item only into empty hands)? A change that frees slots without losing
 * a bag is always allowed, so an overfull pack can still be emptied.
 */
export function packFits(mage: Mage, adds: readonly ItemId[] = [], removes: readonly ItemId[] = []): boolean {
  const before = packItems(mage);
  const items = [...before];
  for (const id of removes) {
    const index = items.indexOf(id);
    if (index >= 0) items.splice(index, 1);
  }
  let hands = mage.hands.length;
  let accessories = mage.accessories.length;
  const worn: Record<'head' | 'torso' | 'boots', boolean> = { head: !!mage.head, torso: !!mage.torso, boots: !!mage.boots };
  for (const id of adds) {
    const def = getItem(id);
    if (def.ammo) {
      items.push('arrow');
      continue;
    }
    if (def.slot === 'hand' && hands === 0) {
      hands += 1;
      continue;
    }
    if (def.slot === 'accessory' && accessories < SLOT_CAPS.accessory) {
      accessories += 1;
      continue;
    }
    if ((def.slot === 'head' || def.slot === 'torso' || def.slot === 'boots') && !worn[def.slot]) {
      worn[def.slot] = true;
      continue;
    }
    items.push(id);
  }
  return holds(before, items);
}

/** Would stowing worn or held `id` into the pack still fit? */
export function packCanStow(mage: Mage, id: ItemId): boolean {
  const before = packItems(mage);
  return holds(before, [...before, id]);
}

/** The pack after a change still fits, or the change frees room without losing a bag. */
function holds(before: readonly ItemId[], after: readonly ItemId[]): boolean {
  const used = slotsFor(after);
  const capacity = capacityFor(after);
  if (used <= capacity) return true;
  return used <= slotsFor(before) && capacity >= capacityFor(before);
}
