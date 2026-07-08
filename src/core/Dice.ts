// Deterministic-friendly dice roller. Pass a seed for reproducible games,
// or leave it undefined to use Math.random.

export interface RollResult {
  total: number;
  rolls: number[];
  modifier: number;
}

export class Dice {
  private next: () => number;

  constructor(seed?: number) {
    if (seed === undefined) {
      this.next = Math.random;
    } else {
      let s = seed >>> 0;
      this.next = () => {
        // Mulberry32 PRNG
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
  }

  /** Roll a single die with `sides` faces (1..sides). */
  die(sides: number): number {
    return Math.floor(this.next() * sides) + 1;
  }

  /** Raw float in [0, 1) from the underlying generator (for weighted rolls). */
  float(): number {
    return this.next();
  }

  /**
   * Roll a dice spec such as "2d6+1", "d20", "3d8-2" or "1d4".
   * Returns the total plus the individual rolls.
   */
  roll(spec: string): RollResult {
    const m = /^\s*(\d*)d(\d+)\s*([+-]\s*\d+)?\s*$/i.exec(spec);
    if (!m) {
      const flat = Number(spec);
      return { total: isNaN(flat) ? 0 : flat, rolls: [], modifier: 0 };
    }
    const count = m[1] ? parseInt(m[1], 10) : 1;
    const sides = parseInt(m[2], 10);
    const modifier = m[3] ? parseInt(m[3].replace(/\s+/g, ''), 10) : 0;
    const rolls: number[] = [];
    for (let i = 0; i < count; i++) rolls.push(this.die(sides));
    const total = rolls.reduce((a, b) => a + b, 0) + modifier;
    return { total, rolls, modifier };
  }

  /** Returns true with probability `p` (0..1). */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}
