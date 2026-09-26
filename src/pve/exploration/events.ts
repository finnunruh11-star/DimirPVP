// Roadside events: a short scene and a choice. Every roll comes from the run's
// seeded dice for that step, so a reload replays the same outcome.

import type { Dice } from '../../core/Dice';
import { getItem, type ItemId } from '../../core/Items';
import { mineEnemyLevel } from '../minerun';
import { grantToMage, money, partyOf, withParty } from './economy';
import type { EncounterSpawn, EncounterZone } from './encounters';
import type { ExplorationRun } from './run';

export interface EventContext {
  run: ExplorationRun;
  zone: EncounterZone;
  depth: number;
  dice: Dice;
}

export interface EventFight {
  encounter: 'robbery' | 'monsters';
  depth: number;
  spawns?: EncounterSpawn[];
  label?: string;
}

export interface EventOutcome {
  message: string;
  fight?: EventFight;
  levels?: number;
}

export interface EventChoice {
  label: string;
  detail: string;
  available?: (ctx: EventContext) => boolean;
  resolve: (ctx: EventContext) => EventOutcome;
}

export interface RoadEvent {
  id: string;
  zones?: EncounterZone[];
  title: string;
  text: string;
  choices: EventChoice[];
}

// ---- helpers ----------------------------------------------------------------

/** Change the leader's HP by a flat amount; roadside harm never kills. */
const hp = (ctx: EventContext, delta: number): number =>
  withParty(ctx.run, (leader) => {
    const before = leader.hp;
    leader.hp = Math.max(1, Math.min(leader.maxHp, leader.hp + delta));
    return leader.hp - before;
  });

const sanity = (ctx: EventContext, delta: number): void => {
  withParty(ctx.run, (leader) => {
    leader.sanity = Math.max(1, Math.min(leader.maxSanity, leader.sanity + delta));
  });
};

const give = (ctx: EventContext, id: ItemId, count = 1): string => {
  withParty(ctx.run, (leader) => {
    for (let i = 0; i < count; i++) grantToMage(leader, id);
  });
  return `${count > 1 ? `${count}x ` : ''}${getItem(id).name}`;
};

type CheckStat = 'strength' | 'dex' | 'int';

/** d20 + stat against a DC. */
const check = (ctx: EventContext, stat: CheckStat, dc: number): { pass: boolean; total: number } => {
  const leader = partyOf(ctx.run)[0];
  const bonus = !leader ? 0 : stat === 'strength' ? leader.statStrength : stat === 'dex' ? leader.statDex : leader.statInt;
  const total = ctx.dice.die(20) + bonus;
  return { pass: total >= dc, total };
};

const hasItem = (ctx: EventContext, id: ItemId): boolean => {
  const leader = partyOf(ctx.run)[0];
  return !!leader && (leader.utility.includes(id) || leader.bag.includes(id));
};

/** Heal the leader by a share of max HP. */
const mend = (ctx: EventContext, share: number): number => hp(ctx, Math.ceil((partyOf(ctx.run)[0]?.maxHp ?? 0) * share));

const leave: EventChoice = { label: 'Walk on', detail: 'Leave it be.', resolve: () => ({ message: 'You walk on.' }) };

// ---- the events -------------------------------------------------------------

export const ROAD_EVENTS: RoadEvent[] = [
  {
    id: 'carter',
    title: 'STUCK CART',
    text: 'A carter is stuck to the axles in a rut.',
    choices: [
      {
        label: 'Heave it free',
        detail: 'Strength check, DC 12. Pass: a meal, 20% HP.',
        resolve: (ctx) => {
          const roll = check(ctx, 'strength', 12);
          if (!roll.pass) return { message: `Rolled ${roll.total}. The cart slips back onto your foot. ${hp(ctx, -2)} HP.` };
          return { message: `Rolled ${roll.total}. The cart rolls free and the carter shares his food. +${mend(ctx, 0.2)} HP.` };
        },
      },
      leave,
    ],
  },
  {
    id: 'shrine',
    title: 'ROADSIDE SHRINE',
    text: 'A weathered shrine with a bowl of copper offerings.',
    choices: [
      {
        label: 'Pray',
        detail: 'Restore 25% of max HP.',
        resolve: (ctx) => ({ message: `You pray. +${mend(ctx, 0.25)} HP.` }),
      },
      {
        label: 'Take the offerings',
        detail: 'A trinket. 50%: -3 sanity.',
        resolve: (ctx) => {
          const found = give(ctx, 'crudeTrinket');
          if (ctx.dice.chance(0.5)) {
            sanity(ctx, -3);
            return { message: `You take ${found}. Something watches you leave. -3 sanity.` };
          }
          return { message: `You take ${found}.` };
        },
      },
      leave,
    ],
  },
  {
    id: 'wounded',
    title: 'WOUNDED TRAVELLER',
    text: 'A traveller sits against a milestone, bleeding.',
    choices: [
      {
        label: 'Give a Health Potion',
        detail: 'Costs one Health Potion. He gives you a piece of his kit.',
        available: (ctx) => hasItem(ctx, 'healthPotion'),
        resolve: (ctx) => {
          withParty(ctx.run, (leader) => {
            const index = leader.utility.indexOf('healthPotion');
            if (index >= 0) leader.utility.splice(index, 1);
          });
          const kit = give(ctx, ctx.dice.pick<ItemId>(['copperRing', 'ironBand', 'leatherCap', 'leatherBoots']));
          return { message: `The traveller recovers and presses ${kit} on you.` };
        },
      },
      leave,
    ],
  },
  {
    id: 'toll',
    zones: ['capitol', 'red'],
    title: 'TOLL BARRICADE',
    text: 'Armed men have strung a chain across the road.',
    choices: [
      {
        label: 'Pay 3g',
        detail: 'Pass without trouble.',
        available: (ctx) => ctx.run.gold >= 3,
        resolve: (ctx) => {
          ctx.run.gold = money(ctx.run.gold - 3);
          return { message: 'You pay. The chain drops.' };
        },
      },
      {
        label: 'Slip around',
        detail: 'Dex check, DC 13. Fail: fight.',
        resolve: (ctx) => {
          const roll = check(ctx, 'dex', 13);
          if (roll.pass) return { message: `Rolled ${roll.total}. You pass unseen.` };
          return {
            message: `Rolled ${roll.total}. They spot you.`,
            fight: { encounter: 'robbery', depth: ctx.depth },
          };
        },
      },
      {
        label: 'Refuse',
        detail: 'Fight the toll-men.',
        resolve: (ctx) => ({ message: 'You refuse.', fight: { encounter: 'monsters', depth: ctx.depth, spawns: [
          { family: 'mine', spec: { kind: 'bandit', level: 1 } },
          { family: 'mine', spec: { kind: 'bandit', level: 1 } },
        ], label: 'The toll-men draw steel.' } }),
      },
    ],
  },
  {
    id: 'camp',
    title: 'ABANDONED CAMP',
    text: 'A cold fire and a torn tent beside the road.',
    choices: [
      {
        label: 'Search it',
        detail: 'd20: 1-5 ambush, 6-15 odds and ends, 16-20 supplies.',
        resolve: (ctx) => {
          const face = ctx.dice.die(20);
          if (face <= 5) {
            return { message: `Rolled ${face}. The owners come back.`, fight: { encounter: 'robbery', depth: ctx.depth } };
          }
          if (face <= 15) {
            const odd = ctx.dice.pick<ItemId>(['herbMoonleaf', 'arrow', 'torch']);
            return { message: `Rolled ${face}. You find ${give(ctx, odd, odd === 'arrow' ? 1 + ctx.dice.die(3) : 1)}.` };
          }
          const item = ctx.dice.pick<ItemId>(['healthPotion', 'manaPotion', 'gemAmethyst', 'throwingDagger']);
          return { message: `Rolled ${face}. You find ${give(ctx, item)}.` };
        },
      },
      leave,
    ],
  },
  {
    id: 'caravan',
    title: 'MERCHANT CARAVAN',
    text: 'A caravan rests at the roadside.',
    choices: [
      {
        label: 'Buy a Health Potion (3g)',
        detail: 'Cheaper than town.',
        available: (ctx) => ctx.run.gold >= 3,
        resolve: (ctx) => {
          ctx.run.gold = money(ctx.run.gold - 3);
          return { message: `You buy ${give(ctx, 'healthPotion')}.` };
        },
      },
      {
        label: 'Guard the caravan',
        detail: 'A Health Potion now, then a fight one depth deeper.',
        resolve: (ctx) => ({
          message: `The merchant pays in kind: ${give(ctx, 'healthPotion')}. Raiders arrive at dusk.`,
          fight: { encounter: 'monsters', depth: ctx.depth + 1, label: 'Raiders fall on the caravan.' },
        }),
      },
      leave,
    ],
  },
  {
    id: 'herbs',
    zones: ['capitol', 'black', 'forest', 'lake'],
    title: 'HERB PATCH',
    text: 'Pale leaves grow thick in the ditch.',
    choices: [
      {
        label: 'Gather',
        detail: '1-2 herbs.',
        resolve: (ctx) => {
          const herb: ItemId = ctx.zone === 'black' || ctx.zone === 'forest' ? 'herbBogcap' : 'herbMoonleaf';
          return { message: `You gather ${give(ctx, herb, ctx.dice.die(2))}.` };
        },
      },
      leave,
    ],
  },
  {
    id: 'mire-lights',
    zones: ['black', 'forest'],
    title: 'MIRE LIGHTS',
    text: 'Blue lights drift over the bog, away from the road.',
    choices: [
      {
        label: 'Follow them',
        detail: 'Int check, DC 13. Pass: a gem. Fail: wisps.',
        resolve: (ctx) => {
          const roll = check(ctx, 'int', 13);
          if (roll.pass) return { message: `Rolled ${roll.total}. The lights lead to ${give(ctx, 'gemOnyx')}.` };
          return {
            message: `Rolled ${roll.total}. The lights turn on you.`,
            fight: { encounter: 'monsters', depth: ctx.depth, spawns: [
              { family: 'swamp', kind: 'wisp' },
              { family: 'swamp', kind: 'wisp' },
            ], label: 'The lights were wisps.' },
          };
        },
      },
      leave,
    ],
  },
  {
    id: 'ash-vent',
    zones: ['red', 'wilds'],
    title: 'ASH VENT',
    text: 'Red roots grow around a steaming vent.',
    choices: [
      {
        label: 'Pull the roots',
        detail: '+1 Emberroot. Take 1d3 damage.',
        resolve: (ctx) => {
          const burn = ctx.dice.die(3);
          hp(ctx, -burn);
          return { message: `You gather ${give(ctx, 'herbEmberroot')}. -${burn} HP.` };
        },
      },
      leave,
    ],
  },
  {
    id: 'bones',
    zones: ['black'],
    title: 'OLD BONES',
    text: 'A skeleton in rusted mail lies half-sunk in the mud.',
    choices: [
      {
        label: 'Bury it',
        detail: '+3 sanity.',
        resolve: (ctx) => {
          sanity(ctx, 3);
          return { message: 'You bury the bones. Something is set at rest. +3 sanity.' };
        },
      },
      {
        label: 'Search it',
        detail: 'A rusted blade. 30%: it rises.',
        resolve: (ctx) => {
          const found = give(ctx, 'throwingDagger');
          if (!ctx.dice.chance(0.3)) return { message: `You pull out ${found}.` };
          return {
            message: `You pull out ${found}. The bones stand up.`,
            fight: { encounter: 'monsters', depth: ctx.depth, spawns: [{ family: 'swamp', kind: 'skeleton' }] },
          };
        },
      },
      leave,
    ],
  },
  {
    id: 'rockslide',
    zones: ['red', 'wilds'],
    title: 'ROCKSLIDE',
    text: 'Fresh rubble blocks half the road. Ore glints in it.',
    choices: [
      {
        label: 'Dig',
        detail: 'Strength check, DC 12. Pass: ore. Fail: -2 HP.',
        resolve: (ctx) => {
          const roll = check(ctx, 'strength', 12);
          if (!roll.pass) return { message: `Rolled ${roll.total}. A stone falls on you. ${hp(ctx, -2)} HP.` };
          const ore = ctx.dice.pick<ItemId>(['oreIron', 'oreCopper', 'oreCoal']);
          return { message: `Rolled ${roll.total}. You dig out ${give(ctx, ore)}.` };
        },
      },
      leave,
    ],
  },
  {
    id: 'duellist',
    zones: ['capitol'],
    title: 'A CHALLENGE',
    text: 'A sellsword blocks the road and draws.',
    choices: [
      {
        label: 'Accept',
        detail: 'Fight one Bandit Captain.',
        resolve: (ctx) => ({
          message: 'You accept.',
          fight: {
            encounter: 'monsters',
            depth: ctx.depth,
            spawns: [{ family: 'mine', spec: { kind: 'bandit-captain', level: Math.max(1, ctx.depth) } }],
            label: 'The sellsword salutes.',
          },
        }),
      },
      {
        label: 'Decline',
        detail: 'He lets you pass.',
        resolve: () => ({ message: 'He sheathes his blade and lets you pass.' }),
      },
    ],
  },
  {
    id: 'wreck',
    zones: ['lake'],
    title: 'SHIPWRECK',
    text: 'A fishing boat has run aground in the shallows, its hold half full of water.',
    choices: [
      {
        label: 'Search the hull',
        detail: 'Dex check, DC 11. Pass: salvage, maybe a sapphire. Fail: -2 HP.',
        resolve: (ctx) => {
          const roll = check(ctx, 'dex', 11);
          if (!roll.pass) return { message: `Rolled ${roll.total}. A rotten plank gives way under you. ${hp(ctx, -2)} HP.` };
          const found = ctx.dice.chance(0.35) ? give(ctx, 'gemSapphire') : give(ctx, 'throwingDagger');
          return { message: `Rolled ${roll.total}. You find ${found}.` };
        },
      },
      leave,
    ],
  },
  {
    id: 'nets',
    zones: ['lake'],
    title: 'HEAVY NETS',
    text: 'A fisherman is struggling to haul a full net up the beach.',
    choices: [
      {
        label: 'Lend a hand',
        detail: 'Strength check, DC 11. Pass: a share of the catch, 20% HP.',
        resolve: (ctx) => {
          const roll = check(ctx, 'strength', 11);
          if (!roll.pass) return { message: `Rolled ${roll.total}. The net slips back into the water. He thanks you anyway.` };
          return { message: `Rolled ${roll.total}. The catch comes in and he cooks you a share. +${mend(ctx, 0.2)} HP.` };
        },
      },
      leave,
    ],
  },
  {
    id: 'hermit',
    zones: ['forest'],
    title: 'FOREST HERMIT',
    text: 'An old woman in a moss-grown hut offers to read your road ahead.',
    choices: [
      {
        label: 'Listen',
        detail: 'A Mana Potion, -2 sanity.',
        resolve: (ctx) => {
          sanity(ctx, -2);
          return { message: `What she tells you is not comforting. She sends you off with ${give(ctx, 'manaPotion')}. -2 sanity.` };
        },
      },
      {
        label: 'Trade for herbs (2g)',
        detail: 'Two Moonleaf.',
        available: (ctx) => ctx.run.gold >= 2,
        resolve: (ctx) => {
          ctx.run.gold = money(ctx.run.gold - 2);
          return { message: `She wraps up ${give(ctx, 'herbMoonleaf', 2)}.` };
        },
      },
      leave,
    ],
  },
  {
    id: 'goat-path',
    zones: ['red'],
    title: 'GOAT PATH',
    text: 'A narrow ledge cuts across the slope, well above the road.',
    choices: [
      {
        label: 'Take the ledge',
        detail: 'Dex check, DC 13. Pass: Emberroot. Fail: -3 HP.',
        resolve: (ctx) => {
          const roll = check(ctx, 'dex', 13);
          if (!roll.pass) return { message: `Rolled ${roll.total}. You slide down the scree. ${hp(ctx, -3)} HP.` };
          return { message: `Rolled ${roll.total}. Halfway along you find ${give(ctx, 'herbEmberroot', ctx.dice.die(2))}.` };
        },
      },
      leave,
    ],
  },
  {
    id: 'mirage',
    zones: ['white'],
    title: 'MIRAGE',
    text: 'Water shimmers on the horizon where no water should be.',
    choices: [
      {
        label: 'Read the land',
        detail: 'Int check, DC 13. Pass: a real well, +6 HP. Fail: -3 HP, -2 sanity.',
        resolve: (ctx) => {
          const roll = check(ctx, 'int', 13);
          if (!roll.pass) {
            sanity(ctx, -2);
            return { message: `Rolled ${roll.total}. The water walks away as you walk toward it. ${hp(ctx, -3)} HP, -2 sanity.` };
          }
          return { message: `Rolled ${roll.total}. Below the mirage, a real well. +${hp(ctx, 6)} HP.` };
        },
      },
      leave,
    ],
  },
  {
    id: 'buried-ruin',
    zones: ['white'],
    title: 'BURIED RUIN',
    text: 'The wind has uncovered the lintel of a stone doorway.',
    choices: [
      {
        label: 'Dig it out',
        detail: 'Strength check, DC 13. Pass: grave goods, maybe a diamond. Fail: -3 HP.',
        resolve: (ctx) => {
          const roll = check(ctx, 'strength', 13);
          if (!roll.pass) return { message: `Rolled ${roll.total}. The sand pours back in faster than you dig. ${hp(ctx, -3)} HP.` };
          const goods = give(ctx, ctx.dice.pick<ItemId>(['copperRing', 'ironBand']));
          const gem = ctx.dice.chance(0.3) ? ` and ${give(ctx, 'gemDiamond')}` : '';
          return { message: `Rolled ${roll.total}. An old tomb: ${goods}${gem}.` };
        },
      },
      leave,
    ],
  },
  {
    id: 'pilgrims',
    zones: ['white'],
    title: 'PILGRIMS',
    text: 'A line of white-robed pilgrims walks toward the Theocracy.',
    choices: [
      {
        label: 'Share your water',
        detail: '-2 HP. They give you a Health Potion.',
        resolve: (ctx) => {
          const lost = hp(ctx, -2);
          return { message: `They bless you in a language you do not know and give you ${give(ctx, 'healthPotion')}. ${lost} HP.` };
        },
      },
      {
        label: 'Ask for a blessing',
        detail: '+3 sanity.',
        resolve: (ctx) => {
          sanity(ctx, 3);
          return { message: 'An old pilgrim touches your brow. +3 sanity.' };
        },
      },
      leave,
    ],
  },
  {
    id: 'wormsign',
    zones: ['white'],
    title: 'WORMSIGN',
    text: 'The sand ahead ripples against the wind, and something vast moves beneath it.',
    choices: [
      {
        label: 'Stand perfectly still',
        detail: 'Dex check, DC 12. Pass: it passes. Fail: it surfaces.',
        resolve: (ctx) => {
          const roll = check(ctx, 'dex', 12);
          if (roll.pass) return { message: `Rolled ${roll.total}. The ripple passes beneath your feet and fades.` };
          return { message: `Rolled ${roll.total}. The sand opens.`, fight: wormFight(ctx) };
        },
      },
      {
        label: 'Run for the rocks',
        detail: 'Dex check, DC 14. Fail: -4 HP.',
        resolve: (ctx) => {
          const roll = check(ctx, 'dex', 14);
          if (roll.pass) return { message: `Rolled ${roll.total}. You reach solid rock as the dune behind you collapses.` };
          return { message: `Rolled ${roll.total}. The ground heaves and throws you. ${hp(ctx, -4)} HP.` };
        },
      },
      {
        label: 'Stand and fight',
        detail: 'A Sandworm.',
        resolve: (ctx) => ({ message: 'You plant your feet. The sand opens.', fight: wormFight(ctx) }),
      },
    ],
  },
];

function wormFight(ctx: EventContext): EventFight {
  const depth = Math.max(6, ctx.depth);
  return {
    encounter: 'monsters',
    depth,
    spawns: [{ family: 'mine', spec: { kind: 'sandworm', level: mineEnemyLevel(depth) } }],
    label: 'A Sandworm breaks the surface.',
  };
}

/** Pick a road event that fits the zone. */
export function pickEvent(zone: EncounterZone, dice: Dice): RoadEvent {
  const fits = ROAD_EVENTS.filter((event) => !event.zones || event.zones.includes(zone));
  return dice.pick(fits);
}
