import { applyDebuff, applyStun } from '../effects/effects';
import { applyEnemyTraits } from '../pve/swamprun';
import { Dice } from './Dice';
import { analyzeDodge, dodgeGrantsBonusAction } from './Dodge';
import { GameState } from './GameState';
import { Mage } from './Mage';
import { getSpell } from '../spells/registry';
import '../spells/sampleSpells';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(actualJson === expectedJson, `${label}: expected ${expectedJson}, received ${actualJson}`);
}

const tests: [name: string, run: () => void | Promise<void>][] = [
  ['makes Specters immune to applied debuffs', () => {
    const caster = new Mage({
      name: 'Caster',
      isAI: false,
      team: 1,
      position: { x: 0, y: 0 },
      loadout: [],
    });
    const specter = new Mage({
      name: 'Enemy',
      isAI: true,
      team: 2,
      position: { x: 10, y: 0 },
      loadout: [],
    });
    applyEnemyTraits(specter, 'specter', new Dice(3));
    const game = new GameState([caster, specter], 7);

    applyDebuff(game.effectContext(caster, specter, null), specter, {
      name: 'Test Slow',
      duration: 2,
      mods: { moveRange: -2 },
    });

    equal(specter.debuffImmune, true, 'Specter debuff immunity');
    equal(specter.statuses, [], 'Rejected Specter debuff');
  }],

  ['maps every perfect dodge shape to a free bonus-action window', () => {
    const threeOfKind = analyzeDodge([4, 4, 4]);
    const twoPairs = analyzeDodge([1, 1, 5, 5]);
    const fourOfKind = analyzeDodge([2, 2, 2, 2]);
    const ordinaryPair = analyzeDodge([3, 3, 6]);

    equal(threeOfKind, 'triple', 'Three-of-a-kind tier');
    equal(twoPairs, 'triple', 'Two-pair tier');
    equal(fourOfKind, 'quad', 'Four-of-a-kind tier');
    equal(dodgeGrantsBonusAction(threeOfKind), true, 'Three-of-a-kind reward');
    equal(dodgeGrantsBonusAction(twoPairs), true, 'Two-pair reward');
    equal(dodgeGrantsBonusAction(fourOfKind), true, 'Four-of-a-kind reward');
    equal(dodgeGrantsBonusAction(ordinaryPair), false, 'Ordinary pair reward');
  }],

  ['forks lightning through fresh enemies, never the same body twice', async () => {
    const spell = getSpell(['lightning']);
    assert(spell, 'Expected Lightning to be registered.');
    const stout = (name: string, team: number, x: number): Mage => {
      const m = new Mage({ name, isAI: false, team, position: { x, y: 270 }, loadout: [] });
      m.maxHp = 500;
      m.hp = 500;
      m.maxSanity = 500;
      m.sanity = 500;
      return m;
    };
    let sawMultiBounce = false;

    for (let seed = 1; seed <= 120; seed++) {
      const caster = stout('Caster', 1, 200);
      const target = stout('Target', 2, 500);
      const others = [stout('A', 2, 560), stout('B', 2, 620), stout('C', 2, 680)];
      const game = new GameState([caster, target, ...others], seed);
      game.spellRollThisCast = 12;
      const forkedInto: number[] = [];
      game.vfxSink = {
        diceRoll: () => undefined,
        lightningBolt: async (_from, to) => {
          forkedInto.push(Math.round(to.x));
        },
      };

      await spell.cast(game.effectContext(caster, target, null));

      equal(forkedInto.length, new Set(forkedInto).size, `Seed ${seed} struck a body twice`);
      assert(!forkedInto.includes(200), `Seed ${seed} must never fork into its caster.`);
      assert(!forkedInto.includes(500), `Seed ${seed} must not fork back to the first target.`);
      if (forkedInto.length > 1) sawMultiBounce = true;
    }

    assert(sawMultiBounce, 'A high roll must fork through several enemies.');
  }],

  ['stops a declared action when its owner is bound before it resolves', () => {
    const caster = new Mage({
      name: 'Caster', isAI: false, team: 1, position: { x: 300, y: 270 }, loadout: [],
    });
    const foe = new Mage({
      name: 'Foe', isAI: false, team: 2, position: { x: 340, y: 270 }, loadout: [],
    });
    const game = new GameState([caster, foe], 5);
    const mainSpell = getSpell(['pierce']);
    const bonusSpell = getSpell(['veil']);
    assert(mainSpell && bonusSpell, 'Expected Pierce and Veil to be registered.');
    equal(mainSpell.actionType, 'main', 'Pierce is a main action');
    equal(bonusSpell.actionType, 'bonus', 'Veil is a bonus action');
    const move = game.makeMoveItem(caster, { x: 400, y: 270 });
    const swing = game.makeMeleeItem(caster, foe);
    const cast = game.makeSpellItem(caster, mainSpell, foe, null);
    const quick = game.makeSpellItem(caster, bonusSpell, caster, null);
    const ctx = game.effectContext(foe, caster, null);

    equal(game.stunPrevents(move), null, 'A free mage may move');
    equal(game.stunPrevents(cast), null, 'A free mage may cast');

    applyStun(ctx, caster, { duration: 2, type: 'movement' });
    equal(game.stunPrevents(move), 'rooted in place', 'A rooted mage cannot move');
    equal(game.stunPrevents(swing), null, 'Roots still allow a swing');
    equal(game.stunPrevents(cast), null, 'Roots still allow a cast');

    caster.statuses = [];
    applyStun(ctx, caster, { duration: 2, type: 'main' });
    equal(game.stunPrevents(cast), 'disarmed', 'A disarmed mage cannot cast a main spell');
    equal(game.stunPrevents(swing), 'disarmed', 'A disarmed mage cannot swing');
    equal(game.stunPrevents(quick), null, 'A disarmed mage may still take a bonus action');
    equal(game.stunPrevents(move), null, 'A disarmed mage may still move');

    caster.statuses = [];
    applyStun(ctx, caster, { duration: 2, type: 'full' });
    equal(game.stunPrevents(move), 'stunned', 'A stunned mage cannot move');
    equal(game.stunPrevents(cast), 'stunned', 'A stunned mage cannot cast');
    equal(game.stunPrevents(quick), 'stunned', 'A stunned mage cannot take bonus actions');
  }],
];

for (const [name, run] of tests) {
  await run();
  console.log(`PASS ${name}`);
}
console.log(`Combat rules: ${tests.length} checks passed.`);