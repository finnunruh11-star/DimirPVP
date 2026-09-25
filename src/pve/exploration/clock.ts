// Time on the road. Travel and searching cost hours, a day turns over at
// midnight (shops restock, wild packs return), and night makes the road more
// dangerous for everyone except those sneaking. Pure: no Phaser, no RNG.

export const START_HOUR = 8;
export const WAKE_HOUR = 7;
const DAWN = 6;
const DUSK = 20;

export interface Clock {
  day: number;
  /** Hours into the current day, 0 <= hour < 24. */
  hour: number;
}

export function isNight(hour: number): boolean {
  return hour >= DUSK || hour < DAWN;
}

/** Move the clock on. Returns how many midnights passed. */
export function advanceHours(clock: Clock, hours: number): number {
  const total = clock.hour + Math.max(0, hours);
  const days = Math.floor(total / 24);
  clock.day += days;
  clock.hour = total - days * 24;
  return days;
}

/** A night's sleep: wake at seven, on the next day unless it is already past midnight. */
export function sleepUntilMorning(clock: Clock): void {
  if (clock.hour >= WAKE_HOUR) clock.day += 1;
  clock.hour = WAKE_HOUR;
}

/** "14:30", rounded to the quarter hour. */
export function clockTime(hour: number): string {
  const quarters = Math.round(hour * 4) % 96;
  const hh = Math.floor(quarters / 4);
  const mm = (quarters % 4) * 15;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function clockLabel(clock: Clock): string {
  return `Day ${clock.day}, ${clockTime(clock.hour)}${isNight(clock.hour) ? ' (night)' : ''}`;
}

/** "3.5 h" or "1 day 2 h" for trip estimates. */
export function durationLabel(hours: number): string {
  const rounded = Math.round(hours * 2) / 2;
  if (rounded < 24) return `${rounded} h`;
  const days = Math.floor(rounded / 24);
  const rest = Math.round(rounded - days * 24);
  return `${days} day${days > 1 ? 's' : ''}${rest ? ` ${rest} h` : ''}`;
}
