import { FIELD } from '../config/constants';
import type { Mage } from '../core/Mage';
import { dist, type Vec2 } from '../core/utils';
import type { EffectContext } from '../effects/effects';
import type { Spell } from './Spell';

/**
 * Fresh aim for a spell cast by someone who did not choose it (a stolen or
 * mimicked thought), picked by the new caster. `fallback` supplies the points a
 * headless or AI pick reuses. Null lets the spell go.
 */
export async function aimSpell(
  ctx: EffectContext,
  spell: Spell,
  fallback: { targetPoint?: Vec2; targetPoint2?: Vec2 } = {}
): Promise<{ target: Mage | null; point: Vec2 | null; point2: Vec2 | null } | null> {
  const thief = ctx.caster;
  const reach = Number.isFinite(spell.range) ? spell.range : Math.hypot(FIELD.w, FIELD.h);
  const prompt = (what: string): string => `${thief.name}: ${what} for the stolen ${spell.name}.`;
  switch (spell.targeting) {
    case 'none':
      return { target: null, point: null, point2: null };
    case 'self':
      return { target: thief, point: null, point2: null };
    case 'enemy': {
      const foes = ctx.game.validSpellTargets(spell, thief).filter((m) => m.team !== thief.team);
      if (foes.length === 0) return null;
      const picked = ctx.requestEnemy
        ? await ctx.requestEnemy({ range: reach, origin: thief.pos, prompt: prompt('choose an enemy') })
        : [...foes].sort((a, b) => dist(a.pos, thief.pos) - dist(b.pos, thief.pos))[0];
      return picked && foes.includes(picked) ? { target: picked, point: null, point2: null } : null;
    }
    case 'ally':
    case 'any': {
      // Self, then allies, first: a delegated pick takes the head of the list.
      const rank = (m: Mage): number => (m === thief ? 0 : m.team === thief.team ? 1 : 2);
      const candidates = ctx.game
        .validSpellTargets(spell, thief)
        .filter((m) => spell.targeting === 'any' || m.team === thief.team)
        .sort((a, b) => rank(a) - rank(b));
      if (candidates.length === 0) return null;
      const picked = ctx.requestCombatant
        ? await ctx.requestCombatant({
            candidates,
            range: Infinity,
            origin: thief.pos,
            prompt: prompt('choose a target'),
          })
        : candidates[0];
      return picked && candidates.includes(picked) ? { target: picked, point: null, point2: null } : null;
    }
    case 'point': {
      const point = ctx.requestPoint
        ? await ctx.requestPoint({
            maxRange: reach,
            minRange: spell.minRange,
            origin: thief.pos,
            prompt: prompt('choose a point'),
          })
        : fallback.targetPoint ?? ctx.game.opponentOf(thief).pos;
      if (!point) return null;
      if (!spell.twoPointAim) return { target: null, point, point2: null };
      const point2 = ctx.requestPoint
        ? await ctx.requestPoint({ maxRange: reach, origin: thief.pos, prompt: prompt('choose the second point') })
        : fallback.targetPoint2 ?? null;
      return point2 ? { target: null, point, point2 } : null;
    }
  }
}
