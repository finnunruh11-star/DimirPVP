// Light for the dark of the Mines: soft brushes the delve view erases out of
// its darkness (and tints over it). Drawn once into canvas textures and filtered
// smoothly, like the glows in glowTextures.ts.

import Phaser from 'phaser';

export const MINE_LIGHT = {
  /** A pool of light, bright to well past half its radius. */
  round: 'mine-light-round',
  /** A cone thrown ahead of its bearer, who stands at (BEAM_ORIGIN, 0.5). */
  beam: 'mine-light-beam',
} as const;

/** Where the beam's bearer stands in its texture, as fractions of its size. */
export const MINE_BEAM_ORIGIN = { x: 40 / 512, y: 0.5 } as const;
/** How far the beam reaches in its own texture pixels. */
export const MINE_BEAM_REACH = 460;
/** The round brush's radius in its own texture pixels. */
export const MINE_ROUND_RADIUS = 128;

function paint(scene: Phaser.Scene, key: string, width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): void {
  if (scene.textures.exists(key)) return;
  const texture = scene.textures.createCanvas(key, width, height);
  const ctx = texture?.getContext();
  if (!texture || !ctx) return;
  draw(ctx);
  texture.refresh();
  texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
}

export function ensureMineLightTextures(scene: Phaser.Scene): void {
  paint(scene, MINE_LIGHT.round, 256, 256, (ctx) => {
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, MINE_ROUND_RADIUS);
    for (const [at, alpha] of [[0, 1], [0.4, 0.97], [0.6, 0.72], [0.76, 0.38], [0.9, 0.11], [1, 0]]) {
      gradient.addColorStop(at, `rgba(255,255,255,${alpha})`);
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
  });

  // Four nested wedges added together: full light down the middle of the cone,
  // fading towards its edges and with distance.
  paint(scene, MINE_LIGHT.beam, 512, 320, (ctx) => {
    const x = 512 * MINE_BEAM_ORIGIN.x;
    const y = 160;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, MINE_BEAM_REACH);
    for (const [at, alpha] of [[0, 1], [0.3, 0.92], [0.55, 0.55], [0.78, 0.18], [1, 0]]) {
      gradient.addColorStop(at, `rgba(255,255,255,${alpha})`);
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = gradient;
    for (const degrees of [13, 19, 25, 31]) {
      const half = (degrees * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, MINE_BEAM_REACH, -half, half);
      ctx.closePath();
      ctx.fill();
    }
  });
}
