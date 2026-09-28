// A quiet stop on the travel map: nothing happens, so the party takes a break.
// A little scene plays beside the token under a small "Taking a break" plate:
// an apple tossed and caught, a pot of tea on three stones, forty winks, birds
// going over, the map unfolded, boots off, a tune, stones skipped on water.
// Presentation only: every roll here is Math.random.

import Phaser from 'phaser';
import { playSound } from '../audio';
import { MENU_COLOR, MENU_FONT, MENU_HEX } from '../ui/cabinet/theme';
import type { ParticleFx } from './ParticleFx';

type Point = { x: number; y: number };

export interface BreakSetting {
  /** Water beside the party: stones can be skipped. */
  water?: boolean;
  night?: boolean;
}

interface Kit {
  scene: Phaser.Scene;
  token: Phaser.GameObjects.Sprite;
  particles: ParticleFx;
  depth: number;
  /** -1 when the party faces left. */
  side: number;
  track<T extends Phaser.GameObjects.GameObject>(object: T): T;
}

interface Vignette {
  caption: string;
  play(kit: Kit): Promise<void>;
  day?: boolean;
  water?: boolean;
}

const INK = 0x120d09;

function tween(scene: Phaser.Scene, config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
  return new Promise((resolve) => {
    scene.tweens.add({ ...config, onComplete: () => resolve() });
  });
}

function wait(scene: Phaser.Scene, ms: number): Promise<void> {
  return new Promise((resolve) => scene.time.delayedCall(ms, () => resolve()));
}

const rand = (min: number, max: number): number => min + Math.random() * (max - min);

// ---------------------------------------------------------------------------
//  THE SCENES
// ---------------------------------------------------------------------------

const snack: Vignette = {
  caption: 'An apple each',
  async play(kit) {
    const { scene, token } = kit;
    const hand = { x: token.x + kit.side * 9, y: token.y - 16 };
    const apple = kit.track(scene.add.container(hand.x, hand.y).setDepth(kit.depth).setScale(0));
    const g = scene.add.graphics();
    g.fillStyle(0x6e1814, 1).fillCircle(0.6, 0.8, 5.4);
    g.fillStyle(0xc8352b, 1).fillCircle(0, 0, 5);
    g.fillStyle(0xf08a6c, 1).fillCircle(-1.8, -1.8, 1.5);
    g.fillStyle(0x4a2e14, 1).fillRect(-0.6, -7, 1.4, 3);
    g.fillStyle(0x6fae45, 1).fillEllipse(2.6, -6.2, 4.4, 2.2);
    apple.add(g);
    await tween(scene, { targets: apple, scale: 1, duration: 160, ease: 'Back.Out' });
    for (let i = 0; i < 3; i++) {
      const height = 24 + i * 5;
      await tween(scene, { targets: apple, y: hand.y - height, angle: apple.angle + 180, duration: 250, ease: 'Quad.Out' });
      await tween(scene, { targets: apple, y: hand.y, angle: apple.angle + 180, duration: 230, ease: 'Quad.In' });
    }
    kit.particles.burst(hand, { color: 0xf6e3c0, count: 6, speed: 46, lifespan: 420, size: 5, gravityY: 140, angle: { min: 200, max: 340 }, depth: kit.depth });
    await tween(scene, { targets: apple, scale: 0.55, alpha: 0, duration: 260, ease: 'Sine.In' });
  },
};

const tea: Vignette = {
  caption: 'A pot of tea',
  async play(kit) {
    const { scene, token } = kit;
    const at = { x: token.x + kit.side * 22, y: token.y + 8 };
    const pot = kit.track(scene.add.container(at.x, at.y).setDepth(kit.depth - 0.1).setScale(0));
    const g = scene.add.graphics();
    for (const [x, y] of [[-6, 2], [6, 2], [0, 4]]) {
      g.fillStyle(0x3a3530, 1).fillEllipse(x, y + 0.8, 6, 3.5);
      g.fillStyle(0x7d766c, 1).fillEllipse(x, y, 5.5, 3);
    }
    g.fillStyle(0x1c1a18, 1).fillEllipse(0, -5, 15, 11);
    g.fillStyle(0x3b3733, 1).fillEllipse(-1, -6, 13, 9);
    g.fillStyle(0x1c1a18, 1).fillRect(-7, -12, 14, 3);
    g.fillStyle(0x9a8f80, 1).fillRect(-1.5, -14, 3, 2);
    g.lineStyle(2, 0x1c1a18, 1).lineBetween(6, -7, 11, -11);
    for (const x of [-15, 15]) {
      g.fillStyle(MENU_COLOR.boneDim, 1).fillRect(x - 2.5, -3, 5, 5);
      g.fillStyle(0x6b4a2a, 1).fillRect(x - 1.5, -3, 3, 1.2);
    }
    pot.add(g);
    await tween(scene, { targets: pot, scale: 1, duration: 220, ease: 'Back.Out' });
    playSound('travel.rest');
    const puffs = scene.time.addEvent({
      delay: 170,
      repeat: 7,
      callback: () => kit.particles.burst({ x: at.x + 11, y: at.y - 12 }, {
        shape: 'smoke', color: 0xefeae0, count: 1, speed: 14, lifespan: 900, size: 11, alpha: 0.5,
        angle: { min: 255, max: 285 }, gravityY: -18, depth: kit.depth,
      }),
    });
    await wait(scene, 1400);
    puffs.remove(false);
    await tween(scene, { targets: pot, alpha: 0, scale: 0.8, duration: 240, ease: 'Sine.In' });
  },
};

const nap: Vignette = {
  caption: 'Forty winks',
  async play(kit) {
    const { scene, token } = kit;
    const pace = token.anims.timeScale;
    token.anims.timeScale = 0.3;
    for (let i = 0; i < 4; i++) {
      const z = kit.track(scene.add.text(token.x + kit.side * 6, token.y - 30, i % 2 ? 'Z' : 'z', {
        fontFamily: MENU_FONT.display,
        fontSize: i % 2 ? '17px' : '13px',
        fontStyle: 'bold',
        color: '#e8dcff',
        stroke: '#120d09',
        strokeThickness: 3,
      }).setOrigin(0.5).setDepth(kit.depth).setAlpha(0).setScale(0.6));
      void tween(scene, {
        targets: z,
        y: z.y - 34,
        x: z.x + kit.side * rand(10, 16),
        alpha: { from: 1, to: 0 },
        scale: 1.25,
        duration: 1100,
        ease: 'Sine.Out',
      });
      await wait(scene, 360);
    }
    await wait(scene, 380);
    token.anims.timeScale = pace;
  },
};

const birds: Vignette = {
  caption: 'Watching the birds',
  day: true,
  async play(kit) {
    const { scene, token } = kit;
    const cam = scene.cameras.main;
    const from = kit.side > 0 ? cam.worldView.left - 30 : cam.worldView.right + 30;
    const to = kit.side > 0 ? cam.worldView.right + 30 : cam.worldView.left - 30;
    const y = token.y - rand(70, 95);
    const flights: Promise<void>[] = [];
    const count = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const lag = Math.ceil(i / 2) * 18;
      const bird = kit.track(scene.add.graphics({ x: from - Math.sign(to - from) * lag, y: y + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 9 }).setDepth(kit.depth + 0.2));
      bird.lineStyle(2, INK, 0.9).beginPath();
      bird.moveTo(-5, -2).lineTo(0, 1).lineTo(5, -2).strokePath();
      scene.tweens.add({ targets: bird, scaleY: -0.4, duration: 150 + i * 7, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      scene.tweens.add({ targets: bird, y: bird.y - 6, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      flights.push(tween(scene, { targets: bird, x: to - Math.sign(to - from) * lag, duration: 1900, ease: 'Linear' }));
    }
    await Promise.all(flights);
  },
};

const mapCheck: Vignette = {
  caption: 'Checking the way',
  async play(kit) {
    const { scene, token } = kit;
    const sheet = kit.track(scene.add.container(token.x, token.y - 44).setDepth(kit.depth + 0.1).setScale(0, 1));
    const g = scene.add.graphics();
    g.fillStyle(INK, 1).fillRect(-25, -16, 52, 34);
    g.fillStyle(MENU_COLOR.bone, 1).fillRect(-26, -17, 52, 34);
    g.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(-25.5, -16.5, 51, 33);
    g.lineStyle(1, 0xb9a882, 1).lineBetween(-9, -17, -9, 17).lineBetween(8, -17, 8, 17);
    g.fillStyle(0x8fae8a, 0.9).fillEllipse(-15, 6, 12, 7);
    g.fillStyle(0x7fa4c4, 0.9).fillEllipse(16, -8, 10, 6);
    const trail = scene.add.graphics();
    const mark = scene.add.text(17, 7, 'X', { fontFamily: MENU_FONT.display, fontSize: '14px', fontStyle: 'bold', color: '#b3372d' })
      .setOrigin(0.5).setScale(0);
    sheet.add([g, trail, mark]);
    await tween(scene, { targets: sheet, scaleX: 1, duration: 240, ease: 'Cubic.Out' });
    const path: Point[] = [{ x: -20, y: -8 }, { x: -12, y: -3 }, { x: -4, y: -7 }, { x: 3, y: 0 }, { x: 10, y: 3 }, { x: 16, y: 6 }];
    const progress = { t: 0 };
    await tween(scene, {
      targets: progress,
      t: 1,
      duration: 700,
      ease: 'Sine.InOut',
      onUpdate: () => {
        trail.clear();
        const reach = progress.t * (path.length - 1);
        for (let i = 0; i < Math.floor(reach); i++) {
          if (i % 2) continue;
          trail.lineStyle(1.5, 0x8a2e24, 1).lineBetween(path[i].x, path[i].y, path[i + 1].x, path[i + 1].y);
        }
      },
    });
    playSound('ui.click');
    await tween(scene, { targets: mark, scale: 1, duration: 200, ease: 'Back.Out' });
    await wait(scene, 420);
    await tween(scene, { targets: sheet, scaleX: 0, duration: 200, ease: 'Cubic.In' });
  },
};

const boots: Vignette = {
  caption: 'Boots off, for a moment',
  async play(kit) {
    const { scene, token } = kit;
    const feet = { x: token.x + kit.side * 4, y: token.y + 4 };
    const boot = kit.track(scene.add.container(feet.x, feet.y).setDepth(kit.depth - 0.1));
    const g = scene.add.graphics();
    g.fillStyle(INK, 1).fillRect(-3, -9, 6, 10);
    g.fillStyle(0x5d3b1f, 1).fillRect(-2.5, -9, 5, 9).fillRect(kit.side > 0 ? -2.5 : -5.5, -2, 8, 3);
    g.fillStyle(0x8a6036, 1).fillRect(-2.5, -9, 5, 2);
    boot.add(g);
    const land = { x: feet.x + kit.side * 28, y: feet.y + 3 };
    void tween(scene, { targets: boot, angle: kit.side * 300, duration: 520, ease: 'Cubic.Out' });
    await tween(scene, { targets: boot, x: land.x, duration: 520, ease: 'Sine.Out' });
    kit.particles.burst(land, { shape: 'smoke', color: 0xcdb88c, count: 3, speed: 22, lifespan: 480, size: 10, alpha: 0.45, depth: kit.depth - 0.2 });
    const sigh = kit.track(scene.add.text(token.x - kit.side * 4, token.y - 32, 'ahh...', {
      fontFamily: MENU_FONT.body,
      fontSize: '13px',
      fontStyle: 'italic',
      color: MENU_HEX.bone,
      stroke: '#120d09',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(kit.depth).setAlpha(0));
    await tween(scene, { targets: sigh, alpha: 1, y: sigh.y - 6, duration: 240, ease: 'Sine.Out' });
    await wait(scene, 620);
    void tween(scene, { targets: sigh, alpha: 0, duration: 240 });
    await tween(scene, { targets: boot, x: feet.x, y: feet.y, angle: 0, alpha: 0.2, duration: 380, ease: 'Sine.InOut' });
  },
};

const tune: Vignette = {
  caption: 'Humming a tune',
  async play(kit) {
    const { scene, token } = kit;
    for (let i = 0; i < 5; i++) {
      const note = kit.track(scene.add.text(token.x + kit.side * 5, token.y - 28, i % 2 ? '\u266B' : '\u266A', {
        fontFamily: 'Georgia, serif',
        fontSize: i % 2 ? '17px' : '14px',
        color: MENU_HEX.brassLight,
        stroke: '#120d09',
        strokeThickness: 3,
      }).setOrigin(0.5).setDepth(kit.depth).setAlpha(0));
      const sway = kit.side * rand(8, 18);
      void tween(scene, { targets: note, y: note.y - 38, alpha: { from: 1, to: 0 }, duration: 1200, ease: 'Sine.Out' });
      void tween(scene, { targets: note, x: note.x + sway, angle: rand(-18, 18), duration: 600, yoyo: true, ease: 'Sine.InOut' });
      await wait(scene, 280);
    }
    await wait(scene, 700);
  },
};

const stones: Vignette = {
  caption: 'Skipping stones',
  water: true,
  async play(kit) {
    const { scene, token } = kit;
    const pebble = kit.track(scene.add.graphics({ x: token.x + kit.side * 8, y: token.y - 8 }).setDepth(kit.depth));
    pebble.fillStyle(INK, 1).fillEllipse(0, 0.8, 6, 4);
    pebble.fillStyle(0xa8a39a, 1).fillEllipse(0, 0, 5.5, 3.5);
    const ground = token.y + 6;
    let x = pebble.x;
    for (const [step, lift] of [[30, 18], [24, 11], [18, 7], [12, 4]]) {
      x += kit.side * step;
      const top = Math.min(pebble.y, ground) - lift;
      await tween(scene, { targets: pebble, x: x - kit.side * step / 2, y: top, duration: 140, ease: 'Quad.Out' });
      await tween(scene, { targets: pebble, x, y: ground, duration: 140, ease: 'Quad.In' });
      const ripple = kit.track(scene.add.graphics({ x, y: ground + 1 }).setDepth(kit.depth - 0.3));
      ripple.lineStyle(1.5, 0xe8f2f6, 0.9).strokeEllipse(0, 0, 12, 5);
      ripple.setScale(0.4);
      void tween(scene, { targets: ripple, scale: 1.8, alpha: 0, duration: 620, ease: 'Sine.Out' });
    }
    await tween(scene, { targets: pebble, alpha: 0, duration: 200 });
    await wait(scene, 300);
  },
};

const VIGNETTES: readonly Vignette[] = [snack, tea, nap, birds, mapCheck, boots, tune, stones];

// ---------------------------------------------------------------------------
//  THE PLATE
// ---------------------------------------------------------------------------

function plate(scene: Phaser.Scene, at: Point, caption: string, depth: number): Phaser.GameObjects.Container {
  const root = scene.add.container(at.x, at.y).setDepth(depth + 0.5);
  const title = scene.add.text(0, -8, 'TAKING A BREAK', {
    fontFamily: MENU_FONT.control,
    fontSize: '11px',
    fontStyle: 'bold',
    color: MENU_HEX.brassLight,
  }).setOrigin(0.5).setLetterSpacing(2);
  const line = scene.add.text(0, 8, caption, {
    fontFamily: MENU_FONT.body,
    fontSize: '13px',
    color: MENU_HEX.bone,
  }).setOrigin(0.5);
  const width = Math.ceil(Math.max(title.width, line.width) + 28);
  const g = scene.add.graphics();
  g.fillStyle(INK, 1).fillRect(-width / 2 + 3, -18, width, 38);
  g.fillStyle(MENU_COLOR.woodDeep, 1).fillRect(-width / 2, -21, width, 38);
  g.fillStyle(MENU_COLOR.brass, 1).fillRect(-width / 2, -21, width, 2);
  g.lineStyle(1, MENU_COLOR.brassDark, 1).strokeRect(-width / 2 + 0.5, -20.5, width - 1, 37);
  g.fillStyle(MENU_COLOR.woodDeep, 1).fillTriangle(-5, 17, 5, 17, 0, 23);
  g.lineStyle(1, MENU_COLOR.brassDark, 1).lineBetween(-5, 17, 0, 23).lineBetween(0, 23, 5, 17);
  root.add([g, title, line]);
  return root;
}

/** Play one little break beside the party token and resolve once it is over. */
export async function playTravelBreak(
  scene: Phaser.Scene,
  token: Phaser.GameObjects.Sprite,
  particles: ParticleFx,
  depth: number,
  reduced: boolean,
  setting: BreakSetting = {},
): Promise<void> {
  const pool = VIGNETTES.filter((entry) => (!entry.day || !setting.night) && (!entry.water || setting.water));
  const vignette = pool[Math.floor(Math.random() * pool.length)] ?? nap;
  const made: Phaser.GameObjects.GameObject[] = [];
  const kit: Kit = {
    scene,
    token,
    particles,
    depth,
    side: token.flipX ? -1 : 1,
    track: (object) => {
      made.push(object);
      return object;
    },
  };
  const banner = plate(scene, { x: token.x, y: token.y - 70 }, vignette.caption, depth);
  banner.setAlpha(0).setY(banner.y + 8);
  await tween(scene, { targets: banner, alpha: 1, y: banner.y - 8, duration: 220, ease: 'Cubic.Out' });
  if (reduced) await wait(scene, 900);
  else await vignette.play(kit);
  await tween(scene, { targets: banner, alpha: 0, y: banner.y - 6, duration: 200, ease: 'Sine.In' });
  banner.destroy();
  for (const object of made) {
    scene.tweens.killTweensOf(object);
    object.destroy();
  }
}
