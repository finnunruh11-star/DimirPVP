import {
  ACTIONS_PER_TURN,
  COLOR_CHARGE_CAP,
  FIELD,
  MANA_CAP,
  MAX_ABILITY_CASTS_PER_COMBAT,
  MAX_LEAPS_PER_COMBAT,
  MAX_WORD_SPELL_REACTIONS,
  MOVE_RANGE,
  RANGE_UNIT,
  START_COLOR_CHARGES,
  START_HP,
  START_MANA,
  START_SANITY,
} from '../config/constants';
import { Dev } from '../config/dev';
import type { WordId } from './Words';
import { WORDS } from './Words';
import type { ColorProfile } from './Colors';
import { computeColorProfile } from './Colors';
import type { DieResult } from './Stats';
import { STAT_ORDER } from './Stats';
import type { DamageType, DamageClass } from './Damage';
import type { ItemId, WeaponMod, ShieldMod } from './Items';
import { getItem, carryCapacity, SLOT_CAPS } from './Items';
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
  team: number;

  x: number;
  y: number;

  hp: number;
  maxHp: number;
  sanity: number;
  maxSanity: number;

  loadout: WordId[];
  charges: Record<string, number> = {};

  /** Color identity derived from the loadout (primary / secondary tiers). */
  profile: ColorProfile;

  /** Mana pool: powers word-spells and color abilities. */
  mana: number;
  maxMana: number;
  /** Color-charge pool: powers color abilities only. */
  colorCharges: number;
  maxColorCharges: number;

  /**
   * Whether this mage spent a reaction since its previous turn. Blue's regen
   * grants extra resources to mages that held their reaction.
   */
  reactionUsedRecently = false;

  /** Mana actually paid for the most recent color ability (Rejuvenate reads it). */
  lastAbilityManaPaid = 0;

  // ---- Assigned character stats (set during the pre-duel assignment phase) ---
  /** Flat bonus damage added to basic (melee) attacks. */
  statStrength = 0;
  /** Move-range bonus, as a percentage of the base range. */
  statDex = 0;
  /** Raw intellect points; every 3 lower a spell's DC by 1. */
  statInt = 0;
  /** Remaining luck this duel (spent to push a spell roll up to its DC). */
  luck = 0;
  /** The luck pool size assigned at the start of the duel. */
  maxLuck = 0;
  /** Whether this mage has had its stat dice assigned yet. */
  statsAssigned = false;

  // ---- Equipment (bought in the shop phase) ---------------------------------
  /** Items held in hand (max 2). Wands don't block casting; other pairs do. */
  hands: ItemId[] = [];
  /**
   * Hand-slot items carried but not currently held. Everything bought for the
   * hands starts here; equipping/unequipping (a bonus action) moves items
   * between the bag and the hands. Bag items grant no passive effects.
   */
  bag: ItemId[] = [];
  /** Worn head armour, if any. */
  head: ItemId | null = null;
  /** Worn torso armour / robe, if any. */
  torso: ItemId | null = null;
  /** Worn boots, if any. */
  boots: ItemId | null = null;
  /** Equipped accessories / rings (max 2). */
  accessories: ItemId[] = [];
  /** Utility items carried (potions). Unlimited slots. */
  utility: ItemId[] = [];
  /** Arrows carried as ammunition for bows. */
  arrows = 0;
  /** Silver remaining after shopping (kept for display/debug). 10s = 1g. */
  silver = 0;

  /** Whether this mage moved during the current turn (momentum / anchor boots). */
  movedThisTurn = false;
  /** Total distance (px) moved so far this turn (Momentum Boots threshold). */
  distMovedThisTurn = 0;
  /** Consecutive turns spent moving (Momentum Boots). */
  momentumStacks = 0;
  /** Consecutive turns spent stationary (Anchor Boots, capped at 4). */
  anchorStacks = 0;
  /** One-shot bonus fraction applied to the next basic attack (Tantrum Gloves). */
  rageBonus = 0;
  /** Greed stacks accrued by a Gambler's Blade (1d3 per hit). */
  greedStacks = 0;
  /** Armed for a single Greed gain during the current damaging action (dedup). */
  greedArmed = false;
  /** Set while a cast spell is resolving, for spell-lifesteal bookkeeping (Blood Charm). */
  spellcastActive = false;

  /** Bastion Sword form: false = sword (offence), true = shield (defence). */
  bastionShieldForm = false;
  /** Whether the once-per-duel shield bash has already triggered. */
  shieldBashUsed = false;
  /** A raised-shield block queued as a reaction; consumed by the next physical hit. */
  blockPending = false;
  /** Turns remaining before a fired crossbow can shoot again (0 = loaded). */
  reloadTurns = 0;
  /** Dark Mage's Cape: whether the once-per-duel free black spell has been spent. */
  firstBlackSpellUsed = false;
  /** Gaze Timez Bracelet: whether its once-per-duel mana mill has fired. */
  manaMilledOnce = false;
  /** Blessing of Roaring Thunder: accumulated Thunder stacks. */
  thunderStacks = 0;
  /** Mantle of Eldritch Truth (Defend): voids all incoming damage until next turn. */
  eldritchDefend = false;
  /** Orientation (radians) chosen for the next rotatable wall this mage places. */
  wallAngle = 0;

  /** Training sandbox: this mage cannot die (HP/sanity never drop it below alive). */
  unkillable = false;
  /** Training sandbox: this mage never takes a turn action and declines reactions. */
  trainingPassive = false;

  /** Item ids permanently disabled for this mage by a Needle of Serenity. */
  bannedItemIds = new Set<ItemId>();
  /** Colour-ability ids permanently disabled for this mage by a Needle of Serenity. */
  bannedAbilityIds = new Set<string>();
  /** Whether this mage's unarmed strike has been disabled by a Needle of Serenity. */
  unarmedBanned = false;

  statuses: Status[] = [];
  actions: ActionPool = { ...ACTIONS_PER_TURN };

  /** Whether this mage has a reaction available this turn cycle. */
  reactionAvailable = false;

  /**
   * Whether this mage has already spent their single reaction this turn cycle.
   * Every reaction except a Dexterity dodge (a separate per-combat resource)
   * consumes it; it refreshes each round in {@link GameState.startRound}.
   */
  reactedThisCycle = false;

  /**
   * Word-spell reactions spent this combat. Casting a word-spell as a reaction
   * requires at least one blue word and is capped at
   * {@link MAX_WORD_SPELL_REACTIONS} per combat.
   */
  wordSpellReactionsUsed = 0;

  /**
   * Colour-ability casts spent this combat, keyed by ability id. Each distinct
   * ability may be cast up to {@link MAX_ABILITY_CASTS_PER_COMBAT} times per
   * combat (counting both proactive casts and reactions).
   */
  abilityCastsUsed: Record<string, number> = {};

  /**
   * Dodges left this combat. A dexterous mage (Dex >= 6) may spend one to try
   * to evade an incoming attack. Refilled once at the start of the duel to
   * {@link maxDodges}. This is a separate resource from the once-per-turn
   * reaction.
   */
  dodgesRemaining = 0;

  /** Leaps (bonus-action bounds) spent this combat, capped at {@link MAX_LEAPS_PER_COMBAT}. */
  leapsUsed = 0;

  /** Whether the once-per-combat Focus action has been used. */
  focusUsed = false;

  /** Whether the once-per-combat Cleave action has been used. */
  cleaveUsed = false;

  /**
   * One-shot Focus buff: while set, the next word spell cast this turn costs 50%
   * less mana and rolls its DC twice (advantage). Consumed by that spell and
   * cleared at the start of the next turn if it went unused.
   */
  focusNextSpell = false;

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
    team: number;
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
    this.profile = computeColorProfile(this.loadout);
    // Blue primary tier grants every word one extra charge.
    const bonusCharge = this.profile.bluePrimaryTier ? 1 : 0;
    for (const w of this.loadout) this.charges[w] = WORDS[w].charges + bonusCharge;
    this.maxMana = MANA_CAP;
    this.mana = START_MANA;
    this.maxColorCharges = COLOR_CHARGE_CAP;
    this.colorCharges = START_COLOR_CHARGES;
  }

  get pos(): Vec2 {
    return { x: this.x, y: this.y };
  }

  get alive(): boolean {
    if (this.unkillable) return true;
    return this.hp > 0 && this.sanity > 0;
  }

  /** True if this mage's loadout grants a reaction at all. */
  get grantsReaction(): boolean {
    return this.loadout.some((w) => WORDS[w].grantsReaction);
  }

  /**
   * Whether this mage can ever react: it has a reaction-granting word, or its
   * blue primary tier lets it respond with any spell / color ability.
   */
  get canEverReact(): boolean {
    return this.grantsReaction || this.profile.bluePrimaryTier;
  }

  hasReaction(): boolean {
    return this.canEverReact && this.reactionAvailable;
  }

  /**
   * True if this mage may still cast a word-spell as a reaction this combat:
   * it needs at least one blue word and some of its per-combat budget left.
   */
  canWordSpellReact(): boolean {
    return (
      this.profile.bluePrimaryTier &&
      this.wordSpellReactionsUsed < MAX_WORD_SPELL_REACTIONS
    );
  }

  /** How many more times the colour ability `abilityId` may be cast this combat. */
  abilityCastsLeft(abilityId: string): number {
    return MAX_ABILITY_CASTS_PER_COMBAT - (this.abilityCastsUsed[abilityId] ?? 0);
  }

  /** Reset the per-combat reaction / colour-ability pools. Call when a duel begins. */
  resetCombatReactions(): void {
    this.wordSpellReactionsUsed = 0;
    this.abilityCastsUsed = {};
    this.leapsUsed = 0;
    this.focusUsed = false;
    this.cleaveUsed = false;
    this.focusNextSpell = false;
  }

  /** How many Leaps this mage has left this combat. */
  leapsLeft(): number {
    return MAX_LEAPS_PER_COMBAT - this.leapsUsed;
  }

  /** How many dodges this mage gets per combat: one for every 6 Dexterity. */
  maxDodges(): number {
    return Math.floor(this.effectiveDex() / 6);
  }

  /** Refill the per-combat dodge pool. Call once when the duel begins. */
  resetDodges(): void {
    this.dodgesRemaining = this.maxDodges();
  }

  // ---- Mana & color charges -------------------------------------------------

  hasMana(amount: number): boolean {
    return Dev.infiniteActions || this.mana >= amount;
  }

  spendMana(amount: number): void {
    if (Dev.infiniteActions) return;
    this.mana = Math.max(0, this.mana - amount);
  }

  gainMana(amount: number): void {
    this.mana = Math.min(this.maxMana, this.mana + Math.max(0, amount));
  }

  hasColorCharges(amount: number): boolean {
    return Dev.infiniteActions || this.colorCharges >= amount;
  }

  spendColorCharges(amount: number): void {
    if (Dev.infiniteActions) return;
    this.colorCharges = Math.max(0, this.colorCharges - amount);
  }

  gainColorCharges(amount: number): void {
    this.colorCharges = Math.min(this.maxColorCharges, this.colorCharges + Math.max(0, amount));
  }

  /**
   * Regenerate color-charges at the start of this mage's turn. The amount is
   * decided by the primary color:
   *   - Black: +1, plus +1 per allied summon (scarab) lost since last turn.
   *   - Blue:  +1, plus +2 if no reaction was spent since last turn.
   *   - Colorless: +1.
   * Mana does NOT regenerate here — it refills only via items or abilities.
   */
  regen(opts: { summonDeaths: number }): void {
    let amount = 1;
    if (this.profile.primary === 'black') {
      amount = 1 + Math.max(0, opts.summonDeaths);
    } else if (this.profile.primary === 'blue') {
      amount = 1 + (this.reactionUsedRecently ? 0 : 2);
    }
    this.gainColorCharges(amount);
    this.reactionUsedRecently = false;
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

  /** Mantle of Eldritch Truth (Restore): grant `n` charges of each loadout word. */
  grantEldritchCharges(n: number): void {
    for (const w of this.loadout) {
      this.charges[w] = (this.charges[w] ?? 0) + n;
    }
  }

  // ---- Statuses -------------------------------------------------------------

  getStatus<T extends Status>(kind: T['kind']): T | undefined {
    return this.statuses.find((s) => s.kind === kind) as T | undefined;
  }

  getInvisibility(): InvisibilityStatus | undefined {
    // A Roaring Thunder blaze (9+ stacks) lights the wielder up — no hiding.
    if (this.thunderGlowing()) return undefined;
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
    const base = MOVE_RANGE * (1 + this.effectiveDex() / 100);
    let px = Math.round(base * this.equipMoveMult() * this.thunderMoveMult());
    if (this.hasMomentumBoots()) px += this.momentumStacks * RANGE_UNIT;
    const slowed = px + this.modifier('moveRange');
    // Gaze Timez Bracelet: slow debuffs can never cut movement below the cap
    // (roots / movement-stuns bypass this entirely — they aren't slows).
    const cap = this.slowCap();
    const floor = cap < 1 ? Math.round(px * (1 - cap)) : 0;
    return Math.max(floor, Math.max(0, slowed));
  }

  // ---- Character stats ------------------------------------------------------

  /**
   * Apply an assignment of the shared stat dice. `order[i]` is the index of the
   * die handed to the stat at slot `i` of {@link STAT_ORDER}. HP and mana pools
   * are raised (and refilled), the remaining stats are stored for combat use.
   */
  applyStatAllocation(dice: DieResult[], order: number[]): void {
    const valueOf = (key: (typeof STAT_ORDER)[number]): number => {
      const slot = STAT_ORDER.indexOf(key);
      const die = dice[order[slot]];
      return die ? die.value : 0;
    };
    this.statStrength = valueOf('strength');
    this.statDex = valueOf('dex');
    this.statInt = valueOf('int');
    this.maxMana += valueOf('mana');
    this.mana = this.maxMana;
    this.maxHp += valueOf('hp');
    this.hp = this.maxHp;
    this.maxLuck = valueOf('luck');
    this.luck = this.maxLuck;
    this.statsAssigned = true;
  }

  /** Training sandbox: give every stat the same flat value and refill vitals. */
  assignFlatStats(value: number): void {
    this.statStrength = value;
    this.statDex = value;
    this.statInt = value;
    this.maxMana = MANA_CAP + value;
    this.mana = this.maxMana;
    this.maxHp = START_HP + value;
    this.hp = this.maxHp;
    this.maxSanity = START_SANITY;
    this.sanity = this.maxSanity;
    this.maxLuck = value;
    this.luck = value;
    this.statsAssigned = true;
  }

  /** Effective Strength including equipment stat tweaks (Bracelet of Might). */
  effectiveStr(): number {
    return this.statStrength + this.itemSum((d) => d.statMods?.str ?? 0);
  }

  /** Effective Dexterity including equipment stat tweaks. */
  effectiveDex(): number {
    return this.statDex + this.itemSum((d) => d.statMods?.dex ?? 0);
  }

  /** Effective Intellect including a worn Caster Robe / rings. */
  effectiveInt(): number {
    return this.statInt + this.itemSum((d) => d.statMods?.int ?? 0);
  }

  /** How much a spell's DC is reduced by this mage's intellect. */
  dcReduction(): number {
    return Math.floor(this.effectiveInt() / 3);
  }

  /** Spend up to `amount` luck (never below zero); returns the amount spent. */
  spendLuck(amount: number): number {
    const spent = Math.max(0, Math.min(this.luck, Math.floor(amount)));
    this.luck -= spent;
    return spent;
  }

  // ---- Equipment ------------------------------------------------------------

  /** Every worn / carried item (for stat sums; arrow ammo is tracked separately). */
  equippedItems(): ItemId[] {
    const out: ItemId[] = [...this.hands, ...this.accessories, ...this.utility];
    if (this.head) out.push(this.head);
    if (this.torso) out.push(this.torso);
    if (this.boots) out.push(this.boots);
    return out;
  }

  /** Sum a numeric property across all equipped items. */
  private itemSum(pick: (def: ReturnType<typeof getItem>) => number): number {
    return this.equippedItems().reduce((acc, id) => acc + pick(getItem(id)), 0);
  }

  /** True if an equipped item satisfies `pred`. */
  private hasItemWhere(pred: (def: ReturnType<typeof getItem>) => boolean): boolean {
    return this.equippedItems().some((id) => pred(getItem(id)));
  }

  hasManaWand(): boolean {
    return this.hasItemWhere((d) => !!d.manaDiscount);
  }

  hasWitchWand(): boolean {
    return this.hasItemWhere((d) => !!d.doubleDebuffs);
  }

  /** Mana restored each time this mage takes damage (Channeling Ring). */
  manaOnHit(): number {
    return this.itemSum((d) => d.manaOnHit ?? 0);
  }

  /** Total flat mana discount on word-spells (stacks across all equipped wands). */
  manaDiscountSum(): number {
    return this.itemSum((d) => d.manaDiscount ?? 0);
  }

  /** Is item `id` currently equipped? */
  hasItem(id: ItemId): boolean {
    return this.equippedItems().includes(id);
  }

  /** Combined multiplier on HP healing this mage receives (Blood Ring). */
  healMult(): number {
    let mult = 1;
    for (const id of this.equippedItems()) {
      const m = getItem(id).healMult;
      if (m != null) mult *= m;
    }
    return mult;
  }

  /** Fraction of max HP each spell costs to cast (Blood Charm). */
  spellHealthCostPct(): number {
    return this.equippedItems().reduce(
      (max, id) => Math.max(max, getItem(id).spellHealthCostPct ?? 0),
      0
    );
  }

  /** Fraction of spell damage returned to the caster as healing (Blood Charm). */
  spellLifestealPct(): number {
    return this.equippedItems().reduce(
      (max, id) => Math.max(max, getItem(id).spellLifestealPct ?? 0),
      0
    );
  }

  /** Flat HP healed on each landing melee hit, before healMult (Blood Ring). */
  meleeHealOnHit(): number {
    return this.itemSum((d) => d.meleeHealOnHit ?? 0);
  }

  /** Total melee damage reflected to attackers (Thorn Ring). */
  thornsTotal(): number {
    return this.itemSum((d) => d.thorns ?? 0);
  }

  /** Sanity hits below this amount are fully negated (Aluminium Hat). */
  sanityWardBelow(): number {
    return this.equippedItems().reduce(
      (max, id) => Math.max(max, getItem(id).sanityWardBelow ?? 0),
      0
    );
  }

  /** Does worn gear turn melee damage dealt into mana (Battle Robe)? */
  hasMeleeManaLeech(): boolean {
    return this.hasItemWhere((d) => !!d.manaPerMeleeDmg);
  }

  /** Bonus dagger-damage fraction granted while veiled (Assassin's Cloak). */
  veiledDaggerBonus(): number {
    return this.itemSum((d) => d.veiledDaggerBonus ?? 0);
  }

  private hasMomentumBoots(): boolean {
    return this.boots != null && !!getItem(this.boots).momentumBoots;
  }

  private hasAnchorBoots(): boolean {
    return this.boots != null && !!getItem(this.boots).anchorBoots;
  }

  /** Extra flat armour from raised shields (Buckler; Bastion shield form). */
  bonusArmorFlat(): number {
    return this.heldShields().reduce((a, s) => a + s.armorFlat, 0);
  }

  /** Extra flat *magic* armour from raised shields (Greatshield shield form). */
  bonusMagicArmorFlat(): number {
    return this.heldShields().reduce((a, s) => a + (s.magicFlat ?? 0), 0);
  }

  /** Flat mental-damage reduction from worn gear (Neforpubi's Headpiece). */
  mentalReduce(): number {
    return this.itemSum((d) => d.mentalReduce ?? 0);
  }

  /** Flat bonus added to melee swings from worn gear (Fighter's Gloves). */
  meleeDamageBonus(): number {
    return this.itemSum((d) => d.meleeDamageBonus ?? 0);
  }

  /** Does this mage carry a Bag of Holding (no carry-weight limit)? */
  hasBagOfHolding(): boolean {
    return this.hasItemWhere((d) => !!d.bagOfHolding);
  }

  /** Does this mage wear the Mantle of Eldritch Truth (grants the Eldritch action)? */
  hasEldritchMantle(): boolean {
    return this.hasItemWhere((d) => !!d.eldritchMantle);
  }

  /** Does this mage carry the Blessing of Roaring Thunder? */
  hasThunderBlessing(): boolean {
    return this.hasItemWhere((d) => !!d.thunderBlessing);
  }

  /** Does this mage wear the Second Ring of Lareneg? */
  hasLaranegRing(): boolean {
    return this.hasItemWhere((d) => !!d.laranegRing);
  }

  /** Does this mage carry an unused Needle of Serenity? */
  hasNeedle(): boolean {
    return this.utility.some((id) => !!getItem(id).needleOfSerenity);
  }

  /** Spend one Needle of Serenity (one-time use). */
  consumeNeedle(): boolean {
    const i = this.utility.findIndex((id) => !!getItem(id).needleOfSerenity);
    if (i < 0) return false;
    this.utility.splice(i, 1);
    return true;
  }

  /** Is weapon/item `id` disabled for this mage by a Needle of Serenity? */
  isItemBanned(id: ItemId): boolean {
    return this.bannedItemIds.has(id);
  }

  /** Is colour-ability `id` disabled for this mage by a Needle of Serenity? */
  isAbilityBanned(id: string): boolean {
    return this.bannedAbilityIds.has(id);
  }

  /** Is action/ability keyed `key` (eldritch, thunder, weapon action) disabled? */
  isActionBanned(key: string): boolean {
    return this.bannedAbilityIds.has(key);
  }

  /** Piecewise move multiplier from the Roaring Thunder stack count. */
  thunderMoveMult(): number {
    if (!this.hasThunderBlessing()) return 1;
    const s = this.thunderStacks;
    if (s >= 14) return 4.0; // +300%
    if (s >= 12) return 0.5; // -50%
    if (s >= 9) return 2.0; //  +100%
    if (s >= 6) return 1.5; //  +50%
    if (s >= 3) return 1.0; //  +0%
    return 0.25; //             -75%
  }

  /** At 9+ Thunder stacks the wielder blazes and can no longer hide. */
  thunderGlowing(): boolean {
    return this.hasThunderBlessing() && this.thunderStacks >= 9;
  }

  /** Add Thunder stacks (no-op without the Blessing). */
  addThunderStacks(n: number): void {
    if (!this.hasThunderBlessing() || n <= 0) return;
    this.thunderStacks += n;
  }

  /** Best slow-cap fraction from gear (Gaze Timez: slows capped at 75%), or 1. */
  slowCap(): number {
    let cap = 1;
    for (const id of this.equippedItems()) {
      const c = getItem(id).slowCapPct;
      if (c != null) cap = Math.min(cap, c);
    }
    return cap;
  }

  /** Does gear grant one free black spell per duel (Dark Mage's Cape)? */
  hasFreeBlackSpell(): boolean {
    return this.hasItemWhere((d) => !!d.firstBlackSpellFree);
  }

  /** Does a held wand double spell costs (mutivarg's rod)? */
  spellCostMultiplier(): number {
    return this.hasItemWhere((d) => !!d.doublesSpellCost) ? 2 : 1;
  }

  /** Greatshield sword form binds the wielder: no bag actions or weapon swaps. */
  swordFormLocked(): boolean {
    return this.hands.includes('bastionSword') && !this.bastionShieldForm;
  }

  /**
   * Apply on-fizzle gear perks (Soul Battery / Soul Locket / Tantrum Gloves).
   * Returns log lines describing what triggered.
   */
  onSpellFizzle(): string[] {
    const log: string[] = [];
    const healAmt = this.itemSum((d) => d.onFizzleHeal ?? 0);
    if (healAmt > 0) {
      const healed = Math.round(healAmt * this.healMult());
      this.hp = Math.min(this.maxHp, this.hp + healed);
      log.push(`${this.name}'s Soul Battery turns the failure into ${healed} health.`);
    }
    const manaAmt = this.itemSum((d) => d.onFizzleMana ?? 0);
    if (manaAmt > 0) {
      this.gainMana(manaAmt);
      log.push(`${this.name}'s Soul Locket draws ${manaAmt} mana from the fizzle.`);
    }
    const rage = this.itemSum((d) => d.onFizzleRage ?? 0);
    if (rage > 0) {
      this.rageBonus = rage;
      log.push(
        `${this.name} channels frustration — next attack +${Math.round(rage * 100)}% damage.`
      );
    }
    return log;
  }

  /** Combined multiplicative move-range factor from equipped gear. */
  private equipMoveMult(): number {
    let mult = 1;
    for (const id of this.equippedItems()) {
      const m = getItem(id).moveMult;
      if (m != null) mult *= m;
    }
    return mult;
  }

  /** Apply one-time multiplicative HP / sanity changes from equipped gear. */
  applyEquipmentVitals(): void {
    let hpMult = 1;
    let sanMult = 1;
    let hpFlat = 0;
    for (const id of this.equippedItems()) {
      const d = getItem(id);
      if (d.hpMult != null) hpMult *= d.hpMult;
      if (d.sanityMult != null) sanMult *= d.sanityMult;
      if (d.hpFlat != null) hpFlat += d.hpFlat;
    }
    this.maxHp = Math.max(1, Math.round(this.maxHp * hpMult) + hpFlat);
    this.hp = this.maxHp;
    this.maxSanity = Math.max(1, Math.round(this.maxSanity * sanMult));
    this.sanity = this.maxSanity;
  }

  /** Total weight (kg) currently carried (gear + stowed bag + arrow ammo). */
  carriedWeight(): number {
    const bagWeight = this.bag.reduce((acc, id) => acc + getItem(id).weight, 0);
    return this.itemSum((d) => d.weight) + bagWeight + this.arrows * getItem('arrow').weight;
  }

  /** Carry capacity (kg), scaling with Strength. Bag of Holding lifts the cap. */
  carryCap(): number {
    if (this.hasBagOfHolding()) return Infinity;
    return carryCapacity(this.statStrength);
  }

  /** Can this mage take on `extraKg` more weight? */
  canCarry(extraKg: number): boolean {
    return this.carriedWeight() + extraKg <= this.carryCap();
  }

  /** Hand items that are not wands — two of these block spellcasting. */
  private nonWandHandCount(): number {
    return this.hands.filter((id) => !getItem(id).isWand).length;
  }

  /** Holding two non-wand hand items locks you out of casting spells. */
  blocksCasting(): boolean {
    return this.nonWandHandCount() >= 2;
  }

  hasFreeHand(): boolean {
    return this.hands.length < SLOT_CAPS.hand;
  }

  /** Equip a hand item out of the bag, if a hand slot is free. Returns success. */
  equipHand(id: ItemId): boolean {
    const i = this.bag.indexOf(id);
    if (i < 0 || this.hands.length >= SLOT_CAPS.hand) return false;
    this.bag.splice(i, 1);
    this.hands.push(id);
    return true;
  }

  /** Stow a held hand item back into the bag. Returns success. */
  unequipHand(id: ItemId): boolean {
    const i = this.hands.indexOf(id);
    if (i < 0) return false;
    this.hands.splice(i, 1);
    this.bag.push(id);
    return true;
  }

  /** The weapon that powers the basic attack — the first weapon held, if any. */
  activeWeapon(): WeaponMod | null {
    for (const id of this.hands) {
      const def = getItem(id);
      // A weapon disabled by a Needle of Serenity can never swing again.
      if (this.isItemBanned(id)) continue;
      // Greatshield in shield form swings with its blunt shield-side profile.
      if (id === 'bastionSword' && this.bastionShieldForm) {
        if (def.shieldWeapon) return def.shieldWeapon;
        continue;
      }
      if (!def.weapon) continue;
      return def.weapon;
    }
    return null;
  }

  /** The item id of the active weapon (for one-shot consumption). */
  activeWeaponId(): ItemId | null {
    for (const id of this.hands) {
      const def = getItem(id);
      if (this.isItemBanned(id)) continue;
      if (id === 'bastionSword') {
        // The greatshield can attack in either form.
        if (this.bastionShieldForm ? def.shieldWeapon : def.weapon) return id;
        continue;
      }
      if (!def.weapon) continue;
      return id;
    }
    return null;
  }

  /** Shields currently raised: Buckler always; Bastion only in shield form. */
  heldShields(): ShieldMod[] {
    const out: ShieldMod[] = [];
    for (const id of this.hands) {
      const def = getItem(id);
      if (!def.shield) continue;
      if (id === 'bastionSword' && !this.bastionShieldForm) continue;
      out.push(def.shield);
    }
    return out;
  }

  /** Fraction of incoming physical damage blocked by raised shields (best wins). */
  blockReduction(): number {
    return this.heldShields().reduce((m, s) => Math.max(m, s.blockPct), 0);
  }

  /** Strength-swing multiplier for an available shield bash, or null if none/used. */
  shieldBashMult(): number | null {
    if (this.shieldBashUsed) return null;
    let best: number | null = null;
    for (const s of this.heldShields()) best = best == null ? s.bashMult : Math.max(best, s.bashMult);
    return best;
  }

  /** Does this mage wield a Greed-hoarding Gambler's Blade? */
  hasGamblerBlade(): boolean {
    return this.hands.some((id) => getItem(id).gamblerGreed);
  }

  /** Held weapons that expose a Weapon-Action ability. */
  weaponAbilityItems(): ItemId[] {
    return this.hands.filter((id) => !!getItem(id).weaponAbility);
  }

  /** True if the Weapon Action would do anything (any held weapon has an ability). */
  hasWeaponAction(): boolean {
    return this.weaponAbilityItems().length > 0;
  }

  /** Does the active weapon strike as a bonus action (Gambler's Blade)? */
  attackIsBonusAction(): boolean {
    const id = this.activeWeaponId();
    return id != null && !!getItem(id).bonusActionAttack;
  }

  /** Reduce an incoming hit by worn armour (physical / magic / mental split). */
  reduceIncoming(amount: number, type: DamageType, damageClass: DamageClass): number {
    if (damageClass === 'sanity') {
      // Mental damage: armour does nothing; only mind-warding gear helps.
      return Math.max(0, amount - this.mentalReduce());
    }
    const isPhysical = type === 'pierce' || type === 'slashing' || type === 'shatter';
    const isMagical = type === 'shadow' || type === 'corrosive';
    let flat = 0;
    if (isPhysical) {
      for (const id of this.equippedItems()) {
        const mod = getItem(id).armor;
        if (mod) flat += mod.flat;
      }
      // Raised shields add flat physical armour while held.
      flat += this.bonusArmorFlat();
      // Anchor Boots add a stack of flat armour for each turn spent stationary.
      if (this.hasAnchorBoots()) flat += Math.min(4, this.anchorStacks);
    } else if (isMagical) {
      for (const id of this.equippedItems()) {
        const mag = getItem(id).armor?.magicFlat;
        if (mag) flat += mag;
      }
      flat += this.bonusMagicArmorFlat();
    } else {
      // Typeless / unclassified damage ignores armour entirely.
      return amount;
    }
    return Math.max(0, amount - flat);
  }

  /**
   * Combined damage-type multiplier from resistances / immunities / weaknesses
   * across all equipped gear (immune ×0, each resist ×0.5, each weak ×2). Applied
   * AFTER flat armour. Returns 1 when nothing affects this damage type.
   */
  resistMultiplier(type: DamageType): number {
    let immune = false;
    let mult = 1;
    for (const id of this.equippedItems()) {
      const r = getItem(id).resist;
      if (!r) continue;
      if (r.immune?.includes(type)) immune = true;
      if (r.resist?.includes(type)) mult *= 0.5;
      if (r.weak?.includes(type)) mult *= 2;
    }
    return immune ? 0 : mult;
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
    // Update momentum / anchor stacks from how we spent our last turn.
    // Momentum only builds on turns we covered >80% of our movement range;
    // it resets only when we stand completely still. Anchor builds while idle.
    if (this.movedThisTurn) {
      const maxMove = this.moveRange();
      if (maxMove > 0 && this.distMovedThisTurn >= 0.8 * maxMove) this.momentumStacks += 1;
      this.anchorStacks = 0;
    } else {
      this.momentumStacks = 0;
      this.anchorStacks = Math.min(4, this.anchorStacks + 1);
    }
    this.movedThisTurn = false;
    this.distMovedThisTurn = 0;
    this.actions = { ...ACTIONS_PER_TURN };
    this.hasCastThisTurn = false;
    // A Focus buff expires if its empowered word spell was never cast.
    this.focusNextSpell = false;
    // Eldritch Truth's shroud lasts only until the start of the wielder's next turn.
    this.eldritchDefend = false;
    // A fired crossbow reloads one step at the start of each of the wielder's turns.
    if (this.reloadTurns > 0) this.reloadTurns -= 1;
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
