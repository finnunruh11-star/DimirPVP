import { FIELD } from '../config/constants';
import { applyInvisibility, dash } from '../effects/effects';
import '../spells/sampleSpells';
import type { Spell } from '../spells/Spell';
import { getSpell } from '../spells/registry';
import type { WordId } from './Words';
import { GameState } from './GameState';
import { Mage } from './Mage';
import { dist } from './utils';

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
  ['scopes Mind Storm dice to a marked actor\'s action', async () => {
    const caster = mage('Caster', 1, 300, 270);
    const marked = mage('Marked', 2, 400, 270);
    const distant = mage('Distant', 2, 1000, 270);
    const game = new GameState([caster, marked, distant], 7);
    await cast(game, requireSpell(['mind', 'storm']), caster, null, marked.pos);
    assert(marked.statuses.some((status) => status.key === 'mind-storm-foreseen'), 'The target is marked');
    game.beginMindStormAction(distant);
    equal(game.rng.consistentSpec('1d20'), '1d20', 'Unmarked actions keep normal dice');
    game.endMindStormAction();
    game.beginMindStormAction(marked);
    equal(game.rng.consistentSpec('1d20'), '1d10+10', 'The marked action uses upper-half dice');
    game.endMindStormAction();
    equal(game.rng.consistentSpec('1d20'), '1d20', 'The next action uses normal dice again');
  }],

  ['carries summons with their owner and releases them onto free ground', async () => {
    const owner = mage('Owner', 1, 300, 270);
    const game = new GameState([owner, mage('Foe', 2, 600, 270)], 3);
    const first = game.spawnSummon(mage('First', 1, 330, 270), owner, 'ghost');
    const second = game.spawnSummon(mage('Second', 1, 340, 270), owner, 'ghost');
    const third = game.spawnSummon(mage('Third', 1, 350, 270), owner, 'ghost');
    assert(game.carrySummon(owner, first) && game.carrySummon(owner, second), 'Both shoulders accept nearby summons');
    equal([first.summonShoulder, second.summonShoulder], [0, 1], 'The summons use separate shoulders');
    equal(game.carrySummon(owner, third), false, 'A third summon cannot be carried');
    equal(game.canCommandSummon(owner, first), false, 'Carried summons cannot act');
    equal(game.isUntargetable(first), true, 'A carried summon cannot be singled out');
    owner.x = 450;
    game.syncCarriedSummons();
    equal(first.pos, owner.pos, 'A carried summon follows the owner');
    assert(game.releaseSummon(owner, first), 'The owner can set a summon down');
    assert(dist(first.pos, owner.pos) >= first.bodyRadius() + owner.bodyRadius(), 'The landing does not overlap its owner');
    equal(first.summonShoulder, undefined, 'The summon is back on the field');
  }],

  ['stops short dashes at contact and lets long dashes clear an enemy', async () => {
    const caster = mage('Caster', 1, 300, 270);
    const foe = mage('Foe', 2, 400, 270);
    const game = new GameState([caster, foe], 1);
    const short = game.clampDashToMages(caster, caster.pos, { x: 420, y: 270 });
    assert(Math.abs(short.x - (foe.x - caster.bodyRadius() - foe.bodyRadius())) < 0.2, 'A short dash stops at contact');
    const long = game.clampDashToMages(caster, caster.pos, { x: 460, y: 270 });
    equal(long, { x: 460, y: 270 }, 'A long dash passes through and clears the foe');
    assert(dist(long, foe.pos) >= caster.bodyRadius() + foe.bodyRadius(), 'The long dash lands clear');
    dash(game.effectContext(caster, caster, null), caster, { direction: { x: 1, y: 0 }, distance: 120 });
    assert(Math.abs(caster.x - short.x) < 0.2, 'The short dash lands before the foe');
    caster.x = 300;
    dash(game.effectContext(caster, caster, null), caster, { direction: { x: 1, y: 0 }, distance: 160 });
    equal(caster.x, 460, 'The long dash lands past the foe');
  }],

  ['keeps walking and lantern landings free without blocking allied passage', async () => {
    const walker = mage('Walker', 2, 300, 270);
    const ally = mage('Ally', 2, 390, 270);
    const foe = mage('Foe', 1, 700, 270);
    const game = new GameState([walker, ally, foe], 1);
    equal(game.makeMoveItem(walker, { x: 470, y: 270 }).targetPoint, { x: 470, y: 270 }, 'Allies are passable');
    const crowded = game.makeMoveItem(walker, ally.pos).targetPoint!;
    assert(dist(crowded, ally.pos) >= walker.bodyRadius() + ally.bodyRadius(), 'An ally cannot share the landing');
    const blocked = game.makeMoveItem(walker, foe.pos).targetPoint!;
    assert(dist(blocked, foe.pos) >= walker.bodyRadius() + foe.bodyRadius(), 'Enemies block the route');

    const bearer = mage('Bearer', 1, 400, 270);
    bearer.hands = ['edgelordLantern'];
    bearer.edgelordLanternActive = true;
    const first = mage('First', 2, 600, 270);
    const second = mage('Second', 2, 640, 270);
    const lantern = new GameState([bearer, first, second], 1);
    await lantern.shakeEdgelordLantern(bearer);
    assert(dist(first.pos, bearer.pos) >= first.bodyRadius() + bearer.bodyRadius(), 'The bearer stays free');
    assert(dist(second.pos, bearer.pos) >= second.bodyRadius() + bearer.bodyRadius(), 'The bearer stays free for every target');
    assert(dist(first.pos, second.pos) >= first.bodyRadius() + second.bodyRadius(), 'Pulled enemies do not overlap');
  }],

  ['lets a melee weapon hit an oversized enemy at its collision boundary', async () => {
    const striker = mage('Striker', 1, 300, 270);
    const defender = mage('Defender', 2, 400, 270);
    defender.intrinsicBodyRadius = 54;
    const game = new GameState([striker, defender], 1);
    equal(game.canMelee(striker, defender), true, 'The large body extends its melee hurtbox');
    defender.x = 405;
    equal(game.canMelee(striker, defender), false, 'The enlarged hurtbox still has a boundary');
  }],

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
    borderEnemy.intrinsicImmuneTypes.push('pierce', 'shatter', 'slashing', 'generic');
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