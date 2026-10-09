// Vs. the bloodmoon's boss. The moon rises out of black and beats twice; a
// slash splits the screen and the two sides slam in, the party on the left, the
// boss on the right as a silhouette until lightning shows it; VS lands with a
// shockwave, the boss's name slides in under it, and on the way out the halves
// tear apart to show the arena. A click or a key cuts straight to the exit.
// Presentation only: every random number here is Math.random.

import Phaser from 'phaser';
import { playSound } from '../../audio';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config/constants';
import { roman, type BossColor, type BossDef } from '../../pve/exploration/bloodmoon';
import type { BossSheet } from '../../visuals/bosses';
import { ensureGlowTextures, GLOW } from '../../visuals/glowTextures';
import { ParticleFx } from '../../visuals/ParticleFx';
import { MENU_FONT } from '../cabinet/theme';

export interface BossIntroModel {
  boss: BossDef;
  cycle: number;
  bossAnim: string;
  /** The texture to start on, when it is not named after the idle animation (the tinted mage). */
  bossTexture?: string;
  bossTint?: number;
  bossRoar: string;
  bossSheet: BossSheet;
  /** The boss's leader in the arena: it roars as the screen opens on it. */
  arenaBoss?: { sprite: Phaser.GameObjects.Sprite; roar: string; idle: string };
  /** Who comes with the boss, when it is more than one: "Hrrrk Snazzlegob · 2 Goblin Raiders". */
  roster?: string;
  party: { name: string; texture: string; anim?: string; tint?: number }[];
  scaling?: { players: number; health: number; damage?: number };
  reducedMotion: boolean;
}

interface Theme {
  panel: number;
  deep: number;
  accent: number;
  glow: number;
  light: string;
  mid: string;
  label: string;
}

const THEMES: Record<BossColor, Theme> = {
  red: { panel: 0x420910, deep: 0x140204, accent: 0xff4a36, glow: 0xff3a24, light: '#ffe2d2', mid: '#ff7a5a', label: 'RED' },
  black: { panel: 0x220e36, deep: 0x07030d, accent: 0xb66cff, glow: 0x8a3cff, light: '#efe2ff', mid: '#b684ff', label: 'BLACK' },
  green: { panel: 0x0d3418, deep: 0x020c05, accent: 0x6cf07a, glow: 0x3ad05a, light: '#e2ffdc', mid: '#86f08c', label: 'GREEN' },
  blue: { panel: 0x0c2254, deep: 0x020818, accent: 0x5aacff, glow: 0x2a7cff, light: '#e0eeff', mid: '#7ab8ff', label: 'BLUE' },
  white: { panel: 0x463d2a, deep: 0x120e06, accent: 0xffe7a0, glow: 0xffcc5a, light: '#fffbf0', mid: '#ffe39a', label: 'WHITE' },
};

const PARTY_PANEL = 0x131d33;
const PARTY_DEEP = 0x03060d;
const PARTY_ACCENT = 0x9fc0ff;
const DEPTH = 9000;
/** The seam runs from here along the top to here along the bottom. */
const SEAM_TOP = GAME_WIDTH * 0.585;
const SEAM_BOTTOM = GAME_WIDTH * 0.415;

const seamX = (y: number): number => SEAM_TOP + (SEAM_BOTTOM - SEAM_TOP) * (y / GAME_HEIGHT);

interface Streak {
  y: number;
  x: number;
  len: number;
  speed: number;
  thick: number;
  alpha: number;
}

function streaks(count: number): Streak[] {
  return Array.from({ length: count }, () => ({
    y: Math.random() * GAME_HEIGHT,
    x: Math.random() * GAME_WIDTH,
    len: 60 + Math.random() * 220,
    speed: 0.9 + Math.random() * 2.2,
    thick: Math.random() < 0.2 ? 3 : Math.random() < 0.5 ? 2 : 1,
    alpha: 0.08 + Math.random() * 0.22,
  }));
}

export function playBossIntro(scene: Phaser.Scene, model: BossIntroModel): Promise<void> {
  ensureGlowTextures(scene);
  const still = model.reducedMotion;
  const theme = THEMES[model.boss.color];
  const W = GAME_WIDTH;
  const H = GAME_HEIGHT;
  const ADD = Phaser.BlendModes.ADD;
  const made: Phaser.GameObjects.GameObject[] = [];
  const timers: Phaser.Time.TimerEvent[] = [];
  const particles = new ParticleFx(scene, () => still);
  const keep = <T extends Phaser.GameObjects.GameObject>(object: T): T => {
    made.push(object);
    const o = object as unknown as Phaser.GameObjects.Components.ScrollFactor & Phaser.GameObjects.Components.Depth;
    o.setScrollFactor?.(0);
    if (typeof o.depth === 'number' && o.depth < DEPTH) o.setDepth?.(DEPTH);
    return object;
  };
  const at = (ms: number, run: () => void): void => {
    timers.push(scene.time.delayedCall(still ? ms * 0.35 : ms, run));
  };
  const tween = (config: Phaser.Types.Tweens.TweenBuilderConfig): void => {
    scene.tweens.add(still ? { ...config, duration: Math.min(Number(config.duration ?? 200), 180), delay: 0, ease: 'Linear' } : config);
  };
  const shake = (ms: number, force: number): void => {
    if (!still) scene.cameras.main.shake(ms, force);
  };

  // Black over everything; the arena is set up underneath.
  const backdrop = keep(scene.add.rectangle(0, 0, W, H, 0x000000, 1).setOrigin(0));

  // The moon rises out of the dark and beats twice.
  const moonHalo = keep(scene.add.image(W / 2, H * 0.62, GLOW.soft).setTint(theme.glow).setBlendMode(ADD).setDisplaySize(560, 560).setAlpha(0));
  const moon = keep(scene.add.image(W / 2, H * 0.72, GLOW.moon).setTint(0xff3a2a).setDisplaySize(220, 220).setAlpha(0));
  const moonTitle = keep(scene.add.text(W / 2, H * 0.24, `BLOODMOON   ${roman(model.cycle)}`, {
    fontFamily: MENU_FONT.control, fontSize: '22px', fontStyle: 'bold', color: '#ff8a7a',
  }).setOrigin(0.5).setLetterSpacing(14).setAlpha(0));
  playSound('boss.bloodmoon');
  tween({ targets: moon, y: H * 0.44, alpha: 1, duration: 700, ease: 'Cubic.Out' });
  tween({ targets: moonHalo, y: H * 0.44, alpha: 0.55, duration: 700, ease: 'Cubic.Out' });
  tween({ targets: moonTitle, alpha: 1, duration: 420, delay: 120, ease: 'Sine.Out' });
  for (const beat of [180, 500]) {
    at(beat, () => {
      tween({ targets: [moon], displayWidth: 236, displayHeight: 236, duration: 90, yoyo: true, ease: 'Quad.Out' });
      tween({ targets: [moonHalo], alpha: 0.9, duration: 90, yoyo: true, ease: 'Quad.Out' });
      shake(90, 0.003);
    });
  }

  // The two halves, off screen until the slash.
  const partyPanel = keep(scene.add.container(-W, 0));
  const bossPanel = keep(scene.add.container(W, 0));
  const panelShape = (side: 'party' | 'boss', inset: number): Phaser.Math.Vector2[] => side === 'party'
    ? [new Phaser.Math.Vector2(0, 0), new Phaser.Math.Vector2(SEAM_TOP - inset, 0), new Phaser.Math.Vector2(SEAM_BOTTOM - inset, H), new Phaser.Math.Vector2(0, H)]
    : [new Phaser.Math.Vector2(SEAM_TOP + inset, 0), new Phaser.Math.Vector2(W, 0), new Phaser.Math.Vector2(W, H), new Phaser.Math.Vector2(SEAM_BOTTOM + inset, H)];
  const partyBack = scene.add.graphics();
  partyBack.fillStyle(PARTY_DEEP, 1).fillPoints(panelShape('party', 0), true);
  partyBack.fillStyle(PARTY_PANEL, 1).fillPoints([
    new Phaser.Math.Vector2(0, H * 0.3), new Phaser.Math.Vector2(seamX(H * 0.3) - 4, H * 0.3),
    new Phaser.Math.Vector2(SEAM_BOTTOM - 4, H), new Phaser.Math.Vector2(0, H),
  ], true);
  const bossBack = scene.add.graphics();
  bossBack.fillStyle(theme.deep, 1).fillPoints(panelShape('boss', 0), true);
  bossBack.fillStyle(theme.panel, 1).fillPoints([
    new Phaser.Math.Vector2(seamX(H * 0.55) + 4, H * 0.55), new Phaser.Math.Vector2(W, H * 0.55),
    new Phaser.Math.Vector2(W, H), new Phaser.Math.Vector2(SEAM_BOTTOM + 4, H),
  ], true);
  const partyLight = scene.add.image(W * 0.2, H * 0.62, GLOW.soft).setTint(PARTY_ACCENT).setBlendMode(ADD).setDisplaySize(700, 460).setAlpha(0.22);
  const partyLines = scene.add.graphics();
  const bossLines = scene.add.graphics();
  const rays = scene.add.image(W * 0.74, H * 0.4, GLOW.rays).setTint(theme.glow).setBlendMode(ADD).setScale(1.9).setAlpha(0.35);
  const bossLight = scene.add.image(W * 0.74, H * 0.42, GLOW.soft).setTint(theme.glow).setBlendMode(ADD).setDisplaySize(760, 760).setAlpha(0.4);
  partyPanel.add([partyBack, partyLight, partyLines]);
  bossPanel.add([bossBack, bossLight, rays, bossLines]);

  // The party, standing in a staggered line and facing the boss.
  const partySprites: Phaser.GameObjects.Sprite[] = [];
  const partyNames: Phaser.GameObjects.Text[] = [];
  model.party.forEach((member, index) => {
    const x = 150 + index * 125;
    const y = H * 0.8 - index * 26;
    const sprite = scene.add.sprite(x, y, member.texture).setOrigin(0.5, 1);
    if (member.anim && scene.anims.exists(member.anim)) sprite.play(member.anim);
    sprite.setScale(170 / Math.max(1, sprite.height));
    if (member.tint != null) sprite.setTint(member.tint);
    sprite.setData('tint', member.tint ?? null);
    const name = scene.add.text(x, y + 14, member.name.toUpperCase(), {
      fontFamily: MENU_FONT.control, fontSize: '16px', fontStyle: 'bold', color: '#dce6ff',
    }).setOrigin(0.5, 0).setLetterSpacing(3).setAlpha(0);
    partySprites.push(sprite);
    partyNames.push(name);
    partyPanel.add([sprite, name]);
  });
  const partyEyebrow = scene.add.text(48, 44, 'THE PARTY', {
    fontFamily: MENU_FONT.control, fontSize: '15px', fontStyle: 'bold', color: '#9fb4e0',
  }).setLetterSpacing(8).setAlpha(0);
  partyPanel.add(partyEyebrow);
  if (model.scaling) {
    const { players, health, damage } = model.scaling;
    const note = scene.add.text(48, H - 58, `${players} PLAYERS    BOSS HEALTH x${health}${damage ? `    DAMAGE x${damage}` : ''}`, {
      fontFamily: MENU_FONT.control, fontSize: '14px', fontStyle: 'bold', color: '#9fb4e0',
    }).setLetterSpacing(2).setAlpha(0);
    partyPanel.add(note);
    partyNames.push(note);
  }

  // The boss, a black shape until the lightning.
  // A whole-number scale, so every art pixel stays square.
  const bossScale = Math.max(1, Math.floor(Math.min(400 / model.bossSheet.frameH, 560 / model.bossSheet.frameW)));
  const bossX = W * 0.76;
  const bossY = H * 0.8;
  const boss = scene.add.sprite(bossX + 220, bossY, model.bossTexture ?? model.bossAnim).setOrigin(0.5, model.bossSheet.originY).setScale(bossScale * 1.12);
  if (scene.anims.exists(model.bossAnim)) boss.play(model.bossAnim);
  boss.setTintFill(0x000000);
  bossPanel.add(boss);

  // The name plate under the boss.
  const plate = keep(scene.add.container(W + 40, H - 118));
  const nameText = scene.add.text(0, 8, model.boss.name.toUpperCase(), {
    fontFamily: MENU_FONT.display, fontSize: model.boss.name.length > 20 ? '40px' : '54px', fontStyle: 'bold', color: theme.light,
    stroke: '#000000', strokeThickness: 8,
  }).setOrigin(1, 0.5).setLetterSpacing(3);
  const eyebrow = scene.add.text(-4, -34, `BLOODMOON ${roman(model.cycle)}    ${theme.label}`, {
    fontFamily: MENU_FONT.control, fontSize: '15px', fontStyle: 'bold', color: theme.mid,
  }).setOrigin(1, 0.5).setLetterSpacing(8);
  const plateW = nameText.width + 90;
  const plateBack = scene.add.graphics();
  plateBack.fillStyle(0x000000, 0.86).fillPoints([
    new Phaser.Math.Vector2(-plateW, -18), new Phaser.Math.Vector2(30, -18), new Phaser.Math.Vector2(30, 40), new Phaser.Math.Vector2(-plateW - 24, 40),
  ], true);
  plateBack.fillStyle(theme.accent, 1).fillRect(-plateW - 24, 40, plateW + 54, 4);
  plateBack.fillStyle(theme.accent, 1).fillPoints([
    new Phaser.Math.Vector2(-plateW - 6, -18), new Phaser.Math.Vector2(-plateW + 4, -18), new Phaser.Math.Vector2(-plateW - 18, 40), new Phaser.Math.Vector2(-plateW - 28, 40),
  ], true);
  plate.add([plateBack, eyebrow, nameText]);
  if (model.roster) {
    plate.add(scene.add.text(-4, 62, model.roster.toUpperCase(), {
      fontFamily: MENU_FONT.control, fontSize: '14px', fontStyle: 'bold', color: theme.light,
    }).setOrigin(1, 0.5).setLetterSpacing(3));
  }
  plate.setX(W + plateW + 60);

  // VS, and the light and ring it lands with.
  const vs = keep(scene.add.text(W / 2, H * 0.47, 'VS', {
    fontFamily: MENU_FONT.display, fontSize: '168px', fontStyle: 'bold italic', color: '#ffffff',
    stroke: '#000000', strokeThickness: 14,
    shadow: { offsetX: 0, offsetY: 0, color: Phaser.Display.Color.IntegerToColor(theme.glow).rgba, blur: 34, stroke: true, fill: true },
    padding: { x: 40, y: 40 },
  }).setOrigin(0.5).setAngle(-8).setAlpha(0));
  const gradient = vs.context.createLinearGradient(0, 40, 0, vs.height - 40);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.5, '#ffffff');
  gradient.addColorStop(1, theme.mid);
  vs.setFill(gradient);
  const vsGlow = keep(scene.add.image(W / 2, H * 0.47, GLOW.soft).setTint(theme.glow).setBlendMode(ADD).setDisplaySize(520, 380).setAlpha(0));
  const shock = keep(scene.add.graphics({ x: W / 2, y: H * 0.47 }).setAlpha(0));
  shock.lineStyle(6, 0xffffff, 1).strokeCircle(0, 0, 60);
  shock.lineStyle(16, theme.glow, 0.35).strokeCircle(0, 0, 66);
  const seam = keep(scene.add.graphics());
  const slash = keep(scene.add.rectangle(seamX(H / 2), H / 2, Math.hypot(W, H) * 0.55, 6, 0xffffff, 1).setRotation(Math.atan2(H, SEAM_BOTTOM - SEAM_TOP)).setScale(0, 1).setAlpha(0));
  const flash = keep(scene.add.rectangle(0, 0, W, H, 0xffffff, 1).setOrigin(0).setBlendMode(ADD).setAlpha(0));
  const skip = keep(scene.add.zone(0, 0, W, H).setOrigin(0).setInteractive());
  vs.setDepth(DEPTH + 3);
  vsGlow.setDepth(DEPTH + 2);
  shock.setDepth(DEPTH + 3);
  plate.setDepth(DEPTH + 3);
  seam.setDepth(DEPTH + 2);
  slash.setDepth(DEPTH + 4);
  flash.setDepth(DEPTH + 5);
  skip.setDepth(DEPTH + 6);

  // Each frame: speed lines stream at the seam from both sides, and the seam crackles.
  const partyStreaks = streaks(34);
  const bossStreaks = streaks(34);
  let seamOn = false;
  let crackleAt = 0;
  const onUpdate = (_time: number, delta: number): void => {
    const step = still ? 0 : delta;
    partyLines.clear();
    bossLines.clear();
    for (const s of partyStreaks) {
      s.x += s.speed * step;
      const edge = seamX(s.y) - 10;
      if (s.x - s.len > edge) {
        s.x = -Math.random() * 200;
        s.y = Math.random() * H;
      }
      const x0 = Math.max(0, s.x - s.len);
      const x1 = Math.min(edge, s.x);
      if (x1 > x0) partyLines.fillStyle(PARTY_ACCENT, s.alpha).fillRect(x0, s.y, x1 - x0, s.thick);
    }
    for (const s of bossStreaks) {
      s.x -= s.speed * step;
      const edge = seamX(s.y) + 10;
      if (s.x + s.len < edge) {
        s.x = W + Math.random() * 200;
        s.y = Math.random() * H;
      }
      const x0 = Math.max(edge, s.x);
      const x1 = Math.min(W, s.x + s.len);
      if (x1 > x0) bossLines.fillStyle(theme.accent, s.alpha).fillRect(x0, s.y, x1 - x0, s.thick);
    }
    if (!seamOn) return;
    crackleAt -= delta;
    if (crackleAt > 0) return;
    crackleAt = 55;
    seam.clear();
    const points: Phaser.Math.Vector2[] = [];
    for (let i = 0; i <= 14; i++) {
      const y = (i / 14) * H;
      points.push(new Phaser.Math.Vector2(seamX(y) + (i % 14 ? (Math.random() - 0.5) * 14 : 0), y));
    }
    seam.lineStyle(10, theme.glow, 0.35).strokePoints(points);
    seam.lineStyle(4, theme.accent, 1).strokePoints(points);
    seam.lineStyle(1.5, 0xffffff, 1).strokePoints(points);
  };
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);

  // The slash splits the screen and the halves slam in.
  at(760, () => {
    playSound('boss.slash');
    slash.setAlpha(1);
    tween({ targets: slash, scaleX: 1, duration: 110, ease: 'Cubic.Out' });
    tween({ targets: slash, alpha: 0, duration: 260, delay: 140, ease: 'Sine.In' });
    flash.setAlpha(0.55);
    tween({ targets: flash, alpha: 0, duration: 300, ease: 'Quad.Out' });
    shake(160, 0.008);
    tween({ targets: partyPanel, x: 0, duration: 300, ease: 'Cubic.Out' });
    tween({ targets: bossPanel, x: 0, duration: 300, ease: 'Cubic.Out' });
    tween({ targets: [moon, moonHalo], x: W * 0.74, y: H * 0.36, duration: 420, ease: 'Cubic.Out' });
    tween({ targets: moon, displayWidth: 300, displayHeight: 300, duration: 420, ease: 'Cubic.Out' });
    tween({ targets: moonTitle, alpha: 0, y: H * 0.2, duration: 260, ease: 'Sine.In' });
    seamOn = true;
  });
  // The party steps in, one by one.
  partySprites.forEach((sprite, index) => {
    const home = sprite.x;
    sprite.setX(home - 260).setTintFill(0x000000);
    at(900 + index * 90, () => tween({ targets: sprite, x: home, duration: 340, ease: 'Cubic.Out' }));
    at(1330 + index * 60, () => {
      const tint = sprite.getData('tint') as number | null;
      sprite.clearTint();
      if (tint != null) sprite.setTint(tint);
    });
  });
  at(1000, () => tween({ targets: partyEyebrow, alpha: 1, duration: 300 }));
  // The boss looms in as a silhouette, and the lightning shows it.
  at(960, () => tween({ targets: boss, x: bossX, scale: bossScale, duration: 460, ease: 'Cubic.Out' }));
  at(1460, () => {
    playSound('spell.thunder');
    boss.setTintFill(0xffffff);
    flash.setAlpha(0.35);
    tween({ targets: flash, alpha: 0, duration: 240, ease: 'Quad.Out' });
    shake(260, 0.01);
    particles.burst({ x: bossX, y: bossY - model.bossSheet.frameH * bossScale * 0.45 }, {
      color: theme.accent, count: 40, speed: 420, lifespan: 900, glow: true, drag: 0.86, size: 14, spread: 60, depth: DEPTH + 1,
    });
  });
  at(1540, () => {
    boss.clearTint();
    if (model.bossTint != null) boss.setTint(model.bossTint);
    playSound('boss.roar');
    if (scene.anims.exists(model.bossRoar)) {
      boss.play(model.bossRoar);
      boss.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        if (boss.active && scene.anims.exists(model.bossAnim)) boss.play(model.bossAnim);
      });
    }
  });
  // VS lands.
  at(1640, () => {
    playSound('boss.vs');
    vs.setScale(3.6).setAngle(-24).setAlpha(0);
    tween({ targets: vs, scale: 1, angle: -8, alpha: 1, duration: 200, delay: 190, ease: 'Cubic.In' });
  });
  at(1840, () => {
    shake(320, 0.014);
    flash.setAlpha(0.7);
    tween({ targets: flash, alpha: 0, duration: 420, ease: 'Quad.Out' });
    vsGlow.setAlpha(0.95);
    tween({ targets: vsGlow, alpha: 0.4, duration: 700, ease: 'Sine.Out' });
    shock.setAlpha(1).setScale(0.5);
    tween({ targets: shock, scale: 5.5, alpha: 0, duration: 760, ease: 'Cubic.Out' });
    particles.burst({ x: W / 2, y: H * 0.47 }, { color: 0xffffff, count: 34, speed: 560, lifespan: 700, glow: true, drag: 0.84, size: 10, spread: 30, depth: DEPTH + 4 });
    particles.burst({ x: W / 2, y: H * 0.47 }, { color: theme.accent, count: 28, speed: 380, lifespan: 1100, glow: true, drag: 0.88, size: 14, spread: 40, depth: DEPTH + 4 });
    tween({ targets: vs, scale: 1.06, duration: 90, yoyo: true, ease: 'Quad.Out' });
  });
  // The name slides in under the boss, the party's names under them.
  at(2020, () => {
    tween({ targets: plate, x: W - 40, duration: 380, ease: 'Cubic.Out' });
    nameText.setLetterSpacing(24);
    tween({ targets: partyNames, alpha: 1, duration: 360, ease: 'Sine.Out' });
  });
  // Embers rise across it all while it holds.
  for (let t = 900; t < 3900; t += 90) {
    at(t, () => particles.burst({ x: Math.random() * W, y: H + 10 }, {
      color: Math.random() < 0.5 ? theme.accent : 0xffb070, count: 1, speed: 60 + Math.random() * 60, lifespan: 2600,
      glow: true, size: 6 + Math.random() * 6, alpha: 0.8, angle: { min: 255, max: 285 }, gravityY: -12, depth: DEPTH + 1,
    }));
  }
  if (!still) {
    tween({ targets: rays, angle: 40, duration: 5000, ease: 'Linear' });
    tween({ targets: bossLight, alpha: 0.55, duration: 900, yoyo: true, repeat: 3, ease: 'Sine.InOut', delay: 1500 });
  }
  let spaced = 24;
  const spacing = (): void => {
    spaced = Math.max(3, spaced - 1.5);
    nameText.setLetterSpacing(spaced);
  };
  at(2020, () => {
    for (let k = 0; k < 14; k++) at(2020 + k * 26, spacing);
  });

  const keyboard = scene.input.keyboard;
  return new Promise<void>((resolve) => {
    let leaving = false;
    let done = false;
    const cleanup = (): void => {
      if (done) return;
      done = true;
      scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
      scene.events.off(Phaser.Scenes.Events.SHUTDOWN, cleanup);
      keyboard?.off('keydown', outro);
      for (const timer of timers) timer.remove(false);
      scene.tweens.killTweensOf(made);
      scene.tweens.killTweensOf([...partySprites, boss, nameText]);
      for (const object of made) object.destroy();
      particles.destroy();
      resolve();
    };
    const outro = (): void => {
      if (leaving || done) return;
      leaving = true;
      for (const timer of timers) timer.remove(false);
      nameText.setLetterSpacing(3);
      plate.setX(W - 40);
      partyNames.forEach((name) => name.setAlpha(1));
      seamOn = false;
      seam.clear();
      playSound('boss.slash');
      flash.setAlpha(0.6);
      tween({ targets: flash, alpha: 0, duration: 380, ease: 'Quad.Out' });
      tween({ targets: [partyPanel], x: -W * 0.7, duration: 420, ease: 'Cubic.In' });
      tween({ targets: [bossPanel, plate], x: `+=${W * 0.7}`, duration: 420, ease: 'Cubic.In' });
      tween({ targets: [moon, moonHalo, moonTitle], alpha: 0, duration: 300 });
      tween({ targets: [vs, vsGlow], scale: 1.8, alpha: 0, duration: 380, ease: 'Cubic.In' });
      tween({ targets: backdrop, alpha: 0, duration: 520, delay: 160, ease: 'Sine.Out' });
      scene.time.delayedCall(still ? 240 : 380, () => {
        shake(300, 0.012);
        const arena = model.arenaBoss;
        if (arena?.sprite.active && scene.anims.exists(arena.roar)) {
          arena.sprite.play(arena.roar, true);
          arena.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
            if (arena.sprite.active && scene.anims.exists(arena.idle)) arena.sprite.play(arena.idle, true);
          });
        }
      });
      scene.time.delayedCall(still ? 420 : 720, cleanup);
    };
    skip.once('pointerdown', outro);
    keyboard?.once('keydown', outro);
    at(4100, outro);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
  });
}

/**
 * Over whatever scene the party stands in: the screen reddens, the moon climbs,
 * two heartbeats, and black. The fight starts once it resolves.
 */
export function playBloodmoonRise(scene: Phaser.Scene, reduced: boolean): Promise<void> {
  ensureGlowTextures(scene);
  const W = GAME_WIDTH;
  const H = GAME_HEIGHT;
  const ADD = Phaser.BlendModes.ADD;
  const red = scene.add.rectangle(0, 0, W, H, 0x5a0008, 1).setOrigin(0).setAlpha(0).setDepth(DEPTH).setScrollFactor(0);
  const vignette = scene.add.image(W / 2, H / 2, GLOW.vignette).setDisplaySize(W * 1.1, H * 1.25).setTint(0x200000).setAlpha(0).setDepth(DEPTH).setScrollFactor(0);
  const halo = scene.add.image(W / 2, H * 0.3, GLOW.soft).setTint(0xff2a1a).setBlendMode(ADD).setDisplaySize(620, 620).setAlpha(0).setDepth(DEPTH).setScrollFactor(0);
  const moon = scene.add.image(W / 2, H * 0.46, GLOW.moon).setTint(0xff3a2a).setDisplaySize(170, 170).setAlpha(0).setDepth(DEPTH).setScrollFactor(0);
  const text = scene.add.text(W / 2, H * 0.62, 'THE BLOODMOON RISES', {
    fontFamily: MENU_FONT.display, fontSize: '46px', fontStyle: 'bold', color: '#ffd2c4', stroke: '#1a0000', strokeThickness: 8,
  }).setOrigin(0.5).setLetterSpacing(10).setAlpha(0).setDepth(DEPTH).setScrollFactor(0);
  const black = scene.add.rectangle(0, 0, W, H, 0x000000, 1).setOrigin(0).setAlpha(0).setDepth(DEPTH + 1).setScrollFactor(0);
  const parts = [red, vignette, halo, moon, text, black];
  const ms = (value: number): number => (reduced ? Math.min(value, 200) : value);
  playSound('boss.bloodmoon');
  scene.tweens.add({ targets: red, alpha: 0.42, duration: ms(700), ease: 'Sine.Out' });
  scene.tweens.add({ targets: vignette, alpha: 1, duration: ms(700), ease: 'Sine.Out' });
  scene.tweens.add({ targets: [moon, halo], y: H * 0.3, alpha: { from: 0, to: 1 }, duration: ms(900), ease: 'Cubic.Out' });
  scene.tweens.add({ targets: text, alpha: 1, duration: ms(500), delay: ms(300), ease: 'Sine.Out' });
  if (!reduced) {
    text.setLetterSpacing(26);
    scene.tweens.addCounter({ from: 26, to: 10, duration: 900, delay: 300, ease: 'Cubic.Out', onUpdate: (tw) => text.setLetterSpacing(tw.getValue() ?? 10) });
    for (const beat of [180, 500]) scene.time.delayedCall(beat, () => scene.cameras.main.shake(100, 0.004));
  }
  return new Promise<void>((resolve) => {
    scene.tweens.add({
      targets: black, alpha: 1, duration: ms(420), delay: ms(1250), ease: 'Sine.In',
      onComplete: () => {
        resolve();
        scene.time.delayedCall(0, () => { for (const part of parts) part.destroy(); });
      },
    });
  });
}
