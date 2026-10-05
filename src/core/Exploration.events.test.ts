import { Dice } from '../core/Dice';
import type { ItemId } from '../core/Items';
import { Mage } from '../core/Mage';
import { partyOf, withParty } from '../pve/exploration/economy';
import { hasMonsters, livesIn, type EncounterZone } from '../pve/exploration/encounters';
import { fill, stage, type EventScene } from '../pve/exploration/eventKit';
import { pickEvent, pickSightedEvent, ROAD_EVENTS, variantsFor } from '../pve/exploration/events';
import { capturePartySnapshot } from '../pve/exploration/party';
import { createRun, type ExplorationRun } from '../pve/exploration/run';
import { restThought, type ThoughtContext } from '../pve/exploration/thoughts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}: expected ${e}, received ${a}`);
}

const ZONES: EncounterZone[] = ['capitol', 'black', 'red', 'forest', 'wilds', 'lake', 'white'];
/** What the choice windows can show without clipping (see ChoiceMenuView, CabinetButton, SightingCard). */
const FITS = { title: 24, text: 180, sightedText: 130, label: 30, detail: 64, choices: 4 };
const PACK: ItemId[] = ['healthPotion', 'healthPotion', 'crudeTrinket', 'herbMoonglow', 'herbMoonglow', 'herbMoonglow', 'gemAmethyst'];

/** Two travellers with a full purse and one of everything an event may ask for. */
function richRun(seed: number): ExplorationRun {
  const party = [0, 1].map((i) => {
    const mage = new Mage({ name: `Walker ${i}`, isAI: false, team: 1, position: { x: 0, y: 0 }, loadout: [] });
    mage.assignFlatStats(3);
    return mage;
  });
  const run = createRun(seed, capturePartySnapshot(party));
  run.gold = 20;
  withParty(run, (leader) => {
    for (const id of PACK) (id === 'healthPotion' ? leader.utility : leader.bag).push(id);
  });
  return run;
}

const loose = (text: string): boolean => /[{}]/.test(text);

/** Every staged scene of every event, across the zones it fits and a spread of seeds. */
function* scenes(seeds = 8): Generator<{ zone: EncounterZone; scene: EventScene; sighted: boolean }> {
  for (const event of ROAD_EVENTS) {
    for (const zone of event.zones ?? ZONES) {
      const variants = variantsFor(event, zone);
      for (let v = 0; v < variants.length; v++) {
        for (let seed = 1; seed <= seeds; seed++) {
          yield { zone, scene: stage(event, variants[v], new Dice(seed * 97 + v)), sighted: !!event.sighted };
        }
      }
    }
  }
}

const tests: [name: string, run: () => void][] = [
  ['fills its words from the cast, the same pick wherever it repeats', () => {
    const cast: Record<string, string> = {};
    const line = fill('A {who:carter|miller} and the {who}, {once|twice}.', cast, new Dice(4));
    const who = cast.who;
    assert(who === 'carter' || who === 'miller', `cast a part (${who})`);
    assert(line.startsWith(`A ${who} and the ${who}, `), `the same pick repeats: "${line}"`);
    equal(fill('The {who} again.', cast, new Dice(9)), `The ${who} again.`, 'later lines use the same cast');
    equal(fill('No {one} here.', {}, new Dice(1)), 'No {one} here.', 'an unknown part is left for the tests to catch');
  }],

  ['has many events, each with several variants, and plenty for every zone by day and by night', () => {
    const ids = ROAD_EVENTS.map((event) => event.id);
    equal(new Set(ids).size, ids.length, 'ids are unique');
    assert(ROAD_EVENTS.length >= 40, `a full roster of events (${ROAD_EVENTS.length})`);
    for (const event of ROAD_EVENTS) assert(event.variants.length >= 4, `${event.id} has ${event.variants.length} variants`);
    for (const zone of ZONES) {
      for (const night of [false, true]) {
        const fits = ROAD_EVENTS.filter((event) => variantsFor(event, zone, night).length > 0);
        const variants = fits.reduce((sum, event) => sum + variantsFor(event, zone, night).length, 0);
        const sighted = fits.filter((event) => event.sighted).length;
        assert(fits.length >= 18, `${zone} ${night ? 'night' : 'day'}: ${fits.length} events`);
        assert(variants >= 60, `${zone} ${night ? 'night' : 'day'}: ${variants} variants`);
        assert(sighted >= 6, `${zone} ${night ? 'night' : 'day'}: ${sighted} events to sight`);
        for (const event of fits) {
          for (const variant of variantsFor(event, zone, night)) {
            assert(!variant.when || (variant.when === 'night') === night, `${event.id}: only its own hour`);
          }
        }
      }
    }
  }],

  ['stages every variant with its words filled in, sized to fit its windows', () => {
    let staged = 0;
    for (const { zone, scene, sighted } of scenes()) {
      staged += 1;
      const at = `${scene.id} in ${zone}: "${scene.text}"`;
      assert(!loose(scene.title) && !loose(scene.text), `${at} has loose words`);
      assert(scene.title === scene.title.toUpperCase() && scene.title.length <= FITS.title, `${at}: title "${scene.title}"`);
      assert(scene.text.length <= (sighted ? FITS.sightedText : FITS.text), `${at}: ${scene.text.length} characters`);
      assert(scene.choices.length >= 1 && scene.choices.length <= FITS.choices, `${at}: ${scene.choices.length} choices`);
      for (const choice of scene.choices) {
        assert(!loose(choice.label) && !loose(choice.detail), `${at}: loose words in "${choice.label}" / "${choice.detail}"`);
        assert(choice.label.length <= FITS.label, `${at}: label "${choice.label}"`);
        assert(choice.detail.length <= FITS.detail, `${at}: detail "${choice.detail}" is ${choice.detail.length}`);
      }
    }
    assert(staged > 1000, `staged plenty (${staged})`);
  }],

  ['resolves every choice everywhere: no coin, no training, no deaths, no debt, no loose words', () => {
    for (const { zone, scene } of scenes(4)) {
      scene.choices.forEach((choice, index) => {
        for (let seed = 1; seed <= 3; seed++) {
          const run = richRun(seed);
          const ctx = { run, zone, depth: seed * 3, dice: new Dice(seed * 131 + index) };
          const at = `${scene.id}/${choice.label} in ${zone}`;
          assert(!choice.available || choice.available(ctx), `${at} opens for a well-stocked party`);
          const outcome = choice.resolve(ctx);
          assert(outcome.message.length > 0 && !loose(outcome.message), `${at}: "${outcome.message}"`);
          assert(run.gold <= 20 && run.gold >= 0, `${at}: purse ${run.gold}`);
          equal([run.xp, run.pendingLevels], [0, 0], `${at} teaches nothing`);
          for (const mage of partyOf(run)) assert(mage.hp >= 1 && mage.sanity >= 1, `${at} never kills (${mage.hp} HP, ${mage.sanity} sanity)`);
          const fight = outcome.fight;
          if (fight) {
            assert(fight.depth >= 1 && fight.depth <= 10, `${at}: depth ${fight.depth}`);
            assert(!fight.label || !loose(fight.label), `${at}: "${fight.label}"`);
            assert(!fight.spawns || fight.spawns.length > 0, `${at}: somebody to fight`);
            for (const spawn of fight.spawns ?? []) {
              const kind = spawn.family === 'swamp' ? spawn.kind : spawn.spec.kind;
              assert(livesIn(kind, zone), `${at}: ${kind} does not live in ${zone}`);
            }
            assert(fight.spawns || fight.encounter === 'robbery' || hasMonsters(zone), `${at}: calls out monsters where none live`);
          }
        }
      });
    }
  }],

  ['never brings a creature outside its home: no undead outside the swamps, no monsters where none live', () => {
    let fights = 0;
    for (const { zone, scene } of scenes(2)) {
      scene.choices.forEach((choice, index) => {
        for (let seed = 1; seed <= 24; seed++) {
          const ctx = { run: richRun(seed), zone, depth: 1 + (seed % 10), dice: new Dice(seed * 7919 + index) };
          const fight = choice.resolve(ctx).fight;
          if (!fight) continue;
          fights += 1;
          const at = `${scene.id}/${choice.label} in ${zone}`;
          for (const spawn of fight.spawns ?? []) {
            const kind = spawn.family === 'swamp' ? spawn.kind : spawn.spec.kind;
            assert(livesIn(kind, zone), `${at}: ${kind} does not live in ${zone}`);
            assert(spawn.family !== 'swamp' || zone === 'black', `${at}: ${kind} out of the swamps`);
          }
          assert(fight.spawns || fight.encounter === 'robbery' || hasMonsters(zone), `${at}: calls out monsters where none live`);
        }
      });
    }
    assert(fights > 200, `plenty of event fights checked (${fights})`);
  }],

  ['keeps paid choices shut to an empty purse, and gifts shut to empty hands', () => {
    let gated = 0;
    for (const { zone, scene } of scenes(1)) {
      for (const choice of scene.choices) {
        if (!choice.available) continue;
        gated += 1;
        const run = createRun(5, capturePartySnapshot([new Mage({ name: 'Broke', isAI: false, team: 1, position: { x: 0, y: 0 }, loadout: [] })]));
        run.gold = 0;
        assert(!choice.available({ run, zone, depth: 2, dice: new Dice(1) }), `${scene.id}/${choice.label} asks for something a broke party lacks`);
      }
    }
    assert(gated > 20, `plenty of choices ask for coin or kit (${gated})`);
  }],

  ['picks the same scene from the same dice, fitting the zone, the hour and the road', () => {
    for (const zone of ZONES) {
      for (let seed = 0; seed < 60; seed++) {
        const night = seed % 2 === 1;
        const a = pickEvent(zone, new Dice(seed), night);
        const b = pickEvent(zone, new Dice(seed), night);
        equal([a.id, a.title, a.text], [b.id, b.title, b.text], `${zone} seed ${seed}: the same scene`);
        const event = ROAD_EVENTS.find((candidate) => candidate.id === a.id)!;
        assert(variantsFor(event, zone, night).length > 0, `${zone} seed ${seed}: ${a.id} fits`);
        const sighted = pickSightedEvent(zone, new Dice(seed), night);
        assert(sighted && ROAD_EVENTS.find((candidate) => candidate.id === sighted.id)?.sighted, `${zone} seed ${seed}: a sighted event`);
      }
    }
    const seen = new Set<string>();
    for (let seed = 0; seed < 400; seed++) seen.add(pickEvent('capitol', new Dice(seed), false).id);
    assert(seen.size >= 15, `the capitol road varies (${seen.size} kinds of event)`);
  }],

  ['thinks something on a quiet stop, worries first', () => {
    const base: ThoughtContext = { zone: 'forest', terrain: 'forest', night: false, storm: false, health: 1, bloodmoonIn: 100, mode: 'sprint' };
    const low = (): number => 0;
    const moon = restThought({ ...base, bloodmoonIn: 6 }, low);
    equal(restThought({ ...base, bloodmoonIn: 6, health: 0.2 }, low), moon, 'the bloodmoon weighs before wounds');
    assert(restThought({ ...base, health: 0.2 }, low) !== restThought(base, low), 'wounds change the thought');
    const rolls = new Dice(3);
    for (const zone of ['capitol', 'forest', 'red', 'black', 'lake', 'white'] as const) {
      for (const terrain of ['road', 'plains', 'forest', 'hills', 'swamp', 'ford', 'dunes', 'bridge'] as const) {
        for (const night of [false, true]) {
          const thought = restThought({ ...base, zone, terrain, night, storm: zone === 'white', health: rolls.float(), bloodmoonIn: rolls.die(48) }, () => rolls.float());
          assert(typeof thought === 'string', `"${thought}" is a thought`);
        }
      }
    }
  }],
];

for (const [name, run] of tests) {
  run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration events: ${tests.length} checks passed.`);
