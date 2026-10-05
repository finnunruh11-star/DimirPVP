import { applyDebuff, applyDot, applyInvisibility, applyStun, areaDamage, dealDamage, heal, teleport } from '../effects/effects';
import { applyEnemyTraits } from '../pve/swamprun';
import { RANGE_UNIT } from '../config/constants';
import { FIELD, MELEE_RANGE } from '../config/constants';
import { MAGE_CLASSES } from './Classes';
import { dmg } from './Damage';
import { Dice } from './Dice';
import { analyzeDodge, dodgeGrantsBonusAction } from './Dodge';
import { GameState, hazardDistance } from './GameState';
import { Mage } from './Mage';
import { WORD_ORDER, type WordId } from './Words';
import { WORD_COLOR } from './Colors';
import { dist } from './utils';
import { getSpell, rackCoverage, setActiveSpellSets, spellForSelection } from '../spells/registry';
import {
  addImbue,
  castRobe,
  imbueAfterStrike,
  imbueDeflects,
  lawRoundEnd,
  lawTurnEnd,
  MINIONS,
  robeOf,
  runHitEffects,
  runPulse,
} from '../effects/classKit';
import { castChance, spellCastDc, spellCastOdds } from '../spells/castOdds';
import '../spells/sampleSpells';

setActiveSpellSets({ original: true, finns: true, dlc: true });

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(actualJson === expectedJson, `${label}: expected ${expectedJson}, received ${actualJson}`);
}

/** A sturdy combatant for the god-word checks: deep pools so no single roll decides a test. */
function godUnit(name: string, team: number, x: number, y = 270, loadout: WordId[] = []): Mage {
  const m = new Mage({ name, isAI: team !== 1, team, position: { x, y }, loadout });
  m.maxHp = 300;
  m.hp = 300;
  m.maxSanity = 300;
  m.sanity = 300;
  return m;
}

/** A wild creature: fair game for Desecrate. */
function creature(name: string, x: number, y = 270): Mage {
  const m = godUnit(name, 2, x, y);
  m.enemyKind = 'zombie';
  return m;
}

/** End every turn once, so exactly one round rolls over. */
function passRound(game: GameState): void {
  for (let i = 0; i < game.initiativeOrder.length; i++) game.endTurn();
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

  ['ethereal enemies ignore shadow; only the mindless ignore sanity', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 0, y: 0 }, loadout: [] });
    const cases = [
      ['wisp', 0, 2],
      ['specter', 0, 2],
      ['ghast', 0, 2],
      ['lich', 0, 2],
      ['reaper', 0, 0],
      ['zombie', 4, 0],
    ] as const;
    const foes = cases.map(([kind], i) => {
      const foe = new Mage({ name: kind, isAI: true, team: 2, position: { x: 100 + i * 60, y: 0 }, loadout: [] });
      applyEnemyTraits(foe, kind, new Dice(3));
      return foe;
    });
    const game = new GameState([caster, ...foes], 7);
    cases.forEach(([kind, shadowTaken, sanityTaken], i) => {
      const ctx = game.effectContext(caster, foes[i], null);
      equal(dealDamage(ctx, foes[i], dmg(4, 'shadow'), { canMiss: false }), shadowTaken, `${kind} shadow`);
      equal(dealDamage(ctx, foes[i], dmg(2, 'sanity'), { canMiss: false }), sanityTaken, `${kind} sanity`);
    });
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

  ['never lets a Deathknight react during its own turn', () => {
    const attacker = new Mage({
      name: 'Attacker', isAI: false, team: 1, position: { x: 300, y: 270 }, loadout: [],
    });
    const knight = new Mage({
      name: 'Deathknight', isAI: true, team: 2, position: { x: 340, y: 270 }, loadout: [],
    });
    knight.deathknightKind = true;
    const game = new GameState([attacker, knight], 9);

    game.setCurrent(knight);
    equal(
      game.makeDeathknightTargetReaction(knight, attacker, 1, false),
      null,
      'Own-turn Deathknight counter'
    );
    equal(knight.deathknightReactionRound, -1, 'Rejected reaction does not consume the counter');

    game.setCurrent(attacker);
    assert(
      game.makeDeathknightTargetReaction(knight, attacker, 1, false),
      'The Deathknight may still counter off-turn'
    );
  }],

  ['reads an active Edgelord dark light as one of its bearer\'s shadows', () => {
    const bearer = new Mage({
      name: 'Bearer',
      isAI: false,
      team: 1,
      position: { x: 400, y: 270 },
      loadout: [],
    });
    const foe = new Mage({
      name: 'Foe',
      isAI: true,
      team: 2,
      position: { x: 400 + 10 * RANGE_UNIT, y: 270 },
      loadout: [],
    });
    const game = new GameState([bearer, foe], 11);
    bearer.hands = ['edgelordLantern'];

    equal(game.isInShadow(foe), false, 'A dormant lantern casts no shadow');
    equal(game.shadowsOf(1).length, 0, 'No pools while dormant');

    bearer.edgelordLanternActive = true;
    equal(game.isInShadow(foe), true, 'Dark light counts as shadow');
    equal(game.shadowsOf(1).length, 1, 'The bearer owns the darkness');
    equal(game.shadowsOf(2).length, 0, 'The enemy team does not');
    equal(game.shadows.length, 0, 'Conjured pools are untouched');
  }],

  ['drags a shadow-chained mage in before judging where it landed', () => {
    const caster = new Mage({
      name: 'Caster',
      isAI: false,
      team: 1,
      position: { x: 300, y: 270 },
      loadout: [],
    });
    const build = (x: number): Mage =>
      new Mage({ name: 'Foe', isAI: true, team: 2, position: { x, y: 270 }, loadout: ['bind'] });
    const spell = getSpell(['bind', 'shadow', 'mind']);
    assert(spell, 'Expected Bind Shadow Mind to be registered.');

    // Standing 4 range out: the 5-range pull lands it inside the pool.
    const swallowed = build(300 + 4 * RANGE_UNIT);
    const inside = new GameState([caster, swallowed], 5);
    inside.addShadow({ x: 300, y: 270 }, 1, 9);
    void spell.cast(inside.effectContext(caster, swallowed, null));
    inside.currentIndex = 1;
    inside.beginTurn();
    assert(swallowed.forgotten().length > 0, 'Swallowed by the dark costs a word');
    equal(swallowed.sanity, swallowed.maxSanity, 'Swallowed costs no sanity');

    // Standing 20 range out: the same pull leaves it stranded outside.
    const stranded = build(300 + 20 * RANGE_UNIT);
    const outside = new GameState([caster, stranded], 5);
    outside.addShadow({ x: 300, y: 270 }, 1, 9);
    void spell.cast(outside.effectContext(caster, stranded, null));
    outside.currentIndex = 1;
    outside.beginTurn();
    equal(stranded.forgotten().length, 0, 'Stranded costs no word');
    assert(stranded.sanity < stranded.maxSanity, 'Stranded takes the chain bite');
    assert(stranded.sanity >= stranded.maxSanity - 4, 'The bite is only 1d4');
  }],

  ['makes a memory-shackled mage forget every word it casts', () => {
    const caster = new Mage({
      name: 'Caster',
      isAI: false,
      team: 1,
      position: { x: 300, y: 270 },
      loadout: [],
    });
    const victim = new Mage({
      name: 'Victim',
      isAI: true,
      team: 2,
      position: { x: 300 + 4 * RANGE_UNIT, y: 270 },
      loadout: ['shatter', 'mind', 'veil'],
    });
    const game = new GameState([caster, victim], 13);
    const shackle = getSpell(['bind', 'mind', 'corrode']);
    const answer = getSpell(['shatter', 'mind']);
    assert(shackle && answer, 'Expected Bind Mind Corrode and Shatter Mind to be registered.');

    void shackle.cast(game.effectContext(caster, victim, null));
    assert(
      victim.statuses.some((status) => status.kind === 'memoryShackle'),
      'The shackle lands'
    );
    equal(victim.forgotten(), [], 'Nothing is forgotten before it acts');

    game.pushStack(game.makeSpellItem(victim, answer, caster, null));
    equal(victim.forgotten().sort(), ['mind', 'shatter'], 'Both words are eaten');
    assert(victim.hasForgotten('mind'), 'Mind is gone');

    game.pushStack(game.makeMeleeItem(victim, caster));
    assert(victim.hasForgotten('melee'), 'A swing is eaten too');
  }],

  ['reels a hooked mage in, paving its wake with the hooker\'s shadows', () => {
    const caster = new Mage({
      name: 'Caster',
      isAI: false,
      team: 1,
      position: { x: 300, y: 270 },
      loadout: [],
    });
    const victim = new Mage({
      name: 'Victim',
      isAI: true,
      team: 2,
      position: { x: 300 + 12 * RANGE_UNIT, y: 270 },
      loadout: [],
    });
    victim.maxHp = 200;
    victim.hp = 200;
    const game = new GameState([caster, victim], 17);
    const spell = getSpell(['bind', 'shadow', 'pierce']);
    assert(spell, 'Expected Bind Shadow Pierce to be registered.');

    void spell.cast(game.effectContext(caster, victim, null));
    assert(victim.isStunned('movement'), 'The hook roots its victim');

    const startX = victim.x;
    game.currentIndex = 1;
    game.beginTurn();
    assert(victim.x < startX, 'The victim is reeled toward the hooker');
    equal(game.shadows.length, 1, 'One shadow per drag');
    equal(game.shadows[0].owner, 1, 'The hooker owns the trail');
    assert(
      Math.hypot(game.shadows[0].x - victim.x, game.shadows[0].y - victim.y) < 1,
      'The shadow is left where the victim came to rest'
    );
    assert(victim.hp < 200, 'The drag draws blood');
  }],

  ['slams a forced move that ends against a wall or the field edge', () => {
    const source = new Mage({
      name: 'Source',
      isAI: false,
      team: 1,
      position: { x: FIELD.x + 200, y: FIELD.y + 200 },
      loadout: [],
    });
    const build = (x: number, y: number): Mage => {
      const m = new Mage({ name: 'Target', isAI: true, team: 2, position: { x, y }, loadout: [] });
      m.maxHp = 200;
      m.hp = 200;
      return m;
    };

    const open = build(FIELD.x + 400, FIELD.y + 200);
    const clear = new GameState([source, open], 19);
    equal(clear.forceMove(source, open, { x: FIELD.x + 500, y: FIELD.y + 200 }), false, 'Open ground never slams');
    equal(open.hp, 200, 'Open ground costs nothing');

    const pinned = build(FIELD.x + 400, FIELD.y + 200);
    const walled = new GameState([source, pinned], 19);
    equal(
      walled.forceMove(source, pinned, { x: FIELD.x + FIELD.w + 400, y: FIELD.y + 200 }),
      true,
      'The field edge is immovable'
    );
    assert(pinned.hp <= 200 - 2 && pinned.hp >= 200 - 12, 'The slam is 2d6 shatter');
  }],

  ['makes a phased mage unreachable by damage, afflictions and targeting', () => {
    const caster = new Mage({
      name: 'Caster',
      isAI: false,
      team: 1,
      position: { x: 300, y: 270 },
      loadout: [],
    });
    const victim = new Mage({
      name: 'Victim',
      isAI: true,
      team: 2,
      position: { x: 300 + 4 * RANGE_UNIT, y: 270 },
      loadout: [],
    });
    const game = new GameState([caster, victim], 23);
    const banish = getSpell(['shadow', 'veil', 'curse']);
    const bolt = getSpell(['shatter', 'mind']);
    assert(banish && bolt, 'Expected Shadow Veil Curse and Shatter Mind to be registered.');
    equal(bolt.targeting, 'enemy', 'The probe spell targets an enemy');

    void banish.cast(game.effectContext(caster, victim, null));
    assert(game.isPhasedOut(victim), 'The victim phases out');

    const ctx = game.effectContext(caster, victim, null);
    equal(dealDamage(ctx, victim, { amount: 50, type: 'shadow' }), 0, 'Damage is voided');
    equal(victim.hp, victim.maxHp, 'It takes nothing');
    applyStun(ctx, victim, { duration: 3, type: 'full' });
    applyDebuff(ctx, victim, { name: 'Test', duration: 3, mods: { moveRange: -2 } });
    equal(
      victim.statuses.filter((status) => status.kind !== 'phaseOut'),
      [],
      'No affliction sticks'
    );
    equal(game.isValidSpellTarget(bolt, caster, victim), false, 'It cannot be targeted');
    equal(game.canMelee(caster, victim), false, 'It cannot be struck');

    // The dark holds it for exactly one cycle, then hands it back.
    game.currentIndex = 1;
    game.beginTurn();
    equal(game.isPhasedOut(victim), false, 'The dark gives it back after one cycle');
    assert(victim.actions.main > 0, 'And it acts again');
  }],

  ['ages statuses while phased but skips the phased mage\'s upkeep', () => {
    const walker = new Mage({
      name: 'Walker',
      isAI: false,
      team: 1,
      position: { x: 300, y: 270 },
      loadout: [],
    });
    const foe = new Mage({
      name: 'Foe',
      isAI: true,
      team: 2,
      position: { x: 900, y: 270 },
      loadout: [],
    });
    const game = new GameState([walker, foe], 37);

    // A rot planted before the phase must age without ever biting.
    applyDot(game.effectContext(foe, walker, null), walker, {
      name: 'Test Rot',
      duration: 4,
      damage: { amount: 5, type: 'corrosive' },
    });
    const dissolve = getSpell(['shadow', 'veil', 'corrode']);
    assert(dissolve, 'Expected Shadow Veil Corrode to be registered.');
    void dissolve.cast(game.effectContext(walker, walker, null));
    assert(game.isPhasedOut(walker), 'The caster dissolves');
    assert(game.isPhaseWalking(walker), 'And walks through everything');

    const rot = walker.statuses.find((status) => status.kind === 'dot');
    assert(rot, 'The rot is present');
    equal(rot.duration, 4, 'It starts at four');

    game.currentIndex = 0;
    game.beginTurn();
    equal(walker.hp, walker.maxHp, 'Upkeep is skipped, so the rot never bites');
    equal(rot.duration, 3, 'But it still ages');
    equal(game.isPhasedOut(walker), false, 'And the phase is spent after one cycle');
  }],

  ['echoes half of a threaded wound to every other threaded victim', () => {
    const caster = new Mage({
      name: 'Caster',
      isAI: false,
      team: 1,
      position: { x: 300, y: 270 },
      loadout: [],
    });
    const build = (name: string, x: number): Mage => {
      const m = new Mage({ name, isAI: true, team: 2, position: { x, y: 270 }, loadout: [] });
      m.maxHp = 200;
      m.hp = 200;
      m.maxSanity = 200;
      m.sanity = 200;
      return m;
    };
    const first = build('First', 400);
    const second = build('Second', 500);
    const bystander = build('Bystander', 600);
    const game = new GameState([caster, first, second, bystander], 29);

    for (const marked of [first, second]) {
      marked.statuses.push({
        key: 'threadMark',
        name: 'Threaded',
        kind: 'threadMark',
        duration: 3,
        ownerTeam: 1,
        sharePct: 0.5,
      });
    }

    dealDamage(game.effectContext(caster, first, null), first, {
      amount: 10,
      type: 'pierce',
    });
    equal(second.sanity, 195, 'The thread echoes half as mill');
    equal(bystander.sanity, 200, 'An unthreaded body feels nothing');
    equal(bystander.hp, 200, 'And takes no damage');
  }],

  ['lets a swelling fuse be rushed down by acting', () => {
    const caster = new Mage({
      name: 'Caster',
      isAI: false,
      team: 1,
      position: { x: 300, y: 270 },
      loadout: [],
    });
    const victim = new Mage({
      name: 'Victim',
      isAI: true,
      team: 2,
      position: { x: 400, y: 270 },
      loadout: ['shatter', 'mind'],
    });
    victim.maxSanity = 300;
    victim.sanity = 300;
    const game = new GameState([caster, victim], 31);
    const fuse = getSpell(['mind', 'shatter', 'curse']);
    const answer = getSpell(['shatter', 'mind']);
    assert(fuse && answer, 'Expected Mind Shatter Curse and Shatter Mind to be registered.');

    void fuse.cast(game.effectContext(caster, victim, null));
    const planted = victim.statuses.find((status) => status.kind === 'mindFuse');
    assert(planted && planted.kind === 'mindFuse', 'The fuse is planted');
    equal(planted.duration, 10, 'It starts long');

    game.pushStack(game.makeSpellItem(victim, answer, caster, null));
    equal(planted.duration, 9, 'A declared spell burns it down early');
    game.pushStack(game.makeMeleeItem(victim, caster));
    equal(planted.duration, 8, 'So does a swing');

    game.currentIndex = 1;
    game.beginTurn();
    equal(planted.ticks, 1, 'Surviving a turn banks a charge');
  }],

  ['keeps the Dagger of Shadow veil absolute and unbreakable in shadow', () => {
    const holder = new Mage({
      name: 'Holder',
      isAI: false,
      team: 1,
      position: { x: 400, y: 270 },
      loadout: [],
    });
    const zombie = new Mage({
      name: 'Zombie',
      isAI: true,
      team: 2,
      position: { x: 400 + MELEE_RANGE - 4, y: 270 },
      loadout: [],
    });
    const game = new GameState([holder, zombie], 41);
    holder.hands = ['shadowDagger'];

    // Out of shadow the blade hides nothing.
    equal(game.isUntargetable(holder, zombie), false, 'No shadow, no veil');

    game.addShadow({ x: 400, y: 270 }, 1, 9);
    game.currentIndex = 0;
    game.beginTurn();
    assert(game.hasShadowDaggerVeil(holder), 'The toll buys the veil');
    equal(game.effectiveInvisibility(holder)?.mode, 'full', 'It is a true veil, not a half one');

    // Absolute: hidden even from a body standing right on top of it.
    equal(game.isUntargetable(holder, zombie), true, 'Untargetable at melee range');
    equal(game.canMelee(zombie, holder), false, 'The zombie cannot swing at it');
    equal(game.isVeiled(holder), true, 'Every stealth check sees it');

    // Unbreakable: neither proximity nor its own attack strips it.
    game.breakProximityVeils();
    equal(game.isUntargetable(holder, zombie), true, 'Proximity does not collapse it');
    dealDamage(game.effectContext(holder, zombie, null), zombie, {
      amount: 9,
      type: 'shadow',
    });
    equal(game.isUntargetable(holder, zombie), true, 'Cutting someone down does not reveal it');

    // It ends the moment the blade leaves the dark.
    holder.x = 1200;
    equal(game.hasShadowDaggerVeil(holder), false, 'Stepping out of shadow ends it');
  }],

  ['gates Shadow Mind Corrode on standing near one of your own shadows', () => {
    const caster = new Mage({
      name: 'Caster',
      isAI: false,
      team: 1,
      position: { x: 300, y: 270 },
      loadout: [],
    });
    const foe = new Mage({
      name: 'Foe',
      isAI: true,
      team: 2,
      position: { x: 900, y: 270 },
      loadout: [],
    });
    const game = new GameState([caster, foe], 43);
    const spell = getSpell(['shadow', 'mind', 'corrode']);
    assert(spell, 'Expected Shadow Mind Corrode to be registered.');
    equal(spell.range, Infinity, 'Distance from the caster is irrelevant');

    equal(game.isValidSpellTarget(spell, caster, foe), false, 'No shadow, no target');

    // A pool of the ENEMY team must not open it up.
    game.addShadow({ x: 900, y: 270 }, 2, 9);
    equal(game.isValidSpellTarget(spell, caster, foe), false, 'Their dark does not count');

    game.shadows = [];
    game.addShadow({ x: 900 + 4 * RANGE_UNIT, y: 270 }, 1, 9);
    equal(game.isValidSpellTarget(spell, caster, foe), true, 'Within 5 of your own pool');

    game.shadows = [];
    game.addShadow({ x: 900 + 40 * RANGE_UNIT, y: 270 }, 1, 9);
    equal(game.isValidSpellTarget(spell, caster, foe), false, 'Too far from any pool');
  }],

  ['splits a d20 between body and mind and marks whichever half bit deep', () => {
    const caster = new Mage({
      name: 'Caster',
      isAI: false,
      team: 1,
      position: { x: 300, y: 270 },
      loadout: [],
    });
    const foe = new Mage({
      name: 'Foe',
      isAI: true,
      team: 2,
      position: { x: 400, y: 270 },
      loadout: [],
    });
    foe.maxHp = 200;
    foe.hp = 200;
    foe.maxSanity = 200;
    foe.sanity = 200;
    const game = new GameState([caster, foe], 47);
    game.addShadow({ x: 400 + 4 * RANGE_UNIT, y: 270 }, 1, 9);
    const spell = getSpell(['shadow', 'mind', 'corrode']);
    assert(spell, 'Expected Shadow Mind Corrode to be registered.');

    void spell.cast(game.effectContext(caster, foe, null));
    const rot = 200 - foe.hp;
    const mill = 200 - foe.sanity;
    equal(rot + mill, 20, 'The d20 is split whole between the two pools');
    equal(
      foe.statuses.some((status) => status.kind === 'debuff' && status.name === 'Divided Rot'),
      rot >= 6,
      'The slow tracks the corrosive half'
    );
    equal(foe.isStunned('movement'), mill >= 6, 'The root tracks the mill half');
  }],

  ['seals a target away from its own side but not from the sealer', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 300, y: 270 }, loadout: [] });
    const ally = new Mage({ name: 'Ally', isAI: false, team: 1, position: { x: 320, y: 270 }, loadout: [] });
    const foe = new Mage({ name: 'Foe', isAI: true, team: 2, position: { x: 400, y: 270 }, loadout: [] });
    const foeMate = new Mage({ name: 'Foe Mate', isAI: true, team: 2, position: { x: 420, y: 270 }, loadout: [] });
    foe.maxHp = 200;
    foe.hp = 200;
    const game = new GameState([caster, ally, foe, foeMate], 11);
    const spell = getSpell(['shadow', 'veil', 'bind']);
    assert(spell, 'Expected Shadow Veil Bind to be registered.');

    void spell.cast(game.effectContext(caster, foe, null));

    assert(foe.hp < 200, 'The cast deals its opening 2d6');
    equal(foe.isStunned('full'), true, 'The seal fully stuns');
    equal(foe.isStunned('movement'), true, 'The seal roots');
    equal(game.isUntargetable(foe, foeMate), true, "Its own side cannot reach it");
    equal(game.isUntargetable(foe, caster), false, 'The sealer can still reach it');
    equal(game.isUntargetable(foe, ally), false, "The sealer's allies can still reach it");
  }],

  ['escalates the rotting ground and halves healing inside it', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 300, y: 270 }, loadout: [] });
    const victim = new Mage({ name: 'Victim', isAI: true, team: 2, position: { x: 340, y: 270 }, loadout: [] });
    victim.maxHp = 400;
    victim.hp = 400;
    const game = new GameState([caster, victim], 23);
    const spell = getSpell(['shadow', 'corrode', 'curse']);
    assert(spell, 'Expected Shadow Corrode Curse to be registered.');

    void spell.cast(game.effectContext(caster, null, { x: 340, y: 270 }));
    const zone = game.hazardZones[0];
    assert(zone, 'Expected the death zone to be raised.');
    equal(zone.damageSpecs, ['1d4', '1d6', '1d8', '1d10'], 'It walks 1d4 up to 1d10');
    equal(game.healMultiplierAt(victim.pos), 0.5, 'Healing inside is halved');
    equal(game.healMultiplierAt({ x: 3000, y: 3000 }), 1, 'Healing outside is untouched');

    // Everything caught is fair game, including the caster's own side.
    caster.x = 340;
    caster.y = 270;
    const before = caster.hp;
    game.currentIndex = 0;
    game.beginTurn();
    assert(caster.hp < before, 'The zone bites its own author too');
  }],

  ['only bites movers in the corroding mist and conceals whoever stands in it', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 300, y: 270 }, loadout: [] });
    const still = new Mage({ name: 'Still', isAI: true, team: 2, position: { x: 500, y: 270 }, loadout: [] });
    const mover = new Mage({ name: 'Mover', isAI: true, team: 2, position: { x: 520, y: 270 }, loadout: [] });
    for (const m of [still, mover]) {
      m.maxHp = 200;
      m.hp = 200;
    }
    const game = new GameState([caster, still, mover], 31);
    const spell = getSpell(['bind', 'veil', 'corrode'], null);
    assert(spell, 'Expected Bind Veil Corrode to be registered.');

    void spell.cast(game.effectContext(caster, null, { x: 510, y: 270 }));
    equal(game.hazardZones.length, 1, 'The mist is raised');
    equal(game.hazardDodgeChance(still), 0.5, 'Standing inside grants the dodge');
    equal(game.hazardDodgeChance(caster), 0, 'Outside the mist there is no dodge');

    still.movedThisTurn = false;
    game.currentIndex = 1;
    game.beginTurn();
    equal(still.hp, 200, 'Holding still inside the mist costs nothing');

    mover.movedThisTurn = true;
    game.currentIndex = 2;
    game.beginTurn();
    assert(mover.hp < 200, 'Moving inside the mist is punished');
  }],

  ['bills strayed distance on the anchor spike and hauls the bearer back', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 300, y: 270 }, loadout: [] });
    const foe = new Mage({ name: 'Foe', isAI: true, team: 2, position: { x: 500, y: 270 }, loadout: [] });
    foe.maxHp = 400;
    foe.hp = 400;
    const game = new GameState([caster, foe], 5);
    const spell = getSpell(['bind', 'shatter', 'pierce']);
    assert(spell, 'Expected Bind Shatter Pierce to be registered.');

    void spell.cast(game.effectContext(caster, foe, null));
    const spike = foe.statuses.find((s) => s.kind === 'anchorSpike');
    assert(spike && spike.kind === 'anchorSpike', 'Expected the spike to be planted.');
    equal(spike.maxDice, 4, 'Four dice is the cap');
    equal(spike.pxPerDie, 2 * RANGE_UNIT, 'One die per 2 range units');

    // Stray a full 8 units: the yank should cap out and drag it home.
    foe.x = spike.x + 8 * RANGE_UNIT;
    foe.hp = 400;
    game.currentIndex = 1;
    game.beginTurn();
    assert(foe.hp <= 400 - 4, 'Straying the full distance grinds for up to 4d6');
    assert(Math.hypot(foe.x - spike.x, foe.y - spike.y) < RANGE_UNIT, 'It is hauled back to the spike');
  }],

  ['repeats pierce damage at the end of the oath-bearer turn', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 300, y: 270 }, loadout: [] });
    const foe = new Mage({ name: 'Foe', isAI: true, team: 2, position: { x: 400, y: 270 }, loadout: [] });
    foe.maxHp = 400;
    foe.hp = 400;
    const game = new GameState([caster, foe], 13);
    const spell = getSpell(['bind', 'curse', 'pierce']);
    assert(spell, 'Expected Bind Curse Pierce to be registered.');

    void spell.cast(game.effectContext(caster, foe, null));
    equal(
      caster.statuses.some((s) => s.kind === 'pierceEcho'),
      true,
      'The oath is sworn on the caster'
    );
    const afterCast = foe.hp;
    game.currentIndex = 0;
    game.endTurn();
    assert(foe.hp < afterCast, 'The opening shot is dealt a second time at turn end');
  }],

  ['reopens the suppurating wound on pierce and caps it at three turns', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 300, y: 270 }, loadout: [] });
    const foe = new Mage({ name: 'Foe', isAI: true, team: 2, position: { x: 400, y: 270 }, loadout: [] });
    foe.maxHp = 400;
    foe.hp = 400;
    const game = new GameState([caster, foe], 17);
    const spell = getSpell(['corrode', 'curse', 'pierce'], null);
    assert(spell, 'Expected Corrode Curse Pierce to be registered.');

    void spell.cast(game.effectContext(caster, foe, null));
    const wound = foe.statuses.find((s) => s.key === 'dot:suppurating-wound');
    assert(wound && wound.kind === 'dot', 'Expected the wound to be applied.');
    equal(wound.escalateSpecs, ['1d6', '1d8', '1d10'], 'It deepens to 1d10 and stops');
    equal(wound.duration, 3, 'It opens at three turns');

    // A heavy pierce hit always extends, but never past the three-turn ceiling.
    wound.duration = 1;
    dealDamage(game.effectContext(caster, foe, null), foe, { amount: 9, type: 'pierce' }, { canMiss: false });
    equal(wound.duration, 2, 'A hit of 6 or more always buys one turn');
    dealDamage(game.effectContext(caster, foe, null), foe, { amount: 9, type: 'pierce' }, { canMiss: false });
    equal(wound.duration, 3, 'It climbs to the ceiling');
    dealDamage(game.effectContext(caster, foe, null), foe, { amount: 9, type: 'pierce' }, { canMiss: false });
    equal(wound.duration, 3, 'The ceiling holds at three turns');
  }],

  ['spreads the silent plague at half duration to either side', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 100, y: 270 }, loadout: [] });
    const host = new Mage({ name: 'Host', isAI: true, team: 2, position: { x: 500, y: 270 }, loadout: [] });
    const neighbour = new Mage({ name: 'Neighbour', isAI: true, team: 2, position: { x: 500 + RANGE_UNIT, y: 270 }, loadout: [] });
    const bystander = new Mage({ name: 'Bystander', isAI: false, team: 1, position: { x: 500 + 2 * RANGE_UNIT, y: 270 }, loadout: [] });
    for (const m of [host, neighbour, bystander]) {
      m.maxHp = 300;
      m.hp = 300;
    }
    const game = new GameState([caster, host, neighbour, bystander], 29);
    const spell = getSpell(['veil', 'corrode', 'curse'], null);
    assert(spell, 'Expected Veil Corrode Curse to be registered.');

    void spell.cast(game.effectContext(caster, host, null));
    equal(host.isInvisible(), true, 'The host is hidden by its own plague');

    game.currentIndex = 1;
    game.beginTurn();
    const carried = (m: Mage) => m.statuses.find((s) => s.key === 'dot:silent-plague');
    const onNeighbour = carried(neighbour);
    const onBystander = carried(bystander);
    assert(onNeighbour, 'It spreads to a nearby enemy');
    assert(onBystander, "It does not care that the bystander is on the caster's side");
    equal(onNeighbour.duration, 2, 'The carrier gets half the remaining duration');
  }],

  ['rots the mind and moves on when the virus empties it', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 300, y: 270 }, loadout: [] });
    const host = new Mage({ name: 'Host', isAI: true, team: 2, position: { x: 400, y: 270 }, loadout: [] });
    const next = new Mage({ name: 'Next', isAI: true, team: 2, position: { x: 400 + RANGE_UNIT, y: 270 }, loadout: [] });
    host.maxHp = 300;
    host.hp = 300;
    host.maxSanity = 2;
    host.sanity = 2;
    const game = new GameState([caster, host, next], 37);
    const spell = getSpell(['mind', 'corrode', 'pierce']);
    assert(spell, 'Expected Mind Corrode Pierce to be registered.');

    void spell.cast(game.effectContext(caster, host, null));
    const virus = host.statuses.find((s) => s.key === 'dot:neural-virus');
    assert(virus && virus.kind === 'dot', 'Expected the virus to take hold.');
    equal(virus.escalateSpecs, ['1d4', '1d6', '1d8', '1d10'], 'It multiplies up to 1d10');
    equal(virus.forgetPerTick, 1, 'Every tick costs the host an action');

    game.currentIndex = 1;
    game.beginTurn();
    equal(host.sanity, 0, 'The first tick empties a 2-sanity mind');
    assert(
      next.statuses.some((s) => s.key === 'dot:neural-virus'),
      'A broken mind cannot hold the virus, so it jumps'
    );
  }],

  ['ignores concealment when sniping and pays out either way', () => {
    const makeBoard = () => {
      const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 100, y: 270 }, loadout: [] });
      const foe = new Mage({ name: 'Foe', isAI: true, team: 2, position: { x: 100 + 12 * RANGE_UNIT, y: 270 }, loadout: [] });
      foe.maxHp = 400;
      foe.hp = 400;
      return { caster, foe, game: new GameState([caster, foe], 41) };
    };
    const spell = getSpell(['veil', 'shatter', 'pierce']);
    assert(spell, 'Expected Veil Shatter Pierce to be registered.');
    equal(spell.ignoresStealth, true, 'The shot is allowed to pick a hidden target');

    const veiled = makeBoard();
    applyInvisibility(veiled.game.effectContext(veiled.foe, veiled.foe, null), veiled.foe, {
      duration: 3,
      mode: 'full',
    });
    equal(
      veiled.game.isValidSpellTarget(spell, veiled.caster, veiled.foe),
      true,
      'A fully veiled foe at long range is still a legal target'
    );
    void spell.cast(veiled.game.effectContext(veiled.caster, veiled.foe, null));
    equal(veiled.game.isVeiled(veiled.foe), false, 'Breaking the veil strips it');
    equal(veiled.caster.isInvisible(), false, 'Breaking a veil grants the sniper none');

    const bare = makeBoard();
    void spell.cast(bare.game.effectContext(bare.caster, bare.foe, null));
    assert(bare.foe.hp < 400, 'The shot still lands on an unveiled target');
    equal(bare.caster.isInvisible(), true, 'With no veil to break, the sniper takes cover');
  }],

  ['pulverises with Shadow Shatter Corrode without moving anybody', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 200, y: 270 }, loadout: [] });
    const focus = new Mage({ name: 'Focus', isAI: true, team: 2, position: { x: 400, y: 270 }, loadout: [] });
    const bystander = new Mage({ name: 'Bystander', isAI: true, team: 2, position: { x: 400 + 2 * RANGE_UNIT, y: 270 }, loadout: [] });
    const ally = new Mage({ name: 'Ally', isAI: false, team: 1, position: { x: 400 - 2 * RANGE_UNIT, y: 270 }, loadout: [] });
    for (const m of [focus, bystander, ally]) {
      m.maxHp = 400;
      m.hp = 400;
    }
    const game = new GameState([caster, focus, bystander, ally], 19);
    const spell = getSpell(['shadow', 'shatter', 'corrode']);
    assert(spell, 'Expected Shadow Shatter Corrode to be registered.');
    const bystanderSpot = { x: bystander.x, y: bystander.y };

    void spell.cast(game.effectContext(caster, focus, null));

    assert(focus.hp <= 400 - 2, 'The focus eats the full 2d10');
    equal(focus.isStunned('full'), true, 'The focus is stunned for a turn');
    assert(bystander.hp < 400, 'The shockwave catches nearby enemies');
    assert(ally.hp < 400, 'Black does not check sides');
    equal(game.shadows.length, 0, 'It is destruction, not space control — no pool is left');
    equal(
      { x: bystander.x, y: bystander.y },
      bystanderSpot,
      'Nobody is dragged anywhere'
    );
  }],

  ['drives Shatter Corrode Pierce straight through armour and resistance', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 300, y: 270 }, loadout: [] });
    const tank = new Mage({ name: 'Tank', isAI: true, team: 2, position: { x: 340, y: 270 }, loadout: [] });
    tank.maxHp = 400;
    tank.hp = 400;
    tank.intrinsicImmuneTypes = ['shatter', 'pierce'];
    tank.intrinsicResistTypes = ['shatter', 'pierce'];
    const game = new GameState([caster, tank], 43);
    const spell = getSpell(['shatter', 'corrode', 'pierce'], null);
    assert(spell, 'Expected Shatter Corrode Pierce to be registered.');

    void spell.cast(game.effectContext(caster, tank, null));
    assert(tank.hp <= 400 - 4, 'Immunity to both damage types does not save it');
  }],

  ['turns the Lightning Shatter clap inward on a roll under 6', async () => {
    const build = (roll: number) => {
      const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 400, y: 270 }, loadout: [] });
      const foe = new Mage({ name: 'Foe', isAI: true, team: 2, position: { x: 400 + RANGE_UNIT, y: 270 }, loadout: [] });
      const nearby = new Mage({ name: 'Nearby', isAI: false, team: 1, position: { x: 400 + 2 * RANGE_UNIT, y: 270 }, loadout: [] });
      for (const m of [caster, foe, nearby]) {
        m.maxHp = 500;
        m.hp = 500;
      }
      const game = new GameState([caster, foe, nearby], 9);
      game.spellRollThisCast = roll;
      return { caster, foe, nearby, game };
    };
    const spell = getSpell(['lightning', 'shatter']);
    assert(spell, 'Expected Lightning Shatter to be registered.');

    const strong = build(20);
    await spell.cast(strong.game.effectContext(strong.caster, strong.foe, null));
    equal(strong.foe.isStunned('full'), true, 'A strong clap stuns the enemy');
    equal(strong.caster.isStunned('full'), false, 'And leaves the caster standing');
    assert(strong.nearby.hp < 500, 'The splash reaches nearby bodies on either side');

    const weak = build(1);
    await spell.cast(weak.game.effectContext(weak.caster, weak.foe, null));
    equal(weak.caster.isStunned('full'), true, 'A feeble clap stuns its own caster');
    equal(weak.foe.isStunned('full'), false, 'And nobody else');
    assert(weak.foe.hp < 500, 'The damage still lands either way');
  }],

  ['weaves a Lightning Corrode web that re-crosses bodies it already holds', async () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 150, y: 150 }, loadout: [] });
    // Four bodies in a tight clump, every one within reach of every other.
    const clump = [0, 1, 2, 3].map((i) => {
      const m = new Mage({
        name: `Body ${i}`,
        isAI: i > 0,
        team: i === 3 ? 1 : 2,
        position: { x: 500 + (i % 2) * 2 * RANGE_UNIT, y: 250 + Math.floor(i / 2) * 2 * RANGE_UNIT },
        loadout: [],
      });
      m.maxHp = 900;
      m.hp = 900;
      return m;
    });
    const game = new GameState([caster, ...clump], 15);
    game.spellRollThisCast = 20;
    const spell = getSpell(['lightning', 'corrode']);
    assert(spell, 'Expected Lightning Corrode to be registered.');

    await spell.cast(game.effectContext(caster, clump[0], null));

    // Every pair among the four is crossed exactly once, allies included.
    equal(game.hazardZones.length, 6, 'One line per pair, never a duplicate');
    for (const body of clump) assert(body.hp < 900, 'Everything in the clump conducts');
    assert(clump[3].hp < 900, "Your own ally is part of the web");
    // The wave rolls once but lands per arc, so the body every node points back
    // at takes it more often than the nodes themselves do.
    const target = 900 - clump[0].hp;
    const others = clump.slice(1).map((m) => 900 - m.hp);
    assert(target > Math.max(...others), 'The re-crossed target is struck by the most arcs');

    const scar = game.hazardZones[0];
    assert(scar.toX != null && scar.toY != null, 'Scars are laid as lines between bodies');
    equal(scar.damageSpecs, ['1d3'], 'Scars tick for 1d3 corrosive');
    // However many lines overlap a body, the cast leaves one merged field.
    equal(new Set(game.hazardZones.map((z) => z.groupId)).size, 1, 'The web is a single field');
    const standing = clump[3];
    const overlapping = game.hazardZones.filter(
      (z) => hazardDistance(z, standing.pos) <= z.radius
    ).length;
    assert(overlapping > 1, 'It is standing where several lines cross');
    standing.hp = 900;
    game.currentIndex = game.mages.indexOf(standing);
    game.beginTurn();
    assert(900 - standing.hp <= 3, 'Crossed lines still only tick once, for a single 1d3');
  }],

  ['always runs exactly two Lightning Corrode waves, whatever the roll', async () => {
    const countWaves = async (roll: number) => {
      const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 150, y: 150 }, loadout: [] });
      const clump = [0, 1, 2, 3].map((i) => {
        const m = new Mage({
          name: `Body ${i}`,
          isAI: true,
          team: 2,
          position: { x: 500 + (i % 2) * RANGE_UNIT, y: 250 + Math.floor(i / 2) * RANGE_UNIT },
          loadout: [],
        });
        m.maxHp = 9000;
        m.hp = 9000;
        return m;
      });
      const game = new GameState([caster, ...clump], 5);
      game.spellRollThisCast = roll;
      let waves = 0;
      game.log = (line: string) => {
        if (line.includes('Lightning Corrode wave')) waves += 1;
      };
      await getSpell(['lightning', 'corrode'])!.cast(game.effectContext(caster, clump[0], null));
      return waves;
    };

    equal(await countWaves(8), 2, 'A weak cast still splits twice');
    equal(await countWaves(20), 2, 'So does a strong one');
    equal(await countWaves(40), 2, 'The roll buys reach, never more waves');
  }],

  ['gathers dark with every Lightning Shadow jump', async () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 300, y: 270 }, loadout: [] });
    const first = new Mage({ name: 'First', isAI: true, team: 2, position: { x: 400, y: 270 }, loadout: [] });
    const second = new Mage({ name: 'Second', isAI: true, team: 2, position: { x: 400 + 2 * RANGE_UNIT, y: 270 }, loadout: [] });
    for (const m of [first, second]) {
      m.maxHp = 900;
      m.hp = 900;
    }
    const game = new GameState([caster, first, second], 21);
    game.spellRollThisCast = 20;
    const spell = getSpell(['lightning', 'shadow']);
    assert(spell, 'Expected Lightning Shadow to be registered.');

    await spell.cast(game.effectContext(caster, first, null));
    equal(game.shadows.length, 2, 'Each body struck is left standing in a fresh pool');
    // 2d6 for the first, 2d6 plus a gathered 1d6 for the second.
    assert(900 - second.hp >= 3, 'The second jump carries the gathered dark');
  }],

  ['passes a share of every wound down a Lightning Curse conduit', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 300, y: 270 }, loadout: [] });
    const conduit = new Mage({ name: 'Conduit', isAI: true, team: 2, position: { x: 400, y: 270 }, loadout: [] });
    const neighbour = new Mage({ name: 'Neighbour', isAI: true, team: 2, position: { x: 400 + RANGE_UNIT, y: 270 }, loadout: [] });
    for (const m of [conduit, neighbour]) {
      m.maxHp = 500;
      m.hp = 500;
    }
    const game = new GameState([caster, conduit, neighbour], 27);
    game.spellRollThisCast = 20;
    const spell = getSpell(['lightning', 'curse']);
    assert(spell, 'Expected Lightning Curse to be registered.');
    equal(spell.targeting, 'any', 'You may spend an ally as the conductor');

    void spell.cast(game.effectContext(caster, conduit, null));
    const storm = conduit.statuses.find((s) => s.kind === 'stormConduit');
    assert(storm && storm.kind === 'stormConduit', 'Expected the conduit to be applied.');
    equal(storm.duration, 3, 'It holds for three turns');

    game.spellRollThisCast = 0;
    dealDamage(game.effectContext(caster, conduit, null), conduit, { amount: 10, type: 'pierce' }, { canMiss: false });
    assert(neighbour.hp < 500, 'The wound arcs onward to whoever stands nearby');
  }],

  ['roots everything a Lightning Bind arc touches, either side', async () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 300, y: 270 }, loadout: [] });
    const foe = new Mage({ name: 'Foe', isAI: true, team: 2, position: { x: 400, y: 270 }, loadout: [] });
    const ally = new Mage({ name: 'Ally', isAI: false, team: 1, position: { x: 400 + 2 * RANGE_UNIT, y: 270 }, loadout: [] });
    for (const m of [foe, ally]) {
      m.maxHp = 500;
      m.hp = 500;
    }
    const game = new GameState([caster, foe, ally], 33);
    game.spellRollThisCast = 20;
    const spell = getSpell(['lightning', 'bind']);
    assert(spell, 'Expected Lightning Bind to be registered.');

    await spell.cast(game.effectContext(caster, foe, null));
    equal(foe.isStunned('movement'), true, 'The named enemy is rooted');
    assert(ally.hp < 500, 'The arc does not spare your own line');
    equal(ally.isStunned('movement'), true, 'And roots it too');
  }],

  ['grows the Lightning Shatter Pierce blowout risk with every body speared', async () => {
    const lane = (count: number, seed: number) => {
      const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 200, y: 270 }, loadout: [] });
      const row = Array.from({ length: count }, (_, i) => {
        const m = new Mage({
          name: `Body ${i}`,
          isAI: true,
          team: 2,
          position: { x: 200 + (i + 1) * 2 * RANGE_UNIT, y: 270 },
          loadout: [],
        });
        m.maxHp = 9000;
        m.hp = 9000;
        return m;
      });
      caster.maxHp = 9000;
      caster.hp = 9000;
      const game = new GameState([caster, ...row], seed);
      game.spellRollThisCast = 20;
      return { caster, row, game };
    };
    const spell = getSpell(['lightning', 'shatter', 'pierce']);
    assert(spell, 'Expected Lightning Shatter Pierce to be registered.');

    const one = lane(1, 4);
    await spell.cast(one.game.effectContext(one.caster, null, { x: 1200, y: 270 }));
    assert(one.row[0].hp < 9000, 'It spears everything standing in the lane');
    equal(one.row[0].isStunned('full'), true, 'And stuns what it passes through');

    // Across many seeds a long lane must blow out more often than a single body.
    let shortLane = 0;
    let longLane = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const a = lane(1, seed);
      await spell.cast(a.game.effectContext(a.caster, null, { x: 1200, y: 270 }));
      if (a.caster.hp < 9000) shortLane += 1;

      const b = lane(5, seed);
      await spell.cast(b.game.effectContext(b.caster, null, { x: 1200, y: 270 }));
      if (b.caster.hp < 9000) longLane += 1;
    }
    assert(longLane > shortLane, `Risk must climb with bodies pierced (${shortLane} vs ${longLane})`);
  }],

  ['ricochets Lightning Shadow Pierce around its own shadow and bills the ride', async () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 600, y: 270 }, loadout: [] });
    const bystander = new Mage({ name: 'Bystander', isAI: true, team: 2, position: { x: 600 + 3 * RANGE_UNIT, y: 270 }, loadout: [] });
    caster.maxHp = 9000;
    caster.hp = 9000;
    bystander.maxHp = 9000;
    bystander.hp = 9000;
    const game = new GameState([caster, bystander], 7);
    game.spellRollThisCast = 20;
    const spell = getSpell(['lightning', 'shadow', 'pierce']);
    assert(spell, 'Expected Lightning Shadow Pierce to be registered.');
    const start = { x: caster.x, y: caster.y };
    let bounces = 0;
    const log = game.log.bind(game);
    game.log = (line: string) => {
      const m = /ricochets (\d+) time/.exec(line);
      if (m) bounces = Number(m[1]);
      log(line);
    };

    await spell.cast(game.effectContext(caster, null, { x: 1200, y: 270 }));

    assert(game.shadows.length >= 0, 'The arena shadow is created and may shatter');
    assert(bounces >= 1, 'It ricochets at least once off the wall of its own shadow');
    assert(
      Math.hypot(caster.x - start.x, caster.y - start.y) > 1,
      'The caster is carried somewhere else entirely'
    );
    assert(bystander.hp < 9000, 'Anything the ride passes over is grazed');
  }],

  ['spares black and minion units from a field-wide desecration', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 300, y: 270 }, loadout: ['desecrate'] });
    const beast = new Mage({ name: 'Beast', isAI: true, team: 2, position: { x: 400, y: 270 }, loadout: [] });
    applyEnemyTraits(beast, 'zombie', new Dice(3));
    const ally = new Mage({ name: 'Ally', isAI: false, team: 1, position: { x: 340, y: 270 }, loadout: [] });
    const blackBeast = new Mage({ name: 'Black Beast', isAI: true, team: 2, position: { x: 440, y: 270 }, loadout: ['curse', 'drain'] });
    applyEnemyTraits(blackBeast, 'zombie', new Dice(3));
    for (const m of [beast, ally, blackBeast]) {
      m.maxHp = 400;
      m.hp = 400;
    }
    const game = new GameState([caster, beast, ally, blackBeast], 11);
    const spell = getSpell(['desecrate']);
    assert(spell, 'Expected Desecrate to be registered.');

    void spell.cast(game.effectContext(caster, null, null));
    equal(game.desecrations.length, 1, 'The law is laid over the whole board');
    equal(game.isDesecrationAffected(beast), true, 'A wild creature is fair game');
    equal(game.isDesecrationAffected(ally), false, 'Minions are spared');
    equal(game.isDesecrationAffected(blackBeast), false, 'So is anything black');

    for (const m of [beast, ally, blackBeast]) {
      game.currentIndex = game.mages.indexOf(m);
      game.beginTurn();
    }
    assert(beast.hp < 400, 'The creature rots wherever it stands');
    equal(ally.hp, 400, 'The minion is untouched');
    equal(blackBeast.hp, 400, 'The black creature is untouched');
  }],

  ['refuses all healing on desecrated ground and hands it back when tithed', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 300, y: 270 }, loadout: ['desecrate'] });
    const beast = new Mage({ name: 'Beast', isAI: true, team: 2, position: { x: 400, y: 270 }, loadout: [] });
    applyEnemyTraits(beast, 'zombie', new Dice(3));
    beast.maxHp = 400;
    beast.hp = 100;
    caster.maxHp = 400;
    caster.hp = 100;
    const game = new GameState([caster, beast], 13);

    // A blanket law stops mending outright.
    void getSpell(['desecrate'])!.cast(game.effectContext(caster, null, null));
    heal(game.effectContext(caster, beast, null), beast, 50);
    equal(beast.hp, 100, 'Nothing mends on unhallowed ground');

    // The tithe steals it instead of blocking it.
    const tithed = new GameState([caster, beast], 13);
    caster.hp = 100;
    beast.hp = 100;
    void getSpell(['desecrate', 'curse', 'drain'])!.cast(tithed.effectContext(caster, null, null));
    heal(tithed.effectContext(caster, beast, null), beast, 50);
    equal(beast.hp, 100, 'The victim still gains nothing');
    assert(caster.hp > 100, 'Its healing is handed to the desecrator');
  }],

  ['moves the Last Rites grave onto an affected corpse, once a round', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 300, y: 270 }, loadout: ['desecrate'] });
    const first = new Mage({ name: 'First', isAI: true, team: 2, position: { x: 900, y: 150 }, loadout: [] });
    const second = new Mage({ name: 'Second', isAI: true, team: 2, position: { x: 1100, y: 400 }, loadout: [] });
    applyEnemyTraits(first, 'zombie', new Dice(3));
    applyEnemyTraits(second, 'zombie', new Dice(4));
    const game = new GameState([caster, first, second], 21);
    void getSpell(['desecrate', 'curse', 'death'])!.cast(game.effectContext(caster, null, { x: 400, y: 270 }));
    equal(game.desecrationFields.length, 1, 'The grave is dug');

    dealDamage(game.effectContext(caster, first, null), first, dmg(9999, 'typeless'));
    const grave = game.desecrationFields[0];
    equal({ x: grave.x, y: grave.y }, { x: first.x, y: first.y }, 'It moves to the first corpse');

    dealDamage(game.effectContext(caster, second, null), second, dmg(9999, 'typeless'));
    equal({ x: grave.x, y: grave.y }, { x: first.x, y: first.y }, 'But only once a round');
  }],

  ['reaches with Shadow Pierce from any friendly shadow, never an enemy\'s', () => {
    const R = (units: number): number => units * RANGE_UNIT;
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 200, y: 270 }, loadout: ['shadow', 'pierce'] });
    const ally = new Mage({ name: 'Ally', isAI: false, team: 1, position: { x: 700, y: 150 }, loadout: [] });
    const near = new Mage({ name: 'Near', isAI: true, team: 2, position: { x: 200 + R(4), y: 270 }, loadout: [] });
    const byAlly = new Mage({ name: 'By ally', isAI: true, team: 2, position: { x: 700 + R(4), y: 150 }, loadout: [] });
    const lone = new Mage({ name: 'Lone', isAI: true, team: 2, position: { x: 1100, y: 420 }, loadout: [] });
    const game = new GameState([caster, ally, near, byAlly, lone], 5);
    const spell = getSpell(['shadow', 'pierce'], caster.spellClass);
    assert(spell, 'Expected Shadow Pierce to be registered.');
    assert(game.isValidSpellTarget(spell, caster, near), 'from the caster\'s own shadow');
    assert(game.isValidSpellTarget(spell, caster, byAlly), 'from a teammate\'s shadow');
    assert(!game.isValidSpellTarget(spell, caster, lone), 'not beyond every shadow');
    game.addShadow({ x: 1100, y: 420 - R(2) }, 2);
    assert(!game.isValidSpellTarget(spell, caster, lone), 'never from an enemy\'s pool');
    game.addShadow({ x: 1100 - R(5), y: 420 }, 1);
    assert(game.isValidSpellTarget(spell, caster, lone), 'from a pool of your side');
  }],

  ['prices the cast odds the way the roll resolves them', () => {
    equal(castChance(11, { luck: 0, focused: false }), 0.5, 'd20 vs 11 is even');
    equal(castChance(11, { luck: 3, focused: false }), 0.65, 'luck drags near misses up');
    equal(castChance(11, { luck: 0, focused: true }), 0.75, 'focus keeps the better of two');
    equal(castChance(1, { luck: 0, focused: false }), 1, 'nothing to beat');
    equal(castChance(25, { luck: 0, focused: false }), 0, 'out of reach without luck');
    const gambler = (n: number) => (n <= 3 ? 1 : n >= 18 ? 20 : n);
    equal(castChance(18, { luck: 0, focused: false, face: gambler }), 0.15, 'the curse still hits on 18-20');
    equal(castChance(3, { luck: 0, focused: false, face: gambler }), 0.85, 'but loses 2-3');

    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 300, y: 270 }, loadout: ['fire'] });
    const spell = getSpell(['fire'], caster.spellClass);
    assert(spell?.dc, 'Expected Fire to roll a DC.');
    const odds = spellCastOdds(spell, caster);
    assert(odds, 'A rolled spell has odds');
    equal(odds.dc, spellCastDc(spell, caster), 'the readout and the roll agree on the DC');
  }],

  ['counts which combinations of a rack cast nothing', () => {
    const rack: WordId[] = [...WORD_ORDER.slice(0, 5), 'subtle'];
    const full = rackCoverage(rack, 'objects');
    equal(full.combos, 25, 'five words make 25 combinations; the method is not one of them');
    equal(full.spells + full.blanks.length, full.combos, 'every combination is either a spell or a blank');
    const odd = rackCoverage(['desecrate', 'shadow', 'shatter'], null);
    for (const blank of odd.blanks) equal(getSpell(blank, null), undefined, `${blank.join('+')} really casts nothing`);
    assert(odd.spells < odd.combos, 'god words leave some pairs blank');
  }],

  ['mirrors Desecrate Corrode Death and Desecrate Drain Death but for the lifesteal', () => {
    const corrode = getSpell(['desecrate', 'corrode', 'death']);
    const drain = getSpell(['desecrate', 'drain', 'death']);
    assert(corrode && drain, 'Expected both Death desecrations to be registered.');

    const build = (spell: NonNullable<typeof corrode>) => {
      const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 300, y: 270 }, loadout: ['desecrate'] });
      const beast = new Mage({ name: 'Beast', isAI: true, team: 2, position: { x: 400, y: 270 }, loadout: [] });
      const doomed = new Mage({ name: 'Doomed', isAI: true, team: 2, position: { x: 500, y: 270 }, loadout: [] });
      for (const m of [beast, doomed]) applyEnemyTraits(m, 'zombie', new Dice(3));
      beast.maxHp = 400;
      beast.hp = 400;
      caster.maxHp = 400;
      caster.hp = 200;
      const game = new GameState([caster, beast, doomed], 17);
      void spell.cast(game.effectContext(caster, null, null));
      return { caster, beast, doomed, game };
    };

    const a = build(corrode);
    const b = build(drain);
    equal(
      a.game.desecrations[0].ticks.map((t) => `${t.spec} ${t.type}`),
      b.game.desecrations[0].ticks.map((t) => `${t.spec} ${t.type}`),
      'Identical dice'
    );
    equal(a.game.desecrations[0].roundsLeft, b.game.desecrations[0].roundsLeft, 'Identical duration');
    equal(a.game.desecrations[0].healKinOnDeath, undefined, 'Corrode gives nothing back');
    equal(b.game.desecrations[0].healKinOnDeath, 3, 'Drain heals its own kind');

    // A death anywhere reaps every affected unit under either law.
    dealDamage(a.game.effectContext(a.caster, a.doomed, null), a.doomed, dmg(9999, 'typeless'));
    assert(a.game.reapOn(a.beast) >= 2, 'Any death reaps the affected');
    dealDamage(b.game.effectContext(b.caster, b.doomed, null), b.doomed, dmg(9999, 'typeless'));
    assert(b.caster.hp > 200, 'Only the Drain version pays its caster');
  }],

  ['withers maximum health under Digestion and hands it back after the combat', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 300, y: 270 }, loadout: ['desecrate'] });
    const beast = new Mage({ name: 'Beast', isAI: true, team: 2, position: { x: 400, y: 270 }, loadout: [] });
    applyEnemyTraits(beast, 'zombie', new Dice(3));
    beast.maxHp = 400;
    beast.hp = 400;
    const game = new GameState([caster, beast], 19);
    void getSpell(['desecrate', 'corrode', 'drain'], null)!.cast(game.effectContext(caster, null, null));

    for (let turn = 0; turn < 6; turn++) {
      game.currentIndex = 1;
      game.beginTurn();
    }
    equal(beast.witheredMaxHp, 8, 'It stops biting at the eight-point cap');
    equal(beast.maxHp, 392, 'Maximum health really is gone while it runs');

    beast.resetForNewCombat();
    equal(beast.maxHp, 400, 'The combat ending gives every point back');
    equal(beast.witheredMaxHp, 0, 'And clears the tally');
  }],

  ['seals walkers inside the Desecrate Death sink and unmakes them at its heart', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 200, y: 270 }, loadout: ['desecrate'] });
    const beast = new Mage({ name: 'Beast', isAI: true, team: 2, position: { x: 600, y: 270 }, loadout: [] });
    applyEnemyTraits(beast, 'zombie', new Dice(3));
    beast.maxHp = 400;
    beast.hp = 400;
    const game = new GameState([caster, beast], 23);
    void getSpell(['desecrate', 'death'])!.cast(game.effectContext(caster, null, { x: 600, y: 270 }));
    const field = game.desecrationFields[0];
    assert(field?.sealed, 'Expected a sealed sink.');

    // Walking cannot carry it back out of the circle.
    const bolt = game.makeMoveItem(beast, { x: 600 + 40 * RANGE_UNIT, y: 270 });
    const dest = bolt.targetPoint!;
    assert(
      Math.hypot(dest.x - field.x, dest.y - field.y) <= field.radius + 1,
      'The sink will not let a walker leave'
    );

    // Its turn start costs it a bonus action and its reaction.
    const outside = new Mage({ name: 'Free', isAI: true, team: 2, position: { x: 100, y: 270 }, loadout: [] });
    applyEnemyTraits(outside, 'zombie', new Dice(3));
    outside.beginTurn();
    game.currentIndex = 1;
    game.beginTurn();
    equal(beast.actions.bonus, outside.actions.bonus - 1, 'The sink costs one bonus action');
    equal(beast.reactedThisCycle, true, 'And the reaction with it');

    // A wounded body dragged to the heart is unmade outright.
    beast.hp = 6;
    beast.x = field.x;
    beast.y = field.y;
    game.currentIndex = 1;
    game.beginTurn();
    equal(beast.alive, false, 'Below ten health at the centre is simply death');
  }],

  ['shatters glass doubles into their attackers but never into an area blast', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 300, y: 270 }, loadout: [] });
    const foe = new Mage({ name: 'Foe', isAI: true, team: 2, position: { x: 500, y: 270 }, loadout: [] });
    for (const m of [caster, foe]) {
      m.maxHp = 400;
      m.hp = 400;
    }
    const game = new GameState([caster, foe], 3);
    const spell = getSpell(['bind', 'veil', 'shatter']);
    assert(spell, 'Expected Bind Veil Shatter to be registered.');
    const images = (): number => {
      const status = caster.statuses.find((s) => s.kind === 'mirrorImages');
      return status && status.kind === 'mirrorImages' ? status.images : 0;
    };

    void spell.cast(game.effectContext(caster, caster, null));
    equal(images(), 3, 'The caster is wrapped in three doubles');
    dealDamage(game.effectContext(foe, caster, null), caster, dmg(5, 'pierce'), { aoe: true });
    equal(images(), 3, 'Area effects ignore the doubles');

    let landed = 0;
    for (let i = 0; i < 40 && images() > 0; i++) {
      const before = caster.hp;
      dealDamage(game.effectContext(foe, caster, null), caster, dmg(5, 'pierce'));
      if (caster.hp < before) landed += 1;
    }
    equal(images(), 0, 'Every double is eventually struck');
    equal(caster.statuses.some((s) => s.kind === 'mirrorImages'), false, 'The spent doubles are gone');
    assert(caster.hp === 400 - 5 - landed * 5, 'A struck double costs the attack everything');
    assert(foe.hp < 400, 'Each shattered double cuts its attacker');
    equal(foe.isStunned('movement'), true, 'and pins it');
  }],

  ['trades places with an enemy and leaves it rooted and cursed', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 200, y: 270 }, loadout: [] });
    const foe = new Mage({ name: 'Foe', isAI: true, team: 2, position: { x: 600, y: 300 }, loadout: [] });
    const game = new GameState([caster, foe], 9);
    const spell = getSpell(['bind', 'veil', 'curse']);
    assert(spell, 'Expected Bind Veil Curse to be registered.');

    void spell.cast(game.effectContext(caster, foe, null));
    equal({ x: caster.x, y: caster.y }, { x: 600, y: 300 }, 'The caster takes its place');
    equal({ x: foe.x, y: foe.y }, { x: 200, y: 270 }, "and it takes the caster's");
    equal(foe.isStunned('movement'), true, 'It arrives rooted');
    assert(foe.statuses.some((s) => s.key === 'dot:veiled-exchange'), 'and cursed');
    equal(caster.isInvisible(), true, 'The caster slips into a half veil');

    const anchor = new Mage({ name: 'Anchor', isAI: true, team: 2, position: { x: 900, y: 300 }, loadout: [] });
    anchor.displacementImmune = true;
    const held = new GameState([caster, anchor], 9);
    const spot = { x: caster.x, y: caster.y };
    void spell.cast(held.effectContext(caster, anchor, null));
    equal({ x: caster.x, y: caster.y }, spot, 'An immovable enemy cannot be traded');
    assert(anchor.statuses.some((s) => s.key === 'dot:veiled-exchange'), 'but it is still cursed');
  }],

  ['sets stone a stage per turn, doubles shatter on it, cracks under healing, then shatters', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 200, y: 270 }, loadout: [] });
    const foe = new Mage({ name: 'Foe', isAI: true, team: 2, position: { x: 500, y: 270 }, loadout: [] });
    const foeMate = new Mage({ name: 'Foe Mate', isAI: true, team: 2, position: { x: 500 + 2 * RANGE_UNIT, y: 270 }, loadout: [] });
    for (const m of [foe, foeMate]) {
      m.maxHp = 400;
      m.hp = 400;
    }
    const game = new GameState([caster, foe, foeMate], 21);
    const spell = getSpell(['bind', 'shatter', 'curse']);
    assert(spell, 'Expected Bind Shatter Curse to be registered.');
    const stage = (): number => {
      const status = foe.statuses.find((s) => s.kind === 'petrify');
      return status && status.kind === 'petrify' ? status.stage : 0;
    };

    void spell.cast(game.effectContext(caster, foe, null));
    equal(stage(), 1, 'It starts to stiffen');
    assert(foe.modifier('moveRange') < 0, 'Stage one slows');
    game.currentIndex = 1;
    game.finishCurrentTurn();
    equal(stage(), 2, 'Ending its turn spreads the stone');
    equal(foe.isStunned('movement'), true, 'Stage two roots');
    equal(foe.isStunned('full'), false, 'but does not yet stun');
    game.finishCurrentTurn();
    equal(game.isPetrified(foe), true, 'Stage three is stone');
    equal(foe.isStunned('full'), true, 'Stone cannot act');
    equal(
      dealDamage(game.effectContext(caster, foe, null), foe, dmg(4, 'shatter'), { canMiss: false }),
      8,
      'Stone takes double shatter'
    );
    heal(game.effectContext(caster, foe, null), foe, 1);
    equal(stage(), 2, 'Healing cracks one stage off');
    equal(foe.isStunned('full'), false, 'and frees it from the stone');

    const beforeShatter = foe.hp;
    game.finishCurrentTurn();
    game.finishCurrentTurn();
    equal(foe.statuses.some((s) => s.kind === 'petrify'), false, 'After stone, it shatters');
    assert(foe.hp <= beforeShatter - 3, 'The statue takes 3d6');
    assert(foeMate.hp < 400, 'The shards catch its own side');
    equal(foe.isStunned(), false, 'Nothing of the stone remains');
  }],

  ['rivets the body behind the target to it and drags it along', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 200, y: 270 }, loadout: [] });
    const foe = new Mage({ name: 'Foe', isAI: true, team: 2, position: { x: 500, y: 270 }, loadout: [] });
    const behind = new Mage({ name: 'Behind', isAI: true, team: 2, position: { x: 500 + 3 * RANGE_UNIT, y: 270 }, loadout: [] });
    for (const m of [foe, behind]) {
      m.maxHp = 400;
      m.hp = 400;
    }
    const game = new GameState([caster, foe, behind], 27);
    const spell = getSpell(['bind', 'corrode', 'pierce'], null);
    assert(spell, 'Expected Bind Corrode Pierce to be registered.');

    void spell.cast(game.effectContext(caster, foe, null));
    equal(game.rivetPartner(foe), behind, 'The bolt rivets the next body behind the target');
    equal(game.rivetPartner(behind), foe, 'in both directions');
    assert(behind.hp < 400, 'It is struck on the way through');
    const leash = foe.bodyRadius() + behind.bodyRadius() + 6;
    assert(Math.hypot(behind.x - foe.x, behind.y - foe.y) <= leash + 1, 'and pulled flush');
    for (const m of [foe, behind]) {
      assert(m.statuses.some((s) => s.key === 'dot:rusted-rivet'), `${m.name} rusts`);
    }

    void game.makeMoveItem(foe, { x: 800, y: 400 }).resolve(game);
    assert(Math.hypot(foe.x - 800, foe.y - 400) < 1, 'The target walks where it likes');
    assert(Math.hypot(behind.x - foe.x, behind.y - foe.y) <= leash + 1, 'and drags its partner along');

    const lone = new Mage({ name: 'Lone', isAI: true, team: 2, position: { x: 500, y: 270 }, loadout: [] });
    const alone = new GameState([caster, lone], 27);
    caster.x = 200;
    caster.y = 270;
    void spell.cast(alone.effectContext(caster, lone, null));
    equal(alone.rivetPartner(lone), null, 'With nobody behind it there is nothing to rivet');
    equal(lone.isStunned('movement'), true, 'so it is nailed down');
  }],

  ['steals a countered spell and turns it on its caster', async () => {
    const thief = new Mage({ name: 'Thief', isAI: false, team: 1, position: { x: 300, y: 270 }, loadout: [] });
    const foe = new Mage({ name: 'Foe', isAI: true, team: 2, position: { x: 300 + 6 * RANGE_UNIT, y: 270 }, loadout: [] });
    foe.maxHp = 300;
    foe.hp = 300;
    foe.maxSanity = 300;
    foe.sanity = 300;
    const game = new GameState([thief, foe], 33);
    const steal = getSpell(['veil', 'mind', 'shatter']);
    const pierce = getSpell(['pierce']);
    assert(steal && pierce, 'Expected Veil Mind Shatter and Pierce to be registered.');
    equal(steal.counters, true, 'It counters what it answers');
    equal(game.canCastSpellNow(steal), false, 'With nothing on the stack there is nothing to answer');

    game.counteredItem = game.makeSpellItem(foe, pierce, thief, null);
    await steal.cast(game.effectContext(thief, null, null));
    assert(foe.hp < 300, "The foe's own Pierce is turned on it");
    equal(thief.hp, thief.maxHp, 'The thief is untouched');

    game.counteredItem = game.makeMeleeItem(foe, thief);
    const sanity = foe.sanity;
    await steal.cast(game.effectContext(thief, null, null));
    assert(foe.sanity < sanity, 'A countered swing costs its swinger sanity');

    game.counteredItem = game.makeSpellItem(foe, steal, null, null);
    await steal.cast(game.effectContext(thief, null, null));
    equal(game.counteredItem, null, 'A stolen Stolen Thought finds nothing left to steal');
  }],

  ['hides the caster from one mind while that mind rots', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 300, y: 270 }, loadout: [] });
    const ally = new Mage({ name: 'Ally', isAI: false, team: 1, position: { x: 340, y: 320 }, loadout: [] });
    const foe = new Mage({ name: 'Foe', isAI: true, team: 2, position: { x: 500, y: 270 }, loadout: [] });
    foe.maxSanity = 300;
    foe.sanity = 300;
    const game = new GameState([caster, ally, foe], 43);
    const spell = getSpell(['veil', 'mind', 'corrode']);
    const pierce = getSpell(['pierce']);
    assert(spell && pierce, 'Expected Veil Mind Corrode and Pierce to be registered.');

    void spell.cast(game.effectContext(caster, foe, null));
    equal(game.isUntargetable(caster, foe), true, 'The foe cannot perceive the caster');
    equal(game.isValidSpellTarget(pierce, foe, caster), false, 'so it cannot aim at it');
    equal(game.isUntargetable(ally, foe), false, "The caster's ally is in plain sight");
    equal(game.isUntargetable(caster, ally), false, 'Only the foe is blinded');

    const rot = foe.statuses.find((s) => s.key === 'dot:blind-spot');
    assert(rot && rot.kind === 'dot', 'Expected the rot to set in.');
    equal(rot.escalateSpecs, ['1d4', '1d6', '1d8'], 'It rots deeper every turn');
    const sanity = foe.sanity;
    game.currentIndex = 2;
    game.beginTurn();
    assert(foe.sanity < sanity, 'Its mind rots at its turn start');
  }],

  ['blocks sight and passage with a glass curtain that shatters when it falls', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 200, y: 270 }, loadout: [] });
    const ally = new Mage({ name: 'Ally', isAI: false, team: 1, position: { x: 400 - RANGE_UNIT, y: 330 }, loadout: [] });
    const foe = new Mage({ name: 'Foe', isAI: true, team: 2, position: { x: 600, y: 270 }, loadout: [] });
    for (const m of [ally, foe]) {
      m.maxHp = 300;
      m.hp = 300;
    }
    const game = new GameState([caster, ally, foe], 47);
    const spell = getSpell(['veil', 'shatter', 'corrode'], null);
    const mind = getSpell(['mind']);
    assert(spell?.rotatableWall && mind, 'Expected Veil Shatter Corrode to be a rotatable wall.');

    caster.wallAngle = Math.PI / 2;
    void spell.cast(game.effectContext(caster, null, { x: 400, y: 270 }));
    equal(game.isUntargetable(foe, caster), true, 'The caster cannot see through the glass');
    equal(game.isUntargetable(caster, foe), true, 'nor can the foe');
    equal(game.isValidSpellTarget(mind, caster, foe), false, 'so no targeted spell crosses it');
    assert(game.makeMoveItem(foe, { x: 200, y: 270 }).targetPoint!.x > 400, 'Nothing walks through it');
    areaDamage(game.effectContext(caster, null, foe.pos), foe.pos, RANGE_UNIT, dmg(3, 'corrosive'));
    assert(foe.hp < 300, 'Area effects pass');

    const allyHp = ally.hp;
    for (let round = 0; round < 3; round++) game.tickBarriers();
    equal(game.barriers.length, 0, 'It falls after 3 rounds');
    assert(ally.hp < allyHp, "Its shards catch the caster's own side");
    equal(caster.hp, caster.maxHp, 'Nothing beyond 2cm is hurt');
  }],

  ['only looses the unseen volley while its archer stays hidden', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 200, y: 270 }, loadout: [] });
    const foe = new Mage({ name: 'Foe', isAI: true, team: 2, position: { x: 200 + 10 * RANGE_UNIT, y: 270 }, loadout: [] });
    foe.maxHp = 300;
    foe.hp = 300;
    const game = new GameState([caster, foe], 53);
    const spell = getSpell(['veil', 'curse', 'pierce']);
    assert(spell, 'Expected Veil Curse Pierce to be registered.');
    const step = (): number | undefined => {
      const status = foe.statuses.find((s) => s.key === 'dot:unseen-volley');
      return status && status.kind === 'dot' ? status.escalateIndex : undefined;
    };

    void spell.cast(game.effectContext(caster, foe, null));
    equal(caster.isInvisible(), true, 'The archer hides');
    game.currentIndex = 1;
    game.beginTurn();
    assert(foe.hp < 300, 'A hidden archer looses the first arrow');
    equal(step(), 1, 'and the volley advances');

    caster.statuses = caster.statuses.filter((s) => s.kind !== 'invisibility');
    const hp = foe.hp;
    game.beginTurn();
    equal(foe.hp, hp, 'A seen archer holds');
    equal(step(), 1, 'and the volley waits');
  }],

  ['carves charges out of the richest word and stuns', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 300, y: 270 }, loadout: [] });
    const foe = new Mage({ name: 'Foe', isAI: true, team: 2, position: { x: 300 + 2 * RANGE_UNIT, y: 270 }, loadout: ['shadow', 'mind', 'pierce'] });
    const beast = new Mage({ name: 'Beast', isAI: true, team: 2, position: { x: 300, y: 270 + 2 * RANGE_UNIT }, loadout: [] });
    for (const m of [foe, beast]) {
      m.maxHp = 300;
      m.hp = 300;
      m.maxSanity = 300;
      m.sanity = 300;
    }
    foe.charges.mind = 2;
    const game = new GameState([caster, foe, beast], 59);
    const spell = getSpell(['mind', 'shatter', 'corrode']);
    assert(spell, 'Expected Mind Shatter Corrode to be registered.');
    const before = { ...foe.charges };

    void spell.cast(game.effectContext(caster, foe, null));
    equal(foe.isStunned('full'), true, 'The blow stuns');
    assert(foe.sanity < 300, 'and splits the mind open');
    const lost = before.shadow - foe.charges.shadow;
    assert(lost >= 1 && lost <= 4, 'The richest word loses 1d4 charges');
    equal(foe.charges.pierce, before.pierce, 'A tie goes to the first word in the rack');
    equal(foe.charges.mind, 2, 'Poorer words are untouched');

    void spell.cast(game.effectContext(caster, beast, null));
    assert(beast.sanity <= 300 - 4, 'A mind with no words pays in sanity instead');
  }],

  ['condenses the afflicted and tolls the rest, on both sides', () => {
    const caster = new Mage({ name: 'Caster', isAI: false, team: 1, position: { x: 100, y: 270 }, loadout: [] });
    const afflicted = new Mage({ name: 'Afflicted', isAI: true, team: 2, position: { x: 500, y: 270 }, loadout: [] });
    const ally = new Mage({ name: 'Ally', isAI: false, team: 1, position: { x: 500 + RANGE_UNIT, y: 270 }, loadout: [] });
    for (const m of [afflicted, ally]) {
      m.maxHp = 300;
      m.hp = 300;
    }
    const game = new GameState([caster, afflicted, ally], 61);
    applyDot(game.effectContext(caster, afflicted, null), afflicted, {
      name: 'Test Rot',
      duration: 4,
      damage: dmg(2, 'corrosive'),
    });
    const spell = getSpell(['shadow', 'shatter', 'curse']);
    assert(spell, 'Expected Shadow Shatter Curse to be registered.');

    void spell.cast(game.effectContext(caster, null, { x: 500, y: 270 }));
    equal(afflicted.statuses.some((s) => s.kind === 'dot'), false, 'Its afflictions are condensed away');
    assert(afflicted.hp <= 300 - 8, 'and every remaining tick lands at once');
    assert(game.shadows.length >= 1, 'opening a shadow beneath it');
    const toll = ally.statuses.find((s) => s.key === 'dot:condensing-toll');
    assert(toll, 'An unafflicted ally is tolled too');
    equal(toll.duration, 9, 'standing in the fresh shadow, it tolls longer');
    assert(ally.hp < 300, 'and struck');
  }],

  ['gives every combination of the ten standard words a spell in every class', async () => {
    // Registered last: class variants would otherwise shadow the ordinary spells above.
    await import('../spells/classSpells');
    for (const mageClass of MAGE_CLASSES) {
      const combos: WordId[][] = [];
      WORD_ORDER.forEach((a, i) => {
        combos.push([a]);
        WORD_ORDER.slice(i + 1).forEach((b, j) => {
          combos.push([a, b]);
          for (const c of WORD_ORDER.slice(i + j + 2)) combos.push([a, b, c]);
        });
      });
      equal(combos.length, 175, 'Ten words make 175 combinations of one to three');
      for (const combo of combos) {
        assert(getSpell(combo, mageClass), `${combo.join(' ')} has no spell for ${mageClass}`);
      }
    }
    equal(getSpell(['shadow', 'shatter', 'curse'], 'objects')?.codename, 'Black Bell', 'Objects still conjure Black Bell');
    equal(getSpell(['shadow', 'shatter', 'curse'], 'life')?.codename, 'Condensing Toll', 'Life tolls instead');
  }],

  ['stops time: held blows, lost turns, glass coffins and a stopped world', () => {
    const caster = godUnit('Caster', 1, 300);
    const foe = godUnit('Foe', 2, 600);
    const game = new GameState([caster, foe], 71);
    const prison = getSpell(['reality', 'stop', 'bind']);
    assert(prison?.counters, 'Expected Reality Stop Bind to cancel what it answers.');

    void prison.cast(game.effectContext(caster, foe, null));
    equal(game.isTimeStopped(foe), true, 'Time stops for the prisoner');
    equal(
      dealDamage(game.effectContext(caster, foe, null), foe, dmg(7, 'pierce'), { canMiss: false }),
      0,
      'A blow on stopped time lands nothing yet'
    );
    equal(foe.hp, 300, 'It is held');
    equal(game.forceMove(caster, foe, { x: 700, y: 270 }), false, 'Nothing moves it');
    equal(foe.x, 600, 'It stays where it was stopped');
    equal(game.cannotReact(foe), true, 'It cannot react');
    game.currentIndex = 1;
    game.beginTurn();
    equal(foe.actions, { move: 0, main: 0, bonus: 0 }, 'Its first turn is lost');
    game.finishCurrentTurn();
    equal(foe.hp, 300, 'One lost turn in, the blow still hangs');
    game.beginTurn();
    game.finishCurrentTurn();
    equal(game.isTimeStopped(foe), false, 'Time resumes after its second lost turn');
    equal(foe.hp, 293, 'and every held blow lands at once');

    const world = getSpell(['reality', 'stop', 'veil']);
    assert(world?.turnOnly, 'Expected Reality Stop Veil to be cast on its own turn only.');
    const ally = godUnit('Ally', 1, 350);
    const other = godUnit('Other', 2, 900);
    const stopped = new GameState([caster, other, ally], 73);
    stopped.currentIndex = 0;
    void world.cast(stopped.effectContext(caster, caster, null));
    equal(stopped.isTimeStopped(other) && stopped.isTimeStopped(ally), true, 'Everyone else is frozen');
    equal(stopped.isTimeStopped(caster), false, 'but not the one who stopped it');
    equal(stopped.cannotReact(other), true, 'Nobody else can answer');
    equal(stopped.takeExtraTurn(), caster, 'The caster takes the next turn');
    dealDamage(stopped.effectContext(caster, other, null), other, dmg(5, 'pierce'), { canMiss: false });
    stopped.finishCurrentTurn();
    equal(other.hp, 300, 'The blow still hangs as the casting turn ends');
    stopped.finishCurrentTurn();
    equal(stopped.isTimeStopped(other), false, 'Time resumes when the extra turn ends');
    equal(other.hp, 295, 'and the held blow lands');
    stopped.stack.push(stopped.makeMeleeItem(other, caster));
    equal(stopped.canCastSpellNow(world), false, 'It never answers anything');

    const coffin = getSpell(['stop', 'veil', 'shatter']);
    assert(coffin, 'Expected Stop Veil Shatter to be registered.');
    const sealed = godUnit('Sealed', 2, 600);
    const beside = godUnit('Beside', 2, 600 + 2 * RANGE_UNIT);
    const glass = new GameState([caster, sealed, beside], 79);
    void coffin.cast(glass.effectContext(caster, sealed, null));
    equal(glass.isUntargetable(sealed, caster), true, 'Glass cannot be targeted');
    equal(
      dealDamage(glass.effectContext(caster, sealed, null), sealed, dmg(9, 'pierce'), { canMiss: false }),
      0,
      'or harmed'
    );
    glass.currentIndex = 1;
    glass.beginTurn();
    glass.finishCurrentTurn();
    equal(glass.isTimeStopped(sealed), false, 'The glass breaks as its lost turn ends');
    equal(sealed.hp, 300, 'Nothing that struck the glass was kept');
    assert(beside.hp < 300, "The shards cut the caster's enemies beside it");
  }],

  ['dooms by turns and shatter, and marks the hunted for death', () => {
    const caster = godUnit('Caster', 1, 200);
    const foe = godUnit('Foe', 2, 600);
    const near = godUnit('Near', 2, 600 + 2 * RANGE_UNIT);
    const game = new GameState([caster, foe, near], 83);
    const doom = getSpell(['death', 'curse', 'shatter']);
    assert(doom, 'Expected Death Curse Shatter to be registered.');

    void doom.cast(game.effectContext(caster, foe, null));
    equal(game.doomOn(foe)?.duration, 3, 'It falls in three');
    game.currentIndex = 1;
    game.beginTurn();
    equal(game.doomOn(foe)?.duration, 2, 'Its turn start draws it closer');
    dealDamage(game.effectContext(caster, foe, null), foe, dmg(1, 'shatter'), { canMiss: false });
    equal(game.doomOn(foe)?.duration, 1, 'So does every shatter wound');
    const hp = foe.hp;
    void doom.cast(game.effectContext(caster, foe, null));
    equal(game.doomOn(foe), undefined, 'Dooming the doomed makes it fall at once');
    assert(foe.hp <= hp - 4, 'It takes 4d6 shatter');
    assert(near.hp < 300, 'and everything near it takes half');

    const mark = getSpell(['death', 'curse', 'pierce']);
    assert(mark, 'Expected Death Curse Pierce to be registered.');
    const hunted = godUnit('Hunted', 2, 900);
    const hunt = new GameState([caster, hunted], 89);
    applyInvisibility(hunt.effectContext(hunted, hunted, null), hunted, { duration: 9, mode: 'full' });
    equal(hunt.isUntargetable(hunted, caster), true, 'Hidden before the mark');
    void mark.cast(hunt.effectContext(caster, hunted, null));
    equal(hunt.isUntargetable(hunted, caster), false, 'The marked cannot hide');
    equal(hunt.reapOn(hunted), 2, 'Its opening pierce feeds 2 Reap');
    dealDamage(hunt.effectContext(caster, hunted, null), hunted, dmg(1, 'corrosive'), { canMiss: false });
    equal(hunt.reapOn(hunted), 3, 'Any other wound feeds 1');
    hunted.hp = 8;
    for (let turn = 0; turn < 4; turn++) {
      hunt.currentIndex = 1;
      hunt.beginTurn();
    }
    equal(hunted.alive, false, 'When the mark comes due it is executed for 2, plus 2 per Reap');
  }],

  ['wounds past mending, crumbles bodies, tolls bells and reaps with lance and nightshot', () => {
    const caster = godUnit('Caster', 1, 200);
    const foe = godUnit('Foe', 2, 500);
    const ally = godUnit('Ally', 1, 700);
    const aside = godUnit('Aside', 2, 500, 450);
    const game = new GameState([caster, foe, ally, aside], 97);
    void getSpell(['death', 'corrode', 'pierce'])!.cast(game.effectContext(caster, foe, null));
    assert(foe.hp < 300 && ally.hp < 300, 'The needle passes through everything in line, allies included');
    equal(aside.hp, 300, 'Bodies off the line are untouched');
    const hp = ally.hp;
    heal(game.effectContext(caster, ally, null), ally, 10);
    equal(ally.hp, hp, 'A mortal wound will not close');
    equal(game.reapOn(ally), 10, 'The healing becomes Reap');

    const weak = godUnit('Weak', 2, 400);
    weak.maxHp = 20;
    weak.hp = 20;
    const crumble = new GameState([caster, weak], 101);
    void getSpell(['death', 'corrode', 'shatter'])!.cast(crumble.effectContext(caster, weak, null));
    assert(weak.maxHp < 20, 'Maximum health withers');
    equal(weak.maxHp + weak.witheredMaxHp, 20, 'by exactly what was lost');
    weak.resetForNewCombat();
    equal(weak.maxHp, 20, 'and returns when the combat ends');

    const toller = godUnit('Toller', 1, 200);
    const friend = godUnit('Friend', 1, 400);
    const marked = godUnit('Marked', 2, 400 + RANGE_UNIT);
    const bell = new GameState([toller, friend, marked], 103);
    bell.applyReap(marked, 3, toller);
    void getSpell(['death', 'shadow', 'shatter'])!.cast(bell.effectContext(toller, null, { x: 420, y: 270 }));
    assert(friend.hp < 300 && marked.hp < 300, 'The bell tolls for both sides');
    equal(friend.isStunned('full') && marked.isStunned('full'), true, 'and stuns them');
    equal(bell.reapOn(friend), 2, 'A clean body gains 2 Reap');
    equal(bell.reapOn(marked), 6, 'A marked body doubles its Reap');
    equal(toller.hp, 300, 'The ringer stood outside the bell');
    assert(bell.shadows.length >= 1, 'A shadow remains where it tolled');

    const reaper = godUnit('Reaper', 1, 200);
    const frail = godUnit('Frail', 2, 400);
    frail.hp = 3;
    const lance = new GameState([reaper, frail], 107);
    reaper.actions.main = 0;
    void getSpell(['death', 'shatter', 'pierce'])!.cast(lance.effectContext(reaper, frail, null));
    equal(frail.alive, false, 'The lance kills');
    equal(reaper.actions.main, 1, 'and hands back the main action');

    const archer = godUnit('Archer', 1, 200);
    const quartered = godUnit('Quartered', 2, 500);
    const shaded = godUnit('Shaded', 2, 800);
    const open = godUnit('Open', 2, 1000);
    for (const m of [quartered, shaded, open]) m.maxHp = 100;
    quartered.hp = 26;
    shaded.hp = 52;
    open.hp = 52;
    const night = new GameState([archer, quartered, shaded, open], 109);
    night.addShadow(shaded.pos, 2, 3);
    const shot = getSpell(['death', 'shadow', 'pierce'])!;
    for (const m of [quartered, shaded, open]) void shot.cast(night.effectContext(archer, m, null));
    equal(quartered.alive, false, 'A quarter of its health is its death');
    equal(shaded.alive, false, 'In any shadow, half is enough');
    equal(open.alive, true, 'In the open, half is not');
  }],

  ['binds with pacts and fixed points, wards with still water, and stops oaths, clocks, eyes and reflexes', () => {
    const caster = godUnit('Caster', 1, 200);
    const foe = godUnit('Foe', 2, 600);
    const game = new GameState([caster, foe], 113);
    void getSpell(['reality', 'bind', 'mind'])!.cast(game.effectContext(caster, foe, null));
    const sanity = foe.sanity;
    dealDamage(game.effectContext(foe, caster, null), caster, dmg(6, 'pierce'), { canMiss: false });
    equal(foe.sanity, sanity - 6, 'Every wound it deals comes back as sanity');

    const nailed = godUnit('Nailed', 2, 800);
    const fix = new GameState([godUnit('Nailer', 1, 200), nailed], 127);
    const nailer = fix.mages[0];
    void getSpell(['reality', 'bind', 'pierce'])!.cast(fix.effectContext(nailer, nailed, null));
    teleport(fix.effectContext(nailed, nailed, null), nailed, { x: 100, y: 100 });
    fix.forceMove(nailer, nailed, { x: 1000, y: 300 });
    equal({ x: nailed.x, y: nailed.y }, { x: 800, y: 270 }, 'Nothing moves a fixed point');
    equal(nailed.isStunned('movement'), true, 'and it cannot walk');
    applyInvisibility(fix.effectContext(nailed, nailed, null), nailed, { duration: 3, mode: 'full' });
    const nailedHp = nailed.hp;
    dealDamage(fix.effectContext(nailer, nailed, null), nailed, dmg(4, 'pierce'));
    equal(nailed.hp, nailedHp - 4, 'It cannot dodge');

    const warded = godUnit('Warded', 1, 300);
    const striker = godUnit('Striker', 2, 500);
    const still = new GameState([warded, striker], 131);
    void getSpell(['stop', 'bind', 'veil'])!.cast(still.effectContext(warded, warded, null));
    equal(
      dealDamage(still.effectContext(striker, warded, null), warded, dmg(8, 'pierce'), { canMiss: false }),
      0,
      'Still water stops the blow'
    );
    equal(warded.isFullyInvisible(), true, 'and hides the one it saved');
    equal(striker.isStunned('movement'), true, 'while the attacker is rooted');
    assert(
      dealDamage(still.effectContext(striker, warded, null), warded, dmg(3, 'pierce'), { canMiss: false, aoe: true }) > 0,
      'It stops only one blow'
    );

    const sworn = godUnit('Sworn', 2, 600);
    const oath = new GameState([godUnit('Oathgiver', 1, 200), sworn], 137);
    void getSpell(['stop', 'bind', 'mind'])!.cast(oath.effectContext(oath.mages[0], sworn, null));
    sworn.actions = { move: 1, main: 1, bonus: 1 };
    sworn.spend('move');
    equal(sworn.actions, { move: 0, main: 0, bonus: 0 }, 'The first action is the only one');

    const stalled = godUnit('Stalled', 2, 600);
    const clock = new GameState([godUnit('Clockstopper', 1, 200), stalled], 139);
    applyStun(clock.effectContext(clock.mages[0], stalled, null), stalled, { duration: 2, type: 'main' });
    void getSpell(['stop', 'bind', 'pierce'])!.cast(clock.effectContext(clock.mages[0], stalled, null));
    clock.currentIndex = 1;
    for (let turn = 0; turn < 3; turn++) clock.beginTurn();
    equal(stalled.isStunned('main'), true, 'Nothing wears off while its clock is stopped');
    equal(stalled.statuses.some((s) => s.kind === 'clockStopped'), false, 'until the clock itself runs down');
    clock.beginTurn();
    clock.beginTurn();
    equal(stalled.isStunned('main'), false, 'then time takes its toll again');

    const seer = godUnit('Seer', 2, 600);
    const blinker = godUnit('Blinker', 1, 250);
    const eyes = new GameState([blinker, seer], 149);
    void getSpell(['stop', 'veil', 'mind'])!.cast(eyes.effectContext(blinker, seer, null));
    equal(eyes.isUntargetable(blinker, seer), false, 'It still sees what has not moved');
    blinker.x += 3 * RANGE_UNIT;
    equal(eyes.isUntargetable(blinker, seer), true, 'What moved is gone from its picture');

    const reflexes = getSpell(['stop', 'veil', 'pierce']);
    assert(reflexes?.unanswerable, 'Expected Stop Veil Pierce to be unanswerable.');
    const numb = godUnit('Numb', 2, 600);
    const frozen = new GameState([godUnit('Needler', 1, 200), numb], 151);
    void reflexes.cast(frozen.effectContext(frozen.mages[0], numb, null));
    equal(frozen.cannotReact(numb), true, 'Its target cannot react at all');
  }],

  ['stops declarations, cancels enemy stacks, and punishes what it answers', () => {
    const caster = godUnit('Caster', 1, 300);
    const foe = godUnit('Foe', 2, 600);
    const game = new GameState([caster, foe], 157);
    const pierce = getSpell(['pierce']);
    const big = getSpell(['reality', 'mind', 'pierce']);
    assert(pierce && big, 'Expected Pierce and Reality Mind Pierce to be registered.');

    void getSpell(['reality', 'stop', 'mind'])!.cast(game.effectContext(caster, foe, null));
    const sanity = foe.sanity;
    equal(
      game.stopDeclaredAction(game.makeSpellItem(foe, pierce, caster, null)),
      true,
      'Its next action is stopped as it is declared'
    );
    assert(foe.sanity < sanity, 'and it pays in sanity');
    equal(game.stopDeclaredAction(game.makeSpellItem(foe, pierce, caster, null)), false, 'Only the next one');

    const volley = getSpell(['reality', 'stop', 'pierce']);
    assert(volley?.nullifiesHostileStack && volley.minStackDepth === 1, 'Expected a reaction-only stack breaker.');
    const own = game.makeSpellItem(caster, pierce, foe, null);
    game.stack.push(own, game.makeSpellItem(foe, pierce, caster, null), game.makeMeleeItem(foe, caster));
    const hp = foe.hp;
    void volley.cast(game.effectContext(caster, null, null));
    assert(foe.hp < hp, 'The hand behind the enemy actions is struck');
    equal(game.cancelHostileStack(caster.team).length, 2, 'Every enemy action is cancelled');
    assert(game.stack.length === 1 && game.stack[0] === own, 'Only its own side is left standing');
    game.stack.length = 0;

    game.counteredItem = game.makeSpellItem(foe, big, caster, null);
    const before = foe.sanity;
    void getSpell(['stop', 'mind', 'shatter'])!.cast(game.effectContext(caster, foe, null));
    assert(foe.sanity <= before - 4, 'A cancelled 3-word spell costs its caster 4d6 sanity');
    equal(foe.isStunned('full'), true, 'and stuns it');

    game.counteredItem = game.makeSpellItem(foe, big, caster, null);
    void getSpell(['stop', 'mind', 'pierce'])!.cast(game.effectContext(caster, foe, null));
    equal(
      ['reality', 'mind', 'pierce'].every((word) => foe.hasForgotten(word)),
      true,
      'It forgets every word of the cancelled spell'
    );

    const striker = godUnit('Striker', 2, 700);
    const duel = new GameState([caster, striker], 159);
    duel.counteredItem = duel.makeMeleeItem(striker, caster);
    void getSpell(['stop', 'shatter', 'pierce'])!.cast(duel.effectContext(caster, striker, null));
    assert(300 - striker.hp >= 4, 'The counterstrike lands 2d6 pierce and 2d6 shatter');
    equal(striker.isStunned('full'), true, 'and a blow aimed at the caster leaves its source stunned');
    const struck = godUnit('Struck', 2, 800);
    const aside = new GameState([caster, struck], 161);
    aside.counteredItem = aside.makeSpellItem(struck, pierce, godUnit('Bystander', 1, 650), null);
    void getSpell(['stop', 'shatter', 'pierce'])!.cast(aside.effectContext(caster, struck, null));
    equal(struck.isStunned('full'), false, 'A blow aimed elsewhere is only cancelled');
    game.counteredItem = null;
  }],

  ['raises the unhallowed dead, and lets the ground crawl, close, burst and bill every step', () => {
    const caster = godUnit('Caster', 1, 200, 270, ['desecrate']);
    const first = creature('First', 500);
    const second = creature('Second', 700);
    const game = new GameState([caster, first, second], 163);
    void getSpell(['desecrate', 'shadow', 'death'])!.cast(game.effectContext(caster, null, null));
    assert(game.reapOn(first) >= 1 && game.reapOn(second) >= 1, 'Every unhallowed unit is reaped');
    equal(game.reapOn(caster), 0, 'Minions are spared');
    dealDamage(game.effectContext(caster, first, null), first, dmg(9999, 'typeless'));
    const risen = game.summonsOf(caster);
    equal(risen.length, 1, 'The fallen rises for the caster');
    equal(risen[0]?.summonKind, 'remnant', 'as a Remnant');
    equal(game.raiseThrall(first, caster), null, 'No body rises twice');

    const prey = creature('Prey', 1000);
    const crawl = new GameState([caster, prey], 167);
    void getSpell(['desecrate', 'shadow', 'corrode'])!.cast(crawl.effectContext(caster, null, { x: 300, y: 270 }));
    const dark = crawl.desecrationFields[0];
    passRound(crawl);
    equal(Math.round(dark.x), 300 + 6 * RANGE_UNIT, 'The dark crawls toward the nearest unhallowed unit');

    const trapped = creature('Trapped', 600);
    const hole = new GameState([caster, trapped], 173);
    void getSpell(['desecrate', 'corrode', 'shatter'], null)!.cast(hole.effectContext(caster, null, { x: 600, y: 270 }));
    const sink = hole.desecrationFields[0];
    equal(sink.sealed, true, 'Nothing walks out of the sinkhole');
    passRound(hole);
    equal(sink.radius, 4.5 * RANGE_UNIT, 'It shrinks every round');
    const trappedHp = trapped.hp;
    for (let round = 0; round < 3; round++) passRound(hole);
    equal(hole.desecrationFields.length, 0, 'It closes after 4 rounds');
    assert(trapped.hp <= trappedHp - 6, 'crushing whatever is still inside for 6d6');

    const a = creature('A', 600);
    const b = creature('B', 600 + 2 * RANGE_UNIT);
    const c = creature('C', 600 + 4 * RANGE_UNIT);
    b.hp = 3;
    const chain = new GameState([caster, a, b, c], 179);
    void getSpell(['desecrate', 'curse', 'shatter'])!.cast(chain.effectContext(caster, null, { x: 600, y: 270 }));
    dealDamage(chain.effectContext(caster, a, null), a, dmg(9999, 'typeless'));
    equal(b.alive, false, 'The first body bursts and kills the second');
    assert(c.hp < 300, 'whose own burst carries the chain on');

    const walker = creature('Walker', 400);
    const thorns = new GameState([caster, walker], 181);
    void getSpell(['desecrate', 'curse', 'pierce'])!.cast(thorns.effectContext(caster, null, null));
    thorns.currentIndex = 1;
    thorns.beginTurn();
    walker.x += 5 * RANGE_UNIT;
    const walkerHp = walker.hp;
    thorns.finishCurrentTurn();
    assert(walker.hp <= walkerHp - 2, 'Every 2cm walked is billed a die');

    const sleeper = creature('Sleeper', 400);
    const night = new GameState([caster, sleeper], 191);
    void getSpell(['desecrate', 'shadow', 'curse'])!.cast(night.effectContext(caster, null, null));
    for (let round = 0; round < 3; round++) passRound(night);
    equal(night.desecrations[0]?.stage, 3, 'The night deepens every round');
    const sleeperHp = sleeper.hp;
    night.currentIndex = 1;
    night.beginTurn();
    assert(sleeper.hp <= sleeperHp - 8, 'By its fourth round it bites for 8d4');

    const culled = creature('Culled', 500);
    const tough = creature('Tough', 500 + 2 * RANGE_UNIT);
    culled.hp = 4;
    const cull = new GameState([caster, culled, tough], 193);
    void getSpell(['desecrate', 'death', 'shatter'])!.cast(cull.effectContext(caster, null, null));
    equal(culled.alive, false, 'The weak are culled');
    equal(tough.alive, true, 'The strong survive the count');
    assert(tough.hp < 300, 'but not the burst of the fallen');

    const inShadow = creature('InShadow', 400);
    const inOpen = creature('InOpen', 800);
    const stakes = new GameState([caster, inShadow, inOpen], 197);
    stakes.addShadow(inShadow.pos, 1, 3);
    void getSpell(['desecrate', 'shadow', 'pierce'])!.cast(stakes.effectContext(caster, null, null));
    equal(300 - inShadow.hp, 2 * (300 - inOpen.hp), 'Stakes in shadow strike twice');
    equal(inOpen.isStunned('movement'), true, 'and every staked unit is rooted');
    equal(caster.hp, 300, 'Minions are spared');

    const thrall = creature('Thrall', 500);
    thrall.hp = 5;
    const spike = new GameState([caster, thrall], 199);
    void getSpell(['desecrate', 'death', 'pierce'])!.cast(spike.effectContext(caster, thrall, null));
    equal(thrall.alive, false, 'The spike kills');
    equal(spike.summonsOf(caster).length, 1, 'and the body rises at once');
    const duellist = godUnit('Duellist', 2, 500);
    const duel = new GameState([caster, duellist], 211);
    void getSpell(['desecrate', 'death', 'pierce'])!.cast(duel.effectContext(caster, duellist, null));
    equal(duellist.hp, 300, 'A drafted mage is no thrall');

    const bearer = creature('Bearer', 500);
    const plague = new GameState([caster, bearer], 223);
    void getSpell(['desecrate', 'corrode', 'pierce'], null)!.cast(plague.effectContext(caster, bearer, null));
    const rot = plague.desecrationFields[0];
    plague.forceMove(caster, bearer, { x: 800, y: 300 });
    equal(
      { x: Math.round(rot.x), y: Math.round(rot.y) },
      { x: Math.round(bearer.x), y: Math.round(bearer.y) },
      'The rot travels with its carrier'
    );

    const rival = godUnit('Rival', 2, 600);
    const spire = new GameState([caster, rival], 227);
    void getSpell(['desecrate', 'shatter', 'pierce'])!.cast(spire.effectContext(caster, null, { x: 600, y: 270 }));
    assert(rival.hp <= 297, 'The spire strikes a drafted enemy');
    equal(rival.isStunned('full'), true, 'and stuns it');
    equal(spire.desecrationFields.length, 1, 'and fouls the ground');

    const dragged = creature('Dragged', 600 + 4 * RANGE_UNIT);
    const minion = godUnit('Minion', 1, 600 - 4 * RANGE_UNIT);
    const fall = new GameState([caster, dragged, minion], 229);
    void getSpell(['desecrate', 'shadow', 'shatter'])!.cast(fall.effectContext(caster, null, { x: 600, y: 270 }));
    assert(dist(dragged.pos, { x: 600, y: 270 }) <= RANGE_UNIT + 1, 'The unhallowed are dragged to the centre');
    equal(minion.x, 600 - 4 * RANGE_UNIT, 'Minions stay where they stand');
    assert(dragged.hp < 300, 'and the dragged are crushed');
  }],

  ['folds, collapses, rewinds, reaches, seizes, tears and shatters reality', async () => {
    const caster = godUnit('Caster', 1, 200);
    const foe = godUnit('Foe', 2, 600);
    const game = new GameState([caster, foe], 233);
    await getSpell(['reality', 'bind', 'veil'])!.cast(game.effectContext(caster, foe, null));
    equal(game.isUntargetable(foe, caster), true, 'Folded out of reality, nothing can reach it');
    game.currentIndex = 1;
    game.beginTurn();
    equal(game.isPhasedOut(foe), false, 'It returns as its turn begins');

    const a = godUnit('A', 2, 600, 200);
    const b = godUnit('B', 2, 700, 350);
    const well = new GameState([godUnit('Collapser', 1, 200), a, b], 239);
    void getSpell(['reality', 'bind', 'shatter'])!.cast(well.effectContext(well.mages[0], null, { x: 650, y: 270 }));
    assert(dist(a.pos, { x: 650, y: 270 }) < dist({ x: 600, y: 200 }, { x: 650, y: 270 }), 'Enemies are hauled in');
    assert(300 - a.hp >= 3 && 300 - b.hp >= 3, 'and crushed by 2d6 plus 1d6 for the other');
    equal(a.isStunned('movement'), true, 'then rooted');

    const rewound = godUnit('Rewound', 2, 600);
    const deja = new GameState([godUnit('Rewinder', 1, 200), rewound], 241);
    deja.currentIndex = 1;
    deja.beginTurn();
    rewound.x = 900;
    rewound.hp = 200;
    rewound.lastAction = { type: 'spell', spellId: getSpell(['pierce'])!.id };
    void getSpell(['reality', 'veil', 'mind'])!.cast(deja.effectContext(deja.mages[0], rewound, null));
    equal({ x: rewound.x, y: rewound.y, hp: rewound.hp }, { x: 600, y: 270, hp: 300 }, 'Its last turn is undone');
    equal(rewound.hasForgotten('pierce'), true, 'and it forgets what it did');

    const sniper = godUnit('Sniper', 1, 100);
    const far = godUnit('Far', 2, 1200);
    const snipe = new GameState([sniper, far], 251);
    const mind = getSpell(['mind'])!;
    equal(snipe.isValidSpellTarget(mind, sniper, far), false, 'Out of reach at first');
    void getSpell(['reality', 'veil', 'pierce'])!.cast(snipe.effectContext(sniper, sniper, null));
    applyInvisibility(snipe.effectContext(far, far, null), far, { duration: 3, mode: 'full' });
    equal(snipe.isValidSpellTarget(mind, sniper, far), true, 'Phantom Reach finds it at any distance, hidden or not');

    const fragile = godUnit('Fragile', 2, 900);
    fragile.maxSanity = 20;
    fragile.sanity = 12;
    const seize = new GameState([godUnit('Seizer', 1, 200), fragile], 257);
    void getSpell(['reality', 'mind', 'pierce'])!.cast(seize.effectContext(seize.mages[0], fragile, null));
    equal(seize.takeExtraTurn(), seize.mages[0], 'Breaking its mind seizes an extra turn');

    const lancer = godUnit('Lancer', 1, 100);
    const inLine = godUnit('InLine', 2, 700);
    const offLine = godUnit('OffLine', 2, 700, 440);
    const rift = new GameState([lancer, inLine, offLine], 263);
    rift.addBarrier({ x: 400, y: 270 }, Math.PI / 2, { shape: 'rect', range: 4 * RANGE_UNIT, thickness: 10, owner: 2, ttl: 3 });
    void getSpell(['reality', 'shatter', 'pierce'])!.cast(rift.effectContext(lancer, null, { x: 700, y: 270 }));
    assert(inLine.hp <= 296, 'Everything on the rift is struck');
    equal(offLine.hp, 300, 'nothing beside it');
    equal(rift.barriers.length, 0, 'and the wall it crossed is gone');

    const hidden = godUnit('Hidden', 2, 600);
    const plain = godUnit('Plain', 2, 800);
    const friend = godUnit('Friend', 1, 300);
    const glassy = new GameState([godUnit('Breaker', 1, 200), hidden, plain, friend], 269);
    applyInvisibility(glassy.effectContext(hidden, hidden, null), hidden, { duration: 5, mode: 'full' });
    void getSpell(['reality', 'veil', 'shatter'])!.cast(glassy.effectContext(glassy.mages[0], null, null));
    equal(hidden.isInvisible(), false, 'Concealment ends');
    assert(300 - hidden.hp >= 4, 'The hidden take 4d6');
    equal(hidden.isStunned('full'), true, 'and are stunned');
    assert(300 - plain.hp <= 6, 'Everyone else takes 1d6');
    equal(friend.isInvisible(), true, "The caster's side slips into a half veil");

    const runner = godUnit('Runner', 2, 500);
    const idle = godUnit('Idle', 2, 700);
    const halt = new GameState([godUnit('Halter', 1, 300), runner, idle], 271);
    halt.currentIndex = 1;
    halt.beginTurn();
    runner.x += 6 * RANGE_UNIT;
    halt.currentIndex = 2;
    halt.beginTurn();
    void getSpell(['stop', 'bind', 'shatter'])!.cast(halt.effectContext(halt.mages[0], null, null));
    assert(300 - runner.hp >= 4, 'Momentum breaks the runner for 4d6');
    assert(300 - idle.hp <= 6, 'The idle take only 1d6');
    equal(runner.isStunned('movement') && idle.isStunned('movement'), true, 'and everything stops');

    const caught = godUnit('Caught', 2, 600);
    const moment = new GameState([godUnit('Shatterer', 1, 200), caught], 277);
    void getSpell(['reality', 'stop', 'shatter'])!.cast(moment.effectContext(moment.mages[0], null, { x: 600, y: 270 }));
    equal(moment.isTimeStopped(caught), true, 'Everything in the circle stops');
    moment.currentIndex = 1;
    moment.beginTurn();
    moment.finishCurrentTurn();
    assert(300 - caught.hp >= 3, 'and shatters for 3d6 when time resumes');
  }],

  ['gives every legal three-word combination of the fourteen words a spell in every class', async () => {
    await import('../spells/classSpells');
    const pool: WordId[] = [...WORD_ORDER, 'desecrate', 'death', 'reality', 'stop'];
    let legal = 0;
    pool.forEach((a, i) => {
      pool.slice(i + 1).forEach((b, j) => {
        for (const c of pool.slice(i + j + 2)) {
          const combo: WordId[] = [a, b, c];
          const blue = combo.some((word) => WORD_COLOR[word] === 'blue');
          const black = combo.some((word) => WORD_COLOR[word] === 'black');
          if ((combo.includes('desecrate') || combo.includes('death')) && blue) continue;
          if ((combo.includes('reality') || combo.includes('stop')) && black) continue;
          legal += 1;
          for (const mageClass of MAGE_CLASSES) {
            assert(getSpell(combo, mageClass), `${combo.join(' ')} has no spell for ${mageClass}`);
          }
        }
      });
    });
    equal(legal, 192, 'Fourteen words make 192 legal combinations of three');
  }],

  ['gives every Corrode, Veil, Mind and Water combo an ordinary spell and three class variants, and a modifier undoes the class', async () => {
    await import('../spells/classSpells');
    const wave = (lead: WordId, rest: WordId[], skip: (a: WordId, b: WordId) => boolean): WordId[][] => {
      const combos: WordId[][] = rest.map((word): WordId[] => [lead, word]);
      rest.forEach((a, i) => {
        for (const b of rest.slice(i + 1)) if (!skip(a, b)) combos.push([lead, a, b]);
      });
      return combos;
    };
    const corrode = wave(
      'corrode',
      ['twist', 'bind', 'veil', 'pierce', 'shatter', 'drain', 'curse', 'desecrate'],
      (a, b) => b === 'desecrate' && (a === 'twist' || a === 'bind' || a === 'veil')
    );
    const veil = wave('veil', ['curse', 'drain', 'pierce', 'shatter', 'twist', 'bind'], () => false);
    const mind = wave('mind', ['shadow', 'reality', 'fire', 'lightning'], (a, b) => !(a === 'fire' && b === 'lightning'));
    const waterPairs = new Set(['mind+shadow', 'mind+reality', 'mind+fire', 'mind+lightning', 'mind+pain', 'shadow+pain', 'fire+lightning']);
    const water = wave('water', ['mind', 'shadow', 'reality', 'fire', 'lightning', 'pain'], (a, b) => !waterPairs.has(`${a}+${b}`));
    equal(corrode.length, 33, 'The Corrode wave covers 33 combinations');
    equal(veil.length, 21, 'The Veil wave covers 21 more');
    equal(mind.length, 5, 'The Mind wave covers 5 more (Reality joins only blue; red, black and blue never meet)');
    equal(water.length, 13, 'The Water wave covers 13 more');
    for (const combo of [...corrode, ...veil, ...mind, ...water]) {
      const label = combo.join(' ');
      const ordinary = getSpell(combo, null);
      assert(ordinary && !ordinary.id.includes('@'), `${label} has an ordinary spell`);
      for (const mageClass of MAGE_CLASSES) {
        assert(getSpell(combo, mageClass)?.id.endsWith(`@${mageClass}`), `${label} has a ${mageClass} variant`);
        equal(spellForSelection(combo, mageClass)?.id, getSpell(combo, mageClass)?.id, `${label} casts its ${mageClass} variant`);
        equal(spellForSelection([...combo, 'subtle'], mageClass)?.id, ordinary.id, `${label} with a modifier casts the ordinary spell`);
      }
      const variants = new Set(MAGE_CLASSES.map((mageClass) => getSpell(combo, mageClass)?.description));
      equal(variants.size, 3, `${label} has three different variants`);
    }
    const dcCaster = godUnit('Reckoner', 1, 300);
    const seize = getSpell(['corrode', 'twist'], null)!;
    equal(
      spellCastDc(seize, dcCaster, ['subtle']) - spellCastDc(seize, dcCaster),
      12,
      'A modifier makes the combo pay its full ordinary DC (12 + 5 instead of 5)'
    );
  }],

  ['raises Corrode minions, conjures gear for one fight, and lays Corrode laws', async () => {
    await import('../spells/classSpells');
    const summoner = godUnit('Summoner', 1, 300);
    const prey = godUnit('Prey', 2, 600);
    const den = new GameState([summoner, prey], 401);
    void getSpell(['corrode', 'bind'], 'life')!.cast(den.effectContext(summoner, null, { x: 560, y: 270 }));
    const slime = den.summonsOf(summoner)[0];
    equal(slime?.summonKind, 'tar-slime', 'Life raises a Tar Slime');
    assert(slime.intrinsicMelee?.onHit, 'with its bite rebuilt from its kind');
    den.lastIntrinsicDamage = 0;
    slime.intrinsicMelee.onHit(den.effectContext(slime, prey, null), prey);
    assert(!prey.statuses.some((s) => s.kind === 'tether'), 'A bite that drew nothing tethers nothing');
    den.lastIntrinsicDamage = 2;
    slime.intrinsicMelee.onHit(den.effectContext(slime, prey, null), prey);
    assert(prey.statuses.some((s) => s.kind === 'tether'), 'A landed bite tethers the prey');

    const smith = godUnit('Smith', 1, 300);
    smith.hands = ['ironShortsword', 'buckler'];
    const forge = new GameState([smith, godUnit('Anvil', 2, 600)], 409);
    void getSpell(['corrode', 'shatter'], 'objects')!.cast(forge.effectContext(smith, smith, null));
    equal(smith.hands, ['conjuredRotHammer'], 'Objects conjures a Rot Hammer into the hand');
    equal(smith.blocksCasting(), false, 'and can still cast while holding it');
    smith.resetForNewCombat();
    equal([...smith.hands].sort(), ['buckler', 'ironShortsword'], 'After the fight the hammer fades and the old gear returns');
    equal(smith.bag.includes('conjuredRotHammer'), false, 'Nothing conjured is kept');

    const edge = godUnit('Edge', 1, 300);
    const block = godUnit('Block', 2, 360);
    const yard = new GameState([edge, block], 419);
    void getSpell(['corrode', 'twist', 'veil'], 'objects')!.cast(yard.effectContext(edge, edge, null));
    for (let i = 0; i < 3; i++) imbueAfterStrike(yard, block, edge, 3);
    assert(300 - block.hp >= 3, 'Hushing Cloak bites every attacker that lands');
    assert(block.statuses.some((s) => s.kind === 'stifle'), 'and stifles it');
    equal(edge.statuses.some((s) => s.kind === 'imbue'), false, 'and is spent after three');

    const judge = godUnit('Judge', 1, 300);
    const mark = godUnit('Mark', 2, 400);
    const court = new GameState([judge, mark], 421);
    void getSpell(['corrode', 'pierce'], 'hexcraft')!.cast(court.effectContext(judge, judge, null));
    assert(court.hexLaw('etching'), 'Hexcraft lays Etching Law');
    dealDamage(court.effectContext(judge, mark, null), mark, dmg(5, 'pierce'), { canMiss: false });
    assert(300 - mark.hp >= 6, 'Under it, a pierce hit also etches 1d3 corrosive');

    for (const mageClass of MAGE_CLASSES) {
      equal(getSpell(['corrode'], mageClass)?.id, getSpell(['corrode'], null)?.id, `A word alone is never a ${mageClass} class spell`);
    }

    const gagger = godUnit('Gagger', 1, 400);
    const gagged = godUnit('Gagged', 2, 500);
    const hush = new GameState([gagger, gagged], 433);
    void getSpell(['corrode', 'twist'], null)!.cast(hush.effectContext(gagger, gagged, null));
    const strike = getSpell(['pierce'], null)!;
    equal(hush.stopDeclaredAction(hush.makeMoveItem(gagged, { x: 520, y: 270 })), false, 'Seize never stops a walk');
    equal(hush.stopDeclaredAction(hush.makeSpellItem(gagged, strike, gagger, null)), true, 'Seize stifles the next action');
    equal(hush.stopDeclaredAction(hush.makeSpellItem(gagged, strike, gagger, null)), false, 'and only that one');
  }],

  ['heals drains in full, chains the hungry, and gives veils no strength of their own', async () => {
    await import('../spells/classSpells');
    const drinker = godUnit('Drinker', 1, 300);
    drinker.hp = 200;
    const tidewater = godUnit('Tidewater', 2, 400);
    const tide = new GameState([drinker, tidewater], 437);
    void getSpell(['corrode', 'drain'], 'hexcraft')!.cast(tide.effectContext(drinker, drinker, null));
    const drunk = dealDamage(tide.effectContext(drinker, tidewater, null), tidewater, dmg(7, 'corrosive'), { canMiss: false });
    equal(drinker.hp - 200, drunk, 'Bloodtide heals for all the corrosive damage dealt');

    const binder = godUnit('Binder', 1, 300);
    binder.hp = 200;
    const chained = godUnit('Chained', 2, 400);
    const chains = new GameState([binder, chained], 439);
    void getSpell(['corrode', 'bind', 'drain'], 'hexcraft')!.cast(chains.effectContext(binder, binder, null));
    dealDamage(chains.effectContext(binder, chained, null), chained, dmg(3, 'corrosive'), { canMiss: false });
    equal(chained.isStunned('movement'), true, 'Hunger of Chains roots an enemy at its first corrosive hit');
    const chainedBefore = chained.hp;
    const binderBefore = binder.hp;
    chains.currentIndex = 1;
    chains.beginTurn();
    assert(chained.hp < chainedBefore && binder.hp > binderBefore, 'and the rooted enemy bleeds into its caster each turn');

    const stalker = godUnit('Stalker', 1, 300);
    const quarry = godUnit('Quarry', 2, 400);
    const blades = new GameState([stalker, quarry], 441);
    void getSpell(['veil', 'pierce'], 'hexcraft')!.cast(blades.effectContext(stalker, stalker, null));
    applyInvisibility(blades.effectContext(stalker, stalker, null), stalker, { duration: 2, mode: 'partial' });
    dealDamage(blades.effectContext(stalker, quarry, null), quarry, dmg(4, 'pierce'), { canMiss: false });
    equal(300 - quarry.hp, 4, 'Unseen Blades gives a veiled attacker nothing');
    equal(blades.isVeiled(quarry), true, 'but every pierce hit veils its target');
    dealDamage(blades.effectContext(stalker, quarry, null), quarry, dmg(4, 'pierce'), { canMiss: false });
    equal(300 - quarry.hp, 12, 'and a pierce hit that lands on a veiled unit deals double');

    const whisperer = godUnit('Whisperer', 1, 300);
    const hushed = godUnit('Hushed', 2, 400);
    const glade = new GameState([whisperer, hushed], 443);
    void getSpell(['veil', 'twist'], 'life')!.cast(glade.effectContext(whisperer, null, { x: 380, y: 270 }));
    const sprite = glade.summonsOf(whisperer)[0];
    equal(sprite?.summonKind, 'hush-sprite', 'Life raises a Hush Sprite');
    equal(glade.isVeiled(sprite), false, 'that arrives unveiled');
    glade.currentIndex = 0;
    glade.beginTurn();
    assert(hushed.statuses.some((s) => s.kind === 'stifle'), 'and stifles the nearest enemy at your turn start');
    equal(glade.isVeiled(sprite), false, 'without ever veiling itself');
  }],

  ['shrouds allies near a Veil minion, robes answer half the time, and Veil laws cut both ways', async () => {
    await import('../spells/classSpells');
    const keeper = godUnit('Keeper', 1, 300);
    const hunter = godUnit('Hunter', 2, 600);
    const fog = new GameState([keeper, hunter], 451);
    void getSpell(['corrode', 'veil'], 'life')!.cast(fog.effectContext(keeper, null, { x: 400, y: 270 }));
    const fume = fog.summonsOf(keeper)[0];
    equal(fume?.summonKind, 'caustic-fume', 'Life raises a Caustic Fume');
    equal(fog.isVeiled(fume), false, 'that is not veiled');
    keeper.x = fume.x + 15;
    keeper.y = fume.y;
    equal(fog.isUntargetable(keeper, hunter), true, 'An ally inside its shroud cannot be singled out by an enemy');
    equal(fog.isUntargetable(fume, hunter), false, 'but the Fume itself can');
    equal(fog.isUntargetable(keeper, fume), false, 'and its own side still sees the ally');
    const before = keeper.hp;
    areaDamage(fog.effectContext(hunter, null, keeper.pos), keeper.pos, 20, dmg(3, 'heat'));
    assert(keeper.hp < before, 'An area effect still finds the shrouded ally');
    fume.hp = 0;
    equal(fog.isUntargetable(keeper, hunter), false, 'Killing the Fume lifts the shroud');

    const lancer = godUnit('Lancer', 1, 300);
    const yard = new GameState([lancer, godUnit('Dummy', 2, 600)], 457);
    void getSpell(['veil', 'pierce'], 'life')!.cast(yard.effectContext(lancer, null, { x: 380, y: 270 }));
    equal(yard.isVeiled(yard.summonsOf(lancer)[0]), false, 'No Veil minion spawns veiled');

    const wearer = godUnit('Wearer', 1, 300);
    const target = godUnit('Target', 2, 360);
    const hall = new GameState([wearer, target], 461);
    void getSpell(['veil', 'twist'], 'objects')!.cast(hall.effectContext(wearer, wearer, null));
    equal(robeOf(wearer)?.charges, 3, 'Objects lays a robe with 3 uses');
    let answered = 0;
    for (let i = 0; i < 3; i++) if (castRobe(hall, wearer)) answered += 1;
    equal(robeOf(wearer), undefined, 'and every try spends a use, answered or not');
    equal(target.statuses.some((s) => s.kind === 'stifle'), answered > 0, 'an answered try stifles the nearest enemy');
    let hits = 0;
    for (let i = 0; i < 200; i++) {
      addImbue(hall, wearer, wearer, 'hushingRobe');
      if (castRobe(hall, wearer)) hits += 1;
    }
    assert(hits > 70 && hits < 130, `The robe answers about half the time (${hits}/200)`);

    const greedy = godUnit('Greedy', 1, 300);
    greedy.hp = 200;
    const shy = godUnit('Shy', 2, 400);
    const hunger = new GameState([greedy, shy], 463);
    void getSpell(['corrode', 'veil', 'drain'], 'hexcraft')!.cast(hunger.effectContext(greedy, greedy, null));
    applyInvisibility(hunger.effectContext(shy, shy, null), shy, { duration: 2, mode: 'partial' });
    assert(shy.hp < 300 && greedy.hp - 200 === 300 - shy.hp, 'Under Veiled Hunger, veiling costs 1d4 and feeds the other side');
    equal(hunger.isVeiled(shy), true, 'and the toll does not tear the new veil');

    const nailer = godUnit('Nailer', 1, 300);
    const pinned = godUnit('Pinned', 2, 400);
    const board = new GameState([nailer, pinned], 467);
    void getSpell(['veil', 'pierce', 'bind'], 'hexcraft')!.cast(board.effectContext(nailer, nailer, null));
    dealDamage(board.effectContext(nailer, pinned, null), pinned, dmg(2, 'pierce'), { canMiss: false });
    equal(pinned.isStunned('movement'), true, 'Nailed Shadows roots a pierced unit');
    applyInvisibility(board.effectContext(pinned, pinned, null), pinned, { duration: 2, mode: 'partial' });
    dealDamage(board.effectContext(nailer, pinned, null), pinned, dmg(3, 'shatter'), { canMiss: false });
    equal(board.isVeiled(pinned), true, "and hits cannot tear a rooted unit's veil");
  }],

  ['spoils minds: figments, mirrors, unreality, burning thoughts, conducting storms, nightmares and brainstorms', async () => {
    await import('../spells/classSpells');
    const strike = getSpell(['pierce'], null)!;
    const flare = (m: Mage): number =>
      (m.statuses.find((s) => s.kind === 'blueflare') as { stacks: number } | undefined)?.stacks ?? 0;

    const dreamer = godUnit('Dreamer', 1, 300);
    const doubter = godUnit('Doubter', 2, 420);
    const dream = new GameState([dreamer, doubter], 501);
    void getSpell(['reality', 'mind'], 'life')!.cast(dream.effectContext(dreamer, null, { x: 340, y: 320 }));
    const figment = dream.summonsOf(dreamer)[0];
    equal(figment?.summonKind, 'figment', 'Life raises a Figment');
    let fooled = 0;
    for (let i = 0; i < 40; i++) {
      const item = dream.makeSpellItem(doubter, strike, dreamer, null);
      dream.pushStack(item);
      if (item.target === figment) fooled += 1;
      dream.stack.length = 0;
    }
    assert(fooled > 8 && fooled < 32, `About half the spells aimed at you strike the Figment instead (${fooled}/40)`);
    const doubterSanity = doubter.sanity;
    dealDamage(dream.effectContext(doubter, figment, null), figment, dmg(1, 'heat'), { canMiss: false });
    assert(doubter.sanity < doubterSanity && figment.alive, 'Every hit landing on the Figment shocks the enemy minds near it');

    const glass = godUnit('Glass', 1, 300);
    const thrower = godUnit('Thrower', 2, 400);
    const hall = new GameState([glass, thrower], 503);
    void getSpell(['reality', 'mind'], 'objects')!.cast(hall.effectContext(glass, glass, null));
    const turned = hall.makeSpellItem(thrower, strike, glass, null);
    hall.pushStack(turned);
    assert(turned.target === thrower, 'Mirrored Mind turns a spell back on its caster');
    await turned.resolve(hall);
    assert(thrower.hp < 300 && glass.hp === 300, 'who takes it instead');

    const thinker = godUnit('Thinker', 1, 300);
    const lighter = godUnit('Lighter', 2, 400);
    const focus = new GameState([thinker, lighter], 505);
    void getSpell(['fire', 'mind'], 'hexcraft')!.cast(focus.effectContext(lighter, lighter, null));
    focus.pushStack(focus.makeSpellItem(thinker, getSpell(['mind', 'shadow'], null)!, lighter, null));
    equal(flare(thinker), 2, 'Burning Focus: a two-word spell kindles 2 Blueflare on its caster');

    const swap = getSpell(['reality', 'mind'], 'hexcraft')!;
    assert(swap.codename === 'Reality Mind' && swap.targeting === 'enemy', 'Hexcraft Reality Mind swaps minds with an enemy');

    const seer = godUnit('Seer', 1, 300);
    const dazed = godUnit('Dazed', 2, 400);
    const haze = new GameState([seer, dazed], 507);
    void getSpell(['reality', 'mind'], null)!.cast(haze.effectContext(seer, dazed, null));
    let phantoms = 0;
    for (let i = 0; i < 40; i++) {
      const item = haze.makeSpellItem(dazed, strike, seer, null);
      const real = item.resolve;
      haze.pushStack(item);
      if (item.resolve !== real) phantoms += 1;
      haze.stack.length = 0;
    }
    assert(phantoms > 8 && phantoms < 32, `Unreality: about half its spells strike a phantom (${phantoms}/40)`);

    const smith = godUnit('Smith', 1, 300);
    smith.bag.push('razorSword');
    equal(smith.equipHand('razorSword'), true, 'The smith holds a sword');
    const forge = new GameState([smith, godUnit('Anvil', 2, 400)], 509);
    void getSpell(['fire', 'mind'], 'objects')!.cast(forge.effectContext(smith, smith, null));
    equal(smith.weaponEnchant, 'fireMind', 'Objects Fire Mind sets a weapon alight with thought-fire');
    forge.spellRollThisCast = 12;
    void getSpell(['lightning', 'mind'], 'objects')!.cast(forge.effectContext(smith, smith, null));
    equal(smith.weaponEnchant, 'lightningMind', 'and Objects Lightning Mind charges it with conducting bolts');

    const kindler = godUnit('Kindler', 1, 300);
    const tinder = godUnit('Tinder', 2, 400);
    const hearth = new GameState([kindler, tinder], 511);
    let pulses = 0;
    const pulse = hearth.pulseBlueflare.bind(hearth);
    hearth.pulseBlueflare = (m: Mage) => {
      pulses += 1;
      pulse(m);
    };
    const thoughtfire = getSpell(['fire', 'mind'], null)!;
    thoughtfire.cast(hearth.effectContext(kindler, tinder, null));
    equal([flare(tinder), pulses], [2, 0], 'Thoughtfire sets 2 Blueflare');
    thoughtfire.cast(hearth.effectContext(kindler, tinder, null));
    equal(pulses, 1, 'and pulses a flare already burning');

    const zapper = godUnit('Zapper', 1, 300);
    const zapped = godUnit('Zapped', 2, 400);
    const wires = new GameState([zapper, zapped], 513);
    wires.spellRollThisCast = 12;
    await getSpell(['lightning', 'mind'], null)!.cast(wires.effectContext(zapper, zapped, null));
    assert(zapped.lightningMindStacks >= 2 && zapped.sanity < 300, 'Synaptic Bolt loads Mindconduct by power, then strikes');

    const stormer = godUnit('Stormer', 1, 300);
    const conductor = godUnit('Conductor', 2, 400);
    const storm = new GameState([stormer, conductor], 515);
    storm.spellRollThisCast = 12;
    void getSpell(['lightning', 'mind'], 'hexcraft')!.cast(storm.effectContext(stormer, stormer, null));
    for (let i = 0; i < 3; i++) {
      dealDamage(storm.effectContext(stormer, conductor, null), conductor, dmg(1, 'sanity'), { canMiss: false });
    }
    equal(conductor.lightningMindStacks, 3, 'Neural Storm: every sanity hit adds a Mindconduct stack');
    const charged = conductor.sanity;
    lawRoundEnd(storm);
    assert(conductor.sanity < charged, 'at round end lightning strikes the most charged mind');
    equal(conductor.lightningMindStacks, 1, 'and halves its stacks');

    const rider = godUnit('Rider', 1, 300);
    const sleeper = godUnit('Sleeper', 2, 400);
    const stable = new GameState([rider, sleeper], 517);
    void getSpell(['mind', 'shadow'], 'life')!.cast(stable.effectContext(rider, null, { x: 360, y: 270 }));
    const mare = stable.summonsOf(rider)[0];
    equal(mare?.summonKind, 'mare', 'Life Mind Shadow raises a Mare');
    const bite = (sanity: number): void => {
      sleeper.sanity = sanity;
      runHitEffects(
        { striker: mare, victim: sleeper, dealt: 1, drinker: rider, ctx: stable.quietContext(mare, sleeper) },
        MINIONS.mare.onHit!
      );
    };
    bite(100);
    assert(sleeper.alive && sleeper.statuses.some((s) => s.kind === 'dot'), 'Its bite leaves a nightmare');
    bite(4);
    equal(sleeper.alive, false, 'and breaks a mind it leaves at 4 sanity or less');

    const reaver = godUnit('Reaver', 1, 300);
    const dreamt = godUnit('Dreamt', 2, 330);
    const reave = new GameState([reaver, dreamt], 519);
    void getSpell(['mind', 'shadow'], 'objects')!.cast(reave.effectContext(reaver, reaver, null));
    imbueAfterStrike(reave, reaver, dreamt, 1);
    const plain = 300 - dreamt.sanity;
    assert(plain >= 1 && plain <= 4, 'Dreamreaver: a landed attack deals 1d4 sanity');
    applyDot(reave.effectContext(reaver, dreamt, null), dreamt, {
      name: 'Test Curse', key: 'dot:test', duration: 2, damage: dmg(0, 'shadow'), damageSpec: '1',
    });
    const before = dreamt.sanity;
    imbueAfterStrike(reave, reaver, dreamt, 1);
    const deep = before - dreamt.sanity;
    assert(deep >= 2 && deep <= 8, 'against a cursed target 2d4');
    equal(dreamt.statuses.find((s) => s.key === 'dot:test')?.duration, 3, 'and its curse lasts a turn longer');

    const dreader = godUnit('Dreader', 1, 300);
    const frayed = godUnit('Frayed', 2, 400, 270, ['mind', 'shadow']);
    const night = new GameState([dreader, frayed], 521);
    void getSpell(['mind', 'shadow'], 'hexcraft')!.cast(night.effectContext(dreader, dreader, null));
    frayed.sanity = 150;
    night.currentIndex = 1;
    night.beginTurn();
    assert(frayed.sanity < 150 && frayed.statuses.some((s) => s.kind === 'forget'), 'Night Terrors grip a frayed mind and steal a word');
    night.isInShadow = (m: Mage) => m === frayed;
    const dark = frayed.sanity;
    dealDamage(night.effectContext(dreader, frayed, null), frayed, dmg(3, 'sanity'), { canMiss: false });
    equal(dark - frayed.sanity, 6, 'and sanity damage in a shadow is doubled');

    const wire = godUnit('Wire', 1, 300);
    const mark = godUnit('Mark', 2, 400);
    const grid = new GameState([wire, mark], 523);
    grid.spellRollThisCast = 16;
    void getSpell(['lightning', 'mind'], 'life')!.cast(grid.effectContext(wire, null, { x: 380, y: 320 }));
    const synapse = grid.summonsOf(wire)[0];
    assert(synapse.lightningMindPower >= 16, 'A Lightning minion keeps its Lightning power');
    grid.currentIndex = 0;
    grid.beginTurn();
    assert(mark.lightningMindStacks + synapse.lightningMindStacks >= 2, 'and the Synapse fires its bolts at your turn start');

    const keeper = godUnit('Keeper', 1, 300);
    const moth = godUnit('Moth', 2, 380);
    const den = new GameState([keeper, moth], 527);
    void getSpell(['fire', 'mind'], 'life')!.cast(den.effectContext(keeper, null, { x: 340, y: 320 }));
    den.currentIndex = 0;
    den.beginTurn();
    assert(flare(moth) >= 1, 'The Candlewight kindles Blueflare on enemies near it');

    const fire = (m: Mage): number =>
      (m.statuses.find((s) => s.kind === 'fire') as { stacks: number } | undefined)?.stacks ?? 0;
    const tamer = godUnit('Tamer', 1, 100);
    const prey = godUnit('Prey', 2, 450);
    const sky = new GameState([tamer, prey], 529);
    sky.spellRollThisCast = 16;
    void getSpell(['lightning', 'mind', 'fire'], 'life')!.cast(sky.effectContext(tamer, null, { x: 400, y: 270 }));
    const wisp = sky.summonsOf(tamer)[0];
    const die = sky.rng.die.bind(sky.rng);
    sky.rng.die = () => 6;
    runPulse(sky, wisp, tamer, MINIONS['stormmind-wisp'].pulse!);
    equal([fire(prey), flare(prey)], [2, 2], 'Stormmind Wisp: a 6 makes every arc strike twice, each setting Fire and Blueflare');
    assert(prey.sanity < 300 && prey.hp < 300, 'through body and mind');
    sky.rng.die = () => 1;
    const tamerHp = tamer.hp;
    runPulse(sky, wisp, tamer, MINIONS['stormmind-wisp'].pulse!);
    sky.rng.die = die;
    equal(wisp.alive, false, 'A 1 overloads it');
    equal(fire(prey), 5, 'and it detonates over everything near it');
    equal(tamer.hp, tamerHp, 'sparing you only out of reach');

    const thinker2 = godUnit('Brainstormer', 1, 300);
    const torch = godUnit('Torch', 2, 400);
    const ember = godUnit('Ember', 2, 450);
    const cold = godUnit('Cold', 2, 500);
    const tempest = new GameState([thinker2, torch, ember, cold], 531);
    tempest.spellRollThisCast = 16;
    void getSpell(['lightning', 'mind', 'fire'], 'hexcraft')!.cast(tempest.effectContext(thinker2, thinker2, null));
    tempest.applyFireStacks(torch, 3, thinker2);
    tempest.applyBlueflareStacks(ember, 1, thinker2);
    tempest.currentIndex = 0;
    tempest.beginTurn();
    assert(torch.hp < 300 && torch.sanity < 300 && fire(torch) === 2, 'Brainstorm strikes the most burning and sets its Fire off');
    assert(ember.sanity < 300, 'and forks to the next burning unit');
    equal([cold.hp, cold.sanity], [300, 300], 'but never to the cold');

    const lone = godUnit('Lone', 1, 300);
    const calm = godUnit('Calm', 2, 400);
    const clear = new GameState([lone, calm], 533);
    clear.spellRollThisCast = 10;
    void getSpell(['lightning', 'mind', 'fire'], 'hexcraft')!.cast(clear.effectContext(lone, lone, null));
    clear.currentIndex = 0;
    clear.beginTurn();
    equal([fire(calm), flare(calm)], [2, 2], 'With nobody burning, Brainstorm sets the nearest enemy alight');
  }],

  ['washes and hurts: knockback by distance, flings, currents, tides, swaps and plain pain', async () => {
    await import('../spells/classSpells');
    const R = (cm: number): number => cm * RANGE_UNIT;

    const splasher = godUnit('Splasher', 1, 300);
    const near = godUnit('Near', 2, 380);
    const puddle = new GameState([splasher, near], 601);
    getSpell(['water'], null)!.cast(puddle.effectContext(splasher, near, null));
    assert(near.hp < 300 && near.x > 380, 'Water hits a close enemy and knocks it back');

    const thrower = godUnit('Thrower', 1, 400);
    const flung = godUnit('Flung', 2, 500);
    const under = godUnit('Under', 2, 280, 220);
    const sea = new GameState([thrower, flung, under], 603);
    const wall = sea.addBarrier({ x: 520, y: 320 }, 0, { shape: 'rect', range: R(2), thickness: 16, owner: 1, ttl: 3 });
    getSpell(['water', 'shatter'], null)!.cast(sea.effectContext(thrower, null, { x: 500, y: 270 }));
    assert(Math.abs(flung.x - 300) < 2 && Math.abs(flung.y - 270) < 2, 'Water Shatter mirrors what it flings through you');
    assert(flung.hp < 300 && flung.hp >= 300 - 11, 'and the flung take 1d6 water and 1d5 shatter');
    assert(Math.abs(wall.x - 280) < 1 && Math.abs(wall.y - 220) < 1, 'Walls are flung too');
    assert(under.hp <= 300 - 2, 'and one landing on a unit crushes it');
    equal(sea.isInBarrier(under.pos), false, 'which is pushed out from under it');

    const tugger = godUnit('Tugger', 1, 300);
    const tugged = godUnit('Tugged', 2, 600);
    const tide = new GameState([tugger, tugged], 605);
    getSpell(['water', 'curse'], null)!.cast(tide.effectContext(tugger, tugged, null));
    tide.currentIndex = 1;
    tide.beginTurn();
    assert(tugged.hp < 300 && Math.abs(tugged.x - (600 - R(2))) < 1, 'Undertow drags its bearer 2cm toward you each tick');

    const keeper = godUnit('Keeper', 1, 300);
    const wanderer = godUnit('Wanderer', 2, 600);
    const lock = new GameState([keeper, wanderer], 607);
    getSpell(['water', 'bind', 'curse'], null)!.cast(lock.effectContext(keeper, wanderer, null));
    wanderer.x = 700;
    lock.currentIndex = 1;
    lock.beginTurn();
    assert(Math.abs(wanderer.x - 600) < 1, 'Tidal Lock drags its bearer back to its spot');

    const digger = godUnit('Digger', 1, 300);
    const wader = godUnit('Wader', 2, 400 + R(2));
    const bilge = new GameState([digger, wader], 609);
    getSpell(['water', 'shadow', 'corrode'], null)!.cast(bilge.effectContext(digger, null, { x: 400, y: 270 }));
    bilge.currentIndex = 1;
    bilge.beginTurn();
    assert(wader.hp < 300 && wader.x < 400 + R(2) - 1, 'A bilge pit bites and draws in whoever starts a turn inside');

    const marker = godUnit('Marker', 1, 600, 300);
    const edgeling = godUnit('Edgeling', 2, 600, FIELD.y + FIELD.h - 10);
    const shore = new GameState([marker, edgeling], 611);
    getSpell(['water', 'curse', 'pierce'], null)!.cast(shore.effectContext(marker, edgeling, null));
    const marked = edgeling.hp;
    shore.currentIndex = 1;
    shore.beginTurn();
    assert(marked - edgeling.hp >= 3, 'Mark of the Tide carries its bearer into the field edge, which slams it');

    const swapper = godUnit('Swapper', 1, 300);
    const lost = godUnit('Lost', 2, 500);
    const atSea = new GameState([swapper, lost], 613);
    await getSpell(['water', 'bind', 'mind'], null)!.cast(atSea.effectContext(swapper, lost, null));
    assert(Math.abs(swapper.x - 500) < 1 && Math.abs(lost.x - 300) < 1, 'Lost at Sea trades places, with you by default');
    assert(lost.sanity < 300 && lost.isStunned('movement'), 'and the enemy moved is hurt and rooted');

    const hurter = godUnit('Hurter', 1, 300);
    const hurt = godUnit('Hurt', 2, 600);
    const ache = new GameState([hurter, hurt], 615);
    getSpell(['pain'], null)!.cast(ache.effectContext(hurter, hurt, null));
    assert(hurt.hp === 300 && hurt.sanity < 300 && hurt.sanity >= 296, 'Pain alone is 1d4 sanity');
    const sanity = hurt.sanity;
    getSpell(['pain', 'corrode'], null)!.cast(ache.effectContext(hurter, hurt, null));
    assert(hurt.hp <= 299 && hurt.hp >= 294 && hurt.sanity < sanity, 'Corrode Pain adds 1d6 corrosive to 1d4 sanity');
    const before = hurt.sanity;
    getSpell(['pain', 'shadow'], null)!.cast(ache.effectContext(hurter, hurt, null));
    assert(before - hurt.sanity >= 2 && before - hurt.sanity <= 12, 'Shadow Pain is 2d6 sanity');

    const pusher = godUnit('Pusher', 1, 600, 300);
    const panicked = godUnit('Panicked', 2, 600, FIELD.y + FIELD.h - 10);
    const panic = new GameState([pusher, panicked], 617);
    getSpell(['water', 'pain'], null)!.cast(panic.effectContext(pusher, panicked, null));
    assert(300 - panicked.sanity >= 2, 'Water Pain panics a mind it slams into the edge');
  }],

  ['makes the field flow: Water minions lure, swap and rewind, Water gear pushes and drags, Water laws carry everyone', async () => {
    await import('../spells/classSpells');
    const R = (cm: number): number => cm * RANGE_UNIT;
    const stacks = (m: Mage, kind: string): number =>
      (m.statuses.find((s) => s.kind === kind) as { stacks: number } | undefined)?.stacks ?? 0;
    const forgot = (m: Mage): number =>
      (m.statuses.find((s) => s.kind === 'forget') as { forgotten: string[] } | undefined)?.forgotten.length ?? 0;
    const summon = (game: GameState, owner: Mage, words: WordId[], at: { x: number; y: number }): Mage => {
      void getSpell(words, 'life')!.cast(game.effectContext(owner, null, at));
      const raised = game.summonsOf(owner);
      return raised[raised.length - 1];
    };

    const kinds: [WordId[], string][] = [
      [['water', 'mind'], 'undine'],
      [['water', 'shadow'], 'drowner'],
      [['water', 'reality'], 'riptide-spirit'],
      [['water', 'fire'], 'geyser'],
      [['water', 'lightning'], 'storm-eel'],
      [['water', 'pain'], 'drowned-thrall'],
      [['water', 'mind', 'shadow'], 'abyssal-eye'],
      [['water', 'mind', 'reality'], 'tide-clock'],
      [['water', 'mind', 'fire'], 'kettle-spirit'],
      [['water', 'mind', 'lightning'], 'brine-synapse'],
      [['water', 'mind', 'pain'], 'siren'],
      [['water', 'shadow', 'pain'], 'abyssal-maw'],
      [['water', 'fire', 'lightning'], 'thundercloud'],
    ];
    for (const [words, kind] of kinds) {
      const raiser = godUnit('Raiser', 1, 300);
      const field = new GameState([raiser, godUnit('Other', 2, 900)], 699);
      equal(summon(field, raiser, words, { x: 500, y: 270 })?.summonKind, kind, `Life ${words.join(' ')} raises its minion`);
    }

    // ---- Minions ----
    const singer = godUnit('Singer', 1, 200);
    const listener = godUnit('Listener', 2, 500, 270, ['mind', 'shadow', 'veil']);
    const cove = new GameState([singer, listener], 701);
    const undine = summon(cove, singer, ['water', 'mind'], { x: 380, y: 270 });
    runPulse(cove, undine, singer, MINIONS.undine.pulse!);
    assert(listener.x < 500 - R(1), 'The Undine draws the nearest enemy toward it');
    equal(forgot(listener), 1, 'and makes it forget a word');

    const caller = godUnit('Caller', 1, 200);
    const swept = godUnit('Swept', 2, 600);
    const rip = new GameState([caller, swept], 703);
    const spirit = summon(rip, caller, ['water', 'reality'], { x: 400, y: 270 });
    runPulse(rip, spirit, caller, MINIONS['riptide-spirit'].pulse!);
    assert(Math.abs(swept.x - 400) < 1 && Math.abs(spirit.x - 600) < 1, 'A Riptide Spirit trades places with the nearest enemy');
    assert(swept.hp < 300, 'which takes water');

    const keeper = godUnit('Keeper', 1, 200);
    const scalded = godUnit('Scalded', 2, 470);
    const spring = new GameState([keeper, scalded], 705);
    const geyser = summon(spring, keeper, ['water', 'fire'], { x: 400, y: 270 });
    runPulse(spring, geyser, keeper, MINIONS.geyser.pulse!);
    assert(scalded.hp < 300 && stacks(scalded, 'fire') === 1 && scalded.x > 470 + R(1), 'A Geyser scalds, kindles and throws back the enemies near it');

    const deep = godUnit('Deep', 1, 200);
    const friend = godUnit('Friend', 1, 500);
    const prey = godUnit('Prey', 2, 400, 370);
    const abyss = new GameState([deep, friend, prey], 707);
    const maw = summon(abyss, deep, ['water', 'shadow', 'pain'], { x: 400, y: 270 });
    runPulse(abyss, maw, deep, MINIONS['abyssal-maw'].pulse!);
    assert(friend.x < 500 && friend.sanity < 300, 'The Abyssal Maw drags in and frightens allies too');
    assert(prey.y < 370 && prey.sanity < 300, 'as well as enemies');
    equal(deep.sanity, 300, 'but never its summoner');

    const clocker = godUnit('Clocker', 1, 200);
    const strayed = godUnit('Strayed', 2, 600);
    const clock = new GameState([clocker, strayed], 709);
    const tick = summon(clock, clocker, ['water', 'mind', 'reality'], { x: 500, y: 370 });
    strayed.turnStartState = { x: 800, y: 270, hp: 300, sanity: 300 };
    runPulse(clock, tick, clocker, MINIONS['tide-clock'].pulse!);
    assert(strayed.x > 600 + R(3), 'A Tide Clock carries an enemy back toward where its turn began');

    const watcher = godUnit('Watcher', 1, 200);
    const dreamer = godUnit('Dreamer', 2, 500, 270, ['mind', 'veil']);
    const trench = new GameState([watcher, dreamer], 711);
    const eye = summon(trench, watcher, ['water', 'mind', 'shadow'], { x: 500, y: 380 });
    equal(trench.shadows.length, 1, 'An Abyssal Eye opens a shadow under itself');
    trench.addShadow(dreamer.pos, 1);
    runPulse(trench, eye, watcher, MINIONS['abyssal-eye'].pulse!);
    equal(forgot(dreamer), 1, 'and an enemy standing in a shadow near it forgets a word');
    const drowner = summon(trench, watcher, ['water', 'shadow'], { x: 550, y: 270 });
    runHitEffects(
      { striker: drowner, victim: dreamer, dealt: 2, drinker: watcher, ctx: trench.quietContext(drowner, dreamer) },
      MINIONS.drowner.onHit!
    );
    assert(dreamer.isStunned('movement') && dreamer.hp < 300, 'A Drowner roots and darkens a victim caught in a shadow');
    const pools = trench.shadows.length;
    dealDamage(trench.effectContext(dreamer, drowner, null), drowner, dmg(100, 'generic'), { canMiss: false });
    equal([drowner.alive, trench.shadows.length], [false, pools + 1], 'and leaves a shadow where it dies');

    const angler = godUnit('Angler', 1, 200);
    const fish = godUnit('Fish', 2, 520);
    const reef = new GameState([angler, fish], 713);
    reef.spellRollThisCast = 16;
    const eel = summon(reef, angler, ['water', 'lightning'], { x: 400, y: 270 });
    assert(eel.lightningMindPower >= 16, 'A Storm Eel keeps its Lightning power');
    runPulse(reef, eel, angler, MINIONS['storm-eel'].pulse!);
    assert(fish.hp < 300 && fish.x > 520 + R(1), 'and shocks the nearest enemy, throwing it back');
    const brine = summon(reef, angler, ['water', 'mind', 'lightning'], { x: 400, y: 370 });
    runPulse(reef, brine, angler, MINIONS['brine-synapse'].pulse!);
    assert(fish.lightningMindStacks === 1 && fish.sanity < 300, 'A Brine Synapse bolts an enemy mind');

    const shepherd = godUnit('Shepherd', 1, 200);
    const lamb = godUnit('Lamb', 2, 500);
    const flock = godUnit('Flock', 2, 500 + R(1.5));
    const sky = new GameState([shepherd, lamb, flock], 715);
    sky.spellRollThisCast = 16;
    const cloud = summon(sky, shepherd, ['water', 'fire', 'lightning'], { x: 530, y: 400 });
    const spots = [{ ...lamb.pos }, { ...flock.pos }];
    runPulse(sky, cloud, shepherd, MINIONS.thundercloud.pulse!);
    const struckOne = [lamb, flock].findIndex((m) => m.hp < 300 && stacks(m, 'fire') === 1);
    assert(struckOne >= 0, 'A Thundercloud strikes a unit near it and sets it alight');
    const other = [lamb, flock][1 - struckOne];
    assert(dist(other.pos, spots[1 - struckOne]) > R(1), 'and the thunderclap throws the one beside it');
    equal(shepherd.hp, 300, 'never striking its summoner');

    const lurer = godUnit('Lurer', 1, 200);
    const lured = godUnit('Lured', 2, 600);
    const shoal = new GameState([lurer, lured], 717);
    const siren = summon(shoal, lurer, ['water', 'mind', 'pain'], { x: 300, y: 270 });
    runPulse(shoal, siren, lurer, MINIONS.siren.pulse!);
    assert(Math.abs(lured.x - (600 - R(3))) < 1 && lured.sanity < 300, 'A Siren lures the nearest enemy 3cm and frightens it');
    const kettle = summon(shoal, lurer, ['water', 'mind', 'fire'], { x: 300, y: 400 });
    runPulse(shoal, kettle, lurer, MINIONS['kettle-spirit'].pulse!);
    equal(stacks(lured, 'blueflare'), 2, 'A Kettle Spirit lures and kindles 2 Blueflare');

    // ---- Objects ----
    const warden = godUnit('Warden', 1, 300);
    const brute = godUnit('Brute', 2, 360, 270, ['shatter', 'pierce']);
    const ward = new GameState([warden, brute], 719);
    void getSpell(['water', 'mind'], 'objects')!.cast(ward.effectContext(warden, warden, null));
    imbueAfterStrike(ward, brute, warden, 3);
    assert(brute.x > 360 + R(2) && forgot(brute) === 1, 'Undertow Mantle throws an attacker back and steals a word');
    void getSpell(['water', 'reality'], 'objects')!.cast(ward.effectContext(warden, warden, null));
    const bruteX = brute.x;
    assert(imbueDeflects(ward, brute, warden), 'Tidal Ward turns a basic attack aside');
    assert(brute.x > bruteX + R(3), 'and throws the attacker 4cm away');

    const smith = godUnit('Smith', 1, 300);
    const anvil = godUnit('Anvil', 2, 360);
    const forge = new GameState([smith, anvil], 721);
    void getSpell(['water', 'fire'], 'objects')!.cast(forge.effectContext(smith, smith, null));
    imbueAfterStrike(forge, smith, anvil, 2);
    assert(stacks(anvil, 'fire') === 1 && anvil.x > 360 + R(0.5) && anvil.hp === 300, 'Steamblade sets a cold target alight and pushes it');
    imbueAfterStrike(forge, smith, anvil, 2);
    assert(anvil.hp < 300 && stacks(anvil, 'fire') === 2, 'and scalds one already burning');

    const stormSmith = godUnit('StormSmith', 1, 300);
    const lightningRod = godUnit('Rod', 2, 360);
    const smithy = new GameState([stormSmith, lightningRod], 723);
    smithy.spellRollThisCast = 12;
    void getSpell(['water', 'fire', 'lightning'], 'objects')!.cast(smithy.effectContext(stormSmith, stormSmith, null));
    imbueAfterStrike(smithy, stormSmith, lightningRod, 2);
    assert(lightningRod.hp < 300 && stacks(lightningRod, 'fire') === 1, 'Storm Trident calls lightning onto the target');
    assert(stormSmith.x < 300 - R(1), 'and its thunderclap throws the wielder back too');

    const mailer = godUnit('Mailer', 1, 300);
    const hitter = godUnit('Hitter', 2, 360);
    const mailRoom = new GameState([mailer, hitter], 725);
    mailRoom.spellRollThisCast = 12;
    void getSpell(['water', 'mind', 'lightning'], 'objects')!.cast(mailRoom.effectContext(mailer, mailer, null));
    imbueAfterStrike(mailRoom, hitter, mailer, 2);
    assert(hitter.lightningMindStacks === 1 && hitter.sanity < 300 && hitter.x > 360 + R(1), 'Static Mail bolts and repels whoever strikes the bearer');

    const hooker = godUnit('Hooker', 1, 300);
    const hooked = godUnit('Hooked', 2, 600);
    const dock = new GameState([hooker, hooked], 727);
    void getSpell(['water', 'shadow'], 'objects')!.cast(dock.effectContext(hooker, hooker, null));
    imbueAfterStrike(dock, hooker, hooked, 2);
    assert(Math.abs(hooked.x - (600 - R(2))) < 1 && hooked.hp === 300, 'Blackwater Hook drags the target 2cm in');
    dock.addShadow({ x: hooked.x - R(1), y: hooked.y }, 1);
    imbueAfterStrike(dock, hooker, hooked, 2);
    assert(hooked.hp < 300, 'and cuts into one standing in a shadow');

    const ebber = godUnit('Ebber', 1, 300);
    const ebbed = godUnit('Ebbed', 2, 600, 270, ['shatter']);
    const strand = new GameState([ebber, ebbed], 729);
    void getSpell(['water', 'mind', 'reality'], 'objects')!.cast(strand.effectContext(ebber, ebber, null));
    assert(robeOf(ebber), 'Objects Water Mind Reality is a robe');
    strand.rng.chance = () => true;
    castRobe(strand, ebber);
    assert(Math.abs(ebber.x - 600) < 1 && Math.abs(ebbed.x - 300) < 1, 'The Robe of Ebb trades places with the nearest enemy');
    equal(forgot(ebbed), 1, 'which forgets a word');

    // ---- Laws ----
    const tider = godUnit('Tider', 1, 300);
    const drifter = godUnit('Drifter', 2, 400, 270, ['shatter', 'pierce', 'veil']);
    const ebb = new GameState([tider, drifter], 731);
    void getSpell(['water', 'mind'], 'hexcraft')!.cast(ebb.effectContext(tider, tider, null));
    getSpell(['water'], null)!.cast(ebb.effectContext(tider, drifter, null));
    assert(drifter.x > 400 && forgot(drifter) === 1, 'Tides of Forgetting: a unit pushed by force forgets a word');

    const underlord = godUnit('Underlord', 1, 300);
    const swimmer = godUnit('Swimmer', 2, 700);
    const under = new GameState([underlord, swimmer], 733);
    void getSpell(['water', 'shadow'], 'hexcraft')!.cast(under.effectContext(underlord, underlord, null));
    equal(under.shadows.length, 1, 'Black Undertow opens a shadow under its caster');
    under.currentIndex = 1;
    under.beginTurn();
    assert(Math.abs(swimmer.x - (700 - R(2))) < 1, 'and drags a unit 2cm toward the nearest shadow at its turn start');
    under.currentIndex = 0;
    under.beginTurn();
    assert(underlord.hp < 300, 'soaking one that starts its turn in a shadow, its caster included');

    const turner = godUnit('Turner', 1, 300);
    const boat = godUnit('Boat', 2, 600);
    const tide = new GameState([turner, boat], 735);
    void getSpell(['water', 'reality'], 'hexcraft')!.cast(tide.effectContext(turner, turner, null));
    lawRoundEnd(tide);
    assert(Math.abs(boat.x - (600 + R(3))) < 1 && Math.abs(turner.x - (300 + R(3))) < 1, 'Turning Tide carries everyone 3cm right');
    lawRoundEnd(tide);
    assert(Math.abs(boat.y - (270 + R(3))) < 1, 'then down');

    const boiler = godUnit('Boiler', 1, 300);
    const pot = godUnit('Pot', 2, 500);
    const steam = new GameState([boiler, pot], 737);
    void getSpell(['water', 'fire'], 'hexcraft')!.cast(steam.effectContext(boiler, boiler, null));
    dealDamage(steam.effectContext(boiler, pot, null), pot, dmg(1, 'water'), { canMiss: false });
    equal(stacks(pot, 'fire'), 1, 'Scalding Water: a water hit sets its victim alight');
    dealDamage(steam.effectContext(boiler, pot, null), pot, dmg(1, 'heat'), { canMiss: false });
    assert(Math.abs(pot.x - (500 + R(1))) < 1, 'and a heat hit pushes its victim 1cm away');

    const sparker = godUnit('Sparker', 1, 300);
    const wet = godUnit('Wet', 2, 600);
    const wetter = godUnit('Wetter', 2, 600 + R(1.5));
    const sea = new GameState([sparker, wet, wetter], 739);
    sea.spellRollThisCast = 12;
    void getSpell(['water', 'lightning'], 'hexcraft')!.cast(sea.effectContext(sparker, sparker, null));
    dealDamage(sea.effectContext(sparker, wet, null), wet, dmg(1, 'water'), { canMiss: false });
    assert(wetter.hp < 300, 'Conductive Sea: a water hit arcs to the nearest other unit');
    equal(sparker.hp, 300, 'not to a caster further away');

    const panicker = godUnit('Panicker', 1, 600, 300);
    const cornered = godUnit('Cornered', 2, 600, FIELD.y + FIELD.h - 10);
    const shore = new GameState([panicker, cornered], 741);
    void getSpell(['water', 'pain'], 'hexcraft')!.cast(shore.effectContext(panicker, panicker, null));
    shore.forceMove(panicker, cornered, { x: 600, y: FIELD.y + FIELD.h + R(2) });
    assert(cornered.sanity < 300, 'Panic Tide: a slam frightens');
    const scared = cornered.sanity;
    lawTurnEnd(shore, cornered);
    assert(cornered.sanity < scared, 'and so does ending a turn against the field edge');

    const memorist = godUnit('Memorist', 1, 300);
    const forgetful = godUnit('Forgetful', 2, 700, 270, ['shatter', 'pierce']);
    const memory = new GameState([memorist, forgetful], 743);
    void getSpell(['water', 'mind', 'shadow'], 'hexcraft')!.cast(memory.effectContext(memorist, memorist, null));
    equal(memory.shadows.length, 1, 'Drowned Memories opens a shadow under the nearest enemy');
    memory.currentIndex = 1;
    memory.beginTurn();
    equal(forgot(forgetful), 1, 'which forgets a word as its turn starts there');
    forgetful.x = 1000;
    lawRoundEnd(memory);
    assert(memory.shadows[0].x > 700 + R(1), 'and at round end the shadow drifts after its enemy');

    const rememberer = godUnit('Rememberer', 1, 300);
    const runner = godUnit('Runner', 2, 600);
    const recall = new GameState([rememberer, runner], 745);
    void getSpell(['water', 'mind', 'reality'], 'hexcraft')!.cast(recall.effectContext(rememberer, rememberer, null));
    runner.x = 900;
    lawRoundEnd(recall);
    assert(Math.abs(runner.x - (900 - R(3))) < 1, 'The Tide Remembers draws a unit 3cm back toward where the round began');
    lawRoundEnd(recall);
    assert(Math.abs(runner.x - (900 - R(3))) < 1, 'and then remembers its new place');

    const brewer = godUnit('Brewer', 1, 300);
    const brewed = godUnit('Brewed', 2, 400);
    const cauldron = new GameState([brewer, brewed], 747);
    let boils = 0;
    const pulse = cauldron.pulseBlueflare.bind(cauldron);
    cauldron.pulseBlueflare = (m: Mage) => {
      boils += 1;
      pulse(m);
    };
    void getSpell(['water', 'mind', 'fire'], 'hexcraft')!.cast(cauldron.effectContext(brewer, brewer, null));
    dealDamage(cauldron.effectContext(brewer, brewed, null), brewed, dmg(1, 'water'), { canMiss: false });
    equal([stacks(brewed, 'blueflare'), boils], [1, 0], 'Boiling Thoughts: a water hit kindles 1 Blueflare');
    cauldron.forceMove(brewer, brewed, { x: 500, y: 270 });
    equal(boils, 1, 'and moving a smouldering unit by force sets it off');

    const currenter = godUnit('Currenter', 1, 300);
    const soaked = godUnit('Soaked', 2, 600);
    const beside = godUnit('Beside', 2, 600 + R(1.5));
    const stream = new GameState([currenter, soaked, beside], 749);
    stream.spellRollThisCast = 12;
    void getSpell(['water', 'mind', 'lightning'], 'hexcraft')!.cast(stream.effectContext(currenter, currenter, null));
    dealDamage(stream.effectContext(currenter, soaked, null), soaked, dmg(1, 'water'), { canMiss: false });
    assert(
      soaked.lightningMindStacks === 1 && beside.lightningMindStacks === 1 && beside.sanity < 300,
      'Mind Current charges the soaked and arcs into the nearest mind'
    );

    const flincher = godUnit('Flincher', 1, 300);
    const flinch = godUnit('Flinch', 2, 500);
    const nerves = new GameState([flincher, flinch], 751);
    void getSpell(['water', 'mind', 'pain'], 'hexcraft')!.cast(nerves.effectContext(flincher, flincher, null));
    dealDamage(nerves.effectContext(flincher, flinch, null), flinch, dmg(4, 'sanity'), { canMiss: false });
    assert(Math.abs(flinch.x - (500 + R(2))) < 1, 'Flinching Law: 4 sanity lost pushes a unit 2cm away');

    const whirler = godUnit('Whirler', 1, 200);
    const sucked = godUnit('Sucked', 2, 640 + R(5));
    const vortex = new GameState([whirler, sucked], 753);
    void getSpell(['water', 'shadow', 'pain'], 'hexcraft')!.cast(vortex.effectContext(whirler, whirler, null));
    vortex.currentIndex = 1;
    vortex.beginTurn();
    assert(Math.abs(sucked.x - (640 + R(3))) < 1 && sucked.sanity < 300, 'The Maelstrom drags a unit toward the centre and frightens it there');

    const squaller = godUnit('Squaller', 1, 200);
    const torch = godUnit('Torch', 2, 600);
    const bystander = godUnit('Bystander', 2, 600 + R(1.5));
    const gale = new GameState([squaller, torch, bystander], 755);
    gale.spellRollThisCast = 12;
    void getSpell(['water', 'fire', 'lightning'], 'hexcraft')!.cast(gale.effectContext(squaller, squaller, null));
    gale.applyFireStacks(torch, 2, squaller);
    lawRoundEnd(gale);
    assert(torch.hp < 300, 'Squall strikes the most burning unit');
    assert(bystander.x > 600 + R(2.5) && stacks(bystander, 'fire') === 1, 'and throws the units beside it back, alight');

    // ---- The blue-red ordinaries ----
    const jetter = godUnit('Jetter', 1, 300);
    const jetted = godUnit('Jetted', 2, 500);
    const jetMate = godUnit('JetMate', 2, 500, 420);
    const jets = new GameState([jetter, jetted, jetMate], 757);
    getSpell(['water', 'fire'], null)!.cast(jets.effectContext(jetter, jetted, null));
    assert(stacks(jetted, 'fire') === 1 && jetted.x > 500 + R(2), 'Scalding Jet sets a cold target alight and pushes it');
    jetMate.x = jetted.x;
    jetMate.y = jetted.y + R(1.5);
    getSpell(['water', 'fire'], null)!.cast(jets.effectContext(jetter, jetted, null));
    assert(stacks(jetted, 'fire') === 0 && jetMate.hp < 300, 'and boils a burning one off as steam over the enemies beside it');

    const waver = godUnit('Waver', 1, 300);
    const waved = godUnit('Waved', 2, 600);
    const neighbour = godUnit('Neighbour', 2, 600, 270 + R(1.5));
    const surf = new GameState([waver, waved, neighbour], 759);
    surf.spellRollThisCast = 12;
    getSpell(['water', 'lightning'], null)!.cast(surf.effectContext(waver, waved, null));
    assert(waved.hp < 300 && waved.x > 600 && neighbour.hp < 300, 'Conducting Wave pushes, and its lightning runs into whoever stands beside');

    const scalder = godUnit('Scalder', 1, 300);
    const thinker = godUnit('Thinker', 2, 500);
    const kitchen = new GameState([scalder, thinker], 761);
    getSpell(['water', 'mind', 'fire'], null)!.cast(kitchen.effectContext(scalder, thinker, null));
    assert(stacks(thinker, 'blueflare') === 2 && thinker.x > 500 + R(1), 'Scalding Memory kindles 2 Blueflare and pushes');

    const staticer = godUnit('Staticer', 1, 300);
    const zapped = godUnit('Zapped', 2, 300 + R(2));
    const fizz = new GameState([staticer, zapped], 763);
    fizz.spellRollThisCast = 12;
    getSpell(['water', 'mind', 'lightning'], null)!.cast(fizz.effectContext(staticer, null, null));
    assert(
      zapped.lightningMindStacks === 1 && zapped.sanity < 300 && zapped.x > 300 + R(3),
      'Static Tide charges, shocks and repels the enemies around you'
    );

    const stormer = godUnit('Stormer', 1, 300);
    const underStorm = godUnit('UnderStorm', 2, 700);
    const nearStorm = godUnit('NearStorm', 2, 700 + R(3));
    const heath = new GameState([stormer, underStorm, nearStorm], 765);
    heath.spellRollThisCast = 12;
    getSpell(['water', 'fire', 'lightning'], null)!.cast(heath.effectContext(stormer, null, { x: 700, y: 270 }));
    assert(underStorm.hp < 300 && stacks(underStorm, 'fire') === 1, 'Storm Call strikes and kindles whatever stands under it');
    assert(nearStorm.x > 700 + R(4) && nearStorm.hp === 300, 'and its thunderclap throws back whatever stands near');
  }],
];

for (const [name, run] of tests) {
  await run();
  console.log(`PASS ${name}`);
}
console.log(`Combat rules: ${tests.length} checks passed.`);