// What roadside events are made of: the shape of an event and its variants,
// how a variant is staged with its words filled in, and the small effects its
// choices have on the party. Pure and seeded: every roll comes from the dice
// handed in, so a reload replays the same outcome.

import type { Dice } from '../../core/Dice';
import { getItem, type ItemId } from '../../core/Items';
import type { Mage } from '../../core/Mage';
import { MINE_ENEMY_DEFS, mineEnemyLevel, type MineEnemyKind } from '../minerun';
import type { EnemyKind } from '../swamprun';
import { livingMembers } from './coop';
import { grantToParty, haulLabel, money, partyOf, withParty } from './economy';
import type { EncounterSpawn, EncounterZone } from './encounters';
import { hasMonsters, livesIn } from './encounters';
import { GEMS, HERBS, ORES } from './finds';
import type { ExplorationRun } from './run';
import { exploreAlong } from './travel';
import type { RegionId } from './world';

export interface EventContext {
  run: ExplorationRun;
  zone: EncounterZone;
  depth: number;
  dice: Dice;
}

export interface EventFight {
  encounter: 'robbery' | 'monsters';
  depth: number;
  spawns?: EncounterSpawn[];
  label?: string;
}

export interface EventOutcome {
  message: string;
  fight?: EventFight;
  levels?: number;
}

export interface EventChoice {
  label: string;
  detail: string;
  available?: (ctx: EventContext) => boolean;
  resolve: (ctx: EventContext) => EventOutcome;
}

/**
 * One way an event can turn up. In any of its words `{a|b}` picks one at
 * random, `{key:a|b}` also remembers the pick, and `{key}` repeats it.
 */
export interface EventVariant {
  /** Overrides the event's title. */
  title?: string;
  text: string;
  /** Only in these zones, within the event's own. */
  zones?: EncounterZone[];
  when?: 'day' | 'night';
  choices: EventChoice[];
}

export interface RoadEvent {
  id: string;
  title: string;
  zones?: EncounterZone[];
  /** It sits somewhere off the road, so it may be sighted and walked up to. */
  sighted?: boolean;
  variants: EventVariant[];
}

/** An event as it turns up: one variant with its words filled in. */
export interface EventScene {
  id: string;
  title: string;
  text: string;
  choices: EventChoice[];
}

// ---- staging ------------------------------------------------------------------

const SLOT = /\{(?:([a-z]+):)?([^{}]*)\}/g;

/** Fill in `{a|b}`, `{key:a|b}` and `{key}`, rolling whatever is not cast yet. */
export function fill(text: string, cast: Record<string, string>, dice: Dice): string {
  return text.replace(SLOT, (whole: string, key: string | undefined, body: string) => {
    if (key === undefined && !body.includes('|')) return cast[body] ?? whole;
    const picked = dice.pick(body.split('|'));
    if (key) cast[key] = picked;
    return picked;
  });
}

/** One variant made ready to show: its words filled in now, its outcomes' words once they resolve. */
export function stage(event: RoadEvent, variant: EventVariant, dice: Dice): EventScene {
  const cast: Record<string, string> = {};
  const text = fill(variant.text, cast, dice);
  const title = fill(variant.title ?? event.title, cast, dice).toUpperCase();
  const choices = variant.choices.map((choice): EventChoice => ({
    label: fill(choice.label, cast, dice),
    detail: fill(choice.detail, cast, dice),
    available: choice.available,
    resolve: (ctx) => {
      const out = choice.resolve(ctx);
      const fight = out.fight?.label ? { ...out.fight, label: fill(out.fight.label, cast, ctx.dice) } : out.fight;
      return { ...out, message: fill(out.message, cast, ctx.dice), fight };
    },
  }));
  return { id: event.id, title, text, choices };
}

// ---- choices ------------------------------------------------------------------

export type Effect = (ctx: EventContext) => string | EventOutcome;
export type Gate = (ctx: EventContext) => boolean;

const told = (value: string | EventOutcome): EventOutcome => (typeof value === 'string' ? { message: value } : value);

export const choice = (label: string, detail: string, resolve: Effect, available?: Gate): EventChoice => ({
  label,
  detail,
  available,
  resolve: (ctx) => told(resolve(ctx)),
});

export type CheckStat = 'strength' | 'dex' | 'int' | 'luck';

const STAT_NAME: Record<CheckStat, string> = { strength: 'Strength', dex: 'Dex', int: 'Int', luck: 'Luck' };

const statOf = (mage: Mage, stat: CheckStat): number =>
  stat === 'strength' ? mage.statStrength : stat === 'dex' ? mage.statDex : stat === 'int' ? mage.statInt : mage.maxLuck;

/** d20 + the best standing member's stat against a DC. */
export function check(ctx: EventContext, stat: CheckStat, dc: number): { pass: boolean; total: number } {
  const standing = livingMembers(partyOf(ctx.run));
  const bonus = standing.length ? Math.max(...standing.map((mage) => statOf(mage, stat))) : 0;
  const total = ctx.dice.die(20) + bonus;
  return { pass: total >= dc, total };
}

/** A choice settled by a check: the detail names the stat and DC, the message opens with the roll. */
export const trial = (label: string, stat: CheckStat, dc: number, stakes: string, pass: Effect, fail: Effect, available?: Gate): EventChoice => ({
  label,
  detail: `${STAT_NAME[stat]} check, DC ${dc}. ${stakes}`,
  available,
  resolve: (ctx) => {
    const roll = check(ctx, stat, dc);
    const out = told((roll.pass ? pass : fail)(ctx));
    return { ...out, message: `Rolled ${roll.total}. ${out.message}` };
  },
});

export const walkOn = (message = 'You walk on.', label = 'Walk on', detail = 'Leave it be.'): EventChoice =>
  choice(label, detail, () => message);

// ---- the party ------------------------------------------------------------------

/** Apply `change` to every member standing; returns what it did to the leader. */
const eachStanding = (ctx: EventContext, change: (mage: Mage) => number): number =>
  withParty(ctx.run, (leader, party) => {
    let led = 0;
    for (const mage of livingMembers(party)) {
      const done = change(mage);
      if (mage === leader) led = done;
    }
    return led;
  });

/** Change every standing member's HP by a flat amount; roadside harm never kills. The leader's change. */
export const hp = (ctx: EventContext, delta: number): number =>
  eachStanding(ctx, (mage) => {
    const before = mage.hp;
    mage.hp = Math.max(1, Math.min(mage.maxHp, mage.hp + delta));
    return mage.hp - before;
  });

/** The same for sanity. */
export const sanity = (ctx: EventContext, delta: number): number =>
  eachStanding(ctx, (mage) => {
    const before = mage.sanity;
    mage.sanity = Math.max(1, Math.min(mage.maxSanity, mage.sanity + delta));
    return mage.sanity - before;
  });

/** Heal every standing member by a share of their max HP. The leader's gain. */
export const mend = (ctx: EventContext, share: number): number =>
  eachStanding(ctx, (mage) => {
    const before = mage.hp;
    mage.hp = Math.min(mage.maxHp, mage.hp + Math.ceil(mage.maxHp * share));
    return mage.hp - before;
  });

/** Give (or, below zero, take) a share of every standing member's max mana. The leader's change. */
export const mana = (ctx: EventContext, share: number): number =>
  eachStanding(ctx, (mage) => {
    const before = mage.mana;
    const amount = Math.sign(share) * Math.ceil(mage.maxMana * Math.abs(share));
    mage.mana = Math.max(0, Math.min(mage.maxMana, mage.mana + amount));
    return mage.mana - before;
  });

/** A share of HP, mana, sanity and word charges back for every standing member, as a short rest gives. */
export const restore = (ctx: EventContext, share: number): void => {
  eachStanding(ctx, (mage) => mage.restoreShare(share).hp);
};

// ---- things ---------------------------------------------------------------------

/** Hand the party `count` of an item; its name as a find reads. */
export const give = (ctx: EventContext, id: ItemId, count = 1): string =>
  haulLabel(id, count, grantToParty(ctx.run, id, count));

/** One thing out of `pool`: a few arrows, one of anything else. */
export const giveFrom = (ctx: EventContext, pool: readonly ItemId[]): string => {
  const id = ctx.dice.pick(pool);
  return give(ctx, id, id === 'arrow' ? 2 + ctx.dice.die(3) : 1);
};

const carries = (mage: Mage, id: ItemId): boolean => mage.utility.includes(id) || mage.bag.includes(id);

/** Someone standing carries one of `ids` in bag or belt. */
export const hasAny = (ids: readonly ItemId[]): Gate => (ctx) =>
  livingMembers(partyOf(ctx.run)).some((mage) => ids.some((id) => carries(mage, id)));

export const has = (id: ItemId): Gate => hasAny([id]);

/** How many of `ids` the standing members carry between them. */
export const countAny = (ctx: EventContext, ids: readonly ItemId[]): number =>
  livingMembers(partyOf(ctx.run)).reduce((sum, mage) =>
    sum + [...mage.utility, ...mage.bag].filter((id) => ids.includes(id)).length, 0);

/** Take the first of `ids` that someone standing carries; its name, or null when nobody has any. */
export const takeAny = (ctx: EventContext, ids: readonly ItemId[]): string | null =>
  withParty(ctx.run, (_leader, party) => {
    for (const id of ids) {
      for (const mage of livingMembers(party)) {
        for (const list of [mage.utility, mage.bag]) {
          const at = list.indexOf(id);
          if (at < 0) continue;
          list.splice(at, 1);
          return getItem(id).name;
        }
      }
    }
    return null;
  });

export const ALL_GEMS: readonly ItemId[] = ['gemAmethyst', 'gemOnyx', 'gemEmerald', 'gemSapphire', 'gemRuby', 'gemDiamond', 'gemPearl'];
export const ALL_HERBS: readonly ItemId[] = ['herbMoonglow', 'herbWaterleaf', 'herbDeathweed', 'herbFireblossom'];
export const POTIONS: readonly ItemId[] = ['healthPotion', 'manaPotion'];

const land = (zone: EncounterZone): RegionId => (zone === 'wilds' ? 'red' : zone);

/** A herb, gem or ore that belongs where the party stands. */
export const herbOf = (ctx: EventContext): ItemId => ctx.dice.pick(HERBS[land(ctx.zone)]);
export const gemOf = (ctx: EventContext): ItemId => ctx.dice.pick(GEMS[land(ctx.zone)]);
export const oreOf = (ctx: EventContext): ItemId => {
  const ores = ORES[land(ctx.zone)];
  return ores.length ? ctx.dice.pick(ores) : 'oreCoal';
};

// ---- money and the map ---------------------------------------------------------

export const purse = (amount: number): Gate => (ctx) => ctx.run.gold >= amount - 1e-9;

export const pay = (ctx: EventContext, amount: number): void => {
  ctx.run.gold = money(Math.max(0, ctx.run.gold - amount));
};

/** Mark the land round the party explored; how many tiles were new to the map. */
export const survey = (ctx: EventContext, radius: number): number => exploreAlong(ctx.run, [ctx.run.pos], radius);

/** "12 tiles mapped." or a shrug when there was nothing new. */
export const mapped = (tiles: number): string => (tiles > 0 ? `${tiles} tiles mapped.` : 'Nothing you had not seen.');

// ---- fights ---------------------------------------------------------------------

export type FoeKind = EnemyKind | MineEnemyKind;

/** One creature for an event fight, levelled for the depth. */
export const foe = (kind: FoeKind, depth: number): EncounterSpawn =>
  kind in MINE_ENEMY_DEFS
    ? { family: 'mine', spec: { kind: kind as MineEnemyKind, level: mineEnemyLevel(depth) } }
    : { family: 'swamp', kind: kind as EnemyKind };

/** A fight against exactly these creatures, `deeper` than where the party stands. Any that do not live here stay away. */
export const brawl = (ctx: EventContext, label: string, kinds: readonly FoeKind[], deeper = 0): EventFight => {
  const depth = Math.min(10, ctx.depth + deeper);
  const natives = kinds.filter((kind) => livesIn(kind, ctx.zone));
  if (natives.length === 0) return ambush(ctx, 'monsters', label, deeper);
  return { encounter: 'monsters', depth, spawns: natives.map((kind) => foe(kind, depth)), label };
};

/** A fight with whatever the zone sends: its robbers or its monsters. Where no monsters live, its robbers. */
export const ambush = (ctx: EventContext, encounter: 'robbery' | 'monsters', label?: string, deeper = 0): EventFight =>
  ({ encounter: hasMonsters(ctx.zone) ? encounter : 'robbery', depth: Math.min(10, ctx.depth + deeper), label });
