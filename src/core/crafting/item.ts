// A crafted item is its own id. The template, the form, the materials, the mana,
// the dice, the score and the effects are all spelled out in it, so it travels
// through saves, party snapshots and the wire like any catalogue id, and every
// client rebuilds the same item from it. Items.getItem resolves these ids here.

import { MELEE_RANGE, RANGE_UNIT } from '../../config/constants';
import type { DamageType } from '../Damage';
import { getItem, type ItemDef, type ItemId } from '../Items';
import {
  CRAFT_MATERIALS,
  CRAFT_TEMPLATES,
  craftEffect,
  craftRoll,
  craftSize,
  isCraftEffect,
  isCraftTemplate,
  MAX_CRAFT_MANA,
  powerLevel,
  type CraftContext,
  type CraftEffectId,
  type CraftForm,
  type CraftMaterial,
  type CraftMode,
  type CraftTemplateId,
  type PowerLevel,
} from './data';

const U = RANGE_UNIT;
const round2 = (value: number): number => Math.round(value * 100) / 100;

export const CRAFT_PREFIX = 'craft:';

export interface CraftDesign {
  template: CraftTemplateId;
  form: CraftForm;
  /** One material per template part, in order. */
  parts: ItemId[];
  /** Focus pieces set in the sockets, up to the form's count. */
  sockets: ItemId[];
  /** Mana paid into it, 0..10. */
  mana: number;
}

/** A design as it came off the bench: the dice it rolled, its score and the effects it drew. */
export interface CraftSpec extends CraftDesign {
  dice: [number, number];
  score: number;
  effects: CraftEffectId[];
}

/** Everything a crafted item remembers of its making. */
export interface CraftedInfo extends CraftSpec {
  /** What the dice counted for. */
  roll: number;
  level: PowerLevel;
  mode: CraftMode;
  element: DamageType;
}

// -----------------------------------------------------------------------------
//  MATERIALS
// -----------------------------------------------------------------------------

/** What a material is worth on the bench when nobody has said: more for dearer things. */
function defaultValue(silver: number): number {
  return Math.max(1, Math.round(Math.sqrt(Math.max(0, silver) / 10) * 3));
}

/** How `id` serves at the bench, or null when it cannot be worked (gear, tools, unknown). */
export function craftMaterial(id: ItemId): CraftMaterial | null {
  if (isCraftedItemId(id)) return null;
  const def = getItem(id) as ItemDef | undefined;
  if (!def?.material || def.tool) return null;
  return CRAFT_MATERIALS[id] ?? { slot: def.materialKind ? 'focus' : 'material', value: defaultValue(def.cost), effects: [] };
}

const DEFAULT_ELEMENT: Record<CraftForm, DamageType> = {
  dagger: 'pierce',
  sword: 'slashing',
  greatsword: 'slashing',
  wand: 'shatter',
  staff: 'shatter',
  shortbow: 'pierce',
  longbow: 'pierce',
  jerkin: 'slashing',
  mail: 'slashing',
  plate: 'slashing',
};

/** The element a design carries: its first socket that has one, else its parts, else its form's own. */
export function craftElement(design: Pick<CraftDesign, 'form' | 'parts' | 'sockets'>): DamageType {
  for (const id of [...design.sockets, ...design.parts]) {
    const element = craftMaterial(id)?.element;
    if (element) return element;
  }
  return DEFAULT_ELEMENT[design.form];
}

/** "Iron" for Iron Ore, "Red Drake" for a Red Drake Scale. */
export function craftWord(id: ItemId): string {
  const word = CRAFT_MATERIALS[id]?.word;
  if (word) return word;
  const name = (getItem(id) as ItemDef | undefined)?.name ?? 'Strange';
  return name.replace(/\s+(Ore|Bar|Pelt|Hide|Scale|Core|Lens|Eye|Fang|Tusk|Gel|Essence|Stone|Membrane|Geode|Trinket)$/i, '');
}

// -----------------------------------------------------------------------------
//  THE ID
// -----------------------------------------------------------------------------

export function isCraftedItemId(id: string): boolean {
  return id.startsWith(CRAFT_PREFIX);
}

/** `craft:<template>:<form>:<parts>:<sockets>:<mana>:<d1>-<d2>:<score>:<effects>`. */
export function craftItemId(spec: CraftSpec): ItemId {
  const fields = [
    spec.template,
    spec.form,
    spec.parts.join(','),
    spec.sockets.join(','),
    spec.mana,
    `${spec.dice[0]}-${spec.dice[1]}`,
    spec.score,
    spec.effects.join(','),
  ];
  return `${CRAFT_PREFIX}${fields.join(':')}` as ItemId;
}

const MAX_ID_LENGTH = 600;
const MAX_EFFECTS = 8;
const PATTERN = /^craft:([a-z]+):([a-z]+):([A-Za-z0-9,]*):([A-Za-z0-9,]*):(\d{1,2}):(\d{1,2})-(\d{1,2}):(\d{1,3}):([A-Za-z0-9,]*)$/;
/** A material id as the catalogue spells them; one the catalogue has since lost still reads. */
const TOKEN = /^[A-Za-z][A-Za-z0-9]{0,39}$/;

const list = (raw: string): string[] => (raw ? raw.split(',') : []);

/** Read a crafted id back into its spec. Anything malformed is null: the id comes from saves and the wire. */
export function parseCraftedId(id: string): CraftSpec | null {
  if (id.length > MAX_ID_LENGTH) return null;
  const match = PATTERN.exec(id);
  if (!match) return null;
  const [, template, form, partsRaw, socketsRaw, manaRaw, d1Raw, d2Raw, scoreRaw, effectsRaw] = match;
  if (!isCraftTemplate(template)) return null;
  const size = craftSize(template, form);
  if (!size) return null;
  const parts = list(partsRaw);
  const sockets = list(socketsRaw);
  if (parts.length !== CRAFT_TEMPLATES[template].parts.length || sockets.length > size.sockets) return null;
  if (![...parts, ...sockets].every((token) => TOKEN.test(token))) return null;
  const mana = Number(manaRaw);
  const dice: [number, number] = [Number(d1Raw), Number(d2Raw)];
  if (mana > MAX_CRAFT_MANA || dice.some((d) => d < 1 || d > 20)) return null;
  const effects = [...new Set(list(effectsRaw).filter(isCraftEffect))].slice(0, MAX_EFFECTS);
  return {
    template,
    form: size.form,
    parts: parts as ItemId[],
    sockets: sockets as ItemId[],
    mana,
    dice,
    score: Number(scoreRaw),
    effects,
  };
}

// -----------------------------------------------------------------------------
//  THE ITEM
// -----------------------------------------------------------------------------

const BOLT_SIDES = [4, 6, 6, 8, 8, 10];

/** What a form is before any effect: slot, weight, and how it fights or guards. */
function baseItem(form: CraftForm, level: number, element: DamageType): Pick<ItemDef, 'slot' | 'weight'> & Partial<ItemDef> {
  switch (form) {
    case 'dagger':
      return { slot: 'hand', weight: 1, weapon: { rangePx: MELEE_RANGE, kind: 'dex', dexBonus: 3 + level, damageType: 'pierce' } };
    case 'sword':
      return { slot: 'hand', weight: 2, weapon: { rangePx: MELEE_RANGE, kind: 'strength', multiplier: round2(1 + 0.1 * level), damageType: 'slashing' } };
    case 'greatsword':
      return {
        slot: 'hand',
        weight: 4,
        twoHanded: true,
        weapon: { rangePx: MELEE_RANGE + U, kind: 'strength', multiplier: round2(1.4 + 0.15 * level), damageType: 'slashing' },
      };
    case 'wand':
      return {
        slot: 'hand',
        weight: 0.5,
        isWand: true,
        staffBolts: [{ label: 'Bolt', mana: 3, sides: BOLT_SIDES[level - 1] ?? 6, type: element, rangePx: (8 + level) * U }],
      };
    case 'staff':
      return { slot: 'hand', weight: 1.5, isWand: true, castThrough: { damageMult: round2(1 + 0.05 * level) } };
    case 'shortbow':
      return {
        slot: 'hand',
        weight: 1,
        weaponFamily: 'bow',
        weapon: {
          rangePx: 12 * U,
          kind: 'dex',
          dexBonus: level - 1,
          usesArrows: true,
          damageType: 'pierce',
          rangeAccuracy: { autoWithin: 8 * U, maxRange: 12 * U, farChance: 0.6 },
        },
      };
    case 'longbow':
      return {
        slot: 'hand',
        weight: 2,
        twoHanded: true,
        weaponFamily: 'bow',
        weapon: {
          rangePx: 20 * U,
          kind: 'dex',
          dexBonus: 1 + level,
          usesArrows: true,
          damageType: 'pierce',
          rangeAccuracy: { autoWithin: 12 * U, maxRange: 20 * U, farChance: 0.5 },
        },
      };
    case 'jerkin':
      return { slot: 'torso', weight: 2, armor: { flat: 1, magicFlat: level >= 4 ? 1 : 0 } };
    case 'mail':
      return { slot: 'torso', weight: 5, armor: { flat: level >= 5 ? 3 : 2 }, moveMult: 0.95 };
    case 'plate':
      return { slot: 'torso', weight: 8, armor: { flat: level >= 4 ? 4 : 3, magicFlat: level >= 6 ? 1 : 0 }, moveMult: 0.85 };
  }
}

/** The opening line of a crafted item's blurb, from its form before any effect. */
function baseLine(form: CraftForm, base: Partial<ItemDef>): string {
  const w = base.weapon;
  const armor = base.armor;
  const move = base.moveMult != null && base.moveMult < 1 ? ` -${Math.round((1 - base.moveMult) * 100)}% move.` : '';
  const pct = (m: number | undefined): number => Math.round((m ?? 1) * 100);
  switch (form) {
    case 'dagger':
      return `Crafted dagger. Dex attack +${w?.dexBonus ?? 0}, pierce.`;
    case 'sword':
      return `Crafted sword. ${pct(w?.multiplier)}% Strength slashing.`;
    case 'greatsword':
      return `Crafted greatsword. Two-handed, ${pct(w?.multiplier)}% Strength slashing, +1cm reach.`;
    case 'wand': {
      const b = base.staffBolts?.[0];
      return `Crafted wand. Main action, ${b?.mana ?? 3} mana: Xd${b?.sides ?? 6} ${b?.type ?? 'shatter'} to one foe within ${Math.round((b?.rangePx ?? 0) / U)}cm. X = 1 + Int/10.`;
    }
    case 'staff':
      return `Crafted staff. Spells cast through it: +${Math.round(((base.castThrough?.damageMult ?? 1) - 1) * 100)}% damage.`;
    case 'shortbow':
    case 'longbow':
      return `Crafted ${form}. ${form === 'longbow' ? 'Two-handed, d' : 'D'}ex attack +${w?.dexBonus ?? 0}, pierce, range ${Math.round((w?.rangePx ?? 0) / U)}cm. Uses arrows.`;
    case 'jerkin':
    case 'mail':
    case 'plate':
      return `Crafted ${form}. +${armor?.flat ?? 0} armour${armor?.magicFlat ? `, +${armor.magicFlat} magic armour` : ''}.${move}`;
  }
}

function buildCraftedItem(id: ItemId, spec: CraftSpec): ItemDef {
  const template = CRAFT_TEMPLATES[spec.template];
  const size = craftSize(spec.template, spec.form)!;
  const level = powerLevel(spec.score);
  const element = craftElement(spec);
  const info: CraftedInfo = { ...spec, roll: craftRoll(spec.dice[0], spec.dice[1]), level, mode: size.mode, element };
  const base = baseItem(spec.form, level.level, element);
  const opening = baseLine(spec.form, base);
  const worth = [...spec.parts, ...spec.sockets].reduce((sum, part) => sum + ((getItem(part) as ItemDef | undefined)?.cost ?? 0), 0);
  const heft = spec.parts.reduce((sum, part) => sum + (craftMaterial(part)?.heft ?? 1), 0) / Math.max(1, spec.parts.length);
  const item: ItemDef = {
    ...base,
    id,
    name: `${level.name} ${craftWord(spec.parts[template.namePart])} ${size.label}`,
    rarity: level.rarity,
    cost: worth + 10 * level.level,
    weight: round2(base.weight * heft),
    blurb: '',
    adventureOnly: true,
    crafted: info,
  };
  const ctx: CraftContext = { mode: size.mode, form: spec.form, element, level: level.level };
  for (const effect of spec.effects) craftEffect(effect).apply(item, ctx);
  item.blurb = [opening, ...spec.effects.map((effect) => `${craftEffect(effect).describe(ctx)}.`)].join(' ');
  return item;
}

const MAX_CACHED = 512;
const cache = new Map<string, ItemDef | null>();

/** The item a crafted id stands for, built once and kept; undefined when the id is malformed. */
export function resolveCraftedItem(id: string): ItemDef | undefined {
  let def = cache.get(id);
  if (def === undefined) {
    const spec = parseCraftedId(id);
    def = spec ? buildCraftedItem(id as ItemId, spec) : null;
    if (cache.size >= MAX_CACHED) cache.clear();
    cache.set(id, def);
  }
  return def ?? undefined;
}
