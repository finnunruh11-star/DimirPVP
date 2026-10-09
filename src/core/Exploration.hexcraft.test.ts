import { RANGE_UNIT } from '../config/constants';
import { activateHexzettel, hexUnits } from '../effects/hexzettel';
import { dealDamage } from '../effects/effects';
import { dmg } from './Damage';
import { capturePartySnapshot } from '../pve/exploration/party';
import { buyItem, drawHex, partyOf, runeOffers, shopStock, withParty } from '../pve/exploration/economy';
import { applyIntent, parseIntent } from '../pve/exploration/intents';
import { createRun, type ExplorationRun } from '../pve/exploration/run';
import { parseRun } from '../pve/exploration/save';
import { shopById } from '../pve/exploration/shops';
import { itemIconKind } from '../visuals/itemIcons';
import { Dice } from './Dice';
import { GameState } from './GameState';
import { hexItemId, isBoughtHex, parseHexItemId } from './hexcraft/item';
import { randomHexSheet, RUNE_HINTS, setHexLore } from './hexcraft/lore';
import {
  BRIDGE_BIT,
  couplingMode,
  ECHO_LIMIT,
  FACETS,
  FULL_GRID,
  hexAction,
  hexManaCost,
  hexPotency,
  partLabel,
  readHex,
  RUNE_LINES,
  RUNE_ORDER,
  RUNES,
  SEAL_BIT,
  strokeEdges,
  unitPlan,
  type PaperKind,
  type RuneId,
} from './hexcraft/runes';
import { asItemIds, getItem, isItemId, type ItemId } from './Items';
import { Mage } from './Mage';
import type { MageClass } from './Classes';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}: expected ${e}, received ${a}`);
}

/** A grid with `rune` drawn on it, its seal struck and/or a chain run to the next grid. */
function glyph(rune: RuneId, ...marks: ('seal' | 'bridge')[]): number {
  return RUNES[rune].masks[0] | (marks.includes('seal') ? SEAL_BIT : 0) | (marks.includes('bridge') ? BRIDGE_BIT : 0);
}

/** Only Allies, sealed. */
const ENEMIES = glyph('allies', 'seal');

/** A sheet with these grids drawn in order, the rest left blank. */
function sheet(paper: PaperKind, ...grids: (RuneId | number)[]): number[] {
  const masks = Array.from({ length: paper === 'fine' ? 5 : 3 }, () => 0);
  grids.forEach((grid, index) => { masks[index] = typeof grid === 'number' ? grid : glyph(grid); });
  return masks;
}

const hex = (...grids: (RuneId | number)[]): ItemId => {
  const paper: PaperKind = grids.length > 3 ? 'fine' : 'plain';
  return hexItemId(paper, sheet(paper, ...grids));
};

function unit(name: string, team: number, x: number, y = 270): Mage {
  const m = new Mage({ name, isAI: team !== 1, team, position: { x, y }, loadout: [] });
  m.maxHp = 300;
  m.hp = 300;
  m.mana = 20;
  return m;
}

function traveller(name: string, mageClass: MageClass): Mage {
  const m = new Mage({ name, isAI: false, team: 1, position: { x: 200, y: 200 }, loadout: ['shadow', 'mind', 'pierce', 'subtle'], mageClass });
  m.assignFlatStats(3);
  m.statStrength = 30;
  return m;
}

/** A Hexcraft scribe with two sheets of paper and a smith, both with mana to spare. */
function scribeRun(seed = 31): ExplorationRun {
  const run = createRun(seed, capturePartySnapshot([traveller('Scribe', 'hexcraft'), traveller('Smith', 'objects')]));
  withParty(run, (_leader, party) => {
    for (const mage of party) {
      mage.utility.push('paper', 'paper');
      mage.mana = 20;
    }
  });
  run.gold = 10;
  return run;
}

/** Loose `id` from `user`'s belt with mana refilled, and insist that it lands. */
function loose(game: GameState, user: Mage, id: ItemId, target: Mage | null, point: { x: number; y: number } | null = null): void {
  user.mana = 20;
  user.utility.push(id);
  assert(activateHexzettel(game, user, id, { target, point }), `${getItem(id).name} loosed`);
}

function startTurn(game: GameState, m: Mage): void {
  game.currentIndex = game.mages.indexOf(m);
  game.beginTurn();
}

const tests: [name: string, run: () => void | Promise<void>][] = [
  ['every rune is its own drawing, turns into one of its own kind, and strokes join only neighbouring pegs', () => {
    const seen = new Map<number, RuneId>();
    for (const id of RUNE_ORDER) {
      for (const mask of RUNES[id].masks) {
        assert(!seen.has(mask), `${id} is drawn like ${seen.get(mask)}`);
        seen.set(mask, id);
      }
      const inverse = RUNES[id].inverse;
      equal(FACETS[inverse].kind, FACETS[id].kind, `${id} inverts to ${inverse}, a rune of the same kind`);
    }
    equal(RUNE_ORDER.length, 29, 'twenty-one effects, five targets and three modifiers');
    equal(strokeEdges(0, 2)?.length, 2, 'a stroke across a row lays two lines');
    equal(strokeEdges(0, 8)?.length, 2, 'a stroke corner to corner lays two lines');
    equal(strokeEdges(0, 5), null, "a knight's move is no stroke");
    equal(strokeEdges(4, 4), null, 'nor is a dot');
  }],

  ['reads a sheet: one target per part, and Accelerate or Slow modify when an effect follows; whatever does not hold is skipped', () => {
    const area = readHex('plain', sheet('plain', 'aoe', 'dot', 'corrosive'));
    assert(area.recipe, `AoE + DoT + Corrosive reads: ${area.problem}`);
    equal(area.recipe.parts, [{ target: 'aoe', effects: ['dot', 'corrosive'], modifiers: [] }], 'an area of lingering corrosion');
    equal(area.recipe.lines, 4 + 2 + 3, 'one mana a line to draw');
    equal(hexManaCost(area.recipe), 5, 'and 5 to loose');
    equal(readHex('plain', sheet('plain', 'aoe', 'single', 'heal')).recipe?.parts[0].target, 'aoe', 'only the first target counts');
    equal(readHex('plain', sheet('plain', 'aoe', 'bigger')).recipe?.parts[0].effects, [], 'without an effect it fizzles');
    const stray = readHex('plain', [1, 0, 0]);
    equal([stray.problem, stray.recipe?.parts, stray.recipe?.lines], [null, [{ target: 'touch', effects: [], modifiers: [] }], 1], 'stray lines are skipped, and still paid');
    equal(readHex('plain', [1, glyph('heal'), 0]).recipe?.parts[0].effects, ['heal'], 'a scribble beside a rune leaves the rune');
    equal(readHex('plain', sheet('plain', 'heal', 'allies', ENEMIES)).recipe?.parts[0].modifiers, [], 'Only Allies and Only Enemies cancel each other out');
    assert(readHex('plain', sheet('fine', 'heal')).problem, 'plain paper has three grids');
    equal(readHex('plain', sheet('plain', 'heal')).recipe?.parts[0].target, 'touch', 'without a target rune it touches one unit');

    const quick = readHex('plain', sheet('plain', 'accelerate', 'corrosive', 'single')).recipe!;
    equal([quick.parts[0].effects, quick.parts[0].modifiers, hexAction(quick)], [['corrosive'], ['accelerate'], 'bonus'], 'Accelerate before an effect quickens the hex');
    equal(hexPotency(quick), 1.05, 'and weakens it (1.5 x 0.7)');
    const haste = readHex('plain', sheet('plain', 'single', 'corrosive', 'accelerate')).recipe!;
    equal([haste.parts[0].effects, hexAction(haste)], [['corrosive', 'accelerate'], 'main'], 'Accelerate last is an effect of its own');
    const heavy = readHex('plain', sheet('plain', glyph('accelerate', 'seal'), 'explosion', 'single')).recipe!;
    equal([hexAction(heavy), hexPotency(heavy)], ['full', 2.1], 'Slow before an effect takes the whole turn and hits harder');
  }],

  ['a struck seal turns the rune inside out, and costs a stroke', () => {
    const reading = readHex('plain', [glyph('single'), glyph('wind', 'seal'), 0]);
    assert(reading.recipe, `reads: ${reading.problem}`);
    equal(reading.grids[1], { lines: 5, rune: 'wind', inverted: true, coupled: false, facet: 'cyclone', part: 0, role: 'effect' }, 'Wind sealed is Cyclone');
    equal(reading.recipe.parts[0].effects, ['cyclone'], 'and the hex pulls');
    equal(readHex('plain', [glyph('heal', 'seal'), 0, 0]).recipe?.parts[0].effects, ['blight'], 'Healing sealed is Blight');
    equal(readHex('plain', [glyph('single', 'seal'), glyph('heal'), 0]).recipe?.parts[0].target, 'self', 'Single Target sealed is Self');
    equal(readHex('plain', [glyph('bigger', 'seal'), glyph('heal'), 0]).recipe?.parts[0].modifiers, ['smaller'], 'Bigger sealed is Smaller');
    equal(readHex('plain', [glyph('environment', 'seal'), glyph('heal'), 0]).recipe?.parts[0].target, 'aura', 'Environment sealed is an Aura');
    const blank = readHex('plain', [SEAL_BIT, glyph('heal'), 0]);
    equal([blank.grids[0].inverted, blank.recipe?.parts[0].effects], [false, ['heal']], 'a seal over no rune is skipped');
  }],

  ['a chain couples the next part to the effect before it', () => {
    const reading = readHex('plain', [glyph('missile', 'bridge'), glyph('wind'), glyph('aoe')]);
    assert(reading.recipe, `reads: ${reading.problem}`);
    equal(reading.recipe.parts, [
      { target: 'touch', effects: ['missile'], modifiers: [], carrier: 'missile' },
      { target: 'aoe', effects: ['wind'], modifiers: [] },
    ], 'a missile that sets off a gust around what it strikes');
    equal(reading.grids.map((grid) => grid.part), [0, 1, 1], 'the chain starts a new part');
    equal([reading.recipe.lines, hexManaCost(reading.recipe)], [4 + 1 + 4 + 4, 3 + 2 + 2], 'the chain is a stroke; every part is paid to loose');
    equal(couplingMode(reading.recipe.parts[0]), 'impact', 'it fires where the missile lands');
    equal(couplingMode(readHex('plain', [glyph('dot'), glyph('corrosive', 'bridge'), glyph('wind')]).recipe!.parts[0]), 'tick', 'a lingering carrier fires each tick');
    equal(couplingMode(readHex('fine', sheet('fine', 'environment', 'dot', glyph('corrosive', 'bridge'), 'wind')).recipe!.parts[0]), 'ground', 'ground fires each bite');
    const dangling = readHex('plain', [glyph('single'), glyph('heal'), glyph('missile', 'bridge')]);
    equal([dangling.recipe?.parts.length, dangling.grids[2].coupled], [1, false], 'a chain into nothing is skipped');
    equal(readHex('plain', [glyph('single', 'bridge'), glyph('heal'), 0]).recipe?.parts, [{ target: 'single', effects: ['heal'], modifiers: [] }], 'only effects carry');
    equal(readHex('plain', [glyph('missile', 'bridge'), glyph('aoe'), 0]).recipe?.parts, [{ target: 'aoe', effects: ['missile'], modifiers: [] }], 'a chain into no effect is skipped');
    const targeted = readHex('fine', sheet('fine', 'single', glyph('missile', 'bridge'), 'aoe', 'wind')).recipe;
    equal(targeted?.parts.map((part) => part.target), ['single', 'aoe'], 'each part takes its own target');
    const quick = readHex('plain', [glyph('accelerate'), glyph('missile', 'bridge'), glyph('wind')]).recipe!;
    equal([quick.parts[0].modifiers, hexAction(quick)], [['accelerate'], 'bonus'], 'a pace rune modifies only its own part');
  }],

  ['a Hexzettel is its own id, seals and chains included, and any sheet with lines reads', () => {
    const id = hex('aoe', 'dot', 'corrosive');
    assert(isItemId(id), 'a drawn id is an item id');
    const def = getItem(id);
    equal([def.slot, def.name], ['utility', 'Hexzettel: Over Time + Corrosion (Area)'], 'a belt item named for its runes');
    equal(parseHexItemId(id)?.parts[0].effects, ['dot', 'corrosive'], 'read back');
    equal(itemIconKind(def), 'paper', 'it looks like a sheet');
    equal(itemIconKind(getItem('finePaper')), 'paper', 'and so does blank paper');
    const chained = hex(glyph('missile', 'bridge'), glyph('wind', 'seal'), 'aoe');
    assert(isItemId(chained), 'a sealed, chained sheet is an item id');
    equal(getItem(chained).name, 'Hexzettel: Magic Missile \u00bb Cyclone (Area)', 'named part by part');
    equal(parseHexItemId(chained)?.parts.map((part) => part.effects), [['missile'], ['cyclone']], 'and read back');
    for (const bad of [
      'hex:p:1',
      'hex:x:1.2.3',
      'hex:p:0.0.0',
      `hex:p:${RUNES.heal.masks[0].toString(36)}.0`,
      `hex:p:0${RUNES.heal.masks[0].toString(36)}.0.0`,
      'hex:p:zzzzz.0.0',
      `hex:p:${(FULL_GRID + 1).toString(36)}.0.0`,
    ]) assert(!isItemId(bad), `${bad} is no item`);
    assert(isItemId('hex:p:1.0.0'), 'a scribble is a sheet too');
    assert(isItemId(`hex:p:${glyph('heal', 'bridge').toString(36)}.0.0`), 'and so is a chain into nothing');
    equal(asItemIds([id, 'hex:p:0.0.0']), [id], 'only the sound id passes');
  }],

  ['the scriptorium sells paper for a silver and fine paper for a gold; the guild no longer does', () => {
    const run = scribeRun();
    const guild = shopById('capitol-scriptorium')!;
    const stock = shopStock(run, guild);
    const price = (id: ItemId): number | undefined => stock.find((slot) => slot.id === id)?.price;
    equal([price('paper'), price('finePaper')], [0.1, 1], 'guild prices');
    const fine = stock.find((slot) => slot.id === 'finePaper')!;
    assert(buyItem(run, guild.id, fine.key).ok, 'fine paper bought');
    equal(run.gold, 9, 'for a gold');
    assert(partyOf(run)[0].utility.includes('finePaper'), 'it goes on the belt');
  }],

  ['only a Hexcraft mage draws, one mana a stroke, and the sheet becomes the Hexzettel', () => {
    const run = scribeRun();
    const grids = sheet('plain', 'aoe', 'dot', 'corrosive');
    equal(drawHex(run, 'paper', grids, 'objects').message, 'Only a Hexcraft mage can draw a hex.', 'the smith cannot');
    equal(drawHex(run, 'finePaper', sheet('fine', 'heal'), 'hexcraft').message, 'No Fine Paper to draw on.', 'only on paper carried');
    equal(drawHex(run, 'paper', [0, 0, 0], 'hexcraft').message, 'Nothing is drawn.', 'only a sheet with lines');
    const result = drawHex(run, 'paper', grids, 'hexcraft');
    assert(result.ok && result.item, `drawn: ${result.message}`);
    const scribe = partyOf(run)[0];
    equal([scribe.mana, scribe.utility.filter((id) => id === 'paper').length], [11, 1], 'nine mana and a sheet spent');
    assert(scribe.utility.includes(result.item), 'the Hexzettel is on the belt');
    withParty(run, (_leader, party) => { party[0].mana = 20; });
    const chained = drawHex(run, 'paper', [glyph('missile', 'bridge'), glyph('wind', 'seal'), glyph('aoe')], 'hexcraft');
    assert(chained.ok, `a chained sheet drawn: ${chained.message}`);
    equal(partyOf(run)[0].mana, 20 - 14, 'seal and chain are a stroke each');
    withParty(run, (_leader, party) => { party[0].mana = 3; party[0].utility.push('paper'); });
    equal(drawHex(run, 'paper', grids, 'hexcraft').message, 'Needs 9 mana.', 'the lines must be paid');
    withParty(run, (_leader, party) => { party[0].hp = 0; party[0].mana = 20; });
    equal(drawHex(run, 'paper', grids, 'hexcraft').message, 'Scribe has fallen.', 'the fallen do not draw');
  }],

  ['a drawing travels the wire as an intent', () => {
    const intent = { op: 'hex', paper: 'paper', grids: [glyph('missile', 'bridge'), glyph('wind', 'seal'), glyph('aoe')] };
    equal(parseIntent(intent), intent, 'a sound drawing, seal and chain included');
    for (const bad of [
      { ...intent, paper: 'nonsense' },
      { ...intent, grids: [] },
      { ...intent, grids: [1, 2, 3, 4, 5, 6] },
      { ...intent, grids: [1.5, 0, 0] },
      { ...intent, grids: [-1, 0, 0] },
      { ...intent, grids: [FULL_GRID + 1, 0, 0] },
      { ...intent, grids: 'abc' },
    ]) equal(parseIntent(bad), null, JSON.stringify(bad));
    const run = scribeRun();
    const result = applyIntent(run, 'hexcraft', parseIntent(intent)!);
    assert(result.ok && result.item && isItemId(result.item), `drawn over the wire: ${result.message}`);
  }],

  ['looses AoE + DoT + Corrosive: corrosion on everything in the circle, paid in mana', () => {
    const hexer = unit('Hexer', 1, 200);
    const a = unit('A', 2, 400);
    const b = unit('B', 2, 440);
    const far = unit('Far', 2, 900);
    const game = new GameState([hexer, a, b, far], 3);
    const id = hex('aoe', 'dot', 'corrosive');
    hexer.utility.push(id);
    assert(!activateHexzettel(game, hexer, id, { target: null, point: { x: 900, y: 270 } }), 'out of reach');
    assert(hexer.utility.includes(id) && hexer.mana === 20, 'nothing spent on a miss');
    assert(activateHexzettel(game, hexer, id, { target: null, point: { x: 420, y: 270 } }), 'loosed');
    const rotting = (m: Mage): boolean => m.statuses.some((s) => s.kind === 'dot' && s.key === 'dot:hex:Hexed Rot');
    equal([rotting(a), rotting(b), rotting(far), rotting(hexer)], [true, true, false, false], 'the circle rots');
    equal([hexer.mana, hexer.utility.includes(id)], [15, false], 'five mana and the sheet spent');
    const before = a.hp;
    startTurn(game, a);
    assert(a.hp < before, 'and it ticks at the turn start');
  }],

  ['heals one ally harder, finds the nearest foes, and keeps to one side when told', () => {
    const hexer = unit('Hexer', 1, 200);
    const ally = unit('Ally', 1, 300);
    const foes = [unit('F1', 2, 380), unit('F2', 2, 420), unit('F3', 2, 460), unit('F4', 2, 500)];
    const game = new GameState([hexer, ally, ...foes], 4);
    ally.hp = 200;
    loose(game, hexer, hex('single', 'heal'), ally);
    assert(ally.hp >= 203 && ally.hp <= 212, `2d4 x1.5 healed (${ally.hp - 200})`);

    const volley = hex('multi', 'corrosive');
    equal(hexUnits(game, hexer, parseHexItemId(volley)!, { target: null, point: null }).map((m) => m.name), ['F1', 'F2', 'F3'], 'the three nearest foes');

    for (const m of game.mages) m.hp = 250;
    loose(game, hexer, hex('battlefield', 'heal', 'allies'), null);
    assert(hexer.hp > 250 && ally.hp > 250, 'your side is mended');
    assert(foes.every((foe) => foe.hp === 250), 'theirs is not');
  }],

  ['blasts, darts, shoves, twists, wards and hastens', () => {
    const hexer = unit('Hexer', 1, 200);
    const foe = unit('Foe', 2, 400);
    const near = unit('Near', 2, 460);
    const ally = unit('Ally', 1, 100);
    const game = new GameState([hexer, foe, near, ally], 5);
    loose(game, hexer, hex('single', 'explosion'), foe);
    assert(foe.hp < 300 && near.hp < 300 && hexer.hp === 300, 'the blast splashes the one beside, not you');
    near.x = 900;
    near.y = 450;
    foe.hp = 300;
    loose(game, hexer, hex('single', 'missile'), foe);
    assert(300 - foe.hp >= 6, 'three darts of 1d4+1');
    loose(game, hexer, hex('single', 'wind'), foe);
    assert(foe.x > 600, `shoved 5cm away (${foe.x})`);
    foe.x = 400;
    foe.y = 270;
    const before = { ...foe.pos };
    loose(game, hexer, hex('single', 'twist'), foe);
    assert(Math.hypot(foe.x - before.x, foe.y - before.y) > RANGE_UNIT, 'turned around you');
    assert(Math.abs(Math.hypot(foe.x - hexer.x, foe.y - hexer.y) - 200) < RANGE_UNIT, 'at the same distance');
    loose(game, hexer, hex('single', 'barrier'), ally);
    assert(ally.statuses.some((s) => s.key === 'debuff:hex-ward'), 'the ally is warded');
    const pace = ally.moveRange();
    loose(game, hexer, hex('single', 'heal', 'accelerate'), ally);
    assert(ally.moveRange() > pace, 'and hastened');
  }],

  ['inverted runes: Cyclone drags, Blight festers, Siphon drinks, Implosion crushes inward, Burst reaps', () => {
    const hexer = unit('Hexer', 1, 200);
    const foe = unit('Foe', 2, 500);
    const other = unit('Other', 2, 600);
    const game = new GameState([hexer, foe, other], 9);
    loose(game, hexer, hex('single', glyph('wind', 'seal')), foe);
    assert(foe.x < 300, `dragged toward you (${foe.x})`);
    foe.x = 500;

    loose(game, hexer, hex('aoe', glyph('heal', 'seal')), null, { x: 500, y: 270 });
    assert(foe.hp < 300 && foe.statuses.some((s) => s.key === 'debuff:hex-blight'), 'blighted: hurt, and nothing heals it');
    assert(hexer.hp === 300, 'the circle was far from you');

    hexer.hp = 250;
    loose(game, hexer, hex('single', glyph('missile', 'seal')), foe);
    assert(hexer.hp > 250, `the siphons heal you (${hexer.hp - 250})`);

    const spread = other.x;
    loose(game, hexer, hex('single', glyph('explosion', 'seal')), foe);
    assert(other.x < spread, `the one beside is dragged in (${spread} -> ${other.x})`);

    foe.hp = 300;
    loose(game, hexer, hex('single', 'dot', 'corrosive'), foe);
    assert(foe.statuses.some((s) => s.kind === 'dot'), 'a rot set');
    const rotten = foe.hp;
    loose(game, hexer, hex('single', glyph('dot', 'seal')), foe);
    assert(!foe.statuses.some((s) => s.kind === 'dot') && foe.hp < rotten, 'Burst lands the rot at once and spends it');
  }],

  ['the missile carries a gust: everyone around the impact is shoved out', () => {
    const hexer = unit('Hexer', 1, 200);
    const foe = unit('Foe', 2, 500);
    const beyond = unit('Beyond', 2, 580);
    const before = unit('Before', 2, 430);
    const game = new GameState([hexer, foe, beyond, before], 10);
    loose(game, hexer, hex(glyph('missile', 'bridge'), 'wind', 'aoe'), foe);
    assert(foe.hp < 300, 'the darts strike');
    assert(beyond.x > 580 && before.x < 430, `the gust bursts out of the impact (${before.x}, ${beyond.x})`);
    assert(foe.x > 500, 'the one struck is blown away from you');
    equal(hexer.pos, { x: 200, y: 270 }, 'you were far from it');
  }],

  [`an impact coupling fires ${ECHO_LIMIT} times at most`, () => {
    const hexer = unit('Hexer', 1, 200);
    const foes = [0, 1, 2, 3, 4].map((i) => unit(`F${i}`, 2, 500 + i * 80));
    const game = new GameState([hexer, ...foes], 11);
    loose(game, hexer, hex('battlefield', ENEMIES, glyph('missile', 'bridge'), glyph('regen', 'seal')), null);
    equal(foes.filter((foe) => foe.maxHp < 300).length, ECHO_LIMIT, 'only three are withered');
    equal(hexer.maxHp, 300, 'and never you');
  }],

  ['a coupling on a lingering wound fires each time it ticks', () => {
    const hexer = unit('Hexer', 1, 200);
    const foe = unit('Foe', 2, 500);
    const game = new GameState([hexer, foe], 12);
    loose(game, hexer, hex('dot', glyph('corrosive', 'bridge'), 'wind'), foe);
    equal(foe.x, 500, 'nothing fires on the cast');
    const rot = foe.statuses.find((s) => s.key === 'dot:hex:Hexed Rot');
    assert(rot?.kind === 'dot' && rot.hexEcho, 'the rot carries the coupling');
    startTurn(game, foe);
    assert(foe.x > 600, `the tick sets off the gust (${foe.x})`);
  }],

  ['coupled ground fires on whoever it bites', () => {
    const hexer = unit('Hexer', 1, 200);
    const foe = unit('Foe', 2, 500);
    const game = new GameState([hexer, foe], 13);
    loose(game, hexer, hex('environment', 'dot', glyph('corrosive', 'bridge'), glyph('regen', 'seal')), null, { x: 500, y: 270 });
    equal(foe.maxHp, 300, 'nothing withers yet');
    startTurn(game, foe);
    assert(foe.hp < 300 && foe.maxHp < 300, 'the ground bites and the coupled Wither follows');
  }],

  ['regeneration heals as each turn begins', () => {
    const hexer = unit('Hexer', 1, 200);
    const ally = unit('Ally', 1, 300);
    const game = new GameState([hexer, ally, unit('Foe', 2, 900)], 6);
    ally.hp = 200;
    loose(game, hexer, hex('single', 'regen'), ally);
    startTurn(game, ally);
    assert(ally.hp > 200, 'it heals at the turn start');
  }],

  ['an aura rides on its bearer', () => {
    const hexer = unit('Hexer', 1, 200);
    const bearer = unit('Bearer', 1, 400);
    const foe = unit('Foe', 2, 640);
    const game = new GameState([hexer, bearer, foe], 14);
    loose(game, hexer, hex(glyph('environment', 'seal'), ENEMIES, 'dot', 'corrosive'), bearer);
    const aura = game.hazardZones[game.hazardZones.length - 1];
    equal([aura.x, aura.carrierIndex], [400, game.mages.indexOf(bearer)], 'laid on the bearer');
    game.forceMove(hexer, bearer, { x: 590, y: 270 });
    equal(aura.x, bearer.x, 'and it follows');
    startTurn(game, bearer);
    equal(bearer.hp, 300, 'it spares its own side');
    startTurn(game, foe);
    assert(foe.hp < 300, 'and bites the foe it was carried to');
  }],

  ['on the ground: lingering corrosion, a wall, and what Corrosion and Light clear away', () => {
    const hexer = unit('Hexer', 1, 200);
    const foe = unit('Foe', 2, 400);
    const friend = unit('Friend', 1, 420, 300);
    const game = new GameState([hexer, foe, friend], 7);
    loose(game, hexer, hex('environment', 'dot', 'corrosive', ENEMIES), null, { x: 410, y: 280 });
    const ground = game.hazardZones[game.hazardZones.length - 1];
    equal(ground.hex?.hits, [{ spec: '1d6', type: 'corrosive' }], 'the ground itself corrodes');
    for (const m of [foe, friend]) startTurn(game, m);
    equal([foe.hp < 300, friend.hp], [true, 300], 'only foes that start a turn on it');

    game.addBarrier({ x: 480, y: 380 }, 0, { shape: 'rect', range: 90, thickness: 10, owner: 2, ttl: 5 });
    game.droppedItems.push({ id: 900, itemId: 'torch', x: 490, y: 380, owner: 2 });
    loose(game, hexer, hex('environment', 'corrosive'), null, { x: 480, y: 380 });
    equal([game.barriers.length, game.droppedItems.length], [0, 0], 'corrosion melts the wall and the dropped torch');
    loose(game, hexer, hex('environment', 'barrier'), null, { x: 500, y: 200 });
    equal(game.barriers.length, 1, 'a Barrier on the ground is a wall');
    game.shadows.push({ id: 901, x: 300, y: 150, radius: 40, owner: 2, ttl: 3 });
    loose(game, hexer, hex('environment', 'light'), null, { x: 300, y: 150 });
    equal(game.shadows.length, 0, 'light burns the shadow off');
  }],

  ['will not wake without the mana', () => {
    const hexer = unit('Hexer', 1, 200);
    const foe = unit('Foe', 2, 300);
    const game = new GameState([hexer, foe], 8);
    const id = hex('single', 'explosion');
    hexer.utility.push(id);
    hexer.mana = 1;
    assert(!activateHexzettel(game, hexer, id, { target: foe, point: null }), 'not enough mana');
    assert(hexer.utility.includes(id) && foe.hp === 300, 'nothing happens');
  }],

  ['a sheet with no effect fizzles, and its mana is spent', () => {
    const hexer = unit('Hexer', 1, 200);
    const foe = unit('Foe', 2, 300);
    const game = new GameState([hexer, foe], 15);
    const scribble = hexItemId('plain', [1, 0, 0]);
    loose(game, hexer, scribble, foe);
    equal([foe.hp, hexer.mana, hexer.utility.includes(scribble)], [300, 19, false], 'nothing lands; one mana and the sheet spent');
  }],

  ['a sheet is named and described only once the party knows every rune on it', () => {
    const id = hex('single', 'missile');
    try {
      setHexLore([]);
      assert(/^Hexzettel [A-Z]{3}$/.test(getItem(id).name), `unread: ${getItem(id).name}`);
      assert(!getItem(id).blurb.includes('dart'), 'and undescribed');
      equal(getItem(id).name, getItem(id).name, 'the same sheet keeps its mark');
      assert(getItem(hex('single', 'heal')).name !== getItem(id).name, 'another sheet bears another mark');
      setHexLore(['single']);
      assert(getItem(id).name.startsWith('Hexzettel '), 'one rune of two is not enough');
      setHexLore(['single', 'missile']);
      equal(getItem(id).name, 'Hexzettel: Magic Missile (Single Target)', 'named once both are known');
      assert(getItem(id).blurb.includes('dart'), 'and described');
      assert(getItem(hexItemId('plain', [glyph('single'), glyph('missile'), 1])).name.startsWith('Hexzettel '), 'stray lines keep it unread');
    } finally {
      setHexLore(null);
    }
  }],

  ['a scriptorium sells ready-drawn sheets: plain, one to three runes, said what they do, a new one after each sale', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const grids = randomHexSheet(new Dice(seed));
      const runes = grids.filter((mask) => mask & RUNE_LINES).length;
      assert(grids.length === 3 && runes >= 1 && runes <= 3, `seed ${seed}: three grids, one to three runes`);
      assert(readHex('plain', grids).recipe!.parts[0].effects.length > 0, `seed ${seed}: it does something`);
    }
    const run = scribeRun();
    run.gold = 10;
    const shop = shopById('kerusai-scriptorium')!;
    const sheet = () => shopStock(run, shop).find((slot) => slot.key.startsWith('hexsheet:'))!;
    const first = sheet();
    try {
      setHexLore([]);
      equal([first.price, parseHexItemId(first.id)?.paper, isBoughtHex(first.id)], [2, 'plain', true], 'two gold, plain paper, bought');
      assert(getItem(first.id).name.startsWith("Scribe's Hexzettel "), `unnamed: ${getItem(first.id).name}`);
      assert(getItem(first.id).blurb.includes('mana') && !getItem(first.id).blurb.includes('Unread Hexzettel'), 'but described');
      assert(buyItem(run, shop.id, first.key).ok, 'bought');
      equal(run.gold, 8, 'for two gold');
      assert(partyOf(run)[0].utility.includes(first.id), 'it goes on the belt, ready to loose');
      assert(sheet().key !== first.key, 'another is drawn');
      equal(buyItem(run, shop.id, first.key).message, 'Not in stock.', 'the sold one is gone');
      assert(!shopStock(run, shopById('capitol-guild')!).some((slot) => slot.id === 'paper'), 'the guild sells no paper');
    } finally {
      setHexLore(null);
    }
  }],

  ['opposites are one rune: sealed, Only Allies is Only Enemies, Increase Range is Decrease Range, Accelerate is Slow', () => {
    equal(readHex('plain', [ENEMIES, glyph('heal'), 0]).recipe?.parts[0].modifiers, ['enemies'], 'Only Enemies');
    equal(readHex('plain', [glyph('rangeUp', 'seal'), glyph('heal'), 0]).recipe?.parts[0].modifiers, ['rangeDown'], 'Decrease Range');
    equal(readHex('plain', [glyph('heal'), glyph('accelerate', 'seal'), 0]).recipe?.parts[0].effects, ['heal', 'slow'], 'Slow');
    equal(readHex('plain', [glyph('light', 'seal'), 0, 0]).recipe?.parts[0].effects, ['shadow'], 'Light sealed is Shadow');
  }],

  ['the first element names every blow, a form carries it, and every element rides along', () => {
    const part = (...grids: (RuneId | number)[]) => readHex('plain', sheet('plain', ...grids)).recipe!.parts[0];
    const darts = unitPlan(part('fire', 'missile'));
    equal(darts.filter((step) => step.k === 'hit').length, 0, 'the darts carry the fire: no strike of its own');
    equal(darts.find((step) => step.k === 'missiles')?.type, 'heat', 'fire darts');
    assert(darts.some((step) => step.k === 'rider' && step.rider === 'burn'), 'that set it burning');
    equal(partLabel(part('fire', 'missile')), 'Fire Magic Missile', 'named as one');
    equal(unitPlan(part(glyph('fire', 'seal'), 'explosion')).find((step) => step.k === 'explosion')?.type, 'cold', 'a frost blast');
    const alone = unitPlan(part('shatter'));
    equal(alone.map((step) => [step.k, 'type' in step ? step.type : null]), [['hit', 'shatter'], ['rider', null]], 'alone an element strikes, then rides');
    const both = unitPlan(part('water', 'fire', 'lance'));
    equal(both.find((step) => step.k === 'lance')?.type, 'water', 'the first element drawn names the beam');
    equal(both.filter((step) => step.k === 'rider').map((step) => step.k === 'rider' && step.rider), ['tide', 'burn'], 'both ride along');
    const lingering = unitPlan(part('dot', 'fire')).find((step) => step.k === 'dot');
    equal(lingering?.k === 'dot' && [lingering.name, lingering.type], ['Hex Burn', 'heat'], 'Over Time makes the fire linger');
    equal(unitPlan(part('dot', 'missile', glyph('edge', 'seal'))).find((step) => step.k === 'dot')?.type, 'typeless', 'and bleeds in the part element beside a form');
  }],

  ['a lance burns through everyone on its line; a ricochet bounces on', () => {
    const hexer = unit('Hexer', 1, 200);
    const a = unit('A', 2, 300);
    const b = unit('B', 2, 400);
    const far = unit('Far', 2, 700);
    const game = new GameState([hexer, a, b, far], 21);
    loose(game, hexer, hex('lance'), b);
    equal([a.hp < 300, b.hp < 300, far.hp], [true, true, 300], 'the beam passes through A on its way to B');
    for (const m of game.mages) m.hp = 300;
    loose(game, hexer, hex(glyph('lance', 'seal')), a);
    equal([a.hp < 300, b.hp < 300, far.hp, hexer.hp], [true, true, 300, 300], 'the bolt bounces from A to B, and no farther');
  }],

  ['blink, swap, mana, silence and might', () => {
    const hexer = unit('Hexer', 1, 200);
    const foe = unit('Foe', 2, 400);
    const ally = unit('Ally', 1, 200, 400);
    const game = new GameState([hexer, foe, ally], 23);
    loose(game, hexer, hex('blink'), foe);
    assert(foe.x > 500, `blinked away (${foe.x})`);
    foe.x = 400;
    loose(game, hexer, hex(glyph('blink', 'seal')), foe);
    equal([Math.round(hexer.x), Math.round(foe.x)], [400, 200], 'traded places');
    foe.mana = 10;
    loose(game, hexer, hex(glyph('infuse', 'seal')), foe);
    assert(foe.mana < 10, 'mana burned');
    loose(game, hexer, hex(glyph('mark', 'seal')), foe);
    assert(foe.statuses.some((s) => s.kind === 'stifle'), 'silenced');
    loose(game, hexer, hex('might'), ally);
    assert(ally.statuses.some((s) => s.kind === 'debuff' && (s.mods.damageDealt ?? 0) > 0), 'empowered');
  }],

  ['a coupled haste fires wherever its bearer ends a move', async () => {
    const hexer = unit('Hexer', 1, 200);
    const ally = unit('Ally', 1, 300);
    const foe = unit('Foe', 2, 550);
    const game = new GameState([hexer, ally, foe], 22);
    loose(game, hexer, hex(glyph('accelerate', 'bridge'), glyph('aoe', 'seal'), 'explosion'), ally);
    equal(foe.hp, 300, 'nothing goes off yet');
    const haste = ally.statuses.find((s) => s.key === 'debuff:hex-haste');
    assert(haste?.kind === 'debuff' && haste.hexEcho?.on === 'move', 'the haste carries the coupling');
    game.currentIndex = game.mages.indexOf(ally);
    await game.makeMoveItem(ally, { x: 450, y: 270 }).resolve(game);
    assert(foe.hp < 300 && hexer.hp === 300, 'the blast goes off around it where it stops');
  }],

  ['a coupled mark fires once, when it is struck', () => {
    const hexer = unit('Hexer', 1, 200);
    const foe = unit('Foe', 2, 300);
    const game = new GameState([hexer, foe], 24);
    loose(game, hexer, hex(glyph('mark', 'bridge'), 'shatter'), foe);
    equal(foe.hp, 300, 'marking deals nothing');
    dealDamage(game.effectContext(hexer, foe, null), foe, dmg(1, 'typeless'), { canMiss: false });
    assert(!foe.statuses.some((s) => s.key === 'debuff:hex-mark'), 'the mark is spent');
    assert(300 - foe.hp >= 4, `1, 2 more for the mark, and the coupled shatter (${300 - foe.hp})`);
    const after = foe.hp;
    dealDamage(game.effectContext(hexer, foe, null), foe, dmg(1, 'typeless'), { canMiss: false });
    equal(after - foe.hp, 1, 'and only once');
  }],

  ['with a Hex Codex a scriptorium offers three runes a day by feel, each five silver dearer', () => {
    const run = scribeRun();
    run.gold = 10;
    const shop = shopById('capitol-scriptorium')!;
    const learn = (rune: RuneId) => applyIntent(run, 'hexcraft', parseIntent({ op: 'hex-rune', shop: shop.id, rune })!);
    try {
      const offers = runeOffers(run, shop);
      equal(offers.length, 3, 'three runes');
      assert(offers.every((offer) => offer.hint === RUNE_HINTS[offer.rune] && !offer.hint.includes(FACETS[offer.rune].label)), 'by feel, not by name');
      equal(learn(offers[0].rune).message, 'The scribe sells runes only to a party with a Hex Codex.', 'the codex comes first');
      const codex = shopStock(run, shop).find((slot) => slot.id === 'hexCodex')!;
      assert(buyItem(run, shop.id, codex.key).ok, 'the codex bought');
      equal(run.gold, 8.5, 'for one and a half gold');
      assert(learn(offers[0].rune).ok, 'a rune learned');
      equal([run.hexLore.runes, run.gold], [[offers[0].rune], 8], 'for five silver');
      const after = runeOffers(run, shop);
      equal([after.map((offer) => offer.rune), after.map((offer) => offer.sold)], [offers.map((offer) => offer.rune), [true, false, false]], "the day's offers stay put");
      assert(learn(offers[1].rune).ok, 'a second');
      equal(run.gold, 7, 'for ten silver');
      equal(learn(offers[0].rune).message, 'Already learned.', 'once');
      equal(learn(RUNE_ORDER.find((rune) => !offers.some((offer) => offer.rune === rune))!).message, 'That rune is not on offer today.', 'only what is offered');
      equal(parseIntent({ op: 'hex-rune', shop: shop.id, rune: 'nonsense' }), null, 'only runes there are');
      run.day += 1;
      assert(runeOffers(run, shop).every((offer) => !offer.sold && !run.hexLore.runes.includes(offer.rune)), 'a new day, runes not yet known');
      equal(parseRun(JSON.stringify(run))?.hexLore, run.hexLore, 'the lore is saved');
    } finally {
      setHexLore(null);
    }
  }],
];

for (const [name, run] of tests) {
  await run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration hexcraft: ${tests.length} checks passed.`);
