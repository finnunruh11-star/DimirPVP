import {
  ACTIONS_PER_TURN,
  FIELD,
  MOVE_RANGE,
  START_HP,
  START_SANITY,
} from '../config/constants';
import { Dev } from '../config/dev';
import type { WordId } from './Words';
import { WORDS } from './Words';
import type {
  ForgetStatus,
  InvisibilityStatus,
  Status,
  StunStatus,
  StunType,
} from './Status';
import type { Vec2 } from './utils';

export interface ActionPool {
  move: number;
  main: number;
  bonus: number;
}

export class Mage {
  name: string;
  isAI: boolean;
  team: 1 | 2;

  x: number;
  y: number;

  hp: number;
  maxHp: number;
  sanity: number;
  maxSanity: number;

  loadout: WordId[];
  charges: Record<string, number> = {};

  statuses: Status[] = [];
  actions: ActionPool = { ...ACTIONS_PER_TURN };

  /** Whether this mage has a reaction available this turn cycle. */
  reactionAvailable = false;

  /** Whether this mage has already cast a spell on its current turn. */
  hasCastThisTurn = false;

  /**
   * The game turn-sequence number on which this mage was last struck by Twist,
   * used to detect a consecutive Twist within the same turn (extra damage).
   */
  twistStampSeq = -1;

  /**
   * The last action this mage actually performed, kept so the Mind+Bind
   * compulsion can force a repeat. `spellId` is a registry key.
   */
  lastAction: {
    type: 'move' | 'melee' | 'spell';
    spellId?: string;
    target?: Mage;
    point?: Vec2;
  } | null = null;

  constructor(opts: {
    name: string;
    isAI: boolean;
    team: 1 | 2;
    position: Vec2;
    loadout: WordId[];
  }) {
    this.name = opts.name;
    this.isAI = opts.isAI;
    this.team = opts.team;
    this.x = opts.position.x;
    this.y = opts.position.y;
    this.maxHp = START_HP;
    this.hp = START_HP;
    this.maxSanity = START_SANITY;
    this.sanity = START_SANITY;
    this.loadout = [...opts.loadout];
    for (const w of this.loadout) this.charges[w] = WORDS[w].charges;
  }

  get pos(): Vec2 {
    return { x: this.x, y: this.y };
  }

  get alive(): boolean {
    return this.hp > 0 && this.sanity > 0;
  }

  /** True if this mage's loadout grants a reaction at all. */
  get grantsReaction(): boolean {
    return this.loadout.some((w) => WORDS[w].grantsReaction);
  }

  hasReaction(): boolean {
    return this.grantsReaction && this.reactionAvailable;
  }

  // ---- Charges --------------------------------------------------------------

  hasCharges(words: WordId[]): boolean {
    return words.every((w) => (this.charges[w] ?? 0) > 0);
  }

  spendCharges(words: WordId[]): void {
    for (const w of words) {
      this.charges[w] = Math.max(0, (this.charges[w] ?? 0) - 1);
    }
  }

  // ---- Statuses -------------------------------------------------------------

  getStatus<T extends Status>(kind: T['kind']): T | undefined {
    return this.statuses.find((s) => s.kind === kind) as T | undefined;
  }

  getInvisibility(): InvisibilityStatus | undefined {
    return this.getStatus<InvisibilityStatus>('invisibility');
  }

  isFullyInvisible(): boolean {
    const inv = this.getInvisibility();
    return !!inv && inv.mode === 'full';
  }

  isInvisible(): boolean {
    return !!this.getInvisibility();
  }

  isStunned(type?: StunType): boolean {
    return this.statuses.some((s) => {
      if (s.kind !== 'stun') return false;
      const stun = s as StunStatus;
      if (!type) return true;
      if (stun.stunType === 'full') return true;
      return stun.stunType === type;
    });
  }

  /** Actions/words this mage has "forgotten" (Twist Mind). */
  forgotten(): string[] {
    const f = this.statuses.find((s) => s.kind === 'forget') as ForgetStatus | undefined;
    return f?.forgotten ?? [];
  }

  /** Has this mage forgotten a given action token ('move' / 'melee') or word? */
  hasForgotten(token: string): boolean {
    return this.forgotten().includes(token);
  }

  modifier(key: 'moveRange' | 'damageDealt' | 'damageTaken'): number {
    let total = 0;
    for (const s of this.statuses) {
      if (s.kind === 'debuff' && s.mods[key] != null) total += s.mods[key]!;
    }
    return total;
  }

  moveRange(): number {
    // Dev cheat: reach anywhere on the field.
    if (Dev.infiniteMove) return Math.hypot(FIELD.w, FIELD.h);
    return Math.max(0, MOVE_RANGE + this.modifier('moveRange'));
  }

  /** Spend one action of the given kind, unless dev toggles make it free. */
  spend(kind: 'move' | 'main' | 'bonus'): void {
    if (Dev.infiniteActions) return;
    if (kind === 'move' && Dev.infiniteMove) return;
    this.actions[kind] = Math.max(0, this.actions[kind] - 1);
  }

  // ---- Turn lifecycle -------------------------------------------------------

  /** Reset the action pool for a fresh turn, respecting any stuns. */
  beginTurn(): void {
    this.actions = { ...ACTIONS_PER_TURN };
    this.hasCastThisTurn = false;
    if (this.isStunned('full')) {
      this.actions = { move: 0, main: 0, bonus: 0 };
    } else {
      if (this.isStunned('main')) this.actions.main = 0;
      if (this.isStunned('movement')) this.actions.move = 0;
    }
    // A forgotten 'move' costs this mage its movement for the turn.
    if (this.hasForgotten('move')) this.actions.move = 0;
  }

  /**
   * Age statuses at the start of this mage's turn: decrement durations and drop
   * any that have expired. Returns log lines describing what faded. DoT damage
   * itself is applied separately by GameState (it needs board context).
   */
  tickStatuses(): string[] {
    const log: string[] = [];
    for (const s of this.statuses) s.duration -= 1;
    const expired = this.statuses.filter((s) => s.duration <= 0);
    for (const s of expired) log.push(`${s.name} fades from ${this.name}.`);
    this.statuses = this.statuses.filter((s) => s.duration > 0);
    return log;
  }

  /**
   * Consume the first ward matching `against`, if present. Returns true if a
   * ward was spent (and the incoming effect should be negated).
   */
  consumeWard(against: 'mind'): boolean {
    const idx = this.statuses.findIndex((s) => s.kind === 'ward' && s.against === against);
    if (idx < 0) return false;
    this.statuses.splice(idx, 1);
    return true;
  }
}
