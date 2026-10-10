// What the party thinks on a quiet stretch of the travel map, shown in a
// thought bubble over the token. Jokes only. Pure: the caller hands in the roll.

import type { TravelMode } from './travel';
import type { RegionId, Terrain } from './world';

export interface ThoughtContext {
  zone: RegionId;
  terrain: Terrain;
  night: boolean;
  /** Walking through a sandstorm. */
  storm: boolean;
  /** The worst-off standing member's share of HP, 0..1. */
  health: number;
  /** Hours until the next bloodmoon rises. */
  bloodmoonIn: number;
  mode: TravelMode;
}

const IDLE = [
  'Nothing around to kill...',
  'This freddy guy has FIVE knights??.',
  '*cool triple quadruple backflip*',
  '*stares into the void with erotic intent*',
  'Reksussini Nussini?',
  'Zǎoshang hǎo zhōngguó xiànzài wǒ yǒu BING CHILLING 🥶🍦 wǒ hěn xǐhuān BING CHILLING 🥶🍦.',
  'This is just a game to you isnt it?',
];
const DAY = ['Cover me in sunshine.', "Hope the Empress of Light doesn't spawn...", 'Heatdeath of the Universe. April 9th 2045'];
const NIGHT = ['The cold never bothered me anyway.', 'Was that an owl? Please be an owl. I LOVE owls', 'Who turned off the sun?'];
const HURT = ['Bleeding out :(', 'Do you have Ibuprofen...?', "'Tis but a scratch.", 'Is my blood supposed to be outside my body?'];
const BLOODMOON = ['Blood for the Bloodmoon! >:D', 'Moon has its period.', 'The moon is giving me the eye.'];
const STORM = ['There is a Sand in my Boot!', "I don't like sand. It gets everywhere.", 'I am 40% sand now.'];

const GROUND: Partial<Record<Terrain, readonly string[]>> = {
  road: ['Cause if I dont WALK, then I get caught out.'],
  bridge: ["Don't look down... I looked down."],
  plains: ['Grass. Riveting stuff.'],
  forest: ['Every tree looks exactly like that tree. Weird.'],
  hills: ['Uphill. Both ways. Somehow.'],
  swamp: ['Something in the swamp winked at me. I kinda liked it....', 'Wet boots again. Love that for me.'],
  ford: ['Wet socks: the true enemy.'],
  sand: ['Sand in my boots. Sand in my soul.'],
  dunes: ['So hot... and not the good kind.'],
  flats: ['Is that a lake? That is not a lake.'],
};

const LAND: Record<RegionId, readonly string[]> = {
  capitol: ['I cannot help but feel this town may be an anagram somehow.'],
  forest: ['Pretty sure that bush is watching me.'],
  red: ['Who left the volcano on?'],
  black: ['Did I forget a torch...?', '*You feel your sins crawling on your back.*'],
  lake: ['BABY SHARK DODODODO.'],
  white: ['Sand. As far as the eye can sand.'],
};

const PACE: Partial<Record<TravelMode, readonly string[]>> = {
  sneak: ['Sneaky sneaky.', '*tiptoes menacingly*'],
  explore: ["Ooh, what's that? Oh. A rock."],
};

/** One short joke for a quiet stop: pressing worries first, else something about the road. */
export function restThought(ctx: ThoughtContext, roll: () => number): string {
  const pick = (list: readonly string[]): string => list[Math.floor(roll() * list.length)] ?? '...';
  if (ctx.bloodmoonIn <= 12 && roll() < 0.7) return pick(BLOODMOON);
  if (ctx.health < 0.35 && roll() < 0.7) return pick(HURT);
  if (ctx.storm && roll() < 0.7) return pick(STORM);
  return pick([
    ...IDLE,
    ...(ctx.night ? NIGHT : DAY),
    ...(GROUND[ctx.terrain] ?? []),
    ...LAND[ctx.zone],
    ...(PACE[ctx.mode] ?? []),
  ]);
}
