// What the party thinks on a quiet stretch of the travel map, shown in a
// thought bubble over the token. Pure: the caller hands in the roll.

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

const IDLE = ['Nothing around to kill...', 'I might grow roots.', '*cool triple quadruple backflip*.', '*stares into the void with erotic intent*.'];
const DAY = ['Cover me in sunshine.', ' I hope the Empress of Light doesnt spawn right now...', 'The sun is blinding.'];
const NIGHT = ['Stars are out.', 'Cold tonight.', 'The cold never bothered me anyway.', 'Was that an owl?'];
const HURT = ['Need a rest.', 'Bleeding out :(', 'Need a heal.', 'Do you have Ibuprofen...?'];
const BLOODMOON = ['The moon looks red.', 'Blood for the Bloodmoon! >:D.', 'Moon has its period.'];
const STORM = ['Sand everywhere!', "Can't see a thing.", 'There is a Sand in my Boot!'];

const GROUND: Partial<Record<Terrain, readonly string[]>> = {
  road: ['Good road.', 'Cart tracks.'],
  bridge: ["Don't look down."],
  plains: ['Open country.', 'Nice breeze.'],
  forest: ['Smells of pine.', 'Mind the roots.'],
  hills: ['Uphill again...', 'Good view.'],
  swamp: ['Wet boots again.', 'Something stinks.'],
  ford: ['Cold water!'],
  sand: ['Sand in my boots.'],
  dunes: ['So hot...', 'Water...'],
  flats: ['Heat haze.'],
};

const LAND: Record<RegionId, readonly string[]> = {
  capitol: ['I think i left the stove on.'],
  forest: ['Deep woods.'],
  red: ['Smells of ash.'],
  black: ['Did I forget a torch..?.', '*You feel your sins crawling on your back.*.'],
  lake: ['Fish for lunch?'],
  white: ['So much sand.'],
};

const PACE: Partial<Record<TravelMode, readonly string[]>> = {
  sneak: ['Quiet now...', 'Keep low.'],
  explore: ["What's over there?"],
};

/** One short thought for a quiet stop: pressing worries first, else something about the road. */
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
