// Soft light drawn once into canvas textures and filtered smoothly, so glows,
// beams and the sun keep their falloff when scaled up under pixel-art settings.

import Phaser from 'phaser';

export const GLOW = {
  soft: 'fx-glow-soft',
  rays: 'fx-glow-rays',
  horizon: 'fx-glow-horizon',
  beam: 'fx-glow-beam',
  vignette: 'fx-glow-vignette',
  sun: 'fx-glow-sun',
  moon: 'fx-glow-moon',
  print: 'fx-glow-print',
} as const;

function paint(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
  smooth = true,
): void {
  if (scene.textures.exists(key)) return;
  const texture = scene.textures.createCanvas(key, width, height);
  const ctx = texture?.getContext();
  if (!texture || !ctx) return;
  draw(ctx);
  texture.refresh();
  if (smooth) texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
}

function radial(ctx: CanvasRenderingContext2D, x: number, y: number, r0: number, r1: number, stops: [number, string][]): CanvasGradient {
  const gradient = ctx.createRadialGradient(x, y, r0, x, y, r1);
  for (const [at, color] of stops) gradient.addColorStop(at, color);
  return gradient;
}

export function ensureGlowTextures(scene: Phaser.Scene): void {
  paint(scene, GLOW.soft, 128, 128, (ctx) => {
    ctx.fillStyle = radial(ctx, 64, 64, 0, 64, [
      [0, 'rgba(255,255,255,1)'], [0.22, 'rgba(255,255,255,0.72)'], [0.5, 'rgba(255,255,255,0.26)'],
      [0.78, 'rgba(255,255,255,0.06)'], [1, 'rgba(255,255,255,0)'],
    ]);
    ctx.fillRect(0, 0, 128, 128);
  });

  // God rays of uneven width, fading out from the centre.
  paint(scene, GLOW.rays, 512, 512, (ctx) => {
    const c = 256;
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2 + ((i * 37) % 11) * 0.012;
      const half = 0.022 + ((i * 53) % 7) * 0.007;
      const reach = 180 + ((i * 29) % 5) * 19;
      ctx.fillStyle = radial(ctx, c, c, 0, reach, [
        [0, 'rgba(255,255,255,0.9)'], [0.35, 'rgba(255,255,255,0.4)'], [1, 'rgba(255,255,255,0)'],
      ]);
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, reach, angle - half, angle + half);
      ctx.closePath();
      ctx.fill();
    }
  });

  paint(scene, GLOW.horizon, 512, 32, (ctx) => {
    const across = ctx.createLinearGradient(0, 0, 512, 0);
    across.addColorStop(0, 'rgba(255,255,255,0)');
    across.addColorStop(0.5, 'rgba(255,255,255,1)');
    across.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = across;
    ctx.fillRect(0, 0, 512, 32);
    ctx.globalCompositeOperation = 'destination-in';
    const down = ctx.createLinearGradient(0, 0, 0, 32);
    down.addColorStop(0, 'rgba(0,0,0,0)');
    down.addColorStop(0.5, 'rgba(0,0,0,1)');
    down.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = down;
    ctx.fillRect(0, 0, 512, 32);
    ctx.globalCompositeOperation = 'source-over';
  });

  // A shaft of light, brightest where it meets the ground.
  paint(scene, GLOW.beam, 32, 128, (ctx) => {
    const across = ctx.createLinearGradient(0, 0, 32, 0);
    across.addColorStop(0, 'rgba(255,255,255,0)');
    across.addColorStop(0.5, 'rgba(255,255,255,1)');
    across.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = across;
    ctx.fillRect(0, 0, 32, 128);
    ctx.globalCompositeOperation = 'destination-in';
    const up = ctx.createLinearGradient(0, 0, 0, 128);
    up.addColorStop(0, 'rgba(0,0,0,0)');
    up.addColorStop(0.7, 'rgba(0,0,0,0.55)');
    up.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = up;
    ctx.fillRect(0, 0, 32, 128);
    ctx.globalCompositeOperation = 'source-over';
  });

  paint(scene, GLOW.vignette, 256, 256, (ctx) => {
    ctx.fillStyle = radial(ctx, 128, 128, 40, 181, [
      [0, 'rgba(0,0,0,0)'], [0.45, 'rgba(0,0,0,0.12)'], [0.8, 'rgba(0,0,0,0.58)'], [1, 'rgba(0,0,0,0.9)'],
    ]);
    ctx.fillRect(0, 0, 256, 256);
  });

  paint(scene, GLOW.sun, 128, 128, (ctx) => {
    ctx.fillStyle = radial(ctx, 64, 64, 16, 64, [
      [0, 'rgba(255,220,130,0.9)'], [0.35, 'rgba(255,176,72,0.38)'], [1, 'rgba(255,140,40,0)'],
    ]);
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = radial(ctx, 58, 58, 2, 26, [[0, '#fffef6'], [0.55, '#ffeaa6'], [1, '#ffbd50']]);
    ctx.beginPath();
    ctx.arc(64, 64, 26, 0, Math.PI * 2);
    ctx.fill();
  });

  // A crescent with its dark side faintly lit.
  paint(scene, GLOW.moon, 128, 128, (ctx) => {
    ctx.fillStyle = radial(ctx, 64, 64, 14, 64, [
      [0, 'rgba(200,216,255,0.7)'], [0.4, 'rgba(150,176,255,0.25)'], [1, 'rgba(120,150,255,0)'],
    ]);
    ctx.fillRect(0, 0, 128, 128);
    ctx.save();
    ctx.beginPath();
    ctx.arc(64, 64, 23, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = radial(ctx, 56, 58, 2, 26, [[0, '#ffffff'], [0.6, '#e4eaff'], [1, '#b9c6ec']]);
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = 'rgba(150,164,206,0.4)';
    for (const [x, y, r] of [[54, 70, 4], [66, 56, 3], [58, 52, 2], [70, 74, 2.5]]) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(16,22,52,0.86)';
    ctx.beginPath();
    ctx.arc(76, 56, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  paint(scene, GLOW.print, 6, 4, (ctx) => {
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.fillRect(1, 0, 4, 4);
    ctx.fillRect(0, 1, 6, 2);
  }, false);
}
