// Bosses drawn from authored sprite sheets instead of painted in code. Every
// strip is a grid of equal frames facing left, the body centred and the feet on
// `ground` (built by scripts/shade-queen-sheets.ts). Pure: no Phaser.

export interface AuthoredStrip {
  frames: number;
  rate: number;
}

export interface AuthoredBoss {
  w: number;
  h: number;
  ground: number;
  /** Screen pixels to one sheet pixel in the arena. */
  pixel: number;
  /** Frames to a row of each strip's grid. */
  columns: number;
  /** One strip per arena animation (idle, walk, attack, hurt, death), and any more it has. */
  strips: Record<string, AuthoredStrip>;
  /** Strips played in turn, one per strike. */
  attacks: readonly string[];
  /** A strip played in place of an idle loop after every `every` loops. */
  special?: { strip: string; every: number };
  /** Its spell, and the frame at which the spell takes effect. */
  cast?: { strip: string; peak: number };
}

export const AUTHORED_BOSSES: Readonly<Record<string, AuthoredBoss>> = {
  lillith: {
    w: 152,
    h: 130,
    ground: 117,
    pixel: 2,
    columns: 12,
    strips: {
      idle: { frames: 20, rate: 10 },
      walk: { frames: 14, rate: 16 },
      attack: { frames: 16, rate: 24 },
      stab: { frames: 16, rate: 24 },
      combo: { frames: 20, rate: 24 },
      hurt: { frames: 11, rate: 20 },
      death: { frames: 30, rate: 18 },
      taunt: { frames: 52, rate: 16 },
      chant: { frames: 37, rate: 20 },
    },
    attacks: ['attack', 'stab', 'combo'],
    special: { strip: 'taunt', every: 4 },
    cast: { strip: 'chant', peak: 22 },
  },
};
