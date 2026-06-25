import type { Mage } from './Mage';
import type { Spell } from '../spells/Spell';
import type { Vec2 } from './utils';
import type { GameState } from './GameState';

export type StackKind = 'move' | 'melee' | 'spell';

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

  /** If this item is a reaction, the id of the item it was cast in response to. */
  respondingTo?: number;
  /** If true and respondingTo is still on the stack, remove it on resolve. */
  counters?: boolean;

  resolve: (game: GameState) => void | Promise<void>;
  isStillValid: (game: GameState) => boolean;
}
