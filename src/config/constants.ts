// Global tunable constants. Edit these freely to rebalance the game.

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

// The playfield. A top bar sits above it and the HUD dock below; see ui/layout.
export const FIELD = { x: 16, y: 60, w: 1248, h: 420 };

// Action economy granted at the start of every turn.
// One move, one main spell, and two bonus actions (spells / color abilities /
// item actions like drop, pick up and drinking potions).
export const ACTIONS_PER_TURN = { move: 1, main: 1, bonus: 2 };

// Movement / melee tuning (all distances are in pixels).
export const MOVE_RANGE = 175;
export const MELEE_RANGE = 72;

// Equipment phase. Money is tracked internally in *silver*; 10 silver = 1 gold.
// Each duellist starts with START_GOLD gold (= START_SILVER silver). Carry
// capacity (kg) is BASE_CARRY_KG before Strength is added.
export const SILVER_PER_GOLD = 10;
export const START_GOLD = 30;
export const START_SILVER = START_GOLD * SILVER_PER_GOLD;
export const BASE_CARRY_KG = 10;

// Starting vitals for a mage. HP is deliberately low: each point of Vitality
// adds exactly +1 max HP (see Mage.applyStatAllocation), so pools stay sane.
export const START_HP = 12;
export const START_SANITY = 20;

// Mana powers word-spells and color abilities; color-charges power only color
// abilities. Mana does NOT regenerate — it is a game of attrition, so you start
// full and refill only via items or event effects (e.g. Rejuvenate). Color
// charges DO regenerate each turn (by your primary colour). Swamprun carries
// both pools between waves; a new match initializes colour charges through
// Mage.resetCombatReactions. See Mage.regen / GameState.beginTurn.
export const MANA_CAP = 24;
export const COLOR_CHARGE_CAP = 12;
export const START_MANA = MANA_CAP;
export const START_COLOR_CHARGES = 0;
// Extra damage the "marked" debuff (Bane) makes its bearer take from all sources.
export const MARKED_DAMAGE = 1;

// Reaction budgets (per combat). Having at least one blue word unlocks casting
// word-spells and colour spells as reactions; defensive reactions (Dodge, Block,
// Shield-bash, …) are always available regardless of words.
//   - Word-spell reactions are limited across the whole combat.
//   - Each individual colour ability may only be cast a handful of times.
export const MAX_WORD_SPELL_REACTIONS = 2;
export const MAX_ABILITY_CASTS_PER_COMBAT = 3;
// White identity lets a mage answer an attack with a weapon strike, but only a
// couple of times per combat.
export const MAX_WEAPON_REACTIONS = 2;

// Shadow zones (placed by the Shadow word). Spells gain reach through your own
// shadows, and damage is boosted when the caster or target stands in a shadow.
export const SHADOW_RADIUS = 95;
export const SHADOW_TTL = 3; // rounds before a shadow fades
export const SHADOW_DAMAGE_BONUS = 2;

// Abstract spell range. Designers pick a comparison number (5 = poor, 10 =
// average, 15 = good) and the engine converts it to pixels with RANGE_UNIT.
export const RANGE_UNIT = 45;
// How close (px) you must be to pick a dropped item up off the ground.
export const PICKUP_RANGE = RANGE_UNIT * 2;
// Cone spells (e.g. Shatter) sweep this total arc, centred on the aim direction.
export const CONE_DEGREES = 90;
// The Cleave main-action sweeps a wide 180° arc in front of the swinger.
export const CLEAVE_DEGREES = 180;
// Leap (bonus action) may be used this many times per combat.
export const MAX_LEAPS_PER_COMBAT = 2;
// Totems (Corrode+Curse) persist this many rounds before crumbling.
export const TOTEM_TTL = 3;

// A mage's physical body radius. Used for movement collision so you can stand
// directly next to an opponent but never run through / on top of them.
export const MAGE_BODY_RADIUS = 22;

// Ground a target must cover, between an attack being declared and it landing,
// to slip it entirely — as a fraction of that attack's reach. A sidestep beats
// a melee swing; a long shot needs real distance covered.
export const EVASION_REACH_FRACTION = 0.2;

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
  // An enemy within this many range units of a veiled mage collapses ANY veil
  // (half or full), however it was applied.
  proximityBreak: 2,
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
export const LOADOUT_SIZE = 5;
// Max number of words that may be combined into a single spell.
export const MAX_SPELL_WORDS = 3;

export const COLORS = {
  bg: 0x080907,
  field: 0x17251f,
  fieldBorder: 0x65472b,
  grid: 0x675735,
  team1: 0x6e9e91,
  team2: 0xb96b62,
  rangeStroke: 0x6e9e91,
  selected: 0xd2bd7f,
  stack: 0x645174,
  hp: 0x6e9e91,
  sanity: 0x8b718f,
  shadow: 0x645174,
  totem: 0x7f9b68,
  textHex: 0xd8cbae,
};
export const TEXT = {
  body: '#d8cbae',
  dim: '#a99d83',
  warn: '#d2bd7f',
  bad: '#b96b62',
  good: '#6e9e91',
};
