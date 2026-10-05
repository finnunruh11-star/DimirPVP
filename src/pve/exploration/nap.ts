// A night's rest as the party lived it: from when to when, and whether the
// bloodmoon woke it. The host tells its guests, so everyone sleeps the same
// night. Pure: no Phaser.

export interface NapTime {
  day: number;
  hour: number;
}

export interface RestNap {
  from: NapTime;
  to: NapTime;
  /** The bloodmoon rose and woke the party. */
  bloodmoon: boolean;
  /** What the night gave back. */
  message: string;
}

export function napHours(nap: RestNap): number {
  return (nap.to.day - nap.from.day) * 24 + nap.to.hour - nap.from.hour;
}

function napTime(value: unknown): NapTime | null {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const day = raw?.day;
  const hour = raw?.hour;
  if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 1_000_000) return null;
  if (typeof hour !== 'number' || !Number.isFinite(hour) || hour < 0 || hour >= 24) return null;
  return { day, hour };
}

/** A night as the host sent it, read as hostile input. */
export function parseRestNap(value: unknown): RestNap | null {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const from = napTime(raw?.from);
  const to = napTime(raw?.to);
  if (!raw || !from || !to) return null;
  const nap: RestNap = { from, to, bloodmoon: raw.bloodmoon === true, message: typeof raw.message === 'string' ? raw.message.slice(0, 240) : '' };
  const hours = napHours(nap);
  return hours > 0 && hours <= 24 ? nap : null;
}
