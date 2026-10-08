// =============================================================================
//  DEATH WAVE · CLASS SPELLS
// -----------------------------------------------------------------------------
//  Death is a god word and, beside Desecrate, the height of black. It only
//  joins black and colourless words, so its class spells are Death Shadow,
//  Death Pain and Death Shadow Pain. They do not merely hit harder: they bend
//  dying itself (the rites live in effects/deathKit.ts). Its minions are too
//  much to command: they pick their own prey among your enemies and grow on
//  the souls they take. The Shikigami rides your shoulder and spares no one.
// =============================================================================

import { bindMortalCoil, offerToShikigami, raiseFetch, shikigamiOffers } from '../../effects/deathKit';
import type { ClassSpellVariant } from '../registry';
import { imbue, law, minion, R, variants } from './classWave';

const GRAVE = 0x4a2a5a;
const DIRGE = 0x6b3a6b;
const NIGHT = 0x2a1f3a;

// =============================================================================
//  DEATH SHADOW · a shikigami fed on offerings, a coin for the ferryman, a holiday
// =============================================================================

const shikigami: ClassSpellVariant = {
  name: 'Shikigami',
  actionType: 'main',
  range: 0,
  targeting: 'self',
  dc: 14,
  noCrit: true,
  noCastSprite: true,
  description:
    'A Shikigami settles on your shoulder for the day. It has no health, cannot be targeted or harmed, and obeys no ' +
    'one. As you cast, offer it what you will: up to 12 maximum health for the day (1 point per 4), the use of your ' +
    'items for the day (2 points), and any of your minions (1 point each); cast again to offer more. At the start of ' +
    'your turns it acts by its points, each rank doing everything below it as well. 0-2: it executes a random unit, ' +
    'friend or foe, you included, for 3. 3-4: a random unit gains 1d3 Reap. 5-6: a random reaped unit gains half its ' +
    'Reap again (rounded up). 7-8: a unit felled by Reap or an execution passes three quarters of its Reap (rounded ' +
    'up) to the nearest of your enemies. 9 or more: it executes every enemy whose Reap reaches half its health. Reap ' +
    'fades between fights. While it rides with you, your party cannot enter towns. It leaves at the end of the day, ' +
    'giving back the health you offered.',
  visual: { preset: 'conjure', color: GRAVE, size: 26, speed: 1 },
  async cast(ctx) {
    const offers = shikigamiOffers(ctx.game, ctx.caster);
    const choice = (await ctx.requestOffering?.(offers)) ?? { life: 0, items: false, summons: [] };
    offerToShikigami(ctx.game, ctx.caster, choice);
  },
};

variants(
  ['death', 'shadow'],
  shikigami,
  imbue('ferrymansObol', {
    dc: 14,
    ally: true,
    color: GRAVE,
    text:
      'For the rest of the fight, every Reap the bearer marks is 1 higher. The first time the bearer would die, the ' +
      'Ferryman takes another soul instead: of the enemies with no more than 3 health per Reap they carry, the one ' +
      'with the most Reap dies in its place, wherever it stands, and the bearer is left standing with at least 1 ' +
      'health and 1 sanity, a shadow of its side opening beneath it. If no enemy is that close to death, the coin is ' +
      'lost and the bearer dies.',
  }),
  law('deathsHoliday', {
    dc: 15,
    color: GRAVE,
    text:
      'nobody dies. A unit that would die is left with at least 1 health and 1 sanity, and owes Death a life. A ' +
      'debtor whose blow would kill another unit pays its debt with that life. When the law ends, every unit that ' +
      'still owes dies at once.',
  })
);

// =============================================================================
//  DEATH PAIN · a requiem in five verses, a scythe for body and mind, the mortal coil
// =============================================================================

variants(
  ['death', 'pain'],
  minion('requiem', {
    dc: 14,
    untamed: true,
    color: DIRGE,
    text:
      'It cannot attack and is immune to sanity. At the start of your turns it drifts up to 4cm toward the nearest ' +
      'enemy, then sings the next verse of its Requiem to every enemy within 3cm of it: verse 1 deals 1d4 sanity, ' +
      'verse 2 2d4, verse 3 3d4 and verse 4 4d4, each with 1 Reap. Verse 5, the Lacrimosa, deals 4d4 sanity, and ' +
      'every enemy it leaves at half its sanity or less dies. Then the Requiem is over and the choir crumbles. Every ' +
      'unit its song kills joins the choir: its song carries 1cm further and every verse deals 1 more.',
  }),
  imbue('severingScythe', {
    dc: 14,
    color: DIRGE,
    text:
      'For the rest of the fight, your landed basic attacks mark the target with 1d6 Reap, then set its Dread to its ' +
      'Reap: as Reap takes the body at or below that much health, Dread takes the mind at or below that much sanity. ' +
      'When it kills, you wear the soul and regain sanity equal to its Reap. The mindless know no Dread.',
  }),
  law('mortalCoil', {
    dc: 15,
    color: DIRGE,
    text:
      "the body follows the mind: whenever a unit's sanity falls below its health, its health falls to match (the " +
      'mindless are spared). It binds everyone the moment it is laid.',
    after: (ctx) => bindMortalCoil(ctx.game, ctx.caster),
  })
);

// =============================================================================
//  DEATH SHADOW PAIN · a doomed double, a scythe that grows on kills, a world in grief
// =============================================================================

const fetch: ClassSpellVariant = {
  name: 'Fetch',
  actionType: 'main',
  range: R(8),
  targeting: 'enemy',
  dc: 15,
  noCrit: true,
  noCastSprite: true,
  manualCastVisual: true,
  description:
    'Raise the Fetch of one enemy within 8cm beside it: its shadow-double and the omen of its death, with half the ' +
    'health it has now (rounded up). The Fetch cannot attack, is immune to shadow and obeys no one. Every wound its ' +
    'original takes is dealt to the Fetch as well, and every other wound the Fetch takes is dealt to its original as ' +
    'sanity. At the start of your turns it walks up to 6cm toward its original and, within 3cm of it, stares: 1d4 ' +
    'sanity. When the Fetch dies, however it dies, its original sees its own death: at half its sanity or less it ' +
    'dies, otherwise it is executed for 6, and a shadow of yours opens beneath it. If its original dies first, the ' +
    'Fetch moves on to the nearest enemy, with half its health, and its stare deals 1d4 more for every original it ' +
    'has outlived.',
  visual: { preset: 'conjure', color: NIGHT, size: 26, speed: 1 },
  cast(ctx) {
    raiseFetch(ctx);
  },
};

variants(
  ['death', 'shadow', 'pain'],
  fetch,
  imbue('longShadow', {
    dc: 15,
    color: NIGHT,
    text:
      'For the rest of the fight, each of your landed basic attacks also cuts every other enemy standing in a shadow ' +
      'within 3cm of the target, for 1d4 sanity. The scythe grows on kills: every unit the blow or its shadow kills ' +
      'leaves a shadow of yours where it fell and feeds it a soul, and every soul makes its shadow reach 3cm further ' +
      'and cut 1 sanity deeper; from the second soul each cut also marks 1 Reap per two souls.',
  }),
  law('greatMourning', {
    dc: 15,
    color: NIGHT,
    text:
      "every death is mourned. Whenever a unit dies, every other unit on its side takes sanity equal to a quarter of " +
      "the dead's maximum health (rounded up) and every unit on the other sides takes 1d4 sanity; one left at half " +
      'its sanity or less also gains 1 Reap. Grief can kill, and those deaths are mourned in turn.',
  })
);
