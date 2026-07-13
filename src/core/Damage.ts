// Damage model. Two classes (where the damage is applied) and several types
// (the flavour / future resistance hooks).

export type DamageClass = 'physical' | 'sanity';
export type DamageType =
  | 'pierce'
  | 'shatter'
  | 'shadow'
  | 'corrosive'
  | 'slashing'
  | 'fire'
  | 'heat'
  | 'light'
  | 'generic';

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
