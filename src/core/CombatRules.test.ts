import { applyDebuff, applyDot, applyStun, dealDamage } from '../effects/effects';
import { applyEnemyTraits } from '../pve/swamprun';
import { RANGE_UNIT } from '../config/constants';
import { FIELD, MELEE_RANGE } from '../config/constants';
import { Dice } from './Dice';
import { analyzeDodge, dodgeGrantsBonusAction } from './Dodge';
import { GameState } from './GameState';
import { Mage } from './Mage';
import { getSpell, setActiveSpellSets } from '../spells/registry';
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
    equal(dealDamage(ctx, victim, { amount: 50, type: 'shadow', damageClass: 'physical' }), 0, 'Damage is voided');
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
      damage: { amount: 5, type: 'corrosive', damageClass: 'physical' },
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
      damageClass: 'physical',
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
      damageClass: 'physical',
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
];

for (const [name, run] of tests) {
  await run();
  console.log(`PASS ${name}`);
}
console.log(`Combat rules: ${tests.length} checks passed.`);