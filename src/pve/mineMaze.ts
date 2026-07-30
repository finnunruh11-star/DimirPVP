import type { Dice } from '../core/Dice';

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
  goldValue: number;
}

export const MINE_ORE_DEFS: Record<MineOreKind, MineOreDef> = {
  coal: { kind: 'coal', name: 'Coal', miningValue: 12, failCount: 6, goldValue: 0.5 },
  copper: { kind: 'copper', name: 'Copper', miningValue: 18, failCount: 5, goldValue: 1 },
  iron: { kind: 'iron', name: 'Iron', miningValue: 24, failCount: 5, goldValue: 1.5 },
  gold: { kind: 'gold', name: 'Gold', miningValue: 30, failCount: 4, goldValue: 3 },
};

export const MINE_TRAP_DAMAGE = ['1d3', '2d4', '3d3', '2d6', '1d20'] as const;
export type MineTrapDamage = (typeof MINE_TRAP_DAMAGE)[number];
export const MINE_TRAP_CHANCE = 0.08;
export const MINE_ROOM_EXTRA_EXIT_CHANCE = 0.25;
export const MINE_LIGHT_TRAP_SPOT_CHANCE = 0.2;
export const MINE_TRAP_DODGE_CHANCE = 0.1;
export const MINE_SPOTTED_TRAP_DODGE_CHANCE = 0.65;

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

export interface MineRoomState {
  kind: MineRoomKind;
  entered: boolean;
  resolved: boolean;
  oreKind?: MineOreKind;
  oreAmount?: number;
}

/** First visits and reusable resource rooms stop traversal; searched rooms do not. */
export function mineRoomNeedsInteraction(room: MineRoomState): boolean {
  return !room.entered || room.kind === 'shop' || room.kind === 'ore';
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
}

export interface MineMazeState {
  nodes: Record<number, MineMazeNode>;
  currentNodeId: number;
  nextNodeId: number;
  steps: number;
  /** Direction used on the most recent journey, for a room's Turn Around choice. */
  arrivedVia?: MineDirection;
}

export interface MineTravelResult {
  node: MineMazeNode;
  isNew: boolean;
  trap: MineTrapDamage | null;
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
  gold: number;
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

function rollRoomKind(rng: Dice): MineRoomKind {
  const roll = rng.die(100);
  if (roll <= 34) return 'enemies';
  if (roll <= 54) return 'ore';
  if (roll <= 69) return 'treasure';
  if (roll <= 79) return 'shop';
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
  backTrap?: MinePassageTrap
): MineMazeNode {
  const isRoom = rng.chance(0.3);
  const kind: MineMazeNode['kind'] = isRoom ? 'room' : 'crossroad';
  const roomKind = isRoom ? rollRoomKind(rng) : undefined;
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
export function createMineMaze(rng: Dice): MineMazeState {
  const layout = makeExits(rng);
  const start: MineMazeNode = {
    id: 0,
    kind: 'crossroad',
    mapX: 0,
    mapY: 0,
    exits: layout.exits,
    traps: layout.traps,
  };
  return { nodes: { 0: start }, currentNodeId: 0, nextNodeId: 1, steps: 0 };
}

export function currentMineNode(maze: MineMazeState): MineMazeNode {
  return maze.nodes[maze.currentNodeId];
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
  const passageTrap = from.traps[direction];
  let isNew = false;
  if (destinationId == null) {
    isNew = true;
    destinationId = maze.nextNodeId++;
    const reverse = MINE_OPPOSITE_DIRECTION[direction];
    const vector = MINE_DIRECTION_VECTOR[direction];
    let mapX = from.mapX + vector.x;
    let mapY = from.mapY + vector.y;
    const occupied = new Set(
      Object.values(maze.nodes).map((node) => `${node.mapX},${node.mapY}`)
    );
    while (occupied.has(`${mapX},${mapY}`)) {
      mapX += vector.x;
      mapY += vector.y;
    }
    const destination = makeNode(destinationId, rng, mapX, mapY, reverse, passageTrap);
    destination.exits[reverse] = from.id;
    from.exits[direction] = destinationId;
    maze.nodes[destinationId] = destination;
    const frontierRemains = Object.values(maze.nodes).some((node) =>
      Object.values(node.exits).some((exit) => exit == null)
    );
    if (!frontierRemains) {
      const extra = shuffledDirections(rng).find(
        (candidate) => !Object.prototype.hasOwnProperty.call(destination.exits, candidate)
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
    let progress = 0;
    for (let strike = 1; strike <= ore.failCount; strike++) {
      if (pickaxes.length === 0) {
        rolls.push({ vein, strike, roll: 0, progress, durabilityLost: false, outcome: 'no-pickaxe' });
        return { extracted, collapsed, gold: extracted * ore.goldValue, pickaxes, rolls };
      }

      const roll = rng.die(20);
      progress += roll;
      const durabilityLost = roll <= 2;
      if (durabilityLost) {
        pickaxes[0] -= 1;
        if (pickaxes[0] <= 0) pickaxes.shift();
      }

      const record: MineRollRecord = { vein, strike, roll, progress, durabilityLost };
      if (progress >= ore.miningValue) {
        extracted += 1;
        record.outcome = 'extracted';
        rolls.push(record);
        break;
      }
      if (strike === ore.failCount) {
        collapsed += 1;
        record.outcome = 'collapsed';
      }
      rolls.push(record);
    }
  }

  return { extracted, collapsed, gold: extracted * ore.goldValue, pickaxes, rolls };
}