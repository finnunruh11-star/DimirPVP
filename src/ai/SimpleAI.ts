import type { GameState } from '../core/GameState';
import type { Mage } from '../core/Mage';
import type { Spell } from '../spells/Spell';
import { allSpells } from '../spells/registry';
import { comboKey } from '../core/Words';
import { dist, stepTowards, type Vec2 } from '../core/utils';
import type { Scarab } from '../core/Scarab';
import type { StackItem } from '../core/Stack';
import { getColorAbilitiesFor, type ColorAbility } from '../spells/colorAbilities';
import { FIELD, MELEE_RANGE, RANGE_UNIT } from '../config/constants';
import {
  LICH_SPELLS,
  LICH_SPELL_RANGE,
  freshLichCharges,
  type LichWord,
  type LichSpell,
} from '../pve/lichPowers';
import { chooseMineAction } from '../pve/mineAI';
import { isGoblin } from '../pve/goblins';
import { chooseGoblinAction } from './goblinAI';
import { isBaralUnit } from '../pve/baral';
import { chooseBaralAction } from './baralAI';
import type { MineActionChoice } from '../pve/mineActions';

export type AIDecision =
  | { type: 'move'; point: Vec2 }
  | { type: 'melee'; target: Mage }
  // Swat a harassing enemy scarab that is latched onto or beside us.
  | { type: 'scarab'; scarab: Scarab }
  | { type: 'spell'; spell: Spell; target?: Mage; point?: Vec2 }
  | { type: 'color-ability'; ability: ColorAbility; target?: Mage; point?: Vec2 }
  | { type: 'deaths-angel-wings' }
  // A bespoke Lich power: cast for free (no pay/DC) and always succeeds.
  | { type: 'power'; spell: Spell; target: Mage }
  // Ghast: telegraph a delayed shadow zone that erupts on its next turn.
  | { type: 'ghast-mark'; point: Vec2 }
  // Ghast: shove a nearby entity away and deal a little damage.
  | { type: 'ghast-shove'; target: Mage }
  // Reaper: brush a foe within reach to Mark it (unpreventable, no damage).
  | { type: 'reaper-mark'; target: Mage }
  // Reaper: channel for the turn; the clap resolves at the start of its next.
  | { type: 'reaper-channel' }
  | { type: 'mine-action'; choice: MineActionChoice }
  // Goblin Shaman: mend a goblin (+3 HP, faster) or hex a foe (slower).
  | { type: 'goblin-heal'; target: Mage }
  | { type: 'goblin-hex'; target: Mage }
  // A routed goblin at the edge of the field leaves the fight.
  | { type: 'goblin-escape' }
  | { type: 'end' };

export interface AIReaction {
  spell: Spell;
  target?: Mage;
  point?: Vec2;
}

/** A deliberately small, readable opponent. Tweak the heuristics freely. */
export class SimpleAI {
  /** Remaining per-combat, per-word charges for a Lich (unused for other AIs). */
  private lichCharges: Record<LichWord, number> = freshLichCharges();

  constructor(private game: GameState, private self: Mage) {}

  private castableSpells(action: 'main' | 'bonus'): Spell[] {
    const set = new Set(this.self.loadout);
    const forgotten = this.self.forgotten();
    return allSpells(this.self.spellClass).filter(
      (s) =>
        s.actionType === action &&
        // Delay only does anything in answer to something on the stack.
        !s.delaysStackItem &&
        s.words.every((w) => set.has(w)) &&
        !s.words.some((w) => forgotten.includes(w)) &&
        this.game.canCastSpellNow(s) &&
        this.self.hasCharges(s.words)
    );
  }

  /** Pick the next action for the AI's turn, or end the turn. */
  chooseAction(): AIDecision {
    if (this.self.sceneSide === 'prey') return this.choosePreyAction();
    if (this.self.mine) {
      const mine = chooseMineAction(this.game, this.self);
      if (mine) return mine;
    }
    if (
      this.self.hasDeathsAngelWings() &&
      !this.self.isItemBanned('deathsAngelWings') &&
      this.self.deathsAngelEnergy > 0 &&
      this.self.deathsAngelFlightTurns <= 1 &&
      this.self.actions.bonus > 0
    ) {
      return { type: 'deaths-angel-wings' };
    }
    // The Lich runs its own smart routine (bespoke powers, stays put to unlock
    // its end-step, secures kills). Every other undead falls through to the
    // shared logic below — but plays optimally while a Lich commands them.
    if (this.self.enemyKind === 'lich') return this.chooseLichAction();
    if (isGoblin(this.self)) return chooseGoblinAction(this.game, this.self);
    if (isBaralUnit(this.self)) return chooseBaralAction(this.game, this.self);
    if (this.self.reaperKind) return this.chooseReaperAction();
    if (this.self.ghastKind) return this.chooseGhastAction();
    if (this.self.companion === 'dwarf') return this.chooseDwarfAction();

    const enemy = this.chooseTarget();
    const acts = this.self.actions;

    // No visible foe (everyone is veiled): the AI does not know where anyone is,
    // so it holds position — but will still swat a scarab that is biting it.
    if (!enemy) {
      if (acts.main > 0) {
        const scarab = this.game.enemyScarabsInRange(this.self, MELEE_RANGE)[0];
        if (scarab) return { type: 'scarab', scarab };
      }
      const detour = acts.move > 0 ? this.detourAroundCurtain() : null;
      if (detour) return { type: 'move', point: detour };
      return { type: 'end' };
    }

    // At most one spell per turn.
    if (!this.self.hasCastThisTurn) {
      // 1. If we can land a damaging main spell, do it.
      if (acts.main > 0) {
        const spell = this.bestOffensiveSpell('main', enemy);
        if (spell) return this.castDecision(spell, enemy);
      }
      // 2. Otherwise a bonus spell.
      if (acts.bonus > 0) {
        const spell = this.bestOffensiveSpell('bonus', enemy);
        if (spell) return this.castDecision(spell, enemy);
      }
    }
    // 3. Melee if adjacent and we still have a main action.
    if (acts.main > 0 && this.game.canMelee(this.self, enemy)) {
      return { type: 'melee', target: enemy };
    }
    // 3b. No foe in reach, but a scarab is biting us — swat it away.
    if (acts.main > 0) {
      const scarab = this.game.enemyScarabsInRange(this.self, MELEE_RANGE)[0];
      if (scarab) return { type: 'scarab', scarab };
    }
    // 4. Move toward the enemy if we still have a move and aren't close enough.
    if (acts.move > 0 && dist(this.self.pos, enemy.pos) > MELEE_RANGE + 20) {
      const point = stepTowards(this.self.pos, enemy.pos, this.self.moveRange());
      return { type: 'move', point };
    }
    return { type: 'end' };
  }

  /** Decide whether to react to the item on top of the stack. */
  chooseReaction(top: StackItem): AIReaction | null {
    if (!this.self.hasReaction()) return null;
    if (top.source.team === this.self.team) return null;
    const enemy = top.source;
    const set = new Set(this.self.loadout);
    const forgotten = this.self.forgotten();
    // With a reaction word the AI may answer with ANY castable spell.
    const grants = this.self.grantsReaction;
    const reactions = allSpells(this.self.spellClass).filter(
      (s) =>
        this.self.hasCharges(s.words) &&
        s.words.every((w) => set.has(w)) &&
        !s.words.some((w) => forgotten.includes(w)) &&
        this.game.canCastSpellNow(s) &&
        (grants || s.reaction)
    );
    if (reactions.length === 0) return null;

    // Prefer a counter (e.g. Bind Pierce) when low, otherwise hide (Veil).
    // A bare window (end of turn, a blink) holds nothing worth countering.
    const counter = top.windowTrigger ? undefined : reactions.find((s) => s.counters);
    if (counter && this.isProtectiveReaction(counter)) {
      const struck = top.target && top.target.team === this.self.team ? top.target : this.self;
      if (this.game.isValidSpellTarget(counter, this.self, struck) && this.game.rng.chance(0.6)) {
        return { spell: counter, target: struck };
      }
    }
    if (counter && this.game.isValidSpellTarget(counter, this.self, enemy) && this.game.rng.chance(0.6)) {
      if (counter.targeting === 'point') {
        const reach = Number.isFinite(counter.range) ? counter.range : this.self.moveRange();
        return { spell: counter, point: stepTowards(this.self.pos, enemy.pos, reach) };
      }
      if (counter.targeting === 'none') return { spell: counter };
      return { spell: counter, target: enemy };
    }
    const selfBuff = reactions.find((s) => s.targeting === 'self' || s.targeting === 'any');
    if (selfBuff && this.self.hp <= this.self.maxHp * 0.5 && this.game.rng.chance(0.7)) {
      return { spell: selfBuff, target: this.self };
    }
    // Otherwise occasionally strike back with an offensive reaction.
    const offensive = reactions
      .filter((s) => s.targeting === 'enemy' && this.game.isValidSpellTarget(s, this.self, enemy))
      .sort((a, b) => b.words.length - a.words.length);
    if (offensive.length > 0 && this.game.rng.chance(0.4)) {
      return { spell: offensive[0], target: enemy };
    }
    return null;
  }

  /** Prey never fights back: it runs straight away from whatever is nearest. */
  private choosePreyAction(): AIDecision {
    const threat = this.game.opponentOf(this.self);
    const reach = this.self.moveRange();
    if (this.self.actions.move <= 0 || reach <= 0 || threat === this.self || !threat.alive) return { type: 'end' };
    const dx = this.self.x - threat.x;
    const dy = this.self.y - threat.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const margin = this.self.bodyRadius() + 4;
    return {
      type: 'move',
      point: {
        x: Math.min(FIELD.x + FIELD.w - margin, Math.max(FIELD.x + margin, this.self.x + (dx / len) * reach)),
        y: Math.min(FIELD.y + FIELD.h - margin, Math.max(FIELD.y + margin, this.self.y + (dy / len) * reach)),
      },
    };
  }

  private chooseDwarfAction(): AIDecision {
    const target = this.chooseTarget();
    if (!target) return { type: 'end' };
    const wantsLantern = target.isEthereal();
    if (wantsLantern) {
      for (const id of [...this.self.hands]) {
        if (id === 'warHammer' || id === 'runicMaul') this.self.unequipHand(id);
      }
    }
    if (!wantsLantern && this.self.hands.includes('lantern')) this.self.unequipHand('lantern');
    const wanted = wantsLantern
      ? 'lantern'
      : this.self.hands.includes('runicMaul') || this.self.bag.includes('runicMaul')
        ? 'runicMaul'
        : 'warHammer';
    if (!this.self.hands.includes(wanted) && this.self.bag.includes(wanted) && this.self.equipHand(wanted)) {
      this.game.notifyLightActivation(this.self);
    }
    if (this.self.actions.main > 0 && this.game.canMelee(this.self, target)) {
      return { type: 'melee', target };
    }
    if (this.self.actions.move > 0) {
      return { type: 'move', point: stepTowards(this.self.pos, target.pos, this.self.moveRange()) };
    }
    return { type: 'end' };
  }

  private bestOffensiveSpell(action: 'main' | 'bonus', enemy: Mage): Spell | null {
    const options = this.castableSpells(action).filter((s) => {
      if (this.desecrationWasted(s)) return false;
      if (this.isWeaponEnchant(s)) return this.bestEnchantTarget(s) !== null;
      if (this.isIndiscriminateStorm(s) && !this.stormIsWorthRisk()) return false;
      // A curtain blocks the caster's own shots too, so it is raised only to hide.
      if (s.rotatableWall) return this.self.hp <= this.self.maxHp * 0.5;
      if (s.targeting === 'enemy') return this.game.isValidSpellTarget(s, this.self, enemy);
      if (s.targeting === 'point') return this.pointSpellCanReach(s, enemy);
      if (s.targeting === 'any' && this.prefersEnemyTarget(s)) {
        return this.game.isValidSpellTarget(s, this.self, enemy);
      }
      if (s.targeting === 'self' || s.targeting === 'ally' || s.targeting === 'any') {
        // Only self-cast defensively when hurt.
        return this.self.hp <= this.self.maxHp * 0.5;
      }
      return true;
    });
    if (options.length === 0) return null;
    const score = (spell: Spell): number => spell.words.length;
    options.sort((a, b) => score(b) - score(a));
    const top = options.filter((spell) => score(spell) === score(options[0]));
    return this.game.rng.pick(top);
  }

  /** Whether aiming this point spell straight at `enemy` can place its footprint over them. */
  private pointSpellCanReach(spell: Spell, enemy: Mage): boolean {
    if (!spell.aoe) return true;
    const distance = dist(this.self.pos, enemy.pos);
    if (spell.aoe.kind === 'cone') return distance <= spell.aoe.radius + 0.5;
    const aimDistance = Math.max(spell.minRange ?? 0, Math.min(spell.range, distance));
    return Math.abs(distance - aimDistance) <= spell.aoe.radius + 0.5;
  }

  private castDecision(spell: Spell, enemy: Mage): AIDecision {
    if (this.isWeaponEnchant(spell)) {
      const target = this.bestEnchantTarget(spell);
      if (target) return { type: 'spell', spell, target };
    }
    if (spell.targeting === 'enemy') return { type: 'spell', spell, target: enemy };
    if (spell.targeting === 'any' && this.prefersEnemyTarget(spell)) {
      return { type: 'spell', spell, target: enemy };
    }
    if (spell.targeting === 'self' || spell.targeting === 'ally' || spell.targeting === 'any')
      return { type: 'spell', spell, target: this.self };
    if (spell.targeting === 'point') {
      const toEnemy = Math.hypot(enemy.pos.x - this.self.pos.x, enemy.pos.y - this.self.pos.y);
      const min = spell.minRange ?? 0;
      if (spell.rotatableWall) {
        // Stand the wall across the line to the foe, halfway there.
        this.self.wallAngle = Math.atan2(enemy.y - this.self.y, enemy.x - this.self.x) + Math.PI / 2;
        const halfway = Math.max(min, Math.min(spell.range, toEnemy / 2));
        return { type: 'spell', spell, point: stepTowards(this.self.pos, enemy.pos, halfway) };
      }
      const reach = Math.max(min, Math.min(spell.range, toEnemy));
      const point = stepTowards(this.self.pos, enemy.pos, reach);
      return { type: 'spell', spell, point };
    }
    return { type: 'spell', spell };
  }

  private isWeaponEnchant(spell: Spell): boolean {
    // Fire Mind and Lightning Mind enchant weapons only in their Objects versions.
    if (spell.id === 'fire+mind@objects' || spell.id === 'lightning+mind@objects') return true;
    return comboKey(spell.words) === 'fire+lightning+mind';
  }

  /** 'Any' spells that only hurt what they touch: a stasis prison, a stopped clock, a sea lift. */
  private prefersEnemyTarget(spell: Spell): boolean {
    const key = comboKey(spell.words);
    return key === 'bind+reality+stop' || key === 'bind+pierce+stop' || key === 'bind+reality+water';
  }

  /** Reactions that protect whoever is being struck rather than hurting the striker. */
  private isProtectiveReaction(spell: Spell): boolean {
    return comboKey(spell.words) === 'bind+stop+veil';
  }

  /**
   * Desecrate only harms the unhallowed. With no such foe on the field its
   * black spells do nothing; Bone Spire's damage is colourless and still lands.
   */
  private desecrationWasted(spell: Spell): boolean {
    if (!spell.words.includes('desecrate') || comboKey(spell.words) === 'desecrate+pierce+shatter') return false;
    return !this.game.mages.some((m) => m.team !== this.self.team && this.game.isDesecrationAffected(m));
  }

  private bestEnchantTarget(spell: Spell): Mage | null {
    const allies = this.game.mages.filter(
      (mage) =>
        mage.team === this.self.team &&
        mage.alive &&
        mage.activeWeaponId() != null &&
        this.game.isValidSpellTarget(spell, this.self, mage)
    );
    allies.sort((a, b) => {
      const aWeapon = a.activeWeapon();
      const bWeapon = b.activeWeapon();
      const aScore = (aWeapon?.multiplier ?? 1) + (aWeapon?.toHit ? 1 : 0);
      const bScore = (bWeapon?.multiplier ?? 1) + (bWeapon?.toHit ? 1 : 0);
      return bScore - aScore;
    });
    return allies[0] ?? null;
  }

  /**
   * A foe hidden only by a glass curtain is still there: a healthy AI walks
   * round the nearer end of the curtain instead of standing idle.
   */
  private detourAroundCurtain(): Vec2 | null {
    if (this.self.hp <= this.self.maxHp * 0.5) return null;
    const foe = this.game
      .livingEnemiesOf(this.self)
      .filter(
        (m) =>
          !this.game.isVeiled(m) &&
          !this.game.isUntargetable(m, this.self, { ignoreStealth: true }) &&
          this.game.sightBlocked(this.self.pos, m.pos)
      )
      .sort((a, b) => dist(this.self.pos, a.pos) - dist(this.self.pos, b.pos))[0];
    if (!foe) return null;
    const curtain = this.game.sightBlockers(this.self.pos, foe.pos)[0];
    if (!curtain) return null;
    const reach = curtain.range / 2 + this.self.bodyRadius() * 2 + 12;
    const [around] = [1, -1]
      .map((side) => ({
        x: curtain.x + Math.cos(curtain.angle) * reach * side,
        y: curtain.y + Math.sin(curtain.angle) * reach * side,
      }))
      .sort(
        (a, b) =>
          dist(this.self.pos, a) + dist(a, foe.pos) - (dist(this.self.pos, b) + dist(b, foe.pos))
      );
    return stepTowards(this.self.pos, around, this.self.moveRange());
  }

  private isIndiscriminateStorm(spell: Spell): boolean {
    const key = comboKey(spell.words);
    return key === 'lightning+veil' || key === 'fire+lightning+veil' || key === 'lightning+mind+veil';
  }

  private stormIsWorthRisk(): boolean {
    if (this.self.hp <= this.self.maxHp * 0.5) return true;
    const nearby = this.game.mages.filter(
      (mage) => mage !== this.self && mage.alive && dist(mage.pos, this.self.pos) <= 6 * RANGE_UNIT
    );
    const allies = nearby.filter((mage) => mage.team === this.self.team).length;
    const enemies = nearby.length - allies;
    return enemies >= allies;
  }

  // ---------------------------------------------------------------------------
  //  TARGETING (shared) — while a Lich commands the undead, they play optimally
  //  and focus-fire the weakest player to secure kills rather than each picking
  //  their own nearest foe. Without a Lich they use the plain nearest-enemy pick.
  // ---------------------------------------------------------------------------

  /** The mage this AI should attack this turn, or null when every foe is veiled. */
  private chooseTarget(): Mage | null {
    if (this.game.hasAliveLich() && this.self.enemyKind) {
      return this.bestKillTarget();
    }
    const foe = this.game.opponentOf(this.self);
    if (foe && !this.game.isUntargetable(foe, this.self)) return foe;
    // The obvious opponent is hidden — fall back to any other foe we can see.
    return this.bestKillTarget();
  }

  /** Living foe with the lowest remaining vitality (focus fire), else nearest. */
  private bestKillTarget(): Mage | null {
    // A veiled foe cannot be seen, so it is never a valid target.
    const foes = this.game.livingEnemiesOf(this.self).filter(
      (mage) => !this.game.isUntargetable(mage, this.self)
    );
    if (foes.length === 0) return null;
    const vitality = (m: Mage): number => m.hp + (m.isImmuneTo('sanity') ? 0 : m.sanity);
    let best = foes[0];
    let bestScore = vitality(best);
    let bestDist = dist(this.self.pos, best.pos);
    for (const f of foes) {
      const score = vitality(f);
      const d = dist(this.self.pos, f.pos);
      if (score < bestScore || (score === bestScore && d < bestDist)) {
        best = f;
        bestScore = score;
        bestDist = d;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  //  LICH — super-intelligent boss. It combines its three death-words (Drain,
  //  Curse, Void) exactly like a player, spending one charge of each word used;
  //  none of its casts roll dice or cost mana, so they always land. It prefers
  //  to strike from range and NOT move (which unlocks its end-step), hoards its
  //  single Void for a kill or an Annihilation, and only falls back on its weak
  //  1d3 ranged bite when it has nothing better — which, being smart, is rare.
  // ---------------------------------------------------------------------------

  private chooseLichAction(): AIDecision {
    const acts = this.self.actions;
    const target = this.bestKillTarget();
    if (!target) return { type: 'end' };

    // Combine words into the best affordable, in-range spell for the moment.
    if (acts.main > 0) {
      const choice = this.chooseLichSpell(target);
      if (choice) {
        for (const w of choice.words) this.lichCharges[w] -= 1;
        return { type: 'power', spell: choice.spell, target };
      }
    }
    // Weak 1d3 ranged bite (its intrinsic 10cm attack) — a true last resort.
    if (acts.main > 0 && this.game.canMelee(this.self, target)) {
      return { type: 'melee', target };
    }
    // Only move when it truly cannot reach a foe with any remaining option; this
    // preserves the "did not move" end-step whenever possible.
    if (acts.move > 0 && !this.lichCanReachAnySpell(target)) {
      const point = stepTowards(this.self.pos, target.pos, this.self.moveRange());
      return { type: 'move', point };
    }
    return { type: 'end' };
  }

  /** Whether any charged Lich spell could reach `target` from here. */
  private lichCanReachAnySpell(target: Mage): boolean {
    const d = dist(this.self.pos, target.pos);
    return LICH_SPELLS.some(
      (s) => s.words.every((w) => this.lichCharges[w] > 0) && d <= s.spell.range
    );
  }

  /** Pick the smartest word-combo to cast on `target`, or null to fall back. */
  private chooseLichSpell(target: Mage): LichSpell | null {
    const d = dist(this.self.pos, target.pos);
    const byId = (id: string): LichSpell => LICH_SPELLS.find((s) => s.id === id)!;
    const ok = (s: LichSpell): boolean =>
      s.words.every((w) => this.lichCharges[w] > 0) && d <= s.spell.range;
    const has = (id: string): boolean => ok(byId(id));

    const foes = this.game.livingEnemiesOf(this.self);
    const wounded = this.self.hp < this.self.maxHp * 0.6;
    const cursed = target.statuses.some(
      (s) => s.key === 'dot:Curse' || s.key === 'debuff:void-curse'
    );
    // A Void play kills if it empties a pool (5/8 true HP, or 3 true sanity).
    const voidLethal =
      target.hp <= 8 || (!target.isImmuneTo('sanity') && target.sanity <= 3);
    const foesInVoidRange = foes.filter(
      (f) => dist(this.self.pos, f.pos) <= LICH_SPELL_RANGE
    ).length;

    // --- VOID (one charge only): spend it for maximum value ---------------
    if (this.lichCharges.void > 0) {
      // Board-wide cataclysm when several foes are caught in it.
      if (has('annihilation') && foesInVoidRange >= 2) return byId('annihilation');
      // Otherwise a Void finisher only when it actually secures the kill.
      if (voidLethal) {
        if (wounded && has('oblivion-siphon')) return byId('oblivion-siphon');
        if (has('void')) return byId('void');
        if (has('oblivion-siphon')) return byId('oblivion-siphon');
        if (has('doom')) return byId('doom');
      }
      // Not a wipe and not a kill: hold Void, use a lesser word below.
    }

    // --- Non-Void plays --------------------------------------------------
    if (wounded && !cursed && has('drain-curse')) return byId('drain-curse');
    if (wounded && has('drain')) return byId('drain');
    if (!cursed && has('curse')) return byId('curse');
    if (has('drain')) return byId('drain'); // chip damage + self-heal

    // Drain and Curse are spent: stop hoarding and unleash the Void now.
    if (this.lichCharges.drain <= 0 && this.lichCharges.curse <= 0 && this.lichCharges.void > 0) {
      if (has('annihilation') && foesInVoidRange >= 2) return byId('annihilation');
      if (has('oblivion-siphon')) return byId('oblivion-siphon');
      if (has('void')) return byId('void');
      if (has('doom')) return byId('doom');
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  //  GHAST — an elite kiter. It never wants to be near you: if a foe closes in
  //  it shoves them away, otherwise it telegraphs a delayed shadow zone on the
  //  nearest cluster, then always retreats at full speed.
  // ---------------------------------------------------------------------------
  private chooseGhastAction(): AIDecision {
    const acts = this.self.actions;
    const foes = this.game.livingEnemiesOf(this.self);
    if (foes.length === 0) return { type: 'end' };
    const target = this.nearestOf(foes);
    const d = dist(this.self.pos, target.pos);
    const shoveRange = 8 * RANGE_UNIT;
    const markRange = 20 * RANGE_UNIT;

    if (acts.main > 0) {
      // A foe is in melee range: shove it away to reopen the gap.
      if (d <= shoveRange) return { type: 'ghast-shove', target };
      // Otherwise telegraph a shadow burst on the nearest foe (once at a time).
      if (!this.self.ghastPendingZone && d <= markRange) {
        return { type: 'ghast-mark', point: { x: target.pos.x, y: target.pos.y } };
      }
    }
    // Always retreat: run directly away from the nearest foe at full speed.
    if (acts.move > 0) {
      const away = this.awayPoint(target.pos, this.self.moveRange());
      if (dist(away, this.self.pos) > 4) return { type: 'move', point: away };
    }
    return { type: 'end' };
  }

  // ---------------------------------------------------------------------------
  //  REAPER — a boss beyond the Lich. It closes on the lowest-vitality foe
  //  (its leash forbids them fleeing far), brushes them to Mark them, and once
  //  it holds a mark it cannot extend, it channels — the clap then deletes every
  //  marked foe at the start of its next turn.
  // ---------------------------------------------------------------------------
  private chooseReaperAction(): AIDecision {
    // Mid-channel: the whole turn is spent (the clap fires at next turn start).
    if (this.self.reaperChanneling) return { type: 'end' };

    const acts = this.self.actions;
    const foes = this.game.livingEnemiesOf(this.self);
    if (foes.length === 0) return { type: 'end' };
    const markRange = this.self.intrinsicMeleeReach ?? 4 * RANGE_UNIT;
    const markedByMe = foes.filter((f) => f.reaperMarkedBy === this.self);
    const unmarked = foes.filter((f) => f.reaperMarkedBy !== this.self);

    // 1. Brush an unmarked foe in reach — the mark is unpreventable.
    if (acts.main > 0) {
      const inReach = unmarked.find((f) => dist(this.self.pos, f.pos) <= markRange);
      if (inReach) return { type: 'reaper-mark', target: inReach };
    }
    // 2. Hold marks and cannot reach anyone fresh this turn → channel the clap.
    if (acts.main > 0 && markedByMe.length > 0) {
      const reach = markRange + this.self.moveRange();
      const canReachFresh = unmarked.some((f) => dist(this.self.pos, f.pos) <= reach);
      if (unmarked.length === 0 || !canReachFresh) return { type: 'reaper-channel' };
    }
    // 3. Stalk toward the nearest unmarked foe (else the lowest-vitality foe).
    if (acts.move > 0) {
      const chase = unmarked.length > 0 ? this.nearestOf(unmarked) : this.bestKillTarget() ?? foes[0];
      if (dist(this.self.pos, chase.pos) > markRange * 0.8) {
        return { type: 'move', point: stepTowards(this.self.pos, chase.pos, this.self.moveRange()) };
      }
    }
    // 4. Nothing else to do but we hold a mark → channel.
    if (acts.main > 0 && markedByMe.length > 0) return { type: 'reaper-channel' };
    return { type: 'end' };
  }

  /** Nearest mage to this AI from a list (assumes non-empty). */
  private nearestOf(list: Mage[]): Mage {
    let best = list[0];
    let bestD = dist(this.self.pos, best.pos);
    for (const m of list) {
      const d = dist(this.self.pos, m.pos);
      if (d < bestD) {
        best = m;
        bestD = d;
      }
    }
    return best;
  }

  /** A point `range` px directly away from `from`, relative to this AI's spot. */
  private awayPoint(from: Vec2, range: number): Vec2 {
    const dx = this.self.pos.x - from.x;
    const dy = this.self.pos.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: this.self.pos.x + (dx / len) * range, y: this.self.pos.y + (dy / len) * range };
  }
}
