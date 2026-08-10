// Damage model. Two classes (where the damage is applied) and several types
// (the flavour / future resistance hooks).

export type DamageClass = 'physical' | 'sanity';
export type DamageType =
  | 'pierce'
  | 'shatter'
  | 'shadow'
  | 'corrosive'
  | 'slashing'
  // Half of every heat hit resolves as 'light' (see Mage.resistMultiplier).
  | 'heat'
  | 'light'
  | 'typeless'
  | 'generic'
  // Reserved for restorative magic; no spell deals these yet, but creatures
  // may already declare a weakness to them.
  | 'cleansing'
  | 'healing';

export interface DamageInstance {
  amount: number;
  type: DamageType;
  damageClass: DamageClass;
}

export function dmg(
  amount: number,
  type: DamageType,
  damageClass: DamageClass = 'physical'
): DamageInstance {
  return { amount, type, damageClass };
}
