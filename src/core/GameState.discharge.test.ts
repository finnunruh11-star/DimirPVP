import { RANGE_UNIT } from '../config/constants';
import type { SubTargeter, VfxSink } from '../effects/effects';
import { GameState } from './GameState';
import { Mage } from './Mage';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(actualJson === expectedJson, `${label}: expected ${expectedJson}, received ${actualJson}`);
}

function mage(name: string, team: number, x: number): Mage {
  return new Mage({ name, isAI: false, team, position: { x, y: 0 }, loadout: [] });
}

function equipThunder(source: Mage, stacks: number): void {
  source.utility.push('roaringThunder');
  source.thunderStacks = stacks;
}

function bridges(
  game: GameState,
  choose: SubTargeter['requestCombatant'],
  arcs: string[],
  impacts: { count: number }
): void {
  const nameAt = (x: number): string => game.mages.find((candidate) => candidate.x === x)?.name ?? '?';
  game.vfxSink = {
    diceRoll: () => undefined,
    lightningBolt: async (from, to) => {
      arcs.push(`${nameAt(from.x)}->${nameAt(to.x)}`);
    },
  } satisfies VfxSink;
  game.subTargeter = {
    requestPoint: async () => null,
    requestEnemy: async () => null,
    requestCombatant: choose,
    reactionWindow: async () => undefined,
    resolveImpacts: async () => {
      impacts.count += 1;
    },
  } satisfies SubTargeter;
}

const tests: [name: string, run: () => Promise<void>][] = [
  ['lets each hop choose allies and the caster and renders every arc', async () => {
    const source = mage('Caster', 1, 0);
    const primary = mage('Primary', 2, RANGE_UNIT / 2);
    const ally = mage('Ally', 1, RANGE_UNIT);
    const spareEnemy = mage('Spare', 2, RANGE_UNIT * 1.5);
    const game = new GameState([source, primary, ally, spareEnemy], 17);
    equipThunder(source, 4);

    const requests: string[][] = [];
    const choices = [ally, source];
    const arcs: string[] = [];
    const impacts = { count: 0 };
    bridges(
      game,
      async (_chooser, opts) => {
        requests.push(opts.candidates.map((candidate) => candidate.name));
        return choices.shift() ?? null;
      },
      arcs,
      impacts
    );

    await game.dischargeThunder(source, primary);

    assert(requests[0].includes('Caster'), 'The caster must be a legal next-hop candidate.');
    assert(requests[0].includes('Ally'), 'A teammate must be a legal next-hop candidate.');
    assert(!requests[0].includes('Primary'), 'A struck combatant must not be offered twice.');
    equal(arcs, ['Caster->Primary', 'Primary->Ally', 'Ally->Caster'], 'Lightning arcs');
    equal(impacts.count, 3, 'Resolved arc impacts');
    equal(source.thunderStacks, 0, 'Consumed Thunder stacks');
  }],

  ['continues with a deterministic valid target when a required choice is absent', async () => {
    const source = mage('Caster', 1, 0);
    const primary = mage('Primary', 2, RANGE_UNIT / 2);
    const ally = mage('Ally', 1, RANGE_UNIT * 0.75);
    const game = new GameState([source, primary, ally], 29);
    equipThunder(source, 1);

    const arcs: string[] = [];
    const impacts = { count: 0 };
    bridges(game, async () => null, arcs, impacts);

    await game.dischargeThunder(source, primary);

    equal(arcs, ['Caster->Primary', 'Primary->Ally'], 'Mandatory fallback arcs');
    equal(impacts.count, 2, 'Mandatory fallback impacts');
  }],
];

for (const [name, run] of tests) {
  await run();
  console.log(`PASS ${name}`);
}
console.log(`Discharge: ${tests.length} checks passed.`);