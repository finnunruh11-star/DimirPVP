// The crafting bench's vocabulary: four templates and the forms each can take,
// the power levels a score reaches, every effect a crafted thing can carry (with
// its rank: what it costs out of the item's power), and what each material
// brings to the bench. Pure data: craft.ts rolls with it, item.ts builds items.

import { RANGE_UNIT } from '../../config/constants';
import type { HitEffect } from '../../effects/classKit';
import type { DamageType } from '../Damage';
import type { ArmorMod, CastThrough, ItemDef, ItemId, Rarity, ResistMod, StaffBolt, StatMods, WeaponMod } from '../Items';

const U = RANGE_UNIT;
const round2 = (value: number): number => Math.round(value * 100) / 100;

// -----------------------------------------------------------------------------
//  TEMPLATES
// -----------------------------------------------------------------------------

export type CraftTemplateId = 'sword' | 'staff' | 'bow' | 'armor';
/** Where a material goes: a part of the item, or a socket. */
export type CraftSlot = 'material' | 'focus';
export type CraftForm = 'dagger' | 'sword' | 'greatsword' | 'wand' | 'staff' | 'shortbow' | 'longbow' | 'jerkin' | 'mail' | 'plate';
/** How a crafted thing works: its strikes, a wand's own bolt, spells cast through a staff, or worn. */
export type CraftMode = 'blade' | 'bow' | 'wand' | 'staff' | 'armor';

export interface CraftSize {
  form: CraftForm;
  label: string;
  mode: CraftMode;
  /** Focus pieces it holds. */
  sockets: number;
  /** How long it is drawn, 0..1. */
  length: number;
}

export interface CraftTemplate {
  id: CraftTemplateId;
  label: string;
  /** The parts made of a material, in order. */
  parts: readonly string[];
  /** The part whose material names the item ("Iron" Dagger). */
  namePart: number;
  /** Shortest to longest. */
  sizes: readonly CraftSize[];
}

export const CRAFT_TEMPLATE_IDS: readonly CraftTemplateId[] = ['sword', 'staff', 'bow', 'armor'];

export const CRAFT_TEMPLATES: Record<CraftTemplateId, CraftTemplate> = {
  sword: {
    id: 'sword',
    label: 'Sword',
    parts: ['Hilt', 'Blade'],
    namePart: 1,
    sizes: [
      { form: 'dagger', label: 'Dagger', mode: 'blade', sockets: 1, length: 0.3 },
      { form: 'sword', label: 'Sword', mode: 'blade', sockets: 2, length: 0.65 },
      { form: 'greatsword', label: 'Greatsword', mode: 'blade', sockets: 3, length: 1 },
    ],
  },
  staff: {
    id: 'staff',
    label: 'Staff',
    parts: ['Shaft', 'Head'],
    namePart: 1,
    sizes: [
      { form: 'wand', label: 'Wand', mode: 'wand', sockets: 2, length: 0.42 },
      { form: 'staff', label: 'Staff', mode: 'staff', sockets: 3, length: 1 },
    ],
  },
  bow: {
    id: 'bow',
    label: 'Bow',
    parts: ['Limbs', 'String'],
    namePart: 0,
    sizes: [
      { form: 'shortbow', label: 'Shortbow', mode: 'bow', sockets: 1, length: 0.62 },
      { form: 'longbow', label: 'Longbow', mode: 'bow', sockets: 2, length: 1 },
    ],
  },
  armor: {
    id: 'armor',
    label: 'Armor',
    parts: ['Shell', 'Lining'],
    namePart: 0,
    sizes: [
      { form: 'jerkin', label: 'Jerkin', mode: 'armor', sockets: 1, length: 0.4 },
      { form: 'mail', label: 'Mail', mode: 'armor', sockets: 2, length: 0.7 },
      { form: 'plate', label: 'Plate', mode: 'armor', sockets: 2, length: 1 },
    ],
  },
};

export function isCraftTemplate(value: unknown): value is CraftTemplateId {
  return typeof value === 'string' && (CRAFT_TEMPLATE_IDS as readonly string[]).includes(value);
}

export function craftSize(template: CraftTemplateId, form: string): CraftSize | undefined {
  return CRAFT_TEMPLATES[template].sizes.find((size) => size.form === form);
}

// -----------------------------------------------------------------------------
//  THE ROLL AND THE POWER IT BUYS
// -----------------------------------------------------------------------------

export const MAX_CRAFT_MANA = 10;

/** Two d20, the higher counts; a pair counts 26 and a natural 20 counts 22. */
export function craftRoll(a: number, b: number): number {
  if (a === b) return 26;
  const high = Math.max(a, b);
  return high === 20 ? 22 : high;
}

export interface PowerLevel {
  level: number;
  name: string;
  /** Lowest score that reaches it. */
  min: number;
  /** Effect ranks the item can carry in all. */
  budget: number;
  maxEffects: number;
  rarity: Rarity;
}

export const POWER_LEVELS: readonly PowerLevel[] = [
  { level: 1, name: 'Crude', min: 0, budget: 1, maxEffects: 1, rarity: 'common' },
  { level: 2, name: 'Fine', min: 20, budget: 2, maxEffects: 1, rarity: 'rare' },
  { level: 3, name: 'Superior', min: 30, budget: 4, maxEffects: 2, rarity: 'epic' },
  { level: 4, name: 'Masterwork', min: 40, budget: 6, maxEffects: 3, rarity: 'unreal' },
  { level: 5, name: 'Mythic', min: 55, budget: 9, maxEffects: 4, rarity: 'mythical' },
  { level: 6, name: 'Legendary', min: 70, budget: 13, maxEffects: 5, rarity: 'legendary' },
];

export function powerLevel(score: number): PowerLevel {
  let reached = POWER_LEVELS[0];
  for (const level of POWER_LEVELS) if (score >= level.min) reached = level;
  return reached;
}

// -----------------------------------------------------------------------------
//  EFFECTS
// -----------------------------------------------------------------------------

export interface CraftContext {
  mode: CraftMode;
  form: CraftForm;
  /** What a wand bolts with, a staff tunes spells to, an imbued edge adds and a ward resists. */
  element: DamageType;
  level: number;
}

export interface CraftEffectDef {
  label: string;
  /** Its share of the item's power, 1 (minor) to 5 (major). */
  rank: number;
  modes: readonly CraftMode[];
  /** Only these forms, when set. */
  forms?: readonly CraftForm[];
  describe(ctx: CraftContext): string;
  apply(item: ItemDef, ctx: CraftContext): void;
}

const STRIKES: readonly CraftMode[] = ['blade', 'bow', 'wand'];
const WEAPONS: readonly CraftMode[] = ['blade', 'bow'];
const EVERY: readonly CraftMode[] = ['blade', 'bow', 'wand', 'staff', 'armor'];

const hitWord = (ctx: CraftContext): string => (ctx.mode === 'wand' ? 'Bolt hit' : 'On hit');

/** What the item's strikes (a wand: its bolts) also do. */
function strike(...hits: ((ctx: CraftContext) => HitEffect)[]): CraftEffectDef['apply'] {
  return (item, ctx) => {
    const riders = hits.map((hit) => hit(ctx));
    if (ctx.mode !== 'wand') {
      (item.onHit ??= []).push(...riders);
      return;
    }
    for (const bolt of item.staffBolts ?? []) (bolt.onHit ??= []).push(...riders);
  };
}

function weapon(change: (w: WeaponMod, ctx: CraftContext) => void): CraftEffectDef['apply'] {
  return (item, ctx) => {
    if (item.weapon) change(item.weapon, ctx);
  };
}

function bolt(change: (b: StaffBolt) => void): CraftEffectDef['apply'] {
  return (item) => {
    for (const b of item.staffBolts ?? []) change(b);
  };
}

function through(change: (t: CastThrough, ctx: CraftContext) => void): CraftEffectDef['apply'] {
  return (item, ctx) => change((item.castThrough ??= {}), ctx);
}

function armour(change: (a: ArmorMod) => void): CraftEffectDef['apply'] {
  return (item) => change((item.armor ??= { flat: 0 }));
}

function stat(key: keyof StatMods): CraftEffectDef['apply'] {
  return (item) => {
    item.statMods = { ...item.statMods, [key]: (item.statMods?.[key] ?? 0) + 1 };
  };
}

function resistance(add: (ctx: CraftContext) => ResistMod): CraftEffectDef['apply'] {
  return (item, ctx) => {
    const extra = add(ctx);
    const merged: ResistMod = { ...item.resist };
    for (const key of ['immune', 'resist', 'weak'] as const) {
      if (extra[key]) merged[key] = [...new Set([...(merged[key] ?? []), ...extra[key]])];
    }
    item.resist = merged;
  };
}

export const CRAFT_EFFECTS = {
  // ---- What strikes do (a weapon's basic attack, a wand's bolt) ----
  bleed: {
    label: 'Bleeding', rank: 1, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: bleeding 1d3 slashing, 2 turns`,
    apply: strike(() => ({ k: 'dot', name: 'Bleeding', spec: '1d3', turns: 2, type: 'slashing' })),
  },
  burn: {
    label: 'Burning', rank: 1, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: 1 Fire`,
    apply: strike(() => ({ k: 'fire', stacks: 1 })),
  },
  push: {
    label: 'Shoving', rank: 1, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: push 2cm`,
    apply: strike(() => ({ k: 'push', cm: 2 })),
  },
  venom: {
    label: 'Venomous', rank: 2, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: venom 1d4 corrosive, 3 turns`,
    apply: strike(() => ({ k: 'dot', name: 'Venom', spec: '1d4', turns: 3, type: 'corrosive' })),
  },
  chill: {
    label: 'Chilling', rank: 2, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: -30% move, 2 turns`,
    apply: strike(() => ({ k: 'slow', pct: 0.3, turns: 2 })),
  },
  sunder: {
    label: 'Sundering', rank: 2, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: +1 damage taken, 2 turns`,
    apply: strike(() => ({ k: 'pitted', amount: 1, turns: 2 })),
  },
  drain: {
    label: 'Draining', rank: 2, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: drain 1d3 HP`,
    apply: strike(() => ({ k: 'drain', spec: '1d3' })),
  },
  imbue: {
    label: 'Imbued', rank: 2, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: +1d4 ${c.element}`,
    apply: strike((c) => ({ k: 'damage', spec: '1d4', type: c.element })),
  },
  root: {
    label: 'Rooting', rank: 3, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: 25% root, 1 turn`,
    apply: strike(() => ({ k: 'root', turns: 1, chance: 0.25 })),
  },
  wither: {
    label: 'Withering', rank: 3, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: -1 max HP, up to -5`,
    apply: strike(() => ({ k: 'wither', amount: 1, cap: 5 })),
  },
  stifle: {
    label: 'Stifling', rank: 4, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: 20% the next action fails`,
    apply: strike(() => ({ k: 'stifle', chance: 0.2 })),
  },
  forget: {
    label: 'Forgetting', rank: 4, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: forget 1 word, 1 turn`,
    apply: strike(() => ({ k: 'forget', count: 1, turns: 1 })),
  },
  lifesteal: {
    label: 'Lifestealing', rank: 4, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: heal the damage dealt`,
    apply: strike(() => ({ k: 'lifesteal' })),
  },
  antiHeal: {
    label: 'Festering', rank: 5, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: no healing, 2 turns`,
    apply: strike(() => ({ k: 'noHeal', turns: 2 })),
  },
  stun: {
    label: 'Stunning', rank: 5, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: 15% stun, 1 turn`,
    apply: strike(() => ({ k: 'stun', turns: 1, chance: 0.15 })),
  },
  kindle: {
    label: 'Blazing', rank: 3, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: 2 Fire`,
    apply: strike(() => ({ k: 'fire', stacks: 2 })),
  },
  arc: {
    label: 'Arcing', rank: 2, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: lightning leaps to the nearest other unit within 3cm, friend or foe, for 1d4 heat`,
    apply: strike(() => ({ k: 'arc', radius: 3 * U, hits: [{ spec: '1d4', type: 'heat' }] })),
  },
  mill: {
    label: 'Haunting', rank: 2, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: +1d4 sanity damage`,
    apply: strike(() => ({ k: 'damage', spec: '1d4', type: 'sanity' })),
  },
  mindbreak: {
    label: 'Mindbreaking', rank: 4, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: a mind at 5 sanity or less breaks`,
    apply: strike(() => ({ k: 'breakMind', at: 5 })),
  },
  pull: {
    label: 'Grasping', rank: 1, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: drag 2cm toward you`,
    apply: strike(() => ({ k: 'pull', cm: 2 })),
  },
  whirl: {
    label: 'Whirling', rank: 2, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: turned a quarter circle around you`,
    apply: strike(() => ({ k: 'orbit' })),
  },
  curse: {
    label: 'Cursing', rank: 3, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: cursed, +2 damage taken, 2 turns`,
    apply: strike(() => ({ k: 'pitted', amount: 2, turns: 2 })),
  },
  reap: {
    label: 'Reaping', rank: 4, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: 1 Reap (it dies at or below its Reap)`,
    apply: strike(() => ({ k: 'reap', stacks: 1 })),
  },
  execute: {
    label: 'Executing', rank: 5, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: execute at 3 HP or less (+2 per Reap)`,
    apply: strike(() => ({ k: 'execute', at: 3 })),
  },
  harvest: {
    label: 'Harvesting', rank: 3, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: 2 Reap, and you gain 1 Reap`,
    apply: strike(() => ({ k: 'reap', stacks: 2 }), () => ({ k: 'self', then: [{ k: 'reap', stacks: 1 }] })),
  },
  vanish: {
    label: 'Vanishing', rank: 3, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: you are veiled, 1 turn`,
    apply: strike(() => ({ k: 'veilSelf', turns: 1 })),
  },
  shadowStrike: {
    label: 'Lurking', rank: 2, modes: STRIKES,
    describe: (c) => `${hitWord(c)} on a foe in shadow: +1d6 shadow`,
    apply: strike(() => ({ k: 'inShadow', then: [{ k: 'damage', spec: '1d6', type: 'shadow' }] })),
  },
  shadowSnare: {
    label: 'Gloomgripping', rank: 3, modes: STRIKES,
    describe: (c) => `${hitWord(c)} on a foe in shadow: rooted, 1 turn`,
    apply: strike(() => ({ k: 'inShadow', then: [{ k: 'root', turns: 1 }] })),
  },
  opening: {
    label: 'Eager', rank: 1, modes: STRIKES,
    describe: (c) => `${hitWord(c)} in a fight's first 2 rounds: +1d4 ${c.element}`,
    apply: strike((c) => ({ k: 'early', rounds: 2, then: [{ k: 'damage', spec: '1d4', type: c.element }] })),
  },
  firstBlood: {
    label: 'First-blooding', rank: 1, modes: STRIKES,
    describe: (c) => `${hitWord(c)} in a fight's first 2 rounds: bleeding 1d3 slashing, 2 turns`,
    apply: strike(() => ({ k: 'early', rounds: 2, then: [{ k: 'dot', name: 'Bleeding', spec: '1d3', turns: 2, type: 'slashing' }] })),
  },
  blink: {
    label: 'Blinking', rank: 2, modes: STRIKES,
    describe: (c) => `${hitWord(c)}: you teleport 2cm away from the struck`,
    apply: strike(() => ({ k: 'blinkAway', px: 2 * U })),
  },

  // ---- How a weapon is built ----
  keen: {
    label: 'Keen', rank: 2, modes: WEAPONS,
    describe: () => '+10% chance of double damage',
    apply: weapon((w) => {
      w.critChance = Math.min(0.5, round2((w.critChance ?? 0) + 0.1));
    }),
  },
  honed: {
    label: 'Honed', rank: 2, modes: WEAPONS,
    describe: (c) => (c.form === 'sword' || c.form === 'greatsword' ? '+20% Strength damage' : '+2 Dex attack'),
    apply: weapon((w) => {
      if (w.kind === 'strength') w.multiplier = round2((w.multiplier ?? 1) + 0.2);
      else w.dexBonus = (w.dexBonus ?? 0) + 2;
    }),
  },
  reach: {
    label: 'Reaching', rank: 1, modes: WEAPONS,
    describe: (c) => (c.mode === 'bow' ? '+3cm range' : '+1cm reach'),
    apply: weapon((w, c) => {
      const extra = c.mode === 'bow' ? 3 * U : U;
      w.rangePx += extra;
      if (w.rangeAccuracy) {
        w.rangeAccuracy = { ...w.rangeAccuracy, autoWithin: w.rangeAccuracy.autoWithin + extra, maxRange: w.rangeAccuracy.maxRange + extra };
      }
    }),
  },
  knockback: {
    label: 'Heavy', rank: 1, modes: ['blade'], forms: ['sword', 'greatsword'],
    describe: () => 'On hit: knock back 2cm',
    apply: weapon((w) => {
      w.knockbackUnits = 2;
    }),
  },
  lunge: {
    label: 'Lunging', rank: 2, modes: ['blade'],
    describe: () => 'After a hit: dash up to 2cm',
    apply: weapon((w) => {
      w.dashAfterHitUnits = 2;
    }),
  },
  resistPiercing: {
    label: 'Unyielding', rank: 4, modes: WEAPONS,
    describe: () => 'Strikes ignore resistances',
    apply: weapon((w) => {
      w.ignoreResist = true;
    }),
  },
  armourPiercing: {
    label: 'Piercing', rank: 5, modes: WEAPONS,
    describe: () => 'Strikes ignore armour',
    apply: weapon((w) => {
      w.ignoreArmor = true;
    }),
  },
  charge: {
    label: 'Charging', rank: 3, modes: ['blade'],
    describe: () => '+1 damage per 2cm moved this turn before the strike, up to +4',
    apply: weapon((w) => {
      w.charge = { per: 2 * U, max: 4 };
    }),
  },
  rolling: {
    label: 'Rolling', rank: 2, modes: WEAPONS,
    describe: () => '+1 damage per 4cm of your move',
    apply: weapon((w) => {
      w.moveScaled = 4 * U;
    }),
  },
  gather: {
    label: 'Stone-gathering', rank: 3, modes: WEAPONS,
    describe: () => 'Gather a stone each turn, up to 4; your next hit hurls them, +1 damage each',
    apply: (item) => {
      item.gatherStones = Math.max(item.gatherStones ?? 0, 4);
    },
  },
  ambush: {
    label: 'Ambushing', rank: 2, modes: WEAPONS, forms: ['dagger', 'shortbow', 'longbow'],
    describe: () => 'Dex strikes +50% from stealth',
    apply: (item) => {
      item.veiledDaggerBonus = round2((item.veiledDaggerBonus ?? 0) + 0.5);
    },
  },
  brutal: {
    label: 'Brutal', rank: 2, modes: ['blade', 'armor'], forms: ['sword', 'greatsword', 'jerkin', 'mail', 'plate'],
    describe: () => '+2 Strength melee damage',
    apply: (item) => {
      item.meleeDamageBonus = (item.meleeDamageBonus ?? 0) + 2;
    },
  },
  bloodthirst: {
    label: 'Bloodthirsty', rank: 3, modes: ['blade', 'armor'],
    describe: () => 'Melee hits heal you 2',
    apply: (item) => {
      item.meleeHealOnHit = (item.meleeHealOnHit ?? 0) + 2;
    },
  },

  // ---- A wand's bolt ----
  boltDice: {
    label: 'Overcharged', rank: 3, modes: ['wand'],
    describe: () => 'Bolt: +1 die',
    apply: bolt((b) => {
      b.diceDelta = (b.diceDelta ?? 0) + 1;
    }),
  },
  boltTargets: {
    label: 'Forking', rank: 3, modes: ['wand'],
    describe: () => 'Bolt: +1 foe struck',
    apply: bolt((b) => {
      b.targets = (b.targets ?? 1) + 1;
    }),
  },
  boltRange: {
    label: 'Far-reaching', rank: 1, modes: ['wand'],
    describe: () => 'Bolt: +4cm range',
    apply: bolt((b) => {
      b.rangePx += 4 * U;
    }),
  },
  boltThrift: {
    label: 'Thrifty', rank: 2, modes: ['wand'],
    describe: () => 'Bolt: -1 mana',
    apply: bolt((b) => {
      b.mana = Math.max(1, b.mana - 1);
    }),
  },

  // ---- Spells cast through a staff ----
  spellPower: {
    label: 'Empowering', rank: 2, modes: ['staff'],
    describe: () => 'Spells: +15% damage',
    apply: through((t) => {
      t.damageMult = round2((t.damageMult ?? 1) * 1.15);
    }),
  },
  spellThrift: {
    label: 'Frugal', rank: 3, modes: ['staff'],
    describe: () => 'Spells: -1 mana',
    apply: through((t) => {
      t.manaDelta = (t.manaDelta ?? 0) - 1;
    }),
  },
  spellReach: {
    label: 'Farcasting', rank: 1, modes: ['staff'],
    describe: () => 'Spells: +3cm range',
    apply: through((t) => {
      t.rangePx = (t.rangePx ?? 0) + 3 * U;
    }),
  },
  spellHex: {
    label: 'Hexing', rank: 3, modes: ['staff'],
    describe: () => 'Spell hits: +1 damage taken, 2 turns',
    apply: through((t) => {
      t.hex = { name: 'Hexed', damageTaken: 1, duration: 2 };
    }),
  },
  attune: {
    label: 'Attuned', rank: 1, modes: ['staff'],
    describe: (c) => `Spell hits: half becomes ${c.element}`,
    apply: through((t, c) => {
      t.split = { share: 0.5, type: c.element };
    }),
  },
  spellLeech: {
    label: 'Leeching', rank: 3, modes: ['staff'],
    describe: () => 'Spells heal you 10% of the damage dealt',
    apply: (item) => {
      item.spellLifestealPct = round2((item.spellLifestealPct ?? 0) + 0.1);
    },
  },
  witchcraft: {
    label: 'Witching', rank: 5, modes: ['staff', 'wand'],
    describe: () => 'Your debuffs last twice as long',
    apply: (item) => {
      item.doubleDebuffs = true;
    },
  },
  soulPrice: {
    label: 'Soul-bought', rank: 3, modes: ['staff'],
    describe: () => 'Spells: +40% damage, but every spell costs 5% of your max HP',
    apply: (item) => {
      const t = (item.castThrough ??= {});
      t.damageMult = round2((t.damageMult ?? 1) * 1.4);
      item.spellHealthCostPct = Math.max(item.spellHealthCostPct ?? 0, 0.05);
    },
  },

  // ---- Worn armour ----
  plating: {
    label: 'Plated', rank: 2, modes: ['armor'],
    describe: () => '+1 armour',
    apply: armour((a) => {
      a.flat += 1;
    }),
  },
  warding: {
    label: 'Warded', rank: 2, modes: ['armor'],
    describe: () => '+1 magic armour',
    apply: armour((a) => {
      a.magicFlat = (a.magicFlat ?? 0) + 1;
    }),
  },
  elementalWard: {
    label: 'Resistant', rank: 3, modes: ['armor'],
    describe: (c) => `Resist ${c.element}`,
    apply: resistance((c) => ({ resist: [c.element] })),
  },
  fireproof: {
    label: 'Fireproof', rank: 3, modes: ['armor'],
    describe: () => 'Resist heat',
    apply: resistance(() => ({ resist: ['heat'] })),
  },
  stoneSkin: {
    label: 'Stone-skinned', rank: 3, modes: ['armor'],
    describe: () => '+2 armour, but 3kg heavier',
    apply: (item) => {
      (item.armor ??= { flat: 0 }).flat += 2;
      item.weight = round2(item.weight + 3);
    },
  },
  immovable: {
    label: 'Immovable', rank: 3, modes: ['armor', 'blade'],
    describe: () => 'You cannot be pushed, pulled or knocked back, but -10% move',
    apply: (item) => {
      item.immovable = true;
      item.moveMult = round2((item.moveMult ?? 1) * 0.9);
    },
  },
  stunProof: {
    label: 'Unshakable', rank: 4, modes: ['armor'],
    describe: () => 'Stuns and disarms do not take hold, but 3kg heavier',
    apply: (item) => {
      item.stunProof = true;
      item.weight = round2(item.weight + 3);
    },
  },
  evasion: {
    label: 'Evasive', rank: 3, modes: EVERY,
    describe: () => '+1 dodge each fight',
    apply: (item) => {
      item.extraDodges = (item.extraDodges ?? 0) + 1;
    },
  },
  regeneration: {
    label: 'Regenerating', rank: 3, modes: ['armor', 'blade'],
    describe: () => 'Heal 1 HP at the start of your turn',
    apply: (item) => {
      item.regen = (item.regen ?? 0) + 1;
    },
  },
  ethereal: {
    label: 'Ethereal', rank: 4, modes: ['armor'],
    describe: () => 'Resist pierce, slashing and shatter, but weak to light',
    apply: resistance(() => ({ resist: ['pierce', 'slashing', 'shatter'], weak: ['light'] })),
  },
  grimShroud: {
    label: 'Grim', rank: 3, modes: ['armor'],
    describe: () => 'Immunity to shadow, but weak to light',
    apply: resistance(() => ({ immune: ['shadow'], weak: ['light'] })),
  },
  mindWard: {
    label: 'Steadfast', rank: 2, modes: ['armor', 'staff'],
    describe: () => '-2 sanity damage taken',
    apply: (item) => {
      item.mentalReduce = (item.mentalReduce ?? 0) + 2;
    },
  },
  thorns: {
    label: 'Thorned', rank: 2, modes: ['armor'],
    describe: () => 'On melee hit taken: 2 damage to the attacker',
    apply: (item) => {
      item.thorns = (item.thorns ?? 0) + 2;
    },
  },
  barbs: {
    label: 'Barbed', rank: 2, modes: ['armor'],
    describe: () => 'When struck: the attacker bleeds 1d3, 2 turns',
    apply: (item) => {
      (item.onStruck ??= []).push({ k: 'dot', name: 'Barbed', spec: '1d3', turns: 2, type: 'slashing' });
    },
  },
  frostMail: {
    label: 'Frostbound', rank: 2, modes: ['armor'],
    describe: () => 'When struck: the attacker -30% move, 2 turns',
    apply: (item) => {
      (item.onStruck ??= []).push({ k: 'slow', pct: 0.3, turns: 2 });
    },
  },
  emberMail: {
    label: 'Smouldering', rank: 2, modes: ['armor'],
    describe: () => 'When struck: the attacker catches 1 Fire',
    apply: (item) => {
      (item.onStruck ??= []).push({ k: 'fire', stacks: 1 });
    },
  },
  doomMail: {
    label: 'Doomed', rank: 3, modes: ['armor'],
    describe: () => 'When struck: the attacker gains 1 Reap, and so do you',
    apply: (item) => {
      (item.onStruck ??= []).push({ k: 'reap', stacks: 1 }, { k: 'self', then: [{ k: 'reap', stacks: 1 }] });
    },
  },
  bloodPact: {
    label: 'Blood-bound', rank: 2, modes: ['armor'],
    describe: () => '+1 armour and +1 magic armour, but healing received -40%',
    apply: (item) => {
      const a = (item.armor ??= { flat: 0 });
      a.flat += 1;
      a.magicFlat = (a.magicFlat ?? 0) + 1;
      item.healMult = round2((item.healMult ?? 1) * 0.6);
    },
  },
  purge: {
    label: 'Purifying', rank: 3, modes: ['armor', 'staff'],
    describe: () => 'Bonus action: shed your afflictions for 3 mana',
    apply: (item) => {
      item.cleanseManaCost = Math.min(item.cleanseManaCost ?? 3, 3);
    },
  },
  vigor: {
    label: 'Hale', rank: 1, modes: ['armor'],
    describe: () => '+4 max HP',
    apply: (item) => {
      item.hpFlat = (item.hpFlat ?? 0) + 4;
    },
  },
  clarity: {
    label: 'Clear-minded', rank: 3, modes: ['armor'],
    describe: () => '-30% debuff duration',
    apply: (item) => {
      item.debuffDurationMult = round2((item.debuffDurationMult ?? 1) * 0.7);
    },
  },
  mending: {
    label: 'Mending', rank: 2, modes: ['armor'],
    describe: () => '+30% healing received',
    apply: (item) => {
      item.healMult = round2((item.healMult ?? 1) * 1.3);
    },
  },
  channeling: {
    label: 'Channeling', rank: 2, modes: ['armor', 'staff'],
    describe: () => 'On damage taken: +1 mana',
    apply: (item) => {
      item.manaOnHit = (item.manaOnHit ?? 0) + 1;
    },
  },

  // ---- Anything ----
  might: { label: 'Mighty', rank: 2, modes: EVERY, describe: () => '+1 Strength', apply: stat('str') },
  finesse: { label: 'Deft', rank: 2, modes: EVERY, describe: () => '+1 Dex', apply: stat('dex') },
  insight: { label: 'Insightful', rank: 2, modes: EVERY, describe: () => '+1 Int', apply: stat('int') },
  featherweight: {
    label: 'Featherweight', rank: 1, modes: EVERY,
    describe: () => 'Half weight',
    apply: (item) => {
      item.weight = round2(item.weight / 2);
    },
  },
  swift: {
    label: 'Swift', rank: 2, modes: EVERY,
    describe: () => '+10% move',
    apply: (item) => {
      item.moveMult = round2((item.moveMult ?? 1) * 1.1);
    },
  },
  momentum: {
    label: 'Momentous', rank: 2, modes: ['blade', 'bow', 'armor'],
    describe: () => '+1cm move for every turn in a row you ran most of your move',
    apply: (item) => {
      item.momentumBoots = true;
    },
  },
  unbound: {
    label: 'Unbound', rank: 2, modes: EVERY,
    describe: () => 'A slow takes at most half your move',
    apply: (item) => {
      item.slowCapPct = Math.min(item.slowCapPct ?? 1, 0.5);
    },
  },
  manaWell: {
    label: 'Mana-stored', rank: 1, modes: EVERY,
    describe: (c) => `+${c.level} mana as a fight begins`,
    apply: (item, c) => {
      item.fightStartMana = (item.fightStartMana ?? 0) + c.level;
    },
  },
} satisfies Record<string, CraftEffectDef>;

export type CraftEffectId = keyof typeof CRAFT_EFFECTS;

export function isCraftEffect(value: unknown): value is CraftEffectId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CRAFT_EFFECTS, value);
}

export function craftEffect(id: CraftEffectId): CraftEffectDef {
  return CRAFT_EFFECTS[id];
}

// -----------------------------------------------------------------------------
//  MATERIALS
// -----------------------------------------------------------------------------

export interface CraftMaterial {
  slot: CraftSlot;
  /** Added to the score of anything crafted with it. */
  value: number;
  /** What it may lend a crafted item. */
  effects: readonly CraftEffectId[];
  /** The element it carries: a wand bolts with it, a staff attunes to it. */
  element?: DamageType;
  /** Its colour on the bench. */
  tint?: number;
  /** How it reads in an item's name. */
  word?: string;
  /** A part's weight on what is made of it: 1 as the form is, more is heavier. */
  heft?: number;
  /** How strongly its effects pull the draw: each counts this many times. Default 1. */
  lean?: number;
}

const part = (value: number, effects: CraftEffectId[], extra: Partial<CraftMaterial> = {}): CraftMaterial =>
  ({ slot: 'material', value, effects, ...extra });
const focus = (value: number, effects: CraftEffectId[], extra: Partial<CraftMaterial> = {}): CraftMaterial =>
  ({ slot: 'focus', value, effects, ...extra });

// The five colours, as a gem lends them (a gel is the cheap, weak version).
const RED: CraftEffectId[] = ['burn', 'kindle', 'imbue', 'keen', 'swift', 'arc', 'spellPower', 'boltDice', 'emberMail', 'elementalWard'];
const BLUE: CraftEffectId[] = [
  'chill', 'root', 'stun', 'forget', 'stifle', 'spellThrift', 'spellReach', 'boltThrift', 'insight', 'frostMail', 'mindWard', 'elementalWard',
];
const BLACK: CraftEffectId[] = [
  'drain', 'lifesteal', 'wither', 'antiHeal', 'reap', 'curse', 'sunder', 'witchcraft', 'spellHex', 'spellLeech', 'barbs', 'elementalWard',
];
const WHITE: CraftEffectId[] = ['warding', 'plating', 'mending', 'clarity', 'vigor', 'purge', 'imbue', 'attune', 'spellThrift', 'elementalWard'];
const GREEN: CraftEffectId[] = ['venom', 'root', 'vigor', 'might', 'mending', 'thorns', 'brutal', 'elementalWard'];
const GEM = 12;
const GEM_LEAN = 3;
// A herb sits between a gel and a gem: a handful of its colour's effects.
const HERB = 6;
const HERB_LEAN = 2;
// Every skin is plain leather: light, for light armour, better from stronger beasts.
const LEATHER: CraftEffectId[] = ['featherweight', 'swift'];
const LEATHER_HEFT = 0.7;

/**
 * What every material brings to the bench. A material's effects follow the
 * creature it came from and its colour. Entries marked provisional still wait
 * for a description; a material missing here still crafts (see item.ts).
 */
export const CRAFT_MATERIALS: Partial<Record<ItemId, CraftMaterial>> = {
  // ---- Parts: wood, ores, bars, scales and leather ----
  wood: part(1, [], { tint: 0x8a5a32, heft: 0.6, word: 'Wooden' }),
  oreCoal: part(1, ['burn', 'imbue', 'emberMail'], { element: 'heat', tint: 0x3a3a42, heft: 0.9, word: 'Coal' }),
  oreCopper: part(2, ['swift', 'arc', 'featherweight'], { tint: 0xc4733c, heft: 0.75, word: 'Copper' }),
  oreIron: part(4, ['honed', 'plating', 'knockback', 'sunder'], { tint: 0x9aa3ad, heft: 1.3, word: 'Iron' }),
  oreGold: part(7, ['spellPower', 'spellThrift', 'boltDice', 'warding', 'insight', 'channeling'], { tint: 0xdcae3c, heft: 1.2, word: 'Gold' }),
  darksteelBar: part(9, ['plating', 'warding', 'brutal', 'armourPiercing', 'wither', 'drain'], {
    element: 'shadow', tint: 0x4c5064, heft: 1.8, word: 'Darksteel',
  }),
  koboldScale: part(3, ['swift', 'burn', 'keen', 'lunge'], { element: 'heat', tint: 0xc8503a, word: 'Kobold-scale' }),
  chargedScale: part(5, ['arc', 'keen', 'lunge', 'swift', 'imbue'], { element: 'heat', tint: 0xe8d058, word: 'Stormscale' }),
  redDrakeScale: part(7, ['fireproof', 'burn', 'kindle', 'emberMail', 'keen', 'swift'], { element: 'heat', tint: 0xc84a3a, word: 'Red Drake' }),
  blackDrakeScale: part(7, ['fireproof', 'burn', 'emberMail', 'drain', 'wither', 'sunder'], {
    element: 'corrosive', tint: 0x3e3a4c, word: 'Black Drake',
  }),
  batLeather: part(1, LEATHER, { tint: 0x5a4a48, heft: LEATHER_HEFT, word: 'Bat-leather' }),
  rabbitPelt: part(1, LEATHER, { tint: 0xc8b08a, heft: LEATHER_HEFT, word: 'Rabbit-hide' }),
  wolfPelt: part(2, LEATHER, { tint: 0x8a8a90, heft: LEATHER_HEFT, word: 'Wolf-hide' }),
  boarHide: part(3, LEATHER, { tint: 0x6e4a32, heft: LEATHER_HEFT, word: 'Boarhide' }),
  lionPelt: part(4, LEATHER, { tint: 0xcf9a48, heft: LEATHER_HEFT, word: 'Lionhide' }),

  // ---- Gems: the colours, very strongly; amethyst and diamond are only worth ----
  gemRuby: focus(GEM, RED, { element: 'heat', lean: GEM_LEAN }),
  gemSapphire: focus(GEM, BLUE, { element: 'cold', lean: GEM_LEAN }),
  gemOnyx: focus(GEM, BLACK, { element: 'shadow', lean: GEM_LEAN }),
  gemPearl: focus(GEM, WHITE, { element: 'light', lean: GEM_LEAN, tint: 0xf0ebe0 }),
  gemEmerald: focus(GEM, GREEN, { element: 'corrosive', lean: GEM_LEAN }),
  gemAmethyst: focus(5, []),
  gemDiamond: focus(16, []),
  // Herbs: between a gel and a gem.
  herbMoonglow: focus(HERB, ['warding', 'mending', 'clarity', 'vigor', 'purge'], { element: 'light', lean: HERB_LEAN, tint: 0xdfe8f5 }),
  herbWaterleaf: focus(HERB, ['chill', 'spellThrift', 'boltThrift', 'insight', 'mindWard'], { element: 'cold', lean: HERB_LEAN, tint: 0x4a90e0 }),
  herbDeathweed: focus(HERB, ['drain', 'wither', 'curse', 'spellLeech', 'sunder'], { element: 'shadow', lean: HERB_LEAN, tint: 0x6a3a7a }),
  herbFireblossom: focus(HERB, ['burn', 'kindle', 'imbue', 'swift', 'emberMail'], { element: 'heat', lean: HERB_LEAN, tint: 0xf06a2a }),
  // Gels: a slime's colour, weakly.
  gelRed: focus(2, ['burn', 'swift'], { element: 'heat', tint: 0xd85a48 }),
  gelBlue: focus(2, ['chill', 'insight'], { element: 'cold', tint: 0x5a8ae0 }),
  gelBlack: focus(2, ['drain', 'sunder'], { element: 'shadow', tint: 0x4a4452 }),
  gelWhite: focus(2, ['warding', 'mending'], { element: 'light', tint: 0xe8e8e0 }),
  slimeGel: focus(2, ['venom', 'vigor'], { element: 'corrosive', tint: 0x6cc84e }),

  // ---- Mana stones: they only store mana ----
  manaStoneSmall: focus(1, ['manaWell'], { word: 'Manastone', tint: 0x58a8f0 }),
  manaStoneMedium: focus(3, ['manaWell'], { word: 'Manastone', tint: 0x58a8f0 }),
  manaStoneBig: focus(6, ['manaWell'], { word: 'Manastone', tint: 0x58a8f0 }),

  // ---- What creatures leave ----
  ectoplasm: focus(3, ['mill', 'mindWard', 'unbound', 'swift', 'ethereal'], { element: 'sanity', tint: 0xb8eae8 }),
  ghastEssence: focus(8, ['pull', 'push', 'whirl', 'mill', 'mindbreak', 'swift', 'ethereal'], { element: 'sanity', tint: 0x9a70d0 }),
  lichCore: focus(14, ['soulPrice', 'witchcraft', 'curse', 'spellHex', 'spellLeech', 'wither', 'drain', 'bloodPact'], {
    element: 'shadow', lean: 2, tint: 0x3ad6b0,
  }),
  reaperCore: focus(16, ['reap', 'execute', 'harvest', 'antiHeal', 'wither', 'grimShroud', 'doomMail'], {
    element: 'shadow', lean: 3, tint: 0x5a5070,
  }),
  lostSoul: focus(15, ['lifesteal', 'bloodthirst', 'evasion', 'plating', 'vigor', 'regeneration', 'thorns', 'warding'], {
    element: 'shadow', lean: 2, tint: 0x8a86b0,
  }),
  demonHorn: focus(7, ['brutal', 'bloodthirst', 'lifesteal', 'might', 'thorns'], { tint: 0xb83b32 }),
  beastHorn: focus(6, ['keen', 'reach', 'honed', 'brutal'], { tint: 0xd86b35 }),
  boarTusk: focus(4, ['charge', 'momentum', 'knockback', 'vigor'], { tint: 0xd6cbac }),
  lionFang: focus(5, ['might', 'finesse', 'insight', 'brutal', 'bloodthirst', 'vigor'], { tint: 0xe4d6b0 }),
  wolfFang: focus(3, ['bleed', 'barbs', 'vigor'], { tint: 0xe0d8c8 }),
  badCharm: focus(8, ['ambush', 'vanish', 'blink', 'stifle', 'imbue'], { element: 'shadow', tint: 0x7b2337 }),
  magmaShardTank: focus(8, ['plating', 'emberMail', 'stun', 'knockback', 'elementalWard'], { element: 'heat', tint: 0xff8438 }),
  magmaShardHealer: focus(8, ['mending', 'purge', 'clarity', 'spellLeech', 'burn'], { element: 'heat', tint: 0xffbe4f }),
  magmaShardMage: focus(8, ['kindle', 'spellPower', 'boltDice', 'boltTargets', 'imbue'], { element: 'heat', tint: 0xff3d24 }),
  stoneHeart: focus(8, ['plating', 'stoneSkin', 'immovable', 'stunProof'], { tint: 0x8a8274 }),
  redStone: focus(6, ['gather', 'rolling', 'charge', 'momentum'], { element: 'shatter', tint: 0xb0503a }),
  darkEye: focus(5, ['shadowStrike', 'shadowSnare', 'stifle', 'spellHex'], { element: 'shadow', tint: 0x6a5a8a }),
  pebble: focus(1, ['opening', 'firstBlood'], { tint: 0x9a948a }),
  // Provisional.
  voidShard: focus(12, ['blink', 'vanish', 'grimShroud', 'stifle'], { element: 'shadow', tint: 0x2a2238 }),
  sentinelLens: focus(3, ['reach', 'boltRange', 'spellReach', 'keen']),
  crudeTrinket: focus(1, ['vigor', 'featherweight']),
  magmaCore: focus(6, ['burn', 'imbue', 'boltDice', 'spellPower'], { element: 'heat' }),
  // Bloodmoon boss materials, the strongest there are. Provisional.
  moonshardWhite: focus(18, ['stun', 'clarity', 'warding', 'attune'], { element: 'light', tint: 0xeef0f4 }),
  moonshardBlue: focus(18, ['spellThrift', 'boltTargets', 'forget', 'stifle'], { element: 'cold', tint: 0x5a8ae8 }),
  moonshardBlack: focus(18, ['antiHeal', 'lifesteal', 'witchcraft', 'wither'], { element: 'shadow', tint: 0x4a4258 }),
  moonshardRed: focus(18, ['armourPiercing', 'burn', 'boltDice', 'spellPower'], { element: 'heat', tint: 0xd8404c }),
  moonshardGreen: focus(18, ['resistPiercing', 'venom', 'vigor', 'mending'], { element: 'corrosive', tint: 0x4cbf6a }),
};
