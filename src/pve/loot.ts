import { getItem, isItemId, type ItemId } from '../core/Items';
import type { Mage } from '../core/Mage';
import { packFits } from '../core/Pack';
import { carriedCount, changesHands, takeFromPack } from './exploration/economy';

export interface LootEntry { id: ItemId; count: number; taken?: number }
export type LootChoice = { kind: 'ready' } | { kind: 'take'; entry: number; member: number }
  | { kind: 'release'; member: number; id: ItemId }
  | { kind: 'move'; from: number; to: number; id: ItemId };
export type LootFits = (mage: Mage, id: ItemId) => boolean;

export function lootEntries(items: readonly ItemId[]): LootEntry[] {
  const counts = new Map<ItemId, number>();
  for (const id of items) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].map(([id, count]) => ({ id, count }));
}

export function parseLootChoice(value: string): LootChoice | null {
  if (value === 'ready') return { kind: 'ready' };
  const carried = /^(release|move):(\d+):(?:(\d+):)?([^:]+)$/.exec(value);
  if (carried) {
    const member = Number(carried[2]);
    const to = carried[3] == null ? null : Number(carried[3]);
    if (!Number.isSafeInteger(member) || (to != null && !Number.isSafeInteger(to))) return null;
    let id: string;
    try { id = decodeURIComponent(carried[4]); } catch { return null; }
    if (!isItemId(id)) return null;
    if (carried[1] === 'release' && to == null) return { kind: 'release', member, id };
    if (carried[1] === 'move' && to != null) return { kind: 'move', from: member, to, id };
    return null;
  }
  const match = /^take:(\d+):(\d+)$/.exec(value);
  if (!match) return null;
  const entry = Number(match[1]);
  const member = Number(match[2]);
  return Number.isSafeInteger(entry) && Number.isSafeInteger(member) ? { kind: 'take', entry, member } : null;
}

export function canClaimLoot(
  entries: readonly LootEntry[], party: readonly Mage[], entry: number, member: number,
  fits: LootFits = (mage, id) => packFits(mage, [id]),
): boolean {
  if (!Number.isInteger(entry) || !Number.isInteger(member)) return false;
  const loot = entries[entry];
  const mage = party[member];
  return !!loot && loot.count > 0 && !!mage && mage.alive && mage.canCarry(getItem(loot.id).weight) && fits(mage, loot.id);
}

export function claimLoot(
  entries: LootEntry[], party: readonly Mage[], entry: number, member: number,
  grant: (mage: Mage, id: ItemId) => void, fits?: LootFits,
): ItemId | null {
  if (!canClaimLoot(entries, party, entry, member, fits)) return null;
  const loot = entries[entry];
  grant(party[member], loot.id);
  loot.count -= 1;
  loot.taken = (loot.taken ?? 0) + 1;
  return loot.id;
}

export function canReleaseLoot(party: readonly Mage[], member: number, id: ItemId): boolean {
  if (!Number.isInteger(member)) return false;
  const mage = party[member];
  const def = getItem(id);
  if (!mage || !mage.alive || def.keyItem || !changesHands(def)
    || carriedCount(mage, id) <= 0 || !packFits(mage, [], [id])) return false;
  if (def.pack?.weightMult == null) return true;
  const after: Mage = Object.assign(Object.create(Object.getPrototypeOf(mage)), mage, {
    bag: [...mage.bag], utility: [...mage.utility], pouch: [...mage.pouch],
  });
  takeFromPack(after, id, 1);
  return after.carriedWeight() <= mage.carriedWeight() || after.canCarry(0);
}

export function releaseLoot(entries: LootEntry[], party: readonly Mage[], member: number, id: ItemId): boolean {
  if (!canReleaseLoot(party, member, id) || takeFromPack(party[member], id, 1) !== 1) return false;
  const entry = entries.find((loot) => loot.id === id);
  if (entry) {
    entry.count += 1;
    entry.taken = Math.max(0, (entry.taken ?? 0) - 1);
  } else entries.push({ id, count: 1 });
  return true;
}

export function canMoveLoot(party: readonly Mage[], from: number, to: number, id: ItemId, fits?: LootFits): boolean {
  return from !== to && canReleaseLoot(party, from, id)
    && canClaimLoot([{ id, count: 1 }], party, 0, to, fits);
}

export function moveLoot(
  party: readonly Mage[], from: number, to: number, id: ItemId,
  grant: (mage: Mage, id: ItemId) => void, fits?: LootFits,
): boolean {
  if (!canMoveLoot(party, from, to, id, fits) || takeFromPack(party[from], id, 1) !== 1) return false;
  grant(party[to], id);
  return true;
}