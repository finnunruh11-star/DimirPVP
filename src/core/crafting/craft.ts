// The bench's arithmetic. A design's materials and the mana paid into it, plus
// two d20 (the higher counts; a pair counts 26, a natural 20 counts 22), make its
// score; the score's power level is a budget of effect ranks, spent at random on
// the effects its materials could lend it. Pure: the economy rolls with run dice.

import type { Dice } from '../Dice';
import { getItem, type ItemDef, type ItemId } from '../Items';
import {
  CRAFT_EFFECTS,
  CRAFT_TEMPLATES,
  craftEffect,
  craftRoll,
  craftSize,
  isCraftTemplate,
  MAX_CRAFT_MANA,
  powerLevel,
  type CraftEffectId,
  type CraftForm,
  type CraftMode,
  type PowerLevel,
} from './data';
import { craftMaterial, type CraftDesign, type CraftSpec } from './item';

/** What the materials of a design add to its score. */
export function materialsValue(design: Pick<CraftDesign, 'parts' | 'sockets'>): number {
  return [...design.parts, ...design.sockets].reduce((sum, id) => sum + (craftMaterial(id)?.value ?? 0), 0);
}

export interface CraftScore {
  materials: number;
  mana: number;
  /** What the dice counted for. */
  roll: number;
  total: number;
}

export function craftScore(design: Pick<CraftDesign, 'parts' | 'sockets' | 'mana'>, dice: readonly [number, number]): CraftScore {
  const materials = materialsValue(design);
  const roll = craftRoll(dice[0], dice[1]);
  return { materials, mana: design.mana, roll, total: materials + design.mana + roll };
}

/** Every result two d20 can count for. */
export const POSSIBLE_ROLLS: readonly number[] = [...Array.from({ length: 19 }, (_, i) => i + 1), 22, 26];

/** The lowest dice result that lifts `base` (materials + mana) to `level`; null when no roll can. */
export function rollNeeded(base: number, level: PowerLevel): number | null {
  const need = Math.max(1, level.min - base);
  for (const roll of POSSIBLE_ROLLS) if (roll >= need) return roll;
  return null;
}

/** The chance that two d20 count for `need` or more. */
export function rollChance(need: number): number {
  let hits = 0;
  for (let a = 1; a <= 20; a++) for (let b = 1; b <= 20; b++) if (craftRoll(a, b) >= need) hits += 1;
  return hits / 400;
}

const itemName = (id: ItemId): string => (getItem(id) as ItemDef | undefined)?.name ?? id;

/** Why this design cannot go on the bench, or null when it can. */
export function designProblem(design: CraftDesign): string | null {
  if (!isCraftTemplate(design.template)) return 'Pick a template.';
  const template = CRAFT_TEMPLATES[design.template];
  const size = craftSize(design.template, design.form);
  if (!size) return 'Pick a size.';
  if (design.parts.length !== template.parts.length) return 'Every part needs a material.';
  for (const [index, id] of design.parts.entries()) {
    if (craftMaterial(id)?.slot !== 'material') return `${template.parts[index]}: ${itemName(id)} is not a part material.`;
  }
  if (design.sockets.length > size.sockets) {
    return `A ${size.label.toLowerCase()} holds ${size.sockets} focus piece${size.sockets === 1 ? '' : 's'}.`;
  }
  for (const id of design.sockets) {
    if (craftMaterial(id)?.slot !== 'focus') return `${itemName(id)} cannot be set in a socket.`;
  }
  if (!Number.isInteger(design.mana) || design.mana < 0 || design.mana > MAX_CRAFT_MANA) return `Pay 0 to ${MAX_CRAFT_MANA} mana.`;
  return null;
}

export function effectFits(id: CraftEffectId, mode: CraftMode, form: CraftForm): boolean {
  const effect = craftEffect(id);
  return effect.modes.includes(mode) && (!effect.forms || effect.forms.includes(form));
}

export interface PoolEntry {
  id: CraftEffectId;
  /** How many of the design's materials bring it, each counted by its lean. */
  weight: number;
}

/** What the design's materials could lend it, as its form can carry. */
export function effectPool(design: Pick<CraftDesign, 'template' | 'form' | 'parts' | 'sockets'>): PoolEntry[] {
  const size = craftSize(design.template, design.form);
  if (!size) return [];
  const weights = new Map<CraftEffectId, number>();
  for (const id of [...design.parts, ...design.sockets]) {
    const material = craftMaterial(id);
    for (const effect of material?.effects ?? []) {
      if (effectFits(effect, size.mode, size.form)) weights.set(effect, (weights.get(effect) ?? 0) + (material?.lean ?? 1));
    }
  }
  return [...weights].map(([id, weight]) => ({ id, weight }));
}

/** Draw effects at random, the commoner in the materials the likelier, until the level's budget or count runs out. */
export function pickEffects(pool: readonly PoolEntry[], level: PowerLevel, dice: Dice): CraftEffectId[] {
  const picked: CraftEffectId[] = [];
  let budget = level.budget;
  while (picked.length < level.maxEffects) {
    const open = pool.filter((entry) => !picked.includes(entry.id) && CRAFT_EFFECTS[entry.id].rank <= budget);
    if (open.length === 0) break;
    let draw = dice.float() * open.reduce((sum, entry) => sum + entry.weight, 0);
    let chosen = open[open.length - 1];
    for (const entry of open) {
      draw -= entry.weight;
      if (draw < 0) {
        chosen = entry;
        break;
      }
    }
    picked.push(chosen.id);
    budget -= CRAFT_EFFECTS[chosen.id].rank;
  }
  return picked;
}

/** Put a design on the bench: two d20, its score, and the effects it draws. */
export function rollCraft(design: CraftDesign, dice: Dice): CraftSpec {
  const rolled: [number, number] = [dice.die(20), dice.die(20)];
  const score = craftScore(design, rolled).total;
  return {
    template: design.template,
    form: design.form,
    parts: [...design.parts],
    sockets: [...design.sockets],
    mana: design.mana,
    dice: rolled,
    score,
    effects: pickEffects(effectPool(design), powerLevel(score), dice),
  };
}
