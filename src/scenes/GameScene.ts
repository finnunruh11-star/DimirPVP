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
  TOP_MENU,
  TOP_TOGGLES,
  TOP_TURN,
  WORD_COLS,
  WORD_ROWS,
  bottom,
  centerY,
  panelBody,
  right,
  spellReadout,
  wordSlot,
  type Rect,
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
  OfferingMenuView,
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
  type InventoryActionView,
  type InventoryItemView,
} from '../ui/combat/InventoryView';
import { SwampShopView, type SwampOfferView } from '../ui/pve/SwampShopView';
import { MinePromptView, type MineVisualView } from '../ui/pve/MinePromptView';
import { MineChamberView, type MineChamberChoice } from '../ui/pve/MineChamberView';
import { MineMapView, type MineMapModel, type MineTrapShow, type MineWalker } from '../ui/pve/MineMapView';
import type { MineVoteDisplay, MineVoteState } from '../ui/pve/MineVoteStrip';
import { tallyVotes } from '../pve/partyVote';
import { restoreParty } from '../pve/exploration/party';
import { MineDepositView } from '../ui/pve/MineDepositView';
import { LootView } from '../ui/pve/LootView';
import { canClaimLoot, claimLoot, lootEntries, parseLootChoice } from '../pve/loot';
import { itemRarityColor } from '../visuals/itemIcons';
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
import { SpellVfx } from '../visuals/SpellVfx';
import { DevResourceEditor, readDevResources, writeDevResources, type DevResources } from '../ui/workshop/DevResourceEditor';
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
  SILVER_PER_GOLD,
  START_HP,
  START_SANITY,
  TEXT,
} from '../config/constants';
import { GameState, hazardDistance } from '../core/GameState';
import { Mage, type SummonOrderKind } from '../core/Mage';
import { packCanStow, packFits, packLabel } from '../core/Pack';
import { Dice } from '../core/Dice';
import { analyzeDodge, dodgeGrantsBonusAction, type DodgeTier } from '../core/Dodge';
import { scenarioToMages, scenarioToScarabs, type Scenario } from '../core/Scenario';
import { downloadScenario, pickScenarioFile } from '../ui/scenarioFile';
import { addOrExtendStatus, type Status } from '../core/Status';
import { makeGhostSummon } from '../core/summons';
import { TutorialView, type TutorialDisplay, type TutorialEvent } from '../ui/combat/TutorialView';
import {
  TUTORIAL_STEPS,
  type TutorialFocus,
  type TutorialStage,
} from '../pve/tutorial';
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
import edgelordImpactSheetUrl from '../../spritesheet/Lightning/lightning_burst_003/lightning_burst_003_large_violet/spritesheet.png';
import lightningChargeSheetUrl from '../../spritesheet/Lightning/lightning_burst_001/lightning_burst_001_large_violet/spritesheet.png';
import lightningImpactSheetUrl from '../../spritesheet/Lightning/lightning_burst_002/lightning_burst_002_large_violet/spritesheet.png';
import lightningStrikeSheetUrl from '../../spritesheet/Lightning/lightning_strike_001/lightning_strike_001_large_violet/spritesheet.png';
import summonSmokeSheetUrl from '../../spritesheet/Smoke Bursts/symmetrical_smoke_burst_001/symmetrical_smoke_burst_001_small_brown/spritesheet.png';
import swampMistSheetUrl from '../../spritesheet/Smoke Bursts/directional_smoke_burst_001/directional_smoke_burst_001_large_white/spritesheet.png';
import swampTilesUrl from '../assets/arena/kenney/roguelikeSheet_transparent.png';
import { scarabAlive, type ScarabState } from '../core/Scarab';
import { Dev, isSharedToggle, resetSharedToggles, type DevToggle } from '../config/dev';
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
import { stormWordsCompatible, WORD_COLOR, wordCardColor, wordSpellMana, type ColorName } from '../core/Colors';
import { levelWordPool } from '../pve/exploration/levels';
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
  WORN_SLOTS,
  aiDraft,
  asItemIds,
  carryCapacity,
  rollRarity,
  draftChoices,
  rarityRank,
  isRangedWeapon,
  DRAFT_ROUNDS,
  RARITY_COLOR,
  setActiveItemSets,
  staffDice,
  ITEM_DEFS,
  type ItemId,
  type Rarity,
} from '../core/Items';
import type { PendingCast, StackItem } from '../core/Stack';
import type { DamageType } from '../core/Damage';
import { barrierContains } from '../core/Barrier';
import { FLEE_EDGE_LABEL, fleeEdgeAt, type FleeEdge } from '../core/Flee';
import { captureSummons, fightingParty, memberOf, mergeFightParty, partyScale, partyXpScale, syncPendingLevels, withSummons } from '../pve/exploration/coop';
import { AdventureSession } from '../net/AdventureSession';
import { addXp, killXp, levelCoreStatGain, levelReward, rackIsFull, xpToNext } from '../pve/progression';
import type { ExplorationEntry } from './ExplorationScene';
import type { Spell, SpellVisual } from '../spells/Spell';
import { allSpells, getSpell, isClassSpellCombo, spellById, spellForSelection, setActiveSpellSets, ADVENTURE_SPELL_SETS } from '../spells/registry';
import { castOddsLabel, spellCastDc } from '../spells/castOdds';
import { closestMindLightningDirection } from '../spells/mindLightning';
import { dist, stepTowards, type Vec2 } from '../core/utils';
import type {
  CombatFeedback,
  GodFxKind,
  SubTargetCombatantOpts,
  SubTargetPointOpts,
  SubTargetEnemyOpts,
  SubTargetRerollOpts,
  OfferingChoice,
  OfferingOpts,
} from '../effects/effects';
import { HEX_LAW_NAMES, HEX_LAW_TEXT, IMBUES, MINIONS, robeOf } from '../effects/classKit';
import { activateHexzettel, hexAimProblem, hexColor, hexOf } from '../effects/hexzettel';
import { hexAction, hexAim, hexHarmful, hexManaCost, hexRadius, hexRange, type HexAim as HexAimKind, type HexRecipe } from '../core/hexcraft/runes';
import { SHIKIGAMI_TIERS, shikigamiTier } from '../effects/deathKit';
import {
  ACTION_FX_PRESETS,
  BOW_SHOT,
  FX_MOTION,
  FX_TWEEN,
  MELEE_SWING,
  SPELL_IMPACT_WEIGHT,
  type ImpactWeight,
} from '../effects/FxPresets';
import { CombatFeedbackLayer } from '../visuals/CombatFeedbackLayer';
import { ImpactFxDirector } from '../visuals/ImpactFxDirector';
import { preloadImpactSheets } from '../visuals/ImpactSheets';
import { ParticleFx } from '../visuals/ParticleFx';
import { bindBossIdleSpecial, bossAnimKey, bossAttackKeys, bossCast, bossIsIdleSpecial, bossSheet, bossSpriteKind, ensureBossSprites, hasBossSprites, preloadBossSheets } from '../visuals/bosses';
import { placeholderSpriteFor } from '../visuals/creatureLooks';
import { playBossIntro } from '../ui/combat/BossIntro';
import { BOSSES, BOSS_STAND_IN, MOONSHARD, bossDamageScales, bossRoster, bossScaling, nextBloodmoonDay, type BossFight, type BossUnit } from '../pve/exploration/bloodmoon';
import { GOBLIN_HASTE, GOBLIN_HEX, GOBLIN_MEND_HP, GOBLIN_RITE_RANGE } from '../pve/goblins';
import { MOAY_AOE_RADIUS } from '../pve/moay';
import { BARAL_HP_MARK, DENIAL_SPAWN_RADIUS_UNITS, DRAKE_LIFESPAN, denialLabel, denialStartCharges, denialThreshold } from '../pve/baral';
import { crusadeCrew, crusadeHelperHealth, crusadeLabel, isCrusadeBuilding, isCrusadeFighter, isCrusadeKind } from '../pve/crusade';
import { canCrusadeAction, resolveCrusadeAction, spawnCrusadeHelpers } from '../pve/crusadeCombat';
import {
  LILLITH_CIRCLE_RADIUS,
  LILLITH_ORB_HP,
  lillithAfterSpawns,
  lillithGraveHeld,
  lillithTurnStart,
  makeLillithCopy,
  openLillith,
} from '../pve/lillith';
import {
  createCreatureAnims,
  CREATURE_FRAME_RATIO,
  creatureFacesRight,
  creatureSpriteFor,
  creatureTexture,
  ensureCreatureSprites,
  preloadCreatureSprites,
  type CreatureSpriteKind,
} from '../world/creatureSprite';
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
import { summonOrderDecision, summonOrderTarget } from '../ai/summonOrders';

/** Damage types with their own authored voice; anything else lands as a hit. */
const DAMAGE_SOUND: Record<string, SoundName> = {
  corrosive: 'spell.corrosive',
  fire: 'spell.fire',
  heat: 'spell.fire',
  shatter: 'spell.shatter',
  slashing: 'hit.slash',
  pierce: 'hit.pierce',
};

/** Words that bring their own sound, so the generic spell voice stays off. */
const SELF_VOICED_WORDS = new Set(['lightning', 'fire', 'corrode', 'drain']);

/** Gap between each newly-hit body's recoil in a multi-target burst. */
const AOE_STAGGER_MS = 90;

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

import type { ExplorationCombat, ExplorationOpening, MatchConfig, SeatConfig, SwampPrepMode } from '../config/MatchConfig';
import { buildMineRoomTextures, mineTrapIconTextureKey, mineTrapTextureKey } from './mineVisualTextures';
import type { Net, NetMessage } from '../net/Net';
import {
  applyEnemyTraits,
  canSpawnReaper,
  rollSwamprunEncounter,
  swamprunDepth,
  ENEMY_DEFS,
  rollLoot,
  type EnemyKind,
  type SwamprunCurse,
} from '../pve/swamprun';
import { isBloodmoonRaid, raidTargetName, raidTargetPower, type RaidTarget } from '../pve/raidTargets';
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
import { rollEncounter, rollForestWave, rollReinforcements, describeSpawns } from '../pve/exploration/encounters';
import { sceneRoster, type SceneFight, type ScenePerson, type SceneUnit } from '../pve/exploration/sceneFight';
import { drawSceneProps } from '../visuals/ArenaProps';
import { clockTime } from '../pve/exploration/clock';
import { dropKind, rollDrops } from '../pve/exploration/drops';
import { DUNGEON_REFIGHT, DUNGEONS } from '../pve/exploration/dungeons';
import { enterMines, markMineKnown, minePassageDice, spendMineHours } from '../pve/exploration/mines';
import { mineTunnelHours } from '../pve/mineLayout';
import type { DungeonId } from '../pve/exploration/world';
import { canUseMineAction, commitMineAction, makeMineActionItem } from '../pve/mineActions';
import {
  MINE_DIRECTIONS,
  MINE_DIRECTION_LABEL,
  MINE_ORE_DEFS,
  MINE_OPPOSITE_DIRECTION,
  MINE_TRAP_NAME,
  createMineMaze,
  currentMineNode,
  mineDepositAllows,
  mineRoomNeedsInteraction,
  mineTrapHarm,
  revealMineOre,
  rollMineTrapAvoidance,
  strikeMineVein,
  travelMineMaze,
  type MineDirection,
  type MineMazeNode,
  type MineMazeState,
  type MineRoomState,
  type MineTrapDamage,
  type MineVein,
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

/** The sound each god-word flourish is voiced with. */
const GOD_FX_SOUNDS: Record<GodFxKind, SoundName> = {
  deathMark: 'unit.death',
  skull: 'spell.vanish',
  reap: 'melee.slash',
  hex: 'spell.corrosive',
  void: 'spell.vanish',
  warp: 'spell.blink',
  sphere: 'spell.cast',
  implode: 'spell.pull',
  rift: 'spell.thunder',
  cataclysm: 'spell.explode',
};

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
  {
    // A directional splash thrown back out of a puncture — plays on an arrow
    // arriving. The B&W set is near-white so a tint can carry the damage type.
    key: 'fx-arrow-impact',
    frames: globFrames(
      import.meta.glob('../../Pixel Art VFX Impacts - FREE Version/VFX5/B&W/Frames/*.png', {
        eager: true,
        import: 'default',
      })
    ),
    frameRate: 26,
    repeat: 0,
  },
];

type BodyAnimState = 'idle' | 'run' | 'role' | 'charge' | 'attack' | 'hurt' | 'death';

type HeldWeaponKind = 'sword' | 'dagger' | 'spear' | 'axe' | 'hammer' | 'club' | 'bow' | 'staff' | 'shield' | 'lantern';

/** Per-mage sprite + animation-state machine. */
interface MageAnim {
  sprite: Phaser.GameObjects.Sprite;
  baseScale: number;
  shoulderScale?: number;
  held?: Phaser.GameObjects.Image;
  heldVisualKey?: string;
  /** Binding roots held on the body while a physical root lasts. */
  root?: Phaser.GameObjects.Sprite;
  /** A ring of stars spinning over the head while a full stun lasts. */
  stun?: Phaser.GameObjects.Sprite;
  /** A braced ward held while a shield block is armed. */
  guard?: Phaser.GameObjects.Image;
  /** A special animation currently owning the sprite (else idle/charge rests). */
  lock: 'move' | 'dash' | 'pull' | 'attack' | 'hit' | 'death' | null;
  /** A sprite-position tween owns the position; don't snap to logical. */
  posLocked: boolean;
  /** A swing tween owns the held weapon's placement; leave it alone. */
  heldLocked?: boolean;
  /** The attack-charge loop is the current resting animation. */
  charging: boolean;
  /** A fatal hit is queued but waits for the damage dice to settle. */
  deathPending: boolean;
  /** The death animation has finished and the body can remain hidden. */
  deathComplete: boolean;
  /** Last applied Mine tint/scale state; changes when a Golem wakes. */
  mineVisualKey?: string;
  /** Strikes played so far, so a boss with several swings takes them in turn. */
  swings?: number;
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

export type InputMode =
  | 'idle'
  | 'aiming-spell'
  | 'aiming-point'
  | 'aiming-melee'
  | 'aiming-throw'
  | 'aiming-eldritch'
  | 'aiming-staff'
  | 'aiming-hex'
  | 'aiming-discharge'
  | 'aiming-move'
  | 'aiming-leap'
  | 'aiming-cleave'
  | 'aiming-shout'
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
  | 'pickup-menu'
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

/** Exploration fights take the look of the region they happen in. */
const EXPLORATION_ARENAS: Record<string, ArenaTheme> = {
  capitol: { kind: 'duel', floor: 0x1b2616, tile: 0x2b3a22, grid: 0x5e7048, accent: 0x9fb070, shadow: 0x0a0f08 },
  black: { kind: 'swamp', floor: 0x12221c, tile: 0x20372c, grid: 0x526b59, accent: 0x82946b, shadow: 0x07100d },
  forest: { kind: 'swamp', floor: 0x10200f, tile: 0x1c3219, grid: 0x4a6a42, accent: 0x7aa060, shadow: 0x060d05 },
  red: { kind: 'mine', floor: 0x1e1511, tile: 0x2e1f18, grid: 0x7a4a34, accent: 0xc0683a, shadow: 0x0c0806 },
  wilds: { kind: 'mine', floor: 0x1a1210, tile: 0x2c1a14, grid: 0x8a3a22, accent: 0xe0602a, shadow: 0x0a0605 },
  lake: { kind: 'duel', floor: 0x14262c, tile: 0x1f3a42, grid: 0x5a8a94, accent: 0x9fd0da, shadow: 0x081216 },
  white: { kind: 'duel', floor: 0x2c2416, tile: 0x3c3120, grid: 0x8a7650, accent: 0xe0c890, shadow: 0x120e08 },
};

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
  | { t: 'item-pickup-swap'; dropId: number; discard: ItemId }
  | { t: 'item-use'; itemId: string }
  | { t: 'item-ready'; itemId: string }
  | { t: 'pouch-store' | 'pouch-remove'; itemId: string }
  | { t: 'item-equip'; itemId: string; replace?: string; hand?: 'main' | 'off' }
  | { t: 'item-swap-hands' }
  | { t: 'item-unequip'; itemId: string }
  | { t: 'item-throw'; itemId: string; target: number }
  | { t: 'hex'; itemId: string; target: number | null; x?: number; y?: number }
  | { t: 'edgelord-shake' }
  | { t: 'edgelord-throw'; x: number; y: number }
  | { t: 'deaths-angel-wings' }
  | { t: 'eldritch'; choice: 'attack' | 'defend' | 'restore'; target?: number }
  | { t: 'staff-bolt'; item: string; bolt: number; target: number }
  | { t: 'thunder-charge' }
  | { t: 'thunder-discharge'; target: number }
  | { t: 'cast-random' }
  | { t: 'weapon-action'; x?: number; y?: number }
  | { t: 'leap'; x: number; y: number }
  | { t: 'focus' }
  | { t: 'cleave'; x: number; y: number }
  | { t: 'command'; summon: number }
  | { t: 'shout'; order: SummonOrderKind; target?: number }
  | { t: 'summon-shoulder'; summon: number; carry: boolean }
  | { t: 'uncommand' }
  | { t: 'mantle-bind' }
  | { t: 'robe-cast' }
  | { t: 'cleanse' }
  | { t: 'switch-weapon' }
  | { t: 'flee' }
  | { t: 'raid-begin' }
  | { t: 'raid-restore'; kind: RaidRestoreKind }
  | { t: 'dev'; key: DevToggle; on: boolean }
  | { t: 'dev-resources'; seat: number; values: DevResources }
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
  | { t: 'sub-reroll'; reroll: boolean }
  | { t: 'sub-offering'; life: number; items: boolean; summons: number[] }
  | { t: 'sub-none' };

/** A mid-resolution draft pick (Gambler's Blade cash-out): the chosen card index. */
type DraftCommand = { t: 'draft'; index: number };

/** The selected action in a synchronized perfect-dodge bonus window. */
type DodgeBonusChoiceCommand = { t: 'dodge-bonus'; optionId: string | null };

const MAGE_RADIUS = 22;
const CREATURE_SPRITE_HEIGHT = MAGE_RADIUS * 2.8 * CREATURE_FRAME_RATIO;

/** Where each of a boss's units takes the field: the leader front and centre, raiders ahead of it, shamans at the back. */
function bossSpawnPoint(unit: BossUnit, index: number): Vec2 {
  const row = (share: number, i: number, count: number): Vec2 => ({
    x: FIELD.x + FIELD.w * share,
    y: FIELD.y + (FIELD.h * (i + 1)) / (count + 1),
  });
  if (isCrusadeKind(unit.kind)) {
    const share = unit.kind === 'crusadeSoldier' ? 0.6 : unit.kind === 'crusadePriest' ? 0.91
      : unit.kind === 'crusadeHelper' ? 0.76 : unit.kind === 'crusadeCamp' ? 0.94 : 0.82;
    return row(share, index, unit.count);
  }
  if (unit.leader) return row(0.72, 0, 1);
  if (unit.kind === 'goblinShaman') return row(0.9, index, unit.count);
  return row(0.6 + (index % 2) * 0.04, index, unit.count);
}

const creatureSpriteKind = (mage: Mage): CreatureSpriteKind | null =>
  mage.bossArt ? bossSpriteKind(mage.bossArt)
  : mage.summonKind ? creatureSpriteFor(mage.summonKind) ?? placeholderSpriteFor(mage.summonKind)
  : creatureSpriteFor(mage.mine?.kind ?? mage.enemyKind);

/** How a loosed Hexzettel looks on the stack. */
function hexVisual(hex: HexRecipe): StackItem['actionVisual'] {
  const effects = hex.parts.flatMap((part) => part.effects);
  if (effects.includes('explosion') || effects.includes('implosion')) return 'fire';
  if (effects.includes('corrosive') || effects.includes('siphon')) return 'corrosive';
  return hexHarmful(hex) ? 'shadow' : 'heal';
}

/** The team each side of a scene fights on: the party is 1, the scene's foes 2. */
const SCENE_TEAM: Record<SceneUnit['side'], number> = { escort: 1, foe: 2, rival: 3, prey: 4 };

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

/** The standing order given to every summon at once. */
const SHOUT_LABEL: Record<SummonOrderKind, string> = {
  return: 'RETURN',
  flee: 'FLEE',
  attack: 'ATTACK',
  anyone: 'ATTACK ANYONE',
};

const SHOUT_DESC: Record<SummonOrderKind, string> = {
  return: 'All summons return to you each turn until given another order. Bonus action.',
  flee: 'All summons flee from enemies for 2 turns or until given another order. Bonus action.',
  attack: 'Pick an enemy: all summons attack it until given another order. Bonus action.',
  anyone: 'All summons attack the nearest enemy until given another order. Bonus action.',
};

/** How the action palette is grouped, so it reads as short lists. */
const ACTION_GROUPS: { title: string; ids: string[] }[] = [
  { title: 'SUMMONS', ids: ['command', 'shout:*', 'summon-shoulder:*'] },
  { title: 'CORE', ids: ['cast', 'move', 'attack', 'end'] },
  { title: 'MANOEUVRE', ids: ['leap', 'cleave', 'focus', 'flee'] },
  {
    title: 'POWERS',
    ids: [
      'weapon',
      'staff:*',
      'eldritch',
      'thunder',
      'deaths-angel-wings',
      'mantle-bind',
      'robe-cast',
      'cleanse',
      'edgelord-shake',
      'edgelord-throw',
    ],
  },
  { title: 'ITEMS', ids: ['inventory', 'switch-weapon', 'drop', 'pickup', 'throw', 'hex'] },
  {
    title: 'RUN',
    ids: ['raid-begin', 'raid-restore-vitals', 'raid-restore-mana', 'raid-restore-words', 'pickaxe'],
  },
  { title: 'RESPOND', ids: ['react-cast', 'needle', 'block', 'bash', 'dodge', 'weapon', 'pass'] },
];
/** Practice targets kept standing during raid preparation. */
const RAID_PREP_EFFIGIES = 3;
const PINNED_ACTIONS_KEY = 'dimir.pinnedActions';

function loadPinnedActions(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PINNED_ACTIONS_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}
/** Standard loadout, SNIFF's extra Storm word, and the modifier slot. */
const WORD_SLOTS = LOADOUT_SIZE + 2;

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
  tone?: MineChamberChoice['tone'];
}

/** The room a mine prompt pictures: dark from its doorway or lit from inside, and what that means in a few words. */
interface MinePromptVisual {
  room: MineRoomState;
  /** The maze node: it varies the rock and where things sit. */
  node: number;
  lit: boolean;
  verdict: string;
  verdictColor: number;
}

/** A tunnel trap as it was rolled, before the walk shows it and its damage lands. */
interface MineTrapOutcome {
  spec: MineTrapDamage;
  target: Mage;
  spotted: boolean;
  dodgeChance: number;
  dodged: boolean;
  /** The damage rolled. */
  amount: number;
  /** The HP it takes once full health has had its say. */
  dealt: number;
  fatal: boolean;
  clung: boolean;
}

/** The colour of the big line under a mine room's picture. */
const MINE_VERDICT = {
  danger: 0xe0645a,
  ore: 0xe6c25a,
  treasure: 0xf0cc6a,
  shop: 0xf0b860,
  quiet: 0x9fc7a8,
} as const;

interface CreativePrepResult {
  stats: Record<StatKey, number>;
  items: ItemId[];
}


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
/** Time a mine fight takes, in hours; walking into a room costs none. */
const MINE_FIGHT_HOURS = 10 / 60;
/** Time a visit to an ore deposit takes, however many strikes. */
const MINE_DIG_HOURS = 0.5;
/** A player's colour in the Mines: their vote tokens and their walker on the map, by seat. */
const MINE_VOTE_COLORS = [0xf0c860, 0x7fd0b8, 0xe0806a, 0xa890e0];
/** How a staff bolt of each damage type flies. */
const STAFF_BOLT_VISUAL: Partial<Record<DamageType, NonNullable<StackItem['actionVisual']>>> = {
  heat: 'fire',
  shatter: 'shatter',
  shadow: 'shadow',
  sanity: 'shadow',
  corrosive: 'corrosive',
};

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
  /**
   * Turn-start effects are still resolving. An action they run must not hand
   * the turn out early: online, a command sent then would be applied before the
   * rest of the turn start here, but after it on every other peer.
   */
  private turnStarting = false;
  /**
   * Changes whenever the turn in progress is over: a new turn began, or a
   * cleared wave or room took it along. A turn can end without an End command.
   */
  private turnSerial = 0;

  private mode: InputMode = 'idle';
  private busy = false;
  /** Set once the result banner is up, so repeated isOver checks are ignored. */
  private gameEnded = false;
  /** Set while handing control back to the menu, so it can only happen once. */
  private leaving = false;

  // Training sandbox (offline only). Enabled when the match mode is 'training'.
  private training = false;
  // Guided tutorial: the same sandbox driven by a script that teaches the game.
  private tutorial = false;
  private tutorialView?: TutorialView;
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
  private raidBoss: RaidTarget = 'deathknightSpear';
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
  /** The read-only inventory opened over the mine map; the party may move on while it is open. */
  private mineInventoryOpen = false;
  private mineChoiceResolve: ((choice: string) => void) | null = null;
  private mineCombatResolve: (() => void) | null = null;
  /** Shared tools; each entry is one pickaxe's remaining durability out of 10. */
  private minePickaxes: number[] = [];
  private mineChestCursor = 0;
  private mineCrushed = false;
  private mineMapView?: MineMapView;
  /** The open mine window that shows the running party vote. */
  private mineVoteDisplay: MineVoteDisplay | null = null;
  /** Numbers each party vote, so a late vote never counts in the next one. */
  private mineVoteRound = 0;
  /** Drawn from the shared dice once per visit: a late vote from an earlier visit never matches a round of this one. */
  private mineVoteSalt = 0;
  /** The leader settles the running vote on what has been cast. */
  private mineVoteDecide: (() => void) | null = null;
  /** The party carries a Minemap: its map of the Mines is kept between visits. */
  private mineRemembers = false;
  /** A junction just reached, greeted when the map is next drawn. */
  private mineRevealNext: number | null = null;
  /** The last mine window showed a room: the map, next opened, pulls back out of it. */
  private mineFromRoom = false;
  private swampPrepMode: SwampPrepMode = 'custom';
  private runLevel = 1;
  private runXp = 0;
  private pendingLevels = 0;
  private xpEnemies = new Set<Mage>();
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
  /** The staff bolt being aimed: which held staff, and which of its bolts. */
  private staffPending: { item: ItemId; bolt: number } | null = null;
  /** The Hexzettel being aimed at a unit or a point. */
  private hexPending: ItemId | null = null;
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
  private subtargetDirections: Vec2[] | null = null;
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
  private pickupMenu?: PagedChoiceMenuView<ItemId>;

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
  /** Action ids starred in the action menu; shown down the side of the field. */
  private readonly pinnedActions = loadPinnedActions();
  private pinnedPanel?: Phaser.GameObjects.Container;
  private pinnedSignature = '';
  /** The always-visible button that opens the action menu. */
  private actionMenuButton?: Phaser.GameObjects.Text;
  private castButton?: Phaser.GameObjects.Text;
  private endTurnButton?: Phaser.GameObjects.Text;
  private pauseView?: PauseView;
  private pauseReturn: 'idle' | 'reaction' = 'idle';

  // Dev / testing cheat panel.
  private devPanel!: Phaser.GameObjects.Container;
  private devToggles: { key: DevToggle; label: string; hot: string; control: CabinetChip }[] = [];
  private devClickGuard = false;
  // Dev resource editor (HP / mana / sanity / actions / stacks of any entity).
  private devResourceEditor?: DevResourceEditor;
  private readonly workshopFocus = new MenuFocusGroup();
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
  /** The channelled spell being aimed as it is released, for its area preview. */
  private channelAimSpell: Spell | null = null;
  // When on, the local player's reaction windows auto-pass (never prompt).
  // Can be toggled at any time (key [O] or the on-screen button).
  private autoPassReactions = false;

  /** Whether this fight can be walked away from, and by which border it was. */
  private fleeAllowed = false;
  private fledEdge: FleeEdge | null = null;
  /** The last edge a party member slipped over while the others fought on. */
  private withdrawnEdge: FleeEdge | null = null;
  /** Set when the overworld started this fight; drives the hand-back. */
  private explorationCombat: ExplorationCombat | null = null;
  /** Creature kinds the party felled in this exploration fight, for bounties. */
  private explorationKills: string[] = [];
  private explorationWon = false;
  /** The dungeon an exploration fight dives into: fights follow one another until the party walks out. */
  private dungeon: DungeonId | null = null;
  private dungeonDeepest = 0;
  private dungeonRetreating = false;
  private dungeonRetreatCursor = 0;
  /** Pickaxes carried in as items; any that break are taken from the bag on the way out. */
  private dungeonPickaxes = 0;
  private autoPassButton?: CabinetChip;
  // When on (offline only), every seat is played by the AI so the match runs
  // itself and the player can just watch. Toggled via key [Y] or the button.
  private spectateAll = false;
  private spectateButton?: CabinetChip;
  private combatSpeed = 1;
  private spellVfx!: SpellVfx;
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
    preloadCreatureSprites(this);
    preloadBossSheets(this);
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
    this.showLoadingScreen();
  }

  /**
   * The preload queue is hundreds of individual frames, so without this the
   * first load is a blank canvas for an unknown length of time.
   */
  private showLoadingScreen(): void {
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;
    const barW = 320;
    const barH = 10;
    const root = this.add.container(0, 0).setDepth(1000);
    const backdrop = this.add.graphics();
    backdrop.fillStyle(MENU_COLOR.pitch, 1).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    const title = this.add
      .text(cx, cy - 54, 'PVP DIMIR', {
        fontFamily: MENU_FONT.display,
        fontSize: '30px',
        color: MENU_HEX.bone,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const note = this.add
      .text(cx, cy + 34, 'Loading\u2026', {
        fontFamily: MENU_FONT.control,
        fontSize: '12px',
        color: MENU_HEX.boneDim,
      })
      .setOrigin(0.5);
    const bar = this.add.graphics();
    const draw = (progress: number): void => {
      bar.clear();
      bar.fillStyle(MENU_COLOR.charcoalRaised, 1).fillRect(cx - barW / 2, cy, barW, barH);
      bar.fillStyle(MENU_COLOR.brass, 1).fillRect(cx - barW / 2, cy, barW * progress, barH);
      bar.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(cx - barW / 2 - 0.5, cy - 0.5, barW + 1, barH + 1);
    };
    draw(0);
    root.add([backdrop, title, bar, note]);

    this.load.on(Phaser.Loader.Events.PROGRESS, (progress: number) => {
      draw(progress);
      note.setText(`Loading\u2026 ${Math.round(progress * 100)}%`);
    });
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.load.off(Phaser.Loader.Events.PROGRESS);
      if (this.reducedMotion) {
        root.destroy();
        return;
      }
      this.tweens.add({
        targets: root,
        alpha: 0,
        duration: 260,
        ease: 'Quad.Out',
        onComplete: () => root.destroy(),
      });
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
    this.moveGhost?.destroy();
    this.moveGhost = undefined;
    this.arrowStruck = null;
    this.fleeAllowed = false;
    this.fledEdge = null;
    this.withdrawnEdge = null;
    this.explorationKills = [];
    this.explorationWon = false;
    this.dungeon = null;
    this.dungeonDeepest = 0;
    this.dungeonRetreating = false;
    this.dungeonRetreatCursor = 0;
    this.dungeonPickaxes = 0;
    this.mineCrushed = false;
    this.mineVoteRound = 0;
    this.mineInventoryOpen = false;
    this.mineRevealNext = null;
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
    this.subtargetDirections = null;
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
    this.pinnedPanel = undefined;
    this.pinnedSignature = '';
    this.pauseView = undefined;
    this.swamprunHudText = undefined;
    this.vignette = undefined;
    this.pauseReturn = 'idle';
    this.targetListPage = 0;
    this.trainPanel = undefined;
    this.trainTitle = undefined;
    this.trainWidgets = [];
    this.tutorialView?.destroy();
    this.tutorialView = undefined;
    this.devResourceEditor?.dispose();
    this.workshopFocus.clear();
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
    this.xpEnemies.clear();
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
    // Keep spell availability in sync with the item-set toggle; an Adventure casts from every catalogue.
    setActiveSpellSets(config.exploration ? ADVENTURE_SPELL_SETS : config.itemSets ?? { original: true });

    // "Online" means a live relay connection is present. This is decoupled from
    // the game mode so co-op modes (swamprun) can also be networked.
    this.online = !!config.net;
    this.net = config.net ?? null;
    // Every peer of this fight shares its seed: it names the fight's messages.
    this.net?.setLockstep(config.seed ?? null);
    // Online the fight-changing cheats are shared and last one fight: any left on
    // from an offline game would make this screen play a different fight.
    if (this.online) {
      resetSharedToggles();
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, resetSharedToggles);
    }
    this.localTeam = config.localTeam ?? 1;
    this.localSeat = config.localSeat ?? this.localTeam - 1;
    this.opponentLeft = false;
    this.turnStarting = false;
    this.training = config.mode === 'training';
    this.tutorial = config.mode === 'tutorial';
    this.scenarioLab = config.mode === 'scenario';
    this.memoryMode = config.mode === 'memory';
    this.memoryName = config.scenario?.name ?? '';
    this.explorationCombat = config.exploration ?? null;
    this.dungeon = this.explorationCombat?.dungeon ?? null;
    // The Mines are the Mine Run's maze, whichever way the party came in.
    this.mineRun = config.mode === 'minerun' || this.dungeon === 'mines';
    this.raid = config.mode === 'raid';
    // Nobody runs from a bloodmoon boss, and the Mines' rooms have no edge to run over.
    this.fleeAllowed = !!this.explorationCombat && !this.explorationCombat.boss && !this.mineRun;
    this.raidBoss = config.raidBoss ?? 'deathknightSpear';
    this.raidTarget = undefined;
    this.raidVictory = false;
    this.raidPrepActive = this.raid;
    this.swamprun =
      config.mode === 'swamprun' || this.mineRun || this.raid || !!this.explorationCombat;
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
              : this.tutorial
                ? 'Training Dummy'
                : this.training
                  ? 'Enemy'
                  : config.mode === 'ai'
                    ? 'AI'
                    : 'Player 2',
            isAI: config.mode === 'ai' || this.training || this.tutorial,
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
    // An exploration party arrives the same way, carried in by the run with its summons; the fallen stay behind.
    const run = this.explorationCombat?.run;
    const scenario = config.scenario ?? (run ? withSummons(fightingParty(run.party), run.summons ?? null) : null);
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

    if (this.explorationCombat) {
      for (const mage of mages) mage.startStormDay(this.explorationCombat.run.day);
    }

    this.gs = new GameState(mages, config.seed);
    this.combatFeedback = new CombatFeedbackLayer(this, () => this.reducedMotion);
    this.spellVfx = new SpellVfx(this, () => this.reducedMotion, () => this.combatSpeed);
    if (this.raid && this.raidBoss === 'reaper' && !canSpawnReaper(this.swamprunPartySize())) {
      this.raidBoss = 'lich';
      this.gs.log('The Reaper needs at least two players. The Lich replaces it in a solo raid.');
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
      this.impactFx?.killBlow();
      playSound('unit.death');
      if (this.raid && (this.raidBoss === 'crusade'
        ? target.team === 2 && isCrusadeFighter(target) && !this.gs.mages.some((m) => m.alive && m.team === 2 && isCrusadeFighter(m))
        : target === this.raidTarget)) {
        this.raidVictory = true;
        for (const enemy of this.gs.mages) {
          if (enemy.team !== 2 || enemy === target) continue;
          enemy.hp = 0;
          enemy.sanity = 0;
        }
        this.gs.coopSurvivalTeam = null;
        this.gs.log(`${target.name} falls. The raid is won.`);
      }
      if (target.enemyKind === 'crusadeHelper') return;
      if (
        !this.explorationCombat ||
        target.team === 1 ||
        !this.swamprunWaveEnemies.includes(target) ||
        this.swamprunWispCopies.has(target) ||
        this.xpEnemies.has(target)
      ) return;
      this.xpEnemies.add(target);
      if (target.enemyKind) this.explorationKills.push(target.enemyKind);
      // A bloodmoon fight pays in a whole level when it is won, never per kill.
      const xp = this.explorationCombat.boss ? 0 : killXp(target.enemyKind);
      if (xp > 0) {
        this.addRunXp(xp);
        this.gs.log(`${target.name} defeated. +${xp} XP.`);
      }
      this.updateWaveHud();
    };
    this.gs.spawnMineCreature = (kind, level, at) => this.spawnMineEnemy({ kind, level }, at);
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
        this.spellVfx.blink(from, to, color);
      },
      slash: (at, angle, size) => {
        playSound('melee.slash');
        void this.spellVfx.slash('fx-slash-arc', at, angle, size);
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
      mindLightningBolt: async (caster, target) => {
        await this.playPendingDice();
        playSound('spell.lightning');
        const from = {
          x: Phaser.Math.Between(Math.ceil(FIELD.x + 12), Math.floor(FIELD.x + FIELD.w - 12)),
          y: FIELD.y - 12,
        };
        return this.lightningFx?.mindBolt(from, caster, target, 0x4aa8ff) ?? Promise.resolve();
      },
      pause: (durationMs) => this.delay(durationMs),
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
        return this.spellVfx.boomerang(from, to, color, size, speed);
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
      shatterBurst: (at, size, from) => {
        // The sheet is a cone: without a heading it always sprays the same way.
        void this.spellVfx.spriteAt('fx-shatter', at, { lengthPx: size, from, aim: from != null });
      },
      wedge: (apex, angle, halfAngle, range) => {
        this.spellVfx.wedge(apex, angle, halfAngle, range);
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
        this.spellVfx.quarterTurn(clockwise);
      },
      boom: () => this.pendingSounds.push('spell.explode'),
      thunder: () => playSound('spell.thunder'),
      twistRune: (pivot, radius, clockwise) => {
        playSound('spell.cast');
        this.spellVfx.twistRune(pivot, radius, clockwise);
      },
      godFx: (kind, at, opts) => {
        playSound(GOD_FX_SOUNDS[kind]);
        this.impactFx?.godFx(kind, at, opts);
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
      requestReroll: async (source, opts) => {
        await this.playPendingDice();
        return this.requestStormReroll(source, opts);
      },
      requestOffering: async (source, opts) => {
        await this.playPendingDice();
        return this.requestShikigamiOffering(source, opts);
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
      if (this.adventureOnline()) {
        // The session owns the connection; it outlives the fight.
        this.net.onPeerBye = () => this.onOpponentLeft();
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
          if (!this.net) return;
          this.net.onPeerBye = undefined;
          this.net.onClose = undefined;
          // Receives this fight left waiting must not take the next fight's messages.
          this.net.setLockstep(null);
        });
      } else {
        // Tear the socket down if the player navigates away from the duel.
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.net?.close());
      }
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
        `Scenario loaded: "${this.memoryName}" (round ${this.gs.round}, ${this.gs.mages.length} units).`
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
    if (this.tutorial) {
      this.setupTutorial();
      this.gs.startRound();
      this.startTurn();
      return;
    }
    if (this.swamprun) {
      if (this.explorationCombat) {
        if (this.dungeon) {
          await this.setupDungeon(this.explorationCombat);
          return;
        }
        this.setupExplorationCombat(this.explorationCombat);
        if (this.explorationCombat.boss) await this.playBloodmoonIntro(this.explorationCombat.boss);
        const opening = this.explorationCombat.opening;
        if (opening && (await this.runOpeningStrike(opening))) return;
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
        this.gs.log('Quick start: all stats are 4, no starting gear.');
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

  // ===========================================================================
  //  GUIDED TUTORIAL
  // ===========================================================================

  /**
   * The scripted teaching fight: one player against an inert, unkillable dummy,
   * with a fixed build so every prompt can name real words. The overlay in
   * `TutorialView` drives the script; everything here is the world it acts on.
   */
  private setupTutorial(): void {
    const me = this.mageByTeam(1);
    const dummy = this.mageByTeam(2);
    for (const m of this.gs.mages) {
      m.assignFlatStats(5);
      m.resetDodges();
      m.resetCombatReactions();
    }
    // A teaching fight must not be winnable or losable by accident.
    this.gs.victorySuspended = true;
    me.unkillable = true;
    dummy.unkillable = true;
    dummy.trainingPassive = true;
    dummy.maxHp = 400;
    dummy.hp = 400;
    // Start them one move apart, high in the field: the duel spawns are three or
    // four moves wide, and the lower band belongs to the tutorial textbox.
    const midY = FIELD.y + 96;
    this.playerSpawn = { x: FIELD.x + FIELD.w / 2 - 150, y: midY };
    this.enemySpawn = { x: FIELD.x + FIELD.w / 2 + 150, y: midY };
    this.spawns = [{ ...this.playerSpawn }, { ...this.enemySpawn }];
    me.x = this.playerSpawn.x;
    me.y = this.playerSpawn.y;
    dummy.x = this.enemySpawn.x;
    dummy.y = this.enemySpawn.y;
    if (me.hands.length === 0) me.hands.push('silverShortsword');
    // Reactions are a chapter of their own; until then every window auto-passes
    // so the player is not prompted on turn boundaries they cannot use yet.
    this.autoPassReactions = true;
    this.gs.log('Tutorial: you cannot die here.');
    this.tutorialView = new TutorialView(
      this,
      TUTORIAL_STEPS,
      {
        resolveFocus: (focus) => this.resolveTutorialFocus(focus),
        currentCombo: () => this.selectedWords(),
        stage: (stage) => this.applyTutorialStage(stage),
        finish: () => this.finishTutorial(),
      },
      this.reducedMotion
    );
  }

  /** Feed a player action to the tutorial script, if one is running. */
  private tutorialNotify(event: TutorialEvent): void {
    this.tutorialView?.notify(event);
  }

  /**
   * How much of the tutorial may show. A full-screen chooser owns the screen and
   * its own arrows, so the script hides rather than covering the very options it
   * just described; the inventory keeps a slim reminder instead.
   */
  private tutorialDisplay(): TutorialDisplay {
    switch (this.mode) {
      case 'inventory':
        return 'compact';
      case 'action-menu':
      case 'pause':
      case 'assign':
      case 'shop':
      case 'eldritch-menu':
      case 'thunder-menu':
      case 'dodge-bonus':
      case 'pickup-menu':
      case 'dev-resources':
      case 'training':
      case 'scenario-lab':
      case 'scenario-place':
      case 'scenario-move':
      case 'over':
        return 'hidden';
      default:
        return 'full';
    }
  }

  /** Where a scripted step's arrow should point right now. */
  private resolveTutorialFocus(focus: TutorialFocus): Rect | null {
    const body = (m: Mage | undefined): Rect | null =>
      m && m.alive ? { x: m.pos.x - 30, y: m.pos.y - 34, w: 60, h: 68 } : null;
    switch (focus) {
      case 'actions': return TOP_ACTIONS;
      case 'toggles': return TOP_TOGGLES;
      case 'menu': return TOP_MENU;
      case 'vitals': return DOCK_VITALS;
      case 'log': return DOCK_LOG;
      case 'hint': return HINT_BAR;
      case 'words': {
        const first = wordSlot(0);
        const last = wordSlot(WORD_COLS * WORD_ROWS - 1);
        return { x: first.x, y: first.y, w: right(last) - first.x, h: bottom(last) - first.y };
      }
      case 'readout': return spellReadout();
      case 'stack': {
        if (this.stackTokens.length === 0) return null;
        const xs = this.stackTokens.map((t) => t.x);
        const r = this.stackTokens[0].r;
        return {
          x: Math.min(...xs) - r,
          y: this.stackTokens[0].y - r,
          w: Math.max(...xs) - Math.min(...xs) + r * 2,
          h: r * 2,
        };
      }
      case 'player': return body(this.gs.mages.find((m) => m.team === 1 && !m.isSummon));
      case 'enemy': return body(this.gs.mages.find((m) => m.team === 2 && !m.isSummon));
      case 'summon': return body(this.gs.mages.find((m) => m.isSummon));
      default: return null;
    }
  }

  /** Change the world the way the step that just opened asked for. */
  private applyTutorialStage(stage: TutorialStage): void {
    const me = this.mageByTeam(1);
    const dummy = this.mageByTeam(2);
    switch (stage) {
      case 'refresh-actions':
        // Each lesson costs an action, and the script teaches End Turn only after
        // the first move, so a step that needs one simply hands it back.
        me.actions = { move: 1, main: 1, bonus: 1 };
        me.hasCastThisTurn = false;
        this.redraw();
        break;
      case 'arm-enemy':
        // Still unkillable, but it now takes its turn so a reaction window opens.
        dummy.trainingPassive = false;
        this.autoPassReactions = false;
        this.refreshAutoPassButton();
        this.gs.log('The dummy will attack on its turn.');
        break;
      case 'calm-enemy':
        // Auto-pass again: the AI turn may still have actions left, and every one
        // of them would otherwise prompt the player mid-lesson.
        dummy.trainingPassive = true;
        this.autoPassReactions = true;
        this.refreshAutoPassButton();
        break;
      case 'afflict-player': {
        addOrExtendStatus(
          me.statuses,
          {
            kind: 'dot',
            key: 'tutorial-bleed',
            name: 'Practice Wound',
            duration: 6,
            damage: { amount: 0, type: 'slashing' },
            damageSpec: '1d3',
          },
          false
        );
        if (!me.utility.includes('healthPotion')) me.utility.push('healthPotion');
        this.redraw();
        break;
      }
      case 'give-summon': {
        if (this.gs.summonsOf(me).length === 0) {
          const ghost = makeGhostSummon({
            ownerInt: me.effectiveInt(),
            dcRoll: 12,
            ownerName: me.name,
            pos: { x: me.pos.x - 70, y: me.pos.y + 40 },
            team: me.team,
          });
          this.gs.spawnSummon(ghost, me, 'ghost');
          this.syncMageSprites();
          this.redraw();
        }
        break;
      }
      case 'finish':
        break;
    }
  }

  /** The script ran out (or was skipped): raise the card that leaves the fight. */
  private finishTutorial(): void {
    if (this.gameEnded) return;
    this.gameEnded = true;
    this.mode = 'over';
    this.busy = false;
    this.showEndCard({
      eyebrow: 'TUTORIAL',
      title: 'COMPLETE',
      detail: '',
      actionLabel: 'RETURN TO MAIN MENU',
      tone: 'victory',
      onActivate: () => this.returnToMenu(),
    });
    this.redraw();
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
    this.gs.log('Scenario Lab — [P] opens the editor. Victory checks are off.');
  }

  /** Re-apply creature tints/scales after a roster arrives without spawn calls. */
  private restyleCreatureSprites(): void {
    this.syncMageSprites();
    for (const m of this.gs.mages) {
      if (m.mine) this.styleMineEnemySprite(m);
      else if (m.bossArt) this.styleBossSprite(m);
      else if (m.enemyKind && m.enemyKind in ENEMY_DEFS) {
        this.styleEnemySprite(m, m.enemyKind as EnemyKind);
      }
    }
  }

  // ===========================================================================
  //  SWAMPRUN  (endless PvE survival)
  // ===========================================================================

  /**
   * One fight off the overworld. Enemy strength comes from how deep into the
   * region the road is, never from how strong the traveller has become.
   */
  private setupExplorationCombat(combat: ExplorationCombat): void {
    this.prepareExplorationParty(combat);
    if (combat.boss) {
      this.spawnBloodmoonBoss(combat.boss);
      this.gs.log(`— Bloodmoon: ${BOSSES[combat.boss.id].name} attacks. No fleeing. —`);
      const rushing = this.gs.extraTurnQueue.splice(0);
      this.gs.startNewCombat({ preserveScarabs: true });
      if (rushing.length) this.actFirst(rushing);
      this.updateWaveHud();
      this.redraw();
      return;
    }
    if (combat.scene) {
      this.spawnScene(combat.scene, combat.label);
      this.gs.startNewCombat({ preserveScarabs: true });
      this.updateWaveHud();
      this.redraw();
      return;
    }
    const kind = combat.encounter === 'robbery' ? 'robbery' : 'monsters';
    const zone = combat.zone ?? 'capitol';
    const rolled = combat.spawns?.length
      ? combat.spawns
      : rollEncounter(zone, kind, this.swamprunWave, this.gs.rng);
    const fighters = this.gs.mages.filter((m) => m.team === 1 && !m.isSummon).length;
    const spawns = [...rolled, ...rollReinforcements(zone, kind, this.swamprunWave, this.gs.rng, partyScale(fighters) - 1)];
    this.gs.log(
      combat.encounter === 'robbery'
        ? `— Ambush! ${spawns.length} bandit${spawns.length === 1 ? '' : 's'} act first. —`
        : `— ${combat.label ?? `${spawns.length} foe${spawns.length === 1 ? '' : 's'}.`} —`
    );
    for (const spawn of spawns) {
      if (spawn.family === 'swamp') this.spawnEnemy(spawn.kind);
      else this.spawnMineEnemy(spawn.spec);
    }
    this.gs.startNewCombat({ preserveScarabs: true });
    // An ambush means exactly that: the road takes its turn before you take yours.
    if (combat.encounter === 'robbery') this.giveAmbushersFirstTurn();
    this.updateWaveHud();
    this.redraw();
  }

  /**
   * The bloodmoon's boss and whoever comes with it, scaled to the party that faces
   * it: +75% health per extra fighter, and +30% damage unless the band grows instead.
   * Unwritten bosses are a zombie in the boss's shape. Returns the leader.
   */
  private spawnBloodmoonBoss(fight: BossFight): Mage {
    const def = BOSSES[fight.id];
    if (hasBossSprites(fight.id)) ensureBossSprites(this, fight.id);
    const fighters = this.gs.mages.filter((m) => m.team === 1 && !m.isSummon).length;
    const scale = bossScaling(fighters, fight.id);
    this.bossPlayers = fighters;
    this.bossScale = { health: scale.health, damage: bossDamageScales(fight.id) ? scale.damage : 1 };
    const roster = bossRoster(fight.id, fighters, this.gs.rng);
    let leader: Mage | undefined;
    for (const unit of roster) {
      const charges = denialStartCharges(unit.count);
      for (let index = 0; index < unit.count; index++) {
        const artifact = unit.kind === 'denialArtifact';
        const drake = unit.kind === 'baralDrake';
        const at = artifact && leader ? this.spotNear(leader, DENIAL_SPAWN_RADIUS_UNITS * RANGE_UNIT)
          : drake && leader ? this.spotNear(leader, 3 * RANGE_UNIT)
          : bossSpawnPoint(unit, index);
        const m = this.spawnBossUnit(unit.kind, unit.art, at);
        if (unit.kind === BOSS_STAND_IN) m.name = def.name;
        m.isBoss = !!unit.leader;
        if (unit.kind === 'baral') m.baral = { turns: 0, wounded: false, hpMark: Math.round(BARAL_HP_MARK * scale.health) };
        if (artifact) {
          const threshold = denialThreshold(fighters);
          m.denial = { charges: Math.min(threshold, charges[index]), threshold };
        }
        if (drake) {
          m.drakeTurns = DRAKE_LIFESPAN;
          this.gs.grantExtraTurn(m);
        }
        if (unit.leader) leader = m;
      }
    }
    // Lillith begins her first phase before anyone moves.
    if (leader?.enemyKind === 'lillith') openLillith(this.gs, leader, fighters);
    if (fighters > 1) {
      const damage = this.bossScale.damage;
      this.gs.log(`${def.name}: ${fighters} fighters, health x${scale.health}${damage !== 1 ? `, damage x${damage}` : ''}.`);
    }
    return leader!;
  }

  /** How many fighters the bloodmoon boss was scaled for, and by how much: whatever it builds mid-fight is scaled the same. */
  private bossPlayers = 1;
  private bossScale = { health: 1, damage: 1 };

  /** A handcrafted scene: everyone where the scene put them, on their own side, among its props. */
  private spawnScene(fight: SceneFight, label: string | undefined): void {
    const fighters = this.gs.mages.filter((m) => m.team === 1 && !m.isSummon).length;
    this.gs.log(`— ${label ?? 'Enemies ahead.'} —`);
    for (const unit of sceneRoster(fight, fighters)) {
      this.spawnSceneUnit(unit, { x: FIELD.x + FIELD.w * unit.x, y: FIELD.y + FIELD.h * unit.y });
    }
    drawSceneProps(this, FIELD, fight.props, this.reducedMotion);
    if (this.gs.mages.some((m) => m.team === 3)) this.gs.log('Two enemy sides: both attack you and each other.');
    const escort = this.gs.mages.filter((m) => m.sceneSide === 'escort');
    if (escort.length) this.gs.log(`${escort.map((m) => m.name).join(' and ')} fights on your side.`);
  }

  private spawnSceneUnit(unit: SceneUnit, at: Vec2): Mage {
    const team = SCENE_TEAM[unit.side];
    let m: Mage;
    if (unit.kind === 'dwarf-guard' || unit.kind === 'villager') {
      m = this.makeScenePerson(unit.kind, team, at);
    } else {
      m = new Mage({ name: 'Enemy', isAI: true, team, position: at, loadout: [] });
      if (isMineEnemyKind(unit.kind)) {
        const sentinel = unit.kind === 'sentinel' || unit.kind === 'magma-sentinel';
        const spec: MineSpawnSpec = { kind: unit.kind, level: mineEnemyLevel(this.swamprunWave), ...(sentinel ? { role: 'tank' as const } : {}) };
        applyMineEnemyTraits(m, spec, this.gs.rng);
        const weapon = rollMineEnemyWeapon(unit.kind, spec.level, this.gs.rng);
        if (weapon) {
          this.gs.grantItem(m, weapon);
          m.equipHand(weapon);
        }
      } else {
        applyEnemyTraits(m, unit.kind, this.gs.rng);
      }
    }
    m.team = team;
    if (unit.side !== 'foe') m.sceneSide = unit.side;
    if (unit.name) m.name = unit.name;
    if (unit.hp != null) m.hp = Math.max(1, Math.round(m.maxHp * unit.hp));
    if (unit.tied) m.intrinsicMoveUnits = 0;
    if (unit.side === 'prey') m.cannotAttack = true;
    m.resetDodges();
    m.resetCombatReactions();
    this.gs.addMage(m);
    this.gs.notifyMageRelocation(m, at, at, false);
    this.ais.set(m, new SimpleAI(this.gs, m));
    if (unit.side === 'foe' || unit.side === 'rival') this.swamprunWaveEnemies.push(m);
    this.syncMageSprites();
    if (m.bossArt) this.styleBossSprite(m);
    else if (m.mine) this.styleMineEnemySprite(m);
    else if (m.enemyKind && m.enemyKind in ENEMY_DEFS) this.styleEnemySprite(m, m.enemyKind as EnemyKind);
    return m;
  }

  /** A dwarven guard who fights like the Lodge's hired dwarf, or a villager who only runs. */
  private makeScenePerson(kind: ScenePerson, team: number, at: Vec2): Mage {
    const m = new Mage({ name: kind === 'dwarf-guard' ? 'Dwarven Guard' : 'Villager', isAI: true, team, position: at, loadout: [] });
    if (kind === 'dwarf-guard') {
      m.companion = 'dwarf';
      m.assignFlatStats(3);
      m.statStrength = 7;
      m.statDex = 2;
      m.statInt = 1;
      m.maxHp += 4;
      m.hands = ['warHammer'];
      m.head = 'ironCap';
      m.gloves = 'fightersGloves';
    } else {
      m.assignFlatStats(2);
      m.maxHp = 12;
    }
    m.hp = m.maxHp;
    return m;
  }

  /** One of a bloodmoon boss's units takes the field, scaled to the party. */
  private spawnBossUnit(kind: EnemyKind, art: string, at: Vec2): Mage {
    const authored = hasBossSprites(art);
    if (authored) ensureBossSprites(this, art);
    const m = new Mage({ name: ENEMY_DEFS[kind].name, isAI: true, team: 2, position: at, loadout: [] });
    applyEnemyTraits(m, kind, this.gs.rng);
    if (authored) m.bossArt = art;
    m.maxHp = kind === 'crusadeHelper' ? crusadeHelperHealth(this.bossPlayers)
      : isCrusadeKind(kind) ? m.maxHp : Math.max(1, Math.round(m.maxHp * this.bossScale.health));
    m.hp = m.maxHp;
    m.damageScale = this.bossScale.damage;
    m.resetDodges();
    m.resetCombatReactions();
    this.gs.addMage(m);
    this.gs.notifyMageRelocation(m, at, at, false);
    this.ais.set(m, new SimpleAI(this.gs, m));
    this.swamprunWaveEnemies.push(m);
    this.syncMageSprites();
    if (m.bossArt) this.styleBossSprite(m);
    else this.styleEnemySprite(m, kind);
    return m;
  }

  /** A random spot within `radius` of `center`, on the field and clear of every body where one can be found. */
  private spotNear(center: Mage, radius: number): Vec2 {
    const rng = this.gs.rng;
    const clampX = (x: number): number => Math.min(FIELD.x + FIELD.w - 24, Math.max(FIELD.x + 24, x));
    const clampY = (y: number): number => Math.min(FIELD.y + FIELD.h - 24, Math.max(FIELD.y + 24, y));
    let spot: Vec2 = { x: clampX(center.x), y: clampY(center.y) };
    for (let tries = 0; tries < 24; tries++) {
      const a = rng.float() * Math.PI * 2;
      const r = Math.sqrt(rng.float()) * radius;
      spot = { x: clampX(center.x + Math.cos(a) * r), y: clampY(center.y + Math.sin(a) * r) };
      if (this.gs.mages.every((m) => !m.alive || dist(m.pos, spot) >= m.bodyRadius() + MAGE_RADIUS * 2)) break;
    }
    return spot;
  }

  /** Baral builds `count` drakes beside him; each acts at once and lasts three of its own turns. */
  private async raiseDrakes(baral: Mage, count: number): Promise<void> {
    const puffs: Promise<void>[] = [];
    for (let i = 0; i < count; i++) {
      const at = this.spotNear(baral, 3 * RANGE_UNIT);
      const drake = this.spawnBossUnit('baralDrake', 'baral-drake', at);
      drake.drakeTurns = DRAKE_LIFESPAN;
      this.gs.grantExtraTurn(drake);
      puffs.push(this.spellVfx.summonPuff(at, MAGE_RADIUS * 2.4));
    }
    this.gs.log(`${baral.name} builds ${count === 1 ? 'a drake' : `${count} drakes`}.`);
    await Promise.all(puffs);
  }

  /** Drakes Baral called up in the middle of an action (his first wound) join now. */
  private async raisePendingDrakes(): Promise<void> {
    const queued = this.gs.pendingDrakes.splice(0);
    for (const { baral, count } of queued) {
      if (baral.alive && !this.gs.isOver) await this.raiseDrakes(baral, count);
    }
    if (queued.length) this.redraw();
  }

  /** The end of Baral's turn: every second one another Artifact of Denial, the others drakes. */
  private async maybeBaralEndStep(): Promise<void> {
    const baral = this.gs.current;
    if (this.gs.isOver || !baral.alive || !baral.baral) return;
    const plan = this.gs.baralEndStep(baral);
    for (let i = 0; i < plan.artifacts; i++) {
      const at = this.spotNear(baral, DENIAL_SPAWN_RADIUS_UNITS * RANGE_UNIT);
      const artifact = this.spawnBossUnit('denialArtifact', 'denial-artifact', at);
      artifact.denial = { charges: 0, threshold: denialThreshold(this.bossPlayers) };
      this.gs.log(`${baral.name} sets down another Artifact of Denial.`);
      await this.spellVfx.summonPuff(at, MAGE_RADIUS * 2.4);
    }
    if (plan.drakes > 0) await this.raiseDrakes(baral, plan.drakes);
    this.redraw();
    await this.delay(250);
  }

  /** Lillith's turn begins: her phase moves on, and whatever it brings takes the field. */
  private async resolveLillithTurn(boss: Mage): Promise<void> {
    const plan = lillithTurnStart(this.gs, boss);
    void this.flushHits();
    if (plan.banner) await this.playBossCast(boss);
    const puffs: Promise<void>[] = [];
    if (plan.blinkTo) {
      puffs.push(this.spellVfx.summonPuff(boss.pos, MAGE_RADIUS * 2.4));
      const from = boss.pos;
      boss.x = plan.blinkTo.x;
      boss.y = plan.blinkTo.y;
      this.gs.notifyMageRelocation(boss, from, boss.pos, false);
      puffs.push(this.spellVfx.summonPuff(boss.pos, MAGE_RADIUS * 2.4));
    }
    for (const at of plan.copies) {
      makeLillithCopy(this.gs, boss, this.spawnBossUnit('lillithCopy', 'lillith', at));
      puffs.push(this.spellVfx.summonPuff(at, MAGE_RADIUS * 2.4));
    }
    for (const rising of plan.risings) {
      this.spawnEnemy(rising.kind, rising.at);
      puffs.push(this.spellVfx.summonPuff(rising.at, MAGE_RADIUS * 2.4));
    }
    for (const at of plan.orbs) {
      const orb = this.spawnBossUnit('lillithOrb', 'lillith-orb', at);
      orb.maxHp = orb.hp = LILLITH_ORB_HP;
      puffs.push(this.spellVfx.summonPuff(at, MAGE_RADIUS * 2));
    }
    lillithAfterSpawns(this.gs, boss);
    void this.flushHits();
    this.syncMageSprites();
    this.redraw();
    if (plan.banner) this.flashHint(plan.banner, false, 'info');
    await Promise.all(puffs);
    await this.delay(300);
  }

  /** A boss with a spell of its own chants it; resolves as the spell takes effect. */
  private async playBossCast(m: Mage): Promise<void> {
    const rec = this.mageAnims.get(m);
    const cast = m.bossArt ? bossCast(m.bossArt) : null;
    if (!rec || !cast || !m.alive || !this.anims.exists(cast.key)) return;
    rec.charging = false;
    rec.lock = 'attack';
    rec.sprite.play(cast.key, true);
    rec.sprite.once(`animationcomplete-${cast.key}`, () => {
      if (rec.lock === 'attack') rec.lock = null;
    });
    await this.delay(cast.peakMs);
  }

  /** An armed artifact says no: a crackle from it to whoever acted. */
  private async playStifle(artifact: Mage, victim: Mage): Promise<void> {
    this.startBodyAttack(artifact);
    playSound('spell.lightning');
    await this.vfxLightningBolt(artifact.pos, victim.pos, 0x7ae8ff, 1);
    void this.flushHits();
    this.redraw();
    await this.delay(260);
  }

  private styleBossSprite(m: Mage): void {
    const rec = this.mageAnims.get(m);
    if (!rec || !m.bossArt) return;
    rec.sprite.clearTint();
    rec.sprite.setScale(bossSheet(m.bossArt).pixel);
  }

  /** Vs. the boss: the party on one side, the boss on the other, before anyone moves. */
  private async playBloodmoonIntro(fight: BossFight): Promise<void> {
    const leader = this.gs.mages.find((m) => m.team === 2 && m.isBoss);
    const leaderRec = leader ? this.mageAnims.get(leader) : undefined;
    const painted = hasBossSprites(fight.id);
    const mageFrame = this.textures.getFrame('mage-idle-0');
    const mageSheet = { frameW: mageFrame.width, frameH: mageFrame.height, originY: 1, pixel: 1 };
    const party = this.gs.mages
      .filter((m) => m.team === 1 && !m.isSummon && m.alive)
      .map((m) => ({ mage: m, rec: this.mageAnims.get(m) }))
      .filter((entry): entry is { mage: Mage; rec: MageAnim } => !!entry.rec);
    const fighters = party.length;
    const scale = bossScaling(fighters, fight.id);
    const band = fight.id === 'crusade'
      ? (['crusadeSoldier', 'crusadePriest', 'crusadeHelper', 'crusadeCamp', 'crusadeBallista'] as const).map((kind) => ({
        kind, art: kind, count: this.gs.mages.filter((m) => m.team === 2 && m.enemyKind === kind).length,
      }))
      : bossRoster(fight.id, fighters);
    this.mode = 'busy';
    await playBossIntro(this, {
      boss: BOSSES[fight.id],
      cycle: fight.cycle,
      bossAnim: painted ? bossAnimKey(fight.id, 'idle') : 'mage-idle',
      bossTexture: painted ? undefined : 'mage-idle-0',
      bossTint: !painted && leaderRec?.sprite.isTinted ? leaderRec.sprite.tintTopLeft : undefined,
      bossRoar: painted ? bossAnimKey(fight.id, 'attack') : 'mage-attack',
      bossSheet: painted ? bossSheet(fight.id) : mageSheet,
      arenaBoss: leaderRec
        ? leader?.bossArt
          ? { sprite: leaderRec.sprite, roar: bossAnimKey(leader.bossArt, 'attack'), idle: bossAnimKey(leader.bossArt, 'idle') }
          : { sprite: leaderRec.sprite, roar: 'mage-attack', idle: 'mage-idle' }
        : undefined,
      roster: band.length > 1 ? band.map((unit) => {
        const unitDef = ENEMY_DEFS[unit.kind];
        return unit.count > 1 ? `${unit.count} ${unitDef.plural ?? `${unitDef.name}s`}` : unitDef.name;
      }).join('   ·   ') : undefined,
      party: party.map(({ mage, rec }) => ({
        name: mage.name,
        texture: rec.sprite.texture.key,
        anim: rec.sprite.anims.currentAnim?.key,
        tint: rec.sprite.isTinted ? rec.sprite.tintTopLeft : undefined,
      })),
      scaling: fighters > 1
        ? { players: fighters, health: scale.health, damage: bossDamageScales(fight.id) ? scale.damage : undefined }
        : undefined,
      reducedMotion: this.reducedMotion,
    });
  }

  /** A won overworld fight: pay out, train, then hand the run back. */
  private async finishExplorationFight(): Promise<void> {
    await this.awardWaveLoot();
    if (this.explorationCombat?.boss) {
      this.addRunXp(this.xpToNextLevel() - this.runXp);
      this.gs.log('Bloodmoon over. Claim earned levels at a long rest.');
    }
    this.explorationWon = true;
    this.endGame();
  }

  /** Carry the run's party, level and purse into the scene and line the party up. */
  private prepareExplorationParty(combat: ExplorationCombat): void {
    this.swamprunWave = Math.max(1, combat.depth);
    this.swamprunEncounterPower = 0;
    this.swamprunCurse = undefined;
    this.swamprunGold = 0;
    this.swamprunWaveEnemies = [];
    this.swamprunWispCopies.clear();
    this.xpEnemies.clear();
    this.explorationKills = [];
    this.runLevel = combat.run.level;
    this.runXp = combat.run.xp;
    this.pendingLevels = 0;
    // The party arrives carrying the positions it held when the last fight
    // ended, so line it up afresh before anything is spawned opposite it.
    const party = this.gs.mages.filter((m) => m.team === 1);
    const formation = this.computeSpawns(party.map(() => 1));
    party.forEach((mage, index) => {
      // Every fight off the map is a combat of its own: nothing per-combat carries in.
      mage.resetForNewCombat();
      mage.resetCombatReactions();
      mage.gainMana(mage.fightStartMana());
      const at = formation[index];
      if (!at) return;
      mage.x = at.x;
      mage.y = at.y;
      this.swamprunArrowsOwned.set(mage, mage.arrows);
    });
  }

  /** Into a dungeon: the Swamps and the Small Forest start at depth 1, the Mines at their entrance. */
  private async setupDungeon(combat: ExplorationCombat): Promise<void> {
    this.prepareExplorationParty(combat);
    this.dungeonDeepest = 0;
    this.dungeonRetreating = false;
    this.dungeonRetreatCursor = 0;
    if (this.mineRun) {
      await this.setupMineExploration();
      return;
    }
    this.gs.log(`— ${DUNGEONS[this.dungeon!].name}. No rest or shop inside. —`);
    this.spawnWave(1);
    this.startTurn();
  }

  /** Between the waves of a dive: training, then deeper or back the way the party came. */
  private async runDungeonInterlude(): Promise<boolean> {
    if (this.dungeonRetreating) return this.advanceDungeonRetreat();
    if ((await this.promptDungeonChoice()) === 'deeper') {
      this.spawnWave(this.swamprunWave + 1);
      return true;
    }
    this.dungeonRetreating = true;
    this.dungeonRetreatCursor = this.swamprunWave - 1;
    return this.advanceDungeonRetreat();
  }

  private async promptDungeonChoice(): Promise<'deeper' | 'back'> {
    // The host leads the dive; everyone else waits for its call.
    if (this.online && this.localSeat !== 0) {
      this.gs.log('The host decides: deeper or back.');
      this.redraw();
      for (;;) {
        const message = await this.net!.recv();
        if (message.k === 'bye') return 'back';
        if (message.k === 'dungeon-choice') return message.choice === 'deeper' ? 'deeper' : 'back';
      }
    }
    const choice = await this.askDungeonChoice();
    if (this.online) this.net?.send({ k: 'dungeon-choice', choice });
    return choice;
  }

  private askDungeonChoice(): Promise<'deeper' | 'back'> {
    const previousMode = this.mode;
    this.mode = 'shop';
    const name = DUNGEONS[this.dungeon!].name;
    const depth = this.swamprunWave;
    return new Promise<'deeper' | 'back'>((resolve) => {
      const panel = new ChoiceMenuView<'deeper' | 'back'>(this, `DEPTH ${depth} CLEARED`,
        `${name}. Turning back: ${Math.round(DUNGEON_REFIGHT * 100)}% fight chance per cleared depth.`, [
          { id: 'deeper', label: 'Go deeper', detail: `Depth ${depth + 1}` },
          { id: 'back', label: 'Turn back', detail: '' },
        ], (selected) => {
          panel.destroy();
          this.mode = previousMode;
          resolve(selected);
        });
    });
  }

  /** Walk back up through the cleared depths; now and then one has to be fought again. */
  private async advanceDungeonRetreat(): Promise<boolean> {
    while (this.dungeonRetreatCursor > 0) {
      const depth = this.dungeonRetreatCursor--;
      this.gs.log(`The way back: crossing depth ${depth}...`);
      if (this.gs.rng.chance(DUNGEON_REFIGHT)) {
        this.gs.log(`Depth ${depth} has to be fought again.`);
        this.spawnWave(depth);
        return true;
      }
    }
    await this.leaveDungeon();
    return false;
  }

  /** Out of the dungeon alive. */
  private async leaveDungeon(): Promise<void> {
    this.explorationWon = true;
    this.endGame();
  }

  /** Reorder initiative so the ambushers act before anyone they jumped. */
  private giveAmbushersFirstTurn(): void {
    const order = this.gs.mages
      .map((mage, index) => ({ mage, index }))
      .sort((a, b) => Number(a.mage.team === 1) - Number(b.mage.team === 1))
      .map((entry) => entry.index);
    this.gs.restoreTurnOrder(order, order.map(() => 0), 0);
  }

  /** Put `first` at the head of a freshly rolled initiative, in their order. */
  private actFirst(first: Mage[]): void {
    const lead = first.map((m) => this.gs.mages.indexOf(m)).filter((i) => this.gs.initiativeOrder.includes(i));
    const order = [...lead, ...this.gs.initiativeOrder.filter((i) => !lead.includes(i))];
    this.gs.restoreTurnOrder(order, this.gs.initiativeRolls, order[0]);
  }

  /**
   * The party sprang this fight from hiding: the leader lands one free blow that
   * nobody may answer, and only then is initiative rolled. Returns true when
   * that blow ended the fight.
   */
  private async runOpeningStrike(opening: ExplorationOpening): Promise<boolean> {
    const party = this.gs.mages.filter((m) => m.team === 1 && !m.isSummon && !m.sceneSide && m.alive);
    const leader = memberOf(party, opening.by) ?? party[0];
    const target = this.swamprunWaveEnemies.find((m) => m.alive);
    if (!leader || !target) return false;
    const spell = opening.kind === 'spell' ? getSpell(opening.words, leader.spellClass) : undefined;
    if (opening.kind === 'spell' && (!spell || !['enemy', 'point', 'any'].includes(spell.targeting))) {
      this.gs.log('Ambush failed: no usable spell for those words.');
      return false;
    }
    // The prey stands where the blow can reach it.
    const weapon = leader.activeWeapon();
    const far = spell ? spell.range : weapon ? weapon.rangePx : leader.intrinsicMeleeReach ?? MELEE_RANGE;
    const near = spell ? spell.minRange ?? 0 : weapon?.minRangePx ?? 0;
    const reach = Math.max(near + 6, Math.min(far * 0.8, far - 6));
    const angle = Math.atan2(target.y - leader.y, target.x - leader.x) || 0;
    target.x = Math.min(FIELD.x + FIELD.w - 24, Math.max(FIELD.x + 24, leader.x + Math.cos(angle) * reach));
    target.y = Math.min(FIELD.y + FIELD.h - 24, Math.max(FIELD.y + 24, leader.y + Math.sin(angle) * reach));
    this.redraw();
    let item: StackItem | null = null;
    if (spell) {
      const atPoint = spell.targeting === 'point';
      item = this.gs.makeSpellItem(leader, spell, atPoint ? null : target, atPoint ? { x: target.x, y: target.y } : null);
    } else if (this.gs.canMelee(leader, target)) {
      item = this.gs.makeMeleeItem(leader, target);
    }
    if (!item) {
      this.gs.log('Ambush failed: the attack cannot reach.');
      return false;
    }
    item.silent = true;
    this.gs.log(`— Ambush: ${leader.name} strikes first. —`);
    await this.runStack(item);
    if (this.gameEnded || this.gs.isOver) return true;
    this.gs.rerollInitiative();
    this.gs.log('— Initiative is rolled. —');
    this.redraw();
    return false;
  }

  /** Arm the party of survivors and unleash the first wave. */
  private setupSwamprun(): void {
    this.swamprunWave = 0;
    this.swamprunEncounterPower = 0;
    this.swamprunCurse = undefined;
    this.swamprunGold = 0;
    for (const mage of this.gs.mages) mage.swamprunCurse = undefined;
    this.gs.log(
      this.mineRun
        ? 'Mine Run — survive as long as you can.'
        : this.raid
          ? `Raid — ${raidTargetName(this.raidBoss)}.`
          : 'Swamprun — survive as long as you can.'
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
    // Every peer draws this together (lockstep), only online, where votes happen.
    this.mineVoteSalt = this.online ? Math.floor(this.gs.rng.float() * 0x7fffffff) : 0;
    this.mineRemembers = this.dungeon === 'mines' && this.partyHasMineMap();
    this.mineMaze = this.dungeon === 'mines' && this.explorationCombat
      ? enterMines(this.explorationCombat.run, this.mineRemembers)
      : createMineMaze(this.gs.rng, { shops: true, layoutSeed: Math.floor(this.gs.rng.float() * 0x7fffffff) });
    this.mineExploring = true;
    this.mineInCombat = false;
    this.mineRunEnded = false;
    this.mineActiveRoomId = null;
    this.mineFromRoom = false;
    // An Exploration party mines only with the pickaxes it carries in; the Mine Run hands out one worn pickaxe.
    this.dungeonPickaxes = this.dungeon ? this.carriedPickaxes() : 0;
    this.minePickaxes = this.dungeon
      ? Array.from({ length: this.dungeonPickaxes }, () => 10)
      : [2];
    this.mineChestCursor = 0;
    this.mode = 'shop';
    const mapNote = this.dungeon !== 'mines' ? ''
      : this.mineRemembers ? ' Minemap: on.' : ' No Minemap.';
    this.gs.log(this.dungeon
      ? `The Mines. ${this.minePickaxes.length ? `Pickaxes: ${this.minePickaxes.length}.` : 'No pickaxe.'} No shops inside.${mapNote}`
      : 'Mine Run — one pickaxe (2 durability).');
    this.updateWaveHud();
    this.redraw();
    if (this.dungeon === 'mines') {
      const choice = await this.promptMineChoice('MINE ENTRANCE',
        '',
        'Anyone still inside when the next bloodmoon rises dies.', [
          { id: 'explore', label: 'Explore the mine' },
          { id: 'leave', label: 'Leave through entrance' },
        ], undefined, true);
      if (choice === 'leave') {
        await this.leaveDungeon();
        return;
      }
    }
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
      if (direction === 'leave') {
        this.hideMinePanel();
        await this.leaveDungeon();
        return;
      }
      await this.travelMineTunnel(direction);
    }
  }

  /** Walk a passage on the map and handle the arrival before asking for another route. */
  private async travelMineTunnel(direction: MineDirection): Promise<void> {
    if (!this.mineMaze || this.mineRunEnded) return;
    this.gs.log(`The party takes the ${MINE_DIRECTION_LABEL[direction].toLowerCase()} tunnel.`);
    const from = currentMineNode(this.mineMaze);
    // Tunnels run from a third of a standard tunnel to twice one, and take as long to walk.
    const hours = mineTunnelHours(this.mineMaze, from, direction);
    const view = this.showMineMap(from, false, '');
    const dice = this.dungeon === 'mines' && this.explorationCombat
      ? minePassageDice(this.explorationCombat.run, from.id, direction) : this.gs.rng;
    const result = travelMineMaze(this.mineMaze, direction, dice);
    const party = this.mineParty();
    if (result.blocked) {
      this.gs.log('Dead end. Map updated.');
      await view.walk({ from, direction, party: this.mineWalkers(party) });
      return;
    }
    if (this.spendMineTime(hours)) {
      this.hideMinePanel();
      return;
    }
    this.updateWaveHud();
    // The trap is rolled before the walk, so the walk can show how it goes.
    const trap = result.trap ? this.rollMineTrap(result.trap) : null;
    await view.walk({
      from,
      direction,
      to: result.node,
      trap: trap ? this.mineTrapShow(trap, party) : undefined,
      party: this.mineWalkers(party),
    });
    if (this.mineRunEnded || this.opponentLeft) return;
    const run = this.dungeon === 'mines' ? this.explorationCombat?.run : undefined;
    if (run) markMineKnown(run, result.node.id);
    this.mineRevealNext = result.node.id;
    if (trap) await this.applyMineTrap(trap);
    if (this.mineRunEnded || this.opponentLeft) return;
    if (
      result.node.kind === 'room' &&
      result.node.room &&
      mineRoomNeedsInteraction(result.node.room)
    ) {
      // Close in on the doorway on the map before the doorway itself is shown.
      await this.showMineMap(result.node, false, '', false).enterRoom();
      if (this.mineRunEnded || this.opponentLeft) return;
      await this.handleMineRoomArrival(result.node, result.node.room);
    }
  }

  private spendMineTime(hours: number): boolean {
    if (this.dungeon !== 'mines' || !this.explorationCombat || this.mineRunEnded) return false;
    if (!spendMineHours(this.explorationCombat.run, hours)) return false;
    this.mineCrushed = true;
    this.gs.log('The bloodmoon rises. Everyone in the mine dies.');
    for (const mage of this.gs.mages) {
      if (mage.team === 1 && !mage.isSummon) mage.hp = 0;
    }
    this.explorationCombat.run.mines = null;
    this.endGame();
    return true;
  }

  /**
   * Roll a passage's predetermined trap: who it is aimed at, whether the party's
   * light gives it away, the evasion, and the damage, from the shared dice in
   * that order. Nothing lands yet: the walk shows it first.
   */
  private rollMineTrap(spec: MineTrapDamage): MineTrapOutcome | null {
    const party = this.gs.mages.filter(
      (mage) => mage.team === 1 && mage.alive && !mage.isSummon
    );
    if (party.length === 0) return null;
    const target = this.gs.rng.pick(party);
    const hasActiveLight = party.some((mage) => mage.lightRadius() > 0);
    const { spotted, dodgeChance, dodged } = rollMineTrapAvoidance(hasActiveLight, this.gs.rng);
    const amount = dodged ? 0 : this.gs.rng.roll(spec).total;
    const { dealt, fatal, clung } = dodged
      ? { dealt: 0, fatal: false, clung: false }
      : mineTrapHarm(amount, target.hp, target.maxHp);
    return { spec, target, spotted, dodgeChance, dodged, amount, dealt, fatal, clung };
  }

  /** The trap as the walking party sees it spring. */
  private mineTrapShow(trap: MineTrapOutcome, party: readonly Mage[]): MineTrapShow {
    const index = party.indexOf(trap.target);
    return {
      kind: trap.spec,
      target: index >= 0 ? index : party.length - 1,
      who: trap.target.name,
      spotted: trap.spotted,
      dodged: trap.dodged,
      damage: trap.dealt,
      fatal: trap.fatal,
      clung: trap.clung,
    };
  }

  /** The trap the walk has shown lands: its damage (or the escape), then a word on it. */
  private async applyMineTrap(trap: MineTrapOutcome): Promise<void> {
    const { spec, target, spotted, dodgeChance, dodged, amount, dealt, fatal, clung } = trap;
    const name = MINE_TRAP_NAME[spec];
    const picture: MineVisualView = {
      artKey: mineTrapTextureKey(spec),
      iconKey: mineTrapIconTextureKey(spec),
      label: `${name}  ·  ${spec}`,
      hidden: false,
    };
    const odds = `${spotted ? 'Spotted by the light  •  ' : ''}${Math.round(dodgeChance * 100)}% evade chance`;
    if (spotted) this.gs.log(`The party's light reveals a ${name.toLowerCase()} (${spec}).`);
    if (dodged) {
      this.gs.log(`${target.name} evades the ${name.toLowerCase()} (${spec}). The trap is used up.`);
      await this.promptMineChoice(
        spotted ? 'TRAP EVADED' : 'LAST-SECOND DODGE',
        `${odds} succeeded.`,
        `${target.name} is unharmed. The trap is used up.`,
        [{ id: 'continue', label: 'Keep moving', color: '#9fe6a0' }],
        picture
      );
      return;
    }
    const hpBefore = target.hp;
    if (fatal) {
      this.gs.defeatMage(
        target,
        target,
        `${target.name} triggers a ${name.toLowerCase()} (${spec} = ${amount}) and falls.`
      );
    } else {
      target.hp -= dealt;
      this.gs.log(clung
        ? `${target.name} triggers a ${name.toLowerCase()}: ${spec} rolls ${amount}, but full health leaves them at 1 HP.`
        : `${target.name} triggers a ${name.toLowerCase()}: ${spec} rolls ${amount} damage.`);
      this.gs.vfxSink?.hit?.(target);
    }
    void this.flushHits();
    this.redraw();
    // Even a trap that ends the run is shown for what it was before the run is called.
    const over = this.gs.isOver;
    await this.promptMineChoice(
      over ? 'KILLED BY A TRAP' : clung ? 'BARELY ALIVE' : spotted ? 'TRAP' : 'TUNNEL TRAP',
      `${odds} failed  •  ${spec} rolled ${amount} damage.`,
      fatal
        ? over
          ? `${target.name} had ${hpBefore} HP left and is killed by the ${name.toLowerCase()}. The party is dead.`
          : `${target.name} had ${hpBefore} HP left and is killed by the ${name.toLowerCase()}.`
        : clung
          ? `The ${name.toLowerCase()} would have killed ${target.name}, but full health leaves them at 1 HP.`
          : `${target.name} has ${target.hp}/${target.maxHp} HP. The trap is used up.`,
      [{ id: 'continue', label: over ? 'Continue' : 'Keep moving', color: '#ffcf7a' }],
      picture
    );
    if (this.gs.isOver) this.endGame();
  }

  /**
   * At a room's doorway the dark gives away what waits inside: red eyes, a glint
   * of ore, the edge of a chest, a lamp on a counter, or nothing at all.
   */
  private async handleMineRoomArrival(node: MineMazeNode, room: MineRoomState): Promise<void> {
    // Ore glints from the doorway, so its veins are counted before anyone goes in.
    revealMineOre(room, this.gs.rng);
    const look = this.mineRoomLook(room);
    const fight = room.kind === 'enemies' && !room.resolved;
    const choices: MinePromptChoice[] = [{
      id: 'enter',
      label: fight ? 'Go in and fight' : room.entered ? 'Go back in' : 'Go in',
      tone: fight ? 'danger' : 'primary',
    }];
    if (this.mineMaze?.arrivedVia) {
      choices.push({ id: 'turn', label: 'Turn back', tone: 'normal' });
    }
    const choice = await this.promptMineChoice(
      'AT THE DOORWAY',
      this.mineStatusLine(),
      look.body,
      choices,
      { room, node: node.id, lit: room.entered, verdict: look.verdict, verdictColor: look.color },
      true
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
      const look = this.mineRoomLook(room);
      await this.promptMineChoice(
        'SEARCHED ROOM',
        this.mineStatusLine(),
        look.body,
        [{ id: 'continue', label: 'Choose a path' }],
        { room, node: node.id, lit: true, verdict: look.verdict, verdictColor: look.color }
      );
      return;
    }
    if (room.kind === 'empty') {
      room.resolved = true;
      this.gs.log('Empty room.');
      return;
    }
    if (room.kind === 'treasure') {
      await this.resolveMineTreasure(node, room);
      return;
    }
    if (room.kind === 'ore') {
      await this.resolveMineOreRoom(node, room);
      return;
    }
    await this.runMineRoomShop(node, room);
  }

  private async resolveMineTreasure(node: MineMazeNode, room: MineRoomState): Promise<void> {
    // An Exploration party finds kit in the chests, never coin.
    const gold = this.dungeon ? 0 : this.gs.rng.roll('1d6+2').total;
    this.swamprunGold += gold;
    const recipients = this.gs.mages.filter(
      (mage) => mage.team === 1 && mage.alive && !mage.isSummon
    );
    let found: ItemId | undefined;
    if (recipients.length > 0) {
      const recipient = recipients[this.mineChestCursor % recipients.length];
      this.mineChestCursor += 1;
      const rarity = rollRarity(() => this.gs.rng.float(), recipient.maxLuck, true);
      found = draftChoices(rarity, () => this.gs.rng.float(), 1, true)[0];
    }
    room.resolved = true;
    this.gs.log(`The party opens a mine chest${gold > 0 ? `: ${gold}g` : ''}.`);
    this.updateWaveHud();
    await this.collectLootScreen(found ? [found] : [], 'TREASURE CHEST', 'chest',
      found ? 'The lid opens. Something gleams inside.' : 'The chest is empty.', gold > 0 ? `+${gold}g for the party` : undefined);
  }

  /**
   * An ore room: the party picks a vein on the rock face and strikes it a d20 plus
   * the miner's Strength at a time. Any player may swing; every peer rolls the same dice.
   */
  private async resolveMineOreRoom(node: MineMazeNode, room: MineRoomState): Promise<void> {
    const ore = MINE_ORE_DEFS[room.oreKind ?? 'coal'];
    const veins: MineVein[] = Array.from(
      { length: Math.min(3, revealMineOre(room, this.gs.rng)) },
      () => ({ progress: 0, strikes: 0 })
    );
    this.minePickaxes = this.minePickaxes.filter((value) => value > 0).map((value) => Math.min(10, value));
    const pickaxes = this.minePickaxes;
    this.hideMinePanel();
    this.mode = 'shop';
    const view = new MineDepositView(this, {
      title: `${ore.name.toUpperCase()} DEPOSIT`,
      status: this.mineStatusLine(),
      spec: { content: 'ore', lit: true, resolved: false, seed: node.id },
      ore,
      veins,
      pickaxes,
      interactive: true,
      light: this.mineWalkers()[0]?.light ?? null,
    }, (choice) => this.mineChoiceResolve?.(choice));
    this.minePanel = view;
    let active = -1;
    let extracted = 0;
    let collapsed = 0;
    let struck = false;
    for (;;) {
      const { choice, seat } = await this.nextMineChoice((id) => mineDepositAllows(id, veins, active, pickaxes.length));
      if (!choice || this.mineRunEnded || this.opponentLeft) return;
      if (choice === 'leave') break;
      if (choice !== 'strike') {
        active = Number(choice.slice('vein:'.length));
        view.select(active);
        continue;
      }
      const miner = this.mineStriker(seat);
      const strike = strikeMineVein(ore, veins[active], pickaxes, this.gs.rng, miner?.effectiveStr() ?? 0);
      if (!strike) continue;
      struck = true;
      let haul: string | undefined;
      if (strike.outcome === 'extracted') {
        extracted += 1;
        const name = getItem(ore.item).name;
        const hauled = this.collectMaterials([ore.item]);
        haul = hauled.left.length
          ? `${name} extracted, but nobody can carry ${getItem(ore.item).weight} kg more. Left behind.`
          : this.explorationCombat ? `+1 ${name}` : `${hauled.text}.`;
      } else if (strike.outcome === 'collapsed') {
        collapsed += 1;
      }
      this.updateWaveHud();
      await view.playStrike({ ...strike, vein: active, haul, miner: miner?.name });
      if (this.mineRunEnded || this.opponentLeft) return;
    }
    const remaining = veins.filter((vein) => !vein.outcome).length;
    room.oreAmount = remaining;
    room.resolved = remaining === 0;
    this.hideMinePanel();
    if (!struck) return;
    this.gs.log(
      `${ore.name} mining: ${extracted} extracted, ${collapsed} collapsed, ${remaining} left. Pickaxes: ${pickaxes.join(', ') || 'none'}.`
    );
    if (this.spendMineTime(MINE_DIG_HOURS)) return;
    this.updateWaveHud();
  }

  /**
   * The next pick in a mine window that stays open between picks. Any player may
   * make it: guests hand theirs to the leader, who takes the first that is still
   * allowed and announces it with who made it, so every peer does the same seeded
   * work. Picks `allowed` refuses are ignored; '' when the run ends.
   */
  private nextMineChoice(allowed: (choice: string, seat?: number) => boolean): Promise<{ choice: string; seat: number }> {
    if (!this.online) {
      return new Promise((resolve) => {
        this.mineChoiceResolve = (choice) => {
          if (choice && !allowed(choice, this.localSeat)) return;
          this.mineChoiceResolve = null;
          resolve({ choice, seat: this.localSeat });
        };
      });
    }
    const net = this.net!;
    const round = `${this.mineVoteSalt}:${++this.mineVoteRound}`;
    if (this.localSeat !== 0) {
      this.mineChoiceResolve = (choice) => {
        if (choice && allowed(choice, this.localSeat)) net.send({ k: 'mine-pick', round, choice });
      };
      return (async () => {
        for (;;) {
          const message = await net.recv();
          if (message.k === 'bye') {
            this.mineChoiceResolve = null;
            return { choice: '', seat: 0 };
          }
          if (message.k !== 'mine-choice' || typeof message.choice !== 'string'
            || !allowed(message.choice, typeof message.seat === 'number' ? message.seat : 0)) continue;
          this.mineChoiceResolve = null;
          return { choice: message.choice, seat: typeof message.seat === 'number' ? message.seat : 0 };
        }
      })();
    }
    return new Promise((resolve) => {
      const settle = (choice: string, seat: number): void => {
        if (choice && !allowed(choice, seat)) return;
        net.setSideHandler(null);
        this.mineChoiceResolve = null;
        if (choice) net.send({ k: 'mine-choice', choice, seat });
        resolve({ choice, seat });
      };
      net.setSideHandler((message) => {
        if (message.k !== 'mine-pick' || message.round !== round) return;
        if (typeof message.from === 'number' && typeof message.choice === 'string') settle(message.choice, message.from);
      });
      this.mineChoiceResolve = (choice) => settle(choice, this.localSeat);
    });
  }

  /** Who swings the pick: the strongest standing member `seat` plays, else the strongest standing. */
  private mineStriker(seat: number): Mage | undefined {
    const party = this.mineParty();
    const strongest = (list: readonly Mage[]): Mage | undefined =>
      list.reduce<Mage | undefined>((best, mage) => !best || mage.effectiveStr() > best.effectiveStr() ? mage : best, undefined);
    const own = this.online ? party.filter((mage) => this.controllerSeatOf(mage) === seat) : party;
    return strongest(own) ?? strongest(party);
  }

  /** The small line at the top right of a mine window: steps, the clock (or the purse), pickaxes. */
  private mineStatusLine(): string {
    const parts = [`Step ${this.mineMaze?.steps ?? 0}`];
    const run = this.dungeon === 'mines' ? this.explorationCombat?.run : undefined;
    if (run) parts.push(`Day ${run.day}, ${clockTime(run.hour)}`);
    if (!this.dungeon) parts.push(`${this.swamprunGold}g`);
    parts.push(`Pickaxes: ${this.minePickaxes.length ? this.minePickaxes.join(' / ') : 'none'}`);
    return parts.join('   ·   ');
  }

  /** What a mine room shows from its doorway, in a few big words and a sentence. */
  private mineRoomLook(room: MineRoomState): { verdict: string; color: number; body: string } {
    switch (room.kind) {
      case 'enemies':
        return room.resolved
          ? { verdict: 'CLEARED', color: MINE_VERDICT.quiet, body: 'Already cleared.' }
          : {
            verdict: 'ENEMIES INSIDE',
            color: MINE_VERDICT.danger,
            body: 'Going in starts a fight.',
          };
      case 'ore': {
        const veins = room.oreAmount ?? 0;
        const ore = room.oreKind ? MINE_ORE_DEFS[room.oreKind] : undefined;
        if (!ore || veins === 0) return { verdict: 'WORKED OUT', color: MINE_VERDICT.quiet, body: 'No ore left.' };
        return {
          verdict: `${ore.name.toUpperCase()}  ·  ${veins} VEIN${veins === 1 ? '' : 'S'}`,
          color: MINE_VERDICT.ore,
          body: this.minePickaxes.length ? `${ore.name}. Mining needs a pickaxe.` : `${ore.name}. No pickaxe to mine it.`,
        };
      }
      case 'treasure':
        return room.resolved
          ? { verdict: 'CHEST OPENED', color: MINE_VERDICT.quiet, body: 'Empty chest.' }
          : { verdict: 'CHEST', color: MINE_VERDICT.treasure, body: 'A chest. No enemies.' };
      case 'shop':
        return { verdict: 'SHOP', color: MINE_VERDICT.shop, body: 'Sells pickaxes and supplies.' };
      default:
        return { verdict: 'EMPTY', color: MINE_VERDICT.quiet, body: 'Nothing here.' };
    }
  }

  private async runMineRoomShop(node: MineMazeNode, room: MineRoomState): Promise<void> {
    for (;;) {
      const choice = await this.promptMineChoice(
        'MINE SUPPLY ROOM',
        this.mineStatusLine(),
        `Party gold: ${this.swamprunGold}g. Pickaxe: ${MINE_PICKAXE_COST}g.`,
        [
          {
            id: 'pickaxe',
            label: `Buy pickaxe  ${MINE_PICKAXE_COST}g`,
            enabled: this.swamprunGold >= MINE_PICKAXE_COST,
          },
          { id: 'supplies', label: 'Browse supplies' },
          { id: 'leave', label: 'Leave shop' },
        ],
        { room, node: node.id, lit: true, verdict: 'SHOP', verdictColor: MINE_VERDICT.shop }
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
    if (this.spendMineTime(MINE_FIGHT_HOURS)) return;
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
    this.gs.log('Room cleared. Pick a passage.');
    this.redraw();
  }

  private async promptMineDirection(node: MineMazeNode): Promise<MineDirection | 'leave' | null> {
    const available = MINE_DIRECTIONS.filter((direction) =>
      Object.prototype.hasOwnProperty.call(node.exits, direction)
    );
    const canLeave = !!this.dungeon && (node.id === 0 || node.escape === true);
    if (available.length === 0 && !canLeave) return null;
    if (!this.mineInventoryOpen) this.mode = 'shop';
    const valid = (choice: string): boolean =>
      (canLeave && choice === 'leave') || available.includes(choice as MineDirection);
    const settle = (choice: string): MineDirection | 'leave' =>
      canLeave && choice === 'leave' ? 'leave' : available.includes(choice as MineDirection) ? choice as MineDirection : available[0];
    if (this.online) {
      this.showMineMap(node, true, 'Vote for a highlighted route.');
      const choice = await this.partyVote(valid, (id) => id === 'leave' ? 'Leave' : id);
      return choice ? settle(choice) : null;
    }
    this.showMineMap(node, true, 'Choose a highlighted route.');
    return new Promise<MineDirection | 'leave' | null>((resolve) => {
      this.mineChoiceResolve = (choice) => {
        if (choice && !valid(choice)) return;
        this.mineChoiceResolve = null;
        resolve(choice ? settle(choice) : null);
      };
    });
  }

  /**
   * One maze choice. Usually the leader's, and every peer then performs the same
   * seeded work; with `vote`, online, the whole party votes on it.
   */
  private async promptMineChoice(
    title: string,
    subtitle: string,
    body: string,
    choices: MinePromptChoice[],
    visual?: MinePromptVisual | MineVisualView,
    vote = false
  ): Promise<string> {
    const available = choices.filter((choice) => choice.enabled !== false);
    if (available.length === 0) return '';
    this.mode = 'shop';
    if (this.online && vote) {
      this.drawMinePrompt(title, subtitle, body, choices, visual, true);
      const choice = await this.partyVote(
        (id) => available.some((entry) => entry.id === id),
        (id) => choices.find((entry) => entry.id === id)?.label ?? id,
      );
      this.hideMinePanel();
      return choice;
    }
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
    visual?: MinePromptVisual | MineVisualView,
    vote = false
  ): void {
    this.hideMinePanel();
    const pick = (choice: string): void => this.mineChoiceResolve?.(choice);
    const decide = (): void => this.mineVoteDecide?.();
    this.mineFromRoom = !!visual && 'room' in visual;
    if (visual && 'room' in visual) {
      const { room } = visual;
      const veins = room.kind === 'ore' ? Math.min(3, room.oreAmount ?? 0) : 0;
      const view = new MineChamberView(this, {
        title,
        status: subtitle,
        verdict: visual.verdict,
        verdictColor: visual.verdictColor,
        body,
        spec: { content: room.kind, lit: visual.lit, resolved: room.resolved, seed: visual.node },
        ore: room.oreKind && veins > 0
          ? { kind: room.oreKind, veins: Array.from({ length: veins }, () => 'intact' as const) }
          : undefined,
        choices: choices.map((choice) => ({
          id: choice.id,
          label: choice.label,
          enabled: choice.enabled !== false,
          tone: choice.tone,
        })),
        vote,
        light: this.mineWalkers()[0]?.light ?? null,
      }, pick, decide);
      this.minePanel = view;
      this.mineVoteDisplay = vote ? view : null;
      return;
    }
    const view = new MinePromptView(this, {
      title,
      subtitle,
      body,
      visual,
      choices: choices.map((choice) => ({
        id: choice.id,
        label: choice.label,
        enabled: choice.enabled !== false,
      })),
      vote,
    }, pick, decide);
    this.minePanel = view;
    this.mineVoteDisplay = vote ? view : null;
  }

  /**
   * The mine map window, opened or brought up to date, standing at `node`. Opened
   * fresh after a room's window, it pulls back out of the room (`intro`).
   */
  private showMineMap(node: MineMazeNode, interactive: boolean, hint: string, intro = this.mineFromRoom): MineMapView {
    const model = this.mineMapModel(node, interactive, hint);
    if (this.mineMapView && this.minePanel === this.mineMapView) {
      this.mineMapView.update(model);
    } else {
      this.hideMinePanel();
      this.mineMapView = new MineMapView(this, { ...model, intro: intro ? 'room' : undefined }, {
        choose: (choice) => this.mineChoiceResolve?.(choice),
        inventory: () => this.toggleInventory(),
        decide: () => this.mineVoteDecide?.(),
      });
      this.minePanel = this.mineMapView;
    }
    this.mineMapVisible = true;
    this.mineFromRoom = false;
    this.mineVoteDisplay = this.mineMapView;
    return this.mineMapView;
  }

  private mineMapModel(node: MineMazeNode, interactive: boolean, hint: string): MineMapModel {
    const maze = this.mineMaze!;
    const run = this.dungeon === 'mines' ? this.explorationCombat?.run : undefined;
    const purse = this.dungeon ? '' : `  •  Party gold: ${this.swamprunGold}g`;
    const time = run ? `  •  Day ${run.day}, ${clockTime(run.hour)}  •  Bloodmoon day ${nextBloodmoonDay(run.day)}` : '';
    const map = run ? `  •  ${this.mineRemembers ? 'Minemap' : 'No Minemap'}` : '';
    const reveal = this.mineRevealNext ?? undefined;
    this.mineRevealNext = null;
    return {
      title: `${node.kind === 'room' ? 'LEAVE ROOM' : 'MINE MAP'}  //  STEP ${maze.steps}`,
      status: `Encounters cleared: ${this.swamprunWave}${purse}  •  Pickaxes: ${this.minePickaxes.length ? this.minePickaxes.join('/') : 'none'}${time}${map}`,
      maze,
      current: node.id,
      known: run?.mines ? new Set(run.mines.known) : null,
      markExits: this.dungeon === 'mines',
      leave: this.dungeon && (node.id === 0 || node.escape) ? node.id === 0 ? 'Leave via entrance' : 'Leave via exit' : null,
      interactive,
      hint,
      reveal,
      party: this.mineWalkers(),
    };
  }

  /** The party on the move in the Mines, the one carrying a light in front. */
  private mineParty(): Mage[] {
    const party = this.gs.mages.filter((mage) => mage.team === 1 && mage.alive && !mage.isSummon && !mage.sceneSide);
    const bearer = party.findIndex((mage) => mage.lightRadius() > 0);
    if (bearer > 0) party.unshift(...party.splice(bearer, 1));
    return party;
  }

  /** How the party walks the mine: each player's colour (as on their vote token) and the light they carry. */
  private mineWalkers(party = this.mineParty()): MineWalker[] {
    const order = this.gs.mages.filter((mage) => mage.team === 1 && mage.alive && !mage.isSummon && !mage.sceneSide);
    return party.map((mage) => ({
      color: MINE_VOTE_COLORS[(this.online ? this.controllerSeatOf(mage) : order.indexOf(mage)) % MINE_VOTE_COLORS.length],
      light: mage.lightRadius() > 0 ? (mage.heldTorchId() ? 'torch' : 'lantern') : null,
      name: mage.name,
      hp: mage.hp,
      maxHp: mage.maxHp,
    }));
  }

  /** Does anyone in the party, fighting or sitting out, carry the Minemap? */
  private partyHasMineMap(): boolean {
    const run = this.explorationCombat?.run;
    if (!run) return false;
    return restoreParty(run.party).some((mage) => mage.bag.includes('mineMap') || mage.equippedItems().includes('mineMap'));
  }

  /** Seats with a say in a party vote: every player in the party, fallen or not. */
  private mineVoters(): number[] {
    const seats = new Set<number>([0]);
    const claimed = this.explorationCombat?.seats;
    if (claimed) for (const seat of Object.values(claimed)) if (typeof seat === 'number') seats.add(seat);
    for (const mage of this.gs.mages) {
      if (mage.team === 1 && !mage.isSummon && !mage.isAI && !mage.sceneSide) seats.add(this.controllerSeatOf(mage));
    }
    return [...seats].sort((a, b) => a - b);
  }

  private seatName(seat: number): string {
    if (seat === this.localSeat) return 'You';
    const mage = this.gs.mages.find((m) =>
      m.team === 1 && !m.isSummon && !m.isAI && !m.sceneSide && this.controllerSeatOf(m) === seat);
    if (mage) return mage.name;
    const claimed = this.explorationCombat?.seats;
    const member = claimed ? MAGE_CLASSES.find((cls) => claimed[cls] === seat) : undefined;
    return member ? MAGE_CLASS_DEFS[member].label : `Player ${seat + 1}`;
  }

  private mineVoteState(
    voters: readonly number[],
    votes: ReadonlyMap<number, string>,
    label: (choice: string) => string,
    leader: boolean,
  ): MineVoteState {
    const named = voters.map((seat) => ({ seat, name: this.seatName(seat), choice: votes.get(seat) }));
    const cast = named.filter((voter) => voter.choice != null);
    const waiting = named.filter((voter) => voter.choice == null);
    const parts = cast.map((voter) => `${voter.name}: ${label(voter.choice!)}`);
    if (waiting.length) parts.push(`Waiting: ${waiting.map((voter) => voter.name).join(', ')}`);
    return {
      line: `Votes ${cast.length}/${voters.length}   ${parts.join('   ')}`,
      marks: cast.map((voter) => ({
        choice: voter.choice!,
        color: MINE_VOTE_COLORS[voter.seat % MINE_VOTE_COLORS.length],
        initial: voter.name.charAt(0).toUpperCase(),
      })),
      canDecide: leader && cast.length > 0 && waiting.length > 0,
    };
  }

  /**
   * An online party vote on a mine choice. Every player picks, and may change their
   * pick; the leader counts and, once everyone has voted (or on "Decide now"),
   * announces the most-voted choice (a tie: chance), which every peer then follows.
   * Votes ride the side lane; only the announcement enters the lockstep queue.
   * '' when the connection or the run ends first.
   */
  private partyVote(valid: (choice: string) => boolean, label: (choice: string) => string): Promise<string> {
    const net = this.net!;
    const round = `${this.mineVoteSalt}:${++this.mineVoteRound}`;
    const voters = this.mineVoters();
    const leader = this.localSeat === 0;
    const votes = new Map<number, string>();
    const show = (): void => this.mineVoteDisplay?.setVotes(this.mineVoteState(voters, votes, label, leader));
    return new Promise<string>((resolve) => {
      let open = true;
      const close = (choice: string, announce: boolean): void => {
        if (!open) return;
        open = false;
        net.setSideHandler(null);
        this.mineChoiceResolve = null;
        this.mineVoteDecide = null;
        if (announce) net.send({ k: 'mine-choice', round, choice });
        resolve(choice);
      };
      const settle = (): string => tallyVotes(
        voters.flatMap((seat) => votes.has(seat) ? [votes.get(seat)!] : []),
        (tied) => tied[Math.floor(Math.random() * tied.length)],
      ) ?? '';
      const record = (seat: number, choice: string): void => {
        if (!open || !voters.includes(seat) || !valid(choice)) return;
        votes.set(seat, choice);
        show();
        if (leader && voters.every((voter) => votes.has(voter))) close(settle(), true);
      };
      net.setSideHandler((message) => {
        if (message.k !== 'mine-vote' || message.round !== round) return;
        if (typeof message.from === 'number' && typeof message.choice === 'string') record(message.from, message.choice);
      });
      this.mineChoiceResolve = (choice) => {
        if (!choice) {
          close('', false);
          return;
        }
        if (!valid(choice) || votes.get(this.localSeat) === choice) return;
        net.send({ k: 'mine-vote', round, choice });
        record(this.localSeat, choice);
      };
      this.mineVoteDecide = leader ? () => {
        if (votes.size > 0) close(settle(), true);
      } : null;
      show();
      if (leader) return;
      void (async () => {
        while (open) {
          const message = await net.recv();
          if (message.k === 'bye') {
            close('', false);
            return;
          }
          if (message.k === 'mine-choice' && message.round === round) {
            close(typeof message.choice === 'string' && valid(message.choice) ? message.choice : '', false);
            return;
          }
        }
      })();
    });
  }

  private hideMinePanel(): void {
    const inventoryWasOpen = this.mineInventoryOpen;
    this.minePanel?.destroy();
    this.minePanel = undefined;
    this.mineMapView = undefined;
    this.mineVoteDisplay = null;
    this.mineMapVisible = false;
    if (inventoryWasOpen) {
      this.invPanel?.destroy();
      this.invPanel = undefined;
      this.mineInventoryOpen = false;
      this.mode = 'shop';
    }
  }

  /** Spawn the roster for the next wave and refresh the board. */
  private spawnWave(n: number): void {
    this.swamprunWave = n;
    if (this.dungeon && !this.dungeonRetreating) this.dungeonDeepest = Math.max(this.dungeonDeepest, n);
    this.swamprunWaveEnemies = [];
    this.swamprunWispCopies.clear();
    this.xpEnemies.clear();
    // Build a genuinely fresh combat around the surviving, persistent party.
    this.beginWaveCombat(n);
    const partySize = this.swamprunPartySize();
    if (this.raid) {
      const name = raidTargetName(this.raidBoss);
      this.swamprunEncounterPower = raidTargetPower(this.raidBoss);
      if (this.raidPrepActive) {
        this.gs.log(
          `— RAID PREP — Summon ${name} from the action menu when ready. —`
        );
        for (let i = 0; i < RAID_PREP_EFFIGIES; i++) this.spawnRaidEffigy();
      } else {
        this.gs.log(`— RAID: ${name} —`);
        this.raidTarget = this.summonRaidBoss();
      }
    } else if (this.mineRun) {
      const spawns = mineWaveComposition(n, this.gs.rng, partySize);
      this.gs.log(`— Mine encounter ${n}: ${spawns.length} foe${spawns.length === 1 ? '' : 's'} in the room —`);
      for (const spawn of spawns) this.spawnMineEnemy(spawn);
    } else if (this.dungeon === 'forest') {
      const spawns = rollForestWave(n, this.gs.rng, partySize);
      this.gs.log(`— ${DUNGEONS.forest.name}, depth ${n}: ${describeSpawns(spawns)} —`);
      for (const spawn of spawns) {
        if (spawn.family === 'swamp') this.spawnEnemy(spawn.kind);
        else this.spawnMineEnemy(spawn.spec);
      }
    } else {
      const encounter = rollSwamprunEncounter(n, this.gs.rng, partySize);
      this.swamprunEncounterPower = encounter.power;
      const region = encounter.deep ? 'Deep Swamps' : 'Standard Swamps';
      this.gs.log(
        `— ${region}, ${encounter.depth}m — Power ${encounter.power}, ${encounter.kinds.length} foe${encounter.kinds.length === 1 ? '' : 's'}. —`
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
      // A dive's depths are separate fights too: colour charges start over.
      if (this.explorationCombat) m.resetCombatReactions();
      this.swamprunArrowsOwned.set(m, m.arrows);
    }
    const order = party.flatMap((mage, index) => mage.isSummon || mage.inert ? [] : [index]);
    this.gs.restoreTurnOrder(order, party.map(() => 0), order[0] ?? 0);
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
      name: 'Training Dummy',
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
      this.gs.log(`${effigy.name} is back.`);
    }
    this.syncMageSprites();
  }

  /** Preparation restores are free: they cost no action of any kind. */
  private applyRaidPrepRestore(mage: Mage, kind: RaidRestoreKind): void {
    if (!this.raidPrepActive || mage.team !== 1 || !mage.alive) return;
    if (kind === 'vitals') {
      mage.hp = mage.maxHp;
      mage.sanity = mage.maxSanity;
      this.gs.log(`${mage.name} restores health and sanity in full.`);
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
    this.swamprunEncounterPower = raidTargetPower(this.raidBoss);
    this.raidTarget = this.summonRaidBoss();
    this.gs.log(`— Training dummies removed. ${raidTargetName(this.raidBoss)} enters combat. —`);
    this.syncMageSprites();
    this.updateWaveHud();
    this.redraw();
  }

  /** The raid's boss takes the field: a swamp boss alone, a bloodmoon boss with all it brings, as its bloodmoon would. */
  private summonRaidBoss(): Mage {
    const target = this.raidBoss;
    if (isBloodmoonRaid(target)) return this.spawnBloodmoonBoss({ id: target, cycle: BOSSES[target].tier });
    return this.spawnEnemy(target);
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
    if (m.bossArt) {
      this.styleBossSprite(m);
      return;
    }
    const rec = this.mageAnims.get(m);
    if (!rec) return;
    const visual = mineEnemyVisual(m);
    const kind = creatureSpriteKind(m);
    const key = `${kind}:${visual.tint}:${visual.scale}`;
    if (rec.mineVisualKey === key) return;
    rec.mineVisualKey = key;
    if (kind) {
      rec.sprite.clearTint();
      if (m.mine?.golemState === 'dormant') rec.sprite.setTint(0x999999);
    } else rec.sprite.setTint(visual.tint);
    const srcH = rec.sprite.height || 1;
    rec.sprite.setScale(((kind ? CREATURE_SPRITE_HEIGHT : MAGE_RADIUS * 2.8) / srcH) * visual.scale);
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
    if (!this.swamprun || this.raid || this.swamprunInterludeActive || this.gameEnded) return false;
    if (this.mineRun && !this.mineInCombat) return false;
    const survives = (mage: Mage): boolean =>
      mage.alive || (!!mage.edgelordCapturedBy && mage.vitalsAlive);
    const partyAlive = this.gs.mages.some((m) => m.team === 1 && survives(m) && !m.isSummon && !m.sceneSide);
    // A scene's prey fights nobody: it never holds a fight open.
    const foesLeft = this.gs.mages.some((m) => m.team !== 1 && m.sceneSide !== 'prey' && survives(m));
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
    this.turnSerial += 1;
    try {
      this.gs.finishCurrentTurn();
      if (this.explorationCombat && !this.dungeon) {
        await this.finishExplorationFight();
        return false;
      }
      await this.awardWaveLoot();
      for (const m of this.gs.mages) {
        if (m.team !== 1 || !m.alive) continue;
        this.tickTorches(m);
        // Ammunition belongs to the run inventory, but shots are recovered when
        // the old battlefield is left behind.
        const owned = this.swamprunArrowsOwned.get(m);
        if (owned != null) m.arrows = owned;
      }
      if (this.dungeon && !this.mineRun) return this.runDungeonInterlude();
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
    if (this.mineRun) return true;
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

  /**
   * Hand carried materials to whoever still has the strength to haul them.
   * Anything nobody can lift is left behind — that is the point of the weight.
   */
  private awardMaterials(items: readonly ItemId[]): { taken: ItemId[]; left: ItemId[] } {
    const carriers = this.gs.mages.filter((m) => m.alive && m.team === 1 && !m.isSummon && !m.sceneSide);
    const taken: ItemId[] = [];
    const left: ItemId[] = [];
    for (const id of items) {
      const kg = getItem(id).weight;
      const carrier = carriers.find((m) => m.canCarry(kg) && this.packRoomFor(m, id));
      if (carrier) {
        this.gs.grantItem(carrier, id);
        taken.push(id);
      } else {
        left.push(id);
      }
    }
    return { taken, left };
  }

  /** An Exploration pack holds only so many slots; `grantItem` stows hand items, so they never count as held. */
  private packRoomFor(mage: Mage, id: ItemId): boolean {
    if (!this.explorationCombat) return true;
    return getItem(id).slot === 'hand' ? packCanStow(mage, id) : packFits(mage, [id]);
  }

  /**
   * Where a haul ends up. An exploration party carries its cargo home; every
   * other run has no way home and cashes it in where it stands.
   */
  private collectMaterials(items: readonly ItemId[]): { text: string; left: ItemId[] } {
    if (items.length === 0) return { text: 'nothing', left: [] };
    if (!this.explorationCombat) {
      const gold = Math.round(items.reduce((sum, id) => sum + this.swampSellValue(id), 0) * 2) / 2;
      this.swamprunGold += gold;
      return { text: `${this.materialTally(items)} sold for ${gold}g`, left: [] };
    }
    const hauled = this.awardMaterials(items);
    return {
      text: hauled.taken.length ? this.materialTally(hauled.taken) : 'nothing',
      left: hauled.left,
    };
  }

  /** "2x Iron Ore, Coal" — materials read as a tally, never a repeated list. */
  private materialTally(items: readonly ItemId[]): string {
    const counts = new Map<ItemId, number>();
    for (const id of items) counts.set(id, (counts.get(id) ?? 0) + 1);
    return [...counts]
      .map(([id, n]) => (n > 1 ? `${n}x ${getItem(id).name}` : getItem(id).name))
      .join(', ');
  }

  /** Roll every fallen creature's drop table and sell the loot into the party's gold. */
  private async awardWaveLoot(): Promise<void> {
    if (this.explorationCombat) {
      await this.awardExplorationDrops();
      return;
    }
    let gold = 0;
    const tally: string[] = [];
    const salvage: ItemId[] = [];
    for (const m of this.swamprunWaveEnemies) {
      if (!m.enemyKind) continue;
      const loot = isMineEnemyKind(m.enemyKind)
        ? rollMineLoot(m.enemyKind, this.gs.rng)
        : rollLoot(m.enemyKind as EnemyKind, this.gs.rng, this.swamprunWispCopies.has(m));
      gold += loot.gold;
      tally.push(...loot.drops);
      salvage.push(...loot.materials);
    }
    const hauled = this.collectMaterials(salvage);
    if (hauled.left.length) {
      this.gs.log(`Too heavy to carry, left behind: ${this.materialTally(hauled.left)}.`);
    }
    gold = Math.round(gold * 2) / 2; // keep clean halves
    const supplyGold = Math.max(0, this.swamprunPartySize() - 1);
    gold += supplyGold;
    this.swamprunGold += gold;
    this.swamprunWaveEnemies = [];
    const drops = tally.length ? ` — salvage: ${tally.join(', ')}` : '';
    const supplyText = supplyGold > 0 ? ` (${supplyGold}g party supplies)` : '';
    this.gs.log(
      `${this.mineRun ? 'Encounter' : 'Wave'} ${this.swamprunWave} cleared! Sold loot for ${gold}g${supplyText}${drops}. Party gold: ${this.swamprunGold}g.`
    );
    await this.collectLootScreen([], 'ENCOUNTER CLEARED', 'combat',
      tally.length ? `Sold salvage: ${tally.join(', ')}.` : 'The battlefield is quiet. No salvage found.',
      `+${gold}g for the party`);
  }

  /** Exploration pays in what the fallen leave, never in coin: each creature rolls its own drops. */
  private async awardExplorationDrops(): Promise<void> {
    const found: ItemId[] = [];
    for (const m of this.swamprunWaveEnemies) {
      if (!m.enemyKind || this.swamprunWispCopies.has(m)) continue;
      found.push(...rollDrops(dropKind(m.enemyKind, m.mine?.role), this.swamprunWave, this.gs.rng));
    }
    this.swamprunWaveEnemies = [];
    if (this.explorationCombat?.boss) {
      const shard = MOONSHARD[BOSSES[this.explorationCombat.boss.id].color];
      found.push(...Array.from({ length: this.gs.rng.die(3) }, () => shard));
    }
    this.gs.log(found.length ? `Drops: ${this.materialTally(found)}.` : 'No drops.');
    await this.collectLootScreen(found, 'VICTORY SPOILS', 'combat',
      found.length ? 'The fallen leave their spoils.' : 'Victory. Nothing of value was left behind.');
    this.updateWaveHud();
  }

  private async collectLootScreen(
    items: readonly ItemId[], title: string, source: 'chest' | 'combat', message: string, gold?: string,
  ): Promise<void> {
    this.hideMinePanel();
    const previousMode = this.mode;
    this.mode = 'shop';
    const entries = lootEntries(items);
    const party = this.gs.mages.filter((mage) => mage.team === 1 && mage.alive && !mage.isSummon && !mage.sceneSide);
    const voters = this.online ? this.mineVoters() : [this.localSeat];
    const ready = new Set<number>();
    const owner = (mage: Mage): number => mage.isAI ? 0 : this.controllerSeatOf(mage);
    const fits = (mage: Mage, id: ItemId): boolean => this.packRoomFor(mage, id);
    const allowed = (choice: string, seat = this.localSeat): boolean => {
      const parsed = parseLootChoice(choice);
      if (!parsed || !voters.includes(seat) || ready.has(seat)) return false;
      return parsed.kind === 'ready' || (canClaimLoot(entries, party, parsed.entry, parsed.member, fits)
        && (!this.online || owner(party[parsed.member]) === seat));
    };
    const view = new LootView(this, {
      title, source, message, gold, entries, party: () => party,
      canTake: (entry, member) => allowed(`take:${entry}:${member}`),
      take: (entry, member) => this.mineChoiceResolve?.(`take:${entry}:${member}`),
      done: () => this.mineChoiceResolve?.('ready'),
      doneLabel: this.online ? 'Ready' : 'Continue', confirmLeave: !this.online,
    });
    this.minePanel = view;
    try {
      while (ready.size < voters.length && this.scene.isActive() && !this.mineRunEnded && !this.opponentLeft) {
        const result = await this.nextMineChoice(allowed);
        if (!result.choice) break;
        const choice = parseLootChoice(result.choice)!;
        if (choice.kind === 'ready') {
          ready.add(result.seat);
          if (result.seat === this.localSeat) view.markReady();
          else view.refresh(`${this.seatName(result.seat)} is ready.`);
          continue;
        }
        const id = claimLoot(entries, party, choice.entry, choice.member,
          (mage, item) => this.gs.grantItem(mage, item), fits);
        if (id) {
          const text = `${party[choice.member].name} packs ${getItem(id).name}.`;
          this.gs.log(text);
          view.refresh(text);
          playSound('ui.confirm');
        }
      }
      const left = entries.flatMap((entry) => Array.from({ length: entry.count }, () => entry.id));
      if (left.length) this.gs.log(`Left behind: ${this.materialTally(left)}.`);
    } finally {
      this.mineChoiceResolve = null;
      this.hideMinePanel();
      this.mode = previousMode;
    }
  }

  private xpToNextLevel(): number {
    return xpToNext(this.runLevel, this.xpScale());
  }

  private xpScale(): number {
    return this.explorationCombat ? partyXpScale(this.explorationCombat.run) : 1;
  }

  private addRunXp(amount: number): void {
    const track = { level: this.runLevel, xp: this.runXp, pendingLevels: this.pendingLevels };
    addXp(track, amount);
    this.runLevel = track.level;
    this.runXp = track.xp;
    this.pendingLevels = track.pendingLevels;
  }

  private async resolveLevelUps(): Promise<void> {
    if (this.explorationCombat) await this.resolveExplorationLevelUps(this.explorationCombat.run);
  }

  /** Every fighter catches up on each level whose rewards it has not chosen yet. */
  private async resolveExplorationLevelUps(run: ExplorationCombat['run']): Promise<void> {
    this.pendingLevels = 0;
    const players = this.gs.mages.filter((mage) => mage.team === 1 && !mage.isSummon && !mage.isAI);
    const taken = (player: Mage): number => Math.min(this.runLevel, run.levelsTaken[player.mageClass] ?? 1);
    for (let level = Math.min(...players.map(taken)) + 1; level <= this.runLevel; level++) {
      for (const player of players) {
        if (taken(player) >= level) continue;
        await this.resolveLevel(player, level);
        run.levelsTaken[player.mageClass] = level;
      }
    }
  }

  private async resolveLevel(player: Mage, level: number): Promise<void> {
    const reward = levelReward(level);
    // Rolled on every peer, so the shared dice stay in step whoever does the choosing.
    const offers = reward.word ? this.levelWordOffers(player) : [];
    await this.syncPlayerChoice(player, async () => {
      const coreGain = levelCoreStatGain(level);
      for (const stat of ['strength', 'dex', 'int'] as const) player.gainStat(stat, coreGain);
      player.gainStat('mana', 1);
      player.gainStat('hp', 1);
      if (reward.stats > 0) await this.promptLevelStats(player, level, reward.statGain);
      if (reward.word) await this.promptLevelWord(player, level, offers);
      await this.promptColorIdentity(player);
    });
    this.gs.log(`${player.name} reaches level ${level}.`);
  }

  private async syncPlayerChoice(player: Mage, choose: () => Promise<void>): Promise<void> {
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
        vitals: [player.hp, player.mana, player.luck],
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
      const vitals = Array.isArray(msg.vitals) ? msg.vitals.map(Number) : [];
      if (vitals.length === 3 && vitals.every(Number.isFinite)) {
        player.hp = Math.max(0, Math.min(player.maxHp, Math.floor(vitals[0])));
        player.mana = Math.max(0, Math.min(player.maxMana, Math.floor(vitals[1])));
        player.luck = Math.max(0, Math.min(player.maxLuck, Math.floor(vitals[2])));
      }
      const loadout = Array.isArray(msg.loadout)
        ? msg.loadout.filter((word): word is WordId => typeof word === 'string' && Object.prototype.hasOwnProperty.call(WORDS, word))
        : [];
      const color = (value: unknown): ColorName | null =>
        value === 'black' || value === 'blue' || value === 'white' || value === 'red' ? value : null;
      player.setLoadout(loadout, color(msg.primary), color(msg.secondary));
      return;
    }
  }

  private promptLevelStats(player: Mage, level: number, gain: number): Promise<void> {
    const previousMode = this.mode;
    this.mode = 'shop';
    return new Promise((resolve) => {
      const panel = new ChoiceMenuView<StatKey>(this, `LEVEL ${level} / TRAINING`, `Raise one stat by ${gain}.`,
        STAT_DEFS.map((definition) => ({
          id: definition.key,
          label: definition.name,
          detail: definition.blurb,
        })), (stat) => {
        player.gainStat(stat, gain);
        panel.destroy();
        this.mode = previousMode;
        resolve();
      });
    });
  }

  private levelWordOffers(player: Mage): WordId[] {
    const pool = levelWordPool(player.loadout);
    const offers: WordId[] = [];
    while (pool.length > 0 && offers.length < 3) {
      const word = this.gs.rng.pick(pool);
      offers.push(word);
      pool.splice(pool.indexOf(word), 1);
    }
    return offers;
  }

  private promptLevelWord(player: Mage, level: number, offers: readonly WordId[]): Promise<void> {
    if (offers.length === 0) return Promise.resolve();
    const previousMode = this.mode;
    this.mode = 'shop';
    return new Promise((resolve) => {
      const panel = new ChoiceMenuView(this, `LEVEL ${level} / NEW WORD`,
        rackIsFull(player.loadout) ? 'Choose a word, then replace one of your five.' : 'Choose one of three words.',
        offers.map((word) => ({ id: word, label: WORDS[word].label, detail: WORDS[word].blurb })),
        async (word) => {
          panel.destroy();
          if (rackIsFull(player.loadout)) {
            const replaced = await this.promptWordReplacement(player, word);
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

  private promptWordReplacement(player: Mage, gained: WordId): Promise<boolean> {
    return new Promise((resolve) => {
      const choices = player.loadout.flatMap((word, index) => isModifierWord(word) ? [] : [{
        id: String(index),
        label: WORDS[word].label,
        detail: `Replace ${WORDS[word].label} with ${WORDS[gained].label}.`,
      }]);
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

  private async promptColorIdentity(player: Mage): Promise<void> {
    const counts = this.colorCounts(player);
    const present = (Object.keys(counts) as ColorName[]).filter((color) => counts[color] > 0);
    if (present.length < 2) {
      player.setLoadout(player.loadout, null, null);
      return;
    }
    const top = Math.max(...present.map((color) => counts[color]));
    const primaryChoices = present.filter((color) => counts[color] === top);
    const primary = primaryChoices.length > 1
      ? await this.promptColorChoice('CHOOSE PRIMARY COLOR', primaryChoices)
      : primaryChoices[0];
    const remaining = present.filter((color) => color !== primary);
    const secondCount = Math.max(...remaining.map((color) => counts[color]));
    const secondaryChoices = remaining.filter((color) => counts[color] === secondCount);
    const secondary = secondaryChoices.length > 1
      ? await this.promptColorChoice('CHOOSE SECONDARY COLOR', secondaryChoices)
      : secondaryChoices[0];
    player.setLoadout(player.loadout, primary, secondary);
  }

  private promptColorChoice(title: string, colors: ColorName[]): Promise<ColorName> {
    return new Promise((resolve) => {
      const panel = new ChoiceMenuView(this, title, 'Tied colours: pick the order.',
        colors.map((color) => ({
          id: color,
          label: color.toUpperCase(),
          detail: `${color.toUpperCase()} comes first.`,
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
    const alive = this.gs.mages.filter((m) => m.team !== 1 && m.sceneSide !== 'prey' && m.alive).length;
    const text = this.explorationCombat
      ? this.explorationHudText(alive)
      : this.mineRun
        ? this.mineInCombat
          ? `Mine Run  Encounter ${this.swamprunWave}  Enemy Lv ${mineEnemyLevel(this.swamprunWave)}  Foes: ${alive}  Gold: ${this.swamprunGold}g`
          : `Mine Run  Maze step ${this.mineMaze?.steps ?? 0}  Encounters: ${this.swamprunWave}  Gold: ${this.swamprunGold}g  Pickaxes: ${this.minePickaxes.join(', ') || 'none'}`
        : this.raid
          ? this.raidPrepActive
            ? `RAID PREP  Dummies: ${alive}`
            : `RAID  ${raidTargetName(this.raidBoss)}  ${(this.raidBoss === 'crusade' ? !this.raidVictory : this.raidTarget?.alive) ? 'ACTIVE' : 'DEFEATED'}  Foes: ${alive}`
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

  /** An Exploration fight earns no coin, so the bar shows where the party is and what it has learned. */
  private explorationHudText(alive: number): string {
    const level = `Level ${this.runLevel} (${this.runXp}/${this.xpToNextLevel()} XP)`;
    if (this.mineRun) {
      return this.mineInCombat
        ? `The Mines  Encounter ${this.swamprunWave}  Enemy Lv ${mineEnemyLevel(this.swamprunWave)}  Foes: ${alive}  ${level}`
        : `The Mines  Maze step ${this.mineMaze?.steps ?? 0}  Encounters: ${this.swamprunWave}  Pickaxes: ${this.minePickaxes.join(', ') || 'none'}  ${level}`;
    }
    const where = this.dungeon
      ? `${DUNGEONS[this.dungeon].name}  ${this.dungeonRetreating ? 'On the way back, depth' : 'Depth'} ${this.swamprunWave}`
      : `Depth ${this.swamprunWave}`;
    return `${where}  Foes: ${alive}  ${level}`;
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
    for (const slot of WORN_SLOTS) mage.setWorn(slot, null);
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
      confirmLabel: this.raid ? 'Start Raid Prep' : this.mineRun ? 'Start Mine Run' : 'Start Swamprun',
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
      this.gs.log('Builds cannot be saved in this browser; they last only this session.');
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
      subtitle: `${mage.name} is shopping.`,
      message: '',
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
    const capacity = mage.carryCap();
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
          detail: 'Raise one stat by 1d3, permanently.',
          accent: MENU_COLOR.brass,
          enabled: this.swamprunGold >= price,
        };
      }
      if (slot.sold || !slot.id) {
        return {
          title: 'Sold',
          price: slot.price,
          detail: 'Already bought.',
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
      ...WORN_SLOTS.flatMap((slot) => mage.worn(slot) ? [{ id: mage.worn(slot)!, where: slot }] : []),
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
        ? `${confirmDefinition.name} weighs ${confirmDefinition.weight}kg, over your carry limit. Buy anyway? Drop weight before leaving.`
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
    // Materials are cargo, not worn gear: they fetch full value, which is what
    // makes hauling a heavy load home worth the carry.
    if (def.material) return def.cost / SILVER_PER_GOLD;
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
    const store = mage.pouch.includes(itemId) ? mage.pouch : mage.utility;
    const i = store.indexOf(itemId);
    if (i < 0 || !def.potion) return;
    store.splice(i, 1);
    if (mage.readyConsumable === itemId) mage.readyConsumable = null;
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
    for (const slot of WORN_SLOTS) mage.setWorn(slot, null);
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
        case 'torso':
        case 'cape':
        case 'gloves':
        case 'boots':
          mage.setWorn(def.slot, id);
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
        ...WORN_SLOTS.flatMap((slot) => m.worn(slot) ? [m.worn(slot)!] : []),
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
      subtitle: `${rarityName}: choose 1 of ${count} (carry ${cap}kg).`,
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
    this.tutorialView?.setDisplay(this.tutorialDisplay());
    this.tutorialView?.tick(time);
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
    const area = this.aoeAim();
    if (area) this.drawAoeHitboxes(g, area.caster, area.toward, area.aoe);
  }

  /** The area spell being aimed right now, with where it would land (null until a target is hovered). */
  private aoeAim(): { caster: Mage; toward: Vec2 | null; aoe: NonNullable<Spell['aoe']> } | null {
    if (this.mode === 'subtarget-point' || this.mode === 'subtarget-enemy') {
      const aoe = this.channelAimSpell?.aoe;
      const caster = this.subtargetSource;
      if (!aoe || !caster) return null;
      const origin = this.subtargetOrigin ?? caster.pos;
      const toward = this.mode === 'subtarget-point'
        ? stepTowards(origin, this.pointer, this.subtargetRange)
        : this.clickedMage(this.pointer, null)?.pos ?? null;
      return { caster, toward, aoe };
    }
    if (this.mode !== 'aiming-point' && this.mode !== 'aiming-spell') return null;
    const spell = this.reactionAiming ? this.reactionPendingSpell : this.pendingSpell;
    if (!spell?.aoe || spell.twoPointAim) return null;
    const caster = this.aimingSource ?? this.gs.current;
    if (this.mode === 'aiming-spell') {
      return { caster, toward: this.clickedMage(this.pointer, null)?.pos ?? null, aoe: spell.aoe };
    }
    const reach = Number.isFinite(spell.range) ? this.gs.spellReach(spell, caster) : 99999;
    return { caster, toward: stepTowards(caster.pos, this.pointer, reach), aoe: spell.aoe };
  }

  private isEnemyTargetingMode(): boolean {
    return this.mode === 'aiming-melee'
      || this.mode === 'aiming-throw'
      || this.mode === 'aiming-eldritch'
      || this.mode === 'aiming-shout'
      || this.mode === 'aiming-staff'
      || this.mode === 'aiming-discharge'
      || this.mode === 'subtarget-enemy'
      || this.mode === 'aiming-spell'
      || (this.mode === 'aiming-hex' && this.pendingHexAim() === 'unit');
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
    if (this.gameEnded) return;
    if (this.gs.isOver) return this.endGame();
    const turnOwner = this.gs.current;
    // Locked until the turn start settles; the end of this method hands control out.
    this.mode = 'busy';
    this.turnStarting = true;
    this.turnSerial += 1;
    this.gs.beginTurn();
    if (!turnOwner.isAI) playSound('turn.start');
    this.showTurnBanner(turnOwner);
    // Frozen in time: the turn passes with nothing done and nothing aged.
    if (turnOwner.alive && this.gs.isTimeStopped(turnOwner)) {
      this.redraw();
      await this.delay(420);
      return this.nextTurn(true);
    }
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
    // A withdrawal begun last turn completes now, before anything else can stop it.
    if (turnOwner.fleeChannel && !turnOwner.crocodileGrip?.alive && this.releaseFlee(turnOwner)) return;
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
    void this.flushHits();
    await this.raisePendingDrakes();

    // Swamprun: a creature's own turn-start DoT tick can empty the board — run
    // the interlude rather than declaring the run over, and skip a creature that
    // just died.
    if (this.swamprunWaveCleared() && (await this.runWaveInterlude())) return this.startTurn();
    if (this.gameEnded) return;
    if (this.gs.isOver) return this.endGame();
    if (this.swamprun && !this.gs.current.alive) return this.nextTurn();

    if (this.gs.current.alive && this.gs.resolveCreatureCompulsion(this.gs.current)) {
      if (this.gs.isOver) return this.endGame();
      await this.nextTurn();
      return;
    }

    // A mind-bound mage is compelled to repeat its last action and forfeits
    // any choice this turn.
    const control = this.gs.controlOf(this.gs.current);
    if (control?.mode === 'repeat') {
      this.turnStarting = false;
      await this.runCompelledTurn();
      return;
    }

    this.turnStarting = false;
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
      const turn = this.turnSerial;
      await this.runRemoteTurn();
      if (this.gs.isOver) return this.endGame();
      // Already over without an End (a cleared wave, a forced turn end): it must not pass twice.
      if (turn !== this.turnSerial) return;
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
    const options = allSpells(me.spellClass).filter(
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


  /** Each commandable summon of `owner` not yet controlled this turn carries out its standing order. */
  private async runSummonOrders(owner: Mage): Promise<void> {
    for (const summon of this.gs.summonsOf(owner)) {
      if (this.gs.isOver) return;
      const order = summon.summonOrder;
      if (!order || summon.summonActedSeq === this.gs.turnSeq || !this.gs.canCommandSummon(owner, summon)) continue;
      if (order.kind === 'attack' && !summonOrderTarget(this.gs, summon)) {
        summon.summonOrder = undefined;
        continue;
      }
      summon.summonActedSeq = this.gs.turnSeq;
      summon.actions = { move: 1, main: 1, bonus: 1 };
      summon.hasCastThisTurn = false;
      const savedIndex = this.gs.currentIndex;
      this.puppet = { summon, owner, savedIndex };
      this.gs.currentIndex = this.gs.mages.indexOf(summon);
      try {
        for (let step = 0; step < 4 && summon.alive && !this.gs.isOver; step++) {
          const decision = summonOrderDecision(this.gs, summon, owner);
          if (decision.type === 'end') break;
          const target = this.aiDecisionTarget(decision);
          this.announceAIDecision(summon, decision, target);
          await this.delay(target ? 420 : 200);
          await this.performAIDecision(decision);
          this.redraw();
        }
      } finally {
        this.clearAITelegraph();
        this.gs.currentIndex = savedIndex;
        this.puppet = null;
      }
      if (order.turnsLeft != null && --order.turnsLeft <= 0 && summon.summonOrder === order) summon.summonOrder = undefined;
    }
    this.redraw();
  }

  private async nextTurn(skipReactionWindow = false): Promise<void> {
    if (this.mineRun && this.mineExploring) return;
    // Swamprun: refill the board the instant a wave is cleared so the run never
    // stalls out on an empty arena.
    if (this.swamprunWaveCleared() && (await this.runWaveInterlude())) return this.startTurn();
    if (this.gameEnded) return;
    // Summons with a standing order that were not controlled this turn act on it now.
    if (!this.puppet) {
      await this.runSummonOrders(this.gs.current);
      if (this.gs.isOver) return this.endGame();
    }
    // As the acting mage moves to end their turn, opponents get one last chance
    // to spend their reaction (counter-magic only) before the turn passes.
    if (!skipReactionWindow) {
      await this.offerReactionWindow(this.gs.current, 'End of Turn', {
        description: `${this.gs.current.name} moves to end their turn.`,
        allies: true,
      });
    }
    if (this.gs.isOver) return this.endGame();

    const helpers = spawnCrusadeHelpers(this.gs);
    for (const helper of helpers) {
      ensureBossSprites(this, 'crusadeHelper');
      helper.bossArt = 'crusadeHelper';
      this.ais.set(helper, new SimpleAI(this.gs, helper));
      this.swamprunWaveEnemies.push(helper);
    }
    if (helpers.length) {
      this.syncMageSprites();
      for (const helper of helpers) this.styleBossSprite(helper);
    }

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
      // Say what is about to happen and to whom, then leave a beat to read it.
      const target = this.aiDecisionTarget(decision);
      this.announceAIDecision(this.gs.current, decision, target);
      await this.delay(target ? 520 : 260);
      await this.performAIDecision(decision);
      this.redraw();
    }
    this.clearAITelegraph();
    // A Lich that never moved this turn takes a bonus end-step (rolled effect).
    await this.maybeLichEndStep();
    await this.maybeDeathknightEndStep();
    await this.maybeBaralEndStep();
    if (this.gs.wearDrake(this.gs.current)) {
      this.syncMageSprites();
      this.redraw();
    }
  }

  /** Who an AI decision is aimed at, when it is aimed at anyone. */
  private aiDecisionTarget(decision: AIDecision): Mage | null {
    if (decision.type === 'crusade-action') return decision.choice.target;
    return 'target' in decision && decision.target ? decision.target : null;
  }

  /** Plain-language label for what the AI is about to do. */
  private aiDecisionLabel(decision: AIDecision): string {
    switch (decision.type) {
      case 'move': return 'moves';
      case 'melee': return 'attacks';
      case 'scarab': return 'swats a scarab';
      case 'spell': return `casts ${decision.spell.name}`;
      case 'power': return `unleashes ${decision.spell.name}`;
      case 'color-ability': return `casts ${decision.ability.name}`;
      case 'deaths-angel-wings': return 'uses its wings';
      case 'ghast-mark': return 'marks the ground';
      case 'ghast-shove': return 'shoves';
      case 'reaper-mark': return 'marks';
      case 'reaper-channel': return 'begins channelling';
      case 'mine-action': return 'acts';
      case 'goblin-heal': return 'mends';
      case 'goblin-hex': return 'hexes';
      case 'goblin-escape': return 'flees the battle';
      case 'crusade-action': return decision.choice.kind === 'stock' ? `takes ${decision.choice.supply}` : decision.choice.kind;
      default: return 'acts';
    }
  }

  private aiTelegraph?: Phaser.GameObjects.Container;

  /** Caption the AI's intent above the field and ring whoever it is aimed at. */
  private announceAIDecision(actor: Mage, decision: AIDecision, target: Mage | null): void {
    this.clearAITelegraph();
    const text = `${actor.name} ${this.aiDecisionLabel(decision)}${target ? ` \u2192 ${target.name}` : ''}`;
    this.flashHint(text, true);
    if (!target || this.reducedMotion) return;
    const root = this.add.container(target.x, target.y).setDepth(57);
    const ring = this.add.graphics();
    ring.lineStyle(2, MENU_COLOR.blood, 0.95).strokeCircle(0, 0, MAGE_RADIUS + 16);
    ring.lineStyle(1, MENU_COLOR.blood, 0.55).strokeCircle(0, 0, MAGE_RADIUS + 24);
    root.add(ring);
    this.aiTelegraph = root;
    this.tweens.add({
      targets: root,
      scale: { from: 1.35, to: 1 },
      alpha: { from: 0.2, to: 1 },
      duration: 260,
      ease: 'Quad.Out',
    });
  }

  private clearAITelegraph(): void {
    this.aiTelegraph?.destroy();
    this.aiTelegraph = undefined;
  }

  private reactionTelegraph?: Phaser.GameObjects.Container;

  /** Ring the source of the action a reaction window is answering, so the
   *  reactor doesn't have to scan the log to see what's about to land. */
  private showReactionTelegraph(top: StackItem): void {
    this.clearReactionTelegraph();
    if (this.reducedMotion || !top.source.alive) return;
    const root = this.add.container(top.source.x, top.source.y).setDepth(57);
    const ring = this.add.graphics();
    ring.lineStyle(2, MENU_COLOR.brassLight, 0.95).strokeCircle(0, 0, MAGE_RADIUS + 16);
    ring.lineStyle(1, MENU_COLOR.brassLight, 0.55).strokeCircle(0, 0, MAGE_RADIUS + 24);
    root.add(ring);
    this.reactionTelegraph = root;
    this.tweens.add({
      targets: root,
      alpha: { from: 0.35, to: 1 },
      duration: 200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });
  }

  private clearReactionTelegraph(): void {
    if (this.reactionTelegraph) this.tweens.killTweensOf(this.reactionTelegraph);
    this.reactionTelegraph?.destroy();
    this.reactionTelegraph = undefined;
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
      await this.spellVfx.summonPuff(at, MAGE_RADIUS * 3.2);
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
    void this.flushHits();
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
        summonPuffs.push(this.spellVfx.summonPuff(at, MAGE_RADIUS * 3.2));
      }
      await Promise.all(summonPuffs);
      this.gs.log(
        `${knight.name} summons ${kinds.map((kind) => ENEMY_DEFS[kind].name).join(', ')}.`
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
      void this.flushHits();
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
    if (m.lillith) await this.resolveLillithTurn(m);
  }

  private async performAIDecision(d: AIDecision): Promise<void> {
    const me = this.gs.current;
    switch (d.type) {
      case 'move': {
        const crew = me.enemyKind === 'crusadeBallista' ? crusadeCrew(this.gs.mages, me) : [];
        if (me.enemyKind === 'crusadeBallista' && !crew.length) break;
        const from = { ...me.pos };
        if (me.enemyKind === 'crusadeHelper' && me.crusade) me.crusade.manning = undefined;
        me.spend('move');
        await this.runStack(this.gs.makeMoveItem(me, d.point));
        for (const helper of crew) {
          const before = { ...helper.pos };
          helper.x += me.x - from.x;
          helper.y += me.y - from.y;
          this.gs.notifyMageRelocation(helper, before, helper.pos, true);
        }
        break;
      }
      case 'melee':
        me.spend(me.attackIsBonusAction() ? 'bonus' : 'main');
        await this.runStack(this.gs.makeMeleeItem(me, d.target));
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
        await this.spellVfx.burst({ x: d.scarab.x, y: d.scarab.y }, 0xffffff, 24, 1.2);
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
        void this.flushHits();
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
      case 'crusade-action': {
        if (!canCrusadeAction(this.gs, me, d.choice)) break;
        const choice = d.choice;
        await this.runStack(this.gs.makeActionItem({
          source: me, target: choice.target, label: choice.kind,
          description: `${me.name}: ${choice.kind} (${choice.target.name}).`,
          isStillValid: () => canCrusadeAction(this.gs, me, choice),
          resolve: (game) => { resolveCrusadeAction(game, me, choice); },
        }));
        me.actions.main = 0;
        if (choice.kind !== 'priest-heal') me.actions = { move: 0, main: 0, bonus: 0 };
        break;
      }
      case 'goblin-heal':
      case 'goblin-hex': {
        me.spend('main');
        const mend = d.type === 'goblin-heal';
        const target = d.target;
        let landed = false;
        this.startBodyAttack(me);
        await this.delay(this.reducedMotion ? 0 : 280);
        await this.runStack(
          this.gs.makeActionItem({
            source: me,
            target,
            label: mend ? 'Goblin Mending' : 'Goblin Hex',
            description: mend
              ? `${me.name} mends ${target.name}: +${GOBLIN_MEND_HP} HP and +${Math.round(GOBLIN_HASTE * 100)}% move for 2 turns.`
              : `${me.name} hexes ${target.name}: -${Math.round(GOBLIN_HEX * 100)}% move for 2 turns.`,
            isStillValid: () => me.alive && target.alive && dist(me.pos, target.pos) <= GOBLIN_RITE_RANGE,
            resolve: (game) => {
              landed = true;
              if (mend) game.goblinMend(me, target);
              else game.goblinHex(me, target);
            },
          })
        );
        if (landed) {
          playSound(mend ? 'spell.heal' : 'spell.psychic');
          await this.spellVfx.burst(target.pos, mend ? 0x7cf07a : 0xb46cff, 34, 1.1);
        }
        break;
      }
      case 'goblin-escape': {
        const at = { x: me.x, y: me.y };
        this.gs.goblinEscape(me);
        playSound('move.dash');
        this.syncMageSprites();
        await this.spellVfx.summonPuff(at, MAGE_RADIUS * 2.6);
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
   * An online Adventure party member belongs to the seat that claimed it.
   */
  private controllerSeatOf(m: Mage): number {
    const partySeats = this.explorationCombat?.seats;
    if (m.isSummon && m.summonOwnerIndex != null) {
      const owner = partySeats ? this.gs.mages[m.summonOwnerIndex] : undefined;
      return owner && !owner.isSummon ? this.controllerSeatOf(owner) : m.summonOwnerIndex;
    }
    const partySeat = partySeats && m.team === 1 && !m.isAI ? partySeats[m.mageClass] : undefined;
    return partySeat ?? this.seatOf(m);
  }

  /** The mage this client plays online. In an Adventure fight a fallen player's is absent: show the party's first. */
  private localMage(): Mage {
    const seats = this.explorationCombat?.seats;
    if (!seats) return this.mageBySeat(this.localSeat);
    const party = this.gs.mages.filter((m) => m.team === 1 && !m.isSummon && !m.sceneSide);
    return party.find((m) => seats[m.mageClass] === this.localSeat) ?? party[0] ?? this.gs.mages[0];
  }

  /** This fight is part of an online Adventure: the session, not the fight, owns the connection. */
  private adventureOnline(): boolean {
    return !!this.explorationCombat && !!this.net && AdventureSession.current?.net === this.net;
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
    // Online a command from anyone but the turn's pilot, or from inside a reaction
    // prompt, would be read by the other peers as something else entirely.
    if (this.online && (!this.isLocalTurn() || this.mode === 'reaction' || this.reactionAiming)) return;
    if (this.online) this.net?.send({ k: 'turn', cmd });
    this.tutorialNotify({ k: 'command', cmd: cmd.t });
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
          this.gs.log(`${me.name} cannot cast ${spell.name}: it is banned.`);
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
          const aimOnRelease =
            spell.targeting !== 'self' && spell.targeting !== 'none' && !aimed && !point;
          me.channeledCast = { spell, target: aimed, point, point2, modifiers: mods, aimOnRelease };
          me.actions = { move: 0, main: 0, bonus: 0 };
          this.gs.log(
            `${me.name} channels ${spell.name}.`
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
      case 'item-pickup-swap': {
        if (!this.gs.canSwapDroppedItem(me, cmd.dropId, cmd.discard)) break;
        spend('bonus');
        await runAction(this.gs.makeActionItem({
          source: me,
          label: 'Exchange',
          description: `${me.name} exchanges items.`,
          resolve: (game) => { game.swapDroppedItem(me, cmd.dropId, cmd.discard); },
        }));
        break;
      }
      case 'item-use': {
        const itemId = cmd.itemId as ItemId;
        if (!me.pouch.includes(itemId) && me.readyConsumable !== itemId) break;
        if (me.isItemBanned(itemId)) {
          this.gs.log(
            `${me.name} cannot use ${getItem(itemId).name}: ${me.itemsSacrificed() ? 'held by the Shikigami until the day ends' : 'it is banned'}.`
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
      case 'item-ready': {
        const itemId = cmd.itemId as ItemId;
        const definition = getItem(itemId);
        if (!me.utility.includes(itemId) || (!definition.potion && !definition.throwable) || me.swordFormLocked()) break;
        spend('bonus');
        await runAction(this.gs.makeActionItem({
          source: me,
          label: 'Ready',
          description: `${me.name} draws ${definition.name}.`,
          resolve: () => { if (me.utility.includes(itemId)) me.readyConsumable = itemId; },
        }));
        break;
      }
      case 'pouch-store':
      case 'pouch-remove': {
        const itemId = cmd.itemId as ItemId;
        if (me.swordFormLocked() || (cmd.t === 'pouch-store'
          ? !me.hasConsumablePouch() || me.pouch.length >= 3 || !me.utility.includes(itemId) || !(getItem(itemId).potion || getItem(itemId).throwable)
          : !me.pouch.includes(itemId))) break;
        spend('bonus');
        await runAction(this.gs.makeActionItem({
          source: me,
          label: cmd.t === 'pouch-store' ? 'Store' : 'Remove',
          description: `${me.name} moves ${getItem(itemId).name} ${cmd.t === 'pouch-store' ? 'into' : 'out of'} the pouch.`,
          resolve: () => {
            if (cmd.t === 'pouch-store') me.stowInPouch(itemId);
            else me.removeFromPouch(itemId);
          },
        }));
        break;
      }
      case 'item-swap-hands': {
        if (me.swapHands()) this.gs.log(`${me.name} switches hands.`);
        this.redraw();
        break;
      }
      case 'item-equip': {
        const itemId = cmd.itemId as ItemId;
        const replace = cmd.replace ? cmd.replace as ItemId : null;
        if (!me.displacedBy(itemId, replace, cmd.hand)) break;
        spend('bonus');
        await runAction(
          this.gs.makeActionItem({
            source: me,
            label: 'Equip',
            description: `${me.name} equips ${getItem(itemId).name}.`,
            resolve: () => {
              const off = me.displacedBy(itemId, replace, cmd.hand) ?? [];
              if (me.equipAt(itemId, replace, cmd.hand)) {
                this.gs.notifyLightActivation(me);
                const swapped = off.length ? `, stowing ${off.map((other) => getItem(other).name).join(' and ')}` : '';
                this.gs.log(`${me.name} equips ${getItem(itemId).name}${swapped}.`);
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
              if (me.stow(itemId))
                this.gs.log(`${me.name} stows ${getItem(itemId).name} in the bag.`);
            },
          })
        );
        break;
      }
      case 'item-throw': {
        const itemId = cmd.itemId as ItemId;
        if (!me.pouch.includes(itemId) && me.readyConsumable !== itemId) break;
        if (me.isItemBanned(itemId)) {
          this.gs.log(
            `${me.name} cannot use ${getItem(itemId).name}: ${me.itemsSacrificed() ? 'held by the Shikigami until the day ends' : 'it is banned'}.`
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
      case 'hex': {
        const itemId = cmd.itemId as ItemId;
        const hex = me.utility.includes(itemId) ? hexOf(itemId) : undefined;
        if (!hex) break;
        if (me.isItemBanned(itemId)) {
          this.gs.log(
            `${me.name} cannot use ${getItem(itemId).name}: ${me.itemsSacrificed() ? 'held by the Shikigami until the day ends' : 'it is banned'}.`
          );
          break;
        }
        const aim = {
          target: cmd.target != null ? this.mageBySeat(cmd.target) : null,
          point: cmd.x != null && cmd.y != null ? { x: cmd.x, y: cmd.y } : null,
        };
        if (me.mana < hexManaCost(hex) || hexAimProblem(this.gs, me, hex, aim)) {
          this.gs.log(`${getItem(itemId).name} stays quiet.`);
          break;
        }
        const action = hexAction(hex);
        spend(action === 'bonus' ? 'bonus' : 'main');
        if (action === 'full') spend('bonus');
        await runAction(
          this.gs.makeActionItem({
            source: me,
            target: aim.target ?? undefined,
            targetPoint: aim.point ?? undefined,
            label: getItem(itemId).name,
            description: `${me.name} casts ${getItem(itemId).name}.`,
            hostileAttack: !!aim.target && aim.target.team !== me.team && hexHarmful(hex),
            actionVisual: hexVisual(hex),
            needleBan: { kind: 'item', itemId },
            resolve: (game) => {
              activateHexzettel(game, me, itemId, aim);
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
            label: activating ? 'Activate Lantern' : 'Deactivate Lantern',
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
          this.gs.log(`${me.name} cannot use Eldritch Truth: it is banned.`);
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
      case 'staff-bolt': {
        const itemId = cmd.item as ItemId;
        const target = this.mageBySeat(cmd.target);
        const bolt = me.hands.includes(itemId) ? getItem(itemId).staffBolts?.[cmd.bolt] : undefined;
        if (!bolt || !this.canStaffBoltAt(me, itemId, cmd.bolt, target) || me.mana < bolt.mana) {
          this.gs.log(`${me.name}'s staff stays quiet.`);
          break;
        }
        spend('main');
        me.spendMana(bolt.mana);
        await runAction(
          this.gs.makeActionItem({
            source: me,
            target,
            label: `${getItem(itemId).name}: ${bolt.label}`,
            description: `${me.name} fires a bolt from ${getItem(itemId).name} at ${target.name}.`,
            hostileAttack: true,
            actionVisual: STAFF_BOLT_VISUAL[bolt.type] ?? 'lightning',
            needleBan: { kind: 'item', itemId },
            isStillValid: () => me.alive && target.alive && dist(me.pos, target.pos) <= bolt.rangePx,
            resolve: (game) => game.staffBolt(me, itemId, cmd.bolt, target),
          })
        );
        break;
      }
      case 'thunder-charge': {
        if (me.isActionBanned('thunder-charge')) {
          this.gs.log(`${me.name} cannot charge thunder: it is banned.`);
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
          this.gs.log(`${me.name} cannot discharge thunder: it is banned.`);
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
          this.gs.log(`${me.name}'s weapon action is banned.`);
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
                  ? `${me.name} teleports between shadows.`
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
                `${me.name} focuses.`
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
        void this.spellVfx.slash('fx-slash-sweep', center, dir, reach * 2.6);
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
        if (!this.gs.canCommandSummon(owner, summon) || summon.summonActedSeq === this.gs.turnSeq) break;
        if (!owner.freeSummonOrders) spend('bonus');
        summon.summonActedSeq = this.gs.turnSeq;
        summon.summonOrder = undefined;
        summon.actions = { move: 1, main: 1, bonus: 1 };
        summon.hasCastThisTurn = false;
        this.puppet = { summon, owner, savedIndex: this.gs.currentIndex };
        this.gs.currentIndex = this.gs.mages.indexOf(summon);
        this.gs.log(`${owner.name} commands ${summon.name}.`);
        break;
      }
      case 'shout': {
        if (this.puppet || me.isSummon) break;
        const summons = this.gs.summonsOf(me).filter((s) => this.gs.canCommandSummon(me, s));
        const target = cmd.order === 'attack' && cmd.target != null ? this.gs.mages[cmd.target] : undefined;
        if (summons.length === 0 || (cmd.order === 'attack' && (!target?.alive || target.team === me.team))) break;
        if (!me.freeSummonOrders) spend('bonus');
        for (const summon of summons) {
          summon.summonOrder = {
            kind: cmd.order,
            targetIndex: target ? this.seatOf(target) : undefined,
            turnsLeft: cmd.order === 'flee' ? 2 : undefined,
          };
        }
        this.gs.log(`${me.name} orders all summons: ${SHOUT_LABEL[cmd.order]}${target ? ` ${target.name}` : ''}.`);
        if (!opts.queueOnly) await this.runSummonOrders(me);
        break;
      }
      case 'summon-shoulder': {
        if (this.puppet || me.isSummon || (!freeBonus && me.actions.bonus <= 0 && !Dev.infiniteActions)) break;
        const summon = this.mageBySeat(cmd.summon);
        const changed = cmd.carry ? this.gs.carrySummon(me, summon) : this.gs.releaseSummon(me, summon);
        if (!changed) break;
        spend('bonus');
        this.gs.log(cmd.carry ? `${me.name} carries ${summon.name} on their shoulder.` : `${me.name} sets ${summon.name} down.`);
        break;
      }
      case 'uncommand': {
        if (this.puppet) {
          const { owner, savedIndex } = this.puppet;
          this.gs.currentIndex = savedIndex;
          this.puppet = null;
          this.gs.log(`${owner.name} resumes their turn.`);
          this.redraw();
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
      case 'robe-cast': {
        const robe = robeOf(me);
        if (!robe) break;
        spend('bonus');
        await runAction(
          this.gs.makeActionItem({
            source: me,
            label: IMBUES[robe.imbue].robe!.label,
            description: `${me.name} tries ${IMBUES[robe.imbue].name}.`,
            resolve: (game) => game.applyRobeCast(me),
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
      case 'switch-weapon': {
        if (!me.switchWeapon()) break;
        const now = me.activeWeaponId();
        if (now) this.gs.log(`${me.name} now strikes with ${getItem(now).name}.`);
        this.redraw();
        break;
      }
      case 'flee': {
        const edge = fleeEdgeAt(me.pos);
        if (!this.fleeAllowed || !edge || me.crocodileGrip?.alive) break;
        spend('main');
        me.fleeChannel = edge;
        this.gs.log(`${me.name} starts backing toward the ${FLEE_EDGE_LABEL[edge]} edge.`);
        this.redraw();
        break;
      }
      case 'dev': {
        if (!isSharedToggle(cmd.key)) break;
        Dev[cmd.key] = cmd.on === true;
        const label = this.devToggles.find((toggle) => toggle.key === cmd.key)?.label ?? cmd.key;
        this.gs.log(`Cheat: ${label} ${Dev[cmd.key] ? 'on' : 'off'}.`);
        this.refreshDevPanel();
        this.redraw();
        break;
      }
      case 'dev-resources': {
        const target = Number.isInteger(cmd.seat) ? this.gs.mages[cmd.seat] : undefined;
        if (target) writeDevResources(target, cmd.values);
        this.redraw();
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
    const turn = this.turnSerial;
    for (;;) {
      // Its pilot sends nothing more once the turn is over, and a receive left
      // waiting here would swallow the next message meant for someone else.
      if (this.opponentLeft || this.gs.isOver || turn !== this.turnSerial) return;
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

  private async recvSubReroll(): Promise<boolean> {
    const msg = await this.net!.recv();
    const cmd = msg.cmd as SubCommand | undefined;
    return cmd?.t === 'sub-reroll' && cmd.reroll;
  }

  private sendSubReroll(reroll: boolean): void {
    const cmd: SubCommand = { t: 'sub-reroll', reroll };
    this.net?.send({ k: 'sub', cmd });
  }

  private async recvSubOffering(opts: OfferingOpts): Promise<OfferingChoice> {
    const msg = await this.net!.recv();
    const cmd = msg.cmd as SubCommand | undefined;
    if (cmd?.t !== 'sub-offering') return { life: 0, items: false, summons: [] };
    const summons = cmd.summons.map((seat) => this.mageBySeat(seat)).filter((m) => opts.summons.includes(m));
    return { life: Number(cmd.life) || 0, items: cmd.items === true, summons };
  }

  private sendSubOffering(choice: OfferingChoice): void {
    const cmd: SubCommand = {
      t: 'sub-offering',
      life: choice.life,
      items: choice.items,
      summons: choice.summons.map((m) => this.seatOf(m)),
    };
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
      game.log(`${mage.name} cashes out the Gambler's Blade: not enough Greed to pay out.`);
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
    const adventure = this.adventureOnline();
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
    if (adventure) {
      const reason = 'A player left, so the session ended. The host\'s save keeps the run from before this fight.';
      this.showEndCard({
        eyebrow: 'ONLINE ADVENTURE',
        title: 'CONNECTION LOST',
        detail: reason,
        actionLabel: 'RETURN TO MAIN MENU',
        tone: 'warning',
        onActivate: () => {
          AdventureSession.current?.end(reason);
          this.scene.start('Menu', { notice: reason });
        },
      });
      this.redraw();
      return;
    }
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
    // Foreknowledge or a stifle: the action fails the moment it is declared.
    if (this.gs.stopDeclaredAction(initial)) {
      if (initial.kind === 'spell') this.setCharging(initial.source, false);
      this.redraw();
      await this.resolveImpacts();
      return;
    }
    this.gs.pushStack(initial);
    // Subtle decides silence before anyone may answer the cast.
    if (initial.modifiers?.includes('subtle')) await this.rollSubtleSilence(initial);
    // Some spells can never be answered at all.
    if (initial.spell?.unanswerable) initial.silent = true;
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
    if (this.gs.isOver || this.gameEnded) {
      this.mode = 'over';
    } else if (this.mineRun && this.mineExploring) {
      this.mode = 'shop';
    } else if (this.online && !this.isLocalTurn()) {
      // Mid-way through the opponent's relayed turn: stay locked.
      this.mode = 'busy';
    } else if (this.turnStarting) {
      // startTurn hands the turn out once the rest of the turn start is done.
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

  /**
   * Finish a withdrawal started last turn. The escapee must still be alive and
   * still be against a border — dragged back into the open, the attempt lapses.
   * An Adventure party member who leaves while others still stand waits beyond
   * the edge until the fight ends. Returns true when the caller must stop.
   */
  private releaseFlee(me: Mage): boolean {
    const declared = me.fleeChannel;
    me.fleeChannel = undefined;
    if (!declared || !me.alive) return false;
    const edge = fleeEdgeAt(me.pos);
    if (!edge) {
      this.gs.log(`${me.name} fails to escape.`);
      this.redraw();
      return false;
    }
    this.gs.log(`${me.name} escapes over the ${FLEE_EDGE_LABEL[edge]} edge.`);
    playSound('move.dash');
    const othersStand = !!this.explorationCombat &&
      this.gs.mages.some((m) => m.team === me.team && m !== me && !m.isSummon && !m.sceneSide && m.alive);
    if (othersStand) {
      this.withdrawnEdge = edge;
      me.withdrawn = true;
      this.redraw();
      void this.nextTurn();
      return true;
    }
    this.fledEdge = edge;
    this.endGame();
    return true;
  }

  /** Release whatever Channel or Delay parked on this mage's turn start. */
  private async releasePendingCasts(me: Mage): Promise<void> {
    const channeled = me.channeledCast;
    if (channeled && me.alive) {
      me.channeledCast = undefined;
      me.spend('main');
      const aimed = channeled.aimOnRelease ? await this.aimChanneledCast(me, channeled) : channeled;
      if (aimed) {
        this.gs.log(`${me.name} releases the channelled ${channeled.spell.name}.`);
        await this.runStack(
          this.gs.makeSpellItem(
            me,
            channeled.spell,
            aimed.target,
            aimed.point,
            undefined,
            aimed.point2,
            channeled.modifiers
          )
        );
      } else {
        this.gs.log(`${me.name}'s channelled ${channeled.spell.name} has no target and fizzles.`);
      }
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

  /** Choose where a channelled spell lands as it is released (lockstep via the sub-target channel). */
  private async aimChanneledCast(
    me: Mage,
    cast: PendingCast
  ): Promise<Pick<PendingCast, 'target' | 'point' | 'point2'> | null> {
    this.channelAimSpell = cast.spell;
    try {
      return await this.pickChannelAim(me, cast.spell);
    } finally {
      this.channelAimSpell = null;
    }
  }

  private async pickChannelAim(
    me: Mage,
    spell: Spell
  ): Promise<Pick<PendingCast, 'target' | 'point' | 'point2'> | null> {
    this.redraw();
    if (spell.targeting === 'point') {
      const maxRange = this.gs.spellReach(spell, me);
      const pick = (label: string): Promise<Vec2 | null> =>
        this.requestSubtargetPoint(me, {
          maxRange,
          minRange: spell.minRange,
          required: true,
          prompt: `${me.name}: release ${spell.name} — ${label}.`,
        });
      const point = await pick(spell.twoPointAim ? "click the cone's first edge" : 'click a target point');
      if (!point) return null;
      const point2 = spell.twoPointAim ? await pick("click the cone's other edge") : null;
      if (spell.twoPointAim && !point2) return null;
      if (spell.rotatableWall) {
        me.wallAngle = Math.atan2(point.y - me.y, point.x - me.x) + Math.PI / 2;
      }
      return { target: null, point, point2 };
    }
    const picked = await this.requestSubtargetCombatant(me, {
      candidates: this.gs.validSpellTargets(spell, me),
      range: Infinity,
      prompt: `${me.name}: release ${spell.name} — choose a target.`,
    });
    if (!picked) return null;
    const target = this.gs.isFoeBlind(me)
      ? this.gs.randomFoeBlindTarget(me, this.gs.validSpellTargets(spell, me)) ?? picked
      : picked;
    return { target, point: null, point2: null };
  }

  /** Subtle casting: a DC 11 check decides whether the spell makes any sound. */
  private async rollSubtleSilence(item: StackItem): Promise<void> {
    const roll = this.gs.rollD20(item.source);
    this.pendingDice = [
      {
        spec: '1d20',
        total: roll,
        rolls: [roll],
        label: 'Subtle — silent?',
        seq: this.vfxSeq++,
      },
    ];
    item.silent = roll >= 11;
    this.gs.log(
      `${item.source.name} casts subtly: 1d20=${roll} vs DC 11 — ${
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
    opts: { at?: Vec2; description?: string; allies?: boolean } = {}
  ): Promise<void> {
    if (this.gs.isOver || !source.alive) return;
    // These windows answer a synthetic no-op trigger. In the tutorial they are
    // pure noise — a prompt on every turn boundary, with nothing to react to.
    if (this.tutorial) return;
    const trigger = this.gs.makeActionItem({
      source,
      label,
      description: opts.description ?? `${source.name}: ${label}.`,
      resolve: () => {},
    });
    trigger.noPhysicalReaction = true;
    trigger.windowTrigger = true;
    trigger.openToAllies = opts.allies;
    if (opts.at) trigger.targetPoint = opts.at;
    // Skip the window entirely when nobody could answer it — keeps play snappy
    // and avoids exchanging empty reaction messages online. Deterministic on
    // both peers because it reads only shared game state.
    if (!this.reactorsFor(trigger).some((r) => this.reactorCanRespond(r, trigger))) return;
    const prevMode = this.mode;
    const wasBusy = this.busy;
    this.busy = true;
    // Nobody may act while others answer: a stray command would break lockstep online.
    if (prevMode !== 'reaction') this.mode = 'busy';
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
          if (this.gs.stopDeclaredAction(item)) {
            await this.resolveImpacts();
            stackChanged = true;
            break;
          }
          if (choice.spell.unanswerable) item.silent = true;
          this.gs.pushStack(item);
          this.setCharging(reactor, true);
          stackChanged = true;
          break;
        }
        if (choice && choice.dodge) {
          // A dodge rolls to slip aside; on a hit the whole action is negated.
          this.gs.beginMindStormAction(reactor);
          let dodgeTier: DodgeTier;
          try {
            dodgeTier = await this.performDodge(reactor, top);
          } finally {
            this.gs.endMindStormAction();
          }
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
          this.playShieldRaise(reactor, top.source);
          this.redraw();
          passed.add(key);
        } else if (choice && choice.shield === 'bash') {
          // A bash answers the blow, smashing the attacker; the action still lands.
          reactor.reactedThisCycle = true;
          this.gs.beginMindStormAction(reactor);
          try {
            if (this.gs.shieldBash(reactor, top.source)) {
              await this.playShieldBash(reactor, top.source);
            }
          } finally {
            this.gs.endMindStormAction();
          }
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
            this.gs.beginMindStormAction(reactor);
            try {
              await strike.resolve(this.gs);
            } finally {
              this.gs.endMindStormAction();
            }
            await this.playPendingDice();
            void this.flushHits();
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
      if (!top.windowTrigger) this.gs.beginMindStormAction(top.source);
      let resolved: StackItem | null;
      try {
        resolved = await this.resolveTop();
      } finally {
        if (!top.windowTrigger) this.gs.endMindStormAction();
      }
      await this.raisePendingDrakes();
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
    this.gs.counteredItem = null;

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

    // Baral's Artifacts of Denial: an armed one stifles a party action outright;
    // any other party action that gets this far charges them all.
    const stifler = this.gs.stifleByDenial(item);
    if (stifler) {
      if (item.kind === 'spell') this.setCharging(item.source, false);
      await this.playStifle(stifler, item.source);
      return item;
    }
    this.gs.chargeDenial(item);

    // A spell must beat its difficulty: roll 1d20 vs the spell's DC. On a miss
    // the spell fizzles entirely (charges/actions are already spent) and no
    // counter effect triggers. A natural 20 also crits (doubled potency).
    this.gs.critThisCast = false;
    this.gs.spellRollThisCast = 0;
    if (item.kind === 'spell' && item.spell && item.spell.dc) {
      this.pendingDice = [];
      const res = this.rollSpellSuccess(item.spell, item.source, item.modifiers ?? []);
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
        this.gs.counteredItem = target;
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
        this.gs.log(`${item.label} has nothing to delay.`);
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
        `${item.target?.name ?? 'The target'} is gone. ${item.label} misses.`
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
    this.gs.castThroughCaster = item.kind === 'spell' && item.spell && item.spell.words.length > 0 ? item.source : null;
    // Every mid-spell dice flush happens inside resolve, so one flag here holds
    // them all back for a single roll once the spell has played out.
    this.deferDice = diceTiming() === 'after';
    this.pendingDice = [];
    try {
      await item.resolve(this.gs);
    } finally {
      if (item.kind === 'move') {
        const rec = this.mageAnims.get(item.source);
        if (rec?.lock === 'move') {
          rec.lock = null;
          rec.posLocked = false;
        }
      }
    }
    this.deferDice = false;
    this.gs.counteredItem = null;
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
    if (item.spell?.nullifiesHostileStack && this.gs.stack.length > 0) {
      const cancelled = this.gs.cancelHostileStack(item.source.team);
      for (const older of cancelled) {
        if (older.kind === 'spell') this.setCharging(older.source, false);
      }
      if (cancelled.length > 0) {
        this.gs.log(`${item.label} cancels ${cancelled.map((older) => older.label).join(', ')}.`);
      }
    }
    // The crit flag only applies to the cast that rolled it; clear it now so
    // later ticks / effects (which build their own context) are never doubled.
    this.gs.critThisCast = false;
    this.gs.spellRollThisCast = 0;
    this.gs.castPotency = 1;
    this.gs.castSilent = false;
    this.gs.resolvingSpell = null;
    this.gs.castThroughCaster = null;
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
    //    so the hit animation lines up with the actual damage. Await it so a
    //    multi-target burst finishes its cascade before the next item resolves.
    await this.flushHits();
    await this.delay(100);
    return item;
  }

  /** Roll 1d20 against a spell's DC, queue the die for display, and log it. */
  private rollSpellSuccess(
    spell: Spell,
    source: Mage,
    modifiers: readonly WordId[] = []
  ): { ok: boolean; crit: boolean; roll: number } {
    const dc = spellCastDc(spell, source, modifiers);
    // Focus grants advantage on this one cast: roll the DC twice, keep the best.
    const focused = source.focusNextSpell;
    const first = this.gs.rollD20(source);
    const dieSpec = this.gs.rng.consistentSpec('1d20');
    let best = first;
    let naturalRolls = [first];
    if (focused) {
      const second = this.gs.rollD20(source);
      naturalRolls = [first, second];
      if (second > best) best = second;
      source.focusNextSpell = false;
    }
    this.pendingDice.push({
      spec: focused ? `2 x (${dieSpec}) (keep higher)` : dieSpec,
      total: best,
      rolls: naturalRolls,
      label: `${spell.name} — success?${focused ? ' (focus)' : ''}`,
      seq: this.vfxSeq++,
    });
    let ok = Dev.autoSuccess || best >= dc;
    // Luck can turn a near-miss into a hit: spend the minimum needed to reach
    // the DC. Both peers know the roll and the luck pool, so this stays in
    // lockstep without any extra network decision.
    let luckSpent = 0;
    if (!ok && source.luck > 0 && dc - best <= source.luck) {
      luckSpent = source.spendLuck(dc - best);
      ok = true;
    }
    const luckNote = luckSpent > 0 ? ` (+${luckSpent} luck → ${source.luck} left)` : '';
    // A natural 20 on the kept die is a critical: the spell's damage (or its
    // area / duration) is doubled during resolution. Spells flagged noCrit
    // (Life / Hexcraft class variants) succeed on a 20 but never double.
    const crit = ok && best === 20 && !spell.noCrit;
    const rollText = focused
      ? `2 x (${dieSpec})=[${naturalRolls.join(', ')}], kept ${best}`
      : `${dieSpec}=${best}`;
    this.gs.log(
      `${source.name}'s ${spell.name}: ${rollText} vs DC ${dc} — ${ok ? 'success!' : 'fizzles.'}${luckNote}${crit ? ' CRITICAL — natural 20!' : ''}`
    );
    // A failed spell can still pay out through gear (Soul Battery / Locket / Tantrum).
    if (!ok) {
      for (const line of source.onSpellFizzle()) this.gs.log(line);
    }
    return { ok, crit, roll: best };
  }

  /** Reaction spells the reactor could actually cast right now (charges + valid target). */
  private castableReactions(reactor: Mage): Spell[] {
    // Casting a word-spell as a reaction requires at least one blue word and is
    // capped per combat. Delay grants its own reaction to every mage, and the
    // defensive reactions (Dodge/Block/Bash/Needle) are handled separately.
    const blueReact = reactor.canWordSpellReact();
    const forgotten = reactor.forgotten();
    const pool = allSpells(reactor.spellClass).filter(
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
    return getColorAbilitiesFor(reactor.profile.primary, reactor.spellClass, reactor.loadout).filter(
      (ab) =>
        !reactor.isAbilityBanned(ab.id) &&
        reactor.abilityCastsLeft(ab.id) > 0 &&
        this.canAffordAbility(reactor, ab)
    );
  }

  /**
   * Every living enemy of `top.source`, plus its player-controlled teammates,
   * ordered by initiative — the sequence in which they are offered a reaction
   * window against the action.
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
          m !== this.gs.current &&
          m !== turnOwner &&
          (m.team !== top.source.team ||
            (!m.isSummon && (!!top.openToAllies || !this.controllerIsAI(m))))
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
    // Stopped time or stopped reflexes leave nothing to answer with.
    if (this.gs.cannotReact(reactor)) return false;
    // You may never react during your own turn (including while you puppet a
    // summon via Command, when `current` is the summon rather than you).
    if (reactor === this.gs.current) return false;
    if (reactor === this.puppet?.owner) return false;
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
    if (this.gs.isFixedPoint(reactor)) return false;
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
          `${reactor.name}'s Needle of Serenity bans ${src.name}'s ${getItem(ban.itemId).name} permanently.`
        );
      } else {
        src.bannedAbilityIds.add(ban.key);
        this.gs.log(
          `${reactor.name}'s Needle of Serenity bans ${ban.label}. ${src.name} can never use it again.`
        );
      }
    } else if (top.kind === 'spell' && top.spell && this.isColorAbility(top.spell)) {
      src.bannedAbilityIds.add(top.spell.id);
      this.gs.log(
        `${reactor.name}'s Needle of Serenity bans ${top.spell.name}. ${src.name} can never use it again.`
      );
    } else if (top.kind === 'melee') {
      const wid = src.activeWeaponId();
      if (wid) {
        src.bannedItemIds.add(wid);
        this.gs.log(
          `${reactor.name}'s Needle of Serenity bans ${src.name}'s ${getItem(wid).name} permanently.`
        );
      } else {
        src.unarmedBanned = true;
        this.gs.log(
          `${reactor.name}'s Needle of Serenity bans ${src.name}'s unarmed strike permanently.`
        );
      }
    } else {
      this.gs.log(`${reactor.name}'s Needle of Serenity cancels the action.`);
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
        this.gs.log(`${reactor.name} passes.`);
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
      this.gs.log(`${reactor.name} passes.`);
      return null;
    }
    // Online: the opponent's reaction arrives over the wire; ours is relayed.
    if (this.online && !this.isLocalDecider(reactor)) {
      this.showReactionTelegraph(top);
      this.flashHint(`Waiting for ${reactor.name} to react\u2026`, true, 'info');
      const msg = await this.net!.recv();
      this.clearReactionTelegraph();
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
    const keys = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN'];
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
          else this.onSwitchWeapon();
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
            if (this.invPanel instanceof InventoryView && this.invPanel.consumeEscape()) return;
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
            this.devResources.close();
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
      if (!this.devPanel.visible) this.devResources.close();
    });

    // Right-click opens the action menu, so suppress the browser context menu.
    controls.disableContextMenu();

    controls.bindPointerMove((p) => {
      this.pointer = { x: p.worldX, y: p.worldY };
      this.updateHover();
      if (this.mode.startsWith('aiming') || this.mode.startsWith('subtarget')) this.redraw();
    });
    controls.bindPointerPress({
      press: (p) => this.onPointerDown(p),
      // Touch has no right button, so a long press opens the action menu.
      longPress: () => {
        if (this.actionMenu) return false;
        this.toggleActionMenu();
        return !!this.actionMenu;
      },
    });
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
    if (!this.online) return this.actor;
    // Steering a summon: its actions are the ones being spent, so show them, not the owner's.
    const puppet = this.puppet?.summon;
    return puppet && !this.reactor && this.isLocalDecider(puppet) ? puppet : this.localMage();
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
      !this.reactionAiming &&
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
    this.tutorialNotify({ k: 'combo', words: this.selectedWords() });
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
    if (!stormWordsCompatible(words)) return undefined;
    const { base, modifiers } = splitModifiers(words);
    // Delay is the one modifier that is also a spell in its own right.
    if (base.length === 0) {
      return modifiers.length === 1 && modifiers[0] === 'delay'
        ? getSpell(['delay'], this.viewMage.spellClass)
        : undefined;
    }
    return spellForSelection(words, this.viewMage.spellClass);
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
      this.flashHint(spell.words.length === 1 && spell.words[0] === 'storm'
        ? 'Storm is empty: cast a pair first.'
        : spell.words.includes('storm') && me.stormDualcastsUsed >= 3
          ? 'No Storm dualcasts left today.'
          : 'Not enough charges.');
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

    // A channelled spell is aimed when it is released, not now.
    if (spell.targeting === 'self' || spell.targeting === 'none' || mods.includes('channel')) {
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
    const me = this.gs.current;
    if (me.moveRange() < 1) {
      return this.flashHint(me.overloaded()
        ? `Too heavy to move: carrying ${me.carriedWeight().toFixed(1)}/${me.carryCap()} kg. Drop something first.`
        : 'No movement left this turn.');
    }
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
    this.flashHint('Leap: click a direction.', true);
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
      return this.flashHint('The Wings are banned.');
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
    this.flashHint('Click a direction to swing your 180° cleave.', false, 'info');
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
    const commandable = this.gs.summonsOf(me).filter((s) => this.gs.canCommandSummon(me, s));
    if (commandable.length === 0) return this.flashHint('You have no summons to command.');
    const summons = commandable.filter((s) => s.summonActedSeq !== this.gs.turnSeq);
    if (summons.length === 0) return this.flashHint('Each summon can be controlled only once per turn.');
    if (me.actions.bonus <= 0 && !Dev.infiniteActions && !me.freeSummonOrders)
      return this.flashHint('Command needs a bonus action.');
    const summon = this.pickCommandSummon(summons);
    this.submitTurn({ t: 'command', summon: this.seatOf(summon) });
    const extra = summons.length > 1 ? ' (the one nearest your cursor)' : '';
    this.flashHint(
      `Commanding ${summon.name}${extra}. E: release.`,
      true
    );
    this.redraw();
  }

  /** Shout one standing order to every summon you can command (bonus action). */
  private beginShout(order: SummonOrderKind): void {
    if (this.mode === 'reaction') return;
    if (!this.humanActive || this.mode !== 'idle' || this.puppet) return;
    if (this.online && !this.isLocalTurn()) return;
    const me = this.gs.current;
    if (!this.gs.summonsOf(me).some((s) => this.gs.canCommandSummon(me, s)))
      return this.flashHint('You have no summons to command.');
    if (me.actions.bonus <= 0 && !Dev.infiniteActions && !me.freeSummonOrders)
      return this.flashHint('Ordering all summons needs a bonus action.');
    if (order === 'attack') {
      this.pendingSpell = null;
      this.mode = 'aiming-shout';
      this.flashHint('Click the enemy your summons should attack. Esc cancels.', false, 'info');
      this.redraw();
      return;
    }
    this.mode = 'busy';
    this.submitTurn({ t: 'shout', order });
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

  /** Why `me` cannot use a banned item. */
  private bannedItemHint(me: Mage): string {
    return me.itemsSacrificed() ? 'Your items are held by the Shikigami until the day ends.' : 'That item is banned.';
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
    if (me.isItemBanned(itemId)) return this.flashHint(this.bannedItemHint(me));
    if (me.swordFormLocked()) return this.flashHint('Locked in sword form — cannot throw.');
    if (me.actions.bonus <= 0 && !Dev.infiniteActions)
      return this.flashHint('Throwing takes a bonus action.');
    if (!me.utility.includes(itemId) && !me.pouch.includes(itemId)) return this.flashHint('Nothing to throw.');
    if (!me.pouch.includes(itemId) && me.readyConsumable !== itemId) {
      this.closeInventory();
      this.resetSelection();
      this.submitTurn({ t: 'item-ready', itemId });
      return;
    }
    this.closeInventory();
    this.throwPendingItem = itemId;
    this.pendingSpell = null;
    this.mode = 'aiming-throw';
    this.flashHint('Click an enemy within throwing range.', false, 'info');
    this.redraw();
  }

  /** Throw the first throwable item carried (bound to [T]). */
  private beginThrowFirst(): void {
    if (!this.humanActive) return;
    const me = this.gs.current;
    const itemId = [...me.pouch, ...me.utility].find((id) => getItem(id).throwable && !me.isItemBanned(id));
    if (!itemId) return this.flashHint('Nothing to throw.');
    this.beginThrow(itemId);
  }

  /** Why `me` cannot loose `hex` now, or null. */
  private hexBlocked(me: Mage, hex: HexRecipe): string | null {
    const cost = hexManaCost(hex);
    if (me.mana < cost) return `Casting it takes ${cost} mana.`;
    if (Dev.infiniteActions) return null;
    const action = hexAction(hex);
    if (action === 'bonus') return me.actions.bonus > 0 ? null : 'It needs a bonus action.';
    if (me.actions.main <= 0) return action === 'full' ? 'It needs your main and bonus action.' : 'It needs a main action.';
    return action === 'full' && me.actions.bonus <= 0 ? 'It needs your main and bonus action.' : null;
  }

  /** Loose a Hexzettel: aim it as its target rune asks, or loose it at once. */
  private beginHex(itemId: ItemId): void {
    if (this.mode === 'reaction' || !this.humanActiveOrInventory) return;
    const me = this.gs.current;
    const hex = me.utility.includes(itemId) ? hexOf(itemId) : undefined;
    if (!hex) return this.flashHint('No such hex sheet.');
    if (me.isItemBanned(itemId)) return this.flashHint(this.bannedItemHint(me));
    if (me.swordFormLocked()) return this.flashHint('The bound greatshield locks your bag — swap to shield form first.');
    const blocked = this.hexBlocked(me, hex);
    if (blocked) return this.flashHint(blocked);
    this.closeInventory();
    this.resetSelection();
    const aim = hexAim(hex);
    if (aim !== 'none') {
      const reach = Math.round(hexRange(hex) / RANGE_UNIT);
      this.hexPending = itemId;
      this.mode = 'aiming-hex';
      this.flashHint(`${getItem(itemId).name}: click ${aim === 'unit' ? 'a unit' : 'a point'} within ${reach}cm.`, false, 'info');
      this.redraw();
      return;
    }
    const problem = hexAimProblem(this.gs, me, hex, { target: null, point: null });
    if (problem) return this.flashHint(problem);
    this.mode = 'busy';
    this.submitTurn({ t: 'hex', itemId, target: null });
  }

  private pendingHex(): HexRecipe | undefined {
    return this.hexPending ? hexOf(this.hexPending) : undefined;
  }

  private pendingHexAim(): HexAimKind | null {
    const hex = this.pendingHex();
    return hex ? hexAim(hex) : null;
  }

  /** Loose the aimed Hexzettel at a unit or a point, as its first target rune asks. */
  private aimHex(at: Vec2, unit: Mage | null): void {
    const itemId = this.hexPending;
    const hex = this.pendingHex();
    if (!itemId || !hex) return;
    const me = this.gs.current;
    if (hexAim(hex) === 'unit') {
      const problem = unit ? hexAimProblem(this.gs, me, hex, { target: unit, point: null }) : 'Click a unit.';
      if (problem || !unit) return this.flashHint(problem ?? 'Click a unit.');
      this.hexPending = null;
      this.mode = 'busy';
      this.submitTurn({ t: 'hex', itemId, target: this.seatOf(unit) });
      return;
    }
    const point = stepTowards(me.pos, at, hexRange(hex));
    this.hexPending = null;
    this.mode = 'busy';
    this.submitTurn({ t: 'hex', itemId, target: null, x: point.x, y: point.y });
  }

  private shakeEdgelordLantern(): void {
    if (this.mode === 'reaction' || !this.humanActive) return;
    const me = this.gs.current;
    if (!me.hasEdgelordLantern()) return;
    if (me.isItemBanned('edgelordLantern'))
      return this.flashHint('The Edgelord Lantern is banned.');
    if (me.actions.bonus <= 0 && !Dev.infiniteActions)
      return this.flashHint('Shaking the lantern needs a bonus action.');
    if (!me.edgelordLanternActive && this.gs.edgelordCaptives(me).length > 0)
      return this.flashHint('The lantern cannot activate while a creature is inside.');
    if (!me.edgelordLanternActive && me.mana < 4)
      return this.flashHint('Activating the lantern costs 4 mana.');
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
      return this.flashHint('Deactivate the Edgelord Lantern before throwing it.');
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

  /** A staff bolt: pick the foe it flies at. */
  private beginStaffBolt(itemId: ItemId, index: number): void {
    if (!this.humanActive) return;
    const me = this.gs.current;
    const bolt = getItem(itemId).staffBolts?.[index];
    if (!bolt || !me.hands.includes(itemId)) return;
    if (me.actions.main <= 0 && !Dev.infiniteActions) return this.flashHint('A staff bolt is a main action.');
    if (me.mana < bolt.mana) return this.flashHint(`${bolt.label} needs ${bolt.mana} mana.`);
    this.resetSelection();
    this.pendingSpell = null;
    this.staffPending = { item: itemId, bolt: index };
    this.mode = 'aiming-staff';
    this.flashHint(`Click a foe within ${Math.round(bolt.rangePx / RANGE_UNIT)}cm.`, false, 'info');
    this.redraw();
  }

  /** Can `me` loose bolt `index` of held staff `itemId` at `foe` right now? */
  private canStaffBoltAt(me: Mage, itemId: ItemId, index: number, foe: Mage): boolean {
    const bolt = getItem(itemId).staffBolts?.[index];
    return !!bolt && foe.alive && foe.team !== me.team && !this.gs.isUntargetable(foe, me) &&
      dist(me.pos, foe.pos) <= bolt.rangePx;
  }

  /** Mantle of Eldritch Truth: open the Attack / Defend / Restore menu. */
  private beginEldritch(): void {
    if (this.mode === 'reaction') return;
    if (!this.humanActive) return;
    const me = this.gs.current;
    if (!me.hasEldritchMantle()) return;
    if (me.isActionBanned('eldritch'))
      return this.flashHint('Eldritch Truth is banned.');
    if (me.actions.main <= 0 && !Dev.infiniteActions)
      return this.flashHint('Eldritch is a main action.');
    this.buildEldritchMenu();
  }

  private onEldritchChoice(choice: 'attack' | 'defend' | 'restore'): void {
    this.hideEldritchMenu();
    if (choice === 'attack') {
      this.pendingSpell = null;
      this.mode = 'aiming-eldritch';
      this.flashHint('Click any enemy.', false, 'info');
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
      'Choose one this turn.', [
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
        return this.flashHint('Charge Up is banned.');
      this.mode = 'busy';
      this.submitTurn({ t: 'thunder-charge' });
      return;
    }
    if (me.isActionBanned('thunder-discharge'))
      return this.flashHint('Discharge is banned.');
    if (me.thunderStacks <= 0) return this.flashHint('No Thunder stacks to discharge.');
    this.pendingSpell = null;
    this.mode = 'aiming-discharge';
    this.flashHint('Click a target to arc lightning into.', false, 'info');
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
      'Charge up, or release every stack.', [
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
      this.gs.canCastSpellNow(spell) &&
      (spell.actionType === 'main' ? me.actions.main : me.actions.bonus) > 0;
    entries.push({
      id: 'cast',
      label: spell ? `Cast ${spell.name}` : 'Cast spell',
      hotkey: '1–4 / Enter',
      desc: spell
        ? `${spell.actionType} action · ${this.spellManaCost(me, spell)} mana`
        : 'No spell selected.',
      enabled: !!spell && (affordSpell || inf) && !me.hasCastThisTurn && !me.blocksCasting(),
      reason: !spell
        ? 'Select a valid word combination first.'
        : me.hasCastThisTurn
          ? 'Already cast a spell this turn.'
          : me.blocksCasting()
            ? 'Both hands full — drop an item to cast.'
            : 'Not enough charges / mana / actions.',
      run: () => this.onCast(),
    });

    // Colour abilities (one entry each).
    getColorAbilitiesFor(me.profile.primary, me.spellClass, me.loadout).forEach((ab, i) => {
      const left = me.abilityCastsLeft(ab.id);
      entries.push({
        id: `ability-${ab.id}`,
        label: `Cast ${ab.name}`,
        hotkey: i === 0 ? 'Z' : i === 1 ? 'X' : '—',
        desc: `Colour ability · ${this.abilityChargeCost(me, ab)}c / ${this.abilityManaCost(me, ab)}m · ${left} left this combat`,
        enabled:
          this.canAffordAbility(me, ab) &&
          (me.actions.bonus > 0 || inf || !!ab.freeAction) &&
          !me.isAbilityBanned(ab.id) &&
          left > 0,
        reason: me.isAbilityBanned(ab.id)
          ? 'Banned.'
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
      enabled: (atkPool > 0 || inf) && !me.hasForgotten('melee') && !outOfArrows,
      reason: me.hasForgotten('melee')
        ? 'Forgotten how to fight this turn.'
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
      desc: `Jump a d6 distance in any direction · ${me.leapsLeft()} left this combat.`,
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

    // Hexzettel (the first carried; the inventory holds the rest).
    const hexId = me.utility.find((id) => !!hexOf(id) && !me.isItemBanned(id));
    const hex = hexId ? hexOf(hexId) : undefined;
    if (hexId && hex) {
      const blocked = this.hexBlocked(me, hex);
      entries.push({
        id: 'hex',
        label: `Cast ${getItem(hexId).name}`,
        hotkey: '—',
        desc: `${{ main: 'Main', bonus: 'Bonus', full: 'Main + bonus' }[hexAction(hex)]} action · ${hexManaCost(hex)} mana. More in the inventory.`,
        enabled: !blocked && !me.swordFormLocked(),
        reason: me.swordFormLocked() ? 'Locked in sword form.' : blocked ?? '',
        run: () => this.beginHex(hexId),
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
        label: me.edgelordLanternActive ? 'Deactivate Edgelord Lantern' : 'Activate Edgelord Lantern',
        hotkey: 'K',
        desc: me.edgelordLanternActive
          ? 'Pull nearby units and capture afflicted creatures near death.'
          : 'Pay 4 mana; give 3 Soul Rend to every unit within 15cm.',
        enabled: canShake,
        reason: me.isItemBanned('edgelordLantern')
          ? 'Banned.'
          : me.actions.bonus <= 0 && !inf
            ? 'Needs a bonus action.'
            : !me.edgelordLanternActive && captives > 0
              ? 'A living creature is still inside.'
              : 'Activating costs 4 mana.',
        run: () => this.shakeEdgelordLantern(),
      });
      entries.push({
        id: 'edgelord-throw',
        label: `Throw Edgelord Lantern (${captives} inside)`,
        hotkey: throwId ? 'Menu' : 'T',
        desc: 'Spend all actions and reaction; blast a 5cm radius within Strength cm.',
        enabled: this.canUseEdgelordThrow(me) && me.effectiveStr() > 0,
        reason: me.edgelordLanternActive
          ? 'Deactivate it first.'
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
        label: 'Eldritch Truth',
        hotkey: 'Q',
        desc: 'Attack / Defend / Restore (main action).',
        enabled: (me.actions.main > 0 || inf) && !me.isActionBanned('eldritch'),
        reason: me.isActionBanned('eldritch') ? 'Banned.' : 'Needs a main action.',
        run: () => this.beginEldritch(),
      });
    }

    // Staffs: each bolt a held staff carries is a main action of its own.
    for (const itemId of me.staffBoltItems()) {
      const def = getItem(itemId);
      (def.staffBolts ?? []).forEach((bolt, index) => {
        const count = bolt.targets ?? 1;
        const reach = this.gs.mages.some((foe) => this.canStaffBoltAt(me, itemId, index, foe));
        entries.push({
          id: `staff:${itemId}:${index}`,
          label: `${def.name}: ${bolt.label}`,
          hotkey: 'Menu',
          desc: `Main action, ${bolt.mana} mana: ${staffDice(me.effectiveInt(), bolt)}d${bolt.sides} ${bolt.type} to ${count > 1 ? `up to ${count} foes` : 'one foe'} within ${Math.round(bolt.rangePx / RANGE_UNIT)}cm.`,
          enabled: (me.actions.main > 0 || inf) && me.mana >= bolt.mana && reach,
          reason: me.actions.main <= 0 && !inf ? 'Needs a main action.' : me.mana < bolt.mana ? `Needs ${bolt.mana} mana.` : 'No foe in reach.',
          run: () => this.beginStaffBolt(itemId, index),
        });
      });
    }

    if (this.raid && this.raidPrepActive) {
      entries.push({
        id: 'raid-restore-vitals',
        label: 'Restore health & sanity',
        hotkey: 'Free',
        desc: `Refill health and sanity (${me.hp}/${me.maxHp} HP, ${me.sanity}/${me.maxSanity} sanity). Costs no action.`,
        enabled: me.hp < me.maxHp || me.sanity < me.maxSanity,
        reason: 'Already at full health and sanity.',
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
        label: `Summon ${raidTargetName(this.raidBoss)}`,
        hotkey: 'Menu',
        desc: 'End preparation and start the fight. Gear, stacks and buffs carry over.',
        enabled: true,
        run: () => this.requestRaidBossFight(),
      });
    }

    if (me.hasDeathsAngelWings()) {
      entries.push({
        id: 'deaths-angel-wings',
        label: me.deathsAngelFlightTurns > 0 ? 'Extend Deaths Angel Wings' : 'Use Deaths Angel Wings',
        hotkey: 'S',
        desc: `${me.deathsAngelEnergy} Energy · ${me.deathsAngelFlightTurns} flight turns · spend 1 for +2 turns.`,
        enabled:
          (me.actions.bonus > 0 || inf) &&
          me.deathsAngelEnergy > 0 &&
          !me.isItemBanned('deathsAngelWings'),
        reason: me.isItemBanned('deathsAngelWings')
          ? 'Banned.'
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

    // Veil robe: a weaker spell as a bonus action that works half the time.
    const robe = robeOf(me);
    if (robe) {
      const def = IMBUES[robe.imbue];
      entries.push({
        id: 'robe-cast',
        label: def.robe!.label,
        hotkey: 'Menu',
        desc: `50%: ${def.robe!.text} (${robe.charges} uses left; a failed try still spends one.)`,
        enabled: me.actions.bonus > 0 || inf,
        reason: 'Needs a bonus action.',
        run: () => this.submitTurn({ t: 'robe-cast' }),
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

    // Withdraw from the field entirely, by whichever border you are standing on.
    if (this.fleeAllowed) {
      const edge = fleeEdgeAt(me.pos);
      entries.push({
        id: 'flee',
        label: edge ? `Flee ${FLEE_EDGE_LABEL[edge]}` : 'Flee',
        hotkey: 'F',
        desc: edge
          ? `Back away over the ${FLEE_EDGE_LABEL[edge]} edge. Takes your main action; you are gone at the start of your next turn.`
          : 'Reach the edge of the field first.',
        enabled: !!edge && !me.fleeChannel && (me.actions.main > 0 || inf),
        reason: !edge
          ? 'You are not at the edge of the field.'
          : me.fleeChannel
            ? 'Already withdrawing.'
            : 'Needs a main action.',
        run: () => this.submitTurn({ t: 'flee' }),
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

    // Choose which held weapon the basic attack uses.
    if (me.canSwitchWeapon()) {
      const activeId = me.activeWeaponId();
      entries.push({
        id: 'switch-weapon',
        label: 'Switch weapon',
        hotkey: 'W',
        desc: `Strike with your other held weapon instead (free). Now: ${activeId ? getItem(activeId).name : 'none'}.`,
        enabled: !me.swordFormLocked(),
        reason: 'Locked in sword form.',
        run: () => this.onSwitchWeapon(),
      });
    }

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
      const room = me.hasFreeHand() && me.canCarry(getItem(drop.itemId).weight);
      const exchange = !room && [...new Set([...me.hands, ...me.bag, ...me.utility])]
        .some((id) => this.gs.canSwapDroppedItem(me, drop.id, id));
      entries.push({
        id: 'pickup',
        label: `Pick up ${getItem(drop.itemId).name}`,
        hotkey: 'H',
        desc: 'Retrieve a nearby item; exchange something carried if you need room (bonus action).',
        enabled: (me.actions.bonus > 0 || inf) && (room || exchange) && !me.swordFormLocked() && !summonFull,
        reason: summonFull
          ? 'A summon can carry only one item.'
          : !room && !exchange
            ? 'No carried item can make room.'
            : me.swordFormLocked()
              ? 'Sword form locks your bag.'
              : 'Needs a bonus action.',
        run: () => this.onPickUpItem(),
      });
    }

    // Command a summon (bonus action).
    if (!this.puppet) {
      const owned = this.gs.summonsOf(me);
      const carried = owned.filter((summon) => summon.summonShoulder != null).length;
      for (const summon of owned) {
        const riding = summon.summonShoulder != null;
        const inReach = dist(me.pos, summon.pos) <= MELEE_RANGE + summon.bodyRadius();
        entries.push({
          id: `summon-shoulder:${this.seatOf(summon)}`,
          label: riding ? `Set down ${summon.name}` : `Carry ${summon.name}`,
          hotkey: 'Menu',
          desc: riding ? 'Return to the field (bonus action).' : 'Ride on your shoulder, protected and unable to act (bonus action).',
          enabled: (me.actions.bonus > 0 || inf) && (riding || this.gs.canCarrySummon(me, summon)),
          reason: !riding && carried >= 2 ? 'Both shoulders are occupied.' : !riding && !inReach ? 'Get closer to pick up this summon.' : 'Needs a bonus action.',
          run: () => this.submitTurn({ t: 'summon-shoulder', summon: this.seatOf(summon), carry: !riding }),
        });
      }
      const summons = this.gs.summonsOf(me).filter((s) => this.gs.canCommandSummon(me, s));
      if (summons.length > 0) {
        const ready = summons.filter((s) => s.summonActedSeq !== this.gs.turnSeq);
        const canPay = me.actions.bonus > 0 || inf || me.freeSummonOrders;
        entries.push({
          id: 'command',
          label: summons.length === 1 ? `Command ${summons[0].name}` : 'Command summon',
          hotkey: 'U',
          desc: 'Take control of one of your summons for its move and attack, once per turn (bonus action).',
          enabled: canPay && ready.length > 0,
          reason: ready.length === 0 ? 'Each summon can be controlled only once per turn.' : 'Needs a bonus action.',
          run: () => this.beginCommand(),
        });
        for (const order of ['return', 'flee', 'attack', 'anyone'] as const) {
          entries.push({
            id: `shout:${order}`,
            label: `Order All: ${SHOUT_LABEL[order]}${order === 'attack' ? ' TARGET' : ''}`,
            hotkey: 'Menu',
            desc: SHOUT_DESC[order],
            enabled: canPay,
            reason: 'Needs a bonus action.',
            run: () => this.beginShout(order),
          });
        }
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
      desc: 'Permanently ban the incoming ability or weapon strike.',
      enabled: this.canNeedle(reactor, top),
      reason: 'Nothing here can be banned.',
      run: () => this.chooseNeedleReaction(),
    });

    // Defensive reactions — available to any mage with the gear or stamina,
    // but only against an actual attack (never an end-of-turn or blink trigger).
    const physical = !top.noPhysicalReaction && this.isIncomingAttack(top, reactor);
    entries.push({
      id: 'block',
      label: 'Block',
      hotkey: 'B',
      desc: 'Block the incoming attack with your shield.',
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
      desc: 'Spend a dodge to try to avoid the attack.',
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
  /** The hamburger: the only pointer route to the pause menu. */
  private buildMenuButton(): void {
    const hit = this.add
      .rectangle(TOP_MENU.x, TOP_MENU.y, TOP_MENU.w, TOP_MENU.h, MENU_COLOR.woodDeep, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(1, MENU_COLOR.brassDark)
      .setDepth(46)
      .setInteractive({ useHandCursor: true });
    const bars = this.add.graphics().setDepth(47);
    const paint = (color: number): void => {
      bars.clear().fillStyle(color, 1);
      for (let i = 0; i < 3; i++) {
        bars.fillRect(TOP_MENU.x + 8, TOP_MENU.y + 8 + i * 7, TOP_MENU.w - 16, 3);
      }
    };
    paint(MENU_COLOR.brassLight);
    hit.on('pointerover', () => paint(MENU_COLOR.bone));
    hit.on('pointerout', () => paint(MENU_COLOR.brassLight));
    hit.on('pointerdown', () => {
      this.menuClickGuard = true;
      this.openPause();
    });
  }

  /** A right-aligned brass button on the hint bar, styled like the actions one. */  private hintBarButton(
    rightX: number,
    width: number,
    label: string,
    onDown: () => void,
  ): Phaser.GameObjects.Text {
    const button = this.add
      .text(rightX, centerY(HINT_BAR), label, {
        fontFamily: MENU_FONT.control,
        fontSize: '14px',
        color: MENU_HEX.ink,
        backgroundColor: MENU_HEX.brassLight,
        fontStyle: 'bold',
        align: 'center',
        fixedWidth: width,
        padding: { x: 10, y: 5 },
      })
      .setOrigin(1, 0.5)
      .setDepth(46)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });
    button.on('pointerover', () => button.setBackgroundColor(MENU_HEX.bone));
    button.on('pointerout', () => button.setBackgroundColor(MENU_HEX.brassLight));
    button.on('pointerdown', () => {
      this.menuClickGuard = true;
      onDown();
    });
    return button;
  }

  private toggleActionMenu(): void {    if (this.actionMenu) {
      this.hideActionMenu();
      return;
    }
    const isReaction = this.mode === 'reaction';
    // Only openable on your own turn, or during your reaction window.
    if (!isReaction && !(this.mode === 'idle' && this.humanActive)) return;
    this.actionMenuReturn = isReaction ? 'reaction' : 'idle';
    this.tutorialNotify({ k: 'panel', panel: 'action-menu' });
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
      const entries = group.ids.flatMap((id) => raw.filter((entry) =>
        id.endsWith('*') ? entry.id.startsWith(id.slice(0, -1)) : id === entry.id));
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
      isPinned: (id) => this.pinnedActions.has(id),
      onTogglePin: (id) => this.togglePinnedAction(id),
    });
    this.actionMenuRowsPerColumn = this.actionMenu.rowsPerColumn;
    this.refreshActionMenuSelection();
  }

  private togglePinnedAction(id: string): boolean {
    if (this.pinnedActions.has(id)) this.pinnedActions.delete(id);
    else this.pinnedActions.add(id);
    try {
      localStorage.setItem(PINNED_ACTIONS_KEY, JSON.stringify([...this.pinnedActions]));
    } catch {
      // Storage may be unavailable (private mode); pins then last for the session.
    }
    return this.pinnedActions.has(id);
  }

  /** Pinned actions down the left edge of the field, clickable whenever the local player can act. */
  private refreshPinnedPanel(): void {
    const reacting = this.mode === 'reaction' && !!this.reactor && !this.controllerIsAI(this.reactor);
    const myTurn = this.mode === 'idle' && this.humanActive && !this.controllerIsAI(this.gs.current);
    const entries = this.pinnedActions.size === 0 || this.gs.isOver || (!reacting && !myTurn)
      ? []
      : (reacting ? this.reactionActionEntries() : this.turnActionEntries())
        .filter((entry) => this.pinnedActions.has(entry.id));
    const signature = entries.map((e) => `${e.id}|${e.label}|${e.hotkey}|${e.enabled}`).join('\n');
    if (signature === this.pinnedSignature && this.pinnedPanel?.active) {
      this.pinnedPanel.setData('entries', entries);
      return;
    }
    this.pinnedSignature = signature;
    this.pinnedPanel?.destroy();
    this.pinnedPanel = undefined;
    if (entries.length === 0) return;

    const width = 190;
    const rowH = 26;
    const panel = this.add.container(FIELD.x + SPACE.sm, FIELD.y + 48).setDepth(45);
    panel.setData('entries', entries);
    entries.forEach((entry, i) => {
      const y = i * (rowH + 4);
      const bg = this.add.rectangle(0, y, width, rowH, MENU_COLOR.charcoalRaised, entry.enabled ? 0.92 : 0.6)
        .setOrigin(0)
        .setStrokeStyle(1, MENU_COLOR.brassDark, 1);
      const accent = this.add.rectangle(0, y, 3, rowH, MENU_COLOR.brass, entry.enabled ? 1 : 0.4).setOrigin(0);
      const label = this.add.text(9, y + rowH / 2, `\u2605 ${entry.label}`, {
        fontFamily: MENU_FONT.control,
        fontSize: '11px',
        fontStyle: 'bold',
        color: entry.enabled ? MENU_HEX.bone : MENU_HEX.disabled,
      }).setOrigin(0, 0.5);
      const key = this.add.text(width - 6, y + rowH / 2, entry.hotkey, {
        fontFamily: MENU_FONT.control,
        fontSize: '10px',
        color: MENU_HEX.brassLight,
      }).setOrigin(1, 0.5);
      const room = width - key.width - 20;
      for (let n = entry.label.length - 1; label.width > room && n > 3; n--) {
        label.setText(`\u2605 ${entry.label.slice(0, n)}\u2026`);
      }
      panel.add([bg, accent, label, key]);
      bg.setInteractive({ useHandCursor: entry.enabled });
      bg.on('pointerover', () => { if (entry.enabled) bg.setFillStyle(MENU_COLOR.woodRaised, 1); });
      bg.on('pointerout', () => bg.setFillStyle(MENU_COLOR.charcoalRaised, entry.enabled ? 0.92 : 0.6));
      bg.on('pointerdown', () => {
        this.menuClickGuard = true;
        // Use the newest entry: this closure may predate the latest redraw.
        const live = (panel.getData('entries') as ActionEntry[]).find((e) => e.id === entry.id);
        if (!live?.enabled) {
          playSound('ui.deny');
          if (live?.reason) this.flashHint(live.reason, true);
          return;
        }
        playSound('ui.click');
        live.run();
      });
    });
    this.pinnedPanel = panel;
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
        this.flashHint('This choice is required.', true);
        return;
      }
      this.flashHint('Sub-target skipped.', false, 'info');
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
      this.flashHint('Reaction — [1-5]+Enter to cast, or Space/E to pass.', false, 'info');
      this.redraw();
      return;
    }
    this.pendingSpell = null;
    this.pendingAbility = null;
    this.pendingFirstPoint = null;
    this.aimingSource = null;
    this.throwPendingItem = null;
    this.hexPending = null;
    this.mode = 'idle';
    this.redraw();
  }

  private onEndTurn(): void {
    if (this.mode === 'reaction') {
      this.onReactionPass();
      return;
    }
    if (!this.humanActive || this.busy) return;
    if (this.online && (!this.isLocalTurn() || this.reactionAiming)) return;
    // While commanding a summon, "End turn" instead releases the puppet and
    // returns control to the owner (whose own turn is still in progress).
    if (this.puppet) {
      this.submitTurn({ t: 'uncommand' });
      return;
    }
    this.resetSelection();
    this.mode = 'busy';
    this.tutorialNotify({ k: 'command', cmd: 'end' });
    if (this.online) this.net?.send({ k: 'turn', cmd: { t: 'end' } satisfies TurnCommand });
    void this.nextTurn();
  }

  /** Drop a held item to the ground to free a hand slot (bonus action). */
  private onSwitchWeapon(): void {
    if (this.mode !== 'idle' || !this.humanActive) return;
    const me = this.gs.current;
    if (!me.canSwitchWeapon()) return this.flashHint('You need two different weapons in hand to switch.');
    if (me.swordFormLocked()) return this.flashHint('Locked in sword form.');
    this.submitTurn({ t: 'switch-weapon' });
  }

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
    if (me.actions.bonus <= 0 && !Dev.infiniteActions)
      return this.flashHint('Picking up an item needs a bonus action.');
    const drop = this.gs.nearestDropFor(me);
    if (!drop) return this.flashHint('No dropped item of yours within reach.');
    if (me.summonItemLimited(drop.itemId))
      return this.flashHint('A summon can carry only one item.');
    if (!me.hasFreeHand() || !me.canCarry(getItem(drop.itemId).weight)) {
      const candidates = [...new Set([...me.hands, ...me.bag, ...me.utility])]
        .filter((id) => this.gs.canSwapDroppedItem(me, drop.id, id));
      if (!candidates.length) return this.flashHint('No item can be dropped to make room for this pickup.');
      const dismiss = (): void => {
        this.pickupMenu?.destroy();
        this.pickupMenu = undefined;
        this.mode = 'idle';
        this.redraw();
      };
      this.mode = 'pickup-menu';
      this.pickupMenu = new PagedChoiceMenuView(this, 'MAKE ROOM FOR THE PICKUP',
        `Pick up ${getItem(drop.itemId).name} (${getItem(drop.itemId).weight} kg). Choose an item to leave at your feet.`,
        candidates.map((id) => ({ id, label: getItem(id).name, detail: `${getItem(id).weight} kg  /  Drop one and pick up ${getItem(drop.itemId).name}` })),
        (discard) => {
          dismiss();
          this.resetSelection();
          this.submitTurn({ t: 'item-pickup-swap', dropId: drop.id, discard });
        }, dismiss);
      this.redraw();
      return;
    }
    this.resetSelection();
    this.submitTurn({ t: 'item-pickup', dropId: drop.id });
  }

  /** Consume a specific utility item (bonus action), chosen from the inventory. */
  private consumeItem(itemId: ItemId): void {
    if (!this.humanActiveOrInventory) return;
    const me = this.gs.current;
    if (me.isItemBanned(itemId)) return this.flashHint(this.bannedItemHint(me));
    if (me.swordFormLocked())
      return this.flashHint('The bound greatshield locks your bag — swap to shield form first.');
    if ((!me.utility.includes(itemId) && !me.pouch.includes(itemId)) || !getItem(itemId).potion) return;
    const potion = getItem(itemId).potion;
    if (potion === 'mana' && me.mana >= me.maxMana)
      return this.flashHint('Your mana is already full.');
    if (potion === 'health' && me.hp >= me.maxHp)
      return this.flashHint('Your health is already full.');
    if (me.actions.bonus <= 0 && !Dev.infiniteActions)
      return this.flashHint('Consuming an item needs a bonus action.');
    if (!me.pouch.includes(itemId) && me.readyConsumable !== itemId) {
      this.closeInventory();
      this.resetSelection();
      this.submitTurn({ t: 'item-ready', itemId });
      return;
    }
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

  /** Equip a bag item into its own slot (bonus action), swapping out what is in the way. */
  private equipItem(itemId: ItemId, replace?: ItemId, hand?: 'main' | 'off'): void {
    if (!this.humanActiveOrInventory) return;
    const me = this.gs.current;
    if (me.swordFormLocked())
      return this.flashHint('The bound greatshield locks your bag — swap to shield form first.');
    if (!me.bag.includes(itemId)) return;
    const off = me.displacedBy(itemId, replace, hand);
    if (!off) {
      const slot = getItem(itemId).slot;
      return this.flashHint(
        me.tooHeavyToWear(itemId) ? 'Wearing that would put you over your carry limit. Drop something first.'
          : slot === 'hand' ? 'Your hands hold something bound that cannot be put away.'
          : slot === 'accessory' ? 'Your accessories are bound and cannot come off.'
          : `Your ${slot} slot is taken by something you cannot remove.`
      );
    }
    if (me.actions.bonus <= 0 && !Dev.infiniteActions)
      return this.flashHint('Equipping an item needs a bonus action.');
    this.closeInventory();
    this.resetSelection();
    this.submitTurn({ t: 'item-equip', itemId, ...(replace && off.includes(replace) ? { replace } : {}), ...(hand ? { hand } : {}) });
  }

  /** Stow a held or worn item back into the bag (bonus action), chosen from the inventory. */
  private unequipItem(itemId: ItemId): void {
    if (!this.humanActiveOrInventory) return;
    const me = this.gs.current;
    if (me.swordFormLocked())
      return this.flashHint('The bound greatshield locks your bag — swap to shield form first.');
    if (getItem(itemId).permanentlyBinding)
      return this.flashHint(`${getItem(itemId).name} is permanently bound.`);
    if (!me.canStow(itemId)) return;
    if (!me.torchSpentOnStow(itemId) && this.explorationCombat && !packCanStow(me, itemId)) return this.flashHint('No room in your bag.');
    if (me.actions.bonus <= 0 && !Dev.infiniteActions)
      return this.flashHint('Unequipping an item needs a bonus action.');
    this.closeInventory();
    this.resetSelection();
    this.submitTurn({ t: 'item-unequip', itemId });
  }

  // --- Inventory overlay (items + status effects) ----------------------------

  /** Toggle the inventory overlay open/closed. Opening it is free. */
  private toggleInventory(): void {
    if (this.mode === 'inventory' || this.mineInventoryOpen) {
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
    this.mineInventoryOpen = fromMineMap;
    this.mode = 'inventory';
    this.tutorialNotify({ k: 'panel', panel: 'inventory' });
    this.redraw();
  }

  private closeInventory(): void {
    this.invPanel?.destroy();
    this.invPanel = undefined;
    if (this.mineInventoryOpen) {
      // Online the party may have walked on meanwhile: back to whatever mine window is up now.
      this.mineInventoryOpen = false;
      this.mode = 'shop';
      this.minePanel?.setVisible(true);
    } else if (this.mode === 'inventory') {
      this.mode = 'idle';
    }
    this.tutorialNotify({ k: 'panel', panel: 'inventory-closed' });
    this.redraw();
  }

  /** The local party member whose supplies are inspected during Mine exploration. */
  private mineInventoryMage(): Mage {
    if (this.online) return this.localMage();
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
      case 'dread':
        return `Dread: ${s.stacks}. Your mind breaks, and you die, at or below ${s.stacks} sanity.`;
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
      case 'lightningStorm':
        return `Lightning Storm. Repeats ${s.targetIndices.length} fixed lightning strike${s.targetIndices.length === 1 ? '' : 's'} for ${s.damage} base damage at each upkeep. (${turns})`;
      case 'faradayVeil':
        return `Faraday Veil. Direct hostile hits seek the strongest Mind Lightning conductor within ${Math.round(s.arcRange / RANGE_UNIT)}cm. Successful routing prevents ${Math.round(Math.min(0.9, 0.3 + s.effectivePower * 0.02) * 100)}% and retaliates with the prevented damage; grounding failures deal ${Math.ceil(s.power / 8)} sanity. (${turns})`;
      case 'phaseOut':
        return s.mode === 'self'
          ? 'Phased. Cannot be targeted, damaged or affected until your next turn. Movement only, passing through walls, zones and bodies. Enemies you pass through take 1d6 corrosive. Upkeep is skipped; statuses still count down.'
          : !s.burstSpec
            ? 'Folded out of reality. Cannot be targeted, damaged or affected until your next turn. Movement only. Upkeep is skipped; statuses still count down.'
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
      case 'mirrorImages':
        return `Glass Doubles: ${s.images}. A targeted attack on you hits a double ${Math.round((s.images / (s.images + 1)) * 100)}% of the time: it deals nothing, and the attacker takes 1d4 shatter and is rooted for 1 turn. Area effects ignore them. (${turns})`;
      case 'petrify': {
        const stage =
          s.stage >= 3
            ? 'Stone: fully stunned; shatter damage against you is doubled.'
            : s.stage === 2
              ? 'Rooted.'
              : 'Slowed 50%.';
        return `Petrifying. ${stage} Advances when your turn ends; after stone, you shatter for 3d6 shatter and 1d6 shatter to every unit within 3cm. Each heal you receive undoes one stage. (${turns} until you shatter)`;
      }
      case 'rivet':
        return `Riveted to ${this.gs.mages[s.partnerIndex]?.name ?? 'another body'}. When either of you moves, the other is dragged along. (${turns})`;
      case 'blindSpot':
        return `Blind spot. You cannot target ${this.gs.mages[s.hiddenIndex]?.name ?? 'its caster'} with attacks or spells. (${turns})`;
      case 'timeStop': {
        const held = s.held.reduce((sum, hit) => sum + hit.amount, 0);
        const holding = s.sanctuary
          ? 'Sealed in glass: cannot be targeted or harmed.'
          : `Hits are held until time resumes${held > 0 ? ` (${held} held)` : ''}.`;
        const until =
          s.resumeAfterOwnerTurns != null
            ? `Resumes when ${this.gs.mages[s.ownerIndex]?.name ?? 'its caster'} ends ${s.resumeAfterOwnerTurns} more turn${s.resumeAfterOwnerTurns === 1 ? '' : 's'}.`
            : `Skips ${s.turns} more turn${s.turns === 1 ? '' : 's'}.`;
        return `Time stopped. No actions or reactions, cannot be moved, nothing wears off. ${holding} ${until}`;
      }
      case 'doom':
        return `Doom: falls in ${s.duration}. Draws 1 closer at your turn start and on every shatter hit. When it falls: ${s.spec} shatter to you, half to everything within ${Math.round(s.radius / RANGE_UNIT)}cm, then executed for ${s.executeAmount}.`;
      case 'deathMark':
        return `Marked for death. Cannot hide. Every wound adds 1 Reap, 2 if pierce. Executed for ${s.executeAmount} when the mark comes due. (${turns})`;
      case 'soulPact':
        return `Pact of Consequence. Damage you deal to anything else is dealt back to you as sanity damage. (${turns})`;
      case 'fixedPoint':
        return `Fixed point. Cannot walk, teleport or be moved, and cannot dodge. (${turns})`;
      case 'phantomReach':
        return `Phantom Reach. Your targeted spells reach any distance and ignore concealment. (${turns})`;
      case 'foreknown':
        return `Foreknown. The next action you declare is stopped at once and you take ${s.spec} sanity. (${turns})`;
      case 'stillWard':
        return `Stillwater Ward. The next damage you would take is stopped; you then gain a full veil for 1 turn and the attacker is rooted for 1 turn. (${turns})`;
      case 'stillOath':
        return `Oath of Stillness. The first action you take on a turn ends the rest of that turn. (${turns})`;
      case 'clockStopped':
        return `Stopped clock. Nothing else on you wears off. Damage over time still ticks. (${turns})`;
      case 'frozenPerception':
        return `Frozen perception. You cannot target anything that has moved more than 2cm since this landed. (${turns})`;
      case 'reflexStop':
        return `Frozen reflexes. You cannot react at all. (${turns})`;
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
      case 'imbue': {
        const def = IMBUES[s.imbue];
        const uses = s.charges == null ? 'Lasts the fight.' : `${s.charges} use${s.charges === 1 ? '' : 's'} left.`;
        return [`${def?.name ?? s.name}.`, def?.text, uses].filter(Boolean).join(' ');
      }
      case 'tether':
        return `Tethered to ${this.gs.mages[s.anchorIndex]?.name ?? 'something'}: cannot move further than ${Math.round(s.leash / RANGE_UNIT)}cm from it. (${turns})`;
      case 'stifle':
        return `Stifled. The next action you declare, other than moving, fails${s.spec ? ` and deals ${s.spec} ${s.type ?? 'corrosive'} to you` : ''}. (${turns})`;
      case 'regen':
        return `Regeneration. Heals ${s.spec} at the start of your turn. (${turns})`;
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
      actions: InventoryItemView['actions'] = [],
      count = 1,
    ): InventoryItemView => ({
      id,
      name: getItem(id).name,
      location,
      detail: getItem(id).blurb,
      actions: readOnly ? [] : actions,
      count,
    });
    const dropping = (id: ItemId): InventoryActionView['confirm'] => ({
      title: `Drop ${getItem(id).name}?`,
      body: `Drops at your feet${getItem(id).torchCombats != null ? ' and goes out' : ''}. Bonus action.`,
      label: 'Drop It',
    });
    const handActions = (id: ItemId): InventoryItemView['actions'] => {
      if (getItem(id).permanentlyBinding) return [];
      const total = getItem(id).torchCombats ?? 0;
      const unequip: InventoryActionView = mage.torchSpentOnStow(id)
        ? {
          kind: 'unequip', label: 'Put Away', tone: 'danger',
          confirm: {
            title: 'Put away the torch?',
            body: `Used torch: putting it away destroys it (${mage.torchCombatsLeft} of ${total} fights left).`,
            label: 'Destroy It',
          },
        }
        : { kind: 'unequip', label: 'Unequip' };
      return [unequip, { kind: 'drop-hand', label: 'Drop', tone: 'danger', confirm: dropping(id) }];
    };
    /** One row per kind, in the order first met. */
    const grouped = (ids: readonly ItemId[]): [ItemId, number][] => {
      const counts = new Map<ItemId, number>();
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
      return [...counts];
    };
    const wornLabel: Record<(typeof WORN_SLOTS)[number], string> = { head: 'Head', torso: 'Torso', cape: 'Cape', gloves: 'Gloves', boots: 'Boots' };
    const stowable = (id: ItemId): InventoryItemView['actions'] =>
      getItem(id).permanentlyBinding ? [] : [{ kind: 'unequip', label: 'Unequip' }];
    const equipment: InventoryItemView[] = [
      ...mage.hands.map((id) => item(id, getItem(id).permanentlyBinding ? 'Held / bound' : 'Held', handActions(id))),
      ...WORN_SLOTS.flatMap((slot) => {
        const id = mage.worn(slot);
        return id ? [item(id, getItem(id).permanentlyBinding ? `${wornLabel[slot]} / bound` : wornLabel[slot], stowable(id))] : [];
      }),
      ...mage.accessories.map((id) => item(id, 'Accessory', [
        ...stowable(id),
        { kind: 'drop-accessory', label: 'Take Off & Drop', tone: 'danger', confirm: dropping(id) },
      ])),
    ];
    const supplies: InventoryItemView[] = [
      ...grouped(mage.bag).map(([id, count]) => {
        if (getItem(id).slot === 'utility') return item(id, 'In bag', [], count);
        const off = mage.displacedBy(id) ?? [];
        if (!off.length) return item(id, 'In bag', [{ kind: 'equip', label: 'Equip', tone: 'positive' }], count);
        const names = off.map((other) => getItem(other).name).join(' and ');
        const torch = off.some((other) => mage.torchSpentOnStow(other));
        return item(id, 'In bag', [{
          kind: 'equip', label: 'Swap In', tone: 'positive',
          confirm: {
            title: `Swap in ${getItem(id).name}?`,
            body: `${names} ${torch ? (off.length > 1 ? 'are put away; the used torch is destroyed' : 'is destroyed') : off.length > 1 ? 'go into your bag' : 'goes into your bag'}. One bonus action.`,
            label: 'Swap (Bonus Action)',
          },
        }], count);
      }),
      ...grouped(mage.utility).map(([id, count]) => {
        const definition = getItem(id);
        const actions: InventoryItemView['actions'] = [];
        if (definition.potion) actions.push({ kind: 'consume', label: mage.readyConsumable === id ? 'Consume' : 'Ready', tone: 'positive' });
        if (definition.throwable) actions.push({ kind: 'throw', label: mage.readyConsumable === id ? 'Throw' : 'Ready' });
        if (mage.hasConsumablePouch() && mage.pouch.length < 3 && (definition.potion || definition.throwable))
          actions.push({ kind: 'pouch-store', label: 'Into Pouch' });
        if (definition.hexzettel) actions.push({ kind: 'hex', label: `Cast (${hexManaCost(definition.hexzettel)} mana)`, tone: 'positive' });
        return { ...item(id, 'Supply', actions, count), tag: mage.readyConsumable === id ? 'READY' : undefined };
      }),
      ...grouped(mage.pouch).map(([id, count]) => {
        const definition = getItem(id);
        return {
          ...item(id, `Pouch ${mage.pouch.length}/3`, [
            ...(definition.potion ? [{ kind: 'consume' as const, label: 'Consume', tone: 'positive' as const }] : []),
            ...(definition.throwable ? [{ kind: 'throw' as const, label: 'Throw' }] : []),
            { kind: 'pouch-remove', label: 'Out of Pouch' },
          ], count),
          tag: 'POUCH',
        };
      }),
      ...(mage.arrows > 0 ? [item('arrow' as ItemId, 'Ammunition', [], mage.arrows)] : []),
    ];
    const capacity = mage.carryCap();
    const load = !Number.isFinite(capacity) ? ''
      : mage.overloaded() ? '  /  OVERLOADED: cannot move'
      : mage.carryEncumbranceMultiplier() < 1 ? '  /  Heavy: half movement' : '';
    const run = this.explorationCombat?.run;
    this.invPanel = new InventoryView(this, {
      mageName: mage.name,
      carry: `Carry ${mage.carriedWeight().toFixed(1)}/${Number.isFinite(capacity) ? capacity : '∞'} kg${run ? `  /  ${packLabel(mage)}` : ''}${load}`,
      journey: run ? {
        day: run.day,
        hour: run.hour,
        level: this.runLevel,
        xp: this.runXp,
        next: this.xpToNextLevel(),
        pending: this.pendingLevels,
      } : undefined,
      readOnly,
      offhandOnly: mage.offhandOnly,
      equipment,
      supplies,
      statuses: mage.statuses.map((status) => ({
        name: status.name,
        duration: Number.isFinite(status.duration) ? `${status.duration} turns` : 'Permanent',
        detail: this.statusBlurb(status),
      })),
    }, {
      perform: (kind, id, replace, hand) => this.performInventoryAction(kind, id, replace, hand),
      close: () => this.closeInventory(),
      tabChanged: (tab) => this.tutorialNotify({ k: 'inventory-tab', tab }),
    });
  }

  private performInventoryAction(kind: InventoryActionKind, id: ItemId, replace?: ItemId, hand?: 'main' | 'off'): void {
    switch (kind) {
      case 'consume': this.consumeItem(id); break;
      case 'throw': this.beginThrow(id); break;
      case 'hex': this.beginHex(id); break;
      case 'equip': this.equipItem(id, replace, hand); break;
      case 'swap-hands': {
        if (!this.humanActiveOrInventory || !this.gs.current.hands.includes(id)) break;
        if (this.gs.current.swordFormLocked()) return this.flashHint('The bound greatshield locks your hands.');
        this.closeInventory();
        this.submitTurn({ t: 'item-swap-hands' });
        break;
      }
      case 'pouch-store': this.movePouchItem(id, true); break;
      case 'pouch-remove': this.movePouchItem(id, false); break;
      case 'unequip': this.unequipItem(id); break;
      case 'drop-hand': this.dropItemById(id); break;
      case 'drop-accessory': this.dropAccessory(id); break;
    }
  }

  private movePouchItem(id: ItemId, store: boolean): void {
    if (!this.humanActiveOrInventory || this.gs.current.swordFormLocked()) return;
    const me = this.gs.current;
    if (me.actions.bonus <= 0 && !Dev.infiniteActions)
      return this.flashHint('Moving a pouch item needs a bonus action.');
    if (store ? (!me.hasConsumablePouch() || me.pouch.length >= 3 || !me.utility.includes(id) || !(getItem(id).potion || getItem(id).throwable)) : !me.pouch.includes(id)) return;
    this.closeInventory();
    this.resetSelection();
    this.submitTurn({ t: store ? 'pouch-store' : 'pouch-remove', itemId: id });
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
      return this.flashHint('That weapon action is banned.');
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
    // The tutorial textbox floats over the arena; a click on it is never a shot.
    if (this.tutorialView?.blocksPointer(p.worldX, p.worldY)) return;
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
    }    const pt = { x: p.worldX, y: p.worldY };
    const me = this.gs.current;

    // Scenario Lab tools own the click while a brush / move target is armed.
    if (this.onScenarioFieldClick(pt)) return;

    if (this.mode === 'subtarget-point') {
      const origin = this.subtargetOrigin ?? me.pos;
      const direction = this.subtargetDirections
        ? closestMindLightningDirection(
            { x: pt.x - origin.x, y: pt.y - origin.y },
            this.subtargetDirections
          )
        : null;
      const capped = direction
        ? {
            x: origin.x + direction.x * this.subtargetRange,
            y: origin.y + direction.y * this.subtargetRange,
          }
        : stepTowards(origin, pt, this.subtargetRange);
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
      this.mode = 'busy';
      this.submitTurn({ t: 'move', x: pt.x, y: pt.y });
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
    if (this.mode === 'aiming-shout') {
      const target = this.clickedMage(pt, null);
      if (target) this.selectEnemyTarget(target);
      else this.flashHint('Choose an enemy for your summons to attack.');
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
    if (this.mode === 'aiming-hex') {
      this.aimHex(pt, this.clickedMage(pt, null));
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
    if (this.mode === 'aiming-staff') {
      const target = this.clickedMage(pt, null);
      if (target) this.selectEnemyTarget(target);
      else this.flashHint('Choose a foe in reach of the staff.');
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
      const target = this.clickedMage(
        pt,
        spell.targeting === 'any' || spell.targeting === 'ally' ? null : me
      );
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
        const capped = stepTowards(src.pos, pt, this.gs.spellReach(spell, src));
        this.finishReactionAim({ spell, point: capped });
        return;
      }
      const spell = this.pendingSpell;
      if (!spell) return;
      const capped = stepTowards(me.pos, pt, this.gs.spellReach(spell, me));
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
      const center = stepTowards(me.pos, pt, this.gs.spellReach(spell, me));
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
    if (spell.words.includes('storm') && spell.words.length <= 2) return 0;
    return Math.max(0, wordSpellMana(spell.words, mage.profile) + mage.spellManaDelta()) + (mage.swamprunCurse === 'feeding' ? 1 : 0);
  }

  private payForSpell(mage: Mage, spell: Spell, free = false, modifiers: WordId[] = []): void {
    mage.spendCharges(spell.words);
    if (modifiers.length > 0) mage.spendCharges(modifiers);
    const stormCast = spell.words.includes('storm') && spell.words.length <= 2;
    let mana = wordSpellMana(spell.words, mage.profile);
    // Focus: the empowered word spell costs 50% less mana.
    if (mage.focusNextSpell) mana = Math.ceil(mana * 0.5);
    // Mutivarg's Rod doubles the mana cost of anything cast through it.
    if (mage.hands.includes('mutivargRod' as ItemId)) mana *= 2;
    // Mana Wand (and any other item with manaDiscount) reduces spell cost; a staff cast through adds or saves its share.
    mana = Math.max(0, mana - mage.manaDiscountSum() + mage.spellManaDelta());
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
    if (free && mage.swamprunCurse === 'feeding' && !stormCast) mana += 1;
    if (!stormCast) mage.spendMana(mana);
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
    const bloodPct = stormCast ? 0 : mage.spellHealthCostPct();
    if (bloodPct > 0) {
      const bloodCost = Math.max(1, Math.round(mage.maxHp * bloodPct));
      mage.hp = Math.max(0, mage.hp - bloodCost);
      this.gs.log(`${mage.name}'s blood charm costs ${bloodCost} HP.`);
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
      if (me.hp <= 0) this.gs.log(`${me.name} dies paying the HP cost.`);
    }
    me.spendColorCharges(fromCharges);
    const baseManaCost = me.profile.blueSecondaryTier ? 0 : ability.manaCost;
    const manaCost = baseManaCost + (free && me.swamprunCurse === 'feeding' ? 1 : 0);
    me.spendMana(manaCost);
    me.lastAbilityManaPaid = this.abilityManaCost(me, ability);
    if (!free && !ability.freeAction) me.spend('bonus');
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
    const ability = getColorAbilitiesFor(me.profile.primary, me.spellClass, me.loadout)[idx];
    if (!ability) {
      this.flashHint('No color ability there.');
      return;
    }
    if (me.isAbilityBanned(ability.id)) {
      this.flashHint('That ability is banned.');
      return;
    }
    if (me.abilityCastsLeft(ability.id) <= 0) {
      this.flashHint(`${ability.name} is spent for this combat.`);
      return;
    }
    if (me.actions.bonus <= 0 && !Dev.infiniteActions && !ability.freeAction) {
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
    if (this.online && isSharedToggle(key)) {
      if (this.onlineCheatReady()) this.submitTurn({ t: 'dev', key, on: !Dev[key] });
      return;
    }
    Dev[key] = !Dev[key];
    this.refreshDevPanel();
    this.redraw();
  }

  /**
   * Online, a cheat that changes the fight travels like a move, so every screen
   * applies it at the same step: on your own turn, between actions.
   */
  private onlineCheatReady(): boolean {
    if (this.isLocalTurn() && (this.mode === 'idle' || this.mode === 'dev-resources')) return true;
    this.flashHint('Online, cheats work on your own turn, between actions.');
    return false;
  }

  private toggleDevResources(): void {
    if (this.online && !this.devResources.isOpen && !this.onlineCheatReady()) return;
    this.devResources.toggle();
  }

  private relayDevResources(mage: Mage): void {
    if (!this.online) return;
    const cmd: TurnCommand = { t: 'dev-resources', seat: this.seatOf(mage), values: readDevResources(mage) };
    this.net?.send({ k: 'turn', cmd });
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
      this.tutorialNotify({ k: 'reaction' });
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
        `${reactor.name}: REACTION — [1-5]+Enter to cast${abil}${block}${bash}${weapon}${needle}${dodge}, or Space/E to pass.`,
        false,
        'info'
      );
      this.showReactionTelegraph(top);
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
    const ability = getColorAbilitiesFor(this.reactor.profile.primary, this.reactor.spellClass, this.reactor.loadout)[idx];
    if (!ability) {
      this.flashHint('No color ability there.');
      return;
    }
    if (this.reactor.isAbilityBanned(ability.id)) {
      this.flashHint('That ability is banned.');
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
        ? 'Auto-pass ON. [O] to turn off.'
        : 'Auto-pass OFF. [O] to turn on.'
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
        ? 'Spectate ON. [Y] to take back control.'
        : 'Spectate OFF from next turn. [Y] to watch again.'
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
        !m.isImmuneTo('sanity') && m.maxSanity > 0
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
      case 'aiming-hex': {
        const hex = this.pendingHex();
        return !!hex && hexAim(hex) === 'unit' && !hexAimProblem(this.gs, me, hex, { target: m, point: null });
      }
      case 'aiming-eldritch':
        return m.team !== me.team;
      case 'aiming-shout':
        return m.team !== me.team && !this.gs.isUntargetable(m, me);
      case 'aiming-staff':
        return !!this.staffPending && this.canStaffBoltAt(me, this.staffPending.item, this.staffPending.bolt, m);
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
      case 'aiming-hex':
        this.aimHex(foe.pos, foe);
        return;
      case 'aiming-eldritch':
        if (foe.team !== me.team) {
          this.mode = 'busy';
          this.submitTurn({ t: 'eldritch', choice: 'attack', target: this.seatOf(foe) });
        } else this.flashHint('Choose an enemy to strike.');
        return;
      case 'aiming-shout':
        if (this.canTargetEnemyNow(foe)) {
          this.mode = 'busy';
          this.submitTurn({ t: 'shout', order: 'attack', target: this.seatOf(foe) });
        } else this.flashHint('Choose an enemy for your summons to attack.');
        return;
      case 'aiming-staff': {
        const pending = this.staffPending;
        if (pending && this.canStaffBoltAt(me, pending.item, pending.bolt, foe)) {
          this.staffPending = null;
          this.mode = 'busy';
          this.submitTurn({ t: 'staff-bolt', item: pending.item, bolt: pending.bolt, target: this.seatOf(foe) });
        } else this.flashHint('That foe is out of the staff\'s reach.');
        return;
      }
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
          this.flashHint('Choose a spell first.');
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
        this.flashHint('Start an attack or spell first.');
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
    const rng = Number.isFinite(spell.range) ? `range ${this.gs.spellReach(spell, me)}` : 'any range';
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
      this.flashHint('The Needle can only ban abilities or weapon strikes.');
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
      spec: this.gs.rng.consistentSpec(`${n}d6`),
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
        prompt: `${reactor.name}: dodge — pick where to move (Esc to stay).`,
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
    const clamp = this.gs.clampToBarriers(reactor.pos, fieldDest, reactor.bodyRadius());
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
    // Slip the body across rather than teleporting it: the roll strip exists
    // for exactly this and was never wired to the dodge that earns it.
    playSound('move.dash');
    this.animateDash(reactor, origin);
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
    for (const ability of getColorAbilitiesFor(source.profile.primary, source.spellClass, source.loadout)) {
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
      add('leap', 'Leap', `Jump in a chosen direction; ${source.leapsLeft()} leaps left.`);
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
      add('deaths-angel-wings', 'Use Deaths Angel Wings', 'Spend 1 Energy to start or extend flight.');
    }
    if (source.bindMantleCharges > 0) {
      add('mantle-bind', 'Weak Bind', `Root the nearest enemy; ${source.bindMantleCharges} charges remain.`);
    }
    const robe = robeOf(source);
    if (robe) {
      const def = IMBUES[robe.imbue];
      add('robe-cast', def.robe!.label, `50%: ${def.robe!.text} ${robe.charges} uses remain.`);
    }
    const cleanseCost = source.cleanseManaCost();
    if (cleanseCost != null && source.mana >= cleanseCost) {
      add('cleanse', 'Cleanse', `Pay ${cleanseCost} mana to remove every affliction from yourself.`);
    }
    if (
      source.hasEdgelordLantern() &&
      !source.isItemBanned('edgelordLantern') &&
      (source.edgelordLanternActive ||
        (this.gs.edgelordCaptives(source).length === 0 && source.mana >= 4))
    ) {
      add(
        'edgelord-shake',
        source.edgelordLanternActive ? 'Deactivate Edgelord Lantern' : 'Activate Edgelord Lantern',
        source.edgelordLanternActive ? 'Pull and capture nearby creatures.' : 'Pay 4 mana and spread Soul Rend.'
      );
    }

    if (!source.swordFormLocked()) {
      for (const itemId of source.bag) {
        if (source.canEquipFromBag(itemId)) {
          add(`item-equip:${itemId}`, `Equip ${getItem(itemId).name}`, '');
        }
      }
      for (const itemId of source.hands) {
        if (!getItem(itemId).permanentlyBinding) {
          if (this.packRoomFor(source, itemId)) add(`item-unequip:${itemId}`, `Unequip ${getItem(itemId).name}`, 'Stow this held item in the bag.');
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

    for (const itemId of [...source.utility, ...source.pouch]) {
      const item = getItem(itemId);
      if (source.isItemBanned(itemId) || source.swordFormLocked()) continue;
      if (
        item.potion && (source.pouch.includes(itemId) || source.readyConsumable === itemId) &&
        !((item.potion === 'mana' && source.mana >= source.maxMana) ||
          (item.potion === 'health' && source.hp >= source.maxHp))
      ) {
        add(`item-use:${itemId}`, `Consume ${item.name}`, '');
      }
      if (
        item.throwable && (source.pouch.includes(itemId) || source.readyConsumable === itemId) &&
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
        `${source.name}: one free bonus action.`,
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
      case 'robe-cast': return { t: 'robe-cast' };
      case 'cleanse': return { t: 'cleanse' };
      case 'flee': return { t: 'flee' };
      default: return null;
    }
  }

  /** Open and stage one free bonus action after the avoided item leaves the stack. */
  private async offerDodgeBonusAction(source: Mage): Promise<void> {
    const options = this.dodgeBonusOptions(source);
    if (options.length === 0) {
      this.gs.log(`${source.name}'s perfect dodge: no bonus action available.`);
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
      this.gs.log(`${source.name} uses the perfect dodge for a free bonus action.`);
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
    const r = this.reactionResolve;
    if (!r) return;
    this.reactionResolve = null;
    this.reactor = null;
    this.reactionTop = null;
    this.reactionAiming = false;
    this.reactionPendingSpell = null;
    this.mode = 'busy';
    this.clearReactionTelegraph();
    this.resetSelection();
    this.tutorialNotify({ k: 'reaction-done' });
    this.redraw();
    r(choice);
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
      if (opts.aiPoint) return { ...opts.aiPoint };
      const foe = this.gs.opponentOf(source);
      if (opts.directions?.length) {
        const direction = closestMindLightningDirection(
          { x: foe.x - origin.x, y: foe.y - origin.y },
          opts.directions
        );
        return {
          x: origin.x + direction.x * opts.maxRange,
          y: origin.y + direction.y * opts.maxRange,
        };
      }
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
      this.subtargetDirections = opts.directions?.map((direction) => ({ ...direction })) ?? null;
      this.subtargetCandidates = null;
      this.subtargetRequired = opts.required ?? false;
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

  private async requestStormReroll(source: Mage, opts: SubTargetRerollOpts): Promise<boolean> {
    if (this.controllerIsAI(source)) return opts.value <= Math.floor(opts.sides / 2);
    if (this.online && !this.isLocalDecider(source)) return this.recvSubReroll();
    const previousMode = this.mode;
    this.mode = 'shop';
    const value = await new Promise<boolean>((resolve) => {
      const finish = (reroll: boolean): void => {
        panel.destroy();
        this.mode = previousMode;
        resolve(reroll);
      };
      const panel = new ChoiceMenuView(
        this,
        'LIGHTNING STORM',
        `${opts.label}: ${opts.value} on 1d${opts.sides}.`,
        [
          { id: 'keep', label: 'Keep', detail: `Keep ${opts.value}.` },
          { id: 'reroll', label: 'Reroll', detail: '' },
        ],
        (choice) => finish(choice === 'reroll')
      );
    });
    if (this.online) this.sendSubReroll(value);
    return value;
  }

  /** What the caster gives its Shikigami: the AI gives its minions; a player picks from the offering menu. */
  private async requestShikigamiOffering(source: Mage, opts: OfferingOpts): Promise<OfferingChoice> {
    if (this.controllerIsAI(source)) return { life: 0, items: false, summons: [...opts.summons] };
    if (this.online && !this.isLocalDecider(source)) return this.recvSubOffering(opts);
    const previousMode = this.mode;
    this.mode = 'shop';
    const describe = (points: number): string => {
      const rank = shikigamiTier(points);
      return `${points} point${points === 1 ? '' : 's'}: rank ${rank}. Each turn it ${SHIKIGAMI_TIERS.slice(0, rank).join('; ')}.`;
    };
    const choice = await new Promise<OfferingChoice>((resolve) => {
      const panel = new OfferingMenuView(this, {
        lifeMax: opts.lifeMax,
        items: opts.items,
        summons: opts.summons.map((m) => m.name),
        points: opts.points,
        describe,
        confirm: (life, items, picked) => {
          panel.destroy();
          this.mode = previousMode;
          resolve({ life, items, summons: picked.map((index) => opts.summons[index]) });
        },
      });
    });
    if (this.online) this.sendSubOffering(choice);
    return choice;
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
    this.subtargetDirections = null;
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
    const regional = this.explorationCombat && !this.mineRun ? EXPLORATION_ARENAS[this.explorationCombat.zone ?? 'capitol'] : undefined;
    if (regional) {
      theme = regional;
    } else if (this.mineRun) {
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

    // Cast and End Turn have no pointer route otherwise; without them a touch
    // player can build a spell but never fire it or hand the turn over.
    this.endTurnButton = this.hintBarButton(right(HINT_BAR) - 238, 132, 'END TURN', () => {
      if (this.mode === 'reaction') this.onReactionPass();
      else this.onEndTurn();
    });
    this.castButton = this.hintBarButton(right(HINT_BAR) - 376, 250, 'CAST', () => {
      this.onCast();
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
    this.panelHeader(DOCK_SPELL, 'WORDS', MENU_HEX.brassLight);
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
    const chipW = 72;
    const chipGap = 5;
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
    this.buildMenuButton();

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

  /**
   * The resource cheat panel, built on first use so its host adapter can close
   * over a correctly bound `this`.
   */
  private get devResources(): DevResourceEditor {
    if (!this.devResourceEditor) {
      const self = this;
      this.devResourceEditor = new DevResourceEditor({
        scene: this,
        get gs() { return self.gs; },
        get mode() { return self.mode; },
        set mode(value: InputMode) { self.mode = value; },
        get workshopFocus() { return self.workshopFocus; },
        redraw: () => self.redraw(),
        edited: (mage) => self.relayDevResources(mage),
        addWorkshopChip: (...args) => self.addWorkshopChip(...args),
      });
    }
    return this.devResourceEditor;
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
        subtitle: 'Place units, equip them, then save or load the fight as a scenario file.',
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
      'Applying a preset replaces stats and gear.',
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
      `Words ${base.length}/${LOADOUT_SIZE}`,
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
    this.scenarioLabel(left, y + 36, '* hidden words', TEXT.dim);
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
      'F6: dev panel.',
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
      'Click the field to place. Esc: back.',
      TEXT.dim,
    );

    const colW = 300;
    const step = 26;
    const y0 = top + 58;
    const entries: { label: string; color: string; arm: () => void }[] = [
      { label: 'Mage (no gear)', color: MENU_HEX.brassLight, arm: () => (this.scenarioBrush = { player: true }) },
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
      subtitle: 'Save this fight as a scenario file.',
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
      label: 'SAVE SCENARIO',
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
          this.flashHint(`Saved "${saved.name}". Load it from Workshop > Load Scenario.`);
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
      `Scenario loaded: "${scenario.name}" (round ${this.gs.round}, ${mages.length} units).`
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
      subtitle: 'Edit units, resources, stacks and gear.',
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
    this.gs.log('Training: field reset.');
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

    // Loose sand (terrain, so it goes under every owned zone).
    this.drawSand(g);

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

    // Lillith's graves, acid circles and the one she holds.
    this.drawLillith(g);

    // Corrosion totems.
    this.drawTotems(g);

    // Remaining-duration counters on every field zone (visible to everyone).
    this.drawZoneDurations();

    // Dropped equipment on the ground.
    this.drawDroppedItems(g);

    // Torch / lantern light auras.
    this.drawLightAuras(g);

    // Jürgen (Corrode Curse bat) corrosion auras.
    this.drawIntrinsicDamageAuras(g);
    this.drawShroudAuras(g);

    // Aiming ranges.
    this.drawAimingRange(g);
    this.syncMoveGhost();

    // Bind Curse ranges follow their afflicted bearers.
    this.drawBindCurseAuras(g);
    this.drawRivetsAndDoubles(g);

    // Defeated bodies clear after their defeat seal so the field stays readable.
    for (const m of this.gs.mages) {
      if (m.alive && !m.unseen) this.drawMage(g, m);
      else this.mageLabels.get(m)?.setVisible(false);
    }

    // Stack tokens.
    this.drawStack(g);
    this.drawInitiative(g);

    // Swamprun wave / foe-count readout.
    if (this.swamprun) this.updateWaveHud();

    // HUD text.
    this.drawHud();
    this.drawHexEmblems();

    // Docked enemy target list (kept in sync with who is alive / targetable).
    this.refreshTargetList();
  }

  /** Warm glow around any mage projecting a torch / lantern light aura. */
  private drawLightAuras(g: Phaser.GameObjects.Graphics): void {
    for (const m of this.gs.mages) {
      if (!m.alive) continue;
      const r = this.gs.effectiveLightRadius(m);
      if (r <= 0) continue;
      const position = this.mageVisualPosition(m);
      g.fillStyle(0xffd27a, 0.12).fillCircle(position.x, position.y, r);
      g.fillStyle(0xffe6a8, 0.1).fillCircle(position.x, position.y, r * 0.6);
      g.lineStyle(1, 0xffd27a, 0.35).strokeCircle(position.x, position.y, r);
    }
  }

  private drawEdgelordDarkLights(g: Phaser.GameObjects.Graphics): void {
    for (const mage of this.gs.mages) {
      if (!mage.alive || !mage.hasEdgelordLantern() || !mage.edgelordLanternActive) continue;
      const radius = 15 * RANGE_UNIT;
      const position = this.mageVisualPosition(mage);
      g.fillStyle(0x030308, 0.48).fillCircle(position.x, position.y, radius);
      g.fillStyle(0x1a0d20, 0.2).fillCircle(position.x, position.y, radius * 0.72);
      g.lineStyle(3, 0x8a5aa5, 0.75).strokeCircle(position.x, position.y, radius);
      g.lineStyle(1, 0xc98dd8, 0.35).strokeCircle(position.x, position.y, radius - 5);
    }
  }

  private drawIntrinsicDamageAuras(g: Phaser.GameObjects.Graphics): void {
    for (const mage of this.gs.mages) {
      if (!mage.alive || !mage.intrinsicDamageAura) continue;
      const radius = mage.intrinsicDamageAura.radius;
      const position = this.mageVisualPosition(mage);
      g.fillStyle(0x8ecf58, 0.08).fillCircle(position.x, position.y, radius);
      g.lineStyle(1, 0x9be870, 0.55).strokeCircle(position.x, position.y, radius);
    }
  }

  /** Shroud minions: everyone knows where the hidden ones stand, so the ring is drawn for all. */
  private drawShroudAuras(g: Phaser.GameObjects.Graphics): void {
    for (const mage of this.gs.mages) {
      const radius = mage.alive && mage.summonKind ? MINIONS[mage.summonKind]?.shroud : undefined;
      if (radius == null) continue;
      const tint = mage.team === 1 ? COLORS.team1 : COLORS.team2;
      const position = this.mageVisualPosition(mage);
      g.fillStyle(0x7f8fb8, 0.12).fillCircle(position.x, position.y, radius);
      g.lineStyle(2, 0xaab8e0, 0.6).strokeCircle(position.x, position.y, radius);
      g.lineStyle(1, tint, 0.5).strokeCircle(position.x, position.y, radius - 3);
    }
  }

  private drawSand(g: Phaser.GameObjects.Graphics): void {
    for (const patch of this.gs.sand) {
      g.fillStyle(0xe8c98a, 0.14).fillCircle(patch.x, patch.y, patch.radius);
      g.lineStyle(2, 0xc9a86a, 0.5).strokeCircle(patch.x, patch.y, patch.radius);
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
      const position = this.mageVisualPosition(mage);
      for (const status of mage.statuses) {
        if (status.kind !== 'bindCurseAura') continue;
        g.fillStyle(0x6a7bd0, 0.06).fillCircle(position.x, position.y, status.radius);
        g.lineStyle(1, 0x8b96df, 0.5).strokeCircle(position.x, position.y, status.radius);
      }
    }
  }

  /** Chains between riveted bodies, and the glass doubles circling their bearer. */
  private drawRivetsAndDoubles(g: Phaser.GameObjects.Graphics): void {
    // While someone's stopped world holds, the whole field goes still and grey.
    if (this.gs.mages.some((m) => this.gs.timeStopOn(m)?.resumeAfterOwnerTurns != null)) {
      g.fillStyle(0x9fb4d8, 0.1).fillRect(FIELD.x, FIELD.y, FIELD.w, FIELD.h);
    }
    for (const mage of this.gs.mages) {
      if (!mage.alive || mage.unseen) continue;
      const position = this.mageVisualPosition(mage);
      this.drawGodMarks(g, mage);
      const partner = this.gs.rivetPartner(mage);
      if (partner && this.gs.mages.indexOf(mage) < this.gs.mages.indexOf(partner)) {
        const partnerPosition = this.mageVisualPosition(partner);
        g.lineStyle(5, 0x5a4a30, 0.85).lineBetween(position.x, position.y, partnerPosition.x, partnerPosition.y);
        g.lineStyle(2, 0xc9b27a, 0.95).lineBetween(position.x, position.y, partnerPosition.x, partnerPosition.y);
      }
      if (this.gs.isVeiled(mage)) continue;
      for (const status of mage.statuses) {
        if (status.kind !== 'mirrorImages') continue;
        for (let i = 0; i < status.images; i++) {
          const angle = (i / status.images) * Math.PI * 2 - Math.PI / 2;
          const x = position.x + Math.cos(angle) * MAGE_RADIUS * 1.7;
          const y = position.y + Math.sin(angle) * MAGE_RADIUS * 1.7;
          g.fillStyle(0xcfe8f5, 0.2).fillCircle(x, y, MAGE_RADIUS * 0.85);
          g.lineStyle(1, 0xeaf6ff, 0.65).strokeCircle(x, y, MAGE_RADIUS * 0.85);
        }
      }
    }
  }

  /** The god words leave their marks on a body: stopped clocks, glass, dooms, crosshairs, pins. */
  private drawGodMarks(g: Phaser.GameObjects.Graphics, mage: Mage): void {
    const position = this.mageVisualPosition(mage);
    g.save().translateCanvas(position.x - mage.x, position.y - mage.y);
    const stop = this.gs.timeStopOn(mage);
    if (stop?.sanctuary) {
      const r = MAGE_RADIUS * 1.8;
      g.fillStyle(0xd8f0ff, 0.16);
      g.fillPoints([
        new Phaser.Math.Vector2(mage.x, mage.y - r * 1.25),
        new Phaser.Math.Vector2(mage.x + r, mage.y),
        new Phaser.Math.Vector2(mage.x, mage.y + r * 1.25),
        new Phaser.Math.Vector2(mage.x - r, mage.y),
      ], true);
      g.lineStyle(2, 0xeaf6ff, 0.8).strokePoints([
        new Phaser.Math.Vector2(mage.x, mage.y - r * 1.25),
        new Phaser.Math.Vector2(mage.x + r, mage.y),
        new Phaser.Math.Vector2(mage.x, mage.y + r * 1.25),
        new Phaser.Math.Vector2(mage.x - r, mage.y),
      ], true, true);
    } else if (stop) {
      // A stopped clock face: twelve ticks and hands that never move.
      const r = MAGE_RADIUS * 1.75;
      g.lineStyle(2, 0x9ee7ff, 0.75).strokeCircle(mage.x, mage.y, r);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const inner = i % 3 === 0 ? r * 0.78 : r * 0.88;
        g.lineStyle(i % 3 === 0 ? 2 : 1, 0xcff4ff, 0.8).lineBetween(
          mage.x + Math.cos(a) * inner, mage.y + Math.sin(a) * inner,
          mage.x + Math.cos(a) * r, mage.y + Math.sin(a) * r
        );
      }
      g.lineStyle(2, 0xcff4ff, 0.7).lineBetween(mage.x, mage.y, mage.x, mage.y - r * 0.6);
      g.lineStyle(2, 0xcff4ff, 0.7).lineBetween(mage.x, mage.y, mage.x + r * 0.45, mage.y);
    }
    for (const status of mage.statuses) {
      if (status.kind === 'doom') {
        // One ember above the head for every step the doom has left to fall.
        for (let i = 0; i < status.duration; i++) {
          const x = mage.x + (i - (status.duration - 1) / 2) * 10;
          g.fillStyle(0xb9304a, 0.9).fillCircle(x, mage.y - MAGE_RADIUS - 44, 3.5);
        }
      } else if (status.kind === 'deathMark') {
        const r = MAGE_RADIUS * 1.45;
        g.lineStyle(2, 0xd23a5a, 0.85).strokeCircle(mage.x, mage.y, r);
        g.lineBetween(mage.x - r - 6, mage.y, mage.x - r + 6, mage.y);
        g.lineBetween(mage.x + r - 6, mage.y, mage.x + r + 6, mage.y);
        g.lineBetween(mage.x, mage.y - r - 6, mage.x, mage.y - r + 6);
        g.lineBetween(mage.x, mage.y + r - 6, mage.x, mage.y + r + 6);
      } else if (status.kind === 'fixedPoint') {
        const y = mage.y + MAGE_RADIUS * 0.72;
        g.lineStyle(3, 0xff5599, 0.9).lineBetween(mage.x - 9, y - 9, mage.x + 9, y + 9);
        g.lineBetween(mage.x + 9, y - 9, mage.x - 9, y + 9);
      } else if (status.kind === 'stillWard') {
        g.lineStyle(1, 0x9ee7ff, 0.7).strokeCircle(mage.x, mage.y, MAGE_RADIUS * 1.35);
      }
    }
    g.restore();
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
    const show = (key: string, x: number, y: number, turns: number, owner: number, unit = 'TURN'): void => {
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
      t.setText(`${turns} ${unit}${turns === 1 ? '' : 'S'}`).setColor(hex).setPosition(x, y).setVisible(true);
    };
    for (const s of this.gs.shadows) show(`sh${s.id}`, s.x, s.y - s.radius - 10, s.ttl, s.owner);
    for (const t of this.gs.totems) show(`to${t.id}`, t.x, t.y - t.radius - 10, t.ttl, t.owner);
    for (const z of this.gs.mutivargZones)
      show(`mv${z.id}`, z.x, z.y - z.radius - 10, z.turnsLeft, z.owner);
    for (const pool of this.gs.corrosionPools)
      show(`cp${pool.id}`, pool.x, pool.y - pool.radius - 10, pool.roundsLeft, pool.ownerTeam);
    for (const zone of this.gs.hazardZones.filter((z) => z.untilTurn == null)) {
      const position = this.hazardVisualPosition(zone);
      show(
        `hz${zone.id}`,
        position.x + (zone.toX != null ? (zone.toX - zone.x) / 2 : 0),
        position.y + (zone.toY != null ? (zone.toY - zone.y) / 2 : 0) - zone.radius - 10,
        zone.roundsLeft,
        zone.ownerTeam
      );
    }
    for (const b of this.gs.barriers) show(`ba${b.id}`, b.x, b.y, b.ttl, b.owner);
    for (const field of this.gs.desecrationFields)
      show(`dg${field.id}`, field.x, field.y - field.radius - 10, field.turnsLeft, field.ownerTeam);
    // Sand is unowned, so its count is neutral rather than team-tinted.
    for (const patch of this.gs.sand)
      show(`sa${patch.id}`, patch.x, patch.y - patch.radius - 10, patch.charges, 0, 'SAND');
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

  private drawLillith(g: Phaser.GameObjects.Graphics): void {
    const r = LILLITH_CIRCLE_RADIUS;
    for (const boss of this.gs.mages) {
      const s = boss.lillith;
      if (!s || !boss.alive) continue;
      for (const grave of s.graves) {
        const held = lillithGraveHeld(this.gs, boss, grave);
        g.fillStyle(0x24102f, held ? 0.16 : 0.34).fillCircle(grave.x, grave.y, r);
        g.lineStyle(2, held ? 0xd9b8ff : 0x8e4fc0, 0.85).strokeCircle(grave.x, grave.y, r);
        g.lineStyle(1, 0x8e4fc0, 0.45).strokeCircle(grave.x, grave.y, r * 0.72);
        g.lineStyle(3, held ? 0xd9b8ff : 0xb48cd8, 0.75);
        g.lineBetween(grave.x, grave.y - 12, grave.x, grave.y + 12);
        g.lineBetween(grave.x - 7, grave.y - 5, grave.x + 7, grave.y - 5);
      }
      for (const pool of s.pools) {
        const last = pool.fires <= 1;
        g.fillStyle(0x5f9a2e, last ? 0.12 : 0.22).fillCircle(pool.x, pool.y, r);
        g.lineStyle(2, 0xa6e05a, last ? 0.5 : 0.9).strokeCircle(pool.x, pool.y, r);
        g.lineStyle(1, 0x2f4d1c, 0.7).strokeCircle(pool.x, pool.y, r * 0.6);
      }
      const held = s.bound;
      if (held?.alive) {
        for (const orb of this.gs.mages) {
          if (!orb.alive || orb.enemyKind !== 'lillithOrb' || orb.team !== boss.team) continue;
          g.lineStyle(2, 0xb48cd8, 0.55).lineBetween(held.x, held.y, orb.x, orb.y);
        }
        g.lineStyle(3, 0x8e4fc0, 0.9).strokeCircle(held.x, held.y, MAGE_RADIUS + 12);
        g.lineStyle(1, 0xd9b8ff, 0.6).strokeCircle(held.x, held.y, MAGE_RADIUS + 18);
      }
    }
  }

  private drawCorrosionPools(g: Phaser.GameObjects.Graphics): void {
    for (const pool of this.gs.corrosionPools) {
      g.fillStyle(0x467a3f, 0.2).fillCircle(pool.x, pool.y, pool.radius);
      g.lineStyle(2, 0x9dcf62, 0.65).strokeCircle(pool.x, pool.y, pool.radius);
      g.lineStyle(1, 0x263d2b, 0.8).strokeCircle(pool.x, pool.y, pool.radius * 0.62);
    }
    for (const zone of this.gs.hazardZones) {
      const position = this.hazardVisualPosition(zone);
      if (zone.toX != null && zone.toY != null) {
        const end = { x: position.x + zone.toX - zone.x, y: position.y + zone.toY - zone.y };
        g.lineStyle(zone.radius * 2, zone.color, 0.22);
        g.lineBetween(position.x, position.y, end.x, end.y);
        g.lineStyle(2, zone.color, 0.7);
        g.lineBetween(position.x, position.y, end.x, end.y);
        continue;
      }
      g.fillStyle(zone.color, 0.16).fillCircle(position.x, position.y, zone.radius);
      g.lineStyle(2, zone.color, 0.7).strokeCircle(position.x, position.y, zone.radius);
      g.lineStyle(1, zone.color, 0.35).strokeCircle(position.x, position.y, zone.radius * 0.7);
    }
    for (const field of this.gs.desecrationFields) {
      g.fillStyle(0x2a1630, 0.32).fillCircle(field.x, field.y, field.radius);
      g.lineStyle(field.sealed ? 4 : 2, 0x6e4d7d, 0.8).strokeCircle(field.x, field.y, field.radius);
      g.lineStyle(1, 0x3d2a47, 0.7).strokeCircle(field.x, field.y, field.radius * 0.72);
      g.lineStyle(1, 0x3d2a47, 0.5).strokeCircle(field.x, field.y, field.radius * 0.44);
      if (field.executeRadius != null) {
        g.fillStyle(0x100610, 0.7).fillCircle(field.x, field.y, field.executeRadius);
      }
    }
  }

  private drawBarriers(g: Phaser.GameObjects.Graphics): void {
    const arena = this.gs.moayArena;
    if (arena) {
      const walls = [
        { x: FIELD.x, y: FIELD.y, w: FIELD.w, h: arena.y - FIELD.y },
        { x: FIELD.x, y: arena.y + arena.h, w: FIELD.w, h: FIELD.y + FIELD.h - arena.y - arena.h },
        { x: FIELD.x, y: arena.y, w: arena.x - FIELD.x, h: arena.h },
        { x: arena.x + arena.w, y: arena.y, w: FIELD.x + FIELD.w - arena.x - arena.w, h: arena.h },
      ];
      for (const wall of walls) {
        g.fillStyle(0x353629, 1).fillRect(wall.x, wall.y, wall.w, wall.h);
        for (let row = wall.y; row < wall.y + wall.h; row += 24) {
          const height = Math.min(24, wall.y + wall.h - row);
          for (let column = wall.x; column < wall.x + wall.w; column += 48) {
            const width = Math.min(48, wall.x + wall.w - column);
            g.lineStyle(1, 0x62624b, 0.65).strokeRect(column + 1, row + 1, Math.max(0, width - 2), Math.max(0, height - 2));
          }
        }
      }
      g.lineStyle(3, 0xa5a17d, 1).strokeRect(arena.x, arena.y, arena.w, arena.h);
    }
    for (const b of this.gs.barriers) {
      const tint = b.owner === 1 ? COLORS.team1 : COLORS.team2;
      if (b.shape === 'rect') {
        if (b.burst) {
          const reach = this.rectCorners(
            b.x,
            b.y,
            b.angle,
            b.range + b.burst.radius * 2,
            b.thickness + b.burst.radius * 2
          );
          g.lineStyle(1, 0x9be870, 0.35);
          g.beginPath();
          g.moveTo(reach[0].x, reach[0].y);
          for (let i = 1; i < reach.length; i++) g.lineTo(reach[i].x, reach[i].y);
          g.closePath();
          g.strokePath();
        }
        const corners = this.rectCorners(b.x, b.y, b.angle, b.range, b.thickness);
        g.fillStyle(b.opaque ? 0xd8eef2 : 0x6ad1ff, b.opaque ? 0.72 : 0.18);
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

  /** Outline every enemy body while aiming an area spell, filled when the area would catch it. */
  private drawAoeHitboxes(
    g: Phaser.GameObjects.Graphics,
    caster: Mage,
    toward: Vec2 | null,
    aoe: NonNullable<Spell['aoe']>
  ): void {
    const caught = new Set(
      !toward
        ? []
        : aoe.kind === 'circle'
        ? this.gs.magesInRadius(toward, aoe.radius)
        : this.gs.magesInCone(caster.pos, toward, aoe.radius, aoe.degrees ?? 90)
    );
    for (const m of this.gs.mages) {
      if (!m.alive || m.team === caster.team) continue;
      const r = m.bodyRadius();
      if (caught.has(m)) {
        g.fillStyle(0xff4a3d, 0.32).fillCircle(m.x, m.y, r);
        g.lineStyle(3, 0xff4a3d, 1).strokeCircle(m.x, m.y, r);
      } else {
        g.lineStyle(2, 0xffd166, 0.8).strokeCircle(m.x, m.y, r);
      }
    }
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

  private moveGhost?: Phaser.GameObjects.Sprite;
  private movePreview?: { mage: Mage; origin: Vec2; pointer: Vec2; range: number; time: number; path: Vec2[] };

  private previewMovePath(me: Mage): Vec2[] {
    const cached = this.movePreview;
    const range = me.moveRange();
    if (cached && cached.mage === me && cached.range === range &&
        cached.origin.x === me.x && cached.origin.y === me.y &&
        cached.pointer.x === this.pointer.x && cached.pointer.y === this.pointer.y &&
        this.time.now - cached.time < 100) return cached.path;
    const path = this.gs.planMove(me, this.pointer).path;
    this.movePreview = { mage: me, origin: me.pos, pointer: { ...this.pointer }, range, time: this.time.now, path };
    return path;
  }

  /**
   * A translucent body standing where a move would actually put you — clamped
   * the same way the committed move is, so the preview cannot lie about reach.
   */
  private syncMoveGhost(): void {
    const me = this.aimingSource ?? this.gs.current;
    const rec = this.mageAnims.get(me);
    if (this.mode !== 'aiming-move' || !rec || !me.alive || this.controllerIsAI(me)) {
      this.moveGhost?.setVisible(false);
      return;
    }
    const path = this.previewMovePath(me);
    const dest = path[path.length - 1];
    if (!this.moveGhost) {
      this.moveGhost = this.add.sprite(dest.x, dest.y, rec.sprite.texture.key).setDepth(4.6);
    }
    this.moveGhost
      .setTexture(rec.sprite.texture.key, rec.sprite.frame.name)
      .setOrigin(rec.sprite.originX, rec.sprite.originY)
      .setScale(rec.sprite.scaleX, rec.sprite.scaleY)
      .setFlipX(this.pointer.x < me.x)
      .setPosition(dest.x, dest.y + MAGE_RADIUS * 1.4)
      .setAlpha(0.32)
      .setTint(MENU_COLOR.brassLight)
      .setVisible(true);
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
      if (this.mode === 'subtarget-point' && this.subtargetDirections?.length) {
        const selected = closestMindLightningDirection(
          { x: this.pointer.x - origin.x, y: this.pointer.y - origin.y },
          this.subtargetDirections
        );
        const markerDistance = 76;
        for (const direction of this.subtargetDirections) {
          const active = direction === selected;
          const marker = {
            x: origin.x + direction.x * markerDistance,
            y: origin.y + direction.y * markerDistance,
          };
          g.lineStyle(active ? 4 : 2, active ? 0x72c7ff : 0x317fbf, active ? 1 : 0.66)
            .lineBetween(origin.x, origin.y, marker.x, marker.y);
          g.fillStyle(active ? 0xbbe7ff : 0x173d68, active ? 0.95 : 0.82)
            .fillCircle(marker.x, marker.y, active ? 8 : 6);
          g.lineStyle(2, 0x72c7ff, active ? 1 : 0.72).strokeCircle(marker.x, marker.y, active ? 11 : 8);
        }
        const pointerDistance = Math.max(markerDistance, dist(origin, this.pointer));
        const guideDistance = Math.min(this.subtargetRange, pointerDistance);
        this.drawAimGuide(g, origin, {
          x: origin.x + selected.x * guideDistance,
          y: origin.y + selected.y * guideDistance,
        });
        return;
      }
      if (this.subtargetRange > 0 && Number.isFinite(this.subtargetRange)) {
        this.drawMeasuredRange(g, origin, this.subtargetRange);
      }
      if (this.subtargetMinRange > 0) {
        this.drawMeasuredRange(g, origin, this.subtargetMinRange, MENU_COLOR.blood, 0.55, false);
      }
      this.drawAimGuide(g, origin, this.pointer);
      const releasing = this.channelAimSpell;
      if (releasing?.aoe && this.mode === 'subtarget-point') {
        this.drawAoePreview(g, origin, stepTowards(origin, this.pointer, this.subtargetRange), releasing.aoe);
      }
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
    if (this.mode === 'aiming-move') {
      range = me.moveRange();
      const path = this.previewMovePath(me);
      for (let index = 1; index < path.length - 1; index++) {
        g.lineStyle(3, MENU_COLOR.pitch, 0.72).lineBetween(path[index - 1].x, path[index - 1].y, path[index].x, path[index].y);
        g.lineStyle(1, MENU_COLOR.brassLight, 0.9).lineBetween(path[index - 1].x, path[index - 1].y, path[index].x, path[index].y);
      }
      this.drawAimGuide(g, path[Math.max(0, path.length - 2)], path[path.length - 1]);
    } else if (this.mode === 'aiming-leap') {
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
      if (spell) range = this.gs.spellReach(spell, this.reactionAiming ? this.aimingSource ?? me : me);
    } else if (this.mode === 'aiming-wall') {
      if (this.pendingSpell) range = this.gs.spellReach(this.pendingSpell, me);
    } else if (this.mode === 'aiming-staff' && this.staffPending) {
      range = getItem(this.staffPending.item).staffBolts?.[this.staffPending.bolt]?.rangePx ?? 0;
    } else if (this.mode === 'aiming-hex') {
      const hex = this.pendingHex();
      if (hex) range = hexRange(hex);
    } else {
      const spell = this.currentComboSpell();
      if (spell && spell.range > 0) range = this.gs.spellReach(spell, me);
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
        const reach = Number.isFinite(spell.range) ? this.gs.spellReach(spell, me) : 99999;
        const toward = stepTowards(me.pos, this.pointer, reach);
        this.drawAoePreview(g, me.pos, toward, spell.aoe);
      }
    }
    if (aiming && this.mode === 'aiming-spell') {
      const spell = this.reactionAiming ? this.reactionPendingSpell : this.pendingSpell;
      const hovered = spell?.aoe ? this.clickedMage(this.pointer, null) : null;
      if (spell?.aoe && hovered) this.drawAoePreview(g, me.pos, hovered.pos, spell.aoe);
    }
    if (aiming && this.mode === 'aiming-edgelord-throw') {
      const toward = stepTowards(me.pos, this.pointer, range);
      g.fillStyle(0x160f22, 0.22).fillCircle(toward.x, toward.y, 5 * RANGE_UNIT);
      g.lineStyle(2, 0x8a5aa5, 0.9).strokeCircle(toward.x, toward.y, 5 * RANGE_UNIT);
    }
    if (aiming && this.mode === 'aiming-hex') {
      const hex = this.pendingHex();
      if (hex && hexAim(hex) === 'point') {
        const at = stepTowards(me.pos, this.pointer, hexRange(hex));
        const radius = hexRadius(hex);
        const color = hexColor(hex);
        const spin = (this.time.now / 1400) % (Math.PI * 2);
        g.fillStyle(color, 0.12).fillCircle(at.x, at.y, radius);
        g.lineStyle(2, color, 0.9).strokeCircle(at.x, at.y, radius);
        g.lineStyle(1, color, 0.5).strokeCircle(at.x, at.y, radius * 0.78);
        for (let mark = 0; mark < 12; mark++) {
          const angle = spin + (mark / 12) * Math.PI * 2;
          const inner = radius * (mark % 3 === 0 ? 0.66 : 0.72);
          g.lineBetween(at.x + Math.cos(angle) * inner, at.y + Math.sin(angle) * inner, at.x + Math.cos(angle) * radius * 0.78, at.y + Math.sin(angle) * radius * 0.78);
        }
      }
    }

    // Rotatable rectangular wall preview (blue Wall ability).
    if (aiming && this.mode === 'aiming-wall' && this.pendingSpell?.rotatableWall) {
      const dims = this.pendingSpell.rotatableWall;
      const center = stepTowards(me.pos, this.pointer, this.gs.spellReach(this.pendingSpell, me));
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
    createCreatureAnims(this);
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
        // Stave and string only: the nocked shaft is drawn separately so it can
        // be hauled back on its own during a draw.
        g.lineStyle(1, binding, 1);
        g.lineBetween(11, 4, 18, 16);
        g.lineBetween(18, 16, 12, 29);
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
    this.buildArrowTexture();
  }

  /** One loosed shaft, drawn pointing right so it can be rotated to its heading. */
  private buildArrowTexture(): void {
    if (this.textures.exists('fx-arrow')) return;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x3a2417, 1).fillRect(4, 5, 22, 3);
    g.fillStyle(0x87552c, 1).fillRect(4, 5, 22, 2);
    g.fillStyle(0xe0bd78, 1).fillRect(2, 4, 6, 1).fillRect(2, 8, 6, 1);
    g.fillStyle(0x424a50, 1).fillTriangle(24, 2, 32, 6.5, 24, 11);
    g.fillStyle(0xe1e7e5, 1).fillTriangle(25, 4, 30, 6.5, 25, 9);
    g.generateTexture('fx-arrow', 32, 13);
    g.destroy();
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
    if (rec.heldLocked) {
      rec.held.setAlpha(alpha).setVisible(true);
      return;
    }

    const facing = rec.sprite.flipX ? -1 : 1;
    const visualScale = mage.mine ? mineEnemyVisual(mage).scale : rec.sprite.scaleX / rec.baseScale;
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
    const size = baseSize[kind] * Phaser.Math.Clamp(visualScale, 0.8, 1.6);
    const attacking = rec.lock === 'attack';
    rec.held
      .setDisplaySize(size, size)
      .setPosition(
        rec.sprite.x + facing * MAGE_RADIUS * 0.48 * visualScale,
        rec.sprite.y - MAGE_RADIUS * 1.15 * visualScale + (attacking ? 3 : 0)
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

  /** A body an arrow has just buried itself in, whose impact art already ran. */
  private arrowStruck: Mage | null = null;

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
    const nativeFacesRight = !!kind && creatureFacesRight(kind);
    if (nearest && nearest.x !== mage.x) {
      const targetIsRight = nearest.x > mage.x;
      return nativeFacesRight ? !targetIsRight : targetIsRight;
    }
    return nativeFacesRight ? mage.team !== 1 : mage.team === 1;
  }

  /** Create/position each mage's sprite and pick its resting animation. */
  private syncMageSprites(): void {
    if (!this.gs) return;
    this.gs.syncCarriedSummons();
    const roster = new Set(this.gs.mages);
    for (const [mage, rec] of this.mageAnims) {
      if (roster.has(mage)) continue;
      rec.sprite.destroy();
      rec.held?.destroy();
      rec.root?.destroy();
      rec.stun?.destroy();
      rec.guard?.destroy();
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
      ensureCreatureSprites(this, creatureSpriteKind(m));
      let rec = this.mageAnims.get(m);
      if (!rec) {
        const customCreature = creatureSpriteKind(m) !== null;
        const idleKey = bodyAnimationKey(m, 'idle');
        const kind = creatureSpriteKind(m);
        const sprite = this.add
          .sprite(m.x, m.y, kind ? creatureTexture(kind) : 'mage-idle-0')
          .setOrigin(0.5, customCreature ? 0.9 : 1)
          .setDepth(5);
        if (m.bossArt) bindBossIdleSpecial(sprite, m.bossArt);
        sprite.play(idleKey);
        const srcH = sprite.height || 1;
        const baseScale = ((customCreature ? CREATURE_SPRITE_HEIGHT : MAGE_RADIUS * 2.8) / srcH)
          * (m.summonKind === 'sentry' ? 0.5 : 1);
        sprite.setScale(baseScale);
        rec = {
          sprite,
          baseScale,
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
      const shoulderOwner = m.summonShoulder != null ? this.gs.mages[m.summonOwnerIndex ?? -1] : undefined;
      const shoulderBody = shoulderOwner ? this.mageAnims.get(shoulderOwner)?.sprite : undefined;
      if (shoulderOwner) {
        rec.shoulderScale ??= s.scaleX;
        s.setScale(MAGE_RADIUS * 0.95 / (s.height || 1));
      } else if (rec.shoulderScale != null) {
        s.setScale(rec.shoulderScale);
        rec.shoulderScale = undefined;
      }
      if (!shoulderOwner && !m.isSummon && !m.isAI && !m.sceneSide && !m.enemyKind && !m.mine && !m.bossArt) {
        const hpScale = m.maxHp < 15
          ? 0.8 + 0.2 * Math.max(0, (m.maxHp - 9) / 6)
          : m.maxHp <= 20 ? 1 : 1 + 0.6 * Math.min(1, (m.maxHp - 20) / 15);
        s.setScale(rec.baseScale * hpScale);
      }
      s.setDepth(shoulderOwner ? 5.2 : 5);
      s.setOrigin(0.5, m.enemyKind === 'moay' && m.bossArt ? bossSheet(m.bossArt).originY : customCreature ? 0.9 : 1);
      if (m.alive && (rec.deathPending || rec.deathComplete || rec.lock === 'death')) {
        this.tweens.killTweensOf(s);
        rec.deathPending = false;
        rec.deathComplete = false;
        if (rec.lock === 'death') rec.lock = null;
        s.setAngle(0);
      }
      if (m.mine) this.styleMineEnemySprite(m);
      // A position-locked animation owns where the body stands and which way
      // it faces, so a mid-swing redraw cannot spin it back to its team side.
      if (!rec.posLocked) {
        s.setPosition(
          shoulderOwner ? (shoulderBody?.x ?? m.x) + (m.summonShoulder === 0 ? -1 : 1) * MAGE_RADIUS * 0.78 : m.x,
          shoulderOwner ? (shoulderBody?.y ?? m.y + footY) - MAGE_RADIUS * 1.6 : m.y + footY + this.mineSpriteBob(m)
        );
        s.setFlipX(customCreature ? this.creatureShouldFlipX(m) : m.team !== 1);
      }
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
        rec.guard?.destroy();
        rec.guard = undefined;
        continue;
      }
      if (m.unseen) {
        s.setVisible(false);
        rec.held?.setVisible(false);
        rec.root?.setVisible(false);
        rec.stun?.setVisible(false);
        rec.guard?.setVisible(false);
        continue;
      }
      s.setVisible(true);
      const alpha = this.mageVisibilityAlpha(m);
      s.setAlpha(alpha);
      if (shoulderOwner) {
        rec.held?.setVisible(false);
        rec.root?.setVisible(false);
        rec.stun?.setVisible(false);
        rec.guard?.setVisible(false);
      } else {
        this.syncHeldWeapon(m, rec, alpha);
        this.syncRootOverlay(m, rec, footY, alpha);
        this.syncStunOverlay(m, rec, alpha);
        this.syncGuardOverlay(m, rec, alpha);
      }
      // Resting animation: charge while a spell is pending, otherwise idle.
      if (rec.lock === null) {
        const current = s.anims.currentAnim?.key;
        const want = !rec.charging && m.bossArt && bossIsIdleSpecial(m.bossArt, current)
          ? current : bodyAnimationKey(m, rec.charging ? 'charge' : 'idle');
        if (s.anims.currentAnim?.key !== want) s.play(want, true);
        // Roots hold the body fast, so its resting loop stops dead.
        if (this.isPhysicallyRooted(m) || this.gs.isTimeStopped(m)) s.anims.stop();
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
    if (!m.alive || m.unseen || !this.isPhysicallyRooted(m)) {
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
    if (!m.alive || m.unseen || !stunned) {
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

  /** A braced ward held over a mage for as long as its shield block is armed. */
  private syncGuardOverlay(m: Mage, rec: MageAnim, alpha: number): void {
    if (!m.alive || m.unseen || !m.blockPending) {
      if (rec.guard) this.breakGuard(rec.guard);
      rec.guard = undefined;
      return;
    }
    this.buildGuardTexture();
    if (!rec.guard) {
      const size = MAGE_RADIUS * 3.4;
      rec.guard = this.add
        .image(rec.sprite.x, rec.sprite.y, 'fx-guard')
        .setDepth(5.15)
        .setDisplaySize(size, size)
        .setBlendMode(Phaser.BlendModes.ADD);
      if (!this.reducedMotion) {
        this.tweens.add({
          targets: rec.guard,
          alpha: { from: 0.85, to: 0.42 },
          duration: 620,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.InOut',
        });
      }
    }
    const bodyHeight = creatureSpriteKind(m) ? CREATURE_SPRITE_HEIGHT : MAGE_RADIUS * 2.8;
    rec.guard
      .setPosition(rec.sprite.x, rec.sprite.y - bodyHeight * 0.45)
      .setVisible(true);
    if (this.reducedMotion) rec.guard.setAlpha(alpha * 0.7);
  }

  /** Let a spent ward flare and fly apart instead of blinking out of existence. */
  private breakGuard(guard: Phaser.GameObjects.Image): void {
    this.tweens.killTweensOf(guard);
    if (this.reducedMotion) {
      guard.destroy();
      return;
    }
    this.particleFx?.burst({ x: guard.x, y: guard.y }, {
      color: MENU_COLOR.brassLight,
      count: 10,
      speed: 190,
      lifespan: 380,
      shape: 'shard',
      size: 10,
      glow: true,
      drag: 0.7,
      depth: 9.5,
    });
    this.tweens.add({
      targets: guard,
      alpha: 0,
      scale: guard.scale * 1.35,
      duration: 200,
      ease: 'Quad.Out',
      onComplete: () => guard.destroy(),
    });
  }

  /** A faceted brass ward, drawn once and reused by every raised shield. */
  private buildGuardTexture(): void {
    if (this.textures.exists('fx-guard')) return;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const centre = 32;
    const facets = 6;
    const point = (radius: number, index: number): { x: number; y: number } => {
      const a = (Math.PI * 2 * index) / facets - Math.PI / 2;
      return { x: centre + Math.cos(a) * radius, y: centre + Math.sin(a) * radius };
    };
    for (const [radius, width, alphaLevel] of [[29, 3, 0.9], [22, 1, 0.45]] as const) {
      g.lineStyle(width, MENU_COLOR.brassLight, alphaLevel);
      for (let i = 0; i < facets; i++) {
        const from = point(radius, i);
        const to = point(radius, i + 1);
        g.lineBetween(from.x, from.y, to.x, to.y);
      }
    }
    g.fillStyle(MENU_COLOR.brassLight, 0.9);
    for (let i = 0; i < facets; i++) {
      const at = point(29, i);
      g.fillCircle(at.x, at.y, 2);
    }
    g.generateTexture('fx-guard', 64, 64);
    g.destroy();
  }

  /** A ward snapping up as a shield is braced against an incoming blow. */
  private playShieldRaise(reactor: Mage, from: Mage): void {
    playSound('shield.raise');
    if (this.reducedMotion) return;
    const { angle } = this.contactPoint(from.pos, reactor.pos);
    const at = {
      x: reactor.x - Math.cos(angle) * MAGE_RADIUS * 0.6,
      y: reactor.y - Math.sin(angle) * MAGE_RADIUS * 0.6 - MAGE_RADIUS * 0.5,
    };
    const ring = this.add.graphics({ x: at.x, y: at.y }).setDepth(9.5);
    ring.lineStyle(3, MENU_COLOR.brassLight, 0.95).strokeCircle(0, 0, MAGE_RADIUS * 1.5);
    this.tweens.add({
      targets: ring,
      scale: { from: 1.5, to: 1 },
      alpha: { from: 0, to: 1 },
      duration: 170,
      ease: 'Quad.Out',
      onComplete: () => {
        this.tweens.add({
          targets: ring,
          alpha: 0,
          duration: 160,
          onComplete: () => ring.destroy(),
        });
      },
    });
  }

  /**
   * A shield bash: the brace drives into the attacker and the two bodies clash.
   * The bash's own damage is flushed here so it lands with the shove instead of
   * queueing up behind the blow it answered.
   */
  private async playShieldBash(basher: Mage, attacker: Mage): Promise<void> {
    const rec = this.mageAnims.get(basher);
    const { angle, contact } = this.contactPoint(basher.pos, attacker.pos);
    playSound('shield.bash');

    if (rec && !this.reducedMotion) {
      const footY = MAGE_RADIUS * 1.4;
      const home = { x: basher.x, y: basher.y + footY };
      const shove = {
        x: home.x + Math.cos(angle) * MELEE_SWING.lungePx * 0.8,
        y: home.y + Math.sin(angle) * MELEE_SWING.lungePx * 0.8,
      };
      this.faceStrike(rec, basher, attacker.pos);
      rec.posLocked = true;
      rec.heldLocked = !!rec.held;
      await this.strikePhase(
        rec, home, shove,
        MELEE_SWING.recover.pose, MELEE_SWING.recover.pose,
        90, 'Quad.In'
      );
      void this.strikePhase(
        rec, shove, home,
        MELEE_SWING.recover.pose, MELEE_SWING.recover.pose,
        MELEE_SWING.recover.ms, MELEE_SWING.recover.ease
      ).then(() => this.endWeaponAttack(rec));
    }

    if (!this.reducedMotion) {
      const centre = Phaser.Math.RadToDeg(angle);
      this.particleFx?.burst(contact, {
        color: MENU_COLOR.brassLight,
        count: 11,
        speed: 300,
        lifespan: 280,
        shape: 'spark',
        size: 17,
        glow: true,
        drag: 0.88,
        alignToTravel: true,
        angle: { min: centre - 52, max: centre + 52 },
        depth: 9.6,
      });
    }
    await this.flushHits();
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
    // Two bodies on the same spot give no heading, and a fabricated one would
    // point directional art off in an arbitrary direction.
    const angle = source && source !== mage && dist(source.pos, mage.pos) > 1
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

  /** The face of a body a known blow landed on, so its art meets the weapon. */
  private struckSide(mage: Mage, angle: number | undefined): Vec2 {
    if (angle == null) return { x: mage.x, y: mage.y };
    return {
      x: mage.x - Math.cos(angle) * MAGE_RADIUS * 0.4,
      y: mage.y - Math.sin(angle) * MAGE_RADIUS * 0.4,
    };
  }

  /**
   * Play every queued impact reaction and clear the queue. A burst that
   * reaches several bodies staggers their recoils into a readable cascade
   * instead of popping all at once, and logs one line covering the volley.
   */
  private flushImpacts(): Promise<void> {
    const queued = this.pendingImpacts;
    this.pendingImpacts = [];
    // An arrow already painted its puncture on arrival. Every wound it opened
    // is claimed, not just the first, and a miss clears the claim unused.
    const claimed = this.arrowStruck;
    this.arrowStruck = null;
    if (queued.length === 0) return Promise.resolve();
    this.logAoeSummary(queued);
    let shaken = false;
    const seen = new Set<Mage>();
    let remaining = queued.length;
    return new Promise<void>((resolve) => {
      for (const impact of queued) {
        seen.add(impact.mage);
        const delay = this.reducedMotion ? 0 : (seen.size - 1) * AOE_STAGGER_MS;
        this.time.delayedCall(delay, () => {
          this.combatFeedback?.show(impact.mage, impact.feedback);
          if (this.impactFx) {
            // One blast that hits six bodies is still one blast: shake once.
            const weight = shaken ? undefined : impact.weight;
            if (weight) shaken = true;
            this.impactFx.play({
              at: this.struckSide(impact.mage, impact.angle),
              feedback: impact.feedback,
              severity: impact.severity,
              angle: impact.angle,
              weight,
              art: impact.mage !== claimed,
              sprite: this.mageAnims.get(impact.mage)?.sprite,
            });
          }
          if (--remaining === 0) resolve();
        });
      }
    });
  }

  /** When a single action reaches more than one body, log the volley as one line. */
  private logAoeSummary(queued: QueuedImpact[]): void {
    const hits = queued.filter(
      (impact) =>
        (impact.feedback.kind === 'damage' || impact.feedback.kind === 'sanityDamage') &&
        (impact.feedback.amount ?? 0) > 0
    );
    const targets = new Set(hits.map((impact) => impact.mage));
    if (targets.size < 2) return;
    const total = hits.reduce((sum, impact) => sum + (impact.feedback.amount ?? 0), 0);
    this.gs.log(`${targets.size} targets hit for ${total} total damage.`);
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
        // A blow that got through armour or a raised shield still rang off it.
        if (feedback.label === 'BLOCKED' || feedback.label === 'ARMOUR') {
          this.pendingSounds.push('hit.block');
        }
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
  private flushHits(): Promise<void> {
    return this.flushHitsAndEffects();
  }

  /** Start queued recoils and await every associated overlay and drain stream. */
  private async flushHitsAndEffects(): Promise<void> {
    const queued = this.pendingHits;
    this.pendingHits = [];
    this.flushSounds();
    const impacts = this.flushImpacts();
    for (const m of queued) this.triggerHit(m);
    await Promise.all([impacts, this.flushEffects()]);
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
      ...drains.map((drain) => this.spellVfx.drainParticles(drain.from, drain.to)),
      ...summonPuffs.map((puff) => this.spellVfx.summonPuff(puff.at, puff.size)),
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
    const swings = m.bossArt ? bossAttackKeys(m.bossArt) : [];
    const key = swings.length > 1 ? swings[(rec.swings ?? 0) % swings.length] : bodyAnimationKey(m, 'attack');
    if (swings.length > 1) rec.swings = (rec.swings ?? 0) + 1;
    rec.sprite.play(key, true);
    rec.sprite.once(`animationcomplete-${key}`, () => {
      if (rec.lock === 'attack') rec.lock = null;
    });
  }

  /**
   * Hold a body for a basic weapon strike. The mage attack strip swings a wand,
   * which has nothing to do with the sword or bow actually in hand, so only
   * creatures — whose strips are their own bodies — play theirs. The lock is
   * released by whichever strike opened it.
   */
  private startWeaponAttack(m: Mage): void {
    if (creatureSpriteKind(m)) {
      this.startBodyAttack(m);
      return;
    }
    const rec = this.mageAnims.get(m);
    if (!rec || !m.alive) return;
    rec.charging = false;
    rec.lock = 'attack';
    rec.sprite.play(bodyAnimationKey(m, 'idle'), true);
  }

  /** Hand a body back after a strike: the lunge, the weapon and the lock. */
  private endWeaponAttack(rec: MageAnim): void {
    rec.posLocked = false;
    rec.heldLocked = false;
    // A boss with swings of its own finishes the swing; its completion hands the body back.
    if (rec.swings != null && rec.sprite.anims.isPlaying) return;
    if (rec.lock === 'attack') rec.lock = null;
  }

  /** Hold the weapon in a pose: rotation is mirrored by facing. */
  private poseHeldWeapon(rec: MageAnim, rot: number, lift: number, reach: number): void {
    const held = rec.held;
    if (!held) return;
    const facing = rec.sprite.flipX ? -1 : 1;
    held
      .setPosition(
        rec.sprite.x + facing * (MAGE_RADIUS * 0.48 + reach),
        rec.sprite.y - MAGE_RADIUS * 1.15 + lift
      )
      .setFlipX(facing < 0)
      .setRotation(facing * rot);
  }

  /** A dimming copy of the weapon left behind in the arc it just cut. */
  private dropWeaponGhost(rec: MageAnim): void {
    const held = rec.held;
    if (!held || !rec.heldVisualKey) return;
    const ghost = this.add
      .image(held.x, held.y, rec.heldVisualKey)
      .setOrigin(held.originX, held.originY)
      .setDisplaySize(held.displayWidth, held.displayHeight)
      .setFlipX(held.flipX)
      .setRotation(held.rotation)
      .setAlpha(MELEE_SWING.trail.alpha)
      .setTint(0xd9e6ef)
      .setDepth(5.15);
    this.tweens.add({
      targets: ghost,
      alpha: 0,
      duration: MELEE_SWING.trail.fadeMs,
      ease: 'Quad.Out',
      onComplete: () => ghost.destroy(),
    });
  }

  /**
   * One leg of a strike: glide the body between two points while the weapon
   * eases between two poses, so the arm and the blade move as one thing.
   */
  private strikePhase(
    rec: MageAnim,
    from: Vec2,
    to: Vec2,
    fromPose: { rot: number; lift: number; reach: number },
    toPose: { rot: number; lift: number; reach: number },
    duration: number,
    ease: string,
    ghosts = 0,
    onStep?: (t: number) => void,
  ): Promise<void> {
    return new Promise((resolve) => {
      const p = { t: 0 };
      let dropped = 0;
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.events.off(Phaser.Scenes.Events.SHUTDOWN, finish);
        resolve();
      };
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, finish);
      this.tweens.add({
        targets: p,
        t: 1,
        duration,
        ease,
        onUpdate: () => {
          rec.sprite.setPosition(
            Phaser.Math.Linear(from.x, to.x, p.t),
            Phaser.Math.Linear(from.y, to.y, p.t)
          );
          this.poseHeldWeapon(
            rec,
            Phaser.Math.Linear(fromPose.rot, toPose.rot, p.t),
            Phaser.Math.Linear(fromPose.lift, toPose.lift, p.t),
            Phaser.Math.Linear(fromPose.reach, toPose.reach, p.t)
          );
          while (dropped < ghosts && p.t >= (dropped + 1) / (ghosts + 1)) {
            dropped += 1;
            this.dropWeaponGhost(rec);
          }
          onStep?.(p.t);
        },
        onComplete: finish,
        onStop: finish,
      });
    });
  }

  /** Where a blow aimed from `from` actually meets the body standing at `at`. */
  private contactPoint(from: Vec2, at: Vec2): { angle: number; contact: Vec2 } {
    const gap = dist(from, at);
    if (gap < 1) return { angle: 0, contact: { ...at } };
    const angle = Math.atan2(at.y - from.y, at.x - from.x);
    return {
      angle,
      contact: {
        x: at.x - Math.cos(angle) * MAGE_RADIUS * 0.72,
        y: at.y - Math.sin(angle) * MAGE_RADIUS * 0.72,
      },
    };
  }

  /** Turn a body toward what it is striking, honouring each sheet's own facing. */
  private faceStrike(rec: MageAnim, source: Mage, at: Vec2, from: Vec2 = source.pos): void {
    const kind = creatureSpriteKind(source);
    const nativeFacesRight = !kind || creatureFacesRight(kind);
    const targetIsRight = at.x > from.x;
    rec.sprite.setFlipX(nativeFacesRight ? !targetIsRight : targetIsRight);
  }

  /** The moment the weapon bites: the arc, the sparks and the cut itself. */
  private strikeContact(at: Vec2, angle: number): void {
    playSound('melee.contact');
    if (this.anims.exists('fx-slash-arc')) {
      void this.spellVfx.slash('fx-slash-arc', at, angle, MAGE_RADIUS * 3.6);
    }
    if (this.reducedMotion) return;
    const centre = Phaser.Math.RadToDeg(angle);
    this.particleFx?.burst(at, {
      color: 0xf6ecd2,
      count: 9,
      speed: 320,
      lifespan: 250,
      shape: 'spark',
      size: 19,
      glow: true,
      drag: 0.9,
      alignToTravel: true,
      angle: { min: centre - 44, max: centre + 44 },
      depth: 9.6,
    });
  }

  /**
   * A basic weapon strike played as one motion: the body coils away from its
   * target, drives through it, and the arc lands where the weapon meets flesh.
   * Resolves on contact so the damage that follows reads as this blow landing.
   */
  private async playMoayStomp(source: Mage, at: Vec2): Promise<void> {
    const rec = this.mageAnims.get(source);
    if (rec) this.faceStrike(rec, source, at);
    const foot = { x: source.x, y: source.y + MAGE_RADIUS * 1.4 };
    await this.delay(120);
    playSound('melee.contact');
    void this.spellVfx.burst(foot, 0xb5b08a, source.bodyRadius() * 2, this.combatSpeed);
    if (!this.reducedMotion) {
      this.cameras.main.shake(140 / this.combatSpeed, 0.003);
      this.particleFx?.burst(foot, {
        color: 0x827e5b,
        count: 14,
        speed: 140,
        lifespan: 320,
        shape: 'spark',
        size: 8,
        drag: 0.9,
        angle: { min: 0, max: 360 },
        depth: 5.1,
      });
    }
    await this.spellVfx.burst(at, 0xaaa481, MOAY_AOE_RADIUS, this.combatSpeed);
  }

  private async playMeleeStrike(source: Mage, at: Vec2): Promise<void> {
    const rec = this.mageAnims.get(source);
    const from = { x: source.x, y: source.y };
    const { angle, contact } = this.contactPoint(from, at);
    this.startWeaponAttack(source);

    if (!rec || this.reducedMotion) {
      playSound('melee.swing');
      this.strikeContact(contact, angle);
      await this.delay(MELEE_SWING.contactMs);
      if (rec) this.endWeaponAttack(rec);
      return;
    }

    const footY = MAGE_RADIUS * 1.4;
    const home = { x: source.x, y: source.y + footY };
    const along = (px: number): Vec2 => ({
      x: home.x + Math.cos(angle) * px,
      y: home.y + Math.sin(angle) * px,
    });
    const step = Phaser.Math.Clamp(dist(from, at) - MAGE_RADIUS * 1.6, 0, MELEE_SWING.lungePx);
    this.faceStrike(rec, source, at);
    rec.posLocked = true;
    rec.heldLocked = !!rec.held;

    await this.strikePhase(
      rec, home, along(-MELEE_SWING.coilPx),
      MELEE_SWING.recover.pose, MELEE_SWING.coil.pose,
      MELEE_SWING.coil.ms, MELEE_SWING.coil.ease
    );
    playSound('melee.swing');
    await this.strikePhase(
      rec, along(-MELEE_SWING.coilPx), along(step),
      MELEE_SWING.coil.pose, MELEE_SWING.strike.pose,
      MELEE_SWING.strike.ms, MELEE_SWING.strike.ease,
      MELEE_SWING.trail.count
    );

    this.strikeContact(contact, angle);
    void this.strikePhase(
      rec, along(step), home,
      MELEE_SWING.strike.pose, MELEE_SWING.recover.pose,
      MELEE_SWING.recover.ms, MELEE_SWING.recover.ease
    ).then(() => this.endWeaponAttack(rec));
    await this.delay(MELEE_SWING.contactMs);
  }

  /** Where a nocked shaft sits: on the stave if it is drawn, else at the chest. */
  private bowNock(rec: MageAnim | undefined, source: Mage): Vec2 {
    const held = rec?.held;
    // The grip anchor sits near the foot of the sprite; an arrow rests mid-stave.
    if (held?.visible) return { x: held.x, y: held.y - held.displayHeight * 0.28 };
    return { x: source.x, y: source.y - MAGE_RADIUS * 0.95 };
  }

  /**
   * A bow shot: level the stave, haul the string back with a shaft on it, loose,
   * and let the arrow carry the distance. The wound lands with the arrow rather
   * than after the roll, so the shot reads as one event.
   */
  private async playBowShot(source: Mage, target: Mage | null, at: Vec2): Promise<void> {
    const rec = this.mageAnims.get(source);
    const from = { x: source.x, y: source.y };
    const { angle, contact } = this.contactPoint(from, at);
    this.startWeaponAttack(source);

    const land = async (nock: Vec2): Promise<void> => {
      await this.flyArrow(nock, contact, angle);
      playSound('melee.contact');
      // Claim this body's queued impact art: the puncture plays here, on arrival.
      this.arrowStruck = target;
      if (this.anims.exists('fx-arrow-impact')) {
        void this.spellVfx.slash('fx-arrow-impact', contact, angle, MAGE_RADIUS * 2.8);
      }
    };

    if (!rec || this.reducedMotion) {
      playSound('bow.release');
      await land(this.bowNock(rec, source));
      if (rec) this.endWeaponAttack(rec);
      return;
    }

    const footY = MAGE_RADIUS * 1.4;
    const home = { x: source.x, y: source.y + footY };
    this.faceStrike(rec, source, at);
    rec.posLocked = true;
    rec.heldLocked = !!rec.held;

    await this.strikePhase(
      rec, home, home,
      BOW_SHOT.recover.pose, BOW_SHOT.raise.pose,
      BOW_SHOT.raise.ms, BOW_SHOT.raise.ease
    );

    playSound('bow.draw');
    const shaft = this.textures.exists('fx-arrow')
      ? this.add.image(0, 0, 'fx-arrow').setDepth(5.25).setRotation(angle)
      : null;
    const drawShaft = (pull: number): void => {
      const n = this.bowNock(rec, source);
      shaft?.setPosition(n.x - Math.cos(angle) * pull, n.y - Math.sin(angle) * pull);
    };
    drawShaft(0);
    // Same pose either side: the stave is held dead still while the string goes back.
    await this.strikePhase(
      rec, home, home,
      BOW_SHOT.raise.pose, BOW_SHOT.raise.pose,
      BOW_SHOT.draw.ms, BOW_SHOT.draw.ease,
      0,
      (t) => drawShaft(BOW_SHOT.draw.pullPx * t)
    );
    await this.delay(BOW_SHOT.holdMs);

    playSound('bow.release');
    const nock = this.bowNock(rec, source);
    shaft?.destroy();
    void this.strikePhase(
      rec, home, home,
      BOW_SHOT.raise.pose, BOW_SHOT.loose.pose,
      BOW_SHOT.loose.ms, BOW_SHOT.loose.ease
    ).then(() =>
      this.strikePhase(
        rec, home, home,
        BOW_SHOT.loose.pose, BOW_SHOT.recover.pose,
        BOW_SHOT.recover.ms, BOW_SHOT.recover.ease
      )
    ).then(() => this.endWeaponAttack(rec));
    await land(nock);
  }

  /** Carry one arrow from the bow to the body it was loosed at. */
  private flyArrow(from: Vec2, to: Vec2, angle: number): Promise<void> {
    if (!this.textures.exists('fx-arrow')) return this.delay(70);
    return new Promise((resolve) => {
      const travel = dist(from, to);
      const duration = Phaser.Math.Clamp(
        (travel / BOW_SHOT.arrow.pixelsPerSecond) * 1000,
        BOW_SHOT.arrow.minMs,
        BOW_SHOT.arrow.maxMs
      );
      // A shaft that far outruns gravity still dips a little; the dip is what
      // stops the flight reading as a straight line slid across the board.
      const arc = this.reducedMotion ? 0 : Math.min(BOW_SHOT.arrow.arcPx, travel * 0.12);
      const ghosts = this.reducedMotion ? 0 : BOW_SHOT.arrow.ghosts;
      const shaft = this.add.image(from.x, from.y, 'fx-arrow').setDepth(9.5).setOrigin(0.5, 0.5);
      const p = { t: 0 };
      let last = { ...from };
      let dropped = 0;
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.events.off(Phaser.Scenes.Events.SHUTDOWN, finish);
        if (shaft.active) this.stickArrow(shaft);
        resolve();
      };
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, finish);
      this.tweens.add({
        targets: p,
        t: 1,
        duration,
        ease: 'Linear',
        onUpdate: () => {
          const x = Phaser.Math.Linear(from.x, to.x, p.t);
          const y = Phaser.Math.Linear(from.y, to.y, p.t) - arc * 4 * p.t * (1 - p.t);
          shaft.setPosition(x, y).setRotation(Math.atan2(y - last.y, x - last.x) || angle);
          last = { x, y };
          // At this speed the shaft would otherwise strobe; the ghosts read as
          // the streak between two frames.
          while (dropped < ghosts && p.t >= (dropped + 1) / (ghosts + 1)) {
            dropped += 1;
            const ghost = this.add.image(x, y, 'fx-arrow')
              .setDepth(9.4)
              .setRotation(shaft.rotation)
              .setAlpha(0.32)
              .setTint(0xd9e6ef);
            this.tweens.add({
              targets: ghost,
              alpha: 0,
              duration: 110,
              onComplete: () => ghost.destroy(),
            });
          }
        },
        onComplete: finish,
        onStop: finish,
      });
    });
  }

  /** Leave a landed shaft buried in what it struck for a beat. */
  private stickArrow(shaft: Phaser.GameObjects.Image): void {
    this.tweens.add({
      targets: shaft,
      alpha: 0,
      duration: BOW_SHOT.stickMs,
      ease: 'Quad.In',
      onComplete: () => shaft.destroy(),
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
  private animateMove(m: Mage, path: Vec2[]): Promise<void> {
    return new Promise((resolve) => {
      const rec = this.mageAnims.get(m);
      const distance = path.slice(1).reduce((total, point, index) => total + dist(path[index], point), 0);
      if (!rec || distance < 1) {
        resolve();
        return;
      }
      rec.lock = 'move';
      rec.posLocked = true;
      rec.sprite.play(bodyAnimationKey(m, 'run'), true);
      const strides = this.startFootfalls(m, distance, FX_MOTION.move.duration);
      const visual = { x: path[0].x, y: path[0].y };
      const to = path[path.length - 1];
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
          rec.sprite.setPosition(to.x, to.y + MAGE_RADIUS * 1.4);
          this.redraw();
          console.warn(`${m.name}'s movement tween timed out; snapped to its resolved destination.`);
        }
        resolve();
      };
      const onShutdown = (): void => {
        finish(false);
        if (rec.lock === 'move') {
          rec.lock = null;
          rec.posLocked = false;
        }
      };
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
      const walkLeg = (index: number): void => {
        if (settled) return;
        if (index >= path.length) return finish(false);
        const next = path[index];
        if (Math.abs(next.x - visual.x) > 0.01) this.faceStrike(rec, m, next, visual);
        tween = this.tweens.add({
          targets: visual,
          x: next.x,
          y: next.y,
          duration: FX_MOTION.move.duration * dist(path[index - 1], next) / distance,
          ease: 'Linear',
          onUpdate: () => {
            rec.sprite.setPosition(visual.x, visual.y + MAGE_RADIUS * 1.4);
            this.redraw();
          },
          onComplete: () => walkLeg(index + 1),
          onStop: () => finish(false),
        });
      };
      walkLeg(1);
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
        this.kickDust(this.mageVisualPosition(m), 3, 55);
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

  private hazardVisualPosition(zone: GameState['hazardZones'][number]): Vec2 {
    const carrier = zone.carrierIndex == null ? undefined : this.gs.mages[zone.carrierIndex];
    if (!carrier) return zone;
    const position = this.mageVisualPosition(carrier);
    return { x: zone.x + position.x - carrier.x, y: zone.y + position.y - carrier.y };
  }

  private mageVisualPosition(m: Mage): Vec2 {
    const rec = this.mageAnims.get(m);
    return rec?.lock === 'move' && rec.posLocked
      ? { x: rec.sprite.x, y: rec.sprite.y - MAGE_RADIUS * 1.4 }
      : m.pos;
  }

  private mageBarY(m: Mage): number {
    const sprite = m.enemyKind === 'moay' ? this.mageAnims.get(m)?.sprite : undefined;
    return sprite ? sprite.getTopLeft().y - 20 : this.mageVisualPosition(m).y - MAGE_RADIUS - 26;
  }

  private drawMage(g: Phaser.GameObjects.Graphics, m: Mage): void {
    if (m.summonShoulder != null) {
      this.mageLabels.get(m)?.setVisible(false);
      return;
    }
    const alpha = this.mageVisibilityAlpha(m);
    const teamColor = m.team === 1
      ? COLORS.team1
      : m.team === 2
        ? COLORS.team2
        : m.team === 3
          ? MENU_COLOR.verdigris
          : MENU_COLOR.amethyst;
    const active = m === this.gs.current && !this.gs.isOver;
    const position = this.mageVisualPosition(m);
    const bodyY = position.y + MAGE_RADIUS * 0.72;
    if (m.lightningMindStacks > 0) {
      const strength = Math.min(1, 0.28 + Math.log2(m.lightningMindStacks + 1) * 0.22);
      const pulse = this.reducedMotion ? 1 : 0.9 + Math.sin(this.time.now / 170) * 0.1;
      const thickness = 2 + Math.min(6, m.lightningMindStacks) * 0.7;
      g.lineStyle(thickness + 5, 0x0d4f9c, 0.18 * strength * alpha)
        .strokeEllipse(position.x, position.y, MAGE_RADIUS * 2.55, MAGE_RADIUS * 3.25);
      g.lineStyle(thickness, 0x4aa8ff, strength * pulse * alpha)
        .strokeEllipse(position.x, position.y, MAGE_RADIUS * 2.4, MAGE_RADIUS * 3.1);
    }
    g.fillStyle(MENU_COLOR.pitch, 0.62 * alpha).fillEllipse(position.x + 2, bodyY + 3, MAGE_RADIUS * 2.1, 13);
    if (m.shikigami && m.alive) this.drawShikigami(g, m, alpha);
    g.fillStyle(teamColor, 0.12 * alpha).fillEllipse(position.x, bodyY, MAGE_RADIUS * 2.35, 16);
    g.lineStyle(active ? 3 : 2, active ? MENU_COLOR.brassLight : teamColor, active ? alpha : 0.72 * alpha)
      .strokeEllipse(position.x, bodyY, MAGE_RADIUS * 2.4, 17);
    if (active) {
      const markerY = this.mageBarY(m) - 10;
      // The caret bobs so the eye finds the acting unit without reading the HUD.
      const bob = this.reducedMotion ? 0 : Math.sin(this.time.now / 260) * 3;
      const halo = 0.10 + (this.reducedMotion ? 0 : Math.sin(this.time.now / 340) * 0.05);
      g.lineStyle(2, MENU_COLOR.brassLight, Math.max(0, halo * 3) * alpha)
        .strokeEllipse(position.x, bodyY, MAGE_RADIUS * 3.1, 22);
      g.fillStyle(MENU_COLOR.brassLight, alpha);
      g.fillTriangle(position.x - 7, markerY - 7 + bob, position.x + 7, markerY - 7 + bob, position.x, markerY + 1 + bob);
      g.lineStyle(1, MENU_COLOR.ink, 0.8 * alpha)
        .lineBetween(position.x - 4, markerY - 5 + bob, position.x + 4, markerY - 5 + bob);
    }

    // The mage body itself is drawn by its animated sprite (see syncMageSprites).

    // Bars.
    const bw = 56;
    const bx = position.x - bw / 2;
    const by = this.mageBarY(m);
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

  /** The Shikigami on its rider's shoulder: a shade with two pale eyes that grows with its rank. */
  private drawShikigami(g: Phaser.GameObjects.Graphics, m: Mage, alpha: number): void {
    const rank = shikigamiTier(m.shikigami?.points ?? 0);
    const size = 5 + rank * 1.5;
    const sway = this.reducedMotion ? 0 : Math.sin(this.time.now / 420) * 1.5;
    const position = this.mageVisualPosition(m);
    const x = position.x + MAGE_RADIUS * 0.85;
    const y = position.y - MAGE_RADIUS * 0.55 + sway;
    g.fillStyle(0x140b1f, 0.92 * alpha).fillEllipse(x, y, size * 2, size * 2.3);
    g.lineStyle(1, 0x8f7ab8, 0.7 * alpha).strokeEllipse(x, y, size * 2, size * 2.3);
    g.fillStyle(0xe8e0ff, alpha).fillCircle(x - size * 0.35, y - size * 0.2, 1.4).fillCircle(x + size * 0.35, y - size * 0.2, 1.4);
  }

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

  private emblemLayer?: Phaser.GameObjects.Container;
  private emblemKey = '';
  private emblemHits: { x: number; y: number; size: number; text: string }[] = [];

  /** Hexcraft laws holding the field, as emblems under the turn order; hover one for its rules. */
  private drawHexEmblems(): void {
    const viewer = this.viewMage;
    const laws = this.gs.isOver ? [] : this.gs.hexcraftGlobals.filter((effect) => effect.roundsLeft > 0);
    const key = laws.map((effect) => `${effect.kind}:${effect.roundsLeft}:${effect.owner === viewer.team}`).join('|');
    if (this.emblemLayer?.active && key === this.emblemKey) return;
    this.emblemKey = key;
    this.emblemLayer?.destroy();
    this.emblemLayer = this.add.container(0, 0).setDepth(47);
    this.emblemHits = [];
    const size = 38;
    const gap = 6;
    const perRow = 8;
    const x0 = FIELD.x + 6;
    const y0 = FIELD.y + 40;
    laws.slice(0, perRow * 2).forEach((effect, index) => {
      const x = x0 + (index % perRow) * (size + gap);
      const y = y0 + Math.floor(index / perRow) * (size + gap);
      const ours = effect.owner === viewer.team;
      const tone = ours ? COLORS.team1 : COLORS.team2;
      const name = effect.kind === 'mindShadow'
        ? 'Mind Shadow'
        : effect.kind === 'curseCorrode'
          ? 'Curse Corrode'
          : HEX_LAW_NAMES[effect.kind];
      const rules = effect.kind === 'mindShadow'
        ? 'Shadow and sanity damage deal 2 more.'
        : effect.kind === 'curseCorrode'
          ? 'Any unit carrying a DoT is slowed by 75% for as long as it lasts, and each DoT tick also deals 1d3 corrosive damage.'
          : HEX_LAW_TEXT[effect.kind] ?? '';
      const caster = effect.ownerIndex != null ? this.gs.mages[effect.ownerIndex] : undefined;
      const g = this.add.graphics();
      g.fillStyle(MENU_COLOR.pitch, 0.85).fillRect(x + 2, y + 3, size, size);
      g.fillStyle(MENU_COLOR.woodDeep, 0.95).fillRect(x, y, size, size);
      g.lineStyle(2, tone, 1).strokeRect(x + 1, y + 1, size - 2, size - 2);
      g.lineStyle(1, MENU_COLOR.brassLight, 0.5).strokeRect(x + 4.5, y + 4.5, size - 9, size - 9);
      g.fillStyle(tone, 1).fillCircle(x + size - 4, y + size - 4, 8);
      const initials = name
        .replace(/^The /, '')
        .split(/\s+/)
        .map((word) => word[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();
      const glyph = this.add.text(x + size / 2 - 2, y + size / 2 - 2, initials, {
        fontFamily: MENU_FONT.display,
        fontSize: '15px',
        fontStyle: 'bold',
        color: MENU_HEX.brassLight,
      }).setOrigin(0.5);
      const rounds = this.add.text(x + size - 4, y + size - 4, String(effect.roundsLeft), {
        fontFamily: MENU_FONT.control,
        fontSize: '10px',
        fontStyle: 'bold',
        color: MENU_HEX.ink,
      }).setOrigin(0.5);
      this.emblemLayer?.add([g, glyph, rounds]);
      this.emblemHits.push({
        x,
        y,
        size,
        text: [
          `${name}  ·  ${effect.roundsLeft} round${effect.roundsLeft === 1 ? '' : 's'} left`,
          `${ours ? 'Your side' : 'Foes'}${caster ? ` · placed by ${caster.name}` : ''}`,
          rules,
        ].filter(Boolean).join('\n'),
      });
    });
    const hidden = laws.length - perRow * 2;
    if (hidden > 0) {
      this.emblemLayer.add(this.add.text(x0, y0 + 2 * (size + gap), `+${hidden} more`, {
        fontFamily: MENU_FONT.control,
        fontSize: '11px',
        color: MENU_HEX.boneDim,
      }));
    }
  }

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
    const statusEntries = [
      ...(m.lightningMindStacks > 0 ? [`MIND LIGHTNING ×${m.lightningMindStacks}`] : []),
      ...(m.shikigami ? [`SHIKIGAMI ${m.shikigami.points}`] : []),
      ...m.statuses
      .map((s) =>
        s.kind === 'fire' ||
        s.kind === 'sentinelFire' ||
        s.kind === 'blueflare' ||
        s.kind === 'soulRend' ||
        s.kind === 'reap' ||
        s.kind === 'dread' ||
        s.kind === 'deathCurse'
          ? `${s.name} ×${s.stacks}`
          : s.kind === 'imbue'
            ? s.charges != null ? `${s.name} ×${s.charges}` : s.name
            : Number.isFinite(s.duration) && s.duration > 0
              ? `${s.name} ⌛${s.duration}`
              : s.name
          ),
    ];
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
    const fleeing = m.fleeChannel ? `WITHDRAWING ${FLEE_EDGE_LABEL[m.fleeChannel].toUpperCase()}` : '';
    const denial = denialLabel(m);
    const crusade = crusadeLabel(this.gs.mages, m);
    t.setText(
      `${m.name}${mineDetails ? ` · ${mineDetails}` : ''}${denial ? `\n${denial}` : ''}${crusade ? `\n${crusade}` : ''}${lantern ? `\n${lantern}` : ''}${wings ? `\n${wings}` : ''}${fleeing ? `\n${fleeing}` : ''}${statuses ? `\n${statuses}` : ''}`
    );
    t.setColor(m.hp / Math.max(1, m.maxHp) <= 0.25 ? '#d99286' : MENU_HEX.bone);
    const position = this.mageVisualPosition(m);
    t.setPosition(position.x, position.y + MAGE_RADIUS + 15).setVisible(true);
  }

  private initiativeLabels: Phaser.GameObjects.Text[] = [];

  /**
   * Turn order along the top-left of the field. Without it the initiative roll
   * is computed and then hidden, so nobody can plan more than one turn ahead.
   */
  private drawInitiative(g: Phaser.GameObjects.Graphics): void {
    const order = this.gs.isOver ? [] : this.gs.upcomingTurns(7);
    for (let i = order.length; i < this.initiativeLabels.length; i++) {
      this.initiativeLabels[i].setVisible(false);
    }
    if (order.length <= 1) return;
    const chipW = 78;
    const chipH = 20;
    const x0 = FIELD.x + 10;
    const y0 = FIELD.y + 8;
    g.fillStyle(MENU_COLOR.pitch, 0.72).fillRect(x0 - 6, y0 - 5, chipW * order.length + 12, chipH + 10);
    order.forEach((m, i) => {
      const x = x0 + i * chipW;
      const active = i === 0;
      const team = m.team === 1 ? COLORS.team1 : COLORS.team2;
      g.fillStyle(active ? MENU_COLOR.woodRaised : MENU_COLOR.charcoalRaised, active ? 1 : 0.85)
        .fillRect(x, y0, chipW - 4, chipH);
      g.lineStyle(active ? 2 : 1, active ? MENU_COLOR.brassLight : team, active ? 1 : 0.7)
        .strokeRect(x + 0.5, y0 + 0.5, chipW - 5, chipH - 1);
      g.fillStyle(team, 1).fillRect(x, y0, 3, chipH);
      // A sliver of health so the order also reads as a threat list.
      const hp = m.maxHp > 0 ? Math.max(0, Math.min(1, m.hp / m.maxHp)) : 0;
      g.fillStyle(COLORS.hp, 0.9).fillRect(x + 4, y0 + chipH - 3, (chipW - 12) * hp, 2);

      let label = this.initiativeLabels[i];
      if (!label || !label.scene || !label.active) {
        label = this.add.text(0, 0, '', {
          fontFamily: MENU_FONT.control,
          fontSize: '10px',
        }).setOrigin(0, 0.5).setDepth(46);
        this.initiativeLabels[i] = label;
      }
      const name = m.name.length > 11 ? `${m.name.slice(0, 10)}\u2026` : m.name;
      label
        .setText(active ? `\u25b8 ${name}` : name)
        .setColor(active ? MENU_HEX.brassLight : MENU_HEX.boneDim)
        .setPosition(x + 6, y0 + chipH / 2 - 1)
        .setVisible(true);
    });
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
      const steering = this.puppet ? `◈ E: BACK TO ${this.puppet.owner.name.toUpperCase()}   ` : '';
      const state = `${steering}${swap}${needlepoint}${this.desecrationHud()}`.trim();
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
      const rng = Number.isFinite(spell.range) ? `rng ${this.gs.spellReach(spell, me)}` : 'any range';
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
        `${spell.name}\n${spell.actionType} · ${rng} · ${mana} mana · ${castOddsLabel(spell, me, mods)}${modNote}`
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
      const charges = w === 'storm' ? 3 - me.stormDualcastsUsed : me.charges[w] ?? 0;
      const accent = wordCardColor(w);
      const meta = w === 'storm'
        ? `${charges}P / ${2 - me.stormMonocastsUsed}S`
        : `${charges} CHARGE${charges === 1 ? '' : 'S'}${WORDS[w].grantsReaction ? ' · REACTION' : ''}`;
      plate.setCopy(`${i + 1}  ${WORDS[w].label}`, meta, accent);
      plate.setSelectedOrder(on ? this.selectedIdx.indexOf(i) + 1 : 0);
      plate.setAlpha(charges > 0 || (w === 'storm' && me.hasCharges(['storm'])) || isModifierWord(w) ? 1 : 0.58);
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
        this.mode === 'reaction' ? 'PASS' : 'ACTIONS'
      );
    }

    // Cast only offers itself once the rack spells something castable.
    const reacting = this.mode === 'reaction' && !!this.reactor && !this.controllerIsAI(this.reactor);
    const myTurn = !this.gs.isOver
      && this.mode === 'idle'
      && !this.controllerIsAI(this.gs.current);
    const combo = myTurn ? this.currentComboSpell() : undefined;
    this.castButton?.setVisible(!!combo);
    if (combo && this.castButton) this.castButton.setText(`CAST ${combo.name.toUpperCase()}`);
    this.endTurnButton?.setVisible(myTurn || reacting);
    if (this.endTurnButton) this.endTurnButton.setText(reacting ? 'PASS' : 'END TURN');
    this.refreshPinnedPanel();

    this.drawLog();
  }

  /** Banner text for any field-wide desecration currently standing. */
  private desecrationHud(): string {
    return this.gs.desecrations
      .map((law) => `   ◈ ${law.name.toUpperCase()} ${law.roundsLeft}`)
      .join('');
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
    const abilities = getColorAbilitiesFor(p.primary, me.spellClass);
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
    const emblem = this.emblemHits.find((hit) =>
      this.pointer.x >= hit.x && this.pointer.x <= hit.x + hit.size && this.pointer.y >= hit.y && this.pointer.y <= hit.y + hit.size);
    if (emblem) {
      this.tooltip.setText(emblem.text).setPosition(emblem.x, emblem.y + emblem.size + 6).setVisible(true);
      return;
    }
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

    // Any combatant under the cursor explains itself: vitals, defences, statuses.
    const body = this.gs.mages.find(
      (m) => m.alive && dist(this.pointer, m.pos) <= m.bodyRadius() + 8
    );
    if (body) {
      this.tooltip
        .setText(this.inspectCard(body))
        .setPosition(this.pointer.x + 18, this.pointer.y + 18)
        .setVisible(true);
      return;
    }

    this.tooltip.setVisible(false);
  }

  /** Everything a player can legitimately learn by looking at a combatant. */
  private inspectCard(m: Mage): string {
    const health = (value: number): number => Number(value.toFixed(2));
    const lines: string[] = [
      `${m.name}${m.isSummon ? ' (summon)' : ''}  ·  ${health(m.hp)}/${health(m.maxHp)} HP  ·  ${isCrusadeBuilding(m) ? 'Building (no sanity)' : `${m.sanity}/${m.maxSanity} sanity`}`,
    ];
    if (isCrusadeBuilding(m)) lines.push('Weak: Burn specifically. Resists non-DoT debuffs.');
    if (m.enemyKind === 'crusadeHelper') {
      lines.push('Damaging or killing helpers grants no usual bonuses. Killing one deals 1d2-1 mill to the killer.');
      lines.push('With a camp alive: two replacements appear next turn and act immediately.');
    }
    if (m.enemyKind === 'crusadeSoldier') lines.push('One reaction: blocks 33%, including attacks aimed behind it. May decline to block.');
    if (m.enemyKind === 'crusadePriest') lines.push('Saintly Mending: heals another non-building, non-helper ally for 1d3.');
    if (m.enemyKind === 'crusadeBallista') lines.push('Requires a helper; one loaded shot per turn, before moving. Its 2cm-wide beam heals other Crusaders except helpers for 1d6.');
    const crusade = crusadeLabel(this.gs.mages, m);
    if (crusade) lines.push(crusade);

    const defences: string[] = [];
    if (m.debuffImmune) defences.push('Immune to debuffs');
    if (m.controlImmune) defences.push('Immune to control');
    if (m.displacementImmune) defences.push('Cannot be moved');
    if (m.intrinsicImmuneTypes.length) defences.push(`Immune: ${m.intrinsicImmuneTypes.join(', ')}`);
    if (m.intrinsicResistTypes.length) defences.push(`Resists: ${m.intrinsicResistTypes.join(', ')}`);
    if (m.intrinsicWeakTypes.length) defences.push(`Weak: ${m.intrinsicWeakTypes.join(', ')}`);
    if (m.displacementWeak) defences.push('Easily displaced');
    if (defences.length) lines.push(defences.join('  ·  '));

    const weaponId = m.activeWeaponId();
    if (weaponId) lines.push(`Armed: ${getItem(weaponId).name}`);
    else if (m.intrinsicMelee) {
      lines.push(`Strikes for ${m.intrinsicMelee.spec} ${m.intrinsicMelee.type}`);
    }

    for (const status of m.statuses) {
      const left = Number.isFinite(status.duration) ? ` (${status.duration})` : '';
      lines.push(`${status.name}${left} — ${this.statusBlurb(status)}`);
    }
    return lines.join('\n');
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
        if (b.opaque) {
          const burst = b.burst
            ? ` When it falls it shatters: every unit within ${Math.round(b.burst.radius / RANGE_UNIT)}cm takes ${b.burst.hits.map((hit) => `${hit.spec} ${hit.type}`).join(' and ')}, allies included.`
            : '';
          return `Glass curtain - blocks movement for everyone. No attack or enemy-targeted spell can cross it; area effects pass.${burst}`;
        }
        return 'Reality break — a rift no mage can enter. A mage that runs into it stops at the edge and is rooted; dashes and movement spells end at its border. Blocks everyone, including its caster.';
      }
    }
    for (const s of this.gs.shadows) {
      if (dist(p, s) <= s.radius) {
        return 'Shadow pool — its owner can cast spells from here.';
      }
    }
    for (const t of this.gs.totems) {
      if (dist(p, t) <= t.radius) {
        return t.lifesteal
          ? 'Corrosion totem — each round it damages mages in its aura and heals its owner by that much.'
          : 'Corrosion totem — each round it damages every mage in its aura.';
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
      if (zone.hex) return `${zone.name} (hex). ${zone.hex.text}`;
      if (zone.crossOnly) {
        const who = zone.foesOnly ? 'An enemy of its caster' : 'A unit';
        return `${zone.name} - ${who} moving through it takes ${zone.damageSpecs[0]} ${zone.damageType}.`;
      }
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
    for (const field of this.gs.desecrationFields) {
      if (Math.hypot(p.x - field.x, p.y - field.y) > field.radius) continue;
      const who = field.hostile ? 'Enemies of its caster' : 'Affected units';
      const parts = [
        field.hostile
          ? `${field.name} - harms the enemies of whoever laid it.`
          : `${field.name} - affects every unit inside except black and minion units.`,
      ];
      for (const tick of field.ticks) {
        parts.push(`${who} take ${tick.spec} ${tick.type} at turn start.`);
      }
      if (field.rot) parts.push(`Turn start also applies ${field.rot.spec} rot, stacking to ${field.rot.maxStacks} and spreading.`);
      if (field.blocksHealing) parts.push(`${who} cannot be healed.`);
      if (field.lifesteal) parts.push('The caster heals for the damage dealt.');
      if (field.healKin) parts.push('Black and minion units inside are healed instead.');
      if (field.sealed) parts.push('Affected units cannot walk out.');
      if (field.stripsActions) parts.push('Costs affected units a bonus action and their reaction.');
      if (field.reapPerTurn) parts.push(`Affected units gain ${field.reapPerTurn} Reap at turn start.`);
      if (field.executeRadius != null && field.executeBelow != null) {
        parts.push(`Affected units below ${field.executeBelow} health at the centre are killed.`);
      }
      if (field.growPerRound) parts.push('Grows every round.');
      if (field.growOnDeath) parts.push('Grows whenever a creature dies.');
      if (field.pullOnDeath) parts.push('Drags units in whenever a creature dies.');
      if (field.relocateOnDeath) parts.push('Moves to a creature that dies, once per round.');
      return parts.join(' ');
    }
    return null;
  }

  /**
   * Sticky prompts ask for a choice and stay lit. Everything else is a refusal,
   * so it also gets a sound and a pulse at the cursor — the hint line alone sits
   * too far from where the player is looking to be noticed.
   */
  private flashHint(msg: string, sticky = false, tone: 'deny' | 'info' = 'deny'): void {
    // The hint line sits under the inventory, so the inventory says it too.
    if (this.invPanel instanceof InventoryView) this.invPanel.notice(msg);
    this.hintText.setText(msg).setColor(TEXT.warn);
    this.hintDim?.remove();
    this.hintDim = undefined;
    if (sticky) return;
    this.hintDim = this.time.delayedCall(1400, () => this.hintText.setColor(TEXT.dim));
    if (tone === 'deny') this.denyPulse();
  }

  private lastDenyAt = 0;

  /** A red ring that snaps out at the pointer, rate-limited against key-repeat. */
  private denyPulse(): void {
    const now = this.time.now;
    if (now - this.lastDenyAt < 140) return;
    this.lastDenyAt = now;
    playSound('ui.deny');
    if (this.reducedMotion) return;
    // Drawn around a local origin so the scale tween expands from the pointer.
    const g = this.add.graphics({ x: this.pointer.x, y: this.pointer.y }).setDepth(59);
    g.lineStyle(2, MENU_COLOR.blood, 0.9).strokeCircle(0, 0, 12);
    this.tweens.add({
      targets: g,
      alpha: 0,
      scale: { from: 0.7, to: 1.7 },
      duration: 280,
      ease: 'Quad.Out',
      onComplete: () => g.destroy(),
    });
  }

  private endGame(): void {
    // isOver is polled from several points in the turn flow; only the first
    // call may raise the banner and arm the click that leaves the duel.
    if (this.gameEnded) return;
    this.gameEnded = true;
    // A withdrawal is not a defeat: nobody won, the party simply left.
    const escapedOver = this.fledEdge ?? (this.explorationWon ? null : this.withdrawnEdge);
    if (escapedOver) {
      this.mode = 'over';
      this.busy = false;
      if (this.mineRun) this.closeMineExploration();
      this.showEndCard({
        eyebrow: 'WITHDRAWN',
        title: 'ESCAPED',
        detail: `The party fled ${FLEE_EDGE_LABEL[escapedOver]}.`,
        actionLabel: 'CONTINUE',
        tone: 'victory',
        onActivate: () => this.returnToMenu(),
      });
      this.redraw();
      return;
    }
    if (this.raid) {
      this.mode = 'over';
      this.busy = false;
      const targetName = raidTargetName(this.raidBoss);
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
    if (this.explorationCombat) {
      this.mode = 'over';
      this.busy = false;
      if (this.mineRun) this.closeMineExploration();
      const won = this.explorationWon;
      const trained = `${this.explorationKills.length} defeated. Level ${this.runLevel} (${this.runXp}/${this.xpToNextLevel()} XP).`;
      const dungeon = this.dungeon ? DUNGEONS[this.dungeon] : null;
      const reached = !dungeon ? ''
        : this.mineRun ? `${this.mineMaze?.steps ?? 0} tunnels walked. `
        : `Deepest depth ${this.dungeonDeepest}. `;
      const boss = this.explorationCombat.boss ? BOSSES[this.explorationCombat.boss.id] : null;
      this.showEndCard({
        eyebrow: this.mineCrushed || boss ? 'BLOODMOON' : won ? (dungeon ? 'OUT ALIVE' : 'FIGHT WON') : 'DEFEATED',
        title: this.mineCrushed ? 'DIED IN THE MINES' : boss && won ? `${boss.name.toUpperCase()} DEFEATED` : won ? (dungeon ? dungeon.name.toUpperCase() : 'VICTORY') : 'PARTY LOST',
        detail: won
          ? `${reached}${trained}`
          : this.mineCrushed ? 'The bloodmoon rose while the party was inside.' : 'The party is dead. The run is over.',
        actionLabel: 'CONTINUE',
        tone: won ? 'victory' : 'defeat',
        onActivate: () => this.returnToMenu(),
      });
      this.redraw();
      return;
    }
    if (this.swamprun) {
      this.mode = 'over';
      this.busy = false;
      const mineEncountersCleared = Math.max(
        0,
        this.swamprunWave - (this.mineRun && this.mineInCombat ? 1 : 0)
      );
      if (this.mineRun) this.closeMineExploration();
      const eyebrow = this.mineRun ? 'MINE RUN ENDED' : 'SWAMPRUN ENDED';
      const detail = this.mineRun
        ? `${mineEncountersCleared} encounters cleared.`
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
        detail: 'Fight over. Reset restores everyone.',
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

  /** Stop the maze: no more prompts, no fight waiting to resume. */
  private closeMineExploration(): void {
    this.mineRunEnded = true;
    this.mineExploring = false;
    this.mineInCombat = false;
    this.mineChoiceResolve?.('');
    this.mineChoiceResolve = null;
    this.mineCombatResolve?.();
    this.mineCombatResolve = null;
    this.hideMinePanel();
  }

  /** Pickaxes the party carries as items, held, packed or among the supplies. */
  private carriedPickaxes(): number {
    return this.gs.mages
      .filter((mage) => mage.team === 1 && !mage.isSummon)
      .reduce((sum, mage) => sum + [...mage.hands, ...mage.bag, ...mage.utility].filter((id) => id === 'pickaxe').length, 0);
  }

  /** Carried pickaxes that broke in the Mines are gone; the worn one always breaks first. */
  private dropBrokenPickaxes(party: readonly Mage[]): void {
    let broken = Math.max(0, this.dungeonPickaxes - this.minePickaxes.length);
    for (const mage of party) {
      while (broken > 0 && this.gs.removeItem(mage, 'pickaxe')) broken -= 1;
    }
  }

  private returnToMenu(): void {
    if (this.leaving) return;
    this.leaving = true;
    // An overworld fight goes back to the road it interrupted, not the menu.
    const combat = this.explorationCombat;
    if (combat) {
      const fighters = this.gs.mages.filter((m) => m.team === 1 && !m.isSummon && !m.sceneSide);
      for (const m of fighters) {
        m.withdrawn = false;
        const owned = this.swamprunArrowsOwned.get(m);
        if (owned != null) m.arrows = owned;
        // The fight is over: its limits, colour charges and statuses end with it.
        m.resetForNewCombat();
        m.resetCombatReactions();
      }
      const survivors = fighters.filter((m) => m.alive);
      if (this.dungeon === 'mines') this.dropBrokenPickaxes(survivors);
      combat.run.party = mergeFightParty(combat.run.party, fighters);
      combat.run.summons = captureSummons(this.gs.mages);
      combat.run.gold = Math.round((combat.run.gold + this.swamprunGold) * 100) / 100;
      combat.run.level = this.runLevel;
      combat.run.xp = this.runXp;
      syncPendingLevels(combat.run);
      // A guest settles nothing: the host's run after the fight is the party's.
      const session = AdventureSession.current;
      if (this.adventureOnline() && session && !session.isHost) {
        this.scene.start('Exploration', { run: combat.run, follow: 'wait' } satisfies ExplorationEntry);
        return;
      }
      const edge = this.fledEdge ?? this.withdrawnEdge;
      this.scene.start('Exploration', {
        result: {
          run: combat.run,
          outcome: this.explorationWon ? 'won' : edge && survivors.length ? 'fled' : survivors.length ? 'won' : 'lost',
          edge: edge ?? undefined,
          cameFrom: combat.cameFrom,
          kills: [...this.explorationKills],
          returnTo: combat.returnTo,
          fleeTo: combat.fleeTo,
          tag: combat.tag,
          robbery: combat.encounter === 'robbery',
          dungeon: combat.dungeon,
          crushed: this.mineCrushed,
          boss: combat.boss,
          wares: this.explorationWon ? combat.scene?.wares : undefined,
        },
      } satisfies ExplorationEntry);
      return;
    }
    this.scene.start('Menu');
  }

  // ===========================================================================
  //  SPELL VISUALS
  // ===========================================================================

  /** Play the animation for a resolving action before its effect lands. */
  private playActionVisual(item: StackItem): Promise<void> {
    if (item.kind === 'move') {
      const planned = this.gs.planMove(item.source, item.moveDestination ?? item.targetPoint ?? item.source.pos);
      item.movePath = planned.path;
      item.targetPoint = planned.path[planned.path.length - 1];
      return this.animateMove(item.source, planned.path);
    }
    // Generic actions (item use / throw / Eldritch / Thunder / weapon action)
    // paint their own effects inside resolve — no default cast animation.
    if (item.kind === 'action') {
      const at = item.target?.pos ?? item.targetPoint ?? item.source.pos;
      const preset = item.actionVisual ? ACTION_FX_PRESETS[item.actionVisual] : undefined;
      switch (preset?.kind) {
        case 'burst':
          return this.spellVfx.burst(at, preset.color, preset.reach, preset.speed);
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
      if (item.source.enemyKind === 'moay') return this.playMoayStomp(item.source, at);
      if (creatureSpriteKind(item.source) === 'wisp') {
        this.startBodyAttack(item.source);
        return this.playWispAttackFx(at, item.source);
      }
      return isRangedWeapon(item.source.activeWeapon())
        ? this.playBowShot(item.source, item.target ?? null, at)
        : this.playMeleeStrike(item.source, at);
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
            ? this.spellVfx.spriteAt('fx-shatter', point, {
                from,
                apexAtFrom: true,
                lengthPx: Math.min(spell.aoe?.radius ?? 200, 360),
              })
            : this.spellVfx.spriteAt('fx-shatter', point, {
                from,
                aim: true,
                lengthPx: (spell.aoe?.radius ?? 60) * 2.2,
              });
        }
        if (spell.words.includes('corrode')) {
          return this.spellVfx.spriteAt('fx-dot', point, {
            lengthPx: (spell.aoe?.radius ?? 40) * 2.4,
          });
        }
      }
    }

    switch (v.preset) {
      case 'projectile':
        return to ? this.spellVfx.projectile(from, to, v) : this.spellVfx.burst(from, v.color, 28, v.speed ?? 1);
      case 'beam':
        return to ? this.spellVfx.beam(from, to, v) : this.spellVfx.burst(from, v.color, 24, v.speed ?? 1);
      case 'burst':
        return this.spellVfx.burst(to ?? from, v.color, v.size ?? 45, v.speed ?? 1);
      case 'nova':
        return this.spellVfx.nova(to ?? from, v);
      case 'conjure':
        return this.spellVfx.conjure(to ?? from, v);
      case 'heal':
        return this.spellVfx.heal(to ?? from, v);
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

