// What the turn of a day brings, for the card that announces it. Pure.

import { clockTime } from './clock';
import { stormOnDay } from './desert';
import { questJob } from './quest';
import type { ExplorationRun } from './run';

export function dayNews(run: ExplorationRun): string[] {
  const news = ['Shops restocked', 'New bounties posted', 'Beaten packs return'];
  const storm = stormOnDay(run, run.day);
  if (storm) news.push(`Sandstorm over the desert at ${clockTime(storm.start % 24)}`);
  if (questJob(run) && !run.quest.taken && run.quest.opens === run.day) news.push('Work at the Kerusai Lodge');
  return news;
}
