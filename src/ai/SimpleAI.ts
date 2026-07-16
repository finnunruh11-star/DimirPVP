import type { GameState } from '../core/GameState';
import type { Mage } from '../core/Mage';
import type { Spell } from '../spells/Spell';
import { allSpells } from '../spells/registry';
import { dist, stepTowards, type Vec2 } from '../core/utils';
import type { Scarab } from '../core/Scarab';
import { MELEE_RANGE, RANGE_UNIT } from '../config/constants';
import {
  LICH_SPELLS,
  LICH_SPELL_RANGE,
  freshLichCharges,
  type LichWord,
  type LichSpell,
} from '../pve/lichPowers';

export type AIDecision =
  | { type: 'move'; point: Vec2 }
  | { type: 'melee'; target: Mage }
  // Swat a harassing enemy scarab that is latched onto or beside us.
  | { type: 'scarab'; scarab: Scarab }
  | { type: 'spell'; spell: Spell; target?: Mage; point?: Vec2 }
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
    return allSpells(this.self.mageClass).filter(
      (s) =>
        s.actionType === action &&
        s.words.every((w) => set.has(w)) &&
        !s.words.some((w) => forgotten.includes(w)) &&
        this.self.hasCharges(s.words)
    );
  }

  /** Pick the next action for the AI's turn, or end the turn. */
  chooseAction(): AIDecision {
    // The Lich runs its own smart routine (bespoke powers, stays put to unlock
    // its end-step, secures kills). Every other undead falls through to the
    // shared logic below — but plays optimally while a Lich commands them.
    if (this.self.enemyKind === 'lich') return this.chooseLichAction();
    if (this.self.reaperKind) return this.chooseReaperAction();
    if (this.self.ghastKind) return this.chooseGhastAction();

    const enemy = this.chooseTarget();
    const acts = this.self.actions;

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
  chooseReaction(topSourceIsEnemy: boolean): AIReaction | null {
    if (!this.self.hasReaction()) return null;
    if (!topSourceIsEnemy) return null;
    const enemy = this.game.opponentOf(this.self);
    const set = new Set(this.self.loadout);
    const forgotten = this.self.forgotten();
    // With a reaction word the AI may answer with ANY castable spell.
    const grants = this.self.grantsReaction;
    const reactions = allSpells(this.self.mageClass).filter(
      (s) =>
        this.self.hasCharges(s.words) &&
        s.words.every((w) => set.has(w)) &&
        !s.words.some((w) => forgotten.includes(w)) &&
        (grants || s.reaction)
    );
    if (reactions.length === 0) return null;

    // Prefer a counter (e.g. Bind Pierce) when low, otherwise hide (Veil).
    const counter = reactions.find((s) => s.counters);
    if (counter && this.game.isValidSpellTarget(counter, this.self, enemy) && this.game.rng.chance(0.6)) {
      if (counter.targeting === 'point') {
        const reach = Number.isFinite(counter.range) ? counter.range : this.self.moveRange();
        return { spell: counter, point: stepTowards(this.self.pos, enemy.pos, reach) };
      }
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

  private bestOffensiveSpell(action: 'main' | 'bonus', enemy: Mage): Spell | null {
    const options = this.castableSpells(action).filter((s) => {
      if (s.targeting === 'enemy') return this.game.isValidSpellTarget(s, this.self, enemy);
      if (s.targeting === 'point') return true;
      if (s.targeting === 'self' || s.targeting === 'ally' || s.targeting === 'any') {
        // Only self-cast defensively when hurt.
        return this.self.hp <= this.self.maxHp * 0.5;
      }
      return true;
    });
    if (options.length === 0) return null;
    // Prefer more words (bigger combos) for variety, then random.
    options.sort((a, b) => b.words.length - a.words.length);
    const top = options.filter((s) => s.words.length === options[0].words.length);
    return this.game.rng.pick(top);
  }

  private castDecision(spell: Spell, enemy: Mage): AIDecision {
    if (spell.targeting === 'enemy') return { type: 'spell', spell, target: enemy };
    if (spell.targeting === 'self' || spell.targeting === 'ally' || spell.targeting === 'any')
      return { type: 'spell', spell, target: this.self };
    if (spell.targeting === 'point') {
      const toEnemy = Math.hypot(enemy.pos.x - this.self.pos.x, enemy.pos.y - this.self.pos.y);
      const min = spell.minRange ?? 0;
      const reach = Math.max(min, Math.min(spell.range, toEnemy));
      const point = stepTowards(this.self.pos, enemy.pos, reach);
      return { type: 'spell', spell, point };
    }
    return { type: 'spell', spell };
  }

  // ---------------------------------------------------------------------------
  //  TARGETING (shared) — while a Lich commands the undead, they play optimally
  //  and focus-fire the weakest player to secure kills rather than each picking
  //  their own nearest foe. Without a Lich they use the plain nearest-enemy pick.
  // ---------------------------------------------------------------------------

  /** The mage this AI should attack this turn. */
  private chooseTarget(): Mage {
    if (this.game.hasAliveLich() && this.self.enemyKind) {
      return this.bestKillTarget() ?? this.game.opponentOf(this.self);
    }
    return this.game.opponentOf(this.self);
  }

  /** Living foe with the lowest remaining vitality (focus fire), else nearest. */
  private bestKillTarget(): Mage | null {
    const foes = this.game.livingEnemiesOf(this.self);
    if (foes.length === 0) return null;
    const vitality = (m: Mage): number => m.hp + (m.sanityImmune ? 0 : m.sanity);
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
      target.hp <= 8 || (!target.sanityImmune && target.sanity <= 3);
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
