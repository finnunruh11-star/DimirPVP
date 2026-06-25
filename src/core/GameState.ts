import { Dice } from './Dice';
import { Mage } from './Mage';
import type { StackItem } from './Stack';
import type { Spell } from '../spells/Spell';
import type { EffectContext, VfxSink, SubTargeter } from '../effects/effects';
import { dealDamage, heal } from '../effects/effects';
import { dmg } from './Damage';
import type { DamageType, DamageClass } from './Damage';
import { dist, stepTowards, type Vec2 } from './utils';
import {
  CONE_DEGREES,
  FIELD,
  MAGE_BODY_RADIUS,
  MELEE_DAMAGE,
  MELEE_RANGE,
  MOVE_RANGE,
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

/**
 * The pure (Phaser-free) game model: two mages, whose turn it is, the round
 * counter, the reaction stack, dice and a rolling log. The Phaser scene drives
 * the flow (prompts, animation) and calls into this for all rules.
 */
export class GameState {
  mages: [Mage, Mage];
  currentIndex: 0 | 1 = 0;
  round = 1;
  stack: StackItem[] = [];
  rng: Dice;

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

  /** Alive summon (scarab) count per team at last regen, to score deaths since. */
  private prevScarabAlive: Record<1 | 2, number> = { 1: 0, 2: 0 };

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

  constructor(mages: [Mage, Mage], seed?: number) {
    this.mages = mages;
    this.rng = new Dice(seed);
  }

  // ---- Accessors ------------------------------------------------------------

  get current(): Mage {
    return this.mages[this.currentIndex];
  }

  get other(): Mage {
    return this.mages[this.currentIndex === 0 ? 1 : 0];
  }

  opponentOf(m: Mage): Mage {
    return this.mages[0] === m ? this.mages[1] : this.mages[0];
  }

  log(msg: string): void {
    this.logLines.push(msg);
    if (this.logLines.length > 200) this.logLines.shift();
    this.onLog?.(msg);
  }

  get winner(): Mage | null {
    const [a, b] = this.mages;
    if (!a.alive && !b.alive) return null;
    if (!a.alive) return b;
    if (!b.alive) return a;
    return null;
  }

  get isOver(): boolean {
    return !this.mages[0].alive || !this.mages[1].alive;
  }

  // ---- Turn lifecycle -------------------------------------------------------

  /** Reset reactions for both mages at the start of a new round. */
  startRound(): void {
    for (const m of this.mages) {
      m.reactionAvailable = m.canEverReact;
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
    this.currentIndex = this.currentIndex === 0 ? 1 : 0;
    if (this.currentIndex === 0) {
      this.round += 1;
      this.tickShadows();
      this.tickTotems();
      this.tickBarriers();
      this.tickGlobalEscalations();
      this.startRound();
    }
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
    this.currentIndex = this.mages[0] === m ? 0 : 1;
  }

  // ---- Shadows --------------------------------------------------------------

  /** Place a shadow zone (clamped to the field) owned by `owner`. */
  addShadow(at: Vec2, owner: 1 | 2, ttl?: number): ShadowZone {
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

  shadowsOf(team: 1 | 2): ShadowZone[] {
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
    owner: 1 | 2,
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
  addScarabs(center: Vec2, owner: 1 | 2, count: number): void {
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
    attackerTeam: 1 | 2,
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
  private applyControlOnTurnStart(m: Mage): void {
    const ctrl = m.statuses.find((s) => s.kind === 'control') as ControlStatus | undefined;
    if (ctrl && ctrl.mode === 'expose') {
      // Their intentions are laid bare — they cannot hold a reaction this turn.
      m.reactionAvailable = false;
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
    const inv = m.getInvisibility();
    if (inv?.mode === 'full') {
      if (!from) return true;
      return dist(from.pos, m.pos) > VEIL.full.targetableDist * RANGE_UNIT;
    }
    if (m.statuses.some((s) => s.kind === 'shadowVeil') && this.isInShadow(m)) return true;
    return false;
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
    return (
      target !== source &&
      target.alive &&
      !this.isUntargetable(target, source) &&
      dist(source.pos, target.pos) <= MELEE_RANGE
    );
  }

  // ---- Reality-break barriers ----------------------------------------------

  /** Place a wedge barrier owned by `owner`. */
  addBarrier(
    apex: Vec2,
    angle: number,
    opts: { halfAngle: number; range: number; owner: 1 | 2; ttl: number }
  ): BarrierZone {
    const zone: BarrierZone = {
      id: this.nextId++,
      x: apex.x,
      y: apex.y,
      angle,
      halfAngle: opts.halfAngle,
      range: opts.range,
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

  // ---- Stack item factories -------------------------------------------------

  makeMoveItem(source: Mage, destination: Vec2): StackItem {
    const fieldDest = {
      x: Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, destination.x)),
      y: Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, destination.y)),
    };
    // A reality-break barrier halts a runner at its edge and roots them.
    const clamp = this.clampToBarriers(source.pos, fieldDest);
    // Stop short of running into the other mage's body.
    const dest = this.clampToMages(source, source.pos, clamp.dest);
    return {
      id: this.nextId++,
      kind: 'move',
      source,
      label: 'Move',
      description: `${source.name} moves.`,
      targetPoint: dest,
      isStillValid: () => source.alive,
      resolve: (game) => {
        source.x = dest.x;
        source.y = dest.y;
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

  makeMeleeItem(source: Mage, target: Mage): StackItem {
    return {
      id: this.nextId++,
      kind: 'melee',
      source,
      target,
      label: 'Melee',
      description: `${source.name} strikes ${target.name} in melee.`,
      isStillValid: (game) => game.canMelee(source, target),
      resolve: (game) => {
        const ctx = game.effectContext(source, target, null);
        // Black primary tier sharpens every melee blow.
        const bonus = source.profile.blackPrimaryTier ? 1 : 0;
        dealDamage(ctx, target, dmg(MELEE_DAMAGE + bonus, 'shatter', 'physical'));
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
        return spell.cast(ctx);
      },
    };
  }

  /** Convenience for spell metadata lookups. */
  wordLabel(id: keyof typeof WORDS): string {
    return WORDS[id].label;
  }
}
