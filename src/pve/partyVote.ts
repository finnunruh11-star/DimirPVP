// Party votes (online Mines): every player picks, the leader counts and announces.

/** The party's pick: the most votes wins; a tie goes to `pick` among the tied, in the order they were first voted. */
export function tallyVotes(votes: Iterable<string>, pick: (tied: readonly string[]) => string = (tied) => tied[0]): string | null {
  const counts = new Map<string, number>();
  for (const vote of votes) counts.set(vote, (counts.get(vote) ?? 0) + 1);
  let best = 0;
  for (const count of counts.values()) best = Math.max(best, count);
  const tied = [...counts].filter(([, count]) => count === best).map(([choice]) => choice);
  if (tied.length === 0) return null;
  return tied.length === 1 ? tied[0] : pick(tied);
}
