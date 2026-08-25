import { FIELD } from '../config/constants';
import { applyInvisibility } from '../effects/effects';
import '../spells/sampleSpells';
import type { Spell } from '../spells/Spell';
import { getSpell } from '../spells/registry';
import type { WordId } from './Words';
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

function mage(name: string, team: number, x: number, y: number): Mage {
  const result = new Mage({ name, isAI: false, team, position: { x, y }, loadout: [] });
  result.maxHp = 50;
  result.hp = 50;
  result.maxSanity = 50;
  result.sanity = 50;
  return result;
}

function requireSpell(words: WordId[]): Spell {
  const spell = getSpell(words);
  assert(spell, `Expected registered spell for ${words.join('+')}.`);
  return spell;
}

async function cast(
  game: GameState,
  spell: Spell,
  caster: Mage,
  target: Mage | null,
  point: { x: number; y: number } | null,
  point2: { x: number; y: number } | null = null
): Promise<void> {
  await spell.cast(game.effectContext(caster, target, point, point2));
}

const tests: [name: string, run: () => Promise<void>][] = [
  ['damages every enemy inside the authored Reality Shatter wedge', async () => {
    const pivot = { x: FIELD.x + FIELD.w / 2, y: FIELD.y + FIELD.h / 2 };
    const caster = mage('Caster', 1, pivot.x, pivot.y);
    const insideA = mage('Inside A', 2, pivot.x + 180, pivot.y);
    const insideB = mage('Inside B', 2, pivot.x + 170, pivot.y + 45);
    const outside = mage('Outside', 2, pivot.x, pivot.y - 180);
    const ally = mage('Ally', 1, pivot.x + 120, pivot.y + 10);
    const game = new GameState([caster, insideA, insideB, outside, ally], 31);
    const spell = requireSpell(['reality', 'shatter']);
    const edgeA = { x: pivot.x + 200, y: pivot.y - 100 };
    const edgeB = { x: pivot.x + 200, y: pivot.y + 100 };

    await cast(game, spell, caster, null, edgeA, edgeB);

    const damageA = 50 - insideA.hp;
    const damageB = 50 - insideB.hp;
    assert(damageA >= 2 && damageA <= 12, 'The first enemy inside the wedge must take 2d6 damage.');
    equal(damageB, damageA, 'Shared Reality Shatter cone roll');
    equal(outside.hp, 50, 'Enemy outside the wedge');
    equal(ally.hp, 50, 'Ally inside the wedge');
    equal(game.barriers.length, 1, 'Placed Reality wedge');
  }],

  ['grants the selected Shatter Mind target a turn and damages every enemy', async () => {
    const caster = mage('Caster', 1, 200, 200);
    const selected = mage('Selected Ally', 1, 260, 200);
    const enemyA = mage('Enemy A', 2, 500, 200);
    const enemyB = mage('Veiled Enemy', 2, 700, 200);
    const game = new GameState([caster, selected, enemyA, enemyB], 37);
    const spell = requireSpell(['shatter', 'mind', 'reality']);
    applyInvisibility(game.effectContext(enemyB, enemyB, null), enemyB, {
      duration: 2,
      mode: 'full',
    });

    assert(game.isValidSpellTarget(spell, caster, selected), 'An ally must be a legal selected target.');
    await cast(game, spell, caster, selected, null);

    assert(game.takeExtraTurn() === selected, 'The selected target must receive the queued extra turn.');
    const damageA = 50 - enemyA.sanity;
    const damageB = 50 - enemyB.sanity;
    assert(damageA >= 3 && damageA <= 9, 'Every enemy must take 3d3 mental damage.');
    equal(damageB, damageA, 'Veiled enemy global damage');
    equal(caster.sanity, 50, 'Caster mental damage');
    equal(selected.sanity, 50, 'Selected ally mental damage');
  }],

  ['damages only enemies that Twist into a wall or battlefield border', async () => {
    const pivot = { x: FIELD.x + FIELD.w / 2, y: FIELD.y + FIELD.h / 2 };
    const caster = mage('Caster', 1, pivot.x, pivot.y);
    const borderEnemy = mage('Border Enemy', 2, FIELD.x + 20, pivot.y);
    const wallEnemy = mage('Wall Enemy', 2, pivot.x + 150, pivot.y);
    const safeEnemy = mage('Safe Enemy', 2, pivot.x + 60, pivot.y);
    const borderAlly = mage('Border Ally', 1, FIELD.x + 40, pivot.y);
    borderEnemy.physicalImmune = true;
    wallEnemy.intrinsicImmuneTypes.push('shatter', 'generic');
    const game = new GameState([caster, borderEnemy, wallEnemy, safeEnemy, borderAlly], 41);
    game.addBarrier(
      { x: pivot.x + 106, y: pivot.y - 106 },
      0,
      { shape: 'rect', range: 100, thickness: 100, owner: caster.team, ttl: 3 }
    );
    assert(
      game.quarterTurnDestination(borderEnemy.pos, pivot, true).wallSlam,
      'Border fixture must collide with the battlefield edge.'
    );
    assert(
      game.quarterTurnDestination(wallEnemy.pos, pivot, true).wallSlam,
      'Wall fixture must collide with the placed barrier.'
    );
    assert(
      !game.quarterTurnDestination(safeEnemy.pos, pivot, true).wallSlam,
      'Safe fixture must complete its quarter turn.'
    );
    const spell = requireSpell(['twist', 'reality']);

    await cast(game, spell, caster, null, { x: pivot.x + 10, y: pivot.y });

    const borderDamage = 50 - borderEnemy.hp;
    const wallDamage = 50 - wallEnemy.hp;
    assert(borderDamage >= 2 && borderDamage <= 12, 'Border collision must deal 2d6 damage.');
    assert(wallDamage >= 2 && wallDamage <= 12, 'Wall collision must deal 2d6 damage.');
    equal(safeEnemy.hp, 50, 'Enemy completing the rotation');
    equal(borderAlly.hp, 50, 'Ally colliding with the border');
  }],
];

for (const [name, run] of tests) {
  await run();
  console.log(`PASS ${name}`);
}
console.log(`Reality spells: ${tests.length} checks passed.`);