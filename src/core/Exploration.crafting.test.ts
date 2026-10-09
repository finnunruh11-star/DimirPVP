import { FIELD, MELEE_RANGE, RANGE_UNIT } from '../config/constants';
import { runHitEffects, type HitEffect } from '../effects/classKit';
import { applyStun } from '../effects/effects';
import { capturePartySnapshot } from '../pve/exploration/party';
import { dropKind, dropTable, rollDrops } from '../pve/exploration/drops';
import { craftersIn, craftItem, dropItem, grantToMage, partyOf, sellItem, shopStock, unequipItem, withParty } from '../pve/exploration/economy';
import { GEMS } from '../pve/exploration/finds';
import { applyIntent, parseIntent } from '../pve/exploration/intents';
import { createRun, type ExplorationRun } from '../pve/exploration/run';
import { SHOPS } from '../pve/exploration/shops';
import { itemIconKind } from '../visuals/itemIcons';
import { designProblem, effectFits, effectPool, materialsValue, pickEffects, rollChance, rollNeeded, type PoolEntry } from './crafting/craft';
import {
  CRAFT_EFFECTS,
  CRAFT_MATERIALS,
  craftEffect,
  craftRoll,
  isCraftEffect,
  POWER_LEVELS,
  powerLevel,
  type CraftEffectId,
  type CraftForm,
  type CraftTemplateId,
} from './crafting/data';
import { craftItemId, craftMaterial, parseCraftedId, type CraftDesign, type CraftSpec } from './crafting/item';
import { Dice } from './Dice';
import { GameState } from './GameState';
import { asItemIds, getItem, isItemId, type ItemDef, type ItemId } from './Items';
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

function traveller(name: string, mageClass: MageClass): Mage {
  const m = new Mage({ name, isAI: false, team: 1, position: { x: 200, y: 200 }, loadout: ['shadow', 'mind', 'pierce', 'subtle'], mageClass });
  m.assignFlatStats(3);
  m.statStrength = 30;
  return m;
}

/** A smith (Objects) and a healer (Life), the smith carrying ore, a ruby and full mana. */
function workshopRun(seed = 21): ExplorationRun {
  const run = createRun(seed, capturePartySnapshot([traveller('Smith', 'objects'), traveller('Healer', 'life')]));
  withParty(run, (_leader, party) => {
    const [smith, healer] = party;
    smith.bag.push('oreIron', 'oreIron', 'gemRuby');
    smith.mana = 10;
    healer.bag.push('oreIron', 'oreIron');
  });
  return run;
}

/** A unit with a plain body and room for many hits. */
function unit(name: string, team: number, x: number): Mage {
  const m = new Mage({ name, isAI: team !== 1, team, position: { x, y: 270 }, loadout: [] });
  m.maxHp = 300;
  m.hp = 300;
  return m;
}

function made(
  template: CraftTemplateId,
  form: CraftForm,
  parts: ItemId[],
  sockets: ItemId[] = [],
  effects: CraftEffectId[] = [],
  score = 0,
): ItemDef {
  const id = craftItemId({ template, form, parts, sockets, mana: 0, dice: [2, 3], score, effects });
  return getItem(id);
}

const SWORD: CraftDesign = { template: 'sword', form: 'sword', parts: ['oreIron', 'oreIron'], sockets: ['gemRuby'], mana: 4 };
const FORGE = Object.values(SHOPS).find((shop) => shop.services.includes('forge'))!;
const NOT_A_FORGE = Object.values(SHOPS).find((shop) => !shop.services.includes('forge'))!;

const tests: [name: string, run: () => void | Promise<void>][] = [
  ['crafting draws materials from every party member and storage compartment', () => {
    const run = workshopRun();
    withParty(run, (_leader, [smith, healer]) => {
      smith.bag = [];
      smith.utility = ['oreIron'];
      healer.bag = ['oreIron'];
      healer.utility = ['gemRuby'];
    });
    const result = craftItem(run, FORGE.id, SWORD, 'objects');
    assert(result.ok, result.message);
    const [smith, healer] = partyOf(run);
    equal([smith.utility, healer.bag, healer.utility], [[], [], []], 'materials consumed from their owners');
    equal(smith.mana, 6, 'only the smith pays mana');
    assert([...smith.bag, ...smith.hands].includes(result.item!), 'smith receives the item');
    const failed = workshopRun();
    withParty(failed, (_leader, [smith, healer]) => { smith.mana = 0; healer.utility.push('gemRuby'); });
    const before = JSON.stringify(failed.party.entities);
    assert(!craftItem(failed, FORGE.id, SWORD, 'objects').ok, 'not enough mana');
    equal(JSON.stringify(failed.party.entities), before, 'a rejected craft consumes nothing');
  }],

  ['two d20, the higher counts; a pair counts 26 and a 20 counts 22', () => {
    equal([craftRoll(3, 17), craftRoll(17, 3), craftRoll(20, 5), craftRoll(1, 1), craftRoll(20, 20)], [17, 17, 22, 26, 26], 'rolls');
    equal(rollChance(1), 1, 'every roll counts at least 1');
    equal(rollChance(26), 20 / 400, 'only a pair counts 26');
    equal(rollChance(22), (38 + 20) / 400, 'a lone 20 or any pair');
    equal(rollChance(27), 0, 'nothing beats a pair');
    const fine = POWER_LEVELS[1];
    const legendary = POWER_LEVELS[5];
    equal([rollNeeded(15, fine), rollNeeded(25, fine), rollNeeded(50, legendary), rollNeeded(0, legendary)], [5, 1, 22, null], 'what each roll must reach');
  }],

  ['the score sets the power level, and higher levels buy more and stronger effects', () => {
    const levels = [0, 19, 20, 29, 30, 40, 54, 55, 69, 70, 200].map((score) => powerLevel(score).level);
    equal(levels, [1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6], 'thresholds');
    for (let i = 1; i < POWER_LEVELS.length; i++) {
      const [lower, higher] = [POWER_LEVELS[i - 1], POWER_LEVELS[i]];
      assert(higher.min > lower.min && higher.budget > lower.budget && higher.maxEffects >= lower.maxEffects, `${higher.name} outdoes ${lower.name}`);
    }
  }],

  ['every material has a slot, a value and only effects that exist; the weightier effects rank higher', () => {
    for (const [id, material] of Object.entries(CRAFT_MATERIALS)) {
      assert(getItem(id as ItemId).material, `${id} is a material`);
      assert(material && material.value > 0 && material.effects.every(isCraftEffect), `${id} is well formed`);
    }
    equal([craftMaterial('oreIron')?.slot, craftMaterial('gemRuby')?.slot, craftMaterial('moonshardBlack')?.slot], ['material', 'focus', 'focus'], 'slots');
    equal(craftMaterial('rubyStaff'), null, 'gear is not a material');
    for (const [id, effect] of Object.entries(CRAFT_EFFECTS)) {
      assert(effect.rank >= 1 && effect.rank <= 5 && effect.modes.length > 0, `${id} has a rank and somewhere to go`);
    }
    assert(CRAFT_EFFECTS.antiHeal.rank > CRAFT_EFFECTS.bleed.rank + 2 && CRAFT_EFFECTS.antiHeal.rank > CRAFT_EFFECTS.venom.rank, 'anti-heal outranks damage over time');
  }],

  ['a design fills its parts with materials and its sockets with focus pieces', () => {
    equal(designProblem(SWORD), null, 'a sound sword');
    equal(designProblem({ ...SWORD, parts: ['oreIron'] }), 'Every part needs a material.', 'a missing part');
    assert(designProblem({ ...SWORD, parts: ['gemRuby', 'oreIron'] })?.includes('not a part material'), 'a gem is no hilt');
    assert(designProblem({ ...SWORD, sockets: ['oreIron'] })?.includes('cannot be set in a socket'), 'ore is no focus');
    equal(designProblem({ ...SWORD, form: 'dagger', sockets: ['gemRuby', 'gemRuby'] }), 'A dagger holds 1 focus piece.', 'a dagger has one socket');
    equal(designProblem({ ...SWORD, form: 'wand' }), 'Pick a size.', 'a sword cannot be a wand');
    equal(designProblem({ ...SWORD, mana: 11 }), 'Pay 0 to 10 mana.', 'mana capped at 10');
    equal(materialsValue(SWORD), 4 + 4 + 12, 'iron, iron and a ruby');
  }],

  ['what a design can draw comes from its materials, as its form can carry it', () => {
    const ids = (pool: PoolEntry[]): string[] => pool.map((entry) => entry.id).sort();
    const sword = effectPool({ template: 'sword', form: 'sword', parts: ['oreCoal', 'oreIron'], sockets: [] });
    equal(ids(sword), ['burn', 'honed', 'imbue', 'knockback', 'sunder'], 'coal and iron on a sword (no armour effects)');
    const dagger = effectPool({ template: 'sword', form: 'dagger', parts: ['oreCoal', 'oreIron'], sockets: [] });
    assert(!dagger.some((entry) => entry.id === 'knockback'), 'a dagger is too light to knock back');
    const plate = effectPool({ template: 'armor', form: 'plate', parts: ['oreCoal', 'oreIron'], sockets: [] });
    equal(ids(plate), ['emberMail', 'plating'], 'armour only takes what armour can');
    const staff = ids(effectPool({ template: 'staff', form: 'staff', parts: ['oreGold', 'oreGold'], sockets: ['gemRuby'] }));
    const wand = ids(effectPool({ template: 'staff', form: 'wand', parts: ['oreGold', 'oreGold'], sockets: ['gemRuby'] }));
    assert(staff.includes('spellPower') && !staff.includes('imbue') && !staff.includes('burn'), 'a staff shapes spells, it does not strike');
    assert(wand.includes('imbue') && wand.includes('burn') && !wand.includes('spellPower'), 'a wand bolts, it does not shape spells');
    assert(effectFits('witchcraft', 'staff', 'staff') && effectFits('witchcraft', 'wand', 'wand') && !effectFits('witchcraft', 'blade', 'sword'), 'witchcraft on staves and wands');
  }],

  ["effects are drawn within the level's budget and count, the same for the same dice", () => {
    const pool: PoolEntry[] = (Object.keys(CRAFT_EFFECTS) as CraftEffectId[])
      .filter((id) => effectFits(id, 'blade', 'greatsword'))
      .map((id) => ({ id, weight: 1 }));
    for (const level of POWER_LEVELS) {
      for (let seed = 1; seed <= 60; seed++) {
        const picked = pickEffects(pool, level, new Dice(seed));
        const spent = picked.reduce((sum, id) => sum + CRAFT_EFFECTS[id].rank, 0);
        assert(picked.length <= level.maxEffects && spent <= level.budget, `${level.name} seed ${seed}: ${picked.join(', ')}`);
        assert(new Set(picked).size === picked.length, `${level.name}: no effect twice`);
      }
    }
    const top = POWER_LEVELS[5];
    equal(pickEffects(pool, top, new Dice(7)), pickEffects(pool, top, new Dice(7)), 'same dice, same effects');
    equal(pickEffects([{ id: 'venom', weight: 1 }], POWER_LEVELS[0], new Dice(1)), [], 'a crude item cannot afford Venomous');
    equal(pickEffects([{ id: 'antiHeal', weight: 1 }], POWER_LEVELS[3], new Dice(1)), ['antiHeal'], 'a masterwork can afford Festering');
  }],

  ['a crafted item is its own id, and reads back the same', () => {
    const spec: CraftSpec = {
      template: 'sword',
      form: 'greatsword',
      parts: ['oreCoal', 'darksteelBar'],
      sockets: ['gemRuby', 'wolfFang'],
      mana: 7,
      dice: [12, 12],
      score: 1 + 6 + 5 + 2 + 7 + 26,
      effects: ['honed', 'bleed', 'knockback'],
    };
    const id = craftItemId(spec);
    equal(parseCraftedId(id), spec, 'round trip');
    assert(isItemId(id), 'a crafted id is an item id');
    equal(asItemIds([id, 'craft:sword', 'nonsense']), [id], 'only the sound id passes');
    const def = getItem(id);
    assert(def === getItem(id), 'built once');
    equal([def.name, def.rarity, def.crafted?.level.level, def.crafted?.roll], ['Masterwork Darksteel Greatsword', 'unreal', 4, 26], 'its making');
    equal([def.twoHanded, def.weapon?.multiplier, def.weapon?.knockbackUnits], [true, 2.2, 2], 'a heavy, honed greatsword');
    assert(def.onHit?.some((hit) => hit.k === 'dot' && hit.name === 'Bleeding'), 'it bleeds what it hits');
    assert(def.blurb.includes('bleeding') && def.blurb.includes('knock back'), `the blurb tells it all: ${def.blurb}`);
    assert(def.adventureOnly && def.cost > 0, 'an adventure item with a worth');
  }],

  ['malformed or hostile crafted ids are refused', () => {
    const good = 'craft:sword:sword:oreIron,oreCoal::3:5-6:20:';
    assert(parseCraftedId(good), 'the plain one reads');
    for (const bad of [
      'craft:',
      'craft:sword:sword:oreIron:gemRuby:3:5-6:20:',
      'craft:sword:wand:oreIron,oreCoal::3:5-6:20:',
      'craft:axe:sword:oreIron,oreCoal::3:5-6:20:',
      'craft:sword:sword:oreIron,oreCoal::11:5-6:20:',
      'craft:sword:sword:oreIron,oreCoal::3:0-6:20:',
      'craft:sword:sword:oreIron,oreCoal::3:5-21:20:',
      'craft:sword:dagger:oreIron,oreCoal:gemRuby,gemRuby:3:5-6:20:',
      'craft:sword:sword:oreIron,<script>::3:5-6:20:',
      'craft:sword:sword:__proto__,oreCoal::3:5-6:20:',
      'craft:sword:sword:oreIron,oreCoal::3:5-6:20:' + 'bleed,'.repeat(120),
    ]) {
      equal(parseCraftedId(bad), null, bad.slice(0, 60));
      assert(!isItemId(bad), `${bad.slice(0, 60)} is no item`);
    }
    equal(parseCraftedId(`${good}bleed,nonsense,bleed,constructor,toString`)?.effects, ['bleed'], 'unknown and repeated effects fall away');
  }],

  ['each form is what it says before any effect', () => {
    const dagger = made('sword', 'dagger', ['oreIron', 'oreIron']);
    equal([dagger.weapon?.kind, dagger.weapon?.dexBonus, dagger.twoHanded ?? false], ['dex', 4, false], 'a dagger is a Dex weapon');
    const wand = made('staff', 'wand', ['oreCopper', 'oreCopper'], ['gemSapphire']);
    equal([wand.isWand, wand.staffBolts?.length, wand.staffBolts?.[0].type, wand.castThrough], [true, 1, 'cold', undefined], 'a wand bolts with its gem');
    const staff = made('staff', 'staff', ['oreCopper', 'oreCopper'], ['gemSapphire']);
    equal([staff.isWand, staff.staffBolts, staff.castThrough?.damageMult], [true, undefined, 1.05], 'a staff is cast through');
    const longbow = made('bow', 'longbow', ['wolfPelt', 'wolfPelt']);
    equal([longbow.twoHanded, longbow.weaponFamily, longbow.weapon?.usesArrows], [true, 'bow', true], 'a longbow');
    const plate = made('armor', 'plate', ['oreIron', 'oreIron']);
    equal([plate.slot, plate.armor?.flat, plate.moveMult], ['torso', 3, 0.85], 'plate');
    const lean = made('armor', 'jerkin', ['oreIron', 'oreIron'], [], ['plating', 'featherweight'], 30);
    equal([lean.armor?.flat, lean.weight], [2, 1.3], 'effects build on the form (iron jerkin 2.6kg, halved)');
  }],

  ['the materials follow the creatures and colours they come from', () => {
    const pool = (id: ItemId): readonly string[] => craftMaterial(id)?.effects ?? [];
    equal([pool('gemAmethyst'), pool('gemDiamond'), pool('wood')], [[], [], []], 'amethyst, diamond and wood lend nothing');
    assert(craftMaterial('gemAmethyst')!.value * 2 < craftMaterial('gemDiamond')!.value, 'a diamond is worth far more than an amethyst');
    for (const gem of ['gemRuby', 'gemSapphire', 'gemOnyx', 'gemPearl', 'gemEmerald'] as const) {
      const material = craftMaterial(gem)!;
      assert(material.value >= 10 && (material.lean ?? 1) > 1 && material.effects.length >= 6, `${gem} leans hard into its colour`);
    }
    const gels = [['gelRed', 'gemRuby'], ['gelBlue', 'gemSapphire'], ['gelBlack', 'gemOnyx'], ['gelWhite', 'gemPearl'], ['slimeGel', 'gemEmerald']] as const;
    for (const [gel, gem] of gels) {
      const weak = craftMaterial(gel)!;
      const strong = craftMaterial(gem)!;
      assert(weak.value < strong.value && weak.effects.every((e) => strong.effects.includes(e)) && weak.element === strong.element, `${gel} is a weak ${gem}`);
    }
    const herbs = [['gelWhite', 'herbMoonglow', 'gemPearl'], ['gelBlue', 'herbWaterleaf', 'gemSapphire'], ['gelBlack', 'herbDeathweed', 'gemOnyx'], ['gelRed', 'herbFireblossom', 'gemRuby']] as const;
    for (const [gel, herb, gem] of herbs) {
      const [low, mid, high] = [craftMaterial(gel)!, craftMaterial(herb)!, craftMaterial(gem)!];
      assert(low.value < mid.value && mid.value < high.value, `${herb} is worth between ${gel} and ${gem}`);
      assert((low.lean ?? 1) < (mid.lean ?? 1) && (mid.lean ?? 1) < (high.lean ?? 1), `${herb} leans between them`);
      assert(low.effects.length < mid.effects.length && mid.effects.length < high.effects.length && mid.effects.every((e) => high.effects.includes(e)), `${herb} lends a handful of ${gem}'s colour`);
      equal(mid.element, high.element, `${herb} carries ${gem}'s element`);
    }
    const skins = (['batLeather', 'rabbitPelt', 'wolfPelt', 'boarHide', 'lionPelt'] as const).map((id) => craftMaterial(id)!);
    assert(skins.every((skin) => skin.slot === 'material' && (skin.heft ?? 1) < 1 && skin.effects.join() === skins[0].effects.join()), 'every skin is the same light leather');
    assert(skins.slice(1).every((skin, i) => skin.value >= skins[i].value) && skins[4].value > skins[1].value, 'better leather from stronger beasts');
    for (const drake of ['redDrakeScale', 'blackDrakeScale'] as const) assert(pool(drake).includes('fireproof') && pool(drake).includes('burn'), `${drake} resists heat and burns`);
    assert(pool('wolfFang').includes('bleed') && pool('wolfFang').includes('vigor'), 'a wolf fang bleeds, a little green');
    assert(['stunProof', 'immovable', 'stoneSkin'].every((e) => pool('stoneHeart').includes(e)), 'a stone heart is a tank');
    assert(pool('redStone').includes('gather') && pool('redStone').includes('rolling'), 'a red stone gathers and rolls');
    assert(pool('darkEye').every((e) => e !== 'antiHeal') && pool('darkEye').includes('shadowStrike'), 'a dark eye is better in shadow');
    assert(['lifesteal', 'evasion', 'plating', 'vigor', 'regeneration'].every((e) => pool('lostSoul').includes(e)) && craftMaterial('lostSoul')!.value >= 14, 'a lost soul is a fine, reactive bruiser');
    assert(['keen', 'reach'].every((e) => pool('beastHorn').includes(e)), 'a beast horn: crits and reach');
    assert(pool('pebble').includes('opening') && craftMaterial('pebble')!.value <= 1, 'a pebble is cheap and early');
    for (const stone of ['manaStoneSmall', 'manaStoneMedium', 'manaStoneBig'] as const) equal(pool(stone), ['manaWell'], `${stone} only stores mana`);
    assert(['reap', 'execute', 'harvest'].every((e) => pool('reaperCore').includes(e)), 'a reaper core reaps and executes, and turns on its bearer');
    assert(pool('lichCore').includes('soulPrice') && pool('lichCore').includes('curse'), 'a lich core curses, at a price');
    equal((['magmaShardTank', 'magmaShardHealer', 'magmaShardMage'] as const).map((id) => craftMaterial(id)?.slot), ['focus', 'focus', 'focus'], 'a shard per magma sentinel');
    const heft = (id: ItemId): number => craftMaterial(id)?.heft ?? 1;
    assert(heft('wood') < heft('oreCopper') && heft('oreCopper') < 1 && heft('oreIron') > 1 && heft('darksteelBar') > heft('oreIron'), 'copper is light, iron heavy, darksteel heavier still');
    equal(
      (['wood', 'gemOnyx', 'gemPearl', 'koboldScale', 'lionFang', 'demonHorn', 'magmaShardMage', 'gelRed', 'badCharm'] as const).map((id) => itemIconKind(getItem(id))),
      ['ingot', 'gem', 'gem', 'scale', 'fang', 'fang', 'crystal', 'blob', 'trinket'],
      'each new material has a picture',
    );
    equal(
      (['stoneHeart', 'redStone', 'pebble', 'batLeather', 'lostSoul', 'voidShard', 'beastHorn', 'herbMoonglow', 'herbFireblossom'] as const).map((id) => itemIconKind(getItem(id))),
      ['core', 'ore', 'ore', 'pelt', 'blob', 'crystal', 'fang', 'leaf', 'root'],
      'and so do the newest',
    );
  }],

  ['a gem pulls the draw far harder than the metal around it, and heavier metal makes heavier things', () => {
    const pool = effectPool({ template: 'sword', form: 'sword', parts: ['oreCoal', 'oreIron'], sockets: ['gemRuby'] });
    const weight = (id: string): number => pool.find((entry) => entry.id === id)?.weight ?? 0;
    equal([weight('burn'), weight('honed'), weight('kindle')], [1 + 3, 1, 3], 'coal and a ruby both bring Burning, the ruby three times over');
    const weigh = (part: ItemId): number => made('sword', 'sword', [part, part]).weight;
    equal([weigh('wood'), weigh('oreCopper'), weigh('oreIron'), weigh('darksteelBar')], [1.2, 1.5, 2.6, 3.6], 'a 2kg sword in wood, copper, iron, darksteel');
  }],

  ['a reaping strike marks the struck, an execution kills it, and a reaper core turns on its bearer', () => {
    const striker = unit('Striker', 1, 100);
    const victim = unit('Victim', 2, 140);
    const game = new GameState([striker, victim], 3);
    const strikeWith = (effects: readonly HitEffect[]): void =>
      runHitEffects({ striker, victim, dealt: 5, drinker: striker, ctx: game.quietContext(striker, victim) }, effects);
    const harvest = made('sword', 'sword', ['oreIron', 'oreIron'], [], ['harvest'], 40).onHit!;
    strikeWith(harvest);
    equal([game.reapOn(victim), game.reapOn(striker)], [2, 1], 'Harvesting: 2 Reap on the struck, 1 on its bearer');
    victim.hp = 10;
    strikeWith([{ k: 'execute', at: 3 }]);
    assert(victim.alive, 'ten health is above 3 + 2 per Reap');
    victim.hp = 7;
    strikeWith([{ k: 'execute', at: 3 }]);
    assert(!victim.alive, 'seven is not');
    striker.hp = 2;
    strikeWith(harvest);
    assert(!striker.alive, 'the bearer, worn down to its own Reap, dies by it');

    const mid = { x: FIELD.x + FIELD.w / 2, y: FIELD.y + FIELD.h / 2 };
    const runner = unit('Runner', 1, mid.x);
    const struck = unit('Struck', 2, mid.x + 2 * RANGE_UNIT);
    const field = new GameState([runner, struck], 4);
    runHitEffects({ striker: runner, victim: struck, dealt: 5, drinker: runner, ctx: field.quietContext(runner, struck) }, made('sword', 'dagger', ['wood', 'wood'], [], ['blink'], 30).onHit!);
    equal(Math.round((struck.x - runner.x) / RANGE_UNIT), 4, 'Blinking: 2cm further off after the hit');
  }],

  ['a charging blade hits harder the further its wielder ran this turn, up to +4', async () => {
    const sword = made('sword', 'sword', ['oreIron', 'oreIron'], [], ['charge'], 30);
    let seen = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const hit = async (ranCm: number): Promise<number> => {
        const striker = unit('Striker', 1, 100);
        striker.hands = [sword.id];
        striker.distMovedThisTurn = ranCm * RANGE_UNIT;
        const foe = unit('Foe', 2, 100 + MELEE_RANGE - 8);
        const game = new GameState([striker, foe], seed);
        await game.makeMeleeItem(striker, foe).resolve(game);
        return 300 - foe.hp;
      };
      const still = await hit(0);
      const ran = await hit(6);
      const far = await hit(40);
      if (still === 0) continue;
      seen += 1;
      equal([ran - still, far - still], [3, 4], `seed ${seed}: +1 per 2cm, capped at 4`);
    }
    assert(seen >= 10, `enough blows landed to judge (${seen})`);
  }],

  ['momentum and stored mana come from whatever is worn or held', () => {
    const runner = unit('Runner', 1, 100);
    const before = runner.moveRange();
    runner.momentumStacks = 2;
    equal(runner.moveRange(), before, 'momentum needs gear that carries it');
    runner.torso = made('armor', 'jerkin', ['wood', 'wood'], [], ['momentum'], 30).id;
    equal(runner.moveRange() - before, 2 * RANGE_UNIT, 'two turns running: +2cm');
    const wand = made('staff', 'wand', ['wood', 'wood'], ['manaStoneBig'], ['manaWell'], 45);
    const caster = unit('Caster', 1, 100);
    equal(caster.fightStartMana(), 0, 'nothing stored');
    caster.hands = [wand.id];
    equal(caster.fightStartMana(), 4, 'a masterwork mana store gives 4 as a fight begins');
    assert(craftEffect('manaWell').describe({ mode: 'wand', form: 'wand', element: 'shatter', level: 4 }).includes('+4 mana'), 'and says so');
  }],

  ['selling or dropping an item takes back what it did to its bearer', () => {
    const run = workshopRun();
    const jerkin = made('armor', 'jerkin', ['wood', 'wood'], [], ['vigor'], 30).id;
    const base = partyOf(run)[0].maxHp;
    const shop = Object.values(SHOPS).find((entry) => entry.buys.some((rule) => rule.accepts(getItem(jerkin))))!;
    for (const leave of [() => sellItem(run, shop.id, jerkin, false), () => dropItem(run, jerkin)]) {
      withParty(run, (leader) => grantToMage(leader, jerkin));
      equal(partyOf(run)[0].maxHp, base + 4, 'Hale: +4 max HP while carried');
      assert(unequipItem(run, jerkin).ok && leave().ok, 'stowed, then gone');
      equal(partyOf(run)[0].maxHp, base, 'and the 4 go with it');
    }
  }],

  ['each creature leaves its own material, and a magma sentinel the shard of its role', () => {
    const rng = new Dice(4);
    const seen = (kind: string): Set<ItemId> => {
      const out = new Set<ItemId>();
      for (let i = 0; i < 400; i++) for (const id of rollDrops(kind, 1, rng)) out.add(id);
      return out;
    };
    const own = [
      ['slime', 'slimeGel'], ['slime-red', 'gelRed'], ['slime-blue', 'gelBlue'], ['slime-black', 'gelBlack'], ['slime-white', 'gelWhite'],
      ['kobold', 'koboldScale'], ['lion', 'lionFang'], ['soldierDemon', 'demonHorn'], ['oni', 'badCharm'], ['ghast', 'ghastEssence'],
      ['rockling', 'pebble'], ['beastDemon', 'beastHorn'], ['earth-elemental', 'redStone'], ['cavern-bat', 'batLeather'],
      ['golem', 'stoneHeart'], ['deathknightSpear', 'lostSoul'], ['deathknightSpear', 'darksteelBar'],
    ] as const;
    for (const [kind, item] of own) assert(seen(kind).has(item), `a ${kind} leaves ${item}`);
    for (const kind of ['defender', 'ghast', 'soldierDemon', 'oni']) assert(!seen(kind).has('darksteelBar'), `only a deathknight leaves darksteel, not a ${kind}`);
    equal([...seen(dropKind('magma-sentinel', 'tank'))], ['magmaShardTank'], 'a tank leaves a tank shard');
    equal([...seen(dropKind('magma-sentinel', 'healer'))], ['magmaShardHealer'], 'a healer leaves a healer shard');
    equal([...seen(dropKind('magma-sentinel', 'dps'))], ['magmaShardMage'], 'a mage leaves a mage shard');
    equal(seen(dropKind('magma-sentinel')).size, 3, 'one met without a role leaves any of them');
    equal(dropTable(dropKind('sentinel', 'tank')), dropTable('sentinel'), 'a role without a table of its own rolls the family');
  }],

  ['a reaper and a lich roll their hoards: a core is rare, a void shard rarer, never two cores', () => {
    const rng = new Dice(8);
    const kills = 4000;
    const tally = (kind: 'reaper' | 'lich'): { cores: number; most: number; shards: number; empty: number } => {
      const core = kind === 'reaper' ? 'reaperCore' : 'lichCore';
      const out = { cores: 0, most: 0, shards: 0, empty: 0 };
      for (let i = 0; i < kills; i++) {
        const drops = rollDrops(kind, 1, rng);
        assert(drops.every((id) => id === core || id === 'ectoplasm' || id === 'voidShard'), `a ${kind} leaves only its hoard`);
        const cores = drops.filter((id) => id === core).length;
        out.cores += cores;
        out.most = Math.max(out.most, cores);
        out.shards += drops.filter((id) => id === 'voidShard').length;
        if (drops.length === 0) out.empty += 1;
      }
      return out;
    };
    const reaper = tally('reaper');
    equal(reaper.most, 1, 'a 20 brings a core, and every roll after it is 3 lower: never a second');
    assert(Math.abs(reaper.cores / kills - 0.3) < 0.03, `a reaper core about 30% of the time (${(reaper.cores / kills).toFixed(3)})`);
    assert(reaper.shards > 0 && reaper.shards < reaper.cores / 2, `a void shard on a 13, rarer still (${reaper.shards})`);
    assert(Math.abs(reaper.empty / kills - 0.3) < 0.03, 'a first roll of 1-6 leaves nothing');
    const lich = tally('lich');
    assert(lich.most === 1 && lich.shards === 0 && lich.cores / kills < 0.4, 'a lich core is rare too, and a lich has no void shards');
    for (const id of ['reaperCore', 'lichCore', 'voidShard'] as const) assert(getItem(id).material, `${id} is a material`);
  }],

  ['old saves keep their things under the new names', () => {
    equal(
      asItemIds(['herbMoonleaf', 'herbEmberroot', 'herbBogcap', 'golemCore', 'elementalGeode', 'echoMembrane', 'gemOpal']),
      ['herbMoonglow', 'herbFireblossom', 'herbDeathweed', 'stoneHeart', 'redStone', 'batLeather', 'gemOnyx'],
      'renamed as they are read',
    );
  }],

  ['a stone heart keeps its bearer standing; a lost soul mends and dodges; a pebble bites early', () => {
    const tank = unit('Tank', 1, 400);
    const foe = unit('Foe', 2, 440);
    const game = new GameState([tank, foe], 6);
    tank.torso = made('armor', 'plate', ['oreIron', 'oreIron'], ['stoneHeart'], ['stunProof', 'immovable'], 60).id;
    const ctx = game.effectContext(foe, tank, null);
    applyStun(ctx, tank, { duration: 2, type: 'full' });
    applyStun(ctx, tank, { duration: 2, type: 'main' });
    assert(!tank.isStunned('full') && !tank.isStunned('main'), 'no stun or disarm takes hold');
    applyStun(ctx, tank, { duration: 1, type: 'movement' });
    assert(tank.isStunned('movement'), 'a root still does');
    const at = { ...tank.pos };
    game.forceMove(foe, tank, { x: tank.x + 3 * RANGE_UNIT, y: tank.y });
    equal(tank.pos, at, 'and nothing shoves it');

    const knight = unit('Knight', 1, 400);
    const field = new GameState([knight, unit('Foe', 2, 700)], 7);
    equal(knight.maxDodges(), 0, 'no Dex, no dodges');
    knight.torso = made('armor', 'jerkin', ['batLeather', 'batLeather'], ['lostSoul'], ['regeneration', 'evasion'], 60).id;
    equal(knight.maxDodges(), 1, 'Evasive: a dodge each fight');
    knight.hp = 250;
    field.currentIndex = field.mages.indexOf(knight);
    field.beginTurn();
    equal(knight.hp, 251, 'Regenerating: +1 HP as the turn begins');

    const striker = unit('Striker', 1, 100);
    const victim = unit('Victim', 2, 140);
    const early = new GameState([striker, victim], 3);
    const eager = made('sword', 'sword', ['oreIron', 'oreIron'], ['pebble'], ['firstBlood'], 30).onHit!;
    const bleeds = (): boolean => victim.statuses.some((status) => status.kind === 'dot');
    runHitEffects({ striker, victim, dealt: 5, drinker: striker, ctx: early.quietContext(striker, victim) }, eager);
    assert(bleeds(), 'First-blooding: the first rounds bleed');
    victim.statuses = [];
    early.round = 3;
    runHitEffects({ striker, victim, dealt: 5, drinker: striker, ctx: early.quietContext(striker, victim) }, eager);
    assert(!bleeds(), 'and later ones do not');
  }],

  ['a red stone gathers a stone each turn, up to four, and the next hit hurls them', async () => {
    const sword = made('sword', 'sword', ['oreIron', 'oreIron'], ['redStone'], ['gather'], 40).id;
    const gatherer = unit('Gatherer', 1, 100);
    gatherer.hands = [sword];
    const game = new GameState([gatherer, unit('Foe', 2, 700)], 2);
    game.currentIndex = game.mages.indexOf(gatherer);
    for (let i = 0; i < 6; i++) game.beginTurn();
    equal(gatherer.gatheredStones, 4, 'four at most');
    let seen = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const hit = async (stones: number): Promise<[number, number]> => {
        const striker = unit('Striker', 1, 100);
        striker.hands = [sword];
        striker.gatheredStones = stones;
        const foe = unit('Foe', 2, 100 + MELEE_RANGE - 8);
        const fight = new GameState([striker, foe], seed);
        await fight.makeMeleeItem(striker, foe).resolve(fight);
        return [300 - foe.hp, striker.gatheredStones];
      };
      const [plain] = await hit(0);
      const [hurled, left] = await hit(3);
      if (plain === 0) continue;
      seen += 1;
      equal([hurled - plain, left], [3, 0], `seed ${seed}: +1 per stone, then none left`);
    }
    assert(seen >= 10, `enough blows landed to judge (${seen})`);
  }],

  ['onyx, pearls and wood can be found or bought', () => {
    assert(GEMS.black.includes('gemOnyx') && GEMS.lake.includes('gemPearl'), 'onyx in the swamps, pearls by the lake');
    const run = workshopRun();
    for (const forge of Object.values(SHOPS).filter((shop) => shop.services.includes('forge'))) {
      assert(shopStock(run, forge).some((slot) => slot.id === 'wood'), `${forge.name} sells wood`);
    }
  }],

  ['a wand bolt and a blade both carry what their effects lend', () => {
    const blade = made('sword', 'sword', ['oreIron', 'oreIron'], [], ['antiHeal'], 45);
    assert(blade.onHit?.some((hit) => hit.k === 'noHeal'), 'the blade festers');
    const wand = made('staff', 'wand', ['oreIron', 'oreIron'], ['gemRuby'], ['antiHeal'], 45);
    assert(!wand.onHit, 'a wand does not strike with its body');
    assert(wand.staffBolts?.[0].onHit?.some((hit) => hit.k === 'noHeal'), 'its bolt festers');
    const caster = unit('Caster', 1, 100);
    caster.statInt = 25;
    const foe = unit('Foe', 2, 200);
    const game = new GameState([caster, foe], 5);
    game.staffBolt(caster, wand.id, 0, foe);
    assert(foe.hp < 300, 'the bolt landed');
    assert(foe.statuses.some((status) => status.key === 'debuff:kit-no-heal'), 'and the wound festers');
  }],

  ['only an Objects mage on their feet crafts, and the bench spends what went in', () => {
    const run = workshopRun();
    equal(craftersIn(run).map((mage) => mage.name), ['Smith'], 'the smith is the only crafter');
    equal(craftersIn(run, 'life'), [], 'the healer cannot craft');
    equal(craftItem(run, FORGE.id, SWORD, 'life').message, 'Only an Objects mage can craft.', 'the healer is turned away');
    equal(craftItem(run, NOT_A_FORGE.id, SWORD, null, 'objects').message, 'There is no crafting bench here.', 'no bench, no craft');
    assert(craftItem(run, FORGE.id, { ...SWORD, sockets: ['gemRuby'], parts: ['oreIron', 'oreCoal'] }, null, 'objects').message.startsWith('Needs 1x'), 'only what is carried');
    assert(craftItem(run, FORGE.id, { ...SWORD, mana: 11 }, null, 'objects').message.includes('mana'), 'mana capped');
    equal(run.crafts, 0, 'nothing crafted yet');

    const result = craftItem(run, FORGE.id, SWORD, null, 'objects');
    assert(result.ok && result.item, `crafted: ${result.message}`);
    const smith = partyOf(run)[0];
    equal([smith.bag.includes('oreIron'), smith.bag.includes('gemRuby'), smith.mana], [false, false, 6], 'materials and mana spent');
    assert(smith.hands.includes(result.item) || smith.bag.includes(result.item), 'the sword is carried');
    equal(run.crafts, 1, 'counted');
    const spec = parseCraftedId(result.item)!;
    equal([spec.parts, spec.sockets, spec.mana], [SWORD.parts, SWORD.sockets, 4], 'made as designed');
    equal(spec.score, materialsValue(SWORD) + 4 + craftRoll(...spec.dice), 'materials + mana + dice');
    equal(spec.effects.length <= powerLevel(spec.score).maxEffects, true, 'within its power');

    const again = workshopRun();
    equal(craftItem(again, FORGE.id, SWORD, null, 'objects').item, result.item, 'the same run rolls the same');

    const fallen = workshopRun();
    withParty(fallen, (_leader, party) => { party[0].hp = 0; });
    equal(craftItem(fallen, FORGE.id, SWORD, null, 'objects').message, 'Smith has fallen.', 'the fallen do not craft');
  }],

  ['crafting follows the chosen class, not the party identifier', () => {
    const run = workshopRun();
    withParty(run, (_leader, party) => {
      party[0].calling = 'life';
      party[1].calling = 'objects';
      party[1].mana = 10;
    });
    equal(craftersIn(run).map((mage) => mage.name), ['Healer'], 'only the Objects calling can use the bench');
    equal(craftersIn(run, 'objects'), [], 'the former Objects mage cannot use the bench');
    equal(craftItem(run, FORGE.id, SWORD, null, 'objects').message, 'Only an Objects mage can craft.', 'the former Objects mage cannot craft');
    equal(applyIntent(run, 'objects', { op: 'craft', shop: FORGE.id, design: SWORD }).message, 'Only an Objects mage can craft.', 'the former Objects mage cannot craft over the wire');
    equal(craftItem(run, FORGE.id, SWORD, 'life').ok, true, 'the Objects caller uses shared materials');
  }],

  ['a craft travels the wire as an intent', () => {
    const intent = { op: 'craft', shop: FORGE.id, design: SWORD };
    equal(parseIntent(intent), intent, 'a sound craft');
    equal(parseIntent({ ...intent, crafter: 'objects' }), { ...intent, crafter: 'objects' }, 'a named crafter');
    for (const bad of [
      { ...intent, crafter: 'king' },
      { ...intent, design: { ...SWORD, template: 'axe' } },
      { ...intent, design: { ...SWORD, mana: 11 } },
      { ...intent, design: { ...SWORD, mana: 2.5 } },
      { ...intent, design: { ...SWORD, parts: ['oreIron', 'nonsense'] } },
      { ...intent, design: { ...SWORD, sockets: ['gemRuby', 'gemRuby', 'gemRuby', 'gemRuby', 'gemRuby'] } },
      { ...intent, design: { ...SWORD, form: 'x'.repeat(40) } },
      { ...intent, design: null },
    ]) equal(parseIntent(bad), null, JSON.stringify(bad).slice(0, 80));
    const run = workshopRun();
    const result = applyIntent(run, 'objects', parseIntent(intent)!);
    assert(result.ok && result.item && isItemId(result.item), `crafted over the wire: ${result.message}`);
  }],
];

for (const [name, run] of tests) {
  await run();
  console.log(`PASS ${name}`);
}
console.log(`Exploration crafting: ${tests.length} checks passed.`);
