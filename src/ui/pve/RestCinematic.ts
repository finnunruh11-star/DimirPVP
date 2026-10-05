// A night's rest, played over everything on screen. The screen goes dark, the inn
// room comes up by candlelight, the candle goes out and the traveller sleeps and
// dreams while the clock runs on. Then they wake, or the bloodmoon wakes them,
// and the room fades back to whatever lies underneath. Every frame is worked out
// from the time elapsed, so a click can hurry it on to waking, then to the end.

import Phaser from 'phaser';
import { playSound } from '../../audio';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config/constants';
import { clockTime } from '../../pve/exploration/clock';
import { napHours, type RestNap } from '../../pve/exploration/nap';
import { strip } from '../../visuals/bosses/raster';
import { darkness, mixColor, skyColor } from '../../visuals/daylight';
import { ensureGlowTextures, GLOW } from '../../visuals/glowTextures';
import {
  DREAMS, FLAME_FRAMES, PANE, renderBubble, renderDot, renderDream, renderFence, renderFlame, renderMoon, renderRoom, renderSleeper,
  renderSmoke, renderSun, renderZ, ROOM_H, ROOM_W, SLEEPER_FRAMES, SLEEPER_HEAD, SMOKE_FRAMES, WICK, type DreamId, type SleeperAnim,
} from '../../visuals/rest/art';
import type { PixelBuffer } from '../../world/pixels';
import { bufferTexture } from '../../world/localeRender';
import { MENU_FONT } from '../cabinet/theme';

export interface RestFilm {
  /** The screen has gone black: change what lies underneath now. */
  black: Promise<void>;
  /** Black again after waking: the last moment to change what lies underneath unseen. */
  dark: Promise<void>;
  /** Faded back in and gone. */
  done: Promise<void>;
}

const PX = 4;
const LEFT = Math.round(GAME_WIDTH / 2 - (ROOM_W * PX) / 2);
const TOP = 52;
const DEPTH = 300;
const sx = (x: number): number => LEFT + x * PX;
const sy = (y: number): number => TOP + y * PX;

const KEY = {
  room: 'rest-room',
  sleeper: (anim: SleeperAnim): string => `rest-sleeper-${anim}`,
  flame: 'rest-flame',
  smoke: 'rest-smoke',
  moon: 'rest-moon',
  sun: 'rest-sun',
  bubble: 'rest-bubble',
  dot: (size: number): string => `rest-dot-${size}`,
  z: (big: boolean): string => `rest-z-${big ? 'big' : 'small'}`,
  dream: (id: DreamId): string => `rest-dream-${id}`,
  fence: 'rest-fence',
};

const DREAM_POOL: readonly DreamId[] = ['coins', 'feast', 'sword', 'castle', 'star'];
const STARS: readonly [number, number][] = [[3, 3], [9, 7], [14, 2], [24, 5], [28, 12], [6, 15], [19, 10], [26, 20]];
/** Where the thought bubbles rise, on the way from the sleeper's head to the dream (room pixels). */
const THOUGHTS: readonly [number, number][] = [[95, 55], [100, 50], [106, 45]];
const BUBBLE_AT: [number, number] = [130, 29];

function ensureRestTextures(scene: Phaser.Scene): void {
  const make = (key: string, paint: () => PixelBuffer, frameW?: number): void => {
    if (!scene.textures.exists(key)) bufferTexture(scene, key, paint(), frameW);
  };
  make(KEY.room, () => renderRoom().px);
  for (const anim of ['sleep', 'wake', 'start'] as const) {
    make(KEY.sleeper(anim), () => strip(Array.from({ length: SLEEPER_FRAMES[anim] }, (_, f) => renderSleeper(anim, f))), ROOM_W);
  }
  make(KEY.flame, () => strip(Array.from({ length: FLAME_FRAMES }, (_, f) => renderFlame(f))), renderFlame(0).w);
  make(KEY.smoke, () => strip(Array.from({ length: SMOKE_FRAMES }, (_, f) => renderSmoke(f))), renderSmoke(0).w);
  make(KEY.moon, () => renderMoon().px);
  make(KEY.sun, () => renderSun().px);
  make(KEY.bubble, () => renderBubble().px);
  for (const size of [0, 1, 2]) make(KEY.dot(size), () => renderDot(size).px);
  for (const big of [false, true]) make(KEY.z(big), () => renderZ(big).px);
  for (const id of DREAMS) make(KEY.dream(id), () => renderDream(id).px);
  make(KEY.fence, () => renderFence().px);
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const span = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a));

/** Play `nap` over `scene`. */
export function playRestCinematic(scene: Phaser.Scene, nap: RestNap, reduced: boolean): RestFilm {
  ensureGlowTextures(scene);
  ensureRestTextures(scene);
  const W = GAME_WIDTH;
  const H = GAME_HEIGHT;
  const ADD = Phaser.BlendModes.ADD;
  const hours = Math.max(0.25, napHours(nap));
  const startAt = nap.from.day * 24 + nap.from.hour;
  const blood = nap.bloodmoon;
  const candleLit = darkness(nap.from.hour) > 0.35;

  const T = reduced
    ? { black: 160, room: 220, snuff: 0, sleep: 1300, wake: 1400, out: 200, clear: 240 }
    : { black: 420, room: 520, snuff: 650, sleep: Math.round(3400 * Math.max(0.4, Math.min(1, hours / 8))), wake: 2200, out: 420, clear: 480 };
  const tRoom = T.black;
  const tSnuff = tRoom + T.room;
  const tSleep = tSnuff + T.snuff;
  const tWake = tSleep + T.sleep;
  const tOut = tWake + T.wake;
  const tClear = tOut + T.out;
  const tEnd = tClear + T.clear;
  const tBubble = tSleep + T.sleep * 0.1;
  const tDreams = tBubble + 420;
  const slot = Math.max(1, (tWake - tDreams) / 3);
  const seed = nap.from.day * 7 + Math.floor(nap.from.hour);
  const first = DREAM_POOL[seed % DREAM_POOL.length];
  const dreams: DreamId[] = ['sheep', first, DREAM_POOL[(seed * 3 + 2) % DREAM_POOL.length] === first ? DREAM_POOL[(seed + 1) % DREAM_POOL.length] : DREAM_POOL[(seed * 3 + 2) % DREAM_POOL.length]];

  // ---- The layers, back to front ----
  const black = scene.add.rectangle(0, 0, W, H, 0x000000, 1).setOrigin(0).setAlpha(0).setDepth(DEPTH).setScrollFactor(0);
  const film = scene.add.container(0, 0).setDepth(DEPTH + 1).setScrollFactor(0).setAlpha(0);
  const sky = scene.add.rectangle(sx(PANE.x), sy(PANE.y), PANE.w * PX, PANE.h * PX, 0x000000).setOrigin(0);
  const stars = STARS.map(([x, y]) => scene.add.rectangle(sx(PANE.x + x), sy(PANE.y + y), PX, PX, 0xe8eeff).setOrigin(0));
  const sun = scene.add.image(0, 0, KEY.sun).setScale(PX);
  const moonGlow = scene.add.image(0, 0, GLOW.soft).setTint(0xff2a1a).setBlendMode(ADD).setScale(1.3).setAlpha(0);
  const moon = scene.add.image(0, 0, KEY.moon).setScale(PX);
  const room = scene.add.image(LEFT, TOP, KEY.room).setOrigin(0).setScale(PX);
  const sleeper = scene.add.image(LEFT, TOP, KEY.sleeper('sleep'), 0).setOrigin(0).setScale(PX);
  // Light over the room, multiplied in: candle warmth, moonlight, dawn, the bloodmoon's red.
  const light = scene.add.rectangle(LEFT, TOP, ROOM_W * PX, ROOM_H * PX, 0xffffff).setOrigin(0).setBlendMode(Phaser.BlendModes.MULTIPLY);
  // A shaft of light from the window down across the bed, brightest where it lands.
  const beam = scene.add.image(sx(67), sy(60), GLOW.beam)
    .setBlendMode(ADD).setDisplaySize(PANE.w * PX * 1.2, 78 * PX).setAngle(-50).setAlpha(0);
  const glow = scene.add.image(sx(WICK[0]), sy(WICK[1] - 3), GLOW.soft).setTint(0xff9a40).setBlendMode(ADD).setScale(3.1).setAlpha(0);
  const flame = scene.add.image(sx(WICK[0]) + PX / 2, sy(WICK[1]) + PX, KEY.flame, 0).setOrigin(0.5, 1).setScale(PX);
  const smoke = scene.add.image(sx(WICK[0]) + PX / 2, sy(WICK[1]) + PX, KEY.smoke, 0).setOrigin(0.5, 1).setScale(PX).setAlpha(0);
  const thoughts = THOUGHTS.map(([x, y], i) => scene.add.image(sx(x), sy(y), KEY.dot(i)).setScale(PX).setAlpha(0));
  const bubble = scene.add.image(sx(BUBBLE_AT[0]), sy(BUBBLE_AT[1]), KEY.bubble).setScale(PX).setAlpha(0);
  const fence = scene.add.image(sx(BUBBLE_AT[0]), sy(BUBBLE_AT[1] + 9), KEY.fence).setScale(PX).setAlpha(0);
  const dream = scene.add.image(sx(BUBBLE_AT[0]), sy(BUBBLE_AT[1] - 1), KEY.dream('sheep')).setScale(PX).setAlpha(0);
  const zs = [0, 1, 2, 3].map((i) => scene.add.image(0, 0, KEY.z(i % 2 === 1)).setAlpha(0));
  const vignette = scene.add.image(W / 2, sy(ROOM_H / 2), GLOW.vignette).setDisplaySize(ROOM_W * PX * 1.1, ROOM_H * PX * 1.28);
  const clock = scene.add.text(W / 2, sy(ROOM_H) + 16, '', {
    fontFamily: MENU_FONT.display, fontSize: '24px', fontStyle: 'bold', color: '#e8dcc0', stroke: '#0a0604', strokeThickness: 5,
  }).setOrigin(0.5, 0).setLetterSpacing(6);
  const title = scene.add.text(W / 2, sy(ROOM_H) + 54, blood ? 'THE BLOODMOON WAKES YOU' : 'RESTED', {
    fontFamily: MENU_FONT.display, fontSize: '32px', fontStyle: 'bold', color: blood ? '#ffd2c4' : '#fde79a',
    stroke: blood ? '#1a0000' : '#2c1806', strokeThickness: 7,
    shadow: { offsetX: 0, offsetY: 0, color: blood ? '#ff2a1a' : '#ff9630', blur: 18, stroke: true, fill: true },
  }).setOrigin(0.5, 0).setLetterSpacing(8).setAlpha(0);
  const note = scene.add.text(W / 2, sy(ROOM_H) + 100, nap.message, {
    fontFamily: MENU_FONT.control, fontSize: '16px', color: '#efe4cc', align: 'center', wordWrap: { width: 900 },
    shadow: { offsetX: 0, offsetY: 2, color: '#000000', blur: 6, fill: true },
  }).setOrigin(0.5, 0).setAlpha(0);
  film.add([sky, ...stars, sun, moonGlow, moon, room, sleeper, light, beam, glow, flame, smoke, ...thoughts, bubble, fence, dream, ...zs, vignette, clock, title, note]);
  const skip = scene.add.zone(0, 0, W, H).setOrigin(0).setDepth(DEPTH + 2).setScrollFactor(0).setInteractive();

  // ---- Time ----
  let ms = 0;
  let over = false;
  const marks = new Set<string>();
  const once = (key: string, at: number, run: () => void): void => {
    if (ms < at || marks.has(key)) return;
    marks.add(key);
    run();
  };
  const settle: Record<'black' | 'dark' | 'done', () => void> = { black: () => {}, dark: () => {}, done: () => {} };
  const black$ = new Promise<void>((resolve) => { settle.black = resolve; });
  const dark$ = new Promise<void>((resolve) => { settle.dark = resolve; });
  const done$ = new Promise<void>((resolve) => { settle.done = resolve; });

  /** Hours since the first midnight, as the clock stands at this moment of the film. */
  const clockAt = (): number => startAt + hours * span(ms, tSleep, tWake);

  const render = (): void => {
    const now = clockAt();
    const hour = now % 24;
    const night = darkness(hour);
    const woke = ms >= tWake;
    const red = blood ? span(ms, tWake, tWake + 500) : 0;
    black.setAlpha(ms < tClear ? span(ms, 0, T.black) : 1 - span(ms, tClear, tEnd));
    film.setAlpha(ms < tOut ? span(ms, tRoom, tRoom + T.room) : 1 - span(ms, tOut, tClear));

    // The sky, the stars, the sun and the moon through the window.
    sky.setFillStyle(mixColor(skyColor(hour), 0x5a0008, red));
    stars.forEach((star, i) => star.setAlpha(night * (1 - red * 0.6) * (0.55 + 0.45 * Math.sin(ms / 260 + i * 1.7))));
    const dayP = (hour - 5.5) / 15;
    sun.setVisible(dayP >= 0 && dayP <= 1 && !blood).setAlpha(1 - night);
    sun.setPosition(sx(PANE.x + 5 + (PANE.w - 10) * clamp01(dayP)), sy(PANE.y + PANE.h - 5 - Math.sin(clamp01(dayP) * Math.PI) * (PANE.h - 12)));
    const nightP = (((hour - 18) % 24) + 24) % 24 / 13;
    moon.setVisible(nightP <= 1).setAlpha(Math.min(1, night * 1.6));
    moon.setPosition(sx(PANE.x + 5 + (PANE.w - 10) * clamp01(nightP)), sy(PANE.y + PANE.h - 5 - Math.sin(clamp01(nightP) * Math.PI) * (PANE.h - 12)));
    moon.setTint(mixColor(0xffffff, 0xff3a2a, red)).setScale(PX * (1 + red * 0.35));
    moonGlow.setPosition(moon.x, moon.y).setAlpha(red * 0.9);

    // The candle: lit at nightfall, out once the traveller lies down.
    const candle = candleLit ? 1 - span(ms, tSnuff + 100, tSnuff + 260) : 0;
    flame.setVisible(candle > 0).setFrame(Math.floor(ms / 110) % FLAME_FRAMES).setScale(PX, PX * (0.3 + 0.7 * candle));
    glow.setAlpha(candle * (0.5 + 0.08 * Math.sin(ms / 70) + 0.05 * Math.sin(ms / 23)));
    const puff = candleLit ? span(ms, tSnuff + 140, tSnuff + 1240) : 1;
    smoke.setAlpha(puff > 0 && puff < 1 ? 0.8 * (1 - puff) : 0).setFrame(Math.min(SMOKE_FRAMES - 1, Math.floor(puff * SMOKE_FRAMES)));
    let tint = mixColor(0xffffff, 0x5a6cae, night);
    tint = mixColor(tint, 0xffc27a, candle * night * 0.85);
    light.setFillStyle(mixColor(tint, 0xff5a48, red * 0.8));
    beam.setTint(blood && red > 0 ? 0xff5040 : mixColor(0xfff0c0, 0x9ab4ff, night)).setAlpha((1 - candle) * (0.12 + night * 0.1 + red * 0.2));

    // The sleeper: breathing, then sitting up to stretch, or bolting upright.
    if (!woke) sleeper.setTexture(KEY.sleeper('sleep'), Math.floor(ms / 260) % SLEEPER_FRAMES.sleep);
    else if (!blood) sleeper.setTexture(KEY.sleeper('wake'), Math.min(SLEEPER_FRAMES.wake - 1, Math.floor((ms - tWake) / 110)));
    else sleeper.setTexture(KEY.sleeper('start'), Math.min(SLEEPER_FRAMES.start - 1, Math.max(0, Math.floor((ms - tWake - 200) / 80))));

    // Zs rise while the traveller sleeps.
    zs.forEach((z) => z.setAlpha(0));
    if (!reduced) {
      for (let i = Math.max(0, Math.floor((ms - tSleep - 1700) / 620)); ; i++) {
        const born = tSleep - 200 + i * 620;
        if (born > ms || born > tWake - 500) break;
        const p = (ms - born) / 1700;
        if (p >= 1) continue;
        const z = zs[i % zs.length];
        z.setPosition(sx(SLEEPER_HEAD[0] + 1) - 26 * p * PX / 4 + Math.sin(p * 6 + i) * 6, sy(SLEEPER_HEAD[1] - 5) - 110 * p);
        z.setScale(PX * (0.7 + 0.55 * p)).setAlpha(woke ? 0 : p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85);
      }
    }

    // The dream: thought bubbles up to a cloud, a few dreams in it, then waking bursts it.
    thoughts.forEach((dot, i) => dot.setAlpha(span(ms, tBubble + i * 110, tBubble + i * 110 + 90) * (1 - span(ms, tWake, tWake + 240))));
    const grow = span(ms, tBubble + 330, tBubble + 590);
    const pop = blood ? span(ms, tWake + 800, tWake + 1100) : span(ms, tWake, tWake + 260);
    const cloud = grow * (1 - pop);
    bubble.setAlpha(cloud).setScale(PX * (0.55 + 0.45 * Math.min(1, grow * 1.12)) * (1 + pop * 0.25));
    bubble.setTint(mixColor(0xffffff, 0xff8a7a, red));
    const index = Math.min(2, Math.floor((ms - tDreams) / slot));
    const slotStart = tDreams + index * slot;
    const shown = ms < tDreams ? 0 : span(ms, slotStart, slotStart + 140) * (index < 2 ? 1 - span(ms, slotStart + slot - 140, slotStart + slot) : 1);
    const id: DreamId = blood && ms >= tWake + 120 ? 'bloodmoon' : dreams[Math.max(0, index)];
    dream.setTexture(KEY.dream(id)).setFlipX(id === 'sheep');
    let dx = 0;
    let dy = Math.sin(ms / 300);
    if (id === 'sheep') {
      const hop = ((ms - tDreams) / (slot / 2)) % 1;
      dx = -15 + 30 * hop;
      dy = -Math.sin(hop * Math.PI) * 8;
    }
    dream.setPosition(sx(BUBBLE_AT[0] + dx), sy(BUBBLE_AT[1] - 2 + dy));
    dream.setAlpha(cloud * (id === 'bloodmoon' ? 1 : shown)).setScale(PX * (id === 'bloodmoon' ? 1 + 0.12 * Math.sin(ms / 90) : 1));
    fence.setAlpha(cloud * (id === 'sheep' ? shown : 0));

    // The clock under the room, and what the night brought.
    const day = Math.floor(now / 24);
    const text = `DAY ${day}   \u00b7   ${clockTime(hour)}`;
    if (clock.text !== text) clock.setText(text);
    clock.setColor(red > 0.5 ? '#ffb8a8' : '#e8dcc0');
    title.setAlpha(span(ms, tWake + 350, tWake + 650));
    note.setAlpha(span(ms, tWake + 550, tWake + 850));

    once('sleep', 0, () => playSound('rest.sleep'));
    if (candleLit) once('snuff', tSnuff + 100, () => playSound('rest.snuff'));
    once('wake', tWake, () => {
      if (!blood) {
        playSound('rest.wake');
        return;
      }
      playSound('boss.omen');
      if (!reduced) scene.cameras.main.shake(260, 0.006);
    });
    once('black', T.black, settle.black);
    once('dark', tClear, settle.dark);
  };

  const finish = (): void => {
    if (over) return;
    over = true;
    scene.events.off(Phaser.Scenes.Events.UPDATE, tick);
    scene.events.off(Phaser.Scenes.Events.SHUTDOWN, finish);
    scene.input.keyboard?.off('keydown', hurry);
    for (const part of [black, film, skip]) part.destroy();
    settle.black();
    settle.dark();
    settle.done();
  };
  function tick(_time: number, delta: number): void {
    ms += Math.min(100, delta);
    render();
    if (ms >= tEnd) finish();
  }
  /** On to waking; once awake, on to the end. */
  function hurry(): void {
    const to = ms < tWake - 50 ? tWake : ms < tOut ? tOut : ms;
    if (to === ms) return;
    for (const key of ['sleep', 'snuff']) marks.add(key);
    ms = to;
    render();
  }
  skip.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, hurry);
  scene.input.keyboard?.on('keydown', hurry);
  scene.events.on(Phaser.Scenes.Events.UPDATE, tick);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, finish);
  render();
  return { black: black$, dark: dark$, done: done$ };
}
