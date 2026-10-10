import { getItem, type ItemId } from '../core/Items';
import type { Mage } from '../core/Mage';
import { packFits } from '../core/Pack';

export interface LootEntry { id: ItemId; count: number; taken?: number }
export type LootChoice = { kind: 'ready' } | { kind: 'take'; entry: number; member: number };
export type LootFits = (mage: Mage, id: ItemId) => boolean;

export function lootEntries(items: readonly ItemId[]): LootEntry[] {
  const counts = new Map<ItemId, number>();
  for (const id of items) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].map(([id, count]) => ({ id, count }));
}

export function parseLootChoice(value: string): LootChoice | null {
  if (value === 'ready') return { kind: 'ready' };
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