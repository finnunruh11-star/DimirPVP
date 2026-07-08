import Phaser from 'phaser';
import {
  ACTIONS_PER_TURN,
  COLORS,
  FIELD,
  GAME_HEIGHT,
  GAME_WIDTH,
  MAX_SPELL_WORDS,
  MAX_WORD_SPELL_REACTIONS,
  MELEE_RANGE,
  RANGE_UNIT,
  SCARAB,
  TEXT,
} from '../config/constants';
import { GameState } from '../core/GameState';
import { Mage } from '../core/Mage';
import type { Status } from '../core/Status';
import scarabGifUrl from '../Sprites/Scarab.gif';
import moveIconUrl from '../Sprites/Move.png';
import attackIconUrl from '../Sprites/Attack.png';
import spellIconUrl from '../Sprites/SpellCast.png';
import type { ScarabState } from '../core/Scarab';
import { Dev, type DevToggle } from '../config/dev';
import { WORDS, type WordId } from '../core/Words';
import { wordSpellMana } from '../core/Colors';
import { WORD_COLOR } from '../core/Colors';
import {
  STAT_DEFS,
  STAT_ORDER,
  aiAssignment,
  defaultAssignment,
  isValidAssignment,
  rollStatAssortment,
  type DieResult,
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
  DRAFT_ROUNDS,
  RARITY_COLOR,
  setActiveItemSets,
  ITEM_DEFS,
  type ItemId,
} from '../core/Items';
import type { StackItem } from '../core/Stack';
import type { ShadowZone } from '../core/Shadow';
import { barrierContains } from '../core/Barrier';
import type { Spell, SpellVisual } from '../spells/Spell';
import { allSpells, getSpell, setActiveSpellSets } from '../spells/registry';
import { dist, stepTowards, type Vec2 } from '../core/utils';
import type { SubTargetPointOpts, SubTargetEnemyOpts } from '../effects/effects';
import { SimpleAI, type AIDecision } from '../ai/SimpleAI';
import type { MatchConfig, SeatConfig } from './MenuScene';
import type { Net, NetMessage } from '../net/Net';

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

const MOVE_DURATION = 1000;
const DASH_DURATION = 333;

/** Per-mage sprite + animation-state machine. */
interface MageAnim {
  sprite: Phaser.GameObjects.Sprite;
  /** A special animation currently owning the sprite (else idle/charge rests). */
  lock: 'move' | 'dash' | 'attack' | 'hit' | null;
  /** A sprite-position tween (dash) owns the position; don't snap to logical. */
  posLocked: boolean;
  /** The attack-charge loop is the current resting animation. */
  charging: boolean;
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
  | 'aiming-wall'
  | 'subtarget-point'
  | 'subtarget-enemy'
  | 'busy'
  | 'reaction'
  | 'assign'
  | 'shop'
  | 'inventory'
  | 'eldritch-menu'
  | 'thunder-menu'
  | 'action-menu'
  | 'training'
  | 'over';

interface DiceRoll {
  spec: string;
  total: number;
  rolls: number[];
  label?: string;
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

/** The reward tier of a dodge roll (see {@link analyzeDodge}). */
type DodgeTier = 'none' | 'pair' | 'triple' | 'quad';

/** A follow-up action offered after a strong dodge (triple / quad). */
type DodgeChoice =
  | { kind: 'attack' }
  | { kind: 'spell'; spell: Spell }
  | { kind: 'ability'; ability: ColorAbility };

/**
 * Classify a dodge dice roll (Nd6) into its reward tier:
 *  - none   : no repeated value — the dodge fails.
 *  - pair   : one repeated value — evade + reposition.
 *  - triple : three of a kind OR two pairs — pair + a free bonus action.
 *  - quad   : four of a kind OR three pairs — triple + the option to riposte.
 */
function analyzeDodge(rolls: number[]): DodgeTier {
  const counts = new Map<number, number>();
  for (const r of rolls) counts.set(r, (counts.get(r) ?? 0) + 1);
  let pairs = 0;
  let maxCount = 0;
  for (const c of counts.values()) {
    if (c >= 2) pairs++;
    if (c > maxCount) maxCount = c;
  }
  if (maxCount >= 4 || pairs >= 3) return 'quad';
  if (maxCount >= 3 || pairs >= 2) return 'triple';
  if (maxCount >= 2) return 'pair';
  return 'none';
}

function dodgeTierLabel(t: DodgeTier): string {
  switch (t) {
    case 'pair':
      return 'a clean evade';
    case 'triple':
      return 'an evade + free action';
    case 'quad':
      return 'an evade + riposte';
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
  | { t: 'spell'; spellId: string; ability: boolean; target: number | null; x?: number; y?: number; angle?: number }
  | { t: 'item-drop'; itemId: string }
  | { t: 'item-pickup'; dropId: number }
  | { t: 'item-use'; itemId: string }
  | { t: 'item-equip'; itemId: string }
  | { t: 'item-unequip'; itemId: string }
  | { t: 'item-throw'; itemId: string; target: number }
  | { t: 'eldritch'; choice: 'attack' | 'defend' | 'restore'; target?: number }
  | { t: 'thunder-charge' }
  | { t: 'thunder-discharge'; target: number }
  | { t: 'cast-random' }
  | { t: 'weapon-action' }
  | { t: 'leap'; x: number; y: number }
  | { t: 'focus' }
  | { t: 'cleave'; x: number; y: number }
  | { t: 'end' };

/** A reaction-window choice (a counter/response, or a pass). */
type ReactionCommand =
  | { t: 'react'; spellId: string; ability: boolean; target: number | null; x?: number; y?: number }
  | { t: 'shield'; kind: 'block' | 'bash' }
  | { t: 'needle' }
  | { t: 'dodge' }
  | { t: 'pass' };

/** A mid-cast sub-target choice. */
type SubCommand =
  | { t: 'sub-point'; x: number; y: number }
  | { t: 'sub-enemy'; target: number }
  | { t: 'sub-none' };

/** A mid-resolution draft pick (Gambler's Blade cash-out): the chosen card index. */
type DraftCommand = { t: 'draft'; index: number };

const MAGE_RADIUS = 22;
const HUD_Y = FIELD.y + FIELD.h + 18;

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

  // Training sandbox (offline only). Enabled when the match mode is 'training'.
  private training = false;
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

  // Human spell-building state (indices into the current mage's loadout).
  private selectedIdx: number[] = [];
  private pendingSpell: Spell | null = null;
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

  // Dice rolls queued during the current resolution, shown after the effect.
  private pendingDice: DiceRoll[] = [];

  // Graphics & text.
  private gfxStatic!: Phaser.GameObjects.Graphics;
  private gfx!: Phaser.GameObjects.Graphics;
  private gfxFx!: Phaser.GameObjects.Graphics;
  private gfxScarab!: Phaser.GameObjects.Graphics;
  private hoverGfx!: Phaser.GameObjects.Graphics;
  private dicePanel!: Phaser.GameObjects.Container;
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
  private wordTexts: Phaser.GameObjects.Text[] = [];
  private tooltip!: Phaser.GameObjects.Text;
  private bannerText!: Phaser.GameObjects.Text;

  // Dedicated, filterable history panel.
  private historyPanel!: Phaser.GameObjects.Container;
  private historyBg!: Phaser.GameObjects.Rectangle;
  private historyTitle!: Phaser.GameObjects.Text;
  private historyExpanded = false;
  private historyFilters = { cast: true, roll: true, event: true };
  private historyToggleTexts: { cat: 'cast' | 'roll' | 'event'; text: Phaser.GameObjects.Text }[] = [];

  // Pre-duel stat-assignment overlay.
  private statDice: DieResult[] = [];
  private assignPanel!: Phaser.GameObjects.Container;
  private assignTitle!: Phaser.GameObjects.Text;
  private assignDieTexts: Phaser.GameObjects.Text[] = [];
  private assignSlotTexts: Phaser.GameObjects.Text[] = [];
  private assignConfirm!: Phaser.GameObjects.Text;
  /** placement[statSlot] = die index assigned to that stat (or null). */
  private assignPlacement: (number | null)[] = [];
  /** The die currently "picked up" awaiting placement. */
  private assignSelectedDie: number | null = null;
  private assignResolve: ((order: number[]) => void) | null = null;
  /** When true the overlay ignores clicks (e.g. while awaiting the opponent). */
  private assignLocked = false;

  // Pre-duel rarity-draft overlay.
  private shopPanel!: Phaser.GameObjects.Container;
  private shopTitle!: Phaser.GameObjects.Text;
  private shopInfo!: Phaser.GameObjects.Text;
  private shopOptionTexts: Phaser.GameObjects.Text[] = [];
  private shopCartText!: Phaser.GameObjects.Text;
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
  private invPanel?: Phaser.GameObjects.Container;
  private invTooltip?: Phaser.GameObjects.Text;

  // Mantle of Eldritch Truth action menu.
  private eldritchMenu?: Phaser.GameObjects.Container;

  // Blessing of Roaring Thunder action menu.
  private thunderMenu?: Phaser.GameObjects.Container;

  // Context-aware "everything you can do right now" action menu (Tab / button /
  // right-click). Its contents are generated from the action registry so new
  // actions appear automatically without any extra hotkey to learn.
  private actionMenu?: Phaser.GameObjects.Container;
  /** The mode to restore when the action menu closes ('idle' or 'reaction'). */
  private actionMenuReturn: InputMode = 'idle';
  /** The always-visible button that opens the action menu. */
  private actionMenuButton?: Phaser.GameObjects.Text;

  // Dev / testing cheat panel.
  private devPanel!: Phaser.GameObjects.Container;
  private devToggles: { key: DevToggle; label: string; hot: string; text: Phaser.GameObjects.Text }[] = [];
  private devClickGuard = false;
  /** Swallows the field click that opened an aiming mode from the action menu. */
  private menuClickGuard = false;

  // Reaction prompt.
  private reactor: Mage | null = null;
  private reactionResolve: ((value: ReactionChoice | null) => void) | null = null;

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
    // First frame of the scarab gif, used until the animated frames decode.
    this.load.image('scarab-static', scarabGifUrl);
    // Stack token icons (move / basic attack / spell cast).
    this.load.image('stack-move', moveIconUrl);
    this.load.image('stack-melee', attackIconUrl);
    this.load.image('stack-spell', spellIconUrl);
  }

  create(config: MatchConfig): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);

    // Restrict the draft pool to the item sets chosen on the start screen.
    setActiveItemSets(config.itemSets ?? { original: true });
    // Keep spell availability in sync with the item-set toggle.
    setActiveSpellSets(config.itemSets ?? { original: true });

    this.online = config.mode === 'online';
    this.net = config.net ?? null;
    this.localTeam = config.localTeam ?? 1;
    this.localSeat = config.localSeat ?? this.localTeam - 1;
    this.opponentLeft = false;
    this.training = config.mode === 'training';

    const onlineName = (team: number): string =>
      team === this.localTeam ? `Player ${team} (You)` : `Player ${team}`;

    // Determine the combatants. An explicit seat list drives N-player matches;
    // otherwise fall back to the classic two-mage layout derived from mode.
    const seats: SeatConfig[] = config.seats?.length
      ? config.seats
      : [
          {
            name: this.online ? onlineName(1) : 'Player 1',
            isAI: false,
            team: 1,
            loadout: config.loadouts[0],
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
          },
        ];

    this.spawns = this.computeSpawns(seats.map((s) => s.team));
    // Legacy anchors kept for the two-mage training / soft-reset paths.
    this.playerSpawn = this.spawns[0] ?? { x: FIELD.x + 180, y: FIELD.y + FIELD.h / 2 };
    this.enemySpawn = this.spawns[1] ?? { x: FIELD.x + FIELD.w - 180, y: FIELD.y + FIELD.h / 2 };

    const mages = seats.map(
      (s, i) =>
        new Mage({
          name: this.online && i === this.localSeat ? `${s.name} (You)` : s.name,
          isAI: s.isAI,
          team: s.team,
          position: { ...this.spawns[i] },
          loadout: s.loadout,
        })
    );

    this.gs = new GameState(mages, config.seed);
    this.gs.onLog = () => this.drawLog();
    this.gs.vfxSink = {
      diceRoll: (spec, total, rolls, label) => this.pendingDice.push({ spec, total, rolls, label }),
      hit: (m) => this.playHit(m),
      dash: (mover, from) => this.animateDash(mover, from),
    };
    this.gs.subTargeter = {
      requestPoint: (source, opts) => this.requestSubtargetPoint(source, opts),
      requestEnemy: (source, opts) => this.requestSubtargetEnemy(source, opts),
      reactionWindow: (source, label, at) => this.offerReactionWindow(source, label, { at }),
    };
    for (const m of this.gs.mages) if (m.isAI) this.ais.set(m, new SimpleAI(this.gs, m));

    this.buildMageAnimations();
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
    if (this.training) {
      this.setupTraining();
      this.gs.startRound();
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
      this.gs.log(`${mage.name} uncorks a Word Vial — each word regains 1 charge.`);
    }
  }

  // ===========================================================================
  //  STAT ASSIGNMENT PHASE
  // ===========================================================================

  /** Roll one shared assortment of dice and let each duellist allocate it. */
  private async runAssignmentPhase(): Promise<void> {
    this.statDice = rollStatAssortment(this.gs.rng);
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
    this.assignTitle.setText(label);
    this.assignPanel.setVisible(true);
    this.refreshAssignOverlay();
    return new Promise((resolve) => {
      this.assignResolve = resolve;
    });
  }

  private showAssignWaiting(): void {
    this.assignTitle.setText('Waiting for opponent to assign…');
    this.assignLocked = true;
    this.assignSelectedDie = null;
    this.refreshAssignOverlay();
  }

  private hideAssignOverlay(): void {
    if (this.assignPanel) this.assignPanel.setVisible(false);
    this.assignResolve = null;
  }

  /** Build the assignment overlay once; later calls just refresh it. */
  private buildAssignOverlay(): void {
    if (this.assignPanel) {
      this.refreshAssignOverlay();
      return;
    }
    this.assignPanel = this.add.container(0, 0).setDepth(95).setVisible(false);
    const dim = this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.78)
      .setOrigin(0, 0);
    const panel = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 980, 600, 0x10101c, 0.98)
      .setOrigin(0.5)
      .setStrokeStyle(2, 0x5a5a88);
    this.assignTitle = this.add
      .text(GAME_WIDTH / 2, 70, '', { fontSize: '24px', color: TEXT.warn, fontStyle: 'bold' })
      .setOrigin(0.5);
    const subtitle = this.add
      .text(
        GAME_WIDTH / 2,
        104,
        'Click a die, then a stat to assign it. Click a filled stat to take its die back. All six must be placed.',
        { fontSize: '14px', color: TEXT.dim }
      )
      .setOrigin(0.5);

    const children: Phaser.GameObjects.GameObject[] = [dim, panel, this.assignTitle, subtitle];

    // Dice row.
    const startX = GAME_WIDTH / 2 - (6 * 120 + 5 * 12) / 2;
    this.assignDieTexts = [];
    for (let i = 0; i < 6; i++) {
      const t = this.add
        .text(startX + i * 132, 140, '', {
          fontSize: '16px',
          color: TEXT.body,
          align: 'center',
          backgroundColor: '#181826',
          padding: { x: 6, y: 8 },
          fixedWidth: 120,
        })
        .setInteractive({ useHandCursor: true });
      t.on('pointerdown', () => this.onAssignDieClick(i));
      this.assignDieTexts.push(t);
      children.push(t);
    }

    // Stat slots: a value box plus a name/description label per stat.
    this.assignSlotTexts = [];
    STAT_DEFS.forEach((def, i) => {
      const rowY = 250 + i * 54;
      const slot = this.add
        .text(GAME_WIDTH / 2 - 360, rowY, '', {
          fontSize: '18px',
          color: TEXT.warn,
          align: 'center',
          backgroundColor: '#23233a',
          padding: { x: 6, y: 8 },
          fixedWidth: 64,
        })
        .setInteractive({ useHandCursor: true });
      slot.on('pointerdown', () => this.onAssignSlotClick(i));
      const label = this.add.text(GAME_WIDTH / 2 - 280, rowY + 4, `${def.name} — ${def.blurb}`, {
        fontSize: '15px',
        color: TEXT.body,
      });
      this.assignSlotTexts.push(slot);
      children.push(slot, label);
    });

    this.assignConfirm = this.add
      .text(GAME_WIDTH / 2, 600, 'Confirm', {
        fontSize: '20px',
        color: TEXT.dim,
        fontStyle: 'bold',
        backgroundColor: '#181826',
        padding: { x: 18, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.assignConfirm.on('pointerdown', () => this.onAssignConfirm());
    children.push(this.assignConfirm);

    this.assignPanel.add(children);
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
    if (!this.assignDieTexts.length) return;
    this.assignDieTexts.forEach((t, i) => {
      const d = this.statDice[i];
      t.setText(d ? `${d.spec}\n${d.value}` : '');
      const used = this.assignPlacement.includes(i);
      const selected = this.assignSelectedDie === i;
      t.setBackgroundColor(selected ? '#5a5a1a' : used ? '#15251a' : '#181826');
      t.setColor(selected ? TEXT.warn : used ? TEXT.dim : TEXT.body);
    });
    this.assignSlotTexts.forEach((t, s) => {
      const p = this.assignPlacement[s];
      t.setText(p != null ? String(this.statDice[p].value) : '—');
      t.setColor(p != null ? TEXT.warn : TEXT.dim);
    });
    const complete = this.assignPlacement.length === 6 && this.assignPlacement.every((p) => p != null);
    this.assignConfirm.setColor(complete && !this.assignLocked ? '#7cfc9a' : TEXT.dim);
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
        if (!mage.equipHand(id)) break;
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
    this.shopPanel.setVisible(true);
    return new Promise((resolve) => {
      this.shopResolve = resolve;
      this.startDraftRound();
    });
  }

  /** Begin the next draft round, or resolve the shop once all rounds are done. */
  private startDraftRound(): void {
    this.shopRound += 1;
    if (this.shopRound > DRAFT_ROUNDS) {
      const picks = [...this.shopPicks];
      const resolve = this.shopResolve;
      this.shopResolve = null;
      resolve?.(picks);
      return;
    }
    const luck = this.shopMage?.maxLuck ?? 0;
    const rarity = rollRarity(Math.random, luck);
    this.shopOptions = draftChoices(rarity, Math.random, 3);
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
      if (this.shopPanel) this.shopPanel.setVisible(false);
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
    this.shopTitle.setText('Waiting for opponent to draft…');
    this.shopLocked = true;
    for (const t of this.shopOptionTexts) t.setVisible(false);
  }

  private hideShopOverlay(): void {
    if (this.shopPanel) this.shopPanel.setVisible(false);
    this.shopResolve = null;
  }

  private buildShopOverlay(): void {
    if (this.shopPanel) {
      this.refreshShopOverlay();
      return;
    }
    this.shopPanel = this.add.container(0, 0).setDepth(95).setVisible(false);
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.78).setOrigin(0, 0);
    const panel = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 1120, 650, 0x10101c, 0.98)
      .setOrigin(0.5)
      .setStrokeStyle(2, 0x5a5a88);
    this.shopTitle = this.add
      .text(GAME_WIDTH / 2, 70, '', { fontSize: '26px', color: TEXT.warn, fontStyle: 'bold' })
      .setOrigin(0.5);
    this.shopInfo = this.add
      .text(GAME_WIDTH / 2, 110, '', { fontSize: '16px', color: TEXT.body })
      .setOrigin(0.5);

    const children: Phaser.GameObjects.GameObject[] = [dim, panel, this.shopTitle, this.shopInfo];

    // Three draft option cards, side by side.
    this.shopOptionTexts = [];
    const cardW = 330;
    const gap = 24;
    const totalW = cardW * 3 + gap * 2;
    for (let i = 0; i < 3; i++) {
      const x = GAME_WIDTH / 2 - totalW / 2 + i * (cardW + gap);
      const t = this.add
        .text(x, 180, '', {
          fontSize: '15px',
          color: TEXT.body,
          wordWrap: { width: cardW - 28 },
          backgroundColor: '#181826',
          padding: { x: 14, y: 14 },
          fixedWidth: cardW,
          align: 'left',
        })
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true });
      t.on('pointerdown', () => this.onDraftPick(i));
      t.on('pointerover', () => {
        if (!this.shopLocked) t.setStroke('#ffffff', 2);
      });
      t.on('pointerout', () => t.setStroke('#000000', 0));
      this.shopOptionTexts.push(t);
      children.push(t);
    }

    this.shopCartText = this.add
      .text(GAME_WIDTH / 2, 470, '', {
        fontSize: '15px',
        color: TEXT.warn,
        wordWrap: { width: 1040 },
        align: 'center',
      })
      .setOrigin(0.5, 0);
    children.push(this.shopCartText);

    this.shopPanel.add(children);
    this.refreshShopOverlay();
  }

  private refreshShopOverlay(): void {
    if (!this.shopOptionTexts.length || !this.shopMage) return;
    const cap = carryCapacity(this.shopMage.statStrength);
    const rarity = this.shopOptions.length ? getItem(this.shopOptions[0]).rarity : 'common';
    const rarityName = rarity.charAt(0).toUpperCase() + rarity.slice(1);
    if (this.gamblerResolve) {
      this.shopTitle.setText(
        `${this.shopMage.name} — Gambler's Blade  (${this.gamblerRound}/${this.gamblerTotal})`
      );
      this.shopTitle.setColor(TEXT.warn);
      this.shopInfo.setText(`A ${rarityName} appears — choose one of three to draft (carry ${cap}kg)`);
      this.shopInfo.setColor(RARITY_COLOR[rarity]);
    } else {
      this.shopTitle.setText(`${this.shopMage.name} — Draft ${this.shopRound}/${DRAFT_ROUNDS}`);
      this.shopTitle.setColor(TEXT.warn);
      this.shopInfo.setText(`A ${rarityName} appears — choose one of three (carry ${cap}kg)`);
      this.shopInfo.setColor(RARITY_COLOR[rarity]);
    }
    this.shopOptionTexts.forEach((t, i) => {
      const id = this.shopOptions[i];
      if (!id) {
        t.setVisible(false);
        return;
      }
      const def = getItem(id);
      t.setVisible(true);
      t.setText(
        `${def.name}\n[${def.rarity}]  ${def.weight}kg\n\n${def.blurb}`
      );
      t.setColor(RARITY_COLOR[def.rarity]);
    });
    if (this.gamblerResolve) {
      this.shopCartText.setText('Pick a card to draft that item.');
      return;
    }
    const pickNames = this.shopPicks.map((id) => getItem(id).name);
    this.shopCartText.setText(
      `Drafted: ${pickNames.length ? pickNames.join(', ') : '(nothing yet)'}`
    );
  }


  /** Per-frame: pulse the highlight rings around currently valid targets. */
  update(time: number): void {
    this.syncMageSprites();
    this.syncScarabSprites();
    this.drawScarabHp();
    this.drawTargetHighlights(time);
  }

  private drawTargetHighlights(time: number): void {
    const g = this.gfxFx;
    g.clear();
    const targets = this.currentAimTargets();
    if (targets.length === 0) return;
    const pulse = 0.5 + 0.5 * Math.sin(time / 110);
    for (const t of targets) {
      const r = MAGE_RADIUS + 9 + pulse * 7;
      g.lineStyle(3, COLORS.selected, 0.35 + 0.55 * pulse);
      g.strokeCircle(t.x, t.y, r);
      g.lineStyle(1, 0xffffff, 0.2 + 0.3 * pulse);
      g.strokeCircle(t.x, t.y, r + 3);
    }
  }

  /** Mages that are legal targets for the current aim (turn cast or reaction). */
  private currentAimTargets(): Mage[] {
    const src = this.aimingSource ?? this.gs.current;
    if (this.mode === 'aiming-melee') {
      return this.gs.mages.filter((m) => this.gs.canMelee(src, m));
    }
    if (this.mode === 'aiming-spell') {
      const spell = this.reactionAiming ? this.reactionPendingSpell : this.pendingSpell;
      if (!spell) return [];
      return this.gs.validSpellTargets(spell, src);
    }
    return [];
  }

  // ===========================================================================
  //  TURN FLOW
  // ===========================================================================

  private async startTurn(): Promise<void> {
    if (this.gs.isOver) return this.endGame();
    this.gs.beginTurn();
    this.resetSelection();
    this.redraw();
    // Turn-start damage (DoT, auras, totems) applies no dice, so play any
    // recoils it queued right away as the HP changes become visible.
    this.flushHits();

    if (this.gs.isOver) return this.endGame();

    // A mind-bound mage is compelled to repeat its last action and forfeits
    // any choice this turn.
    const control = this.gs.controlOf(this.gs.current);
    if (control?.mode === 'repeat') {
      await this.runCompelledTurn();
      return;
    }

    if (this.controllerIsAI(this.gs.current)) {
      this.mode = 'busy';
      await this.runAITurn();
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
    await this.delay(400);
    const item = this.buildCompelledAction(me);
    if (item) {
      this.gs.log(`${me.name} is compelled to repeat their last action.`);
      await this.runStack(item);
    } else {
      this.gs.log(`${me.name} is compelled but cannot act — they do nothing.`);
      await this.delay(300);
    }
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
    const spell = allSpells().find((s) => s.id === la.spellId);
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
    const options = allSpells().filter(
      (s) =>
        s.words.every((w) => me.loadout.includes(w)) &&
        me.hasCharges(s.words) &&
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


  private async nextTurn(): Promise<void> {
    // As the acting mage moves to end their turn, opponents get one last chance
    // to spend their reaction (counter-magic only) before the turn passes.
    await this.offerReactionWindow(this.gs.current, 'End of Turn', {
      description: `${this.gs.current.name} moves to end their turn.`,
    });
    if (this.gs.isOver) return this.endGame();

    // A queued extra turn (Shatter Mind Reality) jumps the queue before the
    // normal rotation, and does not advance the round.
    const extra = this.gs.takeExtraTurn();
    if (extra && extra.alive) {
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
      if (this.gs.isOver) return;
      const decision = ai.chooseAction();
      if (decision.type === 'end') return;
      await this.delay(450);
      await this.performAIDecision(decision);
      this.redraw();
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
      case 'spell': {
        // A scrambled mage (Mind Curse) casts a random spell instead.
        if (this.gs.controlOf(me)?.mode === 'random') {
          const sub = this.randomCastFor(me);
          if (sub) {
            this.gs.log(`${me.name} is scrambled — ${sub.spell.name} erupts instead!`);
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
    return this.seatOf(this.gs.current) === this.localSeat;
  }

  /** True when the local client decides for `m` (turn action / reaction / sub-target). */
  private isLocalDecider(m: Mage): boolean {
    if (!this.online) return true;
    return this.seatOf(m) === this.localSeat;
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
    return allSpells().find((s) => s.id === id) ?? null;
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
  private async applyTurnCommand(cmd: TurnCommand): Promise<void> {
    const me = this.gs.current;
    this.resetSelection();
    switch (cmd.t) {
      case 'move':
        me.spend('move');
        await this.runStack(this.gs.makeMoveItem(me, { x: cmd.x, y: cmd.y }));
        break;
      case 'melee': {
        const target = this.mageBySeat(cmd.target);
        me.spend(me.attackIsBonusAction() ? 'bonus' : 'main');
        await this.runStack(this.gs.makeMeleeItem(me, target));
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
        const point = cmd.x != null && cmd.y != null ? { x: cmd.x, y: cmd.y } : null;
        if (cmd.angle != null) me.wallAngle = cmd.angle;
        if (cmd.ability && this.isColorAbility(spell)) this.payForColorAbility(me, spell);
        else this.payForSpell(me, spell);
        await this.runStack(this.gs.makeSpellItem(me, spell, target, point));
        // Mutivarg's Rod: spells cast through it burn 20% of the target's mana.
        if (
          me.hands.includes('mutivargRod' as ItemId) &&
          target &&
          target !== me &&
          target.alive
        ) {
          const burn = Math.floor(target.mana * 0.2);
          if (burn > 0) {
            target.spendMana(burn);
            this.gs.log(`The rod burns ${burn} mana from ${target.name}.`);
          }
        }
        break;
      }
      case 'cast-random': {
        // A scrambled mage (Mind Curse) casts a random spell. Both peers draw
        // from the same synced RNG, so they pick the same spell + target.
        const sub = this.randomCastFor(me);
        if (sub) {
          this.gs.log(`${me.name} is scrambled — ${sub.spell.name} erupts instead!`);
          this.payForSpell(me, sub.spell);
          await this.runStack(this.gs.makeSpellItem(me, sub.spell, sub.target, sub.point));
        }
        break;
      }
      case 'item-drop': {
        me.spend('bonus');
        await this.runStack(
          this.gs.makeActionItem({
            source: me,
            label: 'Drop',
            description: `${me.name} drops an item.`,
            resolve: (game) => {
              game.dropItem(me, cmd.itemId as ItemId);
            },
          })
        );
        break;
      }
      case 'item-pickup': {
        me.spend('bonus');
        await this.runStack(
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
        me.spend('bonus');
        await this.runStack(
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
        me.spend('bonus');
        await this.runStack(
          this.gs.makeActionItem({
            source: me,
            label: 'Equip',
            description: `${me.name} equips ${getItem(itemId).name}.`,
            resolve: () => {
              if (me.equipHand(itemId))
                this.gs.log(`${me.name} equips ${getItem(itemId).name}.`);
            },
          })
        );
        break;
      }
      case 'item-unequip': {
        const itemId = cmd.itemId as ItemId;
        me.spend('bonus');
        await this.runStack(
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
        me.spend('bonus');
        const target = this.mageBySeat(cmd.target);
        await this.runStack(
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
      case 'eldritch': {
        if (me.isActionBanned('eldritch')) {
          this.gs.log(`${me.name} reaches for eldritch truth, but it has been stifled forever.`);
          break;
        }
        me.spend('main');
        const target = cmd.target ? this.mageBySeat(cmd.target) : null;
        await this.runStack(
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
        me.spend('bonus');
        await this.runStack(
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
        me.spend('bonus');
        const target = this.mageBySeat(cmd.target);
        await this.runStack(
          this.gs.makeActionItem({
            source: me,
            label: 'Discharge',
            description: `${me.name} discharges thunder at ${target.name}.`,
            needleBan: { kind: 'ability', key: 'thunder-discharge', label: 'Discharge' },
            resolve: (game) => {
              game.dischargeThunder(me, target);
            },
          })
        );
        break;
      }
      case 'weapon-action': {
        const abilityIds = me.weaponAbilityItems();
        const firstAbility = abilityIds.length ? getItem(abilityIds[0]).weaponAbility : undefined;
        if (firstAbility && me.isActionBanned(`weapon:${firstAbility}`)) {
          this.gs.log(`${me.name}'s weapon action has been stifled forever.`);
          break;
        }
        me.spend('bonus');
        await this.runStack(
          this.gs.makeActionItem({
            source: me,
            label: 'Weapon Action',
            description: `${me.name} uses a weapon action.`,
            needleBan: firstAbility
              ? { kind: 'ability', key: `weapon:${firstAbility}`, label: 'that weapon action' }
              : undefined,
            resolve: async (game) => {
              for (const id of me.weaponAbilityItems()) {
                const ability = getItem(id).weaponAbility;
                if (ability === 'bastionSwap') game.swapBastionForm(me);
                else if (ability === 'mutivargZone') game.castMutivargZone(me);
                else if (ability === 'gamblerCash') await this.gamblerCashOut(me);
              }
            },
          })
        );
        break;
      }
      case 'leap': {
        me.spend('bonus');
        me.leapsUsed += 1;
        // Roll the d6 deterministically so both peers agree on the distance.
        const roll = this.gs.rng.roll('1d6').total;
        const distPx = (roll / 6) * (1 + 0.25 * me.effectiveDex()) * RANGE_UNIT;
        const aim = { x: cmd.x, y: cmd.y };
        await this.runStack(
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
      case 'focus': {
        me.focusUsed = true;
        me.focusNextSpell = true;
        // Focus burns all remaining bonus actions and this turn cycle's reaction.
        me.actions.bonus = 0;
        me.reactionAvailable = false;
        me.reactedThisCycle = true;
        await this.runStack(
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
        me.spend('main');
        me.cleaveUsed = true;
        const aim = { x: cmd.x, y: cmd.y };
        await this.runStack(
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
      case 'end':
        // Handled by the caller (local onEndTurn / remote driver) so the turn
        // rotation happens exactly once per peer.
        break;
    }

    // If the command produced no stack action (e.g. a scrambled mage with
    // nothing castable), unlock local input again so the player can still act.
    if (!this.gs.isOver && this.isLocalTurn() && this.gs.stack.length === 0 && this.mode === 'busy') {
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
      const rarity = rollRarity(() => game.rng.float(), mage.maxLuck);
      const options = draftChoices(rarity, () => game.rng.float(), 3);
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
    this.buildShopOverlay();
    this.shopLocked = false;
    if (this.shopPanel) this.shopPanel.setVisible(true);
    this.refreshShopOverlay();
    return new Promise<number>((resolve) => {
      this.gamblerResolve = resolve;
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
    this.bannerText.setText('Opponent disconnected.\nClick to return to menu').setVisible(true);
    this.redraw();
    this.input.once('pointerdown', () => this.scene.start('Menu'));
  }

  // ===========================================================================
  //  THE STACK  (resolve with reaction windows)
  // ===========================================================================

  private async runStack(initial: StackItem): Promise<void> {
    this.recordLastAction(initial);
    this.busy = true;
    const prevMode = this.mode;
    this.mode = 'busy';
    this.gs.pushStack(initial);
    this.redraw();
    if (initial.kind === 'spell') this.setCharging(initial.source, true);
    await this.delay(250);

    await this.resolveStackLoop();

    this.busy = false;
    if (this.gs.isOver) {
      this.mode = 'over';
    } else if (this.online && !this.isLocalTurn()) {
      // Mid-way through the opponent's relayed turn: stay locked.
      this.mode = 'busy';
    } else if (this.controllerIsAI(this.gs.current)) {
      this.mode = prevMode === 'busy' ? 'busy' : 'idle';
    } else {
      this.mode = 'idle';
    }
    this.redraw();
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
          const negated = await this.performDodge(reactor, top);
          if (negated) {
            this.gs.removeStackItem(top.id);
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
      this.gs.log(`${item.label} fizzles — no valid target.`);
      if (item.kind === 'spell') this.setCharging(item.source, false);
      await this.delay(150);
      return item;
    }

    // A spell must beat its difficulty: roll 1d20 vs the spell's DC. On a miss
    // the spell fizzles entirely (charges/actions are already spent) and no
    // counter effect triggers.
    if (item.kind === 'spell' && item.spell && item.spell.dc) {
      this.pendingDice = [];
      const ok = this.rollSpellSuccess(item.spell, item.source);
      await this.playPendingDice();
      if (!ok) {
        this.setCharging(item.source, false);
        await this.delay(120);
        return item;
      }
    }

    if (item.counters && item.respondingTo != null) {
      const target = this.gs.stack.find((i) => i.id === item.respondingTo);
      if (target) {
        this.gs.removeStackItem(item.respondingTo);
        this.gs.log(`${item.label} counters ${target.label}!`);
        if (target.kind === 'spell') this.setCharging(target.source, false);
      }
    }

    // 1) Finish charging, then play the spell/melee animation and the attack
    //    one-shot (synced to the projectile) as the effect travels to its target.
    if (item.kind === 'spell') await this.finishChargeThenAttack(item.source);
    await this.playActionVisual(item);

    // 2) Apply the effect. Dice rolled inside cast() queue up in pendingDice.
    //    A spell may await interactive sub-targeting here, so resolve is async.
    this.pendingDice = [];
    await item.resolve(this.gs);
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
  private rollSpellSuccess(spell: Spell, source: Mage): boolean {
    // Blue primary tier and assigned Intellect both lower a spell's difficulty.
    // A flat +3 raises the baseline difficulty of every spell.
    const dc = (spell.dc ?? 0) + 3 - (source.profile.bluePrimaryTier ? 2 : 0) - source.dcReduction();
    // Focus grants advantage on this one cast: roll the DC twice, keep the best.
    const focused = source.focusNextSpell;
    const r = this.gs.rng.roll('1d20');
    let best = r;
    if (focused) {
      const r2 = this.gs.rng.roll('1d20');
      if (r2.total > best.total) best = r2;
      source.focusNextSpell = false;
    }
    this.pendingDice.push({
      spec: '1d20',
      total: best.total,
      rolls: best.rolls,
      label: `${spell.name} — success?${focused ? ' (focus)' : ''}`,
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
    this.gs.log(
      `${source.name}'s ${spell.name}: 1d20=${best.total} vs DC ${dc} — ${ok ? 'success!' : 'fizzles.'}${luckNote}`
    );
    // A failed spell can still pay out through gear (Soul Battery / Locket / Tantrum).
    if (!ok) {
      for (const line of source.onSpellFizzle()) this.gs.log(line);
    }
    return ok;
  }

  /** Reaction spells the reactor could actually cast right now (charges + valid target). */
  private castableReactions(reactor: Mage): Spell[] {
    // Casting a word-spell as a reaction requires at least one blue word and is
    // capped per combat. Defensive reactions (Dodge/Block/Bash/Needle) are
    // handled separately and stay available regardless of words.
    if (!reactor.canWordSpellReact()) return [];
    const forgotten = reactor.forgotten();
    const pool = allSpells().filter((s) => s.words.every((w) => reactor.loadout.includes(w)));
    return pool.filter((s) => {
      if (!reactor.hasCharges(s.words)) return false;
      if (!reactor.hasMana(wordSpellMana(s.words, reactor.profile))) return false;
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
    return getColorAbilitiesFor(reactor.profile.primary).filter(
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
    const order = this.gs.initiativeOrder.length
      ? this.gs.initiativeOrder
      : this.gs.mages.map((_, i) => i);
    return order
      .map((i) => this.gs.mages[i])
      .filter(
        (m) =>
          m &&
          m.alive &&
          m !== top.source &&
          m !== this.gs.current &&
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
    // You may never react during your own turn.
    if (reactor === this.gs.current) return false;
    // Physical reactions are meaningless against non-attack triggers (end of
    // turn, a blink step) — only counter-magic answers those.
    const physical = !top.noPhysicalReaction;
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
    // Physical reactions (Block / shield-Bash) need no blue word — they are
    // available when the mage has the gear for them and their reaction is unspent.
    return physical && (this.canBlock(reactor) || this.canBash(reactor, top));
  }

  /** True if `top` is an attack (melee or spell) aimed squarely at `reactor`. */
  private isIncomingAttack(top: StackItem, reactor: Mage): boolean {
    return top.target === reactor && (top.kind === 'melee' || top.kind === 'spell');
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

  private async getReaction(
    reactor: Mage,
    top: StackItem
  ): Promise<ReactionChoice | null> {
    if (this.controllerIsAI(reactor)) {
      // Dev: a passive AI never reacts. Training dummies stay inert too.
      if (Dev.aiPassive || reactor.trainingPassive) return null;
      // Prefer a counter-spell / colour ability if the AI wants one…
      const ai = this.aiFor(reactor);
      const r = ai.chooseReaction(true) ?? null;
      if (r) return { spell: r.spell, target: r.target, point: r.point };
      // …otherwise defend against an incoming attack: dodge first (fully shrugs
      // off the blow for a per-combat charge), then a bash, then a block.
      if (this.isIncomingAttack(top, reactor)) {
        if (this.canDodge(reactor)) return { dodge: true };
        if (this.canBash(reactor, top)) return { shield: 'bash' };
        if (this.canBlock(reactor)) return { shield: 'block' };
      }
      return null;
    }
    // Online: the opponent's reaction arrives over the wire; ours is relayed.
    if (this.online && !this.isLocalDecider(reactor)) {
      const msg = await this.net!.recv();
      if (msg.k === 'bye') return null;
      return this.decodeReaction(msg);
    }
    const choice = await this.promptReaction(reactor, top);
    if (this.online) this.net?.send(this.encodeReaction(choice));
    return choice;
  }

  // ===========================================================================
  //  HUMAN INPUT
  // ===========================================================================

  private bindInput(): void {
    const kb = this.input.keyboard!;
    const keys = ['ONE', 'TWO', 'THREE', 'FOUR'];
    keys.forEach((k, i) => kb.on(`keydown-${k}`, () => this.onWordKey(i)));
    kb.on('keydown-ENTER', () => this.onCast());
    kb.on('keydown-M', () => this.beginMove());
    kb.on('keydown-A', () => this.beginMelee());
    kb.on('keydown-Z', () => this.castColorAbility(0));
    kb.on('keydown-X', () => this.castColorAbility(1));
    kb.on('keydown-E', () => this.onEndTurn());
    kb.on('keydown-G', () => this.onDropItem());
    kb.on('keydown-H', () => {
      if (this.mode === 'aiming-wall') {
        this.wallAimAngle += Math.PI / 12; // rotate 15°
        this.redraw();
        return;
      }
      this.onPickUpItem();
    });
    kb.on('keydown-I', () => this.toggleInventory());
    kb.on('keydown-R', () => void this.onWeaponAction());
    kb.on('keydown-T', () => this.beginThrowFirst());
    kb.on('keydown-Q', () => this.beginEldritch());
    kb.on('keydown-C', () => this.beginThunder());
    kb.on('keydown-L', () => this.beginLeap());
    kb.on('keydown-F', () => this.castFocus());
    kb.on('keydown-V', () => this.beginCleave());
    kb.on('keydown-P', () => this.toggleTrainingOverlay());
    kb.addCapture('TAB');
    kb.on('keydown-TAB', () => this.toggleActionMenu());
    kb.on('keydown-SPACE', () => {
      if (this.mode === 'reaction') this.onReactionPass();
    });
    kb.on('keydown-B', () => {
      if (this.mode === 'reaction') this.chooseShieldReaction('block');
    });
    kb.on('keydown-N', () => {
      if (this.mode === 'reaction') this.chooseShieldReaction('bash');
    });
    kb.on('keydown-K', () => {
      if (this.mode === 'reaction') this.chooseNeedleReaction();
    });
    kb.on('keydown-D', () => {
      if (this.mode === 'reaction') this.chooseDodgeReaction();
    });
    kb.on('keydown-ESC', () => {
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
      this.cancelAiming();
    });

    // Dev cheat toggles (also clickable on the on-field panel).
    kb.addCapture('F1,F2,F3,F4,BACKTICK');
    kb.on('keydown-F1', () => this.toggleDev('autoSuccess'));
    kb.on('keydown-F2', () => this.toggleDev('infiniteMove'));
    kb.on('keydown-F3', () => this.toggleDev('infiniteActions'));
    kb.on('keydown-F4', () => this.toggleDev('aiPassive'));
    kb.on('keydown-BACKTICK', () => this.devPanel.setVisible(!this.devPanel.visible));

    // Right-click opens the action menu, so suppress the browser context menu.
    this.input.mouse?.disableContextMenu();

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      this.pointer = { x: p.worldX, y: p.worldY };
      this.updateHover();
      if (this.mode.startsWith('aiming') || this.mode.startsWith('subtarget')) this.redraw();
    });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointerDown(p));
  }

  /** The mage currently giving input — the reactor during a reaction window. */
  private get actor(): Mage {
    return this.reactor ?? this.gs.current;
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
    } else if (this.selectedIdx.length < MAX_SPELL_WORDS) {
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

  private currentComboSpell(): Spell | undefined {
    if (this.selectedIdx.length === 0) return undefined;
    return getSpell(this.selectedWords());
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
    if (!me.hasMana(wordSpellMana(spell.words, me.profile))) {
      this.flashHint('Not enough mana.');
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
      });
      return;
    }
    if (spell.targeting === 'point') {
      this.pendingSpell = spell;
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
    const weapon = this.gs.current.activeWeapon();
    if (weapon?.usesArrows && this.gs.current.arrows <= 0)
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
    const cont = this.add.container(0, 0).setDepth(97);
    const dim = this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.6)
      .setOrigin(0, 0)
      .setInteractive();
    dim.on('pointerdown', () => this.hideEldritchMenu());
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;
    const box = this.add
      .rectangle(cx, cy, 460, 300, 0x120a1c, 0.98)
      .setOrigin(0.5)
      .setStrokeStyle(2, 0x8a5cff);
    const title = this.add
      .text(cx, cy - 118, 'Mantle of Eldritch Truth', {
        fontSize: '20px',
        color: '#c9a6ff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    cont.add([dim, box, title]);
    const opts: { choice: 'attack' | 'defend' | 'restore'; label: string; desc: string }[] = [
      { choice: 'attack', label: 'Attack', desc: '10 true damage to any one target' },
      { choice: 'defend', label: 'Defend', desc: 'Void all damage until your next turn' },
      { choice: 'restore', label: 'Restore', desc: '+5 HP, +10 mana, +2 of each word' },
    ];
    opts.forEach((o, i) => {
      const y = cy - 60 + i * 58;
      const btn = this.add
        .text(cx, y, o.label, {
          fontSize: '17px',
          color: '#e8dcff',
          backgroundColor: '#241633',
          fontStyle: 'bold',
          padding: { x: 14, y: 6 },
          fixedWidth: 380,
          align: 'center',
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => btn.setBackgroundColor('#3a2352'));
      btn.on('pointerout', () => btn.setBackgroundColor('#241633'));
      btn.on('pointerdown', () => this.onEldritchChoice(o.choice));
      const desc = this.add
        .text(cx, y + 20, o.desc, { fontSize: '11px', color: TEXT.dim })
        .setOrigin(0.5);
      cont.add([btn, desc]);
    });
    this.eldritchMenu = cont;
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
    const cont = this.add.container(0, 0).setDepth(97);
    const dim = this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.6)
      .setOrigin(0, 0)
      .setInteractive();
    dim.on('pointerdown', () => this.hideThunderMenu());
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;
    const box = this.add
      .rectangle(cx, cy, 480, 280, 0x0a1420, 0.98)
      .setOrigin(0.5)
      .setStrokeStyle(2, 0x5cc8ff);
    const title = this.add
      .text(cx, cy - 108, `Roaring Thunder — ${me.thunderStacks} stacks`, {
        fontSize: '20px',
        color: '#9cd8ff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    cont.add([dim, box, title]);
    const opts: { choice: 'charge' | 'discharge'; label: string; desc: string }[] = [
      { choice: 'charge', label: 'Charge Up', desc: 'Spend mana + 1d6 true dmg; roll d4 stacks & color charges' },
      { choice: 'discharge', label: 'Discharge', desc: 'Dump all stacks as bouncing lightning (1d3 per stack)' },
    ];
    opts.forEach((o, i) => {
      const y = cy - 45 + i * 70;
      const btn = this.add
        .text(cx, y, o.label, {
          fontSize: '17px',
          color: '#dff2ff',
          backgroundColor: '#16323f',
          fontStyle: 'bold',
          padding: { x: 14, y: 6 },
          fixedWidth: 400,
          align: 'center',
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => btn.setBackgroundColor('#22506a'));
      btn.on('pointerout', () => btn.setBackgroundColor('#16323f'));
      btn.on('pointerdown', () => this.onThunderChoice(o.choice));
      const desc = this.add
        .text(cx, y + 22, o.desc, { fontSize: '11px', color: TEXT.dim })
        .setOrigin(0.5);
      cont.add([btn, desc]);
    });
    this.thunderMenu = cont;
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
      me.hasMana(wordSpellMana(spell.words, me.profile)) &&
      (spell.actionType === 'main' ? me.actions.main : me.actions.bonus) > 0;
    entries.push({
      id: 'cast',
      label: spell ? `Cast ${spell.name}` : 'Cast spell',
      hotkey: '1–4 / Enter',
      desc: spell
        ? `${spell.actionType} action · ${wordSpellMana(spell.words, me.profile)} mana`
        : 'Click words in the panel to compose a spell, then cast.',
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
    getColorAbilitiesFor(me.profile.primary).forEach((ab, i) => {
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
    const weapon = me.activeWeapon();
    const outOfArrows = !!weapon?.usesArrows && me.arrows <= 0;
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
      entries.push({
        id: 'weapon',
        label: 'Weapon action',
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
      entries.push({
        id: 'pickup',
        label: `Pick up ${getItem(drop.itemId).name}`,
        hotkey: 'H',
        desc: 'Retrieve one of your dropped items (bonus action).',
        enabled: (me.actions.bonus > 0 || inf) && me.hasFreeHand() && !me.swordFormLocked(),
        reason: !me.hasFreeHand()
          ? 'Both hands full.'
          : me.swordFormLocked()
            ? 'Sword form locks your bag.'
            : 'Needs a bonus action.',
        run: () => this.onPickUpItem(),
      });
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
    const physical = !top.noPhysicalReaction;
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
    if (this.mode === 'action-menu') this.mode = this.actionMenuReturn;
    this.redraw();
  }

  private buildActionMenu(): void {
    this.hideActionMenu();
    const reaction = this.actionMenuReturn === 'reaction';
    const entries = reaction ? this.reactionActionEntries() : this.turnActionEntries();
    this.mode = 'action-menu';

    const cont = this.add.container(0, 0).setDepth(98);
    const dim = this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.55)
      .setOrigin(0, 0)
      .setInteractive();
    dim.on('pointerdown', () => this.hideActionMenu());

    const cx = GAME_WIDTH / 2;
    const panelW = 580;
    const rowH = 42;
    const headH = 74;
    const panelH = headH + entries.length * rowH + 14;
    const top0 = Math.max(30, Math.round((GAME_HEIGHT - panelH) / 2));
    const box = this.add
      .rectangle(cx, top0 + panelH / 2, panelW, panelH, 0x0c0c18, 0.98)
      .setOrigin(0.5)
      .setStrokeStyle(2, reaction ? 0xff8a5c : 0x6a6ad0);
    const titleT = this.add
      .text(cx, top0 + 22, reaction ? 'Reaction — choose a response' : 'Actions', {
        fontSize: '20px',
        color: reaction ? '#ffb98a' : TEXT.warn,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const hintT = this.add
      .text(cx, top0 + 48, 'Click an action, or use its hotkey.  [Tab] / [Esc] to close.', {
        fontSize: '12px',
        color: TEXT.dim,
      })
      .setOrigin(0.5);
    cont.add([dim, box, titleT, hintT]);

    const left = cx - panelW / 2;
    entries.forEach((e, i) => {
      const y = top0 + headH + i * rowH;
      const rowBg = this.add
        .rectangle(cx, y + rowH / 2 - 4, panelW - 28, rowH - 6, e.enabled ? 0x1b1b30 : 0x141420, 1)
        .setOrigin(0.5)
        .setStrokeStyle(1, e.enabled ? 0x3a3a66 : 0x24243a);
      const key = this.add
        .text(left + 22, y + 7, e.hotkey, {
          fontSize: '12px',
          color: e.enabled ? TEXT.warn : TEXT.dim,
          backgroundColor: '#00000066',
          padding: { x: 6, y: 3 },
          fixedWidth: 92,
          align: 'center',
        })
        .setOrigin(0, 0);
      const label = this.add
        .text(left + 128, y + 3, e.label, {
          fontSize: '16px',
          color: e.enabled ? TEXT.body : TEXT.dim,
          fontStyle: 'bold',
        })
        .setOrigin(0, 0);
      const desc = this.add
        .text(left + 128, y + 22, e.enabled ? e.desc : e.reason ?? e.desc, {
          fontSize: '11px',
          color: e.enabled ? TEXT.dim : TEXT.bad,
        })
        .setOrigin(0, 0);
      cont.add([rowBg, key, label, desc]);
      if (e.enabled) {
        rowBg.setInteractive({ useHandCursor: true });
        rowBg.on('pointerover', () => rowBg.setFillStyle(0x2a2a4a));
        rowBg.on('pointerout', () => rowBg.setFillStyle(0x1b1b30));
        rowBg.on('pointerdown', () => {
          // The very same click reaches the field's global pointerdown right
          // after this. Guard it so an action that starts aiming doesn't also
          // pick a target here — the player aims on their NEXT click.
          this.menuClickGuard = true;
          this.hideActionMenu();
          e.run();
        });
      }
    });
    this.actionMenu = cont;
  }

  private cancelAiming(): void {
    // Skipping an interactive sub-target resolves it as "no target".
    if (this.mode === 'subtarget-point' || this.mode === 'subtarget-enemy') {
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
      this.flashHint('Reaction — [1-4]+Enter to cast, or Space/E to pass.');
      this.redraw();
      return;
    }
    this.pendingSpell = null;
    this.pendingAbility = null;
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
    if (me.hands.length === 0) return this.flashHint('You have nothing in hand to drop.');
    if (me.actions.bonus <= 0 && !Dev.infiniteActions)
      return this.flashHint('Dropping an item needs a bonus action.');
    // Prefer dropping a non-wand item so casting is freed up first.
    const idx = me.hands.findIndex((id) => !getItem(id).isWand);
    const itemId = me.hands[idx >= 0 ? idx : 0];
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
    if (me.actions.bonus <= 0 && !Dev.infiniteActions)
      return this.flashHint('Dropping an item needs a bonus action.');
    this.closeInventory();
    this.resetSelection();
    this.submitTurn({ t: 'item-drop', itemId });
  }

  /** Equip a hand item out of the bag (bonus action), chosen from the inventory. */
  private equipItem(itemId: ItemId): void {
    if (!this.humanActiveOrInventory) return;
    const me = this.gs.current;
    if (me.swordFormLocked())
      return this.flashHint('The bound greatshield locks your bag — swap to shield form first.');
    if (!me.bag.includes(itemId)) return;
    if (!me.hasFreeHand()) return this.flashHint('Both hands are full — unequip something first.');
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
    if (this.mode !== 'idle' || !this.humanActive) {
      this.flashHint('Inventory is only available on your turn.');
      return;
    }
    this.buildInventoryOverlay();
    this.mode = 'inventory';
    this.invPanel?.setVisible(true);
    this.redraw();
  }

  private closeInventory(): void {
    this.invPanel?.setVisible(false);
    if (this.mode === 'inventory') this.mode = 'idle';
    this.redraw();
  }

  /** A short, human-readable description of a status effect (for hover tips). */
  private statusBlurb(s: Status): string {
    const turns = `${s.duration} turn${s.duration === 1 ? '' : 's'} left`;
    switch (s.kind) {
      case 'invisibility':
        return s.mode === 'full'
          ? `Fully invisible — enemies cannot target you. (${turns})`
          : `Partially veiled — breaks if an enemy gets close. (${turns})`;
      case 'stun': {
        const what =
          s.stunType === 'full'
            ? 'cannot act at all'
            : s.stunType === 'movement'
              ? 'cannot move'
              : 'lose your main action';
        return `Stunned — you ${what}. (${turns})`;
      }
      case 'dot':
        return `Damage over time — takes damage at the start of your turn. (${turns})`;
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
        return `Ward — negates the next mind/sanity hit. (${turns})`;
      case 'auraDot':
        return `Damaging aura — harms nearby enemies each turn. (${turns})`;
      case 'control':
        return `Compelled — your action is hijacked this turn. (${turns})`;
      case 'shadowVeil':
        return `Shadow veil — cloaked in shadow. (${turns})`;
      case 'shadowTrail':
        return `Shadow trail — leaves shadows where you walk. (${turns})`;
      case 'forget':
        return `Forgetful — part of your loadout is unusable. (${turns})`;
      default:
        return turns;
    }
  }

  private buildInventoryOverlay(): void {
    this.invPanel?.destroy();
    this.invTooltip = undefined;
    const me = this.gs.current;
    const panel = this.add.container(0, 0).setDepth(96).setVisible(false);
    const children: Phaser.GameObjects.GameObject[] = [];

    const dim = this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.72)
      .setOrigin(0, 0)
      .setInteractive();
    dim.on('pointerdown', () => this.closeInventory());
    const box = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 920, 560, 0x10101c, 0.98)
      .setOrigin(0.5)
      .setStrokeStyle(2, 0x5a5a88);
    const title = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 250, `${me.name} — Inventory`, {
        fontSize: '22px',
        color: TEXT.warn,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    children.push(dim, box, title);

    const leftX = GAME_WIDTH / 2 - 440;
    const rightX = GAME_WIDTH / 2 + 20;
    const topY = GAME_HEIGHT / 2 - 200;

    children.push(
      this.add.text(leftX, topY - 30, 'Items', { fontSize: '16px', color: TEXT.body, fontStyle: 'bold' })
    );
    const items: { id: ItemId; where: 'hand' | 'bag' | 'utility' }[] = [
      ...me.hands.map((id) => ({ id, where: 'hand' as const })),
      ...me.bag.map((id) => ({ id, where: 'bag' as const })),
      ...me.utility.map((id) => ({ id, where: 'utility' as const })),
    ];
    if (items.length === 0) {
      children.push(
        this.add.text(leftX, topY, '(nothing carried)', { fontSize: '13px', color: TEXT.dim })
      );
    }
    items.forEach((it, i) => {
      const def = getItem(it.id);
      const y = topY + i * 40;
      const tag = it.where === 'hand' ? '  (held)' : it.where === 'bag' ? '  (in bag)' : '';
      const label = this.add.text(leftX, y, `${def.name}${tag}`, {
        fontSize: '13px',
        color: it.where === 'bag' ? TEXT.dim : TEXT.body,
        fixedWidth: 240,
      });
      children.push(label);
      let bx = leftX + 250;
      if (it.where === 'utility' && def.potion) {
        const consume = this.add
          .text(bx, y, '[ Consume ]', {
            fontSize: '13px',
            color: '#7cfc9a',
            backgroundColor: '#181826',
            padding: { x: 6, y: 3 },
          })
          .setInteractive({ useHandCursor: true });
        consume.on('pointerdown', () => this.consumeItem(it.id));
        children.push(consume);
        bx += 120;
      }
      if (it.where === 'utility' && def.throwable) {
        const throwBtn = this.add
          .text(bx, y, '[ Throw ]', {
            fontSize: '13px',
            color: '#ffcf6b',
            backgroundColor: '#181826',
            padding: { x: 6, y: 3 },
          })
          .setInteractive({ useHandCursor: true });
        throwBtn.on('pointerdown', () => this.beginThrow(it.id));
        children.push(throwBtn);
        bx += 120;
      }
      if (it.where === 'bag') {
        const equip = this.add
          .text(bx, y, '[ Equip ]', {
            fontSize: '13px',
            color: '#7cd0ff',
            backgroundColor: '#181826',
            padding: { x: 6, y: 3 },
          })
          .setInteractive({ useHandCursor: true });
        equip.on('pointerdown', () => this.equipItem(it.id));
        children.push(equip);
        bx += 110;
      }
      if (it.where === 'hand') {
        const unequip = this.add
          .text(bx, y, '[ Unequip ]', {
            fontSize: '13px',
            color: '#7cd0ff',
            backgroundColor: '#181826',
            padding: { x: 6, y: 3 },
          })
          .setInteractive({ useHandCursor: true });
        unequip.on('pointerdown', () => this.unequipItem(it.id));
        children.push(unequip);
        bx += 120;
        const drop = this.add
          .text(bx, y, '[ Drop ]', {
            fontSize: '13px',
            color: TEXT.warn,
            backgroundColor: '#181826',
            padding: { x: 6, y: 3 },
          })
          .setInteractive({ useHandCursor: true });
        drop.on('pointerdown', () => this.dropItemById(it.id));
        children.push(drop);
      }
    });

    children.push(
      this.add.text(rightX, topY - 30, 'Status Effects', {
        fontSize: '16px',
        color: TEXT.body,
        fontStyle: 'bold',
      })
    );
    if (me.statuses.length === 0) {
      children.push(
        this.add.text(rightX, topY, '(no active effects)', { fontSize: '13px', color: TEXT.dim })
      );
    }
    me.statuses.forEach((s, i) => {
      const y = topY + i * 34;
      const row = this.add
        .text(rightX, y, `${s.name}  (${s.duration})`, {
          fontSize: '13px',
          color: TEXT.body,
          backgroundColor: '#181826',
          padding: { x: 6, y: 3 },
          fixedWidth: 380,
        })
        .setInteractive({ useHandCursor: true });
      const blurb = this.statusBlurb(s);
      row.on('pointerover', () => {
        this.invTooltip
          ?.setText(blurb)
          .setPosition(rightX, y + 26)
          .setVisible(true);
      });
      row.on('pointerout', () => this.invTooltip?.setVisible(false));
      children.push(row);
    });

    this.invTooltip = this.add
      .text(0, 0, '', {
        fontSize: '12px',
        color: TEXT.body,
        backgroundColor: '#000000',
        padding: { x: 8, y: 6 },
        wordWrap: { width: 360 },
      })
      .setVisible(false);
    children.push(this.invTooltip);

    const close = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 240, '[ Close ]  (I / Esc)', {
        fontSize: '16px',
        color: TEXT.dim,
        backgroundColor: '#181826',
        padding: { x: 14, y: 6 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    close.on('pointerdown', () => this.closeInventory());
    children.push(close);

    panel.add(children);
    this.invPanel = panel;
  }

  /** Activate every held weapon's ability at once (bonus action). */
  private async onWeaponAction(): Promise<void> {
    if (this.mode === 'reaction') return;
    if (!this.humanActive || this.busy) return;
    const me = this.gs.current;
    if (!me.hasWeaponAction()) return this.flashHint('No weapon ability to activate.');
    const firstAbility = me.weaponAbilityItems().map((id) => getItem(id).weaponAbility)[0];
    if (firstAbility && me.isActionBanned(`weapon:${firstAbility}`))
      return this.flashHint('That weapon action has been stifled forever.');
    if (me.actions.bonus <= 0 && !Dev.infiniteActions)
      return this.flashHint('A weapon action needs a bonus action.');
    this.resetSelection();
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
      const src = this.subtargetSource ?? me;
      const origin = this.subtargetOrigin ?? src.pos;
      const target = this.clickedMage(pt, src);
      if (
        target &&
        target.team !== src.team &&
        !this.gs.isUntargetable(target, src) &&
        dist(origin, target.pos) <= this.subtargetRange
      ) {
        this.finishSubtarget(target);
      } else {
        this.flashHint('Invalid target (out of range / unseen).');
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
    if (this.mode === 'aiming-melee') {
      const target = this.clickedMage(pt, me);
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
      if (target && target !== me && target.alive && dist(me.pos, target.pos) <= reach) {
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
        this.submitTurn({ t: 'spell', spellId: spell.id, ability, target: this.seatOf(target) });
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
      const ability = this.pendingAbility != null;
      this.mode = 'busy';
      this.pendingSpell = null;
      this.pendingAbility = null;
      this.submitTurn({ t: 'spell', spellId: spell.id, ability, target: null, x: capped.x, y: capped.y });
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
      });
      return;
    }
  }

  private clickedMage(pt: Vec2, exclude: Mage | null): Mage | null {
    for (const m of this.gs.mages) {
      if (exclude && m === exclude) continue;
      if (dist(pt, m.pos) <= MAGE_RADIUS + 14) return m;
    }
    return null;
  }

  private payForSpell(mage: Mage, spell: Spell, free = false): void {
    mage.spendCharges(spell.words);
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
      this.gs.log(`${mage.name}'s Dark Mage's Cape swallows the cost — the spell is free.`);
    }
    mage.spendMana(mana);
    // A "free" cast (a dodge follow-up) costs no action and does not use up the
    // one-spell-per-turn allowance — but still pays charges, mana and blood.
    if (!free) {
      mage.hasCastThisTurn = true;
      mage.spend(spell.actionType === 'main' ? 'main' : 'bonus');
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
      mage.addThunderStacks(spell.words.length);
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
   * Effective mana cost for a colour ability. A mage carrying no black words
   * pays no mana for colour spells at all (a fully blue caster casts for free).
   */
  private abilityManaCost(me: Mage, ability: ColorAbility): number {
    return me.profile.blackPrimaryTier ? ability.manaCost : 0;
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
      fromLife = Math.min(fromLife, 2);
      fromCharges = charge - fromLife;
      const per = Math.max(1, Math.floor(me.maxHp * 0.05));
      const lifeCost = fromLife * per;
      me.hp = Math.max(1, me.hp - lifeCost);
      this.gs.log(`${me.name} pays ${lifeCost} life for ${fromLife} color charge${fromLife > 1 ? 's' : ''}.`);
    }
    me.spendColorCharges(fromCharges);
    const manaCost = this.abilityManaCost(me, ability);
    me.spendMana(manaCost);
    me.lastAbilityManaPaid = manaCost;
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
    const ability = getColorAbilitiesFor(me.profile.primary)[idx];
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
      const physical = !top.noPhysicalReaction;
      const block = physical && this.canBlock(reactor) ? '  [B] block' : '';
      const bash = physical && this.canBash(reactor, top) ? '  [N] bash' : '';
      const dodge = physical && this.canDodge(reactor) ? `  [D] dodge (${reactor.dodgesRemaining})` : '';
      this.flashHint(
        `${reactor.name}: REACTION — [1-4]+Enter to cast${abil}${block}${bash}${needle}${dodge}, or Space/E to pass.`
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
    const ability = getColorAbilitiesFor(this.reactor.profile.primary)[idx];
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
   *  - triple   → as a pair, plus a free bonus action (offline only).
   *  - quad     → as a triple, but the free action may be a basic attack riposte.
   * Returns true when the strike is avoided (the caller then skips its effect).
   */
  private async performDodge(reactor: Mage, top: StackItem): Promise<boolean> {
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
    });
    await this.playPendingDice();
    const tier = analyzeDodge(roll.rolls);
    this.gs.log(
      `${reactor.name} rolls a dodge [${roll.rolls.join(', ')}] → ${dodgeTierLabel(tier)}.`
    );
    if (tier === 'none') {
      this.gs.log(`${reactor.name} fails to evade — the blow lands.`);
      return false;
    }

    // Success: negate the whole action and let the dodger slip aside. The
    // reposition distance scales only very slightly with Dexterity: 2R at Dex 0
    // up to 4R at Dex 20.
    this.gs.log(`${reactor.name} twists away from the ${top.label.toLowerCase()} — avoided!`);
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

    // A strong roll grants a follow-up action. Gated to offline play so the
    // online lockstep never diverges on an extra, unsynced decision.
    if ((tier === 'triple' || tier === 'quad') && !this.online) {
      await this.dodgeFollowUp(reactor, top, tier === 'quad');
    }
    return true;
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
    reactor.x = final.x;
    reactor.y = final.y;
    this.gs.updateAttachedScarabs();
    this.gs.dropTrailShadows(reactor);
    this.gs.log(`${reactor.name} repositions.`);
    this.redraw();
  }

  /**
   * Offer the post-dodge follow-up: a free bonus action (word-spell or colour
   * ability), or — on a quad — a basic-attack riposte instead. The cast is
   * "free" (no action point) but still pays its mana / charges.
   */
  private async dodgeFollowUp(reactor: Mage, top: StackItem, allowAttack: boolean): Promise<void> {
    const canRiposte = allowAttack && this.gs.canMelee(reactor, top.source);
    const spells = this.affordableFollowupSpells(reactor);
    const abilities = this.castableAbilities(reactor);
    if (!canRiposte && spells.length === 0 && abilities.length === 0) {
      this.gs.log(`${reactor.name} has no follow-up available.`);
      return;
    }

    let choice: DodgeChoice | null;
    if (this.controllerIsAI(reactor)) {
      // Minimal AI: riposte if allowed, else fire the first affordable option.
      if (canRiposte) choice = { kind: 'attack' };
      else if (abilities.length) choice = { kind: 'ability', ability: abilities[0] };
      else if (spells.length) choice = { kind: 'spell', spell: spells[0] };
      else choice = null;
    } else {
      choice = await this.buildDodgeMenu(reactor, canRiposte, spells, abilities);
    }
    if (!choice) return;

    if (choice.kind === 'attack') {
      if (!this.gs.canMelee(reactor, top.source)) return;
      this.gs.pushStack(this.gs.makeMeleeItem(reactor, top.source));
      this.gs.log(`${reactor.name} ripostes!`);
      this.redraw();
      return;
    }

    const spell: Spell = choice.kind === 'ability' ? choice.ability : choice.spell;
    const tgt = await this.resolveFollowupTarget(reactor, spell);
    if (!tgt) return;
    if (choice.kind === 'ability') this.payForColorAbility(reactor, choice.ability, true);
    else this.payForSpell(reactor, choice.spell, true);
    this.gs.pushStack(this.gs.makeSpellItem(reactor, spell, tgt.mage, tgt.point, top.id));
    this.gs.log(`${reactor.name} follows up with ${spell.name}!`);
    this.setCharging(reactor, true);
    this.redraw();
  }

  /** All word-spells the mage could cast right now (charges, mana, valid target). */
  private affordableFollowupSpells(caster: Mage): Spell[] {
    const forgotten = caster.forgotten();
    return allSpells().filter((s) => {
      if (!s.words.every((w) => caster.loadout.includes(w))) return false;
      if (!caster.hasCharges(s.words)) return false;
      if (!caster.hasMana(wordSpellMana(s.words, caster.profile))) return false;
      if (forgotten.length && s.words.some((w) => forgotten.includes(w))) return false;
      if (s.targeting === 'enemy') {
        return this.gs.isValidSpellTarget(s, caster, this.gs.opponentOf(caster));
      }
      return true;
    });
  }

  /** Resolve where a follow-up spell is aimed, prompting the caster if needed. */
  private async resolveFollowupTarget(
    caster: Mage,
    spell: Spell
  ): Promise<{ mage: Mage | null; point: Vec2 | null } | null> {
    const reach = spell.range > 0 ? spell.range : Math.hypot(FIELD.w, FIELD.h);
    switch (spell.targeting) {
      case 'self':
      case 'ally':
        return { mage: caster, point: null };
      case 'none':
        return { mage: null, point: null };
      case 'enemy':
      case 'any': {
        const foe = await this.requestSubtargetEnemy(caster, {
          range: reach,
          prompt: `${caster.name}: choose a target for ${spell.name} (Esc to cancel).`,
        });
        return foe ? { mage: foe, point: null } : null;
      }
      default: {
        const pt = await this.requestSubtargetPoint(caster, {
          maxRange: reach,
          prompt: `${caster.name}: aim ${spell.name} (Esc to cancel).`,
        });
        return pt ? { mage: null, point: pt } : null;
      }
    }
  }

  /** Clickable overlay listing the post-dodge follow-up options for a human. */
  private buildDodgeMenu(
    reactor: Mage,
    canRiposte: boolean,
    spells: Spell[],
    abilities: ColorAbility[]
  ): Promise<DodgeChoice | null> {
    return new Promise((resolve) => {
      const panel = this.add.container(0, 0).setDepth(97);
      const dim = this.add
        .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.72)
        .setOrigin(0, 0)
        .setInteractive();
      panel.add(dim);

      const options: { label: string; color: string; choice: DodgeChoice | null }[] = [];
      if (canRiposte) {
        options.push({ label: '⚔  Riposte — basic attack', color: '#ff9a9a', choice: { kind: 'attack' } });
      }
      for (const ab of abilities) {
        options.push({ label: `✦  ${ab.name}`, color: '#9ad0ff', choice: { kind: 'ability', ability: ab } });
      }
      for (const sp of spells) {
        options.push({ label: sp.name, color: '#e8e8f0', choice: { kind: 'spell', spell: sp } });
      }
      options.push({ label: 'Skip', color: TEXT.dim, choice: null });

      const cx = GAME_WIDTH / 2;
      const rowH = 34;
      const panelH = 72 + options.length * rowH;
      const top0 = Math.max(50, GAME_HEIGHT / 2 - panelH / 2);
      const rect = this.add
        .rectangle(cx, top0 + panelH / 2, 480, panelH, 0x12121e, 0.98)
        .setOrigin(0.5)
        .setStrokeStyle(2, 0x7cc4ff);
      panel.add(rect);
      const title = this.add
        .text(cx, top0 + 22, `Dodge follow-up — ${reactor.name}`, {
          fontSize: '18px',
          color: TEXT.warn,
          fontStyle: 'bold',
        })
        .setOrigin(0.5);
      panel.add(title);

      const finish = (c: DodgeChoice | null): void => {
        panel.destroy();
        resolve(c);
      };
      options.forEach((opt, i) => {
        const y = top0 + 54 + i * rowH;
        const t = this.add
          .text(cx, y, opt.label, {
            fontSize: '16px',
            color: opt.color,
            backgroundColor: '#23233a',
            padding: { x: 12, y: 5 },
          })
          .setOrigin(0.5)
          .setInteractive({ useHandCursor: true });
        t.on('pointerdown', () => finish(opt.choice));
        panel.add(t);
      });
    });
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
      this.mode = 'subtarget-enemy';
      this.flashHint(opts.prompt ?? `${source.name}: pick an enemy  (Esc to skip).`, true);
      this.redraw();
    });
    if (this.online) this.sendSubEnemy(value);
    return value;
  }

  /** Settle the pending sub-target promise and return to the busy resolution. */
  private finishSubtarget(value: Vec2 | Mage | null): void {
    const r = this.subtargetResolve;
    this.subtargetResolve = null;
    this.subtargetSource = null;
    this.subtargetOrigin = null;
    this.subtargetRange = 0;
    this.subtargetMinRange = 0;
    this.mode = 'busy';
    this.redraw();
    if (r) r(value);
  }

  // ===========================================================================
  //  RENDERING
  // ===========================================================================

  private buildStaticGraphics(): void {
    this.gfxStatic = this.add.graphics();
    const g = this.gfxStatic;
    g.fillStyle(COLORS.field, 1).fillRect(FIELD.x, FIELD.y, FIELD.w, FIELD.h);
    g.lineStyle(2, COLORS.fieldBorder, 1).strokeRect(FIELD.x, FIELD.y, FIELD.w, FIELD.h);
    g.lineStyle(1, COLORS.grid, 0.6);
    for (let x = FIELD.x; x <= FIELD.x + FIELD.w; x += 60) g.lineBetween(x, FIELD.y, x, FIELD.y + FIELD.h);
    for (let y = FIELD.y; y <= FIELD.y + FIELD.h; y += 60) g.lineBetween(FIELD.x, y, FIELD.x + FIELD.w, y);

    this.gfx = this.add.graphics();
    // Pulsing valid-target highlights live on their own layer, animated in update().
    this.gfxFx = this.add.graphics().setDepth(6);
    // Scarab health pips, redrawn each frame to track their smoothed motion.
    this.gfxScarab = this.add.graphics().setDepth(7);
    // Targeting overlay drawn when hovering a stack token (line + reticle).
    this.hoverGfx = this.add.graphics().setDepth(8);
  }

  private buildHud(): void {
    this.turnText = this.add.text(FIELD.x, HUD_Y, '', { fontSize: '20px', color: TEXT.body, fontStyle: 'bold' });
    this.comboText = this.add.text(FIELD.x, HUD_Y + 28, '', {
      fontSize: '16px',
      color: TEXT.warn,
      wordWrap: { width: 440 },
      lineSpacing: 2,
    });
    this.actionText = this.add.text(FIELD.x, HUD_Y + 114, '', { fontSize: '16px', color: TEXT.body });
    this.resourceText = this.add.text(FIELD.x, HUD_Y + 138, '', { fontSize: '15px', color: TEXT.warn });
    this.hintText = this.add.text(FIELD.x, HUD_Y + 162, '', { fontSize: '15px', color: TEXT.dim });

    // A clear, always-visible resource read-out (top-left of the field).
    this.resourceGfx = this.add.graphics().setDepth(40).setVisible(false);
    for (let i = 0; i < 5; i++) {
      this.resourceLabels.push(
        this.add
          .text(0, 0, '', { fontSize: '13px', color: TEXT.body, fontStyle: 'bold' })
          .setDepth(41)
          .setVisible(false)
      );
      this.resourceValues.push(
        this.add
          .text(0, 0, '', { fontSize: '12px', color: TEXT.body })
          .setDepth(41)
          .setOrigin(1, 0)
          .setVisible(false)
      );
    }

    this.add.text(FIELD.x, HUD_Y + 186,
      'New here? Click ☰ Actions (or press [Tab] / right-click) to see everything you can do — no need to memorise keys.',
      { fontSize: '13px', color: TEXT.dim });

    // Word boxes laid out as a 2x2 grid so they clear the history panel.
    for (let i = 0; i < 4; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const box = this.add
        .text(FIELD.x + 470 + col * 195, HUD_Y + row * 60, '', {
          fontSize: '15px',
          color: TEXT.body,
          backgroundColor: '#181826',
          padding: { x: 8, y: 6 },
          fixedWidth: 178,
        })
        .setInteractive({ useHandCursor: true });
      // Clicking a word box toggles that word's selection (same as [1]–[4]).
      box.on('pointerdown', () => this.onWordKey(i));
      this.wordTexts.push(box);
    }

    // Always-visible entry point to the context action menu.
    this.actionMenuButton = this.add
      .text(FIELD.x + 470, HUD_Y + 128, '☰  Actions  ([Tab] / right-click)', {
        fontSize: '15px',
        color: '#0c0c18',
        backgroundColor: '#ffd166',
        fontStyle: 'bold',
        padding: { x: 12, y: 7 },
      })
      .setDepth(46)
      .setInteractive({ useHandCursor: true });
    this.actionMenuButton.on('pointerover', () => this.actionMenuButton?.setBackgroundColor('#ffe08a'));
    this.actionMenuButton.on('pointerout', () => this.actionMenuButton?.setBackgroundColor('#ffd166'));
    this.actionMenuButton.on('pointerdown', () => this.toggleActionMenu());

    this.buildHistoryPanel();

    this.tooltip = this.add
      .text(0, 0, '', {
        fontSize: '13px',
        color: TEXT.body,
        backgroundColor: '#000000cc',
        padding: { x: 8, y: 6 },
        wordWrap: { width: 240 },
      })
      .setDepth(50)
      .setVisible(false);

    this.bannerText = this.add
      .text(GAME_WIDTH / 2, FIELD.y + FIELD.h / 2, '', {
        fontSize: '44px',
        color: TEXT.warn,
        fontStyle: 'bold',
        backgroundColor: '#000000cc',
        padding: { x: 24, y: 16 },
      })
      .setOrigin(0.5)
      .setDepth(60)
      .setVisible(false);

    this.buildDevPanel();

    if (this.training) {
      this.add
        .text(FIELD.x + FIELD.w - 178, FIELD.y + 130, '[P] Training tools', {
          fontSize: '13px',
          color: TEXT.warn,
          backgroundColor: '#00000088',
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
    this.historyPanel = this.add.container(0, 0).setDepth(45);
    this.historyBg = this.add
      .rectangle(0, 0, 10, 10, 0x05050c, 0.92)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0x5a5a88);
    this.historyTitle = this.add
      .text(10, 6, '', { fontSize: '14px', color: TEXT.warn, fontStyle: 'bold' })
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
    this.historyToggleTexts = defs.map((d) => {
      const text = this.add
        .text(0, 0, '', { fontSize: '12px', color: TEXT.body })
        .setInteractive({ useHandCursor: true });
      text.on('pointerdown', () => {
        this.historyFilters[d.cat] = !this.historyFilters[d.cat];
        this.refreshHistoryToggles();
        this.drawLog();
      });
      return { cat: d.cat, text };
    });

    this.logText = this.add.text(0, 0, '', {
      fontSize: '13px',
      color: TEXT.dim,
      wordWrap: { width: 340 },
      lineSpacing: 2,
    });

    this.historyPanel.add([
      this.historyBg,
      this.historyTitle,
      ...this.historyToggleTexts.map((t) => t.text),
      this.logText,
    ]);
    this.layoutHistoryPanel();
    this.refreshHistoryToggles();
  }

  /** Position and size the history panel for its current (collapsed/expanded) mode. */
  private layoutHistoryPanel(): void {
    const expanded = this.historyExpanded;
    const w = expanded ? 760 : 360;
    const h = expanded ? 540 : 224;
    const px = expanded ? Math.round((GAME_WIDTH - w) / 2) : GAME_WIDTH - w - 6;
    const py = expanded ? 80 : HUD_Y - 12;
    this.historyPanel.setPosition(px, py).setDepth(expanded ? 70 : 45);
    this.historyBg.setSize(w, h);
    this.historyTitle.setText(`— History —   (${expanded ? 'click to shrink' : 'click to enlarge'})`);

    let tx = 10;
    const toggleY = 28;
    for (const t of this.historyToggleTexts) {
      t.text.setPosition(tx, toggleY);
      tx += t.text.width + 16;
    }
    this.logText.setPosition(10, 50);
    this.logText.setWordWrapWidth(w - 20);
    this.logText.setFontSize(expanded ? 15 : 13);
  }

  /** Refresh the filter-toggle labels/colours to match their on/off state. */
  private refreshHistoryToggles(): void {
    for (const t of this.historyToggleTexts) {
      const on = this.historyFilters[t.cat];
      const label = t.cat === 'cast' ? 'Casts/fails' : t.cat === 'roll' ? 'Rolls' : 'Damage/events';
      t.text.setText(`[${on ? 'x' : ' '}] ${label}`);
      t.text.setColor(on ? '#7cfc9a' : TEXT.dim);
    }
    // Toggle widths changed, so re-flow their horizontal positions.
    let tx = 10;
    for (const t of this.historyToggleTexts) {
      t.text.setPosition(tx, 28);
      tx += t.text.width + 16;
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
    const px = FIELD.x + FIELD.w - 178;
    const py = FIELD.y + 6;
    this.devPanel = this.add.container(px, py).setDepth(60);
    const bg = this.add
      .rectangle(0, 0, 170, 117, 0x000000, 0.55)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0x5a5a88);
    const title = this.add.text(8, 5, 'DEV MODE  (` to hide)', {
      fontSize: '12px',
      color: TEXT.warn,
      fontStyle: 'bold',
    });
    const defs: { key: DevToggle; label: string; hot: string }[] = [
      { key: 'autoSuccess', label: 'Auto-success', hot: 'F1' },
      { key: 'infiniteMove', label: 'Infinite move', hot: 'F2' },
      { key: 'infiniteActions', label: 'Infinite actions', hot: 'F3' },
      { key: 'aiPassive', label: 'AI passive', hot: 'F4' },
    ];
    this.devToggles = defs.map((d, i) => {
      const text = this.add
        .text(8, 27 + i * 21, '', { fontSize: '12px', color: TEXT.body })
        .setInteractive({ useHandCursor: true });
      text.on('pointerdown', () => {
        this.devClickGuard = true;
        this.toggleDev(d.key);
      });
      return { ...d, text };
    });
    this.devPanel.add([bg, title, ...this.devToggles.map((d) => d.text)]);
    this.refreshDevPanel();
  }

  /** Update the dev panel labels/colours to match the current toggle state. */
  private refreshDevPanel(): void {
    for (const d of this.devToggles) {
      const on = Dev[d.key];
      d.text.setText(`[${d.hot}] ${d.label}: ${on ? 'ON' : 'off'}`);
      d.text.setColor(on ? '#7cfc9a' : TEXT.dim);
    }
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
    const dim = this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.78)
      .setOrigin(0, 0)
      .setInteractive();
    const rect = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 820, 620, 0x10101c, 0.98)
      .setOrigin(0.5)
      .setStrokeStyle(2, 0x5a5a88);
    this.trainTitle = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 288, '', {
        fontSize: '22px',
        color: TEXT.warn,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    panel.add([dim, rect, this.trainTitle]);
    this.trainPanel = panel;
  }

  private clearTrainWidgets(): void {
    for (const w of this.trainWidgets) w.destroy();
    this.trainWidgets = [];
  }

  private trainButton(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    color = '#e8e8f0',
    bg = '#23233a',
  ): Phaser.GameObjects.Text {
    const t = this.add
      .text(x, y, label, { fontSize: '15px', color, backgroundColor: bg, padding: { x: 8, y: 4 } })
      .setInteractive({ useHandCursor: true });
    t.on('pointerdown', () => onClick());
    this.trainPanel!.add(t);
    this.trainWidgets.push(t);
    return t;
  }

  private trainLabel(x: number, y: number, text: string, color?: string): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, text, { fontSize: '15px', color: color ?? TEXT.body });
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
    this.trainTitle!.setText('TRAINING TOOLS');

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
        on ? '#7cfc9a' : '#e8e8f0',
        on ? '#2f5d3a' : '#23233a',
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
        on ? '#7cfc9a' : '#e8e8f0',
        on ? '#3a3a66' : '#23233a',
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

    const stack = (label: string, cur: number, field: 'thunder' | 'greed') => {
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
      '#e8e8f0',
      '#3a3a66',
    );
    ax += items.width + 12;
    const reset = this.trainButton(ax, y, 'Soft Reset', () => this.softReset(), '#ffd27a', '#4a3a1a');
    ax += reset.width + 12;
    this.trainButton(ax, y, 'Close [P]', () => this.closeTrainingOverlay(), '#ff9a9a', '#4a1a1a');

    this.trainLabel(
      left,
      GAME_HEIGHT / 2 + 250,
      'Tip: F1 auto-success, F3 infinite actions — toggle for unrestricted casting.',
      TEXT.dim,
    );
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
      '#e8e8f0',
      '#3a3a66',
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
        on ? '#7cfc9a' : '#e8e8f0',
        on ? '#3a3a66' : '#23233a',
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
      const name = this.add
        .text(x + 28, y, def.name, { fontSize: '14px', color: RARITY_COLOR[def.rarity] })
        .setInteractive({ useHandCursor: true });
      name.on('pointerdown', () => {
        this.gs.grantItem(target, def.id);
        this.refreshTrainingOverlay();
        this.redraw();
      });
      this.trainPanel!.add(name);
      this.trainWidgets.push(name);
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

  private adjustStacks(field: 'thunder' | 'greed', delta: number): void {
    const t = this.mageByTeam(this.trainTarget);
    if (field === 'thunder') t.thunderStacks = Math.max(0, t.thunderStacks + delta);
    else t.greedStacks = Math.max(0, t.greedStacks + delta);
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
    if (this.trainPanel) this.trainPanel.setVisible(false);
    for (const m of this.gs.mages) {
      const sp = this.spawns[this.seatOf(m)] ?? (m.team === 1 ? this.playerSpawn : this.enemySpawn);
      m.x = sp.x;
      m.y = sp.y;
      m.hp = m.maxHp;
      m.mana = m.maxMana;
      m.sanity = m.maxSanity;
      m.colorCharges = m.maxColorCharges;
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
      m.bastionShieldForm = false;
      m.shieldBashUsed = false;
      m.firstBlackSpellUsed = false;
      m.manaMilledOnce = false;
      m.actions = { ...ACTIONS_PER_TURN };
      m.reactionAvailable = m.canEverReact;
      m.reactedThisCycle = false;
      const bonus = m.profile.bluePrimaryTier ? 1 : 0;
      for (const w of m.loadout) m.charges[w] = WORDS[w].charges + bonus;
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
  }

  private buildDicePanel(): void {
    this.dicePanel = this.add
      .container(GAME_WIDTH / 2, FIELD.y + 96)
      .setDepth(80)
      .setVisible(false);
  }

  private redraw(): void {
    const g = this.gfx;
    g.clear();
    this.stackTokens = [];
    // The hover targeting overlay is rebuilt on the next pointer move; clear any
    // stale line/reticle so it does not linger after the stack changes.
    this.hoverGfx?.clear();

    // Shadow pools (under everything else on the field).
    this.drawShadows(g);

    // Reality-break barriers.
    this.drawBarriers(g);

    // Mutivarg crushing fields.
    this.drawMutivargZones(g);

    // Corrosion totems.
    this.drawTotems(g);

    // Remaining-duration counters on every field zone (visible to everyone).
    this.drawZoneDurations();

    // Dropped equipment on the ground.
    this.drawDroppedItems(g);

    // Aiming ranges.
    this.drawAimingRange(g);

    // Mages.
    for (const m of this.gs.mages) this.drawMage(g, m);

    // Stack tokens.
    this.drawStack(g);

    // HUD text.
    this.drawHud();
  }

  private drawShadows(g: Phaser.GameObjects.Graphics): void {
    for (const s of this.gs.shadows) {
      const tint = s.owner === 1 ? COLORS.team1 : COLORS.team2;
      g.fillStyle(COLORS.shadow, 0.22).fillCircle(s.x, s.y, s.radius);
      g.fillStyle(0x000000, 0.28).fillCircle(s.x, s.y, s.radius * 0.7);
      g.lineStyle(2, tint, 0.55).strokeCircle(s.x, s.y, s.radius);
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
            fontSize: '12px',
            fontStyle: 'bold',
            backgroundColor: '#0b0b14cc',
            padding: { x: 4, y: 1 },
            align: 'center',
          })
          .setOrigin(0.5);
        this.zoneLabels.set(key, t);
      }
      const hex = owner === 1 ? '#57a6ff' : '#ff6f6f';
      t.setText(`⌛${turns}`).setColor(hex).setPosition(x, y).setVisible(true);
    };
    for (const s of this.gs.shadows) show(`sh${s.id}`, s.x, s.y - s.radius - 10, s.ttl, s.owner);
    for (const t of this.gs.totems) show(`to${t.id}`, t.x, t.y - t.radius - 10, t.ttl, t.owner);
    for (const z of this.gs.mutivargZones)
      show(`mv${z.id}`, z.x, z.y - z.radius - 10, z.turnsLeft, z.owner);
    for (const b of this.gs.barriers) show(`ba${b.id}`, b.x, b.y, b.ttl, b.owner);
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
      g.fillStyle(0x000000, 0.45).fillCircle(d.x, d.y, 10);
      g.fillStyle(tint, 0.85);
      g.beginPath();
      g.moveTo(d.x, d.y - 8);
      g.lineTo(d.x + 8, d.y);
      g.lineTo(d.x, d.y + 8);
      g.lineTo(d.x - 8, d.y);
      g.closePath();
      g.fillPath();
      g.lineStyle(2, 0xffffff, 0.8).strokeCircle(d.x, d.y, 10);

      let t = this.dropLabels.get(d.id);
      if (!t) {
        t = this.add
          .text(0, 0, '', { fontSize: '11px', color: TEXT.dim, align: 'center' })
          .setOrigin(0.5);
        this.dropLabels.set(d.id, t);
      }
      t.setText(getItem(d.itemId).name);
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

  private drawAimingRange(g: Phaser.GameObjects.Graphics): void {
    // Interactive sub-targeting: draw the reach from its origin and an aim line.
    if (this.mode === 'subtarget-point' || this.mode === 'subtarget-enemy') {
      const origin = this.subtargetOrigin ?? this.gs.current.pos;
      if (this.subtargetRange > 0 && Number.isFinite(this.subtargetRange)) {
        g.lineStyle(2, COLORS.rangeStroke, 0.7).strokeCircle(origin.x, origin.y, this.subtargetRange);
        g.fillStyle(COLORS.rangeStroke, 0.05).fillCircle(origin.x, origin.y, this.subtargetRange);
      }
      if (this.subtargetMinRange > 0) {
        g.lineStyle(1, COLORS.rangeStroke, 0.5).strokeCircle(origin.x, origin.y, this.subtargetMinRange);
      }
      g.lineStyle(1, COLORS.selected, 0.6).lineBetween(origin.x, origin.y, this.pointer.x, this.pointer.y);
      return;
    }

    const aiming = this.mode.startsWith('aiming');
    // While aiming, the origin is the active source (current mage on a turn, or
    // the reactor while reaction-aiming). When merely previewing a selected
    // combo, anchor the range to the mage whose hand is shown (the reactor
    // during a reaction, the local player online) — never the enemy.
    const me = aiming ? (this.aimingSource ?? this.gs.current) : this.viewMage;
    if (this.controllerIsAI(me) && !aiming) return;

    let range = 0;
    if (this.mode === 'aiming-move') range = me.moveRange();
    else if (this.mode === 'aiming-leap') {
      // The farthest a leap can carry: a max d6 roll of 6.
      range = (1 + 0.25 * me.effectiveDex()) * RANGE_UNIT;
    } else if (this.mode === 'aiming-cleave') {
      const weapon = me.activeWeapon();
      range = weapon ? weapon.rangePx : MELEE_RANGE;
    } else if (this.mode === 'aiming-melee') {
      const weapon = me.activeWeapon();
      range = weapon ? weapon.rangePx : MELEE_RANGE;
      // Draw the dead-zone of a minimum-range weapon (e.g. the sniper bow).
      if (weapon?.minRangePx) {
        g.lineStyle(1, COLORS.rangeStroke, 0.5).strokeCircle(me.x, me.y, weapon.minRangePx);
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
      g.lineStyle(2, COLORS.rangeStroke, 0.7).strokeCircle(me.x, me.y, range);
      g.fillStyle(COLORS.rangeStroke, 0.05).fillCircle(me.x, me.y, range);
    }

    // Owned shadows extend reach — outline them as alternate cast origins.
    if (aiming && (this.mode === 'aiming-spell' || this.mode === 'aiming-point') && Number.isFinite(range)) {
      for (const s of this.gs.shadowsOf(me.team)) {
        g.lineStyle(1, COLORS.shadow, 0.8).strokeCircle(s.x, s.y, range);
      }
    }

    // Aiming preview line.
    if (aiming) {
      g.lineStyle(1, COLORS.selected, 0.6).lineBetween(me.x, me.y, this.pointer.x, this.pointer.y);
    }

    // Area-of-effect footprint while aiming a point spell (cone / circle).
    if (aiming && this.mode === 'aiming-point') {
      const spell = this.reactionAiming ? this.reactionPendingSpell : this.pendingSpell;
      if (spell?.aoe) {
        const reach = Number.isFinite(spell.range) ? spell.range : 99999;
        const toward = stepTowards(me.pos, this.pointer, reach);
        this.drawAoePreview(g, me.pos, toward, spell.aoe);
      }
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
    for (const set of ANIM_SETS) {
      if (this.anims.exists(set.key)) continue;
      this.anims.create({
        key: set.key,
        frames: set.frames.map((_, i) => ({ key: `${set.key}-${i}` })),
        frameRate: set.frameRate,
        repeat: set.repeat,
      });
    }
  }

  private mageAnims = new Map<Mage, MageAnim>();

  // Scarab sprites: one animated sprite per live scarab, with a smoothed
  // display position so they glide between turns instead of teleporting.
  private scarabSprites = new Map<number, ScarabRec>();
  private scarabAnimReady = false;
  private scarabFrameCount = 1;

  /** Mages awaiting a hit recoil; flushed after their damage dice resolve. */
  private pendingHits: Mage[] = [];

  /** Create/position each mage's sprite and pick its resting animation. */
  private syncMageSprites(): void {
    if (!this.gs) return;
    // Frames are bottom-aligned (the 16x16 idle/run/role/hit sets and the 32x32
    // attack/charge sets all rest their feet on the frame's bottom edge), so
    // anchor sprites by the feet. This keeps every animation's body in line; the
    // taller frames simply extend their staff-swing headroom upward.
    const footY = MAGE_RADIUS * 1.4;
    for (const m of this.gs.mages) {
      let rec = this.mageAnims.get(m);
      if (!rec) {
        const sprite = this.add.sprite(m.x, m.y, 'mage-idle-0').setOrigin(0.5, 1).setDepth(5);
        const srcH = sprite.height || 1;
        sprite.setScale((MAGE_RADIUS * 2.8) / srcH);
        sprite.play('mage-idle');
        rec = { sprite, lock: null, posLocked: false, charging: false };
        this.mageAnims.set(m, rec);
      }
      const s = rec.sprite;
      if (!rec.posLocked) s.setPosition(m.x, m.y + footY);
      s.setFlipX(m.team === 2);
      if (!m.alive) {
        s.setVisible(false);
        continue;
      }
      s.setVisible(true);
      s.setAlpha(m.isFullyInvisible() ? 0.18 : m.isInvisible() ? 0.5 : 1);
      // Resting animation: charge while a spell is pending, otherwise idle.
      if (rec.lock === null) {
        const want = rec.charging ? 'mage-charge' : 'mage-idle';
        if (s.anims.currentAnim?.key !== want) s.play(want, true);
      }
    }
  }

  private setCharging(m: Mage, on: boolean): void {
    const rec = this.mageAnims.get(m);
    if (rec) rec.charging = on;
  }

  /** Queue a hit recoil to play once the damage dice have resolved. */
  private playHit(m: Mage): void {
    if (!this.pendingHits.includes(m)) this.pendingHits.push(m);
  }

  /** Play every queued hit recoil and clear the queue. */
  private flushHits(): void {
    const queued = this.pendingHits;
    this.pendingHits = [];
    for (const m of queued) this.triggerHit(m);
  }

  /** Brief recoil when a mage takes damage; never interrupts movement/attack. */
  private triggerHit(m: Mage): void {
    const rec = this.mageAnims.get(m);
    if (!rec || rec.lock) return;
    rec.lock = 'hit';
    rec.sprite.play('mage-hit', true);
    rec.sprite.once('animationcomplete-mage-hit', () => {
      if (rec.lock === 'hit') rec.lock = null;
    });
  }

  /** Let the charge loop finish, then fire the one-shot attack (synced to VFX). */
  private async finishChargeThenAttack(m: Mage): Promise<void> {
    const rec = this.mageAnims.get(m);
    if (!rec) return;
    if (rec.sprite.anims.currentAnim?.key === 'mage-charge') {
      await new Promise<void>((res) => rec!.sprite.once('animationrepeat', res));
    }
    rec.charging = false;
    rec.lock = 'attack';
    rec.sprite.play('mage-attack', true);
    rec.sprite.once('animationcomplete-mage-attack', () => {
      if (rec.lock === 'attack') rec.lock = null;
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
      rec.sprite.play('mage-run', true);
      this.tweens.add({
        targets: m,
        x: to.x,
        y: to.y,
        duration: MOVE_DURATION,
        ease: 'Sine.InOut',
        onUpdate: () => this.redraw(),
        onComplete: () => {
          rec.lock = null;
          resolve();
        },
      });
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
    rec.sprite.play('mage-role', true);
    this.tweens.add({
      targets: rec.sprite,
      x: m.x,
      y: m.y + footY,
      duration: DASH_DURATION,
      ease: 'Sine.Out',
      onComplete: () => {
        rec.lock = null;
        rec.posLocked = false;
      },
    });
  }

  private drawMage(g: Phaser.GameObjects.Graphics, m: Mage): void {
    let alpha = 1;
    if (m.isFullyInvisible()) alpha = 0.18;
    else if (m.isInvisible()) alpha = 0.5;

    const active = m === this.gs.current && !this.gs.isOver;
    if (active) g.lineStyle(3, COLORS.selected, alpha).strokeCircle(m.x, m.y, MAGE_RADIUS + 8);

    // The mage body itself is drawn by its animated sprite (see syncMageSprites).

    // Bars.
    const bw = 56;
    const bx = m.x - bw / 2;
    const by = m.y - MAGE_RADIUS - 26;
    g.fillStyle(0x000000, 0.6).fillRect(bx - 1, by - 1, bw + 2, 14);
    g.fillStyle(0x333333, 1).fillRect(bx, by, bw, 6);
    g.fillStyle(COLORS.hp, 1).fillRect(bx, by, bw * (m.hp / m.maxHp), 6);
    g.fillStyle(0x333333, 1).fillRect(bx, by + 7, bw, 5);
    g.fillStyle(COLORS.sanity, 1).fillRect(bx, by + 7, bw * (m.sanity / m.maxSanity), 5);

    // Name + statuses.
    this.labelMage(m);
  }

  private mageLabels = new Map<Mage, Phaser.GameObjects.Text>();
  private labelMage(m: Mage): void {
    let t = this.mageLabels.get(m);
    if (!t) {
      t = this.add.text(0, 0, '', { fontSize: '12px', color: TEXT.body, align: 'center' }).setOrigin(0.5);
      this.mageLabels.set(m, t);
    }
    const statuses = m.statuses
      .map((s) =>
        Number.isFinite(s.duration) && s.duration > 0 ? `${s.name} ⌛${s.duration}` : s.name
      )
      .join(', ');
    t.setText(`${m.name}\n${m.hp}❤ ${m.sanity}🧠${statuses ? `\n${statuses}` : ''}`);
    t.setPosition(m.x, m.y + MAGE_RADIUS + 22);
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
      g.fillStyle(col, 0.85).fillCircle(x, y, r);
      g.lineStyle(2, COLORS.stack, 1).strokeCircle(x, y, r);
      this.stackTokens.push({ x, y, r, item });

      // Overlay the action-type icon (move / basic attack / spell cast).
      const key = `stack-${item.kind}`;
      let icon = this.stackIcons[i];
      if (!icon) {
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
    g.lineStyle(1, COLORS.stack, 0.5).strokeRect(startX - 30, y - 30, (n - 1) * 56 + 60, 60);
  }

  private drawHud(): void {
    const me = this.viewMage;
    if (this.mode === 'reaction' && this.reactor) {
      const abil = this.castableAbilities(this.reactor).length > 0 ? ', [Z/X] color ability' : '';
      this.turnText.setText(
        `${this.reactor.name}: REACTION — [1-4]+Enter to cast${abil}, Space/E to pass`
      );
    } else {
      const cur = this.gs.current;
      const swap = this.gs.controlSwapped ? '   ⟲ MINDS SWAPPED' : '';
      this.turnText.setText(
        this.gs.isOver
          ? ''
          : `Round ${this.gs.round} — ${cur.name}'s turn${this.controllerIsAI(cur) ? ' (AI thinking…)' : ''}${swap}`
      );
    }

    const spell = this.currentComboSpell();
    const sel = this.selectedWords().map((w) => WORDS[w].label).join(' + ');
    if (this.selectedIdx.length === 0) {
      this.comboText.setText('Selection: —');
    } else if (spell) {
      const rng = Number.isFinite(spell.range) ? `rng ${spell.range}` : 'any range';
      const mana = wordSpellMana(spell.words, me.profile);
      const desc = spell.description ? `\n${spell.description}` : '';
      this.comboText.setText(
        `Selection: ${sel}  →  ${spell.name} (${spell.actionType}, ${rng}, ${mana} mana)${desc}`
      );
    } else {
      this.comboText.setText(`Selection: ${sel}  →  (no spell)`);
    }

    const a = me.actions;
    const reactionLabel = me.profile.bluePrimaryTier
      ? `${Math.max(0, MAX_WORD_SPELL_REACTIONS - me.wordSpellReactionsUsed)} spell`
      : 'defensive';
    this.actionText.setText(
      `Actions — Move ${dots(a.move, ACTIONS_PER_TURN.move)}  Main ${dots(a.main, ACTIONS_PER_TURN.main)}  Bonus ${dots(a.bonus, ACTIONS_PER_TURN.bonus)}   Reaction: ${reactionLabel}`
    );

    this.drawResourceText(me);
    this.drawResourcePanel(me);

    // Word boxes for the active human.
    for (let i = 0; i < 4; i++) {
      const t = this.wordTexts[i];
      if (this.controllerIsAI(me) || i >= me.loadout.length) {
        t.setText('').setVisible(false);
        continue;
      }
      t.setVisible(true);
      const w = me.loadout[i];
      const on = this.selectedIdx.includes(i);
      const reaction = WORDS[w].grantsReaction ? ' ⚡' : '';
      t.setText(`[${i + 1}] ${WORDS[w].label}${reaction}\ncharges: ${me.charges[w] ?? 0}`);
      t.setBackgroundColor(on ? '#3a3a1a' : '#181826');
      t.setColor(on ? TEXT.warn : (me.charges[w] ?? 0) > 0 ? TEXT.body : TEXT.dim);
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
        this.mode === 'reaction'
          ? '☰  Reaction options  ([Tab])'
          : '☰  Actions  ([Tab] / right-click)'
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
    const abilities = getColorAbilitiesFor(p.primary);
    const abilText = abilities.length
      ? abilities
          .map((ab, i) => {
            const c = this.abilityChargeCost(me, ab);
            return `[${i === 0 ? 'Z' : 'X'}] ${ab.name} (${c}c/${this.abilityManaCost(me, ab)}m)`;
          })
          .join('   ')
      : 'none';
    const statText = me.statsAssigned
      ? `   STR ${me.effectiveStr()}  DEX ${me.effectiveDex()}%  INT ${me.effectiveInt()}  Luck ${me.luck}/${me.maxLuck}`
      : '';
    const hands = me.hands.length ? me.hands.map((id) => getItem(id).name).join(' + ') : '—';
    const worn = [me.head, me.torso, me.boots, ...me.accessories]
      .filter((id): id is ItemId => !!id)
      .map((id) => getItem(id).name);
    const wornText = worn.length ? worn.join(', ') : '—';
    const potions = me.utility.length;
    const utilBits: string[] = [];
    if (me.arrows > 0) utilBits.push(`${me.arrows} arrows`);
    if (potions > 0) utilBits.push(`${potions} potion${potions > 1 ? 's' : ''}`);
    const utilText = utilBits.length ? `   ${utilBits.join(', ')}` : '';
    const bagText = me.bag.length
      ? `\nBag: ${me.bag.map((id) => getItem(id).name).join(', ')}`
      : '';
    const cap = me.carryCap();
    const capText = Number.isFinite(cap) ? `${cap}kg` : '∞';
    const gearText =
      `\nHands: ${hands}   Worn: ${wornText}${utilText}` +
      `   Wt ${me.carriedWeight()}/${capText}${bagText}`;
    this.resourceText.setText(
      `[${identity}]   ${abilText}${statText}${gearText}`
    );
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

    const x = FIELD.x + 8;
    const y = FIELD.y + 8;
    const w = 214;
    const rowH = 22;
    const pad = 8;
    const h = pad * 2 + rows.length * rowH;
    g.fillStyle(0x05050c, 0.82).fillRect(x, y, w, h);
    g.lineStyle(1, 0x5a5a88, 0.9).strokeRect(x, y, w, h);
    g.setVisible(true);

    const barX = x + 66;
    const barW = 104;
    const barH = 11;
    rows.forEach((r, i) => {
      const ry = y + pad + i * rowH;
      const label = this.resourceLabels[i];
      label.setText(r.label).setPosition(x + 10, ry).setVisible(true);
      const frac = r.max > 0 ? Math.max(0, Math.min(1, r.cur / r.max)) : 0;
      g.fillStyle(0x1a1a2a, 1).fillRect(barX, ry + 2, barW, barH);
      g.fillStyle(r.color, 1).fillRect(barX, ry + 2, barW * frac, barH);
      g.lineStyle(1, 0x000000, 0.5).strokeRect(barX, ry + 2, barW, barH);
      const val = this.resourceValues[i];
      val.setText(`${r.cur}/${r.max}`).setPosition(x + w - 8, ry).setVisible(true);
    });
    for (let i = rows.length; i < this.resourceLabels.length; i++) {
      this.resourceLabels[i].setVisible(false);
      this.resourceValues[i].setVisible(false);
    }
  }

  private drawLog(): void {
    if (!this.logText) return;
    const max = this.historyExpanded ? 26 : 9;
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
    // Highlight the actor so it is clear who is performing the action.
    g.lineStyle(2, 0xffe066, 0.9).strokeCircle(from.x, from.y, 16);
    if (!to) return;
    // A dashed-looking aim line from the actor to the target.
    g.lineStyle(2, 0xffe066, 0.85).lineBetween(from.x, from.y, to.x, to.y);
    // A reticle at the destination / target.
    g.lineStyle(2, 0xff6b6b, 0.95).strokeCircle(to.x, to.y, 12);
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
    // Training never truly ends: whoever fell is patched up on the next click.
    if (this.training && !this.opponentLeft) {
      this.mode = 'over';
      this.busy = false;
      const w = this.gs.winner;
      this.bannerText
        .setText(`${w ? `${w.name} fell` : 'Both fell'}\nClick to reset the field`)
        .setVisible(true);
      this.redraw();
      this.input.once('pointerdown', () => {
        this.bannerText.setVisible(false);
        this.softReset();
      });
      return;
    }
    this.mode = 'over';
    const w = this.gs.winner;
    this.bannerText
      .setText(w ? `${w.name} wins!\nClick to return to menu` : 'Draw!\nClick to return to menu')
      .setVisible(true);
    this.redraw();
    this.input.once('pointerdown', () => this.scene.start('Menu'));
  }

  // ===========================================================================
  //  SPELL VISUALS
  // ===========================================================================

  /** Play the animation for a resolving action before its effect lands. */
  private playActionVisual(item: StackItem): Promise<void> {
    if (item.kind === 'move') return this.animateMove(item.source, item.targetPoint ?? item.source.pos);
    // Generic actions (item use / throw / Eldritch / Thunder / weapon action)
    // paint their own effects inside resolve — no default cast animation.
    if (item.kind === 'action') return Promise.resolve();

    const from = item.source.pos;
    const to: Vec2 | null = item.target ? item.target.pos : item.targetPoint ?? null;

    if (item.kind === 'melee') {
      return this.vfxBurst(item.target?.pos ?? from, 0xffffff, 34, 1.6);
    }

    const v = item.spell?.visual ?? this.defaultVisual(item);
    // If the target is only reachable through one of the caster's shadows,
    // route the spell from caster → shadow → target ("bounce through").
    const via = to ? this.bounceShadow(item.source, to, item.spell?.range ?? Infinity) : null;
    switch (v.preset) {
      case 'projectile':
        if (!to) return this.vfxNova(from, v);
        return via
          ? this.vfxProjectile(from, via, v).then(() => this.vfxProjectile(via, to, v))
          : this.vfxProjectile(from, to, v);
      case 'beam':
        if (!to) return Promise.resolve();
        return via
          ? this.vfxBeam(from, via, v).then(() => this.vfxBeam(via, to, v))
          : this.vfxBeam(from, to, v);
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
  private bounceShadow(source: Mage, target: Vec2, range: number): Vec2 | null {
    if (dist(source.pos, target) <= range) return null;
    let best: ShadowZone | null = null;
    let bestD = Infinity;
    for (const s of this.gs.shadowsOf(source.team)) {
      const d = dist({ x: s.x, y: s.y }, target);
      if (d <= range && d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  }

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

  private vfxProjectile(from: Vec2, to: Vec2, v: SpellVisual): Promise<void> {
    return new Promise((resolve) => {
      const size = v.size ?? 10;
      const speed = v.speed ?? 1;
      const orb = this.add.circle(from.x, from.y, size, v.color, 1).setDepth(30);
      orb.setStrokeStyle(2, 0xffffff, 0.85);
      const d = dist(from, to);
      const duration = Math.min(900, Math.max(140, d / (0.85 * speed)));
      this.tweens.add({
        targets: orb,
        x: to.x,
        y: to.y,
        duration,
        ease: 'Sine.InOut',
        onComplete: () => {
          orb.destroy();
          this.vfxBurst(to, v.color, size * 2.4, speed).then(resolve);
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
        duration: 200 / speed,
        ease: 'Quad.Out',
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
          duration: 220 / speed,
          ease: 'Quad.In',
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
        duration: 620 / speed,
        ease: 'Sine.Out',
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
          duration: 520 / speed,
          delay: (i * 40) / speed,
          ease: 'Sine.Out',
          onComplete: () => sparkle.destroy(),
        });
      }
      this.time.delayedCall(640 / speed, resolve);
    });
  }

  private vfxBeam(from: Vec2, to: Vec2, v: SpellVisual): Promise<void> {
    return new Promise((resolve) => {
      const width = v.size ?? 6;
      const g = this.add.graphics().setDepth(30);
      this.tweens.addCounter({
        from: 1,
        to: 0,
        duration: 320 / (v.speed ?? 1),
        onUpdate: (tw) => {
          const a = tw.getValue() ?? 0;
          g.clear();
          g.lineStyle(width + 4, v.color, a * 0.3).lineBetween(from.x, from.y, to.x, to.y);
          g.lineStyle(width, v.color, a).lineBetween(from.x, from.y, to.x, to.y);
        },
        onComplete: () => {
          g.destroy();
          resolve();
        },
      });
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
        duration: 360 / (speed || 1),
        ease: 'Cubic.Out',
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

  // ===========================================================================
  //  DICE WINDOW
  // ===========================================================================

  private async playPendingDice(): Promise<void> {
    const queued = this.pendingDice;
    this.pendingDice = [];
    for (const roll of queued) await this.playOneDice(roll);
  }

  private parseSides(spec: string): number {
    const m = /d(\d+)/i.exec(spec);
    return m ? parseInt(m[1], 10) : 6;
  }

  /** Show one roll: tumble for ~1s, settle on the result, linger ~1s, fade. */
  private playOneDice(roll: DiceRoll): Promise<void> {
    return new Promise((resolve) => {
      const sides = this.parseSides(roll.spec);
      const n = Math.max(1, roll.rolls.length);
      const dieSize = 46;
      const gap = 12;
      const diceW = n * dieSize + (n - 1) * gap;
      const titleText = roll.label ?? roll.spec;
      const panelW = Math.max(diceW + 150, titleText.length * 11 + 40);

      this.dicePanel.removeAll(true);
      const bg = this.add.rectangle(0, 0, panelW, 116, 0x10101c, 0.97).setStrokeStyle(2, COLORS.stack);
      const title = this.add
        .text(0, -42, titleText, { fontSize: '18px', color: TEXT.warn, fontStyle: 'bold' })
        .setOrigin(0.5);
      const label = this.add
        .text(-panelW / 2 + 14, -16, roll.spec, { fontSize: '13px', color: TEXT.dim })
        .setOrigin(0, 0.5);
      this.dicePanel.add([bg, title, label]);

      const faces: Phaser.GameObjects.Text[] = [];
      const startX = -diceW / 2 + dieSize / 2;
      for (let i = 0; i < n; i++) {
        const dx = startX + i * (dieSize + gap);
        const sq = this.add.rectangle(dx, 16, dieSize, dieSize, 0xf4f4ff).setStrokeStyle(2, 0x333355);
        const face = this.add
          .text(dx, 16, '?', { fontSize: '26px', color: '#15151f', fontStyle: 'bold' })
          .setOrigin(0.5);
        this.dicePanel.add([sq, face]);
        faces.push(face);
      }
      const totalTxt = this.add
        .text(diceW / 2 + 18, 16, '', { fontSize: '26px', color: TEXT.good, fontStyle: 'bold' })
        .setOrigin(0, 0.5);
      this.dicePanel.add(totalTxt);

      this.dicePanel.setVisible(true).setAlpha(0).setScale(0.9);
      this.tweens.add({ targets: this.dicePanel, alpha: 1, scale: 1, duration: 130 });

      // Tumble.
      const tumble = this.time.addEvent({
        delay: 70,
        loop: true,
        callback: () => faces.forEach((f) => f.setText(String(1 + Math.floor(Math.random() * sides)))),
      });

      this.time.delayedCall(1000, () => {
        tumble.remove();
        roll.rolls.forEach((value, i) => faces[i]?.setText(String(value)));
        if (roll.rolls.length === 0) faces[0]?.setText(String(roll.total));
        totalTxt.setText('= ' + roll.total);
        this.tweens.add({ targets: this.dicePanel, scale: 1.08, duration: 110, yoyo: true });

        this.time.delayedCall(1000, () => {
          this.tweens.add({
            targets: this.dicePanel,
            alpha: 0,
            duration: 160,
            onComplete: () => {
              this.dicePanel.setVisible(false);
              this.dicePanel.removeAll(true);
              resolve();
            },
          });
        });
      });
    });
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
  /** A Needle of Serenity reaction: stifle & permanently ban the action. */
  needle?: boolean;
  /** A Dexterity dodge: roll to evade the attack (and maybe more). */
  dodge?: boolean;
}

function dots(remaining: number, total: number): string {
  return '●'.repeat(Math.max(0, remaining)) + '○'.repeat(Math.max(0, total - remaining)) || '—';
}
