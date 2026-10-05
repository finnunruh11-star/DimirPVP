import type { Dice } from '../core/Dice';
import type { ItemId } from '../core/Items';

export const MINE_DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type MineDirection = (typeof MINE_DIRECTIONS)[number];

export const MINE_DIRECTION_LABEL: Record<MineDirection, string> = {
  N: 'North',
  NE: 'North-east',
  E: 'East',
  SE: 'South-east',
  S: 'South',
  SW: 'South-west',
  W: 'West',
  NW: 'North-west',
};

export const MINE_OPPOSITE_DIRECTION: Record<MineDirection, MineDirection> = {
  N: 'S',
  NE: 'SW',
  E: 'W',
  SE: 'NW',
  S: 'N',
  SW: 'NE',
  W: 'E',
  NW: 'SE',
};

export const MINE_DIRECTION_VECTOR: Record<MineDirection, { x: number; y: number }> = {
  N: { x: 0, y: -1 },
  NE: { x: 1, y: -1 },
  E: { x: 1, y: 0 },
  SE: { x: 1, y: 1 },
  S: { x: 0, y: 1 },
  SW: { x: -1, y: 1 },
  W: { x: -1, y: 0 },
  NW: { x: -1, y: -1 },
};

export type MineRoomKind = 'empty' | 'enemies' | 'treasure' | 'ore' | 'shop';
export type MineOreKind = 'coal' | 'copper' | 'iron' | 'gold';

export interface MineOreDef {
  kind: MineOreKind;
  name: string;
  miningValue: number;
  failCount: number;
  item: ItemId;
}

export const MINE_ORE_DEFS: Record<MineOreKind, MineOreDef> = {
  coal: { kind: 'coal', name: 'Coal', miningValue: 12, failCount: 6, item: 'oreCoal' },
  copper: { kind: 'copper', name: 'Copper', miningValue: 18, failCount: 5, item: 'oreCopper' },
  iron: { kind: 'iron', name: 'Iron', miningValue: 24, failCount: 5, item: 'oreIron' },
  gold: { kind: 'gold', name: 'Gold', miningValue: 30, failCount: 4, item: 'oreGold' },
};

export const MINE_TRAP_DAMAGE = ['1d3', '2d4', '3d3', '2d6', '1d20'] as const;
export type MineTrapDamage = (typeof MINE_TRAP_DAMAGE)[number];
/** What each trap is, by the damage it deals. */
export const MINE_TRAP_NAME: Record<MineTrapDamage, string> = {
  '1d3': 'Dart trap',
  '2d4': 'Spike plate',
  '3d3': 'Swinging blade',
  '2d6': 'Rockfall',
  '1d20': 'Cave-in',
};
export const MINE_TRAP_CHANCE = 0.1;
export const MINE_ROOM_EXTRA_EXIT_CHANCE = 0.25;
export const MINE_LIGHT_TRAP_SPOT_CHANCE = 0.2;
export const MINE_TRAP_DODGE_CHANCE = 0.1;
export const MINE_SPOTTED_TRAP_DODGE_CHANCE = 0.65;
export const MAX_MINE_NODES = 512;
export const MINE_SIDE_EXIT_CHANCE = 0.04;

export interface MinePassageTrap {
  damage: MineTrapDamage;
  triggered: boolean;
}

export interface MineTrapAvoidance {
  spotted: boolean;
  dodgeChance: number;
  dodged: boolean;
}

export function rollMineTrapAvoidance(hasActiveLight: boolean, rng: Dice): MineTrapAvoidance {
  const spotted = hasActiveLight && rng.chance(MINE_LIGHT_TRAP_SPOT_CHANCE);
  const dodgeChance = spotted ? MINE_SPOTTED_TRAP_DODGE_CHANCE : MINE_TRAP_DODGE_CHANCE;
  return { spotted, dodgeChance, dodged: rng.chance(dodgeChance) };
}

export interface MineTrapHarm {
  /** HP the trap takes. */
  dealt: number;
  fatal: boolean;
  /** Full health saved them from a killing blow: they are left at 1 HP. */
  clung: boolean;
}

/** What a trap's roll does to someone at `hp` of `maxHp`: at full health it cannot kill, only leave them at 1 HP. */
export function mineTrapHarm(amount: number, hp: number, maxHp: number): MineTrapHarm {
  if (amount < hp) return { dealt: amount, fatal: false, clung: false };
  if (hp >= maxHp && hp > 1) return { dealt: hp - 1, fatal: false, clung: true };
  return { dealt: hp, fatal: true, clung: false };
}

export interface MineRoomState {
  kind: MineRoomKind;
  entered: boolean;
  resolved: boolean;
  oreKind?: MineOreKind;
  oreAmount?: number;
}

/** First visits and reusable resource rooms stop traversal; searched rooms do not. */
export function mineRoomNeedsInteraction(room: MineRoomState): boolean {
  return !room.entered || room.kind === 'shop' || (room.kind === 'ore' && !room.resolved);
}

export interface MineMazeNode {
  id: number;
  kind: 'crossroad' | 'room';
  mapX: number;
  mapY: number;
  /** `null` marks a passage whose far end has not been generated yet. */
  exits: Partial<Record<MineDirection, number | null>>;
  /** Predetermined one-shot traps, shared by both directions of a linked passage. */
  traps: Partial<Record<MineDirection, MinePassageTrap>>;
  room?: MineRoomState;
  /** A rare way to the surface, independent of the entrance at node 0. */
  escape?: boolean;
}

export interface MineMazeState {
  nodes: Record<number, MineMazeNode>;
  currentNodeId: number;
  nextNodeId: number;
  steps: number;
  /** Direction used on the most recent journey, for a room's Turn Around choice. */
  arrivedVia?: MineDirection;
  /** No supply rooms: the Mines as an Exploration run finds them. */
  noShops?: boolean;
  /** Seeds how far apart the grid's columns and rows stand (mineLayout.ts); absent, evenly. */
  layoutSeed?: number;
}

export interface MineTravelResult {
  node: MineMazeNode;
  isNew: boolean;
  trap: MineTrapDamage | null;
  blocked?: boolean;
}

export interface MineRollRecord {
  vein: number;
  strike: number;
  roll: number;
  progress: number;
  durabilityLost: boolean;
  outcome?: 'extracted' | 'collapsed' | 'no-pickaxe';
}

export interface MineOreResult {
  extracted: number;
  collapsed: number;
  /** One entry per extracted vein; hauled home rather than sold at the rock face. */
  materials: ItemId[];
  pickaxes: number[];
  rolls: MineRollRecord[];
}

function shuffledDirections(rng: Dice): MineDirection[] {
  const directions = [...MINE_DIRECTIONS];
  for (let i = directions.length - 1; i > 0; i--) {
    const j = Math.floor(rng.float() * (i + 1));
    [directions[i], directions[j]] = [directions[j], directions[i]];
  }
  return directions;
}

function rollPassageTrap(rng: Dice): MinePassageTrap | undefined {
  if (!rng.chance(MINE_TRAP_CHANCE)) return undefined;
  return { damage: rng.pick(MINE_TRAP_DAMAGE), triggered: false };
}

function makeExits(
  rng: Dice,
  required?: MineDirection,
  preferMore = false,
  requiredTrap?: MinePassageTrap
): Pick<MineMazeNode, 'exits' | 'traps'> {
  const roomBonus = preferMore && rng.chance(MINE_ROOM_EXTRA_EXIT_CHANCE) ? 1 : 0;
  const count = Math.min(4, rng.die(4) + roomBonus);
  const picked = shuffledDirections(rng).slice(0, count);
  if (required && !picked.includes(required)) picked[picked.length - 1] = required;
  const exits = Object.fromEntries(
    picked.map((direction) => [direction, null])
  ) as MineMazeNode['exits'];
  const traps: MineMazeNode['traps'] = {};
  for (const direction of picked) {
    if (direction === required) {
      if (requiredTrap) traps[direction] = requiredTrap;
      continue;
    }
    const trap = rollPassageTrap(rng);
    if (trap) traps[direction] = trap;
  }
  return { exits, traps };
}

function rollRoomKind(rng: Dice, shops: boolean): MineRoomKind {
  const roll = rng.die(100);
  if (roll <= 34) return 'enemies';
  if (roll <= 54) return 'ore';
  if (roll <= 69) return 'treasure';
  if (roll <= 79) return shops ? 'shop' : 'empty';
  return 'empty';
}

function rollOreKind(rng: Dice): MineOreKind {
  const roll = rng.die(100);
  if (roll <= 35) return 'coal';
  if (roll <= 65) return 'copper';
  if (roll <= 88) return 'iron';
  return 'gold';
}

function makeNode(
  id: number,
  rng: Dice,
  mapX: number,
  mapY: number,
  back?: MineDirection,
  backTrap?: MinePassageTrap,
  shops = true
): MineMazeNode {
  const isRoom = rng.chance(0.3);
  const kind: MineMazeNode['kind'] = isRoom ? 'room' : 'crossroad';
  const roomKind = isRoom ? rollRoomKind(rng, shops) : undefined;
  const layout = makeExits(rng, back, isRoom, backTrap);
  return {
    id,
    kind,
    mapX,
    mapY,
    exits: layout.exits,
    traps: layout.traps,
    room: roomKind
      ? {
          kind: roomKind,
          entered: false,
          resolved: false,
          oreKind: roomKind === 'ore' ? rollOreKind(rng) : undefined,
        }
      : undefined,
  };
}

/** Start at a junction with unexplored passages in 1-4 of the eight directions. */
export function createMineMaze(rng: Dice, options: { shops?: boolean; layoutSeed?: number } = {}): MineMazeState {
  const layout = makeExits(rng);
  const start: MineMazeNode = {
    id: 0,
    kind: 'crossroad',
    mapX: 0,
    mapY: 0,
    exits: layout.exits,
    traps: layout.traps,
  };
  return {
    nodes: { 0: start }, currentNodeId: 0, nextNodeId: 1, steps: 0,
    noShops: options.shops === false || undefined, layoutSeed: options.layoutSeed,
  };
}

export function currentMineNode(maze: MineMazeState): MineMazeNode {
  return maze.nodes[maze.currentNodeId];
}

/** Decode only the known fields of an Adventure mine save; reject broken graph topology. */
export function parseMineMaze(value: unknown): MineMazeState | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const entries = raw.nodes && typeof raw.nodes === 'object' ? Object.entries(raw.nodes) : [];
  if (entries.length < 1 || entries.length > MAX_MINE_NODES) return null;
  const nodes: MineMazeState['nodes'] = Object.create(null);
  const coords = new Set<string>();
  const integer = (number: unknown, min: number, max: number): number | null =>
    typeof number === 'number' && Number.isInteger(number) && number >= min && number <= max ? number : null;
  for (const [key, value] of entries) {
    if (!value || typeof value !== 'object') return null;
    const node = value as Record<string, unknown>;
    const id = integer(node.id, 0, MAX_MINE_NODES - 1);
    const mapX = integer(node.mapX, -MAX_MINE_NODES, MAX_MINE_NODES);
    const mapY = integer(node.mapY, -MAX_MINE_NODES, MAX_MINE_NODES);
    if (id === null || String(id) !== key || mapX === null || mapY === null ||
      (node.kind !== 'room' && node.kind !== 'crossroad') || !node.exits || typeof node.exits !== 'object' ||
      !node.traps || typeof node.traps !== 'object') return null;
    const coordinate = `${mapX},${mapY}`;
    if (coords.has(coordinate)) return null;
    coords.add(coordinate);
    const exits: MineMazeNode['exits'] = {};
    const traps: MineMazeNode['traps'] = {};
    const rawExits = node.exits as Record<string, unknown>;
    const rawTraps = node.traps as Record<string, unknown>;
    if (Object.keys(rawExits).some((direction) => !MINE_DIRECTIONS.includes(direction as MineDirection)) ||
      Object.keys(rawTraps).some((direction) => !MINE_DIRECTIONS.includes(direction as MineDirection))) return null;
    for (const direction of MINE_DIRECTIONS) {
      if (!Object.prototype.hasOwnProperty.call(rawExits, direction)) continue;
      const to = rawExits[direction];
      if (to !== null && integer(to, 0, MAX_MINE_NODES - 1) === null) return null;
      exits[direction] = to as number | null;
      const trap = rawTraps[direction];
      if (trap !== undefined) {
        if (!trap || typeof trap !== 'object' ||
          !MINE_TRAP_DAMAGE.includes((trap as MinePassageTrap).damage)) return null;
        traps[direction] = { damage: (trap as MinePassageTrap).damage, triggered: (trap as MinePassageTrap).triggered === true };
      }
    }
    let room: MineRoomState | undefined;
    if (node.kind === 'room') {
      const data = node.room;
      if (!data || typeof data !== 'object') return null;
      const rawRoom = data as Record<string, unknown>;
      if (!['empty', 'enemies', 'treasure', 'ore'].includes(String(rawRoom.kind))) return null;
      const oreKind = rawRoom.oreKind;
      if (oreKind !== undefined && !Object.prototype.hasOwnProperty.call(MINE_ORE_DEFS, String(oreKind))) return null;
      const oreAmount = rawRoom.oreAmount === undefined ? undefined : integer(rawRoom.oreAmount, 0, 3);
      if (oreAmount === null) return null;
      room = {
        kind: rawRoom.kind as MineRoomKind, entered: rawRoom.entered === true, resolved: rawRoom.resolved === true,
        oreKind: oreKind as MineOreKind | undefined, oreAmount,
      };
    }
    nodes[id] = { id, kind: node.kind, mapX, mapY, exits, traps, room, escape: node.escape === true } as MineMazeNode;
  }
  if (!nodes[0] || nodes[0].mapX !== 0 || nodes[0].mapY !== 0 || nodes[0].escape ||
    !Number.isInteger(raw.nextNodeId) || (raw.nextNodeId as number) <= Math.max(...Object.keys(nodes).map(Number)) ||
    (raw.nextNodeId as number) > MAX_MINE_NODES) return null;
  const maze: MineMazeState = {
    nodes, currentNodeId: 0, nextNodeId: raw.nextNodeId as number,
    steps: integer(raw.steps, 0, 1_000_000) ?? 0, noShops: true,
    layoutSeed: integer(raw.layoutSeed, 0, 0xffffffff) ?? undefined,
  };
  const reached = new Set<number>([0]);
  const queue = [0];
  const diagonals = new Set<string>();
  for (let head = 0; head < queue.length; head++) {
    const node = nodes[queue[head]];
    for (const direction of MINE_DIRECTIONS) {
      const to = node.exits[direction];
      if (to == null) continue;
      const target = nodes[to];
      const vector = MINE_DIRECTION_VECTOR[direction];
      const reverse = MINE_OPPOSITE_DIRECTION[direction];
      if (!target || target.mapX !== node.mapX + vector.x || target.mapY !== node.mapY + vector.y ||
        target.exits[reverse] !== node.id) return null;
      if (node.id < to && vector.x && vector.y) {
        const crossing = `${node.mapX + target.mapX},${node.mapY + target.mapY}`;
        if (diagonals.has(crossing)) return null;
        diagonals.add(crossing);
      }
      const forwardTrap = node.traps[direction];
      const backTrap = target.traps[reverse];
      if (forwardTrap && backTrap && forwardTrap.damage !== backTrap.damage) return null;
      if (forwardTrap || backTrap) {
        const shared = { damage: (forwardTrap ?? backTrap)!.damage, triggered: !!(forwardTrap?.triggered || backTrap?.triggered) };
        node.traps[direction] = shared;
        target.traps[reverse] = shared;
      }
      if (!reached.has(to)) {
        reached.add(to);
        queue.push(to);
      }
    }
  }
  if (reached.size !== entries.length) return null;
  pruneMineFrontiers(maze);
  return maze;
}

/** An unexplored passage may only meet an adjacent free cell or a matching open exit. */
function canOpenPassage(maze: MineMazeState, from: MineMazeNode, direction: MineDirection): boolean {
  const vector = MINE_DIRECTION_VECTOR[direction];
  const x = from.mapX + vector.x;
  const y = from.mapY + vector.y;
  const neighbor = Object.values(maze.nodes).find((node) => node.mapX === x && node.mapY === y);
  if (neighbor && neighbor.exits[MINE_OPPOSITE_DIRECTION[direction]] !== null) return false;
  if (!vector.x || !vector.y) return true;
  const left = Object.values(maze.nodes).find((node) => node.mapX === x && node.mapY === from.mapY);
  const right = Object.values(maze.nodes).find((node) => node.mapX === from.mapX && node.mapY === y);
  if (!left || !right) return true;
  return !MINE_DIRECTIONS.some((candidate) => left.exits[candidate] === right.id);
}

/** Remove frontier doors the growing map has sealed off. Existing passages stay intact. */
function pruneMineFrontiers(maze: MineMazeState): void {
  for (const node of Object.values(maze.nodes)) {
    for (const direction of MINE_DIRECTIONS) {
      if (node.exits[direction] !== null) continue;
      if (canOpenPassage(maze, node, direction)) continue;
      delete node.exits[direction];
      delete node.traps[direction];
    }
  }
}

/** Travel one tunnel, generating and linking its far node only on first use. */
export function travelMineMaze(
  maze: MineMazeState,
  direction: MineDirection,
  rng: Dice
): MineTravelResult {
  const from = currentMineNode(maze);
  if (!Object.prototype.hasOwnProperty.call(from.exits, direction)) {
    throw new Error(`${direction} is not an exit from Mine node ${from.id}.`);
  }

  let destinationId = from.exits[direction];
  let passageTrap = from.traps[direction];
  let isNew = false;
  if (destinationId == null) {
    if (!canOpenPassage(maze, from, direction)) {
      delete from.exits[direction];
      delete from.traps[direction];
      return { node: from, isNew: false, trap: null, blocked: true };
    }
    isNew = true;
    if (maze.nextNodeId >= MAX_MINE_NODES) {
      delete from.exits[direction];
      delete from.traps[direction];
      return { node: from, isNew: false, trap: null, blocked: true };
    }
    destinationId = maze.nextNodeId++;
    const reverse = MINE_OPPOSITE_DIRECTION[direction];
    const vector = MINE_DIRECTION_VECTOR[direction];
    const mapX = from.mapX + vector.x;
    const mapY = from.mapY + vector.y;
    const neighbor = Object.values(maze.nodes).find((node) => node.mapX === mapX && node.mapY === mapY);
    if (neighbor) {
      from.exits[direction] = neighbor.id;
      neighbor.exits[reverse] = from.id;
      passageTrap = passageTrap ?? neighbor.traps[reverse];
      if (passageTrap) {
        from.traps[direction] = passageTrap;
        neighbor.traps[reverse] = passageTrap;
      }
      destinationId = neighbor.id;
      isNew = false;
    }
    if (!neighbor) {
      const destination = makeNode(destinationId, rng, mapX, mapY, reverse, passageTrap, !maze.noShops);
      if (maze.noShops && destination.kind === 'crossroad' && destinationId >= 10 && rng.chance(MINE_SIDE_EXIT_CHANCE)) {
        destination.escape = true;
      }
      destination.exits[reverse] = from.id;
      from.exits[direction] = destinationId;
      maze.nodes[destinationId] = destination;
    } else {
      maze.nextNodeId--;
    }
    pruneMineFrontiers(maze);
    const frontierRemains = Object.values(maze.nodes).some((node) =>
      Object.values(node.exits).some((exit) => exit == null)
    );
    if (!frontierRemains && maze.nextNodeId < MAX_MINE_NODES) {
      const destination = maze.nodes[destinationId];
      const extra = shuffledDirections(rng).find((candidate) =>
        !Object.prototype.hasOwnProperty.call(destination.exits, candidate) && canOpenPassage(maze, destination, candidate)
      );
      if (extra) {
        destination.exits[extra] = null;
        const trap = rollPassageTrap(rng);
        if (trap) destination.traps[extra] = trap;
      }
    }
  }

  let trap: MineTrapDamage | null = null;
  if (passageTrap && !passageTrap.triggered) {
    passageTrap.triggered = true;
    trap = passageTrap.damage;
  }

  maze.currentNodeId = destinationId;
  maze.steps += 1;
  maze.arrivedVia = direction;
  return {
    node: maze.nodes[destinationId],
    isNew,
    trap,
  };
}

/** Reveal an ore deposit's d3 vein count the first time the room is entered. */
export function revealMineOre(room: MineRoomState, rng: Dice): number {
  if (room.kind !== 'ore') return 0;
  room.oreAmount ??= rng.die(3);
  return room.oreAmount;
}

/** One ore item per extracted vein. */
const haul = (ore: MineOreDef, extracted: number): ItemId[] =>
  Array.from({ length: extracted }, () => ore.item);

/** A vein being worked: the d20s struck into it so far. */
export interface MineVein {
  progress: number;
  strikes: number;
  outcome?: 'extracted' | 'collapsed';
}

export interface MineStrike {
  roll: number;
  progress: number;
  strike: number;
  /** A natural 1 or 2 chipped the pickaxe in use. */
  durabilityLost: boolean;
  /** And that was its last point: it broke. */
  broke: boolean;
  outcome?: 'extracted' | 'collapsed';
}

/**
 * One d20 strike at `vein`: the roll adds to its progress, a natural 1 or 2 costs
 * the first pickaxe a point, reaching the ore's value extracts it and running out
 * of strikes first brings it down. Changes the vein and the pickaxes; null when
 * the vein is done or there is no pickaxe to strike with.
 */
export function strikeMineVein(ore: MineOreDef, vein: MineVein, pickaxes: number[], rng: Dice): MineStrike | null {
  if (vein.outcome || pickaxes.length === 0) return null;
  const roll = rng.die(20);
  vein.strikes += 1;
  vein.progress += roll;
  const durabilityLost = roll <= 2;
  let broke = false;
  if (durabilityLost) {
    pickaxes[0] -= 1;
    if (pickaxes[0] <= 0) {
      pickaxes.shift();
      broke = true;
    }
  }
  if (vein.progress >= ore.miningValue) vein.outcome = 'extracted';
  else if (vein.strikes >= ore.failCount) vein.outcome = 'collapsed';
  return { roll, progress: vein.progress, strike: vein.strikes, durabilityLost, broke, outcome: vein.outcome };
}

/**
 * Whether `choice` is open at a deposit while vein `active` is the one picked:
 * 'vein:N' picks another untouched vein, 'strike' swings at the picked one, and
 * 'leave' walks away. A vein once struck is seen through to the end while a
 * pickaxe lasts: no switching away from it, no leaving it half dug.
 */
export function mineDepositAllows(choice: string, veins: readonly MineVein[], active: number, pickaxes: number): boolean {
  const current = veins[active];
  const working = !!current && !current.outcome && current.strikes > 0;
  if (choice === 'leave') return !working || pickaxes === 0;
  if (choice === 'strike') return !!current && !current.outcome && pickaxes > 0;
  const match = /^vein:(\d+)$/.exec(choice);
  if (!match) return false;
  const slot = Number(match[1]);
  return slot !== active && slot < veins.length && !veins[slot].outcome && !working;
}

/** Resolve every vein, including d20 progress, collapse limits, and tool wear. */
export function resolveMineOre(
  oreKind: MineOreKind,
  amount: number,
  pickaxeDurabilities: readonly number[],
  rng: Dice
): MineOreResult {
  const ore = MINE_ORE_DEFS[oreKind];
  const pickaxes = pickaxeDurabilities.filter((value) => value > 0).map((value) => Math.min(10, value));
  const rolls: MineRollRecord[] = [];
  let extracted = 0;
  let collapsed = 0;

  for (let vein = 1; vein <= amount; vein++) {
    const state: MineVein = { progress: 0, strikes: 0 };
    while (!state.outcome) {
      const strike = strikeMineVein(ore, state, pickaxes, rng);
      if (!strike) {
        rolls.push({ vein, strike: state.strikes + 1, roll: 0, progress: state.progress, durabilityLost: false, outcome: 'no-pickaxe' });
        return { extracted, collapsed, materials: haul(ore, extracted), pickaxes, rolls };
      }
      rolls.push({
        vein,
        strike: strike.strike,
        roll: strike.roll,
        progress: strike.progress,
        durabilityLost: strike.durabilityLost,
        ...(strike.outcome ? { outcome: strike.outcome } : {}),
      });
    }
    if (state.outcome === 'extracted') extracted += 1;
    else collapsed += 1;
  }

  return { extracted, collapsed, materials: haul(ore, extracted), pickaxes, rolls };
}