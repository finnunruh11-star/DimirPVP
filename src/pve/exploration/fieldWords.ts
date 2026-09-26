// Words spoken outside a fight. Up to two of the leader's own words combine
// as they would in one, for the same charges and mana. Veil hides the party,
// Bind slows packs, Mind shows what packs see and where they are headed, and
// Heal mends the party. Any other spell works only if it is a straight attack:
// it opens a fight on its target with a free strike. Pure: no Phaser.

import { RANGE_UNIT } from '../../config/constants';
import type { MageClass } from '../../core/Classes';
import { wordSpellMana } from '../../core/Colors';
import { GameState } from '../../core/GameState';
import type { ItemId } from '../../core/Items';
import { Mage } from '../../core/Mage';
import type { WordId } from '../../core/Words';
import type { Spell } from '../../spells/Spell';

export type FieldEffect = 'veil' | 'bind' | 'mind' | 'heal';

export interface FieldRule {
  effect: FieldEffect;
  /** Reach in tiles; 0 works on yourself. */
  range: number;
  /** How long the effect lasts, in milliseconds (0 = at once). */
  ms: number;
}

/** Words that do something of their own when spoken alone outside a fight. */
export const FIELD_RULES: Partial<Record<WordId, FieldRule>> = {
  veil: { effect: 'veil', range: 0, ms: 30_000 },
  bind: { effect: 'bind', range: 6, ms: 15_000 },
  mind: { effect: 'mind', range: 16, ms: 30_000 },
  heal: { effect: 'heal', range: 0, ms: 0 },
};

/** Most words one spell may combine outside a fight. */
export const MAX_FIELD_WORDS = 2;
/** A pack's sight while you are veiled, as a share of its usual sight. */
export const VEIL_SIGHT = 0.35;
/** A pack's sight while you sneak, and your pace while you do. */
export const SNEAK_SIGHT = 0.4;
export const SNEAK_SPEED = 0.5;
/** A bound pack's speed, as a share of its usual speed. */
export const BIND_SPEED = 0.35;
/** No ambush reaches further than this, in tiles. */
export const AMBUSH_MAX_TILES = 10;
/** A melee ambush needs you this close, in tiles. */
export const MELEE_AMBUSH_TILES = 2;

/** Combat reach in pixels, as tiles on a walkable map. */
export function reachTiles(px: number): number {
  return Math.max(1, Math.min(AMBUSH_MAX_TILES, px / RANGE_UNIT));
}

/** Hit points a field Heal restores: 1d6 plus Intellect. */
export function fieldHealAmount(d6: number, intellect: number): number {
  return Math.max(1, d6 + Math.max(0, intellect));
}

/** Every spell a rack offers outside a fight: each word alone, then each pair. */
export function fieldCombos(words: readonly WordId[]): WordId[][] {
  const combos: WordId[][] = words.map((word) => [word]);
  for (let i = 0; i < words.length; i++) for (let j = i + 1; j < words.length; j++) combos.push([words[i], words[j]]);
  return combos;
}

/** Mana a spell of `words` costs this mage, as the same cast would in a fight. */
export function fieldSpellMana(mage: Mage, words: readonly WordId[]): number {
  let mana = wordSpellMana([...words], mage.profile);
  if (mage.hands.includes('mutivargRod' as ItemId)) mana *= 2;
  return Math.max(0, mana - mage.manaDiscountSum());
}

/** Afflictions that hurt their bearer, which count as a hit. */
const HARMS: ReadonlySet<string> = new Set(['dot', 'reap', 'deathCurse', 'fire', 'sentinelFire', 'blueflare', 'soulRend', 'woundShade']);
const verdicts = new Map<string, Promise<boolean>>();

/**
 * Whether a spell is a straight attack: aimed at one foe, it hurts that foe and
 * does nothing a fight would have to settle. It is cast once on a dummy to find
 * out; a spell that moves the caster, asks for another aim, or calls something
 * up is not one, nor is one that leaves the dummy unhurt. Cached per spell.
 */
export function isStraightAttack(spell: Spell, mageClass: MageClass): Promise<boolean> {
  const key = `${mageClass}:${spell.id}`;
  let verdict = verdicts.get(key);
  if (!verdict) {
    verdict = trySpell(spell, mageClass).catch(() => false);
    verdicts.set(key, verdict);
  }
  return verdict;
}

async function trySpell(spell: Spell, mageClass: MageClass): Promise<boolean> {
  if (spell.targeting !== 'enemy' && spell.targeting !== 'point' && spell.targeting !== 'any') return false;
  if (spell.twoPointAim || spell.rotatableWall || spell.minStackDepth || spell.delaysStackItem || spell.nullifiesStack) return false;
  const caster = new Mage({ name: 'Caster', isAI: true, team: 1, position: { x: 400, y: 240 }, loadout: [...spell.words], mageClass });
  caster.assignFlatStats(3);
  const far = Number.isFinite(spell.range) ? spell.range : 400;
  const gap = Math.max((spell.minRange ?? 0) + 6, Math.min(far * 0.8, far - 6, 400));
  const mark = new Mage({ name: 'Mark', isAI: true, team: 2, position: { x: 400 + gap, y: 240 }, loadout: [] });
  mark.maxHp = 999;
  mark.hp = 999;
  mark.maxSanity = 999;
  mark.sanity = 999;
  const game = new GameState([caster, mark], 1);
  let asked = false;
  const ask = async <T>(answer: T): Promise<T> => {
    asked = true;
    return answer;
  };
  game.subTargeter = {
    requestPoint: () => ask(null),
    requestEnemy: () => ask(null),
    requestCombatant: () => ask(null),
    requestReroll: () => ask(false),
    reactionWindow: async () => {},
    resolveImpacts: async () => {},
  };
  // Lightning takes its reach from the cast roll; give it an ordinary one.
  game.spellRollThisCast = 15;
  const atPoint = spell.targeting === 'point';
  if (!game.canCastSpellNow(spell) || (!atPoint && !game.isValidSpellTarget(spell, caster, mark))) return false;
  const from = { x: caster.x, y: caster.y };
  const before = { hp: mark.hp, sanity: mark.sanity, bodies: game.mages.length, scarabs: game.scarabs.length };
  await game.makeSpellItem(caster, spell, atPoint ? null : mark, atPoint ? { x: mark.x, y: mark.y } : null).resolve(game);
  if (asked || Math.hypot(caster.x - from.x, caster.y - from.y) > 1) return false;
  if (game.mages.length !== before.bodies || game.scarabs.length !== before.scarabs) return false;
  return mark.hp < before.hp || mark.sanity < before.sanity || mark.statuses.some((status) => HARMS.has(status.kind));
}
