// =============================================================================
//  CREATIVE PREP PRESETS
// -----------------------------------------------------------------------------
//  Up to three named stat + item builds, kept in localStorage so they survive
//  between sessions. Everything read back is re-validated: stored JSON is user
//  editable, so it is treated as untrusted input.
// =============================================================================

import { asItemIds, getItem, type ItemId } from '../core/Items';
import { STAT_ORDER, type StatKey } from '../core/Stats';

export const PRESET_SLOTS = 3;
const STORAGE_KEY = 'dimir.creativePresets.v1';
const MAX_NAME = 24;
const MAX_ITEMS = 200;
const MAX_STAT = 9999;

export interface CreativePreset {
  name: string;
  stats: Record<StatKey, number>;
  items: ItemId[];
}

/** Empty slots are null, so the array always has exactly PRESET_SLOTS entries. */
export type PresetSlots = (CreativePreset | null)[];

function emptySlots(): PresetSlots {
  return Array.from({ length: PRESET_SLOTS }, () => null);
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Storage can throw when blocked by browser privacy settings.
    return null;
  }
}

function cleanName(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, MAX_NAME);
}

function cleanStats(value: unknown): Record<StatKey, number> {
  const source = typeof value === 'object' && value ? (value as Record<string, unknown>) : {};
  const stats = {} as Record<StatKey, number>;
  for (const key of STAT_ORDER) {
    const raw = Number(source[key]);
    stats[key] = Number.isFinite(raw) ? Math.min(MAX_STAT, Math.max(0, Math.floor(raw))) : 4;
  }
  return stats;
}

function cleanItems(value: unknown): ItemId[] {
  return asItemIds(value)
    .filter((id) => !getItem(id).enemyOnly)
    .slice(0, MAX_ITEMS);
}

function cleanPreset(value: unknown, index: number): CreativePreset | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  return {
    name: cleanName(source.name, `Build ${index + 1}`),
    stats: cleanStats(source.stats),
    items: cleanItems(source.items),
  };
}

/** Read all three slots. Never throws; corrupt data reads back as empty. */
export function loadCreativePresets(): PresetSlots {
  const store = storage();
  if (!store) return emptySlots();
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return emptySlots();
    const parsed: unknown = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [];
    return Array.from({ length: PRESET_SLOTS }, (_, i) => cleanPreset(list[i], i));
  } catch {
    return emptySlots();
  }
}

/** Persist all three slots. Returns false when storage is unavailable. */
export function saveCreativePresets(slots: PresetSlots): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(slots.slice(0, PRESET_SLOTS)));
    return true;
  } catch {
    return false;
  }
}
