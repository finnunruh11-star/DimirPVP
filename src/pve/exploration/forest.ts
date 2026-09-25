// The Small Forest: a dive through glades, one per depth. The trail runs south
// to north; walking on at the north edge means a fight one depth deeper, and
// turning back is safe but for the odd wanderer. Every glade is generated from
// the run seed, so the same depth always looks the same.

import { Dice } from '../../core/Dice';
import type { ItemId } from '../../core/Items';
import { cellHash } from '../../world/kenney';
import { buildLocaleModel, type ExitDef, type LocaleDef } from '../../world/locale';
import { MapBuilder } from '../../world/mapBuilder';
import { floodReach, type Cell } from '../../world/pathfind';
import { addXp } from '../progression';
import { grantToMage, hashString, withParty } from './economy';
import { creatureName, rollEncounter, spawnKindId, type EncounterSpawn } from './encounters';
import type { LocaleTravel, ResolvedLocale, Secret, SecretResult, WildPack } from './locales';
import type { ExplorationRun } from './run';

export const FOREST_PREFIX = 'forest:';
const W = 30;
const H = 22;

/** Enemy strength at a forest depth: deliberately gentle. */
export function forestFightDepth(depth: number): number {
  return 1 + Math.floor((Math.max(1, depth) - 1) * 0.6);
}

export function forestLocaleId(depth: number): string {
  return `${FOREST_PREFIX}${depth}`;
}

export function forestDepthOf(id: string): number | null {
  if (!id.startsWith(FOREST_PREFIX)) return null;
  const depth = Number(id.slice(FOREST_PREFIX.length));
  return Number.isInteger(depth) && depth >= 1 && depth <= 999 ? depth : null;
}

const PACK_TINT: Record<string, number> = {
  zombie: 0x9fb89a,
  acidZombie: 0xa8d86a,
  wisp: 0x9fd0ea,
  skeleton: 0xe8e0d0,
  'cavern-bat': 0x9a7fb0,
  kobold: 0xc98f5a,
  'elite-kobold': 0xd8a060,
  ghast: 0x7f8f9a,
};

function packTint(spawns: EncounterSpawn[]): number {
  return PACK_TINT[spawnKindId(spawns[0])] ?? 0xb0b8a0;
}

function describe(spawns: EncounterSpawn[]): string {
  const counts = new Map<string, number>();
  for (const spawn of spawns) {
    const kind = spawnKindId(spawn);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts].map(([kind, n]) => `${n} ${creatureName(kind)}${n > 1 ? 's' : ''}`).join(', ');
}

export interface Glade {
  def: LocaleDef;
  south: Cell;
  north: Cell;
  packs: WildPack[];
  secrets: Secret[];
}

/** Lay out one glade. Pure: the same seed and depth always give the same map. */
export function forestGlade(seed: number, depth: number): Glade {
  const dice = new Dice((hashString(`glade:${depth}`) ^ Math.imul(seed, 0x27d4eb2d)) >>> 0);
  const salt = (seed + depth * 7919) >>> 0;
  const b = new MapBuilder(W, H);
  // Deeper glades grow darker, older and stranger.
  const gloom = Math.min(1, (depth - 1) / 10);

  // Winding trail from the south edge to the north edge.
  const trail: Cell[] = [];
  let x = 11 + dice.die(8);
  const southX = x;
  for (let y = H - 1; y >= 0; y--) {
    trail.push({ x, y });
    if (y > 1 && y < H - 2 && dice.chance(0.45)) {
      const nx = Math.max(4, Math.min(W - 5, x + (dice.chance(0.5) ? -1 : 1) * dice.die(3)));
      const step = Math.sign(nx - x);
      while (x !== nx) {
        x += step;
        trail.push({ x, y });
      }
    }
  }
  const northX = x;

  // A clearing somewhere along the middle stretch.
  const mid = trail[Math.floor(trail.length / 2)];
  const cx = Math.max(7, Math.min(W - 8, mid.x + (dice.chance(0.5) ? -4 : 4)));
  const cy = Math.max(6, Math.min(H - 7, mid.y));
  const inClearing = (px: number, py: number): boolean => ((px - cx) / 6) ** 2 + ((py - cy) / 4.2) ** 2 < 1;
  const nearTrail = (px: number, py: number): boolean => trail.some((t) => Math.abs(t.x - px) <= 1 && Math.abs(t.y - py) <= 1);

  // Bright broadleaf near the edge of the wood, dark pine further in.
  const brightTrees = 'TtTtYyb';
  const darkTrees = 'DQdqQDv';
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      if (nearTrail(px, py) || inClearing(px, py)) continue;
      const roll = cellHash(px, py, salt);
      if (roll % 100 >= 88) continue;
      const set = (roll >>> 8) % 100 < gloom * 100 ? darkTrees : brightTrees;
      b.set(px, py, set[(roll >>> 16) % set.length]);
    }
  }
  const decor = depth >= 6 ? '"mmwsl' : depth >= 3 ? '"m*wsw' : '"**w"s';
  b.scatter(0, 0, W, H, decor, 0.16, salt + 1);

  // Landmarks in the clearing: a still pool, an old camp, or graves deep in.
  const feature = dice.float();
  if (feature < 0.4) {
    const ox = cx + (dice.chance(0.5) ? -3 : 1);
    const oy = cy - 1;
    let dry = true;
    for (let py = oy; py < oy + 2; py++) for (let px = ox; px < ox + 3; px++) if (nearTrail(px, py)) dry = false;
    if (dry) b.fill(ox, oy, 3, 2, '~');
  } else if (feature < 0.65 && depth >= 2) {
    const fx = cx + (dice.chance(0.5) ? -2 : 2);
    if (!nearTrail(fx, cy) && !nearTrail(fx + 1, cy)) b.set(fx, cy, '!').set(fx + (fx < cx ? -1 : 1), cy, 'l');
  } else if (depth >= 6) {
    for (let i = 0; i < 3; i++) {
      const gx = cx - 2 + i * 2;
      if (!nearTrail(gx, cy - 1)) b.set(gx, cy - 1, 'g');
    }
  }
  for (const t of trail) b.set(t.x, t.y, ':');

  const exits: ExitDef[] = [
    { x: southX, y: H - 1, w: 1, h: 1, label: depth === 1 ? 'Leave the forest' : `Back to depth ${depth - 1}`, to: 'back' },
    { x: northX, y: 0, w: 1, h: 1, label: `Go deeper (depth ${depth + 1})`, to: 'deeper' },
  ];
  const south = { x: southX, y: H - 2 };
  const def: LocaleDef = {
    id: forestLocaleId(depth),
    name: `Small Forest, depth ${depth}`,
    ground: depth >= 11 ? 'blight' : depth >= 6 ? 'olive' : 'moss',
    terrain: b.build(),
    buildings: [],
    props: [],
    exits,
    spawn: south,
  };

  // Packs and caches only go where the party can actually walk to.
  const model = buildLocaleModel(def);
  const reach = floodReach(W, H, model.blocked, south);
  const spots: Cell[] = [];
  for (let py = 1; py < H - 1; py++) for (let px = 1; px < W - 1; px++) {
    if (inClearing(px, py) && !nearTrail(px, py) && reach[py * W + px] === 1) spots.push({ x: px, y: py });
  }
  const take = (): Cell | null => (spots.length ? spots.splice(Math.floor(dice.float() * spots.length), 1)[0] : null);

  const fightDepth = forestFightDepth(depth);
  const packs: WildPack[] = [];
  const packCount = depth === 1 ? dice.die(2) - 1 : dice.die(3) - 1;
  for (let i = 0; i < packCount; i++) {
    const at = take();
    if (!at) break;
    const spawns = rollEncounter('forest', 'monsters', fightDepth, dice);
    packs.push({
      id: `forest-${depth}-pack-${i}`,
      x: at.x,
      y: at.y,
      sight: 4,
      depth: fightDepth,
      spawns,
      label: `${describe(spawns)} in the undergrowth.`,
      tint: packTint(spawns),
    });
  }

  const secrets: Secret[] = [];
  const cache = dice.chance(0.55) ? take() : null;
  if (cache) {
    secrets.push({ id: `forest-${depth}-cache`, x: cache.x, y: cache.y, reveal: 3, label: dice.pick(['Mossy stump', 'Old satchel', 'Glinting stones', 'Hollow log']) });
  }
  return { def, south, north: { x: northX, y: 1 }, packs, secrets };
}

/** What a forest cache holds, rolled once from the run seed. */
function searchCache(run: ExplorationRun, depth: number, secret: Secret): SecretResult {
  const dice = new Dice((hashString(secret.id) ^ run.seed) >>> 0);
  const gold = dice.die(4) + Math.floor(depth / 2);
  run.gold += gold;
  const pool: ItemId[] = depth >= 4 ? ['gemEmerald', 'gemAmethyst', 'herbMoonleaf', 'herbBogcap'] : ['herbMoonleaf', 'herbBogcap', 'healthPotion'];
  const item = dice.pick(pool);
  withParty(run, (leader) => grantToMage(leader, item));
  const levels = addXp(run, 2 + Math.floor(depth / 2));
  return { message: `${secret.label}: ${gold}g and a find worth keeping.${levels ? ' Level up!' : ''}` };
}

function gateGuardian(run: ExplorationRun, depth: number): WildPack {
  const fightDepth = forestFightDepth(depth);
  const dice = new Dice((hashString(`gate:${depth}:${run.day}`) ^ run.seed) >>> 0);
  const spawns = rollEncounter('forest', 'monsters', fightDepth, dice);
  return {
    id: `forest-${depth}-gate`,
    x: 0,
    y: 0,
    sight: 0,
    depth: fightDepth,
    spawns,
    label: `Depth ${depth}: ${describe(spawns)} bar the trail.`,
    tint: packTint(spawns),
  };
}

export function resolveForest(run: ExplorationRun, id: string): ResolvedLocale | null {
  const depth = forestDepthOf(id);
  if (depth == null) return null;
  const glade = forestGlade(run.seed, depth);
  return {
    def: glade.def,
    kind: 'forest',
    zone: 'forest',
    depth: forestFightDepth(depth),
    packs: glade.packs,
    secrets: glade.secrets,
    subtitle: `Deepest ${Math.max(run.forest.deepest, depth)}`,
    onEnter: (r) => {
      r.forest.depth = depth;
      r.forest.deepest = Math.max(r.forest.deepest, depth);
    },
    search: (r, secret) => searchCache(r, depth, secret),
    travel: (r, exit): LocaleTravel => {
      if (exit.to === 'deeper') {
        const next = forestGlade(r.seed, depth + 1);
        const gate = gateGuardian(r, depth + 1);
        const cleared = (r.groupsBeaten[gate.id] ?? -1) >= r.day;
        const then = { locale: forestLocaleId(depth + 1), at: next.south };
        if (cleared) return { t: 'locale', ...then, notice: `Depth ${depth + 1}.` };
        return { t: 'fight', pack: gate, then, fleeTo: { locale: glade.def.id, at: glade.north } };
      }
      if (depth === 1) return { t: 'world', notice: 'You leave the forest.' };
      const back = forestGlade(r.seed, depth - 1);
      const dice = new Dice((hashString(`back:${depth}:${r.steps}:${r.day}`) ^ r.seed) >>> 0);
      if (dice.chance(0.1)) {
        const spawns = rollEncounter('forest', 'monsters', forestFightDepth(depth - 1), dice);
        return {
          t: 'fight',
          pack: { id: `forest-${depth}-wanderer`, x: 0, y: 0, sight: 0, depth: forestFightDepth(depth - 1), spawns, label: `${describe(spawns)} catch you on the way back.`, tint: packTint(spawns) },
          then: { locale: back.def.id, at: back.north },
        };
      }
      return { t: 'locale', locale: back.def.id, at: back.north, notice: `Back to depth ${depth - 1}.` };
    },
  };
}
