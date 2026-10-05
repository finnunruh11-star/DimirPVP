// Handcrafted scene fights. Now and then an encounter that would have been a
// plain pack (wolves, kobolds, bandits) turns out to be something already
// under way: wolves closing on a rabbit, goblins at a cookfire, two lion prides
// fighting over their ground. No choice and no reward beyond the usual drops:
// it is simply the fight you walk into. A merchant saved from raiders opens his
// wares. Every creature in a scene lives in the region it plays in. Pure and
// seeded. Never in the dungeons, never in the black country.

import { FIELD } from '../../config/constants';
import type { Dice } from '../../core/Dice';
import type { EncounterKind, EncounterSpawn, EncounterZone } from './encounters';
import { foe, type FoeKind } from './eventKit';
import type { SceneFight, SceneProp, SceneSide, SceneUnit, SceneUnitKind } from './sceneFight';
import { WAYSIDE_KINDS, type WaysideKind } from './shops';

/** Chance an encounter a scene can stand in for becomes that scene. */
export const SCENE_CHANCE = 0.3;
/** Offsets the step dice that stage a scene from every other roll of that step. */
export const SCENE_SALT = 1_000_003;

interface Built {
  /** What the party sees as it comes on the scene, and the fight's first log line. */
  label: string;
  units: SceneUnit[];
  props?: SceneProp[];
  wares?: WaysideKind;
}

export interface SceneDef {
  id: string;
  zones: readonly EncounterZone[];
  /** The kind of encounter it stands in for. */
  encounter: EncounterKind;
  /** Only for an encounter holding one of these; for any of its zone's when unset. */
  replaces?: readonly FoeKind[];
  minDepth?: number;
  /** Only on the travel map's roads: a merchant's cart has wares to open afterwards. */
  road?: boolean;
  build(depth: number, dice: Dice): Built;
}

export interface StagedScene {
  fight: SceneFight;
  label: string;
  /** Who steps into view first. */
  figure: EncounterSpawn;
}

// ---- building blocks ---------------------------------------------------------------

/** Field shares are square in height: this many width-shares make one height-share. */
const ASPECT = FIELD.h / FIELD.w;

const unit = (kind: SceneUnitKind, side: SceneSide, x: number, y: number, more: Partial<SceneUnit> = {}): SceneUnit =>
  ({ kind, side, x, y, ...more });

/** `count` of a kind in a ring round a spot, `r` field-heights out. */
function around(kind: SceneUnitKind, side: SceneSide, count: number, x: number, y: number, r: number, more: Partial<SceneUnit> = {}): SceneUnit[] {
  return Array.from({ length: count }, (_, i) => {
    const a = 0.5 + (i / count) * Math.PI * 2;
    return unit(kind, side, x + Math.cos(a) * r * ASPECT, y + Math.sin(a) * r, more);
  });
}

const prop = (kind: SceneProp['kind'], x: number, y: number): SceneProp => ({ kind, x, y });

const between = (dice: Dice, low: number, high: number): number => low + dice.die(high - low + 1) - 1;

/** A share of health for something already worn down by a fight. */
const worn = (dice: Dice, low: number, high: number): number => low + dice.float() * (high - low);

/** One pride: a male and `lionesses` round him. */
function pride(side: SceneSide, x: number, y: number, lionesses: number, hp?: number): SceneUnit[] {
  return [unit('lion', side, x, y, { hp }), ...around('lioness', side, lionesses, x, y, 0.2, { hp })];
}

const dragonborn = (depth: number, dice: Dice): 'red-dragonborn' | 'black-dragonborn' =>
  depth >= 6 && dice.chance(0.5) ? 'black-dragonborn' : 'red-dragonborn';

// ---- the scenes ----------------------------------------------------------------------

export const SCENES: readonly SceneDef[] = [
  {
    id: 'wolf-hunt',
    zones: ['forest'],
    encounter: 'monsters',
    replaces: ['wolf'],
    build: (_depth, dice) => ({
      label: 'Wolves are circling a wounded rabbit. The pack turns on you.',
      units: [unit('rabbit', 'prey', 0.7, 0.5, { hp: 0.35 }), ...around('wolf', 'foe', between(dice, 2, 4), 0.7, 0.5, 0.3)],
    }),
  },
  {
    id: 'wolves-boar',
    zones: ['forest'],
    encounter: 'monsters',
    replaces: ['wolf', 'boar'],
    minDepth: 2,
    build: (_depth, dice) => {
      if (dice.chance(0.5)) {
        return {
          label: 'A boar stands its ground against a wolf pack. Both turn on you.',
          units: [unit('boar', 'rival', 0.8, 0.5, { hp: 0.7 }), ...around('wolf', 'foe', between(dice, 2, 3), 0.8, 0.5, 0.3, { hp: 0.85 })],
        };
      }
      if (dice.chance(0.5)) {
        return { label: 'A boar has just scattered a wolf pack. Bleeding, it charges you.', units: [unit('boar', 'foe', 0.72, 0.5, { hp: worn(dice, 0.35, 0.6) })] };
      }
      return {
        label: 'Wolves have just dragged down a boar. Limping, they come for you.',
        units: around('wolf', 'foe', between(dice, 1, 2), 0.72, 0.5, 0.18, { hp: 0.55 }),
      };
    },
  },
  {
    id: 'goblin-cookfire',
    zones: ['forest'],
    encounter: 'monsters',
    replaces: ['slime', 'rabbit'],
    build: (depth, dice) => ({
      label: 'Goblins at a cookfire drop their spoons and grab their spears.',
      units: [
        unit('slime', 'prey', 0.72, 0.44, { hp: 0.5, tied: true }),
        ...around('goblinRaider', 'foe', depth >= 3 ? 3 : 2, 0.72, 0.5, 0.3),
        unit('goblinShaman', 'foe', 0.86, 0.5),
      ],
      props: [prop('campfire', 0.72, 0.52)],
    }),
  },
  {
    id: 'burnt-bush',
    zones: ['red', 'wilds'],
    encounter: 'monsters',
    replaces: ['kobold', 'slime-red'],
    build: (_depth, dice) => ({
      label: 'Red slimes quiver round a burnt berry bush, and turn on you.',
      units: around('slime-red', 'foe', between(dice, 3, 4), 0.74, 0.5, 0.22),
      props: [prop('burnt-bush', 0.74, 0.5)],
    }),
  },
  {
    id: 'kobolds-sentinel',
    zones: ['red', 'wilds'],
    encounter: 'monsters',
    replaces: ['kobold', 'elite-kobold', 'sentinel'],
    minDepth: 2,
    build: (_depth, dice) => {
      if (dice.chance(0.5)) {
        return {
          label: 'Kobolds have woken a sentinel in the scree. It fights them, and you.',
          units: [unit('sentinel', 'rival', 0.76, 0.5, { hp: 0.6 }), ...around('kobold', 'foe', 3, 0.76, 0.5, 0.3)],
        };
      }
      if (dice.chance(0.5)) {
        return { label: 'A cracked sentinel stands over dead kobolds, and turns its eye on you.', units: [unit('sentinel', 'foe', 0.76, 0.5, { hp: 0.5 })] };
      }
      return { label: 'Kobolds cheer over a broken sentinel, then see you.', units: around('kobold', 'foe', 2, 0.76, 0.5, 0.15, { hp: 0.6 }) };
    },
  },
  {
    id: 'carriage-raid',
    zones: ['red', 'wilds'],
    encounter: 'monsters',
    minDepth: 4,
    road: true,
    build: (depth, dice) => ({
      label: "Two dragonborn are tearing into a merchant's carriage. A lone dwarf guard still stands.",
      units: [
        unit('dwarf-guard', 'escort', 0.6, 0.5, { hp: 0.45, name: 'Dwarven Guard' }),
        unit(dragonborn(depth, dice), 'foe', 0.78, 0.32, { hp: 0.75 }),
        unit(dragonborn(depth, dice), 'foe', 0.78, 0.68, { hp: 0.75 }),
      ],
      props: [prop('carriage', 0.88, 0.5)],
      wares: dice.pick(WAYSIDE_KINDS),
    }),
  },
  {
    id: 'pride-war',
    zones: ['forest'],
    encounter: 'monsters',
    minDepth: 4,
    build: (_depth, dice) => {
      if (dice.chance(0.5)) {
        return {
          label: 'Two lion prides are fighting over their ground. You are in the middle.',
          units: [...pride('foe', 0.64, 0.3, between(dice, 1, 2)), ...pride('rival', 0.84, 0.7, 1)],
        };
      }
      return {
        label: 'One lion pride has driven off another. The winners notice you.',
        units: pride('foe', 0.76, 0.5, between(dice, 0, 1), worn(dice, 0.4, 0.7)),
      };
    },
  },
  {
    id: 'lioness-hunt',
    zones: ['forest'],
    encounter: 'monsters',
    minDepth: 4,
    build: () => ({
      label: 'Lionesses have a boar at bay. They turn from it to you.',
      units: [unit('boar', 'rival', 0.8, 0.5, { hp: 0.6 }), ...around('lioness', 'foe', 2, 0.8, 0.5, 0.26)],
    }),
  },
  {
    id: 'shakedown',
    zones: ['capitol'],
    encounter: 'robbery',
    build: (depth) => ({
      label: 'Bandits shaking down a farmer by his cart let go of him and draw on you.',
      units: [
        unit('villager', 'prey', 0.72, 0.5, { hp: 0.5, name: 'Farmer' }),
        unit('bandit', 'foe', 0.8, 0.36),
        unit(depth >= 3 ? 'bandit-captain' : 'bandit', 'foe', 0.82, 0.62),
        ...(depth >= 2 ? [unit('bandit-archer', 'foe', 0.9, 0.5)] : []),
      ],
      props: [prop('cart', 0.86, 0.3)],
    }),
  },
];

// ---- staging -------------------------------------------------------------------------

const kindOf = (spawn: EncounterSpawn): string => (spawn.family === 'swamp' ? spawn.kind : spawn.spec.kind);

/** The scenes that could stand in for `spawns`, a `kind` encounter in `zone` at `depth`. */
export function scenesFor(zone: EncounterZone, kind: EncounterKind, depth: number, spawns: readonly EncounterSpawn[], road: boolean): SceneDef[] {
  const present = new Set(spawns.map(kindOf));
  return SCENES.filter((scene) =>
    scene.zones.includes(zone) &&
    scene.encounter === kind &&
    depth >= (scene.minDepth ?? 1) &&
    (road || !scene.road) &&
    (!scene.replaces || scene.replaces.some((foeKind) => present.has(foeKind))));
}

/**
 * Now and then an encounter turns out to be a scene already under way. Null
 * when it stays the plain encounter it was rolled as.
 */
export function stageScene(
  zone: EncounterZone,
  kind: EncounterKind,
  depth: number,
  spawns: readonly EncounterSpawn[],
  dice: Dice,
  road: boolean,
): StagedScene | null {
  const fits = scenesFor(zone, kind, depth, spawns, road);
  if (fits.length === 0 || !dice.chance(SCENE_CHANCE)) return null;
  const scene = dice.pick(fits);
  const built = scene.build(depth, dice);
  const lead = built.units.find((entry) => entry.side === 'foe') ?? built.units.find((entry) => entry.side === 'rival')!;
  const fight: SceneFight = { id: scene.id, units: built.units, props: built.props ?? [] };
  if (built.wares) fight.wares = built.wares;
  return { fight, label: built.label, figure: foe(lead.kind as FoeKind, depth) };
}

/** A number to salt a fight's dice with, from a key such as a pack's id. */
export function sceneSalt(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return h >>> 0;
}
