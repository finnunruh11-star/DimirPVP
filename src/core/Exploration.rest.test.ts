import { bloodmoonDue } from '../pve/exploration/bloodmoon';
import { advanceHours } from '../pve/exploration/clock';
import { LONG_REST_HOURS, partyOf, rest, withParty } from '../pve/exploration/economy';
import { napHours, parseRestNap } from '../pve/exploration/nap';
import { capturePartySnapshot } from '../pve/exploration/party';
import { createRun } from '../pve/exploration/run';
import { takeShortRest } from '../pve/exploration/shortRest';
import {
  DREAMS, PANE, renderBubble, renderDream, renderRoom, renderSleeper, ROOM_H, ROOM_W, SLEEPER_FRAMES, type SleeperAnim,
} from '../visuals/rest/art';
import { Dice } from './Dice';
import { Mage } from './Mage';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}: expected ${e}, received ${a}`);
}

function freshRun(seed = 7, gold = 10) {
  const mage = new Mage({ name: 'Walker', isAI: false, team: 1, position: { x: 0, y: 0 }, loadout: [] });
  mage.assignFlatStats(3);
  const run = createRun(seed, capturePartySnapshot([mage]));
  run.gold = gold;
  return run;
}

const drawn = (canvas: { px: { data: Int32Array } }): number => canvas.px.data.reduce((sum, color) => sum + (color >= 0 ? 1 : 0), 0);

const tests: [name: string, run: () => void][] = [
  ['sleeps eight hours at the inn, whenever the night begins', () => {
    const run = freshRun();
    run.hour = 8;
    const morning = rest(run, 'capitol-guild');
    assert(morning.ok && morning.message.startsWith(`Slept ${LONG_REST_HOURS} hours`), morning.message);
    equal([run.day, run.hour], [1, 16], 'from eight in the morning to four in the afternoon');
    run.hour = 20;
    assert(rest(run, 'capitol-guild').ok, 'another night');
    equal([run.day, run.hour], [2, 4], 'from eight in the evening to four the next morning');
  }],

  ['wakes the party when the bloodmoon rises, with only the hours slept to show for it', () => {
    const run = freshRun();
    run.day = 4;
    run.hour = 20;
    withParty(run, (leader) => { leader.hp = 1; });
    const max = partyOf(run)[0].maxHp;
    const night = rest(run, 'capitol-guild');
    assert(night.ok && night.message.includes('bloodmoon'), night.message);
    equal([run.day, run.hour], [5, 0], 'stopped at the midnight it rose');
    assert(bloodmoonDue(run), 'and its fight is owed at once');
    equal(partyOf(run)[0].hp, Math.min(max, 1 + Math.ceil(max * 0.75 * (4 / LONG_REST_HOURS))), 'half a night of the 75%');
    const gold = run.gold;
    const again = rest(run, 'capitol-guild');
    assert(!again.ok && again.message.includes('bloodmoon'), 'nobody sleeps through a risen bloodmoon');
    equal(run.gold, gold, 'and nobody pays for trying');
  }],

  ['ends a short rest when the bloodmoon rises', () => {
    const run = freshRun();
    run.day = 4;
    run.hour = 23.5;
    const cut = takeShortRest(run, null, { safe: true }, new Dice(3));
    assert(cut.bloodmoon && !cut.ambush, 'the bloodmoon ends it');
    equal(cut.hours, 0.5, 'half an hour in');
    advanceHours(run, cut.hours);
    assert(bloodmoonDue(run), 'right on the midnight');
    const calm = freshRun();
    calm.day = 2;
    calm.hour = 12;
    const whole = takeShortRest(calm, null, { safe: true }, new Dice(3));
    assert(!whole.bloodmoon && whole.hours >= 1, 'a quiet afternoon rests in full');
  }],

  ['reads a night from the host as hostile input', () => {
    const nap = { from: { day: 4, hour: 20 }, to: { day: 5, hour: 0 }, bloodmoon: true, message: 'x'.repeat(400) };
    const read = parseRestNap(nap);
    assert(read && read.bloodmoon && read.message.length === 240, 'a good night, its message cut to size');
    equal(napHours(read), 4, 'four hours');
    assert(parseRestNap({ ...nap, to: { day: 4, hour: 19 } }) === null, 'no night that ends before it began');
    assert(parseRestNap({ ...nap, to: { day: 6, hour: 1 } }) === null, 'no night longer than a day');
    assert(parseRestNap({ ...nap, from: { day: 0.5, hour: 20 } }) === null && parseRestNap({ ...nap, to: { day: 5, hour: 24 } }) === null, 'no impossible times');
    assert(parseRestNap('night') === null && parseRestNap(null) === null, 'no nonsense');
  }],

  ['paints the inn room solid but for its window glass, and every frame of the sleeper and the dreams', () => {
    const room = renderRoom();
    let pane = 0;
    let holes = 0;
    for (let y = 0; y < ROOM_H; y++) for (let x = 0; x < ROOM_W; x++) {
      const glass = x >= PANE.x && x < PANE.x + PANE.w && y >= PANE.y && y < PANE.y + PANE.h;
      const bar = (x >= 37 && x <= 38) || (y >= 35 && y <= 36);
      const clear = room.px.get(x, y) < 0;
      if (glass && !bar && !clear) pane++;
      if (!glass && clear) holes++;
    }
    equal([pane, holes], [0, 0], 'the sky shows through the glass and nowhere else');
    for (const anim of ['sleep', 'wake', 'start'] as SleeperAnim[]) {
      for (let f = 0; f < SLEEPER_FRAMES[anim]; f++) assert(drawn(renderSleeper(anim, f)) > 300, `${anim} ${f} is drawn`);
    }
    for (const id of DREAMS) assert(drawn(renderDream(id)) > 40, `the ${id} dream is drawn`);
    assert(drawn(renderBubble()) > 1000, 'the dream cloud is drawn');
  }],
];

let failed = 0;
for (const [name, run] of tests) {
  try {
    run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}\n     ${(error as Error).message}`);
  }
}
if (failed) {
  console.error(`${failed} of ${tests.length} rest tests failed`);
  process.exit(1);
}
console.log(`All ${tests.length} rest tests passed.`);
