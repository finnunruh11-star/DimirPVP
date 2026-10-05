// Pixel art for what lies at a site off the road: a patch of each herb, a
// chest, a stash sack. Painted into a PixelBuffer and outlined in ink so it
// reads against any ground.

import type Phaser from 'phaser';
import type { SecretLook } from '../pve/exploration/locales';
import { bufferTexture } from './localeRender';
import { PixelBuffer, type Palette } from './pixels';

const INK = 0x120d09;

interface Art {
  rows: readonly string[];
  palette: Palette;
}

const HERB_ART: Record<string, Art> = {
  herbMoonglow: {
    palette: { g: 0x355636, G: 0x5f8f55, l: 0xa9c9dc, L: 0xe4f1f8, w: 0xffffff, y: 0xf2e39a },
    rows: [
      '......w.......',
      '.....wyw..w...',
      '......w..wyw..',
      '..l...L...w...',
      '.lLl.lLl..l...',
      '..lGl.l.lLl...',
      '...GllGllGl...',
      '..lGGlGGlG.l..',
      '.llgGGgGGgGll.',
      '..gggGgGggg...',
      '...gg.g.gg....',
    ],
  },
  herbDeathweed: {
    palette: { d: 0x2e2234, p: 0x6a3a7a, P: 0xa070c0, t: 0x5a5060, g: 0x3a3a2a, G: 0x55503a },
    rows: [
      '.......P......',
      '......PpP.....',
      '..P....p...P..',
      '.PpP..tpt.PpP.',
      '..p..t.p.t.p..',
      '..pt.dtpd.tp..',
      '..dpddpdpddp..',
      '.gdpdtdpdtdpg.',
      '..gGgGgGgGgG..',
      '...gg.g.g.gg..',
    ],
  },
  herbWaterleaf: {
    palette: { b: 0x2f6fc0, B: 0x6fb0f0, w: 0xd8f0ff, g: 0x2f5a4a, G: 0x4f8a6a },
    rows: [
      '....B....B....',
      '...BbB..BbB...',
      '..BbwbB.BwbB..',
      '...BbB..BbB...',
      '....b.BB.b....',
      '....g.BbB.g...',
      '...ggBbwbBgg..',
      '..gGgGbBgGgG..',
      '...gggGgGggg..',
      '....gg.g.gg...',
    ],
  },
  herbFireblossom: {
    palette: { r: 0xa8321e, o: 0xf07a2a, y: 0xffd35a, g: 0x4a5a2a, G: 0x6c7c34, d: 0x4a3222 },
    rows: [
      '......y.......',
      '.....yoy...y..',
      '..y...o...yoy.',
      '.yoy..r....o..',
      '..o..rGr...r..',
      '..r.rGgGr.rGr.',
      '..GrGg.gGrGg..',
      '.gGgGg.gGgGg..',
      '..dddddddddd..',
      '...dddddddd...',
    ],
  },
};

const LOOK_ART: Record<Exclude<SecretLook, 'herb' | 'trinket'>, Art> = {
  cache: {
    palette: { w: 0x6b4424, W: 0x8d5c30, d: 0x3e2412, b: 0xc9a95a, B: 0x8a6e32, k: INK },
    rows: [
      '..dddddddddd..',
      '.dWWWWWWWWWWd.',
      '.dWwwwwwwwwWd.',
      '.bbbbbBBbbbbb.',
      '.dwwwwbkbwwwd.',
      '.dwWwwbBbwwWd.',
      '.dwwwwwwwwwwd.',
      '.bbbbbbbbbbbb.',
      '.dwwwwwwwwwwd.',
      '.dddddddddddd.',
    ],
  },
  stash: {
    palette: { s: 0xb89a68, S: 0xd4b882, d: 0x8a7048, r: 0x6b4a2a },
    rows: [
      '.....rr.....',
      '....r..r....',
      '.....rr.....',
      '....ssss....',
      '...sSSsss...',
      '..sSSssssd..',
      '.sSSsssssdd.',
      '.sSssssssdd.',
      '.ssssssssdd.',
      '..sssssddd..',
      '...dddddd...',
    ],
  },
};

function paint(scene: Phaser.Scene, key: string, art: Art): string {
  if (scene.textures.exists(key)) return key;
  const width = Math.max(...art.rows.map((row) => row.length)) + 2;
  const px = new PixelBuffer(width, art.rows.length + 2);
  px.blit(art.rows, art.palette, 1, 1);
  px.outline(INK);
  return bufferTexture(scene, key, px);
}

/** The texture for a site thing, or null when it wears the plain glint. */
export function siteTexture(scene: Phaser.Scene, look: SecretLook, herb?: string): string | null {
  if (look === 'trinket') return null;
  if (look === 'herb') return paint(scene, `site-herb-${herb ?? 'herbMoonglow'}`, HERB_ART[herb ?? ''] ?? HERB_ART.herbMoonglow);
  return paint(scene, `site-${look}`, LOOK_ART[look]);
}

const HERB_DEBRIS: Record<string, number> = {
  herbMoonglow: 0xe4f1f8,
  herbWaterleaf: 0x6fb0f0,
  herbDeathweed: 0xa070c0,
  herbFireblossom: 0xf07a2a,
};

/** The colour the leaves or splinters fly off in when it is taken. */
export function siteDebris(look: SecretLook, herb?: string): number {
  if (look === 'herb') return HERB_DEBRIS[herb ?? ''] ?? 0x9ec7a0;
  if (look === 'cache') return 0x8d5c30;
  if (look === 'stash') return 0xd4b882;
  return 0xffe08a;
}
