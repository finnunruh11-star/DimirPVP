// What a party knows of hexcraft. Nobody is told what a rune does: a Hexcraft
// mage learns by drawing and loosing, by studying ready-drawn sheets bought from
// a scriptorium (the scribe says what the whole sheet does, never what each rune
// means), or by buying a rune there once the party owns a Hex Codex. Only known
// runes light up on the table and name a Hexzettel.

import type { Dice } from '../Dice';
import { FACETS, readRune, RUNE_LINES, RUNE_ORDER, RUNES, SEAL_BIT, type Facet, type PaperKind, type RuneId } from './runes';

export interface HexLore {
  /** Runes learned; each comes with its sealed form. */
  runes: RuneId[];
  /** Ready-drawn sheets bought so far; seeds the next one a scriptorium draws. */
  sheetsBought: number;
}

export const emptyHexLore = (): HexLore => ({ runes: [], sheetsBought: 0 });

/** Gold for the next rune: five silver, and five more for each already learned. */
export const runePrice = (known: number): number => Math.round(5 * (known + 1)) / 10;

/** How a scriptorium offers a rune it will not name before it is paid for. */
export const RUNE_HINTS: Record<RuneId, string> = {
  heal: 'Gentle rune',
  regen: 'Patient rune',
  dot: 'Lingering rune',
  wind: 'Restless rune',
  twist: 'Crooked rune',
  barrier: 'Stubborn rune',
  accelerate: 'Hasty rune',
  corrosive: 'Biting rune',
  light: 'Bright rune',
  fire: 'Hot rune',
  shatter: 'Brittle rune',
  water: 'Flowing rune',
  mind: 'Whispering rune',
  edge: 'Sharp rune',
  missile: 'Pointy rune',
  explosion: 'Destructive rune',
  lance: 'Straight rune',
  blink: 'Fleeting rune',
  infuse: 'Thirsty rune',
  mark: 'Watchful rune',
  might: 'Proud rune',
  single: 'Lonely rune',
  aoe: 'Wide rune',
  multi: 'Crowded rune',
  battlefield: 'Boundless rune',
  environment: 'Earthy rune',
  bigger: 'Greedy rune',
  rangeUp: 'Far-reaching rune',
  allies: 'Loyal rune',
};

/** A plain sheet with one to three runes, at least one of them an effect, some sealed. */
export function randomHexSheet(dice: Dice): number[] {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(dice.float() * list.length)];
  const count = 1 + Math.floor(dice.float() * 3);
  const runes: RuneId[] = [pick(RUNE_ORDER.filter((rune) => FACETS[rune].kind === 'effect'))];
  while (runes.length < count) runes.push(pick(RUNE_ORDER));
  for (let i = runes.length - 1; i > 0; i--) {
    const j = Math.floor(dice.float() * (i + 1));
    [runes[i], runes[j]] = [runes[j], runes[i]];
  }
  const grids = runes.map((rune) => RUNES[rune].masks[0] | (dice.float() < 0.25 ? SEAL_BIT : 0));
  while (grids.length < 3) grids.push(0);
  return grids;
}

/** Lore off a save or the wire: known runes only, each once. */
export function parseHexLore(value: unknown): HexLore {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const runes = Array.isArray(raw.runes) ? raw.runes.filter((rune): rune is RuneId => RUNE_ORDER.includes(rune as RuneId)) : [];
  const bought = raw.sheetsBought;
  return {
    runes: [...new Set(runes)],
    sheetsBought: typeof bought === 'number' && Number.isInteger(bought) ? Math.min(1_000_000, Math.max(0, bought)) : 0,
  };
}

// -----------------------------------------------------------------------------
//  WHAT THIS CLIENT'S PARTY KNOWS
// -----------------------------------------------------------------------------

/** The runes the party playing on this client knows; null knows them all (outside an Adventure, and the rules' own tests). */
let lore: ReadonlySet<RuneId> | null = null;
let version = 0;

/** Set whose lore names the Hexzettel this client shows. */
export function setHexLore(runes: readonly RuneId[] | null): void {
  if (runes && lore && runes.length === lore.size && runes.every((rune) => lore!.has(rune))) return;
  if (!runes && !lore) return;
  lore = runes ? new Set(runes) : null;
  version += 1;
}

/** Bumped whenever the lore changes, so whatever was named by the old lore is named again. */
export const hexLoreVersion = (): number => version;

export function runeKnown(rune: RuneId, known: ReadonlySet<RuneId> | null = lore): boolean {
  return !known || known.has(rune);
}

/** A rune's meaning, plain or sealed, is known once the rune is. */
export function facetKnown(facet: Facet, known: ReadonlySet<RuneId> | null = lore): boolean {
  if (!known) return true;
  for (const rune of known) if (rune === facet || RUNES[rune].inverse === facet) return true;
  return false;
}

/** Every grid with lines on it holds a rune the party knows. */
export function sheetKnown(grids: readonly number[], known: ReadonlySet<RuneId> | null = lore): boolean {
  return grids.every((mask) => {
    if (!(mask & RUNE_LINES)) return true;
    const rune = readRune(mask);
    return !!rune && runeKnown(rune, known);
  });
}

const SIGIL = 'BDFGHKLMNPRSTVXZ';

/** "Hex Sheet KRV": an unread sheet, told apart from the others by a mark made of its lines. */
export function unreadHexName(paper: PaperKind, grids: readonly number[]): string {
  let h = 2166136261;
  for (const mask of grids) h = Math.imul(h ^ mask, 16777619);
  h >>>= 0;
  let mark = '';
  for (let i = 0; i < 3; i++) {
    mark += SIGIL[h % SIGIL.length];
    h = Math.floor(h / SIGIL.length);
  }
  return `${paper === 'fine' ? 'Fine ' : ''}Hex Sheet ${mark}`;
}
