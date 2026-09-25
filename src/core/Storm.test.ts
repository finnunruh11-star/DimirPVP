import assert from 'node:assert/strict';
import { RANGE_UNIT } from '../config/constants';
import { stormWordsCompatible } from './Colors';
import { GameState } from './GameState';
import { Mage } from './Mage';
import '../spells/sampleSpells';
import { getSpell } from '../spells/registry';

function mage(name: string, team: number, x: number, y = 100): Mage {
  const result = new Mage({ name, team, isAI: false, position: { x, y }, loadout: [] });
  result.maxHp = 100;
  result.hp = 100;
  result.maxSanity = 100;
  result.sanity = 100;
  return result;
}

assert.equal(getSpell(['veil', 'storm']), undefined, 'Veil Storm must remain unimplemented.');
assert.equal(getSpell(['pierce', 'storm']), undefined, 'Storm has no colorless-word spell.');
assert.equal(stormWordsCompatible(['lightning', 'storm']), true);
assert.equal(stormWordsCompatible(['lightning', 'storm', 'subtle']), false);

const lightningStorm = getSpell(['lightning', 'storm']);
assert(lightningStorm, 'Lightning Storm must be registered.');
const stormCaster = mage('Stormcaller', 1, 100);
const targetA = mage('A', 2, 150);
const targetB = mage('B', 2, 200);
const targetC = mage('C', 1, 250);
const outOfRange = mage('Far', 2, 100 + 25 * RANGE_UNIT);
const stormGame = new GameState([stormCaster, targetA, targetB, targetC, outOfRange], 21);
const values: Record<string, number[]> = {
  '1d20': [10, 10],
  '1d8': [2, 5],
  '1d6': [3],
  '1d4': [4],
  '1d3': [2],
};
stormGame.rng.roll = (spec) => {
  const total = values[spec]?.shift();
  if (total === undefined) throw new Error(`Unexpected roll ${spec}.`);
  return { total, rolls: [total], modifier: 0 };
};
const rerollPrompts: string[] = [];
const candidateCounts: number[] = [];
stormGame.subTargeter = {
  requestPoint: async () => null,
  requestEnemy: async () => null,
  requestCombatant: async (_source, opts) => {
    candidateCounts.push(opts.candidates.length);
    return opts.candidates[0] ?? null;
  },
  requestReroll: async (_source, opts) => {
    rerollPrompts.push(opts.label);
    return opts.label === 'Lightning Storm hits';
  },
  reactionWindow: async () => undefined,
  resolveImpacts: async () => undefined,
};
await lightningStorm.cast(stormGame.effectContext(stormCaster, stormCaster, null));
assert.equal(rerollPrompts.length, 6, 'Every individual Storm die offers one reroll.');
assert.deepEqual(candidateCounts, [3, 2, 1, 3, 2], 'Targets cycle before any repeat.');
assert.equal(stormCaster.hp, 97, 'The shared d6 recoil hits the caster once.');
assert.equal(targetA.hp, 92);
assert.equal(targetB.hp, 92);
assert.equal(targetC.hp, 96);
assert.equal(outOfRange.hp, 100);
const activeStorm = stormCaster.statuses.find((status) => status.kind === 'lightningStorm');
assert(activeStorm && activeStorm.kind === 'lightningStorm');
assert.equal(activeStorm.duration, 2);
stormGame.setCurrent(stormCaster);
stormGame.beginTurn();
stormGame.beginTurn();
assert.equal(targetA.hp, 76);
assert.equal(targetB.hp, 76);
assert.equal(targetC.hp, 88);
assert(!stormCaster.statuses.some((status) => status.kind === 'lightningStorm'));

const fireStorm = getSpell(['fire', 'storm']);
assert(fireStorm, 'Fire Storm must be registered.');
const fireCaster = mage('Firecaster', 1, 100);
const fireAlly = mage('Fire ally', 1, 150);
const fireEnemy = mage('Fire enemy', 2, 200);
const fireFar = mage('Fire far', 2, 100 + 12 * RANGE_UNIT);
const fireGame = new GameState([fireCaster, fireAlly, fireEnemy, fireFar], 22);
fireGame.rng.roll = () => ({ total: 4, rolls: [4], modifier: 0 });
await fireStorm.cast(fireGame.effectContext(fireCaster, null, fireCaster.pos));
for (const target of [fireAlly, fireEnemy]) {
  const fire = target.statuses.find((status) => status.kind === 'fire');
  assert(fire && fire.kind === 'fire');
  assert.equal(fire.stacks, 4);
}
assert(!fireCaster.statuses.some((status) => status.kind === 'fire'));
assert(!fireFar.statuses.some((status) => status.kind === 'fire'));

const mindStorm = getSpell(['mind', 'storm']);
assert(mindStorm, 'Mind Storm must be registered.');
const mindCaster = mage('Mindcaster', 1, 100);
const mindAlly = mage('Mind ally', 1, 150);
const mindEnemy = mage('Mind enemy', 2, 200);
const mindFar = mage('Mind far', 2, 100 + 12 * RANGE_UNIT);
const mindGame = new GameState([mindCaster, mindAlly, mindEnemy, mindFar], 23);
await mindStorm.cast(mindGame.effectContext(mindCaster, null, mindCaster.pos));
for (const target of [mindAlly, mindEnemy]) {
  const control = target.statuses.find((status) => status.kind === 'control');
  assert(control && control.kind === 'control');
  assert.equal(control.mode, 'expose');
  assert.equal(control.duration, 10);
  assert.equal(target.modifier('damageTaken'), 20);
}
assert.equal(mindCaster.statuses.length, 0);
assert.equal(mindFar.statuses.length, 0);

const lightningMindStorm = getSpell(['lightning', 'mind', 'storm']);
assert(lightningMindStorm, 'Lightning Mind Storm must be registered.');
const mindBoltCaster = mage('Mind stormcaller', 1, 100);
const mindBoltAlly = mage('Mind ally', 1, 120);
const mindBoltA = mage('Mind target A', 2, 150);
const mindBoltB = mage('Mind target B', 2, 180);
const mindBoltGame = new GameState([mindBoltCaster, mindBoltAlly, mindBoltA, mindBoltB], 24);
let pickIndex = 0;
mindBoltGame.rng.pick = <T>(items: readonly T[]): T => items[pickIndex++ % items.length];
mindBoltGame.rng.roll = (spec) => {
  const total = spec === '1d10' ? 3 : spec === '1d3' ? 2 : 1;
  return { total, rolls: [total], modifier: 0 };
};
let bolts = 0;
mindBoltGame.vfxSink = {
  diceRoll: () => undefined,
  mindLightningBolt: async () => { bolts += 1; },
};
await lightningMindStorm.cast(mindBoltGame.effectContext(mindBoltCaster, mindBoltCaster, null));
assert.equal(mindBoltA.lightningMindStacks, 8);
assert.equal(mindBoltB.lightningMindStacks, 8);
assert.equal(
  mindBoltA.lightningMindStacks + mindBoltB.lightningMindStacks,
  16,
  'Four living entities cause eight separate two-stack applications.'
);
assert.equal(bolts, 3);
assert.equal(mindBoltCaster.sanity, 97, 'A route roll of 1 sends each normal bolt into the caster.');

console.log('Storm checks passed.');