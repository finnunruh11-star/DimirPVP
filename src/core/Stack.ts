import type { Mage } from './Mage';
import type { Spell } from '../spells/Spell';
import type { Vec2 } from './utils';
import type { GameState } from './GameState';
import type { ItemId } from './Items';
import type { WordId } from './Words';

export type StackKind = 'move' | 'melee' | 'spell' | 'action';

/** A spell held for a later turn by the Channel or Delay modifier. */
export interface PendingCast {
  spell: Spell;
  target: Mage | null;
  point: Vec2 | null;
  point2: Vec2 | null;
  modifiers: WordId[];
}

/**
 * What a Needle of Serenity permanently disables if it stifles an `action`
 * stack item: either a specific item (all copies) or a named ability.
 */
export type NeedleBan =
  | { kind: 'item'; itemId: ItemId }
  | { kind: 'ability'; key: string; label: string };

/**
 * A single action waiting to resolve on the stack. Items resolve last-in,
 * first-out (like Magic: the Gathering). `resolve` performs the effect and
 * `isStillValid` is checked first so spells fizzle if their target vanished.
 */
export interface StackItem {
  id: number;
  kind: StackKind;
  source: Mage;
  label: string;
  description: string;

  spell?: Spell;
  target?: Mage;
  targetPoint?: Vec2;
  /** A second aimed point, chosen up-front for two-point spells (Reality Shatter). */
  targetPoint2?: Vec2;
  /** An action-kind item that is an attack and should allow physical reactions. */
  hostileAttack?: boolean;
  /** Optional generic visual cue for a resolving action-kind item. */
  actionVisual?: 'fire' | 'shatter' | 'shadow' | 'lightning' | 'lightningImpact' | 'heal' | 'corrosive' | 'wake';

  /** For `action` items: what a Needle of Serenity would ban if it stifles this. */
  needleBan?: NeedleBan;

  /**
   * If true, purely defensive physical reactions (Dodge / Block / shield-Bash)
   * are not offered against this item — used for triggers that aren't attacks,
   * such as an end-of-turn window or a blink step.
   */
  noPhysicalReaction?: boolean;
  /** This trigger exceptionally permits the active mage to answer it. */
  allowCurrentReaction?: boolean;
  /** Modifier words attached to this cast (Subtle / Delay / Channel). */
  modifiers?: WordId[];
  /** A silent cast: nobody may react to it at all. */
  silent?: boolean;

  /** If this item is a reaction, the id of the item it was cast in response to. */
  respondingTo?: number;
  /** If true and respondingTo is still on the stack, remove it on resolve. */
  counters?: boolean;

  resolve: (game: GameState) => void | Promise<void>;
  isStillValid: (game: GameState) => boolean;
}
