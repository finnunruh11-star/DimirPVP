// Loosing a Hexzettel in a fight. The first part of the hex lands where it is
// aimed; a coupled part fires wherever the part before it lands: on each impact,
// at each tick of a lingering wound, or each time a laid ground bites. The sheet
// itself is read in core/hexcraft.

import { RANGE_UNIT } from '../config/constants';
import { barrierDistance } from '../core/Barrier';
import { dmg } from '../core/Damage';
import type { GameState } from '../core/GameState';
import { parseHexItemId } from '../core/hexcraft/item';
import {
  couplingMode,
  ECHO_LIMIT,
  EXPLOSION_SPLASH_RADIUS,
  FACETS,
  groundPlan,
  groundText,
  hexAim,
  hexManaCost,
  IMPACT_REACH,
  IMPLOSION_RADIUS,
  isGround,
  MISSILE_DART,
  partCount,
  partHop,
  partPotency,
  partRadius,
  partReach,
  partSide,
  partTurns,
  SIPHON_DART,
  unitPlan,
  type HexPart,
  type HexRecipe,
  type HexSide,
  type HexStep,
} from '../core/hexcraft/runes';
import { getItem, type ItemDef, type ItemId } from '../core/Items';
import type { Mage } from '../core/Mage';
import { addOrExtendStatus, type HexEcho, type Status } from '../core/Status';
import { dist, stepTowards, type Vec2 } from '../core/utils';
import {
  applyDebuff,
  applyDot,
  applyInvisibility,
  applyStun,
  dash,
  dealDamage,
  dispelVeil,
  drainDamage,
  heal,
  placeShadow,
  type DealDamageOptions,
} from './effects';

const R = (cm: number): number => cm * RANGE_UNIT;
const REGEN_KEY = 'regen:hex';

/** Where the hex is loosed: a unit or a point, as its first target rune asks. */
export interface HexAim {
  target: Mage | null;
  point: Vec2 | null;
}

/** What set a coupled part off: the unit its carrier struck, if any, and where. */
interface Impact {
  unit: Mage | null;
  point: Vec2;
}

type Origin = { aim: HexAim } | { impact: Impact };

/** One loosing of a sheet, and how often each coupling may still fire on impact. */
interface Cast {
  game: GameState;
  user: Mage;
  hex: ItemId;
  recipe: HexRecipe;
  echoes: number[];
}

interface Landing {
  part: HexPart;
  index: number;
  origin: Origin;
  potency: number;
  turns: number;
  /** Areas and fields never miss; a unit picked out can still dodge. */
  area: boolean;
}

/** The hex drawn on `itemId`, if it is a Hexzettel. */
export function hexOf(itemId: ItemId): HexRecipe | undefined {
  return (getItem(itemId) as ItemDef | undefined)?.hexzettel;
}

export function partColor(part: HexPart): number {
  return FACETS[part.effects.find((effect) => effect !== 'dot') ?? part.effects[0]].color;
}

export const hexColor = (recipe: HexRecipe): number => partColor(recipe.parts[0]);

function onSide(user: Mage, side: HexSide, m: Mage): boolean {
  return side === 'any' || (side === 'allies') === (m.team === user.team);
}

function nearestTo(game: GameState, from: Vec2, units: Mage[]): Mage[] {
  return units.sort((a, b) => dist(a.pos, from) - dist(b.pos, from) || game.mages.indexOf(a) - game.mages.indexOf(b));
}

function nearestFoe(game: GameState, user: Mage): Mage | undefined {
  return nearestTo(game, user.pos, game.mages.filter((m) => m.alive && m.team !== user.team && !game.isUnreachable(m)))[0];
}

/** Every unit a part lands on, from where it was aimed or from what set it off. */
function partUnits(game: GameState, user: Mage, part: HexPart, origin: Origin): Mage[] {
  const side = partSide(part);
  const touchable = (m: Mage): boolean => m.alive && !game.isUnreachable(m) && onSide(user, side, m);
  const impact = 'impact' in origin ? origin.impact : null;
  const aim = 'aim' in origin ? origin.aim : null;
  switch (part.target) {
    case 'touch':
    case 'single': {
      const unit = impact ? impact.unit : aim?.target ?? null;
      return unit && touchable(unit) ? [unit] : [];
    }
    case 'self':
      return user.alive ? [user] : [];
    case 'aoe': {
      const at = impact?.point ?? aim?.point;
      return at ? game.magesInRadius(at, partRadius(part)).filter(touchable) : [];
    }
    case 'nova': {
      const spare = impact ? impact.unit : user;
      return game.magesInRadius(impact?.point ?? user.pos, partRadius(part)).filter((m) => m !== spare && touchable(m));
    }
    case 'multi': {
      const from = impact?.point ?? user.pos;
      const reach = impact ? IMPACT_REACH : partReach(part);
      const found = game.mages.filter((m) =>
        touchable(m) && m !== impact?.unit && dist(m.pos, from) <= reach + m.bodyRadius() &&
        (!!impact || m === user || !game.isUntargetable(m, user)));
      return nearestTo(game, from, found).slice(0, partCount(part));
    }
    case 'chain': {
      const links: Mage[] = [];
      const first = aim?.target;
      if (first && touchable(first)) links.push(first);
      if (aim && links.length === 0) return [];
      const skip = new Set<Mage>(impact?.unit ? [impact.unit] : []);
      let from: Vec2 = links[0]?.pos ?? impact?.point ?? user.pos;
      while (links.length < partCount(part)) {
        const reachFrom = from;
        const next = nearestTo(game, reachFrom, game.mages.filter((m) =>
          touchable(m) && !skip.has(m) && !links.includes(m) && dist(m.pos, reachFrom) <= partHop(part) + m.bodyRadius()))[0];
        if (!next) break;
        links.push(next);
        from = next.pos;
      }
      return links;
    }
    case 'battlefield':
      return game.mages.filter(touchable);
    case 'seeker':
      return game.mages
        .filter((m) => touchable(m) && m.maxHp > 0)
        .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || game.mages.indexOf(a) - game.mages.indexOf(b))
        .slice(0, 1);
    case 'environment':
    case 'aura':
      return [];
  }
}

/** Every unit the first part of the hex lands on, aimed like this. */
export function hexUnits(game: GameState, user: Mage, recipe: HexRecipe, aim: HexAim): Mage[] {
  return partUnits(game, user, recipe.parts[0], { aim });
}

/** Why the hex cannot be loosed as aimed, or null when it can. */
export function hexAimProblem(game: GameState, user: Mage, recipe: HexRecipe, aim: HexAim): string | null {
  const part = recipe.parts[0];
  const range = partReach(part);
  switch (hexAim(recipe)) {
    case 'unit': {
      const target = aim.target;
      const side = partSide(part);
      if (!target?.alive || game.isUnreachable(target)) return 'There is no one there.';
      if (!isGround(part.target) && !onSide(user, side, target)) {
        return side === 'allies' ? 'It only touches your side.' : 'It only touches the other side.';
      }
      if (target !== user && game.isUntargetable(target, user)) return `${target.name} cannot be singled out.`;
      return dist(user.pos, target.pos) > range + target.bodyRadius() ? 'Out of reach.' : null;
    }
    case 'point':
      if (!aim.point) return 'No point chosen.';
      return dist(user.pos, aim.point) > range + 0.5 ? 'Out of reach.' : null;
    case 'none':
      return hexUnits(game, user, recipe, aim).length ? null : 'No one in reach.';
  }
}

function newCast(game: GameState, user: Mage, hex: ItemId, recipe: HexRecipe): Cast {
  return { game, user, hex, recipe, echoes: recipe.parts.map(() => ECHO_LIMIT) };
}

/** Loose `itemId` from `user`'s belt: pay its mana, spend the sheet and let the hex land. Returns whether it did. */
export function activateHexzettel(game: GameState, user: Mage, itemId: ItemId, aim: HexAim): boolean {
  const recipe = hexOf(itemId);
  const at = user.utility.indexOf(itemId);
  if (!recipe || at < 0 || !user.alive) return false;
  const name = getItem(itemId).name;
  const cost = hexManaCost(recipe);
  if (user.mana < cost) {
    game.log(`${user.name} lacks the ${cost} mana to wake ${name}.`);
    return false;
  }
  const problem = hexAimProblem(game, user, recipe, aim);
  if (problem) {
    game.log(`${name} finds nothing. ${problem}`);
    return false;
  }
  user.utility.splice(at, 1);
  user.spendMana(cost);
  game.log(`${user.name} looses ${name} (${cost} mana).`);
  game.vfxSink?.sigil?.(user.pos, hexColor(recipe), 96);
  runPart(newCast(game, user, itemId, recipe), 0, { aim });
  return true;
}

/** A lingering hex ticked or bit `bearer`: the part coupled to it fires there. */
export function hexEcho(game: GameState, bearer: Mage, echo: HexEcho): void {
  const recipe = parseHexItemId(echo.hex);
  const user = game.mages[echo.ownerIndex];
  if (!recipe || !user || !recipe.parts[echo.part]) return;
  game.log(`The coupled hex stirs on ${bearer.name}.`);
  runPart(newCast(game, user, echo.hex as ItemId, recipe), echo.part, { impact: { unit: bearer, point: { ...bearer.pos } } });
}

function runPart(cast: Cast, index: number, origin: Origin): void {
  const { game, user, recipe } = cast;
  const part = recipe.parts[index];
  if (isGround(part.target)) {
    layGround(cast, index, origin);
    return;
  }
  const units = partUnits(game, user, part, origin);
  flourish(cast, part, origin, units);
  if (units.length === 0) {
    game.log(index === 0 ? 'The hex finds no one.' : 'The coupled hex finds no one.');
    return;
  }
  const landing: Landing = {
    part,
    index,
    origin,
    potency: partPotency(part),
    turns: partTurns(part),
    area: part.target === 'aoe' || part.target === 'nova' || part.target === 'battlefield',
  };
  const mode = couplingMode(part);
  const steps = unitPlan(part);
  for (const unit of units) {
    let fired = false;
    for (const step of steps) {
      if (!unit.alive) break;
      applyStep(cast, landing, unit, step);
      if (mode === 'impact' && !fired && step.from === part.carrier) {
        fired = true;
        fireCoupling(cast, index, unit, { ...unit.pos });
      }
    }
    if (mode === 'tick') bindEcho(cast, index, unit, steps);
  }
}

/** The part after `index` fires at an impact, while the coupling has firings left. */
function fireCoupling(cast: Cast, index: number, unit: Mage | null, point: Vec2): void {
  if (cast.echoes[index] <= 0) return;
  cast.echoes[index] -= 1;
  runPart(cast, index + 1, { impact: { unit, point } });
}

/** Tie the next part to the lingering wound or regeneration this part left on `unit`. */
function bindEcho(cast: Cast, index: number, unit: Mage, steps: HexStep[]): void {
  const part = cast.recipe.parts[index];
  const lingering = steps.filter((step) => step.k === 'dot' || step.k === 'regen');
  const step = lingering.find((entry) => entry.from === part.carrier) ?? lingering[0];
  if (!step) return;
  const key = step.k === 'dot' ? `dot:hex:${step.name}` : REGEN_KEY;
  const status = unit.statuses.find((entry) => entry.key === key);
  if (status?.kind !== 'dot' && status?.kind !== 'regen') return;
  status.hexEcho = { hex: cast.hex, part: index + 1, ownerIndex: cast.game.mages.indexOf(cast.user) };
}

/** A roll scaled by a part's potency, never below 1. */
function scaled(game: GameState, spec: string, potency: number): number {
  return Math.max(1, Math.round(game.rng.roll(spec).total * potency));
}

/** Where Wind, Cyclone and Twist work from: the impact, the area's centre, or you. On yourself, the nearest foe. */
function anchorOf(cast: Cast, landing: Landing): Vec2 | undefined {
  if (landing.part.target === 'self') return nearestFoe(cast.game, cast.user)?.pos;
  if ('impact' in landing.origin) return landing.origin.impact.point;
  if (landing.part.target === 'aoe') return landing.origin.aim.point ?? undefined;
  return cast.user.pos;
}

/** Where darts are loosed from: the user, or the impact that set this part off. */
function launchPoint(cast: Cast, landing: Landing): Vec2 {
  return 'impact' in landing.origin ? landing.origin.impact.point : cast.user.pos;
}

/** Shove `unit` `px` straight away from `from`; one standing right on it flies away from the user. */
function shove(game: GameState, user: Mage, unit: Mage, from: Vec2, px: number): void {
  const away = dist(unit.pos, from) >= 0.5 ? from : user.pos;
  const gap = dist(unit.pos, away);
  const dir = gap < 0.5 ? { x: 1, y: 0 } : { x: (unit.x - away.x) / gap, y: (unit.y - away.y) / gap };
  // A wall or the field edge slams the shoved for 2d6 inside forceMove.
  game.forceMove(user, unit, { x: unit.x + dir.x * px, y: unit.y + dir.y * px });
}

/** Drag `unit` up to `px` toward `to`, stopping short of whatever stands there. */
function drag(game: GameState, user: Mage, unit: Mage, to: Vec2, px: number, standing?: Mage): void {
  const room = dist(unit.pos, to) - unit.bodyRadius() - (standing?.bodyRadius() ?? 0);
  const step = Math.min(px, Math.max(0, room));
  if (step >= 1) game.forceMove(user, unit, stepTowards(unit.pos, to, step));
}

const AFFLICTIONS: ReadonlySet<Status['kind']> = new Set([
  'dot', 'stun', 'stifle', 'tether', 'control', 'forget', 'foeBlind', 'shadowAnchor', 'shadowHook', 'memoryShackle',
]);

function afflicts(status: Status): boolean {
  if (status.kind !== 'debuff') return AFFLICTIONS.has(status.kind);
  const { moveRange = 0, damageDealt = 0, damageTaken = 0 } = status.mods;
  return moveRange < 0 || damageDealt < 0 || damageTaken > 0 || (status.healMult ?? 1) < 1;
}

function purify(game: GameState, unit: Mage): void {
  const before = unit.statuses.length;
  unit.statuses = unit.statuses.filter((status) => !afflicts(status));
  const lifted = before - unit.statuses.length;
  if (lifted) game.log(`${lifted} affliction${lifted === 1 ? '' : 's'} lift from ${unit.name}.`);
}

function applyStep(cast: Cast, landing: Landing, unit: Mage, step: HexStep): void {
  const { game, user } = cast;
  const { part, potency, turns } = landing;
  const centre = 'impact' in landing.origin ? landing.origin.impact.point : landing.origin.aim.point;
  const ctx = game.effectContext(user, unit, centre);
  const blow: DealDamageOptions = landing.area ? { canMiss: false, aoe: true } : {};
  const self = part.target === 'self';
  const color = FACETS[step.from].color;
  const vfx = game.vfxSink;
  switch (step.k) {
    case 'heal':
      heal(ctx, unit, scaled(game, step.spec, potency));
      vfx?.sigil?.(unit.pos, color, 54);
      return;
    case 'regen':
      addOrExtendStatus(
        unit.statuses,
        { key: REGEN_KEY, name: 'Regeneration', kind: 'regen', duration: turns, spec: step.spec, ownerIndex: game.mages.indexOf(user) },
        false
      );
      game.log(`${unit.name} regenerates ${step.spec} a turn for ${turns} turns.`);
      vfx?.sigil?.(unit.pos, color, 54);
      return;
    case 'purify':
      purify(game, unit);
      heal(ctx, unit, scaled(game, step.spec, potency));
      vfx?.godFx?.('sphere', unit.pos, { size: 90, color });
      return;
    case 'hit':
      if (step.type === 'corrosive') vfx?.spellEffect?.(unit, 'corrosive');
      dealDamage(ctx, unit, dmg(scaled(game, step.spec, potency), step.type), blow);
      return;
    case 'dot':
      applyDot(ctx, unit, { name: step.name, key: `dot:hex:${step.name}`, duration: turns, damage: dmg(0, step.type), damageSpec: step.spec });
      vfx?.godFx?.('hex', unit.pos, { size: 70, color });
      return;
    case 'noHeal':
      applyDebuff(ctx, unit, { name: 'Blighted', key: 'debuff:hex-blight', duration: turns, mods: {}, healMult: 0 });
      return;
    case 'wither':
      game.wither(unit, step.amount, 6);
      vfx?.godFx?.('skull', unit.pos, { size: 60, color });
      return;
    case 'reveal':
      dispelVeil(ctx, unit);
      return;
    case 'veil':
      applyInvisibility(ctx, unit, { duration: turns, mode: 'partial' });
      vfx?.godFx?.('void', unit.pos, { size: 80, color });
      return;
    case 'missiles': {
      const from = launchPoint(cast, landing);
      for (let dart = 0; dart < step.darts && unit.alive; dart++) {
        void vfx?.boomerang?.(from, unit.pos, color, 9, 1.8);
        dealDamage(ctx, unit, dmg(game.rng.roll(MISSILE_DART).total, step.type), { canMiss: false, aoe: landing.area });
      }
      return;
    }
    case 'siphon':
      for (let dart = 0; dart < step.darts && unit.alive; dart++) {
        drainDamage(ctx, unit, dmg(game.rng.roll(SIPHON_DART).total, step.type), { canMiss: false, aoe: landing.area });
      }
      vfx?.drainParticles?.(unit.pos, user.pos);
      return;
    case 'explosion': {
      // On yourself the blast goes off around you and spares you.
      if (!self) dealDamage(ctx, unit, dmg(scaled(game, step.spec, potency), step.type), { canMiss: false, aoe: true });
      vfx?.shatterBurst?.(unit.pos, EXPLOSION_SPLASH_RADIUS * 2.4);
      vfx?.boom?.(unit.pos);
      if (!step.splash) return;
      const side = partSide(part);
      for (const other of game.magesInRadius(unit.pos, EXPLOSION_SPLASH_RADIUS, unit)) {
        if (game.isUnreachable(other) || !onSide(user, side, other)) continue;
        dealDamage(game.effectContext(user, other, unit.pos), other, dmg(scaled(game, step.splash, potency), step.type), { canMiss: false, aoe: true });
      }
      return;
    }
    case 'implosion': {
      dealDamage(ctx, unit, dmg(scaled(game, step.spec, potency), 'shatter'), { canMiss: false, aoe: true });
      vfx?.godFx?.('implode', unit.pos, { size: IMPLOSION_RADIUS * 2, color });
      const side = partSide(part);
      for (const other of game.magesInRadius(unit.pos, IMPLOSION_RADIUS, unit)) {
        if (other === user || game.isUnreachable(other) || !onSide(user, side, other)) continue;
        drag(game, user, other, unit.pos, R(step.cm), unit);
      }
      return;
    }
    case 'push':
    case 'pull': {
      const anchor = anchorOf(cast, landing);
      if (!anchor) return;
      vfx?.godFx?.('warp', unit.pos, { size: 70, color });
      if (self) {
        const toward = step.k === 'pull' ? 1 : -1;
        const room = step.k === 'pull' ? Math.max(0, dist(user.pos, anchor) - user.bodyRadius() * 2) : Infinity;
        const distance = Math.min(R(step.cm), room);
        if (distance >= 1) dash(ctx, user, { direction: { x: (anchor.x - user.x) * toward, y: (anchor.y - user.y) * toward }, distance });
        return;
      }
      if (unit === user && dist(anchor, user.pos) < 0.5) return;
      if (step.k === 'push') shove(game, user, unit, anchor, R(step.cm));
      else drag(game, user, unit, anchor, R(step.cm));
      return;
    }
    case 'twist': {
      const pivot = anchorOf(cast, landing);
      if (!pivot || dist(unit.pos, pivot) < 0.5) return;
      vfx?.godFx?.('warp', unit.pos, { size: 70, color });
      const clockwise = game.rng.chance(0.5);
      for (let turn = 0; turn < step.turns && unit.alive; turn++) {
        const spun = game.orbitAround(unit, pivot, clockwise);
        if (spun.slammed && !self) game.slamDamage(ctx, unit, game.rng.roll('2d6').total, 'shatter');
        if (spun.slammed || !spun.moved) return;
      }
      return;
    }
    case 'root':
      // A root ages at the bearer's turn start, so 2 holds it through its next turn.
      applyStun(ctx, unit, { duration: Math.max(2, turns - 1), type: 'movement' });
      return;
    case 'ward':
      addOrExtendStatus(
        unit.statuses,
        { key: 'debuff:hex-ward', name: 'Hex Ward', kind: 'debuff', duration: turns, mods: { damageTaken: -step.amount } },
        false
      );
      game.log(`${unit.name} is warded: ${step.amount} less damage taken for ${turns} turns.`);
      vfx?.godFx?.('sphere', unit.pos, { size: 80, color });
      return;
    case 'expose':
      applyDebuff(ctx, unit, { name: 'Breached', key: 'debuff:hex-breach', duration: turns, mods: { damageTaken: step.amount } });
      vfx?.godFx?.('rift', unit.pos, { size: 70, color });
      return;
    case 'haste':
      addOrExtendStatus(
        unit.statuses,
        { key: 'debuff:hex-haste', name: 'Hastened', kind: 'debuff', duration: turns, mods: { moveRange: R(step.cm) } },
        false
      );
      game.log(`${unit.name} is hastened: +${step.cm}cm move for ${turns} turns.`);
      return;
    case 'slow':
      applyDebuff(ctx, unit, {
        name: 'Hex-Slowed',
        key: 'debuff:hex-slow',
        duration: turns,
        mods: { moveRange: -Math.round(unit.baseMoveRange() * step.pct) },
      });
      return;
    case 'burst':
      game.burstDots(user, unit);
      vfx?.shatterBurst?.(unit.pos, 70);
      return;
  }
}

/** The glyph a part flashes where it lands, and the lightning of a chain. */
function flourish(cast: Cast, part: HexPart, origin: Origin, units: Mage[]): void {
  const vfx = cast.game.vfxSink;
  if (!vfx) return;
  const color = partColor(part);
  const impact = 'impact' in origin ? origin.impact : null;
  const aim = 'aim' in origin ? origin.aim : null;
  const centre = impact?.point
    ?? (part.target === 'aoe' ? aim?.point : part.target === 'nova' ? cast.user.pos : null)
    ?? units[0]?.pos
    ?? cast.user.pos;
  const wide = part.target === 'aoe' || part.target === 'nova';
  vfx.sigil?.(centre, color, wide ? partRadius(part) * 2 : 66);
  if (wide) vfx.godFx?.('sphere', centre, { size: partRadius(part) * 2, color });
  if (part.target === 'battlefield') vfx.godFx?.('cataclysm', cast.user.pos, { size: 260, color });
  if (part.target === 'chain') {
    let from = impact?.point ?? cast.user.pos;
    for (const link of units) {
      void vfx.lightningBolt?.(from, link.pos);
      from = link.pos;
    }
  }
}

/** Environment and Aura: erupt, wreck or clean what lies in the circle, raise walls and shadows, and let the ground carry the rest. */
function layGround(cast: Cast, index: number, origin: Origin): void {
  const { game, user, recipe } = cast;
  const part = recipe.parts[index];
  const impact = 'impact' in origin ? origin.impact : null;
  const aim = 'aim' in origin ? origin.aim : null;
  const rider = part.target === 'aura' ? (impact ? impact.unit : aim?.target ?? null) : null;
  const at = rider?.alive ? { ...rider.pos } : impact?.point ?? aim?.point;
  if (!at) return;
  const plan = groundPlan(part);
  const radius = partRadius(part);
  const turns = partTurns(part);
  const color = partColor(part);
  const inside = (thing: Vec2): boolean => dist(thing, at) <= radius;
  game.vfxSink?.sigil?.(at, color, radius * 2);
  game.vfxSink?.godFx?.('hex', at, { size: radius * 2.2, color });
  if (plan.erupt) erupt(cast, at, radius);
  const gone: string[] = [];
  const cull = <T>(list: T[], hit: (entry: T) => boolean, label: string): T[] => {
    const kept = list.filter((entry) => !hit(entry));
    const count = list.length - kept.length;
    if (count) gone.push(`${count} ${label}${count === 1 ? '' : 's'}`);
    return kept;
  };
  for (const thing of plan.clears) {
    switch (thing) {
      case 'walls':
        game.barriers = cull(game.barriers, (barrier) => barrierDistance(barrier, at) <= radius, 'wall');
        break;
      case 'items':
        game.droppedItems = cull(game.droppedItems, inside, 'dropped item');
        break;
      case 'totems':
        game.totems = cull(game.totems, (totem) => totem.attachedToIndex == null && inside(totem), 'totem');
        break;
      case 'sand':
        game.sand = cull(game.sand, inside, 'sand pile');
        break;
      case 'shadows':
        game.shadows = cull(game.shadows, inside, 'shadow');
        break;
      case 'mists':
        game.hazardZones = cull(game.hazardZones, inside, 'mist');
        break;
      case 'scarabs':
        game.damageScarabsInRadius(at, radius, user.team, game.rng.roll('2d6').total, 'heat');
        break;
      case 'blight':
        game.hazardZones = cull(game.hazardZones, inside, 'hazard');
        game.desecrationFields = cull(game.desecrationFields, inside, 'fouled ground');
        game.corrosionPools = cull(game.corrosionPools, inside, 'acid pool');
        break;
    }
  }
  if (plan.clears.length) game.log(gone.length ? `The hex clears away ${gone.join(', ')}.` : 'The hex finds nothing there to clear.');
  if (plan.wall) {
    const facing = Math.atan2(at.y - user.y, at.x - user.x);
    game.addBarrier(at, facing + Math.PI / 2, { shape: 'rect', range: radius * 2, thickness: 12, owner: user.team, ttl: turns });
    game.log(`A hexed wall rises for ${turns} rounds.`);
  }
  if (plan.shadow) placeShadow(game.effectContext(user, null, at), at, turns);
  const coupled = couplingMode(part) === 'ground';
  if (plan.zone) {
    const { drift, ...ground } = plan.zone;
    const side = partSide(part);
    game.addHazardZone(at, user, {
      name: part.target === 'aura' ? 'Hexed Aura' : 'Hexed Ground',
      radius,
      roundsLeft: turns,
      damageSpecs: [],
      damageType: 'typeless',
      color,
      drift: drift ? { px: R(drift.cm), inward: drift.inward } : undefined,
      carrierIndex: rider?.alive ? game.mages.indexOf(rider) : undefined,
      hex: {
        ...ground,
        side: side === 'any' ? undefined : side,
        text: groundText(part, plan.zone),
        hexEcho: coupled ? { hex: cast.hex, part: index + 1, ownerIndex: game.mages.indexOf(user) } : undefined,
      },
    });
    game.log(rider?.alive ? `The hex settles on ${rider.name} for ${turns} rounds.` : `The ground takes the hex for ${turns} rounds.`);
  } else if (coupled) {
    fireCoupling(cast, index, null, at);
  }
}

/** Burst on the ground: every hazard in the circle gives all it had left at once, and is spent. */
function erupt(cast: Cast, at: Vec2, radius: number): void {
  const { game, user } = cast;
  const zones = game.hazardZones.filter((zone) => dist(zone, at) <= radius);
  if (zones.length === 0) {
    game.log('No hazard there to erupt.');
    return;
  }
  game.hazardZones = game.hazardZones.filter((zone) => !zones.includes(zone));
  for (const zone of zones) {
    const owner = game.mages[zone.ownerIndex] ?? user;
    const hits = zone.hex
      ? zone.hex.hits
      : [{ spec: zone.damageSpecs[Math.min(zone.escalateIndex, zone.damageSpecs.length - 1)], type: zone.damageType }];
    const rounds = Math.max(1, zone.roundsLeft);
    for (const victim of game.magesInRadius({ x: zone.x, y: zone.y }, zone.radius)) {
      if (game.isUnreachable(victim)) continue;
      for (const hit of hits) {
        if (!victim.alive || !hit.spec) break;
        let total = 0;
        for (let round = 0; round < rounds; round++) total += game.rng.roll(hit.spec).total;
        dealDamage(game.effectContext(owner, victim, at), victim, dmg(total, hit.type), { canMiss: false, aoe: true });
      }
    }
    game.vfxSink?.shatterBurst?.({ x: zone.x, y: zone.y }, zone.radius * 2);
  }
  game.vfxSink?.boom?.(at);
  game.log(`${zones.length} hazard${zones.length === 1 ? ' erupts' : 's erupt'} and ${zones.length === 1 ? 'is' : 'are'} spent.`);
}
