import assert from 'node:assert/strict';
import { RANGE_UNIT } from '../config/constants';
import { dmg } from './Damage';
import { dealDamage } from '../effects/effects';
import { GameState } from './GameState';
import { Mage } from './Mage';
import '../spells/sampleSpells';
import { getSpell } from '../spells/registry';
import {
  applyMindLightningStack,
  closestMindLightningDirection,
  MIND_LIGHTNING_DIRECTIONS,
  mindLightningBoltTarget,
  mindLightningDamage,
  mindLightningDashCount,
} from '../spells/mindLightning';

function mage(name: string, team: number, x = 100, y = 100): Mage {
  return new Mage({ name, team, isAI: false, position: { x, y }, loadout: [] });
}

assert.equal(MIND_LIGHTNING_DIRECTIONS.length, 8);
assert.equal(new Set(MIND_LIGHTNING_DIRECTIONS.map(({ x, y }) => `${x},${y}`)).size, 8);
assert.equal(mindLightningDashCount(4), 4);
assert.equal(mindLightningDashCount(20), 8);
assert.deepEqual(
  closestMindLightningDirection({ x: 10, y: -9 }, MIND_LIGHTNING_DIRECTIONS),
  MIND_LIGHTNING_DIRECTIONS[1]
);

const caster = mage('Caster', 1);
const first = mage('First', 2);
const second = mage('Second', 2);
first.lightningMindStacks = 3;
second.lightningMindStacks = 4;

assert.equal(mindLightningBoltTarget(caster, [first, second], 1), caster);
for (const roll of [2, 3, 4]) assert.equal(mindLightningBoltTarget(caster, [first, second], roll), first);
for (const roll of [5, 6, 7, 8]) assert.equal(mindLightningBoltTarget(caster, [first, second], roll), second);

const fresh = mage('Fresh', 2);
assert.equal(applyMindLightningStack(fresh), 1);
assert.equal(mindLightningDamage(3, fresh.lightningMindStacks), 3);
assert.equal(applyMindLightningStack(fresh), 2);
assert.equal(mindLightningDamage(3, fresh.lightningMindStacks), 4.5);
fresh.resetForNewCombat();
assert.equal(fresh.lightningMindStacks, 0);

const game = new GameState([caster, first], 1);
const originalRoll = game.rng.roll.bind(game.rng);
game.rng.roll = () => ({ total: 2, rolls: [2], modifier: 0 });
assert.equal(game.rollD20(caster), 2);
caster.utility.push('gamblersCurse');
assert.equal(game.rollD20(caster), 1);
game.rng.roll = originalRoll;

const pierce = getSpell(['lightning', 'mind', 'pierce']);
assert(pierce, 'Lightning Mind Pierce must be registered.');
const pierceCaster = mage('Piercer', 1, 600, 350);
const pierceTarget = mage('Marked', 2, 600, 315);
pierceCaster.maxSanity = 100;
pierceCaster.sanity = 100;
pierceTarget.maxSanity = 100;
pierceTarget.sanity = 100;
const pierceGame = new GameState([pierceCaster, pierceTarget], 7);
const origin = { ...pierceCaster.pos };
const optionCounts: number[] = [];
const chosenDirections: string[] = [];
const dashSpecs: string[] = [];
const boltTargets: string[] = [];
const pauses: number[] = [];
pierceGame.rng.roll = (spec) => {
  if (/^[1-4]d4$/.test(spec)) {
    dashSpecs.push(spec);
    const dice = Number.parseInt(spec, 10);
    const rolls = dice === 1 ? [4] : Array<number>(dice).fill(1);
    return { total: rolls.reduce((total, roll) => total + roll, 0), rolls, modifier: 0 };
  }
  if (spec === '1d2') return { total: 2, rolls: [2], modifier: 0 };
  return { total: 1, rolls: [1], modifier: 0 };
};
pierceGame.vfxSink = {
  diceRoll: () => undefined,
  mindLightningBolt: async (_caster, target) => {
    boltTargets.push(target.x === pierceTarget.x && target.y === pierceTarget.y ? 'Marked' : 'Piercer');
  },
  pause: async (durationMs) => { pauses.push(durationMs); },
};
pierceGame.subTargeter = {
  requestPoint: async (_source, opts) => {
    assert.deepEqual(pierceCaster.pos, origin, 'All directions must be selected before the first dash.');
    assert(opts.directions, 'Pierce must offer discrete compass directions.');
    optionCounts.push(opts.directions.length);
    const direction = opts.directions[0];
    chosenDirections.push(`${direction.x},${direction.y}`);
    return { x: origin.x + direction.x * 100, y: origin.y + direction.y * 100 };
  },
  requestEnemy: async () => null,
  requestCombatant: async () => null,
  reactionWindow: async () => undefined,
  resolveImpacts: async () => undefined,
};

await pierce.cast(pierceGame.effectContext(pierceCaster, pierceCaster, null));

assert.deepEqual(optionCounts, [8, 7, 6, 5]);
assert.equal(new Set(chosenDirections).size, 4);
assert.deepEqual(dashSpecs, ['1d4', '2d4', '3d4', '4d4']);
assert.equal(pierceTarget.lightningMindStacks, 1);
assert.deepEqual(boltTargets, ['Marked', 'Marked', 'Marked', 'Marked']);
assert.deepEqual(pauses, [420, 420, 420, 240, 240, 240]);

const enchant = getSpell(['lightning', 'mind']);
assert(enchant, 'Lightning Mind must be registered.');
const enchantCaster = mage('Conductor', 1, 100, 100);
const enchantTarget = mage('Target', 2, 110, 100);
enchantCaster.maxSanity = 100;
enchantCaster.sanity = 100;
enchantTarget.maxHp = 100;
enchantTarget.hp = 100;
enchantTarget.maxSanity = 100;
enchantTarget.sanity = 100;
enchantCaster.bag.push('razorSword');
assert.equal(enchantCaster.equipHand('razorSword'), true);
const enchantGame = new GameState([enchantCaster, enchantTarget], 11);
enchantGame.spellRollThisCast = 12;
await enchant.cast(enchantGame.effectContext(enchantCaster, enchantCaster, null));
assert.equal(enchantCaster.lightningMindCharges, 2);
assert.equal(enchantCaster.lightningMindRange, 4 * RANGE_UNIT);

let weightedRoute = 1;
enchantGame.rng.roll = (spec) => {
  const total = spec === '1d6' || spec === '1d3' ? 3 : weightedRoute;
  return { total, rolls: [total], modifier: 0 };
};
await enchantGame.makeMeleeItem(enchantCaster, enchantTarget).resolve(enchantGame);
assert.equal(enchantTarget.lightningMindStacks, 1, 'The struck enemy is marked before routing.');
assert.equal(enchantCaster.sanity, 98, 'The caster retains exactly one weighted self-route.');
assert.equal(enchantCaster.lightningMindCharges, 1);

weightedRoute = 2;
await enchantGame.makeMeleeItem(enchantCaster, enchantTarget).resolve(enchantGame);
assert.equal(enchantTarget.lightningMindStacks, 2);
assert.equal(enchantTarget.sanity, 95, 'The independent 1d3 arc scales from the new stack count.');
assert.equal(enchantCaster.lightningMindCharges, 0);
assert.equal(enchantCaster.weaponEnchant, undefined);

const faraday = getSpell(['lightning', 'mind', 'veil']);
assert(faraday, 'Faraday Veil must be registered.');
assert.equal(faraday.codename, 'Faraday Veil');
const faradayCaster = mage('Architect', 1, 100, 100);
const bearer = mage('Bearer', 1, 120, 100);
const attacker = mage('Attacker', 2, 140, 100);
const conductor = mage('Marked conductor', 2, 150, 100);
bearer.maxHp = 100;
bearer.hp = 100;
bearer.maxSanity = 100;
bearer.sanity = 100;
conductor.maxSanity = 100;
conductor.sanity = 100;
conductor.lightningMindStacks = 2;
const faradayGame = new GameState([faradayCaster, bearer, attacker, conductor], 13);
faradayGame.spellRollThisCast = 10;
await faraday.cast(faradayGame.effectContext(faradayCaster, bearer, null));
const veil = bearer.statuses.find((status) => status.kind === 'faradayVeil');
assert(veil && veil.kind === 'faradayVeil');
assert.equal(veil.duration, 2);
assert.equal(veil.arcRange, 4 * RANGE_UNIT);
assert.equal(faradayGame.isValidSpellTarget(faraday, faradayCaster, bearer), true);
bearer.x = faradayCaster.x + 21 * RANGE_UNIT;
assert.equal(faradayGame.isValidSpellTarget(faraday, faradayCaster, bearer), false);
bearer.x = 120;

faradayGame.rng.roll = () => ({ total: 2, rolls: [2], modifier: 0 });
const firstHit = dealDamage(
  faradayGame.effectContext(attacker, bearer, null),
  bearer,
  dmg(10, 'shatter')
);
assert.equal(firstHit, 5);
assert.equal(bearer.hp, 95);
assert.equal(conductor.lightningMindStacks, 3);
assert.equal(conductor.sanity, 90, 'Retaliation uses the newly added stack.');
const secondHit = dealDamage(
  faradayGame.effectContext(attacker, bearer, null),
  bearer,
  dmg(10, 'shatter')
);
assert.equal(secondHit, 5, 'Faraday has no per-proc charge limit.');
assert.equal(veil.duration, 2, 'Faraday procs do not consume duration.');

const failedBearer = mage('Failed bearer', 1, 120, 100);
const failedConductor = mage('Failed conductor', 2, 150, 100);
failedBearer.maxHp = 100;
failedBearer.hp = 100;
failedBearer.maxSanity = 100;
failedBearer.sanity = 100;
failedConductor.lightningMindStacks = 1;
const failedGame = new GameState([faradayCaster, failedBearer, attacker, failedConductor], 17);
failedGame.spellRollThisCast = 10;
await faraday.cast(failedGame.effectContext(faradayCaster, failedBearer, null));
failedGame.rng.roll = () => ({ total: 1, rolls: [1], modifier: 0 });
const failedHit = dealDamage(
  failedGame.effectContext(attacker, failedBearer, null),
  failedBearer,
  dmg(10, 'shatter')
);
assert.equal(failedHit, 10);
assert.equal(failedBearer.hp, 90, 'A grounding failure leaves the original hit intact.');
assert.equal(failedBearer.sanity, 98, 'Failure backlash is ceil(P / 8).');
assert.equal(failedConductor.lightningMindStacks, 2);

const knightCaster = mage('Knight architect', 1, 100, 100);
const knightBearer = mage('Knight bearer', 1, 120, 100);
const deathknight = mage('Deathknight', 2, 140, 100);
knightBearer.maxHp = 100;
knightBearer.hp = 100;
deathknight.maxHp = 100;
deathknight.hp = 100;
deathknight.maxSanity = 100;
deathknight.sanity = 100;
deathknight.deathknightKind = true;
deathknight.lightningMindStacks = 2;
const knightGame = new GameState([knightCaster, knightBearer, deathknight], 18);
knightGame.spellRollThisCast = 10;
await faraday.cast(knightGame.effectContext(knightCaster, knightBearer, null));
const knightRolls: string[] = [];
knightGame.vfxSink = {
  diceRoll: (spec) => { knightRolls.push(spec); },
};
knightGame.rng.roll = (spec) => {
  if (spec === '2d10') return { total: 10, rolls: [5, 5], modifier: 0 };
  return { total: 2, rolls: [2], modifier: 0 };
};
const knightDamage = knightGame.resolveDeathknightBasicAttack(deathknight, knightBearer);
assert.equal(knightDamage, 4, 'Faraday reduces both guaranteed halves of the deathknight spear.');
assert.equal(knightBearer.hp, 94, 'The separate 2-damage corrosive area pulse still lands.');
assert.deepEqual(knightRolls, ['1d3', '1d4'], 'Each spear half visibly rolls conductivity.');
assert.equal(deathknight.lightningMindStacks, 4);
assert.equal(deathknight.sanity, 86, 'Successful spear routing retaliates into the deathknight.');

const criticalBearer = mage('Critical bearer', 1, 120, 100);
const criticalGame = new GameState([faradayCaster, criticalBearer], 19);
criticalGame.spellRollThisCast = 20;
criticalGame.critThisCast = true;
await faraday.cast(criticalGame.effectContext(faradayCaster, criticalBearer, null));
const criticalVeil = criticalBearer.statuses.find((status) => status.kind === 'faradayVeil');
assert(criticalVeil && criticalVeil.kind === 'faradayVeil');
assert.equal(criticalVeil.duration, 14, 'Critical power and normal critical duration both apply.');
assert.equal(criticalVeil.arcRange, 28 * RANGE_UNIT, 'Critical power and normal critical range both apply.');

console.log('Mind Lightning checks passed.');