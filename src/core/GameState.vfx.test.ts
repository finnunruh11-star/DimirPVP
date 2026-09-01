import { dmg } from './Damage';
import { FIELD } from '../config/constants';
import { GameState } from './GameState';
import { Mage } from './Mage';
import { applyDot, applyStun, areaDamage, blinkstep, dealDamage, drainDamage, teleport } from '../effects/effects';
import type { VfxSink } from '../effects/effects';
import '../spells/sampleSpells';
import { getSpell } from '../spells/registry';
import type { WordId } from './Words';
import type { Vec2 } from './utils';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(actualJson === expectedJson, `${label}: expected ${expectedJson}, received ${actualJson}`);
}

function mage(name: string, team: number, x: number, y = 200): Mage {
  const result = new Mage({ name, isAI: false, team, position: { x, y }, loadout: [] });
  result.maxHp = 100;
  result.hp = 100;
  return result;
}

const tests: [name: string, run: () => Promise<void>][] = [
  ['routes corrosive and drain through their dedicated visuals', async () => {
    const caster = mage('Caster', 1, 100);
    const target = mage('Target', 2, 400);
    const game = new GameState([caster, target], 11);
    const effects: string[] = [];
    const drains: string[] = [];
    game.vfxSink = {
      diceRoll: () => undefined,
      spellEffect: (_mage, kind) => effects.push(kind),
      drainParticles: (from, to) => drains.push(`${from.x}->${to.x}`),
    } satisfies VfxSink;

    dealDamage(game.effectContext(caster, target, null), target, dmg(3, 'corrosive', 'physical'), {
      canMiss: false,
    });
    equal(effects, ['corrosive'], 'Corrosive impact');

    effects.length = 0;
    caster.hp = 50;
    drainDamage(game.effectContext(caster, target, null), target, dmg(4, 'shadow', 'physical'), {
      canMiss: false,
    });
    equal(effects, ['corrosive'], 'Drain impact');
    equal(drains, ['400->100'], 'Drain particle direction');
    equal(caster.hp, 54, 'Drain healing');
  }],

  ['uses the suction stream as the attack visual for immediate Drain spells', async () => {
    const immediateDrainCombos: WordId[][] = [
      ['drain'],
      ['drain', 'death'],
      ['corrode', 'drain'],
      ['corrode', 'shadow', 'drain'],
      ['corrode', 'drain', 'death'],
      ['shadow', 'drain'],
    ];
    for (const words of immediateDrainCombos) {
      const spell = getSpell(words);
      assert(spell, `Expected ${words.join('+')} to be registered.`);
      assert(spell.manualCastVisual, `${spell.name} must not play a default projectile or burst.`);
    }

    const delayedDrain = getSpell(['drain', 'curse']);
    assert(delayedDrain, 'Expected Drain Curse to be registered.');
    assert(!delayedDrain.manualCastVisual, 'Drain Curse must retain its totem-placement visual.');
  }],

  ['does not play an overlay for an ordinary DoT tick', async () => {
    const first = mage('First', 1, 100);
    const second = mage('Second', 2, 400);
    const game = new GameState([first, second], 13);
    const target = game.current;
    const source = target === first ? second : first;
    const effects: string[] = [];
    game.vfxSink = {
      diceRoll: () => undefined,
      spellEffect: (_mage, kind) => effects.push(kind),
    } satisfies VfxSink;
    applyDot(game.effectContext(source, target, null), target, {
      name: 'Test DoT',
      duration: 2,
      damage: dmg(3, 'shadow', 'physical'),
    });

    game.beginTurn();

    equal(effects, [], 'DoT overlays');
    equal(target.hp, 97, 'DoT damage');
  }],

  ['requests one smoke puff for every created minion', async () => {
    const caster = mage('Caster', 1, 100);
    const foe = mage('Foe', 2, 500);
    const game = new GameState([caster, foe], 17);
    const puffs: number[] = [];
    game.vfxSink = {
      diceRoll: () => undefined,
      summonPuff: (_at, size) => puffs.push(size),
    } satisfies VfxSink;
    const summon = mage('Summon', 1, 180);

    game.spawnSummon(summon, caster, 'test');
    game.addScarabs({ x: 240, y: 200 }, caster.team, 5, game.mages.indexOf(caster));

    equal(puffs.length, 6, 'Summon puff count');
    equal(puffs.filter((size) => size === 30).length, 5, 'Scarab puff count');
  }],

  ["sequences Reaper's Shard as outbound, impact, and return", async () => {
    const caster = mage('Caster', 1, 100);
    const target = mage('Target', 2, 400);
    const game = new GameState([caster, target], 19);
    const spell = getSpell(['shadow', 'drain', 'death']);
    assert(spell, "Expected Reaper's Shard to be registered.");
    assert(spell.manualCastVisual, "Reaper's Shard must suppress the generic projectile.");
    const events: string[] = [];
    game.vfxSink = {
      diceRoll: () => undefined,
      spellEffect: (_mage, kind) => events.push(kind),
      drainParticles: (from, to) => events.push(`drain:${from.x}->${to.x}`),
      boomerang: async (from, to) => {
        events.push(`boomerang:${from.x}->${to.x}`);
      },
    } satisfies VfxSink;
    const ctx = game.effectContext(caster, target, null);
    ctx.resolveImpacts = async () => {
      events.push('impacts');
    };

    await spell.cast(ctx);

    equal(
      events,
      ['boomerang:100->400', 'corrosive', 'drain:400->100', 'impacts', 'boomerang:400->100'],
      "Reaper's Shard visual order"
    );
  }],

  ['animates every Lightning Fire Pierce dash, trail hit, and self-crash', async () => {
    const spell = getSpell(['lightning', 'fire', 'pierce']);
    assert(spell, 'Expected Lightning Fire Pierce to be registered.');
    const origin = { x: FIELD.x + FIELD.w * 0.5, y: FIELD.y + FIELD.h * 0.5 };
    let seedsThatCrashed = 0;
    let seedsThatBurnedTheFoe = 0;

    for (let seed = 1; seed <= 40; seed++) {
      const caster = mage('Caster', 1, origin.x, origin.y);
      const foe = mage('Foe', 2, origin.x + 110, origin.y);
      const game = new GameState([caster, foe], seed);
      game.spellRollThisCast = 12;
      const dashes: { from: Vec2; to: Vec2 }[] = [];
      let trailUpdates = 0;
      let impacts = 0;
      let crashes = 0;
      let cleared = 0;
      game.vfxSink = {
        diceRoll: () => undefined,
        lightningTrail: () => { trailUpdates += 1; },
        lightningDash: async (from, to) => { dashes.push({ from: { ...from }, to: { ...to } }); },
        lightningImpact: () => { impacts += 1; },
        lightningCrash: async () => { crashes += 1; },
        clearLightningTrail: () => { cleared += 1; },
      } satisfies VfxSink;
      // Dash out once, then keep aiming back across the fresh trail.
      let step = 0;
      game.subTargeter = {
        requestPoint: async () => (step++ === 0
          ? { x: origin.x + 400, y: origin.y }
          : { x: origin.x - 400, y: origin.y }),
        requestEnemy: async () => null,
        requestCombatant: async () => null,
        reactionWindow: async () => undefined,
        resolveImpacts: async () => undefined,
      };

      await spell.cast(game.effectContext(caster, caster, null));

      const collapses = game.logLines.filter((line) => line.includes('collapses')).length;
      assert(dashes.length > 0, `Seed ${seed} must dash at least once.`);
      equal(dashes.length, trailUpdates, `Seed ${seed} dash streaks`);
      equal(cleared, 1, `Seed ${seed} trail cleanup`);
      equal(crashes, collapses, `Seed ${seed} crash feedback`);
      equal(dashes[dashes.length - 1].to, { x: caster.x, y: caster.y }, `Seed ${seed} landing point`);
      equal(impacts > 0, foe.hp < 100, `Seed ${seed} trail-hit feedback`);
      if (crashes > 0) seedsThatCrashed += 1;
      if (impacts > 0) seedsThatBurnedTheFoe += 1;
    }

    assert(seedsThatCrashed > 0, 'Some seed must collide with its own trail.');
    assert(seedsThatBurnedTheFoe > 0, 'Some seed must catch the foe in the trail.');
  }],

  ['phases a body out and back in for every teleport', async () => {
    const caster = mage('Caster', 1, 300);
    const foe = mage('Foe', 2, 700);
    const game = new GameState([caster, foe], 23);
    const events: string[] = [];
    game.vfxSink = {
      diceRoll: () => undefined,
      dash: () => events.push('slide'),
      blink: (from, to) => events.push(`${Math.round(from.x)}->${Math.round(to.x)}`),
    } satisfies VfxSink;

    blinkstep(game.effectContext(caster, foe, null), caster, {
      toPoint: { x: 500, y: 200 },
      distance: 200,
    });
    equal(events, ['300->500'], 'Blinkstep phases instead of sliding');

    events.length = 0;
    teleport(game.effectContext(caster, foe, null), caster, { x: 800, y: 200 });
    equal(events, ['500->800'], 'Shadow teleport phase');
  }],

  ['flashes every victim caught in an area effect', async () => {
    const caster = mage('Caster', 1, 300);
    const first = mage('A', 2, 500);
    const second = mage('B', 2, 520);
    const game = new GameState([caster, first, second], 41);
    const flashed: string[] = [];
    game.vfxSink = {
      diceRoll: () => undefined,
      spellEffect: (m) => flashed.push(m.name),
    } satisfies VfxSink;
    const at = { x: 510, y: 200 };

    areaDamage(game.effectContext(caster, null, at), at, 100, dmg(4, 'shatter', 'physical'), {
      canMiss: false,
    });

    equal(flashed.slice().sort(), ['A', 'B'], 'Area impact flashes');
  }],

  ['marks physical roots apart from terrain that merely holds you', async () => {
    const caster = mage('Caster', 1, 200);
    const foe = mage('Foe', 2, 400);
    const game = new GameState([caster, foe], 53);
    const ctx = game.effectContext(caster, foe, null);
    const rooted = () =>
      foe.statuses.find(
        (s) => s.kind === 'stun' && s.stunType === 'movement'
      ) as { physicalRoot?: boolean } | undefined;

    applyStun(ctx, foe, { duration: 2, type: 'movement' });
    equal(rooted()?.physicalRoot, true, 'A movement stun is a physical root');

    foe.statuses = [];
    applyStun(ctx, foe, { duration: 2, type: 'full' });
    applyStun(ctx, foe, { duration: 2, type: 'main' });
    equal(rooted()?.physicalRoot, undefined, 'Full and main stuns never root');
  }],
];

for (const [name, run] of tests) {
  await run();
  console.log(`PASS ${name}`);
}
console.log(`Spell VFX: ${tests.length} checks passed.`);