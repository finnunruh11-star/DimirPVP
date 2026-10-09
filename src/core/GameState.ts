import { Dice, type RollResult } from './Dice';
import { Mage } from './Mage';
import { packCapacity, packSlotsUsed } from './Pack';
import type { HexGroundSpec, HexSide } from './hexcraft/runes';
import { hexEcho, hexMoved, hexStruck } from '../effects/hexzettel';
import type { StackItem, NeedleBan } from './Stack';
import type { Spell } from '../spells/Spell';
import { applyMindLightningStack, mindLightningBoltTarget, mindLightningDamage } from '../spells/mindLightning';
import type { EffectContext, VfxSink, SubTargeter, DealDamageOptions } from '../effects/effects';
import { dealDamage, drainDamage, heal, applyDot, applyStackingDot, applyDebuff, applyForget, applyInvisibility, applyStun, cleanse, dash, rollDice, teleport } from '../effects/effects';
import { dmg } from './Damage';
import type { DamageType, DamageInstance } from './Damage';
import type { ItemId, ItemDef, StaffBolt } from './Items';
import { getItem, isRangedWeapon, SLOT_CAPS, staffDice, WORN_SLOTS } from './Items';
import { dist, segmentCircleFirstIntersection, stepTowards, type Vec2 } from './utils';
import { findPath } from '../world/pathfind';
import {
  CONE_DEGREES,
  CLEAVE_DEGREES,
  EVASION_REACH_FRACTION,
  FIELD,
  MAGE_BODY_RADIUS,
  MELEE_RANGE,
  MOVE_RANGE,
  PICKUP_RANGE,
  RANGE_UNIT,
  SCARAB,
  SHADOW_RADIUS,
  SAND_RADIUS,
  SAND_TTL,
  SHADOW_TTL,
  TOTEM_TTL,
  VEIL,
} from '../config/constants';
import { WORDS } from './Words';
import {
  castRobe,
  clampToTethers,
  drainFed,
  drink,
  executeBonus,
  HEX_LAW_NAMES,
  hitAmplifier,
  imbueAfterStrike,
  imbueDeflects,
  imbueOnDamaged,
  imbueOnDotTick,
  imbueTurnStart,
  isHexLawKind,
  kindleBonus,
  lawAfterHit,
  lawBeforeHit,
  lawBlocksHealing,
  lawBlocksRoot,
  lawCannotReact,
  lawDotBonus,
  lawAfterDotTick,
  lawFireBurns,
  lawOnDash,
  lawOnDeath,
  lawOnRoot,
  lawOnShoved,
  lawOnTurned,
  lawOnVeilBroken,
  lawOnVeilGained,
  lawQuarantines,
  lawRoundEnd,
  lawSlam,
  lawTurnEnd,
  lawTurnStart,
  lawVeilBlocked,
  lawVeilDuration,
  lawVeilHolds,
  lightningAmplifier,
  MINIONS,
  minionStruck,
  onDeclare,
  reapBonus,
  runDeath,
  runHitEffects,
  runPulse,
  stifleDeclaration,
  applyStifle,
  type HexLawKind,
  type HitEffect,
  type LawPrep,
} from '../effects/classKit';
import { cheatDeath, deathLawEnds, deathRites, echoFetch } from '../effects/deathKit';
import { GOBLIN_HASTE, GOBLIN_HEX, GOBLIN_MEND_HP, GOBLIN_RITE_TURNS } from '../pve/goblins';
import { BARAL_SANITY_MARK, BARAL_WOUND_DASH_UNITS, DENIAL_RELOCATION_DAMAGE, DENIAL_STIFLE_MILL, denialArmed } from '../pve/baral';
import { crusadeDeath, fireCrusadeBallista } from '../pve/crusadeCombat';
import { crusadeBallistaCanFire, isCrusadeBuilding, isCrusadeKind } from '../pve/crusade';
import { applyMineEnemyTraits, type MineEnemyKind } from '../pve/minerun';
import { illusoryReap, isLillithUnit, lillithOnDeath, lillithReap, lillithStride } from '../pve/lillith';
import { clampToMoayArena, moayTargets, moayTurnStart, type MoayArena } from '../pve/moay';
import { splitModifiers } from './Words';
import { stormWordsCompatible } from './Colors';
import { makeSandCadett, makeRemnant } from './sandSummons';
import type { WordId } from './Words';
import type { ShadowZone } from './Shadow';
import type { Totem } from './Totem';
import type { Scarab } from './Scarab';
import { scarabAlive, scarabFlying } from './Scarab';
import type { BarrierBurst, BarrierZone } from './Barrier';
import { barrierContains, barrierDistance } from './Barrier';
import {
  addOrExtendStatus,
  type AuraDotStatus,
  type BindCurseAuraStatus,
  type BlindSpotStatus,
  type ControlStatus,
  type DeathCurseStatus,
  type DotStatus,
  type FireVeilAuraStatus,
  type FireStatus,
  type FaradayVeilStatus,
  type InvisibilityStatus,
  type MirrorImagesStatus,
  type PetrifyStatus,
  type ReapStatus,
  type RivetStatus,
  type SentinelFireStatus,
  type BlueflareStatus,
  type SoulRendStatus,
  type ShadowAnchorStatus,
  type AnchorSpikeStatus,
  type SealStatus,
  type StormConduitStatus,
  type LightningStormStatus,
  type MemoryShackleStatus,
  type ShadowHookStatus,
  type PhaseOutStatus,
  type ThreadMarkStatus,
  type SwornRepetitionStatus,
  type WoundShadeStatus,
  type MindFuseStatus,
  type ReactionNeedleStatus,
  type FoeBlindStatus,
  type ForgetStatus,
  type ShadowTrailStatus,
  type TetherStatus,
  type TwistRuneStatus,
  type Status,
  type TimeStopStatus,
  type DoomStatus,
  type DeathMarkStatus,
  type HexEcho,
  type SoulPactStatus,
  type ForeknownStatus,
  type StillWardStatus,
  type FrozenPerceptionStatus,
} from './Status';

/** Distance from `at` to a hazard's body — its centre, or its line if it has one. */
export function hazardDistance(zone: HazardZone, at: Vec2): number {
  if (zone.toX == null || zone.toY == null) return dist(at, { x: zone.x, y: zone.y });
  const dx = zone.toX - zone.x;
  const dy = zone.toY - zone.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0.001) return dist(at, { x: zone.x, y: zone.y });
  const t = Math.max(0, Math.min(1, ((at.x - zone.x) * dx + (at.y - zone.y) * dy) / lengthSq));
  return Math.hypot(at.x - (zone.x + dx * t), at.y - (zone.y + dy * t));
}

/**
 * Strength strike before flat bonuses: (d6 + Str/6) × (Str + 16)/32 × multiplier.
 * Unarmed is a ×1 weapon. Str 3 unarmed 1-4, Str 6 ×1.5 2-7, Str 12 ×2 5-14.
 */
export function strengthDamage(roll: number, str: number, multiplier = 1): number {
  const s = Math.max(0, str);
  return Math.round((roll + s / 6) * ((s + 16) / 32) * multiplier);
}

/** Reach of an active Edgelord dark light; it counts as a shadow zone. */const EDGELORD_DARK_LIGHT_RADIUS = 15 * RANGE_UNIT;
/** Bind Shadow Corrode: how many enemies one pool may swallow each round. */
const FEEDING_DARK_MEALS_PER_ROUND = 2;
/** Bind Shatter Curse: turns of stone before the bearer shatters. */
const PETRIFY_STAGES = 3;
const PETRIFY_SLOW_KEY = 'debuff:petrify';
const PETRIFY_ROOT_KEY = 'stun:petrify-root';
const PETRIFY_STONE_KEY = 'stun:petrify-stone';

/** Bind Shadow Corrode: a standing law that makes one team's pools hungry. */
export interface FeedingDark {
  ownerIndex: number;
  ownerTeam: number;
  roundsLeft: number;
}

/** Shadow Mind Curse: a standing law that makes one team's pools rot whoever stands in them. */
export interface RottingDark {
  ownerIndex: number;
  ownerTeam: number;
  roundsLeft: number;
}

/**
 * A board-wide escalating damage effect (Necrosis): on each round rollover every
 * living mage takes the current stage's damage, then the effect steps to the
 * next stage. Removed once all stages are spent.
 */
export interface GlobalEscalation {
  name: string;
  stages: string[];
  index: number;
  type: DamageType;
  potency: number;
}

/**
 * Hexcraft Pierce Bind: a battlefield-wide law that nails each enemy to the
 * first destination it chooses in a turn.
 */
export interface NeedlepointDomain {
  owner: number;
  roundsLeft: number;
  lastTriggeredTurnByMage: Record<number, number>;
}

/** Red Objects color ability: a permanent slowing orb that zaps movers inside it. */
export interface RedOrb {
  id: number;
  x: number;
  y: number;
  radius: number;
  ownerIndex: number;
}

export type HexcraftGlobalKind = 'mindShadow' | 'curseCorrode' | HexLawKind;

/** A timed battlefield-wide Hexcraft law affecting every team equally. */
export interface HexcraftGlobalEffect {
  kind: HexcraftGlobalKind;
  owner: number;
  roundsLeft: number;
  /** The mage who laid it, credited for anything it deals. */
  ownerIndex?: number;
  /** Round each unit (by index) last set off a once-per-round law. */
  marks?: Record<number, number>;
  /** Lightning power it was laid with (Lightning laws). */
  power?: number;
  /** How often it has turned (Turning Tide). */
  phase?: number;
  /** Where each unit (by index) stood as the round began (The Tide Remembers). */
  anchors?: Record<number, { x: number; y: number }>;
}

/** Hexcraft Veil Bind: a circle that links veiling and binding. */
export interface VeilBindZone {
  id: number;
  x: number;
  y: number;
  radius: number;
  owner: number;
  roundsLeft: number;
}

/** An item lying on the ground, droppable/retrievable as a bonus action. */
export interface DroppedItem {
  id: number;
  itemId: ItemId;
  x: number;
  y: number;
  owner: number;
}

/**
 * A Mutivarg's Rod slow-circle. Anyone who starts their turn inside is crushed
 * (start-of-turn damage) and pinned (cannot move); the wall also blocks anyone
 * trying to dash through it. Lasts a fixed number of the owner's turn-starts.
 */
export interface MutivargZone {
  id: number;
  x: number;
  y: number;
  radius: number;
  /** Mana the owner paid to raise it (drives radius, slow and crush damage). */
  manaPaid: number;
  owner: number;
  /** Remaining owner turn-starts before it collapses. */
  turnsLeft: number;
}

/** Black Dragonborn breath hazard. It slows but never blocks movement. */
export interface CorrosionPool {
  id: number;
  x: number;
  y: number;
  radius: number;
  ownerIndex: number;
  ownerTeam: number;
  roundsLeft: number;
}

/** One die the desecration rolls on every affected unit at its turn start. */
export interface DesecrationTick {
  spec: string;
  type: DamageType;
}

/**
 * Desecrate's field-wide law. It has no geometry: every affected unit on the
 * board suffers it wherever it stands. "Affected" spares black and minion units.
 */
export interface Desecration {
  id: number;
  ownerIndex: number;
  ownerTeam: number;
  roundsLeft: number;
  name: string;
  ticks: DesecrationTick[];
  /** Affected units cannot be healed by anything while this stands. */
  blocksHealing?: boolean;
  /** The owner drinks everything the ticks deal. */
  lifesteal?: boolean;
  /** Healing an affected unit would receive is handed to the owner instead. */
  redirectHealing?: boolean;
  /** Maximum health stripped from each affected unit per turn, and the total cap. */
  wither?: { perTurn: number; cap: number };
  /** Reap handed to every affected unit whenever anything at all dies. */
  reapOnDeath?: number;
  /** Health restored to every black or minion unit whenever anything dies. */
  healKinOnDeath?: number;
  /** Dice used in place of `ticks`, one set per round the law has stood; the last repeats. */
  stageTicks?: DesecrationTick[][];
  /** Rounds this law has already stood. */
  stage?: number;
  /** Every affected unit that dies while it stands rises as the owner's Remnant. */
  raiseDead?: boolean;
  /**
   * At the end of an affected unit's turn: one die per `pxPerDie` between where
   * its turn began and where it ended, at most `maxDice`. The die grows by stage.
   */
  thorns?: { pxPerDie: number; maxDice: number; sides: number[]; type: DamageType };
}

/**
 * Desecrate's anchored form: fouled ground. Same "affected" rule as the laws,
 * but bounded to a circle — several of them still reach the whole field when
 * something dies.
 */
export interface DesecrationField {
  id: number;
  x: number;
  y: number;
  radius: number;
  ownerIndex: number;
  ownerTeam: number;
  turnsLeft: number;
  name: string;
  ticks: DesecrationTick[];
  hostile?: boolean;
  heartIndex?: number;
  blocksHealing?: boolean;
  /** The owner drinks everything the ticks deal. */
  lifesteal?: boolean;
  /** Every black or minion unit anywhere heals for what the ticks dealt. */
  healKin?: boolean;
  /** A turn with nobody inside costs the field an extra turn of life. */
  withersWhenEmpty?: boolean;
  /** Growth in pixels applied at every round rollover. */
  growPerRound?: number;
  /** Extra growth whenever an affected unit dies inside, and its total cap. */
  growOnDeath?: number;
  grownByDeath?: number;
  growOnDeathCap?: number;
  /** Walking cannot carry a unit out of the circle. */
  sealed?: boolean;
  /** Affected units inside lose a bonus action and a reaction for the cycle. */
  stripsActions?: boolean;
  /** Reap handed to affected units that begin a turn inside. */
  reapPerTurn?: number;
  /** On a death inside, everything on the board is hauled this far toward it. */
  pullOnDeath?: number;
  /** Anything this close to the centre dies outright below `executeBelow` health. */
  executeRadius?: number;
  executeBelow?: number;
  /** Rot handed out inside, which then travels with its carrier. */
  rot?: { spec: string; maxStacks: number; spreadRadius: number };
  /** The field jumps to the corpse of any affected unit that dies anywhere. */
  relocateOnDeath?: boolean;
  /** Round stamp of the last relocation, so it moves at most once per round. */
  relocatedRound?: number;
  /** Distance (px) it crawls toward the nearest affected unit at every round rollover. */
  crawl?: number;
  /** Dealt to affected units still inside when the field runs out. */
  collapse?: { spec: string; type: DamageType };
  /** Index of the unit the field rides on; it stays where the carrier falls. */
  carrierIndex?: number;
  /** An affected unit that dies inside bursts over affected units around its corpse. */
  burstOnDeath?: { spec: string; type: DamageType; radius: number };
}

/**
 * An indiscriminate standing hazard (Bind Veil Corrode's mist, Shadow Corrode
 * Curse's death zone). Everything inside is affected, allies and caster too.
 */
export interface HazardZone {
  id: number;
  x: number;
  y: number;
  /** Far end of a line-shaped hazard. Absent for an ordinary circular one. */
  toX?: number;
  toY?: number;
  radius: number;
  ownerIndex: number;
  ownerTeam: number;
  roundsLeft: number;
  /** Zones sharing a group are one merged field and only ever tick once. */
  groupId?: number;
  name: string;
  /** Dice rolled on successive rounds; the last entry repeats once exhausted. */
  damageSpecs: string[];
  /** How many rounds of `damageSpecs` have already been spent. */
  escalateIndex: number;
  damageType: DamageType;
  /** Only bite units that actually moved during the turn that just ended. */
  movedOnly?: boolean;
  carrierIndex?: number;
  untilTurn?: number;
  crossOnly?: boolean;
  foesOnly?: boolean;
  hex?: Omit<HexGroundSpec, 'drift'> & { side?: HexSide; text: string; hexEcho?: HexEcho };
  /** Chance (0-1) that a targeted attack on anyone inside simply misses. */
  dodgeChance?: number;
  /** Multiplier applied to healing received inside the zone. */
  healMult?: number;
  /** Carries whoever it bites `px`: toward its centre, or out of it. */
  drift?: { px: number; inward: boolean };
  color: number;
}

/**
 * A pile of loose sand. Unowned terrain: whoever stands on it may use it.
 * `charges` is the spendable currency Sand spells are priced in — piles do not
 * expire, they are spent.
 */
export interface SandPatch {
  id: number;
  x: number;
  y: number;
  radius: number;
  charges: number;
}

/**
 * The pure (Phaser-free) game model: two mages, whose turn it is, the round
 * counter, the reaction stack, dice and a rolling log. The Phaser scene drives
 * the flow (prompts, animation) and calls into this for all rules.
 */
export class GameState {
  mages: Mage[];
  onMageDefeated?: (target: Mage, source: Mage) => void;
  spawnMineCreature?: (kind: MineEnemyKind, level: number, at: Vec2) => Mage;
  currentIndex = 0;
  round = 1;
  stack: StackItem[] = [];
  rng: Dice;

  /**
   * Initiative turn order: mage indices sorted by their start-of-match roll
   * (d20 + Dex, highest first). `turnPtr` walks this list; the round advances
   * when it wraps back to the top.
   */
  initiativeOrder: number[] = [];
  private turnPtr = 0;

  /**
   * The next `count` mages to act, current first, walking the initiative order
   * and skipping the fallen. Summons never appear: they act on their owner's turn.
   */
  upcomingTurns(count: number): Mage[] {
    const n = this.initiativeOrder.length;
    if (n === 0) return [];
    const out: Mage[] = [];
    for (let step = 0; step < n && out.length < count; step++) {
      const m = this.mages[this.initiativeOrder[(this.turnPtr + step) % n]];
      if (m?.alive && !m.isSummon) out.push(m);
    }
    return out;
  }
  /** The initiative roll each mage made (for display / logging). */
  initiativeRolls: number[] = [];
  /** Bind Shadow Corrode: teams whose shadow pools are currently feeding. */
  feedingDarks: FeedingDark[] = [];
  /** Shadow Mind Curse: teams whose shadow pools currently rot what stands in them. */
  rottingDarks: RottingDark[] = [];
  /** Standing indiscriminate hazards (Bind Veil Corrode, Shadow Corrode Curse). */
  hazardZones: HazardZone[] = [];
  /** Desecrate's field-wide laws. */
  desecrations: Desecration[] = [];
  /** Desecrate's fouled ground. */
  desecrationFields: DesecrationField[] = [];
  /** Bind Curse Pierce: pierce damage waiting to be dealt again at its dealer's turn end. */
  private pierceEchoes: { sourceIndex: number; targetIndex: number; amount: number }[] = [];
  /** Guard so a replayed pierce echo can never queue another echo. */
  private pierceEchoFlushing = false;
  /** Guard so a threaded echo can never re-enter and chain into itself. */
  private threadEchoing = false;
  /** Guard so a storm arc can never re-enter and chain into itself. */
  private stormArcing = false;
  private previousConsistentRolls = false;

  /**
   * Set true for the duration of a single spell resolution when that spell's
   * success check rolled a natural 20 — a critical. The scene toggles it around
   * {@link effectContext} so the effect helpers double damage / area / duration.
   */
  critThisCast = false;
  /** Kept natural d20 for the spell currently resolving. */
  spellRollThisCast = 0;
  /** Modifier potency (Subtle 0.8, Channel 1.5) for the cast resolving now. */
  castPotency = 1;
  /** A silent cast: it draws no reactions and never reveals a veiled caster. */
  castSilent = false;
  /** Presentation-only: the spell being resolved, so impact feedback can weight it. */
  resolvingSpell: Spell | null = null;
  /** Who is casting the word spell resolving now: their held staffs shape its hits (more damage, a hex, a light share). */
  castThroughCaster: Mage | null = null;
  /** The stack item the resolving reaction just countered (Veil Mind Shatter steals it). */
  counteredItem: StackItem | null = null;
  /** Nesting depth of law-made hits; a law's own hits never set off another law. */
  hexLawDepth = 0;
  /** What the intrinsic strike that is calling its rider just dealt. */
  lastIntrinsicDamage = 0;
  lillithOutput = new Map<Mage, number>();
  moayArena?: MoayArena;
  /** Guard so a soul pact's repayment can never demand repayment of its own. */
  private soulPactEchoing = false;
  /** Corpses already walked upright, so no body rises twice. */
  private raisedCorpses = new Set<Mage>();
  /** Guard so a rivet drag can never drag its dragger back. */
  private rivetDragging = false;

  /** Active shadow zones placed by the Shadow word. */
  shadows: ShadowZone[] = [];
  redOrbs: RedOrb[] = [];

  /** Active totems placed by the Corrode+Curse combo. */
  totems: Totem[] = [];

  /** Active scarab summons placed by the Curse+Drain+Corrode combo. */
  scarabs: Scarab[] = [];

  /** Active reality-break wedges placed by Reality+Shatter (block all movement). */
  barriers: BarrierZone[] = [];

  /** Board-wide escalating damage effects (Necrosis). */
  globalEscalations: GlobalEscalation[] = [];

  /** Active battlefield-wide Pierce Bind domains. */
  needlepointDomains: NeedlepointDomain[] = [];

  /** Timed global Hexcraft laws (Mind Shadow / Curse Corrode). */
  hexcraftGlobals: HexcraftGlobalEffect[] = [];

  /** Loose sand on the field. GEN's Sand spells need it and leave more of it. */
  sand: SandPatch[] = [];

  /** Whole-arena sand: the desert kingdom's home advantage made literal. */
  desertArena = false;

  /** Persistent Veil Bind linking circles. */
  veilBindZones: VeilBindZone[] = [];

  /** Items dropped on the ground, awaiting pickup by their owner. */
  droppedItems: DroppedItem[] = [];

  /** Active Mutivarg's Rod slow-circles. */
  mutivargZones: MutivargZone[] = [];

  /** Active Black Dragonborn corrosion pools (one per owner). */
  corrosionPools: CorrosionPool[] = [];

  /** Alive summon (scarab) count per team at last regen, to score deaths since. */
  private prevScarabAlive: Record<number, number> = {};

  /** Mages queued for an extra turn (Shatter+Mind+Reality), taken in order. */
  extraTurnQueue: Mage[] = [];

  /** Oni reveal immediately; this queues only their separately-stiflicable turn end. */
  private oniTurnEndPending?: { player: Mage; oni: Mage };
  private oniForcedTurnEndFor?: Mage;

  /** Turns of control swap remaining (Reality+Mind). 0 = normal control. */
  mindSwapTurns = 0;
  /** Pending control swap to activate once the caster's turn ends. */
  pendingMindSwap = 0;

  /** Monotonic turn counter, bumped each time a mage begins a turn. */
  turnSeq = 0;

  logLines: string[] = [];
  onLog?: (line: string) => void;

  /** Visual bridge injected by the scene; passed into every effect context. */
  vfxSink?: VfxSink | null;
  /** Bridge for interactive sub-targeting during spell resolution (scene-supplied). */
  subTargeter?: SubTargeter | null;

  /**
   * Roll and announce it. Attacks that resolve inside GameState never pass
   * through `effects.rollDice`, so without this they would land with no dice.
   */
  showRoll(spec: string, label: string, target?: Mage): RollResult {
    const result = this.rng.roll(spec);
    this.vfxSink?.diceRoll(spec, result.total, result.rolls, label, target);
    return result;
  }

  /** Roll a d20 check and apply the acting mage's face transformation. */
  rollD20(roller?: Mage): number {
    const face = this.rng.roll('1d20').total;
    return roller?.gambledD20(face) ?? face;
  }

  private nextId = 1;

  constructor(mages: Mage[], seed?: number) {
    this.mages = mages;
    this.rng = new Dice(seed);
    this.rollInitiative();
  }

  /**
   * Roll each mage's initiative (d20 + Dex) once at the start of the match and
   * derive the turn order (highest first). Ties break by the shared RNG so both
   * peers agree. This runs on the seeded RNG, keeping every client in lockstep.
   */
  private rollInitiative(): void {
    const scored = this.mages.flatMap((m, i) => {
      if (m.isSummon || m.inert) return [];
      const roll = this.rollD20(m);
      const total = roll + m.effectiveDex();
      const priority = Math.max(m.profile.redPrimaryTier ? 1 : 0, m.intrinsicInitiativePriority);
      const sloth = m.swamprunCurse === 'sloth' ? 1 : 0;
      return [{ i, total, priority, sloth, tie: this.rng.roll('1d1000').total }];
    });
    scored.sort(
      (a, b) => Number(this.mages[a.i].initiativeLast) - Number(this.mages[b.i].initiativeLast) ||
        a.sloth - b.sloth || b.priority - a.priority || b.total - a.total || b.tie - a.tie
    );
    this.initiativeOrder = scored.map((s) => s.i);
    this.initiativeRolls = this.mages.map(() => 0);
    for (const s of scored) this.initiativeRolls[s.i] = s.total;
    this.turnPtr = 0;
    this.currentIndex = this.initiativeOrder[0] ?? 0;
  }

  /**
   * Add a combatant mid-match (Swamprun wave spawns). The newcomer is appended
   * to the tail of the initiative order, so it acts later this round (or next
   * round if the order has already wrapped past it).
   */
  addMage(m: Mage): void {
    this.mages.push(m);
    const idx = this.mages.length - 1;
    // Objects on the field take no turns.
    if (m.inert) {
      this.initiativeRolls[idx] = 0;
      return;
    }
    const last = m.initiativeLast ? -1 : this.initiativeOrder.findIndex((index) => this.mages[index].initiativeLast);
    if (last < 0) this.initiativeOrder.push(idx);
    else {
      this.initiativeOrder.splice(last, 0, idx);
      if (last <= this.turnPtr) this.turnPtr += 1;
    }
    const roll = this.rollD20(m);
    this.initiativeRolls[idx] = roll + m.effectiveDex();
  }

  /**
   * Adopt a turn order wholesale instead of rolling one (loading a saved
   * scenario). Indices outside the roster are dropped and the pointer is parked
   * on `currentIndex` so play resumes exactly where the snapshot left off.
   */
  restoreTurnOrder(order: number[], rolls: number[], currentIndex: number): void {
    const valid = order.filter((i) => i >= 0 && i < this.mages.length);
    this.initiativeOrder = valid.length > 0 ? valid : this.mages.map((_, i) => i);
    this.initiativeRolls = this.mages.map((_, i) => rolls[i] ?? 0);
    const ptr = this.initiativeOrder.indexOf(currentIndex);
    this.turnPtr = ptr >= 0 ? ptr : 0;
    this.currentIndex = this.initiativeOrder[this.turnPtr] ?? 0;
  }

  /** Roll initiative afresh for everyone present (after an ambush's free opening blow). */
  rerollInitiative(): void {
    this.rollInitiative();
  }

  /** Replace the scarab swarm with a saved one, issuing fresh object ids. */
  restoreScarabs(swarm: Omit<Scarab, 'id'>[]): void {
    this.scarabs = swarm.map((s) => ({ ...s, id: this.nextId++ }));
  }

  /** Reset turn/field state and roll initiative for a newly assembled combat roster. */
  startNewCombat(options: { preserveScarabs?: boolean } = {}): void {
    const scarabs = options.preserveScarabs ? this.scarabs.filter(scarabAlive) : [];
    this.clearFieldObjects();
    this.scarabs = scarabs;
    this.round = 1;
    this.turnSeq = 0;
    this.critThisCast = false;
    this.spellRollThisCast = 0;
    this.castPotency = 1;
    this.castSilent = false;
    this.resolvingSpell = null;
    this.castThroughCaster = null;
    this.prevScarabAlive = {};
    this.oniTurnEndPending = undefined;
    this.oniForcedTurnEndFor = undefined;
    this.rollInitiative();
    this.startRound();
  }

  /**
   * Add a Life-class summon controlled by `owner`. Unlike {@link addMage} the
   * summon is NOT inserted into the initiative order (it never takes an
   * autonomous turn) and is excluded from victory / defeat bookkeeping. Its
   * owner drives it with the Command bonus action. Returns the summon.
   */
  spawnSummon(m: Mage, owner: Mage, kind: string): Mage {
    m.isSummon = true;
    m.summonKind = kind;
    m.team = owner.team;
    m.summonOwnerIndex = this.mages.indexOf(owner);
    m.summonMoveMultiplier = owner.redSummonHaste ? 2 : 1;
    this.mages.push(m);
    this.initiativeRolls[this.mages.length - 1] = 0;
    this.vfxSink?.summonPuff?.(m.pos, Math.max(42, m.bodyRadius() * 3.2));
    return m;
  }

  /** Living summons owned by `owner`. */
  summonsOf(owner: Mage): Mage[] {
    const idx = this.mages.indexOf(owner);
    return this.mages.filter((s) => s.isSummon && s.alive && s.summonOwnerIndex === idx);
  }

  canCarrySummon(owner: Mage, summon: Mage): boolean {
    return owner.alive && summon.alive && summon.summonShoulder == null &&
      this.summonsOf(owner).includes(summon) &&
      dist(owner.pos, summon.pos) <= MELEE_RANGE + summon.bodyRadius() &&
      this.summonsOf(owner).filter((unit) => unit.summonShoulder != null).length < 2;
  }

  carrySummon(owner: Mage, summon: Mage): boolean {
    if (!this.canCarrySummon(owner, summon)) return false;
    const used = new Set(this.summonsOf(owner).map((unit) => unit.summonShoulder));
    summon.summonShoulder = used.has(0) ? 1 : 0;
    summon.x = owner.x;
    summon.y = owner.y;
    return true;
  }

  releaseSummon(owner: Mage, summon: Mage): boolean {
    if (!this.summonsOf(owner).includes(summon) || summon.summonShoulder == null) return false;
    const landing = this.nearestFreePosition(summon, owner.pos);
    if (dist(landing, owner.pos) < owner.bodyRadius() + summon.bodyRadius()) return false;
    summon.summonShoulder = undefined;
    summon.x = landing.x;
    summon.y = landing.y;
    return true;
  }

  syncCarriedSummons(): void {
    for (const summon of this.mages) {
      if (!summon.alive || summon.summonShoulder == null) continue;
      const owner = this.mages[summon.summonOwnerIndex ?? -1];
      if (!owner?.alive) {
        summon.summonShoulder = undefined;
        continue;
      }
      summon.x = owner.x;
      summon.y = owner.y;
    }
  }

  /**
   * Whether `owner` may still give `summon` orders. The Silencing Spike never
   * takes any, and Remnants stop listening while their raiser is below 3 mana —
   * they stay allied, they simply cannot be driven.
   */
  canCommandSummon(owner: Mage, summon: Mage): boolean {
    if (summon.summonShoulder != null) return false;
    if (summon.summonKind === 'silencing-spike') return false;
    if (summon.summonKind === 'remnant' && owner.mana < 3) return false;
    return true;
  }

  beginMindStormAction(actor: Mage): void {
    this.previousConsistentRolls = this.rng.consistentRolls;
    if (actor.alive && actor.statuses.some((status) => status.key === 'mind-storm-foreseen')) {
      this.rng.consistentRolls = true;
    }
  }

  endMindStormAction(): void {
    this.rng.consistentRolls = this.previousConsistentRolls;
  }

  /** Remove every Mage summon and Scarab at an explicit dismissal boundary. */
  clearSummonedUnits(): { mageSummons: number; scarabs: number } {
    const mageSummons = this.mages.filter((mage) => mage.isSummon && mage.alive).length;
    const scarabs = this.scarabs.filter(scarabAlive).length;
    this.mages = this.mages.filter((mage) => !mage.isSummon);
    this.scarabs = [];
    return { mageSummons, scarabs };
  }

  // ---- Accessors ------------------------------------------------------------

  get current(): Mage {
    return this.mages[this.currentIndex];
  }

  get other(): Mage {
    return this.opponentOf(this.current);
  }

  /** Every mage that is not on `m`'s team (alive or dead), excluding `m`. */
  enemiesOf(m: Mage): Mage[] {
    return this.mages.filter((o) => o !== m && o.team !== m.team);
  }

  /** Living enemies of `m`. The party's side leaves a scene's prey alone. */
  livingEnemiesOf(m: Mage): Mage[] {
    return this.enemiesOf(m).filter((o) => o.alive && !(o.sceneSide === 'prey' && m.team === 1));
  }

  /** Team-mates of `m` (same team), excluding `m` itself. */
  alliesOf(m: Mage): Mage[] {
    return this.mages.filter((o) => o !== m && o.team === m.team);
  }

  /**
   * The single "primary" opponent of `m` — the nearest living enemy, falling
   * back to any enemy, then any other mage. Keeps 1v1-era call sites working
   * while multi-target logic is layered on top.
   */
  opponentOf(m: Mage): Mage {
    const living = this.livingEnemiesOf(m);
    const pool = living.length > 0 ? living : this.enemiesOf(m);
    if (pool.length === 0) return this.mages.find((o) => o !== m) ?? m;
    let best = pool[0];
    let bestD = dist(m.pos, best.pos);
    for (const o of pool) {
      const d = dist(m.pos, o.pos);
      if (d < bestD) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  /** Distinct teams that still have at least one living mage. */
  teamsAlive(): number[] {
    const teams = new Set<number>();
    for (const m of this.mages) {
      if ((m.alive || (m.edgelordCapturedBy && m.vitalsAlive)) && !m.isSummon) teams.add(m.team);
    }
    return [...teams];
  }

  /** Whether a living Lich is on the field (its thralls then play optimally). */
  hasAliveLich(): boolean {
    return this.mages.some((m) => m.alive && m.enemyKind === 'lich');
  }

  /** The living Lich commanding a given mage's team, if any. */
  commandingLich(m: Mage): Mage | undefined {
    return this.mages.find((o) => o.alive && o.team === m.team && o.enemyKind === 'lich');
  }

  /** Reveal every hostile Oni behind the player making the first damage attempt. */
  triggerOniAmbush(player: Mage, target: Mage): boolean {
    if (!player.alive || player.team === target.team) return false;
    const onis = this.mages.filter(
      (mage) => mage.alive && mage.oniKind && mage.oniHidden && mage.team === target.team
    );
    if (onis.length === 0) return false;
    const awayAngle = Math.atan2(player.y - target.y, player.x - target.x);
    onis.forEach((oni, index) => {
      oni.oniHidden = false;
      const offset = (index - (onis.length - 1) / 2) * 0.42;
      const distance = player.bodyRadius() + oni.bodyRadius() + 18;
      const from = oni.pos;
      oni.x = Math.min(
        FIELD.x + FIELD.w,
        Math.max(FIELD.x, player.x + Math.cos(awayAngle + offset) * distance)
      );
      oni.y = Math.min(
        FIELD.y + FIELD.h,
        Math.max(FIELD.y, player.y + Math.sin(awayAngle + offset) * distance)
      );
      this.notifyMageRelocation(oni, from, oni.pos, false);
    });
    this.oniTurnEndPending = { player, oni: onis[0] };
    this.log(`${onis.length} Oni appear behind ${player.name}!`);
    return true;
  }

  takeOniTurnEndTrigger(): { player: Mage; oni: Mage } | undefined {
    const pending = this.oniTurnEndPending;
    this.oniTurnEndPending = undefined;
    return pending;
  }

  resolveOniTurnEnd(player: Mage): void {
    if (this.current !== player) return;
    this.stack = this.stack.filter((item) => item.source !== player);
    this.oniForcedTurnEndFor = player;
    this.log(`The Oni ambush cuts ${player.name}'s turn short.`);
  }

  takeOniForcedTurnEnd(): Mage | undefined {
    const player = this.oniForcedTurnEndFor;
    this.oniForcedTurnEndFor = undefined;
    return player;
  }

  /**
   * The Lich's end-step, taken only on turns where it did not move. Rolls a d6:
   *   1 — afflict the target player with a weak damage-over-time.
   *   2 — Link the target player: damage they take heals the Lich.
   *   3 — request a zombie be summoned within 5cm of the Lich.
   *   4-6 — nothing happens.
   * Applies the DoT / Link internally (deterministic sim) and returns a summon
   * point for case 3 so the scene can spawn the creature. Returns the rolled
   * value plus an optional `summonAt` point.
   */
  lichEndStep(lich: Mage): { roll: number; summonAt?: Vec2 } {
    const roll = this.rng.die(6);
    const target = this.opponentOf(lich);
    if (roll === 1) {
      if (target && target.alive) {
        const ctx = this.effectContext(lich, target, null);
        applyDot(ctx, target, {
          name: 'Grave Rot',
          duration: 3,
          damage: dmg(2, 'shadow'),
          damageSpec: '1d3',
        });
      }
      return { roll };
    }
    if (roll === 2) {
      if (target && target.alive) {
        target.drainLinkTo = lich;
        target.drainLinkTurns = 3;
        this.log(`${lich.name} links to ${target.name}. It heals from damage dealt to them.`);
      }
      return { roll };
    }
    if (roll === 3) {
      // Pick a point within 5cm of the Lich for the summoned zombie.
      const R = 5 * RANGE_UNIT;
      const ang = this.rng.float() * Math.PI * 2;
      const rad = R * Math.sqrt(this.rng.float());
      const summonAt: Vec2 = {
        x: lich.pos.x + Math.cos(ang) * rad,
        y: lich.pos.y + Math.sin(ang) * rad,
      };
      this.log(`${lich.name} summons a zombie.`);
      return { roll, summonAt };
    }
    return { roll };
  }

  // ---- GHAST -----------------------------------------------------------------

  /** Mark a delayed shadow zone that erupts at the start of the Ghast's next turn. */
  markGhastZone(ghast: Mage, at: Vec2, radius: number): void {
    ghast.ghastPendingZone = { x: at.x, y: at.y, radius };
    this.log(`${ghast.name} marks the ground. It erupts on its next turn.`);
  }

  /** Resolve a Ghast's pending zone: 2d3 shadow to every foe caught within it. */
  resolveGhastZone(ghast: Mage): void {
    const zone = ghast.ghastPendingZone;
    if (!zone) return;
    ghast.ghastPendingZone = undefined;
    const foes = this.livingEnemiesOf(ghast).filter(
      (f) => dist(f.pos, { x: zone.x, y: zone.y }) <= zone.radius
    );
    if (foes.length === 0) {
      this.log(`${ghast.name}'s shadow-mark erupts over empty ground.`);
      return;
    }
    for (const f of foes) {
      const ctx = this.effectContext(ghast, f, null);
      dealDamage(ctx, f, dmg(rollDice(ctx, '2d3', 'Ghast Mark'), 'shadow'), {
        aoe: true,
        canMiss: false,
      });
    }
  }

  /** Ghast shove: 1d3 shadow damage and knock the target 1d6 range-units away. */
  ghastShove(ghast: Mage, target: Mage): void {
    const ctx = this.effectContext(ghast, target, null);
    dealDamage(ctx, target, dmg(rollDice(ctx, '1d3', 'Ghast Shove'), 'shadow'), {
      canMiss: false,
    });
    if (!target.alive) return;
    const units = rollDice(ctx, '1d6', 'Ghast Shove');
    this.log(`${ghast.name} hurls ${target.name} back with a wave of force!`);
    this.knockbackMage(ghast, target, units);
  }

  // ---- REAPER ----------------------------------------------------------------

  /**
   * How far (px) `m` is currently allowed to increase its distance from any
   * living enemy Reaper. Marked prey may not flee at all; unmarked prey may only
   * open the gap by 6cm per turn. Moving *toward* the Reaper is always allowed.
   * Returns the destination clamped onto the tightest such ring.
   */
  private clampToReaperLeash(m: Mage, from: Vec2, dest: Vec2): Vec2 {
    const reapers = this.mages.filter((r) => r.reaperKind && r.alive && r.team !== m.team);
    if (reapers.length === 0) return dest;
    let d = dest;
    for (const r of reapers) {
      const cur = dist(from, r.pos);
      const next = dist(d, r.pos);
      if (next <= cur) continue; // moving toward (or staying) — always allowed
      const marked = m.reaperMarkedBy === r;
      const maxAway = marked ? cur : cur + 6 * RANGE_UNIT;
      if (next > maxAway) {
        const dx = d.x - r.pos.x;
        const dy = d.y - r.pos.y;
        const len = Math.hypot(dx, dy) || 1;
        d = { x: r.pos.x + (dx / len) * maxAway, y: r.pos.y + (dy / len) * maxAway };
      }
    }
    return d;
  }

  /** Reaper's touch: mark a foe (no damage, unpreventable). It can no longer flee. */
  reaperMark(reaper: Mage, target: Mage): void {
    if (!target.alive || target.reaperMarkedBy === reaper) return;
    target.reaperMarkedBy = reaper;
    this.log(`${reaper.name} marks ${target.name}. They cannot flee it.`);
  }

  /** Begin (or continue) the Reaper's channel; the clap resolves on its next turn. */
  reaperBeginChannel(reaper: Mage): void {
    reaper.reaperChanneling = true;
    this.log(`${reaper.name} raises its hands and begins to channel a final clap...`);
  }

  /**
   * Resolve a channeling Reaper's clap at the start of its turn: every foe it
   * marked is removed from the field (no damage). Killing the Reaper restores
   * them, so a lone victim is doomed but a surviving ally can bring them back.
   */
  reaperResolveClap(reaper: Mage): void {
    if (!reaper.reaperChanneling) return;
    reaper.reaperChanneling = false;
    const marked = this.mages.filter((m) => m.reaperMarkedBy === reaper && !m.reaperDeletedBy);
    if (marked.length === 0) {
      this.log(`${reaper.name} releases its channel. No marks remain.`);
      return;
    }
    for (const m of marked) m.reaperDeletedBy = reaper;
    this.log(
      `${reaper.name} CLAPS — ${marked.map((m) => m.name).join(', ')} ${
        marked.length === 1 ? 'is' : 'are'
      } wiped from existence!`
    );
  }

  // ---- DEATHKNIGHT ----------------------------------------------------------

  /** Build the Deathknight's first-target reaction for this turn cycle. */
  makeDeathknightTargetReaction(
    knight: Mage,
    attacker: Mage,
    threatenedItemId: number,
    isAoe: boolean
  ): StackItem | null {
    if (
      !knight.deathknightKind ||
      !knight.alive ||
      !attacker.alive ||
      knight.team === attacker.team ||
      knight === this.current ||
      knight.deathknightReactionRound === this.round
    ) return null;
    knight.deathknightReactionRound = this.round;
    const close = dist(knight.pos, attacker.pos) <= 10 * RANGE_UNIT;
    const item = this.makeActionItem({
      source: knight,
      target: attacker,
      label: 'Deathknight Counter',
      description: close
        ? `${knight.name} dodges and answers ${attacker.name} with its spear.`
        : `${knight.name} pulls ${attacker.name} into spear range.`,
      isStillValid: () => knight.alive && attacker.alive,
      resolve: (game) => {
        if (close) {
          const angle = game.rng.float() * Math.PI * 2;
          const origin = knight.pos;
          const raw = {
            x: knight.x + Math.cos(angle) * 5 * RANGE_UNIT,
            y: knight.y + Math.sin(angle) * 5 * RANGE_UNIT,
          };
          const fieldDest = {
            x: Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, raw.x)),
            y: Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, raw.y)),
          };
          const barrier = game.clampToBarriers(origin, fieldDest);
          const mutivarg = game.clampToMutivargZones(knight, origin, barrier.dest);
          const destination = game.nearestFreePosition(knight, game.clampToMages(knight, origin, mutivarg.dest), origin, true);
          knight.x = destination.x;
          knight.y = destination.y;
          game.notifyMageRelocation(knight, origin, destination, true);
          if (!isAoe) game.removeStackItem(threatenedItemId);
          game.log(
            `${knight.name} dodges 5cm${isAoe ? ', but the area attack still follows' : ' and evades the attack'}.`
          );
        } else {
          const origin = attacker.pos;
          const dx = attacker.x - knight.x;
          const dy = attacker.y - knight.y;
          const length = Math.hypot(dx, dy) || 1;
          const spacing = knight.bodyRadius() + attacker.bodyRadius() + 12;
          const landing = game.nearestFreePosition(attacker, {
            x: Math.min(
              FIELD.x + FIELD.w,
              Math.max(FIELD.x, knight.x + (dx / length) * spacing)
            ),
            y: Math.min(
              FIELD.y + FIELD.h,
              Math.max(FIELD.y, knight.y + (dy / length) * spacing)
            ),
          });
          attacker.x = landing.x;
          attacker.y = landing.y;
          game.notifyMageRelocation(attacker, origin, attacker.pos, false);
          game.log(`${knight.name} drags ${attacker.name} directly in front of its spear.`);
        }
        if (knight.alive && attacker.alive) game.pushStack(game.makeMeleeItem(knight, attacker));
      },
    });
    item.noPhysicalReaction = true;
    return item;
  }

  /** Always resolve one of six random Conjure effects at the Deathknight's end step. */
  deathknightConjure(knight: Mage): number {
    const roll = this.rng.die(6);
    const foes = this.livingEnemiesOf(knight);
    if (roll === 1) {
      for (const foe of foes) {
        if (dist(knight.pos, foe.pos) > 5 * RANGE_UNIT) continue;
        const amount = this.rng.roll('1d10').total;
        dealDamage(this.effectContext(knight, foe, null), foe, dmg(amount, 'typeless'), {
          canMiss: false,
          aoe: true,
          trueDamage: true,
        });
      }
      this.log(`${knight.name} conjures a 5cm nova of true death.`);
    } else if (roll === 2) {
      for (const foe of knight.deathknightHitThisTurn) {
        if (foe.alive) applyStun(this.effectContext(knight, foe, null), foe, { duration: 2, type: 'full' });
      }
      this.log(`${knight.name} locks every foe it struck in grave-stillness.`);
    } else if (roll === 3) {
      const before = knight.hp;
      knight.hp = Math.min(knight.maxHp, knight.hp + 20);
      this.log(`${knight.name} conjures stolen vitality and heals ${knight.hp - before}.`);
    } else if (roll === 4) {
      for (const foe of foes) {
        if (dist(knight.pos, foe.pos) > 8 * RANGE_UNIT) continue;
        applyDot(this.effectContext(knight, foe, null), foe, {
          name: 'Death Acid',
          duration: 3,
          damage: dmg(1, 'corrosive'),
          damageSpec: '1d4',
        });
      }
      this.log(`${knight.name} conjures an acid storm.`);
    } else if (roll === 5) {
      for (const foe of foes) {
        if (dist(knight.pos, foe.pos) > 10 * RANGE_UNIT) continue;
        const amount = this.rng.roll('1d6').total;
        dealDamage(this.effectContext(knight, foe, null), foe, dmg(amount, 'sanity'), {
          canMiss: false,
          aoe: true,
        });
      }
      this.log(`${knight.name} conjures a wave of soul-hunger.`);
    } else {
      for (const foe of foes) {
        if (dist(knight.pos, foe.pos) > 10 * RANGE_UNIT) continue;
        const amount = this.rng.roll('1d6').total;
        dealDamage(this.effectContext(knight, foe, null), foe, dmg(amount, 'corrosive'), {
          canMiss: false,
          aoe: true,
        });
      }
      this.log(`${knight.name} conjures a tide of grave-corrosion.`);
    }
    return roll;
  }

  /**
   * Restore every mage a now-dead Reaper had deleted (and clear stale marks).
   * Call after damage resolves; returns the mages brought back.
   */
  restoreReaperDeletions(): Mage[] {
    const restored: Mage[] = [];
    for (const m of this.mages) {
      const by = m.reaperDeletedBy;
      if (by && !by.alive) {
        m.reaperDeletedBy = undefined;
        m.reaperMarkedBy = undefined;
        restored.push(m);
      }
      // A dead Reaper also releases any mark it still held on the living.
      if (m.reaperMarkedBy && !m.reaperMarkedBy.alive) m.reaperMarkedBy = undefined;
    }
    for (const m of restored) {
      this.log(`${m.name} is torn back into the world as the Reaper falls!`);
    }
    return restored;
  }

  log(msg: string): void {
    this.logLines.push(msg);
    if (this.logLines.length > 200) this.logLines.shift();
    this.onLog?.(msg);
  }

  /** The winning team number once the match is over, else null. */
  get winningTeam(): number | null {
    const teams = this.teamsAlive();
    return teams.length === 1 ? teams[0] : null;
  }

  /** A living representative of the winning team (for display), else null. */
  get winner(): Mage | null {
    const team = this.winningTeam;
    if (team == null) return null;
    return this.mages.find((m) => m.alive && m.team === team) ?? null;
  }

  /**
   * In co-op survival (swamprun) the run ends only when this team is wiped out —
   * never when the opposing wave is merely cleared. Null for ordinary duels.
   */
  coopSurvivalTeam: number | null = null;

  /**
   * Sandbox switch: while set, no roster can win. The Scenario Lab needs it so
   * a half-built fight (often a lone mage) is not declared over on turn one.
   */
  victorySuspended = false;

  get isOver(): boolean {
    if (this.victorySuspended) return false;
    // Co-op survival: the run is lost only once every party member has fallen.
    // Clearing a wave (no foes left) is NOT a game over — the next wave spawns.
    if (this.coopSurvivalTeam != null) {
      return !this.mages.some(
        (m) =>
          (m.alive || (m.edgelordCapturedBy && m.vitalsAlive)) &&
          !m.isSummon &&
          m.sceneSide !== 'escort' &&
          m.team === this.coopSurvivalTeam
      );
    }
    return this.teamsAlive().length <= 1;
  }

  // ---- Turn lifecycle -------------------------------------------------------

  /** Reset reactions for both mages at the start of a new round. */
  startRound(): void {
    for (const m of this.mages) {
      m.reactionAvailable = m.canEverReact;
      m.reactedThisCycle = false;
      // Per-round-cycle reset of the Reaper's per-source damage accounting.
      if (m.damageBySourceThisCycle.size > 0) m.damageBySourceThisCycle.clear();
      if (m.alive && m.enemyKind === 'crusadeCamp' && m.inert) {
        this.applyFireDamage(m);
        if (m.alive) this.applyDotDamage(m);
        for (const line of m.tickStatuses()) this.log(line);
      }
    }
  }

  beginTurn(): void {
    const m = this.current;
    if (isLillithUnit(m)) lillithStride(this, m);
    if (m.baral?.vanished) {
      m.baral.vanished = false;
      this.log(`${m.name} steps back into sight.`);
    }
    this.turnSeq += 1;
    m.turnStartState = { x: m.x, y: m.y, hp: m.hp, sanity: m.sanity };
    this.releaseOrphanedTimeStops();
    this.refreshSandFooting();
    // Keep latched scarabs glued to whoever they bit before anything else runs.
    this.updateAttachedScarabs();
    // Frozen in time: nothing happens to it at all, not even ageing.
    if (this.skipFrozenTurn(m)) return;
    // A phased mage does not exist: nothing reaches it and it may only walk.
    if (this.isPhasedOut(m)) {
      this.tickPhaseOut(m);
      // Phasing in skips upkeep entirely — no DoT ticks, no costs — but every
      // status still ages, so nothing is prolonged by hiding in the dark.
      for (const line of m.tickStatuses()) this.log(line);
      m.beginTurn();
      if (this.isPhasedOut(m)) {
        m.actions.main = 0;
        m.actions.bonus = 0;
      }
      return;
    }
    this.applyTwistRunes(m);
    this.applyShadowAnchors(m);
    this.applyShadowHooks(m);
    this.applyAnchorSpikes(m);
    this.applySeals(m);
    this.applyHazardZones(m);
    this.applyDesecrations(m);
    this.applyDesecrationFields(m);
    lawTurnStart(this, m);
    this.applyFeedingDarks(m);
    this.applyRottingDarks(m);
    this.applyWoundShades(m);
    this.applyFoeBlind(m);
    // Ground hazards and shadow-curse auras strike before the mage's own turn.
    this.applyTotemAuras(m);
    this.applyOwnedSummonAuras(m);
    this.applyMinionPulses(m);
    this.applySandSummonUpkeep(m);
    this.applyAuraDots(m);
    this.applyBindCurseAuras(m);
    this.applyLightAuras(m);
    this.applyFireVeilAuras(m);
    this.applyLightningStorm(m);
    this.applyFireDamage(m);
    this.applySentinelFireDamage(m);
    this.pulseDeathsAngelWings(m);
    this.applyBlueflareDamage(m);
    this.applySoulRendDamage(m);
    this.applyDotDamage(m);
    this.applyRegeneration(m);
    this.tickDeathCurse(m, 'turn start');
    this.advanceDoom(m, 'turn start');
    this.tickDeathMark(m);
    this.applyMutivargZones(m);
    this.applyCorrosionPools(m);
    this.applyThunderBlessing(m);
    this.applyMineTurnResources(m);
    this.tickSpiderVenom(m);
    if (m.alive && m.crocodileGrip?.alive) {
      dealDamage(this.quietContext(m.crocodileGrip, m), m, dmg(this.rng.roll('1d3').total, 'pierce'), { canMiss: false });
    }
    if (m.mine?.kind === 'siren') {
      m.mine.aggressive = this.livingEnemiesOf(m).some((enemy) => dist(m.pos, enemy.pos) <= 3 * RANGE_UNIT);
    }
    this.applyEdgelordLanternUpkeep(m);
    this.tickScarabs(m);
    this.tickSwornRepetition(m);
    this.tickMindFuse(m);
    const ticks = this.ageStatuses(m);
    for (const line of ticks) this.log(line);
    this.syncCurseCorrodeSlow(m);
    this.applyControlOnTurnStart(m);
    this.tickDrainLink(m);
    this.regenResources(m);
    this.applyObjectsGear(m);
    this.applyShadowDaggerUpkeep(m);
    // Reveal anyone a foe is already standing next to at the start of the turn.
    this.breakProximityVeils();
    m.beginTurn();
    if (m.alive && m.mine?.kind === 'hydra' && m.actions.main > 0) {
      m.actions.main = m.mine.heads ?? 3;
    }
    this.applyDesecrationActionTax(m);
    if (!this.isPhasedOut(m)) moayTurnStart(this, m);
  }

  /**
   * Objects-class upkeep at the wielder's turn start: the Curse Corrode enchant's
   * self-toll and the conjured Veil bow's re-veil.
   */
  private applyObjectsGear(m: Mage): void {
    imbueTurnStart(this, m);
    const regen = m.regenPerTurn();
    if (regen > 0 && m.alive && m.hp < m.maxHp) heal(this.quietContext(m, m), m, regen);
    const store = m.stoneStore();
    if (store > 0 && m.alive) m.gatheredStones = Math.min(store, m.gatheredStones + 1);
    // Curse Corrode enchant: the wielder rots 1d3 each turn it keeps the weapon.
    if (m.weaponEnchant === 'curseCorrode' && m.alive) {
      const ctx = this.effectContext(m, m, null);
      dealDamage(ctx, m, dmg(this.rng.roll('1d3').total, 'corrosive'), { canMiss: false });
    }
    // Conjured Veil bow: re-cloak its holder at the start of each of their turns.
    const bowId = m.hands.find((id) => getItem(id).conjuredVeilBow);
    if (bowId && m.conjuredBowCombatsLeft > 0 && m.alive) {
      m.conjuredBowFiredThisTurn = false;
      const ctx = this.effectContext(m, m, null);
      applyInvisibility(ctx, m, { duration: 1, mode: 'partial' });
    }
  }

  /** Advance Mine-only cooldowns and per-turn resources on the owner's turn. */
  private applyMineTurnResources(m: Mage): void {
    if (!m.alive || !m.mine) return;
    for (const key of Object.keys(m.mine.cooldowns)) {
      m.mine.cooldowns[key] = Math.max(0, m.mine.cooldowns[key] - 1);
    }
    if (m.mine.kind === 'elite-kobold') {
      m.mine.charges = Math.min(12, (m.mine.charges ?? 0) + 1);
    }
    if (m.mine.kind === 'earth-elemental' && m.mine.stonesRound !== this.round) {
      const tierBonus = (m.mine.level >= 6 ? 1 : 0) + (m.mine.level >= 12 ? 1 : 0);
      m.mine.stones = (m.mine.stones ?? 0) + this.rng.roll('1d3').total + tierBonus;
      m.mine.stonesRound = this.round;
    }
    if (m.mine.kind === 'gigantuan-spider') {
      m.mine.eggLayRound = (m.mine.eggLayRound ?? 0) + 1;
      if (m.mine.eggLayRound % 2 === 0) {
        const count = this.rng.roll('1d3').total;
        for (let egg = 0; egg < count; egg++) {
          const angle = (2 * Math.PI * egg) / count;
          const gap = m.bodyRadius() + 20;
          const spawn = this.spawnSpiderCreature('spider-egg', m.mine.level, {
            x: m.x + Math.cos(angle) * gap, y: m.y + Math.sin(angle) * gap,
          });
          if (spawn.mine) spawn.mine.hatchRound = this.round + 3;
        }
        this.log(`${m.name} lays ${count} egg${count === 1 ? '' : 's'}.`);
      }
    }
  }

  hydraBurning(m: Mage): boolean {
    return m.mine?.kind === 'hydra' && m.mine.lastBurnRound != null &&
      m.mine.lastBurnRound >= this.round - 1;
  }

  resolveHydraWound(target: Mage, beforeHp: number, type: DamageType): void {
    const state = target.mine;
    if (state?.kind !== 'hydra') return;
    if (type === 'heat') state.lastBurnRound = this.round;
    if (!target.alive) return;
    for (const [index, fraction] of [0.75, 0.5, 0.25].entries()) {
      const bit = 1 << index;
      if ((state.headThresholds ?? 0) & bit) continue;
      const threshold = target.maxHp * fraction;
      if (beforeHp <= threshold || target.hp > threshold) continue;
      state.headThresholds = (state.headThresholds ?? 0) | bit;
      if (this.hydraBurning(target)) {
        this.log(`${target.name}'s new head is cauterized.`);
      } else {
        state.heads = (state.heads ?? 3) + 1;
        this.log(`${target.name} grows another head (${state.heads}).`);
      }
    }
  }

  addSpiderVenom(target: Mage, stacks: number, source: Mage): void {
    if (!target.alive || stacks <= 0) return;
    target.venomStacks += stacks;
    target.venomSource = source;
    this.log(`${target.name} has ${target.venomStacks} venom stacks.`);
    if (target.venomStacks >= 50) this.defeatMage(target, source, `${target.name} succumbs to spider venom.`);
  }

  private removeSpiderVenom(target: Mage, stacks: number): void {
    const removed = Math.min(target.venomStacks, stacks);
    if (!removed || !target.alive) return;
    target.venomStacks -= removed;
    this.log(`${target.name} sheds ${removed} venom stacks (${target.venomStacks} remain).`);
    dealDamage(this.quietContext(target.venomSource ?? target, target), target,
      dmg(removed, 'typeless'), { canMiss: false, trueDamage: true });
    if (!target.venomStacks) target.venomDistance = 0;
  }

  private tickSpiderVenom(target: Mage): void {
    if (target.alive && target.venomStacks > 0) {
      this.removeSpiderVenom(target, Math.ceil(target.venomStacks / 4));
    }
  }

  spawnSpiderCreature(kind: MineEnemyKind, level: number, at: Vec2): Mage {
    const point = {
      x: Math.max(FIELD.x + 8, Math.min(FIELD.x + FIELD.w - 8, at.x)),
      y: Math.max(FIELD.y + 8, Math.min(FIELD.y + FIELD.h - 8, at.y)),
    };
    if (this.spawnMineCreature) return this.spawnMineCreature(kind, level, point);
    const mage = new Mage({ name: 'Spider', isAI: true, team: 2, position: point, loadout: [] });
    applyMineEnemyTraits(mage, { kind, level }, this.rng);
    this.addMage(mage);
    return mage;
  }

  private hatchSpiderEggs(): void {
    for (const egg of [...this.mages]) {
      if (!egg.alive || egg.mine?.kind !== 'spider-egg' || (egg.mine.hatchRound ?? Infinity) > this.round) continue;
      if (!egg.mine.hatchHuge && this.rng.die(6) === 6) {
        egg.mine.hatchHuge = true;
        egg.mine.hatchRound = this.round + 2;
        this.log(`${egg.name} swells; something larger is growing inside.`);
        continue;
      }
      const kind = egg.mine.hatchHuge ? 'huge-spider' : 'small-spider';
      this.spawnSpiderCreature(kind, egg.mine.level, egg.pos);
      this.defeatMage(egg, egg, `${egg.name} hatches into a ${kind}.`);
    }
  }

  private applyFireVeilAuras(bearer: Mage): void {
    if (!bearer.alive || !this.effectiveInvisibility(bearer)) return;
    const auras = bearer.statuses.filter(
      (status) => status.kind === 'fireVeilAura'
    ) as FireVeilAuraStatus[];
    for (const aura of auras) {
      const owner = this.mages[aura.ownerIndex];
      if (!owner?.alive) continue;
      for (const target of this.magesInRadius(bearer.pos, aura.radius, bearer)) {
        if (target.team !== bearer.team) this.applyFireStacks(target, 1, owner);
      }
    }
  }

  quarterTurnDestination(
    from: Vec2,
    pivot: Vec2,
    clockwise: boolean
  ): { dest: Vec2; wallSlam: boolean; path: Vec2[] } {
    const dx = from.x - pivot.x;
    const dy = from.y - pivot.y;
    const radius = Math.hypot(dx, dy);
    if (radius < 1) return { dest: { ...from }, wallSlam: false, path: [] as Vec2[] };
    const startAngle = Math.atan2(dy, dx);
    const turn = clockwise ? -Math.PI / 2 : Math.PI / 2;
    const steps = Math.max(2, Math.ceil((radius * Math.PI) / 16));
    let last = { ...from };
    const path: Vec2[] = [];
    for (let step = 1; step <= steps; step++) {
      const angle = startAngle + (turn * step) / steps;
      const point = {
        x: pivot.x + Math.cos(angle) * radius,
        y: pivot.y + Math.sin(angle) * radius,
      };
      const outside =
        point.x < FIELD.x ||
        point.x > FIELD.x + FIELD.w ||
        point.y < FIELD.y ||
        point.y > FIELD.y + FIELD.h;
      if (outside || this.isInBarrier(point)) return { dest: last, wallSlam: true, path };
      last = point;
      path.push(point);
    }
    return { dest: last, wallSlam: false, path };
  }

  turnBattlefield(clockwise: boolean, source?: Mage): void {
    this.vfxSink?.quarterTurn?.(clockwise);
    const pivot = { x: FIELD.x + FIELD.w / 2, y: FIELD.y + FIELD.h / 2 };
    for (const mage of this.mages) {
      if (!mage.alive) continue;
      const origin = mage.pos;
      const turn = this.quarterTurnDestination(origin, pivot, clockwise);
      mage.x = turn.dest.x;
      mage.y = turn.dest.y;
      this.notifyMageRelocation(mage, origin, turn.dest, true, turn.path);
      if (source && turn.wallSlam && mage.alive && mage.team !== source.team) {
        const ctx = this.effectContext(source, mage, mage.pos);
        this.slamDamage(ctx, mage, rollDice(ctx, '2d6', 'Twist Reality collision'), 'typeless');
        this.log(`${mage.name} is crushed against the edge of reality!`);
      }
    }
    for (const scarab of [...this.scarabs].sort((a, b) => a.id - b.id)) {
      if (!scarabAlive(scarab) || !scarabFlying(scarab)) continue;
      const turn = this.quarterTurnDestination(
        { x: scarab.x, y: scarab.y },
        pivot,
        clockwise
      );
      scarab.x = turn.dest.x;
      scarab.y = turn.dest.y;
      if (source && turn.wallSlam && scarab.owner !== source.team) {
        const ctx = this.effectContext(source, null, { x: scarab.x, y: scarab.y });
        scarab.hp -= rollDice(ctx, '2d6', 'Twist Reality collision');
      }
    }
    this.scarabs = this.scarabs.filter(scarabAlive);
    this.updateAttachedScarabs();
    this.log(`The battlefield turns 90 degrees ${clockwise ? 'clockwise' : 'counterclockwise'}!`);
  }

  private applyTwistRunes(bearer: Mage): void {
    const runes = bearer.statuses.filter((status) => status.kind === 'twistRune') as TwistRuneStatus[];
    for (const rune of runes) {
      const owner = this.mages[rune.ownerIndex];
      if (!owner) continue;
      this.vfxSink?.twistRune?.(bearer.pos, rune.radius, rune.clockwise);
      const targets = this.mages.filter(
        (mage) => mage !== bearer && mage.alive && dist(mage.pos, bearer.pos) <= rune.radius
      );
      for (const target of targets) {
        const origin = target.pos;
        const turn = this.quarterTurnDestination(origin, bearer.pos, rune.clockwise);
        target.x = turn.dest.x;
        target.y = turn.dest.y;
        this.notifyMageRelocation(target, origin, turn.dest, true, turn.path);
        if (!target.alive) continue;
        const ctx = this.effectContext(owner, target, target.pos);
        dealDamage(ctx, target, dmg(this.rng.roll('1d3').total, 'shatter'), {
          canMiss: false,
        });
        if (turn.wallSlam && target.alive) {
          this.slamDamage(ctx, target, this.rng.roll('2d6').total, 'shatter');
          this.log(`${target.name} is slammed into a wall by ${rune.name}!`);
        }
      }
      const flying = this.scarabs
        .filter(
          (scarab) =>
            scarabAlive(scarab) &&
            scarabFlying(scarab) &&
            dist({ x: scarab.x, y: scarab.y }, bearer.pos) <= rune.radius
        )
        .sort((a, b) => a.id - b.id);
      for (const scarab of flying) {
        const turn = this.quarterTurnDestination(
          { x: scarab.x, y: scarab.y },
          bearer.pos,
          rune.clockwise
        );
        scarab.x = turn.dest.x;
        scarab.y = turn.dest.y;
        scarab.hp -= this.rng.roll('1d3').total;
        if (turn.wallSlam && scarabAlive(scarab)) scarab.hp -= this.rng.roll('2d6').total;
      }
      this.scarabs = this.scarabs.filter(scarabAlive);
      this.updateAttachedScarabs();
      this.log(`${rune.name} twists everything around ${bearer.name}.`);
    }
  }

  /**
   * Veil Bind (Objects) mantle: a weak Bind that roots the nearest living enemy
   * for a single turn. Deterministic (nearest by distance), so it is online-safe.
   */
  applyMantleBind(m: Mage): void {
    let best: Mage | null = null;
    let bestD = Infinity;
    for (const o of this.mages) {
      if (!o.alive || o.team === m.team) continue;
      const d = (o.x - m.x) ** 2 + (o.y - m.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (!best) {
      this.log(`${m.name}'s mantle finds no one to bind.`);
      return;
    }
    const ctx = this.effectContext(m, best, null);
    applyStun(ctx, best, { duration: 1, type: 'movement' });
    this.log(`${m.name}'s binding mantle roots ${best.name} in place.`);
  }

  // ---- Class kit: orbits, swaps, tethers and minions ------------------------

  /** Spin `target` a quarter turn around `pivot`. Walls and the field edge stop it short. */
  orbitAround(target: Mage, pivot: Vec2, clockwise: boolean): { moved: boolean; slammed: boolean } {
    if (!target.alive || target.displacementImmune || target.holdsGround() || this.isImmovable(target)) return { moved: false, slammed: false };
    const origin = target.pos;
    const turn = this.quarterTurnDestination(origin, pivot, clockwise);
    if (dist(origin, turn.dest) < 0.5) return { moved: false, slammed: turn.wallSlam };
    target.x = turn.dest.x;
    target.y = turn.dest.y;
    this.notifyMageRelocation(target, origin, turn.dest, true, turn.path);
    this.updateAttachedScarabs();
    this.dropTrailShadows(target);
    lawOnTurned(this, target);
    return { moved: true, slammed: turn.wallSlam };
  }

  /** An allied shroud minion hiding `m` from single-target enemy picks (areas still hit). Never shrouds itself. */
  shroudingMinion(m: Mage): Mage | undefined {
    if (!m.alive) return undefined;
    return this.mages.find((s) => {
      const reach = s.alive && s !== m && s.team === m.team && s.summonKind ? MINIONS[s.summonKind]?.shroud : undefined;
      return reach != null && dist(s.pos, m.pos) <= reach + m.bodyRadius();
    });
  }

  /** Robe (Objects Veil): a bonus action that answers half the time. */
  applyRobeCast(m: Mage): void {
    castRobe(this, m);
  }

  /** Tether `bearer` to `anchor`: it cannot walk further than `leash` from it. */
  tether(ownerIndex: number, bearer: Mage, anchor: Mage, leash: number, turns: number): void {
    if (!bearer.alive || !anchor.alive || bearer === anchor || this.isUnreachable(bearer)) return;
    if (bearer.isDebuffImmune() || bearer.slowStunImmune) {
      this.log(`${bearer.name} slips the tether.`);
      return;
    }
    const anchorIndex = this.mages.indexOf(anchor);
    addOrExtendStatus(
      bearer.statuses,
      {
        key: `tether:${anchorIndex}`,
        name: 'Tethered',
        kind: 'tether',
        duration: turns,
        anchorIndex,
        ownerIndex,
        leash,
      },
      false
    );
    this.log(`${bearer.name} is tethered to ${anchor.name}.`);
  }

  /** Living units tethered to `anchor`. */
  tetheredTo(anchor: Mage): Mage[] {
    const index = this.mages.indexOf(anchor);
    return this.mages.filter(
      (m) => m.alive && m.statuses.some((s) => s.kind === 'tether' && (s as TetherStatus).anchorIndex === index)
    );
  }

  /** Strip maximum health, at most `cap` in all; it returns when the combat ends. */
  wither(victim: Mage, amount: number, cap: number): void {
    if (!victim.alive) return;
    const bite = Math.min(amount, Math.max(0, cap - victim.witheredMaxHp), Math.max(0, victim.maxHp - 1));
    if (bite <= 0) return;
    victim.maxHp -= bite;
    victim.witheredMaxHp += bite;
    victim.hp = Math.min(victim.hp, victim.maxHp);
    this.log(`${victim.name} loses ${bite} maximum health.`);
  }

  /** What the gear a defender holds or wears does to whoever lands a basic attack on it. */
  armourRiders(target: Mage): HitEffect[] {
    return target
      .equippedItems()
      .filter((id) => !target.isItemBanned(id))
      .flatMap((id) => getItem(id).onStruck ?? []);
  }

  /** Every corrosive damage-over-time on `bearer` ticks once, right now. Returns what they dealt. */
  tickCorrosiveDots(bearer: Mage, source: Mage): number {
    return this.tickDotsNow(bearer, source, (dot) => dot.damage.type === 'corrosive');
  }

  lillithReap(source: Mage, target: Mage): void {
    lillithReap(this, source, target);
  }

  recordLillithOutput(source: Mage, amount: number): void {
    if (amount <= 0 || !this.mages.some((mage) => mage.alive && mage.lillith)) return;
    const owner = source.isSummon && source.summonOwnerIndex != null ? this.mages[source.summonOwnerIndex] ?? source : source;
    if (owner.enemyKind) return;
    this.lillithOutput.set(owner, (this.lillithOutput.get(owner) ?? 0) + amount);
  }

  burstDots(source: Mage, bearer: Mage): number {
    const dots = bearer.statuses.filter((status): status is DotStatus => status.kind === 'dot');
    bearer.statuses = bearer.statuses.filter((status) => !dots.includes(status as DotStatus));
    let dealt = 0;
    for (const dot of dots) {
      if (!bearer.alive) break;
      let amount = 0;
      for (let tick = 0; tick < Math.max(1, dot.duration); tick++) amount += this.rollDotDamage(dot);
      dealt += dealDamage(this.quietContext(source, bearer), bearer, dmg(amount, dot.damage.type), {
        canMiss: false, noImpactFx: true, cause: dot.name, dot: true,
      });
    }
    return dealt;
  }

  /** Every damage-over-time on `bearer` that `which` picks ticks once, right now. Returns what they dealt. */
  tickDotsNow(bearer: Mage, source: Mage, which: (dot: DotStatus) => boolean = () => true): number {
    const dots = bearer.statuses.filter((s) => s.kind === 'dot' && which(s as DotStatus)) as DotStatus[];
    let dealt = 0;
    for (const dot of dots) {
      if (!bearer.alive) break;
      dealt += dealDamage(this.quietContext(source, bearer), bearer, dmg(this.rollDotDamage(dot), dot.damage.type), {
        canMiss: false,
        noImpactFx: true,
        cause: dot.name,
        dot: true,
      });
    }
    return dealt;
  }

  /** A damage-over-time's current dice, rolled fresh, without advancing it. */
  rollDotDamage(dot: DotStatus): number {
    if (dot.damageSpec) return Math.max(0, this.rng.roll(dot.damageSpec).total);
    const specs = dot.escalateSpecs;
    if (specs?.length) return Math.max(0, this.rng.roll(specs[Math.min(dot.escalateIndex ?? 0, specs.length - 1)]).total);
    if (dot.stacks && dot.perStackSpec) return this.rollStackedDot(dot);
    return Math.max(0, dot.damage.amount);
  }

  /** Life minions act around themselves at their summoner's turn start. */
  private applyMinionPulses(owner: Mage): void {
    for (const summon of this.summonsOf(owner)) {
      const pulse = summon.summonKind ? MINIONS[summon.summonKind]?.pulse : undefined;
      if (pulse) runPulse(this, summon, owner, pulse);
    }
  }

  /** Spin a DoT's bearer around whoever laid it (Wringing Curse). */
  private orbitDotSource(bearer: Mage, dot: DotStatus): void {
    if (!dot.orbitSource || !bearer.alive) return;
    const source = dot.sourceIndex != null ? this.mages[dot.sourceIndex] : undefined;
    if (!source?.alive || source === bearer) return;
    this.orbitAround(bearer, source.pos, this.rng.chance(0.5));
  }

  /** Carry a DoT's bearer on its current (Water curses): toward a point, or from or to its source. */
  private driftDot(bearer: Mage, dot: DotStatus): void {
    if (!dot.drift || !bearer.alive) return;
    const source = dot.sourceIndex != null ? this.mages[dot.sourceIndex] : undefined;
    const px = dot.drift.px;
    let dest: Vec2 | null = null;
    if (dot.drift.to) {
      dest = stepTowards(bearer.pos, dot.drift.to, Math.abs(px));
    } else if (source?.alive && source !== bearer) {
      const gap = dist(bearer.pos, source.pos);
      if (px < 0) dest = stepTowards(bearer.pos, source.pos, Math.min(-px, gap));
      else if (gap > 0.5) dest = { x: bearer.x + ((bearer.x - source.x) / gap) * px, y: bearer.y + ((bearer.y - source.y) / gap) * px };
    }
    if (!dest || dist(dest, bearer.pos) < 0.5) return;
    this.log(`${dot.name} carries ${bearer.name}.`);
    this.forceMove(source ?? bearer, bearer, dest);
  }

  /**
   * Bind Shadow Mind: drag the bearer toward its anchor FIRST, then judge where
   * it landed — inside the anchoring team's dark it loses a word, outside the
   * chain bites. Physical travel, so a barrier can stop the pull short.
   */
  private applyShadowAnchors(bearer: Mage): void {
    if (!bearer.alive) return;
    const anchors = bearer.statuses.filter(
      (status) => status.kind === 'shadowAnchor'
    ) as ShadowAnchorStatus[];
    for (const anchor of anchors) {
      const owner = this.mages[anchor.ownerIndex] ?? bearer;
      const ctx = this.effectContext(owner, bearer, { x: anchor.x, y: anchor.y });
      dash(ctx, bearer, { toPoint: { x: anchor.x, y: anchor.y }, distance: anchor.pullPx });
      if (!bearer.alive) return;
      const swallowed = this.shadowsOf(anchor.ownerTeam).some(
        (shadow) => dist(bearer.pos, { x: shadow.x, y: shadow.y }) <= shadow.radius
      );
      if (swallowed) {
        // Duration 2: this runs before tickStatuses, so 1 would expire the same turn.
        applyForget(ctx, bearer, { count: 1, duration: 2 });
        this.log(`${bearer.name} is inside the anchoring shadow and forgets a word.`);
      } else {
        dealDamage(ctx, bearer, dmg(this.rng.roll('1d4').total, 'sanity'), {
          canMiss: false,
        });
        this.log(`${bearer.name} is outside the anchoring shadow.`);
      }
    }
  }

  /**
   * Bind Shadow Pierce: reel the hooked bearer in, bleed it, and leave one of
   * the hooker's shadows where it comes to rest — a trail in its own wake.
   */
  private applyShadowHooks(bearer: Mage): void {
    if (!bearer.alive) return;
    const hooks = bearer.statuses.filter(
      (status) => status.kind === 'shadowHook'
    ) as ShadowHookStatus[];
    for (const hook of hooks) {
      const owner = this.mages[hook.ownerIndex];
      if (!owner?.alive) continue;
      const ctx = this.effectContext(owner, bearer, owner.pos);
      const toOwner = stepTowards(bearer.pos, owner.pos, hook.pullPx);
      this.log(`${owner.name}'s hook pulls ${bearer.name} in.`);
      this.forceMove(owner, bearer, toOwner);
      if (!bearer.alive) return;
      dealDamage(ctx, bearer, dmg(this.rng.roll(hook.damageSpec).total, 'pierce'), {
        canMiss: false,
      });
      if (!bearer.alive) return;
      this.addShadow(bearer.pos, hook.ownerTeam, hook.shadowTtl);
    }
  }

  /**
   * Phased into the dark. A phased mage does not exist: nothing may target,
   * damage or afflict it, and it may do nothing on its turn but walk.
   */
  isPhasedOut(m: Mage): boolean {
    return m.statuses.some((status) => status.kind === 'phaseOut');
  }

  /** A self-phased mage walks through walls, zones and bodies alike. */
  isPhaseWalking(m: Mage): boolean {
    return m.statuses.some((status) => status.kind === 'phaseOut' && status.mode === 'self');
  }

  /**
   * Shadow Veil Corrode: a phase-walker dissolves whatever it drifts through.
   * Every hostile body the path crosses takes the phase's corrosive toll once.
   */
  burnPhaseWalkPath(walker: Mage, from: Vec2, to: Vec2): void {
    const phase = walker.statuses.find(
      (status) => status.kind === 'phaseOut' && status.mode === 'self'
    ) as PhaseOutStatus | undefined;
    if (!phase?.passThroughSpec) return;
    const travelled = dist(from, to);
    if (travelled < 1) return;
    const steps = Math.max(2, Math.ceil(travelled / 8));
    const burned = new Set<Mage>();
    for (let i = 0; i <= steps; i++) {
      const point = stepTowards(from, to, (travelled * i) / steps);
      for (const victim of this.mages) {
        if (victim === walker || !victim.alive || burned.has(victim)) continue;
        if (victim.team === walker.team) continue;
        if (dist(point, victim.pos) > victim.bodyRadius()) continue;
        burned.add(victim);
        dealDamage(
          this.effectContext(walker, victim, victim.pos),
          victim,
          dmg(this.rng.roll(phase.passThroughSpec).total, 'corrosive'),
          { canMiss: false }
        );
        this.log(`${walker.name} drifts through ${victim.name} and it dissolves.`);
      }
    }
  }

  /**
   * Age a phase at its bearer's turn start, releasing it when it runs out. A
   * banishment detonates around the spot it was held in.
   */
  private tickPhaseOut(bearer: Mage): void {
    const phase = bearer.statuses.find((status) => status.kind === 'phaseOut') as
      | PhaseOutStatus
      | undefined;
    if (!phase) return;
    phase.duration -= 1;
    if (phase.duration > 0) {
      this.log(`${bearer.name} is still phased (${phase.duration} left).`);
      return;
    }
    bearer.statuses = bearer.statuses.filter((status) => status !== phase);
    this.log(`${bearer.name} returns from phase.`);
    if (phase.mode !== 'banished' || !phase.burstSpec) return;
    const owner = this.mages[phase.ownerIndex] ?? bearer;
    const radius = phase.burstRadius ?? 4 * RANGE_UNIT;
    const amount = this.rng.roll(phase.burstSpec).total;
    for (const victim of this.mages) {
      if (!victim.alive || victim.team === phase.ownerTeam) continue;
      if (dist(victim.pos, bearer.pos) > radius + victim.bodyRadius()) continue;
      dealDamage(this.effectContext(owner, victim, bearer.pos), victim, dmg(amount, 'shadow'), {
        canMiss: false,
        aoe: true,
      });
    }
    this.log(`${bearer.name}'s phase ends in a burst.`);
  }

  /**
   * Bind Shadow Corrode: for a few rounds the owner's pools feed. A pool that
   * swallows an enemy grows and gains a permanent extra corrosive die, capped at
   * two meals per pool per round.
   */
  private applyFeedingDarks(prey: Mage): void {
    if (!prey.alive || this.feedingDarks.length === 0) return;
    for (const law of this.feedingDarks) {
      if (prey.team === law.ownerTeam) continue;
      const owner = this.mages[law.ownerIndex];
      if (!owner?.alive) continue;
      const pool = this.shadows.find(
        (shadow) =>
          shadow.owner === law.ownerTeam && dist(prey.pos, { x: shadow.x, y: shadow.y }) <= shadow.radius
      );
      if (!pool) continue;
      if (pool.feedRound !== this.round) {
        pool.feedRound = this.round;
        pool.feedMeals = 0;
      }
      if ((pool.feedMeals ?? 0) >= FEEDING_DARK_MEALS_PER_ROUND) continue;
      const ctx = this.effectContext(owner, prey, prey.pos);
      applyStun(ctx, prey, { duration: 1, type: 'movement' });
      dealDamage(ctx, prey, dmg(this.rng.roll('1d3').total, 'shadow'), { canMiss: false });
      const stacks = pool.feedStacks ?? 0;
      if (stacks > 0 && prey.alive) {
        dealDamage(ctx, prey, dmg(this.rng.roll(`${stacks}d3`).total, 'corrosive'), {
          canMiss: false,
        });
      }
      pool.feedStacks = stacks + 1;
      pool.feedMeals = (pool.feedMeals ?? 0) + 1;
      pool.radius += RANGE_UNIT;
      this.log(`The shadow consumes ${prey.name} and grows (${pool.feedStacks} consumed).`);
    }
  }

  /** Age the feeding law once per round and drop it when it is spent. */
  private tickFeedingDarks(): void {
    if (this.feedingDarks.length === 0) return;
    for (const law of this.feedingDarks) law.roundsLeft -= 1;
    this.feedingDarks = this.feedingDarks.filter((law) => law.roundsLeft > 0);
  }

  /**
   * Shadow Mind Curse: while the law stands, any enemy starting its turn in one of
   * the owner's pools rots in mind and body and is mired to a quarter pace.
   */
  private applyRottingDarks(prey: Mage): void {
    if (!prey.alive || this.rottingDarks.length === 0) return;
    for (const law of this.rottingDarks) {
      if (prey.team === law.ownerTeam) continue;
      const owner = this.mages[law.ownerIndex];
      if (!owner?.alive) continue;
      const inside = this.shadowsOf(law.ownerTeam).some(
        (shadow) => dist(prey.pos, { x: shadow.x, y: shadow.y }) <= shadow.radius
      );
      if (!inside) continue;
      const ctx = this.effectContext(owner, prey, prey.pos);
      dealDamage(ctx, prey, dmg(this.rng.roll('1d3').total, 'sanity'), {
        canMiss: false,
        noImpactFx: true,
      });
      if (!prey.alive) return;
      dealDamage(ctx, prey, dmg(this.rng.roll('1d6').total, 'corrosive'), {
        canMiss: false,
      });
      if (!prey.alive) return;
      applyDebuff(ctx, prey, {
        name: 'Rotting Dark',
        duration: 1,
        mods: { moveRange: -Math.round(MOVE_RANGE * 0.75) },
      });
      this.log(`${prey.name} takes damage from the rotting shadow.`);
    }
  }

  /** Age the rotting law once per round and drop it when it is spent. */
  private tickRottingDarks(): void {
    if (this.rottingDarks.length === 0) return;
    for (const law of this.rottingDarks) law.roundsLeft -= 1;
    this.rottingDarks = this.rottingDarks.filter((law) => law.roundsLeft > 0);
  }

  /** Raise a standing hazard. Returns the created zone. */
  addHazardZone(
    at: Vec2,
    owner: Mage,
    opts: Omit<HazardZone, 'id' | 'x' | 'y' | 'ownerIndex' | 'ownerTeam' | 'escalateIndex'>
  ): HazardZone {
    const zone: HazardZone = {
      ...opts,
      id: this.nextId++,
      x: at.x,
      y: at.y,
      ownerIndex: this.mages.indexOf(owner),
      ownerTeam: owner.team,
      escalateIndex: 0,
    };
    this.hazardZones.push(zone);
    return zone;
  }

  /** Every hazard zone `m` is currently standing in. */
  private hazardZonesAt(at: Vec2): HazardZone[] {
    for (const zone of this.hazardZones) {
      const carrier = zone.carrierIndex == null ? undefined : this.mages[zone.carrierIndex];
      if (carrier?.alive) {
        zone.x = carrier.x;
        zone.y = carrier.y;
      }
    }
    return this.hazardZones.filter((zone) => hazardDistance(zone, at) <= zone.radius);
  }

  /** Best concealment a standing hazard grants whoever is inside it. */
  hazardDodgeChance(m: Mage): number {
    let best = 0;
    for (const zone of this.hazardZonesAt(m.pos)) best = Math.max(best, zone.dodgeChance ?? 0);
    return best;
  }

  /** Combined healing multiplier of every hazard covering `at`. */
  healMultiplierAt(at: Vec2): number {
    let mult = 1;
    for (const zone of this.hazardZonesAt(at)) mult *= zone.healMult ?? 1;
    return mult;
  }

  /**
   * Bite anyone starting a turn inside a standing hazard. Deliberately
   * indiscriminate: black hazards do not care whose side you are on.
   */
  private applyHazardZones(m: Mage): void {
    if (!m.alive || this.hazardZones.length === 0) return;
    const spent = new Set<number>();
    for (const zone of this.hazardZonesAt(m.pos)) {
      if (zone.crossOnly || (zone.foesOnly && m.team === zone.ownerTeam)) continue;
      if (zone.hex?.side && zone.hex.side !== 'any' &&
          (zone.hex.side === 'allies') !== (m.team === zone.ownerTeam)) continue;
      // Read before Mage.beginTurn() clears it, so this is the turn just ended.
      if (zone.movedOnly && !m.movedThisTurn) continue;
      // Overlapping pieces of one cast are a single field, not many hazards.
      if (zone.groupId != null) {
        if (spent.has(zone.groupId)) continue;
        spent.add(zone.groupId);
      }
      const owner = this.mages[zone.ownerIndex] ?? m;
      if (zone.hex) this.applyHexGround(m, zone, owner);
      else {
        const spec = zone.damageSpecs[Math.min(zone.escalateIndex, zone.damageSpecs.length - 1)];
        if (spec) dealDamage(
          this.effectContext(owner, m, m.pos),
          m,
          dmg(this.rng.roll(spec).total, zone.damageType),
          { canMiss: false, aoe: true }
        );
      }
      this.log(`${m.name} is caught in ${zone.name}.`);
      if (!m.alive) return;
      if (zone.drift) this.driftInHazard(m, zone, owner);
      if (!m.alive) return;
    }
  }

  private applyHexGround(m: Mage, zone: HazardZone, owner: Mage): void {
    const hex = zone.hex;
    if (!hex) return;
    const ctx = this.effectContext(owner, m, m.pos);
    let dealt = 0;
    for (const hit of hex.hits) {
      if (!m.alive) return;
      dealt += dealDamage(ctx, m, dmg(this.rng.roll(hit.spec).total, hit.type), { canMiss: false, aoe: true });
    }
    if (hex.drink && dealt > 0) heal(ctx, owner, dealt);
    if (!m.alive) return;
    if (hex.heal) heal(ctx, m, this.rng.roll(hex.heal).total);
    if (hex.pace) addOrExtendStatus(m.statuses, {
      key: 'debuff:hex-ground-pace', name: 'Hexed Pace', kind: 'debuff', duration: 2,
      mods: { moveRange: Math.round(m.baseMoveRange() * hex.pace) },
    }, false);
    if (hex.root) applyStun(ctx, m, { duration: 2, type: 'movement' });
    if (hex.noHeal) applyDebuff(ctx, m, { name: 'Blighted', key: 'debuff:hex-blight', duration: 2, mods: {}, healMult: 0 });
    if (hex.wither) this.wither(m, hex.wither, 6);
    if (hex.spin) this.orbitAround(m, { x: zone.x, y: zone.y }, this.rng.chance(0.5));
    if (m.alive && hex.hexEcho) hexEcho(this, m, hex.hexEcho);
  }

  /** A current in a standing hazard carries what it bites toward its centre or out of it. */
  private driftInHazard(m: Mage, zone: HazardZone, owner: Mage): void {
    if (!zone.drift) return;
    const centre = { x: zone.x, y: zone.y };
    const gap = dist(m.pos, centre);
    if (zone.drift.inward) {
      if (gap < 1) return;
      this.forceMove(owner, m, stepTowards(m.pos, centre, zone.drift.px));
      return;
    }
    const dir = gap < 1 ? { x: 1, y: 0 } : { x: (m.x - centre.x) / gap, y: (m.y - centre.y) / gap };
    this.forceMove(owner, m, { x: m.x + dir.x * zone.drift.px, y: m.y + dir.y * zone.drift.px });
  }

  /** Age every hazard once per round and deepen the ones that escalate. */
  private tickHazardZones(): void {
    if (this.hazardZones.length === 0) return;
    for (const zone of this.hazardZones) {
      zone.roundsLeft -= 1;
      zone.escalateIndex += 1;
    }
    this.hazardZones = this.hazardZones.filter((zone) => zone.roundsLeft > 0);
  }

  // ---- Desecrate -----------------------------------------------------------

  /**
   * Minions are the drafted mages and the things they conjure — the player's own
   * kind. Wild creatures spawned by a wave or a room are not.
   */
  isMinion(m: Mage): boolean {
    return !m.enemyKind;
  }

  /** Desecrate spares black things and minions; everything else is fair game. */
  isDesecrationAffected(m: Mage): boolean {
    return m.alive && !this.isMinion(m) && m.profile.primary !== 'black';
  }

  /** Whether any desecration currently forbids `m` from being healed at all. */
  desecrationBlocksHealing(m: Mage): boolean {
    if (!this.isDesecrationAffected(m)) return false;
    if (this.desecrations.some((law) => law.blocksHealing)) return true;
    return this.desecrationFieldsAt(m.pos).some((field) => field.blocksHealing);
  }

  /** The owner a desecration hands `m`'s healing to instead, if one is stealing it. */
  desecrationHealThief(m: Mage): Mage | null {
    if (!this.isDesecrationAffected(m)) return null;
    for (const law of this.desecrations) {
      if (!law.redirectHealing) continue;
      const owner = this.mages[law.ownerIndex];
      if (owner?.alive && owner !== m) return owner;
    }
    return null;
  }

  addDesecration(owner: Mage, opts: Omit<Desecration, 'id' | 'ownerIndex' | 'ownerTeam'>): Desecration {
    const law: Desecration = {
      ...opts,
      id: this.nextId++,
      ownerIndex: this.mages.indexOf(owner),
      ownerTeam: owner.team,
    };
    this.desecrations.push(law);
    return law;
  }

  addDesecrationField(
    at: Vec2,
    owner: Mage,
    opts: Omit<DesecrationField, 'id' | 'x' | 'y' | 'ownerIndex' | 'ownerTeam'>
  ): DesecrationField {
    const field: DesecrationField = {
      ...opts,
      id: this.nextId++,
      x: at.x,
      y: at.y,
      ownerIndex: this.mages.indexOf(owner),
      ownerTeam: owner.team,
    };
    this.desecrationFields.push(field);
    return field;
  }

  desecrationFieldsAt(at: Vec2): DesecrationField[] {
    return this.desecrationFields.filter(
      (field) => dist(at, { x: field.x, y: field.y }) <= field.radius
    );
  }

  /** Roll one desecration's dice on `m`, returning the total it actually dealt. */
  private rollDesecrationTicks(m: Mage, owner: Mage, ticks: DesecrationTick[]): { dealt: number; corrosive: number } {
    let dealt = 0;
    let corrosive = 0;
    for (const tick of ticks) {
      if (!m.alive) break;
      const landed = dealDamage(
        this.effectContext(owner, m, m.pos),
        m,
        dmg(this.rng.roll(tick.spec).total, tick.type),
        { canMiss: false, aoe: true, noImpactFx: true }
      );
      dealt += landed;
      if (tick.type === 'corrosive') corrosive += landed;
    }
    if (dealt > 0) this.vfxSink?.spellEffect?.(m, 'corrosive');
    return { dealt, corrosive };
  }

  /** Field-wide desecration upkeep at the start of an affected unit's turn. */
  private applyDesecrations(m: Mage): void {
    if (this.desecrations.length === 0 || !this.isDesecrationAffected(m)) return;
    for (const law of this.desecrations) {
      if (!m.alive) return;
      // A law with nothing to roll this turn (thorns bill at turn end) stays quiet.
      if (this.lawTicks(law).length === 0 && !law.wither) continue;
      const owner = this.mages[law.ownerIndex] ?? m;
      const { corrosive } = this.rollDesecrationTicks(m, owner, this.lawTicks(law));
      if (law.lifesteal && owner !== m) drink(this, owner, corrosive);
      if (law.wither && m.alive) {
        const room = Math.max(0, law.wither.cap - m.witheredMaxHp);
        const bite = Math.min(law.wither.perTurn, room, Math.max(0, m.maxHp - 1));
        if (bite > 0) {
          m.maxHp -= bite;
          m.witheredMaxHp += bite;
          m.hp = Math.min(m.hp, m.maxHp);
          this.log(`${law.name} strips ${bite} maximum health from ${m.name}.`);
        }
      }
      this.log(`${m.name} suffers under ${law.name}.`);
    }
  }

  /** Fouled-ground upkeep at the start of a unit's turn. */
  private applyDesecrationFields(m: Mage): void {
    if (this.desecrationFields.length === 0) return;
    for (const field of this.desecrationFieldsAt(m.pos)) {
      if (!m.alive) return;
      if (!this.isDesecrationAffected(m)) continue;
      const owner = this.mages[field.ownerIndex] ?? m;
      const { dealt, corrosive } = this.rollDesecrationTicks(m, owner, field.ticks);
      if (dealt > 0) {
        if (field.lifesteal && owner !== m) drink(this, owner, corrosive);
        if (field.healKin) {
          for (const kin of this.mages) {
            if (!kin.alive || kin === m) continue;
            if (this.isMinion(kin) || kin.profile.primary === 'black') {
              heal(this.effectContext(owner, kin, null), kin, dealt);
            }
          }
        }
      }
      if (field.reapPerTurn && m.alive) this.applyReap(m, field.reapPerTurn, owner);
      if (field.rot && m.alive) {
        applyStackingDot(this.effectContext(owner, m, m.pos), m, {
          name: 'Plague Rot',
          key: 'dot:plague-rot',
          damage: dmg(0, 'corrosive'),
          perStackSpec: field.rot.spec,
          maxStacks: field.rot.maxStacks,
          refreshDuration: 2,
          decayPerTick: true,
          infectRadius: field.rot.spreadRadius,
        });
      }
      if (field.executeRadius != null && field.executeBelow != null && m.alive) {
        const core = dist(m.pos, { x: field.x, y: field.y }) <= field.executeRadius;
        if (core && m.hp <= field.executeBelow) {
          this.log(`${m.name} is drawn into the heart of ${field.name} and unmade.`);
          this.killByDeathWord(m, owner);
        }
      }
    }
  }

  /**
   * The sink's toll. This runs AFTER `Mage.beginTurn()` has refilled the turn,
   * and again whenever a unit walks in, so it cannot simply be reset away.
   */
  applyDesecrationActionTax(m: Mage): void {
    if (!m.alive) return;
    const taxed = this.desecrationFieldsAt(m.pos).some((field) => field.stripsActions);
    if (!taxed) return;
    if (m.actions.bonus <= 0 && m.reactedThisCycle) return;
    m.actions.bonus = Math.max(0, m.actions.bonus - 1);
    m.reactedThisCycle = true;
    this.log(`Desecrated ground smothers ${m.name}'s bonus action and reaction.`);
  }

  /** Everything a desecration does when something dies anywhere on the board. */
  private onDesecrationDeath(victim: Mage, source: Mage): void {
    const victimIndex = this.mages.indexOf(victim);
    const unhallowed = this.wasDesecrationAffected(victim);
    for (const law of this.desecrations) {
      const owner = this.mages[law.ownerIndex] ?? source;
      if (law.raiseDead && unhallowed && owner.alive) this.raiseThrall(victim, owner);
      if (law.reapOnDeath) {
        for (const m of this.mages) {
          if (this.isDesecrationAffected(m)) this.applyReap(m, law.reapOnDeath, owner);
        }
      }
      if (law.healKinOnDeath) {
        for (const m of this.mages) {
          if (!m.alive) continue;
          if (this.isMinion(m) || m.profile.primary === 'black') {
            heal(this.effectContext(owner, m, null), m, law.healKinOnDeath);
          }
        }
      }
    }
    for (const field of this.desecrationFields) {
      const owner = this.mages[field.ownerIndex] ?? source;
      const centre = { x: field.x, y: field.y };
      const inside = dist(victim.pos, centre) <= field.radius;
      if (field.carrierIndex === victimIndex) {
        // The rot stays where its carrier fell.
        field.carrierIndex = undefined;
        field.x = victim.x;
        field.y = victim.y;
        this.log(`${field.name} settles where ${victim.name} fell.`);
      }
      if (inside && unhallowed && field.burstOnDeath) this.burstCorpse(victim, owner, field);
      if (inside && field.growOnDeath) {
        const room = Math.max(0, (field.growOnDeathCap ?? Infinity) - (field.grownByDeath ?? 0));
        const grow = Math.min(field.growOnDeath, room);
        if (grow > 0) {
          field.radius += grow;
          field.grownByDeath = (field.grownByDeath ?? 0) + grow;
        }
      }
      if (inside && field.pullOnDeath) {
        const corpse = { ...victim.pos };
        for (const m of this.mages) {
          if (!m.alive || m === victim) continue;
          const drawn = dist(m.pos, centre) <= field.radius;
          const dest = drawn ? corpse : stepTowards(m.pos, corpse, field.pullOnDeath);
          this.forceMove(owner, m, dest);
        }
        this.log(`${field.name} collapses inward around ${victim.name}.`);
      }
      if (field.relocateOnDeath && !unhallowed) continue;
      if (field.relocateOnDeath && field.relocatedRound !== this.round) {
        field.relocatedRound = this.round;
        field.x = victim.x;
        field.y = victim.y;
        field.turnsLeft = Math.max(field.turnsLeft, 5);
        this.log(`${field.name} settles over ${victim.name}'s remains.`);
      }
    }
  }

  /** Age desecrations once per round, growing the ground that creeps. */
  private tickDesecrations(): void {
    for (const law of this.desecrations) {
      law.roundsLeft -= 1;
      law.stage = (law.stage ?? 0) + 1;
    }
    this.desecrations = this.desecrations.filter((law) => law.roundsLeft > 0);
    for (const field of this.desecrationFields) {
      field.turnsLeft -= 1;
      if (field.turnsLeft <= 0 && field.collapse) this.collapseDesecrationField(field);
      if (field.growPerRound) {
        field.radius = Math.max(RANGE_UNIT * 0.5, field.radius + field.growPerRound);
      }
      if (field.crawl) this.crawlDesecrationField(field, field.crawl);
      if (field.withersWhenEmpty) {
        const fed = this.mages.some(
          (m) =>
            this.isDesecrationAffected(m) &&
            dist(m.pos, { x: field.x, y: field.y }) <= field.radius
        );
        if (!fed) field.turnsLeft -= 1;
      }
    }
    this.desecrationFields = this.desecrationFields.filter((field) => field.turnsLeft > 0);
  }

  /** A sealed desecration will not let a walker cross back out of it. */
  clampToDesecrationFields(mover: Mage, from: Vec2, to: Vec2): Vec2 {
    let dest = to;
    for (const field of this.desecrationFields) {
      if (!field.sealed) continue;
      const centre = { x: field.x, y: field.y };
      if (dist(from, centre) > field.radius) continue;
      if (dist(dest, centre) <= field.radius) continue;
      dest = stepTowards(centre, dest, field.radius);
    }
    return dest;
  }

  /**
   * Bind Shadow Veil: the sealed bearer is worn down each turn. Its own side
   * cannot reach it to help (see {@link isUntargetable}), but the sealer can.
   */
  private applySeals(bearer: Mage): void {
    if (!bearer.alive) return;
    const seals = bearer.statuses.filter((status) => status.kind === 'seal') as SealStatus[];
    for (const seal of seals) {
      const owner = this.mages[seal.ownerIndex] ?? bearer;
      const ctx = this.effectContext(owner, bearer, bearer.pos);
      dealDamage(ctx, bearer, dmg(this.rng.roll(seal.damageSpec).total, 'shadow'), {
        canMiss: false,
      });
      if (!bearer.alive) return;
      this.executeTarget(owner, bearer, seal.executeAmount);
      if (!bearer.alive) return;
    }
  }

  /**
   * Bind Shatter Pierce: measure how far the bearer strayed from its spike over
   * the turn just ended, grind it for that distance, then haul it back.
   */
  private applyAnchorSpikes(bearer: Mage): void {
    if (!bearer.alive) return;
    const spikes = bearer.statuses.filter(
      (status) => status.kind === 'anchorSpike'
    ) as AnchorSpikeStatus[];
    for (const spike of spikes) {
      const owner = this.mages[spike.ownerIndex] ?? bearer;
      const anchor = { x: spike.x, y: spike.y };
      const travelled = dist(bearer.pos, anchor);
      const dice = Math.min(spike.maxDice, Math.floor(travelled / spike.pxPerDie));
      if (dice > 0) {
        dealDamage(
          this.effectContext(owner, bearer, anchor),
          bearer,
          dmg(this.rng.roll(`${dice}d6`).total, 'shatter'),
          { canMiss: false }
        );
        this.log(`${bearer.name} is torn back to the spike (${dice}d6).`);
        if (!bearer.alive) return;
      }
      this.forceMove(owner, bearer, anchor);
      if (!bearer.alive) return;
    }
  }

  /**
   * Lightning Curse: a wound on the bearer arcs a share of itself onward as heat.
   * Only direct damage propagates, so an arc can never chain into itself.
   */
  arcStormConduit(source: Mage, struck: Mage, amount: number): void {
    if (amount <= 0 || this.stormArcing) return;
    const conduit = struck.statuses.find((status) => status.kind === 'stormConduit') as
      | StormConduitStatus
      | undefined;
    if (!conduit) return;
    const share = Math.ceil(amount * conduit.sharePct);
    if (share <= 0) return;
    const owner = this.mages[conduit.ownerIndex] ?? source;
    const nearby = this.mages
      .filter((m) => m !== struck && m.alive && dist(m.pos, struck.pos) <= conduit.radius)
      .sort((a, b) => dist(a.pos, struck.pos) - dist(b.pos, struck.pos))
      .slice(0, conduit.maxTargets);
    if (nearby.length === 0) return;
    this.stormArcing = true;
    try {
      for (const other of nearby) {
        void this.vfxSink?.lightningBolt?.(struck.pos, other.pos);
        dealDamage(this.effectContext(owner, other, null), other, dmg(share, 'heat'), {
          canMiss: false,
        });
      }
      this.log(`The storm on ${struck.name} arcs to ${nearby.length} more.`);
    } finally {
      this.stormArcing = false;
    }
  }

  /** Replay the fixed hit sequence chosen when Lightning Storm was cast. */
  private applyLightningStorm(bearer: Mage): void {
    const storm = bearer.statuses.find((status) => status.kind === 'lightningStorm') as
      | LightningStormStatus
      | undefined;
    if (!storm) return;
    const owner = this.mages[storm.ownerIndex] ?? bearer;
    const ctx = this.effectContext(owner, null, bearer.pos);
    ctx.crit = storm.critical;
    ctx.spellRoll = undefined;
    for (const targetIndex of storm.targetIndices) {
      const target = this.mages[targetIndex];
      if (!target?.alive) continue;
      void this.vfxSink?.lightningBolt?.(bearer.pos, target.pos);
      dealDamage(ctx, target, dmg(storm.damage, 'heat'), {
        canMiss: false,
      });
    }
    this.log(`${bearer.name}'s Lightning Storm repeats ${storm.targetIndices.length} strikes.`);
  }

  /** Let a Faraday Veil reduce one direct hostile hit and discharge through Mindconduct. */
  interceptFaradayVeil(attacker: Mage, bearer: Mage, amount: number): number {
    if (amount <= 0 || attacker === bearer || attacker.team === bearer.team) return amount;
    const veil = bearer.statuses.find((status) => status.kind === 'faradayVeil') as
      | FaradayVeilStatus
      | undefined;
    if (!veil) return amount;

    const conductor = this.mages
      .filter(
        (mage) =>
          mage.alive &&
          mage.team !== bearer.team &&
          mage.lightningMindStacks > 0 &&
          !this.isUnreachable(mage) &&
          dist(mage.pos, bearer.pos) <= veil.arcRange
      )
      .sort(
        (left, right) =>
          right.lightningMindStacks - left.lightningMindStacks ||
          dist(left.pos, bearer.pos) - dist(right.pos, bearer.pos) ||
          this.mages.indexOf(left) - this.mages.indexOf(right)
      )[0];
    if (!conductor) return amount;

    const owner = this.mages[veil.ownerIndex]?.alive ? this.mages[veil.ownerIndex] : bearer;
    const spec = `1d${conductor.lightningMindStacks + 1}`;
    const route = this.showRoll(spec, 'Faraday Veil conductivity', bearer).total;
    const arcContext = this.effectContext(owner, conductor, bearer.pos);
    arcContext.crit = false;
    arcContext.spellRoll = undefined;

    if (route === 1) {
      const backlash = Math.max(1, Math.ceil(veil.power / 8)) * (veil.critical ? 2 : 1);
      applyMindLightningStack(conductor);
      void this.vfxSink?.lightningBolt?.(conductor.pos, bearer.pos);
      dealDamage(arcContext, bearer, dmg(backlash, 'sanity'), {
        canMiss: false,
        bypassFaraday: true,
      });
      this.log(`${bearer.name}'s Faraday Veil grounds for ${backlash} sanity damage.`);
      return amount;
    }

    const reduction = Math.min(0.9, 0.3 + veil.effectivePower * 0.02);
    const reduced = Math.max(0, Math.floor(amount * (1 - reduction)));
    const prevented = amount - reduced;
    const stacks = applyMindLightningStack(conductor);
    const discharge = mindLightningDamage(prevented, stacks) * (veil.critical ? 2 : 1);
    void this.vfxSink?.lightningBolt?.(bearer.pos, conductor.pos);
    dealDamage(arcContext, conductor, dmg(discharge, 'sanity'), {
      canMiss: false,
      bypassFaraday: true,
    });
    this.log(`${bearer.name}'s Faraday Veil prevents ${prevented} damage and discharges into ${conductor.name}.`);
    return reduced;
  }

  /** Bind Curse Pierce: queue a pierce hit to be repeated at the dealer's turn end. */
  recordPierceEcho(source: Mage, target: Mage, amount: number): void {
    if (this.pierceEchoFlushing || amount <= 0 || source === target) return;
    if (!source.statuses.some((status) => status.kind === 'pierceEcho')) return;
    this.pierceEchoes.push({
      sourceIndex: this.mages.indexOf(source),
      targetIndex: this.mages.indexOf(target),
      amount,
    });
  }

  /** Deal every pierce echo `m` banked this turn, then clear its queue. */
  private flushPierceEchoes(m: Mage): void {
    if (this.pierceEchoes.length === 0) return;
    const index = this.mages.indexOf(m);
    const mine = this.pierceEchoes.filter((echo) => echo.sourceIndex === index);
    this.pierceEchoes = this.pierceEchoes.filter((echo) => echo.sourceIndex !== index);
    if (mine.length === 0 || !m.alive) return;
    this.pierceEchoFlushing = true;
    try {
      for (const echo of mine) {
        const victim = this.mages[echo.targetIndex];
        if (!victim?.alive) continue;
        dealDamage(
          this.effectContext(m, victim, victim.pos),
          victim,
          dmg(echo.amount, 'pierce'),
          { canMiss: false }
        );
        this.log(`${m.name}'s oath repeats ${echo.amount} pierce on ${victim.name}.`);
      }
    } finally {
      this.pierceEchoFlushing = false;
    }
  }

  /**
   * Corrode Curse Pierce: a fresh pierce wound buys the rot more time. Heavy
   * hits always land the extension; glancing ones only sometimes.
   */
  extendPierceWounds(target: Mage, damage: DamageInstance, amount: number): void {
    if (damage.type !== 'pierce' || amount <= 0) return;
    const dots = target.statuses.filter((s) => s.kind === 'dot') as DotStatus[];
    for (const dot of dots) {
      const rule = dot.extendOnPierce;
      if (!rule || dot.duration >= rule.maxDuration) continue;
      if (amount < rule.minAmount && !this.rng.chance(rule.chanceBelow)) continue;
      dot.duration = Math.min(rule.maxDuration, dot.duration + 1);
      this.log(`${dot.name} reopens on ${target.name} (${dot.duration} cycles).`);
    }
  }

  /** Shadow Curse Pierce: the shade riding the bearer bites at its turn start. */
  private applyWoundShades(bearer: Mage): void {
    if (!bearer.alive) return;
    const shade = bearer.statuses.find((status) => status.kind === 'woundShade') as
      | WoundShadeStatus
      | undefined;
    if (!shade) return;
    const owner = this.mages[shade.ownerIndex] ?? bearer;
    if (!shade.damageSpec) return;
    dealDamage(
      this.effectContext(owner, bearer, bearer.pos),
      bearer,
      dmg(this.rng.roll(shade.damageSpec).total, 'shadow'),
      { canMiss: false, noImpactFx: true }
    );
  }

  /**
   * Mind Shatter Curse: the fuse swells every turn it survives. It burns down one
   * extra step whenever the victim spends a main action, so rushing means a
   * smaller blast and stalling means a far larger one.
   */
  private tickMindFuse(bearer: Mage): void {
    if (!bearer.alive) return;
    const fuse = bearer.statuses.find((status) => status.kind === 'mindFuse') as
      | MindFuseStatus
      | undefined;
    if (!fuse) return;
    fuse.ticks += 1;
    if (fuse.duration > 1) {
      this.log(`${bearer.name}'s fuse swells (${fuse.duration - 1} turns, ${fuse.ticks} charges).`);
      return;
    }
    this.detonateMindFuse(bearer, fuse);
  }

  /** Blow the fuse now, for its accumulated charge. */
  private detonateMindFuse(bearer: Mage, fuse: MindFuseStatus): void {
    bearer.statuses = bearer.statuses.filter((status) => status !== fuse);
    const owner = this.mages[fuse.ownerIndex] ?? bearer;
    let total = this.rng.roll(fuse.baseSpec).total;
    for (let i = 0; i < fuse.ticks; i++) total += this.rng.roll(fuse.growthSpec).total;
    this.log(`${bearer.name}'s fuse blows for ${total} after ${fuse.ticks} charges.`);
    dealDamage(this.effectContext(owner, bearer, null), bearer, dmg(total, 'sanity'), {
      canMiss: false,
    });
  }

  /** Any declared action — main, bonus or reaction — burns the fuse one step early. */
  burnMindFuse(bearer: Mage): void {
    const fuse = bearer.statuses.find((status) => status.kind === 'mindFuse') as
      | MindFuseStatus
      | undefined;
    if (!fuse) return;
    fuse.duration -= 1;
    if (fuse.duration <= 0) this.detonateMindFuse(bearer, fuse);
    else this.log(`${bearer.name} burns the fuse down to ${fuse.duration}.`);
  }

  /**
   * Bind Mind Curse: obeying the compulsion deepens the rot; failing to repeat
   * detonates it. Surviving to the end costs no blood but the stacks linger.
   */
  private tickSwornRepetition(bearer: Mage): void {
    if (!bearer.alive) return;
    const sworn = bearer.statuses.find((status) => status.kind === 'swornRepetition') as
      | SwornRepetitionStatus
      | undefined;
    if (!sworn) return;
    if (sworn.lingering) return;
    const compelled = bearer.statuses.some(
      (status) => status.kind === 'control' && status.mode === 'repeat'
    );
    if (!compelled) {
      // The compulsion broke early: the oath collects.
      bearer.statuses = bearer.statuses.filter((status) => status !== sworn);
      if (sworn.stacks <= 0) return;
      const owner = this.mages[sworn.ownerIndex] ?? bearer;
      const total = this.rng.roll(`${sworn.stacks}${sworn.perStackSpec}`).total;
      this.log(`${bearer.name} fails to repeat. Sworn Repetition deals ${total}.`);
      dealDamage(this.effectContext(owner, bearer, null), bearer, dmg(total, 'sanity'), {
        canMiss: false,
      });
      return;
    }
    sworn.stacks += 1;
    if (sworn.duration <= 1) {
      // Rode it out: no blood, but the rot outlives the compulsion.
      sworn.lingering = true;
      sworn.duration = sworn.lingerTurns + 1;
      this.log(`${bearer.name} survived Sworn Repetition. Stacks remain.`);
      return;
    }
    this.log(`${bearer.name} repeats its action. Sworn Repetition: ${sworn.stacks} stacks.`);
  }

  /** Damage-dealt / taken shift from an unbroken oath. */
  swornRepetitionStacks(m: Mage): number {
    const sworn = m.statuses.find((status) => status.kind === 'swornRepetition') as
      | SwornRepetitionStatus
      | undefined;
    return sworn?.stacks ?? 0;
  }

  /**
   * Bind Mind Pierce: a wound on one threaded victim echoes to the rest as mill.
   * Only direct damage propagates, so the echo can never chain into itself.
   */
  echoThreadMark(source: Mage, struck: Mage, amount: number): void {
    if (amount <= 0 || this.threadEchoing) return;
    const mark = struck.statuses.find((status) => status.kind === 'threadMark') as
      | ThreadMarkStatus
      | undefined;
    if (!mark) return;
    const echo = Math.max(1, Math.round(amount * mark.sharePct));
    this.threadEchoing = true;
    try {
      for (const other of this.mages) {
        if (other === struck || !other.alive) continue;
        const theirs = other.statuses.find((status) => status.kind === 'threadMark') as
          | ThreadMarkStatus
          | undefined;
        if (!theirs || theirs.ownerTeam !== mark.ownerTeam) continue;
        dealDamage(this.effectContext(source, other, null), other, dmg(echo, 'sanity'), {
          canMiss: false,
          noImpactFx: true,
        });
      }
    } finally {
      this.threadEchoing = false;
    }
  }

  /** Mind Curse Pierce: taking a reaction twists the needle, but the reaction still resolves. */
  twistReactionNeedle(reactor: Mage): void {
    const needle = reactor.statuses.find((status) => status.kind === 'reactionNeedle') as
      | ReactionNeedleStatus
      | undefined;
    if (!needle || !reactor.alive) return;
    const owner = this.mages[needle.ownerIndex] ?? reactor;
    this.log(`${reactor.name} reacts, and the needle twists.`);
    dealDamage(
      this.effectContext(owner, reactor, null),
      reactor,
      dmg(this.rng.roll(needle.damageSpec).total, 'sanity'),
      { canMiss: false }
    );
  }

  /** Veil Mind Curse: this mage reads every other entity as an enemy. */
  isFoeBlind(m: Mage): boolean {
    return m.statuses.some((status) => status.kind === 'foeBlind');
  }

  /** Foe-blind victims pick their target at random from everything but themselves. */
  randomFoeBlindTarget(m: Mage, candidates: readonly Mage[]): Mage | null {
    const pool = candidates.filter((other) => other !== m && other.alive);
    return pool.length > 0 ? pool[this.rng.die(pool.length) - 1] : null;
  }

  private applyFoeBlind(bearer: Mage): void {
    if (!bearer.alive) return;
    const blind = bearer.statuses.find((status) => status.kind === 'foeBlind') as
      | FoeBlindStatus
      | undefined;
    if (!blind) return;
    const owner = this.mages[blind.ownerIndex] ?? bearer;
    dealDamage(
      this.effectContext(owner, bearer, null),
      bearer,
      dmg(this.rng.roll(blind.damageSpec).total, 'sanity'),
      { canMiss: false, noImpactFx: true }
    );
  }

  /**
   * Bind Mind Corrode: a shackled mage forgets whatever it just declared — a
   * spell costs it every word it used, anything else costs it the swing.
   */
  private consumeMemoryShackle(item: StackItem): void {
    const bearer = item.source;
    const shackle = bearer.statuses.find((status) => status.kind === 'memoryShackle') as
      | MemoryShackleStatus
      | undefined;
    if (!shackle || !bearer.alive) return;
    const tokens = item.spell
      ? splitModifiers(item.spell.words).base.map(String)
      : item.kind === 'melee'
        ? ['melee']
        : [];
    if (tokens.length === 0) return;
    const forget = bearer.statuses.find((status) => status.kind === 'forget') as
      | ForgetStatus
      | undefined;
    if (forget) {
      for (const token of tokens) {
        if (!forget.forgotten.includes(token)) forget.forgotten.push(token);
      }
      forget.duration = Math.max(forget.duration, shackle.forgetDuration);
    } else {
      bearer.statuses.push({
        key: 'forget',
        name: 'Forgotten',
        kind: 'forget',
        duration: shackle.forgetDuration,
        forgotten: [...tokens],
      });
    }
    this.log(`${bearer.name} forgets ${tokens.join(', ')}.`);
  }

  // ---- Glass doubles, stone, rivets and blind spots -------------------------

  /**
   * Bind Veil Shatter: a targeted attack on a mage wrapped in glass doubles may
   * strike a double instead. The real body is one of `images + 1` candidates; a
   * struck double shatters, costs the attack everything and pins its attacker.
   */
  mirrorImageIntercepts(attacker: Mage, bearer: Mage): boolean {
    if (attacker === bearer || attacker.team === bearer.team) return false;
    const doubles = bearer.statuses.find((status) => status.kind === 'mirrorImages') as
      | MirrorImagesStatus
      | undefined;
    if (!doubles || doubles.images <= 0) return false;
    if (this.rng.die(doubles.images + 1) === 1) return false;
    doubles.images -= 1;
    doubles.name = `Glass Doubles ×${doubles.images}`;
    if (doubles.images <= 0) bearer.statuses = bearer.statuses.filter((status) => status !== doubles);
    this.log(`${attacker.name} strikes a glass double of ${bearer.name}. It shatters.`);
    this.vfxSink?.combatFeedback?.(bearer, { kind: 'miss', label: 'DOUBLE' });
    this.vfxSink?.shatterBurst?.(bearer.pos, bearer.bodyRadius() * 3, attacker.pos);
    if (!attacker.alive) return true;
    const ctx = this.effectContext(bearer, attacker, attacker.pos);
    ctx.crit = false;
    ctx.spellRoll = undefined;
    dealDamage(ctx, attacker, dmg(this.rng.roll('1d4').total, 'shatter'), { canMiss: false });
    if (attacker.alive) applyStun(ctx, attacker, { duration: 2, type: 'movement' });
    return true;
  }

  /** Bind Shatter Curse: begin turning `target` to stone, or spread stone already there. */
  petrify(owner: Mage, target: Mage): boolean {
    if (!target.alive || this.isUnreachable(target) || target.isDebuffImmune() || target.slowStunImmune) {
      this.log(`${target.name} cannot be turned to stone.`);
      return false;
    }
    let curse = target.statuses.find((status) => status.kind === 'petrify') as PetrifyStatus | undefined;
    if (curse) {
      curse.stage = Math.min(PETRIFY_STAGES, curse.stage + 1);
      this.log(`The stone on ${target.name} spreads.`);
    } else {
      curse = { key: 'petrify', name: 'Petrifying', kind: 'petrify', duration: 0, stage: 1, ownerIndex: this.mages.indexOf(owner) };
      target.statuses.push(curse);
      this.log(`${target.name} begins to turn to stone.`);
    }
    curse.duration = PETRIFY_STAGES + 1 - curse.stage;
    this.syncPetrification(target, curse);
    return true;
  }

  /** The stone has fully set: stunned, and brittle to shatter damage. */
  isPetrified(m: Mage): boolean {
    return m.statuses.some((status) => status.kind === 'petrify' && status.stage >= PETRIFY_STAGES);
  }

  /** Healing flesh cracks the stone back one stage; cracking the first ends the curse. */
  crackPetrification(m: Mage): void {
    const curse = m.statuses.find((status) => status.kind === 'petrify') as PetrifyStatus | undefined;
    if (!curse) return;
    curse.stage -= 1;
    if (curse.stage <= 0) {
      this.clearPetrification(m);
      this.log(`${m.name} is healed free of the stone.`);
      return;
    }
    curse.duration = PETRIFY_STAGES + 1 - curse.stage;
    this.log(`Healing cracks the stone on ${m.name}.`);
    this.syncPetrification(m, curse);
  }

  /** The stone spreads one stage each time its bearer ends a turn, then shatters. */
  private advancePetrification(bearer: Mage): void {
    const curse = bearer.statuses.find((status) => status.kind === 'petrify') as PetrifyStatus | undefined;
    if (!curse || !bearer.alive) return;
    if (curse.stage >= PETRIFY_STAGES) {
      this.shatterPetrified(bearer, curse);
      return;
    }
    curse.stage += 1;
    curse.duration = PETRIFY_STAGES + 1 - curse.stage;
    this.log(curse.stage >= PETRIFY_STAGES ? `${bearer.name} turns to stone.` : `${bearer.name} stiffens into stone.`);
    this.syncPetrification(bearer, curse);
  }

  /** Every reached stage keeps its affliction; stages undone by healing lose theirs. */
  private syncPetrification(bearer: Mage, curse: PetrifyStatus): void {
    bearer.statuses = bearer.statuses.filter(
      (status) =>
        !(status.key === PETRIFY_ROOT_KEY && curse.stage < 2) &&
        !(status.key === PETRIFY_STONE_KEY && curse.stage < PETRIFY_STAGES)
    );
    const ctx = this.effectContext(this.mages[curse.ownerIndex] ?? bearer, bearer, bearer.pos);
    ctx.crit = false;
    applyDebuff(ctx, bearer, {
      name: 'Stiffening',
      key: PETRIFY_SLOW_KEY,
      duration: 2,
      mods: { moveRange: -Math.round(MOVE_RANGE * 0.5) },
    });
    if (curse.stage >= 2) applyStun(ctx, bearer, { duration: 2, type: 'movement', key: PETRIFY_ROOT_KEY });
    if (curse.stage >= PETRIFY_STAGES) {
      applyStun(ctx, bearer, { duration: 2, type: 'full', key: PETRIFY_STONE_KEY });
    }
  }

  private clearPetrification(m: Mage): void {
    m.statuses = m.statuses.filter(
      (status) =>
        status.kind !== 'petrify' &&
        status.key !== PETRIFY_SLOW_KEY &&
        status.key !== PETRIFY_ROOT_KEY &&
        status.key !== PETRIFY_STONE_KEY
    );
  }

  /** The statue breaks: 3d6 shatter to it, 1d6 shatter to every unit within 3cm. */
  private shatterPetrified(bearer: Mage, curse: PetrifyStatus): void {
    this.clearPetrification(bearer);
    const owner = this.mages[curse.ownerIndex] ?? bearer;
    const quiet = (victim: Mage): EffectContext => {
      const ctx = this.effectContext(owner, victim, bearer.pos);
      ctx.crit = false;
      ctx.spellRoll = undefined;
      return ctx;
    };
    const around = this.magesInRadius(bearer.pos, 3 * RANGE_UNIT, bearer);
    this.log(`${bearer.name} shatters.`);
    this.vfxSink?.shatterBurst?.(bearer.pos, 6 * RANGE_UNIT);
    dealDamage(quiet(bearer), bearer, dmg(this.showRoll('3d6', 'Shattered stone', bearer).total, 'shatter'), {
      canMiss: false,
    });
    if (around.length === 0) return;
    const shards = this.showRoll('1d6', 'Stone shards').total;
    for (const other of around) {
      if (!other.alive) continue;
      dealDamage(quiet(other), other, dmg(shards, 'shatter'), { canMiss: false, aoe: true });
    }
  }

  /** Bind Corrode Pierce: fasten two bodies together for `duration` turns. */
  rivet(a: Mage, b: Mage, leashPx: number, duration: number): void {
    const hold = (partner: Mage): RivetStatus => ({
      key: 'rivet',
      name: 'Riveted',
      kind: 'rivet',
      duration,
      partnerIndex: this.mages.indexOf(partner),
      leashPx,
    });
    addOrExtendStatus(a.statuses, hold(b), false);
    addOrExtendStatus(b.statuses, hold(a), false);
    this.log(`${a.name} and ${b.name} are riveted together.`);
  }

  /** The body riveted to `m`, while the rivet still holds at both ends. */
  rivetPartner(m: Mage): Mage | null {
    const rivet = m.statuses.find((status) => status.kind === 'rivet') as RivetStatus | undefined;
    if (!rivet) return null;
    const partner = this.mages[rivet.partnerIndex];
    if (!partner?.alive) return null;
    const back = partner.statuses.find((status) => status.kind === 'rivet') as RivetStatus | undefined;
    return back && this.mages[back.partnerIndex] === m ? partner : null;
  }

  /** A riveted body that moves hauls its partner along behind it. */
  private dragRivetPartner(mover: Mage): void {
    if (this.rivetDragging || !mover.alive) return;
    const partner = this.rivetPartner(mover);
    if (!partner) return;
    const rivet = mover.statuses.find((status) => status.kind === 'rivet') as RivetStatus;
    if (dist(mover.pos, partner.pos) <= rivet.leashPx + 1) return;
    this.rivetDragging = true;
    try {
      this.log(`${mover.name} drags ${partner.name} along.`);
      this.forceMove(mover, partner, stepTowards(mover.pos, partner.pos, rivet.leashPx));
    } finally {
      this.rivetDragging = false;
    }
  }

  /** Veil Mind Corrode: `viewer` has lost `m` from its mind and cannot target it. */
  cannotPerceive(viewer: Mage, m: Mage): boolean {
    return viewer.statuses.some(
      (status) => status.kind === 'blindSpot' && this.mages[(status as BlindSpotStatus).hiddenIndex] === m
    );
  }

  /** Whether an opaque barrier stands between two points (Veil Shatter Corrode's curtain). */
  sightBlocked(from: Vec2, to: Vec2): boolean {
    return this.barriers.some((barrier) => barrier.opaque && this.sightBlockedBy(barrier, from, to));
  }

  /** The opaque barriers standing between two points, for routing around them. */
  sightBlockers(from: Vec2, to: Vec2): BarrierZone[] {
    return this.barriers.filter((barrier) => barrier.opaque && this.sightBlockedBy(barrier, from, to));
  }

  private sightBlockedBy(barrier: BarrierZone, from: Vec2, to: Vec2): boolean {
    const total = dist(from, to);
    const steps = Math.max(2, Math.ceil(total / 8));
    for (let i = 1; i < steps; i++) {
      if (barrierContains(barrier, stepTowards(from, to, (total * i) / steps))) return true;
    }
    return false;
  }

  // ---- God words: stopped time, dooms, marks, pacts and rewritten rules ------

  /** An effect context whose dice neither crit nor read the resolving cast's roll. */
  quietContext(owner: Mage, target: Mage): EffectContext {
    const ctx = this.effectContext(owner, target, target.pos);
    ctx.crit = false;
    ctx.spellRoll = undefined;
    return ctx;
  }

  timeStopOn(m: Mage): TimeStopStatus | undefined {
    return m.statuses.find((status) => status.kind === 'timeStop') as TimeStopStatus | undefined;
  }

  isTimeStopped(m: Mage): boolean {
    return !!this.timeStopOn(m);
  }

  /** Sealed in glass: nothing may target or harm it until time resumes. */
  isInSanctuary(m: Mage): boolean {
    return !!this.timeStopOn(m)?.sanctuary;
  }

  isFixedPoint(m: Mage): boolean {
    return m.statuses.some((status) => status.kind === 'fixedPoint');
  }

  /** Nothing may move this body: nailed to a fixed point, or held in stopped time. */
  isImmovable(m: Mage): boolean {
    if (this.isFixedPoint(m)) return true;
    const stop = this.timeStopOn(m);
    return !!stop && stop.resumeAfterOwnerTurns == null;
  }

  /** Stopped time or stopped reflexes: this mage cannot react to anything. */
  cannotReact(m: Mage): boolean {
    return (
      !!m.crocodileGrip?.alive ||
      this.isTimeStopped(m) ||
      m.statuses.some((status) => status.kind === 'reflexStop') ||
      lawCannotReact(this, m)
    );
  }

  hasPhantomReach(m: Mage): boolean {
    return m.statuses.some((status) => status.kind === 'phantomReach');
  }

  /** Whoever dealt `m` a mortal wound that turns its healing into Reap, if any. */
  mortalWounder(m: Mage): Mage | null {
    const wound = m.statuses.find(
      (status) => status.kind === 'dot' && (status as DotStatus).healBecomesReap
    ) as DotStatus | undefined;
    if (!wound) return null;
    return (wound.sourceIndex != null ? this.mages[wound.sourceIndex] : undefined) ?? m;
  }

  /**
   * Stop time for `target`. A freeze skips `turns` of its own turn starts; an
   * everyone-else freeze instead lasts until `resumeAfterOwnerTurns` of the
   * owner's turns have ended. Returns the status, or null when it will not hold.
   */
  stopTime(
    owner: Mage,
    target: Mage,
    opts: {
      turns: number;
      resumeAfterOwnerTurns?: number;
      sanctuary?: boolean;
      release?: TimeStopStatus['release'];
      burst?: TimeStopStatus['burst'];
    }
  ): TimeStopStatus | null {
    if (!target.alive || this.isPhasedOut(target)) return null;
    const hostile = !opts.sanctuary && opts.resumeAfterOwnerTurns == null;
    if (hostile && target.isDebuffImmune()) {
      this.log(`${target.name} is immune to debuffs. Time will not stop for it.`);
      return null;
    }
    const existing = this.timeStopOn(target);
    if (existing) {
      existing.turns = Math.max(existing.turns, opts.turns);
      if (opts.resumeAfterOwnerTurns != null && existing.resumeAfterOwnerTurns != null) {
        existing.resumeAfterOwnerTurns = Math.max(existing.resumeAfterOwnerTurns, opts.resumeAfterOwnerTurns);
      }
      existing.duration = Math.max(existing.duration, opts.resumeAfterOwnerTurns ?? opts.turns);
      this.log(`${target.name}'s stopped time lengthens.`);
      return existing;
    }
    const status: TimeStopStatus = {
      key: 'timeStop',
      name: opts.sanctuary ? 'Glass Coffin' : 'Time-Stopped',
      kind: 'timeStop',
      duration: Math.max(1, opts.resumeAfterOwnerTurns ?? opts.turns),
      ownerIndex: this.mages.indexOf(owner),
      turns: opts.turns,
      held: [],
      resumeAfterOwnerTurns: opts.resumeAfterOwnerTurns,
      sanctuary: opts.sanctuary,
      release: opts.release,
      burst: opts.burst,
    };
    target.statuses.push(status);
    // Caught mid-turn, it gets nothing more out of this one either.
    if (target === this.current && opts.turns > 0) target.actions = { move: 0, main: 0, bonus: 0 };
    this.log(
      opts.sanctuary
        ? `${target.name} is sealed in glass.`
        : `Time stops for ${target.name}.`
    );
    return status;
  }

  /** A hit on a frozen body waits for time to resume. */
  holdHit(target: Mage, stop: TimeStopStatus, amount: number, type: DamageType, source: Mage): void {
    if (amount <= 0) return;
    stop.held.push({ amount, type, sourceIndex: this.mages.indexOf(source) });
    this.log(`${amount} ${type} damage hangs frozen before ${target.name}.`);
    this.vfxSink?.combatFeedback?.(target, { kind: 'blocked', damageType: type, label: `HELD ${amount}` });
  }

  /** A frozen mage sits its turn out entirely. Returns true when it does. */
  private skipFrozenTurn(m: Mage): boolean {
    const stop = this.timeStopOn(m);
    if (!stop) return false;
    if (stop.turns <= 0) {
      // Frozen only by someone else's stopped world, which should already have
      // resumed: time moves on for it now.
      this.resumeTime(m, stop);
      return false;
    }
    stop.turns -= 1;
    stop.duration = Math.max(1, stop.turns);
    stop.skipping = true;
    m.actions = { move: 0, main: 0, bonus: 0 };
    m.reactedThisCycle = true;
    this.log(`${m.name} is frozen in time and loses the turn.`);
    return true;
  }

  /** Time resumes after a skipped turn, and for everyone the ending owner froze. */
  private resumeTimeAfterTurn(current: Mage): void {
    const own = this.timeStopOn(current);
    if (own?.skipping) {
      own.skipping = false;
      if (own.turns <= 0) this.resumeTime(current, own);
    }
    const index = this.mages.indexOf(current);
    for (const m of [...this.mages]) {
      const stop = this.timeStopOn(m);
      if (!stop || stop.ownerIndex !== index || stop.resumeAfterOwnerTurns == null) continue;
      stop.resumeAfterOwnerTurns -= 1;
      stop.duration = Math.max(1, stop.resumeAfterOwnerTurns);
      if (stop.resumeAfterOwnerTurns <= 0) this.resumeTime(m, stop);
    }
  }

  /** A stopped world whose owner has fallen starts again at once. */
  private releaseOrphanedTimeStops(): void {
    for (const m of [...this.mages]) {
      const stop = this.timeStopOn(m);
      if (!stop || stop.resumeAfterOwnerTurns == null) continue;
      if (this.mages[stop.ownerIndex]?.alive) continue;
      this.resumeTime(m, stop);
    }
  }

  /** Time resumes: every held hit lands at once, then any release and burst. */
  private resumeTime(m: Mage, stop: TimeStopStatus): void {
    m.statuses = m.statuses.filter((status) => status !== stop);
    if (!m.alive) return;
    const owner = this.mages[stop.ownerIndex] ?? m;
    this.log(stop.sanctuary ? `The glass around ${m.name} breaks.` : `Time resumes for ${m.name}.`);
    this.vfxSink?.godFx?.(stop.sanctuary ? 'cataclysm' : 'sphere', m.pos, { size: m.bodyRadius() * 6 });
    let landed = 0;
    for (const hit of stop.held) {
      if (!m.alive) break;
      const source = this.mages[hit.sourceIndex] ?? owner;
      landed += dealDamage(this.quietContext(source, m), m, dmg(hit.amount, hit.type), {
        canMiss: false,
        aoe: true,
        cause: 'HELD',
      });
    }
    if (stop.held.length > 1) {
      this.log(`${stop.held.length} held blows land on ${m.name} at once for ${landed}.`);
    }
    if (stop.release && m.alive) {
      const amount = this.showRoll(stop.release.spec, 'Time resumes', m).total;
      dealDamage(this.quietContext(owner, m), m, dmg(amount, stop.release.type), {
        canMiss: false,
        aoe: true,
      });
    }
    if (stop.burst) {
      const shards = this.magesInRadius(m.pos, stop.burst.radius, m).filter(
        (other) => other.team !== owner.team
      );
      if (shards.length === 0) return;
      const amount = this.showRoll(stop.burst.spec, 'Breaking glass').total;
      for (const other of shards) {
        if (!other.alive) continue;
        dealDamage(this.quietContext(owner, other), other, dmg(amount, stop.burst.type), {
          canMiss: false,
          aoe: true,
        });
      }
    }
  }

  /** Stopped clock: nothing on the bearer wears off but the stopped clock itself. */
  private ageStatuses(m: Mage): string[] {
    // Eternal Rot / Eternal Thirst: afflictions on the unhallowed do not run down.
    if ((this.hexLaw('eternalRot') || this.hexLaw('eternalThirst')) && this.isDesecrationAffected(m)) {
      for (const status of m.statuses) if (status.kind === 'dot') status.duration += 1;
    }
    const clock = m.statuses.find((status) => status.kind === 'clockStopped');
    if (!clock) return m.tickStatuses();
    clock.duration -= 1;
    if (clock.duration > 0) return [`Nothing on ${m.name} wears off.`];
    m.statuses = m.statuses.filter((status) => status !== clock);
    return [`${m.name}'s clock starts again.`];
  }

  doomOn(m: Mage): DoomStatus | undefined {
    return m.statuses.find((status) => status.kind === 'doom') as DoomStatus | undefined;
  }

  /** Doom `target`. Dooming the already doomed makes it fall at once. */
  applyDoom(
    owner: Mage,
    target: Mage,
    opts: { countdown: number; spec: string; executeAmount: number; radius: number }
  ): void {
    if (!target.alive || this.isUnreachable(target)) return;
    const existing = this.doomOn(target);
    if (existing) {
      this.log(`${target.name} is doomed twice over. The doom falls now.`);
      this.fallDoom(target, existing);
      return;
    }
    if (target.isDebuffImmune()) {
      this.log(`${target.name} is immune to debuffs. The doom slides off.`);
      return;
    }
    target.statuses.push({
      key: 'doom',
      name: 'Doom',
      kind: 'doom',
      duration: opts.countdown,
      ownerIndex: this.mages.indexOf(owner),
      spec: opts.spec,
      executeAmount: opts.executeAmount,
      radius: opts.radius,
    });
    this.log(`${target.name} is doomed. It falls in ${opts.countdown}.`);
  }

  /** The doom draws one step closer, and falls when the count runs out. */
  advanceDoom(m: Mage, reason: string): void {
    const doom = this.doomOn(m);
    if (!doom || !m.alive) return;
    doom.duration -= 1;
    if (doom.duration > 0) {
      this.log(`${m.name}'s doom draws closer (${reason}): ${doom.duration} left.`);
      return;
    }
    this.fallDoom(m, doom);
  }

  private fallDoom(m: Mage, doom: DoomStatus): void {
    m.statuses = m.statuses.filter((status) => status !== doom);
    const owner = this.mages[doom.ownerIndex] ?? m;
    this.log(`The doom falls on ${m.name}.`);
    this.vfxSink?.godFx?.('cataclysm', m.pos, { size: doom.radius * 2.6 });
    this.vfxSink?.boom?.(m.pos);
    const around = this.magesInRadius(m.pos, doom.radius, m);
    const total = this.showRoll(doom.spec, 'Doom', m).total;
    dealDamage(this.quietContext(owner, m), m, dmg(total, 'shatter'), { canMiss: false, aoe: true });
    const half = Math.floor(total / 2);
    for (const other of around) {
      if (!other.alive || half <= 0) continue;
      dealDamage(this.quietContext(owner, other), other, dmg(half, 'shatter'), {
        canMiss: false,
        aoe: true,
      });
    }
    if (m.alive) this.executeTarget(owner, m, doom.executeAmount);
  }

  hasDeathMark(m: Mage): boolean {
    return m.statuses.some((status) => status.kind === 'deathMark');
  }

  applyDeathMark(owner: Mage, target: Mage, turns: number, executeAmount: number): void {
    if (!target.alive || this.isUnreachable(target)) return;
    if (target.isDebuffImmune()) {
      this.log(`${target.name} is immune to debuffs. The mark fails.`);
      return;
    }
    addOrExtendStatus(
      target.statuses,
      {
        key: 'deathMark',
        name: 'Marked for Death',
        kind: 'deathMark',
        duration: turns,
        ownerIndex: this.mages.indexOf(owner),
        executeAmount,
      },
      false
    );
    this.log(`${target.name} is marked for death.`);
  }

  /** Every wound on a marked body feeds its Reap; pierce feeds it twice. */
  feedDeathMark(target: Mage, type: DamageType): void {
    const mark = target.statuses.find((status) => status.kind === 'deathMark') as
      | DeathMarkStatus
      | undefined;
    if (!mark || !target.alive) return;
    this.applyReap(target, type === 'pierce' ? 2 : 1, this.mages[mark.ownerIndex] ?? target);
  }

  /** The mark counts down on its bearer's turns and executes when it comes due. */
  private tickDeathMark(m: Mage): void {
    const mark = m.statuses.find((status) => status.kind === 'deathMark') as
      | DeathMarkStatus
      | undefined;
    if (!mark || !m.alive) return;
    mark.duration -= 1;
    if (mark.duration > 0) return;
    m.statuses = m.statuses.filter((status) => status !== mark);
    this.log(`The mark on ${m.name} comes due.`);
    this.vfxSink?.godFx?.('deathMark', m.pos, { size: m.bodyRadius() * 7 });
    this.executeTarget(this.mages[mark.ownerIndex] ?? m, m, mark.executeAmount);
  }

  /** A pact-bound attacker repays every wound it deals to anything else in sanity. */
  echoSoulPact(attacker: Mage, victim: Mage, amount: number): void {
    if (this.soulPactEchoing || amount <= 0 || attacker === victim || !attacker.alive) return;
    const pact = attacker.statuses.find((status) => status.kind === 'soulPact') as
      | SoulPactStatus
      | undefined;
    if (!pact) return;
    this.soulPactEchoing = true;
    try {
      this.log(`${attacker.name}'s pact demands repayment.`);
      dealDamage(
        this.quietContext(this.mages[pact.ownerIndex] ?? attacker, attacker),
        attacker,
        dmg(amount, 'sanity'),
        { canMiss: false, noImpactFx: true, cause: 'PACT' }
      );
    } finally {
      this.soulPactEchoing = false;
    }
  }

  /** Foreknowledge or a stifle: the next action this mage declares fails before it begins. */
  stopDeclaredAction(item: StackItem): boolean {
    const bearer = item.source;
    if (item.windowTrigger || !bearer.alive) return false;
    if (bearer.crocodileGrip?.alive) {
      this.log(`${bearer.name} cannot ${item.label} while held in the crocodile's jaws.`);
      return true;
    }
    for (const faeri of this.mages) {
      if (!faeri.alive || faeri.mine?.kind !== 'faeri' || faeri === bearer) continue;
      if (this.rng.die(3) !== 3) continue;
      const gap = bearer.bodyRadius() + faeri.bodyRadius() + 4;
      teleport(this.quietContext(faeri, bearer), faeri, stepTowards(bearer.pos, faeri.pos, gap));
      this.log(`${faeri.name} stifles ${bearer.name}'s ${item.label}.`);
      dealDamage(this.quietContext(faeri, bearer), bearer, dmg(1, 'sanity'), { canMiss: false });
      return true;
    }
    const fore = bearer.statuses.find((status) => status.kind === 'foreknown') as
      | ForeknownStatus
      | undefined;
    if (!fore) return stifleDeclaration(this, item);
    bearer.statuses = bearer.statuses.filter((status) => status !== fore);
    this.log(`${item.label} is stopped before it begins.`);
    this.vfxSink?.godFx?.('sphere', bearer.pos, { size: bearer.bodyRadius() * 5 });
    const owner = this.mages[fore.ownerIndex] ?? bearer;
    dealDamage(
      this.quietContext(owner, bearer),
      bearer,
      dmg(this.showRoll(fore.spec, 'Foreknowledge', bearer).total, 'sanity'),
      { canMiss: false }
    );
    return true;
  }

  /**
   * Stillwater Ward: the next damage the bearer would take is stopped. The
   * bearer vanishes and the attacker is rooted. Returns true when it caught one.
   */
  consumeStillWard(attacker: Mage, bearer: Mage): boolean {
    const ward = bearer.statuses.find((status) => status.kind === 'stillWard') as
      | StillWardStatus
      | undefined;
    if (!ward) return false;
    bearer.statuses = bearer.statuses.filter((status) => status !== ward);
    const owner = this.mages[ward.ownerIndex] ?? bearer;
    this.log(`The still water around ${bearer.name} stops the blow.`);
    this.vfxSink?.combatFeedback?.(bearer, { kind: 'blocked', label: 'STILLED' });
    this.vfxSink?.godFx?.('sphere', bearer.pos, { size: bearer.bodyRadius() * 5 });
    applyInvisibility(this.quietContext(owner, bearer), bearer, { duration: 2, mode: 'full' });
    if (attacker !== bearer && attacker.alive) {
      applyStun(this.quietContext(owner, attacker), attacker, { duration: 2, type: 'movement' });
    }
    return true;
  }

  /** Frozen perception: `viewer` only sees bodies still standing where they stood. */
  perceptionFrozen(viewer: Mage, m: Mage): boolean {
    if (viewer === m) return false;
    const frozen = viewer.statuses.find((status) => status.kind === 'frozenPerception') as
      | FrozenPerceptionStatus
      | undefined;
    if (!frozen) return false;
    const seen = frozen.positions[this.mages.indexOf(m)];
    return !seen || dist(seen, m.pos) > 2 * RANGE_UNIT;
  }

  /** Take every enemy action of `team` off the stack; returns what was cancelled. */
  cancelHostileStack(team: number): StackItem[] {
    const cancelled: StackItem[] = [];
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const item = this.stack[i];
      if (item.source.team === team || item.windowTrigger) continue;
      this.stack.splice(i, 1);
      cancelled.push(item);
    }
    return cancelled;
  }

  /**
   * Undo `m`'s latest turn: back to where it stood, and the health and sanity it
   * had, when that turn began. Returns false when there is nothing to undo.
   */
  rewind(m: Mage, source: Mage): boolean {
    const snap = m.turnStartState;
    if (!snap || !m.alive) return false;
    if (!this.isImmovable(m) && !m.displacementImmune) {
      const origin = m.pos;
      const landing = this.nearestFreePosition(m, {
        x: Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, snap.x)),
        y: Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, snap.y)),
      });
      m.x = landing.x;
      m.y = landing.y;
      this.notifyMageRelocation(m, origin, m.pos, false);
      this.vfxSink?.blink?.(origin, m.pos, 0xff5599);
    }
    m.hp = Math.min(m.maxHp, Math.max(1, snap.hp));
    m.sanity = Math.min(m.maxSanity, Math.max(1, snap.sanity));
    this.log(`${m.name} is returned to the start of its turn.`);
    this.checkReapDeath(m, source);
    return true;
  }

  /** The dice a desecration law rolls this round. */
  private lawTicks(law: Desecration): DesecrationTick[] {
    const stages = law.stageTicks;
    if (!stages?.length) return law.ticks;
    return stages[Math.min(law.stage ?? 0, stages.length - 1)];
  }

  /** Whether a corpse was fair game for desecration while it lived. */
  private wasDesecrationAffected(m: Mage): boolean {
    return !this.isMinion(m) && m.profile.primary !== 'black';
  }

  /** Walk a corpse upright for `owner`, once per body. */
  raiseThrall(corpse: Mage, owner: Mage): Mage | null {
    if (corpse.alive || corpse.isSummon || this.raisedCorpses.has(corpse) || !owner.alive) return null;
    this.raisedCorpses.add(corpse);
    const risen = this.raiseRemnant(corpse, owner);
    this.log(`${corpse.name} rises as ${risen.name}.`);
    this.vfxSink?.godFx?.('skull', corpse.pos, { size: corpse.bodyRadius() * 5 });
    return risen;
  }

  /** A body that dies on bursting ground showers the unhallowed around it. */
  private burstCorpse(victim: Mage, owner: Mage, field: DesecrationField): void {
    const burst = field.burstOnDeath;
    if (!burst) return;
    const struck = this.magesInRadius(victim.pos, burst.radius, victim).filter((m) =>
      this.isDesecrationAffected(m)
    );
    this.log(`${victim.name} bursts.`);
    this.vfxSink?.godFx?.('skull', victim.pos, { size: burst.radius * 2 });
    if (struck.length === 0) return;
    const amount = this.showRoll(burst.spec, `${field.name} burst`).total;
    for (const m of struck) {
      if (!m.alive) continue;
      dealDamage(this.quietContext(owner, m), m, dmg(amount, burst.type), { canMiss: false, aoe: true });
    }
  }

  /** Collapsing ground crushes the unhallowed still inside when it runs out. */
  private collapseDesecrationField(field: DesecrationField): void {
    const collapse = field.collapse;
    if (!collapse) return;
    const centre = { x: field.x, y: field.y };
    const crushed = this.mages.filter(
      (m) => this.isDesecrationAffected(m) && dist(m.pos, centre) <= field.radius
    );
    this.vfxSink?.godFx?.('implode', centre, { size: field.radius * 2.4 });
    if (crushed.length === 0) return;
    const owner = this.mages[field.ownerIndex] ?? crushed[0];
    const amount = this.showRoll(collapse.spec, `${field.name} closes`).total;
    for (const m of crushed) {
      if (!m.alive) continue;
      dealDamage(this.quietContext(owner, m), m, dmg(amount, collapse.type), { canMiss: false, aoe: true });
    }
  }

  /** Crawling ground creeps toward the nearest unhallowed unit. */
  private crawlDesecrationField(field: DesecrationField, px: number): void {
    if (field.carrierIndex != null) return;
    const centre = { x: field.x, y: field.y };
    const prey = this.mages
      .filter((m) => this.isDesecrationAffected(m))
      .sort((a, b) => dist(a.pos, centre) - dist(b.pos, centre))[0];
    if (!prey) return;
    const to = stepTowards(centre, prey.pos, px);
    field.x = Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, to.x));
    field.y = Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, to.y));
  }

  /** Carried desecration travels with its carrier. */
  private carryDesecration(mover: Mage): void {
    if (this.desecrationFields.length === 0) return;
    const index = this.mages.indexOf(mover);
    for (const field of this.desecrationFields) {
      if (field.carrierIndex !== index) continue;
      field.x = mover.x;
      field.y = mover.y;
    }
  }

  /** Profane thorns bill every unhallowed unit for the ground it covered this turn. */
  private applyThorns(m: Mage): void {
    if (!m.alive || !m.turnStartState || !this.isDesecrationAffected(m)) return;
    const travelled = dist(m.pos, m.turnStartState);
    for (const law of this.desecrations) {
      const thorns = law.thorns;
      if (!thorns || !m.alive) continue;
      const dice = Math.min(thorns.maxDice, Math.floor(travelled / thorns.pxPerDie));
      if (dice <= 0) continue;
      const sides = thorns.sides[Math.min(law.stage ?? 0, thorns.sides.length - 1)];
      const owner = this.mages[law.ownerIndex] ?? m;
      const amount = this.showRoll(`${dice}d${sides}`, law.name, m).total;
      dealDamage(this.quietContext(owner, m), m, dmg(amount, thorns.type), {
        canMiss: false,
        aoe: true,
        cause: law.name,
      });
    }
  }

  /** Whether `m` carries anything Black Bell or Shadow Shatter Curse can condense. */
  hasCondensableAffliction(m: Mage): boolean {
    return m.statuses.some((status) => this.blackBellConsumes(status));
  }

  /**
   * Chalice of Clear Water: pay the gear's mana toll to strip every affliction
   * from `m`. Veils and stealth survive; wards and buffs are washed away with
   * the rest. Returns false when the toll cannot be paid.
   */
  cleanseAfflictions(m: Mage): boolean {
    const cost = m.cleanseManaCost();
    if (cost == null || m.mana < cost) return false;
    m.spendMana(cost);
    const before = m.statuses.length;
    m.statuses = m.statuses.filter(
      (status) => status.kind === 'invisibility' || status.kind === 'shadowVeil' || status.kind === 'imbue'
    );
    const washed = before - m.statuses.length;
    if (m.venomStacks > 0) {
      m.venomStacks = 0;
      m.venomDistance = 0;
      m.venomSource = undefined;
      this.log(`${m.name} washes away the spider venom.`);
    }
    this.syncCurseCorrodeSlow(m);
    this.log(
      washed > 0
        ? `${m.name} drinks deep and washes away ${washed} affliction${washed === 1 ? '' : 's'} for ${cost} mana.`
        : `${m.name} drinks deep for ${cost} mana, but carries nothing to wash away.`
    );
    return true;
  }

  /** Age a Lich life-link on `m`; drop it when it expires or its Lich dies. */
  private tickDrainLink(m: Mage): void {
    if (!m.drainLinkTo) return;
    if (!m.drainLinkTo.alive || m.drainLinkTurns <= 0) {
      m.drainLinkTo = undefined;
      m.drainLinkTurns = 0;
      return;
    }
    m.drainLinkTurns -= 1;
    if (m.drainLinkTurns <= 0) {
      this.log(`The life-link on ${m.name} frays and breaks.`);
      m.drainLinkTo = undefined;
    }
  }

  /** Resolve effects that expire after the acting mage finishes one turn. */
  finishCurrentTurn(): void {
    const current = this.current;
    if (current.deathsAngelFlightTurns > 0) {
      current.deathsAngelFlightTurns -= 1;
      if (current.deathsAngelFlightTurns === 0) {
        this.log(`${current.name}'s deathly wings fold away.`);
      }
    }
    this.advancePetrification(current);
    this.applyThorns(current);
    lawTurnEnd(this, current);
    this.resumeTimeAfterTurn(current);
  }

  endTurn(): void {
    this.finishCurrentTurn();
    // Age an active control swap; then activate any swap queued this turn.
    if (this.mindSwapTurns > 0) this.mindSwapTurns -= 1;
    if (this.pendingMindSwap > 0) {
      this.mindSwapTurns = this.pendingMindSwap;
      this.pendingMindSwap = 0;
    }
    this.advanceTurn();
  }

  /**
   * Step to the next living mage in initiative order. Whenever the pointer
   * wraps past the end of the order a new round begins (shadows/totems tick).
   * Dead mages are skipped.
   */
  private advanceTurn(): void {
    const n = this.initiativeOrder.length;
    if (n === 0) return;
    // The turn being left ends here, so any banked pierce echoes land now.
    this.flushPierceEchoes(this.current);
    for (let step = 0; step < n; step++) {
      this.turnPtr += 1;
      if (this.turnPtr >= n) {
        this.turnPtr = 0;
        this.round += 1;
        lawRoundEnd(this);
        this.tickShadows();
        this.tickTotems();
        this.tickBarriers();
        this.hatchSpiderEggs();
        this.tickGlobalEscalations();
        this.tickNeedlepointDomains();
        this.tickHexcraftGlobals();
        this.tickVeilBindZones();
        this.tickCorrosionPools();
        this.tickFeedingDarks();
        this.tickRottingDarks();
        this.tickHazardZones();
        this.tickDesecrations();
        this.startRound();
      }
      const idx = this.initiativeOrder[this.turnPtr];
      if (this.mages[idx]?.alive) {
        this.currentIndex = idx;
        return;
      }
    }
    // Everyone else is dead — leave currentIndex as-is (match is over).
  }

  /** Whether control is currently swapped between the two players. */
  get controlSwapped(): boolean {
    return this.mindSwapTurns > 0;
  }

  /** Queue an extra turn for `m`, taken immediately after the current one. */
  grantExtraTurn(m: Mage): void {
    this.extraTurnQueue.push(m);
  }

  /**
   * Regenerate a mage's mana & color-charges for its starting turn, scoring any
   * allied summons (scarabs) lost since its previous turn for black's regen and
   * its own living summons for white's.
   */
  private regenResources(m: Mage): void {
    const alive = this.scarabs.filter((s) => s.owner === m.team && scarabAlive(s)).length;
    const deaths = Math.max(0, (this.prevScarabAlive[m.team] ?? alive) - alive);
    const idx = this.mages.indexOf(m);
    const ownScarabs = this.scarabs.filter(
      (s) => scarabAlive(s) && (s.ownerIndex != null ? s.ownerIndex === idx : s.owner === m.team)
    ).length;
    m.regen({ summonDeaths: deaths, summonsAlive: this.summonsOf(m).length + ownScarabs });
    this.prevScarabAlive[m.team] = alive;
  }

  /** Register a board-wide escalating damage effect (Necrosis). */
  addGlobalEscalation(opts: Omit<GlobalEscalation, 'index'>): void {
    this.globalEscalations.push({ ...opts, index: 0 });
    this.log(`A creeping ${opts.name.toLowerCase()} takes hold of the duel.`);
  }

  /** Advance every global escalation one stage, damaging all living mages. */
  private tickGlobalEscalations(): void {
    if (this.globalEscalations.length === 0) return;
    for (const e of this.globalEscalations) {
      const spec = e.stages[e.index];
      if (!spec) continue;
      for (const m of this.mages) {
        if (!m.alive) continue;
        const amount = Math.round(this.rng.roll(spec).total * e.potency);
        const ctx = this.effectContext(m, m, null);
        dealDamage(ctx, m, dmg(amount, e.type), { canMiss: false, aoe: true });
      }
      e.index += 1;
    }
    this.globalEscalations = this.globalEscalations.filter((e) => e.index < e.stages.length);
  }

  /** Establish or refresh one team's battlefield-wide Needlepoint Domain. */
  addNeedlepointDomain(owner: number, rounds = 8): void {
    this.needlepointDomains = this.needlepointDomains.filter((domain) => domain.owner !== owner);
    this.needlepointDomains.push({ owner, roundsLeft: rounds, lastTriggeredTurnByMage: {} });
    this.log('Needlepoint Domain fixes every destination beneath an unseen needle.');
  }

  /** Age Needlepoint Domains on round rollover. */
  private tickNeedlepointDomains(): void {
    for (const domain of this.needlepointDomains) domain.roundsLeft -= 1;
    const ended = this.needlepointDomains.filter((domain) => domain.roundsLeft <= 0);
    if (ended.length > 0) this.log('The Needlepoint Domain releases its hold on the battlefield.');
    this.needlepointDomains = this.needlepointDomains.filter((domain) => domain.roundsLeft > 0);
  }

  /**
   * Resolve destination-runes after any reposition. Each enemy is struck only
   * once per turn sequence, even if several movement effects move it again.
   */
  triggerNeedlepointDomains(mover: Mage): void {
    if (!mover.alive) return;
    const mageIndex = this.mages.indexOf(mover);
    if (mageIndex < 0) return;
    for (const domain of this.needlepointDomains) {
      if (domain.owner === mover.team) continue;
      if (domain.lastTriggeredTurnByMage[mageIndex] === this.turnSeq) continue;
      domain.lastTriggeredTurnByMage[mageIndex] = this.turnSeq;
      const caster = this.mages.find((mage) => mage.alive && mage.team === domain.owner);
      if (!caster) continue;
      const ctx = this.effectContext(caster, mover, mover.pos);
      dealDamage(ctx, mover, dmg(this.rng.roll('1d4').total, 'pierce'), {
        canMiss: false,
      });
      if (mover.alive) applyStun(ctx, mover, { duration: 1, type: 'movement' });
      this.log(`${mover.name}'s destination is nailed by the Needlepoint Domain.`);
    }
    for (const orb of this.redOrbs) {
      if (dist(mover.pos, orb) > orb.radius) continue;
      const owner = this.mages[orb.ownerIndex];
      if (!owner?.alive) continue;
      const ctx = this.effectContext(owner, mover, mover.pos);
      dealDamage(ctx, mover, dmg(this.rng.roll('1d3').total, 'typeless'), {
        canMiss: false,
        trueDamage: true,
      });
      if (mover.alive) {
        applyDebuff(ctx, mover, {
          name: 'Orb Static',
          key: 'debuff:red-orb-slow',
          duration: 2,
          mods: { moveRange: -Math.round(MOVE_RANGE * 0.5) },
        });
      }
      this.log(`${mover.name} is zapped inside the red orb.`);
    }
  }

  addRedOrb(at: Vec2, owner: Mage): void {
    const ownerIndex = this.mages.indexOf(owner);
    this.redOrbs = this.redOrbs.filter((orb) => orb.ownerIndex !== ownerIndex);
    this.redOrbs.push({
      id: this.nextId++,
      x: Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, at.x)),
      y: Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, at.y)),
      radius: 3 * RANGE_UNIT,
      ownerIndex,
    });
    this.log(`${owner.name} forms a crackling red orb.`);
  }

  /** Establish or refresh a battlefield-wide Hexcraft law without stacking it. */
  addHexcraftGlobal(kind: HexcraftGlobalKind, owner: number, roundsLeft: number, caster?: Mage): void {
    this.hexcraftGlobals = this.hexcraftGlobals.filter((effect) => effect.kind !== kind);
    this.hexcraftGlobals.push({
      kind,
      owner,
      roundsLeft,
      ownerIndex: caster ? this.mages.indexOf(caster) : undefined,
    });
    this.log(
      kind === 'mindShadow'
        ? 'Mind Shadow deepens every shadow and every wound to sanity.'
        : kind === 'curseCorrode'
          ? 'Curse Corrode infects every lingering affliction with universal decay.'
          : `${HEX_LAW_NAMES[kind]} takes hold of the field for ${roundsLeft} rounds.`
    );
    if (kind === 'curseCorrode' || kind === 'curseOfThirst') {
      for (const mage of this.mages) this.syncCurseCorrodeSlow(mage);
    }
  }

  /** The standing law of `kind`, if one holds the field. */
  hexLaw(kind: HexLawKind): HexcraftGlobalEffect | undefined {
    return this.hexcraftGlobals.find((effect) => effect.kind === kind && effect.roundsLeft > 0);
  }

  lawBeforeHit(ctx: EffectContext, target: Mage, damage: DamageInstance, opts: DealDamageOptions, targetVeiled: boolean): LawPrep {
    return lawBeforeHit(ctx, target, damage, opts, targetVeiled);
  }

  lawAfterHit(ctx: EffectContext, target: Mage, type: DamageType, dealt: number, targetVeiled: boolean): void {
    lawAfterHit(ctx, target, type, dealt, targetVeiled);
  }

  lawBlocksHealing(target: Mage): boolean {
    return this.hexcraftGlobals.length > 0 && lawBlocksHealing(this, target);
  }

  /** Death's rites may refuse a death that just landed: true leaves `target` standing. */
  cheatDeath(target: Mage, source: Mage): boolean {
    return cheatDeath(this, target, source);
  }

  /** A Fetch and its original share their wounds. */
  echoFetch(source: Mage, target: Mage, type: DamageType, amount: number): void {
    echoFetch(this, source, target, type, amount);
  }

  lawBlocksRoot(target: Mage): boolean {
    return this.hexcraftGlobals.length > 0 && lawBlocksRoot(this, target);
  }

  lawVeilBlocked(target: Mage): boolean {
    return this.hexcraftGlobals.length > 0 && lawVeilBlocked(this, target);
  }

  lawVeilDuration(turns: number): number {
    return this.hexcraftGlobals.length > 0 ? lawVeilDuration(this, turns) : turns;
  }

  lawVeilHolds(target: Mage): boolean {
    return this.hexcraftGlobals.length > 0 && lawVeilHolds(this, target);
  }

  lawOnVeilGained(ctx: EffectContext, target: Mage): void {
    if (this.hexcraftGlobals.length > 0) lawOnVeilGained(ctx, target);
  }

  lawOnRoot(ctx: EffectContext, target: Mage, already = false): void {
    lawOnRoot(ctx, target, already);
  }

  lawOnVeilBroken(ctx: EffectContext, target: Mage): void {
    lawOnVeilBroken(ctx, target);
  }

  /** `mover` just dashed: the laws that answer a dash. Moves the laws make themselves set nothing off. */
  lawDashed(mover: Mage): void {
    if (this.hexLawDepth === 0 && this.hexcraftGlobals.length > 0) lawOnDash(this, mover);
  }

  imbueOnDamaged(target: Mage, dealt: number, dot = false): void {
    if (target.enemyKind === 'crusadeHelper') return;
    if (dealt > 0 && target.statuses.some((s) => s.kind === 'imbue')) imbueOnDamaged(this, target, dealt, dot);
    if (dealt > 0 && target.summonKind) minionStruck(this, target, dealt);
    if (dealt > 0 && target.statuses.some((s) => s.kind === 'debuff' && (s.key === 'debuff:hex-mark' || s.hexEcho))) hexStruck(this, target);
  }

  /** Keep Curse Corrode's (and Curse of Thirst's) 75% slow exactly as long as the bearer's longest DoT. */
  syncCurseCorrodeSlow(mage: Mage): void {
    const key = 'debuff:curse-corrode-slow';
    const existing = mage.statuses.find((status) => status.key === key);
    const dots = mage.statuses.filter(
      (status) => status.kind === 'dot' || status.kind === 'auraDot'
    );
    if (dots.length === 0) {
      mage.statuses = mage.statuses.filter((status) => status.key !== key);
      return;
    }
    if (!existing && !this.hasHexcraftGlobal('curseCorrode') && !this.hasHexcraftGlobal('curseOfThirst')) return;
    const duration = Math.max(...dots.map((status) => status.duration));
    const slow = {
      key,
      name: 'Curse Corrode Slow',
      kind: 'debuff' as const,
      duration,
      mods: { moveRange: -Math.round(MOVE_RANGE * 0.75) },
    };
    if (existing) Object.assign(existing, slow);
    else mage.statuses.push(slow);
  }

  hasHexcraftGlobal(kind: HexcraftGlobalKind): boolean {
    return this.hexcraftGlobals.some((effect) => effect.kind === kind && effect.roundsLeft > 0);
  }

  /** Mind Shadow adds one global amplification to shadow and sanity damage. */
  hexcraftDamageBonus(type: DamageType): number {
    return this.hasHexcraftGlobal('mindShadow') && (type === 'shadow' || type === 'sanity')
      ? 2
      : 0;
  }

  private tickHexcraftGlobals(): void {
    for (const effect of this.hexcraftGlobals) effect.roundsLeft -= 1;
    const ended = this.hexcraftGlobals.filter((effect) => effect.roundsLeft <= 0);
    for (const effect of ended) {
      this.log(
        effect.kind === 'mindShadow'
          ? 'The global Mind Shadow thins away.'
          : effect.kind === 'curseCorrode'
            ? 'The global Curse Corrode finally loses its purchase.'
            : `${isHexLawKind(effect.kind) ? HEX_LAW_NAMES[effect.kind] : effect.kind} no longer holds the field.`
      );
    }
    this.hexcraftGlobals = this.hexcraftGlobals.filter((effect) => effect.roundsLeft > 0);
    for (const effect of ended) if (isHexLawKind(effect.kind)) deathLawEnds(this, effect.kind, this.mages[effect.ownerIndex ?? -1]);
  }

  /** Place a range-5 Veil Bind circle, replacing this team's previous circle. */
  addVeilBindZone(at: Vec2, owner: number, roundsLeft = 8): VeilBindZone {
    this.veilBindZones = this.veilBindZones.filter((zone) => zone.owner !== owner);
    const zone: VeilBindZone = {
      id: this.nextId++,
      x: Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, at.x)),
      y: Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, at.y)),
      radius: 5 * RANGE_UNIT,
      owner,
      roundsLeft,
    };
    this.veilBindZones.push(zone);
    this.log('A Veil Bind circle stitches concealment to restraint.');
    return zone;
  }

  isInVeilBindZone(mage: Mage): boolean {
    return this.veilBindZones.some(
      (zone) => dist(mage.pos, { x: zone.x, y: zone.y }) <= zone.radius
    );
  }

  private tickVeilBindZones(): void {
    for (const zone of this.veilBindZones) zone.roundsLeft -= 1;
    if (this.veilBindZones.some((zone) => zone.roundsLeft <= 0)) {
      this.log('A Veil Bind circle unravels.');
    }
    this.veilBindZones = this.veilBindZones.filter((zone) => zone.roundsLeft > 0);
  }

  /** Trigger every Bind Curse aura carried by the mage whose turn is starting. */
  private applyBindCurseAuras(bearer: Mage): void {
    const auras = bearer.statuses.filter(
      (status) => status.kind === 'bindCurseAura'
    ) as BindCurseAuraStatus[];
    for (const aura of auras) {
      const owner = this.mages[aura.ownerIndex] ?? bearer;
      const ctx = this.effectContext(owner, bearer, bearer.pos);
      let boundAny = false;
      for (let index = 0; index < this.mages.length; index++) {
        const enemy = this.mages[index];
        if (!enemy.alive || enemy.team === bearer.team) continue;
        if (dist(enemy.pos, bearer.pos) > aura.radius + enemy.bodyRadius()) continue;
        if ((aura.boundCounts[index] ?? 0) >= 2) continue;
        if (enemy.isDebuffImmune() || this.isLaranegUntouchable(enemy)) continue;
        applyStun(ctx, enemy, { duration: 2, type: 'movement' });
        aura.boundCounts[index] = (aura.boundCounts[index] ?? 0) + 1;
        boundAny = true;
      }
      if (boundAny) {
        applyStun(ctx, bearer, { duration: 2, type: 'movement' });
        this.log(`${bearer.name}'s binding aura catches its bearer in the same knot.`);
      }
    }
  }

  /** Remaining turns of any active stealth effect that an attack can consume. */
  stealthDuration(mage: Mage): number {
    if (this.hasDeathMark(mage)) return 0;
    const invisibility = this.effectiveInvisibility(mage);
    const shadowVeil = mage.statuses.find((status) => status.kind === 'shadowVeil');
    return Math.max(
      invisibility?.duration ?? 0,
      shadowVeil && this.isInShadow(mage) ? shadowVeil.duration : 0
    );
  }

  /** Hidden by ANY form of stealth — a veil, a Shadow Veil in shadow, or the dagger. */
  isVeiled(mage: Mage): boolean {
    return this.stealthDuration(mage) > 0;
  }

  /** Arm an invisible mage to turn the veil lost on its next attack into damage. */
  armVeilCorrodePierce(mage: Mage): void {
    const duration = this.stealthDuration(mage);
    if (duration <= 0) return;
    addOrExtendStatus(
      mage.statuses,
      {
        key: 'buff:veil-corrode-pierce',
        name: 'Veil Corrode Pierce',
        kind: 'veilCorrodePierce',
        duration,
      },
      false
    );
    this.log(`${mage.name}'s remaining veil is honed into a corrosive point.`);
  }

  /** Remove an attacker's veil and return the armed damage die size, capped at d7. */
  prepareVeilCorrodePierce(attacker: Mage): number {
    const armed = attacker.statuses.some((status) => status.kind === 'veilCorrodePierce');
    if (!armed) return 0;
    const power = Math.min(7, this.stealthDuration(attacker));
    attacker.statuses = attacker.statuses.filter(
      (status) =>
        status.kind !== 'invisibility' &&
        status.kind !== 'shadowVeil' &&
        status.kind !== 'veilCorrodePierce'
    );
    if (power > 0) this.log(`${attacker.name} breaks a ${power}-turn veil into an attack.`);
    return power;
  }

  /** Deal the two damage halves released by Veil Corrode Pierce. */
  resolveVeilCorrodePierce(attacker: Mage, target: Mage, power: number): void {
    if (power <= 0 || !target.alive) return;
    const ctx = this.effectContext(attacker, target, target.pos);
    dealDamage(ctx, target, dmg(this.rng.roll(`1d${power}`).total, 'corrosive'), {
      canMiss: false,
    });
    if (target.alive) {
      dealDamage(ctx, target, dmg(this.rng.roll(`1d${power}`).total, 'pierce'), {
        canMiss: false,
      });
    }
  }

  /** Pop the next queued extra-turn mage, if any. */
  takeExtraTurn(): Mage | null {
    return this.extraTurnQueue.shift() ?? null;
  }

  /** Make `m` the current mage without a round rollover (for extra turns). */
  setCurrent(m: Mage): void {
    const idx = this.mages.indexOf(m);
    if (idx >= 0) this.currentIndex = idx;
  }

  // ---- Sand -----------------------------------------------------------------

  /**
   * Lay `charges` of sand. Sand is unowned: it is terrain, not a claim, so
   * either side can build on a pile the other one made. Drops that land on an
   * existing pile merge into it rather than stacking a second disc.
   */
  addSand(at: Vec2, charges = 1): SandPatch {
    const x = Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, at.x));
    const y = Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, at.y));
    const existing = this.sand.find((patch) => dist({ x, y }, { x: patch.x, y: patch.y }) <= patch.radius);
    if (existing) {
      existing.charges += Math.max(0, charges);
      return existing;
    }
    const patch: SandPatch = { id: this.nextId++, x, y, radius: SAND_RADIUS, charges: Math.max(0, charges) };
    this.sand.push(patch);
    return patch;
  }

  /** Every pile whose disc covers `at`, richest first. */
  private sandPilesAt(at: Vec2): SandPatch[] {
    return this.sand
      .filter((patch) => dist(at, { x: patch.x, y: patch.y }) <= patch.radius)
      .sort((a, b) => b.charges - a.charges || a.id - b.id);
  }

  /** How many charges of sand are available at `at`. */
  sandChargesAt(at: Vec2): number {
    return this.sandPilesAt(at).reduce((sum, patch) => sum + patch.charges, 0);
  }

  /** Consume up to `count` charges at `at`; returns how many were actually spent. */
  spendSandAt(at: Vec2, count: number): number {
    let left = Math.max(0, count);
    let spent = 0;
    for (const patch of this.sandPilesAt(at)) {
      if (left <= 0) break;
      const take = Math.min(patch.charges, left);
      patch.charges -= take;
      left -= take;
      spent += take;
    }
    this.sand = this.sand.filter((patch) => patch.charges > 0);
    return spent;
  }

  /** Shift up to `count` charges from one point to another; returns how many moved. */
  moveSand(from: Vec2, to: Vec2, count: number): number {
    const moved = this.spendSandAt(from, count);
    if (moved > 0) this.addSand(to, moved);
    return moved;
  }

  /** True where sand lies — always true in a desert, which is the whole point. */
  isSandAt(pos: Vec2): boolean {
    if (this.desertArena) return true;
    return this.sandPilesAt(pos).length > 0;
  }

  /** Whether a caster has sand to work with, at its feet or at what it is aiming at. */
  hasSandFor(source: Mage, at?: Vec2 | null): boolean {
    return this.isSandAt(source.pos) || (!!at && this.isSandAt(at));
  }

  // ---- Shadows --------------------------------------------------------------

  /** Place a shadow zone (clamped to the field) owned by `owner`. */
  addShadow(at: Vec2, owner: number, ttl?: number): ShadowZone {
    const zone: ShadowZone = {
      id: this.nextId++,
      x: Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, at.x)),
      y: Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, at.y)),
      radius: SHADOW_RADIUS,
      owner,
      ttl: ttl ?? SHADOW_TTL,
    };
    this.shadows.push(zone);
    return zone;
  }

  /** Age every shadow by one round, removing any that have faded. */
  tickShadows(): void {
    for (const s of this.shadows) s.ttl -= 1;
    const faded = this.shadows.filter((s) => s.ttl <= 0);
    if (faded.length) this.log(`${faded.length} shadow${faded.length > 1 ? 's' : ''} fade away.`);
    this.shadows = this.shadows.filter((s) => s.ttl > 0);
  }

  shadowsOf(team: number): ShadowZone[] {
    return this.allShadows().filter((s) => s.owner === team);
  }
  /** The shadow zone containing `pos`, if any. */
  shadowAt(pos: Vec2): ShadowZone | undefined {
    return this.allShadows().find((s) => dist(pos, { x: s.x, y: s.y }) <= s.radius);
  }

  /** Conjured pools plus every active Edgelord dark light, which counts as shadow. */
  private allShadows(): ShadowZone[] {
    const extra: ShadowZone[] = [];
    this.mages.forEach((mage, index) => {
      if (!mage.alive) return;
      if (mage.hasEdgelordLantern() && mage.edgelordLanternActive) {
        // Negative ids keep synthetic zones distinct from conjured pools.
        extra.push({
          id: -(index + 1),
          x: mage.x,
          y: mage.y,
          radius: EDGELORD_DARK_LIGHT_RADIUS,
          owner: mage.team,
          ttl: Infinity,
        });
      }
      const shade = mage.statuses.find((status) => status.kind === 'woundShade') as
        | WoundShadeStatus
        | undefined;
      if (shade) {
        extra.push({
          id: -(this.mages.length + index + 1),
          x: mage.x,
          y: mage.y,
          radius: shade.radius,
          owner: shade.ownerTeam,
          ttl: shade.duration,
        });
      }
    });
    return extra.length > 0 ? [...this.shadows, ...extra] : this.shadows;
  }

  /** Whether a mage is currently standing in any shadow. */
  isInShadow(m: Mage): boolean {
    return !!this.shadowAt(m.pos);
  }

  /** Charge 1 mana when the holder's turn begins; covers stealth until their next turn. */
  private applyShadowDaggerUpkeep(mage: Mage): void {
    const traits = mage.shadowDaggerTraits();
    if (
      !mage.alive ||
      !traits ||
      !this.isInShadow(mage) ||
      mage.shadowDaggerStealthRound === this.round ||
      mage.mana < traits.stealthManaPerRound
    ) return;
    mage.spendMana(traits.stealthManaPerRound);
    mage.shadowDaggerStealthRound = this.round;
  }

  /** Pay the dagger's unrestricted cursed toll and teleport between shadows. */
  useShadowDagger(source: Mage, point: Vec2): boolean {
    const traits = source.shadowDaggerTraits();
    const destination = this.shadowAt(point);
    if (!traits || !source.alive || !this.isInShadow(source) || !destination) return false;
    const wasAlive = source.alive;
    const unpaid = source.hasMana(traits.teleportManaCost)
      ? 0
      : Math.max(0, traits.teleportManaCost - source.mana);
    source.spendMana(traits.teleportManaCost);
    for (let pointLost = 0; pointLost < unpaid && source.alive; pointLost++) {
      source.loseRandomPermanentStat(this.rng);
    }
    if (wasAlive && !source.alive) {
      this.notifyMageDefeated(source, source);
      return false;
    }
    teleport(this.effectContext(source, source, null), source, {
      x: destination.x,
      y: destination.y,
    });
    return true;
  }

  /**
   * Can `source` reach `point` within `range`, either directly or by casting
   * from / bouncing through one of its own shadows?
   */
  withinCastRange(source: Mage, point: Vec2, range: number): boolean {
    if (this.hasPhantomReach(source)) return true;
    if (dist(source.pos, point) <= range) return true;
    return this.shadowsOf(source.team).some((s) => dist({ x: s.x, y: s.y }, point) <= range);
  }

  // ---- Totems & auras -------------------------------------------------------

  /** Place a damaging totem owned by `owner`. */
  addTotem(
    at: Vec2,
    owner: number,
    opts: { radius: number; damageSpec: string; slow: number; ttl?: number; lifesteal?: boolean; ownerIndex?: number }
  ): Totem {
    const totem: Totem = {
      id: this.nextId++,
      x: Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, at.x)),
      y: Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, at.y)),
      radius: opts.radius,
      owner,
      ownerIndex: opts.ownerIndex,
      ttl: opts.ttl ?? TOTEM_TTL,
      damageSpec: opts.damageSpec,
      slow: opts.slow,
      lifesteal: opts.lifesteal,
    };
    this.totems.push(totem);
    return totem;
  }

  /** Age every totem by one round, removing any that have crumbled. */
  tickTotems(): void {
    for (const t of this.totems) t.ttl -= 1;
    const gone = this.totems.filter((t) => t.ttl <= 0);
    if (gone.length) this.log(`${gone.length} totem${gone.length > 1 ? 's' : ''} crumble away.`);
    this.totems = this.totems.filter((t) => t.ttl > 0);
  }

  /** Damage + slow `m` if it begins its turn inside an enemy totem's aura. */
  private applyTotemAuras(m: Mage): void {
    if (!m.alive) return;
    for (const t of this.totems) {
      if (t.owner === m.team) continue;
      if (dist(m.pos, { x: t.x, y: t.y }) > t.radius) continue;
      // Heal the actual caster (ownerIndex) for lifesteal; fall back to any
      // living team-mate only if the caster is gone.
      const caster = t.ownerIndex != null ? this.mages[t.ownerIndex] : undefined;
      const owner = (caster && caster.alive ? caster : this.mages.find((g) => g.team === t.owner)) ?? m;
      const ctx = this.effectContext(owner, m, null);
      const amount = this.rng.roll(t.damageSpec).total;
      if (t.lifesteal && owner !== m) {
        drainDamage(ctx, m, dmg(amount, 'corrosive'), { canMiss: false });
      } else {
        dealDamage(ctx, m, dmg(amount, 'corrosive'), {
          canMiss: false,
          noImpactFx: true,
        });
      }
      if (t.slow > 0) {
        addOrExtendStatus(
          m.statuses,
          {
            key: 'debuff:Mired',
            name: 'Mired',
            kind: 'debuff',
            duration: 2,
            mods: { moveRange: -Math.round(MOVE_RANGE * t.slow) },
          },
          false
        );
      }
    }
  }

  // ---- Scarabs --------------------------------------------------------------

  /** Fire statuses and authored fire creatures destroy a Scarab on contact. */
  private isScarabFireHazard(target: Mage): boolean {
    const burning = target.statuses.some(
      (status) =>
        (status.kind === 'fire' || status.kind === 'sentinelFire') && status.stacks > 0
    );
    const kind = target.mine?.kind;
    return (
      burning ||
      target.intrinsicMelee?.type === 'heat' ||
      kind === 'sentinel' ||
      kind === 'magma-sentinel' ||
      kind === 'red-dragonborn'
    );
  }

  /** Destroy living Scarabs without damage rolls or mitigation. */
  private destroyScarabsByFire(scarabs: readonly Scarab[], where: string): number {
    let destroyed = 0;
    for (const scarab of scarabs) {
      if (!scarabAlive(scarab)) continue;
      scarab.hp = 0;
      destroyed += 1;
    }
    if (destroyed === 0) return 0;
    this.scarabs = this.scarabs.filter(scarabAlive);
    this.log(
      destroyed === 1
        ? `A scarab burns up${where}.`
        : `${destroyed} scarabs burn up${where}.`
    );
    return destroyed;
  }

  /** Incinerate every Scarab currently attached to a newly burning target. */
  private destroyAttachedScarabsByFire(target: Mage): void {
    this.destroyScarabsByFire(
      this.scarabs.filter((scarab) => scarab.state === 'attached' && scarab.target === target),
      ` on ${target.name}`
    );
  }

  /** Spawn `count` scarabs scattered around `center`, owned by team `owner`. */
  addScarabs(center: Vec2, owner: number, count: number, ownerIndex?: number): void {
    for (let i = 0; i < count; i++) {
      const ang = (this.rng.die(360) - 1) * (Math.PI / 180);
      const r = SCARAB.spawnRadius * (0.35 + 0.65 * ((this.rng.die(100) - 1) / 99));
      const x = Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, center.x + Math.cos(ang) * r));
      const y = Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, center.y + Math.sin(ang) * r));
      this.scarabs.push({
        id: this.nextId++,
        x,
        y,
        owner,
        ownerIndex,
        hp: SCARAB.hp,
        maxHp: SCARAB.hp,
        sanity: SCARAB.sanity,
        maxSanity: SCARAB.sanity,
        state: 'seeking',
        target: null,
      });
      this.vfxSink?.summonPuff?.({ x, y }, 30);
    }
  }

  /** Move a scarab toward `to` by `step`, never straying past its leash. */
  private creepScarab(s: Scarab, to: Vec2, step: number, anchor: Vec2): void {
    const dest = stepTowards({ x: s.x, y: s.y }, to, step);
    let fx = dest.x;
    let fy = dest.y;
    if (dist(anchor, dest) > SCARAB.leash) {
      const clamped = stepTowards(anchor, dest, SCARAB.leash);
      fx = clamped.x;
      fy = clamped.y;
    }
    s.x = Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, fx));
    s.y = Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, fy));
  }

  /** Advance every scarab owned by `owner` by one step of its behaviour. */
  private tickScarabs(owner: Mage): void {
    const idx = this.mages.indexOf(owner);
    // Each scarab acts once per round — on its own summoner's turn — so it always
    // orbits the mage that summoned it rather than merely its team's first mage.
    const mine = this.scarabs.filter(
      (s) => scarabAlive(s) && (s.ownerIndex != null ? s.ownerIndex === idx : s.owner === owner.team)
    );
    if (mine.length === 0) return;
    const anchor = owner.pos;
    const moveStep = SCARAB.moveStep * (owner.redSummonHaste ? 2 : 1);
    const enemies = this.mages.filter((g) => g.team !== owner.team && g.alive);

    // How many scarabs already hound each enemy (for the per-enemy cap).
    const load = new Map<Mage, number>();
    for (const s of mine) {
      if (s.target && (s.state === 'seeking' || s.state === 'attached')) {
        load.set(s.target, (load.get(s.target) ?? 0) + 1);
      }
    }

    for (const s of mine) {
      // ON THE SUMMONER (resting): this turn it flies straight back out — from a
      // standstill on the caster it seeks the nearest foe, reaching (and
      // attaching to) it in one go when close enough.
      if (s.state === 'resting') {
        s.state = 'seeking';
        s.target = null;
      }

      if (s.state === 'attached') {
        const tgt = s.target;
        if (tgt && tgt.alive) {
          // Latched on the victim — bite before flying home.
          s.x = tgt.x;
          s.y = tgt.y;
          const ctx = this.effectContext(owner, tgt, null);
          const amount = this.rng.roll(SCARAB.attackSpec).total;
          const dealt = dealDamage(ctx, tgt, dmg(amount, 'corrosive'), { canMiss: false });
          s.meal = (s.meal ?? 0) + dealt;
          this.log(`A scarab bites ${tgt.name} for ${amount}.`);
          if (dealt > 0 && s.hp < s.maxHp) {
            s.hp = s.maxHp;
            this.log('The scarab gorges on the wound and knits itself whole.');
          }
        }
        if (s.target) load.set(s.target, (load.get(s.target) ?? 1) - 1);
        // Bite, then fly back this same turn — reaching (and perching on) the
        // summoner in one go when close enough.
        s.target = null;
        this.creepScarab(s, anchor, moveStep, anchor);
        if (dist({ x: s.x, y: s.y }, anchor) <= SCARAB.attachDist) {
          this.healScarabOwner(s, owner);
          s.state = 'resting';
        } else {
          s.state = 'returning';
        }
        continue;
      }

      if (s.state === 'returning') {
        // Still crossing open ground on the way home.
        this.creepScarab(s, anchor, moveStep, anchor);
        if (dist({ x: s.x, y: s.y }, anchor) <= SCARAB.attachDist) {
          this.healScarabOwner(s, owner);
          s.state = 'resting';
        }
        continue;
      }

      // seeking — fly out toward the nearest enemy with room.
      let tgt = s.target && s.target.alive ? s.target : null;
      if (!tgt) {
        const options = enemies
          .filter((e) => (load.get(e) ?? 0) < SCARAB.maxPerEnemy)
          .sort((a, b) => dist(anchor, a.pos) - dist(anchor, b.pos));
        tgt = options[0] ?? null;
        if (tgt) {
          s.target = tgt;
          load.set(tgt, (load.get(tgt) ?? 0) + 1);
        }
      }
      if (!tgt) {
        // No enemy to hunt — settle back onto the summoner and wait.
        this.creepScarab(s, anchor, moveStep, anchor);
        s.state = 'resting';
        continue;
      }
      this.creepScarab(s, tgt.pos, moveStep, anchor);
      if (dist({ x: s.x, y: s.y }, tgt.pos) <= SCARAB.attachDist) {
        s.state = 'attached';
        if (this.isScarabFireHazard(tgt)) {
          load.set(tgt, Math.max(0, (load.get(tgt) ?? 1) - 1));
          this.destroyScarabsByFire([s], ` on ${tgt.name}`);
        }
      }
    }
  }

  /** Heal the mage that summoned a returning scarab (falling back to `owner`) for what it drank. */
  private healScarabOwner(s: Scarab, owner: Mage): void {
    const healed = (s.ownerIndex != null ? this.mages[s.ownerIndex] : undefined) ?? owner;
    const meal = s.meal ?? 0;
    s.meal = 0;
    if (meal > 0) heal(this.effectContext(healed, healed, null), healed, meal);
  }

  /** Damage enemy scarabs caught in an area effect; remove any destroyed. */
  damageScarabsInRadius(
    at: Vec2,
    radius: number,
    attackerTeam: number,
    amount: number,
    damageType: DamageType,
  ): void {
    if (amount <= 0 || this.scarabs.length === 0) return;
    const targets = this.scarabs.filter(
      (scarab) =>
        scarab.owner !== attackerTeam &&
        scarabAlive(scarab) &&
        scarabFlying(scarab) &&
        dist({ x: scarab.x, y: scarab.y }, at) <= radius + SCARAB.radius
    );
    if (damageType === 'heat') {
      this.destroyScarabsByFire(targets, ' in the fire');
      return;
    }
    for (const s of targets) {
      if (damageType === 'sanity') s.sanity = Math.max(0, s.sanity - amount);
      else s.hp = Math.max(0, s.hp - amount);
    }
    const before = this.scarabs.length;
    this.scarabs = this.scarabs.filter(scarabAlive);
    const removed = before - this.scarabs.length;
    if (removed > 0) {
      this.log(`${removed} scarab${removed > 1 ? 's are' : ' is'} crushed.`);
    }
  }

  /** Incinerate enemy Scarabs whose bodies overlap a fire cone. */
  destroyScarabsByFireInCone(
    origin: Vec2,
    toward: Vec2,
    range: number,
    degrees: number,
    attackerTeam: number,
    strictRange = false
  ): void {
    const base = Math.atan2(toward.y - origin.y, toward.x - origin.x);
    const half = ((degrees * Math.PI) / 180) / 2;
    const targets = this.scarabs.filter((scarab) => {
      if (scarab.owner === attackerTeam || !scarabAlive(scarab) || !scarabFlying(scarab)) return false;
      const position = { x: scarab.x, y: scarab.y };
      const distance = dist(position, origin);
      const maxDistance = strictRange ? range + 0.5 : range + SCARAB.radius;
      if (distance === 0 || distance > maxDistance) return false;
      const angle = Math.atan2(scarab.y - origin.y, scarab.x - origin.x);
      let difference = Math.abs(angle - base);
      if (difference > Math.PI) difference = 2 * Math.PI - difference;
      const anglePadding = Math.min(Math.atan2(SCARAB.radius, distance), half * 0.5, 0.15);
      return difference <= half + anglePadding;
    });
    this.destroyScarabsByFire(targets, ' in the fire');
  }

  /**
   * Living enemy scarabs (summoned by another team) within `range` of `m`,
   * nearest first — the targets an enemy may swat in melee. Only scarabs in the
   * open (flying) count; latched or perched scarabs cannot be hit.
   */
  enemyScarabsInRange(m: Mage, range: number): Scarab[] {
    return this.scarabs
      .filter(
        (s) =>
          s.owner !== m.team &&
          scarabAlive(s) &&
          scarabFlying(s) &&
          dist(m.pos, { x: s.x, y: s.y }) <= range
      )
      .sort((a, b) => dist(m.pos, { x: a.x, y: a.y }) - dist(m.pos, { x: b.x, y: b.y }));
  }

  /** A melee attacker swats a harassing scarab, hurting (and maybe killing) it. */
  attackScarab(source: Mage, scarab: Scarab): void {
    if (!scarabAlive(scarab)) return;
    const weapon = source.activeWeapon();
    const roll = this.rng.roll('1d6').total;
    if ((weapon?.damageType ?? source.intrinsicMelee?.type) === 'heat') {
      this.destroyScarabsByFire([scarab], ` under ${source.name}'s fire`);
      return;
    }
    const amount = Math.max(1, strengthDamage(roll, source.effectiveStr(), weapon?.multiplier ?? 1));
    scarab.hp = Math.max(0, scarab.hp - amount);
    this.log(`${source.name} crushes a scarab for ${amount}.`);
    if (!scarabAlive(scarab)) {
      this.scarabs = this.scarabs.filter(scarabAlive);
      this.log('A scarab is destroyed.');
    }
  }

  /** Keep latched scarabs riding on their victim wherever they move. */
  updateAttachedScarabs(): void {
    for (const s of this.scarabs) {
      if (s.state === 'attached' && s.target && s.target.alive) {
        s.x = s.target.x;
        s.y = s.target.y;
      }
    }
  }

  /** Fire any aura-DoT statuses (e.g. Shadow Curse) the mage carries. */
  private applyAuraDots(m: Mage): void {
    if (!m.alive) return;
    for (const s of m.statuses) {
      if (s.kind !== 'auraDot') continue;
      for (const victim of this.mages) {
        if (victim === m || !victim.alive) continue;
        if (dist(victim.pos, m.pos) > s.radius) continue;
        const ctx = this.effectContext(m, victim, null);
        const amount = this.rng.roll(s.damageSpec).total;
        const dealt = dealDamage(ctx, victim, dmg(amount, s.type), {
          canMiss: false,
          noImpactFx: true,
        });
        if (this.hasHexcraftGlobal('curseCorrode') && victim.alive) {
          const corrosive = this.rng.roll('1d3').total;
          victim.hp = Math.max(0, victim.hp - corrosive);
          addOrExtendStatus(
            victim.statuses,
            {
              key: 'debuff:curse-corrode-slow',
              name: 'Curse Corrode Slow',
              kind: 'debuff',
              duration: 2,
              mods: { moveRange: -Math.round(MOVE_RANGE * 0.5) },
            },
            false
          );
          this.log(`${s.name} also corrodes ${victim.name} for ${corrosive} and slows them by 50%.`);
        }
      }
    }
  }

  /** Pulse intrinsic auras from every living summon owned by `owner`. */
  private applyOwnedSummonAuras(owner: Mage): void {
    const ownerIndex = this.mages.indexOf(owner);
    for (const summon of this.summonsOf(owner)) {
      const aura = summon.intrinsicDamageAura;
      if (!aura) continue;
      for (const victim of this.mages) {
        if (!victim.alive || victim === owner) continue;
        if (victim.isSummon && victim.summonOwnerIndex === ownerIndex) continue;
        if (dist(victim.pos, summon.pos) > aura.radius) continue;
        const ctx = this.effectContext(summon, victim, null);
        const amount = this.rng.roll(aura.damageSpec).total;
        const dealt = dealDamage(ctx, victim, dmg(amount, aura.type), {
          canMiss: false,
          noImpactFx: true,
        });
        if (dealt > 0) this.log(`${summon.name}'s rot aura corrodes ${victim.name} for ${dealt}.`);
      }
    }
  }

  /** Defeat one combatant and fire the canonical callback/VFX exactly once. */
  defeatMage(target: Mage, source: Mage, message: string): boolean {
    if (!target.alive || target.unkillable) return false;
    target.hp = 0;
    this.log(message);
    this.vfxSink?.hit?.(target);
    this.vfxSink?.spellEffect?.(target, 'generic');
    this.notifyMageDefeated(target, source);
    return true;
  }

  /**
   * Start-of-turn upkeep for the desert host: riders follow their hosts, cadetts
   * dissolve, the blight slows what it rots and the standardbearer tends the line.
   */
  private applySandSummonUpkeep(owner: Mage): void {
    const ownerIndex = this.mages.indexOf(owner);
    for (const summon of this.summonsOf(owner)) {
      const host = summon.attachedToIndex != null ? this.mages[summon.attachedToIndex] : null;
      if (host && host.alive) {
        summon.x = host.x;
        summon.y = host.y;
      } else if (host) {
        summon.attachedToIndex = undefined;
      }
      if (summon.unsummonOnRound != null && this.round >= summon.unsummonOnRound) {
        this.defeatMage(summon, owner, `${summon.name} crumbles back into loose sand.`);
        continue;
      }
      // The blight's aura also drags at whatever it just rotted.
      if (summon.intrinsicDamageAura && summon.summonKind === 'desertblight') {
        for (const victim of this.mages) {
          if (!victim.alive || victim.team === owner.team) continue;
          if (dist(victim.pos, summon.pos) > summon.intrinsicDamageAura.radius) continue;
          addOrExtendStatus(
            victim.statuses,
            {
              key: 'debuff:desertblight-slow',
              name: 'Blighted',
              kind: 'debuff',
              duration: 1,
              mods: { moveRange: -Math.round(MOVE_RANGE * 0.5) },
            },
            false
          );
        }
      }
      if (summon.summonKind === 'standardbearer') this.pulseStandardbearer(owner, summon, ownerIndex);
      if (summon.summonKind === 'orzhov-sandpriest') this.pulseOrzhovSandpriest(owner, summon);
      if (summon.summonKind === 'silencing-spike') this.pulseSilencingSpike(owner, summon);
      if (summon.summonKind === 'remnant' && !this.canCommandSummon(owner, summon)) {
        this.pulseFeralRemnant(owner, summon);
      }
    }
    this.pulseParasitePair(owner, ownerIndex);
  }

  /** A Remnant nobody can steer still bites: it goes for whatever is nearest. */
  private pulseFeralRemnant(owner: Mage, remnant: Mage): void {
    const prey = this.mages
      .filter((m) => m.alive && m.team !== owner.team && !this.isUntargetable(m, remnant))
      .sort((a, b) => dist(a.pos, remnant.pos) - dist(b.pos, remnant.pos))[0];
    if (!prey || !this.canMelee(remnant, prey)) return;
    const im = remnant.intrinsicMelee;
    if (!im) return;
    const ctx = this.effectContext(remnant, prey, null);
    dealDamage(ctx, prey, dmg(this.rng.roll(im.spec).total, im.type), {});
    if (prey.alive) im.onHit?.(ctx, prey);
    this.log(`${remnant.name} lurches at ${prey.name} unbidden.`);
  }

  /**
   * The spike hunts alone: it picks the furthest enemy within range 15, lodges
   * itself in them and keeps rotting them until they fall.
   */
  private pulseSilencingSpike(owner: Mage, spike: Mage): void {
    const stuck = spike.attachedToIndex != null ? this.mages[spike.attachedToIndex] : null;
    if (stuck && stuck.alive && stuck.team !== owner.team) {
      const ctx = this.effectContext(spike, stuck, null);
      dealDamage(ctx, stuck, dmg(this.rng.roll('1d4').total, 'corrosive'), {
        canMiss: false,
        noImpactFx: true,
      });
      this.log(`${spike.name} grinds deeper into ${stuck.name}.`);
      return;
    }
    const prey = this.mages
      .filter(
        (m) =>
          m.alive &&
          m.team !== owner.team &&
          !this.isUntargetable(m, spike) &&
          dist(m.pos, spike.pos) <= RANGE_UNIT * 15
      )
      .sort((a, b) => dist(b.pos, spike.pos) - dist(a.pos, spike.pos))[0];
    if (!prey) {
      spike.attachedToIndex = this.mages.indexOf(owner);
      return;
    }
    const ctx = this.effectContext(spike, prey, null);
    dealDamage(ctx, prey, dmg(this.rng.roll('1d6').total, 'pierce'), { canMiss: false });
    this.log(`${spike.name} hurls itself into ${prey.name}.`);
    if (prey.alive) {
      spike.attachedToIndex = this.mages.indexOf(prey);
      spike.x = prey.x;
      spike.y = prey.y;
    }
  }

  /** The Orzhov mark: no healing reaches the branded, and the rot never stops. */
  private pulseOrzhovSandpriest(owner: Mage, priest: Mage): void {
    if (owner.mana < 1) return;
    const foe = this.mages
      .filter((m) => m.alive && m.team !== owner.team && !this.isUntargetable(m, priest))
      .sort((a, b) => dist(a.pos, priest.pos) - dist(b.pos, priest.pos))[0];
    if (!foe || foe.statuses.some((s) => s.key === 'debuff:orzhov-mark')) return;
    owner.spendMana(1);
    const ctx = this.effectContext(priest, foe, null);
    applyDebuff(ctx, foe, {
      name: 'Orzhov Mark',
      key: 'debuff:orzhov-mark',
      duration: 3,
      mods: {},
      healMult: 0,
    });
    applyDot(ctx, foe, {
      name: 'Orzhov Mark',
      key: 'dot:orzhov-mark',
      duration: 3,
      damage: dmg(1, 'corrosive'),
      damageSpec: '1d6',
    });
  }

  /**
   * While both parasites are latched the suckling drains and the spitling gives
   * half of it back, and the drained host is left slow and unable to hide.
   */
  private pulseParasitePair(owner: Mage, ownerIndex: number): void {
    const own = (kind: string): Mage | undefined =>
      this.mages.find(
        (m) => m.alive && m.isSummon && m.summonOwnerIndex === ownerIndex && m.summonKind === kind
      );
    const suckling = own('suckling');
    const spitling = own('spitling');
    if (!suckling || !spitling) return;
    const drained = suckling.attachedToIndex != null ? this.mages[suckling.attachedToIndex] : null;
    const fed = spitling.attachedToIndex != null ? this.mages[spitling.attachedToIndex] : null;
    if (!drained?.alive || !fed?.alive || drained === owner) return;
    const ctx = this.effectContext(suckling, drained, null);
    const bite = dealDamage(ctx, drained, dmg(this.rng.roll('2d6').total, 'corrosive'), {
      canMiss: false,
    });
    if (bite <= 0) return;
    heal(this.effectContext(spitling, fed, null), fed, Math.floor(bite / 2));
    applyDebuff(ctx, drained, {
      name: 'Sucked Dry',
      key: 'debuff:suckling',
      duration: 1,
      mods: { moveRange: -Math.round(MOVE_RANGE * 0.51) },
      healMult: 0.49,
    });
    this.dispelStealth(drained);
  }

  /**
   * Walk a corpse upright for `owner`. The bite's rider lives here rather than in
   * the spell layer so a cascading kill can raise the next Remnant on its own.
   */
  raiseRemnant(corpse: Mage, owner: Mage): Mage {
    const remnant = makeRemnant({
      ownerName: owner.name,
      pos: corpse.pos,
      team: owner.team,
      corpse,
    });
    remnant.intrinsicMelee = {
      ...remnant.intrinsicMelee!,
      onHit: (hitCtx, victim) => {
        applyDot(hitCtx, victim, {
          key: 'dot:remnant-rot',
          name: 'Remnant Rot',
          duration: 2,
          damage: dmg(1, 'corrosive'),
        });
        applyDebuff(hitCtx, victim, {
          name: 'Sundered Mending',
          key: 'debuff:remnant-heal-cut',
          duration: 2,
          mods: {},
          healMult: 0.5,
        });
      },
    };
    this.spawnSummon(remnant, owner, 'remnant');
    return remnant;
  }

  /** Anything that dies rotting under a Remnant gets up again as one. */
  private cascadeRemnant(fallen: Mage): void {
    if (fallen.isSummon || fallen.summonKind === 'remnant') return;
    if (!fallen.statuses.some((s) => s.key === 'debuff:remnant-heal-cut')) return;
    const existing = this.mages.find(
      (m) => m.alive && m.summonKind === 'remnant' && m.summonOwnerIndex != null
    );
    const owner = existing?.summonOwnerIndex != null ? this.mages[existing.summonOwnerIndex] : null;
    if (!owner?.alive) return;
    owner.spendMana(3);
    const risen = this.raiseRemnant(fallen, owner);
    this.log(`${fallen.name} rises as ${risen.name}.`);
  }

  /** Strip any concealment a unit is holding (the suckling's grip). */
  private dispelStealth(m: Mage): void {
    m.statuses = m.statuses.filter((s) => s.kind !== 'invisibility' && s.kind !== 'shadowVeil');
  }

  /**
   * A standing banner buys back any sand-born unit that falls, for 3 mana — and
   * if its owner cannot pay, the banner itself is spent instead.
   */
  private redeemSandborn(fallen: Mage): boolean {
    if (!fallen.sandBorn || !fallen.isSummon || fallen.summonOwnerIndex == null) return false;
    const owner = this.mages[fallen.summonOwnerIndex];
    if (!owner?.alive) return false;
    const banner = this.summonsOf(owner).find(
      (s) => s.summonKind === 'standardbearer' && s !== fallen && s.alive
    );
    if (!banner) return false;
    if (owner.mana >= 3) {
      owner.spendMana(3);
    } else {
      banner.hp = 0;
      this.log(`${banner.name} spends itself to call ${fallen.name} back.`);
    }
    fallen.hp = fallen.maxHp;
    fallen.sanity = fallen.maxSanity;
    fallen.x = banner.x + RANGE_UNIT;
    fallen.y = banner.y;
    this.log(`${fallen.name} reforms before the banner.`);
    return true;
  }

  /** Anything that dies branded may rise again as a cadett. */
  private harvestOrzhovMark(fallen: Mage): void {
    if (!fallen.statuses.some((s) => s.key === 'debuff:orzhov-mark')) return;
    const priest = this.mages.find(
      (m) => m.alive && m.isSummon && m.summonKind === 'orzhov-sandpriest'
    );
    if (!priest || priest.summonOwnerIndex == null) return;
    const owner = this.mages[priest.summonOwnerIndex];
    if (!owner?.alive) return;
    if (this.rng.roll('1d2').total !== 1) return;
    const cadett = makeSandCadett({
      ownerName: owner.name,
      pos: fallen.pos,
      team: owner.team,
    });
    cadett.unsummonOnRound = this.round + 6;
    this.spawnSummon(cadett, owner, 'sand-cadett');
    this.log(`${fallen.name} rises again as ${cadett.name}.`);
    const mender = this.mages.find((m) => m.alive && m.team === owner.team && m.hp < m.maxHp);
    if (mender) heal(this.effectContext(priest, mender, null), mender, this.rng.roll('1d6').total);
  }

  /** The banner's turn: heal and hasten every conjured ally standing near it. */
  private pulseStandardbearer(owner: Mage, banner: Mage, ownerIndex: number): void {
    for (const ally of this.mages) {
      if (!ally.alive || ally.team !== owner.team || ally === banner) continue;
      if (!ally.isSummon || ally.summonOwnerIndex !== ownerIndex) continue;
      if (dist(ally.pos, banner.pos) > RANGE_UNIT * 15) continue;
      ally.hp = Math.min(ally.maxHp, ally.hp + 5);
      addOrExtendStatus(
        ally.statuses,
        {
          key: 'buff:standardbearer-haste',
          name: 'Bannered',
          kind: 'debuff',
          duration: 1,
          mods: { moveRange: RANGE_UNIT * 5 },
        },
        false
      );
    }
    this.log(`${banner.name} raises the banner: the host is healed and hastened.`);
  }

  /** Attribute one confirmed defeat, including summon kills, before scene hooks run. */
  notifyMageDefeated(target: Mage, source: Mage): void {
    if (crusadeDeath(this, target, source)) {
      this.onMageDefeated?.(target, source);
      return;
    }
    lillithOnDeath(this, target);
    const offspring = target.mine?.kind === 'huge-spider' ? 'small-spider'
      : target.mine?.kind === 'gigantuan-spider' ? 'huge-spider' : null;
    if (offspring) {
      const count = this.rng.roll(offspring === 'small-spider' ? '1d8' : '1d4').total;
      for (let index = 0; index < count; index++) {
        const angle = (2 * Math.PI * index) / count;
        const gap = target.bodyRadius() + 20;
        this.spawnSpiderCreature(offspring, target.mine!.level, {
          x: target.x + Math.cos(angle) * gap, y: target.y + Math.sin(angle) * gap,
        });
      }
      this.log(`${target.name} releases ${count} ${offspring}${count === 1 ? '' : 's'}.`);
    }
    const minion = target.summonKind ? MINIONS[target.summonKind] : undefined;
    if (minion?.death) runDeath(this, target, this.mages[target.summonOwnerIndex ?? -1] ?? target, minion.death);
    // A banner buys the body back instead of letting it crumble, so this runs first.
    const redeemed = this.redeemSandborn(target);
    if (!redeemed && target.sandDropOnDeath > 0) {
      this.addSand(target.pos, target.sandDropOnDeath);
      this.log(`${target.name} collapses into ${target.sandDropOnDeath} charges of sand.`);
    }
    this.harvestOrzhovMark(target);
    this.cascadeRemnant(target);
    const owner =
      source.isSummon && source.summonOwnerIndex != null
        ? this.mages[source.summonOwnerIndex] ?? source
        : source;
    if (owner !== target && owner.team !== target.team && owner.hasDeathsAngelWings()) {
      owner.deathsAngelEnergy += 1;
      this.log(`${owner.name}'s Wings claim 1 Energy (${owner.deathsAngelEnergy}).`);
    }
    this.transferReapOnDeath(target, owner);
    this.onDesecrationDeath(target, owner);
    lawOnDeath(this, target, source, this.wasDesecrationAffected(target));
    deathRites(this, target, source);
    if (target.baral) this.dismantleBaralWorks(target);
    this.onMageDefeated?.(target, source);
  }

  /** Spend one Energy to begin or extend Wings flight by two wearer turns. */
  activateDeathsAngelWings(source: Mage): boolean {
    if (
      !source.alive ||
      !source.hasDeathsAngelWings() ||
      source.isItemBanned('deathsAngelWings') ||
      source.deathsAngelEnergy <= 0
    ) return false;
    const wasActive = source.deathsAngelFlightTurns > 0;
    source.deathsAngelEnergy -= 1;
    source.deathsAngelFlightTurns += 2;
    this.log(
      `${source.name} spends 1 Energy and ${wasActive ? 'extends' : 'unfurls'} the Wings for ${source.deathsAngelFlightTurns} turn${source.deathsAngelFlightTurns === 1 ? '' : 's'}.`
    );
    if (!wasActive) this.pulseDeathsAngelWings(source);
    return true;
  }

  /** Once per active wearer turn, restore life and drain nearby enemies. */
  private pulseDeathsAngelWings(source: Mage): void {
    if (!source.alive || !source.hasDeathsAngelWings() || source.deathsAngelFlightTurns <= 0) return;
    const healing = this.rng.roll('1d3').total;
    heal(this.effectContext(source, source, null), source, healing);
    const enemies = this.magesInRadius(source.pos, 5 * RANGE_UNIT, source).filter(
      (target) => target.team !== source.team
    );
    for (const target of enemies) {
      const amount = this.rng.roll('1d3').total;
      dealDamage(
        this.effectContext(source, target, null),
        target,
        dmg(amount, 'typeless'),
        { canMiss: false, aoe: true, trueDamage: true, noImpactFx: true }
      );
    }
    this.log(
      `${source.name}'s Wings restore ${healing} HP and drain ${enemies.length} nearby enem${enemies.length === 1 ? 'y' : 'ies'}.`
    );
  }

  /** Defeat a Pftlhb on genuine illumination without creating artificial damage. */
  defeatPftlhbByIllumination(target: Mage, source: Mage): boolean {
    if (!target.alive || target.mine?.kind !== 'pftlhb') return false;
    return this.defeatMage(
      target,
      source,
      `${target.name}'s eye catches the light and the creature collapses.`
    );
  }

  /** Check newly active held or bagged light immediately against nearby Pftlhb. */
  notifyLightActivation(source: Mage): void {
    const radius = this.effectiveLightRadius(source);
    if (!source.alive || radius <= 0) return;
    for (const target of this.mages) {
      if (
        target.alive &&
        target.team !== source.team &&
        target.mine?.kind === 'pftlhb' &&
        !this.isInEdgelordDarkLight(target.pos) &&
        dist(source.pos, target.pos) <= radius + target.bodyRadius()
      ) {
        this.defeatPftlhbByIllumination(target, source);
      }
    }
  }

  /**
   * Notify the model after a relocation. Physical travel checks every supplied
   * path segment; teleportation checks only the destination.
   */
  /** Refresh every unit's footing so sand-striders know when they are on sand. */
  refreshSandFooting(): void {
    for (const m of this.mages) m.onSand = m.sandStrider && this.isSandAt(m.pos);
  }

  /**
   * Free strikes from spearwall units against anything that crossed the edge of
   * their reach, in either direction, inside the half-circle they face.
   */
  private resolveOpportunityStrikes(mover: Mage, origin: Vec2, destination: Vec2): void {
    if (!mover.alive || this.opportunityStriking) return;
    this.opportunityStriking = true;
    try {
      for (const spear of this.mages) {
        const watch = spear.opportunityStrike;
        if (!watch || !spear.alive || spear.team === mover.team) continue;
        const wasIn = dist(origin, spear.pos) <= watch.reach;
        const isIn = dist(destination, spear.pos) <= watch.reach;
        if (wasIn === isIn) continue;
        // Judge the arc at whichever end of the move was inside reach.
        const at = isIn ? destination : origin;
        const toTarget = Math.atan2(at.y - spear.pos.y, at.x - spear.pos.x);
        let delta = Math.abs(toTarget - spear.facing) % (Math.PI * 2);
        if (delta > Math.PI) delta = Math.PI * 2 - delta;
        if (delta > (watch.arcDegrees / 2) * (Math.PI / 180)) continue;
        const amount = this.rng.roll(watch.spec).total;
        dealDamage(
          this.effectContext(spear, mover, null),
          mover,
          dmg(amount, watch.type),
          { canMiss: false }
        );
        this.log(`${spear.name} strikes ${mover.name} as they cross its reach.`);
        if (!mover.alive) return;
      }
    } finally {
      this.opportunityStriking = false;
    }
  }

  private opportunityStriking = false;

  notifyMageRelocation(
    mover: Mage,
    origin: Vec2,
    destination: Vec2,
    physicalTravel: boolean,
    path?: readonly Vec2[]
  ): void {
    if (this.moayArena) {
      const bounded = clampToMoayArena(this.moayArena, mover.pos, mover.bodyRadius());
      mover.x = bounded.x;
      mover.y = bounded.y;
      destination = bounded;
    }
    if (mover.lillithBound) {
      mover.x = mover.lillithBound.x;
      mover.y = mover.lillithBound.y;
      return;
    }
    for (const zone of this.hazardZones) {
      if (zone.carrierIndex !== this.mages.indexOf(mover)) continue;
      zone.x = mover.x;
      zone.y = mover.y;
    }
    const points: Vec2[] = physicalTravel
      ? [origin, ...(path?.length ? path : [destination])]
      : [destination];
    if (physicalTravel && mover.venomStacks > 0) {
      const distance = points.slice(1).reduce((total, point, index) => total + dist(points[index], point), 0);
      const travelled = mover.venomDistance + distance;
      mover.venomDistance = travelled % RANGE_UNIT;
      this.removeSpiderVenom(mover, Math.floor(travelled / RANGE_UNIT));
    }
    const firstContact = (center: Vec2, radius: number): Vec2 | null => {
      if (points.length === 1) return dist(points[0], center) <= radius ? { ...points[0] } : null;
      for (let i = 1; i < points.length; i++) {
        const start = points[i - 1];
        const end = points[i];
        const t = segmentCircleFirstIntersection(start, end, center, radius);
        if (t == null) continue;
        return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
      }
      return null;
    };

    if (mover.alive && mover.mine?.kind === 'pftlhb') {
      for (let segment = 1; segment < Math.max(2, points.length); segment++) {
        const start = points.length === 1 ? points[0] : points[segment - 1];
        const end = points.length === 1 ? points[0] : points[segment];
        let first = Infinity;
        let source: Mage | null = null;
        for (const candidate of this.mages) {
          const radius = this.effectiveLightRadius(candidate);
          if (!candidate.alive || candidate.team === mover.team || radius <= 0) continue;
          const t = points.length === 1
            ? (dist(end, candidate.pos) <= radius + mover.bodyRadius() ? 0 : null)
            : segmentCircleFirstIntersection(start, end, candidate.pos, radius + mover.bodyRadius());
          if (t != null && t < first) {
            first = t;
            source = candidate;
          }
        }
        if (source) {
          mover.x = start.x + (end.x - start.x) * first;
          mover.y = start.y + (end.y - start.y) * first;
          this.defeatPftlhbByIllumination(mover, source);
          break;
        }
      }
    }

    this.applyCorrosionPoolSlow(mover);
    if (mover.sandStrider) mover.onSand = this.isSandAt(mover.pos);
    if (physicalTravel && dist(origin, destination) > 0.5) {
      mover.facing = Math.atan2(destination.y - origin.y, destination.x - origin.x);
    }
    this.resolveOpportunityStrikes(mover, origin, destination);
    // An Artifact of Denial will not be moved: it cracks every time it is.
    if (mover.denial && mover.alive && dist(origin, destination) > 1) this.crackMovedArtifact(mover);
    this.dragRivetPartner(mover);
    this.carryDesecration(mover);

    const lightRadius = this.effectiveLightRadius(mover);
    if (!mover.alive || lightRadius <= 0) return;
    for (const target of this.mages) {
      if (
        !target.alive ||
        target.team === mover.team ||
        target.mine?.kind !== 'pftlhb' ||
        this.isInEdgelordDarkLight(target.pos)
      ) continue;
      if (firstContact(target.pos, lightRadius + target.bodyRadius())) {
        this.defeatPftlhbByIllumination(target, mover);
      }
    }
  }

  /** Place or replace one Black Dragonborn's non-blocking corrosion pool. */
  addCorrosionPool(at: Vec2, owner: Mage, radius: number, rounds: number): CorrosionPool {
    const ownerIndex = this.mages.indexOf(owner);
    this.corrosionPools = this.corrosionPools.filter((pool) => pool.ownerIndex !== ownerIndex);
    const pool: CorrosionPool = {
      id: this.nextId++,
      x: Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, at.x)),
      y: Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, at.y)),
      radius,
      ownerIndex,
      ownerTeam: owner.team,
      roundsLeft: Math.max(1, rounds),
    };
    this.corrosionPools.push(pool);
    this.log(`${owner.name} leaves a pool of biting corrosion.`);
    for (const target of this.mages) this.applyCorrosionPoolSlow(target);
    return pool;
  }

  /** Apply or refresh the shared 50% movement penalty after relocation. */
  private applyCorrosionPoolSlow(mover: Mage): void {
    if (!mover.alive) return;
    const inside = this.corrosionPools.some(
      (pool) =>
        pool.ownerTeam !== mover.team &&
        dist(mover.pos, { x: pool.x, y: pool.y }) <= pool.radius
    );
    if (!inside) return;
    addOrExtendStatus(
      mover.statuses,
      {
        key: 'debuff:corrosion-pool-slow',
        name: 'Corrosion Mire',
        kind: 'debuff',
        duration: 2,
        mods: { moveRange: -Math.round(MOVE_RANGE * 0.5) },
      },
      false
    );
  }

  /** Each hostile pool damages independently at the affected unit's turn start. */
  private applyCorrosionPools(m: Mage): void {
    if (!m.alive) return;
    for (const pool of this.corrosionPools) {
      if (
        !m.alive ||
        pool.ownerTeam === m.team ||
        dist(m.pos, { x: pool.x, y: pool.y }) > pool.radius
      ) continue;
      const owner = this.mages[pool.ownerIndex] ?? m;
      const dealt = dealDamage(
        this.effectContext(owner, m, null),
        m,
        dmg(this.rng.roll('3d3').total, 'corrosive'),
        { canMiss: false, aoe: true, noImpactFx: true }
      );
      if (dealt > 0) this.vfxSink?.spellEffect?.(m, 'corrosive');
      this.applyCorrosionPoolSlow(m);
      this.log(`${m.name} is eaten by the corrosion pool.`);
    }
  }

  private tickCorrosionPools(): void {
    for (const pool of this.corrosionPools) pool.roundsLeft -= 1;
    const expired = this.corrosionPools.some((pool) => pool.roundsLeft <= 0);
    this.corrosionPools = this.corrosionPools.filter((pool) => pool.roundsLeft > 0);
    if (expired) this.log('A corrosion pool seeps into the stone.');
  }

  /**
   * Light auras: at the start of a vulnerable creature's turn, held torch /
   * lantern glow sears it. Pftlhb uses its separate fatal illumination rule.
   */
  private applyLightAuras(m: Mage): void {
    if (!m.alive || this.isInEdgelordDarkLight(m.pos)) return;
    const light = this.mages.find(
      (e) =>
        e.alive &&
        e.team !== m.team &&
        this.effectiveLightRadius(e) > 0 &&
        dist(e.pos, m.pos) <= this.effectiveLightRadius(e) + (m.mine?.kind === 'pftlhb' ? m.bodyRadius() : 0)
    );
    if (!light) return;
    if (this.defeatPftlhbByIllumination(m, light)) return;
    if (!m.isLightWeak()) return;
    const ctx = this.effectContext(m, m, null);
    const dealt = dealDamage(ctx, m, dmg(2, 'typeless'), {
      canMiss: false,
      noImpactFx: true,
    });
    if (dealt > 0) {
      this.log(`${m.name} sears in the light for ${dealt}.`);
    }
  }

  /** Resolve Fire's threshold damage, spread, and stack decay at turn start. */
  private applyFireDamage(m: Mage): void {
    if (!m.alive) return;
    const fire = m.statuses.find((s) => s.kind === 'fire') as FireStatus | undefined;
    if (!fire || fire.stacks <= 0) return;
    const owner = this.mages[fire.ownerIndex] ?? m;
    const ctx = this.effectContext(owner, m, null);
    const highFire = fire.stacks >= 4;
    const spec = highFire ? '1d6' : '1d3';
    this.log(`${m.name}'s Fire flares at ${fire.stacks} stacks.`);
    const rolled = this.rng.roll(spec).total;
    dealDamage(ctx, m, dmg(rolled, 'heat'), {
      canMiss: false,
      noImpactFx: true,
      dot: true,
    });
    lawFireBurns(ctx, m, rolled, true);
    if (highFire) {
      const nearby = this.mages.filter(
        (other) => other !== m && other.alive && dist(other.pos, m.pos) <= 2 * RANGE_UNIT
      );
      for (const other of nearby) this.applyFireStacks(other, 1, owner);
    }
    fire.stacks -= highFire ? 2 : 1;
    if (fire.stacks <= 0) {
      m.statuses = m.statuses.filter((s) => s !== fire);
      this.log(`Fire burns out on ${m.name}.`);
    }
  }

  /** Apply Fire stacks, resolving every stack above six as an immediate detonation. */
  applyFireStacks(target: Mage, count: number, owner: Mage, spread = false): void {
    if (!target.alive || count <= 0) return;
    if (this.defeatPftlhbByIllumination(target, owner)) return;
    if (target.isDebuffImmune()) {
      this.log(`${target.name} is immune to debuffs. Fire fails.`);
      return;
    }
    // Overflow spreads skip the amplifier, or two neighbours could overflow into each other forever.
    if (!spread) count += kindleBonus(owner);
    let fire = target.statuses.find((s) => s.kind === 'fire') as FireStatus | undefined;
    if (!fire) {
      fire = {
        key: 'fire',
        name: 'Fire',
        kind: 'fire',
        duration: Infinity,
        stacks: 0,
        ownerIndex: this.mages.indexOf(owner),
      };
      target.statuses.push(fire);
    }
    this.destroyAttachedScarabsByFire(target);
    fire.ownerIndex = this.mages.indexOf(owner);
    for (let i = 0; i < count; i++) {
      fire.stacks += 1;
      if (fire.stacks <= 6) continue;
      this.log(`${target.name}'s Fire overflows!`);
      const ctx = this.effectContext(owner, target, null);
      const blast = this.rng.roll('1d10').total;
      dealDamage(ctx, target, dmg(blast, 'heat'), {
        canMiss: false,
      });
      lawFireBurns(ctx, target, blast, false);
      fire.stacks = 5;
      const nearbyEnemies = this.mages.filter(
        (other) =>
          other !== target &&
          other.alive &&
          other.team !== owner.team &&
          dist(other.pos, target.pos) <= 2 * RANGE_UNIT
      );
      for (const other of nearbyEnemies) this.applyFireStacks(other, 1, owner, true);
    }
    this.log(`${target.name} has ${fire.stacks} Fire stack${fire.stacks === 1 ? '' : 's'}.`);
  }

  /** Resolve Sentinel Fire's low/high threshold damage, spread, and decay. */
  private applySentinelFireDamage(m: Mage): void {
    if (!m.alive) return;
    const fire = m.statuses.find((s) => s.kind === 'sentinelFire') as SentinelFireStatus | undefined;
    if (!fire || fire.stacks <= 0) return;
    const owner = this.mages[fire.ownerIndex] ?? m;
    const highFire = fire.stacks >= 5;
    const spec = highFire ? '1d6' : '1d3';
    this.log(`${m.name}'s Sentinel Fire flares at ${fire.stacks} stacks.`);
    dealDamage(
      this.effectContext(owner, m, null),
      m,
      dmg(this.rng.roll(spec).total, 'heat'),
      { canMiss: false, noImpactFx: true, dot: true }
    );
    if (highFire) {
      for (const other of this.mages) {
        if (other !== m && other.alive && dist(other.pos, m.pos) <= 2 * RANGE_UNIT) {
          this.applySentinelFireStacks(other, 1, owner);
        }
      }
    }
    fire.stacks -= highFire ? 2 : 1;
    if (fire.stacks <= 0) {
      m.statuses = m.statuses.filter((status) => status !== fire);
      this.log(`Sentinel Fire burns out on ${m.name}.`);
    }
  }

  /** Add Sentinel Fire, detonating immediately whenever the tenth stack lands. */
  applySentinelFireStacks(target: Mage, count: number, owner: Mage): void {
    if (!target.alive || count <= 0) return;
    if (this.defeatPftlhbByIllumination(target, owner)) return;
    if (target.isDebuffImmune()) {
      this.log(`${target.name} is immune to debuffs. Sentinel Fire fails.`);
      return;
    }
    let fire = target.statuses.find((s) => s.kind === 'sentinelFire') as
      | SentinelFireStatus
      | undefined;
    if (!fire) {
      fire = {
        key: 'sentinel-fire',
        name: 'Sentinel Fire',
        kind: 'sentinelFire',
        duration: Infinity,
        stacks: 0,
        ownerIndex: this.mages.indexOf(owner),
      };
      target.statuses.push(fire);
    }
    this.destroyAttachedScarabsByFire(target);
    fire.ownerIndex = this.mages.indexOf(owner);
    for (let i = 0; i < count; i++) {
      fire.stacks += 1;
      if (fire.stacks < 10) continue;
      this.log(`${target.name}'s Sentinel Fire erupts!`);
      dealDamage(
        this.effectContext(owner, target, null),
        target,
        dmg(this.rng.roll('3d6').total, 'heat'),
        { canMiss: false }
      );
      for (const other of this.mages) {
        if (other === target || !other.alive || dist(other.pos, target.pos) > 2 * RANGE_UNIT) continue;
        dealDamage(
          this.effectContext(owner, other, null),
          other,
          dmg(this.rng.roll('2d6').total, 'heat'),
          { canMiss: false, aoe: true }
        );
      }
      fire.stacks = 5;
    }
    this.log(`${target.name} has ${fire.stacks} Sentinel Fire stack${fire.stacks === 1 ? '' : 's'}.`);
  }

  /** Blueflare's turn-start pulse, taken now (Candlewight's death, Thoughtfire, Brainstorm). */
  pulseBlueflare(m: Mage): void {
    this.applyBlueflareDamage(m);
  }

  /** Fire's turn-start flare, taken now (Brainstorm). */
  pulseFire(m: Mage): void {
    this.applyFireDamage(m);
  }

  /** Every Fire tick `m` has left lands at once as one hit (Hellbolt), and the Fire is spent. */
  condenseFire(m: Mage, ctx: EffectContext): number {
    const fire = m.statuses.find((s) => s.kind === 'fire') as FireStatus | undefined;
    if (!m.alive || !fire || fire.stacks <= 0) return 0;
    let total = 0;
    for (let stacks = fire.stacks; stacks > 0; stacks -= stacks >= 4 ? 2 : 1) {
      total += this.rng.roll(stacks >= 4 ? '1d6' : '1d3').total;
    }
    m.statuses = m.statuses.filter((s) => s !== fire);
    this.log(`${m.name}'s ${fire.stacks} Fire burn all at once.`);
    const dealt = dealDamage(ctx, m, dmg(total, 'heat'), { canMiss: false, aoe: true });
    lawFireBurns(ctx, m, total, false);
    return dealt;
  }

  /** Blueflare mirrors Fire at half mental damage, with easier spread and slower decay. */
  private applyBlueflareDamage(m: Mage): void {
    if (!m.alive) return;
    const flare = m.statuses.find((s) => s.kind === 'blueflare') as BlueflareStatus | undefined;
    if (!flare || flare.stacks <= 0) return;
    const owner = this.mages[flare.ownerIndex] ?? m;
    const highFlare = flare.stacks >= 3;
    const rolled = this.rng.roll(highFlare ? '1d6' : '1d3').total;
    const amount = Math.max(1, Math.ceil(rolled / 2));
    this.log(`${m.name}'s Blueflare pulses at ${flare.stacks} stacks.`);
    dealDamage(this.effectContext(owner, m, null), m, dmg(amount, 'sanity'), {
      canMiss: false,
      noImpactFx: true,
      dot: true,
    });
    if (highFlare) {
      for (const other of this.mages) {
        if (other === m || !other.alive || dist(other.pos, m.pos) > 3 * RANGE_UNIT) continue;
        this.applyBlueflareStacks(other, 1, owner);
      }
      flare.stacks -= 1;
    } else {
      if (flare.decayNext) flare.stacks -= 1;
      flare.decayNext = !flare.decayNext;
    }
    if (flare.stacks <= 0) {
      m.statuses = m.statuses.filter((status) => status !== flare);
      this.log(`Blueflare fades from ${m.name}.`);
    }
  }

  applyBlueflareStacks(target: Mage, count: number, owner: Mage): void {
    if (!target.alive || count <= 0) return;
    if (target.isDebuffImmune()) {
      this.log(`${target.name} is immune to debuffs. Blueflare fails.`);
      return;
    }
    let flare = target.statuses.find((s) => s.kind === 'blueflare') as BlueflareStatus | undefined;
    if (!flare) {
      flare = {
        key: 'blueflare',
        name: 'Blueflare',
        kind: 'blueflare',
        duration: Infinity,
        stacks: 0,
        ownerIndex: this.mages.indexOf(owner),
        decayNext: false,
      };
      target.statuses.push(flare);
    }
    flare.ownerIndex = this.mages.indexOf(owner);
    for (let i = 0; i < count; i++) {
      flare.stacks += 1;
      if (flare.stacks <= 6) continue;
      const amount = Math.max(1, Math.ceil(this.rng.roll('1d10').total / 2));
      this.log(`${target.name}'s Blueflare overflows!`);
      dealDamage(this.effectContext(owner, target, null), target, dmg(amount, 'sanity'), {
        canMiss: false,
      });
      flare.stacks = 5;
      for (const other of this.mages) {
        if (
          other === target ||
          !other.alive ||
          other.team === owner.team ||
          dist(other.pos, target.pos) > 3 * RANGE_UNIT
        ) continue;
        this.applyBlueflareStacks(other, 1, owner);
      }
    }
    this.log(`${target.name} has ${flare.stacks} Blueflare stack${flare.stacks === 1 ? '' : 's'}.`);
  }

  /** Add Soul Rend stacks; each stack tears 1d3 true health and mill per bearer turn. */
  applySoulRend(target: Mage, count: number, owner: Mage): void {
    if (!target.alive || count <= 0) return;
    if (target.isDebuffImmune()) {
      this.log(`${target.name} is immune to debuffs. Soul Rend fails.`);
      return;
    }
    let rend = target.statuses.find((status) => status.kind === 'soulRend') as
      | SoulRendStatus
      | undefined;
    if (!rend) {
      rend = {
        key: 'soulRend',
        name: 'Soul Rend',
        kind: 'soulRend',
        duration: Infinity,
        stacks: 0,
        ownerIndex: this.mages.indexOf(owner),
      };
      target.statuses.push(rend);
    }
    rend.stacks += count;
    rend.ownerIndex = this.mages.indexOf(owner);
    this.log(`${target.name} bears ${rend.stacks} Soul Rend stack${rend.stacks === 1 ? '' : 's'}.`);
  }

  private applySoulRendDamage(target: Mage): void {
    if (!target.alive) return;
    const rend = target.statuses.find((status) => status.kind === 'soulRend') as
      | SoulRendStatus
      | undefined;
    if (!rend || rend.stacks <= 0) return;
    const owner = this.mages[rend.ownerIndex] ?? target;
    const wasAlive = target.alive;
    const hpLoss = this.rng.roll(`${rend.stacks}d3`).total;
    target.hp = Math.max(target.unkillable ? 1 : 0, target.hp - hpLoss);
    let millLoss = 0;
    if (!target.isImmuneTo('sanity')) {
      millLoss = this.rng.roll(`${rend.stacks}d3`).total;
      target.sanity = Math.max(target.unkillable ? 1 : 0, target.sanity - millLoss);
    }
    this.log(
      `${target.name}'s Soul Rend (${rend.stacks}) tears away ${hpLoss} health and ${millLoss} mill.`
    );
    // The wound closes a little every time it bites.
    rend.stacks -= 1;
    if (rend.stacks <= 0) {
      target.statuses = target.statuses.filter((status) => status !== rend);
      this.log(`Soul Rend closes over on ${target.name}.`);
    }
    if (wasAlive && !target.alive) this.notifyMageDefeated(target, owner);
  }

  // ---- REAP / EXECUTE -------------------------------------------------------

  /** Reap stacks currently marking `target`. */
  reapOn(target: Mage): number {
    const reap = target.statuses.find((status) => status.kind === 'reap') as ReapStatus | undefined;
    return reap?.stacks ?? 0;
  }

  /** Add Reap stacks, then test the standing "dies at or below Reap" threshold. */
  applyReap(target: Mage, count: number, source: Mage): number {
    if (!target.alive || count <= 0) return this.reapOn(target);
    count += reapBonus(source);
    let reap = target.statuses.find((status) => status.kind === 'reap') as ReapStatus | undefined;
    if (!reap) {
      reap = { key: 'reap', name: 'Reap', kind: 'reap', duration: Infinity, stacks: 0 };
      target.statuses.push(reap);
    }
    reap.stacks += count;
    this.log(`${target.name} is marked with ${reap.stacks} Reap.`);
    this.checkReapDeath(target, source);
    return reap.stacks;
  }

  /** A reaped victim dies the moment its health falls to its Reap count (twice that under Long Night). */
  checkReapDeath(target: Mage, source: Mage): boolean {
    const reap = this.reapOn(target) - illusoryReap(this, target);
    if (reap <= 0 || !target.alive || target.hp > reap) return false;
    this.log(`${target.name} sinks to ${target.hp} health under ${reap} Reap.`);
    return this.killByDeathWord(target, source);
  }

  /**
   * Execute `target` at `amount` health, raised by 2 per Reap stack. An active
   * Death Curse swallows the attempt and converts it into Reap instead.
   */
  executeTarget(source: Mage, target: Mage, amount: number): boolean {
    if (!target.alive || amount <= 0) return false;
    if (this.deathCurseOn(target)) {
      this.log(`${target.name}'s Death Curse converts the execution into ${amount} Reap.`);
      this.applyReap(target, amount, source);
      return false;
    }
    const threshold = amount + executeBonus(source) + 2 * this.reapOn(target);
    if (target.hp > threshold) {
      this.log(`${target.name} escapes execution (${target.hp} health above ${threshold}).`);
      return false;
    }
    this.log(`${source.name} executes ${target.name} at ${threshold} health.`);
    return this.killByDeathWord(target, source);
  }

  /** Death-word kill that still honours unkillable targets, a phylactery and Death's own rites. */
  killByDeathWord(target: Mage, source: Mage): boolean {
    if (target.unkillable) return false;
    if (target.reviveAtHalfAvailable) {
      target.reviveAtHalfAvailable = false;
      target.hp = Math.max(1, Math.ceil(target.maxHp / 2));
      if (target.maxSanity > 0) target.sanity = target.maxSanity;
      this.log(`${target.name} revives at half HP.`);
      return false;
    }
    if (cheatDeath(this, target, source)) return false;
    target.hp = 0;
    this.vfxSink?.spellEffect?.(target, 'vanish');
    this.notifyMageDefeated(target, source);
    this.restoreEdgelordCaptives();
    return true;
  }

  deathCurseOn(target: Mage): DeathCurseStatus | undefined {
    return target.statuses.find((status) => status.kind === 'deathCurse') as
      | DeathCurseStatus
      | undefined;
  }

  /** Bind a target with a counting Death Curse. */
  applyDeathCurse(target: Mage, counters: number, owner: Mage): void {
    if (!target.alive || counters <= 0) return;
    const existing = this.deathCurseOn(target);
    if (existing) {
      existing.stacks = Math.max(existing.stacks, counters);
      existing.ownerIndex = this.mages.indexOf(owner);
      this.log(`${target.name}'s Death Curse deepens to ${existing.stacks} counters.`);
      return;
    }
    target.statuses.push({
      key: 'deathCurse',
      name: 'Death Curse',
      kind: 'deathCurse',
      duration: Infinity,
      stacks: counters,
      ownerIndex: this.mages.indexOf(owner),
    });
    this.log(`${target.name} is bound by a Death Curse (${counters} counters).`);
  }

  /** Drop one Death Curse counter for 2 Reap; the final counter executes. */
  tickDeathCurse(target: Mage, reason: string): void {
    const curse = this.deathCurseOn(target);
    if (!curse || !target.alive) return;
    const owner = this.mages[curse.ownerIndex] ?? target;
    curse.stacks -= 1;
    this.log(`${target.name}'s Death Curse ebbs on ${reason} (${Math.max(0, curse.stacks)} left).`);
    this.applyReap(target, 2, owner);
    if (curse.stacks > 0 || !target.alive) return;
    // Removed first so the curse cannot swallow its own closing execution.
    target.statuses = target.statuses.filter((status) => status !== curse);
    this.log(`${target.name}'s Death Curse runs out.`);
    this.executeTarget(owner, target, 1);
  }

  /** Grave Tithe: healing the curse's author adds a Reap stack to each bearer. */
  reapOnOwnerHeal(healed: Mage): void {
    const index = this.mages.indexOf(healed);
    if (index < 0) return;
    for (const mage of [...this.mages]) {
      if (!mage.alive) continue;
      const tithe = mage.statuses.find(
        (status) => status.kind === 'dot' && status.reapOnOwnerHealIndex === index
      ) as DotStatus | undefined;
      if (tithe) this.applyReap(mage, 1, healed);
    }
  }

  /** Reaper's Tithe: a dying bearer's Reap leaps to the nearest living enemy. */
  private transferReapOnDeath(target: Mage, source: Mage): void {
    const tithe = target.statuses.find(
      (status) => status.kind === 'dot' && status.reapTransferRadius != null
    ) as DotStatus | undefined;
    const stacks = this.reapOn(target);
    if (!tithe?.reapTransferRadius || stacks <= 0) return;
    const owner = (tithe.sourceIndex == null ? source : this.mages[tithe.sourceIndex]) ?? source;
    const heir = this.mages
      .filter(
        (mage) =>
          mage !== target &&
          mage.alive &&
          mage.team !== owner.team &&
          dist(mage.pos, target.pos) <= tithe.reapTransferRadius!
      )
      .sort((a, b) => dist(a.pos, target.pos) - dist(b.pos, target.pos))[0];
    if (!heir) return;
    target.statuses = target.statuses.filter((status) => status !== tithe);
    this.log(`${target.name}'s Reap leaps to ${heir.name}.`);
    this.applyReap(heir, stacks, owner);
  }

  /** Captives still living inside `bearer`'s lantern. */
  edgelordCaptives(bearer: Mage): Mage[] {
    return this.mages.filter((mage) => mage.edgelordCapturedBy === bearer && mage.vitalsAlive);
  }

  /** Whether a point lies inside any active Edgelord dark light. */
  isInEdgelordDarkLight(point: Vec2): boolean {
    return this.mages.some(
      (mage) =>
        mage.alive &&
        mage.hasEdgelordLantern() &&
        mage.edgelordLanternActive &&
        dist(mage.pos, point) <= EDGELORD_DARK_LIGHT_RADIUS
    );
  }

  /** Ordinary light is erased wherever an active Edgelord dark light overlaps it. */
  effectiveLightRadius(source: Mage): number {
    const radius = source.lightRadius();
    return radius > 0 && !this.isInEdgelordDarkLight(source.pos) ? radius : 0;
  }

  /**
   * Dagger of Shadow: an ABSOLUTE veil while the blade is held in shadow and the
   * round's toll is paid. Untargetable at any range and immune to dark light — and
   * because it is derived rather than stored, no strike, proximity or dispel can
   * tear it away.
   */
  hasShadowDaggerVeil(m: Mage): boolean {
    return (
      m.alive &&
      !!m.shadowDaggerTraits() &&
      !m.thunderGlowing() &&
      this.isInShadow(m) &&
      m.shadowDaggerStealthRound === this.round
    );
  }

  /** Ordinary veil is suppressed inside dark light; Shadow Veil is handled separately. */
  effectiveInvisibility(target: Mage): InvisibilityStatus | undefined {
    if (this.hasDeathMark(target)) return undefined;
    if (this.hasShadowDaggerVeil(target)) {
      return {
        key: 'item:shadow-dagger-stealth',
        name: 'Dagger of Shadow',
        kind: 'invisibility',
        duration: 1,
        mode: 'full',
      };
    }
    if (this.isInEdgelordDarkLight(target.pos)) return undefined;
    return target.getInvisibility();
  }

  private pullTowardLantern(
    target: Mage,
    bearer: Mage,
    distance: number
  ): { from: Vec2; to: Vec2 } | null {
    if (!target.alive || target === bearer) return null;
    const origin = target.pos;
    const destination = this.nearestFreePosition(target, stepTowards(origin, bearer.pos, distance), origin);
    target.x = destination.x;
    target.y = destination.y;
    this.notifyMageRelocation(target, origin, destination, false);
    return { from: origin, to: destination };
  }

  private async pullEdgelordUnits(bearer: Mage): Promise<void> {
    const targets = this.mages.filter(
      (mage) => mage.alive && mage !== bearer && dist(mage.pos, bearer.pos) <= EDGELORD_DARK_LIGHT_RADIUS
    );
    const motions = targets.flatMap((target) => {
      const motion = this.pullTowardLantern(target, bearer, 6 * RANGE_UNIT);
      return motion ? [{ target, ...motion }] : [];
    });
    this.updateAttachedScarabs();
    if (targets.length > 0) {
      this.log(`${bearer.name}'s Edgelord Lantern pulls ${targets.length} unit${targets.length === 1 ? '' : 's'} inward.`);
    }
    await Promise.all(
      motions.map(({ target, from, to }) =>
        this.vfxSink?.pull?.(target, from, to) ?? Promise.resolve()
      )
    );
  }

  /** Shake the bound lantern. Returns false when activation requirements are not met. */
  async shakeEdgelordLantern(bearer: Mage): Promise<boolean> {
    if (!bearer.alive || !bearer.hasEdgelordLantern()) return false;
    if (!bearer.edgelordLanternActive) {
      if (this.edgelordCaptives(bearer).length > 0 || bearer.mana < 4) return false;
      bearer.spendMana(4);
      bearer.edgelordLanternActive = true;
      bearer.edgelordLanternJustDeactivated = false;
      const afflicted = this.mages.filter(
        (mage) => mage.alive && dist(mage.pos, bearer.pos) <= EDGELORD_DARK_LIGHT_RADIUS
      );
      for (const mage of afflicted) this.applySoulRend(mage, 3, bearer);
      this.log(`${bearer.name} awakens the Edgelord Lantern for 4 mana.`);
      return true;
    }

    await this.pullEdgelordUnits(bearer);
    const captured: Mage[] = [];
    for (const target of this.mages) {
      if (!target.alive || target === bearer || dist(target.pos, bearer.pos) > 6 * RANGE_UNIT) continue;
      const marked = target.statuses.some(
        (status) => status.kind === 'soulRend' || status.name === 'REAP' || status.name === 'Soul Chain'
      );
      const lowHp = target.hp < 15 || target.hp < target.maxHp * 0.34;
      const lowMill = !target.isImmuneTo('sanity') && (target.sanity < 8 || target.sanity < target.maxSanity * 0.34);
      if (!marked || (!lowHp && !lowMill)) continue;
      target.edgelordCapturedBy = bearer;
      captured.push(target);
    }
    bearer.edgelordLanternActive = false;
    bearer.edgelordLanternJustDeactivated = true;
    if (captured.length > 0) {
      this.log(`${bearer.name}'s lantern devours ${captured.map((mage) => mage.name).join(', ')}.`);
    } else {
      this.log(`${bearer.name} seals the Edgelord Lantern, but it catches nothing.`);
    }
    return true;
  }

  private releaseEdgelordCaptives(bearer: Mage): Mage[] {
    const released = this.mages.filter((mage) => mage.edgelordCapturedBy === bearer && mage.vitalsAlive);
    for (let index = 0; index < released.length; index++) {
      const mage = released[index];
      mage.edgelordCapturedBy = undefined;
      const angle = (Math.PI * 2 * index) / Math.max(1, released.length);
      mage.x = Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, bearer.x + Math.cos(angle) * RANGE_UNIT));
      mage.y = Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, bearer.y + Math.sin(angle) * RANGE_UNIT));
    }
    if (released.length > 0) {
      this.log(`${bearer.name}'s death releases ${released.map((mage) => mage.name).join(', ')}.`);
    }
    return released;
  }

  /** Pay for and damage all captives at the start of the bearer's turn. */
  private applyEdgelordLanternUpkeep(bearer: Mage): void {
    const captives = this.edgelordCaptives(bearer);
    if (captives.length === 0) return;
    if (!bearer.alive || bearer.mana < 2) {
      if (bearer.alive && !bearer.unkillable) {
        bearer.hp = 0;
        bearer.sanity = 0;
        this.log(`${bearer.name} cannot feed the Edgelord Lantern and dies.`);
        this.notifyMageDefeated(bearer, bearer);
      }
      this.releaseEdgelordCaptives(bearer);
      return;
    }
    bearer.spendMana(2);
    this.log(`${bearer.name} feeds 2 mana to the Edgelord Lantern.`);
    for (const captive of captives) {
      const wasAlive = captive.vitalsAlive;
      captive.hp = Math.max(captive.unkillable ? 1 : 0, captive.hp - 10);
      if (!captive.isImmuneTo('sanity')) {
        captive.sanity = Math.max(captive.unkillable ? 1 : 0, captive.sanity - 5);
      }
      this.log(`${captive.name} suffers 10 true damage and 5 true mill inside the lantern.`);
      if (wasAlive && !captive.vitalsAlive) {
        captive.edgelordCapturedBy = undefined;
        this.log(`${captive.name} dies inside the Edgelord Lantern and disappears.`);
        this.notifyMageDefeated(captive, bearer);
      }
    }
  }

  /** Release living prisoners immediately after their bearer dies. */
  restoreEdgelordCaptives(): Mage[] {
    const released: Mage[] = [];
    for (const bearer of this.mages) {
      if (!bearer.vitalsAlive) released.push(...this.releaseEdgelordCaptives(bearer));
    }
    return released;
  }

  /** Active dark light lets ordinary walking ignore all solid collision. */
  edgelordCanPhaseWalk(source: Mage): boolean {
    return source.hasEdgelordLantern() && source.edgelordLanternActive;
  }

  /** Before any weapon attack, pull and damage every unit in the dark light. */
  async triggerEdgelordWeaponPulse(source: Mage): Promise<void> {
    if (!source.alive || !source.hasEdgelordLantern() || !source.edgelordLanternActive) return;
    await this.pullEdgelordUnits(source);
    const targets = this.mages.filter(
      (mage) => mage.alive && dist(mage.pos, source.pos) <= EDGELORD_DARK_LIGHT_RADIUS
    );
    for (const target of targets) {
      dealDamage(this.effectContext(source, target, null), target, dmg(2, 'shadow'), {
        canMiss: false,
        aoe: true,
        noImpactFx: true,
      });
    }
    this.log(`${source.name}'s dark light lashes every unit inside it.`);
  }

  /** Throw the loaded dormant lantern at a point and return it to its bearer. */
  throwEdgelordLantern(bearer: Mage, point: Vec2): boolean {
    if (
      !bearer.alive ||
      !bearer.hasEdgelordLantern() ||
      bearer.edgelordLanternActive ||
      this.edgelordCaptives(bearer).length === 0 ||
      dist(bearer.pos, point) > Math.max(0, bearer.effectiveStr()) * RANGE_UNIT
    ) return false;
    const impact = this.rng.roll('1d20').total;
    const mill = this.rng.roll('1d10').total;
    const targets = this.magesInRadius(point, 5 * RANGE_UNIT);
    for (const target of targets) {
      const ctx = this.effectContext(bearer, target, point);
      dealDamage(ctx, target, dmg(Math.ceil(impact * 0.51), 'shadow'), {
        canMiss: false,
        aoe: true,
        noImpactFx: true,
      });
      if (target.alive) {
        dealDamage(ctx, target, dmg(Math.floor(impact * 0.49), 'shatter'), {
          canMiss: false,
          aoe: true,
          noImpactFx: true,
        });
      }
      if (target.alive) {
        dealDamage(ctx, target, dmg(mill, 'sanity'), {
          canMiss: false,
          aoe: true,
          noImpactFx: true,
        });
      }
    }
    this.log(`${bearer.name} throws the Edgelord Lantern; it erupts and returns on its own.`);
    this.restoreEdgelordCaptives();
    return true;
  }

  /**
   * Apply per-turn DoT damage to `m`. Lives here (not on Mage) because some DoTs
   * are conditional on board state — e.g. range bands measured to the opponent,
   * or a chance to stun on each tick.
   */
  private applyRegeneration(m: Mage): void {
    for (const status of [...m.statuses]) {
      if (!m.alive) return;
      if (status.kind !== 'regen') continue;
      const owner = this.mages[status.ownerIndex] ?? m;
      heal(this.effectContext(owner, m, null), m, this.rng.roll(status.spec).total);
      if (status.hexEcho) hexEcho(this, m, status.hexEcho);
    }
  }

  private applyDotDamage(m: Mage): void {
    if (!m.alive) return;
    const opponent = this.opponentOf(m);
    const dots = m.statuses.filter((s) => s.kind === 'dot') as DotStatus[];
    for (const s of dots) {
      if (isCrusadeKind(m.enemyKind) && !m.alive) break;
      const source = s.sourceIndex == null ? undefined : this.mages[s.sourceIndex];
      if (source) this.triggerOniAmbush(source, m);
      if (s.band) {
        const d = opponent ? dist(opponent.pos, m.pos) : Infinity;
        if (d < s.band.min || d > s.band.max) {
          this.log(`${s.name} is dormant. ${m.name} is out of range.`);
          continue;
        }
      }
      if (s.whileSourceVeiled && (!source?.alive || !this.isVeiled(source))) {
        this.log(`${s.name} is dormant. ${source?.name ?? 'Its caster'} is not hidden.`);
        continue;
      }
      const amount = s.damageSpec
        ? Math.max(0, this.rng.roll(s.damageSpec).total)
        : s.escalateSpecs?.length
          ? Math.max(0, this.rng.roll(this.escalatingSpec(s)).total)
          : s.stacks && s.perStackSpec
            ? this.rollStackedDot(s)
            : Math.max(0, s.damage.amount);
      // Order Curse Drain: an extra bite when the bearer dealt no damage last turn.
      const bonus =
        s.bonusNoDamageSpec && !m.dealtDamageThisTurn
          ? Math.max(0, this.rng.roll(s.bonusNoDamageSpec).total)
          : 0;
      const total =
        (amount + bonus + this.hexcraftDamageBonus(s.damage.type) + lawDotBonus(this, m, s))
        * (isCrusadeBuilding(m) && s.damage.type === 'heat' ? 2 : 1);
      if (s.damage.type === 'sanity') m.sanity = Math.max(0, m.sanity - total);
      else m.hp = Math.max(0, m.hp - total);
      // Order Curse Drain: the curse's author drinks the damage as healing (a summon's curse feeds it and its summoner).
      if (s.lifestealToIndex !== undefined && total > 0 && m.enemyKind !== 'crusadeHelper') {
        const owner = this.mages[s.lifestealToIndex];
        if (owner && owner.alive && owner !== m) {
          this.vfxSink?.spellEffect?.(m, 'corrosive');
          this.vfxSink?.drainParticles?.(m.pos, owner.pos);
          for (const fed of drainFed(this, owner, source)) {
            if (fed !== m) heal(this.effectContext(fed, m, null), fed, total, s.lifestealPool ?? 'hp');
          }
        }
      }
      if (m.enemyKind !== 'crusadeHelper') {
        lawAfterDotTick(this, m, s, total);
        imbueOnDotTick(this, m, total);
      }
      if (total > 0) {
        this.vfxSink?.hit?.(m);
        // Several afflictions can tick at once, so each number names its cause.
        this.vfxSink?.combatFeedback?.(m, {
          kind: s.damage.type === 'sanity' ? 'sanityDamage' : 'damage',
          amount: total,
          damageType: s.damage.type,
          label: s.name,
        });
      }
      this.log(`${m.name} suffers ${total} ${s.damage.type} from ${s.name}.`);
      if (isCrusadeKind(m.enemyKind) && !m.alive) this.notifyMageDefeated(m, source ?? m);
      if (s.reapPerTick) this.applyReap(m, s.reapPerTick, source ?? m);
      if (total > 0) this.checkReapDeath(m, source ?? m);
      // An emptied mind cannot hold the virus, so it moves on even in death.
      if (s.jumpOnMindBreakRadius && m.sanity <= 0) this.jumpContagion(m, s);
      if (!m.alive) continue;
      if (s.hexEcho) hexEcho(this, m, s.hexEcho);
      if (!m.alive) continue;
      this.orbitDotSource(m, s);
      this.driftDot(m, s);
      if (!m.alive) continue;
      if (s.stifleOnTick && m.alive) applyStifle(this.quietContext(source ?? m, m), m);
      if (s.forgetPerTick) {
        // Duration 2: this runs before tickStatuses, so 1 would expire the same turn.
        applyForget(this.effectContext(source ?? m, m, m.pos), m, {
          count: s.forgetPerTick,
          duration: 2,
        });
      }
      if (s.spreadRadius) this.spreadContagion(m, s);
      if (s.splash && s.sourceTeam !== undefined) {
        for (const victim of this.mages) {
          if (victim === m || !victim.alive || victim.team === s.sourceTeam) continue;
          if (dist(victim.pos, m.pos) > s.splash.radius) continue;
          const splash =
            this.rng.roll(s.splash.damageSpec).total +
            this.hexcraftDamageBonus(s.splash.damage.type);
          if (s.splash.damage.type === 'sanity') {
            victim.sanity = Math.max(0, victim.sanity - splash);
          } else {
            victim.hp = Math.max(0, victim.hp - splash);
          }
          if (splash > 0) {
            this.vfxSink?.hit?.(victim);
          }
          this.log(`${s.name} splashes ${victim.name} for ${splash} ${s.splash.damage.type}.`);
        }
      }
      if (this.hasHexcraftGlobal('curseCorrode') && m.alive) {
        const corrosive = this.rng.roll('1d3').total;
        m.hp = Math.max(0, m.hp - corrosive);
        this.log(`${s.name} also corrodes ${m.name} for ${corrosive}.`);
      }
      if (s.stunChance && this.rng.chance(s.stunChance)) {
        const type = s.stunType ?? 'full';
        const labels: Record<typeof type, string> = {
          main: 'Disarmed',
          movement: 'Rooted',
          full: 'Stunned',
        };
        addOrExtendStatus(
          m.statuses,
          { key: `stun:${type}`, name: labels[type], kind: 'stun', duration: 2, stunType: type },
          false
        );
        this.log(`${s.name} seizes ${m.name}!`);
      }
      // Stacking upkeep: spread infection, then wane if no fresh stack landed.
      if (s.stacks !== undefined) {
        if (s.infectRadius && s.infectRadius > 0) this.spreadInfection(m, s);
        if (s.decayPerTick && !s.freshStack) {
          s.stacks -= 1;
          if (s.stacks <= 0) {
            s.duration = 0;
            this.log(`${s.name} burns out on ${m.name}.`);
          }
        }
        s.freshStack = false;
      }
    }
  }

  /** Dice this escalating DoT rolls now, advancing it one step toward its cap. */
  private escalatingSpec(s: DotStatus): string {
    const specs = s.escalateSpecs ?? [];
    const index = Math.min(s.escalateIndex ?? 0, specs.length - 1);
    s.escalateIndex = (s.escalateIndex ?? 0) + 1;
    return specs[index];
  }

  /**
   * Veil Corrode Curse: the plague jumps to every body near its host at half
   * the host's remaining duration, so each generation burns out faster. It does
   * not care whose side the neighbour is on.
   */
  private spreadContagion(host: Mage, s: DotStatus): void {
    const passed = Math.floor(s.duration / 2);
    if (passed < 1) return;
    for (const victim of this.mages) {
      if (victim === host || !victim.alive) continue;
      if (dist(victim.pos, host.pos) > s.spreadRadius!) continue;
      if (victim.isDebuffImmune()) continue;
      const carried: DotStatus = { ...s, duration: passed, escalateIndex: 0 };
      addOrExtendStatus(victim.statuses, carried, false);
      this.log(`${s.name} spreads from ${host.name} to ${victim.name} (${passed} cycles).`);
      if (s.spreadVeils) {
        applyInvisibility(this.effectContext(host, victim, victim.pos), victim, {
          duration: passed,
          mode: 'full',
        });
      }
    }
  }

  /** Mind Corrode Pierce: a broken mind cannot hold the virus, so it moves on. */
  private jumpContagion(host: Mage, s: DotStatus): void {
    const radius = s.jumpOnMindBreakRadius!;
    const candidates = this.mages
      .filter((m) => m !== host && m.alive && !m.isDebuffImmune())
      .filter((m) => dist(m.pos, host.pos) <= radius)
      .sort((a, b) => dist(a.pos, host.pos) - dist(b.pos, host.pos));
    const next = candidates[0];
    s.duration = 0;
    if (!next) return;
    addOrExtendStatus(next.statuses, { ...s, duration: 2, escalateIndex: 0 }, false);
    this.log(`${s.name} abandons ${host.name} and takes root in ${next.name}.`);
  }

  /** Roll a stacking DoT's damage: `perStackSpec` once per stack, summed. */
  private rollStackedDot(s: DotStatus): number {
    if (!s.perStackSpec || !s.stacks) return 0;
    let total = 0;
    for (let i = 0; i < s.stacks; i++) {
      total += Math.max(0, this.rng.roll(s.perStackSpec).total);
    }
    return total;
  }

  /**
   * Spread an infectious DoT from `bearer` to the owner's other enemies within
   * range that do not already carry it. Each new host starts at one stack.
   */
  private spreadInfection(bearer: Mage, s: DotStatus): void {
    const radius = s.infectRadius ?? 0;
    if (radius <= 0) return;
    for (const other of this.mages) {
      if (other === bearer || !other.alive) continue;
      if (s.sourceTeam !== undefined && other.team === s.sourceTeam) continue;
      if (dist(other.pos, bearer.pos) > radius) continue;
      const has = other.statuses.some((st) => st.key === s.key && st.kind === 'dot');
      if (has) continue;
      other.statuses.push({
        key: s.key,
        name: s.name,
        kind: 'dot',
        duration: s.duration,
        damage: s.damage,
        perStackSpec: s.perStackSpec,
        stacks: 1,
        maxStacks: s.maxStacks,
        freshStack: true,
        decayPerTick: s.decayPerTick,
        infectRadius: s.infectRadius,
        sourceTeam: s.sourceTeam,
      });
      this.syncCurseCorrodeSlow(other);
      this.log(`${s.name} spreads to ${other.name}!`);
    }
  }

  /**
   * Drop a shadow at `m`'s feet if it carries a Shadow Trail status. Called after
   * the mage repositions so the trail follows its movement.
   */
  dropTrailShadows(m: Mage): void {
    if (!m.alive) return;
    const trail = m.statuses.find((s) => s.kind === 'shadowTrail') as
      | ShadowTrailStatus
      | undefined;
    if (trail) this.addShadow({ x: m.pos.x, y: m.pos.y }, trail.team, trail.perShadowTtl);
    this.triggerNeedlepointDomains(m);
  }

  /**
   * Shove `target` directly away from `source` by `units` range-units (War
   * Hammer). Clamped to the field, reality barriers, Mutivarg zones and the
   * other mage's body so it never phases through obstacles. Deterministic, so it
   * stays in lockstep online.
   */
  knockbackMage(source: Mage, target: Mage, units: number): void {
    if (!target.alive) return;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const len = Math.hypot(dx, dy) || 1;
    const reach = units * RANGE_UNIT;
    this.log(`${target.name} is knocked back!`);
    this.forceMove(source, target, {
      x: target.x + (dx / len) * reach,
      y: target.y + (dy / len) * reach,
    });
  }

  /**
   * Displace an unwilling `target` toward `rawDest`. Barriers, Mutivarg zones
   * and bodies all stop the slide, but only a wall or the field edge counts as
   * an immovable obstacle: being stopped by one slams the target for 2d6
   * shatter, matching Twist's quarter-turn rule. Returns whether it slammed.
   */
  forceMove(source: Mage, target: Mage, rawDest: Vec2): boolean {
    if (!target.alive) return false;
    if (target.displacementImmune || target.holdsGround()) {
      this.log(`${target.name} cannot be moved.`);
      return false;
    }
    if (this.isImmovable(target)) {
      this.log(`${target.name} is fixed in place and cannot be moved.`);
      return false;
    }
    const origin = target.pos;
    // Easily shoved: the throw carries twice as far from where it started.
    const wanted = target.displacementWeak
      ? { x: origin.x + (rawDest.x - origin.x) * 2, y: origin.y + (rawDest.y - origin.y) * 2 }
      : rawDest;
    const fieldDest = {
      x: Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, wanted.x)),
      y: Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, wanted.y)),
    };
    const hitBorder = dist(fieldDest, wanted) > 0.5;
    const barrier = this.clampToBarriers(origin, fieldDest, target.bodyRadius());
    const mut = this.clampToMutivargZones(target, origin, barrier.dest);
    const dest = this.nearestFreePosition(target, this.clampToMages(target, origin, mut.dest), origin, true);
    target.x = dest.x;
    target.y = dest.y;
    this.notifyMageRelocation(target, origin, dest, true);
    this.updateAttachedScarabs();
    this.dropTrailShadows(target);
    const slammed = hitBorder || barrier.blocked;
    if (slammed) {
      this.log(`${target.name} is slammed into something immovable!`);
      this.slamDamage(this.effectContext(source, target, null), target, this.rng.roll('2d6').total, 'shatter');
    }
    if (dist(origin, dest) > 0.5) this.lawShoved(source, target);
    return slammed;
  }

  /** `target` was just moved by force (pushed, dragged, swept, swapped or flung): the laws that answer it. */
  lawShoved(source: Mage, target: Mage): void {
    lawOnShoved(this, source, target);
  }

  /** What Shadow gear and minion auras add to a hit of `type` from `source` on `target`. */
  hitAmplifier(source: Mage, target: Mage, type: DamageType): number {
    return hitAmplifier(this, source, target, type);
  }

  /** How much higher `m`'s Lightning power runs (Gloom Lantern, Black Storm). */
  lightningAmplifier(m: Mage): number {
    return lightningAmplifier(this, m);
  }

  /** A slam into a wall or the field edge. Crushing Law doubles it and adds acid; Panic Tide adds dread; Grinding Thirst drinks. */
  slamDamage(ctx: EffectContext, target: Mage, amount: number, type: DamageType, opts: DealDamageOptions = {}): void {
    if (!target.alive) return;
    const slam = lawSlam(this);
    dealDamage(ctx, target, dmg(amount * slam.mult, type), { ...opts, canMiss: false });
    for (const extra of slam.extras) {
      if (!target.alive) break;
      const dealt = dealDamage(ctx, target, dmg(this.rng.roll(extra.spec).total, extra.type), { ...opts, canMiss: false });
      if (extra.drink && ctx.caster !== target) drink(this, ctx.caster, dealt);
    }
  }

  /**
   * After landing a hit, let `source` dash up to `units` range-units to a chosen
   * spot (Lunging Edge). The destination is picked through the sub-targeter, so
   * it is relayed identically to both peers online; absent a sub-targeter
   * (headless), it is a no-op.
   */
  async dashAfterHit(source: Mage, units: number): Promise<void> {
    if (!source.alive) return;
    const picked = this.subTargeter
      ? await this.subTargeter.requestPoint(source, {
          maxRange: units * RANGE_UNIT,
          prompt: `${source.name}: dash up to ${units} tiles (click a spot, Esc to stay).`,
        })
      : null;
    if (!picked) return;
    const origin = source.pos;
    const fieldDest = {
      x: Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, picked.x)),
      y: Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, picked.y)),
    };
    const clamp = this.clampToBarriers(source.pos, fieldDest, source.bodyRadius());
    const mut = this.clampToMutivargZones(source, source.pos, clamp.dest);
    const dest = this.clampToMages(source, source.pos, mut.dest);
    const step = Math.hypot(dest.x - source.x, dest.y - source.y);
    source.x = dest.x;
    source.y = dest.y;
    this.notifyMageRelocation(source, origin, dest, true);
    source.movedThisTurn = true;
    source.distMovedThisTurn += step;
    this.updateAttachedScarabs();
    this.dropTrailShadows(source);
    this.log(`${source.name} dashes ${units} tiles after the blow.`);
  }

  private applyControlOnTurnStart(m: Mage): void {
    const ctrl = m.statuses.find((s) => s.kind === 'control') as ControlStatus | undefined;
    if (ctrl && ctrl.mode === 'expose') {
      // Their intentions are laid bare — they cannot hold a reaction this turn.
      m.reactionAvailable = false;
      m.reactedThisCycle = true;
    }
  }

  /** The compulsion currently gripping `m`, if any. */
  controlOf(m: Mage): ControlStatus | undefined {
    return m.statuses.find((s) => s.kind === 'control') as ControlStatus | undefined;
  }

  resolveCreatureCompulsion(m: Mage): boolean {
    if (m.crocodileGrip?.alive && m.alive) {
      const captor = m.crocodileGrip;
      if (this.rng.die(3) === 3) {
        m.crocodileGrip = undefined;
        this.log(`${m.name} breaks free of ${captor.name}.`);
      } else this.log(`${m.name} struggles in ${captor.name}'s jaws.`);
      return true;
    }
    if (!m.sirenCharm?.alive || !m.alive) {
      m.sirenCharm = undefined;
      return false;
    }
    const siren = m.sirenCharm;
    const ally = this.mages.find((candidate) => candidate.alive && candidate !== m && candidate.team === m.team &&
      dist(candidate.pos, m.pos) <= 3 * RANGE_UNIT);
    if (ally) {
      this.log(`${siren.name} forces ${m.name} to strike ${ally.name}.`);
      dealDamage(this.effectContext(m, ally, null), ally, dmg(this.rng.roll('1d4').total, 'slashing'), { canMiss: false });
    } else {
      this.log(`${siren.name} lures ${m.name} closer.`);
      this.leapMove(m, stepTowards(m.pos, siren.pos, 3 * RANGE_UNIT));
    }
    return true;
  }

  // ---- Area queries ---------------------------------------------------------

  /** Alive mages within `radius` of `center` (optionally excluding one). */
  magesInRadius(center: Vec2, radius: number, exclude?: Mage): Mage[] {
    // Count a body whose hull overlaps the circle, not just its centre — so a
    // tight blast still catches every creature packed into the area.
    return this.mages.filter(
      (m) => m.alive && m !== exclude && dist(m.pos, center) <= radius + m.bodyRadius()
    );
  }

  /** Alive mages inside a cone from `origin` aimed at `toward`. */
  magesInCone(
    origin: Vec2,
    toward: Vec2,
    range: number,
    degrees: number = CONE_DEGREES,
    exclude?: Mage
  ): Mage[] {
    const base = Math.atan2(toward.y - origin.y, toward.x - origin.x);
    const half = ((degrees * Math.PI) / 180) / 2;
    return this.mages.filter((m) => {
      if (!m.alive || m === exclude) return false;
      const d = dist(m.pos, origin);
      // Include a body whose hull reaches into the cone's length.
      if (d === 0 || d > range + m.bodyRadius()) return false;
      const ang = Math.atan2(m.y - origin.y, m.x - origin.x);
      let diff = Math.abs(ang - base);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      // Nudge the arc out just enough to catch a body clipping the cone edge,
      // but never more than half its own width — so a narrow cone stays narrow.
      const angPad = d > 0 ? Math.min(Math.atan2(m.bodyRadius(), d), half * 0.5, 0.15) : 0;
      return diff <= half + angPad;
    });
  }

  /**
   * Cannot be targeted right now. A true (full) veil can only be targeted from
   * within close range — pass `from` to apply that distance rule. A half veil
   * is always targetable (its protection is the dodge, resolved on the hit).
   */
  isUntargetable(m: Mage, from?: Mage, opts: { ignoreStealth?: boolean } = {}): boolean {
    if (m.summonShoulder != null) return true;
    // Baral's vanish after his first wound: nothing finds him until his next turn.
    if (m.baral?.vanished) return true;
    // Phased into the dark: it does not exist for anyone, friend or foe.
    if (this.isPhasedOut(m) || this.isInSanctuary(m)) return true;
    // Riding a host: only area effects can pick it out.
    if (m.attachedToIndex != null && this.mages[m.attachedToIndex]?.alive) return true;
    // The dagger's veil is absolute — no distance rule softens it.
    if (!opts.ignoreStealth && !this.hasDeathMark(m) && this.hasShadowDaggerVeil(m)) return true;
    // Second Ring of Lareneg: untouchable to hostiles during turn cycles 3 & 4.
    if (from && from.team !== m.team && this.isLaranegUntouchable(m)) return true;
    // Sealed in the dark: hidden from its own side, still reachable by the sealer.
    if (
      from &&
      m.statuses.some((s) => s.kind === 'seal' && (s as SealStatus).blindTeam === from.team)
    ) {
      return true;
    }
    // A blind spot is a hole in the viewer's mind, not concealment on the target.
    if (from && this.cannotPerceive(from, m)) return true;
    if (from && this.perceptionFrozen(from, m)) return true;
    if (from && lawQuarantines(this, m, from)) return true;
    if (from && from.team !== m.team && this.shroudingMinion(m)) return true;
    // Marked for death: nothing hides it.
    if (opts.ignoreStealth || this.hasDeathMark(m)) return false;
    if (from && from !== m && this.sightBlocked(from.pos, m.pos)) return true;
    if (m.oniHidden) return true;
    const inv = this.effectiveInvisibility(m);
    if (inv?.mode === 'full') {
      if (!from) return true;
      return dist(from.pos, m.pos) > VEIL.full.targetableDist * RANGE_UNIT;
    }
    if (m.statuses.some((s) => s.kind === 'shadowVeil') && this.isInShadow(m)) return true;
    return false;
  }

  /**
   * Second Ring of Lareneg: during turn cycles 3 and 4 the wearer cannot be
   * affected by anything hostile — no damage, stuns, movement impairment or
   * debuffs. "You basically do not exist to anything hostile."
   */
  isLaranegUntouchable(m: Mage): boolean {
    return m.hasLaranegRing() && (this.round === 3 || this.round === 4);
  }

  /** Nothing hostile may reach this mage right now, whatever the source. */
  isUnreachable(m: Mage): boolean {
    return !!m.baral?.vanished || this.isPhasedOut(m) || this.isLaranegUntouchable(m) || this.isInSanctuary(m);
  }

  /**
   * Collapse ANY veil (half or full) whose bearer now has an enemy standing
   * within {@link VEIL.proximityBreak} range units. Call this after any movement
   * resolves and at the start of each turn.
   */
  breakProximityVeils(): void {
    const reach = VEIL.proximityBreak * RANGE_UNIT;
    for (const m of this.mages) {
      const inv = m.getInvisibility();
      if (!inv) continue;
      const enemyClose = this.mages.some(
        (e) => e !== m && e.team !== m.team && e.alive && dist(e.pos, m.pos) <= reach
      );
      if (enemyClose) {
        m.statuses = m.statuses.filter((s) => s.kind !== 'invisibility');
        this.log(`${m.name}'s veil breaks. An enemy is within 2cm.`);
      }
    }
  }

  /**
   * An active shield-bash reaction: the basher smashes an adjacent attacker
   * once per duel. Returns true if the bash landed.
   */
  shieldBash(basher: Mage, attacker: Mage): boolean {
    const bashMult = basher.shieldBashMult();
    if (bashMult == null || !basher.alive || !attacker.alive) return false;
    if (dist(attacker.pos, basher.pos) > MELEE_RANGE) return false;
    basher.shieldBashUsed = true;
    const bashFlat = basher.profile.blackPrimaryTier ? 1 : 0;
    const bashDmg = Math.max(
      1,
      strengthDamage(this.rng.roll('1d6').total, basher.effectiveStr(), bashMult) + bashFlat
    );
    this.log(`${basher.name} smashes back with the shield!`);
    const back = this.effectContext(basher, attacker, null);
    dealDamage(back, attacker, dmg(bashDmg, 'shatter'), { canMiss: false });
    return true;
  }

  /** Throw a consumable weapon (e.g. Throwing Dagger) at a target, consuming one. */
  throwItem(source: Mage, target: Mage, itemId: ItemId): void {
    const def = getItem(itemId);
    const spec = def.throwable;
    if (!spec) return;
    const store = source.pouch.includes(itemId) ? source.pouch : source.utility;
    const i = store.indexOf(itemId);
    if (i < 0) return;
    store.splice(i, 1);
    if (source.readyConsumable === itemId) source.readyConsumable = null;
    this.log(`${source.name} hurls ${def.name} at ${target.name}.`);
    const ctx = this.effectContext(source, target, null);
    const dealt = spec.rollSpec
      ? dealDamage(ctx, target, dmg(this.rng.roll(spec.rollSpec).total, spec.type ?? 'pierce'), { canMiss: false })
      : 0;
    if (spec.onHit && target.alive) {
      runHitEffects({ striker: source, victim: target, dealt, drinker: source, ctx: this.quietContext(source, target) }, spec.onHit);
    }
  }

  /** Mantle of Eldritch Truth: resolve the chosen Eldritch action. */
  useEldritch(source: Mage, choice: 'attack' | 'defend' | 'restore', target: Mage | null): void {
    switch (choice) {
      case 'attack': {
        if (!target || !target.alive) return;
        this.log(`${source.name} unleashes eldritch truth upon ${target.name}!`);
        const ctx = this.effectContext(source, target, null);
        dealDamage(ctx, target, dmg(10, 'shatter'), { canMiss: false, trueDamage: true });
        break;
      }
      case 'defend': {
        source.eldritchDefend = true;
        this.log(`${source.name} defends. Immune to all damage until their next turn.`);
        break;
      }
      case 'restore': {
        source.hp = Math.min(source.maxHp, source.hp + 5);
        source.gainMana(10);
        source.grantEldritchCharges(2);
        this.log(`${source.name} restores 5 HP, 10 mana, and 2 of each word.`);
        break;
      }
    }
  }

  // ---- Blessing of Roaring Thunder -----------------------------------------

  /** Start-of-turn glow / burn / lethal check for a Thunder-blessed mage. */
  private applyThunderBlessing(m: Mage): void {
    if (!m.alive || !m.hasThunderBlessing()) return;
    if (this.checkThunderDeath(m)) return;
    const s = m.thunderStacks;
    if (s < 9) return;
    const self = this.effectContext(m, m, null);
    if (s >= 14) {
      const fire = this.rng.roll('1d20').total;
      const mill = this.rng.roll('1d10').total;
      this.log(`Roaring thunder ravages ${m.name} (${fire} fire, ${mill} mill).`);
      this.vfxSink?.boom?.(m.pos);
      dealDamage(self, m, dmg(fire, 'heat'), { canMiss: false });
      dealDamage(self, m, dmg(mill, 'sanity'), { canMiss: false });
      const blast = 10 * RANGE_UNIT;
      for (const other of this.mages) {
        if (other === m || !other.alive) continue;
        if (dist(other.pos, m.pos) > blast) continue;
        const ctx = this.effectContext(m, other, null);
        const light = this.rng.roll('1d6').total;
        dealDamage(ctx, other, dmg(light, 'light'), { canMiss: false });
      }
    } else if (s >= 12) {
      const fire = this.rng.roll('1d6').total;
      const mill = this.rng.roll('1d3').total;
      this.log(`${m.name} smoulders under the blessing (${fire} fire, ${mill} mill).`);
      dealDamage(self, m, dmg(fire, 'heat'), { canMiss: false });
      dealDamage(self, m, dmg(mill, 'sanity'), { canMiss: false });
    } else {
      const fire = this.rng.roll('1d3').total;
      this.log(`${m.name} glows with roaring thunder (${fire} fire).`);
      dealDamage(self, m, dmg(fire, 'heat'), { canMiss: false });
    }
    this.checkThunderDeath(m);
  }

  /** Detonate a Thunder-blessed mage that has reached 15 stacks. Returns true if it fired. */
  checkThunderDeath(m: Mage): boolean {
    if (!m.alive || !m.hasThunderBlessing() || m.thunderStacks < 15) return false;
    this.log(`${m.name} is consumed by roaring thunder and erupts!`);
    const blast = 10 * RANGE_UNIT;
    for (const other of this.mages) {
      if (other === m || !other.alive) continue;
      if (dist(other.pos, m.pos) > blast) continue;
      const ctx = this.effectContext(m, other, null);
      const fire = this.rng.roll('1d20').total;
      const blaze = this.rng.roll('1d20').total;
      dealDamage(ctx, other, dmg(fire, 'heat'), { canMiss: false });
      dealDamage(ctx, other, dmg(blaze, 'heat'), { canMiss: false });
    }
    m.thunderStacks = 0;
    m.hp = 0;
    return true;
  }

  /** Charge Up (bonus): pay mana + 1d6 true damage to roll d4 extra stacks & color charges. */
  chargeUpThunder(source: Mage): void {
    if (!source.hasThunderBlessing()) return;
    const cost = Math.min(15, Math.floor(source.mana * 0.33));
    source.spendMana(cost);
    const self = this.effectContext(source, source, null);
    const bite = this.rng.roll('1d6').total;
    this.log(`${source.name} charges Thunder. Spends ${cost} mana and takes ${bite} true damage.`);
    dealDamage(self, source, dmg(bite, 'heat'), { canMiss: false, trueDamage: true });
    if (!source.alive) return;
    const gained = this.rng.roll('1d4').total;
    source.addThunderStacks(gained);
    source.colorCharges = Math.min(source.maxColorCharges, source.colorCharges + gained);
    this.log(`${source.name} gains ${gained} Thunder stacks and color charges (now ${source.thunderStacks} stacks).`);
    this.checkThunderDeath(source);
  }

  /** Bounce schedule (range + damage %) for a Discharge of `stacks` stacks. */
  private thunderDischargeSchedule(stacks: number): { rangePx: number; pct: number }[] {
    const U = RANGE_UNIT;
    if (stacks >= 14)
      return [
        { rangePx: Infinity, pct: 3.0 },
        { rangePx: 30 * U, pct: 2.0 },
        { rangePx: 20 * U, pct: 1.0 },
        { rangePx: 10 * U, pct: 0.51 },
      ];
    if (stacks >= 10)
      return [
        { rangePx: 20 * U, pct: 1.51 },
        { rangePx: 14 * U, pct: 1.0 },
        { rangePx: 7 * U, pct: 0.76 },
        { rangePx: 4 * U, pct: 0.51 },
        { rangePx: 1 * U, pct: 0.26 },
      ];
    if (stacks >= 7)
      return [
        { rangePx: 14 * U, pct: 1.0 },
        { rangePx: 7 * U, pct: 0.76 },
        { rangePx: 4 * U, pct: 0.51 },
        { rangePx: 1 * U, pct: 0.26 },
      ];
    if (stacks >= 4)
      return [
        { rangePx: 7 * U, pct: 0.76 },
        { rangePx: 3 * U, pct: 0.51 },
        { rangePx: 1 * U, pct: 0.26 },
      ];
    return [
      { rangePx: 4 * U, pct: 0.51 },
      { rangePx: 1 * U, pct: 0.26 },
    ];
  }

  /** Furthest reach at which Discharge can pick its first (primary) target. */
  thunderDischargeRange(stacks: number): number {
    return this.thunderDischargeSchedule(stacks)[0].rangePx;
  }

  /** Discharge (bonus): dump all stacks as a player-directed bouncing lightning chain. */
  async dischargeThunder(source: Mage, primary: Mage): Promise<void> {
    if (!source.hasThunderBlessing()) return;
    const stacks = source.thunderStacks;
    if (stacks <= 0) {
      this.log(`${source.name} has no Thunder to discharge.`);
      return;
    }
    const schedule = this.thunderDischargeSchedule(stacks);
    this.log(`${source.name} discharges ${stacks} Thunder stacks in a chain of lightning!`);
    if (stacks > 9) this.vfxSink?.thunder?.(source.pos);
    source.thunderStacks = 0;
    const struck = new Set<Mage>();
    let fromPos = source.pos;
    let preferred: Mage | null = primary;
    for (let hopIndex = 0; hopIndex < schedule.length; hopIndex++) {
      const hop = schedule[hopIndex];
      const candidates = this.mages
        .filter((mage) => mage.alive && !struck.has(mage) && dist(fromPos, mage.pos) <= hop.rangePx)
        .sort((a, b) => {
          const distanceDelta = dist(fromPos, a.pos) - dist(fromPos, b.pos);
          return distanceDelta || this.mages.indexOf(a) - this.mages.indexOf(b);
        });
      if (candidates.length === 0) break;

      let target = preferred && candidates.includes(preferred) ? preferred : null;
      if (!target) {
        const picked = this.subTargeter
          ? await this.subTargeter.requestCombatant(source, {
              candidates,
              range: hop.rangePx,
              origin: fromPos,
              prompt: `${source.name}: choose lightning arc ${hopIndex + 1}/${schedule.length}.`,
            })
          : candidates[0];
        target = picked && candidates.includes(picked) ? picked : candidates[0];
      }
      if (!target) break;

      await this.vfxSink?.lightningBolt?.(fromPos, target.pos);
      this.dealThunderBolt(source, target, stacks, hop.pct);
      await this.subTargeter?.resolveImpacts();
      struck.add(target);
      fromPos = target.pos;
      preferred = null;
    }
    // A 14-stack overcharge also arcs back into the caster (51%).
    if (stacks >= 14 && source.alive) {
      await this.vfxSink?.lightningBolt?.(fromPos, source.pos);
      this.dealThunderBolt(source, source, stacks, 0.51);
      await this.subTargeter?.resolveImpacts();
    }
    this.checkThunderDeath(source);
  }

  /** One lightning bounce: (stacks)d3 x pct, armour-ignoring heat. */
  private dealThunderBolt(source: Mage, target: Mage, stacks: number, pct: number): void {
    const dice = this.showRoll(`${stacks}d3`, 'Thunder Discharge', target).total;
    const total = Math.ceil(dice * pct); // reduce dice by % but round favourably
    if (total <= 0) return;
    const ctx = this.effectContext(source, target, null);
    // Dealt as a single armour-ignoring heat bolt for clarity.
    dealDamage(ctx, target, dmg(total, 'heat'), { canMiss: false, ignoreArmor: true });
    this.log(`Lightning strikes ${target.name} for ${total} (${Math.round(pct * 100)}%).`);
  }

  // ---- Stack ----------------------------------------------------------------

  pushStack(item: StackItem): void {
    onDeclare(this, item);
    const declaredTarget = item.target;
    this.markTargetOrigin(item);
    this.consumeMemoryShackle(item);
    // Anything but walking burns the fuse. A reaction is counted at its window,
    // so a reaction spell must not be charged twice here.
    if (item.kind !== 'move' && item.respondingTo == null) this.burnMindFuse(item.source);
    if (
      declaredTarget?.alive &&
      declaredTarget.team !== item.source.team &&
      declaredTarget.mine?.kind === 'golem' &&
      declaredTarget.mine.golemState === 'dormant'
    ) {
      declaredTarget.mine.golemState = 'waking';
      this.log(`${declaredTarget.name}'s runes kindle as it is targeted.`);
    }
    this.stack.push(item);
  }

  canCastSpellNow(spell: Spell): boolean {
    if (spell.turnOnly && this.stack.length > 0) return false;
    return this.stack.length >= (spell.minStackDepth ?? 0);
  }

  /**
   * Point a declared single-target spell or basic attack at `to` instead. `force`
   * skips the targeting rules, so a spell can be turned back on its own caster.
   */
  retarget(item: StackItem, to: Mage, force = false): boolean {
    let fresh: StackItem;
    if (item.kind === 'spell' && item.spell) {
      fresh = this.makeSpellItem(
        item.source, item.spell, to, item.targetPoint ?? null, item.respondingTo, item.targetPoint2 ?? null, item.modifiers
      );
    } else if (item.kind === 'melee') {
      fresh = this.makeMeleeItem(item.source, to);
    } else {
      return false;
    }
    item.target = to;
    item.description = fresh.description;
    item.resolve = fresh.resolve;
    item.isStillValid = force ? () => item.source.alive && to.alive : fresh.isStillValid;
    return true;
  }

  /** (Re)open the evasion window: record where the declared target stands now. */
  markTargetOrigin(item: StackItem): void {
    if (item.target) item.targetOrigin = { x: item.target.x, y: item.target.y };
  }

  /**
   * How far a declared target must travel to slip `item` entirely, or null when
   * the item is not a single-target attack. Scales with the attack's reach, so a
   * sidestep beats a sword while a bowshot demands real ground.
   */
  private evasionDistance(item: StackItem): number | null {
    const target = item.target;
    if (!target || target === item.source || target.team === item.source.team) return null;
    let reach: number;
    if (item.kind === 'melee') {
      reach = item.source.activeWeapon()?.rangePx ?? item.source.intrinsicMeleeReach ?? MELEE_RANGE;
    } else if (item.kind === 'spell' && item.spell) {
      reach = item.spell.range;
    } else if (item.kind === 'action' && item.hostileAttack) {
      reach = MELEE_RANGE;
    } else {
      return null;
    }
    return Math.max(MAGE_BODY_RADIUS * 0.5, reach * EVASION_REACH_FRACTION);
  }

  /** True once the target has covered enough ground to be missed outright. */
  attackEvaded(item: StackItem): boolean {
    const target = item.target;
    if (!target || !item.targetOrigin) return false;
    const needed = this.evasionDistance(item);
    if (needed == null) return false;
    return dist(item.targetOrigin, target.pos) >= needed;
  }

  nullifyStack(): StackItem[] {
    return this.stack.splice(0, this.stack.length);
  }

  removeStackItem(id: number): void {
    const idx = this.stack.findIndex((i) => i.id === id);
    if (idx >= 0) this.stack.splice(idx, 1);
  }

  // ---- Targeting helpers ----------------------------------------------------

  /**
   * White-secondary identity: whenever the caster finishes one of their colour
   * spells, they and their nearest ally (within range 5) recover just under 1%
   * of max HP per charge the spell cost (min 1 total), up to three charges'
   * worth. Applies to EVERY colour ability regardless of its colour.
   */
  private applyWhiteSecondaryHeal(caster: Mage, spell: Spell): void {
    if (!caster.profile.whiteSecondaryTier) return;
    const chargeCost = (spell as { chargeCost?: number }).chargeCost;
    if (chargeCost === undefined) return; // not a colour ability
    const per = Math.floor(caster.maxHp * 0.005); // just under 1% per charge
    const amount = Math.max(1, per * Math.min(3, chargeCost));
    heal(this.effectContext(caster, caster, null), caster, amount);
    const allies = this.mages
      .filter((m) => m.alive && m !== caster && m.team === caster.team)
      .filter((m) => Math.hypot(m.x - caster.x, m.y - caster.y) <= 5 * RANGE_UNIT);
    if (allies.length > 0) {
      allies.sort(
        (a, b) =>
          Math.hypot(a.x - caster.x, a.y - caster.y) -
          Math.hypot(b.x - caster.x, b.y - caster.y)
      );
      heal(this.effectContext(caster, allies[0], null), allies[0], amount);
    }
  }

  /** Goblin Shaman: mend a goblin by 3 and hasten it by half its pace. Every mending stacks. */
  goblinMend(source: Mage, target: Mage): void {
    if (!source.alive || !target.alive) return;
    const ctx = this.effectContext(source, target, null);
    heal(ctx, target, GOBLIN_MEND_HP);
    target.statuses.push({
      key: `goblin-haste:${this.nextId++}`,
      name: 'Goblin Haste',
      kind: 'debuff',
      duration: GOBLIN_RITE_TURNS,
      mods: { moveRange: Math.round(target.baseMoveRange() * GOBLIN_HASTE) },
    });
    this.log(`${target.name} is hastened: +${Math.round(GOBLIN_HASTE * 100)}% move for ${GOBLIN_RITE_TURNS - 1} turns.`);
  }

  /** Goblin Shaman: slow a foe by a quarter of its pace. Every hex stacks. */
  goblinHex(source: Mage, target: Mage): void {
    if (!source.alive || !target.alive) return;
    applyDebuff(this.effectContext(source, target, null), target, {
      name: 'Goblin Hex',
      key: `goblin-hex:${this.nextId++}`,
      duration: GOBLIN_RITE_TURNS,
      mods: { moveRange: -Math.round(target.baseMoveRange() * GOBLIN_HEX) },
    });
  }

  /** A fleeing goblin that reached the edge of the field is gone from the fight. */
  goblinEscape(goblin: Mage): void {
    if (!goblin.alive) return;
    goblin.withdrawn = true;
    this.log(`${goblin.name} flees the battle.`);
  }

  // ---- Baral, Artificer of Nope ----------------------------------------------

  /** Drakes Baral calls up mid-action; the scene raises them once the action settles. */
  pendingDrakes: { baral: Mage; count: number }[] = [];
  pendingCrusadeHelpers: { team: number; afterTurn: number }[] = [];

  /** The living Artifacts of Denial that answer `item`: a party action, never a bare reaction window. */
  private artifactsAgainst(item: StackItem): Mage[] {
    if (item.windowTrigger) return [];
    return this.mages.filter((m) => m.alive && !!m.denial && m.team !== item.source.team);
  }

  /**
   * An armed Artifact of Denial stifles `item`: it never resolves, its actor takes
   * 1 mill, and the artifact's charges are spent. Only the first armed one
   * answers; the others keep theirs for the next action. Returns the artifact.
   */
  stifleByDenial(item: StackItem): Mage | null {
    const artifact = this.artifactsAgainst(item).find(denialArmed);
    if (!artifact?.denial) return null;
    artifact.denial.charges = 0;
    this.log(`${artifact.name} says no: ${item.source.name}'s ${item.label} is stifled.`);
    this.vfxSink?.combatFeedback?.(item.source, { kind: 'blocked', label: 'STIFLED' });
    if (item.source.alive) {
      dealDamage(
        { ...this.effectContext(artifact, item.source, null), crit: false },
        item.source,
        dmg(DENIAL_STIFLE_MILL, 'sanity'),
        { canMiss: false, noImpactFx: true }
      );
    }
    return artifact;
  }

  /** A party action went through: every Artifact of Denial gains a charge, up to what arms it. */
  chargeDenial(item: StackItem): void {
    for (const artifact of this.artifactsAgainst(item)) {
      const d = artifact.denial!;
      if (d.charges >= d.threshold) continue;
      d.charges += 1;
      if (d.charges >= d.threshold) this.log(`${artifact.name} is armed.`);
    }
  }

  private crackMovedArtifact(artifact: Mage): void {
    const by = this.current && this.current !== artifact && this.current.alive ? this.current : artifact;
    this.log(`${artifact.name} cracks as it is moved.`);
    dealDamage(
      { ...this.effectContext(by, artifact, null), crit: false },
      artifact,
      dmg(DENIAL_RELOCATION_DAMAGE, 'typeless'),
      { canMiss: false, trueDamage: true }
    );
  }

  /**
   * Baral's first fall below a mark: the blow is turned aside, leaving him at one
   * under it; two drakes come, and, unseen until his next turn, he dashes 10cm
   * and is cleansed. True when it struck.
   */
  checkBaralWound(target: Mage, beforeHp: number, beforeSanity: number): boolean {
    const b = target.baral;
    if (!b || b.wounded || target.withdrawn) return false;
    const hpBroke = target.hp < b.hpMark && target.hp < beforeHp;
    const sanityBroke = target.sanity < BARAL_SANITY_MARK && target.sanity < beforeSanity;
    if (!hpBroke && !sanityBroke) return false;
    b.wounded = true;
    b.vanished = true;
    if (hpBroke) target.hp = Math.min(beforeHp, b.hpMark - 1);
    if (sanityBroke) target.sanity = Math.min(beforeSanity, BARAL_SANITY_MARK - 1);
    this.log(`${target.name}: "Nope." Two drakes clatter out and he is gone from sight.`);
    this.pendingDrakes.push({ baral: target, count: 2 });
    const ctx = { ...this.effectContext(target, target, null), crit: false };
    applyInvisibility(ctx, target, { duration: 1, mode: 'full' });
    const a = this.rng.float() * Math.PI * 2;
    dash(ctx, target, { direction: { x: Math.cos(a), y: Math.sin(a) }, distance: BARAL_WOUND_DASH_UNITS * RANGE_UNIT });
    cleanse(ctx, target);
    return true;
  }

  /** The end of Baral's turn: every second one builds an artifact, the others drakes, two once he is at his marks. */
  baralEndStep(baral: Mage): { artifacts: number; drakes: number } {
    const b = baral.baral;
    if (!b || !baral.alive) return { artifacts: 0, drakes: 0 };
    b.turns += 1;
    if (b.turns % 2 === 0) return { artifacts: 1, drakes: 0 };
    return { artifacts: 0, drakes: baral.hp <= b.hpMark || baral.sanity <= BARAL_SANITY_MARK ? 2 : 1 };
  }

  /** A drake's turn ended: one fewer left, and at none it falls apart. True when it did. */
  wearDrake(drake: Mage): boolean {
    if (drake.drakeTurns == null || !drake.alive) return false;
    drake.drakeTurns -= 1;
    if (drake.drakeTurns > 0) return false;
    drake.withdrawn = true;
    this.log(`${drake.name} winds down and falls apart.`);
    this.vfxSink?.summonPuff?.(drake.pos, 60);
    return true;
  }

  /** With Baral gone his works fail: the drakes fall apart and the artifacts go dark. */
  private dismantleBaralWorks(baral: Mage): void {
    const works = this.mages.filter((m) => m.alive && m.team === baral.team && (!!m.denial || m.drakeTurns != null));
    if (!works.length) return;
    for (const m of works) {
      m.withdrawn = true;
      this.vfxSink?.summonPuff?.(m.pos, 60);
    }
    this.pendingDrakes = [];
    this.log(`With ${baral.name} gone, his drakes fall apart and the Artifacts of Denial go dark.`);
  }

  effectContext(
    source: Mage,
    target: Mage | null,
    targetPoint: Vec2 | null,
    targetPoint2: Vec2 | null = null
  ): EffectContext {
    return {
      game: this,
      caster: source,
      target,
      targetPoint,
      targetPoint2,
      rng: this.rng,
      log: (m) => this.log(m),
      vfx: this.vfxSink ?? null,
      crit: this.critThisCast,
      spellRoll: this.spellRollThisCast || undefined,
      requestPoint: this.subTargeter
        ? (opts) => this.subTargeter!.requestPoint(source, opts)
        : undefined,
      requestEnemy: this.subTargeter
        ? (opts) => this.subTargeter!.requestEnemy(source, opts)
        : undefined,
      requestCombatant: this.subTargeter
        ? (opts) => this.subTargeter!.requestCombatant(source, opts)
        : undefined,
      requestReroll: this.subTargeter?.requestReroll
        ? (opts) => this.subTargeter!.requestReroll!(source, opts)
        : undefined,
      requestOffering: this.subTargeter?.requestOffering
        ? (opts) => this.subTargeter!.requestOffering!(source, opts)
        : undefined,
      reactionWindow: this.subTargeter
        ? (label, at) => this.subTargeter!.reactionWindow(source, label, at)
        : undefined,
      resolveImpacts: this.subTargeter
        ? () => this.subTargeter!.resolveImpacts()
        : undefined,
    };
  }

  /** Is `target` a legal target for `spell` cast by `source` right now? */
  isValidSpellTarget(spell: Spell, source: Mage, target: Mage): boolean {
    if (!target.alive) return false;
    const reach = this.spellReach(spell, source);
    if (spell.requiresInvisibleTarget && this.stealthDuration(target) <= 0) return false;
    if (
      spell.requiresTargetNearOwnShadow != null &&
      !this.shadowsOf(source.team).some(
        (shadow) =>
          dist({ x: shadow.x, y: shadow.y }, target.pos) <=
          shadow.radius + spell.requiresTargetNearOwnShadow!
      )
    ) return false;
    if (spell.reachFromShadows != null && !this.withinReachOfShadows(source, target.pos, spell.reachFromShadows)) return false;
    switch (spell.targeting) {
      case 'self':
        return target === source;
      case 'ally':
        if (target.team !== source.team) return false;
        if (target === source) return true;
        if (spell.minRange && dist(source.pos, target.pos) < spell.minRange) return false;
        return this.withinCastRange(source, target.pos, reach);
      case 'any':
        // Castable on any living mage — yourself, an ally, or an enemy.
        if (target === source) return true;
        if (spell.minRange && dist(source.pos, target.pos) < spell.minRange) return false;
        return this.withinCastRange(source, target.pos, reach);
      case 'enemy': {
        if (target === source) return false;
        if (this.isUntargetable(target, source, {
          ignoreStealth: spell.ignoresStealth || this.hasPhantomReach(source),
        }))
          return false;
        let range = reach;
        if (
          spell.bonusRangeInOwnShadow &&
          this.shadowsOf(source.team).some(
            (s) => dist({ x: s.x, y: s.y }, target.pos) <= s.radius
          )
        ) {
          range += spell.bonusRangeInOwnShadow;
        }
        if (spell.minRange && dist(source.pos, target.pos) < spell.minRange) return false;
        return this.withinCastRange(source, target.pos, range);
      }
      default:
        return true;
    }
  }

  validSpellTargets(spell: Spell, source: Mage): Mage[] {
    return this.mages.filter((m) => this.isValidSpellTarget(spell, source, m));
  }

  /** How far `source` casts `spell`: its range, plus the reach of any staff a word spell is cast through. */
  spellReach(spell: Spell, source: Mage): number {
    if (spell.words.length === 0 || !Number.isFinite(spell.range) || spell.range <= 0) return spell.range;
    return spell.range + source.spellRangeBonus();
  }

  /** Foes a staff bolt aimed at `target` strikes: the target, then the nearest others in reach, up to the bolt's count. */
  staffBoltTargets(source: Mage, bolt: StaffBolt, target: Mage): Mage[] {
    const others = this.mages
      .filter((m) => m !== target && m.alive && m.team !== source.team && !this.isUntargetable(m, source) && dist(source.pos, m.pos) <= bolt.rangePx)
      .sort((a, b) => dist(target.pos, a.pos) - dist(target.pos, b.pos));
    return [target, ...others].slice(0, Math.max(1, bolt.targets ?? 1));
  }

  /**
   * A staff's own bolt (mana and the main action already paid; no cast roll):
   * each struck foe takes its own roll of X dice, X = 1 + Int/10.
   */
  staffBolt(source: Mage, itemId: ItemId, index: number, target: Mage): void {
    const def = getItem(itemId);
    const bolt = def.staffBolts?.[index];
    if (!bolt || !target.alive) return;
    const spec = `${staffDice(source.effectiveInt(), bolt)}d${bolt.sides}`;
    this.log(`${source.name} looses ${def.name}'s ${bolt.label.toLowerCase()} (${spec} ${bolt.type}).`);
    for (const foe of this.staffBoltTargets(source, bolt, target)) {
      if (!foe.alive) continue;
      const ctx = this.effectContext(source, foe, null);
      const dealt = dealDamage(ctx, foe, dmg(rollDice(ctx, spec, def.name, foe), bolt.type));
      if (bolt.onHit && dealt > 0) {
        runHitEffects({ striker: source, victim: foe, dealt, drinker: source, ctx: this.quietContext(source, foe) }, bolt.onHit);
      }
    }
  }

  /** Whether `at` lies within `reach` of a shadow on `source`'s side: its own, a living ally's or summon's, or a pool. */
  withinReachOfShadows(source: Mage, at: Vec2, reach: number): boolean {
    if (this.mages.some((m) => m.alive && m.team === source.team && dist(m.pos, at) <= reach)) return true;
    return this.shadowsOf(source.team).some((shadow) => dist({ x: shadow.x, y: shadow.y }, at) <= shadow.radius + reach);
  }

  /**
   * Whether `source`'s basic attack can reach a flying `target`. Creature wings
   * climb out of reach of everything but ranged weapons; Wings of Deaths Angel
   * only skim, so any weapon or thrown/spat projectile still connects.
   */
  canStrikeAirborne(source: Mage, target: Mage): boolean {
    if (!target.isAirborne()) return true;
    const weapon = source.activeWeapon();
    if (isRangedWeapon(weapon)) return true;
    if (target.intrinsicAirborne) return false;
    return !!weapon || (source.intrinsicMeleeReach ?? 0) > MELEE_RANGE;
  }

  canMelee(source: Mage, target: Mage): boolean {
    if (source.enemyKind === 'crusadeBallista' && (!crusadeBallistaCanFire(this.mages, source) || source.crusade?.firedTurn === this.turnSeq)) return false;
    if (source.cannotAttack) return false;
    if (source.attackCooldownRounds > 0 && this.round - source.lastAttackRound < source.attackCooldownRounds)
      return false;
    // Out of sand to spend on the next swing.
    if (
      source.sandUpkeepEvery > 0 &&
      source.attacksSinceSandUpkeep >= source.sandUpkeepEvery &&
      this.sandChargesAt(source.pos) <= 0
    )
      return false;
    if (source.hasForgotten('melee')) return false;
    if (target === source || !target.alive || this.isUntargetable(target, source)) return false;
    const weapon = source.activeWeapon();
    // A Needle of Serenity can permanently disable the unarmed strike itself.
    if (!weapon && source.unarmedBanned) return false;
    // Bows need ammunition to fire (summons get theirs for free).
    if (source.outOfAmmo()) return false;
    // A crossbow that has just fired cannot shoot again until it reloads.
    if (weapon?.toHit && source.reloadTurns > 0) return false;
    if (!this.canStrikeAirborne(source, target)) return false;
    // A solid wall stops a blow, though shots still fly over it.
    if (!isRangedWeapon(weapon) && this.wallBetween(source.pos, target.pos)) return false;
    const d = dist(source.pos, target.pos);
    const extraRadius = Math.max(0, target.bodyRadius() - MAGE_BODY_RADIUS);
    if (source.beastDemonKind && d > MELEE_RANGE + extraRadius && source.beastDemonBlood <= 0) return false;
    const reach = weapon ? weapon.rangePx : source.intrinsicMeleeReach ?? MELEE_RANGE;
    const min = weapon?.minRangePx ?? source.intrinsicMeleeMin ?? 0;
    return d <= reach + extraRadius && d >= min;
  }

  /** Resolve one 2d10 spear strike split evenly between pierce and shadow. */
  resolveDeathknightBasicAttack(source: Mage, target: Mage): number {
    if (!source.alive || !target.alive || source.team === target.team) return 0;
    const total = this.rng.roll('2d10').total;
    const pierce = Math.floor(total / 2);
    const shadow = total - pierce;
    const ctx = this.effectContext(source, target, null);
    let dealt = dealDamage(ctx, target, dmg(pierce, 'pierce'), {
      canMiss: false,
      triggersFaraday: true,
      noImpactFx: true,
    });
    if (target.alive) {
      dealt += dealDamage(ctx, target, dmg(shadow, 'shadow'), {
        canMiss: false,
        triggersFaraday: true,
        noImpactFx: true,
      });
    }
    if (dealt > 0) {
      for (const enemy of this.livingEnemiesOf(source)) {
        if (dist(source.pos, enemy.pos) > 5 * RANGE_UNIT) continue;
        const aura = this.rng.roll('1d6').total;
        dealDamage(this.effectContext(source, enemy, null), enemy, dmg(aura, 'corrosive'), {
          canMiss: false,
          aoe: true,
          noImpactFx: true,
        });
      }
      this.log(`${source.name}'s corrosive aura erupts around the spear impact.`);
    }
    return dealt;
  }

  // ---- Dropped items --------------------------------------------------------

  private previewItemDrop(source: Mage, itemId: ItemId): Mage | null {
    const def = getItem(itemId);
    if (def.keyItem || def.permanentlyBinding || (itemId === 'bastionSword' && !source.bastionShieldForm)) return null;
    if (itemId === 'consumablePouch' && source.pouch.length &&
      [...source.bag, ...source.utility].filter((id) => id === itemId).length <= 1) return null;
    const preview: Mage = Object.assign(Object.create(Mage.prototype), source, {
      hands: [...source.hands], accessories: [...source.accessories], bag: [...source.bag], utility: [...source.utility],
    });
    let removed = false;
    for (const list of [preview.hands, preview.accessories, preview.bag, preview.utility]) {
      const index = list.indexOf(itemId);
      if (index < 0) continue;
      list.splice(index, 1);
      removed = true;
      break;
    }
    if (!removed) {
      for (const slot of WORN_SLOTS) {
        if (preview[slot] !== itemId) continue;
        preview[slot] = null;
        removed = true;
        break;
      }
    }
    if (!removed) return null;
    if (packSlotsUsed(preview) > packCapacity(preview) &&
        (packSlotsUsed(preview) > packSlotsUsed(source) || packCapacity(preview) < packCapacity(source))) return null;
    return preview;
  }

  canSwapDroppedItem(source: Mage, dropId: number, discard: ItemId): boolean {
    const drop = this.droppedItems.find((entry) => entry.id === dropId);
    if (!drop || drop.owner !== source.team || dist(source.pos, drop) > PICKUP_RANGE) return false;
    const preview = this.previewItemDrop(source, discard);
    return !!preview && preview.hasFreeHand() && preview.canCarry(getItem(drop.itemId).weight) &&
      !preview.summonItemLimited(drop.itemId);
  }

  swapDroppedItem(source: Mage, dropId: number, discard: ItemId): boolean {
    if (!this.canSwapDroppedItem(source, dropId, discard)) return false;
    if (!this.dropItem(source, discard)) return false;
    return this.pickUpItem(source, dropId);
  }

  /** Drop a held item onto the ground at the mage's feet. */
  dropItem(source: Mage, itemId: ItemId): boolean {
    const preview = this.previewItemDrop(source, itemId);
    if (!preview) return false;
    source.hands = preview.hands;
    source.accessories = preview.accessories;
    source.bag = preview.bag;
    source.utility = preview.utility;
    if (source.readyConsumable === itemId && !source.utility.includes(itemId)) source.readyConsumable = null;
    for (const slot of WORN_SLOTS) source[slot] = preview[slot];
    this.reverseGrantedVitals(source, getItem(itemId));
    // Snuffing a torch by dropping it uses it up (the burn timer clears).
    if (getItem(itemId).torchCombats != null && !source.hands.some((h) => getItem(h).torchCombats != null))
      source.torchCombatsLeft = 0;
    this.droppedItems.push({
      id: this.nextId++,
      itemId,
      x: source.pos.x,
      y: source.pos.y,
      owner: source.team,
    });
    this.log(`${source.name} drops ${getItem(itemId).name}.`);
    return true;
  }

  /** Pick a dropped item back up (must own it, be near it, have room + capacity). */
  pickUpItem(source: Mage, dropId: number): boolean {
    const idx = this.droppedItems.findIndex((d) => d.id === dropId);
    if (idx < 0) return false;
    const drop = this.droppedItems[idx];
    const def = getItem(drop.itemId);
    if (
      drop.owner !== source.team ||
      !source.hasFreeHand() ||
      !source.canCarry(def.weight) ||
      source.summonItemLimited(drop.itemId) ||
      dist(source.pos, { x: drop.x, y: drop.y }) > PICKUP_RANGE
    ) {
      return false;
    }
    this.droppedItems.splice(idx, 1);
    source.hands.push(drop.itemId);
    this.notifyLightActivation(source);
    this.log(`${source.name} picks up ${def.name}.`);
    return true;
  }

  /** The nearest of this mage's own dropped items within pickup range, if any. */
  nearestDropFor(source: Mage): DroppedItem | null {
    let best: DroppedItem | null = null;
    let bestDist = Infinity;
    for (const d of this.droppedItems) {
      if (d.owner !== source.team) continue;
      const dd = dist(source.pos, { x: d.x, y: d.y });
      if (dd <= PICKUP_RANGE && dd < bestDist) {
        best = d;
        bestDist = dd;
      }
    }
    return best;
  }

  // ---- Reality-break barriers ----------------------------------------------

  /** Place a barrier (wedge or rectangle) owned by `owner`. */
  addBarrier(
    at: Vec2,
    angle: number,
    opts: {
      shape?: 'wedge' | 'rect';
      halfAngle?: number;
      range: number;
      thickness?: number;
      owner: number;
      ttl: number;
      opaque?: boolean;
      burst?: BarrierBurst;
    }
  ): BarrierZone {
    const zone: BarrierZone = {
      id: this.nextId++,
      shape: opts.shape ?? 'wedge',
      x: at.x,
      y: at.y,
      angle,
      halfAngle: opts.halfAngle ?? 0,
      range: opts.range,
      thickness: opts.thickness ?? 0,
      owner: opts.owner,
      ttl: opts.ttl,
      opaque: opts.opaque,
      burst: opts.burst,
    };
    this.barriers.push(zone);
    return zone;
  }

  /** Age every barrier by one round, removing any that have collapsed. */
  tickBarriers(): void {
    for (const b of this.barriers) b.ttl -= 1;
    const gone = this.barriers.filter((b) => b.ttl <= 0);
    const mended = gone.filter((b) => !b.burst).length;
    if (mended) this.log(`${mended} reality break${mended > 1 ? 's' : ''} mend.`);
    this.barriers = this.barriers.filter((b) => b.ttl > 0);
    for (const b of gone) if (b.burst) this.burstBarrier(b, b.burst);
  }

  /** A collapsing barrier with a burst hurts every unit near its body, allies included. */
  private burstBarrier(barrier: BarrierZone, burst: BarrierBurst): void {
    const centre = { x: barrier.x, y: barrier.y };
    this.log('A glass curtain shatters.');
    this.vfxSink?.shatterBurst?.(centre, barrier.range);
    const caught = this.mages.filter(
      (m) => m.alive && barrierDistance(barrier, m.pos) <= burst.radius + m.bodyRadius()
    );
    if (caught.length === 0) return;
    const owner = this.mages[burst.ownerIndex];
    const hits = burst.hits.map((hit) => ({
      type: hit.type,
      amount: this.showRoll(hit.spec, `Curtain shards (${hit.type})`).total,
    }));
    for (const victim of caught) {
      const ctx = this.effectContext(owner ?? victim, victim, centre);
      ctx.crit = false;
      for (const hit of hits) {
        if (!victim.alive) break;
        dealDamage(ctx, victim, dmg(hit.amount, hit.type), { canMiss: false, aoe: true });
      }
    }
  }

  /** Is `pos` inside any active barrier wedge? */
  isInBarrier(pos: Vec2): boolean {
    return this.barriers.some((b) => barrierContains(b, pos));
  }

  /** Longest remaining ttl (rounds) among barriers covering `pos`, else 0. */
  barrierTtlAt(pos: Vec2): number {
    let ttl = 0;
    for (const b of this.barriers) if (barrierContains(b, pos)) ttl = Math.max(ttl, b.ttl);
    return ttl;
  }

  /**
   * Clamp a movement from `from` to `to` so it stops just before entering any
   * barrier. Returns the allowed destination and whether the path was blocked.
   * Walls ('rect') are solid: a body of `radius` stops against them, and only
   * reality breaks (wedges) set `roots`. A mover already inside a wall may leave it.
   */
  clampToBarriers(from: Vec2, to: Vec2, radius = 0): { dest: Vec2; blocked: boolean; roots: boolean } {
    const bounded = clampToMoayArena(this.moayArena, to, radius);
    const arenaBlocked = dist(bounded, to) > 0.01;
    to = bounded;
    if (this.barriers.length === 0) return { dest: to, blocked: arenaBlocked, roots: false };
    const total = dist(from, to);
    if (total < 1) return { dest: to, blocked: false, roots: false };
    const walls = this.barriers.filter((b) => b.shape === 'rect' && !barrierContains(b, from));
    const wallGap = new Map(walls.map((b) => [b, barrierDistance(b, from) <= radius ? 0 : radius]));
    const steps = Math.max(2, Math.ceil(total / 8));
    let last: Vec2 = { ...from };
    for (let i = 1; i <= steps; i++) {
      const p = stepTowards(from, to, (total * i) / steps);
      for (const wall of walls) {
        const gap = wallGap.get(wall)!;
        if (gap > 0 ? barrierDistance(wall, p) < gap : barrierContains(wall, p)) {
          return { dest: last, blocked: true, roots: false };
        }
      }
      if (this.barriers.some((b) => b.shape !== 'rect' && barrierContains(b, p))) {
        return { dest: last, blocked: true, roots: true };
      }
      last = p;
    }
    return { dest: to, blocked: arenaBlocked, roots: false };
  }

  /** Whether a solid wall stands between two points (melee cannot reach across it). */
  wallBetween(from: Vec2, to: Vec2): boolean {
    return this.barriers.some((b) => b.shape === 'rect' && this.sightBlockedBy(b, from, to));
  }

  /**
   * Clamp a movement so the mover stops just outside any other mage's body.
   * You can end your move directly next to an opponent, but never run through
   * or stand on top of them.
   */
  clampToMages(source: Mage, from: Vec2, to: Vec2): Vec2 {
    // Only opposing bodies block passage. Allies (a swarm of Swamprun foes, or
    // co-op partners) pass through one another so they never jam up and get
    // stuck; the player is still walled off by enemy bodies and vice versa.
    const others = this.mages.filter((m) => m !== source && m.alive && m.summonShoulder == null && m.team !== source.team);
    if (others.length === 0) return to;
    let firstContact = 1;
    for (const other of others) {
      const radius = source.bodyRadius() + other.bodyRadius();
      const offsetX = from.x - other.x;
      const offsetY = from.y - other.y;
      const travelX = to.x - from.x;
      const travelY = to.y - from.y;
      const startsTouching = offsetX * offsetX + offsetY * offsetY <= radius * radius + 0.01;
      const movesOutward = offsetX * travelX + offsetY * travelY >= 0;
      if (startsTouching && movesOutward) continue;
      const contact = segmentCircleFirstIntersection(
        from,
        to,
        other.pos,
        radius
      );
      if (contact != null && contact < firstContact) firstContact = contact;
    }
    return {
      x: from.x + (to.x - from.x) * firstContact,
      y: from.y + (to.y - from.y) * firstContact,
    };
  }

  /** A dash may cross an enemy's body only if it clears that body entirely. */
  clampDashToMages(source: Mage, from: Vec2, to: Vec2): Vec2 {
    let firstContact = 1;
    const travel = dist(from, to);
    for (const other of this.mages) {
      if (other === source || !other.alive || other.summonShoulder != null || other.team === source.team) continue;
      const radius = source.bodyRadius() + other.bodyRadius();
      const entry = segmentCircleFirstIntersection(from, to, other.pos, radius);
      if (entry == null || entry >= firstContact) continue;
      const exit = segmentCircleFirstIntersection(to, from, other.pos, radius);
      if (exit != null && exit > 0.001) continue;
      firstContact = Math.max(0, entry - 0.15 / travel);
    }
    return {
      x: from.x + (to.x - from.x) * firstContact,
      y: from.y + (to.y - from.y) * firstContact,
    };
  }

  /** Find the closest vacant endpoint; allies remain passable during travel. */
  nearestFreePosition(source: Mage, desired: Vec2, from: Vec2 = source.pos, walking = false, vacating?: Mage): Vec2 {
    desired = clampToMoayArena(this.moayArena, desired, source.bodyRadius());
    const fits = (point: Vec2): boolean =>
      point.x >= FIELD.x && point.x <= FIELD.x + FIELD.w &&
      point.y >= FIELD.y && point.y <= FIELD.y + FIELD.h &&
      dist(point, clampToMoayArena(this.moayArena, point, source.bodyRadius())) < 0.01 &&
      this.mages.every((other) => other === source || other === vacating || !other.alive || other.summonShoulder != null ||
        dist(point, other.pos) >= source.bodyRadius() + other.bodyRadius() + 0.1);
    const reachable = (point: Vec2): boolean =>
      !walking || (dist(from, point) <= dist(from, desired) + 0.1 &&
        dist(this.clampToMages(source, from, point), point) < 0.1);
    if (fits(desired) && reachable(desired)) return desired;
    for (let radius = 8; radius <= Math.max(FIELD.w, FIELD.h); radius += 8) {
      let nearest: Vec2 | null = null;
      let best = Infinity;
      for (let angle = 0; angle < 32; angle++) {
        const theta = (angle * Math.PI * 2) / 32;
        const point = { x: desired.x + radius * Math.cos(theta), y: desired.y + radius * Math.sin(theta) };
        const travel = dist(from, point);
        if (travel < best && fits(point) && reachable(point)) {
          nearest = point;
          best = travel;
        }
      }
      if (nearest) return nearest;
    }
    return from;
  }

  // ---- Mutivarg's Rod & weapon abilities ------------------------------------

  /** Raise a crushing field (one per owner) sized by the mana paid. */
  addMutivargZone(at: Vec2, owner: number, manaPaid: number): MutivargZone {
    // Only one zone per owner at a time — the old one collapses.
    this.mutivargZones = this.mutivargZones.filter((z) => z.owner !== owner);
    const zone: MutivargZone = {
      id: this.nextId++,
      x: Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, at.x)),
      y: Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, at.y)),
      radius: (manaPaid / 4) * RANGE_UNIT,
      manaPaid,
      owner,
      turnsLeft: 2,
    };
    this.mutivargZones.push(zone);
    return zone;
  }

  /** Crush & pin any mage starting their turn inside a field; age the owner's. */
  private applyMutivargZones(m: Mage): void {
    if (this.mutivargZones.length === 0) return;
    for (const z of this.mutivargZones) {
      if (!m.alive) break;
      // A caster is unharmed by their own field — it only crushes enemies.
      if (z.owner === m.team) continue;
      if (dist(m.pos, { x: z.x, y: z.y }) > z.radius) continue;
      const crushDice = Math.max(0, z.manaPaid - 3);
      if (crushDice > 0) {
        let total = 0;
        for (let i = 0; i < crushDice; i++) total += this.rng.roll('1d3').total;
        // The weak (low Strength) or over-encumbered are crushed twice as hard.
        const weak =
          m.effectiveStr() < z.manaPaid * 2 || m.carryCap() - m.carriedWeight() < 2;
        if (weak) total *= 2;
        const ctx = this.effectContext(m, m, null);
        // 67% blunt shatter, otherwise a resist-ignoring magical crush.
        if (this.rng.chance(0.67)) {
          dealDamage(ctx, m, dmg(total, 'shatter'), { canMiss: false, aoe: true, noImpactFx: true });
        } else {
          dealDamage(ctx, m, dmg(total, 'corrosive'), {
            canMiss: false,
            aoe: true,
            ignoreResist: true,
            noImpactFx: true,
          });
        }
      }
      // Slow past 100% — the field pins them in place this turn.
      addOrExtendStatus(
        m.statuses,
        { key: 'stun:movement', name: 'Crushing Field', kind: 'stun', duration: 2, stunType: 'movement', physicalRoot: false },
        false,
      );
      this.log(`${m.name} is ground down by the crushing field.`);
    }
    // The field lasts two of the owner's turn-starts.
    for (const z of this.mutivargZones) if (z.owner === m.team) z.turnsLeft -= 1;
    const gone = this.mutivargZones.filter((z) => z.turnsLeft <= 0);
    if (gone.length) this.log(`The crushing field disperses.`);
    this.mutivargZones = this.mutivargZones.filter((z) => z.turnsLeft > 0);
  }

  /** True if a straight path would cross into a crushing field (a wall). */
  clampToMutivargZones(mover: Mage, from: Vec2, to: Vec2): { dest: Vec2; blocked: boolean } {
    // The mover's own fields are walls only to the enemy, not to its caster.
    const walls = this.mutivargZones.filter((z) => z.owner !== mover.team);
    if (walls.length === 0) return { dest: to, blocked: false };
    const inAnyZone = (p: Vec2) =>
      walls.some((z) => dist(p, { x: z.x, y: z.y }) <= z.radius);
    // Already trapped inside? Movement is handled by the pin, don't double-block.
    if (inAnyZone(from)) return { dest: to, blocked: false };
    const total = dist(from, to);
    if (total < 1) return { dest: to, blocked: false };
    const steps = Math.max(2, Math.ceil(total / 8));
    let last: Vec2 = { ...from };
    for (let i = 1; i <= steps; i++) {
      const p = stepTowards(from, to, (total * i) / steps);
      if (inAnyZone(p)) return { dest: last, blocked: true };
      last = p;
    }
    return { dest: to, blocked: false };
  }

  /** Mutivarg's Rod weapon command: pay 25% mana to raise a crushing field. */
  castMutivargZone(source: Mage): void {
    const paid = Math.ceil(source.mana * 0.25);
    if (paid <= 3) {
      this.log(`${source.name} pays only ${paid} mana. The rod's field fails.`);
      return;
    }
    source.spendMana(paid);
    // Drop the field on the enemy — never under the caster's own feet, or they
    // would pin themselves and be unable to move out of it.
    const center = this.opponentOf(source)?.pos ?? source.pos;
    this.addMutivargZone(center, source.team, paid);
    this.log(`${source.name} pays ${paid} mana and raises a crushing field (radius ${paid}).`);
  }

  /** Bastion Sword weapon command: swap between sword and shield form. */
  swapBastionForm(source: Mage): void {
    source.bastionShieldForm = !source.bastionShieldForm;
    this.log(
      `${source.name} reforges the Bastion Sword into ${source.bastionShieldForm ? 'shield' : 'sword'} form.`,
    );
  }

  /** Toggle Black Bell between its long-wound Toll and debuff-cashing Condense modes. */
  toggleBlackBellMode(source: Mage): void {
    source.blackBellCondense = !source.blackBellCondense;
    this.log(
      `${source.name} turns Black Bell to ${source.blackBellCondense ? 'Condense' : 'Toll'} mode.`
    );
  }

  /** Whether a status is a harmful affliction Black Bell can condense. */
  private blackBellConsumes(status: Status): boolean {
    return (
      status.kind === 'stun' ||
      status.kind === 'dot' ||
      status.kind === 'debuff' ||
      status.kind === 'auraDot' ||
      status.kind === 'control' ||
      status.kind === 'shadowTrail' ||
      status.kind === 'forget'
    );
  }

  /** Roll the damage a consumed DoT would have dealt over all remaining ticks. */
  private rollBlackBellDot(status: DotStatus | AuraDotStatus): number {
    let total = 0;
    if (status.kind === 'auraDot') {
      for (let tick = 0; tick < status.duration; tick++) {
        total += Math.max(0, this.rng.roll(status.damageSpec).total);
      }
      return total;
    }

    let stacks = status.stacks ?? 0;
    let fresh = status.freshStack ?? false;
    for (let tick = 0; tick < status.duration; tick++) {
      if (status.damageSpec) {
        total += Math.max(0, this.rng.roll(status.damageSpec).total);
      } else if (stacks > 0 && status.perStackSpec) {
        for (let stack = 0; stack < stacks; stack++) {
          total += Math.max(0, this.rng.roll(status.perStackSpec).total);
        }
      } else {
        total += Math.max(0, status.damage.amount);
      }
      if (status.decayPerTick && !fresh) stacks = Math.max(0, stacks - 1);
      fresh = false;
    }
    return total;
  }

  /** Consume an enemy's afflictions, detonate their DoTs, and leave an enlarged shadow. */
  condenseWithBlackBell(source: Mage, target: Mage): void {
    const consumed = target.statuses.filter((status) => this.blackBellConsumes(status));
    const damaging = consumed.filter(
      (status): status is DotStatus | AuraDotStatus => status.kind === 'dot' || status.kind === 'auraDot'
    );
    const nonDamageCount = consumed.length - damaging.length;
    let storedDamage = 0;
    for (const status of damaging) storedDamage += this.rollBlackBellDot(status);
    target.statuses = target.statuses.filter((status) => !this.blackBellConsumes(status));

    const ctx = this.effectContext(source, target, target.pos);
    const shatterDamage = Math.ceil(storedDamage / 2);
    const shadowDamage = storedDamage - shatterDamage;
    if (shatterDamage > 0) {
      dealDamage(ctx, target, dmg(shatterDamage, 'shatter'), { canMiss: false });
    }
    if (shadowDamage > 0) {
      dealDamage(ctx, target, dmg(shadowDamage, 'shadow'), { canMiss: false });
    }
    const shadow = this.addShadow(target.pos, source.team);
    shadow.radius += nonDamageCount * RANGE_UNIT;
    this.log(
      `${source.name} condenses ${consumed.length} affliction${consumed.length === 1 ? '' : 's'} ` +
      `on ${target.name} for ${storedDamage} stored damage; the impact opens a shadow ` +
      `${nonDamageCount} step${nonDamageCount === 1 ? '' : 's'} larger.`
    );
  }

  /** Remove a held item from a mage's hands (Gambler's Blade self-destruct). */
  destroyHeldItem(source: Mage, id: ItemId): void {
    const i = source.hands.indexOf(id);
    if (i >= 0) source.hands.splice(i, 1);
    this.log(`${source.name}'s ${getItem(id).name} shatters into shards.`);
  }

  /**
   * Gambler's Blade weapon command: shatter the blade. The interactive draft
   * that follows (choose 1 of 3 per 5 Greed stacks) is driven by the scene so a
   * human can pick; the pure state change lives here.
   */
  shatterGamblerBlade(source: Mage): number {
    const bladeId = source.hands.find((id) => getItem(id).gamblerGreed);
    const n = Math.floor(source.greedStacks / 5);
    if (bladeId) this.destroyHeldItem(source, bladeId);
    source.greedStacks = 0;
    return n;
  }

  /** Add a freshly-drafted item to a mage, honouring slot caps and vitals. */
  grantItem(mage: Mage, id: ItemId): void {
    const def = getItem(id);
    switch (def.slot) {
      case 'hand':
        mage.bag.push(id);
        break;
      case 'head':
      case 'torso':
      case 'cape':
      case 'gloves':
      case 'boots':
        if (!mage[def.slot]) mage[def.slot] = id;
        else mage.bag.push(id);
        break;
      case 'accessory':
        if (mage.accessories.length < SLOT_CAPS.accessory) mage.accessories.push(id);
        else mage.bag.push(id);
        break;
      case 'utility':
        if (def.ammo) mage.arrows += 1;
        else if (def.material) mage.bag.push(id);
        else mage.utility.push(id);
        break;
    }
    this.applyGrantedVitals(mage, def);
    this.notifyLightActivation(mage);
  }

  /** Apply a single freshly-granted item's one-time HP / sanity changes. */
  private applyGrantedVitals(mage: Mage, def: ItemDef): void {
    if (def.hpMult != null) mage.maxHp = Math.max(1, Math.round(mage.maxHp * def.hpMult));
    if (def.hpFlat != null) mage.maxHp = Math.max(1, mage.maxHp + def.hpFlat);
    if (def.sanityMult != null) mage.maxSanity = Math.max(1, Math.round(mage.maxSanity * def.sanityMult));
    mage.hp = Math.min(mage.hp, mage.maxHp);
    mage.sanity = Math.min(mage.sanity, mage.maxSanity);
  }

  /**
   * Training sandbox: strip one copy of an item from a mage (from wherever it
   * sits) and reverse its one-time vital changes. Returns whether one was found.
   */
  removeItem(mage: Mage, id: ItemId): boolean {
    if (id === 'consumablePouch' && mage.pouch.length &&
      [...mage.bag, ...mage.utility].filter((item) => item === id).length <= 1) return false;
    const def = getItem(id);
    const pull = (arr: ItemId[]): boolean => {
      const i = arr.indexOf(id);
      if (i < 0) return false;
      arr.splice(i, 1);
      return true;
    };
    let removed = false;
    if (def.ammo) {
      if (mage.arrows > 0) {
        mage.arrows -= 1;
        removed = true;
      }
    } else if (pull(mage.hands) || pull(mage.bag) || pull(mage.accessories) || pull(mage.utility) || pull(mage.pouch)) {
      removed = true;
    } else if (mage.wornSlotOf(id)) {
      mage.setWorn(mage.wornSlotOf(id)!, null);
      removed = true;
    }
    if (removed) this.reverseGrantedVitals(mage, def);
    if (removed && mage.readyConsumable === id && !mage.utility.includes(id)) mage.readyConsumable = null;
    return removed;
  }

  /** Undo the one-time HP / sanity changes {@link applyGrantedVitals} applied. */
  private reverseGrantedVitals(mage: Mage, def: ItemDef): void {
    if (def.sanityMult != null && def.sanityMult !== 0)
      mage.maxSanity = Math.max(1, Math.round(mage.maxSanity / def.sanityMult));
    if (def.hpFlat != null) mage.maxHp = Math.max(1, mage.maxHp - def.hpFlat);
    if (def.hpMult != null && def.hpMult !== 0)
      mage.maxHp = Math.max(1, Math.round(mage.maxHp / def.hpMult));
    mage.hp = Math.min(mage.hp, mage.maxHp);
    mage.sanity = Math.min(mage.sanity, mage.maxSanity);
  }

  /** Training sandbox: wipe every transient field object (soft reset). */
  clearFieldObjects(): void {
    this.shadows = [];
    this.sand = [];
    this.totems = [];
    this.scarabs = [];
    this.barriers = [];
    this.moayArena = undefined;
    this.globalEscalations = [];
    this.needlepointDomains = [];
    this.hexcraftGlobals = [];
    this.veilBindZones = [];
    this.redOrbs = [];
    this.droppedItems = [];
    this.mutivargZones = [];
    this.corrosionPools = [];
    this.hazardZones = [];
    this.desecrations = [];
    this.desecrationFields = [];
    this.raisedCorpses.clear();
    this.pierceEchoes = [];
    this.extraTurnQueue = [];
    this.stack = [];
    this.mindSwapTurns = 0;
    this.pendingMindSwap = 0;
  }

  // ---- Stack item factories -------------------------------------------------

  /** Calculate Leap's final position without mutating the mover or field. */
  leapDestination(source: Mage, dest: Vec2): Vec2 {
    const fieldDest = {
      x: Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, dest.x)),
      y: Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, dest.y)),
    };
    const clamp = this.clampToBarriers(source.pos, fieldDest, source.bodyRadius());
    const mut = this.clampToMutivargZones(source, source.pos, clamp.dest);
    return this.clampToMages(source, source.pos, mut.dest);
  }

  /**
   * Move `source` to `dest`, clamped by the field edge, reality-break barriers,
   * Mutivarg zones and the other body. Used by the Leap bonus action.
   */
  leapMove(source: Mage, dest: Vec2): void {
    const origin = source.pos;
    const final = this.leapDestination(source, dest);
    source.x = final.x;
    source.y = final.y;
    this.notifyMageRelocation(source, origin, final, true);
    source.movedThisTurn = true;
    this.updateAttachedScarabs();
    this.dropTrailShadows(source);
  }

  /**
   * Resolve the Cleave main action: a 180° sweep at melee reach that deals
   * double a normal strength swing's damage to every enemy caught in the arc.
   */
  async resolveCleave(source: Mage, aim: Vec2): Promise<void> {
    await this.triggerEdgelordWeaponPulse(source);
    if (!source.alive) return;
    const w = source.activeWeapon();
    const reach = w ? w.rangePx : MELEE_RANGE;
    const roll = this.rng.roll('1d6').total;
    const flat =
      (w && source.profile.blackPrimaryTier ? 1 : 0) +
      source.meleeDamageBonus();
    const perHit = (strengthDamage(roll, source.effectiveStr(), w?.multiplier ?? 1) + flat) * 2;
    const type: DamageType = w?.damageType ?? 'shatter';
    const targets = this.magesInCone(source.pos, aim, reach, CLEAVE_DEGREES, source).filter(
      (m) => m.team !== source.team && this.canStrikeAirborne(source, m) && !this.wallBetween(source.pos, m.pos)
    );
    if (targets.length === 0) {
      this.log(`${source.name} cleaves. Nothing in range.`);
      return;
    }
    for (const t of targets) {
      const ctx = this.effectContext(source, t, null);
      dealDamage(ctx, t, dmg(perHit, type), {
        ignoreResist: !!w?.ignoreResist,
        ignoreArmor: !!w?.ignoreArmor,
      });
    }
    this.log(
      `${source.name} cleaves ${targets.length} foe${targets.length > 1 ? 's' : ''} for ${perHit} each!`
    );
  }

  /**
   * Why a declared action can no longer be carried out when it finally
   * resolves, or null if it still can. Being bound after declaring — by a
   * reaction, say — stops the action dead rather than letting it land.
   */
  stunPrevents(item: StackItem): string | null {
    const source = item.source;
    if (source.crocodileGrip?.alive) return 'held in the crocodile\'s jaws';
    if (source.isStunned('full')) return 'stunned';
    if (item.kind === 'move') return source.isStunned('movement') ? 'rooted in place' : null;
    const usesMain =
      item.kind === 'melee' || (item.kind === 'spell' && item.spell?.actionType !== 'bonus');
    return usesMain && source.isStunned('main') ? 'disarmed' : null;
  }

  planMove(source: Mage, destination: Vec2): { path: Vec2[]; roots: boolean } {
    const fieldDest = {
      x: Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, destination.x)),
      y: Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, destination.y)),
    };
    const phased = this.edgelordCanPhaseWalk(source) || this.isPhaseWalking(source);
    const clampSegment = (from: Vec2, to: Vec2): { dest: Vec2; roots: boolean } => {
      const barrier = phased
        ? { dest: to, roots: false }
        : this.clampToBarriers(from, to, source.bodyRadius());
      const mut = phased ? barrier : this.clampToMutivargZones(source, from, barrier.dest);
      const leash = this.clampToReaperLeash(source, from, mut.dest);
      const sealed = this.clampToDesecrationFields(source, from, leash);
      const tethered = clampToTethers(this, source, from, sealed);
      return { dest: phased ? tethered : this.clampToMages(source, from, tethered), roots: barrier.roots };
    };
    const goal = this.nearestFreePosition(source, fieldDest);
    const clear = (from: Vec2, to: Vec2): boolean => dist(clampSegment(from, to).dest, to) < 0.01;
    let route = [source.pos, goal];
    if (!clear(source.pos, goal)) {
      const spacing = 10;
      const start = {
        x: Math.floor((source.x - FIELD.x) / spacing),
        y: Math.floor((source.y - FIELD.y) / spacing),
      };
      const offset = { x: source.x - start.x * spacing, y: source.y - start.y * spacing };
      const width = Math.floor((FIELD.x + FIELD.w - offset.x) / spacing) + 1;
      const height = Math.floor((FIELD.y + FIELD.h - offset.y) / spacing) + 1;
      const point = (cell: Vec2): Vec2 => ({ x: offset.x + cell.x * spacing, y: offset.y + cell.y * spacing });
      const target = {
        x: Math.max(0, Math.min(width - 1, Math.round((goal.x - offset.x) / spacing))),
        y: Math.max(0, Math.min(height - 1, Math.round((goal.y - offset.y) / spacing))),
      };
      const cells = findPath(width, height, () => false, start, target, 20000,
        (from, to) => clear(point(from), point(to)), true);
      if (cells?.length) {
        const raw = [source.pos, ...cells.map(point)];
        const last = cells[cells.length - 1];
        if (last.x === target.x && last.y === target.y && clear(raw[raw.length - 1], goal)) raw.push(goal);
        route = [source.pos];
        let index = 0;
        while (index < raw.length - 1) {
          let next = raw.length - 1;
          while (next > index + 1 && !clear(raw[index], raw[next])) next--;
          route.push(raw[next]);
          index = next;
        }
      }
    }
    const path = [source.pos];
    let remaining = Math.max(0, source.moveRange());
    let roots = false;
    for (const next of route.slice(1)) {
      const from = path[path.length - 1];
      const capped = stepTowards(from, next, remaining);
      const clamped = clampSegment(from, capped);
      const free = this.nearestFreePosition(source, clamped.dest, from, !phased);
      const dest = dist(from, free) <= remaining + 0.01 ? clampSegment(from, free).dest : from;
      path.push(dest);
      remaining = Math.max(0, remaining - dist(from, dest));
      roots = clamped.roots;
      if (remaining < 0.01 || dist(dest, next) > 0.01) break;
    }
    return { path, roots };
  }

  makeMoveItem(source: Mage, destination: Vec2): StackItem {
    const planned = this.planMove(source, destination);
    const item: StackItem = {
      id: this.nextId++,
      kind: 'move',
      source,
      label: 'Move',
      description: `${source.name} moves.`,
      targetPoint: planned.path[planned.path.length - 1],
      movePath: planned.path,
      moveDestination: destination,
      isStillValid: () => source.alive,
      resolve: (game) => {
        const move = game.planMove(source, destination);
        const dest = move.path[move.path.length - 1];
        item.movePath = move.path;
        item.targetPoint = dest;
        const origin = source.pos;
        const step = move.path.slice(1).reduce((total, point, index) => total + dist(move.path[index], point), 0);
        source.x = dest.x;
        source.y = dest.y;
        game.notifyMageRelocation(source, origin, dest, true, move.path);
        source.movedThisTurn = true;
        source.distMovedThisTurn += step;
        game.updateAttachedScarabs();
        game.log(step < 1 ? `${source.name} stays in place.` : `${source.name} repositions.`);
        for (let index = 1; index < move.path.length; index++) game.burnPhaseWalkPath(source, move.path[index - 1], move.path[index]);
        if (step >= 1 && source.alive) hexMoved(game, source);
        if (move.roots) {
          const ttl = Math.max(1, game.barrierTtlAt({ x: dest.x, y: dest.y }) + 1);
          addOrExtendStatus(
            source.statuses,
            { key: 'stun:movement', name: 'Stuck', kind: 'stun', duration: ttl, stunType: 'movement', physicalRoot: false },
            false
          );
          game.log(`${source.name} is caught in the reality break and cannot move!`);
        }
      },
    };
    return item;
  }

  /**
   * A generic action (item use, throw, Eldritch, Thunder, weapon action, drop,
   * pickup) wrapped as a stack item so it opens a reaction window before it
   * resolves. `resolve` performs the real effect; if the action is stifled by a
   * Needle of Serenity it is removed from the stack and never runs.
   */
  makeActionItem(opts: {
    source: Mage;
    label: string;
    description?: string;
    target?: Mage;
    targetPoint?: Vec2;
    hostileAttack?: boolean;
    actionVisual?: StackItem['actionVisual'];
    needleBan?: NeedleBan;
    isStillValid?: (game: GameState) => boolean;
    resolve: (game: GameState) => void | Promise<void>;
  }): StackItem {
    return {
      id: this.nextId++,
      kind: 'action',
      source: opts.source,
      target: opts.target,
      targetPoint: opts.targetPoint,
      label: opts.label,
      description: opts.description ?? opts.label,
      hostileAttack: opts.hostileAttack,
      actionVisual: opts.actionVisual,
      needleBan: opts.needleBan,
      isStillValid: opts.isStillValid ?? (() => opts.source.alive),
      resolve: opts.resolve,
    };
  }

  makeMeleeItem(source: Mage, target: Mage): StackItem {
    if (source.deathknightKind) source.deathknightAttackAttemptedThisTurn = true;
    const weapon = source.activeWeapon();
    const weaponId = source.activeWeaponId();
    const blackBell = weaponId != null && !!getItem(weaponId).conjuredBlackBell;
    const label =
      blackBell && source.blackBellCondense
        ? 'Condense'
        : weapon?.toHit || weapon?.oneShotSpec
        ? 'Shot'
        : weapon?.kind === 'dex'
          ? 'Shot'
          : 'Melee';
    // The Deathknight's counter answers wherever its prey ends up; everyone else
    // must still have the target in reach when the blow actually falls.
    const stillReaches = (game: GameState): boolean =>
      source.deathknightKind
        ? source.alive && target.alive && source.team !== target.team
        : game.canMelee(source, target);
    return {
      id: this.nextId++,
      kind: 'melee',
      source,
      target,
      label,
      description: blackBell
        ? `${source.name} strikes ${target.name} with Black Bell in ${source.blackBellCondense ? 'Condense' : 'Toll'} mode.`
        : `${source.name} attacks ${target.name}.`,
      isStillValid: stillReaches,
      resolve: async (game) => {
        if (source.activeWeapon()) {
          await game.triggerEdgelordWeaponPulse(source);
          if (!source.alive || !target.alive) return;
        }
        if (!stillReaches(game)) {
          game.log(`${target.name} is out of reach — ${source.name}'s attack finds nothing.`);
          return;
        }
        // Swamprun creatures strike with an intrinsic (weaponless) attack that
        // carries its own damage type / class (e.g. the Specter's mental jab).
        const im = source.intrinsicMelee;
        if (im) {
          if (source.enemyKind === 'crusadeBallista') {
            fireCrusadeBallista(game, source, target);
            return;
          }
          const ictx = game.effectContext(source, target, null);
          const distance = dist(source.pos, target.pos);
          if (source.deathknightKind) {
            game.resolveDeathknightBasicAttack(source, target);
            return;
          }
          if (source.enemyKind === 'moay') {
            const amount = game.rng.roll(im.spec).total;
            const victims = moayTargets(game, source, target.pos);
            source.lastAttackRound = game.round;
            for (const victim of victims) {
              dealDamage(game.effectContext(source, victim, null), victim, dmg(amount, im.type), { aoe: true, canMiss: false });
            }
            game.log(`${source.name} slams ${victims.length} foes for ${amount} blunt damage each.`);
            return;
          }
          if (source.acidZombieKind) {
            const amount = game.rng.roll('1d4').total;
            const dealt = dealDamage(ictx, target, dmg(amount, 'corrosive'), {});
            dealDamage(ictx, source, dmg(amount, 'corrosive'), {
              canMiss: false,
              noImpactFx: true,
            });
            if (dealt > 0 && target.alive) {
              applyDot(ictx, target, {
                name: 'Acid Rot',
                duration: 3,
                damage: dmg(1, 'corrosive'),
                damageSpec: '1d3',
              });
            }
            return;
          }
          if (source.beastDemonKind && distance > MELEE_RANGE) {
            const spent = Math.min(6, source.beastDemonBlood);
            source.beastDemonBlood -= spent;
            game.log(`${source.name} spits ${spent} stored blood at ${target.name}.`);
            if (spent > 0) {
              dealDamage(ictx, target, dmg(spent, 'corrosive'), {});
            }
            return;
          }
          const charge = im.chargePer
            ? Math.min(im.chargeMax ?? Infinity, Math.floor(source.distMovedThisTurn / im.chargePer))
            : 0;
          if (charge > 0) game.log(`${source.name} charges in: +${charge} damage.`);
          const amount = game.rng.roll(im.spec).total + charge;
          source.lastAttackRound = game.round;
          if (source.sandUpkeepEvery > 0) {
            source.attacksSinceSandUpkeep += 1;
            if (source.attacksSinceSandUpkeep >= source.sandUpkeepEvery) {
              if (game.spendSandAt(source.pos, 1) > 0) {
                source.attacksSinceSandUpkeep = 0;
                game.log(`${source.name} drinks a charge of sand.`);
              }
            }
          }
          // A mending strike restores rather than wounds, and clears one affliction.
          if (im.type === 'healing') {
            heal(ictx, target, amount);
            const shed = target.statuses.findIndex(
              (s) => s.kind === 'dot' || s.kind === 'debuff' || s.kind === 'stun'
            );
            if (shed >= 0) {
              game.log(`${source.name} cleanses ${target.statuses[shed].name} from ${target.name}.`);
              target.statuses.splice(shed, 1);
            }
            im.onHit?.(ictx, target);
            return;
          }
          let dealt = 0;
          if (imbueDeflects(game, source, target, amount)) return;
          if (amount > 0) {
            dealt = dealDamage(ictx, target, dmg(amount, im.type), {});
          }
          if (source.beastDemonKind && dealt > 0) {
            source.beastDemonBlood += dealt;
            game.log(`${source.name} collects ${dealt} blood (${source.beastDemonBlood} stored).`);
          }
          game.lastIntrinsicDamage = dealt;
          if (target.alive) im.onHit?.(ictx, target);
          imbueAfterStrike(game, source, target, dealt, [], game.armourRiders(target));
          return;
        }
        // Arm a single Greed gain for this attack (Gambler's Blade dedup).
        source.greedArmed = true;
        const ctx = game.effectContext(source, target, null);
        const w = source.activeWeapon();
        let amount: number;
        let type: DamageType;
        let missed = false;
        const distUnits = Math.hypot(target.x - source.x, target.y - source.y) / RANGE_UNIT;
        if (w?.toHit) {
          // Crossbow: roll d20 to hit versus DC = floor(distance in tiles) × dcPerUnit.
          const dc = Math.floor(distUnits) * w.toHit.dcPerUnit;
          const roll = game.rollD20(source);
          type = w.damageType;
          if (roll >= dc) {
            let dmgTotal = game.rng.roll(w.toHit.rollSpec).total;
            if (w.toHit.bonusDice && w.toHit.bonusBelow != null && roll < w.toHit.bonusBelow) {
              dmgTotal += game.rng.roll(w.toHit.bonusDice).total;
            }
            amount = dmgTotal;
            game.log(`${source.name} fires the crossbow (d20 ${roll} vs DC ${dc}) — a hit for ${amount}.`);
          } else {
            amount = 0;
            missed = true;
            game.log(`${source.name} fires the crossbow (d20 ${roll} vs DC ${dc}) — a miss.`);
          }
          // Firing empties the chamber; it must be reloaded over the coming turns.
          source.reloadTurns = w.toHit.reloadTurns;
        } else if (w?.oneShotSpec) {
          amount = game.rng.roll(w.oneShotSpec).total;
          type = w.damageType;
        } else if (w?.kind === 'dex') {
          // Dex attack: floor((d20 + dex + bonus - 10) / 2), one roll per hit.
          const dex = source.effectiveDex();
          const bonus = (w.dexBonus ?? 0) + Math.floor(dex * (w.dexBonusPct ?? 0));
          const hits = w.hits ?? 1;
          type = w.damageType;
          // Range-accuracy bows can whiff at the edge of their reach.
          if (w.rangeAccuracy) {
            const px = distUnits * RANGE_UNIT;
            if (px > w.rangeAccuracy.maxRange) {
              missed = true;
            } else if (px > w.rangeAccuracy.autoWithin && !game.rng.chance(w.rangeAccuracy.farChance)) {
              missed = true;
            }
          }
          const rolls: number[] = [];
          let total = 0;
          if (!missed) {
            for (let h = 0; h < hits; h++) {
              const roll = game.rollD20(source);
              rolls.push(roll);
              total += Math.max(0, Math.floor((roll + dex + bonus - 10) / 2));
            }
            game.vfxSink?.diceRoll(`${hits}d20`, total, rolls, `${source.name} attacks`, target);
          }
          // Assassin's Cloak: Dex strikes hit harder from any form of stealth.
          if (!missed && game.isVeiled(source) && source.veiledDaggerBonus() > 0) {
            total = Math.round(total * (1 + source.veiledDaggerBonus()));
          }
          amount = total;
          if (missed) {
            game.log(`${source.name}'s shot sails wide.`);
          } else {
            game.log(`${source.name} attacks (d20 ${rolls.join('+')} + dex ${dex} + ${bonus}).`);
          }
          // Bows consume one arrow per shot (hit or miss); summons never run dry.
          if (w.usesArrows && !source.isSummon) {
            source.arrows = Math.max(0, source.arrows - 1);
            game.log(`${source.name} looses an arrow (${source.arrows} left).`);
          }
        } else {
          // Strength swing (unarmed = ×1 generic); flat bonuses land after the multiply.
          const roll = game.showRoll('1d6', `${source.name} strikes`, target).total;
          const flat =
            (w && source.profile.blackPrimaryTier ? 1 : 0) +
            source.meleeDamageBonus();
          amount = Math.max(1, strengthDamage(roll, source.effectiveStr(), w?.multiplier ?? 1) + flat);
          type = w?.damageType ?? 'generic';
          if (w?.critChance && game.rng.chance(w.critChance)) {
            amount *= 2;
            game.log(`${source.name} lands a critical hit!`);
          }
        }
        const charge = w?.charge && amount > 0 ? Math.min(w.charge.max, Math.floor(source.distMovedThisTurn / w.charge.per)) : 0;
        if (charge > 0) {
          amount += charge;
          game.log(`${source.name} charges in: +${charge} damage.`);
        }
        const pace = w?.moveScaled && amount > 0 ? Math.floor(source.moveRange() / w.moveScaled) : 0;
        if (pace > 0) amount += pace;
        if (w && amount > 0 && source.gatheredStones > 0) {
          game.log(`${source.name} hurls ${source.gatheredStones} gathered stone${source.gatheredStones === 1 ? '' : 's'}: +${source.gatheredStones} damage.`);
          amount += source.gatheredStones;
          source.gatheredStones = 0;
        }
        const activeId = source.activeWeaponId();
        const blackBellStrike = activeId != null && !!getItem(activeId).conjuredBlackBell;
        if (blackBellStrike) amount = 1;
        // Tantrum Gloves: a stored fizzle supercharges this strike.
        if (source.rageBonus > 0) {
          amount = Math.round(amount * (1 + source.rageBonus));
          game.log(`${source.name} swings in a fury (+${Math.round(source.rageBonus * 100)}%).`);
          source.rageBonus = 0;
        }
        // ---- Objects-class weapon enchants / sabotage / conjured gear -------
        const enchant = source.weaponEnchant;
        // Mind Shadow enchant (converter): the blow now deals sanity damage.
        if (enchant === 'mindShadow') type = 'sanity';
        const wid = activeId;
        // Bind Curse sabotage: a bound weapon hits for half (the kept half rounds up).
        if (wid && source.sabotagedItems.has(wid)) amount = Math.ceil(amount / 2);
        // Conjured Veil bow: firing spends mana and reveals the shooter for this turn.
        const bowFire = wid != null && !!getItem(wid).conjuredVeilBow;
        if (bowFire) {
          source.conjuredBowFiredThisTurn = true;
          source.mana = Math.max(0, source.mana - 2);
        }
        // Attacking with anything reveals you: any strike (hit or miss) tears
        // your own veil away before the blow lands.
        const veilCorrodePiercePower = game.prepareVeilCorrodePierce(source);
        if (source.isInvisible()) {
          source.statuses = source.statuses.filter((s) => s.kind !== 'invisibility');
          game.log(`${source.name} is revealed by their attack.`);
        }
        if (imbueDeflects(game, source, target, amount)) return;
        let dealt = 0;
        if (amount > 0) {
          dealt = dealDamage(ctx, target, dmg(amount, type), {
            ignoreResist: !!w?.ignoreResist,
            ignoreArmor: !!w?.ignoreArmor,
            noImpactFx: true,
          });
        }
        if (w && !source.redFirstWeaponAttackUsed) {
          source.redFirstWeaponAttackUsed = true;
          if (dealt > 0 && source.profile.redPrimaryTier && target.alive) {
            const bonus = game.rng.roll('1d3').total;
            dealDamage(ctx, target, dmg(bonus, type), {
              canMiss: false,
              ignoreResist: !!w.ignoreResist,
              ignoreArmor: !!w.ignoreArmor,
              noImpactFx: true,
            });
            game.log(`${source.name}'s first weapon strike surges for ${bonus} additional damage.`);
          }
        }
        if (dealt > 0) game.resolveVeilCorrodePierce(source, target, veilCorrodePiercePower);
        if (enchant === 'fireMind' && activeId === source.enchantedWeapon && dealt > 0 && target.alive) {
          game.applyBlueflareStacks(target, 1, source);
          game.log(`${source.name}'s enchanted weapon kindles Blueflare on ${target.name}.`);
        }
        if (enchant === 'lightningMind' && activeId === source.enchantedWeapon && dealt > 0) {
          if (target.team !== source.team && target.alive) applyMindLightningStack(target);
          const marked = game.mages.filter(
            (mage) =>
              mage.alive &&
              mage.team !== source.team &&
              mage.lightningMindStacks > 0 &&
              dist(mage.pos, target.pos) <= source.lightningMindRange
          );
          const sides = 1 + marked.reduce((total, mage) => total + mage.lightningMindStacks, 0);
          const route = game.showRoll(`1d${sides}`, 'Lightning Mind arc', source).total;
          const arcTarget = mindLightningBoltTarget(source, marked, route);
          void game.vfxSink?.lightningBolt?.(target.pos, arcTarget.pos);
          const baseDamage = game.showRoll('1d3', 'Lightning Mind damage', arcTarget).total;
          const arcDamage = mindLightningDamage(baseDamage, arcTarget.lightningMindStacks) *
            (source.lightningMindCritical ? 2 : 1);
          dealDamage(
            game.effectContext(source, arcTarget, null),
            arcTarget,
            dmg(arcDamage, 'sanity'),
            { canMiss: false }
          );
          source.lightningMindCharges = Math.max(0, source.lightningMindCharges - 1);
          game.log(`${source.name}'s weapon arcs ${arcDamage} sanity damage to ${arcTarget.name}.`);
          if (source.lightningMindCharges === 0) {
            source.weaponEnchant = undefined;
            source.enchantedWeapon = undefined;
            game.log(`${source.name}'s Lightning Mind enchant is spent.`);
          }
        }
        if (
          enchant === 'lightningEcho' &&
          activeId === source.lightningEchoWeapon &&
          dealt > 0
        ) {
          const fireEcho = Math.max(1, Math.round(dealt * 0.5));
          const mentalEcho = Math.max(1, Math.round(dealt * 0.25));
          game.log(`${source.name}'s weapon releases a Lightning Echo.`);
          dealDamage(ctx, target, dmg(fireEcho, 'heat'), { canMiss: false });
          const stacks = applyMindLightningStack(target);
          dealDamage(ctx, target, dmg(mindLightningDamage(mentalEcho, stacks), 'sanity'), {
            canMiss: false,
          });
          if (target.alive) game.applyBlueflareStacks(target, 1, source);
          if (source.lightningEchoCritical) {
            const echoRange = RANGE_UNIT * Math.min(12, 3 + Math.floor(source.lightningEchoPower / 3));
            for (const echoTarget of game.mages.filter(
              (mage) => mage !== target && mage.alive && dist(mage.pos, target.pos) <= echoRange
            )) {
              game.vfxSink?.lightningBolt?.(target.pos, echoTarget.pos);
              dealDamage(
                game.effectContext(source, echoTarget, null),
                echoTarget,
                dmg(fireEcho + Math.floor(source.lightningEchoPower / 8), 'heat'),
                { canMiss: false }
              );
            }
          }
        }
        // Curse Corrode enchant: every landed strike plants a fresh corrosion.
        if (enchant === 'curseCorrode' && dealt > 0 && target.alive) {
          applyDot(ctx, target, {
            name: 'Corrosion',
            duration: 3,
            damage: dmg(2, 'corrosive'),
            damageSpec: '1d3',
          });
        }
        if (blackBellStrike) {
          if (source.blackBellCondense) {
            game.condenseWithBlackBell(source, target);
          } else if (target.alive) {
            applyDot(ctx, target, {
              name: 'Tolling Wound',
              duration: game.shadowAt(target.pos) ? 9 : 6,
              damage: dmg(0, 'shadow'),
              damageSpec: '1d3',
            });
          }
        }
        // Conjured Veil bow: its acid bite mires the struck for two turns.
        if (bowFire && dealt > 0 && target.alive) {
          applyDebuff(ctx, target, { name: 'Mired', duration: 2, mods: { moveRange: -RANGE_UNIT * 4 } });
        }
        // Conjured gear, imbued weapons and the defender's imbued armour answer the blow.
        imbueAfterStrike(
          game,
          source,
          target,
          dealt,
          activeId ? getItem(activeId).onHit ?? [] : [],
          game.armourRiders(target)
        );
        // Torch / lantern swing (an unarmed strike while holding a light source):
        // the swing sweeps a 180° arc at melee reach, catching every foe in front.
        // A swing through a light-weak foe sears it for 5 true damage, and a torch
        // (not the everburning lantern) may be snuffed against a solid foe.
        if (!w && source.heldLightSourceId()) {
          const searLightWeak = (foe: Mage): void => {
            if (foe.alive && foe.isLightWeak()) {
              const lctx = game.effectContext(source, foe, null);
              dealDamage(lctx, foe, dmg(5, 'light'), { canMiss: false, trueDamage: true });
              game.log(`${source.name}'s light source burns ${foe.name} for 5 true damage.`);
            }
          };
          searLightWeak(target);
          // Sweep: the same swing also strikes any other foe in the 180° arc.
          const swept = game
            .magesInCone(source.pos, target.pos, MELEE_RANGE, CLEAVE_DEGREES, source)
            .filter(
              (m) => m !== target && m.team !== source.team && m.alive && !m.isAirborne()
            );
          for (const foe of swept) {
            if (amount > 0) {
              const sctx = game.effectContext(source, foe, null);
              dealDamage(sctx, foe, dmg(amount, 'generic'), { noImpactFx: true });
            }
            searLightWeak(foe);
          }
          if (swept.length > 0) {
            game.log(`${source.name}'s light source sweeps ${swept.length + 1} foes.`);
          }
          const torchId = source.heldTorchId();
          if (torchId && !target.isEthereal() && game.rng.chance(0.1)) {
            const ti = source.hands.indexOf(torchId);
            if (ti >= 0) source.hands.splice(ti, 1);
            if (!source.hands.some((h) => getItem(h).torchCombats != null)) source.torchCombatsLeft = 0;
            game.log(`${source.name}'s torch is snuffed out against ${target.name}.`);
          }
        }
        // Battle Robe: melee damage you deal feeds your mana pool (not bows).
        const isRanged = !!(w?.usesArrows || w?.toHit || w?.rangeAccuracy || w?.oneShotSpec);
        if (dealt > 0 && !isRanged && source.hasMeleeManaLeech()) {
          source.gainMana(dealt);
          game.log(`${source.name}'s battle robe drinks ${dealt} mana from the blow.`);
        }
        // Blood Ring: landing a melee blow siphons a little life back.
        if (dealt > 0 && !isRanged && source.meleeHealOnHit() > 0 && source.alive) {
          const heal = Math.round(source.meleeHealOnHit() * source.healMult());
          source.hp = Math.min(source.maxHp, source.hp + heal);
          game.log(`${source.name}'s blood ring draws ${heal} health from the strike.`);
        }
        // Thorn Ring: the struck mage's thorns bite the attacker back.
        const thorns = target.thornsTotal();
        if (thorns > 0 && dealt > 0 && source.alive) {
          const back = game.effectContext(target, source, null);
          dealDamage(back, source, dmg(thorns, 'pierce'), { canMiss: false });
        }
        // War Hammer: a solid blow hurls the target backwards.
        if (w?.knockbackUnits && !missed && target.alive) {
          game.knockbackMage(source, target, w.knockbackUnits);
        }
        // Lunging Edge: dash after connecting with the strike.
        if (w?.dashAfterHitUnits && !missed && source.alive) {
          await game.dashAfterHit(source, w.dashAfterHitUnits);
        }
        // A one-shot weapon is spent after firing.
        if (w?.oneShotSpec) {
          const id = source.activeWeaponId();
          if (id) {
            const i = source.hands.indexOf(id);
            if (i >= 0) source.hands.splice(i, 1);
            game.log(`${source.name}'s ${getItem(id).name} is spent.`);
          }
        }
      },
    };
  }

  makeSpellItem(
    source: Mage,
    spell: Spell,
    target: Mage | null,
    targetPoint: Vec2 | null,
    respondingTo?: number,
    targetPoint2?: Vec2 | null,
    modifiers?: WordId[]
  ): StackItem {
    const targetName = target ? ` → ${target.name}` : '';
    return {
      id: this.nextId++,
      kind: 'spell',
      source,
      spell,
      target: target ?? undefined,
      targetPoint: targetPoint ?? undefined,
      targetPoint2: targetPoint2 ?? undefined,
      respondingTo,
      modifiers: modifiers?.length ? [...modifiers] : undefined,
      counters: spell.counters,
      label: spell.name,
      description: `${source.name} casts ${spell.name}${targetName}. ${spell.description}`,
      isStillValid: (game) => {
        if (!source.alive) return false;
        if (!stormWordsCompatible([...spell.words, ...(modifiers ?? [])])) return false;
        if (!game.canCastSpellNow(spell)) return false;
        if (spell.targeting === 'enemy' || spell.targeting === 'ally' || spell.targeting === 'any') {
          return !!target && game.isValidSpellTarget(spell, source, target);
        }
        return true;
      },
      resolve: (game) => {
        const ctx = game.effectContext(source, target, targetPoint, targetPoint2 ?? null);
        // Mark the caster so spell damage can grant Blood Charm lifesteal and
        // arm a single Greed gain for this cast (Gambler's Blade dedup).
        source.spellcastActive = true;
        source.greedArmed = true;
        const done = () => {
          source.spellcastActive = false;
        };
        const result = spell.cast(ctx);
        // White-secondary casters mend themselves and their nearest ally each
        // time they finish casting one of their colour spells.
        this.applyWhiteSecondaryHeal(source, spell);
        if (result && typeof (result as Promise<void>).then === 'function') {
          return (result as Promise<void>).then(
            () => done(),
            (err) => {
              done();
              throw err;
            }
          );
        }
        done();
        return result;
      },
    };
  }

  /** Convenience for spell metadata lookups. */
  wordLabel(id: keyof typeof WORDS): string {
    return WORDS[id].label;
  }
}
