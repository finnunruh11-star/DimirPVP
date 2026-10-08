import assert from 'node:assert/strict';
import { RANGE_UNIT } from '../config/constants';
import { computeColorProfile, stormWordsCompatible, wordSpellMana } from './Colors';
import { GameState } from './GameState';
import { Mage } from './Mage';
import { parseScenario } from './Scenario';
import { capturePartySnapshot, restoreParty } from '../pve/exploration/party';
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
assert.equal(stormWordsCompatible(['lightning', 'mind', 'storm']), false);
assert.equal(getSpell(['lightning', 'mind', 'storm']), undefined, 'Storm has no three-word spells.');
assert.equal(stormWordsCompatible(['shadow', 'storm']), false);
assert.equal(wordSpellMana(['mind', 'storm'], computeColorProfile(['mind', 'storm'])), 0);
assert.equal(wordSpellMana(['fire', 'storm'], computeColorProfile(['fire', 'storm', 'shadow'])), 0);
assert(getSpell(['storm']), 'Storm must be castable on its own.');

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

const dailyCaster = mage('Daily storm', 1, 100);
dailyCaster.setLoadout(['fire', 'storm']);
const startingFireCharges = dailyCaster.charges.fire;
const dailyTarget = mage('Daily target', 2, 150);
const dailyGame = new GameState([dailyCaster, dailyTarget], 25);
dailyGame.rng.roll = () => ({ total: 1, rolls: [1], modifier: 0 });
assert.equal(dailyCaster.hasCharges(['storm']), false, 'Solo Storm needs a previous dualcast.');
for (let cast = 0; cast < 3; cast += 1) {
  assert(dailyCaster.hasCharges(['fire', 'storm']));
  dailyCaster.spendCharges(['fire', 'storm']);
  await dailyGame.makeSpellItem(dailyCaster, fireStorm, null, dailyTarget.pos).resolve(dailyGame);
}
assert.equal(dailyCaster.charges.fire, startingFireCharges - 3, 'Only the paired word spends charges.');
assert.equal(dailyCaster.charges.storm, 3, 'Storm has its own daily uses.');
assert.deepEqual(dailyCaster.stormLoadedWords, ['fire', 'fire', 'fire']);
assert.equal(dailyCaster.hasCharges(['fire', 'storm']), false, 'No fourth dualcast on this day.');
const soloStorm = getSpell(['storm']);
assert(soloStorm);
const releases: string[] = [];
const overflows: string[] = [];
dailyGame.onLog = (line) => {
  if (line.includes('Storm releases')) releases.push(line);
  if (line.includes('Fire overflows')) overflows.push(line);
};
for (let cast = 0; cast < 2; cast += 1) {
  assert(dailyCaster.hasCharges(['storm']));
  dailyCaster.spendCharges(['storm']);
  await dailyGame.makeSpellItem(dailyCaster, soloStorm, dailyCaster, null).resolve(dailyGame);
  if (cast === 0) {
    const firstFire = dailyTarget.statuses.find((status) => status.kind === 'fire');
    assert(firstFire && firstFire.kind === 'fire');
    assert.equal(firstFire.stacks, 6, 'The first solo release reapplies each stored Fire Storm.');
  }
}
assert.equal(releases.length, 6, 'Each solo cast releases all three previous dualcasts.');
const renewedFire = dailyTarget.statuses.find((status) => status.kind === 'fire');
assert(renewedFire && renewedFire.kind === 'fire');
assert.equal(renewedFire.stacks, 5, 'The second release drives Fire past six and resets it after detonation.');
assert(overflows.length > 0 && dailyTarget.hp < 100, 'Replaying Fire Storm can detonate stored Fire.');
assert.equal(dailyCaster.hasCharges(['storm']), false, 'Solo Storm is limited to twice per day.');
const stored = parseScenario(JSON.stringify(capturePartySnapshot([dailyCaster, dailyTarget])));
const [restored] = restoreParty(stored);
assert.deepEqual(
  [restored.stormDualcastsUsed, restored.stormMonocastsUsed, restored.stormLoadedWords],
  [3, 2, ['fire', 'fire', 'fire']],
  'The daily uses and stored spells survive a party save.'
);
dailyCaster.resetForNewCombat();
assert.equal(dailyCaster.stormDualcastsUsed, 3, 'A new combat does not reset the daily limit.');
dailyCaster.startStormDay(2);
assert.deepEqual(dailyCaster.stormLoadedWords, [], 'A new day clears stored dualcasts.');
assert.equal(dailyCaster.stormMonocastsUsed, 0);
dailyCaster.charges.fire = 1;
assert(dailyCaster.hasCharges(['fire', 'storm']), 'Three dualcasts are available on the new day.');
assert.equal(dailyCaster.hasCharges(['storm']), false, 'A new day must be loaded before a solo release.');

const mindStorm = getSpell(['mind', 'storm']);
assert(mindStorm, 'Mind Storm must be registered.');
const mindCaster = mage('Mindcaster', 1, 100);
const mindAlly = mage('Mind ally', 1, 150);
const mindEnemy = mage('Mind enemy', 2, 200);
const mindFar = mage('Mind far', 2, 100 + 12 * RANGE_UNIT);
const mindGame = new GameState([mindCaster, mindAlly, mindEnemy, mindFar], 23);
await mindGame.makeSpellItem(mindCaster, mindStorm, mindCaster, null).resolve(mindGame);
const rolledSides: number[] = [];
mindGame.rng.die = (sides) => { rolledSides.push(sides); return 1; };
mindGame.beginMindStormAction(mindEnemy);
assert.equal(mindEnemy.sanity, 98, 'The next creature to act takes 2 sanity damage.');
assert.equal(mindGame.rng.consistentSpec('1d20'), '1d10+10');
assert.equal(mindGame.rng.consistentSpec('1d3'), '1d2+1');
assert.equal(mindGame.rng.roll('1d20').total, 11, 'A d20 becomes d10+10.');
assert.equal(mindGame.rng.roll('1d3').total, 2, 'A d3 becomes d2+1.');
assert.equal(mindGame.rng.roll('2d6+1').total, 9, 'Every die in a larger roll uses its upper half.');
mindGame.endMindStormAction();
assert.deepEqual(rolledSides, [10, 2, 3, 3]);
assert.equal(mindGame.rng.roll('1d20').total, 1, 'Later actions roll normally.');
assert.equal(mindAlly.sanity, 100);
assert.equal(mindFar.sanity, 100);

console.log('Storm checks passed.');