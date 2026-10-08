import { RANGE_UNIT } from '../config/constants';
import { activateHexzettel, hexUnits } from '../effects/hexzettel';
import { capturePartySnapshot } from '../pve/exploration/party';
import { buyItem, drawHex, partyOf, shopStock, withParty } from '../pve/exploration/economy';
import { applyIntent, parseIntent } from '../pve/exploration/intents';
import { createRun, type ExplorationRun } from '../pve/exploration/run';
import { shopById } from '../pve/exploration/shops';
import { itemIconKind } from '../visuals/itemIcons';
import { GameState } from './GameState';
import { hexItemId, parseHexItemId } from './hexcraft/item';
import {
  BRIDGE_BIT,
  couplingMode,
  ECHO_LIMIT,
  FACETS,
  FULL_GRID,
  hexAction,
  hexManaCost,
  hexPotency,
  readHex,
  RUNE_ORDER,
  RUNES,
  SEAL_BIT,
  strokeEdges,
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
    equal(RUNE_ORDER.length, 23, 'twelve effects, five targets and six modifiers');
    equal(strokeEdges(0, 2)?.length, 2, 'a stroke across a row lays two lines');
    equal(strokeEdges(0, 8)?.length, 2, 'a stroke corner to corner lays two lines');
    equal(strokeEdges(0, 5), null, "a knight's move is no stroke");
    equal(strokeEdges(4, 4), null, 'nor is a dot');
  }],

  ['reads a sheet: one target per part, at least one effect, and Accelerate or Slow modify when an effect follows', () => {
    const area = readHex('plain', sheet('plain', 'aoe', 'dot', 'corrosive'));
    assert(area.recipe, `AoE + DoT + Corrosive reads: ${area.problem}`);
    equal(area.recipe.parts, [{ target: 'aoe', effects: ['dot', 'corrosive'], modifiers: [] }], 'an area of lingering corrosion');
    equal(area.recipe.lines, 4 + 2 + 3, 'one mana a line to draw');
    equal(hexManaCost(area.recipe), 5, 'and 5 to loose');
    equal(readHex('plain', sheet('plain', 'aoe', 'single', 'heal')).problem, 'The hex has more than one target rune.', 'one target only');
    equal(readHex('plain', sheet('plain', 'aoe', 'bigger')).problem, 'The hex needs an effect rune.', 'an effect is needed');
    equal(readHex('plain', [1, 0, 0]).problem, 'Grid 1 holds no rune.', 'stray lines read as nothing');
    equal(readHex('plain', sheet('plain', 'heal', 'allies', 'enemies')).problem, 'The hex: Only Allies and Only Enemies cancel each other out.', 'no side and both');
    assert(readHex('plain', sheet('fine', 'heal')).problem, 'plain paper has three grids');
    equal(readHex('plain', sheet('plain', 'heal')).recipe?.parts[0].target, 'touch', 'without a target rune it touches one unit');

    const quick = readHex('plain', sheet('plain', 'accelerate', 'corrosive', 'single')).recipe!;
    equal([quick.parts[0].effects, quick.parts[0].modifiers, hexAction(quick)], [['corrosive'], ['accelerate'], 'bonus'], 'Accelerate before an effect quickens the hex');
    equal(hexPotency(quick), 1.05, 'and weakens it (1.5 x 0.7)');
    const haste = readHex('plain', sheet('plain', 'single', 'corrosive', 'accelerate')).recipe!;
    equal([haste.parts[0].effects, hexAction(haste)], [['corrosive', 'accelerate'], 'main'], 'Accelerate last is an effect of its own');
    const heavy = readHex('plain', sheet('plain', 'slow', 'explosion', 'single')).recipe!;
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
    equal(readHex('plain', [SEAL_BIT, glyph('heal'), 0]).problem, 'Grid 1: the seal has no rune to turn.', 'a seal needs a rune');
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
    equal(readHex('plain', [glyph('single'), glyph('heal'), glyph('missile', 'bridge')]).problem, 'Grid 3: a coupling needs a rune on both sides.', 'a chain into nothing');
    equal(readHex('plain', [glyph('single', 'bridge'), glyph('heal'), 0]).problem, 'Grid 1: only an effect rune can carry a coupling.', 'only effects carry');
    equal(readHex('plain', [glyph('missile', 'bridge'), glyph('aoe'), 0]).problem, 'Coupled part 1 needs an effect rune.', 'each part needs an effect');
    const targeted = readHex('fine', sheet('fine', 'single', glyph('missile', 'bridge'), 'aoe', 'wind')).recipe;
    equal(targeted?.parts.map((part) => part.target), ['single', 'aoe'], 'each part takes its own target');
    const quick = readHex('plain', [glyph('accelerate'), glyph('missile', 'bridge'), glyph('wind')]).recipe!;
    equal([quick.parts[0].modifiers, hexAction(quick)], [['accelerate'], 'bonus'], 'a pace rune modifies only its own part');
  }],

  ['a Hexzettel is its own id, seals and chains included, and only a sound one reads', () => {
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
      `hex:p:${RUNES.heal.masks[0].toString(36)}.0`,
      `hex:p:0${RUNES.heal.masks[0].toString(36)}.0.0`,
      'hex:p:zzzzz.0.0',
      'hex:p:1.0.0',
      `hex:p:${(FULL_GRID + 1).toString(36)}.0.0`,
      `hex:p:${glyph('heal', 'bridge').toString(36)}.0.0`,
    ]) assert(!isItemId(bad), `${bad} is no item`);
    equal(asItemIds([id, 'hex:p:1.0.0']), [id], 'only the sound id passes');
  }],

  ['the guild sells paper for a silver and fine paper for a gold', () => {
    const run = scribeRun();
    const guild = shopById('capitol-guild')!;
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
    equal(drawHex(run, 'paper', [1, 0, 0], 'hexcraft').message, 'Grid 1 holds no rune.', 'only a readable hex');
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
    loose(game, hexer, hex('battlefield', 'enemies', glyph('missile', 'bridge'), glyph('regen', 'seal')), null);
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
    loose(game, hexer, hex(glyph('environment', 'seal'), 'enemies', 'dot', 'corrosive'), bearer);
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
    loose(game, hexer, hex('environment', 'dot', 'corrosive', 'enemies'), null, { x: 410, y: 280 });
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
];

for (const [name, run] of tests) {
  await run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration hexcraft: ${tests.length} checks passed.`);
