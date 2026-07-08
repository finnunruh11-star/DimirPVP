import { Dice } from './Dice';
import { Mage } from './Mage';
import type { StackItem, NeedleBan } from './Stack';
import type { Spell } from '../spells/Spell';
import type { EffectContext, VfxSink, SubTargeter } from '../effects/effects';
import { dealDamage, heal } from '../effects/effects';
import { dmg } from './Damage';
import type { DamageType, DamageClass } from './Damage';
import type { ItemId, ItemDef } from './Items';
import { getItem, SLOT_CAPS } from './Items';
import { dist, stepTowards, type Vec2 } from './utils';
import {
  CONE_DEGREES,
  CLEAVE_DEGREES,
  FIELD,
  MAGE_BODY_RADIUS,
  MELEE_DAMAGE,
  MELEE_RANGE,
  MOVE_RANGE,
  PICKUP_RANGE,
  RANGE_UNIT,
  SCARAB,
  SHADOW_RADIUS,
  SHADOW_TTL,
  TOTEM_TTL,
  VEIL,
} from '../config/constants';
import { WORDS } from './Words';
import type { ShadowZone } from './Shadow';
import type { Totem } from './Totem';
import type { Scarab } from './Scarab';
import { scarabAlive } from './Scarab';
import type { BarrierZone } from './Barrier';
import { barrierContains } from './Barrier';
import { addOrExtendStatus, type ControlStatus, type DotStatus, type ShadowTrailStatus } from './Status';

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
  damageClass: DamageClass;
  potency: number;
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

/**
 * The pure (Phaser-free) game model: two mages, whose turn it is, the round
 * counter, the reaction stack, dice and a rolling log. The Phaser scene drives
 * the flow (prompts, animation) and calls into this for all rules.
 */
export class GameState {
  mages: Mage[];
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
  /** The initiative roll each mage made (for display / logging). */
  initiativeRolls: number[] = [];

  /** Active shadow zones placed by the Shadow word. */
  shadows: ShadowZone[] = [];

  /** Active totems placed by the Corrode+Curse combo. */
  totems: Totem[] = [];

  /** Active scarab summons placed by the Curse+Drain+Corrode combo. */
  scarabs: Scarab[] = [];

  /** Active reality-break wedges placed by Reality+Shatter (block all movement). */
  barriers: BarrierZone[] = [];

  /** Board-wide escalating damage effects (Necrosis). */
  globalEscalations: GlobalEscalation[] = [];

  /** Items dropped on the ground, awaiting pickup by their owner. */
  droppedItems: DroppedItem[] = [];

  /** Active Mutivarg's Rod slow-circles. */
  mutivargZones: MutivargZone[] = [];

  /** Alive summon (scarab) count per team at last regen, to score deaths since. */
  private prevScarabAlive: Record<number, number> = {};

  /** Mages queued for an extra turn (Shatter+Mind+Reality), taken in order. */
  extraTurnQueue: Mage[] = [];

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
    const scored = this.mages.map((m, i) => {
      const roll = this.rng.roll('1d20').total;
      const total = roll + m.effectiveDex();
      return { i, total, tie: this.rng.roll('1d1000').total };
    });
    scored.sort((a, b) => b.total - a.total || b.tie - a.tie);
    this.initiativeOrder = scored.map((s) => s.i);
    this.initiativeRolls = [];
    for (const s of scored) this.initiativeRolls[s.i] = s.total;
    this.turnPtr = 0;
    this.currentIndex = this.initiativeOrder[0] ?? 0;
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

  /** Living enemies of `m`. */
  livingEnemiesOf(m: Mage): Mage[] {
    return this.enemiesOf(m).filter((o) => o.alive);
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
    for (const m of this.mages) if (m.alive) teams.add(m.team);
    return [...teams];
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

  get isOver(): boolean {
    return this.teamsAlive().length <= 1;
  }

  // ---- Turn lifecycle -------------------------------------------------------

  /** Reset reactions for both mages at the start of a new round. */
  startRound(): void {
    for (const m of this.mages) {
      m.reactionAvailable = m.canEverReact;
      m.reactedThisCycle = false;
    }
  }

  beginTurn(): void {
    const m = this.current;
    this.turnSeq += 1;
    // Keep latched scarabs glued to whoever they bit before anything else runs.
    this.updateAttachedScarabs();
    // Ground hazards and shadow-curse auras strike before the mage's own turn.
    this.applyTotemAuras(m);
    this.applyAuraDots(m);
    this.applyDotDamage(m);
    this.applyMutivargZones(m);
    this.applyThunderBlessing(m);
    this.tickScarabs(m);
    const ticks = m.tickStatuses();
    for (const line of ticks) this.log(line);
    this.applyControlOnTurnStart(m);
    this.regenResources(m);
    m.beginTurn();
  }

  endTurn(): void {
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
    for (let step = 0; step < n; step++) {
      this.turnPtr += 1;
      if (this.turnPtr >= n) {
        this.turnPtr = 0;
        this.round += 1;
        this.tickShadows();
        this.tickTotems();
        this.tickBarriers();
        this.tickGlobalEscalations();
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
   * allied summons (scarabs) lost since its previous turn for black's regen.
   */
  private regenResources(m: Mage): void {
    const alive = this.scarabs.filter((s) => s.owner === m.team && scarabAlive(s)).length;
    const deaths = Math.max(0, (this.prevScarabAlive[m.team] ?? alive) - alive);
    m.regen({ summonDeaths: deaths });
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
        dealDamage(ctx, m, dmg(amount, e.type, e.damageClass), { canMiss: false, aoe: true });
      }
      e.index += 1;
    }
    this.globalEscalations = this.globalEscalations.filter((e) => e.index < e.stages.length);
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
    return this.shadows.filter((s) => s.owner === team);
  }
  /** The shadow zone containing `pos`, if any. */
  shadowAt(pos: Vec2): ShadowZone | undefined {
    return this.shadows.find((s) => dist(pos, { x: s.x, y: s.y }) <= s.radius);
  }

  /** Whether a mage is currently standing in any shadow. */
  isInShadow(m: Mage): boolean {
    return !!this.shadowAt(m.pos);
  }

  /**
   * Can `source` reach `point` within `range`, either directly or by casting
   * from / bouncing through one of its own shadows?
   */
  withinCastRange(source: Mage, point: Vec2, range: number): boolean {
    if (dist(source.pos, point) <= range) return true;
    return this.shadowsOf(source.team).some((s) => dist({ x: s.x, y: s.y }, point) <= range);
  }

  // ---- Totems & auras -------------------------------------------------------

  /** Place a damaging totem owned by `owner`. */
  addTotem(
    at: Vec2,
    owner: number,
    opts: { radius: number; damageSpec: string; slow: number; ttl?: number; lifesteal?: boolean }
  ): Totem {
    const totem: Totem = {
      id: this.nextId++,
      x: Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, at.x)),
      y: Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, at.y)),
      radius: opts.radius,
      owner,
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
      const owner = this.mages.find((g) => g.team === t.owner) ?? m;
      const ctx = this.effectContext(owner, m, null);
      const amount = this.rng.roll(t.damageSpec).total;
      const dealt = dealDamage(ctx, m, dmg(amount, 'corrosive', 'physical'), { canMiss: false });
      if (t.lifesteal && dealt > 0 && owner !== m && owner.alive) heal(ctx, owner, dealt);
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

  /** Spawn `count` scarabs scattered around `center`, owned by team `owner`. */
  addScarabs(center: Vec2, owner: number, count: number): void {
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
        hp: SCARAB.hp,
        maxHp: SCARAB.hp,
        sanity: SCARAB.sanity,
        maxSanity: SCARAB.sanity,
        state: 'seeking',
        target: null,
      });
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
    const mine = this.scarabs.filter((s) => s.owner === owner.team && scarabAlive(s));
    if (mine.length === 0) return;
    const anchor = owner.pos;
    const enemies = this.mages.filter((g) => g.team !== owner.team && g.alive);

    // How many scarabs already hound each enemy (for the per-enemy cap).
    const load = new Map<Mage, number>();
    for (const s of mine) {
      if (s.target && (s.state === 'seeking' || s.state === 'attached')) {
        load.set(s.target, (load.get(s.target) ?? 0) + 1);
      }
    }

    for (const s of mine) {
      if (s.state === 'attached') {
        const tgt = s.target;
        if (tgt && tgt.alive) {
          // Stay latched onto the victim wherever they have moved to.
          s.x = tgt.x;
          s.y = tgt.y;
          const ctx = this.effectContext(owner, tgt, null);
          const amount = this.rng.roll(SCARAB.attackSpec).total;
          dealDamage(ctx, tgt, dmg(amount, 'corrosive', 'physical'), { canMiss: false });
          this.log(`A scarab bites ${tgt.name} for ${amount}.`);
        }
        if (s.target) load.set(s.target, (load.get(s.target) ?? 1) - 1);
        s.state = 'returning';
        s.target = null;
        this.creepScarab(s, anchor, SCARAB.moveStep, anchor);
        continue;
      }

      if (s.state === 'returning') {
        this.creepScarab(s, anchor, SCARAB.moveStep, anchor);
        if (dist({ x: s.x, y: s.y }, anchor) <= SCARAB.attachDist) {
          const ctx = this.effectContext(owner, owner, null);
          const healAmt = this.rng.roll(SCARAB.healSpec).total;
          heal(ctx, owner, healAmt);
          s.state = 'seeking';
        }
        continue;
      }

      // seeking
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
        // No room on any enemy — drift home and wait.
        this.creepScarab(s, anchor, SCARAB.moveStep, anchor);
        continue;
      }
      this.creepScarab(s, tgt.pos, SCARAB.moveStep, anchor);
      if (dist({ x: s.x, y: s.y }, tgt.pos) <= SCARAB.attachDist) {
        s.state = 'attached';
      }
    }
  }

  /** Damage enemy scarabs caught in an area effect; remove any destroyed. */
  damageScarabsInRadius(
    at: Vec2,
    radius: number,
    attackerTeam: number,
    amount: number,
    sanity: boolean
  ): void {
    if (amount <= 0 || this.scarabs.length === 0) return;
    for (const s of this.scarabs) {
      if (s.owner === attackerTeam) continue;
      if (dist({ x: s.x, y: s.y }, at) > radius + SCARAB.radius) continue;
      if (sanity) s.sanity = Math.max(0, s.sanity - amount);
      else s.hp = Math.max(0, s.hp - amount);
    }
    const before = this.scarabs.length;
    this.scarabs = this.scarabs.filter(scarabAlive);
    const removed = before - this.scarabs.length;
    if (removed > 0) {
      this.log(`${removed} scarab${removed > 1 ? 's are' : ' is'} crushed.`);
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
        dealDamage(ctx, victim, dmg(amount, s.type, s.damageClass), { canMiss: false });
      }
    }
  }

  /**
   * Apply per-turn DoT damage to `m`. Lives here (not on Mage) because some DoTs
   * are conditional on board state — e.g. range bands measured to the opponent,
   * or a chance to stun on each tick.
   */
  private applyDotDamage(m: Mage): void {
    if (!m.alive) return;
    const opponent = this.opponentOf(m);
    const dots = m.statuses.filter((s) => s.kind === 'dot') as DotStatus[];
    for (const s of dots) {
      if (s.band) {
        const d = opponent ? dist(opponent.pos, m.pos) : Infinity;
        if (d < s.band.min || d > s.band.max) {
          this.log(`${s.name} lies dormant — ${m.name} is out of its reach.`);
          continue;
        }
      }
      const amount = s.damageSpec
        ? Math.max(0, this.rng.roll(s.damageSpec).total)
        : Math.max(0, s.damage.amount);
      if (s.damage.damageClass === 'sanity') m.sanity = Math.max(0, m.sanity - amount);
      else m.hp = Math.max(0, m.hp - amount);
      if (amount > 0) this.vfxSink?.hit?.(m);
      this.log(`${m.name} suffers ${amount} ${s.damage.type} from ${s.name}.`);
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
    if (!trail) return;
    this.addShadow({ x: m.pos.x, y: m.pos.y }, trail.team, trail.perShadowTtl);
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
    const raw = { x: target.x + (dx / len) * reach, y: target.y + (dy / len) * reach };
    const fieldDest = {
      x: Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, raw.x)),
      y: Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, raw.y)),
    };
    const clamp = this.clampToBarriers(target.pos, fieldDest);
    const mut = this.clampToMutivargZones(target, target.pos, clamp.dest);
    const dest = this.clampToMages(target, target.pos, mut.dest);
    target.x = dest.x;
    target.y = dest.y;
    this.updateAttachedScarabs();
    this.dropTrailShadows(target);
    this.log(`${target.name} is knocked back!`);
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
    const fieldDest = {
      x: Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, picked.x)),
      y: Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, picked.y)),
    };
    const clamp = this.clampToBarriers(source.pos, fieldDest);
    const mut = this.clampToMutivargZones(source, source.pos, clamp.dest);
    const dest = this.clampToMages(source, source.pos, mut.dest);
    const step = Math.hypot(dest.x - source.x, dest.y - source.y);
    source.x = dest.x;
    source.y = dest.y;
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

  // ---- Area queries ---------------------------------------------------------

  /** Alive mages within `radius` of `center` (optionally excluding one). */
  magesInRadius(center: Vec2, radius: number, exclude?: Mage): Mage[] {
    return this.mages.filter((m) => m.alive && m !== exclude && dist(m.pos, center) <= radius);
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
      if (d === 0 || d > range) return false;
      const ang = Math.atan2(m.y - origin.y, m.x - origin.x);
      let diff = Math.abs(ang - base);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      return diff <= half;
    });
  }

  /**
   * Cannot be targeted right now. A true (full) veil can only be targeted from
   * within close range — pass `from` to apply that distance rule. A half veil
   * is always targetable (its protection is the dodge, resolved on the hit).
   */
  isUntargetable(m: Mage, from?: Mage): boolean {
    // Second Ring of Lareneg: untouchable to hostiles during turn cycles 3 & 4.
    if (from && from.team !== m.team && this.isLaranegUntouchable(m)) return true;
    const inv = m.getInvisibility();
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

  /**
   * Collapse half (partial) veils whose bearer now has an enemy standing within
   * point-blank range. Call this after any movement resolves.
   */
  breakProximityVeils(): void {
    for (const m of this.mages) {
      const inv = m.getInvisibility();
      if (!inv || inv.mode !== 'partial') continue;
      const enemyClose = this.mages.some(
        (e) =>
          e !== m &&
          e.team !== m.team &&
          e.alive &&
          dist(e.pos, m.pos) <= VEIL.half.breakProximity * RANGE_UNIT
      );
      if (enemyClose) {
        m.statuses = m.statuses.filter((s) => s.kind !== 'invisibility');
        this.log(`${m.name}'s veil collapses — an enemy is too close.`);
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
    const bashBase =
      MELEE_DAMAGE + basher.effectiveStr() + (basher.profile.blackPrimaryTier ? 1 : 0);
    const bashDmg = Math.max(0, Math.round(bashBase * bashMult));
    this.log(`${basher.name} smashes back with the shield!`);
    const back = this.effectContext(basher, attacker, null);
    dealDamage(back, attacker, dmg(bashDmg, 'shatter', 'physical'), { canMiss: false });
    return true;
  }

  /** Throw a consumable weapon (e.g. Throwing Dagger) at a target, consuming one. */
  throwItem(source: Mage, target: Mage, itemId: ItemId): void {
    const def = getItem(itemId);
    const spec = def.throwable;
    if (!spec) return;
    const i = source.utility.indexOf(itemId);
    if (i < 0) return;
    source.utility.splice(i, 1);
    const amount = this.rng.roll(spec.rollSpec).total;
    this.log(`${source.name} hurls ${def.name} at ${target.name}.`);
    const ctx = this.effectContext(source, target, null);
    dealDamage(ctx, target, dmg(amount, 'pierce', 'physical'), { canMiss: false });
  }

  /** Mantle of Eldritch Truth: resolve the chosen Eldritch action. */
  useEldritch(source: Mage, choice: 'attack' | 'defend' | 'restore', target: Mage | null): void {
    switch (choice) {
      case 'attack': {
        if (!target || !target.alive) return;
        this.log(`${source.name} unleashes eldritch truth upon ${target.name}!`);
        const ctx = this.effectContext(source, target, null);
        dealDamage(ctx, target, dmg(10, 'shatter', 'physical'), { canMiss: false, trueDamage: true });
        break;
      }
      case 'defend': {
        source.eldritchDefend = true;
        this.log(`${source.name} wreathes themselves in eldritch truth — all damage is void until their next turn.`);
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
      dealDamage(self, m, dmg(fire, 'fire', 'physical'), { canMiss: false });
      dealDamage(self, m, dmg(mill, 'shatter', 'sanity'), { canMiss: false });
      const blast = 10 * RANGE_UNIT;
      for (const other of this.mages) {
        if (other === m || !other.alive) continue;
        if (dist(other.pos, m.pos) > blast) continue;
        const ctx = this.effectContext(m, other, null);
        const light = this.rng.roll('1d6').total;
        dealDamage(ctx, other, dmg(light, 'light', 'physical'), { canMiss: false });
      }
    } else if (s >= 12) {
      const fire = this.rng.roll('1d6').total;
      const mill = this.rng.roll('1d3').total;
      this.log(`${m.name} smoulders under the blessing (${fire} fire, ${mill} mill).`);
      dealDamage(self, m, dmg(fire, 'fire', 'physical'), { canMiss: false });
      dealDamage(self, m, dmg(mill, 'shatter', 'sanity'), { canMiss: false });
    } else {
      const fire = this.rng.roll('1d3').total;
      this.log(`${m.name} glows with roaring thunder (${fire} fire).`);
      dealDamage(self, m, dmg(fire, 'fire', 'physical'), { canMiss: false });
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
      const heat = this.rng.roll('1d20').total;
      dealDamage(ctx, other, dmg(fire, 'fire', 'physical'), { canMiss: false });
      dealDamage(ctx, other, dmg(heat, 'heat', 'physical'), { canMiss: false });
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
    this.log(`${source.name} charges the storm — spends ${cost} mana and takes ${bite} true damage.`);
    dealDamage(self, source, dmg(bite, 'heat', 'physical'), { canMiss: false, trueDamage: true });
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

  /** Discharge (bonus): dump all stacks as a bouncing lightning chain from `primary`. */
  dischargeThunder(source: Mage, primary: Mage): void {
    if (!source.hasThunderBlessing()) return;
    const stacks = source.thunderStacks;
    if (stacks <= 0) {
      this.log(`${source.name} has no Thunder to discharge.`);
      return;
    }
    const schedule = this.thunderDischargeSchedule(stacks);
    this.log(`${source.name} discharges ${stacks} Thunder stacks in a chain of lightning!`);
    source.thunderStacks = 0;
    const struck = new Set<Mage>();
    let fromPos = source.pos;
    let preferred: Mage | null = primary;
    for (const hop of schedule) {
      let target: Mage | null = null;
      if (
        preferred &&
        preferred.alive &&
        !struck.has(preferred) &&
        dist(fromPos, preferred.pos) <= hop.rangePx
      ) {
        target = preferred;
      } else {
        const candidates = this.mages
          .filter((g) => g !== source && g.alive && !struck.has(g) && dist(fromPos, g.pos) <= hop.rangePx)
          .sort((a, b) => dist(fromPos, a.pos) - dist(fromPos, b.pos));
        target = candidates[0] ?? null;
      }
      if (!target) break;
      this.dealThunderBolt(source, target, stacks, hop.pct);
      struck.add(target);
      fromPos = target.pos;
      preferred = null;
    }
    // A 14-stack overcharge also arcs back into the caster (51%).
    if (stacks >= 14 && source.alive) this.dealThunderBolt(source, source, stacks, 0.51);
    this.checkThunderDeath(source);
  }

  /** One lightning bounce: (stacks)d3 x pct, split heat/light/typeless, armour-ignoring. */
  private dealThunderBolt(source: Mage, target: Mage, stacks: number, pct: number): void {
    const dice = this.rng.roll(`${stacks}d3`).total;
    const total = Math.ceil(dice * pct); // reduce dice by % but round favourably
    if (total <= 0) return;
    const ctx = this.effectContext(source, target, null);
    // 34% heat / 33% light / 32% magical-typeless — mechanically identical (all
    // unblocked by armour), so dealt as a single heat bolt for clarity.
    dealDamage(ctx, target, dmg(total, 'heat', 'physical'), { canMiss: false, ignoreArmor: true });
    this.log(`Lightning strikes ${target.name} for ${total} (${Math.round(pct * 100)}%).`);
  }

  // ---- Stack ----------------------------------------------------------------

  pushStack(item: StackItem): void {
    this.stack.push(item);
  }

  removeStackItem(id: number): void {
    const idx = this.stack.findIndex((i) => i.id === id);
    if (idx >= 0) this.stack.splice(idx, 1);
  }

  // ---- Targeting helpers ----------------------------------------------------

  private effectContext(
    source: Mage,
    target: Mage | null,
    targetPoint: Vec2 | null
  ): EffectContext {
    return {
      game: this,
      caster: source,
      target,
      targetPoint,
      rng: this.rng,
      log: (m) => this.log(m),
      vfx: this.vfxSink ?? null,
      requestPoint: this.subTargeter
        ? (opts) => this.subTargeter!.requestPoint(source, opts)
        : undefined,
      requestEnemy: this.subTargeter
        ? (opts) => this.subTargeter!.requestEnemy(source, opts)
        : undefined,
      reactionWindow: this.subTargeter
        ? (label, at) => this.subTargeter!.reactionWindow(source, label, at)
        : undefined,
    };
  }

  /** Is `target` a legal target for `spell` cast by `source` right now? */
  isValidSpellTarget(spell: Spell, source: Mage, target: Mage): boolean {
    if (!target.alive) return false;
    switch (spell.targeting) {
      case 'self':
        return target === source;
      case 'ally':
        return target === source;
      case 'any':
        // Castable on any living mage — yourself, an ally, or an enemy.
        return true;
      case 'enemy': {
        if (target === source) return false;
        if (this.isUntargetable(target, source)) return false;
        let range = spell.range;
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

  canMelee(source: Mage, target: Mage): boolean {
    if (source.hasForgotten('melee')) return false;
    if (target === source || !target.alive || this.isUntargetable(target, source)) return false;
    const weapon = source.activeWeapon();
    // A Needle of Serenity can permanently disable the unarmed strike itself.
    if (!weapon && source.unarmedBanned) return false;
    // Bows need ammunition to fire.
    if (weapon?.usesArrows && source.arrows <= 0) return false;
    // A crossbow that has just fired cannot shoot again until it reloads.
    if (weapon?.toHit && source.reloadTurns > 0) return false;
    const reach = weapon ? weapon.rangePx : MELEE_RANGE;
    const min = weapon?.minRangePx ?? 0;
    const d = dist(source.pos, target.pos);
    return d <= reach && d >= min;
  }

  // ---- Dropped items --------------------------------------------------------

  /** Drop a held item onto the ground at the mage's feet. */
  dropItem(source: Mage, itemId: ItemId): boolean {
    const i = source.hands.indexOf(itemId);
    if (i < 0) return false;
    // The Greatshield is bound while in sword form — it cannot be dropped.
    if (itemId === 'bastionSword' && !source.bastionShieldForm) {
      this.log(`${source.name}'s greatshield is bound in sword form — it cannot be dropped.`);
      return false;
    }
    source.hands.splice(i, 1);
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
      dist(source.pos, { x: drop.x, y: drop.y }) > PICKUP_RANGE
    ) {
      return false;
    }
    this.droppedItems.splice(idx, 1);
    source.hands.push(drop.itemId);
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
    };
    this.barriers.push(zone);
    return zone;
  }

  /** Age every barrier by one round, removing any that have collapsed. */
  tickBarriers(): void {
    for (const b of this.barriers) b.ttl -= 1;
    const gone = this.barriers.filter((b) => b.ttl <= 0);
    if (gone.length) this.log(`${gone.length} reality break${gone.length > 1 ? 's' : ''} mend.`);
    this.barriers = this.barriers.filter((b) => b.ttl > 0);
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
   */
  clampToBarriers(from: Vec2, to: Vec2): { dest: Vec2; blocked: boolean } {
    if (this.barriers.length === 0) return { dest: to, blocked: false };
    const total = dist(from, to);
    if (total < 1) return { dest: to, blocked: false };
    const steps = Math.max(2, Math.ceil(total / 8));
    let last: Vec2 = { ...from };
    for (let i = 1; i <= steps; i++) {
      const p = stepTowards(from, to, (total * i) / steps);
      if (this.isInBarrier(p)) return { dest: last, blocked: true };
      last = p;
    }
    return { dest: to, blocked: false };
  }

  /**
   * Clamp a movement so the mover stops just outside any other mage's body.
   * You can end your move directly next to an opponent, but never run through
   * or stand on top of them.
   */
  clampToMages(source: Mage, from: Vec2, to: Vec2): Vec2 {
    const minDist = MAGE_BODY_RADIUS * 2;
    const others = this.mages.filter((m) => m !== source && m.alive);
    if (others.length === 0) return to;
    const total = dist(from, to);
    if (total < 1) return to;
    const steps = Math.max(2, Math.ceil(total / 6));
    let last: Vec2 = { ...from };
    for (let i = 1; i <= steps; i++) {
      const p = stepTowards(from, to, (total * i) / steps);
      if (others.some((m) => dist(p, m.pos) < minDist)) return last;
      last = p;
    }
    return to;
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
          dealDamage(ctx, m, dmg(total, 'shatter', 'physical'), { canMiss: false, aoe: true });
        } else {
          dealDamage(ctx, m, dmg(total, 'corrosive', 'physical'), {
            canMiss: false,
            aoe: true,
            ignoreResist: true,
          });
        }
      }
      // Slow past 100% — the field pins them in place this turn.
      addOrExtendStatus(
        m.statuses,
        { key: 'stun:movement', name: 'Crushing Field', kind: 'stun', duration: 2, stunType: 'movement' },
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
      this.log(`${source.name} channels the rod, but only ${paid} mana answers — the field fizzles.`);
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
        if (!mage.head) mage.head = id;
        else mage.bag.push(id);
        break;
      case 'torso':
        if (!mage.torso) mage.torso = id;
        else mage.bag.push(id);
        break;
      case 'boots':
        if (!mage.boots) mage.boots = id;
        else mage.bag.push(id);
        break;
      case 'accessory':
        if (mage.accessories.length < SLOT_CAPS.accessory) mage.accessories.push(id);
        else mage.bag.push(id);
        break;
      case 'utility':
        if (def.ammo) mage.arrows += 1;
        else mage.utility.push(id);
        break;
    }
    this.applyGrantedVitals(mage, def);
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
    } else if (pull(mage.hands) || pull(mage.bag) || pull(mage.accessories) || pull(mage.utility)) {
      removed = true;
    } else if (mage.head === id) {
      mage.head = null;
      removed = true;
    } else if (mage.torso === id) {
      mage.torso = null;
      removed = true;
    } else if (mage.boots === id) {
      mage.boots = null;
      removed = true;
    }
    if (removed) this.reverseGrantedVitals(mage, def);
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
    this.totems = [];
    this.scarabs = [];
    this.barriers = [];
    this.globalEscalations = [];
    this.droppedItems = [];
    this.mutivargZones = [];
    this.extraTurnQueue = [];
    this.stack = [];
    this.mindSwapTurns = 0;
    this.pendingMindSwap = 0;
  }

  // ---- Stack item factories -------------------------------------------------

  /**
   * Move `source` to `dest`, clamped by the field edge, reality-break barriers,
   * Mutivarg zones and the other body. Used by the Leap bonus action.
   */
  leapMove(source: Mage, dest: Vec2): void {
    const fieldDest = {
      x: Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, dest.x)),
      y: Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, dest.y)),
    };
    const clamp = this.clampToBarriers(source.pos, fieldDest);
    const mut = this.clampToMutivargZones(source, source.pos, clamp.dest);
    const final = this.clampToMages(source, source.pos, mut.dest);
    source.x = final.x;
    source.y = final.y;
    source.movedThisTurn = true;
    this.updateAttachedScarabs();
    this.dropTrailShadows(source);
  }

  /**
   * Resolve the Cleave main action: a 180° sweep at melee reach that deals
   * double a normal strength swing's damage to every enemy caught in the arc.
   */
  resolveCleave(source: Mage, aim: Vec2): void {
    const w = source.activeWeapon();
    const reach = w ? w.rangePx : MELEE_RANGE;
    const base =
      MELEE_DAMAGE +
      source.effectiveStr() +
      (source.profile.blackPrimaryTier ? 1 : 0) +
      source.meleeDamageBonus();
    const perHit = Math.round(base * (w?.multiplier ?? 1)) * 2;
    const type: DamageType = w?.damageType ?? 'shatter';
    const targets = this.magesInCone(source.pos, aim, reach, CLEAVE_DEGREES, source).filter(
      (m) => m.team !== source.team
    );
    if (targets.length === 0) {
      this.log(`${source.name} cleaves the air — nothing in reach.`);
      return;
    }
    for (const t of targets) {
      const ctx = this.effectContext(source, t, null);
      dealDamage(ctx, t, dmg(perHit, type, 'physical'), {
        ignoreResist: !!w?.ignoreResist,
        ignoreArmor: !!w?.ignoreArmor,
      });
    }
    this.log(
      `${source.name} cleaves ${targets.length} foe${targets.length > 1 ? 's' : ''} for ${perHit} each!`
    );
  }

  makeMoveItem(source: Mage, destination: Vec2): StackItem {
    const fieldDest = {
      x: Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, destination.x)),
      y: Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, destination.y)),
    };
    // A reality-break barrier halts a runner at its edge and roots them.
    const clamp = this.clampToBarriers(source.pos, fieldDest);
    // A Mutivarg crushing field is a wall — you cannot dash through it.
    const mut = this.clampToMutivargZones(source, source.pos, clamp.dest);
    // Stop short of running into the other mage's body.
    const dest = this.clampToMages(source, source.pos, mut.dest);
    return {
      id: this.nextId++,
      kind: 'move',
      source,
      label: 'Move',
      description: `${source.name} moves.`,
      targetPoint: dest,
      isStillValid: () => source.alive,
      resolve: (game) => {
        const step = Math.hypot(dest.x - source.x, dest.y - source.y);
        source.x = dest.x;
        source.y = dest.y;
        source.movedThisTurn = true;
        source.distMovedThisTurn += step;
        game.updateAttachedScarabs();
        game.log(`${source.name} repositions.`);
        if (clamp.blocked) {
          const ttl = Math.max(1, game.barrierTtlAt({ x: dest.x, y: dest.y }) + 1);
          addOrExtendStatus(
            source.statuses,
            { key: 'stun:movement', name: 'Stuck', kind: 'stun', duration: ttl, stunType: 'movement' },
            false
          );
          game.log(`${source.name} is caught in the reality break and cannot move!`);
        }
      },
    };
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
    needleBan?: NeedleBan;
    isStillValid?: (game: GameState) => boolean;
    resolve: (game: GameState) => void | Promise<void>;
  }): StackItem {
    return {
      id: this.nextId++,
      kind: 'action',
      source: opts.source,
      label: opts.label,
      description: opts.description ?? opts.label,
      needleBan: opts.needleBan,
      isStillValid: opts.isStillValid ?? (() => opts.source.alive),
      resolve: opts.resolve,
    };
  }

  makeMeleeItem(source: Mage, target: Mage): StackItem {
    const weapon = source.activeWeapon();
    const label =
      weapon?.toHit || weapon?.oneShotSpec
        ? 'Shot'
        : weapon?.kind === 'dex'
          ? 'Shot'
          : 'Melee';
    return {
      id: this.nextId++,
      kind: 'melee',
      source,
      target,
      label,
      description: `${source.name} attacks ${target.name}.`,
      isStillValid: (game) => game.canMelee(source, target),
      resolve: async (game) => {
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
          const roll = game.rng.roll('1d20').total;
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
              const roll = game.rng.roll('1d20').total;
              rolls.push(roll);
              total += Math.max(0, Math.floor((roll + dex + bonus - 10) / 2));
            }
          }
          // Assassin's Cloak: Dex strikes hit harder while veiled.
          if (!missed && source.isInvisible() && source.veiledDaggerBonus() > 0) {
            total = Math.round(total * (1 + source.veiledDaggerBonus()));
          }
          amount = total;
          if (missed) {
            game.log(`${source.name}'s shot sails wide.`);
          } else {
            game.log(`${source.name} attacks (d20 ${rolls.join('+')} + dex ${dex} + ${bonus}).`);
          }
          // Bows consume one arrow per shot (hit or miss).
          if (w.usesArrows) {
            source.arrows = Math.max(0, source.arrows - 1);
            game.log(`${source.name} looses an arrow (${source.arrows} left).`);
          }
        } else {
          // Strength swing: (base melee + Strength + gloves) scaled by the weapon.
          const base =
            MELEE_DAMAGE +
            source.effectiveStr() +
            (source.profile.blackPrimaryTier ? 1 : 0) +
            source.meleeDamageBonus();
          amount = Math.round(base * (w?.multiplier ?? 1));
          type = w?.damageType ?? 'shatter';
          if (w?.critChance && game.rng.chance(w.critChance)) {
            amount *= 2;
            game.log(`${source.name} lands a critical hit!`);
          }
        }
        // Tantrum Gloves: a stored fizzle supercharges this strike.
        if (source.rageBonus > 0) {
          amount = Math.round(amount * (1 + source.rageBonus));
          game.log(`${source.name} swings in a fury (+${Math.round(source.rageBonus * 100)}%).`);
          source.rageBonus = 0;
        }
        const dealt =
          amount > 0
            ? dealDamage(ctx, target, dmg(amount, type, 'physical'), {
                ignoreResist: !!w?.ignoreResist,
                ignoreArmor: !!w?.ignoreArmor,
              })
            : 0;
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
          dealDamage(back, source, dmg(thorns, 'pierce', 'physical'), { canMiss: false });
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
    respondingTo?: number
  ): StackItem {
    const targetName = target ? ` → ${target.name}` : '';
    return {
      id: this.nextId++,
      kind: 'spell',
      source,
      spell,
      target: target ?? undefined,
      targetPoint: targetPoint ?? undefined,
      respondingTo,
      counters: spell.counters,
      label: spell.name,
      description: `${source.name} casts ${spell.name}${targetName}. ${spell.description}`,
      isStillValid: (game) => {
        if (!source.alive) return false;
        if (spell.targeting === 'enemy' || spell.targeting === 'ally') {
          return !!target && game.isValidSpellTarget(spell, source, target);
        }
        return true;
      },
      resolve: (game) => {
        const ctx = game.effectContext(source, target, targetPoint);
        // Mark the caster so spell damage can grant Blood Charm lifesteal and
        // arm a single Greed gain for this cast (Gambler's Blade dedup).
        source.spellcastActive = true;
        source.greedArmed = true;
        const done = () => {
          source.spellcastActive = false;
        };
        const result = spell.cast(ctx);
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
