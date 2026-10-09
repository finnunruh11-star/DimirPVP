import { MODE_CAPABILITIES } from '../../config/MatchConfig';
import { Dice } from '../../core/Dice';
import type { Scenario } from '../../core/Scenario';
import type { WordId } from '../../core/Words';
import { Net } from '../../net/Net';
import { ADVENTURE_PROTOCOL } from '../../net/AdventureSession';
import { rollSwamprunEncounter } from '../../pve/swamprun';
import { isBloodmoonRaid, RAID_TARGETS, type RaidTarget } from '../../pve/raidTargets';
import { raidTargetCopy } from './content';
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
  ['spawns the Reaper only against parties of at least two', () => {
    const lowRoll = { die: () => 1 } as unknown as Dice;

    equal(
      rollSwamprunEncounter(7, lowRoll, 1).kinds,
      ['lich', 'defender', 'defender'],
      'Solo 700m fallback',
    );
    equal(rollSwamprunEncounter(7, lowRoll, 2).kinds, ['reaper'], 'Two-member Reaper encounter');
  }],

  ['keeps Exploration builds out of the menu', () => {
    const model = new MenuModel();
    model.setMode('exploration');

    equal(MODE_CAPABILITIES.exploration.roles, ['local', 'host', 'guest'], 'Exploration roles');
    equal(MODE_CAPABILITIES.exploration.seats, [1, 3], 'One traveller per class');
    equal(MODE_CAPABILITIES.exploration.category, 'adventures', 'Exploration category');
    equal(MODE_CAPABILITIES.exploration.usesBuild, false, 'Exploration builds in the world');
    equal(model.seatCount, 1, 'Exploration seat count');
    equal(model.aiCount, 0, 'Exploration AI count');
    equal(model.loadoutLimit(), 2, 'Exploration starting words');
    equal(model.isReady(), true, 'Exploration needs no menu build');
    equal(model.setRole('guest'), true, 'Exploration can be joined online');
    equal(model.setRole('host'), true, 'Exploration can be hosted');
    model.setSeatCount(4);
    equal(model.seatCount, 3, 'at most three travellers');
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

  ['assembles native Exploration as a lone traveller', () => {
    const model = new MenuModel();
    model.setMode('exploration');
    const config = model.toLocalMatchConfig(() => 0.25);
    equal(config.mode, 'exploration', 'Exploration mode');
    equal(config.seats?.length, 1, 'Exploration seats');
    equal(config.seats?.[0].loadout, [], 'Exploration words are picked in the world');
    equal(config.seats?.[0].isAI, false, 'Exploration seat is human');
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
    model.setMode('exploration');
    model.applyPreset('SNIFF');

    equal(model.draftFor(0).words, ['pierce', 'mind'], 'Trimmed Exploration preset');
    equal(model.loadoutReady(0), true, 'Exploration preset readiness');
  }],

  ['reveals Storm only through the six-word SNIFF preset', () => {
    const model = new MenuModel();
    model.setMode('ai');
    assert(!model.visibleWords().includes('storm'), 'Storm starts hidden from the normal grid.');

    model.applyPreset('SNIFF');
    equal(
      model.draftFor(0).words,
      ['pierce', 'mind', 'veil', 'fire', 'lightning', 'storm'],
      'SNIFF loadout'
    );
    assert(model.visibleWords().includes('storm'), 'SNIFF reveals Storm.');
    equal(model.loadoutReady(0), true, 'Six-word SNIFF readiness');
    equal(
      sanitizeOnlineLoadout([...model.draftFor(0).words, 'subtle']),
      ['pierce', 'mind', 'veil', 'fire', 'lightning', 'storm', 'subtle'],
      'Online SNIFF loadout'
    );
    equal(
      sanitizeOnlineLoadout(['mind', 'storm', 'subtle']),
      ['mind', 'subtle'],
      'Storm cannot be injected outside SNIFF'
    );
    equal(model.toggleWord(0, 'pierce'), true, 'SNIFF word removal');
    assert(!model.draftFor(0).words.includes('storm'), 'Editing SNIFF removes Storm.');
    equal(model.loadoutReady(0), false, 'Edited SNIFF readiness');
    equal(model.toggleWord(0, 'storm'), false, 'Manual Storm selection');
    model.draftFor(0).words = ['bind', 'mind', 'veil', 'fire', 'lightning', 'storm'];
    equal(model.loadoutReady(0), false, 'Altered six-word Storm readiness');
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
    equal(model.setRaidBoss('lillith'), true, 'Select a bloodmoon boss');
    equal(model.toLocalMatchConfig(() => 0.5).raidBoss, 'lillith', 'Bloodmoon raid target');
  }],

  ['offers only the retained Bloodmoon bosses in Raid', () => {
    equal(RAID_TARGETS.filter(isBloodmoonRaid), ['goblins', 'rock', 'crusade', 'baral', 'lillith'], 'Bloodmoon raid roster');
    equal(raidTargetCopy('crusade').label, 'Crucade', 'Crucade short label');
    const model = new MenuModel();
    model.setMode('raid');
    equal(model.setRaidBoss('crusade'), true, 'Select Crucade');
    for (const id of ['selga', 'zargarg', 'dragon', 'planetar', 'minion']) {
      equal(model.setRaidBoss(id as RaidTarget), false, `${id} cannot be selected`);
      equal(model.raidBoss, 'crusade', 'Rejected selection keeps Crucade');
    }
  }],

  ['keeps Reaper Raid parties at two or more members', () => {
    const model = new MenuModel();
    model.setMode('raid');
    model.setSeatCount(1);

    equal(model.seatCount, 1, 'Solo non-Reaper Raid');
    equal(model.setRaidBoss('reaper'), true, 'Select Reaper');
    equal(model.seatCount, 2, 'Reaper party reservation');
    model.setSeatCount(1);
    equal(model.seatCount, 2, 'Reaper solo clamp');
    equal(model.setRaidBoss('lich'), true, 'Select solo-capable boss');
    model.setSeatCount(1);
    equal(model.seatCount, 1, 'Solo Lich Raid');
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
    equal(sanitizeOnlineRaidBoss('baral'), 'baral', 'A bloodmoon boss survives sanitising');
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

  ['assembles an online Adventure party of humans with no menu build', async () => {
    const originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = FakeAdventureRelaySocket as unknown as typeof WebSocket;
    try {
      const model = new MenuModel();
      model.setMode('exploration');
      model.setRole('host');
      model.setSeatCount(2);
      const coordinator = new OnlineCoordinator(model, () => undefined);
      const config = await coordinator.connect({ role: 'host', room: '77', url: 'ws://relay.test/ws' });
      equal(config.mode, 'exploration', 'Adventure mode');
      equal(config.seats?.map((seat) => seat.isAI), [false, false], 'no AI travellers');
      equal(config.adventure, { resume: false }, 'a new run');
      config.net?.close();
    } finally {
      globalThis.WebSocket = originalWebSocket;
    }
  }],

  ['routes Adventure messages around the lockstep queue', async () => {
    const socket = new FakeSocket();
    const net = new (Net as unknown as new (ws: WebSocket) => Net)(socket as unknown as WebSocket);
    const deliver = (message: object): void => socket.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
    deliver({ k: 'x-live', from: 0, n: 1 });
    deliver({ k: 'x-live', from: 0, n: 2 });
    deliver({ k: 'turn', cmd: 1 });
    deliver({ k: 'x-run', from: 0 });
    equal((await net.recv()).k, 'turn', 'the lockstep queue only sees lockstep messages');
    const seen: unknown[] = [];
    net.setAdventureHandler((message) => seen.push(message.k === 'x-live' ? message.n : message.k));
    equal(seen, [2, 'x-run'], 'held adventure messages replay, keeping only the newest live frame');
    deliver({ k: 'bye', seat: 1 });
    equal(seen[2], 'bye', 'a departure reaches the session');
    equal((await net.recv()).k, 'bye', 'and a fight waiting on the queue');
    net.close();
  }],

  ['keeps party votes out of the lockstep queue', async () => {
    const socket = new FakeSocket();
    const net = new (Net as unknown as new (ws: WebSocket) => Net)(socket as unknown as WebSocket);
    const deliver = (message: object): void => socket.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
    deliver({ k: 'mine-vote', from: 1, round: 1, choice: 'N' });
    deliver({ k: 'mine-choice', round: 1, choice: 'N' });
    equal((await net.recv()).k, 'mine-choice', 'a vote never enters the lockstep queue');
    const seen: unknown[] = [];
    net.setSideHandler((message) => seen.push(message.choice));
    equal(seen, ['N'], 'an early vote waits for the vote it belongs to');
    deliver({ k: 'mine-vote', from: 2, round: 1, choice: 'E' });
    equal(seen, ['N', 'E'], 'votes go straight to the running vote');
    net.setSideHandler(null);
    deliver({ k: 'mine-vote', from: 2, round: 1, choice: 'W' });
    deliver({ k: 'turn', cmd: 1 });
    equal((await net.recv()).k, 'turn', 'a late vote stays out of the next fight');
    net.close();
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

/** A relay with one guest who joins an Adventure room, stamped as the relay does. */
class FakeAdventureRelaySocket extends FakeSocket {
  onopen: (() => void) | null = null;

  constructor(_url: string | URL) {
    super();
    queueMicrotask(() => this.onopen?.());
  }

  override send(raw: string): void {
    const message = JSON.parse(raw) as { k: string };
    if (message.k === 'join') {
      this.emit({ k: 'seat', seat: 0, size: 2 });
      this.emit({ k: 'ready', size: 2 });
    } else if (message.k === 'hello') {
      this.emit({ k: 'hello', seat: 1, from: 1, loadout: [], class: 'life', v: ADVENTURE_PROTOCOL });
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