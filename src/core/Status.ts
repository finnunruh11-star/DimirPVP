import type { DamageInstance } from './Damage';

// Status effects placed on a mage. Durations are measured in "turn cycles":
// a status' duration is decremented at the start of the affected mage's turn,
// and the status is removed when it reaches zero.

export type StatusKind =
  | 'invisibility'
  | 'stun'
  | 'dot'
  | 'debuff'
  | 'ward'
  | 'auraDot'
  | 'control'
  | 'shadowVeil'
  | 'shadowTrail'
  | 'forget'
  | 'orderJudgment'
  | 'pacified'
  | 'orderMandate'
  | 'bindCurseAura'
  | 'veilCorrodePierce'
  | 'twistRune'
  | 'fireVeilAura'
  | 'fire'
  | 'sentinelFire'
  | 'blueflare'
  | 'soulRend'
  | 'reap'
  | 'shadowAnchor'
  | 'memoryShackle'
  | 'shadowHook'
  | 'phaseOut'
  | 'threadMark'
  | 'swornRepetition'
  | 'woundShade'
  | 'mindFuse'
  | 'reactionNeedle'
  | 'foeBlind'
  | 'seal'
  | 'anchorSpike'
  | 'pierceEcho'
  | 'stormConduit'
  | 'deathCurse';
export type StunType = 'main' | 'movement' | 'full';
export type InvisMode = 'full' | 'partial';
/** Kinds of mental compulsion the Mind word can inflict. */
export type ControlMode = 'expose' | 'repeat' | 'random';

export interface BaseStatus {
  /** Unique-per-mage identity used for extend/refresh logic. */
  key: string;
  name: string;
  kind: StatusKind;
  duration: number;
  icon?: string;
}

export interface InvisibilityStatus extends BaseStatus {
  kind: 'invisibility';
  mode: InvisMode;
}

export interface StunStatus extends BaseStatus {
  kind: 'stun';
  stunType: StunType;
  /** A physical binding (roots, shackles) rather than terrain like a reality break. */
  physicalRoot?: boolean;
}

export interface DotStatus extends BaseStatus {
  kind: 'dot';
  /** Index of the mage whose effect created this DoT. */
  sourceIndex?: number;
  /** Damage applied at the start of the affected mage's turn. */
  damage: DamageInstance;
  /** Optional dice spec rolled fresh each tick (e.g. "1d3"); overrides amount. */
  damageSpec?: string;
  /**
   * If set, the DoT only deals damage on a tick while the bearer's opponent is
   * within this distance band (px). Used by Curse Pierce.
   */
  band?: { min: number; max: number };
  /** If set, each tick has this chance (0-1) to also stun the bearer. */
  stunChance?: number;
  /** The kind of stun applied when `stunChance` triggers (default 'full'). */
  stunType?: StunType;
  /**
   * Stacking DoT: current number of stacks. When set, each tick rolls
   * `perStackSpec` once per stack and sums the results.
   */
  stacks?: number;
  /** Maximum stacks this DoT can reach. */
  maxStacks?: number;
  /** Dice rolled once per stack each tick (e.g. "1d2"); total = sum over stacks. */
  perStackSpec?: string;
  /** True once a stack was (re)applied since the last tick; drives decay. */
  freshStack?: boolean;
  /** Lose one stack on any tick where no fresh stack was applied. */
  decayPerTick?: boolean;
  /** On each tick, spread this DoT to enemies within this radius (px). */
  infectRadius?: number;
  /** Team of the DoT's owner, used to target only its enemies when spreading. */
  sourceTeam?: number;
  /** Index (in GameState.mages) of the mage healed for this DoT's damage each tick. */
  lifestealToIndex?: number;
  /** Resource restored by lifesteal; existing DoTs default to HP. */
  lifestealPool?: 'hp' | 'sanity';
  /** Optional enemy-only damage splashed around the bearer on each tick. */
  splash?: {
    radius: number;
    damage: DamageInstance;
    damageSpec: string;
  };
  /** Extra dice rolled on a tick when the bearer dealt no damage on its last turn. */
  bonusNoDamageSpec?: string;
  /** Owner's team: when the bearer damages this team in a cycle, the DoT extends +2. */
  extendOwnerTeam?: number;
  /** turnSeq of the last cycle-extension (dedups multi-hit extensions). */
  extendSeq?: number;
  /** Reap stacks added to the bearer on each tick. */
  reapPerTick?: number;
  /** Index (in GameState.mages) whose healing adds 1 Reap to the bearer. */
  reapOnOwnerHealIndex?: number;
  /** On the bearer's death, pass its remaining Reap to the nearest enemy. */
  reapTransferRadius?: number;
  /** Dice specs used in order on successive ticks; the last one repeats forever. */
  escalateSpecs?: string[];
  /** How many ticks have already been spent walking `escalateSpecs`. */
  escalateIndex?: number;
  /** Random actions the bearer forgets on every tick. */
  forgetPerTick?: number;
  /** Each tick, copy this DoT at half duration onto everything within this radius. */
  spreadRadius?: number;
  /** Newly infected bearers (and the original) are veiled by the contagion. */
  spreadVeils?: boolean;
  /** Pierce damage on the bearer buys the DoT more time. */
  extendOnPierce?: {
    /** Hits of at least this much always extend; weaker hits roll `chanceBelow`. */
    minAmount: number;
    chanceBelow: number;
    /** Remaining duration may never be pushed above this. */
    maxDuration: number;
  };
  /** When a tick empties the bearer's sanity, jump to the nearest unit in this radius. */
  jumpOnMindBreakRadius?: number;
}

/**
 * Bind Shadow Veil: the bearer is sealed away — held still and hidden from its
 * OWN side, so only `ownerTeam` can still reach it while it is ground down.
 */
export interface SealStatus extends BaseStatus {
  kind: 'seal';
  /** The team that can no longer see or target the bearer. */
  blindTeam: number;
  ownerIndex: number;
  damageSpec: string;
  executeAmount: number;
}

/** Bind Shatter Pierce: a spike the bearer is dragged back to every turn. */
export interface AnchorSpikeStatus extends BaseStatus {
  kind: 'anchorSpike';
  ownerIndex: number;
  x: number;
  y: number;
  /** Pixels of travel that earn one die of shatter on the yank. */
  pxPerDie: number;
  maxDice: number;
}

/** Bind Curse Pierce: the bearer's pierce damage is dealt a second time at turn end. */
export interface PierceEchoStatus extends BaseStatus {
  kind: 'pierceEcho';
}

/** Lightning Curse: every wound on the bearer arcs a share onward to nearby bodies. */
export interface StormConduitStatus extends BaseStatus {
  kind: 'stormConduit';
  ownerIndex: number;
  /** How many other bodies a single wound may arc to. */
  maxTargets: number;
  radius: number;
  /** Fraction of the wound passed to each of them. */
  sharePct: number;
}

/** Stacking execution mark: the bearer dies at or below this much health. */
export interface ReapStatus extends BaseStatus {
  kind: 'reap';
  stacks: number;
}

/**
 * Death Curse: `stacks` counters that fall on shadow/corrosive damage and at the
 * bearer's turn start, each granting Reap. While it lasts, executions become Reap
 * instead of kills; its final counter executes the bearer.
 */
export interface DeathCurseStatus extends BaseStatus {
  kind: 'deathCurse';
  stacks: number;
  ownerIndex: number;
}

/** Persistent Fire stacks. Their damage, spread, and decay are resolved at turn start. */
export interface FireStatus extends BaseStatus {
  kind: 'fire';
  stacks: number;
  /** Index of the mage whose spell originally applied the fire. */
  ownerIndex: number;
}

/** Mine elemental flame with separate thresholds and a tenth-stack eruption. */
export interface SentinelFireStatus extends BaseStatus {
  kind: 'sentinelFire';
  stacks: number;
  ownerIndex: number;
}

/** Mental counterpart to Fire: easier spread, half damage, and slower decay. */
export interface BlueflareStatus extends BaseStatus {
  kind: 'blueflare';
  stacks: number;
  ownerIndex: number;
  /** Low-stack Blueflare decays only on alternating bearer turns. */
  decayNext: boolean;
}

/** Stacking true-damage affliction applied by the Edgelord Lantern; one stack fades per tick. */
export interface SoulRendStatus extends BaseStatus {
  kind: 'soulRend';
  stacks: number;
  ownerIndex: number;
}

export interface DebuffStatus extends BaseStatus {
  kind: 'debuff';
  /** Flat modifiers. Positive damageTaken = takes more; negative moveRange = slower. */
  mods: Partial<{
    moveRange: number;
    damageDealt: number;
    damageTaken: number;
  }>;
}

/** A consumable counter (e.g. "Mind Dodge") that negates the next matching hit. */
export interface WardStatus extends BaseStatus {
  kind: 'ward';
  /** 'mind' wards block the next sanity damage or mental (control) effect. */
  against: 'mind';
}

/** An aura centred on the bearer that damages everyone else nearby each turn. */
export interface AuraDotStatus extends BaseStatus {
  kind: 'auraDot';
  radius: number;
  damageSpec: string;
  type: DamageInstance['type'];
  damageClass: DamageInstance['damageClass'];
}

/** A mental compulsion placed by the Mind word. */
export interface ControlStatus extends BaseStatus {
  kind: 'control';
  mode: ControlMode;
}

/** While in a shadow zone the bearer is treated as fully invisible. */
export interface ShadowVeilStatus extends BaseStatus {
  kind: 'shadowVeil';
}

/**
 * While active, the bearer drops a shadow zone (owned by `team`) at its feet
 * whenever it moves. Used by Mind Shadow to mark a fleeing enemy.
 */
export interface ShadowTrailStatus extends BaseStatus {
  kind: 'shadowTrail';
  team: number;
  /** TTL (in rounds) of each shadow the trail drops. */
  perShadowTtl: number;
}

/**
 * Twist Mind: the bearer has "forgotten" some of its actions. Each entry is
 * either a literal action token ('move' / 'melee') or a WordId the bearer can no
 * longer cast. Placeholder for a richer system later — add more tokens freely.
 */
export interface ForgetStatus extends BaseStatus {
  kind: 'forget';
  forgotten: string[];
}

/**
 * Bind Shadow Mind: the bearer is chained to a point. At each of its turn starts
 * it is dragged `pullPx` toward the anchor; only then is it checked against the
 * anchoring team's shadows — inside it forgets a word, outside the chain bites.
 */
export interface ShadowAnchorStatus extends BaseStatus {
  kind: 'shadowAnchor';
  x: number;
  y: number;
  ownerIndex: number;
  ownerTeam: number;
  pullPx: number;
}

/**
 * Bind Mind Corrode: while the shackle holds, anything the bearer declares is
 * eaten by it — a weapon strike forgets 'melee', a spell forgets every word it
 * used. `forgetDuration` is how long each theft lasts.
 */
export interface MemoryShackleStatus extends BaseStatus {
  kind: 'memoryShackle';
  forgetDuration: number;
}

/**
 * Bind Shadow Pierce: a hook sunk into the bearer. Each of its turns it is
 * reeled `pullPx` toward the hooker, bleeds `damageSpec`, and leaves one of the
 * hooker's shadows where it comes to rest.
 */
export interface ShadowHookStatus extends BaseStatus {
  kind: 'shadowHook';
  ownerIndex: number;
  ownerTeam: number;
  pullPx: number;
  damageSpec: string;
  shadowTtl: number;
}

/**
 * Phased into the dark: the bearer does not exist. Nothing may target, damage or
 * afflict it, and it may do nothing but walk. 'self' phasing also lets the bearer
 * pass through every obstacle; 'banished' detonates around the bearer on release.
 */
export interface PhaseOutStatus extends BaseStatus {
  kind: 'phaseOut';
  mode: 'self' | 'banished';
  ownerIndex: number;
  ownerTeam: number;
  /** 'self': dealt to any enemy the bearer walks through. */
  passThroughSpec?: string;
  /** 'banished': dealt to every hostile within `burstRadius` when the phase ends. */
  burstSpec?: string;
  burstRadius?: number;
}

/** Bind Mind Pierce: threaded victims share a fraction of every wound. */
export interface ThreadMarkStatus extends BaseStatus {
  kind: 'threadMark';
  ownerTeam: number;
  /** Fraction of a threaded wound echoed to the other marks, as mill. */
  sharePct: number;
}

/**
 * Bind Mind Curse: obeying the compulsion deepens the rot, breaking it detonates.
 * Riding it out to the end costs no blood but the stacks linger.
 */
export interface SwornRepetitionStatus extends BaseStatus {
  kind: 'swornRepetition';
  ownerIndex: number;
  stacks: number;
  perStackSpec: string;
  lingerTurns: number;
  /** Set once the debuff has outlived the compulsion; it only decays from here. */
  lingering: boolean;
}

/** Shadow Curse Pierce: a shadow that rides the bearer and counts as the owner's. */
export interface WoundShadeStatus extends BaseStatus {
  kind: 'woundShade';
  ownerIndex: number;
  ownerTeam: number;
  radius: number;
  /** Omit for a shade that only projects a pool and never bites on its own. */
  damageSpec?: string;
}

/**
 * Mind Shatter Curse: a fuse that swells every turn it survives. Acting burns it
 * down faster, so the victim chooses between a small early blast and a huge late one.
 */
export interface MindFuseStatus extends BaseStatus {
  kind: 'mindFuse';
  ownerIndex: number;
  baseSpec: string;
  growthSpec: string;
  ticks: number;
}

/** Mind Curse Pierce: every reaction the bearer takes twists the needle. */
export interface ReactionNeedleStatus extends BaseStatus {
  kind: 'reactionNeedle';
  ownerIndex: number;
  damageSpec: string;
}

/**
 * Veil Mind Curse: the bearer can no longer tell friend from foe. Every entity
 * reads as hostile to it and its targets are chosen at random.
 */
export interface FoeBlindStatus extends BaseStatus {
  kind: 'foeBlind';
  ownerIndex: number;
  damageSpec: string;
}

/**
 * Order Curse Slash: the bearer has been ordered to engage a specific entity
 * (`targetIndex`). At the start of each of the bearer's turns GameState judges
 * the turn just taken — it gains a stack for each of "did not move toward" and
 * "did not attack" the entity. After `evalsLeft` reaches zero the judgement
 * detonates, dealing `perStackSpec` slashing per accrued stack.
 */
export interface OrderJudgmentStatus extends BaseStatus {
  kind: 'orderJudgment';
  /** Index (in GameState.mages) of the entity the bearer must engage. */
  targetIndex: number;
  /** Index (in GameState.mages) of the mage that authored the order. */
  ownerIndex: number;
  /** Bearer-turns of judgement remaining before detonation. */
  evalsLeft: number;
  /** Disobedience stacks accrued so far. */
  stacks: number;
  /** Distance to the entity captured at the previous evaluation. */
  lastDist: number;
  /** True once the bearer has damaged the entity since the last evaluation. */
  attackedTarget: boolean;
  /** False until the first turn-start snapshot has been taken. */
  observing: boolean;
  /** Dice rolled once per stack when the judgement detonates. */
  perStackSpec: string;
}

/** Hexcraft Bind Curse: binds nearby enemies when the bearer's turn starts. */
export interface BindCurseAuraStatus extends BaseStatus {
  kind: 'bindCurseAura';
  radius: number;
  ownerIndex: number;
  /** Lifetime trigger count per enemy mage index; each may be bound twice. */
  boundCounts: Record<number, number>;
}

/** Hexcraft Veil Corrode Pierce: converts a broken attacker's veil into damage. */
export interface VeilCorrodePierceStatus extends BaseStatus {
  kind: 'veilCorrodePierce';
}

/**
 * Mono Order on an enemy: no hostile action may be DECLARED. Blocked options
 * are unusable rather than wasted, so nothing is spent trying.
 */
export interface PacifiedStatus extends BaseStatus {
  kind: 'pacified';
}

/**
 * Mono Order on an ally: strictly better, strictly obedient. Everything it does
 * hits harder, but only the entity the caster named may be touched.
 */
export interface OrderMandateStatus extends BaseStatus {
  kind: 'orderMandate';
  /** Index in GameState.mages of the only entity the bearer may target. */
  targetIndex: number;
  /** Index of the mage that issued the mandate. */
  ownerIndex: number;
  /** Multiplier on damage dealt and healing done. */
  potency: number;
}

/** Hexcraft Shatter Twist: orbit nearby entities when the bearer starts a turn. */
export interface TwistRuneStatus extends BaseStatus {
  kind: 'twistRune';
  ownerIndex: number;
  radius: number;
  clockwise: boolean;
}

/** Fire Veil: kindle nearby enemies at turn start while the bearer remains veiled. */
export interface FireVeilAuraStatus extends BaseStatus {
  kind: 'fireVeilAura';
  radius: number;
  ownerIndex: number;
}

export type Status =
  | InvisibilityStatus
  | StunStatus
  | DotStatus
  | DebuffStatus
  | WardStatus
  | AuraDotStatus
  | ControlStatus
  | ShadowVeilStatus
  | ShadowTrailStatus
  | ForgetStatus
  | OrderJudgmentStatus
  | PacifiedStatus
  | OrderMandateStatus
  | BindCurseAuraStatus
  | VeilCorrodePierceStatus
  | TwistRuneStatus
  | FireVeilAuraStatus
  | FireStatus
  | SentinelFireStatus
  | BlueflareStatus
  | SoulRendStatus
  | ReapStatus
  | ShadowAnchorStatus
  | MemoryShackleStatus
  | ShadowHookStatus
  | PhaseOutStatus
  | ThreadMarkStatus
  | SwornRepetitionStatus
  | WoundShadeStatus
  | MindFuseStatus
  | ReactionNeedleStatus
  | FoeBlindStatus
  | SealStatus
  | AnchorSpikeStatus
  | PierceEchoStatus
  | StormConduitStatus
  | DeathCurseStatus;

/**
 * Add a status, or refresh/extend an existing one that shares the same key.
 * - extend = true  -> add the new duration on top of whatever remains.
 * - extend = false -> refresh to the larger of the two durations.
 */
export function addOrExtendStatus(
  list: Status[],
  status: Status,
  extend: boolean
): void {
  const existing = list.find((s) => s.key === status.key);
  if (!existing) {
    list.push(status);
    return;
  }
  if (extend) {
    existing.duration += status.duration;
  } else {
    existing.duration = Math.max(existing.duration, status.duration);
  }
  // Copy over the latest parameters (e.g. stronger invisibility replaces weaker).
  Object.assign(existing, { ...status, duration: existing.duration });
}
