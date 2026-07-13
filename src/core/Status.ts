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
  | 'orderJudgment';
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
}

export interface DotStatus extends BaseStatus {
  kind: 'dot';
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
  /** Extra dice rolled on a tick when the bearer dealt no damage on its last turn. */
  bonusNoDamageSpec?: string;
  /** Owner's team: when the bearer damages this team in a cycle, the DoT extends +2. */
  extendOwnerTeam?: number;
  /** turnSeq of the last cycle-extension (dedups multi-hit extensions). */
  extendSeq?: number;
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
  | OrderJudgmentStatus;

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
