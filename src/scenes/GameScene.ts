import Phaser from 'phaser';
import {
  ACTIONS_PER_TURN,
  COLORS,
  FIELD,
  GAME_HEIGHT,
  GAME_WIDTH,
  MAX_SPELL_WORDS,
  MELEE_RANGE,
  SCARAB,
  TEXT,
} from '../config/constants';
import { GameState } from '../core/GameState';
import { Mage } from '../core/Mage';
import scarabGifUrl from '../Sprites/Scarab.gif';
import type { ScarabState } from '../core/Scarab';
import { Dev, type DevToggle } from '../config/dev';
import { WORDS, type WordId } from '../core/Words';
import { wordSpellMana } from '../core/Colors';
import { getColorAbilitiesFor, type ColorAbility } from '../spells/colorAbilities';
import type { StackItem } from '../core/Stack';
import type { ShadowZone } from '../core/Shadow';
import type { Spell, SpellVisual } from '../spells/Spell';
import { allSpells, getSpell, reactionSpellsFor } from '../spells/registry';
import { dist, stepTowards, type Vec2 } from '../core/utils';
import type { SubTargetPointOpts, SubTargetEnemyOpts } from '../effects/effects';
import { SimpleAI, type AIDecision } from '../ai/SimpleAI';
import type { MatchConfig } from './MenuScene';

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
  | 'aiming-move'
  | 'subtarget-point'
  | 'subtarget-enemy'
  | 'busy'
  | 'reaction'
  | 'over';

interface DiceRoll {
  spec: string;
  total: number;
  rolls: number[];
  label?: string;
}

const MAGE_RADIUS = 22;
const HUD_Y = FIELD.y + FIELD.h + 18;

export class GameScene extends Phaser.Scene {
  private gs!: GameState;
  private ais = new Map<Mage, SimpleAI>();

  private mode: InputMode = 'idle';
  private busy = false;

  // Human spell-building state (indices into the current mage's loadout).
  private selectedIdx: number[] = [];
  private pendingSpell: Spell | null = null;
  /** The color ability currently being aimed (paid for differently than spells). */
  private pendingAbility: ColorAbility | null = null;

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
  private dicePanel!: Phaser.GameObjects.Container;
  private turnText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private logText!: Phaser.GameObjects.Text;
  private actionText!: Phaser.GameObjects.Text;
  private resourceText!: Phaser.GameObjects.Text;
  private wordTexts: Phaser.GameObjects.Text[] = [];
  private tooltip!: Phaser.GameObjects.Text;
  private bannerText!: Phaser.GameObjects.Text;

  // Dev / testing cheat panel.
  private devPanel!: Phaser.GameObjects.Container;
  private devToggles: { key: DevToggle; label: string; hot: string; text: Phaser.GameObjects.Text }[] = [];
  private devClickGuard = false;

  // Reaction prompt.
  private reactor: Mage | null = null;
  private reactionResolve: ((value: ReactionChoice | null) => void) | null = null;

  // Stack token hit areas for hover.
  private stackTokens: { x: number; y: number; r: number; item: StackItem }[] = [];

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
  }

  create(config: MatchConfig): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);

    const m1 = new Mage({
      name: 'Player 1',
      isAI: false,
      team: 1,
      position: { x: FIELD.x + 180, y: FIELD.y + FIELD.h / 2 },
      loadout: config.loadouts[0],
    });
    const m2 = new Mage({
      name: config.mode === 'ai' ? 'AI' : 'Player 2',
      isAI: config.mode === 'ai',
      team: 2,
      position: { x: FIELD.x + FIELD.w - 180, y: FIELD.y + FIELD.h / 2 },
      loadout: config.loadouts[1],
    });

    this.gs = new GameState([m1, m2]);
    this.gs.onLog = () => this.drawLog();
    this.gs.vfxSink = {
      diceRoll: (spec, total, rolls, label) => this.pendingDice.push({ spec, total, rolls, label }),
      hit: (m) => this.playHit(m),
      dash: (mover, from) => this.animateDash(mover, from),
    };
    this.gs.subTargeter = {
      requestPoint: (source, opts) => this.requestSubtargetPoint(source, opts),
      requestEnemy: (source, opts) => this.requestSubtargetEnemy(source, opts),
    };
    for (const m of this.gs.mages) if (m.isAI) this.ais.set(m, new SimpleAI(this.gs, m));

    this.buildMageAnimations();
    this.buildStaticGraphics();
    this.buildHud();
    this.buildDicePanel();

    // Decode the scarab gif into animation frames (async, non-blocking).
    void this.loadScarabFrames();

    this.bindInput();

    this.gs.startRound();
    this.startTurn();
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
      this.nextTurn();
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
    this.nextTurn();
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
      if (me.actions.main <= 0 || !la.target || !this.gs.canMelee(me, la.target)) return null;
      me.spend('main');
      return this.gs.makeMeleeItem(me, la.target);
    }
    // spell
    if (!la.spellId) return null;
    const spell = allSpells().find((s) => s.id === la.spellId);
    if (!spell) return null;
    if (!me.hasCharges(spell.words)) return null;
    if (spell.actionType === 'main' ? me.actions.main <= 0 : me.actions.bonus <= 0) return null;
    const target = spell.targeting === 'self' ? me : la.target ?? null;
    if ((spell.targeting === 'enemy' || spell.targeting === 'ally') && (!target || !this.gs.isValidSpellTarget(spell, me, target))) {
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


  private nextTurn(): void {
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
    // Dev: a passive AI simply forfeits its turn.
    if (Dev.aiPassive) {
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
        me.spend('main');
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

    const passed = new Set<number>();
    while (this.gs.stack.length > 0) {
      const top = this.gs.stack[this.gs.stack.length - 1];
      const reactor = this.gs.opponentOf(top.source);

      if (!passed.has(top.id) && this.reactorCanRespond(reactor, top)) {
        const choice = await this.getReaction(reactor, top);
        if (choice) {
          if (this.isColorAbility(choice.spell)) {
            this.payForColorAbility(reactor, choice.spell);
          } else {
            this.payForSpell(reactor, choice.spell);
          }
          reactor.reactionAvailable = false;
          reactor.reactionUsedRecently = true;
          const item = this.gs.makeSpellItem(
            reactor,
            choice.spell,
            choice.target ?? null,
            choice.point ?? null,
            top.id
          );
          this.gs.pushStack(item);
          this.redraw();
          this.setCharging(reactor, true);
          await this.delay(250);
          continue;
        }
        passed.add(top.id);
      }

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

    this.busy = false;
    this.mode = this.gs.isOver ? 'over' : prevMode === 'busy' ? 'busy' : 'idle';
    if (!this.controllerIsAI(this.gs.current) && !this.gs.isOver) this.mode = 'idle';
    this.redraw();
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
    // Blue primary tier sharpens every word-spell, lowering its difficulty.
    const dc = (spell.dc ?? 0) - (source.profile.bluePrimaryTier ? 2 : 0);
    const r = this.gs.rng.roll('1d20');
    this.pendingDice.push({
      spec: '1d20',
      total: r.total,
      rolls: r.rolls,
      label: `${spell.name} — success?`,
    });
    const ok = Dev.autoSuccess || r.total >= dc;
    this.gs.log(
      `${source.name}'s ${spell.name}: 1d20=${r.total} vs DC ${dc} — ${ok ? 'success!' : 'fizzles.'}`
    );
    return ok;
  }

  /** Reaction spells the reactor could actually cast right now (charges + valid target). */
  private castableReactions(reactor: Mage): Spell[] {
    const forgotten = reactor.forgotten();
    // Blue primary tier lets a mage respond with ANY of its word-spells, not
    // just reaction-flagged ones; otherwise use the normal reaction set.
    const pool = reactor.profile.bluePrimaryTier
      ? allSpells().filter((s) => s.words.every((w) => reactor.loadout.includes(w)))
      : reactionSpellsFor(reactor.loadout);
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
    return getColorAbilitiesFor(reactor.profile.primary).filter((ab) =>
      this.canAffordAbility(reactor, ab)
    );
  }

  private reactorCanRespond(reactor: Mage, top: StackItem): boolean {
    if (reactor === top.source) return false;
    if (!reactor.hasReaction()) return false;
    return (
      this.castableReactions(reactor).length > 0 || this.castableAbilities(reactor).length > 0
    );
  }

  private getReaction(reactor: Mage, top: StackItem): Promise<ReactionChoice | null> {
    if (this.controllerIsAI(reactor)) {
      // Dev: a passive AI never reacts.
      if (Dev.aiPassive) return Promise.resolve(null);
      const ai = this.aiFor(reactor);
      const r = ai.chooseReaction(true) ?? null;
      return Promise.resolve(r ? { spell: r.spell, target: r.target, point: r.point } : null);
    }
    return this.promptReaction(reactor, top);
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
    kb.on('keydown-SPACE', () => {
      if (this.mode === 'reaction') this.onReactionPass();
    });
    kb.on('keydown-ESC', () => this.cancelAiming());

    // Dev cheat toggles (also clickable on the on-field panel).
    kb.addCapture('F1,F2,F3,F4,BACKTICK');
    kb.on('keydown-F1', () => this.toggleDev('autoSuccess'));
    kb.on('keydown-F2', () => this.toggleDev('infiniteMove'));
    kb.on('keydown-F3', () => this.toggleDev('infiniteActions'));
    kb.on('keydown-F4', () => this.toggleDev('aiPassive'));
    kb.on('keydown-BACKTICK', () => this.devPanel.setVisible(!this.devPanel.visible));

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

  private onWordKey(i: number): void {
    if (!this.humanActive) return;
    if (i >= this.actor.loadout.length) return;
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
    return this.selectedIdx.map((i) => this.actor.loadout[i]);
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

    if (me.hasCastThisTurn && !Dev.infiniteActions && this.gs.controlOf(me)?.mode !== 'random') {
      this.flashHint('Only one spell per turn.');
      return;
    }

    // A scrambled mage (Mind Curse) cannot choose: a random spell fires.
    if (this.gs.controlOf(me)?.mode === 'random') {
      const sub = this.randomCastFor(me);
      if (!sub) {
        this.flashHint('Scrambled — no spell can be cast right now.');
        return;
      }
      this.gs.log(`${me.name} is scrambled — ${sub.spell.name} erupts instead!`);
      this.payForSpell(me, sub.spell);
      this.resetSelection();
      this.runStack(this.gs.makeSpellItem(me, sub.spell, sub.target, sub.point));
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
      this.payForSpell(me, spell);
      const item = this.gs.makeSpellItem(me, spell, spell.targeting === 'self' ? me : null, null);
      this.resetSelection();
      this.runStack(item);
      return;
    }
    if (spell.targeting === 'point') {
      this.pendingSpell = spell;
      this.mode = 'aiming-point';
      this.flashHint('Click a destination within range.');
      this.redraw();
      return;
    }
    // enemy / ally
    this.pendingSpell = spell;
    this.mode = 'aiming-spell';
    this.flashHint('Click a valid target.');
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
    this.flashHint('Click where to move (within range).');
    this.redraw();
  }

  private beginMelee(): void {
    if (this.mode === 'reaction') return;
    if (!this.humanActive) return;
    if (this.gs.current.hasForgotten('melee'))
      return this.flashHint('You have forgotten how to fight this turn.');
    if (this.gs.current.actions.main <= 0) return this.flashHint('Melee needs a main action.');
    this.pendingSpell = null;
    this.mode = 'aiming-melee';
    this.flashHint('Click an enemy in melee range.');
    this.redraw();
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
    this.nextTurn();
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    // A click consumed by the dev cheat panel must not also act on the field.
    if (this.devClickGuard) {
      this.devClickGuard = false;
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
      me.spend('move');
      this.mode = 'idle';
      this.runStack(this.gs.makeMoveItem(me, dest));
      return;
    }
    if (this.mode === 'aiming-melee') {
      const target = this.clickedMage(pt, me);
      if (target && this.gs.canMelee(me, target)) {
        me.spend('main');
        this.mode = 'idle';
        this.runStack(this.gs.makeMeleeItem(me, target));
      } else {
        this.flashHint('No enemy in melee range there.');
      }
      return;
    }
    if (this.mode === 'aiming-spell') {
      // Reaction target selection takes priority when active.
      if (this.reactionAiming && this.reactionPendingSpell) {
        const src = this.aimingSource!;
        const spell = this.reactionPendingSpell;
        const target = this.clickedMage(pt, src);
        if (target && this.gs.isValidSpellTarget(spell, src, target)) {
          this.finishReactionAim({ spell, target });
        } else {
          this.flashHint('Invalid target (out of range / unseen).');
        }
        return;
      }
      const spell = this.pendingSpell;
      if (!spell) return;
      const target = this.clickedMage(pt, me);
      if (target && this.gs.isValidSpellTarget(spell, me, target)) {
        if (this.pendingAbility) {
          this.payForColorAbility(me, this.pendingAbility);
        } else {
          this.payForSpell(me, spell);
        }
        this.mode = 'idle';
        this.pendingSpell = null;
        this.pendingAbility = null;
        const item = this.gs.makeSpellItem(me, spell, target, null);
        this.resetSelection();
        this.runStack(item);
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
      if (this.pendingAbility) {
        this.payForColorAbility(me, this.pendingAbility);
      } else {
        this.payForSpell(me, spell);
      }
      this.mode = 'idle';
      this.pendingSpell = null;
      this.pendingAbility = null;
      const item = this.gs.makeSpellItem(me, spell, null, capped);
      this.resetSelection();
      this.runStack(item);
      return;
    }
  }

  private clickedMage(pt: Vec2, exclude: Mage): Mage | null {
    for (const m of this.gs.mages) {
      if (m === exclude) continue;
      if (dist(pt, m.pos) <= MAGE_RADIUS + 14) return m;
    }
    return null;
  }

  private payForSpell(mage: Mage, spell: Spell): void {
    mage.spendCharges(spell.words);
    mage.spendMana(wordSpellMana(spell.words, mage.profile));
    mage.hasCastThisTurn = true;
    mage.spend(spell.actionType === 'main' ? 'main' : 'bonus');
  }

  // ===========================================================================
  //  COLOR ABILITIES (bonus-action powers granted by your primary color)
  // ===========================================================================

  /** Effective color-charge cost after the blue-secondary discount. */
  private abilityChargeCost(me: Mage, ability: ColorAbility): number {
    return Math.max(0, ability.chargeCost - (me.profile.blueSecondaryTier ? 1 : 0));
  }

  /** Whether `me` can pay for `ability` (color-charges, optional life, mana). */
  private canAffordAbility(me: Mage, ability: ColorAbility): boolean {
    if (Dev.infiniteActions) return true;
    if (!me.hasMana(ability.manaCost)) return false;
    const charge = this.abilityChargeCost(me, ability);
    if (me.colorCharges >= charge) return true;
    // Black secondary may substitute up to 2 missing charges with 5% life each.
    if (me.profile.blackSecondaryTier) {
      return charge - me.colorCharges <= 2;
    }
    return false;
  }

  /** Spend a color ability's full cost (charges, substituted life, mana, bonus). */
  private payForColorAbility(me: Mage, ability: ColorAbility): void {
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
    me.spendMana(ability.manaCost);
    me.lastAbilityManaPaid = ability.manaCost;
    me.spend('bonus');
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
    if (me.actions.bonus <= 0 && !Dev.infiniteActions) {
      this.flashHint('Color abilities need a bonus action.');
      return;
    }
    if (!this.canAffordAbility(me, ability)) {
      this.flashHint('Not enough color charges / mana.');
      return;
    }
    if (ability.targeting === 'self' || ability.targeting === 'none') {
      this.payForColorAbility(me, ability);
      const item = this.gs.makeSpellItem(me, ability, ability.targeting === 'self' ? me : null, null);
      this.resetSelection();
      this.runStack(item);
      return;
    }
    if (ability.targeting === 'point') {
      this.pendingAbility = ability;
      this.pendingSpell = ability;
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

  private promptReaction(reactor: Mage, top: StackItem): Promise<ReactionChoice | null> {
    return new Promise((resolve) => {
      this.reactor = reactor;
      this.reactionTop = top;
      this.reactionResolve = resolve;
      this.mode = 'reaction';
      this.resetSelection();
      const abil = this.castableAbilities(reactor).length > 0 ? '  [Z/X] color ability' : '';
      this.flashHint(
        `${reactor.name}: REACTION — [1-4]+Enter to cast${abil}, or Space/E to pass.`
      );
      this.redraw();
    });
  }

  /** Cast the currently selected combo as a reaction, if it is a legal one. */
  private castReaction(): void {
    if (!this.reactor || !this.reactionTop) return;
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
    }
    if (spell.targeting === 'none') {
      this.resolveReaction({ spell });
      return;
    }

    // Targeted (enemy / point): let the reactor choose.
    this.reactionAiming = true;
    this.reactionPendingSpell = spell;
    this.reactionTop = top;
    this.aimingSource = reactor;
    this.mode = spell.targeting === 'point' ? 'aiming-point' : 'aiming-spell';
    this.flashHint(`${reactor.name}: choose a target for ${spell.name}  (Esc to go back).`);
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
    // Reveal any dice already rolled so the player sees what they're reacting to.
    await this.playPendingDice();
    return new Promise<Vec2 | null>((resolve) => {
      this.subtargetResolve = resolve as (v: Vec2 | Mage | null) => void;
      this.subtargetSource = source;
      this.subtargetOrigin = origin;
      this.subtargetRange = opts.maxRange;
      this.subtargetMinRange = opts.minRange ?? 0;
      this.mode = 'subtarget-point';
      this.flashHint(opts.prompt ?? `${source.name}: pick a point  (Esc to skip).`);
      this.redraw();
    });
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
    await this.playPendingDice();
    return new Promise<Mage | null>((resolve) => {
      this.subtargetResolve = resolve as (v: Vec2 | Mage | null) => void;
      this.subtargetSource = source;
      this.subtargetOrigin = origin;
      this.subtargetRange = opts.range;
      this.subtargetMinRange = 0;
      this.mode = 'subtarget-enemy';
      this.flashHint(opts.prompt ?? `${source.name}: pick an enemy  (Esc to skip).`);
      this.redraw();
    });
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
  }

  private buildHud(): void {
    this.turnText = this.add.text(FIELD.x, HUD_Y, '', { fontSize: '20px', color: TEXT.body, fontStyle: 'bold' });
    this.comboText = this.add.text(FIELD.x, HUD_Y + 30, '', { fontSize: '16px', color: TEXT.warn });
    this.actionText = this.add.text(FIELD.x, HUD_Y + 56, '', { fontSize: '16px', color: TEXT.body });
    this.resourceText = this.add.text(FIELD.x, HUD_Y + 80, '', { fontSize: '15px', color: TEXT.warn });
    this.hintText = this.add.text(FIELD.x, HUD_Y + 104, '', { fontSize: '15px', color: TEXT.dim });

    this.add.text(FIELD.x, HUD_Y + 132,
      '[1-4] words  [Enter] cast  [Z/X] color ability  [M] move  [A] melee  [E] end turn  [Esc] cancel',
      { fontSize: '13px', color: TEXT.dim });

    for (let i = 0; i < 4; i++) {
      this.wordTexts.push(
        this.add.text(FIELD.x + 470 + i * 190, HUD_Y, '', {
          fontSize: '15px',
          color: TEXT.body,
          backgroundColor: '#181826',
          padding: { x: 8, y: 6 },
          fixedWidth: 178,
        })
      );
    }

    this.logText = this.add
      .text(GAME_WIDTH - 360, HUD_Y - 4, '', {
        fontSize: '13px',
        color: TEXT.dim,
        wordWrap: { width: 350 },
        lineSpacing: 2,
      });

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

    // Shadow pools (under everything else on the field).
    this.drawShadows(g);

    // Reality-break barriers.
    this.drawBarriers(g);

    // Corrosion totems.
    this.drawTotems(g);

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
  private drawBarriers(g: Phaser.GameObjects.Graphics): void {
    for (const b of this.gs.barriers) {
      const tint = b.owner === 1 ? COLORS.team1 : COLORS.team2;
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
    const me = this.aimingSource ?? this.gs.current;
    if (this.controllerIsAI(me) && !aiming) return;

    let range = 0;
    if (this.mode === 'aiming-move') range = me.moveRange();
    else if (this.mode === 'aiming-melee') range = MELEE_RANGE;
    else if (this.mode === 'aiming-spell' || this.mode === 'aiming-point') {
      const spell = this.reactionAiming ? this.reactionPendingSpell : this.pendingSpell;
      if (spell) range = spell.range;
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
    const statuses = m.statuses.map((s) => s.name).join(', ');
    t.setText(`${m.name}\n${m.hp}❤ ${m.sanity}🧠${statuses ? `\n${statuses}` : ''}`);
    t.setPosition(m.x, m.y + MAGE_RADIUS + 22);
  }

  private drawStack(g: Phaser.GameObjects.Graphics): void {
    const n = this.gs.stack.length;
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
    });
    g.lineStyle(1, COLORS.stack, 0.5).strokeRect(startX - 30, y - 30, (n - 1) * 56 + 60, 60);
  }

  private drawHud(): void {
    const me = this.actor;
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
      this.comboText.setText(
        `Selection: ${sel}  →  ${spell.name} (${spell.actionType}, ${rng}, ${mana} mana)`
      );
    } else {
      this.comboText.setText(`Selection: ${sel}  →  (no spell)`);
    }

    const a = me.actions;
    this.actionText.setText(
      `Actions — Move ${dots(a.move, ACTIONS_PER_TURN.move)}  Main ${dots(a.main, ACTIONS_PER_TURN.main)}  Bonus ${dots(a.bonus, ACTIONS_PER_TURN.bonus)}   Reaction: ${me.hasReaction() ? 'ready' : '—'}`
    );

    this.drawResourceText(me);

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

    this.drawLog();
  }

  /** Show the active mage's mana, color charges and primary-color abilities. */
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
            return `[${i === 0 ? 'Z' : 'X'}] ${ab.name} (${c}c/${ab.manaCost}m)`;
          })
          .join('   ')
      : 'none';
    this.resourceText.setText(
      `Mana ${me.mana}/${me.maxMana}   Color ${me.colorCharges}/${me.maxColorCharges}   [${identity}]   ${abilText}`
    );
  }

  private drawLog(): void {
    const lines = this.gs.logLines.slice(-12);
    this.logText.setText(['— Log —', ...lines].join('\n'));
  }

  private updateHover(): void {
    for (const tok of this.stackTokens) {
      if (dist(this.pointer, tok) <= tok.r + 2) {
        const it = tok.item;
        const tgt = it.target ? ` → ${it.target.name}` : it.targetPoint ? ' → location' : '';
        this.tooltip
          .setText(`${it.label} (by ${it.source.name})${tgt}\n${it.description}`)
          .setPosition(tok.x + 20, tok.y + 20)
          .setVisible(true);
        return;
      }
    }
    this.tooltip.setVisible(false);
  }

  private flashHint(msg: string): void {
    this.hintText.setText(msg).setColor(TEXT.warn);
    this.time.delayedCall(1400, () => this.hintText.setColor(TEXT.dim));
  }

  private endGame(): void {
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
    if (item.spell?.targeting === 'self' || item.spell?.targeting === 'none') {
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
  spell: Spell;
  target?: Mage;
  point?: Vec2;
}

function dots(remaining: number, total: number): string {
  return '●'.repeat(Math.max(0, remaining)) + '○'.repeat(Math.max(0, total - remaining)) || '—';
}
