// =============================================================================
//  HUD LAYOUT GRID
// -----------------------------------------------------------------------------
//  Every persistent piece of combat UI takes its position from this file. The
//  regions below are disjoint by construction, so nothing can quietly drift into
//  something else the way hand-placed pixel offsets used to.
//
//  Vertical bands (1280x720):
//    top bar   0   -  52   turn, action pips, run readout, toggles
//    field     60  - 480   the play area (see FIELD in config/constants)
//    hint      488 - 518   one-line prompt, never wraps
//    dock      524 - 712   three fixed columns: vitals | spell | log
// =============================================================================

import { FIELD, GAME_HEIGHT, GAME_WIDTH } from '../config/constants';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const right = (r: Rect): number => r.x + r.w;
export const bottom = (r: Rect): number => r.y + r.h;
export const centerX = (r: Rect): number => r.x + r.w / 2;
export const centerY = (r: Rect): number => r.y + r.h / 2;

/** Shared spacing scale. Use these instead of ad-hoc pixel nudges. */
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

const MARGIN = SPACE.lg;
const GUTTER = SPACE.md;

export const TOP_BAR: Rect = { x: 0, y: 0, w: GAME_WIDTH, h: 52 };

/** One-line prompt band between the field and the dock. */
export const HINT_BAR: Rect = {
  x: MARGIN,
  y: bottom(FIELD) + SPACE.sm,
  w: GAME_WIDTH - MARGIN * 2,
  h: 30,
};

export const DOCK: Rect = {
  x: 0,
  y: bottom(HINT_BAR) + SPACE.sm,
  w: GAME_WIDTH,
  h: GAME_HEIGHT - (bottom(HINT_BAR) + SPACE.sm) - SPACE.sm,
};

const COLUMN_W = Math.floor((GAME_WIDTH - MARGIN * 2 - GUTTER * 2) / 3);

const column = (index: number): Rect => ({
  x: MARGIN + index * (COLUMN_W + GUTTER),
  y: DOCK.y,
  w: COLUMN_W,
  h: DOCK.h,
});

/** Vitals: health, mana, sanity, colour charges, thunder, live statuses. */
export const DOCK_VITALS = column(0);
/** Spell builder: the word slots and what they currently compose. */
export const DOCK_SPELL = column(1);
/** Combat log, or the foe list when toggled. */
export const DOCK_LOG = column(2);

/** Height of a panel's title strip; body content starts below it. */
export const HEADER_H = 22;

/** The usable area inside a dock panel, below its header. */
export function panelBody(panel: Rect, pad = SPACE.sm): Rect {
  return {
    x: panel.x + pad,
    y: panel.y + HEADER_H + pad,
    w: panel.w - pad * 2,
    h: panel.h - HEADER_H - pad * 2,
  };
}

// ---- Top bar slots ----------------------------------------------------------

export const TOP_TURN: Rect = { x: MARGIN, y: 0, w: 330, h: TOP_BAR.h };
export const TOP_ACTIONS: Rect = { x: 358, y: 0, w: 330, h: TOP_BAR.h };
export const TOP_RUN: Rect = { x: 700, y: 0, w: 300, h: TOP_BAR.h };
export const TOP_TOGGLES: Rect = {
  x: 1008,
  y: 0,
  w: GAME_WIDTH - MARGIN - 1008,
  h: TOP_BAR.h,
};

// ---- Spell word slots -------------------------------------------------------

export const WORD_COLS = 3;
export const WORD_ROWS = 2;

/** Grid geometry for the six word slots inside the spell dock. */
export function wordSlot(index: number): Rect {
  const body = panelBody(DOCK_SPELL);
  const gap = SPACE.sm;
  const w = Math.floor((body.w - gap * (WORD_COLS - 1)) / WORD_COLS);
  const h = 42;
  const col = index % WORD_COLS;
  const row = Math.floor(index / WORD_COLS);
  return { x: body.x + col * (w + gap), y: body.y + row * (h + gap), w, h };
}

/** The selection read-out sits directly beneath the word grid. */
export function spellReadout(): Rect {
  const body = panelBody(DOCK_SPELL);
  const lastRow = wordSlot(WORD_COLS * WORD_ROWS - 1);
  const top = bottom(lastRow) + SPACE.sm;
  return { x: body.x, y: top, w: body.w, h: bottom(body) - top };
}

/** Field-anchored overlays that must never collide with the docks. */
export const FIELD_OVERLAY_TL: Rect = { x: FIELD.x + SPACE.sm, y: FIELD.y + SPACE.sm, w: 300, h: 96 };
export const FIELD_OVERLAY_TR: Rect = {
  x: right(FIELD) - SPACE.sm - 190,
  y: FIELD.y + SPACE.sm,
  w: 190,
  h: 150,
};
