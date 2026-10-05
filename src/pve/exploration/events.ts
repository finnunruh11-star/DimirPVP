// Roadside events: a short scene and a choice. Every event turns up as one of
// several variants, and the words of each are filled in as it is staged, so
// the same event rarely reads the same way twice. Every roll comes from the
// run's seeded dice for that step, so a reload replays the same outcome.

import type { Dice } from '../../core/Dice';
import type { ItemId } from '../../core/Items';
import { moneyLabel } from './economy';
import type { EncounterZone } from './encounters';
import {
  ALL_GEMS,
  ALL_HERBS,
  ambush,
  brawl,
  choice,
  countAny,
  gemOf,
  give,
  giveFrom,
  has,
  hasAny,
  herbOf,
  hp,
  mana,
  mapped,
  mend,
  oreOf,
  pay,
  POTIONS,
  purse,
  restore,
  sanity,
  stage,
  survey,
  takeAny,
  trial,
  walkOn,
  type EventChoice,
  type EventContext,
  type EventFight,
  type EventOutcome,
  type EventScene,
  type EventVariant,
  type RoadEvent,
} from './eventKit';

export type { EventChoice, EventContext, EventFight, EventOutcome, EventScene, EventVariant, RoadEvent } from './eventKit';

// ---- shared pieces --------------------------------------------------------------

const GEAR: readonly ItemId[] = ['copperRing', 'ironBand', 'leatherCap', 'leatherBoots'];

/** Where monsters of their own live, and so where a roadside event may call one out. */
const WILD_ZONES: EncounterZone[] = ['forest', 'red', 'wilds', 'black'];

// Nothing lives in the desert yet: the worm is a danger, not a fight.
const WORM: EventChoice[] = [
  trial('Stand perfectly still', 'dex', 12, 'Fail: -4 HP.',
    () => 'The ripple passes beneath your feet and fades.',
    (ctx) => `The sand heaves and throws you. ${hp(ctx, -4)} HP.`),
  trial('Run for the rocks', 'dex', 14, 'Fail: -4 HP.',
    () => 'You reach solid rock as the dune behind you collapses.',
    (ctx) => `The ground heaves and throws you. ${hp(ctx, -4)} HP.`),
  choice('Wait it out', '-2 sanity.', (ctx) => {
    sanity(ctx, -2);
    return 'It circles beneath you for an hour, then goes. -2 sanity.';
  }),
];

function searchCamp(ctx: EventContext): string | EventOutcome {
  const face = ctx.dice.die(20);
  if (face <= 5) return { message: `Rolled ${face}. The owners come back.`, fight: ambush(ctx, 'robbery') };
  if (face <= 15) return `Rolled ${face}. You find ${giveFrom(ctx, [herbOf(ctx), 'arrow', 'crudeTrinket'])}.`;
  return `Rolled ${face}. You find ${giveFrom(ctx, ['healthPotion', 'manaPotion', 'throwingDagger', gemOf(ctx)])}.`;
}

const SEARCH_CAMP = choice('Search it', 'd20: 1-5 ambush, 6-15 odds and ends, 16+ supplies.', searchCamp);

/** 50/50 between a good feeling and a bad one. */
const omen = (ctx: EventContext, good: string, bad: string): string => {
  if (ctx.dice.chance(0.5)) {
    sanity(ctx, 3);
    return `${good} +3 sanity.`;
  }
  sanity(ctx, -3);
  return `${bad} -3 sanity.`;
};

const comfort = (ctx: EventContext, message: string): string => {
  const healed = mend(ctx, 0.2);
  sanity(ctx, 2);
  return `${message} +${healed} HP, +2 sanity.`;
};

// ---- the events -------------------------------------------------------------------

export const ROAD_EVENTS: RoadEvent[] = [
  // ---- people on the road ----------------------------------------------------------
  {
    id: 'carter',
    title: 'STUCK CART',
    sighted: true,
    variants: [
      {
        text: 'A {who:carter|farmer|tinker|miller} is stuck to the axles in a rut{, cursing the ox| and close to tears|}.',
        choices: [
          trial('Heave it free', 'strength', 12, 'Pass: a meal, 20% HP. Fail: -2 HP.',
            (ctx) => `The cart rolls free and the {who} shares supper. +${mend(ctx, 0.2)} HP.`,
            (ctx) => `The cart slips back onto your foot. ${hp(ctx, -2)} HP.`),
          walkOn(),
        ],
      },
      {
        text: 'A {who:pedlar|farmer|priest|midwife} sits by a cart that has thrown a wheel. The pin is lost in the mud.',
        choices: [
          trial('Whittle a new pin', 'int', 12, 'Pass: a gift from the cart.',
            (ctx) => `The wheel holds. The {who} gives you ${giveFrom(ctx, [herbOf(ctx), 'arrow', 'throwingDagger'])}.`,
            () => 'The pin splits on the first turn. The {who} thanks you anyway.'),
          trial('Hold the cart up', 'strength', 13, 'Pass: 15% HP. Fail: -2 HP.',
            (ctx) => `The wheel goes back on and the {who} shares a flask. +${mend(ctx, 0.15)} HP.`,
            (ctx) => `Your back gives out before the cart does. ${hp(ctx, -2)} HP.`),
          walkOn(),
        ],
      },
      {
        text: "An ox has lain down in the road and will not get up. Its {who:drover|owner|carter} is at wit's end.",
        choices: [
          trial('Coax it up', 'int', 11, 'Pass: supper, 20% HP. Fail: -2 HP.',
            (ctx) => `It lumbers up at last and the {who} feeds you. +${mend(ctx, 0.2)} HP.`,
            (ctx) => `It kicks out as you lean in. ${hp(ctx, -2)} HP.`),
          trial('Shove it', 'strength', 15, 'Pass: a gift. Fail: -3 HP.',
            (ctx) => `The ox rolls to its feet, astonished. The {who} gives you ${giveFrom(ctx, GEAR)}.`,
            (ctx) => `The ox does not notice. You do. ${hp(ctx, -3)} HP.`),
          walkOn('You walk around the ox.', 'Walk around'),
        ],
      },
      {
        text: 'A cart lies on its side in the ditch. {Apples|Cabbages|Pots|Tools} are strewn across the road and nobody is about.',
        choices: [
          trial('Right the cart', 'strength', 13, 'Pass: a reward. Fail: -2 HP.',
            (ctx) => `The owner comes running and gives you ${giveFrom(ctx, ['healthPotion', 'throwingDagger', herbOf(ctx)])}.`,
            (ctx) => `It will not budge and your hands are raw. ${hp(ctx, -2)} HP.`),
          choice('Help yourself', 'Something from the cart. 40%: the owners see.', (ctx) => {
            const found = giveFrom(ctx, ['throwingDagger', 'arrow', 'crudeTrinket']);
            if (!ctx.dice.chance(0.4)) return `You take ${found}.`;
            return { message: `You take ${found}. The owners come back with cudgels.`, fight: ambush(ctx, 'robbery', 'The owners want it back.') };
          }),
          walkOn(),
        ],
      },
      {
        when: 'night',
        text: 'A lantern swings from a cart stuck fast in the mud. Someone curses in the dark.',
        choices: [
          trial('Lend a shoulder', 'strength', 12, 'Pass: 20% HP, +2 sanity. Fail: -2 HP.',
            (ctx) => comfort(ctx, 'The cart comes free and you share their fire a while.'),
            (ctx) => `You slip in the dark. ${hp(ctx, -2)} HP.`),
          walkOn('You leave them to the dark.'),
        ],
      },
      {
        zones: ['black', 'lake'],
        text: 'A {who:peat-cutter|reed-cutter|fisher} has sunk a cart to its axles in the marsh.',
        choices: [
          trial('Dig it out', 'strength', 13, 'Pass: 2 Deathweed. Fail: -2 HP & sanity.',
            (ctx) => `The marsh lets go with a sucking sound. The {who} gives you ${give(ctx, 'herbDeathweed', 2)}.`,
            (ctx) => {
              sanity(ctx, -2);
              return `Leeches, dozens of them. ${hp(ctx, -2)} HP, -2 sanity.`;
            }),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'shrine',
    title: 'ROADSIDE SHRINE',
    sighted: true,
    variants: [
      {
        text: 'A weathered shrine with a bowl of {copper|tin|bone} offerings.',
        choices: [
          choice('Pray', 'Restore 25% of max HP.', (ctx) => `You pray. +${mend(ctx, 0.25)} HP.`),
          choice('Take the offerings', 'A trinket. 50%: -3 sanity.', (ctx) => {
            const found = give(ctx, 'crudeTrinket');
            if (!ctx.dice.chance(0.5)) return `You take ${found}.`;
            sanity(ctx, -3);
            return `You take ${found}. Something watches you leave. -3 sanity.`;
          }),
          walkOn(),
        ],
      },
      {
        text: 'A shrine to {the Road Mother|a saint nobody remembers|the Lantern Saint}. Its candles are still warm.',
        choices: [
          choice('Kneel a while', '20% HP, +2 sanity.', (ctx) => comfort(ctx, 'The quiet does you good.')),
          choice('Look behind it', 'd20: 1-6 -2 sanity, else a find.', (ctx) => {
            const face = ctx.dice.die(20);
            if (face <= 6) {
              sanity(ctx, -2);
              return `Rolled ${face}. A nest of pale spiders. -2 sanity.`;
            }
            const pool: ItemId[] = face >= 18 ? ['healthPotion', 'manaPotion'] : [herbOf(ctx), 'throwingDagger', 'arrow'];
            return `Rolled ${face}. Someone hid ${giveFrom(ctx, pool)} here.`;
          }),
          walkOn(),
        ],
      },
      {
        text: 'Someone has smashed this shrine and daubed the stones with {tar|soot|something dark}.',
        choices: [
          trial('Set it right', 'strength', 11, 'Pass: +4 sanity. Fail: -1 HP.',
            (ctx) => {
              sanity(ctx, 4);
              return 'The stones stand again. You feel lighter. +4 sanity.';
            },
            (ctx) => `A stone slips and takes skin with it. ${hp(ctx, -1)} HP.`),
          trial('Read the daubing', 'int', 13, 'Pass: a Mana Potion. Fail: -3 sanity.',
            (ctx) => `A cipher, pointing under a loose stone: ${give(ctx, 'manaPotion')}.`,
            (ctx) => {
              sanity(ctx, -3);
              return 'The marks crawl when you look at them. -3 sanity.';
            }),
          walkOn(),
        ],
      },
      {
        text: 'An old {who:keeper|nun|monk} tends a shrine by the road and offers you a blessing.',
        choices: [
          choice('Accept the blessing', '20% HP, +2 sanity.', (ctx) => comfort(ctx, 'The {who} marks each brow with oil.')),
          choice(`Give ${moneyLabel(0.2)} to the shrine`, '+20% HP, mana, sanity and charges.', (ctx) => {
            pay(ctx, 0.2);
            restore(ctx, 0.2);
            return 'The {who} prays over each of you in turn. +20% HP, mana, sanity and charges.';
          }, purse(0.2)),
          walkOn(),
        ],
      },
      {
        when: 'night',
        text: 'Votive lights flicker in a roadside shrine. Nobody tends them.',
        choices: [
          choice('Keep vigil', '+3 sanity, 25% mana.', (ctx) => {
            sanity(ctx, 3);
            return `The little lights steady you. +3 sanity, +${mana(ctx, 0.25)} mana.`;
          }),
          choice('Take a votive', 'A trinket. 50%: -3 sanity.', (ctx) => {
            const found = give(ctx, 'crudeTrinket');
            if (!ctx.dice.chance(0.5)) return `You take ${found}. The other lights gutter.`;
            sanity(ctx, -3);
            return `You take ${found}. Every light goes out at once. -3 sanity.`;
          }),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'wounded',
    title: 'WOUNDED TRAVELLER',
    sighted: true,
    variants: [
      {
        text: 'A {who:pedlar|pilgrim|shepherd|courier} sits against a milestone, bleeding.',
        choices: [
          choice('Give a Health Potion', 'Costs one Health Potion. A piece of their kit.', (ctx) => {
            takeAny(ctx, ['healthPotion']);
            return `The {who} recovers and presses ${giveFrom(ctx, GEAR)} on you.`;
          }, has('healthPotion')),
          trial('Bind the wound', 'int', 12, 'Pass: +3 sanity. Fail: -1 sanity.',
            (ctx) => {
              sanity(ctx, 3);
              return 'The bleeding stops. The {who} will live. +3 sanity.';
            },
            (ctx) => {
              sanity(ctx, -1);
              return 'You do what you can. The {who} limps off, grey. -1 sanity.';
            }),
          walkOn(),
        ],
      },
      {
        text: 'A young {who:soldier|guard|archer} lies in the grass with an arrow in the shoulder.',
        choices: [
          choice('Give a Health Potion', 'Costs one Health Potion. Their arrows.', (ctx) => {
            takeAny(ctx, ['healthPotion']);
            return `The {who} gets up, pale but grinning, and gives you ${give(ctx, 'arrow', 4 + ctx.dice.die(4))}.`;
          }, has('healthPotion')),
          trial('Pull the arrow', 'dex', 12, 'Pass: +3 sanity, a dagger. Fail: -2 sanity.',
            (ctx) => {
              sanity(ctx, 3);
              return `Clean out. The {who} gives you ${give(ctx, 'throwingDagger')}. +3 sanity.`;
            },
            (ctx) => {
              sanity(ctx, -2);
              return 'The head snaps off inside. The screaming stays with you. -2 sanity.';
            }),
          walkOn(),
        ],
      },
      {
        zones: ['forest', 'black', 'capitol', 'lake'],
        text: 'A {who:woodcutter|trapper|charcoal burner} drags a bitten leg down the road. {Wolf|Boar|Dog} bite, by the look of it.',
        choices: [
          choice('Give a Health Potion', 'Costs one Health Potion. A pelt.', (ctx) => {
            takeAny(ctx, ['healthPotion']);
            return `The {who} can walk again, and gives you ${giveFrom(ctx, ['wolfPelt', 'boarHide', 'rabbitPelt'])}.`;
          }, has('healthPotion')),
          trial('Clean the bite', 'int', 11, 'Pass: +2 sanity, herbs. Fail: -1 HP.',
            (ctx) => {
              sanity(ctx, 2);
              return `It will heal clean. The {who} gives you ${give(ctx, herbOf(ctx), 2)}. +2 sanity.`;
            },
            (ctx) => `The {who} lashes out in pain. ${hp(ctx, -1)} HP.`),
          walkOn(),
        ],
      },
      {
        text: 'A traveller has stepped in an old {gin trap|bear trap|snare} and cannot pull free.',
        choices: [
          trial('Pry it open', 'strength', 13, 'Pass: a gift. Fail: -3 HP.',
            (ctx) => `The jaws open. The traveller gives you ${giveFrom(ctx, [...GEAR, 'healthPotion'])}.`,
            (ctx) => `The jaws snap back on your fingers. ${hp(ctx, -3)} HP.`),
          trial('Pick the spring', 'dex', 14, 'Pass: a gift. Fail: -2 HP.',
            (ctx) => `The spring pops loose. The traveller gives you ${giveFrom(ctx, ['throwingDagger', 'arrow', 'manaPotion'])}.`,
            (ctx) => `The spring bites back. ${hp(ctx, -2)} HP.`),
          walkOn(),
        ],
      },
      {
        text: 'A {who:merchant|farmer|clerk} sits in the road, robbed and beaten. The robbers left tracks into the {trees|hills|reeds}.',
        choices: [
          choice('Go after the robbers', 'Fight them.', (ctx) => ({
            message: 'You follow the tracks to their camp.',
            fight: ambush(ctx, 'robbery', 'The robbers turn to face you.'),
          })),
          choice('Share a Health Potion', 'Costs one Health Potion. +4 sanity.', (ctx) => {
            takeAny(ctx, ['healthPotion']);
            sanity(ctx, 4);
            return 'The {who} weeps with thanks. +4 sanity.';
          }, has('healthPotion')),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'toll',
    title: 'TOLL BARRICADE',
    variants: [
      {
        zones: ['capitol', 'red', 'lake'],
        text: 'Armed men have strung a chain across the road.',
        choices: [
          choice(`Pay ${moneyLabel(1)}`, 'Pass without trouble.', (ctx) => {
            pay(ctx, 1);
            return 'You pay. The chain drops.';
          }, purse(1)),
          trial('Slip around', 'dex', 13, 'Fail: a fight.',
            () => 'You pass unseen.',
            (ctx) => ({ message: 'They spot you.', fight: ambush(ctx, 'robbery') })),
          choice('Refuse', 'Fight the toll-men.', (ctx) => ({ message: 'You refuse.', fight: brawl(ctx, 'The toll-men draw steel.', ['bandit', 'bandit']) })),
        ],
      },
      {
        zones: ['capitol', 'lake', 'forest'],
        text: 'The {bridge|ford|crossing} is held by {a toll-keeper and two bruisers|three men in mismatched mail}.',
        choices: [
          choice(`Pay ${moneyLabel(0.5)}`, 'Cross in peace.', (ctx) => {
            pay(ctx, 0.5);
            return 'They let you over.';
          }, purse(0.5)),
          trial('Talk your way over', 'int', 14, 'Fail: a fight.',
            () => 'You name a magistrate they fear. They let you over.',
            (ctx) => ({ message: 'They laugh, then stop laughing.', fight: ambush(ctx, 'robbery') })),
          choice('Force it', 'Fight them.', (ctx) => ({ message: 'You force the crossing.', fight: brawl(ctx, 'The bruisers wade in.', ['bandit', 'bandit-archer']) })),
        ],
      },
      {
        zones: ['capitol'],
        title: 'CHECKPOINT',
        text: '{Capitol|Ducal|Temple} soldiers are searching travellers at a post across the road.',
        choices: [
          choice('Submit to the search', 'd6: 1-2 they seize a potion.', (ctx) => {
            const face = ctx.dice.die(6);
            if (face > 2) return `Rolled ${face}. They find nothing they want and wave you on.`;
            const seized = takeAny(ctx, POTIONS);
            return seized ? `Rolled ${face}. "Contraband." They keep a ${seized}.` : `Rolled ${face}. They find nothing worth taking.`;
          }),
          choice(`Bribe the sergeant (${moneyLabel(0.5)})`, 'Waved through.', (ctx) => {
            pay(ctx, 0.5);
            return 'The coin vanishes. So does the sergeant.';
          }, purse(0.5)),
          trial('Slip past', 'dex', 13, 'Fail: they seize a potion.',
            () => 'You are past before anyone looks up.',
            (ctx) => {
              const seized = takeAny(ctx, POTIONS);
              return seized ? `Caught. They keep a ${seized} for your trouble.` : 'Caught, searched and let go.';
            }),
        ],
      },
      {
        zones: ['red', 'wilds'],
        title: 'KOBOLD TOLL',
        text: 'Kobolds have piled rocks across the path. The biggest one demands "shiny, shiny!"',
        choices: [
          choice('Hand over a gem', 'Costs one gem. Safe passage.', (ctx) => {
            const gem = takeAny(ctx, ALL_GEMS);
            return `They squabble over the ${gem ?? 'gem'} and wave you through.`;
          }, hasAny(ALL_GEMS)),
          trial('Scare them off', 'strength', 12, 'Fail: a fight.',
            () => 'You roar. They scatter into the rocks, squealing.',
            (ctx) => ({ message: 'They do not scare.', fight: brawl(ctx, 'The kobolds charge.', ['kobold', 'kobold', 'kobold']) })),
          choice('Kick the pile over', 'Fight the kobolds.', (ctx) => ({
            message: 'Rocks everywhere.',
            fight: brawl(ctx, 'The kobolds charge.', ['kobold', 'kobold', 'elite-kobold']),
          })),
        ],
      },
      {
        zones: ['white'],
        title: 'NOMAD RIDERS',
        text: 'Riders in white veils bar the way and ask for water.',
        choices: [
          choice('Share your water', '-2 HP. They ride off.', (ctx) => `They drink, touch their hearts and ride off. ${hp(ctx, -2)} HP.`),
          trial('Outrun them', 'dex', 14, 'Fail: -4 HP.',
            () => 'You reach broken ground where horses cannot follow.',
            (ctx) => `They herd you like goats until they tire of it. ${hp(ctx, -4)} HP.`),
          choice('Refuse', 'They take it by force.', (ctx) => ({ message: 'Their blades come out.', fight: ambush(ctx, 'robbery', 'The riders circle.') })),
        ],
      },
    ],
  },
  {
    id: 'camp',
    title: 'ABANDONED CAMP',
    sighted: true,
    variants: [
      {
        text: 'A cold fire and a torn tent beside the road.',
        choices: [SEARCH_CAMP, walkOn()],
      },
      {
        text: 'A campfire still smoulders. {Bedrolls|Packs|A cooking pot} left in a hurry.',
        choices: [
          SEARCH_CAMP,
          choice('Wait for the owners', '50%: travellers share supper. 50%: bandits.', (ctx) => {
            if (ctx.dice.chance(0.5)) return `Travellers, glad of company. They share supper. +${mend(ctx, 0.2)} HP.`;
            return { message: 'The owners are not glad of company.', fight: ambush(ctx, 'robbery') };
          }),
          walkOn(),
        ],
      },
      {
        zones: WILD_ZONES,
        text: 'A trampled fire, a slashed tent and dark stains on the grass. Drag marks lead away.',
        choices: [
          trial('Search the wreckage', 'int', 12, 'Pass: supplies. Fail: -2 sanity.',
            (ctx) => `Under the tent: ${giveFrom(ctx, ['healthPotion', 'manaPotion', 'throwingDagger'])}.`,
            (ctx) => {
              sanity(ctx, -2);
              return 'You find what was dragged. -2 sanity.';
            }),
          choice('Follow the drag marks', 'A fight, one depth deeper.', (ctx) => ({
            message: 'Whatever did this is still close.',
            fight: ambush(ctx, 'monsters', 'It is still feeding.', 1),
          })),
          walkOn(),
        ],
      },
      {
        text: "A hunters' camp: {pelts|antlers|snares} hung on poles, a fire laid but unlit, no hunters.",
        choices: [
          choice('Take a pelt', 'A pelt. 35%: the hunters return.', (ctx) => {
            const pelt = giveFrom(ctx, ['rabbitPelt', 'wolfPelt', 'boarHide']);
            if (!ctx.dice.chance(0.35)) return `You take ${pelt}.`;
            return { message: `You take ${pelt}. The hunters come back and see.`, fight: ambush(ctx, 'robbery', 'The hunters want it back.') };
          }),
          choice('Rest by their fire', '+15% HP, mana, sanity and charges.', (ctx) => {
            restore(ctx, 0.15);
            return 'You light the fire and rest a while. +15% HP, mana, sanity and charges.';
          }),
          walkOn(),
        ],
      },
      {
        when: 'night',
        text: 'Embers glow in a camp off the road. Someone snores in a bedroll{, a sword across their knees|}.',
        choices: [
          trial('Sneak in and search', 'dex', 13, 'Pass: a find. Fail: a fight.',
            (ctx) => `Nobody stirs. You leave with ${giveFrom(ctx, ['healthPotion', 'throwingDagger', 'arrow', gemOf(ctx)])}.`,
            (ctx) => ({ message: 'The sleeper wakes, and so do the others.', fight: ambush(ctx, 'robbery') })),
          choice('Wake them and share the fire', '15% HP, +2 sanity.', (ctx) => {
            const healed = mend(ctx, 0.15);
            sanity(ctx, 2);
            return `Honest folk, glad of the company. +${healed} HP, +2 sanity.`;
          }),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'caravan',
    title: 'MERCHANT CARAVAN',
    sighted: true,
    variants: [
      {
        text: 'A caravan rests at the roadside{, mules grazing| while the drivers eat|}.',
        choices: [
          choice(`Buy a Health Potion (${moneyLabel(3)})`, 'Cheaper than town.', (ctx) => {
            pay(ctx, 3);
            return `You buy ${give(ctx, 'healthPotion')}.`;
          }, purse(3)),
          choice('Guard the caravan', 'A Health Potion now, then a fight one depth deeper.', (ctx) => ({
            message: `The merchant pays in kind: ${give(ctx, 'healthPotion')}. Raiders arrive at dusk.`,
            fight: ambush(ctx, 'robbery', 'Raiders fall on the caravan.', 1),
          })),
          walkOn(),
        ],
      },
      {
        zones: ['white', 'red', 'wilds', 'capitol'],
        text: 'A spice caravan has made camp. {Camels|Mules} doze under their packs and the air smells of pepper.',
        choices: [
          choice(`Buy a spiced supper (${moneyLabel(0.5)})`, '+25% HP.', (ctx) => {
            pay(ctx, 0.5);
            return `Hot enough to make you weep. +${mend(ctx, 0.25)} HP.`;
          }, purse(0.5)),
          choice('Trade a gem for potions', 'Costs one gem. A Health and a Mana Potion.', (ctx) => {
            const gem = takeAny(ctx, ALL_GEMS);
            return `The master weighs the ${gem ?? 'gem'} and nods: ${give(ctx, 'healthPotion')} and ${give(ctx, 'manaPotion')}.`;
          }, hasAny(ALL_GEMS)),
          walkOn(),
        ],
      },
      {
        text: "A caravan's lead wagon has broken an axle. The caravan master offers a reward for help.",
        choices: [
          trial('Mend the axle', 'int', 13, 'Pass: a Mana Potion. Fail: -1 HP.',
            (ctx) => `It holds. The master gives you ${give(ctx, 'manaPotion')}.`,
            (ctx) => `A splinter the length of a finger. ${hp(ctx, -1)} HP.`),
          trial('Take the weight', 'strength', 13, 'Pass: a Health Potion. Fail: -2 HP.',
            (ctx) => `The new axle goes in. The master gives you ${give(ctx, 'healthPotion')}.`,
            (ctx) => `The wagon wins. ${hp(ctx, -2)} HP.`),
          walkOn(),
        ],
      },
      {
        text: 'Smoke rises from a looted caravan. {Two guards|A few drivers} still hold the last wagon against raiders.',
        choices: [
          choice('Help them', 'A Health Potion, then a fight.', (ctx) => ({
            message: `A guard throws you ${give(ctx, 'healthPotion')}. "Help us!"`,
            fight: ambush(ctx, 'robbery', 'You fall on the raiders from behind.'),
          })),
          walkOn('You leave them to it.'),
        ],
      },
      {
        when: 'night',
        text: 'Lanterns hang round a ring of wagons. The guards call you over to their fire.',
        choices: [
          choice('Sit with them', '15% HP, +2 sanity.', (ctx) => {
            const healed = mend(ctx, 0.15);
            sanity(ctx, 2);
            return `Stew, songs and bad jokes. +${healed} HP, +2 sanity.`;
          }),
          choice(`Buy a Mana Potion (${moneyLabel(2.5)})`, 'Cheaper than town.', (ctx) => {
            pay(ctx, 2.5);
            return `You buy ${give(ctx, 'manaPotion')}.`;
          }, purse(2.5)),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'pedlar',
    title: 'TRAVELLING PEDLAR',
    sighted: true,
    variants: [
      {
        text: 'A pedlar with a {mule|handcart|pack as big as a barrel} hails you. "Something for the road?"',
        choices: [
          choice(`Buy a Health Potion (${moneyLabel(4)})`, 'A little under town price.', (ctx) => {
            pay(ctx, 4);
            return `You buy ${give(ctx, 'healthPotion')}.`;
          }, purse(4)),
          choice(`Buy arrows (${moneyLabel(1)})`, 'Four arrows.', (ctx) => {
            pay(ctx, 1);
            return `You buy ${give(ctx, 'arrow', 4)}.`;
          }, purse(1)),
          choice(`Buy a Throwing Dagger (${moneyLabel(1)})`, 'Half the town price.', (ctx) => {
            pay(ctx, 1);
            return `You buy ${give(ctx, 'throwingDagger')}.`;
          }, purse(1)),
          walkOn(),
        ],
      },
      {
        text: 'A pedlar in a good coat offers a "{genuine elven|royal|blessed}" ring for five silver.',
        choices: [
          choice(`Buy it (${moneyLabel(0.5)})`, 'd6: 1-3 junk, 4-5 Copper Ring, 6 Iron Band.', (ctx) => {
            pay(ctx, 0.5);
            const face = ctx.dice.die(6);
            if (face <= 3) {
              sanity(ctx, -1);
              return `Rolled ${face}. It turns your finger green: ${give(ctx, 'crudeTrinket')}. -1 sanity.`;
            }
            return `Rolled ${face}. It is real: ${give(ctx, face === 6 ? 'ironBand' : 'copperRing')}.`;
          }, purse(0.5)),
          trial('Haggle', 'int', 13, `Pass: the real ring for ${moneyLabel(0.2)}.`,
            (ctx) => {
              pay(ctx, 0.2);
              return `He sighs and fetches the real one from his boot: ${give(ctx, 'copperRing')}.`;
            },
            () => 'He takes offence and leaves in a huff.', purse(0.2)),
          walkOn(),
        ],
      },
      {
        text: 'A {who:rag-and-bone man|tinker|scrap dealer} offers to swap useful things for junk.',
        choices: [
          choice('Swap a Crude Trinket', 'Costs one Crude Trinket. A Throwing Dagger.', (ctx) => {
            takeAny(ctx, ['crudeTrinket']);
            return `The {who} holds it to the light and hands over ${give(ctx, 'throwingDagger')}.`;
          }, has('crudeTrinket')),
          choice('Swap three herbs', 'Costs three herbs. A Mana Potion.', (ctx) => {
            for (let i = 0; i < 3; i++) takeAny(ctx, ALL_HERBS);
            return `"Good for soup." The {who} gives you ${give(ctx, 'manaPotion')}.`;
          }, (ctx) => countAny(ctx, ALL_HERBS) >= 3),
          walkOn(),
        ],
      },
      {
        text: 'A pedlar waves you over to a cart piled high with sacks. "Best prices on the road!"',
        choices: [
          trial('Look over the goods', 'int', 12, 'Pass: something cheap. Fail: an ambush.',
            (ctx) => `You spot swords under the sacks. The "pedlar" flees and leaves ${giveFrom(ctx, ['healthPotion', 'throwingDagger', 'arrow'])}.`,
            (ctx) => ({ message: 'The sacks throw off their covers.', fight: ambush(ctx, 'robbery', 'The pedlar was bait.') })),
          walkOn(),
        ],
      },
      {
        when: 'night',
        text: "A pedlar's lantern bobs toward you out of the dark. They are glad of the company.",
        choices: [
          choice('Walk together a while', '+3 sanity.', (ctx) => {
            sanity(ctx, 3);
            return 'Stories and gossip for a mile or two. +3 sanity.';
          }),
          choice(`Buy a Mana Potion (${moneyLabel(3)})`, 'Cheaper than town.', (ctx) => {
            pay(ctx, 3);
            return `You buy ${give(ctx, 'manaPotion')}.`;
          }, purse(3)),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'highwaymen',
    title: 'HIGHWAYMEN',
    variants: [
      {
        text: 'Masked riders block the road. "Your purse or your blood."',
        choices: [
          choice('Hand over the purse', 'Lose half your coin.', (ctx) => {
            const half = Math.floor(ctx.run.gold * 5 + 1e-6) / 10;
            if (half <= 0) return 'They laugh at your empty purse and ride off.';
            pay(ctx, half);
            return `They take ${moneyLabel(half)} and ride off laughing.`;
          }),
          choice('Fight', 'Robbers.', (ctx) => ({ message: 'You choose blood.', fight: ambush(ctx, 'robbery', 'The riders draw.') })),
          trial('Bluff', 'int', 14, 'Fail: a harder fight.',
            () => 'You swear a patrol is right behind you. They believe it and ride off.',
            (ctx) => ({ message: 'They do not believe you.', fight: ambush(ctx, 'robbery', 'The riders draw.', 1) })),
        ],
      },
      {
        text: 'An arrow thuds into the road at your feet. A voice from the {trees|rocks|ditch} names a price.',
        choices: [
          choice(`Pay ${moneyLabel(0.5)}`, 'They let you pass.', (ctx) => {
            pay(ctx, 0.5);
            return 'You leave the coin on a stone. Nobody shoots.';
          }, purse(0.5)),
          choice('Charge them', 'Robbers.', (ctx) => ({ message: 'You charge the voice.', fight: ambush(ctx, 'robbery', 'Archers in cover.') })),
          trial('Run for it', 'dex', 13, 'Fail: -3 HP.',
            () => 'You are out of range before they nock again.',
            (ctx) => `An arrow finds you as you run. ${hp(ctx, -3)} HP.`),
        ],
      },
      {
        text: 'A beggar limps up to ask for alms. Behind you, two men step out of the {hedge|ditch|reeds}.',
        choices: [
          choice(`Pay them off (${moneyLabel(0.3)})`, 'They let you go.', (ctx) => {
            pay(ctx, 0.3);
            return 'They count it twice and let you go.';
          }, purse(0.3)),
          trial('Shove past', 'strength', 13, 'Fail: a fight.',
            () => 'You knock the beggar flat and are gone.',
            (ctx) => ({ message: 'They grab you.', fight: ambush(ctx, 'robbery') })),
          choice('Fight', 'Robbers.', (ctx) => ({ message: 'You turn on them.', fight: ambush(ctx, 'robbery', 'The beggar draws a knife too.') })),
        ],
      },
      {
        when: 'night',
        text: 'A whistle in the dark, then another answering it. You are being surrounded.',
        choices: [
          trial('Douse the light and slip away', 'dex', 13, 'Fail: a fight.',
            () => 'You slip between them in the dark.',
            (ctx) => ({ message: 'A lantern flares right in front of you.', fight: ambush(ctx, 'robbery', 'Shapes close in.') })),
          trial('Shout for the watch', 'int', 13, 'Fail: a harder fight.',
            () => 'They believe the watch is near and melt away.',
            (ctx) => ({ message: 'Nobody comes. They laugh.', fight: ambush(ctx, 'robbery', 'Shapes close in.', 1) })),
          choice('Back to back', 'A fight.', (ctx) => ({ message: 'You wait for them.', fight: ambush(ctx, 'robbery', 'Shapes close in.') })),
        ],
      },
    ],
  },
  {
    id: 'lost',
    title: 'LOST ON THE ROAD',
    variants: [
      {
        text: 'A {who:boy|girl} sits crying by a milestone, lost on the way to market.',
        choices: [
          trial('Take them home', 'int', 11, 'Pass: +20% HP, mana, sanity, charges.',
            (ctx) => {
              restore(ctx, 0.2);
              return 'The family feeds you like heroes. +20% HP, mana, sanity and charges.';
            },
            (ctx) => `You get there by way of every wrong turn. They give you bread. +${mend(ctx, 0.1)} HP.`),
          choice('Point the way', '+1 sanity.', (ctx) => {
            sanity(ctx, 1);
            return 'The {who} trots off, sniffing. +1 sanity.';
          }),
          walkOn(),
        ],
      },
      {
        text: 'An old man in a nightshirt wanders the road, asking everyone for his wife.',
        choices: [
          choice('Walk him home', 'A gift from his family. +2 sanity.', (ctx) => {
            sanity(ctx, 2);
            return `His daughter nearly faints with relief and gives you ${giveFrom(ctx, ['healthPotion', herbOf(ctx)])}. +2 sanity.`;
          }),
          walkOn(),
        ],
      },
      {
        text: 'A {shaggy|three-legged|muddy} dog trots up and will not stop following you.',
        choices: [
          choice('Feed it', 'd6: 1-4 it digs something up, 5-6 it runs off.', (ctx) => {
            const face = ctx.dice.die(6);
            if (face >= 5) return `Rolled ${face}. It wolfs the food and runs off.`;
            return `Rolled ${face}. It follows you a mile, then digs up ${giveFrom(ctx, [herbOf(ctx), 'arrow', 'crudeTrinket', 'throwingDagger'])}.`;
          }),
          choice('Shoo it away', '-1 sanity.', (ctx) => {
            sanity(ctx, -1);
            return 'It looks back at you twice. -1 sanity.';
          }),
        ],
      },
      {
        text: 'A lost {scout|surveyor|courier} asks the way to {Oakhaven|Pennybruck|the Capitol|Thassa}.',
        choices: [
          trial('Compare maps', 'int', 10, 'Pass: the land around mapped.',
            (ctx) => `Their notes fill the gaps in yours. ${mapped(survey(ctx, 6))}`,
            () => 'Their map is worse than yours.'),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'beggar',
    title: 'BY THE ROADSIDE',
    variants: [
      {
        title: 'OLD SOLDIER',
        text: 'An old soldier with one arm begs by the road, medals pinned to his rags.',
        choices: [
          choice(`Give ${moneyLabel(0.2)}`, '+3 sanity.', (ctx) => {
            pay(ctx, 0.2);
            sanity(ctx, 3);
            return 'He salutes you with his one hand. +3 sanity.';
          }, purse(0.2)),
          choice('Give a Health Potion', 'Costs one Health Potion. His old kit.', (ctx) => {
            takeAny(ctx, ['healthPotion']);
            return `He gives you ${giveFrom(ctx, ['ironBand', 'leatherCap', 'throwingDagger'])}. "Better on you than in a pawnshop."`;
          }, has('healthPotion')),
          walkOn(),
        ],
      },
      {
        title: 'HUNGRY FAMILY',
        text: 'A family sits by a cold hearth outside a burnt cottage. The children have not eaten.',
        choices: [
          choice('Give them a herb', 'Costs one herb. +4 sanity.', (ctx) => {
            takeAny(ctx, ALL_HERBS);
            sanity(ctx, 4);
            return 'Soup, of a sort. The children eat. +4 sanity.';
          }, hasAny(ALL_HERBS)),
          choice(`Give ${moneyLabel(0.3)}`, '+4 sanity.', (ctx) => {
            pay(ctx, 0.3);
            sanity(ctx, 4);
            return 'The mother presses your hand and says nothing. +4 sanity.';
          }, purse(0.3)),
          walkOn(),
        ],
      },
      {
        title: 'MINSTREL',
        text: 'A minstrel plays by the road with a hat at their feet. The song is {sad|bawdy|about you, somehow}.',
        choices: [
          choice(`Toss ${moneyLabel(0.1)} in the hat`, '+2 sanity, 10% mana.', (ctx) => {
            pay(ctx, 0.1);
            sanity(ctx, 2);
            return `They play one just for you. +2 sanity, +${mana(ctx, 0.1)} mana.`;
          }, purse(0.1)),
          choice('Sing along', '50%: +3 sanity. 50%: -3 sanity.', (ctx) =>
            omen(ctx, 'You are in fine voice.', 'You are not in fine voice. Everyone says so.')),
          walkOn(),
        ],
      },
      {
        when: 'night',
        title: 'BEGGAR AT A FIRE',
        text: 'A beggar huddles over a tiny fire and offers to share it.',
        choices: [
          choice('Sit down', '10% HP, +2 sanity.', (ctx) => {
            const healed = mend(ctx, 0.1);
            sanity(ctx, 2);
            return `Small fire, good talk. +${healed} HP, +2 sanity.`;
          }),
          choice(`Leave ${moneyLabel(0.2)}`, '+3 sanity. He tells you the paths.', (ctx) => {
            pay(ctx, 0.2);
            sanity(ctx, 3);
            return `He tells you of paths nobody uses. ${mapped(survey(ctx, 4))} +3 sanity.`;
          }, purse(0.2)),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'stranger',
    title: 'A STRANGE OFFER',
    variants: [
      {
        title: 'FORTUNE TELLER',
        text: 'A blind woman at a crossroads offers to read your fortune for a silver.',
        choices: [
          choice(`Pay ${moneyLabel(0.1)}`, 'd6: 1-2 -3 sanity, 3-4 +3 sanity, 5-6 30% mana.', (ctx) => {
            pay(ctx, 0.1);
            const face = ctx.dice.die(6);
            if (face <= 2) {
              sanity(ctx, -3);
              return `Rolled ${face}. She stops halfway and will not go on. -3 sanity.`;
            }
            if (face <= 4) {
              sanity(ctx, 3);
              return `Rolled ${face}. Long life, she says, and means it. +3 sanity.`;
            }
            return `Rolled ${face}. She presses her thumb to your brow. +${mana(ctx, 0.3)} mana.`;
          }, purse(0.1)),
          walkOn(),
        ],
      },
      {
        title: 'ALCHEMIST',
        text: 'A travelling alchemist wants a volunteer to test a {green|smoking|glowing} tonic.',
        choices: [
          choice('Drink it', 'd6: 1 -3 HP, 2 -3 sanity, 3-4 30% mana, 5-6 20% all.', (ctx) => {
            const face = ctx.dice.die(6);
            if (face === 1) return `Rolled ${face}. It comes back up. ${hp(ctx, -3)} HP.`;
            if (face === 2) {
              sanity(ctx, -3);
              return `Rolled ${face}. The colours get very loud. -3 sanity.`;
            }
            if (face <= 4) return `Rolled ${face}. Sparks behind the eyes. +${mana(ctx, 0.3)} mana.`;
            restore(ctx, 0.2);
            return `Rolled ${face}. It works! +20% HP, mana, sanity and charges.`;
          }),
          choice('Trade three herbs', 'Costs three herbs. A Health Potion.', (ctx) => {
            for (let i = 0; i < 3; i++) takeAny(ctx, ALL_HERBS);
            return `The alchemist boils them down into ${give(ctx, 'healthPotion')}.`;
          }, (ctx) => countAny(ctx, ALL_HERBS) >= 3),
          walkOn(),
        ],
      },
      {
        title: 'THE STRANGER',
        when: 'night',
        text: 'A tall stranger waits at the crossroads. "Power, friend? It only costs a little of yourself."',
        choices: [
          choice('Accept', 'Full mana. -4 sanity.', (ctx) => {
            const got = mana(ctx, 1);
            sanity(ctx, -4);
            return `Cold fire fills you. +${got} mana, -4 sanity.`;
          }),
          choice('Refuse', '+1 sanity.', (ctx) => {
            sanity(ctx, 1);
            return 'When you look back the crossroads is empty. +1 sanity.';
          }),
        ],
      },
      {
        title: 'HOODED BUYER',
        text: 'A hooded figure offers a Mana Potion for "something that bleeds". They mean you.',
        choices: [
          choice('Give blood', '-4 HP. A Mana Potion.', (ctx) => {
            const lost = hp(ctx, -4);
            return `You bleed into a bowl. They give you ${give(ctx, 'manaPotion')}. ${lost} HP.`;
          }),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'tracks',
    title: 'FRESH TRACKS',
    variants: [
      {
        zones: WILD_ZONES,
        text: 'Fresh {prints|tracks|scuffs} cross the road and vanish into the {brush|rocks|reeds}. Something big.',
        choices: [
          choice('Follow them', 'Its lair holds a find, and it comes home.', (ctx) => ({
            message: `In its lair: ${giveFrom(ctx, [gemOf(ctx), 'throwingDagger', herbOf(ctx)])}. Then it comes home.`,
            fight: ambush(ctx, 'monsters', 'It comes home.'),
          })),
          trial('Cover your own tracks', 'int', 11, 'Fail: it finds you.',
            () => 'Whatever it is, it does not find you.',
            (ctx) => ({ message: 'It was already following you.', fight: ambush(ctx, 'monsters') })),
          choice('Walk on', '30%: it follows.', (ctx) =>
            ctx.dice.chance(0.3) ? { message: 'It was following you.', fight: ambush(ctx, 'monsters') } : 'You walk on. Nothing follows.'),
        ],
      },
      {
        zones: WILD_ZONES,
        text: 'A blood trail crosses the road. Something wounded went this way.',
        choices: [
          choice('Follow the blood', 'd20: 1-10 a wounded beast, 11+ its victim.', (ctx) => {
            const face = ctx.dice.die(20);
            if (face <= 10) return { message: `Rolled ${face}. It is wounded, and angry.`, fight: ambush(ctx, 'monsters', 'It turns at bay.') };
            return `Rolled ${face}. A dead hunter, and by the body ${giveFrom(ctx, ['travellersDagger', 'arrow', 'healthPotion'])}.`;
          }),
          walkOn(),
        ],
      },
      {
        text: "Chalk marks on a milestone: robbers' signs. This road is watched.",
        choices: [
          trial('Take the back ways', 'int', 11, 'Fail: robbers.',
            () => 'You leave the road and rejoin it a mile on.',
            (ctx) => ({ message: 'The back ways are watched too.', fight: ambush(ctx, 'robbery') })),
          choice('Walk on openly', '50%: robbers.', (ctx) =>
            ctx.dice.chance(0.5) ? { message: 'They were waiting.', fight: ambush(ctx, 'robbery') } : 'Nobody comes.'),
          choice('Scrub the marks off', '+2 sanity. 30%: robbers.', (ctx) => {
            sanity(ctx, 2);
            if (!ctx.dice.chance(0.3)) return 'The next traveller will not be marked. +2 sanity.';
            return { message: 'Someone saw you do it. +2 sanity.', fight: ambush(ctx, 'robbery') };
          }),
        ],
      },
      {
        zones: ['forest'],
        when: 'night',
        text: 'Wolves howl close by, and are answered from the other side of the road.',
        choices: [
          choice('Stand and fight', 'Wolves.', (ctx) => ({ message: 'You put your backs together.', fight: brawl(ctx, 'The pack comes in.', ['wolf', 'wolf', 'wolf']) })),
          trial('Keep moving', 'dex', 12, 'Fail: wolves.',
            () => 'They shadow you for a mile and lose interest.',
            (ctx) => ({ message: 'They cut you off.', fight: brawl(ctx, 'The pack comes in.', ['wolf', 'wolf']) })),
          trial('Build a fire', 'int', 12, 'Fail: wolves.',
            () => 'They circle the firelight, then give up.',
            (ctx) => ({ message: 'The wood is wet.', fight: brawl(ctx, 'The pack comes in.', ['wolf', 'wolf']) })),
        ],
      },
    ],
  },
  {
    id: 'weather',
    title: 'FOUL WEATHER',
    variants: [
      {
        zones: ['capitol', 'forest', 'lake'],
        title: 'STORM',
        text: 'Black clouds roll in fast. {Hail|Rain} hammers down and thunder follows.',
        choices: [
          choice('Shelter under a tree', 'd6: 1 lightning, -4 HP.', (ctx) => {
            const face = ctx.dice.die(6);
            if (face > 1) return `Rolled ${face}. You wait it out under the branches.`;
            return `Rolled ${face}. Lightning hits the tree. ${hp(ctx, -4)} HP.`;
          }),
          trial('Find a barn', 'int', 12, 'Pass: dry hay, +15% of all. Fail: -2 HP.',
            (ctx) => {
              restore(ctx, 0.15);
              return 'Dry hay and a leaky roof. +15% HP, mana, sanity and charges.';
            },
            (ctx) => `No barn. Soaked to the bone. ${hp(ctx, -2)} HP.`),
          choice('Push on', '-2 HP.', (ctx) => `Soaked to the bone. ${hp(ctx, -2)} HP.`),
        ],
      },
      {
        zones: ['red', 'wilds'],
        title: 'ASHFALL',
        text: 'Ash begins to fall like grey snow. It stings the eyes and throat.',
        choices: [
          trial('Wrap your faces', 'int', 11, 'Fail: -2 HP, -1 sanity.',
            () => 'Wet cloth over mouth and nose. You breathe easy.',
            (ctx) => {
              sanity(ctx, -1);
              return `Coughing for hours. ${hp(ctx, -2)} HP, -1 sanity.`;
            }),
          trial('Run for cover', 'dex', 12, 'Pass: a cave with ore. Fail: -3 HP.',
            (ctx) => `A dry cave, and a seam of ore in its wall: ${give(ctx, oreOf(ctx))}.`,
            (ctx) => `You fall on the ash-slick rocks. ${hp(ctx, -3)} HP.`),
        ],
      },
      {
        zones: ['white'],
        title: 'SANDSTORM',
        text: 'The wind picks up and the horizon turns brown. A sandstorm is coming.',
        choices: [
          trial('Dig in and wait', 'strength', 12, 'Fail: -3 HP.',
            () => 'You dig in behind a dune and let it pass over.',
            (ctx) => `The sand scours you raw. ${hp(ctx, -3)} HP.`),
          trial('Race for the rocks', 'dex', 14, 'Pass: shelter and a find. Fail: -4 HP.',
            (ctx) => `You make the rocks. Someone sheltered here before: ${giveFrom(ctx, ['arrow', 'throwingDagger', gemOf(ctx)])}.`,
            (ctx) => `The storm catches you in the open. ${hp(ctx, -4)} HP.`),
        ],
      },
      {
        zones: ['black', 'lake'],
        title: 'FOG',
        text: 'Fog rolls off the water, so thick you lose sight of each other.',
        choices: [
          choice('Hold still and wait', '-2 sanity.', (ctx) => {
            sanity(ctx, -2);
            return 'An hour of grey nothing. -2 sanity.';
          }),
          choice('Call out', 'd6: 1-2 something answers.', (ctx) => {
            const face = ctx.dice.die(6);
            if (face > 2) return `Rolled ${face}. You find each other by voice.`;
            if (ctx.zone === 'black') return { message: `Rolled ${face}. Something answers.`, fight: ambush(ctx, 'monsters', 'Shapes in the fog.') };
            sanity(ctx, -2);
            return `Rolled ${face}. Something answers in a voice like yours, then nothing. -2 sanity.`;
          }),
          trial('Keep walking', 'int', 12, 'Fail: -2 HP.',
            () => 'You keep the road under your feet.',
            (ctx) => `You walk into the marsh up to the waist. ${hp(ctx, -2)} HP.`),
        ],
      },
      {
        zones: ['capitol', 'forest', 'lake', 'red', 'wilds'],
        when: 'night',
        title: 'BITTER COLD',
        text: 'The cold comes down hard tonight. Breath smokes and fingers go numb.',
        choices: [
          choice('Huddle together', '-1 HP, +2 sanity.', (ctx) => {
            sanity(ctx, 2);
            return `Shoulder to shoulder until it eases. ${hp(ctx, -1)} HP, +2 sanity.`;
          }),
          trial('Build a fire', 'int', 11, 'Pass: +15% of all. Fail: -2 HP.',
            (ctx) => {
              restore(ctx, 0.15);
              return 'A roaring fire. +15% HP, mana, sanity and charges.';
            },
            (ctx) => `Nothing will light. ${hp(ctx, -2)} HP.`),
          choice('Keep moving', '-2 HP.', (ctx) => `You walk until you cannot feel your feet. ${hp(ctx, -2)} HP.`),
        ],
      },
      {
        zones: ['capitol', 'forest', 'lake'],
        when: 'day',
        title: 'CLEARING SKY',
        text: 'The rain stops and the sun breaks through. A rainbow stands over the road.',
        choices: [
          choice('Stop and look', '+3 sanity.', (ctx) => {
            sanity(ctx, 3);
            return 'It fades slowly. +3 sanity.';
          }),
          walkOn('You walk on under it.'),
        ],
      },
    ],
  },

  // ---- places by the road -------------------------------------------------------------
  {
    id: 'herbs',
    title: 'HERB PATCH',
    variants: [
      {
        zones: ['capitol', 'black', 'forest', 'lake'],
        text: 'Pale leaves grow thick in the ditch.',
        choices: [
          choice('Gather', '1-2 herbs.', (ctx) => `You gather ${give(ctx, herbOf(ctx), ctx.dice.die(2))}.`),
          walkOn(),
        ],
      },
      {
        zones: ['capitol', 'forest', 'lake'],
        text: 'Moonglow grows among {nettles|brambles|thorns} on the verge.',
        choices: [
          trial('Pick it carefully', 'dex', 11, 'Pass: 2-3 Moonglow. Fail: 1, -1 HP.',
            (ctx) => `You come away unscathed with ${give(ctx, 'herbMoonglow', 1 + ctx.dice.die(2))}.`,
            (ctx) => `You get ${give(ctx, 'herbMoonglow')} and a handful of thorns. ${hp(ctx, -1)} HP.`),
          walkOn(),
        ],
      },
      {
        zones: ['black', 'forest', 'lake'],
        text: 'Deathweed crowds a rotten log by the {road|path|track}.',
        choices: [
          choice('Gather', '1-3 Deathweed. 25%: -2 HP.', (ctx) => {
            const found = give(ctx, 'herbDeathweed', ctx.dice.die(3));
            if (!ctx.dice.chance(0.25)) return `You gather ${found}.`;
            return `You gather ${found}. The log is full of biting ants. ${hp(ctx, -2)} HP.`;
          }),
          walkOn(),
        ],
      },
      {
        zones: ['red', 'white', 'wilds'],
        text: 'Fireblossom pokes out of warm ground beside the {road|path|track}.',
        choices: [
          trial('Dig it up', 'strength', 11, 'Pass: 2 Fireblossom. Fail: 1, -2 HP.',
            (ctx) => `You lever out ${give(ctx, 'herbFireblossom', 2)}.`,
            (ctx) => `You get ${give(ctx, 'herbFireblossom')}, and a burn. ${hp(ctx, -2)} HP.`),
          walkOn(),
        ],
      },
      {
        text: 'A {who:herbalist|wise woman|monk} is picking herbs by the road and offers to show you the good ones.',
        choices: [
          trial('Learn from them', 'int', 12, 'Pass: 3 herbs. Fail: 1.',
            (ctx) => `You learn fast. ${give(ctx, herbOf(ctx), 3)} for the pack.`,
            (ctx) => `You mostly pick weeds. ${give(ctx, herbOf(ctx))} for the pack.`),
          choice(`Buy a bundle (${moneyLabel(0.5)})`, 'Two herbs.', (ctx) => {
            pay(ctx, 0.5);
            return `The {who} wraps up ${give(ctx, herbOf(ctx), 2)}.`;
          }, purse(0.5)),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'well',
    title: 'OLD WELL',
    sighted: true,
    variants: [
      {
        zones: ['capitol', 'forest', 'lake', 'red', 'wilds', 'black'],
        text: 'A mossy well stands by the road, a bucket on a frayed rope.',
        choices: [
          choice('Drink', 'd6: 1 foul water, -2 HP. Else 15% HP.', (ctx) => {
            const face = ctx.dice.die(6);
            if (face === 1) return `Rolled ${face}. Something died in it. ${hp(ctx, -2)} HP.`;
            return `Rolled ${face}. Cold and sweet. +${mend(ctx, 0.15)} HP.`;
          }),
          trial('Climb down', 'dex', 13, 'Pass: a find. Fail: -3 HP.',
            (ctx) => `On a ledge above the water: ${giveFrom(ctx, ['throwingDagger', gemOf(ctx), 'copperRing', 'crudeTrinket'])}.`,
            (ctx) => `The rope snaps. ${hp(ctx, -3)} HP.`),
          walkOn(),
        ],
      },
      {
        text: 'A wishing well, its bottom glittering with coins and rings.',
        choices: [
          trial('Toss a coin and wish', 'luck', 13, `Costs ${moneyLabel(0.1)}. Pass: 30% mana, +2 sanity.`,
            (ctx) => {
              pay(ctx, 0.1);
              sanity(ctx, 2);
              return `The water shivers. +${mana(ctx, 0.3)} mana, +2 sanity.`;
            },
            (ctx) => {
              pay(ctx, 0.1);
              return 'Plop. Nothing happens.';
            }, purse(0.1)),
          choice('Fish out a ring', 'A trinket. -3 sanity.', (ctx) => {
            sanity(ctx, -3);
            return `You fish out ${give(ctx, 'crudeTrinket')}. Somebody's wish. -3 sanity.`;
          }),
          walkOn(),
        ],
      },
      {
        text: 'A dead fox lies by a well. The water smells wrong.',
        choices: [
          trial('Clean it out', 'strength', 13, 'Pass: +4 sanity. Fail: -2 HP.',
            (ctx) => {
              sanity(ctx, 4);
              return 'You haul out the rot and the water runs clear again. +4 sanity.';
            },
            (ctx) => `You retch into the well, which does not help. ${hp(ctx, -2)} HP.`),
          choice('Chalk a warning', '+1 sanity.', (ctx) => {
            sanity(ctx, 1);
            return 'Nobody else will drink it. +1 sanity.';
          }),
          walkOn(),
        ],
      },
      {
        zones: ['black'],
        when: 'night',
        text: 'A voice calls up from the bottom of a well, begging to be pulled out.',
        choices: [
          choice('Haul them up', 'd6: 1-2 it is not a person, 3-6 a reward.', (ctx) => {
            const face = ctx.dice.die(6);
            if (face <= 2) return { message: `Rolled ${face}. What climbs out is not a person.`, fight: brawl(ctx, 'It climbs out of the well.', ['wisp', 'wisp']) };
            return `Rolled ${face}. A soaked pedlar, weeping with thanks, gives you ${giveFrom(ctx, ['healthPotion', 'manaPotion', 'copperRing'])}.`;
          }),
          choice('Walk on', '-1 sanity.', (ctx) => {
            sanity(ctx, -1);
            return 'The voice follows you down the road a long way. -1 sanity.';
          }),
        ],
      },
    ],
  },
  {
    id: 'stones',
    title: 'STANDING STONES',
    sighted: true,
    variants: [
      {
        text: 'A ring of standing stones hums faintly, though there is no wind.',
        choices: [
          choice('Step inside', '30% mana. 40%: -2 sanity.', (ctx) => {
            const got = mana(ctx, 0.3);
            if (!ctx.dice.chance(0.4)) return `The hum fills you up. +${got} mana.`;
            sanity(ctx, -2);
            return `The hum fills you up, and does not stop. +${got} mana, -2 sanity.`;
          }),
          trial('Touch the tallest', 'int', 13, 'Pass: +4 sanity, 20% mana. Fail: -3 sanity.',
            (ctx) => {
              sanity(ctx, 4);
              return `Warm stone, a slow pulse. +4 sanity, +${mana(ctx, 0.2)} mana.`;
            },
            (ctx) => {
              sanity(ctx, -3);
              return 'It is cold, and something on the other side touches back. -3 sanity.';
            }),
          walkOn(),
        ],
      },
      {
        text: 'Runes on a lone stone glow as you pass{, then fade| and stay lit}.',
        choices: [
          trial('Read the runes', 'int', 14, 'Pass: +25% of all. Fail: -3 sanity.',
            (ctx) => {
              restore(ctx, 0.25);
              return 'A blessing on travellers. +25% HP, mana, sanity and charges.';
            },
            (ctx) => {
              sanity(ctx, -3);
              return 'A curse on readers. -3 sanity.';
            }),
          walkOn(),
        ],
      },
      {
        when: 'night',
        text: 'Blue fire burns on top of an old stone and does not spread.',
        choices: [
          choice('Warm your hands', '25% mana, -1 sanity.', (ctx) => {
            const got = mana(ctx, 0.25);
            sanity(ctx, -1);
            return `It is cold fire, but it warms something. +${got} mana, -1 sanity.`;
          }),
          walkOn(),
        ],
      },
      {
        text: 'A flat stone altar, stained dark. Fresh {flowers|herbs|candles} lie on it.',
        choices: [
          choice('Leave an offering', 'Costs one herb. +4 sanity.', (ctx) => {
            takeAny(ctx, ALL_HERBS);
            sanity(ctx, 4);
            return 'The air goes still and kind. +4 sanity.';
          }, hasAny(ALL_HERBS)),
          choice('Lie on the altar', 'd6: 1-3 -3 sanity, 4-6 +30% of all.', (ctx) => {
            const face = ctx.dice.die(6);
            if (face <= 3) {
              sanity(ctx, -3);
              return `Rolled ${face}. You dream of knives. -3 sanity.`;
            }
            restore(ctx, 0.3);
            return `Rolled ${face}. You wake rested. +30% HP, mana, sanity and charges.`;
          }),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'grave',
    title: 'ROADSIDE GRAVE',
    sighted: true,
    variants: [
      {
        when: 'day',
        title: 'FUNERAL',
        text: 'A funeral procession blocks the road. The mourners sing a slow hymn.',
        choices: [
          choice('Join them', '+3 sanity.', (ctx) => {
            sanity(ctx, 3);
            return 'You walk with them to the graveside. +3 sanity.';
          }),
          choice('Push through', '-2 sanity.', (ctx) => {
            sanity(ctx, -2);
            return 'Every face turns to watch you go. -2 sanity.';
          }),
          walkOn('You wait for them to pass.', 'Wait', 'Let them pass.'),
        ],
      },
      {
        text: 'A fresh grave by the road, dug shallow. Something glints in the dirt.',
        choices: [
          choice('Dig', 'A find. 30%: something stirs.', (ctx) => {
            const found = giveFrom(ctx, ['crudeTrinket', 'copperRing', 'ironBand', 'throwingDagger']);
            if (!ctx.dice.chance(0.3)) return `You find ${found}.`;
            if (ctx.zone === 'black') return { message: `You find ${found}. The grave's owner wants it back.`, fight: brawl(ctx, 'The dead rise.', ['zombie']) };
            sanity(ctx, -2);
            return `You find ${found}. The dirt settles on its own behind you. -2 sanity.`;
          }),
          choice('Fill it in properly', '+3 sanity.', (ctx) => {
            sanity(ctx, 3);
            return 'You tamp it down and set a stone on it. +3 sanity.';
          }),
          walkOn(),
        ],
      },
      {
        when: 'night',
        title: 'GRAVE ROBBERS',
        text: 'Grave robbers are digging by lantern light in a roadside plot.',
        choices: [
          choice('Stop them', 'Robbers.', (ctx) => ({ message: 'You step into the light.', fight: ambush(ctx, 'robbery', 'The robbers drop their spades.') })),
          trial('Scare them off', 'strength', 13, 'Pass: their loot. Fail: a fight.',
            (ctx) => `They bolt and leave ${giveFrom(ctx, ['crudeTrinket', 'copperRing', 'manaStoneSmall'])} behind.`,
            (ctx) => ({ message: 'They are not scared.', fight: ambush(ctx, 'robbery') })),
          walkOn(),
        ],
      },
      {
        zones: ['black'],
        title: 'THE COFFIN',
        text: 'A coffin stands upright in the road. Its lid is nailed shut from the inside.',
        choices: [
          choice('Open it', 'd20: 1-8 a fight, 9-16 -3 sanity, 17+ a mana stone.', (ctx) => {
            const face = ctx.dice.die(20);
            if (face <= 8) return { message: `Rolled ${face}. It was waiting.`, fight: brawl(ctx, 'The coffin opens.', ['acidZombie']) };
            if (face <= 16) {
              sanity(ctx, -3);
              return `Rolled ${face}. Empty, but for scratch marks. -3 sanity.`;
            }
            return `Rolled ${face}. Bones, and clutched in them ${give(ctx, 'manaStoneMedium')}.`;
          }),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'bridge',
    title: 'BROKEN BRIDGE',
    zones: ['capitol', 'forest', 'lake', 'black', 'red', 'wilds'],
    variants: [
      {
        zones: ['capitol', 'forest', 'lake', 'black'],
        text: 'The bridge ahead has lost its middle planks. The water below runs fast.',
        choices: [
          trial('Jump the gap', 'dex', 12, 'Fail: -3 HP.',
            () => 'You land on the far side with a plank to spare.',
            (ctx) => `You land in the river. ${hp(ctx, -3)} HP.`),
          choice('Wade the ford', '-2 HP.', (ctx) => `Cold, fast and up to the chest. ${hp(ctx, -2)} HP.`),
          trial('Patch it', 'strength', 13, 'Pass: +3 sanity. Fail: -2 HP.',
            (ctx) => {
              sanity(ctx, 3);
              return 'You lay new planks. Whoever comes next will cross dry. +3 sanity.';
            },
            (ctx) => `A plank splits under you. ${hp(ctx, -2)} HP.`),
        ],
      },
      {
        zones: ['forest'],
        title: 'UNDER THE BRIDGE',
        text: 'Something big sleeps under the old stone bridge. It snores like a millwheel.',
        choices: [
          trial('Tiptoe over', 'dex', 13, 'Fail: it wakes.',
            () => 'It snores on.',
            (ctx) => ({ message: 'A plank creaks.', fight: brawl(ctx, 'A great boar wakes under the bridge.', ['boar']) })),
          choice('Wake it and fight', 'A fight. Its hoard: a find.', (ctx) => ({
            message: `Under the bridge, what the boar sleeps on: ${giveFrom(ctx, ['copperRing', 'ironBand', gemOf(ctx)])}.`,
            fight: brawl(ctx, 'A great boar wakes under the bridge.', ['boar']),
          })),
          walkOn('You find another crossing.', 'Find another crossing'),
        ],
      },
      {
        zones: ['red', 'wilds'],
        title: 'ROPE BRIDGE',
        text: 'A rope bridge sways over a gorge. Two planks are missing{ and one rope is frayed|}.',
        choices: [
          trial('Cross', 'dex', 12, 'Fail: -4 HP.',
            () => 'You do not look down, and that helps.',
            (ctx) => `A plank goes and you hang by your hands. ${hp(ctx, -4)} HP.`),
          choice('Climb down and round', '-1 HP. 50%: ore.', (ctx) => {
            const lost = hp(ctx, -1);
            if (!ctx.dice.chance(0.5)) return `A long scramble. ${lost} HP.`;
            return `A long scramble, past ${give(ctx, oreOf(ctx))}. ${lost} HP.`;
          }),
        ],
      },
      {
        zones: ['lake', 'black'],
        title: 'FERRYMAN',
        text: 'A ferryman waits by the water. "Two silver, and mind the eels."',
        choices: [
          choice(`Pay ${moneyLabel(0.2)}`, 'A rest in the boat, +10% of all.', (ctx) => {
            pay(ctx, 0.2);
            restore(ctx, 0.1);
            return 'You doze while he rows. +10% HP, mana, sanity and charges.';
          }, purse(0.2)),
          trial('Swim', 'strength', 12, 'Fail: -3 HP.',
            () => 'You swim it. The ferryman looks hurt.',
            (ctx) => `The eels. ${hp(ctx, -3)} HP.`),
          walkOn('You go the long way round.', 'Go the long way'),
        ],
      },
    ],
  },
  {
    id: 'watchtower',
    title: 'OLD WATCHTOWER',
    zones: ['capitol', 'red', 'forest', 'lake', 'wilds'],
    sighted: true,
    variants: [
      {
        text: 'An old watchtower stands empty by the road, its stair half rotten.',
        choices: [
          trial('Climb for a view', 'dex', 11, 'Pass: the land around mapped. Fail: -2 HP.',
            (ctx) => `You can see for miles. ${mapped(survey(ctx, 7))}`,
            (ctx) => `A stair gives way. ${hp(ctx, -2)} HP.`),
          choice('Search the base', 'd20: 1-6 squatters, else a find.', (ctx) => {
            const face = ctx.dice.die(20);
            if (face <= 6) return { message: `Rolled ${face}. Someone lives down here.`, fight: ambush(ctx, 'robbery', 'Squatters come up the stair.') };
            return `Rolled ${face}. Old stores: ${giveFrom(ctx, ['arrow', 'throwingDagger', 'healthPotion'])}.`;
          }),
          walkOn(),
        ],
      },
      {
        text: 'Two old guards keep a lonely tower and wave you in for a meal.',
        choices: [
          choice('Eat with them', '20% HP, +2 sanity.', (ctx) => comfort(ctx, 'Hard bread, good cheese, long stories.')),
          choice('Ask about the road', 'The land around mapped.', (ctx) => `They show you their maps. ${mapped(survey(ctx, 6))}`),
          walkOn(),
        ],
      },
      {
        text: 'Bandits hold an old watchtower. An archer on top has seen you.',
        choices: [
          choice('Storm it', 'A fight. Their loot: a find.', (ctx) => ({
            message: `Their stash is in plain sight: ${giveFrom(ctx, ['healthPotion', 'arrow', gemOf(ctx)])}.`,
            fight: ambush(ctx, 'robbery', 'Bandits pour out of the tower.'),
          })),
          trial('Back off', 'dex', 12, 'Fail: -3 HP.',
            () => 'You are out of bowshot before the second arrow.',
            (ctx) => `The second arrow finds you. ${hp(ctx, -3)} HP.`),
        ],
      },
      {
        when: 'night',
        text: 'A light burns at the top of a tower that should be empty.',
        choices: [
          choice('Go up', 'd20: 1-7 a fight, 8-14 nothing, 15+ a find.', (ctx) => {
            const face = ctx.dice.die(20);
            if (face <= 7) return { message: `Rolled ${face}. Someone is home.`, fight: ambush(ctx, 'robbery', 'They were expecting company.') };
            if (face <= 14) return `Rolled ${face}. A candle, burning alone. Nobody.`;
            return `Rolled ${face}. A hermit's room, abandoned mid-meal. You take ${giveFrom(ctx, ['manaPotion', 'healthPotion', 'copperRing'])}.`;
          }),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'farm',
    title: 'FARMSTEAD',
    zones: ['capitol', 'lake', 'forest'],
    sighted: true,
    variants: [
      {
        when: 'day',
        title: 'ORCHARD',
        text: 'Apple trees heavy with fruit lean over a farm wall.',
        choices: [
          choice('Pick some', '20% HP. 30%: the dogs.', (ctx) => {
            const healed = mend(ctx, 0.2);
            if (!ctx.dice.chance(0.3)) return `Crisp and sweet. +${healed} HP.`;
            return `Crisp and sweet, until the dogs come. +${healed} HP, then ${hp(ctx, -2)} HP.`;
          }),
          trial('Ask the farmer', 'int', 10, 'Pass: 25% HP.',
            (ctx) => `"Take all you can carry." +${mend(ctx, 0.25)} HP.`,
            () => 'The farmer does not like the look of you.'),
          walkOn(),
        ],
      },
      {
        title: 'HAYMAKING',
        text: 'A farmer is desperate to get the hay in before the rain.',
        choices: [
          trial('Help', 'strength', 11, 'Pass: supper, +20% of all. Fail: -1 HP.',
            (ctx) => {
              restore(ctx, 0.2);
              return 'The hay is in by dusk and supper is huge. +20% HP, mana, sanity and charges.';
            },
            (ctx) => `A pitchfork to the foot. ${hp(ctx, -1)} HP.`),
          walkOn(),
        ],
      },
      {
        title: 'SCARECROW',
        text: 'A scarecrow in a good coat stands in a field. Its head turns as you pass.',
        choices: [
          choice('Take the coat', 'A Padded Jerkin. 40%: -3 sanity.', (ctx) => {
            const coat = give(ctx, 'paddedJerkin');
            if (!ctx.dice.chance(0.4)) return `You take ${coat}. It is only straw.`;
            sanity(ctx, -3);
            return `You take ${coat}. The scarecrow watches you go. -3 sanity.`;
          }),
          choice('Knock it down', '50%: straw. 50%: rats, -2 HP.', (ctx) => {
            if (ctx.dice.chance(0.5)) return 'It is only straw.';
            return `It is full of rats, and they are not pleased. ${hp(ctx, -2)} HP.`;
          }),
          walkOn(),
        ],
      },
      {
        title: 'WINDMILL',
        text: 'A windmill creaks by the road. The miller waves you in for bread.',
        choices: [
          choice('Accept', '15% HP.', (ctx) => `Warm bread, straight from the oven. +${mend(ctx, 0.15)} HP.`),
          trial('Fix the sails', 'dex', 13, 'Pass: 15% HP, a gift. Fail: -2 HP.',
            (ctx) => `The sails turn true. Bread, and ${give(ctx, 'healthPotion')}. +${mend(ctx, 0.15)} HP.`,
            (ctx) => `A sail swings round and knocks you flat. ${hp(ctx, -2)} HP.`),
          walkOn(),
        ],
      },
      {
        title: 'BURNING BARN',
        text: 'A barn is on fire. A farmer is trying to get the animals out.',
        choices: [
          trial('Run in', 'dex', 13, 'Pass: +4 sanity, a gift. Fail: -3 HP.',
            (ctx) => {
              sanity(ctx, 4);
              return `You bring out the last calf. The farmer gives you ${giveFrom(ctx, ['healthPotion', 'leatherBoots', 'leatherCap'])}. +4 sanity.`;
            },
            (ctx) => `The heat drives you back. ${hp(ctx, -3)} HP.`),
          choice('Fetch water', '+2 sanity, -1 HP.', (ctx) => {
            sanity(ctx, 2);
            return `Bucket after bucket until the roof falls in. ${hp(ctx, -1)} HP, +2 sanity.`;
          }),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'deserter',
    title: 'DESERTER',
    zones: ['capitol', 'red', 'lake', 'white'],
    variants: [
      {
        text: 'A soldier in a torn tabard hides in the ditch. "Please. They hang deserters."',
        choices: [
          choice('Give a Health Potion', 'Costs one Health Potion. His blades.', (ctx) => {
            takeAny(ctx, ['healthPotion']);
            return `He will make it now. He gives you ${give(ctx, 'throwingDagger', 2)}.`;
          }, has('healthPotion')),
          choice('Look away', '+1 sanity.', (ctx) => {
            sanity(ctx, 1);
            return 'You never saw him. +1 sanity.';
          }),
          choice('Drag him out', '-2 sanity.', (ctx) => {
            sanity(ctx, -2);
            return 'The patrol thanks you. He does not. -2 sanity.';
          }),
        ],
      },
      {
        text: 'Two soldiers drag a prisoner in chains. He begs you for help as they pass.',
        choices: [
          choice('Free him', 'A fight.', (ctx) => ({ message: 'You step in front of them.', fight: brawl(ctx, 'The soldiers draw.', ['bandit', 'bandit-archer']) })),
          trial('Talk them round', 'int', 15, 'Pass: +4 sanity.',
            (ctx) => {
              sanity(ctx, 4);
              return 'They were never sure of the charge anyway. He goes free. +4 sanity.';
            },
            () => 'They tell you to mind your own business.'),
          walkOn(),
        ],
      },
      {
        text: 'A patrol stops you. "Seen a deserter? Tall, limping, stole a horse."',
        choices: [
          trial('Send them the wrong way', 'int', 12, 'Pass: +2 sanity. Fail: they search you.',
            (ctx) => {
              sanity(ctx, 2);
              return 'They gallop off east. The deserter went west. +2 sanity.';
            },
            (ctx) => {
              const seized = takeAny(ctx, POTIONS);
              return seized ? `They search your packs and keep a ${seized}.` : 'They search your packs and find nothing to keep.';
            }),
          choice('Tell the truth', 'You have not seen him.', () => 'They thank you and ride on.'),
        ],
      },
      {
        text: "A deserter's camp: a stolen horse, a cold fire and a man who reaches for his sword.",
        choices: [
          trial('Talk him down', 'int', 12, 'Pass: he shares supper. Fail: a fight.',
            (ctx) => `He lowers the sword and shares what he has. +${mend(ctx, 0.15)} HP.`,
            (ctx) => ({ message: 'He will not be taken.', fight: brawl(ctx, 'The deserter attacks.', ['bandit-captain']) })),
          choice('Fight', 'One Bandit Captain.', (ctx) => ({ message: 'You draw first.', fight: brawl(ctx, 'The deserter attacks.', ['bandit-captain']) })),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'gamblers',
    title: 'GAMBLERS',
    zones: ['capitol', 'lake', 'red', 'white'],
    variants: [
      {
        title: 'DICE GAME',
        text: 'Travellers throw dice on a drumhead. "A silver to play, winner takes the pot."',
        choices: [
          trial(`Play (${moneyLabel(0.1)})`, 'luck', 12, 'Pass: the pot, paid in kind.',
            (ctx) => {
              pay(ctx, 0.1);
              return `You win. They pay in kind: ${giveFrom(ctx, ['arrow', 'throwingDagger', 'healthPotion', 'crudeTrinket'])}.`;
            },
            (ctx) => {
              pay(ctx, 0.1);
              return 'Snake eyes. Your silver is gone.';
            }, purse(0.1)),
          choice('Watch', '+1 sanity.', (ctx) => {
            sanity(ctx, 1);
            return 'You watch a farmer lose his boots. +1 sanity.';
          }),
          walkOn(),
        ],
      },
      {
        title: 'SHELL GAME',
        text: 'A shell game on a barrel by the road. The dealer smiles too much.',
        choices: [
          trial(`Play (${moneyLabel(0.2)})`, 'int', 15, 'Pass: a Health Potion.',
            (ctx) => {
              pay(ctx, 0.2);
              return `You follow the pea. He pays in kind: ${give(ctx, 'healthPotion')}.`;
            },
            (ctx) => {
              pay(ctx, 0.2);
              return 'The pea was never under any of them.';
            }, purse(0.2)),
          trial('Expose the cheat', 'int', 13, 'Pass: +3 sanity. Fail: his friends.',
            (ctx) => {
              sanity(ctx, 3);
              return 'The crowd turns on him and he runs. +3 sanity.';
            },
            (ctx) => ({ message: 'His friends object.', fight: ambush(ctx, 'robbery', 'The dealer has friends.') })),
          walkOn(),
        ],
      },
      {
        when: 'night',
        title: 'CARD SHARPS',
        text: 'Card players round a fire wave you over. One of them deals from the bottom.',
        choices: [
          trial(`Play (${moneyLabel(0.3)})`, 'luck', 14, 'Pass: a Mana Potion.',
            (ctx) => {
              pay(ctx, 0.3);
              return `You beat the cheat at his own game: ${give(ctx, 'manaPotion')}.`;
            },
            (ctx) => {
              pay(ctx, 0.3);
              return 'You lose, as you were meant to.';
            }, purse(0.3)),
          trial('Call him out', 'strength', 12, 'Pass: +3 sanity. Fail: a fight.',
            (ctx) => {
              sanity(ctx, 3);
              return 'You loom. He deals fair after that. +3 sanity.';
            },
            (ctx) => ({ message: 'Knives come out.', fight: ambush(ctx, 'robbery', 'Card sharps with knives.') })),
          walkOn(),
        ],
      },
      {
        when: 'day',
        title: 'HORSE RACE',
        text: 'Two riders line up to race to the next milestone. A bookmaker is taking bets.',
        choices: [
          trial(`Bet on the {grey|bay|chestnut} (${moneyLabel(0.2)})`, 'luck', 12, 'Pass: winnings, paid in kind.',
            (ctx) => {
              pay(ctx, 0.2);
              return `It wins by a nose. The bookmaker pays in kind: ${giveFrom(ctx, ['healthPotion', 'manaPotion', 'arrow'])}.`;
            },
            (ctx) => {
              pay(ctx, 0.2);
              return 'It stops to eat a hedge. Your silver is gone.';
            }, purse(0.2)),
          choice('Watch the race', '+2 sanity.', (ctx) => {
            sanity(ctx, 2);
            return 'Mud, shouting and a finish too close to call. +2 sanity.';
          }),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'kobolds',
    title: 'KOBOLDS',
    zones: ['red', 'wilds'],
    variants: [
      {
        title: 'KOBOLD TRADERS',
        text: 'Kobolds with a barrow of junk wave you down. "Trade? Trade!"',
        choices: [
          choice('Trade a herb', 'Costs one herb. Two lumps of ore.', (ctx) => {
            takeAny(ctx, ALL_HERBS);
            return `They sniff it, eat it, and hand over ${give(ctx, oreOf(ctx), 2)}.`;
          }, hasAny(ALL_HERBS)),
          choice('Trade a gem', 'Costs one gem. A Pickaxe.', (ctx) => {
            takeAny(ctx, ALL_GEMS);
            return `Much excitement. You get ${give(ctx, 'pickaxe')}.`;
          }, hasAny(ALL_GEMS)),
          walkOn(),
        ],
      },
      {
        title: 'STUCK KOBOLD',
        text: 'A kobold is stuck head first in a crack in the rocks, legs kicking.',
        choices: [
          trial('Pull it out', 'strength', 10, 'Pass: a shiny. Fail: -1 HP.',
            (ctx) => `It pops free and gives you its shiny: ${give(ctx, gemOf(ctx))}.`,
            (ctx) => `It bites you, from inside the crack. ${hp(ctx, -1)} HP.`),
          choice('Leave it', '-1 sanity.', (ctx) => {
            sanity(ctx, -1);
            return 'Its muffled wailing follows you. -1 sanity.';
          }),
        ],
      },
      {
        title: 'KOBOLD MINERS',
        text: 'Kobold miners argue over a seam of ore by the road.',
        choices: [
          trial('Scare them off', 'strength', 12, 'Pass: the ore. Fail: a fight.',
            (ctx) => `They scatter. You dig out ${give(ctx, oreOf(ctx), 2)}.`,
            (ctx) => ({ message: 'They do not scare.', fight: brawl(ctx, 'Kobolds with picks.', ['kobold', 'kobold', 'kobold']) })),
          trial('Help them dig', 'strength', 10, 'Pass: a share. Fail: -1 HP.',
            (ctx) => `They give you a share: ${give(ctx, oreOf(ctx))}.`,
            (ctx) => `A pick glances off a rock and into your shin. ${hp(ctx, -1)} HP.`),
          walkOn(),
        ],
      },
      {
        when: 'night',
        title: 'EYES IN THE ROCKS',
        text: 'Small eyes glint from the rocks on both sides. Kobolds, many of them.',
        choices: [
          choice('Throw them a gem', 'Costs one gem. They leave you be.', (ctx) => {
            const gem = takeAny(ctx, ALL_GEMS);
            return `They fight over the ${gem ?? 'gem'} and forget you.`;
          }, hasAny(ALL_GEMS)),
          choice('Fight', 'Kobolds.', (ctx) => ({ message: 'You go at them.', fight: brawl(ctx, 'Kobolds swarm down.', ['kobold', 'kobold', 'elite-kobold']) })),
          trial('Run', 'dex', 12, 'Fail: a fight.',
            () => 'Short legs. You outrun them.',
            (ctx) => ({ message: 'They are faster than they look.', fight: brawl(ctx, 'Kobolds swarm down.', ['kobold', 'kobold', 'kobold']) })),
        ],
      },
    ],
  },
  {
    id: 'beasts',
    title: 'WILD BEASTS',
    zones: ['forest'],
    variants: [
      {
        title: 'SNARED HARE',
        text: 'A {hare|rabbit} is caught in a snare by the road, still alive.',
        choices: [
          choice('Free it', '+3 sanity.', (ctx) => {
            sanity(ctx, 3);
            return 'It bolts without a backward look. +3 sanity.';
          }),
          choice('Take it', 'A pelt. 30%: the trapper sees.', (ctx) => {
            const pelt = give(ctx, 'rabbitPelt');
            if (!ctx.dice.chance(0.3)) return `You take ${pelt}.`;
            return { message: `You take ${pelt}. The trapper sees you.`, fight: ambush(ctx, 'robbery', 'The trapper wants his catch.') };
          }),
          walkOn(),
        ],
      },
      {
        title: 'BOAR PIGLETS',
        text: 'Striped piglets squeal in the ferns. The sow will not be far.',
        choices: [
          trial('Back away slowly', 'dex', 12, 'Fail: the sow charges.',
            () => 'You back off and the squealing fades.',
            (ctx) => ({ message: 'The ferns explode.', fight: brawl(ctx, 'The sow charges.', ['boar']) })),
          choice('Stand your ground', 'A fight with the sow.', (ctx) => ({ message: 'The sow comes out.', fight: brawl(ctx, 'The sow charges.', ['boar']) })),
        ],
      },
      {
        title: 'LONE WOLF',
        text: 'A wolf, alone and thin, watches you from the treeline.',
        choices: [
          choice('Throw it food', '+2 sanity.', (ctx) => {
            sanity(ctx, 2);
            return 'It takes the food and melts back into the trees. +2 sanity.';
          }),
          trial('Drive it off', 'strength', 11, 'Fail: its pack comes.',
            () => 'It slinks away.',
            (ctx) => ({ message: 'It howls. It was not alone.', fight: brawl(ctx, 'The pack answers.', ['wolf', 'wolf']) })),
          choice('Hunt it', 'A fight.', (ctx) => ({ message: 'You go after it.', fight: brawl(ctx, 'It was not alone.', ['wolf', 'wolf']) })),
        ],
      },
      {
        when: 'day',
        title: 'RABBITS',
        text: 'Rabbits everywhere in the long grass, fat and slow.',
        choices: [
          trial('Catch supper', 'dex', 10, 'Pass: 20% HP, a pelt.',
            (ctx) => `Stew tonight. +${mend(ctx, 0.2)} HP and ${give(ctx, 'rabbitPelt')}.`,
            () => 'Not as slow as they looked.'),
          walkOn(),
        ],
      },
      {
        title: 'THE STAG',
        text: 'A great white stag stands in the road and looks at you as if it knows you.',
        choices: [
          choice('Bow to it', '+3 sanity.', (ctx) => {
            sanity(ctx, 3);
            return 'It dips its antlers and is gone. +3 sanity.';
          }),
          trial('Hunt it', 'dex', 15, 'Pass: 30% HP, -3 sanity.',
            (ctx) => {
              sanity(ctx, -3);
              return `Venison for days. Nobody feels good about it. +${mend(ctx, 0.3)} HP, -3 sanity.`;
            },
            () => 'It is not there when the arrow arrives.'),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'swarm',
    title: 'SWARM',
    zones: ['black', 'forest', 'lake'],
    variants: [
      {
        text: 'A cloud of {midges|biting flies|mosquitoes} rises from the {reeds|bog|ditch}.',
        choices: [
          trial('Run', 'dex', 11, 'Fail: -2 HP.',
            () => 'You outrun the cloud.',
            (ctx) => `They follow you for a mile. ${hp(ctx, -2)} HP.`),
          trial('Smoke them off', 'int', 12, 'Fail: -2 HP.',
            () => 'Green wood on a quick fire. They leave you alone.',
            (ctx) => `The smoke only annoys them. ${hp(ctx, -2)} HP.`),
          choice('Grit your teeth', '-1 HP, -1 sanity.', (ctx) => {
            sanity(ctx, -1);
            return `Itching for days. ${hp(ctx, -1)} HP, -1 sanity.`;
          }),
        ],
      },
      {
        zones: ['forest'],
        title: 'WILD BEES',
        text: 'Wild bees have built a hive in a hollow oak by the road. Honey drips down the bark.',
        choices: [
          trial('Take the honey', 'dex', 13, 'Pass: 25% HP. Fail: -3 HP.',
            (ctx) => `Sticky fingers, full bellies. +${mend(ctx, 0.25)} HP.`,
            (ctx) => `The bees object. ${hp(ctx, -3)} HP.`),
          walkOn(),
        ],
      },
      {
        zones: ['black', 'lake'],
        title: 'LEECHES',
        text: 'The path runs through black water, and the water is full of leeches.',
        choices: [
          choice('Wade through', '-2 HP.', (ctx) => `You pick them off on the far side. ${hp(ctx, -2)} HP.`),
          trial('Find a way round', 'int', 12, 'Fail: -3 HP.',
            () => 'A line of tussocks, dry all the way.',
            (ctx) => `The way round is worse. ${hp(ctx, -3)} HP.`),
        ],
      },
      {
        zones: ['black', 'forest'],
        title: 'WEBS',
        text: 'Webs thick as sailcloth hang between the trees. Old bundles hang in them.',
        choices: [
          trial('Cut through', 'strength', 12, 'Fail: -2 HP and sanity.',
            () => 'You hack a way through and do not look up.',
            (ctx) => {
              sanity(ctx, -2);
              return `Something drops down your collar. ${hp(ctx, -2)} HP, -2 sanity.`;
            }),
          choice('Search the bundles', 'A find. 40%: a fight.', (ctx) => {
            const found = giveFrom(ctx, ['throwingDagger', 'copperRing', 'crudeTrinket', 'arrow']);
            if (!ctx.dice.chance(0.4)) return `Wrapped in silk: ${found}.`;
            return { message: `Wrapped in silk: ${found}. The web shakes.`, fight: ambush(ctx, 'monsters', 'Something was watching the web.') };
          }),
          walkOn('You go the long way round.', 'Go round'),
        ],
      },
    ],
  },

  // ---- the lake -----------------------------------------------------------------------
  {
    id: 'wreck',
    title: 'SHIPWRECK',
    zones: ['lake'],
    sighted: true,
    variants: [
      {
        text: 'A fishing boat has run aground in the shallows, its hold half full of water.',
        choices: [
          trial('Search the hull', 'dex', 11, 'Pass: salvage or a Sapphire. Fail: -2 HP.',
            (ctx) => `You find ${ctx.dice.chance(0.35) ? give(ctx, 'gemSapphire') : give(ctx, 'throwingDagger')}.`,
            (ctx) => `A rotten plank gives way under you. ${hp(ctx, -2)} HP.`),
          walkOn(),
        ],
      },
      {
        text: 'A grain barge has sunk by the shore. Crates bob in the shallows.',
        choices: [
          trial('Wade in', 'strength', 11, 'Pass: a crate. Fail: -2 HP.',
            (ctx) => `You drag a crate ashore: ${giveFrom(ctx, ['healthPotion', 'manaPotion', 'arrow', 'throwingDagger'])}.`,
            (ctx) => `The current takes your legs. ${hp(ctx, -2)} HP.`),
          walkOn(),
        ],
      },
      {
        text: 'A black-sailed wreck lies on the rocks. Something moves in the hold.',
        choices: [
          trial('Search the hold', 'int', 13, 'Pass: a Sapphire. Fail: -2 HP, -2 sanity.',
            (ctx) => `Behind a false panel: ${give(ctx, 'gemSapphire')}.`,
            (ctx) => {
              sanity(ctx, -2);
              return `An eel as thick as your arm, and the crew's bones. ${hp(ctx, -2)} HP, -2 sanity.`;
            }),
          walkOn(),
        ],
      },
      {
        text: 'An upturned rowboat lies on the beach, {oars|nets|a lantern} still tied inside.',
        choices: [
          trial('Flip it over', 'strength', 10, 'Pass: a find. Fail: -1 HP.',
            (ctx) => `Under it: ${giveFrom(ctx, ['throwingDagger', 'arrow', 'crudeTrinket'])}.`,
            (ctx) => `Under it: crabs. Many crabs. ${hp(ctx, -1)} HP.`),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'nets',
    title: 'HEAVY NETS',
    zones: ['lake'],
    sighted: true,
    variants: [
      {
        text: 'A fisher is struggling to haul a full net up the beach.',
        choices: [
          trial('Lend a hand', 'strength', 11, 'Pass: a share of the catch, 20% HP.',
            (ctx) => `The catch comes in and you get a share, cooked. +${mend(ctx, 0.2)} HP.`,
            () => 'The net slips back into the water. The fisher thanks you anyway.'),
          walkOn(),
        ],
      },
      {
        text: "A fisher's net is snagged {offshore|out by the reeds|on a sunken post}. They cannot swim.",
        choices: [
          trial('Swim out', 'dex', 12, 'Pass: 20% HP. Fail: -2 HP.',
            (ctx) => `You free it and share the catch. +${mend(ctx, 0.2)} HP.`,
            (ctx) => `Cold water, then the snag snags you. ${hp(ctx, -2)} HP.`),
          walkOn(),
        ],
      },
      {
        text: 'Fishers are gutting a huge catch on the shore and selling it cheap.',
        choices: [
          choice(`Buy a fish supper (${moneyLabel(0.2)})`, '+30% HP.', (ctx) => {
            pay(ctx, 0.2);
            return `Fried in the pan while you wait. +${mend(ctx, 0.3)} HP.`;
          }, purse(0.2)),
          trial('Help gut them', 'dex', 10, 'Pass: 15% HP. Fail: -1 HP.',
            (ctx) => `They feed you for your trouble. +${mend(ctx, 0.15)} HP.`,
            (ctx) => `You gut your thumb. ${hp(ctx, -1)} HP.`),
          walkOn(),
        ],
      },
      {
        text: 'Fishers have hooked a pike as long as a man. It thrashes in the net and they cannot land it.',
        choices: [
          trial('Haul it in', 'strength', 12, 'Pass: a fish supper, 25% HP. Fail: -2 HP.',
            (ctx) => `It comes up the beach at last. Supper for everyone. +${mend(ctx, 0.25)} HP.`,
            (ctx) => `Its tail catches you across the shins. ${hp(ctx, -2)} HP.`),
          trial('Cut it loose', 'dex', 12, 'Pass: +2 sanity. Fail: -1 HP.',
            (ctx) => {
              sanity(ctx, 2);
              return 'It slides back into the lake. The net is saved. +2 sanity.';
            },
            (ctx) => `The knife slips on the wet net. ${hp(ctx, -1)} HP.`),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'drowned',
    title: 'DROWNED VILLAGE',
    zones: ['black', 'lake'],
    sighted: true,
    variants: [
      {
        text: 'Rooftops poke out of the marsh where a village drowned. A bell tolls under the water.',
        choices: [
          trial('Search the rooftops', 'dex', 12, 'Pass: a find. Fail: -2 HP.',
            (ctx) => `In a dry attic: ${giveFrom(ctx, ['healthPotion', 'crudeTrinket', 'copperRing', 'arrow'])}.`,
            (ctx) => `A roof gives way into black water. ${hp(ctx, -2)} HP.`),
          trial('Dive for the bell', 'strength', 14, 'Pass: Ectoplasm, +3 sanity. Fail: -2 HP.',
            (ctx) => {
              sanity(ctx, 3);
              return `You silence the bell. Something thanks you and leaves ${give(ctx, 'ectoplasm', 2)}. +3 sanity.`;
            },
            (ctx) => `The cold drives you back up. ${hp(ctx, -2)} HP.`),
          walkOn(),
        ],
      },
      {
        zones: ['black'],
        when: 'night',
        text: 'Corpse candles float over the drowned village, one above every roof.',
        choices: [
          choice('Blow one out', '50%: +3 sanity. 50%: a fight.', (ctx) => {
            if (ctx.dice.chance(0.5)) {
              sanity(ctx, 3);
              return 'A sigh, and the candle is gone. +3 sanity.';
            }
            return { message: 'Every candle turns toward you.', fight: brawl(ctx, 'The candles were wisps.', ['wisp', 'wisp']) };
          }),
          walkOn(),
        ],
      },
      {
        zones: ['black'],
        text: 'A drowned church stands up to its windows in black water. The door is open.',
        choices: [
          choice('Wade in', 'd20: 1-7 the dead, 8-14 -2 HP, 15+ a find.', (ctx) => {
            const face = ctx.dice.die(20);
            if (face <= 7) return { message: `Rolled ${face}. The congregation is still here.`, fight: brawl(ctx, 'The drowned congregation.', ['zombie', 'zombie']) };
            if (face <= 14) return `Rolled ${face}. Cold, dark and empty. ${hp(ctx, -2)} HP.`;
            return `Rolled ${face}. On the altar: ${giveFrom(ctx, ['manaStoneSmall', 'manaPotion', 'gemOnyx'])}.`;
          }),
          walkOn(),
        ],
      },
      {
        zones: ['black'],
        text: 'A half-sunk house, its upper floor still dry. Smoke rises from the chimney.',
        choices: [
          trial('Knock', 'luck', 12, 'Pass: a hermit feeds you. Fail: a fight.',
            (ctx) => comfort(ctx, 'An old woman who would not leave. Fish soup.'),
            (ctx) => ({ message: 'Whoever lives there does not want visitors.', fight: ambush(ctx, 'monsters', 'The door bursts open.') })),
          walkOn(),
        ],
      },
    ],
  },

  // ---- the black country ------------------------------------------------------------
  {
    id: 'mire-lights',
    title: 'MIRE LIGHTS',
    zones: ['black', 'forest', 'lake'],
    sighted: true,
    variants: [
      {
        zones: ['black'],
        text: 'Blue lights drift over the bog, away from the road.',
        choices: [
          trial('Follow them', 'int', 13, 'Pass: a gem. Fail: wisps.',
            (ctx) => `The lights lead to ${give(ctx, 'gemOnyx')}.`,
            (ctx) => ({ message: 'The lights turn on you.', fight: brawl(ctx, 'The lights were wisps.', ['wisp', 'wisp']) })),
          walkOn(),
        ],
      },
      {
        zones: ['black'],
        text: "A child's voice sings from the reeds. There is no child in sight.",
        choices: [
          choice('Follow the song', 'A fight.', (ctx) => ({ message: 'The song stops. Something rises.', fight: brawl(ctx, 'It was never a child.', ['specter']) })),
          trial('Stop your ears', 'int', 12, 'Fail: -3 sanity.',
            () => 'You hum loudly until the song is behind you.',
            (ctx) => {
              sanity(ctx, -3);
              return 'You hear it for hours. -3 sanity.';
            }),
          choice('Walk on', '50%: -2 sanity.', (ctx) => {
            if (ctx.dice.chance(0.5)) return 'The song fades behind you.';
            sanity(ctx, -2);
            return 'The song follows you. -2 sanity.';
          }),
        ],
      },
      {
        zones: ['black'],
        text: 'A man with a lantern waves from the reeds, beckoning you off the road.',
        choices: [
          choice('Go to him', 'd20: 1-8 wisps, 9-15 lost in the bog, 16+ a gem.', (ctx) => {
            const face = ctx.dice.die(20);
            if (face <= 8) return { message: `Rolled ${face}. The lantern splits in two.`, fight: brawl(ctx, 'Wisps!', ['wisp', 'wisp']) };
            if (face <= 15) {
              sanity(ctx, -2);
              return `Rolled ${face}. He is never quite there. You wade back soaked. ${hp(ctx, -2)} HP, -2 sanity.`;
            }
            return `Rolled ${face}. He points at the mud and fades. In it: ${give(ctx, ctx.dice.pick<ItemId>(['gemOnyx', 'gemAmethyst']))}.`;
          }),
          walkOn(),
        ],
      },
      {
        when: 'day',
        text: 'Bubbles rise from the mire and burst with a smell of rot. Something glints below.',
        choices: [
          trial('Reach in', 'dex', 12, 'Pass: a gem. Fail: -2 HP.',
            (ctx) => `Your hand closes on ${give(ctx, ctx.dice.pick<ItemId>(['gemOnyx', 'gemAmethyst', 'gemSapphire']))}.`,
            (ctx) => `Something below closes on your hand. ${hp(ctx, -2)} HP.`),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'bones',
    title: 'OLD BONES',
    zones: ['black', 'white', 'capitol', 'red', 'wilds'],
    sighted: true,
    variants: [
      {
        zones: ['black'],
        text: 'A skeleton in rusted mail lies half-sunk in the mud.',
        choices: [
          choice('Bury it', '+3 sanity.', (ctx) => {
            sanity(ctx, 3);
            return 'You bury the bones. Something is set at rest. +3 sanity.';
          }),
          choice('Search it', 'A rusted blade. 30%: it rises.', (ctx) => {
            const found = give(ctx, 'throwingDagger');
            if (!ctx.dice.chance(0.3)) return `You pull out ${found}.`;
            return { message: `You pull out ${found}. The bones stand up.`, fight: brawl(ctx, 'The dead knight stands.', ['skeleton']) };
          }),
          walkOn(),
        ],
      },
      {
        zones: ['white'],
        text: 'A skeleton sits propped against a {rock|dead tree|pillar}, one finger pointing {east|north|west}.',
        choices: [
          choice('Search it', 'A find. 25%: -2 sanity.', (ctx) => {
            const found = giveFrom(ctx, ['crudeTrinket', 'copperRing', gemOf(ctx)]);
            if (!ctx.dice.chance(0.25)) return `In its lap: ${found}.`;
            sanity(ctx, -2);
            return `In its lap: ${found}. Its head turns to watch you go. -2 sanity.`;
          }),
          choice('Bury it', '+3 sanity.', (ctx) => {
            sanity(ctx, 3);
            return 'You scrape a grave in the sand. +3 sanity.';
          }),
          walkOn(),
        ],
      },
      {
        zones: ['capitol', 'black'],
        text: 'Old bones and broken shields litter a field by the road. Crows watch you.',
        choices: [
          trial('Search the field', 'int', 12, 'Pass: old kit. Fail: -2 sanity.',
            (ctx) => `Under a split shield: ${giveFrom(ctx, ['ironBand', 'leatherCap', 'arrow', 'throwingDagger'])}.`,
            (ctx) => {
              sanity(ctx, -2);
              return 'Too many skulls, all grinning. -2 sanity.';
            }),
          choice('Say a word for the dead', '+3 sanity.', (ctx) => {
            sanity(ctx, 3);
            return 'The crows fly off. +3 sanity.';
          }),
          walkOn(),
        ],
      },
      {
        zones: ['red', 'wilds'],
        text: 'The ribs of something huge arch over the path like a gate. Its skull is the size of a cart.',
        choices: [
          trial('Search the skull', 'strength', 13, 'Pass: a Ruby. Fail: -2 HP.',
            (ctx) => `Wedged in an eye socket: ${give(ctx, 'gemRuby')}.`,
            (ctx) => `A slab of jaw comes down on you. ${hp(ctx, -2)} HP.`),
          choice('Walk under the ribs', '50%: +3 sanity. 50%: -3 sanity.', (ctx) =>
            omen(ctx, 'It feels like a blessing.', 'It feels like being swallowed.')),
          walkOn('You go round.', 'Go round'),
        ],
      },
      {
        zones: ['black'],
        when: 'night',
        text: 'Pale hands push up through a fresh mound beside the road.',
        choices: [
          trial('Run', 'dex', 12, 'Fail: a fight.',
            () => 'You are gone before they are out.',
            (ctx) => ({ message: 'A hand closes round your ankle.', fight: brawl(ctx, 'The dead climb out.', ['zombie', 'zombie']) })),
          choice('Stand and fight', 'Two zombies.', (ctx) => ({ message: 'You wait for them.', fight: brawl(ctx, 'The dead climb out.', ['zombie', 'zombie']) })),
          trial('Pray over the mound', 'int', 14, 'Pass: +3 sanity. Fail: a fight.',
            (ctx) => {
              sanity(ctx, 3);
              return 'The hands go still and sink back. +3 sanity.';
            },
            (ctx) => ({ message: 'They do not listen.', fight: brawl(ctx, 'The dead climb out.', ['zombie', 'zombie']) })),
        ],
      },
    ],
  },
  {
    id: 'weeping',
    title: 'THE WEEPING',
    zones: ['black'],
    variants: [
      {
        text: 'A pale woman in white stands in the road, weeping without a sound.',
        choices: [
          trial('Comfort her', 'int', 13, 'Pass: +4 sanity, Ectoplasm. Fail: -4 sanity.',
            (ctx) => {
              sanity(ctx, 4);
              return `She smiles and is gone. Where she stood: ${give(ctx, 'ectoplasm')}. +4 sanity.`;
            },
            (ctx) => {
              sanity(ctx, -4);
              return 'She turns her face to you. -4 sanity.';
            }),
          choice('Walk past', '-1 sanity.', (ctx) => {
            sanity(ctx, -1);
            return 'You feel her watching. -1 sanity.';
          }),
          choice('Strike her', 'A fight.', (ctx) => ({ message: 'Your blow passes through her.', fight: brawl(ctx, 'She screams.', ['specter']) })),
        ],
      },
      {
        text: 'A hanged man turns slowly on a gibbet by the road. His eyes follow you.',
        choices: [
          choice('Cut him down', '+3 sanity. 30%: he stands.', (ctx) => {
            sanity(ctx, 3);
            if (!ctx.dice.chance(0.3)) return 'You cut him down and bury him. +3 sanity.';
            return { message: 'You cut him down. He stands up. +3 sanity.', fight: brawl(ctx, 'The hanged man stands.', ['skeleton']) };
          }),
          choice('Take his boots', 'Leather Boots. -3 sanity.', (ctx) => {
            sanity(ctx, -3);
            return `${give(ctx, 'leatherBoots')}, still warm. -3 sanity.`;
          }),
          walkOn(),
        ],
      },
      {
        text: 'A knight in rotted plate kneels by the road, praying. Water runs from the visor.',
        choices: [
          choice('Kneel beside him', '+4 sanity.', (ctx) => {
            sanity(ctx, 4);
            return 'You pray together. When you look up, there is only rusted armour. +4 sanity.';
          }),
          choice('Challenge him', 'A fight.', (ctx) => ({ message: 'He rises and draws.', fight: brawl(ctx, 'The drowned knight.', ['skeleton', 'skeleton']) })),
          walkOn(),
        ],
      },
      {
        when: 'night',
        text: 'Someone calls your names from the marsh, in the voices of people you knew.',
        choices: [
          trial('Answer', 'int', 14, 'Pass: +3 sanity. Fail: a fight.',
            (ctx) => {
              sanity(ctx, 3);
              return 'You say goodbye. The voices stop. +3 sanity.';
            },
            (ctx) => ({ message: 'They come to meet you.', fight: brawl(ctx, 'Not the people you knew.', ['specter']) })),
          choice('Stop your ears and run', '-2 sanity.', (ctx) => {
            sanity(ctx, -2);
            return 'You run until the voices are gone. -2 sanity.';
          }),
        ],
      },
    ],
  },

  // ---- the red country ----------------------------------------------------------------
  {
    id: 'ash-vent',
    title: 'ASH VENT',
    zones: ['red', 'wilds'],
    sighted: true,
    variants: [
      {
        text: 'Red blossoms grow around a steaming vent.',
        choices: [
          choice('Pick the blossoms', '+1 Fireblossom. Take 1d3 damage.', (ctx) => {
            const burn = ctx.dice.die(3);
            hp(ctx, -burn);
            return `You gather ${give(ctx, 'herbFireblossom')}. -${burn} HP.`;
          }),
          walkOn(),
        ],
      },
      {
        text: 'A vent coughs ash every few breaths. Red crystals crust its lip.',
        choices: [
          trial('Time your grab', 'dex', 13, 'Pass: a Ruby. Fail: -3 HP.',
            (ctx) => `Between two breaths you prise loose ${give(ctx, 'gemRuby')}.`,
            (ctx) => `It breathes out as you reach in. ${hp(ctx, -3)} HP.`),
          walkOn(),
        ],
      },
      {
        when: 'night',
        text: 'Sparks rise from a vent and hang in the air, too slowly to be sparks.',
        choices: [
          choice('Watch them', '50%: +3 sanity. 50%: -3 sanity.', (ctx) =>
            omen(ctx, 'They dance, and it is beautiful.', 'They form a face. It looks at you.')),
          choice('Break them up', 'A fight.', (ctx) => ({
            message: 'The sparks gather into a shape.',
            fight: brawl(ctx, 'The vent wakes.', [ctx.depth >= 5 ? 'magma-sentinel' : 'sentinel']),
          })),
          walkOn(),
        ],
      },
      {
        text: 'The rocks round a sleeping vent are as warm as a hearth.',
        choices: [
          choice('Rest against them', '+20% of all. 20%: it wakes, -3 HP.', (ctx) => {
            restore(ctx, 0.2);
            if (!ctx.dice.chance(0.2)) return 'The warmth soaks into your bones. +20% HP, mana, sanity and charges.';
            return `The warmth soaks into your bones, until the vent wakes. +20% HP, mana, sanity and charges, then ${hp(ctx, -3)} HP.`;
          }),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'rockslide',
    title: 'ROCKSLIDE',
    zones: ['red', 'wilds', 'white'],
    sighted: true,
    variants: [
      {
        zones: ['red', 'wilds'],
        text: 'Fresh rubble blocks half the road. Ore glints in it.',
        choices: [
          trial('Dig', 'strength', 12, 'Pass: ore. Fail: -2 HP.',
            (ctx) => `You dig out ${give(ctx, ctx.dice.pick<ItemId>(['oreIron', 'oreCopper', 'oreCoal']))}.`,
            (ctx) => `A stone falls on you. ${hp(ctx, -2)} HP.`),
          walkOn(),
        ],
      },
      {
        text: "A slide has buried the road. Someone's {mule|handcart|pack} sticks out of the rubble.",
        choices: [
          trial('Dig it out', 'strength', 13, 'Pass: what it carried. Fail: -2 HP.',
            (ctx) => `You dig out ${giveFrom(ctx, ['healthPotion', 'pickaxe', 'arrow', oreOf(ctx)])}.`,
            (ctx) => `More rock slides down on you. ${hp(ctx, -2)} HP.`),
          walkOn('You climb over the rubble.', 'Climb over'),
        ],
      },
      {
        zones: ['red', 'wilds'],
        text: 'Stones rattle down the slope above you. {Something|Someone} is up there.',
        choices: [
          trial('Run through', 'dex', 12, 'Fail: -3 HP.',
            () => 'You dodge through the falling stones.',
            (ctx) => `A stone catches you square. ${hp(ctx, -3)} HP.`),
          choice('Climb up and look', 'A fight.', (ctx) => ({ message: 'You climb up.', fight: brawl(ctx, 'Kobolds were rolling the stones.', ['kobold', 'kobold']) })),
          choice('Wait it out', 'd6: 1-2 they come down to you.', (ctx) => {
            const face = ctx.dice.die(6);
            if (face > 2) return `Rolled ${face}. The stones stop after a while.`;
            return { message: `Rolled ${face}. They come down to see what they hit.`, fight: brawl(ctx, 'Kobolds with slings.', ['kobold', 'kobold']) };
          }),
        ],
      },
      {
        zones: ['red', 'wilds'],
        text: 'The slide has opened a cave mouth. Cold air breathes out of it.',
        choices: [
          choice('Go in', 'd20: 1-6 kobolds, 7-15 ore, 16+ a gem.', (ctx) => {
            const face = ctx.dice.die(20);
            if (face <= 6) return { message: `Rolled ${face}. Somebody already lives here.`, fight: brawl(ctx, 'Kobolds pour out.', ['kobold', 'kobold']) };
            if (face <= 15) return `Rolled ${face}. A seam near the mouth: ${give(ctx, oreOf(ctx))}.`;
            return `Rolled ${face}. Deeper in, a crystal pocket: ${give(ctx, gemOf(ctx))}.`;
          }),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'goat-path',
    title: 'GOAT PATH',
    zones: ['red', 'wilds'],
    variants: [
      {
        text: 'A narrow ledge cuts across the slope, well above the road.',
        choices: [
          trial('Take the ledge', 'dex', 13, 'Pass: Fireblossom. Fail: -3 HP.',
            (ctx) => `Halfway along you find ${give(ctx, 'herbFireblossom', ctx.dice.die(2))}.`,
            (ctx) => `You slide down the scree. ${hp(ctx, -3)} HP.`),
          walkOn(),
        ],
      },
      {
        title: 'MOUNTAIN GOATS',
        text: 'A herd of mountain goats blocks the path. The billy lowers its horns.',
        choices: [
          trial('Milk a nanny', 'dex', 13, 'Pass: 15% HP. Fail: -2 HP.',
            (ctx) => `Warm milk. +${mend(ctx, 0.15)} HP.`,
            (ctx) => `The billy has opinions. ${hp(ctx, -2)} HP.`),
          trial('Climb round them', 'dex', 11, 'Pass: Fireblossom. Fail: -1 HP.',
            (ctx) => `Up among the rocks you find ${give(ctx, 'herbFireblossom')}.`,
            (ctx) => `You skin your knees. ${hp(ctx, -1)} HP.`),
          walkOn('They wander off eventually.', 'Wait them out'),
        ],
      },
      {
        title: "EAGLE'S NEST",
        text: "A great eagle's nest sits on a crag above the path. Something glints in it.",
        choices: [
          trial('Climb up', 'dex', 14, 'Pass: a gem. Fail: -3 HP.',
            (ctx) => `Among the bones and twigs: ${give(ctx, gemOf(ctx))}.`,
            (ctx) => `The eagle comes home. ${hp(ctx, -3)} HP.`),
          walkOn(),
        ],
      },
      {
        title: 'HOT SPRING',
        text: 'Steam rises from a spring in the rocks below the path.',
        choices: [
          choice('Bathe', '+20% of all. 20%: a scalding surge, -2 HP.', (ctx) => {
            restore(ctx, 0.2);
            if (!ctx.dice.chance(0.2)) return 'Bliss. +20% HP, mana, sanity and charges.';
            return `Bliss, until a scalding surge. +20% HP, mana, sanity and charges, then ${hp(ctx, -2)} HP.`;
          }),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'duellist',
    title: 'A CHALLENGE',
    zones: ['capitol', 'lake', 'red', 'forest'],
    variants: [
      {
        zones: ['capitol'],
        text: 'A sellsword blocks the road and draws.',
        choices: [
          choice('Accept', 'Fight one Bandit Captain.', (ctx) => ({
            message: 'You accept.',
            fight: {
              encounter: 'monsters',
              depth: ctx.depth,
              spawns: [{ family: 'mine', spec: { kind: 'bandit-captain', level: Math.max(1, ctx.depth) } }],
              label: 'The sellsword salutes.',
            },
          })),
          choice('Decline', 'He lets you pass.', () => 'He sheathes his blade and lets you pass.'),
        ],
      },
      {
        text: 'A young {who:lord|lady} in shining mail blocks the road and demands a duel "to prove my worth".',
        choices: [
          choice('Accept', 'Fight one Bandit Captain.', (ctx) => ({ message: 'You accept.', fight: brawl(ctx, 'The {who} lowers a visor.', ['bandit-captain']) })),
          choice('Throw the fight', '-3 HP, +3 sanity. A gift.', (ctx) => {
            const lost = hp(ctx, -3);
            sanity(ctx, 3);
            return `You go down gracefully. The {who} is delighted and gives you ${giveFrom(ctx, ['copperRing', 'ironBand'])}. ${lost} HP, +3 sanity.`;
          }),
          choice('Decline', '-1 sanity.', (ctx) => {
            sanity(ctx, -1);
            return 'The {who} calls you a coward all the way down the road. -1 sanity.';
          }),
        ],
      },
      {
        text: 'A {who:hunter|poacher|archer} bets you cannot hit a crow at fifty paces.',
        choices: [
          trial('Take the shot', 'dex', 14, 'Pass: their arrows. Fail: -1 sanity.',
            (ctx) => `Feathers everywhere. The {who} pays up: ${give(ctx, 'arrow', 5 + ctx.dice.die(4))}.`,
            (ctx) => {
              sanity(ctx, -1);
              return 'The crow laughs at you. So does the {who}. -1 sanity.';
            }),
          walkOn('You decline.', 'Decline', 'Walk on.'),
        ],
      },
      {
        text: 'A {who:miller|smith|drover} built like a barn door will wrestle anyone for a jug of cider.',
        choices: [
          trial('Wrestle', 'strength', 14, 'Pass: 20% HP, +2 sanity. Fail: -3 HP.',
            (ctx) => comfort(ctx, 'The {who} hits the dirt. The cider is good.'),
            (ctx) => `You hit the dirt, hard. ${hp(ctx, -3)} HP.`),
          walkOn('You decline.', 'Decline', 'Walk on.'),
        ],
      },
    ],
  },

  // ---- the white desert ---------------------------------------------------------------
  {
    id: 'mirage',
    title: 'MIRAGE',
    zones: ['white'],
    variants: [
      {
        when: 'day',
        text: 'Water shimmers on the horizon where no water should be.',
        choices: [
          trial('Read the land', 'int', 13, 'Pass: a well, +6 HP. Fail: -3 HP, -2 sanity.',
            (ctx) => `Below the mirage, a real well. +${hp(ctx, 6)} HP.`,
            (ctx) => {
              sanity(ctx, -2);
              return `The water walks away as you walk toward it. ${hp(ctx, -3)} HP, -2 sanity.`;
            }),
          walkOn(),
        ],
      },
      {
        when: 'day',
        text: 'A white city floats above the dunes, its towers upside down.',
        choices: [
          trial('Walk toward it', 'int', 14, 'Pass: 25% HP. Fail: -3 HP, -2 sanity.',
            (ctx) => `You read the land under it and find an oasis. +${mend(ctx, 0.25)} HP.`,
            (ctx) => {
              sanity(ctx, -2);
              return `The city is always a mile further. ${hp(ctx, -3)} HP, -2 sanity.`;
            }),
          walkOn(),
        ],
      },
      {
        when: 'day',
        text: 'Figures in the heat haze walk alongside you, matching your pace.',
        choices: [
          choice('Call out to them', '50%: nomads share water. 50%: -2 sanity.', (ctx) => {
            if (ctx.dice.chance(0.5)) return `Nomads, and friendly. They share water. +${mend(ctx, 0.2)} HP.`;
            sanity(ctx, -2);
            return 'Nobody answers. When you look again, nobody is there. -2 sanity.';
          }),
          walkOn('You keep walking. So do they.', 'Keep walking'),
        ],
      },
      {
        when: 'night',
        text: 'Lights dance over the dunes after dark, always just ahead of you.',
        choices: [
          choice('Follow them', 'd6: 1-3 -3 sanity, 4-6 a find.', (ctx) => {
            const face = ctx.dice.die(6);
            if (face <= 3) {
              sanity(ctx, -3);
              return `Rolled ${face}. They lead you in circles until dawn. -3 sanity.`;
            }
            return `Rolled ${face}. They go out over a half-buried pack: ${giveFrom(ctx, ['arrow', 'manaPotion', gemOf(ctx)])}.`;
          }),
          trial('Mark the stars instead', 'int', 12, 'Pass: the land mapped. Fail: -2 sanity.',
            (ctx) => `You fix your bearings on the stars. ${mapped(survey(ctx, 4))}`,
            (ctx) => {
              sanity(ctx, -2);
              return 'The stars seem to move too. -2 sanity.';
            }),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'buried-ruin',
    title: 'BURIED RUIN',
    zones: ['white'],
    sighted: true,
    variants: [
      {
        text: 'The wind has uncovered the lintel of a stone doorway.',
        choices: [
          trial('Dig it out', 'strength', 13, 'Pass: grave goods. Fail: -3 HP.',
            (ctx) => {
              const goods = give(ctx, ctx.dice.pick<ItemId>(['copperRing', 'ironBand']));
              const gem = ctx.dice.chance(0.3) ? ` and ${give(ctx, 'gemDiamond')}` : '';
              return `An old tomb: ${goods}${gem}.`;
            },
            (ctx) => `The sand pours back in faster than you dig. ${hp(ctx, -3)} HP.`),
          walkOn(),
        ],
      },
      {
        title: 'STONE HEAD',
        text: 'A giant stone head stares out of the sand. Its eyes are set with coloured stones.',
        choices: [
          trial('Pry out an eye', 'strength', 14, 'Pass: a gem. Fail: -2 HP.',
            (ctx) => `It comes loose with a grinding pop: ${give(ctx, ctx.dice.pick<ItemId>(['gemRuby', 'gemSapphire']))}.`,
            (ctx) => `Your bar snaps and you fall off the nose. ${hp(ctx, -2)} HP.`),
          walkOn(),
        ],
      },
      {
        text: 'The sand has slumped into a buried stair. Cool air rises from below.',
        choices: [
          trial('Go down', 'dex', 13, 'Pass: a find. Fail: -3 HP.',
            (ctx) => `A dry chamber, one shelf unlooted: ${giveFrom(ctx, ['leatherCap', 'copperRing', 'gemDiamond', 'manaPotion'])}.`,
            (ctx) => `The stair gives way under you. ${hp(ctx, -3)} HP.`),
          walkOn(),
        ],
      },
      {
        text: 'A half-buried pillar is carved with a map of the stars{ and the land beneath them|}.',
        choices: [
          trial('Study it', 'int', 12, 'Pass: the land mapped, 20% mana.',
            (ctx) => `The carving matches the dunes around you. ${mapped(survey(ctx, 5))} +${mana(ctx, 0.2)} mana.`,
            () => 'The stars have moved since it was carved.'),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'pilgrims',
    title: 'PILGRIMS',
    zones: ['white', 'capitol'],
    sighted: true,
    variants: [
      {
        zones: ['white'],
        text: 'A line of white-robed pilgrims walks toward the Theocracy.',
        choices: [
          choice('Share your water', '-2 HP. They give you a Health Potion.', (ctx) => {
            const lost = hp(ctx, -2);
            return `They bless you in a language you do not know and give you ${give(ctx, 'healthPotion')}. ${lost} HP.`;
          }),
          choice('Ask for a blessing', '+3 sanity.', (ctx) => {
            sanity(ctx, 3);
            return 'An old pilgrim touches your brow. +3 sanity.';
          }),
          walkOn(),
        ],
      },
      {
        zones: ['capitol'],
        text: 'Flagellants whip themselves as they march, chanting the name of a saint.',
        choices: [
          choice('Join the chant', '+4 sanity, -2 HP.', (ctx) => {
            sanity(ctx, 4);
            return `You walk and chant with them a while. +4 sanity, ${hp(ctx, -2)} HP.`;
          }),
          choice('Give a Health Potion', 'Costs one Health Potion. +25% of all.', (ctx) => {
            takeAny(ctx, ['healthPotion']);
            restore(ctx, 0.25);
            return 'Their leader lays hands on each of you. +25% HP, mana, sanity and charges.';
          }, has('healthPotion')),
          walkOn(),
        ],
      },
      {
        text: 'A pilgrim has lost the column and asks the way to {the Theocracy|the Capitol|the next shrine}.',
        choices: [
          trial('Point the way', 'int', 10, 'Pass: +2 sanity. Fail: -1 sanity.',
            (ctx) => {
              sanity(ctx, 2);
              return 'You set them right. They bless you. +2 sanity.';
            },
            (ctx) => {
              sanity(ctx, -1);
              return 'You are fairly sure you set them wrong. -1 sanity.';
            }),
          walkOn(),
        ],
      },
      {
        zones: ['white'],
        when: 'day',
        text: 'A column of pilgrims has stopped in the sun. Several are sick with the heat.',
        choices: [
          choice('Share your water', '-2 HP, +3 sanity.', (ctx) => {
            sanity(ctx, 3);
            return `They drink and pray for you. ${hp(ctx, -2)} HP, +3 sanity.`;
          }),
          choice('Give a Health Potion', 'Costs one Health Potion. A gift.', (ctx) => {
            takeAny(ctx, ['healthPotion']);
            return `The eldest gives you ${giveFrom(ctx, ['copperRing', 'gemSapphire', 'gemAmethyst'])}.`;
          }, has('healthPotion')),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'oasis',
    title: 'OASIS',
    zones: ['white'],
    sighted: true,
    variants: [
      {
        text: 'Palm trees and a pool of clear water, right where the map says sand.',
        choices: [
          choice('Drink and rest', '+25% HP, mana, sanity and charges.', (ctx) => {
            restore(ctx, 0.25);
            return 'Shade, water and an hour off your feet. +25% HP, mana, sanity and charges.';
          }),
          choice('Fill up and move on', '10% HP.', (ctx) => `Cool water for the road. +${mend(ctx, 0.1)} HP.`),
        ],
      },
      {
        text: 'An oasis, but nomads have claimed it. They ask {five silver|a toll} to drink.',
        choices: [
          choice(`Pay ${moneyLabel(0.5)}`, '+25% HP, mana, sanity and charges.', (ctx) => {
            pay(ctx, 0.5);
            restore(ctx, 0.25);
            return 'They share dates too. +25% HP, mana, sanity and charges.';
          }, purse(0.5)),
          choice('Trade a herb', 'Costs one herb. +25% of all.', (ctx) => {
            takeAny(ctx, ALL_HERBS);
            restore(ctx, 0.25);
            return 'A fair trade, they say. +25% HP, mana, sanity and charges.';
          }, hasAny(ALL_HERBS)),
          walkOn(),
        ],
      },
      {
        text: 'The oasis has dried to a crust. A skeleton lies curled by the dead pool.',
        choices: [
          choice('Search the skeleton', 'A find.', (ctx) => `Under its arm: ${giveFrom(ctx, ['arrow', 'throwingDagger', 'crudeTrinket', gemOf(ctx)])}.`),
          trial('Dig for water', 'strength', 12, 'Pass: 15% HP. Fail: -2 HP.',
            (ctx) => `Damp sand, then a trickle. +${mend(ctx, 0.15)} HP.`,
            (ctx) => `Nothing but hot sand. ${hp(ctx, -2)} HP.`),
          walkOn(),
        ],
      },
      {
        when: 'night',
        text: 'An oasis under the stars. The water is black and perfectly still.',
        choices: [
          choice('Drink', '20% HP. 30%: -3 sanity.', (ctx) => {
            const healed = mend(ctx, 0.2);
            if (!ctx.dice.chance(0.3)) return `Cold and clean. +${healed} HP.`;
            sanity(ctx, -3);
            return `Cold and clean, but something looked back up at you. +${healed} HP, -3 sanity.`;
          }),
          walkOn(),
        ],
      },
    ],
  },
  {
    id: 'wormsign',
    title: 'WORMSIGN',
    zones: ['white'],
    variants: [
      {
        text: 'The sand ahead ripples against the wind, and something vast moves beneath it.',
        choices: WORM,
      },
      {
        when: 'night',
        text: 'Something vast slides under the dunes, glowing faintly through the sand.',
        choices: WORM,
      },
      {
        when: 'day',
        text: 'A dead sandworm lies half out of a dune, already drying in the sun.',
        choices: [
          trial('Cut it open', 'strength', 12, 'Pass: a gem. Fail: -2 HP.',
            (ctx) => `Its gizzard is full of stones, and one of them is ${give(ctx, ctx.dice.pick<ItemId>(['gemSapphire', 'gemDiamond', 'gemAmethyst']))}.`,
            (ctx) => `Its blood burns like acid. ${hp(ctx, -2)} HP.`),
          walkOn(),
        ],
      },
      {
        text: 'Ripples circle a little pool among the dunes. No birds come near the water.',
        choices: [
          trial('Drink quickly', 'dex', 13, 'Pass: 25% HP. Fail: -3 HP.',
            (ctx) => `You drink and are gone before the sand stirs. +${mend(ctx, 0.25)} HP.`,
            (ctx) => `The pool drains into a mouth and you throw yourself clear. ${hp(ctx, -3)} HP.`),
          walkOn(),
        ],
      },
    ],
  },
];

// ---- picking -----------------------------------------------------------------------

/** The variants of `event` that can turn up in `zone` at this hour; none when the event does not fit. */
export function variantsFor(event: RoadEvent, zone: EncounterZone, night?: boolean): EventVariant[] {
  if (event.zones && !event.zones.includes(zone)) return [];
  return event.variants.filter((variant) =>
    (!variant.zones || variant.zones.includes(zone)) && (night === undefined || !variant.when || (variant.when === 'night') === night));
}

/** Regional events turn up twice as often as those found anywhere, so a region reads as a place. */
const weightOf = (event: RoadEvent): number => (event.zones && event.zones.length <= 2 ? 2 : 1);

function draw(pool: readonly RoadEvent[], zone: EncounterZone, dice: Dice, night?: boolean): EventScene | null {
  const fits = pool.filter((event) => variantsFor(event, zone, night).length > 0);
  if (fits.length === 0) return null;
  let roll = dice.float() * fits.reduce((sum, event) => sum + weightOf(event), 0);
  let event = fits[fits.length - 1];
  for (const candidate of fits) {
    roll -= weightOf(candidate);
    if (roll < 0) {
      event = candidate;
      break;
    }
  }
  return stage(event, dice.pick(variantsFor(event, zone, night)), dice);
}

/** A roadside event that fits the zone and the hour, staged and ready to put to the party. */
export function pickEvent(zone: EncounterZone, dice: Dice, night?: boolean): EventScene {
  return draw(ROAD_EVENTS, zone, dice, night) ?? stage(ROAD_EVENTS[0], ROAD_EVENTS[0].variants[0], dice);
}

/** One that sits off the road, to be sighted and walked up to; null when none fits. */
export function pickSightedEvent(zone: EncounterZone, dice: Dice, night?: boolean): EventScene | null {
  return draw(ROAD_EVENTS.filter((event) => event.sighted), zone, dice, night);
}
