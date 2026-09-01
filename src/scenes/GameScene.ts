import Phaser from 'phaser';
import { SceneInput } from '../engine/SceneInput';
import {
  DOCK_LOG,
  DOCK_SPELL,
  DOCK_VITALS,
  FIELD_OVERLAY_TR,
  HINT_BAR,
  SPACE,
  TOP_ACTIONS,
  TOP_BAR,
  TOP_RUN,
  TOP_TOGGLES,
  TOP_TURN,
  bottom,
  centerY,
  panelBody,
  right,
  spellReadout,
  wordSlot,
} from '../ui/layout';
import {
  PRESET_SLOTS,
  loadCreativePresets,
  saveCreativePresets,
  type CreativePreset,
  type PresetSlots,
} from '../ui/creativePresets';
import { CreativePrepView } from '../ui/prep/CreativePrepView';
import { StatAssignmentView } from '../ui/prep/StatAssignmentView';
import { ItemDraftView } from '../ui/prep/ItemDraftView';
import {
  ActionMenuView,
  ChoiceMenuView,
  MultiSelectView,
  PagedChoiceMenuView,
} from '../ui/combat/CombatMenus';
import { EndCardView, type EndCardOptions } from '../ui/combat/EndCardView';
import { PauseView } from '../ui/combat/PauseView';
import { DiceFieldView, type DiceGroup } from '../ui/combat/DiceFieldView';
import { cycleDiceMode, diceMode, diceModeLabel, diceTiming, diceTimingLabel, toggleDiceTiming } from '../ui/combat/dicePreference';
import type { DiceRollView } from '../ui/combat/diceFace';
import {
  InventoryView,
  type InventoryActionKind,
  type InventoryItemView,
} from '../ui/combat/InventoryView';
import { SwampShopView, type SwampOfferView } from '../ui/pve/SwampShopView';
import { MinePromptView } from '../ui/pve/MinePromptView';
import {
  ExpeditionTownView,
  type TownItemView,
  type TownTab,
} from '../ui/pve/ExpeditionTownView';
import { CabinetChip, MenuFocusGroup, WordPlate } from '../ui/cabinet/controls';
import {
  FONT,
  MENU_COLOR,
  MENU_FONT,
  MENU_HEX,
  addCabinetBackdrop,
  addSectionRule,
  drawCabinetBar,
  drawCabinetPanel,
} from '../ui/cabinet/theme';
import { TextEntry } from '../ui/cabinet/TextEntry';
import { addCabinetWindow } from '../ui/cabinet/CabinetWindow';
import { isReducedMotion, toggleMotionPreference } from '../ui/cabinet/motion';
import { playSound, playMusic, type SoundName } from '../audio';
import {
  ACTIONS_PER_TURN,
  COLORS,
  FIELD,
  GAME_HEIGHT,
  GAME_WIDTH,
  LOADOUT_SIZE,
  MANA_CAP,
  MAX_SPELL_WORDS,
  MAX_WEAPON_REACTIONS,
  MAX_WORD_SPELL_REACTIONS,
  MELEE_RANGE,
  RANGE_UNIT,
  SCARAB,
  START_HP,
  START_SANITY,
  TEXT,
} from '../config/constants';
import { GameState, hazardDistance } from '../core/GameState';
import { Mage } from '../core/Mage';
import { Dice } from '../core/Dice';
import { analyzeDodge, dodgeGrantsBonusAction, type DodgeTier } from '../core/Dodge';
import { scenarioToMages, scenarioToScarabs, type Scenario } from '../core/Scenario';
import { downloadScenario, pickScenarioFile } from '../ui/scenarioFile';
import type { Status } from '../core/Status';
import scarabGifUrl from '../Sprites/Scarab.gif';
import moveIconUrl from '../Sprites/Move.png';
import attackIconUrl from '../Sprites/Attack.png';
import spellIconUrl from '../Sprites/SpellCast.png';
import dotSheetUrl from '../Sprites/Spell/DoT.png';
import genericSheetUrl from '../Sprites/Spell/Generic.png';
import rootSheetUrl from '../Sprites/Root/1_2.png';
import stunSheetUrl from '../Sprites/Stun/StunEffect_Sheet_64x64.png';
import vanishSheetUrl from '../Sprites/Spell/Vanish.png';
import shatterSheetUrl from '../Sprites/Spell/Shatter.png';
import disruptSheetUrl from '../Sprites/Spell/Disrupt.png';
import lightningSheetUrl from '../Sprites/Spell/Lightning.png';
import zombieAttackSheetUrl from '../Sprites/Zombie/Zombie_Default_Attack1 (1).png';
import zombieDeathSheetUrl from '../Sprites/Zombie/Zombie_Default_Dead (1).png';
import zombieHurtSheetUrl from '../Sprites/Zombie/Zombie_Default_Hurt (1).png';
import zombieIdleSheetUrl from '../Sprites/Zombie/Zombie_Default_Idle (1).png';
import zombieWalkSheetUrl from '../Sprites/Zombie/Zombie_Default_Walk (1).png';
import skeletonAttackSheetUrl from '../Sprites/Skeleton/Skeleton_Default_Attack_Unarmed (2).png';
import skeletonHurtSheetUrl from '../Sprites/Skeleton/Skeleton_Default_Hurt (2).png';
import skeletonIdleSheetUrl from '../Sprites/Skeleton/Skeleton_Default_Idle_Unarmed (1).png';
import skeletonWalkSheetUrl from '../Sprites/Skeleton/MP_Skeleton_Default_Walk_Unarmed (2).png';
import ghostSheetUrl from '../Sprites/Wisp/ghost.png';
import defenderSheetUrl from '../Sprites/Defender/knight-Sheet_greyfx.png';
import reaperIdleSheetUrl from '../Sprites/Reaper/wraith_original_idle_sheet.png';
import reaperWalkSheetUrl from '../Sprites/Reaper/wraith_original_walk_sheet.png';
import reaperAttackSheetUrl from '../Sprites/Reaper/wraith_original_attack_sheet.png';
import reaperHitSheetUrl from '../Sprites/Reaper/wraith_original_hit_sheet.png';
import reaperDeathSheetUrl from '../Sprites/Reaper/wraith_original_death_sheet.png';
import edgelordImpactSheetUrl from '../../spritesheet/Lightning/lightning_burst_003/lightning_burst_003_large_violet/spritesheet.png';
import lightningChargeSheetUrl from '../../spritesheet/Lightning/lightning_burst_001/lightning_burst_001_large_violet/spritesheet.png';
import lightningImpactSheetUrl from '../../spritesheet/Lightning/lightning_burst_002/lightning_burst_002_large_violet/spritesheet.png';
import lightningStrikeSheetUrl from '../../spritesheet/Lightning/lightning_strike_001/lightning_strike_001_large_violet/spritesheet.png';
import summonSmokeSheetUrl from '../../spritesheet/Smoke Bursts/symmetrical_smoke_burst_001/symmetrical_smoke_burst_001_small_brown/spritesheet.png';
import swampMistSheetUrl from '../../spritesheet/Smoke Bursts/directional_smoke_burst_001/directional_smoke_burst_001_large_white/spritesheet.png';
import swampTilesUrl from '../assets/arena/kenney/roguelikeSheet_transparent.png';
import { scarabAlive, type ScarabState } from '../core/Scarab';
import { Dev, type DevToggle } from '../config/dev';
import {
  MODIFIER_WORDS,
  WORD_ORDER,
  WORDS,
  comboKey,
  isModifierWord,
  splitModifiers,
  type WordId,
} from '../core/Words';
import { MAGE_CLASSES, MAGE_CLASS_DEFS, type MageClass } from '../core/Classes';
import { WORD_COLOR, wordSpellMana, type ColorName } from '../core/Colors';
import {
  STAT_DEFS,
  STAT_ORDER,
  STAT_BUILD_DEFS,
  STAT_BUILD_IDS,
  aiAssignment,
  defaultAssignment,
  isValidAssignment,
  rollStatAssortment,
  rollSwamprunStatDice,
  statBuildAssignment,
  type DieResult,
  type StatBuildId,
  type StatKey,
} from '../core/Stats';
import { getColorAbilitiesFor, COLOR_ABILITIES, type ColorAbility } from '../spells/colorAbilities';
import {
  getItem,
  sanitizeCart,
  aiDraft,
  asItemIds,
  carryCapacity,
  rollRarity,
  draftChoices,
  rarityRank,
  DRAFT_ROUNDS,
  RARITY_COLOR,
  setActiveItemSets,
  ITEM_DEFS,
  type ItemId,
  type Rarity,
} from '../core/Items';
import type { StackItem } from '../core/Stack';
import { barrierContains } from '../core/Barrier';
import type { Spell, SpellVisual } from '../spells/Spell';
import { allSpells, getSpell, isClassSpellCombo, spellById, setActiveSpellSets } from '../spells/registry';
import { dist, stepTowards, type Vec2 } from '../core/utils';
import type {
  CombatFeedback,
  SubTargetCombatantOpts,
  SubTargetPointOpts,
  SubTargetEnemyOpts,
} from '../effects/effects';
import {
  ACTION_FX_PRESETS,
  FX_MOTION,
  FX_TWEEN,
  SPELL_IMPACT_WEIGHT,
  type ImpactWeight,
} from '../effects/FxPresets';
import { CombatFeedbackLayer } from '../visuals/CombatFeedbackLayer';
import { ImpactFxDirector } from '../visuals/ImpactFxDirector';
import { preloadImpactSheets } from '../visuals/ImpactSheets';
import { ParticleFx } from '../visuals/ParticleFx';
import {
  LIGHTNING_FX_SHEETS,
  LightningFxDirector,
  registerLightningFxAnimations,
} from '../visuals/LightningFxDirector';
import {
  SWAMP_MIST_FRAME,
  SWAMP_MIST_KEY,
  SWAMP_TILESET_FRAME,
  SWAMP_TILESET_KEY,
  SwampArenaView,
} from '../visuals/SwampArenaView';
import { SimpleAI, type AIDecision } from '../ai/SimpleAI';

/** Damage types with their own authored voice; anything else lands as a hit. */
const DAMAGE_SOUND: Record<string, SoundName> = {
  corrosive: 'spell.corrosive',
  fire: 'spell.fire',
  heat: 'spell.fire',
  shatter: 'spell.shatter',
  slashing: 'melee.slash',
  pierce: 'melee.slash',
};

/** Words that bring their own sound, so the generic spell voice stays off. */
const SELF_VOICED_WORDS = new Set(['lightning', 'fire', 'corrode', 'drain']);

/** One impact reaction, resolved when the blow lands and replayed at flush. */
interface QueuedImpact {
  mage: Mage;
  feedback: CombatFeedback;
  severity: number;
  angle?: number;
  weight?: ImpactWeight;
  seq: number;
}

/** A queued roll plus the body it belongs to, when it belongs to one. */
interface PendingRoll extends DiceRollView {
  mage?: Mage;
  seq: number;
}

import type { MatchConfig, SeatConfig, SwampPrepMode } from '../config/MatchConfig';
import {
  MINE_ROOM_VISUAL_LABEL,
  buildMineRoomTextures,
  mineRoomIconTextureKey,
  mineRoomTextureKey,
  type MineRoomVisualKind,
} from './mineVisualTextures';
import type { Net, NetMessage } from '../net/Net';
import {
  applyEnemyTraits,
  canSpawnReaper,
  rollSwamprunEncounter,
  swamprunDepth,
  ENEMY_DEFS,
  rollLoot,
  type EnemyKind,
  type RaidBossKind,
  type SwamprunCurse,
} from '../pve/swamprun';
import {
  applyMineEnemyTraits,
  isMineEnemyKind,
  mineEnemyLevel,
  mineEnemyVisual,
  mineWaveComposition,
  rollMineEnemyWeapon,
  rollMineLoot,
  MINE_ENEMY_DEFS,
  type MineEnemyKind,
  type MineSpawnSpec,
} from '../pve/minerun';
import { canUseMineAction, commitMineAction, makeMineActionItem } from '../pve/mineActions';
import {
  MINE_DIRECTIONS,
  MINE_DIRECTION_LABEL,
  MINE_DIRECTION_VECTOR,
  MINE_ORE_DEFS,
  MINE_OPPOSITE_DIRECTION,
  createMineMaze,
  currentMineNode,
  mineRoomNeedsInteraction,
  resolveMineOre,
  revealMineOre,
  rollMineTrapAvoidance,
  travelMineMaze,
  type MineDirection,
  type MineMazeNode,
  type MineMazeState,
  type MineOreResult,
  type MineRoomState,
  type MineTrapDamage,
} from '../pve/mineMaze';

// Pixel-art mage animations. Frames live under src/Sprites/<Action>/; Vite's
// glob import resolves each PNG to a hashed URL the Phaser loader can read.
const globFrames = (g: Record<string, unknown>): string[] =>
  Object.keys(g)
    .sort()
    .map((k) => g[k] as string);

interface AnimSet {
  key: string;
  frames: string[];
  frameRate: number;
  repeat: number;
}

interface CreatureAnimSet {
  key: string;
  url: string;
  end: number;
  frameRate: number;
  repeat: number;
  frameWidth?: number;
  frameHeight?: number;
}

interface SheetFrameAnimSet {
  key: string;
  frames: number[];
  frameRate: number;
  repeat: number;
}

const CREATURE_ANIM_SETS: CreatureAnimSet[] = [
  { key: 'enemy-zombie-idle', url: zombieIdleSheetUrl, end: 5, frameRate: 6, repeat: -1 },
  { key: 'enemy-zombie-walk', url: zombieWalkSheetUrl, end: 5, frameRate: 10, repeat: -1 },
  { key: 'enemy-zombie-attack', url: zombieAttackSheetUrl, end: 5, frameRate: 14, repeat: 0 },
  { key: 'enemy-zombie-hurt', url: zombieHurtSheetUrl, end: 5, frameRate: 16, repeat: 0 },
  { key: 'enemy-zombie-death', url: zombieDeathSheetUrl, end: 5, frameRate: 16, repeat: 0 },
  { key: 'enemy-skeleton-idle', url: skeletonIdleSheetUrl, end: 5, frameRate: 6, repeat: -1 },
  { key: 'enemy-skeleton-walk', url: skeletonWalkSheetUrl, end: 5, frameRate: 10, repeat: -1 },
  { key: 'enemy-skeleton-attack', url: skeletonAttackSheetUrl, end: 5, frameRate: 14, repeat: 0 },
  { key: 'enemy-skeleton-hurt', url: skeletonHurtSheetUrl, end: 1, frameRate: 14, repeat: 0 },
  {
    key: 'enemy-reaper-idle',
    url: reaperIdleSheetUrl,
    end: 23,
    frameRate: 10,
    repeat: -1,
    frameWidth: 26,
    frameHeight: 24,
  },
  {
    key: 'enemy-reaper-walk',
    url: reaperWalkSheetUrl,
    end: 11,
    frameRate: 10,
    repeat: -1,
    frameWidth: 26,
    frameHeight: 24,
  },
  {
    key: 'enemy-reaper-attack',
    url: reaperAttackSheetUrl,
    end: 5,
    frameRate: 10,
    repeat: 0,
    frameWidth: 26,
    frameHeight: 24,
  },
  {
    key: 'enemy-reaper-hurt',
    url: reaperHitSheetUrl,
    end: 3,
    frameRate: 10,
    repeat: 0,
    frameWidth: 26,
    frameHeight: 24,
  },
  {
    key: 'enemy-reaper-death',
    url: reaperDeathSheetUrl,
    end: 7,
    frameRate: 10,
    repeat: 0,
    frameWidth: 26,
    frameHeight: 24,
  },
];

// ghost.png is a labelled 12x5 grid. Body/effect frames begin at column 2;
// columns 0-1 contain labels and the trailing columns are transparent padding.
const WISP_ANIM_SETS: SheetFrameAnimSet[] = [
  {
    key: 'enemy-wisp-attack',
    frames: [2, 3, 4, 5, 6, 7, 8, 14, 15, 16, 17, 18, 19, 20],
    frameRate: 14,
    repeat: 0,
  },
  { key: 'enemy-wisp-fx', frames: [26, 27, 28, 29, 30, 31], frameRate: 16, repeat: 0 },
  { key: 'enemy-wisp-walk', frames: [38, 39, 40, 41, 42, 43], frameRate: 10, repeat: -1 },
  { key: 'enemy-wisp-idle', frames: [50, 51, 52, 53, 54, 55], frameRate: 6, repeat: -1 },
];

const DEFENDER_ANIM_SETS: SheetFrameAnimSet[] = [
  { key: 'enemy-defender-idle', frames: [0, 1, 2, 3, 4, 5], frameRate: 6, repeat: -1 },
  {
    key: 'enemy-defender-walk',
    frames: [6, 7, 8, 9, 10, 11, 12, 13, 24, 25, 26, 27],
    frameRate: 10,
    repeat: -1,
  },
  {
    key: 'enemy-defender-attack',
    frames: [14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
    frameRate: 14,
    repeat: 0,
  },
  { key: 'enemy-defender-hurt', frames: [34, 35, 36], frameRate: 12, repeat: 0 },
];

const ANIM_SETS: AnimSet[] = [
  {
    key: 'mage-idle',
    frames: globFrames(import.meta.glob('../Sprites/Idle/*.png', { eager: true, import: 'default' })),
    frameRate: 8,
    repeat: -1,
  },
  {
    key: 'mage-run',
    frames: globFrames(import.meta.glob('../Sprites/Run/*.png', { eager: true, import: 'default' })),
    frameRate: 14,
    repeat: -1,
  },
  {
    key: 'mage-role',
    frames: globFrames(import.meta.glob('../Sprites/Role/*.png', { eager: true, import: 'default' })),
    frameRate: 15,
    repeat: 0,
  },
  {
    key: 'mage-charge',
    frames: globFrames(
      import.meta.glob('../Sprites/AttackCharge/StaffWood/*.png', { eager: true, import: 'default' })
    ),
    frameRate: 10,
    repeat: -1,
  },
  {
    key: 'mage-attack',
    frames: globFrames(
      import.meta.glob('../Sprites/Attack/StaffWood/*.png', { eager: true, import: 'default' })
    ),
    frameRate: 18,
    repeat: 0,
  },
  {
    key: 'mage-hit',
    frames: globFrames(import.meta.glob('../Sprites/Hit/*.png', { eager: true, import: 'default' })),
    frameRate: 14,
    repeat: 0,
  },
];

// One-shot slash/impact effects (from the Pixel Art Slashes library) used to
// dress up melee auto-attacks and the Cleave sweep, which otherwise had no
// dedicated animation. Each folder is a sequence of individual frame PNGs, so
// they load the same way as the mage animation sets above.
const FX_FRAME_SETS: AnimSet[] = [
  {
    // A quick single swipe arc — plays on a basic weapon / unarmed strike.
    key: 'fx-slash-arc',
    frames: globFrames(
      import.meta.glob('../../Pixel Art Animations - Slashes/128x128/Slash 1/color5/Frames/*.png', {
        eager: true,
        import: 'default',
      })
    ),
    frameRate: 26,
    repeat: 0,
  },
  {
    // A broad crescent sweep — plays on the 180° Cleave.
    key: 'fx-slash-sweep',
    frames: globFrames(
      import.meta.glob('../../Pixel Art Animations - Slashes/128x128/Slash 3/color5/frames/*.png', {
        eager: true,
        import: 'default',
      })
    ),
    frameRate: 22,
    repeat: 0,
  },
];

type CreatureSpriteKind = 'zombie' | 'skeleton' | 'wisp' | 'defender' | 'reaper';
type BodyAnimState = 'idle' | 'run' | 'role' | 'charge' | 'attack' | 'hurt' | 'death';

type HeldWeaponKind = 'sword' | 'dagger' | 'spear' | 'axe' | 'hammer' | 'club' | 'bow' | 'staff' | 'shield' | 'lantern';

/** Per-mage sprite + animation-state machine. */
interface MageAnim {
  sprite: Phaser.GameObjects.Sprite;
  held?: Phaser.GameObjects.Image;
  heldVisualKey?: string;
  /** Binding roots held on the body while a physical root lasts. */
  root?: Phaser.GameObjects.Sprite;
  /** A ring of stars spinning over the head while a full stun lasts. */
  stun?: Phaser.GameObjects.Sprite;
  /** A special animation currently owning the sprite (else idle/charge rests). */
  lock: 'move' | 'dash' | 'pull' | 'attack' | 'hit' | 'death' | null;
  /** A sprite-position tween owns the position; don't snap to logical. */
  posLocked: boolean;
  /** The attack-charge loop is the current resting animation. */
  charging: boolean;
  /** A fatal hit is queued but waits for the damage dice to settle. */
  deathPending: boolean;
  /** The death animation has finished and the body can remain hidden. */
  deathComplete: boolean;
  /** Last applied Mine tint/scale state; changes when a Golem wakes. */
  mineVisualKey?: string;
}

/** Per-scarab sprite plus its smoothed position and individual gait. */
interface ScarabRec {
  sprite: Phaser.GameObjects.Sprite;
  /** Smoothed on-screen position, eased toward the logical spot each frame. */
  disp: Vec2;
  /** Last seen logical state, to detect bite/heal transitions. */
  prevState: ScarabState;
  baseScale: number;
  /** Individual walk-cycle time scale so scarabs never march in lockstep. */
  speed: number;
  /** Per-scarab easing factor for the crawl, low and varied so each lags uniquely. */
  glide: number;
  /** A one-shot attack/heal cue tween currently owns the tint/scale/angle. */
  cue: boolean;
  /** Whether the looping walk animation has been started. */
  walking: boolean;
}

type InputMode =
  | 'idle'
  | 'aiming-spell'
  | 'aiming-point'
  | 'aiming-melee'
  | 'aiming-throw'
  | 'aiming-eldritch'
  | 'aiming-discharge'
  | 'aiming-move'
  | 'aiming-leap'
  | 'aiming-cleave'
  | 'aiming-edgelord-throw'
  | 'aiming-shadow-dagger'
  | 'aiming-wall'
  | 'subtarget-point'
  | 'subtarget-enemy'
  | 'busy'
  | 'reaction'
  | 'dodge-bonus'
  | 'assign'
  | 'shop'
  | 'inventory'
  | 'eldritch-menu'
  | 'thunder-menu'
  | 'action-menu'
  | 'training'
  | 'dev-resources'
  | 'scenario-lab'
  | 'scenario-place'
  | 'scenario-move'
  | 'pause'
  | 'over';

interface ArenaTheme {
  kind: 'duel' | 'swamp' | 'mine' | 'raid';
  floor: number;
  tile: number;
  grid: number;
  accent: number;
  shadow: number;
}

/**
 * One entry in the context-aware action menu / on-screen action list. The
 * registry that produces these is the single source of truth for "what can I do
 * right now", so adding a new action is just adding one entry — it then shows up
 * as a clickable button with its label, hotkey badge and description, and stays
 * filtered to only appear when relevant. Hotkeys remain optional shortcuts.
 */
interface ActionEntry {
  /** Stable id (used for keys / dedup). */
  id: string;
  /** Button label, e.g. 'Move' or 'Cast Fireball'. */
  label: string;
  /** Hotkey badge shown on the button, e.g. 'M' or '1–4 / Enter'. */
  hotkey: string;
  /** One-line description of what the action does. */
  desc: string;
  /** Whether the action can be used right now (false ⇒ greyed out with `reason`). */
  enabled: boolean;
  /** Why the action is unavailable, shown when `enabled` is false. */
  reason?: string;
  /** Perform the action (only invoked when `enabled`). */
  run: () => void;
}

interface DodgeBonusOption {
  id: string;
  label: string;
  detail: string;
}

function dodgeTierLabel(t: DodgeTier): string {
  switch (t) {
    case 'pair':
      return 'a clean evade';
    case 'triple':
      return 'a perfect evade + free bonus action';
    case 'quad':
      return 'a perfect evade + free bonus action';
    default:
      return 'no match — the dodge fails';
  }
}

// -----------------------------------------------------------------------------
//  Online lockstep commands
// -----------------------------------------------------------------------------
//  In online play both peers run the identical seeded simulation; only a
//  player's *decisions* cross the wire. A decision is encoded as one of these
//  small, fully-serializable commands, applied by the same code on both ends so
//  the RNG stays in lockstep.
// -----------------------------------------------------------------------------

/** A top-level turn action chosen by the active player. */
type TurnCommand =
  | { t: 'move'; x: number; y: number }
  | { t: 'melee'; target: number }
  | { t: 'spell'; spellId: string; ability: boolean; target: number | null; x?: number; y?: number; x2?: number; y2?: number; angle?: number; mods?: WordId[] }
  | { t: 'item-drop'; itemId: string }
  | { t: 'item-pickup'; dropId: number }
  | { t: 'item-use'; itemId: string }
  | { t: 'item-equip'; itemId: string }
  | { t: 'item-unequip'; itemId: string }
  | { t: 'item-throw'; itemId: string; target: number }
  | { t: 'edgelord-shake' }
  | { t: 'edgelord-throw'; x: number; y: number }
  | { t: 'deaths-angel-wings' }
  | { t: 'eldritch'; choice: 'attack' | 'defend' | 'restore'; target?: number }
  | { t: 'thunder-charge' }
  | { t: 'thunder-discharge'; target: number }
  | { t: 'cast-random' }
  | { t: 'weapon-action'; x?: number; y?: number }
  | { t: 'leap'; x: number; y: number }
  | { t: 'focus' }
  | { t: 'cleave'; x: number; y: number }
  | { t: 'command'; summon: number }
  | { t: 'uncommand' }
  | { t: 'mantle-bind' }
  | { t: 'cleanse' }
  | { t: 'raid-begin' }
  | { t: 'raid-restore'; kind: RaidRestoreKind }
  | { t: 'end' };

/** A reaction-window choice (a counter/response, or a pass). */
type ReactionCommand =
  | { t: 'react'; spellId: string; ability: boolean; target: number | null; x?: number; y?: number }
  | { t: 'shield'; kind: 'block' | 'bash' }
  | { t: 'needle' }
  | { t: 'dodge' }
  | { t: 'weapon' }
  | { t: 'pass' };

/** A mid-cast sub-target choice. */
type SubCommand =
  | { t: 'sub-point'; x: number; y: number }
  | { t: 'sub-enemy'; target: number }
  | { t: 'sub-none' };

/** A mid-resolution draft pick (Gambler's Blade cash-out): the chosen card index. */
type DraftCommand = { t: 'draft'; index: number };

/** The selected action in a synchronized perfect-dodge bonus window. */
type DodgeBonusChoiceCommand = { t: 'dodge-bonus'; optionId: string | null };

const MAGE_RADIUS = 22;
const CREATURE_SPRITE_HEIGHT = MAGE_RADIUS * 4.5;

const creatureSpriteKind = (mage: Mage): CreatureSpriteKind | null => {
  if (mage.enemyKind === 'zombie' || mage.enemyKind === 'acidZombie') return 'zombie';
  if (mage.enemyKind === 'skeleton') return 'skeleton';
  if (mage.enemyKind === 'wisp') return 'wisp';
  if (mage.enemyKind === 'defender') return 'defender';
  if (mage.enemyKind === 'reaper') return 'reaper';
  return null;
};

const bodyAnimationKey = (mage: Mage, state: BodyAnimState): string => {
  const kind = creatureSpriteKind(mage);
  if (!kind) {
    if (state === 'run') return 'mage-run';
    if (state === 'role') return 'mage-role';
    if (state === 'hurt' || state === 'death') return 'mage-hit';
    return `mage-${state}`;
  }
  const creatureState =
    state === 'run' || state === 'role'
      ? 'walk'
      : state === 'charge'
        ? 'idle'
        : kind === 'skeleton' && state === 'death'
          ? 'hurt'
          : kind === 'defender' && state === 'death'
            ? 'hurt'
          : kind === 'wisp' && (state === 'hurt' || state === 'death')
            ? 'idle'
          : state;
  return `enemy-${kind}-${creatureState}`;
};

/** How the action palette is grouped, so it reads as short lists. */
const ACTION_GROUPS: { title: string; ids: string[] }[] = [
  { title: 'CORE', ids: ['cast', 'move', 'attack', 'end'] },
  { title: 'MANOEUVRE', ids: ['leap', 'cleave', 'focus', 'command'] },
  {
    title: 'POWERS',
    ids: [
      'weapon',
      'eldritch',
      'thunder',
      'deaths-angel-wings',
      'mantle-bind',
      'cleanse',
      'edgelord-shake',
      'edgelord-throw',
    ],
  },
  { title: 'ITEMS', ids: ['inventory', 'drop', 'pickup', 'throw'] },
  {
    title: 'RUN',
    ids: ['raid-begin', 'raid-restore-vitals', 'raid-restore-mana', 'raid-restore-words', 'pickaxe'],
  },
  { title: 'RESPOND', ids: ['react-cast', 'needle', 'block', 'bash', 'dodge', 'weapon', 'pass'] },
];
/** Practice targets kept standing during raid preparation. */
const RAID_PREP_EFFIGIES = 3;
/** Loadout slots plus the single modifier word a build carries. */
const WORD_SLOTS = LOADOUT_SIZE + 1;

type RaidRestoreKind = 'vitals' | 'mana' | 'words';

/** One purchasable slot in the swamprun shop (rerolled every visit). */
interface SwampShopSlot {
  kind: 'item' | 'stat';
  /** For item slots: the offered item and its rolled rarity. */
  id?: ItemId;
  rarity?: Rarity;
  /** Gold cost (after any discount). Stat slots price dynamically instead. */
  price: number;
  /** Rolled discount tier applied to an item slot (0 / 50% / 80%). */
  discount: 0 | 0.5 | 0.8;
  sold: boolean;
}

interface MinePromptChoice {
  id: string;
  label: string;
  enabled?: boolean;
  color?: string;
}

type MinePromptVisual = MineRoomState | 'hidden';

interface CreativePrepResult {
  stats: Record<StatKey, number>;
  items: ItemId[];
}

type ExpeditionCompanionKind = 'dwarf' | 'elf' | 'human';
type ExpeditionTownTab = 'potions' | 'armor' | 'weapons' | 'guild' | 'donate';

/** Base gold price per rarity in the swamprun shop (before discounts). */
const SWAMP_PRICE: Record<Rarity, number> = {
  consumeable: 1,
  common: 2,
  rare: 4,
  epic: 6,
  unreal: 10,
  mythical: 14,
  legendary: 18,
  lareneg: 24,
};

/** Base cost of the stat-up slot; each purchase this shop raises it by 1g. */
const SWAMP_STAT_BASE = 2;
/** Cost of a party rest at the shop. */
const SWAMP_REST_COST = 6;
/** Fixed shared-tool price at every Mine supply room. */
const MINE_PICKAXE_COST = 3;

export class GameScene extends Phaser.Scene {
  private gs!: GameState;
  private ais = new Map<Mage, SimpleAI>();

  // Online play (lockstep relay). `net` is null for local matches.
  private net: Net | null = null;
  private online = false;
  private localTeam = 1;
  /** Online play: the seat index this client controls (0-based). */
  private localSeat = 0;
  private opponentLeft = false;

  private mode: InputMode = 'idle';
  private busy = false;
  /** Set once the result banner is up, so repeated isOver checks are ignored. */
  private gameEnded = false;
  /** Set while handing control back to the menu, so it can only happen once. */
  private leaving = false;

  // Training sandbox (offline only). Enabled when the match mode is 'training'.
  private training = false;
  // Scenario Lab: build a fight by hand, then save it as a memory file.
  private scenarioLab = false;
  private scenarioPanel?: Phaser.GameObjects.Container;
  private scenarioNamePanel?: Phaser.GameObjects.Container;
  private readonly scenarioNameEntry = new TextEntry();
  private scenarioTitle?: Phaser.GameObjects.Text;
  private scenarioWidgets: Phaser.GameObjects.GameObject[] = [];
  private scenarioPage: 'roster' | 'spawn' | 'stats' | 'words' | 'gear' = 'roster';
  /** Index into `gs.mages` of the entity the gear page edits. */
  private scenarioTargetIndex = 0;
  /** Team stamped on the next entity placed on the field. */
  private scenarioTeam = 2;
  /** What the next field click spawns, or the entity it relocates. */
  private scenarioBrush: { player: true } | { enemy: EnemyKind } | { mine: MineEnemyKind } | null = null;
  private scenarioMoveTarget: Mage | null = null;
  // Memory: a saved fight was rebuilt instead of drafted.
  private memoryMode = false;
  private memoryName = '';
  /** Spawn points restored on a training soft reset. */
  private playerSpawn: Vec2 = { x: 0, y: 0 };
  private enemySpawn: Vec2 = { x: 0, y: 0 };
  /** Home position of each seat, indexed by seat number (used for resets). */
  private spawns: Vec2[] = [];
  /** Which team the training overlay's vital/stack/item controls target. */
  private trainTarget = 2;
  /** Current training enemy configuration. */
  private trainEnemyKind: 'dummy' | 'passive' | 'ai' = 'ai';
  /** Which page of the training overlay is showing. */
  private trainPage: 'main' | 'items' = 'main';
  private trainPanel?: Phaser.GameObjects.Container;
  private trainTitle?: Phaser.GameObjects.Text;
  /** Dynamically rebuilt controls inside the training overlay. */
  private trainWidgets: Phaser.GameObjects.GameObject[] = [];

  // Swamprun (offline PvE co-op survival). Enabled when mode is 'swamprun'.
  private swamprun = false;
  /** One prepared boss fight; defeating the selected target wins immediately. */
  private raid = false;
  private raidBoss: RaidBossKind = 'deathknightSpear';
  private raidTarget?: Mage;
  private raidVictory = false;
  /** Preparation round: harmless effigies, free restores, no boss yet. */
  private raidPrepActive = false;
  /** Mine Run reuses survival progression while supplying a separate roster. */
  private mineRun = false;
  private mineMaze?: MineMazeState;
  private mineExploring = false;
  private mineInCombat = false;
  private mineRunEnded = false;
  private mineActiveRoomId: number | null = null;
  private minePanel?: Phaser.GameObjects.Container;
  private mineMapVisible = false;
  private mineChoiceResolve: ((choice: string) => void) | null = null;
  private mineCombatResolve: (() => void) | null = null;
  /** Shared tools; each entry is one pickaxe's remaining durability out of 10. */
  private minePickaxes: number[] = [];
  private mineChestCursor = 0;
  private swampPrepMode: SwampPrepMode = 'custom';
  private expedition = false;
  private expeditionGold = new Map<Mage, number>();
  private expeditionLevel = 1;
  private expeditionXp = 0;
  private expeditionPendingLevels = 0;
  private expeditionXpEnemies = new Set<Mage>();
  private expeditionRunDepth = 0;
  private expeditionRetreating = false;
  private expeditionRetreatCursor = 0;
  private expeditionTownPanel?: Phaser.GameObjects.Container;
  private expeditionTownResolve: (() => void) | null = null;
  private expeditionTownTab: ExpeditionTownTab = 'potions';
  private expeditionTownPage = 0;
  private expeditionTownMessage = '';
  private expeditionTownBuyer: Mage | null = null;
  private expeditionTownHostPhase = false;
  private expeditionPermanentRecruits = new Set<ExpeditionCompanionKind>();
  private expeditionRunRecruits = new Set<ExpeditionCompanionKind>();
  private expeditionCompanions = new Map<ExpeditionCompanionKind, Mage>();
  /** Highest wave reached so far (also the survival score). */
  private swamprunWave = 0;
  private swamprunEncounterPower = 0;
  private swamprunCurse?: SwamprunCurse;
  /** Shared party gold, earned by auto-selling each cleared wave's loot. */
  private swamprunGold = 0;
  /** Creatures spawned in the current wave, pending loot when it is cleared. */
  private swamprunWaveEnemies: Mage[] = [];
  /** Wisp copies (spawned by a living wisp) — these drop no loot. */
  private swamprunWispCopies = new Set<Mage>();
  /**
   * How many arrows each party member OWNS this wave. Every wave is its own
   * combat, so fired arrows are recovered ("picked up") at the wave's end and
   * the count is restored to what they owned when the wave began.
   */
  private swamprunArrowsOwned = new Map<Mage, number>();
  /** Guards against re-entering the between-wave interlude. */
  private swamprunInterludeActive = false;
  /** On-field wave / foe-count readout. */
  private swamprunHudText?: Phaser.GameObjects.Text;
  // Between-wave shop overlay state (turn-based; one shopper acts at a time).
  private swampShopPanel?: Phaser.GameObjects.Container;
  private swampShopResolve: (() => void) | null = null;
  private swampShopMage?: Mage;
  private swampShopStatPicking = false;
  private swampShopMsg = '';
  /** The six shop slots, rerolled every shop visit. */
  private swampSlots: SwampShopSlot[] = [];
  /** Rest may be bought once per shop visit (shared by the party). */
  private swampRestUsed = false;
  /** How many stat-ups were bought this shop (each raises the next price by 1g). */
  private swampStatBuys = 0;
  /** Shoppers who have chosen to leave the current shop. */
  private swampShopPassed = new Set<Mage>();
  /** True while the shopper is viewing the sell / drop (manage bag) sub-panel. */
  private swampShopManaging = false;
  /** Slot index awaiting an over-weight "buy anyway" confirmation, if any. */
  private swampShopConfirmSlot: number | null = null;
  /** True while running the one-pick, no-consumable start-of-run draft. */
  private swampStartDraftActive = false;
  private creativePrepPanel?: CreativePrepView;
  private creativePrepMage?: Mage;
  private creativePrepStats: Record<StatKey, number> = {
    strength: 4, dex: 4, int: 4, mana: 4, hp: 4, luck: 4,
  };
  private creativePrepItems: ItemId[] = [];
  private creativePrepPage = 0;
  private creativePresets: PresetSlots = loadCreativePresets();
  private creativePrepResolve: ((result: CreativePrepResult) => void) | null = null;

  // Human spell-building state (indices into the current mage's loadout).
  private selectedIdx: number[] = [];
  private pendingSpell: Spell | null = null;
  /** First edge of a two-point cone (Reality Shatter), captured before the second click. */
  private pendingFirstPoint: Vec2 | null = null;
  /** The color ability currently being aimed (paid for differently than spells). */
  private pendingAbility: ColorAbility | null = null;
  /** The throwable item currently being aimed for a throw. */
  private throwPendingItem: ItemId | null = null;
  /** Orientation (radians) of the rotatable wall while it is being placed. */
  private wallAimAngle = 0;

  // Reaction target-selection state (a reaction can require picking a target).
  private aimingSource: Mage | null = null;
  private reactionAiming = false;
  private reactionPendingSpell: Spell | null = null;
  private reactionTop: StackItem | null = null;

  // Interactive sub-targeting state (a spell asking for extra targets mid-cast).
  private subtargetResolve: ((value: Vec2 | Mage | null) => void) | null = null;
  private subtargetSource: Mage | null = null;
  private subtargetOrigin: Vec2 | null = null;
  private subtargetRange = 0;
  private subtargetMinRange = 0;
  private subtargetCandidates: Set<Mage> | null = null;
  private subtargetRequired = false;

  // Dice rolls queued during the current resolution, shown after the effect.
  private pendingDice: PendingRoll[] = [];

  // Graphics & text.
  private gfxStatic!: Phaser.GameObjects.Graphics;
  private gfxArenaAmbient!: Phaser.GameObjects.Graphics;
  private arenaThemeCache?: ArenaTheme;
  private swampArena?: SwampArenaView;
  private gfx!: Phaser.GameObjects.Graphics;
  private gfxFx!: Phaser.GameObjects.Graphics;
  private gfxMine!: Phaser.GameObjects.Graphics;
  private gfxScarab!: Phaser.GameObjects.Graphics;
  private lightningFx?: LightningFxDirector;
  private particleFx?: ParticleFx;
  private impactFx?: ImpactFxDirector;
  private hoverGfx!: Phaser.GameObjects.Graphics;
  private diceField?: DiceFieldView;
  private turnText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private hintDim?: Phaser.Time.TimerEvent;
  private logText!: Phaser.GameObjects.Text;
  private actionText!: Phaser.GameObjects.Text;
  private resourceText!: Phaser.GameObjects.Text;
  private resourceGfx!: Phaser.GameObjects.Graphics;
  private resourceLabels: Phaser.GameObjects.Text[] = [];
  private resourceValues: Phaser.GameObjects.Text[] = [];
  private wordPlates: WordPlate[] = [];
  private tooltip!: Phaser.GameObjects.Text;
  private endCard?: EndCardView;

  // Scrollable window for the selected spell's full (plain-language) description.
  private spellInfoPanel?: Phaser.GameObjects.Container;
  private spellInfoTitle?: Phaser.GameObjects.Text;
  private spellInfoBody?: Phaser.GameObjects.Text;
  private spellInfoBodyTop = 0;
  private spellInfoBodyH = 0;
  private spellInfoScroll = 0;
  private spellInfoHovered = false;
  private spellInfoPinned = false;

  // Dedicated, filterable history panel.
  private historyPanel!: Phaser.GameObjects.Container;
  private historyDim!: Phaser.GameObjects.Rectangle;
  private historyBg!: Phaser.GameObjects.Rectangle;
  private historyTitle!: Phaser.GameObjects.Text;
  private historyExpanded = false;
  private historyFilters = { cast: true, roll: true, event: true };
  private historyToggleControls: { cat: 'cast' | 'roll' | 'event'; control: CabinetChip }[] = [];

  // Pre-duel stat-assignment overlay.
  private statDice: DieResult[] = [];
  private assignPanel?: StatAssignmentView;
  private assignTitleText = '';
  /** placement[statSlot] = die index assigned to that stat (or null). */
  private assignPlacement: (number | null)[] = [];
  /** The die currently "picked up" awaiting placement. */
  private assignSelectedDie: number | null = null;
  private assignResolve: ((order: number[]) => void) | null = null;
  /** When true the overlay ignores clicks (e.g. while awaiting the opponent). */
  private assignLocked = false;

  // Pre-duel rarity-draft overlay.
  private shopPanel?: ItemDraftView;
  /** Items drafted so far this shop session. */
  private shopPicks: ItemId[] = [];
  /** Current draft round (1-based) and the three options being offered. */
  private shopRound = 0;
  private shopOptions: ItemId[] = [];
  /** The mage currently drafting (for luck-weighted rarity rolls). */
  private shopMage: Mage | null = null;
  private shopLocked = false;
  private shopResolve: ((items: ItemId[]) => void) | null = null;
  /** Resolves the current Gambler's Blade cash-out pick (index of the 3 cards). */
  private gamblerResolve: ((index: number) => void) | null = null;
  /** Progress display for the Gambler's Blade cash-out draft (round/total). */
  private gamblerRound = 0;
  private gamblerTotal = 0;

  // Inventory overlay (items + status effects, opened with [I]).
  private invPanel?: Phaser.GameObjects.Container | InventoryView;

  // Mantle of Eldritch Truth action menu.
  private eldritchMenu?: ChoiceMenuView<'attack' | 'defend' | 'restore'>;

  // Blessing of Roaring Thunder action menu.
  private thunderMenu?: ChoiceMenuView<'charge' | 'discharge'>;

  // Context-aware "everything you can do right now" action menu (Tab / button /
  // right-click). Its contents are generated from the action registry so new
  // actions appear automatically without any extra hotkey to learn.
  private actionMenu?: ActionMenuView;
  private actionMenuEntries: ActionEntry[] = [];
  private actionMenuSelection = 0;
  private actionMenuRowsPerColumn = 1;
  /** The mode to restore when the action menu closes ('idle' or 'reaction'). */
  private actionMenuReturn: InputMode = 'idle';
  /** The always-visible button that opens the action menu. */
  private actionMenuButton?: Phaser.GameObjects.Text;
  private pauseView?: PauseView;
  private pauseReturn: 'idle' | 'reaction' = 'idle';

  // Dev / testing cheat panel.
  private devPanel!: Phaser.GameObjects.Container;
  private devToggles: { key: DevToggle; label: string; hot: string; control: CabinetChip }[] = [];
  private devClickGuard = false;
  // Dev resource editor (HP / mana / sanity / actions / stacks of any entity).
  private devResPanel?: Phaser.GameObjects.Container;
  private devResWidgets: Phaser.GameObjects.GameObject[] = [];
  private readonly workshopFocus = new MenuFocusGroup();
  /** Index into `gs.mages` of the entity the resource editor is editing. */
  private devResIndex = 0;
  /** The mode to restore when the resource editor closes. */
  private devResReturn: InputMode = 'idle';
  /** Swallows the field click that opened an aiming mode from the action menu. */
  private menuClickGuard = false;

  // Reaction prompt.
  private reactor: Mage | null = null;

  // Perfect-dodge bonus-action chooser.
  private dodgeBonusActor: Mage | null = null;
  private dodgeBonusMenu?: PagedChoiceMenuView<string>;

  /**
   * Active "Command" puppet: while the owner directs a summon it becomes the
   * current mage (so all normal move/attack/item input drives it) for exactly
   * one action, after which control returns to `owner` at `savedIndex`.
   */
  private puppet: { summon: Mage; owner: Mage; savedIndex: number } | null = null;
  private reactionResolve: ((value: ReactionChoice | null) => void) | null = null;
  // When on, the local player's reaction windows auto-pass (never prompt).
  // Can be toggled at any time (key [O] or the on-screen button).
  private autoPassReactions = false;
  private autoPassButton?: CabinetChip;
  // When on (offline only), every seat is played by the AI so the match runs
  // itself and the player can just watch. Toggled via key [Y] or the button.
  private spectateAll = false;
  private spectateButton?: CabinetChip;
  private combatSpeed = 1;
  private reducedMotion = false;
  private combatSpeedButton?: CabinetChip;
  // A docked list of every living foe, so overlapping enemies can be targeted
  // by clicking their name instead of their (possibly hidden) body. Toggle [J].
  private showTargetList = true;
  private targetListPage = 0;
  private targetListPanel?: Phaser.GameObjects.Container;
  private combatFeedback?: CombatFeedbackLayer;

  // Stack token hit areas for hover.
  private stackTokens: { x: number; y: number; r: number; item: StackItem }[] = [];
  /** Reusable sprite icons overlaid on the stack tokens (move / attack / spell). */
  private stackIcons: Phaser.GameObjects.Image[] = [];

  private pointer: Vec2 = { x: 0, y: 0 };

  constructor() {
    super('Game');
  }

  preload(): void {
    for (const set of ANIM_SETS) {
      set.frames.forEach((url, i) => this.load.image(`${set.key}-${i}`, url));
    }
    for (const set of FX_FRAME_SETS) {
      set.frames.forEach((url, i) => this.load.image(`${set.key}-${i}`, url));
    }
    for (const set of CREATURE_ANIM_SETS) {
      this.load.spritesheet(set.key, set.url, {
        frameWidth: set.frameWidth ?? 64,
        frameHeight: set.frameHeight ?? 64,
      });
    }
    this.load.spritesheet('enemy-wisp-sheet', ghostSheetUrl, { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('enemy-defender-sheet', defenderSheetUrl, { frameWidth: 90, frameHeight: 90 });
    // First frame of the scarab gif, used until the animated frames decode.
    this.load.image('scarab-static', scarabGifUrl);
    // Stack token icons (move / basic attack / spell cast).
    this.load.image('stack-move', moveIconUrl);
    this.load.image('stack-melee', attackIconUrl);
    this.load.image('stack-spell', spellIconUrl);
    // One-shot hit-effect sprite sheets, played on the afflicted target.
    this.load.spritesheet('fx-dot', dotSheetUrl, { frameWidth: 96, frameHeight: 96 });
    this.load.spritesheet('fx-generic', genericSheetUrl, { frameWidth: 96, frameHeight: 96 });
    this.load.spritesheet('fx-root', rootSheetUrl, { frameWidth: 72, frameHeight: 72 });
    this.load.spritesheet('fx-stun', stunSheetUrl, { frameWidth: 64, frameHeight: 64 });
    this.load.spritesheet('fx-vanish', vanishSheetUrl, { frameWidth: 64, frameHeight: 64 });
    this.load.spritesheet('fx-shatter', shatterSheetUrl, { frameWidth: 64, frameHeight: 64 });
    this.load.spritesheet('fx-disrupt', disruptSheetUrl, { frameWidth: 128, frameHeight: 128 });
    this.load.spritesheet('fx-lightning', lightningSheetUrl, { frameWidth: 256, frameHeight: 128 });
    this.load.spritesheet('fx-edgelord-impact', edgelordImpactSheetUrl, { frameWidth: 96, frameHeight: 96 });
    this.load.spritesheet(LIGHTNING_FX_SHEETS.charge.key, lightningChargeSheetUrl, {
      frameWidth: LIGHTNING_FX_SHEETS.charge.frameWidth,
      frameHeight: LIGHTNING_FX_SHEETS.charge.frameHeight,
    });
    this.load.spritesheet(LIGHTNING_FX_SHEETS.impact.key, lightningImpactSheetUrl, {
      frameWidth: LIGHTNING_FX_SHEETS.impact.frameWidth,
      frameHeight: LIGHTNING_FX_SHEETS.impact.frameHeight,
    });
    this.load.spritesheet(LIGHTNING_FX_SHEETS.strike.key, lightningStrikeSheetUrl, {
      frameWidth: LIGHTNING_FX_SHEETS.strike.frameWidth,
      frameHeight: LIGHTNING_FX_SHEETS.strike.frameHeight,
    });
    this.load.spritesheet('fx-summon-smoke', summonSmokeSheetUrl, {
      frameWidth: 32,
      frameHeight: 32,
    });
    preloadImpactSheets(this);
    this.load.spritesheet(SWAMP_TILESET_KEY, swampTilesUrl, {
      frameWidth: SWAMP_TILESET_FRAME.width,
      frameHeight: SWAMP_TILESET_FRAME.height,
      spacing: SWAMP_TILESET_FRAME.spacing,
    });
    this.load.spritesheet(SWAMP_MIST_KEY, swampMistSheetUrl, {
      frameWidth: SWAMP_MIST_FRAME.width,
      frameHeight: SWAMP_MIST_FRAME.height,
    });
  }

  /**
   * Phaser reuses this scene instance, so a second match would otherwise
   * inherit the previous run's destroyed widgets, cached panels and sprite
   * maps. Clearing them here is what makes "return to menu" survivable.
   */
  private resetSceneState(): void {
    this.combatFeedback?.destroy();
    this.combatFeedback = undefined;
    this.lightningFx?.destroy();
    this.lightningFx = undefined;
    this.impactFx?.destroy();
    this.impactFx = undefined;
    this.particleFx?.destroy();
    this.particleFx = undefined;
    this.diceField?.destroy();
    this.diceField = undefined;
    this.mode = 'idle';
    this.busy = false;
    this.gameEnded = false;
    this.leaving = false;
    this.reactor = null;
    this.puppet = null;
    this.selectedIdx = [];
    this.pendingDice = [];
    this.pendingHits = [];
    this.pendingImpacts = [];
    this.vfxSeq = 0;
    this.deferDice = false;
    this.pendingSounds = [];
    this.pendingEffects = [];
    this.pendingDrains = [];
    this.pendingSummonPuffs = [];
    this.subtargetResolve = null;
    this.subtargetSource = null;
    this.subtargetOrigin = null;
    this.subtargetRange = 0;
    this.subtargetMinRange = 0;
    this.subtargetCandidates = null;
    this.subtargetRequired = false;
    this.endCard = undefined;
    this.stackTokens = [];
    this.stackIcons = [];
    this.arenaThemeCache = undefined;
    this.swampArena?.destroy();
    this.swampArena = undefined;
    this.resourceLabels = [];
    this.resourceValues = [];
    this.wordPlates = [];
    this.spellInfoHovered = false;
    this.spellInfoPinned = false;
    this.assignPanel = undefined;
    this.assignTitleText = '';
    this.assignResolve = null;
    this.shopPanel = undefined;
    this.shopResolve = null;
    this.gamblerResolve = null;
    this.shopPicks = [];
    // Lazily-built overlays cache their container, so stale handles must go.
    this.actionMenu = undefined;
    this.actionMenuEntries = [];
    this.pauseView = undefined;
    this.pauseReturn = 'idle';
    this.targetListPage = 0;
    this.trainPanel = undefined;
    this.trainTitle = undefined;
    this.trainWidgets = [];
    this.devResPanel = undefined;
    this.devResWidgets = [];
    this.workshopFocus.clear();
    this.scenarioPanel = undefined;
    this.scenarioNamePanel = undefined;
    this.scenarioNameEntry.destroy();
    this.scenarioTitle = undefined;
    this.scenarioWidgets = [];
    this.creativePrepPanel = undefined;
    this.creativePrepMage = undefined;
    this.creativePrepResolve = null;
    this.mageAnims.clear();
    this.mageLabels.clear();
    this.scarabSprites.clear();
    this.zoneLabels.clear();
    this.dropLabels.clear();
    this.ais.clear();
    this.swamprunWaveEnemies = [];
    this.swamprunWispCopies.clear();
    this.swamprunArrowsOwned.clear();
    this.expeditionXpEnemies.clear();
  }

  create(config: MatchConfig): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.resetSceneState();
    this.game.canvas.setAttribute('aria-label', 'Dimir combat arena');
    this.spectateAll = false;
    this.autoPassReactions = false;
    this.combatSpeed = 1;
    this.reducedMotion = isReducedMotion();
    this.time.timeScale = 1;
    this.tweens.timeScale = 1;
    this.anims.globalTimeScale = 1;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.anims.globalTimeScale = 1;
      this.scenarioNamePanel = undefined;
      this.scenarioNameEntry.destroy();
    });

    // Restrict the draft pool to the item sets chosen on the start screen.
    setActiveItemSets(config.itemSets ?? { original: true });
    // Keep spell availability in sync with the item-set toggle.
    setActiveSpellSets(config.itemSets ?? { original: true });

    // "Online" means a live relay connection is present. This is decoupled from
    // the game mode so co-op modes (swamprun) can also be networked.
    this.online = !!config.net;
    this.net = config.net ?? null;
    this.localTeam = config.localTeam ?? 1;
    this.localSeat = config.localSeat ?? this.localTeam - 1;
    this.opponentLeft = false;
    this.training = config.mode === 'training';
    this.scenarioLab = config.mode === 'scenario';
    this.memoryMode = config.mode === 'memory';
    this.memoryName = config.scenario?.name ?? '';
    this.expedition = config.mode === 'expedition';
    this.mineRun = config.mode === 'minerun';
    this.raid = config.mode === 'raid';
    this.raidBoss = config.raidBoss ?? 'deathknightSpear';
    this.raidTarget = undefined;
    this.raidVictory = false;
    this.raidPrepActive = this.raid;
    this.swamprun = config.mode === 'swamprun' || this.expedition || this.mineRun || this.raid;
    this.swampPrepMode = config.swampPrepMode ?? 'custom';

    const onlineName = (team: number): string =>
      team === this.localTeam ? `Player ${team} (You)` : `Player ${team}`;

    // Determine the combatants. An explicit seat list drives N-player matches;
    // otherwise fall back to the classic two-mage layout derived from mode.
    const seats: SeatConfig[] = config.seats?.length
      ? config.seats
      : this.swamprun
        ? [{ name: 'You', isAI: false, team: 1, loadout: config.loadouts[0], mageClass: config.classes?.[0] }]
        : [
          {
            name: this.online ? onlineName(1) : 'Player 1',
            isAI: false,
            team: 1,
            loadout: config.loadouts[0],
            mageClass: config.classes?.[0],
          },
          {
            name: this.online
              ? onlineName(2)
              : this.training
                ? 'Enemy'
                : config.mode === 'ai'
                  ? 'AI'
                  : 'Player 2',
            isAI: config.mode === 'ai' || this.training,
            team: 2,
            loadout: config.loadouts[1],
            mageClass: config.classes?.[1],
          },
        ];

    this.spawns = this.computeSpawns(seats.map((s) => s.team));
    // Legacy anchors kept for the two-mage training / soft-reset paths.
    this.playerSpawn = this.spawns[0] ?? { x: FIELD.x + 180, y: FIELD.y + FIELD.h / 2 };
    this.enemySpawn = this.spawns[1] ?? { x: FIELD.x + FIELD.w - 180, y: FIELD.y + FIELD.h / 2 };

    // A loaded memory fully describes its roster, so it replaces the drafted
    // seats: every combatant keeps the kit and the spot it was saved on.
    const scenario = config.scenario ?? null;
    if (scenario) this.spawns = scenario.entities.map((e) => ({ x: e.x, y: e.y }));

    const mages = scenario
      ? scenarioToMages(scenario, new Dice(config.seed))
      : seats.map(
        (s, i) =>
          new Mage({
            name: this.online && i === this.localSeat ? `${s.name} (You)` : s.name,
            isAI: s.isAI,
            team: s.team,
            position: { ...this.spawns[i] },
            loadout: s.loadout,
            mageClass: s.mageClass,
          })
      );

    this.gs = new GameState(mages, config.seed);
    this.combatFeedback = new CombatFeedbackLayer(this, () => this.reducedMotion);
    if (this.raid && this.raidBoss === 'reaper' && !canSpawnReaper(this.swamprunPartySize())) {
      this.raidBoss = 'lich';
      this.gs.log('The Reaper requires at least two party members. The Lich answers this solo Raid instead.');
    }
    if (scenario) {
      this.gs.restoreScarabs(scenarioToScarabs(scenario, mages));
      this.gs.restoreTurnOrder(scenario.turn.order, scenario.turn.rolls, scenario.turn.currentIndex);
      this.gs.round = scenario.turn.round;
      this.gs.turnSeq = scenario.turn.turnSeq;
    }
    // Swamprun is co-op survival: the run ends only when the whole party (team 1)
    // falls, never when a wave is merely cleared.
    if (this.swamprun) this.gs.coopSurvivalTeam = 1;
    this.gs.onLog = () => this.drawLog();
    this.gs.onMageDefeated = (target) => {
      this.queueCreatureDeath(target);
      this.playDeathBurst(target);
      this.showDefeatSeal(target);
      if (this.raid && target === this.raidTarget) {
        this.raidVictory = true;
        for (const enemy of this.gs.mages) {
          if (enemy.team !== 2 || enemy === target) continue;
          enemy.hp = 0;
          enemy.sanity = 0;
        }
        this.gs.coopSurvivalTeam = null;
        this.gs.log(`${target.name} falls. The raid is won.`);
      }
      if (
        !this.expedition ||
        target.team !== 2 ||
        !this.swamprunWaveEnemies.includes(target) ||
        this.swamprunWispCopies.has(target) ||
        this.expeditionXpEnemies.has(target)
      ) return;
      this.expeditionXpEnemies.add(target);
      this.addExpeditionXp(1);
      this.gs.log(`${target.name} defeated — +1 XP.`);
      this.updateWaveHud();
    };
    this.gs.vfxSink = {
      diceRoll: (spec, total, rolls, label, target) =>
        this.pendingDice.push({ spec, total, rolls, label, mage: target, seq: this.vfxSeq++ }),
      hit: (m) => this.playHit(m),
      dash: (mover, from) => {
        playSound('move.dash');
        this.animateDash(mover, from);
      },
      blink: (from, to, color) => {
        playSound('spell.blink');
        this.vfxBlink(from, to, color);
      },
      slash: (at, angle, size) => {
        playSound('melee.slash');
        void this.vfxSlash('fx-slash-arc', at, angle, size);
      },
      pull: (mover, from, to) => {
        playSound('spell.pull');
        return this.animateEdgelordPull(mover, from, to);
      },
      lightningBolt: async (from, to) => {
        // Any roll already made explains the bolt, so settle it before it flies.
        await this.playPendingDice();
        playSound('spell.lightning');
        return this.vfxLightningBolt(from, to);
      },
      spellEffect: (m, kind) => {
        if (kind === 'vanish') this.pendingSounds.push('spell.vanish');
        this.pendingEffects.push({ mage: m, kind });
      },
      drainParticles: (from, to) => {
        // A drain both siphons and corrodes, and both land with the particles.
        this.pendingSounds.push('spell.drain', 'spell.corrosive');
        this.pendingDrains.push({ from: { ...from }, to: { ...to } });
      },
      boomerang: (from, to, color, size, speed) => {
        playSound('melee.slash');
        return this.vfxBoomerang(from, to, color, size, speed);
      },
      summonPuff: (at, size) => {
        this.pendingSounds.push('spell.summon');
        this.pendingSummonPuffs.push({ at: { ...at }, size });
      },
      sigil: (at, color, size) => {
        playSound('spell.cast');
        this.impactFx?.sigil(at, color, size);
      },
      combatFeedback: (mage, feedback) => {
        this.playFeedbackSound(feedback);
        this.queueImpact(mage, feedback);
      },
      shatterBurst: (at, size) => {
        void this.vfxSpriteAt('fx-shatter', at, { lengthPx: size });
      },
      wedge: (apex, angle, halfAngle, range) => {
        this.vfxWedge(apex, angle, halfAngle, range);
      },
      lightningTrail: (segments) => this.setLightningTrail(segments),
      lightningDash: async (from, to, color) => {
        await this.playPendingDice();
        playSound('spell.lightning');
        return this.lightningFx?.dashStreak(from, to, color, FX_MOTION.dash.duration)
          ?? Promise.resolve();
      },
      lightningImpact: (at, color) => {
        playSound('spell.thunder');
        void this.lightningFx?.impact(at, color);
      },
      lightningCrash: async (at, color) => {
        await this.playPendingDice();
        playSound('spell.thunder');
        return this.lightningFx?.crash(at, color) ?? Promise.resolve();
      },
      clearLightningTrail: () => this.clearLightningTrail(),
      quarterTurn: (clockwise) => {
        playSound('spell.cast');
        this.vfxQuarterTurn(clockwise);
      },
      boom: () => this.pendingSounds.push('spell.explode'),
      thunder: () => playSound('spell.thunder'),
      twistRune: (pivot, radius, clockwise) => {
        playSound('spell.cast');
        this.vfxTwistRune(pivot, radius, clockwise);
      },
    };
    this.gs.subTargeter = {
      requestPoint: async (source, opts) => {
        await this.playPendingDice();
        return this.requestSubtargetPoint(source, opts);
      },
      requestEnemy: async (source, opts) => {
        await this.playPendingDice();
        return this.requestSubtargetEnemy(source, opts);
      },
      requestCombatant: async (source, opts) => {
        await this.playPendingDice();
        return this.requestSubtargetCombatant(source, opts);
      },
      reactionWindow: (source, label, at) => this.offerReactionWindow(source, label, { at }),
      resolveImpacts: () => this.resolveImpacts(),
    };
    for (const m of this.gs.mages) if (m.isAI) this.ais.set(m, new SimpleAI(this.gs, m));

    this.buildMageAnimations();
    this.lightningFx = new LightningFxDirector(this, () => this.reducedMotion);
    this.particleFx = new ParticleFx(this, () => this.reducedMotion);
    this.particleFx.setCombatSpeed(this.combatSpeed);
    this.impactFx = new ImpactFxDirector(
      this,
      this.particleFx,
      () => this.reducedMotion,
      () => this.combatSpeed,
    );
    this.buildHeldWeaponTextures();
    buildMineRoomTextures(this);
    this.buildStaticGraphics();
    this.buildHud();
    this.buildDicePanel();

    // Decode the scarab gif into animation frames (async, non-blocking).
    void this.loadScarabFrames();

    this.bindInput();

    if (this.net) {
      this.net.onClose = () => this.onOpponentLeft();
      // Tear the socket down if the player navigates away from the duel.
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.net?.close());
    }

    void this.beginDuel();
  }

  /**
   * Home positions for every seat given each seat's team. Two teams face off in
   * left / right columns; three or four teams take additional sides (top, then
   * bottom) so a free-for-all spreads combatants around the arena. Members of a
   * team stack along their side, centred on the anchor.
   */
  private computeSpawns(teams: number[]): Vec2[] {
    const cx = FIELD.x + FIELD.w / 2;
    const cy = FIELD.y + FIELD.h / 2;
    const sides: { anchor: Vec2; spread: Vec2 }[] = [
      { anchor: { x: FIELD.x + 180, y: cy }, spread: { x: 0, y: 130 } }, // left column
      { anchor: { x: FIELD.x + FIELD.w - 180, y: cy }, spread: { x: 0, y: 130 } }, // right column
      { anchor: { x: cx, y: FIELD.y + 120 }, spread: { x: 180, y: 0 } }, // top row
      { anchor: { x: cx, y: FIELD.y + FIELD.h - 120 }, spread: { x: 180, y: 0 } }, // bottom row
    ];
    const distinct = [...new Set(teams)];
    const teamSide = new Map<number, number>();
    distinct.forEach((t, i) => teamSide.set(t, i % sides.length));
    const totals = new Map<number, number>();
    for (const t of teams) totals.set(t, (totals.get(t) ?? 0) + 1);
    const placed = new Map<number, number>();
    return teams.map((t) => {
      const side = sides[teamSide.get(t)!];
      const total = totals.get(t)!;
      const idx = placed.get(t) ?? 0;
      placed.set(t, idx + 1);
      const offset = idx - (total - 1) / 2; // centre the column/row on the anchor
      return {
        x: side.anchor.x + side.spread.x * offset,
        y: side.anchor.y + side.spread.y * offset,
      };
    });
  }

  /** Roll the shared stat dice, run the assignment phase, then start the duel. */
  private async beginDuel(): Promise<void> {
    this.redraw();
    if (this.memoryMode) {
      this.restyleCreatureSprites();
      // A one-sided memory is a solo drill, not an instant win.
      const sides = new Set(
        this.gs.mages.filter((m) => !m.isSummon && m.alive).map((m) => m.team)
      );
      if (sides.size < 2) {
        this.gs.victorySuspended = true;
        this.gs.log('Only one side is present — victory checks are off. Press [P] to edit the fight.');
      }
      this.gs.log(
        `Memory loaded — "${this.memoryName}" (round ${this.gs.round}, ${this.gs.mages.length} entities).`
      );
      this.startTurn();
      return;
    }
    if (this.scenarioLab) {
      this.setupScenarioLab();
      this.gs.startRound();
      this.startTurn();
      return;
    }
    if (this.training) {
      this.setupTraining();
      this.gs.startRound();
      this.startTurn();
      return;
    }
    if (this.swamprun) {
      if (this.expedition) {
        await this.setupExpedition();
        this.startTurn();
        return;
      }
      if (this.swampPrepMode === 'custom') {
        await this.runAssignmentPhase();
        if (this.opponentLeft) return;
        await this.runSwamprunStartDraft();
        if (this.opponentLeft) return;
      } else if (this.swampPrepMode === 'creative') {
        await this.runCreativePrep();
        if (this.opponentLeft) return;
      } else {
        for (const mage of this.gs.mages) mage.assignFlatStats(4);
        this.gs.log('Quick start — all stats are 4 and the party enters without starting gear.');
      }
      if (this.mineRun) {
        await this.setupMineExploration();
        return;
      }
      this.setupSwamprun();
      this.startTurn();
      return;
    }
    await this.runAssignmentPhase();
    if (this.opponentLeft) return;
    await this.runShopPhase();
    if (this.opponentLeft) return;
    for (const m of this.gs.mages) m.resetDodges();
    for (const m of this.gs.mages) m.resetCombatReactions();
    this.gs.startRound();
    this.startTurn();
  }

  /** Training sandbox: give both mages flat stats and arm the default AI enemy. */
  private setupTraining(): void {
    for (const m of this.gs.mages) m.assignFlatStats(5);
    for (const m of this.gs.mages) m.resetDodges();
    for (const m of this.gs.mages) m.resetCombatReactions();
    this.applyTrainingEnemyKind(this.mageByTeam(2), this.trainEnemyKind);
    this.gs.log('Training sandbox — press [P] to open the training tools.');
  }

  /** Scenario Lab: playable mages with flat stats, ready to be reshaped by hand. */
  private setupScenarioLab(): void {
    // A fight under construction usually has one side only; let it be.
    this.gs.victorySuspended = true;
    for (const m of this.gs.mages) {
      if (!m.statsAssigned) m.assignFlatStats(5);
      m.resetDodges();
      m.resetCombatReactions();
    }
    this.gs.log('Scenario Lab — press [P] to add entities, move them, kit them out, and save.');
    this.gs.log('Victory checks are off while you build; switch them on in the lab to test the fight.');
  }

  /** Re-apply creature tints/scales after a roster arrives without spawn calls. */
  private restyleCreatureSprites(): void {
    this.syncMageSprites();
    for (const m of this.gs.mages) {
      if (m.mine) this.styleMineEnemySprite(m);
      else if (m.enemyKind && m.enemyKind in ENEMY_DEFS) {
        this.styleEnemySprite(m, m.enemyKind as EnemyKind);
      }
    }
  }

  // ===========================================================================
  //  SWAMPRUN  (endless PvE survival)
  // ===========================================================================

  /** Arm the party of survivors and unleash the first wave. */
  private setupSwamprun(): void {
    this.swamprunWave = 0;
    this.swamprunEncounterPower = 0;
    this.swamprunCurse = undefined;
    this.swamprunGold = 0;
    for (const mage of this.gs.mages) mage.swamprunCurse = undefined;
    this.gs.log(
      this.mineRun
        ? 'Mine Run — stone shifts in the dark. Survive as long as you can.'
        : this.raid
          ? `Raid — prepare against the effigies, then summon ${ENEMY_DEFS[this.raidBoss].name} when you are ready.`
          : 'Swamprun — the swamp stirs. Survive as long as you can.'
    );
    this.spawnWave(1);
  }

  /** Enter the maze before any combat exists; enemy rooms start fights on demand. */
  private async setupMineExploration(): Promise<void> {
    this.swamprunWave = 0;
    this.swamprunGold = 0;
    this.swamprunWaveEnemies = [];
    this.swamprunWispCopies.clear();
    this.swamprunArrowsOwned.clear();
    this.mineMaze = createMineMaze(this.gs.rng);
    this.mineExploring = true;
    this.mineInCombat = false;
    this.mineRunEnded = false;
    this.mineActiveRoomId = null;
    this.minePickaxes = [2];
    this.mineChestCursor = 0;
    this.mode = 'shop';
    this.gs.log('Mine Run — the party enters a branching tunnel with one worn pickaxe (2 durability).');
    this.updateWaveHud();
    this.redraw();
    await this.runMineExploration();
  }

  private async runMineExploration(): Promise<void> {
    while (
      !this.mineRunEnded &&
      !this.opponentLeft &&
      this.mineMaze &&
      this.gs.mages.some((mage) => mage.team === 1 && mage.alive && !mage.isSummon)
    ) {
      const node = currentMineNode(this.mineMaze);
      const direction = await this.promptMineDirection(node);
      if (!direction || this.mineRunEnded || this.opponentLeft) return;
      await this.travelMineTunnel(direction);
    }
  }

  /** Traverse a passage and handle the arrival before asking for another route. */
  private async travelMineTunnel(direction: MineDirection): Promise<void> {
    if (!this.mineMaze || this.mineRunEnded) return;
    this.hideMinePanel();
    this.gs.log(`The party follows the ${MINE_DIRECTION_LABEL[direction].toLowerCase()} tunnel.`);
    const result = travelMineMaze(this.mineMaze, direction, this.gs.rng);
    this.updateWaveHud();
    if (result.trap) await this.resolveMineTrap(result.trap);
    if (this.mineRunEnded || this.opponentLeft) return;
    if (
      result.node.kind === 'room' &&
      result.node.room &&
      mineRoomNeedsInteraction(result.node.room)
    ) {
      await this.handleMineRoomArrival(result.node, result.node.room);
    }
  }

  /** Resolve one passage's predetermined trap, including light-assisted warning and evasion. */
  private async resolveMineTrap(spec: MineTrapDamage): Promise<void> {
    const party = this.gs.mages.filter(
      (mage) => mage.team === 1 && mage.alive && !mage.isSummon
    );
    if (party.length === 0) return;
    const target = this.gs.rng.pick(party);
    const hasActiveLight = party.some((mage) => mage.lightRadius() > 0);
    const { spotted, dodgeChance, dodged } = rollMineTrapAvoidance(hasActiveLight, this.gs.rng);
    if (spotted) {
      this.gs.log(`The party's light reveals a ${spec} tunnel trap before it springs.`);
      await this.promptMineChoice(
        'TRAP SPOTTED',
        `Active light reveals the mechanism  •  ${Math.round(dodgeChance * 100)}% evade chance`,
        `${target.name} sees the danger in time and prepares to cross the trapped passage.`,
        [{ id: 'dodge', label: 'Attempt to evade', color: '#9fe6a0' }]
      );
      if (this.mineRunEnded || this.opponentLeft) return;
    }
    if (dodged) {
      this.gs.log(`${target.name} evades the ${spec} tunnel trap. The mechanism is spent.`);
      await this.promptMineChoice(
        spotted ? 'TRAP EVADED' : 'LAST-SECOND DODGE',
        `${Math.round(dodgeChance * 100)}% evade chance succeeded.`,
        `${target.name} escapes unharmed. This passage's trap cannot trigger again.`,
        [{ id: 'continue', label: 'Keep moving', color: '#9fe6a0' }]
      );
      return;
    }
    const amount = this.gs.rng.roll(spec).total;
    const hpBefore = target.hp;
    if (amount >= hpBefore) {
      this.gs.defeatMage(
        target,
        target,
        `${target.name} triggers a tunnel trap (${spec} = ${amount}) and falls.`
      );
    } else {
      target.hp -= amount;
      this.gs.log(`${target.name} triggers a tunnel trap: ${spec} rolls ${amount} damage.`);
      this.gs.vfxSink?.hit?.(target);
    }
    this.flushHits();
    this.redraw();
    if (this.gs.isOver) {
      this.endGame();
      return;
    }
    await this.promptMineChoice(
      spotted ? 'TRAP SPRINGS' : 'TUNNEL TRAP',
      `${Math.round(dodgeChance * 100)}% evade chance failed  •  ${spec} rolled ${amount} damage.`,
      `${target.name} has ${target.hp}/${target.maxHp} HP remaining. The spent mechanism cannot trigger again.`,
      [{ id: 'continue', label: 'Keep moving', color: '#ffcf7a' }]
    );
  }

  /** Rooms stay opaque at the threshold; only hostile presence is disclosed. */
  private async handleMineRoomArrival(node: MineMazeNode, room: MineRoomState): Promise<void> {
    const known = room.entered;
    const enemiesInside = room.kind === 'enemies' && !room.resolved;
    const knownName = room.kind === 'ore' && room.oreKind
      ? `${MINE_ORE_DEFS[room.oreKind].name} deposit`
      : MINE_ROOM_VISUAL_LABEL[room.kind].toLowerCase();
    const warning = known
      ? `The charted ${knownName} lies beyond this threshold.`
      : enemiesInside
        ? 'You hear movement inside. Enemies are waiting in this room.'
        : 'No enemies can be heard. Whatever else is inside remains hidden.';
    const choices: MinePromptChoice[] = [
      { id: 'enter', label: room.entered ? 'Enter again' : 'Enter room', color: '#9fe6a0' },
    ];
    if (this.mineMaze?.arrivedVia) {
      choices.push({ id: 'turn', label: 'Turn around', color: '#ffcf7a' });
    }
    const choice = await this.promptMineChoice(
      `ROOM THRESHOLD  //  STEP ${this.mineMaze?.steps ?? 0}`,
      warning,
      known
        ? 'Enter the known room again, or retrace the tunnel you just used.'
        : 'The doorway blocks your view. Enter to reveal the room, or retrace the tunnel you just used.',
      choices,
      known ? room : 'hidden'
    );
    if (choice === 'turn' && this.mineMaze?.arrivedVia) {
      await this.travelMineTunnel(MINE_OPPOSITE_DIRECTION[this.mineMaze.arrivedVia]);
      return;
    }
    if (choice !== 'enter') return;
    room.entered = true;
    await this.resolveMineRoom(node, room);
  }

  private async resolveMineRoom(node: MineMazeNode, room: MineRoomState): Promise<void> {
    if (room.kind === 'enemies' && !room.resolved) {
      await this.startMineRoomCombat(node);
      return;
    }
    if (room.resolved) {
      const description = room.kind === 'enemies'
        ? 'Only the remains of the defeated encounter are left.'
        : room.kind === 'treasure'
          ? 'The opened chest is empty.'
          : room.kind === 'ore'
            ? 'The ore deposit has been exhausted.'
            : 'The room has already been searched.';
      await this.promptMineChoice(
        'SEARCHED ROOM',
        description,
        'Nothing else demands attention. The party returns to the exits.',
        [{ id: 'continue', label: 'Choose a path', color: '#9fe6a0' }],
        room
      );
      return;
    }
    if (room.kind === 'empty') {
      room.resolved = true;
      this.gs.log('The party searches the empty chamber and continues through it.');
      return;
    }
    if (room.kind === 'treasure') {
      await this.resolveMineTreasure(room);
      return;
    }
    if (room.kind === 'ore') {
      await this.resolveMineOreRoom(room);
      return;
    }
    await this.runMineRoomShop(room);
  }

  private async resolveMineTreasure(room: MineRoomState): Promise<void> {
    const gold = this.gs.rng.roll('1d6+2').total;
    this.swamprunGold += gold;
    const recipients = this.gs.mages.filter(
      (mage) => mage.team === 1 && mage.alive && !mage.isSummon
    );
    let itemText = 'No usable item remained inside.';
    if (recipients.length > 0) {
      const recipient = recipients[this.mineChestCursor % recipients.length];
      this.mineChestCursor += 1;
      const rarity = rollRarity(() => this.gs.rng.float(), recipient.maxLuck, true);
      const item = draftChoices(rarity, () => this.gs.rng.float(), 1, true)[0];
      if (item) {
        this.gs.grantItem(recipient, item);
        itemText = `${recipient.name} receives ${getItem(item).name} (${rarity}).`;
      }
    }
    room.resolved = true;
    this.gs.log(`The party opens a mine chest: ${gold}g. ${itemText}`);
    this.updateWaveHud();
    await this.promptMineChoice(
      'TREASURE CHEST',
      `Recovered ${gold}g for the party.`,
      itemText,
      [{ id: 'continue', label: 'Leave the chest', color: '#ffd978' }],
      room
    );
  }

  private async resolveMineOreRoom(room: MineRoomState): Promise<void> {
    const oreKind = room.oreKind ?? 'coal';
    const ore = MINE_ORE_DEFS[oreKind];
    const amount = revealMineOre(room, this.gs.rng);
    const choice = await this.promptMineChoice(
      `${ore.name.toUpperCase()} DEPOSIT`,
      `d3 reveals ${amount} vein${amount === 1 ? '' : 's'}  •  Mining value ${ore.miningValue}  •  Collapse after ${ore.failCount} failed strikes`,
      this.minePickaxes.length
        ? `Pickaxe durability: ${this.minePickaxes.join(', ')}. Each vein receives repeated d20 strikes until its total reaches ${ore.miningValue}. A natural 1 or 2 costs one durability.`
        : 'The party has no pickaxe. This deposit can be left intact and mined after finding a shop.',
      [
        { id: 'mine', label: 'Mine the deposit', color: '#ffd978', enabled: this.minePickaxes.length > 0 },
        { id: 'leave', label: 'Leave it intact', color: '#9fdcff' },
      ],
      room
    );
    if (choice !== 'mine') return;

    const result = resolveMineOre(oreKind, amount, this.minePickaxes, this.gs.rng);
    this.minePickaxes = result.pickaxes;
    this.swamprunGold += result.gold;
    const remaining = Math.max(0, amount - result.extracted - result.collapsed);
    room.oreAmount = remaining;
    room.resolved = remaining === 0;
    const summary = this.mineOreRollSummary(result);
    this.gs.log(
      `${ore.name} mining: ${result.extracted} extracted, ${result.collapsed} collapsed, ${remaining} left; +${result.gold}g. Pickaxes: ${this.minePickaxes.join(', ') || 'none'}.`
    );
    this.updateWaveHud();
    await this.promptMineChoice(
      `${ore.name.toUpperCase()} MINING RESULT`,
      `${result.extracted} extracted  •  ${result.collapsed} collapsed  •  ${remaining} left  •  +${result.gold}g`,
      `${summary}\n\nPickaxe durability: ${this.minePickaxes.join(', ') || 'none'}.`,
      [{ id: 'continue', label: remaining > 0 ? 'Leave remaining ore' : 'Leave the deposit', color: '#9fe6a0' }],
      room
    );
  }

  private mineOreRollSummary(result: MineOreResult): string {
    const byVein = new Map<number, MineOreResult['rolls']>();
    for (const record of result.rolls) {
      const entries = byVein.get(record.vein) ?? [];
      entries.push(record);
      byVein.set(record.vein, entries);
    }
    return [...byVein.entries()].map(([vein, records]) => {
      const faces = records
        .filter((record) => record.roll > 0)
        .map((record) => `${record.roll}${record.durabilityLost ? '*' : ''}`)
        .join(' + ');
      const last = records[records.length - 1];
      return `Vein ${vein}: ${faces || 'no roll'} = ${last?.progress ?? 0}  [${last?.outcome ?? 'unfinished'}]`;
    }).join('\n');
  }

  private async runMineRoomShop(room: MineRoomState): Promise<void> {
    for (;;) {
      const choice = await this.promptMineChoice(
        'MINE SUPPLY ROOM',
        `Party gold: ${this.swamprunGold}g  •  Pickaxes: ${this.minePickaxes.join(', ') || 'none'}`,
        `A new pickaxe costs ${MINE_PICKAXE_COST}g and begins at 10 durability. The supply counter carries the complete Swamp Run shop stock.`,
        [
          {
            id: 'pickaxe',
            label: `Buy pickaxe  ${MINE_PICKAXE_COST}g`,
            color: '#ffd978',
            enabled: this.swamprunGold >= MINE_PICKAXE_COST,
          },
          { id: 'supplies', label: 'Browse supplies', color: '#9fe6a0' },
          { id: 'leave', label: 'Leave shop', color: '#9fdcff' },
        ],
        room
      );
      if (choice === 'pickaxe' && this.swamprunGold >= MINE_PICKAXE_COST) {
        this.swamprunGold -= MINE_PICKAXE_COST;
        this.minePickaxes.push(10);
        this.gs.log(`The party buys a pickaxe for ${MINE_PICKAXE_COST}g (10 durability).`);
        this.updateWaveHud();
        continue;
      }
      if (choice === 'supplies') {
        await this.runSwamprunShop();
        continue;
      }
      return;
    }
  }

  private async startMineRoomCombat(node: MineMazeNode): Promise<void> {
    this.hideMinePanel();
    this.mineExploring = false;
    this.mineInCombat = true;
    this.mineActiveRoomId = node.id;
    await new Promise<void>((resolve) => {
      this.mineCombatResolve = resolve;
      this.spawnWave(this.swamprunWave + 1);
      void this.startTurn();
    });
    if (this.mineRunEnded || this.opponentLeft) return;
    this.mineExploring = true;
    this.mode = 'shop';
    this.gs.log('The room falls quiet. The party can choose any passage leading away.');
    this.redraw();
  }

  private async promptMineDirection(node: MineMazeNode): Promise<MineDirection | null> {
    const available = MINE_DIRECTIONS.filter((direction) =>
      Object.prototype.hasOwnProperty.call(node.exits, direction)
    );
    if (available.length === 0) return null;
    const title = node.kind === 'room'
      ? `LEAVE ROOM  //  STEP ${this.mineMaze?.steps ?? 0}`
      : `MINE MAP  //  STEP ${this.mineMaze?.steps ?? 0}`;
    const subtitle = `Encounters cleared: ${this.swamprunWave}  •  Party gold: ${this.swamprunGold}g  •  Pickaxes: ${this.minePickaxes.length ? this.minePickaxes.join('/') : 'none'}`;
    this.mode = 'shop';
    if (this.online && this.localSeat !== 0) {
      this.drawMineNavigationPrompt(node, title, `${subtitle}  •  Waiting for the party leader.`, false);
      for (;;) {
        const message = await this.net!.recv();
        if (message.k === 'bye') return null;
        if (message.k !== 'mine-choice' || typeof message.choice !== 'string') continue;
        return available.includes(message.choice as MineDirection)
          ? message.choice as MineDirection
          : available[0];
      }
    }
    this.drawMineNavigationPrompt(node, title, subtitle, true);
    return new Promise<MineDirection>((resolve) => {
      this.mineChoiceResolve = (choice) => {
        const direction = available.includes(choice as MineDirection)
          ? choice as MineDirection
          : available[0];
        if (this.online) this.net?.send({ k: 'mine-choice', choice: direction });
        this.mineChoiceResolve = null;
        this.hideMinePanel();
        resolve(direction);
      };
    });
  }

  /** One host-led maze choice; every peer then performs the same seeded work. */
  private async promptMineChoice(
    title: string,
    subtitle: string,
    body: string,
    choices: MinePromptChoice[],
    visual?: MinePromptVisual
  ): Promise<string> {
    const available = choices.filter((choice) => choice.enabled !== false);
    if (available.length === 0) return '';
    this.mode = 'shop';
    if (this.online && this.localSeat !== 0) {
      this.drawMinePrompt(title, `${subtitle}  •  Waiting for the party leader.`, body, [], visual);
      for (;;) {
        const message = await this.net!.recv();
        if (message.k === 'bye') return '';
        if (message.k !== 'mine-choice' || typeof message.choice !== 'string') continue;
        return available.some((choice) => choice.id === message.choice)
          ? message.choice
          : available[0].id;
      }
    }
    this.drawMinePrompt(title, subtitle, body, choices, visual);
    return new Promise<string>((resolve) => {
      this.mineChoiceResolve = (choice) => {
        if (this.online) this.net?.send({ k: 'mine-choice', choice });
        this.mineChoiceResolve = null;
        this.hideMinePanel();
        resolve(choice);
      };
    });
  }

  private drawMinePrompt(
    title: string,
    subtitle: string,
    body: string,
    choices: MinePromptChoice[],
    visual?: MinePromptVisual
  ): void {
    this.hideMinePanel();
    const kind: MineRoomVisualKind | null = visual
      ? visual === 'hidden' ? 'hidden' : visual.kind
      : null;
    const visualLabel = visual && kind
      ? visual !== 'hidden' && visual.kind === 'ore' && visual.oreKind
        ? `${MINE_ORE_DEFS[visual.oreKind].name} deposit`
        : MINE_ROOM_VISUAL_LABEL[kind]
      : null;
    this.minePanel = new MinePromptView(this, {
      title,
      subtitle,
      body,
      visual: kind && visualLabel ? {
        artKey: mineRoomTextureKey(kind),
        iconKey: mineRoomIconTextureKey(kind),
        label: visualLabel,
        hidden: kind === 'hidden',
      } : undefined,
      choices: choices.map((choice) => ({
        id: choice.id,
        label: choice.label,
        enabled: choice.enabled !== false,
      })),
    }, (choice) => this.mineChoiceResolve?.(choice));
  }

  private drawMineNavigationPrompt(
    node: MineMazeNode,
    title: string,
    subtitle: string,
    interactive: boolean
  ): void {
    this.hideMinePanel();
    const panel = this.add.container(0, 0).setDepth(99);
    this.minePanel = panel;
    this.mineMapVisible = true;
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;
    addCabinetBackdrop(this, panel);
    const heading = this.add.text(58, 42, title, {
      fontFamily: MENU_FONT.display,
      fontSize: '28px',
      fontStyle: 'bold',
      color: MENU_HEX.bone,
    });
    const subheading = this.add.text(60, 82, subtitle, {
      fontFamily: MENU_FONT.body,
      fontSize: '14px',
      color: MENU_HEX.boneDim,
      fixedWidth: 900,
    });
    panel.add([heading, subheading]);
    addSectionRule(this, panel, 58, 112, 1164);
    this.drawMineNavigationMap(panel, node, interactive);
    panel.add(
      this.add
        .text(cx, cy + 242, interactive ? 'Choose a highlighted route.' : 'The party leader is choosing a route.', {
          fontFamily: MENU_FONT.control,
          fontSize: '15px',
          color: interactive ? MENU_HEX.bone : MENU_HEX.boneDim,
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
    );
    const inventory = new CabinetChip(this, cx + 350, cy + 222, {
      width: 160,
      height: 40,
      label: 'Inventory',
      onActivate: () => this.toggleInventory(),
    });
    panel.add(inventory);
  }

  /** Draw the complete discovered maze; only exits touching `node` are selectable. */
  private drawMineNavigationMap(
    panel: Phaser.GameObjects.Container,
    node: MineMazeNode,
    interactive: boolean
  ): void {
    if (!this.mineMaze) return;
    const maze = this.mineMaze;
    const nodes = Object.values(maze.nodes);
    const currentRoom = node.kind === 'room' && node.room?.entered ? node.room : undefined;
    const previewWidth = currentRoom ? 220 : 0;
    const mapWidth = 1000;
    const mapHeight = 390;
    const mapCenterX = GAME_WIDTH / 2;
    const mapCenterY = GAME_HEIGHT / 2 + 8;
    const frame = this.add
      .rectangle(mapCenterX, mapCenterY, mapWidth, mapHeight, MENU_COLOR.charcoal, 1)
      .setStrokeStyle(1, MENU_COLOR.brassDark, 1);
    const title = this.add.text(
      mapCenterX - mapWidth / 2 + 14,
      mapCenterY - mapHeight / 2 + 10,
      'DISCOVERED MINE',
      { fontFamily: MENU_FONT.control, fontSize: '11px', color: MENU_HEX.brassLight, fontStyle: 'bold' }
    );
    const north = this.add
      .text(mapCenterX + mapWidth / 2 - previewWidth - 18, mapCenterY - mapHeight / 2 + 8, 'N', {
        fontFamily: MENU_FONT.control,
        fontSize: '13px',
        color: MENU_HEX.verdigris,
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);
    const graphics = this.add.graphics();
    panel.add([frame, title, north, graphics]);

    if (currentRoom) {
      const kind = currentRoom.kind;
      const previewLeft = mapCenterX + mapWidth / 2 - previewWidth;
      const artX = previewLeft + previewWidth / 2;
      const artY = mapCenterY - 38;
      const roomName = kind === 'ore' && currentRoom.oreKind
        ? `${MINE_ORE_DEFS[currentRoom.oreKind].name} deposit`
        : MINE_ROOM_VISUAL_LABEL[kind];
      const roomState = kind === 'shop'
        ? 'SUPPLIES AVAILABLE'
        : kind === 'ore'
          ? currentRoom.resolved ? 'EXHAUSTED' : 'VEIN AVAILABLE'
          : kind === 'enemies'
            ? currentRoom.resolved ? 'CLEARED' : 'HOSTILE'
            : kind === 'treasure'
              ? currentRoom.resolved ? 'OPENED' : 'UNCLAIMED'
              : 'SEARCHED';
      graphics.lineStyle(1, MENU_COLOR.brassDark, 1).lineBetween(
        previewLeft,
        mapCenterY - mapHeight / 2 + 38,
        previewLeft,
        mapCenterY + mapHeight / 2 - 16
      );
      const previewTitle = this.add
        .text(artX, mapCenterY - mapHeight / 2 + 19, 'CURRENT ROOM', {
          fontFamily: MENU_FONT.control,
          fontSize: '11px',
          color: MENU_HEX.brassLight,
          fontStyle: 'bold',
        })
        .setOrigin(0.5);
      const artFrame = this.add
        .rectangle(artX, artY, 198, 119, MENU_COLOR.woodDeep, 1)
        .setStrokeStyle(2, MENU_COLOR.brass, 1);
      const art = this.add.image(artX, artY, mineRoomTextureKey(kind)).setDisplaySize(184, 105);
      const roomIcon = this.add
        .image(artX, mapCenterY + 34, mineRoomIconTextureKey(kind))
        .setDisplaySize(24, 24);
      const roomLabel = this.add
        .text(artX, mapCenterY + 57, roomName.toUpperCase(), {
          fontFamily: MENU_FONT.control,
          fontSize: '13px',
          color: MENU_HEX.bone,
          fontStyle: 'bold',
          align: 'center',
          wordWrap: { width: 190 },
        })
        .setOrigin(0.5, 0);
      const stateLabel = this.add
        .text(artX, mapCenterY + 95, roomState, {
          fontFamily: MENU_FONT.control,
          fontSize: '11px',
          color: MENU_HEX.boneDim,
          fontStyle: 'bold',
        })
        .setOrigin(0.5);
      panel.add([previewTitle, artFrame, art, roomIcon, roomLabel, stateLabel]);
    }

    const stubs: { x: number; y: number }[] = [];
    for (const node of nodes) {
      for (const direction of MINE_DIRECTIONS) {
        if (!Object.prototype.hasOwnProperty.call(node.exits, direction)) continue;
        if (node.exits[direction] != null) continue;
        const vector = MINE_DIRECTION_VECTOR[direction];
        stubs.push({ x: node.mapX + vector.x * 0.55, y: node.mapY + vector.y * 0.55 });
      }
    }
    const allPoints = [
      ...nodes.map((node) => ({ x: node.mapX, y: node.mapY })),
      ...stubs,
    ];
    const minX = Math.min(...allPoints.map((point) => point.x));
    const maxX = Math.max(...allPoints.map((point) => point.x));
    const minY = Math.min(...allPoints.map((point) => point.y));
    const maxY = Math.max(...allPoints.map((point) => point.y));
    const drawableWidth = mapWidth - 80 - previewWidth;
    const drawableHeight = mapHeight - 76;
    const scale = Math.min(
      78,
      drawableWidth / Math.max(1, maxX - minX),
      drawableHeight / Math.max(1, maxY - minY)
    );
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const plotCenterX = mapCenterX - previewWidth / 2;
    const toScreen = (x: number, y: number): Vec2 => ({
      x: plotCenterX + (x - centerX) * scale,
      y: mapCenterY + 12 + (y - centerY) * scale,
    });

    const drawnEdges = new Set<string>();
    graphics.lineStyle(3, MENU_COLOR.woodEdge, 0.9);
    for (const node of nodes) {
      for (const direction of MINE_DIRECTIONS) {
        const destinationId = node.exits[direction];
        if (destinationId == null) continue;
        const key = [node.id, destinationId].sort((a, b) => a - b).join(':');
        if (drawnEdges.has(key)) continue;
        const destination = maze.nodes[destinationId];
        if (!destination) continue;
        drawnEdges.add(key);
        const from = toScreen(node.mapX, node.mapY);
        const to = toScreen(destination.mapX, destination.mapY);
        graphics.lineBetween(from.x, from.y, to.x, to.y);
      }
    }

    for (const node of nodes) {
      const from = toScreen(node.mapX, node.mapY);
      for (const direction of MINE_DIRECTIONS) {
        if (!Object.prototype.hasOwnProperty.call(node.exits, direction)) continue;
        if (node.exits[direction] != null) continue;
        const vector = MINE_DIRECTION_VECTOR[direction];
        const to = toScreen(node.mapX + vector.x * 0.55, node.mapY + vector.y * 0.55);
        const selectable = node.id === maze.currentNodeId;
        graphics.lineStyle(
          selectable ? 3 : 2,
          selectable ? MENU_COLOR.brass : MENU_COLOR.disabled,
          selectable ? 1 : 0.55,
        );
        for (let dash = 0; dash < 3; dash++) {
          const start = dash / 3;
          const end = Math.min(1, start + 0.19);
          graphics.lineBetween(
            from.x + (to.x - from.x) * start,
            from.y + (to.y - from.y) * start,
            from.x + (to.x - from.x) * end,
            from.y + (to.y - from.y) * end
          );
        }
        graphics.fillStyle(selectable ? MENU_COLOR.brass : MENU_COLOR.disabled, selectable ? 1 : 0.7)
          .fillCircle(to.x, to.y, 3);
      }
    }

    const roomIcons: Phaser.GameObjects.Image[] = [];
    for (const node of nodes) {
      const point = toScreen(node.mapX, node.mapY);
      const room = node.room;
      const color = room?.entered
        ? room.kind === 'enemies'
          ? room.resolved ? 0x79c89a : 0xe66d6d
          : room.kind === 'treasure'
            ? 0xe4c160
            : room.kind === 'ore'
              ? 0xb9875b
              : room.kind === 'shop'
                ? MENU_COLOR.verdigris
                : MENU_COLOR.boneDim
        : node.id === 0 ? MENU_COLOR.brassLight : MENU_COLOR.boneDim;
      graphics.fillStyle(color, 1);
      graphics.lineStyle(2, MENU_COLOR.bone, 0.9);
      if (node.kind === 'room') {
        graphics.fillRect(point.x - 9, point.y - 9, 18, 18);
        graphics.strokeRect(point.x - 10, point.y - 10, 20, 20);
        const iconKind: MineRoomVisualKind = room?.entered ? room.kind : 'hidden';
        roomIcons.push(
          this.add
            .image(point.x, point.y, mineRoomIconTextureKey(iconKind))
            .setDisplaySize(14, 14)
        );
      } else {
        graphics.fillCircle(point.x, point.y, 6);
        graphics.strokeCircle(point.x, point.y, 7);
      }
      if (node.id === maze.currentNodeId) {
        graphics.lineStyle(3, MENU_COLOR.brassLight, 1).strokeCircle(point.x, point.y, 12);
      }
    }
    panel.add(roomIcons);

    const currentPoint = toScreen(node.mapX, node.mapY);
    for (const direction of MINE_DIRECTIONS) {
      if (!Object.prototype.hasOwnProperty.call(node.exits, direction)) continue;
      const destinationId = node.exits[direction];
      const vector = MINE_DIRECTION_VECTOR[direction];
      const targetNode = destinationId == null ? undefined : maze.nodes[destinationId];
      const targetPoint = targetNode
        ? toScreen(targetNode.mapX, targetNode.mapY)
        : toScreen(node.mapX + vector.x * 0.55, node.mapY + vector.y * 0.55);
      if (targetNode) {
        graphics.lineStyle(4, MENU_COLOR.brass, 0.95).lineBetween(
          currentPoint.x,
          currentPoint.y,
          targetPoint.x,
          targetPoint.y
        );
      }
      graphics.lineStyle(3, MENU_COLOR.brassLight, 1).strokeCircle(targetPoint.x, targetPoint.y, 15);
      const labelX = targetPoint.x + vector.x * 25;
      const labelY = targetPoint.y + vector.y * 21;
      const label = this.add
        .text(labelX, labelY, direction, {
          fontFamily: MENU_FONT.control,
          fontSize: '12px',
          color: MENU_HEX.brassLight,
          backgroundColor: '#17110d',
          fontStyle: 'bold',
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0.5);
      panel.add(label);
      if (!interactive) continue;
      const choose = (): void => this.mineChoiceResolve?.(direction);
      const hit = this.add
        .circle(targetPoint.x, targetPoint.y, 18, MENU_COLOR.brass, 0.12)
        .setStrokeStyle(2, MENU_COLOR.brassLight, 0.9)
        .setInteractive({ useHandCursor: true });
      hit.on('pointerdown', choose);
      hit.on('pointerover', () => hit.setFillStyle(MENU_COLOR.brass, 0.3));
      hit.on('pointerout', () => hit.setFillStyle(MENU_COLOR.brass, 0.12));
      label.setInteractive({ useHandCursor: true }).on('pointerdown', choose);
      panel.add(hit);
      panel.bringToTop(label);
    }
  }

  private hideMinePanel(): void {
    const inventoryWasOpen = this.mineMapVisible && this.mode === 'inventory';
    this.minePanel?.destroy();
    this.minePanel = undefined;
    this.mineMapVisible = false;
    if (inventoryWasOpen) {
      this.invPanel?.destroy();
      this.invPanel = undefined;
      this.mode = 'shop';
    }
  }

  private async setupExpedition(): Promise<void> {
    this.swamprunInterludeActive = false;
    this.swamprunWave = 0;
    this.swamprunGold = 0;
    this.swamprunArrowsOwned.clear();
    this.expeditionGold.clear();
    this.expeditionLevel = 1;
    this.expeditionXp = 0;
    this.expeditionPendingLevels = 0;
    this.expeditionXpEnemies.clear();
    this.expeditionRunDepth = 0;
    this.expeditionRetreating = false;
    this.expeditionRetreatCursor = 0;
    this.expeditionTownPanel = undefined;
    this.expeditionTownResolve = null;
    this.expeditionTownTab = 'potions';
    this.expeditionTownPage = 0;
    this.expeditionTownMessage = '';
    this.expeditionTownBuyer = null;
    this.expeditionPermanentRecruits.clear();
    this.expeditionRunRecruits.clear();
    this.expeditionCompanions.clear();
    const players = this.gs.mages.filter((mage) => mage.team === 1 && !mage.isAI && !mage.expeditionCompanion);
    for (const player of players) {
      this.expeditionGold.set(player, 0);
      const words = player.loadout.filter((word) => !isModifierWord(word)).slice(0, 3);
      const modifier = player.loadout.find(isModifierWord);
      player.setLoadout(modifier ? [...words, modifier] : words, null, null);
      player.assignFlatStats(3);
      this.gs.grantItem(player, 'torch');
      player.equipHand('torch');
      this.gs.notifyLightActivation(player);
      await this.syncExpeditionPlayerChoice(player, async () => {
        await this.promptExpeditionColorIdentity(player);
      });
    }
    this.gs.log('Expedition — enter the swamp, choose your depth, and make it back alive.');
    this.spawnWave(1);
  }

  /** Spawn the roster for the next wave and refresh the board. */
  private spawnWave(n: number): void {
    this.swamprunWave = n;
    if (this.expedition && !this.expeditionRetreating) {
      this.expeditionRunDepth = Math.max(this.expeditionRunDepth, n);
    }
    this.swamprunWaveEnemies = [];
    this.swamprunWispCopies.clear();
    this.expeditionXpEnemies.clear();
    // Build a genuinely fresh combat around the surviving, persistent party.
    this.beginWaveCombat(n);
    const partySize = this.expedition ? 1 : this.swamprunPartySize();
    if (this.raid) {
      const def = ENEMY_DEFS[this.raidBoss];
      if (this.raidPrepActive) {
        this.swamprunEncounterPower = def.power;
        this.gs.log(
          `— RAID PREPARATION — equip your gear and build your stacks on the effigies. They cannot fight back and always return. Health, mana, and word charges refill for free from the action menu; summon ${def.name} there when you are ready. —`
        );
        for (let i = 0; i < RAID_PREP_EFFIGIES; i++) this.spawnRaidEffigy();
      } else {
        this.swamprunEncounterPower = def.power;
        this.gs.log(`— RAID: ${def.name} —`);
        this.raidTarget = this.spawnEnemy(this.raidBoss);
      }
    } else if (this.mineRun) {
      const spawns = mineWaveComposition(n, this.gs.rng, partySize);
      this.gs.log(`— Mine encounter ${n}: ${spawns.length} foe${spawns.length === 1 ? '' : 's'} in the room —`);
      for (const spawn of spawns) this.spawnMineEnemy(spawn);
    } else {
      const encounter = rollSwamprunEncounter(n, this.gs.rng, partySize);
      this.swamprunEncounterPower = encounter.power;
      const region = encounter.deep ? 'Deep Swamps' : 'Standard Swamps';
      this.gs.log(
        `— ${region}, ${encounter.depth}m — Power ${encounter.power}; ${encounter.kinds.length} foe${encounter.kinds.length === 1 ? '' : 's'} emerge! —`
      );
      for (const kind of encounter.kinds) this.spawnEnemy(kind);
    }
    // The complete roster now exists: reset round/turn state and roll everyone
    // into a new initiative order before the first turn starts.
    this.gs.startNewCombat({ preserveScarabs: true });
    this.updateWaveHud();
    this.redraw();
  }

  /**
   * Keep run progression, but discard the previous combat roster and restore
   * every survivor's combat-scoped state before assembling the next wave.
   */
  private beginWaveCombat(n: number): void {
    const oldRoster = [...this.gs.mages];
    const persists = (mage: Mage): boolean =>
      mage.alive || (!!mage.edgelordCapturedBy && mage.vitalsAlive);
    const survivors = oldRoster.filter((m) => m.team === 1 && persists(m) && !m.isSummon);
    const summonOwners = new Map<Mage, Mage>();
    for (const summon of oldRoster) {
      if (!summon.isSummon || !persists(summon) || summon.summonOwnerIndex == null) continue;
      const owner = oldRoster[summon.summonOwnerIndex];
      if (owner && survivors.includes(owner)) summonOwners.set(summon, owner);
    }
    const party = oldRoster.filter(
      (m) => survivors.includes(m) || (m.team === 1 && persists(m) && summonOwners.has(m))
    );
    const scarabOwners = this.gs.scarabs.flatMap((scarab) => {
      if (!scarabAlive(scarab)) return [];
      const owner = scarab.ownerIndex == null
        ? survivors.find((mage) => mage.team === scarab.owner)
        : oldRoster[scarab.ownerIndex];
      return owner && party.includes(owner) ? [{ scarab, owner }] : [];
    });
    const removed = oldRoster.filter((m) => !party.includes(m));
    for (const mage of removed) this.ais.delete(mage);
    this.gs.mages = party;
    for (const [summon, owner] of summonOwners) {
      if (party.includes(summon)) summon.summonOwnerIndex = party.indexOf(owner);
    }
    this.resetPartyPositions(party);
    this.gs.scarabs = scarabOwners.map(({ scarab, owner }) => {
      scarab.owner = owner.team;
      scarab.ownerIndex = party.indexOf(owner);
      scarab.x = owner.x;
      scarab.y = owner.y;
      scarab.state = 'seeking';
      scarab.target = null;
      return scarab;
    });
    for (const m of party) {
      for (const status of m.statuses) {
        if (status.kind !== 'soulRend') continue;
        const owner = oldRoster[status.ownerIndex];
        const remappedOwnerIndex = owner ? party.indexOf(owner) : -1;
        status.ownerIndex = remappedOwnerIndex >= 0 ? remappedOwnerIndex : party.indexOf(m);
      }
      m.resetForNewCombat({ preserveLanternState: true });
      this.swamprunArrowsOwned.set(m, m.arrows);
    }
  }

  /** Return the living party to the standard left-side starting formation. */
  private resetPartyPositions(party: Mage[]): void {
    const starts = this.computeSpawns(party.map((m) => m.team));
    party.forEach((m, i) => Object.assign(m, starts[i]));
  }

  /** Instantiate one creature, wire its AI and sprite, and add it to the fight. */
  private spawnEnemy(kind: EnemyKind, at?: Vec2): Mage {
    const pos = at ?? this.enemySpawnPoint();
    const m = new Mage({ name: 'Enemy', isAI: true, team: 2, position: pos, loadout: [] });
    applyEnemyTraits(m, kind, this.gs.rng);
    m.resetDodges();
    m.resetCombatReactions();
    this.gs.addMage(m);
    this.gs.notifyMageRelocation(m, pos, pos, false);
    this.ais.set(m, new SimpleAI(this.gs, m));
    this.swamprunWaveEnemies.push(m);
    this.syncMageSprites();
    this.styleEnemySprite(m, kind);
    return m;
  }

  /** Instantiate a level-scaled Mine creature without touching swamp content. */
  private spawnMineEnemy(spawn: MineSpawnSpec, at?: Vec2): Mage {
    const pos = at ?? this.enemySpawnPoint();
    const m = new Mage({ name: 'Enemy', isAI: true, team: 2, position: pos, loadout: [] });
    applyMineEnemyTraits(m, spawn, this.gs.rng);
    const weapon = rollMineEnemyWeapon(spawn.kind, spawn.level, this.gs.rng);
    if (weapon) {
      this.gs.grantItem(m, weapon);
      m.equipHand(weapon);
    }
    m.resetDodges();
    m.resetCombatReactions();
    this.gs.addMage(m);
    this.ais.set(m, new SimpleAI(this.gs, m));
    this.swamprunWaveEnemies.push(m);
    this.syncMageSprites();
    this.styleMineEnemySprite(m);
    this.playMineSentinelReveal(m);
    return m;
  }

  /** A scatter point in front of the party, close enough to engage at once. */
  private enemySpawnPoint(): Vec2 {
    const rng = this.gs.rng;
    const x = FIELD.x + FIELD.w * (0.52 + rng.float() * 0.22);
    const y = FIELD.y + 40 + rng.float() * (FIELD.h - 80);
    return { x, y };
  }

  /** A harmless 1 HP practice target used during raid preparation. */
  private spawnRaidEffigy(): Mage {
    const pos = this.enemySpawnPoint();
    const effigy = new Mage({
      name: 'Practice Effigy',
      isAI: true,
      team: 2,
      position: pos,
      loadout: [],
    });
    this.armRaidEffigy(effigy);
    this.gs.addMage(effigy);
    this.gs.notifyMageRelocation(effigy, pos, pos, false);
    this.ais.set(effigy, new SimpleAI(this.gs, effigy));
    this.syncMageSprites();
    const rec = this.mageAnims.get(effigy);
    if (rec) {
      rec.sprite.setTint(0x6f7c8d);
      const srcH = rec.sprite.height || 1;
      rec.sprite.setScale((MAGE_RADIUS * 2.8) / srcH);
    }
    return effigy;
  }

  private armRaidEffigy(effigy: Mage): void {
    effigy.maxHp = effigy.hp = 1;
    effigy.maxSanity = effigy.sanity = 1;
    effigy.cannotAttack = true;
    effigy.trainingPassive = true;
    effigy.intrinsicMoveUnits = 0;
    effigy.resetDodges();
    effigy.resetCombatReactions();
  }

  /**
   * Stand every fallen effigy back up. Called at action and turn boundaries
   * rather than from the defeat hook, so the roster never grows mid-resolution.
   */
  private maintainRaidEffigies(): void {
    if (!this.raidPrepActive) return;
    for (const effigy of this.gs.mages) {
      if (effigy.team !== 2 || effigy.alive) continue;
      const pos = this.enemySpawnPoint();
      effigy.resetForNewCombat();
      this.armRaidEffigy(effigy);
      effigy.x = pos.x;
      effigy.y = pos.y;
      this.gs.notifyMageRelocation(effigy, pos, pos, false);
      this.gs.log(`${effigy.name} reforms out of the dust.`);
    }
    this.syncMageSprites();
  }

  /** Preparation restores are free: they cost no action of any kind. */
  private applyRaidPrepRestore(mage: Mage, kind: RaidRestoreKind): void {
    if (!this.raidPrepActive || mage.team !== 1 || !mage.alive) return;
    if (kind === 'vitals') {
      mage.hp = mage.maxHp;
      mage.sanity = mage.maxSanity;
      this.gs.log(`${mage.name} restores health and mind in full.`);
    } else if (kind === 'mana') {
      mage.mana = mage.maxMana;
      this.gs.log(`${mage.name} restores mana in full.`);
    } else {
      for (const word of mage.loadout) mage.charges[word] = mage.maxWordCharges(word);
      this.gs.log(`${mage.name} restores every word charge.`);
    }
    this.redraw();
  }

  /** Close preparation and drop the chosen boss into the very same fight. */
  private beginRaidBossFight(): void {
    if (!this.raid || !this.raidPrepActive) return;
    this.raidPrepActive = false;
    // Dismissed rather than defeated, so effigies never feed kill-powered gear.
    for (const effigy of this.gs.mages) {
      if (effigy.team !== 2 || !effigy.alive) continue;
      effigy.hp = 0;
      effigy.sanity = 0;
    }
    const def = ENEMY_DEFS[this.raidBoss];
    this.swamprunEncounterPower = def.power;
    this.raidTarget = this.spawnEnemy(this.raidBoss);
    this.gs.log(`— Effigies removed. ${def.name} enters combat. —`);
    this.syncMageSprites();
    this.updateWaveHud();
    this.redraw();
  }

  /** Apply authored creature art or the generic tinted mage treatment. */
  private styleEnemySprite(m: Mage, kind: EnemyKind): void {
    const rec = this.mageAnims.get(m);
    if (!rec) return;
    const def = ENEMY_DEFS[kind];
    if (creatureSpriteKind(m)) {
      rec.sprite.setOrigin(0.5, 0.9);
      if (kind === 'acidZombie') rec.sprite.setTint(def.tint);
      else rec.sprite.clearTint();
      const srcH = rec.sprite.height || 1;
      rec.sprite.setScale((CREATURE_SPRITE_HEIGHT / srcH) * (def.scale ?? 1));
      return;
    }
    rec.sprite.setOrigin(0.5, 1);
    rec.sprite.setTint(def.tint);
    const srcH = rec.sprite.height || 1;
    rec.sprite.setScale(((MAGE_RADIUS * 2.8) / srcH) * (def.scale ?? 1));
  }

  /** Tint / rescale Mine creatures, including role and dormant-state cues. */
  private styleMineEnemySprite(m: Mage): void {
    const rec = this.mageAnims.get(m);
    if (!rec) return;
    const visual = mineEnemyVisual(m);
    const key = `${visual.tint}:${visual.scale}`;
    if (rec.mineVisualKey === key) return;
    rec.mineVisualKey = key;
    rec.sprite.setTint(visual.tint);
    const srcH = rec.sprite.height || 1;
    rec.sprite.setScale(((MAGE_RADIUS * 2.8) / srcH) * visual.scale);
  }

  /** Briefly expand each Sentinel from a role-coloured forge orb. */
  private playMineSentinelReveal(m: Mage): void {
    if (m.mine?.kind !== 'sentinel' && m.mine?.kind !== 'magma-sentinel') return;
    const rec = this.mageAnims.get(m);
    if (!rec) return;
    const finalScaleX = rec.sprite.scaleX;
    const finalScaleY = rec.sprite.scaleY;
    const color = mineEnemyVisual(m).tint;
    rec.sprite.setScale(finalScaleX * 0.24, finalScaleY * 0.24);
    const orb = this.add
      .circle(m.x, m.y, Math.max(9, m.bodyRadius() * 0.5), color, 0.9)
      .setStrokeStyle(2, 0xffe7a1, 0.95)
      .setDepth(6.5);
    this.tweens.add({
      targets: orb,
      scale: 1.65,
      alpha: 0,
      duration: 460,
      ease: 'Sine.Out',
      onComplete: () => orb.destroy(),
    });
    this.tweens.add({
      targets: rec.sprite,
      scaleX: finalScaleX,
      scaleY: finalScaleY,
      duration: 460,
      ease: 'Back.Out',
    });
  }

  /** Spawn the next wave once the field is cleared (and the party still lives). */
  private swamprunWaveCleared(): boolean {
    if (!this.swamprun || this.raid || this.swamprunInterludeActive) return false;
    if (this.mineRun && !this.mineInCombat) return false;
    const survives = (mage: Mage): boolean =>
      mage.alive || (!!mage.edgelordCapturedBy && mage.vitalsAlive);
    const partyAlive = this.gs.mages.some((m) => m.team === 1 && survives(m) && !m.isSummon);
    const foesLeft = this.gs.mages.some((m) => m.team === 2 && survives(m));
    return partyAlive && !foesLeft;
  }

  private swamprunPartySize(): number {
    return this.gs.mages.filter((mage) => mage.team === 1 && mage.alive && !mage.isSummon).length;
  }

  /**
   * Between-wave interlude: auto-sell the fallen wave's loot for gold, patch the
   * survivors up, let them shop, then unleash the next wave. Clearing a wave
   * never ends the run — it only opens the shop and escalates.
   */
  private async runWaveInterlude(): Promise<boolean> {
    if (this.swamprunInterludeActive) return false;
    this.swamprunInterludeActive = true;
    try {
      this.gs.finishCurrentTurn();
      this.awardWaveLoot();
      for (const m of this.gs.mages) {
        if (m.team !== 1 || !m.alive) continue;
        this.tickTorches(m);
        // Ammunition belongs to the run inventory, but shots are recovered when
        // the old battlefield is left behind.
        const owned = this.swamprunArrowsOwned.get(m);
        if (owned != null) m.arrows = owned;
      }
      if (this.expedition) {
        await this.resolveExpeditionLevelUps();
        if (this.expeditionRetreating) return this.advanceExpeditionRetreat();
        const choice = await this.promptExpeditionWaveChoice();
        if (choice === 'continue') {
          this.spawnWave(this.swamprunWave + 1);
          return true;
        }
        this.expeditionRetreating = true;
        this.expeditionRetreatCursor = this.expeditionRunDepth;
        return this.advanceExpeditionRetreat();
      }
      if (this.mineRun) {
        const room = this.mineActiveRoomId == null ? undefined : this.mineMaze?.nodes[this.mineActiveRoomId]?.room;
        if (room) room.resolved = true;
        this.mineInCombat = false;
        this.mineExploring = true;
        this.mineActiveRoomId = null;
        const resolve = this.mineCombatResolve;
        this.mineCombatResolve = null;
        resolve?.();
        return true;
      }
      if (!this.applySwamprunCurseInterlude()) return false;
      // A shop opens only every third cleared wave; other waves flow straight on.
      if (this.swamprunWave % 3 === 0) await this.runSwamprunShop();
      this.spawnWave(this.swamprunWave + 1);
      return true;
    } finally {
      this.swamprunInterludeActive = false;
    }
  }

  /** Enter the Deep Swamps once, then exact the run's curse after later fights. */
  private applySwamprunCurseInterlude(): boolean {
    if (this.mineRun || this.expedition) return true;
    const party = this.gs.mages.filter((mage) => mage.team === 1 && mage.alive && !mage.isSummon);
    if (!this.swamprunCurse && this.swamprunWave >= 7) {
      const curses: SwamprunCurse[] = ['madness', 'decay', 'sloth', 'feeding'];
      this.swamprunCurse = this.gs.rng.pick(curses);
      for (const mage of party) mage.swamprunCurse = this.swamprunCurse;
      const descriptions: Record<SwamprunCurse, string> = {
        madness: 'lose 1d3 sanity between combats',
        decay: 'lose 1d6 health between combats',
        sloth: 'always act last in initiative',
        feeding: 'every mana cost is increased by 1',
      };
      this.gs.log(
        `At 800m the party enters the Deep Swamps. Curse of ${this.swamprunCurse}: ${descriptions[this.swamprunCurse]}.`
      );
      return party.length > 0;
    }
    if (this.swamprunWave <= 7 || !this.swamprunCurse) return party.length > 0;
    for (const mage of party) {
      mage.swamprunCurse = this.swamprunCurse;
      if (this.swamprunCurse === 'madness') {
        const loss = this.gs.rng.die(3);
        mage.sanity = Math.max(0, mage.sanity - loss);
        this.gs.log(`Curse of madness costs ${mage.name} ${loss} sanity.`);
      } else if (this.swamprunCurse === 'decay') {
        const loss = this.gs.rng.die(6);
        mage.hp = Math.max(0, mage.hp - loss);
        this.gs.log(`Curse of decay costs ${mage.name} ${loss} health.`);
      }
    }
    return party.some((mage) => mage.alive);
  }

  /** Burn one combat off a held torch; snuff (destroy) it when its fuel runs out. */
  private tickTorches(m: Mage): void {
    const torchId = m.heldTorchId();
    if (!torchId || m.torchCombatsLeft <= 0) return;
    m.torchCombatsLeft -= 1;
    if (m.torchCombatsLeft <= 0) {
      const i = m.hands.indexOf(torchId);
      if (i >= 0) m.hands.splice(i, 1);
      this.gs.log(`${m.name}'s torch burns out.`);
    }
  }

  /** Roll every fallen creature's drop table and pay each human expedition member. */
  private awardWaveLoot(): void {
    let gold = 0;
    const tally: string[] = [];
    for (const m of this.swamprunWaveEnemies) {
      if (!m.enemyKind) continue;
      const loot = this.mineRun && isMineEnemyKind(m.enemyKind)
        ? rollMineLoot(m.enemyKind, this.gs.rng)
        : rollLoot(m.enemyKind as EnemyKind, this.gs.rng, this.swamprunWispCopies.has(m));
      gold += loot.gold;
      tally.push(...loot.drops);
    }
    gold = Math.round(gold * 2) / 2; // keep clean halves
    if (this.expedition) {
      const kills = this.swamprunWaveEnemies.filter((mage) => !this.swamprunWispCopies.has(mage)).length;
      const grossGold = Math.ceil(gold);
      const shareRate = Math.min(0.8, this.expeditionPermanentRecruits.size * 0.2);
      const players = this.expeditionPlayers();
      const playerRate = players.length <= 1 ? 1 : players.length === 2 ? 0.8 : players.length === 3 ? 0.6 : 0.4;
      const singlePlayerGold = Math.round(grossGold * (1 - shareRate));
      const playerGold = Math.round(singlePlayerGold * playerRate * 10) / 10;
      const shares = grossGold - singlePlayerGold;
      for (const player of players) this.addExpeditionGold(player, playerGold);
      this.swamprunWaveEnemies = [];
      const drops = tally.length ? ` — salvage: ${tally.join(', ')}` : '';
      const shareText = shares > 0 ? ` (${shares}g paid to permanent recruits)` : '';
      this.gs.log(
        `Wave ${this.swamprunWave} cleared! ${kills} XP earned. Each player receives ${playerGold}g (${Math.round(playerRate * 100)}%)${shareText}${drops}.`
      );
      this.updateWaveHud();
      return;
    }
    const supplyGold = Math.max(0, this.swamprunPartySize() - 1);
    gold += supplyGold;
    this.swamprunGold += gold;
    this.swamprunWaveEnemies = [];
    const drops = tally.length ? ` — salvage: ${tally.join(', ')}` : '';
    const supplyText = supplyGold > 0 ? ` (${supplyGold}g party supplies)` : '';
    this.gs.log(
      `${this.mineRun ? 'Encounter' : 'Wave'} ${this.swamprunWave} cleared! Sold loot for ${gold}g${supplyText}${drops}. Party gold: ${this.swamprunGold}g.`
    );
  }

  private expeditionXpToNext(): number {
    const l = this.expeditionLevel;
    return Math.ceil(10 * Math.pow(1.7, l - 1));
  }

  private expeditionPlayers(): Mage[] {
    return this.gs.mages.filter((mage) => mage.team === 1 && !mage.isAI && !mage.expeditionCompanion);
  }

  private expeditionGoldOf(player: Mage): number {
    return this.expeditionGold.get(player) ?? 0;
  }

  private addExpeditionGold(player: Mage, amount: number): void {
    this.expeditionGold.set(player, this.expeditionGoldOf(player) + Math.max(0, amount));
  }

  private spendExpeditionGold(player: Mage, amount: number): boolean {
    if (amount < 0 || this.expeditionGoldOf(player) < amount) return false;
    this.expeditionGold.set(player, this.expeditionGoldOf(player) - amount);
    return true;
  }

  private addExpeditionXp(amount: number): void {
    this.expeditionXp += Math.max(0, amount);
    while (this.expeditionXp >= this.expeditionXpToNext()) {
      this.expeditionXp -= this.expeditionXpToNext();
      this.expeditionLevel += 1;
      this.expeditionPendingLevels += 1;
    }
  }

  private async resolveExpeditionLevelUps(): Promise<void> {
    while (this.expeditionPendingLevels > 0) {
      const resolvedLevel = this.expeditionLevel - this.expeditionPendingLevels + 1;
      this.expeditionPendingLevels -= 1;
      const isMilestone = resolvedLevel % 5 === 0;
      const isWordLevel = resolvedLevel % 2 === 0;
      const players = this.gs.mages.filter((mage) => mage.team === 1 && !mage.isAI && !mage.expeditionCompanion);
      for (const player of players) {
        await this.syncExpeditionPlayerChoice(player, async () => {
          if (isMilestone) {
            await this.promptExpeditionStats(player, resolvedLevel, 2);
            await this.promptExpeditionWord(player, resolvedLevel);
          } else if (isWordLevel) {
            await this.promptExpeditionWord(player, resolvedLevel);
          } else {
            await this.promptExpeditionStats(player, resolvedLevel, 1);
          }
          await this.promptExpeditionColorIdentity(player);
        });
        this.gs.log(`${player.name} reaches level ${resolvedLevel}.`);
      }
    }
  }

  private async syncExpeditionPlayerChoice(player: Mage, choose: () => Promise<void>): Promise<void> {
    if (!this.online || !this.net) {
      await choose();
      return;
    }
    const seat = this.seatOf(player);
    if (this.isLocalDecider(player)) {
      await choose();
      this.net.send({
        k: 'exp-player', seat, loadout: player.loadout,
        primary: player.preferredPrimaryColor, secondary: player.preferredSecondaryColor,
        stats: STAT_ORDER.map((key) => key === 'strength' ? player.statStrength : key === 'dex' ? player.statDex : key === 'int' ? player.statInt : key === 'mana' ? player.maxMana : key === 'hp' ? player.maxHp : player.maxLuck),
      });
      return;
    }
    for (;;) {
      const msg = await this.net.recv();
      if (msg.k === 'bye') return;
      if (msg.k !== 'exp-player' || Number(msg.seat) !== seat) continue;
      const stats = Array.isArray(msg.stats) ? msg.stats.map(Number) : [];
      if (stats.length === 6 && stats.every(Number.isFinite)) {
        player.statStrength = stats[0]; player.statDex = stats[1]; player.statInt = stats[2];
        player.maxMana = stats[3]; player.mana = player.maxMana;
        player.maxHp = stats[4]; player.hp = player.maxHp;
        player.maxLuck = stats[5]; player.luck = player.maxLuck;
      }
      const loadout = Array.isArray(msg.loadout)
        ? msg.loadout.filter((word): word is WordId => typeof word === 'string' && word in WORDS)
        : [];
      const color = (value: unknown): ColorName | null =>
        value === 'black' || value === 'blue' || value === 'white' || value === 'red' ? value : null;
      player.setLoadout(loadout, color(msg.primary), color(msg.secondary));
      return;
    }
  }

  private promptExpeditionStats(player: Mage, level: number, maxStats: number): Promise<void> {
    const previousMode = this.mode;
    this.mode = 'shop';
    const subtitle = maxStats === 1 ? 'Raise one stat by 1' : `Raise up to ${maxStats} different stats by 1`;
    return new Promise((resolve) => {
      const panel = new MultiSelectView(this, `LEVEL ${level} / TRAINING`, subtitle,
        STAT_DEFS.map((definition) => ({
          id: definition.key,
          label: definition.name,
          detail: definition.blurb,
        })), maxStats, (selected) => {
        for (const stat of selected) player.gainStat(stat, 1);
        panel.destroy();
        this.mode = previousMode;
        resolve();
      });
    });
  }

  private expeditionWordOffers(player: Mage): WordId[] {
    const pool = WORD_ORDER.filter((word) => !player.loadout.includes(word));
    const offers: WordId[] = [];
    while (pool.length > 0 && offers.length < 3) {
      const word = this.gs.rng.pick(pool);
      offers.push(word);
      pool.splice(pool.indexOf(word), 1);
    }
    return offers;
  }

  private promptExpeditionWord(player: Mage, level: number): Promise<void> {
    const offers = this.expeditionWordOffers(player);
    if (offers.length === 0) return Promise.resolve();
    const previousMode = this.mode;
    this.mode = 'shop';
    return new Promise((resolve) => {
      const panel = new ChoiceMenuView(this, `LEVEL ${level} / NEW WORD`,
        player.loadout.length >= 5 ? 'Choose a word, then replace one of your five.' : 'Choose one of three words.',
        offers.map((word) => ({ id: word, label: WORDS[word].label, detail: WORDS[word].blurb })),
        async (word) => {
          panel.destroy();
          if (player.loadout.length >= 5) {
            const replaced = await this.promptExpeditionWordReplacement(player, word);
            if (!replaced) {
              this.mode = previousMode;
              resolve();
              return;
            }
          } else {
            player.setLoadout([...player.loadout, word]);
          }
          this.mode = previousMode;
          resolve();
        });
    });
  }

  private promptExpeditionWordReplacement(player: Mage, gained: WordId): Promise<boolean> {
    return new Promise((resolve) => {
      const choices = player.loadout.map((word, index) => ({
        id: String(index),
        label: WORDS[word].label,
        detail: `Replace ${WORDS[word].label} with ${WORDS[gained].label}.`,
      }));
      const panel = new ChoiceMenuView(this, `LEARN ${WORDS[gained].label.toUpperCase()}`,
        'Choose a known word to replace.', choices, (indexText) => {
          const index = Number(indexText) | 0;
          const next = [...player.loadout];
          next[index] = gained;
          player.setLoadout(next);
          panel.destroy();
          resolve(true);
        });
    });
  }

  private colorCounts(player: Mage): Record<ColorName, number> {
    const counts: Record<ColorName, number> = { black: 0, blue: 0, white: 0, red: 0 };
    for (const word of player.loadout) {
      const color = WORD_COLOR[word];
      if (color !== 'none') counts[color] += 1;
    }
    return counts;
  }

  private async promptExpeditionColorIdentity(player: Mage): Promise<void> {
    const counts = this.colorCounts(player);
    const present = (Object.keys(counts) as ColorName[]).filter((color) => counts[color] > 0);
    if (present.length < 2) {
      player.setLoadout(player.loadout, null, null);
      return;
    }
    const top = Math.max(...present.map((color) => counts[color]));
    const primaryChoices = present.filter((color) => counts[color] === top);
    const primary = primaryChoices.length > 1
      ? await this.promptExpeditionColorChoice('CHOOSE PRIMARY COLOR', primaryChoices)
      : primaryChoices[0];
    const remaining = present.filter((color) => color !== primary);
    const secondCount = Math.max(...remaining.map((color) => counts[color]));
    const secondaryChoices = remaining.filter((color) => counts[color] === secondCount);
    const secondary = secondaryChoices.length > 1
      ? await this.promptExpeditionColorChoice('CHOOSE SECONDARY COLOR', secondaryChoices)
      : secondaryChoices[0];
    player.setLoadout(player.loadout, primary, secondary);
  }

  private promptExpeditionColorChoice(title: string, colors: ColorName[]): Promise<ColorName> {
    return new Promise((resolve) => {
      const panel = new ChoiceMenuView(this, title, 'Equal word counts let you decide the order.',
        colors.map((color) => ({
          id: color,
          label: color.toUpperCase(),
          detail: `${color.toUpperCase()} becomes the stronger color identity.`,
        })), (color) => {
          panel.destroy();
          resolve(color);
        });
    });
  }

  /** Wisp gimmick: at the start of its turn it may split into another wisp. */
  private maybeWispDuplicate(m: Mage): void {
    if (!this.swamprun || m.enemyKind !== 'wisp' || !m.alive) return;
    const chance = ENEMY_DEFS.wisp.duplicateChance ?? 0;
    if (chance <= 0) return;
    // Cap the swarm so a lucky streak can't lock the game up.
    const wisps = this.gs.mages.filter((w) => w.enemyKind === 'wisp' && w.alive).length;
    if (wisps >= 16) return;
    if (!this.gs.rng.chance(chance)) return;
    const near = {
      x: m.x + (this.gs.rng.float() - 0.5) * 70,
      y: m.y + (this.gs.rng.float() - 0.5) * 70,
    };
    const copy = this.spawnEnemy('wisp', near);
    copy.justSpawned = true; // it may not act (nor split) until its next turn
    this.swamprunWispCopies.add(copy); // copies drop no loot
    this.gs.log(`${m.name} splits. A new wisp appears.`);
    this.redraw();
  }

  /** Update the on-field wave / foe-count readout. */
  private updateWaveHud(): void {
    if (!this.swamprun) return;
    const alive = this.gs.mages.filter((m) => m.team === 2 && m.alive).length;
    const localPlayer = this.online ? this.mageBySeat(this.localSeat) : this.expeditionLeader();
    const text = this.expedition
      ? `Expedition ${this.expeditionRetreating ? 'return' : 'depth'} ${this.swamprunWave}    Foes: ${alive}    Level ${this.expeditionLevel} (${this.expeditionXp}/${this.expeditionXpToNext()} XP)    Gold: ${this.expeditionGoldOf(localPlayer)}g`
      : this.mineRun
        ? this.mineInCombat
          ? `Mine Run  Encounter ${this.swamprunWave}  Enemy Lv ${mineEnemyLevel(this.swamprunWave)}  Foes: ${alive}  Gold: ${this.swamprunGold}g`
          : `Mine Run  Maze step ${this.mineMaze?.steps ?? 0}  Encounters: ${this.swamprunWave}  Gold: ${this.swamprunGold}g  Pickaxes: ${this.minePickaxes.join(', ') || 'none'}`
        : this.raid
          ? this.raidPrepActive
            ? `RAID PREP  Effigies: ${alive}  Action menu → free restores  •  Summon ${ENEMY_DEFS[this.raidBoss].name} when ready`
            : `RAID  ${ENEMY_DEFS[this.raidBoss].name}  ${this.raidTarget?.alive ? 'ACTIVE' : 'DEFEATED'}  Foes: ${alive}`
          : `${swamprunDepth(this.swamprunWave)}m  Power ${this.swamprunEncounterPower}  Foes: ${alive}  Gold: ${this.swamprunGold}g${this.swamprunCurse ? `  Curse: ${this.swamprunCurse}` : ''}`;
    if (!this.swamprunHudText) {
      this.swamprunHudText = this.add
        .text(TOP_RUN.x, TOP_BAR.h / 2, text, {
          fontFamily: MENU_FONT.control,
          fontSize: FONT.small,
          color: MENU_HEX.brassLight,
          fixedWidth: TOP_RUN.w,
          wordWrap: { width: TOP_RUN.w },
        })
        .setOrigin(0, 0.5)
        .setDepth(46);
    } else {
      this.swamprunHudText.setText(text);
    }
  }

  private async promptExpeditionWaveChoice(): Promise<'continue' | 'return'> {
    if (this.online && this.net && this.localSeat !== 0) {
      for (;;) {
        const msg = await this.net.recv();
        if (msg.k === 'bye') return 'return';
        if (msg.k === 'exp-wave') return msg.choice === 'return' ? 'return' : 'continue';
      }
    }
    const previousMode = this.mode;
    this.mode = 'shop';
    this.expeditionTownPanel?.destroy();
    const choice = await new Promise<'continue' | 'return'>((resolve) => {
      const panel = new ChoiceMenuView(this, `DEPTH ${this.expeditionRunDepth} CLEARED`,
        `Your gold ${this.expeditionGoldOf(this.online ? this.mageBySeat(this.localSeat) : this.expeditionLeader())}g. Returning checks each completed depth in reverse, with a 5% chance to repeat it.`, [
          { id: 'continue', label: 'Continue Deeper', detail: 'Push forward into the next depth without returning to town.' },
          { id: 'return', label: 'Return to Town', detail: 'Begin the return journey through every cleared depth.' },
        ], (selected) => finish(selected));
      this.expeditionTownPanel = panel;
      const finish = (choice: 'continue' | 'return'): void => {
        panel.destroy();
        if (this.expeditionTownPanel === panel) this.expeditionTownPanel = undefined;
        this.mode = previousMode;
        resolve(choice);
      };
    });
    if (this.online) this.net?.send({ k: 'exp-wave', choice });
    return choice;
  }

  private async advanceExpeditionRetreat(): Promise<boolean> {
    while (this.expeditionRetreatCursor > 0) {
      const wave = this.expeditionRetreatCursor--;
      this.gs.log(`Return path: crossing depth ${wave}...`);
      if (this.gs.rng.chance(0.05)) {
        this.gs.log(`Wave ${wave} must be fought again.`);
        this.spawnWave(wave);
        return true;
      }
    }
    await this.enterExpeditionTown();
    return true;
  }

  private async enterExpeditionTown(): Promise<void> {
    this.prepareExpeditionTownParty();
    this.mode = 'shop';
    this.expeditionTownHostPhase = false;
    for (const player of this.expeditionPlayers()) {
      this.expeditionTownBuyer = player;
      this.expeditionTownTab = 'potions';
      this.expeditionTownPage = 0;
      this.expeditionTownMessage = `${player.name}'s shopping turn.`;
      if (this.online && !this.isLocalDecider(player)) {
        await this.awaitExpeditionPlayerTown(player);
      } else {
        this.redrawExpeditionTown();
        await new Promise<void>((resolve) => {
          this.expeditionTownResolve = resolve;
        });
      }
    }

    this.expeditionTownBuyer = this.expeditionLeader();
    this.expeditionTownHostPhase = true;
    this.expeditionTownTab = 'guild';
    this.expeditionTownMessage = 'Only the host can recruit companions.';
    if (this.online && this.localSeat !== 0) await this.awaitExpeditionTownHost();
    else {
      this.redrawExpeditionTown();
      await new Promise<void>((resolve) => {
        this.expeditionTownResolve = resolve;
      });
    }
  }

  private async awaitExpeditionPlayerTown(player: Mage): Promise<void> {
    this.drawExpeditionWaitingPanel(
      `${player.name.toUpperCase()}  //  SHOPPING`,
      `${player.name} buys with their own gold and may rest or donate.`
    );
    for (;;) {
      const msg = await this.net!.recv();
      if (msg.k === 'bye') return;
      if (msg.k !== 'exp-town') continue;
      if (msg.action === 'buy' && Number(msg.buyer) === this.seatOf(player) && typeof msg.item === 'string') {
        this.applyExpeditionItem(msg.item as ItemId, player);
      } else if (msg.action === 'rest' && Number(msg.seat) === this.seatOf(player)) {
        this.applyExpeditionRest(player);
      } else if (msg.action === 'donate' && Number(msg.from) === this.seatOf(player)) {
        this.applyExpeditionDonation(player, this.mageBySeat(Number(msg.to) | 0));
      } else if (msg.action === 'done' && Number(msg.seat) === this.seatOf(player)) {
        this.expeditionTownPanel?.destroy();
        this.expeditionTownPanel = undefined;
        return;
      }
    }
  }

  private drawExpeditionWaitingPanel(title: string, subtitle: string): void {
    this.expeditionTownPanel?.destroy();
    this.expeditionTownPanel = new ChoiceMenuView(this, title, subtitle, [], () => undefined);
  }

  private async awaitExpeditionTownHost(): Promise<void> {
    this.drawExpeditionWaitingPanel('SWAMP TOWN  //  HOST RECRUITING', 'The host may recruit companions before departing.');
    for (;;) {
      const msg = await this.net!.recv();
      if (msg.k === 'bye') return;
      if (msg.k !== 'exp-town') continue;
      if (msg.action === 'recruit' && (msg.kind === 'dwarf' || msg.kind === 'elf' || msg.kind === 'human')) {
        this.applyExpeditionRecruit(msg.kind, !!msg.permanent, Number(msg.price) | 0);
      } else if (msg.action === 'depart') {
        this.expeditionTownPanel?.destroy();
        this.expeditionTownPanel = undefined;
        this.expeditionRetreating = false;
        this.expeditionRunDepth = 0;
        this.mode = 'busy';
        this.spawnWave(1);
        return;
      }
    }
  }

  private redrawExpeditionTown(): void {
    this.redrawExpeditionTownCabinet();
  }

  private redrawExpeditionTownCabinet(): void {
    this.expeditionTownPanel?.destroy();
    const buyer = this.expeditionTownBuyer ?? this.expeditionLeader();
    const gold = this.expeditionGoldOf(buyer);
    const tabs: { id: TownTab; label: string }[] = this.expeditionTownHostPhase
      ? [{ id: 'guild', label: 'Recruit' }]
      : [
        { id: 'potions', label: 'Potions' },
        { id: 'armor', label: 'Armor' },
        { id: 'weapons', label: 'Weapons' },
        { id: 'guild', label: 'Rest' },
        { id: 'donate', label: 'Donate' },
      ];
    let items: TownItemView[] = [];
    let pages = 1;
    if (this.expeditionTownTab !== 'guild' && this.expeditionTownTab !== 'donate') {
      const catalog = this.expeditionCatalog(this.expeditionTownTab, buyer);
      pages = Math.max(1, Math.ceil(catalog.length / 6));
      this.expeditionTownPage = Math.min(this.expeditionTownPage, pages - 1);
      items = catalog.slice(this.expeditionTownPage * 6, (this.expeditionTownPage + 1) * 6).map((definition) => {
        const price = this.expeditionItemPrice(definition.id);
        return {
          id: definition.id,
          name: definition.name,
          price,
          detail: `${definition.rarity} / ${definition.weight}kg. ${definition.blurb}`,
          accent: Phaser.Display.Color.HexStringToColor(RARITY_COLOR[definition.rarity]).color,
          enabled: gold >= price,
        };
      });
    }
    const recruitDefinitions: {
      kind: ExpeditionCompanionKind;
      name: string;
      price: number;
      role: string;
    }[] = [
      { kind: 'dwarf', name: 'Dwarf Vanguard', price: 3, role: 'Heavy armor; hammer against bodies and lantern against spirits.' },
      { kind: 'elf', name: 'Elf Ranger', price: 4, role: 'Burning arrows and three 3d3 heals each combat.' },
      { kind: 'human', name: 'Human Arcanist', price: 5, role: 'Backline Bind, Veil, Twist, Stop, and counter support.' },
    ];
    this.expeditionTownPanel = new ExpeditionTownView(this, {
      buyerName: buyer.name,
      gold,
      hostPhase: this.expeditionTownHostPhase,
      activeTab: this.expeditionTownTab,
      tabs,
      message: this.expeditionTownMessage,
      items,
      page: this.expeditionTownPage,
      pages,
      restEnabled: gold >= 1,
      recruits: recruitDefinitions.map((definition) => {
        const permanent = this.expeditionPermanentRecruits.has(definition.kind);
        const hired = this.expeditionRunRecruits.has(definition.kind);
        return {
          ...definition,
          oneRunPrice: definition.price,
          permanentPrice: definition.price * 3,
          hired,
          permanent,
          canHire: !permanent && !hired && gold >= definition.price,
          canPermanent: !permanent && gold >= definition.price * 3,
        };
      }),
      donations: this.expeditionPlayers()
        .filter((player) => player !== buyer)
        .map((player) => ({ seat: this.seatOf(player), name: player.name, enabled: gold >= 1 })),
    }, {
      selectTab: (tab) => {
        this.expeditionTownTab = tab;
        this.expeditionTownPage = 0;
        this.expeditionTownMessage = '';
        this.redrawExpeditionTown();
      },
      buy: (id) => this.buyExpeditionItem(id, buyer),
      previousPage: () => {
        this.expeditionTownPage -= 1;
        this.redrawExpeditionTown();
      },
      nextPage: () => {
        this.expeditionTownPage += 1;
        this.redrawExpeditionTown();
      },
      rest: () => {
        if (this.online) this.net?.send({ k: 'exp-town', action: 'rest', seat: this.seatOf(buyer) });
        this.applyExpeditionRest(buyer);
        this.redrawExpeditionTown();
      },
      recruit: (kind, permanent, price) => this.recruitExpeditionCompanion(kind, permanent, price),
      donate: (seat) => {
        const recipient = this.mageBySeat(seat);
        if (this.online) this.net?.send({ k: 'exp-town', action: 'donate', from: this.seatOf(buyer), to: seat });
        this.applyExpeditionDonation(buyer, recipient);
        this.redrawExpeditionTown();
      },
      finish: () => this.finishExpeditionTown(buyer),
    });
  }

  private finishExpeditionTown(buyer: Mage): void {
    if (this.online) this.net?.send(this.expeditionTownHostPhase
      ? { k: 'exp-town', action: 'depart' }
      : { k: 'exp-town', action: 'done', seat: this.seatOf(buyer) });
    this.expeditionTownPanel?.destroy();
    this.expeditionTownPanel = undefined;
    if (this.expeditionTownHostPhase) {
      this.expeditionRetreating = false;
      this.expeditionRunDepth = 0;
      this.mode = 'busy';
      this.spawnWave(1);
    }
    const done = this.expeditionTownResolve;
    this.expeditionTownResolve = null;
    done?.();
  }

  private expeditionLeader(): Mage {
    return this.gs.mages.find((m) => m.team === 1 && !m.isAI && !m.expeditionCompanion) ?? this.gs.mages[0];
  }

  private expeditionCatalog(tab: Exclude<ExpeditionTownTab, 'guild' | 'donate'>, buyer: Mage): typeof ITEM_DEFS {
    return ITEM_DEFS.filter((def) => {
      if (def.enemyOnly || def.set === 'conjured') return false;
      if (tab === 'potions') return !!def.potion || !!def.ammo || def.id === 'torch';
      if (tab === 'armor') return ['head', 'torso', 'boots', 'accessory'].includes(def.slot);
      if (buyer.expeditionCompanion === 'elf') return def.weaponFamily === 'bow';
      if (buyer.expeditionCompanion === 'dwarf') return def.weaponFamily === 'hammer';
      if (buyer.expeditionCompanion === 'human') return !!def.isWand;
      return def.slot === 'hand' && !def.lightSource;
    }).sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity) || a.name.localeCompare(b.name));
  }

  private expeditionItemPrice(id: ItemId): number {
    const def = getItem(id);
    const baseGold = def.cost > 0 ? Math.round(def.cost / 10) : SWAMP_PRICE[def.rarity];
    return Math.max(1, Math.round(baseGold * 2));
  }

  private buyExpeditionItem(id: ItemId, buyer: Mage): void {
    if (this.online) this.net?.send({ k: 'exp-town', action: 'buy', item: id, buyer: this.seatOf(buyer) });
    this.applyExpeditionItem(id, buyer);
    this.redrawExpeditionTown();
  }

  private applyExpeditionItem(id: ItemId, buyer: Mage): void {
    const price = this.expeditionItemPrice(id);
    if (!this.spendExpeditionGold(buyer, price)) return;
    this.gs.grantItem(buyer, id);
    if (buyer.expeditionCompanion) this.equipExpeditionRecruitItem(buyer, id);
    this.expeditionTownMessage = `Bought ${getItem(id).name} for ${buyer.name} (${price}g).`;
  }

  private equipExpeditionRecruitItem(buyer: Mage, id: ItemId): void {
    const def = getItem(id);
    const removeFromBag = (): void => {
      const index = buyer.bag.indexOf(id);
      if (index >= 0) buyer.bag.splice(index, 1);
    };
    if (def.slot === 'hand') {
      const replace = buyer.hands.filter((held) => {
        const current = getItem(held);
        if (buyer.expeditionCompanion === 'human') return !!current.isWand;
        return current.weaponFamily === def.weaponFamily;
      });
      for (const held of replace) buyer.unequipHand(held);
      if (buyer.equipHand(id)) this.gs.notifyLightActivation(buyer);
      return;
    }
    if (def.slot === 'head') {
      if (buyer.head && getItem(buyer.head).permanentlyBinding) return;
      if (buyer.head && buyer.head !== id) buyer.bag.push(buyer.head);
      buyer.head = id;
      removeFromBag();
    } else if (def.slot === 'torso') {
      if (buyer.torso && getItem(buyer.torso).permanentlyBinding) return;
      if (buyer.torso && buyer.torso !== id) buyer.bag.push(buyer.torso);
      buyer.torso = id;
      removeFromBag();
    } else if (def.slot === 'boots') {
      if (buyer.boots && getItem(buyer.boots).permanentlyBinding) return;
      if (buyer.boots && buyer.boots !== id) buyer.bag.push(buyer.boots);
      buyer.boots = id;
      removeFromBag();
    } else if (def.slot === 'accessory' && !buyer.accessories.includes(id)) {
      if (buyer.accessories.length >= 2) buyer.bag.push(buyer.accessories.shift()!);
      buyer.accessories.push(id);
      removeFromBag();
    }
  }

  private applyExpeditionDonation(donor: Mage, recipient: Mage): void {
    if (donor === recipient || !this.expeditionPlayers().includes(recipient) || !this.spendExpeditionGold(donor, 1)) return;
    this.addExpeditionGold(recipient, 1);
    this.expeditionTownMessage = `${donor.name} donated 1g to ${recipient.name}.`;
  }

  private applyExpeditionRest(player: Mage): void {
    if (!player.alive || !this.spendExpeditionGold(player, 1)) return;
    player.swamprunRest(this.gs.rng);
    this.expeditionTownMessage = `${player.name} rests for 1g and restores half their resources.`;
  }

  private recruitExpeditionCompanion(kind: ExpeditionCompanionKind, permanent: boolean, price: number): void {
    if (this.online) this.net?.send({ k: 'exp-town', action: 'recruit', kind, permanent, price });
    this.applyExpeditionRecruit(kind, permanent, price);
    this.redrawExpeditionTown();
  }

  private applyExpeditionRecruit(kind: ExpeditionCompanionKind, permanent: boolean, price: number): void {
    const host = this.expeditionLeader();
    if (this.expeditionPermanentRecruits.has(kind)) return;
    const existing = this.expeditionCompanions.get(kind);
    if (!permanent && (existing || this.expeditionRunRecruits.has(kind))) return;
    if (!this.spendExpeditionGold(host, price)) return;
    const companion = existing ?? this.createExpeditionCompanion(kind);
    companion.expeditionPermanent = permanent;
    if (permanent) {
      this.expeditionPermanentRecruits.add(kind);
      this.expeditionRunRecruits.delete(kind);
    } else {
      this.expeditionRunRecruits.add(kind);
    }
    this.expeditionTownMessage = `${companion.name} joins ${permanent ? 'forever' : 'for the next run'}.`;
  }

  private createExpeditionCompanion(kind: ExpeditionCompanionKind): Mage {
    const names: Record<ExpeditionCompanionKind, string> = {
      dwarf: 'Dwarf Vanguard',
      elf: 'Elf Ranger',
      human: 'Human Arcanist',
    };
    const loadout: WordId[] = kind === 'human' ? ['twist', 'stop', 'veil', 'bind'] : [];
    const companion = new Mage({
      name: names[kind],
      isAI: true,
      team: 1,
      position: { ...this.expeditionLeader().pos },
      loadout,
      mageClass: kind === 'elf' ? 'life' : kind === 'human' ? 'hexcraft' : 'objects',
    });
    companion.expeditionCompanion = kind;
    companion.assignFlatStats(3);
    if (kind === 'dwarf') {
      companion.statStrength = 7;
      companion.statDex = 2;
      companion.statInt = 1;
      companion.maxHp += 4;
      companion.hp = companion.maxHp;
      companion.maxMana = Math.max(1, companion.maxMana - 2);
      companion.mana = companion.maxMana;
      companion.hands = ['warHammer'];
      companion.bag = ['lantern'];
      companion.head = 'ironCap';
      companion.accessories = ['fightersGloves'];
    } else if (kind === 'elf') {
      companion.statStrength = 1;
      companion.statDex = 7;
      companion.statInt = 7;
      companion.maxMana += 4;
      companion.mana = companion.maxMana;
      companion.hands = ['woodenBow'];
      companion.arrows = 999;
      companion.companionHealCharges = 3;
    } else {
      companion.statInt = 7;
      companion.maxMana += 4;
      companion.mana = companion.maxMana;
      companion.maxLuck = 7;
      companion.luck = 7;
    }
    companion.resetDodges();
    companion.resetCombatReactions();
    this.gs.addMage(companion);
    this.ais.set(companion, new SimpleAI(this.gs, companion));
    this.expeditionCompanions.set(kind, companion);
    return companion;
  }

  private prepareExpeditionTownParty(): void {
    const oldRoster = [...this.gs.mages];
    for (const kind of this.expeditionRunRecruits) {
      const companion = this.expeditionCompanions.get(kind);
      if (companion) this.ais.delete(companion);
      this.expeditionCompanions.delete(kind);
    }
    this.expeditionRunRecruits.clear();
    const permanent = [...this.expeditionPermanentRecruits]
      .map((kind) => this.expeditionCompanions.get(kind))
      .filter((mage): mage is Mage => !!mage);
    for (const mage of permanent) {
      if (!mage.alive) {
        mage.hp = 1;
        mage.sanity = Math.max(1, mage.sanity);
      }
      this.ais.set(mage, new SimpleAI(this.gs, mage));
    }
    const nonSummons = oldRoster.filter(
      (mage) =>
        mage.team === 1 &&
        !mage.isSummon &&
        mage.alive &&
        (!mage.expeditionCompanion || this.expeditionPermanentRecruits.has(mage.expeditionCompanion))
    );
    for (const mage of permanent) if (!nonSummons.includes(mage)) nonSummons.push(mage);
    for (const summon of oldRoster) {
      if (summon.isSummon) this.ais.delete(summon);
    }
    const dismissed = this.gs.clearSummonedUnits();
    this.gs.mages = nonSummons;
    this.syncMageSprites();
    this.syncScarabSprites();
    const dismissedCount = dismissed.mageSummons + dismissed.scarabs;
    if (dismissedCount > 0) {
      this.gs.log(
        `${dismissedCount} summoned creature${dismissedCount === 1 ? '' : 's'} disperse upon entering town.`
      );
    }
  }

  // ===========================================================================
  //  SWAMPRUN SHOP  (between-wave stat & item purchases)
  // ===========================================================================

  /** Each surviving human spends the shared party gold in turn. AI allies pass. */
  private async runSwamprunShop(): Promise<void> {
    const shoppers = this.gs.mages.filter(
      (m) => m.team === 1 && m.alive && !this.controllerIsAI(m)
    );
    if (shoppers.length === 0) return;
    const prevMode = this.mode;
    this.mode = 'shop';
    // Reroll every slot for this visit. Deterministic (gs.rng) so all peers agree.
    this.generateSwampShop();
    this.swampShopPassed = new Set<Mage>();
    // Round-robin: each shopper takes one action per turn (buy / rest / stat /
    // leave) until everyone has left. A solo shopper simply keeps acting until
    // they choose to go. Online: the owning client drives; peers apply relayed
    // actions in lockstep behind a waiting screen.
    let idx = 0;
    while (!this.opponentLeft && this.swampShopPassed.size < shoppers.length) {
      const mage = shoppers[idx % shoppers.length];
      idx += 1;
      if (this.swampShopPassed.has(mage) || !mage.alive) {
        this.swampShopPassed.add(mage);
        continue;
      }
      if (this.online && !this.isLocalDecider(mage)) {
        await this.awaitRemoteShopTurn(mage);
      } else {
        await this.promptSwampShopTurn(mage);
      }
    }
    this.mode = prevMode;
    this.hideSwampShop();
  }

  /** Reroll all six shop slots from the shared RNG (identical on every peer). */
  private generateSwampShop(): void {
    const rng = this.gs.rng;
    const partyLuck = this.gs.mages
      .filter((m) => m.team === 1 && m.alive)
      .reduce((sum, m) => sum + m.maxLuck, 0);
    const makeItemSlot = (rarity: Rarity): SwampShopSlot => {
      const id = draftChoices(rarity, () => rng.float(), 1, true)[0];
      const r = rng.float();
      const discount: 0 | 0.5 | 0.8 = r < 0.05 ? 0.8 : r < 0.25 ? 0.5 : 0;
      const price = Math.max(1, Math.round(SWAMP_PRICE[rarity] * (1 - discount)));
      return { kind: 'item', id, rarity, price, discount, sold: !id };
    };
    const makeTorchSlot = (): SwampShopSlot => {
      const r = rng.float();
      const discount: 0 | 0.5 | 0.8 = r < 0.05 ? 0.8 : r < 0.25 ? 0.5 : 0;
      const price = Math.max(1, Math.round(SWAMP_PRICE['consumeable'] * (1 - discount)));
      return { kind: 'item', id: 'torch', rarity: 'consumeable', price, discount, sold: false };
    };
    const rollNonConsumable = (): Rarity => {
      let rarity = rollRarity(() => rng.float(), partyLuck, true);
      let guard = 0;
      while (rarity === 'consumeable' && guard++ < 50) rarity = rollRarity(() => rng.float(), partyLuck, true);
      return rarity === 'consumeable' ? 'common' : rarity;
    };
    const slots: SwampShopSlot[] = [];
    slots.push(makeTorchSlot()); // slot 1: always a torch (the torch slot)
    slots.push(makeItemSlot('consumeable')); // slot 2: a rolled consumable
    for (let i = 0; i < 3; i++) slots.push(makeItemSlot(rollNonConsumable())); // slots 3-5
    // Slot 6: guaranteed unreal-or-better.
    const unrealRank = rarityRank('unreal');
    let hi = rollRarity(() => rng.float(), partyLuck, true);
    let guard = 0;
    while (rarityRank(hi) < unrealRank && guard++ < 80) hi = rollRarity(() => rng.float(), partyLuck, true);
    if (rarityRank(hi) < unrealRank) hi = 'unreal';
    slots.push(makeItemSlot(hi));
    // Slot 7: stat up (priced dynamically as it is bought).
    slots.push({ kind: 'stat', price: SWAMP_STAT_BASE, discount: 0, sold: false });
    this.swampSlots = slots;
    this.swampRestUsed = false;
    this.swampStatBuys = 0;
    this.swampShopMsg = '';
  }

  /** One-pick, no-consumable draft handed to each survivor at the run's start. */
  private async runSwamprunStartDraft(): Promise<void> {
    this.buildShopOverlay();
    this.swampStartDraftActive = true;
    this.mode = 'shop';
    try {
      if (this.online && this.net) {
        for (const m of this.gs.mages) if (m.isAI) this.applyCart(m, this.aiStartPick(m));
        const humanCount = this.gs.mages.filter((m) => !m.isAI).length;
        const mySeat = this.localSeat;
        const myCart = await this.promptShop(this.mageBySeat(mySeat));
        if (this.opponentLeft) return;
        this.net.send({ k: 'buy', seat: mySeat, items: myCart });
        this.showShopWaiting();
        const carts = new Map<number, ItemId[]>();
        carts.set(mySeat, myCart);
        while (carts.size < humanCount && !this.opponentLeft && this.net) {
          const msg = await this.net.recv();
          if (msg.k === 'bye') break;
          if (msg.k === 'buy' && typeof msg.seat === 'number') carts.set(msg.seat, asItemIds(msg.items));
        }
        if (this.opponentLeft) return;
        for (const [seat, cart] of carts) this.applyCart(this.mageBySeat(seat), cart);
      } else {
        for (const m of this.gs.mages) {
          if (m.isAI) this.applyCart(m, this.aiStartPick(m));
          else this.applyCart(m, await this.promptShop(m));
        }
      }
    } finally {
      this.swampStartDraftActive = false;
      this.hideShopOverlay();
    }
    this.logEquipSummary();
  }

  /** Unrestricted Swamprun setup: direct stats and any number of catalogue items. */
  private async runCreativePrep(): Promise<void> {
    this.mode = 'shop';
    if (this.online && this.net) {
      for (const mage of this.gs.mages) if (mage.isAI) mage.assignFlatStats(4);
      const humanCount = this.gs.mages.filter((mage) => !mage.isAI).length;
      const mySeat = this.localSeat;
      const mine = await this.promptCreativePrep(this.mageBySeat(mySeat));
      if (this.opponentLeft) return;
      this.net.send({ k: 'creative', seat: mySeat, stats: mine.stats, items: mine.items });
      const results = new Map<number, CreativePrepResult>([[mySeat, mine]]);
      while (results.size < humanCount && !this.opponentLeft && this.net) {
        const msg = await this.net.recv();
        if (msg.k === 'bye') break;
        if (msg.k !== 'creative' || typeof msg.seat !== 'number') continue;
        results.set(msg.seat, this.sanitizeCreativePrep(msg.stats, msg.items));
      }
      if (this.opponentLeft) return;
      for (const [seat, result] of results) this.applyCreativePrep(this.mageBySeat(seat), result);
    } else {
      for (const mage of this.gs.mages) {
        if (mage.isAI) mage.assignFlatStats(4);
        else this.applyCreativePrep(mage, await this.promptCreativePrep(mage));
      }
    }
    this.hideCreativePrep();
    this.logStatSummary();
    this.logEquipSummary();
  }

  private sanitizeCreativePrep(stats: unknown, items: unknown): CreativePrepResult {
    const source = typeof stats === 'object' && stats ? stats as Record<string, unknown> : {};
    const cleanStats = {} as Record<StatKey, number>;
    for (const key of STAT_ORDER) {
      const value = Number(source[key]);
      cleanStats[key] = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 4;
    }
    return { stats: cleanStats, items: asItemIds(items).filter((id) => !getItem(id).enemyOnly) };
  }

  private applyCreativePrep(mage: Mage, result: CreativePrepResult): void {
    const dice = STAT_ORDER.map((key) => ({ spec: 'creative', value: result.stats[key] }));
    mage.applyStatAllocation(dice, defaultAssignment());
    mage.hands = [];
    mage.bag = [];
    mage.head = null;
    mage.torso = null;
    mage.boots = null;
    mage.accessories = [];
    mage.utility = [];
    mage.arrows = 0;
    for (const id of result.items) this.gs.grantItem(mage, id);
    mage.hp = mage.maxHp;
    mage.sanity = mage.maxSanity;
  }

  private promptCreativePrep(mage: Mage): Promise<CreativePrepResult> {
    this.creativePrepMage = mage;
    this.creativePrepStats = { strength: 4, dex: 4, int: 4, mana: 4, hp: 4, luck: 4 };
    this.creativePrepItems = [];
    this.creativePrepPage = 0;
    this.redrawCreativePrep();
    return new Promise((resolve) => { this.creativePrepResolve = resolve; });
  }

  private hideCreativePrep(): void {
    this.creativePrepPanel?.destroy();
    this.creativePrepPanel = undefined;
    this.creativePrepMage = undefined;
    this.creativePrepResolve = null;
  }

  private redrawCreativePrep(): void {
    this.creativePrepPanel?.destroy();
    const mage = this.creativePrepMage;
    if (!mage) return;
    this.creativePrepPanel = new CreativePrepView(this, {
      mageName: mage.name,
      confirmLabel: this.raid ? 'Begin Raid Prep' : this.mineRun ? 'Enter the Mine' : 'Enter the Swamp',
      stats: { ...this.creativePrepStats },
      items: [...this.creativePrepItems],
      page: this.creativePrepPage,
      presets: this.creativePresets,
    }, {
      adjustStat: (key, amount) => {
        this.creativePrepStats[key] = Math.max(0, this.creativePrepStats[key] + amount);
        this.redrawCreativePrep();
      },
      addItem: (id) => {
        this.creativePrepItems.push(id);
        this.redrawCreativePrep();
      },
      setPage: (page) => {
        this.creativePrepPage = page;
        this.redrawCreativePrep();
      },
      undoItem: () => {
        this.creativePrepItems.pop();
        this.redrawCreativePrep();
      },
      clearItems: () => {
        this.creativePrepItems = [];
        this.redrawCreativePrep();
      },
      loadPreset: (slot) => {
        const saved = this.creativePresets[slot];
        if (!saved) return;
        this.creativePrepStats = { ...saved.stats };
        this.creativePrepItems = [...saved.items];
        this.redrawCreativePrep();
      },
      savePreset: (slot, name) => this.saveCreativePreset(slot, name),
      clearPreset: (slot) => {
        this.creativePresets[slot] = null;
        saveCreativePresets(this.creativePresets);
        this.redrawCreativePrep();
      },
      confirm: () => {
        const resolve = this.creativePrepResolve;
        const result = { stats: { ...this.creativePrepStats }, items: [...this.creativePrepItems] };
        this.creativePrepResolve = null;
        this.creativePrepPanel?.destroy();
        this.creativePrepPanel = undefined;
        resolve?.(result);
      },
    });
  }

  /** Name and store the current build in one of the three slots. */
  private saveCreativePreset(slot: number, name: string): void {
    this.creativePresets[slot] = {
      name: name.trim().slice(0, 24) || `Build ${slot + 1}`,
      stats: { ...this.creativePrepStats },
      items: [...this.creativePrepItems],
    };
    if (!saveCreativePresets(this.creativePresets)) {
      this.gs.log('Saved builds cannot be stored in this browser; it will last only this session.');
    }
    this.redrawCreativePrep();
  }

  /** Deterministic AI starting pick: one non-consumable item. */
  private aiStartPick(mage: Mage): ItemId[] {
    const rng = this.gs.rng;
    let rarity = rollRarity(() => rng.float(), mage.maxLuck, true);
    let guard = 0;
    while (rarity === 'consumeable' && guard++ < 50) rarity = rollRarity(() => rng.float(), mage.maxLuck, true);
    if (rarity === 'consumeable') rarity = 'common';
    const opts = draftChoices(rarity, () => rng.float(), 3, true);
    return opts.length ? [opts[Math.floor(rng.float() * opts.length)]] : [];
  }

  /** Apply one relayed shop action from a remote shopper, then yield the turn. */
  private async awaitRemoteShopTurn(mage: Mage): Promise<void> {
    const seat = this.seatOf(mage);
    this.showRemoteShopWaiting(mage);
    for (;;) {
      if (this.opponentLeft || this.gs.isOver) {
        this.swampShopPassed.add(mage);
        return;
      }
      const msg = await this.net!.recv();
      if (msg.k === 'bye') {
        this.swampShopPassed.add(mage);
        return;
      }
      if (msg.k !== 'shop' || (Number(msg.seat) | 0) !== seat) continue;
      if (msg.action === 'pass') {
        this.swampShopPassed.add(mage);
        return;
      }
      if (msg.action === 'slot') this.applySwampSlot(mage, Number(msg.slot) | 0);
      else if (msg.action === 'rest') this.applySwampRest(mage);
      else if (msg.action === 'stat' && typeof msg.key === 'string') this.applySwampStat(mage, msg.key as StatKey);
      else if (msg.action === 'sell' && typeof msg.item === 'string') this.applySwampSell(mage, msg.item as ItemId);
      else if (msg.action === 'discard' && typeof msg.item === 'string') this.applySwampDiscard(mage, msg.item as ItemId);
      this.updateWaveHud();
      return; // one action per turn
    }
  }

  /** A read-only overlay shown while another player shops in online co-op. */
  private showRemoteShopWaiting(mage: Mage): void {
    this.swampShopPanel?.destroy();
    this.swampShopPanel = new SwampShopView(this, {
      title: 'PARTY SHOP / WAITING',
      subtitle: `${mage.name} is choosing the party's next upgrade.`,
      message: 'The shop advances after this player finishes one action.',
      mode: 'waiting',
      gold: this.swamprunGold,
      overCapacity: false,
      offers: [],
      manageItems: [],
      restLabel: 'Waiting',
      restEnabled: false,
    }, this.swampShopActions(mage));
  }

  /** Open the shop for one shopper; resolve after they take a single action. */
  private promptSwampShopTurn(mage: Mage): Promise<void> {
    this.swampShopMage = mage;
    this.swampShopStatPicking = false;
    this.swampShopManaging = false;
    this.swampShopConfirmSlot = null;
    this.redrawSwampShop();
    return new Promise((resolve) => {
      this.swampShopResolve = resolve;
    });
  }

  private hideSwampShop(): void {
    this.swampShopPanel?.destroy();
    this.swampShopPanel = undefined;
    this.swampShopResolve = null;
    this.swampShopMage = undefined;
  }

  /** Rebuild the shop overlay from scratch to reflect the current state. */
  private redrawSwampShop(): void {
    this.redrawSwampShopCabinet();
  }

  private redrawSwampShopCabinet(): void {
    this.swampShopPanel?.destroy();
    const mage = this.swampShopMage;
    if (!mage) return;
    const capacity = mage.hasBagOfHolding() ? Infinity : mage.carryCap();
    const overCapacity = mage.carriedWeight() > capacity;
    const mode = this.swampShopConfirmSlot != null
      ? 'confirm'
      : this.swampShopStatPicking
        ? 'stats'
        : this.swampShopManaging
          ? 'manage'
          : 'offers';
    const offers: SwampOfferView[] = this.swampSlots.map((slot) => {
      if (slot.kind === 'stat') {
        const price = SWAMP_STAT_BASE + this.swampStatBuys;
        return {
          title: 'Stat Up',
          price,
          detail: 'Raise one permanent attribute by +1d3.',
          accent: MENU_COLOR.brass,
          enabled: this.swamprunGold >= price,
        };
      }
      if (slot.sold || !slot.id) {
        return {
          title: 'Sold',
          price: slot.price,
          detail: 'This offer has already been taken.',
          accent: MENU_COLOR.brassDark,
          enabled: false,
        };
      }
      const definition = getItem(slot.id);
      const discount = slot.discount ? ` Discount ${Math.round(slot.discount * 100)}%.` : '';
      return {
        title: definition.name,
        price: slot.price,
        detail: `${slot.rarity} / ${definition.weight}kg.${discount} ${definition.blurb}`,
        accent: Phaser.Display.Color.HexStringToColor(RARITY_COLOR[slot.rarity ?? 'common']).color,
        enabled: this.swamprunGold >= slot.price,
      };
    });
    const confirmSlot = this.swampShopConfirmSlot == null ? null : this.swampSlots[this.swampShopConfirmSlot];
    const confirmDefinition = confirmSlot?.id ? getItem(confirmSlot.id) : null;
    type ManageRow = { id: ItemId; where: string };
    const manageRows: ManageRow[] = [
      ...mage.hands.map((id) => ({ id, where: 'held' })),
      ...mage.bag.map((id) => ({ id, where: 'bag' })),
      ...mage.accessories.map((id) => ({ id, where: 'worn' })),
      ...(mage.head ? [{ id: mage.head, where: 'head' }] : []),
      ...(mage.torso ? [{ id: mage.torso, where: 'torso' }] : []),
      ...(mage.boots ? [{ id: mage.boots, where: 'boots' }] : []),
      ...mage.utility.map((id) => ({ id, where: 'utility' })),
    ];
    this.swampShopPanel = new SwampShopView(this, {
      title: this.mineRun
        ? `${mage.name.toUpperCase()} / MINE SUPPLY SHOP`
        : `${mage.name.toUpperCase()} / WAVE ${this.swamprunWave} SHOP`,
      subtitle: `Party gold ${this.swamprunGold}g / Carry ${mage.carriedWeight()}/${Number.isFinite(capacity) ? capacity : '∞'}kg${overCapacity ? ' / OVER CAPACITY' : ''}`,
      message: this.swampShopMsg,
      mode,
      gold: this.swamprunGold,
      overCapacity,
      offers,
      confirmText: confirmDefinition
        ? `${confirmDefinition.name} weighs ${confirmDefinition.weight}kg and exceeds your carry limit. Buy it anyway? You must then sell or discard enough weight before leaving.`
        : undefined,
      manageItems: manageRows.map(({ id, where }) => {
        const definition = getItem(id);
        return {
          id,
          name: definition.name,
          detail: `${definition.rarity} / ${definition.weight}kg / ${where}`,
          sellValue: this.swampSellValue(id),
        };
      }),
      restLabel: this.swampRestUsed ? 'Rest Used' : `Rest (${SWAMP_REST_COST}g)`,
      restEnabled: !this.swampRestUsed && this.swamprunGold >= SWAMP_REST_COST,
    }, this.swampShopActions(mage));
  }

  private swampShopActions(mage: Mage) {
    return {
      buyOffer: (index: number) => {
        const slot = this.swampSlots[index];
        if (slot?.kind === 'stat') {
          this.swampShopStatPicking = true;
          this.redrawSwampShop();
        } else {
          this.swampBuySlot(mage, index);
        }
      },
      confirmBuy: () => {
        if (this.swampShopConfirmSlot != null) this.swampBuySlot(mage, this.swampShopConfirmSlot);
      },
      cancelSubstate: () => {
        this.swampShopConfirmSlot = null;
        this.swampShopStatPicking = false;
        this.swampShopManaging = false;
        this.redrawSwampShop();
      },
      chooseStat: (key: StatKey) => this.swampBuyStat(mage, key),
      openManage: () => {
        this.swampShopManaging = true;
        this.redrawSwampShop();
      },
      sell: (id: ItemId) => this.swampSellItem(mage, id),
      discard: (id: ItemId) => this.swampDiscardItem(mage, id),
      rest: () => this.swampRest(mage),
      leave: () => this.swampPass(mage),
    };
  }

  // --- Shop actions (pure apply + local relay wrappers) ----------------------

  /** Buy the item in slot `i`. Pure state + log; returns a UI message. */
  private applySwampSlot(mage: Mage, i: number): string {
    const slot = this.swampSlots[i];
    if (!slot || slot.kind !== 'item' || slot.sold || !slot.id) return '';
    if (this.swamprunGold < slot.price) return '';
    this.swamprunGold -= slot.price;
    slot.sold = true;
    this.gs.grantItem(mage, slot.id);
    const def = getItem(slot.id);
    this.gs.log(
      `${mage.name} buys ${def.name} (${slot.rarity}) for ${slot.price}g. Party gold: ${this.swamprunGold}g.`
    );
    return `Bought ${def.name} [${slot.rarity}] for ${slot.price}g!`;
  }

  /** Party rest: restore half of each survivor's vitals. Pure state + log. */
  private applySwampRest(mage: Mage): string {
    if (this.swampRestUsed || this.swamprunGold < SWAMP_REST_COST) return '';
    this.swamprunGold -= SWAMP_REST_COST;
    this.swampRestUsed = true;
    for (const m of this.gs.mages) {
      if (m.team === 1 && m.alive) m.swamprunRest(this.gs.rng);
    }
    this.gs.log(
      `${mage.name} calls a rest for ${SWAMP_REST_COST}g — the party recovers. Party gold: ${this.swamprunGold}g.`
    );
    return 'Party rested — half HP, mana, sanity and word charges restored.';
  }

  /** Buy a +1d3 to a chosen stat. Each purchase this shop raises the next by 1g. */
  private applySwampStat(mage: Mage, key: StatKey): string {
    const price = SWAMP_STAT_BASE + this.swampStatBuys;
    if (this.swamprunGold < price) return '';
    this.swamprunGold -= price;
    this.swampStatBuys += 1;
    const amt = this.gs.rng.die(3); // 1d3, rolled after the stat is chosen
    mage.gainStat(key, amt);
    const name = STAT_DEFS.find((d) => d.key === key)?.name ?? key;
    this.gs.log(`${mage.name} trains ${name} +${amt} for ${price}g. Party gold: ${this.swamprunGold}g.`);
    return `${name} +${amt}!  (rolled 1d3)`;
  }

  /** Local: relay + buy an item slot, then yield the turn. */
  private swampBuySlot(mage: Mage, i: number): void {
    const slot = this.swampSlots[i];
    if (!slot || slot.kind !== 'item' || slot.sold || !slot.id || this.swamprunGold < slot.price) return;
    // Weight guard: warn once before buying something the shopper cannot carry.
    if (this.swampShopConfirmSlot !== i && !mage.canCarry(getItem(slot.id).weight)) {
      this.swampShopConfirmSlot = i;
      this.redrawSwampShop();
      return;
    }
    this.swampShopConfirmSlot = null;
    if (this.online) this.net?.send({ k: 'shop', seat: this.seatOf(mage), action: 'slot', slot: i });
    this.swampShopMsg = this.applySwampSlot(mage, i);
    this.updateWaveHud();
    this.resolveSwampTurn();
  }

  /** Sell value (gold) of a non-consumable item: 25% of its shop price, else 0. */
  private swampSellValue(id: ItemId): number {
    const def = getItem(id);
    if (def.rarity === 'consumeable') return 0;
    return Math.max(1, Math.floor(SWAMP_PRICE[def.rarity] * 0.25));
  }

  /** Pure: sell one carried item for gold; returns a UI message. */
  private applySwampSell(mage: Mage, id: ItemId): string {
    const value = this.swampSellValue(id);
    if (value <= 0) return '';
    if (!this.gs.removeItem(mage, id)) return '';
    this.swamprunGold += value;
    const def = getItem(id);
    this.gs.log(`${mage.name} sells ${def.name} for ${value}g. Party gold: ${this.swamprunGold}g.`);
    return `Sold ${def.name} for ${value}g.`;
  }

  /** Pure: drop (discard) one carried item, no refund; returns a UI message. */
  private applySwampDiscard(mage: Mage, id: ItemId): string {
    if (!this.gs.removeItem(mage, id)) return '';
    const def = getItem(id);
    this.gs.log(`${mage.name} discards ${def.name}.`);
    return `Discarded ${def.name}.`;
  }

  /** Local: relay + sell an item, then yield the turn. */
  private swampSellItem(mage: Mage, id: ItemId): void {
    if (this.swampSellValue(id) <= 0) return;
    if (this.online) this.net?.send({ k: 'shop', seat: this.seatOf(mage), action: 'sell', item: id });
    this.swampShopMsg = this.applySwampSell(mage, id);
    this.updateWaveHud();
    this.resolveSwampTurn();
  }

  /** Local: relay + discard an item, then yield the turn. */
  private swampDiscardItem(mage: Mage, id: ItemId): void {
    if (this.online) this.net?.send({ k: 'shop', seat: this.seatOf(mage), action: 'discard', item: id });
    this.swampShopMsg = this.applySwampDiscard(mage, id);
    this.updateWaveHud();
    this.resolveSwampTurn();
  }

  /** Local: relay + rest the party, then yield the turn. */
  private swampRest(mage: Mage): void {
    if (this.swampRestUsed || this.swamprunGold < SWAMP_REST_COST) return;
    if (this.online) this.net?.send({ k: 'shop', seat: this.seatOf(mage), action: 'rest' });
    this.swampShopMsg = this.applySwampRest(mage);
    this.updateWaveHud();
    this.resolveSwampTurn();
  }

  /** Local: relay + buy a stat-up for the chosen stat, then yield the turn. */
  private swampBuyStat(mage: Mage, key: StatKey): void {
    const price = SWAMP_STAT_BASE + this.swampStatBuys;
    if (this.swamprunGold < price) return;
    if (this.online) this.net?.send({ k: 'shop', seat: this.seatOf(mage), action: 'stat', key });
    this.swampShopMsg = this.applySwampStat(mage, key);
    this.swampShopStatPicking = false;
    this.updateWaveHud();
    this.resolveSwampTurn();
  }

  /** Local: relay + leave the shop, then yield the turn. */
  private swampPass(mage: Mage): void {
    if (this.online) this.net?.send({ k: 'shop', seat: this.seatOf(mage), action: 'pass' });
    this.swampShopPassed.add(mage);
    this.resolveSwampTurn();
  }

  /** Close the panel and resolve the active shopper's turn (loop re-opens it). */
  private resolveSwampTurn(): void {
    const resolve = this.swampShopResolve;
    this.swampShopResolve = null;
    this.swampShopPanel?.destroy();
    this.swampShopPanel = undefined;
    resolve?.();
  }
  /** Drink a potion: spend it from the utility belt and apply its effect. */
  private useConsumable(mage: Mage, itemId: ItemId): void {
    const def = getItem(itemId);
    const i = mage.utility.indexOf(itemId);
    if (i < 0 || !def.potion) return;
    mage.utility.splice(i, 1);
    if (def.potion === 'mana') {
      mage.gainMana(10);
      this.gs.log(`${mage.name} drinks a Mana Potion (+10 mana).`);
    } else if (def.potion === 'health') {
      const amt = this.gs.rng.roll('2d3').total;
      mage.hp = Math.min(mage.maxHp, mage.hp + amt);
      this.gs.log(`${mage.name} drinks a Health Potion (+${amt} HP).`);
    } else {
      // Word Vial: restore 1 charge to every word in the loadout.
      mage.grantEldritchCharges(1);
      this.gs.log(`${mage.name} uses a Word Vial. Each word regains 1 charge.`);
    }
  }

  // ===========================================================================
  //  STAT ASSIGNMENT PHASE
  // ===========================================================================

  /** Roll one shared assortment of dice and let each duellist allocate it. */
  private async runAssignmentPhase(): Promise<void> {
    this.statDice = this.swamprun
      ? rollSwamprunStatDice(this.gs.rng)
      : rollStatAssortment(this.gs.rng);
    this.buildAssignOverlay();
    this.mode = 'assign';
    this.gs.log(`Stat dice: ${this.statDice.map((d) => `${d.spec}=${d.value}`).join(', ')}`);

    if (this.online && this.net) {
      // AI seats allocate deterministically on every client — no network needed.
      for (const m of this.gs.mages) {
        if (m.isAI) m.applyStatAllocation(this.statDice, aiAssignment(this.statDice));
      }
      const humanCount = this.gs.mages.filter((m) => !m.isAI).length;
      const mySeat = this.localSeat;
      const myMage = this.mageBySeat(mySeat);
      const myOrder = await this.promptAssignment(`${myMage.name} — assign your dice`);
      if (this.opponentLeft) return;
      this.net.send({ k: 'assign', seat: mySeat, order: myOrder });
      this.showAssignWaiting();
      // Collect every *human* seat's allocation (keyed by seat); AI already applied.
      const orders = new Map<number, number[]>();
      orders.set(mySeat, myOrder);
      while (orders.size < humanCount && !this.opponentLeft && this.net) {
        const msg = await this.net.recv();
        if (msg.k === 'bye') break;
        if (msg.k === 'assign' && typeof msg.seat === 'number') {
          const order = isValidAssignment(msg.order) ? (msg.order as number[]) : defaultAssignment();
          orders.set(msg.seat, order);
        }
      }
      if (this.opponentLeft) return;
      for (const [seat, order] of orders) this.mageBySeat(seat).applyStatAllocation(this.statDice, order);
    } else {
      for (const m of this.gs.mages) {
        if (m.isAI) {
          m.applyStatAllocation(this.statDice, aiAssignment(this.statDice));
        } else {
          const order = await this.promptAssignment(`${m.name} — assign your dice`);
          m.applyStatAllocation(this.statDice, order);
        }
      }
    }

    this.logStatSummary();
    this.hideAssignOverlay();
  }

  /** Wait for the opponent's allocation message in online play. */
  private async awaitOpponentAssign(): Promise<number[]> {
    while (!this.opponentLeft && this.net) {
      const msg = await this.net.recv();
      if (msg.k === 'bye') break;
      if (msg.k === 'assign') {
        return isValidAssignment(msg.order) ? msg.order : defaultAssignment();
      }
    }
    return defaultAssignment();
  }

  /** Show the overlay for one player and resolve with their chosen order. */
  private promptAssignment(label: string): Promise<number[]> {
    this.assignPlacement = STAT_ORDER.map(() => null);
    this.assignSelectedDie = null;
    this.assignLocked = false;
    this.assignTitleText = label;
    this.refreshAssignOverlay();
    return new Promise((resolve) => {
      this.assignResolve = resolve;
    });
  }

  private showAssignWaiting(): void {
    this.assignTitleText = 'Waiting for opponent to assign';
    this.assignLocked = true;
    this.assignSelectedDie = null;
    this.refreshAssignOverlay();
  }

  private hideAssignOverlay(): void {
    this.assignPanel?.destroy();
    this.assignPanel = undefined;
    this.assignResolve = null;
  }

  /** Assignment presentation is rebuilt from its small immutable snapshot. */
  private buildAssignOverlay(): void {
    if (this.assignResolve || this.assignLocked) this.refreshAssignOverlay();
  }

  private applyStatBuild(build: StatBuildId): void {
    if (this.assignLocked) return;
    this.assignPlacement = statBuildAssignment(this.statDice, build);
    this.assignSelectedDie = null;
    this.refreshAssignOverlay();
  }

  private onAssignDieClick(i: number): void {
    if (this.assignLocked) return;
    const slotOf = this.assignPlacement.indexOf(i);
    if (this.assignSelectedDie === i) {
      this.assignSelectedDie = null;
    } else {
      if (slotOf >= 0) this.assignPlacement[slotOf] = null;
      this.assignSelectedDie = i;
    }
    this.refreshAssignOverlay();
  }

  private onAssignSlotClick(s: number): void {
    if (this.assignLocked) return;
    if (this.assignSelectedDie != null) {
      const prev = this.assignPlacement.indexOf(this.assignSelectedDie);
      if (prev >= 0) this.assignPlacement[prev] = null;
      this.assignPlacement[s] = this.assignSelectedDie;
      this.assignSelectedDie = null;
    } else if (this.assignPlacement[s] != null) {
      this.assignSelectedDie = this.assignPlacement[s];
      this.assignPlacement[s] = null;
    }
    this.refreshAssignOverlay();
  }

  private onAssignConfirm(): void {
    if (this.assignLocked) return;
    if (this.assignPlacement.some((p) => p == null)) return;
    const order = this.assignPlacement.map((p) => p as number);
    const resolve = this.assignResolve;
    this.assignResolve = null;
    resolve?.(order);
  }

  private refreshAssignOverlay(): void {
    this.assignPanel?.destroy();
    this.assignPanel = new StatAssignmentView(this, {
      title: this.assignTitleText || 'Assign your dice',
      dice: this.statDice,
      placement: this.assignPlacement,
      selectedDie: this.assignSelectedDie,
      locked: this.assignLocked,
    }, {
      selectDie: (index) => this.onAssignDieClick(index),
      selectSlot: (index) => this.onAssignSlotClick(index),
      applyBuild: (build) => this.applyStatBuild(build),
      confirm: () => this.onAssignConfirm(),
    });
  }

  private logStatSummary(): void {
    for (const m of this.gs.mages) {
      this.gs.log(
        `${m.name}: STR ${m.statStrength}, DEX ${m.statDex}%, INT ${m.statInt} (DC -${m.dcReduction()}), ` +
          `Mana ${m.maxMana}, HP ${m.maxHp}, Luck ${m.maxLuck}.`
      );
    }
  }

  // ===========================================================================
  //  SHOP PHASE
  // ===========================================================================

  /** Each duellist spends gold on equipment before the duel begins. */
  private async runShopPhase(): Promise<void> {
    this.buildShopOverlay();
    this.mode = 'shop';

    if (this.online && this.net) {
      // AI seats draft deterministically from the shared RNG on every client.
      for (const m of this.gs.mages) {
        if (m.isAI) this.applyCart(m, aiDraft(m.maxLuck, DRAFT_ROUNDS, () => this.gs.rng.float()));
      }
      const humanCount = this.gs.mages.filter((m) => !m.isAI).length;
      const mySeat = this.localSeat;
      const myMage = this.mageBySeat(mySeat);
      const myCart = await this.promptShop(myMage);
      if (this.opponentLeft) return;
      this.net.send({ k: 'buy', seat: mySeat, items: myCart });
      this.showShopWaiting();
      // Collect every *human* seat's cart (keyed by seat); AI already applied.
      const carts = new Map<number, ItemId[]>();
      carts.set(mySeat, myCart);
      while (carts.size < humanCount && !this.opponentLeft && this.net) {
        const msg = await this.net.recv();
        if (msg.k === 'bye') break;
        if (msg.k === 'buy' && typeof msg.seat === 'number') carts.set(msg.seat, asItemIds(msg.items));
      }
      if (this.opponentLeft) return;
      for (const [seat, cart] of carts) this.applyCart(this.mageBySeat(seat), cart);
    } else {
      for (const m of this.gs.mages) {
        if (m.isAI) {
          this.applyCart(m, aiDraft(m.maxLuck));
        } else {
          const cart = await this.promptShop(m);
          this.applyCart(m, cart);
        }
      }
    }

    this.logEquipSummary();
    this.hideShopOverlay();
  }

  /** Wait for the opponent's purchases in online play. */
  private async awaitOpponentBuy(): Promise<ItemId[]> {
    while (!this.opponentLeft && this.net) {
      const msg = await this.net.recv();
      if (msg.k === 'bye') break;
      if (msg.k === 'buy') return asItemIds(msg.items);
    }
    return [];
  }

  /** Equip a (sanitised) cart onto a mage, distributing items into slots. */
  private applyCart(mage: Mage, items: ItemId[]): void {
    const valid = sanitizeCart(items, mage.statStrength);
    mage.hands = [];
    mage.bag = [];
    mage.head = null;
    mage.torso = null;
    mage.boots = null;
    mage.accessories = [];
    mage.utility = [];
    mage.arrows = 0;
    for (const id of valid) {
      const def = getItem(id);
      switch (def.slot) {
        case 'hand':
          // Hand items start stowed in the bag; they must be equipped in-duel.
          mage.bag.push(id);
          break;
        case 'head':
          mage.head = id;
          break;
        case 'torso':
          mage.torso = id;
          break;
        case 'boots':
          mage.boots = id;
          break;
        case 'accessory':
          mage.accessories.push(id);
          break;
        case 'utility':
          if (def.ammo) mage.arrows += 1;
          else mage.utility.push(id);
          break;
      }
    }
    mage.silver = 0;
    // The AI does not manage its bag, so it auto-equips its first hand items.
    if (mage.isAI) {
      for (const id of [...mage.bag]) {
        if (getItem(id).slot !== 'hand') continue;
        if (!mage.equipHand(id)) break;
        this.gs.notifyLightActivation(mage);
      }
    }
    // Apply one-time HP / sanity changes from equipped gear (rings).
    mage.applyEquipmentVitals();
  }

  private logEquipSummary(): void {
    for (const m of this.gs.mages) {
      const worn: string[] = [
        ...m.hands,
        ...(m.head ? [m.head] : []),
        ...(m.torso ? [m.torso] : []),
        ...(m.boots ? [m.boots] : []),
        ...m.accessories,
        ...m.utility,
      ].map((id) => getItem(id).name);
      if (m.arrows > 0) worn.push(`${m.arrows} arrows`);
      const bag = m.bag.map((id) => getItem(id).name);
      const bagText = bag.length ? `   (in bag: ${bag.join(', ')})` : '';
      this.gs.log(`${m.name} equips — ${worn.length ? worn.join(', ') : 'nothing'}.${bagText}`);
    }
  }

  private promptShop(mage: Mage): Promise<ItemId[]> {
    this.shopMage = mage;
    this.shopPicks = [];
    this.shopRound = 0;
    this.shopLocked = false;
    return new Promise((resolve) => {
      this.shopResolve = resolve;
      this.startDraftRound();
    });
  }

  /** Begin the next draft round, or resolve the shop once all rounds are done. */
  private startDraftRound(): void {
    this.shopRound += 1;
    const total = this.swampStartDraftActive ? 1 : DRAFT_ROUNDS;
    if (this.shopRound > total) {
      const picks = [...this.shopPicks];
      const resolve = this.shopResolve;
      this.shopResolve = null;
      resolve?.(picks);
      return;
    }
    const luck = this.shopMage?.maxLuck ?? 0;
    let rarity = rollRarity(Math.random, luck, this.swamprun);
    if (this.swampStartDraftActive) {
      // The start-of-run pick never offers a consumable.
      let guard = 0;
      while (rarity === 'consumeable' && guard++ < 50) rarity = rollRarity(Math.random, luck, true);
      if (rarity === 'consumeable') rarity = 'common';
    }
    // Swamprun keeps its guaranteed fourth Torch; every other mode rolls four
    // ordinary choices and cannot draw either light-source item.
    this.shopOptions = this.swamprun
      ? [...draftChoices(rarity, Math.random, 3, true), 'torch']
      : draftChoices(rarity, Math.random, 4);
    this.refreshShopOverlay();
  }

  /** Player chose option `idx` of the current round. */
  private onDraftPick(idx: number): void {
    // Gambler's Blade cash-out: a single mid-combat pick resolves its own promise.
    if (this.gamblerResolve) {
      if (this.shopLocked) return;
      const id = this.shopOptions[idx];
      if (!id) return;
      const resolve = this.gamblerResolve;
      this.gamblerResolve = null;
      this.shopPanel?.destroy();
      this.shopPanel = undefined;
      resolve(idx);
      return;
    }
    if (this.shopLocked) return;
    const id = this.shopOptions[idx];
    if (!id) return;
    this.shopPicks.push(id);
    this.startDraftRound();
  }

  private showShopWaiting(): void {
    this.shopLocked = true;
    this.refreshShopOverlay();
  }

  private hideShopOverlay(): void {
    this.shopPanel?.destroy();
    this.shopPanel = undefined;
    this.shopResolve = null;
  }

  private buildShopOverlay(): void {
    if (this.shopMage && this.shopOptions.length) this.refreshShopOverlay();
  }

  private refreshShopOverlay(): void {
    if (!this.shopMage || !this.shopOptions.length) return;
    const cap = carryCapacity(this.shopMage.statStrength);
    const rarity = this.shopOptions.length ? getItem(this.shopOptions[0]).rarity : 'common';
    const rarityName = rarity.charAt(0).toUpperCase() + rarity.slice(1);
    const gambler = this.gamblerResolve !== null;
    const title = gambler
      ? `${this.shopMage.name} — Gambler's Blade (${this.gamblerRound}/${this.gamblerTotal})`
      : this.swampStartDraftActive
        ? `${this.shopMage.name} — Choose a starting item`
        : `${this.shopMage.name} — Draft ${this.shopRound}/${DRAFT_ROUNDS}`;
    const count = gambler ? 3 : this.shopOptions.length;
    this.shopPanel?.destroy();
    this.shopPanel = new ItemDraftView(this, {
      title,
      subtitle: `A ${rarityName} set appears — choose one of ${count} (carry ${cap}kg).`,
      options: this.shopLocked ? [] : this.shopOptions,
      picks: this.shopPicks,
      locked: this.shopLocked,
    }, {
      pick: (index) => this.onDraftPick(index),
    });
  }


  /** Per-frame: pulse the highlight rings around currently valid targets. */
  update(time: number): void {
    this.syncMusic();
    this.drawArenaAmbient(time);
    this.syncMageSprites();
    this.drawMineMarkers();
    this.syncScarabSprites();
    this.drawScarabHp();
    this.drawTargetHighlights(time);
    // Health bars ease toward their true value, so keep drawing until they land.
    // Aiming rings breathe, so they need the same continuous redraw.
    if (this.barsSettling || (!this.reducedMotion && this.mode.startsWith('aiming'))) {
      this.barsSettling = false;
      this.redraw();
    }
  }

  /** Shops and prep panels borrow the menu bed; combat keeps the arena bed. */
  private syncMusic(): void {
    const shopping = !!this.swampShopPanel || !!this.creativePrepPanel || !!this.shopPanel;
    playMusic(shopping ? 'menu' : 'combat');
  }

  private drawTargetHighlights(time: number): void {
    const g = this.gfxFx;
    g.clear();
    const targets = this.currentAimTargets();
    const hovered = this.gs.mages.find((mage) => mage.alive && dist(this.pointer, mage.pos) <= MAGE_RADIUS + 10);
    const reducedMotion = this.reducedMotion;
    const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time / 140);
    for (const target of targets) {
      const focused = hovered === target;
      const radius = MAGE_RADIUS + (focused ? 14 : 10) + pulse * 2;
      const arm = focused ? 10 : 7;
      const color = focused ? MENU_COLOR.brassLight : MENU_COLOR.verdigris;
      g.lineStyle(focused ? 3 : 2, color, focused ? 1 : 0.72 + pulse * 0.18);
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const x = target.x + sx * radius;
        const y = target.y + sy * radius;
        g.lineBetween(x, y, x - sx * arm, y);
        g.lineBetween(x, y, x, y - sy * arm);
      }
      if (focused) {
        g.lineStyle(1, MENU_COLOR.brassLight, 0.8).strokeCircle(target.x, target.y, MAGE_RADIUS + 5);
      }
    }
    if (hovered && this.isEnemyTargetingMode() && !targets.includes(hovered)) {
      const radius = MAGE_RADIUS + 11;
      g.lineStyle(3, MENU_COLOR.blood, 0.9);
      g.lineBetween(hovered.x - radius, hovered.y - radius, hovered.x + radius, hovered.y + radius);
      g.lineBetween(hovered.x + radius, hovered.y - radius, hovered.x - radius, hovered.y + radius);
      g.lineStyle(1, MENU_COLOR.blood, 0.6).strokeCircle(hovered.x, hovered.y, radius + 4);
    }
  }

  private isEnemyTargetingMode(): boolean {
    return this.mode === 'aiming-melee'
      || this.mode === 'aiming-throw'
      || this.mode === 'aiming-eldritch'
      || this.mode === 'aiming-discharge'
      || this.mode === 'subtarget-enemy'
      || this.mode === 'aiming-spell';
  }

  /** Mages that are legal targets for the current aim (turn cast or reaction). */
  private currentAimTargets(): Mage[] {
    if (!this.isEnemyTargetingMode()) return [];
    return this.gs.mages.filter((mage) => mage.alive && this.canTargetEnemyNow(mage));
  }

  // ===========================================================================
  //  TURN FLOW
  // ===========================================================================

  private async startTurn(): Promise<void> {
    if (this.mineRun && this.mineExploring) return;
    // Swamprun: if the last wave has fallen, the between-wave interlude (loot +
    // shop + next wave) runs before we check for a match end — clearing a wave
    // never ends the run.
    if (this.swamprunWaveCleared() && (await this.runWaveInterlude())) return this.startTurn();
    if (this.gs.isOver) return this.endGame();
    const turnOwner = this.gs.current;
    this.gs.beginTurn();
    if (!turnOwner.isAI) playSound('turn.start');
    this.showTurnBanner(turnOwner);
    if (this.raidPrepActive) this.maintainRaidEffigies();
    const oniTrigger = this.buildOniTurnEndTrigger();
    if (oniTrigger) {
      await this.runStack(oniTrigger);
      if (this.gs.current !== turnOwner) return;
    }
    // Channel and Delay resolve before the mage takes its turn.
    if (turnOwner.channeledCast || turnOwner.delayedCast || turnOwner.delayedItems.length > 0) {
      await this.releasePendingCasts(turnOwner);
      if (this.gs.isOver) return this.endGame();
      if (this.gs.current !== turnOwner) return;
    }
    // A creature spawned mid-combat (a wisp split) sits out its first turn, so a
    // fresh copy cannot immediately split again the moment it appears.
    if (this.gs.current.justSpawned) {
      this.gs.current.justSpawned = false;
      return this.nextTurn();
    }
    // A wisp may split at the start of its own turn.
    this.maybeWispDuplicate(this.gs.current);
    // Ghast/Reaper start-of-turn steps: a Ghast's marked zone erupts, and a
    // Reaper that channelled last turn now claps to delete every marked foe.
    await this.resolveBossTurnStart(this.gs.current);
    if (this.gs.isOver) return this.endGame();
    if (this.swamprun && !this.gs.current.alive) return this.nextTurn();
    this.resetSelection();
    this.redraw();
    // Turn-start damage (DoT, auras, totems) applies no dice, so play any
    // recoils it queued right away as the HP changes become visible.
    this.flushHits();

    // Swamprun: a creature's own turn-start DoT tick can empty the board — run
    // the interlude rather than declaring the run over, and skip a creature that
    // just died.
    if (this.swamprunWaveCleared() && (await this.runWaveInterlude())) return this.startTurn();
    if (this.gs.isOver) return this.endGame();
    if (this.swamprun && !this.gs.current.alive) return this.nextTurn();

    // A mind-bound mage is compelled to repeat its last action and forfeits
    // any choice this turn.
    const control = this.gs.controlOf(this.gs.current);
    if (control?.mode === 'repeat') {
      await this.runCompelledTurn();
      return;
    }

    if (this.controllerIsAI(this.gs.current)) {
      this.mode = 'busy';
      const wave = this.swamprunWave;
      await this.runAITurn();
      if (this.swamprun && wave !== this.swamprunWave) return;
      if (this.gs.isOver) return this.endGame();
      await this.nextTurn();
    } else if (this.online && !this.isLocalTurn()) {
      // The opponent pilots this turn; drive it from their relayed commands.
      this.mode = 'busy';
      this.redraw();
      await this.runRemoteTurn();
      if (this.gs.isOver) return this.endGame();
      await this.nextTurn();
    } else {
      this.mode = 'idle';
      this.redraw();
    }
  }

  /** Replay the mage's last action (Mind Bind). If it cannot, it does nothing. */
  private async runCompelledTurn(): Promise<void> {
    this.mode = 'busy';
    const me = this.gs.current;
    const wave = this.swamprunWave;
    await this.delay(400);
    const item = this.buildCompelledAction(me);
    if (item) {
      this.gs.log(`${me.name} is compelled to repeat their last action.`);
      await this.runStack(item);
    } else {
      this.gs.log(`${me.name} is compelled but cannot act. No action taken.`);
      await this.delay(300);
    }
    if (this.swamprun && wave !== this.swamprunWave) return;
    if (this.gs.isOver) return this.endGame();
    await this.nextTurn();
  }

  /** Rebuild a stack item from a mage's recorded last action, paying its cost. */
  private buildCompelledAction(me: Mage): StackItem | null {
    const la = me.lastAction;
    if (!la) return null;
    if (la.type === 'move') {
      if (me.actions.move <= 0 || !la.point) return null;
      me.spend('move');
      return this.gs.makeMoveItem(me, la.point);
    }
    if (la.type === 'melee') {
      const cost = me.attackIsBonusAction() ? 'bonus' : 'main';
      if (me.actions[cost] <= 0 || !la.target || !this.gs.canMelee(me, la.target)) return null;
      me.spend(cost);
      return this.gs.makeMeleeItem(me, la.target);
    }
    // spell
    if (!la.spellId) return null;
    const spell = spellById(la.spellId);
    if (!spell) return null;
    if (!me.hasCharges(spell.words)) return null;
    if (spell.actionType === 'main' ? me.actions.main <= 0 : me.actions.bonus <= 0) return null;
    const target = spell.targeting === 'self' ? me : la.target ?? null;
    if (
      (spell.targeting === 'enemy' ||
        spell.targeting === 'ally' ||
        spell.targeting === 'any') &&
      (!target || !this.gs.isValidSpellTarget(spell, me, target))
    ) {
      return null;
    }
    this.payForSpell(me, spell);
    return this.gs.makeSpellItem(me, spell, target, la.point ?? null);
  }

  /** Record the initiating action so Mind Bind can replay it later. */
  private recordLastAction(item: StackItem): void {
    const src = item.source;
    if (item.kind === 'move') {
      src.lastAction = { type: 'move', point: item.targetPoint };
    } else if (item.kind === 'melee') {
      src.lastAction = { type: 'melee', target: item.target };
    } else if (item.kind === 'spell' && item.spell) {
      src.lastAction = {
        type: 'spell',
        spellId: item.spell.id,
        target: item.target,
        point: item.targetPoint,
      };
    }
  }

  /**
   * Mind Curse: when a scrambled mage casts, swap in a random castable spell
   * with an auto-chosen target. Returns null if nothing can be cast.
   */
  private randomCastFor(me: Mage): { spell: Spell; target: Mage | null; point: Vec2 | null } | null {
    const enemy = this.gs.opponentOf(me);
    const options = allSpells(me.mageClass).filter(
      (s) =>
        s.words.every((w) => me.loadout.includes(w)) &&
        me.hasCharges(s.words) &&
        this.gs.canCastSpellNow(s) &&
        (s.actionType === 'main' ? me.actions.main > 0 : me.actions.bonus > 0)
    );
    if (options.length === 0) return null;
    const spell = this.gs.rng.pick(options);
    switch (spell.targeting) {
      case 'self':
      case 'ally':
        return { spell, target: me, point: null };
      case 'enemy':
        return { spell, target: enemy, point: null };
      case 'point': {
        const reach = Number.isFinite(spell.range) ? spell.range * 0.6 : 280;
        return { spell, target: null, point: stepTowards(me.pos, enemy.pos, reach) };
      }
      default:
        return { spell, target: null, point: null };
    }
  }


  private async nextTurn(skipReactionWindow = false): Promise<void> {
    if (this.mineRun && this.mineExploring) return;
    // Swamprun: refill the board the instant a wave is cleared so the run never
    // stalls out on an empty arena.
    if (this.swamprunWaveCleared() && (await this.runWaveInterlude())) return this.startTurn();
    // As the acting mage moves to end their turn, opponents get one last chance
    // to spend their reaction (counter-magic only) before the turn passes.
    if (!skipReactionWindow) {
      await this.offerReactionWindow(this.gs.current, 'End of Turn', {
        description: `${this.gs.current.name} moves to end their turn.`,
      });
    }
    if (this.gs.isOver) return this.endGame();

    // A queued extra turn (Shatter Mind Reality) jumps the queue before the
    // normal rotation, and does not advance the round.
    const extra = this.gs.takeExtraTurn();
    if (extra && extra.alive) {
      this.gs.finishCurrentTurn();
      this.gs.setCurrent(extra);
      this.startTurn();
      return;
    }
    this.gs.endTurn();
    this.startTurn();
  }

  private async runAITurn(): Promise<void> {
    // Dev: a passive AI simply forfeits its turn. Training dummies do the same.
    if (Dev.aiPassive || this.gs.current.trainingPassive) {
      await this.delay(250);
      return;
    }
    const ai = this.aiFor(this.gs.current);
    let guard = 0;
    while (guard++ < 16) {
      if (this.gs.isOver || !this.gs.current.alive) return;
      const decision = ai.chooseAction();
      if (decision.type === 'end') break;
      await this.delay(450);
      await this.performAIDecision(decision);
      this.redraw();
    }
    // A Lich that never moved this turn takes a bonus end-step (rolled effect).
    await this.maybeLichEndStep();
    await this.maybeDeathknightEndStep();
  }

  /** If the current mage is a Lich that stayed put, roll its d6 end-step. */
  private async maybeLichEndStep(): Promise<void> {
    const lich = this.gs.current;
    if (this.gs.isOver) return;
    if (lich.enemyKind !== 'lich' || !lich.alive || lich.movedThisTurn) return;
    const res = this.gs.lichEndStep(lich);
    if (res.summonAt) {
      const at: Vec2 = {
        x: Math.min(FIELD.x + FIELD.w - 20, Math.max(FIELD.x + 20, res.summonAt.x)),
        y: Math.min(FIELD.y + FIELD.h - 20, Math.max(FIELD.y + 20, res.summonAt.y)),
      };
      this.spawnEnemy('zombie', at);
      await this.vfxSummonPuff(at, MAGE_RADIUS * 3.2);
    }
    this.redraw();
    await this.delay(300);
  }

  /** Deathknight always Conjures, then also Summons if it never attempted an attack. */
  private async maybeDeathknightEndStep(): Promise<void> {
    const knight = this.gs.current;
    if (this.gs.isOver || !knight.alive || !knight.deathknightKind) return;
    const shouldSummon = !knight.deathknightAttackAttemptedThisTurn;
    this.gs.deathknightConjure(knight);
    this.flushHits();
    if (shouldSummon && knight.alive && !this.gs.isOver) {
      const roll = this.gs.rng.die(6);
      const kinds: EnemyKind[] =
        roll === 1
          ? ['acidZombie', 'acidZombie', 'acidZombie', 'acidZombie']
          : roll === 2
            ? ['defender', 'defender']
            : roll === 3
              ? ['ghast']
              : roll === 4
                ? ['specter', 'specter']
                : roll === 5
                  ? ['wisp', 'wisp', 'wisp']
                  : ['soldierDemon', 'beastDemon'];
      const summonPuffs: Promise<void>[] = [];
      for (let index = 0; index < kinds.length; index++) {
        const angle = (Math.PI * 2 * index) / kinds.length + this.gs.rng.float() * 0.35;
        const radius = (2 + this.gs.rng.float() * 3) * RANGE_UNIT;
        const at = {
          x: Math.min(FIELD.x + FIELD.w - 20, Math.max(FIELD.x + 20, knight.x + Math.cos(angle) * radius)),
          y: Math.min(FIELD.y + FIELD.h - 20, Math.max(FIELD.y + 20, knight.y + Math.sin(angle) * radius)),
        };
        this.spawnEnemy(kinds[index], at);
        summonPuffs.push(this.vfxSummonPuff(at, MAGE_RADIUS * 3.2));
      }
      await Promise.all(summonPuffs);
      this.gs.log(
        `${knight.name} summons ${kinds.map((kind) => ENEMY_DEFS[kind].name).join(', ')} from the deep mire.`
      );
    }
    this.redraw();
    await this.delay(350);
  }

  /**
   * Start-of-turn steps for the two special bosses. A Ghast's telegraphed shadow
   * zone erupts for 2d3 on everyone caught; a Reaper that spent last turn
   * channelling now claps, deleting every foe it has marked.
   */
  private async resolveBossTurnStart(m: Mage): Promise<void> {
    if (this.gs.isOver || !m.alive) return;
    if (m.ghastKind && m.ghastPendingZone) {
      this.gs.resolveGhastZone(m);
      this.flushHits();
      this.redraw();
      await this.delay(300);
    }
    if (m.reaperKind && m.reaperChanneling) {
      this.startBodyAttack(m);
      await this.delay(600);
      this.gs.reaperResolveClap(m);
      this.syncMageSprites();
      this.redraw();
      await this.delay(400);
    }
  }

  private async performAIDecision(d: AIDecision): Promise<void> {
    const me = this.gs.current;
    switch (d.type) {
      case 'move':
        me.spend('move');
        await this.runStack(this.gs.makeMoveItem(me, d.point));
        break;
      case 'melee':
        me.spend(me.attackIsBonusAction() ? 'bonus' : 'main');
        await this.runStack(this.gs.makeMeleeItem(me, d.target));
        break;
      case 'companion-heal':
        me.spend('main');
        me.companionHealCharges = Math.max(0, me.companionHealCharges - 1);
        await this.runStack(
          this.gs.makeActionItem({
            source: me,
            label: 'Elven Heal',
            description: `${me.name} heals ${d.target.name} within 10cm.`,
            isStillValid: () => me.alive && d.target.alive,
            resolve: (game) => game.companionHeal(me, d.target),
          })
        );
        break;
      case 'color-ability':
        if (!this.canAffordAbility(me, d.ability) || me.abilityCastsLeft(d.ability.id) <= 0) break;
        this.payForColorAbility(me, d.ability);
        await this.runStack(
          this.gs.makeSpellItem(me, d.ability, d.target ?? null, d.point ?? null)
        );
        break;
      case 'deaths-angel-wings':
        await this.performDeathsAngelWings(me);
        break;
      case 'scarab':
        me.spend(me.attackIsBonusAction() ? 'bonus' : 'main');
        this.gs.attackScarab(me, d.scarab);
        await this.vfxBurst({ x: d.scarab.x, y: d.scarab.y }, 0xffffff, 24, 1.2);
        this.redraw();
        break;
      case 'power': {
        // A bespoke Lich power: costs a main action, but no mana / charges / DC —
        // it always resolves. Resolved straight through the stack.
        me.spend('main');
        await this.runStack(this.gs.makeSpellItem(me, d.spell, d.target, null));
        break;
      }
      case 'ghast-mark': {
        me.spend('main');
        this.gs.markGhastZone(me, d.point, 3 * RANGE_UNIT);
        break;
      }
      case 'ghast-shove': {
        me.spend('main');
        this.gs.ghastShove(me, d.target);
        this.flushHits();
        break;
      }
      case 'reaper-mark': {
        me.spend('main');
        this.startBodyAttack(me);
        await this.delay(600);
        this.gs.reaperMark(me, d.target);
        break;
      }
      case 'reaper-channel': {
        me.spend('main');
        this.startBodyAttack(me);
        await this.delay(600);
        this.gs.reaperBeginChannel(me);
        break;
      }
      case 'mine-action': {
        if (!canUseMineAction(this.gs, me, d.choice)) break;
        const cost = commitMineAction(me, d.choice);
        me.spend(cost);
        await this.runStack(makeMineActionItem(this.gs, me, d.choice));
        break;
      }
      case 'spell': {
        // A scrambled mage (Mind Curse) casts a random spell instead.
        if (this.gs.controlOf(me)?.mode === 'random') {
          const sub = this.randomCastFor(me);
          if (sub) {
            this.gs.log(`${me.name} is scrambled. ${sub.spell.name} is cast instead.`);
            this.payForSpell(me, sub.spell);
            await this.runStack(this.gs.makeSpellItem(me, sub.spell, sub.target, sub.point));
          }
          break;
        }
        this.payForSpell(me, d.spell);
        const item = this.gs.makeSpellItem(
          me,
          d.spell,
          d.target ?? null,
          d.point ?? null
        );
        await this.runStack(item);
        break;
      }
    }
  }

  // ===========================================================================
  //  ONLINE LOCKSTEP  (relay the decisions, simulate identically on both ends)
  // ===========================================================================

  /** True when the local client owns the mage whose turn it currently is. */
  private isLocalTurn(): boolean {
    if (!this.online) return true;
    return this.controllerSeatOf(this.gs.current) === this.localSeat;
  }

  /** True when the local client decides for `m` (turn action / reaction / sub-target). */
  private isLocalDecider(m: Mage): boolean {
    if (!this.online) return true;
    return this.controllerSeatOf(m) === this.localSeat;
  }

  /**
   * Seat that controls `m`. Summons are steered by their owner, so their
   * controller is the owner's seat (a summon has no seat/turn of its own).
   */
  private controllerSeatOf(m: Mage): number {
    if (m.isSummon && m.summonOwnerIndex != null) return m.summonOwnerIndex;
    return this.seatOf(m);
  }

  private mageByTeam(team: number): Mage {
    return this.gs.mages.find((m) => m.team === team) ?? this.gs.mages[0];
  }

  /** A mage's seat index (its position in the shared mage list) — the wire id. */
  private seatOf(m: Mage): number {
    return this.gs.mages.indexOf(m);
  }

  /** Resolve a seat index (as sent over the wire) back to its mage. */
  private mageBySeat(seat: number): Mage {
    return this.gs.mages[seat] ?? this.gs.mages[0];
  }

  /** Resolve a serialized spell / color-ability id back to its definition. */
  private resolveSpellId(id: string): Spell | null {
    if (id.startsWith('ability:')) return COLOR_ABILITIES.find((a) => a.id === id) ?? null;
    return spellById(id) ?? null;
  }

  /**
   * Route a turn action through the lockstep seam: relay it to the opponent
   * (online) and apply it locally. Offline this is just "apply it".
   */
  private submitTurn(cmd: TurnCommand): void {
    if (this.online) this.net?.send({ k: 'turn', cmd });
    void this.applyTurnCommand(cmd);
  }

  /** Apply a turn command — spending costs and running the stack identically on both peers. */
  private async applyTurnCommand(
    cmd: TurnCommand,
    opts: { actor?: Mage; freeBonus?: boolean; queueOnly?: boolean } = {}
  ): Promise<void> {
    const me = opts.actor ?? this.gs.current;
    const freeBonus = opts.freeBonus ?? false;
    const spend = (kind: 'move' | 'main' | 'bonus'): void => {
      if (!(freeBonus && kind === 'bonus')) me.spend(kind);
    };
    const runAction = opts.queueOnly
      ? (item: StackItem): Promise<void> => this.stageStackItem(item)
      : (item: StackItem): Promise<void> => this.runStack(item);
    this.resetSelection();
    switch (cmd.t) {
      case 'move':
        spend('move');
        await runAction(this.gs.makeMoveItem(me, { x: cmd.x, y: cmd.y }));
        break;
      case 'melee': {
        const declared = this.mageBySeat(cmd.target);
        const target = this.gs.isFoeBlind(me)
          ? this.gs.randomFoeBlindTarget(me, this.gs.mages.filter((other) => this.gs.canMelee(me, other))) ?? declared
          : declared;
        spend(me.attackIsBonusAction() ? 'bonus' : 'main');
        await runAction(this.gs.makeMeleeItem(me, target));
        break;
      }
      case 'spell': {
        const spell = this.resolveSpellId(cmd.spellId);
        if (!spell) break;
        // A colour ability stifled by a Needle of Serenity can never be cast.
        if (cmd.ability && this.isColorAbility(spell) && me.isAbilityBanned(spell.id)) {
          this.gs.log(`${me.name} reaches for ${spell.name}, but it has been stifled forever.`);
          break;
        }
        const target =
          spell.targeting === 'self'
            ? me
            : cmd.target != null
            ? this.mageBySeat(cmd.target)
            : null;
        // Foe-blind: the caster no longer decides who the spell finds.
        const aimed =
          target && spell.targeting !== 'self' && this.gs.isFoeBlind(me)
            ? this.gs.randomFoeBlindTarget(me, this.gs.validSpellTargets(spell, me)) ?? target
            : target;
        const point = cmd.x != null && cmd.y != null ? { x: cmd.x, y: cmd.y } : null;
        const point2 = cmd.x2 != null && cmd.y2 != null ? { x: cmd.x2, y: cmd.y2 } : null;
        if (cmd.angle != null) me.wallAngle = cmd.angle;
        const mods = (cmd.mods ?? []).filter(isModifierWord);
        if (cmd.ability && this.isColorAbility(spell)) this.payForColorAbility(me, spell, freeBonus);
        else this.payForSpell(me, spell, freeBonus, mods);
        // Channel and Delay hold the spell instead of resolving it now.
        if (mods.includes('channel')) {
          me.channeledCast = { spell, target: aimed, point, point2, modifiers: mods };
          me.actions = { move: 0, main: 0, bonus: 0 };
          this.gs.log(
            `${me.name} begins channelling ${spell.name} — they can do nothing else until it breaks free.`
          );
          break;
        }
        if (mods.includes('delay')) {
          me.delayedCast = { spell, target: aimed, point, point2, modifiers: mods };
          this.gs.log(`${me.name} delays ${spell.name} until their next turn.`);
          break;
        }
        const spellItem = this.gs.makeSpellItem(me, spell, aimed, point, undefined, point2, mods);
        const rodTarget =
          me.hands.includes('mutivargRod' as ItemId) && aimed && aimed !== me
            ? aimed
            : null;
        const burnRodMana = (): void => {
          if (!rodTarget?.alive) return;
          const burn = Math.floor(rodTarget.mana * 0.2);
          if (burn <= 0) return;
          rodTarget.spendMana(burn);
          this.gs.log(`The rod burns ${burn} mana from ${rodTarget.name}.`);
        };
        if (opts.queueOnly && rodTarget) {
          const resolveSpell = spellItem.resolve;
          spellItem.resolve = async (game) => {
            await resolveSpell(game);
            burnRodMana();
          };
        }
        await runAction(spellItem);
        // Mutivarg's Rod: spells cast through it burn 20% of the target's mana.
        if (!opts.queueOnly) burnRodMana();
        break;
      }
      case 'cast-random': {
        // A scrambled mage (Mind Curse) casts a random spell. Both peers draw
        // from the same synced RNG, so they pick the same spell + target.
        const sub = this.randomCastFor(me);
        if (sub) {
          this.gs.log(`${me.name} is scrambled. ${sub.spell.name} is cast instead.`);
          this.payForSpell(me, sub.spell, freeBonus);
          await runAction(this.gs.makeSpellItem(me, sub.spell, sub.target, sub.point));
        }
        break;
      }
      case 'item-drop': {
        const itemId = cmd.itemId as ItemId;
        if (getItem(itemId).permanentlyBinding) {
          this.gs.log(`${getItem(itemId).name} is permanently bound to ${me.name}.`);
          break;
        }
        spend('bonus');
        await runAction(
          this.gs.makeActionItem({
            source: me,
            label: 'Drop',
            description: `${me.name} drops an item.`,
            resolve: (game) => {
              game.dropItem(me, itemId);
            },
          })
        );
        break;
      }
      case 'item-pickup': {
        spend('bonus');
        await runAction(
          this.gs.makeActionItem({
            source: me,
            label: 'Pick up',
            description: `${me.name} picks up an item.`,
            resolve: (game) => {
              game.pickUpItem(me, cmd.dropId);
            },
          })
        );
        break;
      }
      case 'item-use': {
        const itemId = cmd.itemId as ItemId;
        if (me.isItemBanned(itemId)) {
          this.gs.log(
            `${me.name} reaches for ${getItem(itemId).name}, but it has been stifled forever.`
          );
          break;
        }
        spend('bonus');
        await runAction(
          this.gs.makeActionItem({
            source: me,
            label: 'Use',
            description: `${me.name} uses ${getItem(itemId).name}.`,
            needleBan: { kind: 'item', itemId },
            resolve: () => {
              this.useConsumable(me, itemId);
            },
          })
        );
        break;
      }
      case 'item-equip': {
        const itemId = cmd.itemId as ItemId;
        spend('bonus');
        await runAction(
          this.gs.makeActionItem({
            source: me,
            label: 'Equip',
            description: `${me.name} equips ${getItem(itemId).name}.`,
            resolve: () => {
              if (me.equipFromBag(itemId)) {
                this.gs.notifyLightActivation(me);
                this.gs.log(`${me.name} equips ${getItem(itemId).name}.`);
              }
            },
          })
        );
        break;
      }
      case 'item-unequip': {
        const itemId = cmd.itemId as ItemId;
        if (getItem(itemId).permanentlyBinding) {
          this.gs.log(`${getItem(itemId).name} is permanently bound to ${me.name}.`);
          break;
        }
        spend('bonus');
        await runAction(
          this.gs.makeActionItem({
            source: me,
            label: 'Unequip',
            description: `${me.name} stows ${getItem(itemId).name}.`,
            resolve: () => {
              if (me.unequipHand(itemId))
                this.gs.log(`${me.name} stows ${getItem(itemId).name} in the bag.`);
            },
          })
        );
        break;
      }
      case 'item-throw': {
        const itemId = cmd.itemId as ItemId;
        if (me.isItemBanned(itemId)) {
          this.gs.log(
            `${me.name} reaches for ${getItem(itemId).name}, but it has been stifled forever.`
          );
          break;
        }
        spend('bonus');
        const target = this.mageBySeat(cmd.target);
        await runAction(
          this.gs.makeActionItem({
            source: me,
            label: 'Throw',
            description: `${me.name} throws ${getItem(itemId).name} at ${target.name}.`,
            needleBan: { kind: 'item', itemId },
            resolve: (game) => {
              game.throwItem(me, target, itemId);
            },
          })
        );
        break;
      }
      case 'edgelord-shake': {
        if (
          !me.hasEdgelordLantern() ||
          me.isItemBanned('edgelordLantern') ||
          (!me.edgelordLanternActive &&
            (me.mana < 4 || this.gs.edgelordCaptives(me).length > 0))
        ) break;
        spend('bonus');
        const activating = !me.edgelordLanternActive;
        await runAction(
          this.gs.makeActionItem({
            source: me,
            label: activating ? 'Awaken Lantern' : 'Seal Lantern',
            description: `${me.name} shakes the Edgelord Lantern.`,
            needleBan: { kind: 'item', itemId: 'edgelordLantern' },
            resolve: async (game) => {
              await game.shakeEdgelordLantern(me);
            },
          })
        );
        break;
      }
      case 'edgelord-throw': {
        const point = { x: cmd.x, y: cmd.y };
        if (
          !this.canUseEdgelordThrow(me) ||
          dist(me.pos, point) > Math.max(0, me.effectiveStr()) * RANGE_UNIT
        ) break;
        me.actions = { move: 0, main: 0, bonus: 0 };
        me.reactionAvailable = false;
        me.reactedThisCycle = true;
        await runAction(
          this.gs.makeActionItem({
            source: me,
            label: 'Throw Edgelord Lantern',
            description: `${me.name} hurls the loaded Edgelord Lantern.`,
            targetPoint: point,
            hostileAttack: true,
            actionVisual: 'lightningImpact',
            needleBan: { kind: 'item', itemId: 'edgelordLantern' },
            resolve: (game) => {
              game.throwEdgelordLantern(me, point);
            },
          })
        );
        break;
      }
      case 'deaths-angel-wings': {
        await this.performDeathsAngelWings(me, freeBonus, runAction);
        break;
      }
      case 'eldritch': {
        if (me.isActionBanned('eldritch')) {
          this.gs.log(`${me.name} reaches for eldritch truth, but it has been stifled forever.`);
          break;
        }
        spend('main');
        const target = cmd.target ? this.mageBySeat(cmd.target) : null;
        await runAction(
          this.gs.makeActionItem({
            source: me,
            label: 'Eldritch',
            description: `${me.name} invokes eldritch truth.`,
            needleBan: { kind: 'ability', key: 'eldritch', label: 'the Eldritch action' },
            resolve: (game) => game.useEldritch(me, cmd.choice, target),
          })
        );
        break;
      }
      case 'thunder-charge': {
        if (me.isActionBanned('thunder-charge')) {
          this.gs.log(`${me.name} reaches to charge thunder, but it has been stifled forever.`);
          break;
        }
        spend('bonus');
        await runAction(
          this.gs.makeActionItem({
            source: me,
            label: 'Charge Up',
            description: `${me.name} charges up thunder.`,
            needleBan: { kind: 'ability', key: 'thunder-charge', label: 'Charge Up' },
            resolve: (game) => {
              game.chargeUpThunder(me);
            },
          })
        );
        break;
      }
      case 'thunder-discharge': {
        if (me.isActionBanned('thunder-discharge')) {
          this.gs.log(`${me.name} reaches to discharge thunder, but it has been stifled forever.`);
          break;
        }
        spend('bonus');
        const target = this.mageBySeat(cmd.target);
        await runAction(
          this.gs.makeActionItem({
            source: me,
            target,
            label: 'Discharge',
            description: `${me.name} discharges thunder at ${target.name}.`,
            needleBan: { kind: 'ability', key: 'thunder-discharge', label: 'Discharge' },
            resolve: (game) => game.dischargeThunder(me, target),
          })
        );
        break;
      }
      case 'weapon-action': {
        const abilityIds = me.weaponAbilityItems();
        const firstAbility = abilityIds.length ? getItem(abilityIds[0]).weaponAbility : undefined;
        const weaponActionLabel =
          firstAbility === 'blackBellMode'
            ? `Black Bell — ${me.blackBellCondense ? 'Condense' : 'Toll'}`
            : firstAbility === 'shadowDaggerTeleport'
              ? 'Dagger of Shadow'
            : 'Weapon Action';
        if (firstAbility && me.isActionBanned(`weapon:${firstAbility}`)) {
          this.gs.log(`${me.name}'s weapon action has been stifled forever.`);
          break;
        }
        spend('bonus');
        await runAction(
          this.gs.makeActionItem({
            source: me,
            label: weaponActionLabel,
            description:
              firstAbility === 'blackBellMode'
                ? `${me.name} changes Black Bell from ${me.blackBellCondense ? 'Condense' : 'Toll'} mode.`
                : firstAbility === 'shadowDaggerTeleport'
                  ? `${me.name} reaches through one shadow toward another.`
                : `${me.name} uses a weapon action.`,
            needleBan: firstAbility
              ? { kind: 'ability', key: `weapon:${firstAbility}`, label: 'that weapon action' }
              : undefined,
            resolve: async (game) => {
              for (const id of me.weaponAbilityItems()) {
                const ability = getItem(id).weaponAbility;
                if (ability === 'bastionSwap') game.swapBastionForm(me);
                else if (ability === 'mutivargZone') game.castMutivargZone(me);
                else if (ability === 'gamblerCash') await this.gamblerCashOut(me);
                else if (ability === 'blackBellMode') game.toggleBlackBellMode(me);
                else if (
                  ability === 'shadowDaggerTeleport' &&
                  cmd.x != null &&
                  cmd.y != null
                ) game.useShadowDagger(me, { x: cmd.x, y: cmd.y });
              }
            },
          })
        );
        break;
      }
      case 'leap': {
        spend('bonus');
        me.leapsUsed += 1;
        // Roll the d6 deterministically so both peers agree on the distance.
        const roll = this.gs.rng.roll('1d6').total;
        const distPx = (roll / 6) * (1 + 0.25 * me.effectiveDex()) * RANGE_UNIT;
        const aim = { x: cmd.x, y: cmd.y };
        await runAction(
          this.gs.makeActionItem({
            source: me,
            label: 'Leap',
            description: `${me.name} leaps.`,
            resolve: (game) => {
              const dest = stepTowards(me.pos, aim, distPx);
              game.leapMove(me, dest);
              game.log(`${me.name} leaps (d6=${roll}) ${(distPx / RANGE_UNIT).toFixed(1)}R.`);
            },
          })
        );
        break;
      }
      case 'raid-begin':
        this.beginRaidBossFight();
        break;
      case 'raid-restore':
        this.applyRaidPrepRestore(me, cmd.kind);
        break;
      case 'focus': {
        me.focusUsed = true;
        me.focusNextSpell = true;
        // Focus burns all remaining bonus actions and this turn cycle's reaction.
        me.actions.bonus = 0;
        me.reactionAvailable = false;
        me.reactedThisCycle = true;
        await runAction(
          this.gs.makeActionItem({
            source: me,
            label: 'Focus',
            description: `${me.name} focuses.`,
            resolve: (game) => {
              game.log(
                `${me.name} focuses — the next word spell this turn costs half mana and rolls its DC twice.`
              );
            },
          })
        );
        break;
      }
      case 'cleave': {
        spend('main');
        me.cleaveUsed = true;
        const aim = { x: cmd.x, y: cmd.y };
        // A broad crescent sweep in front of the swinger dresses the 180° arc.
        const reach = me.activeWeapon()?.rangePx ?? MELEE_RANGE;
        const dir = Math.atan2(aim.y - me.pos.y, aim.x - me.pos.x);
        const center = {
          x: me.pos.x + Math.cos(dir) * reach * 0.55,
          y: me.pos.y + Math.sin(dir) * reach * 0.55,
        };
        void this.vfxSlash('fx-slash-sweep', center, dir, reach * 2.6);
        await runAction(
          this.gs.makeActionItem({
            source: me,
            label: 'Cleave',
            description: `${me.name} cleaves in a wide arc.`,
            isStillValid: () => me.alive && !!me.activeWeapon(),
            resolve: (game) => game.resolveCleave(me, aim),
          })
        );
        break;
      }
      case 'command': {
        // Owner directs a summon: it becomes the current mage for one action.
        const owner = me;
        const summon = this.mageBySeat(cmd.summon);
        if (!summon.isSummon || !summon.alive || summon.summonOwnerIndex !== this.seatOf(owner)) break;
        spend('bonus');
        summon.actions = { move: 1, main: 1, bonus: 1 };
        summon.hasCastThisTurn = false;
        this.puppet = { summon, owner, savedIndex: this.gs.currentIndex };
        this.gs.currentIndex = this.gs.mages.indexOf(summon);
        this.gs.log(`${owner.name} commands ${summon.name}.`);
        break;
      }
      case 'uncommand': {
        if (this.puppet) {
          const { owner, savedIndex } = this.puppet;
          this.gs.currentIndex = savedIndex;
          this.puppet = null;
          this.gs.log(`${owner.name} resumes their turn.`);
        }
        break;
      }
      case 'mantle-bind': {
        if (me.bindMantleCharges <= 0) break;
        spend('bonus');
        me.bindMantleCharges -= 1;
        await runAction(
          this.gs.makeActionItem({
            source: me,
            label: 'Weak Bind',
            description: `${me.name} invokes a binding mantle.`,
            resolve: (game) => game.applyMantleBind(me),
          })
        );
        break;
      }
      case 'cleanse': {
        const cost = me.cleanseManaCost();
        if (cost == null || me.mana < cost) break;
        spend('bonus');
        await runAction(
          this.gs.makeActionItem({
            source: me,
            label: 'Cleanse',
            description: `${me.name} drinks from the Chalice of Clear Water.`,
            resolve: (game) => {
              game.cleanseAfflictions(me);
            },
          })
        );
        break;
      }
      case 'end':
        // Handled by the caller (local onEndTurn / remote driver) so the turn
        // rotation happens exactly once per peer.
        break;
    }

    // A puppeted summon may take its FULL turn (a move AND an attack/cast) under
    // a single Command; control returns to the owner automatically once it has
    // spent both, or is dead, or the owner releases early with End. Only the
    // controlling client issues the release, so it relays to peers like any turn
    // command.
    if (!opts.queueOnly && this.puppet && this.gs.stack.length === 0 && this.isLocalTurn()) {
      const s = this.puppet.summon;
      const mainSpent = s.actions.main < 1 || s.hasCastThisTurn;
      const moveSpent = s.actions.move < 1;
      if (!s.alive || (mainSpent && moveSpent)) this.submitTurn({ t: 'uncommand' });
    }

    // If the command produced no stack action (e.g. a scrambled mage with
    // nothing castable), unlock local input again so the player can still act.
    if (
      !opts.queueOnly &&
      !this.gs.isOver &&
      this.isLocalTurn() &&
      this.gs.stack.length === 0 &&
      this.mode === 'busy'
    ) {
      this.mode = 'idle';
      this.redraw();
    }
  }

  /** Drive the opponent's turn from their relayed commands until they end it. */
  private async runRemoteTurn(): Promise<void> {
    for (;;) {
      if (this.opponentLeft || this.gs.isOver) return;
      const msg = await this.net!.recv();
      if (msg.k !== 'turn') {
        if (msg.k === 'bye') return;
        continue;
      }
      const cmd = msg.cmd as TurnCommand;
      if (cmd.t === 'end') return;
      await this.applyTurnCommand(cmd);
      this.redraw();
    }
  }

  // --- reaction encoding -----------------------------------------------------

  private encodeReaction(choice: ReactionChoice | null): NetMessage {
    if (!choice) return { k: 'react', cmd: { t: 'pass' } satisfies ReactionCommand };
    if (choice.needle) {
      return { k: 'react', cmd: { t: 'needle' } satisfies ReactionCommand };
    }
    if (choice.shield) {
      return { k: 'react', cmd: { t: 'shield', kind: choice.shield } satisfies ReactionCommand };
    }
    if (choice.dodge) {
      return { k: 'react', cmd: { t: 'dodge' } satisfies ReactionCommand };
    }
    if (choice.weapon) {
      return { k: 'react', cmd: { t: 'weapon' } satisfies ReactionCommand };
    }
    const cmd: ReactionCommand = {
      t: 'react',
      spellId: choice.spell!.id,
      ability: this.isColorAbility(choice.spell!),
      target: (choice.target ? this.seatOf(choice.target) : null),
      x: choice.point?.x,
      y: choice.point?.y,
    };
    return { k: 'react', cmd };
  }

  private decodeReaction(msg: NetMessage): ReactionChoice | null {
    const cmd = msg.cmd as ReactionCommand | undefined;
    if (!cmd) return null;
    if (cmd.t === 'needle') return { needle: true };
    if (cmd.t === 'shield') return { shield: cmd.kind };
    if (cmd.t === 'dodge') return { dodge: true };
    if (cmd.t === 'weapon') return { weapon: true };
    if (cmd.t !== 'react') return null;
    const spell = this.resolveSpellId(cmd.spellId);
    if (!spell) return null;
    const target = cmd.target != null ? this.mageBySeat(cmd.target) : undefined;
    const point = cmd.x != null && cmd.y != null ? { x: cmd.x, y: cmd.y } : undefined;
    return { spell, target, point };
  }

  // --- sub-target encoding ---------------------------------------------------

  private async recvSubPoint(): Promise<Vec2 | null> {
    const msg = await this.net!.recv();
    const cmd = msg.cmd as SubCommand | undefined;
    if (cmd && cmd.t === 'sub-point') return { x: cmd.x, y: cmd.y };
    return null;
  }

  private async recvSubEnemy(): Promise<Mage | null> {
    const msg = await this.net!.recv();
    const cmd = msg.cmd as SubCommand | undefined;
    if (cmd && cmd.t === 'sub-enemy') return this.mageBySeat(cmd.target);
    return null;
  }

  private sendSubPoint(v: Vec2 | null): void {
    const cmd: SubCommand = v ? { t: 'sub-point', x: v.x, y: v.y } : { t: 'sub-none' };
    this.net?.send({ k: 'sub', cmd });
  }

  private sendSubEnemy(m: Mage | null): void {
    const cmd: SubCommand = m ? { t: 'sub-enemy', target: this.seatOf(m) } : { t: 'sub-none' };
    this.net?.send({ k: 'sub', cmd });
  }

  // --- Gambler's Blade cash-out (interactive mid-combat draft) ---------------

  /**
   * Gambler's Blade weapon command: shatter the blade, then draft one item per
   * 5 Greed stacks. The three options per pick are rolled from the shared RNG
   * (identical on both peers); the human chooses and the index is relayed.
   */
  private async gamblerCashOut(mage: Mage): Promise<void> {
    const game = this.gs;
    const n = game.shatterGamblerBlade(mage);
    if (n <= 0) {
      game.log(`${mage.name} cashes out the Gambler's Blade, but greed was too thin to pay out.`);
      return;
    }
    const drafted: string[] = [];
    for (let i = 0; i < n; i++) {
      const rarity = rollRarity(() => game.rng.float(), mage.maxLuck, this.swamprun);
      const options = draftChoices(rarity, () => game.rng.float(), 3, this.swamprun);
      if (!options.length) continue;
      const idx = await this.chooseGamblerItem(mage, options, i + 1, n);
      const id = options[Math.max(0, Math.min(options.length - 1, idx))];
      game.grantItem(mage, id);
      drafted.push(getItem(id).name);
    }
    game.log(
      `${mage.name} cashes out the Gambler's Blade for ${drafted.length} item${drafted.length === 1 ? '' : 's'}: ${drafted.join(', ') || 'nothing'}.`
    );
  }

  /** Resolve one Gambler cash-out pick (AI rolls, remote relays, human picks). */
  private async chooseGamblerItem(
    mage: Mage,
    options: ItemId[],
    round: number,
    total: number
  ): Promise<number> {
    if (this.controllerIsAI(mage)) {
      return Math.floor(this.gs.rng.float() * options.length);
    }
    // Online: the acting player picks; the other peer waits for the relayed index.
    if (this.online && !this.isLocalDecider(mage)) {
      return this.recvDraftPick(options.length);
    }
    await this.playPendingDice();
    const idx = await this.showGamblerPicker(mage, options, round, total);
    if (this.online) this.sendDraftPick(idx);
    return idx;
  }

  /** Show the draft overlay for a single Gambler pick and resolve the chosen index. */
  private showGamblerPicker(
    mage: Mage,
    options: ItemId[],
    round: number,
    total: number
  ): Promise<number> {
    this.shopMage = mage;
    this.shopOptions = [...options];
    this.gamblerRound = round;
    this.gamblerTotal = total;
    this.shopLocked = false;
    return new Promise<number>((resolve) => {
      this.gamblerResolve = resolve;
      this.buildShopOverlay();
      this.refreshShopOverlay();
    });
  }

  private sendDraftPick(idx: number): void {
    const cmd: DraftCommand = { t: 'draft', index: idx };
    this.net?.send({ k: 'draft', cmd });
  }

  private async recvDraftPick(count: number): Promise<number> {
    const msg = await this.net!.recv();
    const cmd = msg.cmd as DraftCommand | undefined;
    const idx = cmd && cmd.t === 'draft' ? Number(cmd.index) : 0;
    return Number.isFinite(idx) ? Math.max(0, Math.min(count - 1, idx)) : 0;
  }

  /** The opponent dropped: freeze the duel and offer a return to the menu. */
  private onOpponentLeft(): void {
    if (this.opponentLeft || this.gs.isOver) return;
    this.opponentLeft = true;
    this.mineRunEnded = true;
    this.mineChoiceResolve?.('');
    this.mineChoiceResolve = null;
    this.mineCombatResolve?.();
    this.mineCombatResolve = null;
    this.hideMinePanel();
    this.mode = 'over';
    // Unblock the assignment phase if we're disconnected mid-allocation.
    if (this.assignResolve) {
      const resolve = this.assignResolve;
      this.assignResolve = null;
      resolve(defaultAssignment());
    }
    // Unblock the shop phase if we're disconnected mid-purchase.
    if (this.shopResolve) {
      const resolve = this.shopResolve;
      this.shopResolve = null;
      resolve([]);
    }
    this.hideAssignOverlay();
    this.hideShopOverlay();
    this.showEndCard({
      eyebrow: 'ONLINE SESSION',
      title: 'CONNECTION LOST',
      detail: 'The other player left the relay. This match cannot continue.',
      actionLabel: 'RETURN TO MAIN MENU',
      tone: 'warning',
      onActivate: () => this.returnToMenu(),
    });
    this.redraw();
  }

  // ===========================================================================
  //  THE STACK  (resolve with reaction windows)
  // ===========================================================================

  /** Put one action on the stack and perform its pre-reaction presentation. */
  private async stageStackItem(initial: StackItem): Promise<void> {
    this.recordLastAction(initial);
    this.busy = true;
    this.mode = 'busy';
    this.gs.pushStack(initial);
    // Subtle decides silence before anyone may answer the cast.
    if (initial.modifiers?.includes('subtle')) await this.rollSubtleSilence(initial);
    if (
      initial.target &&
      initial.source.team !== initial.target.team &&
      (initial.kind === 'melee' || initial.kind === 'spell' || initial.hostileAttack)
    ) {
      this.gs.triggerOniAmbush(initial.source, initial.target);
      // The ambush teleports hidden Oni; that jump must not read as evasion.
      this.gs.markTargetOrigin(initial);
      const oniTrigger = this.buildOniTurnEndTrigger();
      if (oniTrigger) this.gs.pushStack(oniTrigger);
    }
    this.redraw();
    if (initial.kind === 'spell') this.setCharging(initial.source, true);
    await this.delay(250);
  }

  private async runStack(initial: StackItem): Promise<void> {
    const prevMode = this.mode;
    await this.stageStackItem(initial);

    await this.resolveStackLoop();

    this.busy = false;
    const oniForcedTurnEnd = this.gs.takeOniForcedTurnEnd();
    this.maintainRaidEffigies();
    // A Reaper felled by this action releases everyone it had deleted, before
    // the board is judged (so a surviving ally's kill un-does the clap).
    if (
      this.gs.restoreReaperDeletions().length > 0 ||
      this.gs.restoreEdgelordCaptives().length > 0
    ) this.syncMageSprites();
    // Swamprun: if the acting player's blow cleared the wave, run the between-wave
    // interlude (loot + shop + next wave) before the game-over check — otherwise
    // the run would freeze on an empty board.
    const restartedCombat = this.swamprunWaveCleared() ? await this.runWaveInterlude() : false;
    if (this.gs.isOver) {
      this.mode = 'over';
    } else if (this.mineRun && this.mineExploring) {
      this.mode = 'shop';
    } else if (this.online && !this.isLocalTurn()) {
      // Mid-way through the opponent's relayed turn: stay locked.
      this.mode = 'busy';
    } else if (this.controllerIsAI(this.gs.current)) {
      this.mode = prevMode === 'busy' ? 'busy' : 'idle';
    } else {
      this.mode = 'idle';
    }
    this.redraw();
    if (restartedCombat) await this.startTurn();
    else if (oniForcedTurnEnd === this.gs.current) await this.nextTurn(true);
  }

  /** Combined potency of the modifiers riding on a cast (Subtle 0.8, Channel 1.5). */
  private modifierPotency(modifiers?: WordId[]): number {
    if (!modifiers?.length) return 1;
    let potency = 1;
    if (modifiers.includes('subtle')) potency *= 0.8;
    if (modifiers.includes('channel')) potency *= 1.5;
    return potency;
  }

  /** Release whatever Channel or Delay parked on this mage's turn start. */
  private async releasePendingCasts(me: Mage): Promise<void> {
    const channeled = me.channeledCast;
    if (channeled && me.alive) {
      me.channeledCast = undefined;
      me.spend('main');
      this.gs.log(`${me.name} releases the channelled ${channeled.spell.name} at full force.`);
      await this.runStack(
        this.gs.makeSpellItem(
          me,
          channeled.spell,
          channeled.target,
          channeled.point,
          undefined,
          channeled.point2,
          channeled.modifiers
        )
      );
    }
    const delayed = me.delayedCast;
    if (delayed && me.alive && !this.gs.isOver) {
      me.delayedCast = undefined;
      this.gs.log(`${me.name}'s delayed ${delayed.spell.name} arrives.`);
      await this.runStack(
        this.gs.makeSpellItem(
          me,
          delayed.spell,
          delayed.target,
          delayed.point,
          undefined,
          delayed.point2,
          delayed.modifiers
        )
      );
    }
    if (me.delayedItems.length > 0) {
      const held = me.delayedItems;
      me.delayedItems = [];
      for (const item of held) {
        if (this.gs.isOver) break;
        this.gs.log(`${item.label} was held back and now resolves.`);
        await this.runStack(item);
      }
    }
  }

  /** Subtle casting: a DC 11 check decides whether the spell makes any sound. */
  private async rollSubtleSilence(item: StackItem): Promise<void> {
    const roll = this.gs.rng.roll('1d20');
    this.pendingDice = [
      {
        spec: '1d20',
        total: roll.total,
        rolls: roll.rolls,
        label: 'Subtle — silent?',
        seq: this.vfxSeq++,
      },
    ];
    item.silent = roll.total >= 11;
    this.gs.log(
      `${item.source.name} casts subtly: 1d20=${roll.total} vs DC 11 — ${
        item.silent ? 'utterly silent; nothing may answer it.' : 'the casting is heard.'
      }`
    );
    await this.playPendingDice();
  }

  private buildOniTurnEndTrigger(): StackItem | null {
    const pending = this.gs.takeOniTurnEndTrigger();
    if (!pending) return null;
    const trigger = this.gs.makeActionItem({
      source: pending.oni,
      target: pending.player,
      label: 'Oni Ambush',
      description: `The Oni try to end ${pending.player.name}'s turn.`,
      needleBan: { kind: 'ability', key: 'oni-turn-end', label: 'the Oni turn-end trigger' },
      resolve: (game) => game.resolveOniTurnEnd(pending.player),
    });
    trigger.noPhysicalReaction = true;
    trigger.allowCurrentReaction = true;
    return trigger;
  }

  /**
   * Open a self-contained reaction window mid-flow (end of turn, or between the
   * steps of a multi-step spell) so opponents may spend their reaction against a
   * synthetic no-op trigger. Reuses the normal stack-resolution loop so any
   * reaction cast here resolves exactly as it would during a regular action.
   * Only counter-magic is offered — never a Dodge/Block/Bash (nothing to defend).
   */
  private async offerReactionWindow(
    source: Mage,
    label: string,
    opts: { at?: Vec2; description?: string } = {}
  ): Promise<void> {
    if (this.gs.isOver || !source.alive) return;
    const trigger = this.gs.makeActionItem({
      source,
      label,
      description: opts.description ?? `${source.name}: ${label}.`,
      resolve: () => {},
    });
    trigger.noPhysicalReaction = true;
    if (opts.at) trigger.targetPoint = opts.at;
    // Skip the window entirely when nobody could answer it — keeps play snappy
    // and avoids exchanging empty reaction messages online. Deterministic on
    // both peers because it reads only shared game state.
    if (!this.reactorsFor(trigger).some((r) => this.reactorCanRespond(r, trigger))) return;
    const prevMode = this.mode;
    const wasBusy = this.busy;
    this.busy = true;
    this.gs.pushStack(trigger);
    this.redraw();
    await this.resolveStackLoop();
    this.busy = wasBusy;
    if (!this.gs.isOver) this.mode = prevMode;
    this.redraw();
  }

  /**
   * Resolve every item currently on the stack, opening a reaction window on the
   * top item before it resolves. Extracted from {@link runStack} so mid-flow
   * windows ({@link offerReactionWindow}) can re-enter the exact same logic.
   */
  private async resolveStackLoop(): Promise<void> {
    // `${itemId}:${seat}` — a reactor has already had its window on that item.
    const passed = new Set<string>();
    while (this.gs.stack.length > 0) {
      const top = this.gs.stack[this.gs.stack.length - 1];
      if (top.target?.deathknightKind && top.source.team !== top.target.team && !top.silent) {
        const deathknightReaction = this.gs.makeDeathknightTargetReaction(
          top.target,
          top.source,
          top.id,
          !!top.spell?.aoe
        );
        if (deathknightReaction) {
          this.gs.pushStack(deathknightReaction);
          this.redraw();
          await this.delay(250);
          continue;
        }
      }

      // --- Reaction window: every living ENEMY of the acting mage gets a
      //     single chance to answer the action, offered in initiative order.
      //     Any reaction that removes the item or pushes a counter re-opens the
      //     loop on the new top; Block/Bash just modify state and let the next
      //     enemy respond before the action finally resolves.
      let stackChanged = false;
      for (const reactor of this.reactorsFor(top)) {
        const key = `${top.id}:${this.seatOf(reactor)}`;
        if (passed.has(key)) continue;
        if (!this.reactorCanRespond(reactor, top)) {
          passed.add(key);
          continue;
        }
        const choice = await this.getReaction(reactor, top);
        if (choice && (choice.needle || choice.spell || choice.dodge || choice.shield || choice.weapon)) {
          this.gs.twistReactionNeedle(reactor);
          this.gs.burnMindFuse(reactor);
        }
        if (choice && choice.needle) {
          // Needle of Serenity: stifle the ability/strike (it never resolves)
          // and disable it against this reactor forever. One-time use.
          reactor.reactedThisCycle = true;
          this.applyNeedle(reactor, top);
          this.gs.removeStackItem(top.id);
          stackChanged = true;
          break;
        }
        if (choice && choice.spell) {
          if (this.isColorAbility(choice.spell)) {
            // payForColorAbility tracks the per-combat cast cap for us.
            this.payForColorAbility(reactor, choice.spell);
          } else {
            this.payForSpell(reactor, choice.spell);
            reactor.wordSpellReactionsUsed += 1;
          }
          reactor.reactedThisCycle = true;
          reactor.reactionUsedRecently = true;
          const item = this.gs.makeSpellItem(
            reactor,
            choice.spell,
            choice.target ?? null,
            choice.point ?? null,
            top.id
          );
          this.gs.pushStack(item);
          this.setCharging(reactor, true);
          stackChanged = true;
          break;
        }
        if (choice && choice.dodge) {
          // A dodge rolls to slip aside; on a hit the whole action is negated.
          const dodgeTier = await this.performDodge(reactor, top);
          if (dodgeTier !== 'none') {
            this.gs.removeStackItem(top.id);
            if (dodgeGrantsBonusAction(dodgeTier)) {
              await this.offerDodgeBonusAction(reactor);
            }
            stackChanged = true;
            break;
          }
          passed.add(key);
        } else if (choice && choice.shield === 'block') {
          // Arm the shield; the physical blow is blunted as it lands.
          reactor.reactedThisCycle = true;
          reactor.blockPending = true;
          this.gs.log(`${reactor.name} raises a shield against ${top.label}.`);
          this.redraw();
          passed.add(key);
        } else if (choice && choice.shield === 'bash') {
          // A bash answers the blow, smashing the attacker; the action still lands.
          reactor.reactedThisCycle = true;
          this.gs.shieldBash(reactor, top.source);
          this.redraw();
          passed.add(key);
        } else if (choice && choice.weapon) {
          // White identity: answer the attack with a basic weapon strike of your
          // own. Resolve it immediately (no new stack item / reaction window) so
          // it cannot recurse into further weapon reactions. The action being
          // reacted to still resolves normally afterwards.
          reactor.reactedThisCycle = true;
          reactor.reactionUsedRecently = true;
          reactor.weaponReactionsUsed += 1;
          const strike = this.gs.makeMeleeItem(reactor, top.source);
          this.gs.log(`${reactor.name} answers with a weapon strike!`);
          if (strike.isStillValid(this.gs)) {
            await this.playActionVisual(strike);
            this.pendingDice = [];
            await strike.resolve(this.gs);
            await this.playPendingDice();
            this.flushHits();
          }
          this.redraw();
          await this.delay(200);
          passed.add(key);
        } else {
          passed.add(key);
        }
      }

      if (stackChanged) {
        this.redraw();
        await this.delay(250);
        if (this.gs.isOver) break;
        continue;
      }

      // Resolve the top item now that the reaction window has closed.
      const resolved = await this.resolveTop();
      const oniTrigger = this.buildOniTurnEndTrigger();
      if (oniTrigger) this.gs.pushStack(oniTrigger);
      // A mage carrying a Shadow Trail leaves a pool of shadow where it walks.
      if (resolved && resolved.kind === 'move') this.gs.dropTrailShadows(resolved.source);
      // Repositioning (moves, dashes) can bring an enemy point-blank, which
      // collapses any half veil they were hiding behind.
      this.gs.breakProximityVeils();

      this.redraw();
      if (this.gs.isOver) break;
      await this.delay(200);
    }
  }

  private async resolveTop(): Promise<StackItem | null> {
    const item = this.gs.stack.pop();
    if (!item) return null;

    // A spell/action fizzles entirely (including any counter effect) if its
    // target is no longer valid when it resolves.
    if (!item.isStillValid(this.gs)) {
      this.gs.log(`${item.label} fizzles. No valid target.`);
      if (item.kind === 'spell') this.setCharging(item.source, false);
      await this.delay(150);
      return item;
    }

    // Bound after declaring: the body can no longer follow the action through.
    const bound = this.gs.stunPrevents(item);
    if (bound) {
      this.gs.log(`${item.label} fails. ${item.source.name} is ${bound}.`);
      if (item.kind === 'spell') this.setCharging(item.source, false);
      await this.delay(220);
      return item;
    }

    // A spell must beat its difficulty: roll 1d20 vs the spell's DC. On a miss
    // the spell fizzles entirely (charges/actions are already spent) and no
    // counter effect triggers. A natural 20 also crits (doubled potency).
    this.gs.critThisCast = false;
    this.gs.spellRollThisCast = 0;
    if (item.kind === 'spell' && item.spell && item.spell.dc) {
      this.pendingDice = [];
      const res = this.rollSpellSuccess(item.spell, item.source);
      await this.playPendingDice();
      if (!res.ok) {
        this.setCharging(item.source, false);
        await this.delay(120);
        return item;
      }
      this.gs.critThisCast = res.crit;
      this.gs.spellRollThisCast = res.roll;
    }
    if (item.kind === 'spell' && item.spell && !item.spell.words.some((w) => SELF_VOICED_WORDS.has(w))) {
      playSound(item.spell.words.includes('death') ? 'unit.death' : 'spell.cast');
    }

    if (item.counters && item.respondingTo != null) {
      const target = this.gs.stack.find((i) => i.id === item.respondingTo);
      if (target) {
        this.gs.removeStackItem(item.respondingTo);
        this.gs.log(`${item.label} counters ${target.label}!`);
        if (target.kind === 'spell') this.setCharging(target.source, false);
      }
    }

    // Delay lifts the answered action off the stack and re-times it.
    if (item.spell?.delaysStackItem && item.respondingTo != null) {
      const held = this.gs.stack.find((i) => i.id === item.respondingTo);
      if (held) {
        this.gs.removeStackItem(item.respondingTo);
        const victim = held.target ?? held.source;
        victim.delayedItems.push(held);
        if (held.kind === 'spell') this.setCharging(held.source, false);
        this.gs.log(`${held.label} is delayed until ${victim.name}'s next turn begins.`);
      } else {
        this.gs.log(`${item.label} finds nothing left to delay.`);
      }
    }

    // Last look before the effect lands: a target that slipped out of range (or
    // stopped being legal) during the reaction window is off the hook entirely.
    if (!item.isStillValid(this.gs)) {
      this.gs.log(`${item.label} fizzles. The target moved out of range.`);
      if (item.kind === 'spell') this.setCharging(item.source, false);
      await this.delay(150);
      return item;
    }

    // Ground covered since the attack was declared beats it outright — this is
    // what makes a movement spell answer a swing, an arrow or a bolt.
    if (this.gs.attackEvaded(item)) {
      this.gs.log(
        `${item.target?.name ?? 'The target'} is already gone — ${item.label} strikes empty ground.`
      );
      if (item.kind === 'spell') this.setCharging(item.source, false);
      await this.delay(150);
      return item;
    }

    // 1) Finish charging, then play the spell/melee animation and the attack
    //    one-shot (synced to the projectile) as the effect travels to its target.
    if (item.kind === 'spell') await this.finishChargeThenAttack(item.source);
    await this.playActionVisual(item);

    // 2) Apply the effect. Dice rolled inside cast() queue up in pendingDice.
    //    A spell may await interactive sub-targeting here, so resolve is async.
    this.gs.castPotency = this.modifierPotency(item.modifiers);
    this.gs.castSilent = !!item.silent;
    this.gs.resolvingSpell = item.spell ?? null;
    // Every mid-spell dice flush happens inside resolve, so one flag here holds
    // them all back for a single roll once the spell has played out.
    this.deferDice = diceTiming() === 'after';
    this.pendingDice = [];
    await item.resolve(this.gs);
    this.deferDice = false;
    if (item.spell?.nullifiesStack && this.gs.stack.length > 0) {
      const nullified = this.gs.nullifyStack();
      for (const older of nullified) {
        if (older.kind === 'spell') this.setCharging(older.source, false);
      }
      this.gs.log(
        `${item.label} nullifies ${nullified.length} stack item${nullified.length === 1 ? '' : 's'}: ${nullified
          .map((older) => older.label)
          .join(', ')}.`
      );
    }
    // The crit flag only applies to the cast that rolled it; clear it now so
    // later ticks / effects (which build their own context) are never doubled.
    this.gs.critThisCast = false;
    this.gs.spellRollThisCast = 0;
    this.gs.castPotency = 1;
    this.gs.castSilent = false;
    this.gs.resolvingSpell = null;
    // A hostile single-target spell that dealt no instant damage (no hit overlay
    // was queued for its foe) paints the "disrupt" sheet on the target instead,
    // so pure control spells (Mind, Bind, Twist, …) still read as landing.
    if (item.kind === 'spell' && item.spell?.targeting === 'enemy' && item.target) {
      const struck = this.pendingEffects.some((e) => e.mage === item.target);
      if (!struck) {
        this.pendingEffects.push({ mage: item.target, kind: 'disrupt' });
        this.pendingSounds.push('spell.impact');
      }
    }
    // 3) Show the dice that were rolled (roll → settle → linger), then the
    //    HP/sanity changes become visible on the next redraw.
    await this.playPendingDice();
    // 4) Now that the damage dice have settled, play the recoil on anyone hit,
    //    so the hit animation lines up with the actual damage.
    this.flushHits();
    await this.delay(100);
    return item;
  }

  /** Roll 1d20 against a spell's DC, queue the die for display, and log it. */
  private rollSpellSuccess(spell: Spell, source: Mage): { ok: boolean; crit: boolean; roll: number } {
    // Blue primary tier and assigned Intellect both lower a spell's difficulty.
    // Ordinary spells receive the standard difficulty surcharge. Class spells
    // use their lower registry-normalized DC directly.
    const baseDc = spell.dc ?? 0;
    const ordinarySurcharge = isClassSpellCombo(spell.words) ? 0 : 3 + (baseDc <= 14 ? 2 : 0);
    const dc = baseDc + ordinarySurcharge - (source.profile.bluePrimaryTier ? 2 : 0) - source.dcReduction();
    // Focus grants advantage on this one cast: roll the DC twice, keep the best.
    const focused = source.focusNextSpell;
    const first = this.gs.rng.roll('1d20');
    let best = first;
    let naturalRolls = first.rolls;
    if (focused) {
      const second = this.gs.rng.roll('1d20');
      naturalRolls = [...first.rolls, ...second.rolls];
      if (second.total > best.total) best = second;
      source.focusNextSpell = false;
    }
    this.pendingDice.push({
      spec: focused ? '2d20 (keep higher)' : '1d20',
      total: best.total,
      rolls: naturalRolls,
      label: `${spell.name} — success?${focused ? ' (focus)' : ''}`,
      seq: this.vfxSeq++,
    });
    let ok = Dev.autoSuccess || best.total >= dc;
    // Luck can turn a near-miss into a hit: spend the minimum needed to reach
    // the DC. Both peers know the roll and the luck pool, so this stays in
    // lockstep without any extra network decision.
    let luckSpent = 0;
    if (!ok && source.luck > 0 && dc - best.total <= source.luck) {
      luckSpent = source.spendLuck(dc - best.total);
      ok = true;
    }
    const luckNote = luckSpent > 0 ? ` (+${luckSpent} luck → ${source.luck} left)` : '';
    // A natural 20 on the kept die is a critical: the spell's damage (or its
    // area / duration) is doubled during resolution. Spells flagged noCrit
    // (Life / Hexcraft class variants) succeed on a 20 but never double.
    const crit = ok && best.rolls.includes(20) && !spell.noCrit;
    const rollText = focused
      ? `2d20=[${naturalRolls.join(', ')}], kept ${best.total}`
      : `1d20=${best.total}`;
    this.gs.log(
      `${source.name}'s ${spell.name}: ${rollText} vs DC ${dc} — ${ok ? 'success!' : 'fizzles.'}${luckNote}${crit ? ' CRITICAL — natural 20!' : ''}`
    );
    // A failed spell can still pay out through gear (Soul Battery / Locket / Tantrum).
    if (!ok) {
      for (const line of source.onSpellFizzle()) this.gs.log(line);
    }
    return { ok, crit, roll: best.total };
  }

  /** Reaction spells the reactor could actually cast right now (charges + valid target). */
  private castableReactions(reactor: Mage): Spell[] {
    // Casting a word-spell as a reaction requires at least one blue word and is
    // capped per combat. Delay grants its own reaction to every mage, and the
    // defensive reactions (Dodge/Block/Bash/Needle) are handled separately.
    const blueReact = reactor.canWordSpellReact();
    const forgotten = reactor.forgotten();
    const pool = allSpells(reactor.mageClass).filter(
      (s) =>
        s.words.every((w) => reactor.loadout.includes(w)) && (blueReact || !!s.delaysStackItem)
    );
    if (pool.length === 0) return [];
    return pool.filter((s) => {
      if (!reactor.hasCharges(s.words)) return false;
      if (!reactor.hasMana(this.spellManaCost(reactor, s))) return false;
      if (!this.gs.canCastSpellNow(s)) return false;
      if (forgotten.length && s.words.some((w) => forgotten.includes(w))) return false;
      if (s.targeting === 'enemy' || s.targeting === 'ally') {
        const tgt = s.targeting === 'ally' ? reactor : this.gs.opponentOf(reactor);
        return this.gs.isValidSpellTarget(s, reactor, tgt);
      }
      return true;
    });
  }

  /** True if `spell` is actually a color ability (paid with charges + mana). */
  private isColorAbility(spell: Spell): spell is ColorAbility {
    return (spell as ColorAbility).chargeCost !== undefined;
  }

  /** Blue mages (any blue in their identity) may respond with color abilities. */
  private canReactWithAbilities(reactor: Mage): boolean {
    return reactor.profile.bluePrimaryTier;
  }

  /** Color abilities the reactor could cast right now as a reaction. */
  private castableAbilities(reactor: Mage): ColorAbility[] {
    if (!this.canReactWithAbilities(reactor)) return [];
    return getColorAbilitiesFor(reactor.profile.primary, reactor.mageClass).filter(
      (ab) =>
        !reactor.isAbilityBanned(ab.id) &&
        reactor.abilityCastsLeft(ab.id) > 0 &&
        this.canAffordAbility(reactor, ab)
    );
  }

  /**
   * Every living enemy of `top.source`, ordered by initiative — the sequence in
   * which they are offered a reaction window against the action.
   */
  private reactorsFor(top: StackItem): Mage[] {
    // A silent cast draws no answer of any kind.
    if (top.silent) return [];
    const order = this.gs.initiativeOrder.length
      ? this.gs.initiativeOrder
      : this.gs.mages.map((_, i) => i);
    // While a summon is puppeted (Command), its owner is still taking their turn.
    const turnOwner = this.puppet?.owner ?? this.gs.current;
    return order
      .map((i) => this.gs.mages[i])
      .filter(
        (m) =>
          m &&
          m.alive &&
          m !== top.source &&
          (top.allowCurrentReaction || m !== this.gs.current) &&
          (top.allowCurrentReaction || m !== turnOwner) &&
          m.team !== top.source.team
      );
  }

  /**
   * True if `reactor` may open a reaction window against `top`. A single window
   * offers every reaction the mage can afford: a counter-spell / colour ability,
   * the Needle of Serenity, and — when `top` is an attack aimed at the reactor —
   * a Dodge, Block or shield-Bash.
   */
  private reactorCanRespond(reactor: Mage, top: StackItem): boolean {
    if (reactor === top.source) return false;
    // You may never react during your own turn (including while you puppet a
    // summon via Command, when `current` is the summon rather than you).
    if (!top.allowCurrentReaction && reactor === this.gs.current) return false;
    if (!top.allowCurrentReaction && reactor === this.puppet?.owner) return false;
    // Physical reactions are meaningless against non-attack triggers (end of
    // turn, a blink step) — only counter-magic answers those.
    const physical = !top.noPhysicalReaction && this.isIncomingAttack(top, reactor);
    // A Dexterity dodge is a separate per-combat resource, independent of the
    // single reaction allowed each turn cycle — offer it whenever it is ready.
    if (physical && this.canDodge(reactor)) return true;
    // Every other reaction spends the one reaction available per turn cycle.
    if (reactor.reactedThisCycle) return false;
    if (this.canNeedle(reactor, top)) return true;
    // Open the window whenever the mage still has their reaction available —
    // even if temporarily out of mana or charges. The cast attempt will fail
    // inside castReaction with the real reason rather than a misleading one.
    if (reactor.hasReaction()) return true;
    if (this.castableAbilities(reactor).length > 0) return true;
    // Physical reactions (Block / shield-Bash / weapon strike) need no blue word.
    return (
      physical &&
      (this.canBlock(reactor) ||
        this.canBash(reactor, top) ||
        this.canWeaponReact(reactor, top))
    );
  }

  /** True if `top` is an attack (melee or spell) aimed squarely at `reactor`. */
  private isIncomingAttack(top: StackItem, reactor: Mage): boolean {
    return top.target === reactor && (
      top.kind === 'melee' ||
      top.kind === 'spell' ||
      (top.kind === 'action' && !!top.hostileAttack)
    );
  }

  /**
   * True if `reactor` can spend a Dexterity dodge. Dodges are a per-combat
   * resource unlocked at Dex 6 (one more every 6 Dex), independent of the
   * once-per-turn reaction.
   */
  private canDodge(reactor: Mage): boolean {
    if (!reactor.alive) return false;
    return reactor.dodgesRemaining > 0 && reactor.maxDodges() > 0;
  }

  /**
   * True if the reactor can spend a Needle of Serenity on `top`. The Needle only
   * answers *abilities* (colour abilities) and weapon / unarmed strikes — never
   * base mechanics such as walking (moves) or casting spells (word spells).
   */
  private canNeedle(reactor: Mage, top: StackItem): boolean {
    if (reactor === top.source || !reactor.alive || !reactor.hasNeedle()) return false;
    if (top.kind === 'melee') return true;
    if (top.kind === 'spell' && !!top.spell && this.isColorAbility(top.spell)) return true;
    if (top.kind === 'action' && !!top.needleBan) return true;
    return false;
  }

  /** Spend the reactor's Needle of Serenity to stifle & permanently ban `top`. */
  private applyNeedle(reactor: Mage, top: StackItem): void {
    const src = top.source;
    reactor.consumeNeedle();
    if (top.kind === 'action' && top.needleBan) {
      const ban = top.needleBan;
      if (ban.kind === 'item') {
        src.bannedItemIds.add(ban.itemId);
        this.gs.log(
          `${reactor.name}'s Needle of Serenity stifles the action — ${src.name}'s ${getItem(ban.itemId).name} is disabled forever.`
        );
      } else {
        src.bannedAbilityIds.add(ban.key);
        this.gs.log(
          `${reactor.name}'s Needle of Serenity stifles ${ban.label} — ${src.name} can never use it again.`
        );
      }
    } else if (top.kind === 'spell' && top.spell && this.isColorAbility(top.spell)) {
      src.bannedAbilityIds.add(top.spell.id);
      this.gs.log(
        `${reactor.name}'s Needle of Serenity stifles ${top.spell.name} — ${src.name} can never use it again.`
      );
    } else if (top.kind === 'melee') {
      const wid = src.activeWeaponId();
      if (wid) {
        src.bannedItemIds.add(wid);
        this.gs.log(
          `${reactor.name}'s Needle of Serenity stifles the strike — ${src.name}'s ${getItem(wid).name} is disabled forever.`
        );
      } else {
        src.unarmedBanned = true;
        this.gs.log(
          `${reactor.name}'s Needle of Serenity stifles the strike — ${src.name} can never strike unarmed again.`
        );
      }
    } else {
      this.gs.log(`${reactor.name}'s Needle of Serenity stifles the action.`);
    }
  }

  /** True if the reactor holds a shield it can raise to block the next blow. */
  private canBlock(reactor: Mage): boolean {
    return reactor.alive && reactor.blockReduction() > 0;
  }

  /** True if the reactor can shield-bash the (adjacent) source of `top`. */
  private canBash(reactor: Mage, top: StackItem): boolean {
    return (
      reactor.alive &&
      reactor.shieldBashMult() != null &&
      top.source.alive &&
      dist(top.source.pos, reactor.pos) <= MELEE_RANGE
    );
  }

  /**
   * True if the white-identity reactor can answer `top` with a weapon strike:
   * it has weapon-reactions left this combat and can reach the attacker.
   */
  private canWeaponReact(reactor: Mage, top: StackItem): boolean {
    return (
      reactor.alive &&
      reactor.canWeaponReact() &&
      top.source.alive &&
      this.gs.canMelee(reactor, top.source)
    );
  }

  private async getReaction(
    reactor: Mage,
    top: StackItem
  ): Promise<ReactionChoice | null> {
    const aiControlled = this.controllerIsAI(reactor) || (reactor.isAI && !this.gs.controlSwapped);
    if (aiControlled) {
      // Dev: a passive AI never reacts. Training dummies stay inert too.
      if (Dev.aiPassive || reactor.trainingPassive) return null;
      // Prefer a counter-spell / colour ability if the AI wants one…
      const ai = this.aiFor(reactor);
      let r: ReturnType<SimpleAI['chooseReaction']> = null;
      try {
        r = ai.chooseReaction(top) ?? null;
      } catch (error) {
        console.error('AI reaction decision failed; passing priority.', error);
        this.gs.log(`${reactor.name} cannot find a response and passes priority.`);
        return null;
      }
      if (r) return { spell: r.spell, target: r.target, point: r.point };
      // …otherwise defend against an incoming attack: dodge first (fully shrugs
      // off the blow for a per-combat charge), then a bash, then a block.
      if (this.isIncomingAttack(top, reactor)) {
        if (this.canDodge(reactor)) return { dodge: true };
        if (this.canBash(reactor, top)) return { shield: 'bash' };
        if (this.canBlock(reactor)) return { shield: 'block' };
      }
      this.gs.log(`${reactor.name} passes priority.`);
      return null;
    }
    // Online: the opponent's reaction arrives over the wire; ours is relayed.
    if (this.online && !this.isLocalDecider(reactor)) {
      const msg = await this.net!.recv();
      if (msg.k === 'bye') return null;
      return this.decodeReaction(msg);
    }
    // Auto-pass toggle: skip the prompt entirely and pass priority. Still
    // relayed online so peers stay in lockstep.
    const choice = this.autoPassReactions ? null : await this.promptReaction(reactor, top);
    if (this.online) this.net?.send(this.encodeReaction(choice));
    return choice;
  }

  // ===========================================================================
  //  HUMAN INPUT
  // ===========================================================================

  private bindInput(): void {
    const controls = new SceneInput(this);
    const actionHotkey = (hotkey: string, fallback: () => void): (() => void) => () => {
      if (!this.consumeActionMenuHotkey(hotkey)) fallback();
    };
    const keys = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'];
    controls.bindKeys(
      keys.map((key, index) => ({
        key,
        run: actionHotkey('', () => {
          if (this.mode === 'assign') {
            const build = STAT_BUILD_IDS[index];
            if (build) this.applyStatBuild(build);
            return;
          }
          this.onWordKey(index);
        }),
      }))
    );
    controls.bindKeys([
      {
        key: 'ENTER',
        run: () => {
          if (this.mode === 'over' && this.endCard) this.endCard.activate();
          else if (this.isWorkshopMode()) this.workshopFocus.activate();
          else if (this.mode === 'assign') this.onAssignConfirm();
          else if (this.mode === 'action-menu') this.activateActionMenuSelection();
          else this.onCast();
        },
      },
      { key: 'M', run: actionHotkey('M', () => this.beginMove()) },
      // A: weapon reaction while a reaction window is open, otherwise a basic
      // (melee) attack on your own turn.
      {
        key: 'A',
        run: actionHotkey('A', () => {
          if (this.mode === 'reaction') this.chooseWeaponReaction();
          else this.beginMelee();
        }),
      },
      { key: 'Z', run: actionHotkey('Z', () => this.castColorAbility(0)) },
      { key: 'X', run: actionHotkey('X', () => this.castColorAbility(1)) },
      { key: 'E', run: actionHotkey('E', () => this.onEndTurn()) },
      { key: 'G', run: actionHotkey('G', () => this.onDropItem()) },
      {
        key: 'H',
        run: actionHotkey('H', () => {
          if (this.mode === 'aiming-wall') {
            this.wallAimAngle += Math.PI / 12; // rotate 15°
            this.redraw();
            return;
          }
          this.onPickUpItem();
        }),
      },
      { key: 'I', run: actionHotkey('I', () => this.toggleInventory()) },
      { key: 'R', run: actionHotkey('R', () => void this.onWeaponAction()) },
      {
        key: 'T',
        run: actionHotkey('T', () => {
          const me = this.gs.current;
          const ordinary = me.utility.some((id) => getItem(id).throwable && !me.isItemBanned(id));
          if (!ordinary && me.hasEdgelordLantern()) this.beginEdgelordThrow();
          else this.beginThrowFirst();
        }),
      },
      { key: 'Q', run: actionHotkey('Q', () => this.beginEldritch()) },
      { key: 'C', run: actionHotkey('C', () => this.beginThunder()) },
      { key: 'L', run: actionHotkey('L', () => this.beginLeap()) },
      { key: 'F', run: actionHotkey('F', () => this.castFocus()) },
      { key: 'V', run: actionHotkey('V', () => this.beginCleave()) },
      { key: 'S', run: actionHotkey('S', () => this.activateDeathsAngelWings()) },
      { key: 'U', run: actionHotkey('U', () => this.beginCommand()) },
      { key: 'P', run: actionHotkey('', () => {
        if (this.scenarioLab || this.memoryMode) this.toggleScenarioLab();
        else this.toggleTrainingOverlay();
      }) },
      {
        key: 'TAB',
        capture: true,
        run: (event) => {
          if (this.isWorkshopMode()) this.workshopFocus.move(event.shiftKey ? -1 : 1);
          else this.toggleActionMenu();
        },
      },
      {
        key: 'UP',
        capture: true,
        run: () => this.isWorkshopMode() ? this.workshopFocus.move(-1) : this.moveActionMenuSelection(-1),
      },
      {
        key: 'DOWN',
        capture: true,
        run: () => this.isWorkshopMode() ? this.workshopFocus.move(1) : this.moveActionMenuSelection(1),
      },
      {
        key: 'LEFT',
        capture: true,
        run: () => this.isWorkshopMode()
          ? this.workshopFocus.move(-1)
          : this.moveActionMenuSelection(-this.actionMenuRowsPerColumn),
      },
      {
        key: 'RIGHT',
        capture: true,
        run: () => this.isWorkshopMode()
          ? this.workshopFocus.move(1)
          : this.moveActionMenuSelection(this.actionMenuRowsPerColumn),
      },
      {
        key: 'SPACE',
        run: actionHotkey('SPACE', () => {
          if (this.mode === 'over' && this.endCard) this.endCard.activate();
          else if (this.isWorkshopMode()) this.workshopFocus.activate();
          else if (this.mode === 'reaction') this.onReactionPass();
        }),
      },
      {
        key: 'B',
        run: actionHotkey('B', () => {
          if (this.mode === 'reaction') this.chooseShieldReaction('block');
        }),
      },
      {
        key: 'N',
        run: actionHotkey('N', () => {
          if (this.mode === 'reaction') this.chooseShieldReaction('bash');
        }),
      },
      {
        key: 'K',
        run: actionHotkey('K', () => {
          if (this.mode === 'reaction') this.chooseNeedleReaction();
          else this.shakeEdgelordLantern();
        }),
      },
      {
        key: 'W',
        run: actionHotkey('W', () => {
          if (this.mode === 'reaction') this.chooseWeaponReaction();
        }),
      },
      {
        key: 'D',
        run: actionHotkey('D', () => {
          if (this.mode === 'reaction') this.chooseDodgeReaction();
        }),
      },
      { key: 'O', run: actionHotkey('', () => this.toggleAutoPass()) },
      { key: 'Y', run: actionHotkey('', () => this.toggleSpectate()) },
      { key: 'PERIOD', run: actionHotkey('', () => this.toggleCombatSpeed()) },
      {
        key: 'J',
        run: actionHotkey('', () => {
          this.showTargetList = !this.showTargetList;
          this.refreshTargetList();
        }),
      },
      {
        key: 'ESC',
        run: () => {
          if (this.mode === 'pause') {
            this.closePause();
            return;
          }
          if (this.mode === 'idle' || this.mode === 'reaction') {
            this.openPause();
            return;
          }
          playSound('ui.back');
          if (this.mode === 'action-menu') {
            this.hideActionMenu();
            return;
          }
          if (this.mode === 'inventory') {
            this.closeInventory();
            return;
          }
          if (this.mode === 'eldritch-menu') {
            this.hideEldritchMenu();
            return;
          }
          if (this.mode === 'thunder-menu') {
            this.hideThunderMenu();
            return;
          }
          if (this.mode === 'training') {
            this.closeTrainingOverlay();
            return;
          }
          if (this.mode === 'dev-resources') {
            this.closeDevResources();
            return;
          }
          if (this.mode === 'scenario-lab') {
            this.closeScenarioLab();
            return;
          }
          if (this.mode === 'scenario-place' || this.mode === 'scenario-move') {
            this.scenarioBrush = null;
            this.scenarioMoveTarget = null;
            this.mode = 'idle';
            this.toggleScenarioLab();
            return;
          }
          this.cancelAiming();
        },
      },

    // Dev cheat toggles (available only after opening the panel with #).
      { key: 'F1', capture: true, run: actionHotkey('', () => { if (this.devPanel.visible) this.toggleDev('autoSuccess'); }) },
      { key: 'F2', capture: true, run: actionHotkey('', () => { if (this.devPanel.visible) this.toggleDev('infiniteMove'); }) },
      { key: 'F3', capture: true, run: actionHotkey('', () => { if (this.devPanel.visible) this.toggleDev('infiniteActions'); }) },
      { key: 'F4', capture: true, run: actionHotkey('', () => { if (this.devPanel.visible) this.toggleDev('aiPassive'); }) },
      { key: 'F5', capture: true, run: actionHotkey('', () => { if (this.devPanel.visible) this.toggleDev('skipDice'); }) },
      { key: 'F6', capture: true, run: actionHotkey('', () => { if (this.devPanel.visible) this.toggleDevResources(); }) },
    ]);
    controls.bindAnyKey((event) => {
      if (event.key !== '#') return;
      if (this.mode === 'action-menu') return;
      if (this.mode === 'assign' || this.mode === 'shop' || this.mode === 'over') return;
      this.devPanel.setVisible(!this.devPanel.visible);
      if (!this.devPanel.visible) this.closeDevResources();
    });

    // Right-click opens the action menu, so suppress the browser context menu.
    controls.disableContextMenu();

    controls.bindPointerMove((p) => {
      this.pointer = { x: p.worldX, y: p.worldY };
      this.updateHover();
      if (this.mode.startsWith('aiming') || this.mode.startsWith('subtarget')) this.redraw();
    });
    controls.bindPointerDown((p) => this.onPointerDown(p));
  }

  /** The mage currently giving input — the reactor during a reaction window. */
  private get actor(): Mage {
    return this.dodgeBonusActor ?? this.reactor ?? this.subtargetSource ?? this.gs.current;
  }

  private isWorkshopMode(): boolean {
    return this.mode === 'training' || this.mode === 'scenario-lab' || this.mode === 'dev-resources';
  }

  private openPause(): void {
    if (this.mode !== 'idle' && this.mode !== 'reaction') return;
    playSound('ui.open');
    this.pauseReturn = this.mode;
    this.mode = 'pause';
    this.pauseView?.destroy();
    this.pauseView = new PauseView(this, {
      motionReduced: this.reducedMotion,
      combatSpeed: this.combatSpeed,
      diceLabel: diceModeLabel(),
      diceOn: diceMode() !== 'none',
      resume: () => this.closePause(),
      toggleMotion: () => {
        toggleMotionPreference();
        this.reducedMotion = isReducedMotion();
        this.pauseView?.refresh(this.reducedMotion, this.combatSpeed);
      },
      toggleSpeed: () => {
        this.toggleCombatSpeed();
        this.pauseView?.refresh(this.reducedMotion, this.combatSpeed);
      },
      cycleDice: (direction) => {
        cycleDiceMode(direction);
        this.pauseView?.refresh(this.reducedMotion, this.combatSpeed);
      },
      toggleDiceTiming: () => {
        toggleDiceTiming();
        this.pauseView?.refresh(this.reducedMotion, this.combatSpeed);
      },
      returnToMenu: () => this.returnToMenu(),
    });
    this.game.canvas.setAttribute('aria-label', 'Dimir pause menu');
    this.redraw();
  }

  private closePause(): void {
    if (this.mode !== 'pause') return;
    playSound('ui.close');
    this.pauseView?.destroy();
    this.pauseView = undefined;
    this.mode = this.pauseReturn;
    this.game.canvas.setAttribute('aria-label', 'Dimir combat arena');
    this.redraw();
  }

  /**
   * Whose hand/resources the HUD should display. Online, each client always
   * shows its OWN mage's loadout and resources (never the opponent's),
   * regardless of whose turn it is. Offline it follows the acting mage so the
   * shared screen always shows the player who is about to act.
   */
  private get viewMage(): Mage {
    return this.online ? this.mageBySeat(this.localSeat) : this.actor;
  }

  /**
   * Who actually pilots `m` right now. Normally that is `m` itself, but while
   * minds are swapped (Reality Mind) each mage is driven by the other's
   * controller. The swap only has teeth when exactly one duellist is an AI —
   * otherwise (hotseat or AI-vs-AI) it is a harmless no-op.
   */
  private controllerIsAI(m: Mage): boolean {
    // Spectate mode: hand every seat to the AI so the match plays itself.
    // Offline only — flipping a live human to AI online would desync peers.
    if (this.spectateAll && !this.online) return true;
    if (this.gs.controlSwapped && this.gs.mages[0].isAI !== this.gs.mages[1].isAI) {
      return this.gs.opponentOf(m).isAI;
    }
    return m.isAI;
  }

  /** Fetch (or lazily build & cache) the AI brain for a mage. */
  private aiFor(m: Mage): SimpleAI {
    let ai = this.ais.get(m);
    if (!ai) {
      ai = new SimpleAI(this.gs, m);
      this.ais.set(m, ai);
    }
    return ai;
  }

  private get humanActive(): boolean {
    return (
      !this.controllerIsAI(this.actor) &&
      (this.mode === 'idle' || this.mode === 'reaction' || this.mode.startsWith('aiming'))
    );
  }

  /** Like `humanActive`, but also true while the inventory overlay is open. */
  private get humanActiveOrInventory(): boolean {
    return this.humanActive || (this.mode === 'inventory' && !this.controllerIsAI(this.actor));
  }

  private onWordKey(i: number): void {
    if (!this.humanActive) return;
    if (i >= this.viewMage.loadout.length) return;
    const pos = this.selectedIdx.indexOf(i);
    if (pos >= 0) {
      this.selectedIdx.splice(pos, 1);
    } else if (isModifierWord(this.viewMage.loadout[i])) {
      // Modifiers sit outside the three-word spell limit.
      this.selectedIdx.push(i);
    } else if (splitModifiers(this.selectedWords()).base.length < MAX_SPELL_WORDS) {
      this.selectedIdx.push(i);
    }
    this.pendingSpell = null;
    // Stay in the reaction mini-turn; otherwise drop back to idle.
    if (this.mode !== 'reaction') this.mode = 'idle';
    this.redraw();
  }

  private selectedWords(): WordId[] {
    return this.selectedIdx.map((i) => this.viewMage.loadout[i]);
  }

  /** Modifiers attached to the current selection (none for a solo Delay cast). */
  private selectedModifiers(): WordId[] {
    const { base, modifiers } = splitModifiers(this.selectedWords());
    return base.length === 0 ? [] : modifiers;
  }

  private currentComboSpell(): Spell | undefined {
    const words = this.selectedWords();
    if (words.length === 0) return undefined;
    const { base, modifiers } = splitModifiers(words);
    // Delay is the one modifier that is also a spell in its own right.
    if (base.length === 0) {
      return modifiers.length === 1 && modifiers[0] === 'delay'
        ? getSpell(['delay'], this.viewMage.mageClass)
        : undefined;
    }
    return getSpell(base, this.viewMage.mageClass);
  }

  private onCast(): void {
    if (this.mode === 'reaction') {
      this.castReaction();
      return;
    }
    if (!this.humanActive) return;
    const me = this.gs.current;
    const spell = this.currentComboSpell();
    if (!spell) {
      this.flashHint('No spell for that word combination.');
      return;
    }

    if (me.blocksCasting()) {
      this.flashHint('Both hands full — drop an item (G) to cast.');
      return;
    }

    if (me.hasCastThisTurn && !Dev.infiniteActions && this.gs.controlOf(me)?.mode !== 'random') {
      this.flashHint('Only one spell per turn.');
      return;
    }

    // A scrambled mage (Mind Curse) cannot choose: a random spell fires.
    if (this.gs.controlOf(me)?.mode === 'random') {
      this.resetSelection();
      this.mode = 'busy';
      this.submitTurn({ t: 'cast-random' });
      return;
    }

    if (!me.hasCharges(spell.words)) {
      this.flashHint('Not enough charges.');
      return;
    }
    const mods = this.selectedModifiers();
    if (mods.length > 0 && !me.hasCharges(mods)) {
      this.flashHint('Not enough modifier charges.');
      return;
    }
    if (mods.includes('channel') && mods.includes('delay')) {
      this.flashHint('Channel and Delay cannot hold the same spell.');
      return;
    }
    if (mods.includes('channel') && me.channeledCast) {
      this.flashHint('You are already channelling a spell.');
      return;
    }
    if (mods.includes('delay') && me.delayedCast) {
      this.flashHint('You already have a delayed spell waiting.');
      return;
    }
    if (!me.hasMana(this.spellManaCost(me, spell))) {
      this.flashHint('Not enough mana.');
      return;
    }
    if (!this.gs.canCastSpellNow(spell)) {
      this.flashHint(`${spell.name} requires at least ${spell.minStackDepth} other stack items.`);
      return;
    }
    if ((spell.actionType === 'main' ? me.actions.main : me.actions.bonus) <= 0) {
      this.flashHint(`No ${spell.actionType} action left.`);
      return;
    }

    if (spell.targeting === 'self' || spell.targeting === 'none') {
      this.resetSelection();
      this.mode = 'busy';
      this.submitTurn({
        t: 'spell',
        spellId: spell.id,
        ability: false,
        target: spell.targeting === 'self' ? this.seatOf(me) : null,
        mods,
      });
      return;
    }
    if (spell.targeting === 'point') {
      this.pendingSpell = spell;
      this.pendingFirstPoint = null;
      if (spell.rotatableWall) {
        this.wallAimAngle = 0;
        this.mode = 'aiming-wall';
        this.flashHint(`${spell.name}: move to place the wall, [H] rotate, click to confirm.`, true);
        this.redraw();
        return;
      }
      this.mode = 'aiming-point';
      this.flashHint(`${spell.name}: click a target point within range.`, true);
      this.redraw();
      return;
    }
    // enemy / ally
    this.pendingSpell = spell;
    this.mode = 'aiming-spell';
    this.flashHint(
      `${spell.name}: click ${spell.targeting === 'ally' ? 'an ally' : 'a target'} within range.`,
      true
    );
    this.redraw();
  }

  private beginMove(): void {
    if (this.mode === 'reaction') return;
    if (!this.humanActive) return;
    if (this.gs.current.hasForgotten('move'))
      return this.flashHint('You have forgotten how to move this turn.');
    if (this.gs.current.actions.move <= 0) return this.flashHint('No move action left.');
    this.pendingSpell = null;
    this.mode = 'aiming-move';
    this.flashHint('Move: click where to walk (within range).', true);
    this.redraw();
  }

  private beginMelee(): void {
    if (this.mode === 'reaction') return;
    if (!this.humanActive) return;
    if (this.gs.current.hasForgotten('melee'))
      return this.flashHint('You have forgotten how to fight this turn.');
    const bonusAtk = this.gs.current.attackIsBonusAction();
    const pool = bonusAtk ? this.gs.current.actions.bonus : this.gs.current.actions.main;
    if (pool <= 0 && !Dev.infiniteActions)
      return this.flashHint(bonusAtk ? 'That attack needs a bonus action.' : 'Melee needs a main action.');
    if (this.gs.current.outOfAmmo())
      return this.flashHint('Out of arrows — buy more or switch weapons.');
    this.pendingSpell = null;
    this.mode = 'aiming-melee';
    this.flashHint('Melee attack: click an enemy in range.', true);
    this.redraw();
  }

  /** Leap: pick a direction, then bound a d6-scaled distance that way. */
  private beginLeap(): void {
    if (this.mode === 'reaction') return;
    if (!this.humanActive) return;
    const me = this.gs.current;
    if (me.leapsLeft() <= 0) return this.flashHint('No leaps left this combat.');
    if (me.actions.bonus <= 0 && !Dev.infiniteActions)
      return this.flashHint('Leap needs a bonus action.');
    this.pendingSpell = null;
    this.mode = 'aiming-leap';
    this.flashHint('Leap: click a direction (distance is a d6 roll).', true);
    this.redraw();
  }

  /** End raid preparation and call in the boss. */
  private requestRaidBossFight(): void {
    if (this.mode === 'reaction' || !this.humanActive) return;
    if (!this.raid || !this.raidPrepActive) return;
    this.mode = 'busy';
    this.submitTurn({ t: 'raid-begin' });
  }

  /** Spend nothing and refill one resource during raid preparation. */
  private requestRaidPrepRestore(kind: RaidRestoreKind): void {
    if (this.mode === 'reaction' || !this.humanActive) return;
    if (!this.raid || !this.raidPrepActive) return;
    this.submitTurn({ t: 'raid-restore', kind });
  }

  /** Focus: burn all bonus actions + your reaction to empower the next word spell. */
  private castFocus(): void {
    if (this.mode === 'reaction') return;
    if (!this.humanActive) return;
    const me = this.gs.current;
    if (me.focusUsed) return this.flashHint('You have already focused this combat.');
    if (me.actions.bonus <= 0 && !Dev.infiniteActions)
      return this.flashHint('Focus needs a bonus action.');
    this.mode = 'busy';
    this.submitTurn({ t: 'focus' });
  }

  /** Spend one Wings Energy to begin or extend deathly flight. */
  private activateDeathsAngelWings(): void {
    if (this.mode === 'reaction' || !this.humanActive) return;
    const me = this.gs.current;
    if (!me.hasDeathsAngelWings()) return;
    if (me.isItemBanned('deathsAngelWings'))
      return this.flashHint('The Wings have been stifled forever.');
    if (me.deathsAngelEnergy <= 0) return this.flashHint('The Wings need 1 Energy.');
    if (me.actions.bonus <= 0 && !Dev.infiniteActions)
      return this.flashHint('The cape ability needs a bonus action.');
    this.mode = 'busy';
    this.submitTurn({ t: 'deaths-angel-wings' });
  }

  /** Resolve Wings activation identically for normal turns and dodge bonus windows. */
  private async performDeathsAngelWings(
    me: Mage,
    freeBonus = false,
    runAction: (item: StackItem) => Promise<void> = (item) => this.runStack(item)
  ): Promise<void> {
    if (
      !me.hasDeathsAngelWings() ||
      me.isItemBanned('deathsAngelWings') ||
      me.deathsAngelEnergy <= 0 ||
      (!freeBonus && me.actions.bonus <= 0 && !Dev.infiniteActions)
    ) return;
    if (!freeBonus) me.spend('bonus');
    await runAction(
      this.gs.makeActionItem({
        source: me,
        label: 'Wings of Deaths Angel',
        description: `${me.name} spends 1 Energy to invoke the Wings.`,
        needleBan: { kind: 'item', itemId: 'deathsAngelWings' },
        resolve: (game) => {
          game.activateDeathsAngelWings(me);
        },
      })
    );
  }

  /** Cleave: pick a direction, then sweep a 180° arc for double melee damage. */
  private beginCleave(): void {
    if (this.mode === 'reaction') return;
    if (!this.humanActive) return;
    const me = this.gs.current;
    if (me.cleaveUsed) return this.flashHint('You have already cleaved this combat.');
    if (!me.activeWeapon()) return this.flashHint('Cleave needs a weapon in hand.');
    if (me.actions.main <= 0 && !Dev.infiniteActions)
      return this.flashHint('Cleave is a main action.');
    this.pendingSpell = null;
    this.mode = 'aiming-cleave';
    this.flashHint('Click a direction to swing your 180° cleave.');
    this.redraw();
  }

  /**
   * Command: spend a bonus action to puppet one of your summons for its full
   * turn. After selecting the summon (the one nearest the cursor) it becomes the
   * current mage, so the normal move/attack/item controls drive it. It may take
   * a move AND an attack; control returns to you once it has spent both, or when
   * you press End to release it early.
   */
  private beginCommand(): void {
    if (this.mode === 'reaction') return;
    if (!this.humanActive || this.mode !== 'idle') return;
    if (this.puppet) return;
    if (this.online && !this.isLocalTurn()) return;
    const me = this.gs.current;
    const summons = this.gs.summonsOf(me);
    if (summons.length === 0) return this.flashHint('You have no summons to command.');
    if (me.actions.bonus <= 0 && !Dev.infiniteActions)
      return this.flashHint('Command needs a bonus action.');
    const summon = this.pickCommandSummon(summons);
    this.submitTurn({ t: 'command', summon: this.seatOf(summon) });
    const extra =
      summons.length > 1 ? ' (nearest your cursor — hover another and re-Command to switch)' : '';
    this.flashHint(
      `Commanding ${summon.name}${extra}: move (M) and attack (A/I), then it returns control. Press E to release early.`,
      true
    );
    this.redraw();
  }

  /** Choose which summon to command: the one nearest the cursor. */
  private pickCommandSummon(summons: Mage[]): Mage {
    if (summons.length === 1) return summons[0];
    const p = this.pointer;
    let best = summons[0];
    let bestD = Infinity;
    for (const s of summons) {
      const d = (s.pos.x - p.x) ** 2 + (s.pos.y - p.y) ** 2;
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best;
  }

  /** Whether `me` can throw `itemId` at `target` (enemy alive, within throw range). */
  private canThrowAt(me: Mage, target: Mage, itemId: ItemId): boolean {
    const def = getItem(itemId);
    if (!def.throwable || !target.alive) return false;
    if (this.gs.isUntargetable(target, me)) return false;
    return dist(me.pos, target.pos) <= def.throwable.rangePx;
  }

  private beginThrow(itemId: ItemId): void {
    if (this.mode === 'reaction') return;
    if (!this.humanActiveOrInventory) return;
    const me = this.gs.current;
    if (me.isItemBanned(itemId)) return this.flashHint('That item has been stifled forever.');
    if (me.swordFormLocked()) return this.flashHint('Locked in sword form — cannot throw.');
    if (me.actions.bonus <= 0 && !Dev.infiniteActions)
      return this.flashHint('Throwing takes a bonus action.');
    if (me.utility.indexOf(itemId) < 0) return this.flashHint('Nothing to throw.');
    this.closeInventory();
    this.throwPendingItem = itemId;
    this.pendingSpell = null;
    this.mode = 'aiming-throw';
    this.flashHint('Click an enemy within throwing range.');
    this.redraw();
  }

  /** Throw the first throwable item carried (bound to [T]). */
  private beginThrowFirst(): void {
    if (!this.humanActive) return;
    const me = this.gs.current;
    const itemId = me.utility.find((id) => getItem(id).throwable && !me.isItemBanned(id));
    if (!itemId) return this.flashHint('Nothing to throw.');
    this.beginThrow(itemId);
  }

  private shakeEdgelordLantern(): void {
    if (this.mode === 'reaction' || !this.humanActive) return;
    const me = this.gs.current;
    if (!me.hasEdgelordLantern()) return;
    if (me.isItemBanned('edgelordLantern'))
      return this.flashHint('The Edgelord Lantern has been stifled forever.');
    if (me.actions.bonus <= 0 && !Dev.infiniteActions)
      return this.flashHint('Shaking the lantern needs a bonus action.');
    if (!me.edgelordLanternActive && this.gs.edgelordCaptives(me).length > 0)
      return this.flashHint('The lantern cannot awaken while a creature remains inside.');
    if (!me.edgelordLanternActive && me.mana < 4)
      return this.flashHint('Awakening the lantern costs 4 mana.');
    this.mode = 'busy';
    this.submitTurn({ t: 'edgelord-shake' });
  }

  private canUseEdgelordThrow(me: Mage): boolean {
    if (
      !me.hasEdgelordLantern() ||
      me.edgelordLanternActive ||
      me.isItemBanned('edgelordLantern') ||
      this.gs.edgelordCaptives(me).length === 0
    ) return false;
    const untouched =
      me.actions.move === ACTIONS_PER_TURN.move &&
      me.actions.main === ACTIONS_PER_TURN.main &&
      me.actions.bonus === ACTIONS_PER_TURN.bonus;
    return Dev.infiniteActions || untouched || me.edgelordLanternJustDeactivated;
  }

  private beginEdgelordThrow(): void {
    if (this.mode === 'reaction' || !this.humanActive) return;
    const me = this.gs.current;
    if (!me.hasEdgelordLantern()) return;
    if (me.edgelordLanternActive)
      return this.flashHint('Seal the Edgelord Lantern before throwing it.');
    if (this.gs.edgelordCaptives(me).length === 0)
      return this.flashHint('The lantern must contain at least one living creature.');
    if (!this.canUseEdgelordThrow(me))
      return this.flashHint('Throwing requires an untouched turn, except for just deactivating.');
    if (me.effectiveStr() <= 0)
      return this.flashHint('You need Strength to throw the lantern.');
    this.pendingSpell = null;
    this.mode = 'aiming-edgelord-throw';
    this.flashHint(`Throw Edgelord Lantern: choose a point within ${me.effectiveStr()}cm.`, true);
    this.redraw();
  }

  /** Mantle of Eldritch Truth: open the Attack / Defend / Restore menu. */
  private beginEldritch(): void {
    if (this.mode === 'reaction') return;
    if (!this.humanActive) return;
    const me = this.gs.current;
    if (!me.hasEldritchMantle()) return;
    if (me.isActionBanned('eldritch'))
      return this.flashHint('Eldritch truth has been stifled forever.');
    if (me.actions.main <= 0 && !Dev.infiniteActions)
      return this.flashHint('Eldritch is a main action.');
    this.buildEldritchMenu();
  }

  private onEldritchChoice(choice: 'attack' | 'defend' | 'restore'): void {
    this.hideEldritchMenu();
    if (choice === 'attack') {
      this.pendingSpell = null;
      this.mode = 'aiming-eldritch';
      this.flashHint('Click any enemy — eldritch truth ignores all defenses.');
      this.redraw();
      return;
    }
    this.mode = 'busy';
    this.submitTurn({ t: 'eldritch', choice });
  }

  private hideEldritchMenu(): void {
    this.eldritchMenu?.destroy();
    this.eldritchMenu = undefined;
    if (this.mode === 'eldritch-menu') this.mode = 'idle';
  }

  private buildEldritchMenu(): void {
    this.hideEldritchMenu();
    this.mode = 'eldritch-menu';
    this.eldritchMenu = new ChoiceMenuView(this, 'MANTLE OF ELDRITCH TRUTH',
      'Choose how the mantle bends reality this turn.', [
        { id: 'attack', label: 'Attack', detail: 'Deal 10 true damage to any one target.' },
        { id: 'defend', label: 'Defend', detail: 'Void all damage until your next turn.' },
        { id: 'restore', label: 'Restore', detail: 'Restore 5 HP, 10 mana, and 2 charges to every word.' },
      ], (choice) => this.onEldritchChoice(choice), () => this.hideEldritchMenu());
  }

  /** Blessing of Roaring Thunder: open the Charge Up / Discharge menu. */
  private beginThunder(): void {
    if (this.mode === 'reaction') return;
    if (!this.humanActive) return;
    const me = this.gs.current;
    if (!me.hasThunderBlessing()) return;
    if (me.actions.bonus <= 0 && !Dev.infiniteActions)
      return this.flashHint('Thunder actions need a bonus action.');
    this.buildThunderMenu();
  }

  private onThunderChoice(choice: 'charge' | 'discharge'): void {
    this.hideThunderMenu();
    const me = this.gs.current;
    if (choice === 'charge') {
      if (me.isActionBanned('thunder-charge'))
        return this.flashHint('Charge Up has been stifled forever.');
      this.mode = 'busy';
      this.submitTurn({ t: 'thunder-charge' });
      return;
    }
    if (me.isActionBanned('thunder-discharge'))
      return this.flashHint('Discharge has been stifled forever.');
    if (me.thunderStacks <= 0) return this.flashHint('No Thunder stacks to discharge.');
    this.pendingSpell = null;
    this.mode = 'aiming-discharge';
    this.flashHint('Click a target to arc lightning into.');
    this.redraw();
  }

  private hideThunderMenu(): void {
    this.thunderMenu?.destroy();
    this.thunderMenu = undefined;
    if (this.mode === 'thunder-menu') this.mode = 'idle';
  }

  private buildThunderMenu(): void {
    this.hideThunderMenu();
    this.mode = 'thunder-menu';
    const me = this.gs.current;
    this.thunderMenu = new ChoiceMenuView(this, `ROARING THUNDER  /  ${me.thunderStacks} STACKS`,
      'Build the storm or release every stored charge.', [
        {
          id: 'charge',
          label: 'Charge Up',
          detail: 'Spend mana and suffer 1d6 true damage; roll d4 stacks and color charges.',
        },
        {
          id: 'discharge',
          label: 'Discharge',
          detail: 'Release every stack as bouncing lightning for 1d3 damage per stack.',
          enabled: me.thunderStacks > 0,
        },
      ], (choice) => this.onThunderChoice(choice), () => this.hideThunderMenu());
  }

  // ===========================================================================
  //  ACTION MENU  —  a context-aware, click-to-use list of everything the
  //  current mage can do this instant. Built from a data-driven registry so
  //  new actions appear automatically; a player never has to memorise hotkeys.
  // ===========================================================================

  /** Everything the active mage can do on its own turn, in menu order. */
  private turnActionEntries(): ActionEntry[] {
    const me = this.gs.current;
    const inf = Dev.infiniteActions;
    const entries: ActionEntry[] = [];

    // Cast the currently-composed word spell.
    const spell = this.currentComboSpell();
    const affordSpell =
      !!spell &&
      me.hasCharges(spell.words) &&
      me.hasMana(this.spellManaCost(me, spell)) &&
      this.gs.canCastSpellNow(spell, me) &&
      (spell.actionType === 'main' ? me.actions.main : me.actions.bonus) > 0;
    entries.push({
      id: 'cast',
      label: spell ? `Cast ${spell.name}` : 'Cast spell',
      hotkey: '1–4 / Enter',
      desc: spell
        ? `${spell.actionType} action · ${this.spellManaCost(me, spell)} mana`
        : 'Click words in the panel to compose a spell, then cast.',
      enabled: !!spell && (affordSpell || inf) && !me.hasCastThisTurn && !me.blocksCasting(),
      reason: !spell
        ? 'Select a valid word combination first.'
        : me.hasCastThisTurn
          ? 'Already cast a spell this turn.'
          : me.blocksCasting()
            ? 'Both hands full — drop an item to cast.'
            : this.gs.isPacified(me) && spell.targeting !== 'self' && spell.targeting !== 'ally'
              ? 'Pacified — no hostile action can be declared.'
              : 'Not enough charges / mana / actions.',
      run: () => this.onCast(),
    });

    // Colour abilities (one entry each).
    getColorAbilitiesFor(me.profile.primary, me.mageClass).forEach((ab, i) => {
      const left = me.abilityCastsLeft(ab.id);
      entries.push({
        id: `ability-${ab.id}`,
        label: `Cast ${ab.name}`,
        hotkey: i === 0 ? 'Z' : i === 1 ? 'X' : '—',
        desc: `Colour ability · ${this.abilityChargeCost(me, ab)}c / ${this.abilityManaCost(me, ab)}m · ${left} left this combat`,
        enabled:
          this.canAffordAbility(me, ab) &&
          (me.actions.bonus > 0 || inf) &&
          !me.isAbilityBanned(ab.id) &&
          left > 0,
        reason: me.isAbilityBanned(ab.id)
          ? 'Stifled forever.'
          : left <= 0
            ? 'Spent for this combat.'
            : 'Needs a bonus action + charges / mana.',
        run: () => this.castColorAbility(i),
      });
    });

    // Move.
    entries.push({
      id: 'move',
      label: 'Move',
      hotkey: 'M',
      desc: 'Reposition within your movement range.',
      enabled: (me.actions.move > 0 || inf) && !me.hasForgotten('move'),
      reason: me.hasForgotten('move') ? 'Forgotten how to move this turn.' : 'No move action left.',
      run: () => this.beginMove(),
    });

    // Attack (basic weapon strike).
    const bonusAtk = me.attackIsBonusAction();
    const atkPool = bonusAtk ? me.actions.bonus : me.actions.main;
    const outOfArrows = me.outOfAmmo();
    entries.push({
      id: 'attack',
      label: 'Attack',
      hotkey: 'A',
      desc: 'Strike an enemy with your equipped weapon.',
      enabled: (atkPool > 0 || inf) && !me.hasForgotten('melee') && !outOfArrows && !this.gs.isPacified(me),
      reason: me.hasForgotten('melee')
        ? 'Forgotten how to fight this turn.'
        : this.gs.isPacified(me)
          ? 'Pacified — no hostile action can be declared.'
          : outOfArrows
          ? 'Out of arrows.'
          : bonusAtk
            ? 'Needs a bonus action.'
            : 'Needs a main action.',
      run: () => this.beginMelee(),
    });

    // Leap (bonus-action bound; d6 distance scaled by dex).
    entries.push({
      id: 'leap',
      label: 'Leap',
      hotkey: 'L',
      desc: `Bound a d6 distance in any direction · ${me.leapsLeft()} left this combat.`,
      enabled: (me.actions.bonus > 0 || inf) && me.leapsLeft() > 0,
      reason: me.leapsLeft() <= 0 ? 'No leaps left this combat.' : 'Needs a bonus action.',
      run: () => this.beginLeap(),
    });

    // Focus (bonus action; empowers the next word spell this turn).
    entries.push({
      id: 'focus',
      label: 'Focus',
      hotkey: 'F',
      desc: 'Burn all bonus + your reaction; next word spell: half mana, roll DC twice.',
      enabled: (me.actions.bonus > 0 || inf) && !me.focusUsed,
      reason: me.focusUsed ? 'Already focused this combat.' : 'Needs a bonus action.',
      run: () => this.castFocus(),
    });

    // Cleave (main action; needs a weapon; 180° double-damage sweep).
    const cleaveWeapon = me.activeWeapon();
    entries.push({
      id: 'cleave',
      label: 'Cleave',
      hotkey: 'V',
      desc: 'Sweep a 180° arc for double melee damage (once per combat).',
      enabled: (me.actions.main > 0 || inf) && !me.cleaveUsed && !!cleaveWeapon,
      reason: !cleaveWeapon
        ? 'Need a weapon in hand.'
        : me.cleaveUsed
          ? 'Already cleaved this combat.'
          : 'Needs a main action.',
      run: () => this.beginCleave(),
    });

    // Weapon action (only if a carried weapon has one).
    if (me.hasWeaponAction()) {
      const hasBlackBell = me.weaponAbilityItems().some(
        (id) => getItem(id).weaponAbility === 'blackBellMode'
      );
      entries.push({
        id: 'weapon',
        label: hasBlackBell
          ? `Black Bell: ${me.blackBellCondense ? 'Condense' : 'Toll'}`
          : 'Weapon action',
        hotkey: 'R',
        desc: 'Trigger your weapon\u2019s special ability.',
        enabled: me.actions.bonus > 0 || inf,
        reason: 'Needs a bonus action.',
        run: () => void this.onWeaponAction(),
      });
    }

    // Throw (only if carrying a throwable).
    const throwId = me.utility.find((id) => getItem(id).throwable && !me.isItemBanned(id));
    if (throwId) {
      entries.push({
        id: 'throw',
        label: `Throw ${getItem(throwId).name}`,
        hotkey: 'T',
        desc: 'Hurl a throwable item at an enemy.',
        enabled: (me.actions.bonus > 0 || inf) && !me.swordFormLocked(),
        reason: me.swordFormLocked() ? 'Locked in sword form.' : 'Needs a bonus action.',
        run: () => this.beginThrowFirst(),
      });
    }

    if (me.hasEdgelordLantern()) {
      const captives = this.gs.edgelordCaptives(me).length;
      const canShake =
        (me.actions.bonus > 0 || inf) &&
        !me.isItemBanned('edgelordLantern') &&
        (me.edgelordLanternActive || (captives === 0 && me.mana >= 4));
      entries.push({
        id: 'edgelord-shake',
        label: me.edgelordLanternActive ? 'Seal Edgelord Lantern' : 'Awaken Edgelord Lantern',
        hotkey: 'K',
        desc: me.edgelordLanternActive
          ? 'Pull nearby units and capture afflicted creatures near death.'
          : 'Pay 4 mana; give 3 Soul Rend to every unit within 15cm.',
        enabled: canShake,
        reason: me.isItemBanned('edgelordLantern')
          ? 'Stifled forever.'
          : me.actions.bonus <= 0 && !inf
            ? 'Needs a bonus action.'
            : !me.edgelordLanternActive && captives > 0
              ? 'A living creature is still inside.'
              : 'Awakening costs 4 mana.',
        run: () => this.shakeEdgelordLantern(),
      });
      entries.push({
        id: 'edgelord-throw',
        label: `Throw Edgelord Lantern (${captives} inside)`,
        hotkey: throwId ? 'Menu' : 'T',
        desc: 'Spend all actions and reaction; blast a 5cm radius within Strength cm.',
        enabled: this.canUseEdgelordThrow(me) && me.effectiveStr() > 0,
        reason: me.edgelordLanternActive
          ? 'Seal it first.'
          : captives === 0
            ? 'Needs a living captive.'
            : 'Needs an untouched turn, except after deactivating.',
        run: () => this.beginEdgelordThrow(),
      });
    }

    // Mantle of Eldritch Truth.
    if (me.hasEldritchMantle()) {
      entries.push({
        id: 'eldritch',
        label: 'Eldritch truth',
        hotkey: 'Q',
        desc: 'Attack / Defend / Restore (main action).',
        enabled: (me.actions.main > 0 || inf) && !me.isActionBanned('eldritch'),
        reason: me.isActionBanned('eldritch') ? 'Stifled forever.' : 'Needs a main action.',
        run: () => this.beginEldritch(),
      });
    }

    if (this.raid && this.raidPrepActive) {
      entries.push({
        id: 'raid-restore-vitals',
        label: 'Restore health & mind',
        hotkey: 'Free',
        desc: `Refill health and sanity (${me.hp}/${me.maxHp} HP, ${me.sanity}/${me.maxSanity} mind). Costs no action.`,
        enabled: me.hp < me.maxHp || me.sanity < me.maxSanity,
        reason: 'Already at full health and mind.',
        run: () => this.requestRaidPrepRestore('vitals'),
      });
      entries.push({
        id: 'raid-restore-mana',
        label: 'Restore mana',
        hotkey: 'Free',
        desc: `Refill your mana pool (${me.mana}/${me.maxMana}). Costs no action.`,
        enabled: me.mana < me.maxMana,
        reason: 'Already at full mana.',
        run: () => this.requestRaidPrepRestore('mana'),
      });
      entries.push({
        id: 'raid-restore-words',
        label: 'Restore word charges',
        hotkey: 'Free',
        desc: 'Refill every word in your loadout to full charges. Costs no action.',
        enabled: me.loadout.some((word) => (me.charges[word] ?? 0) < me.maxWordCharges(word)),
        reason: 'Every word is already at full charges.',
        run: () => this.requestRaidPrepRestore('words'),
      });
      entries.push({
        id: 'raid-begin',
        label: `Summon ${ENEMY_DEFS[this.raidBoss].name}`,
        hotkey: 'Menu',
        desc: 'End preparation and fight as you stand. Gear, stacks, and buffs all carry over.',
        enabled: true,
        run: () => this.requestRaidBossFight(),
      });
    }

    if (me.hasDeathsAngelWings()) {
      entries.push({
        id: 'deaths-angel-wings',
        label: me.deathsAngelFlightTurns > 0 ? 'Extend Deaths Angel Wings' : 'Unfurl Deaths Angel Wings',
        hotkey: 'S',
        desc: `${me.deathsAngelEnergy} Energy · ${me.deathsAngelFlightTurns} flight turns · spend 1 for +2 turns.`,
        enabled:
          (me.actions.bonus > 0 || inf) &&
          me.deathsAngelEnergy > 0 &&
          !me.isItemBanned('deathsAngelWings'),
        reason: me.isItemBanned('deathsAngelWings')
          ? 'Stifled forever.'
          : me.deathsAngelEnergy <= 0
            ? 'Needs 1 Energy from a kill.'
            : 'Needs a bonus action.',
        run: () => this.activateDeathsAngelWings(),
      });
    }

    // Blessing of Roaring Thunder.
    if (me.hasThunderBlessing()) {
      entries.push({
        id: 'thunder',
        label: 'Roaring thunder',
        hotkey: 'C',
        desc: 'Charge up or discharge your thunder stacks.',
        enabled: me.actions.bonus > 0 || inf,
        reason: 'Needs a bonus action.',
        run: () => this.beginThunder(),
      });
    }

    // Veil Bind mantle: a weak Bind granted as a bonus action.
    if (me.bindMantleCharges > 0) {
      entries.push({
        id: 'mantle-bind',
        label: 'Weak Bind',
        hotkey: 'B',
        desc: `Root the nearest enemy for 1 turn (${me.bindMantleCharges} left).`,
        enabled: me.actions.bonus > 0 || inf,
        reason: 'Needs a bonus action.',
        run: () => this.submitTurn({ t: 'mantle-bind' }),
      });
    }

    // Chalice of Clear Water: wash every affliction off for mana.
    const cleanseCost = me.cleanseManaCost();
    if (cleanseCost != null) {
      entries.push({
        id: 'cleanse',
        label: `Cleanse (${cleanseCost} mana)`,
        hotkey: 'Menu',
        desc: 'Strip every affliction from yourself; veils are left alone (bonus action).',
        enabled: (me.actions.bonus > 0 || inf) && me.mana >= cleanseCost,
        reason: me.mana < cleanseCost ? `Needs ${cleanseCost} mana.` : 'Needs a bonus action.',
        run: () => this.submitTurn({ t: 'cleanse' }),
      });
    }

    // Inventory.
    entries.push({
      id: 'inventory',
      label: 'Inventory',
      hotkey: 'I',
      desc: 'Use potions, throw or inspect carried items.',
      enabled: true,
      run: () => this.toggleInventory(),
    });

    // Drop a held item.
    if (me.hands.length > 0) {
      entries.push({
        id: 'drop',
        label: 'Drop item',
        hotkey: 'G',
        desc: 'Drop a held item to free a hand (bonus action).',
        enabled: (me.actions.bonus > 0 || inf) && !me.swordFormLocked(),
        reason: me.swordFormLocked() ? 'Sword form locks your bag.' : 'Needs a bonus action.',
        run: () => this.onDropItem(),
      });
    }

    // Pick up a nearby dropped item.
    const drop = this.gs.nearestDropFor(me);
    if (drop) {
      const summonFull = me.summonItemLimited(drop.itemId);
      entries.push({
        id: 'pickup',
        label: `Pick up ${getItem(drop.itemId).name}`,
        hotkey: 'H',
        desc: 'Retrieve one of your dropped items (bonus action).',
        enabled: (me.actions.bonus > 0 || inf) && me.hasFreeHand() && !me.swordFormLocked() && !summonFull,
        reason: !me.hasFreeHand()
          ? 'Both hands full.'
          : summonFull
            ? 'A summon can carry only one item.'
            : me.swordFormLocked()
              ? 'Sword form locks your bag.'
              : 'Needs a bonus action.',
        run: () => this.onPickUpItem(),
      });
    }

    // Command a summon (bonus action).
    if (!this.puppet) {
      const summons = this.gs.summonsOf(me);
      if (summons.length > 0) {
        entries.push({
          id: 'command',
          label: summons.length === 1 ? `Command ${summons[0].name}` : 'Command summon',
          hotkey: 'U',
          desc: 'Take one action as one of your summons (bonus action).',
          enabled: me.actions.bonus > 0 || inf,
          reason: 'Needs a bonus action.',
          run: () => this.beginCommand(),
        });
      }
    }

    // End turn.
    entries.push({
      id: 'end',
      label: 'End turn',
      hotkey: 'E',
      desc: 'Pass your remaining actions and end the turn.',
      enabled: true,
      run: () => this.onEndTurn(),
    });

    return entries;
  }

  /** Everything the reactor can do during a reaction window, in menu order. */
  private reactionActionEntries(): ActionEntry[] {
    const reactor = this.reactor;
    const top = this.reactionTop;
    if (!reactor || !top) return [];
    const entries: ActionEntry[] = [];

    // Cast a word spell as a reaction (compose in the word panel first).
    const spell = this.currentComboSpell();
    const castable = this.castableReactions(reactor);
    entries.push({
      id: 'react-cast',
      label: spell ? `Cast ${spell.name}` : 'Cast reaction spell',
      hotkey: '1–4 / Enter',
      desc: spell ? 'Respond with the composed spell.' : 'Click words in the panel, then cast.',
      enabled: !!spell && castable.some((s) => s.id === spell.id),
      reason: spell ? 'That spell can\u2019t be cast as a reaction now.' : 'Select a reaction spell first.',
      run: () => this.castReaction(),
    });

    // Colour ability reactions.
    this.castableAbilities(reactor).forEach((ab, i) => {
      entries.push({
        id: `react-ability-${ab.id}`,
        label: `Cast ${ab.name}`,
        hotkey: i === 0 ? 'Z' : i === 1 ? 'X' : '—',
        desc: `Colour ability reaction · ${this.abilityChargeCost(reactor, ab)}c / ${this.abilityManaCost(reactor, ab)}m`,
        enabled: true,
        run: () => this.castAbilityReaction(i),
      });
    });

    entries.push({
      id: 'needle',
      label: 'Needle of Serenity',
      hotkey: 'K',
      desc: 'Stifle the incoming ability or weapon strike.',
      enabled: this.canNeedle(reactor, top),
      reason: 'Nothing here can be stifled.',
      run: () => this.chooseNeedleReaction(),
    });

    // Defensive reactions — available to any mage with the gear or stamina,
    // but only against an actual attack (never an end-of-turn or blink trigger).
    const physical = !top.noPhysicalReaction && this.isIncomingAttack(top, reactor);
    entries.push({
      id: 'block',
      label: 'Block',
      hotkey: 'B',
      desc: 'Raise your shield to soak the incoming blow.',
      enabled: physical && this.canBlock(reactor),
      reason: 'No shield, or nothing to block.',
      run: () => this.chooseShieldReaction('block'),
    });
    entries.push({
      id: 'bash',
      label: 'Shield bash',
      hotkey: 'N',
      desc: 'Bash the adjacent attacker (once per duel).',
      enabled: physical && this.canBash(reactor, top),
      reason: 'No shield, the attacker is out of reach, or nothing to bash.',
      run: () => this.chooseShieldReaction('bash'),
    });
    entries.push({
      id: 'weapon',
      label: 'Weapon strike',
      hotkey: 'A',
      desc: `Strike the attacker with your weapon (white identity · ${Math.max(0, MAX_WEAPON_REACTIONS - reactor.weaponReactionsUsed)} left).`,
      enabled: physical && this.canWeaponReact(reactor, top),
      reason: 'No weapon reactions left, or the attacker is out of reach.',
      run: () => this.chooseWeaponReaction(),
    });
    entries.push({
      id: 'dodge',
      label: 'Dodge',
      hotkey: 'D',
      desc: 'Spend a dodge to try to shrug off the attack.',
      enabled: physical && this.canDodge(reactor),
      reason: 'No dodge available, or nothing to dodge.',
      run: () => this.chooseDodgeReaction(),
    });

    // Pass.
    entries.push({
      id: 'pass',
      label: 'Pass',
      hotkey: 'Space',
      desc: 'Do nothing and let the action resolve.',
      enabled: true,
      run: () => this.onReactionPass(),
    });

    return entries;
  }

  /** Toggle the context-aware action menu (Tab / on-screen button / right-click). */
  private toggleActionMenu(): void {
    if (this.actionMenu) {
      this.hideActionMenu();
      return;
    }
    const isReaction = this.mode === 'reaction';
    // Only openable on your own turn, or during your reaction window.
    if (!isReaction && !(this.mode === 'idle' && this.humanActive)) return;
    this.actionMenuReturn = isReaction ? 'reaction' : 'idle';
    this.buildActionMenu();
  }

  private hideActionMenu(): void {
    this.actionMenu?.destroy();
    this.actionMenu = undefined;
    this.actionMenuEntries = [];
    if (this.mode === 'action-menu') this.mode = this.actionMenuReturn;
    this.redraw();
  }

  private buildActionMenu(): void {
    this.hideActionMenu();
    const reaction = this.actionMenuReturn === 'reaction';
    const raw = reaction ? this.reactionActionEntries() : this.turnActionEntries();
    this.mode = 'action-menu';

    // Group the palette so it reads as a few short lists instead of one wall.
    const sections: { title: string; entries: ActionEntry[] }[] = [];
    const taken = new Set<ActionEntry>();
    for (const group of ACTION_GROUPS) {
      const entries = raw.filter((entry) => group.ids.includes(entry.id));
      for (const entry of entries) taken.add(entry);
      if (entries.length > 0) sections.push({ title: group.title, entries });
    }
    const leftovers = raw.filter((entry) => !taken.has(entry));
    if (leftovers.length > 0) sections.push({ title: 'OTHER', entries: leftovers });

    // Selection indices follow the rendered order.
    const ordered = sections.flatMap((section) => section.entries);
    this.actionMenuEntries = ordered;
    this.actionMenuSelection = Math.max(0, ordered.findIndex((entry) => entry.enabled));
    this.actionMenu = new ActionMenuView(this, {
      title: reaction ? 'REACTION' : 'ACTIONS',
      sections,
      selectedIndex: this.actionMenuSelection,
      onSelect: (index) => {
        this.actionMenuSelection = index;
      },
      onActivate: (entry, pointer) => this.runActionMenuEntry(entry as ActionEntry, pointer),
      onDismiss: (pointer) => {
        this.menuClickGuard = pointer;
        this.hideActionMenu();
      },
    });
    this.actionMenuRowsPerColumn = this.actionMenu.rowsPerColumn;
    this.refreshActionMenuSelection();
  }

  private moveActionMenuSelection(delta: number): void {
    if (this.mode !== 'action-menu' || this.actionMenuEntries.length === 0) return;
    const count = this.actionMenuEntries.length;
    let next = this.actionMenuSelection;
    for (let attempt = 0; attempt < count; attempt++) {
      next = (next + delta + count) % count;
      if (this.actionMenuEntries[next].enabled) {
        this.actionMenuSelection = next;
        this.refreshActionMenuSelection();
        return;
      }
    }
  }

  private refreshActionMenuSelection(): void {
    this.actionMenu?.setSelection(this.actionMenuSelection);
  }

  private activateActionMenuSelection(): void {
    const entry = this.actionMenuEntries[this.actionMenuSelection];
    if (this.mode === 'action-menu' && entry?.enabled) this.runActionMenuEntry(entry);
  }

  private runActionMenuEntry(entry: ActionEntry, guardPointer = false): void {
    // A pointer selection can reach the global field handler in the same input
    // event. Keyboard activation has no click to swallow.
    this.menuClickGuard = guardPointer;
    this.hideActionMenu();
    entry.run();
  }

  private consumeActionMenuHotkey(hotkey: string): boolean {
    if (this.mode !== 'action-menu') return false;
    const normalized = hotkey.toUpperCase();
    if (normalized) {
      const entry = this.actionMenuEntries.find(
        (candidate) =>
          candidate.enabled &&
          candidate.hotkey
            .toUpperCase()
            .split(/[\s/]+/)
            .includes(normalized)
      );
      if (entry) this.runActionMenuEntry(entry);
    }
    return true;
  }

  private cancelAiming(): void {
    // Skipping an interactive sub-target resolves it as "no target".
    if (this.mode === 'subtarget-point' || this.mode === 'subtarget-enemy') {
      if (this.subtargetRequired) {
        this.flashHint('Choose a valid target for the next lightning arc.', true);
        return;
      }
      this.flashHint('Sub-target skipped.');
      this.finishSubtarget(null);
      return;
    }
    if (!this.mode.startsWith('aiming')) return;
    // Cancelling a reaction's target selection returns to the reaction menu.
    if (this.reactionAiming) {
      this.reactionAiming = false;
      this.reactionPendingSpell = null;
      this.aimingSource = null;
      this.mode = 'reaction';
      this.flashHint('Reaction — [1-5]+Enter to cast, or Space/E to pass.');
      this.redraw();
      return;
    }
    this.pendingSpell = null;
    this.pendingAbility = null;
    this.pendingFirstPoint = null;
    this.aimingSource = null;
    this.throwPendingItem = null;
    this.mode = 'idle';
    this.redraw();
  }

  private onEndTurn(): void {
    if (this.mode === 'reaction') {
      this.onReactionPass();
      return;
    }
    if (!this.humanActive || this.busy) return;
    // While commanding a summon, "End turn" instead releases the puppet and
    // returns control to the owner (whose own turn is still in progress).
    if (this.puppet) {
      this.submitTurn({ t: 'uncommand' });
      return;
    }
    this.resetSelection();
    if (this.online) this.net?.send({ k: 'turn', cmd: { t: 'end' } satisfies TurnCommand });
    void this.nextTurn();
  }

  /** Drop a held item to the ground to free a hand slot (bonus action). */
  private onDropItem(): void {
    if (this.mode === 'reaction') return;
    if (!this.humanActive) return;
    const me = this.gs.current;
    if (me.swordFormLocked())
      return this.flashHint('The bound greatshield locks your bag — swap to shield form first.');
    const droppable = me.hands.filter((id) => !getItem(id).permanentlyBinding);
    if (droppable.length === 0) return this.flashHint('Every held item is permanently bound.');
    if (me.actions.bonus <= 0 && !Dev.infiniteActions)
      return this.flashHint('Dropping an item needs a bonus action.');
    // Prefer dropping a non-wand item so casting is freed up first.
    const itemId = droppable.find((id) => !getItem(id).isWand) ?? droppable[0];
    this.resetSelection();
    this.submitTurn({ t: 'item-drop', itemId });
  }

  /** Pick the nearest of your dropped items back up (bonus action). */
  private onPickUpItem(): void {
    if (this.mode === 'reaction') return;
    if (!this.humanActive) return;
    const me = this.gs.current;
    if (me.swordFormLocked())
      return this.flashHint('The bound greatshield locks your bag — swap to shield form first.');
    if (!me.hasFreeHand()) return this.flashHint('Both hands are full.');
    if (me.actions.bonus <= 0 && !Dev.infiniteActions)
      return this.flashHint('Picking up an item needs a bonus action.');
    const drop = this.gs.nearestDropFor(me);
    if (!drop) return this.flashHint('No dropped item of yours within reach.');
    if (me.summonItemLimited(drop.itemId))
      return this.flashHint('A summon can carry only one item.');
    if (!me.canCarry(getItem(drop.itemId).weight))
      return this.flashHint('Too heavy to carry that as well.');
    this.resetSelection();
    this.submitTurn({ t: 'item-pickup', dropId: drop.id });
  }

  /** Consume a specific utility item (bonus action), chosen from the inventory. */
  private consumeItem(itemId: ItemId): void {
    if (!this.humanActiveOrInventory) return;
    const me = this.gs.current;
    if (me.isItemBanned(itemId)) return this.flashHint('That item has been stifled forever.');
    if (me.swordFormLocked())
      return this.flashHint('The bound greatshield locks your bag — swap to shield form first.');
    if (!me.utility.includes(itemId) || !getItem(itemId).potion) return;
    const potion = getItem(itemId).potion;
    if (potion === 'mana' && me.mana >= me.maxMana)
      return this.flashHint('Your mana is already full.');
    if (potion === 'health' && me.hp >= me.maxHp)
      return this.flashHint('Your health is already full.');
    if (me.actions.bonus <= 0 && !Dev.infiniteActions)
      return this.flashHint('Consuming an item needs a bonus action.');
    this.closeInventory();
    this.resetSelection();
    this.submitTurn({ t: 'item-use', itemId });
  }

  /** Drop a specific held item (bonus action), chosen from the inventory. */
  private dropItemById(itemId: ItemId): void {
    if (!this.humanActiveOrInventory) return;
    const me = this.gs.current;
    if (me.swordFormLocked())
      return this.flashHint('The bound greatshield locks your bag — swap to shield form first.');
    if (!me.hands.includes(itemId)) return;
    if (getItem(itemId).permanentlyBinding)
      return this.flashHint(`${getItem(itemId).name} is permanently bound.`);
    if (me.actions.bonus <= 0 && !Dev.infiniteActions)
      return this.flashHint('Dropping an item needs a bonus action.');
    this.closeInventory();
    this.resetSelection();
    this.submitTurn({ t: 'item-drop', itemId });
  }

  /** Take off and drop a worn accessory (bonus action), chosen from the inventory. */
  private dropAccessory(itemId: ItemId): void {
    if (!this.humanActiveOrInventory) return;
    const me = this.gs.current;
    if (!me.accessories.includes(itemId)) return;
    if (me.actions.bonus <= 0 && !Dev.infiniteActions)
      return this.flashHint('Taking off an item needs a bonus action.');
    this.closeInventory();
    this.resetSelection();
    this.submitTurn({ t: 'item-drop', itemId });
  }

  /** Equip a bag item into its own slot (bonus action), chosen from the inventory. */
  private equipItem(itemId: ItemId): void {
    if (!this.humanActiveOrInventory) return;
    const me = this.gs.current;
    if (me.swordFormLocked())
      return this.flashHint('The bound greatshield locks your bag — swap to shield form first.');
    if (!me.bag.includes(itemId)) return;
    if (!me.canEquipFromBag(itemId)) {
      const slot = getItem(itemId).slot;
      return this.flashHint(
        slot === 'hand'
          ? 'Both hands are full — unequip something first.'
          : `Your ${slot} slot is taken by something you cannot remove.`
      );
    }
    if (me.actions.bonus <= 0 && !Dev.infiniteActions)
      return this.flashHint('Equipping an item needs a bonus action.');
    this.closeInventory();
    this.resetSelection();
    this.submitTurn({ t: 'item-equip', itemId });
  }

  /** Stow a held item back into the bag (bonus action), chosen from the inventory. */
  private unequipItem(itemId: ItemId): void {
    if (!this.humanActiveOrInventory) return;
    const me = this.gs.current;
    if (me.swordFormLocked())
      return this.flashHint('The bound greatshield locks your bag — swap to shield form first.');
    if (!me.hands.includes(itemId)) return;
    if (getItem(itemId).permanentlyBinding)
      return this.flashHint(`${getItem(itemId).name} is permanently bound.`);
    if (me.actions.bonus <= 0 && !Dev.infiniteActions)
      return this.flashHint('Unequipping an item needs a bonus action.');
    this.closeInventory();
    this.resetSelection();
    this.submitTurn({ t: 'item-unequip', itemId });
  }

  // --- Inventory overlay (items + status effects) ----------------------------

  /** Toggle the inventory overlay open/closed. Opening it is free. */
  private toggleInventory(): void {
    if (this.mode === 'inventory') {
      this.closeInventory();
      return;
    }
    const fromMineMap = this.mineRun && this.mineExploring && this.mineMapVisible;
    if (!fromMineMap && (this.mode !== 'idle' || !this.humanActive)) {
      this.flashHint('Inventory is only available on your turn.');
      return;
    }
    if (fromMineMap) this.minePanel?.setVisible(false);
    this.buildInventoryCabinet(fromMineMap);
    this.mode = 'inventory';
    this.redraw();
  }

  private closeInventory(): void {
    this.invPanel?.destroy();
    this.invPanel = undefined;
    if (this.mode === 'inventory') {
      this.mode = this.mineMapVisible ? 'shop' : 'idle';
      if (this.mineMapVisible) this.minePanel?.setVisible(true);
    }
    this.redraw();
  }

  /** The local party member whose supplies are inspected during Mine exploration. */
  private mineInventoryMage(): Mage {
    if (this.online) return this.mageBySeat(this.localSeat);
    return this.gs.mages.find(
      (mage) => mage.team === 1 && mage.alive && !mage.isAI && !mage.isSummon
    ) ?? this.gs.mages.find(
      (mage) => mage.team === 1 && mage.alive && !mage.isSummon
    ) ?? this.gs.current;
  }

  /** A short, human-readable description of a status effect (for hover tips). */
  private statusBlurb(s: Status): string {
    const turns = `${s.duration} turn${s.duration === 1 ? '' : 's'} left`;
    switch (s.kind) {
      case 'pacified':
        return `No hostile action can be declared. Attacks and spells that reach past your own side are unusable and cost nothing. (${turns})`;
      case 'orderMandate': {
        const named = this.gs.mages[s.targetIndex]?.name ?? 'the named entity';
        const pct = Math.round((s.potency - 1) * 100);
        return `+${pct}% damage and healing, but ${named} is the only thing you may touch. (${turns})`;
      }
      case 'invisibility':
        return s.mode === 'full'
          ? `Invisible. Cannot be targeted beyond 6cm; 90% dodge within 6cm. (${turns})`
          : `Half veil. Still targetable. Dodge chance 95% beyond 10cm, 75% at 6-10cm, 50% within 6cm. Breaks if an enemy comes within 2cm. (${turns})`;
      case 'stun': {
        const what =
          s.stunType === 'full'
            ? 'No actions.'
            : s.stunType === 'movement'
              ? 'Cannot move.'
              : 'No main action.';
        return `${what} (${turns})`;
      }
      case 'dot':
        return `Damage over time. Deals damage at the start of your turn. (${turns})`;
      case 'fire':
        return `Fire: ${s.stacks} stack${s.stacks === 1 ? '' : 's'}. At turn start, 1-3 stacks deal 1d3 then lose 1; 4-6 stacks deal 1d6, spread 1 to units within 2cm, then lose 2. Applying above 6 deals 1d10, spreads, and resets to 5.`;
      case 'sentinelFire':
        return `Sentinel Fire: ${s.stacks} stack${s.stacks === 1 ? '' : 's'}. Spreads at 5+ stacks. Erupts at 10 stacks.`;
      case 'blueflare':
        return `Blueflare: ${s.stacks} stack${s.stacks === 1 ? '' : 's'}. Deals sanity damage at turn start. Spreads at 3+ stacks.`;
      case 'soulRend':
        return `Soul Rend: ${s.stacks} stack${s.stacks === 1 ? '' : 's'}. At turn start, deals 1d3 true HP and 1d3 true sanity per stack, then loses 1 stack.`;
      case 'reap':
        return `Reap: ${s.stacks} stack${s.stacks === 1 ? '' : 's'}. You die at or below ${s.stacks} HP. Execution thresholds against you are increased by ${2 * s.stacks}.`;
      case 'shadowAnchor':
        return `Chained. At turn start you are dragged 5cm toward the anchor, then checked: inside the caster's shadow you forget 1 random word or action; outside it you take 1d4 sanity. (${turns})`;
      case 'memoryShackle':
        return `Shackled. Any action you declare is forgotten: a weapon attack forgets 'melee', a spell forgets every word it used, for 3 turns each. (${turns})`;
      case 'shadowHook':
        return `Hooked. At turn start you are pulled 4cm toward the caster, take 1d6 pierce, and leave one of their shadows where you stop. Being dragged into a wall or the field edge adds 2d6 shatter. (${turns})`;
      case 'seal':
        return `Sealed. Your own allies cannot see or target you; the caster's side still can. At turn start you take ${s.damageSpec} shadow and are executed for ${s.executeAmount}. (${turns})`;
      case 'anchorSpike':
        return `Staked. At turn start you are dragged back to the spike and take 1d6 shatter for every 2cm you strayed, up to ${s.maxDice}d6. (${turns})`;
      case 'pierceEcho':
        return `Blood Oath. Every point of pierce damage you deal is dealt again at the end of your turn. (${turns})`;
      case 'stormConduit':
        return `Storm Conduit. Every wound you take arcs ${Math.round(s.sharePct * 100)}% of itself as heat to up to ${s.maxTargets} unit${s.maxTargets === 1 ? '' : 's'} within ${Math.round(s.radius / RANGE_UNIT)}cm, either side. (${turns})`;
      case 'phaseOut':
        return s.mode === 'self'
          ? 'Phased. Cannot be targeted, damaged or affected until your next turn. Movement only, passing through walls, zones and bodies. Enemies you pass through take 1d6 corrosive. Upkeep is skipped; statuses still count down.'
          : 'Phased. Cannot be targeted, damaged or affected until your next turn. Movement only. Items have no effect and upkeep is skipped; statuses still count down. On expiry, all enemies of the caster within 4cm, including you, take 2d6 shadow.';
      case 'threadMark':
        return `Threaded. Damage dealt to any other threaded target also deals 50% of that amount to you as sanity damage. (${turns})`;
      case 'swornRepetition':
        return `Sworn: ${s.stacks} stack${s.stacks === 1 ? '' : 's'}. -${s.stacks} damage dealt, +${s.stacks} damage taken. ${s.lingering ? 'Compulsion over; stacks now fade.' : 'Failing to repeat your last action deals 1d6 sanity per stack and ends it.'} (${turns})`;
      case 'woundShade':
        return `Carrying the caster's shadow. It moves with you and counts as one of their pools for reach, teleports and spell conditions. (${turns})`;
      case 'mindFuse':
        return `Fuse: ${s.ticks} charge${s.ticks === 1 ? '' : 's'}. Detonates for 1d6 plus 1d6 per charge as sanity damage. Gains 1 charge per turn. Each action you take (main, bonus or reaction) reduces the timer by 1 extra turn. (${turns})`;
      case 'reactionNeedle':
        return `Needled. Each reaction you take deals 2d6 sanity damage to you. The reaction still resolves. (${turns})`;
      case 'foeBlind':
        return `Foe-blind. All entities count as hostile to you, your areas and cones hit allies, and your targets are chosen at random. Deals 1d4 sanity at turn start. (${turns})`;
      case 'deathCurse':
        return `Death Curse: ${s.stacks} counter${s.stacks === 1 ? '' : 's'}. Each counter falls at your turn start or on shadow/corrosive damage, granting 2 Reap. Executions against you become Reap until the last counter, which kills you.`;
      case 'debuff': {
        const parts: string[] = [];
        if (s.mods.moveRange) parts.push(`move ${s.mods.moveRange > 0 ? '+' : ''}${s.mods.moveRange}`);
        if (s.mods.damageDealt)
          parts.push(`damage dealt ${s.mods.damageDealt > 0 ? '+' : ''}${s.mods.damageDealt}`);
        if (s.mods.damageTaken)
          parts.push(`damage taken ${s.mods.damageTaken > 0 ? '+' : ''}${s.mods.damageTaken}`);
        return `${parts.join(', ') || 'Stat change'}. (${turns})`;
      }
      case 'ward':
        return `Ward. Negates the next sanity hit or mental control effect. (${turns})`;
      case 'auraDot':
        return `Damaging aura. Deals damage to nearby enemies each turn. (${turns})`;
      case 'control':
        return `Controlled. Your action selection is overridden. (${turns})`;
      case 'shadowVeil':
        return `Shadow Veil. Untargetable at any range while standing in a shadow. (${turns})`;
      case 'shadowTrail':
        return `Leaves a shadow pool wherever you move. (${turns})`;
      case 'forget':
        return `Forgotten: ${s.forgotten.join(', ') || 'nothing'}. Those actions or words are unusable. (${turns})`;
      default:
        return turns;
    }
  }

  private buildInventoryCabinet(readOnly = false): void {
    this.invPanel?.destroy();
    const mage = readOnly ? this.mineInventoryMage() : this.gs.current;
    const item = (
      id: ItemId,
      location: string,
      actions: InventoryItemView['actions'] = []
    ): InventoryItemView => ({
      id,
      name: getItem(id).name,
      location,
      detail: getItem(id).blurb,
      actions: readOnly ? [] : actions,
    });
    const equipment: InventoryItemView[] = [
      ...mage.hands.map((id) => item(id, getItem(id).permanentlyBinding ? 'Held / bound' : 'Held',
        getItem(id).permanentlyBinding
          ? []
          : [
            { kind: 'unequip' as const, label: 'Unequip' },
            { kind: 'drop-hand' as const, label: 'Drop', tone: 'danger' as const },
          ])),
      ...(mage.head ? [item(mage.head, 'Head')] : []),
      ...(mage.torso ? [item(mage.torso, 'Torso')] : []),
      ...(mage.boots ? [item(mage.boots, 'Boots')] : []),
      ...mage.accessories.map((id) => item(id, 'Accessory', [
        { kind: 'drop-accessory', label: 'Drop', tone: 'danger' },
      ])),
    ];
    const supplies: InventoryItemView[] = [
      ...mage.bag.map((id) => item(id, 'In bag', [
        { kind: 'equip', label: 'Equip', tone: 'positive' },
      ])),
      ...mage.utility.map((id) => {
        const definition = getItem(id);
        const actions: InventoryItemView['actions'] = [];
        if (definition.potion) actions.push({ kind: 'consume', label: 'Consume', tone: 'positive' });
        if (definition.throwable) actions.push({ kind: 'throw', label: 'Throw' });
        return item(id, 'Supply', actions);
      }),
      ...(mage.arrows > 0
        ? [{
          id: 'arrow' as ItemId,
          name: `Arrows x${mage.arrows}`,
          location: 'Ammunition',
          detail: getItem('arrow' as ItemId).blurb,
          actions: [],
        }]
        : []),
    ];
    const capacity = mage.carryCap();
    this.invPanel = new InventoryView(this, {
      mageName: mage.name,
      carry: `Carry ${mage.carriedWeight()}/${Number.isFinite(capacity) ? capacity : '∞'} kg`,
      readOnly,
      equipment,
      supplies,
      statuses: mage.statuses.map((status) => ({
        name: status.name,
        duration: Number.isFinite(status.duration) ? `${status.duration} turns` : 'Permanent',
        detail: this.statusBlurb(status),
      })),
    }, {
      perform: (kind, id) => this.performInventoryAction(kind, id),
      close: () => this.closeInventory(),
    });
  }

  private performInventoryAction(kind: InventoryActionKind, id: ItemId): void {
    switch (kind) {
      case 'consume': this.consumeItem(id); break;
      case 'throw': this.beginThrow(id); break;
      case 'equip': this.equipItem(id); break;
      case 'unequip': this.unequipItem(id); break;
      case 'drop-hand': this.dropItemById(id); break;
      case 'drop-accessory': this.dropAccessory(id); break;
    }
  }

  /** Activate every held weapon's ability at once (bonus action). */
  private async onWeaponAction(): Promise<void> {
    if (this.mode === 'reaction') return;
    if (!this.humanActive || this.busy) return;
    const me = this.gs.current;
    if (!me.hasWeaponAction()) return this.flashHint('No weapon ability to activate.');
    const abilities = me.weaponAbilityItems().map((id) => getItem(id).weaponAbility);
    const firstAbility = abilities[0];
    if (firstAbility && me.isActionBanned(`weapon:${firstAbility}`))
      return this.flashHint('That weapon action has been stifled forever.');
    if (me.actions.bonus <= 0 && !Dev.infiniteActions)
      return this.flashHint('A weapon action needs a bonus action.');
    this.resetSelection();
    if (abilities.includes('shadowDaggerTeleport')) {
      if (!this.gs.isInShadow(me)) return this.flashHint('The dagger needs a shadow beneath you.');
      this.mode = 'aiming-shadow-dagger';
      this.flashHint('Dagger of Shadow: point at a shadow. Esc cancels.', true);
      this.redraw();
      return;
    }
    this.submitTurn({ t: 'weapon-action' });
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    // The stat-assignment / shop overlays own all input while they're up.
    if (this.mode === 'assign' || this.mode === 'shop') return;
    // While the action menu is open, its own dim overlay handles clicks.
    if (this.mode === 'action-menu') return;
    // A click consumed by the dev cheat panel must not also act on the field.
    if (this.devClickGuard) {
      this.devClickGuard = false;
      return;
    }
    // A click that just chose an action-menu option must not also target the
    // field: swallow it so the player selects their target on the next click.
    if (this.menuClickGuard) {
      this.menuClickGuard = false;
      return;
    }
    // Right-click anywhere opens the context action menu — a mouse-only way to
    // reach every action without knowing any hotkeys.
    if (p.rightButtonDown()) {
      this.toggleActionMenu();
      return;
    }
    const pt = { x: p.worldX, y: p.worldY };
    const me = this.gs.current;

    // Scenario Lab tools own the click while a brush / move target is armed.
    if (this.onScenarioFieldClick(pt)) return;

    if (this.mode === 'subtarget-point') {
      const origin = this.subtargetOrigin ?? me.pos;
      const capped = stepTowards(origin, pt, this.subtargetRange);
      if (this.subtargetMinRange && dist(origin, capped) < this.subtargetMinRange - 0.5) {
        this.flashHint('Too close — aim farther away.');
        return;
      }
      this.finishSubtarget(capped);
      return;
    }
    if (this.mode === 'subtarget-enemy') {
      const target = this.clickedMage(pt, this.subtargetCandidates ? null : this.subtargetSource ?? me);
      if (target && this.canPickSubtargetMage(target)) {
        this.finishSubtarget(target);
      } else {
        this.flashHint('Invalid target (out of range or unavailable).');
      }
      return;
    }

    if (this.mode === 'aiming-move') {
      const dest = stepTowards(me.pos, pt, me.moveRange());
      this.mode = 'busy';
      this.submitTurn({ t: 'move', x: dest.x, y: dest.y });
      return;
    }
    if (this.mode === 'aiming-leap') {
      this.mode = 'busy';
      this.submitTurn({ t: 'leap', x: pt.x, y: pt.y });
      return;
    }
    if (this.mode === 'aiming-cleave') {
      this.mode = 'busy';
      this.submitTurn({ t: 'cleave', x: pt.x, y: pt.y });
      return;
    }
    if (this.mode === 'aiming-edgelord-throw') {
      const capped = stepTowards(me.pos, pt, Math.max(0, me.effectiveStr()) * RANGE_UNIT);
      this.mode = 'busy';
      this.submitTurn({ t: 'edgelord-throw', x: capped.x, y: capped.y });
      return;
    }
    if (this.mode === 'aiming-shadow-dagger') {
      const shadow = this.gs.shadowAt(pt);
      if (!shadow) {
        this.flashHint('Point at a shadow.');
        return;
      }
      this.mode = 'busy';
      this.submitTurn({ t: 'weapon-action', x: shadow.x, y: shadow.y });
      return;
    }
    if (this.mode === 'aiming-melee') {
      let target = this.clickedMage(pt, me);
      // The click may miss the small target circle even when a foe is plainly in
      // reach (common when you begin a turn already adjacent). Fall back to the
      // nearest enemy actually within melee range of where you clicked.
      if (!target || !this.gs.canMelee(me, target)) {
        target =
          this.gs.mages
            .filter((m) => this.gs.canMelee(me, m))
            .sort((a, b) => dist(pt, a.pos) - dist(pt, b.pos))[0] ?? null;
      }
      if (target && this.gs.canMelee(me, target)) {
        this.mode = 'busy';
        this.submitTurn({ t: 'melee', target: this.seatOf(target) });
      } else {
        this.flashHint('No enemy in melee range there.');
      }
      return;
    }
    if (this.mode === 'aiming-throw') {
      const itemId = this.throwPendingItem;
      const target = this.clickedMage(pt, null);
      if (itemId && target && target.team !== me.team && this.canThrowAt(me, target, itemId)) {
        this.throwPendingItem = null;
        this.mode = 'busy';
        this.submitTurn({ t: 'item-throw', itemId, target: this.seatOf(target) });
      } else {
        this.flashHint('No enemy within throwing range there.');
      }
      return;
    }
    if (this.mode === 'aiming-eldritch') {
      const target = this.clickedMage(pt, null);
      if (target && target.team !== me.team && target.alive) {
        this.mode = 'busy';
        this.submitTurn({ t: 'eldritch', choice: 'attack', target: this.seatOf(target) });
      } else {
        this.flashHint('Choose an enemy to strike with eldritch truth.');
      }
      return;
    }
    if (this.mode === 'aiming-discharge') {
      const target = this.clickedMage(pt, null);
      const reach = this.gs.thunderDischargeRange(me.thunderStacks);
      if (target && target.alive && dist(me.pos, target.pos) <= reach) {
        this.mode = 'busy';
        this.submitTurn({ t: 'thunder-discharge', target: this.seatOf(target) });
      } else {
        this.flashHint('Discharge needs a target within range.');
      }
      return;
    }
    if (this.mode === 'aiming-spell') {
      // Reaction target selection takes priority when active.
      if (this.reactionAiming && this.reactionPendingSpell) {
        const src = this.aimingSource!;
        const spell = this.reactionPendingSpell;
        const target = this.clickedMage(pt, spell.targeting === 'any' ? null : src);
        if (target && this.gs.isValidSpellTarget(spell, src, target)) {
          this.finishReactionAim({ spell, target });
        } else {
          this.flashHint('Invalid target (out of range / unseen).');
        }
        return;
      }
      const spell = this.pendingSpell;
      if (!spell) return;
      const target = this.clickedMage(pt, spell.targeting === 'any' ? null : me);
      if (target && this.gs.isValidSpellTarget(spell, me, target)) {
        const ability = this.pendingAbility != null;
        this.mode = 'busy';
        this.pendingSpell = null;
        this.pendingAbility = null;
        this.submitTurn({
          t: 'spell',
          spellId: spell.id,
          ability,
          target: this.seatOf(target),
          mods: this.aimedModifiers(ability),
        });
      } else {
        this.flashHint('Invalid target (out of range / unseen).');
      }
      return;
    }
    if (this.mode === 'aiming-point') {
      if (this.reactionAiming && this.reactionPendingSpell) {
        const src = this.aimingSource!;
        const spell = this.reactionPendingSpell;
        const capped = stepTowards(src.pos, pt, spell.range);
        this.finishReactionAim({ spell, point: capped });
        return;
      }
      const spell = this.pendingSpell;
      if (!spell) return;
      const capped = stepTowards(me.pos, pt, spell.range);
      if (spell.minRange && dist(me.pos, capped) < spell.minRange - 0.5) {
        this.flashHint('Too close — aim farther away.');
        return;
      }
      // Two-point cone (Reality Shatter): the first click captures one edge; the
      // spell only commits (and rolls) once the second edge is clicked.
      if (spell.twoPointAim && !this.pendingFirstPoint) {
        this.pendingFirstPoint = capped;
        this.flashHint(`${spell.name}: click the cone's other edge.`, true);
        this.redraw();
        return;
      }
      const ability = this.pendingAbility != null;
      const first = this.pendingFirstPoint;
      this.mode = 'busy';
      this.pendingSpell = null;
      this.pendingAbility = null;
      this.pendingFirstPoint = null;
      if (ability) this.flashHint('', true);
      if (first) {
        this.submitTurn({
          t: 'spell',
          spellId: spell.id,
          ability,
          target: null,
          x: first.x,
          y: first.y,
          x2: capped.x,
          y2: capped.y,
          mods: this.aimedModifiers(ability),
        });
      } else {
        this.submitTurn({
          t: 'spell',
          spellId: spell.id,
          ability,
          target: null,
          x: capped.x,
          y: capped.y,
          mods: this.aimedModifiers(ability),
        });
      }
      return;
    }
    if (this.mode === 'aiming-wall') {
      const spell = this.pendingSpell;
      if (!spell) return;
      const center = stepTowards(me.pos, pt, spell.range);
      const ability = this.pendingAbility != null;
      const angle = this.wallAimAngle;
      this.mode = 'busy';
      this.pendingSpell = null;
      this.pendingAbility = null;
      this.submitTurn({
        t: 'spell',
        spellId: spell.id,
        ability,
        target: null,
        x: center.x,
        y: center.y,
        angle,
        mods: this.aimedModifiers(ability),
      });
      return;
    }
  }

  /** Modifiers ride along with word spells only, never with colour abilities. */
  private aimedModifiers(ability: boolean): WordId[] | undefined {
    if (ability) return undefined;
    const mods = this.selectedModifiers();
    return mods.length > 0 ? mods : undefined;
  }

  private clickedMage(pt: Vec2, exclude: Mage | null): Mage | null {
    for (const m of this.gs.mages) {
      if (exclude && m === exclude) continue;
      if (dist(pt, m.pos) <= MAGE_RADIUS + 14) return m;
    }
    return null;
  }

  private spellManaCost(mage: Mage, spell: Spell): number {
    return wordSpellMana(spell.words, mage.profile) + (mage.swamprunCurse === 'feeding' ? 1 : 0);
  }

  private payForSpell(mage: Mage, spell: Spell, free = false, modifiers: WordId[] = []): void {
    mage.spendCharges(spell.words);
    if (modifiers.length > 0) mage.spendCharges(modifiers);
    let mana = wordSpellMana(spell.words, mage.profile);
    // Focus: the empowered word spell costs 50% less mana.
    if (mage.focusNextSpell) mana = Math.ceil(mana * 0.5);
    // Mutivarg's Rod doubles the mana cost of anything cast through it.
    if (mage.hands.includes('mutivargRod' as ItemId)) mana *= 2;
    // Mana Wand (and any other item with manaDiscount) reduces spell cost.
    mana = Math.max(0, mana - mage.manaDiscountSum());
    // Dark Mage's Cape: the first black-word spell each duel is free.
    if (
      mage.hasFreeBlackSpell() &&
      !mage.firstBlackSpellUsed &&
      spell.words.some((w) => WORD_COLOR[w] === 'black')
    ) {
      mage.firstBlackSpellUsed = true;
      mana = 0;
      this.gs.log(`${mage.name}'s Dark Mage's Cape makes the spell free.`);
    }
    if (free && mage.swamprunCurse === 'feeding') mana += 1;
    mage.spendMana(mana);
    // A free cast costs no action and does not use the one-spell-per-turn
    // allowance, but still pays charges, mana and blood.
    if (!free) {
      mage.hasCastThisTurn = true;
      // Focus pre-pays the action: the empowered spell doesn't spend its slot.
      if (!mage.focusNextSpell) {
        mage.spend(spell.actionType === 'main' ? 'main' : 'bonus');
      }
    }
    // Blood Charm: every spell is paid for in blood as well as mana.
    const bloodPct = mage.spellHealthCostPct();
    if (bloodPct > 0) {
      const bloodCost = Math.max(1, Math.round(mage.maxHp * bloodPct));
      mage.hp = Math.max(0, mage.hp - bloodCost);
      this.gs.log(`${mage.name}'s blood charm exacts ${bloodCost} HP for the casting.`);
    }
    // Blessing of Roaring Thunder: each word cast (success or not) adds a stack.
    if (mage.hasThunderBlessing() && spell.words.length > 0) {
      mage.addThunderStacks(spell.words.length + modifiers.length);
      this.gs.log(
        `${mage.name} draws ${spell.words.length} Thunder stack${spell.words.length > 1 ? 's' : ''} (now ${mage.thunderStacks}).`
      );
      this.gs.checkThunderDeath(mage);
    }
  }

  // ===========================================================================
  //  COLOR ABILITIES (bonus-action powers granted by your primary color)
  // ===========================================================================

  /** Effective color-charge cost after the blue-secondary discount. */
  private abilityChargeCost(me: Mage, ability: ColorAbility): number {
    return Math.max(0, ability.chargeCost - (me.profile.blueSecondaryTier ? 1 : 0));
  }

  /**
   * Effective mana cost for a colour ability. Blue-secondary casters pay no mana
   * for their colour spells at all; everyone else pays the ability's listed cost.
   */
  private abilityManaCost(me: Mage, ability: ColorAbility): number {
    const base = me.profile.blueSecondaryTier ? 0 : ability.manaCost;
    return base + (me.swamprunCurse === 'feeding' ? 1 : 0);
  }

  /** Whether `me` can pay for `ability` (color-charges, optional life, mana). */
  private canAffordAbility(me: Mage, ability: ColorAbility): boolean {
    if (Dev.infiniteActions) return true;
    if (!me.hasMana(this.abilityManaCost(me, ability))) return false;
    const charge = this.abilityChargeCost(me, ability);
    if (me.colorCharges >= charge) return true;
    // Black secondary may substitute up to 2 missing charges with 5% life each.
    if (me.profile.blackSecondaryTier) {
      return charge - me.colorCharges <= 2;
    }
    return false;
  }

  /** Spend a color ability's full cost (charges, substituted life, mana, bonus). */
  private payForColorAbility(me: Mage, ability: ColorAbility, free = false): void {
    const charge = this.abilityChargeCost(me, ability);
    let fromCharges = Math.min(charge, me.colorCharges);
    let fromLife = charge - fromCharges;
    if (fromLife > 0 && me.profile.blackSecondaryTier) {
      // Black-secondary casters may spend up to 2 charges they don't have by
      // paying HP instead: each skipped charge costs 5% of max HP (rounded up,
      // min 1) — and this CAN drop them to 0 and kill them, with no warning.
      fromLife = Math.min(fromLife, 2);
      fromCharges = charge - fromLife;
      const per = Math.max(1, Math.ceil(me.maxHp * 0.05));
      const lifeCost = fromLife * per;
      me.hp = Math.max(0, me.hp - lifeCost);
      this.gs.log(`${me.name} pays ${lifeCost} life for ${fromLife} color charge${fromLife > 1 ? 's' : ''}.`);
      if (me.hp <= 0) this.gs.log(`${me.name} is consumed by the black magic!`);
    }
    me.spendColorCharges(fromCharges);
    const baseManaCost = me.profile.blueSecondaryTier ? 0 : ability.manaCost;
    const manaCost = baseManaCost + (free && me.swamprunCurse === 'feeding' ? 1 : 0);
    me.spendMana(manaCost);
    me.lastAbilityManaPaid = this.abilityManaCost(me, ability);
    if (!free) me.spend('bonus');
    // Count the cast toward this ability's per-combat cap (both proactive casts
    // and reactions share the same budget). Runs on both peers in lockstep.
    me.abilityCastsUsed[ability.id] = (me.abilityCastsUsed[ability.id] ?? 0) + 1;
  }

  /** Cast the idx-th color ability granted by the current mage's primary color. */
  private castColorAbility(idx: number): void {
    if (this.mode === 'reaction') {
      this.castAbilityReaction(idx);
      return;
    }
    if (!this.humanActive) return;
    const me = this.gs.current;
    const ability = getColorAbilitiesFor(me.profile.primary, me.mageClass)[idx];
    if (!ability) {
      this.flashHint('No color ability there.');
      return;
    }
    if (me.isAbilityBanned(ability.id)) {
      this.flashHint('That ability has been stifled forever.');
      return;
    }
    if (me.abilityCastsLeft(ability.id) <= 0) {
      this.flashHint(`${ability.name} is spent for this combat.`);
      return;
    }
    if (me.actions.bonus <= 0 && !Dev.infiniteActions) {
      this.flashHint('Color abilities need a bonus action.');
      return;
    }
    if (!this.canAffordAbility(me, ability)) {
      this.flashHint('Not enough color charges / mana.');
      return;
    }
    if (ability.targeting === 'self' || ability.targeting === 'none') {
      this.resetSelection();
      this.mode = 'busy';
      this.submitTurn({
        t: 'spell',
        spellId: ability.id,
        ability: true,
        target: ability.targeting === 'self' ? me.team : null,
      });
      return;
    }
    if (ability.targeting === 'point') {
      this.pendingAbility = ability;
      this.pendingSpell = ability;
      if (ability.rotatableWall) {
        this.wallAimAngle = 0;
        this.mode = 'aiming-wall';
        this.flashHint(`${ability.name} — move to place, [H] rotate, click to confirm.`);
        this.redraw();
        return;
      }
      this.mode = 'aiming-point';
      this.flashHint(`${ability.name} — click a destination within range.`);
      this.redraw();
      return;
    }
    // enemy / ally
    this.pendingAbility = ability;
    this.pendingSpell = ability;
    this.mode = 'aiming-spell';
    this.flashHint(`${ability.name} — click a valid target.`);
    this.redraw();
  }

  private resetSelection(): void {
    this.selectedIdx = [];
    this.pendingSpell = null;
    this.pendingAbility = null;
    this.aimingSource = null;
  }

  /** Flip a dev cheat toggle and refresh the panel / view. */
  private toggleDev(key: DevToggle): void {
    Dev[key] = !Dev[key];
    this.refreshDevPanel();
    this.redraw();
  }

  // ===========================================================================
  //  REACTION PROMPT (human)
  // ===========================================================================

  private promptReaction(
    reactor: Mage,
    top: StackItem
  ): Promise<ReactionChoice | null> {
    return new Promise((resolve) => {
      this.reactor = reactor;
      this.reactionTop = top;
      this.reactionResolve = resolve;
      this.mode = 'reaction';
      this.resetSelection();
      const abil = this.castableAbilities(reactor).length > 0 ? '  [Z/X] color ability' : '';
      const needle = this.canNeedle(reactor, top) ? '  [K] needle' : '';
      const physical = !top.noPhysicalReaction && this.isIncomingAttack(top, reactor);
      const block = physical && this.canBlock(reactor) ? '  [B] block' : '';
      const bash = physical && this.canBash(reactor, top) ? '  [N] bash' : '';
      const weapon =
        physical && this.canWeaponReact(reactor, top)
          ? `  [A] weapon (${Math.max(0, MAX_WEAPON_REACTIONS - reactor.weaponReactionsUsed)})`
          : '';
      const dodge = physical && this.canDodge(reactor) ? `  [D] dodge (${reactor.dodgesRemaining})` : '';
      this.flashHint(
        `${reactor.name}: REACTION — [1-5]+Enter to cast${abil}${block}${bash}${weapon}${needle}${dodge}, or Space/E to pass.`
      );
      this.redraw();
    });
  }

  /** Cast the currently selected combo as a reaction, if it is a legal one. */
  private castReaction(): void {
    if (!this.reactor || !this.reactionTop) return;
    if (this.reactor.blocksCasting()) {
      this.flashHint('Both hands full — drop an item (G) to cast.');
      return;
    }
    const spell = this.currentComboSpell();
    if (!spell) {
      this.flashHint('No spell for that word combination.');
      return;
    }
    const forgotten = this.reactor.forgotten();
    if (forgotten.length && spell.words.some((w) => forgotten.includes(w))) {
      this.flashHint('You have forgotten part of that spell.');
      return;
    }
    if (!this.castableReactions(this.reactor).some((s) => s.id === spell.id)) {
      this.flashHint(`${spell.name} can't be cast as a reaction right now.`);
      return;
    }
    this.onReactionChosen(this.reactor, spell, this.reactionTop);
  }

  /** Cast a color ability as a reaction (blue mages only). */
  private castAbilityReaction(idx: number): void {
    if (!this.reactor || !this.reactionTop) return;
    if (!this.canReactWithAbilities(this.reactor)) {
      this.flashHint('Only blue mages can react with color abilities.');
      return;
    }
    const ability = getColorAbilitiesFor(this.reactor.profile.primary, this.reactor.mageClass)[idx];
    if (!ability) {
      this.flashHint('No color ability there.');
      return;
    }
    if (this.reactor.isAbilityBanned(ability.id)) {
      this.flashHint('That ability has been stifled forever.');
      return;
    }
    if (this.reactor.abilityCastsLeft(ability.id) <= 0) {
      this.flashHint(`${ability.name} is spent for this combat.`);
      return;
    }
    if (!this.canAffordAbility(this.reactor, ability)) {
      this.flashHint('Not enough color charges / mana.');
      return;
    }
    this.onReactionChosen(this.reactor, ability, this.reactionTop);
  }

  /** Pass priority during a reaction mini-turn (no reaction is cast). */
  private onReactionPass(): void {
    if (this.mode !== 'reaction') return;
    this.resolveReaction(null);
  }

  /**
   * Flip the auto-pass toggle. Can be used at any time — including while a
   * reaction window is open, in which case the current prompt passes at once.
   */
  private toggleAutoPass(): void {
    this.autoPassReactions = !this.autoPassReactions;
    this.refreshAutoPassButton();
    this.flashHint(
      this.autoPassReactions
        ? 'Auto-pass ON — reactions will pass automatically. [O] to turn off.'
        : 'Auto-pass OFF — you will be prompted for reactions. [O] to turn on.'
    );
    // If a reaction prompt is currently open, resolve it as a pass immediately.
    if (this.autoPassReactions && this.mode === 'reaction') this.onReactionPass();
  }

  /** Sync the on-screen auto-pass button label/colour with the toggle state. */
  private refreshAutoPassButton(): void {
    if (!this.autoPassButton) return;
    const on = this.autoPassReactions;
    this.autoPassButton.setLabel(`AUTO ${on ? 'ON' : 'OFF'}`);
    this.autoPassButton.setSelected(on);
  }

  /**
   * Flip spectate mode. When on, every seat is driven by the AI so the battle
   * plays out on its own. Available offline only. If it is currently a human's
   * turn, hand it straight to the AI so the match keeps flowing.
   */
  private toggleSpectate(): void {
    if (this.online) {
      this.flashHint('Spectate mode is unavailable in online matches.');
      return;
    }
    this.spectateAll = !this.spectateAll;
    this.refreshSpectateButton();
    this.flashHint(
      this.spectateAll
        ? 'Spectate ON — the AI now plays every side. [Y] to take back control.'
        : 'Spectate OFF — you regain control on the next turn. [Y] to watch again.'
    );
    // If we are idling on a human turn, let the AI take it over right now.
    if (this.spectateAll && this.mode === 'idle') void this.driveSpectatedTurn();
  }

  /** Drive the current (now AI-controlled) turn to completion during spectate. */
  private async driveSpectatedTurn(): Promise<void> {
    if (this.mode !== 'idle') return;
    if (!this.controllerIsAI(this.gs.current)) return;
    this.mode = 'busy';
    this.redraw();
    await this.runAITurn();
    if (this.gs.isOver) return this.endGame();
    await this.nextTurn();
  }

  /** Sync the on-screen spectate button label/colour with the toggle state. */
  private refreshSpectateButton(): void {
    if (!this.spectateButton) return;
    const on = this.spectateAll;
    this.spectateButton.setLabel(`WATCH ${on ? 'ON' : 'OFF'}`);
    this.spectateButton.setEnabled(!this.online);
    this.spectateButton.setSelected(on);
  }

  private toggleCombatSpeed(): void {
    this.combatSpeed = this.combatSpeed === 1 ? 4 : 1;
    this.time.timeScale = this.combatSpeed;
    this.tweens.timeScale = this.combatSpeed;
    this.anims.globalTimeScale = this.combatSpeed;
    this.swampArena?.setCombatSpeed(this.combatSpeed);
    this.particleFx?.setCombatSpeed(this.combatSpeed);
    this.refreshCombatSpeedButton();
    this.flashHint(`Combat speed: ${this.combatSpeed}x  [.]`);
  }

  private refreshCombatSpeedButton(): void {
    if (!this.combatSpeedButton) return;
    const fast = this.combatSpeed > 1;
    this.combatSpeedButton.setLabel(`SPEED ${this.combatSpeed}X`);
    this.combatSpeedButton.setSelected(fast);
  }

  /**
   * Rebuild the docked enemy target list. Each row targets that foe with the
   * current aiming action when clicked, so overlapping bodies can always be
   * picked apart. Rebuilt on every redraw to track deaths and HP changes.
   */
  private refreshTargetList(): void {
    const panel = this.targetListPanel;
    if (!panel) return;
    panel.removeAll(true);
    const me = this.gs.current;
    const allCombatants =
      this.mode === 'aiming-discharge' ||
      (this.mode === 'subtarget-enemy' && this.subtargetCandidates !== null);
    const foes = allCombatants
      ? this.gs.mages.filter(
          (mage) => mage.alive && (!this.subtargetCandidates || this.subtargetCandidates.has(mage))
        )
      : this.gs.mages.filter((mage) => mage.alive && mage.team !== me.team);
    const targetHeading = allCombatants ? 'TARGETS' : 'FOES';
    const width = FIELD_OVERLAY_TR.w;
    const pageSize = 5;
    const pages = Math.max(1, Math.ceil(foes.length / pageSize));
    this.targetListPage = Phaser.Math.Clamp(this.targetListPage, 0, pages - 1);
    const first = this.targetListPage * pageSize;
    const visibleFoes = foes.slice(first, first + pageSize);
    panel.setPosition(FIELD_OVERLAY_TR.x, FIELD_OVERLAY_TR.y);
    const headerBg = this.add
      .rectangle(0, 0, width, 26, MENU_COLOR.woodDeep, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(1, MENU_COLOR.brassDark)
      .setInteractive({ useHandCursor: true });
    const count = pages > 1 && this.showTargetList
      ? `${first + 1}-${Math.min(first + pageSize, foes.length)} / ${foes.length}`
      : `${foes.length}`;
    const header = this.add
      .text(
        width / 2,
        13,
        this.showTargetList ? `${targetHeading}  ${count}` : `${targetHeading}  ${count}  ·  CLOSED`,
        {
        fontFamily: MENU_FONT.control,
        fontSize: '12px',
        color: MENU_HEX.brassLight,
        fontStyle: 'bold',
        }
      )
      .setOrigin(0.5);
    headerBg.on('pointerdown', () => {
      this.showTargetList = !this.showTargetList;
      this.refreshTargetList();
    });
    panel.add([headerBg, header]);
    if (!this.showTargetList || foes.length === 0) return;
    if (pages > 1) {
      const previous = new CabinetChip(this, 2, 2, {
        width: 24,
        height: 22,
        label: '<',
        enabled: this.targetListPage > 0,
        onActivate: () => {
          this.targetListPage--;
          this.refreshTargetList();
        },
      });
      const next = new CabinetChip(this, width - 26, 2, {
        width: 24,
        height: 22,
        label: '>',
        enabled: this.targetListPage < pages - 1,
        onActivate: () => {
          this.targetListPage++;
          this.refreshTargetList();
        },
      });
      panel.add([previous, next]);
    }
    let y = 28;
    for (const m of visibleFoes) {
      const targetable = this.canTargetEnemyNow(m);
      const rowBg = this.add
        .rectangle(0, y, width, 21, MENU_COLOR.charcoal, 1)
        .setOrigin(0, 0)
        .setStrokeStyle(1, targetable ? MENU_COLOR.verdigris : MENU_COLOR.woodEdge, 0.82)
        .setInteractive({ useHandCursor: true });
      const accent = this.add
        .rectangle(0, y, 4, 21, targetable ? MENU_COLOR.verdigris : MENU_COLOR.disabled, 1)
        .setOrigin(0, 0);
      const vitals =
        !m.sanityImmune && m.maxSanity > 0
          ? `${m.hp}/${m.maxHp} HP · ${m.sanity} SAN`
          : `${m.hp}/${m.maxHp} HP`;
      const txt = this.add
        .text(9, y + 4, `${m.name}  ${vitals}`, {
          fontFamily: MENU_FONT.control,
          fontSize: '11px',
          color: targetable ? MENU_HEX.bone : MENU_HEX.disabled,
          fixedWidth: width - 14,
        })
        .setOrigin(0, 0)
        .setCrop(0, 0, width - 14, 16)
        .setInteractive({ useHandCursor: true });
      const pick = (): void => this.selectEnemyTarget(m);
      rowBg.on('pointerdown', pick);
      txt.on('pointerdown', pick);
      rowBg.on('pointerover', () => rowBg.setFillStyle(MENU_COLOR.woodRaised, 1));
      rowBg.on('pointerout', () => rowBg.setFillStyle(MENU_COLOR.charcoal, 1));
      panel.add([rowBg, accent, txt]);
      y += 23;
    }
  }

  /** Whether `m` is a legal target for whatever the player is currently aiming. */
  private canTargetEnemyNow(m: Mage): boolean {
    const me = this.gs.current;
    switch (this.mode) {
      case 'aiming-melee':
        return this.gs.canMelee(me, m);
      case 'aiming-throw':
        return !!this.throwPendingItem && this.canThrowAt(me, m, this.throwPendingItem);
      case 'aiming-eldritch':
        return m.team !== me.team;
      case 'aiming-discharge':
        return dist(me.pos, m.pos) <= this.gs.thunderDischargeRange(me.thunderStacks);
      case 'subtarget-enemy':
        return this.canPickSubtargetMage(m);
      case 'aiming-spell': {
        const spell = this.reactionAiming ? this.reactionPendingSpell : this.pendingSpell;
        const src = this.reactionAiming ? this.aimingSource ?? me : me;
        return !!spell && this.gs.isValidSpellTarget(spell, src, m);
      }
      default:
        return false;
    }
  }

  /** Target `foe` with the current aiming action, exactly as clicking it would. */
  private selectEnemyTarget(foe: Mage): void {
    if (!foe.alive) return;
    const me = this.gs.current;
    switch (this.mode) {
      case 'aiming-melee':
        if (this.gs.canMelee(me, foe)) {
          this.mode = 'busy';
          this.submitTurn({ t: 'melee', target: this.seatOf(foe) });
        } else this.flashHint('That foe is out of melee reach.');
        return;
      case 'aiming-throw': {
        const itemId = this.throwPendingItem;
        if (itemId && foe.team !== me.team && this.canThrowAt(me, foe, itemId)) {
          this.throwPendingItem = null;
          this.mode = 'busy';
          this.submitTurn({ t: 'item-throw', itemId, target: this.seatOf(foe) });
        } else this.flashHint('That foe is out of throwing range.');
        return;
      }
      case 'aiming-eldritch':
        if (foe.team !== me.team) {
          this.mode = 'busy';
          this.submitTurn({ t: 'eldritch', choice: 'attack', target: this.seatOf(foe) });
        } else this.flashHint('Choose an enemy to strike.');
        return;
      case 'aiming-discharge': {
        const reach = this.gs.thunderDischargeRange(me.thunderStacks);
        if (dist(me.pos, foe.pos) <= reach) {
          this.mode = 'busy';
          this.submitTurn({ t: 'thunder-discharge', target: this.seatOf(foe) });
        } else this.flashHint('That foe is out of discharge range.');
        return;
      }
      case 'subtarget-enemy': {
        if (this.canPickSubtargetMage(foe)) {
          this.finishSubtarget(foe);
        } else this.flashHint('Invalid target (out of range or unavailable).');
        return;
      }
      case 'aiming-spell': {
        if (this.reactionAiming && this.reactionPendingSpell) {
          const src = this.aimingSource ?? me;
          const spell = this.reactionPendingSpell;
          if (this.gs.isValidSpellTarget(spell, src, foe)) this.finishReactionAim({ spell, target: foe });
          else this.flashHint('Invalid target (out of range / unseen).');
          return;
        }
        const spell = this.pendingSpell;
        if (!spell) {
          this.flashHint('Choose a spell first, then click a foe here.');
          return;
        }
        if (this.gs.isValidSpellTarget(spell, me, foe)) {
          const ability = this.pendingAbility != null;
          this.mode = 'busy';
          this.pendingSpell = null;
          this.pendingAbility = null;
          this.submitTurn({ t: 'spell', spellId: spell.id, ability, target: this.seatOf(foe) });
        } else this.flashHint('Invalid target (out of range / unseen).');
        return;
      }
      default:
        this.flashHint('Begin an attack or a targeted spell first, then click a foe here.');
    }
  }

  /** Build the floating, scrollable window that shows a spell's full description. */
  private buildSpellInfoPanel(): void {
    const w = DOCK_SPELL.w + 120;
    const headerH = 24;
    const bodyH = 120;
    // This inspector replaces the lower-right log temporarily rather than
    // covering combatants on the battlefield.
    const x = right(DOCK_LOG) - w;
    const y = DOCK_LOG.y + 32;
    const c = this.add.container(0, 0).setDepth(70).setVisible(false);
    const bg = this.add
      .rectangle(x, y, w, headerH + bodyH, MENU_COLOR.woodDeep, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(2, MENU_COLOR.brassDark)
      .setInteractive();
    const inner = this.add
      .rectangle(x + 8, y + headerH, w - 16, bodyH - 8, MENU_COLOR.charcoal, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(1, MENU_COLOR.woodEdge);
    const accent = this.add.rectangle(x, y, 5, headerH + bodyH, MENU_COLOR.amethyst, 1).setOrigin(0, 0);
    const title = this.add
      .text(x + 12, y + 5, '', {
        fontFamily: MENU_FONT.display,
        fontSize: FONT.body,
        color: MENU_HEX.brassLight,
        fontStyle: 'bold',
        fixedWidth: w - 24,
      })
      .setOrigin(0, 0);
    const body = this.add
      .text(x + 16, y + headerH + 8, '', {
        fontFamily: MENU_FONT.body,
        fontSize: FONT.small,
        color: MENU_HEX.bone,
        wordWrap: { width: w - 32 },
        lineSpacing: 3,
      })
      .setOrigin(0, 0);
    const maskShape = this.add.graphics().setVisible(false);
    maskShape.fillStyle(0xffffff).fillRect(x + 10, y + headerH + 2, w - 20, bodyH - 12);
    body.setMask(maskShape.createGeometryMask());
    c.add([bg, inner, accent, title, body]);
    // The background spans the whole panel and catches wheel scrolls (the body
    // text on top is non-interactive, so events fall through to it).
    bg.on('wheel', (_p: Phaser.Input.Pointer, _dx: number, dy: number) => this.scrollSpellInfo(dy));
    bg.on('pointerdown', () => {
      this.spellInfoPinned = false;
      this.spellInfoHovered = false;
      c.setVisible(false);
    });
    this.spellInfoPanel = c;
    this.spellInfoTitle = title;
    this.spellInfoBody = body;
    this.spellInfoBodyTop = y + headerH + 8;
    this.spellInfoBodyH = bodyH - 12;
  }

  /** Scroll the spell-description body within its masked viewport. */
  private scrollSpellInfo(dy: number): void {
    const body = this.spellInfoBody;
    if (!body) return;
    const overflow = Math.max(0, body.height - this.spellInfoBodyH);
    this.spellInfoScroll = Phaser.Math.Clamp(this.spellInfoScroll + (dy > 0 ? 20 : -20), 0, overflow);
    body.y = this.spellInfoBodyTop - this.spellInfoScroll;
  }

  /** Show the selected spell's description in the scroll window (or hide it). */
  private updateSpellInfoPanel(spell: Spell | undefined, me: Mage): void {
    const panel = this.spellInfoPanel;
    const title = this.spellInfoTitle;
    const body = this.spellInfoBody;
    if (!panel || !title || !body) return;
    if (!spell || (!this.spellInfoHovered && !this.spellInfoPinned)) {
      if (!spell) this.spellInfoPinned = false;
      panel.setVisible(false);
      return;
    }
    panel.setVisible(true);
    const rng = Number.isFinite(spell.range) ? `range ${spell.range}` : 'any range';
    const mana = this.spellManaCost(me, spell);
    title.setText(`${spell.name}  —  ${spell.actionType}, ${rng}, ${mana} mana`);
    if (body.text !== spell.description) {
      body.setText(spell.description);
      this.spellInfoScroll = 0;
      body.y = this.spellInfoBodyTop;
    }
  }

  /** Spend a Needle of Serenity during the reaction window. */
  private chooseNeedleReaction(): void {
    if (!this.reactor || !this.reactionTop) return;
    if (!this.canNeedle(this.reactor, this.reactionTop)) {
      this.flashHint('The Needle can only stifle abilities or weapon strikes.');
      return;
    }
    this.resolveReaction({ needle: true });
  }

  /** Attempt a Dexterity dodge during the reaction window. */
  private chooseDodgeReaction(): void {
    if (!this.reactor || !this.reactionTop) return;
    if (!this.canDodge(this.reactor)) {
      this.flashHint('No dodge available (need Dex 6+ and a dodge left).');
      return;
    }
    this.resolveReaction({ dodge: true });
  }

  /**
   * Resolve a Dexterity dodge in the damage window, called the moment before an
   * incoming strike would apply its effect. Rolls floor(Dex/2)d6 and reads it:
   *  - no pair  → the dodge fails; the action lands normally.
   *  - a pair   → the whole action is negated (no damage, no hex) and the dodger
   *               slips aside up to (2 + Dex/10) range-units.
  *  - triple+  → as a pair, then opens one action-free bonus-action window.
  * Returns the rolled tier; every tier except `none` avoids the strike.
   */
  private async performDodge(reactor: Mage, top: StackItem): Promise<DodgeTier> {
    reactor.dodgesRemaining = Math.max(0, reactor.dodgesRemaining - 1);
    const dex = reactor.effectiveDex();
    const n = Math.max(1, Math.floor(dex / 2));
    const roll = this.gs.rng.roll(`${n}d6`);
    this.pendingDice = [];
    this.pendingDice.push({
      spec: `${n}d6`,
      total: roll.total,
      rolls: roll.rolls,
      label: `${reactor.name} dodge`,
      mage: reactor,
      seq: this.vfxSeq++,
    });
    await this.playPendingDice();
    const tier = analyzeDodge(roll.rolls);
    this.gs.log(
      `${reactor.name} rolls a dodge [${roll.rolls.join(', ')}] → ${dodgeTierLabel(tier)}.`
    );
    if (tier === 'none') {
      this.gs.log(`${reactor.name} fails to dodge. The attack lands.`);
      return tier;
    }

    // Success: negate the whole action and let the dodger slip aside. The
    // reposition distance scales only very slightly with Dexterity: 2R at Dex 0
    // up to 4R at Dex 20.
    this.gs.log(`${reactor.name} dodges the ${top.label.toLowerCase()}.`);
    const range = RANGE_UNIT * (2 + dex / 10);
    let dest: Vec2 | null;
    if (this.controllerIsAI(reactor)) {
      // Retreat directly away from the attacker.
      const away = { x: 2 * reactor.x - top.source.x, y: 2 * reactor.y - top.source.y };
      dest = stepTowards(reactor.pos, away, range);
    } else {
      dest = await this.requestSubtargetPoint(reactor, {
        maxRange: range,
        prompt: `${reactor.name}: dodge — pick where to slip (Esc to hold ground).`,
      });
    }
    if (dest) this.dodgeMove(reactor, dest);
    return tier;
  }

  /** Move the dodging mage to `dest`, clamped by the field, barriers and bodies. */
  private dodgeMove(reactor: Mage, dest: Vec2): void {
    const fieldDest = {
      x: Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, dest.x)),
      y: Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, dest.y)),
    };
    const clamp = this.gs.clampToBarriers(reactor.pos, fieldDest);
    const mut = this.gs.clampToMutivargZones(reactor, reactor.pos, clamp.dest);
    const final = this.gs.clampToMages(reactor, reactor.pos, mut.dest);
    const origin = reactor.pos;
    reactor.x = final.x;
    reactor.y = final.y;
    this.gs.notifyMageRelocation(reactor, origin, final, true);
    this.gs.updateAttachedScarabs();
    this.gs.dropTrailShadows(reactor);
    this.gs.log(`${reactor.name} repositions.`);
    this.redraw();
  }

  /** Mage targets that remain legal for a bonus spell at this exact moment. */
  private dodgeBonusSpellTargets(source: Mage, spell: Spell): Mage[] {
    return this.gs.mages.filter((target) => this.gs.isValidSpellTarget(spell, source, target));
  }

  /** Concrete actions shown after a triple/quad dodge; every entry costs one bonus action normally. */
  private dodgeBonusOptions(source: Mage): DodgeBonusOption[] {
    const options: DodgeBonusOption[] = [];
    const add = (id: string, label: string, detail: string): void => {
      options.push({ id, label, detail });
    };

    // Word spells never belong in this window, even when their metadata marks
    // them as bonus casts. Only colour abilities use the spell-shaped command.
    for (const ability of getColorAbilitiesFor(source.profile.primary, source.mageClass)) {
      const targeted =
        ability.targeting === 'enemy' || ability.targeting === 'ally' || ability.targeting === 'any';
      if (
        source.isAbilityBanned(ability.id) ||
        source.abilityCastsLeft(ability.id) <= 0 ||
        !this.canAffordAbility(source, ability) ||
        (targeted && this.dodgeBonusSpellTargets(source, ability).length === 0)
      ) continue;
      add(
        `ability:${ability.id}`,
        `Cast ${ability.name}`,
        `${this.abilityChargeCost(source, ability)} color charges and ${this.abilityManaCost(source, ability)} mana; not a spell reaction.`
      );
    }

    if (source.hasThunderBlessing() && !source.isActionBanned('thunder-charge')) {
      add('thunder-charge', 'Charge Up', 'Pay the normal mana and life costs; spend no bonus-action slot.');
    }
    const dischargeRange = this.gs.thunderDischargeRange(source.thunderStacks);
    if (
      source.hasThunderBlessing() &&
      source.thunderStacks > 0 &&
      !source.isActionBanned('thunder-discharge') &&
      this.gs.mages.some((target) => target.alive && dist(source.pos, target.pos) <= dischargeRange)
    ) {
      add('thunder-discharge', 'Discharge', `Release all ${source.thunderStacks} Thunder stacks.`);
    }

    if (
      source.attackIsBonusAction() &&
      !source.hasForgotten('melee') &&
      !source.outOfAmmo() &&
      this.gs.mages.some((target) => this.gs.canMelee(source, target))
    ) {
      add('melee', 'Attack', 'Make your normal bonus-action weapon strike.');
    }
    if (source.leapsLeft() > 0) {
      add('leap', 'Leap', `Bound in a chosen direction; ${source.leapsLeft()} leaps remain.`);
    }

    if (source.hasWeaponAction()) {
      const first = source.weaponAbilityItems()[0];
      const ability = first ? getItem(first).weaponAbility : undefined;
      const usableDagger = ability !== 'shadowDaggerTeleport' || this.gs.isInShadow(source);
      if (ability && !source.isActionBanned(`weapon:${ability}`) && usableDagger) {
        add('weapon-action', 'Weapon action', 'Trigger the equipped weapon ability.');
      }
    }
    if (
      source.hasDeathsAngelWings() &&
      source.deathsAngelEnergy > 0 &&
      !source.isItemBanned('deathsAngelWings')
    ) {
      add('deaths-angel-wings', 'Unfurl Deaths Angel Wings', 'Spend 1 Energy to begin or extend flight.');
    }
    if (source.bindMantleCharges > 0) {
      add('mantle-bind', 'Weak Bind', `Root the nearest enemy; ${source.bindMantleCharges} charges remain.`);
    }
    const cleanseCost = source.cleanseManaCost();
    if (cleanseCost != null && source.mana >= cleanseCost) {
      add('cleanse', 'Cleanse', `Pay ${cleanseCost} mana to wash every affliction off yourself.`);
    }
    if (
      source.hasEdgelordLantern() &&
      !source.isItemBanned('edgelordLantern') &&
      (source.edgelordLanternActive ||
        (this.gs.edgelordCaptives(source).length === 0 && source.mana >= 4))
    ) {
      add(
        'edgelord-shake',
        source.edgelordLanternActive ? 'Seal Edgelord Lantern' : 'Awaken Edgelord Lantern',
        source.edgelordLanternActive ? 'Pull and capture nearby creatures.' : 'Pay 4 mana and spread Soul Rend.'
      );
    }

    if (!source.swordFormLocked()) {
      for (const itemId of source.bag) {
        if (source.canEquipFromBag(itemId)) {
          add(`item-equip:${itemId}`, `Equip ${getItem(itemId).name}`, 'Move this item from the bag into its equipment slot.');
        }
      }
      for (const itemId of source.hands) {
        if (!getItem(itemId).permanentlyBinding) {
          add(`item-unequip:${itemId}`, `Unequip ${getItem(itemId).name}`, 'Stow this held item in the bag.');
          add(`item-drop:${itemId}`, `Drop ${getItem(itemId).name}`, 'Drop this held item at your feet.');
        }
      }
      for (const itemId of source.accessories) {
        add(`item-drop:${itemId}`, `Take off ${getItem(itemId).name}`, 'Remove and drop this accessory.');
      }
      const drop = this.gs.nearestDropFor(source);
      if (
        drop &&
        source.hasFreeHand() &&
        !source.summonItemLimited(drop.itemId) &&
        source.canCarry(getItem(drop.itemId).weight)
      ) {
        add(`item-pickup:${drop.id}`, `Pick up ${getItem(drop.itemId).name}`, 'Retrieve the nearby dropped item.');
      }
    }

    for (const itemId of source.utility) {
      const item = getItem(itemId);
      if (source.isItemBanned(itemId) || source.swordFormLocked()) continue;
      if (
        item.potion &&
        !((item.potion === 'mana' && source.mana >= source.maxMana) ||
          (item.potion === 'health' && source.hp >= source.maxHp))
      ) {
        add(`item-use:${itemId}`, `Consume ${item.name}`, 'Use the item without spending your stored bonus action.');
      }
      if (
        item.throwable &&
        this.gs.mages.some((target) => target.team !== source.team && this.canThrowAt(source, target, itemId))
      ) {
        add(`item-throw:${itemId}`, `Throw ${item.name}`, 'Choose an enemy in throwing range.');
      }
    }
    return options;
  }

  /** Resolve the local choice overlay without leaking its input mode into stack resolution. */
  private promptDodgeBonusOption(source: Mage, options: DodgeBonusOption[]): Promise<string | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (optionId: string | null): void => {
        if (settled) return;
        settled = true;
        this.dodgeBonusMenu?.destroy();
        this.dodgeBonusMenu = undefined;
        this.mode = 'busy';
        resolve(optionId);
      };
      this.mode = 'dodge-bonus';
      this.dodgeBonusMenu = new PagedChoiceMenuView(
        this,
        'PERFECT DODGE / FREE BONUS ACTION',
        `${source.name} may use one legal bonus action without spending the stored bonus-action slot. Normal resource costs still apply.`,
        options,
        (optionId) => finish(optionId),
        () => finish(null)
      );
      this.flashHint(`${source.name}: choose a free bonus action, or cancel to pass.`, true);
      this.redraw();
    });
  }

  /** Pick the same option on both peers; only a human decision crosses the wire. */
  private async chooseDodgeBonusOption(
    source: Mage,
    options: DodgeBonusOption[]
  ): Promise<string | null> {
    if (this.controllerIsAI(source)) return options[0]?.id ?? null;
    if (this.online && !this.isLocalDecider(source)) {
      const msg = await this.net!.recv();
      if (msg.k === 'bye') return null;
      const cmd = msg.cmd as DodgeBonusChoiceCommand | undefined;
      const optionId = cmd?.t === 'dodge-bonus' ? cmd.optionId : null;
      return optionId && options.some((option) => option.id === optionId) ? optionId : null;
    }
    const optionId = await this.promptDodgeBonusOption(source, options);
    if (this.online) {
      this.net?.send({
        k: 'dodge-bonus',
        cmd: { t: 'dodge-bonus', optionId } satisfies DodgeBonusChoiceCommand,
      });
    }
    return optionId;
  }

  /** Gather any target needed by the selected option, reusing the lockstep sub-target channel. */
  private async buildDodgeBonusCommand(
    source: Mage,
    optionId: string
  ): Promise<TurnCommand | null> {
    if (optionId.startsWith('ability:')) {
      const spellId = optionId.slice('ability:'.length);
      const spell = this.resolveSpellId(spellId);
      if (!spell || !this.isColorAbility(spell) || spell.actionType !== 'bonus') return null;
      if (spell.targeting === 'self' || spell.targeting === 'none') {
        return {
          t: 'spell',
          spellId: spell.id,
          ability: true,
          target: spell.targeting === 'self' ? this.seatOf(source) : null,
        };
      }
      if (spell.targeting === 'point') {
        const maxRange = Number.isFinite(spell.range)
          ? spell.range
          : Math.hypot(FIELD.w, FIELD.h);
        const point = await this.requestSubtargetPoint(source, {
          maxRange,
          minRange: spell.minRange,
          prompt: `${source.name}: choose a point for ${spell.name} (Esc to pass).`,
        });
        if (!point) return null;
        let point2: Vec2 | null = null;
        if (spell.twoPointAim) {
          point2 = await this.requestSubtargetPoint(source, {
            maxRange,
            minRange: spell.minRange,
            prompt: `${source.name}: choose the second point for ${spell.name} (Esc to pass).`,
          });
          if (!point2) return null;
        }
        return {
          t: 'spell',
          spellId: spell.id,
          ability: true,
          target: null,
          x: point.x,
          y: point.y,
          x2: point2?.x,
          y2: point2?.y,
          angle: spell.rotatableWall ? 0 : undefined,
        };
      }
      const candidates = this.dodgeBonusSpellTargets(source, spell);
      const target = await this.requestSubtargetCombatant(source, {
        candidates,
        range: Infinity,
        prompt: `${source.name}: choose a target for ${spell.name}.`,
      });
      return target
        ? { t: 'spell', spellId: spell.id, ability: true, target: this.seatOf(target) }
        : null;
    }

    if (optionId === 'thunder-discharge') {
      const range = this.gs.thunderDischargeRange(source.thunderStacks);
      const candidates = this.gs.mages.filter(
        (target) => target.alive && dist(source.pos, target.pos) <= range
      );
      const target = await this.requestSubtargetCombatant(source, {
        candidates,
        range,
        prompt: `${source.name}: choose the first Discharge target.`,
      });
      return target ? { t: 'thunder-discharge', target: this.seatOf(target) } : null;
    }
    if (optionId === 'melee') {
      const candidates = this.gs.mages.filter((target) => this.gs.canMelee(source, target));
      const target = await this.requestSubtargetCombatant(source, {
        candidates,
        range: Infinity,
        prompt: `${source.name}: choose a target for the bonus strike.`,
      });
      return target ? { t: 'melee', target: this.seatOf(target) } : null;
    }
    if (optionId === 'leap') {
      const point = await this.requestSubtargetPoint(source, {
        maxRange: Math.hypot(FIELD.w, FIELD.h),
        prompt: `${source.name}: choose a direction for Leap (Esc to pass).`,
      });
      return point ? { t: 'leap', x: point.x, y: point.y } : null;
    }
    if (optionId === 'weapon-action') {
      const first = source.weaponAbilityItems()[0];
      if (first && getItem(first).weaponAbility === 'shadowDaggerTeleport') {
        let destination: Vec2 | null = null;
        if (this.controllerIsAI(source)) {
          const shadow = this.gs.shadows[0];
          if (shadow) destination = { x: shadow.x, y: shadow.y };
        } else {
          const point = await this.requestSubtargetPoint(source, {
            maxRange: Math.hypot(FIELD.w, FIELD.h),
            prompt: `${source.name}: choose a destination shadow (Esc to pass).`,
          });
          const shadow = point ? this.gs.shadowAt(point) : undefined;
          if (shadow) destination = { x: shadow.x, y: shadow.y };
        }
        return destination ? { t: 'weapon-action', x: destination.x, y: destination.y } : null;
      }
      return { t: 'weapon-action' };
    }
    if (optionId.startsWith('item-throw:')) {
      const itemId = optionId.slice('item-throw:'.length) as ItemId;
      const candidates = this.gs.mages.filter(
        (target) => target.team !== source.team && this.canThrowAt(source, target, itemId)
      );
      const target = await this.requestSubtargetCombatant(source, {
        candidates,
        range: Infinity,
        prompt: `${source.name}: choose a target for ${getItem(itemId).name}.`,
      });
      return target ? { t: 'item-throw', itemId, target: this.seatOf(target) } : null;
    }
    if (optionId.startsWith('item-use:')) {
      return { t: 'item-use', itemId: optionId.slice('item-use:'.length) };
    }
    if (optionId.startsWith('item-equip:')) {
      return { t: 'item-equip', itemId: optionId.slice('item-equip:'.length) };
    }
    if (optionId.startsWith('item-unequip:')) {
      return { t: 'item-unequip', itemId: optionId.slice('item-unequip:'.length) };
    }
    if (optionId.startsWith('item-drop:')) {
      return { t: 'item-drop', itemId: optionId.slice('item-drop:'.length) };
    }
    if (optionId.startsWith('item-pickup:')) {
      const dropId = Number(optionId.slice('item-pickup:'.length));
      return Number.isFinite(dropId) ? { t: 'item-pickup', dropId } : null;
    }

    switch (optionId) {
      case 'thunder-charge': return { t: 'thunder-charge' };
      case 'deaths-angel-wings': return { t: 'deaths-angel-wings' };
      case 'edgelord-shake': return { t: 'edgelord-shake' };
      case 'mantle-bind': return { t: 'mantle-bind' };
      case 'cleanse': return { t: 'cleanse' };
      default: return null;
    }
  }

  /** Open and stage one free bonus action after the avoided item leaves the stack. */
  private async offerDodgeBonusAction(source: Mage): Promise<void> {
    const options = this.dodgeBonusOptions(source);
    if (options.length === 0) {
      this.gs.log(`${source.name}'s perfect dodge finds no legal bonus action.`);
      return;
    }
    this.dodgeBonusActor = source;
    try {
      const optionId = await this.chooseDodgeBonusOption(source, options);
      if (!optionId) {
        this.gs.log(`${source.name} passes the perfect-dodge bonus window.`);
        return;
      }
      const cmd = await this.buildDodgeBonusCommand(source, optionId);
      if (!cmd) {
        this.gs.log(`${source.name} passes the perfect-dodge bonus window.`);
        return;
      }
      this.gs.log(`${source.name} turns the perfect dodge into a free bonus action!`);
      await this.applyTurnCommand(cmd, { actor: source, freeBonus: true, queueOnly: true });
    } finally {
      this.dodgeBonusMenu?.destroy();
      this.dodgeBonusMenu = undefined;
      this.dodgeBonusActor = null;
      this.mode = 'busy';
      this.redraw();
    }
  }

  /** Choose a shield block/bash during the reaction window. */
  private chooseShieldReaction(kind: 'block' | 'bash'): void {    if (!this.reactor || !this.reactionTop) return;
    if (kind === 'block') {
      if (!this.canBlock(this.reactor)) {
        this.flashHint('No shield raised to block with.');
        return;
      }
    } else if (!this.canBash(this.reactor, this.reactionTop)) {
      this.flashHint('No shield bash available (need an adjacent attacker).');
      return;
    }
    this.resolveReaction({ shield: kind });
  }

  private chooseWeaponReaction(): void {
    if (!this.reactor || !this.reactionTop) return;
    if (!this.canWeaponReact(this.reactor, this.reactionTop)) {
      // Explain the actual reason so it is not mistaken for a missing weapon.
      const r = this.reactor;
      const top = this.reactionTop;
      let why: string;
      if (!r.profile.whitePrimaryTier) {
        why = 'only white mages can strike back with a weapon.';
      } else if (r.weaponReactionsUsed >= MAX_WEAPON_REACTIONS) {
        why = 'no weapon reactions left this combat.';
      } else if (!top.source.alive) {
        why = 'the attacker is already down.';
      } else {
        why = 'the attacker is out of your weapon\u2019s reach.';
      }
      this.flashHint(`Can\u2019t counter with a weapon strike \u2014 ${why}`);
      return;
    }
    this.resolveReaction({ weapon: true });
  }

  private resolveReaction(choice: ReactionChoice | null): void {
    this.reactor = null;
    this.resetSelection();
    const r = this.reactionResolve;
    this.reactionResolve = null;
    if (r) r(choice);
  }

  /**
   * A reaction spell was picked. Self/none-targeted reactions resolve at once;
   * targeted reactions enter an aiming sub-mode so the reactor picks a target.
   */
  private onReactionChosen(reactor: Mage, spell: Spell, top: StackItem): void {
    if (spell.targeting === 'self' || spell.targeting === 'ally') {
      this.resolveReaction({ spell, target: reactor });
      return;
    }    if (spell.targeting === 'none') {
      this.resolveReaction({ spell });
      return;
    }

    // Targeted (enemy / point): let the reactor choose.
    this.reactionAiming = true;
    this.reactionPendingSpell = spell;
    this.reactionTop = top;
    this.aimingSource = reactor;
    this.mode = spell.targeting === 'point' ? 'aiming-point' : 'aiming-spell';
    this.flashHint(`${reactor.name}: choose a target for ${spell.name}  (Esc to go back).`, true);
    this.redraw();
  }

  private finishReactionAim(choice: ReactionChoice): void {
    this.reactionAiming = false;
    this.reactionPendingSpell = null;
    this.reactionTop = null;
    this.aimingSource = null;
    this.mode = 'busy';
    this.resolveReaction(choice);
  }

  // ===========================================================================
  //  INTERACTIVE SUB-TARGETING (mid-resolution)
  // ---------------------------------------------------------------------------
  //  A resolving spell can ask for extra targets. Because we are already past
  //  the spell's single reaction window, these prompts never grant the opponent
  //  another reaction.
  // ===========================================================================

  /** Ask `source` (player or AI) for an extra point within range during a cast. */
  private async requestSubtargetPoint(
    source: Mage,
    opts: SubTargetPointOpts
  ): Promise<Vec2 | null> {
    const origin = opts.origin ?? source.pos;
    if (this.controllerIsAI(source)) {
      const foe = this.gs.opponentOf(source);
      const reach = Math.max(opts.minRange ?? 0, Math.min(opts.maxRange, dist(origin, foe.pos)));
      return stepTowards(origin, foe.pos, reach);
    }
    // Online: the caster picks; the other peer waits for the relayed point.
    if (this.online && !this.isLocalDecider(source)) {
      return this.recvSubPoint();
    }
    // Reveal any dice already rolled so the player sees what they're reacting to.
    await this.playPendingDice();
    const value = await new Promise<Vec2 | null>((resolve) => {
      this.subtargetResolve = resolve as (v: Vec2 | Mage | null) => void;
      this.subtargetSource = source;
      this.subtargetOrigin = origin;
      this.subtargetRange = opts.maxRange;
      this.subtargetMinRange = opts.minRange ?? 0;
      this.subtargetCandidates = null;
      this.subtargetRequired = false;
      this.mode = 'subtarget-point';
      this.flashHint(opts.prompt ?? `${source.name}: pick a point  (Esc to skip).`, true);
      this.redraw();
    });
    if (this.online) this.sendSubPoint(value);
    return value;
  }

  /** Ask `source` (player or AI) for an extra enemy within range during a cast. */
  private async requestSubtargetEnemy(
    source: Mage,
    opts: SubTargetEnemyOpts
  ): Promise<Mage | null> {
    const origin = opts.origin ?? source.pos;
    if (this.controllerIsAI(source)) {
      const foe = this.gs.opponentOf(source);
      const reachable =
        foe.alive && !this.gs.isUntargetable(foe, source) && dist(origin, foe.pos) <= opts.range;
      return reachable ? foe : null;
    }
    if (this.online && !this.isLocalDecider(source)) {
      return this.recvSubEnemy();
    }
    await this.playPendingDice();
    const value = await new Promise<Mage | null>((resolve) => {
      this.subtargetResolve = resolve as (v: Vec2 | Mage | null) => void;
      this.subtargetSource = source;
      this.subtargetOrigin = origin;
      this.subtargetRange = opts.range;
      this.subtargetMinRange = 0;
      this.subtargetCandidates = null;
      this.subtargetRequired = false;
      this.mode = 'subtarget-enemy';
      this.flashHint(opts.prompt ?? `${source.name}: pick an enemy  (Esc to skip).`, true);
      this.redraw();
    });
    if (this.online) this.sendSubEnemy(value);
    return value;
  }

  /** Ask the acting player for a compulsory pick from an explicit combatant set. */
  private async requestSubtargetCombatant(
    source: Mage,
    opts: SubTargetCombatantOpts
  ): Promise<Mage | null> {
    const origin = opts.origin ?? source.pos;
    const candidates = opts.candidates.filter(
      (candidate) => candidate.alive && dist(origin, candidate.pos) <= opts.range
    );
    if (candidates.length === 0) return null;
    if (this.controllerIsAI(source)) return candidates[0];
    if (this.online && !this.isLocalDecider(source)) {
      const picked = await this.recvSubEnemy();
      return picked && candidates.includes(picked) ? picked : candidates[0];
    }
    await this.playPendingDice();
    const value = await new Promise<Mage | null>((resolve) => {
      this.subtargetResolve = resolve as (v: Vec2 | Mage | null) => void;
      this.subtargetSource = source;
      this.subtargetOrigin = origin;
      this.subtargetRange = opts.range;
      this.subtargetMinRange = 0;
      this.subtargetCandidates = new Set(candidates);
      this.subtargetRequired = true;
      this.mode = 'subtarget-enemy';
      this.flashHint(opts.prompt ?? `${source.name}: choose the next lightning arc.`, true);
      this.redraw();
    });
    if (this.online) this.sendSubEnemy(value);
    return value;
  }

  private canPickSubtargetMage(target: Mage): boolean {
    const source = this.subtargetSource ?? this.gs.current;
    const origin = this.subtargetOrigin ?? source.pos;
    if (!target.alive || dist(origin, target.pos) > this.subtargetRange) return false;
    if (this.subtargetCandidates) return this.subtargetCandidates.has(target);
    return target.team !== source.team && !this.gs.isUntargetable(target, source);
  }

  /** Settle the pending sub-target promise and return to the busy resolution. */
  private finishSubtarget(value: Vec2 | Mage | null): void {
    const r = this.subtargetResolve;
    this.subtargetResolve = null;
    this.subtargetSource = null;
    this.subtargetOrigin = null;
    this.subtargetRange = 0;
    this.subtargetMinRange = 0;
    this.subtargetCandidates = null;
    this.subtargetRequired = false;
    this.mode = 'busy';
    this.flashHint('', true);
    this.redraw();
    if (r) r(value);
  }

  // ===========================================================================
  //  RENDERING
  // ===========================================================================

  private addWorkshopChip(
    container: Phaser.GameObjects.Container,
    widgets: Phaser.GameObjects.GameObject[],
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    color: string,
    background: string,
  ): CabinetChip {
    const normalized = background.toLowerCase();
    const danger = normalized === '#3a1a1a' || normalized === '#4a1a1a';
    const positive = normalized === '#20342b';
    const selected = positive || normalized === '#3a281b' || normalized === '#2f2734';
    const suppliedAccent = /^#[0-9a-f]{6}$/i.test(color)
      ? Phaser.Display.Color.HexStringToColor(color).color
      : MENU_COLOR.brass;
    const accent = danger
      ? MENU_COLOR.blood
      : normalized === '#2f2734'
        ? MENU_COLOR.amethyst
        : selected
          ? MENU_COLOR.verdigris
          : color === '#ffd27a'
            ? MENU_COLOR.brassLight
            : suppliedAccent;
    const width = Phaser.Math.Clamp(Math.ceil(label.length * 7.1) + 24, 48, 220);
    const chip = new CabinetChip(this, x, y, {
      width,
      height: 28,
      label,
      accent,
      selected,
      tone: danger ? 'danger' : positive ? 'positive' : 'normal',
      onActivate: onClick,
    });
    this.workshopFocus.add(chip);
    container.add(chip);
    widgets.push(chip);
    return chip;
  }

  private buildStaticGraphics(): void {
    this.gfxStatic = this.add.graphics();
    const g = this.gfxStatic;
    const theme = this.arenaTheme();
    g.fillStyle(MENU_COLOR.pitch, 1).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    g.fillStyle(theme.floor, 1).fillRect(FIELD.x, FIELD.y, FIELD.w, FIELD.h);
    for (let x = FIELD.x; x < FIELD.x + FIELD.w; x += 60) {
      for (let y = FIELD.y; y < FIELD.y + FIELD.h; y += 60) {
        if (((x - FIELD.x) / 60 + (y - FIELD.y) / 60) % 2 === 0) {
          g.fillStyle(theme.tile, 0.3).fillRect(x, y, 60, 60);
        }
      }
    }
    if (theme.kind !== 'swamp') this.drawArenaTerrain(g, theme);
    g.fillStyle(COLORS.team1, 0.055).fillRect(FIELD.x, FIELD.y, FIELD.w * 0.22, FIELD.h);
    g.fillStyle(COLORS.team2, 0.055).fillRect(FIELD.x + FIELD.w * 0.78, FIELD.y, FIELD.w * 0.22, FIELD.h);
    g.lineStyle(1, theme.grid, 0.26);
    for (let x = FIELD.x; x <= FIELD.x + FIELD.w; x += 60) g.lineBetween(x, FIELD.y, x, FIELD.y + FIELD.h);
    for (let y = FIELD.y; y <= FIELD.y + FIELD.h; y += 60) g.lineBetween(FIELD.x, y, FIELD.x + FIELD.w, y);

    const centerX = FIELD.x + FIELD.w / 2;
    const centerY = FIELD.y + FIELD.h / 2;
    g.lineStyle(1, theme.accent, 0.3).strokeCircle(centerX, centerY, 82);
    g.lineStyle(2, theme.grid, 0.34).strokeCircle(centerX, centerY, 58);
    g.lineStyle(1, theme.grid, 0.3).lineBetween(centerX - 112, centerY, centerX + 112, centerY);
    g.lineBetween(centerX, centerY - 112, centerX, centerY + 112);
    g.lineStyle(4, MENU_COLOR.woodEdge, 1).strokeRect(FIELD.x, FIELD.y, FIELD.w, FIELD.h);
    g.lineStyle(1, MENU_COLOR.brass, 0.65).strokeRect(FIELD.x + 5, FIELD.y + 5, FIELD.w - 10, FIELD.h - 10);

    const corner = 28;
    g.lineStyle(4, COLORS.selected, 0.9);
    g.lineBetween(FIELD.x, FIELD.y + corner, FIELD.x, FIELD.y);
    g.lineBetween(FIELD.x, FIELD.y, FIELD.x + corner, FIELD.y);
    g.lineBetween(FIELD.x + FIELD.w - corner, FIELD.y, FIELD.x + FIELD.w, FIELD.y);
    g.lineBetween(FIELD.x + FIELD.w, FIELD.y, FIELD.x + FIELD.w, FIELD.y + corner);
    g.lineBetween(FIELD.x, FIELD.y + FIELD.h - corner, FIELD.x, FIELD.y + FIELD.h);
    g.lineBetween(FIELD.x, FIELD.y + FIELD.h, FIELD.x + corner, FIELD.y + FIELD.h);
    g.lineBetween(FIELD.x + FIELD.w - corner, FIELD.y + FIELD.h, FIELD.x + FIELD.w, FIELD.y + FIELD.h);
    g.lineBetween(FIELD.x + FIELD.w, FIELD.y + FIELD.h - corner, FIELD.x + FIELD.w, FIELD.y + FIELD.h);

    g.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(0, 0, GAME_WIDTH, TOP_BAR.h);
    g.lineStyle(1, MENU_COLOR.brassDark, 1).lineBetween(0, TOP_BAR.h, GAME_WIDTH, TOP_BAR.h);
    g.fillStyle(MENU_COLOR.brass, 1).fillRect(0, TOP_BAR.h - 3, 96, 3);
    g.lineStyle(1, MENU_COLOR.woodEdge, 0.85);
    for (const x of [TOP_ACTIONS.x - 10, TOP_RUN.x - 10, TOP_TOGGLES.x - 10]) {
      g.lineBetween(x, 8, x, TOP_BAR.h - 9);
    }

    drawCabinetPanel(g, DOCK_VITALS, { accent: COLORS.hp });
    drawCabinetPanel(g, DOCK_SPELL, { accent: MENU_COLOR.brass });
    drawCabinetPanel(g, DOCK_LOG, { accent: MENU_COLOR.amethyst });
    drawCabinetPanel(g, HINT_BAR, { accent: MENU_COLOR.brass, fill: MENU_COLOR.woodDeep });

    if (theme.kind === 'swamp') {
      this.swampArena = new SwampArenaView(this, FIELD, this.reducedMotion);
      this.swampArena.setCombatSpeed(this.combatSpeed);
    }
    this.gfxArenaAmbient = this.add.graphics();
    this.drawArenaAmbient(0);
    this.gfx = this.add.graphics();
    // Pulsing valid-target highlights live on their own layer, animated in update().
    this.gfxFx = this.add.graphics().setDepth(6);
    // Mine creature role, eye, and airborne markers sit above their body sprites.
    this.gfxMine = this.add.graphics().setDepth(6);
    // Scarab health pips, redrawn each frame to track their smoothed motion.
    this.gfxScarab = this.add.graphics().setDepth(7);
    // Targeting overlay drawn when hovering a stack token (line + reticle).
    this.hoverGfx = this.add.graphics().setDepth(8);
  }

  private arenaTheme(): ArenaTheme {
    if (this.arenaThemeCache) return this.arenaThemeCache;
    let theme: ArenaTheme;
    if (this.mineRun) {
      theme = {
        kind: 'mine',
        floor: 0x171817,
        tile: 0x292821,
        grid: 0x6b624d,
        accent: 0xb08452,
        shadow: 0x080908,
      };
    } else if (this.raid) {
      const accent = this.raidBoss === 'reaper'
        ? 0xa43d55
        : this.raidBoss === 'lich'
          ? 0x76558e
          : 0xa77a46;
      theme = {
        kind: 'raid',
        floor: 0x181315,
        tile: 0x2a1c20,
        grid: 0x70444d,
        accent,
        shadow: 0x080507,
      };
    } else if (this.swamprun) {
      theme = {
        kind: 'swamp',
        floor: 0x12221c,
        tile: 0x20372c,
        grid: 0x526b59,
        accent: 0x82946b,
        shadow: 0x07100d,
      };
    } else {
      theme = {
        kind: 'duel',
        floor: MENU_COLOR.felt,
        tile: MENU_COLOR.feltLight,
        grid: MENU_COLOR.brassDark,
        accent: MENU_COLOR.brass,
        shadow: MENU_COLOR.pitch,
      };
    }
    this.arenaThemeCache = theme;
    return theme;
  }

  private drawArenaTerrain(g: Phaser.GameObjects.Graphics, theme: ArenaTheme): void {
    const left = FIELD.x;
    const top = FIELD.y;
    const rightEdge = FIELD.x + FIELD.w;
    const bottomEdge = FIELD.y + FIELD.h;

    if (theme.kind === 'mine') {
      g.lineStyle(2, 0x4b4639, 0.46);
      for (let row = 0; row < 6; row++) {
        const y = top + 35 + row * 72;
        for (let column = 0; column < 8; column++) {
          const x = left + 24 + column * 164 + (row % 2) * 38;
          g.lineBetween(x, y, x + 94, y + (column % 3 - 1) * 8);
        }
      }
      g.lineStyle(3, theme.shadow, 0.68);
      for (let index = 0; index < 8; index++) {
        const x = left + 70 + ((index * 191) % (FIELD.w - 140));
        const y = top + 38 + ((index * 83) % (FIELD.h - 76));
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + 18, y + 14);
        g.lineTo(x + 7, y + 31);
        g.lineTo(x + 29, y + 47);
        g.strokePath();
      }
      g.lineStyle(2, theme.accent, 0.34);
      for (let index = 0; index < 5; index++) {
        const x = left + 46 + index * 284;
        const y = index % 2 === 0 ? top + 22 : bottomEdge - 22;
        const direction = index % 2 === 0 ? 1 : -1;
        g.lineBetween(x, y, x + 48, y + direction * 13);
        g.lineBetween(x + 15, y + direction * 4, x + 27, y + direction * 23);
      }
      return;
    }

    if (theme.kind === 'raid') {
      const centerX = left + FIELD.w / 2;
      const centerY = top + FIELD.h / 2;
      g.fillStyle(theme.shadow, 0.42).fillCircle(centerX, centerY, 132);
      g.lineStyle(2, theme.accent, 0.32).strokeCircle(centerX, centerY, 124);
      g.lineStyle(1, theme.accent, 0.24).strokeCircle(centerX, centerY, 102);
      for (let index = 0; index < 12; index++) {
        const angle = (index / 12) * Math.PI * 2;
        g.lineStyle(index % 3 === 0 ? 3 : 1, theme.accent, index % 3 === 0 ? 0.4 : 0.2);
        g.lineBetween(
          centerX + Math.cos(angle) * 86,
          centerY + Math.sin(angle) * 86,
          centerX + Math.cos(angle) * 122,
          centerY + Math.sin(angle) * 122,
        );
      }
      g.lineStyle(3, theme.shadow, 0.72);
      for (let index = 0; index < 6; index++) {
        const x = left + 90 + index * 215;
        const y = index % 2 === 0 ? top + 72 : bottomEdge - 68;
        const direction = index % 2 === 0 ? 1 : -1;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + 26, y + direction * 17);
        g.lineTo(x + 14, y + direction * 39);
        g.strokePath();
      }
      return;
    }

    g.lineStyle(1, 0xc0aa78, 0.1);
    for (let index = 0; index < 18; index++) {
      const x = left + 34 + ((index * 149) % (FIELD.w - 68));
      const y = top + 24 + ((index * 71) % (FIELD.h - 48));
      g.lineBetween(x, y, x + 18 + index % 13, y + (index % 5 - 2) * 2);
    }
  }

  private drawArenaAmbient(time: number): void {
    const g = this.gfxArenaAmbient;
    if (!g) return;
    g.clear();
    this.drawLowHealthVignette(time);
    const theme = this.arenaTheme();
    const phase = this.reducedMotion ? 0 : time;
    const centerX = FIELD.x + FIELD.w / 2;
    const centerY = FIELD.y + FIELD.h / 2;

    if (theme.kind === 'swamp') {
      return;
    }

    if (theme.kind === 'mine') {
      g.lineStyle(1, 0xd0b985, 0.15);
      for (let index = 0; index < 18; index++) {
        const x = FIELD.x + 18 + ((index * 137) % (FIELD.w - 36));
        const fall = (phase * (0.012 + (index % 4) * 0.003) + index * 49) % (FIELD.h - 20);
        const y = FIELD.y + 10 + fall;
        g.lineBetween(x, y, x - 3, y + 7 + index % 5);
      }
      return;
    }

    if (theme.kind === 'raid') {
      const pulse = this.reducedMotion ? 0.35 : 0.35 + Math.sin(phase / 430) * 0.15;
      g.lineStyle(2, theme.accent, pulse).strokeCircle(centerX, centerY, 126);
      g.lineStyle(1, theme.accent, pulse * 0.65).strokeCircle(centerX, centerY, 96);
      for (let index = 0; index < 4; index++) {
        const angle = phase / 1800 + index * Math.PI / 2;
        g.lineBetween(
          centerX + Math.cos(angle) * 106,
          centerY + Math.sin(angle) * 106,
          centerX + Math.cos(angle) * 122,
          centerY + Math.sin(angle) * 122,
        );
      }
      return;
    }

    const pulse = this.reducedMotion ? 0.12 : 0.12 + Math.sin(phase / 680) * 0.045;
    g.lineStyle(1, theme.accent, pulse).strokeCircle(centerX, centerY, 84);
  }

  /** A small uppercase caption used for dock panel headers. */
  private panelHeader(rect: { x: number; y: number }, label: string, color: string): void {
    this.add.text(rect.x + SPACE.sm, rect.y + 6, label, {
      fontFamily: MENU_FONT.control,
      fontSize: '11px',
      color,
      fontStyle: 'bold',
    });
  }

  private buildHud(): void {
    // ---- Top bar: whose turn it is, what they have left, and run state ----
    this.turnText = this.add
      .text(TOP_TURN.x, TOP_BAR.h / 2, '', {
        fontFamily: MENU_FONT.display,
        fontSize: '17px',
        color: MENU_HEX.bone,
        fontStyle: 'bold',
        fixedWidth: TOP_TURN.w,
        fixedHeight: TOP_BAR.h - 8,
        lineSpacing: 1,
      })
      .setOrigin(0, 0.5);
    this.actionText = this.add
      .text(TOP_ACTIONS.x, TOP_BAR.h / 2, '', {
        fontFamily: MENU_FONT.control,
        fontSize: '12px',
        color: MENU_HEX.boneDim,
        fixedWidth: TOP_ACTIONS.w,
      })
      .setOrigin(0, 0.5);

    // ---- Hint band: one line of guidance, plus the way into every action ----
    this.hintText = this.add
      .text(HINT_BAR.x + SPACE.md, centerY(HINT_BAR), '', {
        fontFamily: MENU_FONT.body,
        fontSize: FONT.body,
        color: MENU_HEX.bone,
        fixedWidth: HINT_BAR.w - 260,
      })
      .setOrigin(0, 0.5)
      .setDepth(44);

    this.actionMenuButton = this.add
      .text(right(HINT_BAR), centerY(HINT_BAR), '', {
        fontFamily: MENU_FONT.control,
        fontSize: '14px',
        color: MENU_HEX.ink,
        backgroundColor: MENU_HEX.brassLight,
        fontStyle: 'bold',
        align: 'center',
        fixedWidth: 232,
        padding: { x: 10, y: 5 },
      })
      .setOrigin(1, 0.5)
      .setDepth(46)
      .setInteractive({ useHandCursor: true });
    this.actionMenuButton.on('pointerover', () => this.actionMenuButton?.setBackgroundColor(MENU_HEX.bone));
    this.actionMenuButton.on('pointerout', () => this.actionMenuButton?.setBackgroundColor(MENU_HEX.brassLight));
    this.actionMenuButton.on('pointerdown', () => {
      if (this.mode === 'reaction') this.onReactionPass();
      else this.toggleActionMenu();
    });

    // ---- Dock column 1: vitals ----
    this.panelHeader(DOCK_VITALS, 'MAGE', MENU_HEX.verdigris);
    this.resourceGfx = this.add.graphics().setDepth(40).setVisible(false);
    for (let i = 0; i < 5; i++) {
      this.resourceLabels.push(
        this.add
          .text(0, 0, '', { fontFamily: MENU_FONT.control, fontSize: FONT.small, color: MENU_HEX.boneDim })
          .setDepth(41)
          .setVisible(false)
      );
      this.resourceValues.push(
        this.add
          .text(0, 0, '', { fontFamily: MENU_FONT.control, fontSize: FONT.small, color: MENU_HEX.bone })
          .setDepth(41)
          .setOrigin(1, 0)
          .setVisible(false)
      );
    }
    const vitals = panelBody(DOCK_VITALS);
    this.resourceText = this.add.text(vitals.x, vitals.y + 118, '', {
      fontFamily: MENU_FONT.body,
      fontSize: FONT.small,
      color: MENU_HEX.boneDim,
      wordWrap: { width: vitals.w },
      fixedWidth: vitals.w,
      fixedHeight: bottom(vitals) - (vitals.y + 118),
      lineSpacing: 2,
    });

    // ---- Dock column 2: the spell builder ----
    this.panelHeader(DOCK_SPELL, 'WORD RACK', MENU_HEX.brassLight);
    for (let i = 0; i < WORD_SLOTS; i++) {
      const slot = wordSlot(i);
      const plate = new WordPlate(this, slot.x, slot.y, {
        width: slot.w,
        height: slot.h,
        label: '',
        accent: MENU_COLOR.brass,
        onActivate: () => this.onWordKey(i),
      });
      this.wordPlates.push(plate);
    }
    const readout = spellReadout();
    this.comboText = this.add.text(readout.x, readout.y, '', {
      fontFamily: MENU_FONT.body,
      fontSize: FONT.small,
      color: MENU_HEX.boneDim,
      wordWrap: { width: readout.w },
      fixedWidth: readout.w,
      fixedHeight: readout.h,
      lineSpacing: 2,
    })
      .setInteractive({ useHandCursor: true });
    this.comboText.on('pointerover', () => {
      this.spellInfoHovered = true;
      this.redraw();
    });
    this.comboText.on('pointerout', () => {
      this.spellInfoHovered = false;
      this.redraw();
    });
    this.comboText.on('pointerdown', () => {
      if (!this.currentComboSpell()) return;
      this.spellInfoPinned = !this.spellInfoPinned;
      this.redraw();
    });

    // ---- Dock column 3: the log supplies its own clickable header ----

    // ---- Toggles, right-aligned in the top bar ----
    const chipW = 80;
    const chipGap = 6;
    const chipY = 11;
    this.autoPassButton = new CabinetChip(this, TOP_TOGGLES.x, chipY, {
      width: chipW,
      height: 30,
      label: '',
      onActivate: () => this.toggleAutoPass(),
    }).setDepth(46);
    this.spectateButton = new CabinetChip(this, TOP_TOGGLES.x + chipW + chipGap, chipY, {
      width: chipW,
      height: 30,
      label: '',
      enabled: !this.online,
      onActivate: () => this.toggleSpectate(),
    }).setDepth(46);
    this.combatSpeedButton = new CabinetChip(this, TOP_TOGGLES.x + (chipW + chipGap) * 2, chipY, {
      width: chipW,
      height: 30,
      label: '',
      onActivate: () => this.toggleCombatSpeed(),
    }).setDepth(46);
    this.refreshAutoPassButton();
    this.refreshSpectateButton();
    this.refreshCombatSpeedButton();

    // Docked, clickable list of every living foe (targets from anywhere).
    this.targetListPanel = this.add.container(0, 0).setDepth(48);
    this.refreshTargetList();

    // Scrollable window for the selected spell's full description.
    this.buildSpellInfoPanel();

    this.buildHistoryPanel();

    this.tooltip = this.add
      .text(0, 0, '', {
        fontFamily: MENU_FONT.body,
        fontSize: FONT.body,
        color: MENU_HEX.bone,
        backgroundColor: '#17110df2',
        padding: { x: 8, y: 6 },
        wordWrap: { width: 260 },
      })
      .setDepth(50)
      .setVisible(false);

    this.buildDevPanel();

    if (this.training) {
      this.add
        .text(FIELD.x + FIELD.w - 178, FIELD.y + 130, 'TRAINING LAB  [P]', {
          fontFamily: MENU_FONT.control,
          fontSize: '12px',
          color: MENU_HEX.brassLight,
          backgroundColor: '#17110df2',
          padding: { x: 6, y: 3 },
        })
        .setDepth(60);
    }
  }

  /**
   * Build the dedicated, filterable combat-history panel. It sits in its own
   * bordered box on the right of the HUD (so nothing overlaps it) and can be
   * clicked to expand into a large overlay for reading the full log.
   */
  private buildHistoryPanel(): void {
    this.historyDim = this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, MENU_COLOR.pitch, 0.86)
      .setOrigin(0, 0)
      .setDepth(69)
      .setVisible(false)
      .setInteractive();
    this.historyDim.on('pointerdown', () => {
      this.historyExpanded = false;
      this.layoutHistoryPanel();
      this.drawLog();
    });
    this.historyPanel = this.add.container(0, 0).setDepth(45);
    this.historyBg = this.add
      .rectangle(0, 0, 10, 10, MENU_COLOR.woodDeep, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(2, MENU_COLOR.brassDark);
    this.historyTitle = this.add
      .text(10, 6, '', {
        fontFamily: MENU_FONT.display,
        fontSize: '14px',
        color: MENU_HEX.brassLight,
        fontStyle: 'bold',
      })
      .setInteractive({ useHandCursor: true });
    this.historyTitle.on('pointerdown', () => {
      this.historyExpanded = !this.historyExpanded;
      this.layoutHistoryPanel();
      this.drawLog();
    });

    const defs: { cat: 'cast' | 'roll' | 'event'; label: string }[] = [
      { cat: 'cast', label: 'Casts/fails' },
      { cat: 'roll', label: 'Rolls' },
      { cat: 'event', label: 'Damage/events' },
    ];
    this.historyToggleControls = defs.map((d) => {
      const control = new CabinetChip(this, 0, 0, {
        width: d.cat === 'event' ? 116 : 86,
        height: 22,
        label: d.label,
        selected: this.historyFilters[d.cat],
        onActivate: () => {
          this.historyFilters[d.cat] = !this.historyFilters[d.cat];
          this.refreshHistoryToggles();
          this.drawLog();
        },
      });
      return { cat: d.cat, control };
    });

    this.logText = this.add.text(0, 0, '', {
      fontFamily: MENU_FONT.body,
      fontSize: FONT.small,
      color: MENU_HEX.boneDim,
      wordWrap: { width: DOCK_LOG.w - SPACE.sm * 2 },
      lineSpacing: 3,
    });

    this.historyPanel.add([
      this.historyBg,
      this.historyTitle,
      ...this.historyToggleControls.map((t) => t.control),
      this.logText,
    ]);
    this.layoutHistoryPanel();
    this.refreshHistoryToggles();
  }

  /** Position and size the history panel for its current (collapsed/expanded) mode. */
  private layoutHistoryPanel(): void {
    const expanded = this.historyExpanded;
    const w = expanded ? 760 : DOCK_LOG.w;
    const h = expanded ? 540 : DOCK_LOG.h;
    const px = expanded ? Math.round((GAME_WIDTH - w) / 2) : DOCK_LOG.x;
    const py = expanded ? 80 : DOCK_LOG.y;
    this.historyPanel.setPosition(px, py).setDepth(expanded ? 70 : 45);
    this.historyDim.setVisible(expanded);
    // Docked, the column panel is already painted behind it.
    this.historyBg.setSize(w, h).setVisible(expanded);
    this.historyTitle
      .setText(expanded ? 'COMBAT RECORD  ·  CLOSE' : 'COMBAT RECORD')
      .setPosition(SPACE.sm, 6)
      .setFontSize(expanded ? 18 : 12);

    let tx = SPACE.sm;
    const toggleY = expanded ? 34 : 24;
    for (const t of this.historyToggleControls) {
      t.control.setPosition(tx, toggleY);
      tx += t.control.width + SPACE.sm;
    }
    const logY = expanded ? 64 : 52;
    this.logText.setPosition(SPACE.sm, logY);
    this.logText.setWordWrapWidth(w - SPACE.sm * 2);
    this.logText.setFixedSize(w - SPACE.sm * 2, h - logY - SPACE.sm);
    this.logText.setFontSize(expanded ? 15 : 12);
  }

  /** Refresh the filter-toggle labels/colours to match their on/off state. */
  private refreshHistoryToggles(): void {
    for (const t of this.historyToggleControls) {
      const on = this.historyFilters[t.cat];
      const label = t.cat === 'cast' ? 'CASTS' : t.cat === 'roll' ? 'ROLLS' : 'EVENTS';
      t.control.setLabel(label);
      t.control.setSelected(on);
    }
    let tx = SPACE.sm;
    const toggleY = this.historyExpanded ? 34 : 24;
    for (const t of this.historyToggleControls) {
      t.control.setPosition(tx, toggleY);
      tx += t.control.width + SPACE.sm;
    }
  }

  /** Bucket a log line into one of the three history categories. */
  private logCategory(text: string): 'cast' | 'roll' | 'event' {
    if (/vs DC|counters |fizzles|no valid target|compelled|erupts instead|cannot act/i.test(text)) {
      return 'cast';
    }
    if (/\brolls\b/i.test(text)) return 'roll';
    return 'event';
  }

  /** Build the top-right dev cheat panel with clickable toggles. */
  private buildDevPanel(): void {
    const px = FIELD.x + 8;
    const py = FIELD.y + 8;
    this.devPanel = this.add.container(px, py).setDepth(60).setVisible(false);
    const bg = this.add
      .rectangle(0, 0, 196, 204, MENU_COLOR.woodDeep, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(2, MENU_COLOR.brassDark);
    const inner = this.add
      .rectangle(6, 6, 184, 192, MENU_COLOR.charcoal, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(1, MENU_COLOR.woodEdge);
    const title = this.add.text(12, 9, 'DEV CONSOLE', {
      fontFamily: MENU_FONT.display,
      fontSize: '14px',
      color: MENU_HEX.brassLight,
      fontStyle: 'bold',
    });
    const defs: { key: DevToggle; label: string; hot: string }[] = [
      { key: 'autoSuccess', label: 'Auto-success', hot: 'F1' },
      { key: 'infiniteMove', label: 'Infinite move', hot: 'F2' },
      { key: 'infiniteActions', label: 'Infinite actions', hot: 'F3' },
      { key: 'aiPassive', label: 'AI passive', hot: 'F4' },
      { key: 'skipDice', label: 'Skip dice', hot: 'F5' },
    ];
    this.devToggles = defs.map((d, i) => {
      const control = new CabinetChip(this, 10, 34 + i * 28, {
        width: 176,
        height: 24,
        label: '',
        onActivate: () => {
          this.devClickGuard = true;
          this.toggleDev(d.key);
        },
      });
      return { ...d, control };
    });
    const resources = new CabinetChip(this, 10, 34 + defs.length * 28, {
      width: 176,
      height: 24,
      label: '[F6] RESOURCE EDITOR',
      accent: MENU_COLOR.amethyst,
      onActivate: () => {
        this.devClickGuard = true;
        this.toggleDevResources();
      },
    });
    this.devPanel.add([bg, inner, title, ...this.devToggles.map((d) => d.control), resources]);
    this.refreshDevPanel();
  }

  /** Update the dev panel labels/colours to match the current toggle state. */
  private refreshDevPanel(): void {
    for (const d of this.devToggles) {
      const on = Dev[d.key];
      d.control.setLabel(`[${d.hot}] ${d.label}: ${on ? 'ON' : 'OFF'}`);
      d.control.setSelected(on);
    }
  }

  // ─── Dev resource editor ─────────────────────────────────────────────────

  /** Open / close the cheat overlay that edits any entity's live resources. */
  private toggleDevResources(): void {
    if (this.mode === 'dev-resources') {
      this.closeDevResources();
      return;
    }
    const blocked: InputMode[] = [
      'assign',
      'shop',
      'over',
      'action-menu',
      'inventory',
      'training',
      'eldritch-menu',
      'thunder-menu',
    ];
    if (blocked.includes(this.mode)) return;
    if (!this.devResPanel) {
      const panel = this.add.container(0, 0).setDepth(97).setVisible(false);
      addCabinetWindow(this, panel, {
        width: 1000,
        height: 660,
        title: 'RESOURCE EDITOR',
        subtitle: 'Cheat: set any entity\u2019s vitals, charges, actions and stacks',
        accent: MENU_COLOR.amethyst,
      });
      this.devResPanel = panel;
    }
    // Never restore a transient mode (aiming / busy): the game loop owns those.
    this.devResReturn = this.mode === 'reaction' ? 'reaction' : 'idle';
    this.mode = 'dev-resources';
    this.devResPanel.setVisible(true);
    this.refreshDevResources();
    this.redraw();
  }

  private closeDevResources(): void {
    this.devResPanel?.setVisible(false);
    if (this.mode === 'dev-resources') this.mode = this.devResReturn;
    this.redraw();
  }

  private devResButton(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    color: string = MENU_HEX.bone,
    bg: string = '#1a1d18',
  ): CabinetChip {
    return this.addWorkshopChip(this.devResPanel!, this.devResWidgets, x, y, label, onClick, color, bg);
  }

  private devResLabel(x: number, y: number, text: string, color?: string): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, text, {
      fontFamily: MENU_FONT.body,
      fontSize: '14px',
      color: color ?? MENU_HEX.bone,
    });
    this.devResPanel!.add(t);
    this.devResWidgets.push(t);
    return t;
  }

  private refreshDevResources(): void {
    if (!this.devResPanel) return;
    this.workshopFocus.clear();
    for (const w of this.devResWidgets) w.destroy();
    this.devResWidgets = [];
    const entities = this.gs.mages;
    if (entities.length === 0) return;
    this.devResIndex = Phaser.Math.Clamp(this.devResIndex, 0, entities.length - 1);
    const t = entities[this.devResIndex];

    const left = GAME_WIDTH / 2 - 475;
    const right = GAME_WIDTH / 2 + 15;
    const top = GAME_HEIGHT / 2 - 262;

    // Entity picker: every mage, summon and creature currently on the field.
    this.devResLabel(left, top, 'Entity:');
    let px = left + 62;
    let py = top - 4;
    entities.forEach((m, i) => {
      const on = i === this.devResIndex;
      const label = `${m.name}${m.isSummon ? ' *' : ''}${m.alive ? '' : ' †'}`;
      if (px > GAME_WIDTH / 2 + 360) {
        px = left + 62;
        py += 28;
      }
      const b = this.devResButton(
        px,
        py,
        label,
        () => {
          this.devResIndex = i;
          this.refreshDevResources();
        },
        on ? MENU_HEX.verdigris : MENU_HEX.bone,
        on ? '#3a281b' : '#1a1d18',
      );
      px += b.width + 8;
    });

    const rows = { left: py + 48, right: py + 48 };
    const row = (
      col: 'left' | 'right',
      label: string,
      value: string,
      steps: [number, string][],
      apply: (delta: number) => void,
    ): void => {
      const x = col === 'left' ? left : right;
      const y = rows[col];
      this.devResLabel(x, y, `${label}: ${value}`);
      let bx = x + 250;
      for (const [delta, text] of steps) {
        const b = this.devResButton(bx, y - 4, text, () => {
          apply(delta);
          this.refreshDevResources();
          this.redraw();
        });
        bx += b.width + 6;
      }
      rows[col] += 32;
    };

    const BIG = 999999;
    const pool = (
      label: string,
      cur: number,
      max: number,
      set: (value: number) => void,
      floor = 0,
    ): void => {
      row(
        'left',
        label,
        `${cur} / ${max}`,
        [
          [-5, '-5'],
          [-1, '-1'],
          [1, '+1'],
          [5, '+5'],
          [BIG, 'Max'],
        ],
        (d) => set(Phaser.Math.Clamp(cur + d, floor, max)),
      );
    };

    pool('HP', t.hp, t.maxHp, (v) => (t.hp = v), t.unkillable ? 1 : 0);
    pool('Mana', t.mana, t.maxMana, (v) => (t.mana = v));
    pool('Sanity', t.sanity, t.maxSanity, (v) => (t.sanity = v));
    pool('Luck', t.luck, t.maxLuck, (v) => (t.luck = v));
    pool('Color charges', t.colorCharges, t.maxColorCharges, (v) => (t.colorCharges = v));
    const wordTotal = t.loadout.reduce((sum, w) => sum + (t.charges[w] ?? 0), 0);
    const wordMax = t.loadout.reduce((sum, w) => sum + t.maxWordCharges(w), 0);
    row(
      'left',
      'Word charges (all)',
      `${wordTotal} / ${wordMax}`,
      [
        [-1, '-1'],
        [1, '+1'],
        [BIG, 'Max'],
      ],
      (d) => {
        for (const w of t.loadout) {
          const max = t.maxWordCharges(w);
          t.charges[w] = Phaser.Math.Clamp((t.charges[w] ?? 0) + d, 0, max);
        }
      },
    );

    const action = (label: string, key: 'move' | 'main' | 'bonus'): void => {
      row(
        'right',
        label,
        `${t.actions[key]}`,
        [
          [-1, '-1'],
          [1, '+1'],
          [ACTIONS_PER_TURN[key] - t.actions[key], 'Reset'],
        ],
        (d) => (t.actions[key] = Math.max(0, t.actions[key] + d)),
      );
    };
    action('Move actions', 'move');
    action('Main actions', 'main');
    action('Bonus actions', 'bonus');

    const stack = (label: string, get: () => number, set: (value: number) => void): void => {
      row(
        'right',
        label,
        `${get()}`,
        [
          [-5, '-5'],
          [-1, '-1'],
          [1, '+1'],
          [5, '+5'],
          [-BIG, 'Clear'],
        ],
        (d) => set(Math.max(0, get() + d)),
      );
    };
    const toggle = (col: 'left' | 'right', label: string, get: () => boolean, set: (value: boolean) => void): void => {
      const x = col === 'left' ? left : right;
      const y = rows[col];
      const on = get();
      this.devResLabel(x, y, `${label}: ${on ? 'yes' : 'no'}`);
      this.devResButton(
        x + 250,
        y - 4,
        on ? 'Turn off' : 'Turn on',
        () => {
          set(!on);
          this.refreshDevResources();
          this.redraw();
        },
        on ? MENU_HEX.verdigris : MENU_HEX.bone,
        on ? '#20342b' : '#1a1d18',
      );
      rows[col] += 32;
    };

    stack('Thunder stacks', () => t.thunderStacks, (v) => (t.thunderStacks = v));
    stack('Greed stacks', () => t.greedStacks, (v) => (t.greedStacks = v));
    stack('Momentum stacks', () => t.momentumStacks, (v) => (t.momentumStacks = v));
    stack('Anchor stacks', () => t.anchorStacks, (v) => (t.anchorStacks = v));

    // Reactions: the shared once-per-cycle reaction plus each capped budget.
    row(
      'left',
      'Dodges left',
      `${t.dodgesRemaining} / ${t.maxDodges()}`,
      [
        [-1, '-1'],
        [1, '+1'],
        [BIG, 'Max'],
      ],
      (d) => (t.dodgesRemaining = Phaser.Math.Clamp(t.dodgesRemaining + d, 0, t.maxDodges())),
    );
    row(
      'left',
      'Word-spell reactions used',
      `${t.wordSpellReactionsUsed} / ${MAX_WORD_SPELL_REACTIONS}`,
      [
        [-1, '-1'],
        [1, '+1'],
        [-BIG, 'Clear'],
      ],
      (d) =>
        (t.wordSpellReactionsUsed = Phaser.Math.Clamp(
          t.wordSpellReactionsUsed + d,
          0,
          MAX_WORD_SPELL_REACTIONS,
        )),
    );
    row(
      'left',
      'Weapon reactions used',
      `${t.weaponReactionsUsed} / ${MAX_WEAPON_REACTIONS}`,
      [
        [-1, '-1'],
        [1, '+1'],
        [-BIG, 'Clear'],
      ],
      (d) =>
        (t.weaponReactionsUsed = Phaser.Math.Clamp(t.weaponReactionsUsed + d, 0, MAX_WEAPON_REACTIONS)),
    );
    toggle('right', 'Reaction available', () => t.reactionAvailable, (v) => (t.reactionAvailable = v));
    toggle('right', 'Reacted this cycle', () => t.reactedThisCycle, (v) => (t.reactedThisCycle = v));

    const bottom = Math.max(rows.left, rows.right) + 10;
    this.devResButton(
      left,
      bottom,
      'Refill everything',
      () => {
        t.hp = t.maxHp;
        t.mana = t.maxMana;
        t.sanity = t.maxSanity;
        t.luck = t.maxLuck;
        t.colorCharges = t.maxColorCharges;
        t.actions = { ...ACTIONS_PER_TURN };
        for (const w of t.loadout) t.charges[w] = t.maxWordCharges(w);
        t.resetDodges();
        t.wordSpellReactionsUsed = 0;
        t.weaponReactionsUsed = 0;
        t.reactedThisCycle = false;
        t.reactionAvailable = t.canEverReact;
        this.refreshDevResources();
        this.redraw();
      },
      MENU_HEX.verdigris,
      '#20342b',
    );
    this.devResButton(
      left + 160,
      bottom,
      'Clear statuses',
      () => {
        t.statuses = [];
        this.refreshDevResources();
        this.redraw();
      },
      '#ffd27a',
      '#4a3a1a',
    );
    this.devResButton(
      left + 300,
      bottom,
      'Close [F6]',
      () => this.closeDevResources(),
      '#ff9a9a',
      '#4a1a1a',
    );
    this.devResLabel(left, bottom + 40, '* summon   † dead', TEXT.dim);
  }

  // ─── Scenario Lab (build & save a fight) ─────────────────────────────────

  /** Open / close the Scenario Lab. Also available in Memory mode for tweaks. */
  private toggleScenarioLab(): void {
    if (!this.scenarioLab && !this.memoryMode) return;
    if (this.mode === 'scenario-lab') {
      this.closeScenarioLab();
      return;
    }
    if (this.mode !== 'idle') return;
    if (!this.scenarioPanel) {
      const panel = this.add.container(0, 0).setDepth(96).setVisible(false);
      const chrome = addCabinetWindow(this, panel, {
        width: 980,
        height: 660,
        title: 'SCENARIO LAB',
        subtitle: 'Place entities, kit them out, then save or load the fight as a memory file',
        accent: MENU_COLOR.amethyst,
      });
      this.scenarioTitle = chrome.title;
      this.scenarioPanel = panel;
    }
    this.scenarioPage = 'roster';
    // Presets live in localStorage, so pick up anything saved since last time.
    this.creativePresets = loadCreativePresets();
    this.mode = 'scenario-lab';
    this.scenarioPanel.setVisible(true);
    this.refreshScenarioLab();
    this.redraw();
  }

  private closeScenarioLab(): void {
    this.scenarioPanel?.setVisible(false);
    if (this.mode === 'scenario-lab') this.mode = 'idle';
    this.redraw();
  }

  private scenarioButton(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    color: string = MENU_HEX.bone,
    bg: string = '#1a1d18',
  ): CabinetChip {
    return this.addWorkshopChip(this.scenarioPanel!, this.scenarioWidgets, x, y, label, onClick, color, bg);
  }

  private scenarioLabel(x: number, y: number, text: string, color?: string): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, text, {
      fontFamily: MENU_FONT.body,
      fontSize: '14px',
      color: color ?? MENU_HEX.bone,
    });
    this.scenarioPanel!.add(t);
    this.scenarioWidgets.push(t);
    return t;
  }

  private refreshScenarioLab(): void {
    if (!this.scenarioPanel) return;
    this.workshopFocus.clear();
    for (const w of this.scenarioWidgets) w.destroy();
    this.scenarioWidgets = [];
    const left = GAME_WIDTH / 2 - 465;
    const top = GAME_HEIGHT / 2 - 262;

    // Page tabs.
    let tx = left;
    const tabs: [typeof this.scenarioPage, string][] = [
      ['roster', 'Roster'],
      ['spawn', 'Place'],
      ['stats', 'Stats'],
      ['words', 'Words'],
      ['gear', 'Gear'],
    ];
    for (const [page, label] of tabs) {
      const on = this.scenarioPage === page;
      const b = this.scenarioButton(
        tx,
        top,
        label,
        () => {
          this.scenarioPage = page;
          this.refreshScenarioLab();
        },
        on ? MENU_HEX.verdigris : MENU_HEX.bone,
        on ? '#3a281b' : '#1a1d18',
      );
      tx += b.width + 8;
    }
    let ax = tx + 16;
    const save = this.scenarioButton(ax, top, 'Save', () => this.saveScenarioFile(), MENU_HEX.verdigris, '#20342b');
    ax += save.width + 8;
    const load = this.scenarioButton(ax, top, 'Load', () => void this.loadScenarioFile(), '#9f8bad', '#2f2734');
    ax += load.width + 8;
    const live = !this.gs.victorySuspended;
    this.scenarioButton(
      ax,
      top,
      `Victory: ${live ? 'ON' : 'off'}`,
      () => {
        this.gs.victorySuspended = live;
        this.refreshScenarioLab();
        this.redraw();
      },
      live ? MENU_HEX.verdigris : '#ffd27a',
      live ? '#20342b' : '#4a3a1a',
    );
    this.scenarioButton(
      GAME_WIDTH / 2 + 380,
      top,
      'Close [P]',
      () => this.closeScenarioLab(),
      '#ff9a9a',
      '#4a1a1a',
    );

    if (this.scenarioPage === 'spawn') this.refreshScenarioSpawn(left, top + 44);
    else if (this.scenarioPage === 'stats') this.refreshScenarioStats(left, top + 44);
    else if (this.scenarioPage === 'words') this.refreshScenarioWords(left, top + 44);
    else if (this.scenarioPage === 'gear') this.refreshScenarioGear(left, top + 44);
    else this.refreshScenarioRoster(left, top + 44);
  }

  /**
   * The shared "which entity am I editing" picker used by the stats, words and
   * gear pages. Returns the target and the y to continue laying out from.
   */
  private scenarioTargetRow(left: number, top: number): { target?: Mage; y: number } {
    const target = this.gs.mages[this.scenarioTargetIndex] ?? this.gs.mages[0];
    if (!target) return { y: top };
    this.scenarioLabel(left, top, 'Editing:');
    let bx = left + 80;
    let by = top - 4;
    this.gs.mages.forEach((m, i) => {
      if (bx > GAME_WIDTH / 2 + 340) {
        bx = left + 80;
        by += 28;
      }
      const on = m === target;
      const b = this.scenarioButton(
        bx,
        by,
        m.name,
        () => {
          this.scenarioTargetIndex = i;
          this.refreshScenarioLab();
        },
        on ? MENU_HEX.verdigris : MENU_HEX.bone,
        on ? '#3a281b' : '#1a1d18',
      );
      bx += b.width + 6;
    });
    return { target, y: by + 40 };
  }

  private refreshScenarioStats(left: number, top: number): void {
    const { target: t, y: rowY } = this.scenarioTargetRow(left, top);
    if (!t) return;
    this.scenarioTitle!.setText(`SCENARIO LAB — STATS: ${t.name}`);
    let y = rowY;
    const stat = (label: string, get: () => number, set: (value: number) => void): void => {
      this.scenarioLabel(left, y, `${label}: ${get()}`);
      let bx = left + 200;
      for (const [delta, text] of [
        [-5, '-5'],
        [-1, '-1'],
        [1, '+1'],
        [5, '+5'],
      ] as [number, string][]) {
        const b = this.scenarioButton(bx, y - 4, text, () => {
          set(get() + delta);
          this.refreshScenarioLab();
          this.redraw();
        });
        bx += b.width + 6;
      }
      y += 32;
    };
    const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
    stat('Strength', () => t.statStrength, (v) => (t.statStrength = clamp(v, 0, 999)));
    stat('Dexterity', () => t.statDex, (v) => (t.statDex = clamp(v, 0, 999)));
    stat('Intellect', () => t.statInt, (v) => (t.statInt = clamp(v, 0, 999)));
    stat('Max HP', () => t.maxHp, (v) => {
      t.maxHp = clamp(v, 1, 9999);
      t.hp = Math.min(t.hp, t.maxHp);
    });
    stat('Max mana', () => t.maxMana, (v) => {
      t.maxMana = clamp(v, 0, 9999);
      t.mana = Math.min(t.mana, t.maxMana);
    });
    stat('Max sanity', () => t.maxSanity, (v) => {
      t.maxSanity = clamp(v, 1, 9999);
      t.sanity = Math.min(t.sanity, t.maxSanity);
    });
    stat('Max luck', () => t.maxLuck, (v) => {
      t.maxLuck = clamp(v, 0, 999);
      t.luck = Math.min(t.luck, t.maxLuck);
    });
    y += 8;

    this.scenarioLabel(left, y, 'Class:');
    let bx = left + 80;
    for (const cls of MAGE_CLASSES) {
      const on = t.mageClass === cls;
      const b = this.scenarioButton(
        bx,
        y - 4,
        MAGE_CLASS_DEFS[cls].label,
        () => {
          t.mageClass = cls;
          this.refreshScenarioLab();
          this.redraw();
        },
        on ? MENU_HEX.verdigris : MENU_HEX.bone,
        on ? '#3a281b' : '#1a1d18',
      );
      bx += b.width + 6;
    }
    y += 44;

    this.scenarioLabel(left, y, 'Creative presets (stats + items):', TEXT.dim);
    y += 24;
    bx = left;
    for (let slot = 0; slot < PRESET_SLOTS; slot++) {
      const preset = this.creativePresets[slot];
      const b = this.scenarioButton(
        bx,
        y,
        preset ? `Apply "${preset.name}"` : `Slot ${slot + 1} — empty`,
        () => {
          if (!preset) return;
          this.applyPresetToEntity(t, preset);
          this.refreshScenarioLab();
          this.redraw();
        },
        preset ? '#9f8bad' : MENU_HEX.disabled,
        preset ? '#2f2734' : '#1a1d18',
      );
      bx += b.width + 8;
    }
    this.scenarioLabel(
      left,
      y + 34,
      'Presets come from the Creative prep screen (Swamprun / Raid / Mine Run). Applying one replaces stats and gear.',
      TEXT.dim,
    );
  }

  private refreshScenarioWords(left: number, top: number): void {
    const { target: t, y: rowY } = this.scenarioTargetRow(left, top);
    if (!t) return;
    const { base, modifiers } = splitModifiers(t.loadout);
    this.scenarioTitle!.setText(`SCENARIO LAB — WORDS: ${t.name}`);
    this.scenarioLabel(
      left,
      rowY,
      `Words ${base.length}/${LOADOUT_SIZE} — click to add or remove. Colour identity and charges update instantly.`,
      TEXT.dim,
    );

    const setWords = (next: WordId[]): void => {
      t.setLoadout(next);
      this.refreshScenarioLab();
      this.redraw();
    };

    const pool = (Object.keys(WORDS) as WordId[]).filter((w) => !isModifierWord(w));
    const colW = 200;
    const step = 26;
    const y0 = rowY + 30;
    const perCol = Math.ceil(pool.length / 4);
    pool.forEach((word, i) => {
      const on = base.includes(word);
      const secret = !WORD_ORDER.includes(word);
      this.scenarioButton(
        left + Math.floor(i / perCol) * colW,
        y0 + (i % perCol) * step,
        `${on ? '✓ ' : ''}${WORDS[word].label}${secret ? ' *' : ''}`,
        () => {
          if (on) setWords([...base.filter((w) => w !== word), ...modifiers]);
          else if (base.length < LOADOUT_SIZE) setWords([...base, word, ...modifiers]);
          else this.flashHint(`A build carries at most ${LOADOUT_SIZE} words.`);
        },
        on ? MENU_HEX.verdigris : MENU_HEX.bone,
        on ? '#20342b' : '#1a1d18',
      );
    });

    const y = y0 + perCol * step + 18;
    this.scenarioLabel(left, y, 'Modifier:');
    let bx = left + 100;
    const current = modifiers[0];
    for (const word of [...MODIFIER_WORDS, null] as (WordId | null)[]) {
      const on = word === null ? current === undefined : current === word;
      const b = this.scenarioButton(
        bx,
        y - 4,
        word === null ? 'None' : WORDS[word].label,
        () => setWords(word === null ? base : [...base, word]),
        on ? MENU_HEX.verdigris : MENU_HEX.bone,
        on ? '#3a281b' : '#1a1d18',
      );
      bx += b.width + 6;
    }
    this.scenarioLabel(left, y + 36, '* not offered on the draft screen (easter-egg words).', TEXT.dim);
  }

  /** Overwrite an entity's stats and gear from a saved Creative preset. */
  private applyPresetToEntity(m: Mage, preset: CreativePreset): void {
    // applyStatAllocation ADDS to the HP/mana pools, so rebase them first.
    m.maxHp = START_HP;
    m.maxMana = MANA_CAP;
    m.maxSanity = START_SANITY;
    this.applyCreativePrep(m, { stats: { ...preset.stats }, items: [...preset.items] });
    this.gs.log(`${m.name} is rebuilt from preset "${preset.name}".`);
  }

  private refreshScenarioRoster(left: number, top: number): void {
    this.scenarioTitle!.setText(`SCENARIO LAB — ROSTER (${this.gs.mages.length})`);
    this.scenarioLabel(
      left,
      top,
      'Move places an entity anywhere; Edit opens its stats, words and gear. F6 (dev panel) edits live resources.',
      TEXT.dim,
    );
    let y = top + 28;
    const visible = this.gs.mages.slice(0, 16);
    visible.forEach((m, i) => {
      const acting = m === this.gs.current;
      this.scenarioLabel(
        left,
        y,
        `${i + 1}. ${m.name}${m.isSummon ? ' *' : ''} — T${m.team} · ${m.hp}/${m.maxHp} HP${acting ? ' · acting' : ''}`,
        acting ? '#ffd27a' : m.alive ? TEXT.body : TEXT.dim,
      );
      let bx = left + 400;
      const move = this.scenarioButton(bx, y - 4, 'Move', () => this.beginScenarioMove(m));
      bx += move.width + 6;
      const gear = this.scenarioButton(bx, y - 4, 'Edit', () => {
        this.scenarioTargetIndex = i;
        this.scenarioPage = 'stats';
        this.refreshScenarioLab();
      });
      bx += gear.width + 6;
      const team = this.scenarioButton(bx, y - 4, `Team ${m.team}`, () => {
        m.team = (m.team % 4) + 1;
        this.refreshScenarioLab();
        this.redraw();
      });
      bx += team.width + 6;
      const ai = this.scenarioButton(
        bx,
        y - 4,
        m.isAI ? 'AI' : 'Human',
        () => this.setScenarioController(m, !m.isAI),
        m.isAI ? '#ffd27a' : MENU_HEX.verdigris,
        m.isAI ? '#4a3a1a' : '#20342b',
      );
      bx += ai.width + 6;
      this.scenarioButton(bx, y - 4, '✕', () => this.removeScenarioEntity(m), '#ff8a8a', '#3a1a1a');
      y += 30;
    });
    const hidden = this.gs.mages.length - visible.length;
    if (hidden > 0) this.scenarioLabel(left, y, `…and ${hidden} more.`, TEXT.dim);
  }

  private refreshScenarioSpawn(left: number, top: number): void {
    this.scenarioTitle!.setText('SCENARIO LAB — PLACE ENTITIES');
    this.scenarioLabel(left, top, 'Team for new entities:');
    let bx = left + 190;
    for (const team of [1, 2, 3, 4]) {
      const on = this.scenarioTeam === team;
      const b = this.scenarioButton(
        bx,
        top - 4,
        `T${team}`,
        () => {
          this.scenarioTeam = team;
          this.refreshScenarioLab();
        },
        on ? MENU_HEX.verdigris : MENU_HEX.bone,
        on ? '#3a281b' : '#1a1d18',
      );
      bx += b.width + 6;
    }
    this.scenarioLabel(
      left,
      top + 26,
      'Pick one, then click the field to drop it. Keep clicking to place more; Esc returns here.',
      TEXT.dim,
    );

    const colW = 300;
    const step = 26;
    const y0 = top + 58;
    const entries: { label: string; color: string; arm: () => void }[] = [
      { label: 'Mage (blank kit)', color: MENU_HEX.brassLight, arm: () => (this.scenarioBrush = { player: true }) },
      ...(Object.keys(ENEMY_DEFS) as EnemyKind[]).map((kind) => ({
        label: ENEMY_DEFS[kind].name,
        color: '#e8e8f0',
        arm: () => (this.scenarioBrush = { enemy: kind }),
      })),
      ...(Object.keys(MINE_ENEMY_DEFS) as MineEnemyKind[]).map((kind) => ({
        label: `${MINE_ENEMY_DEFS[kind].name} (mine)`,
        color: '#d8c39a',
        arm: () => (this.scenarioBrush = { mine: kind }),
      })),
    ];
    const perCol = Math.ceil(entries.length / 3);
    entries.forEach((entry, i) => {
      const x = left + Math.floor(i / perCol) * colW;
      const y = y0 + (i % perCol) * step;
      this.scenarioButton(x, y, entry.label, () => {
        entry.arm();
        this.mode = 'scenario-place';
        // The same pointerdown also reaches the field handler; swallow it.
        this.menuClickGuard = true;
        this.closeScenarioLab();
        this.flashHint(`Placing ${entry.label} — click the field. Esc to stop.`, true);
      }, entry.color);
    });
  }

  private refreshScenarioGear(left: number, top: number): void {
    const { target, y: rowY } = this.scenarioTargetRow(left, top);
    if (!target) return;
    this.scenarioTitle!.setText(`SCENARIO LAB — GEAR: ${target.name}`);
    this.scenarioLabel(left, rowY - 8, 'Click a name to give it; ✕ removes one.', TEXT.dim);

    const colW = 232;
    const step = 24;
    const y0 = rowY + 18;
    const perCol = Math.ceil(ITEM_DEFS.length / 4);
    ITEM_DEFS.forEach((def, i) => {
      const x = left + Math.floor(i / perCol) * colW;
      const y = y0 + (i % perCol) * step;
      this.scenarioButton(x, y, '✕', () => {
        this.gs.removeItem(target, def.id);
        this.refreshScenarioLab();
        this.redraw();
      }, '#ff8a8a', '#3a1a1a');
      this.scenarioButton(x + 56, y, def.name, () => {
        this.gs.grantItem(target, def.id);
        this.refreshScenarioLab();
        this.redraw();
      }, RARITY_COLOR[def.rarity]);
    });
  }

  /** Arm the move tool: the next field click teleports `m` there. */
  private beginScenarioMove(m: Mage): void {
    this.scenarioMoveTarget = m;
    this.mode = 'scenario-move';
    this.menuClickGuard = true;
    this.closeScenarioLab();
    this.flashHint(`Moving ${m.name} — click the field. Esc cancels.`, true);
  }

  /** Handle a field click while a lab tool is armed. Returns true if consumed. */
  private onScenarioFieldClick(at: Vec2): boolean {
    if (this.mode === 'scenario-move') {
      const m = this.scenarioMoveTarget;
      this.scenarioMoveTarget = null;
      this.mode = 'idle';
      if (m) {
        m.x = at.x;
        m.y = at.y;
        this.syncMageSprites();
      }
      this.flashHint('', true);
      this.toggleScenarioLab();
      return true;
    }
    if (this.mode !== 'scenario-place') return false;
    const brush = this.scenarioBrush;
    if (!brush) {
      this.mode = 'idle';
      return true;
    }
    if ('player' in brush) this.spawnScenarioMage(at);
    else if ('enemy' in brush) this.spawnScenarioCreature(brush.enemy, at);
    else this.spawnScenarioMineCreature(brush.mine, at);
    this.redraw();
    return true;
  }

  /** Register a freshly built entity with the roster, AI table and sprites. */
  private admitScenarioEntity(m: Mage): void {
    m.resetDodges();
    m.resetCombatReactions();
    this.gs.addMage(m);
    if (m.isAI) this.ais.set(m, new SimpleAI(this.gs, m));
    this.syncMageSprites();
  }

  private spawnScenarioMage(at: Vec2): Mage {
    const template = this.gs.mages.find((m) => !m.isSummon && !m.enemyKind && !m.mine);
    const m = new Mage({
      name: `Mage ${this.gs.mages.length + 1}`,
      isAI: this.scenarioTeam !== 1,
      team: this.scenarioTeam,
      position: at,
      loadout: template ? [...template.loadout] : [],
      mageClass: template?.mageClass,
    });
    m.assignFlatStats(5);
    this.admitScenarioEntity(m);
    this.gs.log(`${m.name} joins the scenario on team ${m.team}.`);
    return m;
  }

  private spawnScenarioCreature(kind: EnemyKind, at: Vec2): Mage {
    const m = new Mage({ name: 'Enemy', isAI: true, team: this.scenarioTeam, position: at, loadout: [] });
    applyEnemyTraits(m, kind, this.gs.rng);
    m.team = this.scenarioTeam;
    this.admitScenarioEntity(m);
    this.styleEnemySprite(m, kind);
    this.gs.log(`${m.name} is placed on team ${m.team}.`);
    return m;
  }

  private spawnScenarioMineCreature(kind: MineEnemyKind, at: Vec2): Mage {
    const m = new Mage({ name: 'Enemy', isAI: true, team: this.scenarioTeam, position: at, loadout: [] });
    applyMineEnemyTraits(m, { kind, level: 1 }, this.gs.rng);
    m.team = this.scenarioTeam;
    this.admitScenarioEntity(m);
    this.styleMineEnemySprite(m);
    this.gs.log(`${m.name} is placed on team ${m.team}.`);
    return m;
  }

  /** Flip an entity between human control and the AI. */
  private setScenarioController(m: Mage, ai: boolean): void {
    m.isAI = ai;
    if (ai) this.ais.set(m, new SimpleAI(this.gs, m));
    else this.ais.delete(m);
    this.refreshScenarioLab();
    this.redraw();
  }

  /**
   * Drop an entity from the fight. Every stored index (initiative, summon
   * owners) is remapped, and field objects are cleared because they also point
   * at mages by index.
   */
  private removeScenarioEntity(m: Mage): void {
    if (m === this.gs.current) {
      this.flashHint('That entity is taking its turn — end the turn first.');
      return;
    }
    const removed = this.gs.mages.indexOf(m);
    if (removed < 0) return;
    const remap = new Map<number, number>();
    let next = 0;
    this.gs.mages.forEach((_, i) => {
      if (i !== removed) remap.set(i, next++);
    });
    const rolls = this.gs.initiativeRolls;
    const nextRolls: number[] = [];
    for (const [from, to] of remap) nextRolls[to] = rolls[from] ?? 0;
    const order = this.gs.initiativeOrder
      .map((i) => remap.get(i))
      .filter((i): i is number => i !== undefined);
    const current = remap.get(this.gs.currentIndex) ?? 0;

    this.ais.delete(m);
    this.gs.mages = this.gs.mages.filter((x) => x !== m);
    for (const other of this.gs.mages) {
      if (other.summonOwnerIndex !== undefined) {
        other.summonOwnerIndex = remap.get(other.summonOwnerIndex);
      }
    }
    this.gs.clearFieldObjects();
    this.gs.restoreTurnOrder(order, nextRolls, current);
    this.syncMageSprites();
    this.refreshScenarioLab();
    this.redraw();
  }

  /** Snapshot the fight and hand it to the browser as a download. */
  private saveScenarioFile(): void {
    if (this.scenarioNamePanel) return;
    const suggestion = this.memoryName || 'My fight';
    let value = suggestion;
    const panel = this.add.container(0, 0).setDepth(2200);
    this.scenarioNamePanel = panel;
    addCabinetWindow(this, panel, {
      width: 560,
      height: 250,
      title: 'NAME SCENARIO',
      subtitle: 'Save this arena state as a Memory file.',
      accent: MENU_COLOR.brass,
      dismiss: () => this.scenarioNameEntry.finish(false),
    });

    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;
    const field = this.add
      .rectangle(cx, cy - 8, 470, 48, MENU_COLOR.charcoalRaised, 1)
      .setStrokeStyle(2, MENU_COLOR.brassDark)
      .setInteractive({ useHandCursor: true });
    const label = this.add.text(cx - 235, cy - 48, 'SCENARIO NAME', {
      fontFamily: MENU_FONT.control,
      fontSize: '12px',
      color: MENU_HEX.brassLight,
    });
    const valueText = this.add
      .text(cx - 216, cy - 8, value, {
        fontFamily: MENU_FONT.body,
        fontSize: '18px',
        color: MENU_HEX.bone,
        fixedWidth: 432,
      })
      .setOrigin(0, 0.5);
    field.on('pointerdown', () => this.scenarioNameEntry.focus());
    panel.add([field, label, valueText]);

    const cancel = new CabinetChip(this, cx - 227, cy + 51, {
      width: 210,
      height: 38,
      label: 'CANCEL',
      tone: 'danger',
      onActivate: () => this.scenarioNameEntry.finish(false),
    });
    const save = new CabinetChip(this, cx + 17, cy + 51, {
      width: 210,
      height: 38,
      label: 'SAVE MEMORY',
      tone: 'primary',
      onActivate: () => this.scenarioNameEntry.finish(true),
    });
    panel.add([cancel, save]);

    this.scenarioNameEntry.begin({
      value,
      maxLength: 64,
      ariaLabel: 'Scenario name',
      commitOnBlur: false,
      onChange: (next) => {
        value = next;
        valueText.setText(next || ' ');
      },
      onDone: (committed) => {
        if (this.scenarioNamePanel !== panel) return;
        this.scenarioNamePanel = undefined;
        panel.destroy();
        if (!committed) return;
        try {
          const saved = downloadScenario(this.gs, value.trim() || suggestion);
          this.memoryName = saved.name;
          this.gs.log(`Scenario saved as "${saved.name}".`);
          this.flashHint(`Saved "${saved.name}" — load it from the Memory menu.`);
        } catch {
          this.flashHint('Could not save that scenario.');
        }
      },
    });
  }

  /** Pick a memory file and swap the whole fight over to it, in place. */
  private async loadScenarioFile(): Promise<void> {
    let scenario: Scenario | null;
    try {
      scenario = await pickScenarioFile();
    } catch (err) {
      this.flashHint(err instanceof Error ? err.message : 'That scenario could not be loaded.');
      return;
    }
    if (!scenario) return;
    this.adoptScenario(scenario);
  }

  /**
   * Replace the live roster, field and turn order with a saved fight. Safe only
   * from the lab, which can be opened solely while the scene is idle — no turn
   * is mid-resolution, so restarting the turn loop cannot orphan an await.
   */
  private adoptScenario(scenario: Scenario): void {
    const mages = scenarioToMages(scenario, this.gs.rng);
    this.gs.stack = [];
    this.gs.extraTurnQueue = [];
    this.gs.clearFieldObjects();
    this.gs.mages = mages;
    this.gs.restoreScarabs(scenarioToScarabs(scenario, mages));
    this.gs.restoreTurnOrder(scenario.turn.order, scenario.turn.rolls, scenario.turn.currentIndex);
    this.gs.round = scenario.turn.round;
    this.gs.turnSeq = scenario.turn.turnSeq;
    this.ais.clear();
    for (const m of mages) if (m.isAI) this.ais.set(m, new SimpleAI(this.gs, m));
    this.spawns = mages.map((m) => ({ x: m.x, y: m.y }));
    const sides = new Set(mages.filter((m) => !m.isSummon && m.alive).map((m) => m.team));
    this.gs.victorySuspended = this.scenarioLab || sides.size < 2;
    this.memoryName = scenario.name;
    this.scenarioTargetIndex = 0;
    this.scenarioMoveTarget = null;
    this.scenarioBrush = null;
    this.reactor = null;
    this.puppet = null;
    this.gameEnded = false;
    this.endCard?.destroy();
    this.endCard = undefined;
    this.closeScenarioLab();
    this.resetSelection();
    this.restyleCreatureSprites();
    this.gs.log(
      `Memory loaded — "${scenario.name}" (round ${this.gs.round}, ${mages.length} entities).`
    );
    this.mode = 'busy';
    void this.startTurn();
  }

  // ─── Training sandbox overlay ────────────────────────────────────────────

  private toggleTrainingOverlay(): void {
    if (!this.training) return;
    if (this.mode === 'training') {
      this.closeTrainingOverlay();
      return;
    }
    if (this.mode !== 'idle') return;
    if (this.controllerIsAI(this.gs.current)) return;
    this.buildTrainingOverlay();
    this.trainPage = 'main';
    this.mode = 'training';
    this.trainPanel!.setVisible(true);
    this.refreshTrainingOverlay();
    this.redraw();
  }

  private closeTrainingOverlay(): void {
    if (this.trainPanel) this.trainPanel.setVisible(false);
    if (this.mode === 'training') this.mode = 'idle';
    this.redraw();
  }

  private buildTrainingOverlay(): void {
    if (this.trainPanel) return;
    const panel = this.add.container(0, 0).setDepth(96).setVisible(false);
    const chrome = addCabinetWindow(this, panel, {
      width: 860,
      height: 640,
      title: 'TRAINING LAB',
      subtitle: 'Configure combatants, resources, stacks, and equipment in real time',
      accent: MENU_COLOR.verdigris,
      dismiss: () => this.closeTrainingOverlay(),
    });
    this.trainTitle = chrome.title;
    this.trainPanel = panel;
  }

  private clearTrainWidgets(): void {
    this.workshopFocus.clear();
    for (const w of this.trainWidgets) w.destroy();
    this.trainWidgets = [];
  }

  private trainButton(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    color: string = MENU_HEX.bone,
    bg: string = '#1a1d18',
  ): CabinetChip {
    return this.addWorkshopChip(this.trainPanel!, this.trainWidgets, x, y, label, onClick, color, bg);
  }

  private trainLabel(x: number, y: number, text: string, color?: string): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, text, {
      fontFamily: MENU_FONT.body,
      fontSize: '15px',
      color: color ?? MENU_HEX.bone,
    });
    this.trainPanel!.add(t);
    this.trainWidgets.push(t);
    return t;
  }

  private refreshTrainingOverlay(): void {
    if (!this.trainPanel) return;
    this.clearTrainWidgets();
    if (this.trainPage === 'items') {
      this.refreshTrainingItems();
      return;
    }
    const left = GAME_WIDTH / 2 - 380;
    let y = GAME_HEIGHT / 2 - 250;
    this.trainTitle!.setText('TRAINING LAB');

    // Enemy configuration.
    this.trainLabel(left, y, 'Enemy:');
    const kinds: ['dummy' | 'passive' | 'ai', string][] = [
      ['dummy', 'Dummy (unkillable)'],
      ['passive', 'Passive 5-stat'],
      ['ai', 'AI 5-stat'],
    ];
    let bx = left + 80;
    for (const [k, label] of kinds) {
      const on = this.trainEnemyKind === k;
      const b = this.trainButton(
        bx,
        y - 4,
        label,
        () => this.setTrainingEnemy(k),
        on ? MENU_HEX.verdigris : MENU_HEX.bone,
        on ? '#20342b' : '#1a1d18',
      );
      bx += b.width + 10;
    }
    y += 46;

    // Which mage the controls below edit.
    this.trainLabel(left, y, 'Edit target:');
    bx = left + 110;
    for (const team of [1, 2] as number[]) {
      const on = this.trainTarget === team;
      const b = this.trainButton(
        bx,
        y - 4,
        team === 1 ? 'Player' : 'Enemy',
        () => {
          this.trainTarget = team;
          this.refreshTrainingOverlay();
        },
        on ? MENU_HEX.verdigris : MENU_HEX.bone,
        on ? '#3a281b' : '#1a1d18',
      );
      bx += b.width + 10;
    }
    y += 46;

    const t = this.mageByTeam(this.trainTarget);
    const vital = (label: string, cur: number, max: number, field: 'hp' | 'mana' | 'sanity') => {
      this.trainLabel(left, y, `${label}: ${cur} / ${max}`);
      let vx = left + 220;
      for (const [d, txt] of [
        [-5, '-5'],
        [5, '+5'],
      ] as [number, string][]) {
        const b = this.trainButton(vx, y - 4, txt, () => this.adjustVital(field, d));
        vx += b.width + 8;
      }
      const full = this.trainButton(vx, y - 4, 'Full', () => this.adjustVital(field, 99999));
      vx += full.width + 8;
      y += 38;
    };
    vital('HP', t.hp, t.maxHp, 'hp');
    vital('Mana', t.mana, t.maxMana, 'mana');
    vital('Sanity', t.sanity, t.maxSanity, 'sanity');

    const stack = (label: string, cur: number, field: 'thunder' | 'greed' | 'color') => {
      this.trainLabel(left, y, `${label}: ${cur}`);
      let vx = left + 220;
      for (const [d, txt] of [
        [-1, '-1'],
        [1, '+1'],
        [5, '+5'],
      ] as [number, string][]) {
        const b = this.trainButton(vx, y - 4, txt, () => this.adjustStacks(field, d));
        vx += b.width + 8;
      }
      y += 38;
    };
    stack('Thunder stacks', t.thunderStacks, 'thunder');
    stack('Greed stacks', t.greedStacks, 'greed');
    stack('Color charges', t.colorCharges, 'color');
    y += 14;

    // Bottom action row.
    let ax = left;
    const items = this.trainButton(
      ax,
      y,
      'Give / Remove Items',
      () => {
        this.trainPage = 'items';
        this.refreshTrainingOverlay();
      },
      MENU_HEX.bone,
      '#2f2734',
    );
    ax += items.width + 12;
    const reset = this.trainButton(ax, y, 'Soft Reset', () => this.softReset(), '#ffd27a', '#4a3a1a');
    ax += reset.width + 12;
    this.trainButton(ax, y, 'Close [P]', () => this.closeTrainingOverlay(), '#ff9a9a', '#4a1a1a');

  }

  private refreshTrainingItems(): void {
    const left = GAME_WIDTH / 2 - 380;
    const top = GAME_HEIGHT / 2 - 258;
    this.trainTitle!.setText(
      `ITEMS — name = give, ✕ = remove  (Target: ${this.trainTarget === 1 ? 'Player' : 'Enemy'})`,
    );
    const back = this.trainButton(
      left,
      top,
      '← Back',
      () => {
        this.trainPage = 'main';
        this.refreshTrainingOverlay();
      },
      MENU_HEX.bone,
      '#2f2734',
    );
    let hx = left + back.width + 16;
    for (const team of [1, 2] as number[]) {
      const on = this.trainTarget === team;
      const b = this.trainButton(
        hx,
        top,
        team === 1 ? 'Player' : 'Enemy',
        () => {
          this.trainTarget = team;
          this.refreshTrainingOverlay();
        },
        on ? MENU_HEX.verdigris : MENU_HEX.bone,
        on ? '#3a281b' : '#1a1d18',
      );
      hx += b.width + 8;
    }

    const target = this.mageByTeam(this.trainTarget);
    const colW = 380;
    const y0 = top + 42;
    const step = 26;
    const perCol = Math.ceil(ITEM_DEFS.length / 2);
    ITEM_DEFS.forEach((def, i) => {
      const col = Math.floor(i / perCol);
      const row = i % perCol;
      const x = left + col * colW;
      const y = y0 + row * step;
      this.trainButton(
        x,
        y,
        '✕',
        () => {
          this.gs.removeItem(target, def.id);
          this.refreshTrainingOverlay();
          this.redraw();
        },
        '#ff8a8a',
        '#3a1a1a',
      );
      this.trainButton(x + 56, y, def.name, () => {
        this.gs.grantItem(target, def.id);
        this.refreshTrainingOverlay();
        this.redraw();
      }, RARITY_COLOR[def.rarity]);
    });
  }

  private adjustVital(field: 'hp' | 'mana' | 'sanity', delta: number): void {
    const t = this.mageByTeam(this.trainTarget);
    const max = field === 'hp' ? t.maxHp : field === 'mana' ? t.maxMana : t.maxSanity;
    const cur = field === 'hp' ? t.hp : field === 'mana' ? t.mana : t.sanity;
    const floor = field === 'mana' ? 0 : t.unkillable ? 1 : 0;
    const val = Math.max(floor, Math.min(max, cur + delta));
    if (field === 'hp') t.hp = val;
    else if (field === 'mana') t.mana = val;
    else t.sanity = val;
    this.refreshTrainingOverlay();
    this.redraw();
  }

  private adjustStacks(field: 'thunder' | 'greed' | 'color', delta: number): void {
    const t = this.mageByTeam(this.trainTarget);
    if (field === 'thunder') t.thunderStacks = Math.max(0, t.thunderStacks + delta);
    else if (field === 'greed') t.greedStacks = Math.max(0, t.greedStacks + delta);
    else t.colorCharges = Math.max(0, Math.min(t.maxColorCharges, t.colorCharges + delta));
    this.refreshTrainingOverlay();
    this.redraw();
  }

  /** Apply the passivity/immortality flags for a training enemy kind. */
  private applyTrainingEnemyKind(m: Mage, kind: 'dummy' | 'passive' | 'ai'): void {
    m.trainingPassive = kind !== 'ai';
    m.unkillable = kind === 'dummy';
    if (kind === 'dummy') {
      m.maxHp = 99999;
      m.hp = 99999;
    }
  }

  /** Replace the enemy mage with a freshly configured training dummy/AI. */
  private setTrainingEnemy(kind: 'dummy' | 'passive' | 'ai'): void {
    const old = this.gs.mages[1];
    const rec = this.mageAnims.get(old);
    if (rec) {
      rec.sprite.destroy();
      this.mageAnims.delete(old);
    }
    this.ais.delete(old);
    const m2 = new Mage({
      name: 'Enemy',
      isAI: true,
      team: 2,
      position: { ...this.enemySpawn },
      loadout: old.loadout,
      mageClass: old.mageClass,
    });
    m2.assignFlatStats(5);
    this.applyTrainingEnemyKind(m2, kind);
    this.gs.mages[1] = m2;
    this.ais.set(m2, new SimpleAI(this.gs, m2));
    this.trainEnemyKind = kind;
    if (this.gs.currentIndex === 1) this.gs.currentIndex = 0;
    this.syncMageSprites();
    if (this.mode === 'training') this.refreshTrainingOverlay();
    this.redraw();
  }

  /** Restore both mages to full and clear every field object. */
  private softReset(): void {
    this.gameEnded = false;
    if (this.trainPanel) this.trainPanel.setVisible(false);
    for (const m of this.gs.mages) {
      const sp = this.spawns[this.seatOf(m)] ?? (m.team === 1 ? this.playerSpawn : this.enemySpawn);
      m.x = sp.x;
      m.y = sp.y;
      m.hp = m.maxHp;
      m.mana = m.maxMana;
      m.sanity = m.maxSanity;
      m.luck = m.maxLuck;
      m.statuses = [];
      m.thunderStacks = 0;
      m.greedStacks = 0;
      m.momentumStacks = 0;
      m.anchorStacks = 0;
      m.rageBonus = 0;
      m.movedThisTurn = false;
      m.distMovedThisTurn = 0;
      m.hasCastThisTurn = false;
      m.eldritchDefend = false;
      m.blockPending = false;
      m.reloadTurns = 0;
      m.bastionShieldForm = true;
      m.shieldBashUsed = false;
      m.firstBlackSpellUsed = false;
      m.manaMilledOnce = false;
      m.actions = { ...ACTIONS_PER_TURN };
      m.reactionAvailable = m.canEverReact;
      m.reactedThisCycle = false;
      m.resetCombatReactions();
      m.resetDodges();
      for (const w of m.loadout) m.charges[w] = m.maxWordCharges(w);
      const rec = this.mageAnims.get(m);
      if (rec) {
        rec.posLocked = false;
        rec.lock = null;
        rec.charging = false;
      }
    }
    this.gs.clearFieldObjects();
    this.gs.round = 1;
    this.gs.currentIndex = 0;
    this.busy = false;
    this.mode = 'idle';
    this.resetSelection();
    this.syncMageSprites();
    this.gs.log('Training: field reset — HP, mana, positions and effects restored.');
    this.redraw();
    this.gs.startRound();
    void this.startTurn();
  }

  private buildDicePanel(): void {
    this.diceField = new DiceFieldView(this);
  }

  private redraw(): void {
    const g = this.gfx;
    g.clear();
    this.stackTokens = [];
    // The hover targeting overlay is rebuilt on the next pointer move; clear any
    // stale line/reticle so it does not linger after the stack changes.
    this.hoverGfx?.clear();

    // The dark light sits below shadows so it protects rather than obscures them.
    this.drawEdgelordDarkLights(g);

    // Shadow pools (under everything else on the field).
    this.drawShadows(g);

    // Veil Bind linking circles.
    this.drawVeilBindZones(g);

    // Permanent Red Objects static orbs.
    this.drawRedOrbs(g);

    // Reality-break barriers.
    this.drawBarriers(g);

    // Mutivarg crushing fields.
    this.drawMutivargZones(g);

    // Black Dragonborn breath pools.
    this.drawCorrosionPools(g);

    // Corrosion totems.
    this.drawTotems(g);

    // Remaining-duration counters on every field zone (visible to everyone).
    this.drawZoneDurations();

    // Dropped equipment on the ground.
    this.drawDroppedItems(g);

    // Torch / lantern light auras.
    this.drawLightAuras(g);

    // Rot Sentry corrosion auras.
    this.drawIntrinsicDamageAuras(g);

    // Aiming ranges.
    this.drawAimingRange(g);

    // Bind Curse ranges follow their afflicted bearers.
    this.drawBindCurseAuras(g);

    // Defeated bodies clear after their defeat seal so the field stays readable.
    for (const m of this.gs.mages) {
      if (m.alive && !m.oniHidden) this.drawMage(g, m);
      else this.mageLabels.get(m)?.setVisible(false);
    }

    // Stack tokens.
    this.drawStack(g);

    // Swamprun wave / foe-count readout.
    if (this.swamprun) this.updateWaveHud();

    // HUD text.
    this.drawHud();

    // Docked enemy target list (kept in sync with who is alive / targetable).
    this.refreshTargetList();
  }

  /** Warm glow around any mage projecting a torch / lantern light aura. */
  private drawLightAuras(g: Phaser.GameObjects.Graphics): void {
    for (const m of this.gs.mages) {
      if (!m.alive) continue;
      const r = this.gs.effectiveLightRadius(m);
      if (r <= 0) continue;
      g.fillStyle(0xffd27a, 0.12).fillCircle(m.pos.x, m.pos.y, r);
      g.fillStyle(0xffe6a8, 0.1).fillCircle(m.pos.x, m.pos.y, r * 0.6);
      g.lineStyle(1, 0xffd27a, 0.35).strokeCircle(m.pos.x, m.pos.y, r);
    }
  }

  private drawEdgelordDarkLights(g: Phaser.GameObjects.Graphics): void {
    for (const mage of this.gs.mages) {
      if (!mage.alive || !mage.hasEdgelordLantern() || !mage.edgelordLanternActive) continue;
      const radius = 15 * RANGE_UNIT;
      g.fillStyle(0x030308, 0.48).fillCircle(mage.x, mage.y, radius);
      g.fillStyle(0x1a0d20, 0.2).fillCircle(mage.x, mage.y, radius * 0.72);
      g.lineStyle(3, 0x8a5aa5, 0.75).strokeCircle(mage.x, mage.y, radius);
      g.lineStyle(1, 0xc98dd8, 0.35).strokeCircle(mage.x, mage.y, radius - 5);
    }
  }

  private drawIntrinsicDamageAuras(g: Phaser.GameObjects.Graphics): void {
    for (const mage of this.gs.mages) {
      if (!mage.alive || !mage.intrinsicDamageAura) continue;
      const radius = mage.intrinsicDamageAura.radius;
      g.fillStyle(0x8ecf58, 0.08).fillCircle(mage.x, mage.y, radius);
      g.lineStyle(1, 0x9be870, 0.55).strokeCircle(mage.x, mage.y, radius);
    }
  }

  private drawShadows(g: Phaser.GameObjects.Graphics): void {
    for (const s of this.gs.shadows) {
      const tint = s.owner === 1 ? COLORS.team1 : COLORS.team2;
      g.fillStyle(COLORS.shadow, 0.22).fillCircle(s.x, s.y, s.radius);
      g.fillStyle(0x000000, 0.28).fillCircle(s.x, s.y, s.radius * 0.7);
      g.lineStyle(2, tint, 0.55).strokeCircle(s.x, s.y, s.radius);
    }
  }

  private drawVeilBindZones(g: Phaser.GameObjects.Graphics): void {
    for (const zone of this.gs.veilBindZones) {
      const tint = zone.owner === 1 ? COLORS.team1 : COLORS.team2;
      g.fillStyle(0x8ad1ff, 0.09).fillCircle(zone.x, zone.y, zone.radius);
      g.lineStyle(2, 0x8ad1ff, 0.7).strokeCircle(zone.x, zone.y, zone.radius);
      g.lineStyle(1, tint, 0.55).strokeCircle(zone.x, zone.y, zone.radius - 5);
    }
  }

  private drawRedOrbs(g: Phaser.GameObjects.Graphics): void {
    for (const orb of this.gs.redOrbs) {
      g.fillStyle(0xff3b24, 0.09).fillCircle(orb.x, orb.y, orb.radius);
      g.lineStyle(2, 0xff5a36, 0.78).strokeCircle(orb.x, orb.y, orb.radius);
      g.fillStyle(0xffd447, 0.92).fillCircle(orb.x, orb.y, 9);
      g.lineStyle(2, 0xffffff, 0.5).strokeCircle(orb.x, orb.y, 12);
    }
  }

  private drawBindCurseAuras(g: Phaser.GameObjects.Graphics): void {
    for (const mage of this.gs.mages) {
      if (!mage.alive) continue;
      for (const status of mage.statuses) {
        if (status.kind !== 'bindCurseAura') continue;
        g.fillStyle(0x6a7bd0, 0.06).fillCircle(mage.x, mage.y, status.radius);
        g.lineStyle(1, 0x8b96df, 0.5).strokeCircle(mage.x, mage.y, status.radius);
      }
    }
  }

  private drawTotems(g: Phaser.GameObjects.Graphics): void {
    for (const t of this.gs.totems) {
      const tint = t.owner === 1 ? COLORS.team1 : COLORS.team2;
      g.fillStyle(COLORS.totem, 0.1).fillCircle(t.x, t.y, t.radius);
      g.lineStyle(2, COLORS.totem, 0.5).strokeCircle(t.x, t.y, t.radius);
      g.fillStyle(COLORS.totem, 0.9).fillCircle(t.x, t.y, 9);
      g.lineStyle(2, tint, 0.9).strokeCircle(t.x, t.y, 9);
    }
  }

  private zoneLabels = new Map<string, Phaser.GameObjects.Text>();
  /**
   * Draw the remaining lifetime of every field zone (shadows, totems, crushing
   * fields and reality-break walls) as a small counter, visible to everyone so
   * both sides can plan around when each zone expires.
   */
  private drawZoneDurations(): void {
    const live = new Set<string>();
    const show = (key: string, x: number, y: number, turns: number, owner: number): void => {
      if (turns <= 0) return;
      live.add(key);
      let t = this.zoneLabels.get(key);
      if (!t) {
        t = this.add
          .text(0, 0, '', {
            fontFamily: MENU_FONT.control,
            fontSize: '10px',
            fontStyle: 'bold',
            backgroundColor: '#17110df2',
            padding: { x: 5, y: 2 },
            align: 'center',
          })
          .setOrigin(0.5);
        this.zoneLabels.set(key, t);
      }
      const hex = owner === 1 ? MENU_HEX.verdigris : '#d99286';
      t.setText(`${turns} TURN${turns === 1 ? '' : 'S'}`).setColor(hex).setPosition(x, y).setVisible(true);
    };
    for (const s of this.gs.shadows) show(`sh${s.id}`, s.x, s.y - s.radius - 10, s.ttl, s.owner);
    for (const t of this.gs.totems) show(`to${t.id}`, t.x, t.y - t.radius - 10, t.ttl, t.owner);
    for (const z of this.gs.mutivargZones)
      show(`mv${z.id}`, z.x, z.y - z.radius - 10, z.turnsLeft, z.owner);
    for (const pool of this.gs.corrosionPools)
      show(`cp${pool.id}`, pool.x, pool.y - pool.radius - 10, pool.roundsLeft, pool.ownerTeam);
    for (const zone of this.gs.hazardZones)
      show(
        `hz${zone.id}`,
        zone.toX != null ? (zone.x + zone.toX) / 2 : zone.x,
        (zone.toY != null ? (zone.y + zone.toY) / 2 : zone.y) - zone.radius - 10,
        zone.roundsLeft,
        zone.ownerTeam
      );
    for (const b of this.gs.barriers) show(`ba${b.id}`, b.x, b.y, b.ttl, b.owner);
    for (const zone of this.gs.veilBindZones) {
      show(`vb${zone.id}`, zone.x, zone.y - zone.radius - 10, zone.roundsLeft, zone.owner);
    }
    // Recycle labels for zones that have since collapsed.
    for (const [k, t] of this.zoneLabels) {
      if (!live.has(k)) {
        t.destroy();
        this.zoneLabels.delete(k);
      }
    }
  }

  private dropLabels = new Map<number, Phaser.GameObjects.Text>();
  private drawDroppedItems(g: Phaser.GameObjects.Graphics): void {
    const live = new Set<number>();
    for (const d of this.gs.droppedItems) {
      live.add(d.id);
      const tint = d.owner === 1 ? COLORS.team1 : COLORS.team2;
      // A small diamond marker where the item rests.
      g.fillStyle(MENU_COLOR.pitch, 0.72).fillCircle(d.x + 2, d.y + 3, 12);
      g.fillStyle(MENU_COLOR.brass, 1);
      g.beginPath();
      g.moveTo(d.x, d.y - 8);
      g.lineTo(d.x + 8, d.y);
      g.lineTo(d.x, d.y + 8);
      g.lineTo(d.x - 8, d.y);
      g.closePath();
      g.fillPath();
      g.lineStyle(2, tint, 0.95).strokeCircle(d.x, d.y, 11);

      let t = this.dropLabels.get(d.id);
      if (!t) {
        t = this.add
          .text(0, 0, '', {
            fontFamily: MENU_FONT.control,
            fontSize: '10px',
            color: MENU_HEX.boneDim,
            backgroundColor: '#111310e8',
            padding: { x: 4, y: 1 },
            align: 'center',
          })
          .setOrigin(0.5);
        this.dropLabels.set(d.id, t);
      }
      const item = getItem(d.itemId);
      t.setText(item.name.toUpperCase()).setColor(RARITY_COLOR[item.rarity]);
      t.setPosition(d.x, d.y - 18).setVisible(true);
    }
    // Recycle labels for items that were picked back up.
    for (const [id, t] of this.dropLabels) {
      if (!live.has(id)) {
        t.destroy();
        this.dropLabels.delete(id);
      }
    }
  }

  /** Decode the scarab gif into frames and build the looping walk animation. */
  private async loadScarabFrames(): Promise<void> {
    const Decoder = (globalThis as unknown as { ImageDecoder?: unknown }).ImageDecoder as
      | (new (init: { data: ArrayBuffer; type: string }) => {
          tracks: { ready: Promise<void>; selectedTrack?: { frameCount: number } };
          decode: (opts: { frameIndex: number }) => Promise<{ image: CanvasImageSource & { close?: () => void } }>;
        })
      | undefined;
    if (!Decoder) return; // No WebCodecs: sprites keep the static first frame.
    try {
      const buf = await (await fetch(scarabGifUrl)).arrayBuffer();
      const decoder = new Decoder({ data: buf, type: 'image/gif' });
      await decoder.tracks.ready;
      const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 1;
      const keys: string[] = [];
      for (let i = 0; i < frameCount; i++) {
        const { image } = await decoder.decode({ frameIndex: i });
        const frame = image as CanvasImageSource & {
          displayWidth?: number;
          displayHeight?: number;
          codedWidth?: number;
          codedHeight?: number;
          close?: () => void;
        };
        const w = frame.displayWidth ?? frame.codedWidth ?? 16;
        const h = frame.displayHeight ?? frame.codedHeight ?? 16;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')?.drawImage(image, 0, 0);
        frame.close?.();
        const key = `scarab-${i}`;
        if (this.textures.exists(key)) this.textures.remove(key);
        this.textures.addCanvas(key, canvas);
        keys.push(key);
      }
      if (keys.length && !this.anims.exists('scarab-walk')) {
        this.anims.create({
          key: 'scarab-walk',
          frames: keys.map((k) => ({ key: k })),
          frameRate: 6,
          repeat: -1,
        });
      }
      this.scarabFrameCount = Math.max(1, keys.length);
      this.scarabAnimReady = keys.length > 0;
    } catch {
      // Decoding failed — fall back silently to the static first frame.
    }
  }

  /** A small, stable per-scarab offset so overlapping scarabs fan out. */
  private scarabOffset(id: number): Vec2 {
    const a = id * 2.399963; // golden angle keeps them well spread
    const r = 9 + (id % 3) * 5;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.6 };
  }

  /** Deterministic 0..1 hash per scarab id, used to spread out speeds/timings. */
  private scarabHash(id: number, seed: number): number {
    const v = Math.sin((id + 1) * seed) * 43758.5453;
    return v - Math.floor(v);
  }

  /** Create/position each scarab's sprite and ease it toward its target spot. */
  private syncScarabSprites(): void {
    if (!this.gs) return;
    const live = new Set<number>();
    for (const sc of this.gs.scarabs) {
      live.add(sc.id);
      const off = this.scarabOffset(sc.id);
      // While latched on, ride the victim's live position so the scarab moves
      // with them instead of being left behind.
      const base =
        sc.state === 'attached' && sc.target && sc.target.alive
          ? sc.target.pos
          : { x: sc.x, y: sc.y };
      const tx = base.x + off.x;
      const ty = base.y + off.y;

      let rec = this.scarabSprites.get(sc.id);
      if (!rec) {
        const sprite = this.add.sprite(tx, ty, 'scarab-static').setDepth(4);
        const srcH = sprite.height || 16;
        const baseScale = (SCARAB.radius * 3.6) / srcH;
        sprite.setScale(baseScale);
        // Two independent hashes so each scarab gets its own crawl pace AND its
        // own leg-animation tempo — the swarm spreads across a wide, slow range.
        const h1 = this.scarabHash(sc.id, 12.9898);
        const h2 = this.scarabHash(sc.id, 78.233);
        // Very low easing (~0.012–0.05) => deliberate, drawn-out crawling.
        const glide = 0.012 + h1 * 0.04;
        // Leg tempo wanders from a sluggish 0.18 up to 0.7.
        const speed = 0.18 + h2 * 0.52;
        rec = {
          sprite,
          disp: { x: tx, y: ty },
          prevState: sc.state,
          baseScale,
          speed,
          glide,
          cue: false,
          walking: false,
        };
        this.scarabSprites.set(sc.id, rec);
      }
      const spr = rec.sprite;

      // Start the slow walk loop once frames decode, desynced per scarab so the
      // swarm never marches in lockstep.
      if (this.scarabAnimReady && !rec.walking) {
        spr.play({ key: 'scarab-walk', startFrame: sc.id % this.scarabFrameCount });
        spr.anims.timeScale = rec.speed;
        rec.walking = true;
      }

      // Glide toward the target spot so the running motion reads clearly.
      const prevX = rec.disp.x;
      rec.disp.x += (tx - rec.disp.x) * rec.glide;
      rec.disp.y += (ty - rec.disp.y) * rec.glide;
      spr.setPosition(rec.disp.x, rec.disp.y);
      const dx = rec.disp.x - prevX;
      if (Math.abs(dx) > 0.05) spr.setFlipX(dx < 0);

      // Fire a one-shot cue when a scarab bites (attached→returning) or delivers
      // its heal back home (returning→seeking).
      if (sc.state !== rec.prevState) {
        if (rec.prevState === 'attached' && sc.state === 'returning') {
          this.playScarabCue(rec, 'attack');
        } else if (rec.prevState === 'returning' && sc.state === 'seeking') {
          this.playScarabCue(rec, 'heal');
        }
        rec.prevState = sc.state;
      }

      // Resting tint (a cue tween owns the look while it plays).
      if (!rec.cue) spr.setTint(sc.state === 'attached' ? 0xffd27a : 0xffffff);
    }
    for (const [id, rec] of this.scarabSprites) {
      if (!live.has(id)) {
        this.tweens.killTweensOf(rec.sprite);
        rec.sprite.destroy();
        this.scarabSprites.delete(id);
      }
    }
  }

  /** Play a brief, clearly-readable cue when a scarab bites or heals. */
  private playScarabCue(rec: ScarabRec, kind: 'attack' | 'heal'): void {
    const spr = rec.sprite;
    this.tweens.killTweensOf(spr);
    rec.cue = true;
    spr.setScale(rec.baseScale);
    spr.setAngle(0);
    if (kind === 'attack') {
      // Sharp red lunge with a quick shake — a bite.
      spr.setTint(0xff5a5a);
      spr.anims.timeScale = rec.speed * 2.6;
      this.tweens.add({
        targets: spr,
        scaleX: rec.baseScale * 1.5,
        scaleY: rec.baseScale * 1.5,
        angle: { from: -16, to: 16 },
        duration: 85,
        yoyo: true,
        repeat: 1,
        ease: 'Quad.easeOut',
        onComplete: () => this.endScarabCue(rec),
      });
    } else {
      // Soft green swell — a heal delivered home.
      spr.setTint(0x8effc4);
      spr.anims.timeScale = rec.speed * 1.5;
      this.tweens.add({
        targets: spr,
        scaleX: rec.baseScale * 1.34,
        scaleY: rec.baseScale * 1.34,
        duration: 240,
        yoyo: true,
        ease: 'Sine.easeInOut',
        onComplete: () => this.endScarabCue(rec),
      });
    }
  }

  private endScarabCue(rec: ScarabRec): void {
    rec.cue = false;
    rec.sprite.setScale(rec.baseScale);
    rec.sprite.setAngle(0);
    rec.sprite.clearTint();
    rec.sprite.anims.timeScale = rec.speed;
  }

  /** Draw a tiny health pip above each wounded scarab (tracks smoothed motion). */
  private drawScarabHp(): void {
    if (!this.gs) return;
    const g = this.gfxScarab;
    g.clear();
    for (const sc of this.gs.scarabs) {
      const rec = this.scarabSprites.get(sc.id);
      if (!rec) continue;
      const frac = Math.max(0, Math.min(1, sc.hp / sc.maxHp));
      if (frac >= 1) continue;
      const r = SCARAB.radius;
      const w = r * 2.2;
      const x = rec.disp.x - w / 2;
      const y = rec.disp.y - r - 12;
      g.fillStyle(0x000000, 0.6).fillRect(x, y, w, 3);
      g.fillStyle(0x57d6a0, 0.95).fillRect(x, y, w * frac, 3);
    }
  }

  /** Draw the 45° "reality break" wedges where movement is forbidden. */
  private drawMutivargZones(g: Phaser.GameObjects.Graphics): void {
    for (const z of this.gs.mutivargZones) {
      const tint = z.owner === 1 ? COLORS.team1 : COLORS.team2;
      g.fillStyle(0x6644cc, 0.16).fillCircle(z.x, z.y, z.radius);
      g.lineStyle(2, tint, 0.6).strokeCircle(z.x, z.y, z.radius);
      g.lineStyle(1, 0x9988ff, 0.4).strokeCircle(z.x, z.y, z.radius * 0.6);
    }
  }

  private drawCorrosionPools(g: Phaser.GameObjects.Graphics): void {
    for (const pool of this.gs.corrosionPools) {
      g.fillStyle(0x467a3f, 0.2).fillCircle(pool.x, pool.y, pool.radius);
      g.lineStyle(2, 0x9dcf62, 0.65).strokeCircle(pool.x, pool.y, pool.radius);
      g.lineStyle(1, 0x263d2b, 0.8).strokeCircle(pool.x, pool.y, pool.radius * 0.62);
    }
    for (const zone of this.gs.hazardZones) {
      if (zone.toX != null && zone.toY != null) {
        g.lineStyle(zone.radius * 2, zone.color, 0.22);
        g.lineBetween(zone.x, zone.y, zone.toX, zone.toY);
        g.lineStyle(2, zone.color, 0.7);
        g.lineBetween(zone.x, zone.y, zone.toX, zone.toY);
        continue;
      }
      g.fillStyle(zone.color, 0.16).fillCircle(zone.x, zone.y, zone.radius);
      g.lineStyle(2, zone.color, 0.7).strokeCircle(zone.x, zone.y, zone.radius);
      g.lineStyle(1, zone.color, 0.35).strokeCircle(zone.x, zone.y, zone.radius * 0.7);
    }
  }

  private drawBarriers(g: Phaser.GameObjects.Graphics): void {
    for (const b of this.gs.barriers) {
      const tint = b.owner === 1 ? COLORS.team1 : COLORS.team2;
      if (b.shape === 'rect') {
        const corners = this.rectCorners(b.x, b.y, b.angle, b.range, b.thickness);
        g.fillStyle(0x6ad1ff, 0.18);
        g.beginPath();
        g.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i++) g.lineTo(corners[i].x, corners[i].y);
        g.closePath();
        g.fillPath();
        g.lineStyle(2, tint, 0.85);
        g.beginPath();
        g.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i++) g.lineTo(corners[i].x, corners[i].y);
        g.closePath();
        g.strokePath();
        continue;
      }
      const steps = 18;
      const pts: Vec2[] = [{ x: b.x, y: b.y }];
      for (let i = 0; i <= steps; i++) {
        const a = b.angle - b.halfAngle + (2 * b.halfAngle * i) / steps;
        pts.push({ x: b.x + Math.cos(a) * b.range, y: b.y + Math.sin(a) * b.range });
      }
      g.fillStyle(0xff5599, 0.14);
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.closePath();
      g.fillPath();
      g.lineStyle(2, tint, 0.7);
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.closePath();
      g.strokePath();
    }
  }

  /** The four corners of a rectangle centred at (cx,cy), oriented at `angle`. */
  private rectCorners(
    cx: number,
    cy: number,
    angle: number,
    length: number,
    thickness: number
  ): Vec2[] {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const hl = length / 2;
    const ht = thickness / 2;
    const local: Vec2[] = [
      { x: -hl, y: -ht },
      { x: hl, y: -ht },
      { x: hl, y: ht },
      { x: -hl, y: ht },
    ];
    return local.map((p) => ({
      x: cx + p.x * cos - p.y * sin,
      y: cy + p.x * sin + p.y * cos,
    }));
  }

  /** Draw a spell's area-of-effect footprint while aiming a point spell. */
  private drawAoePreview(
    g: Phaser.GameObjects.Graphics,
    origin: Vec2,
    toward: Vec2,
    aoe: NonNullable<Spell['aoe']>
  ): void {
    if (aoe.kind === 'circle') {
      g.fillStyle(COLORS.selected, 0.1).fillCircle(toward.x, toward.y, aoe.radius);
      g.lineStyle(2, COLORS.selected, 0.7).strokeCircle(toward.x, toward.y, aoe.radius);
      return;
    }
    // Cone: a wedge from the caster toward the pointer.
    const base = Math.atan2(toward.y - origin.y, toward.x - origin.x);
    const half = (((aoe.degrees ?? 90) * Math.PI) / 180) / 2;
    const r = aoe.radius;
    const steps = 14;
    const pts: Vec2[] = [{ x: origin.x, y: origin.y }];
    for (let i = 0; i <= steps; i++) {
      const a = base - half + (2 * half * i) / steps;
      pts.push({ x: origin.x + Math.cos(a) * r, y: origin.y + Math.sin(a) * r });
    }
    g.fillStyle(COLORS.selected, 0.12);
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.closePath();
    g.fillPath();
    g.lineStyle(2, COLORS.selected, 0.6);
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.closePath();
    g.strokePath();
  }

  /**
   * Preview a two-point cone (Reality Shatter): a wedge from `apex` spanning the
   * directions to `edgeA` and `edgeB`, reaching out to `length` px.
   */
  private drawTwoPointWedge(
    g: Phaser.GameObjects.Graphics,
    apex: Vec2,
    edgeA: Vec2,
    edgeB: Vec2,
    length: number
  ): void {
    const angA = Math.atan2(edgeA.y - apex.y, edgeA.x - apex.x);
    const angB = Math.atan2(edgeB.y - apex.y, edgeB.x - apex.x);
    let diff = angB - angA;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    const base = angA + diff / 2;
    const half = Math.min(Math.abs(diff) / 2, (85 * Math.PI) / 180);
    const steps = 16;
    const pts: Vec2[] = [{ x: apex.x, y: apex.y }];
    for (let i = 0; i <= steps; i++) {
      const a = base - half + (2 * half * i) / steps;
      pts.push({ x: apex.x + Math.cos(a) * length, y: apex.y + Math.sin(a) * length });
    }
    g.fillStyle(0xff5599, 0.12);
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.closePath();
    g.fillPath();
    g.lineStyle(2, 0xff5599, 0.7);
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.closePath();
    g.strokePath();
  }

  private drawMeasuredRange(
    g: Phaser.GameObjects.Graphics,
    origin: Vec2,
    radius: number,
    color: number = MENU_COLOR.verdigris,
    alpha = 0.72,
    fill = true,
  ): void {
    if (fill) g.fillStyle(color, 0.035).fillCircle(origin.x, origin.y, radius);
    // A slow breath so the ring reads as live rather than printed on the floor.
    const breath = this.reducedMotion ? 0 : Math.sin(this.time.now / 420);
    g.lineStyle(1, color, alpha * (0.82 + breath * 0.18)).strokeCircle(origin.x, origin.y, radius);
    const ticks = radius > 260 ? 20 : 12;
    const drift = this.reducedMotion ? 0 : (this.time.now / 5200) % (Math.PI * 2);
    for (let index = 0; index < ticks; index++) {
      const angle = (index / ticks) * Math.PI * 2 + drift;
      const inner = radius - (index % 2 === 0 ? 7 : 4);
      const outer = radius + (index % 2 === 0 ? 4 : 2);
      g.lineBetween(
        origin.x + Math.cos(angle) * inner,
        origin.y + Math.sin(angle) * inner,
        origin.x + Math.cos(angle) * outer,
        origin.y + Math.sin(angle) * outer,
      );
    }
  }

  private drawAimGuide(g: Phaser.GameObjects.Graphics, from: Vec2, to: Vec2): void {
    g.lineStyle(3, MENU_COLOR.pitch, 0.72).lineBetween(from.x, from.y, to.x, to.y);
    g.lineStyle(1, MENU_COLOR.brassLight, 0.9).lineBetween(from.x, from.y, to.x, to.y);
    const radius = 9;
    const arm = 6;
    g.lineStyle(2, MENU_COLOR.brassLight, 0.95);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const x = to.x + sx * radius;
      const y = to.y + sy * radius;
      g.lineBetween(x, y, x - sx * arm, y);
      g.lineBetween(x, y, x, y - sy * arm);
    }
  }

  private drawAimingRange(g: Phaser.GameObjects.Graphics): void {
    // Interactive sub-targeting: draw the reach from its origin and an aim line.
    if (this.mode === 'subtarget-point' || this.mode === 'subtarget-enemy') {
      const origin = this.subtargetOrigin ?? this.gs.current.pos;
      if (this.subtargetRange > 0 && Number.isFinite(this.subtargetRange)) {
        this.drawMeasuredRange(g, origin, this.subtargetRange);
      }
      if (this.subtargetMinRange > 0) {
        this.drawMeasuredRange(g, origin, this.subtargetMinRange, MENU_COLOR.blood, 0.55, false);
      }
      this.drawAimGuide(g, origin, this.pointer);
      return;
    }

    const aiming = this.mode.startsWith('aiming');
    // While aiming, the origin is the active source (current mage on a turn, or
    // the reactor while reaction-aiming). When merely previewing a selected
    // combo, anchor the range to the mage whose hand is shown (the reactor
    // during a reaction, the local player online) — never the enemy.
    const me = aiming ? (this.aimingSource ?? this.gs.current) : this.viewMage;
    if (this.controllerIsAI(me) && !aiming) return;

    if (this.mode === 'aiming-shadow-dagger') {
      const hovered = this.gs.shadowAt(this.pointer);
      for (const shadow of this.gs.shadows) {
        const selected = hovered === shadow;
        g.fillStyle(COLORS.shadow, selected ? 0.24 : 0.1).fillCircle(shadow.x, shadow.y, shadow.radius);
        g.lineStyle(selected ? 3 : 2, selected ? COLORS.selected : COLORS.shadow, selected ? 1 : 0.75)
          .strokeCircle(shadow.x, shadow.y, shadow.radius);
      }
      if (hovered) {
        this.drawAimGuide(g, me.pos, hovered);
      }
      return;
    }

    let range = 0;
    if (this.mode === 'aiming-move') range = me.moveRange();
    else if (this.mode === 'aiming-leap') {
      // The farthest a leap can carry: a max d6 roll of 6.
      range = (1 + 0.25 * me.effectiveDex()) * RANGE_UNIT;
    } else if (this.mode === 'aiming-cleave') {
      const weapon = me.activeWeapon();
      range = weapon ? weapon.rangePx : MELEE_RANGE;
    } else if (this.mode === 'aiming-edgelord-throw') {
      range = Math.max(0, me.effectiveStr()) * RANGE_UNIT;
    } else if (this.mode === 'aiming-melee') {
      const weapon = me.activeWeapon();
      range = weapon ? weapon.rangePx : MELEE_RANGE;
      // Draw the dead-zone of a minimum-range weapon (e.g. the sniper bow).
      if (weapon?.minRangePx) {
        this.drawMeasuredRange(g, me.pos, weapon.minRangePx, MENU_COLOR.blood, 0.55, false);
      }
    } else if (this.mode === 'aiming-spell' || this.mode === 'aiming-point') {
      const spell = this.reactionAiming ? this.reactionPendingSpell : this.pendingSpell;
      if (spell) range = spell.range;
    } else if (this.mode === 'aiming-wall') {
      if (this.pendingSpell) range = this.pendingSpell.range;
    } else {
      const spell = this.currentComboSpell();
      if (spell && spell.range > 0) range = spell.range;
    }
    if (range > 0 && Number.isFinite(range)) {
      this.drawMeasuredRange(g, me.pos, range);
    }

    // Owned shadows extend reach — outline them as alternate cast origins.
    if (aiming && (this.mode === 'aiming-spell' || this.mode === 'aiming-point') && Number.isFinite(range)) {
      for (const s of this.gs.shadowsOf(me.team)) {
        this.drawMeasuredRange(g, s, range, MENU_COLOR.amethyst, 0.55, false);
      }
    }

    // Aiming preview line.
    if (aiming) {
      this.drawAimGuide(g, me.pos, this.pointer);
    }

    // Area-of-effect footprint while aiming a point spell (cone / circle).
    if (aiming && this.mode === 'aiming-point') {
      const spell = this.reactionAiming ? this.reactionPendingSpell : this.pendingSpell;
      if (spell?.twoPointAim) {
        if (this.pendingFirstPoint) {
          // Two-point cone: once the first edge is set, preview the wedge spanning
          // that edge and the pointer, reaching out to the field's edge.
          const diag = Math.hypot(FIELD.w, FIELD.h);
          this.drawTwoPointWedge(g, me.pos, this.pendingFirstPoint, this.pointer, diag);
        }
      } else if (spell?.aoe) {
        const reach = Number.isFinite(spell.range) ? spell.range : 99999;
        const toward = stepTowards(me.pos, this.pointer, reach);
        this.drawAoePreview(g, me.pos, toward, spell.aoe);
      }
    }
    if (aiming && this.mode === 'aiming-edgelord-throw') {
      const toward = stepTowards(me.pos, this.pointer, range);
      g.fillStyle(0x160f22, 0.22).fillCircle(toward.x, toward.y, 5 * RANGE_UNIT);
      g.lineStyle(2, 0x8a5aa5, 0.9).strokeCircle(toward.x, toward.y, 5 * RANGE_UNIT);
    }

    // Rotatable rectangular wall preview (blue Wall ability).
    if (aiming && this.mode === 'aiming-wall' && this.pendingSpell?.rotatableWall) {
      const dims = this.pendingSpell.rotatableWall;
      const center = stepTowards(me.pos, this.pointer, this.pendingSpell.range);
      const corners = this.rectCorners(
        center.x,
        center.y,
        this.wallAimAngle,
        dims.length,
        dims.thickness
      );
      g.fillStyle(0x6ad1ff, 0.18);
      g.beginPath();
      g.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i++) g.lineTo(corners[i].x, corners[i].y);
      g.closePath();
      g.fillPath();
      g.lineStyle(2, COLORS.selected, 0.85);
      g.beginPath();
      g.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i++) g.lineTo(corners[i].x, corners[i].y);
      g.closePath();
      g.strokePath();
    }
  }

  private buildMageAnimations(): void {
    for (const set of [...ANIM_SETS, ...FX_FRAME_SETS]) {
      if (this.anims.exists(set.key)) continue;
      this.anims.create({
        key: set.key,
        frames: set.frames.map((_, i) => ({ key: `${set.key}-${i}` })),
        frameRate: set.frameRate,
        repeat: set.repeat,
      });
    }
    for (const set of CREATURE_ANIM_SETS) {
      if (this.anims.exists(set.key)) continue;
      this.anims.create({
        key: set.key,
        frames: this.anims.generateFrameNumbers(set.key, { start: 0, end: set.end }),
        frameRate: set.frameRate,
        repeat: set.repeat,
      });
    }
    for (const set of WISP_ANIM_SETS) {
      if (this.anims.exists(set.key)) continue;
      this.anims.create({
        key: set.key,
        frames: set.frames.map((frame) => ({ key: 'enemy-wisp-sheet', frame })),
        frameRate: set.frameRate,
        repeat: set.repeat,
      });
    }
    for (const set of DEFENDER_ANIM_SETS) {
      if (this.anims.exists(set.key)) continue;
      this.anims.create({
        key: set.key,
        frames: set.frames.map((frame) => ({ key: 'enemy-defender-sheet', frame })),
        frameRate: set.frameRate,
        repeat: set.repeat,
      });
    }
    // One-shot hit-effect overlays (target-anchored spell impacts).
    const fx: { key: string; end: number; frameRate: number; repeat?: number }[] = [
      { key: 'fx-dot', end: 24, frameRate: 16 },
      { key: 'fx-generic', end: 9, frameRate: 18 },
      { key: 'fx-root', end: 7, frameRate: 16 },
      { key: 'fx-stun', end: 15, frameRate: 14, repeat: -1 },
      { key: 'fx-vanish', end: 20, frameRate: 24 },
      { key: 'fx-shatter', end: 6, frameRate: 18 },
      { key: 'fx-disrupt', end: 30, frameRate: 30 },
      { key: 'fx-edgelord-impact', end: 9, frameRate: 22 },
      { key: 'fx-summon-smoke', end: 9, frameRate: 18 },
    ];
    for (const f of fx) {
      if (this.anims.exists(f.key)) continue;
      this.anims.create({
        key: f.key,
        frames: this.anims.generateFrameNumbers(f.key, { start: 0, end: f.end }),
        frameRate: f.frameRate,
        repeat: f.repeat ?? 0,
      });
    }
    registerLightningFxAnimations(this);
    if (!this.anims.exists(SWAMP_MIST_KEY)) {
      this.anims.create({
        key: SWAMP_MIST_KEY,
        frames: this.anims.generateFrameNumbers(SWAMP_MIST_KEY, {
          start: 0,
          end: SWAMP_MIST_FRAME.end,
        }),
        frameRate: SWAMP_MIST_FRAME.frameRate,
        repeat: -1,
        yoyo: true,
      });
    }
  }

  /** Build a compact wooden pixel-art arsenal shared by all held-item overlays. */
  private buildHeldWeaponTextures(): void {
    const kinds: HeldWeaponKind[] = [
      'sword', 'dagger', 'spear', 'axe', 'hammer', 'club', 'bow', 'staff', 'shield', 'lantern',
    ];
    const woodDark = 0x3a2417;
    const wood = 0x87552c;
    const woodLight = 0xc98a48;
    const binding = 0xe0bd78;
    const edgeDark = 0x424a50;
    const edge = 0xaeb8bd;
    const edgeLight = 0xe1e7e5;

    for (const kind of kinds) {
      const key = `held-wood-${kind}`;
      if (this.textures.exists(key)) continue;
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      const rect = (color: number, x: number, y: number, width: number, height: number): void => {
        g.fillStyle(color, 1).fillRect(x, y, width, height);
      };
      const shaft = (x = 14, y = 8, height = 22): void => {
        rect(woodDark, x, y, 5, height);
        rect(wood, x + 1, y, 3, height);
        rect(woodLight, x + 2, y + 1, 1, height - 2);
      };

      if (kind === 'sword' || kind === 'dagger') {
        const bladeTop = kind === 'dagger' ? 10 : 3;
        rect(edgeDark, 13, bladeTop + 2, 7, 19 - bladeTop);
        rect(edge, 14, bladeTop + 1, 5, 20 - bladeTop);
        rect(edgeLight, 15, bladeTop, 2, 20 - bladeTop);
        g.fillStyle(edgeDark, 1).fillTriangle(13, bladeTop + 3, 16, bladeTop - 1, 20, bladeTop + 3);
        g.fillStyle(edgeLight, 1).fillTriangle(15, bladeTop + 2, 16, bladeTop, 18, bladeTop + 2);
        rect(binding, 10, 21, 13, 3);
        rect(woodDark, 14, 24, 5, 7);
        rect(woodLight, 15, 24, 2, 6);
      } else if (kind === 'spear') {
        shaft(14, 7, 24);
        rect(binding, 12, 8, 9, 3);
        g.fillStyle(edgeDark, 1).fillTriangle(10, 9, 16, 0, 22, 9);
        g.fillStyle(edge, 1).fillTriangle(12, 8, 16, 1, 20, 8);
        rect(edgeLight, 15, 2, 2, 6);
      } else if (kind === 'axe') {
        shaft(14, 6, 25);
        rect(binding, 12, 8, 8, 4);
        g.fillStyle(edgeDark, 1).fillTriangle(17, 3, 28, 5, 26, 16);
        g.fillStyle(edge, 1).fillTriangle(18, 4, 26, 6, 24, 14);
        rect(edgeLight, 23, 7, 3, 6);
      } else if (kind === 'hammer') {
        shaft(14, 8, 23);
        rect(edgeDark, 5, 3, 23, 9);
        rect(edge, 6, 4, 21, 7);
        rect(edgeLight, 8, 5, 16, 2);
        rect(binding, 13, 10, 7, 3);
      } else if (kind === 'club') {
        shaft(14, 12, 19);
        rect(woodDark, 10, 3, 13, 13);
        rect(wood, 11, 2, 11, 13);
        rect(woodLight, 13, 3, 4, 10);
        rect(binding, 11, 14, 11, 3);
      } else if (kind === 'bow') {
        rect(woodLight, 9, 4, 3, 5);
        rect(wood, 6, 8, 4, 6);
        rect(woodDark, 5, 13, 4, 7);
        rect(wood, 7, 20, 4, 6);
        rect(woodLight, 10, 25, 3, 4);
        g.lineStyle(1, binding, 1);
        g.lineBetween(11, 4, 18, 16);
        g.lineBetween(18, 16, 12, 29);
        rect(edge, 17, 4, 2, 25);
        g.fillStyle(edgeLight, 1).fillTriangle(14, 6, 18, 1, 22, 6);
      } else if (kind === 'staff') {
        shaft(14, 5, 27);
        rect(binding, 12, 9, 9, 3);
        g.fillStyle(woodDark, 1).fillCircle(16, 5, 7);
        g.fillStyle(wood, 1).fillCircle(16, 4, 5);
        g.fillStyle(0x66c8d4, 1).fillCircle(16, 4, 2);
        rect(0xb8f4ed, 15, 2, 2, 2);
      } else if (kind === 'lantern') {
        g.lineStyle(3, edgeDark, 1).strokeCircle(16, 9, 7);
        g.lineStyle(1, edgeLight, 0.8).strokeCircle(16, 9, 5);
        rect(edgeDark, 8, 10, 16, 19);
        rect(edge, 10, 12, 12, 15);
        rect(0x160b1d, 12, 14, 8, 11);
        rect(0x8a5aa5, 14, 16, 4, 7);
        rect(0xd7a6e3, 15, 17, 2, 4);
        rect(binding, 7, 10, 18, 3);
        rect(binding, 7, 27, 18, 3);
      } else {
        g.fillStyle(woodDark, 1).fillCircle(16, 16, 13);
        g.fillStyle(wood, 1).fillCircle(16, 16, 11);
        rect(woodLight, 12, 6, 3, 20);
        rect(woodDark, 18, 6, 3, 20);
        rect(binding, 6, 14, 20, 4);
        g.lineStyle(2, edge, 1).strokeCircle(16, 16, 11);
      }
      g.generateTexture(key, 32, 32);
      g.destroy();
    }
  }

  private heldWeaponKind(mage: Mage, itemId: ItemId): HeldWeaponKind {
    const def = getItem(itemId);
    const label = `${itemId} ${def.name}`.toLowerCase();
    if (def.edgelordLantern) return 'lantern';
    if (itemId === 'bastionSword') return mage.bastionShieldForm ? 'shield' : 'sword';
    if (def.weaponFamily === 'bow' || label.includes('bow')) return 'bow';
    if (def.weaponFamily === 'hammer' || /hammer|maul/.test(label)) return 'hammer';
    if (/spear|pike|lance|trident/.test(label)) return 'spear';
    if (/axe|hatchet/.test(label)) return 'axe';
    if (/club|mace|cudgel/.test(label)) return 'club';
    if (def.shield || /shield|buckler/.test(label)) return 'shield';
    if (def.isWand || /wand|staff|rod/.test(label)) return 'staff';
    if (/dagger|knife|needle/.test(label)) return 'dagger';
    return 'sword';
  }

  private syncHeldWeapon(mage: Mage, rec: MageAnim, alpha: number): void {
    if (creatureSpriteKind(mage)) {
      rec.held?.setVisible(false);
      return;
    }
    const itemId =
      mage.activeWeaponId() ?? mage.hands.find((id) => !!getItem(id).edgelordLantern) ?? null;
    if (!mage.alive || !itemId) {
      rec.held?.setVisible(false);
      return;
    }
    const kind = this.heldWeaponKind(mage, itemId);
    const key = `held-wood-${kind}`;
    if (!rec.held) {
      rec.held = this.add.image(0, 0, key).setOrigin(0.5, 0.78).setDepth(5.2);
    } else if (rec.heldVisualKey !== key) {
      rec.held.setTexture(key);
    }
    rec.heldVisualKey = key;

    const facing = rec.sprite.flipX ? -1 : 1;
    const visualScale = mage.mine ? mineEnemyVisual(mage).scale : 1;
    const baseSize: Record<HeldWeaponKind, number> = {
      sword: 43,
      dagger: 35,
      spear: 52,
      axe: 45,
      hammer: 45,
      club: 43,
      bow: 46,
      staff: 49,
      shield: 38,
      lantern: 38,
    };
    const size = baseSize[kind] * Phaser.Math.Clamp(visualScale, 0.8, 1.55);
    const attacking = rec.lock === 'attack';
    rec.held
      .setDisplaySize(size, size)
      .setPosition(
        rec.sprite.x + facing * MAGE_RADIUS * 0.48,
        rec.sprite.y - MAGE_RADIUS * 1.15 + (attacking ? 3 : 0)
      )
      .setFlipX(facing < 0)
      .setRotation(facing * (attacking ? 1.02 : 0.38))
      .setAlpha(alpha)
      .setVisible(true);
  }

  private mageAnims = new Map<Mage, MageAnim>();

  // Scarab sprites: one animated sprite per live scarab, with a smoothed
  // display position so they glide between turns instead of teleporting.
  private scarabSprites = new Map<number, ScarabRec>();
  private scarabAnimReady = false;
  private scarabFrameCount = 1;

  /** Mages awaiting a hit recoil; flushed after their damage dice resolve. */
  private pendingHits: Mage[] = [];

  /**
   * Queued impact reactions. The spell that caused each one is only knowable
   * while it resolves, so the weight is resolved at queue time and replayed
   * later beside the recoil it belongs to.
   */
  private pendingImpacts: QueuedImpact[] = [];

  /** Orders rolls against impacts so a roll can find the bodies it landed on. */
  private vfxSeq = 0;

  /** Set while a spell resolves when the player wants one roll at the end. */
  private deferDice = false;

  /** Sounds for queued visuals, played when those visuals actually appear. */
  private pendingSounds: SoundName[] = [];

  /** Queued one-shot hit-effect overlays; flushed alongside hit recoils. */
  private pendingEffects: {
    mage: Mage;
    kind: 'generic' | 'corrosive' | 'vanish' | 'disrupt';
  }[] = [];

  /** Queued drain streams; flushed alongside the impact that created them. */
  private pendingDrains: { from: Vec2; to: Vec2 }[] = [];

  /** One compact puff per minion created during the resolving cast. */
  private pendingSummonPuffs: { at: Vec2; size: number }[] = [];

  /** Face the closest opponent, accounting for each sheet's authored direction. */
  private creatureShouldFlipX(mage: Mage): boolean {
    let nearest: Mage | null = null;
    let nearestDistance = Infinity;
    for (const candidate of this.gs.mages) {
      if (
        candidate === mage ||
        candidate.team === mage.team ||
        !candidate.alive ||
        candidate.edgelordCapturedBy
      ) continue;
      const distance = dist(mage.pos, candidate.pos);
      if (distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }
    const kind = creatureSpriteKind(mage);
    const nativeFacesRight = kind === 'wisp' || kind === 'defender';
    if (nearest && nearest.x !== mage.x) {
      const targetIsRight = nearest.x > mage.x;
      return nativeFacesRight ? !targetIsRight : targetIsRight;
    }
    return nativeFacesRight ? mage.team === 2 : mage.team !== 2;
  }

  /** Create/position each mage's sprite and pick its resting animation. */
  private syncMageSprites(): void {
    if (!this.gs) return;
    const roster = new Set(this.gs.mages);
    for (const [mage, rec] of this.mageAnims) {
      if (roster.has(mage)) continue;
      rec.sprite.destroy();
      rec.held?.destroy();
      rec.root?.destroy();
      rec.stun?.destroy();
      this.mageAnims.delete(mage);
      this.mageLabels.get(mage)?.destroy();
      this.mageLabels.delete(mage);
    }
    // Frames are bottom-aligned (the 16x16 idle/run/role/hit sets and the 32x32
    // attack/charge sets all rest their feet on the frame's bottom edge), so
    // anchor sprites by the feet. This keeps every animation's body in line; the
    // taller frames simply extend their staff-swing headroom upward.
    const footY = MAGE_RADIUS * 1.4;
    for (const m of this.gs.mages) {
      let rec = this.mageAnims.get(m);
      if (!rec) {
        const customCreature = creatureSpriteKind(m) !== null;
        const idleKey = bodyAnimationKey(m, 'idle');
        const kind = creatureSpriteKind(m);
        const textureKey =
          kind === 'wisp'
            ? 'enemy-wisp-sheet'
            : kind === 'defender'
              ? 'enemy-defender-sheet'
              : idleKey;
        const sprite = this.add
          .sprite(m.x, m.y, customCreature ? textureKey : 'mage-idle-0')
          .setOrigin(0.5, customCreature ? 0.9 : 1)
          .setDepth(5);
        sprite.play(idleKey);
        const srcH = sprite.height || 1;
        sprite.setScale((customCreature ? CREATURE_SPRITE_HEIGHT : MAGE_RADIUS * 2.8) / srcH);
        rec = {
          sprite,
          lock: null,
          posLocked: false,
          charging: false,
          deathPending: false,
          deathComplete: false,
        };
        this.mageAnims.set(m, rec);
      }
      const s = rec.sprite;
      const customCreature = creatureSpriteKind(m) !== null;
      s.setOrigin(0.5, customCreature ? 0.9 : 1);
      if (m.alive && (rec.deathPending || rec.deathComplete || rec.lock === 'death')) {
        this.tweens.killTweensOf(s);
        rec.deathPending = false;
        rec.deathComplete = false;
        if (rec.lock === 'death') rec.lock = null;
        s.setAngle(0);
      }
      if (m.mine) this.styleMineEnemySprite(m);
      if (!rec.posLocked) s.setPosition(m.x, m.y + footY + this.mineSpriteBob(m));
      s.setFlipX(customCreature ? this.creatureShouldFlipX(m) : m.team === 2);
      if (!m.alive) {
        const showingDeath =
          customCreature && !rec.deathComplete && (rec.deathPending || rec.lock === 'death');
        s.setVisible(showingDeath);
        if (showingDeath) s.setAlpha(1);
        rec.held?.setVisible(false);
        rec.root?.destroy();
        rec.root = undefined;
        rec.stun?.destroy();
        rec.stun = undefined;
        continue;
      }
      if (m.oniHidden) {
        s.setVisible(false);
        rec.held?.setVisible(false);
        rec.root?.setVisible(false);
        rec.stun?.setVisible(false);
        continue;
      }
      s.setVisible(true);
      const alpha = this.mageVisibilityAlpha(m);
      s.setAlpha(alpha);
      this.syncHeldWeapon(m, rec, alpha);
      this.syncRootOverlay(m, rec, footY, alpha);
      this.syncStunOverlay(m, rec, alpha);
      // Resting animation: charge while a spell is pending, otherwise idle.
      if (rec.lock === null) {
        const want = bodyAnimationKey(m, rec.charging ? 'charge' : 'idle');
        if (s.anims.currentAnim?.key !== want) s.play(want, true);
        // Roots hold the body fast, so its resting loop stops dead.
        if (this.isPhysicallyRooted(m)) s.anims.stop();
        else if (!s.anims.isPlaying) s.play(want, true);
      }
    }
  }

  /** True while a physical binding — not terrain — holds this mage in place. */
  private isPhysicallyRooted(m: Mage): boolean {
    return m.statuses.some(
      (s) => s.kind === 'stun' && s.stunType === 'movement' && s.physicalRoot === true
    );
  }

  /** Keep binding roots wrapped around a mage for as long as the root holds. */
  private syncRootOverlay(m: Mage, rec: MageAnim, footY: number, alpha: number): void {
    if (!m.alive || m.oniHidden || !this.isPhysicallyRooted(m)) {
      rec.root?.destroy();
      rec.root = undefined;
      return;
    }
    if (!this.anims.exists('fx-root')) return;
    if (!rec.root) {
      const size = MAGE_RADIUS * 4.6;
      const roots = this.add
        .sprite(m.x, m.y + footY, 'fx-root', 0)
        .setOrigin(0.5, 1)
        .setDepth(5.1)
        .setDisplaySize(size, size);
      // Grow once, then stay clamped on the last frame as a lasting affliction.
      if (this.reducedMotion) roots.setFrame(7);
      else {
        roots.play('fx-root');
        roots.once('animationcomplete', () => roots.setFrame(7));
      }
      rec.root = roots;
    }
    rec.root
      .setPosition(m.x, m.y + footY + this.mineSpriteBob(m))
      .setAlpha(alpha)
      .setVisible(true);
  }

  /** Spin a ring of stars over a fully stunned head until the stun wears off. */
  private syncStunOverlay(m: Mage, rec: MageAnim, alpha: number): void {
    const stunned = m.statuses.some((s) => s.kind === 'stun' && s.stunType === 'full');
    if (!m.alive || m.oniHidden || !stunned) {
      rec.stun?.destroy();
      rec.stun = undefined;
      return;
    }
    if (!this.anims.exists('fx-stun')) return;
    const size = MAGE_RADIUS * 4.2;
    if (!rec.stun) {
      const ring = this.add
        .sprite(rec.sprite.x, rec.sprite.y, 'fx-stun', 0)
        .setDepth(6)
        .setDisplaySize(size, size);
      ring.play('fx-stun');
      rec.stun = ring;
    }
    // Track the body sprite so the ring rides along with dashes and recoils.
    const customCreature = creatureSpriteKind(m) !== null;
    const bodyHeight = customCreature ? CREATURE_SPRITE_HEIGHT : MAGE_RADIUS * 2.8;
    const headTop = rec.sprite.y - bodyHeight * (customCreature ? 0.9 : 1);
    rec.stun
      .setPosition(rec.sprite.x, headTop - size * 0.08)
      .setAlpha(alpha)
      .setVisible(true);
  }

  private setCharging(m: Mage, on: boolean): void {
    const rec = this.mageAnims.get(m);
    if (rec) rec.charging = on;
    if (on) this.startCastGather(m);
    else this.castGathers.get(m)?.remove();
  }

  private castGathers = new Map<Mage, Phaser.Time.TimerEvent>();

  /** Motes drawn inward while a spell is held on the stack, so a cast has a wind-up. */
  private startCastGather(m: Mage): void {
    if (this.reducedMotion) return;
    this.castGathers.get(m)?.remove();
    const timer = this.time.addEvent({
      delay: 190,
      loop: true,
      callback: () => {
        const rec = this.mageAnims.get(m);
        if (!m.alive || !rec?.charging) {
          timer.remove();
          this.castGathers.delete(m);
          return;
        }
        const angle = Math.random() * Math.PI * 2;
        const away = 52 + Math.random() * 26;
        this.particleFx?.burst(
          { x: m.x + Math.cos(angle) * away, y: m.y + Math.sin(angle) * away },
          {
            color: MENU_COLOR.brassLight,
            count: 2,
            speed: 0,
            lifespan: 300,
            shape: 'mote',
            size: 9,
            glow: true,
            depth: 9.4,
          }
        );
      },
    });
    this.castGathers.set(m, timer);
  }

  /** Queue a hit recoil to play once the damage dice have resolved. */
  private playHit(m: Mage): void {
    if (!this.pendingHits.includes(m)) this.pendingHits.push(m);
  }

  /**
   * Record how hard a blow landed while its cause is still known, so the
   * matching debris, flash and shake can play beside the recoil later.
   */
  private queueImpact(mage: Mage, feedback: CombatFeedback): void {
    const source = feedback.source;
    const angle = source && source !== mage
      ? Math.atan2(mage.y - source.y, mage.x - source.x)
      : undefined;
    this.pendingImpacts.push({
      mage,
      feedback,
      severity: this.impactSeverity(mage, feedback),
      angle,
      weight: this.impactWeight(),
      seq: this.vfxSeq++,
    });
  }

  /** What share of the relevant pool this hit took, 0-1. */
  private impactSeverity(mage: Mage, feedback: CombatFeedback): number {
    const amount = feedback.amount ?? 0;
    if (amount <= 0) return 0;
    const pool = feedback.kind === 'sanityDamage' || feedback.kind === 'sanityHeal'
      ? mage.maxSanity
      : mage.maxHp;
    return pool > 0 ? Math.min(1, amount / pool) : 0;
  }

  /** Only the word combinations listed as heavy may move the camera. */
  private impactWeight(): ImpactWeight | undefined {
    const spell = this.gs.resolvingSpell;
    if (!spell) return undefined;
    return SPELL_IMPACT_WEIGHT[comboKey(spell.words)];
  }

  /** Play every queued impact reaction and clear the queue. */
  private flushImpacts(): void {
    const queued = this.pendingImpacts;
    this.pendingImpacts = [];
    let shaken = false;
    for (const impact of queued) {
      this.combatFeedback?.show(impact.mage, impact.feedback);
      if (!this.impactFx) continue;
      // One blast that hits six bodies is still one blast: shake once.
      const weight = shaken ? undefined : impact.weight;
      if (weight) shaken = true;
      this.impactFx.play({
        at: { x: impact.mage.x, y: impact.mage.y },
        feedback: impact.feedback,
        severity: impact.severity,
        angle: impact.angle,
        weight,
        sprite: this.mageAnims.get(impact.mage)?.sprite,
      });
    }
  }

  /**
   * Voice one combat readout. Queued, not played: the matching visual only
   * appears once the damage dice have settled.
   */
  private playFeedbackSound(feedback: CombatFeedback): void {
    if (feedback.critical) this.pendingSounds.push('hit.crit');
    switch (feedback.kind) {
      case 'heal':
      case 'sanityHeal':
        this.pendingSounds.push('spell.heal');
        return;
      case 'miss':
        this.pendingSounds.push('melee.slash');
        return;
      case 'immune':
      case 'blocked':
        this.pendingSounds.push('hit.block');
        return;
      case 'sanityDamage':
        this.pendingSounds.push('spell.psychic');
        return;
      case 'damage': {
        // An enemy's blow always reads as a plain hit, whatever it is made of.
        const voice = feedback.source?.isAI
          ? 'hit.physical'
          : DAMAGE_SOUND[feedback.damageType ?? ''] ?? 'hit.physical';
        this.pendingSounds.push(voice);
        return;
      }
      default:
        return;
    }
  }

  /** Keep a defeated authored creature visible until its fatal animation plays. */
  private queueCreatureDeath(m: Mage): void {
    const kind = creatureSpriteKind(m);
    if (!kind || kind === 'wisp') return;
    const rec = this.mageAnims.get(m);
    if (rec) rec.deathPending = true;
    this.playHit(m);
  }

  /** Play every queued hit recoil and clear the queue. */
  private flushHits(): void {
    void this.flushHitsAndEffects();
  }

  /** Start queued recoils and await every associated overlay and drain stream. */
  private async flushHitsAndEffects(): Promise<void> {
    const queued = this.pendingHits;
    this.pendingHits = [];
    this.flushSounds();
    this.flushImpacts();
    for (const m of queued) this.triggerHit(m);
    await this.flushEffects();
  }

  /**
   * Voice the impact batch. Duplicates collapse to one hit, and the survivors
   * are spread apart so a six-target burst reads as a volley, not a chord.
   */
  private flushSounds(): void {
    if (this.pendingSounds.length === 0) return;
    const unique = [...new Set(this.pendingSounds)];
    this.pendingSounds = [];
    unique.forEach((name, index) => playSound(name, { delay: index * 0.055 }));
  }

  /** Spawn every queued hit-effect overlay and clear the queue. */
  private async flushEffects(): Promise<void> {
    const queued = this.pendingEffects;
    const drains = this.pendingDrains;
    const summonPuffs = this.pendingSummonPuffs;
    this.pendingEffects = [];
    this.pendingDrains = [];
    this.pendingSummonPuffs = [];
    if (summonPuffs.length > 0) this.redraw();
    await Promise.all([
      ...queued.map((effect) => this.triggerEffect(effect.mage, effect.kind)),
      ...drains.map((drain) => this.vfxDrainParticles(drain.from, drain.to)),
      ...summonPuffs.map((puff) => this.vfxSummonPuff(puff.at, puff.size)),
    ]);
  }

  /**
   * Mid-cast flush: reveal the dice rolled so far, then play the queued hit
   * animations. Lets a multi-step spell show a strike land before its next roll.
   */
  private async resolveImpacts(): Promise<void> {
    await this.playPendingDice();
    await this.flushHitsAndEffects();
  }

  /** Play a one-shot hit-effect overlay centred on a mage's body. */
  private triggerEffect(
    m: Mage,
    kind: 'generic' | 'corrosive' | 'vanish' | 'disrupt'
  ): Promise<void> {
    // The impact director now draws art matched to the damage type, so the old
    // catch-all magic burst would only contradict it. It stays queued because
    // resolveTop reads the queue to decide whether a spell needs 'disrupt'.
    if (kind === 'generic') return Promise.resolve();
    if (!m.alive && kind !== 'vanish' && kind !== 'corrosive') return Promise.resolve();
    const key = kind === 'corrosive' ? 'fx-dot' : `fx-${kind}`;
    if (!this.anims.exists(key)) return Promise.resolve();
    return new Promise((resolve) => {
      const spr = this.add.sprite(m.x, m.y, key).setDepth(9);
      const srcH = spr.height || 1;
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.events.off(Phaser.Scenes.Events.SHUTDOWN, finish);
        if (spr.active) spr.destroy();
        resolve();
      };
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, finish);
      spr.setScale((MAGE_RADIUS * 3) / srcH);
      spr.play(key);
      spr.once('animationcomplete', finish);
    });
  }

  /** Brief recoil when a mage takes damage; never interrupts movement/attack. */
  private triggerHit(m: Mage): void {
    const rec = this.mageAnims.get(m);
    if (!rec) return;
    const kind = creatureSpriteKind(m);
    if (kind === 'wisp') {
      if (!m.alive || rec.lock) return;
      rec.lock = 'hit';
      this.tweens.add({
        targets: rec.sprite,
        alpha: 0.18,
        duration: 70,
        yoyo: true,
        repeat: 1,
        onComplete: () => {
          if (rec.lock === 'hit') rec.lock = null;
        },
      });
      return;
    }
    if (!m.alive && kind) {
      this.triggerCreatureDeath(m, rec);
      return;
    }
    if (rec.lock) return;
    rec.lock = 'hit';
    const key = bodyAnimationKey(m, 'hurt');
    rec.sprite.play(key, true);
    rec.sprite.once(`animationcomplete-${key}`, () => {
      if (rec.lock === 'hit') rec.lock = null;
    });
  }

  /** Play Zombie death art; Skeleton falls after its Hurt strip. */
  private triggerCreatureDeath(m: Mage, rec: MageAnim): void {
    const kind = creatureSpriteKind(m);
    if (!kind || kind === 'wisp' || rec.deathComplete || rec.lock === 'death') return;
    this.tweens.killTweensOf(rec.sprite);
    rec.posLocked = false;
    rec.charging = false;
    rec.deathPending = false;
    rec.lock = 'death';
    const key = bodyAnimationKey(m, 'death');
    rec.sprite.setVisible(true).setAlpha(1).setAngle(0).play(key, true);

    const finish = (): void => {
      if (!rec.sprite.active) return;
      rec.deathComplete = true;
      if (rec.lock === 'death') rec.lock = null;
      rec.sprite.setVisible(false);
    };
    rec.sprite.once(`animationcomplete-${key}`, () => {
      if (kind !== 'skeleton' || !rec.sprite.active) {
        finish();
        return;
      }
      this.tweens.add({
        targets: rec.sprite,
        angle: rec.sprite.flipX ? 82 : -82,
        alpha: 0,
        duration: 155,
        ease: 'Quad.In',
        onComplete: finish,
      });
    });
  }

  /** Start the body's authored attack strip, then release it to idle. */
  private startBodyAttack(m: Mage): void {
    const rec = this.mageAnims.get(m);
    if (!rec || !m.alive) return;
    rec.charging = false;
    rec.lock = 'attack';
    const key = bodyAnimationKey(m, 'attack');
    rec.sprite.play(key, true);
    rec.sprite.once(`animationcomplete-${key}`, () => {
      if (rec.lock === 'attack') rec.lock = null;
    });
  }

  /** Play the ghost sheet's dedicated magic flourish over the struck target. */
  private playWispAttackFx(at: Vec2, source: Mage): Promise<void> {
    if (!this.anims.exists('enemy-wisp-fx')) return Promise.resolve();
    return new Promise((resolve) => {
      const sprite = this.add
        .sprite(at.x, at.y, 'enemy-wisp-sheet', 26)
        .setDepth(9)
        .setScale((MAGE_RADIUS * 3.2) / 32)
        .setFlipX(at.x < source.x);
      sprite.play('enemy-wisp-fx');
      sprite.once('animationcomplete-enemy-wisp-fx', () => {
        sprite.destroy();
        resolve();
      });
    });
  }

  /** Let the charge loop finish, then fire the one-shot attack (synced to VFX). */
  private async finishChargeThenAttack(m: Mage): Promise<void> {
    const rec = this.mageAnims.get(m);
    if (!rec) return;
    const chargeKey = bodyAnimationKey(m, 'charge');
    if (rec.sprite.anims.currentAnim?.key === chargeKey) {
      await this.waitForAnimationRepeat(rec.sprite, chargeKey, 850);
    }
    this.startBodyAttack(m);
  }

  private waitForAnimationRepeat(
    sprite: Phaser.GameObjects.Sprite,
    animationKey: string,
    maximumMs: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      let timer: Phaser.Time.TimerEvent | null = null;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        timer?.remove(false);
        sprite.off(Phaser.Animations.Events.ANIMATION_REPEAT, onRepeat);
        this.events.off(Phaser.Scenes.Events.SHUTDOWN, finish);
        resolve();
      };
      const onRepeat = (animation: Phaser.Animations.Animation): void => {
        if (animation.key === animationKey) finish();
      };
      sprite.on(Phaser.Animations.Events.ANIMATION_REPEAT, onRepeat);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, finish);
      timer = this.time.delayedCall(maximumMs, finish);
      if (!sprite.active || !sprite.anims.isPlaying) finish();
    });
  }

  /** Glide a mage to a point over ~1s while the run loop plays. */
  private animateMove(m: Mage, to: Vec2): Promise<void> {
    return new Promise((resolve) => {
      const rec = this.mageAnims.get(m);
      const from = { x: m.x, y: m.y };
      if (!rec || dist(from, to) < 1) {
        resolve();
        return;
      }
      rec.lock = 'move';
      rec.sprite.play(bodyAnimationKey(m, 'run'), true);
      const strides = this.startFootfalls(m, dist(from, to), FX_MOTION.move.duration);
      let settled = false;
      let timeout: Phaser.Time.TimerEvent | null = null;
      let tween: Phaser.Tweens.Tween | null = null;
      const finish = (snapToDestination = false): void => {
        if (settled) return;
        settled = true;
        strides.remove();
        timeout?.remove(false);
        this.events.off(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
        if (snapToDestination) {
          tween?.stop();
          m.x = to.x;
          m.y = to.y;
          this.redraw();
          console.warn(`${m.name}'s movement tween timed out; snapped to its resolved destination.`);
        }
        if (rec.lock === 'move') rec.lock = null;
        resolve();
      };
      const onShutdown = (): void => finish(false);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
      tween = this.tweens.add({
        targets: m,
        x: to.x,
        y: to.y,
        duration: FX_MOTION.move.duration,
        ease: FX_MOTION.move.ease,
        onUpdate: () => this.redraw(),
        onComplete: () => finish(false),
        onStop: () => finish(false),
      });
      timeout = this.time.delayedCall(FX_MOTION.move.duration + 300, () => finish(true));
    });
  }

  /** Visually slide a mage that has already jumped from `from`, playing Role. */
  private animateDash(m: Mage, from: Vec2): void {
    const rec = this.mageAnims.get(m);
    if (!rec) return;
    const footY = MAGE_RADIUS * 1.4;
    rec.lock = 'dash';
    rec.posLocked = true;
    rec.sprite.setPosition(from.x, from.y + footY);
    rec.sprite.play(bodyAnimationKey(m, 'role'), true);
    this.kickDust(from, 10, 150);
    this.tweens.add({
      targets: rec.sprite,
      x: m.x,
      y: m.y + footY,
      duration: FX_MOTION.dash.duration,
      ease: FX_MOTION.dash.ease,
      onComplete: () => {
        rec.lock = null;
        rec.posLocked = false;
        this.kickDust(m.pos, 8, 120);
      },
    });
  }

  /**
   * Footfalls while a unit walks: a puff and a step sound on a fixed cadence, so
   * a long march reads as more steps rather than a longer slide.
   */
  private startFootfalls(m: Mage, distance: number, duration: number): Phaser.Time.TimerEvent {
    const steps = Math.max(2, Math.min(9, Math.round(distance / 46)));
    return this.time.addEvent({
      delay: Math.max(90, duration / steps),
      repeat: steps - 1,
      callback: () => {
        if (!m.alive) return;
        this.kickDust(m.pos, 3, 55);
        playSound('move.step');
      },
    });
  }

  /** A low puff of ground dust at a unit's feet. */
  private kickDust(at: Vec2, count: number, speed: number): void {
    if (this.reducedMotion) return;
    this.particleFx?.burst(
      { x: at.x, y: at.y + MAGE_RADIUS * 0.8 },
      {
        color: 0xb9a689,
        count,
        speed,
        lifespan: 420,
        shape: 'smoke',
        size: 22,
        alpha: 0.3,
        gravityY: -20,
        spread: 22,
        drag: 0.86,
        depth: 4.6,
      }
    );
  }

  /** Pull every affected sprite inward without changing the model's settled position. */
  private animateEdgelordPull(m: Mage, from: Vec2, to: Vec2): Promise<void> {
    return new Promise((resolve) => {
      const rec = this.mageAnims.get(m);
      if (!rec || dist(from, to) < 1) {
        resolve();
        return;
      }
      const footY = MAGE_RADIUS * 1.4;
      rec.lock = 'pull';
      rec.posLocked = true;
      rec.sprite.setPosition(from.x, from.y + footY).setVisible(true);
      this.tweens.add({
        targets: rec.sprite,
        x: to.x,
        y: to.y + footY,
        duration: FX_MOTION.pull.duration,
        ease: FX_MOTION.pull.ease,
        onComplete: () => {
          rec.lock = null;
          rec.posLocked = false;
          resolve();
        },
      });
    });
  }

  private vfxLightningBolt(
    from: Vec2,
    to: Vec2,
    color = 0xa8dcff,
    thickness = 1,
  ): Promise<void> {
    return this.lightningFx?.bolt(from, to, color, thickness) ?? Promise.resolve();
  }

  private vfxLightningNova(at: Vec2, color: number, thickness = 1): Promise<void> {
    playSound('spell.lightning');
    return this.lightningFx?.nova(at, color, thickness) ?? Promise.resolve();
  }

  private vfxEdgelordImpact(at: Vec2): Promise<void> {
    return new Promise((resolve) => {
      if (!this.anims.exists('fx-edgelord-impact')) {
        resolve();
        return;
      }
      const sprite = this.add
        .sprite(at.x, at.y, 'fx-edgelord-impact', 0)
        .setDepth(31)
        .setDisplaySize(10 * RANGE_UNIT, 10 * RANGE_UNIT)
        .setBlendMode(Phaser.BlendModes.ADD);
      sprite.play('fx-edgelord-impact');
      sprite.once('animationcomplete', () => {
        sprite.destroy();
        resolve();
      });
    });
  }

  /** Rebuild the persistent animated Lightning Fire Pierce trail. */
  private setLightningTrail(segments: readonly { from: Vec2; to: Vec2 }[]): void {
    this.lightningFx?.setTrail(segments);
  }

  private clearLightningTrail(): void {
    this.lightningFx?.clearTrail();
  }

  private mineSpriteBob(m: Mage): number {
    if (m.mine?.kind !== 'cavern-bat') return 0;
    const phase = this.gs.mages.indexOf(m) * 0.8;
    return -7 + Math.sin(this.time.now / 180 + phase) * 5;
  }

  /** Draw model-derived Mine cues without adding any lockstep state. */
  private drawMineMarkers(): void {
    const g = this.gfxMine;
    g.clear();
    if (!this.mineRun) return;
    for (const m of this.gs.mages) {
      if (!m.alive || !m.mine) continue;
      const bob = this.mineSpriteBob(m);
      if (m.mine.kind === 'pftlhb') {
        const eyeY = m.y - 8 + bob;
        g.fillStyle(0xffd85a, 0.18).fillCircle(m.x, eyeY, 12);
        g.fillStyle(0xfff2a6, 0.95).fillCircle(m.x, eyeY, 5);
        g.fillStyle(0x2a1835, 1).fillCircle(m.x, eyeY, 2);
      }
      if (m.mine.kind === 'earth-elemental') {
        this.drawEarthElementalPebbles(g, m, bob);
      }
      if (m.isAirborne()) {
        const markerY = m.y + MAGE_RADIUS + 5 + bob;
        g.lineStyle(2, 0xcad5ff, 0.9).strokeEllipse(m.x, markerY, 34, 9);
        g.lineBetween(m.x - 8, markerY - 7, m.x, markerY - 13);
        g.lineBetween(m.x, markerY - 13, m.x + 8, markerY - 7);
      }
      if (!m.mine.role) continue;
      const markerX = m.x + 25;
      const markerY = m.y - MAGE_RADIUS - 38 + bob;
      const color = mineEnemyVisual(m).tint;
      g.fillStyle(0x0b0b14, 0.9).fillCircle(markerX, markerY, 10);
      g.lineStyle(2, color, 1).strokeCircle(markerX, markerY, 9);
      g.lineStyle(2, color, 1);
      if (m.mine.role === 'tank') {
        g.strokeRect(markerX - 4, markerY - 5, 8, 10);
      } else if (m.mine.role === 'healer') {
        g.lineBetween(markerX - 5, markerY, markerX + 5, markerY);
        g.lineBetween(markerX, markerY - 5, markerX, markerY + 5);
      } else {
        g.lineBetween(markerX, markerY - 6, markerX + 5, markerY + 4);
        g.lineBetween(markerX + 5, markerY + 4, markerX - 5, markerY + 4);
        g.lineBetween(markerX - 5, markerY + 4, markerX, markerY - 6);
      }
    }
  }

  /** Orbit one visible pebble for every stored Earth Elemental stone. */
  private drawEarthElementalPebbles(g: Phaser.GameObjects.Graphics, m: Mage, bob: number): void {
    const count = Math.max(0, Math.floor(m.mine?.stones ?? 0));
    const time = this.time.now / 850;
    for (let index = 0; index < count; index++) {
      const ring = Math.floor(index / 8);
      const ringStart = ring * 8;
      const ringCount = Math.min(8, count - ringStart);
      const direction = ring % 2 === 0 ? 1 : -1;
      const angle = direction * time * (0.72 + ring * 0.08) +
        ((index - ringStart) / ringCount) * Math.PI * 2;
      const radius = 38 + ring * 12;
      const x = m.x + Math.cos(angle) * radius;
      const y = m.y - 8 + bob + Math.sin(angle) * (13 + ring * 4) + Math.sin(time * 2 + index) * 2;
      const size = 4 + (index % 3) * 0.7;
      g.fillStyle(0x070b0e, 0.55).fillCircle(x + 2, y + 3, size + 1);
      g.fillStyle(0x766c5b, 1).fillCircle(x, y, size);
      g.lineStyle(1, 0xb9aa89, 0.9).strokeCircle(x, y, size);
      g.fillStyle(0xd9c89d, 0.9).fillCircle(x - size * 0.3, y - size * 0.35, 1.2);
    }
  }

  private drawMage(g: Phaser.GameObjects.Graphics, m: Mage): void {
    const alpha = this.mageVisibilityAlpha(m);
    const teamColor = m.team === 1
      ? COLORS.team1
      : m.team === 2
        ? COLORS.team2
        : m.team === 3
          ? MENU_COLOR.verdigris
          : MENU_COLOR.amethyst;
    const active = m === this.gs.current && !this.gs.isOver;
    const bodyY = m.y + MAGE_RADIUS * 0.72;
    g.fillStyle(MENU_COLOR.pitch, 0.62 * alpha).fillEllipse(m.x + 2, bodyY + 3, MAGE_RADIUS * 2.1, 13);
    g.fillStyle(teamColor, 0.12 * alpha).fillEllipse(m.x, bodyY, MAGE_RADIUS * 2.35, 16);
    g.lineStyle(active ? 3 : 2, active ? MENU_COLOR.brassLight : teamColor, active ? alpha : 0.72 * alpha)
      .strokeEllipse(m.x, bodyY, MAGE_RADIUS * 2.4, 17);
    if (active) {
      const markerY = m.y - MAGE_RADIUS - 36;
      // The caret bobs so the eye finds the acting unit without reading the HUD.
      const bob = this.reducedMotion ? 0 : Math.sin(this.time.now / 260) * 3;
      const halo = 0.10 + (this.reducedMotion ? 0 : Math.sin(this.time.now / 340) * 0.05);
      g.lineStyle(2, MENU_COLOR.brassLight, Math.max(0, halo * 3) * alpha)
        .strokeEllipse(m.x, bodyY, MAGE_RADIUS * 3.1, 22);
      g.fillStyle(MENU_COLOR.brassLight, alpha);
      g.fillTriangle(m.x - 7, markerY - 7 + bob, m.x + 7, markerY - 7 + bob, m.x, markerY + 1 + bob);
      g.lineStyle(1, MENU_COLOR.ink, 0.8 * alpha)
        .lineBetween(m.x - 4, markerY - 5 + bob, m.x + 4, markerY - 5 + bob);
    }

    // The mage body itself is drawn by its animated sprite (see syncMageSprites).

    // Bars.
    const bw = 56;
    const bx = m.x - bw / 2;
    const by = m.y - MAGE_RADIUS - 26;
    const hpFrac = m.maxHp > 0 ? m.hp / m.maxHp : 0;
    const sanFrac = m.maxSanity > 0 ? m.sanity / m.maxSanity : 0;
    const bar = this.barState(m, hpFrac, sanFrac);
    g.fillStyle(MENU_COLOR.pitch, 0.9).fillRect(bx - 2, by - 2, bw + 4, 16);
    g.fillStyle(MENU_COLOR.charcoalRaised, 1).fillRect(bx, by, bw, 6);
    // Chip bar: the ground just lost, still visible for a beat so the hit reads.
    if (bar.hpChip > bar.hp) {
      g.fillStyle(MENU_COLOR.blood, 0.85).fillRect(bx, by, bw * bar.hpChip, 6);
    }
    g.fillStyle(COLORS.hp, 1).fillRect(bx, by, bw * bar.hp, 6);
    g.fillStyle(MENU_COLOR.charcoalRaised, 1).fillRect(bx, by + 7, bw, 5);
    if (bar.sanityChip > bar.sanity) {
      g.fillStyle(MENU_COLOR.blood, 0.7).fillRect(bx, by + 7, bw * bar.sanityChip, 5);
    }
    g.fillStyle(COLORS.sanity, 1).fillRect(bx, by + 7, bw * bar.sanity, 5);
    const critical = hpFrac <= 0.25;
    const pulse = critical && !this.reducedMotion ? 0.55 + Math.sin(this.time.now / 180) * 0.45 : 0.9;
    g.lineStyle(1, critical ? MENU_COLOR.blood : MENU_COLOR.brassDark, pulse)
      .strokeRect(bx - 0.5, by - 0.5, bw + 1, 13);

    // Name + statuses.
    this.labelMage(m);
  }

  private barStates = new Map<Mage, { hp: number; hpChip: number; sanity: number; sanityChip: number }>();

  /**
   * Ease each bar toward its true value, with a slower trailing "chip" bar so a
   * hit reads as an amount lost rather than a number that simply changed.
   */
  private barState(
    m: Mage,
    hp: number,
    sanity: number
  ): { hp: number; hpChip: number; sanity: number; sanityChip: number } {
    let s = this.barStates.get(m);
    if (!s || this.reducedMotion) {
      s = { hp, hpChip: hp, sanity, sanityChip: sanity };
      this.barStates.set(m, s);
      return s;
    }
    const ease = (from: number, to: number, rate: number): number =>
      Math.abs(to - from) < 0.002 ? to : from + (to - from) * rate;
    s.hp = ease(s.hp, hp, 0.22);
    s.sanity = ease(s.sanity, sanity, 0.22);
    // The chip only ever drains, and only once the real bar has settled past it.
    s.hpChip = s.hpChip < hp ? hp : ease(s.hpChip, s.hp, 0.06);
    s.sanityChip = s.sanityChip < sanity ? sanity : ease(s.sanityChip, s.sanity, 0.06);
    if (s.hp !== hp || s.sanity !== sanity || s.hpChip !== s.hp || s.sanityChip !== s.sanity) {
      this.barsSettling = true;
    }
    return s;
  }

  /** Set while any health bar is mid-slide, so update() keeps the redraw going. */
  private barsSettling = false;

  private vignette?: Phaser.GameObjects.Graphics;

  /** A breathing red frame while the mage you are playing is close to falling. */
  private drawLowHealthVignette(time: number): void {
    if (!this.vignette) {
      this.vignette = this.add.graphics().setDepth(58).setScrollFactor(0);
    }
    const g = this.vignette;
    g.clear();
    if (this.gs.isOver || this.gs.mages.length === 0) return;
    const me = this.viewMage;
    const frac = me?.alive && me.maxHp > 0 ? me.hp / me.maxHp : 1;
    if (frac > 0.3) return;
    // Tightens and beats faster the closer to death you are.
    const severity = 1 - frac / 0.3;
    const beat = this.reducedMotion ? 0.5 : 0.5 + Math.sin(time / (260 - severity * 120)) * 0.5;
    const alpha = (0.08 + severity * 0.13) * (0.55 + beat * 0.45);
    const band = 26 + severity * 46;
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const a = alpha * (1 - t);
      const inset = band * t;
      g.lineStyle(band / 4, MENU_COLOR.blood, a);
      g.strokeRect(inset, inset, GAME_WIDTH - inset * 2, GAME_HEIGHT - inset * 2);
    }
  }

  private turnBanner?: Phaser.GameObjects.Container;

  /** A sweep of the acting unit's name, so a turn change is felt, not read. */
  private showTurnBanner(owner: Mage): void {
    this.turnBanner?.destroy();
    this.turnBanner = undefined;
    if (this.gs.isOver) return;
    const mine = !owner.isAI && !this.controllerIsAI(owner);
    const tint = owner.team === 1 ? MENU_HEX.verdigris : '#d99286';
    const root = this.add.container(GAME_WIDTH / 2, 122).setDepth(60);
    const label = this.add
      .text(0, 0, mine ? `${owner.name.toUpperCase()} — YOUR TURN` : owner.name.toUpperCase(), {
        fontFamily: MENU_FONT.control,
        fontSize: '15px',
        fontStyle: 'bold',
        color: tint,
      })
      .setOrigin(0.5);
    const w = label.width + 44;
    const plate = this.add.graphics();
    plate.fillStyle(MENU_COLOR.pitch, 0.86).fillRect(-w / 2, -15, w, 30);
    plate.lineStyle(1, MENU_COLOR.brassDark, 0.85).strokeRect(-w / 2, -15, w, 30);
    plate.lineStyle(2, owner.team === 1 ? COLORS.team1 : COLORS.team2, 0.9)
      .lineBetween(-w / 2, 15, w / 2, 15);
    root.add([plate, label]);
    this.turnBanner = root;
    const clear = (): void => {
      if (this.turnBanner === root) this.turnBanner = undefined;
      root.destroy();
    };
    if (this.reducedMotion) {
      this.time.delayedCall(700, clear);
      return;
    }
    root.setAlpha(0);
    label.setScale(0.9);
    this.tweens.add({ targets: label, scale: 1, duration: 220, ease: 'Back.Out' });
    this.tweens.add({
      targets: root,
      alpha: { from: 0, to: 1 },
      y: { from: 108, to: 122 },
      duration: 180,
      ease: 'Quad.Out',
      hold: 620,
      yoyo: true,
      onComplete: clear,
    });
  }

  /** A body giving way: a ring, a scatter of ash and a slow settling smoke. */
  private playDeathBurst(mage: Mage): void {
    if (this.reducedMotion) return;
    const at = { x: mage.x, y: mage.y };
    const tint = mage.team === 1 ? COLORS.team1 : COLORS.team2;
    this.particleFx?.burst(at, {
      color: tint, count: 1, speed: 0, lifespan: 460, shape: 'ring', size: 46, glow: true, depth: 9.4,
    });
    this.particleFx?.burst(at, {
      color: 0xd8cbb4, count: 18, speed: 190, lifespan: 620, shape: 'shard', size: 11,
      gravityY: 620, tumble: true, drag: 0.6, stagger: 0.04, depth: 4.6,
    });
    this.particleFx?.burst(at, {
      color: 0x6f6455, count: 7, speed: 60, lifespan: 1000, shape: 'smoke', size: 52,
      alpha: 0.32, gravityY: -60, drag: 0.9,
    });
    this.impactFx?.shake('heavy');
  }

  private showDefeatSeal(mage: Mage): void {
    const root = this.add.container(mage.x, mage.y).setDepth(35);
    const graphics = this.add.graphics();
    graphics.fillStyle(MENU_COLOR.pitch, 0.82).fillEllipse(2, 14, 92, 28);
    graphics.lineStyle(3, MENU_COLOR.blood, 1).strokeEllipse(0, 10, 88, 26);
    graphics.lineStyle(2, MENU_COLOR.brassDark, 0.9);
    graphics.lineBetween(-22, -12, 22, 32);
    graphics.lineBetween(22, -12, -22, 32);
    const label = this.add.text(0, 40, 'DEFEATED', {
      fontFamily: MENU_FONT.control,
      fontSize: '11px',
      color: '#d99286',
      backgroundColor: '#17110df2',
      padding: { x: 6, y: 2 },
      fontStyle: 'bold',
    }).setOrigin(0.5);
    root.add([graphics, label]);
    const reducedMotion = this.reducedMotion;
    if (reducedMotion) {
      this.time.delayedCall(520, () => root.destroy());
      return;
    }
    root.setAlpha(0).setScale(0.82);
    this.tweens.add({
      targets: root,
      alpha: { from: 0, to: 1 },
      scale: { from: 0.82, to: 1 },
      duration: 150,
      yoyo: true,
      hold: 430,
      ease: 'Sine.Out',
      onComplete: () => root.destroy(),
    });
  }

  private mageLabels = new Map<Mage, Phaser.GameObjects.Text>();
  private mageVisibilityAlpha(mage: Mage): number {
    const shadowVeiled =
      mage.statuses.some((status) => status.kind === 'shadowVeil') && this.gs.isInShadow(mage);
    if (shadowVeiled) return 0.18;
    const invisibility = this.gs.effectiveInvisibility(mage);
    return invisibility?.mode === 'full' ? 0.18 : invisibility ? 0.5 : 1;
  }

  private labelMage(m: Mage): void {
    let t = this.mageLabels.get(m);
    if (!t) {
      t = this.add.text(0, 0, '', {
        fontFamily: MENU_FONT.control,
        fontSize: '11px',
        color: MENU_HEX.bone,
        backgroundColor: '#111310e8',
        padding: { x: 5, y: 2 },
        align: 'center',
        fixedWidth: 164,
      }).setOrigin(0.5, 0);
      this.mageLabels.set(m, t);
    }
    const statusEntries = m.statuses
      .map((s) =>
        s.kind === 'fire' ||
        s.kind === 'sentinelFire' ||
        s.kind === 'blueflare' ||
        s.kind === 'soulRend' ||
        s.kind === 'reap' ||
        s.kind === 'deathCurse'
          ? `${s.name} ×${s.stacks}`
          : Number.isFinite(s.duration) && s.duration > 0
            ? `${s.name} ⌛${s.duration}`
            : s.name
          );
    const statuses = [
      ...statusEntries.slice(0, 2),
      ...(statusEntries.length > 2 ? [`+${statusEntries.length - 2}`] : []),
    ].join(' · ');
    const mineDetails = m.mine
      ? [
          `LV ${m.mine.level}`,
          m.mine.role ? m.mine.role.toUpperCase() : '',
          m.mine.golemState ? m.mine.golemState.toUpperCase() : '',
          m.mine.stones != null ? `S${m.mine.stones}` : '',
          m.mine.charges != null ? `C${m.mine.charges}` : '',
        ].filter(Boolean).join(' · ')
      : '';
    const lantern = m.hasEdgelordLantern()
      ? `LANTERN ${m.edgelordLanternActive ? 'ACTIVE' : 'DORMANT'} · ${this.gs.edgelordCaptives(m).length} CAPTIVE`
      : '';
    const wings = m.hasDeathsAngelWings()
      ? `WINGS E${m.deathsAngelEnergy}${m.deathsAngelFlightTurns > 0 ? ` · FLY ${m.deathsAngelFlightTurns}` : ''}`
      : '';
    t.setText(
      `${m.name}${mineDetails ? ` · ${mineDetails}` : ''}${lantern ? `\n${lantern}` : ''}${wings ? `\n${wings}` : ''}${statuses ? `\n${statuses}` : ''}`
    );
    t.setColor(m.hp / Math.max(1, m.maxHp) <= 0.25 ? '#d99286' : MENU_HEX.bone);
    t.setPosition(m.x, m.y + MAGE_RADIUS + 15).setVisible(true);
  }

  private drawStack(g: Phaser.GameObjects.Graphics): void {
    const n = this.gs.stack.length;
    // Hide any icons left over from a previous, larger stack.
    for (let i = n; i < this.stackIcons.length; i++) this.stackIcons[i].setVisible(false);
    if (n === 0) return;
    const startX = GAME_WIDTH / 2 - ((n - 1) * 56) / 2;
    const y = FIELD.y + 30;
    this.gs.stack.forEach((item, i) => {
      const x = startX + i * 56;
      const r = 18;
      const col = item.source.team === 1 ? COLORS.team1 : COLORS.team2;
      g.fillStyle(MENU_COLOR.pitch, 0.8).fillCircle(x + 2, y + 3, r + 2);
      g.fillStyle(MENU_COLOR.charcoalRaised, 1).fillCircle(x, y, r);
      g.lineStyle(3, col, 1).strokeCircle(x, y, r);
      g.lineStyle(1, MENU_COLOR.brassLight, 0.65).strokeCircle(x, y, r - 4);
      this.stackTokens.push({ x, y, r, item });

      // Overlay the action-type icon (move / basic attack / spell cast).
      const key = `stack-${item.kind}`;
      let icon = this.stackIcons[i];
      if (!icon || !icon.scene || !icon.active) {
        icon = this.add.image(x, y, key).setDepth(60);
        this.stackIcons[i] = icon;
      }
      if (this.textures.exists(key)) {
        if (icon.texture.key !== key) icon.setTexture(key);
        const scale = (r * 1.6) / Math.max(icon.width, icon.height);
        icon.setScale(scale).setPosition(x, y).setVisible(true);
      } else {
        icon.setVisible(false);
      }
    });
    g.lineStyle(2, MENU_COLOR.woodEdge, 0.9).strokeRect(startX - 30, y - 30, (n - 1) * 56 + 60, 60);
    g.lineStyle(1, MENU_COLOR.brassDark, 0.72).strokeRect(startX - 26, y - 26, (n - 1) * 56 + 52, 52);
  }

  private drawHud(): void {
    const me = this.viewMage;
    if (this.mode === 'reaction' && this.reactor) {
      const source = this.reactionTop?.source.name ?? 'incoming action';
      this.turnText.setFontSize('16px').setText(`YOUR REACTION\n${this.reactor.name} vs ${source}`);
    } else {
      const cur = this.gs.current;
      const swap = this.gs.controlSwapped ? '   ⟲ MINDS SWAPPED' : '';
      const needlepoint = this.gs.needlepointDomains.length
        ? `   ◈ NEEDLEPOINT ${Math.max(...this.gs.needlepointDomains.map((domain) => domain.roundsLeft))}`
        : '';
      const hexcraft = this.gs.hexcraftGlobals
        .map((effect) =>
          effect.kind === 'mindShadow'
            ? `MIND SHADOW ${effect.roundsLeft}`
            : `CURSE CORRODE ${effect.roundsLeft}`
        )
        .map((label) => `   ◈ ${label}`)
        .join('');
      const state = `${swap}${needlepoint}${hexcraft}`.trim();
      this.turnText
        .setFontSize(state ? '13px' : '17px')
        .setText(this.gs.isOver
          ? ''
          : `ROUND ${this.gs.round}  ·  ${cur.name}${this.controllerIsAI(cur) ? '  ·  AI' : ''}${state ? `\n${state}` : ''}`);
    }

    const spell = this.currentComboSpell();
    const sel = this.selectedWords().map((w) => WORDS[w].label).join(' + ');
    if (this.selectedIdx.length === 0) {
      this.comboText.setText('Selection: —');
    } else if (spell) {
      const rng = Number.isFinite(spell.range) ? `rng ${spell.range}` : 'any range';
      const mana = this.spellManaCost(me, spell);
      const mods = this.selectedModifiers();
      const modNote = mods.length
        ? `\n${mods
            .map((w) =>
              w === 'subtle'
                ? 'Subtle ×0.8, silent on 11+'
                : w === 'channel'
                  ? 'Channel: hold a turn, ×1.5'
                  : 'Delay: fires next turn'
            )
            .join(' · ')}`
        : '';
      this.comboText.setText(
        `${spell.name}\n${spell.actionType} · ${rng} · ${mana} mana${modNote}`
      );
      this.comboText.setColor(MENU_HEX.brassLight);
    } else {
      this.comboText.setText(`${sel}\nno spell for this combination`);
      this.comboText.setColor(MENU_HEX.boneDim);
    }
    // The full (plain-language) description lives in its own scrollable window.
    this.updateSpellInfoPanel(this.selectedIdx.length === 0 ? undefined : spell, me);

    const a = me.actions;
    const reactionLabel = me.profile.bluePrimaryTier
      ? `${Math.max(0, MAX_WORD_SPELL_REACTIONS - me.wordSpellReactionsUsed)} spell`
      : 'defensive';
    this.actionText.setText(
      `MOVE ${dots(a.move, ACTIONS_PER_TURN.move)}   MAIN ${dots(a.main, ACTIONS_PER_TURN.main)}\nBONUS ${dots(a.bonus, ACTIONS_PER_TURN.bonus)}   REACTION ${reactionLabel}`
    );

    this.drawResourceText(me);
    this.drawResourcePanel(me);

    // Word boxes for the active human.
    for (let i = 0; i < WORD_SLOTS; i++) {
      const plate = this.wordPlates[i];
      if (this.controllerIsAI(me) || i >= me.loadout.length) {
        plate.setVisible(false);
        continue;
      }
      plate.setVisible(true);
      const w = me.loadout[i];
      const on = this.selectedIdx.includes(i);
      const charges = me.charges[w] ?? 0;
      const wordColor = WORD_COLOR[w];
      const accent = isModifierWord(w)
        ? MENU_COLOR.amethyst
        : wordColor === 'red'
          ? MENU_COLOR.blood
          : wordColor === 'blue'
            ? MENU_COLOR.verdigris
            : wordColor === 'black'
              ? MENU_COLOR.amethyst
              : MENU_COLOR.brass;
      const meta = `${charges} CHARGE${charges === 1 ? '' : 'S'}${WORDS[w].grantsReaction ? ' · REACTION' : ''}`;
      plate.setCopy(`${i + 1}  ${WORDS[w].label}`, meta, accent);
      plate.setSelectedOrder(on ? this.selectedIdx.indexOf(i) + 1 : 0);
      plate.setAlpha(charges > 0 || isModifierWord(w) ? 1 : 0.58);
    }

    // The action-menu button: shown only when the local player can actually act.
    const canOpenActions =
      !this.gs.isOver &&
      (this.mode === 'reaction'
        ? !!this.reactor && !this.controllerIsAI(this.reactor)
        : this.mode === 'idle' && !this.controllerIsAI(this.gs.current));
    this.actionMenuButton?.setVisible(canOpenActions);
    if (canOpenActions && this.actionMenuButton) {
      this.actionMenuButton.setText(
        this.mode === 'reaction' ? 'PASS PRIORITY' : 'ACTIONS'
      );
    }

    this.drawLog();
  }

  /** Show the active mage's colour identity, abilities, stats and carried gear. */
  private drawResourceText(me: Mage): void {
    if (this.controllerIsAI(me)) {
      this.resourceText.setText('');
      return;
    }
    const p = me.profile;
    const identity = p.primary
      ? `${p.primary}${p.secondary ? `/${p.secondary}` : ''}`
      : 'colorless';
    const abilities = getColorAbilitiesFor(p.primary, me.mageClass);
    const abilText = abilities.length
      ? abilities
          .map((ab, i) => `[${i === 0 ? 'Z' : 'X'}] ${ab.name}`)
          .join('   ')
      : 'no colour abilities';
    const stats = me.statsAssigned
      ? `STR ${me.effectiveStr()}  DEX ${me.effectiveDex()}%  INT ${me.effectiveInt()}  Luck ${me.luck}/${me.maxLuck}`
      : 'stats unassigned';
    // Gear, bag and weight live in the inventory overlay ([I]) to keep this glanceable.
    this.resourceText.setText(`${identity} · ${stats}\n${abilText}`);
  }

  /**
   * Render the clear resource read-out panel in the top-left of the field:
   * labelled bars for HP, Mana, Sanity and Colour charges, plus the Blessing of
   * Roaring Thunder's stacks when the mage carries it.
   */
  private drawResourcePanel(me: Mage): void {
    const g = this.resourceGfx;
    g.clear();
    if (this.controllerIsAI(me) || this.gs.isOver) {
      g.setVisible(false);
      for (const t of this.resourceLabels) t.setVisible(false);
      for (const t of this.resourceValues) t.setVisible(false);
      return;
    }
    const rows: { label: string; cur: number; max: number; color: number }[] = [
      { label: 'HP', cur: me.hp, max: me.maxHp, color: COLORS.hp },
      { label: 'Mana', cur: me.mana, max: me.maxMana, color: 0x38bdf8 },
      { label: 'Sanity', cur: me.sanity, max: me.maxSanity, color: COLORS.sanity },
      { label: 'Color', cur: me.colorCharges, max: me.maxColorCharges, color: 0xffd166 },
    ];
    if (me.hasThunderBlessing()) {
      rows.push({ label: 'Thunder', cur: me.thunderStacks, max: 15, color: 0xffa53b });
    }

    const body = panelBody(DOCK_VITALS);
    const rowH = 22;
    const labelW = 58;
    const valueW = 62;
    g.setVisible(true);

    rows.forEach((r, i) => {
      const ry = body.y + i * rowH;
      const label = this.resourceLabels[i];
      label.setText(r.label).setPosition(body.x, ry).setVisible(true);
      const bar = {
        x: body.x + labelW,
        y: ry + 3,
        w: body.w - labelW - valueW,
        h: 10,
      };
      drawCabinetBar(g, bar, r.max > 0 ? r.cur / r.max : 0, r.color);
      const val = this.resourceValues[i];
      val.setText(`${r.cur}/${r.max}`).setPosition(body.x + body.w, ry).setVisible(true);
    });
    for (let i = rows.length; i < this.resourceLabels.length; i++) {
      this.resourceLabels[i].setVisible(false);
      this.resourceValues[i].setVisible(false);
    }
  }

  private drawLog(): void {
    if (!this.logText) return;
    const max = this.historyExpanded ? 26 : 7;
    const filtered = this.gs.logLines.filter((l) => this.historyFilters[this.logCategory(l)]);
    const lines = filtered.slice(-max);
    this.logText.setText(lines.length ? lines.join('\n') : '(no entries)');
  }

  private updateHover(): void {
    this.hoverGfx.clear();
    for (const tok of this.stackTokens) {
      if (dist(this.pointer, tok) <= tok.r + 2) {
        const it = tok.item;
        this.tooltip
          .setText(`${it.label} (by ${it.source.name})${this.stackTargetLabel(it)}\n${it.description}`)
          .setPosition(tok.x + 20, tok.y + 20)
          .setVisible(true);
        this.drawStackTargeting(it);
        return;
      }
    }

    // Field areas (shadows, reality breaks, totems) describe their effect on hover.
    const area = this.areaUnderPointer();
    if (area) {
      this.tooltip
        .setText(area)
        .setPosition(this.pointer.x + 18, this.pointer.y + 18)
        .setVisible(true);
      return;
    }

    this.tooltip.setVisible(false);
  }

  /** A short " → …" suffix describing what a stacked action is aimed at. */
  private stackTargetLabel(it: StackItem): string {
    if (it.target) {
      if (it.kind === 'move' || it.kind === 'melee') return ` → dash onto ${it.target.name}`;
      return ` → targeting ${it.target.name}`;
    }
    if (it.targetPoint) {
      return it.kind === 'move' ? ' → moving to marked spot' : ' → aimed at a location';
    }
    return '';
  }

  /** The point a stacked action is aimed at, if any (mage centre or raw point). */
  private stackTargetPoint(it: StackItem): Vec2 | null {
    if (it.target) return it.target.pos;
    if (it.targetPoint) return it.targetPoint;
    return null;
  }

  /** Draw a line + reticle from the actor to whatever the hovered action targets. */
  private drawStackTargeting(it: StackItem): void {
    const from = it.source.pos;
    const to = this.stackTargetPoint(it);
    const g = this.hoverGfx;
    g.lineStyle(3, MENU_COLOR.brassLight, 0.95).strokeCircle(from.x, from.y, 16);
    if (!to) return;
    this.drawAimGuide(g, from, to);
    g.lineStyle(2, MENU_COLOR.blood, 0.95).strokeCircle(to.x, to.y, 12);
    g.lineBetween(to.x - 16, to.y, to.x + 16, to.y);
    g.lineBetween(to.x, to.y - 16, to.x, to.y + 16);
  }

  /** A short flavourless description of any field area under the pointer. */
  private areaUnderPointer(): string | null {
    const p = this.pointer;
    for (const b of this.gs.barriers) {
      if (barrierContains(b, p)) {
        return 'Reality break — a rift no mage can enter. A mage that runs into it stops at the edge and is rooted; dashes and movement spells end at its border. Blocks everyone, including its caster.';
      }
    }
    for (const s of this.gs.shadows) {
      if (dist(p, s) <= s.radius) {
        return 'Shadow pool — its owner may cast spells from here (extending their reach), and any mage standing inside takes extra spell damage.';
      }
    }
    for (const t of this.gs.totems) {
      if (dist(p, t) <= t.radius) {
        return t.lifesteal
          ? 'Corrosion totem — each round it saps the health of mages within its aura and heals its owner for the damage dealt.'
          : 'Corrosion totem — each round it saps the health of every mage standing within its aura.';
      }
    }
    for (const pool of this.gs.corrosionPools) {
      if (dist(p, pool) <= pool.radius) {
        return 'Corrosion pool - entering slows movement by 50%; hostile units inside take 3d3 corrosive damage at turn start.';
      }
    }
    for (const zone of this.gs.veilBindZones) {
      if (dist(p, zone) <= zone.radius) {
        return 'Veil Bind - inside this circle, gaining a veil also roots the bearer; being rooted or bound grants a half veil for the same duration.';
      }
    }
    for (const zone of this.gs.hazardZones) {
      if (hazardDistance(zone, p) > zone.radius) continue;
      const parts = [`${zone.name} - affects every unit inside, allies included.`];
      const spec = zone.damageSpecs[Math.min(zone.escalateIndex, zone.damageSpecs.length - 1)];
      parts.push(
        zone.movedOnly
          ? `Units that moved last turn take ${spec} ${zone.damageType} at turn start.`
          : `Units inside take ${spec} ${zone.damageType} at turn start.`
      );
      if (zone.damageSpecs.length > 1) parts.push('The damage deepens every round.');
      if (zone.dodgeChance) parts.push(`${Math.round(zone.dodgeChance * 100)}% chance to dodge targeted attacks.`);
      if (zone.healMult != null && zone.healMult !== 1) {
        parts.push(`Healing received inside is multiplied by ${zone.healMult}.`);
      }
      return parts.join(' ');
    }
    return null;
  }

  private flashHint(msg: string, sticky = false): void {
    this.hintText.setText(msg).setColor(TEXT.warn);
    this.hintDim?.remove();
    this.hintDim = undefined;
    // Selection prompts stay lit until the choice is made; transient tips fade.
    if (!sticky) {
      this.hintDim = this.time.delayedCall(1400, () => this.hintText.setColor(TEXT.dim));
    }
  }

  private endGame(): void {
    // isOver is polled from several points in the turn flow; only the first
    // call may raise the banner and arm the click that leaves the duel.
    if (this.gameEnded) return;
    this.gameEnded = true;
    if (this.raid) {
      this.mode = 'over';
      this.busy = false;
      const targetName = ENEMY_DEFS[this.raidBoss].name;
      this.showEndCard({
        eyebrow: 'RAID COMPLETE',
        title: this.raidVictory ? 'VICTORY' : 'DEFEAT',
        detail: this.raidVictory ? `${targetName} defeated.` : `${targetName} survived.`,
        actionLabel: 'RETURN TO MAIN MENU',
        tone: this.raidVictory ? 'victory' : 'defeat',
        onActivate: () => this.returnToMenu(),
      });
      this.redraw();
      return;
    }
    // Swamprun: the run ends only when the survivor falls. Report the score.
    if (this.swamprun) {
      this.mode = 'over';
      this.busy = false;
      const mineEncountersCleared = Math.max(
        0,
        this.swamprunWave - (this.mineRun && this.mineInCombat ? 1 : 0)
      );
      if (this.mineRun) {
        this.mineRunEnded = true;
        this.mineExploring = false;
        this.mineInCombat = false;
        this.mineChoiceResolve?.('');
        this.mineChoiceResolve = null;
        this.mineCombatResolve?.();
        this.mineCombatResolve = null;
        this.hideMinePanel();
      }
      const eyebrow = this.mineRun
        ? 'MINE RUN ENDED'
        : this.expedition
          ? 'EXPEDITION ENDED'
          : 'SWAMPRUN ENDED';
      const detail = this.mineRun
        ? `${mineEncountersCleared} encounters cleared.`
        : this.expedition
          ? `Depth ${this.swamprunWave}, level ${this.expeditionLevel}.`
          : `${this.swamprunWave} waves survived.`;
      this.showEndCard({
        eyebrow,
        title: 'PARTY LOST',
        detail,
        actionLabel: 'RETURN TO MAIN MENU',
        tone: 'defeat',
        onActivate: () => this.returnToMenu(),
      });
      this.redraw();
      return;
    }
    // Training never truly ends: whoever fell is patched up on the next click.
    if (this.training && !this.opponentLeft) {
      this.mode = 'over';
      this.busy = false;
      this.showEndCard({
        eyebrow: 'TRAINING COMPLETE',
        title: 'FIELD RESET',
        detail: 'Combat resolved. Restore every combatant and clear the field.',
        actionLabel: 'RESET FIELD',
        tone: 'neutral',
        onActivate: () => {
          this.endCard?.destroy();
          this.endCard = undefined;
          this.gameEnded = false;
          this.softReset();
        },
      });
      this.redraw();
      return;
    }
    this.mode = 'over';
    const w = this.gs.winner;
    this.showEndCard({
      eyebrow: 'MATCH COMPLETE',
      title: w ? `${w.name} WINS` : 'DRAW',
      detail: w
        ? `Team ${w.team} wins after ${this.gs.round} rounds.`
        : `No winner after ${this.gs.round} rounds.`,
      actionLabel: 'RETURN TO MAIN MENU',
      tone: w ? 'victory' : 'neutral',
      onActivate: () => this.returnToMenu(),
    });
    this.redraw();
  }

  private showEndCard(options: EndCardOptions): void {
    this.endCard?.destroy();
    this.endCard = new EndCardView(this, options);
  }

  private returnToMenu(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.scene.start('Menu');
  }

  // ===========================================================================
  //  SPELL VISUALS
  // ===========================================================================

  /** Play the animation for a resolving action before its effect lands. */
  private playActionVisual(item: StackItem): Promise<void> {
    if (item.kind === 'move') return this.animateMove(item.source, item.targetPoint ?? item.source.pos);
    // Generic actions (item use / throw / Eldritch / Thunder / weapon action)
    // paint their own effects inside resolve — no default cast animation.
    if (item.kind === 'action') {
      const at = item.target?.pos ?? item.targetPoint ?? item.source.pos;
      const preset = item.actionVisual ? ACTION_FX_PRESETS[item.actionVisual] : undefined;
      switch (preset?.kind) {
        case 'burst':
          return this.vfxBurst(at, preset.color, preset.reach, preset.speed);
        case 'lightning':
          return this.vfxLightningBolt(item.source.pos, at);
        case 'lightningImpact':
          return this.vfxEdgelordImpact(at);
        default:
          return Promise.resolve();
      }
    }

    const from = item.source.pos;
    const to: Vec2 | null = item.target ? item.target.pos : item.targetPoint ?? null;

    if (item.kind === 'melee') {
      const at = item.target?.pos ?? from;
      const creatureKind = creatureSpriteKind(item.source);
      if (creatureKind) this.startBodyAttack(item.source);
      if (creatureKind === 'wisp') return this.playWispAttackFx(at, item.source);
      // A basic weapon / unarmed strike sweeps a quick slash arc across the
      // struck foe, aimed along the attack direction.
      if (this.anims.exists('fx-slash-arc')) {
        const angle = Math.atan2(at.y - from.y, at.x - from.x);
        return this.vfxSlash('fx-slash-arc', at, angle, MAGE_RADIUS * 4.2);
      }
      return this.vfxBurst(at, 0xffffff, 34, 1.6);
    }

    if (item.kind === 'spell' && item.spell?.manualCastVisual) return Promise.resolve();
    const v = item.spell?.visual ?? this.defaultVisual(item);
    const lightningSpell = item.spell && (
      item.spell.words.includes('lightning') || item.spell.id === 'ability:lightning-bolt'
    );
    if (item.kind === 'spell' && lightningSpell) {
      const thickness = Phaser.Math.Clamp((v.size ?? 8) / 8, 0.75, 1.8);
      return to
        ? this.vfxLightningBolt(from, to, v.color, thickness)
        : this.vfxLightningNova(from, v.color, thickness);
    }

    // Ground-targeted elemental spells paint their sprite sheet where they land
    // (the aimed point / area), not on a foe — so the impact reads as hitting
    // the ground. Enemy-targeted variants keep their on-target hit overlay.
    if (item.kind === 'spell' && item.spell && item.spell.targeting === 'point') {
      const spell = item.spell;
      const point = to ?? from;
      // Reality Shatter paints its own stretched wedge from inside its cast
      // (after the player sets the second edge point) — no default cast burst.
      if (spell.words.includes('reality') && spell.words.includes('shatter')) {
        return Promise.resolve();
      }
      if (!spell.words.includes('reality') && !spell.noCastSprite) {
        const cone = spell.aoe?.kind === 'cone';
        if (spell.words.includes('shatter')) {
          return cone
            ? this.vfxSpriteAt('fx-shatter', point, {
                from,
                apexAtFrom: true,
                lengthPx: Math.min(spell.aoe?.radius ?? 200, 360),
              })
            : this.vfxSpriteAt('fx-shatter', point, {
                from,
                aim: true,
                lengthPx: (spell.aoe?.radius ?? 60) * 2.2,
              });
        }
        if (spell.words.includes('corrode')) {
          return this.vfxSpriteAt('fx-dot', point, {
            lengthPx: (spell.aoe?.radius ?? 40) * 2.4,
          });
        }
      }
    }

    switch (v.preset) {
      case 'projectile':
        return to ? this.vfxProjectile(from, to, v) : this.vfxBurst(from, v.color, 28, v.speed ?? 1);
      case 'beam':
        return to ? this.vfxBeam(from, to, v) : this.vfxBurst(from, v.color, 24, v.speed ?? 1);
      case 'burst':
        return this.vfxBurst(to ?? from, v.color, v.size ?? 45, v.speed ?? 1);
      case 'nova':
        return this.vfxNova(to ?? from, v);
      case 'conjure':
        return this.vfxConjure(to ?? from, v);
      case 'heal':
        return this.vfxHeal(to ?? from, v);
    }
    return Promise.resolve();
  }

  /** The caster's shadow that best relays a shot to `target` beyond direct range. */
  private defaultVisual(item: StackItem): SpellVisual {
    const color = item.source.team === 1 ? COLORS.team1 : COLORS.team2;
    const targeting = item.spell?.targeting;
    // Buffs / heals / team spells (self, ally, or any-target support) get the
    // positive heal glow; area/none spells keep the caster-centred nova.
    if (targeting === 'self' || targeting === 'ally' || targeting === 'any') {
      return { preset: 'heal', color: 0x7cfc9a, size: 40, speed: 1 };
    }
    if (targeting === 'none') {
      return { preset: 'nova', color, size: 55, speed: 1 };
    }
    return { preset: 'projectile', color, size: 10, speed: 1 };
  }

  private vfxBeam(from: Vec2, to: Vec2, visual: SpellVisual): Promise<void> {
    const distance = dist(from, to);
    if (distance < 3) return this.vfxBurst(to, visual.color, 24, visual.speed ?? 1);

    return new Promise((resolve) => {
      const speed = Math.max(0.25, visual.speed ?? 1);
      const thickness = Phaser.Math.Clamp(visual.size ?? 6, 3, 16);
      const unit = { x: (to.x - from.x) / distance, y: (to.y - from.y) / distance };
      const perpendicular = { x: -unit.y, y: unit.x };
      const start = {
        x: from.x + unit.x * (MAGE_RADIUS * 0.55),
        y: from.y + unit.y * (MAGE_RADIUS * 0.55),
      };
      const end = {
        x: to.x - unit.x * Math.min(5, thickness * 0.5),
        y: to.y - unit.y * Math.min(5, thickness * 0.5),
      };
      const length = Math.max(1, dist(start, end));
      const segments = Phaser.Math.Clamp(Math.ceil(length / 18), 14, 52);
      const duration = this.reducedMotion
        ? 120
        : Phaser.Math.Clamp(FX_TWEEN.beam.duration / speed, 230, 520);
      const seed = (
        from.x * 0.017 +
        from.y * 0.029 +
        to.x * 0.041 +
        to.y * 0.053 +
        (visual.color & 0xfff) * 0.001
      ) % (Math.PI * 2);
      const curveBias = Math.sin(seed * 2.31) * Math.min(22, length * 0.045);
      const graphics = this.add
        .graphics()
        .setDepth(31)
        .setBlendMode(Phaser.BlendModes.ADD);
      const state = { life: 0 };
      let impactStarted = false;

      const pointAt = (amount: number, phase: number, lane = 0): Vec2 => {
        const envelope = Math.sin(Math.PI * amount);
        const broadCurve = envelope * curveBias;
        const primaryWave = Math.sin(amount * Math.PI * 4 + phase + seed) * thickness * 0.62;
        const secondaryWave = Math.sin(amount * Math.PI * 9 - phase * 1.37 + seed * 0.7) * thickness * 0.24;
        const laneMotion = lane * thickness * (
          0.68 + 0.16 * Math.sin(amount * Math.PI * 6 + phase * 0.73 + seed)
        );
        const offset = envelope * (broadCurve + primaryWave + secondaryWave + laneMotion);
        return {
          x: Phaser.Math.Linear(start.x, end.x, amount) + perpendicular.x * offset,
          y: Phaser.Math.Linear(start.y, end.y, amount) + perpendicular.y * offset,
        };
      };

      const buildPath = (reveal: number, phase: number, lane = 0): Vec2[] => {
        if (reveal <= 0) return [start];
        const count = Math.max(1, Math.floor(segments * reveal));
        const points: Vec2[] = [];
        for (let index = 0; index <= count; index++) {
          points.push(pointAt(Math.min(reveal, index / segments), phase, lane));
        }
        const finalAmount = Math.min(1, reveal);
        const lastAmount = count / segments;
        if (lastAmount < finalAmount) points.push(pointAt(finalAmount, phase, lane));
        return points;
      };

      const strokePath = (points: readonly Vec2[], width: number, color: number, alpha: number): void => {
        if (points.length < 2 || alpha <= 0) return;
        graphics.lineStyle(Math.max(1, width), color, Phaser.Math.Clamp(alpha, 0, 1));
        graphics.beginPath();
        graphics.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index++) {
          graphics.lineTo(points[index].x, points[index].y);
        }
        graphics.strokePath();
      };

      const render = (): void => {
        if (!graphics.active) return;
        const life = state.life;
        const reveal = Phaser.Math.Clamp(life / 0.27, 0, 1);
        const attack = Phaser.Math.Clamp(life / 0.1, 0, 1);
        const decay = life < 0.62 ? 1 : Phaser.Math.Clamp(1 - (life - 0.62) / 0.38, 0, 1);
        const opacity = attack * decay;
        const phase = this.reducedMotion ? seed : seed + life * Math.PI * 11;
        const breathing = 0.9 + Math.sin(life * Math.PI * 18 + seed) * 0.1;
        const centre = buildPath(reveal, phase);

        graphics.clear();
        strokePath(centre, thickness * 5.2 * breathing, visual.color, 0.1 * opacity);
        strokePath(centre, thickness * 2.5 * breathing, visual.color, 0.54 * opacity);
        strokePath(centre, thickness * 1.12, visual.color, 0.96 * opacity);
        strokePath(centre, thickness * 0.36, 0xffffff, 0.98 * opacity);

        if (!this.reducedMotion) {
          const upper = buildPath(reveal, phase + 0.9, 1);
          const lower = buildPath(reveal, phase - 1.1, -1);
          strokePath(upper, thickness * 0.34, visual.color, 0.44 * opacity);
          strokePath(upper, thickness * 0.12, 0xffffff, 0.58 * opacity);
          strokePath(lower, thickness * 0.3, visual.color, 0.36 * opacity);

          for (let index = 0; index < 4; index++) {
            const knotAmount = (life * 2.15 + index * 0.247) % 1;
            if (knotAmount > reveal) continue;
            const knot = pointAt(knotAmount, phase, index % 2 ? 0.28 : -0.28);
            const knotRadius = thickness * (0.32 + (index % 3) * 0.08);
            graphics.fillStyle(visual.color, 0.45 * opacity).fillCircle(knot.x, knot.y, knotRadius * 2.2);
            graphics.fillStyle(0xffffff, 0.82 * opacity).fillCircle(knot.x, knot.y, knotRadius);
          }

          for (let index = 0; index < 6; index++) {
            const sparkAmount = Phaser.Math.Clamp(reveal * ((index + 1) / 7), 0, 1);
            const spark = pointAt(sparkAmount, phase + index * 0.83);
            const scatter = Math.sin(phase * 1.7 + index * 2.41) * thickness * (2.1 + index * 0.08);
            const sparkX = spark.x + perpendicular.x * scatter;
            const sparkY = spark.y + perpendicular.y * scatter;
            graphics.fillStyle(index % 2 ? visual.color : 0xffffff, 0.42 * opacity)
              .fillCircle(sparkX, sparkY, Math.max(1, thickness * 0.15));
          }
        }

        const sourcePulse = thickness * (1.7 + attack * 0.9);
        graphics.fillStyle(visual.color, 0.18 * opacity).fillCircle(start.x, start.y, sourcePulse * 1.7);
        graphics.lineStyle(Math.max(1, thickness * 0.22), 0xffffff, 0.74 * opacity)
          .strokeCircle(start.x, start.y, sourcePulse);

        if (reveal > 0.72) {
          const impact = Phaser.Math.Clamp((reveal - 0.72) / 0.28, 0, 1);
          const impactRadius = thickness * (1.4 + impact * 2.8);
          graphics.fillStyle(visual.color, 0.22 * opacity).fillCircle(end.x, end.y, impactRadius * 1.5);
          graphics.lineStyle(Math.max(1, thickness * 0.26), 0xffffff, (1 - impact * 0.45) * opacity)
            .strokeCircle(end.x, end.y, impactRadius);
        }

        if (!impactStarted && reveal >= 1) {
          impactStarted = true;
          void this.vfxBurst(to, visual.color, Math.max(20, thickness * 3.1), speed * 1.45);
        }
      };

      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.events.off(Phaser.Scenes.Events.SHUTDOWN, finish);
        this.tweens.killTweensOf(state);
        if (graphics.active) graphics.destroy();
        resolve();
      };
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, finish);
      render();
      this.tweens.add({
        targets: state,
        life: 1,
        duration,
        ease: FX_TWEEN.beam.ease,
        onUpdate: render,
        onComplete: finish,
      });
    });
  }

  private vfxDrainParticles(from: Vec2, to: Vec2): Promise<void> {
    const distance = dist(from, to);
    if (distance < 3) return Promise.resolve();

    return new Promise((resolve) => {
      const count = this.reducedMotion ? 12 : 34;
      const duration = this.reducedMotion ? 220 : Phaser.Math.Clamp(distance * 1.55, 460, 760);
      const midpointY = (from.y + to.y) * 0.5;
      const arcHeight = this.reducedMotion ? 28 : Phaser.Math.Clamp(distance * 0.3, 58, 138);
      const upwardRoom = Math.max(18, midpointY - FIELD.y - 16);
      const downwardRoom = Math.max(18, FIELD.y + FIELD.h - midpointY - 16);
      const colors = [0x153d29, 0x1e5636, 0x2b6f42, 0x3f8752];
      const particles: { root: Phaser.GameObjects.Container; progress: { value: number } }[] = [];
      let remaining = count;
      let settled = false;

      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.events.off(Phaser.Scenes.Events.SHUTDOWN, finish);
        for (const particle of particles) {
          this.tweens.killTweensOf(particle.progress);
          if (particle.root.active) particle.root.destroy(true);
        }
        resolve();
      };
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, finish);

      for (let index = 0; index < count; index++) {
        const phase = index * 2.39996;
        const sourceSpread = 5 + (index % 7) * 1.8;
        const start = {
          x: from.x + Math.cos(phase) * sourceSpread,
          y: from.y + Math.sin(phase) * sourceSpread,
        };
        const radius = 2.6 + (index % 4) * 0.55;
        const root = this.add.container(start.x, start.y).setDepth(32);
        const halo = this.add
          .circle(0, 0, radius * 2.25, 0x4c9d61, 0.2)
          .setBlendMode(Phaser.BlendModes.ADD);
        const ball = this.add
          .circle(0, 0, radius, colors[index % colors.length], 0.98)
          .setStrokeStyle(1, 0x8fc99b, 0.82);
        const glint = this.add.circle(-radius * 0.28, -radius * 0.28, Math.max(0.8, radius * 0.26), 0xc5e3bd, 0.78);
        root.add([halo, ball, glint]);
        root.setAlpha(0);
        const progress = { value: 0 };
        particles.push({ root, progress });
        const laneDirection = index % 2 === 0 ? -1 : 1;
        const laneRoom = laneDirection < 0 ? upwardRoom : downwardRoom;
        const laneArc = Math.min(arcHeight * (0.78 + (index % 6) * 0.065), laneRoom);
        const sidewaysDrift = ((index % 7) - 3) * 1.8;
        this.tweens.add({
          targets: progress,
          value: 1,
          delay: index * (this.reducedMotion ? 7 : 14),
          duration: duration + (index % 5) * 24,
          ease: 'Sine.In',
          onUpdate: () => {
            const amount = progress.value;
            const parabola = 4 * amount * (1 - amount);
            const fadeIn = Phaser.Math.Clamp(amount / 0.08, 0, 1);
            const fadeOut = Phaser.Math.Clamp((1 - amount) / 0.1, 0, 1);
            root
              .setPosition(
                Phaser.Math.Linear(start.x, to.x, amount) + sidewaysDrift * parabola,
                Phaser.Math.Linear(start.y, to.y, amount) + laneDirection * laneArc * parabola
              )
              .setAlpha(fadeIn * fadeOut)
              .setScale(0.82 + Math.sin(Math.PI * amount) * 0.28 - amount * 0.24);
          },
          onComplete: () => {
            if (root.active) root.destroy(true);
            remaining -= 1;
            if (remaining === 0) finish();
          },
        });
      }
    });
  }

  /** Implode at a departure point and bloom at an arrival point. */
  private vfxBlink(from: Vec2, to: Vec2, color: number): void {
    if (dist(from, to) < 2) return;
    this.vfxBlinkGate(from, color, 'out');
    this.vfxBlinkGate(to, color, 'in');
  }

  private vfxBlinkGate(at: Vec2, color: number, phase: 'out' | 'in'): void {
    const leaving = phase === 'out';
    const duration = this.reducedMotion ? 120 : leaving ? 200 : 270;
    const parts: Phaser.GameObjects.GameObject[] = [];
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      this.events.off(Phaser.Scenes.Events.SHUTDOWN, finish);
      for (const part of parts) {
        this.tweens.killTweensOf(part);
        if (part.active) part.destroy();
      }
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, finish);

    const ring = this.add
      .circle(at.x, at.y, MAGE_RADIUS * (leaving ? 1.6 : 0.4))
      .setStrokeStyle(3, color, 0.9)
      .setDepth(30.5)
      .setBlendMode(Phaser.BlendModes.ADD);
    const core = this.add
      .circle(at.x, at.y, MAGE_RADIUS * 0.55, color, leaving ? 0.45 : 0.7)
      .setDepth(30.4)
      .setBlendMode(Phaser.BlendModes.ADD);
    parts.push(ring, core);
    this.tweens.add({
      targets: ring,
      scale: leaving ? 0.15 : 3.1,
      alpha: 0,
      duration,
      ease: leaving ? 'Cubic.In' : 'Cubic.Out',
    });
    this.tweens.add({
      targets: core,
      scale: leaving ? 0.1 : 1.9,
      alpha: 0,
      duration: duration * 0.85,
      ease: 'Sine.Out',
    });

    const shardCount = this.reducedMotion ? 0 : 8;
    for (let index = 0; index < shardCount; index++) {
      const angle = (Math.PI * 2 * index) / shardCount + (leaving ? 0.35 : 0);
      const near = MAGE_RADIUS * 0.35;
      const far = MAGE_RADIUS * 2.1;
      const shard = this.add
        .rectangle(
          at.x + Math.cos(angle) * (leaving ? far : near),
          at.y + Math.sin(angle) * (leaving ? far : near),
          11,
          2.6,
          color,
          0.95
        )
        .setRotation(angle)
        .setDepth(30.6)
        .setBlendMode(Phaser.BlendModes.ADD);
      parts.push(shard);
      this.tweens.add({
        targets: shard,
        x: at.x + Math.cos(angle) * (leaving ? near : far),
        y: at.y + Math.sin(angle) * (leaving ? near : far),
        alpha: 0,
        duration,
        ease: leaving ? 'Cubic.In' : 'Cubic.Out',
      });
    }
    this.time.delayedCall(duration + 40, finish);
  }

  private vfxBoomerang(
    from: Vec2,
    to: Vec2,
    color: number,
    size: number,
    speed: number
  ): Promise<void> {
    const distance = dist(from, to);
    if (distance < 3) return Promise.resolve();

    return new Promise((resolve) => {
      const unit = { x: (to.x - from.x) / distance, y: (to.y - from.y) / distance };
      const perpendicular = { x: -unit.y, y: unit.x };
      const arc = this.reducedMotion ? 0 : Math.min(74, Math.max(24, distance * 0.16));
      const duration = this.reducedMotion
        ? 110
        : Phaser.Math.Clamp((distance / (760 * Math.max(0.25, speed))) * 1000, 220, 620);
      const root = this.add.container(from.x, from.y).setDepth(32);
      const glow = this.add
        .circle(0, 0, size * 1.15, color, 0.2)
        .setBlendMode(Phaser.BlendModes.ADD);
      const shard = this.add
        .polygon(
          0,
          0,
          [
            -size * 1.35, 0,
            -size * 0.2, -size * 0.55,
            size * 1.4, 0,
            -size * 0.2, size * 0.55,
          ],
          color,
          1
        )
        .setStrokeStyle(Math.max(1, size * 0.14), 0xf4eaff, 0.92);
      const core = this.add
        .circle(size * 0.15, 0, Math.max(1.5, size * 0.18), 0xffffff, 0.9)
        .setBlendMode(Phaser.BlendModes.ADD);
      root.add([glow, shard, core]);

      const progress = { value: 0 };
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.events.off(Phaser.Scenes.Events.SHUTDOWN, finish);
        this.tweens.killTweensOf(progress);
        if (root.active) root.destroy(true);
        resolve();
      };
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, finish);
      this.tweens.add({
        targets: progress,
        value: 1,
        duration,
        ease: 'Sine.InOut',
        onUpdate: () => {
          const amount = progress.value;
          const lift = Math.sin(Math.PI * amount) * arc;
          root
            .setPosition(
              Phaser.Math.Linear(from.x, to.x, amount) + perpendicular.x * lift,
              Phaser.Math.Linear(from.y, to.y, amount) + perpendicular.y * lift
            )
            .setRotation(Math.atan2(unit.y, unit.x) + amount * Math.PI * 7);
          glow.setAlpha(0.14 + Math.sin(amount * Math.PI * 6) * 0.08);
        },
        onComplete: finish,
      });
    });
  }

  private vfxSummonPuff(at: Vec2, size: number): Promise<void> {
    const key = 'fx-summon-smoke';
    if (!this.anims.exists(key)) return Promise.resolve();
    return new Promise((resolve) => {
      const sprite = this.add
        .sprite(at.x, at.y, key, 0)
        .setDepth(10)
        .setDisplaySize(size, size);
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.events.off(Phaser.Scenes.Events.SHUTDOWN, finish);
        if (sprite.active) sprite.destroy();
        resolve();
      };
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, finish);
      sprite.play(key);
      sprite.once('animationcomplete', finish);
    });
  }

  private vfxProjectile(from: Vec2, to: Vec2, visual: SpellVisual): Promise<void> {
    const distance = dist(from, to);
    if (distance < 3) return this.vfxBurst(to, visual.color, 28, visual.speed ?? 1);

    return new Promise((resolve) => {
      const speed = Math.max(0.25, visual.speed ?? 1);
      const radius = Phaser.Math.Clamp(visual.size ?? 10, 5, 18);
      const unit = { x: (to.x - from.x) / distance, y: (to.y - from.y) / distance };
      const start = {
        x: from.x + unit.x * (MAGE_RADIUS * 0.65),
        y: from.y + unit.y * (MAGE_RADIUS * 0.65),
      };
      const end = { x: to.x - unit.x * 4, y: to.y - unit.y * 4 };
      const arc = this.reducedMotion ? 0 : Math.min(28, distance * 0.065);
      const duration = this.reducedMotion
        ? 90
        : Phaser.Math.Clamp(
          (distance / (FX_TWEEN.projectile.pixelsPerSecond * speed)) * 1000,
          FX_TWEEN.projectile.minDuration,
          FX_TWEEN.projectile.maxDuration,
        );

      const root = this.add.container(start.x, start.y).setDepth(31);
      const tail = this.add
        .rectangle(-radius * 0.8, 0, radius * 3.4, radius * 1.25, visual.color, 0.24)
        .setOrigin(1, 0.5)
        .setBlendMode(Phaser.BlendModes.ADD);
      const innerTail = this.add
        .rectangle(-radius * 0.35, 0, radius * 2.25, Math.max(2, radius * 0.42), 0xffffff, 0.58)
        .setOrigin(1, 0.5)
        .setBlendMode(Phaser.BlendModes.ADD);
      const aura = this.add
        .circle(0, 0, radius * 1.6, visual.color, 0.24)
        .setBlendMode(Phaser.BlendModes.ADD);
      const body = this.add.circle(0, 0, radius, visual.color, 0.96);
      const core = this.add
        .circle(-radius * 0.12, -radius * 0.12, Math.max(2, radius * 0.38), 0xffffff, 0.92)
        .setBlendMode(Phaser.BlendModes.ADD);
      root.add([tail, innerTail, aura, body, core]);
      root.setScale(this.reducedMotion ? 1 : 0.72);

      const progress = { value: 0 };
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.events.off(Phaser.Scenes.Events.SHUTDOWN, finish);
        this.tweens.killTweensOf(root);
        this.tweens.killTweensOf(aura);
        this.tweens.killTweensOf(progress);
        if (root.active) root.destroy(true);
        resolve();
      };
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, finish);

      if (!this.reducedMotion) {
        this.tweens.add({
          targets: root,
          scale: 1,
          duration: Math.min(130, duration * 0.4),
          ease: 'Back.Out',
        });
        this.tweens.add({
          targets: aura,
          scale: 1.28,
          alpha: 0.12,
          duration: 90,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.InOut',
        });
      }

      this.tweens.add({
        targets: progress,
        value: 1,
        duration,
        ease: FX_TWEEN.projectile.ease,
        onUpdate: () => {
          const amount = progress.value;
          const x = Phaser.Math.Linear(start.x, end.x, amount);
          const y = Phaser.Math.Linear(start.y, end.y, amount) - Math.sin(Math.PI * amount) * arc;
          const tangentX = end.x - start.x;
          const tangentY = end.y - start.y - Math.cos(Math.PI * amount) * Math.PI * arc;
          root.setPosition(x, y).setRotation(Math.atan2(tangentY, tangentX));
        },
        onComplete: () => {
          this.tweens.killTweensOf(aura);
          if (root.active) root.destroy(true);
          void this.vfxBurst(to, visual.color, Math.max(26, radius * 3.1), speed).then(finish);
        },
      });
    });
  }

  /** A conjured attack that simply erupts on the target — no projectile travel. */
  private vfxConjure(at: Vec2, v: SpellVisual): Promise<void> {
    return new Promise((resolve) => {
      const speed = v.speed ?? 1;
      const size = v.size ?? 26;
      // A quick gathering flash, then a sharp shockwave at the target.
      const spark = this.add.circle(at.x, at.y, size * 0.4, 0xffffff, 0.9).setDepth(31);
      this.tweens.add({
        targets: spark,
        scale: { from: 0.2, to: 1.6 },
        alpha: { from: 0.9, to: 0 },
        duration: FX_TWEEN.conjureGather.duration / speed,
        ease: FX_TWEEN.conjureGather.ease,
        onComplete: () => spark.destroy(),
      });
      // A few jagged shards stabbing inward.
      for (let i = 0; i < 6; i++) {
        const ang = (Math.PI * 2 * i) / 6;
        const r0 = size * 1.8;
        const shard = this.add
          .circle(at.x + Math.cos(ang) * r0, at.y + Math.sin(ang) * r0, size * 0.22, v.color, 1)
          .setDepth(31);
        this.tweens.add({
          targets: shard,
          x: at.x,
          y: at.y,
          alpha: { from: 1, to: 0.2 },
          duration: FX_TWEEN.conjureShard.duration / speed,
          ease: FX_TWEEN.conjureShard.ease,
          onComplete: () => shard.destroy(),
        });
      }
      this.vfxBurst(at, v.color, size * 2.2, speed).then(resolve);
    });
  }

  /** A positive glow with rising sparkles on the target (heals / buffs / team). */
  private vfxHeal(at: Vec2, v: SpellVisual): Promise<void> {
    return new Promise((resolve) => {
      const speed = v.speed ?? 1;
      const size = v.size ?? 30;
      // A soft glow that swells and fades around the target.
      const glow = this.add.circle(at.x, at.y, size, v.color, 0.5).setDepth(29);
      glow.setStrokeStyle(3, 0xffffff, 0.8);
      this.tweens.add({
        targets: glow,
        scale: { from: 0.4, to: 1.5 },
        alpha: { from: 0.6, to: 0 },
        duration: FX_TWEEN.healGlow.duration / speed,
        ease: FX_TWEEN.healGlow.ease,
        onComplete: () => glow.destroy(),
      });
      // Rising sparkles.
      for (let i = 0; i < 8; i++) {
        const dx = (i / 7 - 0.5) * size * 2;
        const sparkle = this.add
          .circle(at.x + dx, at.y + size * 0.6, 3, 0xffffff, 1)
          .setDepth(31);
        this.tweens.add({
          targets: sparkle,
          y: at.y - size * 1.2,
          alpha: { from: 1, to: 0 },
          duration: FX_TWEEN.healSparkle.duration / speed,
          delay: (i * FX_TWEEN.healSparkle.stagger) / speed,
          ease: FX_TWEEN.healSparkle.ease,
          onComplete: () => sparkle.destroy(),
        });
      }
      this.time.delayedCall((FX_TWEEN.healGlow.duration + 20) / speed, resolve);
    });
  }

  private vfxBurst(at: Vec2, color: number, reach: number, speed: number): Promise<void> {
    return new Promise((resolve) => {
      const ring = this.add.circle(at.x, at.y, Math.max(8, reach), color, 0.2).setDepth(31);
      ring.setStrokeStyle(3, color, 1);
      ring.setScale(0.15);
      ring.setAlpha(0.95);
      this.tweens.add({
        targets: ring,
        scale: 1,
        alpha: 0,
        duration: FX_TWEEN.burst.duration / (speed || 1),
        ease: FX_TWEEN.burst.ease,
        onComplete: () => {
          ring.destroy();
          resolve();
        },
      });
    });
  }

  private vfxNova(at: Vec2, v: SpellVisual): Promise<void> {
    return this.vfxBurst(at, v.color, v.size ?? 55, v.speed ?? 1);
  }

  private vfxQuarterTurn(clockwise: boolean): void {
    const camera = this.cameras.main;
    this.tweens.add({
      targets: camera,
      rotation: clockwise ? Math.PI / 2 : -Math.PI / 2,
      duration: FX_TWEEN.quarterTurn.duration / this.combatSpeed,
      yoyo: true,
      hold: FX_TWEEN.quarterTurn.hold / this.combatSpeed,
      ease: FX_TWEEN.quarterTurn.ease,
    });
  }

  private vfxTwistRune(pivot: Vec2, radius: number, clockwise: boolean): void {
    const ring = this.add.circle(pivot.x, pivot.y, radius, 0xb8c878, 0.08).setDepth(30);
    ring.setStrokeStyle(4, 0xdfffa8, 0.9);
    const marker = this.add.circle(pivot.x + radius, pivot.y, 7, 0xffffff, 1).setDepth(31);
    const progress = { angle: 0 };
    this.tweens.add({
      targets: progress,
      angle: clockwise ? -Math.PI / 2 : Math.PI / 2,
      duration: FX_TWEEN.twistMarker.duration / this.combatSpeed,
      ease: FX_TWEEN.twistMarker.ease,
      onUpdate: () => {
        marker.setPosition(
          pivot.x + Math.cos(progress.angle) * radius,
          pivot.y + Math.sin(progress.angle) * radius
        );
      },
      onComplete: () => marker.destroy(),
    });
    this.tweens.add({
      targets: ring,
      scale: { from: 0.25, to: 1 },
      alpha: { from: 0.9, to: 0 },
      duration: FX_TWEEN.twistRune.duration / this.combatSpeed,
      ease: FX_TWEEN.twistRune.ease,
      onComplete: () => ring.destroy(),
    });
  }

  /**
   * Play a one-shot fx sprite sheet at a location, for ground-targeted spells.
   *  - `apexAtFrom`: anchor the sprite's apex at the caster and extend it toward
   *    `at` (used for cones — the sheet faces left, so its apex is the right edge).
   *  - `aim`: rotate a point-centred sheet to face the cast direction.
   *  - `lengthPx`: the on-field size (cone length / blast diameter) in pixels.
   */
  private vfxSpriteAt(
    key: string,
    at: Vec2,
    opts: { from?: Vec2; apexAtFrom?: boolean; aim?: boolean; lengthPx: number }
  ): Promise<void> {
    return new Promise((resolve) => {
      if (!this.anims.exists(key)) {
        resolve();
        return;
      }
      const spr = this.add.sprite(at.x, at.y, key).setDepth(9);
      const frameW = spr.width || 1;
      const frameH = spr.height || 1;
      if (opts.apexAtFrom && opts.from) {
        // Cone: apex at the caster, body fanning out toward the aimed point.
        spr.setOrigin(1, 0.5);
        spr.setPosition(opts.from.x, opts.from.y);
        spr.setScale(opts.lengthPx / frameW);
        const ang = Math.atan2(at.y - opts.from.y, at.x - opts.from.x);
        spr.setRotation(ang - Math.PI); // the sheet's cone faces left by default
      } else {
        spr.setOrigin(0.5, 0.5);
        spr.setScale(opts.lengthPx / frameH);
        if (opts.aim && opts.from) {
          const ang = Math.atan2(at.y - opts.from.y, at.x - opts.from.x);
          spr.setRotation(ang - Math.PI);
        }
      }
      spr.play(key);
      spr.once('animationcomplete', () => {
        spr.destroy();
        resolve();
      });
    });
  }

  /**
   * Play a one-shot slash animation (from the Pixel Art Slashes library) centred
   * at `at`, rotated to `angle` (the sheets face right by default), and scaled so
   * its width spans `sizePx`. Used to dress up melee strikes and the Cleave sweep.
   */
  private vfxSlash(animKey: string, at: Vec2, angle: number, sizePx: number): Promise<void> {
    return new Promise((resolve) => {
      const firstFrame = `${animKey}-0`;
      if (!this.anims.exists(animKey) || !this.textures.exists(firstFrame)) {
        resolve();
        return;
      }
      const spr = this.add.sprite(at.x, at.y, firstFrame).setDepth(32);
      const frameW = spr.width || 1;
      spr.setOrigin(0.5, 0.5);
      spr.setScale(sizePx / frameW);
      spr.setRotation(angle);
      spr.play(animKey);
      spr.once('animationcomplete', () => {
        spr.destroy();
        resolve();
      });
    });
  }

  /**
   * Paint the shatter cone stretched to fill a reality wedge barrier: the sheet's
   * apex is pinned to `apex` and its body is scaled non-uniformly so its length
   * matches `range` and its far-edge width matches the wedge's arc (`halfAngle`).
   * The sheet's cone faces left by default, so we rotate it to open toward `angle`.
   */
  private vfxWedge(apex: Vec2, angle: number, halfAngle: number, range: number): void {
    const key = 'fx-shatter';
    if (!this.anims.exists(key)) return;
    const spr = this.add.sprite(apex.x, apex.y, key).setDepth(9);
    const frameW = spr.width || 1;
    const frameH = spr.height || 1;
    spr.setOrigin(1, 0.5); // apex sits at the sheet's right edge
    spr.setRotation(angle - Math.PI); // the sheet's cone faces left by default
    const farWidth = 2 * range * Math.tan(halfAngle);
    spr.setScale(range / frameW, Math.max(farWidth, 1) / frameH);
    spr.play(key);
    spr.once('animationcomplete', () => spr.destroy());
  }

  // ===========================================================================
  //  DICE WINDOW
  // ===========================================================================

  private async playPendingDice(): Promise<void> {
    if (this.deferDice) return;
    const queued = this.pendingDice;
    this.pendingDice = [];
    const mode = Dev.skipDice ? 'none' : diceMode();
    if (mode === 'none') {
      this.diceField?.hide();
      return;
    }
    if (queued.length === 0) return;

    const groups = this.groupPendingDice(queued);
    playSound('dice.roll');
    // A wide batch would otherwise linger; tighten it as the tray count grows.
    const speed = Phaser.Math.Clamp(1 + (groups.length - 1) * 0.16, 1, 1.9);
    await this.diceField?.play(groups, this.reducedMotion, speed, mode);

    // Sting the swing rolls only; damage dice would fire this constantly.
    const d20s = queued.filter((roll) => roll.spec.includes('d20'));
    if (d20s.some((roll) => roll.rolls.includes(20))) playSound('dice.crit');
    else if (d20s.some((roll) => roll.rolls.includes(1))) playSound('dice.fumble');
  }

  /**
   * Put each roll over the bodies it landed on. Most spells roll without saying
   * who for, so an unattributed roll claims whichever bodies were damaged
   * before the next roll: that separates a shared roll applied to a whole cone
   * from a loop rolling separately for each victim, without either spelling it
   * out. Consecutive rolls with no damage between them claim the same bodies,
   * which is how a two-type hit stacks both rows over one enemy.
   */
  private groupPendingDice(queued: PendingRoll[]): DiceGroup[] {
    const groups: DiceGroup[] = [];
    const byMage = new Map<Mage, DiceGroup>();
    const centre: DiceGroup = { rolls: [] };
    const struck = this.pendingImpacts;

    const push = (mage: Mage, view: DiceRollView): void => {
      let group = byMage.get(mage);
      if (!group) {
        group = { at: { x: mage.x, y: mage.y }, rolls: [] };
        byMage.set(mage, group);
        groups.push(group);
      }
      group.rolls.push(view);
    };

    let carried: DiceRollView[] = [];
    queued.forEach((roll, index) => {
      const view: DiceRollView = {
        spec: roll.spec,
        total: roll.total,
        rolls: roll.rolls,
        label: roll.label,
      };
      if (roll.mage) {
        push(roll.mage, view);
        return;
      }
      carried.push(view);
      const until = queued[index + 1]?.seq ?? Infinity;
      const claimed = new Set(
        struck.filter((hit) => hit.seq > roll.seq && hit.seq < until).map((hit) => hit.mage),
      );
      if (claimed.size === 0) return;
      for (const mage of claimed) for (const carriedView of carried) push(mage, carriedView);
      carried = [];
    });

    // Rolls that never damaged anybody (checks, chances) keep the centre rail.
    if (carried.length > 0) {
      centre.rolls.push(...carried);
      groups.push(centre);
    }
    return groups;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }
}

interface ReactionChoice {
  spell?: Spell;
  target?: Mage;
  point?: Vec2;
  /** A shield reaction (block or bash) instead of a spell. */
  shield?: 'block' | 'bash';
  /** A white-identity weapon strike back at the attacker. */
  weapon?: boolean;
  /** A Needle of Serenity reaction: stifle & permanently ban the action. */
  needle?: boolean;
  /** A Dexterity dodge: roll to evade the attack (and maybe more). */
  dodge?: boolean;
}

function dots(remaining: number, total: number): string {
  return '●'.repeat(Math.max(0, remaining)) + '○'.repeat(Math.max(0, total - remaining)) || '—';
}
