// Smoke test: every spell, in every class and classless, cast on a small headless
// board, then two rounds of upkeep. Catches throws, NaN and bodies pushed off the field.

import { FIELD } from '../config/constants';
import { MAGE_CLASSES, type MageClass } from './Classes';
import { GameState } from './GameState';
import { Mage } from './Mage';
import type { Vec2 } from './utils';
import { ALL_SPELL_SETS, allSpells, setActiveSpellSets } from '../spells/registry';
import type { Spell } from '../spells/Spell';
import '../spells/sampleSpells';
import '../spells/classSpells';

setActiveSpellSets({ original: true, finns: true, dlc: true });

const PROMPT_LIMIT = 200;

function unit(name: string, team: number, at: Vec2, loadout: Spell['words'] = [], mageClass?: MageClass | null): Mage {
  const m = new Mage({ name, isAI: true, team, position: at, loadout: [...loadout], mageClass: mageClass ?? undefined });
  if (mageClass === null) m.classless = true;
  m.assignFlatStats(3);
  m.maxHp = 500;
  m.hp = 500;
  m.maxSanity = 500;
  m.sanity = 500;
  m.maxMana = 99;
  m.mana = 99;
  return m;
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

function board(spell: Spell, mageClass: MageClass | null, seed: number): { game: GameState; caster: Mage; ally: Mage; foe: Mage } {
  const reach = Number.isFinite(spell.range) ? spell.range : 400;
  const gap = Math.max((spell.minRange ?? 0) + 10, Math.min(reach * 0.6, 400));
  const caster = unit('Caster', 1, { x: 300, y: 240 }, spell.words, mageClass);
  const ally = unit('Ally', 1, { x: 250, y: 320 });
  const foe = unit('Foe', 2, { x: 300 + gap, y: 240 });
  const second = unit('Second', 2, { x: 300 + gap + 70, y: 330 });
  const game = new GameState([caster, ally, foe, second], seed);
  game.currentIndex = 0;
  let prompts = 0;
  const count = (): void => {
    if (++prompts > PROMPT_LIMIT) throw new Error(`more than ${PROMPT_LIMIT} mid-cast prompts`);
  };
  const near = (source: Mage, from: Vec2, range: number, pool: readonly Mage[]): Mage | null =>
    [...pool]
      .filter((m) => m.alive && dist(m.pos, from) <= range)
      .sort((a, b) => dist(a.pos, from) - dist(b.pos, from))[0] ?? null;
  game.subTargeter = {
    requestPoint: async (source, opts) => {
      count();
      if (opts.aiPoint) return opts.aiPoint;
      const from = opts.origin ?? source.pos;
      const target = near(source, from, opts.maxRange, game.mages.filter((m) => m.team !== source.team));
      return target ? { ...target.pos } : null;
    },
    requestEnemy: async (source, opts) => {
      count();
      return near(source, opts.origin ?? source.pos, opts.range, game.mages.filter((m) => m.team !== source.team));
    },
    requestCombatant: async (source, opts) => {
      count();
      return near(source, opts.origin ?? source.pos, opts.range, opts.candidates);
    },
    requestReroll: async () => {
      count();
      return false;
    },
    reactionWindow: async () => {},
    resolveImpacts: async () => {},
  };
  return { game, caster, ally, foe };
}

function aimFor(spell: Spell, caster: Mage, ally: Mage, foe: Mage): { target: Mage | null; point: Vec2 | null } {
  switch (spell.targeting) {
    case 'enemy':
    case 'any':
      return { target: foe, point: null };
    case 'ally':
      return { target: ally, point: null };
    case 'self':
      return { target: caster, point: null };
    case 'point':
      return { target: null, point: { ...foe.pos } };
    default:
      return { target: null, point: null };
  }
}

function brokenState(game: GameState): string | null {
  for (const m of game.mages) {
    for (const [key, value] of Object.entries({ x: m.x, y: m.y, hp: m.hp, sanity: m.sanity, mana: m.mana })) {
      if (!Number.isFinite(value)) return `${m.name}.${key} is ${value}`;
    }
    if (!m.alive) continue;
    const off = m.x < FIELD.x - 2 || m.x > FIELD.x + FIELD.w + 2 || m.y < FIELD.y - 2 || m.y > FIELD.y + FIELD.h + 2;
    if (off && !game.isUnreachable(m)) return `${m.name} left the field at (${Math.round(m.x)}, ${Math.round(m.y)})`;
  }
  return null;
}

async function castOnce(spell: Spell, mageClass: MageClass | null, crit: boolean): Promise<'ok' | 'inert' | 'skipped' | string> {
  const { game, caster, ally, foe } = board(spell, mageClass, crit ? 7 : 3);
  if (spell.minStackDepth || spell.delaysStackItem || spell.nullifiesStack) return 'skipped';
  const aim = aimFor(spell, caster, ally, foe);
  if (!game.canCastSpellNow(spell)) return 'skipped';
  if (aim.target && !game.isValidSpellTarget(spell, caster, aim.target)) return 'skipped';
  game.spellRollThisCast = crit ? 20 : 12;
  game.critThisCast = crit;
  const point2 = spell.twoPointAim ? { x: foe.x, y: foe.y + 80 } : null;
  try {
    await game.makeSpellItem(caster, spell, aim.target, aim.point, undefined, point2).resolve(game);
    game.critThisCast = false;
    game.spellRollThisCast = 0;
    const problem = brokenState(game);
    if (problem) return `after the cast: ${problem}`;
    const moved = game.mages.length !== 4 || game.mages.some((m) =>
      m.hp !== 500 || m.sanity !== 500 || m.statuses.length > 0 || m !== caster && m.mana !== 99);
    const fieldChanged = game.shadows.length + game.barriers.length + game.hazardZones.length
      + game.desecrations.length + game.desecrationFields.length + game.scarabs.length
      + game.hexcraftGlobals.length + game.totems.length > 0;
    const armed = caster.hands.length + caster.utility.length > 0;
    const changed = moved || fieldChanged || armed || dist(caster.pos, { x: 300, y: 240 }) > 1 || caster.hp !== 500;
    for (let step = 0; step < game.mages.length * 2; step++) {
      if (game.isOver) break;
      game.endTurn();
      game.beginTurn();
    }
    const later = brokenState(game);
    return later ? `after two rounds: ${later}` : changed ? 'ok' : 'inert';
  } catch (error) {
    return `threw: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function main(): Promise<void> {
  const failures: string[] = [];
  const seen = new Set<string>();
  let cast = 0;
  let skipped = 0;
  const inert: string[] = [];
  for (const mageClass of [...MAGE_CLASSES, null] as (MageClass | null)[]) {
    for (const spell of allSpells(mageClass, ALL_SPELL_SETS)) {
      if (seen.has(spell.id)) continue;
      seen.add(spell.id);
      for (const crit of [false, true]) {
        const verdict = await castOnce(spell, mageClass, crit);
        if (verdict === 'skipped') skipped++;
        else cast++;
        if (verdict === 'inert') inert.push(`${spell.name}${crit ? ' (crit)' : ''}`);
        if (verdict !== 'ok' && verdict !== 'skipped' && verdict !== 'inert') {
          failures.push(`${spell.name} [${spell.id}, ${mageClass ?? 'classless'}${crit ? ', crit' : ''}] ${verdict}`);
        }
      }
    }
  }
  // Buffs, wards and held casts may leave nothing to see; most spells must.
  if (inert.length > cast / 4) failures.push(`${inert.length} of ${cast} casts changed nothing; the board is not being exercised`);
  for (const line of failures) console.error(`FAIL ${line}`);
  if (process.env.SMOKE_VERBOSE) for (const name of inert) console.log(`inert: ${name}`);
  console.log(`Spell smoke: ${seen.size} spells, ${cast} casts (${inert.length} with no visible change), ${skipped} skipped, ${failures.length} failed.`);
  if (failures.length) process.exit(1);
}

void main();
