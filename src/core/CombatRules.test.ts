import { applyDebuff, applyDot, applyInvisibility, applyStun, areaDamage, dash, dealDamage, heal, teleport } from '../effects/effects';
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
import { getItem } from './Items';
import { getSpell, rackCoverage, setActiveSpellSets, spellForSelection } from '../spells/registry';
import {
  addImbue,
  applyStifle,
  castRobe,
  imbueAfterStrike,
  imbueDeflects,
  imbueTurnStart,
  lawRoundEnd,
  lawTurnEnd,
  MINIONS,
  robeOf,
  runHitEffects,
  runPulse,
  UNREALITY_KEY,
} from '../effects/classKit';
import { ruleRoundEnd } from '../effects/ruleLaws';
import { offerToShikigami, shoulderTurn } from '../effects/deathKit';
import { capturePartySnapshot, restoreParty } from '../pve/exploration/party';
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
    const spell = getSpell(['bind', 'shatter', 'pierce'], null);
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
    const spell = getSpell(['bind', 'curse', 'pierce'], null);
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

    const coffin = getSpell(['stop', 'veil', 'shatter'], null);
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
    void getSpell(['stop', 'bind', 'veil'], null)!.cast(still.effectContext(warded, warded, null));
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
    void getSpell(['stop', 'bind', 'pierce'], null)!.cast(clock.effectContext(clock.mages[0], stalled, null));
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

    const reflexes = getSpell(['stop', 'veil', 'pierce'], null);
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
    void getSpell(['stop', 'shatter', 'pierce'], null)!.cast(duel.effectContext(caster, striker, null));
    assert(300 - striker.hp >= 4, 'The counterstrike lands 2d6 pierce and 2d6 shatter');
    equal(striker.isStunned('full'), true, 'and a blow aimed at the caster leaves its source stunned');
    const struck = godUnit('Struck', 2, 800);
    const aside = new GameState([caster, struck], 161);
    aside.counteredItem = aside.makeSpellItem(struck, pierce, godUnit('Bystander', 1, 650), null);
    void getSpell(['stop', 'shatter', 'pierce'], null)!.cast(aside.effectContext(caster, struck, null));
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
    void getSpell(['desecrate', 'curse', 'shatter'], null)!.cast(chain.effectContext(caster, null, { x: 600, y: 270 }));
    dealDamage(chain.effectContext(caster, a, null), a, dmg(9999, 'typeless'));
    equal(b.alive, false, 'The first body bursts and kills the second');
    assert(c.hp < 300, 'whose own burst carries the chain on');

    const walker = creature('Walker', 400);
    const thorns = new GameState([caster, walker], 181);
    void getSpell(['desecrate', 'curse', 'pierce'], null)!.cast(thorns.effectContext(caster, null, null));
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
    void getSpell(['desecrate', 'shatter', 'pierce'], null)!.cast(spire.effectContext(caster, null, { x: 600, y: 270 }));
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
    void getSpell(['stop', 'bind', 'shatter'], null)!.cast(halt.effectContext(halt.mages[0], null, null));
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

  ['gives every Corrode, Veil, Mind, Water, Shadow, Lightning, Pierce, Drain, Bind, Curse and Death combo an ordinary spell and three class variants, and a modifier undoes the class', async () => {
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
    const shadowPairs = new Set(['lightning+fire', 'lightning+pain', 'fire+pain', 'pain+death', 'pain+mind']);
    const shadow = wave('shadow', ['lightning', 'fire', 'pain', 'death', 'mind'], (a, b) => !shadowPairs.has(`${a}+${b}`));
    const lightning = wave('lightning', ['fire', 'pain'], () => false);
    const pierce = wave(
      'pierce',
      ['twist', 'bind', 'shatter', 'drain', 'curse', 'desecrate'],
      (a, b) => b === 'desecrate' && (a === 'twist' || a === 'bind')
    );
    const drain = wave(
      'drain',
      ['twist', 'bind', 'shatter', 'curse', 'desecrate'],
      (a, b) => b === 'desecrate' && (a === 'twist' || a === 'bind')
    );
    equal(corrode.length, 33, 'The Corrode wave covers 33 combinations');
    equal(veil.length, 21, 'The Veil wave covers 21 more');
    equal(mind.length, 5, 'The Mind wave covers 5 more (Reality joins only blue; red, black and blue never meet)');
    equal(water.length, 13, 'The Water wave covers 13 more');
    equal(shadow.length, 10, 'The Shadow wave covers 10 (Mind Shadow came with Mind, the Water ones with Water)');
    equal(lightning.length, 3, 'The Lightning wave covers the last 3 (Mind, Water and Shadow brought the rest)');
    equal(pierce.length, 19, 'The Pierce wave covers 19 (Corrode and Veil brought theirs; Desecrate joins neither Bind nor Twist)');
    equal(drain.length, 13, 'The Drain wave covers 13 (Corrode, Veil and Pierce brought theirs)');
    const bind = wave('bind', ['twist', 'shatter', 'curse'], () => false);
    equal(bind.length, 6, 'The Bind wave covers the last 6 (Desecrate never joins blue)');
    const curse = wave('curse', ['shatter', 'twist', 'desecrate'], (a, b) => a === 'twist' && b === 'desecrate');
    equal(curse.length, 5, 'The Curse wave covers 5 (Twist never meets Desecrate)');
    // Death takes only black and colourless words; Shadow brought Death Shadow (Pain).
    const death: WordId[][] = [['death', 'pain']];
    for (const combo of [...corrode, ...veil, ...mind, ...water, ...shadow, ...lightning, ...pierce, ...drain, ...bind, ...curse, ...death]) {
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

  ['spoils minds: unreality, burning thoughts, conducting storms, nightmares and brainstorms', async () => {
    await import('../spells/classSpells');
    const strike = getSpell(['pierce'], null)!;
    const flare = (m: Mage): number =>
      (m.statuses.find((s) => s.kind === 'blueflare') as { stacks: number } | undefined)?.stacks ?? 0;

    const thinker = godUnit('Thinker', 1, 300);
    const lighter = godUnit('Lighter', 2, 400);
    const focus = new GameState([thinker, lighter], 505);
    void getSpell(['fire', 'mind'], 'hexcraft')!.cast(focus.effectContext(lighter, lighter, null));
    focus.pushStack(focus.makeSpellItem(thinker, getSpell(['mind', 'shadow'], null)!, lighter, null));
    equal(flare(thinker), 2, 'Burning Focus: a two-word spell kindles 2 Blueflare on its caster');

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
      [['water', 'reality'], 'elsewhere-tide'],
      [['water', 'fire'], 'geyser'],
      [['water', 'lightning'], 'storm-eel'],
      [['water', 'pain'], 'drowned-thrall'],
      [['water', 'mind', 'shadow'], 'abyssal-eye'],
      [['water', 'mind', 'reality'], 'dream-tide'],
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

    const boiler = godUnit('Boiler', 1, 300);
    const pot = godUnit('Pot', 2, 500);
    const steam = new GameState([boiler, pot], 737);
    void getSpell(['water', 'fire'], 'hexcraft')!.cast(steam.effectContext(boiler, boiler, null));
    dealDamage(steam.effectContext(boiler, pot, null), pot, dmg(1, 'water'), { canMiss: false });
    equal(stacks(pot, 'fire'), 1, 'Scalding Water: a water hit sets its victim alight');
    dealDamage(steam.effectContext(boiler, pot, null), pot, dmg(1, 'heat'), { canMiss: false });
    assert(Math.abs(pot.x - (500 + R(1))) < 1, 'and a heat hit pushes its victim 1cm away');

    const sparker = godUnit('Sparker', 1, 300);
    const jolted = godUnit('Jolted', 2, 600);
    const runner = godUnit('Runner', 2, 600, 400);
    const pal = godUnit('Pal', 1, 560, 420);
    const sea = new GameState([sparker, jolted, runner, pal], 739);
    void getSpell(['water', 'lightning'], 'hexcraft')!.cast(sea.effectContext(sparker, sparker, null));
    dealDamage(sea.effectContext(sparker, jolted, null), jolted, dmg(1, 'pierce'), { canMiss: false });
    const knocked = jolted.x - 600;
    assert(Math.abs(jolted.y - 270) < 1 && knocked > R(1) - 1 && knocked < R(4) + 1, 'Conductive Sea: a hit knocks an enemy back 1d4cm');
    const trail = sea.hazardZones.find((z) => z.name === 'Lightning Trail');
    assert(trail?.crossOnly && trail.toX != null && Math.abs(trail.toX - jolted.x) < 1, 'leaving a lightning trail behind it');
    equal(trail.untilTurn, sea.turnSeq + 4, 'for one full turn cycle');
    sea.forceMove(sparker, pal, { x: 640, y: 120 });
    equal(pal.hp, 300, 'your own side crosses it unharmed');
    sea.forceMove(sparker, runner, { x: 600, y: 200 });
    assert(runner.hp < 300 && runner.hp >= 290, 'an enemy moving through it takes 1d10 heat');
    sea.turnSeq = trail.untilTurn! - 1;
    sea.currentIndex = 0;
    sea.beginTurn();
    equal(sea.hazardZones.includes(trail), false, 'and then it is gone');

    const bouncer = godUnit('Bouncer', 1, FIELD.x + FIELD.w - 200);
    const pinball = godUnit('Pinball', 2, FIELD.x + FIELD.w - 25);
    const rim = new GameState([bouncer, pinball], 740);
    void getSpell(['water', 'lightning'], 'hexcraft')!.cast(rim.effectContext(bouncer, bouncer, null));
    dealDamage(rim.effectContext(bouncer, pinball, null), pinball, dmg(1, 'pierce'), { canMiss: false });
    const trails = rim.hazardZones.filter((z) => z.name === 'Lightning Trail');
    assert(
      pinball.hp === 299 && trails.length === 2 && trails[0].groupId === trails[1].groupId && pinball.x < FIELD.x + FIELD.w - 1,
      'knocked into the field edge, it bounces off it unharmed, its trail bending with it'
    );

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

  ['amplifies: Shadow trinkets, auras and laws make the other word stronger, now and then more so in the dark', async () => {
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
    const lay = (game: GameState, caster: Mage, words: WordId[]): void => {
      void getSpell(words, 'hexcraft')!.cast(game.effectContext(caster, caster, null));
    };
    const wear = (game: GameState, bearer: Mage, words: WordId[]): void => {
      void getSpell(words, 'objects')!.cast(game.effectContext(bearer, bearer, null));
    };

    const kinds: [WordId[], string][] = [
      [['lightning', 'shadow'], 'umbral-coil'],
      [['fire', 'shadow'], 'cinder-shade'],
      [['pain', 'shadow'], 'wailing-shade'],
      [['lightning', 'fire', 'shadow'], 'ashcloud'],
      [['lightning', 'shadow', 'pain'], 'nerve-coil'],
      [['fire', 'shadow', 'pain'], 'pyre-wraith'],
      [['mind', 'shadow', 'pain'], 'haunt'],
      [['mind', 'shadow'], 'mare'],
      [['water', 'shadow'], 'drowner'],
      [['water', 'mind', 'shadow'], 'abyssal-eye'],
      [['water', 'shadow', 'pain'], 'abyssal-maw'],
    ];
    const unshaded = ['ashcloud', 'nerve-coil'];
    for (const [words, kind] of kinds) {
      const raiser = godUnit('Raiser', 1, 300);
      const field = new GameState([raiser, godUnit('Other', 2, 900)], 799);
      const raised = summon(field, raiser, words, { x: 500, y: 270 });
      equal(raised?.summonKind, kind, `Life ${words.join(' ')} raises its minion`);
      equal(raised.isImmuneTo('shadow'), !unshaded.includes(kind), `${kind}: immune to shadow unless it is ash or nerves`);
    }

    // ---- The two-word trinkets amplify their other word ----
    const lamp = godUnit('Lamp', 1, 300);
    const lit = new GameState([lamp, godUnit('Unlit', 2, 900)], 801);
    lit.spellRollThisCast = 10;
    const dim = summon(lit, lamp, ['lightning', 'shadow'], { x: 400, y: 270 }).lightningMindPower;
    wear(lit, lamp, ['lightning', 'shadow']);
    const bright = summon(lit, lamp, ['lightning', 'shadow'], { x: 400, y: 400 }).lightningMindPower;
    equal(bright - dim, 4, "Gloom Lantern: the bearer's Lightning power is 4 higher");

    const stoker = godUnit('Stoker', 1, 300);
    const coal = godUnit('Coal', 2, 500);
    const twin = godUnit('Twin', 2, 500 + R(1));
    const hearth = new GameState([stoker, coal, twin], 803);
    wear(hearth, stoker, ['fire', 'shadow']);
    hearth.applyFireStacks(coal, 1, stoker);
    equal(stacks(coal, 'fire'), 2, 'Coal Heart: Fire the bearer sets is a stack stronger');
    hearth.applyFireStacks(coal, 3, twin);
    hearth.applyFireStacks(twin, 5, coal);
    hearth.applyFireStacks(coal, 1, stoker);
    equal([stacks(coal, 'fire'), stacks(twin, 'fire')], [5, 6], 'and an overflow spreads without the bonus, so it settles');

    const thorn = godUnit('Thorn', 1, 300);
    const wince = godUnit('Wince', 2, 500);
    const briar = new GameState([thorn, wince], 805);
    wear(briar, thorn, ['pain', 'shadow']);
    dealDamage(briar.effectContext(thorn, wince, null), wince, dmg(3, 'sanity'), { canMiss: false });
    equal(wince.sanity, 295, "Thorned Circlet: the bearer's sanity hits deal 2 more");
    dealDamage(briar.effectContext(wince, thorn, null), thorn, dmg(3, 'sanity'), { canMiss: false });
    equal(thorn.sanity, 296, 'and the sanity hits it takes deal 1 more');

    // ---- Laws: amplified for everyone ----
    const stormCaller = godUnit('StormCaller', 1, 300);
    const rival = godUnit('Rival', 2, 600);
    const blackSky = new GameState([stormCaller, rival], 809);
    blackSky.spellRollThisCast = 12;
    lay(blackSky, stormCaller, ['lightning', 'shadow']);
    const storm = blackSky.hexLaw('blackStorm')!;
    equal(blackSky.lightningAmplifier(rival), Math.max(2, Math.floor((storm.power ?? 0) / 3)), "Black Storm raises everyone's Lightning power by a third of its own");
    blackSky.pushStack(blackSky.makeSpellItem(stormCaller, getSpell(['lightning', 'shadow'], null)!, rival, null));
    assert(stormCaller.hp < 300, 'and strikes whoever declares Lightning');

    const pyro = godUnit('Pyro', 1, 300);
    const singed = godUnit('Singed', 2, 500);
    const blackfire = new GameState([pyro, singed], 811);
    lay(blackfire, pyro, ['fire', 'shadow']);
    dealDamage(blackfire.effectContext(pyro, singed, null), singed, dmg(2, 'heat'), { canMiss: false });
    const seared = 300 - singed.hp;
    assert(seared >= 3 && seared <= 6, `Blackfire: a heat hit also deals 1d4 shadow (${seared})`);

    const screamer = godUnit('Screamer', 1, 300);
    const victim = godUnit('Victim', 2, 500);
    const beside = godUnit('Beside', 2, 500 + R(1.5));
    const echo = new GameState([screamer, victim, beside], 813);
    lay(echo, screamer, ['pain', 'shadow']);
    dealDamage(echo.effectContext(screamer, victim, null), victim, dmg(6, 'sanity'), { canMiss: false });
    equal([victim.sanity, beside.sanity, screamer.sanity], [294, 297, 300], 'Echoing Agony: half a sanity hit echoes into those beside its victim');

    const firestarter = godUnit('Firestarter', 1, 300);
    const kindling = godUnit('Kindling', 2, 600);
    const blaze = new GameState([firestarter, kindling], 817);
    blaze.spellRollThisCast = 12;
    lay(blaze, firestarter, ['lightning', 'fire', 'shadow']);
    blaze.applyFireStacks(kindling, 2, firestarter);
    lawRoundEnd(blaze);
    assert(kindling.hp < 300 && stacks(kindling, 'fire') === 1, 'Firestorm: every burning unit flares at round end and takes shadow');

    const crier = godUnit('Crier', 1, 300);
    const frail = godUnit('Frail', 2, 600);
    const howl = new GameState([crier, frail, godUnit('Calm', 2, 800)], 819);
    howl.spellRollThisCast = 12;
    lay(howl, crier, ['lightning', 'shadow', 'pain']);
    frail.sanity = 50;
    lawRoundEnd(howl);
    assert(frail.sanity < 50 && frail.hp < 300, 'Screaming Sky strikes the least sane mind');

    const torcher = godUnit('Torcher', 1, 300);
    const torched = godUnit('Torched', 2, 600);
    const terror = new GameState([torcher, torched], 821);
    lay(terror, torcher, ['fire', 'shadow', 'pain']);
    terror.applyFireStacks(torched, 3, torcher);
    terror.currentIndex = 1;
    terror.beginTurn();
    assert(torched.sanity < 300, 'Burning Terror: a burning unit is frightened at its turn start');

    const fraySource = godUnit('FraySource', 1, 300);
    const frayed = godUnit('Frayed', 2, 500, 270, ['bind', 'veil', 'mind']);
    const loom = new GameState([fraySource, frayed], 823);
    lay(loom, fraySource, ['mind', 'shadow', 'pain']);
    frayed.statuses.push({ key: 'forget', name: 'Forgotten', kind: 'forget', duration: 3, forgotten: ['bind', 'veil'] });
    dealDamage(loom.effectContext(fraySource, frayed, null), frayed, dmg(1, 'sanity'), { canMiss: false });
    equal(frayed.sanity, 297, 'Fraying Minds: a sanity hit deals 1 more per forgotten word');

    // ---- Minions ----
    const coiler = godUnit('Coiler', 1, 200);
    const struck = godUnit('Struck', 2, 600);
    const gloom = new GameState([coiler, struck], 827);
    gloom.spellRollThisCast = 12;
    const coil = summon(gloom, coiler, ['lightning', 'shadow'], { x: 500, y: 270 });
    runPulse(gloom, coil, coiler, MINIONS['umbral-coil'].pulse!);
    assert(struck.hp < 300 && gloom.isInShadow(struck), 'An Umbral Coil strikes with shadow and leaves a shadow where it lands');

    const tender = godUnit('Tender', 1, 200);
    const lit2 = godUnit('Lit', 1, 500, 330);
    const cold = godUnit('Cold', 2, 500, 210);
    const cinders = new GameState([tender, lit2, cold], 829);
    cinders.applyFireStacks(lit2, 2, cold);
    const shade = summon(cinders, tender, ['fire', 'shadow'], { x: 500, y: 270 });
    runPulse(cinders, shade, tender, MINIONS['cinder-shade'].pulse!);
    assert(stacks(cold, 'fire') === 1 && cold.hp < 300, 'A Cinder Shade darkens and kindles the units beside it');
    assert(stacks(lit2, 'fire') === 1 && lit2.hp < 300, 'and sets off an ally already burning');

    const mourner = godUnit('Mourner', 1, 200);
    const nearAlly = godUnit('NearAlly', 1, 450);
    const preyW = godUnit('PreyW', 2, 600);
    const wailing = new GameState([mourner, nearAlly, preyW], 831);
    const wailer = summon(wailing, mourner, ['pain', 'shadow'], { x: 500, y: 270 });
    runPulse(wailing, wailer, mourner, MINIONS['wailing-shade'].pulse!);
    assert(nearAlly.sanity < 300 && mourner.sanity === 300, 'A Wailing Shade frightens even the allies beside it, never its summoner');
    wailing.addShadow(preyW.pos, 1);
    const steady = preyW.sanity;
    runHitEffects(
      { striker: wailer, victim: preyW, dealt: 2, drinker: mourner, ctx: wailing.quietContext(wailer, preyW) },
      MINIONS['wailing-shade'].onHit!
    );
    assert(preyW.sanity < steady, 'and its touch cuts deeper into one standing in a shadow');

    const smoker = godUnit('Smoker', 1, 200);
    const torch = godUnit('Torch', 2, 500);
    const ashen = new GameState([smoker, torch], 835);
    ashen.spellRollThisCast = 12;
    const cloud = summon(ashen, smoker, ['lightning', 'fire', 'shadow'], { x: 400, y: 270 });
    runPulse(ashen, cloud, smoker, MINIONS.ashcloud.pulse!);
    equal(stacks(torch, 'fire'), 2, 'An Ashcloud kindles the nearest enemy when nobody burns');
    const unburnt = torch.hp;
    runPulse(ashen, cloud, smoker, MINIONS.ashcloud.pulse!);
    assert(torch.hp < unburnt && stacks(torch, 'fire') === 1, 'and sets off one that does');

    const wirer = godUnit('Wirer', 1, 200);
    const nerve = godUnit('Nerve', 2, 500);
    const wired = new GameState([wirer, nerve], 837);
    wired.spellRollThisCast = 16;
    const nerveCoil = summon(wired, wirer, ['lightning', 'shadow', 'pain'], { x: 450, y: 270 });
    const boost = 1 + Math.floor(nerveCoil.lightningMindPower / 8);
    dealDamage(wired.effectContext(wirer, nerve, null), nerve, dmg(2, 'sanity'), { canMiss: false });
    equal(300 - nerve.sanity, 2 + boost, 'A Nerve Coil makes every sanity hit beside it stronger with its Lightning power');

    const burner = godUnit('Burner', 1, 450);
    const foeW = godUnit('FoeW', 2, 550);
    const pyre = new GameState([burner, foeW], 839);
    const wraith = summon(pyre, burner, ['fire', 'shadow', 'pain'], { x: 500, y: 330 });
    dealDamage(pyre.effectContext(foeW, wraith, null), wraith, dmg(100, 'generic'), { canMiss: false });
    assert(
      stacks(foeW, 'fire') === 2 && stacks(burner, 'fire') === 2 && burner.sanity < 300,
      'A Pyre Wraith bursts over everything near it, its summoner included'
    );

    const haunter = godUnit('Haunter', 1, 200);
    const shaky = godUnit('Shaky', 1, 450, 270, ['bind', 'veil']);
    const calm = godUnit('CalmFoe', 2, 550, 270, ['bind']);
    const manor = new GameState([haunter, shaky, calm], 841);
    shaky.sanity = 100;
    const ghost = summon(manor, haunter, ['mind', 'shadow', 'pain'], { x: 500, y: 330 });
    runPulse(manor, ghost, haunter, MINIONS.haunt.pulse!);
    assert(shaky.sanity < 100 && forgot(shaky) === 1 && calm.sanity === 300, 'A Haunt preys on the least sane mind near it, allies included');

    // ---- Objects ----
    const brander = godUnit('Brander', 1, 300);
    const branded = godUnit('Branded', 2, 360);
    const smithy = new GameState([brander, branded], 845);
    smithy.spellRollThisCast = 12;
    wear(smithy, brander, ['lightning', 'fire', 'shadow']);
    smithy.applyFireStacks(branded, 2, brander);
    imbueAfterStrike(smithy, brander, branded, 2);
    assert(branded.hp < 300 && stacks(branded, 'fire') === 3, 'Storm Brand sears, sets the Fire off and kindles 2 more');

    const wearer = godUnit('Wearer', 1, 300);
    const hitter = godUnit('Hitter', 2, 360);
    const nextTo = godUnit('NextTo', 2, 360, 340);
    const mail = new GameState([wearer, hitter, nextTo], 847);
    mail.spellRollThisCast = 12;
    wear(mail, wearer, ['lightning', 'shadow', 'pain']);
    imbueAfterStrike(mail, hitter, wearer, 2);
    assert(
      hitter.sanity < 300 && nextTo.sanity < 300 && wearer.sanity === 300,
      'Nerve Mail shocks an attacker and the shock jumps on, never to the bearer'
    );

    const agony = godUnit('Agony', 1, 300);
    const burning = godUnit('Burning', 2, 360);
    const branding = new GameState([agony, burning], 849);
    wear(branding, agony, ['fire', 'shadow', 'pain']);
    branding.applyFireStacks(burning, 4, agony);
    imbueAfterStrike(branding, agony, burning, 2);
    equal([300 - burning.sanity, stacks(burning, 'fire')], [4, 5], 'Brand of Agony: 1 sanity per Fire stack, then 1 more Fire');

    const dreadful = godUnit('Dreadful', 1, 300);
    const target = godUnit('Target', 2, 360, 270, ['bind', 'veil']);
    const edge = new GameState([dreadful, target], 851);
    wear(edge, dreadful, ['mind', 'shadow', 'pain']);
    imbueAfterStrike(edge, dreadful, target, 2);
    const light = 300 - target.sanity;
    assert(light >= 1 && light <= 4 && forgot(target) === 0, 'Dreadful Edge: 1d4 sanity against a steady mind');
    target.sanity = 100;
    imbueAfterStrike(edge, dreadful, target, 2);
    assert(target.sanity <= 98 && forgot(target) === 1, 'and 2d6 and a lost word against a shaken one');

    // ---- The new ordinaries ----
    const ashCaster = godUnit('AshCaster', 1, 300);
    const first = godUnit('First', 2, 600);
    const second = godUnit('Second', 2, 600 + R(2));
    const ashGame = new GameState([ashCaster, first, second], 855);
    ashGame.spellRollThisCast = 12;
    getSpell(['lightning', 'fire', 'shadow'], null)!.cast(ashGame.effectContext(ashCaster, first, null));
    assert(first.hp < 300 && second.hp < 300 && stacks(second, 'fire') === 1, 'Ashen Bolt strikes, kindles and leaps on');

    const nerveCaster = godUnit('NerveCaster', 1, 300);
    const nTarget = godUnit('NTarget', 2, 600);
    const nAlly = godUnit('NAlly', 1, 600, 340);
    const nGame = new GameState([nerveCaster, nTarget, nAlly], 857);
    nGame.spellRollThisCast = 12;
    getSpell(['lightning', 'shadow', 'pain'], null)!.cast(nGame.effectContext(nerveCaster, nTarget, null));
    assert(nTarget.sanity < 300 && nTarget.hp < 300 && nAlly.sanity < 300, 'Nerve Storm shocks its target and spreads to allies beside it');

    const sCaster = godUnit('SCaster', 1, 300);
    const sTarget = godUnit('STarget', 2, 600);
    const sAlly = godUnit('SAlly', 1, 600, 340);
    const sGame = new GameState([sCaster, sTarget, sAlly], 859);
    getSpell(['fire', 'shadow', 'pain'], null)!.cast(sGame.effectContext(sCaster, sTarget, null));
    assert(stacks(sTarget, 'fire') === 2 && sAlly.sanity < 300, 'Searing Dread sets 2 Fire and frightens allies beside its target');
  }],

  ['gambles: Lightning scales with the roll, arcs and lurches, misfires into its own side and surges past it', async () => {
    await import('../spells/classSpells');
    const R = (cm: number): number => cm * RANGE_UNIT;
    const stacks = (m: Mage, kind: string): number =>
      (m.statuses.find((s) => s.kind === kind) as { stacks: number } | undefined)?.stacks ?? 0;
    const summon = (game: GameState, owner: Mage, words: WordId[], at: { x: number; y: number }): Mage => {
      void getSpell(words, 'life')!.cast(game.effectContext(owner, null, at));
      const raised = game.summonsOf(owner);
      return raised[raised.length - 1];
    };
    const lay = (game: GameState, caster: Mage, words: WordId[]): void => {
      void getSpell(words, 'hexcraft')!.cast(game.effectContext(caster, caster, null));
    };
    const wear = (game: GameState, bearer: Mage, words: WordId[]): void => {
      void getSpell(words, 'objects')!.cast(game.effectContext(bearer, bearer, null));
    };
    /** Every d`sides` the game rolls (d6 unless told) shows `face` until the returned undo runs. */
    const loaded = (game: GameState, face: number, sides = 6): (() => void) => {
      const die = game.rng.die.bind(game.rng);
      game.rng.die = (n: number) => (n === sides ? face : die(n));
      return () => {
        game.rng.die = die;
      };
    };
    /** The game's d`sides` show `faces` in order, then roll freely, until the returned undo runs. */
    const rigged = (game: GameState, sides: number, faces: number[]): (() => void) => {
      const die = game.rng.die.bind(game.rng);
      const queue = [...faces];
      game.rng.die = (n: number) => (n === sides && queue.length > 0 ? queue.shift()! : die(n));
      return () => {
        game.rng.die = die;
      };
    };

    const kinds: [WordId[], string][] = [
      [['lightning', 'fire'], 'ball-lightning'],
      [['lightning', 'pain'], 'live-wire'],
      [['lightning', 'fire', 'pain'], 'hellspark'],
    ];
    for (const [words, kind] of kinds) {
      const raiser = godUnit('Raiser', 1, 300);
      const field = new GameState([raiser, godUnit('Other', 2, 900)], 899);
      equal(summon(field, raiser, words, { x: 500, y: 270 })?.summonKind, kind, `Life ${words.join(' ')} raises its minion`);
    }

    // ---- Lightning Fire ----
    const roller = godUnit('Roller', 1, 200);
    const rolledAt = godUnit('RolledAt', 2, 1000);
    const nearAlly = godUnit('NearAlly', 1, 960, 330);
    const alley = new GameState([roller, rolledAt, nearAlly], 901);
    alley.spellRollThisCast = 12;
    const ball = summon(alley, roller, ['lightning', 'fire'], { x: 400, y: 270 });
    equal(ball.maxHp, 3, 'Ball Lightning has 3 health');
    runPulse(alley, ball, roller, MINIONS['ball-lightning'].pulse!);
    assert(
      dist(ball.pos, rolledAt.pos) < R(1.5) && rolledAt.hp < 300 && stacks(rolledAt, 'fire') === 1,
      'and runs on its own all the way to the nearest enemy, then bursts'
    );
    assert(nearAlly.hp < 300 && roller.hp === 300, 'catching allies beside it but never its summoner');
    const burstReaches = (roll: number): boolean => {
      const raiser = godUnit('Raiser', 1, 200);
      const pal = godUnit('Pal', 1, 600, 420);
      const field = new GameState([raiser, godUnit('Foe', 2, 600), pal], 903);
      field.spellRollThisCast = roll;
      runPulse(field, summon(field, raiser, ['lightning', 'fire'], { x: 400, y: 270 }), raiser, MINIONS['ball-lightning'].pulse!);
      return pal.hp < 300;
    };
    assert(!burstReaches(17) && burstReaches(18), 'Summoned on a natural 18 or more, its burst reaches twice as far');

    const brander = godUnit('Brander', 1, 300);
    brander.hands = ['ironShortsword'];
    const branded = godUnit('Branded', 2, 360);
    const brandPal = godUnit('BrandPal', 1, 360, 330);
    const forge = new GameState([brander, branded, brandPal], 905);
    wear(forge, brander, ['lightning', 'fire']);
    equal(brander.hands, ['conjuredArcBrand'], 'Objects Lightning Fire conjures an Arc Brand into the hand');
    const brand = getItem('conjuredArcBrand');
    equal([brand.weapon?.kind, brand.weapon?.damageType], ['dex', 'heat'], 'a Dexterity weapon that strikes as heat');
    let undo = loaded(forge, 1);
    imbueAfterStrike(forge, brander, branded, 2, brand.onHit);
    undo();
    assert(brander.hp < 300 && branded.hp === 300, 'Arc Brand on a 1: the charge grounds through its wielder');
    undo = loaded(forge, 3);
    imbueAfterStrike(forge, brander, branded, 2, brand.onHit);
    undo();
    assert(stacks(branded, 'fire') === 1 && brandPal.hp < 300, 'on 2-5 it sets the target alight and arcs on, friend or foe');
    const stoodAt = { ...brander.pos };
    undo = loaded(forge, 6);
    imbueAfterStrike(forge, brander, branded, 2, brand.onHit);
    undo();
    assert(stacks(branded, 'fire') === 3 && dist(brander.pos, stoodAt) > R(1.5), 'and on a 6 it surges and its wielder dashes away');

    const dryCaster = godUnit('DryCaster', 1, 300);
    const scorched = godUnit('Scorched', 2, 600);
    const nextDoor = godUnit('NextDoor', 2, 600 + R(1.5));
    const dry = new GameState([dryCaster, scorched, nextDoor], 907);
    dry.spellRollThisCast = 12;
    lay(dry, dryCaster, ['lightning', 'fire']);
    undo = loaded(dry, 6);
    dealDamage(dry.effectContext(dryCaster, scorched, null), scorched, dmg(3, 'heat'), { canMiss: false });
    undo();
    equal(nextDoor.hp, 297, 'Dry Lightning: on a 5 or 6 a heat hit leaps on for the same');
    undo = loaded(dry, 1);
    dealDamage(dry.effectContext(dryCaster, scorched, null), scorched, dmg(3, 'heat'), { canMiss: false });
    undo();
    equal(dryCaster.hp, 297, 'and on a 1 it leaps back into whoever dealt it');

    // ---- Lightning Pain ----
    const writher = godUnit('Writher', 1, 300);
    const writhed = godUnit('Writhed', 2, 600);
    const kin = godUnit('Kin', 1, 600, 340);
    const wires = new GameState([writher, writhed, kin], 909);
    wires.spellRollThisCast = 15;
    getSpell(['lightning', 'pain'], null)!.cast(wires.effectContext(writher, writhed, null));
    assert(
      writhed.hp < 300 && writhed.sanity < 300 && kin.sanity < 300,
      'Writhing Bolt strikes its target and writhes on into your own side'
    );
    undo = loaded(wires, 1);
    const steadyHp = writher.hp;
    getSpell(['lightning', 'pain'], null)!.cast(wires.effectContext(writher, writhed, null));
    undo();
    assert(writher.hp < steadyHp, 'and on a misfire it strikes you too');

    const wirer = godUnit('Wirer', 1, 200);
    const wirePrey = godUnit('WirePrey', 2, 500);
    const wirePal = godUnit('WirePal', 1, 500, 340);
    const live = new GameState([wirer, wirePrey, wirePal], 911);
    live.spellRollThisCast = 16;
    const wire = summon(live, wirer, ['lightning', 'pain'], { x: 420, y: 270 });
    undo = loaded(live, 6);
    runPulse(live, wire, wirer, MINIONS['live-wire'].pulse!);
    undo();
    assert(
      wirePrey.sanity < 300 && wirePal.sanity < 300 && wirer.sanity === 300,
      'Live Wire on a 6 lashes every unit in reach but you'
    );
    undo = loaded(live, 1);
    runPulse(live, wire, wirer, MINIONS['live-wire'].pulse!);
    undo();
    assert(wirer.sanity < 300, 'on a 1 it lashes you, wherever you are');
    undo = loaded(live, 3);
    runPulse(live, wire, wirer, MINIONS['live-wire'].pulse!);
    undo();
    assert(
      dist(wire.pos, wirePrey.pos) < R(1.2) || dist(wire.pos, wirePal.pos) < R(1.2),
      'and otherwise it lashes one of them and leaps to its side'
    );

    const capBearer = godUnit('CapBearer', 1, 300);
    const capFoe = godUnit('CapFoe', 2, 360);
    const capPal = godUnit('CapPal', 1, 300, 340);
    const lab = new GameState([capBearer, capFoe, capPal], 913);
    lab.spellRollThisCast = 12;
    wear(lab, capBearer, ['lightning', 'pain']);
    dealDamage(lab.effectContext(capFoe, capBearer, null), capBearer, dmg(5, 'heat'), { canMiss: false });
    undo = loaded(lab, 6);
    imbueTurnStart(lab, capBearer);
    undo();
    assert(
      capFoe.hp === 295 && capFoe.sanity === 295 && capPal.hp === 295,
      'Agony Capacitor stores what its bearer takes and, on a 6, looses it all on everyone near'
    );
    dealDamage(lab.effectContext(capFoe, capBearer, null), capBearer, dmg(4, 'heat'), { canMiss: false });
    undo = loaded(lab, 1);
    imbueTurnStart(lab, capBearer);
    undo();
    equal(capBearer.sanity, 296, 'and on a 1 into its bearer');
    dealDamage(lab.effectContext(capFoe, capBearer, null), capBearer, dmg(3, 'heat'), { canMiss: false });
    undo = loaded(lab, 3);
    imbueTurnStart(lab, capBearer);
    undo();
    assert(
      capFoe.hp + capPal.hp === 587 && capFoe.sanity + capPal.sanity === 587,
      'on 2-5 into one unit near it, as heat and again as sanity (a misfire never charges it back up)'
    );

    const agonist = godUnit('Agonist', 1, 300);
    const sufferer = godUnit('Sufferer', 2, 700);
    const storm = new GameState([agonist, sufferer], 915);
    storm.spellRollThisCast = 12;
    lay(storm, agonist, ['lightning', 'pain']);
    undo = loaded(storm, 1);
    lawRoundEnd(storm);
    undo();
    assert(
      agonist.hp < 300 && agonist.sanity < 300 && sufferer.hp < 300,
      'Storm of Agony: on a 1 lightning strikes a unit, its caster not spared'
    );

    // ---- Lightning Fire Pain ----
    const hellCaster = godUnit('HellCaster', 1, 300);
    const damned = godUnit('Damned', 2, 360);
    const pit = new GameState([hellCaster, damned], 917);
    pit.spellRollThisCast = 12;
    undo = rigged(pit, 6, [3, 1, 4, 1, 6]);
    getSpell(['lightning', 'fire', 'pain'], null)!.cast(pit.effectContext(hellCaster, damned, null));
    undo();
    assert(
      hellCaster.hp <= 298 && damned.hp <= 298 && hellCaster.sanity <= 298,
      'Hellbolt bounces between everyone, you included, until a 6 makes it explode'
    );
    assert(
      stacks(damned, 'fire') === 0 && stacks(hellCaster, 'fire') === 0,
      'and the explosion burns all the Fire it catches at once'
    );

    const sparkOwner = godUnit('SparkOwner', 1, 600, 330);
    const sparkFoe = godUnit('SparkFoe', 2, 800);
    const furnace = new GameState([sparkOwner, sparkFoe], 919);
    furnace.spellRollThisCast = 12;
    const spark = summon(furnace, sparkOwner, ['lightning', 'fire', 'pain'], { x: 540, y: 270 });
    const swerve = furnace.rng.float.bind(furnace.rng);
    furnace.rng.float = () => 0.5;
    const undoZips = loaded(furnace, 3, 3);
    undo = loaded(furnace, 2);
    runPulse(furnace, spark, sparkOwner, MINIONS.hellspark.pulse!);
    undo();
    undoZips();
    furnace.rng.float = swerve;
    assert(
      spark.x >= 750 && dist(spark.pos, sparkFoe.pos) >= spark.bodyRadius() + sparkFoe.bodyRadius() && stacks(sparkFoe, 'fire') === 2,
      'A Hellspark zips 1d3 times toward the enemy, 1d6cm each, and flares after every zip'
    );
    assert(sparkOwner.sanity < 300 && stacks(sparkOwner, 'fire') === 1, 'its flares catching you too');

    const mantled = godUnit('Mantled', 1, 300);
    const brute = godUnit('Brute', 2, 360);
    const mantlePal = godUnit('MantlePal', 1, 300, 340);
    const faraway = godUnit('Faraway', 2, 900);
    const hall = new GameState([mantled, brute, mantlePal, faraway], 921);
    hall.spellRollThisCast = 12;
    wear(hall, mantled, ['lightning', 'fire', 'pain']);
    undo = loaded(hall, 3, 3);
    dealDamage(hall.effectContext(brute, mantled, null), mantled, dmg(8, 'pierce'), { canMiss: false });
    undo();
    equal(
      [brute.hp, brute.sanity, stacks(brute, 'fire'), mantlePal.hp, faraway.hp],
      [296, 298, 2, 296, 300],
      'Thundering Mantle: what its bearer takes strikes everyone near it, half as heat, a quarter as sanity and as Fire'
    );
    undo = loaded(hall, 2, 3);
    dealDamage(hall.effectContext(brute, mantled, null), mantled, dmg(1, 'pierce'), { canMiss: false });
    undo();
    equal(mantled.hp, 290, 'a hit on its bearer rolls 1d3: on a 2 the bearer takes 1 heat more');
    undo = loaded(hall, 1, 3);
    dealDamage(hall.effectContext(brute, mantled, null), mantled, dmg(1, 'pierce'), { canMiss: false });
    undo();
    equal(brute.sanity, 297, 'on a 1 lightning arcs from it into the nearest unit for 1d3 sanity');
    undo = loaded(hall, 2, 3);
    dealDamage(hall.effectContext(mantled, mantled, null), mantled, dmg(4, 'heat'), { canMiss: false, dot: true });
    undo();
    equal(
      [mantled.hp, brute.hp, stacks(brute, 'fire')],
      [285, 294, 3],
      'its own damage over time is passed on as well, but rolls nothing'
    );
    applyDot(hall.effectContext(brute, mantled, null), mantled, { name: 'Test Rot', duration: 3, damage: dmg(4, 'corrosive') });
    hall.currentIndex = 0;
    hall.beginTurn();
    equal(brute.hp, 292, 'even a curse ticking at its turn start');

    const lawgiver = godUnit('Lawgiver', 1, 300);
    const frenzied = godUnit('Frenzied', 2, 600);
    const kindling = godUnit('Kindling', 2, 600 + R(0.9));
    const frenzy = new GameState([lawgiver, frenzied, kindling], 923);
    lay(frenzy, lawgiver, ['lightning', 'fire', 'pain']);
    frenzy.applyFireStacks(frenzied, 2, lawgiver);
    frenzy.currentIndex = 1;
    frenzy.beginTurn();
    assert(frenzied.sanity < 300, 'Burning Frenzy: Fire burns the mind as well');
    equal(stacks(kindling, 'fire'), 1, 'and a unit that loses sanity flares, setting Fire on everyone near it');
    dealDamage(frenzy.effectContext(lawgiver, kindling, null), kindling, dmg(2, 'sanity'), { canMiss: false });
    equal(stacks(frenzied, 'fire'), 2, 'whatever took the sanity');

    // ---- Blue keeps Lightning off your side ----
    const pierceCaster = godUnit('PierceCaster', 1, 300);
    const pierceAlly = godUnit('PierceAlly', 1, 360);
    const pierceFoe = godUnit('PierceFoe', 2, 600);
    const lane = new GameState([pierceCaster, pierceAlly, pierceFoe], 925);
    lane.spellRollThisCast = 12;
    await getSpell(['lightning', 'veil', 'pierce'], null)!.cast(lane.effectContext(pierceCaster, null, null));
    assert(pierceFoe.hp < 300 && pierceAlly.hp === 300, 'Lightning Veil Pierce strikes enemies only');

    const eelOwner = godUnit('EelOwner', 1, 200);
    const eelPal = godUnit('EelPal', 1, 500);
    const pond = new GameState([eelOwner, eelPal, godUnit('FarFoe', 2, 1200)], 927);
    pond.spellRollThisCast = 12;
    const eel = summon(pond, eelOwner, ['water', 'lightning'], { x: 450, y: 270 });
    runPulse(pond, eel, eelOwner, MINIONS['storm-eel'].pulse!);
    equal(eelPal.hp, 300, 'A Storm Eel never strikes your side, even with no enemy near');

    const waveCaster = godUnit('WaveCaster', 1, 300);
    const waveFoe = godUnit('WaveFoe', 2, 600);
    const waveAlly = godUnit('WaveAlly', 1, 600, 340);
    const shore = new GameState([waveCaster, waveFoe, waveAlly], 929);
    shore.spellRollThisCast = 12;
    getSpell(['water', 'lightning'], null)!.cast(shore.effectContext(waveCaster, waveFoe, null));
    equal(waveAlly.hp, 300, 'Conducting Wave keeps its lightning off your side');

    const seaCaster = godUnit('SeaCaster', 1, 300);
    const seaFoe = godUnit('SeaFoe', 2, 600);
    const seaAlly = godUnit('SeaAlly', 1, 660);
    const tide = new GameState([seaCaster, seaFoe, seaAlly], 931);
    lay(tide, seaCaster, ['water', 'lightning']);
    dealDamage(tide.effectContext(seaFoe, seaAlly, null), seaAlly, dmg(1, 'pierce'), { canMiss: false });
    assert(seaAlly.hp === 299 && seaAlly.x === 660 && tide.hazardZones.length === 0, 'Conductive Sea never throws your own side');

    const tridentBearer = godUnit('TridentBearer', 1, 300);
    const speared = godUnit('Speared', 2, 360);
    const tridentPal = godUnit('TridentPal', 1, 450, 340);
    const armoury = new GameState([tridentBearer, speared, tridentPal], 933);
    armoury.spellRollThisCast = 12;
    wear(armoury, tridentBearer, ['water', 'lightning']);
    imbueAfterStrike(armoury, tridentBearer, speared, 2);
    equal(tridentPal.hp, 300, "Conductor's Trident arcs only into enemies");
  }],

  ['pierces: archers, lunges and dashes, bows and blades, and laws that turn, splinter, stake and bleed', async () => {
    await import('../spells/classSpells');
    const R = (cm: number): number => cm * RANGE_UNIT;
    const stacks = (m: Mage, kind: string): number =>
      (m.statuses.find((s) => s.kind === kind) as { stacks: number } | undefined)?.stacks ?? 0;
    const has = (m: Mage, key: string): boolean => m.statuses.some((s) => s.key === key);
    const summon = (game: GameState, owner: Mage, words: WordId[], at: { x: number; y: number }): Mage => {
      void getSpell(words, 'life')!.cast(game.effectContext(owner, null, at));
      const raised = game.summonsOf(owner);
      return raised[raised.length - 1];
    };
    const lay = (game: GameState, caster: Mage, words: WordId[]): void => {
      void getSpell(words, 'hexcraft')!.cast(game.effectContext(caster, caster, null));
    };
    const wear = (game: GameState, bearer: Mage, words: WordId[]): void => {
      void getSpell(words, 'objects')!.cast(game.effectContext(bearer, bearer, null));
    };
    const pierceHit = (game: GameState, from: Mage, to: Mage, amount: number): number =>
      dealDamage(game.effectContext(from, to, null), to, dmg(amount, 'pierce'), { canMiss: false });

    const roster: [WordId[], string, string, string | null][] = [
      [['pierce', 'twist'], 'blade-dervish', 'conjuredTwinblades', 'turningBlades'],
      [['pierce', 'bind'], 'pin-archer', 'conjuredGrapnel', null],
      [['pierce', 'shatter'], 'scorpion', 'conjuredSplinterJavelin', 'splintering'],
      [['pierce', 'curse'], 'thorn-fiend', 'conjuredThornbow', 'openWounds'],
      [['pierce', 'drain'], 'bloodfang-stalker', 'conjuredLeechingRapier', 'bloodscent'],
      [['pierce', 'twist', 'bind'], 'needle-sentry', 'conjuredSilencerCrossbow', 'pinningLaw'],
      [['pierce', 'twist', 'shatter'], 'spinning-top', 'conjuredCorkscrewLance', 'whirlwind'],
      [['pierce', 'twist', 'drain'], 'leech-dervish', 'conjuredLeechingChakram', 'circlingThirst'],
      [['pierce', 'twist', 'curse'], 'hooked-archer', 'conjuredHookblade', 'twistingBarbs'],
      [['pierce', 'bind', 'shatter'], 'stake-warden', 'conjuredStakeCrossbow', 'stakeLaw'],
      [['pierce', 'bind', 'drain'], 'leech-harpooner', 'conjuredBloodhookHarpoon', 'bloodpin'],
      [['pierce', 'bind', 'curse'], 'thornbinder', 'conjuredThornwhip', 'thornedFetters'],
      [['pierce', 'shatter', 'drain'], 'marrow-archer', 'boneMail', 'marrowThirst'],
      [['pierce', 'shatter', 'curse'], 'shardhound', 'conjuredSplinterbow', 'splinterCurse'],
      [['pierce', 'drain', 'curse'], 'vampire-bat', 'bloodthirstyEdge', 'vampiricWounds'],
    ];
    for (const [words, kind, gear, rule] of roster) {
      const label = words.join(' ');
      const caster = godUnit('Caster', 1, 300);
      const field = new GameState([caster, godUnit('Other', 2, 900)], 939);
      equal(summon(field, caster, words, { x: 500, y: 270 })?.summonKind, kind, `Life ${label} raises its minion`);
      wear(field, caster, words);
      const geared =
        caster.hands.includes(gear as never) ||
        caster.utility.includes(gear as never) ||
        caster.statuses.some((s) => s.kind === 'imbue' && (s as { imbue: string }).imbue === gear);
      assert(geared, `Objects ${label} arms you with ${gear}`);
      lay(field, caster, words);
      if (rule) assert(field.hexLaw(rule as never), `Hexcraft ${label} lays its law`);
    }
    equal(getSpell(['pierce', 'bind'], 'hexcraft')?.codename, 'Needlepoint Domain', 'Pierce Bind keeps its Needlepoint Domain');

    // ---- Minions ----
    const dancer = godUnit('Dancer', 1, 200);
    const mark = godUnit('Mark', 2, 600);
    const arena = new GameState([dancer, mark], 941);
    const dervish = summon(arena, dancer, ['pierce', 'twist'], { x: 450, y: 270 });
    runPulse(arena, dervish, dancer, MINIONS['blade-dervish'].pulse!);
    assert(mark.hp < 300 && dist(dervish.pos, mark.pos) < R(1.6), 'A Blade Dervish dashes to the nearest enemy and cuts it');

    const warden = godUnit('Warden', 1, 200);
    const shot = godUnit('Shot', 2, 600);
    const post = new GameState([warden, shot], 943);
    const sentry = summon(post, warden, ['pierce', 'twist', 'bind'], { x: 300, y: 270 });
    runPulse(post, sentry, warden, MINIONS['needle-sentry'].pulse!);
    assert(shot.hp < 300 && shot.statuses.some((s) => s.kind === 'stifle'), 'A Needle Sentry shoots the nearest enemy and stifles it');

    const batOwner = godUnit('BatOwner', 1, 200);
    const batPal = godUnit('BatPal', 1, 420);
    const batFoe = godUnit('BatFoe', 2, 640);
    const cave = new GameState([batOwner, batPal, batFoe], 945);
    const bat = summon(cave, batOwner, ['pierce', 'drain', 'curse'], { x: 380, y: 270 });
    runPulse(cave, bat, batOwner, MINIONS['vampire-bat'].pulse!);
    assert(
      batPal.hp < 300 && has(batPal, 'dot:kit:Bloodletting') && batFoe.hp === 300 && batOwner.hp === 300,
      'A Vampire Bat bites the nearest unit, friend or foe, never its master'
    );

    const fiendOwner = godUnit('FiendOwner', 1, 200);
    const fiendPal = godUnit('FiendPal', 1, 450, 300);
    const pit = new GameState([fiendOwner, fiendPal, godUnit('FiendFoe', 2, 900)], 947);
    const fiend = summon(pit, fiendOwner, ['pierce', 'curse'], { x: 420, y: 270 });
    dealDamage(pit.effectContext(fiendOwner, fiend, null), fiend, dmg(50, 'pierce'), { canMiss: false, trueDamage: true });
    assert(!fiend.alive && fiendPal.hp < 300, 'A Thorn Fiend bursts into thorns when it dies, your side included');

    // ---- Objects ----
    const duelist = godUnit('Duelist', 1, 300);
    duelist.hands = ['ironShortsword'];
    const parried = godUnit('Parried', 2, 360);
    const yard = new GameState([duelist, parried], 949);
    wear(yard, duelist, ['pierce', 'twist']);
    equal(duelist.hands, ['conjuredTwinblades'], 'Objects Pierce Twist conjures Twinblades into the hand');
    const stance = { ...duelist.pos };
    imbueAfterStrike(yard, duelist, parried, 2, getItem('conjuredTwinblades').onHit);
    assert(
      dist(duelist.pos, stance) > R(0.5) && Math.abs(dist(duelist.pos, parried.pos) - 60) < 2,
      'whose hits slip you a quarter circle around the target'
    );

    const hooker = godUnit('Hooker', 1, 200);
    const hooked = godUnit('Hooked', 2, 500);
    const quay = new GameState([hooker, hooked], 951);
    imbueAfterStrike(quay, hooker, hooked, 2, getItem('conjuredGrapnel').onHit);
    assert(hooked.isStunned('movement') && dist(hooker.pos, hooked.pos) < R(1.2), 'A Grapnel roots its target and pulls you to its side');

    const thrower = godUnit('Thrower', 1, 200);
    const thrownAt = godUnit('ThrownAt', 2, 600);
    const beside = godUnit('Beside', 2, 600, 330);
    const pal = godUnit('Pal', 1, 640);
    const range = new GameState([thrower, thrownAt, beside, pal], 953);
    wear(range, thrower, ['pierce', 'shatter']);
    equal(thrower.utility.filter((id) => id === 'conjuredSplinterJavelin').length, 3, 'Objects Pierce Shatter conjures 3 Splinter Javelins');
    range.throwItem(thrower, thrownAt, 'conjuredSplinterJavelin');
    assert(
      thrownAt.hp < 300 && beside.hp < 300 && pal.hp === 300,
      'A Splinter Javelin splinters into the enemies beside its target, never your side'
    );

    const crossbowman = godUnit('Crossbowman', 1, 200);
    const staked = godUnit('Staked', 2, 500);
    const butts = new GameState([crossbowman, staked], 955);
    const stakeBolt = getItem('conjuredStakeCrossbow').onHit;
    imbueAfterStrike(butts, crossbowman, staked, 2, stakeBolt);
    equal([staked.isStunned('movement'), staked.hp], [true, 300], 'A Stake Crossbow roots a free target');
    imbueAfterStrike(butts, crossbowman, staked, 2, stakeBolt);
    assert(staked.hp < 300, 'and splits a rooted one with shatter');

    const mailed = godUnit('Mailed', 1, 300);
    mailed.hp = 200;
    const striker = godUnit('Striker', 2, 360);
    const smithy = new GameState([mailed, striker], 957);
    wear(smithy, mailed, ['pierce', 'shatter', 'drain']);
    equal(imbueDeflects(smithy, striker, mailed, 6), true, 'Bone Mail negates a basic attack');
    assert(striker.hp < 297 && mailed.hp === 203, 'pierces the attacker and drains half the blow it turned aside into its wearer');

    // ---- Laws ----
    const turner = godUnit('Turner', 1, 300);
    const spun = godUnit('Spun', 2, 400);
    const ring = new GameState([turner, spun], 959);
    lay(ring, turner, ['pierce', 'twist']);
    const spunFrom = { ...spun.pos };
    pierceHit(ring, turner, spun, 3);
    assert(
      dist(spun.pos, spunFrom) > R(1) && Math.abs(dist(spun.pos, turner.pos) - 100) < 2,
      'Turning Blades turns every pierced unit a quarter circle around its attacker'
    );

    const splinterer = godUnit('Splinterer', 1, 300);
    const splintered = godUnit('Splintered', 2, 600);
    const nextTo = godUnit('NextTo', 2, 600 + R(1.2));
    const sawmill = new GameState([splinterer, splintered, nextTo], 961);
    lay(sawmill, splinterer, ['pierce', 'shatter']);
    pierceHit(sawmill, splinterer, splintered, 2);
    assert(nextTo.hp < 300 && splinterer.hp === 300, 'Splintering Law splinters a pierce hit into its neighbours, never its attacker');

    const wounder = godUnit('Wounder', 1, 300);
    const wounded = godUnit('Wounded', 2, 400);
    const surgery = new GameState([wounder, wounded], 963);
    lay(surgery, wounder, ['pierce', 'curse']);
    pierceHit(surgery, wounder, wounded, 1);
    pierceHit(surgery, wounder, wounded, 1);
    equal(
      (wounded.statuses.find((s) => s.key === 'dot:law-open-wound') as { stacks?: number } | undefined)?.stacks,
      2,
      'Open Wounds stacks a wound with every pierce hit'
    );

    const scent = godUnit('Scent', 1, 300);
    scent.hp = 200;
    const bleeding = godUnit('Bleeding', 2, 400);
    bleeding.hp = 150;
    const fresh = godUnit('Fresh', 2, 400, 340);
    const trail = new GameState([scent, bleeding, fresh], 965);
    lay(trail, scent, ['pierce', 'drain']);
    pierceHit(trail, scent, fresh, 2);
    equal(scent.hp, 200, 'Bloodscent leaves a hale unit be');
    pierceHit(trail, scent, bleeding, 2);
    assert(scent.hp > 200 && bleeding.hp < 148, 'but drains one at half health or less into its attacker');

    const pinner = godUnit('Pinner', 1, 300);
    const pinned = godUnit('Pinned', 2, 400);
    const friend = godUnit('Friend', 1, 300, 340);
    const gallery = new GameState([pinner, pinned, friend], 969);
    lay(gallery, pinner, ['pierce', 'twist', 'bind']);
    pierceHit(gallery, pinner, pinned, 2);
    pierceHit(gallery, pinned, friend, 2);
    assert(pinned.isStunned('movement') && gallery.cannotReact(pinned), 'Pinning Law roots a pierced enemy and stops its reactions');
    assert(!friend.isStunned('movement') && !gallery.cannotReact(friend), 'and never your side');

    const dasher = godUnit('Dasher', 1, 300);
    const caughtUp = godUnit('CaughtUp', 2, 560, 300);
    const gale = new GameState([dasher, caughtUp], 971);
    lay(gale, dasher, ['pierce', 'twist', 'shatter']);
    const caughtFrom = { ...caughtUp.pos };
    dash(gale.effectContext(dasher, null, null), dasher, { toPoint: { x: 520, y: 270 }, distance: R(8) });
    assert(caughtUp.hp < 300 && dist(caughtUp.pos, caughtFrom) > R(0.5), 'Whirlwind Law: a dash spins and cuts everyone near where it stops');

    const circler = godUnit('Circler', 1, 300);
    circler.hp = 200;
    const circled = godUnit('Circled', 2, 360);
    const dance = new GameState([circler, circled], 973);
    lay(dance, circler, ['pierce', 'twist', 'drain']);
    const circlerFrom = { ...circler.pos };
    pierceHit(dance, circler, circled, 2);
    assert(dist(circler.pos, circlerFrom) > R(0.5) && circler.hp > 200, 'Circling Thirst slips the attacker around its target and drains it');

    const barber = godUnit('Barber', 1, 300);
    const barbed = godUnit('Barbed', 2, 400);
    const hooks = new GameState([barber, barbed], 975);
    lay(hooks, barber, ['pierce', 'twist', 'curse']);
    pierceHit(hooks, barber, barbed, 2);
    const barbedFrom = { ...barbed.pos };
    hooks.currentIndex = 1;
    hooks.beginTurn();
    assert(barbed.hp < 298 && dist(barbed.pos, barbedFrom) > R(0.5), 'Twisting Barbs lodge a barb that turns its bearer as it ticks');

    const stakeOwner = godUnit('StakeOwner', 1, 300);
    const stakeFoe = godUnit('StakeFoe', 2, 400);
    const stockade = new GameState([stakeOwner, stakeFoe], 977);
    lay(stockade, stakeOwner, ['pierce', 'bind', 'shatter']);
    pierceHit(stockade, stakeOwner, stakeFoe, 2);
    equal(stakeFoe.hp, 298, 'Stake Law adds nothing to a free enemy');
    applyStun(stockade.effectContext(stakeOwner, stakeFoe, null), stakeFoe, { duration: 2, type: 'movement' });
    pierceHit(stockade, stakeOwner, stakeFoe, 2);
    assert(stakeFoe.hp <= 295, 'but splits a rooted one with 1d6 shatter more');

    const leech = godUnit('Leech', 1, 300);
    leech.hp = 200;
    const leeched = godUnit('Leeched', 2, 400);
    const ward = new GameState([leech, leeched], 979);
    lay(ward, leech, ['pierce', 'bind', 'drain']);
    applyStun(ward.effectContext(leech, leeched, null), leeched, { duration: 2, type: 'movement' });
    pierceHit(ward, leech, leeched, 2);
    assert(leech.hp > 200 && leeched.hp < 298, 'Bloodpin Law drains a pierced rooted unit');

    const fetterer = godUnit('Fetterer', 1, 300);
    const fettered = godUnit('Fettered', 2, 400);
    const cells = new GameState([fetterer, fettered], 981);
    lay(cells, fetterer, ['pierce', 'bind', 'curse']);
    applyStun(cells.effectContext(fetterer, fettered, null), fettered, { duration: 2, type: 'movement' });
    equal(has(fettered, 'dot:law-thorned-fetters'), true, 'Thorned Fetters drives thorns into whatever is rooted');

    const marrow = godUnit('Marrow', 1, 300);
    marrow.hp = 200;
    const bone = godUnit('Bone', 2, 400);
    const ossuary = new GameState([marrow, bone], 983);
    lay(ossuary, marrow, ['pierce', 'shatter', 'drain']);
    pierceHit(ossuary, marrow, bone, 3);
    equal(marrow.hp, 200, 'Marrow Thirst ignores a pierce hit under 4');
    pierceHit(ossuary, marrow, bone, 4);
    assert(marrow.hp > 200, 'and drains one of 4 or more');

    const shardCaster = godUnit('ShardCaster', 1, 300);
    const shardFoe = godUnit('ShardFoe', 2, 400);
    const quarry = new GameState([shardCaster, shardFoe], 985);
    lay(quarry, shardCaster, ['pierce', 'shatter', 'curse']);
    dealDamage(quarry.effectContext(shardCaster, shardFoe, null), shardFoe, dmg(2, 'shatter'), { canMiss: false });
    equal(has(shardFoe, 'dot:law-splinters'), true, 'Splinter Curse leaves splinters in every shatter hit');

    const vampire = godUnit('Vampire', 1, 300);
    const veins = godUnit('Veins', 2, 400);
    const crypt = new GameState([vampire, veins], 989);
    lay(crypt, vampire, ['pierce', 'drain', 'curse']);
    pierceHit(crypt, vampire, veins, 2);
    const letting = veins.statuses.find((s) => s.key === 'dot:law-bloodletting') as { lifestealToIndex?: number } | undefined;
    equal(letting?.lifestealToIndex, 0, 'Vampiric Wounds bleeds a pierced unit into its attacker');

    // ---- Ordinary spells ----
    const flanker = godUnit('Flanker', 1, 200);
    const flanked = godUnit('Flanked', 2, 500);
    const lane = new GameState([flanker, flanked], 995);
    getSpell(['pierce', 'twist'], null)!.cast(lane.effectContext(flanker, flanked, null));
    assert(flanked.hp < 300 && dist(flanker.pos, flanked.pos) < R(1.6), 'Flanking Strike dashes to its target and strikes it');

    const corker = godUnit('Corker', 1, 200);
    const passed = godUnit('Passed', 2, 400);
    const pastFrom = { ...passed.pos };
    const alley = new GameState([corker, passed], 997);
    getSpell(['pierce', 'twist', 'shatter'], null)!.cast(alley.effectContext(corker, null, { x: 560, y: 270 }));
    assert(passed.hp < 300 && dist(passed.pos, pastFrom) > R(0.5), 'Corkscrew Dash cuts and spins whoever it passes');

    const drinker = godUnit('Drinker', 1, 200);
    const drained = godUnit('Drained', 2, 500);
    const drainedPal = godUnit('DrainedPal', 2, 500, 340);
    const drinkerPal = godUnit('DrinkerPal', 1, 540, 270);
    const bloodbath = new GameState([drinker, drained, drainedPal, drinkerPal], 999);
    getSpell(['pierce', 'drain', 'curse'], null)!.cast(bloodbath.effectContext(drinker, drained, null));
    assert(
      has(drained, 'dot:bled-dry') && has(drainedPal, 'dot:bled-dry') && has(drinkerPal, 'dot:bled-dry') && !has(drinker, 'dot:bled-dry'),
      'Exsanguinate bleeds everything near its target dry, your side included but never you'
    );

    const lancer = godUnit('Lancer', 1, 200);
    const firstInLine = godUnit('FirstInLine', 2, 400);
    const unhallowed = creature('Unhallowed', 600);
    const throughLine = new GameState([lancer, firstInLine, unhallowed], 1001);
    getSpell(['pierce', 'desecrate'], null)!.cast(throughLine.effectContext(lancer, null, { x: 800, y: 270 }));
    assert(
      firstInLine.hp < 300 && unhallowed.hp < 300 && throughLine.desecrationFields.length === 1,
      'Defiling Lance pierces its whole line and fouls the ground under the affected'
    );
  }],

  ['drains: Corrode twins that heal for their corrosion, minions that feed themselves and their summoner, gear that drinks a share of the blow', async () => {
    await import('../spells/classSpells');
    const R = (cm: number): number => cm * RANGE_UNIT;
    const has = (m: Mage, key: string): boolean => m.statuses.some((s) => s.key === key);
    const summon = (game: GameState, owner: Mage, words: WordId[], at: { x: number; y: number }): Mage => {
      void getSpell(words, 'life')!.cast(game.effectContext(owner, null, at));
      const raised = game.summonsOf(owner);
      return raised[raised.length - 1];
    };
    const lay = (game: GameState, caster: Mage, words: WordId[]): void => {
      void getSpell(words, 'hexcraft')!.cast(game.effectContext(caster, caster, null));
    };
    const wear = (game: GameState, bearer: Mage, words: WordId[]): void => {
      void getSpell(words, 'objects')!.cast(game.effectContext(bearer, bearer, null));
    };
    const hit = (game: GameState, from: Mage, to: Mage, amount: number, type: 'corrosive' | 'shatter' | 'pierce'): number =>
      dealDamage(game.effectContext(from, to, null), to, dmg(amount, type), { canMiss: false });
    /** A caster at 200 health, so every drink shows. */
    const thirsty = (name: string, x = 300): Mage => {
      const m = godUnit(name, 1, x);
      m.hp = 200;
      return m;
    };

    const roster: [WordId[], string, string, string][] = [
      [['drain', 'twist'], 'gag-leech', 'gaggingFang', 'chokingThirst'],
      [['drain', 'bind'], 'blood-slime', 'leechingChains', 'clingingThirst'],
      [['drain', 'shatter'], 'leech-brute', 'conjuredBloodhammer', 'brittleThirst'],
      [['drain', 'curse'], 'blood-idol', 'thirstingCurse', 'curseOfThirst'],
      [['drain', 'twist', 'bind'], 'bloodjaw', 'bloodGag', 'gnawingLockdown'],
      [['drain', 'twist', 'shatter'], 'bloodmill', 'leechspring', 'grindingThirst'],
      [['drain', 'twist', 'curse'], 'leech-wheel', 'thirstingSpindle', 'passingThirst'],
      [['drain', 'bind', 'shatter'], 'blood-warden', 'conjuredLeechingBuckler', 'calcifiedThirst'],
      [['drain', 'bind', 'curse'], 'fetter-leech', 'thirstingFetters', 'festeringThirst'],
      [['drain', 'shatter', 'curse'], 'gorged-toad', 'blightdrinker', 'crackedVessels'],
    ];
    for (const [words, kind, gear, rule] of roster) {
      const label = words.join(' ');
      const caster = godUnit('Caster', 1, 300);
      const field = new GameState([caster, godUnit('Other', 2, 900)], 1101);
      equal(summon(field, caster, words, { x: 500, y: 270 })?.summonKind, kind, `Life ${label} raises its minion`);
      assert(getSpell(words, 'life')!.description.includes('heals it as well as you'), `Life ${label} says its minion feeds itself too`);
      wear(field, caster, words);
      const geared =
        caster.hands.includes(gear as never) ||
        caster.statuses.some((s) => s.kind === 'imbue' && (s as { imbue: string }).imbue === gear);
      assert(geared, `Objects ${label} arms you with ${gear}`);
      lay(field, caster, words);
      assert(field.hexLaw(rule as never), `Hexcraft ${label} lays its law`);
    }

    // ---- Minions feed themselves and their summoner ----
    const leechOwner = thirsty('LeechOwner', 200);
    const leechPrey = godUnit('LeechPrey', 2, 600);
    const marsh = new GameState([leechOwner, leechPrey], 1103);
    const leech = summon(marsh, leechOwner, ['drain', 'twist'], { x: 560, y: 270 });
    leech.hp = 2;
    marsh.lastIntrinsicDamage = 3;
    leech.intrinsicMelee!.onHit!(marsh.effectContext(leech, leechPrey, null), leechPrey);
    equal([leechOwner.hp, leech.hp], [203, 5], 'A Gag Leech bite heals the leech and its summoner for what it drank');

    const wheelOwner = thirsty('WheelOwner', 200);
    const wheelPrey = godUnit('WheelPrey', 2, 600);
    const mill = new GameState([wheelOwner, wheelPrey], 1105);
    const wheel = summon(mill, wheelOwner, ['drain', 'twist', 'curse'], { x: 560, y: 270 });
    wheel.hp = 1;
    mill.lastIntrinsicDamage = 2;
    wheel.intrinsicMelee!.onHit!(mill.effectContext(wheel, wheelPrey, null), wheelPrey);
    const [ownerBefore, wheelBefore, preyBefore] = [wheelOwner.hp, wheel.hp, wheelPrey.hp];
    mill.currentIndex = 1;
    mill.beginTurn();
    const sipped = preyBefore - wheelPrey.hp;
    assert(
      sipped > 0 && wheelOwner.hp - ownerBefore === sipped && wheel.hp - wheelBefore === sipped,
      "A Leech Wheel's Drinking Wheel feeds both the wheel and its summoner as it ticks"
    );

    const idolOwner = thirsty('IdolOwner', 200);
    const idolPal = godUnit('IdolPal', 1, 500, 300);
    const idolFoe = godUnit('IdolFoe', 2, 540);
    const shrine = new GameState([idolOwner, idolPal, idolFoe], 1107);
    const idol = summon(shrine, idolOwner, ['drain', 'curse'], { x: 520, y: 270 });
    idol.hp = 3;
    runPulse(shrine, idol, idolOwner, MINIONS['blood-idol'].pulse!);
    const bled = 600 - idolPal.hp - idolFoe.hp;
    assert(idolPal.hp < 300 && idolFoe.hp < 300, 'A Blood Idol drains everyone near it but its summoner, your side included');
    equal([idolOwner.hp, idol.hp], [200 + bled, Math.min(8, 3 + bled)], 'and both it and its summoner drink all of it');

    // ---- Gear drinks a share of the blow ----
    const chained = thirsty('Chained');
    const brute = godUnit('Brute', 2, 360);
    const chainYard = new GameState([chained, brute], 1111);
    wear(chainYard, chained, ['drain', 'bind']);
    imbueAfterStrike(chainYard, brute, chained, 10);
    equal([300 - brute.hp, chained.hp, brute.isStunned('movement')], [5, 205, true], 'Leeching Chains drains half the blow back from its attacker and roots it');
    imbueAfterStrike(chainYard, brute, chained, 40);
    equal([300 - brute.hp, chained.hp], [25, 225], 'and the drain grows with the blow');

    const wringer = thirsty('Wringer');
    const wrung = godUnit('Wrung', 2, 360);
    const wringYard = new GameState([wringer, wrung], 1113);
    wear(wringYard, wringer, ['drain', 'twist']);
    for (let i = 0; i < 3; i++) imbueAfterStrike(wringYard, wringer, wrung, 6);
    equal([300 - wrung.hp, wringer.hp], [9, 209], 'Gagging Fang drains half of each of its three blows');
    assert(wrung.statuses.some((s) => s.kind === 'stifle'), 'and stifles the target');
    equal(wringer.statuses.some((s) => s.kind === 'imbue'), false, 'and is spent after three');

    const curser = thirsty('Curser');
    const cursed = godUnit('Cursed', 2, 360);
    const cursing = new GameState([curser, cursed], 1115);
    wear(cursing, curser, ['drain', 'curse']);
    imbueAfterStrike(cursing, curser, cursed, 9);
    cursing.currentIndex = 1;
    cursing.beginTurn();
    equal([300 - cursed.hp, curser.hp], [5, 205], 'Thirsting Curse ticks for half the blow that laid it, and its wielder drinks it');

    const smith = thirsty('Smith');
    const anvil = godUnit('Anvil', 2, 360);
    const forge = new GameState([smith, anvil], 1117);
    wear(forge, smith, ['drain', 'shatter']);
    equal(smith.hands, ['conjuredBloodhammer'], 'Objects Drain Shatter conjures a Bloodhammer');
    imbueAfterStrike(forge, smith, anvil, 8, getItem('conjuredBloodhammer').onHit);
    equal([300 - anvil.hp, smith.hp, has(anvil, 'debuff:pitted')], [4, 204, true], 'its blows drain half their damage and crack the target');

    const springer = thirsty('Springer');
    const sprung = godUnit('Sprung', 2, 360);
    const springYard = new GameState([springer, sprung], 1119);
    wear(springYard, springer, ['drain', 'twist', 'shatter']);
    equal(imbueDeflects(springYard, sprung, springer, 10), true, 'Leechspring negates a basic attack');
    assert(sprung.hp <= 294 && springer.hp === 205, 'shatters the attacker and drains half the blow it turned aside');

    // ---- Laws heal what corrosion takes ----
    const twister = thirsty('Twister');
    const twisted = godUnit('Twisted', 2, 400);
    const vortex = new GameState([twister, twisted], 1123);
    lay(vortex, twister, ['drain', 'twist']);
    hit(vortex, twister, twisted, 3, 'corrosive');
    assert(twisted.statuses.some((s) => s.kind === 'stifle') && twister.hp === 203, 'Choking Thirst stifles at the first corrosive hit of a round and feeds its attacker');
    hit(vortex, twister, twisted, 3, 'corrosive');
    equal(twister.hp, 203, 'only once a round');

    const clinger = thirsty('Clinger');
    const clung = godUnit('Clung', 2, 400);
    const bog = new GameState([clinger, clung], 1125);
    lay(bog, clinger, ['drain', 'bind']);
    hit(bog, clinger, clung, 3, 'corrosive');
    equal([clung.isStunned('movement'), clinger.hp], [true, 203], 'Clinging Thirst roots at the first corrosive hit and feeds its attacker');

    const cracker = thirsty('Cracker');
    const brittle = godUnit('Brittle', 2, 400);
    const kiln = new GameState([cracker, brittle], 1127);
    lay(kiln, cracker, ['drain', 'shatter']);
    hit(kiln, cracker, brittle, 2, 'corrosive');
    equal(cracker.hp, 200, 'Brittle Thirst: a corrosive hit only makes its target brittle');
    hit(kiln, cracker, brittle, 2, 'shatter');
    const cracked = 300 - brittle.hp - 4;
    assert(cracked >= 1 && cracker.hp - 200 === cracked, 'and the next shatter hit drains it for 1d6 more');

    const thirster = thirsty('Thirster');
    const parched = godUnit('Parched', 2, 400);
    const desert = new GameState([thirster, parched], 1129);
    lay(desert, thirster, ['drain', 'curse']);
    applyDot(desert.effectContext(thirster, parched, null), parched, { name: 'Sore', duration: 3, damage: dmg(1, 'corrosive') });
    assert(has(parched, 'debuff:curse-corrode-slow'), 'Curse of Thirst slows every afflicted unit');
    desert.currentIndex = 1;
    desert.beginTurn();
    assert(thirster.hp > 200 && 300 - parched.hp - 1 === thirster.hp - 200, 'and every tick drains 1d3 more into whoever laid it');

    const jailer = thirsty('Jailer');
    const jailed = godUnit('Jailed', 2, 400);
    const jail = new GameState([jailer, jailed], 1133);
    lay(jail, jailer, ['drain', 'twist', 'bind']);
    applyStun(jail.effectContext(jailer, jailed, null), jailed, { duration: 2, type: 'movement' });
    const bolt = getSpell(['pierce'], null)!;
    equal(jail.stopDeclaredAction(jail.makeSpellItem(jailed, bolt, jailer, null)), true, "Gnawing Lockdown stops a rooted unit's first action");
    assert(jailed.hp < 300 && jailer.hp - 200 === 300 - jailed.hp, 'and drains it into the nearest unit of another side');
    equal(jail.stopDeclaredAction(jail.makeSpellItem(jailed, bolt, jailer, null)), false, 'once a round');

    const grinder = thirsty('Grinder');
    const ground = godUnit('Ground', 2, 400);
    const quarry = new GameState([grinder, ground], 1135);
    lay(quarry, grinder, ['drain', 'twist', 'shatter']);
    quarry.slamDamage(quarry.effectContext(grinder, ground, null), ground, 3, 'shatter');
    const ground2 = 300 - ground.hp - 6;
    assert(ground2 >= 1 && grinder.hp - 200 === ground2, 'Grinding Thirst doubles a slam and drains 1d6 more into whoever slammed it');

    const passer = thirsty('Passer', 100);
    const carrier = godUnit('Carrier', 2, 500);
    const heir = godUnit('Heir', 2, 500 + R(2));
    const relay = new GameState([passer, carrier, heir], 1137);
    lay(relay, passer, ['drain', 'twist', 'curse']);
    applyDot(relay.effectContext(passer, carrier, null), carrier, { name: 'Sore', duration: 3, damage: dmg(1, 'corrosive') });
    lawRoundEnd(relay);
    assert(has(heir, 'dot:Sore') && !has(carrier, 'dot:Sore'), 'Passing Thirst moves a damage over time on');
    equal(passer.hp - 200, 300 - carrier.hp, 'and whoever laid it drinks the bite it leaves behind');

    const calcifier = thirsty('Calcifier');
    const stone = godUnit('Stone', 2, 400);
    const cairn = new GameState([calcifier, stone], 1139);
    lay(cairn, calcifier, ['drain', 'bind', 'shatter']);
    applyStun(cairn.effectContext(calcifier, stone, null), stone, { duration: 3, type: 'movement' });
    hit(cairn, calcifier, stone, 3, 'corrosive');
    equal([300 - stone.hp, calcifier.hp], [4, 204], 'Calcified Thirst: a corrosive hit on a rooted unit deals 1 more and feeds its attacker');
    hit(cairn, calcifier, stone, 2, 'shatter');
    equal(stone.isStunned('full'), true, 'and the first shatter hit on it each round stuns it');

    const festerer = thirsty('Festerer');
    const festered = godUnit('Festered', 2, 400);
    const sore = new GameState([festerer, festered], 1141);
    lay(sore, festerer, ['drain', 'bind', 'curse']);
    applyStun(sore.effectContext(festerer, festered, null), festered, { duration: 3, type: 'movement' });
    applyDot(sore.effectContext(festerer, festered, null), festered, { name: 'Sore', duration: 3, damage: dmg(2, 'corrosive') });
    sore.currentIndex = 1;
    sore.beginTurn();
    equal([300 - festered.hp, festerer.hp], [4, 204], 'Festering Thirst doubles corrosion on a rooted unit and feeds whoever laid it');

    const potter = thirsty('Potter');
    const vessel = godUnit('Vessel', 2, 400);
    const kilnyard = new GameState([potter, vessel], 1143);
    lay(kilnyard, potter, ['drain', 'shatter', 'curse']);
    applyDot(kilnyard.effectContext(potter, vessel, null), vessel, { name: 'Sore', duration: 3, damage: dmg(2, 'corrosive') });
    hit(kilnyard, potter, vessel, 1, 'shatter');
    equal([300 - vessel.hp, potter.hp], [3, 202], 'Cracked Vessels sets corrosion off at a shatter hit and feeds its attacker');

    // ---- Ordinary spells ----
    const sipper = thirsty('Sipper', 200);
    const sipped2 = godUnit('Sipped', 2, 400);
    const tavern = new GameState([sipper, sipped2], 1149);
    getSpell(['drain', 'twist'], null)!.cast(tavern.effectContext(sipper, sipped2, null));
    assert(
      sipped2.statuses.some((s) => s.kind === 'stifle') && sipper.hp - 200 === 300 - sipped2.hp,
      'Throttle drinks its target and stifles it'
    );

    const locker = thirsty('Locker');
    const locked = godUnit('Locked', 2, 400);
    const vault = new GameState([locker, locked], 1151);
    getSpell(['drain', 'twist', 'bind'], null)!.cast(vault.effectContext(locker, locked, null));
    equal(vault.stopDeclaredAction(vault.makeSpellItem(locked, bolt, locker, null)), true, 'Bloodlock stifles the next action');
    assert(locked.hp <= 298 && locker.hp - 200 === 300 - locked.hp, 'and drains 2d4 from it into its caster');

    const shackler = thirsty('Shackler');
    const shackled = godUnit('Shackled', 2, 400);
    const cell = new GameState([shackler, shackled], 1153);
    getSpell(['drain', 'bind', 'curse'], null)!.cast(cell.effectContext(shackler, shackled, null));
    cell.currentIndex = 1;
    cell.beginTurn();
    assert(shackled.hp < 300 && shackler.hp - 200 === 300 - shackled.hp, 'Leech Shackles drain their bearer into the caster');

    const digger = thirsty('Digger');
    const fallen = creature('Fallen', 500);
    const pit = new GameState([digger, fallen], 1155);
    getSpell(['drain', 'shatter', 'desecrate'], null)!.cast(pit.effectContext(digger, null, { x: 500, y: 270 }));
    pit.currentIndex = 1;
    pit.beginTurn();
    const drunkPit = digger.hp - 200;
    assert(drunkPit >= 1 && drunkPit < 300 - fallen.hp, 'Gorging Pit feeds its caster the corrosion, not the shatter');
  }],

  ['binds: wardens guard their side, shackles turn enemy gear on its owner, and Bind laws cut both ways', async () => {
    await import('../spells/classSpells');
    const R = (cm: number): number => cm * RANGE_UNIT;
    const has = (m: Mage, key: string): boolean => m.statuses.some((s) => s.key === key);
    const stifled = (m: Mage): boolean => m.statuses.some((s) => s.kind === 'stifle');
    const imbued = (m: Mage, id: string) =>
      m.statuses.find((s) => s.kind === 'imbue' && (s as { imbue: string }).imbue === id) as { boundIndex?: number } | undefined;
    const summon = (game: GameState, owner: Mage, words: WordId[], at: { x: number; y: number }): Mage => {
      void getSpell(words, 'life')!.cast(game.effectContext(owner, null, at));
      const raised = game.summonsOf(owner);
      return raised[raised.length - 1];
    };
    const lay = (game: GameState, caster: Mage, words: WordId[]): void => {
      void getSpell(words, 'hexcraft')!.cast(game.effectContext(caster, caster, null));
    };
    const arm = (game: GameState, caster: Mage, target: Mage, words: WordId[]): void => {
      void getSpell(words, 'objects')!.cast(game.effectContext(caster, target, null));
    };
    const root = (game: GameState, from: Mage, to: Mage): void =>
      applyStun(game.effectContext(from, to, null), to, { duration: 3, type: 'movement' });
    const hit = (game: GameState, from: Mage, to: Mage, amount: number, type: 'shatter' | 'pierce'): number =>
      dealDamage(game.effectContext(from, to, null), to, dmg(amount, type), { canMiss: false });
    const bolt = getSpell(['pierce'], null)!;

    const roster: [WordId[], string, string, 'self' | 'foe', string][] = [
      [['bind', 'twist'], 'gaoler', 'shackledGrip', 'foe', 'gagOrder'],
      [['bind', 'shatter'], 'bulwark', 'brittleFetters', 'foe', 'petrifaction'],
      [['bind', 'twist', 'shatter'], 'warding-obelisk', 'shatterlockMail', 'self', 'breakingPoint'],
      [['bind', 'twist', 'curse'], 'shackle-wraith', 'effigyBlade', 'self', 'hexedSilence'],
      [['bind', 'shatter', 'curse'], 'basilisk', 'gorgonCharm', 'self', 'shatteredCurses'],
    ];
    for (const [words, kind, gear, bearer, rule] of roster) {
      const label = words.join(' ');
      const caster = godUnit('Caster', 1, 300);
      const other = godUnit('Other', 2, 600);
      const field = new GameState([caster, other], 1201);
      equal(summon(field, caster, words, { x: 450, y: 270 })?.summonKind, kind, `Life ${label} raises its minion`);
      arm(field, caster, bearer === 'foe' ? other : caster, words);
      assert(imbued(bearer === 'foe' ? other : caster, gear), `Objects ${label} lays ${gear}`);
      lay(field, caster, words);
      assert(field.hexLaw(rule as never), `Hexcraft ${label} lays its law`);
    }
    equal(getSpell(['bind', 'curse'], 'life')?.codename, 'Bind Curse', 'Bind Curse keeps its Binder, shackles and binding aura');

    // ---- Wardens guard their side ----
    const warden = godUnit('Warden', 1, 200);
    const ward = godUnit('Ward', 1, 500);
    const intruder = godUnit('Intruder', 2, 500 + R(2));
    const stranger = godUnit('Stranger', 2, 950);
    const keep = new GameState([warden, ward, intruder, stranger], 1203);
    const gaoler = summon(keep, warden, ['bind', 'twist'], { x: 450, y: 270 });
    runPulse(keep, gaoler, warden, MINIONS.gaoler.pulse!);
    assert(intruder.isStunned('movement') && stifled(intruder), 'A Gaoler roots and gags the enemy closest to one of your units');
    assert(!stranger.isStunned('movement') && !stifled(stranger), 'and leaves enemies away from your side alone');

    const mason = godUnit('Mason', 1, 200);
    const sapper = godUnit('Sapper', 2, 500 + R(1.5));
    const rampart = new GameState([mason, sapper], 1205);
    const bulwark = summon(rampart, mason, ['bind', 'shatter'], { x: 500, y: 270 });
    hit(rampart, sapper, bulwark, 6, 'pierce');
    assert(sapper.hp < 300 && sapper.isStunned('movement'), 'A Bulwark struck roots and shatters the enemies beside it');

    const keeper = godUnit('Keeper', 1, 200);
    const near = godUnit('Near', 2, 500 + R(1));
    const nearish = godUnit('Nearish', 2, 500 + R(2.5));
    const henge = new GameState([keeper, near, nearish], 1207);
    const obelisk = summon(henge, keeper, ['bind', 'twist', 'shatter'], { x: 500, y: 270 });
    runPulse(henge, obelisk, keeper, MINIONS['warding-obelisk'].pulse!);
    equal([near.isStunned('movement'), nearish.isStunned('movement')], [true, true], 'A Warding Obelisk roots every enemy around it');
    equal([stifled(near), stifled(nearish)], [true, false], 'and gags the nearest');

    const haunter = godUnit('Haunter', 1, 200);
    const haunted = godUnit('Haunted', 2, 600);
    const hauntPal = godUnit('HauntPal', 1, 660);
    const manor = new GameState([haunter, haunted, hauntPal], 1209);
    const wraith = summon(manor, haunter, ['bind', 'twist', 'curse'], { x: 520, y: 270 });
    manor.lastIntrinsicDamage = 2;
    wraith.intrinsicMelee!.onHit!(manor.effectContext(wraith, haunted, null), haunted);
    runPulse(manor, wraith, haunter, MINIONS['shackle-wraith'].pulse!);
    assert(stifled(haunted), 'A Shackle Wraith gags a cursed enemy beside one of your units');
    manor.currentIndex = 1;
    manor.beginTurn();
    assert(haunted.isStunned('movement') && haunted.hp < 300, 'and its Shackle Curse roots at every tick');

    const gazer = godUnit('Gazer', 1, 200);
    const gazed = godUnit('Gazed', 2, 600);
    const lair = new GameState([gazer, gazed], 1211);
    const basilisk = summon(lair, gazer, ['bind', 'shatter', 'curse'], { x: 520, y: 270 });
    lair.lastIntrinsicDamage = 2;
    const gaze = (): void => basilisk.intrinsicMelee!.onHit!(lair.effectContext(basilisk, gazed, null), gazed);
    gaze();
    equal([has(gazed, 'debuff:kit-stoning'), gazed.isStunned('movement')], [true, false], 'A Basilisk gaze first slows');
    gaze();
    equal(gazed.isStunned('movement'), true, 'then roots');
    gaze();
    assert(gazed.isStunned('full') && gazed.hp < 300, 'then stuns and cracks the stone');

    // ---- Shackles turn enemy gear on its owner; wards guard your own ----
    const jailer = godUnit('Jailer', 1, 300);
    const brute = godUnit('Brute', 2, 360);
    const yard = new GameState([jailer, brute], 1213);
    arm(yard, jailer, brute, ['bind', 'twist']);
    imbueAfterStrike(yard, brute, jailer, 3);
    assert(brute.isStunned('movement') && stifled(brute), 'Shackled Grip: a bound weapon roots and gags its own wielder');

    const smith = godUnit('Smith', 1, 300);
    const plated = godUnit('Plated', 2, 360);
    const forge = new GameState([smith, plated], 1215);
    arm(forge, smith, plated, ['bind', 'shatter']);
    imbueAfterStrike(forge, smith, plated, 3);
    assert(plated.hp < 300 && plated.isStunned('movement'), 'Brittle Fetters crack and root the armour they bind when it is struck');

    const sentinel = godUnit('Sentinel', 1, 300);
    const raider = godUnit('Raider', 2, 360);
    raider.hands = ['ironShortsword'];
    const gate = new GameState([sentinel, raider], 1217);
    arm(gate, sentinel, sentinel, ['bind', 'twist', 'shatter']);
    equal(imbueDeflects(gate, raider, sentinel, 5), true, 'Shatterlock Mail negates a basic attack');
    assert(raider.hp < 300 && stifled(raider), 'shatters and gags the attacker');
    equal(raider.sabotagedItems.has('ironShortsword'), true, 'and shackles the weapon it struck with');

    const hexer = godUnit('Hexer', 1, 300);
    const effigy = godUnit('Effigy', 2, 900);
    const dummy = godUnit('Dummy', 2, 360);
    const coven = new GameState([hexer, effigy, dummy], 1219);
    arm(coven, hexer, effigy, ['bind', 'twist', 'curse']);
    equal(imbued(hexer, 'effigyBlade')?.boundIndex, 1, 'Effigy Blade binds your weapon to an enemy');
    imbueAfterStrike(coven, hexer, dummy, 2);
    assert(has(effigy, 'dot:kit:Effigy Curse') && !has(dummy, 'dot:kit:Effigy Curse'), 'and a blow on anyone curses the bound enemy instead');

    const charmed = godUnit('Charmed', 1, 300);
    const stoned = godUnit('Stoned', 2, 300 + R(2));
    const garden = new GameState([charmed, stoned], 1221);
    arm(garden, charmed, charmed, ['bind', 'shatter', 'curse']);
    imbueTurnStart(garden, charmed);
    imbueTurnStart(garden, charmed);
    equal(stoned.isStunned('movement'), true, 'Gorgon Charm stiffens nearby enemies a stage each turn');
    imbueTurnStart(garden, charmed);
    assert(stoned.isStunned('full') && stoned.hp < 300, 'until they are stone');

    // ---- Laws ----
    const judge = godUnit('Judge', 1, 300);
    const convict = godUnit('Convict', 2, 400);
    const court = new GameState([judge, convict], 1223);
    lay(court, judge, ['bind', 'twist']);
    root(court, judge, convict);
    equal(court.stopDeclaredAction(court.makeSpellItem(convict, bolt, judge, null)), true, "Gag Order fails a rooted unit's first action");
    equal(convict.isStunned('movement'), false, 'and the failure frees it from its roots');

    const sculptor = godUnit('Sculptor', 1, 300);
    const statue = godUnit('Statue', 2, 400);
    const atelier = new GameState([sculptor, statue], 1225);
    lay(atelier, sculptor, ['bind', 'shatter']);
    root(atelier, sculptor, statue);
    hit(atelier, sculptor, statue, 6, 'pierce');
    equal(300 - statue.hp, 3, 'Petrifaction halves every hit on a rooted unit');
    hit(atelier, sculptor, statue, 3, 'shatter');
    equal(300 - statue.hp, 9, 'except shatter, which it doubles');

    const smasher = godUnit('Smasher', 1, 300);
    const strained = godUnit('Strained', 2, 400);
    const rack = new GameState([smasher, strained], 1227);
    lay(rack, smasher, ['bind', 'twist', 'shatter']);
    root(rack, smasher, strained);
    equal(strained.hp, 300, 'Breaking Point: a first root holds');
    root(rack, smasher, strained);
    assert(!strained.isStunned('movement') && strained.hp <= 298 && stifled(strained), 'a second one snaps: freed, shattered and gagged');

    const witch = godUnit('Witch', 1, 300);
    const hexed = godUnit('Hexed', 2, 400);
    const sabbath = new GameState([witch, hexed], 1229);
    lay(sabbath, witch, ['bind', 'twist', 'curse']);
    applyDot(sabbath.effectContext(witch, hexed, null), hexed, { name: 'Sore', duration: 3, damage: dmg(2, 'shadow') });
    root(sabbath, witch, hexed);
    equal(hexed.isStunned('movement'), false, 'Hexed Silence: a cursed unit cannot be rooted');
    applyStifle(sabbath.effectContext(witch, hexed, null), hexed);
    sabbath.stopDeclaredAction(sabbath.makeSpellItem(hexed, bolt, witch, null));
    equal(hexed.hp, 298, 'but a stifled one has its curses go off at once');

    const breaker = godUnit('Breaker', 1, 300);
    const cursed = godUnit('Cursed', 2, 400);
    const rubble = new GameState([breaker, cursed], 1231);
    lay(rubble, breaker, ['bind', 'shatter', 'curse']);
    applyDot(rubble.effectContext(breaker, cursed, null), cursed, { name: 'Sore', duration: 3, damage: dmg(2, 'corrosive') });
    hit(rubble, breaker, cursed, 1, 'shatter');
    equal(
      [300 - cursed.hp, has(cursed, 'dot:Sore'), cursed.isStunned('movement')],
      [7, false, true],
      'Shattered Curses breaks a curse open: all its ticks at once, then a root'
    );

    // ---- Ordinary spells ----
    const constable = godUnit('Constable', 1, 300);
    const suspect = godUnit('Suspect', 2, 400);
    const street = new GameState([constable, suspect], 1233);
    getSpell(['bind', 'twist'], null)!.cast(street.effectContext(constable, suspect, null));
    assert(suspect.isStunned('movement') && stifled(suspect), 'Arrest roots and gags');

    const curser = godUnit('Curser', 1, 300);
    const bound = godUnit('Bound', 2, 400);
    const hollow = new GameState([curser, bound], 1235);
    getSpell(['bind', 'curse'], null)!.cast(hollow.effectContext(curser, bound, null));
    hollow.currentIndex = 1;
    hollow.beginTurn();
    assert(bound.hp < 300 && bound.isStunned('movement'), 'Binding Curse roots at every tick');

    const locksmith = godUnit('Locksmith', 1, 300);
    const locked = godUnit('Locked', 2, 400);
    const vault = new GameState([locksmith, locked], 1237);
    root(vault, locksmith, locked);
    getSpell(['bind', 'twist', 'shatter'], null)!.cast(vault.effectContext(locksmith, locked, null));
    assert(locked.hp <= 298 && locked.isStunned('movement') && stifled(locked), 'Shatterlock cracks a rooted target and gags it');

    const gagger = godUnit('Gagger', 1, 300);
    const gagged = godUnit('Gagged', 2, 400);
    const cell = new GameState([gagger, gagged], 1239);
    getSpell(['bind', 'twist', 'curse'], null)!.cast(cell.effectContext(gagger, gagged, null));
    assert(gagged.isStunned('movement'), 'Hex Gag roots');
    cell.currentIndex = 1;
    cell.beginTurn();
    assert(gagged.hp < 300 && stifled(gagged), 'and its curse gags at every tick');
  }],

  ['curses: idols and bells that hurt every round, blows that keep hurting, and laws that echo, spiral and pass curses on', async () => {
    await import('../spells/classSpells');
    const R = (cm: number): number => cm * RANGE_UNIT;
    const dotOf = (m: Mage, key: string) =>
      m.statuses.find((s) => s.key === key) as { stacks?: number; damage: { amount: number } } | undefined;
    const summon = (game: GameState, owner: Mage, words: WordId[], at: { x: number; y: number }): Mage => {
      void getSpell(words, 'life')!.cast(game.effectContext(owner, null, at));
      const raised = game.summonsOf(owner);
      return raised[raised.length - 1];
    };
    const lay = (game: GameState, caster: Mage, words: WordId[]): void => {
      void getSpell(words, 'hexcraft')!.cast(game.effectContext(caster, caster, null));
    };
    const wear = (game: GameState, bearer: Mage, words: WordId[]): void => {
      void getSpell(words, 'objects')!.cast(game.effectContext(bearer, bearer, null));
    };
    const hit = (game: GameState, from: Mage, to: Mage, amount: number, type: 'shatter' | 'pierce'): number =>
      dealDamage(game.effectContext(from, to, null), to, dmg(amount, type), { canMiss: false });
    const curse = (game: GameState, from: Mage, to: Mage, amount: number): void =>
      applyDot(game.effectContext(from, to, null), to, { name: 'Sore', duration: 3, damage: dmg(amount, 'shadow') });
    const turnOf = (game: GameState, m: Mage): void => {
      game.currentIndex = game.mages.indexOf(m);
      game.beginTurn();
    };

    const roster: [WordId[], string, string, string][] = [
      [['curse', 'shatter'], 'fault-idol', 'faultlineEdge', 'aftershocks'],
      [['curse', 'twist'], 'hex-vortex', 'hangmansKnot', 'gyreOfCurses'],
      [['curse', 'shatter', 'twist'], 'puppeteer', 'spiralFracture', 'rattlingCurses'],
    ];
    for (const [words, kind, gear, rule] of roster) {
      const label = words.join(' ');
      const caster = godUnit('Caster', 1, 300);
      const field = new GameState([caster, godUnit('Other', 2, 900)], 1301);
      equal(summon(field, caster, words, { x: 500, y: 270 })?.summonKind, kind, `Life ${label} raises its minion`);
      wear(field, caster, words);
      const geared =
        caster.hands.includes(gear as never) ||
        caster.statuses.some((s) => s.kind === 'imbue' && (s as { imbue: string }).imbue === gear);
      assert(geared, `Objects ${label} arms you with ${gear}`);
      lay(field, caster, words);
      assert(field.hexLaw(rule as never), `Hexcraft ${label} lays its law`);
    }

    // ---- Minions hurt everything near them, every round ----
    const idolOwner = godUnit('IdolOwner', 1, 200);
    const idolPal = godUnit('IdolPal', 1, 500, 270 + R(2));
    const idolFoe = godUnit('IdolFoe', 2, 500 + R(2));
    const quake = new GameState([idolOwner, idolPal, idolFoe], 1303);
    const idol = summon(quake, idolOwner, ['curse', 'shatter'], { x: 500, y: 270 });
    runPulse(quake, idol, idolOwner, MINIONS['fault-idol'].pulse!);
    assert(
      idolPal.hp < 300 && idolFoe.hp < 300 && dotOf(idolPal, 'dot:Fault Lines') && dotOf(idolFoe, 'dot:Fault Lines') && idolOwner.hp === 300,
      'A Fault Idol quakes and cracks everything near it but its summoner, your side included'
    );

    const vortexOwner = godUnit('VortexOwner', 1, 200);
    const vortexFoe = godUnit('VortexFoe', 2, 500 + R(2));
    const whirl = new GameState([vortexOwner, vortexFoe], 1305);
    const vortex = summon(whirl, vortexOwner, ['curse', 'twist'], { x: 500, y: 270 });
    const vortexFrom = { ...vortexFoe.pos };
    runPulse(whirl, vortex, vortexOwner, MINIONS['hex-vortex'].pulse!);
    assert(
      vortexFoe.hp < 300 && dist(vortexFoe.pos, vortexFrom) > R(0.5) && dotOf(vortexFoe, 'dot:kit:Dizzying Hex'),
      'A Hex Vortex spins, hurts and curses whoever is near it'
    );

    const puppetOwner = godUnit('PuppetOwner', 1, 200);
    const puppetPal = godUnit('PuppetPal', 1, 500 + R(1.5));
    const marionette = godUnit('Marionette', 2, 500 + R(4));
    const stage = new GameState([puppetOwner, puppetPal, marionette], 1309);
    const puppeteer = summon(stage, puppetOwner, ['curse', 'shatter', 'twist'], { x: 500, y: 270 });
    runPulse(stage, puppeteer, puppetOwner, MINIONS.puppeteer.pulse!);
    assert(puppetPal.hp < 300 && dotOf(marionette, 'dot:kit:Marionette Strings'), 'A Puppeteer cuts the units beside it and strings up the nearest enemy');
    const strungFrom = { ...marionette.pos };
    turnOf(stage, marionette);
    assert(marionette.hp < 300 && dist(marionette.pos, strungFrom) > R(0.5), 'and every tick of the strings turns it around the puppeteer');

    // ---- Blows that keep hurting ----
    const smith = godUnit('Smith', 1, 300);
    const anvil = godUnit('Anvil', 2, 360);
    const forge = new GameState([smith, anvil], 1313);
    wear(forge, smith, ['curse', 'shatter']);
    imbueAfterStrike(forge, smith, anvil, 9);
    turnOf(forge, anvil);
    equal(300 - anvil.hp, 6, 'Faultline Edge leaves an aftershock of two thirds the blow at every tick');

    const hangman = godUnit('Hangman', 1, 200);
    const hanged = godUnit('Hanged', 2, 500);
    const gallows = new GameState([hangman, hanged], 1315);
    wear(gallows, hangman, ['curse', 'twist']);
    imbueAfterStrike(gallows, hangman, hanged, 6);
    turnOf(gallows, hanged);
    assert(hanged.hp === 297 && dist(hanged.pos, hangman.pos) < 300 - R(1.5), "Hangman's Knot chokes for half the blow and drags the target in");

    const spinner = godUnit('Spinner', 1, 300);
    const spun = godUnit('Spun', 2, 400);
    const loom = new GameState([spinner, spun], 1319);
    wear(loom, spinner, ['curse', 'shatter', 'twist']);
    imbueAfterStrike(loom, spinner, spun, 6);
    const spunFrom = { ...spun.pos };
    turnOf(loom, spun);
    assert(spun.hp === 297 && dist(spun.pos, spunFrom) > R(0.5), 'Spiral Fracture cracks for half the blow and turns the target at every tick');

    // ---- Laws ----
    const quaker = godUnit('Quaker', 1, 300);
    const cracked = godUnit('Cracked', 2, 400);
    const fault = new GameState([quaker, cracked], 1323);
    lay(fault, quaker, ['curse', 'shatter']);
    hit(fault, quaker, cracked, 4, 'shatter');
    hit(fault, quaker, cracked, 3, 'shatter');
    equal(dotOf(cracked, 'dot:law-aftershock')?.damage.amount, 7, 'Aftershocks: shatter hits echo, and the echoes add up');
    turnOf(fault, cracked);
    equal(300 - cracked.hp, 14, 'and the echo lands at the start of its turn');

    const gyrer = godUnit('Gyrer', 1, 300);
    const gyred = godUnit('Gyred', 2, 400);
    const gyre = new GameState([gyrer, gyred], 1325);
    lay(gyre, gyrer, ['curse', 'twist']);
    curse(gyre, gyrer, gyred, 2);
    const gyredFrom = { ...gyred.pos };
    turnOf(gyre, gyred);
    assert(dist(gyred.pos, gyredFrom) > R(0.5), 'Gyre of Curses turns every cursed unit around whoever cursed it');

    const rattler = godUnit('Rattler', 1, 300);
    const rattled = godUnit('Rattled', 2, 400);
    const chains = new GameState([rattler, rattled], 1329);
    lay(chains, rattler, ['curse', 'shatter', 'twist']);
    curse(chains, rattler, rattled, 3);
    chains.orbitAround(rattled, rattler.pos, true);
    equal(rattled.hp, 297, 'Rattling Curses: a turned unit takes its curses at once');
    chains.forceMove(rattler, rattled, { x: rattled.x + R(2), y: rattled.y });
    equal(rattled.hp, 297, 'once a round');

    // ---- Ordinary spells ----
    const noose = godUnit('Noose', 1, 200);
    const swinging = godUnit('Swinging', 2, 500);
    const scaffold = new GameState([noose, swinging], 1333);
    getSpell(['curse', 'twist'], null)!.cast(scaffold.effectContext(noose, swinging, null));
    turnOf(scaffold, swinging);
    assert(swinging.hp < 300 && dist(swinging.pos, noose.pos) < 300 - R(1.5), "Hangman's Noose hurts and hauls its target in at every tick");

    const spiraller = godUnit('Spiraller', 1, 300);
    const spiralled = godUnit('Spiralled', 2, 400);
    const stair = new GameState([spiraller, spiralled], 1335);
    getSpell(['curse', 'shatter', 'twist'], null)!.cast(stair.effectContext(spiraller, spiralled, null));
    assert(spiralled.hp <= 298 && dotOf(spiralled, 'dot:Shattering Spiral'), 'Shattering Spiral cracks its target and curses it to spin');
  }],

  ['deaths: a Shikigami on your shoulder fed with offerings, minions that spare your side, a ferryman with a reach, Reap and Dread, and laws on dying itself', async () => {
    await import('../spells/classSpells');
    const R = (cm: number): number => cm * RANGE_UNIT;
    const DS: WordId[] = ['death', 'shadow'];
    const DP: WordId[] = ['death', 'pain'];
    const DSP: WordId[] = ['death', 'shadow', 'pain'];
    const summon = (game: GameState, owner: Mage, words: WordId[], at: { x: number; y: number }): Mage => {
      void getSpell(words, 'life')!.cast(game.effectContext(owner, null, at));
      const raised = game.summonsOf(owner);
      return raised[raised.length - 1];
    };
    const lay = (game: GameState, caster: Mage, words: WordId[]): void => {
      void getSpell(words, 'hexcraft')!.cast(game.effectContext(caster, caster, null));
    };
    const wear = (game: GameState, bearer: Mage, words: WordId[]): void => {
      void getSpell(words, 'objects')!.cast(game.effectContext(bearer, bearer, null));
    };
    const slay = (game: GameState, from: Mage, to: Mage): void => {
      dealDamage(game.effectContext(from, to, null), to, dmg(999, 'pierce'), { canMiss: false, trueDamage: true });
    };
    const owes = (m: Mage): boolean => m.statuses.some((s) => s.key === 'debuff:deaths-due');
    const dreadOf = (m: Mage): number => (m.statuses.find((s) => s.kind === 'dread') as { stacks: number } | undefined)?.stacks ?? 0;

    // ---- Death Shadow ----
    const rider = godUnit('Rider', 1, 200);
    const ally = godUnit('Ally', 1, 260, 400);
    const den = new GameState([rider, ally, godUnit('FoeA', 2, 600), godUnit('FoeB', 2, 700, 400)], 1401);
    rider.startStormDay(3);
    const ghost = summon(den, rider, ['pain', 'shadow'], { x: 260, y: 200 });
    await getSpell(DS, 'life')!.cast(den.effectContext(rider, rider, null));
    equal([rider.shikigami?.points, rider.shikigami?.day], [0, 3], 'Life Death Shadow seats a Shikigami on your shoulder for the day');
    assert(den.mages.length === 5, 'it is no unit on the field: nothing can target or harm it');
    offerToShikigami(den, rider, { life: 12, items: true, summons: [ghost] });
    equal(
      [rider.shikigami?.points, rider.maxHp, ghost.alive, rider.itemsSacrificed()],
      [6, 288, false, true],
      "12 health, the day's items and a minion make 6 points"
    );
    offerToShikigami(den, rider, { life: 4, items: true, summons: [] });
    equal([rider.shikigami?.points, rider.maxHp], [6, 288], 'but no more than 12 health a day, and the items once');
    rider.utility = ['manaPotion'];
    assert(rider.isItemBanned(rider.utility[0]), 'and items given away cannot be used');
    shoulderTurn(den, rider);
    assert(den.mages.some((m) => den.reapOn(m) > 0), 'At the start of your turns it acts by its rank, on anyone at all');
    const carried = restoreParty(capturePartySnapshot([rider]))[0];
    equal(carried.shikigami, rider.shikigami, 'It rides from fight to fight in a saved party');
    rider.startStormDay(4);
    equal([rider.shikigami, rider.maxHp, rider.itemsSacrificed()], [undefined, 300, false], 'and leaves with the day, giving the health back');

    const lonely = godUnit('Lonely', 1, 200);
    const friendly = godUnit('Friendly', 1, 300);
    const camp = new GameState([lonely, friendly], 1402);
    offerToShikigami(camp, lonely, { life: 0, items: false, summons: [] });
    lonely.hp = 3;
    friendly.hp = 3;
    shoulderTurn(camp, lonely);
    assert(!lonely.alive || !friendly.alive, 'Rank 1: it executes a random unit for 3, friend or foe, you included');

    const grim = godUnit('Grim', 1, 200);
    const fallen = godUnit('Fallen', 2, 600);
    const close = godUnit('Close', 2, 700);
    const farFoe = godUnit('FarFoe', 2, 1000);
    const ranks = new GameState([grim, fallen, close, farFoe], 1403);
    grim.shikigami = { points: 7, day: 1, lifePaid: 0, itemsPaid: false };
    ranks.applyReap(fallen, 4, grim);
    ranks.executeTarget(grim, fallen, 300);
    equal([fallen.alive, ranks.reapOn(close), ranks.reapOn(farFoe)], [false, 3, 0], 'Rank 4: the felled pass three quarters of their Reap to your nearest enemy');
    grim.shikigami.points = 9;
    close.hp = 10;
    ranks.applyReap(close, 2, grim);
    equal(close.alive, false, 'Rank 5: an enemy whose Reap reaches half its health is executed');

    const ward = godUnit('Ward', 1, 300);
    const boss = godUnit('Boss', 2, 900);
    const straggler = godUnit('Straggler', 2, 700);
    const river = new GameState([ward, boss, straggler], 1403);
    wear(river, ward, DS);
    river.applyReap(boss, 2, ward);
    straggler.hp = 6;
    river.applyReap(straggler, 1, ward);
    equal(river.reapOn(boss), 3, "Ferryman's Obol: the bearer's Reap is 1 higher");
    slay(river, boss, ward);
    assert(
      ward.hp === 1 && boss.alive && !straggler.alive,
      'and when it would die, the most reaped enemy at no more than 3 health per Reap dies in its place'
    );
    slay(river, boss, ward);
    equal(ward.alive, false, 'but only once');

    const host = godUnit('Host', 1, 300);
    const guest = godUnit('Guest', 2, 500);
    const third = godUnit('Third', 2, 700);
    const holiday = new GameState([host, guest, third], 1405);
    lay(holiday, host, DS);
    slay(holiday, host, guest);
    holiday.applyReap(guest, 5, host);
    assert(guest.alive && guest.hp === 1 && owes(guest), "Death's Holiday: nobody dies, not even to Reap, but they owe");
    slay(holiday, guest, third);
    assert(third.alive && owes(third) && !owes(guest), 'a debtor whose blow would kill pays its debt with that life');
    holiday.hexLaw('deathsHoliday')!.roundsLeft = 1;
    passRound(holiday);
    assert(!third.alive && guest.alive, 'and when the law ends, every debtor dies');

    // ---- Death Pain ----
    const cantor = godUnit('Cantor', 1, 200);
    const choirPal = godUnit('ChoirPal', 1, 500, 270 + R(2));
    const listener = godUnit('Listener', 2, 500 + R(2));
    const far = godUnit('Far', 2, 500 + R(9));
    const frail = godUnit('Frail', 2, 500 - R(2));
    const chapel = new GameState([cantor, choirPal, listener, far, frail], 1407);
    const requiem = summon(chapel, cantor, DP, { x: 500, y: 270 });
    equal(requiem?.summonKind, 'requiem', 'Life Death Pain raises a Requiem');
    assert(!chapel.canCommandSummon(cantor, requiem), 'and it obeys no one');
    frail.sanity = 1;
    runPulse(chapel, requiem, cantor, MINIONS.requiem.pulse!);
    equal([frail.alive, requiem.deathRite?.souls], [false, 1], 'Every unit its song kills joins the choir');
    for (let verse = 2; verse <= 4; verse++) runPulse(chapel, requiem, cantor, MINIONS.requiem.pulse!);
    assert(
      listener.sanity <= 290 && chapel.reapOn(listener) === 4 && chapel.reapOn(choirPal) === 0 && choirPal.sanity === 300 && far.sanity === 300,
      'Its four verses grow in sanity and Reap for the enemies near it, and spare your side'
    );
    listener.sanity = 100;
    runPulse(chapel, requiem, cantor, MINIONS.requiem.pulse!);
    assert(!listener.alive && choirPal.alive && !requiem.alive, 'The Lacrimosa takes every broken mind, then the choir crumbles');

    const scyther = godUnit('Scyther', 1, 300);
    const soul = godUnit('Soul', 2, 360);
    const fragile = godUnit('Fragile', 2, 360, 340);
    const harvest = new GameState([scyther, soul, fragile], 1409);
    wear(harvest, scyther, DP);
    imbueAfterStrike(harvest, scyther, soul, 50);
    const reaped = harvest.reapOn(soul);
    assert(
      soul.maxSanity === 300 && reaped >= 1 && reaped <= 6 && dreadOf(soul) === reaped,
      'Severing Scythe: a blow reaps 1d6 and fills the mind with as much Dread'
    );
    soul.sanity = reaped + 1;
    dealDamage(harvest.effectContext(scyther, soul, null), soul, dmg(1, 'sanity'), { canMiss: false });
    equal(soul.alive, false, 'Dread takes the mind at or below it');
    fragile.hp = 1;
    scyther.sanity = 200;
    imbueAfterStrike(harvest, scyther, fragile, 1);
    assert(!fragile.alive && scyther.sanity > 200, 'and a soul it takes is yours to wear');

    const binder = godUnit('Binder', 1, 300);
    const mortal = godUnit('Mortal', 2, 500);
    const coil = new GameState([binder, mortal], 1411);
    mortal.sanity = 100;
    lay(coil, binder, DP);
    equal(mortal.hp, 100, 'Mortal Coil: the body falls to the mind the moment it is laid');
    dealDamage(coil.effectContext(binder, mortal, null), mortal, dmg(10, 'sanity'), { canMiss: false });
    equal([mortal.sanity, mortal.hp], [90, 90], 'and follows it down with every wound to the mind');

    // ---- Death Shadow Pain ----
    const seer = godUnit('Seer', 1, 300);
    const marked = godUnit('Marked', 2, 500);
    const kin = godUnit('Kin', 1, 500, 270 + R(1.5));
    const omened = godUnit('Omened', 2, 500, 270 + R(3));
    const steady = godUnit('Steady', 2, 900);
    const omen = new GameState([seer, marked, kin, omened, steady], 1413);
    marked.hp = 20;
    void getSpell(DSP, 'life')!.cast(omen.effectContext(seer, marked, null));
    const fetch = omen.summonsOf(seer)[0];
    assert(
      fetch?.summonKind === 'fetch' && fetch.maxHp === 10 && fetch.isImmuneTo('shadow') && !omen.canCommandSummon(seer, fetch),
      'Life Death Shadow Pain raises the Fetch of an enemy, with half its health; it obeys no one'
    );
    dealDamage(omen.effectContext(seer, marked, null), marked, dmg(4, 'pierce'), { canMiss: false });
    equal([marked.hp, fetch.hp, marked.sanity], [16, 6, 300], 'Every wound its original takes lands on the Fetch too');
    dealDamage(omen.effectContext(seer, fetch, null), fetch, dmg(2, 'pierce'), { canMiss: false });
    equal([fetch.hp, marked.sanity], [4, 298], 'and a wound on the Fetch reaches its original as sanity');
    runPulse(omen, fetch, seer, MINIONS.fetch.pulse!);
    assert(marked.sanity < 298, 'It walks to its original and stares it down');
    slay(omen, seer, marked);
    equal(
      [fetch.alive, fetch.deathRite?.originalIndex, fetch.maxHp, fetch.deathRite?.souls],
      [true, omen.mages.indexOf(omened), 150, 1],
      'If its original dies first, it moves on to the nearest enemy, never one of yours'
    );
    omened.sanity = 100;
    dealDamage(omen.effectContext(seer, omened, null), omened, dmg(150, 'pierce'), { canMiss: false });
    assert(!fetch.alive && !omened.alive && kin.alive, 'When the Fetch dies, a broken original dies with it');
    steady.hp = 10;
    void getSpell(DSP, 'life')!.cast(omen.effectContext(seer, steady, null));
    dealDamage(omen.effectContext(seer, steady, null), steady, dmg(5, 'pierce'), { canMiss: false });
    equal(steady.alive, false, 'and a steady one is executed for 6');

    const reaper = godUnit('Reaper', 1, 300);
    const cut = godUnit('Cut', 2, 360);
    const near = godUnit('Near', 2, 360 + R(2.5));
    const distant = godUnit('Distant', 2, 900);
    const friend = godUnit('Friend', 1, 360, 270 + R(2));
    const dusk = new GameState([reaper, cut, near, distant, friend], 1415);
    wear(dusk, reaper, DSP);
    for (const m of [near, distant, friend]) dusk.addShadow(m.pos, 2);
    imbueAfterStrike(dusk, reaper, cut, 3);
    assert(
      near.sanity < 300 && near.sanity >= 296 && distant.sanity === 300 && friend.sanity === 300,
      'Scythe of the Long Shadow: its shadow starts short, 1d4 sanity to enemies in a shadow within 3cm'
    );
    near.sanity = 1;
    imbueAfterStrike(dusk, reaper, cut, 3);
    assert(!near.alive && dusk.shadowsOf(1).some((s) => dist(s, near.pos) <= 1), 'every unit it kills leaves a shadow of yours');
    const scythe = reaper.statuses.find((s) => s.key === 'imbue:longShadow') as { souls?: number };
    equal(scythe.souls, 1, 'and feeds the scythe a soul');
    scythe.souls = 4;
    imbueAfterStrike(dusk, reaper, cut, 3);
    assert(
      distant.sanity <= 295 && distant.sanity >= 292 && dusk.reapOn(distant) === 2,
      'every soul reaches further and cuts deeper, with Reap from the second'
    );

    const keener = godUnit('Keener', 1, 300);
    const widow = godUnit('Widow', 2, 500);
    const departed = godUnit('Departed', 2, 600);
    const heir = godUnit('Heir', 2, 700);
    const wake = new GameState([keener, widow, departed, heir], 1417);
    lay(wake, keener, DSP);
    departed.maxHp = 40;
    heir.maxHp = 12;
    heir.sanity = 5;
    slay(wake, keener, departed);
    assert(
      !heir.alive && widow.sanity === 287,
      "The Great Mourning: the dead one's side grieves a quarter of its health, and grief that kills is mourned in turn"
    );
    assert(keener.sanity >= 292 && keener.sanity <= 298, 'its enemies 1d4 for each death');
  }],

  ['the last corners: Shatter Twist, Shatter Desecrate, Fire Pain and Mind Pain get all three class variants', async () => {
    await import('../spells/classSpells');
    for (const combo of [['shatter', 'twist'], ['shatter', 'desecrate'], ['fire', 'pain'], ['mind', 'pain']] as WordId[][]) {
      const label = combo.join(' ');
      for (const mageClass of MAGE_CLASSES) {
        assert(getSpell(combo, mageClass)?.id.endsWith(`@${mageClass}`), `${label} has a ${mageClass} variant`);
        equal(spellForSelection(combo, mageClass)?.id, getSpell(combo, mageClass)?.id, `${label} casts its ${mageClass} variant`);
      }
      equal(new Set(MAGE_CLASSES.map((c) => getSpell(combo, c)?.description)).size, 3, `${label} has three different variants`);
    }
    const summon = (game: GameState, owner: Mage, words: WordId[], at: { x: number; y: number }): Mage => {
      void getSpell(words, 'life')!.cast(game.effectContext(owner, null, at));
      const raised = game.summonsOf(owner);
      return raised[raised.length - 1];
    };
    const lay = (game: GameState, caster: Mage, words: WordId[]): void => {
      void getSpell(words, 'hexcraft')!.cast(game.effectContext(caster, caster, null));
    };
    const wear = (game: GameState, bearer: Mage, words: WordId[]): void => {
      void getSpell(words, 'objects')!.cast(game.effectContext(bearer, bearer, null));
    };
    const turnOf = (game: GameState, m: Mage): void => {
      game.currentIndex = game.mages.indexOf(m);
      game.beginTurn();
    };

    const spinner = godUnit('Spinner', 1, 200);
    const close = godUnit('Close', 2, 430);
    const whirl = new GameState([spinner, close], 1501);
    const dervish = summon(whirl, spinner, ['shatter', 'twist'], { x: 400, y: 270 });
    const stood = { ...close.pos };
    runPulse(whirl, dervish, spinner, MINIONS[dervish.summonKind!].pulse!);
    assert(close.hp < 300 && dist(close.pos, stood) > 1, 'Shard Dervish: the enemies near it are turned around it and take shatter');

    const smith = godUnit('Smith', 1, 400);
    const anvil = godUnit('Anvil', 2, 460);
    const forge = new GameState([smith, anvil], 1502);
    wear(forge, smith, ['shatter', 'twist']);
    const set = { ...anvil.pos };
    imbueAfterStrike(forge, smith, anvil, 3);
    assert(dist(anvil.pos, set) > 1, 'Torsion Hammer: a landed blow turns the target around you');

    const gardener = godUnit('Gardener', 1, 200);
    const tender = godUnit('Tender', 1, 420, 300);
    const sitter = godUnit('Sitter', 2, 450);
    const yonder = godUnit('Yonder', 2, 900);
    const yard = new GameState([gardener, tender, sitter, yonder], 1503);
    const root = summon(yard, gardener, ['shatter', 'desecrate'], { x: 400, y: 270 });
    const blight = () => yard.desecrationFields.filter((f) => f.heartIndex === yard.mages.indexOf(root));
    equal(blight().length, 1, 'Charnel Root: the ground under it rots at once');
    runPulse(yard, root, gardener, MINIONS[root.summonKind!].pulse!);
    runPulse(yard, root, gardener, MINIONS[root.summonKind!].pulse!);
    const patches = blight();
    assert(patches.length === 3 && patches[0].radius > RANGE_UNIT * 2.5, 'every turn the blight widens and breaks out further');
    assert(dist(patches[2], yonder.pos) < dist(patches[1], yonder.pos), 'reaching for the enemy it does not cover yet');
    turnOf(yard, sitter);
    turnOf(yard, tender);
    assert(300 - sitter.hp >= 2 && 300 - sitter.hp <= 10 && tender.hp === 300, 'enemies on it take 1d6 shatter and 1d4 shadow once, your side nothing');
    sitter.hp = 100;
    heal(yard.effectContext(sitter, sitter, null), sitter, 10);
    equal(sitter.hp, 100, 'and cannot be healed there');

    const wearer = godUnit('Wearer', 1, 400);
    const friend = godUnit('Friend', 1, 500);
    const foe = godUnit('Foe', 2, 600);
    const distant = godUnit('Distant', 2, 1100);
    const vigil = new GameState([wearer, friend, foe, distant], 1504);
    wear(vigil, wearer, ['shatter', 'desecrate']);
    const shroud = vigil.desecrationFields[0];
    assert(
      shroud.carrierIndex === 0 && shroud.turnsLeft >= 2 && shroud.turnsLeft <= 7 && shroud.radius === RANGE_UNIT * 6,
      'Ossuary Shroud: a 6cm fouling worn for 1d6+1 turns'
    );
    turnOf(vigil, foe);
    turnOf(vigil, friend);
    turnOf(vigil, distant);
    assert(
      300 - foe.hp >= 2 && 300 - foe.hp <= 12 && friend.hp === 300 && distant.hp === 300,
      'enemies starting a turn within 6cm take 2d6, half shatter and half shadow'
    );
    foe.hp = 100;
    heal(vigil.effectContext(foe, foe, null), foe, 10);
    equal(foe.hp, 100, 'and cannot be healed there');
    teleport(vigil.effectContext(wearer, wearer, null), wearer, { x: 900, y: 270 });
    assert(dist(shroud, wearer.pos) < 1, 'the shroud goes wherever its wearer goes');

    const tyrant = godUnit('Tyrant', 1, 200);
    const subject = godUnit('Subject', 2, 600);
    const neighbour = godUnit('Neighbour', 2, 650);
    const reign = new GameState([tyrant, subject, neighbour], 1505);
    lay(reign, tyrant, ['shatter', 'desecrate']);
    turnOf(reign, subject);
    turnOf(reign, tyrant);
    assert(
      300 - subject.hp >= 2 && 300 - subject.hp <= 12 && subject.sanity >= 296 && subject.sanity < 300 && tyrant.hp === 300,
      'Reign of Bones: the ground breaks under your enemies and dread eats their sanity'
    );
    assert(subject.statuses.some((s) => s.key === 'debuff:broken-bones'), 'their bones stay broken');
    subject.hp = 100;
    heal(reign.effectContext(subject, subject, null), subject, 10);
    equal(subject.hp, 100, 'and cannot be healed');
    reign.hexLaw('rule:reignOfBones')!.roundsLeft = 2;
    turnOf(reign, neighbour);
    assert(300 - neighbour.hp >= 6, 'by the end the ground breaks for 3d6 and 3d6');
    const standing = neighbour.hp;
    dealDamage(reign.effectContext(tyrant, subject, null), subject, dmg(999, 'pierce'), { canMiss: false, trueDamage: true });
    assert(standing - neighbour.hp >= 4 && standing - neighbour.hp <= 14, 'and a dead one bursts over its side for 2d6 shatter');

    const dreamer = godUnit('Dreamer', 1, 200);
    const frayed = godUnit('Frayed', 2, 430);
    const ward = new GameState([dreamer, frayed], 1504);
    frayed.sanity = 100;
    const migraine = summon(ward, dreamer, ['mind', 'pain'], { x: 400, y: 270 });
    runPulse(ward, migraine, dreamer, MINIONS[migraine.summonKind!].pulse!);
    assert(frayed.sanity <= 98 && frayed.sanity >= 93, 'Migraine: 1d3 sanity to the enemies near it, 1d4 more on a shaken mind');

    const pyre = godUnit('Pyre', 2, 600);
    const agony = new GameState([godUnit('Brander', 1, 200), pyre], 1511);
    lay(agony, agony.mages[0], ['fire', 'pain']);
    agony.applyFireStacks(pyre, 3, agony.mages[0]);
    turnOf(agony, pyre);
    equal(pyre.sanity, 297, 'Agonizing Flames: the burning lose sanity equal to their Fire');

    const struck = godUnit('Struck', 2, 600);
    const beside = godUnit('Beside', 2, 640);
    const ache = new GameState([godUnit('Thinker', 1, 200), struck, beside], 1512);
    lay(ache, ache.mages[0], ['mind', 'pain']);
    dealDamage(ache.effectContext(ache.mages[0], struck, null), struck, dmg(5, 'sanity'), { canMiss: false });
    equal([beside.sanity, ache.mages[0].sanity], [299, 300], 'Splitting Headaches: sanity hits splinter to everyone close but the attacker');
  }],

  ['god words: Stop answers and stops time, Reality rewrites the field, Desecrate fouls, stakes and raises', async () => {
    await import('../spells/classSpells');
    const pairs = (words: WordId[]): WordId[][] => words.flatMap((a, i) => words.slice(i + 1).map((b) => [a, b]));
    const STOP_WITH: WordId[] = ['veil', 'bind', 'pierce', 'shatter', 'twist'];
    const DESECRATE_WITH: WordId[] = ['corrode', 'curse', 'drain', 'pierce', 'shatter'];
    const stopCombos: WordId[][] = [...STOP_WITH.map((w) => ['stop', w] as WordId[]), ...pairs(STOP_WITH).map((p) => ['stop', ...p] as WordId[])];
    const realityCombos: WordId[][] = [['reality', 'mind'], ['reality', 'water'], ['reality', 'mind', 'water']];
    const desecrateCombos: WordId[][] = [
      ...DESECRATE_WITH.map((w) => [w, 'desecrate'] as WordId[]),
      ...pairs(DESECRATE_WITH).map((p) => [...p, 'desecrate'] as WordId[]),
    ];
    equal([stopCombos.length, desecrateCombos.length], [15, 15], 'every Stop and Desecrate combo is counted');
    for (const combo of [...stopCombos, ...realityCombos, ...desecrateCombos]) {
      const label = combo.join(' ');
      for (const mageClass of MAGE_CLASSES) {
        assert(getSpell(combo, mageClass)?.id.endsWith(`@${mageClass}`), `${label} has a ${mageClass} variant`);
        equal(spellForSelection(combo, mageClass)?.id, getSpell(combo, mageClass)?.id, `${label} casts its ${mageClass} variant`);
      }
      equal(new Set(MAGE_CLASSES.map((c) => getSpell(combo, c)?.description)).size, 3, `${label} has three different variants`);
    }
    for (const combo of stopCombos) {
      for (const mageClass of MAGE_CLASSES) {
        const spell = getSpell(combo, mageClass)!;
        assert(spell.reaction && spell.counters, `${combo.join(' ')} (${mageClass}) is also an answer that cancels what it answers`);
      }
    }

    const summon = (game: GameState, owner: Mage, words: WordId[], at: { x: number; y: number }): Mage => {
      void getSpell(words, 'life')!.cast(game.effectContext(owner, null, at));
      const raised = game.summonsOf(owner);
      return raised[raised.length - 1];
    };
    const lay = (game: GameState, caster: Mage, words: WordId[]): void => {
      void getSpell(words, 'hexcraft')!.cast(game.effectContext(caster, caster, null));
    };
    const wear = (game: GameState, bearer: Mage, words: WordId[]): void => {
      void getSpell(words, 'objects')!.cast(game.effectContext(bearer, bearer, null));
    };
    const turnOf = (game: GameState, m: Mage): void => {
      game.currentIndex = game.mages.indexOf(m);
      game.beginTurn();
    };
    const kill = (game: GameState, by: Mage, m: Mage): void => {
      dealDamage(game.effectContext(by, m, null), m, dmg(999, 'pierce'), { canMiss: false, trueDamage: true });
    };
    const bolt = getSpell(['pierce'], null)!;
    const R = (cm: number): number => cm * RANGE_UNIT;

    // ---- Stop ----
    const keeper = godUnit('Keeper', 1, 200);
    const talker = godUnit('Talker', 2, 500);
    const hush = new GameState([keeper, talker], 1601);
    summon(hush, keeper, ['stop', 'veil'], { x: 400, y: 270 });
    equal(hush.stopDeclaredAction(hush.makeMoveItem(talker, { x: 520, y: 270 })), false, 'Hush Warden never stops a walk');
    equal(hush.stopDeclaredAction(hush.makeSpellItem(talker, bolt, keeper, null)), true, 'Hush Warden stops what an enemy near it declares');
    const unseen = keeper.statuses.find((s) => s.kind === 'invisibility') as { mode?: string } | undefined;
    equal(unseen?.mode, 'full', 'and its summoner vanishes into a full veil');
    equal(hush.stopDeclaredAction(hush.makeSpellItem(talker, bolt, keeper, null)), false, 'once a round');

    const cloaked = godUnit('Cloaked', 1, 300);
    const brute = godUnit('Brute', 2, 360);
    const still = new GameState([cloaked, brute], 1602);
    wear(still, cloaked, ['stop', 'veil']);
    equal(still.stopDeclaredAction(still.makeMeleeItem(brute, cloaked)), true, 'Stillcloak stops the first attack aimed at its wearer');
    equal(still.stopDeclaredAction(still.makeMeleeItem(brute, cloaked)), false, 'only the first each round');
    still.round += 1;
    equal(still.stopDeclaredAction(still.makeMeleeItem(brute, cloaked)), true, 'and the first again next round');

    const smith = godUnit('Smith', 1, 300);
    const anvil = godUnit('Anvil', 2, 360);
    const clockwork = new GameState([smith, anvil], 1603);
    wear(clockwork, smith, ['stop', 'shatter']);
    imbueAfterStrike(clockwork, smith, anvil, 3);
    assert(clockwork.isTimeStopped(anvil), 'Shatterclock Hammer freezes what it strikes in time');
    dealDamage(clockwork.effectContext(smith, anvil, null), anvil, dmg(5, 'pierce'), { canMiss: false });
    equal(anvil.hp, 300, 'blows on a frozen body are held');
    turnOf(clockwork, anvil);
    clockwork.finishCurrentTurn();
    const resumed = 300 - anvil.hp;
    assert(!clockwork.isTimeStopped(anvil) && resumed >= 7 && resumed <= 17, 'and when time resumes they land at once with 2d6 shatter');

    const looper = godUnit('Looper', 1, 300);
    const loop = new GameState([looper, godUnit('Watcher', 2, 1000)], 1604);
    wear(loop, looper, ['stop', 'twist']);
    turnOf(loop, looper);
    teleport(loop.effectContext(looper, looper, null), looper, { x: 520, y: 300 });
    looper.hp = 250;
    looper.sanity = 280;
    loop.finishCurrentTurn();
    assert(
      dist(looper.pos, { x: 300, y: 270 }) < 1 && looper.hp === 300 && looper.sanity === 300,
      'Möbius Loop: an ended turn loops back to where it began, and what was lost comes back'
    );

    const glazier = godUnit('Glazier', 1, 200);
    const idle = godUnit('Idle', 2, 600);
    const runner = godUnit('Runner', 2, 800);
    const brittle = new GameState([glazier, idle, runner], 1605);
    lay(brittle, glazier, ['stop', 'shatter']);
    turnOf(brittle, idle);
    brittle.finishCurrentTurn();
    turnOf(brittle, runner);
    runner.movedThisTurn = true;
    brittle.finishCurrentTurn();
    equal([brittle.isTimeStopped(idle), brittle.isTimeStopped(runner)], [true, false], 'Brittle Time freezes an enemy that ends its turn without moving');

    for (let seed = 1620; seed < 1626; seed++) {
      const clockmaker = godUnit('Clockmaker', 1, 200);
      const skipped = godUnit('Skipped', 2, 600);
      const broken = new GameState([clockmaker, skipped], seed);
      lay(broken, clockmaker, ['stop', 'shatter', 'twist']);
      turnOf(broken, skipped);
      const { move, main, bonus } = skipped.actions;
      assert(
        main === 0 || move === 0 || bonus === 0 || skipped.hp < 300,
        'The Broken Clock skips an action at the start of every enemy turn, or wrenches the enemy around'
      );
    }

    // ---- Reality ----
    const original = godUnit('Original', 1, 300);
    original.hp = 120;
    const twin = new GameState([original, godUnit('Fooled', 2, 1000)], 1606);
    const double = summon(twin, original, ['reality', 'mind'], { x: 400, y: 270 });
    equal([double.maxHp, double.hp], [60, 60], 'Doppelganger rises with half your current health');

    const mirrorer = godUnit('Mirrorer', 1, 200);
    const lost = godUnit('Lost', 2, 700);
    const hall = new GameState([mirrorer, lost], 1607);
    lay(hall, mirrorer, ['reality', 'mind']);
    turnOf(hall, lost);
    assert(lost.x < 450 && mirrorer.x > 450, 'Hall of Mirrors: an enemy starting its turn trades places with another unit');
    assert(lost.statuses.some((s) => s.key === UNREALITY_KEY), 'and slips half out of reality');

    const tilter = godUnit('Tilter', 1, 300);
    const braced = godUnit('Braced', 1, 640);
    const sliding = godUnit('Sliding', 2, 980);
    const deck = new GameState([tilter, braced, sliding], 1608);
    lay(deck, tilter, ['reality', 'water']);
    const slidFrom = { ...sliding.pos };
    const bracedAt = { ...braced.pos };
    ruleRoundEnd(deck);
    assert(dist(sliding.pos, slidFrom) > R(2) && dist(braced.pos, bracedAt) < 1, 'World Tilt slides the field, but your units that stood still brace');

    // ---- Desecrate ----
    const plaguer = godUnit('Plaguer', 1, 300);
    const carrier = godUnit('Carrier', 2, 360);
    const ward = new GameState([plaguer, carrier], 1609);
    wear(ward, plaguer, ['corrode', 'desecrate']);
    imbueAfterStrike(ward, plaguer, carrier, 3);
    const plague = ward.desecrationFields.find((f) => f.name === 'Plague Carrier');
    assert(plague?.carrierIndex === 1 && plague.hostile, "Plaguebringer's Gauntlet makes what it strikes a plague carrier");
    teleport(ward.effectContext(carrier, carrier, null), carrier, { x: 800, y: 270 });
    assert(dist(plague, carrier.pos) < 1, 'the plague rides on its carrier');
    turnOf(ward, carrier);
    assert(carrier.hp < 300, 'and rots it at the start of its turns');

    const digger = godUnit('Digger', 1, 300);
    const doomed = godUnit('Doomed', 2, 360);
    const crypt = new GameState([digger, doomed], 1610);
    wear(crypt, digger, ['curse', 'desecrate']);
    imbueAfterStrike(crypt, digger, doomed, 3);
    assert(doomed.statuses.some((s) => s.kind === 'dot' && s.name === 'Unburied Curse'), "Ghoul's Kiss lays the Unburied Curse");
    kill(crypt, digger, doomed);
    equal(crypt.summonsOf(digger).length, 1, 'and whatever dies under it rises again as your Remnant');

    const impaler = godUnit('Impaler', 1, 200);
    const staked = godUnit('Staked', 2, 700);
    const stockade = new GameState([impaler, staked], 1611);
    lay(stockade, impaler, ['pierce', 'desecrate']);
    ruleRoundEnd(stockade);
    const ring = stockade.desecrationFieldsAt(staked.pos)[0];
    assert(
      ring?.sealed && ring.hostile && stockade.desecrationFieldsAt(impaler.pos).length === 0,
      'Field of Stakes: a sealed ring of stakes erupts around each of your enemies'
    );
    turnOf(stockade, staked);
    assert(staked.hp < 300, 'and it bleeds inside');

    const tither = godUnit('Tither', 1, 200);
    tither.hp = 100;
    const tithed = godUnit('Tithed', 2, 700);
    tithed.hp = 76;
    const tithe = new GameState([tither, tithed], 1612);
    lay(tithe, tither, ['drain', 'desecrate']);
    turnOf(tithe, tithed);
    assert(!tithed.alive && tither.hp === 176, 'The Blood Tithe drains an enemy at a quarter of its health dry, and you drink all of it');

    const feaster = godUnit('Feaster', 1, 200);
    feaster.hp = 100;
    const meal = godUnit('Meal', 2, 600);
    const mourner = godUnit('Mourner', 2, 650);
    const feast = new GameState([feaster, meal, mourner], 1613);
    lay(feast, feaster, ['drain', 'shatter', 'desecrate']);
    kill(feast, feaster, meal);
    assert(
      feaster.hp === 175 && mourner.hp >= 294 && mourner.hp < 300,
      'The Bone Feast: a dead enemy splinters into its own side, and you feast on a quarter of its health'
    );
  }],
];

for (const [name, run] of tests) {
  await run();
  console.log(`PASS ${name}`);
}
console.log(`Combat rules: ${tests.length} checks passed.`);