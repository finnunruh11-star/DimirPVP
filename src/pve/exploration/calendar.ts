// What the turn of a day brings, for the card that announces it. Pure.

import { clockTime } from './clock';
import { stormOnDay } from './desert';
import { questJob } from './quest';
import { mineCycle } from './mines';
import type { ExplorationRun } from './run';

export function dayNews(run: ExplorationRun): string[] {
  const news = ['Shops restocked', 'New bounties posted', 'Beaten packs return'];
  if (mineCycle(run.day) > mineCycle(run.day - 1)) news.push('Bloodmoon: the Mines have shifted');
  const storm = stormOnDay(run, run.day);
  if (storm) news.push(`Sandstorm over the desert at ${clockTime(storm.start % 24)}`);
  if (questJob(run) && !run.quest.taken && run.quest.opens === run.day) news.push('Work at the Kerusai Lodge');
  return news;
}
