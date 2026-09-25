export interface MindLightningMarked {
  lightningMindStacks: number;
}

export interface MindLightningDirection {
  x: number;
  y: number;
}

const DIAGONAL = Math.SQRT1_2;

/** Clockwise compass directions, beginning at north. */
export const MIND_LIGHTNING_DIRECTIONS: readonly MindLightningDirection[] = [
  { x: 0, y: -1 },
  { x: DIAGONAL, y: -DIAGONAL },
  { x: 1, y: 0 },
  { x: DIAGONAL, y: DIAGONAL },
  { x: 0, y: 1 },
  { x: -DIAGONAL, y: DIAGONAL },
  { x: -1, y: 0 },
  { x: -DIAGONAL, y: -DIAGONAL },
];

export function mindLightningDashCount(requested: number): number {
  return Math.min(MIND_LIGHTNING_DIRECTIONS.length, Math.max(0, Math.floor(requested)));
}

export function closestMindLightningDirection<T extends MindLightningDirection>(
  aim: MindLightningDirection,
  directions: readonly T[]
): T {
  if (directions.length === 0) throw new Error('Mind Lightning needs an available direction.');
  const length = Math.hypot(aim.x, aim.y);
  if (length < 0.001) return directions[0];
  const x = aim.x / length;
  const y = aim.y / length;
  return directions.reduce((best, direction) =>
    x * direction.x + y * direction.y > x * best.x + y * best.y ? direction : best
  );
}

export function mindLightningBoltTarget<T extends MindLightningMarked>(
  caster: T,
  marked: readonly T[],
  roll: number
): T {
  let remaining = Math.max(1, Math.trunc(roll));
  if (remaining === 1) return caster;
  remaining -= 1;
  return marked.find((target) => {
    remaining -= target.lightningMindStacks;
    return remaining <= 0;
  }) ?? caster;
}

export function mindLightningDamage(baseRoll: number, stacks: number): number {
  return baseRoll * 0.5 * (stacks + 1);
}

export function applyMindLightningStack(target: MindLightningMarked, amount = 1): number {
  target.lightningMindStacks += amount;
  return target.lightningMindStacks;
}