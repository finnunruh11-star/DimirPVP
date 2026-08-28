import { applyDebuff, applyDot, applyInvisibility, applyStun, dealDamage } from '../effects/effects';
import { applyEnemyTraits } from '../pve/swamprun';
import { RANGE_UNIT } from '../config/constants';
import { FIELD, MELEE_RANGE } from '../config/constants';
import { Dice } from './Dice';
import { analyzeDodge, dodgeGrantsBonusAction } from './Dodge';
import { GameState, hazardDistance } from './GameState';
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
    const spell = getSpell(['bind', 'veil', 'corrode']);
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
    const spell = getSpell(['corrode', 'curse', 'pierce']);
    assert(spell, 'Expected Corrode Curse Pierce to be registered.');

    void spell.cast(game.effectContext(caster, foe, null));
    const wound = foe.statuses.find((s) => s.key === 'dot:suppurating-wound');
    assert(wound && wound.kind === 'dot', 'Expected the wound to be applied.');
    equal(wound.escalateSpecs, ['1d6', '1d8', '1d10'], 'It deepens to 1d10 and stops');
    equal(wound.duration, 3, 'It opens at three turns');

    // A heavy pierce hit always extends, but never past the three-turn ceiling.
    wound.duration = 1;
    dealDamage(game.effectContext(caster, foe, null), foe, { amount: 9, type: 'pierce', damageClass: 'physical' }, { canMiss: false });
    equal(wound.duration, 2, 'A hit of 6 or more always buys one turn');
    dealDamage(game.effectContext(caster, foe, null), foe, { amount: 9, type: 'pierce', damageClass: 'physical' }, { canMiss: false });
    equal(wound.duration, 3, 'It climbs to the ceiling');
    dealDamage(game.effectContext(caster, foe, null), foe, { amount: 9, type: 'pierce', damageClass: 'physical' }, { canMiss: false });
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
    const spell = getSpell(['veil', 'corrode', 'curse']);
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
    const spell = getSpell(['shatter', 'corrode', 'pierce']);
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
    dealDamage(game.effectContext(caster, conduit, null), conduit, { amount: 10, type: 'pierce', damageClass: 'physical' }, { canMiss: false });
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
];

for (const [name, run] of tests) {
  await run();
  console.log(`PASS ${name}`);
}
console.log(`Combat rules: ${tests.length} checks passed.`);