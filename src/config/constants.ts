// Global tunable constants. Edit these freely to rebalance the game.

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

// The playfield (where mages move and fight). The HUD lives below it.
export const FIELD = { x: 20, y: 20, w: 1240, h: 470 };

// Action economy granted at the start of every turn.
// One move, one main spell, and one bonus spell — at most two spells per turn.
export const ACTIONS_PER_TURN = { move: 1, main: 1, bonus: 1 };

// Movement / melee tuning (all distances are in pixels).
export const MOVE_RANGE = 175;
export const MELEE_RANGE = 72;
export const MELEE_DAMAGE = 6;

// Starting vitals for a mage.
export const START_HP = 30;
export const START_SANITY = 20;

// Mana powers word-spells and color abilities; color-charges power only color
// abilities. Mana does NOT regenerate on its own — you start at full and refill
// only via items or abilities like Rejuvenate. Color-charges regenerate (by
// color) each turn, capped at COLOR_CHARGE_CAP. See Mage.regen / GameState.beginTurn.
export const MANA_CAP = 24;
export const COLOR_CHARGE_CAP = 12;
export const START_MANA = MANA_CAP;
export const START_COLOR_CHARGES = 0;
// Extra damage the "marked" debuff (Bane) makes its bearer take from all sources.
export const MARKED_DAMAGE = 1;

// Shadow zones (placed by the Shadow word). Spells gain reach through your own
// shadows, and damage is boosted when the caster or target stands in a shadow.
export const SHADOW_RADIUS = 95;
export const SHADOW_TTL = 3; // rounds before a shadow fades
export const SHADOW_DAMAGE_BONUS = 2;

// Abstract spell range. Designers pick a comparison number (5 = poor, 10 =
// average, 15 = good) and the engine converts it to pixels with RANGE_UNIT.
export const RANGE_UNIT = 45;
// Cone spells (e.g. Shatter) sweep this total arc, centred on the aim direction.
export const CONE_DEGREES = 90;
// Totems (Corrode+Curse) persist this many rounds before crumbling.
export const TOTEM_TTL = 3;

// A mage's physical body radius. Used for movement collision so you can stand
// directly next to an opponent but never run through / on top of them.
export const MAGE_BODY_RADIUS = 22;

// Scarab summons (Curse+Drain+Corrode). Distances are in pixels.
export const SCARAB = {
  count: 5, // scarabs spawned per cast
  hp: 5,
  sanity: 5,
  spawnRadius: 5 * RANGE_UNIT, // scatter radius around the target point
  moveStep: 5 * RANGE_UNIT, // distance a scarab travels each owner turn
  leash: 8 * RANGE_UNIT, // never stray further than this from the owner
  attachDist: 38, // how close counts as "reached" a mage
  maxPerEnemy: 3, // at most this many scarabs may hound one enemy
  attackSpec: '1d3', // bite damage when attached
  healSpec: '1d3', // healing delivered to the owner on return
  radius: 8, // draw / hit radius
};

// Veil / invisibility tuning. All `*Dist` values are abstract range units
// (multiply by RANGE_UNIT for pixels), matching the "cm" scale used elsewhere.
export const VEIL = {
  // Half (partial) veil — slipperier the further the attacker stands.
  half: {
    farDist: 10, // beyond this distance: best dodge
    midDist: 6, // from here up to farDist: medium dodge
    farDodge: 0.95, // dodge chance when attacked from > farDist
    midDodge: 0.75, // dodge chance when attacked from midDist..farDist
    nearDodge: 0.5, // dodge chance when attacked from < midDist
    breakProximity: 1, // an enemy this close (or closer) collapses the veil
    revealOnDealChance: 0.5, // chance that dealing any damage reveals you
  },
  // True (full) veil — nearly untouchable, but only while kept at arm's length.
  full: {
    targetableDist: 6, // cannot be targeted at all beyond this distance
    dodge: 0.9, // dodge chance when targeted from within targetableDist
    breakNonMill: 4, // physical damage above this tears the veil away
    breakMill: 1, // sanity ("mill") damage above this tears the veil away
    revealDealThreshold: 5, // dealing more than this damage may reveal you
    revealOnDealChance: 0.5,
  },
};


// How many of the 8 words a player picks for their loadout.
export const LOADOUT_SIZE = 4;
// Max number of words that may be combined into a single spell.
export const MAX_SPELL_WORDS = 3;

export const COLORS = {
  bg: 0x07070d,
  field: 0x12121d,
  fieldBorder: 0x2c2c44,
  grid: 0x1b1b2b,
  team1: 0x57a6ff,
  team2: 0xff6f6f,
  rangeStroke: 0x6ad1ff,
  selected: 0xffd166,
  stack: 0x9a7bff,
  hp: 0x4ade80,
  sanity: 0xc084fc,
  shadow: 0x8a6bff,
  totem: 0x9be870,
  textHex: 0xe8e8f5,
};
export const TEXT = {
  body: '#e8e8f5',
  dim: '#9aa0b5',
  warn: '#ffd166',
  bad: '#ff6f6f',
  good: '#4ade80',
};
