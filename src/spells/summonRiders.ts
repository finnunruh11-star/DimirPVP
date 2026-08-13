// =============================================================================
//  SUMMON ON-HIT RIDERS
// -----------------------------------------------------------------------------
//  The extra effect a Life-class summon's strike carries, keyed by summon kind.
//  Keeping them here (rather than as closures inside each spell) means a summon
//  rebuilt from a saved scenario can get its rider back — a function cannot
//  survive a JSON round-trip, but its kind can.
// =============================================================================

import { RANGE_UNIT } from '../config/constants';
import { dmg } from '../core/Damage';
import type { Mage } from '../core/Mage';
import {
  applyControl,
  applyDebuff,
  applyDot,
  applyStun,
  dispelVeil,
  type EffectContext,
} from '../effects/effects';

type SummonOnHit = (ctx: EffectContext, target: Mage) => void;

const R = (units: number): number => units * RANGE_UNIT;

const RIDERS: Record<string, (self: Mage) => SummonOnHit> = {
  'neural-leech': () => (ctx, victim) => {
    applyDot(ctx, victim, {
      name: 'Neural Rot',
      duration: 3,
      damage: dmg(1, 'corrosive', 'sanity'),
    });
    applyControl(ctx, victim, { name: 'Reaction Eaten', mode: 'expose', duration: 3 });
  },
  'thought-leech': (self) => (ctx, victim) => {
    const charged = victim.loadout.filter((word) => (victim.charges[word] ?? 0) > 0);
    if (charged.length === 0) {
      ctx.log(`${self.name} finds no charged thought to drain.`);
      return;
    }
    const stolen = ctx.rng.pick(charged);
    victim.charges[stolen] = Math.max(0, (victim.charges[stolen] ?? 0) - 1);
    const owner = self.summonOwnerIndex != null ? ctx.game.mages[self.summonOwnerIndex] : undefined;
    if (!owner?.alive) return;
    if (owner.loadout.includes(stolen)) {
      owner.charges[stolen] = (owner.charges[stolen] ?? 0) + 1;
      ctx.log(`${self.name} transfers ${stolen} from ${victim.name} to ${owner.name}.`);
    } else {
      owner.gainMana(2);
      ctx.log(`${self.name} digests ${victim.name}'s ${stolen} thought into 2 mana.`);
    }
  },
  binder: () => (ctx, victim) => {
    applyStun(ctx, victim, { duration: 2, type: 'movement' });
  },
  archer: () => (ctx, victim) => {
    dispelVeil(ctx, victim);
    applyDebuff(ctx, victim, { name: 'Mired', duration: 2, mods: { moveRange: -R(3) } });
  },
};

/** Give `unit` the strike rider its kind carries, if it has one. */
export function attachSummonRider(unit: Mage, kind: string): void {
  const make = RIDERS[kind];
  if (!make || !unit.intrinsicMelee) return;
  unit.intrinsicMelee.onHit = make(unit);
}
