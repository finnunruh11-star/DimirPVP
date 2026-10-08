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
  | 'heal' | 'regen' | 'dot' | 'wind' | 'corrosive' | 'light'
  | 'twist' | 'missile' | 'explosion' | 'barrier' | 'accelerate' | 'slow';
export type TargetRune = 'single' | 'aoe' | 'multi' | 'battlefield' | 'environment';
export type ModifierRune = 'bigger' | 'smaller' | 'rangeUp' | 'rangeDown' | 'allies' | 'enemies';
export type RuneId = EffectRune | TargetRune | ModifierRune;
export type RuneKind = 'effect' | 'target' | 'modifier';

/** What an effect rune does on this sheet: itself, or its inversion. */
export type EffectFacet =
  | EffectRune
  | 'blight' | 'wither' | 'burst' | 'cyclone' | 'purify' | 'gloom' | 'anchor' | 'siphon' | 'implosion' | 'breach';
export type TargetFacet = TargetRune | 'self' | 'nova' | 'chain' | 'seeker' | 'aura';
export type Facet = EffectFacet | TargetFacet | ModifierRune;
/** Where a part of the hex lands. A part with no target rune touches one unit: the one you pick, or the one struck. */
export type HexTarget = TargetFacet | 'touch';
/** Accelerate and Slow modify their part when another effect follows them. */
export type HexModifier = ModifierRune | 'accelerate' | 'slow';

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
    text: '1d6 shadow, and nothing can heal it for 3 turns. On the ground: festering earth where nothing heals.',
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
    text: 'Corrosion, Light, Blight and Healing work over 3 turns instead of at once; alone it bleeds. On the ground the hex lingers. A coupling on it fires every tick.',
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
    text: '1d6 corrosive. On the ground: melts walls, dropped items and totems.',
  },
  purify: {
    label: 'Purify', kind: 'effect', cost: 2, color: 0xe6fff2,
    text: 'Strips rot, roots, stuns, slows and curses, then heals 1d4. On the ground: cleans away curses, acid and hazards.',
  },
  light: {
    label: 'Light', kind: 'effect', cost: 2, color: 0xf3e9a0,
    text: '1d6 light and tears veils away. On the ground: burns shadows off.',
  },
  gloom: {
    label: 'Gloom', kind: 'effect', cost: 2, color: 0x7a5ac8,
    text: 'Wraps it in a half veil for 3 turns. On the ground: a pool of shadow.',
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
    text: 'Darts of 1d4+1 that never miss, 2 per unit, 3 on one heightened target. On the ground: shoots down scarabs and totems.',
  },
  siphon: {
    label: 'Siphon', kind: 'effect', cost: 3, color: 0xe0405a,
    text: 'Darts of 1d3 that never miss; you heal for what they draw. On the ground: earth that drinks for you.',
  },
  explosion: {
    label: 'Explosion', kind: 'effect', cost: 4, color: 0xff8a2f,
    text: "2d6 heat (or the hex's element); one target splashes 1d6 within 2cm. On the ground: wrecks walls, totems, items and sand.",
  },
  implosion: {
    label: 'Implosion', kind: 'effect', cost: 4, color: 0xa86aff,
    text: '2d6 shatter, and everyone else within 3cm is dragged 2cm toward it. On the ground: a crushing sinkhole.',
  },
  barrier: {
    label: 'Barrier', kind: 'effect', cost: 2, color: 0x8ad1ff,
    text: 'A ward: 2 less damage taken for 3 turns. On the ground: a wall.',
  },
  breach: {
    label: 'Breach', kind: 'effect', cost: 2, color: 0xe0803a,
    text: 'Exposed: 2 more damage taken for 3 turns. On the ground: breaks walls.',
  },
  accelerate: {
    label: 'Accelerate', kind: 'effect', cost: 2, modCost: 1, color: 0xffd166,
    text: 'As the last effect of its part: +2cm move for 3 turns. Before another effect it modifies: a bonus action, but weaker (x0.7).',
  },
  slow: {
    label: 'Slow', kind: 'effect', cost: 2, modCost: 0, color: 0x6a8ad8,
    text: 'As the last effect of its part: -40% move for 3 turns. Before another effect it modifies: the whole turn, but stronger (x1.4).',
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
  corrosive: { masks: [shape('14', '648')], inverse: 'purify' },
  light: { masks: [shape('04', '14', '24')], inverse: 'gloom' },
  twist: { masks: [shape('430125')], inverse: 'anchor' },
  missile: { masks: [shape('642', '125')], inverse: 'siphon' },
  explosion: { masks: [shape('147', '048', '246')], inverse: 'implosion' },
  barrier: { masks: [shape('036', '258')], inverse: 'breach' },
  accelerate: { masks: [shape('046', '157')], inverse: 'slow' },
  slow: { masks: [shape('248', '137')], inverse: 'accelerate' },
  single: { masks: [shape('147')], inverse: 'self' },
  aoe: { masks: [shape('15731')], inverse: 'nova' },
  multi: { masks: [shape('03', '14', '25')], inverse: 'chain' },
  battlefield: { masks: [shape('012', '678')], inverse: 'seeker' },
  environment: { masks: [shape('01430'), shape('12541'), shape('34763'), shape('45874')], inverse: 'aura' },
  bigger: { masks: [shape('315')], inverse: 'smaller' },
  smaller: { masks: [shape('375')], inverse: 'bigger' },
  rangeUp: { masks: [shape('012', '14')], inverse: 'rangeDown' },
  rangeDown: { masks: [shape('678', '47')], inverse: 'rangeUp' },
  allies: { masks: [shape('36785')], inverse: 'enemies' },
  enemies: { masks: [shape('048', '246')], inverse: 'allies' },
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

/** Read a sheet: what each grid says, and the hex they make, or why they make none. */
export function readHex(paper: PaperKind, grids: readonly number[]): HexReading {
  let part = 0;
  const base = grids.map((mask) => {
    const rune = readRune(mask);
    const inverted = !!(mask & SEAL_BIT);
    const coupled = !!(mask & BRIDGE_BIT);
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
  const readings: GridReading[] = base.map((grid, index) => {
    if (!grid.facet) return { ...grid, role: null };
    const followed = base.some((later, at) =>
      at > index && later.part === grid.part && !!later.facet && FACETS[later.facet].kind === 'effect' && !isPace(later.facet));
    return { ...grid, role: isPace(grid.facet) && followed ? 'modifier' : FACETS[grid.facet].kind };
  });
  const fail = (problem: string): HexReading => ({ grids: readings, recipe: null, problem });
  if (grids.length !== PAPERS[paper].grids || grids.some((mask) => !Number.isInteger(mask) || mask < 0 || mask > FULL_GRID)) {
    return fail('That is not how this paper is ruled.');
  }
  for (const [index, grid] of readings.entries()) {
    const at = `Grid ${index + 1}`;
    if ((grids[index] & RUNE_LINES) && !grid.rune) return fail(`${at} holds no rune.`);
    if (grid.inverted && !grid.rune) return fail(`${at}: the seal has no rune to turn.`);
    if (!grid.coupled) continue;
    if (index === grids.length - 1 || !readings[index + 1].rune) return fail(`${at}: a coupling needs a rune on both sides.`);
    if (grid.role !== 'effect') return fail(`${at}: only an effect rune can carry a coupling.`);
  }
  const parts: HexPart[] = [];
  for (let index = 0; index <= part; index++) {
    const members = readings.filter((grid) => grid.part === index && grid.facet);
    const targets = members.filter((grid) => grid.role === 'target');
    const effects = members.filter((grid) => grid.role === 'effect').map((grid) => grid.facet as EffectFacet);
    const modifiers = members.filter((grid) => grid.role === 'modifier').map((grid) => grid.facet as HexModifier);
    const where = index === 0 ? 'The hex' : `Coupled part ${index}`;
    if (targets.length > 1) return fail(`${where} has more than one target rune.`);
    if (effects.length === 0) return fail(`${where} needs an effect rune.`);
    if (modifiers.includes('allies') && modifiers.includes('enemies')) return fail(`${where}: Only Allies and Only Enemies cancel each other out.`);
    const bridge = members.find((grid) => grid.coupled);
    parts.push({
      target: (targets[0]?.facet as TargetFacet | undefined) ?? 'touch',
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

const HARMFUL: ReadonlySet<EffectFacet> = new Set([
  'blight', 'wither', 'burst', 'wind', 'cyclone', 'corrosive', 'light', 'twist', 'anchor',
  'missile', 'siphon', 'explosion', 'implosion', 'breach', 'slow',
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

/** The element a part's missiles, siphons and blasts carry. */
function partElement(part: HexPart): DamageType | null {
  if (part.effects.includes('corrosive')) return 'corrosive';
  if (part.effects.includes('light')) return 'light';
  if (part.effects.includes('blight')) return 'shadow';
  return null;
}

/** How a part's carrier sets off the next part: where it strikes, each time its lingering wound ticks, or each time its ground bites. */
export type CouplingMode = 'impact' | 'tick' | 'ground';

const LINGERS: ReadonlySet<EffectFacet> = new Set(['heal', 'blight', 'corrosive', 'light']);

export function couplingMode(part: HexPart): CouplingMode | null {
  if (!part.carrier) return null;
  if (isGround(part.target)) return 'ground';
  if (part.carrier === 'dot' || part.carrier === 'regen') return 'tick';
  return part.effects.includes('dot') && LINGERS.has(part.carrier) ? 'tick' : 'impact';
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
  | { k: 'reveal' }
  | { k: 'veil' }
  | { k: 'missiles'; darts: number; type: DamageType }
  | { k: 'siphon'; darts: number; type: DamageType }
  | { k: 'explosion'; spec: string; type: DamageType; splash: string | null }
  | { k: 'implosion'; spec: string; cm: number }
  | { k: 'push'; cm: number }
  | { k: 'pull'; cm: number }
  | { k: 'twist'; turns: number }
  | { k: 'root' }
  | { k: 'ward'; amount: number }
  | { k: 'expose'; amount: number }
  | { k: 'haste'; cm: number }
  | { k: 'slow'; pct: number }
  | { k: 'burst' };

/** One thing a part does to each unit it lands on, and the effect it came from. `heal`, `hit`, `explosion` and `implosion` rolls are multiplied by the potency. */
export type HexStep = StepBody & { from: EffectFacet };

export const MISSILE_DART = '1d4+1';
export const SIPHON_DART = '1d3';
export const EXPLOSION_SPLASH_RADIUS = R(2);
export const IMPLOSION_RADIUS = R(3);

export function unitPlan(part: HexPart): HexStep[] {
  const p = partPotency(part);
  const n = (facet: EffectFacet): number => countOf(part.effects, facet);
  const over = n('dot') > 0;
  const element = partElement(part);
  const steps: HexStep[] = [];
  const add = (from: EffectFacet, body: StepBody): void => {
    steps.push({ ...body, from });
  };
  if (n('heal')) add('heal', over ? { k: 'regen', spec: tierSpec(p * n('heal')) } : { k: 'heal', spec: dice(2 * n('heal'), 4) });
  if (n('regen')) add('regen', { k: 'regen', spec: tierSpec(p * n('regen')) });
  if (n('purify')) add('purify', { k: 'purify', spec: dice(n('purify'), 4) });
  const elements = [
    ['corrosive', 'corrosive', 'Hexed Rot'],
    ['light', 'light', 'Searing Hex'],
    ['blight', 'shadow', 'Festering Hex'],
  ] as const;
  for (const [facet, type, name] of elements) {
    if (!n(facet)) continue;
    add(facet, over ? { k: 'dot', name, spec: tierSpec(p * n(facet)), type } : { k: 'hit', spec: dice(n(facet), 6), type });
  }
  if (n('blight')) add('blight', { k: 'noHeal' });
  if (n('light')) add('light', { k: 'reveal' });
  if (over && !n('heal') && !n('regen') && !n('corrosive') && !n('light') && !n('blight')) {
    add('dot', { k: 'dot', name: 'Hexed Wound', spec: tierSpec(p * n('dot')), type: 'slashing' });
  }
  if (n('wither')) add('wither', { k: 'wither', amount: Math.max(1, Math.round(2 * p * n('wither'))) });
  if (n('missile')) add('missile', { k: 'missiles', darts: Math.max(1, Math.round(2 * p * n('missile'))), type: element ?? 'typeless' });
  if (n('siphon')) add('siphon', { k: 'siphon', darts: Math.max(1, Math.round(2 * p * n('siphon'))), type: element ?? 'corrosive' });
  if (n('explosion')) {
    const splashes = part.target === 'touch' || part.target === 'single' || part.target === 'self';
    add('explosion', { k: 'explosion', spec: dice(2 * n('explosion'), 6), type: element ?? 'heat', splash: splashes ? dice(n('explosion'), 6) : null });
  }
  if (n('implosion')) add('implosion', { k: 'implosion', spec: dice(2 * n('implosion'), 6), cm: 2 * n('implosion') });
  if (n('wind')) add('wind', { k: 'push', cm: Math.max(1, Math.round(3 * p * n('wind'))) });
  if (n('cyclone')) add('cyclone', { k: 'pull', cm: Math.max(1, Math.round(3 * p * n('cyclone'))) });
  if (n('twist')) add('twist', { k: 'twist', turns: n('twist') });
  if (n('anchor')) add('anchor', { k: 'root' });
  if (n('gloom')) add('gloom', { k: 'veil' });
  if (n('barrier')) add('barrier', { k: 'ward', amount: Math.max(1, Math.round(2 * p * n('barrier'))) });
  if (n('breach')) add('breach', { k: 'expose', amount: Math.max(1, Math.round(2 * p * n('breach'))) });
  if (n('accelerate')) add('accelerate', { k: 'haste', cm: Math.max(1, Math.round(2 * p * n('accelerate'))) });
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
  const element = partElement(part);
  if (n('corrosive')) {
    if (over) burn('corrosive', 'corrosive');
    else clear('walls', 'items', 'totems');
  }
  if (n('light')) {
    if (over) burn('light', 'light');
    else clear('shadows');
  }
  if (n('missile')) {
    if (over) burn('missile', 'typeless');
    else clear('scarabs', 'totems');
  }
  if (n('explosion')) {
    if (over) burn('explosion', element ?? 'heat', 1.4);
    else clear('walls', 'totems', 'items', 'sand', 'scarabs');
  }
  if (n('wind') && !over) clear('mists', 'sand');
  if (n('purify')) clear('blight');
  if (n('breach')) clear('walls');
  if (n('blight') && over) burn('blight', 'shadow');
  if (n('implosion')) burn('implosion', 'shatter');
  if (n('siphon')) burn('siphon', element ?? 'corrosive');
  const healing = n('heal') + n('regen');
  const wounds = ['corrosive', 'light', 'missile', 'explosion', 'blight', 'implosion', 'siphon'] as const;
  if (over && !healing && wounds.every((facet) => !n(facet))) burn('dot', 'slashing');
  const pace = Math.max(-0.9, Math.min(1, round2(0.5 * p * (n('accelerate') - n('slow')))));
  const drift = 2 * (n('cyclone') + n('implosion')) - (over ? 2 * n('wind') : 0);
  const zone: HexGroundSpec = { hits };
  if (healing) zone.heal = tierSpec(p * healing);
  if (pace) zone.pace = pace;
  if (drift) zone.drift = { cm: Math.abs(drift), inward: drift > 0 };
  if (n('twist')) zone.spin = true;
  if (n('anchor')) zone.root = true;
  if (n('blight')) zone.noHeal = true;
  if (n('wither')) zone.wither = Math.max(1, Math.round(p * n('wither')));
  if (n('siphon')) zone.drink = true;
  const lingers = hits.length > 0 || !!(zone.heal || zone.pace || zone.drift || zone.spin || zone.root || zone.noHeal || zone.wither);
  return {
    wall: n('barrier') > 0,
    shadow: n('gloom') > 0,
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
const times = (p: number): string => (p === 1 ? '' : ` x${p}`);
const listed = (parts: readonly string[]): string =>
  parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

/** "Magic Missile + Wind (Area)": a part's effects, and where it lands. */
export function partLabel(part: HexPart): string {
  const effects = [...new Set(part.effects)].map((effect) => FACETS[effect].label).join(' + ');
  return part.target === 'touch' ? effects : `${effects} (${FACETS[part.target].label})`;
}

export function hexName(recipe: HexRecipe): string {
  return `${recipe.paper === 'fine' ? 'Fine ' : ''}Hexzettel: ${recipe.parts.map(partLabel).join(' \u00bb ')}`;
}

/** Where a part lands, in words; a coupled part lands around what its carrier struck. */
function targetLine(part: HexPart, coupled: boolean): string {
  const [unit, units] = SIDE_UNIT[partSide(part)];
  const reach = cm(partReach(part));
  const radius = cm(partRadius(part));
  const p = partPotency(part);
  const potency = p === 1 ? '' : ` (x${p})`;
  const lines: Record<HexTarget, string> = {
    touch: coupled ? 'The unit struck.' : `One unit within ${reach}cm.`,
    single: coupled ? 'The unit struck, heightened.' : `One ${unit} within ${reach}cm, heightened.`,
    self: 'You alone, heightened.',
    aoe: coupled ? `Every ${unit} within ${radius}cm of the impact.` : `Every ${unit} within ${radius}cm of a point within ${reach}cm.`,
    nova: coupled ? `Every other ${unit} within ${radius}cm of the one struck.` : `Every other ${unit} within ${radius}cm of you.`,
    multi: coupled
      ? `The ${partCount(part)} ${units} nearest the impact, other than the one struck.`
      : `The ${partCount(part)} nearest ${units} within ${reach}cm.`,
    chain: coupled
      ? `Leaps from the one struck to the nearest ${unit} ${cm(partHop(part))}cm on, ${partCount(part)} times.`
      : `One ${unit} within ${reach}cm, then the nearest ${unit} ${cm(partHop(part))}cm on from it, ${partCount(part)} in all.`,
    battlefield: `Every ${unit} on the field.`,
    seeker: `The most wounded ${unit} on the field, heightened.`,
    environment: coupled ? `The ground, ${radius}cm around the impact.` : `The ground, ${radius}cm around a point within ${reach}cm.`,
    aura: coupled ? `A ${radius}cm circle riding on the one struck.` : `A ${radius}cm circle riding on a unit within ${reach}cm.`,
  };
  return `${lines[part.target]}${potency}`;
}

function stepLine(part: HexPart, step: HexStep, coupled: boolean): string {
  const p = partPotency(part);
  const turns = partTurns(part);
  const self = part.target === 'self';
  const source = coupled ? 'the impact' : part.target === 'aoe' ? 'the centre' : 'you';
  switch (step.k) {
    case 'heal': return `Heals ${step.spec}${times(p)}.`;
    case 'regen': return `Regenerates ${step.spec} at the start of each of its next ${turns} turns.`;
    case 'purify': return `Strips its afflictions and heals ${step.spec}${times(p)}.`;
    case 'hit': return `${step.spec}${times(p)} ${step.type}.`;
    case 'dot': return `${step.name}: ${step.spec} ${step.type} at the start of each of its next ${turns} turns.`;
    case 'noHeal': return `Nothing can heal it for ${turns} turns.`;
    case 'wither': return `Loses ${step.amount} maximum health until the fight ends.`;
    case 'reveal': return 'Tears veils away.';
    case 'veil': return `Hidden in a half veil for ${turns} turns.`;
    case 'missiles': return `${step.darts} dart${step.darts === 1 ? '' : 's'} of ${MISSILE_DART} ${step.type}, never missing.`;
    case 'siphon': return `${step.darts} siphon${step.darts === 1 ? '' : 's'} of ${SIPHON_DART} ${step.type}, never missing; you heal for what they draw.`;
    case 'explosion':
      return self
        ? `Bursts around you: everyone else within 2cm takes ${step.splash}${times(p)} ${step.type}.`
        : `${step.spec}${times(p)} ${step.type} blast${step.splash ? `; everyone else within 2cm takes ${step.splash}${times(p)}` : ''}.`;
    case 'implosion': return `${step.spec}${times(p)} shatter; everyone else within 3cm is dragged ${step.cm}cm toward it.`;
    case 'push':
      return self ? `Carries you ${step.cm}cm away from the nearest foe.` : `Shoved ${step.cm}cm away from ${source}; a wall or the edge slams for 2d6.`;
    case 'pull':
      return self ? `Carries you ${step.cm}cm toward the nearest foe.` : `Dragged ${step.cm}cm toward ${source}.`;
    case 'twist': {
      const turn = step.turns === 1 ? 'a quarter circle' : `${step.turns} quarter circles`;
      return self ? `Turns you ${turn} around the nearest foe.` : `Turned ${turn} around ${source}; a wall slams for 2d6.`;
    }
    case 'root': return 'Rooted through its next turn.';
    case 'ward': return `Ward: ${step.amount} less damage taken for ${turns} turns.`;
    case 'expose': return `Exposed: ${step.amount} more damage taken for ${turns} turns.`;
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

/** How part `index` is set off by the part before it. */
export function couplingLine(recipe: HexRecipe, index: number): string {
  const before = recipe.parts[index - 1];
  const carrier = before.carrier ? FACETS[before.carrier].label : 'it';
  switch (couplingMode(before)) {
    case 'tick': return `Coupled to ${carrier}: each time it ticks,`;
    case 'ground': return groundPlan(before).zone ? 'Coupled to the ground: each time it bites someone,' : 'Coupled to the ground: once, at its heart,';
    default: return `Coupled to ${carrier}: wherever it lands, ${ECHO_LIMIT} times at most,`;
  }
}

/** The rules of one part, a sentence at a time. */
export function partLines(recipe: HexRecipe, index: number): string[] {
  const part = recipe.parts[index];
  const coupled = index > 0;
  const lines = [targetLine(part, coupled)];
  if (isGround(part.target)) return [...lines, ...groundLines(part)];
  return [...lines, ...unitPlan(part).map((step) => stepLine(part, step, coupled))];
}

/** The rules of a whole hex, a sentence at a time. */
export function hexLines(recipe: HexRecipe): string[] {
  const lines = [`${ACTION_TEXT[hexAction(recipe)]}, ${hexManaCost(recipe)} mana.`];
  recipe.parts.forEach((_, index) => {
    if (index > 0) lines.push(couplingLine(recipe, index));
    lines.push(...partLines(recipe, index));
  });
  return lines;
}

/** The ground's own tooltip once it is laid. */
export function groundText(part: HexPart, zone: HexGroundSpec): string {
  return zoneLine(part, zone);
}
