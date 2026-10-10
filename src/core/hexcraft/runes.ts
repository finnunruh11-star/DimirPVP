// Hexcraft's paper magic. A sheet holds a row of 3x3 peg grids. Lines between
// neighbouring pegs make runes; a stroke from a grid's seal down to its top peg
// turns its rune inside out; a bridge from one grid to the next couples them,
// so the part after the bridge fires wherever the rune before it lands. Anyone
// can loose a drawn sheet in a fight by paying its mana. Pure: no Phaser.
//
//        o           the seal above a grid
//   0 1 2 == 0 1 2   a bridge: a right-hand peg to the next grid's left-hand peg
//   3 4 5    3 4 5
//   6 7 8    6 7 8

import { RANGE_UNIT } from '../../config/constants';
import type { DamageType } from '../Damage';

const R = (cm: number): number => cm * RANGE_UNIT;
const round2 = (value: number): number => Math.round(value * 100) / 100;

const col = (peg: number): number => peg % 3;
const row = (peg: number): number => Math.floor(peg / 3);
const isPeg = (peg: number): boolean => Number.isInteger(peg) && peg >= 0 && peg < 9;

/** Every line a grid can hold. A grid is a bit mask: bit i is line i, then the seal, then the bridge. */
export const HEX_EDGES: readonly (readonly [number, number])[] = (() => {
  const edges: [number, number][] = [];
  for (let a = 0; a < 9; a++) {
    for (let b = a + 1; b < 9; b++) {
      if (Math.max(Math.abs(col(a) - col(b)), Math.abs(row(a) - row(b))) === 1) edges.push([a, b]);
    }
  }
  return edges;
})();

/** The stroke from a grid's seal to its top peg: the rune is inverted. */
export const SEAL_BIT = 1 << HEX_EDGES.length;
/** The bridge to the next grid: the next part of the hex is coupled to this rune. */
export const BRIDGE_BIT = SEAL_BIT << 1;
export const RUNE_LINES = SEAL_BIT - 1;
export const FULL_GRID = BRIDGE_BIT * 2 - 1;
/** The seal, a peg of its own above each grid. */
export const SEAL_PEG = 9;
/** The peg a seal stroke ends on. */
export const SEAL_TARGET = 1;
export const BRIDGE_FROM: readonly number[] = [2, 5, 8];
export const BRIDGE_TO: readonly number[] = [0, 3, 6];

export function edgeIndex(a: number, b: number): number {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return HEX_EDGES.findIndex(([x, y]) => x === lo && y === hi);
}

/** The lines a stroke from peg `a` to peg `b` lays: one between neighbours, two through a peg between them, none otherwise. */
export function strokeEdges(a: number, b: number): number[] | null {
  if (a === b || !isPeg(a) || !isPeg(b)) return null;
  const direct = edgeIndex(a, b);
  if (direct >= 0) return [direct];
  const dc = col(b) - col(a);
  const dr = row(b) - row(a);
  if (dc % 2 !== 0 || dr % 2 !== 0) return null;
  const mid = (row(a) + dr / 2) * 3 + col(a) + dc / 2;
  return [edgeIndex(a, mid), edgeIndex(mid, b)];
}

/** Strokes on a grid, seal and bridge included: the mana it takes to draw. */
export function lineCount(mask: number): number {
  let count = 0;
  for (let bits = mask; bits; bits &= bits - 1) count += 1;
  return count;
}

/** The peg pairs a grid's rune lines join. */
export function maskEdges(mask: number): (readonly [number, number])[] {
  return HEX_EDGES.filter((_, index) => mask & (1 << index));
}

/** A rune as its strokes: each string walks pegs in order ("147" is 1-4-7). */
function shape(...strokes: string[]): number {
  let mask = 0;
  for (const stroke of strokes) {
    for (let i = 1; i < stroke.length; i++) {
      const lines = strokeEdges(Number(stroke[i - 1]), Number(stroke[i]));
      if (!lines) throw new Error(`Not a stroke: ${stroke}`);
      for (const line of lines) mask |= 1 << line;
    }
  }
  return mask;
}

// -----------------------------------------------------------------------------
//  THE RUNES, AND WHAT THEY BECOME TURNED INSIDE OUT
// -----------------------------------------------------------------------------

export type EffectRune =
  | 'heal' | 'regen' | 'dot' | 'wind' | 'corrosive' | 'light' | 'twist' | 'missile' | 'explosion' | 'barrier' | 'accelerate'
  | 'fire' | 'shatter' | 'water' | 'mind' | 'edge' | 'lance' | 'blink' | 'infuse' | 'mark' | 'might';
export type TargetRune = 'single' | 'aoe' | 'multi' | 'battlefield' | 'environment';
export type ModifierRune = 'bigger' | 'rangeUp' | 'allies';
export type RuneId = EffectRune | TargetRune | ModifierRune;
export type RuneKind = 'effect' | 'target' | 'modifier';

/** Elements give every blow of their part its damage type, and mark whoever the part lands on. */
export type ElementFacet =
  | 'corrosive' | 'light' | 'shadow' | 'fire' | 'frost' | 'shatter' | 'pierce' | 'water' | 'mind' | 'malform' | 'edge' | 'void';
/** Forms carry the part's damage to its mark: darts, blasts, beams, bolts. */
export type FormFacet = 'missile' | 'siphon' | 'explosion' | 'implosion' | 'lance' | 'ricochet';

/** What an effect rune does on this sheet: itself, or its inversion. */
export type EffectFacet =
  | ElementFacet
  | FormFacet
  | 'heal' | 'blight' | 'regen' | 'wither' | 'dot' | 'burst' | 'wind' | 'cyclone' | 'purify' | 'mist' | 'twist' | 'anchor'
  | 'barrier' | 'breach' | 'accelerate' | 'slow' | 'blink' | 'swap' | 'infuse' | 'manaburn' | 'mark' | 'silence' | 'might' | 'feeble';
export type TargetFacet = TargetRune | 'self' | 'nova' | 'chain' | 'seeker' | 'aura';
export type ModifierFacet = ModifierRune | 'smaller' | 'rangeDown' | 'enemies';
export type Facet = EffectFacet | TargetFacet | ModifierFacet;
/** Where a part of the hex lands. A part with no target rune touches one unit: the one you pick, or the one struck. */
export type HexTarget = TargetFacet | 'touch';
/** Accelerate and Slow modify their part when another effect follows them. */
export type HexModifier = ModifierFacet | 'accelerate' | 'slow';

export interface FacetDef {
  label: string;
  kind: RuneKind;
  /** Mana it adds to loosing the hex. */
  cost: number;
  /** Mana it adds when it modifies instead (Accelerate, Slow). */
  modCost?: number;
  color: number;
  text: string;
}

export const FACETS: Record<Facet, FacetDef> = {
  heal: {
    label: 'Healing', kind: 'effect', cost: 3, color: 0x7fe0a0,
    text: 'Heals 2d4. With Over Time it regenerates. On the ground: a healing spring.',
  },
  blight: {
    label: 'Blight', kind: 'effect', cost: 3, color: 0xa04ab8,
    text: "1d6 in the part's element (shadow without one), and nothing can heal it for 3 turns. On the ground: festering earth where nothing heals.",
  },
  regen: {
    label: 'Regeneration', kind: 'effect', cost: 3, color: 0x9ce08a,
    text: 'Heals a little at the start of each of the next 3 turns. On the ground: a healing spring.',
  },
  wither: {
    label: 'Wither', kind: 'effect', cost: 3, color: 0x9a8a6a,
    text: 'Strips 2 maximum health until the fight ends (6 at most). On the ground: withering earth.',
  },
  dot: {
    label: 'Over Time', kind: 'effect', cost: 1, color: 0xd0405a,
    text: "Elements, Blight and Healing work over 3 turns instead of at once; otherwise it bleeds in the part's element. On the ground the hex lingers. A coupling on it fires every tick.",
  },
  burst: {
    label: 'Burst', kind: 'effect', cost: 2, color: 0xff5a2a,
    text: 'Every lingering wound on it lands at once. On the ground: every hazard in the circle erupts and is spent.',
  },
  wind: {
    label: 'Wind', kind: 'effect', cost: 2, color: 0xbfe6ff,
    text: 'Shoves 3cm away from the source; a wall slams for 2d6. On the ground: blows mists and sand away.',
  },
  cyclone: {
    label: 'Cyclone', kind: 'effect', cost: 2, color: 0x6fb0f0,
    text: 'Drags 3cm toward the source. On the ground: a vortex that draws everyone in.',
  },
  corrosive: {
    label: 'Corrosion', kind: 'effect', cost: 2, color: 0x9be870,
    text: 'Element: corrosive. Strikes 1d6 unless a form carries it. On the ground: melts walls, dropped items and totems.',
  },
  purify: {
    label: 'Purify', kind: 'effect', cost: 2, color: 0xe6fff2,
    text: 'Strips rot, roots, stuns, slows and curses, then heals 1d4. On the ground: cleans away curses, acid and hazards.',
  },
  light: {
    label: 'Light', kind: 'effect', cost: 2, color: 0xf3e9a0,
    text: 'Element: light. Strikes 1d6 unless a form carries it, and tears veils away. On the ground: burns shadows off.',
  },
  shadow: {
    label: 'Shadow', kind: 'effect', cost: 2, color: 0x7a5ac8,
    text: 'Element: shadow. Strikes 1d6 unless a form carries it, and you slip into a half veil for a turn. On the ground: a pool of shadow.',
  },
  twist: {
    label: 'Twist', kind: 'effect', cost: 3, color: 0xc8d878,
    text: 'Turns a quarter circle around the source; a wall slams for 2d6. On the ground: spinning earth.',
  },
  anchor: {
    label: 'Anchor', kind: 'effect', cost: 2, color: 0xb89a6a,
    text: 'Roots it through its next turn. On the ground: binding earth that roots whoever starts a turn on it.',
  },
  missile: {
    label: 'Magic Missile', kind: 'effect', cost: 3, color: 0xb98bff,
    text: "Form: darts of 1d4+1 that never miss, 2 per unit, 3 on one heightened target, in the part's element (typeless without one). On the ground: shoots down scarabs and totems.",
  },
  siphon: {
    label: 'Siphon', kind: 'effect', cost: 3, color: 0xe0405a,
    text: "Form: darts of 1d3 that never miss, in the part's element (corrosive without one); you heal for what they draw. On the ground: earth that drinks for you.",
  },
  explosion: {
    label: 'Explosion', kind: 'effect', cost: 4, color: 0xff8a2f,
    text: "Form: a 2d6 blast in the part's element (heat without one); one target splashes 1d6 within 2cm. On the ground: wrecks walls, totems, items and sand.",
  },
  implosion: {
    label: 'Implosion', kind: 'effect', cost: 4, color: 0xa86aff,
    text: "Form: 2d6 in the part's element (shatter without one), and everyone else within 3cm is dragged 2cm toward it. On the ground: a crushing sinkhole.",
  },
  lance: {
    label: 'Lance', kind: 'effect', cost: 3, color: 0xfff0a0,
    text: "Form: a beam of 1d8 in the part's element (light without one) through its mark and everyone on the line from the source to it.",
  },
  ricochet: {
    label: 'Ricochet', kind: 'effect', cost: 3, color: 0xd0d0ff,
    text: "Form: a bolt of 1d6 in the part's element (pierce without one) that bounces on to the nearest other foe within 4cm, twice.",
  },
  barrier: {
    label: 'Barrier', kind: 'effect', cost: 2, color: 0x8ad1ff,
    text: 'A ward: 2 less damage taken for 3 turns. A coupling on it fires each time it is struck. On the ground: a wall.',
  },
  breach: {
    label: 'Breach', kind: 'effect', cost: 2, color: 0xe0803a,
    text: 'Exposed: 2 more damage taken for 3 turns. A coupling on it fires each time it is struck. On the ground: breaks walls.',
  },
  accelerate: {
    label: 'Accelerate', kind: 'effect', cost: 2, modCost: 1, color: 0xffd166,
    text: 'As the last effect of its part: +2cm move for 3 turns, and a coupling on it fires wherever it ends a move. Before another effect it modifies: a bonus action, but weaker (x0.7).',
  },
  slow: {
    label: 'Slow', kind: 'effect', cost: 2, modCost: 0, color: 0x6a8ad8,
    text: 'As the last effect of its part: -40% move for 3 turns, and a coupling on it fires wherever it ends a move. Before another effect it modifies: the whole turn, but stronger (x1.4).',
  },
  fire: {
    label: 'Fire', kind: 'effect', cost: 2, color: 0xff6a2a,
    text: 'Element: heat. Strikes 1d6 unless a form carries it, and sets it burning. On the ground: burns away mists and scarabs.',
  },
  frost: {
    label: 'Frost', kind: 'effect', cost: 2, color: 0x9fdcff,
    text: 'Element: cold. Strikes 1d6 unless a form carries it, and chills it: a third less move for a turn. On the ground: freezes mists away; with Over Time, icy ground.',
  },
  shatter: {
    label: 'Shatter', kind: 'effect', cost: 2, color: 0xd8c8a8,
    text: 'Element: shatter. Strikes 1d6 unless a form carries it, and knocks it 1cm back. On the ground: wrecks walls and totems.',
  },
  pierce: {
    label: 'Pierce', kind: 'effect', cost: 2, color: 0xe8e8f0,
    text: 'Element: pierce. Strikes 1d6 unless a form carries it, and opens it: 1 more damage taken for its turns. On the ground: shoots down scarabs.',
  },
  water: {
    label: 'Water', kind: 'effect', cost: 2, color: 0x4aa0e0,
    text: 'Element: water. Strikes 1d6 unless a form carries it, and the tide drags it 1cm toward the source. On the ground: washes away sand, acid and blight.',
  },
  mist: {
    label: 'Mist', kind: 'effect', cost: 2, color: 0xb0c8d8,
    text: 'Wraps it in a half veil for its turns. On the ground: a pool of shadow.',
  },
  mind: {
    label: 'Mind', kind: 'effect', cost: 2, color: 0xd080e0,
    text: 'Element: sanity. Strikes 1d6 unless a form carries it; every blow of the part lands on the mind instead of the body.',
  },
  malform: {
    label: 'Malform', kind: 'effect', cost: 3, color: 0x80b070,
    text: 'Element: malforming. Strikes 1d6 unless a form carries it, and strips 1 maximum health until the fight ends.',
  },
  edge: {
    label: 'Edge', kind: 'effect', cost: 2, color: 0xc04050,
    text: 'Element: slashing. Strikes 1d6 unless a form carries it, and leaves it bleeding 1d2 for 2 turns.',
  },
  void: {
    label: 'Void', kind: 'effect', cost: 3, color: 0x6040a0,
    text: 'Element: typeless, which nothing resists. Strikes 1d6 unless a form carries it.',
  },
  blink: {
    label: 'Blink', kind: 'effect', cost: 2, color: 0xb8a8ff,
    text: 'Blinks it 3cm away from the source, through walls; on yourself, away from the nearest foe. A coupling on it fires where it lands.',
  },
  swap: {
    label: 'Swap', kind: 'effect', cost: 2, color: 0x9a88e8,
    text: 'It and you trade places. A coupling on it fires where it lands.',
  },
  infuse: {
    label: 'Infuse', kind: 'effect', cost: 1, color: 0x5a9aff,
    text: 'Restores 1d4 mana.',
  },
  manaburn: {
    label: 'Manaburn', kind: 'effect', cost: 2, color: 0x3a5ad0,
    text: 'Burns away 1d4 mana.',
  },
  mark: {
    label: 'Mark', kind: 'effect', cost: 1, color: 0xff6060,
    text: 'Marked for its turns: the next hit it takes deals 2 more, and spends the mark. A coupling on it fires when the mark is struck.',
  },
  silence: {
    label: 'Silence', kind: 'effect', cost: 2, color: 0xc0c0d0,
    text: 'Its next action other than moving fails.',
  },
  might: {
    label: 'Might', kind: 'effect', cost: 2, color: 0xffa040,
    text: 'Empowered: 1 more damage with every hit it deals for its turns.',
  },
  feeble: {
    label: 'Feeble', kind: 'effect', cost: 2, color: 0x8a7a6a,
    text: 'Sapped: 1 less damage with every hit it deals for its turns.',
  },
  single: {
    label: 'Single Target', kind: 'target', cost: 0, color: 0x7ec8b4,
    text: 'One unit, heightened (x1.5). Without any target rune you still pick one unit, at x1.',
  },
  self: {
    label: 'Self', kind: 'target', cost: 0, color: 0x7ec8b4,
    text: 'You alone, heightened (x1.5).',
  },
  aoe: {
    label: 'Area', kind: 'target', cost: 2, color: 0x7ec8b4,
    text: 'Every unit within 3cm of a point, your side included (x0.75).',
  },
  nova: {
    label: 'Nova', kind: 'target', cost: 2, color: 0x7ec8b4,
    text: 'Every other unit within 3cm of you, or of what was struck (x0.75).',
  },
  multi: {
    label: 'Multi Target', kind: 'target', cost: 2, color: 0x7ec8b4,
    text: 'The 3 nearest foes, or allies for a kind hex (x0.75).',
  },
  chain: {
    label: 'Chain', kind: 'target', cost: 2, color: 0x7ec8b4,
    text: 'Leaps from the unit you pick to the nearest one 4cm on, 3 in all, never twice (x0.75).',
  },
  battlefield: {
    label: 'Battlefield', kind: 'target', cost: 4, color: 0x7ec8b4,
    text: 'Every unit on the field, your side included (x0.35).',
  },
  seeker: {
    label: 'Seeker', kind: 'target', cost: 3, color: 0x7ec8b4,
    text: 'The most wounded foe on the field, or ally for a kind hex, wherever it is (x1.25).',
  },
  environment: {
    label: 'Environment', kind: 'target', cost: 2, color: 0x7ec8b4,
    text: 'The ground in a 3cm circle: wrecks or cleans what lies there. With Over Time the ground carries the hex. A square in any corner.',
  },
  aura: {
    label: 'Aura', kind: 'target', cost: 3, color: 0x7ec8b4,
    text: 'Like Environment, but the circle rides on a unit wherever it goes.',
  },
  bigger: {
    label: 'Bigger', kind: 'modifier', cost: 2, color: 0xc0a0f0,
    text: 'More: x1.3, wider areas, +1 turn, +1 target. +2 mana.',
  },
  smaller: {
    label: 'Smaller', kind: 'modifier', cost: -2, color: 0xc0a0f0,
    text: 'Less: x0.75, smaller areas, -1 turn, -1 target. -2 mana.',
  },
  rangeUp: {
    label: 'Increase Range', kind: 'modifier', cost: 1, color: 0xc0a0f0,
    text: '+6cm range. +1 mana.',
  },
  rangeDown: {
    label: 'Decrease Range', kind: 'modifier', cost: -1, color: 0xc0a0f0,
    text: '-4cm range. -1 mana.',
  },
  allies: {
    label: 'Only Allies', kind: 'modifier', cost: 1, color: 0xc0a0f0,
    text: 'Its part touches only your side. +1 mana.',
  },
  enemies: {
    label: 'Only Enemies', kind: 'modifier', cost: 1, color: 0xc0a0f0,
    text: 'Its part touches only the other side. +1 mana.',
  },
};

export interface RuneDef {
  /** Every drawing that reads as this rune; the first is the one the codex shows. */
  masks: number[];
  /** What the rune becomes with its seal struck. */
  inverse: Facet;
}

export const RUNES: Record<RuneId, RuneDef> = {
  heal: { masks: [shape('147', '345')], inverse: 'blight' },
  regen: { masks: [shape('047', '24')], inverse: 'wither' },
  dot: { masks: [shape('145')], inverse: 'burst' },
  wind: { masks: [shape('345', '157')], inverse: 'cyclone' },
  twist: { masks: [shape('430125')], inverse: 'anchor' },
  barrier: { masks: [shape('036', '258')], inverse: 'breach' },
  accelerate: { masks: [shape('046', '157')], inverse: 'slow' },
  corrosive: { masks: [shape('14', '648')], inverse: 'purify' },
  light: { masks: [shape('04', '14', '24')], inverse: 'shadow' },
  fire: { masks: [shape('3415')], inverse: 'frost' },
  shatter: { masks: [shape('048', '25')], inverse: 'pierce' },
  water: { masks: [shape('345', '678')], inverse: 'mist' },
  mind: { masks: [shape('3145', '3745')], inverse: 'malform' },
  edge: { masks: [shape('048')], inverse: 'void' },
  missile: { masks: [shape('642', '125')], inverse: 'siphon' },
  explosion: { masks: [shape('147', '048', '246')], inverse: 'implosion' },
  lance: { masks: [shape('345')], inverse: 'ricochet' },
  blink: { masks: [shape('2468')], inverse: 'swap' },
  infuse: { masks: [shape('1375')], inverse: 'manaburn' },
  mark: { masks: [shape('048', '246')], inverse: 'silence' },
  might: { masks: [shape('147', '678')], inverse: 'feeble' },
  single: { masks: [shape('147')], inverse: 'self' },
  aoe: { masks: [shape('15731')], inverse: 'nova' },
  multi: { masks: [shape('03', '14', '25')], inverse: 'chain' },
  battlefield: { masks: [shape('012', '678')], inverse: 'seeker' },
  environment: { masks: [shape('01430'), shape('12541'), shape('34763'), shape('45874')], inverse: 'aura' },
  bigger: { masks: [shape('315')], inverse: 'smaller' },
  rangeUp: { masks: [shape('012', '14')], inverse: 'rangeDown' },
  allies: { masks: [shape('36785')], inverse: 'enemies' },
};

export const RUNE_ORDER = Object.keys(RUNES) as RuneId[];

const BY_MASK = new Map<number, RuneId>(RUNE_ORDER.flatMap((id) => RUNES[id].masks.map((mask) => [mask, id] as const)));

/** The rune a grid's lines make, if any; the seal and the bridge do not count. */
export function readRune(mask: number): RuneId | null {
  return BY_MASK.get(mask & RUNE_LINES) ?? null;
}

// -----------------------------------------------------------------------------
//  PAPER
// -----------------------------------------------------------------------------

export type PaperKind = 'plain' | 'fine';

export const PAPERS: Record<PaperKind, { item: 'paper' | 'finePaper'; code: 'p' | 'f'; grids: number; name: string }> = {
  plain: { item: 'paper', code: 'p', grids: 3, name: 'Paper' },
  fine: { item: 'finePaper', code: 'f', grids: 5, name: 'Fine Paper' },
};

// -----------------------------------------------------------------------------
//  READING A SHEET
// -----------------------------------------------------------------------------

export interface GridReading {
  /** Strokes on the grid, seal and bridge included. */
  lines: number;
  rune: RuneId | null;
  inverted: boolean;
  /** A bridge runs from here to the next grid. */
  coupled: boolean;
  /** What the rune means here, inverted or not. */
  facet: Facet | null;
  /** How it counts in its part. */
  role: RuneKind | null;
  /** Which part of the hex it belongs to; every bridge starts a new part. */
  part: number;
}

/** One part of a hex: the first is loosed, every later one is coupled to the part before it. */
export interface HexPart {
  target: HexTarget;
  /** Effects in the order drawn. */
  effects: EffectFacet[];
  modifiers: HexModifier[];
  /** The effect whose landing sets off the next part. */
  carrier?: EffectFacet;
}

export interface HexRecipe {
  paper: PaperKind;
  grids: number[];
  parts: HexPart[];
  /** Strokes on the sheet: the mana it took to draw. */
  lines: number;
}

export interface HexReading {
  grids: GridReading[];
  recipe: HexRecipe | null;
  problem: string | null;
}

const isPace = (facet: Facet | null): boolean => facet === 'accelerate' || facet === 'slow';

/** Each grid as it reads with these chains holding: its rune, its part, and how it counts there. */
function layGrids(grids: readonly number[], runes: readonly (RuneId | null)[], bridges: readonly boolean[]): GridReading[] {
  let part = 0;
  const base = grids.map((mask, index) => {
    const rune = runes[index];
    const inverted = !!rune && !!(mask & SEAL_BIT);
    const coupled = bridges[index];
    const reading = {
      lines: lineCount(mask),
      rune,
      inverted,
      coupled,
      facet: rune ? (inverted ? RUNES[rune].inverse : rune) : null,
      part,
    };
    if (coupled) part += 1;
    return reading;
  });
  const targeted = new Set<number>();
  return base.map((grid, index) => {
    if (!grid.facet) return { ...grid, role: null };
    const followed = base.some((later, at) =>
      at > index && later.part === grid.part && !!later.facet && FACETS[later.facet].kind === 'effect' && !isPace(later.facet));
    let role: RuneKind | null = isPace(grid.facet) && followed ? 'modifier' : FACETS[grid.facet].kind;
    // Only the first target rune of a part counts.
    if (role === 'target') {
      if (targeted.has(grid.part)) role = null;
      else targeted.add(grid.part);
    }
    return { ...grid, role };
  });
}

/**
 * Read a sheet: what each grid says, and the hex they make. Whatever does not
 * hold is skipped: stray lines, a seal over no rune, a chain that couples nothing.
 * A sheet with no effect left still makes a hex; it fizzles. Only a sheet ruled
 * wrong for its paper makes none.
 */
export function readHex(paper: PaperKind, grids: readonly number[]): HexReading {
  const runes = grids.map((mask) => readRune(mask));
  const last = grids.length - 1;
  const bridges = grids.map((mask, index) => !!(mask & BRIDGE_BIT) && index < last && !!runes[index] && !!runes[index + 1]);
  let readings = layGrids(grids, runes, bridges);
  for (;;) {
    // A chain holds when an effect carries it into a part with an effect of its own.
    const broken = readings.findIndex((grid, index) => bridges[index] &&
      (grid.role !== 'effect' || !readings.some((later) => later.part === grid.part + 1 && later.role === 'effect')));
    if (broken < 0) break;
    bridges[broken] = false;
    readings = layGrids(grids, runes, bridges);
  }
  if (grids.length !== PAPERS[paper].grids || grids.some((mask) => !Number.isInteger(mask) || mask < 0 || mask > FULL_GRID)) {
    return { grids: readings, recipe: null, problem: 'That is not how this paper is ruled.' };
  }
  const parts: HexPart[] = [];
  for (let index = 0; index <= readings[last].part; index++) {
    const members = readings.filter((grid) => grid.part === index && grid.facet);
    const target = members.find((grid) => grid.role === 'target');
    const effects = members.filter((grid) => grid.role === 'effect').map((grid) => grid.facet as EffectFacet);
    let modifiers = members.filter((grid) => grid.role === 'modifier').map((grid) => grid.facet as HexModifier);
    // Only Allies and Only Enemies cancel each other out.
    if (modifiers.includes('allies') && modifiers.includes('enemies')) modifiers = modifiers.filter((mod) => mod !== 'allies' && mod !== 'enemies');
    const bridge = members.find((grid) => grid.coupled);
    parts.push({
      target: (target?.facet as TargetFacet | undefined) ?? 'touch',
      effects,
      modifiers,
      ...(bridge ? { carrier: bridge.facet as EffectFacet } : {}),
    });
  }
  return {
    grids: readings,
    recipe: { paper, grids: [...grids], parts, lines: readings.reduce((sum, grid) => sum + grid.lines, 0) },
    problem: null,
  };
}

// -----------------------------------------------------------------------------
//  WHAT A PART DOES, IN NUMBERS
// -----------------------------------------------------------------------------

const TARGET_POTENCY: Record<HexTarget, number> = {
  touch: 1, single: 1.5, self: 1.5, aoe: 0.75, nova: 0.75, multi: 0.75, chain: 0.75,
  battlefield: 0.35, seeker: 1.25, environment: 1, aura: 1,
};
const MOD_POTENCY: Partial<Record<HexModifier, number>> = { bigger: 1.3, smaller: 0.75, accelerate: 0.7, slow: 1.4 };

const countOf = <T>(list: readonly T[], value: T): number => list.filter((entry) => entry === value).length;
const modCount = (part: HexPart, mod: HexModifier): number => countOf(part.modifiers, mod);
const sizeOf = (part: HexPart): number => 1.5 ** modCount(part, 'bigger') * 0.6 ** modCount(part, 'smaller');

export const isGround = (target: HexTarget): target is 'environment' | 'aura' => target === 'environment' || target === 'aura';

/** How hard a part lands: its target and modifiers multiplied. */
export function partPotency(part: HexPart): number {
  let potency = TARGET_POTENCY[part.target];
  for (const mod of part.modifiers) potency *= MOD_POTENCY[mod] ?? 1;
  return round2(potency);
}

/** How far the hex reaches to find its mark, in px: 0 when it needs no aim, Infinity across the field. */
export function partReach(part: HexPart): number {
  if (part.target === 'self' || part.target === 'nova') return 0;
  if (part.target === 'battlefield' || part.target === 'seeker') return Infinity;
  return R(Math.max(2, 8 + 6 * modCount(part, 'rangeUp') - 4 * modCount(part, 'rangeDown')));
}

/** The radius of an area, a nova or a patch of ground, in px. */
export function partRadius(part: HexPart): number {
  return Math.max(R(1), Math.round(R(3) * sizeOf(part)));
}

/** How far a chain leaps between links, in px. */
export function partHop(part: HexPart): number {
  return Math.max(R(2), Math.round(R(4) * sizeOf(part)));
}

/** Turns its afflictions, wards and grounds last. */
export function partTurns(part: HexPart): number {
  return Math.max(1, 3 + modCount(part, 'bigger') - modCount(part, 'smaller') + modCount(part, 'slow'));
}

/** How many units Multi Target or Chain finds. */
export function partCount(part: HexPart): number {
  return Math.max(2, 3 + modCount(part, 'bigger') - modCount(part, 'smaller'));
}

/** How far a coupled Multi Target looks from the impact. */
export const IMPACT_REACH = R(6);
/** How often an impact coupling can fire in one loosing. */
export const ECHO_LIMIT = 3;

const HARMFUL: ReadonlySet<EffectFacet> = new Set<EffectFacet>([
  'blight', 'wither', 'burst', 'wind', 'cyclone', 'twist', 'anchor', 'breach', 'slow',
  'corrosive', 'light', 'shadow', 'fire', 'frost', 'shatter', 'pierce', 'water', 'mind', 'malform', 'edge', 'void',
  'missile', 'siphon', 'explosion', 'implosion', 'lance', 'ricochet', 'manaburn', 'mark', 'silence', 'feeble',
]);

/** Would the part hurt or hinder whoever it lands on? */
export function partHarmful(part: HexPart): boolean {
  if (part.effects.some((effect) => HARMFUL.has(effect))) return true;
  return part.effects.includes('dot') && !part.effects.includes('heal') && !part.effects.includes('regen');
}

export type HexSide = 'any' | 'allies' | 'enemies';

/** Whose units a part touches. Multi Target, Chain and Seeker find foes for a harmful part and friends for a kind one. */
export function partSide(part: HexPart): HexSide {
  if (part.modifiers.includes('allies')) return 'allies';
  if (part.modifiers.includes('enemies')) return 'enemies';
  if (part.target === 'multi' || part.target === 'chain' || part.target === 'seeker') return partHarmful(part) ? 'enemies' : 'allies';
  return 'any';
}

/** What an element leaves on whoever its part lands on, beside its damage. */
export type Rider = 'reveal' | 'shade' | 'burn' | 'chill' | 'knock' | 'open' | 'tide' | 'warp' | 'bleed';

export interface ElementDef {
  type: DamageType;
  rider: Rider | null;
  /** What its lingering wound is called. */
  dot: string;
}

export const ELEMENTS: Record<ElementFacet, ElementDef> = {
  corrosive: { type: 'corrosive', rider: null, dot: 'Hexed Rot' },
  light: { type: 'light', rider: 'reveal', dot: 'Searing Hex' },
  shadow: { type: 'shadow', rider: 'shade', dot: 'Festering Hex' },
  fire: { type: 'heat', rider: 'burn', dot: 'Hex Burn' },
  frost: { type: 'cold', rider: 'chill', dot: 'Hex Frostbite' },
  shatter: { type: 'shatter', rider: 'knock', dot: 'Hex Fracture' },
  pierce: { type: 'pierce', rider: 'open', dot: 'Hex Thorns' },
  water: { type: 'water', rider: 'tide', dot: 'Hex Drowning' },
  mind: { type: 'sanity', rider: null, dot: 'Hex Dread' },
  malform: { type: 'malforming', rider: 'warp', dot: 'Hex Mutation' },
  edge: { type: 'slashing', rider: 'bleed', dot: 'Hex Bleed' },
  void: { type: 'typeless', rider: null, dot: 'Hex Unmaking' },
};

/** What a form deals when no element names it. */
export const FORM_TYPE: Record<FormFacet, DamageType> = {
  missile: 'typeless', siphon: 'corrosive', explosion: 'heat', implosion: 'shatter', lance: 'light', ricochet: 'pierce',
};

export const isElement = (facet: Facet): facet is ElementFacet => Object.prototype.hasOwnProperty.call(ELEMENTS, facet);
export const isForm = (facet: Facet): facet is FormFacet => Object.prototype.hasOwnProperty.call(FORM_TYPE, facet);

/** The element that names every blow of a part: the first one drawn. */
export function partElement(part: HexPart): ElementFacet | null {
  return part.effects.find(isElement) ?? null;
}

/** The forms that carry a part's damage, each once, in the order drawn. */
export const partForms = (part: HexPart): FormFacet[] => [...new Set(part.effects.filter(isForm))];
const partElements = (part: HexPart): ElementFacet[] => [...new Set(part.effects.filter(isElement))];

/** The damage type of a part's blows: its element's, or `fallback` without one. */
export function partType(part: HexPart, fallback: DamageType): DamageType {
  const element = partElement(part);
  return element ? ELEMENTS[element].type : fallback;
}

/**
 * How a part's carrier sets off the next part: where it strikes, each time its
 * lingering wound ticks, each time its ground bites, each time the unit it
 * hastened or slowed ends a move, or each time the unit it warded, opened or
 * marked is struck.
 */
export type CouplingMode = 'impact' | 'tick' | 'ground' | 'move' | 'struck';

export function couplingMode(part: HexPart): CouplingMode | null {
  const carrier = part.carrier;
  if (!carrier) return null;
  if (isGround(part.target)) return 'ground';
  if (carrier === 'dot' || carrier === 'regen') return 'tick';
  if (carrier === 'accelerate' || carrier === 'slow') return 'move';
  if (carrier === 'barrier' || carrier === 'breach' || carrier === 'mark') return 'struck';
  const lingers = carrier === 'heal' || carrier === 'blight' || (isElement(carrier) && partForms(part).length === 0);
  return part.effects.includes('dot') && lingers ? 'tick' : 'impact';
}

// -----------------------------------------------------------------------------
//  THE WHOLE SHEET
// -----------------------------------------------------------------------------

export type HexAim = 'unit' | 'point' | 'none';

/** What the hand must choose when the hex is loosed. */
export function hexAim(recipe: HexRecipe): HexAim {
  const target = recipe.parts[0].target;
  if (target === 'touch' || target === 'single' || target === 'chain' || target === 'aura') return 'unit';
  return target === 'aoe' || target === 'environment' ? 'point' : 'none';
}

export const hexRange = (recipe: HexRecipe): number => partReach(recipe.parts[0]);
export const hexRadius = (recipe: HexRecipe): number => partRadius(recipe.parts[0]);
export const hexHarmful = (recipe: HexRecipe): boolean => partHarmful(recipe.parts[0]);
export const hexPotency = (recipe: HexRecipe): number => partPotency(recipe.parts[0]);

/** Mana it takes to loose the hex: every rune of every part. */
export function hexManaCost(recipe: HexRecipe): number {
  let cost = 0;
  for (const part of recipe.parts) {
    if (part.target !== 'touch') cost += FACETS[part.target].cost;
    for (const effect of part.effects) cost += FACETS[effect].cost;
    for (const mod of part.modifiers) cost += FACETS[mod].modCost ?? FACETS[mod].cost;
  }
  return Math.max(1, cost);
}

export type HexAction = 'main' | 'bonus' | 'full';

/** What loosing it costs: Accelerate makes it a bonus action, Slow the whole turn. */
export function hexAction(recipe: HexRecipe): HexAction {
  let pace = 0;
  for (const part of recipe.parts) pace += modCount(part, 'accelerate') - modCount(part, 'slow');
  return pace > 0 ? 'bonus' : pace < 0 ? 'full' : 'main';
}

// -----------------------------------------------------------------------------
//  WHAT IT DOES TO A UNIT
// -----------------------------------------------------------------------------

const TIERS = ['1d2', '1d3', '1d4', '1d6', '1d8', '1d10'];
const TIER_STEPS = [0.45, 0.7, 1, 1.4, 1.9];

/** A per-turn die for a lingering effect of this strength. */
export function tierSpec(power: number): string {
  let tier = 0;
  while (tier < TIER_STEPS.length && power >= TIER_STEPS[tier]) tier++;
  return TIERS[tier];
}

const dice = (count: number, sides: number): string => `${count}d${sides}`;

type StepBody =
  | { k: 'heal'; spec: string }
  | { k: 'regen'; spec: string }
  | { k: 'purify'; spec: string }
  | { k: 'hit'; spec: string; type: DamageType }
  | { k: 'dot'; name: string; spec: string; type: DamageType }
  | { k: 'noHeal' }
  | { k: 'wither'; amount: number }
  | { k: 'rider'; rider: Rider | null; element: ElementFacet }
  | { k: 'veil' }
  | { k: 'missiles'; darts: number; type: DamageType }
  | { k: 'siphon'; darts: number; type: DamageType }
  | { k: 'explosion'; spec: string; type: DamageType; splash: string | null }
  | { k: 'implosion'; spec: string; type: DamageType; cm: number }
  | { k: 'lance'; spec: string; type: DamageType }
  | { k: 'ricochet'; spec: string; type: DamageType; bounces: number }
  | { k: 'push'; cm: number }
  | { k: 'pull'; cm: number }
  | { k: 'twist'; turns: number }
  | { k: 'root' }
  | { k: 'ward'; amount: number }
  | { k: 'expose'; amount: number }
  | { k: 'haste'; cm: number }
  | { k: 'slow'; pct: number }
  | { k: 'blink'; cm: number }
  | { k: 'swap' }
  | { k: 'mana'; spec: string; gain: boolean }
  | { k: 'mark'; amount: number }
  | { k: 'silence' }
  | { k: 'might'; amount: number }
  | { k: 'burst' };

/** One thing a part does to each unit it lands on, and the effect it came from. `heal`, `hit`, `explosion` and `implosion` rolls are multiplied by the potency. */
export type HexStep = StepBody & { from: EffectFacet };

export const MISSILE_DART = '1d4+1';
export const SIPHON_DART = '1d3';
export const EXPLOSION_SPLASH_RADIUS = R(2);
export const IMPLOSION_RADIUS = R(3);
/** How far a ricochet looks for its next mark. */
export const RICOCHET_HOP = R(4);

/**
 * What a part does to each unit, in order. The grammar: the first element
 * names the damage type of every blow; with no form an element strikes on its
 * own, while a form carries the blow and the element only rides along. Every
 * element then leaves its rider. Over Time makes elements, Blight and Healing
 * linger instead; with nothing to linger it bleeds in the part's type.
 */
export function unitPlan(part: HexPart): HexStep[] {
  const p = partPotency(part);
  const n = (facet: EffectFacet): number => countOf(part.effects, facet);
  const over = n('dot') > 0;
  const element = partElement(part);
  const elements = partElements(part);
  const carried = partForms(part).length > 0;
  const type = (fallback: DamageType): DamageType => partType(part, fallback);
  const scaledBy = (facet: EffectFacet, base: number): number => Math.max(1, Math.round(base * p * n(facet)));
  const steps: HexStep[] = [];
  const add = (from: EffectFacet, body: StepBody): void => {
    steps.push({ ...body, from });
  };
  if (n('heal')) add('heal', over ? { k: 'regen', spec: tierSpec(p * n('heal')) } : { k: 'heal', spec: dice(2 * n('heal'), 4) });
  if (n('regen')) add('regen', { k: 'regen', spec: tierSpec(p * n('regen')) });
  if (n('purify')) add('purify', { k: 'purify', spec: dice(n('purify'), 4) });
  if (n('infuse')) add('infuse', { k: 'mana', spec: dice(n('infuse'), 4), gain: true });
  if (!carried) {
    for (const facet of elements) {
      const def = ELEMENTS[facet];
      add(facet, over ? { k: 'dot', name: def.dot, spec: tierSpec(p * n(facet)), type: def.type } : { k: 'hit', spec: dice(n(facet), 6), type: def.type });
    }
  }
  if (n('blight')) {
    const blow = type('shadow');
    add('blight', over ? { k: 'dot', name: 'Festering Hex', spec: tierSpec(p * n('blight')), type: blow } : { k: 'hit', spec: dice(n('blight'), 6), type: blow });
    add('blight', { k: 'noHeal' });
  }
  const lingering = n('heal') + n('regen') + n('blight') + (carried ? 0 : elements.length);
  if (over && !lingering) {
    add('dot', { k: 'dot', name: element ? ELEMENTS[element].dot : 'Hexed Wound', spec: tierSpec(p * n('dot')), type: type('slashing') });
  }
  if (n('missile')) add('missile', { k: 'missiles', darts: scaledBy('missile', 2), type: type(FORM_TYPE.missile) });
  if (n('siphon')) add('siphon', { k: 'siphon', darts: scaledBy('siphon', 2), type: type(FORM_TYPE.siphon) });
  if (n('explosion')) {
    const splashes = part.target === 'touch' || part.target === 'single' || part.target === 'self';
    add('explosion', { k: 'explosion', spec: dice(2 * n('explosion'), 6), type: type(FORM_TYPE.explosion), splash: splashes ? dice(n('explosion'), 6) : null });
  }
  if (n('implosion')) add('implosion', { k: 'implosion', spec: dice(2 * n('implosion'), 6), type: type(FORM_TYPE.implosion), cm: 2 * n('implosion') });
  if (n('lance')) add('lance', { k: 'lance', spec: dice(n('lance'), 8), type: type(FORM_TYPE.lance) });
  if (n('ricochet')) add('ricochet', { k: 'ricochet', spec: dice(n('ricochet'), 6), type: type(FORM_TYPE.ricochet), bounces: 2 * n('ricochet') });
  // Each element marks whoever the part lands on; a coupling on an element that a form carries fires here.
  for (const facet of elements) add(facet, { k: 'rider', rider: ELEMENTS[facet].rider, element: facet });
  if (n('wither')) add('wither', { k: 'wither', amount: scaledBy('wither', 2) });
  if (n('wind')) add('wind', { k: 'push', cm: scaledBy('wind', 3) });
  if (n('cyclone')) add('cyclone', { k: 'pull', cm: scaledBy('cyclone', 3) });
  if (n('twist')) add('twist', { k: 'twist', turns: n('twist') });
  if (n('blink')) add('blink', { k: 'blink', cm: scaledBy('blink', 3) });
  if (n('swap')) add('swap', { k: 'swap' });
  if (n('anchor')) add('anchor', { k: 'root' });
  if (n('mist')) add('mist', { k: 'veil' });
  if (n('manaburn')) add('manaburn', { k: 'mana', spec: dice(n('manaburn'), 4), gain: false });
  if (n('silence')) add('silence', { k: 'silence' });
  if (n('barrier')) add('barrier', { k: 'ward', amount: scaledBy('barrier', 2) });
  if (n('breach')) add('breach', { k: 'expose', amount: scaledBy('breach', 2) });
  if (n('mark')) add('mark', { k: 'mark', amount: scaledBy('mark', 2) });
  if (n('might')) add('might', { k: 'might', amount: scaledBy('might', 1) });
  if (n('feeble')) add('feeble', { k: 'might', amount: -scaledBy('feeble', 1) });
  if (n('accelerate')) add('accelerate', { k: 'haste', cm: scaledBy('accelerate', 2) });
  if (n('slow')) add('slow', { k: 'slow', pct: Math.min(0.9, round2(0.4 * p * n('slow'))) });
  // Last, so it reaps every wound laid before it.
  if (n('burst')) add('burst', { k: 'burst' });
  return steps;
}

// -----------------------------------------------------------------------------
//  WHAT IT DOES TO THE GROUND
// -----------------------------------------------------------------------------

/** What a part wrecks or cleans on the ground it is laid on. */
export type GroundClear = 'walls' | 'items' | 'totems' | 'sand' | 'shadows' | 'mists' | 'scarabs' | 'blight';

/** What the ground gives each unit that starts a turn on it while it lingers. */
export interface HexGroundSpec {
  hits: { spec: string; type: DamageType }[];
  heal?: string;
  /** Share of normal pace gained (positive) or lost (negative) for that turn. */
  pace?: number;
  /** Carried toward the centre (inward) or out of it. */
  drift?: { cm: number; inward: boolean };
  /** Turned a quarter circle around the centre. */
  spin?: boolean;
  root?: boolean;
  noHeal?: boolean;
  /** Maximum health stripped. */
  wither?: number;
  /** Whoever laid it heals for what it deals. */
  drink?: boolean;
}

export interface GroundPlan {
  wall: boolean;
  /** A pool of shadow at the centre. */
  shadow: boolean;
  /** Every hazard in the circle erupts and is spent. */
  erupt: boolean;
  clears: GroundClear[];
  zone: HexGroundSpec | null;
}

/** What each element wrecks or cleans on bare ground. */
const ELEMENT_CLEARS: Partial<Record<ElementFacet, GroundClear[]>> = {
  corrosive: ['walls', 'items', 'totems'],
  light: ['shadows'],
  fire: ['mists', 'scarabs'],
  frost: ['mists'],
  shatter: ['walls', 'totems'],
  pierce: ['scarabs'],
  water: ['sand', 'blight'],
};

const FORM_CLEARS: Partial<Record<FormFacet, GroundClear[]>> = {
  missile: ['scarabs', 'totems'],
  explosion: ['walls', 'totems', 'items', 'sand', 'scarabs'],
  lance: ['scarabs', 'totems'],
  ricochet: ['scarabs'],
};

/** Environment and Aura: without Over Time a part acts on things, with it the ground carries the part. */
export function groundPlan(part: HexPart): GroundPlan {
  const p = partPotency(part);
  const n = (facet: EffectFacet): number => countOf(part.effects, facet);
  const over = n('dot') > 0;
  const clears = new Set<GroundClear>();
  const clear = (...things: GroundClear[]): void => things.forEach((thing) => clears.add(thing));
  const hits: HexGroundSpec['hits'] = [];
  const burn = (facet: EffectFacet, type: DamageType, scale = 1): void => {
    hits.push({ spec: tierSpec(scale * p * n(facet)), type });
  };
  const forms = partForms(part);
  for (const facet of partElements(part)) {
    // A form carries the element's bite; alone the element bites with its own.
    if (over && !forms.length) burn(facet, ELEMENTS[facet].type);
    else if (!over) clear(...(ELEMENT_CLEARS[facet] ?? []));
  }
  for (const form of forms) {
    if (over || form === 'implosion' || form === 'siphon') burn(form, partType(part, FORM_TYPE[form]), form === 'explosion' ? 1.4 : 1);
    else clear(...(FORM_CLEARS[form] ?? []));
  }
  if (n('wind') && !over) clear('mists', 'sand');
  if (n('purify')) clear('blight');
  if (n('breach')) clear('walls');
  if (n('blight') && over) burn('blight', partType(part, 'shadow'));
  const healing = n('heal') + n('regen');
  if (over && !healing && !hits.length) burn('dot', partType(part, 'slashing'));
  const frost = over && n('frost') ? -0.3 : 0;
  const pace = Math.max(-0.9, Math.min(1, round2(0.5 * p * (n('accelerate') - n('slow')) + frost)));
  const drift = 2 * (n('cyclone') + n('implosion')) - (over ? 2 * n('wind') : 0);
  const zone: HexGroundSpec = { hits };
  if (healing) zone.heal = tierSpec(p * healing);
  if (pace) zone.pace = pace;
  if (drift) zone.drift = { cm: Math.abs(drift), inward: drift > 0 };
  if (n('twist')) zone.spin = true;
  if (n('anchor')) zone.root = true;
  if (n('blight')) zone.noHeal = true;
  const wither = n('wither') * 2 + (over ? n('malform') : 0);
  if (wither) zone.wither = Math.max(1, Math.round((p * wither) / 2));
  if (n('siphon')) zone.drink = true;
  const lingers = hits.length > 0 || !!(zone.heal || zone.pace || zone.drift || zone.spin || zone.root || zone.noHeal || zone.wither);
  return {
    wall: n('barrier') > 0,
    shadow: n('mist') > 0 || (n('shadow') > 0 && !over),
    erupt: n('burst') > 0,
    clears: [...clears],
    zone: lingers ? zone : null,
  };
}

// -----------------------------------------------------------------------------
//  WORDS FOR IT
// -----------------------------------------------------------------------------

const ACTION_TEXT: Record<HexAction, string> = { main: 'Main action', bonus: 'Bonus action', full: 'Main and bonus action' };
const SIDE_UNIT: Record<HexSide, [string, string]> = { any: ['unit', 'units'], allies: ['ally', 'allies'], enemies: ['foe', 'foes'] };
const CLEAR_TEXT: Record<GroundClear, string> = {
  walls: 'walls',
  items: 'dropped items',
  totems: 'totems',
  sand: 'sand',
  shadows: 'shadows',
  mists: 'mists and hazards',
  scarabs: 'scarabs',
  blight: 'curses, blight, acid and hazards',
};

const cm = (px: number): number => Math.round((px / RANGE_UNIT) * 10) / 10;
const rangeWord = (px: number): string => cm(px) <= 4 ? 'Short range' : cm(px) <= 8 ? 'Medium range' : 'Long range';
const sizeWord = (px: number): string => cm(px) <= 2 ? 'small' : cm(px) <= 4 ? 'medium' : 'large';
const strengthWord = (spec: string): string => {
  const sides = Number(spec.split('d')[1]);
  return sides <= 3 ? 'small' : sides <= 6 ? 'moderate' : 'strong';
};
const times = (p: number): string => (p === 1 ? '' : ` x${p}`);
const listed = (parts: readonly string[]): string =>
  parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

/** "Fire Magic Missile + Wind (Area)": a part's effects, elements naming the forms that carry them, and where it lands. */
export function partLabel(part: HexPart): string {
  const unique = [...new Set(part.effects)];
  const forms = partForms(part);
  const elements = forms.length ? partElements(part).map((facet) => FACETS[facet].label).join(' ') : '';
  const labels = unique
    .filter((effect) => !(forms.length && isElement(effect)))
    .map((effect) => (elements && effect === forms[0] ? `${elements} ${FACETS[effect].label}` : FACETS[effect].label));
  const effects = labels.join(' + ') || 'Nothing';
  return part.target === 'touch' ? effects : `${effects} (${FACETS[part.target].label})`;
}

export function hexName(recipe: HexRecipe): string {
  return `${recipe.paper === 'fine' ? 'Fine ' : ''}Hex Sheet: ${recipe.parts.map(partLabel).join(' \u00bb ')}`;
}

/** Where a part lands, in words; a coupled part lands around what its carrier struck. */
function targetLine(part: HexPart, coupled: boolean): string {
  const [unit, units] = SIDE_UNIT[partSide(part)];
  const reach = rangeWord(partReach(part));
  const radius = sizeWord(partRadius(part));
  const p = partPotency(part);
  const potency = p === 1 ? '' : ` (x${p})`;
  const lines: Record<HexTarget, string> = {
    touch: coupled ? 'The unit struck.' : `${reach}, one unit.`,
    single: coupled ? 'The unit struck, heightened.' : `${reach}, one ${unit}, heightened.`,
    self: 'You alone, heightened.',
    aoe: coupled ? `Every ${unit} in a ${radius} area around the impact.` : `${reach}, every ${unit} in a ${radius} area.`,
    nova: coupled ? `Every other ${unit} in a ${radius} area around the one struck.` : `Every other ${unit} in a ${radius} area around you.`,
    multi: coupled
      ? `The ${partCount(part)} ${units} nearest the impact, other than the one struck.`
      : `${reach}, the ${partCount(part)} nearest ${units}.`,
    chain: coupled
      ? `Leaps from the one struck to the nearest ${unit} a ${rangeWord(partHop(part)).toLowerCase()} away, ${partCount(part)} times.`
      : `${reach}, one ${unit}, then the nearest ${unit} a ${rangeWord(partHop(part)).toLowerCase()} away, ${partCount(part)} in all.`,
    battlefield: `Every ${unit} on the field.`,
    seeker: `The most wounded ${unit} on the field, heightened.`,
    environment: coupled ? `A ${radius} area of ground around the impact.` : `${reach}, a ${radius} area of ground.`,
    aura: coupled ? `A ${radius} aura riding on the one struck.` : `${reach}, a ${radius} aura riding on a unit.`,
  };
  return `${lines[part.target]}${potency}`;
}

function riderLine(rider: Rider, source: string, turns: number): string {
  switch (rider) {
    case 'reveal': return 'Tears veils away.';
    case 'shade': return 'You slip into a half veil for a turn.';
    case 'burn': return 'Set burning.';
    case 'chill': return 'Chilled: a third less move for a turn.';
    case 'knock': return `Knocked 1cm away from ${source}.`;
    case 'open': return `Opened: 1 more damage taken for ${turns} turns.`;
    case 'tide': return `The tide drags it 1cm toward ${source}.`;
    case 'warp': return 'Loses 1 maximum health until the fight ends.';
    case 'bleed': return 'Bleeds 1d2 slashing at the start of its next 2 turns.';
  }
}

function stepLine(part: HexPart, step: HexStep, coupled: boolean): string | null {
  const p = partPotency(part);
  const turns = partTurns(part);
  const self = part.target === 'self';
  const source = coupled ? 'the impact' : part.target === 'aoe' ? 'the centre' : 'you';
  switch (step.k) {
    case 'heal': return `Heals ${step.spec}${times(p)}.`;
    case 'regen': return `Apply ${turns} rounds of ${strengthWord(step.spec)} regen.`;
    case 'purify': return `Strips its afflictions and heals ${step.spec}${times(p)}.`;
    case 'hit': return `${step.spec}${times(p)} ${step.type}.`;
    case 'dot': return `${step.name}: ${turns} rounds of ${strengthWord(step.spec)} ${step.type} damage.`;
    case 'noHeal': return `Nothing can heal it for ${turns} turns.`;
    case 'wither': return `Loses ${step.amount} maximum health until the fight ends.`;
    case 'rider': return step.rider ? riderLine(step.rider, source, turns) : null;
    case 'veil': return `Hidden in a half veil for ${turns} turns.`;
    case 'missiles': return `${step.darts} dart${step.darts === 1 ? '' : 's'} of ${MISSILE_DART} ${step.type}, never missing.`;
    case 'siphon': return `${step.darts} siphon${step.darts === 1 ? '' : 's'} of ${SIPHON_DART} ${step.type}, never missing; you heal for what they draw.`;
    case 'explosion':
      return self
        ? `Bursts around you: everyone else within 2cm takes ${step.splash}${times(p)} ${step.type}.`
        : `${step.spec}${times(p)} ${step.type} blast${step.splash ? `; everyone else within 2cm takes ${step.splash}${times(p)}` : ''}.`;
    case 'implosion': return `${step.spec}${times(p)} ${step.type}; everyone else within 3cm is dragged ${step.cm}cm toward it.`;
    case 'lance': return `A ${step.spec}${times(p)} ${step.type} beam through it and everyone on the line from ${source}.`;
    case 'ricochet': return `A ${step.spec}${times(p)} ${step.type} bolt that bounces on to the nearest foe within 4cm, ${step.bounces} times.`;
    case 'push':
      return self ? `Carries you ${step.cm}cm away from the nearest foe.` : `Shoved ${step.cm}cm away from ${source}; a wall or the edge slams for 2d6.`;
    case 'pull':
      return self ? `Carries you ${step.cm}cm toward the nearest foe.` : `Dragged ${step.cm}cm toward ${source}.`;
    case 'twist': {
      const turn = step.turns === 1 ? 'a quarter circle' : `${step.turns} quarter circles`;
      return self ? `Turns you ${turn} around the nearest foe.` : `Turned ${turn} around ${source}; a wall slams for 2d6.`;
    }
    case 'blink': return self ? `You blink ${step.cm}cm away from the nearest foe.` : `Blinks ${step.cm}cm away from ${source}, through walls.`;
    case 'swap': return self ? 'Nothing to trade places with.' : 'It and you trade places.';
    case 'root': return 'Rooted through its next turn.';
    case 'ward': return `Ward: ${step.amount} less damage taken for ${turns} turns.`;
    case 'expose': return `Exposed: ${step.amount} more damage taken for ${turns} turns.`;
    case 'mark': return `Marked for ${turns} turns: the next hit it takes deals ${step.amount} more.`;
    case 'silence': return 'Its next action other than moving fails.';
    case 'might':
      return step.amount > 0
        ? `Empowered: ${step.amount} more damage with every hit for ${turns} turns.`
        : `Sapped: ${-step.amount} less damage with every hit for ${turns} turns.`;
    case 'mana': return step.gain ? `Restores ${step.spec}${times(p)} mana.` : `Burns away ${step.spec}${times(p)} mana.`;
    case 'haste': return `+${step.cm}cm move for ${turns} turns.`;
    case 'slow': return `-${Math.round(step.pct * 100)}% move for ${turns} turns.`;
    case 'burst': return 'Every lingering wound on it lands at once.';
  }
}

function zoneLine(part: HexPart, zone: HexGroundSpec): string {
  const effects = zone.hits.map((hit) => `takes ${hit.spec} ${hit.type}`);
  if (zone.heal) effects.push(`heals ${zone.heal}`);
  if (zone.wither) effects.push(`loses ${zone.wither} maximum health`);
  if (zone.noHeal) effects.push('cannot be healed');
  if (zone.root) effects.push('is rooted');
  if (zone.spin) effects.push('is turned a quarter circle around the centre');
  if (zone.pace) effects.push(zone.pace > 0 ? `moves ${Math.round(zone.pace * 100)}% further` : `moves ${Math.round(-zone.pace * 100)}% slower`);
  if (zone.drift) effects.push(zone.drift.inward ? `is drawn ${zone.drift.cm}cm toward the centre` : `is blown ${zone.drift.cm}cm out`);
  const side = partSide(part);
  const who = side === 'any' ? 'whoever' : side === 'allies' ? 'any ally that' : 'any foe that';
  return `For ${partTurns(part)} rounds ${who} starts a turn inside ${listed(effects)}${zone.drink ? ', and you drink what it deals' : ''}.`;
}

function groundLines(part: HexPart): string[] {
  const plan = groundPlan(part);
  const lines: string[] = [];
  if (plan.erupt) lines.push('Every hazard in the circle erupts: whoever stands in one takes all it had left to give, and it is spent.');
  if (plan.clears.length) lines.push(`Wrecks or cleans away ${listed(plan.clears.map((thing) => CLEAR_TEXT[thing]))} there.`);
  if (plan.wall) lines.push(`Raises a ${cm(partRadius(part) * 2)}cm wall across it for ${partTurns(part)} rounds.`);
  if (plan.shadow) lines.push(`Leaves a pool of shadow for ${partTurns(part)} rounds.`);
  if (plan.zone) lines.push(zoneLine(part, plan.zone));
  return lines;
}

/** How part `index` is set off by the part before it; unnamed, it keeps quiet about which rune carries it. */
export function couplingLine(recipe: HexRecipe, index: number, named = true): string {
  const before = recipe.parts[index - 1];
  const coupled = named && before.carrier ? `Coupled to ${FACETS[before.carrier].label}` : 'Coupled';
  switch (couplingMode(before)) {
    case 'tick': return `${coupled}: each time it ticks,`;
    case 'ground': return groundPlan(before).zone ? 'Coupled to the ground: each time it bites someone,' : 'Coupled to the ground: once, at its heart,';
    case 'move': return `${coupled}: wherever it ends a move, ${ECHO_LIMIT} times at most,`;
    case 'struck': return before.carrier === 'mark' ? `${coupled}: when the mark is struck,` : `${coupled}: each time it is struck, ${ECHO_LIMIT} times at most,`;
    default: return `${coupled}: wherever it lands, ${ECHO_LIMIT} times at most,`;
  }
}

/** How the part's runes combine: which element names its blows and what carries them. */
function grammarLine(part: HexPart): string | null {
  const element = partElement(part);
  const forms = partForms(part);
  if (!element) return null;
  const type = ELEMENTS[element].type;
  if (!forms.length) return `${FACETS[element].label}: every blow is ${type}.`;
  return `${FACETS[element].label} rides the ${listed(forms.map((form) => FACETS[form].label))}: every blow is ${type}.`;
}

/** The rules of one part, a sentence at a time. */
export function partLines(recipe: HexRecipe, index: number): string[] {
  const part = recipe.parts[index];
  const coupled = index > 0;
  const lines = [targetLine(part, coupled)];
  if (part.effects.length === 0) return [...lines, 'It holds no effect: it fizzles.'];
  const grammar = grammarLine(part);
  if (grammar) lines.push(grammar);
  if (isGround(part.target)) return [...lines, ...groundLines(part)];
  return [...lines, ...unitPlan(part).flatMap((step) => stepLine(part, step, coupled) ?? [])];
}

/** The rules of a whole hex, a sentence at a time. */
export function hexLines(recipe: HexRecipe, named = true): string[] {
  const lines = [`${ACTION_TEXT[hexAction(recipe)]}, ${hexManaCost(recipe)} mana.`];
  recipe.parts.forEach((_, index) => {
    if (index > 0) lines.push(couplingLine(recipe, index, named));
    lines.push(...partLines(recipe, index));
  });
  return lines;
}

/** The ground's own tooltip once it is laid. */
export function groundText(part: HexPart, zone: HexGroundSpec): string {
  return zoneLine(part, zone);
}
