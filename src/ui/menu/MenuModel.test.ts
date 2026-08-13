import { MODE_CAPABILITIES } from '../../config/MatchConfig';
import type { WordId } from '../../core/Words';
import { MenuModel } from './MenuModel';

const STANDARD_WORDS = ['bind', 'shadow', 'veil', 'mind', 'shatter'] as const;

function fillBuild(model: MenuModel, seat: number, words: readonly WordId[] = STANDARD_WORDS): void {
  for (const word of words) model.toggleWord(seat, word);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(actualJson === expectedJson, `${label}: expected ${expectedJson}, received ${actualJson}`);
}

function throws(run: () => void, expectedMessage: string): void {
  try {
    run();
  } catch (error) {
    assert(error instanceof Error, 'Expected an Error instance.');
    assert(error.message === expectedMessage, `Expected "${expectedMessage}", received "${error.message}".`);
    return;
  }
  throw new Error(`Expected "${expectedMessage}" to be thrown.`);
}

const tests: [name: string, run: () => void][] = [
  ['keeps Expedition honest as a solo three-word campaign', () => {
    const model = new MenuModel();
    model.setMode('expedition');

    equal(MODE_CAPABILITIES.expedition.roles, ['local'], 'Expedition roles');
    equal(model.seatCount, 1, 'Expedition seat count');
    equal(model.aiCount, 0, 'Expedition AI count');
    equal(model.loadoutLimit(), 3, 'Expedition loadout size');
    equal(model.setRole('host'), false, 'Expedition host rejection');
  }],

  ['uses one human and fills the rest with AI in AI Duel', () => {
    const model = new MenuModel();
    model.setMode('ai');
    model.setSeatCount(4);

    equal(model.aiCount, 3, 'AI fill');
    equal(model.humanSeats(), [0], 'Human seats');
  }],

  ['never allows every content pack to be disabled', () => {
    const model = new MenuModel();

    equal(model.toggleItemSet('original'), false, 'Last pack rejection');
    equal(model.itemSets, { original: true, finns: false, dlc: false }, 'Initial packs');
    equal(model.toggleItemSet('finns'), true, 'Enable Finn pack');
    equal(model.toggleItemSet('original'), true, 'Disable Original pack');
    equal(model.itemSets, { original: false, finns: true, dlc: false }, 'Resulting packs');
  }],

  ['accepts the four-word NAD exception and unlocks its hidden words', () => {
    const model = new MenuModel();
    model.setMode('ai');
    for (const key of 'NAD') model.feedSecretKey(key);

    equal(model.draftFor(0).words, ['mind', 'shatter', 'twist', 'reality'], 'NAD loadout');
    assert(model.visibleWords().includes('twist'), 'Twist should be visible after NAD.');
    assert(model.visibleWords().includes('reality'), 'Reality should be visible after NAD.');
    equal(model.loadoutReady(0), true, 'NAD readiness');
  }],

  ['trims presets to the selected mode cap', () => {
    const model = new MenuModel();
    model.setMode('expedition');
    model.applyPreset('SNIFF');

    equal(model.draftFor(0).words, ['pierce', 'mind', 'veil'], 'Trimmed Expedition preset');
    equal(model.loadoutReady(0), true, 'Expedition preset readiness');
  }],

  ['assembles local seats with exactly one modifier per build', () => {
    const model = new MenuModel();
    model.setMode('hotseat');
    model.setSeatCount(3);
    model.setAiCount(1);
    fillBuild(model, 0);
    fillBuild(model, 1, ['corrode', 'curse', 'pierce', 'shadow', 'mind']);
    model.setModifier(1, 'channel');

    const config = model.toLocalMatchConfig(() => 0.25);

    equal(config.seats?.length, 3, 'Seat count');
    equal(config.seats?.map((seat) => seat.isAI), [false, false, true], 'Seat controllers');
    equal(config.seats?.[0].loadout.length, 6, 'Player one loadout size');
    equal(config.seats?.[0].loadout.slice(-1)[0], 'subtle', 'Player one modifier');
    equal(config.seats?.[1].loadout.slice(-1)[0], 'channel', 'Player two modifier');
    equal(config.seats?.[2].loadout.length, 6, 'AI loadout size');
  }],

  ['carries Swamprun party and preparation choices into MatchConfig', () => {
    const model = new MenuModel();
    model.setMode('swamprun');
    model.setSeatCount(3);
    model.setAiCount(2);
    model.setPrepMode('creative');
    fillBuild(model, 0);

    const config = model.toLocalMatchConfig(() => 0.5);

    equal(config.mode, 'swamprun', 'Swamprun mode');
    equal(config.swampPrepMode, 'creative', 'Swamprun preparation');
    equal(config.seats?.length, 3, 'Swamprun party size');
    equal(config.seats?.every((seat) => seat.team === 1), true, 'Swamprun teams');
  }],

  ['requires every local Swamprun player to finish a build', () => {
    const model = new MenuModel();
    model.setMode('swamprun');
    model.setSeatCount(2);
    model.setAiCount(0);
    fillBuild(model, 0);

    throws(() => model.toLocalMatchConfig(), "Player 2's build is incomplete.");
    fillBuild(model, 1, ['corrode', 'curse', 'pierce', 'shadow', 'mind']);

    const config = model.toLocalMatchConfig(() => 0.5);
    equal(config.seats?.map((seat) => seat.isAI), [false, false], 'Local Swamprun controllers');
    equal(config.seats?.map((seat) => seat.loadout.length), [6, 6], 'Local Swamprun builds');
  }],

  ['rejects incomplete local builds before launch', () => {
    const model = new MenuModel();
    model.setMode('training');

    throws(() => model.toLocalMatchConfig(), "Player 1's build is incomplete.");
  }],
];

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`MenuModel: ${tests.length} checks passed.`);