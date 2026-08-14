import { MODE_CAPABILITIES } from '../../config/MatchConfig';
import type { Scenario } from '../../core/Scenario';
import type { WordId } from '../../core/Words';
import { Net } from '../../net/Net';
import { MenuModel } from './MenuModel';
import {
  OnlineCoordinator,
  sanitizeOnlineItemSets,
  sanitizeOnlineLoadout,
  sanitizeOnlineRaidBoss,
  sanitizeOnlineSeats,
} from './OnlineCoordinator';

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

const tests: [name: string, run: () => void | Promise<void>][] = [
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

  ['assembles a native AI Duel table', () => {
    const model = new MenuModel();
    model.setMode('ai');
    model.setSeatCount(4);
    fillBuild(model, 0);
    equal(model.isReady(), true, 'AI Duel readiness');
    const config = model.toLocalMatchConfig(() => 0.25);
    equal(config.mode, 'ai', 'AI Duel mode');
    equal(config.seats?.map((seat) => seat.isAI), [false, true, true, true], 'AI Duel controllers');
    equal(config.seats?.map((seat) => seat.team), [1, 1, 2, 2], 'AI Duel teams');
    equal(config.itemSets, { original: true, finns: false, dlc: false }, 'AI Duel packs');
  }],

  ['assembles native Training without a legacy seat table', () => {
    const model = new MenuModel();
    model.setMode('training');
    fillBuild(model, 0);
    const config = model.toLocalMatchConfig(() => 0.25);
    equal(config.mode, 'training', 'Training mode');
    equal(config.seats, undefined, 'Training explicit seats');
    equal(config.loadouts[0].length, 6, 'Training player loadout');
    equal(config.loadouts[1].length, 6, 'Training opponent loadout');
  }],

  ['assembles native Expedition with its three-word build', () => {
    const model = new MenuModel();
    model.setMode('expedition');
    fillBuild(model, 0, ['bind', 'shadow', 'mind']);
    const config = model.toLocalMatchConfig(() => 0.25);
    equal(config.mode, 'expedition', 'Expedition mode');
    equal(config.seats?.length, 1, 'Expedition seats');
    equal(config.seats?.[0].loadout, ['bind', 'shadow', 'mind', 'subtle'], 'Expedition loadout');
    equal(config.swampPrepMode, undefined, 'Expedition preparation');
  }],

  ['preserves explicit mixed teams for human and AI seats', () => {
    const model = new MenuModel();
    model.setMode('hotseat');
    model.setSeatCount(4);
    model.setAiCount(2);
    equal(model.setSeatTeam(1, 2), true, 'Move player two');
    equal(model.setSeatTeam(2, 1), true, 'Move AI three');
    fillBuild(model, 0);
    fillBuild(model, 1, ['corrode', 'curse', 'pierce', 'shadow', 'mind']);
    const config = model.toLocalMatchConfig(() => 0.25);
    equal(config.seats?.map((seat) => seat.team), [1, 2, 1, 2], 'Mixed teams');
  }],

  ['assembles a native three-player Hotseat free-for-all', () => {
    const model = new MenuModel();
    model.setMode('hotseat');
    model.setSeatCount(3);
    model.setAiCount(0);
    equal(model.setTeamFormat('ffa'), true, 'Enable Hotseat FFA');
    fillBuild(model, 0);
    fillBuild(model, 1, ['corrode', 'curse', 'pierce', 'shadow', 'mind']);
    fillBuild(model, 2, ['bind', 'corrode', 'curse', 'pierce', 'shatter']);
    equal(model.localDraftSeats(), [0, 1, 2], 'Hotseat build order');
    equal(model.isReady(), true, 'Hotseat readiness');
    const config = model.toLocalMatchConfig(() => 0.25);
    equal(config.mode, 'hotseat', 'Hotseat mode');
    equal(config.seats?.map((seat) => seat.isAI), [false, false, false], 'Hotseat controllers');
    equal(config.seats?.map((seat) => seat.team), [1, 2, 3], 'Hotseat FFA teams');
    equal(config.seats?.map((seat) => seat.loadout.length), [6, 6, 6], 'Hotseat builds');
  }],

  ['assembles a native Scenario Lab starter roster', () => {
    const model = new MenuModel();
    model.setMode('scenario');
    model.setSeatCount(3);
    model.setAiCount(2);
    fillBuild(model, 0);
    const config = model.toLocalMatchConfig(() => 0.25);
    equal(config.mode, 'scenario', 'Scenario mode');
    equal(config.seats?.map((seat) => seat.isAI), [false, true, true], 'Scenario controllers');
    equal(config.seats?.map((seat) => seat.team), [1, 1, 2], 'Scenario starter teams');
    equal(config.seats?.map((seat) => seat.loadout.length), [6, 6, 6], 'Scenario starter builds');
    equal(config.swampPrepMode, undefined, 'Scenario preparation');
    equal(config.scenario, undefined, 'Scenario file payload');
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

  ['assembles a native Mine Run party with preparation', () => {
    const model = new MenuModel();
    model.setMode('minerun');
    model.setSeatCount(3);
    model.setAiCount(2);
    model.setPrepMode('quick');
    model.toggleItemSet('finns');
    fillBuild(model, 0);
    const config = model.toLocalMatchConfig(() => 0.5);
    equal(config.mode, 'minerun', 'Mine Run mode');
    equal(config.swampPrepMode, 'quick', 'Mine Run preparation');
    equal(config.seats?.length, 3, 'Mine Run party size');
    equal(config.seats?.map((seat) => seat.isAI), [false, true, true], 'Mine Run controllers');
    equal(config.seats?.every((seat) => seat.team === 1), true, 'Mine Run teams');
    equal(config.itemSets, { original: true, finns: true, dlc: false }, 'Mine Run packs');
  }],

  ['assembles a native Raid against the selected boss', () => {
    const model = new MenuModel();
    model.setMode('raid');
    model.setSeatCount(2);
    model.setAiCount(1);
    model.setPrepMode('creative');
    equal(model.setRaidBoss('reaper'), true, 'Select Reaper');
    fillBuild(model, 0);
    const config = model.toLocalMatchConfig(() => 0.5);
    equal(config.mode, 'raid', 'Raid mode');
    equal(config.raidBoss, 'reaper', 'Raid target');
    equal(config.swampPrepMode, 'creative', 'Raid preparation');
    equal(config.seats?.map((seat) => seat.isAI), [false, true], 'Raid controllers');
    equal(config.seats?.every((seat) => seat.team === 1), true, 'Raid teams');
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
    equal(model.buildSeatsReady(), false, 'Incomplete build readiness');
    equal(model.isReady(), false, 'Incomplete setup readiness');
    equal(model.validationIssues(), ["Player 1's build is incomplete."], 'Incomplete setup issues');
    throws(() => model.toLocalMatchConfig(), "Player 1's build is incomplete.");
  }],

  ['assembles a native Memory payload from a sanitized scenario', () => {
    const scenario = {
      version: 1,
      name: 'Bridge Ambush',
      createdAt: '2026-08-14T00:00:00.000Z',
      entities: [
        { loadout: ['bind', 'shadow', 'subtle'] },
        { loadout: ['mind', 'shatter', 'channel'] },
      ],
      scarabs: [],
      turn: { order: [0, 1], rolls: [18, 12], currentIndex: 0, round: 3, turnSeq: 8 },
    } as unknown as Scenario;
    const model = new MenuModel();
    model.setMode('memory');
    model.toggleItemSet('finns');
    const config = model.toMemoryMatchConfig(scenario);
    equal(config.mode, 'memory', 'Memory mode');
    equal(config.loadouts, [scenario.entities[0].loadout, scenario.entities[1].loadout], 'Memory compatibility loadouts');
    equal(config.itemSets, { original: true, finns: true, dlc: false }, 'Memory packs');
    equal(config.scenario === scenario, true, 'Memory scenario identity');
  }],

  ['validates native Online host and guest setup ownership', () => {
    const host = new MenuModel();
    host.setMode('online');
    host.setSeatCount(4);
    host.setAiCount(2);
    fillBuild(host, 0);
    equal(host.role, 'host', 'Online default role');
    equal(host.humanCount(), 2, 'Online host human seats');
    equal(host.localDraftSeats(), [0], 'Online host local build seats');
    equal(host.isReady(), true, 'Online host readiness');

    const guest = new MenuModel();
    guest.setMode('online');
    equal(guest.setRole('guest'), true, 'Online guest role');
    fillBuild(guest, 0);
    equal(guest.localDraftSeats(), [0], 'Online guest build seats');
    equal(guest.isReady(), true, 'Online guest readiness');
  }],

  ['sanitizes untrusted online match data', () => {
    equal(
      sanitizeOnlineLoadout(['bind', 'bogus', 'shadow', 'subtle', 'channel']),
      ['bind', 'shadow', 'subtle'],
      'Sanitized online loadout'
    );
    equal(
      sanitizeOnlineItemSets({ original: false, finns: false, dlc: false }),
      { original: true, finns: false, dlc: false },
      'Sanitized online packs'
    );
    equal(sanitizeOnlineRaidBoss('not-a-boss'), 'deathknightSpear', 'Sanitized raid target');
    const seats = sanitizeOnlineSeats([
      { name: 'A', team: 1.9, isAI: false, loadout: ['mind'], mageClass: 'life' },
      { name: 7, team: Number.NaN, isAI: true, loadout: [], mageClass: 'invalid' },
    ], 2);
    equal(seats[0].team, 1, 'Sanitized team number');
    equal(seats[0].mageClass, 'life', 'Sanitized class');
    equal(seats[1].name, 'Player 2', 'Sanitized seat name');
    equal(seats[1].loadout, ['pierce', 'subtle'], 'Sanitized empty loadout');
  }],

  ['unblocks pending receives when Net closes', async () => {
    const socket = new FakeSocket();
    const net = new (Net as unknown as new (ws: WebSocket) => Net)(socket as unknown as WebSocket);
    const pending = net.recv();
    net.close();
    net.close();
    equal((await pending).k, 'bye', 'Closed receive message');
    equal(socket.closeCount, 1, 'Idempotent socket close');
  }],

  ['assembles an Online host match through the coordinator', async () => {
    const originalWebSocket = globalThis.WebSocket;
    FakeRelaySocket.instance = null;
    globalThis.WebSocket = FakeRelaySocket as unknown as typeof WebSocket;
    try {
      const model = new MenuModel();
      model.setMode('online');
      model.setSeatCount(2);
      model.setAiCount(0);
      fillBuild(model, 0);
      const stages: string[] = [];
      const coordinator = new OnlineCoordinator(model, (status) => stages.push(status.stage));
      const config = await coordinator.connect({
        role: 'host',
        room: '4242',
        url: 'ws://relay.test/ws',
      });
      equal(config.mode, 'online', 'Coordinator mode');
      equal(config.localSeat, 0, 'Coordinator local seat');
      equal(config.seats?.map((seat) => seat.isAI), [false, false], 'Coordinator controllers');
      equal(config.seats?.[1].mageClass, 'life', 'Remote class');
      assert(stages.includes('waiting'), 'Coordinator should report waiting.');
      assert(stages.includes('assembling'), 'Coordinator should report assembling.');
      assert(stages.includes('starting'), 'Coordinator should report starting.');
      config.net?.close();
    } finally {
      globalThis.WebSocket = originalWebSocket;
    }
  }],
];

class FakeSocket {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closeCount = 0;

  send(_message: string): void {}

  close(): void {
    this.closeCount += 1;
  }
}

class FakeRelaySocket extends FakeSocket {
  static instance: FakeRelaySocket | null = null;
  onopen: (() => void) | null = null;

  constructor(_url: string | URL) {
    super();
    FakeRelaySocket.instance = this;
    queueMicrotask(() => this.onopen?.());
  }

  override send(raw: string): void {
    const message = JSON.parse(raw) as { k: string };
    if (message.k === 'join') {
      this.emit({ k: 'seat', seat: 0, size: 2 });
      this.emit({ k: 'ready', size: 2 });
    } else if (message.k === 'hello') {
      this.emit({
        k: 'hello',
        seat: 1,
        loadout: ['corrode', 'curse', 'pierce', 'shadow', 'mind', 'channel'],
        class: 'life',
      });
    }
  }

  private emit(message: object): void {
    queueMicrotask(() => {
      this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
    });
  }
}

for (const [name, run] of tests) {
  await run();
  console.log(`PASS ${name}`);
}
console.log(`MenuModel: ${tests.length} checks passed.`);