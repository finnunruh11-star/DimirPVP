import {
  applyCouncil,
  campOutcome,
  emptyCouncil,
  innOutcome,
  leaveOutcome,
  openPoll,
  parseCouncil,
  parseCouncilOp,
  pollOutcome,
  travelOutcome,
  type Council,
  type CouncilOp,
} from '../pve/exploration/council';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}: expected ${e}, received ${a}`);
}

const NAMES = ['Ada', 'Bo', 'Cy'];
const say = (council: Council, seat: number, op: CouncilOp) => applyCouncil(council, seat, op, (s) => NAMES[s] ?? '?');

const tests: [name: string, run: () => void][] = [
  ['travels once everyone has chosen the same plan: choosing a pace is agreeing', () => {
    const council = emptyCouncil(2);
    say(council, 0, { op: 'route', dest: { x: 4, y: 5 } });
    say(council, 0, { op: 'mode', mode: 'sprint' });
    equal(travelOutcome(council).t, 'open', 'the other has no plan yet');
    say(council, 1, { op: 'route', dest: { x: 4, y: 5 } });
    say(council, 1, { op: 'hover', mode: 'sneak' });
    equal(council.travel[1].hover, 'sneak', 'hovering is shown');
    say(council, 1, { op: 'mode', mode: 'sneak' });
    equal(travelOutcome(council).t, 'split', 'the same way, not the same pace');
    say(council, 1, { op: 'mode', mode: 'sprint' });
    equal(travelOutcome(council), { t: 'go', dest: { x: 4, y: 5 }, mode: 'sprint' }, 'agreed');
    say(council, 1, { op: 'route', dest: { x: 5, y: 5 } });
    equal([council.travel[1].mode, travelOutcome(council).t], [null, 'open'], 'a new way needs a new pace');
  }],

  ['puts a choice to the party: most votes win, a tie is drawn', () => {
    const council = emptyCouncil(3);
    const options = [
      { label: 'Help', detail: '', enabled: true },
      { label: 'Rob', detail: '', enabled: false },
      { label: 'Leave', detail: '', enabled: true },
    ];
    openPoll(council, 7, 'A carter', 'Stuck in the mud.', options);
    assert(!say(council, 0, { op: 'vote', poll: 6, choice: 0 }).changed, 'an old poll is over');
    assert(!say(council, 0, { op: 'vote', poll: 7, choice: 1 }).changed, 'a closed option cannot be chosen');
    say(council, 0, { op: 'vote', poll: 7, choice: 0 });
    say(council, 1, { op: 'vote', poll: 7, choice: 2 });
    equal(pollOutcome(council, () => 0), null, 'one still to vote');
    say(council, 2, { op: 'vote', poll: 7, choice: 2 });
    equal(pollOutcome(council, () => 0), { choice: 2, tied: [2] }, 'two against one');
    say(council, 2, { op: 'vote', poll: 7, choice: 0 });
    equal(council.poll?.votes, [0, 2, 0], 'a vote can change until it is settled');
    council.poll!.result = { choice: 0, tied: [0] };
    assert(!say(council, 1, { op: 'vote', poll: 7, choice: 0 }).changed, 'no votes once it is settled');
    const two = emptyCouncil(2);
    openPoll(two, 1, 'Fork', '', options);
    say(two, 0, { op: 'vote', poll: 1, choice: 0 });
    say(two, 1, { op: 'vote', poll: 1, choice: 2 });
    equal([pollOutcome(two, () => 0), pollOutcome(two, () => 1)], [{ choice: 0, tied: [0, 2] }, { choice: 2, tied: [0, 2] }], 'a tie goes either way');
    equal(parseCouncil(JSON.parse(JSON.stringify(council)), 3)?.poll, council.poll, 'the poll survives the wire');
    equal(parseCouncilOp({ op: 'vote', poll: 7, choice: 99 }), null, 'no such option');
  }],

  ['camps: the joiners rest once everyone has answered', () => {
    const council = emptyCouncil(3);
    assert(say(council, 1, { op: 'camp', place: 'kerusai', at: { x: 3, y: 3 } }).note, 'the others hear of it');
    assert(!say(council, 2, { op: 'camp', place: 'kerusai', at: { x: 1, y: 1 } }).changed, 'one camp at a time');
    assert(!say(council, 1, { op: 'camp-answer', answer: 'refuse' }).changed, 'the one who sat down is resting');
    say(council, 0, { op: 'camp-answer', answer: 'join' });
    equal(campOutcome(council), null, 'one still to answer');
    say(council, 2, { op: 'camp-answer', answer: 'refuse' });
    equal(campOutcome(council), [0, 1], 'the two who rest');
    assert(!say(council, 0, { op: 'camp-cancel' }).changed, 'only the one who sat down calls it off');
    assert(say(council, 1, { op: 'camp-cancel' }).changed && !council.camp, 'called off');
  }],

  ['trades: a visitor joins, offers reset consent, and strangers cannot change the deal', () => {
    const council = emptyCouncil(3);
    const at = { x: 3, y: 4 };
    assert(say(council, 0, { op: 'trade', place: 'wilds', at }).changed, 'stall opens');
    assert(!say(council, 1, { op: 'trade', place: 'wilds', at }).changed, 'only one stall');
    assert(say(council, 1, { op: 'trade-join' }).changed, 'a visitor joins');
    assert(!say(council, 2, { op: 'trade-join' }).changed, 'a third player cannot join');
    say(council, 0, { op: 'trade-offer', items: ['oreIron', 'oreIron'] });
    say(council, 1, { op: 'trade-ready' });
    assert(!say(council, 2, { op: 'trade-offer', items: ['torch'] }).changed, 'a stranger cannot offer');
    say(council, 0, { op: 'trade-offer', items: ['oreIron'] });
    equal(council.trade?.ready, [false, false, false], 'editing an offer resets both confirmations');
    assert(!say(council, 2, { op: 'trade-cancel' }).changed, 'a stranger cannot cancel');
    equal(parseCouncil(JSON.parse(JSON.stringify(council)), 3)?.trade, council.trade, 'stall survives the wire');
    equal(parseCouncilOp({ op: 'trade', place: 'wilds', at }), { op: 'trade', place: 'wilds', at }, 'location parses');
    equal(parseCouncilOp({ op: 'trade-offer', items: ['constructor'] }), null, 'invalid item refused');
    say(council, 0, { op: 'trade-ready' });
    say(council, 1, { op: 'trade-ready' });
    assert(council.trade!.ready[0] && council.trade!.ready[1], 'both confirm');
    assert(say(council, 1, { op: 'trade-cancel' }).changed && !council.trade, 'visitor can leave');
  }],

  ['leaves only when everyone wants to, by the first one\'s way', () => {
    const council = emptyCouncil(2);
    say(council, 1, { op: 'leave', place: 'kerusai', exit: { x: 9, y: 0 } });
    equal(leaveOutcome(council), null, 'one still wants to stay');
    say(council, 0, { op: 'leave', place: 'kerusai', exit: { x: 0, y: 9 } });
    equal(leaveOutcome(council), { place: 'kerusai', exit: { x: 9, y: 0 } }, 'the first gate chosen');
    say(council, 1, { op: 'stay' });
    equal([leaveOutcome(council), council.leave?.first], [null, 0], 'a change of heart');
    say(council, 0, { op: 'stay' });
    equal(council.leave, null, 'nobody wants to go');
    say(council, 0, { op: 'leave', place: 'wilds', exit: null });
    say(council, 1, { op: 'leave', place: 'wilds', exit: null });
    equal(leaveOutcome(council), { place: 'wilds', exit: null }, 'back to the map');
  }],

  ['takes rooms with everyone or not at all', () => {
    const council = emptyCouncil(3);
    say(council, 2, { op: 'inn', shop: 'kerusai-guild' });
    say(council, 0, { op: 'inn-answer', answer: 'join' });
    equal(innOutcome(council), null, 'one to go');
    say(council, 1, { op: 'inn-answer', answer: 'join' });
    equal(innOutcome(council), 'kerusai-guild', 'all in');
    council.inn = null;
    say(council, 2, { op: 'inn', shop: 'kerusai-guild' });
    const refused = say(council, 0, { op: 'inn-answer', answer: 'refuse' });
    assert(refused.changed && refused.note && !council.inn, 'one refusal ends it');
  }],

  ['reads requests and councils off the wire defensively', () => {
    equal(parseCouncilOp({ op: 'route', dest: { x: 2, y: 3 } }), { op: 'route', dest: { x: 2, y: 3 } }, 'a route');
    equal(parseCouncilOp({ op: 'route', dest: { x: -2, y: 3 } }), null, 'off the map');
    equal(parseCouncilOp({ op: 'mode', mode: 'teleport' }), null, 'no such pace');
    equal(parseCouncilOp({ op: 'inn', shop: 'x'.repeat(200) }), null, 'long text');
    equal(parseCouncilOp({ op: 'stay' }), { op: 'stay' }, 'staying');
    equal(parseCouncilOp('camp'), null, 'not an object');
    assert(!say(emptyCouncil(2), 5, { op: 'stay' }).changed, 'no such seat');
    const council = emptyCouncil(2);
    say(council, 0, { op: 'route', dest: { x: 1, y: 1 } });
    say(council, 1, { op: 'camp', place: 'p', at: { x: 1, y: 1 } });
    equal(parseCouncil(JSON.parse(JSON.stringify(council)), 2), council, 'round trip');
    const forged = JSON.parse(JSON.stringify(council)) as Record<string, unknown>;
    (forged.camp as Record<string, unknown>).by = 7;
    equal(parseCouncil(forged, 2)?.camp, null, 'a camp by nobody is dropped');
  }],
];

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration council: ${tests.length} checks passed.`);
