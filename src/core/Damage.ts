// Damage model. Every hit has one type, and the type alone decides the pool:
// 'sanity' (mental / mill) drains sanity, every other type drains HP.

export type DamageType =
  // Mental damage. Its own type — never "shadow sanity", just sanity.
  | 'sanity'
  | 'pierce'
  | 'shatter'
  | 'shadow'
  | 'corrosive'
  | 'slashing'
  // Half of every heat hit resolves as 'light' (see Mage.resistMultiplier).
  | 'heat'
  | 'light'
  // 'blunt' is not a separate type: crushing damage resolves as 'shatter'.
  | 'cold'
  | 'water'
  | 'malforming'
  | 'typeless'
  | 'generic'
  // Reserved for restorative magic; no spell deals these yet, but creatures
  // may already declare a weakness to them.
  | 'cleansing'
  | 'healing';

export interface DamageInstance {
  amount: number;
  type: DamageType;
}

export function dmg(amount: number, type: DamageType): DamageInstance {
  return { amount, type };
}
