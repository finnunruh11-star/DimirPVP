const STORAGE_KEY = 'dimir-dice';

/**
 * How damage dice are presented. Each mode is a complete presentation, not a
 * variation on one: see `DiceFieldView` for what each actually draws.
 */
export type DiceMode = 'none' | 'sequential' | 'anchored' | 'deal';

export const DICE_MODES: readonly DiceMode[] = ['deal', 'anchored', 'sequential', 'none'];

const LABELS: Record<DiceMode, string> = {
  deal: 'DEAL OUT',
  anchored: 'OVER HEADS',
  sequential: 'LEGACY',
  none: 'OFF',
};

const DEFAULT: DiceMode = 'deal';

function isMode(value: string | null): value is DiceMode {
  return value === 'none' || value === 'sequential' || value === 'anchored' || value === 'deal';
}

export function diceMode(): DiceMode {
  if (typeof window === 'undefined') return DEFAULT;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isMode(stored)) return stored;
  } catch {
    // Storage may be blocked; the default presentation is a safe fallback.
  }
  return DEFAULT;
}

export function setDiceMode(mode: DiceMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // A blocked preference store should never block gameplay.
  }
}

export function cycleDiceMode(direction: 1 | -1 = 1): DiceMode {
  const current = DICE_MODES.indexOf(diceMode());
  const next = (current + direction + DICE_MODES.length) % DICE_MODES.length;
  const mode = DICE_MODES[next];
  setDiceMode(mode);
  return mode;
}

export function diceModeLabel(mode: DiceMode = diceMode()): string {
  return LABELS[mode];
}

const TIMING_KEY = 'dimir-dice-timing';

/**
 * `during` rolls damage as each step of a spell resolves. `after` holds every
 * damage die until the spell has finished, then rolls the whole lot at once —
 * an uninterrupted resolution followed by one big handful of dice.
 */
export type DiceTiming = 'during' | 'after';

export function diceTiming(): DiceTiming {
  if (typeof window === 'undefined') return 'during';
  try {
    return window.localStorage.getItem(TIMING_KEY) === 'after' ? 'after' : 'during';
  } catch {
    return 'during';
  }
}

export function toggleDiceTiming(): DiceTiming {
  const next: DiceTiming = diceTiming() === 'after' ? 'during' : 'after';
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(TIMING_KEY, next);
    } catch {
      // A blocked preference store should never block gameplay.
    }
  }
  return next;
}

export function diceTimingLabel(timing: DiceTiming = diceTiming()): string {
  return timing === 'after' ? 'ALL AT THE END' : 'AS THEY HAPPEN';
}
