/** The reward tier of a Dexterity dodge roll. */
export type DodgeTier = 'none' | 'pair' | 'triple' | 'quad';

/** Classify repeated d6 faces into the dodge reward tiers. */
export function analyzeDodge(rolls: readonly number[]): DodgeTier {
  const counts = new Map<number, number>();
  for (const roll of rolls) counts.set(roll, (counts.get(roll) ?? 0) + 1);
  let pairs = 0;
  let maxCount = 0;
  for (const count of counts.values()) {
    if (count >= 2) pairs++;
    if (count > maxCount) maxCount = count;
  }
  if (maxCount >= 4 || pairs >= 3) return 'quad';
  if (maxCount >= 3 || pairs >= 2) return 'triple';
  if (maxCount >= 2) return 'pair';
  return 'none';
}

/** Perfect dodge outcomes open one action-free bonus-action window. */
export function dodgeGrantsBonusAction(tier: DodgeTier): boolean {
  return tier === 'triple' || tier === 'quad';
}