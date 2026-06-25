import type { GameState } from '../core/GameState';
import type { Mage } from '../core/Mage';
import type { Spell } from '../spells/Spell';
import { allSpells } from '../spells/registry';
import { dist, stepTowards, type Vec2 } from '../core/utils';
import { MELEE_RANGE } from '../config/constants';

export type AIDecision =
  | { type: 'move'; point: Vec2 }
  | { type: 'melee'; target: Mage }
  | { type: 'spell'; spell: Spell; target?: Mage; point?: Vec2 }
  | { type: 'end' };

export interface AIReaction {
  spell: Spell;
  target?: Mage;
  point?: Vec2;
}

/** A deliberately small, readable opponent. Tweak the heuristics freely. */
export class SimpleAI {
  constructor(private game: GameState, private self: Mage) {}

  private castableSpells(action: 'main' | 'bonus'): Spell[] {
    const set = new Set(this.self.loadout);
    const forgotten = this.self.forgotten();
    return allSpells().filter(
      (s) =>
        s.actionType === action &&
        s.words.every((w) => set.has(w)) &&
        !s.words.some((w) => forgotten.includes(w)) &&
        this.self.hasCharges(s.words)
    );
  }

  /** Pick the next action for the AI's turn, or end the turn. */
  chooseAction(): AIDecision {
    const enemy = this.game.opponentOf(this.self);
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
    const reactions = allSpells().filter(
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
    const selfBuff = reactions.find((s) => s.targeting === 'self');
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
      if (s.targeting === 'self' || s.targeting === 'ally') {
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
    if (spell.targeting === 'self' || spell.targeting === 'ally')
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
}
