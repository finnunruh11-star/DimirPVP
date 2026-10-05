// =============================================================================
//  WATER & PAIN · SHARED KIT
// -----------------------------------------------------------------------------
//  Water is blue: water damage and forced movement. It pushes, drags, sweeps,
//  swaps and flings bodies; a push into a wall or the field edge slams (2d6
//  shatter, see GameState.forceMove). Pain is black: sanity damage of its own,
//  added to whatever it joins.
// =============================================================================

import { FIELD, RANGE_UNIT } from '../../config/constants';
import { barrierContains, type BarrierZone } from '../../core/Barrier';
import { dmg, type DamageType } from '../../core/Damage';
import type { Mage } from '../../core/Mage';
import type { StackItem } from '../../core/Stack';
import { addOrExtendStatus } from '../../core/Status';
import { dist, stepTowards, type Vec2 } from '../../core/utils';
import { isModifierWord, splitModifiers, type WordId } from '../../core/Words';
import {
  afflictDuration,
  applyDot,
  applyInvisibility,
  applyStun,
  dash,
  dealDamage,
  rollDice,
  type DealDamageOptions,
  type EffectContext,
} from '../../effects/effects';
import { spellById } from '../registry';

export const R = (cm: number): number => cm * RANGE_UNIT;
export const WATER_COLOR = 0x4f9be8;
export const PAIN_COLOR = 0xd1475c;
/** Far enough to cross the whole field. */
export const FIELD_DIAGONAL = Math.hypot(FIELD.w, FIELD.h);

const clampToField = (p: Vec2): Vec2 => ({
  x: Math.min(FIELD.x + FIELD.w, Math.max(FIELD.x, p.x)),
  y: Math.min(FIELD.y + FIELD.h, Math.max(FIELD.y, p.y)),
});

/** Roll `spec` as `type` damage on `target`. Returns what landed. */
export function hit(
  ctx: EffectContext,
  target: Mage,
  spec: string,
  type: DamageType,
  label: string,
  opts: DealDamageOptions = {}
): number {
  if (!target.alive) return 0;
  return dealDamage(ctx, target, dmg(rollDice(ctx, spec, label, target), type), opts);
}

/** Centre-to-centre distance in cm. */
export function cmApart(a: Vec2, b: Vec2): number {
  return dist(a, b) / RANGE_UNIT;
}

/** Roll each hit once and land it on every unit in `units` as area damage. */
export function strikeAll(
  ctx: EffectContext,
  units: readonly Mage[],
  hits: readonly (readonly [string, DamageType])[],
  label: string
): void {
  if (units.length === 0) return;
  for (const [spec, type] of hits) {
    const amount = rollDice(ctx, spec, label);
    for (const m of units) if (m.alive) dealDamage(ctx, m, dmg(amount, type), { canMiss: false, aoe: true });
  }
}

/** Root `m` through its next `turns` turns. */
export function root(ctx: EffectContext, m: Mage, turns: number): void {
  if (m.alive) applyStun(ctx, m, { duration: turns + 1, type: 'movement' });
}

/** Stun `m` through its next `turns` turns. */
export function stun(ctx: EffectContext, m: Mage, turns: number): void {
  if (m.alive) applyStun(ctx, m, { duration: turns + 1, type: 'full' });
}

/** A damage-over-time of `type` for `turns` ticks; `extra` adds the rest of applyDot's options. */
export function curseWith(
  ctx: EffectContext,
  target: Mage,
  name: string,
  type: DamageType,
  turns: number,
  extra: Partial<Parameters<typeof applyDot>[2]> = {}
): void {
  if (!target.alive) return;
  applyDot(ctx, target, {
    name,
    key: `dot:${name.toLowerCase().replace(/\s+/g, '-')}`,
    duration: turns,
    damage: dmg(0, type),
    ...extra,
  });
}

/** Bodies that can be moved or struck at all: alive, in this world, riding nothing. */
function present(ctx: EffectContext, m: Mage): boolean {
  return m.alive && !ctx.game.isUnreachable(m) && m.attachedToIndex == null;
}

/** Living enemies of the caster whose bodies reach within `radius` of `at`. */
export function foesAround(ctx: EffectContext, at: Vec2, radius: number): Mage[] {
  return ctx.game
    .magesInRadius(at, radius, ctx.caster)
    .filter((m) => m.team !== ctx.caster.team && present(ctx, m));
}

/** Every living body within `radius` of `at`, allies and the caster included. */
export function everyoneAround(ctx: EffectContext, at: Vec2, radius: number): Mage[] {
  return ctx.game.magesInRadius(at, radius).filter((m) => present(ctx, m));
}

/** Living enemies inside a cone from the caster. */
export function foesInCone(ctx: EffectContext, toward: Vec2, range: number, degrees: number): Mage[] {
  return ctx.game
    .magesInCone(ctx.caster.pos, toward, range, degrees, ctx.caster)
    .filter((m) => m.team !== ctx.caster.team && present(ctx, m));
}

/** Every living body but the caster inside a cone from the caster. */
export function everyoneInCone(ctx: EffectContext, toward: Vec2, range: number, degrees: number): Mage[] {
  return ctx.game.magesInCone(ctx.caster.pos, toward, range, degrees, ctx.caster).filter((m) => present(ctx, m));
}

/** Push `m` `cm` straight away from `from`. Returns whether it slammed into a wall or the field edge. */
export function shove(ctx: EffectContext, m: Mage, from: Vec2, cm: number): boolean {
  if (!present(ctx, m) || cm <= 0) return false;
  let dx = m.x - from.x;
  let dy = m.y - from.y;
  if (Math.hypot(dx, dy) < 0.5) {
    dx = m.x - ctx.caster.x;
    dy = m.y - ctx.caster.y;
  }
  const len = Math.hypot(dx, dy);
  const dir = len < 0.5 ? { x: 1, y: 0 } : { x: dx / len, y: dy / len };
  return ctx.game.forceMove(ctx.caster, m, { x: m.x + dir.x * R(cm), y: m.y + dir.y * R(cm) });
}

/** Push `m` `cm` along `dir`. Returns whether it slammed. */
export function shoveAlong(ctx: EffectContext, m: Mage, dir: Vec2, cm: number): boolean {
  if (!present(ctx, m) || cm <= 0) return false;
  const len = Math.hypot(dir.x, dir.y) || 1;
  return ctx.game.forceMove(ctx.caster, m, { x: m.x + (dir.x / len) * R(cm), y: m.y + (dir.y / len) * R(cm) });
}

/** Drag `m` up to `cm` toward `to`, never past it. Returns whether it slammed. */
export function drag(ctx: EffectContext, m: Mage, to: Vec2, cm: number): boolean {
  if (!present(ctx, m) || cm <= 0) return false;
  const dest = stepTowards(m.pos, to, R(cm));
  if (dist(dest, m.pos) < 0.5) return false;
  return ctx.game.forceMove(ctx.caster, m, dest);
}

/** The point a little beyond the field edge nearest to `p`: a current aimed there slams on arrival. */
export function nearestEdgePoint(p: Vec2): Vec2 {
  const options = [
    { d: p.x - FIELD.x, at: { x: FIELD.x - R(1), y: p.y } },
    { d: FIELD.x + FIELD.w - p.x, at: { x: FIELD.x + FIELD.w + R(1), y: p.y } },
    { d: p.y - FIELD.y, at: { x: p.x, y: FIELD.y - R(1) } },
    { d: FIELD.y + FIELD.h - p.y, at: { x: p.x, y: FIELD.y + FIELD.h + R(1) } },
  ];
  return options.sort((a, b) => a.d - b.d)[0].at;
}

/** Where a ray from `from` through `toward` leaves the field, pushed a little beyond it. */
export function edgeOnRay(from: Vec2, toward: Vec2): Vec2 {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return nearestEdgePoint(from);
  const ux = dx / len;
  const uy = dy / len;
  let t = Infinity;
  if (ux > 1e-6) t = Math.min(t, (FIELD.x + FIELD.w - from.x) / ux);
  if (ux < -1e-6) t = Math.min(t, (FIELD.x - from.x) / ux);
  if (uy > 1e-6) t = Math.min(t, (FIELD.y + FIELD.h - from.y) / uy);
  if (uy < -1e-6) t = Math.min(t, (FIELD.y - from.y) / uy);
  if (!Number.isFinite(t)) t = 0;
  return { x: from.x + ux * (t + R(1)), y: from.y + uy * (t + R(1)) };
}

/** A lane `length` long from the caster toward `toward`, cut short by the field edge. */
export function lane(ctx: EffectContext, toward: Vec2, length: number): { from: Vec2; to: Vec2 } {
  const from = { ...ctx.caster.pos };
  const edge = clampToField(edgeOnRay(from, toward));
  return { from, to: dist(from, edge) <= length ? edge : stepTowards(from, edge, length) };
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 0.01) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Enemies touching a lane, nearest to its start first. */
export function foesOnLane(ctx: EffectContext, from: Vec2, to: Vec2, pad = R(0.5)): Mage[] {
  return ctx.game.mages
    .filter(
      (m) =>
        m !== ctx.caster &&
        m.team !== ctx.caster.team &&
        present(ctx, m) &&
        segmentDistance(m.pos, from, to) <= m.bodyRadius() + pad
    )
    .sort((a, b) => dist(a.pos, from) - dist(b.pos, from));
}

/** Nudge `m` off any body it landed on, then keep it on the field. */
function settle(ctx: EffectContext, m: Mage): void {
  for (let i = 0; i < 12; i++) {
    const other = ctx.game.mages.find(
      (o) => o !== m && o.alive && o.attachedToIndex == null && dist(o.pos, m.pos) < o.bodyRadius() + m.bodyRadius() - 0.5
    );
    if (!other) break;
    const gap = dist(other.pos, m.pos);
    const dir = gap > 0.5 ? { x: (m.x - other.x) / gap, y: (m.y - other.y) / gap } : { x: 0, y: 1 };
    const need = other.bodyRadius() + m.bodyRadius() - gap + 1;
    const next = clampToField({ x: m.x + dir.x * need, y: m.y + dir.y * need });
    m.x = next.x;
    m.y = next.y;
  }
}

/** Whether `m` can be put somewhere else right now; logs why not. */
function movable(ctx: EffectContext, m: Mage): boolean {
  if (!present(ctx, m)) return false;
  if (m.displacementImmune && m.team !== ctx.caster.team) {
    ctx.log(`${m.name} cannot be moved.`);
    return false;
  }
  if (ctx.game.isImmovable(m)) {
    ctx.log(`${m.name} is fixed in place.`);
    return false;
  }
  return true;
}

/** Lift `m` and set it down at `to` (no travel: walls and bodies do not stop it). */
export function relocate(ctx: EffectContext, m: Mage, to: Vec2): boolean {
  if (!movable(ctx, m)) return false;
  const from = { ...m.pos };
  const at = clampToField(to);
  m.x = at.x;
  m.y = at.y;
  settle(ctx, m);
  ctx.game.notifyMageRelocation(m, from, m.pos, false);
  ctx.game.updateAttachedScarabs();
  ctx.vfx?.blink?.(from, m.pos, WATER_COLOR);
  if (m !== ctx.caster) ctx.game.lawShoved(ctx.caster, m);
  return true;
}

/** `a` and `b` trade places. */
export function swapPlaces(ctx: EffectContext, a: Mage, b: Mage): boolean {
  if (a === b || !movable(ctx, a) || !movable(ctx, b)) return false;
  const pa = { ...a.pos };
  const pb = { ...b.pos };
  a.x = pb.x;
  a.y = pb.y;
  b.x = pa.x;
  b.y = pa.y;
  ctx.game.notifyMageRelocation(a, pa, a.pos, false);
  ctx.game.notifyMageRelocation(b, pb, b.pos, false);
  ctx.game.updateAttachedScarabs();
  ctx.vfx?.blink?.(pa, a.pos, WATER_COLOR);
  ctx.vfx?.blink?.(pb, b.pos, WATER_COLOR);
  ctx.log(`${a.name} and ${b.name} trade places.`);
  for (const m of [a, b]) if (m !== ctx.caster) ctx.game.lawShoved(ctx.caster, m);
  return true;
}

/** A point `cm` from `m`, straight away from the nearest enemy of the caster (an AI's escape). */
export function awayFromFoes(ctx: EffectContext, m: Mage, cm: number): Vec2 {
  const foe = ctx.game.mages
    .filter((o) => o.alive && o.team !== ctx.caster.team)
    .sort((a, b) => dist(a.pos, m.pos) - dist(b.pos, m.pos))[0];
  if (!foe || dist(foe.pos, m.pos) < 0.5) return { ...m.pos };
  const gap = dist(foe.pos, m.pos);
  return clampToField({ x: m.x + ((m.x - foe.x) / gap) * R(cm), y: m.y + ((m.y - foe.y) / gap) * R(cm) });
}

/** The caster dashes `cm` straight away from `from`. */
export function dashAwayFrom(ctx: EffectContext, from: Vec2, cm: number): void {
  const me = ctx.caster;
  if (!me.alive || dist(me.pos, from) < 0.5) return;
  dash(ctx, me, { direction: { x: me.x - from.x, y: me.y - from.y }, distance: R(cm) });
}

/** The caster slips into a half veil for `turns` (1 = until its next turn). */
export function veilSelf(ctx: EffectContext, turns: number): void {
  if (ctx.caster.alive) applyInvisibility(ctx, ctx.caster, { duration: turns, mode: 'partial' });
}

// ---- Forgetting -------------------------------------------------------------

/** Add named words or actions to what `target` has forgotten, keeping the old ones. */
export function forgetTokens(ctx: EffectContext, target: Mage, tokens: string[], duration: number): void {
  if (tokens.length === 0 || !target.alive || ctx.game.isUnreachable(target)) return;
  if (target.isDebuffImmune()) {
    ctx.log(`${target.name} is immune to debuffs and forgets nothing.`);
    return;
  }
  addOrExtendStatus(
    target.statuses,
    {
      key: 'forget',
      name: 'Forgotten',
      kind: 'forget',
      duration: afflictDuration(ctx, target, duration),
      forgotten: [...new Set([...target.forgotten(), ...tokens])],
    },
    false
  );
  ctx.log(`${target.name} forgets ${tokens.join(' & ')}.`);
}

/** `count` random words `target` still remembers. */
export function randomWords(ctx: EffectContext, target: Mage, count: number): WordId[] {
  const pool = target.loadout.filter((w) => !isModifierWord(w) && !target.hasForgotten(w));
  const picked: WordId[] = [];
  while (picked.length < count && pool.length > 0) picked.push(...pool.splice(ctx.rng.die(pool.length) - 1, 1));
  return picked;
}

/** The word `target` holds the most charges of, if any. */
export function richestWord(target: Mage): WordId | undefined {
  const words = target.loadout.filter((w) => !isModifierWord(w) && !target.hasForgotten(w));
  return [...words].sort((a, b) => (target.charges[b] ?? 0) - (target.charges[a] ?? 0))[0];
}

/** What `item` did, as forgettable tokens: a spell's words, or the move or attack. */
export function deedsOf(item: StackItem): string[] {
  if (item.spell) return splitModifiers(item.spell.words).base.map(String);
  if (item.kind === 'melee') return ['melee'];
  if (item.kind === 'move') return ['move'];
  return [];
}

/** What `m` did last, as forgettable tokens. */
export function lastDeeds(m: Mage): string[] {
  const last = m.lastAction;
  if (!last) return [];
  if (last.type === 'spell') {
    const spell = last.spellId ? spellById(last.spellId) : undefined;
    return spell ? splitModifiers(spell.words).base.map(String) : [];
  }
  return [last.type];
}

/** For `turns`, `foe` cannot single out the caster (its area effects still reach). */
export function hideFrom(ctx: EffectContext, foe: Mage, turns: number): void {
  if (!foe.alive || ctx.game.isUnreachable(foe) || foe.isDebuffImmune()) return;
  const index = ctx.game.mages.indexOf(ctx.caster);
  addOrExtendStatus(
    foe.statuses,
    {
      key: `blindSpot:${index}`,
      name: 'Blind Spot',
      kind: 'blindSpot',
      duration: afflictDuration(ctx, foe, turns),
      hiddenIndex: index,
    },
    false
  );
  ctx.log(`${foe.name} loses sight of ${ctx.caster.name}.`);
}

// ---- Fling ------------------------------------------------------------------

/** Hard things that hurt whoever they land on. */
interface Landing {
  at: Vec2;
  reach: number;
  wall?: BarrierZone;
}

/** Shift a unit a wall landed on out to the nearer side of the wall. */
function outOfWall(ctx: EffectContext, m: Mage, wall: BarrierZone): void {
  if (wall.shape !== 'rect') return;
  const nx = -Math.sin(wall.angle);
  const ny = Math.cos(wall.angle);
  const across = (m.x - wall.x) * nx + (m.y - wall.y) * ny;
  const side = across >= 0 ? 1 : -1;
  const shift = side * (wall.thickness / 2 + m.bodyRadius() + 2) - across;
  relocate(ctx, m, { x: m.x + nx * shift, y: m.y + ny * shift });
}

/**
 * Water Shatter: everything within `radius` of `at` is flung over the caster
 * and lands mirrored on its other side. Flung units take `unitHits`; a wall,
 * totem, item or orb that lands on a unit deals it `objectSpec` shatter.
 */
export function fling(
  ctx: EffectContext,
  at: Vec2,
  radius: number,
  unitHits: { spec: string; type: DamageType }[],
  objectSpec: string
): Mage[] {
  const game = ctx.game;
  const pivot = { ...ctx.caster.pos };
  const mirror = (p: Vec2): Vec2 => clampToField({ x: 2 * pivot.x - p.x, y: 2 * pivot.y - p.y });
  const inside = (p: Vec2): boolean => dist(p, at) <= radius;
  const landings: Landing[] = [];
  for (const wall of game.barriers) {
    if (!inside(wall)) continue;
    const to = mirror(wall);
    wall.x = to.x;
    wall.y = to.y;
    wall.angle += Math.PI;
    landings.push({ at: to, reach: 0, wall });
  }
  for (const totem of game.totems) {
    if (totem.attachedToIndex != null || !inside(totem)) continue;
    const to = mirror(totem);
    totem.x = to.x;
    totem.y = to.y;
    landings.push({ at: to, reach: R(0.6) });
  }
  for (const thing of [...game.droppedItems, ...game.redOrbs]) {
    if (!inside(thing)) continue;
    const to = mirror(thing);
    thing.x = to.x;
    thing.y = to.y;
    landings.push({ at: to, reach: R(0.5) });
  }
  for (const pile of game.sand) {
    if (!inside(pile)) continue;
    const to = mirror(pile);
    pile.x = to.x;
    pile.y = to.y;
  }
  const flung = game.mages.filter(
    (m) => m !== ctx.caster && present(ctx, m) && dist(m.pos, at) <= radius + m.bodyRadius()
  );
  const moved: Mage[] = [];
  for (const m of flung) {
    if (!movable(ctx, m)) continue;
    const from = { ...m.pos };
    const to = mirror(from);
    m.x = to.x;
    m.y = to.y;
    moved.push(m);
    ctx.vfx?.blink?.(from, to, WATER_COLOR);
    game.notifyMageRelocation(m, from, m.pos, false);
  }
  for (const m of moved) settle(ctx, m);
  game.updateAttachedScarabs();
  if (moved.length > 0) ctx.log(`${ctx.caster.name} flings ${moved.map((m) => m.name).join(', ')} overhead.`);
  for (const m of moved) game.lawShoved(ctx.caster, m);
  for (const m of moved) {
    for (const h of unitHits) hit(ctx, m, h.spec, h.type, 'Flung', { canMiss: false, aoe: true });
  }
  for (const landing of landings) {
    for (const m of game.mages) {
      if (!present(ctx, m) || m === ctx.caster) continue;
      const struck = landing.wall
        ? barrierContains(landing.wall, m.pos)
        : dist(m.pos, landing.at) <= m.bodyRadius() + landing.reach;
      if (!struck) continue;
      ctx.log(`Something lands on ${m.name}.`);
      hit(ctx, m, objectSpec, 'shatter', 'Landing', { canMiss: false, aoe: true });
      if (landing.wall && m.alive) outOfWall(ctx, m, landing.wall);
    }
  }
  return moved;
}

/** Turn every word of a countered item, or the last deed of `m`, into what it forgets. */
export function deedsToForget(item: StackItem | null, m: Mage): string[] {
  return item ? deedsOf(item) : lastDeeds(m);
}

/** A unit vector in a random direction. */
export function randomHeading(ctx: EffectContext): Vec2 {
  const angle = ctx.rng.float() * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}
