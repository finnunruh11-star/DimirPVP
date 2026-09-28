// The Volcanic Wilds: one wide basin under Cinderpeak, walked in any direction.
// A lava river splits it into a western half reached from the road and an
// eastern half behind two bridges. Named places lie under fog until walked;
// packs roam near them and secrets reward whoever looks closely.

import { Dice } from '../../core/Dice';
import type { ItemId } from '../../core/Items';
import { cellHash } from '../../world/kenney';
import type { ExitDef, LocaleDef, PropPlacement } from '../../world/locale';
import { MapBuilder } from '../../world/mapBuilder';
import { mineEnemyLevel, MINE_ENEMY_DEFS, type MineEnemyKind } from '../minerun';
import { grantToParty, hashString } from './economy';
import { creatureName, rollEncounter, spawnKindId, type EncounterKind, type EncounterSpawn } from './encounters';
import type { Landmark, ResolvedLocale, Secret, SecretResult, WildPack } from './locales';
import type { ExplorationRun } from './run';

export const WILDS_ID = 'red-wilds';
const W = 72;
const H = 52;

type Point = readonly [number, number];

/** A 4-connected track through `points`, walking across first, then down. */
function track(b: MapBuilder, points: readonly Point[], ch = ';'): void {
  for (let i = 1; i < points.length; i++) {
    let [x, y] = points[i - 1];
    const [tx, ty] = points[i];
    b.set(x, y, ch);
    while (x !== tx) {
      x += Math.sign(tx - x);
      b.set(x, y, ch);
    }
    while (y !== ty) {
      y += Math.sign(ty - y);
      b.set(x, y, ch);
    }
  }
}

/** An irregular ellipse of `ch`, optionally only over cells `on` allows. */
function blob(b: MapBuilder, cx: number, cy: number, rx: number, ry: number, ch: string, salt: number, rough = 0.25, on?: string): void {
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      const noise = (cellHash(x, y, salt) % 1000) / 1000 - 0.5;
      if (d >= 1 + noise * rough * 2) continue;
      if (on && !on.includes(b.get(x, y))) continue;
      b.set(x, y, ch);
    }
  }
}

/** Wide ground must sit in 2x2 blocks; wear away any strip that does not. */
function pruneStrips(b: MapBuilder, ch: string, fallback: string): void {
  for (let changed = true; changed;) {
    changed = false;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (b.get(x, y) !== ch) continue;
      const ok = [[0, 0], [-1, 0], [0, -1], [-1, -1]].some(([ox, oy]) =>
        [[0, 0], [1, 0], [0, 1], [1, 1]].every(([dx, dy]) => b.get(x + ox + dx, y + oy + dy) === ch));
      if (!ok) {
        b.set(x, y, fallback);
        changed = true;
      }
    }
  }
}

interface PackPlan {
  id: string;
  x: number;
  y: number;
  sight: number;
  depth: number;
  kind?: EncounterKind;
  /** A fixed roster instead of a daily roll. */
  fixed?: MineEnemyKind[];
  elite?: boolean;
  where: string;
}

const PACKS: readonly PackPlan[] = [
  { id: 'wilds-scouts', x: 14, y: 44, sight: 4, depth: 2, where: 'by the road' },
  { id: 'wilds-looters', x: 10, y: 34, sight: 4, depth: 3, kind: 'robbery', where: 'picking over the caravan' },
  { id: 'wilds-springs', x: 18, y: 13, sight: 4, depth: 3, where: 'at the springs' },
  { id: 'wilds-tower', x: 27, y: 23, sight: 4, depth: 4, where: 'in the ruins' },
  { id: 'wilds-obsidian', x: 21, y: 47, sight: 4, depth: 4, where: 'among the glass' },
  { id: 'wilds-warden', x: 41, y: 41, sight: 4, depth: 5, fixed: ['magma-sentinel', 'sentinel'], elite: true, where: 'holding the bridge' },
  { id: 'wilds-foot', x: 46, y: 21, sight: 4, depth: 5, where: 'under the mountain' },
  { id: 'wilds-rest', x: 36, y: 12, sight: 5, depth: 7, fixed: ['red-dragonborn', 'kobold', 'kobold'], elite: true, where: 'guarding the rest' },
  { id: 'wilds-warren', x: 55, y: 43, sight: 4, depth: 5, where: 'about the fire' },
  { id: 'wilds-chief', x: 62, y: 47, sight: 3, depth: 6, fixed: ['elite-kobold', 'elite-kobold', 'kobold'], elite: true, where: 'by the chief\'s tent' },
  { id: 'wilds-shrine', x: 60, y: 27, sight: 4, depth: 6, where: 'before the shrine' },
];

interface SecretPlan extends Secret {
  /** Fought once before the secret gives anything up. */
  guard?: { fixed: MineEnemyKind[]; depth: number; label: string };
  items?: ItemId[];
  revealAll?: boolean;
  text: string;
}

const SECRETS: readonly SecretPlan[] = [
  { id: 'wilds-strongbox', x: 10, y: 30, reveal: 2, label: 'Scorched strongbox', items: ['healthPotion', 'throwingDagger'], text: 'The lock melted shut, but the hinges did not.' },
  { id: 'wilds-emberroot', x: 19, y: 10, reveal: 2, label: 'Roots by the spring', items: ['herbEmberroot', 'herbEmberroot'], text: 'Emberroot, thriving in the steam.' },
  { id: 'wilds-mine-cache', x: 9, y: 5, reveal: 2, label: "Miner's cache", items: ['lantern', 'gemRuby'], text: 'Someone meant to come back for this.' },
  {
    id: 'wilds-cellar', x: 24, y: 21, reveal: 2, label: 'Collapsed cellar', items: ['chainShirt'],
    guard: { fixed: ['sentinel', 'sentinel'], depth: 5, label: 'Stone wakes in the cellar.' },
    text: 'Behind the fallen stones: an old soldier\'s kit.',
  },
  { id: 'wilds-obsidian', x: 26, y: 47, reveal: 2, label: 'Obsidian vein', items: ['gemOnyx', 'gemOnyx'], text: 'Black glass, cracked loose by the heat.' },
  { id: 'wilds-grave', x: 28, y: 32, reveal: 2, label: "Wanderer's grave", items: ['ironShortsword'], text: 'A blade left with its owner. They would want it used.' },
  { id: 'wilds-lookout', x: 31, y: 38, reveal: 3, label: 'Lookout crag', revealAll: true, text: 'From the top of the crag the whole basin lies open.' },
  {
    id: 'wilds-hoard', x: 41, y: 9, reveal: 2, label: 'Dragon hoard', items: ['gemDiamond', 'drakescaleHelm', 'redDrakeScale'],
    guard: { fixed: ['black-dragonborn', 'kobold', 'kobold'], depth: 8, label: 'The hoard has a keeper.' },
    text: 'Coins melted into one useless hill, and a helm worth more than all of them.',
  },
  { id: 'wilds-warren-hoard', x: 64, y: 47, reveal: 2, label: 'Kobold hoard', items: ['gemRuby', 'gemSapphire'], text: 'Shiny things, sorted by how shiny.' },
  { id: 'wilds-shrine', x: 60, y: 23, reveal: 3, label: 'Ember shrine', items: ['manaPotion'], text: 'The flame leans toward you, then settles.' },
  { id: 'wilds-hollow', x: 66, y: 34, reveal: 2, label: 'Sunlit hollow', items: ['herbMoonleaf', 'herbMoonleaf', 'herbEmberroot'], text: 'Green, somehow, in the middle of all this ash.' },
  { id: 'wilds-glass', x: 47, y: 17, reveal: 2, label: 'Glassy bubble', items: ['gemAmethyst', 'magmaCore'], text: 'A blister of cooled lava, hollow and glittering.' },
];

const LANDMARKS: readonly Landmark[] = [
  { id: 'caravan', x: 7, y: 30, name: 'the Burnt Caravan' },
  { id: 'springs', x: 14, y: 11, name: 'the Steaming Springs' },
  { id: 'mine', x: 6, y: 5, name: 'the Old Mine' },
  { id: 'tower', x: 25, y: 21, name: 'the Ruined Watchtower' },
  { id: 'obsidian', x: 23, y: 46, name: 'the Obsidian Field' },
  { id: 'grave', x: 28, y: 31, name: "the Wanderer's Grave" },
  { id: 'crag', x: 31, y: 37, name: 'the Lookout Crag' },
  { id: 'bridge', x: 37, y: 40, name: 'the Ember Bridge' },
  { id: 'rest', x: 37, y: 10, name: "the Dragon's Rest" },
  { id: 'peak', x: 60, y: 18, name: 'Cinderpeak' },
  { id: 'shrine', x: 60, y: 23, name: 'the Ember Shrine' },
  { id: 'hollow', x: 66, y: 33, name: 'the Hidden Hollow' },
  { id: 'warren', x: 57, y: 44, name: 'the Kobold Warren' },
];

let cached: LocaleDef | null = null;

/** The authored basin. Built once; every run shares the same land. */
export function volcanicWilds(): LocaleDef {
  if (cached) return cached;
  const b = new MapBuilder(W, H, '.');
  const props: PropPlacement[] = [];

  // Ridges ring the basin; the south-west corner is autumn wood toward the road.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
    const band = 2 + (cellHash(x >> 2, y >> 2, 21) % 2);
    if (edge >= band) continue;
    const woods = x < 22 && y > 38;
    if (woods) {
      const roll = cellHash(x, y, 23);
      b.set(x, y, 'AaDdBbA'[roll % 7]);
    } else {
      b.set(x, y, 'M');
    }
  }

  // Cinderpeak and its western spur, with the caldera burning inside.
  blob(b, 59, 7, 15, 10, 'M', 31, 0.3);
  blob(b, 45, 4, 7, 5, 'M', 33, 0.3);
  blob(b, 60, 7, 6, 3.5, 'L', 35, 0.2);
  // The lava river: out of the caldera, down the gorge, west, then south off the map.
  b.fill(50, 7, 6, 3, 'L');
  b.fill(49, 7, 3, 22, 'L');
  b.fill(36, 26, 16, 3, 'L');
  b.fill(36, 26, 3, 26, 'L');
  for (let y = 12; y < 25; y++) {
    const roll = cellHash(49, y, 37) % 3;
    if (roll === 0) b.set(48, y, 'L');
    if (roll === 1) b.set(52, y, 'L');
  }
  for (let x = 40; x < 51; x++) {
    if (x >= 43 && x <= 46) continue;
    const roll = cellHash(x, 26, 39) % 3;
    if (roll === 0) b.set(x, 25, 'L');
    if (roll === 1) b.set(x, 29, 'L');
  }
  for (let y = 30; y < H; y++) {
    if (y >= 38 && y <= 43) continue;
    const roll = cellHash(36, y, 41) % 3;
    if (roll === 0) b.set(35, y, 'L');
    if (roll === 1) b.set(39, y, 'L');
  }

  // The lookout crag and the walls of the hidden hollow.
  blob(b, 31, 36, 2.5, 1.6, 'M', 43, 0.2);
  b.fill(63, 29, 7, 9, 'M');
  blob(b, 66.5, 33, 2.6, 2.6, '.', 45, 0.15);
  b.fill(63, 33, 2, 1, '.');

  // Scorched ground along the lava.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (b.get(x, y) !== '.') continue;
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2 && !near; dx++) near = b.get(x + dx, y + dy) === 'L';
    if (near && cellHash(x, y, 47) % 10 < 7) b.set(x, y, ',');
  }
  // Ash, glass and the few things that still grow.
  b.scatter(0, 0, W, H, 'xxGGrr""wwVNB', 0.1, 49);
  b.scatter(0, 0, W, H, 'GVr', 0.16, 51, ',');

  // --- The Old Mine, cut into the north-west ridge.
  b.clearDecor(3, 3, 8, 5).fill(3, 3, 8, 5, '.');
  props.push({ x: 5, y: 3, kind: 'cave' });
  b.set(4, 4, 'i').set(7, 4, 'i').set(3, 5, 'k').set(4, 6, 'k').set(10, 4, 'u');

  // --- The Steaming Springs: sulphur flats, hot pools and vents.
  b.clearDecor(10, 7, 11, 9);
  blob(b, 14, 11, 5, 3.5, '_', 53, 0.2, '.,"w');
  b.fill(12, 9, 2, 2, 'o');
  b.fill(16, 11, 3, 2, 'o');
  b.set(11, 13, 'V').set(18, 9, 'V').set(20, 12, 'V').set(10, 9, '"').set(20, 15, 'w');

  // --- The Ruined Watchtower.
  b.clearDecor(19, 15, 14, 12);
  b.fill(23, 20, 6, 5, '#');
  for (const x of [22, 23, 24, 25, 27, 28, 29]) b.set(x, 18, 'W');
  for (const y of [18, 19, 20, 21, 24, 25]) b.set(21, y, 'W');
  for (const y of [18, 19, 20, 22]) b.set(30, y, 'W');
  b.fill(29, 15, 3, 3, 'W');
  b.set(20, 23, 'r').set(22, 26, 'r').set(31, 21, 'r').set(29, 25, 'r').set(20, 17, 'x');
  props.push({ x: 19, y: 20, kind: 'boulder' });

  // --- The Burnt Caravan.
  b.clearDecor(4, 27, 8, 7, ',');
  blob(b, 8, 30, 3.5, 2.5, ',', 55, 0.2);
  props.push({ x: 6, y: 29, kind: 'cart' });
  b.set(9, 29, 'u').set(9, 31, 'k').set(4, 30, 'k').set(5, 32, 'n').set(8, 32, 'N').set(11, 28, 'x');

  // --- The Obsidian Field.
  blob(b, 23, 46, 7, 3, ',', 57, 0.25);
  b.scatter(16, 42, 15, 8, 'GGGVr', 0.2, 59, ',');
  b.clearDecor(28, 43, 2, 2, ',');
  props.push({ x: 28, y: 43, kind: 'boulder' });

  // --- The Wanderer's Grave.
  b.clearDecor(25, 30, 7, 4);
  b.set(27, 31, 'g').set(29, 31, 'g').set(26, 32, '*').set(30, 33, '*').set(31, 32, 'x');

  // --- The Dragon's Rest at the foot of the spur.
  b.clearDecor(31, 7, 14, 9, ',');
  blob(b, 37, 11, 6, 3.5, ',', 61, 0.2, '.');
  b.fill(39, 7, 2, 2, '.');
  props.push({ x: 39, y: 7, kind: 'cave' });
  props.push({ x: 33, y: 9, kind: 'boulder' });
  props.push({ x: 43, y: 12, kind: 'boulder' });
  for (const [x, y] of [[35, 10], [38, 13], [41, 11], [34, 13], [40, 14], [36, 8]] as const) b.set(x, y, 'N');

  // --- The Ember Shrine under the mountain.
  b.clearDecor(55, 18, 10, 9);
  b.fill(55, 18, 10, 9, '.');
  b.fill(56, 22, 8, 4, '#');
  props.push({ x: 59, y: 19, kind: 'statue' });
  props.push({ x: 57, y: 20, kind: 'brazier' });
  props.push({ x: 62, y: 20, kind: 'brazier' });

  // --- The Hidden Hollow.
  b.clearDecor(63, 30, 7, 7);
  b.set(65, 31, 'a').set(68, 32, 'A').set(68, 35, 'a').set(65, 35, '*').set(67, 36, '*').set(66, 32, '"').set(67, 34, '*');

  // --- The Kobold Warren.
  b.clearDecor(48, 38, 18, 11);
  b.fill(48, 38, 18, 11, '.');
  blob(b, 57, 44, 5, 3, ',', 63, 0.25);
  b.set(57, 44, '!').set(55, 45, 'l').set(59, 45, 'l').set(55, 41, 'k').set(56, 41, 'u').set(59, 47, 'n');
  b.set(62, 42, 'k').set(61, 48, 'N').set(49, 47, 's').set(65, 40, 'u');
  props.push({ x: 51, y: 39, kind: 'tent', color: 0x9a7650 });
  props.push({ x: 60, y: 39, kind: 'tent', color: 0x8a5a3c });
  props.push({ x: 63, y: 44, kind: 'tent', color: 0xa06a48 });
  props.push({ x: 50, y: 45, kind: 'tent', color: 0x9a7650 });
  props.push({ x: 53, y: 43, kind: 'banner', color: 0xa33a2a });

  // Boulders dotted across the open ground.
  for (const [x, y] of [[14, 31], [44, 34], [26, 10], [9, 20], [58, 33], [44, 46], [31, 45]] as const) {
    b.clearDecor(x, y, 2, 2);
    props.push({ x, y, kind: 'boulder' });
  }

  // Roads: the old paved way and its branches.
  track(b, [[7, 51], [7, 46], [12, 46], [12, 40], [18, 40], [18, 34], [22, 34], [22, 26], [25, 26], [25, 25]]);
  track(b, [[26, 19], [26, 15], [33, 15], [33, 12]]);
  track(b, [[33, 15], [40, 15], [40, 20], [44, 20], [44, 25]]);
  track(b, [[18, 40], [35, 40]]);
  track(b, [[39, 40], [46, 40], [46, 43], [50, 43]]);
  track(b, [[12, 40], [12, 36], [8, 36], [8, 33]]);
  track(b, [[22, 26], [16, 26], [16, 14], [8, 14], [8, 7], [6, 7], [6, 5]]);
  track(b, [[18, 40], [18, 44], [22, 44]]);
  track(b, [[22, 34], [27, 34], [27, 33]]);
  track(b, [[44, 29], [44, 31], [53, 31], [53, 24], [55, 24]]);
  track(b, [[53, 31], [53, 36], [56, 36], [56, 38]]);
  track(b, [[56, 36], [61, 36], [61, 33], [62, 33]]);

  // Bridges over the river.
  b.fill(36, 40, 3, 2, 'J');
  b.fill(44, 26, 2, 3, 'K');

  // The way in from the road.
  b.clearDecor(4, 47, 7, 5);
  b.fill(4, 47, 7, 5, '.');
  track(b, [[7, 51], [7, 46]]);

  // Anything placed on top of a secret or a pack's post gives way to ground.
  for (const spot of [...SECRETS, ...PACKS]) {
    const ch = b.get(spot.x, spot.y);
    if (!'.,;#_:'.includes(ch)) b.set(spot.x, spot.y, '.');
  }
  for (const ch of ['_', '#', 'o']) pruneStrips(b, ch, '.');

  const exits: ExitDef[] = [{ x: 5, y: H - 1, w: 5, h: 1, label: 'Back to Ashfall Crossing' }];
  cached = {
    id: WILDS_ID,
    name: 'The Volcanic Wilds',
    ground: 'dirt',
    altGround: 'ember',
    wallStone: 0x5a4f4c,
    terrain: b.build(),
    buildings: [],
    props,
    exits,
    spawn: { x: 7, y: 49 },
  };
  return cached;
}

function mineSpawn(kind: MineEnemyKind, depth: number): EncounterSpawn {
  return { family: 'mine', spec: { kind, level: mineEnemyLevel(depth) } };
}

function describe(spawns: EncounterSpawn[]): string {
  const counts = new Map<string, number>();
  for (const spawn of spawns) {
    const kind = spawnKindId(spawn);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts].map(([kind, n]) => `${n} ${creatureName(kind)}${n > 1 ? 's' : ''}`).join(', ');
}

function tintOf(spawns: EncounterSpawn[]): number {
  const first = spawns[0];
  return first?.family === 'mine' ? MINE_ENEMY_DEFS[first.spec.kind].tint : 0xc8a890;
}

/** Today's packs: rosters reroll each day, so a rested party meets new faces. */
export function wildsPacks(run: ExplorationRun): WildPack[] {
  return PACKS.map((plan) => {
    const dice = new Dice((hashString(`${plan.id}:${run.day}`) ^ run.seed) >>> 0);
    const spawns = plan.fixed
      ? plan.fixed.map((kind) => mineSpawn(kind, plan.depth))
      : rollEncounter('wilds', plan.kind ?? 'monsters', plan.depth, dice);
    return {
      id: plan.id,
      x: plan.x,
      y: plan.y,
      sight: plan.sight,
      depth: plan.depth,
      spawns,
      label: `${describe(spawns)} ${plan.where}.`,
      tint: tintOf(spawns),
      elite: plan.elite,
    };
  });
}

function searchWilds(run: ExplorationRun, secret: Secret): SecretResult {
  const plan = SECRETS.find((s) => s.id === secret.id);
  if (!plan) return { message: 'Nothing here after all.' };
  if (plan.guard && run.groupsBeaten[`${plan.id}-guard`] == null) {
    const spawns = plan.guard.fixed.map((kind) => mineSpawn(kind, plan.guard!.depth));
    return {
      message: plan.guard.label,
      fight: {
        id: `${plan.id}-guard`,
        x: plan.x,
        y: plan.y,
        sight: 0,
        depth: plan.guard.depth,
        spawns,
        label: `${plan.guard.label} ${describe(spawns)}.`,
        tint: tintOf(spawns),
        elite: true,
      },
    };
  }
  const found: string[] = [];
  for (const item of plan.items ?? []) grantToParty(run, item);
  if (plan.items?.length) found.push(plan.items.length === 1 ? 'a find' : `${plan.items.length} finds`);
  const tail = found.length ? ` (${found.join(', ')})` : '';
  return { message: `${plan.text}${tail}`, revealAll: plan.revealAll };
}

export function resolveWilds(run: ExplorationRun, id: string): ResolvedLocale | null {
  if (id !== WILDS_ID) return null;
  return {
    def: volcanicWilds(),
    kind: 'wilds',
    zone: 'wilds',
    depth: 4,
    packs: wildsPacks(run),
    secrets: SECRETS.map(({ id: sid, x, y, reveal, label }) => ({ id: sid, x, y, reveal, label })),
    subtitle: 'Cinderpeak smoulders',
    search: searchWilds,
    fogChunk: 6,
    landmarks: [...LANDMARKS],
  };
}

export const WILDS_SECRET_COUNT = SECRETS.length;
