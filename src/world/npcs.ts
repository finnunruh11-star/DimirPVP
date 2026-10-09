// Shopkeepers, drawn in the same 16px outlined style as the player's mage.
// One body, recoloured per trade, with a head piece that says what they sell.

import { PixelBuffer, type Palette } from './pixels';
import type { KeeperLook } from '../pve/exploration/shops';

/** Rows 0-4 come from the head piece. */
const BODY: readonly string[] = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '....ksessesk....',
  '....kssssssk....',
  '.....kssssk.....',
  '....kttttttk....',
  '...kttaaaattk...',
  '...ksaaaaaask...',
  '...kkaaaaaakk...',
  '....kaaaaaak....',
  '....kppkkppk....',
  '....kppkkppk....',
  '....kbbkkbbk....',
];

const HEADS = {
  hood: ['................', '......kkkk......', '.....khhhhk.....', '....khhhhhhk....', '....khsssshk....'],
  hair: ['................', '................', '.....kkkkkk.....', '....khhhhhhk....', '....khsssshk....'],
  cap: ['................', '................', '.....kkkkkk.....', '...kkhhhhhhkk...', '....kssssssk....'],
  helm: ['................', '......kkkk......', '.....khhhhk.....', '....khhhhhhk....', '....kwsssswk....'],
  bald: ['................', '................', '......kkkk......', '.....kssssk.....', '....kssssssk....'],
  hat: ['.......kk.......', '......khhk......', '.....khhhhk.....', '...kkhhhhhhkk...', '....kssssssk....'],
} as const satisfies Record<string, readonly string[]>;

interface Look {
  head: keyof typeof HEADS;
  hair: number;
  skin: number;
  top: number;
  apron: number;
  pants: number;
  boots: number;
  eyes?: number;
  trim?: number;
}

const LOOKS: Record<KeeperLook, Look> = {
  guildmaster: { head: 'hair', hair: 0x9a9aa4, skin: 0xe0b48f, top: 0x2f4f86, apron: 0xc9a64a, pants: 0x4a3b30, boots: 0x2a211b },
  alchemist: { head: 'hood', hair: 0x3f7a4a, skin: 0xe8c2a0, top: 0x3f7a4a, apron: 0xe9e1cf, pants: 0x3b3446, boots: 0x2a211b },
  smith: { head: 'bald', hair: 0x6b3f22, skin: 0xc98f66, top: 0xc98f66, apron: 0x5a3a24, pants: 0x3a3a42, boots: 0x1f1a16 },
  armorer: { head: 'helm', hair: 0xa9adb5, skin: 0xe0b48f, top: 0x8a8f96, apron: 0x3f5f96, pants: 0x4a4f58, boots: 0x2a2a30, trim: 0xd9dde3 },
  jeweller: { head: 'hat', hair: 0x7a3f8a, skin: 0xf0cda8, top: 0x7a3f8a, apron: 0xe7c24a, pants: 0x3b2f45, boots: 0x2a211b },
  gemcutter: { head: 'cap', hair: 0x2f8a8a, skin: 0xe0b48f, top: 0x2f6f7a, apron: 0xc9ccd1, pants: 0x3a3a42, boots: 0x2a211b, eyes: 0x7fe0f0 },
  fence: { head: 'hood', hair: 0x3b2f45, skin: 0xd8a882, top: 0x3b2f45, apron: 0x6a4a6e, pants: 0x2a2530, boots: 0x16131a, eyes: 0xe7c24a },
  forgemaster: { head: 'hair', hair: 0xb8482a, skin: 0xc98f66, top: 0x3a3a42, apron: 0xb0602e, pants: 0x2a2a30, boots: 0x16131a },
  hunter: { head: 'hood', hair: 0x4a5a2a, skin: 0xd8a882, top: 0x5a6a34, apron: 0x7a5a3a, pants: 0x3a3226, boots: 0x2a211b },
  herbalist: { head: 'hat', hair: 0xb8a060, skin: 0xe8c2a0, top: 0x6a8a4a, apron: 0xd8cba8, pants: 0x4a3b30, boots: 0x2a211b },
  miner: { head: 'cap', hair: 0x8a6a2a, skin: 0xc98f66, top: 0x6a5a4a, apron: 0x4a4f58, pants: 0x3a3a42, boots: 0x1f1a16 },
  pearler: { head: 'hair', hair: 0xe8e0d0, skin: 0xc98f66, top: 0x2f7a8a, apron: 0xe6f0f4, pants: 0x2a3a42, boots: 0x1f1a16 },
  nomad: { head: 'hood', hair: 0xb89a6a, skin: 0xc98f66, top: 0xb89a6a, apron: 0x6a5a3a, pants: 0x5a4a34, boots: 0x2a211b, eyes: 0x3f6fe0 },
  priest: { head: 'hat', hair: 0xf0ead8, skin: 0xe0b48f, top: 0xf0ead8, apron: 0xe7c24a, pants: 0xd8cfb8, boots: 0x6a5a3a },
  scribe: { head: 'hood', hair: 0x4a3a7a, skin: 0xe8c2a0, top: 0x4a3a7a, apron: 0xe9dfc8, pants: 0x2a2530, boots: 0x16131a, eyes: 0xb98bff },
};

const OUTLINE = 0x16171a;

/** Two frames side by side (32x16): standing, and breathing in. */
export function keeperPixels(look: KeeperLook): PixelBuffer {
  const spec = LOOKS[look];
  const palette: Palette = {
    k: OUTLINE,
    s: spec.skin,
    e: spec.eyes ?? OUTLINE,
    h: spec.hair,
    t: spec.top,
    a: spec.apron,
    p: spec.pants,
    b: spec.boots,
    w: spec.trim ?? 0xd9dde3,
  };
  const rows = [...HEADS[spec.head], ...BODY.slice(5)];
  const px = new PixelBuffer(32, 16);
  px.blit(rows, palette, 0, 0);
  // Breathing: everything above the belt rises by one pixel.
  const inhale = [...rows.slice(1, 12), rows[11], ...rows.slice(12)];
  px.blit(inhale, palette, 16, 0);
  return px;
}

export const KEEPER_LOOKS = Object.keys(LOOKS) as KeeperLook[];
